# ADR-022 — IAP Server Notifications (Apple V2 + Google RTDN)

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~7분

**상태**: 채택 (2026-05-02)
**전제**: ADR-019 (billing/iap/payment 분리), ADR-020 (subscription 도메인 모델), D-secure (Apple JWS 검증), H 사이클 (PG 갱신 정책)
**연관**: I 사이클 — IAP 갱신/취소 자동 처리

---

## 결론부터

Apple App Store Server Notifications V2 + Google Play Real-Time Developer Notifications (RTDN) webhook 을 통합 처리. Apple/Google 의 raw 이벤트 type (예: `DID_RENEW` / `EXPIRED` / `REFUND` / `REVOKE`) 을 본 레포의 *통합 type* (8 개) 로 매핑해 같은 listener 가 두 channel 처리.

`DID_RENEW` 같은 갱신 이벤트는 user 식별 정보를 포함하지 않으므로 *originalTransactionId* / *purchaseToken* 으로 기존 PaymentRecord 조회 후 user 추적. webhook 중복은 `(source, externalId)` UNIQUE 로 차단.

---

## 배경

D 사이클 = IAP **영수증 검증** (사용자 결제 직후 1회 호출). 그러나 **갱신 / 환불 / 취소** 는 Apple/Google 이 백엔드에 직접 webhook (server notification) 보냄 — 받지 않으면 우리는 영구 모름.

PG 갱신은 H 사이클 (chargeAgain + retry) 로 해결. IAP 는 백엔드가 직접 결제 못함 (카드 정보를 우리가 안 받음) → webhook 만이 유일한 갱신 경로.

본 ADR 은 두 가지 다른 형식 (Apple V2 JWS / Google RTDN Pub/Sub) 을 통합 모델로 정규화하여 비즈니스 로직 layer (BillingPort) 를 platform 무관하게 만드는 결정.

---

## 결정

| 항목 | 값 | 사유 |
|---|---|---|
| **통합 모델** | `IapNotification` (platform/type/transactionId/originalTxId/productId/...) | 정책 layer (BillingPort) 가 platform 분기 안 함 |
| **통합 type enum** | `IapNotificationType` (DID_RENEW/REFUND/EXPIRED/DID_FAIL_TO_RENEW/REVOKE/OTHER) | Apple/Google raw type 을 비즈니스 의도로 추상화 |
| **Apple endpoint** | `/api/apps/<slug>/iap/apple/webhook` (per-slug — bundle_id 매칭) | ADR-020 의 슬러그별 schema 격리 정합 |
| **Google endpoint** | `/api/apps/<slug>/iap/google/webhook` | 동일 |
| **Apple 검증** | `AppleJwsVerifier` 재활용 (cert chain + ES256) | D-secure 이미 구현 |
| **Google 검증** | Pub/Sub bearer token (별도 filter, 옵션) | 운영 시 추가, 본 사이클은 decode 만 |
| **진입점** | `BillingPort.handleIapNotification(IapNotification)` | PG webhook (`handleWebhook`) 와 분리 — 형식 너무 다름 |
| **Idempotency** | webhook_events 테이블 재활용 (source="iap-ios"/"iap-android", externalId=transactionId) | ADR-020 의 동일 mechanism |

---

## 통합 type 매핑

### Apple App Store Server Notifications V2

| Apple raw type | 통합 enum | 동작 |
|---|---|---|
| `DID_RENEW` | DID_RENEW | activateFromIap (새 sub) |
| `SUBSCRIBED` (subtype=RESUBSCRIBE) | DID_RENEW | 동일 |
| `REFUND` | REFUND | record.markRefunded + sub.cancel |
| `EXPIRED` | EXPIRED | noop (cron 처리) |
| `DID_FAIL_TO_RENEW` | DID_FAIL_TO_RENEW | log only (Apple 자동 재시도) |
| `REVOKE` | REVOKE | sub.cancel (가족 공유 해지 등) |
| 기타 | OTHER | log only |

### Google Play Real-time Developer Notifications

| Google raw type (int) | 통합 enum | 동작 |
|---|---|---|
| 1 (RECOVERED), 2 (RENEWED), 7 (RESTARTED) | DID_RENEW | activateFromIap |
| 3 (CANCELED) | REVOKE | sub.cancel (만료까지 권한 유지) |
| 4 (PURCHASED) | OTHER | 신규 구매는 IapPort.verifyReceipt 별도 흐름 |
| 5 (ON_HOLD), 6 (IN_GRACE_PERIOD) | DID_FAIL_TO_RENEW | log only |
| 12 (REVOKED) | REFUND | record.markRefunded + sub.cancel |
| 13 (EXPIRED) | EXPIRED | noop |

---

## 흐름

```
[Apple/Google]
     │ POST signedPayload (Apple) / Pub/Sub message (Google)
     ▼
[/iap/apple/webhook] [/iap/google/webhook]
   IapController (per-app)
     │
     ▼ AppleNotificationDecoder.decode (cert chain + ES256)
       GoogleNotificationDecoder.decode (base64 → JSON)
     ▼
  IapNotification (통합 모델)
     │
     ▼
BillingPort.handleIapNotification(notification)
     │
     ├── Phase 1 (write TX): webhook_events INSERT (idempotency)
     │     이미 처리됐으면 skip
     ▼
  type 별 분기 (NOT_SUPPORTED outer + 내부 phase TX)
     │
     ┌── DID_RENEW → IapPort.verifyReceipt + activateFromIap
     ├── REFUND → record.markRefunded + sub.cancel("iap_refund")
     ├── REVOKE → sub.cancel("iap_revoke") (record 는 그대로)
     ├── EXPIRED → noop (cron 처리)
     ├── DID_FAIL_TO_RENEW → log only
     └── OTHER → log only
     │
     ▼
  webhook_events.markProcessed (TX)
```

---

## DID_RENEW 의 user 식별

Apple/Google notification 자체에는 user 정보 없음 (transactionId / purchaseToken 만). 우리의 PaymentRecord 에 저장된 `originalTransactionId` (= IAP channel 의 customer_uid 컬럼) 와 매칭하여 user 식별:

```java
// Phase 1 의 사전 setup
INSERT INTO payment_records (..., channel='IAP', external_id=originalTxId, customer_uid=originalTxId, ...)

// 갱신 알림 도착 시
PaymentRecord existing = paymentRecordRepository.findByExternalId(originalTransactionId);
long userId = existing.getUserId();
```

→ **사전 조건**: 사용자 첫 구매 시 `IapPort.verifyReceipt` + `activateFromIap` 가 originalTransactionId 를 PaymentRecord 에 저장. (BillingServiceImpl.activateFromIap 가 이미 그렇게 동작.)

처음 구매 직후의 갱신 알림이 오기 전에 PaymentRecord 가 반드시 있어야 함. 보통 Apple/Google 의 첫 영수증 검증은 클라이언트 측에서 즉시 호출되므로 race 거의 없음. 만약 누락되면 log + skip.

---

## 검증

### 시그너처 검증

- **Apple** — D-secure 사이클의 `AppleJwsVerifier` 재활용. cert chain (leaf → intermediate → Apple Root CA G3) + ES256. signedPayload (이중 JWS) 의 outer 와 inner 모두 동일 검증.
- **Google** — Pub/Sub push 는 `Authorization: Bearer <JWT>` 로 발송. Google service account 의 RS256 + JWKS 검증이 정도. 본 사이클은 decode 만, 검증 filter 는 운영 환경에서 별도 추가 (ConditionalOnProperty 옵션화).

### Idempotency

- `webhook_events` 의 `(source, external_id)` UNIQUE 제약. 같은 transactionId 의 두 번째 호출은 markProcessed 만 확인하고 처리 skip.
- contract test `duplicateTransactionId_idempotencySkipsSecondCall` 가 검증.

### Race / 동시성

- 같은 transactionId 의 동시 webhook 두 건 — 첫 건이 INSERT 성공, 두 번째는 DataIntegrityViolation → 재조회 (PG webhook 패턴 동일).
- 외부 HTTP 호출 (DID_RENEW 의 verifyReceipt) 은 트랜잭션 밖 (`@Transactional(NOT_SUPPORTED)`).

---

## Contract Test (5개)

`AbstractBillingPortContractTest$HandleIapNotification`:

1. `didRenew_verifyReceiptValid_createsNewSubscription` — DID_RENEW 흐름 (verifyReceipt + activateFromIap)
2. `refund_marksRefundedAndCancelsSubscription` — REFUND 흐름
3. `revoke_cancelsSubscriptionWithoutRefundMark` — REVOKE 는 record 그대로
4. `duplicateTransactionId_idempotencySkipsSecondCall` — 중복 호출 차단
5. `expired_isNoop` — EXPIRED 는 record/sub 변화 X

---

## 대안 비교

### 옵션 A — platform 별 BillingPort 메소드 (handleAppleNotification / handleGoogleNotification)

- 단순 — 각 platform 마다 별 method.
- ❌ 정책 layer 가 platform 형식 알아야 → 채널 분리 (ADR-019) 위반.
- ❌ 새 platform 추가 시 BillingPort 변경 (Stripe 등 추가 시 메소드 폭증).

### 옵션 B — IapNotification 통합 모델 + 단일 진입점 ★ 채택

- Decoder 가 platform-specific decode → 통합 모델
- 정책 layer 는 platform 무관, type 만 분기
- 새 platform 추가 시 Decoder 만 추가 (BillingPort 변경 없음)

### 옵션 C — IapPort.handleNotification (Iap 도메인 안에 정책)

- 채널 도메인이 정책까지 담당.
- ❌ ADR-019 위반 — IAP/PG 채널 + Billing 정책 계층 분리 원칙.

---

## 안 다루는 범위 (다음 사이클)

- **Pub/Sub bearer token 검증 filter** — 운영 시 별도 filter 추가 (옵션화)
- **Notification dead-letter** — 처리 실패 시 재시도 정책 (Apple/Google 가 자동 재시도하지만 우리 처리 실패 추적 필요)
- **IAP renewal failure listener** — DID_FAIL_TO_RENEW 받았을 때 사용자 알림 (push/email)
- **Apple 가족 공유 / 구독 그룹 변경** — REVOKE 의 sub-type 별 분기

---

## 관련 파일

- `core/core-iap-api/.../IapNotificationType.java` — 통합 enum
- `core/core-iap-api/.../dto/IapNotification.java` — 통합 모델
- `core/core-iap-impl/.../AppleNotificationDecoder.java` — Apple V2 signedPayload 디코더
- `core/core-iap-impl/.../GoogleNotificationDecoder.java` — Google RTDN Pub/Sub 디코더
- `core/core-billing-impl/.../BillingServiceImpl.java#handleIapNotification` — 통합 진입점
- `tools/new-app/new-app.sh` — IapController heredoc 의 webhook endpoints
