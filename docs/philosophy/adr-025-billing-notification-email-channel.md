# ADR-025 — 결제 알림 listener 의 email 채널 통합

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~5분

**상태**: 채택 (2026-05-02)
**전제**: ADR-023 (push 알림 listener), ADR-024 (core-email 도메인 추출)
**연관**: L 사이클 — push + email 듀얼 채널

---

## 결론부터

ADR-023 의 listener 에 *email 채널* 을 추가해 push + email 듀얼 발송을 합니다. ADR-024 의 core-email 추출 후 billing 이 EmailPort 를 자유롭게 import 할 수 있어요.

`@ConditionalOnBean` 의 *OR* 처리로 PushPort / EmailPort 중 *하나라도 있으면* listener 가 등록돼요. 둘 다 있으면 *모두 발송* 하고, Email 발송 실패는 *silent skip* (push 성공만으로도 알림 의무가 충족됨).

---

## 배경

ADR-023 = listener 가 push 만 발송하던 상태였어요. email 은 별도 사이클로 미뤘어요 (당시 EmailPort 가 core-auth 안에 묻혀 있어 billing 이 import 할 수 없었어요).

ADR-024 로 core-email-api 가 추출되면서 → billing 이 EmailPort 를 자유롭게 import 할 수 있게 됐어요.

이제 H/I 이벤트 (Renewal Failed/Abandoned + IAP REFUND/REVOKE) 에 push + email 둘 다 발송해요. **앱 미설치 / 토큰 만료** 사용자 케이스를 cover 합니다.

---

## 결정

| 항목 | 값 | 사유 |
|---|---|---|
| **채널 듀얼** | push + email 둘 다 발송 | 사용자가 알림 못 받는 케이스 (앱 미설치/푸시 권한 거부) cover |
| **채널 옵션화** | `ObjectProvider<PushPort>` + `ObjectProvider<EmailPort>` | 한쪽만 / 둘 다 / 없음 모두 지원 |
| **Conditional 활성화** | PushPort **또는** EmailPort 등록 (`AnyNestedCondition`) + `notification.enabled=true` | 둘 다 없으면 listener 등록 X |
| **UserPort 의존** | 필수 (email 조회용) — UserPort 없으면 부팅 실패 | core-billing-impl 이 이미 core-user-api 의존 |
| **Email 검증** | `emailVerified=true` 이고 email 이 null/empty 아닐 때만 발송 | SPF/DMARC bounce 회피 |
| **실패 격리** | 한 채널 실패가 다른 채널 막지 않음 | 각자 try-catch + log only |
| **템플릿 분리** | push (`title`/`body`) + email (`emailSubject`/`emailHtml`) — 같은 Template 클래스 | 채널 별 톤 조정 가능 (push 짧음 / email 자세히) |

---

## ConditionalOnBean 의 OR 처리

Spring Boot 의 `@ConditionalOnBean` 은 단일 bean 검사예요. 두 bean 중 **하나 이상** 등록 조건은 `AnyNestedCondition` 으로 구성해요:

```java
static class PushOrEmailPresent extends AnyNestedCondition {
    PushOrEmailPresent() { super(ConfigurationPhase.REGISTER_BEAN); }

    @ConditionalOnBean(PushPort.class) static class HasPush {}
    @ConditionalOnBean(EmailPort.class) static class HasEmail {}
}
```

`@Conditional(PushOrEmailPresent.class)` 적용 시 PushPort or EmailPort 둘 중 하나만 있어도 listener 가 등록돼요.

---

## 발송 흐름

```
이벤트 도착 → SlugContext.set(slug)
            → sendPush()
                ├─ PushPort.getIfAvailable() == null → skip
                └─ PushPort.sendToUser(userId, message) → try-catch + log
            → sendEmail()
                ├─ EmailPort.getIfAvailable() == null → skip
                ├─ Template.emailSubject/Html null → skip (push only template)
                ├─ UserPort.getSummary(userId) → throw 시 skip + log
                ├─ user == null / email blank / emailVerified=false → skip
                └─ EmailPort.send(email, subject, html) → try-catch + log
            → SlugContext.clear() (finally)
```

---

## Email skip 케이스 (의도적)

| 케이스 | 처리 | 이유 |
|---|---|---|
| EmailPort 등록 X | skip | 운영 환경 미통합 — push 만 발송 |
| Template.emailSubject/Html null | skip | 일부 알림은 push only 정책 |
| user.email == null | skip | 소셜 로그인 사용자 (Apple Hide My Email 등 가능) |
| user.email blank | skip | 데이터 무결성 안전망 |
| user.emailVerified == false | skip | bounce 방지 — 미인증 메일은 도달 보장 X |
| UserPort 호출 throw | skip + warn log | DB 장애 시 push 만이라도 발송 |

---

## 템플릿 분리 (push vs email)

```yaml
app.billing.notification:
  enabled: true
  renewal-failed:
    title: "결제가 실패했습니다"           # push 알림 표시 (짧고 자극적)
    body: "잠시 후 자동으로 재시도합니다..."  # push body
    email-subject: "[알림] 결제가 실패했습니다"  # email 제목 (브랜드 prefix)
    email-html: "<p>...</p>"                # email body (HTML, 자세히)
```

운영자가 채널별 톤 / 정책 / 다국어를 자유롭게 수정할 수 있어요. 한국어가 default 로 셋팅돼요.

---

## 검증 (단위 테스트 13건)

`SubscriptionNotificationListenerTest`:

1. `renewalSucceeded_sendsPushAndEmail` — 둘 다 발송
2. `renewalFailed_sendsPushAndEmail_withFailedTemplate` — 템플릿 정확
3. `renewalAbandoned_sendsPushAndEmail`
4. `iapRefund_sendsBothChannels`
5. `iapDidRenew_doesNotSend` — 알림 가치 낮음 skip
6. `iapNotification_withoutUserId_skipsBoth`
7. `pushFailure_doesNotPropagate_andEmailStillSent` — 실패 격리
8. `emailFailure_doesNotPropagate_andPushStillSent`
9. `unverifiedEmail_skipsEmail_pushStillSent` — emailVerified=false skip
10. `nullUserEmail_skipsEmail_pushStillSent`
11. `pushOnly_emailPortAbsent_pushStillSent` — EmailPort 미등록
12. `emailOnly_pushPortAbsent_emailStillSent` — PushPort 미등록
13. `userLookupFails_emailSkipped_pushStillSent` — UserPort throw

`CapturingPushPort` + `CapturingEmailPort` + `FakeUserPort` (ADR-014: delegation mock 금지, fake adapter).

---

## 대안 비교

### 옵션 A — 별도 listener 클래스 분리 (`PushListener` + `EmailListener`)

- 각자 ConditionalOnBean(PushPort) / ConditionalOnBean(EmailPort)
- ❌ 코드 중복 — 같은 이벤트, 같은 분기 (RenewalFailed → 템플릿 결정 → 발송)
- ❌ 두 listener 가 같은 SlugContext 셋업 / 정리 — 동일 처리

### 옵션 B — 단일 listener + ObjectProvider ★ 채택

- 한 listener 가 두 채널 dispatch
- ObjectProvider 로 nullable 의존 — Spring 표준 패턴
- 템플릿 한 곳 (Template 클래스가 둘 다 가짐)
- 설정 단순 (`notification.enabled` 하나)

### 옵션 C — NotificationDispatcher 추상화

- listener → NotificationDispatcher.dispatch() → 각 채널 어댑터로 라우팅
- ❌ over-engineering — 채널 2개 시점에 추상화 비용 ↑
- 향후 SMS / 카톡 / 인앱메시지 추가 시점에 도입 (4채널 이상)

---

## 안 다루는 범위 (다음 사이클)

- **알림 발송 메트릭** (M 사이클) — Prometheus counter (sent/failed/skipped per channel)
- **사용자 알림 환경설정** — "결제 알림 끄기" toggle
- **다국어 템플릿** — 사용자 locale 별 분기 (글로벌 출시 후)
- **HTML email 템플릿** — Mustache / Thymeleaf 로 동적 placeholder 치환
- **알림 발송 보장 (Outbox)** — DB 저장 + worker retry — 알림 critical 한 환경에서

---

## 관련 파일

수정:
- `core/core-billing-impl/.../listener/SubscriptionNotificationListener.java` — ObjectProvider + UserPort + EmailPort
- `core/core-billing-impl/.../BillingNotificationProperties.java` — emailSubject/emailHtml 추가
- `core/core-billing-impl/.../BillingAutoConfiguration.java` — `AnyNestedCondition` 적용
- `core/core-billing-impl/src/test/.../SubscriptionNotificationListenerTest.java` — 13건으로 확장
