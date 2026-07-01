# Phone Auth (점유인증) & SMS

> **유형**: Explanation · **독자**: Level 2 · **읽는 시간**: ~12분

**설계 근거**: [`ADR-038 (SMS + 휴대폰 점유인증)`](../../philosophy/adr-038-sms-phone-auth.md) · [`ADR-003 (-api / -impl 분리)`](../../philosophy/adr-003-api-impl-split.md) · [`ADR-013 (앱별 인증 엔드포인트)`](../../philosophy/adr-013-per-app-auth-endpoints.md) · [`ADR-024 (core-email 도메인 추출 — mock/real 어댑터 패턴)`](../../philosophy/adr-024-email-domain-extraction.md) · [`ADR-037 (core schema 폐기 — per-app 데이터)`](../../philosophy/adr-037-core-schema-deprecation.md)

이 문서는 **휴대폰 점유인증(SMS OTP)** 아키텍처와 그 기반이 되는 SMS 발송 추상화를 정리합니다.

템플릿은 문자 발송을 **Port/Adapter 패턴**으로 추상화합니다. 점유인증 도메인 코드(`OtpService`) 는 발신사 SDK 를 직접 알지 못하고 `core-sms-api` 의 `SmsPort` 인터페이스만 의존합니다 (Port·Adapter 패턴은 [`용어집`](../../reference/glossary.md#아키텍처-용어) 참조). 덕분에 테스트에서는 mock 으로, 개발에서는 콘솔 캡처(`LoggingSmsAdapter`) 로, 운영에서는 CoolSMS(SOLAPI) 실발송(`CoolSmsAdapter`) 으로 바꿔 끼울 수 있습니다 — `core-email` 의 `EmailPort` 와 완전히 동일한 토글 패턴입니다 (ADR-024).

---

## 개요

**점유인증(占有認證)** 은 "이 사용자가 실제로 이 휴대폰 번호를 소유(점유) 하고 있는가" 를 SMS 일회용 코드(OTP) 로 확인하는 절차입니다. 번호로 6자리 코드를 보내고, 사용자가 그 코드를 입력하면 "이 번호의 점유가 검증됐다" 는 신뢰가 생깁니다. 그 신뢰를 바탕으로 가입/로그인 토큰을 발급합니다.

본 기능은 두 개의 core 모듈쌍으로 구성됩니다.

- **`core-sms-*`** — 도메인 횡단 문자 발송 추상화. 점유인증 OTP 뿐 아니라 운영 알림 등 모든 SMS 의 단일 진입점.
- **`core-phone-auth-*`** — 점유인증 도메인. OTP 발송/검증 수명 관리 + 검증 후 토큰 발급 오케스트레이션.

식별(번호 → 유저) 자체는 두 모듈이 직접 하지 않고 `core-auth` 의 `AuthPort.issueForVerifiedPhone` 에 위임합니다 — 소셜 로그인과 동일한 `auth_social_identities(provider='phone')` 경로를 재사용합니다.

---

## 아키텍처 개요

```
[PhoneAuthController]                  (core-phone-auth-impl — 공유 컨트롤러, {appSlug} path + brand config)
       │
       ▼
   PhoneAuthPort ──► PhoneAuthAdapter
                          │
       ┌──────────────────┴───────────────────┐
       ▼                                       ▼
   OtpService                          AuthPort.issueForVerifiedPhone(phoneE164, appSlug)
   (발송 rate-limit / 검증 brute-force)        (provider='phone' find-or-create + 토큰)
       │
       ▼
   SmsPort ──► CoolSmsAdapter  ──► SOLAPI(CoolSMS) HTTP API   (운영)
           └─► LoggingSmsAdapter (콘솔 OTP 캡처)               (dev/dev-server fallback)
```

모듈 구성은 다음과 같습니다.

| 모듈 | 역할 |
|---|---|
| `core/core-sms-api` | `SmsPort` 인터페이스, `SmsError` (SMS_001~SMS_002) |
| `core/core-sms-impl` | `CoolSmsAdapter`(SOLAPI 실발송), `LoggingSmsAdapter`(dev fallback), `CoolSmsProperties`, `SmsAutoConfiguration` |
| `core/core-phone-auth-api` | `PhoneAuthPort` 인터페이스, `PhoneAuthError` (PHA_001~PHA_006) |
| `core/core-phone-auth-impl` | `PhoneAuthAdapter`, `OtpService`, `OtpCodes`, `PhoneOtpCode` 엔티티, `PhoneOtpCodeRepository`, `PhoneAuthAutoConfiguration` |

SMS 발송과 점유인증 책임은 의도적으로 분리되어 있습니다. SMS 도메인은 **"문자를 어떻게 전달하는가"** 만 알고, 점유인증 도메인은 **"OTP 의 수명을 어떻게 관리하는가"** 만 압니다. `core-device` 와 `core-push` 가 분리된 것과 같은 철학입니다 ([`Push Notifications`](./push-notifications.md) 참조).

---

## SMS 발송 — SmsPort

`SmsPort` 는 메서드 하나의 최소 인터페이스입니다.

```java
// core/core-sms-api/src/main/java/com/factory/core/sms/api/SmsPort.java
public interface SmsPort {

    /** 단문 SMS 발송. toE164 는 E.164 형식(예: +821012345678). */
    void send(String toE164, String text);

    /** dev fallback adapter 면 true — 호출자가 raw OTP 를 응답에 노출 가능. */
    default boolean isDevCapture() { return false; }
}
```

`isDevCapture()` 는 `core-email` 의 `EmailPort.isDevCapture()` 와 동일한 역할입니다. `LoggingSmsAdapter` 가 활성일 때만 `true` 를 반환하고, 그때만 호출자가 raw OTP 코드를 dev 응답으로 노출합니다 (운영 어댑터는 항상 `false`).

### CoolSmsAdapter — SOLAPI 실발송

운영 어댑터는 SOLAPI(CoolSMS) HTTP API 에 단일 메시지를 POST 합니다. 별도 SDK 의존 없이 표준 `HttpURLConnection` 을 씁니다 (`core-email` 의 `ResendEmailAdapter` 와 같은 이유 — 일부 docker 환경의 비동기 DNS resolve 회피).

```java
// core/core-sms-impl/src/main/java/com/factory/core/sms/impl/CoolSmsAdapter.java
// 인증: SOLAPI HMAC-SHA256
//   Authorization: HMAC-SHA256 apiKey=…, date=…, salt=…, signature=…
//   signature = HMAC-SHA256(date + salt, apiSecret) 의 소문자 hex
//   date 는 ISO-8601, salt 는 매 요청 랜덤 hex
static String authorizationHeader(String apiKey, String apiSecret, String date, String salt) {
    String signature = hmacSha256Hex(date + salt, apiSecret);
    return "HMAC-SHA256 apiKey=" + apiKey + ", date=" + date
            + ", salt=" + salt + ", signature=" + signature;
}
```

SOLAPI 는 국내형 번호(`01012345678`) 를 요구하므로, E.164(`+8210…`) 수신/발신번호를 `toDomesticNumber()` 로 변환합니다. 2xx 가 아닌 응답이나 I/O 예외는 모두 `SmsException(SmsError.SMS_DELIVERY_FAILED)` (`SMS_001`, HTTP 502) 로 변환됩니다.

`apiUrl()` / `doPost()` 는 protected seam 으로 노출되어 테스트에서 spy 로 stub 할 수 있습니다. `apiUrl` 미설정 시 운영 SOLAPI 엔드포인트(`https://api.solapi.com/messages/v4/send`) 로 기본값 보정되며, dev/local 도그푸딩은 `COOLSMS_API_URL` 을 WireMock 으로 지정해 **실 발송/과금 없이** HMAC/HTTP 경로를 검증합니다 (`core-payment` 의 `PortOneProperties` 와 동일).

### LoggingSmsAdapter — dev 캡처

발신사 키가 없는 비-운영 환경의 fallback 입니다. 실제 문자를 보내지 않고 수신 번호/본문을 `WARN` 로그로 출력합니다 — 점유인증 OTP 를 개발자가 콘솔에서 바로 확인할 수 있습니다.

```
[DEV-SMS] SMS captured to logs (real SMS provider not configured)
  To: +821012345678
  Text: [랜목톡] 인증번호 [042193] 보이스피싱주의, 타인 노출금지
```

> `LoggingEmailAdapter` 가 `local` 전용인 것과 달리, SMS fallback 은 `dev` 프로필에서도 활성화됩니다. 실 발신사 발급 전 dev 서버 도그푸딩을 위해서이며, dev 서버는 Cloudflare Access 로 게이팅되어 OTP 콘솔 노출이 안전합니다. **운영(prod) 에는 등록되지 않습니다** (`@Profile("!prod")`).

### 자동 구성 (graceful + 운영 안전망)

`SmsAutoConfiguration` 이 환경에 따라 어댑터를 토글합니다. `core-email` 의 `EmailAutoConfiguration` 과 동일한 패턴입니다.

```java
// core/core-sms-impl/src/main/java/com/factory/core/sms/impl/SmsAutoConfiguration.java

// (1) CoolSMS api-key + api-secret 둘 다 채워졌을 때만 CoolSmsAdapter 등록
@Bean
@ConditionalOnExpression(
    "'${app.sms.coolsms.api-key:}' != '' && '${app.sms.coolsms.api-secret:}' != ''")
@ConditionalOnMissingBean(SmsPort.class)
public CoolSmsAdapter coolSmsAdapter(CoolSmsProperties props) { ... }

// (2) 키 없음 + non-prod 환경 fallback — LoggingSmsAdapter 등록
@Bean
@Profile("!prod")
@ConditionalOnMissingBean(SmsPort.class)
public LoggingSmsAdapter loggingSmsAdapter() { ... }
```

| 환경 | CoolSMS key | 등록 어댑터 | 부팅 / OTP 발송 |
|---|---|---|---|
| dev / local | 있음 | `CoolSmsAdapter` | OK — 실제 발송 |
| dev / local | 없음 | `LoggingSmsAdapter` | OK — OTP 가 콘솔 로그로 출력 |
| prod | 있음 | `CoolSmsAdapter` | OK — 실제 발송 |
| prod | 없음 | (없음) | 부팅은 OK(`SmsPort` 는 lazy `ObjectProvider`), 단 OTP 발송 시점에 `PHA_006` (의도된 안전망) |

운영에서 `SmsPort` 빈이 없어도 부팅이 실패하지 않는 이유는 `OtpService` 가 `ObjectProvider<SmsPort>` 로 **lazy** 의존하기 때문입니다. 발송 시점에 빈이 없으면 `PhoneAuthError.OTP_SMS_UNAVAILABLE` (`PHA_006`, HTTP 503) 을 던집니다.

전체 SMS 도메인은 `app.features.sms` 토글로 끌 수 있습니다 (`@ConditionalOnProperty`, 기본 on).

---

## 점유인증 — PhoneAuthPort

`PhoneAuthPort` 는 발송과 검증 두 메서드를 제공합니다.

```java
// core/core-phone-auth-api/src/main/java/com/factory/core/phoneauth/api/PhoneAuthPort.java
public interface PhoneAuthPort {

    /** OTP 발송 — rate-limit 체크 → 6자리 생성/해시저장 → SMS 발송.
     *  return: dev-capture 어댑터 활성 시 raw 코드, 운영 어댑터 시 Optional.empty(). */
    Optional<String> requestOtp(String phoneE164, String brandName);

    /** OTP 검증 후 appSlug 유저 find-or-create + access/refresh 토큰 발급. */
    AuthResponse verify(String phoneE164, String code, String appSlug);
}
```

`PhoneAuthAdapter` 가 이 둘을 `OtpService`(OTP 수명) 와 `AuthPort.issueForVerifiedPhone`(토큰 발급) 으로 오케스트레이션합니다.

```java
// core/core-phone-auth-impl/src/main/java/com/factory/core/phoneauth/impl/PhoneAuthAdapter.java
@Override
public AuthResponse verify(String phoneE164, String code, String appSlug) {
    otpService.verify(phoneE164, code);                 // 점유 검증 (실패 시 PHA_*)
    return authPort.issueForVerifiedPhone(phoneE164, appSlug);  // 토큰 발급
}
```

---

## 앱에서 사용하는 방법

`core-auth`·`core-payment`·`core-iap` 와 동일하게 (ADR-013 방향 B), 점유인증 컨트롤러도 **core 가 공유 런타임 빈으로 등록**합니다 — 앱이 별도로 추가할 게 없어요. `core-phone-auth-impl` 의 `PhoneAuthController` 한 개가 `{appSlug}` path 로 모든 앱을 처리하고, `PhoneAuthAutoConfiguration` 이 `@Bean` 으로 올립니다. 클래스 레벨 `@ConditionalOnProperty(app.features.phone-auth, matchIfMissing=true)` (default ON) 가 토글이라, `=false` 면 Port·컨트롤러가 함께 사라집니다. 경로는 `ApiEndpoints.Auth.PHONE_REQUEST`(`/phone/request`) / `PHONE_VERIFY`(`/phone/verify`), 둘 다 로그인 전이라 `PUBLIC_PATTERNS` 의 `/phone/**` 가 커버합니다.

```java
// core/core-phone-auth-impl/.../controller/PhoneAuthController.java  (공유 — 앱 추가 불필요)
@RestController
@RequestMapping(ApiEndpoints.Auth.BASE)   // /api/apps/{appSlug}/auth
public class PhoneAuthController {

    private final PhoneAuthPort phoneAuthPort;
    private final PhoneAuthProperties properties;   // app.phone-auth.brands.<slug>

    @PostMapping(ApiEndpoints.Auth.PHONE_REQUEST)   // /phone/request
    public ApiResponse<SendCodeResponse> request(
            @PathVariable("appSlug") String appSlug, @RequestBody @Valid SendCodeRequest body) {
        // brand 는 슬러그별 config 로 해소 (미설정 시 slug). devCode 는 dev-capture 어댑터에서만 채워짐.
        Optional<String> devCode =
                phoneAuthPort.requestOtp(body.phoneE164(), properties.brandFor(appSlug));
        return ApiResponse.ok(new SendCodeResponse(devCode.orElse(null)));
    }

    @PostMapping(ApiEndpoints.Auth.PHONE_VERIFY)    // /phone/verify
    public ApiResponse<AuthResponse> verify(
            @PathVariable("appSlug") String appSlug, @RequestBody @Valid VerifyRequest body) {
        return ApiResponse.ok(phoneAuthPort.verify(body.phoneE164(), body.code(), appSlug));
    }
}
```

- **brand** — SMS 본문 표시명. `app.phone-auth.brands.<slug>` (`PhoneAuthProperties`) 로 슬러그별 지정, 미설정 시 슬러그 자체. 문구: `[<brand>] 인증번호 [042193] 보이스피싱주의, 타인 노출금지`
- **appSlug** — path variable 에서 직접 받아 `verify` 시 `AuthPort.issueForVerifiedPhone(phoneE164, appSlug)` 으로 전달, JWT claim 슬러그가 됩니다.
- **앱이 흐름을 바꾸려면** — 자체 `PhoneAuthController` 빈을 정의하면 `@ConditionalOnMissingBean` 으로 공유 빈이 비활성화돼 override 됩니다 (탈출구).

### AuthPort.issueForVerifiedPhone — 검증된 번호 → 토큰

`core-auth-api.AuthPort` 에 추가된 메서드입니다. "이 번호의 점유가 검증됐다" 는 신뢰를 전제로, 소셜 로그인과 **동일한 경로**(`auth_social_identities` provider=`phone`, providerId=E.164 번호) 로 유저를 find-or-create 하고 토큰을 발급합니다 — 별도 식별 테이블 없이 기존 소셜 매핑을 재사용합니다.

```java
// core/core-auth-api/src/main/java/com/factory/core/auth/api/AuthPort.java
/** 휴대폰 점유인증(SMS OTP) 완료 후 토큰 발급 — provider="phone" social identity 로 유저 find-or-create. */
AuthResponse issueForVerifiedPhone(String phoneE164, String appSlug);
```

최초 가입 시 합성 email(점유번호 기반 `.invalid` 도메인) 로 User 가 생성됩니다 — 이 email 은 발송에 쓰이지 않고 실제 email 과 충돌하지 않습니다. 재설치/기기변경 시 같은 번호로 재인증하면 동일 User 로 복구되어 기존 데이터가 유지됩니다.

---

## OTP 수명 관리 — OtpService

`OtpService` 가 발송 rate-limit, 코드 생성/저장, 검증 brute-force 가드를 모두 담당합니다.

### 발송 흐름 (rate-limit)

```java
// core/core-phone-auth-impl/src/main/java/com/factory/core/phoneauth/impl/service/OtpService.java
public Optional<String> requestOtp(String phoneE164, String brandName) {
    // 1) rate-limit: 1시간 윈도우 내 최대 5회 발송
    long recent = repository.countByPhoneE164AndCreatedAtAfter(phoneE164, now.minus(RATE_WINDOW));
    if (recent >= MAX_SENDS_PER_WINDOW) throw new PhoneAuthException(OTP_RATE_LIMITED);

    // 2) SmsPort lazy 조회 (운영 미설정 시 PHA_006)
    SmsPort smsPort = smsPortProvider.getIfAvailable();
    if (smsPort == null) throw new PhoneAuthException(OTP_SMS_UNAVAILABLE);

    // 3) 6자리 생성 → SHA-256 해시만 DB 저장 (raw 는 문자로만)
    String rawCode = OtpCodes.generateNumericCode(6);
    repository.save(new PhoneOtpCode(phoneE164, OtpCodes.sha256Hex(rawCode), now.plus(TTL)));

    // 4) 발송
    smsPort.send(phoneE164, "[" + brandName + "] 인증번호 [" + rawCode + "] 보이스피싱주의, 타인 노출금지");

    // 5) dev capture 어댑터면 raw 노출, 운영이면 empty
    return smsPort.isDevCapture() ? Optional.of(rawCode) : Optional.empty();
}
```

핵심 보안 규칙은 **raw 6자리 코드는 문자에만 들어가고, DB 에는 SHA-256 해시만 저장**한다는 것입니다 — `EmailVerificationService` 와 동일한 규칙입니다. DB 가 유출되어도 해시에서 raw 코드를 역산할 수 없습니다.

### 검증 흐름 (brute-force 가드)

```java
public void verify(String phoneE164, String code) {
    PhoneOtpCode otp = repository
        .findFirstByPhoneE164AndUsedAtIsNullOrderByCreatedAtDesc(phoneE164)
        .orElseThrow(() -> new PhoneAuthException(OTP_NOT_FOUND));

    if (otp.isExpired())                      throw new PhoneAuthException(OTP_EXPIRED);
    if (otp.getAttempts() >= MAX_VERIFY_ATTEMPTS) throw new PhoneAuthException(OTP_TOO_MANY_ATTEMPTS);
    if (!otp.matches(OtpCodes.sha256Hex(code))) {
        otp.incrementAttempts();              // 시도 카운트 증가
        throw new PhoneAuthException(OTP_INVALID_CODE);
    }
    otp.markUsed();                           // 1회용 — 재사용 불가
}
```

> `@Transactional(noRollbackFor = PhoneAuthException.class)` — 코드 불일치 시 `incrementAttempts()` 직후 예외를 던지는데, 기본 동작(RuntimeException → 롤백) 은 attempts 증가를 사라지게 해 brute-force 가드를 무력화합니다. `noRollbackFor` 로 증가분을 커밋시킵니다.

### TTL / rate-limit 기본값

| 정책 | 값 | 상수 |
|---|---|---|
| OTP 만료 (TTL) | **5분** | `OtpService.TTL` |
| 검증 최대 시도 | **5회** | `MAX_VERIFY_ATTEMPTS` |
| 발송 rate-limit | **1시간 윈도우 내 5회** | `MAX_SENDS_PER_WINDOW` / `RATE_WINDOW` |

6자리는 1,000,000 가지 → brute-force 평균 500,000 회 요청. **TTL 5분 + 검증 5회 제한 + 발송 rate-limit** 의 3중 방어로 표면을 줄입니다.

---

## 데이터 — per-app `auth_phone_verification_codes` (V015)

점유인증 데이터는 **per-app** 입니다. 코어 schema 는 없습니다 ([`ADR-037`](../../philosophy/adr-037-core-schema-deprecation.md)). `AuthPhoneVerificationCode` 엔티티는 `AbstractAppDataSourceConfig.CORE_ENTITY_PACKAGES` 에 등록되어, 라우팅 EntityManagerFactory 가 현재 요청 slug 의 schema 로 OTP row 를 읽고 씁니다 (`SlugContext` 기반). `PhoneAuthAutoConfiguration` 도 `core-auth` 와 동일하게 라우팅 EMF/txManager(`@Primary`) 에 바인딩됩니다.

```java
// common-persistence/AbstractAppDataSourceConfig.java
public static final String[] CORE_ENTITY_PACKAGES = {
    ...
    "com.factory.core.phoneauth.impl.entity", // 휴대폰 점유인증 — AuthPhoneVerificationCode
};
```

테이블 스키마는 `new-app.sh` 가 앱 생성 시 `V015__init_auth_phone_verification_codes.sql` 로 스캐폴딩합니다 (옵트인 — 점유인증을 쓰지 않으면 이 파일을 삭제 가능).

```sql
-- apps/app-<slug>/.../db/migration/<slug>/V015__init_auth_phone_verification_codes.sql
CREATE TABLE auth_phone_verification_codes (
    id              BIGSERIAL PRIMARY KEY,
    phone_e164      VARCHAR(20) NOT NULL,
    code_hash       VARCHAR(64) NOT NULL,   -- raw 6자리의 SHA-256 hex (64 chars)
    attempts        SMALLINT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    used_at         TIMESTAMPTZ
);
CREATE INDEX idx_auth_phone_verification_codes_phone_created ON auth_phone_verification_codes(phone_e164, created_at DESC);
```

`idx_auth_phone_verification_codes_phone_created` 인덱스가 검증 시의 "번호의 최신 미사용 코드" 조회와 발송 rate-limit 윈도우 카운트를 모두 지원합니다.

---

## 설정

### 환경변수 (`.env`)

| 키 | 의미 | 비우면 |
|---|---|---|
| `COOLSMS_API_KEY` | SOLAPI API Key | `LoggingSmsAdapter` fallback (콘솔 캡처) |
| `COOLSMS_API_SECRET` | SOLAPI API Secret | 〃 |
| `COOLSMS_FROM` | 사전등록 발신번호 (국내형, 예 `01012345678`) | 〃 |

```yaml
# application-prod.yml (dev/local 도 동일 키 — 비우면 fallback)
app:
  sms:
    coolsms:
      api-key: ${COOLSMS_API_KEY:}
      api-secret: ${COOLSMS_API_SECRET:}
      from: ${COOLSMS_FROM:}
```

`api-key` 와 `api-secret` 이 **둘 다** 채워져야 `CoolSmsAdapter` 가 등록됩니다. dev/local 에서 비워두면 OTP 가 콘솔 로그(`[DEV-SMS]`) 로 출력되어, 별도 발신사 발급 없이 점유인증 e2e 흐름을 시연할 수 있습니다.

발신번호 등록·API 키 발급 절차는 [`운영 키 발급 통합 가이드`](../../production/setup/key-issuance.md) 의 CoolSMS 섹션을 참조하세요.

### 기능 토글

| 토글 | 대상 | 기본 |
|---|---|---|
| `app.features.sms` | SMS 도메인(`SmsAutoConfiguration`) | on (`matchIfMissing=true`) |
| `app.features.phone-auth` | 점유인증 도메인(`PhoneAuthAutoConfiguration`) | on (`matchIfMissing=true`) |

점유인증을 쓰지 않는 앱은 `app.features.phone-auth: false` 로 끄고, `V015` 마이그레이션 파일도 삭제하면 됩니다 ([`ADR-034 — Feature Toggle Lite mode`](../../philosophy/adr-034-feature-toggle-lite-mode.md) 패턴).

---

## 에러 처리

점유인증 토큰 관련 에러는 `PhoneAuthError`(`PHA_*`) 에, 문자 발송 자체의 에러는 `SmsError`(`SMS_*`) 에 정의됩니다 — 도메인 분리.

| 코드 | HTTP | 발생 상황 |
|---|---|---|
| `PHA_001` OTP_NOT_FOUND | 401 | 유효한 미사용 OTP 없음 (재요청 필요) |
| `PHA_002` OTP_INVALID_CODE | 401 | 코드 불일치 (attempts 증가) |
| `PHA_003` OTP_EXPIRED | 401 | OTP TTL(5분) 만료 |
| `PHA_004` OTP_TOO_MANY_ATTEMPTS | 429 | 검증 5회 초과 |
| `PHA_005` OTP_RATE_LIMITED | 429 | 발송 rate-limit(1시간 5회) 초과 |
| `PHA_006` OTP_SMS_UNAVAILABLE | 503 | 발신사 미설정 (운영 `SmsPort` 빈 부재) |
| `SMS_001` SMS_DELIVERY_FAILED | 502 | SOLAPI 2xx 외 응답 / 네트워크 에러 |
| `SMS_002` SMS_CONFIG_MISSING | 503 | 문자 발송 설정 누락 |

전체 에러 코드는 [`exception-handling.md`](../../convention/exception-handling.md) 를 참조하세요.

---

## 요약

- SMS 발송은 `SmsPort` 한 메서드(`send(toE164, text)`) 의 최소 인터페이스로 추상화됩니다 — `core-email` 의 `EmailPort` 와 같은 패턴.
- 운영은 `CoolSmsAdapter`(SOLAPI HMAC-SHA256 실발송), 개발은 `LoggingSmsAdapter`(콘솔 OTP 캡처) 로 키 유무에 따라 자동 토글됩니다.
- 점유인증은 `PhoneAuthPort.requestOtp` / `verify` 두 메서드. **core 공유 `PhoneAuthController`** 가 `{appSlug}` path + `app.phone-auth.brands.<slug>` brand config 로 모든 앱에 노출합니다 — `app.features.phone-auth` 토글 (default ON, ADR-013 방향 B).
- raw 6자리 코드는 **문자에만 들어가고 DB 에는 SHA-256 해시만 저장**합니다. TTL 5분 + 검증 5회 + 발송 rate-limit 의 3중 방어.
- 검증 성공 후 `AuthPort.issueForVerifiedPhone` 이 `auth_social_identities(provider='phone')` 로 유저를 find-or-create 하고 토큰을 발급합니다.
- OTP 데이터는 **per-app** `auth_phone_verification_codes`(V015) — 코어 schema 없이 라우팅 EMF 로 현재 slug schema 에 저장됩니다 (ADR-037).

---

## 관련 문서

- [`Email Verification & Delivery`](./email-verification.md) — `EmailPort` mock/real 어댑터 패턴 (SMS 와 동일 구조)
- [`Push Notifications`](./push-notifications.md) — `PushPort` 추상 + 디바이스 등록 (도메인 분리 철학)
- [`JWT Authentication`](../../structure/jwt-authentication.md) — `issueForVerifiedPhone` 이 발급하는 access/refresh 토큰 흐름
- [`운영 키 발급 통합 가이드`](../../production/setup/key-issuance.md) — CoolSMS(SOLAPI) API 키 발급 + 발신번호 등록 절차
- [`Architecture Reference`](../../structure/architecture.md) — core 모듈 트리 + 의존 그래프
- [`ADR-038 · SMS 발송 + 휴대폰 점유인증`](../../philosophy/adr-038-sms-phone-auth.md) — 이 기능의 설계 결정 (core-sms + core-phone-auth)
- [`ADR-003 · core 모듈을 -api / -impl 로 분리`](../../philosophy/adr-003-api-impl-split.md) — `SmsPort` / `PhoneAuthPort` 가 `-api` 모듈에 있는 근거
- [`ADR-013 · 앱별 인증 엔드포인트`](../../philosophy/adr-013-per-app-auth-endpoints.md) — 컨트롤러 공유화(방향 B), 점유인증도 동일 적용
- [`ADR-037 · core schema 폐기`](../../philosophy/adr-037-core-schema-deprecation.md) — per-app `auth_phone_verification_codes` 데이터 라우팅
</content>
</invoke>
