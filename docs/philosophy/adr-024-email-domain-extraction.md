# ADR-024 — core-email 도메인 추출

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~6분

**상태**: 채택 (2026-05-02)
**전제**: ADR-019 (도메인 횡단 기능 분리), ADR-023 (결제 알림 listener)
**연관**: K-refactor 사이클 — email 인프라를 별도 모듈로

---

## 결론부터

이메일 발송 (`EmailPort` + `ResendEmailAdapter` + `LoggingEmailAdapter` + `EmailException`) 을 `core-auth` 에서 분리해 `core-email-api` + `core-email-impl` 별도 모듈로 추출합니다.

이메일은 *인증 도메인 전용* 이 아닌 *도메인 횡단 기능* 이라 — 결제 실패 알림 / 운영 공지 / 비밀번호 변경 알림 등 다른 도메인에서도 자유롭게 쓸 수 있어야 해요. ArchUnit 룰 r3 (`core-*-impl` 끼리 import 금지) 위반 없이.

핵심 변경:
- 신규 모듈 2개 (`core-email-api`, `core-email-impl`) + 클래스 7개 이동
- `AuthError.EMAIL_DELIVERY_FAILED` (ATH_006) → `EmailError.EMAIL_DELIVERY_FAILED` (EMAIL_001) 로 이전
- `core-auth-impl` 은 `core-email-api` 의존 추가만, 외부 인터페이스 (REST / env) 는 0 변경

---

## 왜 이 고민이 시작됐나

기존 EmailPort 와 ResendEmailAdapter / LoggingEmailAdapter / ResendProperties 가 모두 `core-auth` 안에 있었어요:

```
core-auth-api/.../EmailPort.java                       ← interface
core-auth-impl/.../email/ResendEmailAdapter.java       ← Resend
core-auth-impl/.../email/LoggingEmailAdapter.java      ← dev fallback
core-auth-impl/.../email/ResendProperties.java         ← config
```

다른 도메인 (예: billing 의 결제 실패 알림) 이 이메일 보내려면 두 경로 다 막혀요:

- `core-billing-impl` 이 `core-auth-api` 의존 (EmailPort 사용) — *원리상 가능* 하지만 *billing 이 auth 의 부속* 처럼 보이는 잘못된 구조
- `core-billing-impl` 이 `core-auth-impl` 의존 → ❌ ArchUnit r3 위반 (`core-*-impl` 끼리 import 금지)

이메일은 **도메인 횡단 기능** (auth / billing / 운영 공지 등 어디서나 사용). auth 안에 있을 이유가 없어요.

---

## 고민했던 대안들

> **대안 분석의 한계** — 본 ADR 은 *한 방향적 결정* 이에요. 이메일을 *cross-cutting 기능* 으로 다루려면 *별도 모듈 분리* 외 다른 합리적 경로가 없어요. 그래서 형식적 대안 비교보다는 *왜 다른 형태가 부적합한가* 를 짧게 기록.

### 대안 1 — auth 안에 두고 cross-cutting 표시

`core-auth-api` 안에 `EmailPort` 를 두되 *주석 / 문서로 cross-cutting* 표시. billing 등 다른 도메인이 *명시적으로 core-auth-api 의존* 받게 함.

- ❌ *명시적 의존* 으로도 *billing 이 auth 의 부속* 인상 사라지지 않음
- ❌ ArchUnit 룰이 *의도* 를 인식 못 함 (코드 의존 그래프만 봄)
- ❌ 이메일 외 *push 알림* 등 다른 cross-cutting 기능도 같은 문제 반복

### 대안 2 — 별도 microservice (REST 호출)

이메일 발송을 별도 서비스로 분리해 HTTP 호출.

- ❌ 솔로 인디 스케일에서 과도. 운영 인스턴스 + 모니터링 + 배포 부담 증가
- ❌ 트랜잭션 경계 복잡화 (이메일 실패 시 transaction rollback 정책)
- ❌ 본 template 의 *모듈러 모놀리스* 원칙 ([`ADR-001`](./adr-001-modular-monolith.md)) 위반

### 채택 — `core-email-api` + `core-email-impl` 별도 모듈

ADR-001 의 모듈러 모놀리스 + ADR-003 의 api/impl 분리 패턴을 그대로 적용. 이메일은 *별도 도메인* 으로 격상.

---

## 결정

**`core-email-api` + `core-email-impl` 별도 모듈 추출**:

```
core-email-api/
  └─ com.factory.core.email.api/
      ├─ EmailPort.java              ← interface (auth 에서 이동)
      └─ exception/
          ├─ EmailError.java         ← EMAIL_DELIVERY_FAILED (EMAIL_001)
          └─ EmailException.java     ← 신규

core-email-impl/
  └─ com.factory.core.email.impl/
      ├─ ResendEmailAdapter.java     ← auth/email/ 에서 이동 (EmailException throw)
      ├─ LoggingEmailAdapter.java    ← 동
      ├─ ResendProperties.java       ← 동
      └─ EmailAutoConfiguration.java ← 신규 (AuthAutoConfig 의 bean 등록 옮김)
```

`core-auth-impl` → `core-email-api` 의존 추가. 다른 도메인 (billing 등) 도 자유롭게 EmailPort 사용 가능.

---

## ADR-019 와의 정합

ADR-019 = billing/iap/payment 분리 결정 (channel-specific vs policy layer). 같은 정신:

| ADR-019 결정 | ADR-024 결정 |
|---|---|
| billing (정책) / iap (Apple/Google) / payment (PG) 분리 | auth (인증) / email (발송 채널) 분리 |
| 채널 추가 시 (Stripe 등) 도메인 신규 | 발송 채널 추가 시 (SMTP/SES 등) 어댑터 추가 |
| 정책 layer 가 채널 무관 | auth/billing 등 호출 측이 발송 채널 무관 |

---

## 이 선택이 가져온 것

### 긍정

- **도메인 횡단 활용** — billing 의 결제 실패 알림 ([`ADR-025`](./adr-025-billing-notification-email-channel.md)) 가 자연스럽게 EmailPort 사용. auth 의존 없음
- **EmailException 도메인 분리** — 이메일 발송 실패는 `EmailException(EmailError.EMAIL_DELIVERY_FAILED, cause)` 로 처리:
  ```java
  throw new EmailException(EmailError.EMAIL_DELIVERY_FAILED, cause);
  ```
  각 호출 도메인 (auth / billing) 이 필요 시 자기 도메인 exception 으로 wrap. 또는 그대로 propagate (BaseException 자식이라 ApiResponseAdvice 가 캐치)
- **환경변수 호환성** — `app.email.resend.*` properties 그대로 유지 (`RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, `RESEND_FROM_NAME` 등 .env 변수 변경 X). ResendProperties 의 패키지만 이동. ConfigurationPropertiesScan 이 자동 발견
- **운영 배포 영향 0** — 모듈 리팩터링이라 jar 안의 클래스 위치만 바뀌고 외부 인터페이스 (REST endpoint, env, 비즈동작) 동일
- **새 발송 채널 추가 단순** — SMTP / Gmail API / SES / SendGrid 등 추가 시 `core-email-impl` 에 어댑터 1개만 추가

### 부정

- **모듈 수 +2** — settings.gradle / bootstrap/build.gradle 갱신 필요. Gradle 빌드 시간 minor 증가
- **import 일괄 갱신** — `core-auth-impl` 의 모든 `EmailPort` import 변경 (`core-auth-api` → `core-email-api`)
- **테스트 fixture 위치 모호** — `EmailRecorder` / `InMemoryEmailAdapter` 가 현재는 `core-auth-api/testFixtures` 에 남아 있어 *테스트 fixture 도 email 도메인으로 이동* 이 자연스러움 (다음 사이클)

---

## 추출 작업 요약

1. **`core-email-api`** 신규 — `EmailPort` 이동, `EmailError`/`EmailException` 신규
2. **`core-email-impl`** 신규 — Resend/Logging adapter + Properties 이동, `EmailAutoConfiguration` 신규 (`META-INF/spring/...AutoConfiguration.imports` 등록)
3. **`core-auth-api`** — `EmailPort` 제거
4. **`core-auth-impl`** — `core-email-api` 의존 추가, import 일괄 변경, `AuthAutoConfiguration` 의 email bean 등록 제거 (`EmailAutoConfiguration` 으로 이전)
5. **`bootstrap`** — `core-email-impl` 의존 추가
6. **`settings.gradle`** — 새 모듈 등록
7. **테스트** — `ResendEmailAdapterTest`, `LoggingEmailAdapterTest` 도 `core-email-impl/test` 로 이동 (패키지 + import 갱신)

---

## ArchUnit 룰

기존 `r3 CORE_IMPL_MUST_NOT_DEPEND_ON_EACH_OTHER` 가 패턴 기반 (`core-*-impl` → `core-*-impl` 금지) 이라 자동 적용. 새 도메인 룰 추가 X.

`core-email-api` 는 모든 `core-*-impl` / `apps/*` 가 의존 가능. `core-email-impl` 은 `bootstrap` 만 직접 의존 (`core-*-impl` 끼리 의존 금지).

---

## 교훈

**도메인 횡단 기능은 별도 모듈로 격상해야 cross-cutting 의 자유도가 생긴다.** 처음에 *auth 안의 sub-feature* 로 보였던 이메일이 *billing 알림 / 운영 공지* 까지 확장 가능성이 보이는 순간 — 즉 *호출 측이 다양해지는 신호* 가 보일 때 — 별도 도메인으로 격상이 답이에요.

ArchUnit 의 패턴 기반 룰 (r3) 이 *도메인 경계* 를 자동 강제해 주기 때문에, 격상 의사결정은 *모듈 추가* 만으로 끝나고 추가 룰 작성이 필요 없어요. ADR-001 의 모듈러 모놀리스 + ADR-003 의 api/impl 분리 패턴을 *cross-cutting 도메인* 으로 그대로 확장한 사례.

---

## 안 다루는 범위 (다음 사이클)

- **SubscriptionNotificationListener 의 email 발송** — push + email 둘 다 발송하려면 UserPort 통한 email 조회 + 메시지 템플릿 분리. 별도 사이클.
- **Email contract test** — `core-email-api/testFixtures` 로 `EmailRecorder` 이동 + `InMemoryEmailAdapter` 추출. 현재는 `core-auth-api/testFixtures` 에 남음.
- **추가 발송 채널** — SMTP / Gmail API / SES / SendGrid 어댑터. 필요 시 `core-email-impl` 에 추가만.

---

## 관련 파일

신규:
- `core/core-email-api/build.gradle`
- `core/core-email-api/src/main/java/com/factory/core/email/api/EmailPort.java`
- `core/core-email-api/src/main/java/com/factory/core/email/api/exception/EmailError.java`
- `core/core-email-api/src/main/java/com/factory/core/email/api/exception/EmailException.java`
- `core/core-email-impl/build.gradle`
- `core/core-email-impl/src/main/java/com/factory/core/email/impl/ResendEmailAdapter.java`
- `core/core-email-impl/src/main/java/com/factory/core/email/impl/LoggingEmailAdapter.java`
- `core/core-email-impl/src/main/java/com/factory/core/email/impl/ResendProperties.java`
- `core/core-email-impl/src/main/java/com/factory/core/email/impl/EmailAutoConfiguration.java`
- `core/core-email-impl/src/main/resources/META-INF/spring/...AutoConfiguration.imports`
- `core/core-email-impl/src/test/.../ResendEmailAdapterTest.java`
- `core/core-email-impl/src/test/.../LoggingEmailAdapterTest.java`

수정:
- `settings.gradle` — 새 모듈 등록
- `bootstrap/build.gradle` — core-email-impl 의존
- `core/core-auth-api/.../EmailPort.java` — **삭제**
- `core/core-auth-impl/build.gradle` — core-email-api 의존 추가
- `core/core-auth-impl/.../AuthAutoConfiguration.java` — email bean / Resend property scan 제거
- `core/core-auth-impl/**/*.java` — `EmailPort` import 일괄 변경
