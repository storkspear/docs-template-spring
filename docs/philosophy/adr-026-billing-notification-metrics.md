# ADR-026 — 결제 알림 발송 메트릭

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~5분

**Status**: Accepted. `SubscriptionNotificationListener` 가 `MeterRegistry` 를 주입받아 `billing.notification.sent` Counter 를 *channel × kind × result* 라벨로 발행해요. Prometheus / Grafana 가 자동으로 scrape 합니다.

---

## 결론부터

알림을 보내는 것과 *알림이 정말 도달했는지 추적하는 것* 은 별개의 운영 영역이에요. push + email 듀얼 채널 ([`ADR-025`](./adr-025-billing-notification-email-channel.md)) 을 갖춰도, *발송 시도가 어디서 막히는지* / *어떤 이벤트가 자주 실패하는지* 를 보지 못하면 사용자가 *알림을 못 받았다* 는 신고가 들어와도 *어디서 끊겼는지* 추적할 수단이 없습니다. 운영 모니터링은 *알림 인프라의 다른 절반* 이에요.

본 ADR 은 결제 알림 발송에 Prometheus 메트릭을 추가합니다. 메트릭 이름은 `billing.notification.sent` (Counter, 단조증가) 이고, *3 가지 라벨* 로 발송 상황을 분류해요. `channel` (push / email) 은 *어느 채널이 막혔는지*, `kind` (renewal_succeeded / renewal_failed / renewal_abandoned / iap_refund / iap_revoke) 은 *어떤 이벤트가 자주 발송되는지*, `result` (success / failure / skipped) 는 *발송 시도의 결과* 를 구분합니다. 라벨 조합 (`channel × kind × result`) 으로 *FCM 만 실패하고 Resend 는 정상* 같은 채널별 추세나 *renewal_failed 가 평소보다 많아짐 → PG 또는 카드 한도 이슈* 같은 비즈니스 시그널까지 한 메트릭에서 추출할 수 있어요.

이 ADR 의 범위는 메트릭 이름 / 타입 / 라벨 정의, `MeterRegistry` 주입 패턴 (actuator 미통합 환경도 동작하는 nullable 처리 포함), 라벨별 의미와 운영 시그니처, Prometheus / Grafana 통합 흐름까지입니다.

---

## 왜 이런 결정이 필요했나?

push + email 듀얼 채널을 갖춘 직후의 운영 환경에서 *알림 인프라가 정말 작동하는지 자체* 를 모니터링할 수단이 없으면 *세 가지 운영 부담* 이 곧바로 누적돼요.

첫 번째는 **알림이 실제로 도달했는지 확인할 길이 없는 상태** 입니다. 사용자가 *결제 실패 알림을 못 받았어요* 라는 신고를 보내왔을 때, backend 의 발송 로그만 봐서는 *우리가 발송 시도를 했는가* 정도만 알 수 있을 뿐 *FCM 응답이 정상이었는지*, *수신자의 토큰이 만료된 상태였는지*, *Resend 가 SPF/DMARC 거절을 했는지* 는 알 수 없어요. 메트릭 없이는 매 신고마다 *발송 로그 + FCM 콘솔 + Resend 대시보드* 를 따로따로 들춰봐야 하는 운영 부담이 생깁니다.

두 번째는 **실패율의 추세 변화를 감지할 수 없는 상태** 예요. FCM 토큰이 *앱 재설치 / OS 업데이트* 같은 이벤트로 invalidate 되어 발송 실패율이 서서히 오르는 일이 있을 수 있고, Resend 의 일일 발송 한도에 가까워져 5xx 응답이 늘어나는 경우도 있어요. 이런 *서서히 진행되는 장애* 는 임계치 기반 알림이 없으면 *사용자 신고가 누적된 후에야* 발견됩니다. *failed 가 5분 안에 5% 를 넘으면 Alertmanager 가 알린다* 같은 정책을 잡으려면 *failed* 자체를 메트릭으로 추적할 수 있어야 해요.

세 번째는 **skip 빈도의 비즈니스 시그널을 놓치는 상태** 입니다. *email 발송 skip* 은 *사용자가 emailVerified 를 안 거친 상태* 라는 사실을 의미하고, *push skip* 은 *사용자가 푸시 토큰을 등록하지 않은 상태* 를 의미해요. 이런 skip 비율이 *높아지는 추세* 라면 *가입 직후 이메일 인증 흐름이 끊기는 사용자가 늘어남* 같은 *제품 측 시그널* 일 수 있습니다. 메트릭 없이는 이 신호 자체가 보이지 않아요.

이 세 가지 부담을 한 번에 해결하는 길은 *발송 시도의 결과를 라벨 단위 메트릭으로 발행* 하는 것이에요. 인프라 측면에서도 부담이 작아요 — Prometheus / Grafana / Alertmanager 가 이미 운영에 갖춰져 있어 *Counter 발행 코드* 만 추가하면 자동으로 scrape 와 시각화가 따라옵니다. 개별 알림마다 별도 모니터링 시스템을 구축하는 형태와 비교하면 *기존 인프라에 한 메트릭 추가* 가 압도적으로 가벼워요.

이 결정이 답해야 할 물음은 이거예요.

> **결제 알림의 발송 상황을 어떤 라벨 구조로 메트릭화하면 사용자 신고 추적 / 실패 추세 감지 / 비즈니스 시그널 분석을 한 번에 지원할 수 있는가?**

---

## 결정

| 항목 | 값 |
|---|---|
| **메트릭 이름** | `billing.notification.sent` (Prometheus 노출 시 `billing_notification_sent_total`) |
| **타입** | Counter (단조증가, increment only) |
| **라벨** | `channel` (push/email) × `kind` (renewal_succeeded/failed/abandoned/iap_refund/iap_revoke) × `result` (success/failure/skipped) |
| **DI 패턴** | `MeterRegistry` 주입 — bootstrap 의 `spring-boot-starter-actuator` 가 자동 등록. nullable 처리 (테스트 환경 대비) |
| **Conditional** | actuator 미통합 환경도 동작 — `meterRegistry == null` 시 noop |

---

## 라벨 선택 사유

세 라벨은 *운영 질문의 차원* 을 그대로 따릅니다. *어느 채널에서 막혔는가*, *어떤 종류의 알림이 자주 발송되는가*, *발송 시도가 어떤 결과로 끝났는가* — 이 세 차원이 직교 (orthogonal) 라 라벨 조합이 풍부해지고, 운영자가 *어느 차원에서 문제를 좁힐지* 자유롭게 선택할 수 있어요.

### channel — 어느 외부 채널이 막혔는가

`push` 와 `email` 두 값으로 시작해요. 두 채널이 *서로 다른 외부 시스템* (FCM / Resend) 에 의존하므로, *한쪽이 정상이고 다른 쪽이 실패* 하는 패턴이 자주 발생합니다. 예를 들어 *FCM 은 정상 응답하는데 Resend 가 5xx 만 반환* 하는 상황이 *Resend 측 장애* 의 신호예요. channel 라벨이 분리되어 있어야 이런 *외부 시스템 단위 장애* 를 즉시 격리할 수 있습니다.

향후 SMS / 카카오톡 / 알림톡 같은 다른 채널이 추가되면 같은 라벨 차원에 자연스럽게 흡수돼요. *알림 채널이 늘어나도 메트릭 구조는 그대로* 라 운영 도구가 함께 진화합니다.

### kind — 어떤 종류의 알림이 발송되는가

`renewal_succeeded` / `renewal_failed` / `renewal_abandoned` / `iap_refund` / `iap_revoke` 같은 비즈니스 이벤트 종류를 그대로 라벨로 두는 형태예요. 이 라벨은 *비즈니스 추세* 를 메트릭으로 직접 노출합니다.

가장 명확한 활용은 *renewal_failed 의 발송 빈도* 추적이에요. 이 값이 *평소보다 갑자기 많아지면* 결제 실패 자체가 늘었다는 뜻이고, 그 원인이 *PG 측 장애*, *카드 한도 이슈*, *특정 카드사의 인증 정책 변경* 같은 외부 시그널일 가능성이 높습니다. 단순 *결제 실패 카운트* 만 추적해도 비즈니스 모니터링의 출발점이 돼요.

### result — 발송 시도의 결말

세 값으로 발송 시도를 분류합니다. `success` 는 *외부 시스템이 2xx 로 응답* 한 정상 발송이고, `failure` 는 *발송 시도는 했지만 외부 시스템이 5xx 또는 timeout 등으로 거절* 한 케이스예요. `skipped` 는 *애초에 발송 시도조차 하지 않은* 경우로, PushPort / EmailPort 가 미등록된 환경, 사용자가 `emailVerified=false` 인 상태, `userId` 가 null 인 이벤트 등이 여기 해당합니다.

이 세 값의 조합으로 *(failure + skipped) / total* 을 계산하면 *알림이 도달하지 않은 비율* 이 직접 나와요. 그 값이 임계치를 넘으면 *알림 인프라에 어떤 형태로든 문제가 있다* 는 신호이고, `result` 라벨로 다시 *어느 결말 (failure 인지 skipped 인지)* 인지 좁힐 수 있습니다.

---

## 메트릭 흐름 (예)

```
[운영자가 사용자 신고 받음] "결제 실패 알림 못 받았어요"
   ↓
[Grafana 대시보드 열기]
billing_notification_sent_total{channel="push", kind="renewal_failed", result="success"} 1247
billing_notification_sent_total{channel="push", kind="renewal_failed", result="failure"} 23
billing_notification_sent_total{channel="push", kind="renewal_failed", result="skipped"} 156

   ↓
[skipped 156 → 푸시 토큰 부재 사용자 — 이메일 fallback OK]
billing_notification_sent_total{channel="email", kind="renewal_failed", result="success"} 1389
   ↓ 결론: 푸시는 토큰 만료 case, 이메일은 100% 도달
   → 사용자 신고 케이스 = 이메일도 미인증 사용자 (skipped 14건 별도)
```

---

## Prometheus 노출

Spring Boot Actuator + micrometer-registry-prometheus (이미 bootstrap 의존성):

```bash
curl -s http://localhost:8081/actuator/prometheus | grep billing_notification_sent

# HELP billing_notification_sent_total
# TYPE billing_notification_sent_total counter
billing_notification_sent_total{channel="push",kind="renewal_failed",result="success"} 3.0
billing_notification_sent_total{channel="email",kind="renewal_failed",result="success"} 3.0
billing_notification_sent_total{channel="push",kind="renewal_succeeded",result="success"} 7.0
```

→ Prometheus 가 자동 scrape (이미 `prometheus.yml` 의 `actuator` job 으로 설정됨).

---

## Grafana 대시보드 (다음 사이클)

본 ADR 은 메트릭 발생만 다룸. Grafana JSON 작성은 별도:

- 패널 1: 5분 단위 발송 rate (channel × kind 분리)
- 패널 2: 실패율 (failure / total)
- 패널 3: skip rate (skipped / total) — 사용자 등록률 reverse indicator
- Alert 룰: failure rate > 5% (5분 sustain) → Slack/Discord 통보

---

## 검증 (단위 테스트 6건 추가, 총 19건)

```java
// SimpleMeterRegistry 사용 — 테스트 환경에서 메트릭 캡처
@Test void metrics_successCase_incrementsBothChannels()
@Test void metrics_pushFailure_incrementsFailureCounter()
@Test void metrics_emailFailure_incrementsFailureCounter()
@Test void metrics_unverifiedEmail_incrementsEmailSkipped()
@Test void metrics_pushPortAbsent_incrementsPushSkipped()
@Test void metrics_iapRefund_incrementsBoth()
```

운영 환경에서는:
```bash
curl -s localhost:8081/actuator/prometheus | grep billing_notification_sent
# 발송 1번 일어나면 counter 1 증가 — 즉시 검증
```

---

## 대안 비교

### 옵션 A — 별도 NotificationMetrics 클래스 / Spring AOP

- AOP 로 listener 메소드 자동 instrument
- ❌ skip / success / failure 분기를 AOP 로 못 잡음 (메소드 인자/반환만 보임, 내부 분기 X)
- ❌ over-engineering — 카운터 6개 라인이면 직접 호출이 더 명확

### 옵션 B — 직접 MeterRegistry 호출 ★ 채택

- listener 가 MeterRegistry 를 받아 counter().increment() 를 직접 호출해요
- ✅ 분기마다 명시적 — success / failure / skipped 모두 추적해요
- ✅ 단순해요. 코드 ~10줄 추가로 끝나요

### 옵션 C — Outbox 테이블 + 분석 query

- 매 발송을 DB 에 저장 → SQL 로 분석해요
- ❌ DB 부하가 늘어요. 메트릭은 in-memory counter 가 정석이에요
- 추후 알림 보장 (재시도) 필요 시 별도 사이클로 다뤄요 (N — Outbox)

---

## 안 다루는 범위

- **Grafana dashboard JSON** — 별도 작업 (운영자가 임시 observability stack 로컬 띄워 작성)
- **Alert 룰** — `infra/prometheus/rules.yml` 추가 (예: notification failure rate)
- **Histogram / Timer** — 발송 latency 측정. counter 우선, 필요 시 추가
- **사용자별 dimension** — 라벨 cardinality 폭증 방지 위해 userId 라벨 X

---

## 관련 파일

- `core/core-billing-impl/build.gradle` — micrometer-core compileOnly + test
- `core/core-billing-impl/.../SubscriptionNotificationListener.java` — `MeterRegistry` 주입 + `countMetric()` helper
- `core/core-billing-impl/.../BillingAutoConfiguration.java` — `ObjectProvider<MeterRegistry>` 주입
- `core/core-billing-impl/src/test/.../SubscriptionNotificationListenerTest.java` — `SimpleMeterRegistry` + 메트릭 검증 6건
