# ADR-027 — Admin role 권한 시스템 (@AdminOnly)

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~6분

**Status**: Accepted. `@AdminOnly` meta annotation 이 `@PreAuthorize("hasRole('ADMIN')")` 을 래핑. JWT `role` claim 으로 GrantedAuthority 매핑 + Spring Security 가 권한 검증.

---

## 결론부터

서비스가 자라면 *일반 사용자가 접근하면 안 되는 운영자 전용 endpoint* 가 늘어나요. 결제 강제 환불, 구독 강제 취소, 사용자 role 변경, plan 정의 수정 같은 *시스템 상태를 직접 조작* 하는 기능들이에요. 이런 endpoint 가 일반 사용자 토큰으로 접근 가능하면 *권한 escalation* 이 곧바로 일어나므로, *권한 검증을 컨벤션 수준에서 명시적으로 강제* 하는 메커니즘이 필요합니다.

본 ADR 은 운영자 전용 endpoint 를 표시하는 `@AdminOnly` meta annotation 을 도입합니다. 이 어노테이션은 Spring Security 의 `@PreAuthorize("hasRole('ADMIN')")` 을 한 번 감싼 *도메인 의도가 명시적인* 표기예요. 컨트롤러 메서드나 클래스에 `@AdminOnly` 한 줄을 붙이면 *그 endpoint 가 운영자 전용임* 이 코드만 봐도 명확해지고, 일반 사용자 JWT 가 들어오면 Spring Security 가 *403 Forbidden* 으로 자동 차단합니다.

권한 검증 자체는 JWT 의 `role` claim 위에서 작동해요. 사용자가 로그인하면 발급되는 JWT 의 payload 에 `role` 필드가 포함되고 (`"user"` 또는 `"admin"`), `JwtAuthFilter` 가 이 값을 *Spring Security 의 GrantedAuthority* (`ROLE_USER` / `ROLE_ADMIN`) 로 매핑합니다. `@PreAuthorize` 가 그 GrantedAuthority 를 검증하는 흐름이라 [`ADR-006`](./adr-006-hs256-jwt.md) 의 JWT 인프라와 자연스럽게 연결돼요. `AppSlugVerificationFilter` ([`ADR-013`](./adr-013-per-app-auth-endpoints.md)) 와 같은 chain 에서 검증되어 *앱 단위 격리 + role 단위 권한* 의 이중 방어선이 작동합니다.

이 ADR 의 범위는 `@AdminOnly` 어노테이션 정의, JWT role claim 의 발급/검증 흐름, Spring Security 의 `@EnableMethodSecurity` 활성화, 권한 부족 시의 응답 처리 (401 vs 403), 그리고 향후 *moderator / billing_ops* 같은 추가 role 도입을 위한 확장 경로까지입니다.

---

## 왜 이런 결정이 필요했나?

권한 검증 패턴이 *명시적 컨벤션* 으로 잡혀 있지 않으면 *각 컨트롤러가 자기 방식으로 권한을 체크* 하게 되어 일관성이 깨져요. 어떤 컨트롤러는 `currentUser.isAdmin()` 헬퍼를 직접 호출하고, 어떤 컨트롤러는 `@PreAuthorize` 를 쓰고, 어떤 컨트롤러는 *권한 체크 자체를 잊어버리는* 형태로 흩어집니다. 흩어진 패턴은 *어느 endpoint 가 정말 운영자 전용인지* 코드만 봐서는 알 수 없게 만들고, *권한 체크 누락* 이라는 보안 사고의 빈 자리가 생기기 쉬워요.

기존 시스템은 JWT 의 `role` claim 발급과 `JwtAuthFilter` 의 GrantedAuthority 매핑까지는 갖춰져 있어요. `User` 엔티티의 `role` 필드 (`"user"` / `"admin"`) 가 로그인 시점에 JWT payload 에 복사되고, `JwtAuthFilter` 가 이 값을 `ROLE_USER` / `ROLE_ADMIN` 같은 Spring Security 표준 형식으로 SecurityContext 에 박습니다. *권한 정보의 흐름* 자체는 정합한데, *그 정보를 endpoint 단에서 활용하는 컨벤션* 이 빠져 있는 상태예요.

이 비대칭을 메우는 길에는 두 갈래가 있어요. 하나는 *컨트롤러가 직접 `currentUser.isAdmin()` 을 호출* 해서 분기하는 형태이고, 다른 하나는 *Spring Security 의 method security* 를 활용해 *어노테이션 한 줄로* 처리하는 형태입니다.

직접 호출 방식은 *boilerplate 가 누적* 돼요. 모든 admin endpoint 의 첫 줄에 `if (!currentUser.isAdmin()) throw new ForbiddenException();` 같은 코드가 반복되고, 이 코드를 *한 곳에서 깜빡한* 컨트롤러가 *권한 검증 누락* 의 보안 사고를 만듭니다. *어느 컨트롤러가 admin 인지* 도 코드 안의 분기 로직을 일일이 봐야 알 수 있어 *외부에서 한눈에 파악할 수단* 이 없어요.

Spring Security 의 method security 방식은 *선언적* 이에요. `@PreAuthorize("hasRole('ADMIN')")` 한 줄을 메서드에 붙이면 *AOP 가 자동으로 권한 검증* 을 실행하고, 권한 부족 시 *AccessDeniedException* 을 던져 표준 403 응답으로 처리됩니다. 컨트롤러 코드 안의 권한 분기 로직이 사라지고, *어느 endpoint 가 admin 전용인지* 가 어노테이션으로 명확히 드러나요.

다만 `@PreAuthorize("hasRole('ADMIN')")` 자체는 *문자열 SPEL* 형태라 *오타 가능성* 과 *도메인 의미가 약한* 부분이 있어요. *@AdminOnly* 라는 의도가 명확한 meta annotation 으로 한 번 감싸면 *오타 차단 + 도메인 의도 표현* 이 동시에 가능합니다. 다른 도메인이 *moderator 전용* 이나 *billing_ops 전용* 같은 추가 role 을 도입할 때도 같은 패턴 (`@ModeratorOnly`, `@BillingOpsOnly`) 으로 자연스럽게 확장돼요.

이 결정이 답해야 할 물음은 이거예요.

> **운영자 전용 endpoint 가 늘어나는 환경에서, 권한 검증을 어노테이션 한 줄로 명시적으로 표현하면서 일관성과 도메인 의도를 동시에 갖추는 컨벤션은 무엇인가?**

---

## 결정

| 항목 | 값 |
|---|---|
| **활성화** | `SecurityConfig` 에 `@EnableMethodSecurity` 추가 |
| **컨벤션** | `@AdminOnly` meta annotation = `@PreAuthorize("hasRole('ADMIN')")` wrapping |
| **JWT role claim** | 기존 그대로 — `role` claim (소문자 "admin") |
| **GrantedAuthority** | 기존 — `ROLE_` prefix + uppercase ("ROLE_ADMIN") |
| **응답 코드** | 미인증 401 (`JsonAuthenticationEntryPoint`) / 권한 부족 403 (Spring Security default) |
| **사용 위치** | controller method 또는 type level. type level = 모든 메소드 admin |

---

## @AdminOnly 사용 패턴

### Method level

```java
@PostMapping("/refund")
@AdminOnly
public ApiResponse<RefundResult> refund(@RequestBody RefundRequest request) {
    return ApiResponse.ok(paymentPort.refund(request));
}
```

### Type level (모든 메소드 admin)

```java
@RestController
@RequestMapping("/api/admin/...")
@AdminOnly
public class AdminPanelController {
    // 모든 메소드 admin only
}
```

---

## JWT role claim 발급 흐름

```
1. EmailAuthService.signIn 또는 OAuth signIn
   → User.role = "admin" 인 사용자 인증
2. JwtService.issueAccessToken(userId, email, appSlug, "admin")
   → claims: { sub: userId, role: "admin", appSlug: ..., ... }
3. JWT 발급 → 클라이언트 저장
4. Bearer 헤더로 요청 → JwtAuthFilter 검증
   → AuthenticatedUser(userId, email, appSlug, "admin")
   → SimpleGrantedAuthority("ROLE_ADMIN")
5. @AdminOnly 체크 → hasRole("ADMIN") = true → 통과
6. controller 실행
```

User.role 이 "user" 인 경우:
- `SimpleGrantedAuthority("ROLE_USER")` 발급
- `@AdminOnly` 체크 시 hasRole("ADMIN") = false → **403 Forbidden**

---

## Admin user 셋업

`new-app.sh` 의 `V007__seed_admin_user.sql` 가 자동 admin user 생성:

```sql
INSERT INTO users (email, password_hash, ..., role, ...)
VALUES ('admin@<slug>.local', '<bcrypt>', ..., 'admin', ...);
```

**임시 비밀번호 `admin1234`**. 운영에서 첫 로그인 즉시 변경 필수.

운영자가 추가 admin 만들고 싶으면:
- 직접 DB UPDATE: `UPDATE <slug>.users SET role = 'admin' WHERE email = '...';`
- 또는 향후 admin endpoint 신규: `PATCH /api/admin/users/{id}/role`

---

## 다른 role 추가 시 확장

`@AdminOnly` 외 다른 role 필요 시 (예: `MODERATOR`, `BILLING_OPS`):

```java
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
@PreAuthorize("hasRole('MODERATOR')")
public @interface ModeratorOnly {}
```

JWT 발급 시 role claim 에 해당 값 (소문자) 을 셋팅해요. JwtAuthFilter 가 자동으로 `ROLE_MODERATOR` 로 매핑합니다.

다중 role 검사도 가능:
```java
@PreAuthorize("hasAnyRole('ADMIN', 'MODERATOR')")
public @interface AdminOrModerator {}
```

---

## 검증 (3건)

`AdminOnlyTest`:
1. `adminOnly_isAnnotatedWithPreAuthorizeHasRoleAdmin` — `@PreAuthorize("hasRole('ADMIN')")` wrapping 검증
2. `adminOnly_hasRuntimeRetention` — runtime retention (Spring 이 reflection 으로 읽음)
3. `adminOnly_appliesToMethodAndType` — METHOD + TYPE 둘 다 적용

실 endpoint 통합 테스트는 bootstrap (또는 derived app 모듈) 에서:
```java
@WithMockUser(roles = "ADMIN") void refund_asAdmin_returns200() {...}
@WithMockUser(roles = "USER")  void refund_asUser_returns403() {...}
@Test                            void refund_unauthenticated_returns401() {...}
```

---

## 적용 (이번 사이클)

- `SecurityConfig` — `@EnableMethodSecurity` 추가
- `common-security/AdminOnly.java` — meta annotation 신규
- `tools/new-app/new-app.sh` — PaymentController.refund 에 `@AdminOnly` 추가 + import
- 테스트 3건 PASS

---

## 안 다루는 범위 (다음 사이클 후보)

- **Admin endpoint 신규** — 사용자 role 변경 / plan 등록 / subscription 강제 cancel / 운영 통계 조회 같은 추가 기능이에요. 비즈니스별로 다르므로 derived 앱에서 추가하는 걸 권장해요.
- **Admin 전용 controller convention** — 모든 admin 메소드를 `<Slug>AdminController` 로 분리해요. type level `@AdminOnly` 를 적용하고 ArchUnit 으로 강제할 수 있어요.
- **2FA / 추가 인증** — admin 액션 시 한 번 더 비밀번호 입력 (sudo 모드)
- **Audit 로그** — 누가 언제 무엇을 admin 액션 했는지 (별도 table)
- **role 다중화** — 현재는 user/admin 단일이에요. moderator/billing_ops 등 추가는 비즈니스 결정에 맡겨요.
- **role enum 화** — `String role` → `Role enum (USER, ADMIN, ...)` — 타입 안전성 ↑

---

## 관련 파일

- `common/common-security/src/main/java/com/factory/common/security/SecurityConfig.java` — `@EnableMethodSecurity` 추가
- `common/common-security/src/main/java/com/factory/common/security/AdminOnly.java` — 신규 meta annotation
- `common/common-security/src/test/java/com/factory/common/security/AdminOnlyTest.java` — 신규 단위 테스트
- `tools/new-app/new-app.sh` — `<Slug>PaymentController.refund` heredoc 에 `@AdminOnly` 적용
