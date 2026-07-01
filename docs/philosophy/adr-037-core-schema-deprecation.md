# ADR-037 · core schema + coreDataSource Bean 폐기

**Status**: Accepted. `bootstrap/RoutingDataSourceConfig.java` (신규) + `common-persistence/SchemaRoutingDataSource.fail-secure` 로 구현. `core` schema 자체가 PostgreSQL 에 없으며 `coreDataSource` Bean 도 사라졌습니다.

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~5분

> **테이블 리네임 (2026-07-01)**: 본 ADR 의 비교 표에서 `refresh_tokens` 는 현재 `auth_refresh_tokens` 로 리네임됐어요. 아래 본문은 결정 당시 이름을 보존합니다.

## 결론부터

`core` schema 와 `coreDataSource` Bean 을 폐기합니다. 각 app 의 users·auth·device table 은 app schema 안에 V001~V0xx 로 생성하며 V007 에 admin 시드가 포함됩니다. `core/core-*-impl` 의 Java 코드(entity·repository·service·controller)는 library 역할로 유지합니다 — 각 app DataSource 의 `entityPackagesToScan()` 에 포함되어 app schema 의 동일 table 에서 동작합니다.

`SchemaRoutingDataSource.determineCurrentLookupKey()` 는 slug 가 null 이면 fail-secure 로 `IllegalStateException` 을 던집니다. 비인증 endpoint(actuator·health)는 DB 접근이 없으니 무관하고, 인증 endpoint 는 AppSlugMdcFilter 가 JWT 의 appSlug 또는 path 에서 slug 를 추출해 routing 이 정상 동작합니다.

## 왜 이런 고민이 시작됐나?

ADR-005(schema-isolation)와 ADR-012(per-app user model) 시점에 core schema 가 cross-app 공통 데이터 보관소로 설계됐어요. 그런데 ADR-012 의 per-app 격리 결정 후 core schema 의 V001~V008(users·auth·device 등)이 각 app schema 에도 중복 생성됐어요 — `core.users` 와 `apple.users` 가 둘 다 존재. 런타임 traffic 의 99%+ 는 AppSlugMdcFilter 가 JWT 의 appSlug 를 추출하고 SchemaRoutingDataSource 가 app DataSource 로 routing 하므로, core 는 거의 idle 했어요.

dogfooding cycle 에서 server-backend(apps/ 하위 watermelon 1개) 부팅 시 Hikari pool 이 core 10 + watermelon 10 = 20 connection 을 잡았어요. Supabase NANO compute 의 session pooler 한도(max_connections=60)에 도달해 `dev test` step 2 의 DB ping 이 `EMAXCONNSESSION` 으로 fail 했어요.

핵심 모순:
- ADR-005·012·013 = 각 app 격리 + per-app user
- 현실 구현 = `core.users` 가 legacy 잔재 + `coreDataSource` Bean 의 9 idle connection 영구 낭비

## 결정

### 1. core schema 자체 제거

PostgreSQL 에서 `core` schema 가 생성되지 않게 합니다.

- `core/core-*-impl/src/main/resources/db/migration/core/V*.sql` 의 production migration 7개 삭제 (`core-user-impl` V001~V003, `core-auth-impl` V005~V007, `core-device-impl` V008)
- `CoreDataSourceConfig.java` 완전 삭제 — `coreDataSource` Bean 과 `coreFlyway` Bean 이 사라짐
- `application-*.yml`·`.env.*.example`·`infra/docker-spring-local-entrypoint.sh` 에서 `currentSchema=core` 제거

### 2. routing + JPA 통합 layer 분리 (`RoutingDataSourceConfig` 신규)

`CoreDataSourceConfig` 가 정의했던 3개 Primary Bean 을 `RoutingDataSourceConfig.java` 로 분리합니다. 세 Bean 은 routing `dataSource`·`entityManagerFactory`·`transactionManager` 이고, `flyway` Bean 만 폐기합니다.

```java
@Configuration
public class RoutingDataSourceConfig {
    @Primary @Bean(name = "dataSource")
    public DataSource dataSource(Map<String, DataSource> allDataSources) {
        // <slug>DataSource 모두 routing target 등록. core 제외.
        // setDefaultTargetDataSource 미설정 → slug null → fail-secure
    }
    // entityManagerFactory + transactionManager 도 같이
}
```

### 3. SchemaRoutingDataSource fail-secure

```java
@Override
protected Object determineCurrentLookupKey() {
    String slug = SlugContext.get();
    if (slug == null) {
        throw new IllegalStateException("SlugContext not set — ...");
    }
    return slug.replace("-", "");
}
```

기존 `slug != null ? slug : "core"` fallback 을 폐기합니다. 비인증 endpoint(actuator·health)는 Spring Security 의 permitAll 로 처리되고 DB 에 접근하지 않습니다. 인증 endpoint 는 AppSlugMdcFilter 가 JWT 의 `appSlug` 또는 `/api/apps/{slug}/...` path 에서 slug 를 추출합니다.

### 4. EMF/TM static builder 추출 (RoutingDataSourceConfig 가 instance 의존 없이 호출 가능)

`AbstractAppDataSourceConfig.buildEntityManagerFactory(DataSource, String[], String)` 와 `buildTransactionManager0(EntityManagerFactory)` 를 public static 으로 추가합니다. 자식 config(CoreDataSourceConfig 폐기 후의 WatermelonDataSourceConfig 등)는 그대로 instance method 를 씁니다.

### 5. multi-tenant `dbHealthContributor` (routing 우회)

Spring Boot 의 `DataSourceHealthContributorAutoConfiguration` 은 default 로 Primary dataSource(routing)를 쓰는데, 이 경로는 fail-secure 때문에 readiness 가 OUT_OF_SERVICE 가 됩니다. 우리 `@Bean(name = "dbHealthContributor")` 가 이를 override 해 각 `<slug>DataSource` 를 직접 ping 합니다:

```java
@Bean(name = "dbHealthContributor")
public HealthContributor dbHealthContributor(Map<String, DataSource> allDataSources) {
    Map<String, HealthContributor> contributors = new LinkedHashMap<>();
    allDataSources.forEach((beanName, ds) -> {
        if (beanName.endsWith("DataSource") && !beanName.equals("dataSource")) {
            String slug = beanName.substring(0, beanName.length() - "DataSource".length());
            contributors.put(slug, new DataSourceHealthIndicator(ds, "SELECT 1"));
        }
    });
    return CompositeHealthContributor.fromMap(contributors);
}
```

### 6. `BucketProvisioner` virtual thread spawn

`@EventListener(ApplicationReadyEvent.class)` 안에서 MinIO endpoint reach timeout 이 sync EventListener queue 를 block 하면, Spring Boot 의 ApplicationAvailabilityBean 이 `ReadinessState.ACCEPTING_TRAFFIC` 를 publish 하지 못합니다. JDK 21 virtual thread 로 분리합니다:

```java
@EventListener(ApplicationReadyEvent.class)
public void onApplicationReady() {
    Thread.startVirtualThread(this::provision);
}
```

### 7. Hikari `DEFAULT_POOL_SIZE = 10 → 5`

`AbstractAppDataSourceConfig.DEFAULT_POOL_SIZE`. Supabase NANO 의 session pooler(port 5432)는 client 1개에 server backend 1개를 dedicated 하므로, Hikari max=10 × N app 이면 NANO 60 한도에 빠르게 도달합니다. **max=5 로 줄여 4~5 app 마진을 확보**했고, dev·prod 환경에 일관 적용합니다.

## 효과

| 측면 | Before | After |
|---|---|---|
| PostgreSQL `core` schema | 존재 | **없음** |
| `coreDataSource` Bean | 10 idle connection 영구 | 폐기 |
| `core.users / .refresh_tokens / ...` (V001~V008) | core schema 에 중복 | 각 app schema 만 |
| `SchemaRoutingDataSource` fallback | `core` (silent) | fail-secure exception |
| `db` health indicator | routing → fail-secure → DOWN | `<slug>` 별 직접 ping → UP |
| `readinessState` | `ApplicationReadyEvent` block 시 OUT | virtual thread 로 sync 해소 → UP |
| Hikari pool default | 10 | 5 (4~5 app 마진) |
| 인증 endpoint slug 없는 경우 | core fallback (silent 데이터 누수 위험) | fail-secure (configuration 오류 명시) |

## 영향 받는 ADR

`Updated by ADR-037`:
- **ADR-005** (db-schema-isolation) — 5중 방어선 중 core schema 부분 제거
- **ADR-012** (per-app user model) — core 의 users 가 legacy 였다는 부분 정확화
- **ADR-013** (per-app auth endpoints) — core 의 auth 폐기
- **ADR-018** (SchemaRoutingDataSource) — core fallback 을 fail-secure 로 변경
- **ADR-020** (billing domain model) — core schema 의 billing 언급 제거
- **ADR-033** (Flyway hybrid policy) — core schema 의 Flyway 폐기

## 트레이드오프

### Pro

- core schema 자체가 없으니 N app scale 시 connection 폭증을 회피해요
- fail-secure routing 으로 데이터 누수 위험이 0 이에요 — silent core fallback 폐기
- 각 app entity 가 core entity 와 동일 table 을 쓰므로 코드를 재사용해요 (core/core-*-impl 가 library 역할)

### Con

- 비인증 endpoint 가 DB 접근을 시도하면 fail-secure exception 이 나요. 다만 비인증 endpoint 는 actuator·health 뿐이고 이들은 DB 에 접근하지 않으니 영향이 없어요
- 기존 운영 환경에 core schema 데이터가 있으면 DROP CASCADE 가 필요해요. 구축 단계라 데이터를 보존하지 않기로 도그푸딩 cycle 에서 결정했어요
- template-spring 자체(apps 0개)는 부팅 불가이고, 파생 레포(new-app 1개 이상)에서만 부팅해요. bootstrap 의 통합 test 3개(FactoryApplicationTests·FeatureToggleTest·HealthEndpointsTest)는 `@Disabled` 이고 ArchUnit 만 활성이에요

## Code References

- `bootstrap/src/main/java/com/factory/bootstrap/config/RoutingDataSourceConfig.java` (신규, line 1~127)
- `common/common-persistence/src/main/java/com/factory/common/persistence/SchemaRoutingDataSource.java:41-58` (fail-secure)
- `common/common-persistence/src/main/java/com/factory/common/persistence/AbstractAppDataSourceConfig.java:74` (DEFAULT_POOL_SIZE = 5), `:186-209` (static EMF/TM builder)
- `core/core-storage-impl/src/main/java/com/factory/core/storage/impl/BucketProvisioner.java:33-40` (virtual thread)
- `common/common-security/src/main/java/com/factory/common/security/AppSlugMdcFilter.java:23-26` (slug 추출 fail-secure 문맥)

## 후속

본 cycle 에서 임시 fix 한 것:
- `application-dev.yml` 의 `management.endpoint.health.show-details: always` — 진단용. 안정화 후 base `application.yml` 의 `never` 로 복귀 권장
- `.env.dev.example`·`.env.prod.example` 의 DB_URL 가이드 — transaction mode(port 6543) 권장 명시. Flyway 충돌 때문에 runtime DataSource 만 transaction mode 를 쓰고 Flyway 는 session/direct 로 분리해야 함

별도 cycle 후보:
- Flyway 와 runtime DataSource 분리 — `AbstractAppDataSourceConfig.buildFlyway` 가 session-mode 별도 DataSource 를 써서, transaction pooler 채택과 Flyway 호환을 양립
- `BucketProvisioner` 에 `@EnableAsync` + `@Async` 정식 적용 (현재 virtual thread spawn 은 간이 해결)
- `init-dev.sh`·`init-prod.sh` 에서 DB_URL 이 port 5432(session pooler)일 때 경고 — Supabase 콘솔의 Session pooler string 을 그대로 복사하는 함정 방지
