# Cleanup Legacy Cycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** template-spring 의 *우리 플젝 옛 흐름 변명* 표현을 모두 정리해서 파생 레포 소유자에게 *깔끔한 시작점* 으로서의 신뢰도 확보.

**Architecture:** spec 의 8 sub-session (S1~S8) 을 task 단위로 분해. 각 task = 한 묶음 변경 + Read → Edit → grep verify → 다음 task. sub-session 종료마다 commit. 모든 사이클 끝 1회 push.

**Tech Stack:** Bash, Markdown, Java 21 (enum / javadoc), SQL (Flyway), Postgres, Spring Boot 3.5

---

## File Structure

본 plan 의 변경 파일 구분:

**Code (4 파일)**:
- `core/core-auth-api/src/main/java/com/factory/core/auth/api/exception/AuthError.java` — enum constant 제거 + javadoc 삭제
- `core/core-auth-api/src/main/java/com/factory/core/auth/api/exception/AuthException.java` — javadoc 예시 갱신
- `common/common-web/src/main/java/com/factory/common/web/exception/BaseException.java` — javadoc 예시 갱신
- `factory` (wrapper script) — *legacy 호환* 라벨 제거

**SQL (5 파일)**:
- 통합: `core/core-user-impl/src/main/resources/db/migration/core/V001__init_users.sql`
- 통합: `core/core-device-impl/src/main/resources/db/migration/core/V008__init_devices.sql`
- 삭제: `V003__add_users_email_index.sql` / `V004__add_totp_to_users.sql` / `V009__add_devices_updated_at.sql`

**Docs (~30 파일)**:
- `docs/api-and-functional/api/{versioning,api-response,flutter-backend-integration}.md`
- `docs/api-and-functional/functional/{migration,email-verification}.md`
- `docs/convention/exception-handling.md`
- `docs/philosophy/adr-{001,002,005,006,007,010,011,012,013,014,015,016,019,024,034}.md`
- `docs/production/deploy/{infrastructure,decisions-infra}.md`
- `docs/production/setup/storage-bucket-isolation.md`
- `docs/reference/edge-cases.md`
- `docs/start/{cli-guide,onboarding,dogfood-faq,dogfood-setup}.md`

**Plan stub**: `~/.claude/plans/elegant-crafting-rain.md` (본 conversation 외부 — S7 에서 갱신)

---

## S1 — docs only legacy 라벨 정리

### Task 1: T4 verifyEmailLegacy 가상 예시 → 추상화 (versioning.md)

**Files:**
- Modify: `docs/api-and-functional/api/versioning.md:81, 177, 194`

- [ ] **Step 1: Read context** — `Read docs/api-and-functional/api/versioning.md` line 75-200 for context

- [ ] **Step 2: Edit line 81** — `core-auth-api: AuthPort.verifyEmailLegacy — use verifyEmail. Removal in v1.0.0.` → `module-name: oldMethodName — use newMethodName. Removal in v1.0.0.`

- [ ] **Step 3: Edit line 177** — `public void verifyEmailLegacy(VerifyEmailRequest request)` → `public void oldMethodName(RequestType request)`

- [ ] **Step 4: Edit line 194** — `core-auth-api: AuthPort.verifyEmailLegacy — use verifyEmail.` → `module-name: oldMethodName — use newMethodName.`

- [ ] **Step 5: Verify** — `grep -n 'verifyEmailLegacy' docs/api-and-functional/api/versioning.md` → 0건

### Task 2: T4 verifyEmailLegacy 가상 예시 → 추상화 (migration.md)

**Files:**
- Modify: `docs/api-and-functional/functional/migration.md:37, 41, 53`

- [ ] **Step 1: Read context** — `Read docs/api-and-functional/functional/migration.md` line 30-60

- [ ] **Step 2: Edit line 37** — `## 1. UserPort.verifyEmailLegacy → verifyEmail` → `## 1. (예시) ModulePort.oldMethodName → newMethodName`

- [ ] **Step 3: Edit line 41** — `authPort.verifyEmailLegacy(new VerifyEmailRequest(token));` → `modulePort.oldMethodName(new RequestType(arg));`

- [ ] **Step 4: Edit line 47-49** — *After* 코드 블록의 `authPort.verifyEmail(new VerifyEmailRequest(token));` → `modulePort.newMethodName(new RequestType(arg));`

- [ ] **Step 5: Edit line 53** — `전역 search/replace: \`verifyEmailLegacy\` → \`verifyEmail\`` → `전역 search/replace: \`oldMethodName\` → \`newMethodName\``

- [ ] **Step 6: Verify** — `grep -n 'verifyEmailLegacy\|UserPort\|authPort' docs/api-and-functional/functional/migration.md` → 가상 예시 표현만 0건 (실제 module 인용은 OK)

### Task 3: T5 basic-bucket (legacy) 라인 삭제

**Files:**
- Modify: `docs/production/setup/storage-bucket-isolation.md:24`

- [ ] **Step 1: Read context** — `Read docs/production/setup/storage-bucket-isolation.md` line 15-40

- [ ] **Step 2: Edit** — line 24 (`├── basic-bucket           ← 운영자 직접 등록 (legacy)`) 통째 삭제

- [ ] **Step 3: Verify** — `grep -n 'basic-bucket' docs/production/setup/storage-bucket-isolation.md` → 0건

### Task 4: T7 ConditionalOnExpression (legacy AND) 표 라벨 정정

**Files:**
- Read: `core/core-billing-impl/src/main/java/com/factory/core/billing/impl/BillingAutoConfiguration.java` (실제 조건식 확인)
- Modify: `docs/philosophy/adr-034-feature-toggle-lite-mode.md:90`

- [ ] **Step 1: Verify actual condition** — `grep -n 'ConditionalOnExpression' core/core-billing-impl/src/main/java/com/factory/core/billing/impl/BillingAutoConfiguration.java` 로 실제 SPEL 조건식 확인. 정확한 두 flag 식별.

- [ ] **Step 2: Edit line 90** — `(legacy AND)` 표현을 실제 SPEL 의미로 교체. 예: `audit AND billing-notification` 두 flag 모두 true 일 때 등록.

- [ ] **Step 3: Verify** — `grep -n 'legacy AND' docs/philosophy/adr-034-feature-toggle-lite-mode.md` → 0건

### Task 5: T8 factory wrapper *legacy 호환* 라벨 제거

**Files:**
- Modify: `factory:21, 31`

- [ ] **Step 1: Read context** — `Read factory` line 15-50

- [ ] **Step 2: Edit line 21** — `all   init                 위 둘 한 번에 (legacy 호환)` → `all   init                 local + prod 동시`

- [ ] **Step 3: Edit line 31** — `local test                 server-test + api-test 순차 (legacy = 둘 다)` → `local test                 server-test + api-test 순차`

- [ ] **Step 4: Verify** — `grep -n 'legacy' factory` → 0건

### Task 6: T8 cli-guide / onboarding *legacy 호환* 라벨 제거

**Files:**
- Modify: `docs/start/cli-guide.md:28, 39`
- Modify: `docs/start/onboarding.md:148`

- [ ] **Step 1: Read cli-guide.md context** — line 20-45

- [ ] **Step 2: Edit cli-guide.md:28** — `| 둘 다 한 번에 (legacy) |` → `| local + prod 동시 |`

- [ ] **Step 3: Edit cli-guide.md:39** — `| \`server-test\` + \`api-test\` 순차 (legacy 호환) |` → `| \`server-test\` + \`api-test\` 순차 |`

- [ ] **Step 4: Read onboarding.md context** — line 140-160

- [ ] **Step 5: Edit onboarding.md:148** — `# ── (legacy 호환) 한 번에 모두 ──...` → `# ── 한 번에 모두 (local + prod 동시) ──...`

- [ ] **Step 6: Verify** — `grep -n 'legacy' docs/start/cli-guide.md docs/start/onboarding.md` → 0건 (또는 의도적 보존만)

### Task 7: S1 종합 검증 + commit

- [ ] **Step 1: docs-contract-test PASS** — `bash tools/docs-check/docs-contract-test.sh` → 4/4 PASS

- [ ] **Step 2: S1 grep 종합 verify**
  ```bash
  grep -rEn 'verifyEmailLegacy|basic-bucket|legacy AND|legacy 호환|legacy = 둘' docs/ factory
  ```
  → 0건 (Task 4 의 의미 있는 라벨 변경분 외)

- [ ] **Step 3: Commit S1**
  ```bash
  git add factory docs/api-and-functional/api/versioning.md docs/api-and-functional/functional/migration.md docs/production/setup/storage-bucket-isolation.md docs/philosophy/adr-034-feature-toggle-lite-mode.md docs/start/cli-guide.md docs/start/onboarding.md
  git commit -m "docs(cleanup): s1 docs/code legacy 라벨 정리 — t4/t5/t7/t8

  - t4 verifyemaillegacy 가상 예시 → 추상화 (oldmethodname/newmethodname)
  - t5 basic-bucket (legacy) 라인 삭제
  - t7 conditionalonexpression (legacy and) → 실제 spel 의미 표기
  - t8 factory all init / local test 의 legacy 호환 라벨 제거"
  ```

---

## S2 — ATH_006 EMAIL_DELIVERY_FAILED 제거

### Task 8: AuthError.java 대체 enum 확정 — `INVALID_CREDENTIALS`

**Files:**
- Read: `core/core-auth-api/src/main/java/com/factory/core/auth/api/exception/AuthError.java`

- [ ] **Step 1: Verify enum constants exist** — `grep -E '^\s+[A-Z_]+\([0-9]' core/core-auth-api/src/main/java/com/factory/core/auth/api/exception/AuthError.java` 로 enum list 확인. 기대 결과:
  ```
  INVALID_CREDENTIALS(401, "ATH_001", ...)
  TOKEN_EXPIRED(401, "ATH_002", ...)
  INVALID_TOKEN(401, "ATH_003", ...)
  SOCIAL_AUTH_FAILED(401, "ATH_004", ...)
  EMAIL_NOT_VERIFIED(401, "ATH_005", ...)
  EMAIL_DELIVERY_FAILED(503, "ATH_006", ...)   ← 제거 대상
  TOTP_VERIFICATION_FAILED(401, "ATH_007", ...)
  ...
  ```

- [ ] **Step 2: 대체 enum 확정** — `INVALID_CREDENTIALS` (ATH_001). 가장 일반적인 Auth 에러로 javadoc 예시로 적합. Task 10/11 에서 사용.

### Task 9: AuthError.java 에서 EMAIL_DELIVERY_FAILED enum 제거

**Files:**
- Modify: `core/core-auth-api/src/main/java/com/factory/core/auth/api/exception/AuthError.java:36-40`

- [ ] **Step 1: Read line 30-50** — context 확인

- [ ] **Step 2: Edit** — javadoc 블록 (line 36-39) + enum constant (line 40) 모두 삭제. 인접 enum 의 trailing comma / semicolon 일관성 확인.

- [ ] **Step 3: Verify** — `grep -n 'EMAIL_DELIVERY_FAILED\|ATH_006' core/core-auth-api/src/main/java/com/factory/core/auth/api/exception/AuthError.java` → 0건

### Task 10: AuthException.java javadoc 예시 갱신

**Files:**
- Modify: `core/core-auth-api/src/main/java/com/factory/core/auth/api/exception/AuthException.java:16`

- [ ] **Step 1: Read line 10-25** — context

- [ ] **Step 2: Edit line 16** — `throw new AuthException(AuthError.EMAIL_DELIVERY_FAILED, cause);` → Task 8 에서 선택한 enum (예: `AuthError.INVALID_CREDENTIALS` — 실제 존재 검증 후) 로 교체

- [ ] **Step 3: Verify** — `grep -n 'EMAIL_DELIVERY_FAILED\|ATH_006' core/core-auth-api/src/main/java/com/factory/core/auth/api/exception/AuthException.java` → 0건

### Task 11: BaseException.java javadoc 예시 갱신

**Files:**
- Modify: `common/common-web/src/main/java/com/factory/common/web/exception/BaseException.java:23`

- [ ] **Step 1: Read line 15-30** — context

- [ ] **Step 2: Edit line 23** — `throw new AuthException(AuthError.EMAIL_DELIVERY_FAILED, cause);` → Task 8 의 enum 으로 교체

- [ ] **Step 3: Verify** — `grep -n 'EMAIL_DELIVERY_FAILED\|ATH_006' common/common-web/src/main/java/com/factory/common/web/exception/BaseException.java` → 0건

### Task 12: build PASS 확인

- [ ] **Step 1: Run build** — `./gradlew build` → BUILD SUCCESSFUL (212 tasks)

- [ ] **Step 2: 컴파일 에러 0** — Java code 변경 후 compile + 22 ArchUnit + 단위 테스트 모두 PASS 확인

### Task 13: docs/convention/exception-handling.md ATH_006 deprecated 표 행 삭제

**Files:**
- Modify: `docs/convention/exception-handling.md:90`

- [ ] **Step 1: Read line 85-100** — context

- [ ] **Step 2: Edit** — line 90 (`| ~~ATH_006~~ | ~~503~~ | ~~EMAIL_DELIVERY_FAILED~~ | **deprecated (ADR-024)** — \`EMAIL_001\` 로 대체 |`) 통째 삭제

- [ ] **Step 3: Verify** — `grep -n 'ATH_006' docs/convention/exception-handling.md` → 0건

### Task 14: flutter-backend-integration.md + api-response.md 의 ATH_006 인용 정리

**Files:**
- Modify: `docs/api-and-functional/api/flutter-backend-integration.md:347`
- Modify: `docs/api-and-functional/api/api-response.md:268`

- [ ] **Step 1: Edit flutter-backend-integration.md:347** — `| 이메일 발송 실패 | 502 | \`EMAIL_001\` (ADR-024 — 옛 \`ATH_006\` 대체) |` → `| 이메일 발송 실패 | 502 | \`EMAIL_001\` |`

- [ ] **Step 2: Edit api-response.md:268** — 동일 처리

- [ ] **Step 3: Verify** — `grep -n 'ATH_006' docs/api-and-functional/api/flutter-backend-integration.md docs/api-and-functional/api/api-response.md` → 0건

### Task 15: email-verification.md 의 before/after 비교 + ATH_006 라인 삭제

**Files:**
- Modify: `docs/api-and-functional/functional/email-verification.md:491-503`

- [ ] **Step 1: Read line 485-510** — *before/after 비교* 의 정확한 범위 확인

- [ ] **Step 2: Edit** — line 491 (`EMAIL_DELIVERY_FAILED(503, "ATH_006", ... deprecated ...)`) 와 line 494 (`EMAIL_DELIVERY_FAILED(503, "EMAIL_001", ...)`) before/after 코드 블록 통째 삭제

- [ ] **Step 3: Edit** — line 503 (`| ~~\`ATH_006\`~~ | ~~503~~ | **deprecated** ...`) 통째 삭제

- [ ] **Step 4: Verify** — `grep -n 'ATH_006' docs/api-and-functional/functional/email-verification.md` → 0건. 단순히 `EMAIL_001` 만 표기.

### Task 16: adr-024 의 *이전에는* / *cleanup 사이클에 제거 가능* 표현 갱신

**Files:**
- Modify: `docs/philosophy/adr-024-email-domain-extraction.md:39, 68, 76, 112`

- [ ] **Step 1: Read line 35-80** + line 105-120 — context

- [ ] **Step 2: Edit line 39** — `├─ EmailError.java         ← 신규 (EMAIL_DELIVERY_FAILED 등)` → `├─ EmailError.java         ← EMAIL_DELIVERY_FAILED (EMAIL_001)`

- [ ] **Step 3: Edit line 68 단락** — 단락 통째 다시 작성: `이전에는 ResendEmailAdapter 가 \`AuthException(AuthError.EMAIL_DELIVERY_FAILED, cause)\` 를 throw. 이제는:` → `이메일 발송 실패는 \`EmailException(EmailError.EMAIL_DELIVERY_FAILED, cause)\` 로 처리해요:`

- [ ] **Step 4: Edit line 76** — `\`AuthError.EMAIL_DELIVERY_FAILED\` 는 unused 상태로 남음 (BC 위해 enum 값 유지). 다음 cleanup 사이클에 제거 가능.` 라인 통째 삭제 (인접 빈 줄 정리)

- [ ] **Step 5: Edit line 112** — `**AuthError.EMAIL_DELIVERY_FAILED 제거** — unused 상태. 다음 cleanup.` 라인 통째 삭제

- [ ] **Step 6: Verify** — `grep -n 'AuthError.EMAIL_DELIVERY_FAILED\|ATH_006\|cleanup 사이클' docs/philosophy/adr-024-email-domain-extraction.md` → 0건

### Task 17: S2 종합 검증 + commit

- [ ] **Step 1: 사이클 grep 종합 verify**
  ```bash
  grep -rEn 'AuthError\.EMAIL_DELIVERY_FAILED|ATH_006' core/ common/ docs/
  ```
  → 0건

- [ ] **Step 2: build re-verify** — `./gradlew build` → PASS

- [ ] **Step 3: docs-contract PASS** — `bash tools/docs-check/docs-contract-test.sh` → 4/4 PASS

- [ ] **Step 4: Commit S2**
  ```bash
  git add core/core-auth-api/src/main/java/com/factory/core/auth/api/exception/AuthError.java core/core-auth-api/src/main/java/com/factory/core/auth/api/exception/AuthException.java common/common-web/src/main/java/com/factory/common/web/exception/BaseException.java docs/convention/exception-handling.md docs/api-and-functional/api/flutter-backend-integration.md docs/api-and-functional/api/api-response.md docs/api-and-functional/functional/email-verification.md docs/philosophy/adr-024-email-domain-extraction.md
  git commit -m "refactor(auth): s2 ath_006 email_delivery_failed enum 제거 — adr-024 후속 cleanup

  - autherror enum constant + javadoc 삭제 (실제 throw 0건 확인)
  - authexception/baseexception javadoc 예시 enum 교체
  - docs (exception-handling/flutter/api-response/email-verification/adr-024) 의 ath_006 deprecated 표 + before/after 비교 + cleanup 사이클 변명 표현 모두 정리"
  ```

---

## S3 — adr-034 *진화 기록* + Phase A/B 정리

### Task 18: adr-034 진화 기록 박스 + Phase A/B 산문 재작성

**Files:**
- Modify: `docs/philosophy/adr-034-feature-toggle-lite-mode.md:82, 115-116`

- [ ] **Step 1: Read line 75-130** — *진화 기록* 박스 + Phase A/B 의 surrounding context 정확히 파악

- [ ] **Step 2: Edit line 82** — *진화 기록* 박스 통째 교체:
  ```diff
  -> 📌 **진화 기록**: 본 ADR 초기 설계 → 8 도메인 단순 토글 가정 → 실 검증 시 부팅 fail (non-leaf) → leaf 4 만 적용 (Phase A) → ObjectProvider 변환 invasive 작업 완료 (Phase B, 2026-05-02) → 7 도메인 모두 안전 토글.
  +> 📌 **적용 범위**: 7 도메인 모두 안전 토글 가능. non-leaf 모듈은 의존 측에서 ObjectProvider 로 lazy 의존, leaf 모듈은 단순 ConditionalOnProperty.
  ```

- [ ] **Step 3: Edit line 115-116** — Phase A/B 두 줄 통째 교체:
  ```diff
  -  - Phase A (2026-05-02 첫 commit): leaf 4 만 토글, non-leaf 4 backlog
  -  - Phase B (2026-05-02 후속): ObjectProvider invasive 변환 → 7 도메인 토글 완성
  +  - **Leaf 모듈** (의존 받지 않음): `@ConditionalOnProperty` 만으로 안전 토글
  +  - **Non-leaf 모듈** (의존 받음): 의존 측에서 `ObjectProvider<Port>` 로 lazy 의존 → toggle off 시에도 컴파일 / 부팅 OK
  ```

- [ ] **Step 4: Verify** — `grep -n '진화 기록\|Phase [AB]\b' docs/philosophy/adr-034-feature-toggle-lite-mode.md` → 0건

- [ ] **Step 5: Commit S3**
  ```bash
  git add docs/philosophy/adr-034-feature-toggle-lite-mode.md
  git commit -m "docs(philosophy): s3 adr-034 진화 기록 박스 + phase a/b → 기술 패턴 분류 (leaf/non-leaf)"
  ```

---

## S4 — Flyway V003/V004/V009 squash

### Task 19: V001__init_users.sql 통합 (V001 + V003 + V004)

**Files:**
- Modify: `core/core-user-impl/src/main/resources/db/migration/core/V001__init_users.sql`

- [ ] **Step 1: Read original V001 / V003 / V004** — 모두 정확히 확인

- [ ] **Step 2: Replace V001 with squashed content**:
  ```sql
  -- V001__init_users.sql
  CREATE TABLE users (
      id              BIGSERIAL PRIMARY KEY,
      email           VARCHAR(255) NOT NULL UNIQUE,
      password_hash   VARCHAR(255),
      display_name    VARCHAR(30),
      email_verified  BOOLEAN NOT NULL DEFAULT false,
      is_premium      BOOLEAN NOT NULL DEFAULT false,
      role            VARCHAR(20) NOT NULL DEFAULT 'user',
      created_at      TIMESTAMPTZ NOT NULL,
      updated_at      TIMESTAMPTZ NOT NULL,
      deleted_at      TIMESTAMPTZ,
      -- 2FA TOTP (RFC 6238)
      totp_secret         VARCHAR(64),
      totp_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
      totp_backup_codes   TEXT
  );

  CREATE UNIQUE INDEX uk_users_email_active ON users(email) WHERE deleted_at IS NULL;
  CREATE INDEX idx_users_deleted_at ON users(deleted_at);
  CREATE INDEX idx_users_email ON users(email);
  CREATE INDEX idx_users_totp_enabled ON users(totp_enabled) WHERE totp_enabled = true;
  ```

- [ ] **Step 3: Verify** — V001 의 컬럼 list (13개) + 인덱스 4개 일치

### Task 20: V008__init_devices.sql 통합 (V008 + V009)

**Files:**
- Modify: `core/core-device-impl/src/main/resources/db/migration/core/V008__init_devices.sql`

- [ ] **Step 1: Read original V008 / V009** — 정확히 확인

- [ ] **Step 2: Replace V008 with squashed content**:
  ```sql
  CREATE TABLE devices (
      id              BIGSERIAL PRIMARY KEY,
      user_id         BIGINT NOT NULL REFERENCES users(id),
      app_slug        VARCHAR(50) NOT NULL,
      platform        VARCHAR(10) NOT NULL,
      push_token      VARCHAR(512),  -- FCM tokens can exceed 255 characters
      device_name     VARCHAR(100),
      last_seen_at    TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX idx_devices_user_id ON devices(user_id);
  CREATE INDEX idx_devices_push_token ON devices(push_token);
  CREATE UNIQUE INDEX uk_devices_user_app_platform ON devices(user_id, app_slug, platform);
  ```

- [ ] **Step 3: Verify** — V008 의 컬럼 9개 + 인덱스 3개 일치

### Task 21: V003 / V004 / V009 git rm

**Files:**
- Delete: `core/core-user-impl/src/main/resources/db/migration/core/V003__add_users_email_index.sql`
- Delete: `core/core-user-impl/src/main/resources/db/migration/core/V004__add_totp_to_users.sql`
- Delete: `core/core-device-impl/src/main/resources/db/migration/core/V009__add_devices_updated_at.sql`

- [ ] **Step 1: git rm**
  ```bash
  git rm core/core-user-impl/src/main/resources/db/migration/core/V003__add_users_email_index.sql
  git rm core/core-user-impl/src/main/resources/db/migration/core/V004__add_totp_to_users.sql
  git rm core/core-device-impl/src/main/resources/db/migration/core/V009__add_devices_updated_at.sql
  ```

- [ ] **Step 2: Verify** — `ls core/core-user-impl/src/main/resources/db/migration/core/` 로 V001/V002 만 / `ls core/core-device-impl/src/main/resources/db/migration/core/` 로 V008 만 확인

### Task 22: docs/production/deploy/infrastructure.md 마이그레이션 list 갱신

**Files:**
- Modify: `docs/production/deploy/infrastructure.md`

- [ ] **Step 1: grep V003/V004/V009** — `grep -n 'V003__\|V004__\|V009__\|squash backlog' docs/production/deploy/infrastructure.md`

- [ ] **Step 2: Read context (greppped lines ± 10)** — 마이그레이션 list 정확한 표 위치 확인

- [ ] **Step 3: Edit** — 마이그레이션 list 표/블록을 squash 후 6 파일 (V001/V002/V005/V006/V007/V008) 로 갱신. *squash backlog 안내 행* 통째 삭제.

- [ ] **Step 4: Verify** — `grep -n 'V003__\|V004__\|V009__' docs/production/deploy/infrastructure.md` → 0건

### Task 23: docs/philosophy/adr-033-flyway-hybrid-policy.md 갱신

**Files:**
- Modify: `docs/philosophy/adr-033-flyway-hybrid-policy.md`

- [ ] **Step 1: grep V003/V004/V009** — `grep -n 'V003__\|V004__\|V009__' docs/philosophy/adr-033-flyway-hybrid-policy.md`

- [ ] **Step 2: 인용 위치 발견 시 갱신** — 발견된 line 의 V003/V004/V009 인용 → 다른 V 번호 (예: V005__init_refresh_tokens.sql, V008__init_devices.sql) 로 교체

- [ ] **Step 3: Verify** — `grep -n 'V003__\|V004__\|V009__' docs/philosophy/adr-033-flyway-hybrid-policy.md` → 0건

### Task 24: S4 force-clear + Flyway migrate + schema 검증

- [ ] **Step 1: docker volume rm** — `docker compose down -v && docker compose up -d postgres`. postgres ready 까지 대기 (`docker exec <container> pg_isready` 5초 폴링).

- [ ] **Step 2: Flyway migrate** — `./gradlew :core:core-user-impl:flywayMigrate :core:core-device-impl:flywayMigrate`

- [ ] **Step 3: psql \d users 검증** — `psql -h localhost -U postgres -d factory -c '\d users'` 의 출력에서:
  - 컬럼 13개 (id, email, password_hash, display_name, email_verified, is_premium, role, created_at, updated_at, deleted_at, totp_secret, totp_enabled, totp_backup_codes)
  - 인덱스 4개 (uk_users_email_active, idx_users_deleted_at, idx_users_email, idx_users_totp_enabled)

- [ ] **Step 4: psql \d devices 검증** — `psql -h localhost -U postgres -d factory -c '\d devices'` 의 출력에서:
  - 컬럼 9개 (id, user_id, app_slug, platform, push_token, device_name, last_seen_at, created_at, updated_at)
  - 인덱스 3개 (idx_devices_user_id, idx_devices_push_token, uk_devices_user_app_platform)

- [ ] **Step 5: build + 22 ArchUnit + 단위 테스트** — `./gradlew build` → PASS

- [ ] **Step 6: bootRun + actuator 검증**:
  ```bash
  ./gradlew :bootstrap:bootRun &
  sleep 30  # 부팅 대기
  curl -fs http://localhost:8080/actuator/health | jq .status   # "UP"
  kill %1   # bootRun 종료
  ```

### Task 25: S4 commit

- [ ] **Step 1: Commit S4**
  ```bash
  git add core/core-user-impl/src/main/resources/db/migration/core/V001__init_users.sql core/core-device-impl/src/main/resources/db/migration/core/V008__init_devices.sql docs/production/deploy/infrastructure.md docs/philosophy/adr-033-flyway-hybrid-policy.md
  # V003/V004/V009 는 task 21 에서 git rm 으로 stage 됨
  git commit -m "refactor(flyway): s4 v003/v004/v009 squash → v001/v008 — 마이그레이션 9 → 6 파일

  - v001 (init_users) 에 v003 email index + v004 totp 컬럼/인덱스 통합
  - v008 (init_devices) 에 v009 updated_at 컬럼 통합
  - v003/v004/v009 git rm
  - infrastructure / adr-033 의 마이그레이션 인용 갱신
  - force-clear 후 schema 동일성 검증 통과"
  ```

---

## S5 — ADR 14곳 *초기에는 X 였고* 변명 정리

### Task 26: ADR-005:87 *core/users 참조용 / 레거시* 검증 + 갱신

**Files:**
- Read: 검증용 — `core/` 와 `apps/` 의 SQL/Java
- Modify: `docs/philosophy/adr-005-db-schema-isolation.md:87`

- [ ] **Step 1: 검증** — `grep -rn 'FROM core\.users\|core_users\|core\..*users' core/ apps/ --include='*.java' --include='*.sql'` 실행. 결과 분석:
  - 사용 0건 → step 2a (admin/dev 계정용 표기)
  - 사용 1건 이상 → step 2b (현재 활용처 명시)

- [ ] **Step 2a (사용 X 시): Edit line 87** — `│   ├── users, social_identities    ← 참조용 / 레거시` → `│   ├── users, social_identities    ← admin / dev 계정용`

- [ ] **Step 2b (사용 O 시): Edit line 87** — `참조용 / 레거시` 라벨만 제거하고 *현재 활용처* 명시 (실제 사용처 검증 후 결정)

- [ ] **Step 3: Verify** — `grep -n '레거시' docs/philosophy/adr-005-db-schema-isolation.md` → 0건

### Task 27: ADR-005:210 *초기에는 role 만* 산문 재작성

**Files:**
- Modify: `docs/philosophy/adr-005-db-schema-isolation.md:210`

- [ ] **Step 1: Read line 200-225** — context (Postgres < 15 의 public schema CREATE 권한 이슈)

- [ ] **Step 2: Rewrite paragraph (line 210)** — *우리 플젝 시간 흐름* (`초기에는 ... 생각했어요`) → *기술 분석* (`role-only 격리는 불충분`) 형태로 재작성. 결정 근거 (Postgres < 15 의 public CREATE 권한) 보존:

  ```markdown
  role-only 격리는 Postgres < 15 의 public schema CREATE 권한 때문에 불충분합니다.
  Postgres 는 **기본적으로 모든 role 에게 `public` schema 의 `CREATE` 권한을 줍니다** (PostgreSQL < 15 기준).
  앱 role 이 `public` schema 에 테이블을 만들 수 있어 데이터 오염 가능성이 있어요.
  방어선 강화 — public schema 에서 모든 role 의 CREATE 권한 회수.
  ```

- [ ] **Step 3: Verify** — `grep -n '초기에는' docs/philosophy/adr-005-db-schema-isolation.md` → 0건

### Task 28: ADR-006:239 *초기에 JWT_SECRET=dev-secret* 산문 재작성

**Files:**
- Modify: `docs/philosophy/adr-006-hs256-jwt.md:239`

- [ ] **Step 1: Read line 230-260** — context

- [ ] **Step 2: Rewrite** — `초기에 JWT_SECRET=dev-secret (11자) 으로 설정했더니 jjwt 가 ...` → 기술적 사실 위주 (*시간 흐름* 제거):

  ```markdown
  짧은 JWT_SECRET (11자 미만) 은 jjwt 에서 길이 불충분 에러를 던집니다.
  에러 메시지가 모호해 원인 파악이 어려워요. 그래서 `JwtProperties` compact constructor 에서 ...
  ```

- [ ] **Step 3: Verify** — `grep -n '초기에' docs/philosophy/adr-006-hs256-jwt.md` → 0건

### Task 29: ADR-007:225 *초기에는 ADR 에 무엇을 할 것인가만* 산문 재작성

**Files:**
- Modify: `docs/philosophy/adr-007-solo-friendly-operations.md:225`

- [ ] **Step 1: Read line 215-240** — context

- [ ] **Step 2: Rewrite** — *시간 흐름* 제거 + *결정 근거* 보존:

  ```markdown
  ADR 에 결정만 기록하면 같은 질문이 반복됩니다 — *왜 K8s 안 써?*, *왜 HA 99.99% 안 세팅?* 등.
  근거까지 기록해 *질문 자체가 줄어드는* 형태가 솔로 인디에 적합해요.
  ```

- [ ] **Step 3: Verify** — `grep -n '초기에는' docs/philosophy/adr-007-solo-friendly-operations.md` → 0건

### Task 30: ADR-010:287, 290 *초기 구현은 split / 초기 구현 (버그)* 산문 재작성

**Files:**
- Modify: `docs/philosophy/adr-010-search-condition.md:287, 290`

- [ ] **Step 1: Read line 280-305** — context (split 구현 한계)

- [ ] **Step 2: Rewrite line 287** — `초기 구현은 \`key.split("_")\` 로 ... 문제는 ...` → `Naive split 구현 (\`key.split("_")\`) 의 한계 — 필드명에 underscore 있을 때 (예: \`app_slug_eq\`) ...`

- [ ] **Step 3: Edit code comment line 290** — `// 초기 구현 (버그)` → `// Naive split 구현 (버그)`

- [ ] **Step 4: Verify** — `grep -n '초기 구현' docs/philosophy/adr-010-search-condition.md` → 0건

### Task 31: ADR-013:325 *초기에는 AuthPort 에 메서드 5개* 산문 재작성

**Files:**
- Modify: `docs/philosophy/adr-013-per-app-auth-endpoints.md:325`

- [ ] **Step 1: Read line 315-340** — context

- [ ] **Step 2: Rewrite** — *시간 흐름* 제거 + 도메인 책임 범위 표현:

  ```markdown
  AuthPort 의 메서드 11개는 도메인의 자연 책임 범위입니다.
  signup / signin / refresh / withdraw / verifyEmail (5개) 외 — 비밀번호 리셋 2개, 재전송 1개,
  비밀번호 변경 1개, 소셜 2개. 인증 도메인은 메서드 수를 강제로 줄이는 것보다 *동일 책임 그룹화* 가 적합.
  ```

- [ ] **Step 3: Verify** — `grep -n '초기에는' docs/philosophy/adr-013-per-app-auth-endpoints.md` → 0건

### Task 32: ADR-014 *초기에는* 4곳 산문 재작성

**Files:**
- Modify: `docs/philosophy/adr-014-no-delegation-mock.md:268, 284, 300, 310`

- [ ] **Step 1: Read line 260-320** — 4 라인의 surrounding context 모두 파악

- [ ] **Step 2: Rewrite line 268 단락** — `초기에는 '테스트를 어떻게 쓸지' 가이드 없이 팀원마다 다른 스타일을 썼음` → `테스트 작성 가이드 부재 시의 문제 — 팀원마다 다른 스타일이 누적되면 ...` (*시간 흐름* → *원리 분석*)

- [ ] **Step 3: Rewrite line 284 단락** — `초기에는 외부 시스템도 mock() + when().thenReturn() 으로 처리했어요` → `외부 시스템을 \`mock() + when().thenReturn()\` 으로 처리하는 패턴의 문제 — ...`

- [ ] **Step 4: Rewrite line 300 단락** — `초기에 delegation mock 을 허용하면 테스트 작성은 빨라져 보임. ... 그런데:` → `delegation mock 허용 시의 trade-off — 작성 속도는 빨라지지만 ...`

- [ ] **Step 5: Rewrite line 310 단락** — `**교훈**: 어떤 패턴은 초기 비용이 낮아 ...` → `**원칙**: 초기 비용이 낮은 패턴이 누적 비용이 클 수 있음 — 금지 결정은 선제적 ...`

- [ ] **Step 6: Verify** — `grep -n '초기에는\|초기에 delegation\|초기 비용이 낮아' docs/philosophy/adr-014-no-delegation-mock.md` → 의도적 보존 (예: *초기 학습 곡선*) 외 0건

### Task 33: ADR-015:324 *초기에는 Co-Authored-By 트레일러* 산문 재작성

**Files:**
- Modify: `docs/philosophy/adr-015-conventional-commits-semver.md:324`

- [ ] **Step 1: Read line 315-340** — context

- [ ] **Step 2: Rewrite** — `초기에는 Co-Authored-By: Claude 트레일러를 자유롭게 썼음. 외부 감사/리뷰 시점에 문제 인식:` → `Co-Authored-By: Claude 트레일러는 외부 감사/리뷰 시 다음 문제 — ... 그래서 husky commit-msg hook 으로 차단해요.`

- [ ] **Step 3: Verify** — `grep -n '초기에는' docs/philosophy/adr-015-conventional-commits-semver.md` → 0건

### Task 34: ADR-016:366 *프로젝트 초기에는 UserMapper* 산문 재작성

**Files:**
- Modify: `docs/philosophy/adr-016-dto-mapper-forbidden.md:366`

- [ ] **Step 1: Read line 355-385** — context

- [ ] **Step 2: Rewrite** — `프로젝트 초기에는 UserMapper 를 썼었어요. 'Spring Boot 에서는 Mapper 가 표준' 이라는 관행적 판단.` → `UserMapper 패턴의 4가지 문제 — Spring Boot 관행으로 자주 채택되지만 ... 그래서 DTO Factory 로 대체해요.`

- [ ] **Step 3: Verify** — `grep -n '프로젝트 초기에는' docs/philosophy/adr-016-dto-mapper-forbidden.md` → 0건

### Task 35: ADR-019:3 *이전 단일 core-billing 안에* 산문 재작성

**Files:**
- Modify: `docs/philosophy/adr-019-billing-iap-payment-separation.md:3`

- [ ] **Step 1: Read line 1-15** — Status 라인의 context

- [ ] **Step 2: Rewrite** — `... 이전 단일 \`core-billing\` 안에 IAP receipt 검증 + subscription 정책 혼재됐던 구조를 책임별로 분리.` → `... core-billing 을 3 도메인 (billing / iap / payment) 으로 분리한 이유: IAP receipt 검증 + subscription 정책 + PG 결제가 단일 모듈에 혼재 시 책임 경계가 모호.`

- [ ] **Step 3: Verify** — `grep -n '이전 단일' docs/philosophy/adr-019-billing-iap-payment-separation.md` → 0건

### Task 36: ADR-001:274 + ADR-011:216, 229 *초기 설계에서는* 산문 재작성

**Files:**
- Modify: `docs/philosophy/adr-001-modular-monolith.md:274`
- Modify: `docs/philosophy/adr-011-layered-port-adapter.md:216, 229`

- [ ] **Step 1: Read adr-001 line 270-290** + **adr-011 line 210-240** — 두 ADR 의 surrounding context 파악

- [ ] **Step 2: Rewrite adr-001:274** — `초기 설계에서는 core-auth-impl 안의 AuthController 가 ... 런타임 bean 으로 등록되었습니다.` → `*대안 분석* — Controller 를 런타임 bean 으로 등록하는 방식의 문제: ...`

- [ ] **Step 3: Rewrite adr-011:216** — 동일 *대안 분석* 형태

- [ ] **Step 4: Rewrite adr-011:229** — `Hexagonal 원문은 'Primary Adapter' 라고 부르지만, ... 초기엔 'Adapter' 로 통일할지 고민했지만 ...` → `Hexagonal 원문은 'Primary Adapter' 이지만, Spring 관용은 \`*ServiceImpl\`. 우리 plzkt는 Spring 관용을 따라요 — 익숙함이 검토 비용을 낮춤.`

- [ ] **Step 5: Verify** — `grep -n '초기 설계에서는\|초기엔' docs/philosophy/adr-001-modular-monolith.md docs/philosophy/adr-011-layered-port-adapter.md` → 0건

### Task 37: ADR-012 *초기에 ... / 초기 1주일간* 7곳 산문 재작성 (가장 큰 변경)

**Files:**
- Modify: `docs/philosophy/adr-012-per-app-user-model.md:9, 13, 38, 236, 246, 254, 262`

- [ ] **Step 1: Read line 1-50** + **line 230-270** — 두 영역의 context 모두 정확 파악

- [ ] **Step 2: Rewrite line 9** — `초기에 생각했던 '통합 계정 + ThreadLocal 라우팅' 모델은 전부 폐기했습니다. 이유는 UX · 프라이버시 · 구현 복잡도 세 전선에서 동시에 지고 있었기 때문.` → `*통합 계정 + ThreadLocal 라우팅* 모델은 채택하지 않습니다 — UX · 프라이버시 · 구현 복잡도 3 전선에서 모두 한계 (아래 분석).`

- [ ] **Step 3: Rewrite line 13** — `초기 설계에서는 '유저는 한 명, 앱 접근 권한만 분기' 모델을 먼저 검토했어요. 이상적으로 들리는 그림:` → `*대안 1 — 유저는 한 명, 앱 접근 권한만 분기*. 이상적으로 들리지만:`

- [ ] **Step 4: Rewrite line 38** — `통합 계정 모델이 성립하려면 ... 이걸 위해 초기 설계에서는:` → `통합 계정 모델이 성립하려면 ... 이걸 위해 *고려된 메커니즘*:`

- [ ] **Step 5: Rewrite line 236** — `초기에 한 번 '왜 이 엔드포인트가 호출이 안 되지?' 로 시간을 날린 적이 있습니다. 그 이후 다음 세 가지를 동시에 박음:` → `엔드포인트 라우팅 디버깅의 어려움을 줄이기 위한 3가지 안전 장치:`

- [ ] **Step 6: Rewrite line 246** — `초기 1주일간 AbstractRoutingDataSource + ThreadLocal 조합으로 구현 시도했어요. 구현은 되는데 테스트가 계속 새어나가는 문제가 있었음.` → `*대안 — AbstractRoutingDataSource + ThreadLocal 조합* 의 한계: 구현은 되지만 테스트가 새어나갑니다.`

- [ ] **Step 7: Rewrite line 254** — `초기엔 \`apps: ["sumtally"]\` 배열 claim 으로 설계했다가 \`appSlug: "sumtally"\` 단일로 변경. 이 과정에서:` → `JWT claim 형태 — \`apps\` 배열 vs \`appSlug\` 단일 비교:`

- [ ] **Step 8: Rewrite line 262** — `**교훈**: JWT claim 설계는 초기에 확정해야 함.` → `**원칙**: JWT claim 설계는 첫 발급 시점에 확정해요.`

- [ ] **Step 9: Verify** — `grep -n '초기에\|초기 설계에서는\|초기 1주일간\|초기엔' docs/philosophy/adr-012-per-app-user-model.md` → 0건

### Task 38: ADR-002:308 *2026 초반 — 파생 레포 전파 실험 초기* 산문 재작성

**Files:**
- Modify: `docs/philosophy/adr-002-use-this-template.md:308`

- [ ] **Step 1: Read line 300-325** — context

- [ ] **Step 2: Rewrite** — `**2026 초반 — 파생 레포 전파 실험 초기에 발견한 3가지 함정.**` → `**파생 레포 전파 시 발견된 3가지 함정.**` (*시간 표현* 제거, *기술 사실* 만 보존)

- [ ] **Step 3: Verify** — `grep -n '2026 초반' docs/philosophy/adr-002-use-this-template.md` → 0건

### Task 39: production/decisions-infra:193 *2026-04-19 범위 재조정* 산문 재작성

**Files:**
- Modify: `docs/production/deploy/decisions-infra.md:193`

- [ ] **Step 1: Read line 185-210** — context (Item 5 의 적용 범위)

- [ ] **Step 2: Rewrite** — `- **결정일**: Item 5 (Phase A~M). 2026-04-19 범위 재조정 — 로컬 dev 에서 제거, 운영 전용으로 한정.` → `- **결정**: Item 5 의 적용 범위 — 운영 전용 (로컬 dev 에서 제외). 이유: 로컬 dev 에서 ... (재조정 근거).`

- [ ] **Step 3: Verify** — `grep -n '범위 재조정\|2026-04-19' docs/production/deploy/decisions-infra.md` → 0건

### Task 40: edge-cases.md Phase E.5 / F / G 표현 정리

**Files:**
- Modify: `docs/reference/edge-cases.md:94, 301-302, 318, 416`

- [ ] **Step 1: Read line 90-100, 295-325, 410-425** — 4 영역의 context 파악

- [ ] **Step 2: Edit line 94** — `Phase E.5 (PasswordResetService) 에서 구현 시 반영` → `(향후 PasswordResetService 구현 시 반영)`

- [ ] **Step 3: Edit line 301-302** — `Phase F 에서 구현 예정` → `(향후 구현 예정)` / `Phase G 에서 WithdrawService 구현 예정` → `(향후 WithdrawService 구현 예정)`

- [ ] **Step 4: Edit line 318** — `Withdraw 플로우 (Phase G) + 30 일 후 hard delete (Phase 1 스케줄러).` → `Withdraw 플로우 + 30 일 후 hard delete.` (Phase 표기 제거)

- [ ] **Step 5: Edit line 416** — `Phase F/G 에서 순차 구현` → `(향후 순차 구현)`

- [ ] **Step 6: Verify** — `grep -nE 'Phase [A-Z]\b' docs/reference/edge-cases.md` → 0건 (또는 *(향후)* 표기와 분리)

### Task 41: S5 종합 검증 + commit

- [ ] **Step 1: 종합 grep verify**
  ```bash
  grep -rEn '초기에는|이전에는|예전에는|초기 구현|초기 설계에서는|초기 1주일간|초기엔|2026 초반|범위 재조정|프로젝트 초기에는' docs/
  ```
  → 0건 (의도적 보존 — *초기 셋업 비용*, *초기 학습 곡선* 등 — 만 남음)

- [ ] **Step 2: docs-contract-test PASS** — `bash tools/docs-check/docs-contract-test.sh` → 4/4 PASS

- [ ] **Step 3: Commit S5**
  ```bash
  git add docs/philosophy/adr-001-modular-monolith.md docs/philosophy/adr-002-use-this-template.md docs/philosophy/adr-005-db-schema-isolation.md docs/philosophy/adr-006-hs256-jwt.md docs/philosophy/adr-007-solo-friendly-operations.md docs/philosophy/adr-010-search-condition.md docs/philosophy/adr-011-layered-port-adapter.md docs/philosophy/adr-012-per-app-user-model.md docs/philosophy/adr-013-per-app-auth-endpoints.md docs/philosophy/adr-014-no-delegation-mock.md docs/philosophy/adr-015-conventional-commits-semver.md docs/philosophy/adr-016-dto-mapper-forbidden.md docs/philosophy/adr-019-billing-iap-payment-separation.md docs/production/deploy/decisions-infra.md docs/reference/edge-cases.md
  git commit -m "docs(philosophy): s5 adr 14곳 + edge-cases — 초기에는 x 였고 변명 → 대안 비교 형태로 산문 재작성

  - adr-001/002/005/006/007/010/011/012/013/014/015/016/019/024 의 *초기에는*/*이전에는* 표현 제거
  - adr-005:87 core/users 라벨 (검증 후 분류)
  - decisions-infra:193 *2026-04-19 범위 재조정* 표현 제거
  - edge-cases phase e.5/f/g → (향후) 표기로 의미 명확화
  - 결정 근거 (대안 비교 / 트레이드오프) 는 모두 보존"
  ```

---

## S6 — symlink 일관성

### Task 42: 노테이션 박스 추가 (onboarding.md + cli-guide.md 진입부)

**Files:**
- Modify: `docs/start/onboarding.md` 진입부 (메타블록 직후)
- Modify: `docs/start/cli-guide.md` 진입부 (메타블록 직후)

- [ ] **Step 1: Read onboarding.md line 1-15** — 메타블록 위치 확인

- [ ] **Step 2: Insert notation box (onboarding.md)** — 메타블록 직후에 다음 박스 추가:
  ```markdown
  > **편의를 위해 `<repo-name>` 심볼릭 링크를 등록했습니다.**
  >
  > 본 문서의 `<repo-name> <verb>` 표기는 `./factory install` 후 등록된
  > `~/.local/bin/<repo-name>` symlink 를 의미해요. `<repo-name>` 자리에는
  > *파생 레포의 이름* (예: `sumtally`, `gymlog`) 이 들어가요.
  >
  > symlink 미등록 시 `bash ./factory <verb>` 또는 직접 `bash tools/<low-level>.sh`
  > 호출도 동등해요.
  ```

- [ ] **Step 3: Read cli-guide.md line 1-15** — 메타블록 위치 확인

- [ ] **Step 4: Insert notation box (cli-guide.md)** — 동일 박스 추가

- [ ] **Step 5: Verify** — `grep -c '편의를 위해 `<repo-name>` 심볼릭' docs/start/onboarding.md docs/start/cli-guide.md` → 각 1건

### Task 43: dogfood-faq.md 직접 호출 → factory wrapper 통일

**Files:**
- Modify: `docs/start/dogfood-faq.md:165, 179`

- [ ] **Step 1: Read line 160-185** — context (start-server / verify-server 설명)

- [ ] **Step 2: Edit line 165** — `bash tools/start-server.sh # docker compose + postgres ready 만` → `<repo-name> local start # docker compose + postgres ready 만`

- [ ] **Step 3: Edit line 179** — `init-server.sh Step 10 에서 자동 호출돼요 (단독 실행도 가능해요: \`bash tools/verify-server.sh\`).` → `init-server.sh Step 10 에서 자동 호출돼요 (단독 실행도 가능해요: \`<repo-name> prod server-test\`).`

- [ ] **Step 4: Verify** — `grep -n 'bash tools/start-server\|bash tools/verify-server' docs/start/dogfood-faq.md` → 0건

### Task 44: dogfood-setup.md 직접 호출 → factory wrapper 통일

**Files:**
- Modify: `docs/start/dogfood-setup.md:295, 303, 334`

- [ ] **Step 1: Read line 290-340** — context

- [ ] **Step 2: Edit line 295** — `\`bash tools/verify-local.sh\` 다시 돌리면 4/4 PASS` → `\`<repo-name> local server-test\` 다시 돌리면 4/4 PASS`

- [ ] **Step 3: Edit line 303** — `단독 실행도 가능해요: \`bash tools/verify-server.sh\`` → `단독 실행도 가능해요: \`<repo-name> prod server-test\``

- [ ] **Step 4: Edit line 334** — `**자동 검증 (선택)**: \`bash tools/verify-local.sh\` —` → `**자동 검증 (선택)**: \`<repo-name> local server-test\` —`

- [ ] **Step 5: Verify** — `grep -n 'bash tools/verify-local\|bash tools/verify-server' docs/start/dogfood-setup.md` → 0건 (Task 38 이 변경하지 않은 line 40, 201, 283 의 init-server.sh 호출은 그대로 — symlink 등록 *전* 단계)

### Task 45: S6 종합 검증 + commit

- [ ] **Step 1: factory wrapper verb list 추출**:
  ```bash
  sed -n '/── env-verb 명령어/,/── 메타 레포/p' factory | grep -oE '\b(local|prod|all)?\s*[a-z][a-z-]+\b' | sort -u > /tmp/factory-verbs.txt
  ```

- [ ] **Step 2: docs <repo-name> verb 추출**:
  ```bash
  grep -rEoh '<repo-name>\s+(local|prod|all)?\s*[a-z][a-z-]+' docs/ | sed 's/<repo-name> //' | sort -u > /tmp/docs-verbs.txt
  ```

- [ ] **Step 3: broken command 검증** — `comm -23 /tmp/docs-verbs.txt /tmp/factory-verbs.txt` → 0건

- [ ] **Step 4: docs-contract-test PASS** — `bash tools/docs-check/docs-contract-test.sh` → 4/4 PASS

- [ ] **Step 5: Commit S6**
  ```bash
  git add docs/start/onboarding.md docs/start/cli-guide.md docs/start/dogfood-faq.md docs/start/dogfood-setup.md
  git commit -m "docs(start): s6 symlink 일관성 — <repo-name> <verb> 표기 통일 + 노테이션 박스

  - onboarding.md / cli-guide.md 진입부에 <repo-name> 심볼릭 링크 노테이션 박스 추가
  - dogfood-faq / dogfood-setup 의 직접 bash tools/X.sh 호출 → <repo-name> <verb> 통일
  - init-server.sh / dogfooding/setup.sh 등 1회성 운영 도구는 직접 호출 그대로 유지
  - factory wrapper verb 와 docs <repo-name> 표기 1:1 매칭 확인 (broken command 0)"
  ```

---

## S7 — 잘못된 plan stub 정정

### Task 46: ~/.claude/plans/elegant-crafting-rain.md 의 cleanup 표 정정

**Files:**
- Modify: `~/.claude/plans/elegant-crafting-rain.md`

- [ ] **Step 1: Read existing plan stub** — `~/.claude/plans/elegant-crafting-rain.md` 의 *마지막 사이클 (Cleanup)* 섹션 위치 파악

- [ ] **Step 2: Replace cleanup 표** — spec 의 §8 *S7* 표 4개 항목 (`tools/dogfooding/`, `legacy 호환`, `PortOne v1`, `ConditionalOnExpression`) 으로 정정.

- [ ] **Step 3: Mark *마지막 사이클 (Cleanup)* 섹션을 *완료* 로 갱신** — 본 사이클 (S1~S8) 의 결과를 명시. ADR 14곳 정리 항목도 본 plan 의 결론으로 명시.

- [ ] **Step 4: Verify** — plan stub 의 *옛 도그푸딩 자동화*, *legacy 면 제거*, *legacy 라벨 제거* 같은 잘못된 단정 표현 제거. (이건 본 conversation 외부 메모리 파일이라 git commit 대상 아님 — 그대로 둠.)

> **Note**: 본 plan stub 파일은 `~/.claude/plans/` 의 *Claude Code 메모리* 영역이라 *본 사이클 commit 대상 아님*. 내용만 정정하고 다음 task 로 진행.

---

## S8 — 사이클 종합 검증 + push

### Task 47: ci-test 5/5 PASS

- [ ] **Step 1: ci-test 실행** — `bash tools/ci-test.sh`
  ```
  Expected:
  ✓ Spotless apply
  ✓ Build (compile + 22 ArchUnit + jacoco)
  ✓ Docs contract test (4/4)
  ✓ Docs-check unit test (4/4)
  ✓ gitleaks (no leaks)
  5 PASS, 0 FAIL
  ```

### Task 48: 사이클 grep 종합 검증

- [ ] **Step 1: 옛 변명 표현 grep**
  ```bash
  grep -rEn '옛 자동화|legacy 호환|legacy AND|legacy = 둘 다|진화 기록|Phase A.*Phase B|이전에는.*cleanup 사이클|deprecated.*ADR.*대체' docs/
  ```
  → 0건

- [ ] **Step 2: ATH_006 grep**
  ```bash
  grep -rEn 'AuthError\.EMAIL_DELIVERY_FAILED|ATH_006' core/ common/ docs/
  ```
  → 0건

- [ ] **Step 3: 우리 플젝 시간 흐름 grep**
  ```bash
  grep -rEn '초기에는|예전에는|초기 구현|초기 설계에서는|초기 1주일간|2026 초반|범위 재조정|프로젝트 초기에는' docs/
  ```
  → 0건 (의도적 보존만)

- [ ] **Step 4: Phase 표현 grep**
  ```bash
  grep -rEn 'Phase [A-Z]\b' docs/ | grep -v '향후\|planned\|phase 1.*read TX\|phase 2.*NO TX\|phase 3.*write TX'
  ```
  → 0건 (Roadmap 의 *향후* 표기와 알고리즘 Phase 외)

### Task 49: 마지막 push (모든 사이클 끝)

- [ ] **Step 1: git status clean 확인** — `git status` → `nothing to commit, working tree clean`

- [ ] **Step 2: git log 마지막 8 commits 확인** — `git log --oneline -8` 으로 S1~S6 commits + spec + 메타블록 commit 확인

- [ ] **Step 3: push 1회** — `git push origin main` (사용자 메모리: 모든 사이클 끝 1회만)

- [ ] **Step 4: GHA Actions 결과 모니터링** — push 후 GitHub Actions (ci-test / docs-check) 5분 내 PASS 확인. fail 시 즉시 fix.

---

## Critical risk + Recovery

| Risk | Recovery |
|---|---|
| **Task 24 Flyway migrate 실패 (V001/V008 squash schema 불일치)** | `git revert HEAD` (Task 25 commit 직전 stage 만 revert). 또는 force-clear 환경 → `docker compose down -v` 후 squash 재시도. |
| **Task 12 build fail (ATH_006 enum 제거 후 컴파일 에러)** | `git diff HEAD core/` 확인 후 enum 인용 누락된 곳 수정 (실제 throw 코드 0건이라 가능성 낮음). |
| **Task 32-37 산문 재작성 후 결정 근거 손실** | 각 ADR 의 *대안 비교* / *트레이드오프* 보존되었는지 task 별 verify step 의 grep 으로 재확인. 누락 시 해당 task 만 git revert 후 산문 재작성. |
| **Task 49 push 후 GHA fail** | GHA log 확인. ci-test 가 PASS 였으니 GHA 만의 차이 (env / secret) 식별 후 hot-fix commit + push. |

---

## Out-of-scope (별도 사이클)

본 plan 이 다루지 *않는* 후속 작업:

- 새 기능 추가
- 코드 리팩토링 (산문 외)
- 테스트 추가
- 운영 호스트 (Mac mini) 배포 검증 — 사용자 직접
- factory wrapper 에 dogfooding/setup.sh 등록 (1회성 도구라 등록 안 함)

---

## Success criteria

- ✅ 49 tasks 모두 PASS (S1~S8 의 sub-session 별 commit 8개)
- ✅ Flyway 마이그레이션 9 → 6 파일, schema 동일성 검증
- ✅ ci-test 5/5 PASS
- ✅ 우리 플젝 옛 변명 표현 grep 0건
- ✅ ATH_006 / EMAIL_DELIVERY_FAILED grep 0건
- ✅ git push 1회 (모든 사이클 끝)
- ✅ plan stub (`~/.claude/plans/elegant-crafting-rain.md`) 정정
- ✅ symlink 일관성 — `<repo-name> <verb>` 표기 통일 + 노테이션 박스 2 위치
