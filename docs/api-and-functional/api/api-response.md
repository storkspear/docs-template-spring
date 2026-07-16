# API Response Format

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~8분

이 문서는 모든 REST API 의 요청과 응답 포맷을 정의합니다.

일관된 포맷의 목적은 클라이언트(Flutter 앱)가 어느 엔드포인트든 같은 파싱 로직으로 처리할 수 있게 하는 거예요. 응답 포맷이 엔드포인트마다 다르면 앱 쪽 네트워크 레이어가 복잡해지고 에러 처리도 들쭉날쭉해집니다.

---

## 개요

모든 REST API 의 요청·응답 포맷 표준입니다. 응답 래퍼 구조, HTTP 상태 코드 매핑, 에러 코드 체계, 필드 명명 규약을 한곳에 모아 둡니다.

---

## 응답 래퍼

모든 응답은 다음 구조로 감쌉니다.

```json
{
  "data": <실제 데이터 또는 null>,
  "error": <에러 객체 또는 null>
}
```

성공 시 `data` 에 실제 데이터가 담기고 `error` 는 `null` 입니다. 실패 시 `data` 는 `null` 이고 `error` 에 에러 객체가 담깁니다.

성공 응답에서 `data` 와 `error` 는 항상 상호 배타적입니다. 데이터가 있으면서 동시에 에러가 있는 응답은 없습니다.

> **왜 data 와 error 를 분리했나** — 흔한 대안은 단일 객체에 `success` 불리언 플래그를 두는 방식이에요. 그러면 클라이언트가 항상 `success` 를 먼저 확인한 뒤 분기해야 하고, 응답 타입이 하나라서 Dart 의 타입 시스템이 데이터 필드와 에러 필드를 한 객체에서 동시에 다뤄야 합니다. data 와 error 를 상호 배타적으로 분리하면 성공 경로와 에러 경로가 타입 단계에서 갈라지고, 클라이언트는 `error == null` 한 번만 확인하면 됩니다.

> **본문 없는 성공은 바디가 아예 없음** — 204 No Content 처럼 돌려줄 데이터가 없는 성공 응답은 코드로는 `ApiResponse.empty()` (data · error 모두 null) 가 표현합니다. 단, **wire 에는 `{"data": null, "error": null}` 같은 JSON 이 전송되지 않아요** — `@ResponseStatus(NO_CONTENT)` 와 함께 쓰면 Tomcat 이 204 응답의 엔티티 바디를 제거하므로 클라이언트가 받는 것은 순수한 빈 바디입니다 (실측 확인). 따라서 클라이언트는 204 에서 바디 파싱을 전제하면 안 되고, 빈 바디 자체를 "본문 없는 성공"으로 해석해야 합니다 (Flutter 쪽은 `ApiClient` 가 `ApiResponse.empty()` 로 정규화). "데이터가 있는 성공"과 "에러"는 상호 배타적이지만, 그 둘 어디에도 속하지 않는 이 세 번째 상태가 따로 있습니다.

### 성공 응답 예시

```json
{
  "data": {
    "id": 123,
    "email": "user@example.com",
    "displayName": "홍길동"
  },
  "error": null
}
```

### 실패 응답 예시

```json
{
  "data": null,
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
    { "id": 1, "name": "item 1" },
    { "id": 2, "name": "item 2" }
  ],
  "error": null
}
```

### 페이지네이션 응답 예시

```json
{
  "data": {
    "content": [
      { "id": 1, "name": "item 1" }
    ],
    "page": 0,
    "size": 20,
    "totalElements": 42,
    "totalPages": 3
  },
  "error": null
}
```

## 조회 API 표준 요청 형식

목록 조회 API 는 `PageListRequest<T>` 를 body 로 받습니다. 메서드는 POST 를 씁니다. 최상위 필드는 네 가지예요 — `page`(0부터, 음수는 0으로 보정) · `size`(기본 20, `[1, 200]` 으로 clamp) · `sorts`(정렬 목록) · `filterModel`(도메인별 **타입 있는 필터 DTO**).

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
      { "id": 1, "title": "커피", "amount": 5000, "categoryId": 5 },
      { "id": 2, "title": "라떼", "amount": 6000, "categoryId": 5 }
    ],
    "page": 0,
    "size": 20,
    "totalElements": 42,
    "totalPages": 3
  },
  "error": null
}
```

<a id="조건-연산자-규칙"></a>

### 조건 연산자 규칙 (서버 내부 — Assembler → QueryDslPredicateBuilder)

`filterModel` 의 각 필드는 서버의 Assembler 가 아래 `필드명_연산자` 키로 변환합니다 (예: `minAmount: 10000` → `amount_gte`, `titleContains: "커피"` → `title_like`). 연산자를 생략하면 `eq` 로 동작합니다. 클라이언트가 이 키를 직접 보내는 게 아니라, 도메인이 필드→연산자 매핑을 Assembler 에서 결정해요.

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
| 이메일 형식 오류 (검증 실패) | 422 | `CMN_001` |
| 비밀번호 불일치 | 401 | `ATH_001` |
| Apple·Google 로그인 검증 실패 | 401 | `ATH_004` |
| refresh token 만료 | 401 | `ATH_002` |
| 이메일 발송 실패 | 502 | `EMAIL_001` |

---

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
  "password": "password123",
  "displayName": "홍길동"
}
```

### Query Parameter

`GET` 요청의 필터링, 페이지네이션, 정렬은 query parameter 를 사용합니다.

```http
GET /api/apps/sumtally/expenses?page=0&size=20&sort=date,desc&categoryId=5
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

배열·리스트 필드는 다릅니다. 비어 있어도 null 로 생략하지 않고 빈 배열 `[]` 로 반환합니다. 클라이언트가 null 체크와 빈 배열 체크를 둘 다 하지 않게 하려는 규약이에요. `non_null` 설정은 빈 컬렉션을 생략하지 않으므로 Jackson 기본 동작으로도 빈 배열이 그대로 나가지만, 응답 객체가 null 컬렉션을 담지 않게 하는 건 각 DTO 의 책임입니다.

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
    @Email(message = "올바른 이메일 형식이 아닙니다")
    @NotBlank
    String email,

    @NotBlank
    @Size(min = 8, max = 72, message = "비밀번호는 8~72자여야 합니다")
    String password,

    @NotBlank
    @Size(max = 30)
    String displayName
) { }
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
  },
  "error": null
}
```

### 201 Created

```json
{
  "data": {
    "user": { "id": 123, "email": "user@example.com" },
    "tokens": {
      "accessToken": "eyJhbGc...",
      "refreshToken": "abc123..."
    }
  },
  "error": null
}
```

### 422 Unprocessable Entity (검증 실패)

```json
{
  "data": null,
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
  "data": null,
  "error": {
    "code": "CMN_007",
    "message": "액세스 토큰이 만료되었습니다"
  }
}
```

### 404 Not Found

```json
{
  "data": null,
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
  "data": null,
  "error": {
    "code": "USR_002",
    "message": "이미 사용 중인 이메일입니다"
  }
}
```

---

## 요약

- 모든 응답은 `{data, error}` 래퍼로 감쌉니다.
- 데이터가 있는 성공과 에러는 상호 배타적이고, 본문 없는 성공(204)은 바디 없이 전송됩니다 (코드 표현은 `ApiResponse.empty()` — 둘 다 `null`).
- 성공은 HTTP 2xx 와 `data`, 실패는 HTTP 4xx·5xx 와 `error` 로 나갑니다.
- 에러는 예외로 표현합니다. 컨트롤러는 `ApiResponse.error()` 를 직접 반환하지 않습니다 (상세: [`exception-handling.md`](../../convention/exception-handling.md)).
- 날짜는 ISO 8601 UTC, 필드명은 camelCase, null 은 생략하되 빈 배열은 그대로 둡니다.

---

## 관련 문서

- [`Exception Handling Convention`](../../convention/exception-handling.md) — 에러 코드 체계와 도메인별 예외
- [`JSON 계약 규약 (JSON Contract)`](./json-contract.md) — JSON 직렬화 정책과 테스트 4 종
- [`Flutter ↔ Backend Integration`](./flutter-backend-integration.md) — 클라이언트 연동 규약
- [`버전 규약 & Deprecation 프로세스`](./versioning.md) — API 버전 관리 전략
- [`Swagger UI`](./swagger-ui.md) — API 자동 탐색과 slug 별 controller 그룹
