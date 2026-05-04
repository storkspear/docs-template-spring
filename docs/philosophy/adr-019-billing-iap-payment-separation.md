# ADR-019 · billing / iap / payment 도메인 분리

**Status**: Accepted. 2026-05-01 기준 결제 관련 코어 모듈을 3개 도메인으로 분리했어요. `core-billing` 을 3 도메인 (billing / iap / payment) 으로 분리한 이유: IAP receipt 검증 + subscription 정책 + PG 결제가 단일 모듈에 혼재할 때 책임 경계가 모호해지기 때문이에요.

> **유형**: ADR · **독자**: Level 2 · **읽는 시간**: ~3분

## 결론부터

```
core-billing      ← 구독/플랜 정책 layer (위)
   ↓ 호출
   ├─ core-iap       ← Apple/Google receipt 검증 (스토어 채널)
   └─ core-payment   ← PG 직접 결제 (포트원 → 나이스/토스/이니시스 등)
```

## 왜 이런 결정이 필요했나?

이전 `core-billing` 의 BillingPort:

```java
// 혼재 — IAP receipt 검증 + subscription 상태 둘 다
PurchaseVerificationResult registerPurchase(IapReceiptRequest request);
SubscriptionStatus getSubscriptionStatus(long userId, String productId);
```

문제:

- **IAP 와 PG 의 결제 흐름이 매우 다릅니다** — IAP 는 Apple/Google 이 결제 처리, 우리는 receipt 검증만 (수수료 30%). PG 는 우리가 직접 처리해요 (수수료 3%, 환불 API, 웹훅 처리).
- 한 인터페이스에 욱여넣으면 시그니처가 어색해져요 — `registerPurchase(IapReceiptRequest)` 가 PG 결제도 받으려면 DTO/method 가 비대해집니다.
- "billing" 이름 자체가 모호해요 — 청구/구독 정책 의미인지, IAP 영수증 검증 의미인지 분간이 안 돼요.
- PG (한국 나이스페이/토스/이니시스) 통합 추가 시 `core-billing` 이 IAP 와 PG 두 채널을 모두 흡수해야 해서 도메인 경계가 흐려져요.

## 고민했던 대안들

> **대안 분석의 한계** — 본 ADR 은 *한 방향적 결정* 이에요. IAP 와 PG 가 *결제 흐름이 본질적으로 달라요* (수수료 모델 / 결제 처리 주체 / 환불 API / webhook 패턴) 이라 *단일 도메인 통합* 이 합리적 대안으로 성립하지 않아요. 그래서 형식적 대안 비교보다는 *왜 다른 형태가 부적합한가* 를 짧게 기록해요.

### 대안 1 — 단일 `core-billing` 안에 IAP 포함

기존 구조 (분리 전) — `core-billing` 모듈 하나에 IAP receipt 검증 + subscription 정책 + PG 결제 모두 흡수.

- ❌ 시그니처 어색 — `registerPurchase(IapReceiptRequest)` 가 PG 결제도 받으려면 DTO/method 가 비대
- ❌ "billing" 이름이 모호 — 청구/구독 정책 의미 vs IAP 영수증 검증 의미 분간 X
- ❌ PG 통합 추가 시 도메인 경계 흐림

### 대안 2 — IAP 만 분리 (billing + payment 통합 유지)

- ❌ subscription 정책 (BillingPort) 과 PG 결제 (PaymentPort) 도 외부 의존이 다름 — billing 은 *우리 도메인* 정책, payment 는 *외부 PG (PortOne)* 의존
- ❌ 결국 분리 압력 같은 형태로 다시 발생

### 채택 — 3 도메인 분리 (billing / iap / payment)

## 채택한 분리

| 도메인 | 책임 | 외부 의존 |
|---|---|---|
| **`core-billing`** | 구독/플랜 정책 — subscription 상태, 영수증, 갱신 정책, 환불 정책 (채널 무관 비즈니스) | (없음) |
| **`core-iap`** | Apple StoreKit / Google Play receipt 검증 | Apple/Google (서버 검증 API) |
| **`core-payment`** | PG 직접 결제 — verify, refund, webhook | 포트원 REST API (그 아래 나이스/토스/이니시스) |

### 호출 흐름

```
[Flutter] 결제 위젯 → 포트원 → impUid 획득
[Flutter] POST /api/apps/<slug>/payment/verify { impUid }
[백엔드] PaymentController → PaymentPort.verify(impUid)
                          → PortOneAdapter (포트원 REST API)
                          ← PaymentResult (status, amount, paidAt)
                          → BillingPort.activateSubscription(userId, plan, paymentResult)
                          ← Subscription 활성
```

IAP 도 같은 흐름:

```
[Flutter] StoreKit/BillingClient → receipt 획득
[Flutter] POST /api/apps/<slug>/iap/verify { receipt, productId, platform }
[백엔드] IapController → IapPort.verifyReceipt(...)
                       → AppleReceiptVerifier / GooglePlayVerifier (Phase 1)
                       ← PurchaseVerificationResult
                       → BillingPort.activateSubscription(...)
```

## 이름 정체성 (사용자 mental model 정합)

| 용어 | 의미 |
|---|---|
| **Billing** | "이 유저가 어떤 plan 으로 무엇 받고 있나" — **정책/상태** |
| **IAP** | "Apple/Google 스토어 인앱 결제" — **채널** |
| **Payment** | "PG 직접 결제 (카드/계좌)" — **채널** |

`Billing > {IAP, Payment}` 의 layer 관계가 이름에서 명확히 드러납니다. `billing/payment` 두 단어만으로는 "둘 중 어느게 위 layer 인지" 가 불명확해요.

## PG 채널 전략 — 포트원 추상화

`core-payment` 의 어댑터는 **포트원** 1개 (`PortOneAdapter`):

- 포트원 = 한국 PG 통합 SDK (월 거래 5천만 미만 무료)
- 포트원 콘솔에서 나이스페이/토스/이니시스 자유 활성 → **우리 코드 변경 0**
- PG 변경 / 추가는 콘솔 작업으로 한정

매출이 1억+ 되어 PG 직결로 수수료 협상이 필요해질 때만 `NicePayAdapter` 등 별도 어댑터 추가. 그때까지 포트원 only.

### 다른 PG 와 비교

| PG | 한국 시장 | 글로벌 | 수수료 | 협상 | 채택 여부 |
|---|---|---|---|---|---|
| **포트원** | ✅ 통합 (나이스/토스/이니시스/KCP 등 자유 전환) | ❌ | 무료 (월 거래 5천만 미만), PG 별 협상 | 콘솔에서 PG 직결 가능 | ✅ **채택** |
| Stripe | ❌ (한국 카드 결제 제한) | ✅ | 결제당 수수료 (높은 편) | X (글로벌 정책) | ❌ — 한국 시장 부적합 |
| 토스페이먼츠 (직결) | ✅ | ❌ | 협상 가능 (직접) | 직결 협상 필요 | ❌ — 직결 협상 부담, PG 1개 종속 |
| 나이스페이 (직결) | ✅ | ❌ | 협상 가능 | 직결 협상 필요 | ❌ — 동일 |
| 이니시스 (직결) | ✅ | ❌ | 협상 가능 | 직결 협상 필요 | ❌ — 동일 |

**포트원을 채택한 이유**. 솔로·인디 단계 (월 거래 5천만 미만) 에서는 다음 세 가지 이점이 결정적입니다.

- 월 거래 한도 안에서는 PG 수수료 외 별도 비용이 없고, 콘솔에서 PG 를 자유롭게 전환할 수 있어 PG 종속을 피할 수 있습니다. 이니시스에서 토스로 옮길 때 백엔드 코드는 한 줄도 바뀌지 않습니다.
- 한국 PG 를 한 곳에서 통합 처리하므로, 한국 카드 결제에 제약이 있는 글로벌 Stripe 의 한계를 우회할 수 있습니다.
- 직결 PG 와 달리 PG 별 수수료 협상을 운영자가 직접 할 필요가 없고, 포트원이 PG 와의 협상을 대행해 줍니다.

**전환 시점**. 매출이 1억 원 이상에 도달하면 PG 와 직결 협상을 통해 수수료를 낮추는 흐름이 자연스러워집니다. 그 시점에는 `NicePayAdapter` 같은 별도 어댑터를 추가해 직결 경로를 운영하면 됩니다. 그 전까지는 포트원 한 추상화만으로 충분합니다.

## 검증 (2026-05-01, template-spring main + server-factory 도그푸딩)

```
컴파일: core-iap-api/impl + core-payment-api/impl + core-billing 단순화 — PASS
spring 부팅: bootstrap 의존성 추가 후 정상 부팅
swagger: /api/apps/<slug>/payment/{verify,refund,webhook} 엔드포인트 노출 확인
   3개 앱 (test-svc, helloworld, rny) × 3 엔드포인트 = 9 path 신규
WireMock stub: portone-token / payment-paid / payment-failed / cancel — dev 환경 dry-run 가능
```

## 핵심 파일

- `core/core-iap-api/`, `core/core-iap-impl/` (신규)
- `core/core-payment-api/`, `core/core-payment-impl/` (신규 — `PortOneAdapter`, `PortOneWebhookVerifier`)
- `core/core-billing-api/BillingPort.java` (Phase 1 에서 `activateFromPayment` / `findActiveSubscription` / `cancelSubscription` / `handleWebhook` 시그니처 추가 — [`ADR-020`](./adr-020-subscription-domain-model.md))
- `core/core-billing-impl/BillingServiceImpl.java` (StubBillingAdapter 제거, Phase 1 비즈로직)
- `tools/new-app/new-app.sh` heredoc — `<Slug>PaymentController` + `<Slug>ApiEndpoints.Payment` 자동 생성

## Phase 1 완료 항목 ([`ADR-020`](./adr-020-subscription-domain-model.md))

- Subscription / Plan / PaymentRecord / WebhookEvent 모델 + 마이그레이션 (V008~V010)
- BillingServiceImpl.activateFromPayment — PG 결제 → Subscription 활성화 e2e
- Webhook 보안 — HMAC SHA-256 + timestamp + idempotency 3중 방어
- 트랜잭션 경계 — `handleWebhook` 의 phase 분리로 외부 HTTP 호출 트랜잭션 격리

## 안 다루는 범위 (다음 사이클)

- IAP 실제 구현 (Apple StoreKit 2 / Google Play Verifier) — `core-iap-impl` 은 현재 stub
- Subscription 자동 갱신 (cron 또는 Server Notification 처리)
- PortOne v2 API 마이그레이션 (현재 v1 기반)
- Flutter 템플릿 — `portone_flutter` SDK 통합 + 백엔드 OpenAPI 기반 client 자동 생성
