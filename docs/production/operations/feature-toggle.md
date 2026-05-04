# Feature Toggle (Lite 모드)

> **유형**: Runbook · **독자**: 운영자 / 템플릿 사용자 (Level 2~3) · **읽는 시간**: ~7분

이 문서는 **Lite 모드** (도메인별 feature toggle) 의 운영자 가이드입니다. 자세한 결정 근거: [`ADR-034`](../../philosophy/adr-034-feature-toggle-lite-mode.md).

---

## 1. 핵심 — opt-out 모델

모든 feature 의 default = 활성. `.env` 미설정 = 활성. 명시적 `false` 만 비활성.

```bash
# 활성 (default — 굳이 적을 필요 X)
# APP_FEATURES_PAYMENT=true

# 비활성
APP_FEATURES_PAYMENT=false
```

부팅 시 해당 도메인의 `*AutoConfiguration` 등록 X → 의존하는 endpoint 자동 사라짐 (404).

---

## 2. 토글 가능 모듈 (현재 — 7 도메인 모두 안전)

| Feature | env var | Domain | 효과 |
|---|---|---|---|
| `audit` | `APP_FEATURES_AUDIT` | core-audit-impl | `@Audited` / `@AdminOnly` 자동 감사 미동작 |
| `push` | `APP_FEATURES_PUSH` | core-push-impl | FCM 푸시 발송 미동작 |
| `email` | `APP_FEATURES_EMAIL` | core-email-impl | 메일 발송만 silent skip (가입은 OK — auth 가 ObjectProvider lazy 의존) |
| `payment` | `APP_FEATURES_PAYMENT` | core-payment-impl | 결제 호출 시점 `CMN_009 FEATURE_DISABLED` |
| `iap` | `APP_FEATURES_IAP` | core-iap-impl | IAP 호출 시점 `CMN_009 FEATURE_DISABLED` |
| `2fa` | `APP_FEATURES_2FA` | TwoFactorService bean | 2FA endpoint 호출 시점 `CMN_009 FEATURE_DISABLED` |
| `billing-notification` | `APP_FEATURES_BILLING_NOTIFICATION` | listener | 갱신 알림 발송 미동작 |
| `password-policy` | `APP_FEATURES_PASSWORD_POLICY` | SecurityValidationAutoConfiguration | `@ValidPassword` 정책 검증 무시 |

### 응답 패턴 (false 시)

| 도메인 | 호출 시점 응답 | 이유 |
|---|---|---|
| audit / push / billing-notification / password-policy | endpoint 자체 영향 X — 부산 효과만 미동작 | listener / aspect / validator 미등록 |
| email | endpoint 200 OK, 메일 미수신 | 가입 흐름 보호 (ADR-024 정합) |
| payment / iap / 2fa | `503 CMN_009 FEATURE_DISABLED` (details: feature 이름) | 클라이언트가 명시적 인지 |

---

## 3. 사용법 — `factory feature` 명령

```bash
# 토글 가능 모듈 + 현재 상태
<repo> local feature list

# 비활성
<repo> local feature disable payment

# 활성
<repo> local feature enable payment
```

`disable/enable` 은 **`.env` + `.env.prod` 동시 변경** — 로컬/운영 일관성 강제 (ADR-034). 한쪽만 변경하면 환경 간 동작 차이로 디버깅 노이즈.

직접 .env 편집해도 동등 효과.

---

## 4. 시나리오

### Lite — 결제 없는 SaaS (블로그/커뮤니티/SNS)

```bash
APP_FEATURES_PAYMENT=false
APP_FEATURES_IAP=false
APP_FEATURES_BILLING_NOTIFICATION=false
APP_FEATURES_AUDIT=false
# 활성 = auth, user, device, push, email, storage, 2fa, password-policy
```

부팅 후 검증:
```bash
<repo> local server-test                     # 부팅 OK
curl -X POST .../payment/verify              # 503 CMN_009
curl -X POST .../iap/verify                  # 503 CMN_009
curl -X POST .../auth/email/signup ...       # 200 OK (정상)
```

### Mid — 결제 + 이메일만 (단순 SaaS)

```bash
APP_FEATURES_IAP=false
APP_FEATURES_PUSH=false
APP_FEATURES_2FA=false
APP_FEATURES_AUDIT=false
APP_FEATURES_BILLING_NOTIFICATION=false
# 활성 = auth, user, device, email, payment, password-policy
```

### Full — 모든 도메인 (default)

```bash
# .env 에 APP_FEATURES_* 한 줄도 없어도 됨
```

---

## 5. 변경 후 검증 (필수)

```bash
# 1. 부팅 OK
<repo> local server-test

# 2. e2e — disabled feature 의 step 자동 SKIP 확인
<repo> local api-test
# 출력 예:
#   ✓  1/11  회원가입       PASS
#   ⊘  7/11  PG 결제        SKIP (feature PAYMENT disabled)
#   ⊘  9/11  IAP verify     SKIP (feature IAP disabled)
```

**SKIP 표시가 정상** — disabled feature 의 endpoint 가 404 반환할 때 api-smoke-test.sh 가 자동 인식하고 SKIP.

---

## 6. 트러블슈팅

### A. feature 비활성했는데 endpoint 가 200 반환
- 원인: 변경 후 부팅을 안 한 상태예요. `.env` 변경은 부팅 시점에만 반영돼요.
- 조치: `<repo> local server-test` 또는 docker compose restart.

### B. feature 활성인데 endpoint 가 404
- 원인: 다른 의존성 누락 (예: `payment` 활성이지만 `APP_PAYMENT_PORTONE_API_V1_KEY` 미설정).
- 조치: 부팅 로그 확인. `StubPaymentAdapter` 가 등록됐는지 vs PaymentAutoConfiguration 자체 미등록인지 구분.

### C. 부팅 fail — `Required bean of type ... not available`
- 원인: 다른 도메인이 disabled feature 의 bean 을 의존.
- 조치: 의존하는 모듈의 ObjectProvider 변환 또는 같이 비활성. (ADR-034 의 후속 작업 list 참조)

### D. `.env` 와 `.env.prod` 가 다른 상태
- 원인: 직접 편집 시 한쪽만 변경.
- 조치: `<repo> local feature <action> <name>` 사용 (양쪽 동시 변경 보장).

---

## 7. CI/배포

`feature` flag 변경은 코드 변경이 아니라 **환경변수 변경** — git push X.
운영 적용:
1. `.env.prod` 수정 (`<repo> local feature disable <name>` 가 자동 처리)
2. GitHub Secrets 갱신 — `APP_FEATURES_*` 추가
3. `<repo> prod deploy` — 새 환경변수로 부팅

> 운영자가 `.env.prod` 수정 후 GitHub Secrets push 까지 잊으면 GHA 가 옛 값으로 부팅. setup.sh 의 secrets sync 사용 권장.

---

## 8. 관련 문서

- [`ADR-034 · Lite 모드 설계`](../../philosophy/adr-034-feature-toggle-lite-mode.md)
- [`ADR-019 · billing/iap/payment 분리`](../../philosophy/adr-019-billing-iap-payment-separation.md)
- [`ADR-031 · 사용자 알림 toggle`](../../philosophy/adr-031-notification-preferences.md) — 본 도큐의 user-level 변형
- `tools/feature.sh` — feature 명령 구현
- `tools/api-smoke-test.sh` — disabled feature 자동 SKIP
