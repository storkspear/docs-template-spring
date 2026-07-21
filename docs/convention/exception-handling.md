# Exception Handling Convention

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~6분

이 문서는 예외 처리의 단일 정본입니다. 에러 코드 체계, HTTP 매핑, 새 예외 추가 절차, 테스트 검증 규칙을 한곳에 모았어요.

---

## 개요

예외 처리의 뼈대는 세 가지로 요약돼요.

- 모든 비즈니스 예외는 `BaseException` 을 상속하고, `ErrorInfo` enum 값 하나로 HTTP 상태·에러 코드·메시지를 함께 들고 다녀요.
- `GlobalExceptionHandler` 가 `BaseException` 하나만 잡아 통일된 응답 envelope 으로 변환합니다. 도메인마다 핸들러를 새로 만들 필요가 없어요.
- 에러 코드는 도메인 약어 세 글자에 번호를 붙인 형식이고, 한 번 부여한 번호는 절대 재배치하지 않습니다.

찾는 정보가 "전체 에러 코드 목록" 이라면 [3. 에러 코드 전체 목록](#3-에러-코드-전체-목록) 으로, "새 도메인에 예외를 추가하는 절차" 라면 [5. 새 도메인에 예외 추가하기](#5-새-도메인에-예외-추가하기) 로 바로 점프하세요.

---

## 1. 아키텍처

`ErrorInfo` 인터페이스가 모든 Error enum 의 계약이고, `BaseException` 이 모든 도메인 예외의 부모예요. 둘을 `GlobalExceptionHandler` 가 한곳에서 받아냅니다.

```
ErrorInfo (인터페이스)
    ├── CommonError      ← CMN_001 ~ CMN_010, CMN_429
    ├── AuthError        ← ATH_001 ~ ATH_014 (ATH_006 결번 · 2FA — ADR-030 · 이메일 인증 코드 · 계정 잠금)
    ├── UserError        ← USR_001 ~ USR_002
    ├── BillingError     ← BIL_001 ~ BIL_010 (구독·결제·webhook — ADR-020)
    ├── EmailError       ← EMAIL_001 ~ EMAIL_002 (ADR-024)
    ├── SmsError         ← SMS_001 ~ SMS_002
    ├── PhoneAuthError   ← PHA_001 ~ PHA_006 (휴대폰 점유인증)
    ├── IapError         ← IAP_001 ~ IAP_007 (Apple·Google IAP — ADR-022)
    ├── PaymentError     ← PAY_001 ~ PAY_009 (PortOne PG — ADR-019)
    ├── StorageError     ← STG_001 ~ STG_011 (오브젝트 스토리지)
    └── AdminError       ← ADMIN_001 ~ ADMIN_025 (운영 콘솔 — core-admin-impl)

BaseException (부모)
    ├── CommonException      ← 공통 예외 (NOT_FOUND, FORBIDDEN, JWT 토큰 등)
    ├── AuthException        ← 인증 예외 (로그인, 소셜, 토큰 갱신, 2FA)
    ├── UserException        ← 유저 예외 (유저 미발견, 이메일 중복)
    ├── BillingException     ← 결제·구독·webhook 예외
    ├── EmailException       ← 이메일 발송 예외 (ADR-024)
    ├── SmsException         ← 문자 발송 예외
    ├── PhoneAuthException   ← 휴대폰 점유인증 예외
    ├── IapException         ← IAP 영수증 검증·webhook 예외 (ADR-022)
    ├── PaymentException     ← PG 결제 검증·환불·webhook 예외
    ├── StorageException     ← 오브젝트 스토리지 예외
    └── Admin*Exception      ← 운영 콘솔 예외 다수 (AdminAuthException·AdminAccountException·
                               AdminFileNotFoundException 등 — admin 은 세분화된 예외 클래스 사용)

GlobalExceptionHandler
    └── @ExceptionHandler(BaseException.class) 하나로 전부 처리
```

`core-audit` (ADR-028) 은 전용 Error·Exception 을 두지 않아요. 감사 로그 기록은 application flow 의 부산물이라 실패해도 throw 하지 않고, WARN 로그만 남겨 사용자 흐름을 끊지 않습니다.

---

## 2. Error Code 체계

형식은 도메인 약어 + `_` + 번호입니다. 약어는 도메인명의 발음 기반 대표 스펠링에서 뽑아요. 보통 세 글자지만, 의미가 더 또렷한 표기가 있으면 글자 수를 늘리기도 합니다 (`EMAIL`).

| 도메인 | 약어 | 범위 |
|---|---|---|
| common | CMN | CMN_001 ~ CMN_999 |
| auth | ATH | ATH_001 ~ ATH_999 |
| user | USR | USR_001 ~ USR_999 |
| billing | BIL | BIL_001 ~ BIL_999 |
| email | EMAIL | EMAIL_001 ~ EMAIL_999 (ADR-024 — 의미 우선해서 5자) |
| sms | SMS | SMS_001 ~ SMS_999 |
| phone-auth | PHA | PHA_001 ~ PHA_999 |
| iap | IAP | IAP_001 ~ IAP_999 (ADR-022) |
| payment | PAY | PAY_001 ~ PAY_999 (PortOne PG) |
| storage | STG | STG_001 ~ STG_999 |
| admin (운영 콘솔) | ADMIN | ADMIN_001 ~ ADMIN_999 (의미 우선해서 5자) |
| 파생 앱 | 발음 3자 | STL_001 (settlement), GYM_001 (gymlog) |

한 가지 원칙만 기억하면 돼요. **이미 부여한 코드 번호는 재배치하지 않습니다.** 새 에러는 그 도메인의 다음 빈 번호에 추가만 해요. 번호를 바꾸면 이미 그 코드로 분기 중인 클라이언트가 한꺼번에 깨지기 때문이에요. 같은 이유로 ATH 처럼 중간 번호 (ATH_006) 가 비어 있어도 그 자리는 다시 채우지 않고 비워 둡니다. 이 규칙은 [`CLAUDE.md`](../../CLAUDE.md) 에도 빌드 규칙으로 명시돼 있어요.

---

## 3. 에러 코드 전체 목록

코드는 머신 리더블 식별자라 클라이언트가 이 값으로 분기해요. HTTP 상태와 코드는 1:1 로 고정돼서, 같은 코드가 상황에 따라 다른 상태로 바뀌지 않습니다.

### CommonError (CMN)

| 코드 | HTTP | enum 값 | 설명 |
|---|---|---|---|
| CMN_001 | 422 | VALIDATION_ERROR | 입력값 검증 실패 (비즈니스 검증) |
| CMN_002 | 404 | NOT_FOUND | 리소스 미발견 |
| CMN_003 | 409 | CONFLICT | 리소스 충돌 |
| CMN_004 | 401 | UNAUTHORIZED | 인증 필요 |
| CMN_005 | 403 | FORBIDDEN | 권한 없음 |
| CMN_006 | 500 | INTERNAL_ERROR | 서버 내부 오류 |
| CMN_007 | 401 | ACCESS_TOKEN_EXPIRED | JWT access token 만료 |
| CMN_008 | 401 | ACCESS_TOKEN_INVALID | JWT access token 무효 |
| CMN_009 | 503 | FEATURE_DISABLED | 기능 비활성 (ADR-034 Lite 모드) |
| CMN_010 | 426 | UPGRADE_REQUIRED | 앱 버전이 서버 최소 요구 버전 미만 (min-version 게이트) |
| CMN_429 | 429 | RATE_LIMIT_EXCEEDED | Rate limit 초과 (Retry-After 헤더 포함) |

JWT access token 에러 (CMN_007·CMN_008) 가 `AuthError` 가 아니라 `CommonError` 에 있는 건 모듈 의존 때문이에요. 토큰을 검증하는 common-security 가 core-auth-api 에 의존할 수 없어서, 공통 레이어에 배치했어요.

### AuthError (ATH)

| 코드 | HTTP | enum 값 | 설명 |
|---|---|---|---|
| ATH_001 | 401 | INVALID_CREDENTIALS | 이메일·비밀번호 불일치 |
| ATH_002 | 401 | TOKEN_EXPIRED | refresh·reset·verification 토큰 만료 |
| ATH_003 | 401 | INVALID_TOKEN | refresh·reset·verification 토큰 무효 |
| ATH_004 | 401 | SOCIAL_AUTH_FAILED | 소셜 로그인 검증 실패 |
| ATH_005 | 401 | EMAIL_NOT_VERIFIED | 이메일 인증 필요 |
| ATH_007 | 401 | TOTP_VERIFICATION_FAILED | 2FA 인증 코드 무효 (ADR-030) |
| ATH_008 | 409 | TOTP_ALREADY_ENABLED | 2FA 이미 활성 |
| ATH_009 | 409 | TOTP_NOT_ENABLED | 2FA 미활성 상태에서 verify·disable 호출 |
| ATH_010 | 401 | TOTP_REQUIRED | 2FA pending — `/auth/2fa/login` 으로 완료 필요 |
| ATH_011 | 401 | INVALID_VERIFICATION_CODE | 가입 前 이메일 인증 코드 불일치·만료·시도초과·미존재 (verify-before-signup) |
| ATH_012 | 401 | VERIFICATION_PROOF_INVALID | 가입 시 제출된 이메일 인증 증명 JWT 무효 |
| ATH_013 | 429 | VERIFICATION_RATE_LIMITED | send-code 재발송 횟수 초과 (per-email rate limit) |
| ATH_014 | 429 | ACCOUNT_LOCKED | 로그인 실패 누적으로 계정 일시 잠금 (brute-force 방어 · `Retry-After` 헤더 + `details.retryAfterSeconds`) |

`ATH_002`·`ATH_003` 은 refresh·이메일 인증·비밀번호 재설정 토큰 전용이에요. JWT access token 의 만료·무효는 위의 `CMN_007`·`CMN_008` 을 써요.

### UserError (USR)

| 코드 | HTTP | enum 값 | 설명 |
|---|---|---|---|
| USR_001 | 404 | USER_NOT_FOUND | 유저 미발견 |
| USR_002 | 409 | EMAIL_ALREADY_EXISTS | 이메일 중복 |

### BillingError (BIL) — ADR-020

| 코드 | HTTP | enum 값 | 설명 |
|---|---|---|---|
| BIL_001 | 404 | PLAN_NOT_FOUND | plan 미발견 |
| BIL_002 | 400 | PLAN_INACTIVE | 비활성 plan |
| BIL_003 | 400 | PAYMENT_NOT_PAID | 결제 상태가 PAID 아님 |
| BIL_004 | 400 | PAYMENT_AMOUNT_MISMATCH | 결제 금액이 plan 가격과 불일치 |
| BIL_005 | 404 | SUBSCRIPTION_NOT_FOUND | 구독 미발견 |
| BIL_006 | 400 | SUBSCRIPTION_ALREADY_CANCELLED | 이미 취소된 구독 |
| BIL_007 | 409 | DUPLICATE_PAYMENT | 이미 처리된 결제 |
| BIL_008 | 401 | WEBHOOK_INVALID_SIGNATURE | Webhook 서명 무효 |
| BIL_009 | 401 | WEBHOOK_TIMESTAMP_EXPIRED | Webhook 타임스탬프 만료 (replay 방어) |
| BIL_010 | 400 | WEBHOOK_PAYLOAD_INVALID | Webhook 페이로드 형식 불량 |

### EmailError (EMAIL) — ADR-024

| 코드 | HTTP | enum 값 | 설명 |
|---|---|---|---|
| EMAIL_001 | 502 | EMAIL_DELIVERY_FAILED | 이메일 발송 실패 (Resend 장애·네트워크 에러) |
| EMAIL_002 | 503 | EMAIL_CONFIG_MISSING | Resend API key·from 주소 미설정 |

### SmsError (SMS)

| 코드 | HTTP | enum 값 | 설명 |
|---|---|---|---|
| SMS_001 | 502 | SMS_DELIVERY_FAILED | 문자 발송 실패 |
| SMS_002 | 503 | SMS_CONFIG_MISSING | SMS 발신사 미설정 |

### PhoneAuthError (PHA)

| 코드 | HTTP | enum 값 | 설명 |
|---|---|---|---|
| PHA_001 | 401 | OTP_NOT_FOUND | 유효한 인증 요청 없음 |
| PHA_002 | 401 | OTP_INVALID_CODE | 인증번호 불일치 |
| PHA_003 | 401 | OTP_EXPIRED | 인증번호 만료 |
| PHA_004 | 429 | OTP_TOO_MANY_ATTEMPTS | 인증 시도 횟수 초과 |
| PHA_005 | 429 | OTP_RATE_LIMITED | 인증번호 요청이 너무 잦음 |
| PHA_006 | 503 | OTP_SMS_UNAVAILABLE | 문자 발송 불가 (발신 채널 장애) |

### IapError (IAP) — ADR-022

| 코드 | HTTP | enum 값 | 설명 |
|---|---|---|---|
| IAP_001 | 400 | RECEIPT_INVALID | 영수증 검증 실패 |
| IAP_002 | 502 | APPLE_API_ERROR | Apple App Store Server API 통신 실패 |
| IAP_003 | 502 | GOOGLE_API_ERROR | Google Play Developer API 통신 실패 |
| IAP_004 | 400 | UNSUPPORTED_PLATFORM | 지원하지 않는 platform |
| IAP_005 | 400 | PRODUCT_MISMATCH | 영수증 productId 가 요청과 불일치 |
| IAP_006 | 503 | APPLE_CONFIG_MISSING | Apple key·issuer·bundle 미설정 |
| IAP_007 | 503 | GOOGLE_CONFIG_MISSING | Google service account·package 미설정 |

### PaymentError (PAY) — PortOne PG

| 코드 | HTTP | enum 값 | 설명 |
|---|---|---|---|
| PAY_001 | 400 | VERIFICATION_FAILED | 결제 검증 실패 |
| PAY_002 | 404 | PAYMENT_NOT_FOUND | 결제 정보 미발견 |
| PAY_003 | 400 | AMOUNT_MISMATCH | 결제 금액 불일치 |
| PAY_004 | 400 | REFUND_FAILED | 환불 처리 실패 |
| PAY_005 | 502 | PORTONE_API_ERROR | PG 사 API 호출 실패 |
| PAY_006 | 502 | PORTONE_AUTH_FAILED | PG 사 인증 실패 (API key·secret 확인) |
| PAY_007 | 400 | WEBHOOK_INVALID | 유효하지 않은 webhook |
| PAY_008 | 503 | CONFIG_MISSING | PortOne 설정 누락 — `StubPaymentAdapter` graceful 503 |
| PAY_009 | 422 | PORTONE_BUSINESS_ERROR | PortOne 연결·인증은 정상이나 비즈니스 사유로 거부 |

`PAY_009` 는 PortOne 에 도달하고 인증도 성공했지만 PortOne 이 요청을 거절한 경우예요 (예: 존재하지 않는 결제번호). 네트워크·인증 실패인 `PAY_005`·`PAY_006` (502) 과 구분하려는 코드라, "연결은 정상인데 데이터·거래가 문제" 라는 의미를 담아요.

### StorageError (STG)

| 코드 | HTTP | enum 값 | 설명 |
|---|---|---|---|
| STG_001 | 404 | BUCKET_NOT_FOUND | bucket 미발견 |
| STG_002 | 404 | OBJECT_NOT_FOUND | object 미발견 |
| STG_003 | 500 | UPLOAD_FAILED | 업로드 실패 |
| STG_004 | 500 | DOWNLOAD_FAILED | 다운로드 실패 |
| STG_005 | 413 | QUOTA_EXCEEDED | bucket 용량 초과 |
| STG_006 | 413 | SIZE_LIMIT_EXCEEDED | 업로드 크기 한도 초과 |
| STG_007 | 400 | INVALID_OBJECT_KEY | 잘못된 object key |
| STG_008 | 500 | SIGNED_URL_GENERATION_FAILED | signed URL 생성 실패 |
| STG_009 | 503 | ADAPTER_UNAVAILABLE | 스토리지 어댑터 미가용 |
| STG_010 | 500 | DELETE_FAILED | 삭제 실패 |
| STG_011 | 500 | COPY_FAILED | 복사 실패 |

### AdminError (ADMIN)

운영 콘솔 (core-admin-impl) 전용 — `/api/admin` API 에서만 사용됩니다 (앱 클라이언트는 분기할 일 없음).

| 코드 | HTTP | enum 값 | 설명 |
|---|---|---|---|
| ADMIN_001 | 401 | INVALID_CREDENTIALS | 콘솔 로그인 이메일·비밀번호 불일치 |
| ADMIN_002 | 400 | UNSUPPORTED_METRIC | 지원하지 않는 분석 지표 |
| ADMIN_003 | 404 | UNKNOWN_SLUG | 알 수 없는 앱 슬러그 |
| ADMIN_004 | 400 | INVALID_DATE_RANGE | 날짜 형식/범위 파싱 실패 |
| ADMIN_005 | 404 | USER_NOT_FOUND | 대상 사용자 미발견 |
| ADMIN_006 | 400 | PG_REFUND_ONLY | PG 결제만 콘솔 환불 가능 (IAP 불가) |
| ADMIN_007 | 404 | PAYMENT_NOT_FOUND | 결제 내역 미발견 |
| ADMIN_008 | 400 | FILE_ALREADY_QUARANTINED | 이미 검역된 파일 |
| ADMIN_009 | 400 | FILE_NOT_QUARANTINED | 검역되지 않은 파일의 복원 시도 |
| ADMIN_010 | 404 | FILE_NOT_FOUND | 파일 미발견 |
| ADMIN_011 | 409 | ADMIN_EMAIL_EXISTS | 관리자 계정 이메일 중복 |
| ADMIN_012 | 404 | ADMIN_ACCOUNT_NOT_FOUND | 관리자 계정 미발견 |
| ADMIN_013 | 400 | ADMIN_INVALID_ROLE | 알 수 없는 역할 |
| ADMIN_014 | 400 | ADMIN_CANNOT_MODIFY_SELF | 본인 계정 삭제/역할 변경 불가 |
| ADMIN_015 | 400 | ADMIN_LAST_MASTER | 마지막 마스터 계정 삭제/강등 불가 |
| ADMIN_016 | 400 | ADMIN_WRONG_PASSWORD | 현재 비밀번호 불일치 |
| ADMIN_017 | 403 | ADMIN_ROLE_EDIT_FORBIDDEN | 상급자·본인 티어 권한/계정 편집 불가 |
| ADMIN_018 | 400 | ADMIN_PERM_NOT_EDITABLE | 편집 불가 권한 (고정 grant) |
| ADMIN_019 | 400 | ADMIN_PERM_DEPENDENCY | 원본 열람·쓰기는 조회 권한 선행 필요 |
| ADMIN_020 | 400 | ADMIN_REFUND_AMOUNT_INVALID | 환불 금액이 가능 잔액 초과 |
| ADMIN_021 | 400 | ADMIN_REFUND_NOT_ALLOWED | 환불 불가 결제 (전액 환불됨/미완료) |
| ADMIN_022 | 404 | ADMIN_CONTENT_NOT_FOUND | 대상 게시물 미발견 |
| ADMIN_023 | 400 | ATTACHMENT_ASSOCIATION_FAILED | 첨부 연관 확정 실패 (부재·slug 불일치·타 게시물 소유) |
| ADMIN_024 | 400 | USER_ALREADY_DELETED | 이미 탈퇴 처리된 사용자 (콘솔 삭제 재호출) |
| ADMIN_025 | 410 | USER_ERASED | 완전삭제(익명화)된 사용자 (export/삭제 시도) |

### graceful 503 패턴

`IAP_006`·`IAP_007`·`PAY_008` 은 graceful 503 패턴이에요. 외부 결제 설정이 비어 있어도 서버는 정상 부팅하고, 해당 도메인을 호출할 때만 503 으로 응답합니다. `StubIapAdapter` 와 `StubPaymentAdapter` 가 같은 방식으로 동작해요. 덕분에 결제를 아직 안 붙인 앱도 서버가 뜨고 나머지 기능은 그대로 쓸 수 있어요.

---

## 4. 사용법

### 기본 사용

```java
throw new AuthException(AuthError.INVALID_CREDENTIALS);
throw new CommonException(CommonError.FORBIDDEN);
```

### 추가 정보 포함

`details` 맵으로 컨텍스트를 실어 보내요. 클라이언트 디버깅과 로그 추적에 쓰여요.

```java
throw new AuthException(AuthError.SOCIAL_AUTH_FAILED, Map.of("provider", "apple"));
throw new UserException(UserError.USER_NOT_FOUND, Map.of("id", String.valueOf(userId)));
throw new CommonException(CommonError.NOT_FOUND, Map.of("resource", "Device", "id", "123"));
```

### 원인 예외 체이닝

외부 라이브러리 예외를 도메인 예외로 감쌀 때는 `cause` 를 넘겨요. cause 는 서버 로그에만 기록되고 클라이언트에는 노출되지 않습니다.

```java
throw new EmailException(EmailError.EMAIL_DELIVERY_FAILED, cause);  // ADR-024
```

### Service 레이어에서 무엇을 던질까

리소스 미발견·권한 거부·검증 실패처럼 예측 가능한 비즈니스 예외는 반드시 도메인 `XxxException` 이나 `CommonException` 을 던져요. `IllegalArgumentException` 이나 `IllegalStateException` 같은 표준 예외를 직접 던지면 `GlobalExceptionHandler` 의 fallback 으로 떨어져 500 + generic message 로 잘못 매핑돼요.

도메인 전용 enum 이 있으면 그것을 먼저 써요.

```java
public UserProfile getProfile(long userId) {
    User user = userRepository.findById(userId)
        .orElseThrow(() -> new UserException(
            UserError.USER_NOT_FOUND,
            Map.of("id", String.valueOf(userId))));
    return user.toProfile();
}
```

도메인 전용 enum 이 없는 일반 케이스라면 `CommonError` 를 써요.

```java
Device device = deviceRepository.findById(deviceId)
    .orElseThrow(() -> new CommonException(
        CommonError.NOT_FOUND,
        Map.of("resource", "Device", "id", String.valueOf(deviceId))));
```

표준 예외를 비즈니스 분기에 직접 던지는 건 피해요. 아래는 전부 500 으로 잘못 매핑되는 안티패턴이에요.

```java
throw new IllegalArgumentException("user not found: " + userId);      // → 500
throw new IllegalStateException("subscription already cancelled");    // → 500
throw new RuntimeException("invalid state");                          // → 500
```

두 가지 예외 케이스가 있어요. 첫째, `@Valid` 의 `MethodArgumentNotValidException`, 타입 변환 실패, JPA·Spring 이 내부에서 던지는 예외 같은 프레임워크 발생 예외는 `GlobalExceptionHandler` 가 알아서 적절히 매핑해요. 이건 application code 가 직접 던지는 것과 별개예요. 둘째, 진짜 서버 내부 불변식 위반 (예: 런타임에 SHA-256 알고리즘이 없는 경우) 은 `IllegalStateException` 으로 던져도 됩니다. 실제로 `TokenGenerator` 가 이 패턴을 쓰지만, 매우 드문 케이스예요. 일반적인 비즈니스 예외는 모두 `XxxException` 이나 `CommonException` 이어야 해요.

---

## 5. 새 도메인에 예외 추가하기

세 단계면 끝나고, 마지막 단계의 핵심은 "핸들러를 안 건드려도 된다" 는 점이에요.

### Step 1 — Error enum 생성

`ErrorInfo` 를 구현하고, 도메인의 다음 빈 번호부터 코드를 부여해요.

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

### Step 2 — Exception 클래스 생성

`BaseException` 을 상속하고 생성자만 위임해요.

```java
public class SettlementException extends BaseException {
    public SettlementException(SettlementError error) { super(error); }
    public SettlementException(SettlementError error, Map<String, Object> details) { super(error, details); }
}
```

### Step 3 — 던지기

```java
throw new SettlementException(SettlementError.SETTLEMENT_NOT_FOUND);
```

`GlobalExceptionHandler` 는 수정하지 않아도 돼요. `BaseException` 핸들러가 새 예외를 자동으로 받아 HTTP 상태·코드·메시지를 그대로 응답으로 변환합니다.

---

## 6. 보안 원칙

응답에는 클라이언트가 분기할 정보만 담고, 내부 정보는 전부 서버 로그로만 보내요.

| 원칙 | 구현 |
|---|---|
| 에러 메시지로 내부 정보 노출 금지 | fallback 핸들러는 "Internal server error" 고정 반환. 상세는 서버 로그에만 |
| 이메일 열거 방지 | ATH_001 메시지가 "이메일 없음" 과 "비밀번호 틀림" 을 구분하지 않음 |
| 스택 트레이스 노출 금지 | `BaseException.cause` 는 로그에만 기록 |

---

## 7. 금지 사항

| 하지 말 것 | 이유 |
|---|---|
| 컨트롤러에서 `ApiResponse.error()` 직접 반환 | 예외를 던지고 핸들러가 변환합니다 |
| checked exception 사용 | `RuntimeException` 만 씁니다. Spring 트랜잭션 rollback 호환을 위해서예요 |
| `BaseException` 을 직접 throw | 반드시 도메인 Exception (AuthException, UserException 등) 을 씁니다 |
| 같은 에러 코드를 다른 HTTP 상태에 매핑 | 1 코드 = 1 HTTP 상태 |
| 기존 에러 코드 번호 재배치 | 추가만 허용. 비어 있는 번호도 다시 채우지 않습니다 |

broad `catch (Exception)` 도 기본적으로 피해요. 다만 외부 토큰 검증처럼 어떤 예외가 튈지 다 예측하기 어려운 자리에서는, 좁힌 catch 를 먼저 쌓고 그 위에 fail-secure fallback 으로 broad catch 하나만 허용해요. 예를 들어 `AppleSignInService` 는 `ExpiredJwtException`·`JwtException` 을 먼저 잡고, `AuthException` 은 그대로 다시 던지고, 마지막에 `catch (Exception)` 으로 모든 잔여 예외를 `AuthError.SOCIAL_AUTH_FAILED` 로 감싸 정보 유출 없이 닫아요.

---

## 8. 테스트에서 예외 검증

예외는 타입·후속 동작·발생 여부 세 가지를 검증해요.

```java
// 예외 타입 검증
assertThatThrownBy(() -> service.signIn(request))
    .isInstanceOf(AuthException.class);

// 예외 발생 시 후속 동작이 일어나지 않았는지 검증
verify(refreshTokenIssuer, never())
    .issueForNewLogin(anyLong(), anyString(), anyString(), anyString());

// 예외가 나지 않아야 하는 경우 검증 (이메일 열거 방지)
assertThatCode(() -> service.requestReset("nobody@example.com"))
    .doesNotThrowAnyException();
```

핸들러 자체의 응답 매핑은 `GlobalExceptionHandlerTest` 가 MockMvc 로 검증해요. 예를 들어 NOT_FOUND 가 404 + CMN_002 로, 알 수 없는 예외가 500 + generic message 로 변환되는지를 확인합니다.

---

## 9. 관련 파일

| 파일 | 역할 |
|---|---|
| `common-web/.../exception/ErrorInfo.java` | Error enum 인터페이스 |
| `common-web/.../exception/BaseException.java` | 모든 비즈니스 예외 부모 |
| `common-web/.../exception/CommonError.java` | 공통 에러 enum (CMN_001~010, CMN_429) |
| `common-web/.../exception/CommonException.java` | 공통 예외 |
| `common-web/.../exception/GlobalExceptionHandler.java` | BaseException 통합 핸들러 |
| `common-web/.../response/ApiError.java` | 에러 응답 구조 |
| `core-auth-api/.../exception/AuthError.java` | 인증 에러 enum (ATH_001~014, ATH_006 결번) |
| `core-auth-api/.../exception/AuthException.java` | 인증 예외 |
| `core-user-api/.../exception/UserError.java` | 유저 에러 enum (USR_001~002) |
| `core-user-api/.../exception/UserException.java` | 유저 예외 |
| `core-billing-api/.../exception/BillingError.java` | 결제·구독·webhook 에러 enum (BIL_001~010) |
| `core-billing-api/.../exception/BillingException.java` | 결제 예외 |
| `core-email-api/.../exception/EmailError.java` | 이메일 에러 enum (EMAIL_001~002) |
| `core-sms-api/.../exception/SmsError.java` | 문자 에러 enum (SMS_001~002) |
| `core-phone-auth-api/.../exception/PhoneAuthError.java` | 휴대폰 점유인증 에러 enum (PHA_001~006) |
| `core-iap-api/.../exception/IapError.java` | IAP 에러 enum (IAP_001~007) |
| `core-payment-api/.../exception/PaymentError.java` | PG 결제 에러 enum (PAY_001~009) |
| `core-payment-api/.../exception/PaymentException.java` | PG 결제 예외 |
| `core-storage-api/.../exception/StorageError.java` | 스토리지 에러 enum (STG_001~011) |
| `core-admin-impl/.../exception/AdminError.java` | 운영 콘솔 에러 enum (ADMIN_001~023) |
| `core-admin-impl/.../exception/Admin*Exception.java` | 운영 콘솔 예외 (AdminAuthException 등 다수) |

---

## 관련 문서

- [`API Response Format`](../api-and-functional/api/api-response.md) — 예외가 변환되는 응답 포맷
- [`Flutter ↔ Backend Integration`](../api-and-functional/api/flutter-backend-integration.md) — 클라이언트 측 401·403 처리 규약
- [`Naming Conventions`](./naming.md) — 도메인 예외·ErrorCode enum 네이밍
- [`Architecture Reference`](../structure/architecture.md) — 모듈 구조 + 의존 그래프
- [`도그푸딩 walkthrough`](../start/dogfood-walkthrough.md) — `StubPaymentAdapter` graceful 503 패턴이 정착된 흐름
