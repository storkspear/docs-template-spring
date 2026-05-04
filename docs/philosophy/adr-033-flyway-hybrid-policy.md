# ADR-033 — Flyway Hybrid 마이그레이션 정책 (dev=auto, prod=validate-only)

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~7분

**상태**: 채택 (2026-05-02)
**전제**: ADR-018 (멀티 슬러그 schema 격리), 기존 `AbstractAppDataSourceConfig.buildFlyway()`
**연관**: P 사이클 — 운영 안전성 baseline

---

## 결론부터

Flyway 마이그레이션 정책을 *환경별 분리* — dev = `auto` (자동 적용), prod = `validate-only` (적용 X / checksum 검증만). 운영자가 *명시적으로* SQL 적용 (`tools/migrate-prod.sh` Phase 2-3 예정 / 현재는 SSH + psql 수동).

이유: 운영 환경에서 *자동 마이그레이션* 은 *예측 못한 schema 변경* 위험. *validate-only* 로 *부팅 전 일관성만 검증* 하고, 적용은 사람이 *시점 결정*.

---

## 배경

현재 (ADR-033 이전) — 모든 환경 (dev / test / prod) 에서 부팅 시 Flyway 가 자동 `migrate()`. `AbstractAppDataSourceConfig.buildFlyway()` 가 `Flyway.configure().load()` 만 반환하고 concrete subclass 가 `@Bean(initMethod = "migrate")` 로 매 부팅에 실행.

이 흐름의 위험을 사용자가 명시 (PHP/Laravel 과거 경험):
- prod 부팅 시 새 V스크립트 자동 적용 → 부팅 실패 시 트래픽 받을 인스턴스 없음
- 부분 적용 (V14 까진 성공 / V15 fail) → schema 가 inconsistent state
- advisory lock 손상 (드물지만) → 모든 인스턴스 부팅 wait
- prod schema 변경이 코드 deploy 의 부산물로 발생 → DBA 가 변경 사실 모름

대안 검토 시점이 됨. **옵션 비교**:

### 옵션 A — 그대로 자동 migrate (현재)
| 장점 | 단점 |
|---|---|
| 단순 — 별도 운영 절차 X | prod 부팅 시 schema 변경 발생 가능성 |
| advisory lock 으로 동시성 안전 | 부분 적용 시 복구 절차 복잡 |
| Flyway baseline-on-migrate 가 신규 schema 자동 처리 | DBA / 운영자가 변경 사실 모를 수 있음 |

### 옵션 B — Hybrid (dev/test = auto, prod = validate-only)
| 장점 | 단점 |
|---|---|
| prod 부팅 시 schema 변경 X — 안전 | 운영자가 deploy 전 prod DB 에 직접 SQL 적용 필요 |
| DBA / 운영자가 schema 변경을 명시적으로 통제 | 자동화 도구 (`tools/migrate-prod.sh`) 필요 |
| 부분 적용 위험 0 — 부팅 시 검증만 | dev 에선 그대로 자동이라 코드 동작 일관 |
| Flyway `validate` 만 호출 → checksum 정합 보장 | |

### 옵션 C — ORM `hbm2ddl.auto`
| 장점 | 단점 |
|---|---|
| 별도 마이그레이션 도구 X | **운영 절대 금지** — 자동 schema 추론이 데이터 손실 유발 |
| dev 빠른 iteration | `@Column(nullable=false)` 추가 시 NOT NULL 강제 → 기존 NULL 행 깨짐 |
| | Hibernate 가 schema diff 추론 — 의도치 않은 DROP COLUMN 가능 |

옵션 C 는 **고려 외**. 옵션 A 는 현재 상태이고 위험 인지됨. **옵션 B 채택** — Java 의 type safety 와 일관된 "운영은 명시적으로" 원칙.

---

## 결정

| 항목 | 값 |
|---|---|
| **dev / test profile** | Flyway `migrate()` (자동) — 현재 동작 유지 |
| **prod profile** | Flyway `validate()` 만 — schema_history 의 checksum 정합 검증, 변경 X |
| **prod 적용 흐름** | 운영자가 deploy 전 SSH + psql 로 직접 적용 → `tools/migrate-prod.sh` 자동화 |
| **schema_history 등록** | `tools/migrate-prod.sh` 가 SQL 실행 후 자동 `INSERT` |
| **부팅 실패 정책** | prod validate fail = Spring 부팅 fail → kamal blue/green 이 cutover 안 함 (트래픽 보호) |
| **switch 메커니즘** | properties `app.flyway.mode = auto | validate-only | disabled` (기본 dev=auto, prod=validate-only) |
| **Override** | 운영자가 긴급 시 prod 에서도 `auto` 모드 임시 사용 가능 (위험 인지하에) |

---

## 핵심 코드 변경

### 1. `AbstractAppDataSourceConfig` 갱신

```java
public enum FlywayMode {
    AUTO,           // configure + migrate (dev/test)
    VALIDATE_ONLY,  // configure + validate (prod default)
    DISABLED        // bean 등록 X (긴급 우회)
}

protected Flyway buildFlyway(DataSource ds, FlywayMode mode) {
    if (mode == FlywayMode.DISABLED) {
        return null;  // concrete subclass 가 @Bean null check
    }
    return Flyway.configure()
            .dataSource(ds)
            .schemas(slug)
            .locations("classpath:db/migration/" + slug)
            .baselineOnMigrate(mode == FlywayMode.AUTO)  // validate-only 는 baseline X
            .load();
}
```

### 2. concrete subclass — initMethod 분기

```java
@Bean(initMethod = "migrate")
@ConditionalOnProperty(name = "app.flyway.mode", havingValue = "auto", matchIfMissing = false)
public Flyway gymlogFlywayAuto(DataSource ds) {
    return buildFlyway(ds, FlywayMode.AUTO);
}

@Bean(initMethod = "validate")
@ConditionalOnProperty(name = "app.flyway.mode", havingValue = "validate-only", matchIfMissing = true)
public Flyway gymlogFlywayValidate(DataSource ds) {
    return buildFlyway(ds, FlywayMode.VALIDATE_ONLY);
}
```

### 3. profile 별 default

```yaml
# application-dev.yml
app:
  flyway:
    mode: auto

# application-test.yml
app:
  flyway:
    mode: auto

# application-prod.yml
app:
  flyway:
    mode: validate-only
```

---

## 운영 흐름 (prod deploy)

```
운영자 검토
   │
   ▼
1) apps/app-<slug>/db/migration/<slug>/V<N>__*.sql 변경 검토 (PR review)
   │
   ▼
2) tools/migrate-prod.sh <slug> V<N>  실행
   │   ├── SSH prod-host → psql $DB_URL -f V<N>__*.sql
   │   ├── 성공 시 INSERT INTO <slug>.flyway_schema_history 자동
   │   └── 실패 시 ROLLBACK + 에러 보고
   │
   ▼
3) git tag deploy/v<sha> 후 GHA deploy.yml trigger
   │
   ▼
4) Spring Boot 부팅 (prod profile)
   │   └── Flyway.validate() — schema_history 의 모든 V스크립트 정합 확인
   │       ├── 정합 → bean 등록 → 트래픽 받기
   │       └── 불일치 → SpringBootException → kamal blue/green 이 cutover 안 함
   │
   ▼
5) blue/green health check OK → 새 인스턴스 활성, 기존 종료
```

---

## advisory lock 의 역할

Flyway 의 advisory lock 은 **migrate() 호출 시점의 동시성 방어** — 여러 인스턴스가 동시에 부팅해도 한 인스턴스만 V스크립트 적용. validate-only 모드에선 lock 미사용 (read-only).

prod 에서 validate-only 로 바뀌어도 **로컬 dev / test 의 lock 보장은 그대로 유지** — 본 ADR 는 prod 의 자동 migrate 만 제거.

---

## 부분 적용 / 락 손상 시 복구

### A. dev / test 환경
자동 migrate 그대로 — `flyway-runbook.md` §3 의 복구 절차 적용 (advisory lock 강제 해제, 실패 entry 제거 후 정정 V스크립트).

### B. prod 환경
- validate-only 라 부분 적용 발생 X (Flyway 가 SQL 실행 안 함)
- 운영자가 `tools/migrate-prod.sh` 실행 중 부분 실패 → 스크립트가 자동 transaction 으로 wrap
- transaction 실패 시 rollback + schema_history INSERT 도 안 함 → 다음 deploy 의 validate 실패로 detect

---

## Alternatives 재검토

| 대안 | 검토 결과 |
|---|---|
| Liquibase changelog | XML / YAML 기반 — Flyway 의 SQL 직접성 + Spring Boot 1차 통합 (auto-config) 손실. 채택 X. |
| Spring Boot Flyway baseline | `spring.flyway.baseline-on-migrate=false` 강제 — V001 수동 등록 부담. 채택 X. |
| pgschema-managed via DBA | 별도 DBA 절차 — 솔로 / 소규모 팀에 과도. 본 template 의 운영자 = 개발자 가정과 어긋남. 채택 X. |
| Atlas / pgroll | 검토 가치 있으나 본 사이클에선 over-engineering. 별도 ADR 필요 시 다음 사이클. |

---

## 운영 영향

- ✅ prod 부팅 시 schema 변경 0 — 부팅 실패는 코드 / 설정 / DB 연결 문제로 한정
- ✅ DBA / 운영자가 schema 변경 시점을 명시적으로 통제
- ⚠️ deploy 전 `tools/migrate-prod.sh` 실행 step 추가 — 운영자 1단계 추가
- ⚠️ schema_history INSERT 누락 시 다음 deploy 의 validate 실패 → 명확한 에러로 detect
- ✅ 자동화 도구가 INSERT 도 함께 → 누락 위험 최소

---

## 후속 작업

- `tools/migrate-prod.sh` 신규 (Phase 2-3)
- `flyway-runbook.md` 본문 갱신 (Phase 2-4)
- `bootstrap` profile 분기 적용 (Phase 2-2)
- 파생 앱의 `<Slug>DataSourceConfig` 도 동일 패턴 — `new-app.sh` heredoc 갱신 (Phase 2-2 후속)
- 관측: prod 부팅 로그에 `Flyway validate OK (N migrations)` 명시. 실패 시 alert.

---

## 관련 문서

- [`Flyway Runbook`](../production/deploy/flyway-runbook.md) — 운영 절차 상세
- [`ADR-018 · SchemaRoutingDataSource`](./adr-018-schema-routing-datasource.md) — 슬러그 schema 격리
- `tools/migrate-prod.sh` (예정) — 자동화 도구
