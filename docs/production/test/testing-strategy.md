# Testing Strategy

> **유형**: Explanation · **독자**: Level 2 · **읽는 시간**: ~12분

**설계 근거**: [ADR-014 (Delegation mock 금지)](../../philosophy/adr-014-no-delegation-mock.md)

이 문서는 `spring-backend-template` 의 **전체 테스트 전략** 을 설명합니다. 어떤 종류의 테스트를 어디에 두고, 무엇을 검증하며, 언제 실행하는지를 다룹니다.

계약 테스트(Contract Testing)의 상세한 작성 규약은 [계약 테스트 (Contract Testing)](./contract-testing.md) 에서 별도로 관리하고, ArchUnit 규칙의 전체 목록은 [모듈 의존 규칙 (Module Dependencies)](../../structure/module-dependencies.md) 에서 다룹니다. 여기서는 **큰 그림과 공통 전략** 에 집중합니다.

---

## 한 문장 요약

이 문서는 **4 층 테스트 전략** (Unit · Contract JSON · Contract Port · Integration) 의 전체 그림과 각 층의 역할/예시/체크리스트를 설명합니다.

---

## 왜 4층 구조인가

테스트는 "실행 속도" 와 "검증 강도" 사이에 항상 trade-off 가 있습니다. 단위 테스트만 있으면 빠르지만 모듈 간 실제 연결은 검증되지 않고, 통합 테스트만 있으면 느려서 개발자가 더 이상 실행하지 않게 됩니다.

이 레포는 다음 4개의 층을 구분해서 각각의 역할을 명확히 나눕니다.

| 층 | 검증 대상 | 실행 시간 | 격리 수준 | Spring 컨텍스트 |
|---|---|---|---|---|
| **Unit** | 단일 클래스의 내부 로직 | 밀리초 | 완전 격리 (Mock 사용) | 없음 |
| **Contract (JSON)** | DTO ↔ JSON 직렬화 계약 | 밀리초 | 완전 격리 (ObjectMapper 만) | 없음 |
| **Contract (Port)** | Port 인터페이스의 행위 계약 | 수 초 | DB 는 Testcontainers, 외부 port 는 fake | `@SpringBootTest` |
| **Integration** | 여러 레이어 조립된 실제 흐름 | 수 초 | Testcontainers + 트랜잭션 롤백 | `@SpringBootTest` |
| **ArchUnit** | 패키지/모듈/네이밍 구조 | 수 초 (bootstrap 1회) | classpath 스캔 | 없음 |

층이 많다고 부담스럽게 느껴질 수 있는데, 실제로는 **각 층이 서로 다른 파일 위치** 에 있어 자연스럽게 구분됩니다. 한 PR 에서 모든 층을 동시에 수정하는 경우는 드뭅니다.

---

## Layer 1 — Unit Test

### 목적

단일 클래스의 내부 알고리즘을 검증합니다. DB, 네트워크, Spring 컨텍스트 없이 JUnit 5 + Mockito 로 빠르게 실행됩니다.

### 어디에 두는가

- `common-*/src/test/java/...` — 공통 유틸리티, 필터, 파서 등
- `core-*-impl/src/test/java/...` — Port 계약으로 환원되지 않는 내부 알고리즘만

### 유지 대상 예시

템플릿에는 다음과 같은 단위 테스트들이 있습니다.

- `JwtServiceTest` — JWT 서명/검증 메커니즘
- `JwtPropertiesTest` — `@ConfigurationProperties` 바인딩
- `PasswordHasherTest` — 해싱 알고리즘
- `AuthenticatedUserTest` — 인증 principal 생성
- `AppSlugVerificationFilterTest` — 필터 로직
- `PaginationTest`, `SearchSortTest` — 공통 페이지/정렬 파서
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

Mockito `@Mock`, `BDDMockito.given(...)` 은 **이 층에서만** 적극적으로 사용합니다. 그 외 층에서는 가능한 한 실제 구현(Testcontainers Postgres, InMemory fake adapter)을 쓰는 편입니다.

**Mock 을 쓰는 경우:**
- 외부 시스템 호출이 필요한데 단위 테스트에서 네트워크를 쓰고 싶지 않을 때
- 시간(`Clock`), 난수(`TokenGenerator`) 같은 비결정적 의존성을 고정하고 싶을 때
- 특정 예외 발생 시 후속 동작을 검증하고 싶을 때

**Mock 을 쓰지 않는 경우:**
- 같은 모듈 안의 순수 함수를 검증할 때 — 그냥 실제 호출
- DB 동작을 검증할 때 — 통합 테스트 또는 Contract 테스트로 이관
- "A 가 B.foo() 를 호출하는가" 같은 위임 검증 — **금지**. 자세한 이유는 [계약 테스트 (Contract Testing)](./contract-testing.md) 의 "Delegation mock 테스트 금지" 참조.

---

## Layer 2 — Contract Test (JSON)

DTO 의 JSON 직렬화/역직렬화 계약을 검증합니다. 클라이언트(Flutter 앱)와의 wire protocol 이 조용히 깨지는 것을 막기 위한 테스트입니다.

- 베이스 클래스: `AbstractJsonContractTest<T>` (`common-testing`)
- 위치: `core-*-api/src/test/java/.../dto/<Dto>JsonTest.java`
- Spring 컨텍스트 없음 — 순수 ObjectMapper

자동 수행되는 3가지 테스트(round-trip, canonical JSON 파싱, unknown field 무시)와 민감 필드 처리 규칙은 [계약 테스트 (Contract Testing)](./contract-testing.md) 에서 상세하게 다룹니다. 여기서는 **존재한다는 사실** 만 기억하면 됩니다.

---

## Layer 3 — Contract Test (Port)

Port 인터페이스의 **행위 계약** 을 검증합니다. "impl 을 교체해도 동일한 입출력이 보장되는가" 를 강제하는 가장 강력한 테스트 층입니다.

핵심 컴포넌트:

| 컴포넌트 | 위치 | 역할 |
|---|---|---|
| `@ContractTest` | `common-testing` | `@SpringBootTest` + `@ActiveProfiles("test")` + `@Sql(contract-cleanup.sql)` + `@Import(ContractTestConfig.class)` 묶음 |
| `AbstractContractBase` | `common-testing` | Testcontainers Postgres 의 JDBC URL 을 `@DynamicPropertySource` 로 주입 |
| `Abstract<X>PortContractTest` | `core-*-api/src/testFixtures/` | Port 별 계약 명세 (happy path + error paths) |
| `<X>Fixtures` | `core-*-api/src/testFixtures/` | 테스트 데이터 생성 인터페이스 |
| `Jpa<X>Fixtures` | `core-*-impl/src/test/` | Fixture 의 실제 DB 구현 (`@TestComponent`) |
| `InMemory<Port>Adapter` + `<X>Recorder` | `core-*-impl/src/test/` | 외부 Port 의 fake |
| `contract-cleanup.sql` | `common-testing/src/main/resources/` | 매 테스트 전에 테이블 TRUNCATE |

### 실제 사용 예시

`AuthServiceImplContractTest` 는 다음과 같이 작성되어 있습니다.

```java
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

### Fixtures 패턴

각 도메인은 `<X>Fixtures` 라는 **인터페이스**를 정의해 Contract abstract 가 이를 통해 테스트 데이터를 준비합니다. 실제 구현은 impl 모듈의 `Jpa<X>Fixtures` (`@TestComponent`) 입니다.

`AuthFixtures` (`core-auth-api/src/testFixtures/...`):

```java
public interface AuthFixtures {

    /** 이메일 인증 완료 유저 생성. 반환: userId. */
    long createVerifiedUser(String email, String rawPassword);

    /** 이메일 미인증 유저 생성. */
    long createUnverifiedUser(String email, String rawPassword);

    /** 유효한 refresh token 을 발급하고 raw 값 반환. */
    String issueRefreshToken(long userId, String appSlug);

    /** 만료된 refresh token 을 발급하고 raw 값 반환. */
    String issueExpiredRefreshToken(long userId, String appSlug);

    /** 유효한 이메일 인증 토큰을 생성하고 raw 값 반환. */
    String issueVerificationToken(long userId);

    /** 유효한 비밀번호 재설정 토큰을 생성하고 raw 값 반환. */
    String issuePasswordResetToken(long userId);
}
```

`UserFixtures`, `DeviceFixtures` 도 같은 패턴입니다.

### TestUserFactory

`common-testing/src/main/java/.../TestUserFactory.java` 는 Phase 0 단계의 placeholder 이며, 현재는 비어 있습니다. 각 도메인이 자기 `<X>Fixtures` 를 두는 현재 구조가 자리 잡으면서 공용 factory 의 필요성이 줄었고, 실제 fixture 는 도메인별로 나뉘어 있습니다.

상세한 계약 규약 (Delegation mock 금지, @Nested 로 method 별 분리, Fake adapter 의 `@Primary` 주입 등) 은 [계약 테스트 (Contract Testing)](./contract-testing.md) 에서 관리합니다.

---

## Layer 4 — Integration Test

전체 Spring 컨텍스트를 띄우고 실제 DB (Testcontainers) 에 연결해 여러 레이어의 조립이 정상 동작하는지 확인합니다.

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

핵심 특징:
- `@SpringBootTest` — 전체 ApplicationContext 기동
- `@Transactional` — 각 테스트는 트랜잭션 안에서 실행되고 끝나면 자동 롤백
- `@DynamicPropertySource` — Testcontainers 의 동적 JDBC URL 을 Spring 환경 변수로 주입

### Testcontainers 설정

테스트 컨테이너는 JVM 라이프사이클 동안 1번만 기동되는 **initialization-on-demand holder 패턴** 으로 구현되어 있습니다. 다음 2개가 있습니다.

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

`MinioTestContainer` — 같은 패턴으로 MinIO 를 기동합니다. 스토리지 관련 테스트에서 사용됩니다.

`.class` 참조만으로는 컨테이너가 시작되지 않고, accessor 호출 시점(예: `getJdbcUrl()`) 에 처음 기동됩니다. `@DynamicPropertySource` 에 method reference 로 넘길 때 자연스럽게 연결됩니다.

**로컬 실행 요구사항:** Docker 가 실행 중이어야 합니다. CI (`ubuntu-latest`) 에는 기본 설치되어 있습니다.

### 통합 테스트 예시 — 보안 체인 검증

`SecurityIntegrationTest` 는 `@SpringBootTest(webEnvironment = MOCK)` + `MockMvc` 로 실제 Security Filter Chain 을 태워 401/403/200 이 제대로 나오는지 검증합니다.

```java
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

---

## Layer 5 — ArchUnit Test

ArchUnit 은 **실행 가능한 아키텍처 명세** 입니다. 모듈 의존 방향, 패키지 구조, 네이밍, JPA 어노테이션 위치 등을 classpath 에서 스캔해 위반을 테스트로 실패시킵니다.

### 정의와 실행 위치

| 파일 | 역할 |
|---|---|
| `common-testing/src/main/java/.../architecture/ArchitectureRules.java` | 모든 규칙의 canonical 정의 (public static final ArchRule 상수) |
| `common-testing/src/test/java/.../architecture/ArchitectureTest.java` | common-testing 자체 스캔 (대부분 vacuously true) |
| `bootstrap/src/test/java/.../BootstrapArchitectureTest.java` | 전체 모듈 스캔 (여기서 실질적 검증) |

`ArchitectureRules` 에는 22개의 규칙이 정의되어 있습니다 (의존 방향, JPA 누출 방지, Spring stereotype 위치, DTO record 강제, `@Deprecated` 메타 등). 규칙 전체 목록은 [모듈 의존 규칙 (Module Dependencies)](../../structure/module-dependencies.md) 에서 관리합니다.

규칙을 추가하거나 수정하면 `ArchitectureRules` 에 상수를 추가하고 `BootstrapArchitectureTest` 에 `@ArchTest` 참조를 추가합니다.

---

## Contract cleanup — 4중 DB 안전장치

Contract/Integration 테스트가 실수로 운영 DB 에 연결되어 TRUNCATE 를 실행하는 것을 막기 위해 4중 방어선이 있습니다.

1. **Testcontainers JDBC URL** — ephemeral Docker 컨테이너이므로 운영 DB 와 분리.
2. **`@ActiveProfiles("test")`** — test 프로필 강제.
3. **`contract-cleanup.sql` 의 가드** — `current_database()` 가 `%test%` 가 아니면 즉시 예외.
4. **DB role 권한** — 앱 role 은 자기 schema 외에 접근 불가 (방어선 상세는 module-dependencies 참조).

`contract-cleanup.sql` 의 실제 내용 (`common-testing/src/main/resources/`):

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
        'refresh_tokens', 'email_verification_tokens', 'password_reset_tokens',
        'social_identities', 'devices', 'users'
    ];
BEGIN
    FOREACH t IN ARRAY candidates LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t) THEN
            EXECUTE format('TRUNCATE TABLE %I RESTART IDENTITY CASCADE', t);
        END IF;
    END LOOP;
END $$;
```

`TRUNCATE` 는 `@Sql(BEFORE_TEST_METHOD)` 로 매 테스트 메서드 **이전** 에 실행됩니다. 실행 순서에 의존하지 않도록 항상 빈 상태에서 시작합니다.

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

**Docker 필수:** Testcontainers 기반 테스트(Contract, Integration) 는 Docker daemon 이 실행 중이어야 합니다. `docker ps` 로 확인하세요.

**처음 실행은 느립니다.** Postgres/MinIO 이미지를 pull 하는 시간이 있습니다. 같은 JVM 에서 재실행 시에는 Holder 패턴 덕분에 컨테이너가 재사용됩니다.

---

## 새 Port / 새 DTO / 새 엔드포인트 추가 시 체크리스트

### 새 DTO 추가
1. `core-<x>-api/src/main/java/.../dto/<Dto>.java` 작성 (record)
2. `core-<x>-api/src/test/java/.../dto/<Dto>JsonTest.java` 작성 (extends `AbstractJsonContractTest<Dto>`)
3. `./gradlew :core:core-<x>-api:test` 통과 확인

### 새 Port method 추가
1. `<X>Port.java` 에 method 추가
2. `Abstract<X>PortContractTest` 에 `@Nested` 클래스 추가 (happy + error paths)
3. 필요 시 `<X>Fixtures` 인터페이스 + `Jpa<X>Fixtures` 구현 확장
4. `./gradlew :core:core-<x>-impl:test` 통과 확인

### 새 Port 모듈 추가
1. 위 모든 단계 +
2. `core-<x>-api/build.gradle` 에 `java-test-fixtures` plugin 확인 (convention plugin 이 자동 적용)
3. `<X>ContractTestApplication.java` (`@SpringBootConfiguration`) 작성
4. External port 있으면 `<X>Recorder` + `InMemory<Port>Adapter` 작성

---

## 요약

- **단위 테스트** — Spring 없이, Mockito 적극 활용, Port 계약으로 환원 불가능한 로직만.
- **JSON 계약** — ObjectMapper 만으로 DTO 직렬화 검증. 상세는 [계약 테스트 (Contract Testing)](./contract-testing.md).
- **Port 계약** — Testcontainers + `@ContractTest` + Fixtures 패턴. Impl 교체 가능성 보장.
- **통합 테스트** — `AbstractIntegrationTest` + Testcontainers. 트랜잭션 자동 롤백.
- **ArchUnit** — 모듈/패키지/네이밍 구조 자동 강제. 전체 규칙은 [모듈 의존 규칙 (Module Dependencies)](../../structure/module-dependencies.md).
- **4중 안전장치** — Contract/Integration 테스트가 운영 DB 를 건드리지 못하도록 강제.

---

## 관련 문서

- [계약 테스트 (Contract Testing)](./contract-testing.md) — Port 계약 테스트 상세 규약
- [ADR-014 · Delegation mock 테스트 금지](../../philosophy/adr-014-no-delegation-mock.md) — Delegation mock 금지 설계 근거
- [ADR-011 · 모듈 안 레이어드 아키텍처 + 포트/어댑터 패턴](../../philosophy/adr-011-layered-port-adapter.md) — Port 경계 설계
- [Architecture Rules (ArchUnit)](../../structure/architecture-rules.md) — ArchUnit 22 규칙 (Layer 5 대상)
