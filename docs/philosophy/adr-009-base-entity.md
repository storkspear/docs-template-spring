# ADR-009 · BaseEntity 공통 슈퍼클래스

**Status**: Accepted. `common-persistence/entity/BaseEntity.java` 에 구현돼 있고, 모든 `@Entity` 가 이를 상속합니다.

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~5분

## 결론부터

JPA 엔티티는 어느 도메인이든 *id*, *생성/수정 시각*, *equals/hashCode* 같은 공통 요소를 똑같이 갖습니다. 인증 도메인만 해도 `User`, `RefreshToken`, `EmailVerificationToken`, `Device`, `SocialIdentity` 등 일곱 개의 엔티티가 있고, 앱 모듈이 추가될 때마다 도메인 엔티티가 다시 두 배로 불어나요. 이 공통 요소를 매 엔티티에 직접 박으면 *복사 실수의 누적* 과 *감사 로직 변경의 다중 수정* 부담이 곧바로 따라옵니다.

`BaseEntity` 는 그 공통 요소를 한 곳에 모아둔 `@MappedSuperclass` 추상 클래스입니다. 새 엔티티는 `extends BaseEntity` 한 줄로 여섯 개 필드 (`id`, `createdAt`, `updatedAt`) 와 두 개 콜백 (`@PrePersist`, `@PreUpdate`), 그리고 `equals` / `hashCode` 를 자동 상속해요. Rails 의 `ActiveRecord::Base`, Django 의 `Model`, Spring Data 의 `AbstractPersistable` 도 같은 정신으로 *모든 엔티티가 자동으로 갖는 것* 을 한 클래스에 봉인한 패턴이에요.

이 ADR 은 그 봉인의 구체 모양 — `@MappedSuperclass` 가 왜 적합한지, `@PrePersist` 콜백을 직접 쓴 이유, `equals` / `hashCode` 가 JPA 의 detached / managed 상태에서 까다로운 이유와 그 대응 — 을 어떻게 결정했는지 기록합니다.

## 왜 이런 고민이 시작됐나?

엔티티 세 개짜리 프로젝트에서는 각 엔티티에 `id`, `createdAt`, `updatedAt` 을 직접 박는 편이 가장 간단해요. 슈퍼클래스도 없고 상속 트리도 없으니 한 파일만 보면 그 엔티티의 전부가 드러납니다.

문제는 엔티티 수가 늘어나는 순간부터 시작됩니다. 인증 도메인만 봐도 `User` 한 개로는 끝나지 않아요 — refresh token 을 따로 저장해야 하니 `RefreshToken`, 이메일 인증을 위해 `EmailVerificationToken`, 비밀번호 재설정을 위해 `PasswordResetToken`, 디바이스별 푸시 토큰을 위해 `Device`, 소셜 로그인을 위해 `SocialIdentity` 가 줄지어 따라옵니다. 여기에 앱 공장 전략 ([`제약 3`](./README.md#제약-3--복권-사기-모델)) 으로 새 앱이 추가되면 그 앱의 도메인 엔티티가 또 N 개씩 붙어요.

이 단계에서 *공통 요소를 매번 직접 박는 패턴* 은 세 가지 부담을 누적시킵니다.

첫째는 **복사 실수의 누적** 이에요. 일곱 번째 엔티티를 추가하다 한 번만 `updatedAt` 선언을 빠뜨려도 그 엔티티만 수정 시각이 비어 있는 상태가 됩니다. 운영 시 *왜 이 테이블만 update timestamp 가 NULL 이지?* 같은 디버깅이 한참 뒤에야 발생해요.

둘째는 **감사 로직 변경의 다중 수정** 입니다. *시각을 UTC 에서 서울 시간으로*, 또는 *DB 서버 시각으로* 같은 정책 변경이 한 번이라도 일어나면 N 개 엔티티를 모두 수정해야 해요. 한 곳을 빠뜨리면 그 엔티티만 다른 정책으로 동작하는 상태가 됩니다.

셋째는 **equals / hashCode 의 미묘한 구현 차이** 입니다. JPA 엔티티의 `equals` 는 *어느 필드를 기준으로 같은가* 를 결정하는 미묘한 주제예요. 어떤 엔티티는 id 로, 어떤 엔티티는 도메인 필드 조합으로 구현되면 일관성이 깨지고 `Set` / `HashMap` 동작이 엔티티마다 달라집니다.

이 결정이 답할 물음은 이거예요.

> **여러 엔티티가 공통으로 가진 구조를 어떻게 한 곳에서 관리할 것인가?**

## 고민했던 대안들

### Option 1 — 각 엔티티에 개별 선언

가장 단순하고 직관적인 방식이에요. 각 `@Entity` 가 자기 필드를 직접 선언하고, 콜백과 `equals` / `hashCode` 도 그 클래스에 박아 둡니다. 상속 트리가 없으니 한 파일만 보면 그 엔티티의 모든 동작이 드러나는 점이 매력이에요.

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

문제는 이 단순함이 *엔티티 수가 적을 때만* 유효하다는 점이에요. 일곱 개, 열다섯 개로 불어나면 *복사-붙여넣기 실수* 가 곧 발생합니다 — 한 엔티티만 `updatedAt` 선언이 빠지거나, `equals` 의 `id == null` 체크가 누락된 식이에요. 감사 로직을 한 번 변경하면 (예: *시각을 DB 서버 시각으로*) N 곳을 모두 수정해야 하고, 한 곳을 빠뜨리면 그 엔티티만 다른 정책으로 동작하는 상태가 됩니다. 유지보수 비용이 *엔티티 수에 선형 비례* 해서, 앱 공장 전략 ([`제약 3`](./README.md#제약-3--복권-사기-모델)) 에서는 곧 한계에 부딪혀요.

탈락 이유는 한 줄로 *스케일에 안 맞음* 입니다.

### Option 2 — Spring Data JPA Auditing (`@EntityListeners(AuditingEntityListener.class)`)

Spring Data JPA 가 제공하는 표준 감사 기능이에요. `@CreatedDate`, `@LastModifiedDate`, `@CreatedBy`, `@LastModifiedBy` 같은 어노테이션을 필드에 붙이면 Spring 이 자동으로 값을 채워 줍니다. *누가 / 언제 만들었는지* 까지 추적해야 하는 운영 환경에서는 강력한 도구예요.

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

이 옵션의 강점은 명확해요. Spring 공식 기능이라 문서가 풍부하고, `@CreatedBy` 처럼 SecurityContext 와 연계해 *현재 인증된 사용자* 를 자동으로 감사 필드에 채울 수 있어요. 운영 규모가 커져 *who-changed-what* 추적이 필요한 시점에는 자연스러운 선택입니다.

다만 우리 현재 단계에서는 과잉 엔지니어링이 돼요. 필요한 건 단순히 *시각 자동 설정* 뿐인데, Spring Data Auditing 을 쓰면 `@EnableJpaAuditing` 부트스트랩 설정이 추가되고 각 엔티티마다 `@EntityListeners` 어노테이션이 반복됩니다. 커스터마이즈가 필요해지면 (예: *시각을 UTC+9 로 강제*) Spring 의 `DateTimeProvider` Bean 을 뒤져야 해요. 우리가 얻는 가치보다 도입 비용이 커서, *정말 필요해진 시점에 점진적으로 도입* 하는 편이 낫습니다.

탈락 이유는 *현재 단계에 비해 무거움* 이에요. 미래에 `@CreatedBy` 가 필요해지면 `BaseEntity` 를 확장하는 형태로 흡수할 수 있는 경로가 열려 있어, *지금 도입* 의 압박이 없어요.

### Option 3 — `@MappedSuperclass BaseEntity` 추상 클래스 ★ 채택

공통 필드와 로직을 `BaseEntity` 추상 클래스에 모으고, 모든 `@Entity` 가 그것을 상속합니다. JPA 의 `@MappedSuperclass` 는 *상속한 자식 엔티티의 테이블에 부모 필드를 그대로 매핑* 하는 표준 기능이라, 별도 부트스트랩 설정이나 외부 라이브러리 없이 순수 JPA 만으로 동작해요.

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

이 옵션의 진짜 강점은 *엔티티 한 개가 깔끔* 해진다는 점이에요. 새 엔티티를 만들 때 `extends BaseEntity` 한 줄로 공통 요소가 모두 상속되니, 그 엔티티의 *고유 필드* 만 5~7 줄로 선언하면 끝납니다. 감사 로직을 변경할 때도 BaseEntity 한 곳만 수정하면 모든 엔티티에 자동 반영돼요. `@MappedSuperclass` 는 JPA 스펙에 명시된 표준 패턴이라 Hibernate 든 EclipseLink 든 어느 ORM 구현체에서도 동일하게 동작하고, 미래 ORM 교체 시에도 호환성 부담이 없습니다.

단점은 상속 트리가 한 단계 추가된다는 정도예요 (`BaseEntity → User`). JPA 자체가 이 패턴을 전제로 설계되어 있어 *상속 의존성* 이 실질적인 문제로 드러난 적은 없어요.

채택 이유는 명확합니다. *가장 단순한 형태로 목적을 달성* 하면서 JPA 공식 권장 패턴과 정렬되고, 부트스트랩 복잡도가 늘어나지 않아요. Spring Data Auditing 으로의 이행 경로도 열려 있어, 미래에 `@CreatedBy` 가 필요해지면 `AuditableBaseEntity extends BaseEntity` 형태로 점진 확장할 수 있어요.

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

`@GeneratedValue(strategy = GenerationType.IDENTITY)` 는 데이터베이스의 auto-increment 컬럼을 직접 활용하는 방식이에요. JPA 가 제공하는 다른 전략 (`SEQUENCE`, `TABLE`, `UUID`) 도 후보로 검토했지만, 각각 다른 트레이드오프를 가져요.

`SEQUENCE` 는 배치 insert 시 *id 를 미리 받아두고 한 번에 INSERT* 하는 최적화가 가능해 대규모 적재 환경에서 유리해요. 다만 우리 규모 — 초당 수십 건 저장 — 에서는 `IDENTITY` 와의 차이가 측정 불가능한 수준입니다. `UUID` 는 분산 시스템에서 *DB 호출 없이 클라이언트가 id 생성* 하는 이점이 있지만, 현재 단일 Postgres 모놀리스 환경에서는 그 이점이 발휘될 자리가 없고, 오히려 `BIGINT` 대비 인덱스 성능과 저장 공간 면에서 불리해요. `TABLE` 은 *별도 테이블에서 id 를 발급* 하는 가장 ORM-중립적인 방식이지만 성능 페널티가 커서 거의 쓰이지 않습니다.

채택은 `IDENTITY` — Postgres 의 `BIGSERIAL` / `GENERATED AS IDENTITY` 컬럼을 그대로 활용해 가장 단순하고 빠르게 동작합니다. 미래에 분산 환경으로 확장할 일이 생기면 그때 `UUID` 로 이행하는 경로가 열려 있어요.

#### 포인트 2 — `@PrePersist` / `@PreUpdate` 직접 사용

Option 2 에서 언급한 Spring Data Auditing 대신 JPA 표준 콜백을 직접 씁니다. 이유는 *단순함* 한 단어로 요약돼요. `@EnableJpaAuditing` 부트스트랩 설정도, `DateTimeProvider` 같은 별도 Bean 주입도 필요 없이 순수 JPA 동작만으로 완결됩니다.

```java
@PrePersist
protected void onPrePersist() {
    Instant now = Instant.now();
    this.createdAt = now;
    this.updatedAt = now;
}
```

JPA 스펙 정의에 따라 `EntityManager.persist()` 직전에 이 콜백이 자동 호출돼요. Hibernate 든 EclipseLink 든 어느 JPA 구현체에서든 동일하게 동작하므로 *벤더 종속* 도 없어요. 미래에 `@CreatedBy` 같은 추가 감사가 필요해지면 그 시점에 Spring Data Auditing 을 도입하는 형태로 점진 확장이 가능합니다.

#### 포인트 3 — `equals` / `hashCode` 의 JPA 패턴

JPA 엔티티의 `equals` / `hashCode` 는 *Java 일반 객체* 와 다르게 까다로운 주제예요. JPA 엔티티는 *세 가지 상태* — `transient` (저장 전, id=null), `managed` (영속 컨텍스트 안), `detached` (영속 컨텍스트 밖) — 를 오가는데, 같은 엔티티가 다른 세션에서 다시 로드되면 인스턴스는 다르지만 *논리적으로는 같은 행* 이어야 합니다. 이 의미를 정확히 잡으려면 네 가지를 동시에 고려해야 해요.

첫째는 **id 만 비교** 입니다. 같은 row 가 다른 JPA 세션에서 로드되어 인스턴스 두 개가 됐을 때, *같은 row* 라는 사실은 id 가 같다는 것뿐이에요. 도메인 필드 (예: email) 로 비교하면 *email 만 같아도 같다* 같은 엉뚱한 결과가 나옵니다.

둘째는 **`id != null` 체크** 예요. 저장 직전의 *transient* 엔티티는 id 가 아직 null 입니다. null 끼리 *같다고 판단* 하면 *서로 다른 새 엔티티* 두 개가 같은 것으로 취급되는 사고가 일어나요. 그래서 `id == null` 이면 *항상 false* 가 정답이에요.

셋째는 **클래스 비교** 입니다. 상속이 흔치 않지만 가끔 `User` 와 그 subclass `AnonymousUser` 같은 관계가 생기면 `instanceof` 만 체크할 때 두 종류가 같게 비교될 수 있어요. `getClass().equals()` 로 정확히 같은 클래스끼리만 비교하도록 막습니다.

넷째는 **`hashCode` 는 고정값** 이에요. id 는 저장 전에는 null 이었다가 저장 후에 채워지므로 *생애 중간에 값이 바뀌는* 필드입니다. `hashCode` 가 그 변화에 따라 달라지면 `Set` 이나 `HashMap` 에 넣어둔 엔티티를 *나중에 못 찾는* 결함이 발생해요. 그래서 `getClass().hashCode()` 같은 *생애 내내 불변* 인 값을 씁니다.

이 네 가지를 모두 반영한 구현입니다.

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

> **트릭의 핵심** — 저장 전 엔티티끼리 `equals` 비교하면 항상 `false` 가 반환됩니다 (마지막 조건의 `id != null` 에서 fail). 이게 의도된 동작이에요. *아직 DB 에 없는 것은 서로 다르다* 라고 취급해 *Set 에 두 개를 넣으면 둘 다 들어가는* 패턴을 보장합니다. 저장 후에는 id 가 부여되어 정상적으로 비교돼요.

#### 포인트 4 — 위치: `common-persistence/entity/`

`BaseEntity` 는 JPA 어노테이션에 의존합니다 (`@MappedSuperclass`, `@Id`, `@Column`, `@PrePersist`, `@PreUpdate`). 따라서 *JPA 의존을 가진 모듈* 안에 위치해야 해요. `common-web` 에는 JPA 의존이 없으니 (HTTP 영역에 ORM 을 끌어들이지 않기 위함) 거기엔 둘 수 없고, `common-security` 도 같은 이유로 부적합합니다.

남은 자리는 `common-persistence` — 이 모듈이 *공통 영속 인프라* 의 역할로 JPA 를 자연스럽게 끌어옵니다. [`ADR-004`](./adr-004-gradle-archunit.md) 의 convention plugin (`factory.common-module`) 정의 하에서 이 모듈이 JPA 의존을 갖도록 명시되어 있어요.

#### 포인트 5 — Lombok 을 안 쓴 이유

많은 Java 프로젝트가 `@Getter`, `@Setter`, `@NoArgsConstructor` 같은 Lombok 어노테이션으로 boilerplate 를 줄입니다. 우리는 채택하지 않았는데, 그 결정의 무게를 정직하게 풀어 적어요.

Lombok 의 동작 원리는 *annotation processor 가 컴파일 시점에 바이트코드를 조작* 하는 방식이에요. JDK 메이저 업그레이드 (예: 21 → 25) 시 *Lombok 자체가 그 JDK 를 지원할 때까지 빌드가 깨지는* 호환성 이슈가 가끔 발생해요. JDK 17 → 21 전환 시점에도 Lombok 1.18.30 이상이 필요했던 사례가 있었습니다.

또 다른 비용은 IDE 의존이에요. Lombok 으로 생성된 메소드는 *바이트코드에는 있지만 소스 파일에는 없는* 형태라, IDE 가 Lombok 플러그인을 인지하지 못하면 *코드가 빨갛게 깨져 보이는* 상태가 됩니다. 새로 합류하는 사람마다 *플러그인 설치 안내* 를 거쳐야 해요.

이 비용을 감수할 만큼의 이득이 있는가를 따져보면, *getter 10 개 수동 작성 vs `@Getter` 어노테이션 하나* 가 절약하는 줄 수는 10 줄 정도입니다. 그것도 *IDE 의 Generate Getter 기능* 을 한 번 누르면 자동 생성되니 실질 비용이 더 작아요. 게다가 우리 프로젝트는 DTO 를 모두 Java 14+ `record` 로 선언하므로 (ADR-004 의 r18 규칙) Lombok 의 가장 큰 사용 영역인 *DTO boilerplate* 자체가 없어요. 결국 Entity 의 수동 getter 만 남는데, 그 정도는 한 번 생성하면 평생 유지비가 거의 0 이에요.

## 이 선택이 가져온 것

### 긍정적 결과

**엔티티 선언이 짧아집니다.** `User`, `RefreshToken`, `Device` 등 각 엔티티가 *자기 고유 필드* 만 선언하면 끝이에요. 공통 6 개 필드 + 콜백 + `equals` / `hashCode` 가 자동 상속되니, 한 엔티티의 길이가 5~7 줄에서 시작해 10~15 줄 안쪽으로 머무릅니다. 처음 보는 사람도 그 엔티티의 *고유한 점* 만 빠르게 파악할 수 있어요.

**감사 로직이 단일 위치에 모입니다.** *createdAt 을 DB 서버 시각으로 강제* 같은 정책 변경이 들어와도 `BaseEntity` 한 곳만 수정하면 모든 엔티티가 자동 반영돼요. *N 곳 수정 / 한 곳 누락* 의 전형적 사고가 구조적으로 차단됩니다.

**`equals` / `hashCode` 의 일관성이 보장됩니다.** 모든 엔티티가 같은 비교 로직을 따르므로 *User 의 equals 는 id 비교, RefreshToken 의 equals 는 token 문자열 비교* 같은 비대칭이 발생할 여지가 없어요. JPA 의 detached / managed 상태 처리에 대한 *4 가지 규칙* (포인트 3) 도 한 번 잡아 두면 모든 엔티티에 자동 적용됩니다.

**JPA 공식 패턴과 정렬됩니다.** `@MappedSuperclass` 는 JPA 스펙에 명시된 표준 기능이에요. 미래에 Hibernate 에서 EclipseLink 로 ORM 을 교체하거나 Spring 에서 다른 프레임워크로 옮기더라도 이 패턴은 그대로 유효합니다. *벤더 종속* 으로 인한 마이그레이션 부담이 없어요.

### 부정적 결과

**상속 트리가 한 단계 추가됩니다.** 모든 엔티티가 `extends BaseEntity` 로 시작하므로 Java 의 단일 상속 제약 안에서 *다른 부모를 더 갖는* 옵션이 막혀요. 다만 JPA 엔티티가 다중 상속을 필요로 하는 시나리오는 거의 없고, 정말 필요해지면 *공통 동작은 interface default method 로 추출* 하는 우회 경로가 열려 있습니다.

**`id` 접근자가 강제됩니다.** `BaseEntity` 가 `getId()` 를 public 으로 노출하므로 모든 엔티티가 *id 를 외부에 보여주는* 형태가 돼요. 가끔 *id 를 도메인 외부에서 보지 못하게 캡슐화* 하고 싶은 욕구가 생기지만, JPA 엔티티에서 id 는 *식별자 역할 그 자체* 이므로 노출이 의미적으로 자연스러워요. 진짜 캡슐화가 필요하다면 그 도메인이 *DDD Aggregate* 패턴으로 갈 단계라는 신호입니다.

**transient 엔티티 비교가 직관적이지 않아요.** id 가 null 인 두 인스턴스를 `Set` 에 넣으면 *서로 다른* 것으로 취급되어 둘 다 들어갑니다. 이게 *논리적으로 같은 행이 아직 DB 에 없다* 는 사실의 정직한 반영이지만, 처음 보는 사람에게는 혼란을 일으킬 수 있어요. JavaDoc 에 명시하고 다음 *교훈* 섹션에서 케이스를 풀어 적습니다.

### 감당 가능성 판단

단점들은 *이론적 제약* 수준이에요. 실제 개발에서 *다중 상속이 필요한데 막혔다*, *id 캡슐화가 필요한데 못한다* 같은 케이스를 마주칠 빈도는 매우 낮고, 마주쳐도 우회 경로가 있어요. 반면 장점 — *N 개 엔티티의 유지 비용 절감* — 은 매 엔티티 추가마다 누적되어 시간이 갈수록 가치가 복리로 커집니다.

## 교훈

### 엔티티 최초 저장 직전에 Set 을 쓸 때의 함정

`equals` 가 *id null 시 false 반환* 하도록 설계되어 있으니, *저장 전 엔티티* 들끼리는 *서로 다르다* 고 판단됩니다. 이게 의도된 동작이지만 *Set 으로 중복 제거* 의 직관과 어긋날 수 있어요.

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

`a@test.com` 과 `b@test.com` 이 들어간 첫 두 줄은 *원래 의도대로* 서로 다른 두 객체로 처리됩니다. 문제는 세 번째 줄이에요 — *같은 이메일* 의 새 인스턴스를 추가하면 *Java 인스턴스가 다르고 둘 다 id=null* 이라 `equals` 는 false 를 반환하고, 결국 같은 이메일이 두 번 Set 에 들어가 버립니다. *Set 으로 중복 차단* 을 기대했다면 의도와 어긋난 결과가 돼요.

**원칙**: 저장 전 엔티티를 `Set` 또는 `HashMap` 의 key 로 쓰지 않습니다. 중복 차단이 필요하면 *도메인 필드 기반 DTO* (예: `record EmailKey(String email)`) 로 별도 키를 만들어 쓰는 편이 안전해요. 저장이 끝난 후 (id 부여됨) 엔티티는 정상 비교되므로 `Set` 에 안전하게 담을 수 있습니다.

### Spring Data Auditing 도입의 시점 판단

`@CreatedBy` / `@LastModifiedBy` 같은 *누가 만들었는지* 추적이 필요해질 가능성을 두고 *지금 미리 도입할지 / 필요해지면 도입할지* 가 검토 포인트가 돼요. 결론은 명확합니다 — *지금 미리 도입할 이유가 없음*.

`@CreatedBy` 가 정말 필요해지는 시점은 운영 규모가 커져 *감사 로그의 누락이 비용으로 직접 환산되는 단계* 예요. 그때 가서 `BaseEntity` 를 그대로 두고 `AuditableBaseEntity extends BaseEntity` 같은 형태로 *옵트인 확장* 하면 됩니다. 미래의 가능성을 위해 *지금 단순함* 을 버리면 그 단순함이 가져오는 매일의 가치가 사라져요.

**원칙**: *미래에 쓸지도 모른다* 를 근거로 복잡도를 미리 도입하지 않습니다. 실제 필요해진 시점에 *점진적 확장* 이 가능한 구조로 설계해 두면, 그 시점이 와도 부담 없이 흡수할 수 있어요. YAGNI 의 핵심은 *기능을 거절하는 것* 이 아니라 *도입 시점을 미루는 것* 입니다.

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

