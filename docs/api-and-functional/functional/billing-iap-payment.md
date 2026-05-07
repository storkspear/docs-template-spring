# 결제 도메인 — billing / iap / payment 통합 가이드

> **유형**: Explanation · **독자**: Level 2 · **읽는 시간**: ~10분

본 템플릿은 결제와 구독을 세 개의 도메인으로 나누어 다룹니다. `core-billing` 은 구독 정책을 담당하고, `core-iap` 는 Apple/Google 의 인앱 결제 (In-App Purchase) 를, `core-payment` 는 PortOne 을 통한 일반 PG 결제를 각각 담당합니다. 이 분리의 결정 근거는 [`ADR-019`](../../philosophy/adr-019-billing-iap-payment-separation.md) 에 정리되어 있으며, 본 가이드는 운영자와 개발자가 *언제, 어떻게* 사용하는지를 설명합니다.

## 한 문장 요약

구독 정책은 `BillingPort` 한 곳에서 관리하고, 실제 결제 채널은 상황에 따라 `IapPort` (Apple/Google) 또는 `PaymentPort` (PortOne PG) 를 사용합니다. 두 채널이 검증한 결제 결과는 모두 `BillingPort` 로 흘러들어와 동일한 구독 정책 (Plan 매칭, Subscription 활성화, PaymentRecord 기록) 으로 처리됩니다.

## 1. 언제 어느 결제를 사용하는가

결제가 어디서 발생하는지에 따라 사용해야 하는 채널이 달라집니다.

| 결제 시나리오 | 채널 | 모듈 |
|---|---|---|
| iOS 앱 안에서 월간 구독 결제 | Apple IAP | `core-iap` |
| Android 앱 안에서 월간 구독 결제 | Google IAP | `core-iap` |
| 웹 / 외부 채널에서 카드 결제 | PortOne PG (나이스/토스/이니시스) | `core-payment` |
| 코인이나 포인트의 일시 충전 (외부) | PortOne PG | `core-payment` |
| 1회성 상품 구매 (in-app) | Apple/Google IAP | `core-iap` |

기준이 되는 원칙은 단순합니다. Apple 과 Google 은 *자기 앱 안에서 일어나는 결제* 에 대해서는 자사 SDK 만 사용하도록 강제합니다. 만약 iOS 앱 안에서 외부 PG 로 결제하도록 만들면 앱 심사 단계에서 거부당합니다. 따라서 *앱 내 결제* 는 IAP 를 사용해야 하고, 그 외의 *웹 결제나 외부 충전* 에서는 일반 PG 를 자유롭게 선택할 수 있습니다. 한국 시장이라면 포트원이 추천 선택지가 됩니다.

## 2. 각 모듈의 책임

세 모듈은 각자 분명한 역할을 가집니다.

| 모듈 | 책임 | 주요 인터페이스 |
|---|---|---|
| `core-billing` | 구독 정책 — Plan, Subscription, PaymentRecord 의 모델과 만료 sweep, 갱신 알림 | `BillingPort.activateFromIap`, `activateFromPayment`, `handleWebhook` |
| `core-iap` | Apple/Google 채널 — receipt 검증과 서버 알림 (Notification V2 / RTDN) 의 디코딩 | `IapPort.verifyReceipt`, `handleAppleWebhook`, `handleGoogleWebhook` |
| `core-payment` | PG 채널 — 결제 검증과 환불, webhook 처리 | `PaymentPort.verify(impUid)`, `refund`, `WebhookMessage` |

`BillingPort` 는 결제가 어느 채널에서 들어왔는지 신경쓰지 않습니다. 항상 같은 정책을 적용해 Plan 을 매칭하고 Subscription 을 활성화하며 PaymentRecord 를 저장합니다. 채널마다 다른 검증 로직과 외부 통신은 `IapPort` 와 `PaymentPort` 가 흡수합니다. 이 구조 덕분에 새로운 결제 채널이 추가되어도 `BillingPort` 는 변경할 필요가 없습니다.

## 3. 결제 흐름

### 3.1 IAP — Apple / Google In-App Purchase

사용자가 앱 안에서 결제 위젯을 띄우면 StoreKit (iOS) 또는 BillingClient (Android) 가 영수증을 발급합니다. 클라이언트는 이 영수증을 백엔드로 전달하고, 백엔드는 Apple 또는 Google 의 서버 검증 API 로 영수증을 확인한 뒤 구독을 활성화합니다.

```mermaid
sequenceDiagram
    participant App as Flutter App
    participant Store as Apple/Google Store
    participant API as Backend (IapController)
    participant IapPort
    participant Verify as Apple/Google API
    participant Billing as BillingPort

    App->>Store: 결제 위젯 (StoreKit / BillingClient)
    Store-->>App: transactionId / purchaseToken
    App->>API: POST /api/apps/<slug>/iap/verify
    API->>IapPort: verifyReceipt(IapReceiptRequest)
    IapPort->>Verify: receipt 검증 요청
    Verify-->>IapPort: 검증 결과
    IapPort-->>API: PurchaseVerificationResult
    API->>Billing: activateFromIap(userId, planCode, result)
    Billing-->>API: Subscription
    API-->>App: 구독 활성 응답

    Note over Store, Billing: 갱신 / 환불은 webhook 으로
    Store->>API: POST /api/apps/<slug>/iap/{apple,google}/webhook
    API->>IapPort: handleAppleWebhook / handleGoogleWebhook
    IapPort->>Billing: handleIapNotification (idempotent)
```

위 흐름의 핵심은 두 단계로 나누어집니다. 첫째, 사용자가 결제한 직후의 *verify 호출* 입니다. 클라이언트가 영수증을 백엔드로 보내면 백엔드는 Apple/Google 서버 검증을 거친 뒤 구독을 활성화합니다. 둘째, 결제 이후의 *서버 알림 (webhook)* 처리입니다. 갱신, 환불, 취소가 발생하면 Apple 과 Google 이 백엔드로 직접 알림을 보내는데, 이때 같은 transactionId 가 중복으로 도착할 수 있으므로 *idempotent* 하게 처리합니다.

### 3.2 PG — PortOne (나이스/토스/이니시스)

웹이나 외부 결제는 PortOne 을 거칩니다. 사용자가 결제 위젯에서 결제하면 PortOne 이 실제 PG 와 통신해 결제를 완료하고, 거래를 식별하는 `impUid` 를 클라이언트에 돌려줍니다. 클라이언트는 이 `impUid` 를 백엔드로 전달하고, 백엔드는 PortOne 의 REST API 로 거래를 *재검증* 한 뒤 구독을 활성화합니다.

```mermaid
sequenceDiagram
    participant App as Flutter App / Web
    participant PortOne as PortOne SDK / Console
    participant API as Backend (PaymentController)
    participant Payment as PaymentPort (PortOneAdapter)
    participant PG as 나이스/토스/이니시스
    participant Billing as BillingPort

    App->>PortOne: 결제 위젯
    PortOne->>PG: 실 PG 호출
    PG-->>PortOne: 결제 완료
    PortOne-->>App: impUid (포트원 거래 ID)
    App->>API: POST /api/apps/<slug>/payment/verify { impUid, planCode }
    API->>Payment: verify(impUid)
    Payment->>PortOne: REST API (impUid 검증)
    PortOne-->>Payment: PaymentResult (status, amount, paidAt)
    Payment-->>API: PaymentResult
    API->>Billing: activateFromPayment(userId, planCode, result)
    Billing-->>API: Subscription
    API-->>App: 구독 활성 응답

    Note over PortOne, Billing: 갱신 / 환불은 webhook 으로
    PortOne->>API: POST /api/apps/<slug>/payment/webhook (HMAC SHA-256 + timestamp)
    API->>API: PortOneWebhookVerifier (signature + timestamp 검증)
    API->>Billing: handleWebhook("portone", impUid, payload)
```

여기서 *재검증* 이 중요한 이유는 클라이언트에서 받은 `impUid` 만 믿을 수 없기 때문입니다. 위변조된 요청이 들어올 가능성을 차단하기 위해 백엔드가 PortOne 서버에 직접 거래를 조회합니다. 또한 PortOne 이 보내는 webhook 은 HMAC SHA-256 서명과 timestamp 를 함께 보내는데, 백엔드는 이를 `PortOneWebhookVerifier` 로 검증해 위조와 replay 공격을 막습니다. timestamp 의 허용 오차는 기본 300초입니다.

## 4. 운영 함정 — PortOne 부팅 차단

운영 환경에서 자주 부딪히는 함정 중 하나입니다. `<your-backend> new <slug>` 가 생성하는 슬러그 컨트롤러 (`*PaymentController`) 는 `PaymentPort` 를 *필수 의존* 으로 가지고 있습니다. 이 때문에 prod 프로파일에서 `PortOneProdConfigGuard` 가 부팅 시점에 PortOne v1 키와 webhook secret 을 검증하고, 하나라도 빠져 있으면 `IllegalStateException` 으로 부팅이 차단됩니다.

도그푸딩 단계처럼 결제를 실제로 사용하지 않는 경우라도 이 자격은 비워둘 수 없습니다. 어떤 값이라도 채워 두어야 부팅이 통과합니다.

```bash
# 결제 미사용이라도 더미값을 채워두면 부팅은 통과합니다
APP_PAYMENT_PORTONE_API_V1_KEY=dogfood-dummy
APP_PAYMENT_PORTONE_API_V1_SECRET=dogfood-dummy
APP_PAYMENT_PORTONE_WEBHOOK_SECRET=dogfood-dummy
```

이 세 키는 [secret chain 4-stage](../../production/setup/secret-chain-4stage.md) 에 따라 네 곳에 모두 동기화해야 컨테이너에 정상적으로 주입됩니다. 실제 PortOne 콘솔에서 자격을 발급받는 절차는 추후 별도 가이드로 정리될 예정입니다.

## 5. IAP credentials — 슬러그별 분리

Apple 과 Google 의 IAP 자격은 *슬러그별* 로 분리됩니다. 각 앱이 별도의 Bundle ID 와 Package Name 을 갖기 때문입니다. `.env.prod` 에는 슬러그를 prefix 로 가진 형태로 키를 등록합니다 (아래 예시는 `mynewapp` 슬러그의 경우 — 실제로는 본인의 슬러그 이름이 들어갑니다).

```bash
# Apple
APP_CREDENTIALS_MYNEWAPP_IAP_APPLE_KEY_ID=...
APP_CREDENTIALS_MYNEWAPP_IAP_APPLE_ISSUER_ID=...
APP_CREDENTIALS_MYNEWAPP_IAP_APPLE_BUNDLE_ID=com.example.mynewapp
APP_CREDENTIALS_MYNEWAPP_IAP_APPLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----...

# Google
APP_CREDENTIALS_MYNEWAPP_IAP_GOOGLE_PACKAGE_NAME=com.example.mynewapp
APP_CREDENTIALS_MYNEWAPP_IAP_GOOGLE_SERVICE_ACCOUNT_JSON=...
```

`<your-backend> new <slug>` 명령이 슬러그에 맞는 placeholder 키를 자동으로 추가해 줍니다. 실제 값은 Apple Developer 콘솔과 Google Play Console 에서 발급받은 뒤 채워 넣으면 됩니다. 자세한 절차는 [`social-auth-setup`](../../start/social-auth-setup.md) 의 IAP 섹션을 참고하시면 됩니다.

## 6. Feature toggle — `app.features.{payment,iap}`

ADR-034 의 Lite 모드를 사용하면 `.env.prod` 의 `APP_FEATURES_PAYMENT=false` 또는 `APP_FEATURES_IAP=false` 로 결제 도메인 자체를 끌 수 있습니다. 다만 주의할 점이 있습니다. 도메인을 *끄면* `PaymentPort` 와 `IapPort` 가 빈으로 등록되지 않기 때문에, 슬러그 컨트롤러가 의존성을 찾지 못해 부팅에 실패합니다.

따라서 결제 도메인을 완전히 사용하지 않으려면 두 가지 중 하나를 선택해야 합니다. 첫째, 슬러그 컨트롤러 자체를 삭제하는 방법이 있고, 둘째는 위에서 설명한 더미값으로 자격을 채워두는 방법이 있습니다. 도그푸딩 단계에서는 후자가 단순하고 안전합니다.

## 관련 문서

- [`ADR-019 · billing/iap/payment 분리`](../../philosophy/adr-019-billing-iap-payment-separation.md) — 분리 결정의 근거와 PortOne 채택 이유
- [`ADR-020 · 구독 도메인 모델`](../../philosophy/adr-020-subscription-domain-model.md) — Plan, Subscription, PaymentRecord 의 정책
- [`ADR-022 · IAP 서버 알림`](../../philosophy/adr-022-iap-server-notifications.md) — Apple Server Notification V2 와 Google RTDN 처리
- [`ADR-032 · Google Webhook auth`](../../philosophy/adr-032-google-webhook-auth.md) — Pub/Sub push 인증 검증
- [`Feature Toggle`](../../production/operations/feature-toggle.md) — `app.features.*` 운영 가이드
- [`Secret Chain 4-Stage`](../../production/setup/secret-chain-4stage.md) — 자격 동기화 절차
