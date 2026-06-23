# DTO 팩토리 컨벤션

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~5분

이 문서는 DTO 를 어떻게 만들고 변환할지를 정한 규약이에요. 생성자로 끝낼 자리와 팩토리 메서드가 필요한 자리를 구분하고, Entity 에서 DTO 로 바꾸는 표준 패턴을 다뤄요. 설계 근거는 [`ADR-016`](../philosophy/adr-016-dto-mapper-forbidden.md) 에 있어요.

---

## 기본 원칙

생성자가 먼저입니다. record 의 기본 생성자가 대부분의 상황을 덮어요.

```java
public record UserSummary(long id, String email, String displayName, boolean emailVerified) {}

// 사용
new UserSummary(1L, "a@b.com", "홍길동", true);
```

팩토리 메서드는 세 가지 — `from`, `of`, `with` — 만 쓰고, 각자 정해진 조건을 만족할 때만 만듭니다. builder 패턴은 쓰지 않아요. 어느 자리에 어느 메서드를 쓰는지는 아래 표로 먼저 잡고, 이어지는 절에서 하나씩 풀어요.

| 메서드 | 언제 쓰나 | 만들지 않는 경우 |
|---|---|---|
| 기본 생성자 | 대부분의 경우 | — |
| `from(X)` | 단일 DTO 를 다른 DTO 로 축소·변환할 때 | Entity 를 받는 `from`, 소스가 둘 이상 |
| `of(...)` | 입력 정규화나 검증이 들어갈 때 | 단순히 생성자를 한 번 감싸기만 할 때 |
| `with<Field>(value)` | 자주 갱신되는 필드 하나만 바꿀 때 | 모든 필드에 기계적으로 만들 때 |

---

## `from(X)` — 단일 DTO 를 변환할 때

`from` 은 소스가 **api 모듈 안의 단일 DTO** 일 때만 만들어요. Entity 를 받는 `from` 은 금지예요. api 모듈은 Entity 를 참조할 수 없기 때문이에요 (impl 에만 있는 Entity 를 api 가 보면 의존 방향이 뒤집혀요. [`ADR-003`](../philosophy/adr-003-api-impl-split.md)). 소스가 둘 이상이면 `from` 이 아니라 생성자로 받아요.

```java
// 허용 — Profile 을 Summary 로 축소하는 projection
public record UserSummary(long id, String email, String displayName, boolean emailVerified) {
    public static UserSummary from(UserProfile profile) {
        return new UserSummary(
                profile.id(), profile.email(), profile.displayName(), profile.emailVerified());
    }
}
```

금지되는 형태는 두 가지예요.

- Entity 를 받는 `from` — `public static UserSummary from(User entity)` 는 api 가 impl 의 Entity 를 참조하게 되어 컴파일 경계를 깨요. Entity 변환은 아래 [Entity 변환 절](#entity-에서-dto-로-entity-메서드-패턴) 의 `to<Dto>()` 로 해요.
- 소스가 둘 이상인 `from` — `from(UserSummary user, AuthTokens tokens)` 처럼 여러 소스를 묶는 건 생성자의 일이에요. 실제로 `AuthResponse` 는 이 경우를 `from` 이 아니라 보조 생성자로 처리해요.

```java
// AuthResponse.java 발췌 — 여러 소스 조합은 생성자로
public record AuthResponse(UserSummary user, AuthTokens tokens, String devVerificationToken,
        String twoFactorToken) {

    public AuthResponse(UserSummary user, AuthTokens tokens) {
        this(user, tokens, null, null);
    }
}
```

---

## `of(...)` — 정규화나 검증이 있을 때

`of` 는 입력을 다듬거나 검증할 때만 만들어요. 생성자를 그대로 한 번 감싸기만 하는 `of` 는 가치가 없어서 만들지 않아요.

```java
// 허용 — 정규화 + 검증을 거쳐 만든다
public record Email(String value) {
    public static Email of(String raw) {
        String normalized = raw.trim().toLowerCase();
        if (!normalized.matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")) {
            throw new IllegalArgumentException("Invalid email: " + raw);
        }
        return new Email(normalized);
    }
}
```

다음은 만들지 않아요. 생성자와 하는 일이 같아서 이름만 늘어나요.

```java
// 금지 — 단순 생성자 대체
public static AuthTokens of(String access, String refresh) {
    return new AuthTokens(access, refresh);
}
```

다만 web 계층의 공용 응답 DTO 처럼, 같은 타입을 아주 많은 호출 사이트에서 만들고 일부 인자를 생략하는 오버로드를 제공할 때는 `of` 가 가독성을 높이기도 해요 (`ApiError.of(code, message)`, `PageRequest.of(page, size)`). 이건 "도메인 DTO 의 단순 래퍼" 와는 성격이 달라서 예외로 둬요. 새 도메인 DTO 를 만들 때는 위의 기준 — 정규화·검증이 있을 때만 — 을 따라요.

---

## `with<Field>(value)` — 자주 바뀌는 필드만

record 는 불변이라 필드 하나를 바꾸려면 새 인스턴스를 만들어야 해요. 자주 갱신되는 필드에 한해 `with<Field>` 를 손으로 만들어요. 모든 필드에 기계적으로 만들지는 않아요.

```java
// 허용 — displayName 갱신이 잦아 하나만 만든다
public record UserProfile(
        long id, String email, String displayName, String nickname, boolean emailVerified,
        boolean isPremium, String role, Instant createdAt, Instant updatedAt) {

    public UserProfile withDisplayName(String newName) {
        return new UserProfile(
                id, email, newName, nickname, emailVerified, isPremium, role, createdAt, updatedAt);
    }
}
```

피해야 할 두 가지가 있어요.

- 전체 필드에 wither 를 기계적으로 생성 — 안 쓰는 wither 가 늘면 변경 표면만 넓어져요.
- Lombok `@With` 도입 — record 에 추가 어노테이션 프로세서를 끌어오는 건 별도 결정이 필요해서, 지금은 손으로 작성해요.

---

## Builder 패턴을 쓰지 않는 이유

record 는 생성자만으로 충분해서 builder 를 두지 않아요. builder 가 필요해 보이는 상황은 보통 다른 신호예요.

- 필드가 많아 생성자 가독성이 떨어지면 → builder 가 아니라 **DTO 를 분할** 해요 (composition).
- 필수 필드와 선택 필드가 섞여 있으면 → `of` 팩토리로 처리해요.

---

## Entity 에서 DTO 로 — Entity 메서드 패턴

별도 Mapper 클래스를 두지 않아요. Entity 가 자기 표현 방법을 직접 메서드로 제공해요. "엔티티가 자기를 가장 잘 안다" 는 원칙이고, [`ADR-016`](../philosophy/adr-016-dto-mapper-forbidden.md) 의 핵심 결정이에요.

```java
// core-user-impl/.../entity/User.java 발췌
@Entity
@Table(name = "users")
public class User extends BaseEntity {
    // ... JPA 필드 ...

    public UserSummary toSummary() {
        return new UserSummary(getId(), email, displayName, emailVerified);
    }

    public UserProfile toProfile() {
        return new UserProfile(
                getId(), email, displayName, nickname, emailVerified,
                isPremium, role, getCreatedAt(), getUpdatedAt());
    }

    public UserAccount toAccount() {
        return new UserAccount(getId(), email, displayName, passwordHash, emailVerified, role);
    }
}
```

Entity 가 impl 모듈에, DTO 가 api 모듈에 있고, 변환은 impl → api 방향이라 의존 규칙에 맞아요.

### Service 에서 쓰는 모습

Service 는 Entity 를 조회한 뒤 변환 메서드를 바로 이어 붙여요.

```java
public UserSummary getSummary(long id) {
    return repo.findById(id)
            .orElseThrow(() -> UserException.notFound(id))
            .toSummary();
}
```

`UserMapper` 같은 별도 클래스를 주입해 `mapper.toSummary(...)` 로 변환하는 방식은 쓰지 않아요. 이건 아래 [ArchUnit 강제](#archunit-가-막아주는-것) 절의 r22 가 빌드 시점에 차단해요.

### 왜 Mapper 를 두지 않나

네 가지 이유가 맞물려요.

- 현재 매핑이 거의 1:1 필드 복사라, Mapper 가 내세우는 "복잡 매핑 격리" 의 실익이 없어요.
- Entity 메서드면 의존이 하나 줄고 (`user.toSummary()`) 호출 사이트가 짧아져요.
- 솔로 규모라 Mapper 가 막아주는 "여러 사람이 제각각 매핑을 작성하는" 문제가 없어요.
- 도메인당 DTO 3~5개 정도는 Entity 비대화 없이 감당돼요.

대신 한 가지 trade-off 가 있어요. 나중에 Port 를 별도 모듈로 추출하면 Port 는 DTO 만 노출하므로, Entity 를 교체할 때 `to<Dto>()` 메서드를 다시 써야 해요. 지금 규모에서는 받아들일 수 있는 비용이에요.

### 매핑에 로직이 섞일 때

변환에 조건 분기, 기본값 채우기(coalesce), 추가 데이터 결합(enrichment) 이 들어가도 원칙은 같아요.

- 한 Entity 안에서 끝나는 로직이면 여전히 그 Entity 의 메서드에 두되, 길어지면 private helper 로 쪼개요.
- 여러 Entity 를 조합해야 하면 Service 안에서 조립해요. 이때도 별도 Mapper 클래스를 만들지 않아요.

여러 Entity 를 묶는 복잡 매핑의 예예요. 각 Entity 는 자기 `to<Dto>()` 를 제공하고, Service 가 그 결과를 조립해요.

```java
public DetailedProfile getDetailedProfile(long userId) {
    User user = repo.findById(userId).orElseThrow(() -> UserException.notFound(userId));
    List<DeviceDto> devices = deviceService.findByUser(userId);

    return new DetailedProfile(user.toSummary(), devices);
}
```

> Entity 메서드로 변환할지, Service 의 private helper 로 변환할지는 "변환에 그 Entity 만으로 충분한가" 로 갈려요. `User` 처럼 자기 필드만으로 DTO 가 완성되면 Entity 메서드(`user.toSummary()`)가 자연스럽고, 변환에 Service 가 가진 다른 의존이 필요하면 Service 안의 private helper 로 두는 편이 맞아요. 둘 다 Mapper 클래스를 만들지 않는다는 점은 같아요.

### Entity 가 뚱뚱해지는 걸 막기

Entity 하나가 DTO 를 여러 종류 표현하면 `to<Dto>()` 메서드가 늘어나요.

- 현재 최대는 `User` 의 3개예요 (`toSummary`, `toProfile`, `toAccount`). 이 정도는 감당돼요.
- 한 Entity 가 5개를 넘기 시작하면 DTO 구조를 다시 볼 신호예요. 이때도 해법은 Mapper 부활이 아니라 DTO 재설계예요.

---

## ArchUnit 가 막아주는 것

`*Mapper` 로 끝나는 public 클래스(인터페이스 제외) 를 만들면 ArchUnit r22 (`NO_MAPPER_CLASSES`) 가 빌드 시점에 실패시켜요. 규칙은 `com.factory..` 전 패키지에 적용돼요. 전체 규칙 목록은 [`Architecture Rules (ArchUnit)`](../structure/architecture-rules.md) 와 [`module-dependencies.md`](../structure/module-dependencies.md) 를 참고하세요.

---

## 체크리스트

### 새 DTO 를 추가할 때

- [ ] record 로 작성했는가
- [ ] Request DTO 라면 validation 어노테이션을 붙였는가
- [ ] 접미사 규약을 따랐는가 ([`naming.md`](./naming.md))
- [ ] 생성자로 충분한지 확인했는가 — 굳이 팩토리 메서드를 만들지 않기

### 새 팩토리 메서드를 추가할 때

- [ ] `from(X)` — X 가 단일 DTO 인가, Entity 가 아닌가
- [ ] `of(...)` — 정규화나 검증을 포함하는가, 단순 생성자 대체는 아닌가
- [ ] `with<Field>(value)` — 자주 갱신되는 필드만인가

### 새 Entity 를 추가할 때

- [ ] 필요한 변환 메서드(`to<Dto>()`) 를 Entity 에 추가했는가
- [ ] Mapper 클래스를 만들지 않았는가 (ArchUnit r22)

---

## 관련 문서

- [`Naming Conventions`](./naming.md) — DTO 네이밍·접미사 규칙
- [`record vs class 선택 기준`](./records-and-classes.md) — record 와 class 의 선택 기준
- [`JSON 계약 규약`](../api-and-functional/api/json-contract.md) — JSON 직렬화 정책
- [`Architecture Rules (ArchUnit)`](../structure/architecture-rules.md) — r22 (`NO_MAPPER_CLASSES`)
- [`ADR-003 · -api / -impl 분리`](../philosophy/adr-003-api-impl-split.md) — Port 가 DTO 만 반환하는 경계의 근거
- [`ADR-011 · 레이어드 + 포트/어댑터`](../philosophy/adr-011-layered-port-adapter.md) — 변환이 일어나는 계층 위치
- [`ADR-016 · DTO 변환은 Entity 메서드로`](../philosophy/adr-016-dto-mapper-forbidden.md) — Mapper 금지 설계 근거
