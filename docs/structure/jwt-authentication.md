# JWT Authentication

> **유형**: Explanation · **독자**: Level 2 · **읽는 시간**: ~15분

**설계 근거**: [ADR-006 (HS256 JWT)](../philosophy/adr-006-hs256-jwt.md) · [ADR-012 (앱별 독립 유저 모델)](../philosophy/adr-012-per-app-user-model.md)

이 문서는 JWT 기반 인증 체계의 구조와 사용법을 설명합니다.

템플릿은 **Stateless JWT 인증** 을 기본으로 채택합니다. 서버에 세션을 저장하지 않으므로 수평 확장이 자유롭고, 모바일 앱이 메인 클라이언트인 환경에서 CORS 협상 같은 브라우저 특화 이슈를 피할 수 있습니다.

---

## 한 문장 요약

이 문서는 **JWT 기반 stateless 인증** 체계의 구조와 사용법을 설명합니다. SecurityConfig · JwtService · JwtAuthFilter · @CurrentUser · appSlug 검증 · Refresh Token 회전까지.

---

## 1. 아키텍처

### SecurityConfig (Stateless)

`common/common-security/.../SecurityConfig.java` 가 Spring Security 체인을 구성합니다.

핵심 방침:

- CSRF, Form Login, HTTP Basic **비활성화**
- `SessionCreationPolicy.STATELESS` — 서버 세션 사용 안 함
- `/health`, `/version`, `/actuator/**`, `/swagger-ui/**` 은 `permitAll`
- 앱별 인증 엔드포인트 (`/api/apps/*/auth/email/signup`, `.../email/signin`, `.../apple`, `.../google`, `.../refresh`, `.../verify-email`, `.../password-reset/**`) 은 `permitAll` (공개 경로는 `ApiEndpoints.Auth.PUBLIC_PATTERNS` 에 열거)
- 그 외 모든 요청은 `authenticated()`

**CORS 는 의도적으로 설정하지 않습니다.** 이 템플릿은 모바일 앱을 대상으로 하며, 브라우저 클라이언트가 필요한 파생 레포는 자체 `CorsConfigurationSource` 빈과 `SecurityFilterChain` 커스터마이징을 추가합니다.

### 필터 체인

`UsernamePasswordAuthenticationFilter` 앞뒤로 네 개의 커스텀 필터가 등록됩니다.

```
[요청]
  │
  ▼
JwtAuthFilter              ← Bearer 토큰 파싱, SecurityContext 세팅
  │
  ▼
AppSlugMdcFilter           ← 로그용 MDC 에 appSlug 주입
  │
  ▼
AppSlugVerificationFilter  ← JWT appSlug 와 URL path slug 대조
  │
  ▼
RateLimitFilter (optional) ← common-web 있을 때만 활성화
  │
  ▼
[컨트롤러]
```

### 인증 실패 시 응답

`JsonAuthenticationEntryPoint` 가 Spring Security 의 `AuthenticationEntryPoint` 를 구현하여 인증 실패를 JSON 으로 반환합니다.

| 상황 | HTTP | ErrorCode |
|---|---|---|
| 토큰 없음, 보호된 경로 호출 | 401 | `CMN_004` (UNAUTHORIZED) |
| 만료된 access token | 401 | `CMN_007` (ACCESS_TOKEN_EXPIRED) |
| 유효하지 않은 access token | 401 | `CMN_008` (ACCESS_TOKEN_INVALID) |

에러 코드 구분은 `JwtAuthFilter` 가 요청 속성 `jwt.error.code` 에 설정한 값을 `JsonAuthenticationEntryPoint` 가 읽어서 결정합니다.

---

## 2. JWT 토큰 구조

### 클레임

`JwtService.issueAccessToken` 이 발급하는 access token 의 클레임입니다.

| 클레임 | 타입 | 설명 |
|---|---|---|
| `sub` (subject) | String | 사용자 ID (양수 long 을 문자열화) |
| `email` | String | 사용자 이메일 |
| `appSlug` | String | 앱 슬러그 (단일 값, 예: `sumtally`) |
| `role` | String | 사용자 역할 (`user`, `admin` 등) |
| `iss` (issuer) | String | `app.jwt.issuer` 설정값 |
| `iat` (issued-at) | Instant | 발급 시각 |
| `exp` (expiration) | Instant | 만료 시각 |

**서명 알고리즘은 HS256** 입니다. `app.jwt.secret` 은 최소 32자 (256 bits) 이상이어야 합니다 — `JwtProperties` 의 compact constructor 에서 검증합니다.

### Access Token vs Refresh Token

| | Access Token | Refresh Token |
|---|---|---|
| 형식 | JWT (HS256 서명) | 랜덤 32 bytes (base64url 인코딩) |
| 저장 | 서버에 저장하지 않음 (stateless) | SHA-256 해시만 DB 저장 |
| TTL (dev) | `PT15M` (15분) | `P30D` (30일) |
| TTL (prod) | `PT15M` (15분) | `P30D` (30일) |
| 갱신 방식 | refresh token 으로 재발급 | 회전 (rotation) |
| 위치 | `Authorization: Bearer <token>` 헤더 | 클라이언트가 보관, `/refresh` 요청 body |

TTL 설정은 `application-dev.yml`, `application-prod.yml` 의 `app.jwt.access-token-ttl`, `app.jwt.refresh-token-ttl` 에서 관리합니다.

---

## 3. JwtService

`common/common-security/.../jwt/JwtService.java`

io.jsonwebtoken (jjwt) 라이브러리를 사용하며, 서명 키는 `JwtProperties.secret()` 으로부터 `Keys.hmacShaKeyFor(...)` 로 파생합니다.

### 발급

```java
public String issueAccessToken(long userId, String email, String appSlug, String role) {
    Instant now = Instant.now();
    Instant expiresAt = now.plus(properties.accessTokenTtl());

    return Jwts.builder()
        .subject(String.valueOf(userId))
        .claim("email", email)
        .claim("appSlug", appSlug)
        .claim("role", role)
        .issuer(properties.issuer())
        .issuedAt(Date.from(now))
        .expiration(Date.from(expiresAt))
        .signWith(signingKey, Jwts.SIG.HS256)
        .compact();
}
```

### 검증

```java
public AuthenticatedUser validateAccessToken(String token) {
    try {
        Claims claims = Jwts.parser()
            .verifyWith(signingKey)
            .requireIssuer(properties.issuer())
            .build()
            .parseSignedClaims(token)
            .getPayload();

        long userId = Long.parseLong(claims.getSubject());
        String email = claims.get("email", String.class);
        String appSlug = claims.get("appSlug", String.class);
        String role = claims.get("role", String.class);

        return new AuthenticatedUser(userId, email, appSlug, role);
    } catch (ExpiredJwtException e) {
        throw new CommonException(CommonError.ACCESS_TOKEN_EXPIRED);
    } catch (JwtException | IllegalArgumentException e) {
        throw new CommonException(CommonError.ACCESS_TOKEN_INVALID);
    }
}
```

**예외 메시지에 원본 JWT 에러 내용을 포함하지 않습니다.** 공격자가 서명 키 길이, 알고리즘 불일치 등 내부 상태를 추론하지 못하게 하기 위함입니다.

---

## 4. JwtAuthFilter

`common/common-security/.../jwt/JwtAuthFilter.java`

Spring 의 `OncePerRequestFilter` 를 상속하며, 요청당 정확히 한 번만 실행됩니다.

### 동작 흐름

1. `Authorization` 헤더를 확인합니다.
2. 헤더가 없거나 `Bearer ` 로 시작하지 않으면 (RFC 6750 에 따라 대소문자 무시) 아무 것도 하지 않고 다음 필터로 전달합니다. 공개 경로면 그대로 통과, 인증 경로면 뒤쪽 Spring Security 가 401 을 반환합니다.
3. Bearer prefix 를 제거한 토큰을 `JwtService.validateAccessToken` 에 전달합니다.
4. 성공하면 `UsernamePasswordAuthenticationToken` 을 만들어 `SecurityContextHolder` 에 저장합니다. Principal 은 `AuthenticatedUser`, Authority 는 `ROLE_<role.toUpperCase()>` 형태입니다.
5. 실패하면 `SecurityContextHolder.clearContext()` 로 컨텍스트를 비우고 `jwt.error.code` 요청 속성에 에러 코드 (`CMN_007` 또는 `CMN_008`) 를 설정합니다. 그 후 Spring Security 체인이 `JsonAuthenticationEntryPoint` 를 통해 401 응답을 생성합니다.

**필터에서 직접 응답을 쓰지 않습니다.** 인증/인가 처리는 Spring Security 에 위임해야 `.authorizeHttpRequests(...)` 의 `permitAll` 설정과 일관되게 동작합니다.

---

## 5. @CurrentUser 어노테이션

### AuthenticatedUser

`common/common-security/.../AuthenticatedUser.java`

```java
public record AuthenticatedUser(
    long userId,
    String email,
    String appSlug,
    String role
) implements Principal {
    public AuthenticatedUser {
        if (userId <= 0) throw new IllegalArgumentException("userId must be positive");
        Objects.requireNonNull(email, "email");
        Objects.requireNonNull(appSlug, "appSlug");
        if (appSlug.isBlank()) throw new IllegalArgumentException("appSlug must not be blank");
        role = role == null || role.isBlank() ? "user" : role;
    }

    @Override
    public String getName() {
        return String.valueOf(userId);
    }

    public boolean isAdmin() {
        return "admin".equalsIgnoreCase(role);
    }
}
```

`Principal` 을 구현하여 `getName()` 이 `userId` 문자열을 반환합니다. `Principal` 을 구현하지 않으면 Spring Security 가 `principal.toString()` 을 호출해 record 의 기본 `toString()` 이 email/appSlug/role 까지 노출시키므로 감사 로그, rate limit 키 등에 민감 정보가 새어나갈 수 있습니다.

### @CurrentUser

`common/common-security/.../CurrentUser.java`

```java
@Target(ElementType.PARAMETER)
@Retention(RetentionPolicy.RUNTIME)
public @interface CurrentUser {
    boolean required() default true;
}
```

### 사용 예시

```java
// 인증 필수
@GetMapping("/me")
public ApiResponse<UserDto> getMe(@CurrentUser AuthenticatedUser user) {
    return ApiResponse.ok(userService.findProfileById(user.userId()));
}

// 선택적 인증 (인증되지 않은 경우 null 주입)
@GetMapping("/feed")
public ApiResponse<FeedDto> getFeed(@CurrentUser(required = false) AuthenticatedUser user) {
    ...
}
```

### CurrentUserArgumentResolver

`common/common-security/.../CurrentUserArgumentResolver.java` 가 `HandlerMethodArgumentResolver` 를 구현하여 주입을 담당합니다.

```java
@Override
public Object resolveArgument(MethodParameter parameter, ...) {
    Authentication auth = SecurityContextHolder.getContext().getAuthentication();
    boolean authenticated = auth != null && auth.isAuthenticated()
        && auth.getPrincipal() instanceof AuthenticatedUser;

    if (!authenticated) {
        CurrentUser annotation = parameter.getParameterAnnotation(CurrentUser.class);
        if (annotation != null && annotation.required()) {
            throw new CommonException(CommonError.UNAUTHORIZED);
        }
        return null;
    }
    return (AuthenticatedUser) auth.getPrincipal();
}
```

**등록 순서가 중요합니다.** `SecurityAutoConfiguration.currentUserArgumentResolverPostProcessor()` 가 `BeanPostProcessor` 로 `RequestMappingHandlerAdapter.customArgumentResolvers` 맨 앞에 리졸버를 삽입합니다. 그렇게 해야 Spring 내장 `ModelAttributeMethodProcessor` 보다 먼저 매칭되어 `AuthenticatedUser` 가 query parameter 바인딩 대상이 되는 실수를 막습니다.

---

## 6. appSlug 검증

### AppSlugVerificationFilter

`common/common-security/.../AppSlugVerificationFilter.java`

URL path `/api/apps/{slug}/...` 의 slug 와 JWT 의 `appSlug` 클레임이 일치하는지 대조합니다. 불일치 시 **403 Forbidden** 을 반환합니다 (JSON 바디 포함).

```java
if (!pathSlug.equals(user.appSlug())) {
    response.setStatus(HttpServletResponse.SC_FORBIDDEN);
    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
    ApiError error = ApiError.of(CommonError.FORBIDDEN.getCode(),
        "app mismatch: JWT issued for '" + user.appSlug() + "' but accessing '" + pathSlug + "'");
    ApiResponse<Void> body = ApiResponse.error(error);
    response.getWriter().write(objectMapper.writeValueAsString(body));
    return;
}
```

이렇게 해야 sumtally 앱 JWT 로 gymlog 엔드포인트를 호출하는 cross-app 공격을 차단할 수 있습니다.

Path slug 추출은 `common/common-web/.../AppSlugExtractor.java` 의 정규식 `^/api/apps/([a-z][a-z0-9-]*)/` 을 사용합니다. `/api/apps/` 가 없는 경로 (health, swagger 등) 는 검증을 건너뜁니다.

### AppSlugMdcFilter

로그 라인에 `appSlug` 라벨을 주입합니다. Logback 패턴에서 `%X{appSlug:-}` 로 참조하며, Loki appender 가 라벨로 승격합니다.

해석 순서:
1. `SecurityContextHolder` 의 `AuthenticatedUser.appSlug()` (인증된 요청)
2. URL path 에서 추출 (미인증 요청 fallback)
3. 둘 다 없으면 MDC 주입 생략

`JwtAuthFilter` 뒤, `AppSlugVerificationFilter` 앞에 위치해야 SecurityContext 가 이미 채워진 상태에서 동작합니다.

---

## 7. PasswordHasher

`common/common-security/.../PasswordHasher.java`

Spring Security 의 `BCryptPasswordEncoder` 를 wrap 한 유틸리티입니다.

```java
public final class PasswordHasher {
    private static final int STRENGTH = 12;
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(STRENGTH);

    public String hash(String rawPassword) {
        if (rawPassword == null || rawPassword.isBlank()) {
            throw new IllegalArgumentException("password must not be blank");
        }
        return encoder.encode(rawPassword);
    }

    public boolean verify(String rawPassword, String hashedPassword) {
        if (rawPassword == null || hashedPassword == null) {
            return false;
        }
        return encoder.matches(rawPassword, hashedPassword);
    }
}
```

- **Strength 12** — 2^12 회 반복. 브루트포스 공격에 대한 충분한 저항성과 성능 (약 200~300ms/hash) 의 균형점입니다.
- BCrypt 는 내부적으로 per-hash salt 를 포함하므로 별도 salt 저장이 필요 없습니다.
- 비밀번호 원문이나 해시 값은 절대 로그에 기록하지 않습니다.

---

## 8. Refresh Token 회전

`core/core-auth-impl/.../service/RefreshTokenService.java`

### 저장 방식

`RefreshToken` 엔티티 (`.../entity/RefreshToken.java`) 의 주요 컬럼:

| 컬럼 | 설명 |
|---|---|
| `token_hash` | raw token 의 SHA-256 hex (64 chars). unique index 로 O(1) 조회 |
| `family_id` | 회전 체인을 추적하는 UUID |
| `issued_at`, `expires_at` | 발급 / 만료 시각 |
| `used_at` | 회전에 사용된 시각. 두 번째 사용이 감지되면 탈취로 판정 |
| `revoked_at` | 명시적 무효화 시각 (탈퇴, 비밀번호 변경, 탈취 감지) |

**Raw token 은 DB 에 저장하지 않습니다.** 클라이언트에게 발급 직후 SHA-256 해시만 남기고 원본은 잊어버립니다.

BCrypt 가 아닌 SHA-256 을 사용하는 이유: BCrypt 는 per-hash salt 때문에 동일 raw token 이라도 해시가 매번 달라 unique index 조회 불가. SHA-256 은 deterministic 이므로 O(1) indexed lookup 가능.

Raw token 자체는 `TokenGenerator.generateRawToken()` 이 `SecureRandom` 으로 32 bytes 를 생성해 base64url 인코딩한 값입니다.

```java
// core-auth-impl/.../service/TokenGenerator.java
public static String generateRawToken() {
    byte[] bytes = new byte[DEFAULT_TOKEN_BYTES];
    SECURE_RANDOM.nextBytes(bytes);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
}
```

### 발급 흐름

#### 신규 로그인 — `issueForNewLogin`

1. raw refresh token 을 생성합니다 (32 bytes, base64url).
2. 해시를 계산하고 새 `family_id` (UUID) 를 부여한 `RefreshToken` 엔티티를 저장합니다.
3. `JwtService.issueAccessToken` 으로 access token 을 발급합니다.
4. `AuthTokens(accessToken, rawToken)` 을 반환합니다.

#### 회전 — `rotate`

```java
public AuthTokens rotate(String rawRefreshToken, String appSlug) {
    String incomingHash = TokenGenerator.sha256Hex(rawRefreshToken);

    RefreshToken existing = refreshTokenRepository.findByTokenHash(incomingHash)
        .orElseThrow(() -> new AuthException(AuthError.INVALID_TOKEN));

    if (existing.isRevoked()) {
        throw new AuthException(AuthError.INVALID_TOKEN);
    }

    if (existing.isUsed()) {
        // 탈취 감지 — family 전체 무효화
        String familyId = existing.getFamilyId();
        revokeTransactionTemplate.executeWithoutResult(status -> {
            refreshTokenRepository.revokeAllByFamilyId(familyId);
        });
        throw new AuthException(AuthError.INVALID_TOKEN);
    }

    if (existing.isExpired()) {
        throw new AuthException(AuthError.TOKEN_EXPIRED);
    }

    existing.markUsed();
    // ... 같은 family_id 로 새 token 발급
}
```

**Reuse detection:** 이미 한 번 회전에 사용된 (`used_at IS NOT NULL`) token 이 또 들어오면 탈취로 판정합니다. 이 경우 같은 `family_id` 의 모든 active token 을 `REQUIRES_NEW` 트랜잭션으로 분리하여 무효화합니다. 별도 트랜잭션을 사용하는 이유는 현재 트랜잭션이 exception 으로 rollback 되더라도 revoke 는 독립 커밋으로 유지되어야 하기 때문입니다.

정상 회전 시:
- old token 에 `used_at` 을 기록합니다.
- 같은 `family_id` 로 새 token 을 발급합니다.
- 새 access token 도 함께 발급합니다 (`UserPort` 로 최신 email/role 조회).

#### 전체 무효화 — `revokeAllForUser`

탈퇴, 비밀번호 변경 등 전역 무효화가 필요할 때 유저의 모든 active refresh token 을 한 번에 무효화합니다.

```java
public int revokeAllForUser(long userId) {
    return refreshTokenRepository.revokeAllByUserId(userId);
}
```

---

## 9. 설정 프로퍼티

### JwtProperties

`common/common-security/.../jwt/JwtProperties.java`

```java
@ConfigurationProperties("app.jwt")
public record JwtProperties(
    String secret,
    Duration accessTokenTtl,
    Duration refreshTokenTtl,
    String issuer
) {
    public JwtProperties {
        if (secret == null || secret.length() < 32) {
            throw new IllegalArgumentException("app.jwt.secret must be at least 32 characters (256 bits) for HS256");
        }
        if (accessTokenTtl == null || accessTokenTtl.isZero() || accessTokenTtl.isNegative()) {
            throw new IllegalArgumentException("app.jwt.access-token-ttl must be positive");
        }
        if (refreshTokenTtl == null || refreshTokenTtl.isZero() || refreshTokenTtl.isNegative()) {
            throw new IllegalArgumentException("app.jwt.refresh-token-ttl must be positive");
        }
        if (issuer == null || issuer.isBlank()) {
            throw new IllegalArgumentException("app.jwt.issuer must not be blank");
        }
    }
}
```

Compact constructor 에서 보안 필수 조건을 강제합니다. 애플리케이션이 부팅되는 시점에 잘못된 설정은 즉시 실패하므로 "production 에서 토큰 검증이 약하게 동작" 하는 상황을 만들 수 없습니다.

### YAML 예시

```yaml
# application-dev.yml
app:
  jwt:
    secret: ${JWT_SECRET:dev-secret-that-is-at-least-32-characters-long-for-testing}
    access-token-ttl: PT15M
    refresh-token-ttl: P30D
    issuer: ${JWT_ISSUER:app-factory-dev}
```

```yaml
# application-prod.yml
app:
  jwt:
    secret: ${JWT_SECRET}         # default 없음 — 주입 누락 시 즉시 실패
    access-token-ttl: PT15M
    refresh-token-ttl: P30D
    issuer: ${JWT_ISSUER:app-factory}
```

Prod 는 default 값 없이 `${VAR}` strict 방식을 사용해 환경변수 주입이 빠지면 즉시 실패하도록 만듭니다 — 운영 안전망입니다.

---

## 관련 문서

- [`../journey/philosophy/adr-006-hs256-jwt.md`](../philosophy/adr-006-hs256-jwt.md) — HS256 채택 결정
- [`../journey/philosophy/adr-012-per-app-user-model.md`](../philosophy/adr-012-per-app-user-model.md) — 앱별 독립 유저 모델 + `appSlug` claim
- [`./multitenant-architecture.md`](./multitenant-architecture.md) — 앱별 DataSource 분리 구현
- [`../api-contract/flutter-backend-integration.md`](../api-and-functional/api/flutter-backend-integration.md) — 클라이언트 401 처리 규약

---

## 10. 관련 파일

| 파일 | 역할 |
|---|---|
| `common-security/.../jwt/JwtService.java` | 토큰 발급/검증 (HS256) |
| `common-security/.../jwt/JwtProperties.java` | `@ConfigurationProperties("app.jwt")` |
| `common-security/.../jwt/JwtAuthFilter.java` | Bearer 토큰 파싱, SecurityContext 설정 |
| `common-security/.../SecurityConfig.java` | Stateless 필터 체인 구성 |
| `common-security/.../SecurityAutoConfiguration.java` | 빈 등록 + ArgumentResolver BeanPostProcessor |
| `common-security/.../AuthenticatedUser.java` | Principal 구현 record |
| `common-security/.../CurrentUser.java` | 컨트롤러 파라미터 어노테이션 |
| `common-security/.../CurrentUserArgumentResolver.java` | SecurityContext → `AuthenticatedUser` 주입 |
| `common-security/.../AppSlugVerificationFilter.java` | JWT appSlug vs URL path 검증 (403) |
| `common-security/.../AppSlugMdcFilter.java` | MDC 로 로그 appSlug 주입 |
| `common-security/.../JsonAuthenticationEntryPoint.java` | 401 JSON 응답 생성 |
| `common-security/.../PasswordHasher.java` | BCrypt strength 12 |
| `core-auth-impl/.../service/RefreshTokenService.java` | refresh token 발급/회전/탈취 감지 |
| `core-auth-impl/.../service/RefreshTokenIssuer.java` | refresh 발급 계약 (인터페이스) |
| `core-auth-impl/.../service/TokenGenerator.java` | `SecureRandom` + SHA-256 유틸 |
| `core-auth-impl/.../entity/RefreshToken.java` | JPA 엔티티 (token_hash / family_id / used_at / revoked_at) |
| `core-auth-impl/.../repository/RefreshTokenRepository.java` | `findByTokenHash`, `revokeAllByFamilyId`, `revokeAllByUserId` |
