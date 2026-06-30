# 스키마 테이블 네이밍 정리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 코어 5개 테이블을 유추 가능·일관된 이름으로 리네임(테이블/엔티티/DTO/문서)하고, 통합 `data-model.md` 를 작성한다.

**Architecture:** 리네임은 template-spring(소스)에서 IDE-스타일 식별자 리네임 + `@Table`/`new-app.sh` CREATE TABLE 갱신으로 하고, 컴파일+기존 테스트 통과로 무행동변화를 검증한다. 기존 데이터가 있는 backend-server(tradelog)는 `V017 ALTER TABLE RENAME` 으로 무손실 전환한다. notification 은 클라 API 경로까지 바뀌므로 template-flutter 도 함께 수정하고 3레포 동시 배포한다.

**Tech Stack:** Java 21 / Spring Boot / Gradle / Flyway / PostgreSQL 16 / Flutter(Dart)

## Global Constraints

- 리네임 5개(확정): `phone_otp_codes`→`phone_verification_codes`, `renewal_attempts`→`subscription_renewals`, `user_notification_preferences`→`user_notification_settings`, `payment_records`→`payment_history`, `webhook_events`→`payment_webhook_events`
- 유지 10개: `users`,`social_identities`,`refresh_tokens`,`email_verification_codes`,`email_verification_tokens`,`password_reset_tokens`,`plans`,`subscriptions`,`devices`,`audit_logs` — 절대 건드리지 않음
- 컬럼명 변경 금지 (이번 스코프 외). FK 컬럼 `payment_record_id` 는 이름 유지, `REFERENCES` 타겟만 갱신
- 테이블 = snake_case 복수형 / 엔티티 클래스 = PascalCase 단수 (naming.md §261)
- 커밋 트레일러(Co-Authored-By 등) 금지. push 는 사용자 명시 신호 시에만
- 각 gradle 모듈 수정 후 `spotlessApply` 실행 (google-java-format)
- 스코프 enum(commitlint): core / billing / phone-auth / common / docs / apps / tools 사용

---

## Phase A — template-spring (소스)

### Task 1: `phone_otp_codes` → `phone_verification_codes`

**Files:**
- Modify: `core/core-phone-auth-impl/src/main/java/com/factory/core/phoneauth/impl/entity/PhoneOtpCode.java` (클래스명 + `@Table`)
- Modify: `core/core-phone-auth-impl/.../repository/PhoneOtpCodeRepository.java`
- Modify: `core/core-phone-auth-impl/.../service/OtpService.java` + 기타 참조(약 5파일)
- Modify: `tools/new-app/new-app.sh` (V015 CREATE TABLE + index)

**Interfaces:**
- Produces: 클래스 `PhoneVerificationCode`, `@Table(name="phone_verification_codes")`, 인덱스 `idx_phone_verification_codes_phone_created`

- [ ] **Step 1: 식별자 리네임** — `core/core-phone-auth-impl` 안에서 클래스/파일 `PhoneOtpCode`→`PhoneVerificationCode`, `PhoneOtpCodeRepository`→`PhoneVerificationCodeRepository` 로 전 참조 변경. 확인:
```bash
grep -rln "PhoneOtpCode" --include="*.java" core | grep -v /build/   # 0건이어야
```
- [ ] **Step 2: `@Table` + 파일명 변경**
```java
// PhoneVerificationCode.java
@Table(name = "phone_verification_codes")
public class PhoneVerificationCode { ... }
```
- [ ] **Step 3: new-app.sh V015 갱신** — `phone_otp_codes`→`phone_verification_codes`, `idx_phone_otp_codes_phone_created`→`idx_phone_verification_codes_phone_created`. 확인:
```bash
grep -n "phone_otp_codes" tools/new-app/new-app.sh   # 0건
bash -n tools/new-app/new-app.sh                       # 문법 OK
```
- [ ] **Step 4: 빌드+테스트 (무행동변화 검증)**
```bash
./gradlew :core:core-phone-auth-impl:spotlessApply -q
./gradlew :core:core-phone-auth-impl:build
```
Expected: BUILD SUCCESSFUL (기존 테스트 그대로 통과 = 리네임만)
- [ ] **Step 5: 커밋**
```bash
git add -A && git commit -m "refactor(phone-auth): phone_otp_codes → phone_verification_codes (테이블+엔티티)"
```

### Task 2: `renewal_attempts` → `subscription_renewals`

**Files:**
- Modify: `core/core-billing-impl/.../entity/RenewalAttempt.java` (→ `SubscriptionRenewal`, `@Table`)
- Modify: `core/core-billing-api/.../RenewalAttemptStatus.java` (→ `SubscriptionRenewalStatus`)
- Modify: billing repo/service + 참조(약 8파일)
- Modify: `tools/new-app/new-app.sh` (V011)

**Interfaces:**
- Produces: `SubscriptionRenewal`, `SubscriptionRenewalStatus`, `@Table(name="subscription_renewals")`, 인덱스 `idx_subscription_renewals_subscription_id`/`_status`/`_due`, `uk_subscription_renewals_subscription_attempt`

- [ ] **Step 1: 식별자 리네임** — `RenewalAttempt`→`SubscriptionRenewal`, `RenewalAttemptStatus`→`SubscriptionRenewalStatus` (core-billing-api + impl 전 참조 + 파일명). 확인:
```bash
grep -rln "RenewalAttempt" --include="*.java" core | grep -v /build/   # 0건
```
- [ ] **Step 2: `@Table`**
```java
@Table(name = "subscription_renewals")
public class SubscriptionRenewal { ... }
```
- [ ] **Step 3: new-app.sh V011 갱신** — `renewal_attempts`→`subscription_renewals`, `idx_renewal_attempts_*`→`idx_subscription_renewals_*`, `uk_renewal_attempts_subscription_attempt`→`uk_subscription_renewals_subscription_attempt`. (FK `payment_record_id` 컬럼명은 유지.) 확인:
```bash
grep -n "renewal_attempts" tools/new-app/new-app.sh   # 0건
bash -n tools/new-app/new-app.sh
```
- [ ] **Step 4: 빌드+테스트**
```bash
./gradlew :core:core-billing-api:spotlessApply :core:core-billing-impl:spotlessApply -q
./gradlew :core:core-billing-impl:build
```
Expected: BUILD SUCCESSFUL
- [ ] **Step 5: 커밋**
```bash
git add -A && git commit -m "refactor(billing): renewal_attempts → subscription_renewals (테이블+엔티티+enum)"
```

### Task 3: `payment_records` → `payment_history`

**Files:**
- Modify: `core/core-billing-impl/.../entity/PaymentRecord.java` (→ `PaymentHistory`, `@Table`)
- Modify: `core/core-billing-api/.../PaymentRecordStatus.java` (→ `PaymentHistoryStatus`), `.../dto/PaymentRecordDto.java` (→ `PaymentHistoryDto`)
- Modify: 참조 ~20파일 (billing-api/impl, iap-api/impl, audit, common, BillingPort javadoc)
- Modify: `tools/new-app/new-app.sh` (V009 — CREATE TABLE + index + `subscriptions`·`subscription_renewals` 의 `REFERENCES payment_records(id)`)

**Interfaces:**
- Produces: `PaymentHistory`, `PaymentHistoryStatus`, `PaymentHistoryDto`, `@Table(name="payment_history")`, 인덱스 `uk_payment_history_external_id`,`idx_payment_history_user_id`,`idx_payment_history_status`,`idx_payment_history_customer_uid`

- [ ] **Step 1: 식별자 리네임** — `PaymentRecord`→`PaymentHistory`, `PaymentRecordStatus`→`PaymentHistoryStatus`, `PaymentRecordDto`→`PaymentHistoryDto` (전 모듈 + 파일명). javadoc 내 "PaymentRecord" 텍스트도 "PaymentHistory" 로. 확인:
```bash
grep -rln "PaymentRecord" --include="*.java" core common | grep -v /build/   # 0건
```
- [ ] **Step 2: `@Table` + FK REFERENCES** — `@Table(name="payment_history")`. new-app.sh V009 에서 `payment_records`→`payment_history`, `uk_payment_records_*`/`idx_payment_records_*`→`*_payment_history_*`, 그리고 `subscriptions` + `subscription_renewals` 의 `payment_record_id BIGINT REFERENCES payment_records(id)` → `REFERENCES payment_history(id)` (컬럼명 `payment_record_id` 유지). 확인:
```bash
grep -n "payment_records" tools/new-app/new-app.sh    # 0건
bash -n tools/new-app/new-app.sh
```
- [ ] **Step 3: 빌드+테스트 (billing+iap+audit)**
```bash
./gradlew :core:core-billing-api:spotlessApply :core:core-billing-impl:spotlessApply :core:core-iap-impl:spotlessApply -q
./gradlew :core:core-billing-impl:build :core:core-iap-impl:build :core:core-audit-impl:build
```
Expected: BUILD SUCCESSFUL
- [ ] **Step 4: 커밋**
```bash
git add -A && git commit -m "refactor(billing): payment_records → payment_history (테이블+엔티티+DTO+enum)"
```

### Task 4: `webhook_events` → `payment_webhook_events`

**Files:**
- Modify: `core/core-billing-impl/.../entity/WebhookEvent.java` (→ `PaymentWebhookEvent`, `@Table`)
- Modify: `WebhookEventRepository` + 참조(약 6파일)
- Modify: `tools/new-app/new-app.sh` (V010)

**Interfaces:**
- Produces: `PaymentWebhookEvent`, `@Table(name="payment_webhook_events")`, 인덱스 `uk_payment_webhook_events_external_id`,`idx_payment_webhook_events_received_at`

- [ ] **Step 1: 식별자 리네임** — `WebhookEvent`→`PaymentWebhookEvent`, `WebhookEventRepository`→`PaymentWebhookEventRepository`. 확인:
```bash
grep -rln "\bWebhookEvent\b" --include="*.java" core | grep -v /build/   # 0건 (WebhookMessage 등 다른 타입은 제외)
```
- [ ] **Step 2: `@Table` + new-app.sh V010** — `webhook_events`→`payment_webhook_events`, `uk_webhook_events_external_id`→`uk_payment_webhook_events_external_id`, `idx_webhook_events_received_at`→`idx_payment_webhook_events_received_at`. 확인:
```bash
grep -n "webhook_events" tools/new-app/new-app.sh    # 0건 (payment_webhook_events 만)
bash -n tools/new-app/new-app.sh
```
- [ ] **Step 3: 빌드+테스트**
```bash
./gradlew :core:core-billing-impl:spotlessApply -q
./gradlew :core:core-billing-impl:build
```
Expected: BUILD SUCCESSFUL
- [ ] **Step 4: 커밋**
```bash
git add -A && git commit -m "refactor(billing): webhook_events → payment_webhook_events (테이블+엔티티)"
```

### Task 5: `user_notification_preferences` → `user_notification_settings` (+ 클라 경로)

**Files:**
- Modify: `core/core-billing-impl/.../entity/NotificationPreference.java` (→ `NotificationSetting`, `@Table`)
- Modify: `NotificationPreference{Repository,Service,Controller,ControllerTest}` + `dto/NotificationPreferenceDto.java` + `dto/NotificationPreferenceUpdateRequest.java` → `NotificationSetting…`
- Modify: `SubscriptionNotificationListener` 참조, `BillingAutoConfiguration`
- Modify: `common/common-web/.../ApiEndpoints.java` (`NotificationPreferences` 경로 상수 → `NotificationSettings`, path `/me/notification-settings`)
- Modify: `tools/new-app/new-app.sh` (V014)

**Interfaces:**
- Produces: `NotificationSetting`, `@Table(name="user_notification_settings")`, `ApiEndpoints.NotificationSettings.BASE = APP_BASE + "/me/notification-settings"`, 인덱스 `uk_user_notification_settings_user_kind`,`idx_user_notification_settings_user_id`

- [ ] **Step 1: 식별자 리네임** — `NotificationPreference`→`NotificationSetting` 계열 전부(entity/repo/service/controller/dto/updateRequest/test). 확인:
```bash
grep -rln "NotificationPreference" --include="*.java" core | grep -v /build/   # 0건
```
- [ ] **Step 2: `@Table` + ApiEndpoints 경로**
```java
@Table(name = "user_notification_settings")
public class NotificationSetting { ... }
// ApiEndpoints.java — 기존 NotificationPreferences inner class 를 NotificationSettings 로,
// BASE = APP_BASE + "/me/notification-settings"; BASE_PATTERN = APP_BASE_PATTERN + "/me/notification-settings";
```
- [ ] **Step 3: new-app.sh V014** — `user_notification_preferences`→`user_notification_settings`, `uk_user_notification_preferences_user_kind`→`uk_user_notification_settings_user_kind`, `idx_user_notification_preferences_user_id`→`idx_user_notification_settings_user_id`. 확인:
```bash
grep -n "notification_preferences" tools/new-app/new-app.sh   # 0건
bash -n tools/new-app/new-app.sh
```
- [ ] **Step 4: 빌드+테스트**
```bash
./gradlew :common:common-web:spotlessApply :core:core-billing-impl:spotlessApply -q
./gradlew :core:core-billing-impl:build :bootstrap:compileJava
```
Expected: BUILD SUCCESSFUL
- [ ] **Step 5: 커밋**
```bash
git add -A && git commit -m "refactor(billing): notification preferences → settings (테이블+엔티티+API 경로)"
```

### Task 6: 통합 `data-model.md` 신규 + 옛 이름 문서 정정

**Files:**
- Create: `docs/reference/data-model.md`
- Modify: 옛 테이블명 참조 docs (`webhook_events` 12 · `phone_otp_codes` 11 · `renewal_attempts` 9 · `payment_records` 7 · `user_notification_preferences` 3 파일; naming.md/ADR-012/021/022/028/functional 등)

- [ ] **Step 1: 옛 이름 잔존 문서 목록 추출**
```bash
for t in phone_otp_codes renewal_attempts user_notification_preferences payment_records webhook_events; do
  echo "== $t =="; grep -rl "$t" docs
done
```
- [ ] **Step 2: docs 일괄 정정** — 위 목록의 각 파일에서 옛→새 테이블명 치환 (문맥 보존). ADR 본문이 *역사적 결정*을 서술하면 갱신 callout 또는 "(현 이름: …)" 주석으로 표기. 확인:
```bash
grep -rl "phone_otp_codes\|renewal_attempts\|user_notification_preferences\|payment_records\|\bwebhook_events\b" docs   # 의도된 역사 기록만 남아야
```
- [ ] **Step 3: `data-model.md` 작성** — 5 도메인 그룹(Identity / Auth·Credential / Phone / Billing / Device·Audit) × 테이블별 [용도 1줄 · 주요 컬럼 · FK 관계 · 관련 ADR · 생성 V번호]. 신규 이름 기준. per-app schema(ADR-005/037) 링크. 말미에 "컬럼명 정리는 차기 라운드(`payment_record_id` 등)" 메모. STYLE_GUIDE 해요체 준수.
- [ ] **Step 4: 링크 점검 + 커밋**
```bash
# 상대경로 링크 깨짐 없는지 육안 확인
git add -A && git commit -m "docs(reference): data-model.md 신규 + 테이블 리네임 문서 정정"
```

### Task 7: template-spring 전체 빌드 게이트

- [ ] **Step 1: 전체 빌드+테스트**
```bash
./gradlew build
```
Expected: BUILD SUCCESSFUL (전 모듈 컴파일 + 테스트 그린)
- [ ] **Step 2: 옛 이름 전수 0건 확인**
```bash
grep -rln "PhoneOtpCode\|RenewalAttempt\|NotificationPreference\|PaymentRecord\|\bWebhookEvent\b" --include="*.java" core common bootstrap | grep -v /build/   # 0건
grep -rn "phone_otp_codes\|renewal_attempts\|user_notification_preferences\|payment_records\|\bwebhook_events\b" tools/new-app/new-app.sh   # 0건
```

---

## Phase B — backend-server (tradelog, 실데이터)

### Task 8: 코드 동기화 + `V017` rename 마이그레이션

**Files:**
- Modify: template-spring 에서 변경된 코드 동기화 (entity/dto/enum/repo/service/controller/ApiEndpoints) — push 전이면 파일 복사, push 후면 `git checkout template/main -- <paths>`
- Create: `apps/app-tradelog/src/main/resources/db/migration/tradelog/V017__rename_core_tables.sql`

- [ ] **Step 1: 코드 동기화** — 변경된 파일들을 backend-server 동일 경로로 반영. 확인: 옛 식별자 0건
```bash
grep -rln "PaymentRecord\|RenewalAttempt\|WebhookEvent\|NotificationPreference\|PhoneOtpCode" --include="*.java" core common bootstrap | grep -v /build/   # 0건
```
- [ ] **Step 2: V017 마이그레이션 작성** (PG 의 `ALTER TABLE RENAME` 은 FK 참조 자동 갱신 → REFERENCES 별도 수정 불필요. 데이터 무손실.)
```sql
-- V017__rename_core_tables.sql — 테이블 네이밍 일관화 (데이터 보존)
ALTER TABLE phone_otp_codes RENAME TO phone_verification_codes;
ALTER INDEX idx_phone_otp_codes_phone_created RENAME TO idx_phone_verification_codes_phone_created;

ALTER TABLE renewal_attempts RENAME TO subscription_renewals;
ALTER INDEX idx_renewal_attempts_subscription_id RENAME TO idx_subscription_renewals_subscription_id;
ALTER INDEX idx_renewal_attempts_status RENAME TO idx_subscription_renewals_status;
ALTER INDEX idx_renewal_attempts_due RENAME TO idx_subscription_renewals_due;
ALTER INDEX uk_renewal_attempts_subscription_attempt RENAME TO uk_subscription_renewals_subscription_attempt;

ALTER TABLE payment_records RENAME TO payment_history;
ALTER INDEX uk_payment_records_external_id RENAME TO uk_payment_history_external_id;
ALTER INDEX idx_payment_records_user_id RENAME TO idx_payment_history_user_id;
ALTER INDEX idx_payment_records_status RENAME TO idx_payment_history_status;
ALTER INDEX idx_payment_records_customer_uid RENAME TO idx_payment_history_customer_uid;

ALTER TABLE webhook_events RENAME TO payment_webhook_events;
ALTER INDEX uk_webhook_events_external_id RENAME TO uk_payment_webhook_events_external_id;
ALTER INDEX idx_webhook_events_received_at RENAME TO idx_payment_webhook_events_received_at;

ALTER TABLE user_notification_preferences RENAME TO user_notification_settings;
ALTER INDEX uk_user_notification_preferences_user_kind RENAME TO uk_user_notification_settings_user_kind;
ALTER INDEX idx_user_notification_preferences_user_id RENAME TO idx_user_notification_settings_user_id;
```
- [ ] **Step 3: 빌드+테스트**
```bash
./gradlew build
```
Expected: BUILD SUCCESSFUL
- [ ] **Step 4: 로컬 DB 마이그레이션 검증 (행수 보존)**
```bash
# V017 적용 전 행수 기록 → 재기동 → 행수 동일 확인
docker compose -f infra/docker-compose.local.yml up --build -d spring
# 부팅 후:
docker exec backend-server-postgres-local psql -U postgres -d postgres -tAc \
 "SELECT 'phone_verification_codes', count(*) FROM tradelog.phone_verification_codes
  UNION ALL SELECT 'payment_history', count(*) FROM tradelog.payment_history
  UNION ALL SELECT 'subscription_renewals', count(*) FROM tradelog.subscription_renewals
  UNION ALL SELECT 'payment_webhook_events', count(*) FROM tradelog.payment_webhook_events
  UNION ALL SELECT 'user_notification_settings', count(*) FROM tradelog.user_notification_settings;"
```
Expected: 5개 신규 테이블 존재 + 옛 테이블 부재 (`\dt tradelog.*`)
- [ ] **Step 5: 커밋**
```bash
git add -A && git commit -m "refactor(apps): 코어 테이블 리네임 동기화 + V017 rename 마이그레이션 (데이터 보존)"
```

---

## Phase C — template-flutter (클라, notification 경로)

### Task 9: notification 클라 settings 리네임

**Files:**
- Rename: `lib/kits/backend_api_kit/notification_preferences.dart` → `notification_settings.dart`
- Modify: `lib/kits/backend_api_kit/backend_api_kit.dart` (export), `lib/common/providers.dart` (import + provider)

**Interfaces:**
- Produces: 클래스 `NotificationSettings`, 경로 `/me/notification-settings`, provider `notificationSettingsProvider`

- [ ] **Step 1: 파일/클래스/경로/provider 리네임**
```
- 파일: notification_preferences.dart → notification_settings.dart
- 클래스: NotificationPreferences → NotificationSettings
- 경로 문자열: '/me/notification-preferences' → '/me/notification-settings' (2곳: GET, PATCH)
- provider: notificationPreferencesProvider → notificationSettingsProvider
- export(backend_api_kit.dart) / import(common/providers.dart) 갱신
```
확인:
```bash
grep -rn "notification-preferences\|NotificationPreferences\|notificationPreferencesProvider" lib | grep -v /build/   # 0건
```
- [ ] **Step 2: 분석+테스트**
```bash
flutter analyze
flutter test
```
Expected: No issues / All tests passed
- [ ] **Step 3: 커밋**
```bash
git add -A && git commit -m "refactor(backend-api): notification-preferences → notification-settings 경로/클래스"
```

---

## Phase D — 배포 (사용자 push 신호 시에만)

### Task 10: 3레포 push + 동시 배포 + 라이브 검증

> notification 경로 변경 = breaking. **반드시 backend-server 배포와 template-flutter 반영을 함께** 진행 (클라-서버 경로 일치).

- [ ] **Step 1: push** — template-spring `main`, backend-server `develop`, template-flutter (pre-push 훅 통과 확인)
- [ ] **Step 2: dev 배포** — `cd backend-server && ./factory dev deploy -y`
- [ ] **Step 3: 라이브 검증**
```bash
BASE=https://dev-server.storkspear.cloud
# 새 경로 200
curl -s -o /dev/null -w "new path: %{http_code}\n" -X GET "$BASE/api/apps/tradelog/me/notification-settings" -H "Authorization: Bearer <token>"
# 옛 경로 404
curl -s -o /dev/null -w "old path: %{http_code}\n" -X GET "$BASE/api/apps/tradelog/me/notification-preferences" -H "Authorization: Bearer <token>"
# 결제/구독 정상 (회귀)
cd backend-server && ./factory dev test tradelog
```
Expected: new 200, old 404, smoke PASS, 데이터 보존

---

## Self-Review 체크 (작성자)
- **Spec 커버리지**: 5 리네임(Task1–5) + 통합문서(Task6) + tradelog 데이터(Task8) + 클라 경로(Task9) + 배포(Task10) — spec 전 항목 매핑됨 ✓
- **유지 10개 불변**: 각 Task grep 가 옛 이름 0건만 확인, 유지 테이블은 미언급 ✓
- **타입 일관성**: 신규 식별자(PaymentHistory/PaymentHistoryDto/PaymentHistoryStatus, SubscriptionRenewal/SubscriptionRenewalStatus, NotificationSetting, PaymentWebhookEvent, PhoneVerificationCode)가 Task 간 동일 표기 ✓
- **데이터 안전**: V017 = ALTER RENAME(보존), 행수 검증 단계 포함 ✓
- **컬럼 스코프 외**: `payment_record_id` 컬럼명 유지, REFERENCES 타겟만(Task3) — 명시됨 ✓
