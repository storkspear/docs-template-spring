# ADR-005 · 단일 Postgres database + 앱당 schema

**Status**: Accepted. 현재 유효. 2026-04-24 기준 `infra/scripts/init-app-schema.sql` + `common-persistence/AbstractAppDataSourceConfig.java` 로 구현. Supabase production 도 동일 구조.

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~5분

## 결론부터

앱이 늘어나도 **database 는 하나 (`postgres`)** 만 유지하고, 각 앱에게 **자기 schema** (`sumtally`, `rny`, `gymlog` 등) 를 분리해서 줍니다. schema 안에는 그 앱의 유저 테이블부터 도메인 테이블까지 전부 들어가요. 한 앱이 다른 앱의 schema 를 못 건드리게 하는 방어선은 **5개** — DB role · DataSource · Flyway · 포트 인터페이스 · ArchUnit. Postgres 의 `CREATE SCHEMA` 한 줄이 사실상 "앱 한 개" 의 경계예요.

## 왜 이런 고민이 시작됐나?

앱 공장 전략([프롤로그 · 제약 2](./README.md#제약-2--시간이-가장-희소한-자원)) 에서 앱이 N 개 존재합니다. "한 Postgres 인스턴스 안에서 앱 N 개가 공존" 을 어떻게 만드느냐가 핵심 질문이었어요.

세 가지 분리 단위가 있고, 그중 하나를 골라야 합니다:

| 단위 | 예시 | 격리 강도 | 운영 부담 |
|---|---|---|---|
| 인스턴스 분리 | 앱마다 별도 Postgres 서버 | ★★★★★ | ★★★★★ |
| Database 분리 | 한 서버, 앱마다 별도 database | ★★★★ | ★★★ |
| Schema 분리 | 한 서버 · 한 database, 앱마다 schema | ★★★ | ★ |

격리 강도가 높을수록 "한 앱이 다른 앱에 사고 내기" 가 어려워집니다. 운영 부담이 높을수록 [제약 2](./README.md#제약-2--시간이-가장-희소한-자원) (솔로가 감당할 시간) 와 [제약 1](./README.md#제약-1--운영-가능성이-최우선) (단일 운영 단위) 를 위협해요.

여기에 **외부 제약** 하나가 추가됩니다. 우리는 Supabase (관리형 Postgres) 를 쓰기로 이미 결정했습니다 — 그 이유는 [제약 1](./README.md#제약-1--운영-가능성이-최우선) (운영을 외주화해 솔로 부담 감소). 그런데 Supabase 는 **`postgres` database 중심으로 설계** 되어 있어요:

- 대시보드 · Auth · Storage · Realtime 모두 `postgres` database 의 schema 로 구현됨
- 추가 database 생성은 제한되거나 대시보드가 제대로 인식 못 함

이 결정이 답할 물음은 이거예요.

> **여러 앱이 한 Postgres 인스턴스를 공유하면서도 서로의 데이터를 건드리지 못하게 하려면 어떤 경계를 그어야 하는가?**

## 고민했던 대안들

### Option 1 — 앱마다 별도 Postgres 인스턴스

가장 안전한 격리. 앱 하나가 DB 를 다운시켜도 다른 앱 영향 없음.

- **장점**: 완전한 물리적 격리. 백업/복원/튜닝이 앱마다 독립.
- **단점**:
  - 인스턴스 N 개의 요금 (Supabase 프로젝트 N 개 = 월 $25 × N)
  - DB 관리 대시보드 N 개 — 로그인, 모니터링, 백업 복원 시마다 분기
  - 앱 간 데이터 조인이 원천 불가 (미래 확장성 ↓)
  - **[제약 1](./README.md#제약-1--운영-가능성이-최우선) 위반** — 운영 단위가 N 배로 불어남
- **탈락 이유**: 솔로가 감당 불가능한 운영 부담. 앱 3개만 되어도 피로 누적.

### Option 2 — 단일 Postgres 인스턴스 + database 분리

한 Supabase 프로젝트 안에 database 를 여러 개.

- **장점**: 같은 인스턴스라 백업/모니터링은 통합. database 경계는 schema 보다 강함.
- **단점**:
  - **Supabase 구조적 제약** — Supabase 는 `postgres` database 에 맞춰 설계됨. 추가 database 만들어도 대시보드/RLS/Auth 기능이 인식 못 함.
  - 결국 Supabase 의 관리형 이점을 반만 누리게 됨 (custom database 는 self-managed 상태).
  - Role 분리는 가능하지만 database 레벨 권한 관리가 schema 레벨보다 딱히 쉽지도 않음.
- **탈락 이유**: Supabase 와 궁합이 나쁨. 그 이점을 포기하면 Option 1 에 가까워지는데 격리 강도는 더 약함 — 이도저도 아님.

### Option 3 — 단일 database + schema 분리 + 5중 방어선 ★ (채택)

한 `postgres` database 안에 앱마다 schema (`sumtally`, `rny` 등) 를 두고, Postgres RBAC + 애플리케이션 레벨 경계를 **5중** 으로 설정.

- **장점**:
  - **Supabase 와 궁합 최적** — 대시보드 · Auth · 백업이 그대로 동작
  - **운영 단위 1 유지** — 모든 앱이 한 인스턴스이므로 모니터링/백업/튜닝 통합
  - **schema 분리만으로도 충분한 격리** — 5중 방어선이 DB 레벨 + 애플리케이션 레벨로 이중 벽
  - **앱 추가 비용 = schema 하나 + role 하나** — `new-app.sh <slug>` 한 줄
  - **미래 이전 경로 존재** — 특정 앱만 떼어내야 하면 `pg_dump -n <slug>` 로 해당 schema 만 추출
- **단점**:
  - 한 Postgres 인스턴스 장애 시 모든 앱 동반 다운 (Supabase SLA 에 의존)
  - schema 격리는 database 격리보다 논리적으로 약함 — 애플리케이션/role 실수로 cross-schema 접근이 이론적으로 가능
- **채택 이유**:
  - Supabase 전제와 정합
  - 5중 방어선으로 schema 격리의 약점을 보완
  - 솔로 운영 부담 최소 + 앱 추가 비용 제로에 가까움
  - 장애 동반성 리스크는 Supabase 가 관리형으로 감당 (99% SLA 충분, [제약 1](./README.md#제약-1--운영-가능성이-최우선) 비목표)

## 결정

한 `postgres` database 안에서 앱마다 전용 schema 를 갖고, 다음 5중 방어선으로 격리합니다.

### 구조

```
postgres (database)
├── core schema                     ← 템플릿 기준선 (core_app role)
│   ├── users, social_identities    ← 참조용 / 레거시
│   ├── refresh_tokens 등
│   └── flyway_schema_history       ← core 마이그레이션 전용
├── <slug> schema                   ← 각 앱 schema (<slug>_app role)
│   ├── users                       ← 앱 독립 유저 (ADR-012)
│   ├── 인증 관련 테이블 6개         ← V001~V006
│   ├── <도메인 테이블>              ← budget_groups, asset_groups 등
│   └── flyway_schema_history       ← 앱 마이그레이션 전용
└── public schema                   ← 건드리지 않음 (Supabase 기본)
```

### 방어선 1 — DB role 분리

각 schema 에 전용 role 이 매핑됩니다. 자기 schema 외 접근은 **DB 레벨에서 permission denied**.

```sql
-- infra/scripts/init-app-schema.sql 발췌
CREATE SCHEMA IF NOT EXISTS ${APP_SLUG};
CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}';

GRANT USAGE, CREATE ON SCHEMA ${APP_SLUG} TO ${APP_ROLE};
GRANT ALL ON ALL TABLES IN SCHEMA ${APP_SLUG} TO ${APP_ROLE};
GRANT ALL ON ALL SEQUENCES IN SCHEMA ${APP_SLUG} TO ${APP_ROLE};

ALTER DEFAULT PRIVILEGES IN SCHEMA ${APP_SLUG}
    GRANT ALL ON TABLES TO ${APP_ROLE};

-- 5중 방어선의 핵심: public schema 접근 원천 차단
REVOKE ALL ON SCHEMA public FROM ${APP_ROLE};
```

role 명 패턴: `<slug>_app` (예: `sumtally_app`). Supabase 프로덕션도 동일 스크립트 실행.

### 방어선 2 — Spring DataSource 분리

앱 모듈마다 `<Slug>DataSourceConfig` bean 을 별도로 가집니다. HikariCP 풀이 앱별로 독립.

```java
// common-persistence/AbstractAppDataSourceConfig.java 발췌
protected DataSource buildDataSource(String url, String user, String pw) {
    HikariConfig cfg = new HikariConfig();
    cfg.setJdbcUrl(url);
    cfg.setUsername(user);
    cfg.setPassword(pw);
    cfg.setMaximumPoolSize(10);
    cfg.setPoolName(slug + "-pool");
    return new HikariDataSource(cfg);
}

// Hibernate 가 이 DataSource 로 접근하는 schema 를 명시
properties.put("hibernate.default_schema", slug);
```

한 앱이 커넥션을 고갈시켜도 다른 앱의 풀은 영향 없음.

### 방어선 3 — Flyway 마이그레이션 분리

각 앱의 Flyway 는 **자기 schema 에만** 마이그레이션 적용. 히스토리 테이블도 schema 별 분리.

```java
// AbstractAppDataSourceConfig.java 발췌
Flyway.configure()
    .dataSource(dataSource)
    .schemas(slug)
    .locations("classpath:db/migration/" + slug)
    .load();
```

마이그레이션 파일 경로: `apps/app-<slug>/src/main/resources/db/migration/<slug>/V001__*.sql`. 다른 앱의 마이그레이션 파일을 **경로상으로도** 분리.

### 방어선 4 — 포트 인터페이스 의존 ([ADR-003](./adr-003-api-impl-split.md))

앱 모듈은 자기 schema 의 엔티티만 소유합니다. 다른 앱의 데이터가 필요하면 **포트(api 모듈 인터페이스)** 를 통해 DTO 로만 받음. Entity 직접 참조 금지.

### 방어선 5 — ArchUnit 규칙 ([ADR-004](./adr-004-gradle-archunit.md))

r2 · r3 · r11 이 schema 격리를 기계적으로 강제합니다.

- **r2** `APPS_MUST_NOT_DEPEND_ON_EACH_OTHER` — 앱 모듈 간 import 금지
- **r3** `CORE_IMPL_MUST_NOT_DEPEND_ON_EACH_OTHER` — core impl 간 의존 금지
- **r11** `PORT_METHODS_MUST_NOT_EXPOSE_ENTITIES` — 포트가 Entity 타입 노출 금지

컴파일 타임에 잡히므로 사람 실수가 빌드를 깨뜨립니다.

### `new-app.sh` 가 묶어주는 자동화

`./tools/new-app/new-app.sh <slug>` 한 줄이 5중 방어선 중 **4개** 를 자동 생성합니다 (방어선 5 는 공용 규칙이라 추가 생성 없음).

1. `init-app-schema.sql` 실행 → **방어선 1** (schema + role) 생성
2. `<Slug>DataSourceConfig.java` 생성 → **방어선 2** (DataSource bean)
3. `V001__init_users.sql` ~ `V006__init_devices.sql` 템플릿 생성 → **방어선 3** (Flyway 경로)
4. `<Slug>AppAutoConfiguration` 생성 → 앱 모듈이 포트 의존만 허용하도록 스캐폴드 → **방어선 4** 준비

## 이 선택이 가져온 것

### 긍정적 결과

**앱 추가 비용이 거의 제로** — `./tools/new-app/new-app.sh sumtally` 한 줄로 schema · role · DataSource · 6개 마이그레이션 + AuthController · AutoConfiguration 까지 셋업. 솔로 운영자가 새 앱 착수 시 **DB 셋업 시간 5분 미만**.

**Supabase 관리형 이점 그대로** — 백업, 대시보드, Auth, Storage 가 전부 `postgres` database 에 의존하므로 schema 만 추가해도 관리형 UX 그대로.

**운영 모니터링 통합** — 한 Supabase 프로젝트의 metrics 로 모든 앱의 커넥션 · 쿼리 · 용량을 확인. 앱별 메트릭은 `pool.name` 태그로 구분 (pool name = `<slug>-pool`).

**격리 실패 시 즉시 검출** — 방어선 1 (role) 이 첫 번째로 실패를 차단. 개발 중 cross-schema 실수가 나와도 "permission denied" 에러가 즉시 남음. 은밀하게 잘못된 데이터가 흘러갈 일 없음.

### 부정적 결과

**Postgres 인스턴스 장애가 전사 장애** — 한 Supabase 프로젝트 다운 = 모든 앱 다운. 완화: Supabase 의 관리형 SLA 에 의존 ([제약 1](./README.md#제약-1--운영-가능성이-최우선) 비목표 - 99.99% 불필요). 실제 사용 기간 중 Supabase 다운 빈도는 월 1회 이내 · 수분 단위로 집계됨.

**schema 간 트랜잭션 불가** — 한 앱이 다른 앱의 테이블을 같은 트랜잭션에서 조작하는 건 불가능. 완화: 애초에 ADR 의 의도 — 앱은 **독립** 이라야 함. 크로스 앱 데이터는 포트 호출 (비동기 경계) 로만.

**schema 격리는 database 격리보다 논리적으로 약함** — role 설정 실수로 `GRANT ALL` 을 잘못 주면 경계가 무너짐. 완화: `init-app-schema.sql` 을 **스크립트로 표준화**. 사람이 직접 GRANT 를 쓰지 않음.

### 이전 경로 존재 — "감당 가능성" 근거

"미래에 앱 하나가 진짜 독립 운영이 필요해지면?" — 그 시점이 오면 `pg_dump -n <slug>` 한 줄로 해당 schema 만 추출해서 별도 Postgres 인스턴스로 옮길 수 있어요. 즉 **현재의 schema 분리 방식은 미래 database/인스턴스 분리로 가는 마이그레이션 경로** 가 막혀 있지 않음.

이 점이 결정의 근거 중 하나였어요. "지금 단순함을 선택해도 미래 옵션이 닫히지 않는다" 가 확인되면 단순한 쪽을 선택하는 게 [제약 2](./README.md#제약-2--시간이-가장-희소한-자원) 에 부합.

## 교훈

### public schema 접근 차단은 명시적으로 할 것

초기에는 role 을 만들고 자기 schema 에만 GRANT 주면 충분하다고 생각했어요. 하지만 Postgres 는 **기본적으로 모든 role 에게 `public` schema 의 `CREATE` 권한을 줍니다** (PostgreSQL < 15 기준). 그래서 앱 role 이 `public` schema 에 테이블을 만들 수 있었고, 이게 나중에 데이터 오염으로 이어질 뻔했어요.

```sql
-- 필수 한 줄
REVOKE ALL ON SCHEMA public FROM <app_role>;
```

**교훈**: RBAC 는 "허용된 것만 준다" 가 아니라 "기본 허용 + 선별적 회수" 로 동작할 수 있다. Postgres 의 default privileges 를 반드시 명시 회수해야 경계가 완성된다.

### Hibernate `default_schema` 설정을 빠뜨리지 말 것

DataSource 만 schema 별 user 로 연결해도, Hibernate 는 여전히 `public.users` 같은 완전 한정 이름을 생성하려 할 수 있습니다. 이 경우 permission denied 가 발생하거나, 최악의 경우 search_path 에 들어있던 다른 schema 의 테이블에 접근.

```java
properties.put("hibernate.default_schema", slug);
```

이 한 줄이 없으면 방어선 2 가 무너집니다. **교훈**: DataSource 격리와 ORM 매핑의 schema 설정은 **분리된 두 가지 단계**. 둘 다 명시해야 안전.

### schema 당 Flyway 히스토리 분리의 중요성

Flyway 가 기본적으로 `flyway_schema_history` 를 한 개만 만들려 하므로, 여러 앱의 마이그레이션 이력이 섞일 수 있어요. `schemas(slug)` 설정으로 **schema 별 독립 히스토리** 를 만드는 게 필수.

**교훈**: 격리는 "데이터" 만이 아니라 "마이그레이션 이력" 까지 분리되어야 완성. 한 앱의 migration 실패가 다른 앱 이력에 영향 주면 롤백 시 혼란.

## 관련 사례 (Prior Art)

- **[PostgreSQL Documentation · Schema Search Path](https://www.postgresql.org/docs/current/ddl-schemas.html)** — `search_path`, `CREATE SCHEMA`, role-schema 매핑의 공식 레퍼런스.
- **[Supabase Docs · Database Schemas](https://supabase.com/docs/guides/database/overview)** — Supabase 가 `postgres` database 단일 구조를 전제로 설계되었다는 공식 명시.
- **Multi-tenancy patterns — "Database per Tenant / Schema per Tenant / Shared Schema"** — SaaS 멀티테넌시 3대 패턴. 본 ADR 은 중간안인 "Schema per Tenant" 채택. 참고: [AWS · SaaS Lens](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/silo-pool-and-bridge-models.html).
- **Django `django-tenant-schemas`, Ruby `apartment` gem** — 같은 아이디어의 다른 생태계 구현. 본 ADR 은 라이브러리 없이 Spring + HikariCP + Flyway 만으로 동일 효과.
- **Hibernate Multi-Tenancy (`SCHEMA` strategy)** — `AbstractMultiTenantConnectionProvider` 를 쓰는 방식. 우리는 이 추상화 대신 **bean 당 DataSource** 로 정적 분리 — [ADR-012](./adr-012-per-app-user-model.md) 에서 이 대비를 깊이 다룸.

## Code References

**방어선 1 — schema / role 초기화 스크립트**:
- [`infra/scripts/init-app-schema.sql`](https://github.com/storkspear/spring-backend-template/blob/main/infra/scripts/init-app-schema.sql) — 앱별 schema + role 생성, public schema 접근 차단
- [`infra/scripts/init-core-schema.sql`](https://github.com/storkspear/spring-backend-template/blob/main/infra/scripts/init-core-schema.sql) — core schema + core_app role

**방어선 2 — DataSource / HikariCP 분리**:
- [`AbstractAppDataSourceConfig.java`](https://github.com/storkspear/spring-backend-template/blob/main/common/common-persistence/src/main/java/com/factory/common/persistence/AbstractAppDataSourceConfig.java) — 공통 DataSource / EntityManager / Flyway 빌더
- [`CoreDataSourceConfig.java`](https://github.com/storkspear/spring-backend-template/blob/main/bootstrap/src/main/java/com/factory/bootstrap/config/CoreDataSourceConfig.java) — core schema bean (`@Primary`)

**방어선 3 — Flyway 마이그레이션**:
- [`core/core-user-impl/src/main/resources/db/migration/core/`](https://github.com/storkspear/spring-backend-template/tree/main/core/core-user-impl/src/main/resources/db/migration/core) — core schema 마이그레이션
- [`tools/new-app/new-app.sh` L438-530](https://github.com/storkspear/spring-backend-template/blob/main/tools/new-app/new-app.sh#L438-L530) — V001~V006 템플릿 자동 생성

**방어선 4, 5 — 포트 + ArchUnit**:
- [ADR-003 · `-api` / `-impl` 분리](./adr-003-api-impl-split.md) — 방어선 4 의 근거
- [ADR-004 · Gradle + ArchUnit](./adr-004-gradle-archunit.md) — r2, r3, r11 규칙

**자동화**:
- [`tools/new-app/new-app.sh`](https://github.com/storkspear/spring-backend-template/blob/main/tools/new-app/new-app.sh) — 앱 한 개 스캐폴딩 전체
- [`docs/reference/app-scaffolding.md`](../start/app-scaffolding.md) — 스크립트 사용법 / 옵션

**설정 파일**:
- [`bootstrap/src/main/resources/application-dev.yml`](https://github.com/storkspear/spring-backend-template/blob/main/bootstrap/src/main/resources/application-dev.yml) — dev Postgres 연결 (`jdbc:postgresql://localhost:5433/postgres?currentSchema=core`)
- [`infra/docker-compose.dev.yml`](https://github.com/storkspear/spring-backend-template/blob/main/infra/docker-compose.dev.yml) — 로컬 Postgres 16 셋업
