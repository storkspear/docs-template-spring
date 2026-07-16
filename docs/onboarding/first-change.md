# 첫 코드 변경 — 한 필드가 코드 여러 곳에 닿는 경험

> **유형**: How-to · **독자**: Level 0~1 · **읽는 시간**: ~15분

"코드를 한 줄 바꿔보고 싶다" 는 단계예요. 이 문서는 `users` 테이블의 `nickname` 필드를 따라가며, 한 필드가 DB부터 HTTP 응답까지 코드의 **어느 자리들** 에 닿는지 손으로 짚어 봐요. 따라 하고 나면 이 레포의 한 변경이 어떤 흐름으로 퍼지는지 — 마이그레이션, 엔티티, DTO, 변환 메서드, 테스트 — 가 그림으로 잡혀요.

> **이 필드는 이미 코드에 들어 있어요.** `nickname` 은 `new-app.sh` 가 만드는 첫 마이그레이션(`V001__init_users.sql`)의 `users` 테이블에 처음부터 포함돼 있고, `User` 엔티티 · `UserProfile` · `UpdateProfileRequest` 에도 모두 반영돼 있어요. 그래서 이 문서는 "지금 추가하라" 가 아니라 *이미 들어간 필드를 거꾸로 따라가며 패턴을 익히는* 가이드예요. 익힌 다음에는 본인 필드(예: `bio`, `avatar_url`)를 **똑같은 자리들에** 더하면 돼요.

> **전제** — [`첫 실행 결과 해석`](./first-run.md) 까지 읽었고, 앱 모듈을 하나 추가한 상태(`<repo> new <slug>`)예요. 앱이 없으면 Spring 이 부팅되지 않아([`ADR-037`](../philosophy/adr-037-core-schema-deprecation.md)) 변경을 눈으로 확인할 수 없어요. 앱 추가는 [`Onboarding §3`](../start/onboarding.md#3-첫-앱-모듈-추가) 을 보세요.
>
> **배우는 것** — Flyway 마이그레이션의 자리, 엔티티와 DB 컬럼의 매핑, DTO 변환을 어디서 하는지, 테스트는 무엇을 검증하는지.

처음 보는 용어가 나오면 [`용어 사전`](../reference/glossary.md) 에서 바로 찾아볼 수 있어요. 이 문서에서 자주 나오는 것만 미리 짚어 둘게요.

- [`JPA Entity`](../reference/glossary.md#데이터베이스) — `@Entity` 클래스가 DB 테이블과 매핑되는 패턴이에요.
- [`Flyway`](../reference/glossary.md#데이터베이스) — `V001__init.sql` 같은 SQL 파일을 번호 순서대로 한 번씩 실행하는 마이그레이션 도구예요.
- [`DTO`](../reference/glossary.md#코드-패턴) — 계층 사이를 오가는 데이터 전송 객체예요. 이 레포는 `record` 로 선언해요.
- [`DTO Factory`](../reference/glossary.md#코드-패턴) — DTO 를 엔티티의 메서드(`user.toProfile()`)로 만드는 패턴이에요. 별도 Mapper 클래스를 두지 않아요([`ADR-016`](../philosophy/adr-016-dto-mapper-forbidden.md)).
- [`@Column`](../reference/glossary.md#spring-어노테이션--런타임) · [`@MappedSuperclass`](../reference/glossary.md#spring-어노테이션--런타임) — 필드를 DB 컬럼에 매핑하는 어노테이션과, 공통 필드를 담는 부모 클래스(`BaseEntity`)예요.

## 한 필드가 닿는 자리들

`nickname` 한 필드가 코드에 살아 있으려면 **여섯 자리** 가 맞물려야 해요. 아래 흐름이 이 문서의 전체 지도예요.

```
DB 마이그레이션 (V001 의 users 테이블)
   ↓  컬럼이 있어야
User 엔티티 — nickname 필드 + updateNickname() 도메인 메서드
   ↓  엔티티가 알아야
User.toProfile() — 응답 DTO 로 옮겨 담기
   ↓  내보내려면
UserProfile DTO — HTTP 응답에 실리는 필드
   ↓  입력도 받으려면
UpdateProfileRequest DTO + UserServiceImpl.updateProfile()
   ↓  깨지지 않도록
테스트 — JSON 계약 + Port 계약
```

| # | 자리 | 파일 | 하는 일 |
|---|---|---|---|
| 1 | DB 컬럼 | `V001__init_users.sql` | `nickname` 컬럼 정의 |
| 2 | 엔티티 | `User.java` | `nickname` 필드 + `updateNickname()` 도메인 메서드 |
| 3 | 응답 DTO | `UserProfile.java` | 조회 응답에 실리는 필드 |
| 4 | 변환 메서드 | `User.toProfile()` | 엔티티 → 응답 DTO 로 옮겨 담기 |
| 5 | 입력 DTO + 서비스 | `UpdateProfileRequest.java` · `UserServiceImpl.java` | 수정 요청을 받아 엔티티에 반영 |
| 6 | 테스트 | `UserProfileJsonTest` · `AbstractUserPortContractTest` | 직렬화·행위 계약 고정 |

이제 1번부터 한 자리씩 따라가요. 본인 필드를 더할 때도 *바로 이 여섯 자리* 에 같은 식으로 손대면 돼요.

## 1. DB 컬럼 — 마이그레이션

가장 먼저 DB에 컬럼이 있어야 엔티티가 그 컬럼을 읽고 쓸 수 있어요. 이 레포는 SQL을 직접 실행하지 않고 [`Flyway`](../reference/glossary.md#데이터베이스) 마이그레이션 파일로 스키마를 관리해요. 앱마다 `db/migration/<slug>/` 디렉토리에 `V001`, `V002`… 번호 순서로 파일이 쌓이고, 부팅할 때 새 번호만 한 번씩 실행돼요.

`nickname` 은 `new-app.sh` 가 만드는 **첫 마이그레이션** 인 `V001__init_users.sql` 의 `users` 테이블 정의 안에 처음부터 들어 있어요.

```sql
-- apps/app-<slug>/src/main/resources/db/migration/<slug>/V001__init_users.sql 발췌
CREATE TABLE users (
    id              BIGSERIAL PRIMARY KEY,
    email           VARCHAR(255) NOT NULL,
    password_hash   VARCHAR(255),
    display_name    VARCHAR(30),
    nickname        VARCHAR(50),   -- ← 여기. displayName 옆의 자유 별명
    email_verified  BOOLEAN NOT NULL DEFAULT false,
    ...
);
```

`nickname` 에 `NOT NULL` 이 없는 게 핵심이에요. `displayName` 은 가입 때 정해지는 필수 값이지만, `nickname` 은 사용자가 나중에 자유롭게 채우는 선택 값이라 빈 칸(NULL)을 허용해요.

**본인 필드를 추가한다면** — `nickname` 처럼 이미 만들어진 테이블에 *나중에* 컬럼을 더할 때는, `V001` 을 고치는 게 아니라 **다음 비어 있는 번호로 새 파일** 을 만들어요. 이미 실행된 마이그레이션 파일을 수정하면 [`Checksum`](../reference/glossary.md#데이터베이스) 이 어긋나 부팅이 막히거든요([`흔한 에러 §6.5`](../start/onboarding.md#65-flyway-checksum-mismatch)).

```sql
-- 예: apps/app-<slug>/.../db/migration/<slug>/V026__add_users_bio.sql
ALTER TABLE users ADD COLUMN bio VARCHAR(200);
```

`new-app.sh` 가 깔아 주는 번호는 V001~V025 까지 차 있어요 (V007 은 `--seed-admin` 을 붙였을 때만 생성되는 admin 시드 자리예요). 정확한 번호 배치는 [`Onboarding §3.1`](../start/onboarding.md#31-코드-골격-자동) 의 마이그레이션 표를 보세요. 본인 컬럼은 보통 **그다음 비어 있는 번호**(현재 V026)로 더하면 돼요.

> **왜 `NOT NULL` 을 함부로 못 붙이나** — 운영 DB에는 이미 가입한 사용자 레코드가 있어요. 새 필수 컬럼을 한 번에 강제하면 기존 레코드가 위반돼 마이그레이션이 깨져요. 그래서 "먼저 nullable 로 추가 → 값 채우기 → 나중에 NOT NULL" 의 단계적 배포를 써요. 자세한 규율은 [`운영 런북`](../production/deploy/runbook.md) 에 있어요.

## 2. 엔티티 — `User`

DB에 컬럼이 생겼으니, 이제 자바 코드가 그 컬럼을 읽고 쓸 통로가 필요해요. 그 통로가 [`JPA Entity`](../reference/glossary.md#데이터베이스) 예요. `@Entity` 가 붙은 클래스의 필드 하나가 테이블 컬럼 하나에 대응해요.

```java
// core/core-user-impl/src/main/java/com/factory/core/user/impl/entity/User.java 발췌
@Entity
@Table(name = "users")
public class User extends BaseEntity {

    @Column(name = "display_name", length = 30)
    private String displayName;

    @Column(name = "nickname", length = 50)   // ← DB 컬럼과 짝
    private String nickname;

    // ...
}
```

`@Column(name = "nickname", length = 50)` 이 V001 의 `nickname VARCHAR(50)` 과 짝을 이뤄요. `length = 50` 으로 DB 제약을 자바 쪽에도 명시해서, 50자를 넘기면 저장하는 시점에 막혀요.

엔티티가 값을 바꾸는 방식도 이 레포의 약속이 있어요. 흔한 `setNickname()` 대신 **의도가 드러나는 도메인 메서드** 를 둬요.

```java
// User.java 발췌 — setter 대신 도메인 메서드
public String getNickname() {
    return nickname;
}

public void updateNickname(String newNickname) {
    this.nickname = newNickname;
}
```

조회용 `getNickname()` 은 두되, 변경은 `updateNickname()` 처럼 "무슨 일을 하는지" 가 이름에 담긴 메서드로 해요. 단순 `set` 보다 호출부에서 의도가 분명해져요.

## 3. 응답 DTO — `UserProfile`

엔티티는 `core-*-impl` 안에만 머물고, 바깥(HTTP 응답)으로는 [`DTO`](../reference/glossary.md#코드-패턴) 만 나가요. 프로필 조회·수정 응답에 실리는 DTO가 `UserProfile` 이에요. 이 레포의 DTO는 모두 `record` 로 선언해요([`ADR-016`](../philosophy/adr-016-dto-mapper-forbidden.md)) — 불변이고, `equals` · `hashCode` · `toString` 이 자동으로 생겨요.

```java
// core/core-user-api/src/main/java/com/factory/core/user/api/dto/UserProfile.java 전체
public record UserProfile(
        long id,
        String email,
        String displayName,
        String nickname,        // ← 응답에 실리는 필드
        boolean emailVerified,
        boolean isPremium,
        String role,
        Instant createdAt,
        Instant updatedAt) {}
```

`nickname` 을 record의 컴포넌트로 한 줄 더한 게 전부예요. 본인 필드를 응답에 내보내고 싶을 때도 여기에 컴포넌트를 한 줄 추가해요.

## 4. 변환 메서드 — `User.toProfile()`

엔티티의 `nickname` 값을 `UserProfile` 로 옮겨 담는 자리예요. 이 레포는 **별도 Mapper 클래스를 만들지 않고** 엔티티 안의 `to<Dto>()` 메서드에서 변환해요([`ADR-016`](../philosophy/adr-016-dto-mapper-forbidden.md)). 그래서 `UserProfile` 에 필드를 더했으면, `toProfile()` 의 생성자 인자에도 같은 자리를 채워야 해요.

```java
// User.java 발췌 — DTO 변환은 엔티티 메서드에서
public UserProfile toProfile() {
    return new UserProfile(
            getId(),
            email,
            displayName,
            nickname,          // ← UserProfile 의 nickname 자리로
            emailVerified,
            isPremium,
            role,
            getCreatedAt(),
            getUpdatedAt());
}
```

`getId()` · `getCreatedAt()` · `getUpdatedAt()` 은 부모 `BaseEntity` 가 주는 공통 메서드예요([`@MappedSuperclass`](../reference/glossary.md#spring-어노테이션--런타임), [`ADR-009`](../philosophy/adr-009-base-entity.md)).

> **왜 Mapper 클래스를 금지하나** — `UserMapper.toDto(user)` 같은 별도 클래스를 만들면 그 클래스가 엔티티와 DTO 양쪽을 다 알아야 해서 변경 추적이 흩어져요. 변환 로직을 엔티티 안에 두면 필드를 더할 때 한 파일에서 끝나요. 이 약속은 ArchUnit 규칙 r22(`NO_MAPPER_CLASSES`)가 빌드 시점에 강제해요 — 이름이 `Mapper` 로 끝나는 클래스를 만들면 `build` 가 실패해요([`architecture-rules §r22`](../structure/architecture-rules.md#r22-no_mapper_classes)).

## 5. 입력 DTO + 서비스 — 값을 받아 반영

여기까지는 *읽어서 내보내는* 흐름이었어요. 사용자가 `nickname` 을 *수정* 할 수 있게 하려면 입력을 받을 DTO와 그 입력을 엔티티에 반영하는 서비스가 필요해요.

입력 DTO는 `UpdateProfileRequest` 예요. 길이 제약은 `@Size` 어노테이션으로 검증해요.

```java
// core/core-user-api/src/main/java/com/factory/core/user/api/dto/UpdateProfileRequest.java 전체
public record UpdateProfileRequest(
        @Size(max = 30, message = "displayName 은 30자 이하여야 합니다") String displayName,
        @Size(max = 50, message = "nickname 은 50자 이하여야 합니다") String nickname) {}
```

서비스는 `UserServiceImpl.updateProfile()` 이에요. 들어온 필드 중 `null` 이 아닌 것만 반영하는 PATCH 방식이라, 보내지 않은 필드는 기존 값을 그대로 둬요.

```java
// core/core-user-impl/src/main/java/com/factory/core/user/impl/UserServiceImpl.java 발췌
@Override
public UserProfile updateProfile(long userId, UpdateProfileRequest request) {
    User user = findActiveUser(userId);
    if (request.displayName() != null) {
        user.updateDisplayName(request.displayName());
    }
    if (request.nickname() != null) {
        user.updateNickname(request.nickname());   // ← 2단계의 도메인 메서드
    }
    return user.toProfile();                        // ← 4단계의 변환 메서드
}
```

세 가지를 눈여겨봐요. 사용자 조회는 직접 `findById` 하지 않고 `findActiveUser()` 헬퍼를 거쳐요 — soft-delete 된 사용자를 걸러 주거든요. 변경은 2단계의 `updateNickname()` 으로, 응답은 4단계의 `toProfile()` 로 만들어요. 그리고 이 메서드는 `@Transactional` 안에서 도니까, 엔티티 필드를 바꾸기만 해도 [`Hibernate`](../reference/glossary.md#데이터베이스) 의 dirty checking 이 트랜잭션이 끝날 때 자동으로 `UPDATE` 를 날려요. `userRepository.save()` 를 따로 부르지 않아요.

이 서비스를 HTTP로 노출하는 컨트롤러는 `UserController` 예요. 엔드포인트는 `GET /api/apps/<slug>/users/me`(조회)와 `PATCH /api/apps/<slug>/users/me`(수정) 두 개고, 응답은 `ApiResponse.ok(...)` 로 감싸 나가요. 컨트롤러는 `UserPort` 만 호출하고 DB에 직접 닿지 않아요 — 이 경계는 [`Architecture Reference`](../structure/architecture.md) 에서 더 다뤄요.

## 6. 테스트 — 두 계약을 고정

마지막 자리는 테스트예요. 필드를 더했으면 두 가지를 테스트로 못박아요. 응답 JSON의 모양(직렬화 계약)과, 입력이 실제 DB에 반영되는 행위(Port 계약)예요.

### JSON 계약 테스트

`UserProfileJsonTest` 는 `UserProfile` 의 직렬화 결과를 정규화된 JSON 문자열과 글자 단위로 비교해요. 필드 이름이 바뀌거나 빠지면 바로 깨지죠.

```java
// core/core-user-api/src/test/java/com/factory/core/user/api/dto/UserProfileJsonTest.java 발췌
class UserProfileJsonTest extends AbstractJsonContractTest<UserProfile> {

    @Override
    protected UserProfile sample() {
        return new UserProfile(
                1L, "a@b.com", "홍길동", "kingoo",   // ← nickname 샘플
                true, false, "USER",
                Instant.parse("2026-04-01T00:00:00Z"),
                Instant.parse("2026-04-15T12:00:00Z"));
    }

    @Override
    protected String canonicalJson() {
        return """
            {"id":1,"email":"a@b.com","displayName":"홍길동","nickname":"kingoo",\
            "emailVerified":true,"isPremium":false,"role":"USER",\
            "createdAt":"2026-04-01T00:00:00Z","updatedAt":"2026-04-15T12:00:00Z"}
            """;
    }
}
```

### Port 계약 테스트

`AbstractUserPortContractTest` 는 `UserPort` 가 *실제로 어떻게 동작하는지* 를 검증해요. `nickname` 수정 케이스는 이렇게 생겼어요 — 수정한 뒤 다시 조회해서 값이 정말 바뀌었는지 봐요.

```java
// core/core-user-api/.../contract/AbstractUserPortContractTest.java 발췌
@Test
void updatesNickname_whenValidRequest() {
    long userId = fixtures().createVerifiedUser("n@test.com", "hash", "user");
    UpdateProfileRequest request = new UpdateProfileRequest(null, "별명");

    UserProfile result = port().updateProfile(userId, request);

    assertThat(result.nickname()).isEqualTo("별명");
    assertThat(port().getProfile(userId).nickname()).isEqualTo("별명");   // ← 다시 조회해 확인
}
```

이 추상 테스트를 `UserServiceImplContractTest` 가 [`Testcontainers`](../reference/glossary.md#테스팅) 진짜 Postgres 위에서 상속·실행해요.

> **무엇을 검증하고, 무엇을 검증하지 않나** — "`UserServiceImpl` 이 `userRepository.save()` 를 호출했는가" 같은 내부 호출 확인([`Delegation Mock`](../reference/glossary.md#테스팅))은 이 레포에서 금지예요([`ADR-014`](../philosophy/adr-014-no-delegation-mock.md)). 검증은 "수정 후 다시 조회하니 값이 바뀌어 있다" 처럼 *결과 상태* 로만 해요. 내부 구현이 바뀌어도 동작이 같으면 테스트는 통과해야 하니까요.

## 직접 돌려서 확인하기

여섯 자리를 다 봤으니, 본인 필드를 더한 뒤 전부 맞물려 도는지 확인하는 흐름이에요. 명령은 `<repo>` 자리에 본인 레포 이름(또는 설치 때 정한 별칭)을 넣어요.

```bash
# 1. 코드 변경 후 빌드 — ArchUnit r22(Mapper 금지) 포함 전 규칙 + 테스트 검증
./gradlew build

# 2. spring 컨테이너만 재빌드·재기동 — 새 코드 반영 (다른 컨테이너는 유지)
<repo> restart

# 3. spring 이 떴는지 종합 검증
<repo> test
```

빌드가 통과했다면 새 마이그레이션이 깨끗이 적용됐다는 뜻이에요. 부팅 로그에서도 적용된 버전을 확인할 수 있어요.

```
Migrating schema "<slug>" to version "26 - add users bio"
Successfully applied 1 migration to schema "<slug>"
```

마지막으로 HTTP로 직접 만져 봐요. 컨트롤러 경로는 `/api/apps/<slug>/users/me` 고, 인증이 필요해요(JWT 토큰).

```bash
# 로그인해서 받은 access token 을 넣어요
TOKEN="..."

# 프로필 수정 (PATCH — 보낸 필드만 바뀌어요)
curl -X PATCH http://localhost:8081/api/apps/<slug>/users/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"nickname":"새별명"}'

# 프로필 조회
curl http://localhost:8081/api/apps/<slug>/users/me \
  -H "Authorization: Bearer $TOKEN"
# → {"data":{"id":1,"nickname":"새별명", ...}, ...}
```

응답이 `ApiResponse` 로 감싸여 `data` 안에 프로필이 담겨 나와요. `nickname` 이 보이면 여섯 자리가 끝까지 이어진 거예요.

## 이 흐름에서 배운 것

- **한 필드는 여섯 자리에 닿아요** — DB 마이그레이션 → 엔티티(필드 + 도메인 메서드) → 응답 DTO → 변환 메서드 → 입력 DTO + 서비스 → 테스트. 본인 필드도 같은 자리들에 더하면 돼요.
- **마이그레이션은 번호 순서로 쌓여요** — 이미 실행된 파일은 고치지 말고 다음 번호로 새 파일을 만들어요. nullable 부터 시작해 단계적으로 좁혀요.
- **DTO 변환은 엔티티 메서드에서** — Mapper 클래스를 만들면 ArchUnit r22가 빌드를 막아요.
- **테스트는 결과 상태로 검증해요** — 내부 호출(Delegation Mock)이 아니라, 수정 후 다시 조회해 값이 바뀌었는지 봐요.
- **`build` 가 통과해야 끝이에요** — ArchUnit · Flyway · 전 테스트가 모두 초록불이어야 변경이 완성돼요.

## 다음

| 다음 행동 | 문서 |
|---|---|
| DTO 변환 패턴을 깊이 이해 | [`ADR-016 · DTO Mapper 금지`](../philosophy/adr-016-dto-mapper-forbidden.md) |
| 테스트 4층 전략 자세히 | [`Testing Strategy`](../production/test/testing-strategy.md) |
| 새 도메인 테이블 추가 | [`Migration Guides`](../api-and-functional/functional/migration.md) |
| 배포가 어떤 일을 하는지 맛보기 | [`배포 맛보기`](./first-deploy.md) |
