# ADR-013 · 앱별 인증 엔드포인트 (core-auth 는 라이브러리 역할)

**Status**: Accepted. 2026-04-24 기준 모든 인증 엔드포인트가 `/api/apps/{appSlug}/auth/*` 형태로 통일. `core-auth-impl/AuthController.java` 는 레퍼런스 소스로만 존재하며 런타임 Bean 이 아님. `new-app.sh` 가 앱 스캐폴딩 시 앱별 Controller 를 자동 생성.

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~5분

## 결론부터

인증은 앱마다 **자기 Controller** 가 있어요. sumtally 는 `SumtallyAuthController` 가 `/api/apps/sumtally/auth/*` 를 처리하고, rny 는 `RnyAuthController` 가 `/api/apps/rny/auth/*` 를 처리합니다. 그런데 실제 **로직은 한 곳에 있어요** — `core-auth-impl` 의 `AuthServiceImpl` (`AuthPort` 구현) 이 11개 메서드로 인증 도메인 전체를 담당. 각 앱 Controller 는 **얇은 HTTP 어댑터** 로 `AuthPort` 를 주입받아 호출만 합니다. 즉 **core-auth-impl 은 "앱이 가져다 쓰는 라이브러리"** 역할이고, Controller 런타임 등록은 앱 모듈이 담당해요.

## 왜 이런 고민이 시작됐나?

[`ADR-012`](./adr-012-per-app-user-model.md) 에서 "통합 계정 → 앱별 독립 유저" 로 전환했습니다. 이제 인증 엔드포인트를 어떻게 설계할지 차례예요. 세 가지 설계 축이 서로 엮여요.

### 축 1 — URL 경로: 앱을 어디에 표현할 것인가?

- `/api/core/auth/email/signup` + body/header 에 appSlug — **앱이 URL 에서 안 보임**
- `/api/auth/{slug}/email/signup` — flat slug, `core/apps` 구분 없음
- `/api/apps/{slug}/auth/email/signup` — appSlug 가 **URL path 의 명시적 세그먼트**

### 축 2 — Controller 위치: bean 은 어디에?

- `core-auth-impl` 의 Controller 가 런타임 bean — "하나의 Controller 로 모든 앱 처리"
- 각 앱 모듈의 Controller 가 런타임 bean — "앱마다 자기 Controller"
- 둘 다? — bean 중복 등록 위험

### 축 3 — 로직 중복: 실제 인증 흐름을 어디에?

- 각 앱 Controller 에 인증 로직 복사 — N배 유지보수
- 한 서비스 bean 으로 집중 → Controller 는 delegate 만
- 중간 — 공통 서비스 + 앱별 오버라이드

이 세 축이 얽혀 있어서 한 축의 선택이 다른 축을 제약해요. 예: URL 경로에 `{slug}` 가 들어가면 Controller 가 앱별로 나뉘는 게 자연스럽고, 그렇게 되면 로직 중복을 피하기 위해 공통 서비스가 필요해짐.

이 결정이 답할 물음은 이거예요.

> **인증 엔드포인트 N 개를 운영하면서도, 인증 로직을 한 곳에서만 유지보수하는 구조는 어떤 모양인가?**

## 고민했던 대안들

### Option 1 — 통합 엔드포인트 + ThreadLocal 라우팅 (기존 설계 · 폐기)

`/api/core/auth/email/signup` 하나만 두고, 요청 시 body 또는 header 의 appSlug 로 DataSource 를 동적 라우팅.

- **장점**: URL 단순. Controller 가 한 개.
- **단점**:
  - [`ADR-012`](./adr-012-per-app-user-model.md) 에서 이미 폐기 — ThreadLocal + `AbstractRoutingDataSource` 의 불안정성
  - URL 에서 "어느 앱 요청인지" 가 **안 보임** → API 로그 · CloudFlare 분석 · Swagger 문서가 전부 모호
  - Spring Security 필터가 appSlug 를 알려면 body 를 미리 읽어야 함 (request body 는 보통 Filter 이후 읽힘)
- **탈락 이유**: [`ADR-012`](./adr-012-per-app-user-model.md) 의 전면 재설계 일부. 유저 모델과 엔드포인트 구조는 같은 결정의 양면.

### Option 2 — 경로에 `{slug}` + 통합 Controller (런타임 활성)

`/api/apps/{slug}/auth/email/signup` 경로로 가되, `core-auth-impl/AuthController` 하나가 모든 앱의 요청을 받음. `@PathVariable String slug` 로 앱 구분.

```java
@RestController
@RequestMapping("/api/apps/{slug}/auth")  // 한 Controller 가 모든 slug 처리
public class AuthController {
    @PostMapping("/email/signup")
    public AuthResponse signUp(@PathVariable String slug, @RequestBody SignUpRequest req) {
        return authPort.signUpWithEmail(slug, req);
    }
}
```

- **장점**:
  - URL 에 appSlug 노출됨 (Option 1 의 문제 해결)
  - Controller 코드 한 번만 작성
  - 앱 추가 시 Controller 신규 생성 불필요
- **단점**:
  - 앱 모듈이 자기 DataSource 를 **쓸 수 없음** — Controller 가 core-auth-impl 에 있으면 core schema DataSource 를 쓰게 됨
  - [`ADR-005`](./adr-005-db-schema-isolation.md) 의 "앱 모듈 = 자기 schema 독점" 원칙과 충돌 — 다시 ThreadLocal/라우팅이 필요해짐
  - `AuthPort.signUpWithEmail(slug, req)` 로 slug 를 계속 인자로 전달해야 하는 보일러플레이트
- **탈락 이유**: URL 은 고쳤지만 "라우팅은 어디서?" 문제가 제자리. 결국 ThreadLocal 부활.

### Option 3 — 앱별 Controller 런타임 등록 + 공통 AuthPort 위임 ★ (채택)

각 앱 모듈에 `<Slug>AuthController` 가 런타임 bean. core-auth-impl 에는 **레퍼런스 소스** 로만 AuthController 가 있고 런타임 미등록. 실제 인증 로직은 `AuthPort` (구현: `AuthServiceImpl`) 가 도맡음.

```java
// apps/app-sumtally/auth/SumtallyAuthController.java (런타임 bean)
@RestController
@RequestMapping("/api/apps/sumtally/auth")
public class SumtallyAuthController {
    private final AuthPort authPort;

    @PostMapping("/email/signup")
    public AuthResponse signUp(@RequestBody SignUpRequest req) {
        return authPort.signUpWithEmail(req);  // slug 인자 필요 없음 — DataSource 가 이미 sumtally schema
    }
}
```

- **장점**:
  - **URL 에 appSlug 명시**
  - **앱 모듈이 자기 DataSource 주입** — [`ADR-005`](./adr-005-db-schema-isolation.md) 의 방어선 2 와 정합
  - **ThreadLocal 불필요** — 라우팅 경계 = URL path 의 `{slug}`, 실제 DataSource 결정 = Spring DI
  - **로직 중복 없음** — 모든 앱이 같은 `AuthPort` bean 을 주입. 실제 로직은 `AuthServiceImpl` 한 곳.
  - **`AppSlugVerificationFilter` 와 정합** — URL slug vs JWT appSlug 검증 ([`ADR-012`](./adr-012-per-app-user-model.md))
- **단점**:
  - 앱 모듈마다 Controller 파일 존재 — 중복처럼 보임 (실제로는 `AuthPort` 에 얇은 위임만)
  - `core-auth-impl/AuthController.java` 가 "런타임 미등록" 이라는 비직관적 상태
- **채택 이유**:
  - ADR-005 + ADR-012 와 **완전 정합**
  - Controller 의 중복은 `new-app.sh` 가 자동 생성하므로 유지보수 부담 0
  - 로직 중앙화 (`AuthServiceImpl`) + URL 분산 (앱별 path) 의 장점 동시 확보

## 결정

### 구조 요약

```
HTTP 요청
  ▼
/api/apps/{slug}/auth/* ─────────────┐
                                     │
                                     ▼
            앱 모듈의 <Slug>AuthController (런타임 bean)
                 │ DI 주입
                 ▼
            AuthPort (core-auth-api 인터페이스)
                 │ 구현체
                 ▼
            AuthServiceImpl (core-auth-impl, 11 메서드)
                 │ 위임
                 ▼
            EmailAuthService / SocialAuthService / TokenService ... (9개 서비스)
```

### 엔드포인트 경로 상수화 — `ApiEndpoints`

```java
// common-web/ApiEndpoints.java 발췌
public static final String APP_BASE = "/api/apps/{appSlug}";

public static final class Auth {
    public static final String BASE = APP_BASE + "/auth";
    public static final String EMAIL_SIGNUP = "/email/signup";
    public static final String EMAIL_SIGNIN = "/email/signin";
    // ... 11개 엔드포인트 경로 상수

    public static final String[] PUBLIC_PATTERNS = {
        "/api/apps/*/auth/email/signup",
        "/api/apps/*/auth/email/signin",
        // SecurityConfig 가 이걸로 permitAll() 구성
    };
}
```

- URL 패턴을 **상수** 로 관리 — 오타 방지 + IDE "Find Usages" 추적 가능
- `PUBLIC_PATTERNS` 는 `SecurityConfig` 가 permitAll 화이트리스트로 사용

### `AuthPort` — 11개 메서드 (core-auth-api)

```java
// core-auth-api/AuthPort.java
public interface AuthPort {
    AuthResponse signUpWithEmail(SignUpRequest request);
    AuthResponse signInWithEmail(SignInRequest request);
    AuthResponse signInWithApple(AppleSignInRequest request);
    AuthResponse signInWithGoogle(GoogleSignInRequest request);
    AuthTokens refresh(RefreshRequest request);
    void withdraw(long userId, WithdrawRequest request);
    void requestPasswordReset(PasswordResetRequest request);
    void confirmPasswordReset(PasswordResetConfirmRequest request);
    void changePassword(long userId, ChangePasswordRequest request);
    void verifyEmail(VerifyEmailRequest request);
    void resendVerificationEmail(long userId);
}
```

- **모든 파라미터/반환이 DTO** — [`ADR-011 (레이어드 포트)`](./adr-011-layered-port-adapter.md) · [`ADR-016 (Mapper 금지)`](./adr-016-dto-mapper-forbidden.md) 의 규칙에 따름
- **메서드 수 = 인증 도메인 전체** — 이메일/소셜 가입·로그인, 토큰 갱신, 탈퇴, 비밀번호 리셋/변경, 이메일 인증
- ArchUnit r11 (Port 가 Entity 노출 금지) 으로 기계 강제

### `AuthServiceImpl` — 위임 조합 (core-auth-impl)

```java
// core-auth-impl/AuthServiceImpl.java 발췌
@Transactional
public class AuthServiceImpl implements AuthPort {
    private final EmailAuthService emailAuthService;
    private final AppleSignInService appleSignInService;
    private final GoogleSignInService googleSignInService;
    private final RefreshTokenService refreshTokenService;
    private final EmailVerificationService emailVerificationService;
    private final PasswordResetService passwordResetService;
    private final WithdrawService withdrawService;
    private final UserPort userPort;
    private final PasswordHasher passwordHasher;

    @Override
    public AuthResponse signUpWithEmail(SignUpRequest request) {
        return emailAuthService.signUp(request);
    }
    // ... 각 Port 메서드 = 해당 서비스 위임
}
```

- **한 클래스에 인증 로직 전체** — 11개 메서드가 9개 서비스에 분기
- `@Transactional` — 인증 흐름 (가입, 로그인, 비밀번호 변경 등) 의 일관성 보장
- **bean 자체는 `AuthAutoConfiguration` 이 등록** — `@ConditionalOnMissingBean` 으로 커스터마이즈 가능

### `core-auth-impl/AuthController.java` — 레퍼런스 소스, 런타임 미등록

```java
/**
 * 앱 모듈용 인증 컨트롤러 레퍼런스 소스 — 런타임에 등록되지 않습니다.
 *
 * AuthAutoConfiguration 은 이 클래스를 @Import 로 등록하지 않기 때문에
 * 런타임 Bean 이 되지 않습니다.
 *
 * 앱 모듈별 복제본의 path 는 /api/apps/<slug>/auth...
 */
@RestController  // 어노테이션은 있지만...
@RequestMapping(ApiEndpoints.Auth.BASE)
public class AuthController { ... }
```

이 파일의 역할:

- `new-app.sh` 가 앱 스캐폴딩 시 **참조할 소스** — "이 패턴을 따라서 만들어라" 의 정답지
- 실제 런타임 bean 이 되지 않음 — `AuthAutoConfiguration` 이 `@Import(AuthController.class)` 를 **하지 않음**
- 즉 **템플릿 레포 상태 (앱 0개) 에서는 인증 엔드포인트가 노출되지 않음** — 최소 공격 표면

### `new-app.sh` 의 Controller 자동 생성

```bash
# tools/new-app/new-app.sh L296-430 발췌
cat > "${JAVA_DIR}/auth/${SLUG_PASCAL}AuthController.java" << EOF
package com.factory.apps.${SLUG_PACKAGE}.auth;

import com.factory.core.auth.api.AuthPort;
...
@RestController
@RequestMapping("/api/apps/${SLUG}/auth")
@Tag(name = "${SLUG}-auth", description = "${SLUG_PASCAL} 인증")
public class ${SLUG_PASCAL}AuthController {
    private final AuthPort authPort;

    public ${SLUG_PASCAL}AuthController(AuthPort authPort) {
        this.authPort = authPort;
    }
    // 11개 엔드포인트 메서드 템플릿...
}
EOF
```

생성 결과: `apps/app-<slug>/src/main/java/com/factory/apps/<slug>/auth/<Slug>AuthController.java`. 런타임 bean 으로 자동 등록.

### ArchUnit r13 — Controller 위치 강제

```java
// common-testing/architecture/ArchitectureRules.java
public static final ArchRule SPRING_BEANS_MUST_RESIDE_IN_IMPL_OR_APPS =
    classes()
        .that().areAnnotatedWith(RestController.class)
        .or().areAnnotatedWith(Controller.class)
        // ...
        .should().resideInAnyPackage(
            "com.factory.core.(*).impl..",
            "com.factory.apps..",
            "com.factory.bootstrap.."
        )
        .as("r13: Spring stereotype annotations must reside in core-*-impl, apps/*, or bootstrap");
```

앱 Controller 가 `com.factory.core.auth.api` 같은 곳에 잘못 들어가면 빌드 실패. 기계적 경계.

## 이 선택이 가져온 것

### 긍정적 결과

**앱 추가 시 인증 코드 0줄** — `./tools/new-app/new-app.sh sumtally` 한 줄이면 `SumtallyAuthController` 11개 엔드포인트 메서드가 자동 생성. 인증 로직은 건드릴 필요 없음. **솔로 운영자의 앱 시작 시간 = 인증 플로우 기준 1분 이내**.

**URL 이 설명적** — 로그/분석/디버깅에서 `/api/apps/rny/auth/email/signin` 를 보면 "rny 앱의 이메일 로그인" 이 즉시 보임. Swagger UI 도 앱별로 그룹핑 (`@Tag(name = "rny-auth")`).

**core-auth-impl 변경 영향 분석 가능** — 인증 로직 수정 = `AuthServiceImpl` 또는 하위 서비스 수정. 모든 앱이 동일 `AuthPort` bean 을 주입받으므로 수정 즉시 전파. 그러나 Controller 는 앱별로 있어서 **런타임 추가 등록 없이** 이행 완료.

**Controller 레벨 앱별 커스터마이징 가능** — 특정 앱에서 "회원가입 전 이메일 도메인 제한" 같은 정책이 필요하면, 그 앱의 Controller 에서 바로 validation 추가. 다른 앱 영향 없음.

**템플릿 상태의 최소 공격 표면** — 앱 0개인 template 레포를 그대로 배포해도 인증 엔드포인트가 노출되지 않음. `core-auth-impl` 의 AuthController 는 런타임 미등록.

### 부정적 결과

**Controller 파일 N 개** — 앱이 10개면 Controller 파일 10개. 코드 중복처럼 보임. 완화: `new-app.sh` 가 생성하므로 손으로 쓸 일 없음. 인증 스펙 변경은 `AuthPort` + `AuthServiceImpl` 수정이면 끝.

**"런타임 미등록 Controller" 의 혼란성** — 처음 레포를 보는 사람이 `core-auth-impl/AuthController.java` 의 `@RestController` + `@RequestMapping` 을 보고 "이게 실제 엔드포인트" 라고 오해. 완화: 파일 상단 JavaDoc 에 명시 ("런타임에 등록되지 않습니다") + 본 ADR 에 근거 기록 + [`ADR-012 의 교훈`](./adr-012-per-app-user-model.md#교훈) 에서도 동일 이슈 언급.

**`AuthPort` 변경의 파급** — Port 메서드 시그니처 변경 시 모든 앱 Controller 가 영향. 완화: `AuthPort` 는 **인증 도메인 인터페이스** 라 변경 빈도 낮음. 추가 메서드는 가능 (기존 Controller 에 영향 없음), 기존 메서드 변경은 [`ADR-015 의 Deprecation 프로세스`](./README.md#테마-5--운영--개발-방법론-작성-예정) 로 관리.

### core-auth-impl 의 이중 역할 — "라이브러리" 로 이해하기

핵심 구도:

| 구성요소 | 런타임 등록? | 역할 |
|---|---|---|
| `core-auth-impl/AuthServiceImpl` (AuthPort 구현) | ✅ 등록 (bean) | 실제 인증 로직 전체 담당 |
| `core-auth-impl/EmailAuthService`, `AppleSignInService` 등 9개 서비스 | ✅ 등록 | 도메인 분할 책임 |
| `core-auth-impl/AuthController` | ❌ **미등록** | 앱 Controller 의 **템플릿 소스** |

즉 core-auth-impl 은 **"앱이 가져다 쓰는 라이브러리"** 로 작동:

- 앱이 의존 (`implementation project(':core:core-auth-api')`) → `AuthPort` 인터페이스 획득
- `AuthAutoConfiguration` 이 `AuthServiceImpl` + 하위 서비스 bean 등록 → 앱이 자동으로 `AuthPort` 주입 가능
- Controller 는 앱이 직접 만듦 (new-app.sh 가 도움)

## 교훈

### "런타임 미등록 Controller" 는 3중 방어로 표시하기

처음에는 주석 한 줄 ("이 Controller 는 런타임에 등록되지 않습니다") 만 달았어요. 그런데 팀 외부 리뷰어가 `@RestController` 만 보고 "엔드포인트 경로가 이상한데요" 로 피드백을 남김. 주석이 보이는 전제는 **그 파일을 열어봤을 때** 인데, IDE 탐색이나 Swagger 만 보는 관점에선 주석이 안 읽힘.

이후 3중 표시:

1. **파일 상단 JavaDoc** — 오픈 시점에 즉시 보임
2. **Bean 등록 차단** — `AuthAutoConfiguration` 이 `@Import(AuthController.class)` 를 **하지 않음** (기술적 실상)
3. **본 ADR + [`ADR-012`](./adr-012-per-app-user-model.md#교훈) 에 기록** — 구조적 맥락 설명

**교훈**: 파일 외형과 런타임 역할이 다른 코드는 반드시 3중 이상의 레이어에서 명시해야 함. 한 군데만 표시하면 반드시 누군가는 놓친다.

### AuthPort 메서드 수를 "늘어도 괜찮은" 모양으로 설계하기

초기에는 `AuthPort` 에 메서드 5개 정도로 시작했다가 (signup / signin / refresh / withdraw / verifyEmail) 시간이 지나면서 11개로 늘어남 — 비밀번호 리셋 2개, 재전송 1개, 비밀번호 변경 1개, 소셜 2개 추가.

이 과정에서 "Port 를 쪼갤까?" 고민했어요 — `EmailAuthPort`, `SocialAuthPort`, `PasswordPort`, `EmailVerificationPort` 등으로.

결국 **쪼개지 않기로** 결정:

- 쪼개면 Controller 가 4개의 Port 를 주입 — DI 복잡도 증가
- **"앱이 필요로 하는 인증 기능 전체"** 가 하나의 단위 — 쪼개는 기준이 인위적
- 메서드 11개는 관리 가능한 크기. 30개가 되면 그때 쪼개면 됨 ([`YAGNI`](./README.md))

**교훈**: Port 의 메서드 수를 미리 걱정해서 쪼개지 말 것. "하나의 소비자 관점에서 일관된 단위" 를 유지하는 게 우선. 쪼개는 건 **관리 한계에 이르렀을 때** 해도 늦지 않음.

### `AppSlugVerificationFilter` 가 없으면 경로 분리 의미 없음

"앱별 Controller + URL 에 slug" 만으로는 **실제 경계가 강제되지 않아요**. 예: sumtally 에서 발급된 JWT 를 가지고 `/api/apps/rny/users/me` 를 치면, rny Controller 가 받긴 받습니다. 만약 인증된 사용자 정보를 JWT 에서만 가져오면 rny 앱에 sumtally 유저가 접근하는 사고 발생.

그래서 [`ADR-012`](./adr-012-per-app-user-model.md#구현--appslugverificationfilter-로-경계-강제) 의 `AppSlugVerificationFilter` 가 필수:

- URL path 의 `{slug}` 와 JWT 의 `appSlug` claim 이 **다르면 403**
- 필터 체인: `JwtAuthFilter → AppSlugMdcFilter → AppSlugVerificationFilter → Controller`

**교훈**: "경로 분리" 와 "인증 경계 강제" 는 **독립된 두 문제**. 경로만 분리하고 필터를 빠뜨리면 설계 의도가 무너짐. 본 ADR 과 ADR-012 는 한 쌍으로 동작하는 결정.

## 관련 사례 (Prior Art)

- **[Hexagonal Architecture (Ports and Adapters) — Alistair Cockburn](https://alistair.cockburn.us/hexagonal-architecture/)** — `AuthPort` (port) + `AuthServiceImpl` (primary adapter 아닌 application service) + Controller (primary adapter) 구조의 이론적 기반.
- **[Spring Boot Auto-Configuration Reference](https://docs.spring.io/spring-boot/reference/features/developing-auto-configuration.html)** — `AuthAutoConfiguration` + `@AutoConfiguration.imports` 패턴. 앱 모듈이 core 의 기능을 자동으로 얻는 메커니즘.
- **Django REST Framework — ViewSet per App** — 같은 철학 (앱마다 view + 공통 serializer) 의 다른 생태계.
- **NestJS — Feature Modules** — 각 feature module 이 자기 Controller + common service. 본 ADR 과 구조적으로 유사.
- **OpenAPI 3.0 — Tag Grouping** — `@Tag(name = "<slug>-auth")` 로 Swagger UI 에서 앱별 그룹핑. 엔드포인트 수가 늘어도 탐색 가능.
- **Netflix Eureka — Service Discovery per Instance** — 마이크로서비스 세계의 경로 분리. 우리 구조는 "단일 JVM 안에서 비슷한 명확성" 을 확보.

## Code References

**엔드포인트 경로 정의**:
- [`common/common-web/ApiEndpoints.java`](https://github.com/storkspear/spring-backend-template/blob/main/common/common-web/src/main/java/com/factory/common/web/ApiEndpoints.java) — `APP_BASE`, `Auth.BASE`, 11개 경로 상수 + `PUBLIC_PATTERNS`

**Port + Service**:
- [`core-auth-api/AuthPort.java`](https://github.com/storkspear/spring-backend-template/blob/main/core/core-auth-api/src/main/java/com/factory/core/auth/api/AuthPort.java) — 11개 메서드 인터페이스
- [`core-auth-impl/AuthServiceImpl.java`](https://github.com/storkspear/spring-backend-template/blob/main/core/core-auth-impl/src/main/java/com/factory/core/auth/impl/AuthServiceImpl.java) — 9개 서비스 위임, `@Transactional`
- [`core-auth-impl/AuthAutoConfiguration.java`](https://github.com/storkspear/spring-backend-template/blob/main/core/core-auth-impl/src/main/java/com/factory/core/auth/impl/AuthAutoConfiguration.java) — bean 등록 (Controller 는 import **안 함**)

**Controller (레퍼런스 + 앱별)**:
- [`core-auth-impl/controller/AuthController.java`](https://github.com/storkspear/spring-backend-template/blob/main/core/core-auth-impl/src/main/java/com/factory/core/auth/impl/controller/AuthController.java) — 레퍼런스 소스, 런타임 미등록
- [`tools/new-app/new-app.sh` L296-430](https://github.com/storkspear/spring-backend-template/blob/main/tools/new-app/new-app.sh#L296-L430) — `<Slug>AuthController` 자동 생성

**경계 강제**:
- [`common-security/AppSlugVerificationFilter.java`](https://github.com/storkspear/spring-backend-template/blob/main/common/common-security/src/main/java/com/factory/common/security/AppSlugVerificationFilter.java) — URL slug vs JWT appSlug 일치 검증 (403)
- [`common-testing/architecture/ArchitectureRules.java`](https://github.com/storkspear/spring-backend-template/blob/main/common/common-testing/src/main/java/com/factory/common/testing/architecture/ArchitectureRules.java) — r13 (Controller 위치 규칙)

**관련 ADR**:
- [ADR-003 · `-api` / `-impl` 분리](./adr-003-api-impl-split.md) — `AuthPort` 가 `core-auth-api` 에 위치하는 근거
- [`ADR-005 · 단일 Postgres + 앱당 schema`](./adr-005-db-schema-isolation.md) — 앱 모듈이 자기 DataSource 를 주입받는 구조
- [`ADR-006 · HS256 JWT`](./adr-006-hs256-jwt.md) — 엔드포인트가 발급/검증하는 JWT
- [`ADR-012 · 앱별 독립 유저 모델`](./adr-012-per-app-user-model.md) — 엔드포인트 구조의 쌍둥이 결정
- [`ADR-016 · DTO Mapper 금지`](./adr-016-dto-mapper-forbidden.md) — `AuthPort` 가 DTO 만 다루는 근거
