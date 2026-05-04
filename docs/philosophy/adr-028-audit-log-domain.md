# ADR-028 — Audit log 도메인 + AOP 자동 기록

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~7분

**상태**: 채택 (2026-05-02)
**전제**: ADR-018 (멀티 슬러그 schema), ADR-019 (도메인 횡단 분리), ADR-027 (admin 권한)
**연관**: T 사이클 — 운영 컴플라이언스 / 디버깅 / admin 액션 추적

---

## 결론부터

운영 액션 (admin refund / role 변경 / force-clear 등) 을 *AOP 자동 기록* 으로 audit log 에 영속. `@Audited` meta annotation + AuditAspect 로 *boilerplate 0* 기록 + *비즈 로직과 격리*.

audit 기록은 `@Transactional(REQUIRES_NEW)` 로 *별도 트랜잭션* — 비즈 트랜잭션 rollback 시에도 audit 만 보존. AuditPort interface 로 *DB / external SaaS / S3* 구현 교체 가능.

---

## 배경

ADR-027 의 `@AdminOnly` 로 admin 권한 체크는 정립. 하지만:

- "**누가 언제 무엇을 환불했나**?" 추적 X — DB 직접 조회 (`SELECT * FROM payment_records WHERE refunded_at IS NOT NULL`) 만 가능, 누가 처리했는지 모름
- 컴플라이언스 (PCI-DSS, ISO 27001) — admin 액션 audit log 의무
- 운영 디버깅 — "어제 18:00 에 user 100 의 plan 이 왜 변경됐지?" 추적
- 보안 사고 — 침해 시 어떤 액션이 이뤄졌는지 forensic

기존 application log (logback) 만으로 부족 — 로그 회전 / 검색 어려움 / 정확한 actor 캡처 X.

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

- **Audit endpoint 노출** — `GET /api/admin/audit-logs?action=billing.&since=...` 같은 운영자 조회 endpoint. 비즈니스별 admin UI 결정 후 추가.
- **세부 변경 추적** — JPA `@PreUpdate` 로 entity 변경 전후 캡처 (예: User.role 변경 시 old/new 값). `details` JSONB 활용 가능하나 별도 사이클.
- **Audit log 보존 정책** — 영구 보관 vs 90일 후 archive. PCI-DSS 는 1년 권장. 별도 cron 으로 archive table 이동.
- **암호화** — actor_email / details 의 민감 정보 암호화. 필요 시 별도 사이클.
- **외부 SIEM 통합** — Splunk / Datadog 으로 로그 stream. 운영 규모 커지면 추가.
