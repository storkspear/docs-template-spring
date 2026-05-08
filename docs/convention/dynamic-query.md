# Dynamic Query 컨벤션

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~7분

이 문서는 **다중 조건 동적 검색** (관리자 audit 조회, 사용자 검색, 청구 내역 필터링 등) 의 표준 패턴을 정의해요.

핵심 흐름: **RequestDTO → Assembler → conditions Map → QueryDslPredicateBuilder → JPAQuery**.

---

## 왜 이 패턴인가

서비스가 커지면 검색 화면마다 *조건 9~15개* 정도가 일반화돼요. 매 도메인마다 `if (xxx != null) ...` 가 반복되는 boilerplate 가 누적되면, **새 조건 추가 비용**, **테스트 비용**, **N+1 risk** 모두 증가해요.

본 패턴은 그 boilerplate 를 `QueryDslPredicateBuilder` 한 곳으로 흡수해서:
- 새 조건 추가 = `Map.put()` 한 줄
- operator 의 정합성은 `QueryDslPredicateBuilder` 단위 테스트가 담보
- 도메인은 *어떤 필드가 어떤 operator 에 매핑되는가* 만 결정 (Assembler)

---

## 4-Layer 구조

```
[Controller]
   ↓ (HTTP body / query → record 바인딩)
[RequestDTO record] (core-*-api)
   - 순수 데이터. JPA / QueryDsl 의존 0
   - compact constructor 로 page/size 기본값 보정
   ↓
[Assembler] (core-*-impl/repository, package-private)
   - RequestDTO → Map<String, Object> 변환
   - 클래스명 *Assembler 권장 (ArchUnit r22 NO_MAPPER 회피)
   ↓
[QueryDslPredicateBuilder.build(entityPath, conditions)] (common-persistence)
   - Map → BooleanBuilder
   ↓
[QueryRepositoryImpl] (core-*-impl/repository)
   - JPAQueryFactory.selectFrom(entity).where(builder).orderBy(...).fetch()
```

각 레이어 책임 분리는 **테스트 가능성** 을 위해 중요해요.
- RequestDTO: compact constructor 검증 (단순 단위 테스트)
- Assembler: 변환 정확성 검증 (JPA 의존 0 — 빠른 테스트)
- PredicateBuilder: 14 operator 의 SQL 정합 (common-persistence 가 책임)
- RepositoryImpl: 실제 SQL 실행 (Testcontainers IT)

---

## RequestDTO 설계

### 명명

- 검색 요청 DTO 는 `*SearchRequest` (예: `AuditLogSearchRequest`, `UserSearchRequest`)
- ArchUnit r19 (DTO 명명 suffix) 통과
- ADR-016 정신: pure record + 변환 메서드 X (Assembler 가 담당)

### 필드 권장 패턴

| 검색 요건 | 필드 타입 | 예시 |
|---|---|---|
| 정확 매치 (id) | `Long` / `String` (nullable) | `Long actorUserId` |
| 부분 매치 (이름/이메일) | `String` (nullable) | `String actorEmail` |
| 다중 선택 | `List<String>` (nullable, empty=skip) | `List<String> actions` |
| Enum | `EnumType` (nullable) | `AuditResult result` |
| 기간 (open/closed) | `Instant from`, `Instant to` | `Instant occurredFrom, occurredTo` |
| 정렬 | `List<SortOrder>` | (compact constructor 에서 null → empty list) |
| 페이지 | `int page, int size` | (compact constructor 에서 음수/0 보정) |

### Compact constructor 보정

```java
public record AuditLogSearchRequest(
    Long actorUserId, String actorEmail, List<String> actions, ...
    List<SortOrder> sorts, int page, int size) {

    public AuditLogSearchRequest {
        if (page < 0) page = 0;
        if (size <= 0) size = 20;
        if (sorts == null) sorts = List.of();
    }
}
```

→ Controller 가 `null` 또는 음수를 보내도 record 가 자체적으로 안전한 기본값으로 보정해요.

---

## Assembler 패턴

### 위치 + 가시성

- 위치: `core/core-{domain}-impl/repository/`
- 가시성: **package-private** (final + private constructor + static methods only)
- ADR-016 (Mapper 금지) 회피 — 클래스명에 `Mapper` / `Converter` 들어가면 ArchUnit r22 위반. `*Assembler`, `*Translator`, `*QueryAdapter` 등 채택.

### 본문 패턴

```java
final class AuditLogQueryAssembler {

    private AuditLogQueryAssembler() {}

    static Map<String, Object> toConditions(AuditLogSearchRequest req) {
        Map<String, Object> conditions = new LinkedHashMap<>();

        QueryUtil.addCondition(conditions, "actorUserId_eq", req.actorUserId());
        QueryUtil.addCondition(conditions, "actorEmail_ilike", req.actorEmail());
        QueryUtil.addCondition(conditions, "action_in", req.actions());
        QueryUtil.addCondition(conditions, "result_eq", req.result());

        // 양쪽 / 한 쪽 / 둘 다 null 분기 — between/gte/lte 자동 선택
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

### Assembler 테스트

- JPA 의존 X — 순수 단위 테스트로 검증
- "각 필드 → 어떤 키로 변환되는가" 의 정확성 확인
- "blank string / empty list / null 자동 skip" 의 boundary 케이스
- 테스트 파일: `core-{domain}-impl/src/test/.../{Domain}QueryAssemblerTest.java`

---

## Map key format (간단 참조)

자세한 표는 [`common/common-persistence/README.md`](../../common/common-persistence/README.md#querydsl-동적-쿼리) 참조.

| 카테고리 | operator (cs) | i-variant (ci) |
|---|---|---|
| 동등성 | `eq` (default), `ne` | `ieq`, `ine` |
| 문자열 | `like`, `startsWith`, `endsWith` | `ilike`, `istartsWith`, `iendsWith` |
| 비교 | `gt`, `gte`, `lt`, `lte` | (없음) |
| 집합 | `in`, `notIn` | (없음) |
| 범위 | `between` | (없음) |
| NULL | `isNull`, `isNotNull` | (없음) |
| 빈값 | `empty` | (없음) |
| 그룹 | `or`, `and` | (없음) |

> **case-sensitive default**: 일반 인덱스 사용 가능. ci variant 는 `LOWER()` 함수 인덱스 또는 full scan 이라 비용 trade-off 가 명시적이도록 분리.

---

## OR 그룹 사용 시점

OR 가 필요한 진짜 case 는 **"어느 한 필드라도 매치"** 가 핵심. 가장 흔한 예는 사용자 통합 검색:

```java
// "사용자가 입력한 키워드" 가 이름 OR 이메일 OR 닉네임 어디든 매치되면 OK
String keyword = req.keyword();
if (StringUtils.hasText(keyword)) {
    conditions.put("or", QueryUtil.or(
        "name_ilike", keyword,
        "email_ilike", keyword,
        "nickname_ilike", keyword
    ));
}
```

→ 외곽 AND (다른 조건들과) + 내부 OR (3 필드 중 하나) 가 적절히 결합돼요.

### OR / AND 그룹의 형식 비대칭 (foot-gun 주의)

`"or"` / `"and"` 키의 value 는 **두 형식이 의미가 다릅니다**:

| 형식 | 결과 | 예 |
|---|---|---|
| `"or": Map` | 각 entry 가 OR 결합 (flat OR) | `or: {a_eq:1, b_eq:2}` → `a=1 OR b=2` |
| `"or": List<Map>` | 각 element 내부 keys = AND, element 끼리 = OR | `or: [{a_eq:1, b_eq:2}, {c_eq:3}]` → `(a=1 AND b=2) OR c=3` |
| `"or": List<single-key Map>` | 결과적으로 flat OR | `or: [{a_eq:1}, {b_eq:2}]` → `a=1 OR b=2` |

`QueryUtil.or(k1, v1, k2, v2)` 는 `List<single-key Map>` 을 반환 — flat OR 가 의도. 복잡한 "OR of ANDs" 는 직접 List<Map> 구성 필요.

### OR 안 쓰는 게 좋은 case

같은 필드의 여러 값 매치는 OR 가 아니라 `_in`:

```java
// X — OR 그룹 남용
conditions.put("or", List.of(
    Map.of("status_eq", "ACTIVE"),
    Map.of("status_eq", "PENDING")
));

// O — _in 사용 (인덱스 효율 ↑)
conditions.put("status_in", List.of("ACTIVE", "PENDING"));
```

---

## QueryRepository + Impl 패턴

### Custom Repository 결합

```java
// 1. JpaRepository 와 별도 interface 정의
public interface AuditLogQueryRepository {
    Page<AuditLog> search(AuditLogSearchRequest request);
}

// 2. 기존 Repository 가 둘 다 extends
public interface AuditLogRepository
    extends JpaRepository<AuditLog, Long>, AuditLogQueryRepository {}

// 3. Spring Data JPA 가 *RepositoryImpl 명명 규약으로 자동 wire
public class AuditLogQueryRepositoryImpl implements AuditLogQueryRepository {
    private final JPAQueryFactory queryFactory;
    // ...
}
```

→ 호출부 (Service) 는 `AuditLogRepository` 한 곳만 의존하면 됨. JPA finder + 동적 search 둘 다 같은 인터페이스에서 호출.

### RepositoryImpl 본문

```java
@Override
public Page<AuditLog> search(AuditLogSearchRequest request) {
    PathBuilder<AuditLog> entityPath = new PathBuilder<>(AuditLog.class, "auditLog");
    Map<String, Object> conditions = AuditLogQueryAssembler.toConditions(request);

    BooleanBuilder where = QueryDslPredicateBuilder.build(entityPath, conditions);
    OrderSpecifier<?>[] orders = QueryDslSortBuilder.build(entityPath,
        request.sorts().isEmpty() ? DEFAULT_SORTS : request.sorts());

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
        total == null ? 0 : total);
}
```

### count 별도 쿼리 (N+1 방지)

content fetch 와 count 가 별 쿼리. **둘 다 동일 BooleanBuilder 재사용** — 조건 정합 보장 + N+1 risk 0.

### Q-class 없이 PathBuilder 사용

`PathBuilder<EntityType>` 만으로 `selectFrom()` 호출 가능. Q-class APT 가 모듈에 미설정인 경우에도 동작. 단점: 컴파일 타임 type-safety 가 약해짐 (필드명 string).

→ 도메인이 안정화되면 `core-*-impl` 에 querydsl-apt 추가하고 `QAuditLog.auditLog` 로 교체 가능.

---

## 통합 테스트 전략

### Layer 별 테스트 책임

| Layer | 테스트 종류 | 위치 |
|---|---|---|
| RequestDTO | record compact constructor 검증 | `*SearchRequestTest` (있을 시) |
| Assembler | 변환 정확성 (단위) | `*QueryAssemblerTest` |
| QueryDslPredicateBuilder | 14 operator 의 SQL 빌드 정합 | common-persistence 가 책임 |
| RepositoryImpl | 실제 SQL 실행 (Testcontainers Postgres) | `*QueryRepositoryIT extends AbstractIntegrationTest` |

### IT 시나리오 권장

각 도메인의 RepositoryImpl IT 는 다음 시나리오 cover 권장:

1. **단순 조건 1건** — 조회 결과 정확성
2. **다중 AND** — 모든 조건 충족만 매치
3. **`_in` 다중값** — 부분 매치
4. **`_between` 범위** — 경계값 (포함/미포함) 검증
5. **`_ilike` ci** — 대소문자 무관 매치
6. **OR 그룹** — 어느 하나라도 매치
7. **AND + OR 결합** — 외곽 AND + 내부 OR
8. **빈 결과** — 매치 0건 시 size 0
9. **페이지네이션** — page/size 가 적절히 적용
10. **정렬** — sorts 미지정 시 default, 지정 시 적용

---

## 안티 패턴

### 1. RequestDTO 에 변환 메서드 두기

```java
// X
public record UserSearchRequest(...) {
    public Map<String, Object> toConditions() { ... }  // JPA/QueryUtil 의존이 core-api 로 누수
}
```

→ ArchUnit r9 (CORE_API_MUST_NOT_DEPEND_ON_JPA) 위반 가능. Assembler 로 분리.

### 2. *Mapper / *Converter 명명

```java
// X
public class UserSearchRequestMapper { ... }  // ArchUnit r22 NO_MAPPER 위반
```

→ `*Assembler` / `*Translator` / `*QueryAdapter` 사용.

### 3. count 쿼리 미실행

```java
// X
return new PageImpl<>(content, pageable, content.size());  // 마지막 페이지 외엔 잘못된 total
```

→ 별도 count 쿼리 필요.

### 4. 페이징 + memory filter

```java
// X — DB 가 다 가져온 후 메모리 필터
List<AuditLog> all = queryFactory.selectFrom(...).fetch();
return all.stream().filter(...).toList().subList(start, end);
```

→ 페이지/필터/정렬 모두 **DB 단** (`.where().orderBy().offset().limit()`) 에서 처리.

### 5. `_empty` operator 를 String 외 필드에 사용

```java
// X — 컬렉션이나 JSON 필드에 _empty 사용
conditions.put("tags_empty", true);  // tags 가 List<String> 컬럼이면 ClassCastException
```

→ `_empty` 는 `LOWER(field) IS NULL OR field = ''` 형태 SQL 빌드라 **String 컬럼 전용**. 컬렉션 비어있음 검사는 별도 `*_size_eq=0` 같은 운영자가 필요 — 현재 미지원이므로 직접 SQL 또는 JPQL.

### 6. field 이름이 reserved operator token 으로 끝나는 경우

```java
// X — entity 필드명이 'count_in' 같은 이름
public class Stats {
    private Integer count_in;  // parser 가 field=count + op=in 으로 잘못 해석
}

// 검색 시: conditions.put("count_in_eq", 5);
// → 의도: field=count_in, op=eq
// → 실제: field=count, op=in_eq → unknown op fallback → field=count_in_eq, op=eq → SQL 컬럼 미존재 fail
```

→ JPA convention 의 camelCase 사용 시 충돌 거의 발생 안 함 (단어 사이 대소 구분). 단 의도적으로 reserved token (eq/ne/like/in/notIn/gt/gte/lt/lte/between/isNull/isNotNull/empty/startsWith/endsWith + i-variants) 으로 *끝나는* 필드명은 회피.

---

## 관련 문서

- [`common-persistence README`](../../common/common-persistence/README.md) — `QueryDslPredicateBuilder` 의 14 operator 표 + 사용 예
- [`AuditLog 레퍼런스 구현`](../../core/core-audit-impl/) — RequestDTO + Assembler + QueryRepositoryImpl 의 첫 도메인 적용 사례
- [`ADR-016 · DTO Mapper 금지`](../philosophy/adr-016-dto-mapper-forbidden.md) — Mapper 패턴 회피 근거
- [`Naming Conventions`](./naming.md) — DTO suffix 규약 (`*Request`, `*Response`)
- [`DTO 팩토리 컨벤션`](./dto-factory.md) — Entity → DTO 변환 (`toX()`) 규약
