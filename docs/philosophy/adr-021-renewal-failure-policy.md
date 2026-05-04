# ADR-021 — Subscription 자동 갱신 실패 정책

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~7분

**Status**: Accepted. `BillingServiceImpl.renewSubscription` 이 3 회 백오프 (1h → 6h → 24h) 재시도 + ABANDONED 시 auto-cancel + 3 종 이벤트 발행. `renewal_attempts` 테이블에 시도 이력 영속.

---

## 결론부터

자동 갱신 결제는 *반드시 한 번에 성공하지 않는* 비즈니스 영역이에요. 카드 한도 일시 초과, 카드사 점검 시간대, 네트워크 timeout 같은 *회복 가능한 실패* 와 카드 만료 / 사용자 결제 거부 같은 *영구 실패* 가 섞여 들어옵니다. 첫 시도 실패만으로 구독을 즉시 취소하면 *일시 장애로 사용자 권한이 갑자기 사라지는* 사고가 생기고, 무한 재시도하면 *영구 실패한 카드에도 PG 호출이 누적* 되어 비용과 운영 피로가 쌓여요.

본 ADR 은 *3 회 백오프 (1h → 6h → 24h) 재시도 + 최종 실패 시 명시적 auto-cancel* 의 갱신 실패 정책을 정의합니다. 백오프 간격은 *카드 한도 초기화 주기 (24h)* 를 cover 하면서 *일시 네트워크 장애* 같은 짧은 회복 시간도 흡수하는 형태로 잡았어요. 3 회 시도가 모두 실패하면 `ABANDONED` 로 분류되어 구독이 `cancel_reason="renewal_failed_after_3"` 으로 명시 취소되고, 사용자에게는 별도 알림 listener ([`ADR-023`](./adr-023-billing-notification-listener.md)) 가 *push + email* 로 통보합니다.

이 정책의 핵심 모델은 `RenewalAttempt` 테이블이에요. *각 갱신 시도의 횟수 / 시각 / 결과 / error code* 가 영속되어 *운영자가 어떤 사용자의 어느 갱신이 왜 실패했는지* 를 추적할 수 있고, *이력이 누적되면 카드 한도 갱신 시간대 / 자주 실패하는 PG 채널* 같은 비즈니스 시그널도 분석할 수 있어요. webhook 과 scheduler 가 동시에 같은 구독을 재시도하는 race 는 advisory lock 으로 직렬화하고, attempt_no UNIQUE 제약이 추가 방어선으로 작동합니다.

이 ADR 의 범위는 백오프 간격 선정 근거, `RenewalAttempt` 테이블 설계와 멱등성 보장, scheduler / webhook 동시성 처리, 3 종 이벤트 (`SubscriptionRenewalSucceededEvent` / `FailedEvent` / `AbandonedEvent`) 의 분리 사유, 그리고 phase 분리 트랜잭션 패턴 ([`ADR-020`](./adr-020-subscription-domain-model.md) 의 webhook 패턴 재사용) 까지입니다.

---

## 왜 이런 결정이 필요했나?

자동 갱신 정책이 *단순 fail-fast* 형태로 시작하면 곧 운영 부담이 누적돼요. 결제 실패가 *회복 가능한 일시 장애* 인지 *영구 실패* 인지를 *한 번의 시도로* 구분할 길이 없고, 첫 실패만으로 구독을 종료하면 *카드 한도가 다음 날 회복되었을 사용자* 의 권한이 갑자기 사라집니다. 결제 갱신 같은 *장기 비즈니스 흐름* 에는 *재시도 정책이 정상 동작의 일부* 라는 사실을 정직하게 받아들여야 해요.

같은 영역의 표준 SaaS — Stripe, Spotify, Netflix — 가 *Smart Retries* 같은 형태로 재시도 정책을 두는 이유가 여기 있습니다. Stripe 의 *Smart Retries* 는 카드 발급사의 패턴 데이터를 학습해 *언제 재시도하면 성공률이 높은지* 까지 자동 결정하지만, 우리 규모에서는 그런 학습 데이터를 모을 수 없어요. 대신 *업계 통상의 백오프 간격* 을 따라 단순 정책을 도입하는 것이 정합합니다.

재시도 정책 없이 *한 번 실패하면 EXPIRED* 로 가는 흐름은 [`ADR-020`](./adr-020-subscription-domain-model.md) 의 *expireOverdueSubscriptions cron* 과 결합해 *일시 장애로 권한 상실* 이라는 결과를 만들어요. 첫 갱신 실패 → expires_at 도래 → cron 이 EXPIRED 마킹 → 사용자는 *알림 없이 권한 사라진* 상태를 마주하게 됩니다. 운영 시 이 패턴이 자주 발생하면 *결제 갱신 정책 자체에 대한 사용자 신뢰* 가 무너져 *수동 재구독* 으로 돌아갈 가능성이 높아요.

운영 추적 측면도 부담이 큽니다. 단순 *RenewalRetryCount* 컬럼만 두면 *지난 갱신 시도가 언제, 왜 실패했는지* 가 사라져 운영 디버깅이 *PG 응답 로그* 에만 의존하게 돼요. *어느 사용자의 어느 시점 갱신이 어떤 error code 로 실패했는지* 를 빠르게 보려면 *attempt 별 이력* 이 영속되어야 합니다.

이 결정이 답해야 할 물음은 이거예요.

> **자동 갱신 결제의 실패가 정상의 일부인 환경에서, 회복 가능 실패와 영구 실패를 구분하면서 사용자 권한과 운영 추적성을 동시에 지키는 재시도 정책은 어떤 모양인가?**

---

## 결정

| 항목 | 값 | 사유 |
|---|---|---|
| **재시도 횟수** | 3회 | 업계 통상 (Stripe Smart Retries, RevenueCat 등). N=2 는 방어 부족, N>=4 는 catch-up 비용 ↑ |
| **백오프 간격** | 1h → 6h → 24h | 카드 한도 초기화 (24h) 까지 cover. attempt 1→2 단기 (네트워크 일시 장애), 2→3 중기, 3→ABANDONED |
| **이력 저장** | `renewal_attempts` 별도 테이블 | 운영 디버깅 (왜 실패? 언제? error code 무엇?) — 단순 카운터 컬럼은 이력 손실 |
| **최종 실패 처리** | subscription auto-cancel (`status=CANCELLED`, `cancel_reason="renewal_failed_after_3"`) | EXPIRED 자동 마킹 대비 명시적 의사. 운영자가 RECONCILE 가능 |
| **이벤트 발행** | `SubscriptionRenewalSucceededEvent` / `FailedEvent` / `AbandonedEvent` 3종 | 알림 (push/email) listener 는 별도 사이클 |
| **재시도 발화** | `SubscriptionRenewalRetryScheduler` cron 매시 정각 | 1h 백오프 + 1h cadence = 최대 1h lag. 운영자가 short-circuit 원하면 cron override |

---

## 흐름

```
            [cron 매일 자정]                      [cron 매시 정각]
   SubscriptionRenewalScheduler         SubscriptionRenewalRetryScheduler
                │                                       │
   findSubscriptionsExpiringWithin             findSubscriptionsDueForRetry
       (만료 임박 ACTIVE)                  (RenewalAttempt FAILED + nextRetryAt 도래)
                │                                       │
                ▼                                       ▼
                       SubscriptionRenewalDueEvent
                                │
                                ▼
                  SubscriptionRenewalListener
                  (SlugContext 셋업 후 호출)
                                │
                                ▼
                BillingPort.renewSubscription(subId)
                                │
            ┌───────────────────┴───────────────────┐
            ▼                                       ▼
    Phase 1 (read TX)                       Phase 1 결과 → null
    sub + plan + customerUid 조회            (skip — 이벤트만 발행)
    + 직전 RenewalAttempt 검사
    (SUCCESS / ABANDONED 면 skip)
    + nextAttemptNo 결정
            │
            ▼
    Phase 2 (NO TX)
    PaymentPort.chargeAgain
    ┌────────┴─────────┐
    ▼ 성공             ▼ 실패 (FAILED 또는 throw)
Phase 3a (write TX) Phase 3b (write TX)
- 새 PaymentRecord    if attemptNo == 3:
- 새 Subscription       - RenewalAttempt(ABANDONED)
- RenewalAttempt(SUCCESS)  - sub.cancel("renewal_failed_after_3")
- SucceededEvent          - AbandonedEvent
                       else:
                         - RenewalAttempt(FAILED, nextRetryAt=now+backoff)
                         - FailedEvent
```

---

## RenewalAttempt 모델

```sql
CREATE TABLE renewal_attempts (
    id                  BIGSERIAL PRIMARY KEY,
    subscription_id     BIGINT NOT NULL REFERENCES subscriptions(id),
    attempt_no          INTEGER NOT NULL,
    attempted_at        TIMESTAMPTZ NOT NULL,
    next_retry_at       TIMESTAMPTZ,
    status              VARCHAR(20) NOT NULL,  -- SUCCESS / FAILED / ABANDONED
    error_code          VARCHAR(50),           -- PG_NOT_PAID / PG_THROW
    error_message       TEXT,
    payment_record_id   BIGINT REFERENCES payment_records(id),  -- SUCCESS 시 새 PaymentRecord
    created_at          TIMESTAMPTZ NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL
);

-- retry scheduler 핵심 인덱스
CREATE INDEX idx_renewal_attempts_due ON renewal_attempts(next_retry_at)
    WHERE status = 'FAILED' AND next_retry_at IS NOT NULL;

-- race / 중복 발화 시 (subscription_id, attempt_no) UNIQUE 제약으로 두 번째 INSERT 차단
CREATE UNIQUE INDEX uk_renewal_attempts_subscription_attempt
    ON renewal_attempts(subscription_id, attempt_no);
```

**슬러그별 schema 위치** — ADR-020 정합. 같은 슬러그의 subscriptions / payment_records 와 join 가능.

---

## 대안 비교

### 옵션 A — 카운터 컬럼만 (Subscription.renewalRetryCount + Subscription.lastRenewalFailedAt)

- 단순해요. 별도 테이블이 필요 없어요.
- ❌ 이력 손실 — "두 번째 실패 시 PG 가 어떤 에러 코드 반환?" 추적이 불가능해요.
- ❌ ABANDONED 이력이 영구 보존되지 않아요 (sub.cancel 후 이력이 사라져요).
- 운영 디버깅이 부족해요.

### 옵션 B — RenewalAttempt 별도 테이블 ★ 채택

- 모든 시도 이력을 보존해요 (성공/실패/abandon 전부).
- 운영 디버깅에 강해요 — "이 sub 가 왜 cancel 됐나?" → renewal_attempts 의 마지막 3개 row 가 답을 줘요.
- attempt_no UNIQUE 제약으로 race 를 방어합니다.

### 옵션 C — 실패 시 즉시 cancel (재시도 0회)

- 가장 단순해요.
- ❌ 일시 장애에 과민하게 반응해요. 카드 한도가 24h 후 회복되는 경우도 즉시 cancel → 사용자 불만으로 이어져요.
- 업계 통상에 어긋나요.

### 옵션 D — 무한 재시도 (지수 백오프)

- 끝까지 재시도합니다.
- ❌ DB 누수 위험 (renewal_attempts 무한 증가).
- ❌ 영구 정지된 카드도 N 회 시도 → PG 비용 누적.
- ❌ 사용자가 "왜 자동 갱신이 계속 실패하는지" 알 수 없어요.

---

## 백오프 선택 근거

| 회차 | 간격 | 이유 |
|---|---|---|
| 1→2 | 1h | 네트워크/PG 일시 장애 회복 시간. 너무 길면 사용자 만료 직후 권한 끊김 |
| 2→3 | 6h | 카드사 점검 / 시스템 유지보수 cycle |
| 3→ABANDONED | (없음) | 24h 카드 한도 reset 후에도 실패면 영구 문제 (블랙리스트, 한도 초과, 카드 만료) |

총 7h 후 abandon — 만료 24h 전부터 재시도하면 abandon 도 만료 17h 전에 결정돼요 → 사용자에게 알림을 발송할 시간을 확보합니다.

---

## 동시성 / Race 방어

1. **같은 sub 의 동시 retry** — `findSubscriptionsDueForRetry` 가 같은 sub 의 여러 FAILED row 를 dedup. 그래도 두 cron 인스턴스 race 시 첫 phase1 의 attemptNo 가 동일 → 두 번째 INSERT 가 UNIQUE 제약 위반 으로 실패 (실패 시 두 번째 호출이 fail-fast 됨).
2. **이미 SUCCESS / ABANDONED 인 sub 의 retry** — Phase 1 의 직전 attempt 상태를 체크해요. SUCCESS / ABANDONED 면 skip + log + return empty 로 빠져나갑니다.
3. **Phase 2 (PG) 의 외부 HTTP 호출이 트랜잭션 점유** — `@Transactional(NOT_SUPPORTED)` + 내부 `txTemplate` 으로 phase 별 자기 트랜잭션을 가집니다. ADR-020 의 webhook 패턴과 동일해요.

---

## 알림 (Out of Scope — 다음 사이클)

본 사이클은 이벤트 발행까지만 다뤄요. 실제 push/email listener 는:

- `SubscriptionRenewalFailedEvent` 받은 listener — "결제 실패. N시간 후 재시도 예정" 알림
- `SubscriptionRenewalAbandonedEvent` 받은 listener — "구독이 자동 취소됐습니다. 카드 정보 확인" 알림 + win-back 캠페인 트리거

별도 사이클에서 `core-push` (또는 `core-notification`) 모듈로 분리합니다.

---

## 검증

`AbstractBillingPortContractTest$RenewSubscription` 에 9개 시나리오:

1. `noCustomerUid_returnsEmpty` — one-time 결제 skip
2. `withCustomerUid_paid_createsNewSubscriptionAndSuccessAttempt` — 첫 시도 성공
3. `nonexistentSubscription_returnsEmpty` — 존재하지 않는 sub
4. `firstAttemptFails_recordsFailedAttempt_withNextRetryAtAround1h` — 첫 실패 → +1h
5. `secondAttemptFails_nextRetryAtAround6h` — 두 번째 실패 → +6h
6. `thirdAttemptFails_abandoned_subscriptionAutoCancelled` — 세 번째 실패 → ABANDONED + cancel
7. `chargeAgainThrows_recordedAsFailedWithErrorCodePgThrow` — PG throw → FAILED
8. `retryAfterFailure_succeeds_recordsSuccessAttempt2` — 재시도 후 성공
9. `alreadyTerminal_skipsExtraAttempt` — SUCCESS 후 중복 발화 skip

`AbstractBillingPortContractTest$FindSubscriptionsDueForRetry` 에 1개:

10. `returnsActiveSubsWithDueFailedAttempts_excludesFutureRetries` — due 한 sub 만 반환

총 contract test 10개 모두 PASS (`./gradlew :core:core-billing-impl:test --tests '*RenewSubscription*' '*FindSubscriptionsDueForRetry*'`).

---

## 결정 권한 / 변경 절차

`MAX_RENEWAL_ATTEMPTS=3`, `RENEWAL_BACKOFF=[1h, 6h]` 는 `BillingServiceImpl` 의 상수. 변경 시:

1. 본 ADR 에 변경 사유 기록 (운영 통계: "현재 N=3 으로 abandon 된 sub 중 X% 가 24h 후 수동 재가입 — Y 로 늘리면 회복률 ↑")
2. Properties 노출 (운영자 환경별 override 가능) — 다음 사이클에서 결정

---

## 관련 파일

- `core/core-billing-impl/.../BillingServiceImpl.java#renewSubscription` — phase 1/2/3a/3b
- `core/core-billing-impl/.../entity/RenewalAttempt.java` — entity + factory 메소드
- `core/core-billing-impl/.../scheduler/SubscriptionRenewalRetryScheduler.java` — cron
- `core/core-billing-api/.../event/SubscriptionRenewalSucceeded/Failed/AbandonedEvent.java`
- `tools/new-app/new-app.sh` — `V011__init_renewal_attempts.sql` heredoc
