# Flutter ↔ Backend Integration

> **유형**: How-to · **독자**: Level 2 · **읽는 시간**: ~10분

**설계 근거**: [`ADR-013 · 앱별 인증 엔드포인트`](../../philosophy/adr-013-per-app-auth-endpoints.md) · [`ADR-006 · HS256 JWT`](../../philosophy/adr-006-hs256-jwt.md)

이 문서는 Flutter 앱이 `template-spring` 기반 백엔드와 통신할 때 알아야 할 백엔드 관점의 계약을 정리합니다. 엔드포인트 경로, 인증 방식, 토큰 갱신 규약, appSlug 매칭 규칙이 핵심이에요.

응답 래퍼의 세부 구조는 [`API Response Format`](./api-response.md) 이, 에러 코드 체계는 [`Exception Handling Convention`](../../convention/exception-handling.md) 이 정본입니다. 본 문서는 그 둘과 중복되지 않게 Flutter 입장에서 특별히 알아야 할 것만 다뤄요.

---

## 개요

한 백엔드가 여러 앱을 동시에 서비스하므로, Flutter 클라이언트가 알아야 할 다섯 가지가 있어요.

- URL 에 appSlug 가 박혀 앱별로 분리됩니다.
- 인증 엔드포인트는 앱별로 노출됩니다.
- 보호된 경로는 Bearer 토큰을 요구합니다.
- 401 은 `error.code` 로 세분화해 분기합니다.
- URL 의 appSlug 는 토큰의 appSlug 와 일치해야 합니다.

각 항목을 아래에서 차례로 풀어요.

---

## 기본 URL 규칙

### 앱별 스코프 — 대부분의 엔드포인트

```text
/api/apps/{appSlug}/{resource}
```

`{appSlug}` 는 해당 앱의 슬러그예요. `sumtally`, `gymlog` 처럼 소문자와 숫자, 하이픈으로 이뤄집니다. `{resource}` 는 도메인이고요. `auth`, `devices` 같은 값이 들어가요.

모든 인증·디바이스·도메인 엔드포인트가 이 규칙을 따릅니다. 한 백엔드가 여러 앱을 서비스하니까, path 에 슬러그가 박혀 있어야 앱별로 데이터가 분리돼요. 이 경로 상수는 `common-web` 모듈의 `ApiEndpoints.APP_BASE` 에 정의되어 있습니다.

### 전역 스코프 — 인프라와 유저 프로필

슬러그가 붙지 않는 경로도 있어요.

| 경로 | 인증 | 용도 |
|---|---|---|
| `/health` | 불필요 | 헬스 체크 |
| `/version` | 불필요 | 버전 정보 |
| `/actuator/**` | 불필요 | 운영 지표 (dev·prod 는 노출 endpoint 를 `health`·`info`·`prometheus` 로 제한, 앱 포트 공유) |
| `/v3/api-docs/**` · `/swagger-ui/**` | 불필요 | Swagger 문서·UI |
| `/api/apps/{appSlug}/users/me` | 필요 | 현재 유저 프로필 |

`/api/apps/{appSlug}/users/me` 는 auth·device 와 동일하게 path 에 슬러그를 두어 경로를 통일했어요. `AppSlugVerificationFilter` 가 path slug ↔ JWT slug 일치를 강제해 cross-app 접근을 막아요. 유저 조회 자체는 JWT 의 `userId` 로 해요. 이 경로 상수는 `ApiEndpoints.User` 에 있습니다.

---

## 인증 엔드포인트

아래 경로는 `ApiEndpoints.Auth` 상수의 단일 정본입니다. 위치는 `common-web/src/main/java/.../ApiEndpoints.java` 예요. Flutter 쪽 경로 상수도 이와 1:1 로 맞추기를 권장해요.

| Method | Path | 인증 | 설명 |
|---|---|---|---|
| POST | `/api/apps/{appSlug}/auth/email/send-code` | 불필요 | 가입용 인증 코드 발송 (verify-before-signup 1단계) |
| POST | `/api/apps/{appSlug}/auth/email/verify-code` | 불필요 | 코드 검증 → `proofToken` 발급 (2단계) |
| POST | `/api/apps/{appSlug}/auth/email/signup` | 불필요 | 이메일 가입 — `proofToken` 필수 (3단계, 201) |
| POST | `/api/apps/{appSlug}/auth/email/signin` | 불필요 | 이메일 로그인 |
| POST | `/api/apps/{appSlug}/auth/apple` | 불필요 | Apple 로그인 (`identityToken`) |
| POST | `/api/apps/{appSlug}/auth/google` | 불필요 | Google 로그인 (`idToken`) |
| POST | `/api/apps/{appSlug}/auth/kakao` | 불필요 | Kakao 로그인 (`accessToken`) |
| POST | `/api/apps/{appSlug}/auth/naver` | 불필요 | Naver 로그인 (`accessToken`) |
| POST | `/api/apps/{appSlug}/auth/refresh` | 불필요 | 토큰 갱신 |
| POST | `/api/apps/{appSlug}/auth/2fa/login` | 불필요 | 2FA 코드로 정식 토큰 발급 |
| POST | `/api/apps/{appSlug}/auth/phone/**` | 불필요 | 휴대폰 점유인증 (옵트인 기능) |
| POST | `/api/apps/{appSlug}/auth/withdraw` | 필요 | 회원 탈퇴 (204) |
| POST | `/api/apps/{appSlug}/auth/verify-email` | 불필요 | 이메일 인증 (204) |
| POST | `/api/apps/{appSlug}/auth/resend-verification` | 필요 | 인증 메일 재발송 (204) |
| POST | `/api/apps/{appSlug}/auth/password-reset/request` | 불필요 | 재설정 메일 발송 (204) |
| POST | `/api/apps/{appSlug}/auth/password-reset/confirm` | 불필요 | 토큰으로 재설정 (204) |
| PATCH | `/api/apps/{appSlug}/auth/password` | 필요 | 비밀번호 변경 (204) |
| POST | `/api/apps/{appSlug}/auth/me/2fa/backup-codes/regenerate` | 필요 | 2FA 백업코드 재발급 — 기존 8개 무효화 + 새 8개 반환 |

인증 불필요 경로는 `SecurityConfig` 가 `ApiEndpoints.Auth.PUBLIC_PATTERNS` 를 읽어 등록하므로 JWT 없이 호출됩니다. `2fa/login` 과 `phone/**` 은 로그인 전 단계라 함께 public 으로 열려 있어요. 2FA 의 setup·verify·disable·backup-codes/regenerate 는 이미 로그인한 유저만 호출하므로 access token 이 필요합니다.

### 템플릿 상태에서의 노출 여부

`core-auth-impl` 의 `AuthController` 는 `AuthAutoConfiguration` 이 `@ConditionalOnMissingBean` 으로 등록하는 **단일 공유 런타임 빈** 이에요. path 의 `{appSlug}` 변수로 모든 앱을 한 컨트롤러가 처리합니다. `new-app.sh` 는 앱별 복제본을 만들지 않아요.

즉 앱을 추가하면 그 슬러그로 곧바로 인증 엔드포인트를 호출할 수 있어요. 존재하지 않는 슬러그로 호출하면 404 가 됩니다.

---

## 요청/응답 DTO 구조

DTO 는 모두 `core-auth-api/src/main/java/.../dto/` 에 있는 Java record 입니다. Flutter 쪽에서는 필드명과 타입만 맞춰 동일한 구조로 매핑하면 돼요.

응답 래퍼 자체의 규칙은 [`API Response`](./api-response.md) 가 정본이에요. 상호배타성·null 필드 생략·pagination 형식은 그쪽에서 확인하세요. 본 문서는 DTO 필드명과 타입만 다룹니다.

### SignUpRequest

```java
public record SignUpRequest(
    @Email @NotBlank String email,
    @NotBlank @ValidPassword String password,
    @NotBlank @Size(max = 30) String displayName,
    @NotBlank String proofToken
) {}
```

가입은 **verify-before-signup 3단계**입니다: ① `email/send-code` 로 인증 코드 발송 → ② `email/verify-code` 로 코드 검증 → 30분 TTL 의 `proofToken`(JWT) 발급 → ③ `email/signup` 에 `proofToken` 을 담아 가입. 서버가 proofToken 의 서명·만료·email·appSlug·purpose claim 을 검증한 뒤에만 유저를 생성하고, 생성된 유저는 `emailVerified=true` 상태입니다.

`password` 는 `@Size` 가 아니라 커스텀 `@ValidPassword` 정책을 따릅니다. 기본값은 최소 10자에 영문 대/소문자와 숫자 조합, 그리고 흔한 비밀번호 차단이에요. 정확한 조건은 운영자가 `app.password.*` 설정으로 조정할 수 있으니, Flutter 의 클라이언트 측 검증은 백엔드 422 응답을 정답으로 두고 느슨하게 잡는 편이 안전해요.

요청 예시:

```http
POST /api/apps/sumtally/auth/email/signup
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "Password1234",
  "displayName": "홍길동",
  "proofToken": "<verify-code 가 발급한 JWT>"
}
```

`appSlug` 는 body 로 받지 않아요 — URL path (`/api/apps/{appSlug}/...`) 에서 derive 합니다 (client 조작 방지). proofToken 안의 appSlug claim 과 path 가 일치해야 가입이 진행돼요.

### SignInRequest

```java
public record SignInRequest(
    @Email @NotBlank String email,
    @NotBlank String password
) {}
```

### AuthResponse

로그인·가입 성공 시 반환되는 복합 응답이에요. record 는 네 개의 필드를 갖지만, 평소엔 `user` 와 `tokens` 만 채워집니다. 나머지 두 필드는 특정 상황에서만 등장해요.

```java
public record AuthResponse(
    @JsonInclude(NON_NULL) UserSummary user,
    @JsonInclude(NON_NULL) AuthTokens tokens,
    @JsonInclude(NON_NULL) String devVerificationToken,
    @JsonInclude(NON_NULL) String twoFactorToken
) {}

public record UserSummary(
    long id,
    String email,
    String displayName,
    boolean emailVerified
) {}

public record AuthTokens(
    String accessToken,
    String refreshToken
) {}
```

`@JsonInclude(NON_NULL)` 라서 값이 없는 필드는 JSON 에서 빠져요. 각 필드의 의미는 이래요.

| 필드 | 언제 채워지나 | Flutter 처리 |
|---|---|---|
| `user` · `tokens` | 정상 로그인/가입 | 토큰 저장 후 진입 |
| `twoFactorToken` | 2FA 활성 유저의 1단계 통과 | `user`·`tokens` 가 비어 있음. 이 토큰으로 `/auth/2fa/login` 호출 |
| `devVerificationToken` | (레거시 컴포넌트 — 현행 가입 플로우에선 채워지지 않음) | verify-before-signup 전환 후 dev 노출은 `send-code` 응답의 `devCode` 가 담당 (dev·local 의 `app.email.dev-fallback-raw=true` 에서만). 운영에서는 절대 안 나옴 |

응답 예시 (201 Created):

```json
{
  "data": {
    "user": {
      "id": 123,
      "email": "user@example.com",
      "displayName": "홍길동",
      "emailVerified": false
    },
    "tokens": {
      "accessToken": "<jwt-access-token-placeholder>",
      "refreshToken": "<refresh-token-placeholder>"
    }
  },
  "error": null
}
```

2FA 가 켜진 유저라면 같은 200 응답이지만 `user` 와 `tokens` 가 빠지고 `twoFactorToken` 만 옵니다. Flutter 는 이 경우 토큰을 저장하지 말고 2단계 코드 입력 화면으로 이동해야 해요.

### AppleSignInRequest

첫 로그인과 이후 로그인의 payload 가 달라요. Apple 은 첫 로그인에서만 일부 필드를 제공하므로, Flutter 는 첫 응답을 로컬에 저장해 뒀다가 서버에 그대로 전달해야 합니다.

```java
public record AppleSignInRequest(
    @NotBlank String identityToken,
    String authorizationCode,   // 첫 로그인에만 (Revoke Tokens 용 — Phase 1)
    String firstName,           // 첫 로그인에만
    String lastName,            // 첫 로그인에만
    String email,               // 첫 로그인에만
    String nonce                // 첫 로그인에만
) {}
```

### GoogleSignInRequest

```java
public record GoogleSignInRequest(
    @NotBlank String idToken
) {}
```

Kakao·Naver 도 같은 모양이에요. 각각 `KakaoSignInRequest` 와 `NaverSignInRequest` 가 `accessToken` 하나를 받습니다 (appSlug 는 모든 인증 요청에서 URL path 로만 전달). provider 별로 어떤 토큰을 보내야 하는지는 [`ADR-017`](../../philosophy/adr-017-oauth-integration.md) 에 정리돼 있어요.

### RefreshRequest

```java
public record RefreshRequest(
    @NotBlank String refreshToken
) {}
```

`/auth/refresh` 응답은 유저 정보 없이 `AuthTokens` 만 반환합니다.

```json
{
  "data": {
    "accessToken": "<jwt-access-token-placeholder>",
    "refreshToken": "<refresh-token-placeholder>"
  },
  "error": null
}
```

Refresh 는 회전(rotation)이 일어납니다. 요청에 쓴 refresh token 은 즉시 무효화되고 새 refresh token 이 발급돼요. Flutter 는 반드시 응답의 새 값으로 교체해야 합니다. 옛 값을 재사용하면 탈취 감지가 발동해 해당 토큰 family 전체가 revoke 돼요.

### 기타 DTO

```java
// 가입용 이메일 인증 코드 발송 (verify-before-signup 1단계)
public record SendEmailVerificationRequest(@Email @NotBlank String email) {}

// 인증 코드 검증 → proofToken 발급 (2단계, code 는 6자리 숫자)
public record VerifyEmailCodeRequest(
    @Email @NotBlank String email,
    @NotBlank String code
) {}

// 이메일 인증 (resend-verification 이 발급한 6자리 코드 검증 — email 은 per-subject 시도 계상 스코프 키)
public record VerifyEmailRequest(@Email @NotBlank String email, @NotBlank String token) {}

// 비밀번호 재설정 요청 (이메일)
public record PasswordResetRequest(@Email @NotBlank String email) {}

// 비밀번호 재설정 확인 (토큰 + 새 비밀번호)
public record PasswordResetConfirmRequest(
    @NotBlank String token,
    @NotBlank @ValidPassword String newPassword
) {}

// 로그인 상태에서 비밀번호 변경
public record ChangePasswordRequest(
    @NotBlank String currentPassword,
    @NotBlank @ValidPassword String newPassword
) {}

// 탈퇴 (사유는 optional)
public record WithdrawRequest(
    @Size(max = 500) String reason
) {}
```

새 비밀번호 필드도 가입과 같은 `@ValidPassword` 정책을 따릅니다.

---

## Bearer 토큰 인증

인증이 필요한 엔드포인트는 `Authorization` 헤더에 Bearer 토큰을 담아야 합니다.

```http
GET /api/apps/sumtally/users/me
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...
```

Bearer 접두사는 RFC 6750 에 따라 대소문자를 가리지 않아요. `JwtAuthFilter` 가 헤더를 추출해 검증하고, 성공하면 `AuthenticatedUser` 를 SecurityContext 에 주입합니다.

JWT access token 의 claim 구조는 다음과 같아요. 발급은 `JwtService.issueAccessToken` 이 담당합니다.

```json
{
  "sub": "123",
  "email": "user@example.com",
  "appSlug": "sumtally",
  "role": "user",
  "iss": "app-factory-dev",
  "iat": 1234567890,
  "exp": 1234568790
}
```

각 claim 의 의미는 이래요.

| claim | 값 | 비고 |
|---|---|---|
| `sub` | userId | 문자열로 직렬화됨 |
| `appSlug` | 발급 당시 앱 슬러그 | URL path 와 대조 (아래 참조) |
| `role` | 기본 `user` | 신규 가입 유저의 기본 역할 |
| `iss` | 환경별 발급자 | `JWT_ISSUER` 환경변수. local=`app-factory-local`, dev=`app-factory-dev`, prod=`app-factory` |
| `iat` · `exp` | 발급·만료 시각 | access TTL 만큼 차이 |

토큰 수명은 환경 설정으로 조정됩니다.

- **Access token TTL** — 기본 `PT15M` (15분). `app.jwt.access-token-ttl` 로 변경 가능합니다.
- **Refresh token TTL** — 기본 `P30D` (30일). `app.jwt.refresh-token-ttl` 로 변경 가능합니다.

토큰 서명과 검증은 `common-security/src/main/java/.../jwt/JwtService.java` 가 담당합니다.

---

## 401 응답 처리 — Flutter 쪽 분기 규약

401 Unauthorized 는 하나의 상태 코드 아래 여러 의미를 담아요. Flutter 는 HTTP 상태가 아니라 `error.code` 값으로 분기해야 합니다.

| error.code | 의미 | Flutter 권장 동작 |
|---|---|---|
| `CMN_004` | 토큰 없음 (보호 경로에 인증 미포함) | 로그인 화면으로 이동 |
| `CMN_007` | Access token 만료 | 자동으로 `/auth/refresh` 호출 후 성공 시 원 요청 재시도 |
| `CMN_008` | Access token 무효 (위변조 등) | 강제 로그아웃 후 로그인 화면 |
| `ATH_001` | 이메일/비밀번호 불일치 | 입력 오류 메시지 표시 |
| `ATH_002` | Refresh·verify·reset 토큰 만료 | 재로그인 유도 |
| `ATH_003` | Refresh·verify·reset 토큰 무효 | 재로그인 유도 |
| `ATH_004` | 소셜 로그인 검증 실패 | 소셜 로그인 재시도 |
| `ATH_005` | 이메일 미인증 | 인증 안내 화면 |
| `ATH_010` | 2FA 필요 | `twoFactorToken` 으로 2단계 코드 화면 이동 |

### 추천 흐름

```text
요청 전송
   │
   ├─ 200 → 정상 처리
   │
   ├─ 401 + CMN_007 (access 만료)
   │    └─ /auth/refresh 호출
   │         ├─ 200 → 새 토큰 저장 → 원 요청 재시도
   │         └─ 401 + ATH_002 / ATH_003 → 강제 로그아웃
   │
   ├─ 401 + CMN_008 → 강제 로그아웃
   │
   ├─ 403 + CMN_005 → appSlug 불일치 (아래 참조)
   │
   └─ 기타 → 일반 에러 처리
```

`/auth/refresh` 자체가 401 을 반환하면 (`ATH_002` 또는 `ATH_003`) 더 시도하지 말고 즉시 로그아웃 상태로 전환하세요. 그렇지 않으면 무한 루프가 발생해요.

---

## appSlug 검증 규칙

`/api/apps/{appSlug}/...` 경로에 요청할 때, URL 의 appSlug 는 JWT 의 `appSlug` claim 과 일치해야 합니다.

이 검증은 `common-security/src/main/java/.../AppSlugVerificationFilter.java` 가 수행해요. 불일치 시 403 Forbidden 을 반환합니다.

```json
{
  "data": null,
  "error": {
    "code": "CMN_005",
    "message": "app mismatch: JWT issued for 'sumtally' but accessing 'gymlog'"
  }
}
```

### Flutter 입장에서 기억할 점

한 앱에서 발급된 토큰으로는 다른 앱의 엔드포인트를 호출할 수 없어요. 이 템플릿은 한 앱이 한 토큰을 갖는 모델을 전제하므로, 멀티 앱 동시 로그인이 필요하면 앱별로 토큰을 따로 관리해야 합니다.

`CMN_005` 를 받았을 때 재시도는 무의미해요. 현재 활성 토큰을 파기하고 해당 앱으로 재로그인하는 흐름을 권장합니다.

---

## HTTP 상태 코드 + 에러 코드 매핑

Flutter 가 자주 받게 될 조합만 추렸어요.

| 상황 | HTTP | error.code |
|---|---|---|
| 가입 성공 | 201 | — |
| 로그인 성공 / 토큰 갱신 성공 | 200 | — |
| 탈퇴·인증·재설정 성공 (body 없음) | 204 | — |
| 입력값 검증 실패 (이메일 형식·비밀번호 정책 등) | 422 | `CMN_001` |
| 비밀번호 불일치 | 401 | `ATH_001` |
| 이메일 중복 가입 | 409 | `USR_002` |
| Access token 만료 | 401 | `CMN_007` |
| Access token 무효 | 401 | `CMN_008` |
| 보호 경로 + 토큰 없음 | 401 | `CMN_004` |
| appSlug 불일치 | 403 | `CMN_005` |
| 유저 미발견 | 404 | `USR_001` |
| Refresh token 만료 | 401 | `ATH_002` |
| Refresh token 무효 | 401 | `ATH_003` |
| 소셜 로그인 검증 실패 | 401 | `ATH_004` |
| 이메일 인증 필요 | 401 | `ATH_005` |
| 2FA 필요 | 401 | `ATH_010` |
| 이메일 발송 실패 | 502 | `EMAIL_001` |
| Rate limit 초과 | 429 | `CMN_429` (Retry-After 헤더 포함) |
| 로그인 실패 계정 잠금 | 429 | `ATH_014` (Retry-After 헤더 + `details.retryAfterSeconds`) |

전체 매핑과 근거는 [`API Response Format`](./api-response.md) 과 [`Exception Handling Convention`](../../convention/exception-handling.md) 에서 관리합니다.

### `ATH_014` (계정 잠금) 처리

`/auth/email/signin`(1단계) 과 `/auth/2fa/login`(2단계) 은 실패가 누적되면(기본 5회/15분) 계정을 일시 잠급니다. 잠금 중 요청은 요청 비밀번호·코드의 정오답과 무관하게 **429 + `ATH_014`** 를 반환하고, 응답 body 의 `error.details.retryAfterSeconds` (또는 `Retry-After` 헤더) 로 남은 시간을 알려줍니다. Flutter 는 이 값으로 카운트다운을 표시하고 재시도 버튼을 그동안 비활성화하는 걸 권장해요. 성공 시 카운터는 초기화되고, 비밀번호 재설정을 완료하면 잠금이 즉시 해제됩니다.

미처리 시에도 기존 429 공통 처리로 안전하게 degrade 하므로(요청/응답 스키마는 불변), 클라이언트 코드 변경은 선택 사항이에요.

---

## 디바이스 등록 엔드포인트

푸시 알림을 받으려면 로그인 후 디바이스를 등록해야 해요.

| Method | Path | 인증 | 설명 |
|---|---|---|---|
| POST | `/api/apps/{appSlug}/devices` | 필요 | 디바이스 등록/업데이트 |
| DELETE | `/api/apps/{appSlug}/devices/{id}` | 필요 | 디바이스 해제 (204) |

경로 상수는 `ApiEndpoints.Device` 입니다. 위치는 `common-web/.../ApiEndpoints.java` 예요.

### 등록 요청 DTO

```java
public record RegisterDeviceRequest(
    @NotBlank String platform,   // "ios" 또는 "android"
    String pushToken,            // FCM/APNs 토큰 (null 허용)
    @Size(max = 100) String deviceName  // 예: "iPhone 15 Pro"
) {}
```

### 등록 응답 DTO

```java
public record DeviceDto(
    long id,
    long userId,
    String appSlug,
    String platform,
    String pushToken,
    String deviceName,
    Instant lastSeenAt,
    Instant createdAt
) {}
```

요청 예시:

```http
POST /api/apps/sumtally/devices
Authorization: Bearer eyJhbGc...
Content-Type: application/json

{
  "platform": "ios",
  "pushToken": "abc123...",
  "deviceName": "iPhone 15 Pro"
}
```

같은 유저와 같은 appSlug, 같은 platform 조합으로 다시 등록하면 새 row 를 만들지 않고 pushToken 을 갱신해요. 이 upsert 는 `DeviceServiceImpl.register` 가 처리합니다. 먼저 `(userId, appSlug, platform)` 으로 기존 디바이스를 찾고, 있으면 토큰만 업데이트하고 없으면 새로 만드는 방식이에요.

로그아웃이나 탈퇴 시에는 해당 디바이스를 `DELETE` 로 정리하기를 권장해요. 그렇지 않으면 이 디바이스로 계속 푸시가 전달됩니다.

---

## 트러블슈팅

### 401 Unauthorized 가 계속 반환돼요

- **원인 1** — Access token 만료. Refresh token 으로 갱신이 필요해요 ([`ADR-006`](../../philosophy/adr-006-hs256-jwt.md)).
- **원인 2** — JWT 의 `appSlug` 와 URL path 의 `{appSlug}` 가 불일치. 이 경우 `AppSlugVerificationFilter` 가 403 을 반환해요 ([`ADR-012`](../../philosophy/adr-012-per-app-user-model.md)).
- **확인** — 토큰 payload 의 `appSlug` claim 과 호출한 URL path 를 비교하세요.

### 이메일 가입은 됐는데 로그인이 안 돼요

- **원인** — `emailVerified` 가 `false` 인 상태예요. verify-before-signup 가입 유저는 항상 `true` 로 생성되므로, 주로 소셜 가입 등 다른 경로 유저예요. `resend-verification` 으로 인증 메일을 다시 보내 링크 인증을 완료해야 합니다.
- **확인** — DB 의 `users.email_verified` 값이나 signup 응답의 `user.emailVerified` 를 확인하세요.

### 소셜 로그인 identity token 이 거부돼요

- **원인** — Apple/Google Console 의 Client ID 와 서버의 `APP_CREDENTIALS_<SLUG>_*` 값이 어긋났어요.
- **조치** — [`소셜 로그인 설정 가이드`](../../start/social-auth-setup.md) §4 에서 credential 을 재발급하세요.

---

## 다음 단계

- 앱별 credential 발급 — [`소셜 로그인 설정 가이드`](../../start/social-auth-setup.md)
- 인증 내부 구조 상세 — [`JWT Authentication`](../../structure/jwt-authentication.md)
- API 응답 포맷 표준 — [`API Response Format`](./api-response.md)

---

## 연관 문서

- [`API Response Format`](./api-response.md) — `{data, error}` 래퍼, JSON 필드 명명, 날짜 형식, 페이지네이션
- [`Exception Handling Convention`](../../convention/exception-handling.md) — 전체 에러 코드 목록, HTTP 매핑
- [`계약 테스트 (Contract Testing)`](../../production/test/contract-testing.md) — DTO JSON 계약 테스트 (forward compat 보장)
- [`Rate Limit 규약`](../functional/rate-limiting.md) — Rate limit 규약과 민감 엔드포인트
- [`Naming Conventions`](../../convention/naming.md) — REST URL 패턴 일반 규약
- [`Swagger UI`](./swagger-ui.md) — API 자동 탐색
