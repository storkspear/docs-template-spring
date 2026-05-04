# ADR-019 · billing / iap / payment 도메인 분리

**Status**: Accepted. 2026-05-01 기준 결제 관련 코어 모듈을 3개 도메인으로 분리했어요. `core-billing` 을 3 도메인 (billing / iap / payment) 으로 분리한 이유: IAP receipt 검증 + subscription 정책 + PG 결제가 단일 모듈에 혼재할 때 책임 경계가 모호해지기 때문이에요.

> **유형**: ADR · **독자**: Level 2 · **읽는 시간**: ~3분

## 결론부터

구독형 SaaS 의 결제 도메인은 표면적으로 한 단어 *결제* 처럼 보이지만, 실제로는 *세 가지 결이 다른 책임* 으로 나뉘어요. **Billing** 은 *이 사용자가 어떤 plan 으로 무엇을 받고 있는가* — 구독 상태, 갱신 정책, 환불 정책 같은 *비즈니스 정책* 영역입니다. **IAP** (In-App Purchase) 는 Apple App Store / Google Play 의 *스토어 결제 채널* 로, Apple / Google 이 결제 처리 자체를 대행하고 우리는 *receipt 만 받아 검증* 하는 형태예요 (수수료 30%, 우리 환불 API 없음). **Payment** 는 *PG (Payment Gateway) 직접 결제* 로, 한국에서는 포트원을 통해 카드 / 계좌이체 / 간편결제를 *우리가 직접 처리* 하고 *환불 API 와 webhook 도 직접 운영* 합니다 (수수료 3%, 환불 / 웹훅 우리 책임).

이 세 가지가 *결제 흐름이 본질적으로 다른* 영역이라 한 모듈에 넣으면 시그니처가 어색해지고 이름이 모호해져요. 본 ADR 은 결제 코어 모듈을 *정책 layer 하나 (`core-billing`)* + *채널 layer 둘 (`core-iap`, `core-payment`)* 의 3 도메인으로 분리한 결정을 기록합니다. Billing 이 위에 있고 두 채널을 아래에서 호출하는 형태로, *채널이 늘어나도 정책 layer 는 동일* 한 구조예요.

```
core-billing      ← 구독/플랜 정책 layer (위)
   ↓ 호출
   ├─ core-iap       ← Apple/Google receipt 검증 (스토어 채널)
   └─ core-payment   ← PG 직접 결제 (포트원 → 나이스/토스/이니시스 등)
```

핵심 아이디어는 *Billing 도메인이 채널에 무관* 하다는 점이에요. 사용자가 IAP 로 결제했든 PG 로 결제했든, *Pro plan 활성 / 만료일 / 환불 처리* 같은 정책은 같은 코드로 처리됩니다. 채널 layer 는 *외부 시스템과의 어댑터* 역할만 맡고, 검증된 결제 결과를 정책 layer 에 전달하는 단방향 흐름이에요.

## 왜 이런 결정이 필요했나?

결제 도메인을 분리해야 하는 진짜 이유는 *IAP 와 PG 의 본질이 다르다* 는 한 문장으로 요약돼요. 표면만 보면 *둘 다 결제* 라 같은 모듈에 묶이는 게 자연스러워 보이지만, 실제로 들여다보면 *결제 처리 주체*, *수수료 모델*, *환불 흐름*, *webhook 패턴* 이 서로 무관합니다.

**IAP 의 본질** — Apple / Google 이 결제 처리의 *주체* 예요. 사용자가 *결제 진행 → 카드 정보 입력 → 승인* 같은 단계를 모두 Apple / Google 의 시스템 안에서 수행하고, 그 결과인 *receipt* 만 우리에게 전달됩니다. 우리는 *그 receipt 가 진짜인지* 를 Apple / Google 의 서버 검증 API 로 확인할 뿐이에요. 환불도 사용자가 Apple / Google 측에 직접 요청하고, 우리는 *server notification webhook* 으로 환불 사실을 통보받는 형태입니다. 수수료는 30% 로 높은 편이지만 *결제 인프라 운영 비용* 은 0 이에요.

**PG 의 본질** — 우리가 결제 처리의 *주체* 입니다. 사용자가 카드 정보를 입력하면 우리 시스템이 PG (포트원) REST API 를 호출해 결제를 *우리가 직접* 진행해요. 결제 결과 (`status=PAID`, 금액, 영수증) 도 우리가 받고, 환불 API 도 우리가 직접 호출해야 합니다. PG 의 webhook 도 우리 endpoint 로 직접 들어와서 *idempotency 와 보안 검증* 도 우리 책임이에요. 수수료는 3% 로 IAP 의 1/10 수준이지만 *환불 / webhook / 보안 인프라* 전체를 운영해야 합니다.

이 두 본질이 다르면 *공통 인터페이스로 묶는* 시도가 어색해져요. 분리 전 `core-billing` 의 BillingPort 는 *receipt 검증 메서드와 subscription 상태 메서드가 한 인터페이스에 혼재* 하는 형태였고, 여기에 PG 결제까지 추가하려고 보니 시그니처가 비대해지는 게 보였어요. *registerPurchase(IapReceiptRequest)* 가 PG 결제도 받으려면 DTO 가 *receipt + impUid + 환불 데이터* 까지 모두 흡수해야 했는데, 그 형태로는 *어떤 채널의 결제인지* 가 분기 안에서 if-else 로 처리될 수밖에 없습니다.

이름의 모호함도 큰 부담이었어요. *billing* 이라는 단어가 *청구/구독 정책* 의미인지 *IAP 영수증 검증* 의미인지 분간이 안 됐어요. 새 사람이 이 모듈을 처음 보면 *receipt 검증이 왜 billing 안에 있지?* 라는 질문이 자연스럽게 떠오릅니다. 이름 자체가 *책임 경계가 흐림* 의 신호였어요.

여기에 PG 추가가 임박한 상황이 결정적이었습니다. 한국 시장 앱이라면 *카드 결제 / 간편결제 / 계좌이체* 가 IAP 보다 더 자주 쓰이는 채널이에요. 이 PG 통합을 `core-billing` 안에 또 넣으면 *IAP 채널 + PG 채널 + subscription 정책* 이 한 모듈에 모두 모이게 되어 *책임 경계가 더 흐려지는* 방향으로 진화할 수밖에 없습니다.

이 결정이 답해야 할 물음은 이거예요.

> **결제 도메인을 어떤 경계로 나누어, 채널 (IAP / PG) 이 늘어나도 정책 layer 가 흔들리지 않는 구조를 만들 것인가?**

## 고민했던 대안들

> **대안 분석의 한계** — 본 ADR 은 *한 방향적 결정* 이에요. IAP 와 PG 의 결제 흐름이 본질적으로 다르다는 점이 이미 *결정의 전제* 라서, *단일 도메인 통합* 이 합리적 대안으로 성립하지 않아요. 그래서 형식적 대안 비교보다는 *왜 다른 분리 형태가 부적합한가* 를 짧게 기록합니다.

### 대안 1 — 단일 `core-billing` 안에 IAP + PG 모두 흡수

가장 단순한 구조예요. 결제 관련 모든 코드 — IAP receipt 검증, subscription 정책, PG 결제 — 를 한 모듈 `core-billing` 안에 두는 형태입니다. 모듈 수가 적어 IDE 트리도 깔끔해 보이고, 결제 관련 로직을 한 곳에서 찾을 수 있다는 점이 매력이에요.

문제는 *책임 경계의 흐림* 이 빠르게 누적된다는 점이에요. BillingPort 의 시그니처가 `registerPurchase(IapReceiptRequest)` 와 `getSubscriptionStatus(userId, productId)` 처럼 *receipt 검증 + subscription 상태* 가 혼재하는 형태로 자라났고, PG 결제까지 추가하려면 *registerPurchase 가 IapReceiptRequest 와 PaymentRequest 둘 다 받는* 비대한 DTO/method 가 필요했어요. 시그니처 안에서 *어떤 채널의 결제인지* 를 if-else 로 분기하는 패턴이 곳곳에 깔리는 미래가 보였습니다.

이름의 모호함도 부담이에요. *billing* 이 *청구/구독 정책* 인지 *IAP 영수증 검증* 인지 분간이 안 되니, 새 사람이 이 모듈을 처음 보면 *receipt 검증이 왜 billing 안에 있지?* 라는 질문이 자연스럽게 떠오릅니다. PG 통합이 추가되는 시점에 이 모호함이 *정책 layer + 채널 두 개* 가 모두 한 모듈에 모이는 형태로 폭발해요.

탈락 이유는 *PG 통합 임박 시점에 도메인 경계가 흐려지는 방향* 으로만 진화한다는 점입니다.

### 대안 2 — IAP 만 분리 (billing + payment 통합 유지)

중간 절충안이에요. IAP 가 *Apple / Google 외부 검증* 이라는 명확히 다른 결이라 분리하되, *billing 정책* 과 *PG 직접 결제* 는 "둘 다 우리가 처리하는 영역" 이라는 공통점으로 한 모듈에 묶는 형태입니다.

겉보기엔 합리적이지만, *외부 의존의 결* 이 다르다는 점이 곧 분리 압력으로 돌아와요. `core-billing` 은 *우리 도메인 정책* 이라 외부 의존이 없는 모듈이어야 합니다 — 구독 상태, 갱신 정책, 환불 정책 같은 *비즈니스 규칙* 이 외부 시스템에 의존하면 *PG 가 다운됐을 때 정책 로직이 함께 멈추는* 결합이 생겨요. 반면 PG 결제는 *포트원 REST API* 라는 외부 시스템에 직접 의존합니다. 이 둘을 한 모듈에 두면 *비즈니스 정책 영역에 외부 HTTP 호출 코드가 섞이는* 형태가 되고, *PortOne 이 v2 로 마이그레이션* 같은 채널 변경이 정책 코드까지 흔드는 결합이 생겨요.

탈락 이유는 *결국 분리 압력이 같은 형태로 다시 발생* 한다는 점이에요. 한 단계 미루는 결정이 되어 *지금 명확히 분리* 하는 편이 정합합니다.

### 채택 — 3 도메인 분리 (billing / iap / payment) ★

정책 layer 하나와 채널 layer 둘로 명확히 나누는 형태입니다. *billing* 은 외부 의존 0 의 비즈니스 정책 모듈, *iap* 와 *payment* 는 각자의 외부 시스템 (Apple / Google / 포트원) 과의 어댑터 모듈이에요. 결제 흐름이 *채널 → 정책* 의 단방향이라 의존 방향도 자연스럽게 정렬됩니다.

이름 자체가 *layer 관계* 를 드러내는 점이 추가 가치예요. *Billing > {IAP, Payment}* 의 위계가 단어에서 즉시 읽히고, 새 사람이 *어디에 무엇이 있는지* 를 모듈 이름만으로 빠르게 파악할 수 있어요. 새 채널 (예: 베트남 *VNPay* 통합) 이 추가되더라도 *core-vnpay* 같은 별도 채널 모듈로 들어가면 되어 정책 layer 는 흔들리지 않습니다.

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

## 핵심 파일

- `core/core-iap-api/`, `core/core-iap-impl/` — IAP 채널 (Apple StoreKit / Google Play receipt 검증)
- `core/core-payment-api/`, `core/core-payment-impl/` — PG 채널 (`PortOneAdapter`, `PortOneWebhookVerifier`)
- `core/core-billing-api/BillingPort.java` — 정책 layer 인터페이스 (`activateFromPayment` / `findActiveSubscription` / `cancelSubscription` / `handleWebhook`)
- `core/core-billing-impl/BillingServiceImpl.java` — 정책 layer 구현 (구독 상태 / 갱신 / 환불 정책)
- `tools/new-app/new-app.sh` heredoc — `<Slug>PaymentController` + `<Slug>ApiEndpoints.Payment` 자동 생성

상세 구독 도메인 모델 (Subscription / Plan / PaymentRecord / WebhookEvent), webhook 보안, 트랜잭션 경계는 [`ADR-020`](./adr-020-subscription-domain-model.md) 에서 다룹니다.

## 안 다루는 범위 (다음 사이클)

- IAP 실제 구현 (Apple StoreKit 2 / Google Play Verifier) — `core-iap-impl` 은 현재 stub
- Subscription 자동 갱신 (cron 또는 Server Notification 처리)
- PortOne v2 API 마이그레이션 (현재 v1 기반)
- Flutter 템플릿 — `portone_flutter` SDK 통합 + 백엔드 OpenAPI 기반 client 자동 생성
