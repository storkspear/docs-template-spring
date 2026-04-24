# 첫 수정 — nickname 컬럼 추가

"뭐 하나 바꿔보고 싶다" 는 단계. 이 문서는 **`users` 테이블에 `nickname` 컬럼을 추가** 하는 **엔드투엔드 흐름** 을 따라갑니다. DB · 엔티티 · DTO · Controller · 테스트 — 한 변경이 **몇 곳** 을 건드리는지 실감할 수 있어요.

> **전제**: [`첫 실행 결과 해석`](./first-run.md) 의 부팅까지 성공 + 앱 모듈 하나 추가 (`new-app.sh sumtally`).
>
> **목표 시간**: 30 분.
>
> **배우는 것**: Flyway 마이그레이션 쓰는 법 · 엔티티와 DB 매핑 · DTO 변환 패턴 · 테스트 추가

## 변경 범위 한눈에

`users` 테이블에 `nickname VARCHAR(50)` 컬럼 하나 추가. 수정할 파일 6 곳:

1. **Flyway 마이그레이션** 새 파일 — DB 스키마 변경
2. **`User` 엔티티** — 필드 추가
3. **`UserProfile` DTO** — 응답 필드 추가
4. **`User.toProfile()` 메서드** — 변환 로직 업데이트
5. **`UpdateProfileRequest` DTO** — 입력 필드 추가 (선택)
6. **테스트 수정** — 기존 테스트에서 새 필드 반영

## 1단계 — Flyway 마이그레이션

```bash
# 파일 새로 만들기 (번호는 현재 최대 +1)
touch core/core-user-impl/src/main/resources/db/migration/core/V004__add_users_nickname.sql
```

내용:
```sql
-- V004__add_users_nickname.sql
ALTER TABLE users
    ADD COLUMN nickname VARCHAR(50);

-- index 는 조회 패턴에 따라 (필요 없으면 생략)
CREATE INDEX IF NOT EXISTS idx_users_nickname ON users(nickname)
    WHERE nickname IS NOT NULL;
```

**왜 `NOT NULL` 안 붙이나?**: 기존 유저 레코드들이 이미 있을 수 있어서. "뒤로 호환" 원칙 ([`운영 런북 (Runbook) Expand/Contract 규율`](../production/deploy/runbook.md) 참조). 필수로 만들려면 "2 단계 배포" 를 거쳐야 함.

**앱 schema 에도 반영해야 함**: `new-app.sh` 로 생성된 앱 모듈은 자기 schema 에 별개 마이그레이션이 있음. 예:
```bash
touch apps/app-sumtally/src/main/resources/db/migration/sumtally/V007__add_users_nickname.sql
```
같은 내용을 복사.

## 2단계 — `User` 엔티티

`core/core-user-impl/src/main/java/com/factory/core/user/impl/entity/User.java`:

```java
@Entity
@Table(name = "users")
public class User extends BaseEntity {

    @Column(unique = true, nullable = false)
    private String email;

    @Column(name = "password_hash")
    private String passwordHash;

    private String displayName;

    @Column(length = 50)   // ← 추가
    private String nickname;

    // ... 기존 필드들
```

**`@Column(length = 50)`**: DB 컬럼과 동일한 제약을 JPA 에도 명시. 여기서 50 자 초과 시 저장 시점에 exception.

getter 추가:
```java
public String getNickname() { return nickname; }
public void setNickname(String nickname) { this.nickname = nickname; }
```

## 3단계 — `UserProfile` DTO

`core/core-user-api/src/main/java/com/factory/core/user/api/dto/UserProfile.java`:

```java
public record UserProfile(
    long userId,
    String email,
    String displayName,
    String nickname,           // ← 추가
    boolean emailVerified,
    Instant createdAt
) {}
```

**record 사용**: 이 프로젝트의 DTO 표준 ([`ADR-016`](../philosophy/adr-016-dto-mapper-forbidden.md)). 불변 + 자동 생성 `equals/hashCode/toString`.

## 4단계 — `User.toProfile()` 메서드 업데이트

같은 `User.java` 에:

```java
public UserProfile toProfile() {
    return new UserProfile(
        getId(),
        email,
        displayName,
        nickname,          // ← 추가
        emailVerified,
        getCreatedAt()
    );
}
```

**왜 여기에?**: [`ADR-016`](../philosophy/adr-016-dto-mapper-forbidden.md) 의 결정 — **Entity 의 `to<Dto>()` 메서드** 에 변환 로직. 별도 `UserMapper` 클래스 만들면 ArchUnit r22 가 **빌드 실패**시킴.

## 5단계 — `UpdateProfileRequest` (선택 — 사용자가 수정 가능하게 하려면)

`core/core-user-api/src/main/java/com/factory/core/user/api/dto/UpdateProfileRequest.java`:

```java
public record UpdateProfileRequest(
    String displayName,
    String nickname       // ← 추가
) {}
```

그리고 `UserServiceImpl` 의 업데이트 메서드에 반영:
```java
public void updateProfile(long userId, UpdateProfileRequest req) {
    User user = userRepository.findById(userId)
        .orElseThrow(() -> new UserException(UserError.USER_NOT_FOUND));
    
    if (req.displayName() != null) user.setDisplayName(req.displayName());
    if (req.nickname() != null) user.setNickname(req.nickname());  // ← 추가
    
    // JPA 가 dirty checking 으로 자동 update
}
```

## 6단계 — 테스트

### JSON 계약 테스트 (이미 있으면 필드 확인)

`core/core-user-api/src/test/.../UserProfileJsonContractTest.java`:
```java
@Test
void serialize_includesNickname() {
    UserProfile p = new UserProfile(1L, "a@test.com", "Alice", "al1ce", true, Instant.now());
    String json = objectMapper.writeValueAsString(p);
    assertThat(json).contains("\"nickname\":\"al1ce\"");
}
```

### Port 계약 테스트

`core/core-auth-impl/src/test/.../AuthServiceImplContractTest.java` (또는 UserPort 계약 테스트) 에:
```java
@Test
void updateProfile_updatesNickname() {
    User saved = userRepository.save(testUser());
    
    userPort.updateProfile(saved.getId(), new UpdateProfileRequest(null, "new_nick"));
    
    User updated = userRepository.findById(saved.getId()).orElseThrow();
    assertThat(updated.getNickname()).isEqualTo("new_nick");
}
```

**주의**: [`ADR-014`](../philosophy/adr-014-no-delegation-mock.md) — "UserServiceImpl 이 userRepository.save 를 호출했는가" 같은 delegation mock 검증은 **금지**. Port 행위 (실제 DB 에 반영됐는가) 로만 검증.

## 7단계 — 실행

```bash
# 1. 테스트 먼저
./gradlew :core:core-user-impl:test

# 2. 전체 빌드 + ArchUnit
./gradlew build

# 3. 기동 — Flyway 가 V004 자동 실행
./gradlew bootRun
```

기동 로그에서:
```
Migrating schema "core" to version "4 - add users nickname"
Successfully applied 1 migration
```

## 8단계 — HTTP 로 확인

앱 Controller 를 통해:
```bash
# 로그인해서 토큰 받기 (생략)
TOKEN="..."

# 프로필 업데이트
curl -X PATCH http://localhost:8080/api/apps/sumtally/users/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"nickname":"new_nickname"}'

# 프로필 조회
curl http://localhost:8080/api/apps/sumtally/users/me \
  -H "Authorization: Bearer $TOKEN"

# → { "data": { "userId": 1, "nickname": "new_nickname", ... } }
```

## 이 흐름에서 배운 것

- **한 필드 추가 = 6 곳 수정** — DB (Flyway) + 엔티티 + DTO + 변환 메서드 + (옵션) 입력 DTO + 테스트
- **Flyway 는 뒤로 호환** — `NULL` 허용으로 기존 레코드 깨짐 방지
- **DTO 변환은 Entity 메서드** — `*Mapper` 클래스 만들면 ArchUnit 가 빌드 실패
- **테스트는 Port 계약 중심** — 내부 호출 검증 금지
- **ArchUnit + Flyway + 테스트** 가 전부 통과해야 `build` 가 성공

## 다음

| 다음 행동 | 문서 |
|---|---|
| 이 패턴을 깊이 이해 | [`ADR-016 · DTO Mapper 금지`](../philosophy/adr-016-dto-mapper-forbidden.md) |
| 테스트 전략 자세히 | [`Testing Strategy`](../production/test/testing-strategy.md) |
| 새 도메인 테이블 추가 | [`Migration Guides`](../api-and-functional/functional/migration.md) |
| 배포 경험해보기 | [`**배포 맛보기**`](./first-deploy.md) |
