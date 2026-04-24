# ADR-003 · core 모듈을 `-api` / `-impl` 로 분리

**Status**: Accepted. 2026-04-20 기준 core × 6 도메인 (user, auth, device, push, billing, storage) 전부 -api/-impl 쌍으로 구성. ArchUnit 9개 규칙 (r6, r9~r11, r13~r15, r17, r21) 이 구조 강제.

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~5분

## 결론부터

REST API 서버와 클라이언트를 떠올려보세요. 클라이언트는 **API 스펙 (OpenAPI 문서)** 만 알고 HTTP 호출을 합니다. 서버 내부가 PostgreSQL 을 쓰는지 MongoDB 를 쓰는지, Java 로 짜였는지 Go 로 짜였는지 전혀 신경 쓰지 않아요. 같은 원리를 **한 JVM 안의 모듈 간 호출** 에 적용한 것이 `-api` / `-impl` 분리예요. `-api` 모듈은 "스펙과 DTO", `-impl` 은 "내부 구현". 앱 모듈은 스펙만 보고 호출합니다.

> Java 표준 라이브러리로 비유하면 `java.sql.Connection` (인터페이스, 모든 앱이 의존) vs `org.postgresql.jdbc.PgConnection` (구현체, 특정 벤더). 앱은 Connection 만 알고, 실제 구현체는 런타임에 주입. 같은 패턴입니다.

## 왜 이런 고민이 시작됐나?

[`ADR-001`](./adr-001-modular-monolith.md) 에서 "특정 앱이 성공해서 마이크로서비스로 추출할 때 코드 변경 0 으로 가능하다" 고 약속했어요. 이 약속이 **실제로 지켜지려면** 지금 이 시점에서 구조적 장치가 있어야 합니다. 아무 장치 없이 써놓은 코드를 미래에 추출하려고 하면 수백 곳 리팩토링이 필요해요.

구체적인 물음은 이거예요.

> **미래의 추출 가능성을 위해 지금 어떤 구조적 비용을 감내할 것인가?**

여기서 "추출" 이 무엇인지부터 짚어봅시다. 예를 들어 `sumtally` 앱이 폭발적 성장을 해서 **별도 인프라** 가 필요해진 상황을 가정해볼게요. 이때 우리가 원하는 전환 시나리오는 이래요.

**Before** — 현재 (모놀리스):
```java
// apps/app-sumtally/src/.../SomeController.java
@Autowired
private AuthPort authPort;  // 같은 JVM 의 AuthServiceImpl 이 주입됨

public AuthResponse signup(SignUpRequest req) {
    return authPort.signUpWithEmail(req);  // 메서드 호출
}
```

**After** — 추출 후 (마이크로서비스):
```java
// apps/app-sumtally/src/.../SomeController.java
@Autowired
private AuthPort authPort;  // 여전히 AuthPort — 이름 안 바뀜

public AuthResponse signup(SignUpRequest req) {
    return authPort.signUpWithEmail(req);  // 코드 동일!
}
```

위 두 코드는 **완전히 같습니다**. 바뀐 건 단 하나 — `AuthPort` 의 구현체가 `AuthServiceImpl` (같은 JVM) 에서 `AuthHttpClient` (HTTP 호출) 로 교체되었을 뿐이에요. 앱 모듈의 코드는 **한 줄도 바뀌지 않습니다**.

이 시나리오가 실현되려면 **지금 이 시점에서** 앱 모듈이 `AuthPort` 인터페이스만 보고, `AuthServiceImpl` 클래스를 **직접 참조하지 않도록** 강제해야 해요.

만약 앱이 `AuthServiceImpl` 을 직접 import 하고 있었다면, 추출 시점에 두 가지 나쁜 선택만 남습니다.

- **(a) `core-auth-impl` 코드를 복사해서 새 레포로 가져가기** — 두 곳에서 같은 코드를 유지해야 하는 지옥.
- **(b) 모든 `AuthServiceImpl` 호출 지점을 찾아서 HTTP 클라이언트로 교체** — 수십~수백 곳 수동 리팩토링.

두 선택지 모두 **"코드 변경 0" 약속을 깨뜨립니다**.

## 고민했던 대안들

### Option 1 — 단일 `core-auth` 모듈 (api/impl 미분리)

`core-auth/src/main/java/...` 에 인터페이스, 구현, 엔티티, Repository 가 모두 공존.

- **장점**: 모듈 수 절반. 파일 덜 복잡.
- **단점**: 앱이 의존 선언할 때 "인터페이스만 보기" 가 언어 레벨로 강제 안 됨. Java 는 public 클래스면 어디서든 import 가능. 앱이 실수로 `AuthServiceImpl` 을 import 해도 컴파일 성공.
- **탈락 이유**: 추출 가능성 파괴. [`ADR-001`](./adr-001-modular-monolith.md) 의 약속을 지킬 수 없음.

### Option 2 — 런타임 전략 패턴 (Spring `@Qualifier`)

단일 모듈 유지하되 `@Primary`, `@Qualifier`, `@Conditional` 같은 Spring 어노테이션으로 런타임 구현체 선택.

- **장점**: 유연성 높음. 런타임에 구현 교체 가능.
- **단점**:
  - **컴파일 타임 보장 없음** — 앱이 `AuthServiceImpl` 을 직접 import 하는 것을 막지 못함.
  - Spring 이 없는 환경 (테스트 등) 에서는 이 강제가 무력화.
- **탈락 이유**: 경계가 런타임 어노테이션에만 의존. 빌드 시스템 수준의 기계 강제력이 없음.

### Option 3 — Java 9+ 모듈 시스템 (`module-info.java`)

Java 9 에서 도입된 `module-info.java` 로 `exports` 선언한 패키지만 외부 접근 허용.

- **장점**: Java 언어 레벨 강제.
- **단점**: **Spring Boot + Java 9 모듈 시스템 궁합 어려움**. classpath vs module path 혼재 문제. 디버깅 어려움.
- **탈락 이유**: 이론적으로 완벽하지만 Spring Boot 생태계와 궁합이 나빠 실무 채택이 많지 않음.

### Option 4 — `-api` / `-impl` Gradle 모듈 분리 ★ (채택)

6개 도메인 각각을 `core-<domain>-api` + `core-<domain>-impl` 두 개의 Gradle 모듈로 분리.

- **`-api` 모듈**: 인터페이스 + DTO + Exception 만. JPA 의존 0. Spring 의존 0.
- **`-impl` 모듈**: Spring 빈 + JPA 엔티티 + 비즈니스 로직.
- **앱 모듈**: `-api` 만 의존. `-impl` 은 ArchUnit 규칙 r6 이 금지.

**장점**:
- 컴파일 타임 강제 — `-impl` 의 클래스를 앱에서 import 시도하면 빌드 실패 ([`ADR-001`](./adr-001-modular-monolith.md) 의 1단계 방어).
- 런타임 강제 — 바이트코드 스캔으로 reflection 우회도 차단 ([`ADR-001`](./adr-001-modular-monolith.md) 의 2단계 방어).
- 미래 추출 시 `-api` 는 그대로, `-impl` 만 HTTP 클라이언트로 교체.

**단점**:
- 모듈 수 2배 (6개 도메인 → 12 모듈).
- 인터페이스와 구현체 사이의 매핑 파일 관리 필요 (DTO ↔ Entity 변환 등).
- 초기 설정 복잡도 약간 상승.

**채택 이유**: 단점들이 전부 **한 번의 초기 설정 비용** 이고, 장점은 **프로젝트 수명 동안 지속적 가치** (추출 가능성 + 경계 강제).

## 결정

core 6개 도메인 전부 `-api` / `-impl` 쌍으로 분리합니다.

```
core/
├── core-auth-api/   + core-auth-impl/
├── core-user-api/   + core-user-impl/
├── core-device-api/ + core-device-impl/
├── core-push-api/   + core-push-impl/
├── core-billing-api/+ core-billing-impl/
└── core-storage-api/+ core-storage-impl/
```

이 분리를 **실효성 있게** 유지하기 위한 장치 3가지를 덧붙입니다.

### 장치 1 — Port 인터페이스 패턴

`-api` 모듈의 인터페이스는 `*Port` 접미사를 사용합니다 (Hexagonal Architecture 용어). 실제 예시 ([`AuthPort.java`](https://github.com/storkspear/spring-backend-template/blob/main/core/core-auth-api/src/main/java/com/factory/core/auth/api/AuthPort.java)):

```java
public interface AuthPort {
    AuthResponse signUpWithEmail(SignUpRequest request);
    AuthResponse signInWithEmail(SignInRequest request);
    AuthResponse signInWithApple(AppleSignInRequest request);
    AuthResponse signInWithGoogle(GoogleSignInRequest request);
    AuthTokens refresh(RefreshRequest request);
    void withdraw(long userId, WithdrawRequest request);
    void requestPasswordReset(PasswordResetRequest request);
    void confirmPasswordReset(PasswordResetConfirmRequest request);
    void changePassword(long userId, ChangePasswordRequest request);
    void verifyEmail(VerifyEmailRequest request);
    void resendVerificationEmail(long userId);
}
```

**Port 의 규칙**:
- 파라미터와 반환 타입은 **DTO 만** (`Request` / `Response` / `Tokens` 등). Entity 금지 (r11).
- JavaDoc 에는 **구현 내부 힌트** 까지 포함해도 됨. 하지만 파라미터로 Entity 는 노출 안 함.
- throws 절의 Exception 도 `-api` 모듈의 `exception/` 패키지에 정의 (`AuthException` 등).

### 장치 2 — Primary / Secondary Adapter 구분

Port 는 두 방향으로 구현됩니다.

**Primary Adapter (Inbound)** — Port 를 **구현하고 비즈니스 로직을 담는** 클래스. Spring 관용에 따라 `*ServiceImpl` 로 명명.

```java
// core/core-auth-impl/.../AuthServiceImpl.java
@Service
public class AuthServiceImpl implements AuthPort {
    private final UserRepository userRepository;
    private final EmailPort emailPort;

    @Override
    public AuthResponse signUpWithEmail(SignUpRequest request) {
        // 비즈니스 로직
    }
}
```

**Secondary Adapter (Outbound)** — **외부 시스템에 연결하는** 구현체. `*Adapter` 로 명명.

```java
// core/core-auth-impl/.../email/ResendEmailAdapter.java
public class ResendEmailAdapter implements EmailPort {
    private final HttpClient httpClient;

    @Override
    public void send(String to, String subject, String htmlBody) {
        // Resend API 호출
    }
}
```

**왜 이 구분이 중요한가**:
- Primary Adapter 는 "우리 시스템의 비즈니스 로직" 을 담음. 테스트가 복잡.
- Secondary Adapter 는 "외부 시스템과의 HTTP/TCP 연결" 만 담음. 테스트는 HttpClient mock 으로 단순.

### 장치 3 — ArchUnit 9개 규칙이 `-api`/`-impl` 경계 강제

[`ADR-001`](./adr-001-modular-monolith.md) 의 2단계 방어(ArchUnit 22규칙) 중 **9개가 이 결정과 직접 연관** 됩니다.

| # | 규칙 | 막는 것 |
|---|---|---|
| **r6** | `CORE_API_MUST_NOT_DEPEND_ON_CORE_IMPL` | `-api` 모듈이 `-impl` 을 참조하는 것 |
| **r9** | `CORE_API_MUST_NOT_DEPEND_ON_JPA` | `-api` 가 JPA 에 의존하는 것. **extraction-critical** |
| **r10** | `CORE_API_MUST_NOT_USE_JPA_ANNOTATIONS` | `-api` 에 `@Entity`, `@Table` 등 붙이는 것 |
| **r11** | `PORT_METHODS_MUST_NOT_EXPOSE_ENTITIES` | Port 메서드가 Entity 타입을 노출하는 것 |
| **r13** | `SPRING_BEANS_MUST_RESIDE_IN_IMPL_OR_APPS` | `@Service`, `@Component` 가 `-api` 에 들어가는 것 |
| **r14** | `PORT_INTERFACES_MUST_RESIDE_IN_API` | `*Port` 인터페이스가 `-impl` 에 놓이는 것 |
| **r15** | `SERVICE_IMPL_MUST_RESIDE_IN_IMPL` | `*ServiceImpl` 클래스가 `-api` 에 놓이는 것 |
| **r17** | `REPOSITORIES_MUST_RESIDE_IN_IMPL_REPOSITORY` | `*Repository` 가 `impl.repository` 바깥에 놓이는 것 |
| **r21** | `ENTITIES_MUST_RESIDE_IN_IMPL_ENTITY` | `@Entity` 가 `impl.entity` 바깥에 놓이는 것 |

### "extraction-critical" 이 무슨 뜻인가 — r9 의 특별함

r9 는 규칙 이름에 **`extraction-critical`** 라벨이 붙어있어요. 이게 왜 특별한지 설명하면 `-api`/`-impl` 분리의 본질이 명확해집니다.

가정: 어느 날 `-api` 모듈이 JPA 에 의존하도록 허용된다고 합시다.

```java
// core-auth-api/AuthPort.java (잘못된 예)
public interface AuthPort {
    User signInWithEmail(SignInRequest request);  // User 는 @Entity
}
```

이 코드는 컴파일됩니다. 하지만 **미래 추출 시점에 치명적 문제** 가 생겨요.

`core-auth-impl` 을 HTTP 서비스로 추출하려면, HTTP 클라이언트 쪽은 `AuthPort` 인터페이스를 가져야 합니다. 그러려면:
- HTTP 클라이언트가 `User` 엔티티 클래스를 가져야 함
- `User` 엔티티는 JPA 의존 (`@Entity`, `@Id`, `@Column`)
- → HTTP 클라이언트 프로젝트가 **JPA 런타임을 전부 가져야 함**

HTTP 클라이언트는 DB 를 안 씁니다. HTTP 로 요청만 보내는데 JPA 를 가져야 한다? 이건 모순이에요. r9 는 이 모순을 **지금 이 시점에서** 차단합니다.

## Counter-example — Entity 누출 시도

**잘못된 코드**:

```java
// core/core-auth-api/.../AuthPort.java (위반)
public interface AuthPort {
    User signInWithEmail(SignInRequest request);  // Entity 반환
}
```

**ArchUnit r11 차단**:

```
Architecture Violation [Priority: MEDIUM] - Rule 'r11: Port methods must not
expose Entity types' was violated (1 times):
Method <com.factory.core.auth.api.AuthPort.signInWithEmail(SignInRequest)>
has return type <com.factory.core.user.impl.entity.User>

> Task :bootstrap:test FAILED
```

**추가로 r6 도 동시 발동** — `core-auth-api` 가 `core-user-impl` 에 의존:

```
Architecture Violation [Priority: MEDIUM] - Rule 'r6: core-*-api must not
depend on core-*-impl' was violated (1 times):
Method <com.factory.core.auth.api.AuthPort.signInWithEmail(SignInRequest)>
references class <com.factory.core.user.impl.entity.User>
```

**고치는 방법**: User 엔티티 대신 `UserSummary` DTO 를 `core-user-api/dto/` 에 정의해서 반환.

## 이 선택이 가져온 것

### 긍정적 결과

**추출 1분 컷** — `AuthServiceImpl` 을 `AuthHttpClient` 로 교체하는 Spring 빈 설정 한 줄 수정. 앱 모듈 코드는 건드리지 않음.

**컴파일 타임 경계** — 앱 개발자가 실수로 `-impl` 의 클래스를 import 하려고 하면 Gradle 이 빌드 실패.

**테스트 구조 명확** — 각 앱 모듈의 테스트는 `AuthPort` 를 Mock 으로 주입해서 테스트 가능.

**JPA / Spring 의존성의 격리** — `-api` 는 순수 Java. 미래 추출 시 `-api` 자체가 어느 플랫폼에든 가져갈 수 있음.

### 부정적 결과

**모듈 수 2배** — 6개 도메인 × 2 = 12 core 모듈. IDE 프로젝트 트리가 길어짐. 완화: 관습으로 짝 구조가 명확해서 탐색은 쉬움.

**DTO ↔ Entity 변환 비용** — Port 가 Entity 반환 금지이므로 `-impl` 내부에서 Entity 를 DTO 로 변환해야 함. 완화: ADR-016 (DTO Mapper 금지, Entity 메서드 패턴) 이 이 비용을 최소화.

**Port 인터페이스가 커지는 경향** — AuthPort 가 현재 **11 메서드** (email 가입 / 이메일·Apple·Google 로그인 / refresh / 탈퇴 / password reset 3개 (요청·확인·변경) / email verify 2개 (검증·재발송)). 이 인터페이스 하나가 "인증 도메인의 전체 수퍼집합" 이 됨. 완화: 인터페이스가 20+ 메서드로 성장하면 그때 `EmailAuthPort`, `SocialAuthPort`, `PasswordResetPort` 같은 **책임 기반 분할** 고려. 현재 11 메서드는 적정 수준.

### 감당 가능성 판단

단점들은 **초기 설정 비용 + 지속적 약간의 번거로움** 수준입니다. 반면 장점 중 "추출 가능성" 은 **언젠가 큰 위기 순간에 프로젝트를 살리는 보험** 이에요.

## 교훈

**2026-04-20 — `core-auth-impl/controller/AuthController` 의 런타임 등록 해제 사건** ([`ADR-001`](./adr-001-modular-monolith.md) 과 연결).

이 분리 구조에서는 Controller 조차 **Port 의 사용자** 입니다. Controller 는 Port 를 주입받아 호출할 뿐 Port 를 구현하지 않아요. 그래서 Controller 가 `-impl` 에 있는 것 자체는 괜찮았는데, 문제는 **Controller 를 런타임에 어디서 등록할 것인가** 였어요.

처음에는 `core-auth-impl` 의 `AuthAutoConfiguration` 이 `@Import(AuthController.class)` 로 등록 → 공용 `/api/core/auth/*` 경로. 하지만 이 방식은 "모든 앱이 같은 Controller 공유 → 어느 앱 요청인지 런타임 구분 필요 → ThreadLocal + AbstractRoutingDataSource" 라는 복잡도를 불렀어요.

2026-04-20 에 이걸 수정 — `AuthController` 는 이제 `-impl` 에 **스캐폴딩 소스** 로만 존재, 런타임 등록 안 함. 각 앱 모듈이 자기 `<Slug>AuthController` 를 가지며 Port 를 주입받아 사용.

**교훈**: `-api` / `-impl` 분리는 **모듈 내부 책임 경계** 도 재조정하게 만듭니다. "무엇이 Port 구현체인가", "무엇이 Port 사용자인가" 구분이 명확해질수록 런타임 구조도 단순해져요.

## 관련 사례 (Prior Art)

- **[Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/) (Alistair Cockburn)** — Port / Primary Adapter / Secondary Adapter 용어의 원형.
- **[Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html) (Robert Martin)** — Dependency Inversion 원칙.
- **Java 표준 JDBC — `javax.sql.DataSource` vs 벤더 구현체** — 같은 패턴의 Java 표준 사례.
- **[Spring Modulith](https://github.com/spring-projects/spring-modulith)** — 공식 프로젝트이지만 `-api` / `-impl` 모듈 분리까지는 가지 않고 패키지 경계만 사용.

## Code References

**Port 인터페이스** (모두 `-api` 모듈):
- [`AuthPort.java`](https://github.com/storkspear/spring-backend-template/blob/main/core/core-auth-api/src/main/java/com/factory/core/auth/api/AuthPort.java) — 11 메서드, JavaDoc 풍부.
- [`UserPort.java`](https://github.com/storkspear/spring-backend-template/blob/main/core/core-user-api/src/main/java/com/factory/core/user/api/UserPort.java)
- [`PushPort.java`](https://github.com/storkspear/spring-backend-template/blob/main/core/core-push-api/src/main/java/com/factory/core/push/api/PushPort.java)
- [`EmailPort.java`](https://github.com/storkspear/spring-backend-template/blob/main/core/core-auth-api/src/main/java/com/factory/core/auth/api/EmailPort.java) — 간결. Secondary Adapter 의 대상.

**Primary Adapter** (`-impl` 모듈):
- [`AuthServiceImpl.java`](https://github.com/storkspear/spring-backend-template/blob/main/core/core-auth-impl/src/main/java/com/factory/core/auth/impl/AuthServiceImpl.java)

**Secondary Adapter** (`-impl` 모듈):
- [`ResendEmailAdapter.java`](https://github.com/storkspear/spring-backend-template/blob/main/core/core-auth-impl/src/main/java/com/factory/core/auth/impl/email/ResendEmailAdapter.java)

**Build 의존성 증거**:
- [`core/core-auth-api/build.gradle`](https://github.com/storkspear/spring-backend-template/blob/main/core/core-auth-api/build.gradle) — JPA / Spring 의존 없음.
- [`core/core-auth-impl/build.gradle`](https://github.com/storkspear/spring-backend-template/blob/main/core/core-auth-impl/build.gradle) — JPA / Spring 전체 의존.

**ArchUnit 규칙**:
- [`ArchitectureRules.java`](https://github.com/storkspear/spring-backend-template/blob/main/common/common-testing/src/main/java/com/factory/common/testing/architecture/ArchitectureRules.java) — r6, r9, r10, r11, r13, r14, r15, r17, r21.

**AutoConfiguration**:
- [`AuthAutoConfiguration.java`](https://github.com/storkspear/spring-backend-template/blob/main/core/core-auth-impl/src/main/java/com/factory/core/auth/impl/AuthAutoConfiguration.java) — 추출 시 이 파일이 핵심 교체 지점.

