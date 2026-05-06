# Exception Handling Convention

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~5분

이 문서는 예외 처리의 **단일 정본(Single Source of Truth)** 이에요.

---

## 개요

이 문서는 예외 처리의 **단일 정본** 이에요. 에러 코드 체계 · HTTP 매핑 · 새 예외 추가 절차 · 테스트 검증 규칙이 포함되어 있습니다.

---

## 1. 아키텍처

```
ErrorInfo (인터페이스)
    ├── CommonError (enum)     ← CMN_001 ~ CMN_008, CMN_429
    ├── AuthError (enum)       ← ATH_001 ~ ATH_010 (2FA — ADR-030)
    ├── UserError (enum)       ← USR_001 ~ USR_002
    ├── BillingError (enum)    ← BIL_001 ~ BIL_010 (구독/결제/webhook)
    ├── EmailError (enum)      ← EMAIL_001 ~ EMAIL_002 (ADR-024)
    ├── IapError (enum)        ← IAP_001 ~ IAP_007 (ADR-022 — Apple/Google IAP receipt + webhook)
    └── PaymentError (enum)    ← PAY_001 ~ PAY_008 (ADR-019 — PortOne PG)

BaseException (abstract)
    ├── CommonException        ← 공통 예외 (NOT_FOUND, FORBIDDEN, JWT 토큰 등)
    ├── AuthException          ← 인증 예외 (로그인, 소셜, 토큰 갱신, 2FA 등)
    ├── UserException          ← 유저 예외 (유저 미발견, 이메일 중복 등)
    ├── BillingException       ← 결제/구독/webhook 예외 (ADR-020)
    ├── EmailException         ← 이메일 발송 예외 (ADR-024)
    ├── IapException           ← IAP receipt 검증/webhook 예외 (ADR-022)
    └── PaymentException       ← PG 결제 검증/환불/webhook 예외

> 📌 **core-audit (ADR-028)** 는 별도 Error/Exception 을 두지 않아요 — 감사 로그 기록은 application flow 의 부산물이라 throw 하지 않고, 기록 실패 시 WARN 로그만 남겨요 (사용자 흐름 차단 X).

GlobalExceptionHandler
    └── @ExceptionHandler(BaseException.class) 하나로 전부 처리
```

---

## 2. Error Code 체계

**형식 — 도메인 3자 약어 + _ + 3자리 번호**

약어 규칙은 도메인명에서 **발음 기반 대표 스펠링 3자** 를 추출해요.

| 도메인 | 약어 | 범위 |
|--------|------|------|
| common | CMN | CMN_001 ~ CMN_999 |
| auth | ATH | ATH_001 ~ ATH_999 |
| user | USR | USR_001 ~ USR_999 |
| billing | BIL | BIL_001 ~ BIL_999 |
| device | DVC | DVC_001 ~ DVC_999 |
| push | PSH | PSH_001 ~ PSH_999 |
| email | EMAIL | EMAIL_001 ~ EMAIL_999 (ADR-024 — 정확한 의미 우선해서 5자) |
| iap | IAP | IAP_001 ~ IAP_999 (ADR-022) |
| payment | PAY | PAY_001 ~ PAY_999 (PortOne PG) |
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
| ATH_007 | 401 | TOTP_VERIFICATION_FAILED | 2FA 인증 코드 무효 (ADR-030) |
| ATH_008 | 409 | TOTP_ALREADY_ENABLED | 2FA 이미 활성화됨 |
| ATH_009 | 409 | TOTP_NOT_ENABLED | 2FA 미활성 (disable / verify 호출 시) |
| ATH_010 | 401 | TOTP_REQUIRED | 2FA pending — `/auth/2fa/login` 으로 완료 필요 |

### UserError (USR)

| 코드 | HTTP | enum 값 | 설명 |
|------|------|---------|------|
| USR_001 | 404 | USER_NOT_FOUND | 유저 미발견 |
| USR_002 | 409 | EMAIL_ALREADY_EXISTS | 이메일 중복 |

### BillingError (BIL) — ADR-020

| 코드 | HTTP | enum 값 | 설명 |
|------|------|---------|------|
| BIL_001 | 404 | PLAN_NOT_FOUND | 요청한 plan 을 찾을 수 없음 |
| BIL_002 | 400 | PLAN_INACTIVE | 비활성화된 plan |
| BIL_003 | 400 | PAYMENT_NOT_PAID | 결제 상태가 PAID 가 아님 |
| BIL_004 | 400 | PAYMENT_AMOUNT_MISMATCH | 결제 금액이 plan 가격과 불일치 |
| BIL_005 | 404 | SUBSCRIPTION_NOT_FOUND | 구독 미발견 |
| BIL_006 | 400 | SUBSCRIPTION_ALREADY_CANCELLED | 이미 취소된 구독 |
| BIL_007 | 409 | DUPLICATE_PAYMENT | 이미 처리된 결제 (impUid 중복) |
| BIL_008 | 401 | WEBHOOK_INVALID_SIGNATURE | Webhook HMAC 서명 무효 |
| BIL_009 | 401 | WEBHOOK_TIMESTAMP_EXPIRED | Webhook 타임스탬프 만료 (replay 방어) |
| BIL_010 | 400 | WEBHOOK_PAYLOAD_INVALID | Webhook 페이로드 형식 불량 |

### EmailError (EMAIL) — ADR-024

| 코드 | HTTP | enum 값 | 설명 |
|------|------|---------|------|
| EMAIL_001 | 502 | EMAIL_DELIVERY_FAILED | Resend API 장애 / 2xx 외 응답 / 네트워크 에러 |
| EMAIL_002 | 503 | EMAIL_CONFIG_MISSING | Resend API key / from address 미설정 |

### IapError (IAP) — ADR-022

| 코드 | HTTP | enum 값 | 설명 |
|------|------|---------|------|
| IAP_001 | 400 | RECEIPT_INVALID | 영수증 검증 실패 (서명 / signedTransaction 무효) |
| IAP_002 | 502 | APPLE_API_ERROR | Apple App Store Server API 통신 실패 |
| IAP_003 | 502 | GOOGLE_API_ERROR | Google Play Developer API 통신 실패 |
| IAP_004 | 400 | UNSUPPORTED_PLATFORM | 지원하지 않는 platform (apple/google 외) |
| IAP_005 | 400 | PRODUCT_MISMATCH | 영수증 productId 가 요청과 불일치 |
| IAP_006 | 503 | APPLE_CONFIG_MISSING | Apple key / issuer / bundle 미설정 |
| IAP_007 | 503 | GOOGLE_CONFIG_MISSING | Google service account / package 미설정 |

### PaymentError (PAY) — PortOne PG

| 코드 | HTTP | enum 값 | 설명 |
|------|------|---------|------|
| PAY_001 | 400 | VERIFICATION_FAILED | 결제 검증 실패 |
| PAY_002 | 404 | PAYMENT_NOT_FOUND | 결제 정보 미발견 |
| PAY_003 | 400 | AMOUNT_MISMATCH | 결제 금액 불일치 |
| PAY_004 | 400 | REFUND_FAILED | 환불 처리 실패 |
| PAY_005 | 502 | PORTONE_API_ERROR | PG 사 API 호출 실패 |
| PAY_006 | 502 | PORTONE_AUTH_FAILED | PG 사 인증 실패 (API key/secret 확인) |
| PAY_007 | 400 | WEBHOOK_INVALID | 유효하지 않은 webhook |
| PAY_008 | 503 | CONFIG_MISSING | PortOne API 설정 누락 (V1 key/secret 또는 webhook secret) — `StubPaymentAdapter` graceful 503 |

> `IAP_006/007` 과 `PAY_008` 은 *graceful 503* 패턴이에요. 미설정 상태에서도 서버는 부팅하고, 해당 도메인 호출만 503 으로 응답해요. `StubIapAdapter` / `StubPaymentAdapter` 가 같은 패턴을 구현해요.

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
throw new EmailException(EmailError.EMAIL_DELIVERY_FAILED, cause);  // ADR-024
```

### Service 레이어 패턴 — 리소스 못 찾을 때

리소스 미발견 / 권한 거부 / 검증 실패 같은 *예측 가능한 비즈니스 예외* 는 *반드시* 도메인 `XxxException` 또는 `CommonException` 을 사용해요. `IllegalArgumentException` / `IllegalStateException` 같은 표준 예외는 `GlobalExceptionHandler` 의 fallback (500) 으로 잘못 매핑되어 *클라이언트에 generic message* 만 노출돼요.

**✓ 권장 — 도메인 enum 우선**:

```java
// 도메인 enum 이 있으면 그것을 사용
public UserProfile getProfile(long userId) {
    User user = userRepository.findById(userId)
        .orElseThrow(() -> new UserException(
            UserError.USER_NOT_FOUND,
            Map.of("id", String.valueOf(userId))
        ));
    return user.toProfile();
}
```

**✓ 권장 — 도메인 enum 없을 때 CommonError**:

```java
// 도메인 전용 enum 이 없는 일반 케이스
Device device = deviceRepository.findById(deviceId)
    .orElseThrow(() -> new CommonException(
        CommonError.NOT_FOUND,
        Map.of("resource", "Device", "id", String.valueOf(deviceId))
    ));
```

**✗ 금지 — 표준 예외 직접 throw**:

```java
// IllegalArgumentException → 500 으로 매핑 (잘못된 응답)
throw new IllegalArgumentException("user not found: " + userId);

// IllegalStateException → 500 으로 매핑
throw new IllegalStateException("subscription already cancelled");

// RuntimeException → 500
throw new RuntimeException("invalid state");
```

**예외**: 입력 validation (Bean Validation `@Valid`) 의 `MethodArgumentNotValidException`, JPA / Spring 의 inferral RuntimeException 같은 *프레임워크 발생 예외* 는 `GlobalExceptionHandler` 가 적절히 매핑해서 처리해요. 이건 application code 가 직접 throw 하는 것과 별개.

**InternalServerError 의 정당한 케이스**: 진짜 서버 내부 invariant 위반 (예: SHA-256 미지원, Class.forName 실패 같은) 은 `IllegalStateException` 으로 throw 가능. 단 매우 드문 케이스. 일반적 비즈니스 예외는 모두 `XxxException` 또는 `CommonException`.

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

**GlobalExceptionHandler 수정은 불필요해요** — `BaseException` 핸들러가 자동으로 처리합니다.

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
| 컨트롤러에서 `ApiResponse.error()` 직접 반환 | 예외를 던지고 핸들러가 변환해요 |
| `checked exception` 사용 | `RuntimeException` 만 사용합니다. Spring 트랜잭션 rollback 호환을 위해서예요 |
| `BaseException` 을 직접 throw | 반드시 도메인 Exception (AuthException, UserException 등) 을 사용해요 |
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
| `core-auth-api/.../exception/AuthError.java` | 인증 에러 enum (ATH_001~010) |
| `core-auth-api/.../exception/AuthException.java` | 인증 예외 |
| `core-user-api/.../exception/UserError.java` | 유저 에러 enum (USR_001~002) |
| `core-user-api/.../exception/UserException.java` | 유저 예외 |
| `core-billing-api/.../exception/BillingError.java` | 결제/구독/webhook 에러 enum (BIL_001~BIL_010) |
| `core-billing-api/.../exception/BillingException.java` | 결제 예외 |
| `core-email-api/.../exception/EmailError.java` | 이메일 에러 enum (EMAIL_001~002) |
| `core-iap-api/.../exception/IapError.java` | IAP 에러 enum (IAP_001~007) |
| `core-payment-api/.../exception/PaymentError.java` | PG 결제 에러 enum (PAY_001~008) |
| `core-payment-api/.../exception/PaymentException.java` | PG 결제 예외 |

---

## 관련 문서

- [`API Response Format`](../api-and-functional/api/api-response.md) — 예외가 변환되는 응답 포맷
- [`Flutter ↔ Backend Integration`](../api-and-functional/api/flutter-backend-integration.md) — 클라이언트 측 401/403 처리 규약
- [`Architecture Reference`](../structure/architecture.md) — 모듈 구조 + 의존 그래프
- [`도그푸딩 walkthrough`](../start/dogfood-walkthrough.md) — `StubPaymentAdapter` graceful 503 패턴이 정착된 흐름
