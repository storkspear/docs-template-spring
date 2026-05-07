# Flyway Runbook

> **유형**: Runbook · **독자**: 운영자 (Level 3) · **읽는 시간**: ~10분

이 문서는 **Flyway 마이그레이션의 운영 절차**를 정리합니다. 정상 흐름 / 실패 복구 / 정책 변경 예고.

> 📌 **현재 정책 (ADR-033 적용 후)**: Hybrid mode.
>
> - **dev / test profile** → Flyway `migrate()` 자동 (현재까지의 동작 유지)
> - **prod profile** → Flyway `validate()` 만. schema 변경 X. 운영자가 `tools/migrate-prod.sh` 로 사전 적용.
>
> Switch: `app.flyway.mode = AUTO | VALIDATE_ONLY | DISABLED` properties (`APP_FLYWAY_MODE` env override). 자세한 결정 근거: [`ADR-033 · Flyway Hybrid Policy`](../../philosophy/adr-033-flyway-hybrid-policy.md).

---

## 1. 마이그레이션 적용 흐름 (현재)

```
deploy 시작 (kamal build + push)
      │
      ▼
Spring Boot 부팅 (bootstrap JAR)
      │
      ▼
1) core schema 의 V001~V0NN 적용 (advisory lock 획득)
      │   apps/* 의존 없는 공통 테이블 (audit_logs, totp 컬럼 등)
      ▼
2) 각 슬러그 schema 의 V001~V0NN 순차 적용
      │   <slug>_DB_URL 별 datasource 마다 1회씩
      │   (병렬 X — Flyway advisory lock 으로 직렬화)
      ▼
3) Spring Bean 등록 → 트래픽 받기 시작
```

**핵심** — dev/test 에서는 운영자가 마이그레이션 SQL 을 별도로 실행하지 **않습니다**. 부팅 시 Flyway 가 자동으로 migrate 를 수행합니다. prod 는 다른 흐름으로 동작하니까 §4 를 참고하세요.

---

## 2. 정상 흐름 검증

### 2-1. 마이그레이션 적용 여부 확인

```bash
# core schema 의 schema_history
psql $DB_URL -c "SELECT version, description, success, installed_on
                 FROM core.flyway_schema_history
                 ORDER BY installed_rank DESC LIMIT 10;"

# 슬러그 schema (예: gymlog)
psql $DB_URL -c "SELECT version, description, success, installed_on
                 FROM gymlog.flyway_schema_history
                 ORDER BY installed_rank DESC LIMIT 10;"
```

`success = TRUE` 인 행만 정상 반영된 상태입니다. `FALSE` 인 행이 있으면 마지막 마이그레이션이 실패한 거예요 → 복구가 필요합니다.

### 2-2. 마이그레이션 매핑

| 위치 | 적용 schema | 비고 |
|---|---|---|
| `core/core-{user,auth,device}-impl/.../db/migration/core/` | core | 모든 앱 공통 — V001~V008 (V001/V002/V003 user, V005/V006/V007 auth, V008 device, V004 reserved) |
| `apps/app-<slug>/.../db/migration/<slug>/` | `<slug>` | 앱별 도메인 테이블 — `new-app.sh` 가 V001~V014 자동 생성 (V007 admin seed) |
| `core/core-*-impl/.../db/migration/core/` | core | 도메인 모듈이 추가하는 core 테이블 (audit_logs, users 의 totp 컬럼 등 — 향후 추가 시 이 위치) |

---

## 3. 마이그레이션 실패 복구

### 3-1. 부팅 시 Flyway 실패

부팅 로그에서 `org.flywaydb.core.api.FlywayException` 확인.

**증상별 대응**:

#### A. SQL syntax / 데이터 충돌
```
ERROR: column "foo" referenced in foreign key constraint does not exist
```
- 원인: 이전 마이그레이션과 충돌하는 V스크립트.
- 조치: 새 마이그레이션 V스크립트 추가로 정정 (이미 적용된 V스크립트 수정 X — checksum 불일치).
- 복구:
  ```sql
  -- 실패한 entry 가 schema_history 에 들어갔으면 제거
  DELETE FROM <schema>.flyway_schema_history WHERE success = false;
  ```
- 정정 V스크립트 commit → re-deploy.

#### B. Advisory lock 충돌 (다른 인스턴스가 holding)
```
INFO: Waiting for changelog lock....
```
- 원인: 이전 부팅이 비정상 종료 → lock 미해제 (드물지만 가능).
- ⚠️ **확인 우선** — 단순 wait 이면 lock 가진 인스턴스가 **정상 작동 중일 수 있음**. 강제 해제 전 다음 검증:
  1. `SELECT pid, application_name, state, query_start FROM pg_stat_activity WHERE pid IN (SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND granted = true);` — 어떤 프로세스가 holding 인지 식별
  2. 해당 PID 가 정상 spring 인스턴스 (다른 deploy 진행 중) 면 wait
  3. 좀비 인스턴스 (10분 이상 idle) 만 강제 종료
- 조치:
  ```sql
  -- 본 connection 의 lock 만 해제 (드문 케이스 — 본 connection 이 holder)
  SELECT pg_advisory_unlock_all();
  ```
  좀비 인스턴스 확인 후 PID 강제 종료:
  ```sql
  -- 위험 — 운영 인스턴스 죽이면 트래픽 영향
  SELECT pid, pg_terminate_backend(pid) FROM pg_locks
  WHERE locktype = 'advisory' AND granted = true
    AND pid NOT IN (SELECT pid FROM pg_stat_activity WHERE state = 'active');
  ```

#### C. Checksum 불일치 (이미 적용된 V스크립트 수정)
```
ERROR: Validate failed: Migration checksum mismatch for migration version 1
```
- 원인: 이미 적용된 V001 등의 SQL 파일을 수정한 경우예요.
- **금지**: 적용된 V스크립트는 수정하지 않아요. 항상 새 V스크립트로 정정합니다.
- 임시 우회 (운영자 직접):
  ```sql
  UPDATE <schema>.flyway_schema_history
  SET checksum = <new_checksum> WHERE version = '1';
  ```
  → 권장 X. 정정 V스크립트가 정도.

### 3-2. Repair 명령

Flyway 의 `repair` — schema_history 의 inconsistent state 정리. 4 가지 동작:

1. failed migration entry 삭제 (`success = false` 행)
2. checksum 자동 갱신 (현재 V스크립트의 checksum 으로)
3. missing migration entry 보정 (deleted V스크립트의 history 행 삭제)
4. type / description / installed_by 등 metadata 일관성 갱신

#### 사용 가능 환경

| 환경 | 권장 | 사유 |
|---|---|---|
| **dev** | ✅ | 자유롭게 — schema 자동 reset 도 OK |
| **test** | ✅ | Testcontainers 가 매번 새 instance |
| **prod** | ⚠️ 위험 — 마지막 수단 | checksum 자동 갱신 = 운영자 의도와 다른 V스크립트 수정 silently 허용 |

#### dev/test 사용

`./gradlew flywayRepair` 또는 임시 Spring profile:
```yaml
spring:
  flyway:
    repair-on-migrate: true
```
1회 부팅 후 다시 `false` (또는 property 제거).

#### prod 직접 호출 — 신중히

ADR-033 의 hybrid 정책에 따라 prod 는 `validate-only` — `repair-on-migrate` 가 효과 X.

마지막 수단으로 schema_history 의 row 직접 UPDATE/DELETE 사용 (`flyway-runbook.md §4-3` 참조). 또는 **임시로 prod 의 `app.flyway.mode=AUTO` + `repair-on-migrate=true`** 로 부팅 → 1회 정정 → 즉시 `validate-only` 로 복귀.

> 💀 **위험**: repair-on-migrate=true 는 V스크립트의 모든 변경을 silently 받아들여요. 의도치 않은 schema drift 가 가능합니다. 사용 후에는 즉시 false 로 되돌리세요.

---

## 4. 운영 마이그레이션 (ADR-033 — Hybrid)

prod 부팅 시 Flyway 는 **validate 만** 수행합니다. schema 변경은 일어나지 않아요. 운영자가 deploy 전에 직접 적용해야 합니다.

### 4-1. 정상 흐름 — `factory prod migrate` (또는 `tools/migrate-prod.sh`)

`factory` wrapper 의 `prod migrate <slug> <V*>` 명령이 `tools/migrate-prod.sh` 를 호출합니다. 둘 중 어느 쪽을 써도 동일하게 동작해요.

```bash
# 1. V스크립트 작성 (보통 PR 안에서)
vi apps/app-gymlog/src/main/resources/db/migration/gymlog/V005__add_foo.sql

# 2. dry-run 으로 미리보기 (실제 적용 X)
<your-backend> prod migrate gymlog V005__add_foo --dry-run
# 또는 직접:
bash tools/migrate-prod.sh gymlog apps/app-gymlog/src/main/resources/db/migration/gymlog/V005__add_foo.sql --dry-run

# 3. 실제 적용 (prompt 확인 후 진행)
<your-backend> prod migrate gymlog V005__add_foo

# 4. 결과 확인 (스크립트가 자동 출력)
#    installed_rank | version | description | success | installed_on
#    -----------+---------+-------------+---------+-------------
#         5     |   5     |   add foo   |   t     |   2026-05-02 15:30:21+00

# 5. git tag deploy + GHA deploy.yml trigger
git tag deploy/v$(git rev-parse --short HEAD)
git push --tags

# 6. Spring Boot 부팅 (prod profile, validate-only)
#    Flyway 가 schema_history 의 V005 와 classpath 의 V005__add_foo.sql 의 checksum 비교
#    정합 OK → kamal blue/green 활성
```

### 4-2. 운영자 프로토콜

`tools/migrate-prod.sh` 동작:
1. `.env.prod` 에서 DB_URL / DB_USER / DB_PASSWORD 로드
2. V스크립트 미리보기 출력 → 사용자 prompt
3. `BEGIN; <SQL>; INSERT INTO <slug>.flyway_schema_history; COMMIT;` 실행
4. 실패 시 자동 rollback — schema_history INSERT 도 롤백
5. checksum 은 Flyway 알고리즘 (CRC32 + CRLF 제거) 정확히 재현

**transaction wrap 의 안전성**: SQL 적용 + history INSERT 가 동일 transaction. 둘 중 하나 실패 시 둘 다 롤백 — schema 와 history 의 inconsistent state 방지.

### 4-3. 부팅 시 validate 실패 대응

prod 부팅 시 `Flyway validate failed` 에러 발생 가능 시나리오:

| 증상 | 원인 | 조치 |
|---|---|---|
| `Resolved migration not applied` | classpath 에 V005 있는데 schema_history 에 없음 | `tools/migrate-prod.sh` 미실행 → 실행 후 재배포 |
| `Applied migration not resolved` | schema_history 에 V005 있는데 classpath 에 없음 | V005 파일이 jar 에 포함되지 않음 → build 검증 |
| `Migration checksum mismatch` | 적용된 V스크립트 수정됨 OR `tools/migrate-prod.sh` 의 checksum 알고리즘이 Flyway 와 mismatch | (a) V005 수정 시 새 V006 으로 정정 (정도). (b) `migrate-prod.sh` mismatch 시: 부팅 로그에서 Flyway 가 expect 하는 checksum 추출 → `UPDATE <schema>.flyway_schema_history SET checksum = <expected> WHERE version = '<N>'` → 재 deploy. backlog 의 "Flyway library 직접 호출 helper" 가 근본 해결. |

### 4-4. 긴급 우회 — `app.flyway.mode = DISABLED`

prod 에서 schema_history 손상 등으로 validate 가 부팅을 막을 때:
```bash
APP_FLYWAY_MODE=DISABLED kamal deploy
# Flyway 의 validate / migrate 둘 다 skip → 정합 검증 없이 부팅
```
**위험**: schema_history 와 실 schema 의 정합 미보장. 손상 복구 후 즉시 `VALIDATE_ONLY` 로 복귀.

### 4-5. 변경 근거

PHP/Laravel 의 자동 migrate 가 prod 에서 부팅 실패 / 부분 적용 / 락 손상으로 이어진 과거 incident. Java/Flyway 도 동일 위험 — advisory lock 으로 동시성 안전하지만, 부팅 시점에 prod schema 자동 변경은 여전히 위험. Hybrid 정책으로:
- prod schema 변경은 명시적 step (operator 의 의도된 명령)
- 부팅 실패는 코드 / 설정 / DB 연결 문제로 한정 (schema 변경 부산물 X)
- DBA / 운영자가 schema 변경 시점을 통제

자세한 결정: [`ADR-033`](../../philosophy/adr-033-flyway-hybrid-policy.md).

---

## 5. 키 명령어 모음

```bash
# 현재 schema_history 조회
psql $DB_URL -c "SELECT * FROM <schema>.flyway_schema_history ORDER BY installed_rank;"

# 실패한 entry 제거 (정정 V스크립트 적용 전)
psql $DB_URL -c "DELETE FROM <schema>.flyway_schema_history WHERE success = false;"

# Advisory lock 강제 해제 (lock 가진 PID 죽이기)
psql $DB_URL -c "SELECT pid, pg_terminate_backend(pid) FROM pg_locks WHERE locktype = 'advisory';"

# Spring Boot 부팅 시 Flyway 단독 실행 검증 (dry-run 유사)
java -jar bootstrap.jar --spring.flyway.locations=classpath:db/migration --spring.flyway.target=current
```

---

## 6. 관련 문서

- [`Multitenant Architecture`](../../structure/multitenant-architecture.md) — 슬러그 schema 격리
- [`Architecture`](../../structure/architecture.md) — 모듈별 마이그레이션 위치
- [`CLI 가이드`](../../start/cli-guide.md) — `factory prod migrate` 명령 매트릭스
- [`ADR-033 · Flyway Hybrid Policy`](../../philosophy/adr-033-flyway-hybrid-policy.md) — 결정 근거 + alternatives
- `tools/migrate-prod.sh` — prod 적용 자동화 도구 (factory wrapper 의 본체)
