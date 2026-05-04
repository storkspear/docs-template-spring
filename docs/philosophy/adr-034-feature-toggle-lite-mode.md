# ADR-034 — Lite 모드 (Spring profile + ConditionalOnProperty 기반 feature toggle)

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~8분

**상태**: 채택 (2026-05-02) — 설계만. 구현은 별도 사이클.
**전제**: ADR-019 (도메인 횡단 분리), ADR-024 (core-email 추출), ADR-028 (audit), ADR-030 (2FA), ADR-031 (notification toggle)
**연관**: 템플릿 판매 — Lite vs Full 변형

---

## 결론부터

7 도메인 (audit / push / billing-notification / password-policy / email / payment / iap / 2fa) 의 *feature toggle* 을 도입해요 — Spring profile + `@ConditionalOnProperty` 기반이에요. `app.features.<X>=false` 한 줄로 도메인 전체를 비활성할 수 있어요.

Leaf 모듈 (의존을 받지 않는 모듈) 은 단순 `ConditionalOnProperty` 로 처리해요. Non-leaf 모듈 (의존을 받는 모듈) 은 의존 측에서 `ObjectProvider<Port>` 로 lazy 의존 — toggle off 시에도 컴파일 / 부팅이 OK 예요.

---

## 배경

본 template 은 SaaS 백엔드의 **공통 baseline** 이에요 — 결제 / IAP / 푸시 / 이메일 / 2FA / audit / 비밀번호 정책 / billing notification 등 거의 모든 도메인을 internal 로 가지고 있어요. 단점: **작은 비즈니스가 가져갔을 때 미사용 도메인이 부담**이 돼요.

사용자 의도:
- 결제만 / 푸시만 / 인증만 등 **선택적 사용** 이 가능해야 해요
- "lite" (작은 비즈니스) vs "full" (큰 기업) 두 변형으로 나뉘어요
- 본인 비즈니스에 맞게 cherry-pick 할 수 있어야 해요

본 ADR 가 **feature toggle 메커니즘** 을 결정합니다.

---

## 옵션 비교

### Option A — Spring profile + `@ConditionalOnProperty`
- `app.features.<domain>=true|false` properties
- Bean 등록 시 `@ConditionalOnProperty(prefix="app.features", name="<domain>", havingValue="true", matchIfMissing=true)` 분기
- ✅ 같은 source code, 환경 설정만 다름 — 구현 단순
- ✅ 사용자 부담 0 (`.env` 1 line 토글)
- ✅ Spring 의 idiomatic 패턴
- ❌ jar 안에 모든 코드 포함 (jar 크기 ↑)
- ❌ 미사용 의존성 (FCM / Resend / etc.) 도 classpath 에 남아요
- ❌ DB schema (V010~V016 — billing, audit, notification) 그대로 생성 — 운영자 무시 가능
- 적용 모듈: payment / iap / push / email / 2FA / audit / billing-notification

### Option B — Gradle module exclusion (subset build)
- `bootstrap/build.gradle` 에서 implementation project 의존을 conditional 추가
- 예: `if (rootProject.ext.features.payment) implementation ':core:payment-impl'`
- ✅ jar 크기 절감 (의존 제거)
- ✅ classpath 깨끗
- ❌ 코드 컴파일 분기 복잡 — CI 가 모든 조합 (2^8 = 256) 검증해야 (실현 X)
- ❌ ArchUnit 룰 위반 가능성 (의존 제거 시 import 깨짐)
- ❌ core-billing-api 가 다른 도메인에서 import 되면 제거 시 build 깨짐

### Option C — `factory feature toggle <name>` 명령 (자동 source 제거)
- 사용자가 `<repo> feature disable payment` 명령 → 자동 git rm + sed import 정리 + DB 마이그레이션 제거
- ✅ 가장 깔끔한 결과 (jar / source / DB 모두 정합)
- ❌ 자동화 복잡 + 테스트 부담 (lite vs full 매트릭스 폭증)
- ❌ 위험 — 실수 시 복구 어려움 (git rm 후 build 깨짐)
- ❌ 파생 레포 fork 후 사용자 코드 추가된 상태에서 toggle 시 충돌

### Option D — 별도 template repo (lite / full)
- `template-spring-lite` / `template-spring` 두 레포 운영
- ✅ 각 레포 단순
- ❌ 두 레포 sync 부담 (공통 변경 시 두 번)
- ❌ 사용자가 도중 변형 X (fork 시점에 결정 lock)

---

## 결정

**Option A 채택** — ConditionalOnProperty 기반 feature toggle.

### 결정 근거

| 기준 | A | B | C | D |
|---|---|---|---|---|
| 구현 단순도 | ✅ | ❌ | ❌ | ❌ |
| 사용자 부담 | 0 | 중 | 중 | 큼 (fork 결정) |
| 코드 분기 | 0 | 큰 | 큰 | 0 (각 레포) |
| 실수 위험 | 낮음 | 중 | 큼 | 낮음 |
| 운영 변경 | `.env` 토글 | gradle | git/sed | fork |
| **점수** | **A 압승** | | | |

Option A 의 단점 (jar 크기 / 미사용 의존성 / 미사용 schema) 는 본 template 의 사용 컨텍스트 (소규모 SaaS 출시) 에서 무시 가능 — jar 100MB / 미사용 schema row 0 = 운영 부하 0.

---

## 결정 — 토글 가능한 모듈

> 📌 **적용 범위**: 7 도메인 모두 안전 토글 가능. non-leaf 모듈은 의존 측에서 ObjectProvider 로 lazy 의존, leaf 모듈은 단순 ConditionalOnProperty.

### 토글 적용 도메인 (✅)

| Feature flag | Mechanism | default | 효과 |
|---|---|---|---|
| `app.features.audit` | `@ConditionalOnProperty` | true | AuditPort / AuditAspect 미등록 |
| `app.features.push` | `@ConditionalOnProperty` | true | PushPort 미등록 (NoOp 도 X) |
| `app.features.billing-notification` | `@ConditionalOnExpression` (`app.features.billing-notification` AND `app.billing.notification.enabled`) | true | 두 flag 모두 true 일 때 listener 등록, 한쪽이라도 false 면 미등록 |
| `app.features.password-policy` | `@ConditionalOnProperty` | true | PasswordValidator 미등록 |
| `app.features.email` | `@ConditionalOnProperty` | true | EmailPort 미등록 (auth 가 ObjectProvider 로 lazy 의존, 메일 발송만 silent skip) |
| `app.features.payment` | `@ConditionalOnProperty` | true | PaymentPort 미등록. BillingServiceImpl 호출 시 `CommonError.FEATURE_DISABLED` (CMN_009) throw |
| `app.features.iap` | `@ConditionalOnProperty` | true | IapPort 미등록. BillingServiceImpl 호출 시 CMN_009 throw |
| `app.features.2fa` | `@ConditionalOnExpression` | true | TwoFactorService 미등록. AuthServiceImpl 호출 시 CMN_009 throw |

### 의존 그래프 + lazy 패턴

`app.features.<X>=false` 시 의존 모듈의 처리:

```
auth-impl  EmailVerificationService → ObjectProvider<EmailPort>     → null 이면 silent skip
auth-impl  PasswordResetService     → ObjectProvider<EmailPort>     → null 이면 silent skip
auth-impl  AuthServiceImpl          → ObjectProvider<TwoFactorService> → null 이면 CMN_009
billing    BillingServiceImpl       → ObjectProvider<PaymentPort>   → null 이면 CMN_009
billing    BillingServiceImpl       → ObjectProvider<IapPort>       → null 이면 CMN_009
```

Email 만 silent skip 인 이유: 기존 정책 (이메일 발송 실패가 가입을 막지 않음, ADR-024) 과 정합해요. 결제/IAP/2FA 는 명시적 throw — 사용자가 disabled 인지 확인할 수 있어요.

### 자기검증

- `bootstrap/src/test/java/.../FeatureToggleTest` — 6 도메인 동시 비활성 + 부팅 OK + 5 Port bean 미등록 (Testcontainers + @SpringBootTest, 6 test)
- 패턴 분류:
  - **Leaf 모듈** (의존을 받지 않는 모듈): `@ConditionalOnProperty` 만으로 안전하게 토글돼요
  - **Non-leaf 모듈** (의존을 받는 모듈): 의존 측에서 `ObjectProvider<Port>` 로 lazy 의존 → toggle off 시에도 컴파일 / 부팅이 OK 예요
- billing-notification + password-policy 도 `FeatureToggleTest` 에서 *이미 검증 완료* 했어요 (line 88-99 의 `SubscriptionNotificationListener` / `PasswordValidator` bean 미등록 검증)

### 비활성 시 동작
- Bean 등록이 안 돼요 → 의존하는 endpoint 가 자동으로 사라져요 (Spring conditional)
- DB schema 는 그대로 생성돼요 (V스크립트 적용) — 미사용 테이블 0 row, 운영 영향 X
- jar 크기 변화는 없어요 (코드는 모두 포함되고 conditional 만 false)

---

## DB schema 정책 (미사용 모듈)

미사용 도메인의 V스크립트도 그대로 적용돼요. 사용자가 schema 분리를 원하면 Phase 5 후속 작업으로 가능해요:
- 각 도메인의 V스크립트를 별도 location 으로 분리
- `@ConditionalOnProperty` 가 Flyway location 을 동적으로 결정

본 ADR 의 scope 밖이에요 — 추후 별도 ADR 에서 다뤄요.

---

## `factory feature` 명령 설계

```bash
<repo> feature list          # 토글 가능한 모듈 + 현재 상태
<repo> feature disable 2fa   # .env 의 APP_FEATURES_2FA=false 자동 추가
<repo> feature enable iap    # .env 의 APP_FEATURES_IAP=true (또는 unset)
```

### 동작
1. `.env` + `.env.prod` **둘 다** 동시 변경 — 로컬/운영 일관성 강제 (사용자 명시: "로컬 허용 / 운영 비허용 = 혼란")
2. 변경 후 `<repo> local server-test` 자동 실행 — 부팅 검증
3. 부팅 로그에 disabled feature 명시 (`INFO ... feature disabled: 2fa`)

### 검증 (Phase 5 후속 구현 시)
- `<repo> feature list` → 표 출력 (모듈 / 활성 / `.env` line)
- `<repo> feature disable 2fa` → /me/2fa/setup 호출 시 404
- `<repo> local api-test` 가 disabled feature 의 step 자동 SKIP

---

## 사용자 비즈니스 시나리오

### Lite — 결제 없는 SaaS (블로그, 커뮤니티 등)
```bash
APP_FEATURES_PAYMENT=false
APP_FEATURES_IAP=false
APP_FEATURES_BILLING_NOTIFICATION=false
APP_FEATURES_2FA=false
APP_FEATURES_AUDIT=false
# 활성 = auth, user, device, push, email, storage
```

### Full — 모든 도메인 활성
```bash
# (default — 어떤 flag 도 .env 에 없음 = matchIfMissing=true)
```

### Mid — 결제 + 이메일만
```bash
APP_FEATURES_IAP=false
APP_FEATURES_PUSH=false
APP_FEATURES_2FA=false
APP_FEATURES_AUDIT=false
APP_FEATURES_BILLING_NOTIFICATION=false
# 활성 = auth, user, device, email, payment, billing
```

---

## UI 페이지 (사용자 의문)

본 template 은 **백엔드 only** — UI 페이지 (admin / 사용자 toggle UI) 는 frontend 영역이에요. Flutter 또는 별도 admin 콘솔에서 구현해요. 본 ADR 의 scope 밖입니다.

기능 활성 상태 조회는 backend `/actuator/info` 또는 `/api/admin/features` (Phase 5 후속) 로 노출할 수 있어요.

---

## 후속 작업 (별도 사이클)

### 구현 단계
1. 각 도메인의 `*AutoConfiguration` 에 `@ConditionalOnProperty(prefix = "app.features", name = "<domain>", matchIfMissing = true)` 추가
2. `factory feature list/enable/disable` 명령 구현
3. `.env.example` / `.env.prod.example` 에 feature flag 섹션 추가 (default 주석 처리)
4. `tools/api-smoke-test.sh` 의 step 들이 disabled feature 인식 후 SKIP

### 검증 단계
- 부팅 로그에 disabled feature 명시
- `<repo> local server-test` 가 모든 feature 조합에서 PASS
- `<repo> local api-test` 가 disabled feature 의 endpoint skip

### Lite 변형 별도 sample 레포
- `template-spring-lite-example` (Phase 6 후 별도 작업) — 결제 없는 lite 변형 검증 레포

---

## Alternatives 재검토

| 대안 | 검토 결과 |
|---|---|
| Compile-time exclusion | Option B — CI 매트릭스 폭증으로 실현 X |
| Source removal command | Option C — 위험 + 복구 어려움 |
| 별도 template repo | Option D — sync 부담 + fork 시점 lock |
| Java module system (JPMS) | OSGi 수준 isolation 필요 — 본 template 의 monolith 규모 외 |

**Option A 의 jar 크기 단점은 무시 가능 (~50-100MB), 운영 부하 X**. 사용자 비즈니스의 실 needs 와 일치.

---

## 관련 문서

- `docs/production/operations/feature-toggle.md` (예정) — 운영자 가이드
- [`ADR-019 · billing/iap/payment 분리`](./adr-019-billing-iap-payment-separation.md)
- [`ADR-024 · core-email 추출`](./adr-024-email-domain-extraction.md)
- [`ADR-031 · 사용자 알림 toggle`](./adr-031-notification-preferences.md) — 본 ADR 의 user-level 변형
