# ADR-030 — 2FA TOTP (Google Authenticator 호환)

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~8분

**Status**: Accepted. RFC 6238 TOTP (HMAC-SHA1, 30 초 window, 6 자리) + backup codes 8 개 (BCrypt 해시 저장) 로 구성돼 있어요. OPT-IN 으로 활성화하고, 2FA 활성 사용자는 signin → twoFactorToken (`type="2fa_pending"`, 5 분) → `/auth/2fa/login` → 정식 token 흐름을 따릅니다.

---

## 결론부터

비밀번호 단독 인증은 *비밀번호 유출* 이라는 단일 실패점을 갖습니다. 사용자 입장에서 *얼마나 강한 비밀번호를 설정했는지* 와 무관하게, *다른 사이트에서 같은 비밀번호를 재사용한 흔적이 leak DB 에 등록* 되는 순간 그 계정은 *credential stuffing* 공격의 표적이 돼요. 결제를 처리하는 SaaS 환경에서는 *비밀번호 leak* 이 곧 *무단 결제 / 환불 사기 / 사용자 자산 탈취* 로 이어질 수 있어 *추가 인증 요소* 가 사실상 필수입니다.

본 ADR 은 *RFC 6238 TOTP* (Time-based One-Time Password) 를 두 번째 인증 요소로 도입합니다. TOTP 는 *Google Authenticator*, *Authy*, *1Password* 같은 표준 앱이 *30 초마다 6 자리 코드를 자동 생성* 하는 방식이에요. 사용자가 비밀번호를 입력해 1 차 인증을 통과하면, 시스템은 *2FA 활성 여부* 를 보고 *임시 토큰 (type="2fa_pending", 5 분 TTL)* 만 발급합니다. 이 임시 토큰으로는 *일반 endpoint 를 호출할 수 없고*, 오직 `/auth/2fa/login` endpoint 에서 *TOTP 6 자리 코드 또는 백업 코드* 를 함께 제출해야 정식 access / refresh token 이 발급돼요.

이 흐름의 핵심 가치는 *기존 인증 흐름을 깨지 않으면서* 2FA 가 자연스럽게 추가된다는 점이에요. 2FA 가 비활성인 사용자는 *기존 signin 응답 그대로* 정식 token 을 받고, 활성 사용자만 *추가 단계* 를 거칩니다. 운영자가 *전체 사용자에게 2FA 강제* 를 원하면 별도 정책으로 토글할 수 있고, 사용자 자기 설정에서 *언제든 OPT-IN 으로 활성화* 할 수 있어요.

백업 코드는 *TOTP 앱을 잃어버린 경우* 의 fallback 입니다. 사용자가 디바이스 분실 / OS 재설치 / 시계 어긋남 등으로 TOTP 코드를 받을 수 없을 때 *8 자리 alphanumeric 코드 8 개 중 하나* 를 입력해 우회할 수 있어요. 백업 코드는 *raw 값을 한 번만 사용자에게 표시하고 DB 에는 BCrypt 해시만 저장* 해, 사용자가 안전하게 보관 (1Password / 종이) 하면 DB 유출 시에도 백업 코드의 raw 값은 알려지지 않습니다.

이 ADR 의 범위는 RFC 6238 TOTP 알고리즘의 구체 파라미터 (HMAC-SHA1, 30 초 window, 6 자리, ±1 window clock skew), Base32 secret 인코딩의 표준 호환, 백업 코드의 BCrypt 해시 저장 패턴, 임시 토큰 (`type="2fa_pending"`) 의 JWT claim 설계, 2FA disable 시의 보안 강화 (현재 비밀번호 + TOTP 둘 다 검증), 그리고 DB schema 확장까지입니다.

---

## 왜 이런 결정이 필요했나?

비밀번호 강화 ([`ADR-029`](./adr-029-password-policy.md)) 만으로는 *credential stuffing* 공격을 완전히 막을 수 없어요. 사용자가 *우리 시스템에서는 정책에 맞게 강한 비밀번호* 를 설정해도, *다른 사이트에서 같은 비밀번호를 재사용* 하고 그 사이트가 유출되면 *우리 시스템의 비밀번호도 유출된 것* 과 마찬가지가 됩니다. 사용자의 다른 사이트 보안 습관을 우리가 통제할 수 없는 한, *비밀번호만으로 인증* 하는 시스템은 *유출된 비밀번호 데이터베이스 기반 자동 공격* 에 취약해요.

이 영역은 결제 SaaS 환경에서 특히 위험합니다. 일반 SNS 서비스의 *계정 탈취* 는 *해당 계정의 콘텐츠 손실* 이 주된 피해지만, 결제를 다루는 시스템은 *공격자가 환불 처리, 결제 정보 변경, 가족 공유 해지* 같은 *금전적 행동* 을 할 수 있어요. 비밀번호 leak 의 비용이 *사용자의 직접적 자산 손실* 로 환산되는 환경이라 *추가 인증 요소* 가 사실상 baseline 입니다.

표준 해결책은 *2FA (2-Factor Authentication)* 예요. *알고 있는 것 (비밀번호)* 외에 *가지고 있는 것 (디바이스의 TOTP 앱)* 을 함께 검증해, 한쪽이 유출돼도 다른 한쪽이 방어선으로 작동합니다. 2FA 의 구현 방식에는 여러 갈래가 있어요.

**SMS 기반 2FA** 는 사용자가 가장 익숙한 형태지만 *SIM swap 공격* 에 취약하고, *발송 비용 (SMS 한 건당 ~50원)* 이 누적되어 *수만 사용자 환경에서 부담* 이 큽니다. *통신 환경* 에 의존하는 점도 약점이에요 — 해외 출장 중이거나 통신 장애 시점에 사용자가 자기 계정에 접근하지 못합니다.

**이메일 기반 2FA** 는 SMS 보다 비용이 낮지만 *이메일 자체가 비밀번호와 같이 유출되는* 가능성이 높아 *진짜 두 번째 요소* 의 가치가 약해요. 사용자가 같은 디바이스에서 이메일을 확인하므로 *디바이스 탈취* 시점에는 두 요소가 모두 무력화됩니다.

**TOTP (Time-based OTP)** 는 *RFC 6238 표준* 으로 *외부 의존 0* 이에요. 사용자의 디바이스에 설치된 TOTP 앱이 *서버와 공유한 secret* 으로 *30 초마다 6 자리 코드를 로컬에서 계산* 합니다. 서버가 SMS / 이메일을 발송할 필요가 없고, *Google Authenticator*, *Authy*, *1Password* 같은 표준 앱이 모든 OS 에서 동작해 사용자 학습 곡선도 낮아요. 백엔드 구현은 *RFC 6238 알고리즘 (HMAC-SHA1 + counter)* 만으로 끝나서 *추가 인프라가 0* 입니다.

이 결정이 답해야 할 물음은 이거예요.

> **결제 SaaS 환경에서 비밀번호 단독 인증의 단일 실패점을 어떤 추가 요소로 메우면, 외부 의존 / 발송 비용 없이 사용자 학습 곡선도 낮게 유지할 수 있는가?**

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

- TOTP 앱을 볼 수 없을 때 (디바이스 분실 / 시계 어긋남) backup code 를 입력해요
- 8자리 alphanumeric (예: "ABCD1234")
- 1회용 — 사용 시 DB 의 hash 가 제거돼요. 8개를 다 쓰면 disable 후 setup 을 재진행해요.

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

핵심: **type="2fa_pending"** claim 이에요.

- `JwtAuthFilter` 의 `validateAccessToken` 이 type 을 체크해요 — "2fa_pending" 이면 `ACCESS_TOKEN_INVALID` 로 거절합니다. 즉 임시 token 으로는 일반 endpoint 호출이 안 돼요.
- `TwoFactorService.loginWith2fa` 만이 type=2fa_pending token 을 검증합니다.
- 같은 signing key 라 별도 인프라가 필요하지 않아요. type claim 으로만 분기해요.

5분 TTL — 사용자가 TOTP 앱을 보고 6자리 입력하기 충분한 시간이에요. 너무 길면 leak 위험이 커져요.

---

## Backup codes 보안

- raw 코드는 verify 응답에 1회 표시 후 **다시 표시 X** — 사용자 책임 보관
- DB 에 BCrypt 해시만 저장 (raw 미저장)
- 사용 시: 입력 코드 → 모든 hash 와 BCrypt match → 매칭된 hash 제거
- 8개 다 사용 시 → disable + setup 재진행 (운영 시 알림)

**왜 BCrypt?** 비밀번호와 동일한 password-equivalent 자산이라서요. salt + slow hash 로 brute-force 를 차단합니다.

**왜 raw 1회 표시?** 사용자가 안전한 곳 (1Password / 종이 etc) 에 보관하는 책임을 져요. UX 가 단순해져요.

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

`new-app.sh` heredoc 의 `<Slug>AuthController` 자동 생성에 포함돼요.

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
