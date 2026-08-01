# 보안 이벤트 로그 정책

> **유형**: Reference · **독자**: 운영자 (Level 2.5) · **읽는 시간**: ~9분

이 문서는 보안 이벤트(로그인 실패·권한 거부·webhook 서명 실패·rate limit·PII 열람 등)가 현재 코드에서 어떤 레벨·어떤 형식으로 로깅되는지 전수 조사한 인벤토리와, 거기서 도출한 로그 정책이에요. 레벨 일반론은 [`Observability 규약`](../../api-and-functional/functional/observability.md)의 로그 레벨 가이드가 원본이고, 이 문서는 보안 이벤트로 범위를 좁혀 실측 현황을 담아요. 보안 이벤트 로그 정책을 정하기 위해 작성했어요.

---

## 1. 현재 실측 인벤토리

아래 표는 코드 grep 실측 결과예요. "레벨 = 없음" 은 그 이벤트가 발생해도 **로그가 한 줄도 남지 않는다**는 뜻이고, 이때 관측 수단은 HTTP 상태 코드 메트릭(`http.server.requests` 의 401/403/429)뿐이에요.

도메인 예외(`BaseException` 계열)의 보안 로깅은 [`GlobalExceptionHandler`](../../../common/common-web/src/main/java/com/factory/common/web/exception/GlobalExceptionHandler.java)`.handleBaseException` 이 **중앙에서** 처리해요 — 개별 서비스 메서드는 보안 로깅 코드를 갖지 않아요. 무엇을 남길지는 각 에러 코드의 [`ErrorInfo.securityEventPolicy()`](../../../common/common-web/src/main/java/com/factory/common/web/exception/ErrorInfo.java) 가 정하고, 401·403·429 코드가 이 판단을 빠뜨리면 `SecurityEventCoverageTest` 가 빌드를 깨뜨려요 (§2 의 7번 규약).

### 1-1. 인증 (로그인·토큰)

| 이벤트 | 위치 | 레벨 | 메시지 형식 |
|---|---|---|---|
| 이메일 로그인 실패 (앱 사용자) | [`EmailAuthService`](../../../core/core-auth-impl/src/main/java/com/factory/core/auth/impl/service/EmailAuthService.java)`.signIn` → `AuthException(ATH_001)` | 없음 (의도) | — 익명 401 이라 401 메트릭에 위임. 반복 실패는 아래 계정 잠금 2줄이 관측 (ATH_001 은 `WHEN_AUTHENTICATED` 라 비밀번호 변경 실패에서만 남아요) |
| 계정 잠금으로 로그인 차단 | [`LoginLockoutService`](../../../core/core-auth-impl/src/main/java/com/factory/core/auth/impl/service/LoginLockoutService.java)`.assertNotLocked` | **WARN** | `login blocked — account locked (userId={}, retryAfterSeconds={})` — 잠긴 계정에 계속 시도 = 자동화 공격 신호 |
| 계정 잠금 발동 | `LoginLockoutService.onFailure` | INFO | `account locked after {} failed attempts (userId={}, until={})` — 방어가 작동한 상태 변화라 §2-2 대로 INFO |
| 콘솔 로그인 실패 (운영 콘솔) | [`AdminAuthService`](../../../core/core-admin-impl/src/main/java/com/factory/core/admin/impl/AdminAuthService.java)`.login` → `AdminAuthException(ADMIN_001)` | **WARN** | `security event — code=ADMIN_001, path={}` (중앙). 콘솔은 계정 잠금을 타지 않아 시도가 무제한이라 익명이어도 남겨요 |
| JWT 검증 실패 (만료·위조) | [`JwtAuthFilter`](../../../common/common-security/src/main/java/com/factory/common/security/jwt/JwtAuthFilter.java)`.doFilterInternal` | DEBUG | `JWT validation failed: {}` — 운영 root 레벨이 INFO 라 **출력 안 됨** |
| 소셜 로그인 토큰 검증 실패 | [`GoogleSignInService`](../../../core/core-auth-impl/src/main/java/com/factory/core/auth/impl/service/GoogleSignInService.java) 등 provider 별 service | WARN | 예: `Google token aud mismatch: allowed={}, actual={}` |
| 회원 탈퇴 | [`WithdrawService`](../../../core/core-auth-impl/src/main/java/com/factory/core/auth/impl/service/WithdrawService.java)`.withdraw` | INFO | `User {} withdrew. Reason: {}` / `User {} withdrew. No reason provided.` |

### 1-2. 2FA TOTP ([`TwoFactorService`](../../../core/core-auth-impl/src/main/java/com/factory/core/auth/impl/totp/TwoFactorService.java))

| 이벤트 | 위치 | 레벨 | 메시지 형식 |
|---|---|---|---|
| TOTP 코드 검증 실패 (2단계 로그인·disable·setup verify) | `loginWith2fa` / `disable` / `verifyAndEnable` → `AuthException(ATH_007)` | **WARN** | `security event — code=ATH_007, path={}` (중앙). 2FA 우회 시도라 익명이어도 남겨요 |
| 2FA 활성화 성공 | `verifyAndEnable` | INFO | `2FA enabled — userId={}` |
| 2FA 비활성화 성공 | `disable` | INFO | `2FA disabled — userId={}` |
| backup code 1개 소비 (소진 추적) | `tryConsumeBackupCode` | INFO | `2FA backup code consumed — userId={}, remaining={}` — `remaining=0` 이 소진 시점 |
| backup code CAS 재시도 한도 소진 | `tryConsumeBackupCode` | WARN | `2FA backup code CAS 재시도 한도 소진 — userId={}` |
| backup codes JSON 파손 | `deserializeCodes` | WARN | `backup codes deserialize fail — treating as empty: {}` |

### 1-3. 권한 거부 (RBAC)

| 이벤트 | 위치 | 레벨 | 메시지 형식 |
|---|---|---|---|
| 인가 실패 403 (PERM_* 권한 부족) | [`JsonAccessDeniedHandler`](../../../common/common-security/src/main/java/com/factory/common/security/JsonAccessDeniedHandler.java)`.handle` ([`SecurityConfig`](../../../common/common-security/src/main/java/com/factory/common/security/SecurityConfig.java) 가 등록) | **WARN** (인증된 주체만) | `access denied — path={}, principal={}` — 익명 403 은 남기지 않아요 (봇 스캔 폭증 방지, 403 메트릭에 위임) |
| 인증 실패 401 진입점 | [`JsonAuthenticationEntryPoint`](../../../common/common-security/src/main/java/com/factory/common/security/JsonAuthenticationEntryPoint.java)`.commence` | 없음 (의도) | — 익명 401 은 401 메트릭에 위임 (§4 의 401 스파이크 알림 후보) |
| cross-app 접근 차단 (path slug ≠ JWT slug) | [`AppSlugVerificationFilter`](../../../common/common-security/src/main/java/com/factory/common/security/AppSlugVerificationFilter.java) | **WARN** | `cross-app access blocked — jwtSlug={}, pathSlug={}, userId={}` — 탈취 토큰 재사용 징후 |
| admin 액션 감사 (`@Audited`/`@AdminOnly`) | [`AuditAspect`](../../../core/core-audit-impl/src/main/java/com/factory/core/audit/impl/AuditAspect.java)`.aroundAudited` | DB (`audit_logs`) | 성공/실패 모두 기록 (ADR-028). 기록 자체가 실패하면 WARN `Audit record failed — action={} actor={} result={}: {}` |

### 1-4. webhook 서명 실패

| 이벤트 | 위치 | 레벨 | 메시지 형식 |
|---|---|---|---|
| Google RTDN push 인증 실패 (Bearer JWT) | [`GoogleWebhookAuthFilter`](../../../core/core-iap-impl/src/main/java/com/factory/core/iap/impl/google/GoogleWebhookAuthFilter.java)`.reject` | WARN | `Google webhook auth rejected — {}` (reason: missing token / kid / audience mismatch / email not allowed / JWT invalid) |
| Apple webhook JWS 서명 실패 | [`AppleJwsVerifier`](../../../core/core-iap-impl/src/main/java/com/factory/core/iap/impl/AppleJwsVerifier.java)`.verifyAndDecode` → `IapException(IAP_001)` — [`IapController`](../../../core/core-billing-impl/src/main/java/com/factory/core/billing/impl/controller/IapController.java)`.appleWebhook` 경로 | **WARN** | `security event — code=IAP_001, path={}` (중앙). 위조 영수증 신호 |
| PortOne webhook 서명·타임스탬프 실패 | [`PaymentController`](../../../core/core-billing-impl/src/main/java/com/factory/core/billing/impl/controller/PaymentController.java)`.webhook` → `BillingException(BIL_008/BIL_009/BIL_010)` | **WARN** | `security event — code=BIL_008|009|010, path={}` (중앙). forged webhook 신호 |

### 1-5. 비밀번호 변경

| 이벤트 | 위치 | 레벨 | 메시지 형식 |
|---|---|---|---|
| 앱 사용자 비밀번호 변경 (성공) | [`AuthServiceImpl`](../../../core/core-auth-impl/src/main/java/com/factory/core/auth/impl/AuthServiceImpl.java)`.changePassword` | INFO | `password changed — userId={}, sessions revoked` |
| 앱 사용자 비밀번호 변경 (실패) | 동일 → `AuthException(ATH_001)` | **WARN** | `security event — code=ATH_001, path=.../auth/password, principal={}` (중앙). 인증된 요청이라 `WHEN_AUTHENTICATED` 조건을 만족 |
| 비밀번호 재설정 완료 | [`PasswordResetService`](../../../core/core-auth-impl/src/main/java/com/factory/core/auth/impl/service/PasswordResetService.java)`.confirmReset` | INFO | `Password reset completed for userId={}` |
| 콘솔 계정 비밀번호 재설정 (타인) | [`AdminAccountsService`](../../../core/core-admin-impl/src/main/java/com/factory/core/admin/impl/AdminAccountsService.java)`.resetPassword` | INFO | `console password reset — actorId={}, targetAdminId={}, targetRole={}` |
| 콘솔 계정 비밀번호 변경 (본인, 성공) | 동일 `.changeOwnPassword` | INFO | `console password changed — adminId={}` |
| 콘솔 계정 비밀번호 변경 (본인, 실패) | 동일 → `AdminAccountException(ADMIN_016)` | **WARN** | `security event — code=ADMIN_016, path=/api/admin/me/password, principal={}` (중앙) |

> **콘솔 계정 액션에 `@Audited` 를 쓰지 않는 이유** — `audit_logs` 테이블은 **앱 슬러그 스키마에만** 있고 admin 스키마에는 없어요. 콘솔 계정 관리 경로(`/api/admin/admins/...`, `/api/admin/me/password`)는 `SlugContext` 가 비어 있어서 `AuditAspect` 를 태우면 `SchemaRoutingDataSource` 가 `IllegalStateException` 을 던지고, `recordSafely` 가 이를 삼켜 `Audit record failed` WARN 만 남아요 — **기록은 안 되는데 감사되는 것처럼 보이는** 상태가 되죠. 기존 `@Audited` 액션(content·payments·users)은 전부 슬러그 스코프라 이 문제를 겪지 않아요. 콘솔 계정 액션의 DB 감사가 필요해지면 admin 스키마용 감사 경로를 먼저 만들어야 해요 (backlog 등재).

### 1-6. rate limit

| 이벤트 | 위치 | 레벨 | 메시지 형식 |
|---|---|---|---|
| 429 rate limit 초과 (HTTP 공통) | [`RateLimitFilter`](../../../common/common-web/src/main/java/com/factory/common/web/ratelimit/RateLimitFilter.java)`.doFilterInternal` | 없음 | — (429 `CMN_429` + `Retry-After`·`X-RateLimit-*` 헤더. Logger 자체가 없는 클래스) |
| 가입 인증코드 발송 한도 초과 | [`EmailPreVerificationService`](../../../core/core-auth-impl/src/main/java/com/factory/core/auth/impl/service/EmailPreVerificationService.java)`.sendCode` | WARN | `send-code rate limit hit for email (window {} sends)` — 이메일 주소는 의도적으로 미기록 |

### 1-7. PII 열람 (reveal)

| 이벤트 | 위치 | 레벨 | 메시지 형식 |
|---|---|---|---|
| 사용자 PII 원본 열람 | [`AdminUsersController`](../../../core/core-admin-impl/src/main/java/com/factory/core/admin/impl/controller/AdminUsersController.java)`.revealUser` → [`AdminUsersService`](../../../core/core-admin-impl/src/main/java/com/factory/core/admin/impl/AdminUsersService.java)`.revealUser` | DB (`user_read_history`) | slf4j 로그 없음. [`UserReadHistoryRepository`](../../../core/core-admin-impl/src/main/java/com/factory/core/admin/impl/repository/UserReadHistoryRepository.java)`.record` 가 슬러그별 schema 에 INSERT — admin_user_id·admin_email·viewed_user_id·resource_type(`USER`)·ip_address·viewed_at |
| 파일 PII 원본 열람 (업로더·IP·기기) | [`AdminFileService`](../../../core/core-admin-impl/src/main/java/com/factory/core/admin/impl/AdminFileService.java) → 동일 repository | DB (`user_read_history`) | resource_type=`FILE`, resource_ref=파일 key |

---

## 2. 정책 — 현재 관행에서 도출

위 인벤토리에서 잘 되고 있는 패턴을 규약으로 승격하고, 무로깅 이벤트에 신규 로그를 추가할 때 따를 기준이에요.

1. **보안 이벤트 실패는 WARN 이상**. [`Observability 규약`](../../api-and-functional/functional/observability.md)의 레벨 가이드("인증 실패·rate limit 초과 = WARN")가 이미 이렇게 규정하고 있고, `GoogleWebhookAuthFilter`·`EmailPreVerificationService`·2FA backup code 계열이 준수 중이에요. DEBUG 로 남기는 건 미출력과 같으므로 (JwtAuthFilter 사례) 보안 이벤트에는 쓰지 않아요.
2. **보안 상태 변화 성공은 INFO**. 2FA enable/disable, backup code 소비, 비밀번호 재설정 완료, 회원 탈퇴가 현행 패턴이에요. 성공도 남기는 이유는 계정 탈취 후 공격자가 하는 행동(2FA 재설정·비밀번호 변경)이 바로 이 이벤트들이기 때문이에요.
3. **메시지 형식은 `<고정 이벤트 구절> — key={}, key={}`**. `2FA enabled — userId={}`, `Google webhook auth rejected — {}` 처럼 검색 가능한 고정 prefix + 구조화 필드가 현행 관행이에요. 고정 구절이 있어야 Loki `|=` 필터가 안정적으로 잡아요.
4. **민감정보·원문 식별자 금지**. 비밀번호·토큰·TOTP 코드 원문은 물론, 이메일 주소도 남기지 않고 `userId` 로 참조해요 (`send-code rate limit hit` 이 이메일을 일부러 뺀 것이 선례). 예외는 운영자가 등록·검증하는 계정 식별자(webhook service account email 등)뿐이에요.
5. **appSlug·requestId 는 수동으로 넣지 않아요**. `AppSlugMdcFilter`/`MdcFilter` 가 MDC 로 자동 부착하고, logback 이 Loki label(`appSlug`)과 메시지의 `[requestId]` 로 승격해요.
6. **일부 이벤트는 의도적으로 메트릭에만 맡겨요.** 익명 401(`CMN_004`·`CMN_007`·`CMN_008`)과 429 rate limit(`CMN_429`·`PHA_005`)은 주체를 특정할 수 없어 남길 정보가 경로뿐이고, 봇 스캔으로 폭증하면 진짜 신호를 덮어요. 이것들은 `http.server.requests` 의 상태 코드와 §4 의 RateLimitSpike 알림이 담당해요. 익명 403 도 같은 이유로 남기지 않아요 — 단 **인증된 주체의 403 은 남겨요**(권한 탐색 징후).

7. **보안 로깅은 중앙에서 해요 — 새 코드는 정책만 선언하면 돼요.** 도메인 예외는 전부 `GlobalExceptionHandler.handleBaseException` 을 지나므로, 개별 서비스 메서드에 `log.warn` 을 넣지 **않아요**. 대신 에러 enum 상수에 정책을 선언해요:

   ```java
   // 3-arg = 보안 이벤트 아님 (기본값 NONE)
   EMAIL_DUPLICATE(409, "ATH_003", "..."),

   // 4-arg = 보안 이벤트
   TOTP_VERIFICATION_FAILED(401, "ATH_007", "...", SecurityEventPolicy.ALWAYS),
   INVALID_CREDENTIALS(401, "ATH_001", "...", SecurityEventPolicy.WHEN_AUTHENTICATED),
   ```

   | 정책 | 언제 |
   |---|---|
   | `ALWAYS` | 익명이어도 남김. 볼륨이 작고 신호 가치가 높은 이벤트 (콘솔 로그인 실패, webhook 서명 실패, 2FA 실패) |
   | `WHEN_AUTHENTICATED` | 인증된 주체가 있을 때만. 같은 코드가 익명·인증 양쪽에서 재사용될 때 (`ATH_001` = 로그인 실패 + 비밀번호 변경 실패) |
   | `NONE` | 남기지 않음 (기본값) |

   **401·403·429 코드는 이 판단을 건너뛸 수 없어요** — `SecurityEventCoverageTest`(bootstrap)가 12개 enum 을 전수 스캔해서, 정책이 선언되지 않았고 제외 목록에도 없으면 빌드를 깨뜨려요. 로깅하지 않기로 했다면 그 테스트의 `INTENTIONALLY_NOT_LOGGED` 에 **근거와 함께** 등재해요.

   Spring Security 필터 체인(`JsonAccessDeniedHandler`·`AppSlugVerificationFilter`)은 `DispatcherServlet` 바깥이라 중앙 핸들러가 닿지 않아요 — 이 2곳만 예외적으로 지점에서 직접 남겨요.

---

## 3. Loki 검색 예시

Loki label 은 `app`(=`spring.application.name`, 본 템플릿은 `app-factory`)·`appSlug`·`env`·`level` 네 개예요 (logback-common.xml 의 loki4j label pattern). 자세한 쿼리 환경은 [`운영 모니터링 셋업 가이드`](../setup/monitoring-setup.md)를 보세요.

아래 쿼리 중 자주 쓰는 것은 **Grafana 대시보드 `Logs Quickview`** 에 패널로 있어요 ([`infra/grafana/dashboards/logs-quickview.json`](../../../infra/grafana/dashboards/logs-quickview.json)) — "보안 이벤트 (전체)" / "권한 거부 · 토큰 오용" / "브루트포스 · 계정 잠금" 세 개예요.

> **로컬에서는 안 보여요.** 관측 스택(Loki·Grafana)은 `docker-compose.observability.yml` 에만 있고 `docker-compose.local.yml` 에는 빠져 있어요 (Mac mini 전용). 게다가 로컬 spring 은 `SPRING_PROFILES_ACTIVE=local` 이라 logback 이 CONSOLE appender 만 붙여서, 관측 스택을 따로 띄워도 로그가 Loki 로 가지 않아요. 로컬에서 보안 로그를 보려면 컨테이너 stdout(`docker compose -f infra/docker-compose.local.yml logs -f spring`)을 보세요.

```text
# 1) 중앙 보안 이벤트 전부 — 코드별 분포를 한 번에
{app="app-factory", env="prod", level="WARN"} |= "security event"

# 2) 특정 코드만 — 콘솔 로그인 실패(credential stuffing 추적)
{app="app-factory", env="prod"} |= "security event" |= "code=ADMIN_001"

# 3) 계정 탈취 후 행동 — 비밀번호 변경 성공/실패를 한 화면에
{app="app-factory", env="prod"} |~ "password changed|code=ATH_001"

# 4) 탈취 토큰 재사용 — cross-app 접근 차단
{app="app-factory", env="prod", level="WARN"} |= "cross-app access blocked"

# 5) 권한 탐색 — 인증된 계정의 반복 403
{app="app-factory", env="prod", level="WARN"} |= "access denied"

# 6) 브루트포스 — 잠금 차단(WARN) + 잠금 발동(INFO)
{app="app-factory", env="prod"} |~ "login blocked|account locked"

# 7) 2FA 이상 징후 — backup code CAS 한도 소진, codes JSON 파손
{app="app-factory", env="prod", level="WARN"} |= "2FA"

# 8) Google webhook 인증 실패 — 반복되면 forged push 또는 설정 drift
{app="app-factory", env="prod"} |= "Google webhook auth rejected"
```

익명 401·429 는 의도적으로 무로깅이라 Loki 로 못 봐요 — `http_server_requests_seconds_count{status="401"|"429"}` 메트릭과 아래 RateLimitSpike 알림이 그 역할을 대신해요 (§2 의 6번).

---

## 4. 알림 룰로 승격할 후보

현재 [`infra/prometheus/rules.yml`](../../../infra/prometheus/rules.yml) 에는 보안 관련으로 RateLimitSpike(429 > 10/분, 3분 지속, severity info)가 이미 있어요. Loki 쪽은 ruler 미구성(`infra/loki/loki-config.yml` 에 ruler 섹션 없음)이라 로그 기반 알림은 현재 불가능하고, 후보는 메트릭 기반과 Loki ruler 도입 후보로 나뉘어요.

| 후보 | 신호 | 근거 |
|---|---|---|
| 401 스파이크 | `http_server_requests_seconds_count{status="401"}` rate 급증 | 앱 로그인 실패는 익명이라 의도적 무로깅 — credential stuffing 을 잡는 신호 (콘솔 로그인 실패는 `code=ADMIN_001` 로그로도 보여요) |
| 403 스파이크 | 동일 메트릭의 `status="403"` | 익명 403 은 무로깅이라 메트릭이 담당 — 인증된 주체의 403 은 `access denied` 로그로 주체까지 특정돼요 |
| 콘솔 로그인 실패 반복 | WARN `code=ADMIN_001` 빈도 (Loki ruler 필요) | 콘솔은 계정 잠금을 타지 않아 시도가 무제한 — 임계 없는 유일한 인증 표면 |
| cross-app 접근 차단 | WARN `cross-app access blocked` 발생 즉시 (Loki ruler 필요) | 정상 클라이언트에서는 발생하지 않음 — 탈취 토큰 재사용 신호 |
| Google webhook 인증 실패 반복 | WARN `Google webhook auth rejected` 빈도 (Loki ruler 필요) | 유일하게 WARN 로그가 있는 webhook 인증 실패 — 반복이면 forged push 시도 |
| backup code CAS 한도 소진 | WARN `2FA backup code CAS 재시도 한도 소진` 발생 즉시 (Loki ruler 필요) | 정상 사용에서 거의 발생 불가 — 동시 재사용 공격 신호 |

알림 종류·임계치 확정은 운영 배포 단계에서 함께 진행해요.

---

## 관련 문서

- [`Observability 규약`](../../api-and-functional/functional/observability.md) — 로그 레벨 가이드·MDC 태깅·알림 임계치의 원본 규약
- [`운영 모니터링 셋업 가이드`](../setup/monitoring-setup.md) — Loki·Grafana 스택 기동과 LogQL 환경
- [`ADR-028 · 감사 로그 도메인`](../../philosophy/adr-028-audit-log-domain.md) — `audit_logs` 설계 근거
- [`OWASP Top 10 매핑`](../setup/owasp-top10-mapping.md) — A09 (Security Logging and Monitoring Failures) 관점의 상위 맵
