# Email Verification & Delivery

> **유형**: How-to · **독자**: Level 2 · **읽는 시간**: ~12분

**설계 근거**: [`ADR-006 (HS256 JWT)`](../../philosophy/adr-006-hs256-jwt.md) · [`ADR-013 (앱별 인증 엔드포인트)`](../../philosophy/adr-013-per-app-auth-endpoints.md)

이 문서는 이메일 발송 아키텍처와 이메일 인증/비밀번호 재설정 플로우를 정리합니다.

템플릿은 트랜잭셔널 이메일을 **Port/Adapter 패턴**으로 추상화합니다. 도메인 서비스(`EmailVerificationService`, `PasswordResetService`) 는 `EmailPort` 인터페이스만 의존하고, 실제 발송은 `ResendEmailAdapter` 가 [Resend](https://resend.com) HTTP API 로 수행합니다.

---

## 개요

**이메일 발송 아키텍처** (Resend + EmailPort) 와 **이메일 인증 / 비밀번호 재설정 플로우** 구현 가이드. 토큰 생성 · TTL · Reference 컨트롤러 매핑.

---

## 이메일 발송 아키텍처

```
[EmailVerificationService]
[PasswordResetService]     ──► EmailPort.send(to, subject, htmlBody)
                                   │
                                   └─► ResendEmailAdapter ──► Resend HTTP API
```

| 모듈 | 역할 |
|---|---|
| `core/core-auth-api` | `EmailPort` 인터페이스, `AuthError` |
| `core/core-auth-impl/email` | `ResendEmailAdapter`, `ResendProperties` |
| `core/core-auth-impl/service` | `EmailVerificationService`, `PasswordResetService`, `VerificationEmailSender` |

### EmailPort

인터페이스는 최소한으로 설계되었습니다. HTML 본문과 수신자, 제목만 받습니다.

```java
// core/core-auth-api/src/main/java/com/factory/core/auth/api/EmailPort.java
public interface EmailPort {

    /**
     * HTML 형식의 이메일 발송.
     *
     * @throws com.factory.core.auth.api.exception.AuthException
     *         발송 실패 시 (AuthError.EMAIL_DELIVERY_FAILED)
     */
    void send(String to, String subject, String htmlBody);
}
```

첨부 파일, multipart text/html, BCC 같은 고급 기능은 템플릿에 포함되지 않습니다. 필요하다면 `EmailPort` 를 확장하거나 별도의 port 를 추가하는 것이 자연스럽습니다.

---

## Resend 연동

### 자격 증명 설정

`ResendProperties` 는 `app.email.resend` prefix 의 설정을 읽습니다.

```java
// core/core-auth-impl/src/main/java/com/factory/core/auth/impl/email/ResendProperties.java
@ConfigurationProperties("app.email.resend")
public record ResendProperties(String apiKey, String fromAddress, String fromName) {
    public ResendProperties {
        Objects.requireNonNull(apiKey, "app.email.resend.api-key must be configured");
        Objects.requireNonNull(fromAddress, "app.email.resend.from-address must be configured");
    }
}
```

### application.yml

```yaml
app:
  email:
    resend:
      api-key: ${RESEND_API_KEY}
      from-address: noreply@example.com
      from-name: My App     # 선택 — 생략 시 from-address 만 표기
```

`apiKey` 와 `fromAddress` 는 필수입니다. 앱 기동 시 null 이면 즉시 실패하여 **설정 누락을 runtime 이 아닌 startup 에서 발견**할 수 있습니다.

Resend 대시보드에서 발신 도메인을 먼저 등록(SPF/DKIM 검증) 해야 `fromAddress` 로 설정한 주소에서 실제 발송이 가능합니다. 대시보드 > API Keys 메뉴에서 `re_` 로 시작하는 API 키를 발급받아 환경변수로 주입합니다.

### ResendEmailAdapter

Java 표준 `HttpClient` 를 써서 별도 SDK 의존을 피했습니다.

```java
// core/core-auth-impl/src/main/java/com/factory/core/auth/impl/email/ResendEmailAdapter.java
public class ResendEmailAdapter implements EmailPort {

    private static final String RESEND_API_URL = "https://api.resend.com/emails";

    @Override
    public void send(String to, String subject, String htmlBody) {
        String from = properties.fromName() != null
                ? properties.fromName() + " <" + properties.fromAddress() + ">"
                : properties.fromAddress();

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(RESEND_API_URL))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + properties.apiKey())
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();

        HttpResponse<String> response;
        try {
            response = sendRequest(request);
        } catch (IOException e) {
            throw new AuthException(AuthError.EMAIL_DELIVERY_FAILED, e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AuthException(AuthError.EMAIL_DELIVERY_FAILED, e);
        }

        int statusCode = response.statusCode();
        if (statusCode < 200 || statusCode >= 300) {
            throw new AuthException(AuthError.EMAIL_DELIVERY_FAILED);
        }
    }
    // ...
}
```

2xx 가 아닌 응답이나 I/O 예외는 모두 `AuthException(AuthError.EMAIL_DELIVERY_FAILED)` 로 변환되어 HTTP 503 응답으로 이어집니다.

`sendRequest` 는 protected 로 노출되어 있어 테스트에서 spy 로 stub 할 수 있습니다.

### 자동 구성 (graceful + 운영 안전망)

`AuthAutoConfiguration` 이 환경에 따라 두 어댑터 중 하나를 등록합니다.

```java
// core/core-auth-impl/src/main/java/com/factory/core/auth/impl/AuthAutoConfiguration.java

// (1) Resend API key 가 비어있지 않을 때만 ResendEmailAdapter 등록
@Bean
@ConditionalOnExpression("'${app.email.resend.api-key:}' != ''")
@ConditionalOnMissingBean(EmailPort.class)
public ResendEmailAdapter resendEmailAdapter(ResendProperties resendProperties) {
    return new ResendEmailAdapter(resendProperties);
}

// (2) dev / local 환경 fallback — key 가 비어있을 때 LoggingEmailAdapter 등록
@Bean
@Profile("!prod")
@ConditionalOnMissingBean(EmailPort.class)
public LoggingEmailAdapter loggingEmailAdapter() {
    return new LoggingEmailAdapter();
}
```

| 환경 | Resend key | 등록 어댑터 | 부팅 |
|---|---|---|---|
| dev / local | 있음 | `ResendEmailAdapter` | OK — 실제 발송 |
| dev / local | 없음 | `LoggingEmailAdapter` | OK — 메일이 콘솔 로그로 출력 |
| prod | 있음 | `ResendEmailAdapter` | OK — 실제 발송 |
| prod | 없음 | (없음) | **부팅 실패** — `application-prod.yml` 의 strict `${RESEND_API_KEY}` placeholder 가 풀리지 않아 의도된 안전망 |

테스트 등에서 `EmailPort` 를 mock 으로 주입하면 `@ConditionalOnMissingBean` 이 두 어댑터 등록을 모두 생략합니다.

#### LoggingEmailAdapter (dev fallback)

`RESEND_API_KEY` 가 비어있는 dev / local 환경에서 활성됩니다. 실제 메일을 발송하지 않고 수신자/제목/HTML 본문을 `WARN` 로그로 출력합니다 — 인증 링크나 비밀번호 재설정 링크를 콘솔에서 바로 확인 가능.

```
[DEV-EMAIL] Email captured to logs (Resend API key not configured)
  To: user@example.com
  Subject: 이메일 인증을 완료해주세요
  Body:
  <a href="https://localhost:8081/auth/verify?token=abc123...">이메일 인증하기</a>
```

#### dev 응답에 raw token 노출

`LoggingEmailAdapter` 의 `isDevCapture()` 가 `true` 를 반환하므로 호출자는 raw token 을 응답으로 노출할 수 있습니다 (운영 어댑터는 항상 `false` — 노출 안 됨).

| 엔드포인트 | 노출 위치 | 형태 |
|---|---|---|
| `POST /auth/email/signup` | 응답 body | `AuthResponse.devVerificationToken` (`@JsonInclude(NON_NULL)`) |
| `POST /auth/password-reset/request` | 응답 헤더 | `X-Dev-Reset-Token: <raw>` |
| `POST /auth/resend-verification` | 응답 헤더 | `X-Dev-Verification-Token: <raw>` |

dev 환경에서 swagger UI 로 회원가입 → 응답 body 의 `devVerificationToken` 을 그대로 복사하여 즉시 `verify-email` 호출 가능. 별도 메일 수신이나 로그 파싱 불필요.

운영(prod profile + Resend key 있음) 환경에서는 위 필드/헤더가 항상 비어있습니다 — `ResendEmailAdapter.isDevCapture()` 가 `false` 라서 호출자가 토큰을 무시합니다.

> ⚠️ **테스트 통과 ≠ 운영 가용성**: dev 모드에서 회원가입 / 비밀번호 재설정 플로우가 동작한다고 운영에서도 동작한다는 뜻이 아닙니다. 운영은 `RESEND_API_KEY` 가 반드시 채워져 있어야 부팅됩니다 (yml strict placeholder 가 부팅을 막음).

### 다른 이메일 SaaS 사용 시

`EmailPort` 는 추상화되어 있어 SendGrid, AWS SES, Mailgun, SMTP 등 다른 서비스로 교체 가능합니다. 자기 어댑터를 등록하면 `ResendEmailAdapter` / `LoggingEmailAdapter` 둘 다 자동으로 비활성됩니다 (`@ConditionalOnMissingBean(EmailPort.class)` 패턴).

```java
@Component
public class SendGridEmailAdapter implements EmailPort {
    @Override
    public void send(String to, String subject, String htmlBody) {
        // SendGrid SDK 또는 HTTP API 호출
    }

    // dev 응답 노출이 필요하면 isDevCapture() override.
    // 보통은 운영 어댑터이므로 default(false) 유지.
}
```

별도 설정/배제 작업 불필요 — 빈을 등록하기만 하면 자동 라우팅됩니다.

---

## 이메일 인증 플로우

가입 시점에 랜덤 토큰을 발급하고, 유저가 이메일 링크를 클릭하면 토큰을 검증하여 `email_verified = true` 로 전환합니다.

### 1. 가입 시 인증 메일 발송

`EmailAuthService.signUp` 이 유저 생성 후 `VerificationEmailSender` 에 위임합니다. `EmailVerificationService` 가 해당 인터페이스를 구현합니다.

```java
// core/core-auth-impl/src/main/java/com/factory/core/auth/impl/service/EmailAuthService.java
public AuthResponse signUp(SignUpRequest request) {
    String passwordHash = passwordHasher.hash(request.password());
    UserSummary user = userPort.createUserWithPassword(
        request.email(), passwordHash, request.displayName()
    );

    AuthTokens tokens = refreshTokenIssuer.issueForNewLogin(
        user.id(), user.email(), request.appSlug(), "user"
    );

    // 인증 메일 발송 (실패해도 가입은 성공)
    try {
        verificationEmailSender.sendVerificationEmail(user.id(), user.email());
    } catch (RuntimeException e) {
        log.warn("verification email failed for user {}: {}",
            user.id(), e.getClass().getSimpleName());
    }

    return new AuthResponse(user, tokens);
}
```

**이메일 발송 실패가 가입을 막지 않는다**는 점이 중요합니다. 유저는 이미 access/refresh token 을 받은 상태이고, 나중에 `POST /auth/resend-verification` 으로 재요청할 수 있습니다.

### 2. 토큰 생성과 저장

`EmailVerificationService.sendVerificationEmail` 이 토큰을 만들어 DB 에 저장하고 이메일로 발송합니다.

```java
// core/core-auth-impl/src/main/java/com/factory/core/auth/impl/service/EmailVerificationService.java
public void sendVerificationEmail(long userId, String email) {
    String rawToken = TokenGenerator.generateRawToken();
    String tokenHash = TokenGenerator.sha256Hex(rawToken);
    Instant expiresAt = Instant.now().plus(tokenTtl);

    EmailVerificationToken entity = new EmailVerificationToken(userId, tokenHash, expiresAt);
    tokenRepository.save(entity);

    String verificationLink = appDomain + "/auth/verify?token=" + rawToken;
    String subject = "이메일 인증을 완료해주세요";
    String htmlBody = buildVerificationEmailHtml(verificationLink);

    emailPort.send(email, subject, htmlBody);
    log.debug("Verification email sent to userId={}", userId);
}
```

핵심 보안 규칙은 **raw token 은 이메일 본문에만 들어가고, DB 에는 SHA-256 해시만 저장** 한다는 것입니다. DB 가 유출되어도 해시에서 raw token 을 역산할 수 없습니다.

`TokenGenerator` 는 `SecureRandom` 으로 32바이트 엔트로피를 만들고 URL-safe Base64 로 인코딩합니다.

```java
// core/core-auth-impl/src/main/java/com/factory/core/auth/impl/service/TokenGenerator.java
public static String generateRawToken() {
    byte[] bytes = new byte[DEFAULT_TOKEN_BYTES];
    SECURE_RANDOM.nextBytes(bytes);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
}
```

### 3. 토큰 엔티티

```java
// core/core-auth-impl/src/main/java/com/factory/core/auth/impl/entity/EmailVerificationToken.java
@Entity
@Table(name = "email_verification_tokens")
public class EmailVerificationToken {

    @Column(name = "token_hash", nullable = false, length = 64)
    private String tokenHash;  // SHA-256 hex (64 chars)

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "used_at")
    private Instant usedAt;
    // ...
}
```

- `usedAt` 이 null 이 아니면 이미 사용된 토큰 — 재사용 불가
- `expiresAt` 이 현재보다 과거면 만료

### 4. 링크 클릭 → 토큰 검증

유저가 이메일에서 링크를 클릭하면 클라이언트가 `POST /api/apps/{appSlug}/auth/verify-email` 을 호출합니다.

```java
// core/core-auth-impl/src/main/java/com/factory/core/auth/impl/service/EmailVerificationService.java
public long verify(String rawToken) {
    String tokenHash = TokenGenerator.sha256Hex(rawToken);

    EmailVerificationToken token = tokenRepository.findByTokenHash(tokenHash)
        .orElseThrow(() -> new AuthException(AuthError.INVALID_TOKEN));

    if (token.isUsed()) {
        throw new AuthException(AuthError.INVALID_TOKEN);
    }

    if (token.isExpired()) {
        throw new AuthException(AuthError.TOKEN_EXPIRED);
    }

    token.markUsed();
    return token.getUserId();
}
```

검증 성공 시 `markUsed()` 로 재사용을 막습니다. 호출자(`AuthServiceImpl`) 는 반환된 `userId` 로 `User.emailVerified = true` 를 설정합니다.

### TTL 설정

기본 TTL 은 **24시간**이며 `app.auth.email-verification-ttl` 로 override 할 수 있습니다.

```java
// core/core-auth-impl/src/main/java/com/factory/core/auth/impl/service/EmailVerificationService.java
public static final Duration DEFAULT_TOKEN_TTL = Duration.ofHours(24);
```

```java
// AuthAutoConfiguration
@Value("${app.auth.email-verification-ttl:PT24H}") Duration emailVerificationTtl
```

---

## 비밀번호 재설정 플로우

"비밀번호를 잊었습니다" 플로우는 이메일 인증과 같은 토큰 메커니즘을 공유하되, TTL 이 짧고 추가로 세션을 전부 무효화합니다.

### 1. 재설정 요청 (`POST /auth/password-reset/request`)

```java
// core/core-auth-impl/src/main/java/com/factory/core/auth/impl/service/PasswordResetService.java
public void requestReset(String email) {
    Optional<UserAccount> userOpt = userPort.findAccountByEmail(email);

    if (userOpt.isEmpty()) {
        log.debug("Password reset requested for non-existent email "
                + "(suppressed for enumeration protection)");
        return;  // 이메일 존재 여부를 노출하지 않음
    }

    UserAccount user = userOpt.get();

    String rawToken = TokenGenerator.generateRawToken();
    String tokenHash = TokenGenerator.sha256Hex(rawToken);
    Instant expiresAt = Instant.now().plus(tokenTtl);

    PasswordResetToken entity = new PasswordResetToken(user.id(), tokenHash, expiresAt);
    tokenRepository.save(entity);

    String resetLink = appDomain + "/auth/password-reset?token=" + rawToken;
    String subject = "비밀번호를 재설정하세요";
    String htmlBody = buildResetEmailHtml(resetLink);

    try {
        emailPort.send(email, subject, htmlBody);
    } catch (RuntimeException e) {
        log.warn("Password reset email delivery failed for userId={}: {}",
            user.id(), e.getClass().getSimpleName());
        // 이메일 발송 실패해도 토큰은 이미 생성됨 — 유저가 재요청하면 됨
    }
}
```

**이메일 열거(enumeration) 방어**가 핵심 설계입니다. 존재하지 않는 이메일로 요청이 와도 예외를 던지지 않고 조용히 리턴합니다. 응답이 동일해야 공격자가 "어떤 이메일이 가입되어 있는가" 를 탐지하지 못합니다.

### 2. 재설정 확인 (`POST /auth/password-reset/confirm`)

```java
public void confirmReset(String rawToken, String newPassword) {
    String tokenHash = TokenGenerator.sha256Hex(rawToken);

    PasswordResetToken token = tokenRepository.findByTokenHash(tokenHash)
        .orElseThrow(() -> new AuthException(AuthError.INVALID_TOKEN));

    if (token.isUsed()) {
        throw new AuthException(AuthError.INVALID_TOKEN);
    }

    if (token.isExpired()) {
        throw new AuthException(AuthError.TOKEN_EXPIRED);
    }

    token.markUsed();

    // 비밀번호 변경 — UserPort 를 통해
    String newHash = passwordHasher.hash(newPassword);
    userPort.updatePassword(token.getUserId(), newHash);

    // 모든 세션 무효화 — 보안 조치
    refreshTokenService.revokeAllForUser(token.getUserId());

    log.info("Password reset completed for userId={}", token.getUserId());
}
```

비밀번호 변경이 성공하면 **해당 유저의 모든 refresh token 을 무효화** 합니다. 계정이 탈취되어 공격자가 비밀번호를 바꿨더라도, 정상 유저가 재설정을 수행하는 순간 공격자의 모든 세션이 끊기게 하기 위함입니다.

### TTL 설정

비밀번호 재설정 토큰은 TTL 이 **1시간**으로 더 짧습니다.

```java
public static final Duration DEFAULT_TOKEN_TTL = Duration.ofHours(1);
```

override: `app.auth.password-reset-ttl` (`PT1H` ISO-8601 duration 형식).

---

## Reference 컨트롤러 매핑

`core/core-auth-impl` 의 `AuthController` 는 런타임에 등록되지 않는 **레퍼런스 소스**입니다. 실제 엔드포인트는 `new-app.sh` 가 각 앱 모듈에 복사한 `<Slug>AuthController` 가 담당합니다.

관련 엔드포인트는 다음과 같습니다 (`ApiEndpoints.Auth`).

| 경로 | 설명 | 인증 |
|---|---|---|
| `POST /api/apps/{slug}/auth/email/signup` | 가입 + 인증 메일 발송 | 불필요 |
| `POST /api/apps/{slug}/auth/verify-email` | 인증 토큰 검증 | 불필요 |
| `POST /api/apps/{slug}/auth/resend-verification` | 인증 메일 재발송 | 필요 |
| `POST /api/apps/{slug}/auth/password-reset/request` | 재설정 요청 | 불필요 |
| `POST /api/apps/{slug}/auth/password-reset/confirm` | 재설정 확인 | 불필요 |

요청 DTO 예시:

```java
// core/core-auth-api/src/main/java/com/factory/core/auth/api/dto/VerifyEmailRequest.java
public record VerifyEmailRequest(@NotBlank String token) {}

// PasswordResetConfirmRequest.java
public record PasswordResetConfirmRequest(
    @NotBlank String token,
    @NotBlank @Size(min = 8, max = 72) String newPassword
) {}
```

---

## 에러 처리

이메일 관련 에러는 `AuthError` enum 에 정의되어 있습니다.

```java
// core/core-auth-api/src/main/java/com/factory/core/auth/api/exception/AuthError.java
TOKEN_EXPIRED(401, "ATH_002", "토큰이 만료되었습니다"),
INVALID_TOKEN(401, "ATH_003", "유효하지 않은 토큰입니다"),
EMAIL_NOT_VERIFIED(401, "ATH_005", "이메일 인증이 필요합니다"),
EMAIL_DELIVERY_FAILED(503, "ATH_006", "이메일 발송에 실패했습니다");
```

| 코드 | HTTP | 발생 상황 |
|---|---|---|
| `ATH_002` TOKEN_EXPIRED | 401 | 인증/재설정 토큰 만료 |
| `ATH_003` INVALID_TOKEN | 401 | 토큰 미존재, 이미 사용됨, 조작됨 |
| `ATH_005` EMAIL_NOT_VERIFIED | 401 | 이메일 인증이 필요한 엔드포인트에 미인증 유저 접근 |
| `ATH_006` EMAIL_DELIVERY_FAILED | 503 | Resend API 장애, 2xx 외 응답, 네트워크 에러 |

`ATH_001`(잘못된 자격 증명) 을 포함한 전체 에러 코드는 [`exception-handling.md`](../../convention/exception-handling.md) 를 참조하세요.

### 발송 실패가 가입/재설정을 막지 않는 이유

이메일 발송은 외부 의존(Resend 서비스) 이라 언제든 실패할 수 있습니다. 만약 가입 플로우가 "이메일 발송 실패 → 롤백" 이라면, Resend 의 일시 장애만으로 유저가 가입조차 못 하게 됩니다. 설계 결정은 다음과 같습니다.

- **가입**: 인증 메일 발송 실패 시 로그만 남기고 가입은 성공. 유저가 로그인 후 재발송 요청.
- **비밀번호 재설정 요청**: 이메일 발송 실패 시에도 토큰은 이미 저장. 유저가 재요청하면 새 토큰이 발급됨.
- **비밀번호 재설정 확인**: 토큰 검증 실패 / 만료는 명확한 에러. 이메일 발송은 이 단계에서 필요 없음.

---

## 요약

- `EmailPort` 는 `send(to, subject, htmlBody)` 단 하나의 메서드만 가진 최소 인터페이스입니다.
- 기본 구현은 `ResendEmailAdapter`, Resend HTTP API 에 POST 합니다. 2xx 외 응답은 `AuthException(EMAIL_DELIVERY_FAILED)` 으로 변환됩니다.
- 토큰은 **raw 를 이메일에만, SHA-256 해시를 DB 에** 저장합니다. `TokenGenerator` 가 공통 유틸입니다.
- 이메일 인증 토큰 TTL 은 24시간, 비밀번호 재설정은 1시간이 기본입니다.
- 비밀번호 재설정 성공 시 해당 유저의 모든 refresh token 이 무효화됩니다.
- 존재하지 않는 이메일로 재설정 요청이 와도 동일한 응답을 반환합니다 (enumeration 방지).
- 가입 시 이메일 발송이 실패해도 가입 자체는 성공합니다.

---

## 트러블슈팅

### Resend API 응답 500 또는 타임아웃

- **원인**: Resend API 장애 또는 `RESEND_API_KEY` 만료
- **확인**: `curl -i https://api.resend.com/emails -H "Authorization: Bearer $RESEND_API_KEY"` 로 키 유효성 테스트
- **조치**: 키 회전 ([`키 교체 절차 (Key Rotation)`](../../production/setup/key-rotation.md))

### 인증 이메일이 스팸함으로 감

- **원인**: Resend 전송 도메인의 SPF/DKIM 미설정
- **조치**: Resend 대시보드 → Domains → DNS 레코드 추가

### 토큰 만료 후 재발송 요청

- **엔드포인트**: `POST /api/apps/{slug}/auth/resend-verification` (인증 필요)
- **제약**: Rate limit 적용 (strict)

### 비밀번호 재설정 토큰 이미 사용됨

- **원인**: 재설정 토큰은 1 회용. 클릭 후 재시도 불가.
- **조치**: `POST /api/apps/{slug}/auth/password-reset/request` 재요청

## 다음 단계

- 푸시 알림 통합: [`Push Notifications`](./push-notifications.md)
- JWT 인증 흐름: [`JWT Authentication`](../../structure/jwt-authentication.md)
- Rate limit 설정: [`Rate Limit 규약`](./rate-limiting.md)
