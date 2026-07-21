# Naming Conventions

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~10분

이 문서는 Java 패키지, 클래스, 메서드, 데이터베이스 테이블과 컬럼의 이름 규칙을 모읍니다. 작업 중 "이건 어떤 접미사를 붙이지?" 싶을 때 찾아보는 용도예요. 규칙의 근거가 더 궁금하면 각 절 끝의 ADR 링크를 따라가세요.

---

## 원칙

이름은 의도를 드러내야 합니다. 구현 세부사항이 아니라 "무엇을 하는가" 를 표현해요.

약어는 최소화합니다. `usr` 대신 `user`, `svc` 대신 `service` 를 써요. 다만 널리 알려진 약어인 JWT, JPA, DTO, API 는 그대로 사용합니다.

일관성이 개인 취향보다 우선합니다. 이 문서의 규칙이 마음에 들지 않아도 같은 레포 안에서는 통일해요.

---

## 패키지 구조

### 루트 패키지

모든 Java 코드는 `com.factory` 아래에 위치합니다. 템플릿의 기본 네임스페이스이고, [파생 레포](../reference/glossary.md#이-레포-고유-용어) 에서도 바꾸지 않는 걸 권장해요.

브랜딩을 위해 패키지명을 바꾸고 싶을 수 있어요. 하지만 그렇게 하면 cherry-pick backport 때 모든 import 가 충돌합니다. 그래서 패키지는 고정하고, 브랜드 이름은 스토어 번들 ID나 도메인, 상품명 같은 다른 곳에서 표현해요.

### 레이어별 하위 패키지

```
com.factory
├── common.<module>            # common-* 모듈 (예: com.factory.common.web)
├── core.<module>.api          # core-*-api 모듈의 인터페이스와 DTO
├── core.<module>.impl         # core-*-impl 모듈의 구현
├── apps.<slug>                # 앱 모듈 (예: com.factory.apps.sumtally)
└── bootstrap                  # 진입점
```

### 레이어 내부 구조

각 모듈의 Java 패키지 내부는 역할별로 나눠요. 아래는 `core-*-impl` 모듈에서 실제로 쓰는 하위 패키지예요.

```
com.factory.core.auth.impl
├── controller        # REST 컨트롤러
├── service           # 비즈니스 로직
├── entity            # JPA 엔티티
├── repository        # Spring Data JPA 리포지토리
└── config            # Spring 설정 클래스
```

도메인마다 필요한 특수 패키지를 더 둘 수 있어요. 예를 들어 `core-auth-impl` 은 2FA 코드를 모은 `totp` 패키지를 따로 가집니다.

`mapper` 패키지는 두지 않습니다. 엔티티 ↔ DTO 변환은 Mapper 클래스 대신 Entity 의 `toProfile()` 같은 메서드로 처리해요. Mapper 이름의 클래스는 ArchUnit r22 가 빌드 시점에 차단합니다. 자세한 패턴은 [`DTO 팩토리 컨벤션`](./dto-factory.md) 을 참고하세요.

모듈이 작으면 하위 패키지를 생략할 수 있습니다. `common-logging` 처럼 클래스가 두세 개뿐이면 단일 패키지에 모아도 됩니다.

---

## 클래스 네이밍

### 인터페이스와 구현

포트 인터페이스는 외부에 노출되는 경계라서 `XxxPort` 접미사를 씁니다. ArchUnit r14 가 `*Port` 인터페이스를 `core-*-api` 패키지 안에 강제해요.

```java
// core-user-api 모듈
public interface UserPort {
    UserSummary getSummary(long userId);
}
```

서비스 구현은 `XxxServiceImpl` 을 씁니다. ArchUnit r15 가 `*ServiceImpl` 클래스를 `core-*-impl` 패키지 안에 강제해요.

```java
// core-user-impl 모듈
@Service
public class UserServiceImpl implements UserPort { ... }
```

`XxxPort` 는 "외부가 의존해도 되는 안정적 경계" 를 명시합니다. `XxxServiceImpl` 은 "이 클래스는 구현체이므로 직접 의존 금지" 를 명시해요.

### 내부 서비스 (외부 노출 아님)

같은 모듈 안에서만 쓰이는 헬퍼 서비스는 `Xxx` 또는 `XxxService` 를 씁니다. 외부에 노출되는 인터페이스가 없으니 `Impl` 접미사는 붙이지 않아요.

```java
// core-auth-impl 내부 — 빈 등록은 AuthAutoConfiguration 의 @Bean 으로
public class AppleJwksClient { ... }           // 외부 노출 없음

public class EmailAuthService { ... }          // core-auth-impl 내부 조립 용도
```

### 컨트롤러

REST 컨트롤러는 `XxxController` 를 씁니다. 인증·유저 같은 공통 컨트롤러는 core 모듈의 공유 런타임 빈이고, `{appSlug}` path 변수 하나로 모든 앱을 서빙합니다 ([`ADR-013`](../philosophy/adr-013-per-app-auth-endpoints.md)). 앱 모듈에는 그 앱의 도메인 컨트롤러만 둬요.

```java
// core-auth-impl — 모든 앱 공유 (경로는 "/api/apps/{appSlug}/auth")
@RestController
@RequestMapping(ApiEndpoints.Auth.BASE)
public class AuthController { ... }

// apps/app-sumtally — 앱 도메인 전용
@RestController
@RequestMapping("/api/apps/sumtally/expenses")
public class ExpenseController { ... }
```

### 엔티티

JPA 엔티티는 접미사 없이 도메인 명사를 그대로 씁니다.

```java
@Entity
@Table(name = "users")
public class User extends BaseEntity { ... }   // UserEntity 아님
```

`User` 는 도메인 모델의 이름이고, JPA 엔티티인지는 `@Entity` 어노테이션이 알려줘요. `UserEntity` 는 기술적 세부사항을 이름에 녹인 것이라서 피합니다.

`@Table` 에는 schema 를 적지 않습니다. 앱마다 다른 schema 라우팅은 어노테이션이 아니라 [`SchemaRoutingDataSource`](../reference/glossary.md#데이터베이스) 가 요청의 [`appSlug`](../reference/glossary.md#이-레포-고유-용어) 를 읽어 런타임에 결정해요. 그래서 같은 `users` 테이블이 `sumtally` schema 와 `gymlog` schema 양쪽에 따로 존재합니다. 구조는 [`멀티테넌트 아키텍처`](../structure/multitenant-architecture.md) 를 참고하세요.

### DTO

DTO 는 용도에 따라 접미사를 달리합니다. ArchUnit r19 가 허용하는 접미사는 아래 13개예요. 그 외 이름은 빌드가 차단합니다. r18 은 `..dto..` 패키지의 클래스가 record(또는 sealed interface)이도록 강제해요.

| 분류 | 접미사 | 용도 | 실제 예시 |
|---|---|---|---|
| 입력 | `Request` | 클라이언트가 보내는 입력 | `SignInRequest`, `AuditLogSearchRequest` |
| 단일 entity 뷰 | `Summary` | 최소 필드만 담은 요약 뷰 | `UserSummary` |
| 단일 entity 뷰 | `Profile` | 전체 필드를 담은 상세 뷰 | `UserProfile` |
| 단일 entity 뷰 | `Account` | 인증/인가 컨텍스트 뷰 (passwordHash, role 포함) | `UserAccount` |
| 단일 entity 뷰 | `Info` | 설정/메타 정보성 뷰 | `TotpInfo` |
| 복합/래퍼 | `Response` | 여러 도메인 데이터를 묶은 응답 | `AuthResponse`, `UploadUrlResponse` |
| 복합/래퍼 | `Tokens` | 토큰 묶음 | `AuthTokens` |
| 연산 결과 | `Result` | 작업의 산출 결과 | `PaymentResult`, `RefundResult` |
| 연산 결과 | `Status` | 상태 표현 (현재 미사용, 향후 허용) | — |
| 전송 입력 | `Message` | 외부로 보낼 메시지/페이로드 | `PushMessage`, `WebhookMessage` |
| 도메인 이벤트 | `Event` | 내부 pub/sub 이벤트 | `AuditEvent` |
| 외부 알림 | `Notification` | 외부 서비스 알림 모델 | `IapNotification` |
| 일반 | `Dto` | 위 분류에 안 맞는 교환 객체 | `DeviceDto`, `SubscriptionPlanDto` |

분류별 사용 규칙은 이렇습니다.

- **단일 entity 뷰** (`Summary` · `Profile` · `Account` · `Info`) 는 [`dto-factory.md`](./dto-factory.md) 의 `Entity.toXxx()` 메서드와 1:1로 대응돼요. 새 뷰가 필요하면 Entity 에 `to<NewView>()` 메서드를 추가하세요.
- **복합/래퍼** (`Response` · `Tokens`) 는 단일 entity 로 표현이 안 되는 경우에만 만듭니다. 예를 들어 `AuthResponse` 는 `UserSummary` 와 `AuthTokens` 를 묶어요. 단일 entity 하나를 그대로 반환할 거면 뷰 접미사를 쓰세요. `getProfile()` 은 `UserProfile` 을 반환하지, `UserProfileResponse` 로 한 번 더 감싸지 않습니다.
- **연산 결과·전송·이벤트·알림** (`Result` · `Message` · `Event` · `Notification`) 은 결제·푸시·감사·IAP 처럼 도메인 동작의 입출력에 씁니다. `Status` 는 허용 목록에는 있지만 현재 코드에 실제 사용처가 없어요. 새로 쓰기 전에 `Summary` 나 `Info` 로 표현되지 않는지 먼저 검토하세요.

이름이 길어지면 가독성이 떨어지니, 가능한 한 명료한 한 단어를 고릅니다.

### 예외

예외는 도메인 단위로 `XxxException` 하나만 만들고, 구체적인 에러는 `XxxError` enum 으로 구분합니다. `NotFoundException` 같은 상황 기반 예외를 새로 만들지 않아요. ArchUnit r16 이 `*Exception` 클래스를 `..exception..` 패키지 안에 강제합니다.

```java
// 에러 enum — 3자 도메인 약어 + 숫자 (USR_001 등)
public enum UserError implements ErrorInfo {
    USER_NOT_FOUND(404, "USR_001", "유저를 찾을 수 없습니다"),
    EMAIL_ALREADY_EXISTS(409, "USR_002", "이미 사용 중인 이메일입니다");
    // ...
}

// 도메인 예외 — BaseException 상속
public class UserException extends BaseException {
    public UserException(UserError error) { super(error); }
    public UserException(UserError error, Map<String, Object> details) { super(error, details); }
}

// 사용
throw new UserException(UserError.USER_NOT_FOUND, Map.of("id", String.valueOf(userId)));
```

자세한 체계는 [`Exception Handling Convention`](./exception-handling.md) 을 참고하세요.

### Enum

- **클래스명** — `XxxError`, `XxxStatus`, `XxxType` 처럼 도메인에 의미 접미사를 붙입니다.
- **상수명** — Java 표준 `UPPER_SNAKE_CASE` 를 씁니다. 예를 들어 `INVALID_CREDENTIALS`, `TOKEN_EXPIRED`, `EMAIL_NOT_VERIFIED`.
- **에러 enum** 의 상수는 [`Exception Handling`](./exception-handling.md) 의 에러 코드(예: `ATH_001`)와 1:1로 매칭돼요. 같은 도메인 의미를 통일합니다.

```java
public enum AuthError implements ErrorInfo {
    INVALID_CREDENTIALS(401, "ATH_001", "이메일 또는 비밀번호가 올바르지 않습니다"),
    TOKEN_EXPIRED(401, "ATH_002", "토큰이 만료되었습니다"),
    // ...
}
```

### 설정 클래스

- `XxxConfig` — 일반 Spring 설정 클래스 (`@Configuration`)
- `XxxProperties` — `@ConfigurationProperties` 클래스
- `XxxAutoConfiguration` — Spring Boot 자동 설정 클래스 (`@AutoConfiguration`)

```java
@ConfigurationProperties("app.email.resend")
public record ResendProperties(String apiKey, String fromAddress, String fromName) { }

@AutoConfiguration
@ConditionalOnClass(JpaRepository.class)
public class AuthAutoConfiguration { ... }
```

---

## 메서드 네이밍

### 조회 메서드

`findXxx` 는 결과가 없을 수 있어요. `Optional<T>` 를 반환합니다.

```java
Optional<User> findByEmail(String email);
```

`getXxx` 는 반드시 결과가 있어야 합니다. 없으면 예외를 던져요.

```java
User getById(Long id);  // 없으면 UserException(UserError.USER_NOT_FOUND)
```

`existsXxx` 는 boolean 을 반환합니다.

```java
boolean existsByEmail(String email);
```

Optional 을 쓰면서도 "반드시 있는 경우" 를 명시적으로 표현하려는 규칙이에요. 호출자가 결과를 어떻게 다뤄야 할지 이름만 보고도 알 수 있습니다.

### 상태 변경 메서드

동사로 시작합니다.

- `create`, `update`, `delete`, `save`, `store`
- `activate`, `deactivate`, `enable`, `disable`
- `register`, `unregister`
- `grant`, `revoke`
- `verify`, `confirm`, `reject`

### 불리언 반환 메서드

`is`, `has`, `can`, `should` 접두사를 씁니다.

```java
boolean isActive();
boolean hasAppAccess(String appSlug);
boolean canSendNotification();
boolean shouldRetry();
```

### 회피할 이름

- `process()`, `handle()`, `manage()` — 뭘 하는지 불명확해요.
- `doXxx()` — Java 관용과 충돌은 없지만 보통 더 나은 이름이 있어요.
- `utility()`, `helper()` — 역할이 불분명해요.

---

## 데이터베이스 네이밍

### 테이블

snake_case 복수형을 씁니다.

- `users`, `devices`, `auth_refresh_tokens`, `auth_email_verification_tokens`

테이블은 행의 집합이라서 복수형이 자연스러워요. Hibernate 가 JPA 엔티티명을 복수형으로 자동 변환하지 않으니 `@Table(name = "users")` 로 명시합니다.

### 컬럼

snake_case 단수를 씁니다.

- `id`, `email`, `password_hash`, `display_name`, `created_at`

#### 표준 컬럼

모든 엔티티가 공유하는 표준 컬럼이에요.

```sql
id          BIGSERIAL PRIMARY KEY,
created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
```

soft delete 가 필요한 엔티티는 다음 컬럼을 추가해요.

```sql
deleted_at  TIMESTAMPTZ  -- null 이면 살아있어요
```

FK 컬럼은 이렇게 작성합니다.

```sql
-- 앱별 schema 를 씁니다 (core.users 가 아닌 <slug>.users)
user_id  BIGINT NOT NULL REFERENCES sumtally.users(id)
```

### 인덱스

`idx_<table>_<column>` 패턴을 씁니다.

```sql
-- 앱 schema 에 생성해요 (core schema 아님)
CREATE INDEX idx_users_email ON sumtally.users(email);
CREATE INDEX idx_users_deleted_at ON sumtally.users(deleted_at);
```

유니크 인덱스는 `uk_` 접두사를 씁니다.

```sql
CREATE UNIQUE INDEX uk_users_email ON sumtally.users(email) WHERE deleted_at IS NULL;
```

### Schema

Schema 이름은 앱의 slug 와 일치시켜요. `core` schema 도 함께 쓰지만 *템플릿 기준선* 역할만 합니다. 실제 런타임 유저는 앱 schema 에 들어가요.

- `sumtally`, `gymlog`, `fintrack`, `rny` — 각 앱 모듈(slug)
- `core` — 템플릿 기준선 + bootstrap test 의 단일 DB
- 각 앱 schema 는 유저/인증 테이블과 도메인 테이블을 모두 포함해요.

Schema 이름은 snake_case(또는 alphanumeric)로 작성하고, 하이픈은 쓰지 않습니다. 격리 근거는 [`ADR-005 · 단일 Postgres + 앱당 schema`](../philosophy/adr-005-db-schema-isolation.md) 를 참고하세요.

---

## Flyway 마이그레이션

### 파일 이름

`V{버전}__{설명}.sql` 형식을 따릅니다.

- `V001__init_users.sql`
- `V002__init_auth_social_identities.sql`
- `V026__init_budget_groups.sql`

규칙은 이렇습니다.

- 버전은 001부터 시작하고 3자리 패딩이에요 (V001, V002, ..., V099, V100).
- 설명은 snake_case 로 씁니다.
- 한 파일은 한 논리적 변경이에요. 서로 참조하는 테이블을 한 마이그레이션에 묶는 정도는 허용합니다.
- 이미 배포된 마이그레이션은 수정하지 않습니다. 변경이 필요하면 새 V 파일로 수행해요.

### 디렉토리 구조

`new app` 스크립트가 V001~V025 공통 마이그레이션을 자동으로 깔아 주고, 도메인 테이블은 개발자가 그다음 빈 번호인 V026부터 작성합니다. V007 admin 시드는 `--seed-admin` 을 붙였을 때만 생성되는 opt-in 파일이라, 기본 생성은 24개예요.

```
apps/app-sumtally/src/main/resources/db/migration/sumtally/
    V001__init_users.sql                    ← new-app.sh 자동 생성
    V002__init_auth_social_identities.sql   ← new-app.sh 자동 생성
    ...
    V007__seed_admin_user.sql               ← admin 시드 (--seed-admin opt-in)
    ...
    V018__init_attachment_file.sql          ← new-app.sh 자동 생성 (파일 첨부)
    ...
    V025__add_analytics.sql                 ← new-app.sh 자동 생성 (마지막 공통)
    V026__init_budget_groups.sql            ← 개발자가 작성 (첫 도메인 테이블)
    V027__init_expenses.sql                 ← 개발자가 작성
```

공통 마이그레이션의 내용 분류는 [`onboarding.md`](../start/onboarding.md#3-첫-앱-모듈-추가) 의 표에 정리돼 있어요.

각 앱 schema 는 자기 디렉토리에서 공통 테이블(V001~V025)과 도메인 테이블(V026~)을 함께 관리합니다. Flyway 는 각 디렉토리를 자기 schema 에 대해 독립적으로 적용해요. 공통 마이그레이션 개수는 템플릿이 진화하면서 늘어나니, 도메인 시작 번호는 항상 생성된 디렉토리의 마지막 V 번호 다음을 쓰세요.

---

## Request / Response DTO 규칙

### Pair 강제 안 함

모든 엔드포인트에 `XxxRequest` / `XxxResponse` 짝을 반드시 만들 필요는 없습니다. 규칙은 이래요.

- **Command (POST/PUT/PATCH/DELETE)** — `XxxRequest` DTO 가 자연스러운 경우에만 만듭니다. 반환은 `ApiResponse<해당 도메인 DTO>` 를 써요.
- **Query (GET)** — body 없이 query parameter 로 조건을 전달합니다. body 용 Request DTO 가 없어요.
- **`XxxResponse`** — 단일 도메인 DTO 로 표현이 안 되는 복합 응답에만 씁니다. 예를 들어 `AuthResponse` 는 `UserSummary` 와 `AuthTokens` 를 묶어요.

### 조회 요청 표준

목록 조회 API 는 공통 페이지네이션 DTO 인 `PageListRequest` 를 씁니다. `common-web/search/` 에 있고, `page` · `size` · `sorts` · `filterModel` 네 부분으로 구성돼요. 도메인별 검색 조건은 `filterModel`(도메인 `XxxSearchRequest` record)에 담깁니다.

`PageListRequest` 는 r18 의 예외로 record 가 아닌 일반 class 입니다. Spring 의 `@ModelAttribute` / Jackson setter 바인딩이 record 의 불변성과 충돌할 수 있어 mutable bean 패턴을 채택했어요.

도메인 검색 요청은 `XxxSearchRequest` 형태의 record 로 만들어요. 예를 들어 감사 로그 검색은 이렇게 생겼어요.

```java
// core-audit-api — AuditLogSearchRequest 발췌
public record AuditLogSearchRequest(
        Long actorUserId,
        String actorEmail,
        List<String> actions,
        Instant occurredFrom,
        Instant occurredTo,
        List<SortOrder> sorts,
        int page,
        int size) { ... }
```

평면 Map 으로 조건을 보내는 방식도 지원해요. 키 형식은 `{fieldName}_{operator}` 예요.

```json
{
  "categoryId_eq": 5,
  "amount_gte": 10000,
  "title_like": "커피"
}
```

현재 빌더가 지원하는 연산자는 15개(`eq` 기본, `ne` · `like` · `gte` · `in` · `between` · `isNull` 등)와 대소문자 무시 `i` 변형이에요. 전체 표는 [`Dynamic Query 컨벤션`](./dynamic-query.md) 에 있어요. 초기 설계는 핵심 8개 연산자로 출발했고, 그 배경과 `common-web` ↔ `common-persistence` 분리 이유는 [`ADR-010 (SearchCondition)`](../philosophy/adr-010-search-condition.md) 을 참고하세요.

---

## REST 엔드포인트 URL

### 패턴

```
/api/apps/{slug}/{resource}[/{id}][/{sub-resource}]
```

| 부분 | 설명 | 예시 |
|---|---|---|
| `slug` | 앱 식별자 | `sumtally`, `rny`, `gymlog` |
| `resource` | 복수 명사 또는 기능 키워드 | `users`, `auth`, `expenses` |
| `{id}` | 리소스 식별자 | `123`, `me` |
| `sub-resource` | 관련 리소스 | `/api/apps/sumtally/users/me/activity` |

### 인증 엔드포인트 (앱별)

```
POST   /api/apps/{slug}/auth/email/signup            # 이메일 가입
POST   /api/apps/{slug}/auth/email/signin            # 이메일 로그인
POST   /api/apps/{slug}/auth/apple                   # Apple 로그인
POST   /api/apps/{slug}/auth/google                  # Google 로그인
POST   /api/apps/{slug}/auth/kakao                   # Kakao 로그인
POST   /api/apps/{slug}/auth/naver                   # Naver 로그인
POST   /api/apps/{slug}/auth/refresh                 # 토큰 갱신
POST   /api/apps/{slug}/auth/withdraw                # 탈퇴
POST   /api/apps/{slug}/auth/verify-email            # 이메일 인증
POST   /api/apps/{slug}/auth/password-reset/request  # 비밀번호 재설정 요청
POST   /api/apps/{slug}/auth/password-reset/confirm  # 비밀번호 재설정 확인
```

가입 전 이메일 인증 코드(`/auth/email/send-code` · `/auth/email/verify-code`), 2FA(`/auth/me/2fa/*` · `/auth/2fa/login`), 휴대폰 점유인증(`/auth/phone/*`)도 같은 패턴을 따라요. 전체 목록은 `common-web` 의 `ApiEndpoints.Auth` 에 있어요.

### 유저/도메인 엔드포인트 (앱별)

```
GET    /api/apps/{slug}/users/me             # 프로필 조회
PATCH  /api/apps/{slug}/users/me             # 프로필 수정
POST   /api/apps/{slug}/users/me/activity    # 활동 ping (DAU 기록)
POST   /api/apps/{slug}/devices              # 디바이스 등록
DELETE /api/apps/{slug}/devices/{id}         # 디바이스 해제
GET    /api/apps/{slug}/{resource}           # 도메인 리소스 목록
POST   /api/apps/{slug}/{resource}           # 도메인 리소스 생성
```

### 예시 (sumtally 앱)

```
POST   /api/apps/sumtally/auth/email/signup  # 이메일 가입
GET    /api/apps/sumtally/users/me           # 현재 유저 프로필
GET    /api/apps/sumtally/expenses           # 가계부 지출 목록
POST   /api/apps/sumtally/expenses           # 지출 등록
GET    /api/apps/sumtally/expenses/{id}      # 지출 상세
```

### 규칙

HTTP 메서드의 의미를 지킵니다.

- `GET` — 조회, 서버 상태 변경 없음 (idempotent)
- `POST` — 생성, 또는 "동사적 행위" (로그인, 탈퇴 등)
- `PUT` — 전체 교체 (idempotent)
- `PATCH` — 부분 수정
- `DELETE` — 삭제

query parameter 는 필터링, 페이지네이션, 정렬에 씁니다.

```
GET /api/apps/sumtally/expenses?page=0&size=20&sort=date,desc&categoryId=5
```

---

## 파일 네이밍

- Java 파일명은 클래스명과 일치해요 (Java 언어 요구사항).
- SQL 파일명은 Flyway 규칙을 따라요 (위 참조).
- YAML/Properties 설정 파일은 `application-{profile}.yml` 형식이에요.
- Shell 스크립트는 kebab-case 예요. 예를 들어 `new-app.sh`, `backup-to-nas.sh`.

---

## 요약

한 줄로 기억할 게 있습니다.

> **"6개월 뒤의 나 자신이 이 이름만 보고 의도를 파악할 수 있는가?"**

이름을 짓기 전에 이 질문을 던지고, 답이 "아니오" 면 이름을 바꿔요.

---

## 관련 문서

- [`Exception Handling Convention`](./exception-handling.md) — 도메인 예외 + ErrorCode enum
- [`record vs class 선택 기준`](./records-and-classes.md) — record 선택 기준
- [`DTO 팩토리 컨벤션`](./dto-factory.md) — DTO 생성/변환 패턴
- [`Architecture Rules (ArchUnit)`](../structure/architecture-rules.md) — r14~r22 (네이밍 기반 위치 규칙)
- [`ADR-010 (SearchCondition)`](../philosophy/adr-010-search-condition.md) — `PageListRequest` 의 conditions Map 형식
