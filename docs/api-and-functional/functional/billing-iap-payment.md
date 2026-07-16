# 결제 도메인 — billing · iap · payment 통합 가이드

> **유형**: Explanation · **독자**: Level 2 · **읽는 시간**: ~10분

**설계 근거**: [`ADR-019 (billing/iap/payment 분리)`](../../philosophy/adr-019-billing-iap-payment-separation.md) · [`ADR-020 (구독 도메인 모델)`](../../philosophy/adr-020-subscription-domain-model.md) · [`ADR-022 (IAP 서버 알림)`](../../philosophy/adr-022-iap-server-notifications.md) · [`ADR-034 (feature toggle)`](../../philosophy/adr-034-feature-toggle-lite-mode.md)

본 템플릿은 결제와 구독을 세 도메인으로 나눠 다룹니다. `core-billing` 은 구독 정책을 담당하고, `core-iap` 는 Apple 과 Google 의 인앱 결제(In-App Purchase) 를, `core-payment` 는 PortOne 을 통한 일반 PG 결제를 각각 담당합니다. 이 분리의 결정 근거는 [`ADR-019`](../../philosophy/adr-019-billing-iap-payment-separation.md) 에 정리되어 있으며, 본 가이드는 운영자와 개발자가 *언제, 어떻게* 사용하는지를 설명합니다.

---

## 한 문장 요약

구독 정책은 `BillingPort` 한 곳에서 관리하고, 실제 결제 채널은 상황에 따라 `IapPort`(Apple·Google) 또는 `PaymentPort`(PortOne PG) 를 사용합니다. 두 채널이 검증한 결제 결과는 모두 `BillingPort` 로 흘러들어와 동일한 구독 정책으로 처리됩니다. 정책이란 Plan 매칭, Subscription 활성화, PaymentRecord 기록을 가리켜요.

## 1. 언제 어느 결제를 사용하는가

결제가 어디서 발생하는지에 따라 사용해야 하는 채널이 달라집니다.

| 결제 시나리오 | 채널 | 모듈 |
|---|---|---|
| iOS 앱 안에서 월간 구독 결제 | Apple IAP | `core-iap` |
| Android 앱 안에서 월간 구독 결제 | Google IAP | `core-iap` |
| 웹·외부 채널에서 카드 결제 | PortOne PG | `core-payment` |
| 코인·포인트 일시 충전(외부) | PortOne PG | `core-payment` |
| 1회성 상품 구매(인앱) | Apple·Google IAP | `core-iap` |

기준이 되는 원칙은 단순합니다. Apple 과 Google 은 *자기 앱 안에서 일어나는 결제* 에 대해서는 자사 SDK 만 쓰도록 강제합니다. iOS 앱 안에서 외부 PG 로 결제하도록 만들면 앱 심사 단계에서 거부당해요. 따라서 *앱 내 결제* 는 IAP 를 써야 하고, *웹 결제나 외부 충전* 에서는 일반 PG 를 자유롭게 고를 수 있습니다. 한국 시장이라면 PortOne 이 추천 선택지가 돼요. PortOne 콘솔에서 나이스·토스·이니시스 같은 실제 PG 를 코드 변경 없이 전환할 수 있기 때문이에요.

## 2. 각 모듈의 책임

세 모듈은 각자 분명한 역할을 가집니다.

| 모듈 | 책임 | 주요 인터페이스 |
|---|---|---|
| `core-billing` | 구독 정책 — Plan·Subscription·PaymentRecord 모델, 만료 sweep, 갱신 | `BillingPort.activateFromIap`, `activateFromPayment`, `handleWebhook` |
| `core-iap` | Apple·Google 채널 — receipt 검증, 서버 알림 디코딩 | `IapPort.verifyReceipt`, `handleAppleWebhook`, `handleGoogleWebhook` |
| `core-payment` | PG 채널 — 결제 검증·환불·webhook 처리 | `PaymentPort.verify`, `refund`, `chargeAgain` |

`BillingPort` 는 결제가 어느 채널에서 들어왔는지 신경쓰지 않습니다. 항상 같은 정책을 적용해 Plan 을 매칭하고, Subscription 을 활성화하고, PaymentRecord 를 저장합니다. 채널마다 다른 검증 로직과 외부 통신은 `IapPort` 와 `PaymentPort` 가 흡수해요. 이 구조 덕분에 새로운 결제 채널이 추가되어도 `BillingPort` 는 바뀌지 않습니다. 이름 자체가 *Billing > {IAP, Payment}* 의 layer 관계를 드러내는데, 자세한 근거는 [`ADR-019`](../../philosophy/adr-019-billing-iap-payment-separation.md) 에 정리되어 있어요.

## 3. 결제 흐름

### 3.1 IAP — Apple·Google In-App Purchase

사용자가 앱 안에서 결제 위젯을 띄우면 StoreKit(iOS) 또는 BillingClient(Android) 가 영수증을 발급합니다. 클라이언트는 이 영수증을 백엔드로 전달하고, 백엔드는 Apple 또는 Google 의 서버 검증 API 로 영수증을 확인한 뒤 구독을 활성화해요.

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

이 흐름은 두 단계로 나뉩니다. 첫째는 사용자가 결제한 직후의 *verify 호출* 이에요. 클라이언트가 영수증을 백엔드로 보내면 백엔드는 Apple·Google 서버 검증을 거친 뒤 구독을 활성화합니다. 둘째는 결제 이후의 *서버 알림(webhook)* 처리예요. 갱신·환불·취소가 발생하면 Apple 과 Google 이 백엔드로 직접 알림을 보내는데, 이때 같은 transactionId 가 중복으로 도착할 수 있으므로 *idempotent* 하게 처리합니다. 알림 디코딩과 처리 매핑의 자세한 규칙은 [`ADR-022`](../../philosophy/adr-022-iap-server-notifications.md) 를 참고하세요.

### 3.2 PG — PortOne

웹이나 외부 결제는 PortOne 을 거칩니다. 사용자가 결제 위젯에서 결제하면 PortOne 이 실제 PG 와 통신해 결제를 완료하고, 거래를 식별하는 `impUid` 를 클라이언트에 돌려줘요. 클라이언트는 이 `impUid` 를 백엔드로 전달하고, 백엔드는 PortOne 의 REST API 로 거래를 *재검증* 한 뒤 구독을 활성화합니다.

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

여기서 *재검증* 이 중요한 이유는 클라이언트에서 받은 `impUid` 만 믿을 수 없기 때문입니다. 위변조된 요청이 들어올 가능성을 차단하려고 백엔드가 PortOne 서버에 직접 거래를 조회해요. 또한 PortOne 이 보내는 webhook 은 HMAC SHA-256 서명과 timestamp 를 함께 보내는데, 백엔드는 이를 `PortOneWebhookVerifier` 로 검증해 위조와 replay 공격을 막습니다. timestamp 의 허용 오차는 기본 300초이고, `APP_PAYMENT_PORTONE_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS` 로 조정할 수 있어요. 구독 모델의 트랜잭션 경계와 webhook 보안 전체는 [`ADR-020`](../../philosophy/adr-020-subscription-domain-model.md) 에서 다룹니다.

## 4. 운영 함정 — PortOne 부팅 차단

운영 환경에서 자주 부딪히는 함정 중 하나입니다. core 의 **공유 `PaymentController`**(`core-billing-impl`, `{appSlug}` path 로 모든 앱 처리 — `new <slug>` 가 슬러그별 결제 컨트롤러를 만들지 않아요)는 `PaymentPort` 를 *필수 의존* 으로 가집니다. 이 때문에 prod 와 dev 프로파일에서 `PortOneProdConfigGuard` 가 부팅 시점에 PortOne 설정을 검증해요.

검증 정책은 세 갈래입니다. 핵심은 "셋 다 빔" 은 통과하지만 "일부만 채움" 은 차단한다는 점이에요.

| PortOne 자격 상태 | 부팅 | 동작 |
|---|---|---|
| v1 key·secret·webhook secret 셋 다 빔 | 통과 | fallback (prod=Stub, dev=WireMock) |
| 셋 중 일부만 채움 | 차단 | `IllegalStateException` 으로 부팅 fail |
| 셋 다 채움 | 통과 | `PortOneAdapter` + `PortOneWebhookVerifier` 등록 |

"일부만 채움" 을 fail-secure 로 막는 이유가 있어요. v1 키만 채우고 webhook secret 을 비우면 webhook 위조를 막을 수 없고, 반대로 webhook secret 만 채우고 v1 키를 비우면 결제 자체가 불가능합니다. 둘 다 사고로 이어지므로 부팅을 차단해 일찍 알려줘요.

도그푸딩 단계처럼 결제를 실제로 쓰지 않는 경우엔 세 값을 *모두 비워* fallback 으로 가는 게 정석이에요. 이 경우 `StubPaymentAdapter` 가 등록되고, 부팅은 통과합니다. 반대로 셋 중 하나만 채우는 실수가 가장 흔한 함정이에요.

```bash
# 결제 미사용이면 셋 다 비워 fallback (부팅 통과). 일부만 채우면 부팅 fail.
# APP_PAYMENT_PORTONE_API_V1_KEY=
# APP_PAYMENT_PORTONE_API_V1_SECRET=
# APP_PAYMENT_PORTONE_WEBHOOK_SECRET=
```

> 이전 가이드는 "더미값이라도 채워야 통과" 라고 안내했지만, 현재 가드 정책에서는 *셋 다 비워야* 통과합니다. 더미값을 셋 다 채우면 통과하긴 하나, 그 경우 `PortOneAdapter` 가 등록되어 더미 키로 실제 PortOne 호출을 시도하게 되니 fallback 의도라면 비우는 쪽이 안전해요.

실결제를 켤 때 이 세 키는 [secret chain 4-stage](../../production/setup/secret-chain-4stage.md) 에 따라 네 곳에 모두 동기화해야 컨테이너에 정상 주입됩니다. PortOne 콘솔에서 자격을 발급받는 절차는 [`키 발급 가이드`](../../production/setup/key-issuance.md) 의 PortOne 섹션을 참고하세요.

## 5. IAP credentials — 자격증명은 글로벌, 식별자만 슬러그별

Apple 과 Google 의 IAP 자격증명(.p8 private key, service account JSON 등) 은 한 Apple Developer 계정과 한 GCP project 의 키 하나로 모든 슬러그가 공유합니다. 슬러그별로 다른 것은 Bundle ID(Apple) 와 Package Name(Google) 두 식별자뿐이에요. 코드 분리는 두 ConfigurationProperties 로 표현됩니다. `IapProperties` 가 글로벌 자격증명을, `IapAppCredentialProperties` 가 슬러그별 식별자를 담아요.

```bash
# 글로벌 — 한 Apple Developer 계정 / GCP project 의 키 하나로 모든 슬러그 공용
APP_IAP_APPLE_API_URL=https://api.storekit.itunes.apple.com
APP_IAP_APPLE_KEY_ID=...
APP_IAP_APPLE_ISSUER_ID=...
APP_IAP_APPLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----...
APP_IAP_APPLE_ENVIRONMENT=production

APP_IAP_GOOGLE_API_URL=https://androidpublisher.googleapis.com
APP_IAP_GOOGLE_SERVICE_ACCOUNT_JSON=...

# 슬러그별 식별자 — App Store / Play Console 에 등록된 앱 ID (앱마다 다름)
APP_CREDENTIALS_MYNEWAPP_IAP_APPLE_BUNDLE_ID=com.example.mynewapp
APP_CREDENTIALS_MYNEWAPP_IAP_GOOGLE_PACKAGE_NAME=com.example.mynewapp
```

`<your-backend> new <slug>` 명령이 자동으로 추가하는 것은 슬러그별 식별자 두 줄(`APP_CREDENTIALS_<SLUG>_IAP_APPLE_BUNDLE_ID`, `APP_CREDENTIALS_<SLUG>_IAP_GOOGLE_PACKAGE_NAME`) 뿐이에요. 글로벌 자격증명은 처음 한 번 발급해 채워두면 이후 모든 슬러그가 공유합니다. Google Play 라면 service account email 을 Play Console 의 각 앱에 권한자로 추가만 하면 돼요. 자세한 절차는 [`소셜 로그인 설정 가이드`](../../start/social-auth-setup.md) 의 IAP 섹션을 참고하세요.

IAP 도 결제처럼 자격이 없으면 stub 으로 fallback 합니다. Apple 과 Google 자격이 양쪽 다 비면 `StubIapAdapter` 가 활성화되고, 호출 시점에 플랫폼에 따라 graceful 503 으로 응답해요. iOS 요청이면 `IAP_006`(APPLE_CONFIG_MISSING), Android 요청이면 `IAP_007`(GOOGLE_CONFIG_MISSING) 입니다. 클라이언트는 이 503 을 받아 "운영자에게 IAP 키 발급 요청" 같은 안내를 띄울 수 있어요.

## 5.5 PortOne PG 결제 활성화 — "키만 채우면 동작"

자주 받는 질문이 있어요. *출시 앱이 아직 없는데, 나중에 PortOne 키만 받으면 바로 결제가 되나, 아니면 추가 코드 작업이 필요한가?*

답은 "코드는 이미 완성·테스트되어 있어 키만 채우면 동작" 입니다. `core-payment` 에는 검증·환불·재결제를 담당하는 `PortOneAdapter`, HMAC SHA-256 과 timestamp 를 검증하는 `PortOneWebhookVerifier`, 부팅 가드(`PaymentAutoConfiguration`), WireMock stub, 단위 테스트가 모두 들어있고, 엔드포인트는 core 공유 `PaymentController` 가 모든 앱에 노출해요. 채널 추가 코드 작업은 없습니다.

실결제를 켜는 절차는 1회성이에요.

1. PortOne 콘솔에서 가맹점을 등록하고, 채널(나이스·토스·이니시스 중 택) 을 활성화한 뒤 v1 key·secret 과 가맹점 식별코드를 발급합니다.
2. `.env.prod` 를 채웁니다 — `APP_PAYMENT_PORTONE_API_V1_KEY`, `_API_V1_SECRET`, `_CUSTOMER_CODE`, 그리고 `_WEBHOOK_SECRET`. webhook secret 이 없으면 `openssl rand -hex 32` 로 생성하세요.
3. PortOne 콘솔의 webhook URL 에 `https://<운영도메인>/api/apps/<slug>/payment/webhook` 을 등록하고 위 webhook secret 을 입력합니다.
4. 재배포하면 끝이에요. v1 key·secret·webhook secret 셋이 모두 차 있어야 `PortOneAdapter` 가 등록됩니다. 일부만 채우면 §4 의 가드가 부팅을 차단해요.

키가 없어도 미리 검증할 수 있어요. 로컬 dev 프로파일은 WireMock stub(`infra/wiremock/mappings/portone-*.json`) 으로 토큰·결제·환불·재결제 전 플로우를 흉내냅니다. 키 발급 전에 `<repo> local test` 로 결제 경로를 e2e 선검증할 수 있어요. 즉 선작업이 가능하며, 키는 출시 직전에 받아 채우면 됩니다.

> 단일 `/payment/webhook` 엔드포인트가 슬러그별 schema 라우팅으로 모든 앱을 처리하므로, 앱마다 별도 webhook 코드나 엔드포인트를 만들 필요가 없어요.

## 6. Feature toggle — `app.features.{payment,iap}`

[`ADR-034`](../../philosophy/adr-034-feature-toggle-lite-mode.md) 의 Lite 모드를 쓰면 `.env.prod` 의 `APP_FEATURES_PAYMENT=false` 또는 `APP_FEATURES_IAP=false` 로 결제 도메인 자체를 끌 수 있습니다. 다만 주의할 점이 있어요. 도메인을 *끄면* `PaymentAutoConfiguration` 과 `IapAutoConfiguration` 이 적용되지 않아 `PaymentPort` 와 `IapPort` 빈이 등록되지 않습니다.

빈이 없어도 `BillingServiceImpl` 은 `ObjectProvider` 로 lazy 의존하므로 부팅 자체는 통과해요. 대신 결제 경로를 *실제로 호출* 하는 시점에 `CommonError.FEATURE_DISABLED`(CMN_009) 를 던집니다. 토글을 끄면 공유 `PaymentController`/`IapController` 빈 자체가 함께 등록되지 않아 부팅도 안전해요 — 앱별 컨트롤러 사본이 없으므로 삭제할 코드도 없습니다.

따라서 결제 도메인을 완전히 쓰지 않으려면 두 가지 중 하나를 선택합니다. 첫째는 토글(`APP_FEATURES_PAYMENT=false`)로 끄는 방법이고, 둘째는 §4 의 fallback(자격 셋 다 비움) 으로 두는 방법이에요. 도그푸딩 단계에서는 후자가 단순하고 안전합니다. 토글의 운영 규칙 전체는 [`Feature Toggle`](../../production/operations/feature-toggle.md) 을 참고하세요.

## 관련 문서

- [`ADR-019 · billing/iap/payment 분리`](../../philosophy/adr-019-billing-iap-payment-separation.md) — 분리 결정의 근거와 PortOne 채택 이유
- [`ADR-020 · 구독 도메인 모델`](../../philosophy/adr-020-subscription-domain-model.md) — Plan·Subscription·PaymentRecord 정책과 webhook 보안
- [`ADR-022 · IAP 서버 알림`](../../philosophy/adr-022-iap-server-notifications.md) — Apple Server Notification V2 와 Google RTDN 처리
- [`ADR-032 · Google Webhook auth`](../../philosophy/adr-032-google-webhook-auth.md) — Pub/Sub push 인증 검증
- [`ADR-034 · Feature Toggle / Lite 모드`](../../philosophy/adr-034-feature-toggle-lite-mode.md) — `app.features.*` 의 설계 근거
- [`Feature Toggle`](../../production/operations/feature-toggle.md) — `app.features.*` 운영 가이드
- [`키 발급 가이드`](../../production/setup/key-issuance.md) — PortOne·IAP 자격 발급 절차
- [`Secret Chain 4-Stage`](../../production/setup/secret-chain-4stage.md) — 자격 동기화 절차
