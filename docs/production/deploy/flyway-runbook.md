# Flyway Runbook

> **유형**: Runbook · **독자**: Level 2.5 (운영자) · **읽는 시간**: ~10분

이 문서는 Flyway 마이그레이션의 운영 절차를 다룹니다. 부팅 시 정상 흐름을 확인하는 법, 실패했을 때 복구하는 법, 운영 DB 에 V스크립트를 직접 적용하는 법을 상황별로 정리했어요.

먼저 현재 정책부터 잡아 둘게요. [ADR-033](../../philosophy/adr-033-flyway-hybrid-policy.md) 의 Hybrid 정책에 따라 환경마다 Flyway 동작이 갈립니다.

| 환경 | 부팅 시 동작 | 의미 |
|---|---|---|
| **local / test** | `migrate()` (AUTO) | 부팅하면 자동으로 schema 적용 |
| **dev** | `validate()` (VALIDATE_ONLY) | checksum 정합만 검증, schema 변경 X |
| **prod** | `validate()` (VALIDATE_ONLY) | checksum 정합만 검증, schema 변경 X |

dev 가 AUTO 가 아니라는 점에 주의하세요. dev 와 prod 둘 다 부팅 시점에는 검증만 하고, 실제 schema 변경은 운영자가 `tools/migrate-prod.sh` 로 사전에 직접 적용합니다. local 과 test 만 부팅하면서 자동 migrate 해요.

스위치는 `app.flyway.mode` 프로퍼티 (`AUTO` / `VALIDATE_ONLY` / `DISABLED`) 이고, `APP_FLYWAY_MODE` 환경변수로 override 합니다. 결정 근거는 [`ADR-033 · Flyway Hybrid Policy`](../../philosophy/adr-033-flyway-hybrid-policy.md) 에 있어요.

> 📌 **core schema 는 폐기됐어요 ([ADR-037](../../philosophy/adr-037-core-schema-deprecation.md)).** 예전에는 `core` schema 에 `users` / `auth` / `device` 공통 테이블을 두고 각 슬러그 schema 와 둘로 나눴는데, 지금은 `core` schema 자체가 PostgreSQL 에 없습니다. 공통 테이블은 각 슬러그 schema 안에 V001~V006 으로 생성되고, `core/core-*-impl` 의 Java 코드는 라이브러리로만 남아 슬러그 schema 의 같은 테이블에서 동작해요. 그래서 이 런북의 모든 schema 작업은 **슬러그 단위** 입니다.

---

## 1. 상황 매트릭스

지금 무슨 일이 터졌는지로 바로 점프하세요.

| 증상 | 원인 | 대응 | 참조 |
|---|---|---|---|
| `flyway_schema_history` 에 `success = false` 행 | 마지막 마이그레이션 실패 | 실패 entry 제거 후 정정 V스크립트 재적용 | [§3](#3-부팅-시-마이그레이션-실패) |
| `FlywayException` + SQL 에러 | V스크립트 충돌 / 데이터 충돌 | 새 V스크립트로 정정 | [§3.A](#a-sql-syntax--데이터-충돌) |
| `Waiting for changelog lock....` | advisory lock 미해제 | holder 식별 후 좀비만 강제 종료 | [§3.B](#b-advisory-lock-충돌) |
| `Migration checksum mismatch` (부팅) | 적용된 V스크립트 수정 또는 checksum 알고리즘 불일치 | 새 V스크립트 정정 또는 history checksum 갱신 | [§3.C](#c-checksum-불일치) · [§5.3](#5-3-부팅-시-validate-실패-대응) |
| `Resolved migration not applied` (prod 부팅) | classpath 에는 있는데 schema_history 에 없음 | `migrate-prod.sh` 미실행 → 실행 후 재배포 | [§5.3](#5-3-부팅-시-validate-실패-대응) |
| `Applied migration not resolved` (prod 부팅) | schema_history 에는 있는데 classpath 에 없음 | V스크립트가 jar 에 빠짐 → build 검증 | [§5.3](#5-3-부팅-시-validate-실패-대응) |
| validate 가 부팅 자체를 막음 | schema_history 손상 | `APP_FLYWAY_MODE=DISABLED` 로 긴급 우회 | [§5.4](#5-4-긴급-우회--disabled) |

---

## 2. 정상 흐름 검증

### 2-1. 마이그레이션 적용 여부 확인

각 슬러그 schema 의 `flyway_schema_history` 를 직접 조회합니다.

```bash
# 슬러그 schema (예: gymlog)
psql "$DB_URL" -c "SELECT version, description, success, installed_on
                   FROM gymlog.flyway_schema_history
                   ORDER BY installed_rank DESC LIMIT 10;"
```

`success = TRUE` 인 행만 정상 반영된 상태입니다. `FALSE` 인 행이 보이면 마지막 마이그레이션이 실패한 거라 복구가 필요해요 ([§3](#3-부팅-시-마이그레이션-실패)).

> `core.flyway_schema_history` 는 더 이상 없어요. `core` schema 자체가 폐기됐으니 ([ADR-037](../../philosophy/adr-037-core-schema-deprecation.md)) 조회할 schema 는 언제나 슬러그 이름입니다.

### 2-2. 마이그레이션 매핑

`new app` (`tools/new-app/new-app.sh`) 이 새 앱마다 V001~V015 를 자동 생성합니다. 전부 슬러그 schema 안에 만들어지고, 내용은 모든 앱이 동일해요.

| 버전 | 테이블 / 내용 | 비고 |
|---|---|---|
| V001 ~ V006 | 인증 기반 (users · social_identities · refresh_tokens · email/password 토큰 · devices) | 모든 앱 공통 |
| **V007** | admin user 시드 (`V007__seed_admin_user.sql`) | 첫 관리자 계정 1명 (Step 15 에서 채워 넣음) |
| V008 ~ V012 | 결제·구독·감사 (plans · subscriptions · payment_webhook_events · subscription_renewals · audit_logs) | 공통 |
| V013 ~ V014 | 2FA(TOTP) 컬럼 · 사용자 알림 채널 toggle | 공통 |
| V015 | phone_verification_codes (휴대폰 점유인증) | 옵트인 — 안 쓰면 파일 삭제 가능 |
| **V016 ~** | 앱별 도메인 테이블 | 운영자가 직접 작성 |

V001~V015 가 이미 차 있고 V007 은 도메인이 아니라 관리자 시드라, 본인 도메인 테이블은 V016 부터 시작합니다. V 파일은 `apps/app-<slug>/src/main/resources/db/migration/<slug>/` 에 위치해요.

---

## 3. 부팅 시 마이그레이션 실패

local / test 부팅이나 운영자가 `migrate-prod.sh` 를 돌리는 시점에 Flyway 가 실패하는 경우입니다. 부팅 로그에서 `org.flywaydb.core.api.FlywayException` 을 먼저 확인하세요.

### A. SQL syntax / 데이터 충돌

```text
ERROR: column "foo" referenced in foreign key constraint does not exist
```

이전 마이그레이션과 충돌하는 V스크립트가 원인입니다. 이미 적용된 V스크립트는 수정하지 말고 (checksum 이 깨져요) 새 V스크립트로 정정하세요. 실패 entry 가 schema_history 에 들어갔으면 먼저 제거합니다.

```sql
-- 실패한 entry 가 남아 있으면 제거
DELETE FROM <schema>.flyway_schema_history WHERE success = false;
```

정정 V스크립트를 commit 한 뒤 재적용 / 재배포하면 돼요.

### B. Advisory lock 충돌

```text
INFO: Waiting for changelog lock....
```

이전 부팅이 비정상 종료해 lock 이 미해제된 상태일 수 있어요. 드물지만 가능합니다. 다만 단순 wait 이라면 lock 을 쥔 인스턴스가 정상 작동 중일 수 있으니, 강제 해제 전에 holder 를 먼저 확인하세요.

진단 — 어떤 프로세스가 lock 을 쥐고 있는지 식별합니다.

```sql
SELECT pid, application_name, state, query_start
FROM pg_stat_activity
WHERE pid IN (
    SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND granted = true
);
```

해당 PID 가 정상 Spring 인스턴스 (다른 배포가 진행 중) 라면 그대로 기다립니다. 10분 이상 idle 인 좀비 인스턴스만 강제 종료하세요.

```sql
-- 위험 — 운영 인스턴스를 죽이면 트래픽에 영향이 갑니다. 좀비 확인 후에만 실행
SELECT pid, pg_terminate_backend(pid)
FROM pg_locks
WHERE locktype = 'advisory' AND granted = true
  AND pid NOT IN (SELECT pid FROM pg_stat_activity WHERE state = 'active');
```

본 connection 자체가 holder 인 드문 경우엔 lock 만 풀면 됩니다.

```sql
SELECT pg_advisory_unlock_all();
```

### C. Checksum 불일치

```text
ERROR: Validate failed: Migration checksum mismatch for migration version 1
```

이미 적용된 V001 같은 SQL 파일을 나중에 수정한 경우입니다. 적용된 V스크립트는 수정하지 않는 게 원칙이에요. 항상 새 V스크립트로 정정합니다. history 의 checksum 을 직접 갱신하는 우회도 있지만 권장하지 않아요.

```sql
-- 권장 X — silent 한 schema drift 위험. 정정 V스크립트가 정도
UPDATE <schema>.flyway_schema_history
SET checksum = <new_checksum> WHERE version = '1';
```

부팅 시점 prod validate 실패는 양상이 조금 달라서 [§5.3](#5-3-부팅-시-validate-실패-대응) 에서 따로 다룹니다.

### 3-1. Repair 명령

Flyway 의 `repair` 는 schema_history 의 inconsistent state 를 정리합니다. failed migration entry (`success = false`) 삭제, checksum 자동 갱신, deleted V스크립트의 missing entry 보정, metadata 일관성 갱신을 한 번에 처리해요.

| 환경 | 권장 | 사유 |
|---|---|---|
| **local** | ✅ | 자유롭게 — schema 자동 reset 도 OK |
| **test** | ✅ | Testcontainers 가 매번 새 인스턴스 |
| **dev / prod** | ⚠️ 마지막 수단 | checksum 자동 갱신이 운영자 의도와 다른 V스크립트 수정을 silent 하게 허용 |

local / test 에서는 `./gradlew flywayRepair` 를 쓰거나 임시 프로퍼티로 1회 부팅합니다.

```yaml
spring:
  flyway:
    repair-on-migrate: true   # 1회 부팅 후 다시 false (또는 제거)
```

dev / prod 는 validate-only 라 `repair-on-migrate` 가 효과가 없어요. 마지막 수단으로 schema_history 의 row 를 직접 UPDATE / DELETE 하거나 ([§5.3](#5-3-부팅-시-validate-실패-대응)), 임시로 `APP_FLYWAY_MODE=AUTO` + `repair-on-migrate=true` 로 1회 부팅해 정정한 뒤 즉시 `VALIDATE_ONLY` 로 복귀합니다.

> 💀 **위험**: `repair-on-migrate=true` 는 V스크립트의 모든 변경을 silent 하게 받아들여요. 의도치 않은 schema drift 가 생길 수 있으니 사용 후에는 즉시 false 로 되돌리세요.

---

## 4. 운영 마이그레이션 — `prod migrate`

dev / prod 부팅 시 Flyway 는 validate 만 하고 schema 를 바꾸지 않습니다. 새 schema 는 운영자가 배포 전에 직접 적용해야 해요. `factory` wrapper 의 `prod migrate` (또는 `dev migrate`) 명령이 `tools/migrate-prod.sh` 를 호출하는데, `--target=prod` / `--target=dev` 로 대상 환경만 갈립니다. local 은 부팅 시 자동 migrate 라 `migrate` 명령이 막혀 있어요.

### 4-1. 적용 절차

```bash
# 1. V스크립트 작성 (보통 PR 안에서)
vi apps/app-gymlog/src/main/resources/db/migration/gymlog/V016__add_foo.sql

# 2. dry-run 으로 미리보기 (실제 적용 X)
<repo> prod migrate gymlog V016__add_foo --dry-run
# 또는 직접:
bash tools/migrate-prod.sh --target=prod gymlog \
  apps/app-gymlog/src/main/resources/db/migration/gymlog/V016__add_foo.sql --dry-run

# 3. 실제 적용 (prompt 에 yes 입력)
<repo> prod migrate gymlog V016__add_foo

# 4. 결과 확인 (스크립트가 자동 출력)
#    installed_rank | version | description | success | installed_on
#         16        |   16    |   add foo   |    t    |  2026-05-02 15:30:21+00

# 5. deploy tag + GHA deploy.yml trigger
git tag deploy/v$(git rev-parse --short HEAD)
git push --tags

# 6. Spring Boot 부팅 (prod profile, validate-only)
#    schema_history 의 V016 와 classpath 의 V016__add_foo.sql checksum 비교
#    정합 OK → kamal blue/green 활성
```

### 4-2. migrate-prod.sh 가 하는 일

`tools/migrate-prod.sh` 의 동작 순서는 이래요.

1. `.env.<target>` 에서 `DB_URL` / `DB_USER` / `DB_PASSWORD` 를 로드하고 JDBC URL 을 psql 형식으로 변환합니다.
2. V스크립트 파일명에서 version 과 description 을 추출하고 (`V016__add_foo.sql` → `16`, `add foo`) SQL 미리보기를 출력한 뒤 적용을 묻습니다 (`--force` 면 skip).
3. 단일 transaction 으로 `BEGIN; <SQL>; INSERT INTO <slug>.flyway_schema_history ...; COMMIT;` 을 실행합니다. SQL 적용과 history INSERT 가 같은 transaction 이라, 둘 중 하나가 실패하면 둘 다 롤백돼 schema 와 history 의 inconsistent state 를 막아요.
4. 적용 후 `success = true` 행을 출력해 결과를 확인시킵니다.

> ⚠️ **checksum 알고리즘이 Flyway 와 1:1 일치하지 않습니다.** 이 도구는 CRLF 를 LF 로 바꾼 뒤 zlib CRC32 로 checksum 을 계산하는데, Flyway 의 내부 알고리즘과 정확히 같지 않아요. 그래서 부팅 시 validate 가 `Migration checksum mismatch` 를 낼 수 있고, 그때는 [§5.3](#5-3-부팅-시-validate-실패-대응) 의 history checksum 갱신으로 정정합니다. 근본 해결 (Flyway 라이브러리 직접 호출 helper) 은 [백로그](../../planned/backlog.md) 에 있어요.

> ⚠️ V스크립트 안에서 직접 `BEGIN` / `COMMIT` 을 쓰면 이 도구의 transaction wrap 과 충돌합니다. V스크립트는 raw DDL 만 담으세요.

### 4-3. checksum 알고리즘 같이 보기

`migrate-prod.sh` 가 쓰는 계산은 다음과 같아요. Flyway 와 다른 지점이 바로 이 단순화된 CRC32 입니다.

```python
# tools/migrate-prod.sh 발췌 (checksum 계산부)
import zlib
with open(SQL_FILE, 'rb') as f:
    data = f.read().replace(b'\r\n', b'\n')   # CRLF → LF
print(zlib.crc32(data) & 0xFFFFFFFF)
```

---

## 5. prod / dev validate 실패와 긴급 대응

### 5-1. 운영 DB 직접 조회

```bash
# 현재 schema_history 전체 조회
psql "$DB_URL" -c "SELECT * FROM <schema>.flyway_schema_history ORDER BY installed_rank;"
```

### 5-2. 실패 entry 정리

```bash
psql "$DB_URL" -c "DELETE FROM <schema>.flyway_schema_history WHERE success = false;"
```

### 5-3. 부팅 시 validate 실패 대응

dev / prod 부팅 시 `Flyway validate failed` 가 나는 시나리오와 대응입니다.

| 증상 | 원인 | 대응 |
|---|---|---|
| `Resolved migration not applied` | classpath 에 V016 이 있는데 schema_history 에 없음 | `migrate-prod.sh` 미실행 → 실행 후 재배포 |
| `Applied migration not resolved` | schema_history 에 V016 이 있는데 classpath 에 없음 | V016 파일이 jar 에 빠짐 → build 검증 |
| `Migration checksum mismatch` | 적용된 V스크립트 수정 또는 `migrate-prod.sh` checksum 불일치 ([§4-2](#4-2-migrate-prodsh-가-하는-일)) | V스크립트를 고쳤다면 새 V로 정정. 도구 checksum 불일치면 부팅 로그에서 Flyway 가 기대하는 checksum 을 추출해 history 를 갱신 |

checksum 불일치 정정은 부팅 로그의 expected 값을 그대로 넣습니다.

```sql
UPDATE <schema>.flyway_schema_history
SET checksum = <expected> WHERE version = '<N>';
```

### 5-4. 긴급 우회 — DISABLED

schema_history 손상 등으로 validate 가 부팅 자체를 막을 때, `DISABLED` 모드로 validate 와 migrate 를 모두 건너뜁니다.

```bash
APP_FLYWAY_MODE=DISABLED kamal deploy
# Flyway validate / migrate 둘 다 skip → 정합 검증 없이 부팅
```

`DISABLED` 는 schema_history 와 실제 schema 의 정합을 보장하지 않아요. 손상을 복구한 뒤에는 즉시 `VALIDATE_ONLY` 로 복귀하세요.

---

## 6. 에스컬레이션

이 런북으로 풀리지 않는 상황입니다.

- **부분 적용 (V14 성공 / V15 실패)** — V14 변경은 이미 commit 돼 단순 rollback 으로 못 되돌려요. V15 의 부분 변경 상태를 분석해 수동 정정해야 하는 까다로운 복구라, 위험 모델은 [ADR-033](../../philosophy/adr-033-flyway-hybrid-policy.md) 의 부분 적용 논의를 참고하세요.
- **모든 인스턴스가 부팅 대기** — advisory lock 손상이 의심되면 [§3.B](#b-advisory-lock-충돌) 의 holder 식별을 먼저 하고, 그래도 안 풀리면 운영 배포를 멈춘 뒤 lock 을 정리합니다.
- 장애가 배포 전반으로 번지면 [`운영 런북`](./runbook.md) 의 롤백·장애 대응 절차로 넘어가세요.

복구 후에는 무엇이 원인이었는지 [백로그](../../planned/backlog.md) 나 인시던트 회고에 남겨, 같은 실패가 반복되지 않게 합니다.

---

## 7. 관련 문서

- [`ADR-033 · Flyway Hybrid Policy`](../../philosophy/adr-033-flyway-hybrid-policy.md) — 환경별 분리 정책의 결정 근거 + 대안 비교
- [`ADR-037 · core schema 폐기`](../../philosophy/adr-037-core-schema-deprecation.md) — core schema 제거 + 슬러그 단위 통합 근거
- [`Multi-tenant Architecture`](../../structure/multitenant-architecture.md) — 슬러그 schema 격리와 Flyway 초기화 순서
- [`Architecture`](../../structure/architecture.md) — 모듈별 마이그레이션 위치
- [`CLI 가이드`](../../start/cli-guide.md) — `prod migrate` / `dev migrate` 명령 매트릭스
- [`운영 런북`](./runbook.md) — 평시 배포 · 롤백 · 장애 대응
- `tools/migrate-prod.sh` — prod / dev V스크립트 적용 자동화 도구 (`factory` wrapper 의 본체)
</content>
</invoke>
