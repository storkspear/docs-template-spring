# Email Verification & Delivery

> **유형**: Explanation · **독자**: Level 2 · **읽는 시간**: ~12분

**설계 근거**: [`ADR-006 · HS256 JWT`](../../philosophy/adr-006-hs256-jwt.md) · [`ADR-013 · 앱별 인증 엔드포인트`](../../philosophy/adr-013-per-app-auth-endpoints.md) · [`ADR-024 · core-email 도메인 추출`](../../philosophy/adr-024-email-domain-extraction.md) · [`ADR-034 · feature toggle & Lite mode`](../../philosophy/adr-034-feature-toggle-lite-mode.md)

이 문서는 이메일 발송 아키텍처와 그 위에서 동작하는 이메일 인증·비밀번호 재설정 플로우를 정리합니다.

템플릿은 트랜잭셔널 이메일을 Port/Adapter 패턴으로 추상화합니다. 인증 메일을 보내는 도메인 서비스 두 곳, 즉 `EmailVerificationService` 와 `PasswordResetService` 는 발신사를 전혀 알지 못한 채 `core-email-api` 의 `EmailPort` 인터페이스 하나에만 의존해요. 실제 발송은 `core-email-impl` 의 `ResendEmailAdapter` 가 [Resend](https://resend.com) HTTP API 로 수행하고, 키가 없는 로컬 환경에서는 `LoggingEmailAdapter` 가 메일 본문을 콘솔에 찍어 줍니다. 이메일을 auth 와 별도 도메인으로 떼어낸 배경은 ADR-024 에 있어요.

---

## 한 문장 요약

도메인 서비스는 `EmailPort` 하나만 보고, 키가 있으면 Resend 로 실제 발송하며 없으면 로컬 콘솔로 떨어뜨리되, 운영에서는 키가 없으면 아예 부팅이 막힙니다.

---

## 개념 — 발송 경로 한눈에

인증 메일이 만들어져서 사용자에게 닿기까지의 경로는 다음과 같아요. 도메인 서비스는 화살표 왼쪽까지만 알고, 오른쪽은 환경이 결정합니다.

```
EmailVerificationService
PasswordResetService      ──► EmailPort.send(to, subject, htmlBody)
                                   │
                                   ├─► ResendEmailAdapter   ──► Resend HTTP API   (키 있음)
                                   └─► LoggingEmailAdapter   ──► 콘솔 WARN 로그      (키 없음 + local)
```

어느 어댑터가 등록되는지는 환경과 `RESEND_API_KEY` 유무가 정합니다. 핵심은 도메인 코드가 이 분기를 전혀 신경 쓰지 않는다는 점이에요. 같은 `send(...)` 호출이 운영에서는 실제 메일이 되고, 로컬에서는 콘솔 로그가 됩니다.

---

## 구조 — 모듈과 책임

| 모듈 | 역할 |
|---|---|
| `core/core-email-api` | `EmailPort` 인터페이스, `EmailError` 에러 코드 |
| `core/core-email-impl` | `ResendEmailAdapter`, `LoggingEmailAdapter`, `ResendProperties`, `EmailAutoConfiguration` |
| `core/core-auth-impl` | `EmailVerificationService`, `PasswordResetService`, `EmailAuthService` — `EmailPort` 소비 측 |

### EmailPort

인터페이스는 최소한으로 설계했어요. 수신자와 제목, HTML 본문 세 가지만 받습니다.

```java
// core/core-email-api/src/main/java/com/factory/core/email/api/EmailPort.java 발췌
public interface EmailPort {

    /**
     * HTML 형식의 이메일 발송.
     *
     * @throws RuntimeException 발송 실패 시 (도메인별 exception 으로 wrap 권장)
     */
    void send(String to, String subject, String htmlBody);

    /** dev fallback 어댑터면 true — 호출자가 raw token 을 응답으로 노출 가능. */
    default boolean isDevCapture() {
        return false;
    }
}
```

`send` 의 계약은 일부러 느슨해요. 발송 실패를 `RuntimeException` 으로만 규정하고, 어떤 예외로 감쌀지는 어댑터에 맡깁니다. 그래서 운영 어댑터는 자기 도메인 예외인 `EmailException` 으로 감싸 던지고, 호출 측 서비스는 그 예외를 보고 환경별로 다르게 대응할 수 있어요.

`isDevCapture()` 는 두 번째 약속이에요. 이 메서드가 true 를 반환하는 어댑터가 활성일 때, 호출자는 raw 인증 코드를 응답으로 노출해도 안전하다고 판단합니다. 운영 어댑터는 기본값 false 를 유지하므로 코드는 이메일로만 전달돼요.

첨부 파일이나 multipart, BCC 같은 고급 기능은 템플릿에 들어 있지 않아요. 필요하면 `EmailPort` 를 확장하거나 별도 port 를 추가하는 편이 자연스러워요.

---

## Resend 연동

### 자격 증명 설정

`ResendProperties` 는 `app.email.resend` prefix 의 설정을 읽습니다.

```java
// core/core-email-impl/src/main/java/com/factory/core/email/impl/ResendProperties.java 전체
@ConfigurationProperties("app.email.resend")
public record ResendProperties(String apiKey, String fromAddress, String fromName) {}
```

여기에는 null 검증이 없어요. 이 레코드는 값을 그대로 담기만 하고, 키 누락은 `EmailAutoConfiguration` 의 조건부 빈 등록과 yml 의 strict placeholder 라는 두 단계가 걸러 냅니다. 어디서 무엇이 걸러지는지는 [자동 구성](#자동-구성) 절에서 자세히 다뤄요.

`from-name` 은 선택이에요. 비어 있으면 발신자 표기에 주소만 들어가고, 채워져 있으면 `이름 <주소>` 형태가 됩니다. 빈 문자열을 그대로 두면 ` <주소>` 가 되어 Resend 가 422 로 거부하므로, 어댑터는 공백 여부까지 보고 분기해요.

```yaml
app:
  email:
    resend:
      api-key: ${RESEND_API_KEY}
      from-address: noreply@example.com
      from-name: My App     # 선택 — 생략 시 주소만 표기
```

Resend 대시보드에서 발신 도메인을 먼저 등록하고 SPF·DKIM 검증을 마쳐야 `from-address` 주소로 실제 발송이 됩니다. API Keys 메뉴에서 `re_` 로 시작하는 키를 발급받아 환경변수로 주입해요.

### ResendEmailAdapter

발송 구현은 Java 표준 `HttpURLConnection` 을 씁니다. SDK 의존을 더하지 않으려는 선택인데, 여기에는 또 한 가지 실전 이유가 섞여 있어요. 일부 docker 환경에서 `java.net.http.HttpClient` 의 비동기 호스트 resolve 가 깨져, 같은 스레드의 동기 resolve 는 멀쩡한데도 `UnresolvedAddressException` 으로 발송이 실패하는 문제가 있었습니다. 동기 resolve 를 쓰는 `HttpURLConnection` 으로 그 함정을 피했어요.

```java
// core/core-email-impl/src/main/java/com/factory/core/email/impl/ResendEmailAdapter.java 발췌
@Override
public void send(String to, String subject, String htmlBody) {
    Objects.requireNonNull(to, "to must not be null");
    Objects.requireNonNull(subject, "subject must not be null");
    Objects.requireNonNull(htmlBody, "htmlBody must not be null");

    String from =
            (properties.fromName() != null && !properties.fromName().isBlank())
                    ? properties.fromName() + " <" + properties.fromAddress() + ">"
                    : properties.fromAddress();

    String json = buildJson(from, to, subject, htmlBody);

    int statusCode;
    try {
        statusCode = doPost(json);
    } catch (IOException e) {
        throw new EmailException(EmailError.EMAIL_DELIVERY_FAILED, e);
    }

    if (statusCode < 200 || statusCode >= 300) {
        throw new EmailException(EmailError.EMAIL_DELIVERY_FAILED);
    }
}
```

2xx 가 아닌 응답이든 I/O 예외든, 결과는 모두 `EmailException(EMAIL_DELIVERY_FAILED)` 한 갈래로 모입니다. 이 에러는 코드 `EMAIL_001`, HTTP 502 예요. 실제 POST 는 `doPost(String)` 가 맡는데, 이 메서드는 protected 라 테스트에서 로컬 HTTP 서버 URL 로 override 해 헤더와 바디 write, status 판정까지 실제 경로로 검증할 수 있어요. `Authorization: Bearer <api-key>` 헤더, 5초 connect·10초 read 타임아웃도 이 안에서 붙습니다.

### 자동 구성

`EmailAutoConfiguration` 이 환경에 따라 어떤 `EmailPort` 빈을 등록할지 결정합니다. 먼저 ADR-034 의 feature toggle 이 한 겹 더 감싸고 있어요. `app.features.email` 이 false 면 이 자동 구성 자체가 비활성이고, 그래도 도메인 서비스는 부팅됩니다. `EmailPort` 를 직접 주입받지 않고 `ObjectProvider<EmailPort>` 로 lazy 의존하기 때문이에요. 빈이 없으면 발송 시점에 조용히 건너뜁니다.

```java
// core/core-email-impl/src/main/java/com/factory/core/email/impl/EmailAutoConfiguration.java 발췌
@AutoConfiguration
@ConditionalOnProperty(prefix = "app.features", name = "email",
        havingValue = "true", matchIfMissing = true)
@EnableConfigurationProperties(ResendProperties.class)
public class EmailAutoConfiguration {

    @Bean
    @ConditionalOnExpression("'${app.email.resend.api-key:}' != ''")
    @ConditionalOnMissingBean(EmailPort.class)
    public ResendEmailAdapter resendEmailAdapter(ResendProperties resendProperties) {
        return new ResendEmailAdapter(resendProperties);
    }

    @Bean
    @Profile("local")
    @ConditionalOnMissingBean(EmailPort.class)
    public LoggingEmailAdapter loggingEmailAdapter() {
        return new LoggingEmailAdapter();
    }
}
```

두 빈의 등록 조건이 미묘하게 달라요. `ResendEmailAdapter` 는 키가 비어 있지 않으면 어느 프로파일에서든 등록되고, `LoggingEmailAdapter` 는 오직 `local` 프로파일에서만 fallback 으로 등록됩니다. 이 차이가 환경별 동작의 전부를 가릅니다.

| 환경 | Resend key | 등록 어댑터 | 부팅 |
|---|---|---|---|
| local | 있음 | `ResendEmailAdapter` | OK — 실제 발송 |
| local | 없음 | `LoggingEmailAdapter` | OK — 메일이 콘솔 로그로 출력 |
| dev | 있음 | `ResendEmailAdapter` | OK — 실제 발송 |
| dev | 없음 | 없음 | 부팅 실패 — yml 의 strict `${RESEND_API_KEY}` 가 풀리지 않음 |
| prod | 있음 | `ResendEmailAdapter` | OK — 실제 발송 |
| prod | 없음 | 없음 | 부팅 실패 — 의도된 운영 안전망 |

여기서 흔히 오해하는 지점은 dev 예요. `LoggingEmailAdapter` 가 붙는 건 `local` 프로파일뿐이라, 배포된 dev 서버는 운영과 똑같이 키를 요구합니다. `application-dev.yml` 과 `application-prod.yml` 둘 다 기본값 없는 `${RESEND_API_KEY}` 를 쓰므로, 키가 없으면 dev 도 부팅 단계에서 멈춰요. 콘솔 fallback 은 내 노트북에서만 일어나는 일입니다.

테스트에서 `EmailPort` 를 mock 으로 주입하면 `@ConditionalOnMissingBean` 이 두 어댑터 등록을 모두 생략해요.

### LoggingEmailAdapter

`RESEND_API_KEY` 가 비어 있는 local 환경에서 활성됩니다. 실제 메일을 보내지 않고 수신자·제목·HTML 본문을 `WARN` 로그로 찍어, 인증 코드나 재설정 코드를 콘솔에서 바로 확인할 수 있게 해 줘요.

```
[DEV-EMAIL] Email captured to logs (Resend API key not configured)
  To: user@example.com
  Subject: 이메일 인증 코드
  Body:
  <span style="font-size: 32px; ...">042193</span>
  이 코드는 5분 동안 유효합니다.
```

이 어댑터는 `isDevCapture()` 가 true 라, 호출자가 raw 코드를 응답으로 노출해도 좋다는 신호를 보냅니다. 운영 어댑터는 이 값을 기본 false 로 유지하므로 같은 신호가 켜지지 않아요.

### dev 응답에 raw 코드를 노출하는 방식

로컬과 dev 자동화 테스트는 메일을 받지 않고도 인증 단계를 통과해야 해요. 그래서 서버가 만든 raw 6자리 코드를 응답으로 직접 돌려주는 길을 둡니다. 이 노출을 켜는 스위치는 두 가지이고, 둘 중 하나만 켜져도 노출돼요.

- `app.email.dev-fallback-raw` 설정값. `application-local.yml` 과 `application-dev.yml` 이 둘 다 true 로 두고, 운영 yml 에는 없어 기본 false 입니다.
- 활성 어댑터의 `isDevCapture()`. `LoggingEmailAdapter` 가 true 를 반환할 때만 켜져요.

dev 서버는 실제 Resend 키로 메일을 보내면서도 `dev-fallback-raw=true` 라 응답에도 같은 코드를 실어 줍니다. 그래서 자동화 e2e 가 메일함을 뒤지지 않고 인증을 진행할 수 있어요. 노출되는 자리는 엔드포인트마다 다릅니다.

| 엔드포인트 | 노출 위치 | 형태 |
|---|---|---|
| `POST /auth/email/signup` | 응답 body | `AuthResponse.devVerificationToken` |
| `POST /auth/resend-verification` | 응답 헤더 | `X-Dev-Verification-Token` |
| `POST /auth/password-reset/request` | 응답 헤더 | `X-Dev-Reset-Token` |

`AuthResponse.devVerificationToken` 은 `@JsonInclude(NON_NULL)` 이라, 값이 없으면 응답에서 필드 자체가 사라져요. 운영에서는 두 스위치가 모두 꺼져 있어 이 필드와 헤더가 항상 비어 있습니다.

> 테스트 통과가 곧 운영 가용성은 아니에요. local 에서 회원가입과 재설정 플로우가 돈다고 운영에서도 돈다는 보장은 없어요. 운영은 `RESEND_API_KEY` 가 채워져 있어야만 부팅되고, 비어 있으면 yml 의 strict placeholder 가 기동을 막습니다.

### 다른 이메일 SaaS 로 교체하기

`EmailPort` 가 추상화돼 있어 SendGrid, AWS SES, Mailgun, SMTP 어디로든 바꿀 수 있어요. 자기 어댑터를 빈으로 등록하면 `@ConditionalOnMissingBean(EmailPort.class)` 패턴 덕에 `ResendEmailAdapter` 와 `LoggingEmailAdapter` 가 둘 다 자동으로 비활성됩니다.

```java
@Component
public class SendGridEmailAdapter implements EmailPort {
    @Override
    public void send(String to, String subject, String htmlBody) {
        // SendGrid SDK 또는 HTTP API 호출
    }
    // 보통 운영 어댑터이므로 isDevCapture() 는 기본값 false 를 유지.
}
```

별도 배제 설정은 필요 없어요. 빈을 등록하기만 하면 라우팅이 자동으로 넘어갑니다.

---

## 이메일 인증 플로우

가입 시점에 6자리 코드를 발급해 메일로 보내고, 사용자가 앱에서 그 코드를 입력하면 검증하여 `email_verified = true` 로 전환합니다.

### 1. 가입 시 인증 메일 발송

`EmailAuthService.signUp` 이 유저를 만들고 토큰을 발급한 뒤, 인증 메일 발송을 `VerificationEmailSender` 에 위임합니다. 이 인터페이스의 구현체가 `EmailVerificationService` 예요.

```java
// core/core-auth-impl/.../service/EmailAuthService.java 발췌
public AuthResponse signUp(SignUpRequest request) {
    String passwordHash = passwordHasher.hash(request.password());
    UserSummary user = userPort.createUserWithPassword(
            request.email(), passwordHash, request.displayName());

    AuthTokens tokens = refreshTokenIssuer.issueForNewLogin(
            user.id(), user.email(), request.appSlug(), "user");

    // 발송 결과를 try/catch 로 삼키지 않습니다 — 환경별 정책은 sendVerificationEmail 안에서 결정.
    Optional<String> devVerificationToken =
            verificationEmailSender.sendVerificationEmail(user.id(), user.email());

    return new AuthResponse(user, tokens, devVerificationToken.orElse(null));
}
```

여기서 정확히 짚어야 할 게 있어요. 이 메서드에는 발송 실패를 감싸는 try/catch 가 없습니다. 발송 실패 시 가입이 살아남는지 막히는지는 전적으로 `sendVerificationEmail` 안의 환경별 정책이 정해요. 그 정책은 다음 절에서 다룹니다.

### 2. 토큰 생성과 발송 정책

`sendVerificationEmail` 은 코드를 만들어 해시를 DB 에 저장한 뒤 메일을 보냅니다. 핵심은 발송 결과에 따라 반환값이 갈린다는 점이에요.

```java
// core/core-auth-impl/.../service/EmailVerificationService.java 발췌
@Override
@Transactional
public Optional<String> sendVerificationEmail(long userId, String email) {
    String rawCode = TokenGenerator.generateNumericCode(CODE_DIGITS); // 6자리
    String tokenHash = TokenGenerator.sha256Hex(rawCode);
    Instant expiresAt = Instant.now().plus(tokenTtl);

    tokenRepository.save(new AuthEmailVerificationToken(userId, tokenHash, expiresAt));

    EmailPort emailPort = emailPortProvider.getIfAvailable();
    if (emailPort == null) {                 // app.features.email=false
        return devFallbackRaw ? Optional.of(rawCode) : Optional.empty();
    }

    try {
        emailPort.send(email, "이메일 인증 코드", buildVerificationEmailHtml(rawCode, ttlMinutes));
    } catch (RuntimeException e) {
        if (devFallbackRaw) {                // dev / local — 진행 보장
            return Optional.of(rawCode);
        }
        throw e;                             // prod — 가입 트랜잭션 rollback
    }

    return (devFallbackRaw || emailPort.isDevCapture())
            ? Optional.of(rawCode)
            : Optional.empty();
}
```

발송이 실패했을 때의 갈림길이 운영 안전성의 핵심이에요.

- dev·local 처럼 `dev-fallback-raw` 가 true 면, 발송이 실패해도 raw 코드를 반환하고 가입을 그대로 진행합니다. 외부 메일 장애가 로컬 개발을 막지 않게 하려는 거예요.
- 운영처럼 false 면 예외를 그대로 다시 던져요. `signUp` 이 이 예외를 삼키지 않으므로 가입 트랜잭션이 rollback 되고 가입이 명시적으로 실패합니다. 예전에 이 자리를 try/catch 로 삼켰다가 rollback-only 마크와 충돌해 회귀가 났던 이력이 있어, 지금은 의도적으로 전파해요.

저장 규칙도 한 줄로 못 박을 수 있어요. raw 6자리는 이메일 본문에만 들어가고, DB 에는 SHA-256 해시만 저장합니다. DB 가 유출돼도 해시에서 raw 코드를 되돌릴 수 없어요.

`TokenGenerator` 는 두 가지 방식을 제공합니다.

- `generateRawToken()` 은 256비트 URL-safe Base64 를 만들어요. `RefreshTokenService` 가 쓰는데, 앱과 서버 사이 내부 refresh flow 라 사용자에게 노출되지 않아요.
- `generateNumericCode(6)` 은 `SecureRandom` 기반 6자리 숫자를 만듭니다. 앞자리 0 도 포함해요. 이메일 인증과 비밀번호 재설정이 이걸 쓰고, 사용자가 메일에서 받아 직접 입력합니다.

```java
// core/core-auth-impl/.../service/TokenGenerator.java 발췌
public static String generateNumericCode(int digits) {
    if (digits < 1) {
        throw new IllegalArgumentException("digits must be >= 1, got: " + digits);
    }
    long upperBound = (long) Math.pow(10, digits);
    long value = (SECURE_RANDOM.nextLong() & Long.MAX_VALUE) % upperBound;
    return String.format("%0" + digits + "d", value);
}
```

> 6자리는 100만 가지라 brute-force 평균 50만 회 요청이에요. 짧은 TTL 5분과 사용자별 rate limit 별도 정책으로 이 표면을 막습니다.

### 3. 토큰 엔티티

```java
// core/core-auth-impl/.../entity/AuthEmailVerificationToken.java 발췌
@Entity
@Table(name = "auth_email_verification_tokens")
public class AuthEmailVerificationToken {

    @Column(name = "token_hash", nullable = false, length = 64)
    private String tokenHash;  // SHA-256 hex, 64자

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "used_at")
    private Instant usedAt;
    // ...
}
```

`usedAt` 이 null 이 아니면 이미 쓴 토큰이라 재사용할 수 없고, `expiresAt` 이 현재보다 과거면 만료된 토큰입니다.

### 4. 사용자가 6자리를 입력하면 검증

사용자가 메일에서 받은 6자리 코드를 앱에 입력하면, 클라이언트가 `POST /api/apps/{appSlug}/auth/verify-email` 을 body `{"token": "042193"}` 으로 호출해요.

```java
// core/core-auth-impl/.../service/EmailVerificationService.java 발췌
public long verify(String rawToken) {
    String tokenHash = TokenGenerator.sha256Hex(rawToken);

    AuthEmailVerificationToken token = tokenRepository.findByTokenHash(tokenHash)
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

검증에 성공하면 `markUsed()` 로 재사용을 막고 `userId` 를 반환합니다. 호출자인 `AuthServiceImpl.verifyEmail` 은 그 `userId` 로 `userPort.verifyEmail(userId)` 를 불러 실제 플래그를 세워요. 검증 로직과 유저 상태 변경이 모듈 경계를 따라 나뉘어 있는 거예요.

### TTL

기본 TTL 은 5분이고 `app.auth.email-verification-ttl` 로 override 합니다. 6자리 코드의 brute-force 표면을 줄이려고 일부러 짧게 잡았어요.

```java
public static final Duration DEFAULT_TOKEN_TTL = Duration.ofMinutes(5);
```

`AuthAutoConfiguration` 이 이 값을 ISO-8601 duration 형식으로 주입합니다.

```java
@Value("${app.auth.email-verification-ttl:PT5M}") Duration emailVerificationTtl
@Value("${app.email.dev-fallback-raw:false}") boolean devFallbackRaw
```

같은 자리에서 `dev-fallback-raw` 도 함께 주입돼요. 기본값이 false 라, 운영 yml 이 이 키를 두지 않는 한 raw 노출은 켜지지 않습니다.

---

## 비밀번호 재설정 플로우

비밀번호를 잊은 경우의 플로우는 이메일 인증과 같은 토큰 메커니즘을 공유하되, 끝에 모든 세션을 무효화하는 단계가 더 붙어요.

### 1. 재설정 요청

`POST /auth/password-reset/request` 가 들어오면 `requestReset` 이 토큰을 만들어 메일로 보냅니다. 반환값은 dev 노출용 raw 코드예요.

```java
// core/core-auth-impl/.../service/PasswordResetService.java 발췌
public Optional<String> requestReset(String email) {
    Optional<UserAccount> userOpt = userPort.findAccountByEmail(email);

    if (userOpt.isEmpty()) {
        log.debug("Password reset requested for non-existent email (enumeration protection)");
        return Optional.empty();  // 이메일 존재 여부를 노출하지 않음
    }

    UserAccount user = userOpt.get();
    String rawCode = TokenGenerator.generateNumericCode(CODE_DIGITS);
    tokenRepository.save(new AuthPasswordResetToken(
            user.id(), TokenGenerator.sha256Hex(rawCode), Instant.now().plus(tokenTtl)));

    EmailPort emailPort = emailPortProvider.getIfAvailable();
    if (emailPort == null) {
        return Optional.empty();
    }

    try {
        emailPort.send(email, "비밀번호 재설정 코드", buildResetEmailHtml(rawCode, ttlMinutes));
    } catch (RuntimeException e) {
        // 발송 실패해도 토큰은 이미 저장됨 — 유저가 재요청하면 됨
        log.warn("Password reset email delivery failed for userId={}", user.id());
    }

    return emailPort.isDevCapture() ? Optional.of(rawCode) : Optional.empty();
}
```

이 메서드의 설계 중심은 이메일 열거 방어예요. 존재하지 않는 이메일로 요청이 와도 예외를 던지지 않고 조용히 `empty` 를 반환합니다. 응답이 동일해야 공격자가 "어떤 이메일이 가입돼 있는가" 를 탐지하지 못해요.

발송 실패 처리는 가입과 정반대라는 점도 주목할 만해요. 여기서는 발송이 실패해도 토큰이 이미 저장돼 있으니, 로그만 남기고 넘어갑니다. 유저가 재요청하면 새 토큰이 나가요. raw 노출은 이메일 인증과 달리 `isDevCapture()` 한 갈래로만 결정합니다.

### 2. 재설정 확인

`POST /auth/password-reset/confirm` 으로 토큰과 새 비밀번호가 오면 검증·변경·세션 무효화를 한 번에 처리해요.

```java
// core/core-auth-impl/.../service/PasswordResetService.java 발췌
public void confirmReset(String rawToken, String newPassword) {
    AuthPasswordResetToken token = tokenRepository
            .findByTokenHash(TokenGenerator.sha256Hex(rawToken))
            .orElseThrow(() -> new AuthException(AuthError.INVALID_TOKEN));

    if (token.isUsed()) {
        throw new AuthException(AuthError.INVALID_TOKEN);
    }
    if (token.isExpired()) {
        throw new AuthException(AuthError.TOKEN_EXPIRED);
    }

    token.markUsed();
    userPort.updatePassword(token.getUserId(), passwordHasher.hash(newPassword));

    // 모든 세션 무효화 — 보안 조치
    refreshTokenService.revokeAllForUser(token.getUserId());
}
```

비밀번호가 바뀌면 그 유저의 refresh token 을 전부 무효화합니다. 계정이 탈취돼 공격자가 비밀번호를 바꿨더라도, 정상 유저가 재설정을 수행하는 순간 공격자의 모든 세션이 끊기게 하려는 조치예요.

### TTL

재설정 토큰의 TTL 도 5분입니다. 이메일 인증과 같은 이유로 짧게 잡았어요. `app.auth.password-reset-ttl` 로 override 하며, 형식은 `PT5M` 같은 ISO-8601 duration 이에요.

```java
public static final Duration DEFAULT_TOKEN_TTL = Duration.ofMinutes(5);
```

---

## 엔드포인트와 요청 DTO

`core/core-auth-impl` 의 `AuthController` 는 `AuthAutoConfiguration` 이 `@ConditionalOnMissingBean` 으로 등록하는 단일 공유 런타임 빈이에요. path 의 `{appSlug}` 변수로 모든 앱이 이 한 컨트롤러를 공유하고, `new-app.sh` 는 앱별 복제본을 만들지 않아요. 앱을 추가하면 그 슬러그로 곧바로 인증 엔드포인트를 호출할 수 있습니다. 다만 앱이 0개인 template 상태에서는 Spring 부팅 자체가 안 돼요 ([ADR-037](../../philosophy/adr-037-core-schema-deprecation.md)). 이 모델의 근거는 ADR-013 의 `## 갱신` 에 있어요.

관련 엔드포인트는 `ApiEndpoints.Auth` 에 상수로 정의돼 있습니다.

| 경로 | 설명 | 인증 |
|---|---|---|
| `POST /api/apps/{slug}/auth/email/signup` | 가입과 인증 메일 발송 | 불필요 |
| `POST /api/apps/{slug}/auth/verify-email` | 인증 코드 검증 | 불필요 |
| `POST /api/apps/{slug}/auth/resend-verification` | 인증 메일 재발송 | 필요 |
| `POST /api/apps/{slug}/auth/password-reset/request` | 재설정 요청 | 불필요 |
| `POST /api/apps/{slug}/auth/password-reset/confirm` | 재설정 확인 | 불필요 |

요청 DTO 는 record 로 선언하고 Bean Validation 으로 입력을 검증해요.

```java
// core/core-auth-api/.../dto/VerifyEmailRequest.java
public record VerifyEmailRequest(@NotBlank String token) {}

// core/core-auth-api/.../dto/PasswordResetRequest.java
public record PasswordResetRequest(@Email @NotBlank String email) {}

// core/core-auth-api/.../dto/PasswordResetConfirmRequest.java
public record PasswordResetConfirmRequest(
        @NotBlank String token,
        @NotBlank @ValidPassword String newPassword) {}
```

`@ValidPassword` 는 이 레포의 커스텀 제약으로, 비밀번호 정책을 한 자리에 모아 둔 어노테이션이에요.

---

## 에러 처리

토큰 관련 에러는 인증 도메인의 `AuthError` 에, 발송 자체의 에러는 이메일 도메인의 `EmailError` 에 나뉘어 정의돼 있어요. 도메인을 분리한 ADR-024 의 결과예요.

```java
// core/core-auth-api/.../exception/AuthError.java 발췌
TOKEN_EXPIRED(401, "ATH_002", "토큰이 만료되었습니다"),
INVALID_TOKEN(401, "ATH_003", "유효하지 않은 토큰입니다"),
EMAIL_NOT_VERIFIED(401, "ATH_005", "이메일 인증이 필요합니다");

// core/core-email-api/.../exception/EmailError.java 발췌
EMAIL_DELIVERY_FAILED(502, "EMAIL_001", "이메일 발송에 실패했습니다"),
EMAIL_CONFIG_MISSING(503, "EMAIL_002", "이메일 발송 설정 누락");
```

| 코드 | HTTP | 발생 상황 |
|---|---|---|
| `ATH_002` TOKEN_EXPIRED | 401 | 인증·재설정 토큰 만료 |
| `ATH_003` INVALID_TOKEN | 401 | 토큰 미존재, 이미 사용됨, 조작됨 |
| `ATH_005` EMAIL_NOT_VERIFIED | 401 | 이메일 인증이 필요한 엔드포인트에 미인증 유저 접근 |
| `EMAIL_001` EMAIL_DELIVERY_FAILED | 502 | Resend 장애, 2xx 외 응답, 네트워크 에러 |
| `EMAIL_002` EMAIL_CONFIG_MISSING | 503 | Resend 키나 발신 주소 설정 누락 |

전체 에러 코드는 [`예외 처리 규약`](../../convention/exception-handling.md) 을 참조하세요.

### 발송 실패가 인증과 재설정에서 다르게 동작하는 이유

이메일 발송은 외부 의존이라 언제든 실패할 수 있어요. 그래서 플로우마다 실패를 다르게 다룹니다.

- 가입에서는 환경이 정합니다. 운영은 발송 실패 시 예외가 전파돼 가입이 rollback 되고, 로컬·dev 는 raw 코드를 응답으로 받아 그대로 진행해요. 운영에서까지 메일이 안 나간 채로 가입이 끝나면 유저가 인증할 길이 막히므로, 명시적 실패가 더 안전합니다.
- 비밀번호 재설정 요청에서는 발송이 실패해도 토큰이 이미 저장돼 있어 로그만 남기고 넘어가요. 유저가 재요청하면 새 토큰이 나갑니다.
- 비밀번호 재설정 확인에서는 메일 발송이 끼지 않아요. 토큰 검증 실패나 만료만 명확한 에러로 처리합니다.

---

## 요약

- `EmailPort` 는 `send(to, subject, htmlBody)` 한 메서드만 가진 최소 인터페이스이고, `isDevCapture()` 로 dev 노출 가능 여부를 알립니다.
- 키가 있으면 `ResendEmailAdapter` 가 `HttpURLConnection` 으로 Resend API 에 POST 하고, 2xx 외 응답은 `EmailException(EMAIL_DELIVERY_FAILED, EMAIL_001, HTTP 502)` 로 변환됩니다.
- `LoggingEmailAdapter` fallback 은 `local` 프로파일에서만 붙어요. dev 서버는 운영과 똑같이 `RESEND_API_KEY` 가 없으면 부팅이 막힙니다.
- raw 6자리 코드는 이메일에만, DB 에는 SHA-256 해시만 저장합니다.
- dev 응답의 raw 코드 노출은 `app.email.dev-fallback-raw` 또는 `isDevCapture()` 중 하나만 켜져도 동작하고, 운영에서는 둘 다 꺼져 항상 비어 있어요.
- 가입 시 발송 실패는 운영에서는 가입을 rollback 시키고, 로컬·dev 에서는 raw 반환으로 진행을 보장합니다.
- 인증과 재설정 토큰 TTL 은 모두 기본 5분이에요.
- 비밀번호 재설정 성공 시 해당 유저의 모든 refresh token 이 무효화됩니다.
- 존재하지 않는 이메일로 재설정 요청이 와도 동일한 응답을 반환해 열거를 막아요.

---

## 트러블슈팅

### Resend 응답이 5xx 거나 타임아웃이에요

- 원인 — Resend 장애이거나 `RESEND_API_KEY` 가 만료됐어요.
- 확인 — `curl -i https://api.resend.com/emails -H "Authorization: Bearer $RESEND_API_KEY"` 로 키 유효성을 테스트하세요.
- 조치 — 키를 회전하세요. 절차는 [`키 교체 절차`](../../production/setup/key-rotation.md) 에 있어요.

### 인증 메일이 스팸함으로 가요

- 원인 — Resend 발신 도메인의 SPF·DKIM 이 설정되지 않았어요.
- 조치 — Resend 대시보드의 Domains 메뉴에서 DNS 레코드를 추가하세요.

### dev 서버가 부팅되다 EmailPort 빈 부재로 멈춰요

- 원인 — `LoggingEmailAdapter` 는 local 전용이라 dev 에는 fallback 이 없어요. `RESEND_API_KEY` 가 비어 있으면 strict placeholder 가 풀리지 않습니다.
- 조치 — dev 환경에도 실제 Resend 키를 주입하세요. 키 없이 콘솔 캡처를 보고 싶으면 local 프로파일로 띄우면 돼요.

### 토큰 만료 후 다시 받고 싶어요

- 엔드포인트 — `POST /api/apps/{slug}/auth/resend-verification` 이고 인증이 필요해요.
- 제약 — strict rate limit 이 적용됩니다.

### 재설정 토큰이 이미 사용됐다고 나와요

- 원인 — 재설정 토큰은 1회용이라 검증 후 재시도할 수 없어요.
- 조치 — `POST /api/apps/{slug}/auth/password-reset/request` 로 다시 요청하세요.

---

## 관련 문서

- [`Phone Auth (점유인증) & SMS`](./phone-auth-and-sms.md) — `EmailPort` 와 동일한 mock·real 어댑터 토글 패턴
- [`Push Notifications`](./push-notifications.md) — `PushPort` 추상과 디바이스 등록, 같은 도메인 분리 철학
- [`JWT Authentication`](../../structure/jwt-authentication.md) — 가입·로그인이 발급하는 access·refresh 토큰 흐름
- [`Rate Limit 규약`](./rate-limiting.md) — 재발송·재설정 엔드포인트의 rate limit 정책
- [`예외 처리 규약`](../../convention/exception-handling.md) — 전체 에러 코드와 `ErrorInfo` 체계
- [`ADR-024 · core-email 도메인 추출`](../../philosophy/adr-024-email-domain-extraction.md) — 이메일을 auth 와 별도 도메인으로 분리한 근거
- [`ADR-034 · feature toggle & Lite mode`](../../philosophy/adr-034-feature-toggle-lite-mode.md) — `app.features.email` 토글과 `ObjectProvider` lazy 의존
