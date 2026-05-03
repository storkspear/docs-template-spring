# ADR-024 — core-email 도메인 추출

**상태**: 채택 (2026-05-02)
**전제**: ADR-019 (도메인 횡단 기능 분리), ADR-023 (결제 알림 listener)
**연관**: K-refactor 사이클 — email 인프라를 별도 모듈로

---

## 배경

기존 EmailPort 와 ResendEmailAdapter / LoggingEmailAdapter / ResendProperties 가 모두 `core-auth` 안에 있었음:

```
core-auth-api/.../EmailPort.java                       ← interface
core-auth-impl/.../email/ResendEmailAdapter.java       ← Resend
core-auth-impl/.../email/LoggingEmailAdapter.java      ← dev fallback
core-auth-impl/.../email/ResendProperties.java         ← config
```

다른 도메인 (예: billing 의 결제 실패 알림) 이 이메일 보내려면:
- `core-billing-impl` 이 `core-auth-api` 의존 (EmailPort 사용)
- 또는 `core-billing-impl` 이 `core-auth-impl` 의존 → ❌ ArchUnit r3 위반 (`core-*-impl` 끼리 import 금지)

이메일은 **도메인 횡단 기능** (auth / billing / 운영 공지 등 어디서나 사용). auth 안에 있을 이유 없음.

---

## 결정

**`core-email-api` + `core-email-impl` 별도 모듈 추출**:

```
core-email-api/
  └─ com.factory.core.email.api/
      ├─ EmailPort.java              ← interface (auth 에서 이동)
      └─ exception/
          ├─ EmailError.java         ← 신규 (EMAIL_DELIVERY_FAILED 등)
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

## EmailException 도메인화

이전에는 ResendEmailAdapter 가 `AuthException(AuthError.EMAIL_DELIVERY_FAILED, cause)` 를 throw. 이제는:

```java
throw new EmailException(EmailError.EMAIL_DELIVERY_FAILED, cause);
```

각 호출 도메인 (auth / billing) 이 필요 시 자기 도메인 exception 으로 wrap. 또는 그대로 propagate (BaseException 자식이라 ApiResponseAdvice 가 캐치).

`AuthError.EMAIL_DELIVERY_FAILED` 는 unused 상태로 남음 (BC 위해 enum 값 유지). 다음 cleanup 사이클에 제거 가능.

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

## 환경변수 / 설정 호환성

`app.email.resend.*` properties 그대로 유지 — `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, `RESEND_FROM_NAME` 등 .env 변수 변경 X. ResendProperties 의 패키지만 이동. ConfigurationPropertiesScan 이 자동 발견.

운영 배포 시 추가 작업 X — 모듈 리팩터링이라 jar 안의 클래스 위치만 바뀌고 외부 인터페이스 (REST endpoint, env, 비즈동작) 동일.

---

## ArchUnit 룰

기존 `r3 CORE_IMPL_MUST_NOT_DEPEND_ON_EACH_OTHER` 가 패턴 기반 (`core-*-impl` → `core-*-impl` 금지) 이라 자동 적용. 새 도메인 룰 추가 X.

`core-email-api` 는 모든 `core-*-impl` / `apps/*` 가 의존 가능. `core-email-impl` 은 `bootstrap` 만 직접 의존 (`core-*-impl` 끼리 의존 금지).

---

## 안 다루는 범위 (다음 사이클)

- **SubscriptionNotificationListener 의 email 발송** — push + email 둘 다 발송하려면 UserPort 통한 email 조회 + 메시지 템플릿 분리. 별도 사이클.
- **Email contract test** — `core-email-api/testFixtures` 로 `EmailRecorder` 이동 + `InMemoryEmailAdapter` 추출. 현재는 `core-auth-api/testFixtures` 에 남음.
- **AuthError.EMAIL_DELIVERY_FAILED 제거** — unused 상태. 다음 cleanup.
- **추가 발송 채널** — SMTP / Gmail API / SES / SendGrid 어댑터. 필요 시 `core-email-impl` 에 추가만.

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
