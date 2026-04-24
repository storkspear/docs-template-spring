# ADR-010 · SearchCondition + QueryDslPredicateBuilder 공통 조회 인프라

**Status**: Accepted. 현재 유효. 2026-04-20 기준 `common-web/search/` + `common-persistence/QueryDsl*.java` 에 구현. 8개 연산자 지원.

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~5분

## 결론부터

목록 조회 API — "상품 목록, 주문 목록, 유저 목록" — 가 반복하는 **"필드별 if 조건 → WHERE 절 추가"** 패턴을 한 번에 해결하는 인프라입니다. 프론트엔드가 `{"categoryId_eq": 5, "amount_gte": 10000}` 같은 Map 을 보내면, 백엔드는 `QueryDslPredicateBuilder.build(...)` **한 줄** 로 동적 WHERE 절을 생성해요. 각 앱 모듈이 똑같은 if-else 지옥을 반복하지 않아도 됩니다.

## 왜 이런 고민이 시작됐나?

모든 앱의 백엔드는 **목록 조회 API** 를 가집니다. 예:

- 가계부 앱: `GET /expenses?categoryId=5&amountMin=10000&dateFrom=2026-04-01`
- 운동 앱: `GET /workouts?difficulty=high&duration_gte=30`
- 푸드 앱: `GET /restaurants?cuisine=korean&rating_gte=4.5`

각 API 를 **개별로 구현** 하면 모든 앱 모듈이 같은 패턴을 반복하게 됩니다:

```java
// 반복 1 — 가계부 앱
public List<Expense> findExpenses(Long categoryId, Integer amountMin, LocalDate dateFrom) {
    BooleanBuilder where = new BooleanBuilder();
    if (categoryId != null) where.and(QExpense.expense.categoryId.eq(categoryId));
    if (amountMin != null) where.and(QExpense.expense.amount.goe(amountMin));
    if (dateFrom != null) where.and(QExpense.expense.date.goe(dateFrom));
    return queryFactory.selectFrom(QExpense.expense).where(where).fetch();
}

// 반복 2 — 운동 앱
public List<Workout> findWorkouts(String difficulty, Integer durationMin) {
    BooleanBuilder where = new BooleanBuilder();
    if (difficulty != null) where.and(QWorkout.workout.difficulty.eq(difficulty));
    if (durationMin != null) where.and(QWorkout.workout.duration.goe(durationMin));
    return queryFactory.selectFrom(QWorkout.workout).where(where).fetch();
}

// ... 모든 앱의 모든 목록 조회에서 이 패턴 반복
```

**문제들**:
1. **앱 모듈마다 if 지옥 재구현** — 10개 앱 × 5개 목록 조회 = 50곳의 유사 코드.
2. **프론트엔드-백엔드 약속이 매번 다름** — 어떤 앱은 `amount_min`, 어떤 앱은 `minAmount`, 어떤 앱은 `amount[gte]`.
3. **조건 추가 시 Controller/Service 수정** — "검색 조건에 `deletedAt_isNull` 추가" 하려면 모든 레이어 메서드 시그니처 변경.

이 결정이 답해야 할 물음은 이거예요.

> **모든 앱의 목록 조회가 공통으로 쓰는 "조건 → WHERE 절 변환" 을 어떻게 한 번에 해결할 것인가?**

그리고 중요한 부가 질문:

> **프론트엔드와 백엔드의 "검색 조건" 계약을 어떻게 표준화할 것인가?**

## 고민했던 대안들

### Option 1 — 타입 세이프 Condition DTO (각 도메인별)

각 도메인마다 검색 조건 DTO 를 정의. 타입 안전 + 필드 자동완성.

```java
public record ExpenseSearchCondition(
    Long categoryId,
    Integer amountMin,
    Integer amountMax,
    LocalDate dateFrom,
    LocalDate dateTo,
    String descriptionLike
) {}

// Service 에서
public List<Expense> find(ExpenseSearchCondition cond) {
    BooleanBuilder where = new BooleanBuilder();
    if (cond.categoryId() != null) where.and(QExpense.expense.categoryId.eq(cond.categoryId()));
    // ... 여전히 if 지옥
}
```

- **장점**:
  - **컴파일 타임 검증** — 없는 필드를 프론트가 보내도 깔끔히 거절.
  - IDE 자동완성 작동.
  - 각 도메인 고유 조건 표현 가능.
- **단점**:
  - **조건 추가 시 DTO 수정 필수** — "`ratingMin` 을 추가" 하려면 Controller, Service, DTO 세 곳 수정.
  - 앱마다 DTO 가 N개 — 앱 공장 패턴 (여러 앱 빠르게) 에 맞지 않음.
  - if 지옥은 여전 — DTO 가 있어도 Service 안에서 필드별 if 는 반복.
- **탈락 이유**: 공장 패턴 에서는 **확장성** 이 가장 중요. DTO 수정 비용이 매번 발생.

### Option 2 — Spring Data Specifications

Spring Data JPA 의 `Specification<T>` 인터페이스 사용. 조건을 람다/메서드 체인으로 조합.

```java
Specification<Expense> spec = where(categoryEq(5))
    .and(amountGte(10000))
    .and(dateFromGte(LocalDate.of(2026, 4, 1)));
List<Expense> result = repository.findAll(spec);
```

- **장점**: Spring Data 표준. 타입 안전. 재사용 가능한 Specification 조각.
- **단점**:
  - 각 조건을 별도 Specification 메서드로 정의해야 함 — 도메인마다 수십 개 메서드 필요.
  - 프론트엔드 → 백엔드 **변환 레이어 필요** — JSON Map → Specification 으로 변환하는 코드가 결국 필요.
  - **QueryDsl 보다 표현력 부족** — 서브쿼리, 동적 정렬, 윈도우 함수 등에서 제약.
- **탈락 이유**: 결국 "if 지옥을 Specification 으로 옮겼을 뿐" 이라 궁극 해결 안 됨. 우리가 원하는 건 **변환 자체의 자동화**.

### Option 3 — Map<String, Object> 기반 + QueryDslPredicateBuilder ★ (채택)

프론트엔드가 `{field}_{operator}: value` 형식의 Map 을 보내고, 백엔드는 빌더가 **자동으로** BooleanBuilder 생성.

```java
// 프론트엔드 요청
{
  "categoryId_eq": 5,
  "amount_gte": 10000,
  "date_gte": "2026-04-01",
  "description_like": "커피"
}

// 백엔드 — 한 줄 처리
BooleanBuilder where = QueryDslPredicateBuilder.build("expense", conditions);
List<Expense> result = queryFactory.selectFrom(QExpense.expense).where(where).fetch();
```

- **장점**:
  - **추가 조건 = 코드 변경 없음** — 프론트가 `status_eq` 를 새로 보내기 시작해도 백엔드 변경 불필요 (엔티티에 해당 필드만 있으면).
  - 앱마다 DTO 안 만들어도 됨. 공장 패턴에 적합.
  - 프론트엔드 ↔ 백엔드 **통일된 계약** (`{field}_{operator}` 형식).
  - 빌더 자체는 **common-persistence** 에 한 번만 있음 — 유지보수 단일 위치.
- **단점**:
  - **컴파일 타임 검증 없음** — 프론트가 없는 필드 `nonexistent_eq` 를 보내면 런타임에 `QueryDsl` 에러.
  - **타입 체크 제한** — Map value 가 `Object` 라 실제 변환이 런타임에 일어남.
  - **복잡한 쿼리 표현 부족** — "이 조건이 만족되면 저것도" 같은 분기 조건은 Map 으로 표현 어려움.
- **완화**: 복잡한 쿼리는 **앱 모듈의 커스텀 Repository** 에서 직접 구현. Map 기반은 **일반적인 목록 조회의 공통 인프라** 만 담당.

## 결정

Map 기반 조건을 표준 계약으로 하고, `QueryDslPredicateBuilder` 가 자동 변환합니다.

### 구조 분리

```
common-web/search/                  ← 순수 Java DTO (QueryDsl 비의존)
├── PageListRequest.java            ← { conditions, sort, page, size }
├── PageListResponse.java           ← { items, total, page, size }
├── PageListResult.java             ← 내부 결과 홀더
├── SortOrder.java                  ← ASC/DESC enum
└── SortFieldMapper.java            ← "createdAt" → QEntity.entity.createdAt 매핑

common-persistence/                 ← QueryDsl 의존
├── QueryDslPredicateBuilder.java   ← Map → BooleanBuilder 변환
├── QueryDslSortBuilder.java        ← SortOrder → OrderSpecifier
└── QueryUtil.java                  ← 헬퍼 유틸
```

### 왜 두 모듈로 분리했는가

`common-web` 은 **순수 Java + Spring Web 만** 의존. JPA 없음. 이 원칙 ([`ADR-003`](./adr-003-api-impl-split.md) 의 "api 는 JPA-free") 을 지키기 위해 순수 DTO 와 QueryDsl 변환을 분리했어요.

- `PageListRequest`, `SortOrder` 같은 **계약 DTO** → `common-web/search/` (JPA 의존 없음)
- `QueryDslPredicateBuilder` → `common-persistence/` (QueryDsl + JPA 의존)

앱의 **Controller** 는 `PageListRequest` 만 받고, **Service** 에서 QueryDslPredicateBuilder 호출. 레이어 간 의존 방향이 깔끔.

### Map 기반 조건 규칙 (8개 연산자)

키 형식: `{field}_{operator}` (밑줄로 분리, 연산자는 밑줄 포함 불가)

| 키 형식 | 의미 | 예시 |
|---|---|---|
| `field_eq` | 일치 | `"categoryId_eq": 5` |
| `field_gte` | 이상 (≥) | `"amount_gte": 10000` |
| `field_lte` | 이하 (≤) | `"amount_lte": 50000` |
| `field_gt` | 초과 (>) | `"age_gt": 18` |
| `field_lt` | 미만 (<) | `"age_lt": 65` |
| `field_like` | 부분 매칭 (대소문자 무시) | `"title_like": "커피"` |
| `field_isNull` | null 여부 | `"deletedAt_isNull": true` |
| `field_isNotNull` | not null 여부 | `"verifiedAt_isNotNull": true` |

필드명에 밑줄이 있어도 됨 — `app_slug_eq` → field=`"app_slug"`, operator=`"eq"` 로 정확히 분리 (`lastIndexOf('_')` 사용).

### `QueryDslPredicateBuilder` 핵심 구현

```java
public final class QueryDslPredicateBuilder {

    public static BooleanBuilder build(String entityVariable, Map<String, Object> conditions) {
        BooleanBuilder builder = new BooleanBuilder();
        PathBuilder<Object> entityPath = new PathBuilder<>(Object.class, entityVariable);

        for (Map.Entry<String, Object> entry : conditions.entrySet()) {
            String key = entry.getKey();
            Object value = entry.getValue();

            // lastIndexOf('_') 로 field 와 operator 분리
            int lastUnderscore = key.lastIndexOf('_');
            if (lastUnderscore < 0) {
                log.warn("Invalid condition key format: {}", key);
                continue;
            }

            String field = key.substring(0, lastUnderscore);
            String operator = key.substring(lastUnderscore + 1);

            switch (operator) {
                case "eq" -> builder.and(entityPath.get(field).eq(value));
                case "like" -> {
                    if (value instanceof String str) {
                        builder.and(entityPath.getString(field).containsIgnoreCase(str));
                    }
                }
                case "gte" -> {
                    if (value instanceof Comparable c) {
                        builder.and(entityPath.getComparable(field, Comparable.class).goe(c));
                    }
                }
                // ... 나머지 연산자
                default -> log.warn("Unknown operator '{}' in key '{}'", operator, key);
            }
        }

        return builder;
    }
}
```

**핵심 기법** — `PathBuilder<Object>` 는 QueryDsl 의 동적 쿼리 API. 필드명을 **문자열** 로 받아서 `entityPath.get("categoryId")` 처럼 런타임 접근. Q-클래스 (`QExpense.expense`) 를 컴파일 타임에 특정하지 않아도 됩니다.

### 실제 사용 예시

```java
// Controller
@PostMapping("/search")
public PageListResponse<ExpenseSummary> search(@RequestBody PageListRequest req) {
    return expenseService.search(req);
}

// Service
public PageListResponse<ExpenseSummary> search(PageListRequest req) {
    BooleanBuilder where = QueryDslPredicateBuilder.build("expense", req.conditions());
    List<Expense> results = queryFactory.selectFrom(QExpense.expense)
        .where(where)
        .orderBy(QueryDslSortBuilder.build("expense", req.sort()))
        .offset(req.page() * req.size())
        .limit(req.size())
        .fetch();

    long total = queryFactory.selectFrom(QExpense.expense).where(where).fetchCount();

    return PageListResponse.of(
        results.stream().map(Expense::toSummary).toList(),  // DTO 변환은 Entity 메서드 (ADR-016)
        total, req.page(), req.size()
    );
}
```

Service 메서드 전체가 **10줄 내외** 로 끝납니다. 필드 추가 시 엔티티에 `@Column` 만 넣으면 프론트가 바로 조건으로 사용 가능.

## 이 선택이 가져온 것

### 긍정적 결과

**조건 추가 비용 0** — 엔티티에 필드가 있으면 프론트가 새 조건을 즉시 사용 가능. Controller / Service / DTO 수정 필요 없음. 이게 앱 공장 전략 (여러 앱 빠르게) 에 가장 잘 맞는 부분.

**프론트엔드 ↔ 백엔드 통일 계약** — 모든 앱의 목록 조회 API 가 **같은 형식** 의 Map 을 받음. 프론트엔드 개발자는 새 엔드포인트 만날 때마다 별도 학습 없이 바로 사용.

**Service 레이어 간결** — 필드별 if 지옥이 사라짐. Service 가 "조건 받기 → 쿼리 실행 → DTO 변환" 의 3단계로 명확.

**유지보수 단일 위치** — 새 연산자 (예: `field_in` - `IN` 절) 를 추가할 때 `QueryDslPredicateBuilder` 한 곳만 수정.

### 부정적 결과

**컴파일 타임 검증 없음** — 프론트가 `nonexistent_eq` 같은 없는 필드를 보내면 런타임 `QueryDsl` 예외. 완화: API 문서 (OpenAPI) 에 지원 필드 명시 + 테스트 단계에서 조기 발견.

**타입 체크 런타임** — `Map<String, Object>` 라 JSON 역직렬화 시 타입 판단이 런타임. 예: `"amount_gte": "10000"` (문자열) vs `10000` (숫자). 완화: Jackson 이 엔티티 필드 타입 기반으로 자동 변환 (대부분 케이스), 실패 시 400 Bad Request.

**복잡한 쿼리 표현 부족** — "CASE WHEN... THEN..." 같은 SQL 함수, 서브쿼리, 윈도우 함수 등은 Map 으로 표현 불가. 완화: 복잡한 쿼리는 **앱 모듈의 커스텀 Repository** 에서 직접 QueryDsl 이나 JPQL 로 구현. Map 기반은 **일반 목록 조회의 90%** 만 커버.

### 감당 가능성 판단

단점들은 "**일반 목록 조회의 범위 안에서**" 는 거의 발생하지 않음. 복잡한 비즈니스 쿼리는 어차피 커스텀 구현이 맞음. 이 인프라는 "같은 패턴의 반복" 을 없애는 게 목적이고, 그 목적은 완벽히 달성.

## 교훈

### `lastIndexOf('_')` 를 쓴 이유

초기 구현은 `key.split("_")` 로 field / operator 분리했어요. 문제는 `app_slug_eq` 같은 **필드명에 밑줄이 있는 경우** — `split` 이 3개로 쪼개져서 `app`, `slug`, `eq` 가 됨.

```java
// 초기 구현 (버그)
String[] parts = key.split("_");
String field = parts[0];         // "app" — 의도: "app_slug"
String operator = parts[1];      // "slug" — 의도: "eq"

// 수정 후
int lastUnderscore = key.lastIndexOf('_');
String field = key.substring(0, lastUnderscore);         // "app_slug" ✅
String operator = key.substring(lastUnderscore + 1);     // "eq" ✅
```

**교훈**: 구분자 기반 파싱은 **끝에서부터** 하는 게 안전합니다. 필드명에 어떤 문자가 올 수 있을지 모를 때 특히.

### Spring Data `Specification` vs 커스텀 빌더 — 장기 유지보수

Option 2 (Spring Data Specifications) 를 버리고 커스텀 빌더를 만든 판단이 맞았는지 1년 정도 뒤 재검토한 적이 있어요. 결론: **커스텀이 유지** 되었습니다.

근거:
- 새 연산자 추가가 쉬움 (switch 에 case 하나)
- Specification 이었으면 "Specification<Expense>", "Specification<Workout>" 같은 타입 인스턴스를 각 도메인마다 만들어야 했음
- 공장 패턴 (여러 앱 빠르게) 에서 도메인별 Specification 메서드 유지가 부담

**교훈**: 표준 도구가 항상 정답은 아님. **우리의 특수 요구 (공장 패턴)** 에 맞게 커스텀이 더 가벼울 때가 있어요. 단 이 판단은 **주기적 재검토 필요** — 요구 변경 시 표준 도구가 더 나아질 수 있음.

## 관련 사례 (Prior Art)

- **[Spring Data JPA Specifications](https://docs.spring.io/spring-data/jpa/docs/current/reference/html/#specifications)** — Option 2 로 검토한 Spring 표준. 필요해지면 이행 경로.
- **[QueryDsl Reference](http://querydsl.com/static/querydsl/latest/reference/html/)** — `PathBuilder` API 의 공식 문서. 본 ADR 의 동적 쿼리 기법 출처.
- **[Jdbi, jOOQ](https://www.jooq.org/)** — 다른 Java 쿼리 빌더 접근. QueryDsl 과 비교 가능.
- **Ransack (Rails)** — Ruby on Rails 의 유사 개념. `name_cont`, `age_gteq` 같은 suffix 기반 필드 매핑이 본 ADR 의 영감 중 하나.
- **GraphQL 의 `where` 입력 타입** — Hasura, PostGraphile 등이 사용하는 `{ field: { _eq: value } }` 중첩 구조. 우리는 평면 Map 으로 단순화.

## Code References

**순수 Java DTO** (`common-web/search/`):
- [`PageListRequest.java`](https://github.com/storkspear/spring-backend-template/blob/main/common/common-web/src/main/java/com/factory/common/web/search/PageListRequest.java)
- [`PageListResponse.java`](https://github.com/storkspear/spring-backend-template/blob/main/common/common-web/src/main/java/com/factory/common/web/search/PageListResponse.java)
- [`PageListResult.java`](https://github.com/storkspear/spring-backend-template/blob/main/common/common-web/src/main/java/com/factory/common/web/search/PageListResult.java)
- [`SortOrder.java`](https://github.com/storkspear/spring-backend-template/blob/main/common/common-web/src/main/java/com/factory/common/web/search/SortOrder.java)
- [`SortFieldMapper.java`](https://github.com/storkspear/spring-backend-template/blob/main/common/common-web/src/main/java/com/factory/common/web/search/SortFieldMapper.java)
- [`PageListQuery.java`](https://github.com/storkspear/spring-backend-template/blob/main/common/common-web/src/main/java/com/factory/common/web/search/PageListQuery.java)

**QueryDsl 변환** (`common-persistence/`):
- [`QueryDslPredicateBuilder.java`](https://github.com/storkspear/spring-backend-template/blob/main/common/common-persistence/src/main/java/com/factory/common/persistence/QueryDslPredicateBuilder.java) — 78줄, 8개 연산자
- [`QueryDslSortBuilder.java`](https://github.com/storkspear/spring-backend-template/blob/main/common/common-persistence/src/main/java/com/factory/common/persistence/QueryDslSortBuilder.java)
- [`QueryDslAutoConfiguration.java`](https://github.com/storkspear/spring-backend-template/blob/main/common/common-persistence/src/main/java/com/factory/common/persistence/QueryDslAutoConfiguration.java)
- [`QueryUtil.java`](https://github.com/storkspear/spring-backend-template/blob/main/common/common-persistence/src/main/java/com/factory/common/persistence/QueryUtil.java)
