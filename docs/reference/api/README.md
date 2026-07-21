# API Reference

> **유형**: Reference · **독자**: 클라이언트 개발자 (Level 1~2) · **읽는 시간**: ~12분

본 문서는 모든 앱이 공유하는 **코어 REST API 엔드포인트 카탈로그**입니다. auth / user / device / notification-settings / posts / payment / iap 엔드포인트는 **core 공유 컨트롤러**가 각 AutoConfiguration 으로 등록되어 `/api/apps/{appSlug}/*` 로 제공돼요 — 앱을 추가하면 그 슬러그 경로로 자동 제공됩니다 ([`ADR-013`](../../philosophy/adr-013-per-app-auth-endpoints.md) B). 앱 고유 도메인 엔드포인트만 `<your-backend> new <slug>` 시 `tools/new-app/new-app.sh` 가 `<Slug>HealthController` + `<Slug>ApiEndpoints` 로 생성합니다.

## 공통 사항

- **Base path**: `/api/apps/{appSlug}/...`
- **인증**: `Authorization: Bearer <accessToken>` (15분 만료)
- **응답 포맷**: 모든 응답은 `ApiResponse<T>` 또는 `ApiError` (CommonError / AuthError / etc.)
- **에러 코드**: [`exception-handling.md`](../../convention/exception-handling.md) 의 codes 참조

### Lite 모드 (ADR-034) 영향

- `app.features.<domain>=false` 시 endpoint 자동 사라짐 (404) — payment / iap / push / email / audit / 2fa / billing-notification / password-policy / phone-auth 9 도메인 모두.
- 호출 시점에 lazy 의존 부재면 `503 CMN_009 FEATURE_DISABLED` (details 에 feature 이름 포함) — payment / iap / 2fa 만 해당. email 은 silent skip (가입 흐름 보호).

### Validation 에러 (`CMN_001 VALIDATION_ERROR` — 422)

- Bean Validation 실패 (`@Size`, `@NotNull` 등): details 에 `field`, `rejected`
- Path variable enum binding 실패 (예: `kind=INVALID`): details 에 `param`, `rejected`, `allowed` (CSV)

### IAP dev-mock (ADR-034 후속)

- `APP_IAP_APPLE_DEV_MOCK=true` 시 `AppleJwsVerifier` 가 cert chain + ES256 검증 우회. WireMock self-signed payload 검증용. **prod 절대 금지** — `.env.prod` 에는 이 키를 두지 않아요 (코드 default false).
- Google RTDN 은 `APP_IAP_GOOGLE_WEBHOOK_VERIFY_TOKEN=false` (default) 이 dev-mock 동등.

---

## 1. 인증 (`/auth/*`) — core-auth

| 메서드 | 경로 | 인증 | 설명 | 관련 ADR |
|---|---|---|---|---|
| POST | `/auth/email/send-code` | X | 가입 전 이메일 인증 코드 발송 (verify-BEFORE-signup 1단계, per-email rate limit) | ADR-013 |
| POST | `/auth/email/verify-code` | X | 6자리 코드 검증 → `proofToken` 반환 (2단계) | ADR-013 |
| POST | `/auth/email/signup` | X | 이메일 가입 — `proofToken` 제출 (3단계) | ADR-013 |
| POST | `/auth/email/signin` | X | 이메일 로그인 (2FA 활성 시 pending token 반환) | ADR-013, ADR-030 |
| POST | `/auth/apple` | X | Apple 소셜 로그인 (identity token RS256 검증) | ADR-013 |
| POST | `/auth/google` | X | Google 소셜 로그인 (id_token 검증) | ADR-013 |
| POST | `/auth/kakao` | X | Kakao 소셜 로그인 | ADR-013 |
| POST | `/auth/naver` | X | Naver 소셜 로그인 | ADR-013 |
| POST | `/auth/refresh` | X (refresh) | refresh token 회전 + 새 access token 발급 | ADR-013 |
| POST | `/auth/withdraw` | O | 계정 탈퇴 (soft delete) | ADR-013 |
| POST | `/auth/verify-email` | X | 이메일 인증 (6자리 코드) | ADR-013, ADR-024 |
| POST | `/auth/resend-verification` | O | 인증 메일 재발송 | ADR-013 |
| POST | `/auth/password-reset/request` | X | 비밀번호 재설정 요청 (메일 발송) | ADR-013 |
| POST | `/auth/password-reset/confirm` | X | 6자리 코드 + 새 비밀번호 적용 (모든 세션 무효화) | ADR-013, ADR-029 |
| PATCH | `/auth/password` | O | 현재 비밀번호 검증 + 새 비밀번호 적용 | ADR-029 |
| POST | `/auth/phone/request` | X | 휴대폰 OTP 발송 (SMS) — dev-capture 어댑터면 `devCode` 반환 | ADR-038 |
| POST | `/auth/phone/verify` | X | OTP 검증 → 번호로 유저 find-or-create + 토큰 발급 | ADR-038 |

### 2FA (TOTP) — ADR-030

| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| POST | `/auth/me/2fa/setup` | O | TOTP secret 생성 + otpauth URL 반환 (Authenticator 등록용) |
| POST | `/auth/me/2fa/verify` | O | 6자리 TOTP 코드 검증 + 활성화 + backup codes 8개 발급 |
| POST | `/auth/me/2fa/disable` | O | 2FA 비활성 (현재 비밀번호 + TOTP 코드 검증) |
| POST | `/auth/2fa/login` | X (twoFactorToken) | signin 후 pending token + TOTP/backup code 로 정상 토큰 발급 |

**Pending token**: `signin` 응답이 `twoFactorToken` (만료 5분, type="2fa_pending") 만 반환할 때, 클라이언트는 `/2fa/login` 으로 정식 토큰 발급.

---

## 2. 유저 (`/users/*`) — core-user

| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| GET | `/users/me` | O | 현재 유저 프로필 조회 |
| PATCH | `/users/me` | O | 프로필 수정 (displayName·nickname — null 필드는 유지, PATCH semantics) |
| POST | `/users/me/activity` | O | 활동 ping (204) — 본문 로직 없음, `UserActivityTrackingFilter` 가 (user, 오늘) 활동 기록 |

---

## 3. 결제 PG (`/payment/*`) — core-payment

| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| POST | `/payment/verify` | O | PortOne imp_uid 결제 검증 → 구독 활성 |
| POST | `/payment/refund` | O (admin) | 결제 환불 (`@AdminOnly` — ADR-027) |
| POST | `/payment/webhook` | X (HMAC) | PortOne 결제 상태 webhook (CANCELLED 등) |

---

## 4. 인앱 결제 IAP (`/iap/*`) — core-iap (ADR-022)

| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| POST | `/iap/verify` | O | Apple/Google 영수증 검증 → 구독 활성 |
| POST | `/iap/apple/webhook` | X (JWS) | Apple App Store Server Notification V2 |
| POST | `/iap/google/webhook` | X (Bearer JWT) | Google Play RTDN Pub/Sub push (ADR-032 — Bearer 검증) |

### Apple webhook 상세

- Body: `{ signedPayload: "..." }` (JWS)
- 검증: `AppleJwsVerifier` 가 Apple cert chain 으로 서명 검증 + `AppleNotificationDecoder` 가 디코드
- 처리: `BillingPort.handleWebhook(IapAppleNotification)` 호출 → 구독 상태 갱신

### Google webhook 상세

- Body: Pub/Sub message (`{ message: { data: <base64-RTDN> } }`)
- 검증 (`APP_IAP_GOOGLE_WEBHOOK_VERIFY_TOKEN=true` 시):
  - `Authorization: Bearer <jwt>` 헤더 필수
  - `GoogleWebhookAuthFilter` 가 RS256 서명 + audience + email claim 검증
- 처리: `GoogleNotificationDecoder` → `BillingPort.handleWebhook(IapGoogleNotification)`

---

## 5. 디바이스 (`/devices/*`) — core-device

| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| POST | `/devices` | O | 디바이스 푸시 토큰 등록 |
| DELETE | `/devices/{deviceId}` | O | 디바이스 삭제 (push 비활성) |

---

## 6. 알림 설정 (`/me/notification-settings/*`) — core-billing (ADR-031)

| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| GET | `/me/notification-settings` | O | 사용자별 NotificationKind 채널 on/off 조회 (미등록 kind 미포함) |
| PATCH | `/me/notification-settings/{kind}` | O | kind 별 push/email 채널 토글 (upsert) |

`NotificationKind` 값: `RENEWAL_SUCCEEDED` / `RENEWAL_FAILED` / `RENEWAL_ABANDONED` / `IAP_REFUND` / `IAP_REVOKE`. listener (SubscriptionNotificationListener) 가 발송 전 본 설정 확인. **default = enabled** — 명시적 off 안 하면 받음.

요청 body (PATCH):
```json
{ "pushEnabled": false, "emailEnabled": true }
```

---

## 7. 공유 게시물 (`/posts/*`) — core-content

| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| POST | `/posts` | O | 게시물 작성 (인증 유저가 작성자, 상태 ACTIVE) |
| GET | `/posts?board={board}` | O | 게시판 목록 — ACTIVE 만 최신순 페이징 (`page`/`size`, size 최대 100) |

MVP 는 작성·목록 두 액션만 제공합니다. 개별 조회·작성자 삭제는 후속이고, 모더레이션 (숨김·삭제) 은 관리자 콘솔 담당이에요.

---

## 8. 시스템 (`/health`, `/version`)

| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| GET | `/health` | X | 부팅 상태 (단순 200) |
| GET | `/version` | X | 빌드 버전 (git sha + tag) |
| GET | `/api/apps/{slug}/health` | X | 슬러그 schema 연결 검증 |
| GET | `/actuator/**` | (env 분리) | Spring Actuator (prod 는 별도 management port 권장) |

---

## 9. 명세 동기화

코어 엔드포인트(auth / user / device / notification / posts / payment / iap)의 경로는 `common-web` 의 `ApiEndpoints` + 각 `core-*-impl` 의 공유 컨트롤러에서 관리돼요 — 경로 변경 시 그쪽을 고칩니다. 앱 고유 경로만 `tools/new-app/new-app.sh` 의 heredoc 이 `<Slug>HealthController` / `<Slug>ApiEndpoints` 로 생성합니다.

- `common/common-web/.../ApiEndpoints.java` — 코어 공유 경로 상수 (`Auth` / `User` / `Device` / `NotificationSettings` / `Posts` / `Payment` / `Iap`)
- `core/core-auth-impl/.../AuthController.java`, `core/core-billing-impl/.../controller/{Payment,Iap}Controller.java`, `core/core-phone-auth-impl/.../controller/PhoneAuthController.java` 등 — 공유 런타임 빈 (각 AutoConfiguration 이 등록)

---

## 관련 문서

- [`Email Verification`](../../api-and-functional/functional/email-verification.md) — 가입/인증/재설정 플로우 상세
- [`JWT Authentication`](../../structure/jwt-authentication.md) — Bearer / refresh / 2FA pending 토큰 구조
- [`Exception Handling`](../../convention/exception-handling.md) — 에러 코드 단일 정본
- [`ADR-013`](../../philosophy/adr-013-per-app-auth-endpoints.md) — 앱별 인증 endpoint
- [`ADR-022`](../../philosophy/adr-022-iap-server-notifications.md) — IAP webhook
- [`ADR-027`](../../philosophy/adr-027-admin-role-authorization.md) — `@AdminOnly`
- [`ADR-030`](../../philosophy/adr-030-2fa-totp.md) — 2FA TOTP
- [`ADR-031`](../../philosophy/adr-031-notification-preferences.md) — 사용자 알림 toggle
- [`ADR-032`](../../philosophy/adr-032-google-webhook-auth.md) — Google webhook Bearer 인증
