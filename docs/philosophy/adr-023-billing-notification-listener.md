# ADR-023 — 결제 알림 listener (push 우선, email 별도 사이클)

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~5분

**Status**: Accepted. `core-billing-impl/listener/SubscriptionNotificationListener` 가 결제 도메인 이벤트를 push 알림으로 변환해요. `app.billing.notification.enabled` + `PushPort` bean 조건으로 opt-in 등록됩니다.

---

## 결론부터

구독형 SaaS 의 결제 흐름은 *사용자가 알지 못하는 사이에 권한이 바뀌는* 사건들로 가득해요. 자동 갱신이 실패하거나, 환불이 처리되거나, 가족 공유 해지로 구독이 강제 취소되는 순간 사용자는 *내 권한이 왜 사라졌는지* 알 수 없습니다. 이런 사건을 *즉시 알림으로 사용자에게 전달* 하는 게 결제 알림 listener 의 역할이에요.

본 ADR 은 결제 도메인이 발행하는 이벤트들 — 갱신 성공 / 갱신 실패 / 갱신 포기 (Abandoned) / IAP REFUND / IAP REVOKE — 를 push 알림으로 변환하는 listener 를 정의합니다. 위치는 정책 layer (`core-billing-impl`) 안의 `SubscriptionNotificationListener` 이고, *어떤 이벤트에 어떤 메시지를 보낼지* 의 알림 정책도 같은 모듈에서 관리해요. 채널은 push (FCM) 만 다루고, email 채널은 [`ADR-025`](./adr-025-billing-notification-email-channel.md) 에서 별도로 추가합니다 — push 인프라 (`PushPort`, `FcmPushAdapter`) 가 이미 갖춰져 있는 반면 email 은 별도 도메인 ([`ADR-024`](./adr-024-email-domain-extraction.md)) 으로 추출해야 했기 때문이에요.

이 ADR 은 listener 의 등록 조건 (`@ConditionalOnBean` + `@ConditionalOnProperty`), 이벤트별 처리 매핑, 트랜잭션 경계 (`@TransactionalEventListener(AFTER_COMMIT)` 으로 멱등성 보장), 슬러그 컨텍스트 처리 (push token 이 슬러그별 schema 에 있으므로 listener 시작 시 `SlugContext.set` + finally 정리), 그리고 알림 발송 실패가 비즈 로직을 막지 않게 하는 격리 정책을 다룹니다.

---

## 왜 이런 결정이 필요했나?

결제 도메인이 *이벤트는 정확히 발행하지만 그 이벤트를 받는 listener 가 없는* 상태로는 사용자에게 *권한 변경의 이유* 가 전달되지 않아요. 이벤트는 시스템 내부의 시그널일 뿐이라 *외부 채널 (push / email) 로 변환* 하는 단계가 별도로 필요합니다.

알림이 없을 때 운영에서 실제로 발생하는 시나리오를 보면 그 부담이 명확해요. 자동 갱신 실패 — 카드 한도 초과나 카드 만료 같은 일시적 문제 — 가 발생하면 [`ADR-021`](./adr-021-renewal-failure-policy.md) 의 재시도 정책 (1시간 후, 6시간 후) 이 동작하지만, 사용자가 *알림을 받지 못하면 카드 정보를 갱신할 기회조차 잃어요*. 결국 7시간 후 ABANDONED 처리되어 자동 취소되고, 사용자는 *어느 날 갑자기 Pro 권한이 사라진* 상태를 마주합니다.

환불도 마찬가지예요. PG 환불이 처리되면 PaymentRecord 의 status 가 REFUNDED 로 바뀌고 Subscription 이 CANCELLED 로 전환되지만, 사용자는 *왜 권한이 사라졌는지* 즉시 알 수 없어요. CS 문의로 *내 환불이 잘 처리됐나?* 같은 질문이 누적되는 형태로 운영 부담이 돌아옵니다.

가족 공유 해지나 Apple/Google 측 강제 취소 같은 IAP REVOKE 케이스도 동일해요. *권한이 사라진 사실 자체* 와 *그 이유* 가 사용자에게 즉시 도달해야 *어떤 액션을 취할지* 결정할 수 있습니다.

대안 SaaS — Spotify, Netflix — 가 *결제 실패 / 환불 / 취소 시 즉시 push + email 을 보내는* 것이 표준이 된 이유가 여기 있어요. 알림은 *권한 변경의 사유와 다음 액션* 을 사용자에게 전달하는 채널이고, 이 채널이 없으면 *사용자가 사라진 권한을 추적할 수단* 자체가 막힙니다.

본 ADR 은 그 알림 흐름을 도입하면서, *솔로 운영자가 매 도메인마다 listener 를 직접 짜지 않아도* 되도록 *결제 도메인 안에서 알림 정책을 관리* 하는 형태로 캡슐화합니다.

---

## 결정

| 항목 | 값 | 사유 |
|---|---|---|
| **채널** | **push (FCM) 우선**, email 은 별도 사이클 | core-push 인프라 이미 갖춰짐 (FcmPushAdapter). email 은 SMTP/SendGrid 통합 비용 별도 |
| **listener 위치** | `core-billing-impl/listener/SubscriptionNotificationListener` | 정책 layer 안 — 알림 정책 (어떤 이벤트에 알림? 메시지 내용?) 도 billing 책임 |
| **메시지 템플릿** | `BillingNotificationProperties` (`app.billing.notification.*`) | 한국어 default + 운영자 override |
| **활성화** | `app.billing.notification.enabled=true` + `PushPort` bean 존재 시 | 명시적 opt-in (운영자 결정) |
| **실패 정책** | listener 가 PushPort throw 캐치 + log only | 알림 실패가 비즈로직을 막으면 안 됩니다 |
| **SlugContext** | listener 시작 시 이벤트의 `appSlug` 로 셋업 + finally 정리 | push token 조회가 슬러그별 schema (ADR-018) |

---

## Push vs Email 분리 사유

| 항목 | Push | Email |
|---|---|---|
| 인프라 의존성 | core-push + FCM | core-email (없음) + SMTP/SendGrid |
| 통합 비용 | ✅ 이미 있음 | 별도 사이클 (이메일 도메인 신규 + 외부 서비스 통합) |
| 사용자 즉시성 | 즉시 알림 (앱 알림) | 지연 (사용자가 메일 봐야) |
| 실패 추적 | FCM 응답에 `invalidTokens` | bounce / open rate 별도 추적 |

**선후 관계**: push 우선 — 기본 알림은 push 로 즉시. email 은 push 못 받는 사용자 (앱 미설치, 토큰 만료) 의 fallback 으로 별도 사이클.

---

## 처리 매핑

| 이벤트 | 알림 | 메시지 (default 한국어) |
|---|---|---|
| `SubscriptionRenewalSucceededEvent` | push | "구독이 갱신됐습니다" |
| `SubscriptionRenewalFailedEvent` | push | "결제가 실패했습니다 — 잠시 후 자동 재시도" |
| `SubscriptionRenewalAbandonedEvent` | push | "구독이 자동 취소됐습니다 — 결제 정보 갱신 후 재구독" |
| `IapNotificationProcessedEvent (REFUND)` | push | "환불이 처리됐습니다" |
| `IapNotificationProcessedEvent (REVOKE)` | push | "구독이 취소됐습니다" |
| `IapNotificationProcessedEvent (DID_RENEW)` | **skip** | RenewalSucceeded 와 사실상 동일하나 IAP 는 갱신 빈번 — 알림 피로도 회피 |
| `IapNotificationProcessedEvent (EXPIRED/DID_FAIL_TO_RENEW/OTHER)` | **skip** | 알림 가치 낮음 |

**알림 피로도 (notification fatigue)** — 모든 이벤트에 알림 보내면 사용자 무시. 결제 실패 / 환불 / 취소 같이 사용자 액션이 필요하거나 권한 변경이 큰 케이스만 선별.

---

## Idempotency / 동시성

이벤트 자체는 BillingServiceImpl 의 phase 3 안에서 1회만 발행 — 중복 발행 0.

다만 Spring `@EventListener` 는 default 동기 호출 (publishEvent 호출자 thread). 이는 BillingServiceImpl 의 phase 3 (write TX) 가 commit 된 후 호출됨 (NOT_SUPPORTED + executeWithoutResult 끝난 후). 즉:

- 알림 발송 중 throw → log only (listener 가 catch)
- 알림 발송이 BillingPort 의 본 흐름 trigger 했지만 commit 은 이미 완료 — 데이터 일관성 영향 X

알림 발송이 무거워지는 단계 — *수만 사용자 동시 알림* 같은 — 가 오면 `@Async` listener 로 분리해 별도 thread pool 에서 처리하는 형태로 확장할 수 있어요. 본 ADR 의 동기 listener 는 *현재 트래픽 규모에서 가장 단순한 형태* 로 충분합니다.

---

## Conditional 활성화

```java
@ConditionalOnBean(PushPort.class)              // PushPort 등록된 환경 (= core-push-impl 클래스패스 + FCM/NoOp)
@ConditionalOnProperty(...notification.enabled = true)  // 운영자 명시적 opt-in
@ConditionalOnMissingBean                       // 사용자 override 시 우선
```

→ 4가지 시나리오:
- PushPort 있음 + enabled=true → listener 등록, 알림 발송
- PushPort 있음 + enabled=false → listener 등록 X (이벤트는 발행되지만 noop)
- PushPort 없음 → listener 등록 X (FCM 미통합 환경)
- 사용자가 자기 listener 등록 → 그것이 우선이에요

---

## 검증 (Unit Test)

`SubscriptionNotificationListenerTest` (8건):

1. `renewalSucceeded_sendsPushWithSucceededTemplate`
2. `renewalFailed_sendsPushWithFailedTemplate_andAttemptNoData`
3. `renewalAbandoned_sendsPushWithAbandonedTemplate`
4. `iapRefund_sendsPushWithRefundTemplate`
5. `iapRevoke_sendsPushWithRevokeTemplate`
6. `iapDidRenew_doesNotSendPush` — skip 확인
7. `iapNotification_withoutUserId_skipsPush` — userId null skip
8. `pushFailure_doesNotPropagate_logOnly` — 실패 격리

`CapturingPushPort` (fake) 가 sendToUser 호출을 캡처해요 — ADR-014 (delegation mock 금지) 와 정합합니다.

---

## 대안 비교

### 옵션 A — 동기 listener (default Spring) ★ 채택

- 단순해요. publishEvent 호출자 thread 에서 동작합니다.
- ❌ 알림 발송이 느릴 수 있어요 — FCM API 응답 대기 (~수백 ms).
- ✅ 그러나 BillingPort 의 phase 3 가 NOT_SUPPORTED + 이미 commit 완료된 후 발행이라 트랜잭션 영향이 0이에요.

### 옵션 B — `@Async` listener

- 별도 thread pool 사용.
- ❌ 별도 인프라 (TaskExecutor) 셋업이 필요해요.
- ❌ 에러 추적이 어려워요 (다른 thread).
- 향후 알림 발송 비용이 커질 때 (수만 user 한 번에) 도입을 검토합니다.

### 옵션 C — Outbox 패턴 (이벤트 DB 저장 + 별도 worker)

- 가장 강력합니다. 알림 발송 보장 (worker retry).
- ❌ 인프라가 복잡해져요 — outbox 테이블 + worker process.
- 알림이 critical 한 운영 환경에서 별도 사이클로 도입합니다.

---

## 안 다루는 범위 (다음 사이클)

- **Email listener** — SMTP / SendGrid / SES 통합 + email 도메인 신규
- **알림 발송 메트릭** — Prometheus counter (sent / failed / skipped)
- **사용자 알림 환경설정** — "결제 알림 끄기" 같은 사용자 측 toggle
- **다국어 템플릿** — `BillingNotificationProperties.locale` 별 분기
- **win-back 캠페인** — Abandoned 후 N일 뒤 재구독 유도 알림
- **Outbox 패턴** — 알림 발송 retry / 보장

---

## 관련 파일

- `core/core-billing-api/.../event/IapNotificationProcessedEvent.java` — 신규 이벤트 (I 사이클 분기 후 발행)
- `core/core-billing-impl/.../listener/SubscriptionNotificationListener.java` — 5종 listener
- `core/core-billing-impl/.../BillingNotificationProperties.java` — 템플릿 + opt-in
- `core/core-billing-impl/.../BillingServiceImpl.java#handleIapRenew/Refund/Cancel` — 이벤트 발행 추가
- `core/core-billing-impl/.../BillingAutoConfiguration.java` — listener bean (ConditionalOnBean + Property)
