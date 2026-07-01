# 계약 테스트 (Contract Testing)

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~12분

이 문서는 `template-spring` 의 3층 테스트 구조와 계약 테스트 작성·강제 규약을 정의합니다.

---

## 왜 계약 테스트인가

이 프로젝트는 모듈러 모놀리스 구조라, 포트 인터페이스와 DTO 를 담는 `core-*-api` 와 구현체를 담는 `core-*-impl` 을 Gradle 모듈로 분리합니다 ([`ADR-003`](../../philosophy/adr-003-api-impl-split.md)). 이 분리가 실제로 값을 하려면 세 가지가 지켜져야 해요.

- **Port 계약이 흔들리지 않아야** 소비자가 안전하게 의존합니다. 여기서 소비자는 `apps/` 모듈과 파생 레포예요.
- **DTO 의 JSON 직렬화가 호환돼야** 클라이언트 앱과 wire-protocol 이 일치합니다.
- **impl 교체가 가능해야** 나중에 마이크로서비스로 추출할 수 있어요. 예를 들면 HTTP 어댑터로 바꿔 끼우는 경우예요.

이 세 가지를 테스트로 강제하는 것이 계약 테스트입니다.

---

## 3층 테스트 구조

| 층 | 검증 대상 | 위치 | 예시 |
|---|---|---|---|
| **Layer 1 — JSON 계약** | DTO ↔ JSON 왕복, 필드 호환성 | `core-*-api/src/test/**/dto/` | `SignUpRequestJsonTest` |
| **Layer 2 — Port 행위 계약** | 인터페이스가 약속한 외부 관측 행위 | api 는 `src/testFixtures/`, impl 은 `src/test/` | `AbstractAuthPortContractTest` + `AuthServiceImplContractTest` |
| **Layer 3 — 내부 알고리즘 단위** | Port 로 환원 불가능한 내부 로직 | `core-*-impl/src/test/` | `RefreshTokenServiceTest`, `TokenGeneratorTest` |

---

## Layer 1 — JSON 계약 테스트

### 언제 추가하는가

- 새 DTO 를 `core-*-api` 의 `dto` 패키지에 추가할 때 JSON 테스트를 함께 추가합니다.
- 기존 DTO 에 필드를 더하거나 바꿀 때는 `canonicalJson()` 을 업데이트하고 테스트를 돌려 호환성을 확인합니다.

### 구조

모든 JSON 테스트는 common-testing 이 제공하는 `AbstractJsonContractTest<T>` 를 상속합니다. Spring 컨텍스트가 필요 없어요. 순수 `ObjectMapper` 위에서 동작합니다. 구현할 추상 메서드는 `sampleType()`, `sample()`, `canonicalJson()` 세 개예요.

```java
// core-auth-api/.../dto/SignUpRequestJsonTest.java 전체
class SignUpRequestJsonTest extends AbstractJsonContractTest<SignUpRequest> {
    @Override protected Class<SignUpRequest> sampleType() { return SignUpRequest.class; }

    @Override protected SignUpRequest sample() {
        return new SignUpRequest("a@b.com", "pw12345678", "홍길동", "sumtally");
    }

    @Override protected String canonicalJson() {
        return """
            {"email":"a@b.com","password":"pw12345678","displayName":"홍길동","appSlug":"sumtally"}
            """;
    }
}
```

### 자동으로 수행되는 3가지 테스트

세 메서드만 구현하면 아래 세 테스트가 상속으로 자동 실행됩니다.

| 테스트 | 검증 |
|---|---|
| `serialize_roundTripsToSample` | DTO → JSON → DTO 왕복 후 record `equals` 로 비교 |
| `deserialize_parsesCanonicalJson` | canonical JSON → DTO 매핑 정확성 |
| `deserialize_ignoresUnknownField` | 추가 필드가 있어도 에러 없이 파싱 (forward compat) |

### 전역 Jackson 정책

테스트 `ObjectMapper` 는 `AbstractJsonContractTest` 의 `contractObjectMapper()` 가 직접 구성합니다. 적용되는 정책은 네 가지예요.

- `@JsonInclude(NON_NULL)` 으로 null 필드 직렬화를 생략합니다.
- `FAIL_ON_UNKNOWN_PROPERTIES=false` 로 알 수 없는 필드를 무시합니다.
- `JavaTimeModule` 로 `Instant` · `LocalDate` 를 ISO-8601 문자열로 직렬화합니다.
- `WRITE_DATES_AS_TIMESTAMPS=false` 로 숫자 timestamp 를 금지합니다.

DTO 에 `@JsonProperty` 나 `@JsonIgnore` 같은 어노테이션을 붙이지 말고 전역 정책을 일관되게 유지하세요. 예외가 필요하면 해당 DTO 의 JsonTest 에 단언 메서드를 따로 추가합니다.

### 민감 필드 처리

`UserAccount.passwordHash` 같은 민감 필드는 존재만 확인하고 값을 단언하지 않습니다. 운영에서 해시 값이 매번 달라지기 때문이에요. `serialize(...)` 헬퍼로 직렬화한 뒤 키 존재만 확인합니다.

```java
@Test
void serialize_passwordHashFieldPresent_valueNotAsserted() throws Exception {
    String json = serialize(sample());
    assertThat(json).contains("\"passwordHash\":");
}
```

> JSON 직렬화 정책의 전체 규약과 필드 추가·변경 절차는 [`JSON 계약 규약`](../../api-and-functional/api/json-contract.md) 이 단일 출처예요.

---

## Layer 2 — Port 행위 계약 테스트

### 파일 배치

```
core-<x>-api/
├── src/main/java/.../api/
│   └── <X>Port.java                      (인터페이스)
└── src/testFixtures/java/.../contract/
    ├── Abstract<X>PortContractTest.java  (계약 명세)
    ├── <X>Fixtures.java                  (fixture 인터페이스)
    └── <X>Recorder.java                  (외부 port 가 있는 경우)

core-<x>-impl/
└── src/test/java/.../
    ├── <X>ContractTestApplication.java   (@SpringBootConfiguration)
    ├── Jpa<X>Fixtures.java               (@TestComponent, fixture 구현)
    ├── InMemory<Port>Adapter.java        (외부 port fake)
    └── <X>ServiceImplContractTest.java   (concrete, @ContractTest + @Import)
```

### Abstract 계약 구조 — method 별 @Nested

각 Port 의 public method 마다 `@Nested` 클래스를 하나씩 두고, 그 안에 happy path 와 error path 를 담습니다. abstract 클래스는 `AbstractContractBase` 를 상속하고, 구현 주입은 `port()` 와 `fixtures()` 추상 메서드로 받아요.

```java
public abstract class AbstractUserPortContractTest extends AbstractContractBase {

    protected abstract UserPort port();
    protected abstract UserFixtures fixtures();

    @Nested
    class GetSummary {
        @Test void returnsSummary_whenUserExists() { ... }
        @Test void throwsUserException_whenUserNotFound() { ... }
        @Test void throwsUserException_whenUserSoftDeleted() { ... }
    }

    @Nested
    class UpdateProfile {
        @Test void updatesDisplayName_whenValidRequest() { ... }
        @Test void throwsUserException_whenUserNotFound() { ... }
    }
    // ...
}
```

이 패턴을 쓰는 abstract 계약은 `AbstractUserPortContractTest`, `AbstractAuthPortContractTest`, `AbstractDevicePortContractTest`, `AbstractBillingPortContractTest` 등 도메인마다 하나씩 있어요. 모두 `core-<x>-api/src/testFixtures/` 의 `contract` 패키지에 삽니다.

### Concrete 구현 — `@ContractTest` 메타 어노테이션

```java
@ContractTest
@Import(JpaUserFixtures.class)
class UserServiceImplContractTest extends AbstractUserPortContractTest {

    @Autowired private UserPort userPort;
    @Autowired private JpaUserFixtures fixtures;

    @Override protected UserPort port() { return userPort; }
    @Override protected UserFixtures fixtures() { return fixtures; }
}
```

`@ContractTest` 가 자동으로 제공하는 것은 네 가지예요.

- `@SpringBootTest`
- `@ActiveProfiles("test")`
- `@Sql(scripts = "classpath:contract-cleanup.sql", executionPhase = BEFORE_TEST_METHOD)`
- `@Import(ContractTestConfig.class)`

### Fixtures 패턴

fixture 인터페이스는 `core-<x>-api` 의 testFixtures 에, 구현은 `core-<x>-impl` 의 test 에 둡니다.

```java
// core-user-api/.../contract/UserFixtures.java
public interface UserFixtures {
    long createVerifiedUser(String email, String passwordHash, String displayName);
    long createUnverifiedUser(String email, String passwordHash, String displayName);
    long createSoftDeletedUser(String email, String displayName);
    void linkAuthSocialIdentity(long userId, String provider, String providerId);
}
```

```java
// core-user-impl/.../JpaUserFixtures.java
@TestComponent
public class JpaUserFixtures implements UserFixtures { ... }
```

### Fake Adapter 패턴 (외부 Port)

외부 API 를 호출하는 Port 는 테스트에서 fake 로 대체합니다. `EmailPort`, `PushPort`, `BillingPort` 가 그 예예요. Recorder 인터페이스로 발송 내역을 기록하고, InMemory 어댑터가 그 둘을 함께 구현합니다.

먼저 Recorder 인터페이스를 `core-<x>-api` 의 testFixtures 에 둡니다.

```java
// core-auth-api/.../contract/EmailRecorder.java
public interface EmailRecorder {
    record SentEmail(String to, String subject, String htmlBody) {}
    List<SentEmail> all();
    List<SentEmail> sentTo(String email);
    void clear();
}
```

InMemory 어댑터는 `core-<x>-impl` 의 test 에서 Port 와 Recorder 를 동시에 구현합니다.

```java
// core-auth-impl/.../InMemoryEmailAdapter.java
public class InMemoryEmailAdapter implements EmailPort, EmailRecorder { ... }
```

Contract test 에서는 이 어댑터를 `@Primary` 로 주입해 실제 발송을 가로챕니다.

```java
@ContractTest
@Import({AuthServiceImplContractTest.Config.class, JpaAuthFixtures.class})
class AuthServiceImplContractTest extends AbstractAuthPortContractTest {
    @TestConfiguration
    static class Config {
        @Bean @Primary
        EmailPort emailPort(InMemoryEmailAdapter adapter) { return adapter; }
        @Bean
        InMemoryEmailAdapter inMemoryEmailAdapter() { return new InMemoryEmailAdapter(); }
    }
    // ...
}
```

---

## Delegation mock 테스트 금지

`Mockito.verify(b).foo()` 로 "A 가 B.foo() 를 호출하는가" 를 검증하는 테스트는 금지합니다.

```java
// ✗ 금지 — over-specification
@Test
void signUpWithEmail_delegatesToEmailAuthService() {
    when(emailAuthService.signUp(request)).thenReturn(expected);
    service.signUpWithEmail(request);
    verify(emailAuthService).signUp(request);
    verify(appleSignInService, never()).signIn(any());
}
```

이유는 세 가지예요.

- 내부 서비스 이름이나 호출 구조가 바뀌면, 외부 행위가 그대로여도 테스트가 깨집니다.
- Port 계약 테스트가 같은 행위를 더 강하게 검증합니다. 실제 서비스가 정말 동작하는지까지 간접 확인하기 때문이에요.
- 테스트가 구현 내부에 결합해 Port/Adapter 철학과 충돌합니다.

대신 Port 계약 테스트에서 외부로 관측 가능한 행위로 검증합니다. 발송 여부는 Recorder 의 상태로 확인해요.

```java
// ✓ 허용 — 행위 검증
@Test
void sendsVerificationEmail() {
    port().signUpWithEmail(new SignUpRequest("a@test.com", "pw", "A", "sumtally"));
    assertThat(emailRecorder().sentTo("a@test.com")).hasSize(1);
}
```

근거는 [`ADR-014 · Delegation mock 테스트 금지`](../../philosophy/adr-014-no-delegation-mock.md) 에 있어요.

---

## Layer 3 — 내부 알고리즘 단위 테스트

Port 계약으로 환원되지 않는 고유 내부 로직은 단위 테스트로 유지합니다.

### 유지 대상 예시

- `RefreshTokenServiceTest` — 회전과 탈취 감지 알고리즘 (`family_id` 전파)
- `TokenGeneratorTest` — JWT 서명·클레임 생성 메커니즘
- `AppleSignInServiceTest` — Apple JWT 와 JWKS 검증 로직
- `GoogleSignInServiceTest` — Google id token 검증
- `EmailVerificationServiceTest` — 토큰 생성·만료 로직 (발송 검증은 Contract 로 이관)
- `PasswordResetServiceTest` — 위와 동일
- `ResendEmailAdapterTest` — `EmailPort` 어댑터 단위
- `PushServiceTest` — 오케스트레이션 알고리즘 (토큰 조회 → 발송 → 무효 토큰 정리)

### 삭제 대상 예시 (delegation mock)

단순 위임만 검증하던 아래 테스트들은 Port 계약과 100% 중복이라 제거했어요. 현재 코드베이스에는 남아 있지 않습니다.

- `AuthServiceImplTest` — 모든 method 가 단순 위임 검증
- `EmailAuthServiceTest` — AuthPort 계약과 중복
- `UserServiceImplTest`, `DeviceServiceImplTest` — Port 구현 전체

---

## TRUNCATE Cleanup 안전장치

`contract-cleanup.sql` 은 `@Sql(BEFORE_TEST_METHOD)` 로 매 테스트 전에 실행됩니다. 운영 DB 에 잘못 연결된 상태에서 실행되는 것을 막는 가드 블록을 먼저 두고, 존재하는 테이블만 골라 TRUNCATE 해요. 모듈마다 classpath 에 올라온 Flyway 마이그레이션이 다르기 때문에, 테이블 존재 여부를 확인한 뒤에만 비웁니다.

```sql
-- 가드: 운영 DB 에 실수로 연결된 상태에서 실행되는 것 방지
DO $$
BEGIN
    IF current_database() NOT LIKE '%test%' THEN
        RAISE EXCEPTION 'refusing to truncate non-test database: %', current_database();
    END IF;
END $$;

-- 존재하는 테이블만 TRUNCATE (모듈별 classpath 차이 대응). CASCADE 로 FK 참조도 함께 정리.
DO $$
DECLARE
    t TEXT;
    candidates TEXT[] := ARRAY[
        -- billing 도메인 (FK 의존 순서)
        'subscription_renewals', 'payment_webhook_events', 'subscriptions', 'payment_history', 'subscription_plans',
        -- auth/user 도메인
        'auth_refresh_tokens', 'auth_email_verification_tokens', 'auth_password_reset_tokens',
        'auth_social_identities', 'devices', 'users'
    ];
BEGIN
    FOREACH t IN ARRAY candidates LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t) THEN
            EXECUTE format('TRUNCATE TABLE %I RESTART IDENTITY CASCADE', t);
        END IF;
    END LOOP;
END $$;
```

비-test DB 를 건드리는 사고를 막는 방어선은 네 겹이에요.

- Testcontainers JDBC URL — ephemeral Docker 컨테이너 위에서만 동작합니다.
- `@ActiveProfiles("test")` — 테스트 프로필을 강제합니다.
- 가드 SQL — DB 이름에 `test` 가 없으면 즉시 에러를 던집니다.
- DB role 권한 — [`architecture.md`](../../structure/architecture.md) 의 레이어 1, DB Role 권한 분리.

---

## 모듈 간 의존 주의사항

core-*-impl 의 test 가 다른 impl 을 `testImplementation` 으로 가져오는 것은 허용합니다.

예를 들어 `core-device-impl` 의 `devices.user_id` 는 `users(id)` 를 FK 로 참조해요. 그래서 `users` 테이블을 만드는 Flyway V001 마이그레이션이 필요하고, 이를 위해 `testImplementation project(':core:core-user-impl')` 을 가져옵니다.

이는 [`architecture-rules.md`](../../structure/architecture-rules.md) 의 ArchUnit **r3** (core-impl ↔ core-impl 직접 의존 금지) 에 대한 test 전용 예외예요. main sourceSet 은 여전히 독립이고, test 인프라 조립에만 느슨한 규칙을 적용합니다.

---

## 체크리스트 (새 DTO/Port 추가 시)

### 새 DTO 추가

- [ ] `core-<x>-api/src/main/java/.../dto/<Dto>.java` 작성 (record)
- [ ] `core-<x>-api/src/test/java/.../dto/<Dto>JsonTest.java` 작성
- [ ] `./gradlew :core:core-<x>-api:test` 통과 확인

### 새 Port method 추가

- [ ] `<X>Port.java` 에 method 추가
- [ ] `Abstract<X>PortContractTest` 에 `@Nested` 클래스 추가 (happy + error path)
- [ ] 필요하면 `<X>Fixtures` 인터페이스에 fixture helper 추가
- [ ] `Jpa<X>Fixtures` 에 fixture helper 구현
- [ ] `./gradlew :core:core-<x>-impl:test` 통과 확인

### 새 Port 전체 추가 (새 core-<x>-api 모듈)

- [ ] 위 모든 단계와 더불어
- [ ] `core-<x>-api/build.gradle` 에 `java-test-fixtures` 플러그인 적용
- [ ] `core-<x>-impl/build.gradle` 에 `testImplementation testFixtures(project(':core:core-<x>-api'))` 추가
- [ ] `<X>ContractTestApplication.java` 작성 (@SpringBootConfiguration)
- [ ] 외부 port 가 있으면 `<X>Recorder` 와 `InMemory<Port>Adapter` 작성

---

## 관련 문서

- [`JSON 계약 규약`](../../api-and-functional/api/json-contract.md) — Layer 1 의 직렬화 정책과 필드 변경 절차의 단일 출처
- [`Testing Strategy`](./testing-strategy.md) — 4층 테스트 전략 안에서 계약 테스트의 위치
- [`Architecture Rules (ArchUnit)`](../../structure/architecture-rules.md#r3-core_impl_must_not_depend_on_each_other) — r3 core-impl 의존 금지 규칙
- [`ADR-003 · -api / -impl 분리`](../../philosophy/adr-003-api-impl-split.md) — Port 경계의 전제
- [`ADR-014 · Delegation mock 테스트 금지`](../../philosophy/adr-014-no-delegation-mock.md) — Fake Adapter 로 행위 검증하는 근거
