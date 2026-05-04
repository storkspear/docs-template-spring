# ADR-010 · SearchCondition + QueryDslPredicateBuilder 공통 조회 인프라

**Status**: Accepted. 현재 유효. 2026-04-20 기준 `common-web/search/` + `common-persistence/QueryDsl*.java` 에 구현. 8개 연산자 지원.

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~5분

## 결론부터

거의 모든 앱 백엔드가 *상품 목록*, *주문 목록*, *유저 목록* 같은 **목록 조회 API** 를 갖습니다. 그리고 이들 API 는 *필드별로 조건이 들어왔는지 검사해서 WHERE 절에 추가* 하는 똑같은 if-else 패턴을 반복해요. 도메인이 바뀌어도 패턴은 그대로 — `categoryId` 가 들어왔으면 추가, `amountMin` 이 들어왔으면 추가, `dateFrom` 이 들어왔으면 추가.

`SearchCondition` 은 그 반복을 한 번에 해결하는 공통 조회 인프라입니다. 프론트엔드가 `{"categoryId_eq": 5, "amount_gte": 10000}` 같은 평면 Map 을 보내면, 백엔드는 `QueryDslPredicateBuilder.build(...)` 한 줄로 동적 WHERE 절을 자동 생성해요. Service 코드는 *조건 받기 → 쿼리 실행 → DTO 변환* 의 세 단계로 명확해지고, 새 조건을 추가하려고 Controller / Service / DTO 를 동시에 수정할 일이 없어집니다. Rails 의 *Ransack* 이 같은 정신을 ActiveRecord 위에서 구현해 둔 사례예요.

이 ADR 은 그 인프라의 구체 모양 — Map 키 형식 (`{field}_{operator}`), 8 개 연산자 정의, `common-web` 의 순수 DTO 와 `common-persistence` 의 QueryDsl 변환을 두 모듈로 분리한 이유, 그리고 *공장 패턴 (여러 앱 빠르게)* 에 맞춰 *컴파일 타임 안전성을 일부 포기한* 트레이드오프 — 를 어떻게 잡았는지 기록합니다.

## 왜 이런 고민이 시작됐나?

가계부 앱은 *카테고리 / 금액 범위 / 날짜 범위 / 설명 검색* 으로 지출을 조회하고, 운동 앱은 *난이도 / 시간 범위* 로 운동 기록을 조회하고, 식당 앱은 *지역 / 평점 / 가격대* 로 가게를 조회해요. 도메인은 다르지만 *어떤 필드가 들어왔는지 보고 WHERE 절을 동적으로 조립* 하는 흐름은 똑같습니다.

순진하게 구현하면 Service 메서드 마다 다음 같은 if 지옥이 반복돼요.

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

이 단계에서 *if 지옥의 반복* 이 세 가지 부담을 누적시킵니다.

첫째는 **앱 모듈마다 같은 패턴이 재구현** 된다는 점이에요. 앱 공장 전략 ([`제약 3`](./README.md#제약-3--복권-사기-모델)) 으로 앱이 N 개 늘어나고 각 앱의 목록 조회 엔드포인트가 5 개 정도라면, 곧 *50 곳의 유사 코드* 가 깔립니다. 한 곳의 버그를 발견해도 나머지 49 곳에 같은 버그가 있는지 확인해야 해요.

둘째는 **프론트엔드 ↔ 백엔드의 검색 계약이 매번 달라진다** 는 점입니다. 어떤 앱은 `amount_min`, 어떤 앱은 `minAmount`, 어떤 앱은 GraphQL 식 `amount[gte]` — 프론트 개발자가 새 앱 엔드포인트를 만날 때마다 *이 앱의 검색 컨벤션* 을 다시 학습해야 해요. 통일된 계약이 없으면 *공통 검색 컴포넌트* 를 프론트에서 재사용할 수도 없습니다.

셋째는 **새 조건 추가가 모든 레이어를 건드린다** 는 점이에요. *검색에 `deletedAt_isNull` 을 추가하자* 같은 한 줄짜리 변경이 Controller 시그니처, Service 시그니처, DTO 정의를 모두 수정해야 하는 *세 곳 변경* 으로 커집니다. 변경의 비용이 *조건 한 개당 세 곳* 이면 *조건이 늘어날수록 변경이 어려워지는* 역방향 인센티브가 작동해요.

이 결정이 답해야 할 물음은 이거예요.

> **모든 앱의 목록 조회가 공통으로 쓰는 "조건 → WHERE 절 변환" 을 어떻게 한 번에 해결하고, 프론트엔드와 백엔드의 검색 계약을 어떻게 표준화할 것인가?**

## 고민했던 대안들

### Option 1 — 타입 세이프 Condition DTO (도메인별)

가장 *Java 다운* 접근입니다. 각 도메인마다 검색 조건을 record 로 명시하고, Controller 가 그 타입을 직접 받아 Service 로 전달해요. IDE 자동완성과 컴파일 타임 타입 검증이라는 강력한 무기가 따라옵니다.

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

매력은 분명해요. 프론트엔드가 *없는 필드* 를 보내면 Jackson 단계에서 깔끔하게 거절되고, 각 도메인 고유의 *복잡한 조건* (예: 위치 기반 검색에서 `latitude` + `longitude` + `radiusKm` 묶음) 도 자연스럽게 record 안에 표현할 수 있어요. 운영 규모가 커서 *조건 정의의 안정성* 이 *추가 비용* 보다 비싼 환경에는 적합합니다.

문제는 두 가지예요. 첫째, *조건 한 개를 추가* 하려면 record 정의에 필드 추가 → Controller 시그니처 / Swagger 문서 업데이트 → Service 의 if 분기 추가 → 테스트 — 이렇게 *세~네 곳* 을 수정해야 합니다. 앱 공장 전략에서는 *조건 추가가 매일 일어나는* 작업이라 누적 비용이 무시 못 할 수준이에요. 둘째, *if 지옥 자체* 가 사라지지 않습니다. record 가 있어도 Service 안에서 *필드별 if 분기* 는 그대로 반복돼요.

탈락 이유는 *공장 패턴에서 확장성 (조건 추가 비용) 이 가장 중요한 축* 이라는 점이에요. 안정성을 얻는 대신 매일 발생하는 추가 비용을 내야 해서 트레이드오프가 우리 환경에 안 맞습니다.

### Option 2 — Spring Data Specifications

Spring Data JPA 가 제공하는 표준 동적 쿼리 도구입니다. 조건을 *Specification* 이라는 작은 함수로 만들고, 람다나 메서드 체인으로 조합하는 형태예요.

```java
Specification<Expense> spec = where(categoryEq(5))
    .and(amountGte(10000))
    .and(dateFromGte(LocalDate.of(2026, 4, 1)));
List<Expense> result = repository.findAll(spec);
```

장점은 *Spring Data 표준* 이라는 사실 자체에서 옵니다. 문서가 풍부하고 미래의 합류자가 이 패턴을 안다는 걸 기대할 수 있어요. *재사용 가능한 Specification 조각* (예: `notDeleted()`, `createdInLast30Days()`) 을 도메인 어디서든 조합할 수 있는 점도 매력입니다.

다만 우리 문제 — *if 지옥의 반복 제거* — 와는 결이 약간 다릅니다. Specification 도 결국 *각 조건마다 메서드를 정의* 해야 하므로 도메인마다 수십 개의 Specification 메서드가 만들어지고, 프론트엔드의 JSON 을 *어떤 Specification 으로 변환할지* 매핑하는 레이어가 별도로 필요해요. 그 매핑 자체가 또 다른 if-else 가 됩니다. 게다가 QueryDsl 대비 *서브쿼리 / 동적 정렬 / 윈도우 함수* 등 표현력이 약해서 *복잡한 쿼리는 어차피 QueryDsl 로 fallback* 해야 하는 이중 부담이 생겨요.

탈락 이유는 *if 지옥을 Specification 으로 옮겼을 뿐 근본 해결이 아님* 이에요. 우리가 원하는 건 *프론트엔드 JSON → WHERE 절* 의 변환 자체가 자동화되는 것입니다.

### Option 3 — Map 기반 + `QueryDslPredicateBuilder` ★ 채택

프론트엔드가 `{field}_{operator}: value` 형식의 평면 Map 을 보내고, 백엔드의 빌더가 *Map 을 순회하면서 자동으로 BooleanBuilder 를 조립* 하는 형태입니다. 키의 *마지막 underscore* 뒤를 연산자, 그 앞을 필드명으로 해석해 QueryDsl 의 `PathBuilder` 로 동적 접근해요.

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

이 옵션의 진짜 강점은 *조건 추가 비용이 0* 이라는 점이에요. 엔티티에 새 컬럼 (`@Column status`) 만 있으면 프론트엔드가 즉시 `status_eq=ACTIVE` 같은 새 조건을 보낼 수 있고, 백엔드는 한 줄도 수정하지 않습니다. 앱 공장 전략에서 *조건이 자주 늘어나는* 환경에 가장 잘 정합해요. 모든 앱의 목록 조회가 같은 평면 Map 형식을 받으니 프론트 ↔ 백엔드 계약이 자연스럽게 통일되고, 빌더 자체는 `common-persistence` 한 곳에만 있어 유지보수 위치가 단일합니다.

대신 트레이드오프가 있어요. *컴파일 타임 검증* 이 사라집니다 — 프론트가 `nonexistent_eq` 같은 없는 필드를 보내면 런타임에야 QueryDsl 예외가 터져요. *타입 체크* 도 런타임으로 밀려나서, JSON 의 `"amount_gte": "10000"` (문자열) 같은 미스매치가 Jackson 단계에서 자동 변환되지 않으면 400 으로 떨어집니다. *서브쿼리 / CASE WHEN* 같은 복잡 쿼리는 Map 으로 표현되지 않아서 별도 처리가 필요해요.

다만 이 한계들은 *일반 목록 조회의 90% 안에서는 거의 발생하지 않는* 케이스예요. 그 10% — 복잡한 비즈니스 쿼리 — 는 어차피 *앱 모듈의 커스텀 Repository* 에서 직접 QueryDsl 이나 JPQL 로 구현하는 편이 자연스럽습니다. Map 기반 인프라는 *반복되는 90%* 를 제거하는 게 목적이고, 그 목적은 잘 달성돼요.

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

**조건 추가 비용이 0 으로 떨어집니다.** 엔티티에 새 `@Column` 이 있으면 프론트가 즉시 `status_eq=ACTIVE` 같은 새 조건을 보낼 수 있어요. Controller / Service / DTO 어느 곳도 수정할 필요가 없어서, 앱 공장 전략에서 *조건이 자주 늘어나는* 환경에 가장 잘 맞습니다. 새 앱을 스캐폴딩한 직후부터 *목록 조회 5 종을 추가 코드 0 줄로 지원* 하는 상태가 돼요.

**프론트엔드와 백엔드의 계약이 통일됩니다.** 모든 앱의 목록 조회 API 가 같은 평면 Map 형식 (`{field}_{operator}: value`) 을 받으므로, 프론트엔드 개발자가 새 엔드포인트를 만날 때마다 *이 앱의 검색 컨벤션* 을 다시 학습할 필요가 없어요. *공통 검색 컴포넌트* 를 한 번 만들어 두면 모든 앱에서 재사용할 수 있습니다.

**Service 레이어가 간결해집니다.** 필드별 if 지옥이 사라지고, Service 메서드가 *조건 받기 → 쿼리 실행 → DTO 변환* 의 세 단계로 명확하게 정렬돼요. 위에서 본 `findExpenses` 예시가 10 줄 안쪽으로 줄어들고, 새 조건이 추가되어도 그 줄 수는 그대로 유지됩니다.

**유지보수 위치가 단일합니다.** 새 연산자 — 예를 들어 `field_in` (IN 절 매칭) 이나 `field_between` (범위 매칭) — 가 필요해지면 `QueryDslPredicateBuilder` 의 switch 에 case 한 줄을 추가하기만 하면 돼요. 모든 앱의 모든 목록 조회가 자동으로 그 연산자를 사용할 수 있게 됩니다.

### 부정적 결과

**컴파일 타임 검증이 사라집니다.** 프론트가 `nonexistent_eq` 같은 *엔티티에 없는 필드* 를 보내면 런타임에야 `PathBuilder` 가 QueryDsl 예외를 던져요. 운영 시점에 *왜 이 검색이 500 이지?* 같은 디버깅이 발생할 수 있습니다. 완화책으로 OpenAPI 문서에 지원 필드를 명시하고 테스트 단계에서 *프론트가 보내는 모든 조합* 을 한 번씩 호출해 사전 검증하는 패턴을 권장해요.

**타입 체크가 런타임으로 밀려납니다.** `Map<String, Object>` 라 JSON 역직렬화 시점에는 *값의 타입* 이 결정되지 않아요. `"amount_gte": "10000"` (문자열) 과 `"amount_gte": 10000` (숫자) 이 다르게 도착할 수 있고, Jackson 이 엔티티의 필드 타입 정보를 보고 자동 변환해 주는 경우가 대부분이지만, 변환에 실패하면 400 Bad Request 가 떨어집니다. 완벽한 안전성을 원한다면 클라이언트 측에서 *타입 일관성* 을 보장하는 게 정합이에요.

**복잡한 쿼리는 표현되지 않습니다.** *CASE WHEN ... THEN ...* 같은 SQL 분기, 서브쿼리, 윈도우 함수, JOIN 기반 조건 — 이런 표현은 평면 Map 으로 옮길 수 없어요. 다만 이런 쿼리는 *비즈니스 로직 중심의 특수 요구* 라 *앱 모듈의 커스텀 Repository* 에서 직접 QueryDsl 이나 JPQL 로 구현하는 편이 가독성도 좋고 유지보수도 명확합니다. Map 기반 인프라는 *반복되는 일반 목록 조회의 90%* 만 커버하는 게 본 의도예요.

### 감당 가능성 판단

부정적 결과들은 *일반 목록 조회의 범위 안에서는* 거의 마주치지 않는 케이스에요. 컴파일 타임 안전성을 일부 포기한 대신 *조건 추가 비용 0* 과 *통일된 프론트-백 계약* 을 얻었고, 이 트레이드오프는 *조건 추가가 자주 일어나는 앱 공장 환경* 에서 압도적으로 유리합니다. 진짜 복잡한 쿼리는 어차피 커스텀 구현이 맞고, 그 부담은 *전체 목록 조회의 10%* 정도라 실제 운영 비용에 큰 영향을 주지 않아요.

## 교훈

### `lastIndexOf('_')` 가 정답인 이유

순진한 구현은 `key.split("_")` 로 키를 쪼개고 *앞이 필드, 뒤가 연산자* 로 해석하는 패턴이에요. 그런데 필드명에 underscore 가 들어가는 케이스 — `app_slug_eq` 같은 — 가 등장하면 이 파싱이 즉시 깨집니다.

```java
// Naive split 구현 (버그)
String[] parts = key.split("_");
String field = parts[0];         // "app" — 의도: "app_slug"
String operator = parts[1];      // "slug" — 의도: "eq"

// 수정 후
int lastUnderscore = key.lastIndexOf('_');
String field = key.substring(0, lastUnderscore);         // "app_slug" ✅
String operator = key.substring(lastUnderscore + 1);     // "eq" ✅
```

핵심 통찰은 *연산자는 우리가 정의하는 8 개 중 하나* 라 *키의 끝쪽에 위치할* 거라는 사실이에요. 반면 필드명은 *DB 컬럼명을 그대로 따르는* 도메인 영역이라 어떤 형태가 들어올지 빌더가 미리 알 수 없습니다. 미지의 영역과 알려진 영역을 구분할 때는 *알려진 쪽에서부터 잘라내는* 편이 안전해요.

**원칙**: 구분자 기반 문자열 파싱은 *끝에서부터* 잘라내는 형태가 더 안전합니다. *어떤 문자가 들어올지 모르는* 영역이 앞쪽에 있다면 특히요.

### 표준 도구를 거절한 판단의 주기적 재검토

Option 2 (Spring Data Specifications) 같은 표준 도구를 버리고 커스텀 빌더를 만드는 결정은 *항상 의심받을* 자리에 놓입니다. *왜 표준을 안 쓰지?* 라는 질문은 신규 합류자에게서나 외부 리뷰어에게서나 자연스럽게 나와요.

이 결정의 근거는 표준 도구가 *우리의 특수 요구 (공장 패턴)* 와 어긋나는 부분이 있다는 사실이에요. Specification 은 *도메인마다 수십 개의 Specification 메서드 정의* 를 강요하는데, 우리는 그 부담을 피하려고 *Map 기반 자동 변환* 을 선택했습니다. 트레이드오프 자체는 정직했어요.

다만 이 판단은 *영구* 가 아니에요. 앞으로 운영 환경이 바뀌어 *조건 안정성* 이 *추가 비용* 보다 비싸지는 단계가 오면 — 예를 들어 *운영 규모가 커서 잘못된 검색이 비용으로 직접 환산되는 시점* — 표준 도구가 더 나은 선택이 될 수 있습니다. 그래서 본 ADR 의 결정은 *현재 단계에 한정* 된다는 점을 명시하고, *주기적 재검토* 를 권장해요.

**원칙**: 표준 도구 거절은 *우리의 특수 요구* 와 *표준의 가정* 사이의 간극을 명확히 기록할 때만 정당해요. 그 기록은 *주기적 재검토 트리거* 가 되어, 환경이 바뀌었을 때 결정도 함께 진화할 수 있게 합니다.

## 관련 사례 (Prior Art)

- **[Spring Data JPA Specifications](https://docs.spring.io/spring-data/jpa/docs/current/reference/html/#specifications)** — Option 2 로 검토한 Spring 표준. 필요해지면 이행 경로.
- **[QueryDsl Reference](http://querydsl.com/static/querydsl/latest/reference/html/)** — `PathBuilder` API 의 공식 문서. 본 ADR 의 동적 쿼리 기법 출처.
- **[Jdbi, jOOQ](https://www.jooq.org/)** — 다른 Java 쿼리 빌더 접근. QueryDsl 과 비교 가능.
- **Ransack (Rails)** — Ruby on Rails 의 유사 개념. `name_cont`, `age_gteq` 같은 suffix 기반 필드 매핑이 본 ADR 의 영감 중 하나.
- **GraphQL 의 `where` 입력 타입** — Hasura, PostGraphile 등이 사용하는 `{ field: { _eq: value } }` 중첩 구조. 우리는 평면 Map 으로 단순화.

## Code References

**순수 Java DTO** (`common-web/search/`):
- [`PageListRequest.java`](https://github.com/storkspear/template-spring/blob/main/common/common-web/src/main/java/com/factory/common/web/search/PageListRequest.java)
- [`PageListResponse.java`](https://github.com/storkspear/template-spring/blob/main/common/common-web/src/main/java/com/factory/common/web/search/PageListResponse.java)
- [`PageListResult.java`](https://github.com/storkspear/template-spring/blob/main/common/common-web/src/main/java/com/factory/common/web/search/PageListResult.java)
- [`SortOrder.java`](https://github.com/storkspear/template-spring/blob/main/common/common-web/src/main/java/com/factory/common/web/search/SortOrder.java)
- [`SortFieldMapper.java`](https://github.com/storkspear/template-spring/blob/main/common/common-web/src/main/java/com/factory/common/web/search/SortFieldMapper.java)
- [`PageListQuery.java`](https://github.com/storkspear/template-spring/blob/main/common/common-web/src/main/java/com/factory/common/web/search/PageListQuery.java)

**QueryDsl 변환** (`common-persistence/`):
- [`QueryDslPredicateBuilder.java`](https://github.com/storkspear/template-spring/blob/main/common/common-persistence/src/main/java/com/factory/common/persistence/QueryDslPredicateBuilder.java) — 78줄, 8개 연산자
- [`QueryDslSortBuilder.java`](https://github.com/storkspear/template-spring/blob/main/common/common-persistence/src/main/java/com/factory/common/persistence/QueryDslSortBuilder.java)
- [`QueryDslAutoConfiguration.java`](https://github.com/storkspear/template-spring/blob/main/common/common-persistence/src/main/java/com/factory/common/persistence/QueryDslAutoConfiguration.java)
- [`QueryUtil.java`](https://github.com/storkspear/template-spring/blob/main/common/common-persistence/src/main/java/com/factory/common/persistence/QueryUtil.java)
