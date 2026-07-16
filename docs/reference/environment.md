# Environment — 프레임워크 · 라이브러리 · 리소스 인벤토리

> **유형**: Reference · **독자**: Level 0~2 · **읽는 시간**: ~5분

이 레포가 실제로 쓰는 프레임워크 · 라이브러리 · 외부 서비스 · 인프라 리소스 목록이에요. 각 이름이 무엇을 하는지는 [`용어 사전`](./glossary.md) 에서 찾아보고, 여기서는 "무엇을 쓰는지" 만 모아 둡니다.

버전은 `gradle/libs.versions.toml` · `build.gradle` · `build-logic/` · `infra/docker-compose.*.yml` · `config/deploy.yml` · `.github/workflows/*.yml` 의 실제 값 기준이에요.

---

## 언어 · 런타임

| 이름 | 버전 | 용도 |
|---|---|---|
| **Java** | 21 (Temurin LTS) | 주 언어 |
| **Spring Boot** | 3.5.13 | 애플리케이션 프레임워크 |

## 빌드 도구

| 이름 | 버전 | 용도 |
|---|---|---|
| **Gradle** | 8.12.1 | 빌드 시스템 |
| **Gradle Convention Plugin** | — | `build-logic/` 에 5 개 — bootstrap · common · core-api · core-impl · app-module |
| **Spring Boot Gradle Plugin** | 3.5.13 | Fat JAR 빌드, bootRun |
| **Spring Dependency Management Plugin** | 1.1.7 | 의존성 BOM 관리 |
| **Spotless** | 6.25.0 | google-java-format 4-space 자동 적용 (커밋 전 강제) |
| **OWASP Dependency Check** | 12.2.2 | 의존성 CVE 스캔 (옵트인 task) |

## Spring 생태계

Spring Boot 3.5.13 BOM 으로 버전을 일괄 관리해요.

| 이름 | 용도 |
|---|---|
| **spring-boot-starter-web** | HTTP 서버, MVC |
| **spring-boot-starter-data-jpa** | JPA + Hibernate |
| **spring-boot-starter-security** | 인증/인가 |
| **spring-boot-starter-validation** | Bean Validation (JSR-380) |
| **spring-boot-starter-actuator** | 헬스체크, 메트릭 |
| **spring-boot-starter-test** | JUnit5, Mockito, AssertJ |
| **spring-boot-devtools** | 로컬 개발 핫리로드 |
| **spring-security-crypto** | BCrypt 등 |
| **spring-security-test** | `@WithMockUser` 등 |

## 데이터베이스 · ORM

| 이름 | 버전 | 용도 |
|---|---|---|
| **PostgreSQL** | 16-alpine | 주 DB (도커), 운영은 Supabase 또는 자체 호스트 |
| **PostgreSQL JDBC Driver** | Spring Boot BOM | JDBC 드라이버 |
| **Hibernate** | Spring Boot BOM | JPA 구현체 |
| **HikariCP** | Spring Boot BOM | 커넥션 풀 (앱당 독립) |
| **Flyway** | Spring Boot BOM | DB 마이그레이션 |
| **QueryDsl (JPA, Jakarta)** | 5.1.0 | 타입 세이프 동적 쿼리 |
| **QueryDsl APT** | 5.1.0 | Q 클래스 자동 생성 |

## 인증 · 보안

| 이름 | 버전 | 용도 |
|---|---|---|
| **jjwt-api** | 0.13.0 | JWT API |
| **jjwt-impl** | 0.13.0 | JWT 구현체 |
| **jjwt-jackson** | 0.13.0 | JWT JSON 직렬화 |
| **Spring Security** | Spring Boot BOM | 필터 체인 · BCrypt · SecurityContext |
| **gitleaks** | 8.21.2 | 커밋 시크릿 스캔 (CI) |

## 테스팅

| 이름 | 버전 | 용도 |
|---|---|---|
| **JUnit 5 (Jupiter)** | Spring Boot BOM | 테스트 프레임워크 |
| **AssertJ** | Spring Boot BOM | Fluent assertion |
| **Mockito** | Spring Boot BOM | 모킹 |
| **Testcontainers BOM** | 1.20.6 | 실제 Postgres · MinIO 컨테이너로 테스트 |
| **Testcontainers PostgreSQL · JUnit5 · MinIO** | 1.20.6 | 각 리소스별 컨테이너 |
| **ArchUnit JUnit5** | 1.4.2 | 아키텍처 규칙 테스트 (r1~r22) |
| **Jackson Databind · JSR310** | Spring Boot BOM | 계약 테스트 JSON 비교 |
| **WireMock standalone** | 3.10.0 | OAuth provider HTTP mock (테스트 전용, Jetty/Jackson 충돌 회피용 standalone) |
| **PIT (Pitest) plugin** | 1.15.0 | Mutation testing Gradle plugin |
| **PIT core** | 1.17.0 | Mutation testing 엔진 |
| **PIT junit5** | 1.2.1 | JUnit5 plugin |

## 관측성

라이브러리:

| 이름 | 버전 | 용도 |
|---|---|---|
| **Micrometer Core** | Spring Boot BOM | 메트릭 추상화 |
| **Micrometer Prometheus Registry** | Spring Boot BOM | Prometheus 포맷 export |
| **Logstash Logback Encoder** | 9.0 | JSON 로그 포맷 |
| **Loki Logback Appender** | 1.5.2 | Loki 로그 전송 |
| **Logback** | Spring Boot BOM | 로깅 구현체 |

인프라 (`infra/docker-compose.observability.yml`):

| 이름 | 버전 | 용도 |
|---|---|---|
| **Prometheus** | v2.55.0 | 메트릭 수집 (운영 retention 7일) |
| **Grafana Loki** | 3.2.0 | 로그 수집 (retention 14일) |
| **Grafana** | 11.3.0 | 대시보드 |
| **Alertmanager** | v0.27.0 | 알람 라우팅 (Discord webhook) |

## API 문서화

| 이름 | 버전 | 용도 |
|---|---|---|
| **springdoc-openapi-starter-webmvc-ui** | 2.8.13 | Swagger UI (`/swagger-ui.html`) |
| **springdoc-openapi-starter-webmvc-api** | 2.8.13 | OpenAPI 문서 (`/v3/api-docs`) |

## Rate Limiting · 유틸

| 이름 | 버전 | 용도 |
|---|---|---|
| **Bucket4j Core** | 8.10.1 | 인메모리 Token Bucket rate limiter |
| **Caffeine** | 3.2.3 | Bucket TTL eviction |

## 푸시 · 이메일 · 문자

| 이름 | 버전 | 용도 |
|---|---|---|
| **Firebase Admin SDK** | 9.8.0 | FCM 푸시 (compileOnly · 선택) |
| **Resend** | HTTP API | 트랜잭셔널 이메일 (`RESEND_API_KEY`) |
| **SOLAPI (CoolSMS)** | HTTP API | 휴대폰 점유인증 OTP 문자 발송 (`COOLSMS_API_KEY`). 별도 SDK 없이 `https://api.solapi.com/messages/v4/send` 직접 호출 |

## 스토리지

| 이름 | 버전 | 용도 |
|---|---|---|
| **MinIO Java Client** | 8.5.14 | S3 호환 오브젝트 스토리지 |
| **MinIO** (docker) | RELEASE.2025-01-20T14-49-07Z | 로컬/운영 스토리지 |

## 인프라 · 배포

| 이름 | 버전 | 용도 |
|---|---|---|
| **Docker** | — | 컨테이너 런타임 |
| **Eclipse Temurin JDK** | 21-alpine | Dockerfile 빌더 스테이지 |
| **Eclipse Temurin JRE** | 21-alpine | Dockerfile 런타임 스테이지 |
| **Docker Compose** | — | 로컬 dev 스택 (`infra/docker-compose.local.yml`, `.observability.yml`) |
| **Kamal** | latest (gem install) | Blue/Green 배포 오케스트레이션 |
| **kamal-proxy** | Kamal 내포 | 프록시 · 무중단 전환 |
| **Cloudflare Tunnel (cloudflared)** | — | 홈서버를 인터넷에 노출 |
| **Tailscale** | — | GHA 에서 Mac mini 연결 (운영 배포 전용) |
| **launchd** | macOS 내장 | cloudflared 자동 기동 |

## CI · CD

| 이름 | 버전 | 용도 |
|---|---|---|
| **GitHub Actions** | — | CI/CD 플랫폼 (`.github/workflows/` 총 13 개) |
| **GitHub Container Registry (GHCR)** | — | 도커 이미지 저장소 |

주요 워크플로우:

| 파일 | 트리거 | 역할 |
|---|---|---|
| `ci.yml` | push/PR | 빌드+테스트, main push 시 artifact |
| `deploy.yml` | `workflow_run` (ci 성공) | GHCR 푸시 → Kamal → cleanup |
| `commit-lint.yml` | PR | commitlint 검증 |
| `docs-check.yml` | push/PR | 문서 계약 테스트 |
| `security-scan.yml` | push/PR | gitleaks 스캔 |
| `release.yml` | `template-v*` 태그 | GitHub Release 생성 |

주요 Actions:

- `actions/checkout@v4` · `actions/setup-java@v5` · `actions/upload-artifact@v4`
- `docker/setup-buildx-action@v3` · `docker/login-action@v4` · `docker/build-push-action@v5`
- `ruby/setup-ruby@v1` · `tailscale/github-action@v4`
- `softprops/action-gh-release@v3` · `actions/delete-package-versions@v5`
- `wagoid/commitlint-github-action@v6`

## 개발 도구

| 이름 | 버전 | 용도 |
|---|---|---|
| **Husky** | 9.0.0 | git hooks 관리 |
| **commitlint CLI** | 19.0.0 | 커밋 메시지 포맷 검증 |
| **commitlint config-conventional** | 19.0.0 | Conventional Commits 규칙 |
| **commitizen** | 4.3.0 | 대화형 커밋 (`npm run cz`) |
| **cz-conventional-changelog** | 3.3.0 | commitizen 어댑터 |

## 외부 서비스

각 서비스가 비어 있을 때의 동작은 `.env.example` (로컬) · `.env.dev.example` · `.env.prod.example` 의 주석에 정리돼 있어요. 대부분의 선택 서비스는 키가 비면 fallback 어댑터로 동작합니다.

| 서비스 | 역할 | 관련 환경변수 |
|---|---|---|
| **Supabase** | 운영 Postgres (대안: 자체 호스트, AWS RDS, Fly.io) | `DB_URL`, `DB_USER`, `DB_PASSWORD` |
| **Cloudflare** | Tunnel · DNS · Access | `CLOUDFLARE_API_TOKEN` (init 이 ZONE/ACCOUNT/TUNNEL ID 자동 추출) |
| **Cloudflare R2** | S3 호환 오브젝트 스토리지 (선택) | `APP_STORAGE_MINIO_*` 재사용 |
| **FCM (Firebase)** | Android/iOS 푸시 | `APP_CREDENTIALS_<SLUG>_FCM_SERVICE_ACCOUNT_JSON` (앱별) |
| **APNs (Apple)** | iOS 인증 토큰 RS256 검증 (소셜 로그인) | `APP_CREDENTIALS_<SLUG>_APPLE_BUNDLE_ID` |
| **Google OAuth** | 소셜 로그인 ID 토큰 검증 | `APP_CREDENTIALS_<SLUG>_GOOGLE_CLIENT_IDS_<N>` |
| **Resend** | 트랜잭셔널 이메일 | `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, `RESEND_FROM_NAME` |
| **SOLAPI (CoolSMS)** | 휴대폰 점유인증 OTP 문자 발송. 키가 비면 LoggingSmsAdapter fallback (콘솔 로그) | `COOLSMS_API_KEY`, `COOLSMS_API_SECRET`, `COOLSMS_FROM` |
| **PortOne** | 한국 PG 통합 SDK (나이스 · 토스 · 이니시스 등 채널 자유 활성). 월 거래 5천만원 미만 무료 | `APP_PAYMENT_PORTONE_API_URL`, `APP_PAYMENT_PORTONE_CUSTOMER_CODE`, `APP_PAYMENT_PORTONE_API_V1_KEY`, `APP_PAYMENT_PORTONE_API_V1_SECRET`, `APP_PAYMENT_PORTONE_API_V2_KEY`, `APP_PAYMENT_PORTONE_WEBHOOK_SECRET`, `APP_PAYMENT_PORTONE_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS` (코드 default 300) |
| **Subscription Scheduler** | 구독 만료 자동 sweep (`@Scheduled` cron). 운영에서만 활성 권장 | `APP_BILLING_SCHEDULER_ENABLED` (default false), `APP_BILLING_SCHEDULER_EXPIRATION_CRON` (default 매시 정각), `APP_BILLING_SCHEDULER_RENEWAL_CRON`, `APP_BILLING_SCHEDULER_RENEWAL_WINDOW` |
| **Apple App Store Server API** | IAP 영수증 검증 + Notification V2 (ADR-022). 한 Apple Developer 계정의 키 1개로 모든 슬러그 공용 — 슬러그별로는 bundle_id 만 다름 | 글로벌: `APP_IAP_APPLE_API_URL`, `APP_IAP_APPLE_KEY_ID`, `APP_IAP_APPLE_ISSUER_ID`, `APP_IAP_APPLE_PRIVATE_KEY`, `APP_IAP_APPLE_ENVIRONMENT`. 슬러그별: `APP_CREDENTIALS_<SLUG>_IAP_APPLE_BUNDLE_ID` |
| **Google Play Developer API** | IAP 구매 검증 + RTDN Pub/Sub (ADR-022). 한 GCP project 의 service account JSON 1개로 모든 슬러그 공용 — 슬러그별로는 package_name 만 다름 | 글로벌: `APP_IAP_GOOGLE_API_URL`, `APP_IAP_GOOGLE_SERVICE_ACCOUNT_JSON`, `APP_IAP_GOOGLE_WEBHOOK_VERIFY_TOKEN`, `APP_IAP_GOOGLE_WEBHOOK_AUDIENCE`, `APP_IAP_GOOGLE_WEBHOOK_ALLOWED_SERVICE_ACCOUNT_EMAILS`. 슬러그별: `APP_CREDENTIALS_<SLUG>_IAP_GOOGLE_PACKAGE_NAME` |
| **Billing Notification** | 갱신 실패/성공/환불 시 Push + Email 채널 토글 (ADR-023/025/031) | `APP_BILLING_NOTIFICATION_PUSH_ENABLED`, `APP_BILLING_NOTIFICATION_EMAIL_ENABLED` |
| **Auth Password Policy** | 비밀번호 정책 (ADR-029) | `APP_SECURITY_PASSWORD_MIN_LENGTH`, `APP_SECURITY_PASSWORD_REQUIRE_UPPERCASE`, `APP_SECURITY_PASSWORD_REQUIRE_DIGIT`, `APP_SECURITY_PASSWORD_REQUIRE_SPECIAL` |
| **Auth 2FA TOTP** | 2단계 인증 (ADR-030, RFC 6238) | `APP_AUTH_TOTP_ISSUER` (Authenticator 앱 표시용 이름) |
| **Audit** | 감사 로그 활성 토글 (ADR-028) | `APP_AUDIT_ENABLED` (default true) |
| **JWT** | 토큰 서명 키 · issuer | `JWT_SECRET` (32자 이상, init 이 자동 generate), `JWT_ISSUER` |
| **Feature toggle** | 도메인별 활성/비활성 (ADR-034 Lite 모드). 모두 default true | `APP_FEATURES_AUDIT`, `APP_FEATURES_PUSH`, `APP_FEATURES_EMAIL`, `APP_FEATURES_PAYMENT`, `APP_FEATURES_IAP`, `APP_FEATURES_2FA`, `APP_FEATURES_BILLING_NOTIFICATION`, `APP_FEATURES_PASSWORD_POLICY` |
| **앱 패키지 prefix** | 파생 앱의 Java package prefix (`new-app.sh` 가 기본 도메인에서 패키지를 자동 도출) | `APP_PACKAGE_PREFIX` (비우면 `com.example.<slug>` placeholder) |
| **Rate Limit** | 분당 요청 한도 (Bucket4j). prod 기본 60/10, local·dev 1000/100 | `APP_RATE_LIMIT_ENABLED`, `APP_RATE_LIMIT_DEFAULT_RPM`, `APP_RATE_LIMIT_STRICT_RPM` |
| **Flyway 모드** | dev/prod 마이그레이션 정책 (ADR-033). prod default VALIDATE_ONLY, dev default AUTO | `APP_FLYWAY_MODE` |
| **Discord** | Alertmanager 알림 채널 | `DISCORD_WEBHOOK_URL` |
| **Tailscale** | GHA 에서 Mac mini VPN | `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET` |
| **GHCR** | 컨테이너 이미지 호스팅 | `GHCR_TOKEN` |
| **Synology NAS** | 백업 대상 (선택) | — |

## 모듈 인벤토리

이 레포의 Gradle 서브프로젝트 목록이에요.

**common/** — 공통 인프라 (도메인 없음):

- `common-logging` — Logback JSON + Loki
- `common-web` — Bucket4j rate limit · 공통 web util
- `common-security` — JJWT · Spring Security 통합
- `common-testing` — Testcontainers · ArchUnit · 계약 테스트 base
- `common-persistence` — QueryDsl · Flyway · JPA 공통

**core/** — 도메인 포트/어댑터, 16 도메인 31 모듈 (`core-admin` 만 `-impl` 단독, 나머지는 `-api`/`-impl` 페어):

- `core-auth` — 인증 (소셜 로그인 · JWT · 2FA TOTP — ADR-030)
- `core-user` — 유저 도메인
- `core-device` — 디바이스 등록
- `core-push` — 푸시 알림 (FCM)
- `core-email` — 이메일 발송 (Resend — ADR-024, auth 에서 추출)
- `core-sms` — 문자 발송 (SOLAPI/CoolSMS, 키 없으면 LoggingSmsAdapter)
- `core-phone-auth` — 휴대폰 점유인증 OTP (발급·검증, `core-sms` 사용 · `app.features.phone-auth` 토글, 기본 ON)
- `core-audit` — 감사 로그 (AOP `@Audited` — ADR-028)
- `core-billing` — 구독/플랜 정책 + 갱신 실패 알림 (ADR-019/020/021/023/025/031)
- `core-iap` — Apple App Store Server V2 + Google Play RTDN (ADR-022)
- `core-payment` — PG 결제 채널 (포트원 어댑터)
- `core-storage` — 오브젝트 스토리지
- `core-attachment` — 파일 첨부 메타 + 검역/soft-delete 상태 전이 (`core-storage` 사용)
- `core-content` — 공유 게시물 (공개 게시판 + 모더레이션)
- `core-analytics` — 제품 이벤트 (`@TrackEvent` 원본 적재 + 일별 롤업)
- `core-admin` — 운영 콘솔 `/api/admin/*` (RBAC · cross-app 조회 — ADR-039, `-impl` 단독)

**bootstrap/** — Fat JAR 조립 지점 (모든 `-impl` 의존 허용, ArchUnit r-series 로 방어)

**apps/** — `apps/app-<slug>` 각 앱 도메인 로직 (템플릿엔 비어 있고, 파생 레포에서 생성)

**build-logic/** — Gradle convention plugin 5 종

---

## 관련 문서

- [`용어 사전`](./glossary.md) — 이 목록의 각 이름이 무엇을 하는지 설명
- [`Architecture`](../structure/architecture.md) — 기술 스택이 어떻게 엮여 있는지
- [`Infrastructure`](../production/deploy/infrastructure.md) — 운영 인프라 결정 근거
- [`CI/CD Flow`](../production/deploy/ci-cd-flow.md) — 파이프라인 전체 흐름
