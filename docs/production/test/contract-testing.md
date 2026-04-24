# 계약 테스트 (Contract Testing)

이 문서는 `spring-backend-template` 의 **3층 테스트 구조** 와 계약 테스트 작성·강제 규약을 정의합니다.

---

## 왜 계약 테스트인가

이 프로젝트는 모듈러 모놀리스 구조로, `core-*-api` (포트 인터페이스 + DTO) 와 `core-*-impl` (구현체) 를 Gradle 모듈로 분리합니다 ([`ADR-003`](../../philosophy/adr-003-api-impl-split.md)). 이 분리가 실제로 가치를 가지려면:

1. **Port 계약이 변경되지 않아야** 소비자(apps/, 파생 레포)가 안전하게 의존 가능.
2. **DTO JSON 직렬화가 호환되어야** 클라이언트 앱과 wire-protocol 이 일치.
3. **impl 교체(예: HTTP 어댑터)가 가능해야** 나중에 마이크로서비스로 추출 가능.

→ 이 세 가지를 테스트로 강제하는 것이 **계약 테스트**입니다.

---

## 3층 테스트 구조

| 층 | 검증 대상 | 위치 | 예시 |
|---|---|---|---|
| **Layer 1 — JSON 계약** | DTO ↔ JSON 왕복, 필드 호환성 | `core-*-api/src/test/**/dto/` | `SignUpRequestJsonTest` |
| **Layer 2 — Port 행위 계약** | 인터페이스가 약속한 외부 관측 행위 | api: `src/testFixtures/`, impl: `src/test/` | `AbstractAuthPortContractTest` + `AuthServiceImplContractTest` |
| **Layer 3 — 내부 알고리즘 단위** | Port 로 환원 불가능한 내부 로직 | `core-*-impl/src/test/` | `RefreshTokenServiceTest`, `TokenGeneratorTest` |

---

## Layer 1 — JSON 계약 테스트

### 언제 추가하는가

- 새 DTO 를 `core-*-api/src/main/java/.../dto/` 에 추가할 때 **반드시** 함께 JSON 테스트 추가.
- 기존 DTO 에 필드 추가/변경 시 canonicalJson() 업데이트 + 테스트 실행으로 호환성 확인.

### 구조

모든 JSON 테스트는 `AbstractJsonContractTest<T>` (common-testing 제공) 를 상속합니다. Spring 컨텍스트 불필요 — 순수 `ObjectMapper` 기반.

```java
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

### 자동 수행되는 3가지 테스트

| 테스트 | 검증 |
|---|---|
| `serialize_roundTripsToSample` | DTO → JSON → DTO 왕복 — record `equals` 로 비교 |
| `deserialize_parsesCanonicalJson` | canonical JSON → DTO — 필드 매핑 정확성 |
| `deserialize_ignoresUnknownField` | 추가 필드 있는 JSON 도 에러 없이 파싱 (forward compat) |

### 전역 Jackson 정책 (`AbstractJsonContractTest` 내장)

- `@JsonInclude(NON_NULL)` — null 필드 직렬화 생략
- `FAIL_ON_UNKNOWN_PROPERTIES=false` — 알 수 없는 필드 무시
- `JavaTimeModule` — Instant/LocalDate ISO-8601 문자열
- `WRITE_DATES_AS_TIMESTAMPS=false` — 숫자 timestamp 금지

DTO 에 `@JsonProperty`, `@JsonIgnore` 같은 어노테이션을 붙이지 말고 **전역 정책 일관** 유지. 예외가 필요하면 해당 DTO 의 JsonTest 에 추가 단언 메서드 작성.

### 민감 필드 처리

`UserAccount.passwordHash` 같은 민감 필드는 **존재만 확인하고 값 단언 금지**:

```java
@Test
void serialize_passwordHashFieldPresent_valueNotAsserted() throws Exception {
    String json = serialize(sample());
    assertThat(json).contains("\"passwordHash\":");
}
```

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
    └── <X>Recorder.java                  (외부 port 있는 경우)

core-<x>-impl/
└── src/test/java/.../
    ├── <X>ContractTestApplication.java   (@SpringBootConfiguration)
    ├── Jpa<X>Fixtures.java               (@TestComponent, fixture 구현)
    ├── InMemory<Port>Adapter.java        (외부 port fake)
    └── <X>ServiceImplContractTest.java   (concrete, @ContractTest + @Import)
```

### Abstract 계약 구조 — @Nested 로 method 별 분리

각 Port 의 public method 마다 하나의 `@Nested` 클래스. 그 안에 happy path + error paths.

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

`@ContractTest` 가 자동 제공:
- `@SpringBootTest`
- `@ActiveProfiles("test")`
- `@Sql(scripts = "classpath:contract-cleanup.sql", executionPhase = BEFORE_TEST_METHOD)`
- `@Import(ContractTestConfig.class)`

### Fixtures 패턴

**인터페이스** — `core-<x>-api/testFixtures/`:
```java
public interface UserFixtures {
    long createVerifiedUser(String email, String passwordHash, String displayName);
    long createUnverifiedUser(String email, String passwordHash, String displayName);
    long createSoftDeletedUser(String email, String displayName);
    void linkSocialIdentity(long userId, String provider, String providerId);
}
```

**구현** — `core-<x>-impl/test/`:
```java
@TestComponent
public class JpaUserFixtures implements UserFixtures { ... }
```

### Fake Adapter 패턴 (외부 Port)

외부 API 호출하는 Port (`EmailPort`, `PushPort`, `BillingPort`) 는 테스트 시 fake 로 대체:

1. **Recorder 인터페이스** (`core-<x>-api/testFixtures/`):
   ```java
   public interface EmailRecorder {
       record SentEmail(String to, String subject, String body) {}
       List<SentEmail> all();
       List<SentEmail> sentTo(String email);
       void clear();
   }
   ```

2. **InMemory 어댑터** (`core-<x>-impl/test/`):
   ```java
   public class InMemoryEmailAdapter implements EmailPort, EmailRecorder { ... }
   ```

3. **Contract test 에서 `@Primary` 로 주입**:
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

**금지**: "A 가 B.foo() 를 호출하는가" 를 `Mockito.verify(b).foo()` 로 검증.

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

**이유**:
- 내부 서비스 이름·호출 구조가 바뀌면 행위 불변이어도 테스트 깨짐
- Port 계약 테스트가 같은 행위를 더 강하게 검증 (실제 서비스가 정말 작동하는지 간접 확인)
- Port/Adapter 철학과 충돌 — 테스트가 구현 내부에 커플링

**대체**: Port 계약 테스트에서 외부 관측 가능한 행위로 검증.

```java
// ✓ 허용 — 행위 검증
@Test
void sendsVerificationEmail() {
    port().signUpWithEmail(new SignUpRequest("a@test.com", "pw", "A", "sumtally"));
    assertThat(emailRecorder().sentTo("a@test.com")).hasSize(1);
}
```

---

## Layer 3 — 내부 알고리즘 단위 테스트

Port 계약으로 환원되지 않는 **고유 내부 로직** 은 단위 테스트로 유지.

### 유지 대상 예시

- `RefreshTokenServiceTest` — 회전 + 탈취 감지 알고리즘 (family_id 전파)
- `TokenGeneratorTest` — JWT 서명/클레임 생성 메커니즘
- `AppleSignInServiceTest` — Apple JWT + JWKS 검증 로직
- `GoogleSignInServiceTest` — Google id token 검증
- `EmailVerificationServiceTest` — 토큰 생성·만료 로직 (발송 검증은 Contract 로 이관)
- `PasswordResetServiceTest` — 동일
- `ResendEmailAdapterTest` — EmailPort 어댑터 단위
- `PushServiceTest` — 오케스트레이션 알고리즘 (토큰 조회 → 발송 → 무효 토큰 정리)

### 삭제 대상 예시 (delegation mock)

- `AuthServiceImplTest` (모든 method 가 단순 위임 검증)
- `EmailAuthServiceTest` (AuthPort 계약과 100% 중복)
- `UserServiceImplTest`, `DeviceServiceImplTest` 등 Port 구현 전체

---

## TRUNCATE Cleanup 안전장치

`contract-cleanup.sql` 은 `@Sql(BEFORE_TEST_METHOD)` 로 매 테스트 전 실행:

```sql
DO $$
BEGIN
    IF current_database() NOT LIKE '%test%' THEN
        RAISE EXCEPTION 'refusing to truncate non-test database: %', current_database();
    END IF;
END $$;

-- 존재하는 테이블만 TRUNCATE (모듈별 classpath 차이 대응)
DO $$
DECLARE
    t TEXT;
    candidates TEXT[] := ARRAY['refresh_tokens', 'email_verification_tokens',
                               'password_reset_tokens', 'social_identities',
                               'devices', 'users'];
BEGIN
    FOREACH t IN ARRAY candidates LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t) THEN
            EXECUTE format('TRUNCATE TABLE %I RESTART IDENTITY CASCADE', t);
        END IF;
    END LOOP;
END $$;
```

4중 방어:
1. Testcontainers JDBC URL — ephemeral Docker 컨테이너
2. `@ActiveProfiles("test")` — 테스트 프로필 강제
3. 가드 SQL — DB 이름에 `test` 없으면 즉시 에러
4. DB role 권한 (architecture.md 방어선 1)

---

## 모듈 간 의존 주의사항

**core-*-impl 의 test 가 다른 impl 을 `testImplementation` 하는 것은 허용**.

예: `core-device-impl` 의 `devices.user_id` FK 는 `users(id)` 참조 → Flyway V001(users) migration 필요 → `testImplementation project(':core:core-user-impl')`.

이는 **Item 2 의 core-impl ↔ core-impl 금지 규칙의 test 전용 예외**입니다. 이유: main sourceSet 은 여전히 독립이고, test 인프라 조립은 느슨한 규칙 적용.

---

## 체크리스트 (새 DTO/Port 추가 시)

### 새 DTO 추가
- [ ] `core-<x>-api/src/main/java/.../dto/<Dto>.java` 작성 (record)
- [ ] `core-<x>-api/src/test/java/.../dto/<Dto>JsonTest.java` 작성
- [ ] `./gradlew :core:core-<x>-api:test` 통과 확인

### 새 Port method 추가
- [ ] `<X>Port.java` 에 method 추가
- [ ] `Abstract<X>PortContractTest` 에 `@Nested` 클래스 추가 (happy + error paths)
- [ ] 필요시 `<X>Fixtures` 인터페이스에 fixture helper 추가
- [ ] `Jpa<X>Fixtures` 에 fixture helper 구현
- [ ] `./gradlew :core:core-<x>-impl:test` 통과 확인

### 새 Port 전체 추가 (새 core-<x>-api 모듈)
- [ ] 위 모든 단계 +
- [ ] `core-<x>-api/build.gradle` 에 `java-test-fixtures` plugin 적용
- [ ] `core-<x>-impl/build.gradle` 에 `testImplementation testFixtures(project(':core:core-<x>-api'))` 추가
- [ ] `<X>ContractTestApplication.java` 작성 (@SpringBootConfiguration)
- [ ] External port 있으면 `<X>Recorder` + `InMemory<Port>Adapter` 작성
