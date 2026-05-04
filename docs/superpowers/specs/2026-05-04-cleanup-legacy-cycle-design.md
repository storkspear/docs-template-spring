# Cleanup Legacy Cycle — Design Spec

> **유형**: Spec · **독자**: Level 2~3 (이 사이클 implementer) · **읽는 시간**: ~20분

**Goal** — `template-spring` 의 *우리 플젝 옛 흐름 변명* 을 모두 정리. 파생 레포 소유자에게 *깔끔한 시작점* 으로서의 신뢰도 확보.

**Architecture** — 5 layer 정리:
1. **잘못된 docs 라벨** (*옛 자동화*, *legacy 호환*) — 현재 사용 중인 도구에 잘못 붙은 라벨만 제거
2. **잘못된 code 라벨** (`./factory:21,31` 의 *legacy 호환*) — 1급 명령에 잘못 붙은 라벨만 제거
3. **실제 unused 코드** (ATH_006 enum / Flyway V003/V004/V009 진화 흔적) — 안전 제거
4. **ADR 의 *초기에는 X 였고 Y 로 보완* 변명** (14 ADR) — *대안 비교* 형태로 산문 재작성
5. **symlink 일관성** — 직접 `bash tools/<X>.sh` 호출을 `<repo-name> <verb>` 표기로 통일 + 노테이션

**Tech Stack** — Bash, Markdown, Java (enum 제거 / javadoc 갱신), SQL (Flyway squash), Postgres, Spring Boot 3.5

---

## Non-goals

본 사이클이 다루지 *않는* 것 — 별도 사이클로 분리:
- 새 기능 추가
- 코드 리팩토링 (산문 외)
- 테스트 추가
- 마이그레이션 *번호* 정정 (V005~V007 의 모듈별 namespace 는 의도적 — 진화 흔적 X)
- 운영 호스트 (Mac mini) 배포 검증

---

## 1. Sub-session 분할 (8 commits)

| Sub-session | 묶음 | 변경 크기 | 검증 |
|---|---|---|---|
| **S1**. docs only legacy 라벨 정리 | T4 verifyEmailLegacy 추상화 + T5 basic-bucket + T7 legacy AND 라벨 + T8 cli-guide/onboarding legacy 호환 | docs ~6 파일 | docs-contract C2/C3 |
| **S2**. ATH_006 EMAIL_DELIVERY_FAILED 제거 | T2 (enum + javadoc 2 + docs 6) | code 3 + docs 6 | build PASS + grep 0 |
| **S3**. adr-034 *진화 기록* 박스 + Phase A/B 정리 | T7 adr-034 산문 재작성 | docs 1 | grep 0 + docs-contract |
| **S4**. Flyway V003/V004/V009 squash | T1 V001/V008 통합 + sql -3 + docs ~2 | sql -3 / sql 2 통합 | force-clear + bootRun + 22 ArchUnit |
| **S5**. ADR 14곳 *초기에는 X 였고* 변명 정리 | 14 ADR 산문 재작성 (*대안 비교* 형태로 변환) | docs ~14 파일 | grep 0 |
| **S6**. symlink 일관성 — `<repo-name> <verb>` 통일 + 노테이션 | docs ~6-8 파일 | docs ~6-8 | factory verb 와 1:1 매칭 |
| **S7**. 잘못된 plan stub 정정 | `~/.claude/plans/elegant-crafting-rain.md` cleanup 표 정정 | plan 1 파일 | — |
| **S8**. 사이클 종합 검증 + push | grep 0 + ci-test 5/5 + git push 1회 | — | 전체 grep + ci-test |

**순서 원칙** — docs only 영향 작은 → 코드 변경 큰 → 산문 큰 → meta (plan / push). fail 시 rollback 영향 작은 부분만.

---

## 2. S1 — docs only legacy 라벨 정리

### T4 verifyEmailLegacy 가상 예시 → 추상화

**File: `docs/api-and-functional/api/versioning.md`**

| line | Before | After |
|---|---|---|
| 81, 194 | `**core-auth-api**: \`AuthPort.verifyEmailLegacy\` — use \`verifyEmail\`` | `**module-name**: \`oldMethodName\` — use \`newMethodName\`` |
| 177 | `public void verifyEmailLegacy(VerifyEmailRequest request)` | `public void oldMethodName(RequestType request)` |

**File: `docs/api-and-functional/functional/migration.md`**

| line | Before | After |
|---|---|---|
| 37 | `## 1. UserPort.verifyEmailLegacy → verifyEmail` | `## 1. (예시) ModulePort.oldMethodName → newMethodName` |
| 41 | `authPort.verifyEmailLegacy(...)` | `modulePort.oldMethodName(...)` |
| 53 | `전역 search/replace: \`verifyEmailLegacy\` → \`verifyEmail\`` | `전역 search/replace: \`oldMethodName\` → \`newMethodName\`` |

### T5 basic-bucket (legacy)

**File: `docs/production/setup/storage-bucket-isolation.md:24`**

```diff
 MinIO (단일 endpoint)
-    ├── basic-bucket           ← 운영자 직접 등록 (legacy)
     ├── gymlog-uploads         ← <slug>-<category> 컨벤션
```

→ 라인 자체 삭제. *(예시)* 의도였다면 *MinIO 의 default bucket 도 동일 트리에 표현* 같은 의미 라벨로 교체. 작업 시 컨텍스트 재검토.

### T7 ConditionalOnExpression (legacy AND) — 표 라벨만

**File: `docs/philosophy/adr-034-feature-toggle-lite-mode.md:90`**

```diff
-| `app.features.billing-notification` | `@ConditionalOnExpression` (legacy AND) | true | listener 미등록 |
+| `app.features.billing-notification` | `@ConditionalOnExpression` (`audit AND billing-notification`) | true | listener 미등록 |
```

→ "*legacy AND*" 가 표현하는 의미는 **두 feature flag 의 AND 조합** (audit + billing-notification 둘 다 true 때만 등록). *legacy* 가 아닌 *AND 조합 명시* 로 정정. 작업 시 실제 조건식 코드 (`BillingAutoConfiguration.java`) 확인 후 정확한 표현.

### T8 factory legacy 호환 명령

**File: `./factory` (wrapper)**

| line | Before | After |
|---|---|---|
| 21 | `all   init                 위 둘 한 번에 (legacy 호환)` | `all   init                 local + prod 동시` |
| 31 | `local test                 server-test + api-test 순차 (legacy = 둘 다)` | `local test                 server-test + api-test 순차` |

**File: `docs/start/cli-guide.md`**

| line | Before | After |
|---|---|---|
| 28 | `\| 둘 다 한 번에 (legacy) \|` | `\| local + prod 동시 \|` |
| 39 | `\| \`server-test\` + \`api-test\` 순차 (legacy 호환) \|` | `\| \`server-test\` + \`api-test\` 순차 \|` |

**File: `docs/start/onboarding.md:148`**

```diff
-# ── (legacy 호환) 한 번에 모두 ─────────────────────────
+# ── 한 번에 모두 (local + prod 동시) ─────────────────────────
```

---

## 3. S2 — ATH_006 EMAIL_DELIVERY_FAILED 제거

### Code (3 파일)

**File: `core/core-auth-api/src/main/java/com/factory/core/auth/api/exception/AuthError.java`**

```diff
     EMAIL_VERIFICATION_FAILED(...),
     ...
-    /**
-     * @deprecated since ADR-024 (2026-04-XX). 이메일 발송 실패는
-     *   {@code com.factory.core.email.api.exception.EmailError#EMAIL_DELIVERY_FAILED} ({@code
-     *   EMAIL_001}) 로 throw. 본 enum constant 는 BC 위해 유지하되 unused — 다음 cleanup 사이클에 제거 예정.
-     */
-    EMAIL_DELIVERY_FAILED(503, "ATH_006", "이메일 발송에 실패했습니다 (deprecated, see EmailError.EMAIL_001)"),
```

**File: `core/core-auth-api/src/main/java/com/factory/core/auth/api/exception/AuthException.java:16`**

```diff
- * throw new AuthException(AuthError.EMAIL_DELIVERY_FAILED, cause);
+ * throw new AuthException(AuthError.INVALID_CREDENTIALS, cause);
```

**File: `common/common-web/src/main/java/com/factory/common/web/exception/BaseException.java:23`**

```diff
- * throw new AuthException(AuthError.EMAIL_DELIVERY_FAILED, cause);
+ * throw new AuthException(AuthError.INVALID_CREDENTIALS, cause);
```

(javadoc 예시 — 다른 enum constant 로 교체. 실제 throw 코드 X.)

### Docs (6 파일)

**File: `docs/convention/exception-handling.md:90`** — `~~ATH_006~~` deprecated 표 행 통째 삭제.

**File: `docs/api-and-functional/api/flutter-backend-integration.md:347`**

```diff
-| 이메일 발송 실패 | 502 | `EMAIL_001` (ADR-024 — 옛 `ATH_006` 대체) |
+| 이메일 발송 실패 | 502 | `EMAIL_001` |
```

**File: `docs/api-and-functional/api/api-response.md:268`** — 동일 처리.

**File: `docs/api-and-functional/functional/email-verification.md`** — line 491-503 의 *before/after 비교 + ATH_006 deprecated 라인* 통째 삭제. 단순히 `EMAIL_001` 로만 표현.

**File: `docs/philosophy/adr-024-email-domain-extraction.md`**

| line | Before | After |
|---|---|---|
| 39 | `├─ EmailError.java         ← 신규 (EMAIL_DELIVERY_FAILED 등)` | `├─ EmailError.java         ← EMAIL_DELIVERY_FAILED (EMAIL_001)` |
| 68 | `이전에는 ResendEmailAdapter 가 \`AuthException(AuthError.EMAIL_DELIVERY_FAILED, cause)\` 를 throw. 이제는:` | (해당 단락 제거 후) `이메일 발송 실패는 \`EmailException(EmailError.EMAIL_DELIVERY_FAILED, cause)\` 로 처리해요:` |
| 76 | `\`AuthError.EMAIL_DELIVERY_FAILED\` 는 unused 상태로 남음 (BC 위해 enum 값 유지). 다음 cleanup 사이클에 제거 가능.` | (라인 통째 삭제) |
| 112 | `**AuthError.EMAIL_DELIVERY_FAILED 제거** — unused 상태. 다음 cleanup.` | (라인 통째 삭제) |

### 검증

```bash
grep -rn 'AuthError.EMAIL_DELIVERY_FAILED\|ATH_006' core/ common/ docs/  # 0건
./gradlew build                                                          # PASS
bash tools/docs-check/docs-contract-test.sh                              # 4/4 PASS
```

---

## 4. S3 — adr-034 *진화 기록* + Phase A/B 정리

**File: `docs/philosophy/adr-034-feature-toggle-lite-mode.md`**

### L82 *진화 기록* 박스

```diff
-> 📌 **진화 기록**: 본 ADR 초기 설계 → 8 도메인 단순 토글 가정 → 실 검증 시 부팅 fail (non-leaf) → leaf 4 만 적용 (Phase A) → ObjectProvider 변환 invasive 작업 완료 (Phase B, 2026-05-02) → 7 도메인 모두 안전 토글.
+> 📌 **적용 범위**: 7 도메인 모두 안전 토글 가능. non-leaf 모듈은 의존 측에서 ObjectProvider 로 lazy 의존, leaf 모듈은 단순 ConditionalOnProperty.
```

### L115-116 Phase A / Phase B

```diff
-  - Phase A (2026-05-02 첫 commit): leaf 4 만 토글, non-leaf 4 backlog
-  - Phase B (2026-05-02 후속): ObjectProvider invasive 변환 → 7 도메인 토글 완성
+  - **Leaf 모듈** (의존 받지 않음): `@ConditionalOnProperty` 만으로 안전 토글
+  - **Non-leaf 모듈** (의존 받음): 의존 측에서 `ObjectProvider<Port>` 로 lazy 의존 → toggle off 시에도 컴파일 / 부팅 OK
```

→ *플젝 시간 흐름* (Phase A → Phase B) → *기술 패턴 분류* (Leaf vs Non-leaf) 로 변환.

> 본 ADR 은 의도적 회고를 별도 보존하지 않습니다. *Phase A → Phase B* 의 시간 흐름은 git log 가 정확. ADR 본문은 *현재 적용 패턴* 만 표현해요.

---

## 5. S4 — Flyway V003/V004/V009 squash

### V001__init_users.sql 통합 (V001 + V003 + V004)

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

### V008__init_devices.sql 통합 (V008 + V009)

```sql
CREATE TABLE devices (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id),
    app_slug        VARCHAR(50) NOT NULL,
    platform        VARCHAR(10) NOT NULL,
    push_token      VARCHAR(512),
    device_name     VARCHAR(100),
    last_seen_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_devices_user_id ON devices(user_id);
CREATE INDEX idx_devices_push_token ON devices(push_token);
CREATE UNIQUE INDEX uk_devices_user_app_platform ON devices(user_id, app_slug, platform);
```

### git rm

```bash
git rm core/core-user-impl/src/main/resources/db/migration/core/V003__add_users_email_index.sql
git rm core/core-user-impl/src/main/resources/db/migration/core/V004__add_totp_to_users.sql
git rm core/core-device-impl/src/main/resources/db/migration/core/V009__add_devices_updated_at.sql
```

### Docs 갱신

**File: `docs/production/deploy/infrastructure.md`** — V001~V009 마이그레이션 list 갱신 + squash backlog 안내 행 제거.

**File: `docs/philosophy/adr-033-flyway-hybrid-policy.md`** — 마이그레이션 예시 인용 위치가 V003/V004/V009 사용 시 갱신.

### 검증 절차

```bash
# 1. local docker volume 초기화
docker compose down -v
docker compose up -d postgres

# 2. core schema Flyway migrate
./gradlew :core:core-user-impl:flywayMigrate
./gradlew :core:core-device-impl:flywayMigrate

# 3. squash 전 후 schema 동일성 검증
psql -h localhost -U postgres -d factory -c '\d users'
# 기대: id, email, password_hash, display_name, email_verified, is_premium, role,
#       created_at, updated_at, deleted_at, totp_secret, totp_enabled, totp_backup_codes
# 기대 인덱스 4개

psql -h localhost -U postgres -d factory -c '\d devices'
# 기대: id, user_id, app_slug, platform, push_token, device_name,
#       last_seen_at, created_at, updated_at
# 기대 인덱스 3개

# 4. 22 ArchUnit + 단위 테스트 PASS
./gradlew build

# 5. bootRun + actuator
./gradlew :bootstrap:bootRun &
curl -fs http://localhost:8080/actuator/health | jq .status      # "UP"
```

### Rollback

squash 후 schema 가 squash 전과 다르면 git revert. force-clear 가능 환경이라 재시도 안전.

---

## 6. S5 — ADR 14곳 *초기에는 X 였고* 변명 정리

### 변환 원칙

| Before (NG) | After (OK) |
|---|---|
| *초기에는 X 를 시도했어요. 그러나 Y 문제로 Z 로 변경* | *X 대안은 Y 문제가 있어 Z 가 적합* |
| *프로젝트 초기에는 X 를 썼어요* | *X 패턴은 ... 의 문제로 사용하지 않아요* |
| *이전 단일 X 안에 Y 혼재* | *X 를 N 도메인으로 분리한 이유: ...* |

→ *플젝 시간 흐름* 제거 + *대안 비교 / 결정 근거* 보존.

### 14 ADR 정리 대상

각 ADR 정독 시 의도적 회고 (*acceptance log* / *retrospective*) 표현은 별도 섹션으로 분리 후 보존 — *결정 근거* 와 *플젝 시간 변명* 의 경계가 분명할 때.

| ADR | line | 변명 단어 | 정정 방향 |
|---|---|---|---|
| **adr-001** | 274 | *초기 설계에서는 ... 런타임 bean 으로 등록* | *대안 분석 — Controller 를 런타임 bean 등록 방식의 문제* |
| **adr-002** | 308 | *2026 초반 — 파생 레포 전파 실험 초기* | 시간 표현 제거. *파생 레포 전파 시 발견된 3가지 함정* |
| **adr-005** | 87 | *core/users 참조용 / 레거시* | **검증 명령**: `grep -rn 'FROM core\.users\|core_users\|core.*\.users' core/ apps/ --include='*.java' --include='*.sql'` 로 *core/users* 의 *현재 사용 여부* 검증. 사용 X = *(admin / dev 계정용)* 표기로 의미 명확. 사용 O = *레거시* 라벨만 제거 (그 외 의미는 보존) |
| **adr-005** | 210 | *초기에는 role 만 충분하다고 생각* | *role-only 격리는 Postgres < 15 의 public schema CREATE 권한 때문에 불충분* |
| **adr-006** | 239 | *초기에 JWT_SECRET=dev-secret (11자)* | *짧은 JWT_SECRET 은 jjwt 에서 길이 불충분 에러* |
| **adr-007** | 225 | *초기에는 ADR 에 무엇을 할 것인가만* | *ADR 에 결정만 기록하면 6개월 후 같은 질문이 반복됨 → 근거까지 기록* |
| **adr-010** | 287, 290 | *초기 구현은 split / 초기 구현 (버그)* | *Naive split 구현의 한계 — 필드명에 underscore 있을 때 ...* |
| **adr-011** | 216, 229 | *초기 설계에서는 ... 런타임 bean / 초기엔 Adapter 로 통일* | *Spring 관용 (`*ServiceImpl`) vs Hexagonal 원문 (Adapter) 비교 분석* |
| **adr-012** | 9, 13, 38, 236, 246, 254, 262 | *초기에 생각했던 ... 모델 폐기 / 초기 1주일간 / 초기엔 apps 배열* | *통합 계정 모델의 3가지 한계 (UX / 프라이버시 / 구현 복잡도) — 채택하지 않은 이유* |
| **adr-013** | 325 | *초기에는 AuthPort 에 메서드 5개로 시작* | *AuthPort 의 메서드 11개 — 도메인의 자연 책임 범위* |
| **adr-014** | 268, 284, 300, 310 | *초기에는 가이드 없이 / mock() 으로 / delegation mock 허용하면* | *delegation mock 의 4가지 부작용 — 금지 결정 근거* |
| **adr-015** | 324 | *초기에는 Co-Authored-By: Claude 트레일러* | *Co-Authored-By: Claude 트레일러는 외부 감사 시 .... 그래서 git config 로 차단* |
| **adr-016** | 366 | *프로젝트 초기에는 UserMapper 를 썼었어요* | *UserMapper 패턴의 4가지 문제 — DTO Factory 로 대체* |
| **adr-019** | 3 | *이전 단일 core-billing 안에 IAP receipt + subscription 혼재* | *core-billing 을 3 도메인 (billing/iap/payment) 으로 분리한 이유* |
| **adr-024** | 68 (S2 에서 일부 처리) | *이전에는 AuthException throw* | (S2 에서 처리) |
| **production/decisions-infra** | 193 | *2026-04-19 범위 재조정* | *Item 5 의 적용 범위 = 운영 전용 (로컬 dev 제외) 의 결정 근거* |

### edge-cases Phase E.5 / F / G — 별도 처리

| line | 내용 | 처리 |
|---|---|---|
| 94 | *Phase E.5 (PasswordResetService)* | Roadmap Phase = 미래 계획. *(planned)* 또는 *(향후)* 로 의미 명확화 |
| 301-302 | *Phase F 에서 구현 예정 / Phase G 에서 WithdrawService* | 동일 |
| 318 | *Phase G + 30 일 후 hard delete (Phase 1 스케줄러)* | *Withdraw 후 30 일 후 hard delete* — Phase 표현 제거, 의미 명확 |
| 416 | *Phase F/G 에서 순차 구현* | *(향후)* 표기 |

### 검증

```bash
grep -rEn '초기에는|이전에는|예전에는|초기 구현|초기 설계에서는|초기 1주일간|2026 초반|범위 재조정' docs/  # 0건 (또는 의도적 보존만)
grep -rEn 'Phase [A-Z]\b' docs/ | grep -v 'planned\|향후'  # 0건 (planned/향후 표기 외)
```

---

## 7. S6 — symlink 일관성

### 노테이션 박스 (2 위치 추가)

**File: `docs/start/onboarding.md`** 진입부 + **`docs/start/cli-guide.md`** 진입부:

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

### 직접 `bash tools/...` 호출 → `<repo-name> <verb>` 통일

| File | 직접 호출 | factory wrapper |
|---|---|---|
| `dogfood-faq.md:165` | `bash tools/start-server.sh` | `<repo-name> local start` |
| `dogfood-faq.md:179` | `bash tools/verify-server.sh` | `<repo-name> prod server-test` |
| `dogfood-setup.md:295, 303, 334` | `bash tools/verify-{local,server}.sh` | `<repo-name> {local,prod} server-test` |
| `dogfood-faq.md:159` | `bash tools/init-server.sh` | (그대로 — clone 직후 1회, symlink 등록 *전*) |
| `dogfood-faq.md:171` | `bash tools/init-server.sh <owner>/<repo> --reinit` | (그대로 — symlink 등록 전) |
| `dogfood-faq.md:245` | `bash tools/init-server.sh <test-org>/<test-repo>` | (그대로 — symlink 등록 전) |
| `dogfood-setup.md:40, 201, 283` | `bash tools/init-server.sh <owner>/<repo>` | (그대로 — symlink 등록 전) |

### 그대로 유지 (low-level reference)

- `start/cli-guide.md:235-241` — 의도적 *low-level 직접 호출 표*
- `philosophy/adr-007:159, 162` — 코드 인용
- `production/setup/secret-chain-4stage.md:117` — CI 도구 인용
- `production/deploy/flyway-runbook.md:175` — 직접 호출 안내 (의도적)
- `production/setup/key-rotation.md` 의 5건 — `bash tools/dogfooding/setup.sh` 는 **1회성 운영 자동화 도구** (key rotation 시 멱등 secret 갱신). factory wrapper 에 추가 등록하지 *않음* (1회성 + 자주 안 쓰는 도구라 wrapper 노출 가치 낮음). **그대로 직접 호출 유지**.

### 검증

```bash
# 1. factory wrapper 의 1급 verb list 추출 (line 21-46 의 env-verb 표)
sed -n '/── env-verb 명령어/,/── 메타 레포/p' factory | grep -oE '\b(local|prod|all)?\s*[a-z][a-z-]+\b' | sort -u > /tmp/factory-verbs.txt

# 2. docs 의 <repo-name> <verb> 사용 추출
grep -rEoh '<repo-name>\s+(local|prod|all)?\s*[a-z][a-z-]+' docs/ | sed 's/<repo-name> //' | sort -u > /tmp/docs-verbs.txt

# 3. docs 에 있지만 wrapper 에 없는 verb (broken command) — 0 건이어야 함
comm -23 /tmp/docs-verbs.txt /tmp/factory-verbs.txt
```

---

## 8. S7 — 잘못된 plan stub 정정

**File: `~/.claude/plans/elegant-crafting-rain.md`**

본 사이클 진행 중 발견된 plan stub 의 잘못된 단정 — *마지막 사이클 (Cleanup)* 섹션의 표 정정:

| 항목 | 원래 stub | 정정 (이 spec 의 결론) |
|---|---|---|
| `tools/dogfooding/setup.sh + cleanup.sh` | *옛 도그푸딩 자동화. tools/init-server.sh 가 새 흐름. 폴더 제거.* | **폴더 유지**. dogfooding/{setup,cleanup}.sh = 운영 자동화 (GHA + Mac mini + GHCR), init-server.sh 와 기능 다름. docs 의 *옛 자동화* 라벨만 제거. |
| `legacy 호환` 명령 정리 (`cli-guide:28,39`, `onboarding:148`) | *factory all init / factory test 가 진짜 legacy 인지 검증. legacy 면 제거.* | **명령 유지**. `all init` / `local test` 모두 factory wrapper:21,31 의 1급 명령 = 현재 표준. *legacy* 라벨만 제거. |
| `PortOne v1 (legacy 호환)` | *v1/v2 코드 사용 현황 검증. v1 이 현재 표준 이면 legacy 라벨 제거.* | **라벨 유지**. PortOne v1 base URL = `https://api.iamport.kr` (옛 iamport 시절 외부 명세). PortOne 콘솔 자체가 v1 을 *legacy 호환* 으로 분류 = **외부 도구 시간 표현 (사용자 OK 분류)**. |
| `ConditionalOnExpression (legacy AND)` | *Spring Boot 외부 형식 vs 우리 코드 패턴 검증.* | **표 라벨 정정 + adr-034 의 *진화 기록* / Phase A/B 박스 정리** (S3 에서 처리). |

본 사이클 작업 후 plan stub 의 *마지막 사이클 (Cleanup)* 섹션을 *완료* 로 갱신. 추가 발견된 ADR 14곳 정리 항목도 plan stub 에 반영.

---

## 9. S8 — 사이클 종합 검증 + push

```bash
# 1. ci-test 5/5 PASS
bash tools/ci-test.sh

# 2. 잘못된 표현 grep 0건 (사이클 전체)
grep -rEn '옛 자동화|legacy 호환|legacy AND|legacy = 둘 다|진화 기록|Phase A.*Phase B|이전에는.*cleanup 사이클|deprecated.*ADR.*대체' docs/
grep -rEn 'AuthError\.EMAIL_DELIVERY_FAILED|ATH_006' core/ common/ docs/
grep -rEn '초기에는|예전에는|초기 구현|초기 설계에서는' docs/
# 모두 0건 (의도적 보존만 — 작업 시 명시)

# 3. 마지막 push (모든 사이클 끝, 1회만 — 사용자 메모리)
git push origin main
```

---

## 10. Risk + Edge cases

### Critical risk

| Risk | 완화 |
|---|---|
| **S4 Flyway squash 후 schema 불일치** | force-clear 환경 → 재시도. squash 전 후 `\d users` / `\d devices` 정확히 동일성 검증. |
| **S5 ADR 14곳 산문 재작성 시 결정 근거 손실** | 의도적 회고 (*acceptance log*) 는 별도 섹션으로 보존. 결정 근거 (대안 비교) 는 표현 형태만 변환. |
| **T6 PortOne v1 라벨 — 사용자 분류 OK 인데 정리 시도 시 외부 명세 손실** | spec 에 명시 — **유지**. plan stub 정정 (S7) 에서 명문화. |
| **S6 symlink 일관성 — `<repo-name>` placeholder 가 reader 혼란 유발** | 노테이션 박스 2 위치 (onboarding + cli-guide 진입부) 에 명시. *예: `sumtally`, `gymlog`* 형태로 의미 보강. |

### Edge cases

- **S2 ATH_006 javadoc 예시의 enum 교체 시** — `AuthError.INVALID_CREDENTIALS` 가 실제 존재하는지 검증 (작업 시 `AuthError.java` 의 enum constant list 확인 후 적절한 것 선택).
- **S5 의 ADR-005:87 *참조용 / 레거시*** — 코드 검증 (`grep core schema users sql`) 후 *레거시* 면 제거 / *현재 admin 계정용* 이면 의미 명확화.
- **S6 *파생 레포 이름* placeholder** — `<repo-name>` vs `${repo-name}` vs `[repo-name]` 표기 통일성 (작업 시 기존 docs 표기 컨벤션 따름).

---

## 11. Out-of-scope (별도 사이클)

본 사이클이 다루지 *않는* 향후 작업:

- 파생 레포 운영 호스트 (Mac mini) 배포 검증 — 사용자 직접
- 새 기능 추가 / 코드 리팩토링 — 별도 사이클
- ADR-031~035 의 일부 미완성 backlog 항목 — *Notification Preferences* / *Lite Mode UI* 의 detail 작업
- factory wrapper 에 dogfooding/setup.sh 등록 — symlink 일관성 강화 (S6 작업 결과에 따라 결정)

---

## 12. Success criteria

본 사이클 종료 시점:

- ✅ `grep` 으로 *우리 플젝 옛 흐름 변명* 표현 0건
- ✅ `grep` 으로 ATH_006 / AuthError.EMAIL_DELIVERY_FAILED 0건 (code + docs)
- ✅ Flyway 마이그레이션 9 → 6 파일, schema 동일성 검증 (squash 전 후 동일 컬럼 / 인덱스)
- ✅ `bash tools/ci-test.sh` 5/5 PASS
- ✅ `bash tools/docs-check/docs-contract-test.sh` 4/4 PASS
- ✅ `git push origin main` 1회 (모든 사이클 끝)
- ✅ plan stub (`~/.claude/plans/elegant-crafting-rain.md`) 의 잘못된 단정 정정
- ✅ symlink 일관성 — `<repo-name> <verb>` 표기 통일 + 노테이션 박스 2 위치

→ 본 사이클 종료 후 **template-spring 은 파생 레포 소유자에게 *우리 플젝의 옛 흐름 변명 0건* 의 깔끔한 시작점**.
