# ADR-030 — 2FA TOTP (Google Authenticator 호환)

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~8분

**상태**: 채택 (2026-05-02)
**전제**: ADR-029 (비밀번호 정책), 기존 JWT 인증
**연관**: 2FA 사이클 — 출시 baseline 보안 강화

---

## 결론부터

2FA TOTP 추가 (RFC 6238 표준 — Google Authenticator / Authy 호환). 30초 윈도우 6자리 코드 + 백업 코드 8개 (BCrypt 해시 저장).

가입 / 로그인 흐름 그대로 유지 + *2FA 활성 사용자만* signin → twoFactorToken (5분, type="2fa-pending") → `/auth/2fa/login` 로 정식 토큰. 단계 추가가 *기존 흐름을 깨지 않음*.

---

## 배경

비밀번호 단독 인증의 한계:
- leak DB 에 사용자 비밀번호 등록 시 account takeover
- 약한 비밀번호 (정책 통과해도) 사회공학으로 추측
- 결제 SaaS 인 우리 서비스 = 비밀번호 leak 시 무단 결제 / 환불 사기 위험

표준 해결책 = **2FA (2-Factor Authentication)**. RFC 6238 TOTP 가 가장 보편적:
- 외부 의존 0 (SMS/이메일 발송 비용 X)
- 사용자 익숙 (Google Authenticator / Authy / 1Password)
- backend 코드만으로 구현

---

## 결정

| 항목 | 값 |
|---|---|
| **알고리즘** | RFC 6238 TOTP (HMAC-SHA1, 30초 window, 6자리, 160-bit secret) |
| **Secret 인코딩** | Base32 (RFC 4648) — TOTP 앱 호환 |
| **Clock skew** | ±1 window (90초 허용) |
| **Backup codes** | 8자리 alphanumeric × 8개 (BCrypt 해시 저장, 1회용) |
| **활성화 모드** | OPT-IN — 사용자가 자기 설정에서 ON/OFF |
| **로그인 흐름 변경** | totp_enabled=true 사용자만 추가 step. 1단계 통과 후 임시 token 5분 TTL |
| **임시 token** | JWT type="2fa_pending" — 정상 access token 과 type 으로 구분 |
| **Disable 보안** | 현재 비밀번호 + TOTP/backup 코드 둘 다 검증 (단순 disable 차단) |
| **DB schema** | `users` 테이블에 totp_secret/enabled/backup_codes 컬럼 추가 (V013) |

---

## 흐름

### Setup (사용자 본인 설정에서)

```
1. POST /auth/me/2fa/setup (인증된 사용자)
   → backend: secret 생성 + users.totp_secret 저장 (enabled=false)
   → 응답: { secret, otpAuthUrl }

2. 클라이언트 (Flutter): qr_flutter 로 otpAuthUrl 을 QR 표시
3. 사용자: Google Authenticator 앱이 QR 스캔 → 30초마다 6자리 코드

4. POST /auth/me/2fa/verify { code: "123456" }
   → backend: TotpService.verify(secret, code)
   → 성공: totp_enabled=true + backup codes 8개 발급 (BCrypt 해시 저장)
   → 응답: { backupCodes: ["ABCD1234", ...] }   // 1회 표시
   → 사용자: 안전한 곳에 보관
```

### 로그인 (2FA 활성 사용자)

```
1. POST /auth/email/signin { email, password, appSlug }
   → 비밀번호 검증 통과 + totp_enabled=true
   → backend: 정상 token 대신 임시 2FA token 발급
   → 응답: { twoFactorToken: "<JWT 5분 TTL>", user: null, tokens: null }

2. 사용자가 Google Authenticator 보고 6자리 입력
3. POST /auth/2fa/login { twoFactorToken, code: "123456" }
   → backend: 임시 token 검증 + TotpService.verify 또는 backup code 매칭
   → 성공: 정상 access + refresh 발급
   → 응답: { user, tokens, twoFactorToken: null }
```

### Backup code 사용

- TOTP 앱 못 봄 (디바이스 분실 / 시계 어긋남) 시 backup code 입력
- 8자리 alphanumeric (예: "ABCD1234")
- 1회용 — 사용 시 DB 의 hash 제거. 8개 다 쓰면 disable 후 setup 재진행.

### Disable (사용자 본인)

```
POST /auth/me/2fa/disable { currentPassword, code }
  → 현재 비밀번호 검증 (디바이스 도난 대비)
  → TOTP/backup 코드 검증 (현재 사용자 본인 확인)
  → 둘 다 통과 시 secret/backup/enabled 모두 삭제
```

---

## RFC 6238 검증

`TotpServiceTest` 에 RFC 6238 Appendix B test vectors 포함:

```
secret = "12345678901234567890" (ASCII) → Base32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
T = 59 (window=1)         → expected: "287082" (마지막 6자리)
T = 1111111109 (window=37037036) → expected: "081804"
```

→ 11건 테스트 모두 PASS = 알고리즘 정확.

---

## 임시 2FA token 설계

```json
{
  "sub": "42",
  "appSlug": "myapp",
  "type": "2fa_pending",
  "iss": "...",
  "iat": ...,
  "exp": ...    // 5분 TTL
}
```

핵심: **type="2fa_pending"** claim.

- `JwtAuthFilter` 의 `validateAccessToken` 이 type 체크 — "2fa_pending" 이면 `ACCESS_TOKEN_INVALID`. 즉 임시 token 으로는 일반 endpoint 호출 X.
- `TwoFactorService.loginWith2fa` 만이 type=2fa_pending token 검증.
- 같은 signing key 라 별도 인프라 불필요. type claim 으로만 분기.

5분 TTL — 사용자가 TOTP 앱 보고 6자리 입력하기 충분. 너무 길면 leak 위험 ↑.

---

## Backup codes 보안

- raw 코드는 verify 응답에 1회 표시 후 **다시 표시 X** — 사용자 책임 보관
- DB 에 BCrypt 해시만 저장 (raw 미저장)
- 사용 시: 입력 코드 → 모든 hash 와 BCrypt match → 매칭된 hash 제거
- 8개 다 사용 시 → disable + setup 재진행 (운영 시 알림)

**왜 BCrypt?** 비밀번호와 동일한 password-equivalent 자산. salt + slow hash 로 brute-force 차단.

**왜 raw 1회 표시?** 사용자가 안전한 곳 (1Password / 종이 etc) 보관 책임. UX 단순.

---

## 검증 (단위 테스트 11건)

`TotpServiceTest`:
- generateSecret — Base32 형식, unique
- generateOtpAuthUrl — 표준 형식
- computeCode — RFC 6238 test vectors 통과
- verify — 현재/이전/다음 window 허용, ±2 window 거부
- verify — 잘못된 길이 / null / 랜덤 코드 거부

**TwoFactorService 의 통합 테스트는 다음 사이클**. 현재는 단위 테스트만. 실 e2e 는 Flutter 앱 + sandbox 환경에서.

---

## 적용 — Endpoint 4개

```
POST /api/apps/<slug>/auth/me/2fa/setup           (인증)
POST /api/apps/<slug>/auth/me/2fa/verify          (인증)
POST /api/apps/<slug>/auth/me/2fa/disable         (인증)
POST /api/apps/<slug>/auth/2fa/login              (공개)
```

`new-app.sh` heredoc 의 `<Slug>AuthController` 자동 생성에 포함.

---

## 대안 비교

### 옵션 A — SMS OTP

- 장: 사용자 익숙 (한국 일반)
- ❌ 외부 SMS 서비스 비용 (NHN SENS / 알리고)
- ❌ SIM swap 공격 위험 (NIST 권장 X)
- ❌ 발송 실패 / 지연 — UX 저하

### 옵션 B — TOTP (Google Authenticator) ★ 채택

- 외부 의존 0
- 표준 RFC, 모든 TOTP 앱 호환
- 사용자가 시간 동기 외 신경 X
- backend 코드만으로 구현

### 옵션 C — WebAuthn / Passkey

- 가장 강력 (생체 인증, phishing 차단)
- ❌ 모바일 / 데스크톱 cross-platform 복잡
- ❌ 사용자 디바이스 분실 시 lockout 위험 (backup mechanism 별도)
- 향후 사이클 (template baseline 외)

### 옵션 D — Email OTP

- 장: 외부 의존 ≈ 0 (이미 email 인프라)
- ❌ 이메일 leak 시 무력
- ❌ 발송 지연 — UX 저하
- ❌ NIST 권장 X (TOTP 가 더 강함)

---

## 안 다루는 범위 (다음 사이클)

- **WebAuthn / Passkey** — 더 강한 인증. 모바일 디바이스 자체로
- **2FA 강제 모드** — admin 권한자는 2FA 의무화
- **Trusted device** — "이 디바이스 30일 기억" 옵션
- **2FA 활성화 알림** — email 통지 (security event)
- **Recovery 흐름** — backup codes 8개 다 분실 시 admin 가 disable 후 사용자 재가입 안내
- **TwoFactorService Contract test** — 실 DB + AuthPort 통합 검증

---

## 관련 파일

신규:
- `tools/new-app/new-app.sh` — V013 마이그레이션 + AuthController 4개 endpoint heredoc + ApiEndpoints.Auth.TOTP_*
- `core/core-auth-impl/.../totp/TotpService.java` — RFC 6238 알고리즘
- `core/core-auth-impl/.../totp/TwoFactorService.java` — 비즈로직 (setup/verify/disable/loginWith2fa)
- `core/core-auth-impl/src/test/.../totp/TotpServiceTest.java` — 11건
- `core/core-auth-api/.../dto/TotpSetupResponse.java`
- `core/core-auth-api/.../dto/TotpVerifySetupRequest.java`
- `core/core-auth-api/.../dto/TotpVerifySetupResponse.java`
- `core/core-auth-api/.../dto/TotpDisableRequest.java`
- `core/core-auth-api/.../dto/TotpLoginRequest.java`
- `core/core-user-api/.../dto/TotpInfo.java`

수정:
- `common/common-security/.../jwt/JwtService.java` — 임시 token 발급/검증 + type claim 체크
- `core/core-user-api/.../UserPort.java` — totp 5개 메소드
- `core/core-user-impl/.../entity/User.java` — totp 필드 + domain methods
- `core/core-user-impl/.../UserServiceImpl.java` — UserPort 구현 확장
- `core/core-auth-api/.../AuthPort.java` — 4개 totp 메소드
- `core/core-auth-api/.../dto/AuthResponse.java` — twoFactorToken 필드 + requires2fa() 정적 팩토리
- `core/core-auth-api/.../exception/AuthError.java` — 4개 신규 코드 (ATH_007~010)
- `core/core-auth-impl/.../AuthServiceImpl.java` — signInWithEmail 흐름 변경 + 4개 totp 메소드 구현
- `core/core-auth-impl/.../AuthAutoConfiguration.java` — TotpService + TwoFactorService bean 등록
