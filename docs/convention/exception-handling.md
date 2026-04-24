# Exception Handling Convention

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~5분

이 문서는 예외 처리의 **단일 정본(Single Source of Truth)** 입니다.

---

## 개요

이 문서는 예외 처리의 **단일 정본**입니다. 에러 코드 체계 · HTTP 매핑 · 새 예외 추가 절차 · 테스트 검증 규칙 포함.

---

## 1. 아키텍처

```
ErrorInfo (인터페이스)
    ├── CommonError (enum)     ← CMN_001 ~ CMN_008, CMN_429
    ├── AuthError (enum)       ← ATH_001 ~ ATH_006
    ├── UserError (enum)       ← USR_001 ~ USR_002
    └── BillingError (enum)    ← BIL_XXX (향후)

BaseException (abstract)
    ├── CommonException        ← 공통 예외 (NOT_FOUND, FORBIDDEN, JWT 토큰 등)
    ├── AuthException          ← 인증 예외 (로그인, 소셜, 토큰 갱신 등)
    ├── UserException          ← 유저 예외 (유저 미발견, 이메일 중복 등)
    └── BillingException       ← 결제 예외 (향후)

GlobalExceptionHandler
    └── @ExceptionHandler(BaseException.class) 하나로 전부 처리
```

---

## 2. Error Code 체계

**형식: 도메인 3자 약어 + _ + 3자리 번호**

약어 규칙: 도메인명에서 **발음 기반 대표 스펠링 3자** 추출.

| 도메인 | 약어 | 범위 |
|--------|------|------|
| common | CMN | CMN_001 ~ CMN_999 |
| auth | ATH | ATH_001 ~ ATH_999 |
| user | USR | USR_001 ~ USR_999 |
| billing | BIL | BIL_001 ~ BIL_999 |
| device | DVC | DVC_001 ~ DVC_999 |
| push | PSH | PSH_001 ~ PSH_999 |
| 파생 앱 | 발음 3자 | STL_001 (settlement), GYM_001 (gymlog) |

---

## 3. 에러 코드 전체 목록

### CommonError (CMN)

| 코드 | HTTP | enum 값 | 설명 |
|------|------|---------|------|
| CMN_001 | 422 | VALIDATION_ERROR | 입력값 검증 실패 |
| CMN_002 | 404 | NOT_FOUND | 리소스 미발견 |
| CMN_003 | 409 | CONFLICT | 리소스 충돌 |
| CMN_004 | 401 | UNAUTHORIZED | 인증 필요 |
| CMN_005 | 403 | FORBIDDEN | 권한 없음 |
| CMN_006 | 500 | INTERNAL_ERROR | 서버 내부 오류 |
| CMN_007 | 401 | ACCESS_TOKEN_EXPIRED | JWT access token 만료 |
| CMN_008 | 401 | ACCESS_TOKEN_INVALID | JWT access token 무효 |
| CMN_429 | 429 | RATE_LIMIT_EXCEEDED | Rate limit 초과 (Retry-After 헤더 포함) |

### AuthError (ATH)

| 코드 | HTTP | enum 값 | 설명 |
|------|------|---------|------|
| ATH_001 | 401 | INVALID_CREDENTIALS | 이메일/비밀번호 불일치 |
| ATH_002 | 401 | TOKEN_EXPIRED | refresh/reset/verification 토큰 만료 |
| ATH_003 | 401 | INVALID_TOKEN | refresh/reset/verification 토큰 무효 |
| ATH_004 | 401 | SOCIAL_AUTH_FAILED | 소셜 로그인 검증 실패 |
| ATH_005 | 401 | EMAIL_NOT_VERIFIED | 이메일 인증 필요 |
| ATH_006 | 503 | EMAIL_DELIVERY_FAILED | 이메일 발송 실패 |

### UserError (USR)

| 코드 | HTTP | enum 값 | 설명 |
|------|------|---------|------|
| USR_001 | 404 | USER_NOT_FOUND | 유저 미발견 |
| USR_002 | 409 | EMAIL_ALREADY_EXISTS | 이메일 중복 |

### BillingError (BIL)

Phase 1 에서 추가 예정.

---

## 4. 사용법

### 기본 사용 (details 없음)

```java
throw new AuthException(AuthError.INVALID_CREDENTIALS);
throw new CommonException(CommonError.FORBIDDEN);
```

### 추가 정보 포함

```java
throw new AuthException(AuthError.SOCIAL_AUTH_FAILED, Map.of("provider", "apple"));
throw new UserException(UserError.USER_NOT_FOUND, Map.of("id", String.valueOf(userId)));
throw new CommonException(CommonError.NOT_FOUND, Map.of("resource", "Device", "id", "123"));
```

### 원인 예외 체이닝

```java
throw new AuthException(AuthError.EMAIL_DELIVERY_FAILED, cause);
```

---

## 5. 새 도메인에 예외 추가하기

### Step 1: Error enum 생성

```java
// apps/app-settlement/src/main/java/.../exception/SettlementError.java
public enum SettlementError implements ErrorInfo {
    SETTLEMENT_NOT_FOUND(404, "STL_001", "정산 정보를 찾을 수 없습니다"),
    SETTLEMENT_ALREADY_COMPLETED(400, "STL_002", "이미 완료된 정산입니다");

    private final int status;
    private final String code;
    private final String message;

    SettlementError(int status, String code, String message) { ... }
    @Override public int getStatus() { return status; }
    @Override public String getCode() { return code; }
    @Override public String getMessage() { return message; }
}
```

### Step 2: Exception 클래스 생성

```java
public class SettlementException extends BaseException {
    public SettlementException(SettlementError error) { super(error); }
    public SettlementException(SettlementError error, Map<String, Object> details) { super(error, details); }
}
```

### Step 3: 사용

```java
throw new SettlementException(SettlementError.SETTLEMENT_NOT_FOUND);
```

**GlobalExceptionHandler 수정 불필요** — `BaseException` 핸들러가 자동으로 처리.

---

## 6. 보안 원칙

| 원칙 | 구현 |
|------|------|
| 에러 메시지로 내부 정보 노출 금지 | `handleUncaught()` 는 "Internal server error" 고정 반환. 상세는 서버 로그에만 |
| 이메일 열거 방지 | ATH_001 메시지가 "이메일 없음" vs "비밀번호 틀림" 구분 안 함 |
| 스택 트레이스 클라이언트 노출 금지 | `BaseException.cause` 는 로그에만 기록 |

---

## 7. 금지 사항

| 하지 말 것 | 이유 |
|-----------|------|
| 컨트롤러에서 `ApiResponse.error()` 직접 반환 | 예외를 던지고 핸들러가 변환 |
| `checked exception` 사용 | `RuntimeException` 만 사용. Spring 트랜잭션 rollback 호환 |
| `BaseException` 을 직접 throw | 반드시 도메인 Exception(AuthException, UserException 등) 사용 |
| 같은 에러 코드를 다른 HTTP 상태에 매핑 | 1 코드 = 1 HTTP 상태 |

---

## 8. 테스트에서 예외 검증

```java
// 예외 타입 검증
assertThatThrownBy(() -> service.signIn(request))
    .isInstanceOf(AuthException.class);

// 예외 발생 시 후속 동작 미수행 검증
verify(refreshTokenIssuer, never()).issueForNewLogin(anyLong(), anyString(), anyString(), anyString());

// 예외 없음 검증 (이메일 열거 방지)
assertThatCode(() -> service.requestReset("nobody@example.com"))
    .doesNotThrowAnyException();
```

---

## 9. 관련 파일

| 파일 | 역할 |
|------|------|
| `common-web/.../exception/ErrorInfo.java` | Error enum 인터페이스 |
| `common-web/.../exception/BaseException.java` | 모든 비즈니스 예외 부모 |
| `common-web/.../exception/CommonError.java` | 공통 에러 enum (CMN_001~008, CMN_429) |
| `common-web/.../exception/CommonException.java` | 공통 예외 |
| `common-web/.../exception/GlobalExceptionHandler.java` | BaseException 통합 핸들러 |
| `common-web/.../response/ApiError.java` | 에러 응답 구조 |
| `core-auth-api/.../exception/AuthError.java` | 인증 에러 enum (ATH_001~006) |
| `core-auth-api/.../exception/AuthException.java` | 인증 예외 |
| `core-user-api/.../exception/UserError.java` | 유저 에러 enum (USR_001~002) |
| `core-user-api/.../exception/UserException.java` | 유저 예외 |
| `core-billing-api/.../exception/BillingError.java` | 결제 에러 enum (향후) |
| `core-billing-api/.../exception/BillingException.java` | 결제 예외 |

---

## 관련 문서

- [API Response Format](../api-and-functional/api/api-response.md) — 예외가 변환되는 응답 포맷
- [Flutter ↔ Backend Integration](../api-and-functional/api/flutter-backend-integration.md) — 클라이언트 측 401/403 처리 규약
