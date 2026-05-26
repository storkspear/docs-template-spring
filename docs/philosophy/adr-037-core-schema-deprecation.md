# ADR-037 · core schema + coreDataSource Bean 폐기

**Status**: Accepted. `bootstrap/RoutingDataSourceConfig.java` (신규) + `common-persistence/SchemaRoutingDataSource.fail-secure` 로 구현. `core` schema 자체가 PostgreSQL 에 없으며 `coreDataSource` Bean 도 사라졌습니다.

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~5분

## 결론부터

`core` schema 와 `coreDataSource` Bean 을 폐기합니다. 각 app 의 `users/auth/device` table 은 *app schema 안에 V001~V0xx 로 생성* (V007 admin 시드 포함). `core/core-*-impl` 의 Java 코드 (entity / repository / service / controller) 는 *library 역할* 로 *유지* — 각 app DataSource 의 `entityPackagesToScan()` 에 포함되어 *app schema 의 동일 table 에서 동작*.

`SchemaRoutingDataSource.determineCurrentLookupKey()` 는 slug null 시 *fail-secure (IllegalStateException)* — 비인증 endpoint (actuator / health) 는 DB 접근 없으니 무관, *인증 endpoint 는 AppSlugMdcFilter 가 JWT 의 appSlug 또는 path 에서 slug 추출* → routing 정상.

## 왜 이런 고민이 시작됐나?

ADR-005 (schema-isolation) + ADR-012 (per-app user model) 시점에 *core schema* 가 *cross-app 공통 데이터 보관소* 로 설계됐어요. 그런데 ADR-012 의 *per-app 격리* 결정 후 *core schema 의 *V001~V008 (users/auth/device 등)* 이 *각 app schema 에도 중복 생성* — `core.users` 와 `apple.users` 가 *둘 다 존재*. 런타임 traffic 의 99%+ 는 *AppSlugMdcFilter 가 JWT 의 appSlug 추출 → SchemaRoutingDataSource 가 app DataSource 로 routing* — core 거의 idle.

dogfooding cycle 에서 *server-backend (apps/ 하위 watermelon 1개)* 부팅 시 *Hikari pool 이 *core 10 + watermelon 10 = 20 connection* 잡음* — Supabase NANO compute (max_connections=60) 의 session pooler 한도 도달, `dev test` step 2 (DB ping) `EMAXCONNSESSION` fail.

핵심 모순:
- ADR-005/012/013 = 각 app 격리 + per-app user
- 현실 구현 = `core.users` 가 *legacy 잔재* + `coreDataSource` Bean 의 *9 idle connection 영구 낭비*

## 결정

### 1. core schema 자체 제거

PostgreSQL 에서 `core` schema 가 생성되지 않게 합니다.

- `core/core-*-impl/src/main/resources/db/migration/core/V*.sql` *7개 production migration 삭제* (`core-user-impl` V001~V003, `core-auth-impl` V005~V007, `core-device-impl` V008)
- `CoreDataSourceConfig.java` *완전 삭제* — `coreDataSource` Bean + `coreFlyway` Bean 사라짐
- `application-*.yml` / `.env.*.example` / `infra/docker-spring-local-entrypoint.sh` 에서 `currentSchema=core` 제거

### 2. routing + JPA 통합 layer 분리 (`RoutingDataSourceConfig` 신규)

`CoreDataSourceConfig` 가 정의했던 *3 Primary Bean (dataSource = routing + entityManagerFactory + transactionManager)* 을 `RoutingDataSourceConfig.java` 로 분리. `flyway` Bean 만 폐기.

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

기존 `slug != null ? slug : "core"` fallback 폐기. 비인증 endpoint (actuator / health) 는 *Spring Security 의 permitAll + DB 접근 없음* 으로 처리. 인증 endpoint 는 *AppSlugMdcFilter* 가 *JWT 의 `appSlug` 또는 `/api/apps/{slug}/...` path* 에서 slug 추출.

### 4. EMF/TM static builder 추출 (RoutingDataSourceConfig 가 instance 의존 없이 호출 가능)

`AbstractAppDataSourceConfig.buildEntityManagerFactory(DataSource, String[], String)` + `buildTransactionManager0(EntityManagerFactory)` *public static* 추가. 자식 (CoreDataSourceConfig 폐기 후 WatermelonDataSourceConfig 같은) 은 그대로 instance method 사용.

### 5. multi-tenant `dbHealthContributor` (routing 우회)

Spring Boot 의 `DataSourceHealthContributorAutoConfiguration` 의 default 가 *Primary dataSource (routing)* 사용 → fail-secure → readiness OUT_OF_SERVICE. 우리 `@Bean(name = "dbHealthContributor")` 가 override — *각 `<slug>DataSource` 직접 ping*:

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

`@EventListener(ApplicationReadyEvent.class)` 안에서 *MinIO endpoint reach timeout* 이 sync EventListener queue 를 block 하면 Spring Boot 의 *ApplicationAvailabilityBean* 이 `ReadinessState.ACCEPTING_TRAFFIC` publish 못 함. JDK 21 virtual thread 로 분리:

```java
@EventListener(ApplicationReadyEvent.class)
public void onApplicationReady() {
    Thread.startVirtualThread(this::provision);
}
```

### 7. Hikari `DEFAULT_POOL_SIZE = 10 → 5`

`AbstractAppDataSourceConfig.DEFAULT_POOL_SIZE`. Supabase NANO 의 *session pooler (port 5432)* 가 *client 1 = server backend 1 dedicated* — *Hikari max=10 × N app = NANO 60 한도 빠르게 도달*. **max=5 로 줄여서 *4~5 app 마진* 확보** (dev/prod 환경 일관).

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
- **ADR-005** (db-schema-isolation) — 5중 방어선 중 *core schema* 부분 제거
- **ADR-012** (per-app user model) — *core 의 users* 가 *legacy* 였다는 부분 정확화
- **ADR-013** (per-app auth endpoints) — *core 의 auth* 폐기
- **ADR-018** (SchemaRoutingDataSource) — *core fallback* → fail-secure 로 변경
- **ADR-020** (billing domain model) — *core schema 의 billing* 언급 제거
- **ADR-033** (Flyway hybrid policy) — *core schema 의 Flyway* 폐기

## 트레이드오프

### Pro

- *core schema 자체 없음* → *N app scale 시 connection 폭증 회피*
- *fail-secure routing* → *데이터 누수 위험 0* (silent core fallback 폐기)
- *각 app entity 가 *core entity 와 동일 table* — 코드 재사용 (core/core-*-impl 가 *library*)

### Con

- *비인증 endpoint 가 DB 접근 시도 시 fail-secure exception* — 단 *비인증 endpoint = actuator / health 만* 이라 영향 X (DB 접근 안 함)
- *기존 운영 환경의 *core schema 데이터* 가 있으면 *DROP CASCADE 필요* — *구축 단계라 데이터 보존 X* (도그푸딩 cycle 결정)
- *template-spring 자체* (apps 0개) *부팅 불가* — *파생 레포 (new-app 1개 이상)* 에서만 부팅. *bootstrap 의 통합 test 3개 (FactoryApplicationTests / FeatureToggleTest / HealthEndpointsTest) @Disabled* — ArchUnit 만 활성

## Code References

- `bootstrap/src/main/java/com/factory/bootstrap/config/RoutingDataSourceConfig.java` (신규, line 1~127)
- `common/common-persistence/src/main/java/com/factory/common/persistence/SchemaRoutingDataSource.java:41-58` (fail-secure)
- `common/common-persistence/src/main/java/com/factory/common/persistence/AbstractAppDataSourceConfig.java:74` (DEFAULT_POOL_SIZE = 5), `:186-209` (static EMF/TM builder)
- `core/core-storage-impl/src/main/java/com/factory/core/storage/impl/BucketProvisioner.java:33-40` (virtual thread)
- `common/common-security/src/main/java/com/factory/common/security/AppSlugMdcFilter.java:23-26` (slug 추출 fail-secure 문맥)

## 후속

본 cycle 에서 *임시 fix* 한 것:
- `application-dev.yml` 의 `management.endpoint.health.show-details: always` — 진단용. 안정화 후 base `application.yml` 의 `never` 로 복귀 권장
- `.env.dev.example` / `.env.prod.example` 의 DB_URL 가이드 — transaction mode (port 6543) 권장 명시 (Flyway 충돌 때문에 *runtime DataSource 만 transaction mode + Flyway 는 session/direct* 분리 필요)

별도 cycle 후보:
- *Flyway 와 runtime DataSource 분리* (`AbstractAppDataSourceConfig.buildFlyway` 가 *session-mode 별도 DataSource* 사용) — *transaction pooler 채택 + Flyway 호환 양립*
- *`BucketProvisioner` 의 *@EnableAsync + @Async* 정식 적용* (현재 virtual thread spawn 은 *간이 해결*)
- *`init-dev.sh` / `init-prod.sh` 의 DB_URL port 5432 (session pooler) 사용 시 경고* — Supabase 콘솔의 *Session pooler string 그대로 복사* 함정 방지
