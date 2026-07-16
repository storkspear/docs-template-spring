# Testing Strategy

> **유형**: Explanation · **독자**: Level 2 · **읽는 시간**: ~12분

**설계 근거**: [`ADR-014 · Delegation mock 테스트 금지`](../../philosophy/adr-014-no-delegation-mock.md)

이 문서는 `template-spring` 의 전체 테스트 전략을 설명해요. 어떤 종류의 테스트를 어디에 두고, 무엇을 검증하며, 언제 실행하는지가 주제예요.

계약 테스트(Contract Testing)의 상세한 작성 규약은 [`계약 테스트 (Contract Testing)`](./contract-testing.md) 에서 별도로 관리하고, ArchUnit 규칙의 전체 목록은 [`모듈 의존 규칙 (Module Dependencies)`](../../structure/module-dependencies.md) 에서 다뤄요. 여기서는 큰 그림과 공통 전략에 집중해요.

---

## 한 문장 요약

이 문서는 4층 테스트 전략(Unit · Contract JSON · Contract Port · Integration)의 전체 그림과 각 층의 역할·예시·체크리스트를 설명합니다. ArchUnit 은 이 4층 위에 얹힌 구조 강제 장치로 따로 다뤄요.

---

## 왜 4층 구조인가

테스트는 "실행 속도" 와 "검증 강도" 사이에 늘 trade-off 가 있어요. 단위 테스트만 있으면 빠르지만 모듈 간 실제 연결은 검증되지 않고, 통합 테스트만 있으면 느려서 개발자가 점점 실행하지 않게 됩니다.

그래서 이 레포는 검증 대상이 다른 네 개의 층을 명확히 나눕니다. 여기에 패키지·모듈 구조를 강제하는 ArchUnit 이 별도 장치로 더해져요.

| 층 | 검증 대상 | 실행 시간 | 격리 수준 | Spring 컨텍스트 |
|---|---|---|---|---|
| **Unit** | 단일 클래스의 내부 로직 | 밀리초 | 완전 격리(Mock 사용) | 없음 |
| **Contract (JSON)** | DTO ↔ JSON 직렬화 계약 | 밀리초 | 완전 격리(ObjectMapper 만) | 없음 |
| **Contract (Port)** | Port 인터페이스의 행위 계약 | 수 초 | DB 는 Testcontainers, 외부 port 는 fake | `@SpringBootTest` |
| **Integration** | 여러 레이어가 조립된 실제 흐름 | 수 초 | Testcontainers + 트랜잭션 롤백 | `@SpringBootTest` |
| ArchUnit(부가) | 패키지·모듈·네이밍 구조 | 수 초(bootstrap 1회) | classpath 스캔 | 없음 |

층이 많아 부담스럽게 느껴질 수 있는데, 실제로는 각 층이 서로 다른 파일 위치에 있어 자연스럽게 구분돼요. 한 PR 에서 모든 층을 동시에 수정하는 경우는 드뭅니다.

---

## Layer 1 — Unit Test

### 목적

단일 클래스의 내부 알고리즘을 검증합니다. DB·네트워크·Spring 컨텍스트 없이 JUnit 5 + Mockito 로 빠르게 실행돼요.

### 어디에 두는가

- `common-*/src/test/java/...` — 공통 유틸리티, 필터, 파서 등
- `core-*-impl/src/test/java/...` — Port 계약으로 환원되지 않는 내부 알고리즘만

### 유지 대상 예시

템플릿에는 다음과 같은 단위 테스트가 있어요.

- `JwtServiceTest` — JWT 서명·검증 메커니즘
- `JwtPropertiesTest` — `@ConfigurationProperties` 바인딩
- `PasswordHasherTest` — 해싱 알고리즘
- `AuthenticatedUserTest` — 인증 principal 생성
- `AppSlugVerificationFilterTest` — 필터 로직
- `PaginationTest`, `SearchSortTest` — 공통 페이지·정렬 파서
- `QueryDslPredicateBuilderTest` — 조건식 빌더
- `GlobalExceptionHandlerTest` — 예외 → ApiError 매핑

### 기본 패턴

```java
class JwtServiceTest {

    private final JwtProperties props = new JwtProperties(
        "test-secret-that-is-at-least-32-chars-long",
        Duration.ofMinutes(15),
        Duration.ofDays(30),
        "test-issuer"
    );
    private final JwtService service = new JwtService(props);

    @Test
    void issueAndValidate_returnsAuthenticatedUser() {
        String token = service.issueAccessToken(1L, "user@test.com", "sumtally", "user");
        AuthenticatedUser user = service.validateAccessToken(token);

        assertThat(user.userId()).isEqualTo(1L);
        assertThat(user.appSlug()).isEqualTo("sumtally");
    }
}
```

### Mock 전략 — 언제 Mock 을 쓰나

Mockito `@Mock`, `BDDMockito.given(...)` 은 이 층에서만 적극적으로 씁니다. 그 외 층에서는 가능한 한 실제 구현(Testcontainers Postgres, InMemory fake adapter)을 쓰는 편이에요.

Mock 이 어울리는 자리는 이래요.

- 외부 시스템 호출이 필요한데 단위 테스트에서 네트워크를 쓰고 싶지 않을 때
- 시간(`Clock`)이나 난수(`TokenGenerator`) 같은 비결정적 의존성을 고정하고 싶을 때
- 특정 예외 발생 시 후속 동작을 검증하고 싶을 때

반대로 Mock 을 쓰지 않는 자리는 이래요.

- 같은 모듈 안의 순수 함수를 검증할 때 — 그냥 실제 호출
- DB 동작을 검증할 때 — 통합 테스트나 Contract 테스트로 이관
- "A 가 B.foo() 를 호출하는가" 같은 위임 검증 — 금지합니다. 이유는 [`계약 테스트 (Contract Testing)`](./contract-testing.md) 의 "Delegation mock 테스트 금지" 를 참고하세요.

---

## Layer 2 — Contract Test (JSON)

DTO 의 JSON 직렬화·역직렬화 계약을 검증합니다. 클라이언트(Flutter 앱)와의 wire protocol 이 조용히 깨지는 것을 막는 테스트예요.

- 베이스 클래스: `AbstractJsonContractTest<T>` (`common-testing`)
- 위치: `core-*-api/src/test/java/.../dto/<Dto>JsonTest.java`
- Spring 컨텍스트 없이 순수 ObjectMapper 만 사용

`AbstractJsonContractTest` 는 서브클래스마다 자동으로 3개의 테스트를 돌려요. round-trip(`serialize_roundTripsToSample` — DTO → JSON → DTO 왕복), canonical JSON 파싱(`deserialize_parsesCanonicalJson`), unknown field 무시(`deserialize_ignoresUnknownField`) 세 가지입니다. 사용하는 ObjectMapper 는 전역 Jackson 정책과 같게 설정돼 있어서(`NON_NULL`, `FAIL_ON_UNKNOWN_PROPERTIES=false`, `JavaTimeModule`, `WRITE_DATES_AS_TIMESTAMPS=false`), 실제 응답과 동일한 직렬화 규칙으로 검증돼요. 민감 필드 처리 규칙까지 포함한 상세는 [`계약 테스트 (Contract Testing)`](./contract-testing.md) 에서 다루고, 여기서는 존재한다는 사실만 기억하면 됩니다.

---

## Layer 3 — Contract Test (Port)

Port 인터페이스의 행위 계약을 검증합니다. "impl 을 교체해도 동일한 입출력이 보장되는가" 를 강제하는 가장 강력한 테스트 층이에요.

핵심 컴포넌트는 이렇게 나뉩니다.

| 컴포넌트 | 위치 | 역할 |
|---|---|---|
| `@ContractTest` | `common-testing` | `@SpringBootTest` + `@ActiveProfiles("test")` + `@Sql(contract-cleanup.sql)` + `@Import(ContractTestConfig.class)` 묶음 |
| `AbstractContractBase` | `common-testing` | Testcontainers Postgres 의 JDBC URL 을 `@DynamicPropertySource` 로 주입 |
| `Abstract<X>PortContractTest` | `core-*-api/src/testFixtures/` | Port 별 계약 명세(happy path + error paths) |
| `<X>Fixtures` | `core-*-api/src/testFixtures/` | 테스트 데이터 생성 인터페이스 |
| `Jpa<X>Fixtures` | `core-*-impl/src/test/` | Fixture 의 실제 DB 구현(`@TestComponent`) |
| `InMemory<Port>Adapter` + `<X>Recorder` | `core-*-impl/src/test/` | 외부 Port 의 fake |
| `contract-cleanup.sql` | `common-testing/src/main/resources/` | 매 테스트 전에 테이블 TRUNCATE |

`Abstract<X>PortContractTest` 는 auth·user·device·billing·push·storage 여섯 도메인에 각각 존재하고, 모두 `AbstractContractBase` 를 상속해 같은 Testcontainers Postgres 에 연결돼요. `@ContractTest` 가 묶어 주는 `ContractTestConfig` 자체는 현재 빈 `@TestConfiguration` 이라, fake adapter 의 `@Primary` 주입은 각 impl 테스트가 자기 inner Config 에서 직접 합니다.

### 실제 사용 예시

`AuthServiceImplContractTest` 는 다음과 같이 작성돼 있어요.

```java
// core-auth-impl/.../AuthServiceImplContractTest.java 발췌
@ContractTest
@Import({AuthServiceImplContractTest.Config.class, JpaAuthFixtures.class})
class AuthServiceImplContractTest extends AbstractAuthPortContractTest {

    @TestConfiguration
    static class Config {
        @Bean @Primary
        EmailPort emailPort(InMemoryEmailAdapter adapter) {
            return adapter;
        }

        @Bean
        InMemoryEmailAdapter inMemoryEmailAdapter() {
            return new InMemoryEmailAdapter();
        }
    }

    @Autowired private AuthPort authPort;
    @Autowired private JpaAuthFixtures fixtures;
    @Autowired private InMemoryEmailAdapter emailRecorder;

    @Override protected AuthPort port() { return authPort; }
    @Override protected AuthFixtures fixtures() { return fixtures; }
    @Override protected EmailRecorder emailRecorder() { return emailRecorder; }
}
```

abstract 가 happy path 와 error path 명세를 들고 있고, 구현 클래스는 실제 `AuthPort` Bean·fixtures·fake recorder 를 연결하는 역할만 맡아요. 그래서 새 impl 이 같은 abstract 를 상속하면 동일한 계약을 그대로 통과해야 합니다.

### Fixtures 패턴

각 도메인은 `<X>Fixtures` 라는 인터페이스를 정의하고, Contract abstract 가 이를 통해 테스트 데이터를 준비합니다. 실제 구현은 impl 모듈의 `Jpa<X>Fixtures`(`@TestComponent`)예요.

`AuthFixtures` (`core-auth-api/src/testFixtures/...`):

```java
public interface AuthFixtures {

    /** 이메일 인증 완료 유저 생성. 반환: userId. */
    long createVerifiedUser(String email, String rawPassword);

    /** 이메일 미인증 유저 생성. */
    long createUnverifiedUser(String email, String rawPassword);

    /** 유효한 refresh token 을 발급하고 raw 값 반환. */
    String issueAuthRefreshToken(long userId, String appSlug);

    /** 만료된 refresh token 을 발급하고 raw 값 반환. */
    String issueExpiredAuthRefreshToken(long userId, String appSlug);

    /** 유효한 이메일 인증 토큰을 생성하고 raw 값 반환. */
    String issueVerificationToken(long userId);

    /** 유효한 비밀번호 재설정 토큰을 생성하고 raw 값 반환. */
    String issueAuthPasswordResetToken(long userId);
}
```

`UserFixtures`, `DeviceFixtures`, `BillingFixtures` 도 같은 패턴이에요. 인터페이스는 `src/testFixtures` 에 두어 api 모듈과 공유하고, 구현은 impl 모듈의 `src/test` 에 두어 impl 안에 가둡니다.

### TestUserFactory

`common-testing/src/main/java/.../TestUserFactory.java` 는 Phase 0 스켈레톤이에요. 클래스 본문은 비어 있고, JavaDoc 에 "실제 구현은 Phase D(core-user-impl)에서 User 엔티티와 함께 제공된다" 고 적힌 placeholder 입니다. 지금은 각 도메인이 자기 `<X>Fixtures` 를 두는 구조라 통합 테스트가 이 공용 factory 없이도 동작하고, 실제 fixture 는 도메인별로 나뉘어 있어요.

상세한 계약 규약(Delegation mock 금지, `@Nested` 로 method 별 분리, Fake adapter 의 `@Primary` 주입 등)은 [`계약 테스트 (Contract Testing)`](./contract-testing.md) 에서 관리합니다.

---

## Layer 4 — Integration Test

전체 Spring 컨텍스트를 띄우고 실제 DB(Testcontainers)에 연결해 여러 레이어의 조립이 정상 동작하는지 확인합니다.

### 베이스 클래스

`common-testing/src/main/java/.../AbstractIntegrationTest.java`:

```java
@SpringBootTest
@Transactional
public abstract class AbstractIntegrationTest {

    @DynamicPropertySource
    static void registerProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", PostgresTestContainer::getJdbcUrl);
        registry.add("spring.datasource.username", PostgresTestContainer::getUsername);
        registry.add("spring.datasource.password", PostgresTestContainer::getPassword);
    }
}
```

핵심 특징은 세 가지예요.

- `@SpringBootTest` — 전체 ApplicationContext 기동
- `@Transactional` — 각 테스트는 트랜잭션 안에서 실행되고 끝나면 자동 롤백
- `@DynamicPropertySource` — Testcontainers 의 동적 JDBC URL 을 Spring 환경에 주입

### Testcontainers 설정

테스트 컨테이너는 JVM 라이프사이클 동안 한 번만 기동되는 initialization-on-demand holder 패턴으로 구현돼 있어요. 두 개가 있습니다.

`PostgresTestContainer` (`common-testing`):

```java
public final class PostgresTestContainer {

    public static PostgreSQLContainer<?> getInstance() {
        return Holder.INSTANCE;
    }

    public static String getJdbcUrl() { return Holder.INSTANCE.getJdbcUrl(); }
    public static String getUsername() { return Holder.INSTANCE.getUsername(); }
    public static String getPassword() { return Holder.INSTANCE.getPassword(); }

    private static class Holder {
        private static final PostgreSQLContainer<?> INSTANCE = createAndStart();

        private static PostgreSQLContainer<?> createAndStart() {
            PostgreSQLContainer<?> container = new PostgreSQLContainer<>(
                DockerImageName.parse("postgres:16-alpine"))
                .withDatabaseName("test")
                .withUsername("test")
                .withPassword("test")
                .withReuse(true);
            container.start();
            return container;
        }
    }
}
```

`MinioTestContainer` 는 같은 패턴으로 MinIO(`minio/minio:latest`)를 기동합니다. 스토리지 관련 테스트에서 사용해요.

`.class` 참조만으로는 컨테이너가 시작되지 않고, accessor 호출 시점(예: `getJdbcUrl()`)에 처음 기동돼요. `@DynamicPropertySource` 에 method reference 로 넘길 때 자연스럽게 연결됩니다.

DB 이름·계정이 모두 `test` 이고 `.withReuse(true)` 라, 같은 JVM 안에서는 물론 테스트 실행 사이에도 컨테이너가 재사용됩니다. **로컬 실행 요구사항은 Docker 가 실행 중이어야 한다는 것** 하나예요. CI(`ubuntu-latest`)에는 기본 설치돼 있어요.

### 통합 테스트 예시 — 보안 체인 검증

`SecurityIntegrationTest` (`common-security`)는 `@SpringBootTest(webEnvironment = MOCK)` + `MockMvc` 로 실제 Security Filter Chain 을 태워 401·200 이 제대로 나오는지 검증합니다.

```java
// common-security/.../SecurityIntegrationTest.java 발췌
@SpringBootTest(webEnvironment = MOCK, classes = SecurityIntegrationTest.TestApp.class)
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SecurityIntegrationTest {

    @Test
    void protectedRoute_noToken_returns401_withApiErrorEnvelope() throws Exception {
        mockMvc.perform(get("/api/protected"))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error.code").value("CMN_004"));
    }

    @Test
    void protectedRoute_expiredToken_returns401_withTokenExpiredCode() throws Exception {
        String expiredToken = buildExpiredToken();
        mockMvc.perform(get("/api/protected").header("Authorization", "Bearer " + expiredToken))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error.code").value("CMN_007"));
    }
}
```

토큰 없음은 `CMN_004`, 만료 토큰은 `CMN_007`, 변조 토큰은 별도 코드로 갈라지고, 유효 토큰은 200 으로 통과합니다. ApiError envelope 의 `error.code` 까지 검증하므로 필터 체인이 코드 레벨로 고정돼요.

### 외부 HTTP 라이프사이클 — WireMock IT

OAuth provider(Google·Kakao·Naver·Apple)는 실제 HTTP 호출 라이프사이클까지 검증해야 의미가 있어요. 그래서 `core-auth-impl` 의 `*WireMockIT` 들은 `@RegisterExtension` 으로 WireMock 서버를 띄우고, 그 base URL 을 SignInService 에 주입해 `HttpClient → WireMock` 왕복을 그대로 태웁니다. 같은 도메인의 순수 단위 테스트(`GoogleSignInServiceTest`)가 `fetchTokenInfo` 를 spy 로 가로채는 것과 달리, IT 는 그 메서드까지 실제로 실행돼요.

파일 이름의 `IT` 접미사는 이렇게 "실제 외부 연결·전체 조립을 태우는 통합 테스트" 를 뜻하고, `Test` 접미사는 단위·계약 테스트를 가리킵니다. PortOne(PG)은 코드 IT 대신 dev 환경에서 WireMock 컨테이너(`infra/wiremock/mappings/`)로 스텁해요. 이 책임 분리는 아래 "외부 결제(PG)" 절에서 자세히 다룹니다.

---

## ArchUnit — 실행 가능한 아키텍처 명세

ArchUnit 은 4층과 별개로 동작하는 구조 강제 장치예요. 모듈 의존 방향, 패키지 구조, 네이밍, JPA 어노테이션 위치 등을 classpath 에서 스캔해 위반을 테스트로 실패시킵니다.

### 정의와 실행 위치

| 파일 | 역할 |
|---|---|
| `common-testing/.../architecture/ArchitectureRules.java` | 모든 규칙의 canonical 정의(`public static final ArchRule` 상수) |
| `common-testing/src/test/.../architecture/ArchitectureTest.java` | common-testing 자체 스캔(대부분 vacuously true) |
| `bootstrap/src/test/.../BootstrapArchitectureTest.java` | 전체 모듈 스캔(여기서 실질적 검증) |

`ArchitectureRules` 에는 22개의 `ArchRule` 상수가 정의돼 있어요(의존 방향, JPA 누출 방지, Spring stereotype 위치, DTO record 강제, Mapper 클래스 금지 등). `ArchitectureTest` 는 common-testing 의 test classpath 만 보므로 대부분 규칙이 vacuously true 로 통과하고, 실질 검증은 모든 모듈을 포함하는 `bootstrap` 에서 `@AnalyzeClasses("com.factory")` 로 일어납니다. `BootstrapArchitectureTest` 는 각 규칙을 `@ArchTest` 필드로 참조하는데, r12 한 자리는 reserved 라 활성 참조는 21개예요.

규칙을 추가하거나 수정하면 `ArchitectureRules` 에 상수를 추가하고 `BootstrapArchitectureTest` 에 `@ArchTest` 참조를 추가합니다. 규칙 전체 목록은 [`모듈 의존 규칙 (Module Dependencies)`](../../structure/module-dependencies.md) 와 [`Architecture Rules (ArchUnit)`](../../structure/architecture-rules.md) 에서 관리해요.

---

## Contract cleanup — 4중 DB 안전장치

Contract·Integration 테스트가 실수로 운영 DB 에 연결돼 TRUNCATE 를 실행하는 것을 막기 위해 4중 방어선이 있어요.

1. **Testcontainers JDBC URL** — ephemeral Docker 컨테이너라 운영 DB 와 분리됩니다.
2. **`@ActiveProfiles("test")`** — test 프로필을 강제합니다.
3. **`contract-cleanup.sql` 의 가드** — `current_database()` 가 `%test%` 가 아니면 즉시 예외를 던집니다.
4. **DB role 권한** — 앱 role 은 자기 schema 외에 접근할 수 없어요(방어선 상세는 module-dependencies 참조).

`contract-cleanup.sql` 의 실제 내용(`common-testing/src/main/resources/`):

```sql
DO $$
BEGIN
    IF current_database() NOT LIKE '%test%' THEN
        RAISE EXCEPTION 'refusing to truncate non-test database: %', current_database();
    END IF;
END $$;

DO $$
DECLARE
    t TEXT;
    candidates TEXT[] := ARRAY[
        'subscription_renewals', 'payment_webhook_events', 'subscriptions', 'payment_history', 'subscription_plans',
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

candidates 배열은 billing 테이블(`subscription_renewals` · `payment_webhook_events` · `subscriptions` · `payment_history` · `subscription_plans`)부터 auth·user 테이블까지 FK 의존 순서로 나열돼 있어요. `TRUNCATE` 는 `@Sql(BEFORE_TEST_METHOD)` 로 매 테스트 메서드 이전에 실행됩니다. 실행 순서에 의존하지 않도록 항상 빈 상태에서 시작해요.

---

## 테스트 실행 명령어

```bash
# 전체 테스트 (ArchUnit + 단위 + Contract + Integration 모두)
./gradlew test

# 특정 모듈만
./gradlew :core:core-auth-impl:test
./gradlew :common:common-security:test

# 특정 클래스만
./gradlew :core:core-auth-impl:test --tests "AuthServiceImplContractTest"

# 특정 메서드만
./gradlew :core:core-auth-impl:test --tests "AuthServiceImplContractTest.signUpWithEmail_createsUser"

# ArchUnit 규칙만 빠르게 (bootstrap 에만 active)
./gradlew :bootstrap:test --tests "BootstrapArchitectureTest"
```

**Docker 필수** — Testcontainers 기반 테스트(Contract, Integration)는 Docker daemon 이 실행 중이어야 해요. `docker ps` 로 확인하세요.

처음 실행은 느려요. Postgres·MinIO 이미지를 pull 하는 시간이 있거든요. 같은 JVM 에서 재실행할 때는 Holder 패턴 덕분에 컨테이너가 재사용됩니다.

---

## 새 Port / 새 DTO / 새 엔드포인트 추가 시 체크리스트

### 새 DTO 추가
1. `core-<x>-api/src/main/java/.../dto/<Dto>.java` 작성(record)
2. `core-<x>-api/src/test/java/.../dto/<Dto>JsonTest.java` 작성(extends `AbstractJsonContractTest<Dto>`)
3. `./gradlew :core:core-<x>-api:test` 통과 확인

### 새 Port method 추가
1. `<X>Port.java` 에 method 추가
2. `Abstract<X>PortContractTest` 에 `@Nested` 클래스 추가(happy + error paths)
3. 필요 시 `<X>Fixtures` 인터페이스 + `Jpa<X>Fixtures` 구현 확장
4. `./gradlew :core:core-<x>-impl:test` 통과 확인

### 새 Port 모듈 추가
1. 위 모든 단계에 더해
2. `core-<x>-api/build.gradle` 에 `java-test-fixtures` plugin 확인(`factory.core-api-module` convention plugin 이 적용해 줌)
3. `<X>ContractTestApplication.java`(`@SpringBootConfiguration`) 작성
4. External port 있으면 `<X>Recorder` + `InMemory<Port>Adapter` 작성

---

## 외부 결제(PG) — 백엔드·프론트 테스트 책임 분리

PG 결제(PortOne)는 풀 e2e 를 하나의 테스트로 강제하면 안 돼요. 결제 행위의 책임이 프론트와 백엔드로 갈리기 때문입니다.

| 책임 | 주체 | 검증 대상 | 테스트 위치 |
|---|---|---|---|
| 결제 **생성** | 프론트(Flutter + PortOne SDK) | 결제창 → 카드 인증 → `impUid` 발급(실 트랜잭션) | 앱 통합테스트(PG 테스트모드) |
| 결제 **검증** | 백엔드 | 주어진 `impUid` 를 PortOne API 로 검증 → 구독 활성 | 백엔드 테스트 |
| **webhook** | 백엔드 | PortOne→서버 상태 통지, HMAC 검증·처리 | 백엔드 테스트 |
| **연결·인증** | 백엔드 | PortOne API 도달성 + getToken(키 자격) | 백엔드 테스트 |

핵심은 headless 백엔드 smoke test 가 `impUid` 를 만들 수 없다는 점이에요(프론트 영역). 그래서 환경별로 검증 범위가 달라집니다.

- **local** — WireMock 이 임의 `impUid` 를 paid 로 stub 하므로 결제 생성→검증 풀플로우까지 검증돼요(mock 이라 의미 있음). dev·prod 에 WireMock 은 무의미해요. 실 통합 검증이 목적이니까요.
- **dev/prod** — 실 PortOne(`api.iamport.kr`)에 붙어요. 가짜 `impUid` 는 거부되지만, 그 응답 코드로 백엔드 책임을 정직하게 판별합니다.
  - `422 PAY_009`(`PORTONE_BUSINESS_ERROR`) = PortOne 도달·인증·왕복은 성공했고 가짜 `impUid` 만 거부된 경우입니다. 백엔드 연결·인증 책임은 PASS 예요(실 결제 e2e 는 앱 영역).
  - `502 PAY_005`(`PORTONE_API_ERROR`) 또는 `502 PAY_006`(`PORTONE_AUTH_FAILED`) = PortOne 연결·인증 실패라 진짜 FAIL 입니다.

이 구분을 위해 `PortOneApiClient` 는 네트워크 실패(`IOException` → `PORTONE_API_ERROR`, 502)와 PortOne 응답 거부(`code != 0` → `PORTONE_BUSINESS_ERROR`, 422)를 다른 예외로 던져요. 즉 `tools/api-smoke-test.sh` 의 `[7] PG 결제` 단계는 "풀 결제" 가 아니라 "백엔드가 책임진 만큼" 을 검증합니다.

이 스크립트는 11단계 e2e smoke(회원가입 → 인증 → 결제 → 환불 → audit)로, `[7] PG 결제` 외에도 webhook·IAP·audit 까지 한 흐름으로 태워요. `--target=local|dev|prod` 로 환경을 골라 같은 흐름을 환경별 책임 범위에 맞게 검증합니다.

---

## 요약

- **단위 테스트** — Spring 없이 Mockito 를 적극 활용하고, Port 계약으로 환원할 수 없는 로직만 다룹니다.
- **JSON 계약** — ObjectMapper 만으로 DTO 직렬화를 검증해요(자동 3 테스트). 상세는 [`계약 테스트 (Contract Testing)`](./contract-testing.md).
- **Port 계약** — Testcontainers + `@ContractTest` + Fixtures 패턴으로 impl 교체 가능성을 보장합니다.
- **통합 테스트** — `AbstractIntegrationTest` + Testcontainers, 트랜잭션 자동 롤백. 외부 HTTP 는 `*WireMockIT` 로 라이프사이클까지 태웁니다.
- **ArchUnit** — 모듈·패키지·네이밍 구조를 22 규칙으로 자동 강제해요. 전체 규칙은 [`모듈 의존 규칙 (Module Dependencies)`](../../structure/module-dependencies.md).
- **4중 안전장치** — Contract·Integration 테스트가 운영 DB 를 건드리지 못하도록 강제합니다.

---

## 관련 문서

- [`계약 테스트 (Contract Testing)`](./contract-testing.md) — Port 계약 테스트 상세 규약
- [`ADR-014 · Delegation mock 테스트 금지`](../../philosophy/adr-014-no-delegation-mock.md) — Delegation mock 금지 설계 근거
- [`ADR-011 · 모듈 안 레이어드 아키텍처 + 포트/어댑터 패턴`](../../philosophy/adr-011-layered-port-adapter.md) — Port 경계 설계
- [`Architecture Rules (ArchUnit)`](../../structure/architecture-rules.md) — ArchUnit 22 규칙(ArchUnit 대상)
- [`모듈 의존 규칙 (Module Dependencies)`](../../structure/module-dependencies.md) — 모듈 경계 + DB 방어선
