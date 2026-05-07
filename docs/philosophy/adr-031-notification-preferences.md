# ADR-031 — 사용자 알림 설정 (toggle)

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~5분

**Status**: Accepted. `user_notification_preferences` 테이블 + `NotificationKind` enum 으로 사용자별 알림 종류별 push/email 을 토글해요. listener 가 발송 직전 preference 를 조회해 OFF 면 silent skip 으로 처리하고 skipped 메트릭을 증가시킵니다.

---

## 결론부터

알림은 *너무 많이 보내면 사용자가 모든 알림을 무시하기 시작* 하는 자기 무력화 효과가 있어요. *알림 피로도 (notification fatigue)* 라고 부르는 이 현상은 *결제 실패 같은 critical 알림* 까지 함께 무시하게 만들어 *알림 인프라 자체의 가치* 를 떨어뜨립니다. 그래서 *사용자가 어떤 알림을 받을지 직접 선택할 수 있어야* 알림이 제 역할을 해요.

본 ADR 은 사용자가 *알림 종류별로 on/off 를 선택* 할 수 있는 preference 시스템을 정의합니다. `NotificationKind` enum (`RENEWAL_SUCCEEDED`, `RENEWAL_FAILED`, `RENEWAL_ABANDONED`, `IAP_REFUND`, `IAP_REVOKE`) 이 알림 분류 단위가 되고, `user_notification_preferences` 테이블이 *(user_id, kind, push_enabled, email_enabled)* 의 행 단위로 사용자별 설정을 저장해요. 발송 시점에 listener 가 *해당 사용자의 해당 kind preference* 를 조회해 OFF 면 *silent skip* 으로 처리합니다.

default 정책은 *미등록 = ON* 이에요. 사용자가 명시적으로 OFF 를 선택하지 않은 경우 *모든 알림을 받는* 상태로 가정합니다. 이 default 의 가치는 *새 가입자가 별도 설정 없이 핵심 알림 (결제 실패, 환불 등) 을 즉시 받는* 형태가 된다는 점이에요. 운영자가 *opt-in* (default=OFF) 으로 바꾸고 싶으면 환경변수로 토글할 수 있도록 설계해, 한국 마케팅법처럼 *명시 동의* 가 필요한 환경에서도 적용 가능합니다.

skip 처리는 *메트릭 차원에서도 의미* 가 있어요. listener 가 preference 토글 때문에 발송을 스킵하면 [`ADR-026`](./adr-026-billing-notification-metrics.md) 의 `result=skipped` counter 가 증가합니다. 운영자가 *어떤 알림 종류가 자주 OFF 되는지* 를 메트릭으로 추적할 수 있어, *알림 정책의 적정성* 을 비즈니스 시그널로 분석할 수 있어요. *RENEWAL_SUCCEEDED 의 OFF 비율이 높으면 → 갱신 성공 알림이 무의미하다는 신호* 같은 분석이 가능합니다.

이 ADR 의 범위는 `NotificationKind` enum 정의, `user_notification_preferences` 테이블 설계 (슬러그별 schema 위치 + 컬럼 의미), default 정책의 근거, listener 의 preference 체크 통합 흐름, 메트릭 연결 패턴, 그리고 *별도 테이블 vs Boolean 컬럼 / JSON 컬럼* 같은 모델 선택 트레이드오프, 마지막으로 사용자 측 GET/PATCH endpoint (`NotificationPreferenceController`) 까지입니다.

---

## 왜 이런 결정이 필요했나?

알림 인프라 ([`ADR-023`](./adr-023-billing-notification-listener.md), [`ADR-025`](./adr-025-billing-notification-email-channel.md)) 가 push + email 듀얼 채널까지 갖춰지고 나면, *모든 사용자에게 모든 알림이 강제 발송* 되는 단계가 마지막 부담으로 남아요. 이 단계에서 *사용자 측의 통제권* 이 없으면 운영의 여러 측면에서 부담이 누적됩니다.

**알림 피로도** 가 가장 직관적인 부담이에요. 사용자가 *결제 갱신 성공 알림* 을 매월 받는다고 상상해보면, 이 알림은 *대부분의 경우 정보 가치가 낮아요* — 사용자는 자기가 갱신을 신청한 걸 알고 있고, 결제가 성공했다는 사실은 카드 명세에서도 확인할 수 있습니다. 반복적인 *별로 중요하지 않은 알림* 이 쌓이면 사용자는 *모든 알림을 무시* 하기 시작하고, 정작 *결제 실패 같은 critical 알림* 도 함께 무시하게 됩니다. *알림 정책의 자기 파괴* 가 일어나요.

**법적 / 컴플라이언스 부담** 도 무시할 수 없습니다. *GDPR* 은 *마케팅성 알림에 대한 명시 동의* 를 요구하고, *한국 개인정보보호법* 도 *광고성 정보 수신 동의* 를 별도로 받도록 권장해요. 알림 종류별 토글이 없으면 *모든 알림이 동의 없이 발송* 되는 상태라 법적 리스크가 생깁니다. 사용자가 *결제 알림은 받되 마케팅 알림은 차단* 하는 분리 동의 표현이 시스템에서 지원되지 않으면 컴플라이언스 측면에서도 미달이에요.

**알림의 critical 도 차이** 도 영역별로 다릅니다. *결제 실패 알림* 은 *critical* 이라 사용자가 *받지 못하면 권한이 사라진 사실을 인지하지 못해* 운영 사고로 이어져요. 반면 *결제 갱신 성공 알림* 은 *optional* 이라 사용자가 끄고 싶어할 가능성이 높아요. 한 묶음으로 처리하면 *둘 다 받거나 둘 다 못 받는* 비대칭이 생기고, 사용자가 *결제 알림 자체를 모두 끄는* 형태로 critical 알림까지 막히는 결과가 나옵니다.

**발송 비용** 도 누적 부담이에요. 사용자가 *OS 설정에서 push 권한을 끄거나* *이메일 unsubscribe 를 클릭* 한 경우, 우리는 *그 사실을 인지하지 못한 채 발송 시도* 를 계속 합니다. push 는 *FCM 응답에서 invalid token* 으로 실패가 잡히지만, email 은 *bounce* 가 별도로 추적되지 않으면 *발송 비용 (Resend 가 청구하는 발송 건당 요금)* 이 *도달하지 않는 메일에도 누적* 돼요. preference 차원에서 *사용자가 명시 OFF 한 알림은 backend 가 발송조차 안 하는* 형태가 비용 측면에서도 정합합니다.

이 결정이 답해야 할 물음은 이거예요.

> **사용자가 알림 피로도와 법적 권리를 동시에 보호받을 수 있도록 알림 종류별 on/off 토글을 어떤 모델로 두고, listener 와 메트릭 체인에 어떻게 통합할 것인가?**

---

## 결정

| 항목 | 값 |
|---|---|
| **테이블** | `user_notification_preferences` (V014) — (user_id, kind, push_enabled, email_enabled) |
| **위치** | 슬러그별 schema (users 와 같은 schema) |
| **default** | 미등록 (user_id, kind) = enabled (push + email 모두) — 사용자 명시적 OFF 만 차단 |
| **분류 단위** | NotificationKind enum (RENEWAL_SUCCEEDED/FAILED/ABANDONED, IAP_REFUND/REVOKE) |
| **listener 통합** | dispatch 전 preference 체크 — toggle off 면 channel 별 skip |
| **메트릭** | toggle 로 skip 시 result=skipped counter 증가 (운영자가 toggle off 비율 추적 가능) |

---

## NotificationKind 매핑

| Event | NotificationKind |
|---|---|
| SubscriptionRenewalSucceededEvent | RENEWAL_SUCCEEDED |
| SubscriptionRenewalFailedEvent | RENEWAL_FAILED |
| SubscriptionRenewalAbandonedEvent | RENEWAL_ABANDONED |
| IapNotificationProcessedEvent (REFUND) | IAP_REFUND |
| IapNotificationProcessedEvent (REVOKE) | IAP_REVOKE |

→ 사용자가 "결제 성공 알림 끄기" / "갱신 실패만 받기" 등 fine-grained 토글 가능.

---

## Default = ON 정책

```java
@Transactional(readOnly = true)
public boolean isPushEnabled(long userId, NotificationKind kind) {
    return repository
            .findByUserIdAndKind(userId, kind)
            .map(NotificationPreference::isPushEnabled)
            .orElse(true);  // 미등록 = default ON
}
```

→ 새 가입자는 자동으로 모든 알림이 ON 이에요. 사용자가 명시적으로 OFF 한 시점부터 차단됩니다.

이는 운영자 결정에 따라 변경 가능해요 — **default OFF** (opt-in) 로 바꾸면 가입 후 사용자가 직접 ON 으로 켜야 받게 돼요. 한국 마케팅법 강제는 아니므로 default ON 으로 시작하는 게 운영의 일반적 형태예요.

---

## listener 통합 흐름

```java
private void sendPush(long userId, NotificationKind notificationKind, ...) {
    PushPort pushPort = pushProvider.getIfAvailable();
    if (pushPort == null) {
        countMetric("push", kind, "skipped");
        return;
    }
    if (!preferenceService.isPushEnabled(userId, notificationKind)) {
        countMetric("push", kind, "skipped");  // toggle off 도 skipped 카운트
        return;
    }
    pushPort.sendToUser(userId, message);
    countMetric("push", kind, "success");
}
```

같은 패턴으로 email 도. **메트릭 result 라벨이 toggle off / 미등록 / 실패 모두 skipped 통합** — 세분화 필요 시 별도 라벨 추가 가능.

---

## 검증 (단위 테스트 3건 추가 — 총 22건)

`SubscriptionNotificationListenerTest`:
- `preference_pushOff_skipsPush_emailStillSent` — push 만 OFF
- `preference_emailOff_skipsEmail_pushStillSent` — email 만 OFF
- `preference_bothOff_skipsBoth` — 모두 OFF

`AlwaysOnPreferenceService` (default tests) + `ToggleablePreferenceService` (skip 검증) — 둘 다 NotificationPreferenceService 상속.

---

## API endpoint (적용 완료)

사용자가 preference 설정하는 endpoint:

```
GET    /api/apps/<slug>/me/notification-preferences            (조회)
PATCH  /api/apps/<slug>/me/notification-preferences/{kind}     (변경)
```

→ **`NotificationPreferenceController` 신규 추가됨** (`core/core-billing-impl/.../controller/`). `NotificationPreferenceControllerTest` 가 Testcontainers + @SpringBootTest + MockMvc + JWT 로 GET/PATCH 200/204/401 + 영속 + upsert 6 건 검증 (`-parameters` compile flag 미설정 환경 호환을 위해 `@PathVariable("appSlug")` / `@PathVariable("kind")` name 명시).

---

## 대안 비교

### 옵션 A — Boolean column 5개 (`notify_renewal_succeeded` 등)

- 단순해요. JOIN 이 0이에요.
- ❌ NotificationKind 추가 시 ALTER TABLE — schema 변경이 필요해요
- ❌ "어떤 알림 받는지" 일관 조회가 어려워요

### 옵션 B — `user_notification_preferences` 별도 테이블 ★ 채택

- (user_id, kind) PK 예요. 새 kind 추가 = enum + INSERT (schema 변경 X)
- 사용자별 모든 설정을 1번 SELECT 로 가져와요
- 미등록 = default ON 으로 명시적 의미가 있어요

### 옵션 C — JSON column (`users.notification_preferences JSONB`)

- 가장 유연해요
- ❌ 검색이 어려워요 (`WHERE notification_preferences->>'renewal_succeeded' = 'true'`)
- ❌ 동시 update race 가 발생해요 (compare-and-swap 없음)

---

## 안 다루는 범위 (다음 사이클)

- **마케팅성 알림** (newsletter / 프로모션) — 별도 NotificationKind 추가 + 알림 channel 통합
- **OS 알림 권한 거부 자동 감지** — Flutter 앱이 권한 변경 시 backend 에 동기화
- **알림 받는 시간대** (예: 22:00~07:00 안 받기) — quiet hours 정책
- **알림 빈도 제한** (rate limiting per user) — 같은 kind 1시간 1회
- **GDPR consent 로그** — 사용자가 toggle 변경한 이력 추적 (audit log 활용 가능)

---

## 관련 파일 (신규)

- `tools/new-app/new-app.sh` — V014 마이그레이션 heredoc
- `core/core-billing-api/.../api/NotificationKind.java` — enum (api 모듈 위치 — 다른 도메인이 의존 가능)
- `core/core-billing-impl/.../entity/NotificationPreference.java` — JPA entity
- `core/core-billing-impl/.../repository/NotificationPreferenceRepository.java` — Spring Data JPA
- `core/core-billing-impl/.../notification/NotificationPreferenceService.java` — 비즈 로직 (`isPushEnabled` / `isEmailEnabled` / `update`)
- `core/core-billing-impl/.../controller/NotificationPreferenceController.java` — GET/PATCH endpoint
- `core/core-billing-impl/src/test/.../controller/NotificationPreferenceControllerTest.java` — Testcontainers + MockMvc 6건

수정:
- `core/core-billing-impl/.../listener/SubscriptionNotificationListener.java` — preference 체크 추가
- `core/core-billing-impl/.../BillingAutoConfiguration.java` — NotificationPreferenceService bean
- `core/core-billing-impl/src/test/.../SubscriptionNotificationListenerTest.java` — 3건 추가
