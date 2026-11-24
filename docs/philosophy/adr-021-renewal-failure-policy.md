<a id="adr-021--subscription-자동-갱신-실패-정책"></a>

# ADR-021 — Subscription 자동 갱신 실패 정책

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~7분

**Status**: Accepted. `BillingServiceImpl.renewSubscription`은 최대 3회 결제를 시도해요. 첫 번째 실패에는 1시간 뒤, 두 번째 실패에는 6시간 뒤를 다음 재시도 시각으로 기록해요. 세 번째 시도도 실패하면 `ABANDONED`로 기록하고 활성 구독을 자동 취소해요. 시도 이력과 결과 이벤트도 남겨요. 실제 재시도 시각에 영향을 주는 스케줄러의 한계는 아래에서 따로 설명해요.

> **테이블 리네임 (2026-06-30)**: 이 ADR의 `renewal_attempts`는 현재 `subscription_renewals`로, `payment_records`는 `payment_history`로 이름이 바뀌었어요. 엔티티 이름도 `RenewalAttempt`에서 `SubscriptionRenewal`로 바뀌었어요. 아래 모델과 SQL은 결정 당시 이름을 보존해요. 현재 스키마는 [data-model](../reference/data-model.md)을 참고하세요. FK 컬럼 `payment_record_id`는 이름을 유지하며 `payment_history(id)`를 참조해요.

---

## 결론부터

자동 갱신 결제가 실패했을 때 얼마나 기다렸다가 다시 시도할지, 언제 중단할지, 결과를 어떻게 남길지 정한 ADR이에요. 카드사나 네트워크의 일시적인 문제로 실패할 수 있으므로 첫 실패만으로 재시도를 끝내지는 않아요. 그렇다고 같은 결제를 계속 요청하지도 않도록 시도 횟수를 제한해요.

정책은 최대 3회 시도와 두 번의 대기 간격 `[1h, 6h]`예요. 세 번 모두 실패하면 갱신 이력을 `ABANDONED`로 남기고, 해당 구독이 아직 `ACTIVE`이면 `cancel_reason="renewal_failed_after_3"`으로 취소해요. 코드는 실패 원인마다 회복 가능성을 판정하지 않고 같은 횟수·간격 정책을 적용해요.

각 시도의 번호, 시각, 결과, 오류 코드와 메시지는 별도 테이블에 저장해요. 운영자는 이 기록으로 특정 구독의 갱신과 취소 과정을 확인할 수 있어요. 성공·실패·최종 중단 이벤트를 받은 알림 리스너는 설정과 사용자 알림 선호도에 따라 푸시·이메일을 처리해요([ADR-023](./adr-023-billing-notification-listener.md)).

DB의 `(subscription_id, attempt_no)` 고유 제약은 같은 시도 번호의 중복 저장을 막아요. 다만 이 제약은 외부 PG 호출 뒤에 적용돼요. 동시에 들어온 요청이 중복 청구를 일으키는 것까지 막지는 못하며, 외부 결제의 멱등성은 별도 검토가 필요해요.

---

## 왜 이런 고민이 시작됐나?

한 번의 결제 실패만으로 이후에도 결제할 수 없는 상태인지 판단하기는 어려워요. 실패 후 다시 시도할 규칙이 없으면 일시적인 장애였더라도 갱신이 끝나지 않을 수 있어요. 반대로 종료 조건이 없으면 해결되지 않은 결제에도 요청이 계속 쌓여요.

이 정책은 두 경우 사이에서 재시도 기회와 종료 시점을 정해요. 공급자별 실패 패턴을 학습하거나 오류마다 다른 간격을 계산하는 방식은 도입하지 않았어요. 정해진 횟수와 간격을 사용하고, 이후 운영 기록을 근거로 변경 여부를 판단해요.

구독 만료와도 함께 봐야 해요. [ADR-020](./adr-020-subscription-domain-model.md)의 만료 처리는 갱신 재시도와 별도로 동작해요. 갱신이 완료되지 않은 채 만료 시각이 지나면 기존 구독이 만료될 수 있어요. 재시도 정책을 둔 것만으로 구독 기간이나 사용 권한이 자동 연장되는 것은 아니에요.

운영 기록에는 횟수만으로 부족해요. 카운터와 마지막 실패 시각만 저장하면 이전 시도에서 어떤 오류가 발생했는지 알기 어려워요. 결제 로그를 따로 찾아야 하는 일을 줄이려면 시도별 결과를 남겨야 해요.

> 일시적인 실패에 다시 시도할 기회를 주면서, 반복 요청을 제한하고 갱신 결과를 추적하려면 어떤 정책이 필요한가요?

---

## 결정

| 항목 | 값 | 이유 |
|---|---|---|
| 시도 횟수 | 최초 요청을 포함해 최대 3회 | 첫 실패 뒤에도 재시도하되 무한히 반복하지 않아요. |
| 대기 간격 | 첫 실패 뒤 1시간, 두 번째 실패 뒤 6시간 | 처음에는 짧게 기다리고, 다시 실패하면 더 긴 간격을 두도록 정했어요. |
| 이력 저장 | `renewal_attempts` 별도 테이블 | 시도별 시각·결과·오류를 확인할 수 있게 해요. |
| 최종 실패 처리 | `ABANDONED` 기록, 활성 구독을 `CANCELLED`로 변경 | 만료와 구분해 갱신 실패로 취소됐다는 이유를 남겨요. 취소 사유는 `renewal_failed_after_3`예요. |
| 결과 이벤트 | `SubscriptionRenewalSucceededEvent`, `SubscriptionRenewalFailedEvent`, `SubscriptionRenewalAbandonedEvent` | 결제 처리와 알림 발송의 책임을 나눠요. |
| 재시도 대상 확인 | `SubscriptionRenewalRetryScheduler`, 기본 매시 정각 | 주기적으로 재시도 대상을 찾아요. 주기는 `app.billing.scheduler.renewal-retry-cron`으로 조정할 수 있어요. |

---

## 흐름

아래 두 스케줄러는 `app.billing.scheduler.enabled=true`일 때 등록돼요. 각 앱의 슬러그를 설정하고 갱신 대상 이벤트를 발행해요.

```text
          매일 자정(기본)                         매시 정각(기본)
   SubscriptionRenewalScheduler         SubscriptionRenewalRetryScheduler
                │                                       │
   만료가 가까운 ACTIVE 구독 조회           재시도 시각이 지난 FAILED 이력 조회
                │                            같은 구독 ID는 한 번만 선택
                └───────────────────┬───────────────────┘
                                    ▼
                    SubscriptionRenewalDueEvent
                                    │
                                    ▼
                    SubscriptionRenewalListener
                    SlugContext 설정 후 갱신 호출
                                    │
                                    ▼
                BillingPort.renewSubscription(subId)
                                    │
                                    ▼
                  Phase 1 — DB 조회 트랜잭션
          구독·요금제·customerUid·직전 시도 결과 확인
          대상이 없거나 갱신할 수 없으면 빈 결과 반환
          직전 결과가 SUCCESS·ABANDONED여도 여기서 종료
                                    │
                                    ▼
                  Phase 2 — 트랜잭션 없이 PG 호출
                       PaymentPort.chargeAgain
                   ┌────────────────┴────────────────┐
                   ▼                                 ▼
                PAID 반환                    PAID 이외의 결과 또는 예외
                   │                                 │
                   ▼                                 ▼
        Phase 3a — DB 저장 트랜잭션          Phase 3b — DB 저장 트랜잭션
        새 PaymentRecord·Subscription       1·2회 실패: FAILED와 다음 시각 저장
        RenewalAttempt(SUCCESS) 저장        3회 실패: ABANDONED 저장·활성 구독 취소
                   │                                 │
                   ▼                                 ▼
        SucceededEvent 발행                FailedEvent 또는 AbandonedEvent 발행
```

PG가 `PAID` 이외의 상태를 반환하면 `PG_NOT_PAID`, 호출 중 예외가 발생하면 `PG_THROW`를 기록해요. 두 경우 모두 같은 재시도 정책을 적용해요. Phase 1에서 갱신 대상이 아니라고 판단한 경우에는 결제 호출과 결과 이벤트 발행을 건너뛰어요.

---

## RenewalAttempt 모델

다음은 결정 당시 테이블 이름을 사용한 모델이에요. 현재 마이그레이션에 그대로 적용할 SQL은 아니에요.

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
    payment_record_id   BIGINT REFERENCES payment_records(id),  -- 성공 시 새 결제 기록
    created_at          TIMESTAMPTZ NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL
);

-- 재시도 시각이 지난 실패 이력을 조회하기 위한 인덱스
CREATE INDEX idx_renewal_attempts_due ON renewal_attempts(next_retry_at)
    WHERE status = 'FAILED' AND next_retry_at IS NOT NULL;

-- 같은 구독의 동일한 시도 번호가 중복 저장되는 것을 막아요.
CREATE UNIQUE INDEX uk_renewal_attempts_subscription_attempt
    ON renewal_attempts(subscription_id, attempt_no);
```

이 테이블은 [ADR-020](./adr-020-subscription-domain-model.md)의 결제·구독 테이블과 같은 앱 스키마에 둬요. 같은 스키마의 `subscriptions`·`payment_records`와 연결해 시도 이력을 확인할 수 있어요.

---

## 대안 비교

<a id="옵션-a--카운터-컬럼만-subscriptionrenewalretrycount--subscriptionlastrenewalfailedat"></a>

### 옵션 A — 카운터 컬럼만 (Subscription.renewalRetryCount + Subscription.lastRenewalFailedAt)

별도 테이블이 없어 구조는 단순해요. 하지만 카운터와 마지막 실패 시각만으로는 각 시도의 오류나 중단 과정을 복원하기 어려워요. 구독을 취소한 뒤에도 실패 경위를 확인할 수 있도록 별도 이력을 남기는 방식을 선택했어요.

<a id="옵션-b--renewalattempt-별도-테이블--채택"></a>

### 옵션 B — RenewalAttempt 별도 테이블 ★ 채택

성공·실패·최종 중단을 시도별로 저장해요. 운영자는 같은 구독의 이력을 순서대로 읽어 취소 이유를 확인할 수 있어요. `(subscription_id, attempt_no)` 고유 제약으로 같은 번호의 중복 저장도 막아요. 외부 PG의 중복 청구를 막는 역할까지 포함하지는 않아요.

<a id="옵션-c--실패-시-즉시-cancel-재시도-0회"></a>

### 옵션 C — 실패 시 즉시 cancel (재시도 0회)

처리는 가장 단순하지만 일시적인 장애에도 다음 시도 없이 구독을 취소하게 돼요. 첫 실패 뒤에 회복할 기회를 주려는 목적과 맞지 않아 선택하지 않았어요.

<a id="옵션-d--무한-재시도-지수-백오프"></a>

### 옵션 D — 무한 재시도 (지수 백오프)

시간이 지나도 계속 재시도할 수 있어요. 다만 해결되지 않은 결제의 요청과 이력이 계속 늘어나고, 운영자와 사용자에게 갱신을 중단할 시점도 알려주기 어려워요. 이 정책에서는 시도 횟수와 최종 상태를 명시하는 쪽을 선택했어요.

---

## 백오프 선택 근거

| 회차 | 기록하는 대기 간격 | 정책의 의도 |
|---|---|---|
| 1→2 | 1시간 | 첫 실패 뒤 한 번 더 시도할 기회를 줘요. |
| 2→3 | 6시간 | 다시 실패하면 첫 대기보다 긴 간격을 두고 마지막 시도를 하도록 정했어요. |
| 3회 실패 뒤 | 재시도 없음 | `ABANDONED`와 취소 사유를 남기고, 결제 수단 확인이나 수동 재결제로 이어갈 수 있게 해요. |

두 대기 간격의 합은 7시간이에요. 모든 갱신이 첫 시도부터 정확히 7시간 뒤에 끝난다는 뜻은 아니에요. 기본 재시도 스케줄러는 매시 정각에 실행하므로 다음 실행까지 기다릴 수 있고, 작업 지연이나 서버 중단도 영향을 줘요.

만료 임박 구독을 찾는 기본 범위는 앞으로 24시간이에요. 이는 만료 전에 갱신과 실패 알림을 처리할 기회를 두려는 설정이에요. 첫 시도가 항상 만료 24시간 전에 시작하거나, 최종 실패가 만료 17시간 전에 확정되는 것은 아니에요.

**현재 구현의 간격 확인에는 한계가 있어요.** 재시도 조회는 시각이 지난 `FAILED` 이력을 가져오며 최신 시도만으로 제한하지 않아요. 구독 ID의 중복을 제거한 뒤 갱신을 호출하고, 갱신 메서드는 최신 시도의 종료 상태를 확인하지만 `nextRetryAt`은 다시 검사하지 않아요. 따라서 이전 실패 이력이 조회되면 최신 시도에 기록한 대기시간이 끝나기 전에 다음 결제를 시도할 수 있어요. `[1h, 6h]`는 현재 코드가 기록하는 정책값이며, 실행 경로 전체가 그 간격을 보장한다고 설명하지 않아요.

---

<a id="동시성--race-방어"></a>

<a id="동시성-race-방어"></a>

## 동시 요청의 처리와 한계

같은 구독의 요청이 겹칠 때 각 단계가 처리하는 범위는 다음과 같아요.

1. **한 번의 재시도 조회에서 같은 구독이 여러 번 나오는 경우**: 조회 결과의 구독 ID를 모아 중복을 제거해요. 서로 다른 스케줄러 실행이나 인스턴스의 요청까지 잠그는 처리는 아니에요.
2. **이미 갱신이 끝난 구독을 다시 요청하는 경우**: Phase 1에서 최신 시도가 `SUCCESS`·`ABANDONED`이면 로그를 남기고 빈 결과를 반환해요.
3. **같은 시도 번호로 저장하려는 경우**: DB 고유 제약이 두 번째 저장을 거부해요. 두 요청이 모두 Phase 1을 통과했다면 저장 전에 PG 호출을 각각 수행할 수 있으므로, 이 제약만으로 결제 중복을 방지할 수는 없어요.
4. **외부 호출 중 DB 트랜잭션을 유지하는 문제**: 갱신 메서드는 `@Transactional(NOT_SUPPORTED)`로 외부 트랜잭션을 중단하고, DB 작업만 `TransactionTemplate`으로 나눠 실행해요. 외부 HTTP 호출을 트랜잭션 밖에 두는 점은 ADR-020의 webhook 처리와 같아요.

외부 PG 요청을 같은 결제로 식별하고 중복 청구를 막는 설계는 이 DB 제약과 별도로 검토해야 해요.

---

<a id="알림-out-of-scope--다음-사이클"></a>

<a id="알림-out-of-scope-다음-사이클"></a>

## 알림 처리 범위

이 ADR을 결정할 때의 구현 범위는 결과 이벤트 발행까지였어요. 당시에는 실패 이벤트로 재시도 예정 사실을, 최종 중단 이벤트로 취소와 결제 수단 확인 필요성을 알리는 후속 리스너를 계획했어요. 재가입을 유도하는 캠페인도 후속 아이디어였으며 이 정책의 기본 동작은 아니에요.

현재는 [ADR-023](./adr-023-billing-notification-listener.md)의 `SubscriptionNotificationListener`가 성공·실패·최종 중단 이벤트를 받아요. 푸시·이메일은 등록된 채널, 알림 설정, 사용자 선호도와 이메일 검증 상태 등에 따라 발송하거나 건너뛰어요. 이벤트를 발행했다는 사실만으로 두 채널 모두 사용자에게 도착했다고 보지는 않아요. 발송 구현과 운영 확인은 알림 문서에서 다뤄요.

---

## 검증

이 ADR의 기존 검증 기록에는 아래 계약 테스트 10개가 통과한 것으로 남아 있어요. 각 테스트가 확인하는 동작은 다음과 같아요.

`AbstractBillingPortContractTest.RenewSubscription`:

1. `noCustomerUid_returnsEmpty` — 재청구용 `customerUid`가 없는 일회성 결제는 건너뛰어요.
2. `withCustomerUid_paid_createsNewSubscriptionAndSuccessAttempt` — 첫 시도가 성공하면 새 구독과 성공 이력을 저장해요.
3. `nonexistentSubscription_returnsEmpty` — 구독이 없으면 빈 결과를 반환해요.
4. `firstAttemptFails_recordsFailedAttempt_withNextRetryAtAround1h` — 첫 실패 뒤 약 1시간 후의 재시도 시각을 기록해요.
5. `secondAttemptFails_nextRetryAtAround6h` — 두 번째 실패 뒤 약 6시간 후의 재시도 시각을 기록해요.
6. `thirdAttemptFails_abandoned_subscriptionAutoCancelled` — 세 번째 실패를 `ABANDONED`로 기록하고 구독을 취소해요.
7. `chargeAgainThrows_recordedAsFailedWithErrorCodePgThrow` — PG 호출 예외를 `PG_THROW` 실패 이력으로 남겨요.
8. `retryAfterFailure_succeeds_recordsSuccessAttempt2` — 첫 실패 뒤 성공한 재시도를 두 번째 이력으로 저장해요.
9. `alreadyTerminal_skipsExtraAttempt` — 이미 성공한 구독의 추가 시도를 건너뛰어요.

`AbstractBillingPortContractTest.FindSubscriptionsDueForRetry`:

10. `returnsActiveSubsWithDueFailedAttempts_excludesFutureRetries` — 재시도 시각이 지난 실패 이력이 있는 활성 구독을 조회하고, 미래 시각의 이력만 있는 구독은 제외해요.

다시 확인할 때는 다음 명령을 사용해요.

```bash
./gradlew :core:core-billing-impl:test \
  --tests '*RenewSubscription*' \
  --tests '*FindSubscriptionsDueForRetry*'
```

이 테스트들은 이력에 기록되는 값과 개별 조회·처리를 확인해요. 실제 스케줄러에서 이전 실패 이력과 최신 실패 이력이 함께 있을 때의 대기 간격이나, 동시 요청의 외부 PG 중복 청구까지 검증한 결과로 확대하지 않아요.

---

<a id="결정-권한--변경-절차"></a>

## 결정 권한 / 변경 절차

`MAX_RENEWAL_ATTEMPTS=3`과 `RENEWAL_BACKOFF=[1h, 6h]`는 `BillingServiceImpl`의 상수로 관리해요. 횟수나 간격을 바꿀 때는 운영 기록과 변경 이유를 이 ADR에 남겨요. 최종 실패 뒤 수동 재결제로 이어진 사례나 추가 시도에서 회복한 사례처럼 판단에 사용할 수 있는 기록을 확인해요.

운영 환경별로 값을 바꿀 수 있도록 Properties로 노출할지는 별도로 결정해요. 현재 정책이 환경변수만으로 변경된다는 의미는 아니에요.

---

## 관련 파일

- [BillingServiceImpl.java](https://github.com/storkspear/template-spring/blob/main/core/core-billing-impl/src/main/java/com/factory/core/billing/impl/BillingServiceImpl.java) — 대상 조회, 외부 결제 호출, 결과 저장과 이벤트 발행
- [SubscriptionRenewal.java](https://github.com/storkspear/template-spring/blob/main/core/core-billing-impl/src/main/java/com/factory/core/billing/impl/entity/SubscriptionRenewal.java) — 현재 갱신 이력 엔티티와 생성 메서드. 결정 당시 이름은 `RenewalAttempt`예요.
- [SubscriptionRenewalRepository.java](https://github.com/storkspear/template-spring/blob/main/core/core-billing-impl/src/main/java/com/factory/core/billing/impl/repository/SubscriptionRenewalRepository.java) — 재시도 시각이 지난 실패 이력 조회
- [SubscriptionRenewalScheduler.java](https://github.com/storkspear/template-spring/blob/main/core/core-billing-impl/src/main/java/com/factory/core/billing/impl/scheduler/SubscriptionRenewalScheduler.java) — 만료 임박 구독 조회
- [SubscriptionRenewalRetryScheduler.java](https://github.com/storkspear/template-spring/blob/main/core/core-billing-impl/src/main/java/com/factory/core/billing/impl/scheduler/SubscriptionRenewalRetryScheduler.java) — 재시도 대상 조회와 이벤트 발행
- [SubscriptionRenewalListener.java](https://github.com/storkspear/template-spring/blob/main/core/core-billing-impl/src/main/java/com/factory/core/billing/impl/scheduler/SubscriptionRenewalListener.java) — 앱 슬러그를 설정하고 갱신 호출
- [SubscriptionNotificationListener.java](https://github.com/storkspear/template-spring/blob/main/core/core-billing-impl/src/main/java/com/factory/core/billing/impl/listener/SubscriptionNotificationListener.java) — 결과 이벤트에 따른 알림 처리
- [갱신 결과 이벤트](https://github.com/storkspear/template-spring/tree/main/core/core-billing-api/src/main/java/com/factory/core/billing/api/event) — 갱신 결과 이벤트
- [new-app.sh](https://github.com/storkspear/template-spring/blob/main/tools/app/new-app.sh) — 현재 `V011__init_subscription_renewals.sql` 생성 코드
