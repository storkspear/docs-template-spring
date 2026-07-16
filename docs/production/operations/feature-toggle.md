# Feature Toggle — Lite 모드

> **유형**: How-to · **독자**: 운영자·템플릿 사용자 (Level 2.5) · **읽는 시간**: ~7분

이 문서는 도메인별 feature toggle 인 Lite 모드의 운영자 가이드예요. 결제를 안 받는 인디 앱이라면 payment·iap 같은 모듈을 꺼서 가볍게 부팅할 수 있어요. 설계 근거는 [`ADR-034 · Lite 모드 설계`](../../philosophy/adr-034-feature-toggle-lite-mode.md) 에 정리돼 있어요.

---

## 1. 핵심 — opt-out 모델

모든 feature 의 기본값은 활성이에요. `.env` 에 적지 않으면 활성이고, 명시적으로 `false` 라고 적은 것만 비활성됩니다. 코드에서는 각 모듈의 AutoConfiguration 이 `@ConditionalOnProperty(... matchIfMissing = true)` 로 이 동작을 강제해요.

```bash
# 활성 — 기본값이라 적지 않아도 됨
# APP_FEATURES_PAYMENT=true

# 비활성
APP_FEATURES_PAYMENT=false
```

비활성으로 부팅하면 해당 도메인의 AutoConfiguration 이 등록되지 않고, 그 도메인에 의존하던 endpoint 도 함께 사라져요.

---

## 2. 토글 가능 모듈

`<repo> local feature` 명령이 관리하는 모듈은 다음 여덟 개예요. 모두 ObjectProvider 로 lazy 의존하도록 설계돼서 꺼도 부팅이 깨지지 않아요.

| Feature | 환경 변수 | 모듈 | 끄면 생기는 일 |
|---|---|---|---|
| audit | `APP_FEATURES_AUDIT` | core-audit-impl | `@Audited`·`@AdminOnly` 자동 감사가 동작하지 않음 |
| push | `APP_FEATURES_PUSH` | core-push-impl | FCM 푸시 발송이 동작하지 않음 |
| email | `APP_FEATURES_EMAIL` | core-email-impl | 메일 발송만 조용히 건너뜀 (가입은 정상) |
| payment | `APP_FEATURES_PAYMENT` | core-payment-impl | 결제 호출 시점에 `CMN_009 FEATURE_DISABLED` |
| iap | `APP_FEATURES_IAP` | core-iap-impl | IAP 호출 시점에 `CMN_009 FEATURE_DISABLED` |
| 2fa | `APP_FEATURES_2FA` | core-auth-impl 의 TwoFactorService bean | 2FA endpoint 호출 시점에 `CMN_009 FEATURE_DISABLED` |
| billing-notification | `APP_FEATURES_BILLING_NOTIFICATION` | core-billing-impl listener | 갱신 알림 발송이 동작하지 않음 |
| password-policy | `APP_FEATURES_PASSWORD_POLICY` | common-web SecurityValidationAutoConfiguration | `@ValidPassword` 정책 검증을 무시 |

환경 변수 `APP_FEATURES_PAYMENT` 는 Spring 설정 `app.features.payment` 로 바인딩돼요. `2fa` 와 `billing-notification` 은 속성 이름에 숫자·논리곱이 들어가 `@ConditionalOnExpression` 으로 같은 효과를 내요.

> phone-auth·sms 도 코드 수준에서는 같은 `app.features.*` 토글을 가지지만, `feature` 명령의 관리 목록에는 아직 들어 있지 않아요. 이 둘은 `.env` 를 직접 편집해 끄고, 점유인증을 안 쓰면 `V015` 마이그레이션 파일까지 지워요 ([`phone-auth-and-sms.md`](../../api-and-functional/functional/phone-auth-and-sms.md) 참고).

### 비활성일 때의 응답

끈 모듈은 두 부류로 갈려요. 하나는 endpoint 자체에는 영향이 없고 부수 효과만 빠지는 부류, 다른 하나는 호출 시점에 `503` 을 돌려주는 부류예요.

| 모듈 | 호출 시점 응답 | 이유 |
|---|---|---|
| audit·push·billing-notification·password-policy | endpoint 영향 없음, 부수 효과만 빠짐 | listener·aspect·validator 가 등록되지 않음 |
| email | endpoint 는 `200 OK`, 메일만 미수신 | 가입 흐름 보호 (ADR-024 정합) |
| payment·iap·2fa | `503 CMN_009 FEATURE_DISABLED` (details 에 feature 이름) | 클라이언트가 비활성을 명시적으로 인지 |

payment·iap·2fa 는 BillingServiceImpl·AuthServiceImpl 이 ObjectProvider 로 받은 bean 이 없을 때 `FEATURE_DISABLED` 를 던져요. email 은 auth 의 EmailVerificationService 가 EmailPort 를 lazy 로 의존해서, 발송만 건너뛰고 가입은 그대로 통과해요.

---

## 3. 사용법 — `feature` 명령

토글은 `<repo> local feature` 명령으로 다뤄요. 직접 `.env` 를 편집해도 효과는 같지만, 이 명령은 환경 파일을 한꺼번에 맞춰 줘요.

```bash
# 토글 가능 모듈과 현재 상태 보기
<repo> local feature list

# 비활성
<repo> local feature disable payment

# 활성
<repo> local feature enable payment
```

`enable`·`disable` 은 레포에 존재하는 환경 파일을 모두 동시에 바꿔요. `.env` 와 `.env.prod` 가 둘 다 있으면 양쪽에 같은 값을 적고, `.env.dev` 가 있으면 그것도 함께 맞춰요. 한쪽만 바꾸면 로컬과 운영의 동작이 갈려 디버깅 노이즈가 생기기 때문에, 일관성을 강제하는 거예요 (ADR-034). 아직 init 하지 않아 파일이 없는 환경은 건너뛰고 그 사실을 출력으로 알려 줘요.

> 운영 전용 경로는 막혀 있어요. `<repo> prod feature` 를 부르면 거부하고 `local feature` 로 안내해요. 토글은 본래 모든 환경에 동시 적용되는 변경이라 운영만 따로 바꾸는 길을 닫아 둔 거예요.

---

## 4. 시나리오

### 결제 없는 앱 — 블로그·커뮤니티·SNS

결제·구독이 없는 서비스라면 payment·iap·billing-notification·audit 를 끄고 인증과 알림만 남겨요.

```bash
APP_FEATURES_PAYMENT=false
APP_FEATURES_IAP=false
APP_FEATURES_BILLING_NOTIFICATION=false
APP_FEATURES_AUDIT=false
# 활성으로 남는 것: auth · user · device · push · email · storage · 2fa · password-policy
```

부팅 뒤 아래로 확인해요.

```bash
<repo> local server-test                     # 부팅 성공
curl -X POST .../payment/verify              # 503 CMN_009
curl -X POST .../iap/verify                  # 503 CMN_009
curl -X POST .../auth/email/signup ...       # 200 OK
```

### 결제 + 이메일만 — 단순 SaaS

푸시·2FA·감사·알림이 필요 없는 단순 결제 서비스라면 결제와 이메일만 남겨요.

```bash
APP_FEATURES_IAP=false
APP_FEATURES_PUSH=false
APP_FEATURES_2FA=false
APP_FEATURES_AUDIT=false
APP_FEATURES_BILLING_NOTIFICATION=false
# 활성으로 남는 것: auth · user · device · email · payment · password-policy
```

### 전부 켜기 — 기본값

모든 도메인을 쓰는 경우엔 `.env` 에 `APP_FEATURES_*` 를 한 줄도 적지 않아도 돼요. 기본값이 전부 활성이거든요.

```bash
# .env 에 APP_FEATURES_* 가 한 줄도 없어도 모두 활성
```

---

## 5. 변경 후 검증

토글을 바꾼 뒤에는 부팅과 e2e 두 가지를 확인해요.

```bash
# 1. 부팅 검증
<repo> local server-test

# 2. e2e — 끈 모듈의 step 이 자동으로 건너뛰는지 확인
<repo> local api-test
```

`api-test` 는 `.env` 의 `APP_FEATURES_<NAME>` 값을 직접 읽어, 끈 모듈에 묶인 step 을 건너뛰어요. billing-notification·audit 를 끈 상태라면 출력은 이런 모양이에요.

```text
✓  1/11  회원가입       PASS
⊘  6/11  알림 toggle    SKIP (feature APP_FEATURES_BILLING_NOTIFICATION=false)
⊘ 11/11  Audit 로그     SKIP (feature APP_FEATURES_AUDIT=false)
```

지금 smoke-test 가 환경 변수를 보고 자동으로 건너뛰는 step 은 billing-notification(6번)과 audit(11번) 두 가지예요. payment·iap·email·2fa step 은 토글 연동이 후속 작업으로 남아 있어, 끈 상태로 돌리면 SKIP 이 아니라 실제 응답에 따라 결과가 갈려요. 이 모듈들은 위 §4 처럼 `curl` 로 `503` 을 직접 확인하는 게 확실해요.

---

## 6. 트러블슈팅

### A. 비활성했는데 endpoint 가 200 을 반환해요

변경 뒤 아직 부팅을 다시 하지 않은 상태예요. `.env` 변경은 부팅 시점에만 반영돼요. `<repo> local server-test` 로 다시 띄우거나 docker compose 를 재시작하세요.

### B. 활성인데 endpoint 가 404 예요

다른 의존성이 빠졌을 가능성이 커요. 예를 들어 payment 는 활성이지만 `APP_PAYMENT_PORTONE_API_V1_KEY` 가 비어 있을 수 있어요. 부팅 로그를 확인해, `StubPaymentAdapter` 가 등록됐는지 아니면 PaymentAutoConfiguration 자체가 등록 안 됐는지를 구분하세요.

### C. 부팅이 실패해요 — `Required bean of type ... not available`

다른 도메인이 끈 모듈의 bean 을 직접 의존하고 있어요. 의존하는 쪽을 ObjectProvider 로 바꾸거나, 그 모듈도 함께 끄세요. 후속 작업 목록은 ADR-034 에 있어요.

### D. `.env` 와 `.env.prod` 가 서로 달라요

직접 편집하다 한쪽만 바꿨을 때 생기는 drift 예요. `<repo> local feature <action> <name>` 을 쓰면 존재하는 환경 파일을 한꺼번에 맞춰 줘서 이런 어긋남을 막아요.

---

## 7. 운영 적용

feature flag 변경은 코드 변경이 아니라 환경 변수 변경이라, git push 와는 별개예요. 운영에 적용하려면 세 단계를 거쳐요.

1. `.env.prod` 를 고쳐요. `<repo> local feature disable <name>` 이 이미 자동으로 처리해 줘요.
2. GitHub Secrets 를 갱신해, 바뀐 `APP_FEATURES_*` 를 반영해요.
3. `<repo> prod deploy` 로 새 환경 변수를 실어 다시 부팅해요.

> `.env.prod` 만 고치고 GitHub Secrets push 를 잊으면, GHA 가 옛 값으로 부팅해요. setup 스크립트의 secrets sync 를 쓰면 이 누락을 막을 수 있어요.

---

## 8. 관련 문서

- [`ADR-034 · Lite 모드 설계`](../../philosophy/adr-034-feature-toggle-lite-mode.md) — 토글 메커니즘과 환경 파일 동시 변경 근거
- [`ADR-019 · billing·iap·payment 분리`](../../philosophy/adr-019-billing-iap-payment-separation.md) — 결제 도메인 경계
- [`ADR-031 · 사용자 알림 toggle`](../../philosophy/adr-031-notification-preferences.md) — 본 문서의 user-level 변형
- `tools/feature.sh` — `feature` 명령 구현
- `tools/api-smoke-test.sh` — 끈 모듈의 step 자동 SKIP
