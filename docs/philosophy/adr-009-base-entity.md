# ADR-009 · BaseEntity 공통 슈퍼클래스

**Status**: Accepted. 현재 유효. 2026-04-20 기준 `common-persistence/entity/BaseEntity.java` 에 구현. 모든 `@Entity` 가 이를 상속.

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~5분

## 결론부터

모든 JPA 엔티티가 **공통으로 가지는 것** (id, 생성/수정 시각, equals/hashCode) 을 **한 클래스** 에 모아두고 상속하는 구조입니다. 새 엔티티를 만들 때 이 6개 필드와 2개 콜백, equals/hashCode 를 매번 복사하는 대신 `extends BaseEntity` 한 줄로 끝내요. Rails 의 `ActiveRecord::Base`, Django 의 `Model`, Spring Data 의 `AbstractPersistable` 과 같은 계보.

## 왜 이런 고민이 시작됐나?

인증 도메인만 해도 엔티티가 **6~7개** 입니다 — `User`, `RefreshToken`, `EmailVerificationToken`, `PasswordResetToken`, `Device`, `SocialIdentity`, 그리고 `Role` 등. 여기에 앱 모듈이 추가될 때마다 도메인 엔티티가 **N개씩 더** 늘어나요.

각 엔티티가 필요로 하는 **공통 요소** 가 있습니다:

- `id` 필드 (primary key)
- `createdAt` / `updatedAt` (감사 필드)
- `@PrePersist` / `@PreUpdate` 콜백으로 시각 자동 설정
- `equals` / `hashCode` 구현 (JPA 의 detached / managed 상태 대응)

엔티티가 3개만 있을 때는 각 엔티티에 직접 쓰는 게 편해요. 하지만 7개, 15개, 30개로 늘어나면:

1. **복사 실수의 누적** — 한 엔티티만 `updatedAt` 선언을 빠뜨리는 일이 생김
2. **감사 로직 변경의 다중 수정** — "시각을 UTC 에서 서울 시간으로" 같은 변경이 필요해지면 N 곳을 수정
3. **equals / hashCode 의 미묘한 구현 차이** — 어떤 엔티티는 id 로, 어떤 엔티티는 field 조합으로 해서 일관성 깨짐

이 결정이 답할 물음은 이거예요.

> **여러 엔티티가 공통으로 가진 구조를 어떻게 한 곳에서 관리할 것인가?**

## 고민했던 대안들

### Option 1 — 각 엔티티에 개별 선언

```java
@Entity
public class User {
    @Id @GeneratedValue private Long id;
    @Column(name = "created_at") private Instant createdAt;
    @Column(name = "updated_at") private Instant updatedAt;

    @PrePersist protected void onCreate() { ... }
    @PreUpdate protected void onUpdate() { ... }

    @Override public boolean equals(Object o) { ... }
    @Override public int hashCode() { ... }

    // ... 실제 User 의 고유 필드
}

@Entity
public class RefreshToken {
    // 위와 똑같은 6개 필드 + 2개 콜백 + equals/hashCode 복붙
    // ...
}
```

- **장점**: 각 엔티티가 독립. 상속 의존성 없음.
- **단점**: 복사-붙여넣기 실수가 누적. 감사 로직 변경 시 N 곳 수정. 엔티티 개수가 늘수록 유지보수 비용 선형 증가.
- **탈락 이유**: 스케일 안 맞음.

### Option 2 — Spring Data JPA Auditing (`@EntityListeners(AuditingEntityListener.class)`)

Spring Data JPA 가 제공하는 표준 감사 기능. `@CreatedDate`, `@LastModifiedDate`, `@CreatedBy` 등 어노테이션.

```java
@Entity
@EntityListeners(AuditingEntityListener.class)
public class User {
    @Id @GeneratedValue private Long id;
    @CreatedDate private Instant createdAt;
    @LastModifiedDate private Instant updatedAt;
    // ...
}
```

- **장점**: Spring 공식 기능. `@CreatedBy` 처럼 보안 컨텍스트와 연계한 고급 기능 가능.
- **단점**:
  - 별도 `@EnableJpaAuditing` 설정 필요. 부트스트랩 복잡도 약간 증가.
  - 우리가 필요로 하는 건 단순히 "시각 자동 설정" 뿐 — `@CreatedBy` 같은 고급 기능은 아직 불필요.
  - 각 엔티티에 `@EntityListeners` 어노테이션 반복 (또는 `@MappedSuperclass` 와 결합).
  - 커스터마이즈가 필요해지면 (예: "시각을 UTC+9 로") Spring 설정을 뒤져야 함.
- **탈락 이유**: 과잉 엔지니어링. 우리 필요에 비해 복잡도 큼.

### Option 3 — `@MappedSuperclass BaseEntity` 추상 클래스 ★ (채택)

공통 필드와 로직을 `BaseEntity` 추상 클래스에 모으고, 모든 `@Entity` 가 상속.

```java
@MappedSuperclass
public abstract class BaseEntity {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist protected void onPrePersist() {
        Instant now = Instant.now();
        this.createdAt = now;
        this.updatedAt = now;
    }

    @PreUpdate protected void onPreUpdate() {
        this.updatedAt = Instant.now();
    }

    // getters, equals, hashCode
}

@Entity
@Table(name = "users")
public class User extends BaseEntity {
    // User 의 고유 필드만 선언 — id, createdAt, updatedAt 은 자동 상속
}
```

- **장점**:
  - **엔티티 한 개가 깔끔** — `extends BaseEntity` 한 줄로 공통 요소 상속.
  - **변경의 단일 위치** — 감사 로직 변경은 BaseEntity 한 곳 수정.
  - **JPA 표준 관용** — `@MappedSuperclass` 는 JPA 스펙 정의 기능. 어느 ORM 구현체에서도 동작.
  - **추가 설정 불필요** — `@EnableJpaAuditing` 같은 것 안 씀. 부트스트랩 복잡도 최소.
- **단점**:
  - 상속 트리가 1단계 생김 (BaseEntity → User). 다만 JPA 가 이 패턴을 전제로 설계되어 있어 실질 문제 없음.
- **채택 이유**: 가장 단순하면서 목적 달성. JPA 공식 권장 패턴.

## 결정

`common-persistence/entity/BaseEntity.java` 에 공통 슈퍼클래스를 두고, 모든 `@Entity` 가 상속합니다.

### 전체 구현

```java
@MappedSuperclass
public abstract class BaseEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public Long getId() { return id; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }

    @PrePersist
    protected void onPrePersist() {
        Instant now = Instant.now();
        this.createdAt = now;
        this.updatedAt = now;
    }

    @PreUpdate
    protected void onPreUpdate() {
        this.updatedAt = Instant.now();
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof BaseEntity other)) return false;
        if (!getClass().equals(other.getClass())) return false;
        return id != null && id.equals(other.id);
    }

    @Override
    public int hashCode() {
        return getClass().hashCode();
    }
}
```

### 설계 선택 포인트

#### 포인트 1 — `GenerationType.IDENTITY` 고정

`@GeneratedValue(strategy = GenerationType.IDENTITY)` — 데이터베이스의 auto-increment 컬럼을 사용합니다. `SEQUENCE`, `TABLE`, `UUID` 도 선택지였지만:

- **`IDENTITY`** (채택): Postgres 의 `BIGSERIAL` / `GENERATED AS IDENTITY` 컬럼 활용. 가장 단순.
- **`SEQUENCE`**: 배치 insert 에서 성능 이점 있지만, 우리 규모(초당 저장 수십 건)에선 차이 없음.
- **`UUID`**: 분산 시스템에 유리하지만 현재 단일 DB 모놀리스라 불필요. 인덱스 성능도 `BIGINT` 가 우수.

`IDENTITY` 가 우리 스케일에서 가장 단순 + 빠름.

#### 포인트 2 — `@PrePersist` / `@PreUpdate` (Spring Data Auditing 아님)

Option 2 에서 언급한 Spring Data Auditing 대신 **JPA 표준 콜백** 을 직접 사용. 이유는 "단순함" — `@EnableJpaAuditing` 없음, 별도 Bean 주입 없음, 순수 JPA 동작만으로 완결.

```java
@PrePersist
protected void onPrePersist() {
    Instant now = Instant.now();
    this.createdAt = now;
    this.updatedAt = now;
}
```

JPA spec 정의에 따라 `EntityManager.persist()` 직전에 자동 호출됩니다. DB / JPA 구현체 (Hibernate / EclipseLink) 상관없이 동일 동작.

#### 포인트 3 — `equals` / `hashCode` 의 JPA 패턴

JPA 엔티티의 `equals` / `hashCode` 는 까다로운 주제예요. 네 가지 고려사항:

1. **id 만 비교** — 같은 엔티티 인스턴스가 다른 JPA 세션에서 로드되어도 같게 판단.
2. **`id != null` 체크** — 저장 전 (newly created) 엔티티는 id 가 null. null 비교를 피해야 함.
3. **클래스 비교** — `User` 와 `AnonymousUser extends User` 같은 상속 관계에서 혼동 방지.
4. **`hashCode` 는 고정값** — id 가 생성 전후로 바뀌므로 `hashCode` 는 `getClass().hashCode()` 같은 불변값을 써야 `Set` / `HashMap` 에서 안정적.

이 원칙을 반영한 구현:

```java
@Override
public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof BaseEntity other)) return false;
    if (!getClass().equals(other.getClass())) return false;
    return id != null && id.equals(other.id);  // id null 이면 false
}

@Override
public int hashCode() {
    return getClass().hashCode();  // id 무관, 클래스별 상수
}
```

> **트릭의 핵심** — 저장 전 엔티티들끼리 `equals` 비교하면 항상 `false` (id 둘 다 null 이므로 마지막 조건에서 fail). 이게 의도된 동작 — "아직 DB 에 없는 것은 서로 다르다" 라고 취급. 저장 후 id 가 부여되면 정상적으로 비교됨.

#### 포인트 4 — 위치: `common-persistence/entity/`

BaseEntity 는 JPA 어노테이션에 의존 (`@MappedSuperclass`, `@Id`, `@Column`, `@PrePersist`, `@PreUpdate`). 따라서:

- `common-web/` 에 넣을 수 없음 → `common-web` 은 JPA 의존 없음 (ArchUnit r9 관련)
- `common-security/` 에 넣을 수 없음 → 같은 이유
- **`common-persistence/`** 가 적합 — 이 모듈이 JPA 를 가짐

이 위치는 [`ADR-004`](./adr-004-gradle-archunit.md) 의 convention plugin (`factory.common-module`) 하에서 `common-persistence` 가 JPA 의존을 가지도록 명시됨.

#### 포인트 5 — Lombok 안 쓴 이유

많은 프로젝트가 `@Getter`, `@Setter`, `@NoArgsConstructor` 같은 Lombok 으로 boilerplate 를 줄입니다. 우리는 **Lombok 을 채택하지 않았어요**. 이유:

- **컴파일러 호환성** — Lombok 은 annotation processor 로 바이트코드를 조작. JDK 업그레이드 시 호환성 이슈 가끔 발생.
- **IDE 플러그인 의존** — IDE 가 Lombok 플러그인 없으면 코드가 "깨져 보이는" 상태.
- **비싼 대가 대비 작은 이득** — getter 10개 수동 작성 vs `@Getter` 하나. 절약되는 줄은 10줄. 이득이 플러그인 의존 비용보다 작음.
- **Java 14+ `record` 와 정렬** — DTO 는 `record` (ADR-004 r18) 로 Lombok 필요 없고, Entity 는 수동 getter 로도 충분.

대신 **IDE 의 `Generate Getter` 기능** 을 씀. 한 번 생성하면 끝.

## 이 선택이 가져온 것

### 긍정적 결과

**엔티티 선언이 짧음** — User, RefreshToken, Device 등 각 엔티티가 "자기 고유 필드" 만 선언. 5~7줄에서 10~15줄 사이로 스크롤 부담 적음.

**감사 로직 단일 위치** — "createdAt 을 DB 서버 시각으로" 같은 변경이 필요해지면 BaseEntity 한 곳만 수정. 모든 엔티티 자동 반영.

**equals / hashCode 일관성** — 모든 엔티티가 같은 로직. "User 의 equals 와 RefreshToken 의 equals 가 다르게 동작" 같은 실수 불가.

**JPA 공식 패턴** — `@MappedSuperclass` 는 JPA 스펙에 명시된 기능. 미래 ORM 교체 (Hibernate → EclipseLink 등) 시에도 호환.

### 부정적 결과

**상속 트리 1단계 추가** — `extends BaseEntity` 가 엔티티마다 달림. 다중 상속이 필요한 경우 제약 (Java 단일 상속). 완화: 실제로 다중 상속 필요한 상황 없었음. 필요해지면 interface 로 가능.

**`id` 접근자 강제** — 모든 엔티티가 `getId()` 를 외부로 노출. 가끔 "id 를 캡슐화하고 싶다" 는 욕구 있지만, JPA 엔티티의 id 는 식별자 역할이라 노출이 자연스러움.

**newly created 엔티티 비교의 비직관성** — 같은 인스턴스 두 개 (둘 다 id 가 null) 를 `Set` 에 넣으면 둘 다 들어감. 이게 의도된 동작이지만 처음 보는 사람에게는 혼란 가능. 완화: JavaDoc 에 명시 + 팀 내 문서화.

### 감당 가능성 판단

단점들은 **이론적 제약** 수준. 실제 개발에서 마주치는 빈도는 매우 낮음. 장점 (N 엔티티 유지비용 절감) 이 압도적.

## 교훈

### 엔티티 최초 저장 직전 Set 사용 시 주의

초기에 아래 코드가 문제를 일으킨 적이 있었어요.

```java
Set<User> pendingUsers = new HashSet<>();
pendingUsers.add(new User("a@test.com"));  // id = null
pendingUsers.add(new User("b@test.com"));  // id = null

// 의도: 다른 사용자 2명
// 실제: hashCode 는 getClass().hashCode() 로 동일, equals 는 id null 로 false
//        → Set 에 2명 다 들어감 ✅ 의도 맞음

pendingUsers.add(new User("a@test.com"));  // 위와 같은 이메일, 다른 인스턴스
// 실제: Set 에 3명 들어감 ❌ 중복 허용됨
```

이건 `equals` 가 id null 시 false 반환하는 설계 때문. 저장 전 엔티티는 **"같음 판단 불가"** 상태로 처리됩니다.

**교훈**: 저장 전 엔티티를 `Set` / `HashMap` 의 key 로 쓰지 말 것. 필요하면 `email` 같은 도메인 필드 기반 DTO 로 중복 체크.

### Spring Data Auditing 으로 이행하지 않은 근거 보존

프로젝트 중반 "`@CreatedBy` 가 필요해지면 Spring Data Auditing 으로 갈아타야 하지 않나?" 검토. 결론:
- `@CreatedBy` 가 필요해지면 **그때** BaseEntity 를 확장 (e.g. `AuditableBaseEntity extends BaseEntity` + `@EntityListeners`)
- 지금 단순함을 버릴 이유 없음
- YAGNI 원칙 준수

**교훈**: "미래에 쓸지도" 기반으로 복잡도를 미리 도입하지 말 것. 실제 필요해질 때 점진적 도입이 안전.

## 관련 사례 (Prior Art)

- **[JPA 2.2 Specification § 11.1.14](https://jakarta.ee/specifications/persistence/3.1/)** `@MappedSuperclass` — JPA 표준 정의. 본 ADR 이 따르는 공식 패턴.
- **[Spring Data JPA — Auditing](https://docs.spring.io/spring-data/jpa/docs/current/reference/html/#auditing)** — Option 2 로 검토한 기능. 필요해지면 이행 경로.
- **[Vlad Mihalcea — "The best way to implement equals, hashCode, and toString with JPA"](https://vladmihalcea.com/the-best-way-to-implement-equals-hashcode-and-toString-with-jpa-and-hibernate/)** — 본 ADR 의 `equals`/`hashCode` 패턴 출처.
- **[JHipster BaseEntity](https://github.com/jhipster/generator-jhipster)** — JHipster 의 엔티티 베이스. 우리보다 복잡 (softDelete, version 등 포함). 필요해지면 확장 가능.
- **Rails `ActiveRecord::Base`, Django `Model`** — 다른 생태계의 같은 아이디어. "모든 엔티티가 자동으로 갖는 것".

## Code References

**BaseEntity 구현**:
- [`BaseEntity.java`](https://github.com/storkspear/template-spring/blob/main/common/common-persistence/src/main/java/com/factory/common/persistence/entity/BaseEntity.java) — 47줄 전체

**BaseEntity 를 상속하는 엔티티 예시**:
- [`User.java`](https://github.com/storkspear/template-spring/blob/main/core/core-user-impl/src/main/java/com/factory/core/user/impl/entity/User.java) — `extends BaseEntity`
- [`core-auth-impl/entity/`](https://github.com/storkspear/template-spring/tree/main/core/core-auth-impl/src/main/java/com/factory/core/auth/impl/entity) — RefreshToken, EmailVerificationToken 등

**모듈 위치 근거**:
- [`common/common-persistence/build.gradle`](https://github.com/storkspear/template-spring/blob/main/common/common-persistence/build.gradle) — `factory.common-module` plugin + JPA 의존

