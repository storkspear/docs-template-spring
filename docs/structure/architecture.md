# Architecture Reference

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~30분

이 문서는 `template-spring` 의 **실제 구조** 를 설명해요. **무엇이 어디에 있고, 무슨 역할을 하며, 어떻게 연결되는지** 가 목적이에요. 각 결정의 **이유** (왜 이렇게 설계했는지) 는 [`philosophy/`](../philosophy/README.md) 디렉토리의 20 개 ADR 에 기록되어 있습니다.

> **독자 대상**: Spring 실무 중급 (Level 2). 이 문서는 하루 안에 전체 구조를 이해하고 특정 모듈을 수정할 수 있도록 안내해요. Level 0~1 은 [`Onboarding — 템플릿 첫 사용 가이드`](../start/onboarding.md) 를 먼저 참고하세요.

> **ADR 첫 독서 안내** — 본 reference 의 결정 근거 (ADR) 진입 시 자주 등장하는 핵심 패턴 미리 알아두면 좋아요:
> - [`Modular Monolith`](../reference/glossary.md#아키텍처-용어) — 한 프로세스 안의 격리 구획. ADR-001 의 핵심
> - [`Port / Adapter`](../reference/glossary.md#아키텍처-용어) — `-api` (Port = 인터페이스 contract) / `-impl` (Adapter = 구현체) 분리. ADR-003, ADR-011
> - [`AbstractRoutingDataSource`](../reference/glossary.md#데이터베이스) — Spring 의 다중 DataSource 라우팅. ADR-018 (멀티테넌트 schema)
> - [`Multitenant`](../reference/glossary.md#아키텍처-용어) / [`Tenant`](../reference/glossary.md#아키텍처-용어) — 한 DB 의 여러 schema 격리. 본 레포는 *schema-per-app* 방식

---

## 전체 구성 요약

모듈러 모놀리스 구조의 Spring Boot 백엔드예요. Gradle 멀티모듈로 내부가 나뉘어 있고, `bootstrap` 모듈이 전체를 조립해서 **단일 fat JAR** 로 빌드됩니다. ([`ADR-001 · 모듈러 모놀리스`](../philosophy/adr-001-modular-monolith.md))

### 모듈 4 종류

| 종류 | 위치 | 역할 | 상태 |
|---|---|---|---|
| `common/*` | `common/common-*/` | 뼈대 유틸리티 (웹/보안/로깅/영속성/스토리지/테스트) | 상태 없음 |
| `core/*` | `core/core-*-api/` + `core/core-*-impl/` | 공유 플랫폼 기능 (인증/이메일/유저/디바이스/푸시/billing/iap/payment/스토리지/감사) | 상태 있음, -api / -impl 쌍 |
| `apps/*` | `apps/app-<slug>/` | 앱별 도메인 로직 | 템플릿엔 비어있음. 파생 레포에서 `new-app.sh` 로 추가 |
| `bootstrap` | `bootstrap/` | Spring Boot 엔트리 포인트 | 모든 core-impl + common 을 조립 |

### 주요 기술 스택

| 영역 | 기술 | 근거 ADR |
|---|---|---|
| 언어/런타임 | Java 21, Spring Boot 3.5.13 | — |
| 빌드 | Gradle 8.x 멀티모듈 + convention plugins | [`ADR-004`](../philosophy/adr-004-gradle-archunit.md) |
| 데이터 액세스 | Spring Data JPA / Hibernate + QueryDsl 5.1.0 (Jakarta) | [`ADR-009`](../philosophy/adr-009-base-entity.md), [`ADR-010`](../philosophy/adr-010-search-condition.md) |
| DB | PostgreSQL 16 (로컬 Docker / 운영 Supabase Seoul) | [`ADR-005`](../philosophy/adr-005-db-schema-isolation.md) |
| 인증 | jjwt 0.13 (HS256) + Spring Security (stateless) + BCrypt | [`ADR-006`](../philosophy/adr-006-hs256-jwt.md) |
| 외부 서비스 | Resend (이메일), FCM (푸시), MinIO/R2 (스토리지) | [`ADR-007`](../philosophy/adr-007-solo-friendly-operations.md) |
| API 문서화 | springdoc-openapi | — |
| 테스트 | JUnit 5, AssertJ, Mockito, Testcontainers, ArchUnit | [`ADR-014`](../philosophy/adr-014-no-delegation-mock.md) |
| 커밋/버전 | commitlint + husky + Conventional Commits + template-v* 태그 | [`ADR-015`](../philosophy/adr-015-conventional-commits-semver.md) |

### core-* 와 apps/* 의 역할 분리

**`core-*`** — 모든 앱이 공유하는 **플랫폼 로직 라이브러리** 예요. 인증 (2FA TOTP 포함), 이메일 발송 (Resend, [`ADR-024`](../philosophy/adr-024-email-domain-extraction.md)), 유저 관리, 디바이스 등록, 푸시 (FCM), billing (구독/플랜 정책), iap (Apple/Google 채널 + webhook bearer 검증), payment (PG=포트원 채널), 스토리지 (MinIO/R2), 감사 로그 (AOP, [`ADR-028`](../philosophy/adr-028-audit-log-domain.md)) 가 들어 있습니다. 템플릿에 포함되고, 파생 레포 생성 시 그대로 상속됩니다.

**`apps/app-<slug>`** — 각 앱의 **고유 도메인 로직 + 해당 앱의 인증/유저 Controller** 예요. 파생 레포에서만 작성되고, 템플릿에는 빈 디렉토리만 존재해요 ([`ADR-013`](../philosophy/adr-013-per-app-auth-endpoints.md)).

**apps 가 core-* 를 사용하는 방식**:

- `core-auth-api.AuthPort` 인터페이스 주입 → 인증 로직 위임
- `core-user-api.UserPort` 인터페이스 주입 → 유저 조회/수정 위임
- `core-*-impl` 에는 **직접 접근 불가** (Gradle convention plugin + ArchUnit 양쪽 강제)
- `common-*` 유틸리티는 자유롭게 사용 (`ApiResponse`, `@CurrentUser`, `QueryDslPredicateBuilder` 등)
- 각 앱 모듈은 **자기 schema 전용 DataSource** 를 직접 주입 ([`ADR-005`](../philosophy/adr-005-db-schema-isolation.md))

### 앱 추가 흐름

```
1. 파생 레포에서: ./tools/new-app/new-app.sh gymlog
2. apps/app-gymlog/ 모듈 자동 생성:
     - GymlogAuthController (/api/apps/gymlog/auth/*)
     - GymlogDataSourceConfig (gymlog schema 전용)
     - GymlogAppAutoConfiguration
     - V001~V006 마이그레이션 (users, social_identities, refresh_tokens 등)
     - build.gradle
3. 도메인 코드 작성 (controller / service / entity / repository / Flyway)
4. core-* 는 건드리지 않음 — 새 기능이 core 에 필요하면 별도 ADR
```

### DB 전략 — 동일 소스코드, 독립 데이터

하나의 파생 레포 = 하나의 Postgres 인스턴스예요. 인스턴스 **안에서** 앱별 schema 로 격리해요 ([`ADR-005`](../philosophy/adr-005-db-schema-isolation.md)).

| 요소 | 같은 파생 레포 내 | 다른 파생 레포 간 |
|---|---|---|
| core-* 소스코드 | 동일 | 동일 (같은 템플릿 기반) |
| apps/* 소스코드 | 파생 레포 고유 | 파생 레포 고유 |
| Postgres 인스턴스 | 공유 (하나) | 별도 |
| 유저/인증/도메인 테이블 | 앱 schema 별 독립 | 완전 별도 |

schema 실제 구조와 마이그레이션 상세는 [`인프라 (Infrastructure)`](../production/deploy/infrastructure.md) 의 §10 을 참조하세요.

---

## 파일 트리 (주석 포함)

```
template-spring/
│
├── .editorconfig                      # 에디터 공통 설정
├── .env.example                       # 환경변수 키 목록 (플레이스홀더)
├── .gitignore                         # 빌드 산출물, IDE 파일, .env 제외
├── .gitmessage                        # git commit 템플릿 (type/scope/subject 가이드)
├── .husky/commit-msg                  # commitlint + AI coauthor 차단
├── CHANGELOG.md                       # Keep a Changelog 포맷, [Unreleased] 섹션 필수
├── commitlint.config.mjs              # 10 type × 15 scope × 72자 제한
├── Dockerfile                         # bootstrap fat JAR 빌드 + 실행
├── docker-entrypoint.sh               # migration-only / 앱 기동 단일 entrypoint
├── package.json                       # husky, commitlint, commitizen 의존성
├── README.md                          # 템플릿 소개
│
├── .github/
│   └── workflows/                     # 10 개 workflow
│       ├── ci.yml                     # 빌드 + 테스트 + ArchUnit
│       ├── deploy.yml                 # main → workflow_run 게이트 → 배포
│       ├── release.yml                # template-v* 태그 → GitHub Release
│       ├── tag-validate.yml           # 태그 포맷 정규식 검증
│       ├── commit-lint.yml            # PR 커밋 포맷 재검증
│       ├── pr-title.yml               # PR 제목 Conventional Commits 강제
│       ├── changelog-check.yml        # CHANGELOG.md 업데이트 여부 검증
│       ├── release-pr-validate.yml    # 릴리스 PR 체크
│       ├── security-scan.yml          # gitleaks + Dependabot
│       └── docs-check.yml             # 문서 링크 검증
│
├── build.gradle                       # 루트 빌드 설정 (공통 plugin, Java 21)
├── settings.gradle                    # Gradle 멀티모듈 선언
├── gradle.properties                  # JVM 옵션, 병렬 빌드 등
├── gradlew, gradlew.bat               # Gradle wrapper
│
├── build-logic/                       # Convention plugin 소스 (ADR-004)
│   └── src/main/groovy/
│       ├── factory.common-module.gradle        # common-* 모듈 공통 설정
│       ├── factory.core-api-module.gradle      # core-*-api 전용 (JPA 의존 금지)
│       ├── factory.core-impl-module.gradle     # core-*-impl 전용
│       ├── factory.app-module.gradle           # apps/app-<slug> 전용
│       └── factory.bootstrap-module.gradle     # bootstrap 전용
│
├── docs/                              # 문서 루트 (현재 9 그룹)
│   ├── README.md                      # 문서 전체 진입점
│   ├── onboarding/                    # L0 — 처음 쓰는 사람 (3~10분)
│   │   ├── README.md                  # Developer Journey 책 목차
│   │   ├── getting-started.md         # Level 0 진입점
│   │   ├── five-minute-tour.md
│   │   ├── what-is-this.md
│   │   ├── first-run.md               # 첫 실행 결과 해석
│   │   ├── first-change.md            # 첫 코드 수정 (nickname 컬럼 추가)
│   │   └── first-deploy.md            # 첫 운영 배포 맛보기
│   ├── start/                         # L1 — 1~2시간 시작 가이드
│   │   ├── onboarding.md              # 로컬 개발 환경 셋업
│   │   ├── dogfood-setup.md           # 도그푸딩 정상 흐름
│   │   ├── dogfood-faq.md             # 도그푸딩 FAQ
│   │   ├── dogfood-pitfalls.md        # 12 함정 reference
│   │   ├── dogfood-walkthrough.md     # 시간 순 narrative + 정착된 패턴
│   │   ├── cli-guide.md               # factory wrapper / <repo> 명령
│   │   ├── app-scaffolding.md         # new-app.sh 상세
│   │   ├── social-auth-setup.md       # Google/Apple/Kakao/Naver
│   │   └── cross-repo-cherry-pick.md  # 템플릿 → 파생 레포 동기화
│   ├── structure/                     # L2 — 코드 구조
│   │   ├── architecture.md            # 본 문서
│   │   ├── module-dependencies.md     # 모듈 의존 매트릭스
│   │   ├── architecture-rules.md      # ArchUnit r1~r22
│   │   ├── multitenant-architecture.md# per-app schema + DataSource
│   │   └── jwt-authentication.md      # JWT + SecurityConfig + RefreshToken
│   ├── convention/                    # L2 — 코딩 규약
│   │   ├── README.md
│   │   ├── design-principles.md
│   │   ├── naming.md
│   │   ├── dto-factory.md
│   │   ├── records-and-classes.md
│   │   ├── code-comments.md
│   │   ├── git-workflow.md
│   │   └── exception-handling.md
│   ├── api-and-functional/            # L2 — API 계약 + 기능 가이드
│   │   ├── api/                       # API 응답/JSON/버저닝/Flutter 통합/Swagger
│   │   └── functional/                # 푸시, 이메일 인증, 스토리지, billing/IAP/payment, rate limit
│   ├── production/                    # L2.5+ — 운영
│   │   ├── deploy/                    # runbook, infrastructure, decisions-infra, flyway-runbook, ci-cd-flow, deployment
│   │   ├── setup/                     # secret-chain-4stage, key-issuance, key-rotation, mac-mini-setup, monitoring-setup, storage-setup, storage-bucket-isolation
│   │   ├── operations/                # feature-toggle 등 운영자 가이드
│   │   └── test/                      # contract-testing, testing-strategy
│   ├── philosophy/                    # L3 — 20 개 ADR
│   │   ├── README.md                  # ADR 인덱스 + 테마별 그룹
│   │   └── adr-001 ~ adr-035.md       # Architecture Decision Records
│   ├── planned/                       # backlog (미완료 / 향후 작업)
│   └── reference/                     # 참조 사전
│       ├── glossary.md
│       ├── environment.md
│       ├── STYLE_GUIDE.md
│       └── edge-cases.md
│
├── common/                            # 상태 없는 뼈대 유틸리티
│   │
│   ├── common-logging/                # 로깅 표준 (MDC, logback JSON/콘솔)
│   │   └── src/main/java/com/factory/common/logging/
│   │       ├── MdcFilter.java                     # requestId 주입
│   │       └── LoggingAutoConfiguration.java
│   │
│   ├── common-web/                    # 웹 계층 공통
│   │   └── src/main/java/com/factory/common/web/
│   │       ├── ApiEndpoints.java                  # 경로 상수 (/api/apps/*, /api/core/*)
│   │       ├── AppSlugExtractor.java              # URL path 에서 {appSlug} 추출
│   │       ├── WebAutoConfiguration.java
│   │       ├── response/
│   │       │   ├── ApiResponse.java               # { data, error } 표준 응답
│   │       │   └── ApiError.java                  # { code, message, details }
│   │       ├── exception/
│   │       │   ├── ErrorInfo.java                 # 도메인 에러 enum 인터페이스
│   │       │   ├── BaseException.java             # 비즈니스 예외 부모 (abstract)
│   │       │   ├── CommonException.java
│   │       │   ├── CommonError.java               # CMN_001~008, CMN_429
│   │       │   └── GlobalExceptionHandler.java    # → ApiError 통합 변환
│   │       ├── pagination/                        # PageRequest, PageResponse
│   │       ├── search/                            # POST /search DTO (QueryDsl 비의존)
│   │       │   ├── PageListRequest.java           # conditions + page + sort
│   │       │   └── SortFieldMapper.java           # 허용 정렬 필드 인터페이스
│   │       ├── ratelimit/                         # Bucket4j 기반 레이트 리미터
│   │       └── metrics/                           # Micrometer (appSlug 태깅)
│   │
│   ├── common-security/               # 인증/인가 공통
│   │   └── src/main/java/com/factory/common/security/
│   │       ├── jwt/
│   │       │   ├── JwtService.java                # HS256 서명/검증 (ADR-006)
│   │       │   ├── JwtProperties.java             # 32자 이상 검증
│   │       │   └── JwtAuthFilter.java             # OncePerRequestFilter
│   │       ├── AppSlugVerificationFilter.java     # URL slug vs JWT claim (ADR-012)
│   │       ├── AppSlugMdcFilter.java              # MDC 에 appSlug 주입
│   │       ├── CurrentUser.java                   # @CurrentUser 어노테이션
│   │       ├── CurrentUserArgumentResolver.java   # MVC 인자 리졸버
│   │       ├── AuthenticatedUser.java             # { userId, email, appSlug, role }
│   │       ├── PasswordHasher.java                # BCrypt 래퍼
│   │       ├── SecurityConfig.java                # stateless + 필터 체인 등록
│   │       └── SecurityAutoConfiguration.java
│   │
│   ├── common-persistence/            # 영속성 레이어 공통 (ADR-005, 009, 010)
│   │   └── src/main/java/com/factory/common/persistence/
│   │       ├── AbstractAppDataSourceConfig.java   # 앱별 DataSource 빌더
│   │       ├── QueryDslAutoConfiguration.java     # JPAQueryFactory bean
│   │       ├── QueryDslPredicateBuilder.java      # Map 기반 동적 WHERE (ADR-010)
│   │       ├── QueryDslSortBuilder.java           # 허용 정렬 필드 매핑
│   │       ├── QueryUtil.java                     # 헬퍼
│   │       └── entity/
│   │           └── BaseEntity.java                # @MappedSuperclass (ADR-009)
│   │
│   └── common-testing/                # 통합 테스트 + ArchUnit 베이스
│       └── src/
│           ├── main/java/com/factory/common/testing/
│           │   ├── AbstractIntegrationTest.java   # Testcontainers + @SpringBootTest
│           │   ├── architecture/
│           │   │   └── ArchitectureRules.java     # 22 개 ArchUnit 규칙
│           │   └── fixture/
│           └── test/                              # 셀프 테스트
│
├── core/                              # 플랫폼 기능 모듈 (api/impl 분리)
│   │
│   ├── core-user-api/                 # 유저 포트
│   │   └── UserPort.java                          # + dto/ + exception/
│   │
│   ├── core-user-impl/                # 유저 구현
│   │   └── src/
│   │       ├── main/java/com/factory/core/user/impl/
│   │       │   ├── UserServiceImpl.java           # UserPort 구현
│   │       │   ├── entity/
│   │       │   │   ├── User.java                  # toSummary/toProfile/toAccount (ADR-016)
│   │       │   │   ├── SocialIdentity.java
│   │       │   │   └── SocialIdentityId.java      # 복합키
│   │       │   ├── repository/
│   │       │   ├── controller/UserController.java # 레퍼런스 소스 (런타임 미등록)
│   │       │   └── UserAutoConfiguration.java
│   │       └── resources/db/migration/core/
│   │           ├── V001__init_users.sql           # 템플릿 기준선 (users + totp + email index)
│   │           └── V002__init_social_identities.sql
│   │
│   ├── core-auth-api/                 # 인증 포트 (signup/signin/2FA/refresh/withdraw)
│   │   └── src/main/java/com/factory/core/auth/api/
│   │       ├── AuthPort.java                      # ADR-013 + ADR-030 (2FA)
│   │       ├── dto/                               # Request/Response DTO + TwoFactor* (setup/verify/login)
│   │       └── exception/                         # AuthError (ATH_001~ATH_010 + 2FA error codes)
│   │
│   ├── core-auth-impl/                # 인증 로직 라이브러리
│   │   └── src/main/java/com/factory/core/auth/impl/
│   │       ├── AuthServiceImpl.java               # AuthPort 구현 (서비스 조합)
│   │       ├── service/
│   │       │   ├── EmailAuthService.java          # 이메일 signup/signin (ValidPassword 정책 — ADR-029)
│   │       │   ├── AppleSignInService.java        # Apple identity token 검증 (RS256)
│   │       │   ├── AppleJwksClient.java           # Apple JWKS 조회 + 캐시
│   │       │   ├── GoogleSignInService.java       # Google id token 검증
│   │       │   ├── RefreshTokenService.java       # 회전 + 탈취 감지
│   │       │   ├── EmailVerificationService.java  # core-email-api 의 EmailPort 사용 (ADR-024)
│   │       │   ├── PasswordResetService.java
│   │       │   └── WithdrawService.java           # soft delete
│   │       ├── totp/                              # 2FA TOTP (ADR-030, RFC 6238)
│   │       │   ├── TotpService.java               # secret 생성 + HOTP/TOTP 코드 검증
│   │       │   └── TwoFactorService.java          # setup/verify/disable + backup codes (8개)
│   │       ├── password/
│   │       │   └── ValidPassword.java             # Bean Validation custom (ADR-029)
│   │       ├── entity/
│   │       │   ├── RefreshToken.java
│   │       │   ├── EmailVerificationToken.java
│   │       │   ├── PasswordResetToken.java
│   │       │   └── TwoFactorBackupCode.java       # backup codes (1회용 hash)
│   │       ├── repository/
│   │       ├── controller/
│   │       │   └── AuthController.java            # 레퍼런스 소스 (런타임 미등록, ADR-013)
│   │       └── AuthAutoConfiguration.java         # Controller 는 @Import 안 함
│   │
│   ├── core-device-api/               # 디바이스 포트 (푸시 토큰 등록)
│   │   └── DevicePort.java + dto/
│   │
│   ├── core-device-impl/              # 디바이스 구현
│   │   └── src/main/java/com/factory/core/device/impl/
│   │       ├── DeviceServiceImpl.java
│   │       ├── entity/Device.java
│   │       ├── repository/DeviceRepository.java
│   │       └── controller/DeviceController.java   # POST/DELETE /api/core/devices
│   │
│   ├── core-push-api/                 # 푸시 포트
│   │   └── PushPort.java + dto/                   # sendToUser/sendToDevices/sendToTopic
│   │
│   ├── core-push-impl/                # FCM 구현
│   │   └── src/main/java/com/factory/core/push/impl/
│   │       ├── FcmPushAdapter.java                # Firebase Admin SDK 래퍼
│   │       ├── NoOpPushAdapter.java               # FCM 미설정 환경 fallback
│   │       ├── FcmProperties.java
│   │       ├── PushService.java                   # Device 조회 → FCM 전송 조율
│   │       └── PushAutoConfiguration.java
│   │
│   ├── core-storage-api/              # 스토리지 포트
│   │   └── StoragePort.java + dto/ + model/ + exception/
│   │
│   ├── core-storage-impl/             # MinIO/R2 스토리지 구현
│   │   └── src/main/java/com/factory/core/storage/impl/
│   │       ├── MinIOStorageAdapter.java           # S3 호환
│   │       ├── InMemoryStorageAdapter.java        # 테스트용 fallback
│   │       ├── BucketProvisioner.java             # 버킷 + lifecycle 자동 프로비저닝
│   │       ├── MinioProperties.java
│   │       └── StorageAutoConfiguration.java
│   │
│   ├── core-email-api/                # 이메일 발송 포트 (ADR-024)
│   │   └── EmailPort.java + exception/EmailError (EMAIL_001~)
│   │
│   ├── core-email-impl/               # 이메일 발송 구현 (Resend)
│   │   └── src/main/java/com/factory/core/email/impl/
│   │       ├── ResendEmailAdapter.java            # EmailPort 구현 (Resend HTTP API)
│   │       ├── LoggingEmailAdapter.java           # dev fallback (콘솔 + raw token 노출)
│   │       ├── ResendProperties.java              # RESEND_API_KEY / RESEND_FROM_ADDRESS / RESEND_FROM_NAME
│   │       └── EmailAutoConfiguration.java
│   │
│   ├── core-audit-api/                # 감사 로그 포트 (ADR-028)
│   │   ├── AuditPort.java                         # record/recordWithResult
│   │   ├── AuditResult.java                       # SUCCESS / FAILURE
│   │   └── dto/AuditRecordRequest
│   │
│   ├── core-audit-impl/               # 감사 로그 구현 (AOP)
│   │   └── src/main/java/com/factory/core/audit/impl/
│   │       ├── AuditAspect.java                   # @Around("@annotation(Audited)") 자동 기록
│   │       ├── AuditServiceImpl.java              # AuditPort 구현
│   │       ├── entity/AuditLog.java               # <slug>.audit_logs
│   │       ├── repository/AuditLogRepository.java
│   │       └── AuditAutoConfiguration.java
│   │
│   ├── core-billing-api/              # 구독/플랜 정책 포트 (ADR-019)
│   │   ├── BillingPort.java                       # activateFromPayment / findActiveSubscription / cancelSubscription / handleWebhook
│   │   ├── SubscriptionState / PaymentChannel / PaymentRecordStatus  # 도메인 enum (api 루트 — ArchUnit r18 정합)
│   │   ├── dto/ {Plan,Subscription,PaymentRecord}Dto                 # records
│   │   └── exception/ BillingError (BIL_001~BIL_010) + BillingException
│   │
│   ├── core-billing-impl/             # 구독 정책 layer (ADR-020 + ADR-021/023/025/026/031)
│   │   ├── BillingServiceImpl.java                # TransactionTemplate phase 분리
│   │   ├── entity/ {Plan,Subscription,PaymentRecord,WebhookEvent,RenewalAttempt} (BaseEntity 상속)
│   │   ├── repository/ Spring Data JPA
│   │   ├── scheduler/SubscriptionExpirationScheduler  # @Scheduled cron + slug iter
│   │   ├── listener/SubscriptionNotificationListener  # 갱신 실패/성공 → Push + Email 발송
│   │   ├── notification/                          # 사용자 알림 toggle (ADR-031)
│   │   │   ├── NotificationKind.java              # RENEWAL_FAILED / RENEWAL_SUCCESS / REFUND
│   │   │   ├── NotificationPreference.java        # 사용자별 채널 on/off
│   │   │   └── NotificationPreferenceService.java
│   │   ├── BillingNotificationProperties.java     # APP_BILLING_NOTIFICATION_*
│   │   └── BillingAutoConfiguration
│   │
│   ├── core-iap-api/                  # IAP 채널 포트 (Apple/Google receipt 검증)
│   │   └── IapPort.java + dto/
│   │
│   ├── core-iap-impl/                 # IAP 구현 (ADR-022 + Google Pub/Sub webhook)
│   │   └── src/main/java/com/factory/core/iap/impl/
│   │       ├── IapAdapter.java                    # IapPort 구현 (채널 라우팅)
│   │       ├── AppleAppStoreAdapter.java          # Apple App Store Server API
│   │       ├── AppleJwsVerifier.java              # Apple V2 signedPayload JWS 검증
│   │       ├── AppleNotificationDecoder.java      # ASS Notification V2 디코드
│   │       ├── GooglePlayAdapter.java             # Google Play Developer API
│   │       ├── GoogleNotificationDecoder.java     # RTDN Pub/Sub 메시지 디코드
│   │       ├── google/                            # Google Pub/Sub push 인증
│   │       │   ├── GoogleWebhookAuthFilter.java   # Bearer JWT 검증 (RS256 + JWKS + audience + email)
│   │       │   ├── GoogleJwksClient.java          # Google JWKS 조회 + 캐시
│   │       │   └── GoogleWebhookProperties.java
│   │       ├── StubIapAdapter.java                # 미설정 환경 graceful 503
│   │       ├── IapProperties.java
│   │       ├── IapAppCredentialProperties.java    # 앱별 Apple/Google 자격
│   │       └── IapAutoConfiguration.java
│   │
│   ├── core-payment-api/              # PG 채널 포트 (포트원)
│   │   ├── PaymentPort.java                       # verify / refund
│   │   ├── PortOneWebhookVerifier.java            # HMAC SHA-256 + timestamp
│   │   ├── PaymentStatus.java                     # READY / PAID / FAILED / CANCELLED / VBANK_ISSUED
│   │   └── dto/ PaymentResult / RefundRequest / RefundResult / WebhookMessage
│   │
│   └── core-payment-impl/             # PortOneAdapter (REST V1)
│       ├── PortOneAdapter.java                    # PaymentPort 구현
│       ├── PortOneApiClient.java                  # 토큰 캐시 + verify/cancel
│       ├── PortOneProperties.java                 # APP_PAYMENT_PORTONE_API_V1_KEY/SECRET / V2_KEY / WEBHOOK_SECRET
│       ├── StubPaymentAdapter.java                # graceful 503 (key 미설정 시)
│       └── PaymentAutoConfiguration               # PortOneProdConfigGuard (prod 부팅 fail-fast)
│
├── apps/                              # 앱별 도메인 모듈
│   ├── README.md                      # "new-app.sh 로 추가" 안내
│   └── (파생 레포에서 app-<slug> 디렉토리 자동 생성)
│
├── bootstrap/                         # 단일 Spring Boot JAR 진입점
│   └── src/
│       ├── main/
│       │   ├── java/com/factory/bootstrap/
│       │   │   ├── FactoryApplication.java        # @SpringBootApplication
│       │   │   ├── controller/
│       │   │   │   ├── HealthController.java      # GET /health (무인증)
│       │   │   │   └── VersionController.java     # GET /version (무인증)
│       │   │   └── config/
│       │   │       ├── CoreDataSourceConfig.java  # @Primary, slug="core"
│       │   │       ├── OpenApiConfig.java         # Swagger UI
│       │   │       └── JpaConfig.java
│       │   └── resources/
│       │       ├── application.yml                # 공통 기본값 (port 8081, APP_FLYWAY_MODE default = AUTO)
│       │       ├── application-dev.yml            # 로컬 Postgres
│       │       ├── application-prod.yml           # Supabase 연결 + prod 엄격 endpoint
│       │       └── application-test.yml           # Testcontainers
│       └── test/
│           └── BootstrapArchitectureTest.java     # ArchUnit r1~r22 바인딩
│
├── tools/
│   ├── init-server.sh                 # 1·2회차 부팅 (.env / .env.prod / Secrets push)
│   ├── new-app/
│   │   └── new-app.sh                 # 새 앱 스캐폴딩 (schema/role/Flyway/Controller 자동)
│   ├── deploy.sh                      # origin/main SHA 추출 + kamal --version 명시
│   ├── force-clear-server.sh          # 5단계 confirm + 인프라 + 데이터 + 관측성 정리
│   ├── ci-test.sh                     # 5-stage 로컬 검증 (spotless / build / docs-contract / docs-unit / gitleaks)
│   ├── lib/
│   │   ├── cloudflare.sh              # cloudflare_register_hostname (NS polling + 자동 재생성)
│   │   └── common.sh                  # detect_factory_alias 등 helper
│   ├── dogfooding/
│   │   └── setup.sh                   # Trial 환경 자동화 (GHA + Mac mini + GHCR, 1회성 운영 도구)
│   └── docs-check/                    # 문서 링크/메타 검증
│
├── factory                             # wrapper 진입점 (FACTORY_ALIAS export)
│
└── infra/
    ├── docker-compose.dev.yml                     # 로컬 Postgres 16 + MinIO
    ├── docker-compose.observability.yml           # Prometheus + Loki + Grafana + Alertmanager
    ├── scripts/
    │   ├── init-core-schema.sql                   # core schema + core_app role
    │   ├── init-app-schema.sql                    # 앱별 schema + role (멱등)
    │   ├── keep-alive.sh                          # Supabase Free 활성 유지
    │   └── backup-to-nas.sh.example
    ├── prometheus/                                # 메트릭 스크래핑 설정
    ├── loki/                                      # 로그 집계 설정
    ├── grafana/                                   # 대시보드 provisioning
    └── alertmanager/                              # 알림 라우팅
```

---

## 모듈 의존 그래프

### 의존 방향

의존은 **아래로만** 흐릅니다. 상위 모듈이 하위 모듈을 import 하고, 역방향 의존은 금지됩니다.

```
bootstrap                              # 최상위 (모든 것을 조립)
   │
   ├──→ common-logging                 # 하위 레이어 (상태 없음)
   ├──→ common-web
   ├──→ common-security
   ├──→ common-persistence
   │
   ├──→ core-user-impl                 # core impl: 각 모듈이 api + impl 쌍
   │       ├──→ common-web             #   impl 은 common-* 를 의존
   │       ├──→ common-security
   │       ├──→ common-persistence
   │       └──→ core-user-api          #   impl 은 자기 api 를 의존
   │
   ├──→ core-auth-impl                 # 서비스 라이브러리 (Controller 는 레퍼런스만)
   │       ├──→ common-*
   │       ├──→ core-auth-api          #   자기 api
   │       ├──→ core-user-api          #   다른 core 는 api 만 의존 (impl 금지)
   │       └──→ core-email-api         #   EmailPort (인증 메일/비번 재설정 — ADR-024)
   │
   ├──→ core-device-impl
   │       ├──→ common-*
   │       ├──→ core-device-api
   │       └──→ core-user-api
   │
   ├──→ core-push-impl
   │       ├──→ core-push-api
   │       └──→ core-device-api
   │
   ├──→ core-storage-impl
   │       ├──→ common-*
   │       └──→ core-storage-api
   │
   ├──→ core-email-impl                # 이메일 어댑터 (ADR-024)
   │       └──→ core-email-api
   │
   ├──→ core-audit-impl                # 감사 로그 (ADR-028)
   │       └──→ core-audit-api
   │
   ├──→ core-billing-impl              # 구독 정책 layer (ADR-020/021/023/025/031)
   │       ├──→ core-billing-api
   │       ├──→ core-payment-api       #   PaymentPort.verify (PG 결제 검증 → activateFromPayment)
   │       ├──→ core-user-api          #   user FK
   │       ├──→ core-push-api          #   갱신 실패/성공 푸시 (ADR-023)
   │       └──→ core-email-api         #   갱신 실패/성공 이메일 (ADR-025)
   │
   ├──→ core-iap-impl                  # IAP 채널 (Apple ASS V2 + Google RTDN, ADR-022)
   │       ├──→ core-iap-api
   │       └──→ core-billing-api       #   IAP webhook → BillingPort.handleWebhook
   │
   ├──→ core-payment-impl              # PG 채널 = 포트원
   │       └──→ core-payment-api
   │
   └──→ apps/app-<slug>                # 파생 레포에서 추가
           ├──→ common-*               #   공통 유틸
           ├──→ core-auth-api          #   AuthPort 주입
           ├──→ core-user-api          #   UserPort 주입
           └──→ core-device-api        #   DevicePort 주입 (선택)
           # core-*-impl 금지 (Gradle + ArchUnit 강제)
```

### 강제 메커니즘 (2단계)

**1단계 — Gradle convention plugin**

`build-logic/` 의 역할별 convention plugin 이 `afterEvaluate` 에서 `ProjectDependency` 를 순회하며 허용/금지 규칙을 검증합니다. 위반 시 `GradleException` 을 throw 해서 **컴파일이 시작되지도 않아요**.

| Plugin | 적용 대상 | 주요 제약 |
|---|---|---|
| `factory.common-module` | `common/common-*` | JPA 의존 선택적 (common-persistence 만) |
| `factory.core-api-module` | `core/core-*-api` | JPA 의존 **금지**, Spring context 의존 금지 |
| `factory.core-impl-module` | `core/core-*-impl` | 다른 `core-*-impl` 의존 금지 |
| `factory.app-module` | `apps/app-<slug>` | `core-*-impl` 의존 **금지**, 다른 `apps/*` 의존 금지 |
| `factory.bootstrap-module` | `bootstrap` | 모든 core-impl + common 조립 |

**2단계 — ArchUnit CI**

Gradle 이 잡지 못하는 패턴 (같은 패키지 이름 규칙, Entity 노출 금지, `*Mapper` 클래스 금지 등) 은 ArchUnit 22 개 규칙 (r1~r22) 으로 빌드 시 검증합니다. 상세는 [`Architecture Rules (ArchUnit)`](./architecture-rules.md) 를 참조하세요.

두 단계 설계의 근거는 [`ADR-004 · Gradle + ArchUnit`](../philosophy/adr-004-gradle-archunit.md) 에 정리되어 있습니다.

---

## 요청 플로우

### 일반 인증 요청 — `GET /api/apps/sumtally/users/me`

```
클라이언트 (Flutter 앱)
      │ HTTPS
      ▼
Cloudflare 엣지 (TLS 종료, DDoS 방어)
      │
      ▼
Cloudflare Tunnel → 맥미니
      │
      ▼
Spring Boot (bootstrap JAR, prod 컨테이너 내부 :8080 — 로컬 bootRun 은 8081)
      │
      ▼
[MdcFilter]                             (common-logging)
      │ requestId 생성 → MDC 주입
      ▼
[JwtAuthFilter]                         (common-security)
      │ Authorization: Bearer <token> 파싱
      │ JwtService.validateAccessToken() — HS256 서명 + issuer + exp 검증
      │ SecurityContext ← AuthenticatedUser { userId, email, appSlug, role }
      ▼
[AppSlugMdcFilter]                      (common-security)
      │ URL path 의 {appSlug} 를 MDC 에 추가 (로그 태깅)
      ▼
[AppSlugVerificationFilter]             (common-security)
      │ URL path slug == JWT appSlug claim 검증
      │ 불일치 → 403 "app mismatch: JWT issued for 'X' but accessing 'Y'"
      ▼
[UserController.getMyProfile(@CurrentUser AuthenticatedUser user)]  (apps/app-sumtally)
      │ CurrentUserArgumentResolver 가 AuthenticatedUser 주입
      ▼
UserServiceImpl.findProfileById(user.userId())     (core-user-impl, sumtally DataSource 사용)
      │
      ▼
UserRepository.findById(...)            (Spring Data JPA)
      │
      ▼
HikariCP (sumtally 전용 풀) → Postgres (sumtally schema)
      │
      ▼ (응답 경로)
User 엔티티 → user.toProfile() → UserProfile DTO     (ADR-016)
      │
      ▼
UserController → ApiResponse.ok(profile) → JSON 응답
      │
      ▼
[GlobalExceptionHandler]                (common-web, 예외 발생 시만)
      │ BaseException → ApiError 로 변환
      ▼
클라이언트
```

### 예외 처리 흐름

어느 레이어에서든 예외가 발생하면 `GlobalExceptionHandler` 가 가로채서 `ApiResponse.error(ApiError)` 형태로 변환해요. 클라이언트는 **항상 같은 JSON 구조** 의 응답을 받아요.

```
throw new UserException(UserError.USER_NOT_FOUND, Map.of("id", String.valueOf(userId)))
      │
      ▼
GlobalExceptionHandler.handleBaseException(BaseException)
      │ ErrorInfo → ApiError
      ▼
ApiResponse.error(new ApiError("USR_001", "유저를 찾을 수 없습니다", {id: userId}))
      │
      ▼
HTTP 404 + JSON 응답
```

포맷 상세는 [`API Response Format`](../api-and-functional/api/api-response.md) 을 참조하세요.

---

## 인증 플로우

모든 인증 엔드포인트는 `/api/apps/{appSlug}/auth/*` 경로예요. core-auth-impl 의 `AuthController` 는 **레퍼런스 소스** 로만 존재하고 런타임에는 등록되지 않습니다. 각 앱의 `<Slug>AuthController` 가 `AuthPort` 를 주입받아 위임하는 구조예요 ([`ADR-013`](../philosophy/adr-013-per-app-auth-endpoints.md)).

### 이메일 가입

```
POST /api/apps/sumtally/auth/email/signup
     { email, password, displayName }
      │
      ▼
[AppSlugVerificationFilter]             # 인증 전 요청이라 JWT 없음 → skip
      │
      ▼
SumtallyAuthController.signUpWithEmail(request)   (apps/app-sumtally/auth)
      │
      ▼
AuthPort.signUpWithEmail(request)       # (AuthServiceImpl @Transactional)
      │
      ├─→ EmailAuthService.signUp(request)
      │   ├─→ UserRepository.findByEmail(...) → 중복 체크 (sumtally schema)
      │   ├─→ PasswordHasher.hash(password) — BCrypt
      │   ├─→ UserRepository.save(User{ email_verified: false })
      │   └─→ EmailVerificationService.sendVerificationEmail(user)
      │       └─→ ResendEmailAdapter.send(...)
      │
      ├─→ RefreshTokenService.issue(userId)    # sumtally.refresh_tokens
      ├─→ JwtService.issueAccessToken(userId, email, appSlug="sumtally", role)
      │
      └─→ AuthResponse { user, tokens }
```

### Apple Sign In

```
POST /api/apps/sumtally/auth/apple
     { identityToken }
      │
      ▼
AuthPort.signInWithApple(request)
      │
      ├─→ AppleSignInService.verify(identityToken)
      │   ├─→ AppleJwksClient.getKeys()  — Apple 공개키 JWKS (캐시)
      │   ├─→ JWT 서명 검증 (kid → 해당 RSA 공개키)
      │   ├─→ iss / aud / exp 검증
      │   └─→ sub (Apple user ID) 추출
      │
      ├─→ SocialIdentityRepository.findByProviderAndProviderId("apple", sub)
      │   ├─→ 있으면: 기존 sumtally User 로그인
      │   └─→ 없으면: 새 sumtally User + SocialIdentity 생성
      │          (이메일은 Apple 첫 로그인 시에만 제공됨)
      │
      ├─→ RefreshTokenService.issue(userId)
      ├─→ JwtService.issueAccessToken(userId, email, appSlug="sumtally", role)
      │
      └─→ AuthResponse
```

### Refresh Token 회전 (탈취 감지 포함)

```
POST /api/apps/sumtally/auth/refresh
     { refreshToken }
      │
      ▼
RefreshTokenService.refresh()
      │
      ├─→ tokenHash = BCrypt.hash(refreshToken)
      ├─→ RefreshTokenRepository.findByTokenHash(tokenHash)
      │
      ├─→ 없음 → InvalidTokenException
      ├─→ 만료 → TokenExpiredException
      ├─→ 이미 used_at != null → 탈취 감지:
      │   ├─→ 같은 family_id 의 모든 RefreshToken 무효화 (revoked_at = now)
      │   ├─→ 전체 재로그인 필요
      │   └─→ InvalidTokenException
      │
      ├─→ 정상 처리:
      │   ├─→ 기존 token.used_at = now
      │   ├─→ 새 refresh token 발급 (same family_id, sumtally schema)
      │   └─→ 새 access token 발급
      │
      └─→ AuthTokens { accessToken, refreshToken: new }
```

### 탈퇴 (Soft Delete)

```
POST /api/apps/sumtally/auth/withdraw
     { reason }
     (Authorization: Bearer <token>, appSlug="sumtally")
      │
      ▼
WithdrawService.withdraw(userId, reason)
      │
      ├─→ User.deleted_at = now              # soft delete
      ├─→ RefreshTokenRepository.revokeAllByUserId(userId)
      ├─→ DeviceRepository.deleteAllByUserId(userId)  # FCM 토큰 즉시 무효화
      │
      └─→ (30일 후 hard delete 는 스케줄러 작업)
```

---

## 데이터베이스 구조

한 `postgres` database 안에 여러 schema 가 공존해요 ([`ADR-005`](../philosophy/adr-005-db-schema-isolation.md)).

### Schema 레이아웃

```
postgres (database)
│
├── core                             ← 템플릿 기준선 (core_app role)
│   ├── users                        ← 레거시/참조용 (실제 런타임 유저는 앱 schema)
│   ├── social_identities
│   ├── refresh_tokens, email_verification_tokens, password_reset_tokens
│   ├── devices
│   └── flyway_schema_history        ← core 마이그레이션 전용
│
├── sumtally                         ← apps/app-sumtally 전용 (sumtally_app role)
│   ├── users                        ← sumtally 독립 유저
│   ├── social_identities
│   ├── refresh_tokens, email_verification_tokens, password_reset_tokens
│   ├── devices
│   ├── (도메인 테이블)               ← budget_groups, expenses 등
│   └── flyway_schema_history
│
├── rny                              ← apps/app-rny 전용 (rny_app role)
│   └── ... (같은 인증 테이블 6개 + rny 도메인 테이블)
│
└── public                           ← Supabase 기본, 건드리지 않음
```

### DB Role 분리

각 schema 에 전용 role 을 부여해요. 크로스 schema 접근은 **DB 레벨에서 permission denied** 가 나요.

```sql
-- infra/scripts/init-app-schema.sql (멱등)
CREATE SCHEMA IF NOT EXISTS sumtally;
CREATE ROLE sumtally_app LOGIN PASSWORD '...';

GRANT USAGE, CREATE ON SCHEMA sumtally TO sumtally_app;
GRANT ALL ON ALL TABLES IN SCHEMA sumtally TO sumtally_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA sumtally
    GRANT ALL ON TABLES TO sumtally_app;

-- 핵심 방어선: public schema 접근 차단 (PostgreSQL 기본 권한 회수)
REVOKE ALL ON SCHEMA public FROM sumtally_app;
```

### DataSource 분리

각 앱별로 **독립 DataSource + HikariCP 풀 + EntityManagerFactory + Flyway** 를 `AbstractAppDataSourceConfig` 로 구성합니다.

```java
// common-persistence/AbstractAppDataSourceConfig.java
protected DataSource buildDataSource(String url, String user, String pw) {
    HikariConfig cfg = new HikariConfig();
    cfg.setJdbcUrl(url);
    cfg.setUsername(user);
    cfg.setPassword(pw);
    cfg.setMaximumPoolSize(10);
    cfg.setPoolName(slug + "-pool");
    return new HikariDataSource(cfg);
}

// Hibernate 가 접근하는 schema 를 명시
properties.put("hibernate.default_schema", slug);

// Flyway 도 schema 별 분리
Flyway.configure()
    .schemas(slug)
    .locations("classpath:db/migration/" + slug)
    .load();
```

한 앱이 커넥션을 고갈시켜도 다른 앱 풀은 영향이 없습니다. ThreadLocal 기반 동적 라우팅 (`AbstractRoutingDataSource`) 도 함께 사용해요 — `SchemaRoutingDataSource` 가 슬러그별 DataSource 분기를 처리해요 ([`ADR-018`](../philosophy/adr-018-schema-routing-datasource.md)).

### 멀티 DataSource Wiring

`bootstrap/CoreDataSourceConfig` (`@Primary`, slug="core") 와 각 앱 모듈의 `<Slug>DataSourceConfig` 가 공존해요. 공통 빌더는 `AbstractAppDataSourceConfig` 예요.

```
bootstrap/CoreDataSourceConfig (@Primary, slug="core")
  @Bean dataSource / entityManagerFactory / transactionManager / flyway

apps/app-<slug>/config/<Slug>DataSourceConfig (slug="<slug>", @Profile("!test"))
  @Bean <slug>DataSource / <slug>EntityManagerFactory /
        <slug>TransactionManager / <slug>Flyway
  @EnableJpaRepositories(basePackages = "apps.<slug>.repository",
                         entityManagerFactoryRef = "<slug>EntityManagerFactory")
```

새 앱 추가 시 `new-app.sh` 가 `<Slug>DataSourceConfig` 클래스를 자동 생성합니다. `@Profile("!test")` 가 함께 붙어 있어서 bootstrap test (Testcontainers 단일 DB) 환경에서 슬러그 모듈이 비활성화됩니다.

---

## Extraction 을 위한 방어선

"특정 앱이 대박 나서 독립 서비스로 뽑아야 할 때" 를 대비해서 경계를 기계적으로 강제합니다. [`ADR-005`](../philosophy/adr-005-db-schema-isolation.md) 의 5중 데이터 격리 + [`ADR-003`](../philosophy/adr-003-api-impl-split.md) 의 Port 계약 보증 = 총 6 레이어예요.

### 레이어 1 — DB Role 권한 분리

각 schema 의 전용 role 을 만듭니다. 크로스 schema 접근은 런타임에 `permission denied` 로 즉시 발견됩니다. 구현은 `infra/scripts/init-app-schema.sql` 에 있습니다.

### 레이어 2 — Spring DataSource 분리

각 앱별 HikariCP 풀이 만들어져요. 코드로 다른 앱 DataSource 를 얻을 방법이 없습니다. 구현은 `common-persistence/AbstractAppDataSourceConfig` 에 있습니다.

### 레이어 3 — Flyway 마이그레이션 분리

각 앱의 `db/migration/<slug>/` 와 `flyway_schema_history` 가 독립적이에요. 앱 간 마이그레이션 간섭이 불가능해요.

### 레이어 4 — 포트 인터페이스 의존 (Gradle)

`apps/*` 는 `core-*-api` 만 의존해요. `core-*-impl` 에 접근하는 코드는 **Gradle configuration 단계에서 거절** 돼요 — 컴파일 시작 전에 잡혀요. 구현은 `build-logic/factory.app-module.gradle` 에 있습니다.

### 레이어 5 — ArchUnit CI

위 4가지로 잡히지 않는 패턴 (패키지 이름 규칙, Entity 노출 금지, `*Mapper` 금지, `@Deprecated(since, forRemoval)` 강제 등) 을 22 개 규칙으로 CI 검증합니다. 구현은 `common-testing/architecture/ArchitectureRules.java` 에 있습니다.

### 레이어 6 — Contract Test (추출 보증)

Port 가 약속한 행위를 `AbstractXxxPortContractTest` 로 명문화해요. 모든 impl 이 이 계약을 통과해야 머지가 가능해요. JSON 직렬화 계약은 `AbstractJsonContractTest<T>` 가 담당합니다. 테스트 실패 시 CI 빌드가 정지됩니다.

이 레이어가 **추출 가능성의 형식적 보증** 이에요 — `core-auth-impl` 을 HTTP 클라이언트 어댑터로 교체해도 같은 계약 테스트를 통과하면 정상 작동이 확정됩니다. 상세는 [`계약 테스트 (Contract Testing)`](../production/test/contract-testing.md) 를 참조하세요.

### 실제 추출 절차 (예상 7~10 영업일)

6 레이어가 모두 있으면 "나중에 뽑을 수 있다" 가 빈 약속이 아닌 **보장** 이 됩니다.

1. 새 레포 생성 + 해당 앱 모듈 복사
2. `core-*-api` 의존은 유지, `core-*-impl` 을 HTTP 클라이언트 어댑터로 교체
3. `pg_dump -n <schema>` 로 schema 덤프 → 새 Postgres 인스턴스에 복구
4. 새 배포 파이프라인 구성 (기존 템플릿의 `.github/workflows/deploy.yml` 참조)
5. Cloudflare 리버스 프록시에서 해당 앱 경로 라우팅
6. 트래픽 이전 + 관측성 검증

---

## 테스트 전략 맵

4 층 테스트 구조예요 ([`ADR-014`](../philosophy/adr-014-no-delegation-mock.md)).

| 층 | 검증 대상 | 대표 디렉토리 | Spring Context |
|---|---|---|---|
| Unit | 순수 알고리즘 (JWT, RefreshToken rotation, Apple JWKS, BCrypt) | `common-security/test/`, `core-auth-impl/test/service/` | 없음 |
| Contract (JSON) | DTO ↔ JSON 직렬화 | `core-*-api/test/json/` | 없음 |
| Contract (Port) | Port 인터페이스 행위 계약 | `core-auth-impl/test/AuthServiceImplContractTest` | @SpringBootTest + Testcontainers |
| Integration | HTTP → Controller → DB 전체 흐름 | `bootstrap/test/` | @SpringBootTest + Testcontainers |

**금지** — "A 가 B.foo() 를 호출하는가" 같은 delegation mock 검증이에요. 리팩토링 안전망을 파괴하니까요.

**허용되는 Mock**:
- 외부 시스템 (FCM, Resend) 의 fake adapter (Mockito 가 아니라 in-memory 구현)
- 비결정 의존성 (Clock, 난수) 의 고정값 (`Clock.fixed()` 등)

상세는 [`Testing Strategy`](../production/test/testing-strategy.md) 를 참조하세요.

---

## 관련 문서

### 핵심 레퍼런스
- [`Repository Philosophy — 책 안내`](../philosophy/README.md) — 20 개 ADR 설계 결정의 근거
- [`Documentation Style Guide`](../reference/STYLE_GUIDE.md) — 문서 작성 규칙
- [`Onboarding — 템플릿 첫 사용 가이드`](../start/onboarding.md) — 로컬 개발 환경 셋업

### 모듈 / 아키텍처 세부
- [`모듈 의존 규칙 (Module Dependencies)`](./module-dependencies.md) — 의존 방향 규칙 상세
- [`Architecture Rules (ArchUnit)`](./architecture-rules.md) — ArchUnit 22 규칙 전체 (r1~r22)
- [`Multi-tenant Architecture`](./multitenant-architecture.md) — per-app schema + HikariCP 격리 + appSlug 검증
- [`JWT Authentication`](./jwt-authentication.md) — JWT claims · access/refresh · @CurrentUser · BCrypt

### 인프라 / 운영
- [`인프라 (Infrastructure)`](../production/deploy/infrastructure.md) — 맥미니 홈서버, Supabase, Cloudflare Tunnel, 블루그린 배포
- [`CI / CD 전체 플로우 — commit 부터 운영 반영까지`](../production/deploy/ci-cd-flow.md) — commit → 운영 반영 전체 흐름
- [`운영 런북 (Runbook)`](../production/deploy/runbook.md) — 운영 절차 + 장애 대응
- [`secret chain 4-stage 통합 가이드`](../production/setup/secret-chain-4stage.md) — 4 곳 매핑 체크리스트

### API 계약
- [`API Response Format`](../api-and-functional/api/api-response.md) — 응답 포맷 표준
- [`Flutter ↔ Backend Integration`](../api-and-functional/api/flutter-backend-integration.md) — Flutter 앱 연동

### 컨벤션 / 기능 가이드
- [`../convention/`](../convention/) — 네이밍, DTO factory, 예외 처리, git-workflow 등
- [`Push Notifications`](../api-and-functional/functional/push-notifications.md) — FCM 디바이스 등록 + PushPort
- [`Email Verification & Delivery`](../api-and-functional/functional/email-verification.md) — Resend 이메일 인증 + 비밀번호 재설정
- [`오브젝트 스토리지 규약`](../api-and-functional/functional/storage.md) — 파일 스토리지 컨벤션
