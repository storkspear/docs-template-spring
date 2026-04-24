# DTO 팩토리 컨벤션

이 문서는 DTO 의 생성·변환 패턴 규약을 정의합니다.

---

## 기본 원칙

**생성자 우선.** record 생성자가 대부분의 경우 충분합니다.

```java
public record UserSummary(long id, String email, String displayName, boolean emailVerified) {}

// 사용:
new UserSummary(1L, "a@b.com", "홍길동", true);
```

팩토리 메서드(`from`/`of`/`with`) 는 특정 조건에서만 사용. builder 패턴은 **금지**.

---

## `from(X)` — DTO → DTO 단일 소스 변환

**허용 조건**:
- 소스가 **단일 DTO** (또는 api 모듈 내 다른 DTO)
- Entity 를 받는 `from` 은 **절대 금지** (api 는 Entity 를 참조할 수 없음 — Item 2 규칙 9, 11)

```java
// ✓ 허용 — Profile → Summary 축소 projection
public record UserSummary(long id, String email, String displayName, boolean emailVerified) {
    public static UserSummary from(UserProfile profile) {
        return new UserSummary(
            profile.id(), profile.email(), profile.displayName(), profile.emailVerified()
        );
    }
}

// ✗ 금지 — Entity → DTO (Entity 는 impl 모듈, api 가 참조 불가)
// public static UserSummary from(User entity) { ... }

// ✗ 금지 — 여러 소스
// public static AuthResponse from(UserSummary user, AuthTokens tokens) { ... }
```

---

## `of(...)` — 정규화/validation 포함 시만

**허용 조건**: 단순 생성자 대체 **금지**. 입력 정규화 또는 검증 로직을 포함할 때만.

```java
// ✓ 허용 — 정규화 필요
public record Email(String value) {
    public static Email of(String raw) {
        String normalized = raw.trim().toLowerCase();
        if (!normalized.matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")) {
            throw new IllegalArgumentException("Invalid email: " + raw);
        }
        return new Email(normalized);
    }
}

// ✗ 금지 — 단순 생성자 대체 (가치 없음)
// public static AuthTokens of(String access, String refresh) {
//     return new AuthTokens(access, refresh);
// }
```

---

## `with<Field>(value)` — 필드별 수동 작성

**허용 조건**: 자주 업데이트되는 필드만. **전체 wither 자동화 금지**.

```java
// ✓ 허용 — displayName 갱신이 자주 쓰임
public record UserProfile(
    long id, String email, String displayName, boolean emailVerified,
    boolean isPremium, String role, Instant createdAt, Instant updatedAt
) {
    public UserProfile withDisplayName(String newName) {
        return new UserProfile(id, email, newName, emailVerified, isPremium, role, createdAt, updatedAt);
    }
}

// ✗ 금지 — 모든 필드 wither 기계적 생성
// ✗ 금지 — Lombok @With 도입 (별도 결정 필요)
```

---

## Builder 패턴 — 금지

- record 는 생성자로 충분
- 필드가 많아 가독성 이슈 → **DTO 분할** (composition), builder 아님
- 필수 + 선택 필드 혼합 → `of` 팩토리로 처리

---

## Entity → DTO 변환 — Entity 메서드 (Mapper 클래스 금지)

**Mapper 클래스 폐기**. Entity 가 자기 표현 방법을 직접 제공:

```java
// core-<x>-impl/src/main/java/.../entity/User.java
@Entity
@Table(name = "users")
public class User extends BaseEntity {
    // ... JPA 필드 ...

    public UserSummary toSummary() {
        return new UserSummary(getId(), email, displayName, emailVerified);
    }

    public UserProfile toProfile() {
        return new UserProfile(getId(), email, displayName, emailVerified,
            isPremium, role, getCreatedAt(), getUpdatedAt());
    }

    public UserAccount toAccount() {
        return new UserAccount(getId(), email, displayName, passwordHash, emailVerified, role);
    }
}
```

### Service 에서 사용

```java
// ✓ Entity 메서드 패턴
public UserSummary getSummary(long id) {
    return repo.findById(id)
        .orElseThrow(() -> UserException.notFound(id))
        .toSummary();
}

// ✗ 금지 — Mapper 클래스
// private final UserMapper mapper;  // → ArchUnit 규칙 22 위반
// return mapper.toSummary(repo.findById(id).orElseThrow(...));
```

### 왜 Mapper 를 폐기하는가

1. 현재 매핑이 전부 1:1 — Mapper 클래스가 제공하는 "격리 가치" 실체 없음
2. Entity 메서드로 충분 — 의존 하나 줄고 호출 사이트 읽기 쉬움
3. 솔로 규모 — Mapper 가 막아주는 "팀 간 분산 작성" 이슈 부재
4. 도메인당 DTO 3~5개는 Entity 비대화 없이 감당 가능

### 아키텍처적 정당성

| 검사 | 결과 |
|---|---|
| Entity (impl) 가 DTO (api) 참조 | ✓ 허용 (impl → api 방향, Item 2 규칙 부합) |
| Entity → DTO 변환 단일 소스 | ✓ Entity 클래스 하나에 집중 |
| 포트 추출 시 영향 | ✗ Port 는 DTO 만 노출. Entity 교체 시 메서드 재작성 |

### 복잡한 매핑의 처리

**매핑에 로직 포함 시** (조건, coalesce, enrichment):
- 여전히 Entity 메서드에 두되 private helper 로 분할
- 여러 Entity 조합 필요 시 → Service 내부에서 조립 (Mapper 클래스 없이)

```java
// 복잡 매핑은 Service 에서 조립
public DetailedProfile getDetailedProfile(long userId) {
    User user = repo.findById(userId).orElseThrow(...);
    List<Device> devices = deviceRepo.findByUserId(userId);

    return new DetailedProfile(
        user.toSummary(),                           // Entity 메서드 활용
        devices.stream().map(Device::toDto).toList()
    );
}
```

### Entity 비대화 억제

- Entity 하나가 DTO 5+ 종류 표현하면 `to<Dto>` 메서드가 뚱뚱해짐
- **현재 max**: `User` → 3개 (Summary, Profile, Account). 감당 가능.
- 미래에 5+ 초과 시 **DTO 구조 재평가** 시그널. Mapper 부활이 아니라 DTO 재설계.

---

## ArchUnit 강제

`*Mapper` 이름의 공개 클래스 생성은 **ArchUnit 규칙 22** 로 금지. 자세한 규칙은 `module-dependencies.md` 참조.

---

## 체크리스트

### 새 DTO 추가
- [ ] record 로 작성
- [ ] Request DTO 는 validation 어노테이션
- [ ] 접미사 규약 준수 (`naming.md`)
- [ ] 생성자로 충분한지 확인 — 굳이 팩토리 메서드 안 만들기

### 새 팩토리 메서드 추가 시
- [ ] `from(X)` — X 가 단일 DTO 인가? Entity 는 아닌가?
- [ ] `of(...)` — 정규화/validation 포함하는가? 단순 생성자 대체 아닌가?
- [ ] `with*(value)` — 자주 쓰이는 필드만인가?

### 새 Entity 추가 시
- [ ] 필요한 DTO 변환 메서드 (`to<Dto>()`) 를 Entity 에 추가
- [ ] Mapper 클래스 만들지 않음 (ArchUnit 규칙 22)

---

## 관련 문서

- [`conventions/naming.md`](./naming.md) — DTO 네이밍 규칙
- [`conventions/records-and-classes.md`](./records-and-classes.md) — record vs class 선택 기준
- [`api-contract/json-contract.md`](../api-and-functional/api/json-contract.md) — JSON 직렬화 정책
- [ADR-003 · -api / -impl 분리](../philosophy/adr-003-api-impl-split.md)
- [ADR-011 · 레이어드 + 포트/어댑터](../philosophy/adr-011-layered-port-adapter.md)
- [ADR-016 · DTO Mapper 금지](../philosophy/adr-016-dto-mapper-forbidden.md)
