# ADR-025 — 결제 알림 listener 의 email 채널 통합

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~5분

**Status**: Accepted. `SubscriptionNotificationListener` 가 push + email 듀얼 채널을 발송. `@AnyNestedCondition` 으로 PushPort 또는 EmailPort 중 하나만 있어도 listener 등록.

---

## 결론부터

결제 알림은 *사용자에게 권한 변경의 사유를 알리는 채널* 이라 ([`ADR-023`](./adr-023-billing-notification-listener.md)), 그 채널이 *얼마나 도달하는가* 가 운영의 핵심이에요. push 만으로는 *앱이 미설치된 사용자*, *알림 권한을 거부한 사용자*, *FCM 토큰이 만료된 사용자* 에게 도달하지 못합니다. email 은 그 갭을 메우는 fallback 채널이고, 두 채널을 동시에 보내면 *둘 중 하나라도 도달* 할 확률이 크게 올라가요.

본 ADR 은 결제 알림 listener 에 *email 채널* 을 추가해 push + email 을 동시에 발송하는 듀얼 채널 구조를 정의합니다. 발송 대상은 [`ADR-021`](./adr-021-renewal-failure-policy.md) / [`ADR-022`](./adr-022-iap-server-notifications.md) 가 발행하는 갱신 실패 / 갱신 포기 / IAP REFUND / IAP REVOKE 이벤트들이에요. 두 채널 중 *어느 한쪽이 비활성* 인 환경 (예: PushPort 만 있고 EmailPort 가 없는 환경, 또는 그 반대) 도 자연스럽게 지원하도록 `@AnyNestedCondition` 으로 *OR 조건 등록* 패턴을 도입했고, *한 채널의 발송 실패가 다른 채널을 막지 않는* 격리 정책도 함께 잡았습니다.

이 ADR 의 범위는 listener 의 듀얼 채널 등록 조건, 사용자별 email 검증 기준 (`emailVerified=true` + email 이 비어 있지 않아야 함), 채널별 메시지 템플릿 분리 (push 는 짧게, email 은 자세히), 발송 실패 격리 정책, 그리고 user → email 조회를 위한 UserPort 의존성까지입니다.

---

## 왜 이런 결정이 필요했나?

push 알림 한 채널만으로는 *알림 도달률* 에 구조적 한계가 있어요. 사용자 입장에서 push 를 받지 못하는 시나리오가 의외로 많습니다.

가장 흔한 케이스는 *앱이 휴대폰에 설치되어 있지 않은 상태* 예요. 사용자가 *결제만 하고 한동안 앱을 사용하지 않거나*, *기기를 바꿔서 앱을 새로 설치하지 않은 상태* 에서 갱신 실패가 발생하면 push 로는 그 사실이 도달할 길이 없습니다. 결제 갱신 / 환불 같은 사건은 *앱을 매일 쓰지 않는 사용자에게도* 도달해야 하는 정보라 push 만으로는 부족해요.

두 번째는 *알림 권한 거부* 입니다. iOS / Android 모두 사용자가 *처음 앱 실행 시* 알림 권한을 명시적으로 허용해야 push 가 도달해요. 사용자가 권한을 거부하거나 *나중에 시스템 설정에서 끈* 경우 push 는 발송되어도 사용자에게 보이지 않습니다. 결제 같은 *권한 변경 통지* 가 이런 사용자에게 도달하지 못하면 운영 부담이 직접적으로 늘어요.

세 번째는 *FCM 토큰 만료* 입니다. FCM 토큰은 *앱 재설치, OS 업데이트, Google Play Services 갱신* 등의 이벤트로 invalidate 될 수 있고, 우리 시스템이 *invalid 토큰을 가지고 있는 상태* 에서 push 를 보내면 발송은 *성공처럼 보이지만 실제로 도달하지 않아요*. 이 케이스는 *발송 로그만 보면 알 수 없는* 침묵의 실패입니다.

이 세 가지 케이스에서 *email 은 자연스러운 fallback* 이에요. 사용자의 email 주소는 *기기 / 앱 설치 / OS* 와 무관하게 안정적이고, 이메일 클라이언트는 거의 모든 사용자가 *어떤 형태로든 확인하는* 채널입니다. 발송 도달률이 push 보다 *느릴 수 있지만* (사용자가 메일을 봐야 하므로), *결제 같은 비긴급 알림* 은 *반드시 도달* 하는 게 *즉시 도달* 보다 가치가 커요.

이메일을 별도 채널이 아니라 *push 와 동시에 발송* 하는 듀얼 구조로 잡은 이유도 여기 있습니다. *한쪽만 보내는 분기 로직* 은 *어떤 사용자가 push 를 받을 수 있는지* 를 우리가 정확히 판단해야 한다는 부담을 만들어요. 두 채널을 동시에 보내면 *둘 중 도달하는 쪽으로 사용자가 인지* 하면 되어, 우리는 *발송 시도* 의 책임만 지면 됩니다. push 가 성공하면 사용자는 email 을 무시하고, push 가 도달하지 않으면 email 이 fallback 으로 작동하는 자연스러운 흐름이에요.

이 결정이 답해야 할 물음은 이거예요.

> **결제 알림의 도달률을 보장하기 위해 push + email 을 어떻게 듀얼로 구성하고, 한쪽 채널만 활성화된 환경도 자연스럽게 지원할 것인가?**

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
