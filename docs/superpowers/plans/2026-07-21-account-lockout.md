# 로그인 실패 계정 잠금 (Account Lockout) 구현 플랜 — 초안

> **상태: 리뷰용 초안 (커밋 금지).** 스펙 MD 는 아직 없음 — 본 플랜이 정책 결정을 포함하며, 리뷰 확정 후 `docs/superpowers/specs/2026-07-21-account-lockout-design.md` 로 분리한다.
> **For agentic workers:** 각 Task 끝에 독립 테스트. backlog 근거: `docs/planned/backlog.md:45` (owasp A07.1), ADR-029 "안 다루는 범위" 1항 (`docs/philosophy/adr-029-password-policy.md:187`).

**Goal:** 이메일 로그인 비밀번호 N회 실패 시 계정 단위 잠금(N회/윈도우/잠금시간, 점증 backoff) — RateLimitFilter(IP·principal 단위 요청수 제한)가 못 막는 **계정 표적 brute-force** 를 DB 카운터로 차단.

**Architecture:** `users` 테이블에 카운터 3컬럼 추가(신규 마이그레이션, 기존 파일 불변). 잠금 판정·기록은 core-auth-impl 의 신규 `LoginLockoutService` 가 담당하고, 카운터 read/write 는 `UserPort` 신규 메서드로만 접근(포트/어댑터 유지, `TotpInfo`/`findTotpInfo` 전례 — `core/core-user-api/.../UserPort.java:135`). 실패 기록은 `REQUIRES_NEW` 로 커밋(로그인 실패 시 outer tx 가 rollback 되어도 카운터 보존 — RefreshTokenService 탈취 감지 revoke 전례, `AuthServiceImpl.java:28-30` javadoc).

**Tech Stack:** Spring Boot 멀티모듈(schema-per-app), Spring Data JPA + Postgres, Testcontainers, Flyway(local/test=AUTO, dev/prod=VALIDATE_ONLY + 수동 migrate).

## Global Constraints

- `ErrorInfo` enum 번호 재배치 금지 — `AuthError` 는 추가만. **ATH_006 은 역사적 결번**(현재 enum 에 없음, `AuthError.java:17-51`) — 결번 재사용 금지, 다음 번호는 **ATH_014**.
- 기존 마이그레이션 파일(V001~V025) 수정 금지 — dev/prod 는 VALIDATE_ONLY 라 checksum 변경 즉시 배포 실패. 컬럼 추가는 **신규 V027** 으로만.
- Mapper/Converter 클래스 신설 금지(ADR-016, r22) — `LockoutInfo` 는 core-user-api 의 record DTO (TotpInfo 와 동일 계층).
- cross-domain 은 Port 로만 — core-auth-impl 이 UserRepository 직접 접근 금지.
- `SchemaRoutingDataSource` 우회 금지 — REQUIRES_NEW 도 SlugContext(스레드로컬) 기반 라우팅을 그대로 탄다(RefreshTokenService 가 이미 동일 패턴으로 검증됨).
- 커밋은 Conventional Commits, Co-Authored-By 트레일러 금지. **단, 본 초안 자체는 커밋하지 않는다.**

---

## 실물 조사 요약 (설계 근거 — 전부 실측)

### 1) 로그인 경로별 잠금 적용 여부

| 경로 | 실물 | 비밀번호 검증 | 잠금 대상 |
|---|---|---|---|
| 이메일 1단계 | `EmailAuthService.signIn` (`core-auth-impl/.../service/EmailAuthService.java:86-113`) — 이메일 미존재(89)/소셜전용(96)/비번불일치(100) 모두 `ATH_001` | O (`passwordHasher.verify`, line 100) | **O (핵심)** |
| 2FA 2단계 | `TwoFactorService.loginWith2fa` (`core-auth-impl/.../totp/TwoFactorService.java:134-155`) — TOTP/backup 실패 시 `ATH_007` (145-147) | 비번은 1단계에서 이미 통과, 여기선 TOTP | **O (동일 카운터)** — 비번 유출 공격자의 6자리 brute-force 차단. `TOTP_LOGIN` 은 RateLimitFilter strict 목록에도 빠져 있어(아래) 현재 60rpm 만 적용됨 |
| 소셜 4종 | `AppleSignInService`/`GoogleSignInService`/`KakaoSignInService`/`NaverSignInService` (`AuthServiceImpl.java:180-197` 에서 위임) | **X** — 4개 서비스 모두 `PasswordHasher` 미참조(grep 0건). provider 토큰 검증 방식 | **제외** — 시도할 비밀번호 자체가 없음. brute-force 표면은 provider 측 |
| phone 점유인증 | `AuthServiceImpl.issueForVerifiedPhone` (300-323) | X — 자체 OTP(V015 테이블) | 제외 |
| changePassword / TOTP disable | `AuthServiceImpl.changePassword:237-250`, `TwoFactorService.disable:116-131` — currentPassword 검증 | O | **제외(1차)** — access token 필요(로그인 후) + `PASSWORD_CHANGE` 는 strict 10rpm 대상. 리뷰 시 포함 여부 재논의 |

2FA 분기 실물: `AuthServiceImpl.signInWithEmail:163-177` — 1단계 통과 후 `totp.enabled()` 면 `AuthResponse.requires2fa(pendingToken)` 반환. 잠금 체크는 1단계 진입부에 넣으면 2FA 사용자도 자동 커버되고, 2단계 실패 기록만 별도 추가하면 된다.

### 2) users 테이블 (마이그레이션 실물 대조)

- 운영 진실: `tools/new-app/new-app.sh:588` heredoc `V001__init_users.sql` — id/email/password_hash/display_name/nickname/email_verified/is_premium/role/created_at/updated_at/deleted_at. **잠금 관련 컬럼 없음.**
- 2FA 전례: `new-app.sh:823` `V013__add_totp_to_users.sql` 이 `ALTER TABLE users ADD COLUMN totp_*` 3개 추가 — **"공통 컬럼 추가 = 신규 ALTER 마이그레이션 + 테스트 fixture 인라인 반영"** 패턴 확립.
- 테스트 fixture 는 6개 파일이 users 를 정의(V013 내용이 V001 에 인라인 병합돼 있음 — `core/core-auth-impl/src/test/resources/db/migration/core/V001__init_users.sql:13-16`): core-user-impl, core-auth-impl, core-audit-impl, core-device-impl, core-billing-impl (`core/V001__init_users.sql`) + core-admin-impl (`apps/V001__init_users.sql`). `tools/schema-check/users-schema-drift.sh` 가 fixture↔new-app.sh 드리프트를 가드.
- 마이그레이션 번호: 공통은 V001~V025, **"도메인 테이블은 V027 부터"** (`new-app.sh:1159`) — 신규 공통 마이그레이션은 **V027** 을 쓰고 안내 문구를 V027 로 갱신해야 함. 현재 파생 앱 레포 없음(구 서버 레포 폐기, bluepig-backend 미생성)이라 번호 충돌 리스크는 지금이 최소.

### 3) RateLimitFilter 와의 관계 (역할 분리)

- `common-web/.../ratelimit/RateLimitFilter.java` — 키 `{appSlug}:{principal}:{rpm}`, 미인증이면 `ip:{CF-Connecting-IP}` (127-146). strict 10rpm / default 60rpm (`RateLimitProperties.java:22-23`). 초과 시 429 + `Retry-After` + `CMN_429` (94-108).
- 즉 **IP·요청수 축**만 방어. 분산 IP(봇넷)로 한 계정을 치는 low-and-slow 공격은 통과 → **계정 축 카운터(본 플랜)가 보완**. 둘은 독립 레이어로 공존, 통합하지 않는다.
- 부수 발견: `SENSITIVE_SUFFIXES`(48-58)에 `KAKAO`/`NAVER`/`TOTP_LOGIN` 미포함 — kakao/naver 소셜과 2FA 2단계가 default 60rpm 만 적용. Task 6 에서 `TOTP_LOGIN` 추가(카카오/네이버는 리뷰 항목으로만 기재).

### 4) ADR-029 관련 서술

`docs/philosophy/adr-029-password-policy.md:185-191` "안 다루는 범위 (다음 사이클)" 1항: *"로그인 실패 카운터 — N회 실패 시 일시 lock (brute-force 방지). 별도 mechanism (Redis·DB) 가 필요"*. 본 플랜이 그 사이클. 저장소는 **DB 컬럼** 채택 — 근거: 1인 운영 제약(ADR-007)상 Redis 신규 인프라 기각, in-memory(bucket4j Caffeine 방식)는 재시작 시 카운터 증발 + 다중 인스턴스(blue-green) 간 불일치. property override 패턴(`app.security.password.*`)을 그대로 계승해 `app.security.lockout.*` 노출.

---

## 정책 결정 (리뷰 포인트)

### ① 잠금 정책 (property 로 조정 가능)

| property (`app.security.lockout.*`) | default | 근거 |
|---|---|---|
| `enabled` | true | 보안 baseline. 파생 레포 opt-out 가능 |
| `max-attempts` | **5** | 업계 관행(OWASP A07 권고 범위 3~10 중 중간값). strict 10rpm 과 결합 시 단일 IP 는 1분 내 잠금 도달 |
| `window` | **15m** | `last_failed_at` 이 window 보다 오래되면 카운터 1부터 재시작(정상 유저 오입력 누적 방지) |
| `base-duration` | **15m** | 잠금 기본 시간. 5회 임계와 함께 업계 관행 기준값 |
| 점증 backoff | 카운터 무리셋 누적으로 자동 점증 | 잠금 해제 후에도 성공 전까지 `failed_attempts` 유지 → 10회=2단계, 15회=3단계… `duration = base × 2^(단계-1)`, **cap 24h**. 추가 컬럼 불필요 |

### ② 해제 플로우

1. **시간 경과 자동 해제** — `locked_until <= now()` 면 통과. 별도 스케줄러/컬럼 클리어 불필요(판정식으로 해결).
2. **비밀번호 재설정 성공 시 즉시 해제** — `PasswordResetService.confirmReset` (`PasswordResetService.java:134-160`)의 `updatePassword` 직후 `userPort.resetLockout(userId)` 호출. 근거: 재설정 = 이메일 소유 증명 = 본인 확인 완료. (요청만으로는 해제 금지 — 공격자가 잠금 우회에 악용.)
3. **로그인 성공 시 카운터 리셋** — `failed_attempts > 0` 일 때만 write(로그인당 불필요 UPDATE 방지).
4. 운영자 수동 해제는 admin 모듈 후속 사이클(범위 외, Self-Review 참조).

### ③ 스키마 변경 (기존 파일 수정 금지)

신규 `V027__add_login_lockout_to_users.sql` (new-app.sh heredoc 추가):

```sql
-- 로그인 실패 계정 잠금 (brute-force 방어, OWASP A07). ADR-029 후속.
ALTER TABLE users ADD COLUMN failed_attempts INT NOT NULL DEFAULT 0;   -- 연속 실패 수 (성공/재설정 시 0)
ALTER TABLE users ADD COLUMN last_failed_at  TIMESTAMPTZ;              -- 윈도우 판정 기준
ALTER TABLE users ADD COLUMN locked_until    TIMESTAMPTZ;              -- NULL 또는 과거 = 미잠금
```

- `last_failed_at` 은 요구된 2컬럼(failed_attempts·locked_until) 외 추가분 — **윈도우(15m) 판정에 필수**라 포함. 인덱스 불필요(항상 PK/email 로 단건 조회).
- 함께 갱신: `new-app.sh:1086` 생성 개수 메시지, `:1159` "도메인 테이블은 V027 부터" → **V027 부터**.
- 테스트 fixture 6개에 컬럼 인라인 추가(V013 totp 전례). `users-schema-drift.sh` 에 신규 컬럼 가드 추가는 옵션(리뷰 항목).
- 기가동 dev/prod 앱은 VALIDATE_ONLY 라 `<repo> dev/prod migrate` 수동 적용 필요(runbook 절차 그대로).

### ④ 에러코드 — ATH_014, HTTP 429 (423 기각)

```java
/** 로그인 실패 누적으로 계정 일시 잠금. details.retryAfterSeconds 로 남은 시간 전달. */
ACCOUNT_LOCKED(429, "ATH_014", "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요"),
```

- **429 채택 근거**: (a) flutter 계약이 이미 429+`Retry-After` 처리를 학습함(`docs/api-and-functional/api/flutter-backend-integration.md:407` — `CMN_429`). (b) 423 Locked 는 WebDAV(RFC 4918) 의미론이라 중간 프록시/클라이언트 라이브러리 취급이 비표준. (c) **계정 열거 방지**: 429 는 IP rate-limit(CMN_429)과 표면상 동일 부류라 "계정 존재+잠김"을 덜 단정하게 만든다. 메시지도 "계정이 잠겼습니다"가 아닌 시도 과다 문구.
- **잔여 열거 누출 수용 근거**: 코드가 ATH_001 과 달라지는 것 자체는 존재 신호가 맞다. 그러나 (a) 가입 시 `USR_002`(409, `UserError.java:18`)로 이메일 존재가 이미 노출되는 표면이 있고, (b) 완전 은닉 대안(잠금 중에도 ATH_001 유지)은 정상 유저가 올바른 비번으로도 실패 원인을 알 수 없어 지원 비용이 커진다. OWASP 도 잠금 안내 자체는 허용.
- **잠금 중에는 비밀번호 검증 자체를 skip** — 잠금 상태에서 비번 정오답 확인(오라클) + bcrypt 타이밍 차이를 차단. 판정 순서: 계정 조회 → 잠금 체크(429) → 비번 검증(401).
- 5회째 실패 응답은 401 ATH_001 유지(그 시도 자체는 비번 오류), **6회째부터 429** — "정확히 몇 회에 잠겼는지" 신호를 줄이는 단순 계약.
- `Retry-After` 헤더: `GlobalExceptionHandler` 에 429 AuthException 분기 추가 필요 — 구현 시 핸들러 실물 확인(본 조사 범위에선 미확인, 플랜상 열린 항목). body 의 `details.retryAfterSeconds` 는 확정.

### ⑤ 소셜 로그인 제외 근거 (확정)

Apple/Google/Kakao/Naver 4개 서비스 모두 `PasswordHasher` 참조 0건(grep 실측) — 검증 대상이 provider 발급 토큰(id_token/access_token)이라 "비밀번호 실패 횟수" 개념이 성립하지 않음. 소셜 전용 유저(password_hash=NULL)의 이메일 로그인 시도는 이미 `EmailAuthService.signIn:96-98` 에서 ATH_001 — 이 경로는 비번 검증이 없으므로 **카운터 미증가**(존재하지 않는 비밀번호에 대한 잠금은 DoS 벡터만 만든다. 공격자가 소셜 유저 계정을 5회 시도로 영구 잠그는 부작용 방지).

### ⑥ 테스트 전략 — 요약 (상세는 Task Steps)

- 단위(신규 `LoginLockoutServiceTest`): 윈도우 리셋 / 임계 도달 잠금 / 점증 duration(5→15m, 10→30m, cap 24h) / disabled 시 no-op.
- 서비스(기존 `AuthServiceImplContractTest` 패턴 + Testcontainers): 5회 실패→6회째 429 / 잠금 중 정답 비번도 429 / 성공 시 리셋 / reset confirm 즉시 해제 / 2FA 2단계 실패 누적 / 소셜 유저 시도 미증가 / rollback 후에도 카운터 잔존(REQUIRES_NEW 검증 — 핵심).
- 리포지토리(core-user-impl IT): 원자적 UPDATE(윈도우 CASE) 동시 2요청 undercount 없음.
- 가드: `./gradlew :bootstrap:test`(ArchUnit r1~r22), `users-schema-drift.sh`, `gen-snapshot.sh` 재생성 diff.

### ⑦ flutter 영향 — api-contract 갱신 필요: **예**

- `docs/api-and-functional/api/flutter-backend-integration.md` — 에러코드 표(330-335)와 에러 매트릭스(394-407)에 ATH_014 행 추가: *"429 + ATH_014 → details.retryAfterSeconds 로 카운트다운 안내, 재시도 버튼 비활성"*. signin 흐름(64) 자체는 요청/응답 스키마 불변 — **성공 계약 변경 없음, 실패 계약만 추가**.
- `docs/api-contract/contract-snapshot.json` — ATH 코드 목록(68-77 부근)에 ATH_014 추가: `tools/contract-snapshot/gen-snapshot.sh` 재생성으로 반영(수동 편집 금지).
- 클라이언트 코드 변경은 선택적(미처리 시 기존 429 공통 처리로 degrade — 깨지지 않음). docs push 시 sync-docs.yml 이 docs-template-spring 자동 반영.

---

## Task 1: 스키마 — V027 마이그레이션 + fixture 6개

**Files:**
- Modify: `tools/new-app/new-app.sh` (V027 heredoc 추가, :1086 개수 메시지, :1159 "V027 부터"→"V027 부터")
- Modify: fixture 6개 — `core/core-{user,auth,audit,device,billing}-impl/src/test/resources/db/migration/core/V001__init_users.sql`, `core/core-admin-impl/src/test/resources/db/migration/apps/V001__init_users.sql` (컬럼 3개 인라인)

- [ ] **Step 1:** V027 heredoc + 문구 갱신. 기존 V001~V025 heredoc 은 **바이트 불변** 확인 (`git diff` 로 ALTER 블록 외 변경 0).
- [ ] **Step 2:** fixture 6개에 컬럼 인라인 추가 → `tools/schema-check/users-schema-drift.sh` PASS.
- [ ] **Step 3:** 커밋 — `feat(user): users 로그인 잠금 컬럼 V027 마이그레이션 추가`

## Task 2: core-user — UserPort 잠금 메서드 + 원자적 카운터

**Files:**
- Create: `core/core-user-api/src/main/java/com/factory/core/user/api/dto/LockoutInfo.java`
- Modify: `core/core-user-api/.../UserPort.java`, `core/core-user-impl/.../entity/User.java`, `core/core-user-impl/.../repository/UserRepository.java`, `core/core-user-impl/.../UserServiceImpl.java`
- Test: `core/core-user-impl/src/test/.../` (기존 IT 패턴에 잠금 케이스 추가)

**Interfaces (Produces):**
- `record LockoutInfo(int failedAttempts, java.time.Instant lastFailedAt, java.time.Instant lockedUntil)`
- `LockoutInfo findLockoutInfo(long userId)` / `int recordLoginFailure(long userId, Instant windowStart)` (원자적 UPDATE+RETURNING — 윈도우 밖이면 1로 리셋, 아니면 +1) / `void applyLock(long userId, Instant until)` / `void resetLockout(long userId)`

- [ ] **Step 1: 실패 테스트** — 윈도우 내 증가/윈도우 밖 1 리셋/동시 2호출 합산 정확(원자성)/reset 후 0.
- [ ] **Step 2: 실패 확인** — `./gradlew :core:core-user-impl:test`.
- [ ] **Step 3: 구현** — native `UPDATE ... RETURNING failed_attempts` (Postgres). 정책 값(N/duration)은 **이 계층에 두지 않는다**(mechanics only, `consumeBackupCode` CAS 전례).
- [ ] **Step 4: 통과 + 커밋** — `feat(user): UserPort 로그인 실패 카운터·잠금 메서드 추가`

## Task 3: core-auth — LoginLockoutService + signin/2FA/reset 통합 + ATH_014

**Files:**
- Create: `core/core-auth-impl/.../service/LoginLockoutService.java`, `LockoutProperties.java` (`app.security.lockout.*`, `@DefaultValue`)
- Modify: `core/core-auth-api/.../exception/AuthError.java` (ATH_014 추가만), `EmailAuthService.java` (`signIn:93` 이후 잠금 체크, `:100` 실패 시 기록), `totp/TwoFactorService.java` (`loginWith2fa:145` 실패 시 기록 + 진입 잠금 체크), `PasswordResetService.java` (`confirmReset:154` 이후 `resetLockout`), `AuthAutoConfiguration.java` (빈 배선)

**Interfaces:**
- `void assertNotLocked(long userId)` → 잠금 시 `AuthException(ACCOUNT_LOCKED, Map.of("retryAfterSeconds", …))`
- `void onFailure(long userId)` — **`@Transactional(REQUIRES_NEW)`**, 임계 도달 시 `applyLock(now + base × 2^(attempts/max - 1), cap 24h)`
- `void onSuccess(long userId)` — attempts>0 일 때만 reset

- [ ] **Step 1: 실패 테스트** — ⑥ 서비스 케이스 전부(REQUIRES_NEW rollback 생존 케이스 필수 포함).
- [ ] **Step 2: 실패 확인** — `./gradlew :core:core-auth-impl:test`.
- [ ] **Step 3: 구현** — 판정 순서(조회→잠금→비번), 소셜전용 유저(passwordHash null) 경로는 기록 없이 기존 ATH_001 유지, `enabled=false` 면 전 메서드 no-op.
- [ ] **Step 4: 통과 + ArchUnit** — `./gradlew :core:core-auth-impl:test :bootstrap:test`.
- [ ] **Step 5: 커밋** — `feat(auth): 로그인 실패 계정 잠금(ATH_014, 5회/15분/점증 backoff)`

## Task 4: GlobalExceptionHandler Retry-After (구현 시 실물 확인)

- [ ] 429 AuthException 에 `Retry-After` 헤더 부여 가능 여부 핸들러 실물 확인 → 가능하면 추가, 불가하면 body `details.retryAfterSeconds` 단독으로 확정하고 본 플랜 ④ 갱신.
- [ ] 커밋 — `feat(common): 429 응답 Retry-After 헤더 (해당 시)`

## Task 5: 계약 문서 갱신

**Files:** `docs/api-and-functional/api/flutter-backend-integration.md` (에러 표 2곳), `docs/api-contract/contract-snapshot.json` (`tools/contract-snapshot/gen-snapshot.sh` 재생성), `docs/philosophy/adr-029-password-policy.md` "안 다루는 범위" 1항에 본 사이클 완료 표기(또는 신규 ADR — 리뷰 결정), `docs/planned/backlog.md:45` 체크.

- [ ] gen-snapshot 재생성 diff 가 ATH_014 추가뿐인지 확인. 커밋 — `docs(auth): 계정 잠금 ATH_014 계약 반영`

## Task 6: RateLimitFilter TOTP_LOGIN strict 편입 (소규모, 리뷰 승인 시)

- [ ] `RateLimitFilter.SENSITIVE_SUFFIXES`(48-58)에 `ApiEndpoints.Auth.TOTP_LOGIN` 추가(6자리 brute-force 60rpm→10rpm). KAKAO/NAVER 편입은 리뷰 항목으로만 남김(토큰 검증이라 성격 다름). `RateLimitFilterTest` 케이스 추가. 커밋 — `fix(common): 2fa login 엔드포인트 strict rate limit 편입`

## Self-Review 체크

- 요구 7항 커버: ①정책(테이블)=②해제(3경로)=③스키마(V027+fixture6)=④ATH_014/429 결정+열거 방지=⑤소셜 제외 근거(grep 실측)=⑥테스트=⑦flutter 계약 — 전부 섹션/Task 존재.
- 코드 인용 전수 실물 라인 대조 완료. 미확인 항목은 2건뿐이며 명시적으로 표기: GlobalExceptionHandler 헤더 처리(Task 4), drift guard 확장(옵션).
- 열린 리뷰 질문: (a) V027 번호 선점 vs "도메인 V027부터" 안내 변경 수용 여부 (b) changePassword/2FA disable 포함 여부 (c) 운영자 수동 해제 admin API 를 본 사이클에 넣을지 (d) 보안 이벤트 로깅(backlog:46)과 묶을지 (e) verify-email 표적 DoS 완화 — 5회 도달 시 즉시 폐기(`markUsed`) 대신 쿨다운, 또는 email 단위 추가 throttle. 계정 잠금과 동일 브루트포스 축이라 이 사이클에서 함께 검토 (근거: `docs/api-and-functional/functional/email-verification.md` verify-email "보안 경계" — 표적 DoS 는 수용된 트레이드오프로 잔존).
