<a id="adr-033--flyway-hybrid-마이그레이션-정책-devauto-prodvalidate-only"></a>

# ADR-033 — Flyway Hybrid 마이그레이션 정책 (dev=auto, prod=validate-only)

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~7분

**Status**: Accepted. [ADR-037](./adr-037-core-schema-deprecation.md) 이후 앱별 Flyway로 관리해요. dev/prod 프로파일 fallback은 `VALIDATE_ONLY`지만 현재 환경 예시 파일의 `APP_FLYWAY_MODE=AUTO`가 이를 덮어써요. 실제 적용값을 확인하고 수동 적용이 필요하면 `tools/deploy/migrate-prod.sh`를 사용해요. 고정 admin 스키마의 Flyway는 항상 migrate하는 예외예요.

---

## 결론부터

앱 스키마의 Flyway 실행 방식을 `AUTO`·`VALIDATE_ONLY`·`DISABLED`로 나눠요. 공통 프로파일의 fallback은 `AUTO`, dev/prod 프로파일은 `VALIDATE_ONLY`예요. 다만 현재 `.env.dev.example`과 `.env.prod.example`에는 `APP_FLYWAY_MODE=AUTO`가 들어 있어, 그대로 사용하면 프로파일 fallback을 덮어써요. 배포 전에 실제 적용값을 확인하고 마이그레이션 실행 시점을 결정해야 해요. 운영 콘솔의 `adminFlyway`는 이 설정과 별개로 항상 migrate하는 예외예요.

본 ADR 은 환경별로 Flyway 동작을 분리하는 *Hybrid Policy* 를 정의합니다. local / test 환경에서는 *기존처럼 자동 migrate* — 개발 효율을 유지하기 위해 코드 변경과 함께 schema 도 자동으로 적용돼요. 반면 dev / prod 환경에서는 *validate-only 모드* 로 동작합니다 — 부팅 시 schema_history 의 checksum 정합만 검증하고 실제 V스크립트는 적용하지 않아요. 운영자가 deploy 전에 해당 DB 에 직접 SQL 을 적용하는 명시적 단계를 거쳐야 새 schema 가 반영됩니다.

이 정책의 핵심 가치는 *deploy 와 schema 변경의 분리* 예요. 코드 deploy 는 언제든 안전하게 rollback 가능한 영역이지만, schema 변경은 원칙적으로 forward-only 라 한 번 적용되면 되돌리기 어려운 영역입니다. 이 두 가지를 같은 시점에 자동으로 묶어버리면 schema 변경의 무게가 코드 deploy 의 가벼움과 충돌해요. 분리하면 운영자가 schema 변경의 시점을 별도로 결정할 수 있고, DBA 가 변경 사실을 사전에 인지하는 워크플로우도 자연스럽게 따라옵니다.

운영자의 적용 도구는 `tools/deploy/migrate-prod.sh` 자동화이고, SSH + psql 수동 적용과 schema_history INSERT 흐름을 함께 처리합니다. 적용 절차는 [`Flyway Runbook`](../production/deploy/flyway-runbook.md) 에 별도 정리되어 있어요.

이 ADR 의 범위는 환경별 분리 정책의 결정 근거, local / test 자동 migrate 가 유지되는 이유, dev / prod validate-only 가 잡는 위험, advisory lock 의 역할, 부분 적용과 락 손상 시 복구 흐름, 그리고 Liquibase·pgschema·Atlas 같은 대안 도구와의 트레이드오프 비교까지입니다.

---

## 왜 이런 고민이 시작됐나?

기본 Flyway 설정 — *모든 환경에서 부팅 시 자동 migrate* — 은 개발 단계에서는 가장 단순하고 자연스러운 형태예요. 코드와 schema 가 *한 commit 에 함께 묶여 deploy* 되어 *환경 동기화* 가 자동으로 이뤄지고, 별도 운영 절차도 필요 없습니다. 작은 팀 / 단일 환경에서는 이 단순함의 가치가 압도적이에요.

문제는 *운영 환경(dev / prod)의 위험 모델* 이 local / test 와 본질적으로 다르다는 점이에요. 운영 환경에서 *부팅 시 schema 변경* 이 일어난다는 것은 다음 네 가지 위험을 동시에 가져옵니다.

**첫째, 부팅 실패가 트래픽 단절로 이어집니다.** V15 마이그레이션이 *예상치 못한 데이터 (예: 중복 row)* 때문에 적용 실패하면 *Spring Boot 부팅 자체가 실패* 하고, *블루/그린 배포* 환경에서는 *새 인스턴스가 health check 를 통과하지 못해 트래픽이 라우팅되지 않는* 상태가 됩니다. 기존 인스턴스가 *이미 종료된 시점* 이라면 *전체 서비스 다운* 으로 이어질 수 있어요.

**둘째, 여러 마이그레이션 중 일부만 반영될 수 있어요.** 앞선 마이그레이션이 커밋된 뒤 다음 마이그레이션이 실패하면 코드와 스키마의 호환성을 확인해야 해요. 실패한 한 마이그레이션 내부의 변경이 남는지는 트랜잭션 실행 여부와 SQL 종류에 따라 달라요. 항상 중간 DDL이 남는다고 가정하지 말고 실제 이력과 스키마를 확인해요.

**셋째, 다른 마이그레이션 세션의 락을 기다릴 수 있어요.** 먼저 실행 중인 세션과 락 대기 원인을 확인해야 해요. `pg_advisory_unlock_all()`은 호출한 세션의 락을 해제하는 함수이므로 다른 세션의 대기를 해결하는 만능 명령으로 안내하지 않아요. 복구는 연결 방식과 실행 중인 작업을 확인한 뒤 런북에 따라 진행해요.

**넷째, schema 변경이 코드 deploy 의 부산물로 발생해서 DBA / 운영자가 변경 사실을 모를 수 있습니다.** 운영 환경에서 *어느 시점에 어떤 schema 변경이 있었는지* 가 *코드 commit log 안에 묻혀* 있으면, 별도 추적 도구 없이는 *변경 history 를 파악* 하기 어려워요. 이는 *PCI-DSS 같은 audit 요구* 와도 충돌합니다.

이 네 가지 위험은 *운영 환경(dev / prod)* 에서만 의미가 있어요. local / test 환경에서는 부팅 실패가 트래픽 단절로 이어지지 않고, schema 가 inconsistent state 로 남아도 reset 과 recreate 가 자유로워서 위험 자체가 거의 없습니다. 따라서 *local / test 의 자동 migrate 편의* 와 *dev / prod 의 명시적 통제* 를 동시에 잡는 *환경별 분리 정책* 이 정합한 답이에요.

대안으로 *Liquibase changelog*, *Atlas / pgroll* 같은 다른 도구들도 검토 가치가 있어요. Liquibase 는 XML/YAML 기반이라 *Flyway 의 SQL 직접성* 과 *Spring Boot 1차 통합* 을 잃습니다. Atlas / pgroll 같은 *gradual migration* 도구는 *zero-downtime schema 변경* 을 지원하지만 *현재 단계에는 over-engineering* 이고 *별도 ADR 로 다룰 주제* 예요.

이 결정이 답해야 할 물음은 이거예요.

> **local / test 의 자동 migrate 편의를 유지하면서 dev / prod 의 부팅 실패·부분 적용·advisory lock 손상·변경 추적성 부재 위험을 동시에 차단하는 마이그레이션 정책은 무엇인가?**

<a id="옵션-a--그대로-자동-migrate-현재"></a>

### 옵션 A — 그대로 자동 migrate (현재)
| 장점 | 단점 |
|---|---|
| 단순 — 별도 운영 절차 X | prod 부팅 시 schema 변경 발생 가능성 |
| advisory lock 으로 동시성 안전 | 부분 적용 시 복구 절차 복잡 |
| Flyway baseline-on-migrate 가 신규 schema 자동 처리 | DBA / 운영자가 변경 사실을 모를 수 있음 |

<a id="옵션-b--hybrid-devtest--auto-prod--validate-only"></a>

### 옵션 B — Hybrid (dev/test = auto, prod = validate-only)
| 장점 | 단점 |
|---|---|
| dev / prod 부팅 시 schema 변경 X — 안전 | 운영자가 deploy 전 해당 DB 에 직접 SQL 적용 필요 |
| DBA / 운영자가 schema 변경을 명시적으로 통제 | 자동화 도구 `tools/deploy/migrate-prod.sh` 필요 |
| 부분 적용 위험 0 — 부팅 시 검증만 | local / test 에선 그대로 자동이라 개발 iteration 이 빠름 |
| Flyway `validate` 만 호출 → checksum 정합 보장 | |

<a id="옵션-c--orm-hbm2ddlauto"></a>

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
| **local / test profile** | Flyway `migrate()` (자동) — 현재 동작 유지 (default `AUTO`) |
| **dev / prod profile** | Flyway `validate()` 만 — schema_history 의 checksum 정합 검증, 변경 X |
| **적용 흐름** | 운영자가 deploy 전 SSH + psql 로 직접 적용 → `tools/deploy/migrate-prod.sh` 자동화 |
| **schema_history 등록** | `tools/deploy/migrate-prod.sh` 가 SQL 실행 후 자동 `INSERT` |
| **부팅 실패 정책** | dev / prod validate fail = Spring 부팅 fail → kamal blue/green 이 cutover 안 함 (트래픽 보호) |
| **switch 메커니즘** | properties `app.flyway.mode = AUTO | VALIDATE_ONLY | DISABLED` (default `AUTO`, dev/prod=`VALIDATE_ONLY`) |
| **Override** | 운영자가 긴급 시 `APP_FLYWAY_MODE=AUTO` 로 임시 사용 가능 (위험 인지하에) |

---

## 핵심 코드 변경

### 1. `AbstractAppDataSourceConfig` 갱신

```java
public enum FlywayMode {
    AUTO,           // configure + migrate (local/test)
    VALIDATE_ONLY,  // configure + validate (dev/prod default)
    DISABLED        // 검증도 안 함 (긴급 우회)
}

protected Flyway buildFlyway(DataSource ds, FlywayMode mode) {
    return Flyway.configure()
            // 전달된 runtime ds 는 무시 — Flyway 는 session-mode 전용 DS 사용 (ADR-037 후속 fix,
            // transaction pooler 에서 advisory lock 이 깨지는 문제)
            .dataSource(buildFlywayDataSource())
            .schemas(slug)
            .locations("classpath:db/migration/" + slug)
            .baselineOnMigrate(mode == FlywayMode.AUTO)   // VALIDATE_ONLY 는 baseline X
            .load();
}
```

`buildFlyway` 는 mode 와 무관하게 **항상 설정된 Flyway 객체를 반환**해요 — `DISABLED` 라고 `null` 을 돌려주지 않습니다(초안 스니펫과 다른 부분). mode 는 여기서 `baselineOnMigrate` 정책만 가르고, "실행하느냐 마느냐" 는 아래 `runFlywayWithMode` 가 `migrate()` / `validate()` 를 **호출하는지 여부**로 표현합니다.

<a id="2-concrete-subclass--bean-안에서-mode-분기"></a>

### 2. concrete subclass — `@Bean` 안에서 mode 분기

초안은 `@Bean(initMethod = ...)` + `@ConditionalOnProperty` 로 빈을 두 개 나누는 형태였지만, 실제 구현은 **빈 하나 + 명시 호출**로 정리했어요. `initMethod` 는 `app.flyway.mode` 를 무시하고 무조건 그 메서드를 부르기 때문이에요. 프로퍼티 값은 enum 이라 대문자(`AUTO` / `VALIDATE_ONLY` / `DISABLED`)를 씁니다.

```java
@Bean(name = "gymlogFlyway")
public Flyway gymlogFlyway(
        @Qualifier("gymlogDataSource") DataSource ds,
        @Value("${app.flyway.mode:AUTO}") FlywayMode mode) {
    Flyway flyway = buildFlyway(ds, mode);
    runFlywayWithMode(flyway, mode);
    return flyway;
}

// AbstractAppDataSourceConfig — mode 별 실행 분기
public static void runFlywayWithMode(Flyway flyway, FlywayMode mode) {
    switch (mode) {
        case AUTO -> flyway.migrate();
        case VALIDATE_ONLY -> flyway.validate();
        case DISABLED -> { /* no-op — 운영자가 수동 우회. schema 검증 안 됨. */ }
    }
}
```

> **명시 예외**: `AdminDataSourceConfig.adminFlyway` 만 `initMethod = "migrate"` 를 유지해요. admin 스키마의 권한 시드는 전 환경에 즉시 적용돼야 배포 직후 콘솔 RBAC 가 동작하기 때문입니다. 본 ADR 의 정책은 앱(slug) 스키마 대상이에요.

### 3. profile 별 default

```yaml
# application.yml (default) — local / test 가 상속
app:
  flyway:
    mode: ${APP_FLYWAY_MODE:AUTO}

# application-dev.yml — default override
app:
  flyway:
    mode: ${APP_FLYWAY_MODE:VALIDATE_ONLY}

# application-prod.yml
app:
  flyway:
    mode: ${APP_FLYWAY_MODE:VALIDATE_ONLY}
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
2) tools/deploy/migrate-prod.sh <slug> <V스크립트경로> 실행
   │   ├── SSH prod-host → psql $DB_URL -f V<N>__*.sql
   │   ├── 성공 시 INSERT INTO <slug>.flyway_schema_history 자동
   │   └── 실패 시 ROLLBACK + 에러 보고
   │
   ▼
3) gh workflow run deploy.yml -f version=<sha>  (GHA deploy.yml 재배포 dispatch)
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

Flyway 의 advisory lock 은 **migrate() 호출 시점의 동시성 방어** 예요 — 여러 인스턴스가 동시에 부팅해도 한 인스턴스만 V스크립트를 적용해요. validate-only 모드에선 lock 을 사용하지 않아요(read-only).

dev / prod 에서 validate-only 로 바뀌어도 **local / test 의 lock 보장은 그대로 유지돼요** — 본 ADR 는 dev / prod 의 자동 migrate 만 제거합니다.

---

<a id="부분-적용--락-손상-시-복구"></a>

## 부분 적용 / 락 손상 시 복구

<a id="a-dev--test-환경"></a>

### A. dev / test 환경
local / test 는 자동 migrate 그대로 — `flyway-runbook.md` §3 의 복구 절차 적용(advisory lock 강제 해제, 실패 entry 제거 후 정정 V스크립트). dev 는 prod 와 동일하게 아래 B 의 흐름을 따릅니다.

### B. prod 환경
- validate-only 라 부분 적용 발생 X (Flyway 가 SQL 실행 안 함)
- 운영자가 `tools/deploy/migrate-prod.sh` 실행 중 부분 실패 → 스크립트가 자동 transaction 으로 wrap
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

- ✅ dev / prod 부팅 시 schema 변경 0 — 부팅 실패는 코드·설정·DB 연결 문제로 한정
- ✅ DBA / 운영자가 schema 변경 시점을 명시적으로 통제
- ⚠️ deploy 전 `tools/deploy/migrate-prod.sh` 실행 step 추가 — 운영자 1단계 추가
- ⚠️ schema_history INSERT 누락 시 다음 deploy 의 validate 실패 → 명확한 에러로 detect
- ✅ 자동화 도구가 INSERT 도 함께 → 누락 위험 최소

---

## 후속 작업

> **갱신 (2026-07-15)**: 아래 후속 작업은 모두 완료됐어요 — `tools/deploy/migrate-prod.sh` 가 실존하고, `application-prod.yml`/`application-dev.yml` 이 `APP_FLYWAY_MODE:VALIDATE_ONLY` 로 분기하며, `new-app.sh` 의 `<Slug>DataSourceConfig` heredoc 도 동일 패턴을 따릅니다.

- `tools/deploy/migrate-prod.sh` 신규 (Phase 2-3) — 완료
- `flyway-runbook.md` 본문 갱신 (Phase 2-4) — 완료
- `bootstrap` profile 분기 적용 (Phase 2-2) — 완료
- 파생 앱의 `<Slug>DataSourceConfig` 도 동일 패턴 — `new-app.sh` heredoc 갱신 (Phase 2-2 후속) — 완료
- 관측: prod 부팅 로그에 `Flyway validate OK (N migrations)` 명시. 실패 시 alert.

---

## 관련 문서

- [`Flyway Runbook`](../production/deploy/flyway-runbook.md) — 운영 절차 상세
- [`ADR-018 · SchemaRoutingDataSource`](./adr-018-schema-routing-datasource.md) — 슬러그 schema 격리
- `tools/deploy/migrate-prod.sh` — 자동화 도구
