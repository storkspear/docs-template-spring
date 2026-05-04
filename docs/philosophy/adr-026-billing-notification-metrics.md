# ADR-026 — 결제 알림 발송 메트릭

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~5분

**상태**: 채택 (2026-05-02)
**전제**: ADR-023 (push listener), ADR-024 (core-email 추출), ADR-025 (push + email 채널 통합)
**연관**: M 사이클 — 운영 가시성 (sent / failed / skipped)

---

## 결론부터

결제 알림 발송에 *3 라벨* (channel × kind × result) 의 Prometheus 메트릭 추가 — `billing_notification_total{channel="push|email", kind="renewal_failed|...", result="sent|failed|skipped"}`.

운영자가 *알림이 가긴 갔나* / *어느 채널이 막혔나* / *어떤 이벤트가 자주 실패하나* 즉답 가능. Alertmanager 임계치 (예: failed > 5% / 5분) 도 라벨 단위 분리 가능.

---

## 배경

L 사이클로 push + email 둘 다 발송 가능. 그러나 운영 시:

- **알림이 가긴 갔나?** 확인 X — 사용자가 "안 받았다" 신고 시 backend 만 보면 모름
- **실패율 증가 추세?** 모니터링 X — FCM 토큰 만료 / Resend 한도 / 외부 장애
- **skip 빈도?** — 사용자 emailVerified=false 비율, 푸시 토큰 부재 비율

운영 alert / 대시보드 / 비즈니스 분석 모두 메트릭이 필요. Prometheus + Grafana 인프라가 이미 있음 — counter 만 추가.

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

### channel
- `push` / `email` — 채널별 실패율 비교 (예: "FCM 정상, Resend 만 실패 — Resend 측 장애")
- 향후 SMS / 카톡 추가 시 채널 라벨로 자연스럽게 확장

### kind
- 이벤트 종류별 — 어떤 알림이 가장 많이 발송되는지 / 실패 케이스 추적
- 예: `renewal_failed` 가 평소보다 많으면 → 결제 실패 증가 → PG 측 또는 카드 한도 이슈

### result
- `success` — 발송 완료 (외부 응답 2xx)
- `failure` — 발송 시도했으나 throw (FCM 응답 5xx, Resend 502 등)
- `skipped` — 발송 안 함 (PushPort/EmailPort 미등록 / emailVerified=false / userId null)

→ `(failure + skipped) / total` = 도달 안 된 비율 추적 가능

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

- listener 가 MeterRegistry 받아 counter().increment() 직접 호출
- ✅ 분기 마다 명시적 — success / failure / skipped 모두 추적
- ✅ 단순. 코드 ~10줄 추가

### 옵션 C — Outbox 테이블 + 분석 query

- 매 발송을 DB 에 저장 → SQL 분석
- ❌ DB 부하. 메트릭은 in-memory counter 가 정도
- 추후 알림 보장 (재시도) 필요 시 별도 사이클 (N — Outbox)

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
