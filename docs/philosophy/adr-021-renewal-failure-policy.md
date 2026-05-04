# ADR-021 — Subscription 자동 갱신 실패 정책

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~7분

**상태**: 채택 (2026-05-02)
**전제**: ADR-019 (billing/iap/payment 분리), ADR-020 (subscription 도메인 모델)
**연관**: G 사이클 (자동 재청구 — `PortOneAdapter.chargeAgain` + `RenewalListener`)

---

## 결론부터

자동 갱신 실패 시 *3회 백오프* (1h → 6h → 24h) 로 재시도. 실패 누적이 3 attempt 도달하면 `ABANDONED` 로 분류되고 구독은 `auto-cancel`. 회복 가능 실패 (네트워크 / 카드 한도 일시) 와 영구 실패 (카드 만료 / 사용자 결제 거부) 의 구분이 백오프 간격에 녹아 있어요.

`RenewalAttempt` 도메인 모델로 *재시도 횟수 / 마지막 시도 시각 / 실패 사유* 를 영속. webhook ↔ scheduler 동시성은 advisory lock 으로 직렬화.

---

## 배경

G 사이클로 `BillingServiceImpl.renewSubscription` 가 PortOne `chargeAgain` 호출까지 완성. 그러나 결제 실패 시 처리가 비어있음 — `log.error` + `Optional.empty()` 반환으로 끝. 운영 시:

- 일시적 카드 한도 초과 / 카드사 점검 / 네트워크 timeout 등 **회복 가능 실패** 가 사일런트로 무시
- 첫 갱신 실패 → expires_at 도래 → `expireOverdueSubscriptions` cron 이 EXPIRED 처리 → **사용자가 알지 못한 채 권한 상실**
- 운영자가 결제 실패 추적 불가 (테이블 부재)

같은 클래스 SaaS (Stripe, Spotify, Netflix) 는 재시도 + 알림 + 최종 실패 시 cancel 정책으로 운영. 본 ADR 은 그 정책을 슬러그별 schema 격리 원칙 (ADR-005/018) 준수하면서 정의.

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

- 단순. 별도 테이블 불필요.
- ❌ 이력 손실. "두 번째 실패 시 PG 가 어떤 에러 코드 반환?" 추적 불가.
- ❌ ABANDONED 이력 영구 보존 안 됨 (sub.cancel 후 이력 사라짐).
- 운영 디버깅 부족.

### 옵션 B — RenewalAttempt 별도 테이블 ★ 채택

- 모든 시도 이력 보존 (성공/실패/abandon 전부).
- 운영 디버깅: "이 sub 가 왜 cancel 됐나?" → renewal_attempts 의 마지막 3개 row 가 답.
- attempt_no UNIQUE 제약으로 race 방어.

### 옵션 C — 실패 시 즉시 cancel (재시도 0회)

- 가장 단순.
- ❌ 일시 장애에 과민 반응. 카드 한도 24h 후 회복되는 경우도 즉시 cancel → 사용자 불만.
- 업계 통상 위반.

### 옵션 D — 무한 재시도 (지수 백오프)

- 끝까지 재시도.
- ❌ DB 누수 (renewal_attempts 무한 증가).
- ❌ 영구 정지된 카드도 N 회 시도 → PG 비용.
- ❌ 사용자가 "왜 자동 갱신이 계속 실패?" 알지 못 함.

---

## 백오프 선택 근거

| 회차 | 간격 | 이유 |
|---|---|---|
| 1→2 | 1h | 네트워크/PG 일시 장애 회복 시간. 너무 길면 사용자 만료 직후 권한 끊김 |
| 2→3 | 6h | 카드사 점검 / 시스템 유지보수 cycle |
| 3→ABANDONED | (없음) | 24h 카드 한도 reset 후에도 실패면 영구 문제 (블랙리스트, 한도 초과, 카드 만료) |

총 7h 후 abandon — 만료 24h 전부터 재시도하면 abandon 도 만료 17h 전에 결정 → 사용자에게 알림 발송 시간 확보.

---

## 동시성 / Race 방어

1. **같은 sub 의 동시 retry** — `findSubscriptionsDueForRetry` 가 같은 sub 의 여러 FAILED row 를 dedup. 그래도 두 cron 인스턴스 race 시 첫 phase1 의 attemptNo 가 동일 → 두 번째 INSERT 가 UNIQUE 제약 위반 으로 실패 (실패 시 두 번째 호출이 fail-fast 됨).
2. **이미 SUCCESS / ABANDONED 인 sub 의 retry** — Phase 1 의 직전 attempt 상태 체크. SUCCESS / ABANDONED 면 skip + log + return empty.
3. **Phase 2 (PG) 의 외부 HTTP 호출이 트랜잭션 점유** — `@Transactional(NOT_SUPPORTED)` + 내부 `txTemplate` 으로 phase 별 자기 트랜잭션. ADR-020 의 webhook 패턴과 동일.

---

## 알림 (Out of Scope — 다음 사이클)

본 사이클은 이벤트 발행만. 실제 push/email listener 는:

- `SubscriptionRenewalFailedEvent` 받은 listener — "결제 실패. N시간 후 재시도 예정" 알림
- `SubscriptionRenewalAbandonedEvent` 받은 listener — "구독이 자동 취소됐습니다. 카드 정보 확인" 알림 + win-back 캠페인 트리거

별도 사이클에서 `core-push` (또는 `core-notification`) 모듈로 분리.

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
