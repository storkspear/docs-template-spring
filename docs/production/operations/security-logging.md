# 보안 이벤트 로그 정책

> **유형**: Reference · **독자**: 운영자 (Level 2.5) · **읽는 시간**: ~9분

이 문서는 보안 이벤트(로그인 실패·권한 거부·webhook 서명 실패·rate limit·PII 열람 등)가 현재 코드에서 어떤 레벨·어떤 형식으로 로깅되는지 전수 조사한 인벤토리와, 거기서 도출한 로그 정책이에요. 레벨 일반론은 [`Observability 규약`](../../api-and-functional/functional/observability.md)의 로그 레벨 가이드가 원본이고, 이 문서는 보안 이벤트로 범위를 좁혀 실측 현황을 담아요. backlog 의 "[Security] 보안 이벤트 명시 로그 정책" 항목([`docs/planned/backlog.md`](../../planned/backlog.md))의 산출물입니다.

---

## 1. 현재 실측 인벤토리

아래 표는 코드 grep 실측 결과예요. "레벨 = 없음" 은 그 이벤트가 발생해도 **로그가 한 줄도 남지 않는다**는 뜻이고, 이때 관측 수단은 HTTP 상태 코드 메트릭(`http.server.requests` 의 401/403/429)뿐이에요. 도메인 예외(`BaseException` 계열)는 [`GlobalExceptionHandler`](../../../common/common-web/src/main/java/com/factory/common/web/exception/GlobalExceptionHandler.java)`.handleBaseException` 이 응답으로 변환만 하고 로깅하지 않는 것이 무로깅의 공통 원인입니다 (로깅하는 건 catch-all 의 `log.error("Unhandled exception", e)` 뿐).

### 1-1. 인증 (로그인·토큰)

| 이벤트 | 위치 | 레벨 | 메시지 형식 |
|---|---|---|---|
| 이메일 로그인 실패 (앱 사용자) | [`EmailAuthService`](../../../core/core-auth-impl/src/main/java/com/factory/core/auth/impl/service/EmailAuthService.java)`.signIn` → `AuthException(ATH_001)` | 없음 | — (401 응답만. Logger 필드는 선언돼 있으나 사용처 0) |
| 콘솔 로그인 실패 (운영 콘솔) | [`AdminAuthService`](../../../core/core-admin-impl/src/main/java/com/factory/core/admin/impl/AdminAuthService.java)`.login` → `AdminAuthException(ADMIN_001)` | 없음 | — (401 응답만) |
| JWT 검증 실패 (만료·위조) | [`JwtAuthFilter`](../../../common/common-security/src/main/java/com/factory/common/security/jwt/JwtAuthFilter.java)`.doFilterInternal` | DEBUG | `JWT validation failed: {}` — 운영 root 레벨이 INFO 라 **출력 안 됨** |
| 소셜 로그인 토큰 검증 실패 | [`GoogleSignInService`](../../../core/core-auth-impl/src/main/java/com/factory/core/auth/impl/service/GoogleSignInService.java) 등 provider 별 service | WARN | 예: `Google token aud mismatch: allowed={}, actual={}` |
| 회원 탈퇴 | [`WithdrawService`](../../../core/core-auth-impl/src/main/java/com/factory/core/auth/impl/service/WithdrawService.java)`.withdraw` | INFO | `User {} withdrew. Reason: {}` / `User {} withdrew. No reason provided.` |

### 1-2. 2FA TOTP ([`TwoFactorService`](../../../core/core-auth-impl/src/main/java/com/factory/core/auth/impl/totp/TwoFactorService.java))

| 이벤트 | 위치 | 레벨 | 메시지 형식 |
|---|---|---|---|
| TOTP 코드 검증 실패 (2단계 로그인·disable·setup verify) | `loginWith2fa` / `disable` / `verifyAndEnable` → `AuthException(ATH_007)` | 없음 | — (401 응답만) |
| 2FA 활성화 성공 | `verifyAndEnable` | INFO | `2FA enabled — userId={}` |
| 2FA 비활성화 성공 | `disable` | INFO | `2FA disabled — userId={}` |
| backup code 1개 소비 (소진 추적) | `tryConsumeBackupCode` | INFO | `2FA backup code consumed — userId={}, remaining={}` — `remaining=0` 이 소진 시점 |
| backup code CAS 재시도 한도 소진 | `tryConsumeBackupCode` | WARN | `2FA backup code CAS 재시도 한도 소진 — userId={}` |
| backup codes JSON 파손 | `deserializeCodes` | WARN | `backup codes deserialize fail — treating as empty: {}` |

### 1-3. 권한 거부 (RBAC)

| 이벤트 | 위치 | 레벨 | 메시지 형식 |
|---|---|---|---|
| 인가 실패 403 (PERM_* 권한 부족) | [`JsonAccessDeniedHandler`](../../../common/common-security/src/main/java/com/factory/common/security/JsonAccessDeniedHandler.java)`.handle` ([`SecurityConfig`](../../../common/common-security/src/main/java/com/factory/common/security/SecurityConfig.java) 가 등록) | 없음 | — (403 `CMN_005` JSON 응답만) |
| 인증 실패 401 진입점 | [`JsonAuthenticationEntryPoint`](../../../common/common-security/src/main/java/com/factory/common/security/JsonAuthenticationEntryPoint.java)`.commence` | 없음 | — (401 `CMN_004`/`CMN_007`/`CMN_008` JSON 응답만) |
| cross-app 접근 차단 (path slug ≠ JWT slug) | [`AppSlugVerificationFilter`](../../../common/common-security/src/main/java/com/factory/common/security/AppSlugVerificationFilter.java) | 없음 | — (403 응답 직접 커밋) |
| admin 액션 감사 (`@Audited`/`@AdminOnly`) | [`AuditAspect`](../../../core/core-audit-impl/src/main/java/com/factory/core/audit/impl/AuditAspect.java)`.aroundAudited` | DB (`audit_logs`) | 성공/실패 모두 기록 (ADR-028). 기록 자체가 실패하면 WARN `Audit record failed — action={} actor={} result={}: {}` |

### 1-4. webhook 서명 실패

| 이벤트 | 위치 | 레벨 | 메시지 형식 |
|---|---|---|---|
| Google RTDN push 인증 실패 (Bearer JWT) | [`GoogleWebhookAuthFilter`](../../../core/core-iap-impl/src/main/java/com/factory/core/iap/impl/google/GoogleWebhookAuthFilter.java)`.reject` | WARN | `Google webhook auth rejected — {}` (reason: missing token / kid / audience mismatch / email not allowed / JWT invalid) |
| Apple webhook JWS 서명 실패 | [`AppleJwsVerifier`](../../../core/core-iap-impl/src/main/java/com/factory/core/iap/impl/AppleJwsVerifier.java)`.verifyAndDecode` → `IapException(IAP_001)` — [`IapController`](../../../core/core-billing-impl/src/main/java/com/factory/core/billing/impl/controller/IapController.java)`.appleWebhook` 경로 | 없음 | — (400 응답만. reason 은 응답 details 로만 나감) |
| PortOne webhook 서명·타임스탬프 실패 | [`PaymentController`](../../../core/core-billing-impl/src/main/java/com/factory/core/billing/impl/controller/PaymentController.java)`.webhook` → `BillingException(BIL_008/BIL_009/BIL_010)` | 없음 | — (401/400 응답만) |

### 1-5. 비밀번호 변경

| 이벤트 | 위치 | 레벨 | 메시지 형식 |
|---|---|---|---|
| 앱 사용자 비밀번호 변경 (성공·실패) | [`AuthServiceImpl`](../../../core/core-auth-impl/src/main/java/com/factory/core/auth/impl/AuthServiceImpl.java)`.changePassword` | 없음 | — (실패 `ATH_001` 401. 성공 시 전 세션 무효화하지만 무로깅) |
| 비밀번호 재설정 완료 | [`PasswordResetService`](../../../core/core-auth-impl/src/main/java/com/factory/core/auth/impl/service/PasswordResetService.java)`.confirmReset` | INFO | `Password reset completed for userId={}` |
| 콘솔 계정 비밀번호 변경·재설정 | [`AdminAccountsService`](../../../core/core-admin-impl/src/main/java/com/factory/core/admin/impl/AdminAccountsService.java)`.changeOwnPassword` / `.resetPassword` | 없음 | — slf4j 로그 없음. `@Audited`/`@AdminOnly` 도 미부착이라 **`audit_logs` 에도 안 남음** |

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
6. **무로깅 이벤트의 현재 관측 수단은 메트릭뿐**임을 인지하고 운영해요. 로그인 실패·403·429·Apple/PortOne webhook 서명 실패는 로그가 없으므로 `http.server.requests` 의 상태 코드(401/403/429)로만 보여요. 이 이벤트들에 로그를 추가하는 작업은 backlog 의 보안 로그 정책 항목 범위이고, 추가할 때 위 1~5번 형식을 따라요.

---

## 3. Loki 검색 예시

Loki label 은 `app`(=`spring.application.name`, 본 템플릿은 `app-factory`)·`appSlug`·`env`·`level` 네 개예요 (logback-common.xml 의 loki4j label pattern). 자세한 쿼리 환경은 [`운영 모니터링 셋업 가이드`](../setup/monitoring-setup.md)를 보세요.

```text
# 1) 2FA 이상 징후 — backup code CAS 한도 소진, codes JSON 파손 (WARN 만)
{app="app-factory", env="prod", level="WARN"} |= "2FA"

# 2) Google webhook 인증 실패 — 반복되면 forged push 또는 설정 drift
{app="app-factory", env="prod"} |= "Google webhook auth rejected"

# 3) 가입 인증코드 발송 한도 초과 — 이메일 폭탄 시도 추적
{app="app-factory", env="prod", level="WARN"} |= "send-code rate limit hit"
```

429 자체는 무로깅이라 Loki 로 못 봐요 — `http_server_requests_seconds_count{status="429"}` 메트릭과 아래 RateLimitSpike 알림이 그 역할을 대신해요.

---

## 4. 알림 룰로 승격할 후보

현재 [`infra/prometheus/rules.yml`](../../../infra/prometheus/rules.yml) 에는 보안 관련으로 RateLimitSpike(429 > 10/분, 3분 지속, severity info)가 이미 있어요. Loki 쪽은 ruler 미구성(`infra/loki/loki-config.yml` 에 ruler 섹션 없음)이라 로그 기반 알림은 현재 불가능하고, 후보는 메트릭 기반과 Loki ruler 도입 후보로 나뉘어요.

| 후보 | 신호 | 근거 |
|---|---|---|
| 401 스파이크 | `http_server_requests_seconds_count{status="401"}` rate 급증 | 로그인 실패가 무로깅이라 credential stuffing 을 지금 잡을 수 있는 유일한 신호 |
| 403 스파이크 | 동일 메트릭의 `status="403"` | 권한 거부도 무로깅 — 콘솔 계정 탈취 후 권한 탐색(privilege probing) 징후 |
| Google webhook 인증 실패 반복 | WARN `Google webhook auth rejected` 빈도 (Loki ruler 필요) | 유일하게 WARN 로그가 있는 webhook 인증 실패 — 반복이면 forged push 시도 |
| backup code CAS 한도 소진 | WARN `2FA backup code CAS 재시도 한도 소진` 발생 즉시 (Loki ruler 필요) | 정상 사용에서 거의 발생 불가 — 동시 재사용 공격 신호 |

알림 종류·임계치 확정은 backlog Item Ops-1 과 묶어 진행해요.

---

## 관련 문서

- [`Observability 규약`](../../api-and-functional/functional/observability.md) — 로그 레벨 가이드·MDC 태깅·알림 임계치의 원본 규약
- [`운영 모니터링 셋업 가이드`](../setup/monitoring-setup.md) — Loki·Grafana 스택 기동과 LogQL 환경
- [`ADR-028 · 감사 로그 도메인`](../../philosophy/adr-028-audit-log-domain.md) — `audit_logs` 설계 근거
- [`OWASP Top 10 매핑`](../setup/owasp-top10-mapping.md) — A09 (Security Logging and Monitoring Failures) 관점의 상위 맵
