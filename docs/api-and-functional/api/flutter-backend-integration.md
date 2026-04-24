# Flutter ↔ Backend Integration

> **유형**: How-to · **독자**: Level 1~2 · **읽는 시간**: ~10분

**설계 근거**: [ADR-013 (앱별 인증 엔드포인트)](../../philosophy/adr-013-per-app-auth-endpoints.md) · [ADR-006 (HS256 JWT)](../../philosophy/adr-006-hs256-jwt.md)

이 문서는 Flutter 앱이 `spring-backend-template` 기반 백엔드와 통신할 때 알아야 할 **백엔드 관점의 계약** 을 설명합니다. 엔드포인트 경로, 인증 방식, 토큰 갱신 규약, appSlug 매칭 규칙 등이 포함됩니다.

응답 포맷의 세부 구조(`{data, error}`)는 [API Response Format](./api-response.md), 에러 코드 체계는 [Exception Handling Convention](../../convention/exception-handling.md) 에서 관리하므로 중복되지 않게 **Flutter 입장에서 특별히 알아야 할 것** 만 정리합니다.

---

## 개요

Flutter 앱이 `spring-backend-template` 기반 백엔드와 통신할 때 알아야 할 **백엔드 관점의 계약**. URL 규칙 · 인증 엔드포인트 · Bearer 토큰 · 401 처리 · appSlug 검증.

---

## 기본 URL 규칙

### 앱별 스코프 (대부분의 엔드포인트)

```
/api/apps/{appSlug}/{resource}
```

- `{appSlug}` 는 해당 앱의 slug (예: `sumtally`, `gymlog`). **소문자/숫자/밑줄** 조합.
- `{resource}` 는 도메인 (예: `auth`, `devices`, `expenses`).

모든 인증, 디바이스, 도메인 엔드포인트는 이 규칙을 따릅니다. 한 백엔드가 여러 앱을 서비스하므로 path 에 slug 가 박혀 있어야 앱별로 분리됩니다.

### 전역 스코프 (인프라/유저 프로필)

```
/health         # 인증 불필요
/version        # 인증 불필요
/actuator/**    # prod 에서는 별도 포트로 분리
/v3/api-docs/** # Swagger
/swagger-ui/**  # Swagger UI

/api/core/users/me  # 현재 유저 프로필 (JWT 필요) — 앱 slug 불포함
```

`UserController` 는 `/api/core/users/me` 라는 전역 경로를 쓰고 있습니다. JWT 에 담긴 `userId` 로 조회하므로 path slug 가 필요하지 않습니다.

---

## 인증 엔드포인트

아래 경로들은 `ApiEndpoints.Auth` 상수의 단일 정본입니다 (`common-web/src/main/java/.../ApiEndpoints.java`). Flutter 쪽 경로 상수도 이와 1:1 로 맞추는 것을 권장합니다.

| Method | Path | 인증 | 설명 |
|---|---|---|---|
| POST | `/api/apps/{appSlug}/auth/email/signup` | 불필요 | 이메일 가입 (201) |
| POST | `/api/apps/{appSlug}/auth/email/signin` | 불필요 | 이메일 로그인 |
| POST | `/api/apps/{appSlug}/auth/apple` | 불필요 | Apple 로그인 |
| POST | `/api/apps/{appSlug}/auth/google` | 불필요 | Google 로그인 |
| POST | `/api/apps/{appSlug}/auth/refresh` | 불필요 | 토큰 갱신 |
| POST | `/api/apps/{appSlug}/auth/withdraw` | 필요 | 회원 탈퇴 (204) |
| POST | `/api/apps/{appSlug}/auth/verify-email` | 불필요 | 이메일 인증 (204) |
| POST | `/api/apps/{appSlug}/auth/resend-verification` | 필요 | 인증 메일 재발송 (204) |
| POST | `/api/apps/{appSlug}/auth/password-reset/request` | 불필요 | 재설정 메일 발송 (204) |
| POST | `/api/apps/{appSlug}/auth/password-reset/confirm` | 불필요 | 토큰으로 재설정 (204) |
| PATCH | `/api/apps/{appSlug}/auth/password` | 필요 | 비밀번호 변경 (204) |

**인증 불필요** 경로는 `SecurityConfig` 의 `ApiEndpoints.Auth.PUBLIC_PATTERNS` 에 등록되어 JWT 없이 호출 가능합니다.

### 템플릿 상태에서의 노출 여부

`AuthController` (`core-auth-impl`) 의 주석에 명시되어 있듯, 이 컨트롤러는 **런타임에 직접 등록되지 않습니다**. `new-app.sh` 가 앱 모듈을 생성할 때 앱별 복제본 (`apps/app-<slug>/auth/<Slug>AuthController.java`) 을 만들고, path 의 `{appSlug}` 를 실제 slug 로 치환합니다.

즉, **템플릿 상태(앱 0개)에서는 인증 엔드포인트가 전혀 노출되지 않고**, 존재하지 않는 slug 호출은 404 가 됩니다.

---

## 요청/응답 DTO 구조

DTO 는 모두 `core-auth-api/src/main/java/.../dto/` 에 있는 Java record 입니다. Flutter 쪽에서는 필드명과 타입만 맞춰 동일한 구조로 매핑하면 됩니다.

### SignUpRequest

```java
public record SignUpRequest(
    @Email @NotBlank String email,
    @NotBlank @Size(min = 8, max = 72) String password,
    @NotBlank @Size(max = 30) String displayName,
    @NotBlank String appSlug
) {}
```

요청 예시:

```http
POST /api/apps/sumtally/auth/email/signup
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123",
  "displayName": "홍길동",
  "appSlug": "sumtally"
}
```

`appSlug` 는 **body 에도 넣고 path 에도 있는데** 이는 중복이 아닙니다. Path 는 라우팅 대상이고, body 의 `appSlug` 는 서비스 레이어가 토큰 발급 시 포함할 값으로 사용합니다. 두 값은 일치해야 합니다.

### SignInRequest

```java
public record SignInRequest(
    @Email @NotBlank String email,
    @NotBlank String password,
    @NotBlank String appSlug
) {}
```

### AuthResponse

로그인/가입 성공 시 반환되는 복합 응답입니다.

```java
public record AuthResponse(
    UserSummary user,
    AuthTokens tokens
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

### AppleSignInRequest

첫 로그인과 이후 로그인의 payload 가 다릅니다. Apple 이 **첫 로그인 시에만** 일부 필드를 제공하므로, Flutter 는 첫 응답을 로컬에 저장하고 있다가 서버에 그대로 전달해야 합니다.

```java
public record AppleSignInRequest(
    @NotBlank String identityToken,
    String authorizationCode,   // 첫 로그인에만 (Revoke Tokens 용 — Phase 1)
    String firstName,           // 첫 로그인에만
    String lastName,            // 첫 로그인에만
    String email,               // 첫 로그인에만
    String nonce,               // 첫 로그인에만
    @NotBlank String appSlug
) {}
```

### GoogleSignInRequest

```java
public record GoogleSignInRequest(
    @NotBlank String idToken,
    @NotBlank String appSlug
) {}
```

### RefreshRequest

```java
public record RefreshRequest(
    @NotBlank String refreshToken,
    @NotBlank String appSlug
) {}
```

`/auth/refresh` 응답은 `AuthTokens` 만 (유저 정보 없이):

```json
{
  "data": {
    "accessToken": "<jwt-access-token-placeholder>",
    "refreshToken": "<refresh-token-placeholder>"
  },
  "error": null
}
```

**Refresh 는 회전(rotation)이 일어납니다.** 요청에 쓴 refresh token 은 즉시 무효화되고 새 refresh token 이 발급됩니다. Flutter 는 반드시 응답의 새 값으로 교체해야 합니다. 옛 값을 재사용하면 탈취 감지가 발동해 해당 family 전체가 revoke 됩니다.

### 기타 DTO

```java
// 이메일 인증
public record VerifyEmailRequest(@NotBlank String token) {}

// 비밀번호 재설정 요청 (이메일)
public record PasswordResetRequest(@Email @NotBlank String email) {}

// 비밀번호 재설정 확인 (토큰 + 새 비밀번호)
public record PasswordResetConfirmRequest(
    @NotBlank String token,
    @NotBlank @Size(min = 8, max = 72) String newPassword
) {}

// 로그인 상태에서 비밀번호 변경
public record ChangePasswordRequest(
    @NotBlank String currentPassword,
    @NotBlank @Size(min = 8, max = 72) String newPassword
) {}

// 탈퇴 (사유는 optional)
public record WithdrawRequest(
    @Size(max = 500) String reason
) {}
```

---

## Bearer 토큰 인증

인증이 필요한 엔드포인트는 `Authorization` 헤더에 Bearer 토큰을 포함해야 합니다.

```http
GET /api/apps/sumtally/users/me
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...
```

JWT access token 의 claim 구조 (`JwtService.issueAccessToken` 참조):

```json
{
  "sub": "123",               // userId
  "email": "user@example.com",
  "appSlug": "sumtally",      // 발급 당시 앱 slug
  "role": "user",
  "iss": "app-factory-dev",   // JWT_ISSUER
  "iat": 1234567890,
  "exp": 1234568790           // access TTL 15분
}
```

- **Access token TTL:** 기본 `PT15M` (15분). `app.jwt.access-token-ttl` 로 변경 가능.
- **Refresh token TTL:** 기본 `P30D` (30일). `app.jwt.refresh-token-ttl` 로 변경 가능.

토큰 서명과 검증은 `common-security/src/main/java/.../jwt/JwtService.java` 가 담당합니다.

---

## 401 응답 처리 — Flutter 쪽 분기 규약

401 Unauthorized 는 하나의 상태 코드 아래 여러 의미가 있으므로, Flutter 는 **HTTP 상태가 아니라 `error.code` 값으로 분기** 해야 합니다.

| error.code | 의미 | Flutter 권장 동작 |
|---|---|---|
| `CMN_004` | 토큰 없음 (보호된 경로에 인증 미포함) | 로그인 화면으로 이동 |
| `CMN_007` | Access token 만료 | **자동으로 `/auth/refresh` 호출 → 성공 시 원 요청 재시도** |
| `CMN_008` | Access token 무효 (위변조 등) | 강제 로그아웃 + 로그인 화면 |
| `ATH_001` | 이메일/비밀번호 불일치 | 입력 오류 메시지 표시 |
| `ATH_002` | Refresh/verify/reset 토큰 만료 | 재로그인 유도 |
| `ATH_003` | Refresh/verify/reset 토큰 무효 | 재로그인 유도 |
| `ATH_004` | Apple/Google 검증 실패 | 소셜 로그인 재시도 |
| `ATH_005` | 이메일 미인증 | 인증 안내 화면 |

### 추천 흐름

```
요청 전송
  ├─ 200 → 정상 처리
  ├─ 401 + CMN_007 (access 만료)
  │    └─ /auth/refresh 호출
  │         ├─ 200 → 새 토큰 저장 → 원 요청 재시도
  │         └─ 401 + ATH_002 또는 ATH_003 → 강제 로그아웃
  ├─ 401 + CMN_008 → 강제 로그아웃
  ├─ 403 + CMN_005 → appSlug 불일치 또는 권한 없음 (아래 참조)
  └─ 기타 → 일반 에러 처리
```

**주의:** `/auth/refresh` 자체가 401 을 반환하면 (`ATH_002`/`ATH_003`) 더 시도하지 말고 즉시 로그아웃 상태로 전환해야 합니다. 그렇지 않으면 무한 루프가 발생합니다.

---

## appSlug 검증 규칙

`/api/apps/{appSlug}/...` 경로에 요청할 때, **URL 의 appSlug 는 JWT 의 `appSlug` claim 과 일치해야** 합니다.

이 검증은 `common-security/src/main/java/.../AppSlugVerificationFilter.java` 가 수행합니다. 불일치 시 403 Forbidden 을 반환합니다.

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

- 한 앱에서 발급된 토큰으로 다른 앱의 엔드포인트를 호출할 수 없습니다.
- 멀티 앱 동시 로그인이 필요하면 앱별로 토큰을 별도 관리해야 합니다 (이 템플릿은 기본적으로 한 앱 = 한 토큰 전제).
- `CMN_005` 를 받았을 때 재시도해도 무의미합니다. 현재 활성 토큰을 파기하고 해당 앱으로 재로그인하는 흐름을 권장합니다.

---

## HTTP 상태 코드 + 에러 코드 매핑

Flutter 가 자주 받게 될 응답 조합만 요약합니다.

| 상황 | HTTP | error.code |
|---|---|---|
| 가입 성공 | 201 | — |
| 로그인 성공 / 토큰 갱신 성공 | 200 | — |
| 탈퇴/인증/재설정 성공 (body 없음) | 204 | — |
| 이메일 형식 오류 | 422 | `CMN_001` |
| 비밀번호 불일치 | 401 | `ATH_001` |
| 이메일 중복 가입 | 409 | `USR_002` |
| Access token 만료 | 401 | `CMN_007` |
| Access token 무효 | 401 | `CMN_008` |
| 보호 경로 + 토큰 없음 | 401 | `CMN_004` |
| appSlug 불일치 | 403 | `CMN_005` |
| 유저 미발견 | 404 | `USR_001` |
| Refresh token 만료 | 401 | `ATH_002` |
| Refresh token 무효 | 401 | `ATH_003` |
| Apple/Google 검증 실패 | 401 | `ATH_004` |
| 이메일 인증 필요 | 401 | `ATH_005` |
| 이메일 발송 실패 | 503 | `ATH_006` |
| Rate limit 초과 | 429 | `CMN_429` (Retry-After 헤더 포함) |

전체 매핑과 이유는 [API Response Format](./api-response.md) 및 [Exception Handling Convention](../../convention/exception-handling.md) 에서 관리합니다.

---

## 디바이스 등록 엔드포인트

푸시 알림을 받기 위해 로그인 후 디바이스를 등록해야 합니다.

| Method | Path | 인증 | 설명 |
|---|---|---|---|
| POST | `/api/apps/{appSlug}/devices` | 필요 | 디바이스 등록/업데이트 |
| DELETE | `/api/apps/{appSlug}/devices/{id}` | 필요 | 디바이스 해제 (204) |

경로 상수는 `ApiEndpoints.Device` (`common-web/.../ApiEndpoints.java`).

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

**같은 유저 + 같은 appSlug + 같은 platform 조합은 유니크 제약(`uk_devices_user_app_platform`)** 으로 관리되어, 동일 조합으로 다시 등록하면 pushToken 을 업데이트합니다 (실제 upsert 는 `DevicePort.register` 가 처리).

로그아웃/탈퇴 시 해당 디바이스를 `DELETE` 로 삭제하는 것이 권장됩니다. 그렇지 않으면 이 디바이스로 계속 푸시가 전달됩니다.

---

## 트러블슈팅

### 401 Unauthorized 계속 반환

- **원인 1**: Access Token 만료 → Refresh Token 으로 갱신 필요 ([ADR-006](../../philosophy/adr-006-hs256-jwt.md))
- **원인 2**: JWT 의 `appSlug` 와 URL path 의 `{appSlug}` 불일치 → `AppSlugVerificationFilter` 가 403 반환 ([ADR-012](../../philosophy/adr-012-per-app-user-model.md))
- **확인**: 토큰 payload 의 `appSlug` claim 과 호출한 URL path 비교

### 이메일 가입이 200 인데 로그인 안 됨

- **원인**: `email_verified: false` 상태. 이메일 인증 링크 클릭 필요.
- **확인**: DB 의 `users.email_verified` 값 또는 signup 응답의 `user.emailVerified`

### 소셜 로그인 identity token 거부됨

- **원인**: Apple/Google Console 의 Client ID 와 서버 `APP_CREDENTIALS_<SLUG>_*` 불일치
- **조치**: [소셜 로그인 설정 가이드](../../start/social-auth-setup.md) §4 에서 credential 재발급

## 다음 단계

- 앱별 credential 발급: [소셜 로그인 설정 가이드](../../start/social-auth-setup.md)
- 인증 내부 구조 상세: [JWT Authentication](../../structure/jwt-authentication.md)
- API 응답 포맷 표준: [API Response Format](./api-response.md)

---

## 연관 문서

- [API Response Format](./api-response.md) — `{data, error}` 래퍼, JSON 필드 명명, 날짜 형식, 페이지네이션
- [Exception Handling Convention](../../convention/exception-handling.md) — 전체 에러 코드 목록, HTTP 매핑
- [계약 테스트 (Contract Testing)](../../production/test/contract-testing.md) — DTO JSON 계약 테스트 (forward compat 보장)
- [Rate Limit 규약](../functional/rate-limiting.md) — Rate limit 규약과 민감 엔드포인트
- [Naming Conventions](../../convention/naming.md) — REST URL 패턴 일반 규약
