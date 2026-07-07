# JWT Authentication

> **유형**: Explanation · **독자**: Level 2 · **읽는 시간**: ~15분

**설계 근거**: [`ADR-006 · HS256 JWT`](../philosophy/adr-006-hs256-jwt.md) · [`ADR-012 · 앱별 독립 유저 모델`](../philosophy/adr-012-per-app-user-model.md) · [`ADR-013 · 앱별 인증 엔드포인트`](../philosophy/adr-013-per-app-auth-endpoints.md)

이 문서는 JWT 기반 인증 체계가 어떻게 생겼고 왜 이렇게 동작하는지 설명해요.

템플릿은 stateless JWT 인증을 기본으로 채택합니다. 서버에 세션을 저장하지 않으므로 수평 확장이 자유롭고, 모바일 앱이 메인 클라이언트인 환경에서 CORS 협상 같은 브라우저 특화 이슈를 피할 수 있어요.

---

## 한 문장 요약

JWT 기반 stateless 인증 체계는 네 개의 보안 필터와 한 개의 토큰 서비스로 구성돼요. 핵심 부품은 SecurityConfig, JwtService, JwtAuthFilter, `@CurrentUser`, appSlug 검증, Refresh Token 회전이에요.

---

## 1. 아키텍처

### SecurityConfig (Stateless)

`common/common-security/.../SecurityConfig.java` 가 Spring Security 체인을 구성합니다. 핵심 방침은 다음과 같아요.

- CSRF, Form Login, HTTP Basic 을 모두 끕니다. JWT Bearer 와 모바일 환경에서는 CSRF 토큰 메커니즘이 필요 없어요.
- `SessionCreationPolicy.STATELESS` — 서버 세션을 사용하지 않습니다.
- `/health`, `/version`, `/actuator/**`, Swagger 경로(`/v3/api-docs/**`, `/swagger-ui/**`, `/swagger-ui.html`)는 `permitAll`.
- 앱별 공개 인증 엔드포인트는 `permitAll`. 공개 경로 목록은 `ApiEndpoints.Auth.PUBLIC_PATTERNS` 한 곳에 열거돼요 ([2. 공개 경로](#공개-경로) 참조).
- 그 외 모든 요청은 `anyRequest().authenticated()` — 기본 차단 정책이에요. 새 엔드포인트는 공개 목록에 명시하지 않으면 자동으로 인증이 강제됩니다.

CORS 는 의도적으로 설정하지 않습니다. 이 템플릿은 모바일 앱을 대상으로 하고, 브라우저 클라이언트가 필요한 파생 레포는 자체 `CorsConfigurationSource` 빈과 `SecurityFilterChain` 커스터마이징을 추가합니다. 파생 레포가 자체 `SecurityFilterChain` 빈을 정의하면 `@ConditionalOnMissingBean` 이 이 기본 체인을 비활성화하므로, 빈 하나만 갈아끼우면 전체 보안 정책을 재구성할 수 있어요.

### 필터 체인

`UsernamePasswordAuthenticationFilter` 앞뒤로 네 개의 커스텀 필터가 등록됩니다.

```
[요청]
  │
  ▼
JwtAuthFilter              ← Bearer 토큰 파싱, SecurityContext 세팅
  │
  ▼
AppSlugMdcFilter           ← MDC + SlugContext 에 appSlug 주입 (로그 + schema 라우팅)
  │
  ▼
AppSlugVerificationFilter  ← JWT appSlug 와 URL path slug 대조
  │
  ▼
RateLimitFilter (선택)      ← common-web 이 classpath 에 있을 때만 활성화
  │
  ▼
[컨트롤러]
```

`RateLimitFilter` 는 인증·권한 검증을 통과한 요청만 카운트하도록 체인 끝에 위치해요. 인증 실패한 요청이 한도를 무의미하게 소진하는 걸 막기 위함입니다.

### 인증 실패 시 응답

`JsonAuthenticationEntryPoint` 가 Spring Security 의 `AuthenticationEntryPoint` 를 구현해서 인증 실패를 401 JSON 으로 반환합니다. 응답 포맷이 `ApiResponse` 와 같아 Flutter 가 일관되게 파싱할 수 있어요.

| 상황 | HTTP | ErrorCode |
|---|---|---|
| 토큰 없이 보호된 경로 호출 | 401 | `CMN_004` (UNAUTHORIZED) |
| 만료된 access token | 401 | `CMN_007` (ACCESS_TOKEN_EXPIRED) |
| 유효하지 않은 access token | 401 | `CMN_008` (ACCESS_TOKEN_INVALID) |

에러 코드 구분은 `JwtAuthFilter` 가 요청 속성 `jwt.error.code` 에 설정한 값을 `JsonAuthenticationEntryPoint` 가 읽어서 결정해요. 속성이 없으면 기본값 `CMN_004` 로 응답합니다.

---

## 2. JWT 토큰 구조

### 클레임

`JwtService.issueAccessToken` 이 발급하는 access token 의 클레임이에요.

| 클레임 | 타입 | 설명 |
|---|---|---|
| `sub` (subject) | String | 사용자 ID (양수 long 을 문자열화) |
| `email` | String | 사용자 이메일 |
| `appSlug` | String | 앱 슬러그 (단일 값, 예: `sumtally`) |
| `role` | String | 사용자 역할 (`user`, `admin` 등) |
| `iss` (issuer) | String | `app.jwt.issuer` 설정값 |
| `iat` (issued-at) | Instant | 발급 시각 |
| `exp` (expiration) | Instant | 만료 시각 |

서명 알고리즘은 HS256 입니다. `app.jwt.secret` 은 최소 32자(256 bits) 이상이어야 하고, `JwtProperties` 의 compact constructor 에서 검증해요. HS256 을 택한 근거는 [`ADR-006`](../philosophy/adr-006-hs256-jwt.md) 에 정리돼 있어요 — 발급자와 검증자가 같은 단일 JVM 이라 대칭키로 충분합니다.

정상 access token 에는 `type` 클레임이 없어요. `validateAccessToken` 은 `type` 이 있는데 그 값이 `access` 가 아니면 거부하는데, 이는 2FA 1단계 통과 후 발급되는 `type=2fa_pending` 임시 토큰을 일반 access token 으로 오인하지 않게 하려는 장치예요.

### Access Token vs Refresh Token

| | Access Token | Refresh Token |
|---|---|---|
| 형식 | JWT (HS256 서명) | 랜덤 32 bytes (base64url 인코딩) |
| 저장 | 서버에 저장 안 함 (stateless) | SHA-256 해시만 DB 저장 |
| TTL | `PT15M` (15분) | `P30D` (30일) |
| 갱신 방식 | refresh token 으로 재발급 | 회전 (rotation) |
| 위치 | `Authorization: Bearer <token>` 헤더 | 클라이언트가 보관, `/refresh` 요청 body |

TTL 은 모든 환경(local, dev, prod)에서 access 15분, refresh 30일로 동일해요. 값은 `application-local.yml`, `application-dev.yml`, `application-prod.yml` 의 `app.jwt.access-token-ttl`, `app.jwt.refresh-token-ttl` 에서 관리합니다.

---

## 3. JwtService

`common/common-security/.../jwt/JwtService.java`

io.jsonwebtoken(jjwt) 라이브러리를 사용하고, 서명 키는 `JwtProperties.secret()` 에서 `Keys.hmacShaKeyFor(...)` 로 파생해요.

### 발급

```java
// common-security/jwt/JwtService.java 발췌
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
// common-security/jwt/JwtService.java 발췌
public AuthenticatedUser validateAccessToken(String token) {
    try {
        Claims claims = Jwts.parser()
            .verifyWith(signingKey)
            .requireIssuer(properties.issuer())
            .build()
            .parseSignedClaims(token)
            .getPayload();

        // type 클레임이 있는데 "access" 가 아니면 거부 (2fa_pending 임시 토큰 차단)
        String type = claims.get("type", String.class);
        if (type != null && !"access".equals(type)) {
            throw new CommonException(CommonError.ACCESS_TOKEN_INVALID);
        }

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

검증은 서명, issuer, 만료, 타입을 차례로 확인해요. 예외 메시지에 원본 JWT 에러 내용을 포함하지 않습니다. 공격자가 서명 키 길이나 알고리즘 불일치 같은 내부 상태를 추론하지 못하게 하기 위함이에요.

> 같은 서비스에 2FA 임시 토큰 발급(`issueTwoFactorPendingToken`)과 검증(`validateTwoFactorPendingToken`)도 있어요. TTL 5분, `type=2fa_pending` 으로 발급되고, `validateAccessToken` 은 이 토큰을 거부합니다. 2FA 흐름은 [`ADR-030`](../philosophy/adr-030-2fa-totp.md) 을 참고하세요.

---

## 4. JwtAuthFilter

`common/common-security/.../jwt/JwtAuthFilter.java`

Spring 의 `OncePerRequestFilter` 를 상속하고, 요청당 정확히 한 번만 실행됩니다.

### 동작 흐름

1. `Authorization` 헤더를 확인해요.
2. 헤더가 없거나 `Bearer` 로 시작하지 않으면 (RFC 6750 에 따라 대소문자 무시) 아무 것도 하지 않고 다음 필터로 전달해요. 공개 경로면 그대로 통과하고, 인증 경로면 뒤쪽 Spring Security 가 401 을 반환합니다.
3. Bearer prefix 를 제거한 토큰을 `JwtService.validateAccessToken` 에 전달해요.
4. 성공하면 `UsernamePasswordAuthenticationToken` 을 만들어 `SecurityContextHolder` 에 저장합니다. Principal 은 `AuthenticatedUser`, Authority 는 `ROLE_<role 대문자>` 형태예요.
5. 실패하면 `SecurityContextHolder.clearContext()` 로 컨텍스트를 비우고 `jwt.error.code` 요청 속성에 에러 코드(`CMN_007` 또는 `CMN_008`)를 설정해요. 그 뒤 Spring Security 체인이 `JsonAuthenticationEntryPoint` 를 통해 401 응답을 생성합니다.

필터는 직접 응답을 쓰지 않습니다. 인증·인가 처리를 Spring Security 에 위임해야 `authorizeHttpRequests(...)` 의 `permitAll` 설정과 일관되게 동작해요.

---

## 5. @CurrentUser 어노테이션

### AuthenticatedUser

`common/common-security/.../AuthenticatedUser.java`

```java
// common-security/AuthenticatedUser.java 발췌
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

`Principal` 을 구현해서 `getName()` 이 `userId` 문자열을 반환합니다. 만약 `Principal` 을 구현하지 않으면 Spring Security 가 `principal.toString()` 으로 fall through 하고, record 의 기본 `toString()` 이 email, appSlug, role 까지 노출해서 감사 로그나 rate limit 키에 민감 정보가 새어나갈 수 있어요.

### @CurrentUser

`common/common-security/.../CurrentUser.java`

```java
// common-security/CurrentUser.java 발췌
@Target(ElementType.PARAMETER)
@Retention(RetentionPolicy.RUNTIME)
public @interface CurrentUser {
    boolean required() default true;
}
```

### 사용 예시

```java
// 인증 필수 — 미인증이면 CommonException(UNAUTHORIZED)
@GetMapping("/me")
public ApiResponse<UserDto> getMe(@CurrentUser AuthenticatedUser user) {
    return ApiResponse.ok(userService.findProfileById(user.userId()));
}

// 선택적 인증 — 미인증이면 null 주입
@GetMapping("/feed")
public ApiResponse<FeedDto> getFeed(@CurrentUser(required = false) AuthenticatedUser user) {
    ...
}
```

### CurrentUserArgumentResolver

`common/common-security/.../CurrentUserArgumentResolver.java` 가 `HandlerMethodArgumentResolver` 를 구현해서 주입을 담당합니다.

```java
// common-security/CurrentUserArgumentResolver.java 발췌
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

등록 순서가 중요해요. `SecurityAutoConfiguration.currentUserArgumentResolverPostProcessor()` 가 `BeanPostProcessor` 로 `RequestMappingHandlerAdapter.customArgumentResolvers` 맨 앞에 리졸버를 삽입합니다. 그래야 Spring 내장 `ModelAttributeMethodProcessor` 보다 먼저 매칭되어, `AuthenticatedUser` 가 query parameter 바인딩 대상이 되는 보안적으로 위험한 실수를 막을 수 있어요.

---

## 6. appSlug 검증

### AppSlugVerificationFilter

`common/common-security/.../AppSlugVerificationFilter.java`

URL path `/api/apps/{slug}/...` 의 slug 와 JWT 의 `appSlug` 클레임이 일치하는지 대조합니다. 불일치 시 403 Forbidden 을 JSON 바디와 함께 반환해요.

```java
// common-security/AppSlugVerificationFilter.java 발췌
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

이 검증이 있어야 sumtally 앱 JWT 로 gymlog 엔드포인트를 호출하는 cross-app 공격을 차단할 수 있어요. 경로 분리만으로는 경계가 강제되지 않는다는 점은 [`ADR-013`](../philosophy/adr-013-per-app-auth-endpoints.md) 에 자세히 정리돼 있어요 — 이 필터와 공유 Controller 는 한 쌍으로 동작합니다.

Path slug 추출은 `common/common-web/.../AppSlugExtractor.java` 의 정규식 `^/api/apps/([a-z][a-z0-9-]*)/` 를 사용합니다. `/api/apps/` 가 없는 경로(health, swagger 등)와 미인증 요청은 검증을 건너뛰어요. 미인증 요청은 뒤에서 `anyRequest().authenticated()` 가 401 로 처리합니다.

### AppSlugMdcFilter

이 필터는 두 가지 일을 합니다.

- **로그 라벨** — MDC 에 `appSlug` 를 넣어 로그를 앱별로 필터링할 수 있게 해요. Logback 패턴에서 `%X{appSlug:-}` 로 참조하고, Loki appender 가 라벨로 승격합니다.
- **schema 라우팅** — `SlugContext` 의 ThreadLocal 에 같은 슬러그를 주입해, `SchemaRoutingDataSource` 가 connection 을 잡을 때 슬러그별 DataSource 로 분기하게 해요 ([`ADR-018`](../philosophy/adr-018-schema-routing-datasource.md), [`Multi-tenant Architecture`](./multitenant-architecture.md) 참조).

슬러그 해석 순서는 다음과 같아요.

1. `SecurityContextHolder` 의 `AuthenticatedUser.appSlug()` (인증된 요청)
2. URL path 에서 추출 (미인증 요청 fallback)
3. 둘 다 없으면 MDC/SlugContext 주입을 생략 — 이후 DB 접근이 일어나면 routing 시점에 fail-secure 로 실패합니다 ([`ADR-037`](../philosophy/adr-037-core-schema-deprecation.md)). actuator 같은 비인증 엔드포인트는 DB 접근이 없어 문제되지 않아요.

`JwtAuthFilter` 뒤, `AppSlugVerificationFilter` 앞에 위치해야 SecurityContext 가 이미 채워진 상태에서 동작해요.

<a id="공개-경로"></a>

### 공개 경로 (PUBLIC_PATTERNS)

`common/common-web/.../ApiEndpoints.java` 의 `Auth.PUBLIC_PATTERNS` 가 토큰 없이 호출 가능한 인증 엔드포인트를 한 곳에 모읍니다. 모두 `/api/apps/*/auth/...` 패턴이에요.

| 공개 경로 | 용도 |
|---|---|
| `/email/signup`, `/email/signin` | 이메일 가입·로그인 |
| `/apple`, `/google`, `/kakao`, `/naver` | 소셜 로그인 (자격 증명 설정 시) |
| `/refresh` | refresh token 회전 |
| `/verify-email` | 이메일 인증 |
| `/password-reset/**` | 비밀번호 재설정 요청·확인 |
| `/2fa/login` | 2FA 1단계 통과 후 정식 토큰 발급 |
| `/phone/**` | 휴대폰 점유인증 (옵트인, [`ADR-038`](../philosophy/adr-038-sms-phone-auth.md)) |

`withdraw`, `resend-verification`, `password`(변경), 2FA setup/verify/disable 은 공개 목록에 없어 인증이 필요해요. 새 엔드포인트는 이 목록에 추가하지 않으면 기본 차단 정책에 따라 자동으로 보호됩니다.

---

## 7. PasswordHasher

`common/common-security/.../PasswordHasher.java`

Spring Security 의 `BCryptPasswordEncoder` 를 감싼 유틸리티예요. `SecurityAutoConfiguration` 이 빈으로 등록합니다.

```java
// common-security/PasswordHasher.java 발췌
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

- Strength 12 는 2^12 회 반복이에요. 브루트포스 저항성과 성능(약 200~300ms/hash)의 균형점입니다.
- BCrypt 는 내부적으로 per-hash salt 를 포함하므로 별도 salt 저장이 필요 없어요.
- 비밀번호 원문이나 해시 값은 절대 로그에 기록하지 않습니다.

---

## 8. Refresh Token 회전

`core/core-auth-impl/.../service/RefreshTokenService.java`

### 저장 방식

`RefreshToken` 엔티티(`.../entity/RefreshToken.java`)의 주요 컬럼이에요.

| 컬럼 | 설명 |
|---|---|
| `token_hash` | raw token 의 SHA-256 hex (64 chars). unique index 로 O(1) 조회 |
| `family_id` | 회전 체인을 추적하는 UUID |
| `issued_at`, `expires_at` | 발급·만료 시각 |
| `used_at` | 회전에 사용된 시각. 두 번째 사용이 감지되면 탈취로 판정 |
| `revoked_at` | 명시적 무효화 시각 (탈퇴, 비밀번호 변경, 탈취 감지) |

Raw token 은 DB 에 저장하지 않습니다. 클라이언트에게 발급한 직후 SHA-256 해시만 남기고 원본은 잊어버려요.

BCrypt 가 아닌 SHA-256 을 쓰는 이유는 조회 방식 때문이에요. BCrypt 는 per-hash salt 라 동일 raw token 이라도 해시가 매번 달라서 unique index 조회가 불가능합니다. SHA-256 은 deterministic 이라 O(1) indexed lookup 이 가능해요.

Raw token 자체는 `TokenGenerator.generateRawToken()` 이 `SecureRandom` 으로 32 bytes 를 생성해 base64url 인코딩한 값입니다.

```java
// core-auth-impl/service/TokenGenerator.java 발췌
public static String generateRawToken() {
    byte[] bytes = new byte[DEFAULT_TOKEN_BYTES];
    SECURE_RANDOM.nextBytes(bytes);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
}
```

### 발급 흐름

#### 신규 로그인 — `issueForNewLogin`

1. raw refresh token 을 생성해요 (32 bytes, base64url).
2. 해시를 계산하고 새 `family_id`(UUID)를 부여한 `RefreshToken` 엔티티를 저장합니다.
3. `JwtService.issueAccessToken` 으로 access token 을 발급해요.
4. `AuthTokens(accessToken, rawToken)` 을 반환합니다.

#### 회전 — `rotate`

```java
// core-auth-impl/service/RefreshTokenService.java 발췌
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

재사용 탐지(reuse detection)가 핵심이에요. 이미 회전에 사용된(`used_at IS NOT NULL`) token 이 또 들어오면 탈취로 판정합니다. 이 경우 같은 `family_id` 의 모든 active token 을 `REQUIRES_NEW` 트랜잭션으로 분리해 무효화해요. 별도 트랜잭션을 쓰는 이유는, 현재 트랜잭션이 exception 으로 rollback 되더라도 revoke 는 독립 커밋으로 유지되어야 하기 때문이에요.

정상 회전 시에는 old token 에 `used_at` 을 기록하고, 같은 `family_id` 로 새 token 을 발급하며, 새 access token 도 함께 발급합니다. 이때 최신 email 과 role 은 `UserPort` 로 조회해요.

> refresh token 의 만료·무효는 `AuthError.TOKEN_EXPIRED`(ATH_002), `AuthError.INVALID_TOKEN`(ATH_003) 으로 표현돼요. access token 의 `CMN_007`/`CMN_008` 과는 별개 코드입니다.

#### 전체 무효화 — `revokeAllForUser`

탈퇴나 비밀번호 변경처럼 전역 무효화가 필요할 때, 유저의 모든 active refresh token 을 한 번에 무효화해요.

```java
// core-auth-impl/service/RefreshTokenService.java 발췌
public int revokeAllForUser(long userId) {
    return refreshTokenRepository.revokeAllByUserId(userId);
}
```

---

## 9. 설정 프로퍼티

### JwtProperties

`common/common-security/.../jwt/JwtProperties.java`

```java
// common-security/jwt/JwtProperties.java 전체
@ConfigurationProperties("app.jwt")
public record JwtProperties(
    String secret,
    Duration accessTokenTtl,
    Duration refreshTokenTtl,
    String issuer,
    Duration adminAccessTokenTtl
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
        if (adminAccessTokenTtl == null || adminAccessTokenTtl.isZero() || adminAccessTokenTtl.isNegative()) {
            throw new IllegalArgumentException("app.jwt.admin-access-token-ttl must be positive");
        }
    }
}
```

Compact constructor 가 보안 필수 조건을 강제합니다. 애플리케이션 부팅 시점에 잘못된 설정이 즉시 실패하므로, production 에서 토큰 검증이 약하게 동작하는 상황을 만들 수 없어요.

`adminAccessTokenTtl` 은 운영 콘솔(superadmin) 전용 TTL 이에요 — `JwtService.issueAdminAccessToken` 이 이 값을 쓰고, 앱 유저용 `issueAccessToken` 은 계속 `accessTokenTtl`(15분)을 씁니다. 콘솔 세션이 앱 유저 TTL 에 종속되어 15분마다 재로그인해야 했던 문제를 이렇게 분리했어요. 자세한 흐름은 [`운영 콘솔 API`](../api-and-functional/admin-console.md) §2-2 참고.

### YAML 예시

```yaml
# application-local.yml (개발자 맥북 docker)
app:
  jwt:
    secret: ${JWT_SECRET:dev-secret-that-is-at-least-32-characters-long-for-testing}
    access-token-ttl: PT15M
    refresh-token-ttl: P30D
    issuer: ${JWT_ISSUER:app-factory-local}
    admin-access-token-ttl: ${JWT_ADMIN_ACCESS_TTL:PT12H}
```

```yaml
# application-dev.yml (Mac mini dev 서버, production-like)
# application-prod.yml (운영)
app:
  jwt:
    secret: ${JWT_SECRET}         # default 없음 — 주입 누락 시 즉시 실패
    access-token-ttl: PT15M
    refresh-token-ttl: P30D
    issuer: ${JWT_ISSUER:app-factory-dev}   # prod 는 app-factory
    admin-access-token-ttl: ${JWT_ADMIN_ACCESS_TTL:PT12H}
```

dev(Mac mini)와 prod 는 default 값 없이 `${VAR}` strict 방식을 써서 환경변수 주입이 빠지면 즉시 실패하도록 합니다 — 운영 안전망이에요. issuer 만 prod(`app-factory`)와 dev(`app-factory-dev`)로 분리해서 토큰 출처를 구별해요. `admin-access-token-ttl` 은 세 환경 모두 `${JWT_ADMIN_ACCESS_TTL:PT12H}` 로 동일한 default(12시간)를 두고, 필요하면 환경변수로 override 할 수 있어요.

---

## 관련 문서

- [`ADR-006 · HS256 JWT`](../philosophy/adr-006-hs256-jwt.md) — HS256 대칭키 채택 결정과 키 로테이션 전략
- [`ADR-012 · 앱별 독립 유저 모델`](../philosophy/adr-012-per-app-user-model.md) — 앱별 독립 유저 모델 + `appSlug` claim
- [`ADR-013 · 앱별 인증 엔드포인트`](../philosophy/adr-013-per-app-auth-endpoints.md) — 공유 Controller + 공통 AuthPort + 경계 강제
- [`Multi-tenant Architecture`](./multitenant-architecture.md) — 앱별 DataSource 분리 구현
- [`Flutter ↔ Backend Integration`](../api-and-functional/api/flutter-backend-integration.md) — 클라이언트 401 처리 규약
- [`키 교체 절차 (Key Rotation)`](../production/setup/key-rotation.md) — `JWT_SECRET` 회전 절차

---

## 10. 관련 파일

| 파일 | 역할 |
|---|---|
| `common-security/.../jwt/JwtService.java` | 토큰 발급·검증 (HS256) |
| `common-security/.../jwt/JwtProperties.java` | `@ConfigurationProperties("app.jwt")` |
| `common-security/.../jwt/JwtAuthFilter.java` | Bearer 토큰 파싱, SecurityContext 설정 |
| `common-security/.../SecurityConfig.java` | Stateless 필터 체인 구성 |
| `common-security/.../SecurityAutoConfiguration.java` | 빈 등록 + ArgumentResolver BeanPostProcessor |
| `common-security/.../AuthenticatedUser.java` | Principal 구현 record |
| `common-security/.../CurrentUser.java` | 컨트롤러 파라미터 어노테이션 |
| `common-security/.../CurrentUserArgumentResolver.java` | SecurityContext → `AuthenticatedUser` 주입 |
| `common-security/.../AppSlugVerificationFilter.java` | JWT appSlug 와 URL path 검증 (403) |
| `common-security/.../AppSlugMdcFilter.java` | MDC 로그 라벨 + SlugContext schema 라우팅 |
| `common-security/.../JsonAuthenticationEntryPoint.java` | 401 JSON 응답 생성 |
| `common-security/.../PasswordHasher.java` | BCrypt strength 12 |
| `common-web/.../ApiEndpoints.java` | 엔드포인트 경로 상수 + `Auth.PUBLIC_PATTERNS` |
| `common-web/.../AppSlugExtractor.java` | `/api/apps/{slug}/` 정규식 |
| `core-auth-impl/.../service/RefreshTokenService.java` | refresh token 발급·회전·탈취 감지 |
| `core-auth-impl/.../service/RefreshTokenIssuer.java` | refresh 발급 계약 (인터페이스) |
| `core-auth-impl/.../service/TokenGenerator.java` | `SecureRandom` + SHA-256 유틸 |
| `core-auth-impl/.../entity/RefreshToken.java` | JPA 엔티티 (token_hash / family_id / used_at / revoked_at) |
| `core-auth-impl/.../repository/RefreshTokenRepository.java` | `findByTokenHash`, `revokeAllByFamilyId`, `revokeAllByUserId` |
</content>
</invoke>
