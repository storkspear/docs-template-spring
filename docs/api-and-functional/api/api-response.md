# API Response Format

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~8분

이 문서는 모든 REST API 의 요청과 응답 포맷을 정의합니다.

**일관된 포맷의 목적** 은 클라이언트(Flutter 앱) 가 어느 엔드포인트든 동일한 파싱 로직으로 처리할 수 있게 하는 것입니다. 응답 포맷이 엔드포인트마다 다르면 앱 쪽 네트워크 레이어가 복잡해지고, 에러 처리가 일관되지 않습니다.

---

## 개요

모든 REST API 의 **요청/응답 포맷 표준**. 응답 래퍼 구조 · HTTP 상태 코드 매핑 · 에러 코드 체계 · 필드 명명 규약.

---

## 응답 래퍼

모든 응답은 다음 구조로 감쌉니다.

```json
{
  "data": <actual data or null>,
  "error": <error object or null>
}
```

**성공 시**: `data` 에 실제 데이터, `error` 는 `null`.

**실패 시**: `data` 는 `null`, `error` 에 에러 객체.

`data` 와 `error` 는 **항상 상호 배타적** 입니다. 둘 다 값이 있거나 둘 다 `null` 인 응답은 없습니다.

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

목록 조회 API 는 `SearchRequest` 를 body 로 받습니다 (POST 메서드 사용):

### 요청 예시

```http
POST /api/apps/sumtally/expenses/search
Content-Type: application/json

{
  "conditions": {
    "categoryId_eq": 5,
    "amount_gte": 10000,
    "title_like": "커피",
    "createdAt_gte": "2026-01-01T00:00:00Z",
    "createdAt_lte": "2026-03-31T23:59:59Z"
  },
  "page": {
    "page": 0,
    "size": 20
  },
  "sort": [
    { "field": "createdAt", "direction": "DESC" },
    { "field": "amount", "direction": "ASC", "nullHandling": "NULLS_LAST" }
  ]
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

### 조건 연산자 규칙

| 키 형식 | 의미 | 값 타입 |
|---|---|---|
| `field_eq` | 일치 | 단일 값 |
| `field_gte` / `field_lte` | 이상 / 이하 | 단일 값 (숫자, 날짜) |
| `field_gt` / `field_lt` | 초과 / 미만 | 단일 값 |
| `field_like` | 부분 매칭 (대소문자 무시) | 문자열 |
| `field_isNull` / `field_isNotNull` | null 여부 | `true` |

현재 `QueryDslPredicateBuilder` 가 지원하는 연산자는 위 8가지입니다. 필요한 연산자가 있으면 해당 클래스의 `switch` 문에 case 를 추가하면 됩니다.

### 왜 POST 인가

`GET` 은 body 를 가질 수 없는 것은 아니지만, 실무적으로 프록시/CDN 이 GET body 를 무시하거나 캐시 키에 포함하지 않아 문제가 됩니다. 복잡한 검색 조건은 query parameter 로 표현하기 어렵고 길이 제한도 있습니다.

따라서 목록 조회 API 는 **`POST /search`** 엔드포인트를 사용합니다:
- `POST /api/apps/sumtally/expenses/search` — 조건 기반 검색
- `GET /api/apps/sumtally/expenses/{id}` — 단건 조회 (ID 기반)

---

## Java 구현

### `ApiResponse<T>`

```java
package com.factory.common.web.response;

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

### `ApiError`

```java
public record ApiError(String code, String message, Map<String, Object> details) {

    /** defensive deep-copy details to prevent external mutation. */
    public ApiError {
        if (details != null) {
            details = Map.copyOf(details);
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

`code` 는 `String` 입니다. 실제로는 `ErrorInfo.getCode()` 의 반환값(예: `"CMN_007"`, `"ATH_001"`)을 넘깁니다. enum constant 이름(`ACCESS_TOKEN_EXPIRED`)이 아닙니다.

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

**컨트롤러는 절대로 `ApiResponse.error(...)` 를 직접 반환하지 않습니다.** 에러는 예외를 던지고, `GlobalExceptionHandler` 가 변환합니다.

---

## HTTP 상태 코드

### 성공

- **200 OK** — 조회, 수정
- **201 Created** — 새 리소스 생성 (POST)
- **204 No Content** — 삭제, 또는 응답 바디 없는 성공

### 클라이언트 오류

- **400 Bad Request** — 일반적인 잘못된 요청
- **401 Unauthorized** — 인증 필요 (토큰 없음 또는 만료)
- **403 Forbidden** — 인증은 됐으나 권한 없음
- **404 Not Found** — 리소스 없음
- **409 Conflict** — 중복 등록, 상태 충돌
- **422 Unprocessable Entity** — 검증 실패 (입력 형식은 맞으나 내용이 부적절)
- **429 Too Many Requests** — 레이트 리밋 (Cloudflare 담당이 주)

### 서버 오류

- **500 Internal Server Error** — 일반적인 서버 오류
- **503 Service Unavailable** — 일시적 서비스 불가 (DB 다운 등)

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
| 이메일 형식 오류 | 422 | `CMN_001` |
| 비밀번호 불일치 | 401 | `ATH_001` |
| Apple/Google 로그인 검증 실패 | 401 | `ATH_004` |
| refresh token 만료 | 401 | `ATH_002` |
| 이메일 발송 실패 | 503 | `ATH_006` |

---

## 에러 코드 & 예외 처리

ErrorCode enum, 예외 계층 구조, ExceptionHandler 매핑, 새 예외 추가 절차는 **[exception-handling.md](../../convention/exception-handling.md)** 에서 관리합니다.

여기서는 핵심 원칙만 요약합니다:

- `ErrorCode` enum 이 모든 에러 코드의 단일 정본
- 컨트롤러는 `ApiResponse.error(...)` 를 직접 반환하지 않음 — 예외를 던지고 `ExceptionHandler` 가 변환
- 클라이언트는 HTTP 상태 코드가 아닌 **ErrorCode 값으로 분기** (같은 401 이라도 `CMN_007`(access token 만료) vs `ATH_001`(비밀번호 불일치) 는 다름)

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
| `sort` | 정렬 필드, 방향 | `sort=createdAt,desc` |

---

## 필드 명명

### JSON

**camelCase** 를 사용합니다.

```json
{
  "userId": 123,
  "emailVerified": true,
  "createdAt": "2026-04-14T10:30:00Z"
}
```

### 날짜/시간

**ISO 8601 UTC** 형식을 사용합니다. `Z` 접미사로 UTC 임을 명시합니다.

- Good: `"2026-04-14T10:30:00Z"` 또는 `"2026-04-14T10:30:00.123Z"`
- Bad: `"2026-04-14 10:30:00"` (타임존 없음)
- Bad: `"2026년 4월 14일"` (로컬라이즈된 문자열)

Java 에서는 `Instant` 또는 `ZonedDateTime` 을 사용하고, Jackson 이 자동으로 ISO 8601 로 직렬화합니다.

### Null 필드

**null 필드는 JSON 응답에 포함시키지 않습니다.** Jackson 설정:

```yaml
spring:
  jackson:
    default-property-inclusion: non_null
```

이유: 네트워크 대역폭 절약 + 클라이언트가 "이 필드가 있는가 없는가" 를 체크하기 쉬움.

**예외:** 배열/리스트 필드는 비어있으면 빈 배열 `[]` 로 반환합니다 (null 로 생략 금지). 이유: 클라이언트 코드가 null 체크와 빈 배열 체크를 둘 다 할 필요가 없게 합니다.

```json
// Good
{ "devices": [] }

// Bad
{ }  // devices 필드 자체가 없음
```

---

## 검증

입력 검증은 `@Valid` + Bean Validation 어노테이션으로 처리합니다.

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

컨트롤러:

```java
@PostMapping("/email/signup")
public ApiResponse<AuthResponse> signUp(@RequestBody @Valid SignUpRequest request) {
    ...
}
```

검증 실패 시 Spring 이 `MethodArgumentNotValidException` 을 던지고, ExceptionHandler 가 이를 `VALIDATION_ERROR` 응답으로 변환합니다. (상세: [exception-handling.md](../../convention/exception-handling.md))

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
      "field": "email"
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

- **모든 응답은 `{data, error}` 래퍼** 로 감쌉니다
- **둘은 상호 배타적** — 동시에 값을 갖지 않습니다
- **성공은 HTTP 2xx + data**, **실패는 HTTP 4xx/5xx + error**
- **예외로 에러를 표현** — 컨트롤러는 `ApiResponse.error()` 를 직접 반환하지 않습니다 (상세: [exception-handling.md](../../convention/exception-handling.md))
- **날짜는 ISO 8601 UTC**, **필드명은 camelCase**, **null 은 생략** (빈 배열은 생략 안 함)

---

## 관련 문서

- [`../conventions/exception-handling.md`](../../convention/exception-handling.md) — 에러 코드 체계 + 도메인별 예외
- [`./json-contract.md`](./json-contract.md) — JSON 직렬화 정책 + 테스트 4 종
- [`./flutter-backend-integration.md`](./flutter-backend-integration.md) — 클라이언트 연동 규약
- [`./versioning.md`](./versioning.md) — API 버전 관리 전략
