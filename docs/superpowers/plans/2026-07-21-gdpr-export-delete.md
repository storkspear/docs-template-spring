# GDPR / 개인정보 export·delete 대응 플랜 (초안 — 리뷰용)

> **상태: DRAFT.** 사용자 리뷰 전. 커밋 금지. backlog 항목: `docs/planned/backlog.md:57` "[Data] GDPR / 개인정보 export/delete 요청 대응 절차".
>
> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 또는 superpowers:executing-plans 로 태스크 단위 구현. 스텝은 `- [ ]` 체크박스.

**Goal:** 1인 운영자가 GDPR/개인정보보호법상 열람(export)·삭제(erasure) 요청을 **admin 콘솔에서 절차적으로** 처리할 수 있게 한다 — ①콘솔 export API + 버튼, ②soft-delete → 30일 유예 → 완전삭제/익명화 배치. 셀프서비스(앱 내 export)는 후속 단계 스케치만.

**Architecture:** 운영자 절차형 우선. export 는 `core-admin-impl` 의 기존 cross-domain JDBC 조회 관행(`AdminUsersService`)을 확장한 JSON 번들 1개 API. 완전삭제는 기존 3종 purge 스케줄러 관행(`AttachmentPurgeScheduler`/`AuditRetentionScheduler`/`AnalyticsRetentionScheduler`)과 동일한 slug 순회 + `SlugContext` 배치. 결제·감사 원장은 법정 보존 의무(GDPR Art.17(3)(b) 예외)로 삭제 대신 **익명화**, 나머지는 hard delete. 스키마 마이그레이션 **0건** 으로 설계(기존 컬럼만 사용 — 파생 앱 전파 비용 없음).

**Tech Stack:** Spring Boot 멀티모듈 + JdbcTemplate + Flyway + Testcontainers IT. 프론트 React 19 + Ant Design 5 (`template-react-admin`).

## 결정 사항 (2026-07-21 사용자 확정)

- **P4 셀프서비스 export 폐기** — 소규모 운영에서 이메일 절차로 충분, UI 유지비 불필요. 아래 P4 스케치는 기록용으로만 남김 (구현 금지).
- **앱 내 계정 삭제는 기존 완비 확인** — flutter `settings_screen.dart` 탈퇴 UI → `POST /auth/withdraw` → 서버 soft-delete. Apple 5.1.1 요건 충족. 본 plan 은 그 뒤(30일 유예 후 익명화 배치)만 추가.
- **본인 확인 표준 플로우 (runbook 에 이대로 수록)**:
  1. 요청 접수 — 지원 이메일로만 (앱 문의 채널 포함 시 동일 절차)
  2. 1차 — 발신 주소가 계정 가입 이메일과 일치하는지 확인
  3. 2차 (항상 수행) — 가입 이메일로 6자리 확인 코드 발송 → 요청자가 코드 회신 → 대조. 발신 주소 위조 가능성 차단
  4. 예외 — 가입 이메일 접근 불가 주장 시: 계정만 아는 정보 대조(가입 시기·최근 결제 금액 일부·소셜 로그인 제공자). 불충분하면 거절 (과잉 제공보다 안전)
  5. 기록 — 요청일·확인 방법·처리일·전달 수단을 처리 대장에 기록 (30일 기한 관리)

## Global Constraints

- Mapper/Converter 클래스 신설 금지 — Entity `toXxx()` / record DTO 직접 조립 (ADR-016, ArchUnit r22).
- Controller→Service→Repository. cross-domain 은 Port — 단, `core-admin-impl` 은 콘솔 특성상 raw JDBC cross-domain 조회 선례 있음(`AdminUsersService` 가 users/devices/subscriptions/payment_history 직접 SELECT). 본 플랜은 이 선례를 따르되 **스토리지 낙수가 필요한 첨부만 `AttachmentPort` 경유**.
- `ErrorInfo`/`AdminError` enum 기존 번호 재배치 금지, 추가만 — 다음 번호 `ADMIN_024` (현재 마지막 `ADMIN_023`).
- `SchemaRoutingDataSource` 우회 금지 — 배치는 `SlugContext.set(slug)`/`clear()` 로 라우팅.
- `com.factory.*` 패키지 변경 금지. spotless(google-java-format 4-space) 적용 후 커밋.
- 커밋 Conventional Commits(`type(scope): subject`), Co-Authored-By 트레일러 금지. scope: admin/user/auth/docs 등.
- 프론트 변경은 `template-react-admin` 에서 하고 사이클 끝에 `rsync -a --delete src/ ../admin-console-v2/src/` 전파. push 는 사이클 누적 후 마지막 1회.
- 권한 추가(`PERM_USERS_WRITE`)는 재로그인 시 반영(JWT claim 발급 시점 고정).
- **법적 근거 문구는 초안 — 시행 전 법무 검토 필요** (아래 §1.3 근거 열 참조).

---

## 0. 조사 확정 — 사용자 연관 데이터 전수 맵 (실측)

### 0.1 원천

per-app 스키마의 canonical 마이그레이션은 `tools/new-app/new-app.sh` Step 6 에 V001~V025 로 embed 되어 있다(테이블 24개 + ALTER 3건). 아래 표는 그 SQL 전문 + 각 도메인 엔티티 코드에서 **실측**한 것이다. admin 스키마(`core/core-admin-impl/src/main/resources/db/migration/admin/` V001~V003: `admin_users`·`role_permissions`)는 콘솔 계정이라 **앱 사용자 GDPR 범위 밖** (별도 절차, 본 플랜 non-goal).

### 0.2 전수 표 — user 연결 26개 지점

`user_id ... REFERENCES users(id)` 명시 FK **10곳**, FK 없는 논리 참조 **9곳**, 간접(FK 체인) **3곳**, 사용자 무관 **4곳**.

| # | 테이블 (마이그레이션) | 사용자 연결 컬럼 | FK | PII/민감 필드 | export | erasure 처리 |
|---|---|---|---|---|---|---|
| 1 | `users` (V001+V013) | `id` | — | email, password_hash, display_name, nickname, totp_secret, totp_backup_codes | O | **익명화** (row 유지 — #8·#9 의 NOT NULL FK 가 걸려 DELETE 불가) |
| 2 | `auth_social_identities` (V002) | `user_id` NOT NULL | O | provider_id (소셜 고유 ID) | O (provider 목록만) | hard delete |
| 3 | `auth_refresh_tokens` (V003) | `user_id` NOT NULL | O | token_hash | X | hard delete |
| 4 | `auth_email_verification_tokens` (V004) | `user_id` NOT NULL | O | token_hash | X | hard delete |
| 5 | `auth_password_reset_tokens` (V005) | `user_id` NOT NULL | O | token_hash | X | hard delete |
| 6 | `devices` (V006) | `user_id` NOT NULL | O | push_token, device_name | O | hard delete |
| 7 | `subscription_plans` (V008) | — | — | 없음 | — | 무관 |
| 8 | `payment_history` (V009, V022) | `user_id` NOT NULL | O | external_id, **raw_response JSONB**(PG 원문 — 카드/구매자 정보 가능), **customer_uid**(PortOne billing key) | O | **익명화** — `raw_response=NULL, customer_uid=NULL`, 금액/상태/external_id 는 법정 보존 |
| 9 | `subscriptions` (V009) | `user_id` NOT NULL | O | cancel_reason | O | 보존 (결제 원장 체인; 식별은 #1 익명화로 절단) |
| 10 | `payment_webhook_events` (V010) | 없음 (payload 간접) | — | payload JSONB 에 PII 가능 | X | 보존 — open question §OQ-3 |
| 11 | `subscription_renewals` (V011) | `subscription_id` (간접) | O | error_message | X | 보존 (PII 직접 없음) |
| 12 | `audit_logs` (V012) | `actor_user_id`(콘솔 계정), `resource_id` 간접 | **X** | actor_email, ip_address, details JSONB | X | **보존** — ADR-028 보존정책(hot 90d→archive 365d purge)에 위임. actor 는 admin 계정이라 앱 사용자 삭제와 무관 |
| 13 | `users` TOTP (V013) | (#1 에 포함) | — | totp_secret/backup_codes | X | #1 익명화에 포함 |
| 14 | `user_notification_settings` (V014) | `user_id` NOT NULL | O | 없음 (설정값) | O | hard delete |
| 15 | `auth_phone_verification_codes` (V015) | 없음 — `phone_e164` 로만 | — | **phone_e164** | X | 만료 단명 데이터. 번호를 아는 경우(provider='phone' identity)만 hard delete |
| 16 | `auth_email_verification_codes` (V016) | 없음 — `email` 로만 | — | email | X | email 매칭 hard delete |
| 17 | `user_activity_days` (V017) | `user_id` PK 일부, NOT NULL | O | 활동일 (행태정보) | O | hard delete |
| 18 | `attachment_file` (V018) | `uploaded_by`, `deleted_by`, `associated_type='USER'`+`associated_id` | **X** | original_filename, **uploaded_ip, user_agent** + 스토리지 오브젝트 실체 | O (메타만) | **soft-delete 전환** → 기존 `AttachmentPurgeScheduler` 가 스토리지+row 삭제 (§1.4 낙수) |
| 19 | `user_read_history` (V019) | `viewed_user_id`, `admin_user_id`(콘솔) | **X** | admin_email, ip | X | **보존** — PII 열람 책임추적 기록. 대상 식별은 #1 익명화로 절단 |
| 20 | `message_send_history` (V020) | `sender_admin_id`(콘솔), **`target_ref`(유저 id/email 가능)** | **X** | target_ref, body_preview | X | 보존 — `target_ref` 의 email 익명화는 open question §OQ-2 |
| 21 | `audit_logs_archive` (V021) | `actor_user_id`(콘솔) | **X** | actor_email, ip | X | 보존 (#12 와 동일 — 365d 후 기존 스케줄러가 purge) |
| 22 | `payment_refunds` (V023) | `payment_id` (간접) | O | operator(관리자 email) | O (환불 이력) | 보존 (결제 원장) |
| 23 | `posts` (V024) | `author_user_id` nullable | O | **author_nickname 스냅샷**, title/body(내용 PII 가능) | O | **익명화** — `author_nickname=NULL`. 본문 일괄 삭제 여부는 §OQ-1 |
| 24 | `analytics_events` (V025) | `user_id` nullable | **X** | 행태정보 (properties 는 메타데이터만 — 개발 방침) | X | `user_id=NULL` 화 (원본은 어차피 `AnalyticsRetentionScheduler` 가 단기 purge) |
| 25 | `analytics_daily` (V025) | — (집계 수치만) | — | 없음 | — | 무관 |
| 26 | `audit_logs`/`archive`·`user_read_history`·`message_send_history` 의 admin 계정 컬럼 | `actor_user_id`·`admin_user_id`·`sender_admin_id` | — | admin_email 스냅샷 | — | 무관 (콘솔 계정 절차는 non-goal) |

> **파생 앱 자체 테이블**(V026+ 로 앱이 추가하는 도메인)은 이 표 밖 — 확장 포인트가 필요하다. §OQ-4.

### 0.3 현재 삭제 시맨틱 (실측)

- `UserPort.softDelete(userId)` (`core/core-user-api/.../UserPort.java:110`) = `deleted_at = now()` **만** 세팅. PII 전부 잔존 (`User.softDelete()` — `core/core-user-impl/.../entity/User.java:124`).
- `WithdrawService.withdraw()` (`core/core-auth-impl/.../WithdrawService.java`) = soft-delete + 전체 refresh token revoke. 코드 주석에 **"30일 후 hard delete 스케줄러 — Phase 1"** NOTE 실존(55행) — 본 플랜 P3 가 그 이행이다.
- `uk_users_email_active` 는 `WHERE deleted_at IS NULL` 부분 인덱스 — 삭제된 row 의 email 익명화가 유니크 제약과 충돌하지 않음(실측).

### 0.4 기존 purge 스케줄러 관행 (실측 — 신규 배치가 따를 패턴)

| 스케줄러 | cron 기본 | 활성 스위치 | 패턴 |
|---|---|---|---|
| `AttachmentPurgeScheduler` (core-attachment-impl) | 04:00 | `app.attachment.purge.enabled` | `<slug>DataSource` Bean 명 규약에서 slug 추출 → 순회하며 `SlugContext.set` → `AttachmentPort.purgeExpired(slug, now)` → 슬러그 실패 isolate |
| `AuditRetentionScheduler` (core-audit-impl) | 04:30 | `app.audit.retention.enabled` | hot 90d → archive 이동, archive 365d 후 purge (ADR-028) |
| `AnalyticsRetentionScheduler` (core-analytics-impl) | — | 동일 관행 | 원본 purge + daily 롤업 |

`AttachmentPort.purgeExpired` 구현(`AttachmentServiceImpl.java:196`)은 `status=DELETED AND purge_at<=now` 대상의 **스토리지 오브젝트(`StoragePort.deleteObject`, 멱등) + DB row** 를 함께 삭제한다 — §1.4 낙수의 근거.

---

## 1. 설계 결정 (운영자 절차형 우선)

### 1.1 Export — `GET /api/admin/apps/{slug}/users/{userId}/export`

- **권한: `PERM_USERS_UNMASK`** — export 는 전 PII 원본 노출이므로 unmask 권한으로 게이팅. `SecurityConfig` 에서 refund 패턴 선례(payments 패턴보다 **앞에** 좁은 matcher — `SecurityConfig.java:107-112`)와 동일 기법으로 `APP_USERS_EXPORT_PATTERN` 을 `APP_USERS_PATTERN`(=`PERM_USERS_READ`) 매처보다 위에 배치.
- **응답: JSON 번들 1개** (`ApiResponse<AdminUserExportResponse>`) — §0.2 표의 export=O 항목 전부: user 원본 + socialIdentities(provider 목록) + devices + subscriptions + payments(+refunds) + notificationSettings + activityDays + posts + attachments 메타. 파일 실체는 미포함(메타의 storage_key 로 콘솔 파일 화면에서 개별 다운로드).
- **열람 기록**: `UserReadHistoryRepository.record(...)` 를 `resource_type='EXPORT'` 로 기록 (`reveal` 과 동일 관행 — `AdminUsersService.revealUser` 선례. 컬럼 `VARCHAR(20)` 이라 마이그레이션 불필요).
- **감사**: `@Audited(value = "admin.user.export", resourceType = "User")` — `AuditAspect` 가 audit_logs 자동 기록.

### 1.2 Delete — 2단계: soft-delete → 유예 30일 → erasure 배치

1. **접수 시(운영자)**: 콘솔 `DELETE /api/admin/apps/{slug}/users/{userId}` → `WithdrawService` 와 동일 시맨틱(soft-delete + refresh token 전체 revoke)을 admin 경로로 노출. 신규 권한 `PERM_USERS_WRITE`.
2. **30일 경과 후(배치)**: `UserErasureScheduler`(신규, §0.4 패턴) 가 `deleted_at <= now() - 30일` 이고 아직 익명화 안 된 사용자를 도메인별 처리 표(§1.3)대로 완전삭제/익명화.
   - **users.purge_at 컬럼 추가 안 함** — `deleted_at + interval` 계산으로 충분, 마이그레이션 0건 유지. 유예기간은 `app.user.erasure.grace-days:30` 프로퍼티.
   - **멱등 마커** = 익명화 email 패턴(`deleted-{id}@erased.invalid`). 재실행 시 `email NOT LIKE 'deleted-%@erased.invalid'` 조건으로 스킵.
   - **가드**: `status='ACTIVE'` 구독 잔존 시 해당 사용자 스킵 + WARN 로그(운영자 판단으로 구독 정리 후 다음 sweep 에서 처리).
3. **즉시 삭제 옵션 없음(P3 범위)** — 유예 없는 즉시 erasure 가 필요하면 콘솔에서 soft-delete 후 배치를 기다리는 것이 기본. (grace-days=0 설정으로 사실상 즉시화 가능.)

### 1.3 도메인별 처리 표 — 완전삭제 vs 익명화 (법정 보존 근거)

| 처리 | 대상 | 근거 |
|---|---|---|
| **hard delete** | auth 토큰류(#3~5) · social identities(#2) · devices(#6) · notification_settings(#14) · activity_days(#17) · email/phone 인증코드(#15·16) | 보존 의무 없음 — 지체 없이 파기 원칙 |
| **soft-delete → 기존 purge 낙수** | attachment_file(#18) + 스토리지 오브젝트 | §1.4 |
| **익명화 (row 보존)** | users(#1) · payment_history(#8: raw_response/customer_uid 만 제거) · posts(#23: author_nickname) · analytics_events(#24: user_id NULL) | 결제: **GDPR Art.17(3)(b)** 법적 의무 예외 + 전자상거래법 제6조(대금결제·재화공급 기록 5년, 계약·청약철회 5년) — *조문·기간은 법무 확인 전 초안*. users row 는 payment_history/subscriptions 의 NOT NULL FK 때문에 물리 삭제 불가(실측) |
| **보존 (변경 없음)** | subscriptions(#9) · subscription_renewals(#11) · payment_refunds(#22) · payment_webhook_events(#10) · audit_logs/archive(#12·21) · user_read_history(#19) · message_send_history(#20) | 결제 원장 무결성 + 감사·책임추적. 식별성은 users 익명화로 절단. 감사로그는 ADR-028 보존정책이 이미 시한부 purge |

### 1.4 낙수 효과 — 스토리지 파일 삭제

erasure 배치는 첨부를 **직접 지우지 않는다**. `attachment_file` 을 `status='DELETED', purge_at=now()` 로 전환만 하면, 익일 04:00 `AttachmentPurgeScheduler` → `AttachmentPort.purgeExpired` → `StoragePort.deleteObject`(멱등) + row 삭제가 기존 경로로 일어난다. 삭제 로직 중복 0, 스토리지 어댑터 부재 환경(로컬)에서도 안전(§0.4 실측: storage null 이면 row 만 정리).

### 1.5 에러코드·권한

| 추가 | 값 | 비고 |
|---|---|---|
| `AdminError.USER_ALREADY_DELETED` | `400, "ADMIN_024", "이미 탈퇴 처리된 사용자예요."` | delete 재호출 |
| `AdminError.USER_ERASED` | `410, "ADMIN_025", "완전삭제(익명화)된 사용자예요."` | erasure 후 export/delete 시도 |
| `ApiEndpoints.Admin.PERM_USERS_WRITE` | `"PERM_USERS_WRITE"` | delete API 게이팅. `PermissionCatalog`: DOMAIN 분류, `REQUIRES_READ` 에 `PERM_USERS_WRITE ⇒ PERM_USERS_READ` 추가 (기존 PAYMENTS/FILES/CONTENT WRITE 와 동일 규약) |
| `ApiEndpoints.Admin.APP_USERS_EXPORT_PATTERN` | `BASE + "/apps/*/users/*/export"` | SecurityConfig 전용 좁은 매처 |

export 는 기존 `PERM_USERS_UNMASK` 재사용 — 신규 권한 없음.

### 1.6 운영 절차 (1인 운영 — 콘솔 밖 절차 포함)

`docs/production/` 에 runbook 1p 추가(P1 Task 4):

1. **접수** — 지원 이메일로 요청 수신. 접수일 기록(회신 기한 기산점).
2. **본인확인** — 요청 발신 주소 = 가입 email 일치 확인. 불일치/의심 시 가입 email 로 확인 메일 발송 후 회신으로 검증. *(콘솔 기능 아님 — 수동 절차.)*
3. **처리** — export: 콘솔 사용자 상세 → "개인정보 내보내기(JSON)" → 파일을 **가입 email 로만** 발송. delete: 콘솔 삭제 버튼(soft-delete) → 30일 후 배치가 완전삭제. 요청자에게 "30일 내 재로그인 시 복구 문의 가능, 이후 복구 불가" 고지.
4. **기한** — 접수 후 **30일 이내** 회신(GDPR Art.12(3) 1개월 — 복잡 시 +2개월 연장 통지 가능. 국내 개인정보보호법은 "지체 없이" — *법무 확인 전 초안*).
5. **기록** — export 는 `user_read_history`(EXPORT) + `audit_logs` 자동. 접수·회신 일자는 이메일 스레드 보존.

---

## 2. Phase 분할

| Phase | 내용 | 산출물 |
|---|---|---|
| **P1** | Export API + 콘솔 버튼 + 절차 runbook | 요청 대응 즉시 가능 (delete 는 기존 soft-delete 로 임시 대응) |
| **P2** | Admin delete API + `PERM_USERS_WRITE` | 콘솔에서 탈퇴 처리 가능 |
| **P3** | `UserErasureScheduler` 완전삭제/익명화 배치 | WithdrawService 의 "Phase 1" NOTE 이행 |
| **P4** | 셀프서비스 (후속 — 스케치만, 본 플랜 non-goal) | — |

---

# P1 — Export

## File Structure (P1)

- Modify `common/common-web/src/main/java/com/factory/common/web/ApiEndpoints.java` — `APP_USERS_EXPORT_PATTERN` 추가.
- Modify `common/common-security/src/main/java/com/factory/common/security/SecurityConfig.java` — export 매처를 users 매처 위에 삽입.
- Create `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/dto/AdminUserExportResponse.java` — 번들 record.
- Modify `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/AdminUsersService.java` — `exportUser()`.
- Modify `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/repository/UserReadHistoryRepository.java` — `RESOURCE_EXPORT` 상수.
- Modify `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/controller/AdminUsersController.java` — 엔드포인트.
- Test `core/core-admin-impl/src/test/java/com/factory/core/admin/impl/AdminUsersServiceIT.java` — export IT 추가.
- Create `docs/production/gdpr-request-runbook.md` — §1.6 절차.
- (프론트) Modify `../template-react-admin/src/pages/UsersPage.tsx` — 버튼 1개.

### Task 1: 엔드포인트 상수 + SecurityConfig 게이팅

**Files:**
- Modify: `common/common-web/src/main/java/com/factory/common/web/ApiEndpoints.java` (Admin 패턴 블록, `APP_CONTENT_PATTERN` 아래)
- Modify: `common/common-security/src/main/java/com/factory/common/security/SecurityConfig.java` (`APP_USERS_PATTERN` 매처 직전, 141행 부근)

**Interfaces:**
- Produces: `ApiEndpoints.Admin.APP_USERS_EXPORT_PATTERN: String` — 이후 Task 가 SecurityConfig/문서에서 참조.

- [ ] **Step 1: 상수 추가**

```java
/** export 는 전 PII 원본 — PERM_USERS_UNMASK 로 게이팅 (users/** 의 READ 보다 좁은 선행 매처). */
public static final String APP_USERS_EXPORT_PATTERN = BASE + "/apps/*/users/*/export";
```

- [ ] **Step 2: SecurityConfig 매처 삽입** — `APP_USERS_PATTERN` `.hasAuthority(PERM_USERS_READ)` **바로 위에**:

```java
.requestMatchers(ApiEndpoints.Admin.APP_USERS_EXPORT_PATTERN)
.hasAuthority(ApiEndpoints.Admin.PERM_USERS_UNMASK)
```

- [ ] **Step 3: 검증** — `./gradlew :common:common-security:build` + 커밋 `feat(admin): export 엔드포인트 패턴 + UNMASK 게이팅`

### Task 2: AdminUserExportResponse + AdminUsersService.exportUser

**Files:**
- Create: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/dto/AdminUserExportResponse.java`
- Modify: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/AdminUsersService.java`
- Modify: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/repository/UserReadHistoryRepository.java` (`RESOURCE_EXPORT = "EXPORT"` 상수 — 기존 `RESOURCE_USER`/`RESOURCE_FILE` 옆)

**Interfaces:**
- Consumes: `AdminSlugRegistry.jdbcFor(slug)`, `AdminSecurity.currentUser()`, `UserReadHistoryRepository.record(...)`, 기존 `buildDetail()` 하위 쿼리 패턴.
- Produces: `AdminUserExportResponse exportUser(String slug, long userId, String ipAddress)`.

- [ ] **Step 1: DTO record** — 기존 row DTO 재사용 + 신규 섹션은 인라인 record:

```java
/** GDPR export JSON 번들 — §0.2 전수맵의 export=O 항목 전부. 파일 실체 미포함(메타만). */
public record AdminUserExportResponse(
        Instant exportedAt,
        String slug,
        AdminUserFullResponse user,
        List<String> socialProviders,                 // auth_social_identities.provider
        List<AdminDeviceRowResponse> devices,
        List<AdminSubscriptionRowResponse> subscriptions,
        List<AdminPaymentRowResponse> payments,       // LIMIT 없이 전체 (buildDetail 은 10건 제한 — export 는 전체)
        List<AdminNotificationSettingRow> notificationSettings,  // record(kind, pushEnabled, emailEnabled)
        List<LocalDate> activityDays,
        List<AdminExportPostRow> posts,               // record(id, board, title, status, createdAt)
        List<AdminExportAttachmentRow> attachments) { // record(id, storageKey, originalFilename, sizeBytes, status, createdAt)

    public record AdminNotificationSettingRow(String kind, boolean pushEnabled, boolean emailEnabled) {}
    public record AdminExportPostRow(Long id, String board, String title, String status, Instant createdAt) {}
    public record AdminExportAttachmentRow(
            Long id, String storageKey, String originalFilename, long sizeBytes, String status, Instant createdAt) {}
}
```

- [ ] **Step 2: exportUser 구현** — `revealUser` 와 동일 골격(원본 조회 + 이력 기록):

```java
/** GDPR export — 원본 번들 반환 + user_read_history(EXPORT) 기록. SecurityConfig 가 UNMASK 게이팅. */
@Audited(value = "admin.user.export", resourceType = "User")
public AdminUserExportResponse exportUser(String slug, long userId, String ipAddress) {
    JdbcTemplate jdbc = registry.jdbcFor(slug);
    AdminUserDetailResponse detail = buildDetail(slug, userId);   // 미존재 시 기존 흐름대로 예외
    List<String> providers = jdbc.queryForList(
            "SELECT provider FROM auth_social_identities WHERE user_id = ? ORDER BY provider",
            String.class, userId);
    List<AdminPaymentRowResponse> allPayments = jdbc.query(
            "SELECT id, channel, amount, currency, status, paid_at, refunded_at"
                    + " FROM payment_history WHERE user_id = ? ORDER BY id DESC",   // buildDetail 과 동일, LIMIT 10 만 제거
            (rs, i) -> new AdminPaymentRowResponse(rs.getLong("id"), rs.getString("channel"),
                    rs.getLong("amount"), rs.getString("currency"), rs.getString("status"),
                    ts(rs, "paid_at"), ts(rs, "refunded_at")), userId);
    List<AdminUserExportResponse.AdminNotificationSettingRow> settings = jdbc.query(
            "SELECT kind, push_enabled, email_enabled FROM user_notification_settings WHERE user_id = ? ORDER BY kind",
            (rs, i) -> new AdminUserExportResponse.AdminNotificationSettingRow(
                    rs.getString("kind"), rs.getBoolean("push_enabled"), rs.getBoolean("email_enabled")), userId);
    List<LocalDate> days = jdbc.queryForList(
            "SELECT activity_date FROM user_activity_days WHERE user_id = ? ORDER BY activity_date",
            LocalDate.class, userId);
    List<AdminUserExportResponse.AdminExportPostRow> posts = jdbc.query(
            "SELECT id, board, title, status, created_at FROM posts WHERE author_user_id = ? ORDER BY id",
            (rs, i) -> new AdminUserExportResponse.AdminExportPostRow(
                    rs.getLong("id"), rs.getString("board"), rs.getString("title"),
                    rs.getString("status"), ts(rs, "created_at")), userId);
    List<AdminUserExportResponse.AdminExportAttachmentRow> files = jdbc.query(
            "SELECT id, storage_key, original_filename, size_bytes, status, created_at FROM attachment_file"
                    + " WHERE uploaded_by = ? OR (associated_type = 'USER' AND associated_id = ?) ORDER BY id",
            (rs, i) -> new AdminUserExportResponse.AdminExportAttachmentRow(
                    rs.getLong("id"), rs.getString("storage_key"), rs.getString("original_filename"),
                    rs.getLong("size_bytes"), rs.getString("status"), ts(rs, "created_at")), userId, userId);

    AuthenticatedUser actor = AdminSecurity.currentUser();
    if (actor != null) {
        readHistory.record(jdbc, actor.userId(), actor.email(), userId,
                UserReadHistoryRepository.RESOURCE_EXPORT, null, ipAddress);
    }
    return new AdminUserExportResponse(Instant.now(), slug, detail.user(), providers,
            detail.devices(), detail.subscriptions(), allPayments, settings, days, posts, files);
}
```

- [ ] **Step 3: IT** — `AdminUsersServiceIT` 에 추가: `loginAs("admin", "PERM_USERS_UNMASK")` 후 export 호출 → 번들 각 섹션 카운트 = 시드 카운트, `user_read_history` 에 `resource_type='EXPORT'` 1행 assert.
- [ ] **Step 4: 검증·커밋** — `./gradlew :core:core-admin-impl:test` → `feat(admin): 사용자 GDPR export 번들 서비스`

### Task 3: AdminUsersController 엔드포인트

**Files:**
- Modify: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/controller/AdminUsersController.java`

**Interfaces:**
- Consumes: `AdminUsersService.exportUser(slug, userId, ip)`, 기존 `clientIp(request)` 헬퍼.

- [ ] **Step 1: 매핑 추가** — `revealUser` 아래, 동일 컨벤션(명시적 `@PathVariable` 이름 — `-parameters` 미사용 빌드):

```java
/** GDPR export — 전 PII 원본 JSON 번들. SecurityConfig 가 PERM_USERS_UNMASK 로 게이팅. */
@GetMapping(ApiEndpoints.Admin.APP_SCOPE + "/users/{userId}/export")
public ApiResponse<AdminUserExportResponse> exportUser(
        @PathVariable("slug") String slug,
        @PathVariable("userId") long userId,
        HttpServletRequest request) {
    return ApiResponse.ok(usersService.exportUser(slug, userId, clientIp(request)));
}
```

- [ ] **Step 2: 컨트롤러 테스트** — `AdminFilesControllerTest` 패턴으로 MockMvc: UNMASK 없는 토큰 → 403, 있는 토큰 → 200 + JSON 섹션 존재.
- [ ] **Step 3: 검증·커밋** — `./gradlew :core:core-admin-impl:test :bootstrap:test`(ArchUnit) → `feat(admin): GET users/{id}/export 엔드포인트`

### Task 4: 운영 절차 runbook + react-admin 버튼 1개

**Files:**
- Create: `docs/production/gdpr-request-runbook.md` — §1.6 의 5단계 절차 + §1.3 처리 표 요약 + "법무 확인 전 초안" 배너.
- Modify(프론트, `template-react-admin` 레포): `src/pages/UsersPage.tsx` — 사용자 상세 Drawer 액션 영역에 버튼 1개.

- [ ] **Step 1: runbook 작성** — §1.6 전문 이관. 접수~회신 체크리스트 표 포함.
- [ ] **Step 2: 프론트 버튼** — 권한 `PERM_USERS_UNMASK` 보유 시에만 노출:

```tsx
<Button icon={<DownloadOutlined />} onClick={async () => {
  const res = await api.get(`/api/admin/apps/${slug}/users/${user.id}/export`)
  const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `user-${user.id}-export.json`
  a.click()
  URL.revokeObjectURL(a.href)
}}>개인정보 내보내기(JSON)</Button>
```

- [ ] **Step 3: 검증·커밋** — `npx tsc -b` + `npm run build` + MSW 목 확인. 커밋 `feat(admin): 사용자 상세 GDPR export 버튼` / `docs(ops): GDPR 요청 대응 runbook`

---

# P2 — Admin delete API

### Task 5: PERM_USERS_WRITE + AdminError 추가

**Files:**
- Modify: `common/common-web/src/main/java/com/factory/common/web/ApiEndpoints.java` — `PERM_USERS_WRITE` 상수.
- Modify: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/rbac/PermissionCatalog.java` — `ALL` 목록(`PERM_USERS_UNMASK` 다음) + `REQUIRES_READ` 에 `PERM_USERS_WRITE ⇒ PERM_USERS_READ`.
- Modify: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/exception/AdminError.java` — `ADMIN_024`/`ADMIN_025` (§1.5 표 그대로, 재배치 없이 끝에 추가).
- Modify: `common/common-security/src/main/java/com/factory/common/security/SecurityConfig.java` — `HttpMethod.DELETE` + `APP_USERS_PATTERN` → `hasAuthority(PERM_USERS_WRITE)` 매처를 export 매처와 READ 매처 사이에 삽입.

- [ ] **Step 1: 상수·enum·카탈로그 추가** (§1.5 표의 값 그대로)
- [ ] **Step 2: 매처 삽입**

```java
.requestMatchers(HttpMethod.DELETE, ApiEndpoints.Admin.APP_USERS_PATTERN)
.hasAuthority(ApiEndpoints.Admin.PERM_USERS_WRITE)
```

- [ ] **Step 3: 검증·커밋** — `AdminRolesServiceIT` 매트릭스 관련 테스트 통과 확인 → `feat(admin): PERM_USERS_WRITE 권한 + 사용자 삭제 에러코드`

### Task 6: DELETE /api/admin/apps/{slug}/users/{userId}

**Files:**
- Modify: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/AdminUsersService.java` — `deleteUser(slug, userId)`.
- Modify: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/controller/AdminUsersController.java` — `@DeleteMapping`.
- Test: `AdminUsersServiceIT`.

**Interfaces:**
- Produces: `void deleteUser(String slug, long userId)` — soft-delete + 토큰 revoke. 이미 `deleted_at` 있으면 `AdminException(USER_ALREADY_DELETED)`, 익명화 마커면 `USER_ERASED`.

- [ ] **Step 1: 서비스** — raw JDBC(콘솔 선례) 로 원자 처리:

```java
/** 콘솔 탈퇴 처리 — WithdrawService 시맨틱(soft-delete + refresh 전체 revoke)의 admin 경로판. */
@Audited(value = "admin.user.delete", resourceType = "User")
public void deleteUser(String slug, long userId) {
    JdbcTemplate jdbc = registry.jdbcFor(slug);
    Map<String, Object> row;
    try {
        row = jdbc.queryForMap("SELECT email, deleted_at FROM users WHERE id = ?", userId);
    } catch (EmptyResultDataAccessException e) {
        throw new AdminException(AdminError.USER_NOT_FOUND);
    }
    if (((String) row.get("email")).endsWith("@erased.invalid")) {
        throw new AdminException(AdminError.USER_ERASED);
    }
    if (row.get("deleted_at") != null) {
        throw new AdminException(AdminError.USER_ALREADY_DELETED);
    }
    jdbc.update("UPDATE users SET deleted_at = now(), updated_at = now() WHERE id = ?", userId);
    jdbc.update("UPDATE auth_refresh_tokens SET revoked_at = now() WHERE user_id = ? AND revoked_at IS NULL", userId);
}
```

- [ ] **Step 2: 컨트롤러** — 본문 없는 성공 응답은 `ApiResponse<Void>` + `ApiResponse.empty()` (AdminAccountsController.resetPassword 관행):

```java
@DeleteMapping(ApiEndpoints.Admin.APP_SCOPE + "/users/{userId}")
public ApiResponse<Void> deleteUser(
        @PathVariable("slug") String slug, @PathVariable("userId") long userId) {
    usersService.deleteUser(slug, userId);
    return ApiResponse.empty();
}
```
- [ ] **Step 3: IT** — 정상 삭제 / 재삭제 400 ADMIN_024 / 미존재 404 / WRITE 권한 없는 토큰 403.
- [ ] **Step 4: 검증·커밋** — `feat(admin): 콘솔 사용자 탈퇴(soft-delete) API`
- [ ] **Step 5: 프론트** — UsersPage 상세 Drawer 에 `Popconfirm` 삭제 버튼(P1 버튼과 동일 사이클로 전파). *export 버튼(Task 4)이 "버튼 1개 추가" 본체 — 이건 P2 부속.*

---

# P3 — UserErasureScheduler (완전삭제/익명화 배치)

### Task 7: erasure SQL 시퀀스 (AdminUserErasureService)

**Files:**
- Create: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/AdminUserErasureService.java`
- Test: `core/core-admin-impl/src/test/java/com/factory/core/admin/impl/AdminUserErasureServiceIT.java`

**Interfaces:**
- Consumes: `AdminSlugRegistry.jdbcFor(slug)`, `AttachmentPort.softDelete(slug, id, reason, deletedBy)`.
- Produces: `int eraseExpired(String slug, Instant threshold)` — 처리 사용자 수 반환 (스케줄러가 소비).

- [ ] **Step 1: 대상 선정 쿼리** — 유예 경과 + 미익명화 + 활성구독 없음:

```sql
SELECT u.id, u.email FROM users u
WHERE u.deleted_at IS NOT NULL AND u.deleted_at <= ?           -- threshold = now() - grace
  AND u.email NOT LIKE 'deleted-%@erased.invalid'              -- 멱등 마커
  AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'ACTIVE')
```

- [ ] **Step 2: 사용자당 시퀀스** — §1.3 표 순서 그대로, 사용자 1명 = 트랜잭션 1개 (`TransactionTemplate`), 첨부만 Port 경유:

```java
// 1) hard delete (보존 의무 없음)
jdbc.update("DELETE FROM auth_refresh_tokens WHERE user_id = ?", id);
jdbc.update("DELETE FROM auth_email_verification_tokens WHERE user_id = ?", id);
jdbc.update("DELETE FROM auth_password_reset_tokens WHERE user_id = ?", id);
jdbc.update("DELETE FROM auth_email_verification_codes WHERE email = ?", email);
jdbc.update("DELETE FROM auth_social_identities WHERE user_id = ?", id);
jdbc.update("DELETE FROM devices WHERE user_id = ?", id);
jdbc.update("DELETE FROM user_notification_settings WHERE user_id = ?", id);
jdbc.update("DELETE FROM user_activity_days WHERE user_id = ?", id);
// 2) 익명화 (연결 절단 — row 보존)
jdbc.update("UPDATE analytics_events SET user_id = NULL WHERE user_id = ?", id);
jdbc.update("UPDATE posts SET author_nickname = NULL WHERE author_user_id = ?", id);
jdbc.update("UPDATE payment_history SET raw_response = NULL, customer_uid = NULL WHERE user_id = ?", id);
// 3) 첨부 → soft-delete 전환 (스토리지는 기존 스케줄러 낙수 §1.4). 트랜잭션 밖 or 후순위 — Port 가 자체 tx.
List<Long> fileIds = jdbc.queryForList(
        "SELECT id FROM attachment_file WHERE status <> 'DELETED'"
                + " AND (uploaded_by = ? OR (associated_type = 'USER' AND associated_id = ?))",
        Long.class, id, id);
fileIds.forEach(fid -> attachmentPort.softDelete(slug, fid, "GDPR erasure", null));
// 4) users 익명화 — 마지막 (마커 세팅 = 완료 표식)
jdbc.update("UPDATE users SET email = 'deleted-' || id || '@erased.invalid', password_hash = NULL,"
        + " display_name = NULL, nickname = NULL, totp_secret = NULL, totp_backup_codes = NULL,"
        + " totp_enabled = false, updated_at = now() WHERE id = ?", id);
```

주: `auth_phone_verification_codes` 는 user_id 없음 — social identity(provider='phone') 삭제 전에 `provider_id`(E.164) 를 읽어 매칭 DELETE (identity 없으면 스킵). `uk_users_email_active` 는 partial index 라 마커 email 충돌 없음(§0.3).

- [ ] **Step 3: IT** — 시드 전 테이블 → erasure → §0.2 표 기대치 assert: hard delete 대상 0행 / payment_history 행수 불변 + raw_response IS NULL / users email 마커 / attachment status=DELETED·purge_at 세팅 / 재실행 시 0명 처리(멱등) / ACTIVE 구독자 스킵.
- [ ] **Step 4: 검증·커밋** — `feat(admin): GDPR erasure 시퀀스 서비스`

### Task 8: 스케줄러 + AutoConfiguration

**Files:**
- Create: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/scheduler/UserErasureScheduler.java`
- Modify: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/AdminAutoConfiguration.java` — `@ConditionalOnProperty("app.user.erasure.enabled")` Bean 등록(운영에서만 활성 권장 — attachment/audit 관행 동일).

- [ ] **Step 1: 스케줄러** — `AttachmentPurgeScheduler` 복제 골격(slug 순회 + `SlugContext` + 슬러그 실패 isolate). cron 기본 **05:00** (04:00 첨부·04:30 감사와 분리), `app.user.erasure.cron` override, grace `app.user.erasure.grace-days:30`:

```java
@Scheduled(cron = "${app.user.erasure.cron:0 0 5 * * *}")
public void eraseExpiredUsers() {
    Instant threshold = Instant.now().minus(Duration.ofDays(graceDays));
    for (String slug : slugs) {
        try {
            SlugContext.set(slug);
            total += erasureService.eraseExpired(slug, threshold);
        } catch (Exception e) {
            log.error("User erasure failed for slug={}", slug, e);
        } finally {
            SlugContext.clear();
        }
    }
}
```

- [ ] **Step 2: 스케줄러 단위테스트** — `AttachmentPurgeSchedulerTest` 패턴 (slug 추출·isolate·threshold 계산).
- [ ] **Step 3: 검증·커밋** — `./gradlew build :bootstrap:test` → `feat(admin): 사용자 완전삭제(erasure) 스케줄러`
- [ ] **Step 4: 문서 후속** — runbook(Task 4 산출물)에 배치 활성 조건·grace 프로퍼티 추가, `WithdrawService.java:55` 의 "Phase 1" NOTE 를 본 구현 참조로 갱신, `docs/planned/backlog.md:57` 체크.

---

# P4 — 셀프서비스 (후속 — 스케치만, 구현 태스크 없음)

- `GET /api/apps/{appSlug}/me/export` — Task 2 번들 재사용(단, admin 전용 필드 제외 검토). 인증 = 본인 JWT. rate-limit 필수(1일 1회 수준). GDPR Art.20(데이터 이동권) 대응.
- 삭제 셀프서비스는 **기존 `WithdrawService`(withdraw API) 가 이미 접수 역할** — P3 배치가 붙는 순간 자동으로 "탈퇴 = 30일 후 완전삭제" 가 완성되므로 신규 API 불필요. 앱 내 고지 문구만 필요.
- Apple token revoke (App Store 5.1.1(v)) — WithdrawService NOTE 의 나머지 절반. 본 플랜 범위 외, backlog 유지.

---

## Open Questions (리뷰 요청)

- **OQ-1** posts 본문: 익명화(작성자 절단)로 충분한가, 삭제 요청 범위에 "내 게시물 전부 삭제" 옵션(→`ContentPort.softDelete` 일괄)을 절차에 넣을까? (GDPR 상 본문에 PII 포함 시 삭제 요구 가능)
- **OQ-2** `message_send_history.target_ref` 가 email 인 행 — erasure 시 매칭 익명화할까, 발송 책임기록으로 보존할까?
- **OQ-3** `payment_webhook_events.payload` JSONB 내 PII — external_id 로 대상자 건 특정해 payload 축약? (PG 대사 필요성과 상충 — 보존기간 정책으로 풀지 검토)
- **OQ-4** 파생 앱 자체 테이블(V026+) 확장 포인트 — `UserErasureHook` 인터페이스(파생 레포가 Bean 등록) vs 프로퍼티로 SQL 목록 주입. P3 구현 시 결정.
- **OQ-5** 유예기간 30일 값·"복구 가능" 고지 문구 — 약관/개인정보처리방침과 정합 확인.
- **OQ-6** §1.3 법정 보존 조문·기간(전자상거래법 제6조 5년 등) — 법무(또는 최소한 원문 대조) 확인 후 runbook 확정.
