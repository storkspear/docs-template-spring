# ADR-022 — IAP Server Notifications (Apple V2 + Google RTDN)

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~7분

**Status**: Accepted. Apple V2 / Google RTDN webhook 을 `IapNotification` 통합 모델로 정규화. `BillingPort.handleIapNotification` 단일 진입점으로 정책 layer 가 platform 무관.

---

## 결론부터

IAP (In-App Purchase) 결제는 *최초 구매 시점* 의 receipt 검증만으로 끝나는 흐름이 아니에요. 사용자가 구독을 결제한 뒤에도 *매월 자동 갱신*, *Apple/Google 측 환불 처리*, *가족 공유 해지로 인한 강제 취소*, *카드 만료로 인한 갱신 실패* 같은 사건들이 *결제 시점 이후* 에 계속 일어납니다. PG 결제는 *우리가 직접 갱신 / 환불 / 취소를 처리* 하지만, IAP 는 *결제 처리 주체가 Apple/Google* 이라 우리가 그 이벤트를 *능동적으로 알아낼 길이 없어요* — Apple App Store 와 Google Play 가 *Server Notification webhook* 으로 백엔드에 통보해 줘야만 인지할 수 있습니다.

본 ADR 은 Apple App Store Server Notifications V2 + Google Play Real-Time Developer Notifications (RTDN) 의 두 webhook 흐름을 통합 처리하는 구조를 정의합니다. 두 platform 의 webhook 은 *형식이 본질적으로 달라요* — Apple 은 JWS (이중 서명) 형태이고, Google 은 Pub/Sub bearer JWT 형태입니다. raw 이벤트 type 도 다르고 (Apple 의 `DID_RENEW` vs Google 의 `SUBSCRIPTION_RENEWED`), 사용자 식별 방식도 다르고 (Apple 의 `originalTransactionId` vs Google 의 `purchaseToken`), 응답 페이로드도 제각각이에요. 이 차이를 *정책 layer (`BillingPort`)* 까지 끌고 가면 비즈니스 코드가 *if (platform == "apple")* 분기로 가득 차버립니다.

해결책은 *통합 모델 + 단일 진입점* 패턴이에요. 두 platform 의 raw webhook 을 각자의 Decoder 가 받아 *공통 `IapNotification` 모델* 로 정규화하고, `BillingPort.handleIapNotification(IapNotification)` 한 메서드가 정책 처리를 담당합니다. 통합 type enum (`DID_RENEW` / `REFUND` / `EXPIRED` / `DID_FAIL_TO_RENEW` / `REVOKE` / `OTHER`) 으로 Apple / Google 의 raw type 을 *비즈니스 의도* 로 추상화하므로, 새 platform (예: Amazon Appstore) 이 추가되어도 *Decoder 만 추가* 하면 정책 layer 는 그대로예요.

이 ADR 의 범위는 통합 모델 설계 (`IapNotification` 의 필드 정의), Apple JWS / Google JWT 검증 메커니즘, user 식별 (`originalTransactionId` / `purchaseToken` 으로 기존 PaymentRecord 조회), webhook 멱등성 보장 (webhook_events 테이블 재활용), 그리고 정책 layer 의 platform 무관성을 보장하는 단일 진입점 패턴까지입니다.

---

## 왜 이런 결정이 필요했나?

IAP 결제는 *결제 시점 이후의 사건* 을 백엔드가 인지할 수 있는 *유일한 채널이 server notification webhook* 이에요. PG 결제는 *우리가 능동적으로 PG API 를 호출해서* 결제 상태 / 환불 / 갱신을 처리할 수 있지만, IAP 는 *Apple / Google 이 결제 주체* 라 우리가 *능동 호출할 API 자체가 없어요*. Apple 의 `Get Transaction Info` API 가 *조회는 가능* 하지만, *언제 갱신이 일어났는지 / 사용자가 환불받았는지* 같은 사건을 *알아낼 트리거* 가 없으면 결국 *주기적 polling* 이 필요한데, 그것도 *수만 사용자의 transaction 을 매시간 조회* 하는 비용이 너무 커요.

server notification 이 그 트리거 역할을 합니다. Apple / Google 이 *사건이 발생한 시점에 webhook 으로 통보* 해 주므로 백엔드는 *그 통보만 정확히 처리* 하면 사용자 권한 관리가 자동화돼요. 통보를 받지 못하면 *사용자가 환불받았는데 우리 시스템에서는 여전히 ACTIVE 인* 상태가 발생하고, *가족 공유로 강제 취소된 구독에서 사용자 권한이 그대로 유지* 되는 정합성 사고가 누적됩니다.

문제는 두 platform 의 *형식이 본질적으로 다르다* 는 점이에요. Apple V2 는 JWS (JSON Web Signature) 의 이중 서명 구조 — *outer signedPayload* 안에 *inner signedTransactionInfo* 가 또 JWS 로 감싸져 있어 두 단계 검증이 필요해요. cert chain (leaf → intermediate → Apple Root CA G3) 검증 + ES256 서명 확인이 둘 다 필요한 *비교적 복잡한* 형태입니다. Google RTDN 은 Pub/Sub 의 bearer JWT 로 도착하는 형태로, Google service account 의 RS256 토큰을 JWKS 공개키로 검증하는 *비교적 간단한* 형태예요. Apple 은 *cert 기반 PKI*, Google 은 *JWKS 기반 OAuth* 라 검증 메커니즘 자체가 다릅니다.

raw 이벤트 type 도 platform 마다 분류가 다릅니다. Apple 은 *DID_RENEW / EXPIRED / REFUND / REVOKE / DID_FAIL_TO_RENEW* 같은 type 을 사용하고, Google 은 *SUBSCRIPTION_RECOVERED / SUBSCRIPTION_RENEWED / SUBSCRIPTION_CANCELED / SUBSCRIPTION_EXPIRED* 같은 다른 분류를 씁니다. 같은 *환불* 사건이라도 Apple 은 `REFUND`, Google 은 `SUBSCRIPTION_REVOKED` 같이 다른 이름을 가져요. 이 차이를 정책 layer 까지 가져가면 *비즈니스 코드가 platform 의 표현 어휘에 종속* 됩니다.

사용자 식별 방식도 platform 마다 달라요. Apple 의 webhook 은 *originalTransactionId* 만 알려주고 *userId 는 포함되지 않아요*. Google 도 마찬가지로 *purchaseToken* 만 알려주고 *Google 계정 ID* 같은 식별자는 들어 있지 않습니다. 따라서 우리 시스템이 *최초 구매 시점에 originalTransactionId / purchaseToken 을 PaymentRecord 에 저장* 해두고, webhook 이 도착하면 *그 ID 로 PaymentRecord 를 조회해서 userId 를 역참조* 하는 흐름이 필요해요.

이 결정이 답해야 할 물음은 이거예요.

> **Apple V2 와 Google RTDN 의 본질적으로 다른 webhook 형식을 어떻게 통합 모델로 정규화해서, 정책 layer (`BillingPort`) 가 platform 분기 없이 처리할 수 있게 할 것인가?**

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

Apple/Google notification 자체에는 user 정보가 없어요 (transactionId / purchaseToken 만 있어요). 우리의 PaymentRecord 에 저장된 `originalTransactionId` (= IAP channel 의 customer_uid 컬럼) 와 매칭하여 user 를 식별합니다:

```java
// Phase 1 의 사전 setup
INSERT INTO payment_records (..., channel='IAP', external_id=originalTxId, customer_uid=originalTxId, ...)

// 갱신 알림 도착 시
PaymentRecord existing = paymentRecordRepository.findByExternalId(originalTransactionId);
long userId = existing.getUserId();
```

→ **사전 조건**: 사용자 첫 구매 시 `IapPort.verifyReceipt` + `activateFromIap` 가 originalTransactionId 를 PaymentRecord 에 저장합니다. (BillingServiceImpl.activateFromIap 가 이미 그렇게 동작해요.)

처음 구매 직후의 갱신 알림이 오기 전에 PaymentRecord 가 반드시 있어야 해요. 보통 Apple/Google 의 첫 영수증 검증은 클라이언트 측에서 즉시 호출되므로 race 가 거의 없어요. 만약 누락되면 log + skip 으로 처리합니다.

---

## 검증

### 시그너처 검증

- **Apple** — D-secure 사이클의 `AppleJwsVerifier` 를 재활용해요. cert chain (leaf → intermediate → Apple Root CA G3) + ES256 으로 검증해요. signedPayload (이중 JWS) 의 outer 와 inner 모두 동일하게 검증합니다.
- **Google** — Pub/Sub push 는 `Authorization: Bearer <JWT>` 로 발송돼요. Google service account 의 RS256 + JWKS 검증이 정석이에요. 본 사이클은 decode 만 다루고, 검증 filter 는 운영 환경에서 별도 추가합니다 (ConditionalOnProperty 옵션화).

### Idempotency

- `webhook_events` 의 `(source, external_id)` UNIQUE 제약을 활용해요. 같은 transactionId 의 두 번째 호출은 markProcessed 만 확인하고 처리를 skip 합니다.
- contract test `duplicateTransactionId_idempotencySkipsSecondCall` 가 검증해요.

### Race / 동시성

- 같은 transactionId 의 동시 webhook 두 건 — 첫 건이 INSERT 성공, 두 번째는 DataIntegrityViolation → 재조회로 흘러요 (PG webhook 패턴과 동일).
- 외부 HTTP 호출 (DID_RENEW 의 verifyReceipt) 은 트랜잭션 밖에서 일어나요 (`@Transactional(NOT_SUPPORTED)`).

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

- 단순해요 — 각 platform 마다 별 method 가 있어요.
- ❌ 정책 layer 가 platform 형식을 알아야 해요 → 채널 분리 (ADR-019) 위반이에요.
- ❌ 새 platform 추가 시 BillingPort 변경이 필요해요 (Stripe 등 추가 시 메소드가 폭증해요).

### 옵션 B — IapNotification 통합 모델 + 단일 진입점 ★ 채택

- Decoder 가 platform-specific decode → 통합 모델로 변환해요
- 정책 layer 는 platform 에 무관하고 type 만 분기해요
- 새 platform 추가 시 Decoder 만 추가하면 돼요 (BillingPort 변경 없음)

### 옵션 C — IapPort.handleNotification (Iap 도메인 안에 정책)

- 채널 도메인이 정책까지 담당하게 돼요.
- ❌ ADR-019 위반 — IAP/PG 채널 + Billing 정책 계층 분리 원칙에 어긋나요.

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
