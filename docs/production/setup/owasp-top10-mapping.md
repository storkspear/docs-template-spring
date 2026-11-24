# OWASP Top 10 (2021) 매핑

> **유형**: Reference · **독자**: Level 2~3 · **읽는 시간**: ~15분

template-spring 의 보안 베이스라인을 OWASP Top 10 2021 의 10 카테고리에 매핑해요. 각 카테고리마다 **현 방어**(file:line), **검증**(테스트 위치), **Gap**(빠진 부분) 을 정리합니다.

**용도**:
- 외부 보안 감사·B2B 클로징·규제 대응 시 즉시 답변하는 reference
- 신규 입사자가 본 프로젝트의 보안 사고관을 빠르게 파악
- 분기별 self-audit — gap 항목을 보안 후속 작업으로 등재해요

**분류 기준**은 OWASP Top 10 2021이에요. 이 문서는 해당 분류에 현재 구현과 남은 제한을 연결하는 기술 점검 자료예요. 특정 규정 준수나 외부 감사 통과를 보장하는 자료로 사용하지 않아요.

---

<a id="a01--broken-access-control-권한-검사-누락"></a>

## A01 — Broken Access Control (권한 검사 누락)

**현 방어**:
- `common/common-security/.../SecurityConfig.java:178-179` — `anyRequest().authenticated()` 정책. 새 endpoint 는 `ApiEndpoints.Auth.PUBLIC_PATTERNS` 에 명시하지 않으면 자동으로 보호됩니다
- `common/common-security/.../AppSlugVerificationFilter.java:54-68` — JWT 의 `appSlug` claim 과 URL path slug 가 불일치하면 403. cross-tenant 데이터 접근을 차단합니다
- `common/common-security/.../AdminOnly.java:39` — `@PreAuthorize("hasRole('ADMIN')")` meta annotation. 미인증 401, 권한 없으면 403
- `core/core-audit-impl/.../AuditAspect.java:56-98` — `@AdminOnly`·`@Audited` 메서드를 자동으로 가로채 audit log 를 기록합니다
- `common/common-security/.../CurrentUserArgumentResolver.java:26-42` — `@CurrentUser` resolver 가 SecurityContext 에서 `AuthenticatedUser` 를 주입합니다

**검증**:
- `common/common-security/.../AppSlugVerificationFilterTest.java` — slug 불일치 시 403
- `common/common-security/.../AdminOnlyTest.java` — 권한 검증
- `core/core-audit-impl/.../AuditAspectTest.java` — admin 액션 기록

**Gap**:
- **Row-level 권한 검증 자동화 부재** — "user A 의 profile 을 user B 가 열람" 같은 시나리오는 Service 에서 수동으로 검사해요. canonical pattern 이 없어요 (예: `@SubscriptionOwner` 같은 annotation)
- **Cross-tenant 접근 edge case 테스트 커버리지 제한** — 미인증 요청이나 공개 endpoint 에서는 slug 검증이 skip 됩니다. 정상 동작이지만 테스트 케이스를 보강할 여지가 있어요

---

<a id="a02--cryptographic-failures-암호화-실패"></a>

## A02 — Cryptographic Failures (암호화 실패)

**현 방어**:
- `common/common-security/.../jwt/JwtService.java:110` — HS256 (`Jwts.SIG.HS256`) JWT 서명
- `common/common-security/.../jwt/JwtProperties.java:20-22` — secret 길이가 32자 미만이면 `IllegalArgumentException`
- `bootstrap/.../application-prod.yml:83` — `app.jwt.secret: ${JWT_SECRET}` (기본값 없음, 환경변수 필수)
- `common/common-security/.../PasswordHasher.java:12-13` — BCrypt strength 12 (~200~300ms/hash)
- `core/core-auth-impl/.../service/TokenGenerator.java:52-64` — `sha256Hex()` 로 refresh·verification·reset 토큰을 모두 SHA-256 해시로 저장 (raw 미저장)
- TOTP secret은 서버가 검증에 사용할 수 있어야 하지만, 현재 DB에는 평문으로 저장돼요. 이는 방어 항목이 아니라 저장 시 암호화와 접근 권한을 추가 검토할 제한이에요. 클라이언트 저장소 암호화가 서버 DB의 평문 저장을 보호하지는 않아요.
- `core/core-auth-impl/.../totp/TwoFactorService.java` — backup code 8개를 BCrypt 해시 후 `List<String>` JSON 으로 `users.totp_backup_codes` 에 저장 (raw 는 발급 응답 1회만)
- `.gitignore:26-58` — `.env`, `.env.*`, `.kamal/secrets` 제외
- `.gitleaks.toml` — gitleaks default rule + allowlist (테스트 fixture, .env.example 등)

**검증**:
- `common/common-security/.../jwt/JwtPropertiesTest.java` — secret < 32 chars 검증
- `common/common-security/.../jwt/JwtServiceTest.java` — HS256 서명 검증
- `common/common-security/.../PasswordHasherTest.java` — BCrypt 해싱 + 검증

**Gap**:
- **TLS 내부 통신 정책 미명시** — `application.yml` 에 `server.ssl.*` 가 없어요. Cloudflare edge 에서 종료하는 전제이지만 backend ↔ Supabase 간 `sslmode=require` 명시 검증이 빠져 있어요
- **Key rotation 자동화 없음** — `docs/production/setup/key-rotation.md` 가 수동 절차만 기술합니다. 6개월 주기 자동 reminder 가 없어요

---

<a id="a03--injection-sqlnosqlos-injection"></a>

## A03 — Injection (SQL/NoSQL/OS injection)

**현 방어**:
- 앱 도메인은 Spring Data JPA의 파라미터 바인딩을 사용하고, 운영 콘솔에는 `JdbcTemplate` 조회도 있어요. 값은 바인딩하고 동적으로 조합하는 schema·필드·정렬 식별자는 허용 목록으로 제한하는지 각각 확인해요.
- `core/core-auth-impl/.../repository/AuthRefreshTokenRepository.java:25-38` — `@Query` JPQL UPDATE 도 named parameter 만 사용합니다
- Flyway migration (`core/core-*-impl/.../db/migration/`) — 모든 V 파일이 정적 DDL/DML. 동적 SQL 이 없어요
- `common/common-persistence/.../QueryDslPredicateBuilder.java` — 동적 조건 빌더가 `field_op` 형식의 operator 화이트리스트만 허용합니다 (`eq`, `ne`, `like`, `startsWith`, `endsWith`, `gt`, `gte`, `lt`, `lte`, `in`, `notIn`, `between`, `isNull`, `isNotNull`, `empty`). 화이트리스트 밖 입력은 거부되어 임의 SQL 삽입을 차단합니다
- Shell script (`tools/app/new-app.sh`, `tools/deploy/migrate-prod.sh`) — DB 작업이 `psql -f <file.sql>` 형태. user 입력은 schema name (alphanumeric + hyphen) 으로 제한됩니다

**검증**:
- Repository test 가 JPA parameter binding 을 암묵적으로 검증
- ArchUnit r22는 Mapper 클래스 사용을 제한하는 구조 규칙이에요. JDBC·native SQL의 주입 취약점까지 자동으로 검사하는 규칙은 아니에요.

**Gap**:
- **OS injection 검증 (shell script)** — `migrate-prod.sh` 의 환경변수 quoting 방어가 명시되어 있지 않아요. 현재는 정적 SQL 만 실행해서 저위험입니다
- **동적 SQL 가이드 부재** — 향후 raw query 가 필요할 때 어떤 패턴을 권장하는지 convention 이 없어요. `QueryDslPredicateBuilder` 만 있어요
- **Flyway 동적 SQL 금지 자동 강제 없음** — 모든 마이그레이션이 정적이지만 CI rule 로 강제하지는 않아요

---

<a id="a04--insecure-design-설계-자체가-취약"></a>

## A04 — Insecure Design (설계 자체가 취약)

**현 방어**:
- `BootstrapArchitectureTest`는 core-impl 사이의 직접 의존과 cross-app 의존 등 구조 규칙을 검사해요. 번호는 r22까지 있지만 r12는 예약돼 있어 현재 활성 규칙은 21개예요.
- `common/common-web/.../exception/GlobalExceptionHandler.java:154-161` — fallback handler 가 stacktrace 를 노출하지 않아요. 클라이언트엔 generic message 만 갑니다
- `core/core-auth-api/.../exception/AuthError.java:17-18` — `INVALID_CREDENTIALS (ATH_001)` "이메일 또는 비밀번호가 올바르지 않습니다" — **열거 공격 방지** (어느 필드가 틀렸는지 구분하지 않음)
- `common/common-web/.../ratelimit/RateLimitFilter.java:48-72` — `SENSITIVE_SUFFIXES` set 으로 auth 민감 endpoint 를 분리. prod 기준 strict 10rpm / default 60rpm
- `common/common-security/.../AppSlugVerificationFilter.java` — schema-per-app 멀티테넌시 격리

**검증**:
- `common/common-web/.../GlobalExceptionHandlerTest.java` — generic message 응답 검증
- `common/common-web/.../ratelimit/RateLimitFilterTest.java` — sensitive vs default 적용
- `BootstrapArchitectureTest` — 빌드 시점 자동 실행

**Gap**:
- **404 vs 500 convention 명시 부족** — 리소스 없을 때 `CommonError.NOT_FOUND (CMN_002)` 를 쓴다는 규약이 `exception-handling.md` 에 명시되어 있지만, service 레이어에서 `IllegalArgumentException` 같은 generic 예외를 던지는 케이스가 있을 수 있어요. 검사 자동화가 없어요
- **API 호환성 검토** — URL 버전을 도입하지 않는 결정은 ADR-008에 있고, breaking change·deprecation·migration 절차는 버전 규약에 있어요. 이 절차를 지켰는지와 실제 소비자 호환성을 변경별로 확인해야 해요.

---

<a id="a05--security-misconfiguration-디폴트-설정-노출"></a>

## A05 — Security Misconfiguration (디폴트 설정 노출)

**현 방어**:
- `bootstrap/.../application.yml:36-37` — `management.endpoints.web.exposure.include: health,info,prometheus` (env, beans, heapdump 등 제외)
- `bootstrap/.../application-prod.yml:44-48` — prod 도 동일 정책 (override 없음)
- `application.yml:40` — `management.endpoint.health.show-details: never` (health 최소 정보)
- `GlobalExceptionHandler.java:154-161` — fallback 시 stacktrace 비노출
- `bootstrap/.../application.yml:15-25` — `spring.web.error.*` 로 `include-stacktrace` · `include-message` · `include-binding-errors` 를 `never`, `include-exception` 을 `false` 로 전 프로파일 고정 (Spring Boot 4 에서 `server.error.*` 는 바인딩되지 않아요)
- `application-prod.yml` 모든 민감값 `${ENV_VAR}` 플레이스홀더

**검증**:
- 운영 함정 6개 (`README.md`) + dogfood-pitfalls 15개 — 설정 실수 케이스 정리

**해결됨 (prod 한정)**:
- **✅ Swagger UI prod 비활성** (resolved) — `application-prod.yml:55-59` 가 `springdoc.swagger-ui.enabled: false` + `springdoc.api-docs.enabled: false` 를 적용합니다. prod 는 `/swagger-ui.html` · `/v3/api-docs` 가 404 예요. 반면 dev 는 **기본 활성** 입니다 — `application-dev.yml:30-34` 가 `${SPRINGDOC_SWAGGER_UI_ENABLED:true}` / `${SPRINGDOC_API_DOCS_ENABLED:true}` 라, dev-server 를 Cloudflare tunnel 로 외부에 노출한다면 두 환경변수를 `false` 로 줘서 꺼야 해요. 프로파일 없이 띄우는 로컬 default (`application.yml`) 도 swagger 가 활성이에요

**Gap (남은 항목)**:
- **CORS 미설정 가이드 부재** — 의도적 결정이에요 (모바일 전제). 단 파생 레포가 브라우저 client 를 추가할 때 자동 안내가 없어요
- **초기 계정 관리** — `--seed-admin`은 이름과 달리 앱의 일반 사용자 계정을 V007로 넣는 옵션이에요. 콘솔 관리자 계정과 구분해요. 초기 비밀번호의 교체·전달·보관 정책은 각 계정 생성 경로에서 확인해야 해요.
- **`/actuator/info` 정보 노출** — `permitAll` + `app.dogfood.message` 등 버전 정보를 공개해요. 공격자의 fingerprinting 을 보조할 수 있어요

---

<a id="a06--vulnerable-and-outdated-components-의존성-cve"></a>

## A06 — Vulnerable and Outdated Components (의존성 CVE)

**현 방어**:
- `gradle/libs.versions.toml` — 중앙 버전 카탈로그. Spring Boot 4.1.0, JJWT 0.13.0, Firebase 9.8.0, Testcontainers 2.0.5 등 모두 명시됩니다
- `.github/workflows/ci.yml` — OWASP Dependency Check (`dependencyCheckAggregate`) 를 매 CI 마다 실행합니다. task 는 `failBuildOnCVSS=7.0` 이지만 CI step 은 `continue-on-error` 라 non-blocking — 결과는 step 로그로 남고, 조치는 분기 audit 에서 해요
- `.gitleaks.toml` — secret 누출 검사. default rule + 테스트 fixture allowlist

**프로젝트 정책**:
- **Dependabot 미사용** — PR 노이즈와 관리 부담의 trade-off 를 평가한 뒤 미채택을 결정했어요. 의존성 update 는 별도 자동화 도구 (Renovate / OWASP Dependency Check) 또는 분기 manual review 로 대체할 예정이에요 (backlog 등재)

**검증**:
- `tools/verify/ci-test.sh` 의 secret stage (gitleaks 실행)

**Gap**:
- **CVE 스캔이 non-blocking** — ci.yml 의 OWASP Dependency Check 가 `continue-on-error` 라 critical/high CVE 가 떠도 CI 를 막지 않아요. 발견 후 조치는 운영자의 분기 audit 몫이에요
- **자동 update PR 부재** (Dependabot 미사용) — 의존성 버전 갱신이 manual 이에요. 분기별 audit cycle 설정이 필요해요
- **CVE 자동 차단 정책 없음** — task 레벨 `failBuildOnCVSS=7.0` 이 있지만 CI 가 실패를 무시하므로, blocking 전환 기준이 없어요
- **Gradle dependency verification 미구성** — `org.gradle.dependency-verification` 으로 jar checksum 을 lock 하지 않아요. Maven central 에서 받은 의존성의 무결성 검증이 없어요
- **License 검증 부재** — GPL/AGPL 같은 회피 license 의 자동 감지가 없어요

---

<a id="a07--identification-and-authentication-failures-인증-실패"></a>

## A07 — Identification and Authentication Failures (인증 실패)

**현 방어**:
- `common/common-web/.../security/PasswordValidator.java:23-106` — 최소 10자, 대문자+소문자+숫자 필수, 특수문자 선택. 흔한 비밀번호 블랙리스트 (`common-passwords.txt`). BCrypt max 72 byte 강제
- `core/core-auth-impl/.../totp/{TotpService,TwoFactorService}.java` — RFC 6238 TOTP. HMAC-SHA1, 30초 window, 6자리, ±1 window (90초). Backup codes 8개 BCrypt 저장. opt-in 활성화. 임시 토큰 (`type="2fa_pending"`, 5분 TTL)
- `core/core-auth-impl/.../entity/AuthRefreshToken.java:1-143` — refresh token rotation + replay 감지
  - `familyId` 추적
  - `usedAt` 플래그로 재사용 탐지 (탈취 판정 → family 전체 무효화)
  - `revokedAt` 명시 무효화
  - SHA-256 해시만 저장
- `AuthError.INVALID_CREDENTIALS (ATH_001)` — 이메일·비밀번호 중 어느 것이 틀렸는지 노출하지 않아요 (열거 공격 방지)
- Session 부재 (stateless JWT) — session fixation 자동 차단
- Rate limit (sensitive 10rpm) — brute-force 보조 방어

**검증**:
- `PasswordValidatorTest` (길이·복잡도·블랙리스트)
- `TotpServiceTest` (RFC 6238 test vectors)
- `RefreshTokenServiceTest` (rotation + family tracking)
- Rate limit 단위 + 통합 테스트

**Gap**:
- **계정 잠금은 구현돼 있어요.** 앱 로그인과 콘솔 로그인에 공유 `LockoutProperties`를 적용해요. 기본값은 실패 누적 윈도우 6시간, 5회 실패 시 최초 15분 잠금, 최대 24시간이에요. 운영 설정과 사용자 안내가 이 정책에 맞는지 점검해요.
- **이메일 코드 시도 제한도 구현돼 있어요.** 가입 전 검증·가입 후 검증·비밀번호 재설정의 만료·사용 여부·시도 횟수 검사를 확인해요. 세 서비스의 동시성 처리까지 같지는 않으므로 온라인 시도 제한과 오프라인 코드 추측 위험을 구분해요. 숫자 6자리 코드의 단순 SHA-256은 DB 유출 시 전체 경우의 수 대입을 막지 못해요.
- **2FA 의무화 정책 없음** — admin role 사용자에게 2FA 를 강제하는 정책이 없어요
- **모든 2FA 수단을 잃은 경우의 복구** — 인증된 사용자가 비밀번호와 코드로 다시 확인한 뒤 백업코드를 재발급하는 endpoint는 있어요. 로그인에 필요한 모든 수단을 잃은 사용자의 본인 확인·복구 절차는 별도로 정해야 해요.

---

<a id="a08--software-and-data-integrity-failures-서명-미검증"></a>

## A08 — Software and Data Integrity Failures (서명 미검증)

**현 방어**:
- `core/core-iap-impl/.../AppleJwsVerifier.java:1-227` — Apple JWS 검증. ES256 (SHA256withECDSA) 서명 + X.509 cert chain (Apple Root CA G3, classpath embedded `apple-root-ca-g3.cer`)
- `core/core-auth-impl/.../service/GoogleSignInService.java:117-156` — Google id token 을 Google `/tokeninfo` endpoint 에 위임 검증 (RS256 + aud/iss/exp 를 Google 측에서 처리)
- `core/core-iap-impl/.../google/GoogleJwksClient.java:1-101` — Google webhook Bearer JWT 검증. JWKS 캐시 1시간. 4 단계 (RS256 서명 / audience / email service account allowlist / exp). ADR-032 참조
- `tools/deploy/migrate-prod.sh` — Flyway migration checksum 사전 등록 (Flyway 의 ChecksumCalculator 와 동일한 줄 단위 CRC32 누적 — 부호 있는 32비트). 부팅 시 VALIDATE_ONLY 모드로 재검증
- `.github/workflows/deploy.yml` — Docker image `:${sha}` 태그 (commit SHA 추적)
- Kamal `--skip-push` — GHA deploy job 이 빌드·push 한 이미지를 그대로 사용, kamal 자체 재빌드 금지

**검증**:
- `AppleJwsVerifierTest` (cert chain + ES256)
- `GoogleWebhookAuthFilterTest` (Bearer JWT)
- `AppleSignInServiceTest`, `GoogleSignInServiceTest`
- WireMock fixtures: `apple-server-notification-v2.json`, `google-rtdn-pubsub.json`

**Gap**:
- **이미지 서명은 구현돼 있지만 항상 강제되지는 않아요.** GHA deploy·deploy-dev는 digest에 cosign OIDC keyless 서명을 남겨요. 서명 단계가 `continue-on-error`라 실패해도 배포는 계속돼요. 로컬 배포에는 개인 키 서명 opt-in이 있고, rollback 검증은 `cosign.pub`가 있을 때 활성화돼요. `--no-verify` 우회도 있으므로 서명 생성·검증·강제 범위를 구분해요.
- **Gradle dependency verification 미구성** — A06 와 동일한 무결성 gap

---

<a id="a09--security-logging-and-monitoring-failures-로그모니터링-부재"></a>

## A09 — Security Logging and Monitoring Failures (로그/모니터링 부재)

**현 방어**:
- `core/core-audit-impl/.../AuditAspect.java:45-59` — `@Audited`·`@AdminOnly` AOP. `Propagation.REQUIRES_NEW` 로 비즈 rollback 과 무관하게 audit 를 보존합니다. SUCCESS / FAILURE 분기. `audit_logs` 테이블 (JSONB details, IP, resource)
- `common/common-logging/.../MdcFilter.java` — request id + appSlug MDC 주입 → Loki label 승격
- `common/common-security/.../AppSlugMdcFilter.java` — slug 별 MDC 분리
- `common/common-web/.../metrics/AppSlugObservationConvention.java` — Micrometer `http.server.requests` 에 `app=<slug>` 라벨
- Prometheus metrics (Bucket4j rate limit, JVM, DB pool)
- Loki + logback (loki4j) JSON 로그
- `docs/api-and-functional/functional/observability.md:56-81` — 환경별 로그 레벨 가이드 (ERROR/WARN/INFO/DEBUG)
- 민감 정보 마스킹 정책 (`observability.md:65`) — password, token, JWT secret 은 절대 로그하지 않아요

**검증**:
- `AuditAspectTest` (success/failure, actor resolution, slug context)
- `AppSlugMdcFilterTest`, `AppSlugObservationConventionTest`
- `ObservabilityIntegrationTest` — 실제 로그 출력 검증

**Gap**:
- **보안 로그와 앱 감사 기록은 구현돼 있어요.** 중앙 예외 처리의 보안 이벤트 정책과 콘솔 계정 보안 로그는 [보안 로깅](../operations/security-logging.md)에서 관리해요. 앱별 감사 조회는 `/api/admin/audit-logs?slug=<slug>`로 제공해요. 콘솔 계정 변경을 앱 `audit_logs`에 자동으로 기록하는 것까지 구현된 것은 아니에요.
- **보안 이벤트별 알림은 추가 설계가 필요해요.** 현재 활성 Prometheus 규칙은 `HighErrorRate`·`HighLatencyP95`·`RateLimitSpike`·`BackendDown`·`MinioMonitoringDisabled` 다섯 개예요. 마지막 규칙은 모니터링 신호 부재를 알리는 info 수준이고, MinIO 장애·디스크 규칙은 주석 상태예요. 로그인 실패·webhook 서명 실패별 경보와 대응 기준은 별도로 정해요.
- **Entity 변경 전후 값의 감사 범위는 확인이 필요해요.** 모든 필드 변경을 `@PreUpdate`로 자동 추적하지는 않아요.
- **Loki 보관 설정은 8760시간이에요.** 설정만으로 실제 보관 기간·저장 공간·규정 준수까지 보장되지는 않아요. 저장소와 운영 정책을 함께 점검해요.

---

<a id="a10--ssrf-서버측-요청-위조"></a>

## A10 — SSRF (서버측 요청 위조)

**현 방어**:

외부 HTTP 호출 위치 + URL 결정 방식:

| # | 호출 | 파일 (상수) | URL |
|---|---|---|---|
| 1 | Apple JWKS | `AppleJwksClient.DEFAULT_JWKS_URL` | 고정: `https://appleid.apple.com/auth/keys` |
| 2 | Google tokeninfo | `GoogleSignInService.DEFAULT_TOKENINFO_URL` | 고정: `https://oauth2.googleapis.com/tokeninfo` |
| 3 | Google JWKS (webhook) | `GoogleJwksClient.DEFAULT_JWKS_URL` | 고정: `https://www.googleapis.com/oauth2/v3/certs` |
| 4 | Kakao token info / user me | `KakaoSignInService.DEFAULT_TOKEN_INFO_URL` · `DEFAULT_USER_ME_URL` | 고정: `https://kapi.kakao.com/v1/user/access_token_info`, `https://kapi.kakao.com/v2/user/me` |
| 5 | Naver user info | `NaverSignInService.DEFAULT_USER_ME_URL` | 고정: `https://openapi.naver.com/v1/nid/me` |
| 6 | FCM 푸시 | Firebase Admin SDK | SDK 내부 관리 |
| 7 | Resend 이메일 | `ResendEmailAdapter.RESEND_API_URL` | 고정: `https://api.resend.com/emails` |
| 8 | MinIO 스토리지 | MinIO SDK | `APP_STORAGE_MINIO_ENDPOINT` (환경 설정) |

위 표는 auth·email·storage 경로의 핵심 호출만 추렸어요. IAP·PortOne·OAuth 토큰 갱신을 포함한 13곳 전체 인벤토리는 [`ADR-036`](../../philosophy/adr-036-ssrf-url-whitelist.md) 에 있어요. **모든 URL 이 hardcode 또는 운영자 설정값** 이고, 사용자 입력으로 URL 이 결정되는 지점은 없어요.

**Timeout**:
- AppleJwksClient: connect 5s
- GoogleSignInService: connect 5s, request 10s
- KakaoSignInService: connect 5s, request 10s
- NaverSignInService: connect 5s, request 10s
- GoogleJwksClient: connect 5s
- ResendEmailAdapter: connect 5s, read 10s

**Redirect**: auth·webhook client 는 `java.net.http.HttpClient.newBuilder()` 의 기본값(`NORMAL` 미만 = redirect 자동 추종 안 함)을 그대로 써서 SSRF 위험을 추가로 차단합니다. Resend 만 docker 환경의 비동기 DNS 이슈 때문에 `HttpURLConnection` 을 쓰는데, URL 이 고정 상수라 redirect 표면은 동일하게 좁아요.

**검증**:
- `AppleJwksClient`, `GoogleSignInService`, `KakaoSignInService`, `NaverSignInService`, `GoogleWebhookAuthFilter` 모두 WireMock IT
- `ResendEmailAdapter` 테스트 (HTTP spy)

**해결됨**:
- **✅ URL whitelist 정책 ADR-036 작성됨** (resolved) — [`ADR-036 · SSRF URL whitelist 정책`](../../philosophy/adr-036-ssrf-url-whitelist.md) 이 4 가이드라인 (host/path hardcode, connectTimeout 5s, request timeout 10s, no auto-redirect) + 13 호출 인벤토리를 명문화했어요
- **✅ Resend connectTimeout 명시** (resolved) — `ResendEmailAdapter` 에 `connectTimeout 5s` + `readTimeout 10s` 를 적용해 다른 client 와 동일한 baseline 을 맞췄어요

**Gap (남은 항목)**:
- **MinIO endpoint 검증 부재** — `APP_STORAGE_MINIO_ENDPOINT` 가 admin 통제이지만 도메인 검증이 없어요. `http://internal-server:9000` 같은 내부 주소를 설정할 수 있어요 (실수 케이스)
- **내부 주소 접근 정책** — MinIO는 의도적으로 NAS·내부 endpoint를 사용할 수 있어 private IP를 일괄 차단할 수는 없어요. 운영자가 설정하는 주소와 사용자 입력으로 정해지는 주소를 구분하고, 필요한 내부 목적지만 허용하는 정책을 검토해요.
- **DNS rebinding 방어 없음** — TOCTOU 취약점 mitigation 이 없어요 (매우 낮은 확률)

---

<a id="종합--gap-우선순위"></a>

## 종합 — Gap 우선순위

앞 절의 구현 여부와 남은 검토를 구분해요. 우선순위는 실제 운영 요구와 위험 평가에 따라 정하며, 아래 구분만으로 구현 기한을 확정하지 않아요.

<a id="즉시-fix--모두-해결됨-"></a>

### 즉시 fix — 모두 해결됨 ✅

이 제목은 기존 링크를 위해 유지해요. prod 기본 설정의 Swagger·OpenAPI 비활성화와 Resend timeout은 반영돼 있어요. 더 높은 우선순위의 환경 설정으로 달라질 수 있으므로 배포 때 실제 값을 확인해요.

### 1~2 cycle 내

이 구분은 기존 계획상의 우선순위예요. 남은 과제는 키 교체 알림·절차 자동화, 의존성 취약점 CI 차단 기준, 보안 이벤트별 경보와 대응 기준이에요. 계정 잠금은 이미 구현됐으므로 신규 구현 항목에서 제외해요.

### 중장기

이미지 서명은 구현돼 있으므로 검증을 필수로 적용할 범위와 우회 정책을 점검해요. 의존성 검증, 콘솔 계정 변경의 별도 감사 저장, 외부 요청 대상 검증과 DNS 관련 방어는 추가 검토 항목이에요. 앱 감사 조회 API와 Loki 8760시간 설정도 구현돼 있어요. 원격 저장소의 실제 보관 상태나 규정 준수 여부는 별도로 확인해야 해요.

### 정책 명시 (코드 변경 X)
- **A02.1 TLS 내부 통신 정책** — `sslmode=require` 명시 + 문서화
- **A04.1 404 vs 500 convention** — `exception-handling.md` 에 service 레이어 권장 패턴 명시
- **A05.1 CORS 가이드** — 파생 레포 브라우저 client 추가 시 안내

---

## 관련 문서

- [`Architecture Rules (ArchUnit)`](../../structure/architecture-rules.md) — A01/A04 의 자동 강제 메커니즘
- [`JWT Authentication`](../../structure/jwt-authentication.md) — A02/A07 토큰 정책
- [`Multitenant Architecture`](../../structure/multitenant-architecture.md) — A01 의 cross-tenant 격리
- [`Exception Handling Convention`](../../convention/exception-handling.md) — A04 정보 누출 차단
- [`Rate Limiting`](../../api-and-functional/functional/rate-limiting.md) — A04/A07 brute-force 방어 보조
- [`Observability`](../../api-and-functional/functional/observability.md) — A09 로그/메트릭
- [`Key Rotation`](./key-rotation.md) — A02 의 운영 절차
- [`Secret Chain (4-stage)`](./secret-chain-4stage.md) — A02 secret 관리
- [`ADR-027 (Admin role)`](../../philosophy/adr-027-admin-role-authorization.md) — A01
- [`ADR-028 (Audit log)`](../../philosophy/adr-028-audit-log-domain.md) — A09
- [`ADR-029 (Password policy)`](../../philosophy/adr-029-password-policy.md) — A07
- [`ADR-030 (2FA TOTP)`](../../philosophy/adr-030-2fa-totp.md) — A07
- [`ADR-032 (Google webhook auth)`](../../philosophy/adr-032-google-webhook-auth.md) — A08
- [`ADR-036 (SSRF URL whitelist)`](../../philosophy/adr-036-ssrf-url-whitelist.md) — A10
