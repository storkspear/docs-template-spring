# ADR-024 — core-email 도메인 추출

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~6분

**Status**: Accepted. `core-email-api` + `core-email-impl` 별도 모듈에서 `EmailPort` / `ResendEmailAdapter` / `EmailException` 을 관리해요. 어떤 도메인 (`auth` / `billing` / 운영) 도 ArchUnit r3 위반 없이 의존할 수 있습니다.

---

## 결론부터

이메일 발송은 *어느 한 도메인의 전용 기능* 이 아니에요. 인증 도메인이 *가입 인증 메일 / 비밀번호 재설정 메일* 을 보내는 것이 가장 두드러지지만, 결제 도메인도 *갱신 실패 알림* 을 보내고, 운영 도메인도 *공지 메일* 을 보내요. *어느 도메인이든 자유롭게 쓸 수 있어야* 자연스러운 *cross-cutting 기능* 입니다. push 알림이나 SMS 도 같은 결의 기능이에요.

본 ADR 은 이메일 발송 인프라 (`EmailPort`, `ResendEmailAdapter`, `LoggingEmailAdapter`, `EmailException`, `ResendProperties`) 를 `core-email-api` + `core-email-impl` 별도 모듈로 추출하는 결정을 기록합니다. 이 분리의 핵심 동기는 *ArchUnit 의 r3 룰 (`core-*-impl` 끼리 import 금지)* 과 *도메인 횡단 기능* 의 자연스러운 모듈 위치를 정합시키는 것이에요. 이메일이 한 도메인 (`core-auth`) 안에 묶여 있으면 다른 도메인들이 *그 도메인의 부속물처럼 의존* 하는 어색한 구조가 생기는데, 별도 모듈로 추출하면 *어느 도메인도 평등하게 의존* 할 수 있는 형태가 됩니다.

ArchUnit 룰의 정합성도 함께 정리돼요. 기존 `r3 CORE_IMPL_MUST_NOT_DEPEND_ON_EACH_OTHER` 가 *패턴 기반 (`core-*-impl` → `core-*-impl` 금지)* 이라 새 도메인 룰을 추가할 필요 없이 자동으로 적용됩니다. `core-email-api` 는 모든 `core-*-impl` 과 `apps/*` 가 자유롭게 의존할 수 있고, `core-email-impl` 은 `bootstrap` 만 직접 의존하는 형태로 깔끔하게 자리잡아요. 외부 인터페이스 (REST 엔드포인트, 환경변수 이름) 는 *0 변경* 으로 유지되어 운영 환경에 미치는 영향도 없습니다.

이 ADR 의 범위는 모듈 추출 전후의 의존 구조, ArchUnit 룰과의 정합성, `EmailException` 의 도메인 분리 (auth 의 ATH 코드 → email 의 EMAIL 코드), 그리고 *도메인 횡단 기능* 을 *별도 모듈* 로 다루는 일반 원칙까지입니다.

---

## 왜 이런 결정이 필요했나?

이메일이 *인증 도메인 전용* 이라는 가정은 *처음에는 맞지만 곧 깨지는* 단순화예요. 가입 인증 메일과 비밀번호 재설정 메일이 *인증 도메인의 책임* 이라는 사실은 분명하지만, 시스템이 자라면서 *다른 도메인이 이메일을 보낼 시점* 이 반드시 옵니다. 결제 실패 알림, 환불 처리 통보, 가족 공유 해지 안내, 신규 기능 출시 공지 — 어느 것이든 *이메일이라는 채널* 을 빌려 사용자에게 전달돼요.

이 시점에서 *이메일이 인증 도메인 안에 묶여 있는* 구조는 두 가지 부적합한 결과로 돌아옵니다.

**첫째는 ArchUnit r3 룰과의 충돌** 입니다. 우리 시스템은 *core 도메인끼리 직접 의존하지 않는* 원칙을 ArchUnit 룰 r3 로 강제해요. 이는 *모듈 간 결합을 방지하고 미래 추출 가능성* ([`ADR-001`](./adr-001-modular-monolith.md), [`ADR-003`](./adr-003-api-impl-split.md)) 을 보장하기 위함입니다. 그런데 결제 도메인이 *이메일을 보내려면* `core-billing-impl` 이 `core-auth-impl` 의 `ResendEmailAdapter` 를 import 해야 하는데, 이는 r3 룰의 정면 위반이에요. 룰을 풀면 *결합 통제 자체가 무너지고*, 룰을 유지하면 *결제 도메인이 이메일을 보낼 길이 막힙니다*.

**둘째는 도메인 의미의 왜곡** 이에요. *`core-billing-impl` 이 `core-auth-api` 를 의존* 하는 형태가 ArchUnit 측면에서는 합법이지만 (api 의존은 허용), 도메인 의미상으로는 *결제가 인증의 부속물* 처럼 읽히는 어색한 구조를 만들어요. 새 사람이 의존 그래프를 보면 *왜 결제가 인증을 import 하지?* 라는 자연스러운 의문이 떠오르고, 그 의문에 대한 답이 *이메일 발송 때문* 이라는 사실은 *모듈 이름과 책임의 불일치* 를 드러냅니다. 이름이 책임을 정확히 반영하지 못하는 구조는 시간이 갈수록 더 큰 혼란을 누적시켜요.

**셋째는 다른 cross-cutting 기능에도 같은 문제가 반복** 됩니다. 이메일과 본질적으로 같은 결인 *push 알림*, *SMS*, *Slack 알림* 같은 기능들이 추가되면 모두 *어느 도메인 안에 둘지* 의 같은 결정을 마주하게 돼요. 이메일을 별도 모듈로 추출하는 결정이 정착되면 *cross-cutting 기능은 자기 모듈을 갖는다* 는 일반 원칙이 자연스럽게 따라옵니다 (실제로 push 는 `core-push-api` / `core-push-impl` 로 같은 패턴이에요).

이 결정이 답해야 할 물음은 이거예요.

> **여러 도메인이 자유롭게 사용해야 하는 cross-cutting 기능 (이메일 / push / SMS) 을 어느 모듈에 두면, ArchUnit 룰을 유지하면서 도메인 의미도 자연스럽게 표현할 수 있는가?**

---

## 고민했던 대안들

> **대안 분석의 한계** — 본 ADR 은 *한 방향적 결정* 이에요. 이메일을 *cross-cutting 기능* 으로 다루려면 *별도 모듈 분리* 외 다른 합리적 경로가 없어요. 그래서 형식적 대안 비교보다는 *왜 다른 형태가 부적합한가* 를 짧게 기록해요.

### 대안 1 — auth 안에 두고 cross-cutting 표시

`core-auth-api` 안에 `EmailPort` 를 두되 *주석 / 문서로 cross-cutting* 표시를 합니다. billing 등 다른 도메인이 *명시적으로 core-auth-api 에 의존* 하게 만들어요.

- ❌ *명시적 의존* 으로도 *billing 이 auth 의 부속* 인상이 사라지지 않아요
- ❌ ArchUnit 룰이 *의도* 를 인식하지 못해요 (코드 의존 그래프만 봐요)
- ❌ 이메일 외 *push 알림* 등 다른 cross-cutting 기능도 같은 문제가 반복돼요

### 대안 2 — 별도 microservice (REST 호출)

이메일 발송을 별도 서비스로 분리해 HTTP 로 호출하는 방식이에요.

- ❌ 솔로 인디 스케일에서 과도해요. 운영 인스턴스 + 모니터링 + 배포 부담이 늘어나요
- ❌ 트랜잭션 경계가 복잡해져요 (이메일 실패 시 transaction rollback 정책)
- ❌ 본 template 의 *모듈러 모놀리스* 원칙 ([`ADR-001`](./adr-001-modular-monolith.md)) 에 위반돼요

### 채택 — `core-email-api` + `core-email-impl` 별도 모듈

ADR-001 의 모듈러 모놀리스 + ADR-003 의 api/impl 분리 패턴을 그대로 적용해요. 이메일은 *별도 도메인* 으로 격상돼요.

---

## 결정

**`core-email-api` + `core-email-impl` 별도 모듈 추출**:

```
core-email-api/
  └─ com.factory.core.email.api/
      ├─ EmailPort.java              ← interface (auth 에서 이동)
      └─ exception/
          ├─ EmailError.java         ← EMAIL_DELIVERY_FAILED (EMAIL_001)
          └─ EmailException.java     ← 신규

core-email-impl/
  └─ com.factory.core.email.impl/
      ├─ ResendEmailAdapter.java     ← auth/email/ 에서 이동 (EmailException throw)
      ├─ LoggingEmailAdapter.java    ← 동
      ├─ ResendProperties.java       ← 동
      └─ EmailAutoConfiguration.java ← 신규 (AuthAutoConfig 의 bean 등록 옮김)
```

`core-auth-impl` → `core-email-api` 의존 추가. 다른 도메인 (billing 등) 도 자유롭게 EmailPort 사용 가능.

---

## ADR-019 와의 정합

ADR-019 = billing/iap/payment 분리 결정 (channel-specific vs policy layer). 같은 정신:

| ADR-019 결정 | ADR-024 결정 |
|---|---|
| billing (정책) / iap (Apple/Google) / payment (PG) 분리 | auth (인증) / email (발송 채널) 분리 |
| 채널 추가 시 (Stripe 등) 도메인 신규 | 발송 채널 추가 시 (SMTP/SES 등) 어댑터 추가 |
| 정책 layer 가 채널 무관 | auth/billing 등 호출 측이 발송 채널 무관 |

---

## 이 선택이 가져온 것

### 긍정

- **도메인 횡단 활용** — billing 의 결제 실패 알림 ([`ADR-025`](./adr-025-billing-notification-email-channel.md)) 가 자연스럽게 EmailPort 를 사용해요. auth 의존이 없어요
- **EmailException 도메인 분리** — 이메일 발송 실패는 `EmailException(EmailError.EMAIL_DELIVERY_FAILED, cause)` 로 처리:
  ```java
  throw new EmailException(EmailError.EMAIL_DELIVERY_FAILED, cause);
  ```
  각 호출 도메인 (auth / billing) 이 필요 시 자기 도메인 exception 으로 wrap. 또는 그대로 propagate (BaseException 자식이라 ApiResponseAdvice 가 캐치)
- **환경변수 호환성** — `app.email.resend.*` properties 를 그대로 유지해요 (`RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, `RESEND_FROM_NAME` 등 .env 변수 변경 X). ResendProperties 의 패키지만 이동해요. ConfigurationPropertiesScan 이 자동으로 발견합니다
- **운영 배포 영향 0** — 모듈 리팩터링이라 jar 안의 클래스 위치만 바뀌고 외부 인터페이스 (REST endpoint, env, 비즈동작) 동일
- **새 발송 채널 추가 단순** — SMTP / Gmail API / SES / SendGrid 등 추가 시 `core-email-impl` 에 어댑터 1개만 추가

### 부정

- **모듈 수 +2** — settings.gradle / bootstrap/build.gradle 갱신 필요. Gradle 빌드 시간 minor 증가
- **import 일괄 갱신** — `core-auth-impl` 의 모든 `EmailPort` import 변경 (`core-auth-api` → `core-email-api`)
- **테스트 fixture 위치 모호** — `EmailRecorder` / `InMemoryEmailAdapter` 가 현재는 `core-auth-api/testFixtures` 에 남아 있어 *테스트 fixture 도 email 도메인으로 이동* 이 자연스러움 (다음 사이클)

---

## 추출 작업 요약

1. **`core-email-api`** 신규 — `EmailPort` 이동, `EmailError`/`EmailException` 신규
2. **`core-email-impl`** 신규 — Resend/Logging adapter + Properties 이동, `EmailAutoConfiguration` 신규 (`META-INF/spring/...AutoConfiguration.imports` 등록)
3. **`core-auth-api`** — `EmailPort` 제거
4. **`core-auth-impl`** — `core-email-api` 의존 추가, import 일괄 변경, `AuthAutoConfiguration` 의 email bean 등록 제거 (`EmailAutoConfiguration` 으로 이전)
5. **`bootstrap`** — `core-email-impl` 의존 추가
6. **`settings.gradle`** — 새 모듈 등록
7. **테스트** — `ResendEmailAdapterTest`, `LoggingEmailAdapterTest` 도 `core-email-impl/test` 로 이동 (패키지 + import 갱신)

---

## ArchUnit 룰

기존 `r3 CORE_IMPL_MUST_NOT_DEPEND_ON_EACH_OTHER` 가 패턴 기반 (`core-*-impl` → `core-*-impl` 금지) 이라 자동으로 적용돼요. 새 도메인 룰 추가가 필요 없어요.

`core-email-api` 는 모든 `core-*-impl` / `apps/*` 가 의존할 수 있어요. `core-email-impl` 은 `bootstrap` 만 직접 의존합니다 (`core-*-impl` 끼리 의존 금지).

---

## 교훈

**도메인 횡단 기능은 별도 모듈로 격상해야 cross-cutting 의 자유도가 생긴다.** 처음에 *auth 안의 sub-feature* 로 보였던 이메일이 *billing 알림 / 운영 공지* 까지 확장 가능성이 보이는 순간 — 즉 *호출 측이 다양해지는 신호* 가 보일 때 — 별도 도메인으로 격상이 답이에요.

ArchUnit 의 패턴 기반 룰 (r3) 이 *도메인 경계* 를 자동 강제해 주기 때문에, 격상 의사결정은 *모듈 추가* 만으로 끝나고 추가 룰 작성이 필요 없어요. ADR-001 의 모듈러 모놀리스 + ADR-003 의 api/impl 분리 패턴을 *cross-cutting 도메인* 으로 그대로 확장한 사례.

---

## 안 다루는 범위 (다음 사이클)

- **SubscriptionNotificationListener 의 email 발송** — push + email 둘 다 발송하려면 UserPort 를 통한 email 조회 + 메시지 템플릿 분리가 필요해요. 별도 사이클로 다뤄요.
- **Email contract test** — `core-email-api/testFixtures` 로 `EmailRecorder` 이동 + `InMemoryEmailAdapter` 추출. 현재는 `core-auth-api/testFixtures` 에 남아 있어요.
- **추가 발송 채널** — SMTP / Gmail API / SES / SendGrid 어댑터. 필요 시 `core-email-impl` 에 추가만 하면 돼요.

---

## 관련 파일

신규:
- `core/core-email-api/build.gradle`
- `core/core-email-api/src/main/java/com/factory/core/email/api/EmailPort.java`
- `core/core-email-api/src/main/java/com/factory/core/email/api/exception/EmailError.java`
- `core/core-email-api/src/main/java/com/factory/core/email/api/exception/EmailException.java`
- `core/core-email-impl/build.gradle`
- `core/core-email-impl/src/main/java/com/factory/core/email/impl/ResendEmailAdapter.java`
- `core/core-email-impl/src/main/java/com/factory/core/email/impl/LoggingEmailAdapter.java`
- `core/core-email-impl/src/main/java/com/factory/core/email/impl/ResendProperties.java`
- `core/core-email-impl/src/main/java/com/factory/core/email/impl/EmailAutoConfiguration.java`
- `core/core-email-impl/src/main/resources/META-INF/spring/...AutoConfiguration.imports`
- `core/core-email-impl/src/test/.../ResendEmailAdapterTest.java`
- `core/core-email-impl/src/test/.../LoggingEmailAdapterTest.java`

수정:
- `settings.gradle` — 새 모듈 등록
- `bootstrap/build.gradle` — core-email-impl 의존
- `core/core-auth-api/.../EmailPort.java` — **삭제**
- `core/core-auth-impl/build.gradle` — core-email-api 의존 추가
- `core/core-auth-impl/.../AuthAutoConfiguration.java` — email bean / Resend property scan 제거
- `core/core-auth-impl/**/*.java` — `EmailPort` import 일괄 변경
