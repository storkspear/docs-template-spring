# ADR-031 — 사용자 알림 설정 (toggle)

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~5분

**상태**: 채택 (2026-05-02)
**전제**: ADR-023 (push listener), ADR-025 (email 채널), ADR-026 (메트릭)
**연관**: S 사이클 — 사용자 권리 / GDPR 동의 분리

---

## 결론부터

사용자가 알림 종류별 *on/off* 토글 (예: `RENEWAL_FAILED` / `RENEWAL_SUCCESS` / `MARKETING`). `NotificationKind` enum + `user_notification_preferences` 테이블 — default=ON.

발송 직전 listener 가 *user preference* 조회해 OFF 면 silent skip. API endpoint (`PATCH /me/notifications/preferences`) 는 본 사이클 scope 외 — *Phase 2-3* 에서 추가.

---

## 배경

L 사이클로 push + email 듀얼 알림 구현. 그러나 **사용자가 끌 수 없음**. 운영 시:

- 모든 사용자에게 모든 알림 강제 발송 — 알림 피로도
- GDPR / 한국 개인정보보호법 — 마케팅성 알림 동의 분리 권장
- 결제 실패 알림은 critical (켜놓는 게 정도) / 결제 성공 알림은 optional
- 사용자가 알림 자체 차단 시 (OS 설정 / 이메일 unsubscribe) backend 도 stop 해야 — 발송 비용 절감

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

→ 새 가입자는 자동 모든 알림 ON. 사용자가 명시 OFF 시점부터 차단.

이는 운영자 결정에 따라 변경 가능 — **default OFF** (opt-in) 로 바꾸면 가입 후 사용자가 직접 ON 켜야 받음. 한국 마케팅법 강제 아니므로 default ON 으로 시작하는 게 운영 일반.

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

## API endpoint (다음 사이클)

본 사이클은 listener 통합 + DB schema 만. 사용자가 preference 설정하는 endpoint:

```
GET    /api/apps/<slug>/me/notification-preferences            (조회)
PATCH  /api/apps/<slug>/me/notification-preferences/{kind}     (변경)
```

→ **다음 사이클** 또는 derived 앱에서 추가. NotificationPreferenceService.update() 가 이미 있으므로 controller 만 추가하면 끝.

---

## 대안 비교

### 옵션 A — Boolean column 5개 (`notify_renewal_succeeded` 등)

- 단순. JOIN 0.
- ❌ NotificationKind 추가 시 ALTER TABLE — schema 변경
- ❌ "어떤 알림 받는지" 일관 조회 어려움

### 옵션 B — `user_notification_preferences` 별도 테이블 ★ 채택

- (user_id, kind) PK. 새 kind 추가 = enum + INSERT (schema 변경 X)
- 사용자별 모든 설정 1번 SELECT
- 미등록 = default ON 의 명시적 의미

### 옵션 C — JSON column (`users.notification_preferences JSONB`)

- 가장 유연
- ❌ 검색 어려움 (`WHERE notification_preferences->>'renewal_succeeded' = 'true'`)
- ❌ 동시 update race (compare-and-swap 없음)

---

## 안 다루는 범위 (다음 사이클)

- **API endpoint** (조회/변경) — 컨트롤러만 추가하면 됨. 이번 사이클은 backend 인프라만
- **마케팅성 알림** (newsletter / 프로모션) — 별도 NotificationKind 추가 + 알림 channel 통합
- **OS 알림 권한 거부 자동 감지** — Flutter 앱이 권한 변경 시 backend 에 동기화
- **알림 받는 시간대** (예: 22:00~07:00 안 받기) — quiet hours 정책
- **알림 빈도 제한** (rate limiting per user) — 같은 kind 1시간 1회
- **GDPR consent 로그** — 사용자가 toggle 변경한 이력 추적 (audit log 활용 가능)

---

## 관련 파일 (신규)

- `tools/new-app/new-app.sh` — V014 마이그레이션 heredoc
- `core/core-billing-impl/.../notification/NotificationKind.java`
- `core/core-billing-impl/.../notification/NotificationPreference.java` (entity)
- `core/core-billing-impl/.../notification/NotificationPreferenceRepository.java`
- `core/core-billing-impl/.../notification/NotificationPreferenceService.java`

수정:
- `core/core-billing-impl/.../listener/SubscriptionNotificationListener.java` — preference 체크 추가
- `core/core-billing-impl/.../BillingAutoConfiguration.java` — NotificationPreferenceService bean
- `core/core-billing-impl/src/test/.../SubscriptionNotificationListenerTest.java` — 3건 추가
