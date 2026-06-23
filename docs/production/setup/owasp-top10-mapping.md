# OWASP Top 10 (2021) 매핑

> **유형**: Reference · **독자**: Level 2~3 · **읽는 시간**: ~15분

template-spring 의 보안 베이스라인을 OWASP Top 10 2021 의 10 카테고리에 매핑해요. 각 카테고리마다 **현 방어**(file:line), **검증**(테스트 위치), **Gap**(빠진 부분) 을 정리합니다.

**용도**:
- 외부 보안 감사·B2B 클로징·규제 대응 시 즉시 답변하는 reference
- 신규 입사자가 본 프로젝트의 보안 사고관을 빠르게 파악
- 분기별 self-audit — gap 항목이 그대로 backlog 의 Security 카테고리로 흘러가요

**버전**: OWASP Top 10 2021 기준. 2025 발표 후 재매핑 예정.

---

## A01 — Broken Access Control (권한 검사 누락)

**현 방어**:
- `common/common-security/.../SecurityConfig.java:87-88` — `anyRequest().authenticated()` 정책. 새 endpoint 는 `ApiEndpoints.Auth.PUBLIC_PATTERNS` 에 명시하지 않으면 자동으로 보호됩니다
- `common/common-security/.../AppSlugVerificationFilter.java:57-74` — JWT 의 `appSlug` claim 과 URL path slug 가 불일치하면 403. cross-tenant 데이터 접근을 차단합니다
- `common/common-security/.../AdminOnly.java:39` — `@PreAuthorize("hasRole('ADMIN')")` meta annotation. 미인증 401, 권한 없으면 403
- `core/core-audit-impl/.../AuditAspect.java:56-98` — `@AdminOnly`·`@Audited` 메서드를 자동으로 가로채 audit log 를 기록합니다
- `common/common-security/.../CurrentUserArgumentResolver.java:27-46` — `@CurrentUser` resolver 가 SecurityContext 에서 `AuthenticatedUser` 를 주입합니다

**검증**:
- `common/common-security/.../AppSlugVerificationFilterTest.java` — slug 불일치 시 403
- `common/common-security/.../AdminOnlyTest.java` — 권한 검증
- `core/core-audit-impl/.../AuditAspectTest.java` — admin 액션 기록

**Gap**:
- **Row-level 권한 검증 자동화 부재** — "user A 의 profile 을 user B 가 열람" 같은 시나리오는 Service 에서 수동으로 검사해요. canonical pattern 이 없어요 (예: `@SubscriptionOwner` 같은 annotation)
- **Cross-tenant 접근 edge case 테스트 커버리지 제한** — 미인증 요청이나 공개 endpoint 에서는 slug 검증이 skip 됩니다. 정상 동작이지만 테스트 케이스를 보강할 여지가 있어요

---

## A02 — Cryptographic Failures (암호화 실패)

**현 방어**:
- `common/common-security/.../jwt/JwtService.java:53` — HS256 (`Jwts.SIG.HS256`) JWT 서명
- `common/common-security/.../jwt/JwtProperties.java:16-18` — secret 길이가 32자 미만이면 `IllegalArgumentException`
- `bootstrap/.../application-prod.yml:70` — `app.jwt.secret: ${JWT_SECRET}` (기본값 없음, 환경변수 필수)
- `common/common-security/.../PasswordHasher.java:12-13` — BCrypt strength 12 (~200~300ms/hash)
- `core/core-auth-impl/.../service/TokenGenerator.java:52-64` — `sha256Hex()` 로 refresh·verification·reset 토큰을 모두 SHA-256 해시로 저장 (raw 미저장)
- `core/core-user-impl/.../entity/User.java:40` — `totp_secret VARCHAR(64)` 평문 저장 (RFC 6238 준수, 클라이언트 측 encrypted local storage 권장)
- `.gitignore:26-58` — `.env`, `.env.*`, `.kamal/secrets` 제외
- `.gitleaks.toml` — gitleaks default rule + allowlist (테스트 fixture, .env.example 등)

**검증**:
- `common/common-security/.../jwt/JwtPropertiesTest.java` — secret < 32 chars 검증
- `common/common-security/.../jwt/JwtServiceTest.java` — HS256 서명 검증
- `common/common-security/.../PasswordHasherTest.java` — BCrypt 해싱 + 검증

**Gap**:
- **TLS 내부 통신 정책 미명시** — `application.yml` 에 `server.ssl.*` 가 없어요. Cloudflare edge 에서 종료하는 전제이지만 backend ↔ Supabase 간 `sslmode=require` 명시 검증이 빠져 있어요
- **Key rotation 자동화 없음** — `docs/production/setup/key-rotation.md` 가 수동 절차만 기술합니다. 6개월 주기 자동 reminder 가 없어요
- **TOTP backup codes 저장 방식 상세 부족** — `User.totpBackupCodes` 의 정확한 JSON 스키마와 BCrypt 적용 여부가 코드 주석에 없어요. 검증 로직(`TwoFactorService`) 을 정독해야만 확인됩니다

---

## A03 — Injection (SQL/NoSQL/OS injection)

**현 방어**:
- 모든 Repository 가 Spring Data JPA — `findByEmail`, `findByEmailAndDeletedAtIsNull` 같은 method name 또는 named parameter (`:userId`, `:familyId`) 만 씁니다
- `core/core-auth-impl/.../repository/RefreshTokenRepository.java:17-25` — `@Query` JPQL UPDATE 도 named parameter 만 사용합니다
- Flyway migration (`core/core-*-impl/.../db/migration/`) — 모든 V 파일이 정적 DDL/DML. 동적 SQL 이 없어요
- `common/common-persistence/.../QueryDslPredicateBuilder.java` — 동적 조건 빌더가 `field_op` 형식의 operator 화이트리스트만 허용합니다 (`eq`, `ne`, `like`, `startsWith`, `endsWith`, `gt`, `gte`, `lt`, `lte`, `in`, `notIn`, `between`, `isNull`, `isNotNull`, `empty`). 화이트리스트 밖 입력은 거부되어 임의 SQL 삽입을 차단합니다
- Shell script (`tools/new-app/new-app.sh`, `tools/migrate-prod.sh`) — DB 작업이 `psql -f <file.sql>` 형태. user 입력은 schema name (alphanumeric + hyphen) 으로 제한됩니다

**검증**:
- Repository test 가 JPA parameter binding 을 암묵적으로 검증
- ArchUnit r22 — Mapper 클래스 금지 (raw SQL 우회 차단의 부수 효과)

**Gap**:
- **OS injection 검증 (shell script)** — `migrate-prod.sh` 의 환경변수 quoting 방어가 명시되어 있지 않아요. 현재는 정적 SQL 만 실행해서 저위험입니다
- **동적 SQL 가이드 부재** — 향후 raw query 가 필요할 때 어떤 패턴을 권장하는지 convention 이 없어요. `QueryDslPredicateBuilder` 만 있어요
- **Flyway 동적 SQL 금지 자동 강제 없음** — 모든 마이그레이션이 정적이지만 CI rule 로 강제하지는 않아요

---

## A04 — Insecure Design (설계 자체가 취약)

**현 방어**:
- `bootstrap/.../BootstrapArchitectureTest.java` — ArchUnit 22 규칙. cross-domain raw repository 호출, cross-app 의존 등을 차단합니다
- `common/common-web/.../exception/GlobalExceptionHandler.java:136-143` — fallback handler 가 stacktrace 를 노출하지 않아요. 클라이언트엔 generic message 만 갑니다
- `core/core-auth-api/.../exception/AuthError.java:17-18` — `INVALID_CREDENTIALS (ATH_001)` "이메일 또는 비밀번호가 올바르지 않습니다" — **열거 공격 방지** (어느 필드가 틀렸는지 구분하지 않음)
- `common/common-web/.../ratelimit/RateLimitFilter.java:48-58` — `SENSITIVE_SUFFIXES` set 으로 auth 민감 endpoint 를 분리. prod 기준 strict 10rpm / default 60rpm
- `common/common-security/.../AppSlugVerificationFilter.java` — schema-per-app 멀티테넌시 격리

**검증**:
- `common/common-web/.../GlobalExceptionHandlerTest.java` — generic message 응답 검증
- `common/common-web/.../ratelimit/RateLimitFilterTest.java` — sensitive vs default 적용
- `BootstrapArchitectureTest` — 빌드 시점 자동 실행

**Gap**:
- **404 vs 500 convention 명시 부족** — 리소스 없을 때 `CommonError.NOT_FOUND (CMN_002)` 를 쓴다는 규약이 `exception-handling.md` 에 명시되어 있지만, service 레이어에서 `IllegalArgumentException` 같은 generic 예외를 던지는 케이스가 있을 수 있어요. 검사 자동화가 없어요
- **API 응답 버전 관리 전략 부재** — ADR-008 (API 버전 미도입) 의 의도적 결정이에요. 단 breaking change 시 client 호환성 관리 가이드가 빠져 있어요 (legacy 호환 패턴 ADR 만 있음)

---

## A05 — Security Misconfiguration (디폴트 설정 노출)

**현 방어**:
- `bootstrap/.../application.yml:33-34` — `management.endpoints.web.exposure.include: health,info,prometheus` (env, beans, heapdump 등 제외)
- `bootstrap/.../application-prod.yml:35-36` — prod 도 동일 정책 (override 없음)
- `application.yml:37` — `management.endpoint.health.show-details: never` (health 최소 정보)
- `GlobalExceptionHandler.java:136-143` — fallback 시 stacktrace 비노출
- `application-prod.yml` 모든 민감값 `${ENV_VAR}` 플레이스홀더

**검증**:
- 운영 함정 6개 (`README.md`) + dogfood-pitfalls 15개 — 설정 실수 케이스 정리

**해결됨**:
- **✅ Swagger UI prod·dev 비활성** (resolved) — `application-prod.yml:43-47` 과 `application-dev.yml:30-34` 모두 `springdoc.swagger-ui.enabled: false` + `springdoc.api-docs.enabled: false` 를 적용합니다. prod 와 dev 둘 다 `/swagger-ui.html` · `/v3/api-docs` 가 404 예요. dev 도 차단하는 이유는 Cloudflare tunnel 경유 노출 위험 때문이고, dev 에서 일시적으로 보려면 `springdoc.swagger-ui.enabled=true` 환경변수로 override 합니다. 프로파일 없이 띄우는 로컬 default (`application.yml`) 만 swagger 가 활성이에요

**Gap (남은 항목)**:
- **CORS 미설정 가이드 부재** — 의도적 결정이에요 (모바일 전제). 단 파생 레포가 브라우저 client 를 추가할 때 자동 안내가 없어요
- **`server.error.include-stacktrace` 명시 부재** — 환경별 기본값이 달라요 (dev=ALWAYS, prod=ON_PARAM). prod 안전을 위해 `never` 명시를 권장해요
- **Admin credential 시드 변경 강제 부재** — `new-app.sh` 가 admin 계정을 자동 생성해요. 첫 로그인 시 비밀번호 변경을 강제하는 로직이 없어요
- **`/actuator/info` 정보 노출** — `permitAll` + `app.dogfood.message` 등 버전 정보를 공개해요. 공격자의 fingerprinting 을 보조할 수 있어요

---

## A06 — Vulnerable and Outdated Components (의존성 CVE)

**현 방어**:
- `gradle/libs.versions.toml` — 중앙 버전 카탈로그. Spring Boot 3.5.13, JJWT 0.13.0, Firebase 9.8.0, Testcontainers 1.20.6 등 모두 명시됩니다
- `.gitleaks.toml` — secret 누출 검사. default rule + 테스트 fixture allowlist

**프로젝트 정책**:
- **Dependabot 미사용** — PR 노이즈와 관리 부담의 trade-off 를 평가한 뒤 미채택을 결정했어요. 의존성 update 는 별도 자동화 도구 (Renovate / OWASP Dependency Check) 또는 분기 manual review 로 대체할 예정이에요 (backlog 등재)

**검증**:
- `tools/ci-test.sh` 의 secret stage (gitleaks 실행)

**Gap**:
- **의존성 CVE 자동 스캔 부재** — `npm audit` 같은 명시 stage 가 없어요. critical/high CVE 가 떠도 운영자가 manual 로 추적해야 해요
- **자동 update PR 부재** (Dependabot 미사용) — 의존성 버전 갱신이 manual 이에요. 분기별 audit cycle 설정이 필요해요
- **CVE threshold 정책 없음** — critical/high CVE 자동 차단 룰이 없어요
- **Gradle dependency verification 미구성** — `org.gradle.dependency-verification` 으로 jar checksum 을 lock 하지 않아요. Maven central 에서 받은 의존성의 무결성 검증이 없어요
- **License 검증 부재** — GPL/AGPL 같은 회피 license 의 자동 감지가 없어요

---

## A07 — Identification and Authentication Failures (인증 실패)

**현 방어**:
- `common/common-web/.../security/PasswordValidator.java:23-106` — 최소 10자, 대문자+소문자+숫자 필수, 특수문자 선택. Top 200 흔한 비밀번호 블랙리스트 (`common-passwords.txt`). BCrypt max 72 byte 강제
- `core/core-auth-impl/.../totp/{TotpService,TwoFactorService}.java` — RFC 6238 TOTP. HMAC-SHA1, 30초 window, 6자리, ±1 window (90초). Backup codes 8개 BCrypt 저장. opt-in 활성화. 임시 토큰 (`type="2fa_pending"`, 5분 TTL)
- `core/core-auth-impl/.../entity/RefreshToken.java:1-147` — refresh token rotation + replay 감지
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
- `RefreshTokenServiceContractTest` (rotation + family tracking)
- Rate limit 단위 + 통합 테스트

**Gap**:
- **계정 잠금 정책 미구현** — N회 실패 후 계정 잠금은 backlog 에 등재되어 있어요 (ADR-029). 현재는 rate limit (요청 횟수 제한) 만 있어요. 두 메커니즘은 별개입니다
- **이메일 OTP brute-force 방어 명시 부재** — `EmailVerificationService` 의 attempt counter / exponential backoff 정책이 코드·문서에 명시되어 있지 않아요. 6자리 OTP 는 1M 조합이라 TTL 5분 + rate limit 만으로는 부족할 수 있어요
- **2FA 의무화 정책 없음** — admin role 사용자에게 2FA 를 강제하는 정책이 없어요
- **Backup codes 분실 시 복구 절차 manual** — 8개를 다 소진하면 admin intervention 이 필요해요. 자동 recovery code 발급 endpoint 가 없어요

---

## A08 — Software and Data Integrity Failures (서명 미검증)

**현 방어**:
- `core/core-iap-impl/.../AppleJwsVerifier.java:1-227` — Apple JWS 검증. ES256 (SHA256withECDSA) 서명 + X.509 cert chain (Apple Root CA G3, classpath embedded `apple-root-ca-g3.cer`)
- `core/core-auth-impl/.../service/GoogleSignInService.java:117-156` — Google id token 을 Google `/tokeninfo` endpoint 에 위임 검증 (RS256 + aud/iss/exp 를 Google 측에서 처리)
- `core/core-iap-impl/.../google/GoogleJwksClient.java:1-101` — Google webhook Bearer JWT 검증. JWKS 캐시 1시간. 4 단계 (RS256 서명 / audience / email service account allowlist / exp). ADR-032 참조
- `tools/migrate-prod.sh` — Flyway migration SHA-1 checksum 사전 검증. 부팅 시 VALIDATE_ONLY 모드로 재검증
- `.github/workflows/deploy.yml` — Docker image `:${sha}` 태그 (commit SHA 추적)
- Kamal `--skip-push` — CI 의 jar 만 사용, 로컬 재빌드 금지

**검증**:
- `AppleJwsVerifierTest` (cert chain + ES256)
- `GoogleWebhookAuthFilterTest` (Bearer JWT)
- `AppleSignInServiceTest`, `GoogleSignInServiceTest`
- WireMock fixtures: `apple-server-notification-v2.json`, `google-rtdn.json`

**Gap**:
- **Docker image signing 부재** — cosign / Sigstore 같은 서명이 없어요. GHCR 의 image 가 진짜 우리 CI 에서 왔는지 검증할 수 없어요
- **Gradle dependency verification 미구성** — A06 와 동일한 무결성 gap
- **`migrate-prod.sh` checksum 1:1 검증 부재** — Python3 `zlib.crc32` 가 Flyway 의 `ResourceProvider` 알고리즘과 정확히 일치하는지 검증이 없어요. mismatch 시 운영자가 `schema_history.checksum` 을 수동 UPDATE 합니다 (`flyway-runbook.md §4-3`). backlog 에 등재되어 있어요

---

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
- **보안 이벤트 명시 로그 정책 부재** — 다음 이벤트의 로그 레벨·내용이 명시되어 있지 않아요:
  - 로그인 실패 (brute-force 수준 카운팅 부재)
  - 권한 거부 (403)
  - TOTP 검증 실패
  - Webhook 서명 검증 실패
  - 암호 변경·2FA 활성화 같은 보안 설정 변경
- **보안 이벤트 alert rule 부재** — Grafana 대시보드 + 보안 alert rule 은 backlog 에 등재되어 있어요. 현재 `infra/prometheus/rules.yml` 에는 8개 (HighErrorRate, HighLatencyP95, RateLimitSpike, BackendDown, MinioDown, MinioDiskUsageHigh, MinioDiskUsageCritical, MinioDiskUsageEmergency) 만 있어요. 보안 이벤트 alert (failed login spike, webhook auth fail) 는 없어요
- **Audit log 조회 endpoint 부재** — `GET /api/admin/audit-logs?action=...&since=...` 같은 운영자 UI 가 미구현이에요. ADR-028 에 다음 사이클로 등재되어 있어요
- **Entity 변경 추적 (`@PreUpdate`) 미구현** — User.role 변경 시 old/new 값을 audit details 에 캡처하지 않아요
- **Log retention 정책 단명** — `infra/loki/loki-config.yml` 의 `retention_period: 336h` (14일). PCI-DSS·일반 compliance 의 1년 권장과 차이가 있어요

---

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
- **Private IP 차단 정책 명시 없음** — RFC 1918 (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16) 차단 룰이 없어요. 현재 모든 호출이 public cloud endpoint 라 현실적 위험은 낮아요
- **DNS rebinding 방어 없음** — TOCTOU 취약점 mitigation 이 없어요 (매우 낮은 확률)

---

## 종합 — Gap 우선순위

본 매핑의 self-audit 결과를 우선순위별로 정리해요. 모두 [`backlog.md`](../../planned/backlog.md) 의 Security 카테고리에 등재되어 있어요.

### 즉시 fix — 모두 해결됨 ✅
- ~~**A05.1 Swagger UI 노출**~~ — `application-prod.yml:43-47` + `application-dev.yml:30-34` 에 `swagger-ui.enabled: false` + `api-docs.enabled: false` 적용. prod·dev 둘 다 차단 완료
- ~~**A10.2 Resend timeout 명시**~~ — `ResendEmailAdapter` 에 `connectTimeout 5s` + `readTimeout 10s` 적용 + ADR-036 정책 명문화 완료

### 1~2 cycle 내
- **A02.2 Key rotation 자동화** — 6개월 주기 reminder + grace period
- **A06.1 CVE 스캔 도구** — OWASP Dependency Check 또는 Snyk CI 통합 + threshold 정책
- **A07.1 계정 잠금 정책** — N회 실패 후 잠금 (ADR-029 backlog)
- **A09.2 보안 이벤트 alert rule** — Grafana dashboard cycle 과 묶어서

### 중장기
- **A08.1 Docker image signing** — cosign / Sigstore CI 통합
- **A09.3 Audit log 조회 endpoint** — 운영자 UI (ADR-028 다음 사이클)
- **A09.5 Log retention 1년** — 현재 14일 → compliance 대비
- **A10.1 SSRF 방어 강화** — private IP 차단 + DNS rebinding 정책 (URL whitelist 는 ADR-036 으로 완료)

### 정책 명시 (코드 변경 X)
- **A02.1 TLS 내부 통신 정책** — `sslmode=require` 명시 + 문서화
- **A04.1 404 vs 500 convention** — `exception-handling.md` 에 service 레이어 권장 패턴 명시
- **A05.1 CORS 가이드** — 파생 레포 브라우저 client 추가 시 안내
- **A05.2 `server.error.include-stacktrace=never` 명시**

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
- [`Backlog`](../../planned/backlog.md) — Security 카테고리 후속 작업
