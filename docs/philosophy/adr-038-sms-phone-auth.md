# ADR-038 · SMS 발송 (core-sms) + 휴대폰 점유인증 (core-phone-auth) 도입

**Status**: Accepted. `core-sms-api/SmsPort` + 멀티 어댑터 (`LoggingSmsAdapter` dev-capture / `CoolSmsAdapter` SOLAPI HMAC), `core-phone-auth-api/PhoneAuthPort` + `OtpService` + `PhoneOtpCode` 로 구현. OTP table 은 *app schema 안* (V015) 에 생성되고, `PhoneOtpCode` 는 `AbstractAppDataSourceConfig.CORE_ENTITY_PACKAGES` 에 등록되어 라우팅 EMF 로 slug schema 에 매핑됩니다. 컨트롤러는 **core 공유** `PhoneAuthController` (아래 갱신) 라, 앱은 `app.features.phone-auth=true` (default) 면 자동으로 재사용합니다.

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~6분

> **테이블 리네임 (2026-06-30)**: 본 ADR 의 `phone_otp_codes` 테이블은 현재 `auth_phone_verification_codes`, 엔티티 `PhoneOtpCode` 는 `AuthPhoneVerificationCode` 로 리네임됐어요 (email 인증과 `auth_*_verification_*` 컨벤션 통일). 아래 본문은 결정 당시 이름을 보존하니, 현재 스키마는 [`data-model`](../reference/data-model.md) 을 참고하세요.
> **테이블 리네임 (2026-07-01)**: 위 `phone_verification_codes` 는 다시 `auth_phone_verification_codes` (엔티티 `AuthPhoneVerificationCode`) 로, 본문의 `social_identities` 는 `auth_social_identities` (엔티티 `AuthSocialIdentity`) 로 리네임됐어요 (`auth_` 도메인 접두사 라운드). 아래 본문은 결정 당시 이름을 그대로 보존합니다.

> **갱신 (2026-06, ADR-013 B 정렬)**: 본문 §5 "앱 재사용 = `PhoneAuthPort` + 얇은 `<Slug>PhoneAuthController`" 는
> **컨트롤러 공유화로 대체**됐어요. 점유인증 컨트롤러도 auth/payment/iap 와 동일하게 **`core-phone-auth-impl` 의 공유
> `PhoneAuthController`** 한 개로 모든 앱이 씁니다 — `PhoneAuthAutoConfiguration` 이 `@Bean` 으로 등록하고,
> 클래스 레벨 `@ConditionalOnProperty(app.features.phone-auth)` (default ON) 가 토글이에요. 경로는
> `/api/apps/{appSlug}/auth/phone/{request,verify}`. SMS brand 이름은 앱별 상수 대신 `app.phone-auth.brands.<slug>`
> (`PhoneAuthProperties`, 미설정 시 slug) 로 주입합니다. 즉 `new-app.sh` 의 per-app 컨트롤러 heredoc 은 **불필요** —
> V015 옵션 SQL 만 있으면 점유인증이 바로 떠요. 아래 §5 / "앱별 얇은 컨트롤러" 서술은 *역사적 기록*입니다.

## 결론부터

SMS 발송과 휴대폰 점유인증을 *두 개의 독립 코어 도메인* 으로 분리합니다.

**① SMS 발송 = `core-sms`.** `SmsPort.send(toE164, text)` 한 메서드로 추상화하고, 환경별로 어댑터를 토글합니다 — dev/local 은 `LoggingSmsAdapter` (실 발송 X, OTP 를 `WARN` 로그로 노출 = *dev-capture*), 운영은 `CoolSmsAdapter` (SOLAPI/CoolSMS API, HMAC-SHA256 서명). `core-email` 의 `EmailPort` 멀티 어댑터 패턴 (ADR-024) 을 그대로 따릅니다.

**② 점유인증 = `core-phone-auth`.** `PhoneAuthPort` (requestOtp · verify) 뒤에 `OtpService` (rate-limit · brute-force 가드 · SHA-256 해시 저장) 와 `PhoneOtpCode` 엔티티를 둡니다. *OTP 수명 관리* 만 이 도메인이 책임지고, *번호→유저 식별* 은 `AuthPort.issueForVerifiedPhone` 에 위임합니다. 앱은 Port + `BRAND`·`appSlug` 를 주입하는 *얇은 컨트롤러* 만 추가하면 재사용 끝.

**③ OTP 데이터는 per-app schema.** ADR-037 에서 *core schema 자체가 사라졌으므로*, OTP 도 코어 schema 가 아니라 *각 app schema* 에 V015 로 생성됩니다. `PhoneOtpCode` 를 `CORE_ENTITY_PACKAGES` 에 등록해 라우팅 EMF 의 scan 대상에 포함시키면, `SchemaRoutingDataSource` 가 현재 요청 slug 의 schema 로 INSERT/SELECT 를 자동 라우팅합니다 (코어 schema 없음).

**④ find-or-create 는 social 경로 재사용.** `AuthPort.issueForVerifiedPhone(phoneE164, appSlug)` 가 `social_identities(provider="phone")` 로 유저를 find-or-create 하고 토큰을 발급합니다 — OAuth (ADR-017) 와 동일 경로.

## 왜 이런 고민이 시작됐나?

인디 앱, 특히 국내향 앱은 *휴대폰 본인/점유인증* 을 요구하는 경우가 많아요. 이메일 인증 (ADR-024) 만으로는 *"이 번호의 소유자가 맞는가"* 를 증명하지 못합니다. 그런데 점유인증을 한 앱에 박아 넣으면, 다음 앱에서 또 *SMS 발송 글루 + OTP 생성/검증/만료/시도 제한* 을 재구현하게 돼요 — *시간이 가장 희소한 자원* (프롤로그 제약 2) 위반.

여기서 두 개의 서로 다른 관심사가 한 덩어리로 얽히는 게 문제였어요.

- **발송 채널**: 실제 문자를 *어디로 보내는가* (SOLAPI? 다른 발신사? dev 에선 발송 안 함?) — 이건 *email 발송과 똑같은 모양* 의 문제입니다. 발송처 자격증명이 환경마다 다르고, dev 서버 도그푸딩 단계에선 실 발신사 발급 전이라 *콘솔에서 코드를 확인* 할 수 있어야 합니다.
- **인증 프로토콜**: *6자리 코드를 만들고 · 해시로 저장하고 · TTL·시도 제한을 걸고 · 검증 후 유저를 발급* 하는 흐름 — 이건 발송 채널과 무관한 *상태 머신* 입니다.

이 둘을 한 클래스에 합치면 "발신사를 바꾸려는데 OTP 로직까지 건드려야" 하거나 "OTP 정책을 고치려는데 HTTP 글루가 끼어드는" 결합이 생겨요. 결제 도메인을 *정책 (billing) vs 채널 (IAP/PG)* 로 가른 ADR-019 와 정확히 같은 모양의 분리 압력입니다.

추가로 ADR-037 이 *core schema 를 폐기* 한 직후라는 타이밍이 중요했어요. OTP 같은 신규 table 을 *어디에 둘 것인가* 의 답이 이미 정해져 있었습니다 — *코어 schema 는 없다, 모든 도메인 데이터는 app schema 로 라우팅된다*. OTP 도 이 규칙을 따라야 했고, 그게 `PhoneOtpCode` 를 `CORE_ENTITY_PACKAGES` 에 넣는 결정으로 이어졌어요.

핵심 물음:

> *SMS 발송 채널 (환경별 발신사) 과 점유인증 프로토콜 (OTP 상태 머신) 을 분리하고, OTP 데이터를 코어 schema 없이 per-app schema 로 라우팅하면서, 앱이 얇은 컨트롤러만으로 재사용하게 하려면 어떻게 구성하는가?*

## 결정

### 1. `core-sms` — `SmsPort` + 멀티 어댑터 토글

SMS 발송을 `SmsPort.send(String toE164, String text)` 한 메서드로 추상화합니다. 수신/발신 번호는 *E.164* (`+8210…`) 로 통일하고, 발신사별 형식 변환 (예: SOLAPI 국내형 `01012345678`) 은 어댑터 내부 책임입니다.

어댑터는 `SmsAutoConfiguration` 이 환경별로 토글합니다:

- **운영 — `CoolSmsAdapter`**: CoolSMS(SOLAPI) `api-key` + `api-secret` 이 설정되면 등록. `https://api.solapi.com/messages/v4/send` 에 동기 `HttpURLConnection` POST. 인증은 *SOLAPI HMAC* — `Authorization: HMAC-SHA256 apiKey=…, date=…, salt=…, signature=…` 이며 `signature = HMAC-SHA256(date + salt, apiSecret)` 의 소문자 hex.
- **dev/local — `LoggingSmsAdapter`** (`@Profile("!prod")` fallback): 실 발송 대신 수신 번호/본문을 `WARN` 로그로 출력. `isDevCapture()` 가 `true` 라서 호출자가 *raw OTP 코드를 응답 body 로 노출* 할 수 있습니다. (email 의 `LoggingEmailAdapter` 가 `local` 전용인 것과 달리 SMS 는 dev 서버에서도 활성 — 실 발신사 발급 전 도그푸딩용이고, dev 서버는 Cloudflare Access 게이팅이라 노출이 안전.)

```java
public interface SmsPort {
    void send(String toE164, String text);
    default boolean isDevCapture() { return false; } // LoggingSmsAdapter 만 true
}
```

`core-email` 의 `EmailPort` 멀티 어댑터 패턴 (ADR-024) 과 동일합니다. `CoolSmsAdapter` 는 `core-email` 의 `ResendEmailAdapter` 처럼 `apiUrl()` / `doPost()` seam 으로 HTTP 글루를 테스트 가능하게 분리하고, `HttpURLConnection` (동기 host resolve) 를 쓰는 이유도 같습니다 (일부 docker 환경에서 `java.net.http.HttpClient` 비동기 resolve 가 깨지는 문제 회피).

### 2. `core-phone-auth` — `PhoneAuthPort` + `OtpService`

점유인증을 별도 코어 도메인으로 분리합니다. 진입점은 `PhoneAuthPort`:

```java
public interface PhoneAuthPort {
    Optional<String> requestOtp(String phoneE164, String brandName); // dev-capture 면 raw 코드
    AuthResponse verify(String phoneE164, String code, String appSlug); // find-or-create + 토큰
}
```

기본 구현 `PhoneAuthAdapter` 는 *오케스트레이션* 만 합니다 — OTP 수명관리 (`OtpService`) 와 토큰 발급 (`AuthPort.issueForVerifiedPhone`) 을 엮을 뿐, 자기 로직이 없어요. `appSlug` 는 호출자 (앱 컨트롤러) 가 전달합니다.

`OtpService` 가 *상태 머신* 본체입니다:

- `requestOtp`: rate-limit (1시간 윈도우 최대 5회) → 6자리 코드 생성 → *SHA-256 해시로만 저장* (raw 미저장) → SMS 발송. `SmsPort` 는 `ObjectProvider` 로 lazy 의존 — 실 발신사 미설정이어도 부팅 OK, 발송 시점에 부재면 `OTP_SMS_UNAVAILABLE`.
- `verify`: 최신 미사용 코드와 대조. 만료 (TTL 5분) / 시도 초과 (최대 5회) / 불일치 가드. 불일치 시 `incrementAttempts()` 후 예외를 던지는데, 기본 동작 (RuntimeException → 롤백) 은 attempts 증가를 사라지게 해 brute-force 가드를 무력화하므로 `@Transactional(noRollbackFor = PhoneAuthException.class)` 로 증가분을 커밋시킵니다.

### 3. OTP 데이터 = per-app schema (코어 schema 없음 — ADR-037)

ADR-037 이후 *core schema 자체가 PostgreSQL 에 없으므로*, OTP table 도 *각 app schema 안* 에 둡니다. `new-app.sh` 가 `V015__init_phone_otp_codes.sql` 를 app 의 migration 디렉토리에 생성해 `phone_otp_codes` table 을 *slug schema* 에 만들어요 (옵트인 — 점유인증 미사용 앱은 V015 삭제 가능).

라우팅은 `PhoneOtpCode` 를 `CORE_ENTITY_PACKAGES` 에 등록해서 성립합니다. 라우팅 EMF (`RoutingDataSourceConfig`) 가 이 패키지 배열을 entity scan 대상으로 쓰므로, `PhoneOtpCode` 의 모든 INSERT/SELECT 가 `SchemaRoutingDataSource` 의 현재 `SlugContext` slug schema 로 자동 라우팅됩니다 (ADR-018).

```java
public static final String[] CORE_ENTITY_PACKAGES = {
    "com.factory.core.user.impl.entity",
    "com.factory.core.auth.impl.entity",
    // ...
    "com.factory.core.phoneauth.impl.entity", // 휴대폰 점유인증 — PhoneOtpCode
    "com.factory.common.persistence.entity"
};
```

`OtpService` 의 `@Transactional` 도 core 서비스 컨벤션대로 `@Primary @Bean("transactionManager")` 라우팅 매니저에 바인딩됩니다 (`core-auth` 의 `AuthServiceImpl` 과 동일 패턴).

### 4. `AuthPort.issueForVerifiedPhone` — 검증 번호 → 유저 find-or-create

번호→유저 식별을 점유인증 도메인이 직접 하지 않고 `AuthPort` 에 위임합니다. `issueForVerifiedPhone(phoneE164, appSlug)` 는 `social_identities(provider="phone")` 로 유저를 조회 — 있으면 토큰 발급, 없으면 *합성 email* (`phone-<digits>@phone.invalid`, 실 email 과 절대 충돌 안 함, 발송 미사용) 로 social 유저를 생성합니다. OAuth (ADR-017) 와 *동일한 social 경로* 를 재사용해, 점유인증 유저가 일반 social 유저와 같은 모델로 흡수됩니다.

### 5. 앱 재사용 = `PhoneAuthPort` + 얇은 컨트롤러

> ⚠️ **역사적 기록** — 이 절은 위 "갱신" 으로 대체됐어요. 컨트롤러는 이제 **core 공유** `PhoneAuthController` 라 앱이 추가할 게 없습니다. brand 도 상수 대신 `app.phone-auth.brands.<slug>` config 로 받아요. 아래는 도입 당시 설계 기록입니다.

앱은 `<Slug>PhoneAuthController` 만 추가하면 됩니다 — `PhoneAuthPort` 를 주입받고, 앱 고유의 `BRAND` (SMS 표시명, 예 `"랜목톡"`) 와 `appSlug` 를 인자로 채워 호출하는 *얇은 컨트롤러 + `PhoneOtp*` DTO* 가 전부입니다. ADR-013 의 *"core-auth-impl 은 라이브러리, 컨트롤러는 앱 소유"* 원칙과 동일합니다.

## 효과

| 측면 | Before (점유인증 없음 / 앱별 재구현 가정) | After |
|---|---|---|
| SMS 발송 추상화 | 앱마다 발신사 글루 재작성 | `SmsPort` 1개 — 어댑터만 토글 |
| dev 발송 | 실 발신사 필수 또는 임시 코드 | `LoggingSmsAdapter` dev-capture (콘솔 OTP) |
| 운영 발송 | — | `CoolSmsAdapter` (SOLAPI HMAC-SHA256) |
| OTP 상태 머신 | 앱마다 생성/검증/만료/시도제한 재구현 | `OtpService` 1개 (rate-limit + brute-force 가드) |
| OTP 저장 위치 | core schema 후보 | per-app schema (V015), `CORE_ENTITY_PACKAGES` 라우팅 |
| raw 코드 저장 | — | 저장 안 함 — SHA-256 해시만 |
| 번호→유저 | 별도 유저 모델 | `social_identities(provider="phone")` find-or-create (OAuth 경로 재사용) |
| 앱 재사용 비용 | 풀스택 재구현 | `PhoneAuthPort` + 얇은 컨트롤러 (BRAND·appSlug) |

## 관련 ADR

- [`ADR-037 · core schema + coreDataSource Bean 폐기`](./adr-037-core-schema-deprecation.md) — OTP table 이 *코어 schema 가 아니라 per-app schema* 에 가는 전제. `CORE_ENTITY_PACKAGES` + 라우팅 EMF 로 slug schema 라우팅.
- [`ADR-019 · billing / iap / payment 도메인 분리`](./adr-019-billing-iap-payment-separation.md) — *정책 vs 채널* 분리 패턴. 본 ADR 의 *점유인증 프로토콜 (core-phone-auth) vs 발송 채널 (core-sms)* 분리와 동형.
- [`ADR-024 · email 도메인 추출`](./adr-024-email-domain-extraction.md) — `EmailPort` 멀티 어댑터 (real/mock 토글) 패턴. `SmsPort` 가 그대로 차용.
- [`ADR-018 · SchemaRoutingDataSource`](./adr-018-schema-routing-datasource.md) — `PhoneOtpCode` 의 INSERT/SELECT 를 slug schema 로 라우팅하는 인프라.
- [`ADR-017 · OAuth 2.0 통합`](./adr-017-oauth-integration.md) — `issueForVerifiedPhone` 이 재사용하는 social find-or-create 경로.
- [`ADR-013 · 앱별 인증 엔드포인트`](./adr-013-per-app-auth-endpoints.md) — 컨트롤러 공유화(방향 B). 점유인증 컨트롤러도 이 결정에 맞춰 core 공유 `PhoneAuthController` 로 전환 (위 갱신).

## Code References

- `core/core-sms-api/src/main/java/com/factory/core/sms/api/SmsPort.java` — 발송 추상화 + `isDevCapture()`
- `core/core-sms-impl/src/main/java/com/factory/core/sms/impl/CoolSmsAdapter.java` — SOLAPI HMAC-SHA256 (`authorizationHeader`:110, `toDomesticNumber`:135)
- `core/core-sms-impl/src/main/java/com/factory/core/sms/impl/LoggingSmsAdapter.java` — dev-capture fallback
- `core/core-phone-auth-api/src/main/java/com/factory/core/phoneauth/api/PhoneAuthPort.java` — requestOtp / verify
- `core/core-phone-auth-impl/src/main/java/com/factory/core/phoneauth/impl/service/OtpService.java` — rate-limit + brute-force 가드 (`noRollbackFor`:32)
- `core/core-phone-auth-impl/src/main/java/com/factory/core/phoneauth/impl/PhoneAuthAdapter.java` — OtpService + AuthPort 오케스트레이션
- `core/core-phone-auth-impl/src/main/java/com/factory/core/phoneauth/impl/entity/AuthPhoneVerificationCode.java` — SHA-256 해시 저장 엔티티
- `core/core-auth-impl/src/main/java/com/factory/core/auth/impl/AuthServiceImpl.java#issueForVerifiedPhone` — find-or-create
- `common/common-persistence/src/main/java/com/factory/common/persistence/AbstractAppDataSourceConfig.java#CORE_ENTITY_PACKAGES` — phoneauth entity 패키지 (`AuthPhoneVerificationCode`) 등록
- `tools/new-app/new-app.sh` — `V015__init_auth_phone_verification_codes.sql` heredoc (per-app schema OTP table, 옵트인)

## 후속

- *`CoolSmsAdapter` 의 비동기/재시도* — 현재 동기 `HttpURLConnection` 발송. 발송 실패 시 즉시 `SMS_DELIVERY_FAILED` 이고 재시도 없음. 발송량 증가 시 큐 + 재시도 정책 별도 cycle 후보.
- *발신사 멀티화* — `SmsPort` 가 이미 추상화돼 있으므로, 국제 발송 (Twilio 등) 어댑터 추가는 `SmsAutoConfiguration` 토글 1개로 가능. 필요 시점에 추가.
- ~~*Lite mode 토글* — 점유인증을 ADR-034 toggle 목록에 편입~~ → **완료**. `app.features.phone-auth` (default ON) 가 PhoneAuthAutoConfiguration(+공유 컨트롤러) 전체를 게이팅. off 면 Port·컨트롤러 함께 사라짐.
- *rate-limit 정책 외부화* — 현재 `OtpService` 의 윈도우/횟수가 상수. 앱별 차등이 필요해지면 property 화.
