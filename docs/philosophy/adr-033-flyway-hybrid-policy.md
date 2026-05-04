# ADR-033 — Flyway Hybrid 마이그레이션 정책 (dev=auto, prod=validate-only)

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~7분

**Status**: Accepted. dev / test = `Flyway.migrate()` 자동 적용. prod = `Flyway.validate()` 만 호출 (checksum 검증). prod 적용은 운영자가 `tools/migrate-prod.sh` 또는 SSH + psql 로 명시적 수행.

---

## 결론부터

DB 마이그레이션은 *데이터의 영구 변경* 을 다루는 영역이라 *언제 적용할지* 의 결정이 *코드 deploy 와 분리* 되어야 안전해요. 코드 deploy 시점에 자동으로 새 V스크립트가 적용되는 형태는 *부팅 실패가 곧 트래픽 단절* 로 이어지는 위험을 만들고, *부분 적용 (V14 까지 성공 / V15 실패)* 같은 사고는 *schema 가 inconsistent state 로 남는* 가장 까다로운 운영 부담이 됩니다.

본 ADR 은 환경별로 Flyway 동작을 분리하는 *Hybrid Policy* 를 정의합니다. dev / test 환경에서는 *기존처럼 자동 migrate* — 개발 효율을 유지하기 위해 코드 변경과 함께 schema 도 자동으로 적용돼요. 반면 prod 환경에서는 *`validate-only` 모드* 로 동작합니다 — 부팅 시 *schema_history 의 checksum 정합만 검증* 하고 *실제 V스크립트는 적용하지 않아요*. 운영자가 *deploy 전에 prod DB 에 직접 SQL 적용* 하는 명시적 단계를 거쳐야 새 schema 가 prod 에 반영됩니다.

이 정책의 핵심 가치는 *deploy 와 schema 변경의 분리* 예요. 코드 deploy 는 *언제든 안전하게 rollback 가능* 한 영역이지만, schema 변경은 *원칙적으로 forward-only* 라 한 번 적용되면 되돌리기 어려운 영역입니다. 이 두 가지를 *같은 시점에 자동으로 묶어버리면* schema 변경의 무게가 코드 deploy 의 가벼움과 충돌해요. 분리하면 운영자가 *schema 변경의 시점을 별도로 결정* 할 수 있고, *DBA 가 변경 사실을 사전에 인지* 하는 워크플로우도 자연스럽게 따라옵니다.

운영자의 적용 도구는 *Phase 2~3 의 `tools/migrate-prod.sh`* 자동화로 단계적 정착 예정이고, 현재는 *SSH + psql 수동 적용 + schema_history INSERT* 흐름으로 처리합니다. 적용 절차는 [`Flyway Runbook`](../production/deploy/flyway-runbook.md) 에 별도 정리되어 있어요.

이 ADR 의 범위는 환경별 분리 정책의 결정 근거, dev / test 자동 migrate 가 유지되는 이유, prod validate-only 가 잡는 위험, advisory lock 의 역할, 부분 적용 / 락 손상 시 복구 흐름, 그리고 *Liquibase / pgschema / Atlas* 같은 대안 도구와의 트레이드오프 비교까지입니다.

---

## 왜 이런 결정이 필요했나?

기본 Flyway 설정 — *모든 환경에서 부팅 시 자동 migrate* — 은 개발 단계에서는 가장 단순하고 자연스러운 형태예요. 코드와 schema 가 *한 commit 에 함께 묶여 deploy* 되어 *환경 동기화* 가 자동으로 이뤄지고, 별도 운영 절차도 필요 없습니다. 작은 팀 / 단일 환경에서는 이 단순함의 가치가 압도적이에요.

문제는 *prod 환경의 위험 모델* 이 dev / test 와 본질적으로 다르다는 점이에요. prod 에서 *부팅 시 schema 변경* 이 일어난다는 것은 다음 네 가지 위험을 동시에 가져옵니다.

**첫째, 부팅 실패가 트래픽 단절로 이어집니다.** V15 마이그레이션이 *예상치 못한 데이터 (예: 중복 row)* 때문에 적용 실패하면 *Spring Boot 부팅 자체가 실패* 하고, *블루/그린 배포* 환경에서는 *새 인스턴스가 health check 를 통과하지 못해 트래픽이 라우팅되지 않는* 상태가 됩니다. 기존 인스턴스가 *이미 종료된 시점* 이라면 *전체 서비스 다운* 으로 이어질 수 있어요.

**둘째, 부분 적용이 schema 를 inconsistent state 로 남깁니다.** V14 까지 성공하고 V15 가 실패한 시점에 *V14 의 변경은 이미 commit* 되어 있으므로, 단순 rollback 으로는 복구할 수 없어요. *V15 의 부분적 변경* 이 어떤 상태로 남아 있는지 분석 → *수동 정정* 의 까다로운 복구 절차가 필요합니다. 운영 압박 상황에서 이런 분석을 정확히 하기는 어려워요.

**셋째, advisory lock 손상 시 모든 인스턴스가 부팅 대기에 빠집니다.** Flyway 는 *동시성 보장을 위한 advisory lock* 을 사용하는데, 이 lock 이 *드물지만 손상* 되면 *모든 인스턴스의 부팅이 무한 대기* 하는 상태가 돼요. 수동 unlock SQL (`SELECT pg_advisory_unlock_all()`) 이 필요한 까다로운 복구 영역입니다.

**넷째, schema 변경이 코드 deploy 의 부산물로 발생해서 DBA / 운영자가 변경 사실을 모를 수 있습니다.** 운영 환경에서 *어느 시점에 어떤 schema 변경이 있었는지* 가 *코드 commit log 안에 묻혀* 있으면, 별도 추적 도구 없이는 *변경 history 를 파악* 하기 어려워요. 이는 *PCI-DSS 같은 audit 요구* 와도 충돌합니다.

이 네 가지 위험은 *prod 단계의 운영 환경* 에서만 의미가 있어요. dev / test 환경에서는 *부팅 실패가 트래픽 단절로 이어지지 않고*, *schema 가 inconsistent state 로 남아도 reset / recreate* 가 자유로워서 위험 자체가 거의 없습니다. 따라서 *dev / test 의 자동 migrate 편의* 와 *prod 의 명시적 통제* 를 동시에 잡는 *환경별 분리 정책* 이 정합한 답이에요.

대안으로 *Liquibase changelog*, *Atlas / pgroll* 같은 다른 도구들도 검토 가치가 있어요. Liquibase 는 XML/YAML 기반이라 *Flyway 의 SQL 직접성* 과 *Spring Boot 1차 통합* 을 잃습니다. Atlas / pgroll 같은 *gradual migration* 도구는 *zero-downtime schema 변경* 을 지원하지만 *현재 단계에는 over-engineering* 이고 *별도 ADR 로 다룰 주제* 예요.

이 결정이 답해야 할 물음은 이거예요.

> **dev / test 의 자동 migrate 편의를 유지하면서 prod 의 부팅 실패 / 부분 적용 / advisory lock 손상 / 변경 추적성 부재 위험을 동시에 차단하는 마이그레이션 정책은 무엇인가?**

### 옵션 A — 그대로 자동 migrate (현재)
| 장점 | 단점 |
|---|---|
| 단순 — 별도 운영 절차 X | prod 부팅 시 schema 변경 발생 가능성 |
| advisory lock 으로 동시성 안전 | 부분 적용 시 복구 절차 복잡 |
| Flyway baseline-on-migrate 가 신규 schema 자동 처리 | DBA / 운영자가 변경 사실을 모를 수 있음 |

### 옵션 B — Hybrid (dev/test = auto, prod = validate-only)
| 장점 | 단점 |
|---|---|
| prod 부팅 시 schema 변경 X — 안전 | 운영자가 deploy 전 prod DB 에 직접 SQL 적용 필요 |
| DBA / 운영자가 schema 변경을 명시적으로 통제 | 자동화 도구 (`tools/migrate-prod.sh`) 필요 |
| 부분 적용 위험 0 — 부팅 시 검증만 | dev 에선 그대로 자동이라 코드 동작이 일관됨 |
| Flyway `validate` 만 호출 → checksum 정합 보장 | |

### 옵션 C — ORM `hbm2ddl.auto`
| 장점 | 단점 |
|---|---|
| 별도 마이그레이션 도구 X | **운영에서 절대 금지** — 자동 schema 추론이 데이터 손실을 유발 |
| dev 빠른 iteration | `@Column(nullable=false)` 추가 시 NOT NULL 강제 → 기존 NULL 행이 깨짐 |
| | Hibernate 가 schema diff 추론 — 의도치 않은 DROP COLUMN 가능 |

옵션 C 는 **고려 외**예요. 옵션 A 는 현재 상태이고 위험을 인지했어요. **옵션 B 를 채택합니다** — Java 의 type safety 와 일관된 "운영은 명시적으로" 원칙이에요.

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
   │       └── 불일치 → SpringBootException → kamal blue/green 이 cutover 차단
   │
   ▼
5) blue/green health check OK → 새 인스턴스 활성, 기존 종료
```

---

## advisory lock 의 역할

Flyway 의 advisory lock 은 **migrate() 호출 시점의 동시성 방어** 예요 — 여러 인스턴스가 동시에 부팅해도 한 인스턴스만 V스크립트를 적용해요. validate-only 모드에선 lock 을 사용하지 않아요 (read-only).

prod 에서 validate-only 로 바뀌어도 **로컬 dev / test 의 lock 보장은 그대로 유지돼요** — 본 ADR 는 prod 의 자동 migrate 만 제거합니다.

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
