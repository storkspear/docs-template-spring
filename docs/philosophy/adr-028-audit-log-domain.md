# ADR-028 — Audit log 도메인 + AOP 자동 기록

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~7분

**Status**: Accepted. `core-audit-api` + `core-audit-impl` 별도 도메인으로 분리돼 있어요. `@Audited` meta annotation + Spring AOP `@Around` 가 `audit_logs` 테이블에 자동 기록하고, `Propagation.REQUIRES_NEW` 로 비즈 트랜잭션과 격리됩니다.

---

## 결론부터

운영자가 *환불 처리, 사용자 role 변경, 강제 데이터 삭제* 같은 *시스템 상태를 직접 조작* 하는 액션을 수행할 때, *누가 언제 무엇을 했는지* 가 영속 기록으로 남아야 해요. 운영 디버깅 (*어제 18시에 user 100 의 plan 이 왜 바뀌었지?*), 컴플라이언스 (*PCI-DSS / ISO 27001 의 admin 액션 audit 의무*), 보안 사고 forensic (*침해 시 어떤 액션이 이뤄졌는지*) — 어느 면에서 봐도 이 추적성은 운영의 필수 요소입니다.

본 ADR 은 audit log 를 *별도 도메인 (`core-audit-api` + `core-audit-impl`)* 으로 두고, *Spring AOP 로 자동 기록* 하는 구조를 정의합니다. 핵심 메커니즘은 `@Audited` meta annotation 이에요. 운영자 endpoint 메서드에 `@Audited("billing.refund")` 한 줄을 붙이면, `AuditAspect` 가 `@Around` 로 그 메서드를 가로채서 *호출 직후 actor / action / timestamp / 결과* 를 `audit_logs` 테이블에 자동 기록합니다. 컨트롤러 코드 안에 *audit 호출 boilerplate* 가 들어가지 않아 *비즈 로직과 audit 책임이 깔끔히 분리* 돼요.

audit 기록은 `Propagation.REQUIRES_NEW` 로 *별도 트랜잭션* 에서 일어납니다. 이 격리가 중요한 이유는 두 가지예요. 첫째, 비즈 로직이 *실패해서 rollback* 되어도 *audit 기록은 보존* 됩니다 — *환불 시도 자체가 실패한 사실* 도 기록으로 남아야 forensic 이 의미가 있어요. 둘째, audit 기록 자체가 *실패해도 비즈 로직을 막지 않습니다* — `AuditAspect` 가 throw 를 catch 하고 log 만 남기는 형태라, *audit DB 가 일시 장애* 라도 운영 액션이 차단되지 않아요.

이 ADR 의 범위는 모듈 분리의 사유, `audit_logs` 테이블 설계 (슬러그별 schema 위치 + 컬럼 정의), `@Audited` 어노테이션의 의미와 `@AdminOnly` 와의 관계, AuditAspect 의 트랜잭션 / 실패 격리 정책, 그리고 AuditPort 추상화로 *향후 외부 SaaS / S3 구현 교체* 가능성까지입니다.

---

## 왜 이런 결정이 필요했나?

[`ADR-027`](./adr-027-admin-role-authorization.md) 이 *@AdminOnly* 로 권한 검증을 정립했지만, 권한 검증은 *액션의 차단* 만 보장할 뿐 *액션의 추적* 은 별개의 영역이에요. *권한이 있는 운영자가 정당하게 환불을 처리한* 경우와 *권한이 있는 운영자가 부적절하게 환불을 처리한* 경우는 모두 권한 검증을 통과하지만, 후자를 사후에 감지할 수단이 없으면 *내부자 위협* 에 대한 방어선이 비어 있는 상태가 됩니다.

audit 추적이 없을 때 운영에서 마주치는 시나리오를 보면 그 부담이 명확해요. *환불 처리* 가 이뤄진 사실 자체는 `payment_records.refunded_at IS NOT NULL` 같은 SQL 쿼리로 알 수 있지만, *누가 그 환불을 처리했는지* 는 DB 에 남아 있지 않습니다. CS 문의로 *제 환불을 누가 처리했는지 알려주세요* 같은 질문이 들어와도 *application log 의 분 단위 timestamp* 를 매칭해서 추정할 수 있을 뿐 정확한 actor 를 확정할 수단이 없어요.

운영 디버깅도 같은 부담을 가져옵니다. *user 100 의 plan 이 어느 시점에 왜 변경됐는지* 같은 질문이 들어왔을 때, 데이터의 *현재 상태* 만 보고는 그 변화의 *원인 액션* 을 추적할 수 없어요. logback 의 application log 가 *부분적으로* 정보를 가지지만, *로그 회전 (rotation)* 으로 며칠 전 로그가 사라지거나 *로그 검색이 grep 기반* 이라 정확한 actor 와 입력값을 매칭하기 어렵습니다.

컴플라이언스 측면도 무시할 수 없어요. 결제 처리 시스템은 *PCI-DSS* 의 audit 의무를 따라야 하고, 사용자 데이터를 다루는 시스템은 *ISO 27001* 의 admin 액션 추적을 권장받아요. 이런 표준은 *어떤 액션이 언제 누구에 의해 이뤄졌는지* 를 *영속적으로 검색 가능* 한 형태로 보존할 것을 요구합니다. application log 만으로는 이 요구를 만족시키기 어려워요.

해결책의 핵심은 *audit 기록을 비즈 로직에서 분리* 하는 것이에요. 컨트롤러 메서드 안에 *audit 호출 코드를 직접 작성* 하는 형태는 *boilerplate 가 누적* 되고 *한 곳에서 잊으면 그 액션은 영원히 추적 불가* 해집니다. AOP 로 가로채는 형태는 *어노테이션 한 줄로 모든 메서드에 균등 적용* 되고, *audit 책임이 단일 위치 (AuditAspect)* 에 모여 유지보수도 쉬워요.

또 하나의 결정 축은 *audit 기록의 트랜잭션 분리* 예요. 비즈 트랜잭션과 같은 트랜잭션에서 audit 를 기록하면 *비즈 로직 rollback 시 audit 도 같이 사라져* 가장 중요한 사고 (실패 시도) 를 놓치게 됩니다. *별도 트랜잭션* 으로 분리하면 *모든 액션 시도가 결과와 무관하게 보존* 되어 forensic 의 정직성이 유지돼요.

이 결정이 답해야 할 물음은 이거예요.

> **운영 액션의 추적성을 *boilerplate 0* 으로 어떻게 자동화하고, 비즈 로직 / audit 의 트랜잭션 격리는 어떤 형태로 잡아야 사고와 컴플라이언스 요구를 동시에 만족시킬 수 있는가?**

---

## 결정

| 항목 | 값 |
|---|---|
| **모듈** | `core-audit-api` + `core-audit-impl` 별도 도메인 (ADR-019/024 정합) |
| **테이블** | `audit_logs` — 슬러그별 schema (admin 도 슬러그별 사용자라 같은 schema 보존) |
| **자동 기록** | Spring AOP `@Around` — `@Audited` / `@AdminOnly` 메소드 가로채기 |
| **트랜잭션** | `record` 가 `Propagation.REQUIRES_NEW` — 비즈로직 rollback 영향 X |
| **실패 격리** | `record` throw 시 log only — 비즈로직에 영향 X |
| **활성화** | `app.audit.enabled=true` (default true) — 디버깅 시 비활성화 가능 |

---

## 도메인 분리 사유

이메일 (ADR-024) 과 동일한 정신:

```
core-billing-impl → @AdminOnly refund() → AuditAspect 가 가로채기 → AuditPort.record
core-auth-impl    → @Audited("user.role.change") → 동일
apps/app-*        → @Audited 메소드 → 동일
```

audit 은 **모든 도메인이 호출하는 횡단 기능**. core-security 안에 묻으면 다른 도메인이 import 어려움 (ArchUnit r3 위반). 별도 모듈이 정도.

---

## 자동 기록 흐름

```
[HTTP POST /api/apps/<slug>/payment/refund]
  ↓ JwtAuthFilter → SecurityContext.Authentication
  ↓ AppSlugVerificationFilter → SlugContext.set(slug)
  ↓ controller 진입: @AdminOnly @Audited("billing.refund", resourceType="PaymentRecord")
  ↓ AuditAspect Around 가로채기:
    - resolveActor() — SecurityContext 의 AuthenticatedUser → userId, email
    - resolveAction() — Audited.value() 명시 또는 ClassName.methodName
    - resolveIpAddress() — X-Forwarded-For 또는 RemoteAddr
    - SlugContext.get() → slug
  ↓ proceed() — 실 비즈로직 실행
    ┌── 성공 → AuditEvent(SUCCESS) → AuditPort.record
    └── 실패 → AuditEvent(FAILURE, exception details) → record + re-throw
  ↓ AuditPort.record (REQUIRES_NEW TX)
    → AuditLog INSERT
    → 외부 transaction (refund) 의 rollback 과 무관하게 commit
```

---

## REQUIRES_NEW 트랜잭션 사유

```java
@Transactional(propagation = Propagation.REQUIRES_NEW)
public void record(AuditEvent event) {
    repository.save(new AuditLog(event));
}
```

호출 측 비즈로직의 transaction 과 분리:

- 비즈니스 fail → outer rollback → audit 만 commit (어떤 액션이 시도됐는지 보존)
- 비즈니스 success → outer commit → audit 도 commit (정상 기록)

만약 같은 transaction 이면 비즈니스 rollback 시 audit 도 사라짐 → forensic 불가능.

---

## SUCCESS / FAILURE 분기

`@Audited` 메소드가 throw 하면:
- audit 에 result=FAILURE + details (exception 클래스명 + 메시지 truncate 500자)
- 예외는 그대로 re-throw — 정상 흐름 유지

→ 컴플라이언스 audit 시 "권한 거부된 admin 시도" 추적 가능 (예: 비밀번호 정책 fail / role 부족 / validation error).

---

## @Audited annotation 사용 패턴

| 경우 | annotation |
|---|---|
| Admin 액션 (자동 audit, action 자동) | `@AdminOnly` 만 |
| Admin 액션 (action 명시) | `@AdminOnly @Audited(value="billing.refund", resourceType="PaymentRecord")` |
| 사용자 자기 액션 (감사 대상) | `@Audited(value="user.withdraw", resourceType="User")` |
| 일반 GET / 검색 | annotation 없음 (audit 비대상) |

---

## 검증 (단위 테스트 7건)

`AuditAspectTest`:

1. `auditedMethod_recordsSuccessEvent_withExplicitActionAndResource`
2. `auditedWithoutValue_usesClassMethodName` — default action 명명
3. `adminOnlyMethod_alsoAudited_evenWithoutAuditedAnnotation` — `@AdminOnly` 자동 감사
4. `throwingMethod_recordsFailure_andRethrows` — 예외 처리
5. `recordFailure_doesNotPropagate_logOnly` — 실패 격리
6. `noAuthentication_actorIsNull` — 익명 액션 (시스템 등)
7. `noSlugContext_slugIsNull` — slug 없는 호출

`AspectJProxyFactory` 로 target 객체에 aspect wrap → fake `AuditPort` 가 호출 캡처. ADR-014 (delegation mock 금지, fake adapter).

---

## audit_logs schema 설계

```sql
CREATE TABLE audit_logs (
    id              BIGSERIAL PRIMARY KEY,
    actor_user_id   BIGINT,                -- 시스템 액션 시 NULL
    actor_email     VARCHAR(255),          -- soft-delete 후에도 보존
    action          VARCHAR(100) NOT NULL, -- "billing.refund" / "user.role.change"
    resource_type   VARCHAR(50),           -- "PaymentRecord" / "User"
    resource_id     BIGINT,
    slug            VARCHAR(50),           -- SlugContext (cross-slug 분석 시)
    result          VARCHAR(20) NOT NULL,  -- SUCCESS / FAILURE
    details         JSONB,                 -- 자유형 (exception / 변경 전후)
    ip_address      VARCHAR(45),           -- IPv4/IPv6
    occurred_at     TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_audit_logs_actor_user_id ON audit_logs(actor_user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_occurred_at ON audit_logs(occurred_at DESC);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id)
    WHERE resource_id IS NOT NULL;
```

**details JSONB**: schema-less. 각 액션별로 자유롭게 저장 — 운영자가 `WHERE details->>'amount' > '10000'` 같이 분석.

---

## 대안 비교

### 옵션 A — application log (logback) 에 기록

- `log.info("admin action — actor={} action={}")` 직접 호출
- ❌ 검색 어려움 (Loki / Elastic 셋업 필요), 회전 시 손실
- ❌ actor 캡처 boilerplate 매번 반복
- ❌ FAILURE 케이스 추적 어려움 (try-catch 필요)

### 옵션 B — Spring Events + listener

- 컨트롤러가 `eventPublisher.publishEvent(new AdminActionEvent(...))` 발행
- ❌ 매 메소드마다 publishEvent 호출 boilerplate
- ❌ throw 시 listener 호출 안 됨 → FAILURE 추적 불가
- ❌ event class 별 정의 필요

### 옵션 C — AOP `@Audited` annotation ★ 채택

- annotation 1개 + AuditAspect 가 자동 처리
- SUCCESS / FAILURE 모두 캡처
- 트랜잭션 분리로 forensic 보존
- ✅ 한 번 셋업하면 대부분 메소드에 annotation 추가만으로 audit

---

## 관련 파일 (신규)

- `tools/new-app/new-app.sh` — V012__init_audit_logs.sql heredoc
- `core/core-audit-api/build.gradle`
- `core/core-audit-api/.../AuditPort.java`, `AuditEvent.java`, `AuditResult.java`
- `core/core-audit-impl/build.gradle`
- `core/core-audit-impl/.../entity/AuditLog.java`
- `core/core-audit-impl/.../repository/AuditLogRepository.java`
- `core/core-audit-impl/.../AuditServiceImpl.java`
- `core/core-audit-impl/.../AuditAspect.java`
- `core/core-audit-impl/.../AuditAutoConfiguration.java`
- `core/core-audit-impl/src/main/resources/META-INF/spring/...AutoConfiguration.imports`
- `common/common-security/.../Audited.java`
- `core/core-audit-impl/src/test/.../AuditAspectTest.java`

수정:
- `settings.gradle` — 새 모듈 등록
- `bootstrap/build.gradle` — core-audit-impl + spring-boot-starter-aop 의존
- 기존 server-factory 슬러그 (testsvc/helloworld/rny) — V012 retro 적용

---

## 안 다루는 범위

- **Audit endpoint 노출** — `GET /api/admin/audit-logs?action=billing.&since=...` 같은 운영자 조회 endpoint. 비즈니스별 admin UI 결정 후 추가해요.
- **세부 변경 추적** — JPA `@PreUpdate` 로 entity 변경 전후를 캡처해요 (예: User.role 변경 시 old/new 값). `details` JSONB 활용은 가능하지만 별도 사이클로 다뤄요.
- **Audit log 보존 정책** — 영구 보관 vs 90일 후 archive. PCI-DSS 는 1년을 권장해요. 별도 cron 으로 archive table 로 이동시켜요.
- **암호화** — actor_email / details 의 민감 정보 암호화. 필요 시 별도 사이클로 다뤄요.
- **외부 SIEM 통합** — Splunk / Datadog 으로 로그를 stream 해요. 운영 규모가 커지면 추가합니다.
