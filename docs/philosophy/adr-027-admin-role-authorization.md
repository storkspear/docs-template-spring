# ADR-027 — Admin role 권한 시스템 (@AdminOnly)

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~6분

**상태**: 채택 (2026-05-02)
**전제**: ADR-018 (멀티 슬러그 라우팅), 기존 JWT/SecurityConfig 인프라
**연관**: U 사이클 — 운영자 권한 endpoint

---

## 결론부터

운영자 전용 endpoint 를 보호하는 *@AdminOnly* meta annotation + JWT `role` claim 검증을 도입해요. Spring Security 의 `@PreAuthorize("hasRole('ADMIN')")` 보다 *간결하고 도메인 의도가 명시적* 이에요.

`role` claim 은 JWT 발급 시 user.role 에서 복사돼요 (`"user"` / `"admin"`). AppSlugVerificationFilter 와 같은 chain 에서 검증되어 *앱 단위 + role 단위* 이중 격리가 이뤄져요.

---

## 배경

기존 인증/권한 시스템:

```
User (DB.role) "admin"
  ↓ EmailAuthService 가 issueAccessToken 시 role claim 포함
JWT { sub: 1, email: ..., appSlug: ..., role: "admin" }
  ↓ JwtAuthFilter 가 SecurityContext 에 Authentication 셋업
SimpleGrantedAuthority("ROLE_ADMIN")
  ↓ AuthenticatedUser.isAdmin() 헬퍼 = role.equalsIgnoreCase("admin")
```

JWT + GrantedAuthority 매핑은 됐는데, **실제 endpoint 단에서 권한 체크 패턴이 없어요**:
- `@PreAuthorize` 사용 X (`@EnableMethodSecurity` 미적용)
- 컨트롤러가 `currentUser.isAdmin()` 을 직접 체크 → boilerplate
- ArchUnit 으로 강제 X — admin endpoint 인지를 코드만으로 알기 어려워요

운영자 endpoint (refund, plan 관리, subscription 강제 cancel 등) 가 본격 추가되기 전에 **권한 컨벤션 정립** 이 필요해요.

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
