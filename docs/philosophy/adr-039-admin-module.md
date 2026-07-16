# ADR-039 · admin 모듈 — cross-app 운영 콘솔 (superadmin + admin 스키마 + in-process fan-out)

**Status**: Accepted. `core/core-admin-impl` 모듈로 구현 완료(`feat/admin-module`, 도그푸딩까지 완료). `admin` 스키마 + 슬러그 fan-out(`AdminSlugRegistry`) + 활동 추적(`user_activity_days`, V017)으로 `/api/admin/*` 콘솔을 제공합니다 — 현재 컨트롤러 12개·매핑 38개(2026-07-15 실측). 이 ADR 이 신설한 `ROLE_SUPERADMIN` 단일 권한은 이후 viewer/support/admin/master 4티어 + 리소스별 `PERM_*` 권한 RBAC 로 확장됐어요(§결정 1 의 갱신 참고).

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~10분

## 결론부터

`template-react-admin` 은 9개 `/api/admin/*` 엔드포인트 계약을 이미 갖고 있었지만 template-spring 쪽 구현은 0개였습니다. 이 ADR 은 그 실물을 채우는 결정이에요. 핵심은 **"per-app 격리 원칙을 깨지 않으면서 cross-app 콘솔을 어떻게 얹는가"** 입니다.

답은 세 갈래입니다. ① 앱 사용자 권한(`ROLE_ADMIN`)과 완전히 분리된 `ROLE_SUPERADMIN` 을 신설해 양방향 격리를 강제하고(이후 4티어 RBAC 로 확장), ② 운영자 계정·권한만 담는 **`admin` 스키마**(`admin_users` — 이후 RBAC 확장으로 `role_permissions` 추가)를 라우팅 대상에서 제외된 고정 DataSource 로 붙이며, ③ cross-app 조회는 별도 서비스나 메시지 큐 없이 **같은 JVM 안에서 슬러그별 DataSource 를 순회하는 in-process fan-out** 으로 처리합니다. 여기에 운영에 실제로 필요한데 조회 불가능했던 DAU/MAU 지표는 라벨만 유지한 채 버리지 않고, **활동 추적 테이블(`user_activity_days`)을 신설해 진짜 데이터로 만들었습니다.**

`admin` 스키마는 [ADR-037](./adr-037-core-schema-deprecation.md) 이 폐기한 "공유 core schema" 의 부활이 **아닙니다** — 거기엔 앱 데이터가 한 byte 도 없고, 담는 건 공장 운영자 계정 하나뿐이에요.

## 왜 이런 고민이 시작됐나?

[ADR-005](./adr-005-db-schema-isolation.md)(단일 Postgres + 앱당 schema), [ADR-012](./adr-012-per-app-user-model.md)(앱별 독립 유저 모델), [ADR-037](./adr-037-core-schema-deprecation.md)(core schema 폐기) 세 ADR 이 함께 만든 전제는 명확합니다 — **한 앱의 데이터는 다른 앱이 절대 못 본다.** JWT 의 `appSlug` claim, `AppSlugVerificationFilter`, DB role, `SchemaRoutingDataSource`, ArchUnit 까지 5중 방어선이 이 원칙을 지킵니다.

그런데 이 프로젝트의 존재 이유는 **솔로 운영자 한 명이 여러 앱을 동시에 굴리는 것**이에요(프롤로그의 "앱 공장 전략"). 앱이 10개면 운영자는 자기가 만든 그 10개 앱의 유저 수·매출·실패율을 **한눈에** 봐야 합니다. per-app 격리가 "앱 A 유저는 앱 B 유저를 못 본다" 는 뜻이어야지, "운영자 본인도 앱 10개를 한 화면에서 못 본다" 는 뜻이 되어서는 안 됩니다. 이 둘을 동시에 만족시키는 게 이 결정이 답해야 했던 물음이었습니다.

> per-app 격리를 무너뜨리지 않으면서, 솔로 운영자에게 cross-app 단일 콘솔을 어떻게 제공하는가? 그리고 그 운영자 계정 자체는 어느 schema 에 저장하는가 — 폐기된 core schema 를 다시 살리지 않고?

추가로 실무적인 문제가 하나 더 있었어요. React 콘솔(`template-react-admin`)의 mock 계약에는 DAU/MAU 같은 지표가 이미 필드로 박혀 있었는데, 실제 DB 에는 "유저가 오늘 접속했는지" 를 기록하는 테이블이 없었습니다. 조회 불가능한 필드를 그대로 두면 콘솔이 거짓말을 하는 셈이라, 이 기회에 **진짜 데이터로 만들지, 계약에서 들어낼지**를 결정해야 했습니다.

## 고민했던 대안들

### Option 1 — per-app admin 화면만 (cross-app 콘솔 없음)

각 앱(`apps/app-<slug>`)이 자기 admin 화면을 갖고, 운영자는 앱마다 따로 로그인해서 확인.

- **장점**: 기존 `ROLE_ADMIN` + `AppSlugVerificationFilter` 인프라를 그대로 재사용. 새 role·새 schema 불필요.
- **단점**: 앱이 10개면 로그인도 10번, 대시보드도 10개. "오늘 전체 매출이 얼마인가" 같은 가장 기본적인 질문에 답하려면 운영자가 직접 10개 창을 열고 암산해야 합니다.
- **탈락 이유**: 프롤로그의 제약 2(시간이 가장 희소한 자원)를 정면 위반. 앱 수가 늘수록 확인 비용이 선형 증가하는데, 이 프로젝트의 존재 이유가 "앱 추가 비용을 0에 가깝게" 이므로 앱이 늘수록 운영 비용도 늘어나는 구조는 받아들일 수 없었습니다.

### Option 2 — 공유 core 스키마 부활

`admin_users` 뿐 아니라 cross-app 조회에 필요한 여러 테이블/뷰를 다시 공유 `core` schema 에 모아 관리.

- **장점**: 한 곳에 다 있으니 JOIN 이나 집계 쿼리를 schema 하나에서 끝낼 수 있어 개발이 편함.
- **단점**: [ADR-037](./adr-037-core-schema-deprecation.md) 이 core schema 를 폐기한 이유가 바로 "앱 데이터가 어디 있는지 모호해지는 것" 이었습니다. cross-app 조회 편의를 위해 앱 데이터의 일부(또는 파생 집계)를 다시 공유 schema 로 끌어오기 시작하면, "이 유저 row 는 어느 schema 가 진실인가" 라는 이미 해결한 문제가 재발합니다.
- **탈락 이유**: ADR-037 의 교훈을 정면으로 되돌리는 안. `admin_users` 하나만 예외로 두는 것과, "cross-app 조회용 공유 schema" 를 다시 만드는 것은 규모가 다른 결정입니다 — 전자는 앱 데이터를 담지 않지만 후자는 결국 앱 데이터의 파생물을 담게 됩니다.

### Option 3 — 별도 배포 (admin 전용 서비스)

관리 콘솔 백엔드를 별도 Spring Boot 프로세스로 분리, 각 앱 DB 에 읽기 전용으로 접속.

- **장점**: 장애 격리(admin 콘솔이 죽어도 앱 API 는 무사) + 배포 독립성.
- **단점**: [ADR-001](./adr-001-modular-monolith.md)(모듈러 모놀리스)이 "운영 단위 1" 을 지키기 위해 채택한 구조와 정면으로 충돌합니다. 프로세스 하나, 배포 파이프라인 하나, 모니터링 하나를 유지하려고 이미 다 모아 놨는데, admin 콘솔 하나 때문에 다시 프로세스를 쪼개면 [ADR-007](./adr-007-solo-friendly-operations.md)(솔로 친화적 운영)의 전제가 깨집니다.
- **탈락 이유**: 이 프로젝트가 각 도메인을 하나의 JAR 안에 모듈로 격리해 온 이유(ADR-001) 와 정확히 같은 이유로 기각. cross-app 조회 자체도 네트워크 홉이 필요 없어지는 이점(같은 JVM·같은 DB 인스턴스)을 스스로 포기하는 셈입니다.

### Option 4 — in-process fan-out ★ (채택)

`core-admin-impl` 을 기존 모듈러 모놀리스 **안에** 추가하고, cross-app 조회는 이미 존재하는 `<slug>DataSource` 빈들을 순회하는 방식으로 처리.

- **힘 A 만족** (per-app 격리 유지): 앱 데이터는 여전히 자기 schema 에만 있고, admin 모듈은 그걸 *읽기만* 합니다. 쓰기는 하지 않고, 앱 스키마 구조 자체도 바꾸지 않아요.
- **힘 B 만족** (cross-app 가시성): 슬러그 순회 + 메모리 합산으로 "전체 매출", "전체 DAU" 같은 질문에 한 번의 로그인·한 화면으로 답합니다.
- **네트워크 홉 없음**: 모든 앱이 한 JVM·한 DB 인스턴스에 있으므로 MSA 라면 필요했을 분산 트랜잭션이나 서비스 간 호출이 전혀 없습니다 — "MSA composition 의 로컬 버전"인 셈이에요.
- **운영자 계정 저장은 예외적으로 새 schema**: `admin_users` 는 앱 데이터가 아니므로 ADR-037 의 폐기 대상이 아니라고 판단, 별도 `admin` schema 로 신설(§결정 참고).

## 결정

### 1. `ROLE_SUPERADMIN` — 양방향 격리

`role='admin'` 인 앱 유저는 이미 `ROLE_ADMIN` 으로 인가됩니다([ADR-027](./adr-027-admin-role-authorization.md)). 여기에 `/api/admin/**` 를 `ROLE_ADMIN` 으로 열면 **어떤 앱이든 자기 admin 계정으로 전체 콘솔에 들어올 수 있게 됩니다** — 앱 하나가 뚫리면 공장 전체가 뚫리는 셈이에요. 그래서 앱 권한과 완전히 분리된 `ROLE_SUPERADMIN` 을 신설했습니다.

> **갱신 (2026-07, RBAC 확장)**: v1 의 인가 규칙은 `.requestMatchers(SECURED_PATTERN).hasRole("SUPERADMIN")` 단일 게이트였어요. 이후 콘솔 RBAC 확장으로 `admin_users.role`(V002 — viewer/support/admin/master 4티어)과 편집 가능한 `role_permissions`(V003)가 도입되면서, 지금은 콘솔 JWT 에 실린 리소스별 `PERM_*` authority 를 `SecurityConfig` 가 검사합니다. "앱 권한과 콘솔 권한의 양방향 격리" 라는 이 절의 본질은 그대로예요. 아래는 현행 스니펫입니다.

```java
// common/common-security/src/main/java/com/factory/common/security/SecurityConfig.java:92-152 (발췌)
// 운영 콘솔 RBAC — 로그인/헬스만 public, 나머지는 리소스별 PERM_* 권한.
.requestMatchers(ApiEndpoints.Admin.PUBLIC_PATTERNS).permitAll()   // login, health
.requestMatchers(ApiEndpoints.Admin.ADMINS, ApiEndpoints.Admin.ADMINS + "/**",
                ApiEndpoints.Admin.ROLES_PERMISSIONS)
        .hasAuthority(ApiEndpoints.Admin.PERM_ADMIN_MANAGE)        // 계정 관리·역할 매트릭스 (master)
.requestMatchers(ApiEndpoints.Admin.APP_USERS_PATTERN)
        .hasAuthority(ApiEndpoints.Admin.PERM_USERS_READ)          // 사용자 조회 (support+)
// ... 결제/파일/콘텐츠/감사로그/대시보드/앱·분석도 각각 PERM_* 로 게이팅 ...
.requestMatchers(ApiEndpoints.Admin.SECURED_PATTERN).authenticated()   // 그 외 콘솔 경로 fail-safe
```

양방향으로 격리됩니다. `/api/admin/**` 는 콘솔 계정의 JWT(리소스별 `PERM_*` authority)만 허용하고, 콘솔 JWT 로 `/api/apps/{slug}/**` 를 호출하면 기존 `AppSlugVerificationFilter` 가 403 을 냅니다(JWT 의 `appSlug` claim 이 `"admin"` 고정값이라 어떤 실제 슬러그와도 일치하지 않음).

### 2. `admin` 스키마 + `admin_users` — 유일한 비-per-slug 예외

운영자 계정은 앱 데이터가 아니므로 per-slug schema 에 둘 이유가 없습니다. 별도 `admin` schema 를 만들고, 라우팅(`SlugContext`)을 타지 않는 **고정 DataSource** 로 바인딩합니다.

```java
// core/core-admin-impl/src/main/java/com/factory/core/admin/impl/config/AdminDataSourceConfig.java
@Bean(name = "adminDataSource")
public DataSource adminDataSource(...) { ... }   // ADMIN_DB_* 미설정 시 core DB_URL 의 currentSchema 를 admin 으로 치환
```

이 빈은 `RoutingDataSourceConfig` 의 슬러그 열거 대상에서 명시적으로 제외됩니다(§교훈의 fail-secure 이슈 참고). `admin_users` 는 v1 에선 `id, email(unique), password_hash, display_name, created_at, updated_at` 여섯 컬럼뿐인 축소판 유저 테이블이었고, 이후 RBAC 확장으로 `role` 컬럼(V002)과 역할별 권한 grant 테이블 `role_permissions`(V003)가 admin 스키마에 추가됐어요. `ADMIN_EMAIL`/`ADMIN_PASSWORD` env 가 채워져 있고 테이블이 비어 있을 때만 `AdminAccountSeeder` 가 부팅 시 최고 티어(master) 1계정을 시드합니다.

### 3. in-process fan-out — `AdminSlugRegistry`

`RoutingDataSourceConfig` 가 이미 `<slug>DataSource` 네이밍 컨벤션으로 전 앱의 DataSource 빈을 갖고 있다는 점을 그대로 재사용합니다. `AdminSlugRegistry` 가 `Map<String, DataSource>` 를 주입받아 `"DataSource"` suffix 를 가진 빈 중 `"admin"`(콘솔 자신)과 빈 문자열을 제외한 나머지를 슬러그 목록으로 노출합니다.

```java
// core/core-admin-impl/src/main/java/com/factory/core/admin/impl/AdminSlugRegistry.java
public List<String> slugs() { return bySlug.keySet().stream().sorted().toList(); }
public JdbcTemplate jdbcFor(String slug) { ... }   // unknown slug → AdminSlugNotFoundException(404 ADMIN_003)
```

단건/목록 조회(사용자·디바이스·구독·결제 이력)는 `SELECT ... WHERE user_id = ?` 형태로 슬러그 하나의 JdbcTemplate 을 직접 쓰고, 집계성 조회(대시보드 합산·앱별 metrics·빌링·분석 시계열·감사로그 cross-app 검색)는 슬러그 목록을 순회하며 각자의 JdbcTemplate 으로 조회한 뒤 애플리케이션 메모리에서 합산·병합·정렬합니다. 계획 문서 대비 두 가지를 의도적으로 바꿨습니다 — impl→impl 의존 금지 규칙 때문에 다른 `core-*-impl` 의 리포지토리를 재사용할 수 없어 전부 `JdbcTemplate` 직접 조회로 구현했고(JPA 미사용), 응답 DTO 는 ArchUnit r18/r19(record + `Response` suffix) 를 만족하도록 전부 최상위 record 로 통일했습니다.

### 4. `user_activity_days` — DAU/MAU/리텐션의 진짜 원천

React 계약에 이미 있던 DAU/MAU 필드를 가짜 값으로 채우는 대신, **활동 추적 자체를 신설**했습니다. `UserActivityTrackingFilter` 가 `/api/apps/**` 인증 요청마다 `(user_id, 오늘)` 을 upsert 합니다.

```java
// core/core-user-impl/src/main/java/com/factory/core/user/impl/UserActivityTrackingFilter.java
private static final String UPSERT =
    "INSERT INTO user_activity_days (user_id, activity_date) VALUES (?, CURRENT_DATE)"
        + " ON CONFLICT DO NOTHING";
```

"오늘" 은 애플리케이션 서버 시계가 아니라 **DB 의 `CURRENT_DATE`** 로 upsert 쿼리 안에서 결정합니다 — 앱 서버와 DB 서버의 시계·타임존이 어긋나도 기록 시점과 `WHERE activity_date = CURRENT_DATE` 집계 쿼리의 기준이 항상 일치하도록 시계를 통일한 거예요. 유저×날짜 인메모리 dedup 캐시로 같은 날 중복 upsert 를 걸러 부하는 사실상 0 입니다. 이 테이블은 V017 로 신설되어(§data-model 참고) 당시 도메인 테이블 시작 번호가 V017 → V018 로 한 칸 밀렸습니다(이후 공통 테이블이 계속 늘어 현재 도메인 시작 번호는 V026).

## 이 선택이 가져온 것

### 긍정적 결과

- **콘솔 전체가 mock 이 아닌 실 데이터로 동작** — v1 의 login/health/apps/dashboard/metrics/users/userDetail/billing/audit-logs 9개에서 출발해, analytics·ops(갱신 실패율·webhook 처리·리텐션)·활동 ping·RBAC 계정 관리·파일·콘텐츠 모더레이션 등으로 확장. 현재 컨트롤러 12개·매핑 38개(2026-07-15 실측).
- **React 계약의 진실화** — 조회 불가능했던 필드를 없애는 대신, DAU/MAU 처럼 실제로 유용한 지표는 데이터 소스를 새로 만들어 계약을 지켰습니다. "라벨은 유지, 값은 진짜로" 원칙.
- **gross 매출 시맨틱 정합** — `payment_history.status` 가 환불 시 `PAID`→`REFUNDED` 로 *덮어써지는* 구조라, gross(수금총액)를 `status='PAID'` 로만 집계하면 환불건이 gross 에서도 빠지고 `gross - refunded` 로 다시 한 번 차감되는 이중차감 버그가 있었습니다. `status IN ('PAID','REFUNDED')` 로 정정해 "환불 여부와 무관하게 한 번이라도 수금된 금액의 총합" 이라는 시맨틱을 대시보드/앱 metrics/billing/analytics 4곳 모두에 일관 적용했습니다. *(후속: 부분환불 도입으로 gross 필터에 `PARTIALLY_REFUNDED` 를 추가하고, `refunded` 는 `payment_refunds` 원장의 건별 합으로 이관 — 현행 시맨틱은 [`admin-console.md §5-1`](../api-and-functional/admin-console.md) 참고.)*
- **네트워크 홉 0** — MSA 였다면 필요했을 서비스 간 호출·분산 트랜잭션 없이, 슬러그별 JdbcTemplate 순회만으로 cross-app 집계가 끝납니다.
- **양방향 권한 격리** — `ROLE_SUPERADMIN`/`ROLE_ADMIN` 분리로 앱 admin 의 콘솔 침입과 superadmin 의 앱 API 접근을 모두 차단.

### 부정적 결과 (알려진 한계)

- **cross-app 감사로그는 메모리 페이징** — slug 미지정 조회는 전 슬러그를 병합 정렬한 뒤 메모리에서 페이지를 자릅니다. 솔로 규모(앱 수 ~10, 로그 수만 건)에선 문제없지만, 커지면 slug 필터 유도나 커서 방식 개선이 필요합니다.
- **DAU 과거 데이터 없음** — `user_activity_days` 추적 시작일 이전 활동은 존재하지 않아, 차트는 데이터가 쌓인 구간부터만 보입니다.
- **`admin` schema 는 "완전한 per-app 격리" 원칙의 명시적 예외** — 예외가 하나 생겼다는 것 자체가 앞으로 "이것도 admin 스키마에 넣어도 되지 않나" 하는 요청의 근거가 될 수 있어, 운영자 계정·권한 메타(현재 `admin_users`·`role_permissions`) 외의 어떤 것도 — 특히 앱 데이터의 파생물은 — 이 schema 에 들어가지 않도록 원칙을 문서로 계속 명확히 해야 합니다.

## 교훈

라이브 도그푸딩과 최종 리뷰 픽스 웨이브에서 실제로 재현·수정한 결함들이에요. 전부 "이론상 맞는 코드가 실제 HTTP 요청 경로에서는 다르게 동작한" 케이스라 기록할 가치가 있습니다.

**① `-parameters` 미적용 + 무명 파라미터 → 매 요청 500.** 이 빌드는 javac `-parameters` 플래그를 켜지 않습니다. `AdminUsersController`/`AdminAuditController`/`AdminAnalyticsController`/`AdminMetricsController`/`AdminDashboardController` 는 처음에 `@PathVariable String slug`, `@RequestParam(required = false) String query` 처럼 이름을 생략해서 작성됐는데, 이러면 런타임에 리플렉션이 파라미터 이름을 찾지 못해 **실제 HTTP 요청마다 500**(`IllegalArgumentException: ... '-parameters' flag`)이 납니다. 기존 admin IT 테스트가 전부 서비스 계층을 직접 호출해서(HTTP 디스패치를 안 거쳐서) 이 결함은 한동안 드러나지 않았고, 컨트롤러 레벨 MockMvc 테스트를 실제로 작성하는 과정에서 재현·발견됐습니다. `NotificationSettingController` 가 이미 이 저장소의 정착된 컨벤션(명시적 이름)이라는 걸 확인하고 5개 컨트롤러 전부에 명시적 이름을 부여했습니다.

**② `AccessDeniedHandler` 미등록 → 인증됨+권한부족이 403 이 아니라 401 로 뒤바뀜.** `SecurityConfig` 에 `accessDeniedHandler` 가 없으면 Spring 기본 `AccessDeniedHandlerImpl` 이 `response.sendError(403)` 을 호출하고, 임베디드 Tomcat 이 이걸 감지해 Boot 의 `/error` 로 **내부 forward** 를 수행합니다. `JwtAuthFilter`/`AppSlugMdcFilter`/`AppSlugVerificationFilter` 는 모두 `OncePerRequestFilter` 라 기본값(`shouldNotFilterErrorDispatch()==true`) 때문에 이 forward 에서 재실행되지 않고, `SecurityContextHolderFilter` 는 (아무 것도 저장된 적 없으니) 빈 컨텍스트를 다시 로드합니다. 그 결과 `AnonymousAuthenticationFilter` 가 익명 토큰을 채우고 `anyRequest().authenticated()` 재평가가 이번엔 *진짜 익명* 이라 실패해 `JsonAuthenticationEntryPoint` 로 라우팅됩니다 — **인증된 `ROLE_USER` 가 `SUPERADMIN` 전용 경로를 호출해도 최종 응답은 401 CMN_004("Authentication required")** 로 뒤바뀝니다. 라이브 도그푸딩에서 "앱 토큰으로 admin API 호출 시 403 이 아니라 401" 로 실제 관찰됐고, `AppSlugVerificationFilter` 는 애초에 `sendError` 를 안 쓰고 응답을 직접 커밋해서 이 버그의 영향을 받지 않았다는 점에 착안해 동일 패턴의 `JsonAccessDeniedHandler` 를 신규 작성했습니다. MockMvc 로는 이 컨테이너 레벨 forward 가 재현되지 않아(403 + 빈 바디만 관찰), `webEnvironment=RANDOM_PORT` + `TestRestTemplate` 로 실제 Tomcat 을 띄워서야 재현·검증할 수 있었습니다.

**③ `adminDataSource` 가 슬러그 라우팅 맵에 새어 들어갈 뻔함.** `RoutingDataSourceConfig` 의 라우팅 대상 수집 조건이 처음엔 `!beanName.equals("dataSource")` 만 제외했는데, 이러면 `adminDataSource` 도 슬러그 `"admin"` 으로 라우팅 테이블에 등록됩니다. superadmin 토큰(`appSlug=admin`)이 `/api/apps/admin/...` 을 호출하면 `admin` schema 로 라우팅될 수 있었던, fail-secure 원칙 위반 소지였습니다. `!beanName.equals("adminDataSource")` 조건을 추가해 명시적으로 제외했습니다.

**④ `new-app.sh` 예약어 슬러그 미차단.** `admin`/`core`/`public` 슬러그가 기존 `_valid_slug` 정규식(`^[a-z][a-z0-9-]*$`)을 그대로 통과해버려서, 새 앱을 `admin` 슬러그로 만들면 `admin` schema·`adminDataSource`·`adminFlyway` 빈 이름과 충돌할 수 있었습니다. DB 연결 확인보다 앞선 단계에 `case` 문으로 3개 예약어를 차단했습니다.

## 관련 사례 (Prior Art)

- **Kubernetes `ClusterRole` vs 네임스페이스 `Role`** — cluster-admin 은 전 네임스페이스를 넘나들고 일반 Role 은 자기 네임스페이스에 갇히는 구조가, 이 ADR 의 `ROLE_SUPERADMIN`(전 슬러그) vs `ROLE_ADMIN`(자기 슬러그만) 분리와 정확히 같은 모양입니다. [ADR-001](./adr-001-modular-monolith.md) 이 이미 이 비유(namespace ↔ Gradle 모듈)를 쓴 적이 있는데, 이번엔 그 위에 "cluster 관리자" 계층을 하나 더 얹은 셈이에요.
- **django-tenants 의 `public` schema** — Django 기반 멀티테넌트 라이브러리들은 테넌트별 schema 와 별도로, 테넌트 디렉토리·플랫폼 운영자 계정을 담는 `public` schema 를 둡니다. 이 프로젝트의 `admin` schema 가 정확히 이 역할입니다 — 테넌트(앱) 데이터는 없고, "테넌트가 몇 개고 누가 운영자인가" 라는 메타 정보만 있어요.
- **Stripe/Auth0 류 SaaS 의 내부 운영 콘솔** — 고객(테넌트) 데이터를 다루는 프로덕트와, 그 데이터를 cross-tenant 로 조회하는 내부 운영 도구를 분리하되 같은 데이터 계층 위에 얹는 패턴은 업계에서 흔합니다. 이 프로젝트는 그 운영 도구를 별도 서비스로 빼지 않고 같은 모놀리스 안의 모듈로 유지한다는 점이 다릅니다(Option 3 기각 사유).

## Code References

**인증/권한**:
- [`common/common-security/src/main/java/com/factory/common/security/SecurityConfig.java:92-152`](https://github.com/storkspear/template-spring/blob/main/common/common-security/src/main/java/com/factory/common/security/SecurityConfig.java) — `Admin.PUBLIC_PATTERNS` permitAll + 리소스별 `PERM_*` `hasAuthority` + `SECURED_PATTERN` fail-safe(갱신)
- [`common/common-security/src/main/java/com/factory/common/security/JsonAccessDeniedHandler.java`](https://github.com/storkspear/template-spring/blob/main/common/common-security/src/main/java/com/factory/common/security/JsonAccessDeniedHandler.java) — sendError 회피, 403 직접 커밋(교훈 ②)
- [`core/core-admin-impl/src/main/java/com/factory/core/admin/impl/AdminAuthService.java`](https://github.com/storkspear/template-spring/blob/main/core/core-admin-impl/src/main/java/com/factory/core/admin/impl/AdminAuthService.java) — `SUPERADMIN_ROLE` 상수 + 로그인

**admin 스키마**:
- [`core/core-admin-impl/src/main/java/com/factory/core/admin/impl/config/AdminDataSourceConfig.java`](https://github.com/storkspear/template-spring/blob/main/core/core-admin-impl/src/main/java/com/factory/core/admin/impl/config/AdminDataSourceConfig.java) — 고정 DataSource + 전용 Flyway
- [`core/core-admin-impl/src/main/resources/db/migration/admin/V001__init_admin_users.sql`](https://github.com/storkspear/template-spring/blob/main/core/core-admin-impl/src/main/resources/db/migration/admin/V001__init_admin_users.sql) — 이후 [`V002__add_admin_role.sql`](https://github.com/storkspear/template-spring/blob/main/core/core-admin-impl/src/main/resources/db/migration/admin/V002__add_admin_role.sql)(4티어 role) + [`V003__init_role_permissions.sql`](https://github.com/storkspear/template-spring/blob/main/core/core-admin-impl/src/main/resources/db/migration/admin/V003__init_role_permissions.sql)(편집 가능 권한 매트릭스) 추가
- [`infra/scripts/init-admin-schema.sql`](https://github.com/storkspear/template-spring/blob/main/infra/scripts/init-admin-schema.sql)
- [`bootstrap/src/main/java/com/factory/bootstrap/config/RoutingDataSourceConfig.java:66-71`](https://github.com/storkspear/template-spring/blob/main/bootstrap/src/main/java/com/factory/bootstrap/config/RoutingDataSourceConfig.java) — `adminDataSource` 라우팅 제외(교훈 ③)

**fan-out**:
- [`core/core-admin-impl/src/main/java/com/factory/core/admin/impl/AdminSlugRegistry.java`](https://github.com/storkspear/template-spring/blob/main/core/core-admin-impl/src/main/java/com/factory/core/admin/impl/AdminSlugRegistry.java)
- [`core/core-admin-impl/src/main/java/com/factory/core/admin/impl/AdminMetricsService.java`](https://github.com/storkspear/template-spring/blob/main/core/core-admin-impl/src/main/java/com/factory/core/admin/impl/AdminMetricsService.java) — gross/net 시맨틱(`status IN ('PAID','REFUNDED','PARTIALLY_REFUNDED')`, refunded 는 `payment_refunds` 원장)
- [`core/core-admin-impl/src/main/java/com/factory/core/admin/impl/controller/AdminControllerAdvice.java`](https://github.com/storkspear/template-spring/blob/main/core/core-admin-impl/src/main/java/com/factory/core/admin/impl/controller/AdminControllerAdvice.java) — `@Order(HIGHEST_PRECEDENCE)` 예외 매핑

**활동 추적**:
- [`core/core-user-impl/src/main/java/com/factory/core/user/impl/UserActivityTrackingFilter.java`](https://github.com/storkspear/template-spring/blob/main/core/core-user-impl/src/main/java/com/factory/core/user/impl/UserActivityTrackingFilter.java) — `CURRENT_DATE` upsert
- [`tools/new-app/new-app.sh:277-282`](https://github.com/storkspear/template-spring/blob/main/tools/new-app/new-app.sh) — 예약어 슬러그(admin/core/public) 차단(교훈 ④), 891행 부근 V017 heredoc

**스펙 원본**:
- [`docs/superpowers/specs/2026-07-06-admin-module-design.md`](https://github.com/storkspear/template-spring/blob/main/docs/superpowers/specs/2026-07-06-admin-module-design.md)

## 후속

- cross-app 감사로그 커서 페이징 — 앱 수·로그 수가 솔로 규모를 넘어서면 메모리 병합 페이징을 교체.
- ~~admin 다계정~~ — **구현 완료**: `AdminAccountsController`(계정 생성·역할부여·비번변경, self/계층 가드) + 4티어 RBAC. admin TOTP 는 여전히 후속.
- DAU 정밀화 — 현재는 인증 요청 자체가 활동 신호(부팅·활동 ping). 포그라운드 복귀 수준 정밀도는 flutter kit v2 후보.
