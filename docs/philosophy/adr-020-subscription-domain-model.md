# ADR-020 · Subscription / Plan / PaymentRecord 도메인 모델 + Webhook 보안

**Status**: Accepted. [`ADR-019`](./adr-019-billing-iap-payment-separation.md) 의 도메인 분리 골격 위에 비즈 로직 + DB 모델 + 트랜잭션 정책 + webhook 보안을 채웠어요. PG (포트원) 결제 검증 → PaymentRecord 저장 → Subscription 활성화의 e2e 흐름이 동작합니다.

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~5분

## 결론부터

구독형 SaaS 의 결제 도메인을 코드로 표현하려면 *네 가지 핵심 개념* 이 필요해요. **Plan** 은 *어떤 가격에 어떤 기능을 제공하는가* 의 정의입니다 (`free`, `basic`, `pro` 같은 코드 + 가격 + 기간). **Subscription** 은 *이 사용자가 어떤 plan 을 언제까지 받고 있는가* 의 사용자별 상태예요 (ACTIVE / CANCELLED / EXPIRED). **PaymentRecord** 는 *언제 어떤 채널로 얼마를 결제했는가* 의 거래 이력입니다 (PG impUid 또는 IAP transactionId 로 식별). **WebhookEvent** 는 *외부 시스템 (PG / Apple / Google) 에서 들어온 비동기 알림* 의 멱등성 보장 기록이에요.

이 네 개념이 [`ADR-019`](./adr-019-billing-iap-payment-separation.md) 의 정책 layer (`core-billing`) 안에서 *결제 → 활성화* 의 e2e 흐름을 만듭니다. 사용자가 PG (포트원) 결제 위젯을 띄우면 클라이언트가 `impUid` 를 받고, 그 `impUid` 를 백엔드가 *PaymentPort.verify* 로 포트원에 재검증한 뒤 *PaymentRecord 저장 → Subscription 활성화* 가 한 트랜잭션에서 완료돼요. 환불은 PG 가 보낸 webhook 이 *HMAC + timestamp + idempotency* 3 중 방어를 통과한 뒤 *PaymentRecord.status 를 REFUNDED 로 변경 + Subscription 을 CANCELLED 로 전환* 하는 흐름입니다.

```
[Flutter] 결제 위젯 → 포트원 → impUid 획득
[Flutter] POST /api/apps/<slug>/payment/verify { impUid, planCode }
[백엔드 PaymentController] → PaymentPort.verify(impUid)         (포트원 REST)
                          ← PaymentResult { status=PAID, amount, paidAt }
                          → BillingPort.activateFromPayment(userId, planCode, paymentResult)
                              ├─ Plan 조회 (planCode 매칭)
                              ├─ 금액 검증 (plan.price == payment.amount)
                              ├─ 중복 결제 검증 (impUid UNIQUE)
                              ├─ PaymentRecord INSERT (status=PAID)
                              ├─ Subscription INSERT (status=ACTIVE, expiresAt=startedAt+plan.duration)
                              └─ SubscriptionDto 반환
```

이 ADR 은 네 개념의 구체 모양을 결정해요. 4 테이블의 컬럼 정의와 관계, *슬러그별 schema 에 위치* 시킨 이유, webhook 의 *3 중 방어* 메커니즘, 그리고 외부 HTTP 호출이 DB 트랜잭션 안에서 connection 을 점유하지 않게 하는 *phase 분리 트랜잭션* 패턴까지가 본 ADR 의 범위입니다.

## 왜 이런 결정이 필요했나?

결제 도메인을 *비즈니스 정책 / 채널 어댑터* 로 분리한 [`ADR-019`](./adr-019-billing-iap-payment-separation.md) 의 골격 위에, *실제 비즈 로직 + DB 모델 + 트랜잭션 정책 + webhook 보안* 을 채워야 운영 가능한 시스템이 돼요. 이 채움 과정에서 *네 가지 결정* 이 자연스럽게 떠오릅니다.

**모델 위치를 어디에 둘 것인가** — `subscriptions.user_id` 가 `users(id)` 를 FK 로 참조해야 하는데, [`ADR-012`](./adr-012-per-app-user-model.md) 의 *앱별 독립 유저 모델* 에서 `users` 테이블은 슬러그별 schema 안에 있어요. 그러면 `subscriptions` 도 같은 schema 에 두어야 *cross-schema FK* 라는 까다로운 영역을 회피할 수 있습니다. core schema 에 통합하면 `appSlug` 컬럼을 추가해 *row-level 격리* 로 우회해야 하는데, 이는 [`ADR-012`](./adr-012-per-app-user-model.md) 가 이미 거부한 패턴이에요.

**Webhook 의 멱등성과 재처리 정책을 어떻게 보장할 것인가** — PG / Apple / Google 의 webhook 은 *네트워크 장애 시 재전송* 되는 것이 정상 동작이에요. 같은 webhook 이 두 번 도착해도 *환불을 두 번 처리하거나 구독을 두 번 만료시키지* 않아야 합니다. 그런데 단순히 *처음 본 것만 처리* 하는 형태로는 부족해요 — 첫 처리가 *중간에 실패* 했을 때 *재시도가 가능* 해야 하니까요.

**외부 HTTP 호출의 트랜잭션 경계를 어떻게 잡을 것인가** — webhook 처리 안에서 *PG verify* 같은 외부 HTTP 호출이 들어가는데, 이게 DB 트랜잭션 안에 있으면 *외부 응답 대기 동안 DB connection 을 점유* 하는 anti-pattern 이 됩니다. PG 가 응답에 5 초가 걸리면 connection 도 5 초 동안 잡혀 있어, 트래픽이 몰리면 *connection pool 고갈* 이 곧바로 발생해요.

**Webhook 보안을 어떻게 다질 것인가** — webhook endpoint 는 *외부에 공개된 URL* 이라 *누구나 임의의 payload 로 POST* 할 수 있어요. 인증이 없으면 *공격자가 가짜 환불 webhook 을 보내 사용자 구독을 임의로 취소* 할 수 있습니다. 단순한 API key 만으로는 부족해서 *서명 검증 + 시간 검증 + idempotency* 의 다층 방어가 필요해요.

이 결정이 답해야 할 물음은 이거예요.

> **결제 도메인 모델을 슬러그별 schema 에 어떻게 정착시키고, webhook 의 멱등성·트랜잭션 경계·보안을 어떻게 다층으로 방어할 것인가?**

## 결정 1 — Subscription / Plan / PaymentRecord 를 슬러그별 schema 에

결제 도메인의 4 테이블을 *어디에 두는가* 의 결정은 [`ADR-005`](./adr-005-db-schema-isolation.md) 의 *앱당 schema 격리* 와 [`ADR-012`](./adr-012-per-app-user-model.md) 의 *앱별 독립 유저 모델* 에 의해 사실상 결정돼요. `subscriptions.user_id` 가 `users(id)` 를 FK 로 참조해야 하는데, `users` 테이블이 슬러그별 schema 에 위치하므로 *subscriptions 도 같은 schema* 에 두지 않으면 *cross-schema FK 참조* 라는 PostgreSQL 에서도 까다로운 영역으로 들어가게 됩니다.

도메인 의미 측면에서도 슬러그별 schema 가 자연스러워요. *앱마다 독립적인 비즈니스* 라 *어느 앱의 구독이 다른 앱의 구독과 연결될 일이 거의 없고*, *cross-app subscription* 같은 개념도 우리 환경에는 등장하지 않습니다. core schema 에 통합하는 대안은 *appSlug 컬럼을 모든 행에 추가하고 모든 쿼리에 WHERE 절을 강제* 하는 row-level 격리가 되는데, 이는 [`ADR-012`](./adr-012-per-app-user-model.md) 가 *유저 모델에서 이미 거부한 패턴* 이라 결제 도메인에서도 같은 거부 이유가 그대로 적용돼요.

채택한 형태는 *plans / subscriptions / payment_records / webhook_events* 4 테이블을 모든 슬러그 schema 에 동일하게 두는 형태입니다. V008 / V009 / V010 마이그레이션이 *기존 인증 도메인의 V001~V006 패턴* 과 같은 방식으로 모든 슬러그 schema 에 자동 적용되고, `tools/new-app/new-app.sh` 가 신규 앱을 생성할 때마다 *4 개 테이블 + free plan seed 까지 자동으로 만들어* 줍니다. 운영자가 새 앱을 추가할 때 별도 SQL 작업이 필요 없어요.

## 결정 2 — DB 모델

```sql
-- V008: plans (각 앱 schema 의 plan 정의)
CREATE TABLE plans (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,         -- 'free' / 'basic' / 'pro'
    name VARCHAR(100) NOT NULL,
    price_krw BIGINT NOT NULL DEFAULT 0,       -- 0 = free
    duration_days INTEGER,                     -- NULL = 무제한
    description TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

-- V009: payment_records + subscriptions
CREATE TABLE payment_records (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    channel VARCHAR(20) NOT NULL,              -- IAP / PG
    external_id VARCHAR(255) NOT NULL UNIQUE,  -- impUid 또는 IAP transactionId
    amount BIGINT NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'KRW',
    status VARCHAR(20) NOT NULL,               -- PAID / FAILED / CANCELLED / REFUNDED
    paid_at TIMESTAMPTZ,
    refunded_at TIMESTAMPTZ,
    raw_response JSONB,                        -- 포트원/Apple/Google 원본 응답
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE subscriptions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    plan_id BIGINT NOT NULL REFERENCES plans(id),
    status VARCHAR(20) NOT NULL,               -- ACTIVE / CANCELLED / EXPIRED
    started_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ,                     -- NULL = 무제한
    cancelled_at TIMESTAMPTZ,
    cancel_reason TEXT,
    payment_record_id BIGINT REFERENCES payment_records(id),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

-- V010: webhook_events (idempotency 보장)
CREATE TABLE webhook_events (
    id BIGSERIAL PRIMARY KEY,
    external_id VARCHAR(255) NOT NULL,
    source VARCHAR(50) NOT NULL DEFAULT 'portone',
    payload JSONB NOT NULL,
    received_at TIMESTAMPTZ NOT NULL,
    processed_at TIMESTAMPTZ,                  -- 성공 처리 시각 (실패 시 NULL → retry 가능)
    process_error TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX uk_webhook_events_external_id ON webhook_events(source, external_id);  -- (출처, 거래ID) 1회만
```

Hibernate 6 의 `@JdbcTypeCode(SqlTypes.JSON)` 으로 `String` 필드에 직접 JSONB 를 매핑합니다. JSON ↔ POJO 변환은 호출 측에서 ObjectMapper 로 처리해요 (Webhook payload 는 raw 로 유지하는 편이 디버깅에 유리해요).

## 결정 3 — 트랜잭션 경계: handleWebhook 의 phase 분리

순진한 구현은 외부 HTTP 호출이 DB 트랜잭션 안에 있어 connection 점유 + race + 실패 로그 롤백의 3중 문제를 일으킵니다:

```java
// ❌ 순진한 구현
@Transactional
public void handleWebhook(...) {
    if (existsByExternalId(...)) return;
    save(new WebhookEvent(...));
    PaymentResult r = paymentPort.verify(externalId); // ★ HTTP, 10초 timeout, connection 점유
    paymentRecordRepository.findByExternalId(...).ifPresent(...);
    event.markProcessed();  // 실패 시 markFailed 호출은 catch 에서, throw 후 트랜잭션 롤백 → 잃음
}
```

채택한 패턴 — class-level `@Transactional` + `handleWebhook` 만 `NOT_SUPPORTED` override + 내부 phase 마다 `TransactionTemplate`:

```java
@Override
@Transactional(propagation = Propagation.NOT_SUPPORTED)
public void handleWebhook(String source, String externalId, String payloadJson) {
    // Phase 1 (TX): WebhookEvent 기록 + idempotency
    Long eventId = txTemplate.execute(s -> recordWebhookEvent(source, externalId, payloadJson));
    if (eventId == null) return;  // 이미 성공 처리됨

    // Phase 2 (NO TX): 외부 HTTP 호출
    PaymentResult result;
    try {
        result = paymentPort.verify(externalId);
    } catch (RuntimeException e) {
        txTemplate.executeWithoutResult(s -> markEventFailed(eventId, e));  // 실패 기록은 별도 TX
        throw e;
    }

    // Phase 3 (TX): PaymentRecord/Subscription 동기화 + markProcessed
    txTemplate.executeWithoutResult(s -> applyVerificationResult(eventId, externalId, result));
}
```

이 분리가 해결하는 것:

- **Connection 점유**: 외부 HTTP 호출이 DB connection 을 잡지 않아요 → connection pool 을 보호합니다
- **Race 견고함**: Phase 1 의 INSERT 가 race 시 `DataIntegrityViolationException` 으로 떨어지면 fallback 으로 기존 row 를 재조회해요 → 같은 webhook 이 두 번 와도 결과가 동일해요
- **실패 로깅 보존**: Phase 2 실패 시 markFailed 가 자기 TX 에서 commit → main throw 가 outer TX 롤백 시 영향을 받지 않아요 (`processed_at` 은 NULL 로 유지 → retry 가능)

## 결정 4 — Webhook 보안 (3중 방어)

### 1. HMAC SHA-256 서명 검증

`PortOneWebhookVerifier.verifySignature(body, signatureHex)`:

- HMAC SHA-256 으로 raw body + 서버 secret 서명 계산
- 클라이언트 헤더의 `X-Portone-Signature` 와 constant-time compare
- 디코딩 실패 / 길이 불일치는 모두 false 반환

### 2. Timestamp 검증 (replay 방지)

`PortOneWebhookVerifier.verifyTimestamp(timestampSeconds)`:

- 현재 시각과 timestamp 차이가 tolerance (default 300초=5분) 이내인지 확인
- 과거/미래 둘 다 같은 윈도우 적용 (clock skew 대응)

### 3. Idempotency (DB 레벨)

`webhook_events.UNIQUE(source, external_id)`:

- 같은 (출처, 거래ID) 가 두 번 처리되지 않도록 DB 가 보장
- `existsBySourceAndExternalIdAndProcessedAtIsNotNull` 체크: 이미 **성공** 처리된 event 만 skip → 실패한 event 는 retry 가능 (markFailed 가 `processed_at` 을 건드리지 않음)
- Race condition: 두 동시 webhook 이 모두 not-exists 보고 둘 다 INSERT 시 `DataIntegrityViolationException` → 두 번째 호출이 fallback 으로 기존 row 재조회

### Prod fail-fast (운영 안전망)

`PaymentAutoConfiguration` 의 `PortOneProdConfigGuard` 가 prod profile 부팅 시 검증:

- `APP_PAYMENT_PORTONE_API_V1_KEY/SECRET` 미설정 → `IllegalStateException` (`StubPaymentAdapter` 가 운영에서 모든 결제 throw 하는 위험 차단)
- `APP_PAYMENT_PORTONE_WEBHOOK_SECRET` 미설정 → `IllegalStateException` (검증기 미등록 시 누구나 webhook 위조 가능 — 보안 사고 차단)

## BillingPort 의 entitled subscription 정책

`findActiveSubscription(userId)` 는 **status 가 ACTIVE 또는 CANCELLED 이지만 expires_at 미경과** 인 구독을 반환해요. Spotify/Netflix 식 정책 — 사용자가 결제 주기 중간에 취소해도 expires_at 까지는 서비스를 사용할 수 있어요:

```java
@Query(
    "SELECT s FROM Subscription s "
        + "WHERE s.userId = :userId "
        + "AND s.status IN (SubscriptionState.ACTIVE, SubscriptionState.CANCELLED) "
        + "AND (s.expiresAt IS NULL OR s.expiresAt > :now) "
        + "ORDER BY s.startedAt DESC")
List<Subscription> findEntitledByUserId(Long userId, Instant now, Pageable pageable);
```

EXPIRED 는 명시적으로 제외해요 — 만료된 구독은 권한이 없어요. 무료/무제한 plan (expires_at = NULL) 도 통과해요.

## 검증 (2026-05-01, template-spring main)

```
컴파일: core-billing-api/impl + core-payment-api/impl — PASS
ArchUnit r1~r22 (BootstrapArchitectureTest): PASS
   r18 (dto = record/sealed) — enum 4개 (PaymentChannel/PaymentRecordStatus/SubscriptionState/PaymentStatus) 를 api 루트로 이동
   r19 (dto suffix) — WebhookPayload → WebhookMessage 로 rename
PortOneWebhookVerifierTest: 14/14 PASS (Signature 6 + Timestamp 5 + Combined 3)
새 앱 e2e (tools/new-app/new-app.sh): 자동 생성 + V001~V010 적용 + admin user SELECT 통과
```

## 핵심 파일

| 경로 | 역할 |
|---|---|
| `core/core-billing-impl/.../entity/{Plan,Subscription,PaymentRecord,WebhookEvent}.java` | 신규 — BaseEntity 상속 |
| `core/core-billing-impl/.../repository/*Repository.java` | Spring Data JPA |
| `core/core-billing-impl/.../BillingServiceImpl.java` | BillingPort 구현 — TransactionTemplate phase 분리 |
| `core/core-billing-impl/.../scheduler/SubscriptionExpirationScheduler.java` | @Scheduled cron + slug iter (B 사이클) |
| `core/core-billing-impl/.../scheduler/SubscriptionRenewalScheduler.java` | 만료 임박 식별 + RenewalDueEvent 발행 (F-MVP 사이클) |
| `core/core-billing-api/event/SubscriptionRenewalDueEvent.java` | ApplicationEvent record (F-MVP) |
| `core/core-billing-impl/.../scheduler/SubscriptionRenewalListener.java` | RenewalDueEvent 처리 → renewSubscription 호출 (G 사이클) |
| `core/core-payment-api/PaymentPort.java` | chargeAgain 시그니처 추가 (G 사이클) |
| `core/core-payment-impl/PortOneAdapter.java` | `/subscribe/payments/again` 호출 구현 (G 사이클) |
| `infra/wiremock/mappings/portone-subscribe-again.json` | PortOne 재청구 API stub (G 사이클) |
| `core/core-iap-impl/AppleAppStoreAdapter.java` | Apple App Store Server API + ES256 JWT (D 사이클) |
| `core/core-iap-impl/AppleJwsVerifier.java` | JWS cert chain + ES256 signature 검증 (D-secure 사이클) |
| `core/core-iap-impl/src/main/resources/apple-root-ca-g3.cer` | Apple Root CA G3 (trust anchor, public) |
| `core/core-iap-impl/GooglePlayAdapter.java` | Google Play Developer API + service account OAuth2 (D 사이클) |
| `core/core-iap-impl/IapAdapter.java` | platform 라우팅 composite (D 사이클) |
| `infra/wiremock/mappings/{apple-transaction-lookup,google-oauth-token,google-play-subscription-get}.json` | IAP API stubs |
| `core/core-billing-api/BillingPort.java` | 시그니처 (activateFromPayment / findActiveSubscription / cancelSubscription / handleWebhook / findPaymentByExternalId / expireOverdueSubscriptions) |
| `core/core-billing-api/dto/{PlanDto,SubscriptionDto,PaymentRecordDto}.java` | DTO records |
| `core/core-billing-api/{SubscriptionState,PaymentChannel,PaymentRecordStatus}.java` | 상태 enum (api 루트, ArchUnit r18 정합) |
| `core/core-payment-api/PortOneWebhookVerifier.java` | HMAC + timestamp 검증 (apps/* 도 import 가능하도록 api 모듈에 위치) |
| `core/core-payment-impl/PaymentAutoConfiguration.java` | PortOneAdapter / Verifier / ProdConfigGuard Bean |
| `tools/new-app/new-app.sh` heredoc | V008~V010 SQL + `<Slug>PaymentController` 생성 |

## 결정 5 — Subscription 만료 자동 sweep ([B 사이클 추가])

운영 시간이 흐르면 expires_at 가 경과한 구독이 status=ACTIVE 또는 CANCELLED 로 남게 돼요. 외부 갱신 신호 (Apple/Google webhook) 없이도 자체 cron 으로 EXPIRED 를 마킹합니다.

```
@Scheduled(cron = "0 0 * * * *")  // 매시 정각
public void expireOverdueSubscriptions() {
    for (String slug : registeredSlugs) {
        SlugContext.set(slug);
        try { billingPort.expireOverdueSubscriptions(); }
        finally { SlugContext.clear(); }
    }
}
```

핵심:

- **슬러그 발견** — Spring `Map<String, DataSource>` 주입 → `<slug>DataSource` Bean 이름에서 slug 를 추출해요 (sorted). 새 앱 추가 시 자동으로 인식돼요 (수동 등록 X).
- **SlugContext + SchemaRoutingDataSource** ([`ADR-018`](./adr-018-schema-routing-datasource.md)) 정합 — 각 slug 마다 thread-local set → 자동 라우팅됩니다.
- **격리** — 한 슬러그 sweep 실패가 다른 슬러그를 막지 않아요 (try/catch in loop).
- **Opt-in** — `app.billing.scheduler.enabled=true` 일 때만 Bean 이 등록돼요. 운영에서만 활성화하고, test/dev 는 false 로 유지해요.
- **Cron override** — `app.billing.scheduler.expiration-cron` 환경변수로 cadence 를 바꿀 수 있어요 (default = 매시 정각).

`expireOverdueSubscriptions()` 의 query: `status IN (ACTIVE, CANCELLED) AND expires_at IS NOT NULL AND expires_at < now` 예요. 무제한 plan (expires_at NULL) 은 제외하고, 이미 EXPIRED 도 제외돼요 (idempotent).

## 결정 6 — 갱신 임박 식별 + ApplicationEvent ([F-MVP 사이클 추가])

만료 임박 (예: 24시간 이내) 인 ACTIVE 구독을 식별하여 Spring `ApplicationEvent` 로 발행해요. 호출 측 (이벤트 listener) 이 받아 PG 재청구 / 알림 발송 / 만료 통보 등을 처리합니다. 실제 PG 재청구 로직은 다음 사이클로 미뤄요 (PortOne `customer_uid` 기반 billing key 통합 시).

```java
@Scheduled(cron = "0 0 0 * * *")  // 매일 자정
public void publishRenewalDueEvents() {
    for (String slug : registeredSlugs) {
        SlugContext.set(slug);
        try {
            for (var dto : billingPort.findSubscriptionsExpiringWithin(window)) {
                eventPublisher.publishEvent(
                    new SubscriptionRenewalDueEvent(dto.id(), dto.userId(), dto.planId(), dto.expiresAt(), slug));
            }
        } finally { SlugContext.clear(); }
    }
}
```

- **Query**: `status = ACTIVE AND expires_at >= now AND expires_at < deadline`. CANCELLED 는 사용자 의도 취소이므로 제외해요 (갱신 안 함). 무제한 plan (expires_at NULL) 도 제외합니다.
- **Window override** — `app.billing.scheduler.renewal-window=PT12H` 같이 ISO-8601 Duration 으로 변경 가능해요 (default `P1D`).
- **Cron override** — `app.billing.scheduler.renewal-cron` (default 매일 자정) 으로 운영자가 조정합니다.
- **이벤트 기반 분리** — billing 이 직접 PG 를 호출하지 않고 listener 가 처리해요. 결제 실패 / 재시도 / 알림은 listener 의 책임입니다.

## 결정 7 — PG 재청구 (chargeAgain + RenewalListener) ([G 사이클 추가])

F-MVP 의 RenewalDueEvent 를 listener 가 받아 실제 PG 재청구 + 새 Subscription 활성화. PortOne v1 의 `/subscribe/payments/again` API + customer_uid (billing key) 활용.

### DB 모델 확장

- `payment_records.customer_uid VARCHAR(255)` 컬럼 추가 (nullable). Subscription-style 첫 결제 시 PortOne 응답의 `customer_uid` 캡처 → 이후 재청구의 key.
- new-app.sh heredoc V009 + test V011 동기화.

### PaymentPort.chargeAgain

```java
PaymentResult chargeAgain(String customerUid, long amount, String merchantUid, String productName);
```

- PortOneAdapter 가 `POST /subscribe/payments/again` 호출 (ObjectMapper 로 body 직렬화 — escape 안전).
- 응답 mapping 은 verify 와 동일 (새 impUid 가 부여된 결제 결과).
- WireMock stub: `infra/wiremock/mappings/portone-subscribe-again.json`.

### BillingPort.renewSubscription

```java
Optional<SubscriptionDto> renewSubscription(long subscriptionId);
```

handleWebhook 와 동일한 phase 분리 패턴 — `@Transactional(NOT_SUPPORTED)` + 내부 phase 마다 txTemplate:

1. **Phase 1 (read TX)**: 대상 sub + plan + paymentRecord 를 조회해요. customer_uid 가 없으면 `Optional.empty()` (one-time 결제는 갱신 불가).
2. **Phase 2 (NO TX)**: paymentPort.chargeAgain 외부 HTTP 를 호출해요.
3. **Phase 3 (write TX)**: 새 PaymentRecord (customer_uid 보존) + 새 Subscription (새 startedAt/expiresAt) 을 save 해요.

### SubscriptionRenewalListener

```java
@EventListener
public void onRenewalDue(SubscriptionRenewalDueEvent event) {
    try {
        SlugContext.set(event.appSlug());
        billingPort.renewSubscription(event.subscriptionId())
                .ifPresentOrElse(/* log success */, /* log skip */);
    } catch (Exception e) { log.error(...); }
    finally { SlugContext.clear(); }
}
```

이벤트 기반 분리 — billing 자체는 PG 호출 안 하고, listener 가 trigger. listener 자체는 단순 dispatcher.

### Custom UID 캡처 (활성화)

`activateFromPayment` 가 PaymentResult 의 `customerUid` 를 PaymentRecord 에 저장 (one-time 결제는 null 유지). 다음 만료 임박 시 RenewalScheduler 가 발견 → listener → renewSubscription → chargeAgain 가 그 customer_uid 사용.

## 결정 8 — IAP (Apple/Google) 영수증 검증 ([D 사이클 추가])

iOS (Apple StoreKit) / Android (Google Play) 인앱 결제 영수증을 검증 후 Subscription 활성화. 흐름은 PG 와 동일하나 channel=IAP, 외부 검증 API 가 platform 별 다름.

### Adapter 구조

```
IapAdapter (composite)
   ├─ Platform.IOS     → AppleAppStoreAdapter
   └─ Platform.ANDROID → GooglePlayAdapter
```

### AppleAppStoreAdapter

- **Auth**: App Store Connect API key (.p8) 으로 ES256 JWT 발급 (50분 캐시). DER → JOSE P1363 변환 직접 구현 (외부 lib 없이 JDK `Signature`).
- **API**: `GET /inApps/v1/transactions/{transactionId}` → 응답의 `signedTransactionInfo` (JWS) 파싱.
- **JWS 서명 검증** ([D-secure 사이클]): {@code AppleJwsVerifier} 가 cert chain validation + ES256 signature
  검증을 수행해요. {@code classpath:apple-root-ca-g3.cer} (Apple Root CA G3) 를 trust anchor 로 {@code
  CertPathValidator} (PKIX) 가 leaf → intermediate → root 를 검증하고, 그 leaf cert 의 public key 로 ES256 서명을 확인해요.
  JOSE P1363 → DER ECDSA 변환은 직접 구현했어요. revocation (OCSP/CRL) 은 OFF — Apple cert 가 짧은 lifetime 이라 운영 부하를 회피하려는 결정이에요.

### GooglePlayAdapter

- **Auth**: Service account JSON 의 RSA private_key 로 RS256 JWT → POST `oauth2.googleapis.com/token` → access token (1시간 캐시).
- **API**: `GET /androidpublisher/v3/applications/{pkg}/purchases/subscriptionsv2/tokens/{token}` → SubscriptionPurchaseV2 응답.

### BillingPort.activateFromIap

```java
SubscriptionDto activateFromIap(long userId, String planCode, PurchaseVerificationResult result);
```

- PG 의 activateFromPayment 와 거의 동일한 로직 (PaymentRecord INSERT + Subscription INSERT) — 차이는 channel=IAP, externalId=transactionId, customerUid 슬롯에 originalTransactionId 저장 (갱신 식별용).
- Apple/Google 의 expiresAt 우선 사용, 없으면 plan.duration.

### IapController (heredoc)

`/api/apps/<slug>/iap/verify` — body: `{platform, receiptData, productId, planCode}` → IapPort.verifyReceipt → BillingPort.activateFromIap.

### Opt-in (platform 별)

`APP_IAP_APPLE_*` 또는 `APP_IAP_GOOGLE_*` 키가 채워졌을 때만 해당 adapter 를 등록해요. 한 platform 만 운영해도 돼요. 둘 다 미설정 시 StubIapAdapter 로 fallback 합니다.

### 슬러그별 bundle_id / package_name (D-multi 사이클)

ADR-005/012/013 의 멀티앱 격리와 정합해요 — bundle_id (Apple) / package_name (Google) 은 슬러그마다 달라요. Global 키 (.p8, service-account JSON) 는 한 dev 계정 안에서 공유해요. Property 분리:

- **Global** (`app.iap.*`): API URLs / .p8 / service-account JSON / key-id / issuer-id
- **Per-slug** (`app.credentials.<slug>.iap-*`): bundle-id / package-name

```yaml
app:
  iap:
    apple:
      api-url: ...
      key-id: ...           # global API key
      private-key: ...
    google:
      service-account-json: ...
  credentials:
    gymlog:
      iap-apple-bundle-id: com.storkspear.pkg.gymlog
      iap-google-package-name: com.storkspear.pkg.gymlog
    sumtally:
      iap-apple-bundle-id: com.storkspear.pkg.sumtally
      iap-google-package-name: com.storkspear.pkg.sumtally
```

`IapAdapter` (composite) 가 `SlugContext.get()` 으로 슬러그를 식별해요 → `IapAppCredentialProperties.findByAppSlug` lookup → 각 platform adapter 의 `verify(request, bundleId/packageName)` 를 호출합니다. `AppleAppStoreAdapter` 의 ES256 JWT 캐시는 `Map<bundleId, JwtCacheEntry>` 로 슬러그별로 분리돼요.

**APP_PACKAGE_PREFIX**: `.env` 의 prefix 환경변수 — `new-app.sh` 가 새 앱 생성 시 자동으로 `${PREFIX}.<slug>` 형태 default 채움. Flutter applicationId / Apple bundleId / Google packageName 통일.

## 안 다루는 범위 (다음 사이클)

- **Apple Server Notifications V2 webhook** — 자동 갱신 / 환불 / 만료 통보를 처리해요. 현재는 verify 만, webhook 처리는 X 예요.
- **Google Real-time Developer Notifications (RTDN)** — Pub/Sub 을 통한 실시간 갱신/환불 통보를 다뤄요.
- **갱신 실패 정책** — chargeAgain (PG) 또는 IAP renewal 이 FAILED 반환 시 retry / 사용자 알림 / 자동 cancel 을 처리해요. 현재는 log only 예요.
- **분산 lock** — 다중 인스턴스 운영 시 cron + listener 중복 실행을 방지해요 (Quartz cluster / shedlock).
- **분산 lock** — 다중 인스턴스 운영 시 cron 중복 실행을 방지해요 (Quartz cluster / shedlock). 단일 Mac mini 운영에선 불필요해요.
- **PortOne v2 API 마이그레이션** — 현재 v1 (`api.iamport.kr` + impUid) 이에요. v2 는 `api.portone.io` + paymentId 기반이에요. PortOneAdapter + WireMock stub 동시 마이그레이션이 필요해요.
- **Plan 관리 admin UI** — 현재 Plan INSERT 는 SQL 직접 입력이에요. 운영 시 admin endpoint + RBAC 가 필요해요.
- **PortOne 토큰 캐시 thundering herd** — `PortOneApiClient.getAccessToken()` 의 synchronized 블록 안에서 외부를 호출해요. 토큰 만료 직전 동시 N개 요청 시 직렬화돼요. sandbox 단계에선 영향이 미미하고, 운영 트래픽 확보 후 double-checked locking 또는 lazy refresh 분리를 검토합니다.
- **Webhook canonical form** — 현재 verifier 는 raw body 만 HMAC. PortOne v2 의 `v1:timestamp.body` 같은 canonical form 미구현 (v2 마이그레이션 시 정합).

## 관련 ADR

- [`ADR-005 · 단일 Postgres + 앱당 schema`](./adr-005-db-schema-isolation.md) — Subscription/Plan/PaymentRecord 위치 결정의 근거
- [`ADR-009 · BaseEntity 공통 슈퍼클래스`](./adr-009-base-entity.md) — 4개 entity 모두 BaseEntity 상속
- [`ADR-011 · 모듈 안 레이어드 + 포트/어댑터`](./adr-011-layered-port-adapter.md) — BillingPort/PaymentPort 의 layer 관계
- [`ADR-014 · Delegation mock 금지`](./adr-014-no-delegation-mock.md) — PortOneWebhookVerifierTest 가 pure unit (외부 mock 0)
- [`ADR-016 · DTO Mapper 금지`](./adr-016-dto-mapper-forbidden.md) — Entity.toDto() 패턴 4개 적용
- [`ADR-018 · SchemaRoutingDataSource`](./adr-018-schema-routing-datasource.md) — slug 별 schema 라우팅으로 본 4개 테이블도 자동 격리
- [`ADR-019 · billing/iap/payment 도메인 분리`](./adr-019-billing-iap-payment-separation.md) — 본 ADR 의 직전 결정
