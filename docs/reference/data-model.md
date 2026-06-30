# 코어 데이터 모델 (15 테이블)

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~12분

## 개요

이 문서는 `new-app.sh` 가 모든 파생 레포에 자동으로 깔아 주는 **코어 15 테이블**을 도메인 5 그룹으로 정리한 카탈로그입니다. 테이블마다 *용도 한 줄 · 주요 컬럼 · FK 관계 · 생성 마이그레이션 V번호 · 관련 ADR* 을 담아, 파생 레포 개발자가 이름만 보고도 무엇을 담는 테이블인지 바로 가늠할 수 있게 했어요. 컬럼/FK/인덱스/V번호는 모두 엔티티 `.java` 와 `tools/new-app/new-app.sh` 의 Flyway heredoc 에서 확인한 값입니다.

## 멀티테넌시 — 테이블은 앱별 schema 에

이 15 테이블은 공유 DB 의 어느 한 곳에 모여 있는 게 아니라, **앱(슬러그)별 PostgreSQL schema** 안에 동일한 구조로 각각 생성됩니다. 한 Postgres 인스턴스에 `app_<slug>` schema 가 앱 수만큼 있고, 같은 `users`·`subscriptions` 테이블이 각 schema 에 따로 존재해요. 런타임에는 [`SchemaRoutingDataSource`](../structure/multitenant-architecture.md) 가 `SlugContext` (ThreadLocal) 의 슬러그 값을 보고 커넥션을 해당 schema 로 라우팅하므로, 서비스 코드는 어느 앱인지 신경 쓰지 않고 INSERT/SELECT 만 합니다. 자세한 배경은 [`ADR-005 · 단일 Postgres + 앱당 schema`](../philosophy/adr-005-db-schema-isolation.md), 라우팅 구현은 [`ADR-018 · SchemaRoutingDataSource`](../philosophy/adr-018-schema-routing-datasource.md), 공유 `core` schema 폐기 경위는 [`ADR-037 · core schema 폐기`](../philosophy/adr-037-core-schema-deprecation.md) 를 참고하세요.

마이그레이션 V001~V016 이 이 15 테이블 + 2FA 컬럼을 만들고, 그 사이의 **V007 은 테이블이 아니라 admin 계정 시드(DML)** 입니다. 파생 레포의 도메인 테이블은 V017 부터 직접 작성해요.

## 전체 테이블 한눈에

| 그룹 | 테이블 | 용도 | 마이그레이션 |
|---|---|---|---|
| Identity | `users` | 사용자 계정 (루트) | V001 (+V013 TOTP 컬럼) |
| Identity | `social_identities` | OAuth 소셜 로그인 연결 | V002 |
| Auth | `refresh_tokens` | JWT refresh 토큰 (회전) | V003 |
| Auth | `email_verification_codes` | 가입 前 이메일 소유확인 코드 | V016 |
| Auth | `email_verification_tokens` | 가입 後 이메일 인증 토큰 (링크) | V004 |
| Auth | `password_reset_tokens` | 비밀번호 재설정 토큰 | V005 |
| Phone | `phone_verification_codes` | 휴대폰 점유인증 OTP (옵트인) | V015 |
| Billing | `plans` | 요금제 카탈로그 (상품 정의) | V008 |
| Billing | `subscriptions` | 사용자 구독 인스턴스 (상태/기간) | V009 |
| Billing | `payment_history` | 결제 이벤트 기록 (PG/IAP) | V009 |
| Billing | `subscription_renewals` | 구독 자동갱신 시도 이력 | V011 |
| Billing | `user_notification_settings` | 사용자 알림 채널 on/off 설정 | V014 |
| Billing | `payment_webhook_events` | 결제 웹훅 idempotency 기록 | V010 |
| Device | `devices` | 푸시 토큰/디바이스 등록 | V006 |
| Audit | `audit_logs` | admin/감사 액션 이력 (append-only) | V012 |

> **공통 컬럼** — `users` · `plans` · `subscriptions` · `payment_history` · `subscription_renewals` · `user_notification_settings` · `payment_webhook_events` · `devices` · `audit_logs` 는 [`BaseEntity`](../philosophy/adr-009-base-entity.md) 를 상속해 `id` (BIGSERIAL PK) · `created_at` · `updated_at` 을 공통으로 가집니다. 토큰/코드 계열(`refresh_tokens` · `*_verification_*` · `password_reset_tokens` · `phone_verification_codes`)은 BaseEntity 를 쓰지 않고 `id` + 자체 `created_at`/`issued_at` 만 두며, `social_identities` 는 복합 PK 라 `id` 자체가 없어요.

> **차기 라운드 메모 — 컬럼명 정리** — 이번 라운드는 *테이블 이름*만 컨벤션에 맞췄고, 일부 *컬럼/제약 이름*에는 잔여 불일치가 남아 있어요. (1) `subscriptions.payment_record_id` 와 `subscription_renewals.payment_record_id` 는 컬럼 이름을 유지한 채 새 테이블 `payment_history(id)` 를 참조합니다 — 정합한 이름은 `payment_history_id` 지만, FK 컬럼 리네임은 다음 라운드로 미뤘어요. (2) `payment_webhook_events` 의 UNIQUE 제약은 엔티티가 `uq_payment_webhook_events_source_external` 로 선언하지만, 실제 DB(마이그레이션)는 `uk_payment_webhook_events_external_id` 이름으로 만듭니다 — 컬럼 구성 `(source, external_id)` 은 동일하고 이름만 달라요.

---

## 1. Identity — 사용자 정체성

### `users` (V001, +V013)

사용자 계정의 루트 테이블입니다. 소셜 전용 가입은 `password_hash` 가 null 이에요.

- **주요 컬럼**: `email` · `password_hash` (소셜은 null) · `display_name` · `nickname` · `email_verified` · `is_premium` · `role` (기본 `'user'`) · `deleted_at` (soft delete). V013 이 2FA 컬럼 `totp_secret` · `totp_enabled` · `totp_backup_codes` 를 추가합니다.
- **FK**: 없음 (루트).
- **인덱스**: `uk_users_email_active` — `email` UNIQUE 이되 `WHERE deleted_at IS NULL` 부분 인덱스라 soft-delete 후 같은 이메일 재가입을 허용해요. `idx_users_email`, `idx_users_totp_enabled` (`WHERE totp_enabled = true`, V013).
- **관련 ADR**: [`ADR-012 · 앱별 독립 유저 모델`](../philosophy/adr-012-per-app-user-model.md), [`ADR-009 · BaseEntity`](../philosophy/adr-009-base-entity.md), [`ADR-029 · 비밀번호 정책`](../philosophy/adr-029-password-policy.md), [`ADR-030 · 2FA TOTP`](../philosophy/adr-030-2fa-totp.md).

### `social_identities` (V002)

OAuth 소셜 로그인(애플·구글·카카오·네이버)과 사용자를 잇는 연결 테이블입니다. 휴대폰 점유인증도 `provider='phone'` 으로 이 테이블을 재사용해요.

- **주요 컬럼**: `provider` (예: apple/google/kakao) · `provider_id` (provider 측 사용자 식별자) · `user_id` · `created_at`. 복합 **PK `(provider, provider_id)`** 라 같은 provider 의 같은 계정은 한 번만 연결됩니다.
- **FK**: `user_id` → `users(id)`.
- **인덱스**: `idx_social_identities_user_id`.
- **관련 ADR**: [`ADR-017 · OAuth 2.0 통합`](../philosophy/adr-017-oauth-integration.md), [`ADR-012`](../philosophy/adr-012-per-app-user-model.md). 휴대폰 재사용은 [`ADR-038`](../philosophy/adr-038-sms-phone-auth.md).

---

## 2. Auth · Credential — 인증·자격증명

토큰/코드 계열은 raw 값을 DB 에 저장하지 않고 **SHA-256 hex(64 chars)** 해시만 보관합니다. raw 토큰은 클라이언트(또는 이메일/문자)에만 한 번 전달돼요.

### `refresh_tokens` (V003)

JWT refresh 토큰의 회전(rotation)을 지원하는 테이블입니다. 한 번 쓴 토큰을 다시 쓰면 탈취로 판정해 family 전체를 무효화해요.

- **주요 컬럼**: `token_hash` (SHA-256 hex, deterministic → indexed lookup) · `family_id` (회전 체인 추적 UUID) · `issued_at` · `expires_at` · `used_at` (회전 시 셋) · `revoked_at` (명시적 무효화).
- **FK**: `user_id` → `users(id)`.
- **인덱스**: `uk_refresh_tokens_hash` (UNIQUE `token_hash`), `idx_refresh_tokens_user_id`, `idx_refresh_tokens_family_id`.
- **관련 ADR**: [`ADR-006 · HS256 JWT`](../philosophy/adr-006-hs256-jwt.md).

### `email_verification_codes` (V016)

가입 **前** 이메일 소유를 확인하는 6자리 코드(verify-before-signup)예요. 계정 생성 전에 발급되므로 `user_id` FK 가 없고 email 로만 식별합니다.

- **주요 컬럼**: `email` · `code_hash` (SHA-256 hex) · `attempts` (오답 횟수 제한) · `expires_at` · `used_at`.
- **FK**: 없음 (email 로만 식별).
- **인덱스**: `idx_email_verification_codes_email_created` (`email`, `created_at DESC`), `idx_email_verification_codes_expires_at`.
- **관련 ADR**: 전용 ADR 없음 (이메일 인증 흐름의 일부). `email_verification_tokens` 와 단계가 다른 점에 유의하세요.

### `email_verification_tokens` (V004)

가입 **後** 이메일 인증(링크 클릭 방식) 토큰입니다. `email_verification_codes`(가입 전 코드)와 단계를 구분하려고 별도 테이블로 둡니다.

- **주요 컬럼**: `token_hash` (SHA-256 hex) · `created_at` · `expires_at` · `used_at`.
- **FK**: `user_id` → `users(id)`.
- **인덱스**: `uk_email_verification_tokens_hash` (UNIQUE), `idx_email_verification_tokens_user_id`.
- **관련 ADR**: 전용 ADR 없음.

### `password_reset_tokens` (V005)

비밀번호 재설정 토큰입니다. 1회용(`used_at`) + 만료(`expires_at`) 로 보호해요.

- **주요 컬럼**: `token_hash` (SHA-256 hex) · `created_at` · `expires_at` · `used_at`.
- **FK**: `user_id` → `users(id)`.
- **인덱스**: `uk_password_reset_tokens_hash` (UNIQUE), `idx_password_reset_tokens_user_id`.
- **관련 ADR**: [`ADR-029 · 비밀번호 정책`](../philosophy/adr-029-password-policy.md).

---

## 3. Phone — 휴대폰 본인확인

### `phone_verification_codes` (V015, 옵트인)

휴대폰 점유인증 OTP 코드 테이블입니다. raw 6자리는 문자로만 전달하고 DB 에는 SHA-256 hex 만 저장해요. 점유인증을 쓰지 않는 앱은 V015 파일을 삭제하면 됩니다. (email 은 `email_verification_*`, phone 도 이제 `phone_verification_*` 으로 `*_verification_*` 컨벤션을 통일했어요.)

- **주요 컬럼**: `phone_e164` (E.164 번호) · `code_hash` (SHA-256 hex) · `attempts` (SMALLINT, brute-force 가드) · `expires_at` · `used_at`.
- **FK**: 없음 — 번호↔유저 식별은 `social_identities(provider='phone')` 를 재사용하고, 이 테이블은 OTP 수명만 관리합니다.
- **인덱스**: `idx_phone_verification_codes_phone_created` (`phone_e164`, `created_at DESC`) — "번호의 최신 미사용 코드" 조회와 발송 rate-limit 윈도우 카운트를 모두 커버.
- **관련 ADR**: [`ADR-038 · SMS + 휴대폰 점유인증`](../philosophy/adr-038-sms-phone-auth.md), [`ADR-013 · 앱별 인증 엔드포인트(공유 컨트롤러)`](../philosophy/adr-013-per-app-auth-endpoints.md).

---

## 4. Billing — 구독·결제·알림

### `plans` (V008)

요금제 **카탈로그**(상품 정의) 테이블입니다. 사용자 구독 인스턴스인 `subscriptions` 와는 다른 역할이에요. `new-app.sh` 가 `free` plan 과 샘플 `PRO` plan 을 seed 합니다.

- **주요 컬럼**: `code` (UNIQUE) · `name` · `price_krw` · `duration_days` (nullable) · `description` · `active`.
- **FK**: 없음.
- **인덱스**: `uk_plans_code` (UNIQUE `code`), `idx_plans_active`.
- **관련 ADR**: [`ADR-020 · 구독 도메인 모델`](../philosophy/adr-020-subscription-domain-model.md), [`ADR-019 · billing/iap/payment 분리`](../philosophy/adr-019-billing-iap-payment-separation.md).

### `subscriptions` (V009)

사용자별 구독 인스턴스(어떤 plan / 언제 시작·만료 / 현재 상태)를 담습니다.

- **주요 컬럼**: `status` (`ACTIVE`/`CANCELLED`/`EXPIRED`) · `started_at` · `expires_at` · `cancelled_at` · `cancel_reason` · `payment_record_id`.
- **FK**: `user_id` → `users(id)`, `plan_id` → `plans(id)`, `payment_record_id` → `payment_history(id)` (컬럼 이름은 유지 — 위 차기 라운드 메모 참고).
- **인덱스**: `idx_subscriptions_user_id`, `idx_subscriptions_status`, `idx_subscriptions_user_status` (`user_id`, `status`).
- **관련 ADR**: [`ADR-020`](../philosophy/adr-020-subscription-domain-model.md), [`ADR-021 · 자동 갱신 실패 정책`](../philosophy/adr-021-renewal-failure-policy.md).

### `payment_history` (V009)

결제 이벤트 기록입니다. PG(PortOne) 결제와 IAP(Apple·Google) 결제를 `channel` 로 구분해 한 테이블에 담아요. 별도 *결제수단* 테이블이 없는 건 의도된 설계예요 — IAP/PG 측이 결제수단을 소유하므로 카드 정보를 직접 보관하지 않아 PCI 부담을 피합니다.

- **주요 컬럼**: `channel` (`PG`/`IAP`) · `external_id` (UNIQUE) · `amount` · `currency` (기본 `KRW`) · `status` (`PAID`/`FAILED`/`CANCELLED`/`REFUNDED`) · `paid_at` · `refunded_at` · `customer_uid` (PortOne 빌링키, one-time 결제는 null) · `raw_response` (jsonb).
- **FK**: `user_id` → `users(id)`.
- **인덱스**: `uk_payment_history_external_id` (UNIQUE), `idx_payment_history_user_id`, `idx_payment_history_status`, `idx_payment_history_customer_uid` (`WHERE customer_uid IS NOT NULL`).
- **관련 ADR**: [`ADR-019`](../philosophy/adr-019-billing-iap-payment-separation.md), [`ADR-022 · IAP Server Notifications`](../philosophy/adr-022-iap-server-notifications.md).

### `subscription_renewals` (V011)

구독 자동 갱신 시도 이력입니다. 한 번의 재청구(성공/실패)마다 row 1개로, retry·backoff·운영 디버깅에 쓰여요. (`FAILED` → `next_retry_at` 도래 → 재시도 → `SUCCESS` 또는 `ABANDONED`.)

- **주요 컬럼**: `attempt_no` (1부터 단조증가) · `attempted_at` · `next_retry_at` · `status` (`SUCCESS`/`FAILED`/`ABANDONED`) · `error_code` · `error_message` · `payment_record_id` (SUCCESS 시 새 결제건 id).
- **FK**: `subscription_id` → `subscriptions(id)`, `payment_record_id` → `payment_history(id)`.
- **인덱스**: `idx_subscription_renewals_subscription_id`, `idx_subscription_renewals_status`, `idx_subscription_renewals_due` (`WHERE status = 'FAILED' AND next_retry_at IS NOT NULL` — retry scheduler 핵심), `uk_subscription_renewals_subscription_attempt` (UNIQUE `subscription_id`, `attempt_no`).
- **관련 ADR**: [`ADR-021 · 자동 갱신 실패 정책`](../philosophy/adr-021-renewal-failure-policy.md).

### `user_notification_settings` (V014)

사용자별 알림 종류(`NotificationKind`)마다 push/email 채널을 켜고 끄는 설정 테이블입니다. 행이 없으면 **enabled 가 기본**이라, 명시적으로 off 하지 않으면 알림을 받아요. REST 는 `GET /me/notification-settings`, `PATCH /me/notification-settings/{kind}` 입니다.

- **주요 컬럼**: `kind` (`NotificationKind` enum) · `push_enabled` (기본 true) · `email_enabled` (기본 true).
- **FK**: `user_id` → `users(id)`.
- **인덱스**: `uk_user_notification_settings_user_kind` (UNIQUE `user_id`, `kind`), `idx_user_notification_settings_user_id`.
- **관련 ADR**: [`ADR-031 · 사용자 알림 설정`](../philosophy/adr-031-notification-preferences.md).

### `payment_webhook_events` (V010)

결제 웹훅의 멱등성(idempotency)을 보장하는 기록 테이블입니다. `(source, external_id)` UNIQUE 가 같은 웹훅의 중복 처리를 차단해요. `source` 는 PG 가 `portone`, IAP 는 `iap-ios`/`iap-android` 입니다.

- **주요 컬럼**: `source` (기본 `'portone'`) · `external_id` · `payload` (jsonb, NOT NULL) · `received_at` · `processed_at` · `process_error` (실패 시 디버깅용, retry 허용).
- **FK**: 없음.
- **인덱스**: `uk_payment_webhook_events_external_id` (UNIQUE `(source, external_id)`), `idx_payment_webhook_events_received_at`.
- **관련 ADR**: [`ADR-022 · IAP Server Notifications`](../philosophy/adr-022-iap-server-notifications.md), [`ADR-020`](../philosophy/adr-020-subscription-domain-model.md).

---

## 5. Device · Audit — 디바이스·감사

### `devices` (V006)

푸시 알림 전송용 디바이스/토큰 등록 테이블입니다. 유저 한 명이 여러 디바이스를 가질 수 있어요.

- **주요 컬럼**: `app_slug` · `platform` · `push_token` (FCM 토큰) · `device_name` · `last_seen_at`.
- **FK**: `user_id` → `users(id)`.
- **인덱스**: `idx_devices_user_id`, `idx_devices_push_token`.
- **관련 ADR**: [`ADR-023 · 결제 알림 listener (push)`](../philosophy/adr-023-billing-notification-listener.md) — 알림 발송이 이 `push_token` 을 사용해요.

### `audit_logs` (V012)

`@Audited` / `@AdminOnly` 액션을 자동 기록하는 감사 이력(append-only)입니다. AOP `@Around` + `Propagation.REQUIRES_NEW` 로 비즈 트랜잭션과 격리돼요. 현재는 admin 환불(`PaymentController.refund`)만 기록되는 *대기 중 인프라* 라, admin 기능이 늘면 자연스럽게 확장됩니다.

- **주요 컬럼**: `actor_user_id` (시스템 액션 시 null) · `actor_email` (유저 삭제 후에도 보존) · `action` · `resource_type` · `resource_id` · `slug` · `result` (`SUCCESS`/`FAILURE`) · `details` (jsonb) · `ip_address` · `occurred_at`.
- **FK**: 없음 — `actor_user_id` 는 FK 를 두지 않아 유저가 삭제돼도 감사 기록이 남습니다.
- **인덱스**: `idx_audit_logs_actor_user_id`, `idx_audit_logs_action`, `idx_audit_logs_occurred_at` (`occurred_at DESC`), `idx_audit_logs_resource` (`resource_type`, `resource_id` · `WHERE resource_id IS NOT NULL`).
- **관련 ADR**: [`ADR-028 · Audit log 도메인`](../philosophy/adr-028-audit-log-domain.md), [`ADR-027 · Admin role 권한`](../philosophy/adr-027-admin-role-authorization.md).

---

## 관련 문서

- [`Multi-tenant Architecture`](../structure/multitenant-architecture.md) — per-app schema 라우팅 구현 패턴
- [`JWT Authentication`](../structure/jwt-authentication.md) — 토큰 발급/검증 흐름 (`refresh_tokens` 와 짝)
- [`코어 REST API 카탈로그`](./api/README.md) — 위 테이블을 노출하는 엔드포인트 목록
- [`용어집`](./glossary.md) — Idempotency key, appSlug 등 용어 정의
- [`ADR-005`](../philosophy/adr-005-db-schema-isolation.md) · [`ADR-018`](../philosophy/adr-018-schema-routing-datasource.md) · [`ADR-037`](../philosophy/adr-037-core-schema-deprecation.md) — 멀티테넌시 설계 결정
