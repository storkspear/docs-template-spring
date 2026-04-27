# ADR-012 · 앱별 독립 유저 모델 (통합 계정 폐기)

**Status**: Accepted. 2026-04-24 기준 현재 유효. `core.users` + `user_app_access` + `apps[]` claim 구조를 폐기하고, 각 앱이 자기 schema 에 독립 users 테이블을 가지는 모델로 전환 완료. `AppSlugVerificationFilter` 가 런타임 경계를 강제.

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~5분

## 결론부터

같은 사람이 두 앱을 써도 **계정은 완전히 별개**예요. `sumtally` 의 `users` 테이블과 `rny` 의 `users` 테이블은 같은 이메일을 가져도 서로 모르는 레코드입니다. JWT 는 `appSlug` 단일 claim 만 가지고, 다른 앱 엔드포인트를 치면 **필터 하나** 가 403 으로 차단해요. 초기에 생각했던 "통합 계정 + ThreadLocal 라우팅" 모델은 **전부** 폐기했습니다. 이유는 UX · 프라이버시 · 구현 복잡도 세 전선에서 동시에 지고 있었기 때문.

## 왜 이런 고민이 시작됐나?

초기 설계에서는 "유저는 한 명, 앱 접근 권한만 분기" 모델을 먼저 검토했어요. 이상적으로 들리는 그림:

```
core.users (공유 테이블)
  id=42, email=a@test.com

core.user_app_access
  user_id=42, app=sumtally, access=true
  user_id=42, app=rny,      access=true
```

"유저가 sumtally 에서 가입하면 자동으로 rny 도 쓸 수 있다" — **Marvel Cinematic Universe 같은 통합 경험** 을 꿈꿨죠.

그런데 이 구조로 실제 API 를 설계해보니 세 가지 문제가 동시에 떠올랐어요.

### 문제 1 — UX 가 어색함

"sumtally 에서 쓰던 계정으로 rny 에 로그인하시겠습니까?" — 유저 입장에서 **설명이 필요한 UX**. 유저는 각 앱을 독립 서비스로 인식하는데, 갑자기 "다른 앱의 계정이 있다" 고 알려지는 건 혼란. 설명이 필요한 UX 는 나쁜 UX.

### 문제 2 — GDPR / 프라이버시 복잡도

"sumtally 에서 탈퇴하면 rny 데이터는?" "두 앱 모두 삭제하려면?" "한 앱의 데이터만 삭제하려면 user_id 연결은 어떻게?" — **교차 앱 데이터 연결 추적** 이 법적 · 운영적 부담으로 떠올랐어요. [`제약 1`](./README.md#제약-1--운영-가능성이-최우선) (운영 부담 최소) 와 정면 충돌.

### 문제 3 — ThreadLocal 라우팅의 구현 지옥

통합 계정 모델이 성립하려면 "한 사용자의 한 요청이 **어느 앱 schema** 로 가야 하는지" 를 런타임에 결정해야 해요. 이걸 위해 초기 설계에서는:

- `AbstractRoutingDataSource` + `ThreadLocal<String> currentApp`
- JWT 에 `apps: ["sumtally", "rny"]` 배열 claim
- 요청마다 path/header 에서 appSlug 를 추출 → ThreadLocal 설정 → Repository 가 현재 DataSource 분기

그런데 Spring 에서 ThreadLocal 기반 테넌시는 **근본적으로 깨지기 쉬운** 구조예요:

- `@Async`, `CompletableFuture`, Virtual Thread 등 비동기 경계에서 ThreadLocal 이 유실됨
- Spring Security 필터 체인이 추가 스레드를 만들 때 컨텍스트 누락
- 테스트에서 ThreadLocal 정리를 누락하면 다음 테스트에 **오염**
- 모든 Repository 가 간접적으로 ThreadLocal 에 의존 — 단위 테스트 어려워짐

이 결정이 답할 물음은 이거예요.

> **"한 사람이 여러 앱을 쓴다" 는 이론적 가능성을 위해, 유저 모델을 통합할 가치가 있는가?**

## 고민했던 대안들

### Option 1 — 통합 계정 + ThreadLocal 라우팅 (기존 설계)

위에 설명한 구조. `core.users` + `user_app_access` + ThreadLocal DataSource.

- **장점**:
  - 유저 관점에서 "한 번 가입" 으로 여러 앱 접근 가능 (이론상)
  - 프로필 통합 (email, display_name 등을 한 곳에서 수정)
  - 크로스 앱 기능 구현 가능 (sumtally 의 지출이 rny 의 자산에 반영 등)
- **단점**:
  - UX 설명 필요 (앞서 설명)
  - GDPR 복잡도 (앞서 설명)
  - ThreadLocal 에 기반한 동적 DataSource 라우팅의 불안정성
  - [`ADR-005`](./adr-005-db-schema-isolation.md) 의 "schema = 앱" 모델과 충돌 — 유저 테이블만 core schema 로 빠져나가야 함 → 경계의 일관성 훼손
  - 5중 방어선 중 **방어선 2 (DataSource 분리)** 와 정합 안 됨 — 동적 라우팅이면 DataSource 는 하나여야 함
- **탈락 이유**: 세 전선 (UX · GDPR · 구현) 에서 동시 패배. "이론적 장점" 이 실제로 구현되면 전부 복잡도로 돌아옴.

### Option 2 — 앱별 독립 + 사후 연동 레이어 (linked_accounts)

앱 기본은 독립이고, 유저가 **명시적으로 연동** 하면 크로스 앱 레퍼런스 유지.

```
sumtally.users
  id=10, email=a@test.com, linked_account_id=xyz-uuid
rny.users
  id=42, email=a@test.com, linked_account_id=xyz-uuid

core.linked_accounts (별도 테이블, 명시적 매핑)
  linked_account_id=xyz-uuid, primary_email=a@test.com
```

- **장점**:
  - 앱 기본은 완전 독립 (Option 3 와 동일)
  - 미래 크로스 앱 기능이 필요해지면 연동 레이어만 추가
  - 유저가 명시적으로 동의한 연동만 존재 → GDPR 친화
- **단점**:
  - **현재 시점에서 쓸 데가 없음** — [`제약 3`](./README.md#제약-3--복권-사기-모델) 에서 앱들은 서로 독립이 기본. 연동이 가치가 있는 건 앱 2~3개가 같은 유저군을 공유하게 된 이후.
  - `linked_account_id` 컬럼을 미리 깔아두는 건 YAGNI
- **탈락 이유**: 지금 당장은 Option 3 과 동일한 동작. 추가 컬럼은 필요해진 시점에 추가해도 늦지 않음. [`제약 2`](./README.md#제약-2--시간이-가장-희소한-자원) (미래 복잡성 선제 도입 금지).

### Option 3 — 앱별 독립 유저 + 단일 appSlug claim ★ (채택)

각 앱이 자기 schema 에 독립 users 테이블. JWT 는 단일 appSlug claim. 필터가 JWT-path 일치를 강제.

- **장점**:
  - UX 가 직관적 — 각 앱은 독립 서비스
  - GDPR 이 단순 — 앱 탈퇴 = 그 앱 데이터만 삭제
  - ThreadLocal 불필요 — DataSource 는 앱 모듈이 **DI 로 정적 주입** 받음
  - [`ADR-005`](./adr-005-db-schema-isolation.md) 의 schema 경계와 **완전 정합** — users 도 도메인 테이블도 같은 schema
  - [`ADR-004`](./adr-004-gradle-archunit.md) 의 ArchUnit r2 (앱 간 의존 금지) 와도 정합
  - 5중 방어선이 모든 레이어에서 일관되게 작동
- **단점**:
  - 같은 사람이 두 앱을 쓰면 **가입을 두 번** 함 (각 앱에서 독립 가입)
  - 프로필 정보 (email, display_name) 공유 안 됨
- **채택 이유**:
  - 단점이 이론적이고, 실제 앱 공장 전략 ([`제약 3`](./README.md#제약-3--복권-사기-모델)) 에서 앱들이 서로 다른 카테고리라 같은 사람이 양쪽을 쓸 가능성 자체가 낮음
  - Option 2 의 확장 경로가 열려 있음 (미래 필요해지면 `linked_account_id` 컬럼 추가로 이행)
  - ThreadLocal 과 동적 라우팅의 **근본적 불안정성** 을 회피하는 것만으로도 압도적 가치

## 결정

### 구조 요약

| 항목 | 통합 계정 (폐기) | 앱별 독립 (채택) |
|---|---|---|
| Users 테이블 | `core.users` (공유) | `<slug>.users` (앱별) |
| 앱 접근 권한 | `core.user_app_access` | 없음 (해당 앱에 있으면 접근 권한 있음) |
| JWT claim | `apps: ["sumtally", "rny"]` 배열 | `appSlug: "sumtally"` 단일 문자열 |
| 엔드포인트 | `/api/core/auth/*` 전역 | `/api/apps/<slug>/auth/*` 앱별 |
| DataSource 라우팅 | ThreadLocal + AbstractRoutingDataSource | 앱 모듈이 자기 DataSource 정적 주입 |
| Auth 런타임 | `core-auth-impl/AuthController` 활성 | `apps/app-<slug>/<Slug>AuthController` 활성 |

### 구현 ① — users 테이블을 앱 schema 에 생성

`new-app.sh <slug>` 가 V001~V006 마이그레이션 템플릿을 해당 앱 schema 에 생성.

```
apps/app-<slug>/src/main/resources/db/migration/<slug>/
    V001__init_users.sql
    V002__init_social_identities.sql
    V003__init_refresh_tokens.sql
    V004__init_email_verification_tokens.sql
    V005__init_password_reset_tokens.sql
    V006__init_devices.sql
```

`core-user-impl` 의 `core/V001__init_users.sql` 은 여전히 존재하지만 이건 **템플릿 기준선** — 실제 런타임에서 유저 도메인을 처리하는 건 각 앱 모듈이에요.

### 구현 ② — JWT 의 appSlug claim (단일 문자열)

```java
// common-security/jwt/JwtService.java 발췌
public String issueAccessToken(Long userId, String appSlug, String email, String role) {
    return Jwts.builder()
        .subject(String.valueOf(userId))
        .claim("appSlug", appSlug)   // ← 단일 문자열
        .claim("email", email)
        .claim("role", role)
        .signWith(key)
        .compact();
}
```

과거의 `apps: [...]` 배열 claim 은 완전히 제거. `AuthenticatedUser` record 도 `appSlug: String` 단일 필드만 가집니다.

### 구현 ③ — `AppSlugVerificationFilter` 로 경계 강제

이 필터는 **[`ADR-005`](./adr-005-db-schema-isolation.md) 의 5중 방어선 외에 추가되는 "JWT 오남용 방지" 전용 방어선**입니다.

```java
// common-security/AppSlugVerificationFilter.java 발췌
@Override
protected void doFilterInternal(HttpServletRequest request, ...) {
    String pathSlug = AppSlugExtractor.extract(request.getRequestURI());
    if (pathSlug == null) { chain.doFilter(...); return; }  // /api/apps/ 외 경로는 skip

    AuthenticatedUser user = getAuthenticated();
    if (user == null) { chain.doFilter(...); return; }  // 미인증은 SecurityConfig 가 401

    if (!user.appSlug().equals(pathSlug)) {
        response.sendError(403,
            "app mismatch: JWT issued for '" + user.appSlug()
            + "' but accessing '" + pathSlug + "'");
        return;
    }
    chain.doFilter(...);
}
```

필터 체인 순서: `JwtAuthFilter → AppSlugMdcFilter → AppSlugVerificationFilter → (실제 Controller)`. 등록 위치는 `common-security/SecurityConfig.java` L67-69.

예: sumtally 에서 발급된 JWT 로 `/api/apps/rny/users/me` 를 호출 → `pathSlug = "rny"`, `user.appSlug() = "sumtally"` → 즉시 403.

### 구현 ④ — 앱별 `<Slug>AuthController` + core-auth-impl 은 dead code

핵심 설계 포인트: **`core-auth-impl/AuthController.java` 는 런타임에 등록되지 않습니다.**

```java
// core-auth-impl/controller/AuthController.java 파일 상단 주석
/*
 * 이 Controller 는 런타임에 등록되지 않습니다.
 * AuthAutoConfiguration 이 @Import 하지 않으며,
 * new-app.sh 가 각 앱 모듈에 <Slug>AuthController 를 복제 생성할 때의
 * 레퍼런스 소스로만 쓰입니다.
 */
```

`new-app.sh` 가 앱 생성 시 이 파일을 복사해 경로만 `@RequestMapping("/api/apps/<slug>/auth")` 로 바꿉니다. 즉 **template 상태 (앱 0개) 에서는 인증 엔드포인트가 노출되지 않음**.

이 설계의 이점:
- 각 앱 Controller 는 자기 앱의 `DataSource` + `AuthPort` 를 **DI 로 직접 주입** — ThreadLocal 불필요
- 한 앱의 인증 로직을 다른 앱과 독립적으로 수정 가능
- "core-auth-impl 에 뭘 고치면 모든 앱이 영향받나?" 라는 불안감 해소 — 런타임 bean 이 아니므로 영향 없음 (다음 `new-app.sh` 실행 시점에만 영향)

## 이 선택이 가져온 것

### 긍정적 결과

**ThreadLocal 복잡도 완전 제거** — 코드베이스 전체에 `ThreadLocal`, `AbstractRoutingDataSource`, `TenantContext` 흔적 **0개** (grep 확인 완료). 비동기 경계 (`@Async`, Virtual Thread) 에서 컨텍스트 유실 걱정 없음. 테스트에서 컨텍스트 오염 걱정 없음.

**유저 모델과 schema 경계의 완전 정합** — users 테이블도 schema 단위로 완전 격리. [`ADR-005`](./adr-005-db-schema-isolation.md) 5중 방어선이 예외 없이 작동. "유저 테이블만 다른 schema" 같은 특수 케이스 없음.

**GDPR 대응 단순** — "X 앱에서 저를 삭제해주세요" 요청 = `<slug>.users`, `<slug>.social_identities` 등에서 해당 이메일 삭제. 교차 앱 영향 0.

**AppSlugVerificationFilter 한 개로 강력한 경계** — JWT 토큰 오용 (한 앱의 토큰으로 다른 앱 엔드포인트 시도) 이 **런타임 레벨에서** 차단됨. 앱 A 개발자가 앱 B 의 API 를 우연히 호출해도 즉시 403 으로 실수 발견.

### 부정적 결과

**같은 사람이 두 앱을 쓰면 가입 두 번** — 같은 이메일로 sumtally 와 rny 에 각각 가입해야 함. 완화: 앱 공장 전략에서 앱들은 서로 다른 카테고리 (가계부 vs 운동 기록) 라 **같은 사람이 양쪽을 다 쓸 가능성 자체가 낮음**. [`제약 3`](./README.md#제약-3--복권-사기-모델) 에서 이 점을 이미 전제로 함.

**프로필 통합 기능 구현 불가** — "sumtally 와 rny 가 같은 프로필을 공유" 같은 기능은 지금 구조에서 안 됨. 완화: 미래 `linked_account_id` 컬럼 추가로 이행 가능 (Option 2 로 업그레이드 경로 열려있음). 지금 당장 쓸데가 없음.

**core-auth-impl 이 "dead code" 라는 비직관성** — 처음 코드베이스를 보는 사람이 `core/core-auth-impl/AuthController.java` 를 보고 "이게 런타임 엔드포인트" 라고 오해할 수 있음. 완화: 파일 상단에 "런타임 미등록" 주석 명시 + 본 ADR 에 근거 기록.

## 교훈

### Dead code 를 "활용" 할 때는 파일 자체에 경고를 박을 것

`core-auth-impl/AuthController.java` 는 "템플릿 소스 전용" 이라는 의도가 있지만, 이 사실은 **코드 자체로는 드러나지 않습니다**. 런타임에 `@RestController` + `@RequestMapping` 을 보면 등록된 것처럼 보이죠.

초기에 한 번 "왜 이 엔드포인트가 호출이 안 되지?" 로 시간을 날린 적이 있어요. 그 이후 다음 세 가지를 동시에 박음:

1. 파일 상단 주석 — "런타임 미등록, new-app.sh 레퍼런스 전용"
2. `AuthAutoConfiguration` 에서 `@Import` 하지 않음 — 기술적으로 bean 등록 차단
3. 본 ADR 에 근거 기록 — "왜 이런 구조인지" 의 메타 문서

**교훈**: 코드의 런타임 역할이 파일 외형과 다를 때, 그 차이를 **3중으로** 표시하지 않으면 반드시 누군가가 혼란을 겪는다. 주석만으론 부족.

### ThreadLocal 기반 멀티테넌시는 처음부터 피할 것

초기 1주일간 `AbstractRoutingDataSource` + ThreadLocal 조합으로 구현 시도했어요. 구현은 되는데 **테스트가 계속 새어나가는** 문제가 있었음. Spring Security 필터 체인 · `@Async` · 테스트 fixture 정리 등 각 경계마다 ThreadLocal 관리 코드가 필요했고, 한 군데만 빠뜨려도 통합 테스트에서 미스터리한 실패 발생.

그 시점에 "통합 계정 모델을 버리면 ThreadLocal 자체가 불필요해진다" 를 깨달은 게 Option 3 채택의 트리거였어요.

**교훈**: 아키텍처 대안 탐색에서 "이게 정말 필요한 복잡도인가?" 를 항상 재귀적으로 묻기. ThreadLocal 이 필요해진 **원인** 을 제거하면 ThreadLocal 자체가 불필요해진다.

### JWT claim 이름 변경은 DB 마이그레이션만큼 중요한 breaking change

초기엔 `apps: ["sumtally"]` 배열 claim 으로 설계했다가 `appSlug: "sumtally"` 단일로 변경. 이 과정에서:

- 이미 발급된 리프레시 토큰은 **호환 안 됨** → 전체 토큰 무효화 필요
- 클라이언트 (Flutter 앱) 의 JWT 파싱 로직 수정 필요
- 모든 테스트 fixture 에서 claim 이름 변경

DB 마이그레이션과 달리 JWT 스키마 변경은 **rollout 경로가 없어요** — 배포 시점 전후로 토큰 호환이 끊깁니다. 당시에는 운영 유저가 없어서 그냥 넘어갔지만, 유저가 있는 상태에선 매우 위험한 작업이 됐을 것.

**교훈**: JWT claim 설계는 초기에 확정해야 함. "나중에 이름 바꾸지 뭐" 는 프로덕션 직전 큰 비용으로 돌아옴. Breaking change 는 Deprecation 프로세스 ([`ADR-015`](./README.md#테마-5--운영--개발-방법론-작성-예정)) 경유가 기본이지만, JWT 는 Deprecation 으로도 감당 어려움.

## 관련 사례 (Prior Art)

- **[Spring Security Reference · Stateless Authentication](https://docs.spring.io/spring-security/reference/servlet/authentication/session-management.html)** — JWT 기반 stateless 인증 공식 가이드. 본 ADR 의 JWT 발급/검증 흐름이 이 레퍼런스 기반.
- **AWS Cognito · User Pools** — "유저 풀 per 앱" 모델. 본 ADR 의 `<slug>.users` 와 동일한 철학. Cognito 도 "하나의 Identity Pool + 여러 User Pool" 로 앱별 독립 유저를 권장.
- **Auth0 · Tenants and Applications** — Auth0 의 "Tenant per App" vs "One Tenant Many Apps" 선택. 본 ADR 은 전자 (Tenant per App) 에 해당.
- **Firebase Authentication — Multiple Projects Pattern** — Firebase 공식에서 "앱마다 별도 Project" 를 권장하는 근거와 동일한 논리.
- **OWASP · JWT Cheat Sheet** — [`aud` claim 검증의 중요성](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html). 본 ADR 의 `AppSlugVerificationFilter` 는 `aud` 검증의 도메인 특화 형태.
- **[AbstractRoutingDataSource Anti-pattern — Vlad Mihalcea](https://vladmihalcea.com/multitenancy-hibernate-multitenantconnectionprovider/)** — ThreadLocal 기반 멀티테넌시의 구현 함정. 본 ADR 이 이 경로를 회피한 이유의 출처.

## Code References

**JWT appSlug claim 발급 / 검증**:
- [`JwtService.java`](https://github.com/storkspear/template-spring/blob/main/common/common-security/src/main/java/com/factory/common/security/jwt/JwtService.java) — L42-56 (발급), L74-79 (검증)
- [`AuthenticatedUser.java`](https://github.com/storkspear/template-spring/blob/main/common/common-security/src/main/java/com/factory/common/security/AuthenticatedUser.java) — `appSlug: String` 단일 필드

**경계 강제 필터**:
- [`AppSlugVerificationFilter.java`](https://github.com/storkspear/template-spring/blob/main/common/common-security/src/main/java/com/factory/common/security/AppSlugVerificationFilter.java) — L39-70 (검증 로직)
- [`SecurityConfig.java`](https://github.com/storkspear/template-spring/blob/main/common/common-security/src/main/java/com/factory/common/security/SecurityConfig.java) — L67-69 (필터 체인 등록)
- [`AppSlugExtractor.java`](https://github.com/storkspear/template-spring/blob/main/common/common-security/src/main/java/com/factory/common/security/AppSlugExtractor.java) — URL path 에서 `<slug>` 추출

**앱별 Controller 자동 생성**:
- [`tools/new-app/new-app.sh`](https://github.com/storkspear/template-spring/blob/main/tools/new-app/new-app.sh) L296-430 — `<Slug>AuthController` 생성 로직
- [`core-auth-impl/controller/AuthController.java`](https://github.com/storkspear/template-spring/blob/main/core/core-auth-impl/src/main/java/com/factory/core/auth/impl/controller/AuthController.java) — 레퍼런스 소스 (런타임 미등록)
- [`AuthAutoConfiguration.java`](https://github.com/storkspear/template-spring/blob/main/core/core-auth-impl/src/main/java/com/factory/core/auth/impl/AuthAutoConfiguration.java) — AuthPort / service bean 은 등록, Controller 는 import 하지 않음 (L42-181)

**앱별 users 테이블 마이그레이션**:
- [`tools/new-app/new-app.sh`](https://github.com/storkspear/template-spring/blob/main/tools/new-app/new-app.sh) L438-530 — V001~V006 템플릿 생성

**부재 확인 (통합 계정 잔재 없음)**:
- `grep -r "AbstractRoutingDataSource"` — 0건
- `grep -r "ThreadLocal"` — 0건
- `grep -r "user_app_access"` — 0건
- `grep -r '"apps".*claim'` — 0건 (JWT 배열 claim 흔적 없음)

**관련 ADR**:
- [`ADR-005 · 단일 Postgres + 앱당 schema`](./adr-005-db-schema-isolation.md) — 이 ADR 의 5중 방어선이 유저 테이블에도 동일하게 적용됨
- [ADR-003 · `-api` / `-impl` 분리](./adr-003-api-impl-split.md) — `AuthPort` 인터페이스 구조의 근거
- [`ADR-004 · Gradle + ArchUnit`](./adr-004-gradle-archunit.md) — r2 (앱 간 의존 금지), r13 (Controller 위치 제약)
