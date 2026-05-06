# Naming Conventions

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~10분

이 문서는 Java 패키지, 클래스, 메서드, 데이터베이스 테이블/컬럼의 이름 규칙을 정의해요.

---

## 원칙

**이름은 의도를 드러내야 해요.** 구현 세부사항이 아니라 "무엇을 하는가" 를 표현해요.

**약어는 최소화해요.** `usr` 대신 `user`, `svc` 대신 `service` 를 써요. 다만 널리 알려진 약어 (JWT, JPA, DTO, API) 는 그대로 사용합니다.

**일관성 > 개인 취향이에요.** 이 문서의 규칙이 마음에 들지 않아도, 같은 레포 안에서는 통일해요.

---

## 패키지 구조

### 루트 패키지

모든 Java 코드는 `com.factory` 아래에 위치해요. 이는 템플릿의 기본 네임스페이스이고, 파생 레포에서도 **바꾸지 않는 것을 권장** 해요.

브랜딩을 위해 패키지명을 바꾸고 싶을 수 있어요. 하지만 그렇게 하면 cherry-pick backport 시 모든 import 충돌이 발생합니다. 그래서 패키지는 고정하고 브랜드 이름은 다른 곳 (스토어 번들 ID, 도메인, 상품명 등) 에서 표현해요.

### 레이어별 하위 패키지

```
com.factory
├── common.<module>            # common-* 모듈 (예: com.factory.common.web)
├── core.<module>.api          # core-*-api 모듈의 인터페이스/DTO
├── core.<module>.impl         # core-*-impl 모듈의 구현
├── apps.<slug>                # 앱 모듈 (예: com.factory.apps.sumtally)
└── bootstrap                  # 진입점
```

### 레이어 내부 구조

각 모듈의 Java 패키지 내부는 역할별로 나눠요.

```
com.factory.core.auth.impl
├── controller        # REST 컨트롤러
├── service           # 비즈니스 로직
├── entity            # JPA 엔티티
├── repository        # Spring Data JPA 리포지토리
├── mapper            # 엔티티 ↔ DTO 변환 (실제로 ArchUnit r22 로 금지 — Entity 메서드 패턴 사용)
├── email             # (해당 모듈 특수) 이메일 어댑터
└── config            # Spring 설정 클래스
```

**예외** — 모듈이 작으면 하위 패키지를 생략할 수 있습니다. `common-logging` 처럼 클래스 3~4 개뿐이면 단일 패키지에 모아도 됩니다.

---

## 클래스 네이밍

### 인터페이스와 구현

**포트 인터페이스 (외부 노출)** 는 `XxxPort` 접미사를 사용합니다.

```java
// core-user-api 모듈
public interface UserPort {
    UserSummary findById(Long id);
}
```

**서비스 구현** 은 `XxxServiceImpl` 을 사용합니다.

```java
// core-user-impl 모듈
@Service
public class UserServiceImpl implements UserPort { ... }
```

**이유** — `XxxPort` 는 "외부가 의존해도 되는 안정적 경계" 를 명시해요. `XxxServiceImpl` 은 "이 클래스는 구현체이므로 직접 의존 금지" 를 명시해요.

### 내부 서비스 (외부 노출 아님)

같은 모듈 안에서만 쓰이는 헬퍼 서비스는 `Xxx` 또는 `XxxService` 를 사용합니다. `Impl` 접미사는 붙이지 않아요 (외부에 노출되는 인터페이스가 없으니까요).

```java
// core-auth-impl 내부
@Component
class AppleJwksClient { ... }           // 외부 노출 없음

@Service
class EmailAuthService { ... }          // core-auth-impl 내부에서 조립 용도
```

### 컨트롤러

REST 컨트롤러는 `XxxController` 를 사용합니다.

```java
// 앱별 인증 컨트롤러 — 각 앱 모듈에 위치
@RestController
@RequestMapping("/api/apps/sumtally/auth")
public class AuthController { ... }

// 앱별 유저 컨트롤러 — 각 앱 모듈에 위치
@RestController
@RequestMapping("/api/apps/sumtally/users")
public class UserController { ... }
```

### 엔티티

JPA 엔티티는 접미사 없이 도메인 명사를 그대로 써요.

```java
// 앱별 schema 를 사용합니다. schema 이름은 앱 slug 와 일치해요.
@Entity
@Table(schema = "sumtally", name = "users")  // 앱마다 schema 가 다름
public class User { ... }               // UserEntity 아님
```

**이유** — `User` 는 도메인 모델의 이름이고, JPA 엔티티인지는 `@Entity` 어노테이션이 알려줘요. `UserEntity` 는 기술적 세부사항을 이름에 녹인 것이라서 피해요.

### DTO

DTO 는 용도에 따라 접미사를 달리해요. 크게 **입력**, **단일 entity view**, **복합/래퍼** 세 종류로 나뉘어요.

| 분류 | 접미사 | 용도 | 예시 |
|---|---|---|---|
| 입력 | `Request` | 클라이언트가 보내는 입력 | `SignUpRequest`, `UpdateProfileRequest` |
| 단일 entity view | `Summary` | 최소 필드만 담은 요약 뷰 | `UserSummary` |
| 단일 entity view | `Profile` | 전체 필드를 담은 상세 뷰 | `UserProfile` |
| 단일 entity view | `Account` | 인증/인가 컨텍스트 뷰 (passwordHash, role 포함) | `UserAccount` |
| 복합/래퍼 | `Response` | 여러 도메인 데이터를 묶은 응답 | `AuthResponse` (`UserSummary` + `AuthTokens`), `HealthResponse` |
| 복합/래퍼 | `Tokens` | 토큰 묶음 | `AuthTokens` (access + refresh) |
| 일반 | `Dto` | 위 분류에 안 맞는 내부/외부 교환 객체 | `UserAppAccessDto` |

**규칙**:
- **단일 entity view** 접미사 (`Summary`/`Profile`/`Account` 등) 는 [`dto-factory.md`](./dto-factory.md) 의 `Entity.toXxx()` 메서드와 1:1 로 대응돼요. 새 view 가 필요하면 Entity 에 `to<NewView>()` 메서드를 추가하세요.
- **복합/래퍼** 접미사 (`Response`/`Tokens` 등) 는 단일 entity 로 표현 안 되는 경우에만 만들어요. 단일 entity 1개를 그대로 반환할 거면 view 접미사를 그대로 쓰세요 (예: `getProfile()` 은 `UserProfile` 을 반환, `UserProfileResponse` 로 한 번 더 감싸지 않음).
- 복합 사용도 가능해요 (`UserProfileResponse` 등). 다만 과하면 이름이 길어지니까 가능한 한 명료한 하나의 단어를 선택해요.

### 예외

예외는 **도메인 단위** 로 하나의 `XxxException` 만 만들고, 구체적인 에러는 `XxxError` enum 으로 구분합니다. `NotFoundException` 같은 상황 기반 예외를 새로 만들지 않습니다.

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

자세한 체계는 [`Exception Handling Convention`](./exception-handling.md) 를 참고하세요.

### Enum

- **클래스명**: `XxxError`, `XxxStatus`, `XxxType` 등 도메인 + 의미 접미사
- **constant 명**: Java 표준 `UPPER_SNAKE_CASE` (예: `INVALID_CREDENTIALS`, `TOKEN_EXPIRED`, `EMAIL_NOT_VERIFIED`)
- **에러 enum** 의 constant 는 [`Exception Handling`](./exception-handling.md) 의 에러 코드 (예: `ATH_001`) 와 1:1 매칭 — 동일 도메인 의미 통일

```java
public enum AuthError implements ErrorInfo {
    INVALID_CREDENTIALS(401, "ATH_001", "이메일 또는 비밀번호가 올바르지 않습니다"),
    TOKEN_EXPIRED(401, "ATH_002", "토큰이 만료되었습니다"),
    ...
}
```

### 설정 클래스

- `XxxConfig` — 일반 Spring 설정 클래스
- `XxxProperties` — `@ConfigurationProperties` 클래스
- `XxxAutoConfiguration` — Spring Boot 자동 설정 클래스

```java
@ConfigurationProperties("app.jwt")
public record JwtProperties(String secret, Duration accessTokenTtl) { }

@AutoConfiguration
@EnableConfigurationProperties(JwtProperties.class)
public class SecurityAutoConfiguration { ... }
```

---

## 메서드 네이밍

### 조회 메서드

**`findXxx`** — 없을 수 있습니다. `Optional<T>` 를 반환합니다.

```java
Optional<User> findByEmail(String email);
```

**`getXxx`** — 반드시 있어야 해요. 없으면 예외를 던져요.

```java
User getById(Long id);  // 없으면 UserException(UserError.USER_NOT_FOUND)
```

**`existsXxx`** — boolean 을 반환합니다.

```java
boolean existsByEmail(String email);
```

**이유** — Java Optional 을 사용하면서도 "반드시 있는 경우" 를 명시적으로 표현하기 위함이에요. 호출자가 결과를 어떻게 처리해야 할지 이름만 보고도 알 수 있습니다.

### 상태 변경 메서드

동사로 시작해요.

- `create`, `update`, `delete`, `save`, `store`
- `activate`, `deactivate`, `enable`, `disable`
- `register`, `unregister`
- `grant`, `revoke`
- `verify`, `confirm`, `reject`

### 불리언 반환 메서드

`is`, `has`, `can`, `should` 접두사를 사용합니다.

```java
boolean isActive();
boolean hasAppAccess(String appSlug);
boolean canSendNotification();
boolean shouldRetry();
```

### 회피할 이름

- `process()`, `handle()`, `manage()` — 뭘 하는지 불명확해요
- `doXxx()` — Java 관용과 충돌은 없지만 보통 더 나은 이름이 있어요
- `utility()`, `helper()` — 역할이 불분명해요

---

## 데이터베이스 네이밍

### 테이블

**snake_case 복수형** 을 사용합니다.

- `users`, `devices`, `refresh_tokens`, `email_verification_tokens`

복수형을 쓰는 이유 — 테이블은 **행의 집합** 이라서 복수가 자연스러워요. Hibernate 가 JPA 엔티티명을 복수형으로 자동 변환하지 않으니까 `@Table(name = "users")` 로 명시해요.

### 컬럼

**snake_case 단수** 를 사용합니다.

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

FK 컬럼은 다음과 같이 작성해요.

```sql
-- 앱별 schema 를 사용해요 (core.users 가 아닌 <slug>.users)
user_id  BIGINT NOT NULL REFERENCES sumtally.users(id)
```

### 인덱스

**`idx_<table>_<column>`** 패턴을 사용합니다.

```sql
-- 앱 schema 에 생성해요 (core schema 아님)
CREATE INDEX idx_users_email ON sumtally.users(email);
CREATE INDEX idx_users_deleted_at ON sumtally.users(deleted_at);
```

유니크 인덱스는 `uk_` 접두사를 사용합니다.

```sql
CREATE UNIQUE INDEX uk_users_email ON sumtally.users(email) WHERE deleted_at IS NULL;
```

### Schema

Schema 이름은 앱의 slug 와 일치시켜요. `core` schema 도 함께 사용하지만 *템플릿 기준선* 역할만 해요 — 실제 런타임 유저는 앱 schema 에 들어가요.

- `sumtally`, `gymlog`, `fintrack`, `rny` — 각 앱 모듈 (slug)
- `core` — 템플릿 기준선 + bootstrap test 의 단일 DB
- 각 앱 schema 는 유저/인증 테이블 + 도메인 테이블을 모두 포함해요

Schema 이름은 snake_case (또는 alphanumeric) 로 작성하고, 하이픈 사용은 금지예요.

---

## Flyway 마이그레이션

### 파일 이름

`V{버전}__{설명}.sql` 형식을 따라요.

- `V001__init_users.sql`
- `V002__init_social_identities.sql`
- `V003__add_is_premium_to_users.sql`

**규칙**:

- 버전은 001 부터 시작하고 3자리 패딩이에요 (V001, V002, ..., V099, V100)
- 설명은 snake_case
- 한 파일은 한 논리적 변경 (여러 테이블 동시 추가 같은 건 허용)
- **이미 배포된 마이그레이션은 수정 금지** (새 V 파일로 변경 수행)

### 디렉토리 구조

```
apps/app-sumtally/src/main/resources/db/migration/sumtally/
    V001__init_users.sql                 ← new-app.sh 자동 생성
    V002__init_social_identities.sql     ← new-app.sh 자동 생성
    V003__init_refresh_tokens.sql        ← new-app.sh 자동 생성
    V004__init_email_verification_tokens.sql  ← new-app.sh 자동 생성
    V005__init_password_reset_tokens.sql      ← new-app.sh 자동 생성
    V006__init_devices.sql               ← new-app.sh 자동 생성
    V007__init_budget_groups.sql         ← 개발자가 작성
    V008__init_expenses.sql              ← 개발자가 작성
```

각 앱 schema 는 유저/인증 테이블(V001~V006)과 도메인 테이블(V007~)을 하나의 디렉토리에서 관리합니다.

각 schema 는 별도 디렉토리를 가져요. Flyway 는 각 디렉토리를 자기 schema 에 대해 독립적으로 관리합니다.

---

## Request / Response DTO 규칙

### Pair 강제 안 함

모든 엔드포인트에 `XxxRequest` / `XxxResponse` pair 를 반드시 만들 필요는 없습니다. 규칙은 다음과 같아요.

- **Command (POST/PUT/PATCH/DELETE)** — `XxxRequest` DTO 가 자연스러운 경우에만 만듭니다. 반환은 `ApiResponse<해당 도메인 DTO>` 를 사용합니다.
- **Query (GET)** — body 없이 query parameter 나 `SearchRequest` 로 조건을 전달해요. body 용 Request DTO 가 없습니다.
- **`XxxResponse`** 접미사 — 단일 도메인 DTO 로 표현이 안 되는 복합 응답에만 사용해요 (`AuthResponse = UserSummary + AuthTokens`).

### 조회 요청 표준

목록 조회 API 는 `SearchRequest` 공통 DTO 를 사용합니다.

```json
{
  "conditions": {
    "categoryId_eq": 5,
    "amount_gte": 10000,
    "title_like": "커피"
  },
  "page": { "page": 0, "size": 20 },
  "sort": [
    { "field": "createdAt", "direction": "DESC" }
  ]
}
```

`conditions` 의 키 형식은 `{fieldName}_{operator}` 예요. 지원 연산자는 `eq` (기본), `not`, `gte`, `lte`, `gt`, `lt`, `like`, `in`, `notIn`, `isNull`, `isNotNull` 이에요.

상세 규칙은 [`ADR-010 (SearchCondition)`](../philosophy/adr-010-search-condition.md) 을 참조하세요.

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
| `sub-resource` | 관련 리소스 | `/api/apps/sumtally/users/me/devices` |

### 인증 엔드포인트 (앱별)

```
POST   /api/apps/{slug}/auth/email/signup    # 앱별 이메일 가입
POST   /api/apps/{slug}/auth/email/signin    # 앱별 이메일 로그인
POST   /api/apps/{slug}/auth/apple           # 앱별 Apple 로그인
POST   /api/apps/{slug}/auth/google          # 앱별 Google 로그인
POST   /api/apps/{slug}/auth/refresh         # 앱별 토큰 갱신
POST   /api/apps/{slug}/auth/withdraw        # 앱별 탈퇴
POST   /api/apps/{slug}/auth/verify-email    # 앱별 이메일 인증
POST   /api/apps/{slug}/auth/password-reset  # 앱별 비밀번호 재설정 요청
POST   /api/apps/{slug}/auth/password-reset/confirm  # 앱별 비밀번호 재설정 확인
```

### 유저/도메인 엔드포인트 (앱별)

```
GET    /api/apps/{slug}/users/me             # 앱별 프로필 조회
PATCH  /api/apps/{slug}/users/me             # 앱별 프로필 수정
GET    /api/apps/{slug}/users/me/devices     # 앱별 내 디바이스 목록
POST   /api/apps/{slug}/devices              # 앱별 디바이스 등록
DELETE /api/apps/{slug}/devices/{id}         # 앱별 디바이스 해제
GET    /api/apps/{slug}/{resource}           # 앱별 도메인 리소스 목록
POST   /api/apps/{slug}/{resource}           # 앱별 도메인 리소스 생성
```

### 예시 (sumtally 앱)

```
POST   /api/apps/sumtally/auth/email/signup  # sumtally 이메일 가입
POST   /api/apps/sumtally/auth/email/signin  # sumtally 이메일 로그인
GET    /api/apps/sumtally/users/me           # sumtally 현재 유저 프로필
GET    /api/apps/sumtally/expenses           # 가계부 지출 목록
POST   /api/apps/sumtally/expenses           # 지출 등록
GET    /api/apps/sumtally/expenses/{id}      # 지출 상세
```

### 규칙

**HTTP 메서드 의미 준수**:

- `GET` — 조회, 서버 상태 변경 없음 (idempotent)
- `POST` — 생성, 또는 "동사적 행위" (로그인, 탈퇴 등)
- `PUT` — 전체 교체 (idempotent)
- `PATCH` — 부분 수정
- `DELETE` — 삭제

**query parameter** 는 필터링, 페이지네이션, 정렬에 사용합니다.

```
GET /api/apps/sumtally/expenses?page=0&size=20&sort=date,desc&categoryId=5
```

---

## 파일 네이밍

- Java 파일명은 클래스명과 일치해요 (Java 언어 요구사항)
- SQL 파일명은 Flyway 규칙을 따라요 (위 참조)
- YAML/Properties 설정 파일은 `application-{profile}.yml` 형식이에요
- Shell 스크립트는 `kebab-case.sh` 예요 (예: `new-app.sh`, `backup-to-nas.sh`)

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
- [`ADR-010 (SearchCondition)`](../philosophy/adr-010-search-condition.md) — `SearchRequest` 의 conditions Map 형식
