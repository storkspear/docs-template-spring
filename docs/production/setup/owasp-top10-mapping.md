# OWASP Top 10 (2021) 매핑

> **유형**: Reference · **독자**: Level 2~3 · **읽는 시간**: ~15분

template-spring 의 보안 베이스라인을 OWASP Top 10 2021 의 10 카테고리에 매핑해요. 각 카테고리마다 **현 방어**(file:line), **검증**(테스트 위치), **Gap**(빠진 부분) 을 정리.

**용도**:
- 외부 보안 감사 / B2B 클로징 / 규제 대응 시 즉시 답변 reference
- 신규 입사자가 본 프로젝트의 보안 사고관 빠르게 파악
- 분기별 self-audit — gap 항목이 그대로 backlog 의 Security 카테고리로 흘러가요

**버전**: OWASP Top 10 2021 기준. 2025 발표 후 재매핑 예정.

---

## A01 — Broken Access Control (권한 검사 누락)

**현 방어**:
- `common/common-security/.../SecurityConfig.java:87-88` — `anyRequest().authenticated()` 정책. 새 endpoint 는 `ApiEndpoints.Auth.PUBLIC_PATTERNS` (L84-85) 에 명시 안 하면 자동 보호
- `common/common-security/.../AppSlugVerificationFilter.java:57-74` — JWT 의 `appSlug` claim 과 URL path slug 불일치 시 403. cross-tenant 데이터 접근 차단
- `common/common-security/.../AdminOnly.java` — `@PreAuthorize("hasRole('ADMIN')")` meta annotation. 미인증 401, 권한 없으면 403
- `core/core-audit-impl/.../AuditAspect.java:56-98` — `@AdminOnly` / `@Audited` 메서드 자동 가로채기 → audit log 기록
- `common/common-security/.../CurrentUserArgumentResolver.java` — `@CurrentUser` resolver 가 SecurityContext 에서 `AuthenticatedUser` 주입

**검증**:
- `common/common-security/.../AppSlugVerificationFilterTest.java:43+` — slug 불일치 시 403
- `common/common-security/.../AdminOnlyTest.java` — 권한 검증
- `core/core-audit-impl/.../AuditAspectTest.java` — admin 액션 기록

**Gap**:
- **Row-level 권한 검증 자동화 부재** — "user A 의 profile 을 user B 가 열람" 같은 시나리오는 Service 에서 수동 검사. canonical pattern 부재 (예: `@SubscriptionOwner` 같은 annotation)
- **Cross-tenant 접근 edge case 테스트 커버리지 제한** — 미인증 요청이나 공개 endpoint 에서 slug 검증 skip 됨. 정상 동작이지만 테스트 케이스 보강 여지

---

## A02 — Cryptographic Failures (암호화 실패)

**현 방어**:
- `common/common-security/.../jwt/JwtService.java:45-54` — HS256 (`Jwts.SIG.HS256`) JWT 서명
- `common/common-security/.../jwt/JwtProperties.java:16-18` — secret 길이 32자 미만 시 `IllegalArgumentException`
- `bootstrap/.../application-prod.yml:61` — `app.jwt.secret: ${JWT_SECRET}` (기본값 없음, 환경변수 필수)
- `common/common-security/.../PasswordHasher.java:12-13` — BCrypt strength 12 (~200~300ms/hash)
- `core/core-auth-impl/.../service/TokenGenerator.java:52-64` — `sha256Hex()` 로 refresh / verification / reset 토큰 모두 SHA-256 해시 저장 (raw 미저장)
- `core/core-user-impl/.../entity/User.java` — `totp_secret VARCHAR(64)` 평문 저장 (RFC 6238 준수, 클라이언트 측 encrypted local storage 권장)
- `.gitignore:26-58` — `.env`, `.env.*`, `.kamal/secrets` 제외
- `.gitleaks.toml` — gitleaks default rule + allowlist (테스트 fixture, .env.example 등)

**검증**:
- `common/common-security/.../jwt/JwtPropertiesTest.java:28-34` — secret < 32 chars 검증
- `common/common-security/.../jwt/JwtServiceTest.java` — HS256 서명 검증
- `common/common-security/.../PasswordHasherTest.java` — BCrypt 해싱 + 검증

**Gap**:
- **TLS 내부 통신 정책 미명시** — `application.yml` 에 `server.ssl.*` 없음. Cloudflare edge 에서 종료 전제이지만 backend ↔ Supabase 간 `sslmode=require` 명시 검증 부재
- **Key rotation 자동화 없음** — `docs/production/setup/key-rotation.md` 가 수동 절차만 기술. 6개월 주기 자동 reminder 없음
- **TOTP backup codes 저장 방식 상세 부족** — `User.totpBackupCodes` 의 정확한 JSON 스키마 + bcrypt 적용 여부가 코드 주석에 없음. 검증 로직(`TwoFactorService`) 정독으로만 확인 가능

---

## A03 — Injection (SQL/NoSQL/OS injection)

**현 방어**:
- 모든 Repository 가 Spring Data JPA — `findByEmail`, `findByEmailAndDeletedAtIsNull` 등 method name 또는 named parameter (`:userId`, `:familyId`)
- `core/core-auth-impl/.../repository/RefreshTokenRepository.java:17-25` — `@Query` JPQL UPDATE 도 named parameter 만
- Flyway migration (`core/core-*-impl/.../db/migration/`) — 모든 V 파일이 정적 DDL/DML. 동적 SQL 없음
- `common/common-persistence/.../QueryDslPredicateBuilder.java:8-60` — 동적 조건 빌더가 `field_op` 형식 화이트리스트 (operator: `eq`, `like`, `gte`, `lte`, `gt`, `lt` 등). 임의 SQL 삽입 차단
- Shell script (`tools/new-app.sh`, `tools/migrate-prod.sh`) — DB 작업이 `psql -f <file.sql>` 형태. user 입력은 schema name (alphanumeric + hyphen) 로 제한

**검증**:
- Repository test 가 JPA parameter binding 을 암묵적으로 검증
- ArchUnit r? — Mapper 클래스 금지 (raw SQL 우회 차단의 부수 효과)

**Gap**:
- **OS injection 검증 (shell script)** — `migrate-prod.sh` 의 환경변수 quoting 방어 명시 부재. 현재는 정적 SQL 만 실행해서 저위험
- **동적 SQL 가이드 부재** — 향후 raw query 가 필요할 때 어떤 패턴 권장하는지 convention 없음. `QueryDslPredicateBuilder` 만 있음
- **Flyway 동적 SQL 금지 자동 강제 없음** — 모든 마이그레이션이 정적이지만 CI rule 로 강제 안 함

---

## A04 — Insecure Design (설계 자체가 취약)

**현 방어**:
- `bootstrap/.../BootstrapArchitectureTest.java` — ArchUnit 22 규칙. cross-domain raw repository 호출, cross-app 의존 등 차단
- `common/common-web/.../exception/GlobalExceptionHandler.java:136-143` — fallback handler 가 stacktrace 비노출. 클라이언트엔 generic message
- `core/core-auth-api/.../exception/AuthError.java:17-18` — `INVALID_CREDENTIALS (ATH_001)` "이메일 또는 비밀번호가 올바르지 않습니다" — **열거 공격 방지** (어느 필드가 틀렸는지 구분 안 함)
- `common/common-web/.../ratelimit/RateLimitFilter.java:48-58` — `SENSITIVE_SUFFIXES` set 으로 auth 민감 endpoint 분리. strict 10rpm / default 60rpm
- `common/common-security/.../AppSlugVerificationFilter.java` — schema-per-app 멀티테넌시 격리

**검증**:
- `common/common-web/.../GlobalExceptionHandlerTest.java` — generic message 응답 검증
- `common/common-web/.../ratelimit/RateLimitFilterTest.java` — sensitive vs default 적용
- `BootstrapArchitectureTest` — 빌드 시점 자동 실행

**Gap**:
- **404 vs 500 convention 명시 부족** — 리소스 없을 때 `CommonError.NOT_FOUND (CMN_002)` 를 사용한다는 규약이 `exception-handling.md` 에 명시되어 있지만, service 레이어에서 `IllegalArgumentException` 같은 generic 예외를 던지는 케이스가 있을 수 있음. 검사 자동화 없음
- **API 응답 버전 관리 전략 부재** — ADR-008 (API 버전 미도입) 의도적 결정. 단 breaking change 시 client 호환성 관리 가이드 부재 (legacy 호환 패턴 ADR 만 있음)

---

## A05 — Security Misconfiguration (디폴트 설정 노출)

**현 방어**:
- `bootstrap/.../application.yml:21-27` — `management.endpoints.web.exposure.include: health,info,prometheus` (env, beans, heapdump 등 제외)
- `bootstrap/.../application-prod.yml:32-36` — prod 도 동일 정책 (override 없음)
- `application.yml:30` — `management.endpoint.health.show-details: never` (health 최소 정보)
- `GlobalExceptionHandler.java:136-143` — fallback 시 stacktrace 비노출
- `application-prod.yml` 모든 민감값 `${ENV_VAR}` 플레이스홀더

**검증**:
- 운영 함정 6개 (`README.md`) + dogfood-pitfalls 12개 — 설정 실수 케이스 정리

**해결됨**:
- **✅ Swagger UI prod 비활성** (resolved) — `application-prod.yml:43-47` 에 `springdoc.swagger-ui.enabled: false` + `api-docs.enabled: false` 적용. prod 에서 `/swagger-ui.html` / `/v3/api-docs` 모두 404. dev/default profile 은 `application.yml` 의 활성 설정 그대로 유지

**Gap (남은 항목)**:
- **CORS 미설정 가이드 부재** — 의도적 결정 (모바일 전제) 이지만 파생 레포가 브라우저 client 추가 시 자동 안내 없음
- **`server.error.include-stacktrace` 명시 부재** — 환경별 기본값 다름 (dev=ALWAYS, prod=ON_PARAM). prod 안전 위해 `never` 명시 권장
- **Admin credential 시드 변경 강제 부재** — `new-app.sh` 가 admin 계정 자동 생성. 첫 로그인 시 비밀번호 변경 강제 로직 없음
- **`/actuator/info` 정보 노출** — `permitAll` + `app.dogfood.message` 등 버전 정보 공개. 공격자의 fingerprinting 보조

---

## A06 — Vulnerable and Outdated Components (의존성 CVE)

**현 방어**:
- `gradle/libs.versions.toml:1-59` — 중앙 버전 카탈로그. Spring Boot 3.5.13, JJWT 0.13.0, Firebase 9.8.0, Testcontainers 1.20.6 등 모두 명시
- `.gitleaks.toml:1-48` — secret 누출 검사. default rule + 테스트 fixture allowlist

**프로젝트 정책**:
- **Dependabot 미사용** — PR 노이즈 / 관리 부담 trade-off 평가 후 미채택 결정. 의존성 update 는 별도 자동화 도구 (Renovate / OWASP Dependency Check) 또는 분기 manual review 로 대체 예정 (backlog 등재).

**검증**:
- `tools/ci-test.sh` 의 secret stage (gitleaks 실행)

**Gap**:
- **의존성 CVE 자동 스캔 부재** — `npm audit` 같은 명시 stage 없음. critical/high CVE 가 떠도 운영자가 manual 추적 필요
- **자동 update PR 부재** (Dependabot 미사용) — 의존성 버전 갱신이 manual. 분기별 audit cycle 설정 필요
- **CVE threshold 정책 없음** — critical/high CVE 자동 차단 룰 부재
- **Gradle dependency verification 미구성** — `org.gradle.dependency-verification` 으로 jar checksum lock 부재. Maven central 에서 받은 의존성 무결성 검증 없음
- **License 검증 부재** — GPL/AGPL 같은 회피 license 자동 감지 없음

---

## A07 — Identification and Authentication Failures (인증 실패)

**현 방어**:
- `common/common-web/.../security/PasswordValidator.java:23-106` — 최소 10자, 대문자+소문자+숫자 필수, 특수문자 선택. Top 200 흔한 비밀번호 블랙리스트 (`common-passwords.txt`). BCrypt max 72 byte 강제 (`PasswordValidator.java:26`)
- `core/core-auth-impl/.../totp/{TotpService,TwoFactorService}.java` — RFC 6238 TOTP. HMAC-SHA1, 30초 window, 6자리, ±1 window (90초). Backup codes 8개 BCrypt 저장. opt-in 활성화. 임시 토큰 (`type="2fa_pending"`, 5분 TTL)
- `core/core-auth-impl/.../entity/RefreshToken.java:1-147` — refresh token rotation + replay 감지
  - `familyId` 추적
  - `usedAt` 플래그로 재사용 탐지 (탈취 판정 → family 전체 무효화)
  - `revokedAt` 명시 무효화
  - SHA-256 해시만 저장
- `AuthError.INVALID_CREDENTIALS (ATH_001)` — 이메일/비밀번호 어느 것이 틀렸는지 노출 안 함 (열거 공격 방지)
- Session 부재 (stateless JWT) — session fixation 자동 차단
- Rate limit (sensitive 10rpm) — brute-force 보조 방어

**검증**:
- `PasswordValidatorTest` 14개 (길이/복잡도/블랙리스트)
- `TotpServiceTest` 11개 (RFC 6238 test vectors)
- `RefreshTokenServiceContractTest` (rotation + family tracking)
- Rate limit 단위 + 통합 테스트

**Gap**:
- **계정 잠금 정책 미구현** — N회 실패 후 계정 잠금이 backlog 에 등재 (ADR-029 line 187). 현재는 rate limit (요청 횟수 제한) 만 있음. 두 메커니즘은 별개
- **이메일 OTP brute-force 방어 명시 부재** — `EmailVerificationService` 의 attempt counter / exponential backoff 정책이 코드/문서에 명시 안 됨. 6자리 OTP 는 1M 조합이라 TTL 5분 + rate limit 만으로 부족 가능
- **2FA 의무화 정책 없음** — admin role 사용자에 2FA 강제하는 정책 부재
- **Backup codes 분실 시 복구 절차 manual** — 8개 다 소진 시 admin intervention. 자동 recovery code 발급 endpoint 없음

---

## A08 — Software and Data Integrity Failures (서명 미검증)

**현 방어**:
- `core/core-iap-impl/.../AppleJwsVerifier.java:1-227` — Apple JWS 검증. ES256 (SHA256withECDSA) 서명 + X.509 cert chain (Apple Root CA G3, classpath embedded `apple-root-ca-g3.cer`)
- `core/core-auth-impl/.../service/GoogleSignInService.java:117-156` — Google id token 을 Google `/tokeninfo` endpoint 에 위임 검증 (RS256 + aud/iss/exp Google 측 처리)
- `core/core-iap-impl/.../google/GoogleJwksClient.java:1-101` — Google webhook Bearer JWT 검증. JWKS 캐시 1시간. 4 단계 (RS256 서명 / audience / email service account allowlist / exp). ADR-032 참조
- `tools/migrate-prod.sh:1-80` — Flyway migration SHA-1 checksum 사전 검증. 부팅 시 VALIDATE_ONLY 모드로 재검증
- `.github/workflows/deploy.yml` — Docker image `:${sha}` 태그 (commit SHA 추적)
- Kamal `--skip-push` — CI 의 jar 만 사용, 로컬 재빌드 금지

**검증**:
- `AppleJwsVerifierTest` (cert chain + ES256)
- `GoogleWebhookAuthFilterTest` (Bearer JWT)
- `AppleSignInServiceTest` / `GoogleSignInServiceTest`
- WireMock fixtures: `apple-server-notification-v2.json`, `google-rtdn.json`

**Gap**:
- **Docker image signing 부재** — cosign / Sigstore 같은 서명 없음. GHCR 의 image 가 진짜 우리 CI 에서 왔는지 검증 불가
- **Gradle dependency verification 미구성** — A06 와 동일한 무결성 gap
- **`migrate-prod.sh` checksum 1:1 검증 부재** — Python3 `zlib.crc32` 가 Flyway 의 `ResourceProvider` 알고리즘과 정확 일치하는지 검증 없음. mismatch 시 운영자가 `schema_history.checksum` 수동 UPDATE (`flyway-runbook.md §4-3`). backlog 에 등재됨

---

## A09 — Security Logging and Monitoring Failures (로그/모니터링 부재)

**현 방어**:
- `core/core-audit-impl/.../AuditAspect.java:45-59` — `@Audited` / `@AdminOnly` AOP. `Propagation.REQUIRES_NEW` 로 비즈 rollback 과 무관하게 audit 보존. SUCCESS / FAILURE 분기. `audit_logs` 테이블 (JSONB details, IP, resource)
- `common/common-logging/.../MdcFilter.java` — request id + appSlug MDC 주입 → Loki label 승격
- `common/common-security/.../AppSlugMdcFilter.java` — slug 별 MDC 분리
- `common/common-web/.../metrics/AppSlugObservationConvention.java` — Micrometer `http.server.requests` 에 `app=<slug>` 라벨
- Prometheus metrics (Bucket4j rate limit, JVM, DB pool)
- Loki + logback (loki4j) JSON 로그
- `docs/api-and-functional/functional/observability.md:56-81` — 환경별 로그 레벨 가이드 (ERROR/WARN/INFO/DEBUG)
- 민감 정보 마스킹 정책 (`observability.md:65`) — password, token, JWT secret 절대 로그 X

**검증**:
- `AuditAspectTest` 7개 (success/failure, actor resolution, slug context)
- `AppSlugMdcFilterTest`, `AppSlugObservationConventionTest`
- `ObservabilityIntegrationTest` — 실제 로그 출력 검증

**Gap**:
- **보안 이벤트 명시 로그 정책 부재** — 다음 이벤트의 로그 레벨/내용이 명시 안 됨:
  - 로그인 실패 (brute-force 수준 카운팅 부재)
  - 권한 거부 (403)
  - TOTP 검증 실패
  - Webhook 서명 검증 실패
  - 암호 변경 / 2FA 활성화 같은 보안 설정 변경
- **Alert rule 부재** — backlog 의 Grafana 대시보드 + alert rule 항목으로 등재. 현재 `infra/prometheus/rules.yml` 5개 (HighErrorRate, HighLatencyP95, RateLimitSpike, BackendDown, MinioDown) 만. 보안 이벤트 alert (failed login spike, webhook auth fail) 없음
- **Audit log 조회 endpoint 부재** — `GET /api/admin/audit-logs?action=...&since=...` 같은 운영자 UI 미구현. ADR-028 line 222 에 다음 사이클로 등재
- **Entity 변경 추적 (`@PreUpdate`) 미구현** — User.role 변경 시 old/new 값 audit details 캡처 부재
- **Log retention 정책 단명** — `infra/loki/loki-config.yml` 의 `retention_period: 336h` (14일). PCI-DSS / 일반 compliance 1년 권장과 차이

---

## A10 — SSRF (서버측 요청 위조)

**현 방어**:

외부 HTTP 호출 위치 + URL 결정 방식:

| # | 호출 | 파일 (line) | URL |
|---|---|---|---|
| 1 | Apple JWKS | `AppleJwksClient.java:31` | 고정: `https://appleid.apple.com/auth/keys` |
| 2 | Google tokeninfo | `GoogleSignInService.DEFAULT_TOKENINFO_URL` | 고정: `https://oauth2.googleapis.com/tokeninfo` |
| 3 | Google JWKS (webhook) | `GoogleJwksClient.DEFAULT_JWKS_URL` | 고정: `https://www.googleapis.com/oauth2/v3/certs` |
| 4 | Kakao token info | `KakaoSignInService.DEFAULT_TOKEN_INFO_URL` / `DEFAULT_USER_ME_URL` | 고정: `https://kapi.kakao.com/v1/user/access_token_info`, `https://kapi.kakao.com/v2/user/me` |
| 5 | Naver user info | `NaverSignInService.DEFAULT_USER_ME_URL` | 고정: `https://openapi.naver.com/v1/nid/me` |
| 6 | FCM 푸시 | Firebase Admin SDK | SDK 내부 관리 |
| 7 | Resend 이메일 | `ResendEmailAdapter.RESEND_API_URL` | 고정: `https://api.resend.com/emails` |
| 8 | MinIO 스토리지 | MinIO SDK | `APP_STORAGE_MINIO_ENDPOINT` (환경 설정) |

**모든 URL 이 hardcode 또는 운영자 설정값**. 사용자 입력으로 URL 결정되는 지점 없음.

**Timeout** (`Duration.ofSeconds(...)`):
- AppleJwksClient: connect 5s
- GoogleSignInService: connect 5s, request 10s
- KakaoSignInService: connect 5s, request 10s
- NaverSignInService: connect 5s, request 10s
- GoogleJwksClient: connect 5s

**Redirect**: `HttpClient.newBuilder()` 기본값 = redirect 자동 따라가지 않음. SSRF 위험 추가 차단.

**검증**:
- `AppleJwksClient`, `GoogleSignInService`, `KakaoSignInService`, `NaverSignInService`, `GoogleWebhookAuthFilter` 모두 WireMock IT
- `ResendEmailAdapter` 테스트 (HTTP spy)

**해결됨**:
- **✅ URL whitelist 정책 ADR-036 작성됨** (resolved) — [`ADR-036 · SSRF URL whitelist 정책`](../../philosophy/adr-036-ssrf-url-whitelist.md) 이 4 가이드라인 (host/path hardcode, connectTimeout 5s, request timeout 10s, no auto-redirect) + 9 호출 인벤토리 명문화
- **✅ Resend connectTimeout 명시** (resolved) — `ResendEmailAdapter.java:32` 에 `HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build()` 적용. 다른 client 와 동일 baseline

**Gap (남은 항목)**:
- **MinIO endpoint 검증 부재** — `APP_STORAGE_MINIO_ENDPOINT` 가 admin 통제이지만 도메인 검증 없음. `http://internal-server:9000` 같은 내부 주소 설정 가능 (실수 케이스)
- **Private IP 차단 정책 명시 없음** — RFC 1918 (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16) 차단 룰 부재. 현재 모든 호출이 public cloud endpoint 라 현실적 위험 낮음
- **DNS rebinding 방어 없음** — TOCTOU 취약점 mitigation 없음 (매우 낮은 확률)

---

## 종합 — Gap 우선순위

본 매핑의 self-audit 결과를 우선순위별로 정리해요. 모두 [`backlog.md`](../../planned/backlog.md) 의 Security 카테고리에 등재.

### 즉시 fix — 모두 해결됨 ✅
- ~~**A05.1 Swagger UI prod 노출**~~ — `application-prod.yml:43-47` 에 `springdoc.swagger-ui.enabled: false` + `api-docs.enabled: false` 적용 완료
- ~~**A10.2 Resend timeout 명시**~~ — `ResendEmailAdapter.java:32` `connectTimeout(5s)` 적용 + ADR-036 정책 명문화 완료

### 1~2 cycle 내
- **A02.2 Key rotation 자동화** — 6개월 주기 reminder + grace period
- **A06.1 CVE 스캔 도구** — OWASP Dependency Check 또는 Snyk CI 통합 + threshold 정책
- **A07.1 계정 잠금 정책** — N회 실패 후 잠금 (ADR-029 backlog)
- **A09.1 보안 이벤트 alert rule** — Grafana dashboard cycle 과 묶어서

### 중장기
- **A08.1 Docker image signing** — cosign / Sigstore CI 통합
- **A09.3 Audit log 조회 endpoint** — 운영자 UI (ADR-028 다음 사이클)
- **A09.5 Log retention 1년** — 현재 14일 → compliance 대비
- **A10.1 SSRF 방어 ADR** — URL whitelist 정책 + private IP 차단 + DNS rebinding 정책

### 정책 명시 (코드 변경 X)
- **A02.1 TLS 내부 통신 정책** — `sslmode=require` 명시 + 문서화
- **A04.1 404 vs 500 convention** — `exception-handling.md` 에 service 레이어 권장 패턴 명시
- **A05.2 CORS 가이드** — 파생 레포 브라우저 client 추가 시 안내
- **A05.3 `server.error.include-stacktrace=never` 명시**

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
- [`Backlog`](../../planned/backlog.md) — Security 카테고리 후속 작업
