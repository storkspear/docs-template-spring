# 동적 쿼리 컨벤션

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~7분

이 문서는 다중 조건 동적 검색의 표준 패턴을 정의해요. 관리자 감사 로그 조회, 사용자 검색, 청구 내역 필터링처럼 조건이 여럿 들어오는 목록 조회가 대상이에요.

핵심 흐름은 다섯 단계로 이어집니다. RequestDTO 가 조건을 받고, Assembler 가 그것을 조건 Map 으로 옮기고, `QueryDslPredicateBuilder` 가 Map 을 WHERE 절로 조립하고, 리포지토리가 실제 쿼리를 실행해요.

```
RequestDTO  →  Assembler  →  조건 Map  →  QueryDslPredicateBuilder  →  JPAQuery
```

근거가 되는 설계 결정은 [`ADR-010 · SearchCondition 공통 조회 인프라`](../philosophy/adr-010-search-condition.md) 에 있어요.

---

## 왜 이 패턴인가

서비스가 커지면 검색 화면마다 조건이 열 개 안팎으로 늘어나요. 매 도메인에서 `if (xxx != null) ...` 형태의 분기가 반복되면, 새 조건을 추가하는 비용과 그걸 검증하는 비용이 같이 쌓입니다.

이 패턴은 그 반복을 `QueryDslPredicateBuilder` 한 곳으로 흡수해요. 그 결과 세 가지가 정리됩니다.

- 새 조건 추가가 Assembler 의 `Map.put()` 한 줄로 끝나요.
- 연산자의 SQL 정합성은 `QueryDslPredicateBuilder` 의 단위 테스트가 담보합니다.
- 도메인은 "어떤 필드를 어떤 연산자에 매핑하는가" 만 결정하면 돼요. 그 책임은 Assembler 가 가집니다.

---

## 4계층 구조

```
[Controller]
   ↓  HTTP 요청 → record 바인딩
[RequestDTO record]   (core-{domain}-api)
   - 순수 데이터. JPA·QueryDsl 의존 없음
   - compact constructor 로 page·size 기본값 보정
   ↓
[Assembler]   (core-{domain}-impl, package-private)
   - RequestDTO → Map<String, Object> 변환
   ↓
[QueryDslPredicateBuilder.build(entityPath, conditions)]   (common-persistence)
   - Map → BooleanBuilder
   ↓
[QueryRepositoryImpl]   (core-{domain}-impl)
   - JPAQueryFactory 로 content·count 쿼리 실행
```

계층마다 책임을 나누면 각 계층을 따로 테스트할 수 있어요.

| 계층 | 무엇을 검증하나 | 테스트 종류 |
|---|---|---|
| RequestDTO | compact constructor 의 기본값 보정 | 단순 단위 테스트 |
| Assembler | 필드 → 조건 키 변환의 정확성 | 단위 테스트 (JPA 의존 없음, 빠름) |
| QueryDslPredicateBuilder | 연산자별 SQL 빌드 정합 | common-persistence 가 담당 |
| QueryRepositoryImpl | 실제 SQL 실행 | Testcontainers 통합 테스트 |

---

## RequestDTO 설계

### 명명

검색 요청 DTO 는 `*SearchRequest` 로 이름 짓습니다. 예를 들어 `AuditLogSearchRequest`, `UserSearchRequest` 처럼요. 이 suffix 는 ArchUnit r19 (`DTO_NAMING_SUFFIX`) 를 통과해요. [ADR-016](../philosophy/adr-016-dto-mapper-forbidden.md) 의 정신대로, RequestDTO 본문에는 변환 메서드를 두지 않고 순수 데이터로만 유지합니다. 변환은 Assembler 가 맡아요.

### 필드 권장 패턴

모든 필드는 nullable 로 두고, null 인 필드는 조건에서 제외합니다.

| 검색 요건 | 필드 타입 | 예시 |
|---|---|---|
| 정확 매치 | `Long`·`String` | `Long actorUserId` |
| 부분 매치 | `String` | `String actorEmail` |
| 다중 선택 | `List<String>` | `List<String> actions` |
| Enum | 해당 enum 타입 | `AuditResult result` |
| 기간 | `Instant from`, `Instant to` | `Instant occurredFrom, occurredTo` |
| 정렬 | `List<SortOrder>` | compact constructor 에서 null 을 빈 리스트로 |
| 페이지 | `int page, int size` | compact constructor 에서 음수·0 보정 |

### compact constructor 보정

```java
// core-audit-api/dto/AuditLogSearchRequest.java 발췌
public record AuditLogSearchRequest(
        Long actorUserId, String actorEmail, List<String> actions,
        // ... 나머지 필드 생략
        List<SortOrder> sorts, int page, int size) {

    public AuditLogSearchRequest {
        if (page < 0) page = 0;
        if (size <= 0) size = 20;
        if (sorts == null) sorts = List.of();
    }
}
```

Controller 가 null 이나 음수를 보내도 record 가 스스로 안전한 기본값으로 보정해요.

---

## Assembler 패턴

### 위치와 가시성

Assembler 는 `core/core-{domain}-impl` 의 repository 패키지에 두고, package-private 로 닫습니다. final 클래스에 private 생성자를 두고 static 메서드만 노출해요.

클래스 이름이 `Mapper` 나 `Converter` 로 끝나면 ArchUnit r22 (`NO_MAPPER_CLASSES`) 를 위반합니다. 그래서 `*Assembler` 처럼 다른 이름을 씁니다. 이건 회피책이 아니라 [ADR-016](../philosophy/adr-016-dto-mapper-forbidden.md) 이 의도한 패턴이에요. 변환 로직을 한 클래스에 모으되, 그 클래스를 Mapper 로 부르지 않을 뿐입니다.

### 본문 패턴

```java
// core-audit-impl/repository/AuditLogQueryAssembler.java 발췌
final class AuditLogQueryAssembler {

    private AuditLogQueryAssembler() {}

    static Map<String, Object> toConditions(AuditLogSearchRequest req) {
        Map<String, Object> conditions = new LinkedHashMap<>();

        QueryUtil.addCondition(conditions, "actorUserId_eq", req.actorUserId());
        QueryUtil.addCondition(conditions, "actorEmail_ilike", req.actorEmail());
        QueryUtil.addCondition(conditions, "action_in", req.actions());
        QueryUtil.addCondition(conditions, "result_eq", req.result());

        // 기간: 양쪽이면 between, 한 쪽이면 gte 또는 lte 로 분기
        if (req.occurredFrom() != null && req.occurredTo() != null) {
            conditions.put("occurredAt_between",
                    QueryUtil.between(req.occurredFrom(), req.occurredTo()));
        } else if (req.occurredFrom() != null) {
            conditions.put("occurredAt_gte", req.occurredFrom());
        } else if (req.occurredTo() != null) {
            conditions.put("occurredAt_lte", req.occurredTo());
        }
        return conditions;
    }
}
```

`QueryUtil.addCondition` 은 값이 null 이거나, 빈 문자열이거나, 빈 컬렉션·빈 Map 이면 자동으로 건너뜁니다. 그래서 Assembler 본문에 null 체크를 일일이 적을 필요가 없어요.

### Assembler 테스트

Assembler 는 JPA 에 의존하지 않으니 순수 단위 테스트로 빠르게 검증해요. 확인할 것은 두 가지입니다.

- 각 필드가 어떤 조건 키로 변환되는가.
- 빈 문자열·빈 리스트·null 이 자동으로 빠지는가 (경계값).

테스트 파일은 `core-{domain}-impl` 의 `{Domain}QueryAssemblerTest` 에 둬요.

---

## 조건 키 형식

조건 Map 의 키는 `field_operator` 형식입니다. 빌더는 키의 마지막 밑줄을 기준으로 앞을 필드명, 뒤를 연산자로 해석해요. 연산자를 생략하면 기본값은 `eq` 입니다. 전체 표와 동작 설명은 [`common-persistence README`](../../common/common-persistence/README.md#querydsl-동적-쿼리) 에 있어요.

빌더가 아는 연산자는 15개이고, 문자열 비교 계열에는 대소문자를 무시하는 `i` 접두 변형이 따로 있어요.

| 분류 | 연산자 | `i` 변형 (대소문자 무시) |
|---|---|---|
| 동등성 | `eq` (기본), `ne` | `ieq`, `ine` |
| 문자열 | `like`, `startsWith`, `endsWith` | `ilike`, `istartsWith`, `iendsWith` |
| 비교 | `gt`, `gte`, `lt`, `lte` | 없음 |
| 집합 | `in`, `notIn` | 없음 |
| 범위 | `between` | 없음 |
| NULL | `isNull`, `isNotNull` | 없음 |
| 빈 문자열 | `empty` | 없음 |

기본값을 대소문자 구분으로 둔 이유는 일반 인덱스를 그대로 쓸 수 있어서예요. `i` 변형은 `LOWER()` 함수 인덱스나 전체 스캔을 부르므로, 그 비용 차이가 키 이름에 드러나도록 일부러 분리했어요.

연산자 종류별로 값의 타입이 다릅니다.

- `in`·`notIn` 의 값은 컬렉션이에요.
- `between` 의 값은 크기가 정확히 2인 리스트예요. 크기가 다르면 `IllegalArgumentException` 이 납니다.
- `isNull`·`isNotNull`·`empty` 의 값은 Boolean 이에요. `isNull` 에 `false` 를 주면 `isNotNull` 로 뒤집힙니다.

---

## OR 그룹 사용 시점

OR 가 정말 필요한 경우는 "어느 한 필드라도 매치되면 포함" 일 때예요. 가장 흔한 예는 키워드 통합 검색입니다.

```java
// 키워드가 이름·이메일·닉네임 중 어디든 매치되면 포함
if (StringUtils.hasText(req.keyword())) {
    conditions.put("or", QueryUtil.or(
            "name_ilike", req.keyword(),
            "email_ilike", req.keyword(),
            "nickname_ilike", req.keyword()));
}
```

바깥쪽 다른 조건들과는 AND 로, 안쪽 세 필드끼리는 OR 로 결합돼요.

### OR·AND 그룹의 형식별 의미 차이

`or` 와 `and` 키의 값은 Map 으로 줄 때와 List 로 줄 때 의미가 달라집니다. 헷갈리기 쉬운 부분이라 표로 정리할게요.

| 값의 형식 | 결과 | 예 |
|---|---|---|
| `or: Map` | 각 항목이 평평하게 OR 결합 | `or: {a_eq:1, b_eq:2}` → `a=1 OR b=2` |
| `or: List<Map>` | 각 원소 안의 키는 AND, 원소끼리는 OR | `or: [{a_eq:1, b_eq:2}, {c_eq:3}]` → `(a=1 AND b=2) OR c=3` |

`QueryUtil.or(k1, v1, k2, v2)` 는 단일 키 Map 의 List 를 돌려주므로 결과적으로 평평한 OR 가 돼요. "AND 묶음들의 OR" 같은 복잡한 조건이 필요하면 `List<Map>` 을 직접 구성합니다.

### OR 를 쓰지 않는 게 좋은 경우

같은 필드에 여러 값을 매치할 때는 OR 가 아니라 `in` 을 씁니다.

```java
// 권장하지 않음 — OR 그룹 남용
conditions.put("or", List.of(
        Map.of("status_eq", "ACTIVE"),
        Map.of("status_eq", "PENDING")));

// 권장 — in 사용. 인덱스 효율이 좋아요
conditions.put("status_in", List.of("ACTIVE", "PENDING"));
```

---

## 커스텀 리포지토리 패턴

### Custom Repository 결합

Spring Data JPA 의 finder 와 동적 검색을 한 인터페이스에서 함께 노출하려면 세 조각을 엮어요.

```java
// 1. 동적 검색 전용 인터페이스
public interface AuditLogQueryRepository {
    Page<AuditLog> search(AuditLogSearchRequest request);
}

// 2. 기존 리포지토리가 둘 다 상속
public interface AuditLogRepository
        extends JpaRepository<AuditLog, Long>, AuditLogQueryRepository {}

// 3. Spring Data 가 *RepositoryImpl 명명 규약으로 자동 연결
public class AuditLogQueryRepositoryImpl implements AuditLogQueryRepository {
    private final JPAQueryFactory queryFactory;
    // ...
}
```

호출하는 쪽 서비스는 `AuditLogRepository` 하나만 의존하면 됩니다. JPA finder 와 동적 검색을 같은 인터페이스에서 부를 수 있어요.

### RepositoryImpl 본문

```java
// core-audit-impl/repository/AuditLogQueryRepositoryImpl.java 발췌
@Override
public Page<AuditLog> search(AuditLogSearchRequest request) {
    PathBuilder<AuditLog> entityPath = new PathBuilder<>(AuditLog.class, "auditLog");
    Map<String, Object> conditions = AuditLogQueryAssembler.toConditions(request);

    BooleanBuilder where = QueryDslPredicateBuilder.build(entityPath, conditions);

    List<SortOrder> sorts = request.sorts().isEmpty() ? DEFAULT_SORTS : request.sorts();
    OrderSpecifier<?>[] orders = QueryDslSortBuilder.build(entityPath, sorts);

    List<AuditLog> content = queryFactory
            .selectFrom(entityPath)
            .where(where)
            .orderBy(orders)
            .offset((long) request.page() * request.size())
            .limit(request.size())
            .fetch();

    Long total = queryFactory.select(entityPath.count())
            .from(entityPath).where(where).fetchOne();

    return new PageImpl<>(content,
            PageRequest.of(request.page(), request.size()),
            total == null ? 0L : total);
}
```

기본 정렬은 상수로 분리해 둡니다. 감사 로그라면 `DEFAULT_SORTS = List.of(SortOrder.desc("occurredAt"))` 처럼요. 요청에 정렬이 없으면 이 기본값을 씁니다.

### content 와 count 를 별도 쿼리로

목록 데이터를 가져오는 쿼리와 전체 개수를 세는 쿼리는 따로 실행해요. 두 쿼리가 같은 `BooleanBuilder` 를 재사용하므로 조건 정합이 보장됩니다. 한 번에 묶거나 메모리에서 세는 방식이 아니라, 개수도 DB 가 직접 세는 거예요.

### Q-class 없이 PathBuilder 사용

`PathBuilder<EntityType>` 만으로도 `selectFrom()` 을 호출할 수 있어요. core-impl 모듈에 QueryDsl APT 가 설정돼 있지 않아도 동작합니다. 대신 필드명을 문자열로 다루기 때문에 컴파일 타임 타입 안전성은 약해져요.

도메인이 안정화되면 core-impl 에 `querydsl-apt` 를 추가하고 `QAuditLog.auditLog` 로 교체할 수 있어요. `QueryDslPredicateBuilder.build` 는 `Path<T>` 도 받으므로 호출부 변경이 거의 없습니다.

---

## 통합 테스트 전략

### 계층별 테스트 책임

| 계층 | 테스트 종류 | 위치 |
|---|---|---|
| RequestDTO | compact constructor 검증 | `*SearchRequestTest` (필요 시) |
| Assembler | 변환 정확성 (단위) | `*QueryAssemblerTest` |
| QueryDslPredicateBuilder | 연산자별 SQL 빌드 정합 | common-persistence 가 담당 |
| QueryRepositoryImpl | 실제 SQL 실행 | `*QueryRepositoryIT` (Testcontainers Postgres) |

### 통합 테스트 시나리오

각 도메인의 RepositoryImpl 통합 테스트는 아래 시나리오를 다루기를 권장해요.

1. 단순 조건 1건 — 조회 결과 정확성
2. 다중 AND — 모든 조건을 충족한 행만 매치
3. `in` 다중값 — 부분 매치
4. `between` 범위 — 경계값 포함·미포함 검증
5. `ilike` — 대소문자 무관 매치
6. OR 그룹 — 어느 하나라도 매치
7. AND + OR 결합 — 바깥 AND 와 안쪽 OR
8. 빈 결과 — 매치 0건일 때 크기 0
9. 페이지네이션 — page·size 가 제대로 적용되는지
10. 정렬 — 미지정 시 기본 정렬, 지정 시 적용

---

## 안티 패턴

### 1. RequestDTO 에 변환 메서드 두기

```java
// 안티 패턴
public record UserSearchRequest(...) {
    public Map<String, Object> toConditions() { ... }  // QueryUtil 의존이 core-api 로 새어 들어감
}
```

이러면 ArchUnit r9 (`CORE_API_MUST_NOT_DEPEND_ON_JPA`) 가 깨질 수 있어요. 변환은 Assembler 로 분리합니다.

### 2. Mapper·Converter 로 이름 짓기

```java
// 안티 패턴
public class UserSearchRequestMapper { ... }  // ArchUnit r22 위반
```

`*Assembler` 같은 이름을 씁니다.

### 3. count 쿼리 생략

```java
// 안티 패턴
return new PageImpl<>(content, pageable, content.size());  // 마지막 페이지가 아니면 total 이 틀림
```

전체 개수는 별도 count 쿼리로 세야 합니다.

### 4. 페이징을 메모리에서 처리

```java
// 안티 패턴 — DB 가 전부 가져온 뒤 메모리에서 자르기
List<AuditLog> all = queryFactory.selectFrom(...).fetch();
return all.stream().filter(...).toList().subList(start, end);
```

페이지·필터·정렬은 모두 DB 단에서 처리합니다. `.where().orderBy().offset().limit()` 로요.

### 5. `empty` 연산자를 문자열 아닌 필드에 사용

```java
// 안티 패턴 — 컬렉션 필드에 empty 적용
conditions.put("tags_empty", true);  // tags 가 컬렉션이면 타입 불일치
```

`empty` 는 `field IS NULL OR field = ''` 형태로 빌드돼서 문자열 컬럼 전용이에요. 컬렉션이 비었는지는 이 연산자로 검사할 수 없으니, 별도 쿼리나 JPQL 로 처리합니다.

### 6. 필드명이 연산자 토큰으로 끝나는 경우

```java
// 안티 패턴 — 엔티티 필드명이 count_in
public class Stats {
    private Integer count_in;  // 파서가 field=count, operator=in 으로 오해
}
```

빌더는 키의 마지막 밑줄 뒤를 연산자로 봅니다. `count_in_eq` 를 주면 의도는 `count_in` 필드의 `eq` 지만, 파서가 잘못 끊을 수 있어요. JPA 의 camelCase 컨벤션을 따르면 단어 경계가 대소문자로 구분돼 충돌이 사실상 없어요. 다만 연산자 토큰 (`eq`, `ne`, `like`, `in`, `between`, `isNull` 등) 으로 끝나는 필드명은 의도적으로 피합니다.

---

## 관련 문서

- [`ADR-010 · SearchCondition 공통 조회 인프라`](../philosophy/adr-010-search-condition.md) — 이 패턴을 채택한 설계 근거와 대안 비교
- [`common-persistence README`](../../common/common-persistence/README.md#querydsl-동적-쿼리) — 연산자 전체 표와 사용 예
- [`AuditLog 레퍼런스 구현`](../../core/core-audit-impl/) — RequestDTO·Assembler·QueryRepositoryImpl 의 첫 도메인 적용 사례
- [`ADR-016 · DTO Mapper 금지`](../philosophy/adr-016-dto-mapper-forbidden.md) — Mapper 클래스를 피하는 근거
- [`Naming Conventions`](./naming.md) — DTO suffix 규약
- [`DTO 팩토리 컨벤션`](./dto-factory.md) — Entity → DTO 변환 규약
