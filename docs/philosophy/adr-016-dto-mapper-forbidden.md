# ADR-016 · DTO 변환은 Entity 메서드로 (Mapper 클래스 금지)

**Status**: Accepted. 2026-04-20 기준 Entity 에 `to<Dto>()` 메서드 패턴 적용. ArchUnit r22 (`NO_MAPPER_CLASSES`) 가 `*Mapper` 클래스를 빌드 시간에 차단.

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~5분

## 결론부터

`UserMapper`, `ExpenseMapper` 같은 **별도 매핑 클래스를 두지 않습니다**. 대신 엔티티가 자기 DTO 변환 방법을 **직접 메서드로** 제공해요 — `user.toSummary()`, `user.toProfile()`. "엔티티가 자기 표현을 가장 잘 안다" 는 OOP 원칙 그대로. 많은 Spring Boot 프로젝트가 당연하게 쓰는 MapStruct / ModelMapper / 수동 Mapper 계층 — 이게 **없는** 게 우리 선택입니다.

## 왜 이런 고민이 시작됐나?

[`ADR-003`](./adr-003-api-impl-split.md) 에서 "Port 메서드는 Entity 가 아니라 DTO 를 반환해야 한다" 고 정했어요 (ArchUnit r11). 그러면 Service 내부 어딘가에서 **Entity → DTO 변환** 이 반드시 일어나야 합니다.

```java
// AuthServiceImpl.java
public AuthResponse signUpWithEmail(SignUpRequest req) {
    User user = userRepository.save(new User(req.email(), ...));
    RefreshToken token = refreshTokenService.issue(user);

    // ← 이 변환은 어떻게 할 것인가?
    UserSummary userSummary = ???;

    return new AuthResponse(userSummary, accessToken, refreshToken);
}
```

이 "Entity → DTO 변환" 을 어디에 놓을지가 이 결정의 주제입니다.

선택지는 크게 셋:
1. 별도 Mapper 클래스 (`UserMapper.toSummary(user)`)
2. Service 안에서 인라인 변환 (`new UserSummary(user.getId(), ...)`)
3. Entity 에 메서드 (`user.toSummary()`)

Spring Boot 생태계에서는 **(1) Mapper 클래스** 가 가장 흔합니다. MapStruct 는 거의 산업 표준이에요. 하지만 우리는 이를 **채택하지 않았습니다** — 왜 그런지가 이 결정의 핵심.

또 하나의 물음: **"Mapper 금지" 를 사람 관행으로만 유지할 것인가, 기계 강제로 할 것인가?**

## 고민했던 대안들

### Option 1 — MapStruct (어노테이션 기반 코드 생성)

`@Mapper` 인터페이스에 시그니처만 선언하면 annotation processor 가 구현체 자동 생성.

```java
@Mapper(componentModel = "spring")
public interface UserMapper {
    UserSummary toSummary(User user);
    UserProfile toProfile(User user);
    UserAccount toAccount(User user);
}

// Service 에서
@Autowired private UserMapper userMapper;

public AuthResponse signUp(...) {
    // ...
    return new AuthResponse(userMapper.toSummary(user), tokens);
}
```

- **장점**:
  - 산업 표준. 많은 예제 / 문서 / Stack Overflow 답변 존재.
  - 복잡한 매핑 (중첩 객체, 이름 변환, `@Mapping` 어노테이션) 을 어노테이션으로 선언적 표현.
  - 컴파일 타임에 구현체 생성 → 런타임 overhead 없음.
- **단점**:
  - **의존 추가** — `mapstruct`, `mapstruct-processor` 라이브러리.
  - **annotation processor 설정 필요** — Gradle 에 `annotationProcessor` / `testAnnotationProcessor` 구성.
  - **IDE 호환성 이슈 가끔** — annotation processor 가 IDE 마다 다르게 동작. 코드 자동완성 깨짐 사례.
  - **Mapper 인터페이스 수가 엔티티 수와 함께 증가** — 도메인 5개면 5개 Mapper 유지.
  - **매핑 대부분이 1:1 필드 복사** — 우리 프로젝트에서 실제 매핑은 대부분 단순. MapStruct 의 "복잡 매핑 선언" 이점이 실현되지 않음.
- **탈락 이유**: 우리 스케일에서 **비용 > 가치**. 단순 매핑에 annotation processor 를 도입하는 건 과잉.

### Option 2 — ModelMapper (리플렉션 기반)

런타임 리플렉션으로 필드명 매칭해서 자동 변환.

```java
ModelMapper mapper = new ModelMapper();
UserSummary summary = mapper.map(user, UserSummary.class);
```

- **장점**: 설정 0. 바로 쓰기.
- **단점**:
  - **런타임 리플렉션 오버헤드** — 매 요청마다 성능 비용.
  - **런타임 에러** — 필드명 오타가 있으면 런타임에 null 반환 or silent fail.
  - **타입 불일치 시 어색한 동작** — 예: `Long id` vs `String id` 매핑 시 예상 외 결과.
  - **매핑 검증 부재** — "이 DTO 가 정확히 이 Entity 로부터 생성되는가" 를 컴파일 타임에 확인 불가.
- **탈락 이유**: 런타임 리스크 + 디버깅 어려움. 우리 프로젝트의 "명시적 품질" 철학과 어긋남.

### Option 3 — 수동 Mapper 클래스

어노테이션 / 리플렉션 없이 순수 Java 로 Mapper 클래스 직접 작성.

```java
public class UserMapper {
    public static UserSummary toSummary(User user) {
        return new UserSummary(user.getId(), user.getEmail(), user.getDisplayName(), user.isEmailVerified());
    }

    public static UserProfile toProfile(User user) {
        return new UserProfile(...);
    }
}

// Service 에서
UserSummary summary = UserMapper.toSummary(user);
```

- **장점**: 의존 0. 명시적. 디버깅 쉬움.
- **단점**:
  - **호출 사이트 verbose** — `UserMapper.toSummary(user)` 가 `user.toSummary()` 보다 길고 부자연스러움.
  - **Entity 와 Mapper 의 결합** — Mapper 가 `user.getId()`, `user.getEmail()` 를 호출 → Entity 내부를 다 앎. 그럴 거면 Entity 가 직접 하는 게 더 자연스러움 (OOP).
  - **파일 수 2배** — Entity 마다 Mapper 가 따라다님.
- **탈락 이유**: Option 4 와 비교하면 명확한 이득 없음. 그냥 중간 단계.

### Option 4 — Entity 의 `to<Dto>()` 메서드 ★ (채택)

DTO 변환을 Entity 의 메서드로 제공. Mapper 클래스 없음.

```java
// User.java
@Entity
public class User extends BaseEntity {
    // ... 필드

    public UserSummary toSummary() {
        return new UserSummary(getId(), email, displayName, emailVerified);
    }

    public UserProfile toProfile() {
        return new UserProfile(
            getId(), email, displayName, emailVerified,
            isPremium, role, getCreatedAt(), getUpdatedAt()
        );
    }

    public UserAccount toAccount() {
        return new UserAccount(getId(), email, displayName, passwordHash, emailVerified, role);
    }
}

// Service 에서
UserSummary summary = user.toSummary();  // 간결, 자연스러움
```

- **장점**:
  - **호출 사이트 간결** — `user.toSummary()`.
  - **OOP 원칙 부합** — "객체가 자기 표현 방법을 안다".
  - **의존 0** — MapStruct / ModelMapper 라이브러리 불필요.
  - **컴파일 타임 검증** — 필드명 오타면 즉시 컴파일 에러.
  - **`impl → api` 방향 참조만 발생** — `core-user-impl` 의 User 가 `core-user-api` 의 `UserSummary` 참조. ArchUnit 규칙 r6 부합.
- **단점**:
  - **Entity 가 DTO 를 많이 알면 뚱뚱해짐** — User 에 `toSummary`, `toProfile`, `toAccount` 3개 메서드 있음. 5+ 개로 늘면 고민.
  - **복잡한 매핑 (여러 Entity 조합) 을 Entity 에 담기 어려움** — `AuthResponse(UserSummary + Tokens)` 같은 건 Entity 혼자서 못 만듦.
- **완화**:
  - 뚱뚱해지면 **DTO 구조 재평가 시그널** 로 받아들임 (Mapper 부활 아님).
  - 복잡한 조합은 **Service 에서 조립** (Mapper 없이).

### 왜 Option 4 를 기계 강제 (ArchUnit r22) 하는가

Option 4 를 **사람 관행** 으로만 유지하면 어느 날 실수로 누군가 `UserMapper.java` 를 만들 수 있어요. 이게 한 번 생기면:
- 다른 개발자가 "아, 이 프로젝트는 Mapper 쓰는구나" 하고 `ExpenseMapper` 도 만듦
- Mapper 가 번식 → Entity 의 `to<Dto>()` 패턴이 희미해짐
- **원래 규칙이 무너짐**

ArchUnit r22 로 **빌드 시간에 차단** 하면 이 표류를 원천 봉쇄. 사람 의지에 의존하지 않음 ([`ADR-004`](./adr-004-gradle-archunit.md) 의 철학과 정렬).

## 결정

DTO 변환은 **Entity 의 `to<Dto>()` 메서드** 로 제공. `*Mapper` 클래스는 ArchUnit r22 로 차단.

### 실제 구현 예시 — User

```java
@Entity
@Table(name = "users")
public class User extends BaseEntity {

    @Column(nullable = false, unique = true, length = 255)
    private String email;

    @Column(name = "password_hash")
    private String passwordHash;

    @Column(name = "display_name", length = 30)
    private String displayName;

    @Column(name = "email_verified", nullable = false)
    private boolean emailVerified = false;

    @Column(name = "is_premium", nullable = false)
    private boolean isPremium = false;

    @Column(nullable = false, length = 20)
    private String role = "user";

    // ... 생성자, getter, 도메인 메서드 생략

    // ─── DTO 변환 (ADR-016 Mapper 폐기 → Entity 메서드 패턴) ──────────────

    public UserSummary toSummary() {
        return new UserSummary(getId(), email, displayName, emailVerified);
    }

    public UserProfile toProfile() {
        return new UserProfile(
            getId(), email, displayName, emailVerified,
            isPremium, role, getCreatedAt(), getUpdatedAt()
        );
    }

    public UserAccount toAccount() {
        return new UserAccount(getId(), email, displayName, passwordHash, emailVerified, role);
    }
}
```

**규칙**:
- DTO 변환 메서드는 섹션 주석 `// ─── DTO 변환 ───` 로 구분 표시.
- 이름은 `to<DtoTypeName>()` — 예: `toSummary()`, `toProfile()`, `toAccount()`.
- 순수 변환만 — side effect 없음 (DB 호출 X, 외부 API X).

### `api` 모듈의 DTO 정적 팩토리 — 허용 조건

가끔 DTO 자체에 `from(...)` 같은 정적 팩토리가 필요할 때가 있어요. 이건 **조건부 허용**:

**허용되는 케이스** — 정규화/검증이 포함된 경우:

```java
public record AuthTokens(String accessToken, String refreshToken) {

    public static AuthTokens of(String access, String refresh) {
        // 정규화: 공백 제거, null 체크
        return new AuthTokens(
            Objects.requireNonNull(access, "accessToken required").trim(),
            Objects.requireNonNull(refresh, "refreshToken required").trim()
        );
    }
}
```

**금지되는 케이스** — 단순 생성자 대체:

```java
public record UserSummary(Long id, String email, String name, boolean verified) {

    // ❌ 이건 그냥 생성자 래퍼. Mapper 역할 부활의 씨앗.
    public static UserSummary from(Long id, String email, String name, boolean verified) {
        return new UserSummary(id, email, name, verified);
    }
}
```

기준: **"단순 생성자 호출" 을 대체할 뿐인 static 팩토리** 는 금지. "정규화 / 검증 / 변환 로직이 담긴" static 팩토리만 허용.

이 구분이 모호해서 팀 토론 여지가 있지만, 현재까지는 `toSummary()` 패턴만으로 95% 케이스 해결.

### ArchUnit r22 — 기계 강제

```java
public static final ArchRule NO_MAPPER_CLASSES =
    noClasses()
        .that().haveSimpleNameEndingWith("Mapper")
        .and().resideInAPackage("com.factory..")
        .and().areNotInterfaces()
        .should().bePublic()
        .allowEmptyShould(true)
        .as("r22: *Mapper classes (non-interface) are forbidden — use Entity to<Dto>() methods instead");
```

**규칙 의미**:
- 클래스 이름이 `*Mapper` 로 끝나면서
- `com.factory..` 패키지에 있고
- 인터페이스가 아니면
- → `bePublic()` 체크에서 실패 (의도적으로 "절대 public 이 아니어야 한다" 는 불가능 조건)

실제로 `UserMapper.java` 라는 public class 가 생기는 순간 **빌드 실패**. 에러 메시지:

```
Architecture Violation [Priority: MEDIUM] - Rule 'r22: *Mapper classes
(non-interface) are forbidden — use Entity to<Dto>() methods instead'
was violated (1 times):
Class <com.factory.core.user.impl.UserMapper> should be public
```

**왜 interface 는 제외?** — Spring 의 `ServletContextMapper`, MapStruct 의 `@Mapper interface` 같은 **외부 라이브러리 네이밍** 과 충돌 피하려고. 우리가 만드는 게 아닌 것은 통과. 우리는 class 를 만들 이유가 없음 (Entity 메서드로 충분).

### Item 4 에서 UserMapper 삭제 사건

2026 초반 Item 4 에서 실제로 `UserMapper` + `UserMapperTest` 를 전체 삭제하고 Entity 메서드로 전환했어요. 커밋 `e203872` 참조.

Before:
```java
public class UserMapper {
    public static UserSummary toSummary(User u) { ... }
    public static UserProfile toProfile(User u) { ... }
}

// Service 에서
UserSummary s = UserMapper.toSummary(user);
```

After:
```java
// UserMapper.java 완전 삭제
// User.java 에 메서드 추가
public class User extends BaseEntity {
    public UserSummary toSummary() { ... }
    public UserProfile toProfile() { ... }
}

// Service 에서
UserSummary s = user.toSummary();
```

결과: 호출 사이트 15곳 모두 간결해짐. UserMapper 클래스 + UserMapperTest 삭제로 **150+ 줄 제거**. 대체 투입 코드는 `User.java` 에 메서드 3개 (30줄).

## 이 선택이 가져온 것

### 긍정적 결과

**호출 사이트 간결** — `user.toSummary()` 가 `UserMapper.toSummary(user)` 보다 짧고 자연스러움. 메서드 체이닝 (`user.toSummary().name()`) 도 가능.

**의존 없음** — MapStruct / ModelMapper 라이브러리 불필요. `build.gradle` 의존 리스트 깔끔.

**컴파일 타임 검증** — 필드명 오타, 타입 불일치가 즉시 컴파일 에러. 런타임 놀람 없음.

**Entity 가 자기 표현을 소유** — OOP 원칙 (캡슐화, 책임) 에 부합. Entity 밖에서 `user.getEmail()` `user.getName()` 같은 getter 스파게티가 줄어듦.

**ArchUnit 으로 표류 방지** — 규칙이 기계 강제되어 누군가 실수로 Mapper 를 만들 수 없음. 장기 유지보수 안정성.

### 부정적 결과

**Entity 가 DTO 를 많이 알면 뚱뚱해짐** — User 가 현재 3개 DTO (`Summary`, `Profile`, `Account`). 이 숫자가 5+ 로 늘어나면 Entity 가 비대. 완화 판단:
- 3개까지는 감당 가능
- 5+ 는 **DTO 구조 재평가 시그널** — "정말로 이 5개가 다 다른 용도인가? 통합 불가?"
- 그래도 5+ 가 필요하다면 그때 Mapper 부활 여부 재검토 (현재는 안 발생)

**복잡한 매핑 (여러 Entity 조합) 표현 제약** — `AuthResponse(UserSummary + AuthTokens + DeviceInfo)` 같은 조합은 Entity 혼자 못 만듦. 해결: **Service 에서 조립**:

```java
// AuthServiceImpl
public AuthResponse signInWithEmail(SignInRequest req) {
    User user = ...;
    AuthTokens tokens = ...;
    DeviceInfo device = ...;

    // Service 에서 여러 Entity/DTO 조립
    return new AuthResponse(user.toSummary(), tokens, device.toInfo());
}
```

이건 자연스러운 Service 역할이므로 문제 아님.

**생성자 패턴 혼용 가능성** — "`new UserSummary(...)` 로 직접 만드는 게 더 빠른 경우" 가 가끔 있음 (테스트 fixture 등). 완화: 관행상 Service 코드에서는 `to<Dto>()` 우선, 테스트에서는 생성자 직접 허용. ArchUnit 이 이 구분까지 하진 않음.

### 감당 가능성 판단

단점들은 **현재 스케일 (엔티티 당 3개 내외 DTO) 에서** 실질적 문제 아님. Entity 당 5+ 로 늘면 재검토 시그널이지만, 실제 대부분 도메인에서 3개 이하로 유지됨. 장점 (호출 사이트 간결 + ArchUnit 강제 + 의존 없음) 이 압도적.

## 교훈

### `UserMapper` 실험 후 철회 사건 (2026 초반)

프로젝트 초기에는 `UserMapper` 를 썼었어요. "Spring Boot 에서는 Mapper 가 표준" 이라는 관행적 판단.

하지만 3개월 사용 후 아래 패턴이 반복되기 시작했습니다:
- 새 DTO 추가 시 `UserMapper` 에 메서드 추가
- Mapper 는 Entity 의 getter 를 모두 호출 → `user.getId()`, `user.getEmail()` 등
- Entity 는 DTO 존재를 모름 → 역방향 의존

어느 순간 "근데 왜 `user.toSummary()` 가 안 되지?" 라는 질문이 나왔어요. Mapper 의 역할이 "Entity 가 getter 를 제공 → Mapper 가 조립" 인데, 이 "조립" 이 너무 단순해서 **중간 레이어의 가치** 가 없어 보였거든요.

Item 4 에서 `UserMapper` 전체 삭제 + Entity 메서드 전환 (커밋 `e203872`). 결과:
- 코드 라인 수 **150+ 줄 감소**
- 호출 사이트 15곳 모두 간결화
- 이후 새 DTO 추가 시 Entity 의 `to<Dto>()` 추가만으로 끝

**교훈**: "관행" 은 출발점일 뿐 정답이 아닙니다. **우리 스케일에 맞는지** 주기적으로 검증해야 해요. 특히 솔로 인디에서는 **레이어 수가 적을수록** 유지보수 부담 작음.

### 외부 라이브러리 이름 충돌 (r22 설계 과정)

ArchUnit r22 초기 설계는 `*Mapper` 를 **무조건** 금지했어요. 문제: `org.springframework.web.servlet.HandlerMapping` 같은 Spring 내부 클래스도 `Mapping` / `Mapper` 로 끝나는 경우가 있고, MapStruct 를 다른 프로젝트에서 쓸 때는 `@Mapper` 인터페이스도 허용해야 함.

최종 규칙:
- `resideInAPackage("com.factory..")` → 우리 패키지만 검사 (Spring 등 외부는 제외)
- `areNotInterfaces()` → 인터페이스는 허용 (MapStruct `@Mapper interface` 대비, 비록 지금 안 쓰지만 미래 옵션)

**교훈**: ArchUnit 규칙 설계 시 **외부 라이브러리 네이밍과의 충돌** 을 고려해야 합니다. `noClasses()` 규칙이 너무 광범위하면 false positive 발생.

## 관련 사례 (Prior Art)

- **[MapStruct](https://mapstruct.org/)** — 우리가 채택하지 않은 Java 생태계 표준. annotation processor 기반 Mapper 생성.
- **[ModelMapper](http://modelmapper.org/)** — 리플렉션 기반 Mapper. 우리가 Option 2 로 검토 후 기각.
- **[Effective Java — Item 1 "Consider static factory methods instead of constructors"](https://www.oreilly.com/library/view/effective-java/9780134686097/)** — Joshua Bloch. 정적 팩토리 메서드의 장점. 우리의 `to<Dto>()` 도 이 범주.
- **Ruby on Rails `ActiveRecord::Base` 의 `as_json`, `serializable_hash`** — 엔티티가 자기 표현을 가지는 패턴. 우리와 같은 철학.
- **Kotlin 의 data class `copy()`** — 객체가 자기 변형 방법을 가진다는 원리. OOP 철학 연장선.

## Code References

**Entity `to<Dto>()` 패턴 구현**:
- [`User.java`](https://github.com/storkspear/spring-backend-template/blob/main/core/core-user-impl/src/main/java/com/factory/core/user/impl/entity/User.java) — `toSummary()`, `toProfile()`, `toAccount()` 3개 메서드

**ArchUnit r22 강제**:
- [`ArchitectureRules.java`](https://github.com/storkspear/spring-backend-template/blob/main/common/common-testing/src/main/java/com/factory/common/testing/architecture/ArchitectureRules.java) — r22 `NO_MAPPER_CLASSES`
- [`BootstrapArchitectureTest.java`](https://github.com/storkspear/spring-backend-template/blob/main/bootstrap/src/test/java/com/factory/bootstrap/BootstrapArchitectureTest.java) — r22 실제 실행

**DTO 정의** (`core-user-api`):
- [`UserSummary.java`](https://github.com/storkspear/spring-backend-template/blob/main/core/core-user-api/src/main/java/com/factory/core/user/api/dto/UserSummary.java)
- [`UserProfile.java`](https://github.com/storkspear/spring-backend-template/blob/main/core/core-user-api/src/main/java/com/factory/core/user/api/dto/UserProfile.java)
- [`UserAccount.java`](https://github.com/storkspear/spring-backend-template/blob/main/core/core-user-api/src/main/java/com/factory/core/user/api/dto/UserAccount.java)

**DTO 에서 검증/정규화 포함 static 팩토리 허용 예** (조건부 허용):
- [`core-auth-api/dto/`](https://github.com/storkspear/spring-backend-template/tree/main/core/core-auth-api/src/main/java/com/factory/core/auth/api/dto) — `AuthTokens.of()` 같은 정규화 팩토리

**관련 문서**:
- [`conventions/dto-factory.md`](https://github.com/storkspear/spring-backend-template/blob/main/docs/conventions/dto-factory.md) — 정적 팩토리 허용 규칙 상세
- [`architecture/module-dependencies.md`](https://github.com/storkspear/spring-backend-template/blob/main/docs/architecture/module-dependencies.md) — `NO_MAPPER_CLASSES` ArchUnit 규칙
