# API Response Format

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~8분

이 문서는 모든 REST API 의 요청과 응답 포맷을 정의합니다.

일관된 포맷의 목적은 클라이언트(Flutter 앱)가 어느 엔드포인트든 같은 파싱 로직으로 처리할 수 있게 하는 거예요. 응답 포맷이 엔드포인트마다 다르면 앱 쪽 네트워크 레이어가 복잡해지고 에러 처리도 들쭉날쭉해집니다.

---

## 개요

모든 REST API 의 요청·응답 포맷 표준입니다. 응답 래퍼 구조, HTTP 상태 코드 매핑, 에러 코드 체계, 필드 명명 규약을 한곳에 모아 둡니다.

---

## 응답 래퍼

앱·운영 콘솔의 일반 JSON 응답은 `ApiResponse<T>`로 감싸요. 아래는 코드에서 표현하는 개념 구조이며, 실제 JSON에서는 null 필드를 생략해요. 성공은 `data`, 실패는 `error`가 남고 204는 빈 바디예요. `/health`·Actuator·OpenAPI처럼 별도 계약을 가진 경로는 예외예요.

```json
{
  "data": <실제 데이터 또는 null>,
  "error": <에러 객체 또는 null>
}
```

Java 객체에서 성공은 `data`를 채우고 `error`를 null로, 실패는 그 반대로 표현해요. 실제 JSON에는 값이 있는 쪽만 포함돼요.

정적 factory를 사용하는 규약에 따라 데이터가 있는 성공과 에러를 구분해요. Java record의 public 생성자 자체가 상호 배타성을 강제하는 것은 아니므로 `ok`·`error`·`empty` factory를 사용해요.

> **data와 error를 나눈 이유** — 클라이언트가 성공 데이터와 오류를 같은 위치에서 일관되게 찾도록 하는 규약이에요. 실제 타입의 상호 배타성이 자동으로 보장되는 것은 아니며, 클라이언트는 HTTP 상태·본문 유무·`error.code`를 함께 해석해요.

> **본문 없는 성공은 바디가 아예 없음** — 204 No Content 처럼 돌려줄 데이터가 없는 성공 응답은 코드로는 `ApiResponse.empty()` (data · error 모두 null) 가 표현합니다. 단, **wire 에는 `{"data": null, "error": null}` 같은 JSON 이 전송되지 않아요** — `@ResponseStatus(NO_CONTENT)` 와 함께 쓰면 Tomcat 이 204 응답의 엔티티 바디를 제거하므로 클라이언트가 받는 것은 순수한 빈 바디입니다 (실측 확인). 따라서 클라이언트는 204 에서 바디 파싱을 전제하면 안 되고, 빈 바디 자체를 "본문 없는 성공"으로 해석해야 합니다 (Flutter 쪽은 `ApiClient` 가 `ApiResponse.empty()` 로 정규화). "데이터가 있는 성공"과 "에러"는 상호 배타적이지만, 그 둘 어디에도 속하지 않는 이 세 번째 상태가 따로 있습니다.

### 성공 응답 예시

```json
{
  "data": {
    "id": 123,
    "email": "user@example.com",
    "displayName": "홍길동"
  }
}
```

### 실패 응답 예시

```json
{
  "error": {
    "code": "CMN_001",
    "message": "이메일 형식이 올바르지 않습니다",
    "details": {
      "field": "email",
      "rejected": "not-an-email"
    }
  }
}
```

### 목록 응답 예시

```json
{
  "data": [
    {
      "id": 1,
      "name": "item 1"
    },
    {
      "id": 2,
      "name": "item 2"
    }
  ]
}
```

### 페이지네이션 응답 예시

```json
{
  "data": {
    "content": [
      {
        "id": 1,
        "name": "item 1"
      }
    ],
    "page": 0,
    "size": 20,
    "totalElements": 42,
    "totalPages": 3
  }
}
```

## 조회 API 표준 요청 형식

새 앱의 복합 목록 검색은 `PageListRequest<T>`를 body로 받는 POST 규약을 따라요. 최상위 필드는 `page`·`size`·`sorts`·`filterModel`이에요. `page`는 0부터 시작하고 음수는 0으로 보정해요. `size`는 기본 20이며 1~200으로 제한해요. `filterModel`에는 도메인이 정의한 필터 DTO를 넣어요. 운영 콘솔의 기존 GET 목록은 해당 endpoint 계약을 유지해요.

클라이언트는 `conditions` 같은 자유형 Map 을 직접 보내지 않아요. 필터는 도메인이 정의한 `filterModel` 의 명시적 필드로만 표현되고, 서버의 Assembler 가 이를 `필드명_연산자` 조건 Map 으로 변환해 `QueryDslPredicateBuilder` 에 넘깁니다 (아래 [조건 연산자 규칙](#조건-연산자-규칙) 참고). `sorts` 의 `field` 키는 `filterModel`(`SortFieldMapper`)의 화이트리스트로 검증되어, 목록에 없는 키는 무시되고 기본 정렬로 fallback 해요 — 임의 컬럼 정렬로 인한 비공개 컬럼 노출·SQL injection 을 막는 장치입니다.

### 요청 예시

```http
POST /api/apps/sumtally/expenses/search
Content-Type: application/json

{
  "page": 0,
  "size": 20,
  "sorts": [
    { "field": "createdAt", "direction": "DESC" },
    { "field": "amount", "direction": "ASC" }
  ],
  "filterModel": {
    "categoryId": 5,
    "minAmount": 10000,
    "titleContains": "커피",
    "from": "2026-01-01T00:00:00Z",
    "to": "2026-03-31T23:59:59Z"
  }
}
```

### 응답 예시

```json
{
  "data": {
    "content": [
      {
        "id": 1,
        "title": "커피",
        "amount": 10000,
        "categoryId": 5
      },
      {
        "id": 2,
        "title": "커피 라떼",
        "amount": 12000,
        "categoryId": 5
      }
    ],
    "page": 0,
    "size": 20,
    "totalElements": 42,
    "totalPages": 3
  }
}
```

<a id="조건-연산자-규칙"></a>

<a id="조건-연산자-규칙-서버-내부--assembler--querydslpredicatebuilder"></a>

### 조건 연산자 규칙 (서버 내부 — Assembler → QueryDslPredicateBuilder)

서버의 Assembler가 `filterModel`의 필드를 아래 `필드명_연산자` 형태로 바꿔요. 예를 들어 `minAmount: 10000`은 `amount_gte`, `titleContains: "커피"`는 `title_like`에 대응해요. 연산자를 생략하면 `eq`를 사용해요. 이 변환은 도메인이 정의하며, 클라이언트는 내부 조건 키를 직접 보내지 않아요.

| 키 형식 | 의미 | 값 타입 |
|---|---|---|
| `field_eq` · `field_ne` | 일치 · 불일치 | 단일 값 |
| `field_gt` · `field_gte` | 초과 · 이상 | 단일 값 (숫자, 날짜) |
| `field_lt` · `field_lte` | 미만 · 이하 | 단일 값 (숫자, 날짜) |
| `field_like` | 부분 매칭 | 문자열 |
| `field_startsWith` · `field_endsWith` | 접두 · 접미 매칭 | 문자열 |
| `field_in` · `field_notIn` | 포함 · 미포함 | 값 목록 |
| `field_between` | 범위 | 값 두 개 |
| `field_isNull` · `field_isNotNull` | null 여부 | `true` |
| `field_empty` | null 또는 빈 문자열 여부 (문자열 전용) | `true` 또는 `false` |

대소문자를 무시하려면 연산자 앞에 `i` 를 붙입니다. `field_ieq`, `field_ilike`, `field_istartsWith` 같은 식이에요.

이 규칙은 `common-persistence` 모듈의 `QueryDslPredicateBuilder` 가 처리합니다. 필요한 연산자가 더 있으면 이 클래스에 연산자를 추가하면 됩니다.

### 왜 POST 인가

`GET` 도 body 를 가질 수 있긴 하지만, 실무에서는 프록시나 CDN 이 GET body 를 무시하거나 캐시 키에 반영하지 않아 문제가 됩니다. 복잡한 검색 조건은 query parameter 로 표현하기 어렵고 길이 제한도 있습니다.

그래서 목록 조회 API 는 `POST /search` 엔드포인트를 사용합니다.

- `POST /api/apps/sumtally/expenses/search` — 조건 기반 검색
- `GET /api/apps/sumtally/expenses/{id}` — 단건 조회 (ID 기반)

---

## Java 구현

### ApiResponse

```java
// common-web/response/ApiResponse.java 발췌
public record ApiResponse<T>(T data, ApiError error) {

    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(data, null);
    }

    public static <T> ApiResponse<T> empty() {
        return new ApiResponse<>(null, null);
    }

    public static <T> ApiResponse<T> error(ApiError error) {
        return new ApiResponse<>(null, error);
    }
}
```

`ok` 는 성공, `empty` 는 본문 없는 성공(204), `error` 는 실패 응답을 만듭니다. 단 `empty()` 를 `@ResponseStatus(NO_CONTENT)` 와 함께 반환하면 직렬화 결과는 wire 에 실리지 않아요 — 204 는 바디 없이 전송됩니다 (위 "본문 없는 성공" 참고).

### ApiError

```java
// common-web/response/ApiError.java 발췌
public record ApiError(String code, String message, Map<String, Object> details) {

    public ApiError {
        if (details != null) {
            details = Map.copyOf(details);   // ← 방어적 복사로 외부 변경 차단
        }
    }

    public static ApiError of(String code, String message) {
        return new ApiError(code, message, null);
    }

    public static ApiError of(String code, String message, Map<String, Object> details) {
        return new ApiError(code, message, details);
    }
}
```

`code` 는 `String` 입니다. 실제로는 `ErrorInfo.getCode()` 의 반환값(예: `"CMN_007"`, `"ATH_001"`)을 넘깁니다. enum 상수 이름(`ACCESS_TOKEN_EXPIRED`)이 아니에요.

### 컨트롤러 사용 예시

```java
@GetMapping("/me")
public ApiResponse<UserProfile> getMyProfile(@CurrentUser AuthenticatedUser user) {
    UserProfile profile = userService.findProfileById(user.userId());
    return ApiResponse.ok(profile);
}

@PostMapping("/email/signup")
@ResponseStatus(HttpStatus.CREATED)
public ApiResponse<AuthResponse> signUp(@RequestBody @Valid SignUpRequest request) {
    return ApiResponse.ok(authService.signUpWithEmail(request));
}
```

컨트롤러는 `ApiResponse.error(...)` 를 직접 반환하지 않습니다. 에러는 예외로 던지고, `GlobalExceptionHandler` 가 응답으로 변환합니다.

---

## HTTP 상태 코드

### 성공

- **200 OK** — 조회, 수정
- **201 Created** — 새 리소스 생성 (POST)
- **204 No Content** — 삭제, 또는 응답 바디 없는 성공 (바디가 아예 전송되지 않음)

### 클라이언트 오류

- **400 Bad Request** — 일반적인 잘못된 요청
- **401 Unauthorized** — 인증 필요 (토큰 없음 또는 만료)
- **403 Forbidden** — 인증은 됐으나 권한 없음
- **404 Not Found** — 리소스 없음
- **409 Conflict** — 중복 등록, 상태 충돌
- **422 Unprocessable Entity** — 검증 실패 (형식은 맞으나 내용이 부적절)
- **429 Too Many Requests** — 레이트 리밋

### 서버 오류

- **500 Internal Server Error** — 일반적인 서버 오류
- **502 Bad Gateway** — 외부 서비스 호출 실패 (이메일 발송, PG 사 API 등)
- **503 Service Unavailable** — 일시적 서비스 불가 (DB 다운, 설정 누락 등)

### 언제 뭘 쓰나

| 상황 | HTTP 상태 | 에러 코드 |
|---|---|---|
| JWT 없이 보호된 엔드포인트 호출 | 401 | `CMN_004` |
| 만료된 JWT access token | 401 | `CMN_007` |
| 유효하지 않은 JWT access token | 401 | `CMN_008` |
| 다른 유저의 데이터 조회 시도 | 403 | `CMN_005` |
| JWT appSlug 와 URL path slug 불일치 | 403 | `CMN_005` |
| 존재하지 않는 유저 ID 조회 | 404 | `USR_001` |
| 이미 사용 중인 이메일로 가입 | 409 | `USR_002` |
| 소셜 최초 가입인데 같은 이메일의 계정이 이미 있음 (자동 연결 안 함) | 409 | `USR_002` |
| 이메일 형식 오류 (검증 실패) | 422 | `CMN_001` |
| 비밀번호 불일치 | 401 | `ATH_001` |
| Apple·Google 로그인 검증 실패 | 401 | `ATH_004` |
| refresh token 만료 | 401 | `ATH_002` |
| 이메일 발송 실패 | 502 | `EMAIL_001` |

---

<a id="에러-코드--예외-처리"></a>

## 에러 코드 & 예외 처리

에러 코드 체계, 예외 계층 구조, ExceptionHandler 매핑, 새 예외 추가 절차는 [`exception-handling.md`](../../convention/exception-handling.md) 에서 관리합니다.

여기서는 핵심 원칙만 요약합니다.

- 에러 코드는 `ErrorInfo` 인터페이스(`getStatus()`, `getCode()`, `getMessage()`)를 구현하는 enum 들이 정의합니다. 공통 코드는 `CommonError`(`CMN_xxx`), 도메인별 코드는 `AuthError`(`ATH_xxx`), `UserError`(`USR_xxx`), `EmailError`(`EMAIL_xxx`), `PaymentError`(`PAY_xxx`) 처럼 각 도메인 모듈의 enum 이 가집니다.
- 컨트롤러는 `ApiResponse.error(...)` 를 직접 반환하지 않습니다. 예외를 던지고 `GlobalExceptionHandler` 가 변환합니다.
- 클라이언트는 HTTP 상태 코드가 아니라 에러 코드 값으로 분기합니다. 같은 401 이라도 `CMN_007`(access token 만료)과 `ATH_001`(비밀번호 불일치)은 의미가 다릅니다.

---

## 요청 포맷

### JSON 바디

`POST`, `PUT`, `PATCH` 요청은 JSON 바디를 사용합니다.

```http
POST /api/apps/sumtally/auth/email/signup
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "Password1234",
  "displayName": "홍길동",
  "proofToken": "<verify-code에서 발급받은 JWT>"
}
```

### Query Parameter

운영 콘솔처럼 GET 목록으로 정의된 기존 API는 각 엔드포인트가 정한 query parameter를 사용해요. 새 앱의 복합 목록 검색은 앞 절의 `POST /search`와 `PageListRequest<T>` 규약을 따라요. 모든 목록에 아래 GET 예제를 그대로 적용하지 않아요.

```http
GET /api/admin/apps/sumtally/users?page=0&size=20&query=user
```

### Path Variable

리소스 식별자는 path 에 포함합니다.

```http
GET /api/apps/sumtally/expenses/123
```

### 표준 Query Parameter

| 이름 | 용도 | 예시 |
|---|---|---|
| `page` | 페이지 번호 (0부터 시작) | `page=0` |
| `size` | 페이지당 항목 수 | `size=20` |
| `sort` | 정렬 필드와 방향 | `sort=createdAt,desc` |

---

## 필드 명명

### JSON

camelCase 를 사용합니다.

```json
{
  "userId": 123,
  "emailVerified": true,
  "createdAt": "2026-04-14T10:30:00Z"
}
```

### 날짜·시간

ISO 8601 UTC 형식을 사용합니다. `Z` 접미사로 UTC 임을 명시합니다.

- Good: `"2026-04-14T10:30:00Z"` 또는 `"2026-04-14T10:30:00.123Z"`
- Bad: `"2026-04-14 10:30:00"` (타임존 없음)
- Bad: `"2026년 4월 14일"` (로컬라이즈된 문자열)

Java 에서는 `Instant` 또는 `ZonedDateTime` 을 쓰고, Jackson 이 자동으로 ISO 8601 로 직렬화합니다.

### Null 필드

null 필드는 JSON 응답에 포함하지 않습니다. Jackson 설정으로 강제합니다.

```yaml
spring:
  jackson:
    default-property-inclusion: non_null
```

null 필드를 빼면 네트워크 대역폭을 아끼고, 클라이언트가 "이 필드가 있는가 없는가"로 존재 여부를 판단하기 쉬워집니다.

배열·리스트가 비어 있으면 null 대신 `[]`로 반환해요. 클라이언트가 필드 누락과 빈 목록을 따로 처리하지 않도록 하는 규약이에요. `non_null`은 빈 컬렉션을 생략하지 않지만 null을 자동으로 빈 배열로 바꾸지는 않아요. 응답 DTO가 빈 컬렉션을 넣어야 해요.

```json
// Good
{ "devices": [] }

// Bad
{ }  // devices 필드 자체가 없음
```

---

## 검증

입력 검증은 `@Valid` 와 Bean Validation 어노테이션으로 처리합니다.

```java
public record SignUpRequest(
    @Email @NotBlank String email,
    @NotBlank @ValidPassword String password,
    @NotBlank @Size(max = 30) String displayName,
    @NotBlank String proofToken
) {}
```

컨트롤러는 파라미터에 `@Valid` 를 붙입니다.

```java
@PostMapping("/email/signup")
public ApiResponse<AuthResponse> signUp(@RequestBody @Valid SignUpRequest request) {
    ...
}
```

검증에 실패하면 Spring 이 `MethodArgumentNotValidException` 을 던지고, `GlobalExceptionHandler` 가 이를 `CommonError.VALIDATION_ERROR`(코드 `CMN_001`, HTTP 422) 응답으로 변환합니다. 첫 필드 에러의 필드명과 거부된 값이 `details` 에 담겨요. 상세는 [`exception-handling.md`](../../convention/exception-handling.md) 를 참고하세요.

---

## 응답 예시 모음

### 200 OK

```json
{
  "data": {
    "id": 123,
    "email": "user@example.com"
  }
}
```

### 201 Created

```json
{
  "data": {
    "user": {
      "id": 123,
      "email": "user@example.com"
    },
    "tokens": {
      "accessToken": "eyJhbGc...",
      "refreshToken": "abc123..."
    }
  }
}
```

### 422 Unprocessable Entity (검증 실패)

```json
{
  "error": {
    "code": "CMN_001",
    "message": "올바른 이메일 형식이 아닙니다",
    "details": {
      "field": "email",
      "rejected": "not-an-email"
    }
  }
}
```

### 401 Unauthorized (access token 만료)

```json
{
  "error": {
    "code": "CMN_007",
    "message": "액세스 토큰이 만료되었습니다"
  }
}
```

### 404 Not Found

```json
{
  "error": {
    "code": "USR_001",
    "message": "유저를 찾을 수 없습니다",
    "details": {
      "id": 9999
    }
  }
}
```

### 409 Conflict

```json
{
  "error": {
    "code": "USR_002",
    "message": "이미 사용 중인 이메일입니다"
  }
}
```

---

## 요약

- 앱·콘솔의 일반 JSON 응답은 `ApiResponse<T>`를 사용하고, `/health`·Actuator 등 별도 계약은 예외예요.
- 데이터가 있는 성공은 `data`, 실패는 `error`를 포함해요. null 필드는 생략하고 빈 목록은 `[]`로 유지해요.
- 204는 JSON을 보내지 않아요. 클라이언트는 본문 없이 성공으로 처리해요.
- 일반 컨트롤러의 예외는 `GlobalExceptionHandler`가 오류 응답으로 바꿔요. 상세는 [예외 처리 규약](../../convention/exception-handling.md)을 참고해요.
- 날짜는 ISO 8601 UTC, 필드명은 camelCase를 사용해요.

---

## 관련 문서

- [`Exception Handling Convention`](../../convention/exception-handling.md) — 에러 코드 체계와 도메인별 예외
- [`JSON 계약 규약 (JSON Contract)`](./json-contract.md) — JSON 직렬화 정책과 테스트 4 종
- [`Flutter ↔ Backend Integration`](./flutter-backend-integration.md) — 클라이언트 연동 규약
- [`버전 규약 & Deprecation 프로세스`](./versioning.md) — API 버전 관리 전략
- [`Swagger UI`](./swagger-ui.md) — API 자동 탐색과 slug 별 controller 그룹
