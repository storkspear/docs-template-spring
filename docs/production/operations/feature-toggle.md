<a id="feature-toggle--lite-모드"></a>

# Feature Toggle — Lite 모드

> **유형**: How-to · **독자**: 운영자·템플릿 사용자 (Level 2.5) · **읽는 시간**: ~7분

도메인 기능을 선택적으로 끄는 Lite 모드의 운영 가이드예요. 결제·푸시처럼 사용하지 않는 기능을 비활성화할 수 있어요. 설계 근거는 [ADR-034](../../philosophy/adr-034-feature-toggle-lite-mode.md)에 정리돼 있어요.

---

<a id="1-핵심--opt-out-모델"></a>

## 1. 핵심 — opt-out 모델

각 토글의 기본값은 활성이에요. 값을 생략하면 활성이고, 명시적으로 `false`를 설정하면 해당 자동 구성이나 빈을 등록하지 않아요.

```bash
# 기본값은 true예요.
# APP_FEATURES_PAYMENT=true

APP_FEATURES_PAYMENT=false
```

비활성화의 결과는 소비 경로에 따라 달라요. 컨트롤러도 등록되지 않는 기능은 정상적인 인증·요청 조건에서 404가 되고, 남은 서비스에서 빈 부재를 검사하는 경로는 503이 돼요. 감사·알림처럼 부수 효과만 생략하는 기능도 있어요. HTTP 필터가 먼저 요청을 거절하면 401·403·429 등 다른 응답을 받을 수 있어요.

---

## 2. 토글 가능 모듈

`<repo> local feature`는 다음 여덟 개를 관리해요. 내장 소비 코드는 선택 기능을 끈 상태도 고려하지만, 파생 앱이 구현 빈을 직접 주입하면 별도 점검이 필요해요.

| Feature | 환경 변수 | 주요 모듈 | 비활성화 결과 |
|---|---|---|---|
| audit | `APP_FEATURES_AUDIT` | core-audit-impl | 자동 감사 기록을 남기지 않아요 |
| push | `APP_FEATURES_PUSH` | core-push-impl | 푸시 발송 구성을 등록하지 않아요 |
| email | `APP_FEATURES_EMAIL` | core-email-impl | 메일 발송을 생략해요. 이메일 인증이 필요한 사용자 흐름은 영향을 받아요 |
| payment | `APP_FEATURES_PAYMENT` | core-payment-impl·core-billing-impl | 공유 PaymentController가 빠지고, 남은 결제 Port 소비 경로는 `CMN_009`를 반환해요 |
| iap | `APP_FEATURES_IAP` | core-iap-impl·core-billing-impl | 공유 IapController가 빠지고, 남은 IAP Port 소비 경로는 `CMN_009`를 반환해요 |
| 2fa | `APP_FEATURES_2FA` | core-auth-impl | TwoFactorService가 빠져 이를 요구하는 인증 경로가 `CMN_009`를 반환해요 |
| billing-notification | `APP_FEATURES_BILLING_NOTIFICATION` | core-billing-impl | 구독 갱신 알림 listener를 등록하지 않아요 |
| password-policy | `APP_FEATURES_PASSWORD_POLICY` | common-web | `@ValidPassword`의 비밀번호 정책 검증을 생략해요. 다른 입력 검증은 유지해요 |

`APP_FEATURES_PAYMENT`는 `app.features.payment`에 대응해요. 자동 구성은 `@ConditionalOnProperty` 또는 `@ConditionalOnExpression`으로 값을 확인해요.

phone-auth·sms도 코드에 토글이 있지만 `feature` 명령의 관리 목록에는 없어요. Spring 설정은 `app.features.phone-auth`·`app.features.sms`예요. 예를 들어 JVM 시작 옵션에 `-Dapp.features.phone-auth=false`를 지정할 수 있어요. 현재 환경 예시와 배포 목록에는 자동 연결되어 있지 않으므로 운영 컨테이너까지 전달할 경로를 따로 구성해요. 이미 적용된 `V015` 마이그레이션은 기능을 끄더라도 삭제하지 않아요. 자세한 범위는 [휴대폰 인증 문서](../../api-and-functional/functional/phone-auth-and-sms.md)를 참고해요.

### 비활성일 때의 응답

| 경로 | 비활성화 결과 |
|---|---|
| audit·push·billing-notification의 선택 소비 경로 | 주 작업은 계속하고 해당 부수 효과를 생략해요 |
| password-policy | 비밀번호 정책 검사만 생략해요 |
| email의 인증 코드·재설정 메일 요청 | 발송을 생략할 수 있어요. 요청 성공이 메일 수신이나 전체 인증 절차의 성공을 뜻하지는 않아요 |
| payment·iap 공유 컨트롤러 | 컨트롤러가 등록되지 않아요 |
| BillingServiceImpl의 남은 payment·iap 소비 경로 | `503 CMN_009 FEATURE_DISABLED`와 feature 이름을 반환해요 |
| AuthServiceImpl에서 TwoFactorService가 필요한 경로 | `503 CMN_009 FEATURE_DISABLED`를 반환해요 |

현재 이메일 회원가입은 코드 검증으로 받은 `proofToken`이 필요해요. 운영에서 email을 끄면 신규 사용자가 코드를 받지 못해 가입 절차를 완료할 수 없어요. 로컬의 코드 반환 옵션이나 이미 발급된 proof로 동작하는 경우를 운영의 정상 가입으로 해석하지 않아요.

---

<a id="3-사용법--feature-명령"></a>

## 3. 사용법 — `feature` 명령

```bash
<repo> local feature list
<repo> local feature disable payment
<repo> local feature enable payment
```

`enable`·`disable`은 현재 존재하는 `.env`·`.env.prod`·`.env.dev`를 함께 수정해요. 아직 생성되지 않은 파일은 건너뛰고 알려 줘요. 환경 간 같은 토글 값을 유지하려는 운영 정책이며, 실행 중인 프로세스나 원격 GitHub Secrets를 즉시 바꾸는 명령은 아니에요.

`<repo> prod feature`는 거부하고 `local feature`를 안내해요. 원격 적용은 [운영 적용](#7-운영-적용)의 주입 경로 확인과 재배포가 필요해요.

---

## 4. 시나리오

<a id="결제-없는-앱--블로그커뮤니티sns"></a>

### 결제 없는 앱 — 블로그·커뮤니티·SNS

결제·구독을 사용하지 않으면 관련 기능을 끌 수 있어요. 감사 기록을 남길지는 서비스 운영 요구에 맞춰 따로 판단해요.

```bash
APP_FEATURES_PAYMENT=false
APP_FEATURES_IAP=false
APP_FEATURES_BILLING_NOTIFICATION=false
# 감사 기록도 사용하지 않을 때만 설정해요.
# APP_FEATURES_AUDIT=false
```

부팅 후 공유 payment·iap 경로가 등록되지 않았는지 확인해요. 가입 검증은 이메일 코드 발급→검증→proofToken을 포함한 가입까지 진행하고, 성공 상태는 201로 확인해요. 남은 서비스의 Port 호출을 따로 검증할 때만 `CMN_009`를 기대해요.

<a id="결제--이메일만--단순-saas"></a>

### 결제 + 이메일만 — 단순 SaaS

푸시·2FA·갱신 알림을 쓰지 않는 구성을 예로 들면 다음과 같아요. 기존 2FA 사용자가 있다면 비활성화 전에 로그인 영향을 확인해요.

```bash
APP_FEATURES_IAP=false
APP_FEATURES_PUSH=false
APP_FEATURES_2FA=false
APP_FEATURES_BILLING_NOTIFICATION=false
# 감사 기록도 사용하지 않을 때만 설정해요.
# APP_FEATURES_AUDIT=false
```

기능을 켰다는 사실만으로 실제 공급자 연동이 준비되지는 않아요. 결제·이메일 자격증명과 어댑터 등록 상태도 확인해요.

<a id="전부-켜기--기본값"></a>

### 전부 켜기 — 기본값

`APP_FEATURES_*`를 생략하면 각 기능의 토글은 활성으로 평가해요. 기존에 적힌 `false` 값을 지우거나 `enable` 명령으로 바꾼 뒤 다시 부팅해요.

---

## 5. 변경 후 검증

```bash
<repo> local server-test
<repo> local api-test
```

`server-test`는 부팅·서버 연결을, `api-test`는 smoke 시나리오를 확인해요. 데이터 생성과 외부 연동이 포함될 수 있으므로 테스트 전용 환경을 사용해요.

현재 smoke-test의 16개 단계 중 토글을 직접 보고 건너뛰는 단계는 billing-notification(6번)과 audit(11번)이에요. 모든 비활성 기능이 자동으로 SKIP되는 것은 아니에요. 결과를 읽을 때 PASS·FAIL·SKIP을 구분하고, 끈 기능의 계약은 해당 경로를 따로 확인해요.

---

## 6. 트러블슈팅

### A. 비활성했는데 endpoint 가 200 을 반환해요

부수 효과만 생략하는 기능이면 정상일 수 있어요. 컨트롤러가 빠져야 하는 기능이라면 실행 프로세스에 주입된 설정과 재시작 여부를 확인해요. 환경 파일을 고친 것만으로 실행 중인 프로세스가 바뀌지는 않아요.

### B. 활성인데 endpoint 가 404 예요

요청 URL·앱 slug·실제 토글 값과 컨트롤러 등록 조건을 확인해요. payment 키가 비어 있다는 이유만으로 공유 PaymentController가 사라지는 것은 아니에요. 기능이 켜져 있지만 자격증명이 없으면 StubPaymentAdapter가 등록될 수 있고, 실제 결제 호출에서 설정 부재 오류를 반환해요.

<a id="c-부팅이-실패해요--required-bean-of-type--not-available"></a>

### C. 부팅이 실패해요 — `Required bean of type ... not available`

파생 코드가 선택 기능의 빈을 직접 의존하는지 확인해요. 그 기능이 선택 사항인지부터 판단한 뒤 lazy 주입·조건부 등록 또는 명시적인 필수 의존성으로 정리해요. 단순히 오류를 없애려고 필요한 기능을 함께 끄지는 않아요.

### D. `.env` 와 `.env.prod` 가 서로 달라요

직접 편집한 환경 파일끼리 값이 달라졌는지 확인해요. `local feature`는 존재하는 파일을 함께 수정해 운영 정책을 맞춰 줘요. 이후 실제 배포 환경에도 같은 값이 전달됐는지 확인해요.

---

## 7. 운영 적용

기본 정책은 local·dev·prod의 토글 값을 함께 유지하는 거예요. 현재 명령이 관리하는 범위는 로컬 환경 파일까지이므로 다음 연결을 확인해야 해요.

1. `<repo> local feature disable <name>` 또는 `enable`로 존재하는 환경 파일을 맞춰요.
2. 해당 토글이 GitHub Secrets·Actions export·Kamal 환경 변수 목록을 통해 실제 컨테이너까지 전달되는지 확인해요. 현재 `APP_FEATURES_*`는 이 경로에 일괄 등록돼 있지 않아요.
3. 필요한 주입 경로를 구성한 뒤 재배포하고, 실제 환경과 endpoint 동작을 확인해요.

환경 파일 수정이나 일반 secrets sync만으로 미등록 토글까지 자동 전달된다고 가정하지 않아요. 주입 경로를 추가해야 한다면 관련 설정 파일 변경도 배포에 포함해요.

---

## 8. 관련 문서

- [ADR-034 · Lite 모드 설계](../../philosophy/adr-034-feature-toggle-lite-mode.md) — 토글과 환경 파일 동시 변경 근거
- [ADR-019 · billing·iap·payment 분리](../../philosophy/adr-019-billing-iap-payment-separation.md) — 결제 도메인 경계
- [ADR-031 · 사용자 알림 toggle](../../philosophy/adr-031-notification-preferences.md) — 사용자 단위 알림 설정
- `tools/app/feature.sh` — CLI 구현
- `tools/verify/api-smoke-test.sh` — 검증 단계와 SKIP 조건
