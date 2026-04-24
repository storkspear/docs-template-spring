# ADR-014 · Delegation mock 테스트 금지

**Status**: Accepted. 2026-04-24 기준 430개 테스트 중 Mockito 사용처는 외부 인프라 모킹 · 비결정 의존성 고정의 30여 건으로 제한. "A 가 B.foo() 를 호출하는가" 같은 내부 위임 검증은 부재. Port 계약 테스트 + Integration 테스트가 주력 검증 메커니즘.

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~5분

## 결론부터

테스트는 **외부에서 관측 가능한 행위** 만 검증해요. "A 가 B.foo() 를 호출하는가?" 같은 **내부 위임 경로** 는 mock 으로 검증하지 않습니다. 예를 들어 `AuthController.signUp()` 이 내부적으로 `EmailAuthService.signUp()` 을 호출하는지 `verify(emailAuthService).signUp(...)` 로 체크하는 걸 금지해요. 대신 `AuthPort` 의 실제 행위 (유저가 DB 에 저장되고, 검증 이메일이 발송되고, JWT 가 반환되는지) 를 검증. Mock 은 **외부 시스템 격리** (FCM, Resend) 와 **비결정 의존성 고정** (Clock, TokenGenerator) 에만 허용. 규모는 430 테스트 중 ~30 건으로 제한됨.

## 왜 이런 고민이 시작됐나?

테스트는 두 가지 가치를 제공해야 해요:

1. **회귀 방지** — 현재 동작이 깨졌을 때 바로 알려줌
2. **리팩토링 안전망** — 내부 구조를 바꿔도 외부 행위가 유지되면 통과

그런데 Java / Spring 생태계에는 **Mockito 기반 delegation 검증** 이 매우 흔합니다:

```java
@Test
void signUp_delegatesToEmailAuthService() {
    AuthController controller = new AuthController(emailAuthService);
    controller.signUp(request);
    verify(emailAuthService).signUp(request);  // ← "호출했는가" 를 검증
}
```

이런 테스트는 **회귀 방지 가치는 있음** (메서드 이름 오타 등을 잡음) 하지만 **리팩토링 안전망은 무너뜨립니다**:

- `EmailAuthService.signUp` 을 `EmailAuthService.register` 로 이름 변경 → 테스트 깨짐 (행위는 동일)
- `EmailAuthService` 를 `AuthController` 내부로 인라인화 → 테스트 깨짐 (행위는 동일)
- `EmailAuthService` 를 `SignUpService` + `EmailService` 로 쪼갬 → 테스트 다 수정 (행위는 동일)

즉 테스트가 **구현 내부 (how)** 에 결합됨. Kent Beck 의 "Tests should be about what, not how" 와 정면 충돌.

또 다른 관점: [ADR-011 (레이어드 + 포트/어댑터)](./adr-011-layered-port-adapter.md) 의 핵심은 **"Port 가 계약, 내부는 자유"** 예요. delegation mock 테스트는 "내부 구조를 계약으로 굳혀버리는" 행위라 ADR-011 의 의도와 충돌.

이 결정이 답할 물음은 이거예요.

> **회귀 방지와 리팩토링 안전망을 동시에 얻으려면, 테스트는 무엇을 검증 대상으로 삼아야 하는가?**

## 고민했던 대안들

### Option 1 — Mockito delegation 검증 허용 (업계 관행)

Controller / Service 단위 테스트에서 `verify()` 로 호출 여부 검증. Spring + Mockito 조합의 표준 패턴.

```java
@Test
void signUp_callsEmailAuthService() {
    controller.signUp(req);
    verify(emailAuthService, times(1)).signUp(req);
}
```

- **장점**:
  - 빠름 (Spring 컨텍스트 불필요)
  - 단위 명확 (Controller 만 검증)
  - 업계 표준 패턴
- **단점**:
  - **리팩토링 안전망 파괴** — 내부 이름/구조 변경 시 테스트 깨짐
  - **Port 패턴의 의도 훼손** — Port 의 계약이 아니라 구현 세부에 결합
  - **테스트가 "구현 복제"** — Controller 코드를 읽으면 테스트도 예측 가능. 가치가 얇음
  - 테스트 유지보수 비용이 높아 리팩토링을 **회피** 하게 됨 (테스트 고치기 귀찮아서 내부 구조 개선 포기)
- **탈락 이유**: [ADR-011](./adr-011-layered-port-adapter.md) 의 "Port 는 계약" 과 정면 충돌. 테스트가 내부 구조 개선을 막는 안티패턴.

### Option 2 — 모든 테스트를 Integration 으로 (Mockito 전면 금지)

Controller → Service → Repository → DB 전체 흐름을 매번 검증. `@SpringBootTest` + Testcontainers.

- **장점**:
  - 최대한 실제 동작에 가까운 검증
  - 리팩토링 안전망 완벽
- **단점**:
  - **테스트 속도 급감** — 모든 테스트가 Spring 컨텍스트 + Postgres 기동 필요. 초 단위 테스트
  - **순수 알고리즘 단위 테스트 불가** — JWT 서명 · RefreshToken rotation · Apple JWKS 검증 같은 순수 함수까지 Integration 으로 하면 비효율
  - **외부 시스템 (FCM, Resend) 호출이 곤란** — 실제 API 호출하거나 stub 서버 운영 필요
- **탈락 이유**: 테스트 실행 시간의 지수 증가. 개발 피드백 루프 붕괴.

### Option 3 — 4층 테스트 전략 + delegation mock 금지 ★ (채택)

테스트를 4개 층으로 분류하고, 각 층마다 mock 사용 규칙을 명시. Port 계약 테스트가 주력.

| 층 | 검증 대상 | 실행 시간 | Mock 사용 |
|---|---|---|---|
| Unit | 단일 클래스 순수 알고리즘 | ms | 비결정 의존성 (Clock, 난수) 에만 |
| Contract (JSON) | DTO ↔ JSON 직렬화 | ms | 없음 (Jackson 직접) |
| Contract (Port) | Port 인터페이스의 행위 계약 | s | 외부 시스템 (FCM, Resend) 에만 |
| Integration | 엔드포인트 → DB 전체 흐름 | s | 외부 시스템에만 |

- **장점**:
  - **각 층이 자기 목적** — 순수 알고리즘은 빠른 단위 테스트, 행위는 Port 계약, 통합은 Integration
  - **Delegation mock 금지** — Port 계약 수준에서 검증하므로 내부 구조 변경에 탄력적
  - **외부 시스템 mock 은 허용** — FCM/Resend 를 실제 호출하지 않되 그 경계를 fake 로 대체
  - **실행 속도 균형** — 단위 테스트는 ms, Contract 는 s, Integration 은 최소
- **단점**:
  - 4층 구분의 학습 곡선 — 어떤 테스트를 어느 층에 둘지 판단 필요
  - Contract 테스트의 초기 설계 비용 (abstract 계약 + 구현별 구체 테스트)
- **채택 이유**:
  - [ADR-011 (Port/Adapter)](./adr-011-layered-port-adapter.md) 의 의도와 완전 정합
  - 리팩토링 안전망 + 회귀 방지 + 속도의 삼각 균형
  - 실제 적용 1년 경과 후 안정적 작동 확인

## 결정

### Delegation mock 금지 규칙

다음 패턴을 **쓰지 않습니다**:

```java
// ❌ 금지 — 내부 위임 경로 검증
@Test
void signUp_delegatesToEmailAuthService() {
    AuthServiceImpl auth = new AuthServiceImpl(emailAuthService);
    auth.signUpWithEmail(req);
    verify(emailAuthService).signUp(req);  // ← 구현 세부에 결합
}
```

대신:

```java
// ✅ 허용 — Port 계약으로 행위 검증
@ContractTest
class AuthServiceImplContractTest extends AbstractAuthPortContractTest {
    @Autowired AuthPort authPort;

    @Test
    void signUp_createsUserAndSendsVerificationEmail() {
        authPort.signUpWithEmail(new SignUpRequest("a@test.com", "pw"));

        // 외부에서 관측 가능한 결과를 검증
        assertThat(userRepository.findByEmail("a@test.com")).isPresent();
        assertThat(emailPort.lastSentTo()).isEqualTo("a@test.com");
        assertThat(emailPort.lastSentSubject()).contains("verify");
    }
}
```

이 두 테스트의 차이:

- 금지 패턴: `EmailAuthService.signUp` 이름이 바뀌면 깨짐
- 허용 패턴: `EmailAuthService.signUp` 이름이 바뀌어도, 인라인화되어도, 쪼개져도 **행위가 유지되면 통과**

### Mock 허용 맥락 (두 가지)

**맥락 1 — 외부 시스템 격리**

FCM, Resend, Supabase Auth 같은 외부 API 를 테스트에서 실제 호출하지 않도록. 다만 **delegation 검증이 아니라 fake adapter** 형태.

```java
// core-auth-impl/test 내의 InMemoryEmailAdapter (fake)
public class InMemoryEmailAdapter implements EmailPort {
    private final List<SentEmail> sent = new ArrayList<>();

    @Override
    public void send(String to, String subject, String body) {
        sent.add(new SentEmail(to, subject, body));  // 실제 Resend 호출 안 함
    }

    public String lastSentTo() { return sent.get(sent.size()-1).to(); }
}

@TestConfiguration
static class Config {
    @Bean @Primary
    EmailPort emailPort() { return new InMemoryEmailAdapter(); }
}
```

특징: Mockito 의 `mock()` / `verify()` 가 아니라 **실제 구현체의 in-memory 버전**. 행위 (저장, 조회) 가 실제로 작동.

**맥락 2 — 비결정 의존성 고정**

시간 (`Clock`), 난수 (`TokenGenerator`) 같은 비결정 의존성을 고정값으로:

```java
// RefreshTokenServiceTest
@BeforeEach
void setUp() {
    Clock fixedClock = Clock.fixed(Instant.parse("2026-04-24T00:00:00Z"), ZoneOffset.UTC);
    TokenGenerator deterministicGen = () -> "test-token-001";
    service = new RefreshTokenService(repository, fixedClock, deterministicGen);
}

@Test
void rotate_expiredToken_returnsNewToken() {
    // ... 고정 시간 + 고정 토큰으로 예측 가능한 assertion
}
```

여기서 `Clock` · `TokenGenerator` 는 **mock 이 아니라 real 구현체** (`Clock.fixed()`, 람다). 만약 외부 API 라서 진짜 mock 이 필요하면 해당 시점에만 `mock()` 사용 — 그래도 **`verify()` 로 호출 검증은 안 함**.

### 4층 테스트 배치 원칙

| 검증 대상 예시 | 어느 층? | 이유 |
|---|---|---|
| JWT 서명 알고리즘 | Unit | 순수 함수 + 비결정 (Clock) 고정 |
| RefreshToken rotation 규칙 | Unit | 순수 상태 전이 로직 |
| Apple JWKS 검증 | Unit | RSA 키쌍으로 고정 입력 재현 |
| `AuthPort.signUpWithEmail` 행위 | Contract (Port) | Port 계약의 전체 행위 |
| `UserJsonContract` (UserResponse ↔ JSON) | Contract (JSON) | DTO 직렬화 계약 |
| `POST /api/apps/sumtally/auth/email/signup` | Integration | HTTP → Controller → Service → DB 끝까지 |

각 층이 **서로 다른 결함을 잡음**:

- Unit 실패: 알고리즘 자체 버그
- Contract JSON 실패: 직렬화 오타 (필드 이름 변경 등)
- Contract Port 실패: Port 행위 계약 위반
- Integration 실패: HTTP/Security/Transaction 레벨 문제

### 현재 테스트 분포 (2026-04-24 기준)

| 층 | 개수 (대략) | 비중 |
|---|---|---|
| Unit (순수 알고리즘) | 45 | 10% |
| Contract (JSON) | 65 | 15% |
| Contract (Port) | 180 | 42% |
| Integration | 140 | 33% |
| **합계** | **~430** | 100% |

Contract (Port) 가 절반에 가까움. delegation mock 테스트 = 0.

## 이 선택이 가져온 것

### 긍정적 결과

**리팩토링이 자유로움** — `AuthServiceImpl` 내부에서 `EmailAuthService` 를 인라인화하거나 메서드 이름을 바꿔도 테스트는 그대로 통과. 내부 구조 개선이 **테스트 수정 비용 없이** 진행 가능.

**테스트가 "계약 문서" 역할** — Port 계약 테스트는 "이 Port 가 어떻게 동작하는가" 를 외부 관점에서 기술. Javadoc 보다 신뢰 가능한 스펙.

**리팩토링 회피 현상 소거** — "테스트 고치기 귀찮아서 내부 구조 안 고침" 이라는 안티패턴 없음. 구조 개선을 결정할 때 "테스트 얼마나 고쳐야 하지?" 걱정 제거.

**테스트 유지 비용 낮음** — 430 테스트 중 대부분이 Contract/Integration. 이들은 Port 계약 (변경 드문 경계) 을 검증하므로 코드 리팩토링에 강함. "Port 계약 변경" 시에만 테스트 업데이트.

**새 앱 추가 시 기본 테스트 자동 확보** — 앱 모듈이 `AuthPort` 주입받으면 Port 계약 테스트가 그 앱 DataSource 에 대해서도 작동. `new-app.sh` 가 생성하는 기본 Contract 테스트 fixture 만 추가하면 끝.

### 부정적 결과

**구현 세부 버그를 곧바로 지목 못 함** — Port 계약 테스트가 실패하면 "어디서 틀렸는지" 를 추적하기 위한 디버깅 필요. delegation mock 이라면 "verify 실패한 호출" 이 지목되지만 우리는 "최종 결과가 틀림" 만 알려줌. 완화: 로그 + breakpoint 조합.

**Contract 테스트 설계의 초기 비용** — 첫 Port 의 Contract 테스트 fixture 를 설계할 때 "어떤 fake adapter 가 필요한가 · 어떤 fixture 가 공통인가" 를 신중히 결정 필요. 완화: 한 번 설계되면 다른 Port 에 재사용.

**초기 학습 곡선** — "Mockito `verify()` 를 쓰지 마라" 는 Java 개발자에게 낯섦. 초기 멤버는 "그럼 어떻게 단위 테스트 쓰지?" 로 혼란. 완화: [`docs/testing/contract-testing.md`](../production/test/contract-testing.md) 에 FAQ 수준의 상세 가이드.

### 순수 알고리즘 단위 테스트는 **유지**

"delegation mock 금지" 는 **위임 검증 금지** 를 뜻하지 "모든 단위 테스트 금지" 가 아닙니다. 순수 알고리즘 (JWT, RefreshToken, Apple JWKS, PasswordHasher) 은 계속 단위 테스트:

```java
@Test
void issueAndValidate_happyPath() {
    String token = jwtService.issueAccessToken(1L, "a@test.com", "app1", "user");
    AuthenticatedUser user = jwtService.validateAccessToken(token);

    assertThat(user.userId()).isEqualTo(1L);
    assertThat(user.appSlug()).isEqualTo("app1");
}
```

이건 **"JwtService 가 Jwts.builder() 를 호출했는가"** 를 검증하지 않음. **"발급된 토큰을 검증하면 원본 값이 돌아오는가"** 라는 외부 관측 행위를 검증. 위임 체크가 아님.

## 교훈

### "Port 계약 테스트" 와 "내부 구현 테스트" 의 경계를 먼저 선언할 것

초기에는 "테스트를 어떻게 쓸지" 가이드 없이 팀원마다 다른 스타일을 썼음. 어떤 테스트는 `@SpringBootTest` 에서 Controller 를 직접 호출, 다른 테스트는 `mock()` 으로 Service 검증. 결과적으로:

- 리팩토링할 때 "이 테스트는 왜 깨졌지?" 로 혼란
- 같은 기능을 여러 층에서 중복 검증 (테스트 총량만 늘고 가치는 제자리)
- 새 테스트 쓸 때 "어디에 쓰지?" 로 매번 결정 비용

4층 전략 + delegation mock 금지를 **명시적 선언** 한 이후:

- 새 테스트 쓸 때 "이 검증은 어느 층?" 이 즉답 가능
- 리팩토링 시 "어떤 테스트가 깨질 수 있는가" 예측 가능
- 중복 검증 방지 (같은 행위를 두 층에서 검증 안 함)

**교훈**: 테스트 전략은 **코드 시작 전에** 선언해야 함. "우선 쓰고 나중에 정리" 는 누적된 혼란으로 귀결. 전략 문서 ([testing-strategy.md](../production/test/testing-strategy.md)) 가 코드만큼 중요.

### Fake adapter 가 Mock 보다 강력함

초기에는 외부 시스템도 `mock()` + `when().thenReturn()` 으로 처리했어요. 그런데:

- `when(emailSender.send(any(), any(), any())).thenReturn(null)` 같은 stub 이 각 테스트마다 반복
- mock 설정 실수 (thenReturn 빠뜨림) 로 인한 `NullPointerException` 디버깅
- "실제로 뭐가 전송됐는지" 검증하려면 `ArgumentCaptor` 추가 보일러플레이트

그래서 **fake adapter (in-memory 구현)** 로 전환:

- 테스트마다 stub 설정 불필요 (fake 가 기본 동작 수행)
- `lastSentTo()`, `allSentEmails()` 같은 **도메인 의미 메서드** 를 fake 에 추가 가능
- 여러 테스트에서 공통 재사용

**교훈**: 외부 시스템 격리가 필요해도 Mockito 가 최선은 아님. 도메인 의미의 fake 구현을 만들면 테스트 가독성 + 재사용성 ↑.

### "Delegation mock 금지" 는 **안 보이는 비용** 을 제거함

초기에 delegation mock 을 허용하면 테스트 작성은 빨라져 보임. "이 메서드가 저 메서드를 부르는가만 확인하면 되니까." 그런데:

- 리팩토링마다 테스트 수정 — **시간 누적**
- 구조 개선 회피 — **코드 품질 저하**
- 테스트 가치 저하 — "실제 행위" 는 안 보고 "호출 패턴" 만 확인

이 비용은 **한 번에 드러나지 않고 누적**되는 형태. 6개월 지나면 "왜 리팩토링이 이렇게 무섭지?" 로 체감. 그때 원인 추적하면 delegation mock 테스트가 뿌리.

선제적으로 금지해두면 이 비용 자체가 발생 안 함. 금지의 가치는 **발생하지 않은 비용** 이라 측정이 어렵지만 실재함.

**교훈**: 어떤 패턴은 초기 비용이 낮아 "당연히 허용" 으로 흘러가지만, 누적 비용이 큰 경우가 있음. 금지 결정은 **선제적** 으로 해야 효과가 있음. 누적된 후 제거는 몇 배 더 힘듦.

## 관련 사례 (Prior Art)

- **[Kent Beck · Test Desiderata](https://kentbeck.github.io/TestDesiderata/)** — 좋은 테스트의 12 가지 속성. "Structure-insensitive" 가 본 ADR 의 핵심 근거.
- **[Martin Fowler · Mocks Aren't Stubs](https://martinfowler.com/articles/mocksArentStubs.html)** — "classical TDD" vs "mockist TDD" 구분. 본 ADR 은 classical 계보.
- **[Growing Object-Oriented Software, Guided by Tests (GOOS)](https://www.growing-object-oriented-software.com/)** — "Role interface + end-to-end test" 접근. Port 계약 테스트의 이론적 근거.
- **[DHH · "Test-Induced Design Damage"](https://dhh.dk/2014/test-induced-design-damage.html)** — 테스트를 위한 불필요한 추상화 비판. delegation mock 금지의 철학적 배경.
- **[Testcontainers](https://testcontainers.com/)** — Port 계약 테스트의 실제 DB 구현체. 본 ADR 의 Contract (Port) 층이 활용.
- **[Contract Testing with Pact](https://docs.pact.io/)** — 서비스 간 계약 테스트. 본 ADR 의 내부 모듈 간 계약 테스트와 유사 철학 (내부 구조 ≠ 외부 계약).

## Code References

**Port 계약 테스트 구조**:
- [`core-auth-impl/test/AuthServiceImplContractTest.java`](https://github.com/storkspear/spring-backend-template/blob/main/core/core-auth-impl/src/test/java/com/factory/core/auth/impl/AuthServiceImplContractTest.java) — AuthPort 계약 구현 테스트
- [`core-auth-api/test/AbstractAuthPortContractTest`](https://github.com/storkspear/spring-backend-template/tree/main/core/core-auth-api/src/test) — 추상 계약 정의

**Fake adapter 예시**:
- [`core-auth-impl/test/.../InMemoryEmailAdapter`](https://github.com/storkspear/spring-backend-template/tree/main/core/core-auth-impl/src/test) — Resend 대체 fake
- JpaAuthFixtures — 테스트 픽스처 공통 유틸

**순수 단위 테스트 (허용 패턴)**:
- [`common-security/test/JwtServiceTest.java`](https://github.com/storkspear/spring-backend-template/blob/main/common/common-security/src/test/java/com/factory/common/security/jwt/JwtServiceTest.java) — JWT 서명/검증
- [`common-security/test/PasswordHasherTest.java`](https://github.com/storkspear/spring-backend-template/tree/main/common/common-security/src/test/java/com/factory/common/security) — BCrypt 암호화
- [`core-auth-impl/test/RefreshTokenServiceTest.java`](https://github.com/storkspear/spring-backend-template/blob/main/core/core-auth-impl/src/test/java/com/factory/core/auth/impl/service/RefreshTokenServiceTest.java) — rotation 알고리즘
- [`core-auth-impl/test/AppleSignInServiceTest.java`](https://github.com/storkspear/spring-backend-template/blob/main/core/core-auth-impl/src/test/java/com/factory/core/auth/impl/service/AppleSignInServiceTest.java) — Apple JWKS RSA 검증

**전략 문서**:
- [`docs/testing/testing-strategy.md`](../production/test/testing-strategy.md) — 4층 전략 전체
- [`docs/testing/contract-testing.md`](../production/test/contract-testing.md) — Port 계약 테스트 상세 + Mock 허용/금지 가이드

**부재 확인 (delegation mock 없음)**:
- `grep -rE "verify\(.*\)\.[a-z]+\(" core/ common/` — delegation 검증 패턴 0건 (외부 시스템 verify 제외)
- `@ExtendWith(MockitoExtension.class)` 사용처 — 30여 건, 모두 외부 시스템 격리 또는 순수 알고리즘 비결정 고정

**관련 ADR**:
- [ADR-003 · -api / -impl 분리](./adr-003-api-impl-split.md) — Port 가 계약 단위
- [ADR-011 · 레이어드 + 포트/어댑터](./adr-011-layered-port-adapter.md) — Port 계약 의도
