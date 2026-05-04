# ADR-023 — 결제 알림 listener (push 우선, email 별도 사이클)

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~5분

**상태**: 채택 (2026-05-02)
**전제**: ADR-019 (billing/iap/payment 분리), ADR-021 (renewal 실패 정책), ADR-022 (IAP server notifications)
**연관**: J 사이클 — 사용자 알림 발송

---

## 결론부터

ADR-021 / ADR-022 가 발행한 결제 도메인 이벤트 (`SubscriptionRenewalFailedEvent` / `AbandonedEvent` / `SucceededEvent` / `RefundEvent` / `RevokeEvent`) 를 push 알림으로 변환하는 listener 를 추가합니다.

email 채널은 별도 사이클 (ADR-024 → ADR-025) 로 미루고 push 만 우선. 이유: 당시 EmailPort 가 core-auth 안에 묶여 있어 billing 이 import 불가. Idempotency 는 Spring `@TransactionalEventListener(AFTER_COMMIT)` 으로 보장.

---

## 배경

H 사이클 (`SubscriptionRenewalFailedEvent` / `AbandonedEvent` / `SucceededEvent`) 과 I 사이클 (REFUND / REVOKE 처리) 이 모두 **이벤트는 발행되나 listener 부재**. 운영 시:

- 갱신 실패 시 사용자가 알지 못함 → 다음 갱신도 실패 → 결국 ABANDONED + auto-cancel
- 환불 처리 시 사용자가 즉시 인지 X → 권한 사라진 이유 모름
- 강제 취소 (가족 공유 해지 등) 도 동일

대안 SaaS (Spotify/Netflix) 는 결제 실패 / 환불 / 취소 시 즉시 push + email 발송. 본 ADR 은 그 흐름을 도입.

---

## 결정

| 항목 | 값 | 사유 |
|---|---|---|
| **채널** | **push (FCM) 우선**, email 은 별도 사이클 | core-push 인프라 이미 갖춰짐 (FcmPushAdapter). email 은 SMTP/SendGrid 통합 비용 별도 |
| **listener 위치** | `core-billing-impl/listener/SubscriptionNotificationListener` | 정책 layer 안 — 알림 정책 (어떤 이벤트에 알림? 메시지 내용?) 도 billing 책임 |
| **메시지 템플릿** | `BillingNotificationProperties` (`app.billing.notification.*`) | 한국어 default + 운영자 override |
| **활성화** | `app.billing.notification.enabled=true` + `PushPort` bean 존재 시 | 명시적 opt-in (운영자 결정) |
| **실패 정책** | listener 가 PushPort throw 캐치 + log only | 알림 실패가 비즈로직 막으면 안 됨 |
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

향후 비동기 발송 (`@Async`) 로 분리 가능 (별도 사이클).

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
- 사용자가 자기 listener 등록 → 그것 우선

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

`CapturingPushPort` (fake) 가 sendToUser 호출 캡처 — ADR-014 (delegation mock 금지) 정합.

---

## 대안 비교

### 옵션 A — 동기 listener (default Spring) ★ 채택

- 단순. publishEvent 호출자 thread.
- ❌ 알림 발송이 느릴 수 있음 — FCM API 응답 대기 (~수백 ms).
- ✅ 그러나 BillingPort 의 phase 3 가 NOT_SUPPORTED + 이미 commit 완료된 후 발행이라 트랜잭션 영향 0.

### 옵션 B — `@Async` listener

- 별도 thread pool.
- ❌ 별도 인프라 (TaskExecutor) 셋업.
- ❌ 에러 추적 어려움 (다른 thread).
- 향후 알림 발송 비용이 커질 때 (수만 user 한 번에) 도입.

### 옵션 C — Outbox 패턴 (이벤트 DB 저장 + 별도 worker)

- 가장 강력. 알림 발송 보장 (worker retry).
- ❌ 인프라 복잡 — outbox 테이블 + worker process.
- 운영 시 알림 critical 한 환경에서 별도 사이클 도입.

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
