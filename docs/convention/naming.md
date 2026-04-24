# Naming Conventions

이 문서는 Java 패키지, 클래스, 메서드, 데이터베이스 테이블/컬럼의 이름 규칙을 정의합니다.

---

## 원칙

**이름은 의도를 드러내야 합니다.** 구현 세부사항이 아니라 "무엇을 하는가" 를 표현합니다.

**약어는 최소화합니다.** `usr` 대신 `user`, `svc` 대신 `service`. 다만 널리 알려진 약어(JWT, JPA, DTO, API) 는 그대로 사용합니다.

**일관성 > 개인 취향.** 이 문서의 규칙이 마음에 들지 않아도, 같은 레포 안에서는 통일합니다.

---

## 패키지 구조

### 루트 패키지

모든 Java 코드는 `com.factory` 아래에 위치합니다. 이는 템플릿의 기본 네임스페이스이며, 파생 레포에서도 **바꾸지 않는 것을 권장** 합니다. 이유: 파생 시점에 이름이 바뀌면 공통 코드 cherry-pick backport 가 까다로워집니다.

파생 레포가 다른 브랜드를 쓰고 싶으면 Java 패키지는 `com.factory` 유지하고, 다른 곳(스토어 번들 ID, 도메인, 상품명 등) 에서 브랜딩합니다.

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

각 모듈의 Java 패키지 내부는 역할별로 나눕니다.

```
com.factory.core.auth.impl
├── controller        # REST 컨트롤러
├── service           # 비즈니스 로직
├── entity            # JPA 엔티티
├── repository        # Spring Data JPA 리포지토리
├── mapper            # 엔티티 ↔ DTO 변환
├── email             # (해당 모듈 특수) 이메일 어댑터
└── config            # Spring 설정 클래스
```

**예외:** 모듈이 작으면 하위 패키지를 생략할 수 있습니다. `common-logging` 처럼 클래스 3~4 개뿐이면 단일 패키지에 모아도 됩니다.

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

**이유:** `XxxPort` 는 "외부가 의존해도 되는 안정적 경계" 를 명시합니다. `XxxServiceImpl` 은 "이 클래스는 구현체이므로 직접 의존 금지" 를 명시합니다.

### 내부 서비스 (외부 노출 아님)

같은 모듈 안에서만 쓰이는 헬퍼 서비스는 `Xxx` 또는 `XxxService` 를 사용합니다. `Impl` 접미사는 붙이지 않습니다 (외부에 노출되는 인터페이스가 없으므로).

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

JPA 엔티티는 접미사 없이 도메인 명사를 그대로 씁니다.

```java
// 앱별 schema 를 사용합니다. schema 이름은 앱 slug 와 일치합니다.
@Entity
@Table(schema = "sumtally", name = "users")  // 앱마다 schema 가 다름
public class User { ... }               // UserEntity 아님
```

**이유:** `User` 는 도메인 모델의 이름이고, JPA 엔티티인지는 `@Entity` 어노테이션이 알려줍니다. `UserEntity` 는 기술적 세부사항을 이름에 녹인 것이므로 피합니다.

### DTO

DTO 는 용도에 따라 접미사를 달리합니다.

| 접미사 | 용도 | 예시 |
|---|---|---|
| `Request` | 클라이언트가 보내는 입력 | `SignUpRequest`, `UpdateProfileRequest` |
| `Response` | 서버가 반환하는 출력 (복합) | `AuthResponse`, `HealthResponse` |
| `Dto` | 내부/외부 교환 객체 (일반적) | `UserAppAccessDto` |
| `Summary` | 최소 필드만 담은 요약 뷰 | `UserSummary` |
| `Profile` | 전체 필드를 담은 상세 뷰 | `UserProfile` |

복합 사용도 가능합니다 (`UserProfileResponse` 등), 다만 과하면 이름이 길어지므로 가능한 한 명료한 하나의 단어를 선택합니다.

### 예외

예외는 **도메인 단위**로 하나의 `XxxException` 만 만들고, 구체적인 에러는 `XxxError` enum 으로 구분합니다. `NotFoundException` 같은 상황 기반 예외를 새로 만들지 않습니다.

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

자세한 체계는 [`exception-handling.md`](./exception-handling.md) 를 참고하세요.

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

**`findXxx`** — 없을 수 있음. `Optional<T>` 를 반환합니다.

```java
Optional<User> findByEmail(String email);
```

**`getXxx`** — 반드시 있어야 함. 없으면 예외를 던집니다.

```java
User getById(Long id);  // 없으면 UserException(UserError.USER_NOT_FOUND)
```

**`existsXxx`** — boolean 을 반환합니다.

```java
boolean existsByEmail(String email);
```

**이유:** Java Optional 을 사용하면서도 "반드시 있는 경우" 를 명시적으로 표현하기 위함입니다. 호출자가 결과를 어떻게 처리해야 할지 이름만 보고도 알 수 있습니다.

### 상태 변경 메서드

동사로 시작합니다.

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

- `process()`, `handle()`, `manage()` — 뭘 하는지 불명확
- `doXxx()` — Java 관용과 충돌 없으나 보통 더 나은 이름이 있습니다
- `utility()`, `helper()` — 역할이 불분명

---

## 데이터베이스 네이밍

### 테이블

**snake_case 복수형** 을 사용합니다.

- `users`, `devices`, `refresh_tokens`, `email_verification_tokens`

복수형을 쓰는 이유: 테이블은 **행의 집합** 이므로 복수가 자연스럽습니다. Hibernate 가 JPA 엔티티명을 복수형으로 자동 변환하지 않으므로, `@Table(name = "users")` 로 명시합니다.

### 컬럼

**snake_case 단수** 를 사용합니다.

- `id`, `email`, `password_hash`, `display_name`, `created_at`

#### 표준 컬럼

모든 엔티티가 공유하는 표준 컬럼:

```sql
id          BIGSERIAL PRIMARY KEY,
created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
```

soft delete 가 필요한 엔티티:

```sql
deleted_at  TIMESTAMPTZ  -- null 이면 살아있음
```

FK 컬럼:

```sql
-- 앱별 schema 를 사용합니다 (core.users 가 아닌 <slug>.users)
user_id  BIGINT NOT NULL REFERENCES sumtally.users(id)
```

### 인덱스

**`idx_<table>_<column>`** 패턴을 사용합니다.

```sql
-- 앱 schema 에 생성합니다 (core schema 아님)
CREATE INDEX idx_users_email ON sumtally.users(email);
CREATE INDEX idx_users_deleted_at ON sumtally.users(deleted_at);
```

유니크 인덱스는 `uk_` 접두사:

```sql
CREATE UNIQUE INDEX uk_users_email ON sumtally.users(email) WHERE deleted_at IS NULL;
```

### Schema

Schema 이름은 앱의 slug 와 일치시킵니다. `core` schema 는 더 이상 사용하지 않습니다.

- `sumtally`, `gymlog`, `fintrack`, `rny` — 각 앱 모듈 (slug)
- 각 앱 schema 는 유저/인증 테이블 + 도메인 테이블을 모두 포함합니다

Schema 이름은 snake_case (또는 alphanumeric), 하이픈 사용 금지.

---

## Flyway 마이그레이션

### 파일 이름

`V{버전}__{설명}.sql` 형식을 따릅니다.

- `V001__init_users.sql`
- `V002__init_social_identities.sql`
- `V003__add_is_premium_to_users.sql`

**규칙:**

- 버전은 001 부터 시작, 3자리 패딩 (V001, V002, ..., V099, V100)
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

각 앱 schema 는 유저/인증 테이블(V001~V006)과 도메인 테이블(V007~)을 하나의 디렉토리에서 관리합니다. `core` schema 의 Flyway 디렉토리는 없습니다.

각 schema 는 별도 디렉토리를 가집니다. Flyway 는 각 디렉토리를 자기 schema 에 대해 독립적으로 관리합니다.

---

## Request / Response DTO 규칙

### Pair 강제 안 함

모든 엔드포인트에 `XxxRequest` / `XxxResponse` pair 를 반드시 만들 필요는 없습니다. 규칙:

- **Command (POST/PUT/PATCH/DELETE)** — `XxxRequest` DTO 가 자연스러운 경우에만. 반환은 `ApiResponse<해당 도메인 DTO>`.
- **Query (GET)** — body 없이 query parameter 나 `SearchRequest` 로 조건 전달. body 용 Request DTO 없음.
- **`XxxResponse`** 접미사 — 단일 도메인 DTO 로 표현 안 되는 복합 응답에만 사용 (`AuthResponse = UserSummary + AuthTokens`).

### 조회 요청 표준

목록 조회 API 는 `SearchRequest` 공통 DTO 를 사용합니다:

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

`conditions` 의 키 형식: `{fieldName}_{operator}`. 지원 연산자: `eq`(기본), `not`, `gte`, `lte`, `gt`, `lt`, `like`, `in`, `notIn`, `isNull`, `isNotNull`.

상세 규칙은 [ADR-010 (SearchCondition)](../philosophy/adr-010-search-condition.md) 참조.

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

**HTTP 메서드 의미 준수:**

- `GET` — 조회, 서버 상태 변경 없음 (idempotent)
- `POST` — 생성, 또는 "동사적 행위" (로그인, 탈퇴 등)
- `PUT` — 전체 교체 (idempotent)
- `PATCH` — 부분 수정
- `DELETE` — 삭제

**query parameter** 는 필터링, 페이지네이션, 정렬에 사용:

```
GET /api/apps/sumtally/expenses?page=0&size=20&sort=date,desc&categoryId=5
```

---

## 파일 네이밍

- Java 파일명은 클래스명과 일치 (Java 언어 요구사항)
- SQL 파일명은 Flyway 규칙 따름 (위 참조)
- YAML/Properties 설정 파일: `application-{profile}.yml`
- Shell 스크립트: `kebab-case.sh` (예: `new-app.sh`, `backup-to-nas.sh`)

---

## 요약

한 줄로 기억할 것:

> **"6개월 뒤의 나 자신이 이 이름만 보고 의도를 파악할 수 있는가?"**

이름을 짓기 전에 이 질문을 던지고, 답이 "아니오" 면 이름을 바꿉니다.
