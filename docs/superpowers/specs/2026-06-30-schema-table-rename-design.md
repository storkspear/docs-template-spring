# 스키마 테이블 네이밍 정리 + 통합 데이터 모델 문서 — Design

> **작성일**: 2026-06-30 · **상태**: 설계 승인 대기 · **범위**: template-spring(소스) + backend-server(tradelog) + template-flutter(클라)

## 1. 배경 / 문제

코어 15개 테이블 중 일부는 **이름만으로 용도 유추가 안 돼요** — `webhook_events`, `renewal_attempts`, `payment_records` 등은 도메인을 모르면 무엇인지 알 수 없고, 본인확인 계열은 **컨벤션이 제각각**이에요 (`phone_otp_codes` vs `email_verification_codes` vs `password_reset_tokens` — otp/verification/reset + codes/tokens 혼재). 게다가 테이블↔엔티티 클래스명이 안 맞는 경우도 있어요 (`user_notification_preferences` 테이블 ↔ `NotificationPreference` 클래스).

또한 **"모든 테이블 + 용도 + 도메인 그룹"을 한곳에 정리한 레퍼런스 문서가 없어요.** 설명이 ADR(adr-012/022/028)·functional 문서·naming.md 에 흩어져 있어요.

**목표**: (1) 유추 가능·일관된 이름으로 5개 테이블을 **테이블/엔티티/DTO/문서까지 일관 리네임**, (2) 통합 `data-model.md` 작성.

## 2. 결정 (확정)

### 2.1 리네임 5개 (3계층)

| 테이블 | 엔티티 클래스 | 부속(DTO·enum·repo·service·controller) |
|---|---|---|
| `phone_otp_codes` → `phone_verification_codes` | `PhoneOtpCode` → `PhoneVerificationCode` | 관련 repo/service |
| `renewal_attempts` → `subscription_renewals` | `RenewalAttempt` → `SubscriptionRenewal` | `RenewalAttemptStatus` → `SubscriptionRenewalStatus` |
| `user_notification_preferences` → `user_notification_settings` | `NotificationPreference` → `NotificationSetting` | `NotificationPreference{Dto,Repository,Service,Controller,UpdateRequest}` → `NotificationSetting…` |
| `payment_records` → `payment_history` | `PaymentRecord` → `PaymentHistory` | `PaymentRecordDto` → `PaymentHistoryDto`, `PaymentRecordStatus` → `PaymentHistoryStatus` |
| `webhook_events` → `payment_webhook_events` | `WebhookEvent` → `PaymentWebhookEvent` | 관련 repo |

### 2.2 notification: **끝까지 일관 (클라 포함)**
`user_notification_settings` 로 바꾸는 김에 **API 경로도** `/me/notification-preferences` → `/me/notification-settings` 로 변경해요. 이건 **client-breaking** 이라 template-flutter 의 `backend_api_kit/notification_preferences.dart` 도 같이 수정 + **3레포 동시 배포** 필요해요. (다른 4개 리네임은 경로에 옛 테이블명이 없어 클라 무영향.)

### 2.3 유지 10개 (이 라운드 기준)
`users`, `social_identities`, `refresh_tokens`, `email_verification_codes`, `email_verification_tokens`, `password_reset_tokens`, `plans`, `subscriptions`, `devices`, `audit_logs` — 도메인 표준 용어거나 이미 명확해서 그대로 둬요 (바꾸면 옆그레이드).

- `plans`≠`subscriptions` (카탈로그 vs 가입 인스턴스), `audit_logs`(admin/@Audited 액션 append-only — 현재는 admin 환불만 기록되는 idle 인프라지만 유지), `email_verification_codes`(가입前 6자리)/`email_verification_tokens`(가입後 토큰)는 codes/tokens 로 이미 구분됨.

> **후속 라운드 (2026-07-01)**: 위 "유지" 목록 중 auth 계열 6개와 `plans` 는 이후 `auth_` 접두사·`subscription_` 접두사 라운드에서 추가 리네임됐어요. `social_identities`→`auth_social_identities`, `refresh_tokens`→`auth_refresh_tokens`, `email_verification_codes`→`auth_email_verification_codes`, `email_verification_tokens`→`auth_email_verification_tokens`, `password_reset_tokens`→`auth_password_reset_tokens`, `plans`→`subscription_plans`, 그리고 이 라운드에서 리네임된 `phone_verification_codes`→`auth_phone_verification_codes`. 현재 스키마는 [`data-model`](../../reference/data-model.md) 을 참고하세요.

### 2.4 스코프 외 (이번 라운드 제외)
**컬럼명은 안 건드려요.** 특히 FK 컬럼 `payment_record_id` (`subscriptions`·`subscription_renewals` 에 존재)는 이름 유지하되 `REFERENCES payment_history(id)` 로 **타겟만 갱신**해요. 컬럼명 정리는 별도 라운드(잔여 불일치 인지함).

## 3. 통합 문서: `docs/reference/data-model.md`

`reference/` 에 glossary·api 와 나란히 신규 작성. 구조:
- 도메인 5그룹 (Identity / Auth·Credential / Phone / Billing / Device·Audit)
- 그룹별 테이블: **용도 1줄 · 주요 컬럼 · 관계(FK) · 관련 ADR · 생성 마이그레이션 V번호**
- per-app schema 라우팅 설명 (`SchemaRoutingDataSource`, ADR-005/037) 링크
- 본 리네임 반영된 **신규 이름** 기준으로 작성

## 4. 블래스트 인벤토리

### template-spring (소스)
- **엔티티/부속**: PhoneOtpCode(~5파일), RenewalAttempt+Status(~8), NotificationPreference 일가(~10: entity/repo/service/controller/dto/updateRequest/test/listener), PaymentRecord+Dto+Status(~20, billing-api·impl + iap-api·impl + audit + common), WebhookEvent(~6)
- **`new-app.sh`**: V009(payment_records,+subscriptions FK)/V010(webhook_events)/V011(renewal_attempts,+payment FK)/V014(user_notification_preferences)/V015(phone_otp_codes) 의 CREATE TABLE + 인덱스/제약명(`uk_*`,`idx_*`) 새 이름
- **ApiEndpoints / 경로 상수**: notification 경로 → settings
- **docs**: 옛 이름 참조 — webhook_events 12 · phone_otp_codes 11 · renewal_attempts 9 · payment_records 7 · user_notification_preferences 3 파일 (중복 제외 ~15–20 문서) 정정

### backend-server (tradelog)
- 위 코드 전부 **동기화**
- **`V017__rename_tables.sql`** (신규): `ALTER TABLE … RENAME TO` ×5 + `ALTER INDEX/CONSTRAINT … RENAME` + FK `REFERENCES` 갱신. **실데이터 보존** (rename 은 재생성 아님)

### template-flutter (클라)
- `lib/kits/backend_api_kit/notification_preferences.dart` → `notification_settings.dart`: 클래스 `NotificationPreferences`→`NotificationSettings`, 경로 `/me/notification-settings`, provider `notificationPreferencesProvider`→`notificationSettingsProvider`, export(`backend_api_kit.dart`)·import(`common/providers.dart`) 갱신

## 5. 마이그레이션 전략
- **신규 앱**: `new-app.sh` 가 처음부터 새 이름으로 생성 (태생 일관)
- **기존 앱(tradelog)**: V017 `ALTER … RENAME` — 테이블·인덱스(`idx_payment_records_*`→`idx_payment_history_*` 등)·UNIQUE(`uk_*`)·FK 타겟. pkey 는 PG 가 유지(필요 시 rename)
- **@Table**: 새 이름 (신규·기존 양쪽 일치 보장)

## 6. 시퀀싱 (rollout)
1. **template-spring**: 엔티티/DTO/enum/repo/service/controller/ApiEndpoints/new-app.sh 리네임(IDE refactor) + `data-model.md` 신규 + docs 정정 → gradle build+test 그린 → 커밋
2. **backend-server**: 동기화 + `V017` 작성 → build+test
3. **template-flutter**: notification settings 리네임 → `flutter analyze` + `flutter test`
4. **(사용자 push 신호 시)**: 3레포 push → dev 배포 → 라이브 검증

## 7. 검증
- spring: gradle `build`+`test` (entity/repo/contract/FeatureToggle), spotless. ApiEndpoints 경로 = `/me/notification-settings`
- tradelog: V017 적용 후 **5개 테이블 행수 보존** 확인(rename=데이터 유지) + smoke
- flutter: `flutter analyze` + `flutter test`
- 라이브(dev): `GET /me/notification-settings` 200, 옛 경로 404 / `payment_webhook_events` 등 신규 테이블에 webhook 기록 정상

## 8. 리스크 / 주의
- **notification 경로 = breaking** → template-spring·backend-server·template-flutter **동시 배포** 필수 (안 그러면 클라-서버 경로 어긋남)
- **PaymentRecord(~20파일)** — IDE 일괄 리네임, 누락은 컴파일 에러로 잡힘(안전). 단 javadoc 내 "PaymentRecord" 텍스트도 정정
- **데이터 안전** — `ALTER TABLE RENAME` 은 데이터 보존 (drop/recreate 아님)
- **컬럼 `payment_record_id` 잔여 불일치** — 의도적(컬럼 스코프 제외). data-model.md 에 "차기 컬럼 라운드" 메모

## 9. 비목표 (Non-goals)
- 컬럼명 리네임, 인덱스 정책 변경, 새 테이블 추가(payment_methods 등 — IAP/PG가 결제수단 소유, PCI 회피로 의도적 부재), 빌링 모델 재설계
