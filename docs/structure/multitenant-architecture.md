# Multi-tenant Architecture

> **유형**: Explanation · **독자**: Level 2 · **읽는 시간**: ~12분

**설계 근거**: [`ADR-005 · 단일 Postgres database + 앱당 schema`](../philosophy/adr-005-db-schema-isolation.md) · [`ADR-012 · 앱별 독립 유저 모델`](../philosophy/adr-012-per-app-user-model.md) · [`ADR-037 · core schema 폐기`](../philosophy/adr-037-core-schema-deprecation.md)

이 문서는 "앱별 독립 유저" 멀티테넌시를 PostgreSQL schema 격리로 구현하는 방식을 설명해요.

한 레포에서 여러 모바일 앱을 운영하되, 각 앱은 서로 유저 데이터를 공유하지 않습니다. `sumtally` 와 `gymlog` 처럼 앱마다 자기 schema 를 갖고, 같은 이메일로 두 앱에 각각 가입해도 둘은 완전히 별개의 계정이에요.

---

## 한 문장 요약

앱마다 PostgreSQL schema 를 하나씩 주고, 요청이 들어올 때 [`appSlug`](../reference/glossary.md#이-레포-고유-용어) 로 어느 schema 의 connection 을 쓸지 골라 격리해요. 핵심 부품은 세 가지입니다 — 앱별 DataSource 를 찍어내는 `AbstractAppDataSourceConfig`, slug 에 따라 connection 을 분기하는 `SchemaRoutingDataSource`, 그리고 그 slug 를 [`ThreadLocal`](../reference/glossary.md#데이터베이스) 에 실어 나르는 `SlugContext`.

---

## 1. 왜 per-app schema 인가

### 개념 — 한 장으로 보는 격리 흐름

요청 하나가 어떻게 자기 앱 schema 에만 닿는지를 먼저 그림으로 잡아요. 인증 단계에서 추출한 slug 가 connection 선택까지 한 줄로 이어지는 게 핵심이에요.

```text
HTTP 요청  /api/apps/gymlog/users/me   +   JWT(appSlug=gymlog)
   │
   ▼  AppSlugMdcFilter
SlugContext.set("gymlog")           ← ThreadLocal 에 slug 적재
   │
   ▼  Service → @Transactional → entityManagerFactory (단일)
SchemaRoutingDataSource
   │  determineCurrentLookupKey() → SlugContext.get() = "gymlog"
   ▼
gymlogDataSource (currentSchema=gymlog)  →  gymlog.users 로 라우팅
```

같은 `User` 엔티티 코드가, connection 이 가리키는 schema 에 따라 `gymlog.users` 가 되기도 하고 `sumtally.users` 가 되기도 해요. 엔티티는 schema 를 박지 않고, connection 의 `currentSchema` 가 그걸 결정합니다.

### 요구 조건

- 앱마다 유저 정책이 달라요. 소셜 로그인 provider, 비밀번호 정책, 탈퇴 처리 등이 앱별로 갈립니다.
- 한 앱의 유저가 다른 앱의 데이터에 접근하면 안 됩니다.
- 앱을 새로 추가해도 기존 앱의 테이블에 컬럼이 붙거나 쿼리가 복잡해지면 안 됩니다.
- 한 앱을 파생 레포로 추출할 때 유저 테이블을 통째로 떼어갈 수 있어야 해요.

### 선택지 비교

| 방식 | 장점 | 단점 |
|---|---|---|
| 단일 테이블 + `app_id` 컬럼 | schema 가 단순 | 모든 쿼리에 `WHERE app_id = ?` 필요, 실수 시 cross-app 누출 |
| 앱별 database | 완전 격리 | 운영 부담 — N배 인스턴스, backup, connection pool 관리 |
| 앱별 schema (채택) | 테이블 네임스페이스 격리, database 하나로 관리 | DataSource·EMF 다중 와이어링 필요 |

템플릿은 앱별 schema 를 채택했어요. PostgreSQL 의 schema 는 경량이고, 하나의 connection 으로 여러 schema 에 접근할 수 있고, role 과 grant 로 읽기·쓰기 권한을 schema 단위로 제어할 수 있습니다.

ADR-005 는 이 격리를 다섯 겹의 방어선으로 정리했어요. DB role · DataSource · Flyway · 포트 인터페이스 · ArchUnit 입니다. ADR-037 에서 core schema 가 폐기되면서 그중 core schema 관련 부분이 빠져, 지금은 애플리케이션 레벨 방어선이 한 겹 단순해진 형태예요. 자세한 갈래는 [§8](#8-new-app-운영-철학) 에서 다뤄요.

---

## 2. AbstractAppDataSourceConfig

`common-persistence` 의 `AbstractAppDataSourceConfig.java` 가 앱별 DataSource·JPA·Flyway 와이어링의 abstract 기반이에요. 각 앱 모듈은 이 클래스를 상속해서 자기 DataSource 빈을 등록합니다.

### 구성

자동 제공되는 빌더는 네 가지예요. 각 빌더는 호출할 때마다 새 인스턴스를 만들기 때문에, concrete 클래스가 `@Bean` 으로 감싸야 Spring 이 캐시해서 앱당 HikariCP pool 이 하나만 유지됩니다.

| 빌더 메서드 | 반환 | 설명 |
|---|---|---|
| `buildDataSource()` | `HikariDataSource` | Pool name `<slug>-pool`, 기본 size 5 |
| `buildEntityManagerFactory(ds)` | `LocalContainerEntityManagerFactoryBean` | persistence unit 이름 `<slug>`, core + 앱 엔티티 scan |
| `buildTransactionManager(emf)` | `JpaTransactionManager` | — |
| `buildFlyway(ds)` | `Flyway` | `.schemas(slug).locations("classpath:db/migration/<slug>")` |

### 핵심 구현

```java
// common-persistence/AbstractAppDataSourceConfig.java 발췌
protected DataSource buildDataSource() {
    HikariConfig config = new HikariConfig();
    config.setJdbcUrl(withPgBouncerSafeParams(url));
    config.setUsername(username);
    config.setPassword(password);
    config.setMaximumPoolSize(poolSize());   // 기본 DEFAULT_POOL_SIZE = 5
    config.setPoolName(slug + "-pool");
    return new HikariDataSource(config);
}

public static LocalContainerEntityManagerFactoryBean buildEntityManagerFactory(
        DataSource ds, String[] entityPackages, String persistenceUnitName) {
    LocalContainerEntityManagerFactoryBean emf = new LocalContainerEntityManagerFactoryBean();
    emf.setDataSource(ds);
    emf.setPackagesToScan(entityPackages);
    emf.setPersistenceUnitName(persistenceUnitName);
    emf.setJpaVendorAdapter(new HibernateJpaVendorAdapter());

    Properties props = new Properties();
    // hibernate.default_schema 는 의도적으로 설정하지 않음 — schema 결정은 connection 의
    // currentSchema (각 slug DataSource URL) 가 담당.
    props.setProperty("hibernate.hbm2ddl.auto", "none");
    props.setProperty("hibernate.dialect", "org.hibernate.dialect.PostgreSQLDialect");
    props.setProperty("hibernate.boot.allow_jdbc_metadata_access", "false");
    emf.setJpaProperties(props);
    return emf;
}
```

### schema 는 connection 이 결정해요

여기가 가장 헷갈리기 쉬운 지점이에요. Hibernate 에 `hibernate.default_schema` 를 박는 흔한 방식 대신, 템플릿은 그 속성을 **의도적으로 비워 둡니다.** 엔티티는 `@Table(name = "users")` 처럼 schema 없이 테이블 이름만 선언하고, 실제 schema 는 connection 의 search_path — 즉 각 앱 DataSource URL 의 `currentSchema=<slug>` 파라미터 — 가 정해요. `gymlog` connection 위에서 실행하면 `gymlog.users` 로, `sumtally` connection 위에서 실행하면 `sumtally.users` 로 같은 SQL 이 흘러가요.

> **왜 default_schema 를 안 쓰나요?** ADR-005 초기에는 `hibernate.default_schema=<slug>` 한 줄로 schema 를 박았어요. ADR-037 에서 core schema 가 사라지면서 EMF 가 부팅 시점에 특정 schema 에 고정될 수 없게 됐고 (slug 는 요청마다 ThreadLocal 로 들어오니까), schema 결정을 connection 쪽으로 옮겼습니다. 이 진화의 근거는 [`ADR-005`](../philosophy/adr-005-db-schema-isolation.md) 의 *교훈* 절과 [`ADR-018`](../philosophy/adr-018-schema-routing-datasource.md) 에 정리돼 있어요.

`hbm2ddl.auto` 는 `none` 이에요. schema 정합은 Flyway 의 `flyway_schema_history` 가 이미 보장하므로 Hibernate 가 부팅 시 다시 validate 하지 않아요. 운영 schema 와 엔티티의 sync 검증은 통합 테스트 (Testcontainers + slug 별 schema) 가 맡습니다. `hibernate.dialect` 를 명시하고 `allow_jdbc_metadata_access=false` 로 둔 이유는, 라우팅 EMF 가 부팅 시점에 어떤 slug 의 connection 도 못 잡는 상태에서도 dialect 를 결정할 수 있게 하기 위해서예요.

같은 논리로 Flyway 의 `.schemas(slug)` 는 해당 schema 에 `flyway_schema_history` 테이블을 만들고 마이그레이션 이력을 관리합니다. 각 앱의 Flyway 디렉토리는 독립적으로 관리돼요.

### slug 별 자격 자동 derive

`AbstractAppDataSourceConfig` 에는 7개 인자를 받는 생성자가 있어요. 앱의 `<SLUG>_DB_URL` 이 비어 있으면 core 의 `${DB_URL}` 에서 `currentSchema=` 부분만 slug 로 교체해 URL 을 만들고, USER 와 PASSWORD 는 core 자격을 그대로 재사용합니다. 운영을 단일 vendor (Supabase 등) + schema 분리로 돌릴 때, `.env.prod` 에 core 자격만 채우면 slug 별 자격을 일일이 적지 않아도 돼요.

```java
// 빈 값이면 core 의 DB_URL 에서 currentSchema=<slug> 로 자동 derive
this.url = isBlank(slugUrl) ? deriveSlugUrlOrEmpty(coreUrl, slug) : slugUrl;
this.username = isBlank(slugUsername) ? coreUsername : slugUsername;
this.password = isBlank(slugPassword) ? corePassword : slugPassword;
```

```bash
# .env.prod 의 slug 별 자격은 비워두면 derive 됨
GYMLOG_DB_URL=
GYMLOG_DB_USER=
GYMLOG_DB_PASSWORD=
```

도그푸딩 단계에서는 별도 role 분리가 필요 없으니 이 derive 패턴으로 시작하길 권장해요. 운영이 안정되면 slug 별 role 을 따로 두는 정책으로 옮겨갈 수 있습니다. 자세한 설계 근거는 [`ADR-018`](../philosophy/adr-018-schema-routing-datasource.md) 과 [`도그푸딩 walkthrough`](../start/dogfood-walkthrough.md) 를 참조하세요.

### Entity 스캔 패키지

```java
public static final String[] CORE_ENTITY_PACKAGES = {
    "com.factory.core.user.impl.entity",
    "com.factory.core.auth.impl.entity",
    "com.factory.core.device.impl.entity",
    "com.factory.core.audit.impl.entity",           // ADR-028 — AuditLog
    "com.factory.core.billing.impl.entity",         // ADR-019/020 — Plan, Subscription...
    "com.factory.core.billing.impl.notification",   // ADR-031 — NotificationSetting
    "com.factory.core.phoneauth.impl.entity",       // 휴대폰 점유인증 — AuthPhoneVerificationCode
    "com.factory.core.attachment.impl.entity",      // 첨부파일 — AttachmentFile
    "com.factory.core.content.impl.entity",         // 공유 게시물 — Post
    "com.factory.core.analytics.impl.entity",       // 제품 이벤트 — AnalyticsEvent
    "com.factory.common.persistence.entity"
};

protected String[] entityPackagesToScan() {
    // core 엔티티 + apps.<slug>.entity
    String[] withApp = new String[CORE_ENTITY_PACKAGES.length + 1];
    System.arraycopy(CORE_ENTITY_PACKAGES, 0, withApp, 0, CORE_ENTITY_PACKAGES.length);
    withApp[CORE_ENTITY_PACKAGES.length] = "com.factory.apps." + slug + ".entity";
    return withApp;
}
```

앱의 EMF 는 `core-*-impl` 에 정의된 공통 엔티티 (User, RefreshToken, Device, 결제·감사 엔티티 등) 와 `apps.<slug>.entity` 의 앱 고유 엔티티를 모두 스캔합니다. 엔티티 정의는 core 가 하고 DataSource 는 앱이 제공하는 형태예요. ADR-037 이후 core 는 schema 를 갖지 않는 라이브러리 역할만 하고, 그 엔티티들은 각 앱 schema 의 같은 테이블 위에서 동작합니다.

### Concrete subclass 가 지킬 계약

- 각 `build*` 헬퍼는 매번 새 인스턴스를 만드므로 반드시 `@Bean` 으로 래핑해 Spring 캐시를 활용해야 해요. 그래야 앱당 HikariCP pool 이 하나만 유지됩니다.
- Flyway 빈은 `@Bean(initMethod = "migrate")` 로 선언해야 해요. `buildFlyway()` 는 configure 만 하고 migrate 를 실행하지 않습니다.
- `@EnableJpaRepositories` 는 어노테이션 속성이 상속되지 않으므로 concrete 클래스에 직접 선언해야 해요.

---

## 3. Routing DataSource layer

`bootstrap` 모듈의 `RoutingDataSourceConfig.java` 가 routing + JPA 통합 layer 를 담당해요. ADR-037 이후 core schema · `coreDataSource` · `coreFlyway` 빈은 모두 폐기됐고, 이 Config 는 `SchemaRoutingDataSource` 가 모든 `<slug>DataSource` 빈을 자동 수집해 `SlugContext` 의 slug 로 connection 을 분기하도록 묶어 줍니다.

```java
// bootstrap/config/RoutingDataSourceConfig.java 발췌
@Configuration
public class RoutingDataSourceConfig {

    @Primary
    @Bean(name = "dataSource")
    public DataSource dataSource(Map<String, DataSource> allDataSources) {
        SchemaRoutingDataSource routing = new SchemaRoutingDataSource();
        Map<Object, Object> targets = new HashMap<>();
        allDataSources.forEach((beanName, ds) -> {
            // <slug>DataSource 이름 규약 → slug 키 추출 (자기 자신 dataSource 제외)
            if (beanName.endsWith("DataSource") && !beanName.equals("dataSource")) {
                String slug = beanName.substring(0, beanName.length() - "DataSource".length());
                targets.put(slug, ds);
            }
        });
        routing.setTargetDataSources(targets);
        // setDefaultTargetDataSource 미설정 → slug null → IllegalStateException (fail-secure)
        routing.afterPropertiesSet();
        return routing;
    }

    @Primary
    @Bean(name = "entityManagerFactory")
    public LocalContainerEntityManagerFactoryBean entityManagerFactory(
            @Qualifier("dataSource") DataSource ds) {
        return AbstractAppDataSourceConfig.buildEntityManagerFactory(
                ds, AbstractAppDataSourceConfig.CORE_ENTITY_PACKAGES, "routing");
    }

    @Primary
    @Bean(name = "transactionManager")
    public PlatformTransactionManager transactionManager(
            @Qualifier("entityManagerFactory") EntityManagerFactory emf) {
        return AbstractAppDataSourceConfig.buildTransactionManager0(emf);
    }

    // 멀티테넌트 dbHealthContributor — 각 <slug>DataSource 별 SELECT 1 (routing 우회)
    @Bean(name = "dbHealthContributor")
    public HealthContributor dbHealthContributor(Map<String, DataSource> allDataSources) { /* ... */ }
}
```

### `@Primary` 가 필요한 이유

`UserAutoConfiguration`, `AuthAutoConfiguration`, `DeviceAutoConfiguration` 의 `@EnableJpaRepositories` 는 `entityManagerFactoryRef` 없이 선언됩니다. 이 경우 Spring 은 기본 빈 이름 (`entityManagerFactory`, `transactionManager`) 으로 해결해요.

`RoutingDataSourceConfig` 의 `@Primary` EMF 와 TM 이 모든 core repository 의 기본 EMF·TM 로 작동하고, 각 앱 DataSource 는 routing target 으로만 등록됩니다. 그래서 core repository 가 현재 `SlugContext` slug 의 schema 에서 자동으로 동작해요. EMF 와 Flyway 의 초기화 순서는 Spring Boot 의 auto-config (`FlywayDependsOnPostProcessor`) 가 모든 `<slug>Flyway` 빈을 EMF dependency 로 자동 등록해 챙겨 줍니다.

### slug 없는 DB 접근은 fail-secure

`SchemaRoutingDataSource.determineCurrentLookupKey()` 는 `SlugContext.get()` 이 `null` 이면 `IllegalStateException` 을 던져요. ADR-037 이전의 silent `core` fallback 은 폐기됐습니다. slug 없이 DB 에 닿는 건 인증 누락이나 endpoint mapping 실수라는 뜻이라, 조용히 엉뚱한 schema 로 흘려보내는 대신 명시적으로 실패시키는 거예요.

비인증 endpoint (actuator, health) 는 DB 에 접근하지 않으니 무관하고, 인증 endpoint 는 `AppSlugMdcFilter` 가 JWT 의 `appSlug` 클레임 또는 `/api/apps/{slug}/...` path 에서 slug 를 뽑아 `SlugContext` 에 넣어 줍니다.

```java
// common-persistence/SchemaRoutingDataSource.java 발췌
@Override
protected Object determineCurrentLookupKey() {
    String slug = SlugContext.get();
    if (slug == null) {
        throw new IllegalStateException("SlugContext not set — ...");
    }
    return slug.replace("-", "");   // 하이픈 제거 — 빈 이름 매칭용
}
```

---

## 4. 앱별 DataSourceConfig 패턴

`new-app.sh` 가 앱을 추가할 때 자동 생성하는 `<SlugPascal>DataSourceConfig.java` 의 구조예요.

```java
@Configuration
@Profile("!test")
@EnableJpaRepositories(
    basePackages = "com.factory.apps.sumtally.repository",
    entityManagerFactoryRef = "sumtallyEntityManagerFactory",
    transactionManagerRef = "sumtallyTransactionManager"
)
public class SumtallyDataSourceConfig extends AbstractAppDataSourceConfig {

    public SumtallyDataSourceConfig(
        @Value("${SUMTALLY_DB_URL:}") String url,
        @Value("${SUMTALLY_DB_USER:}") String user,
        @Value("${SUMTALLY_DB_PASSWORD:}") String password,
        @Value("${DB_URL:}") String coreUrl,
        @Value("${DB_USER:}") String coreUser,
        @Value("${DB_PASSWORD:}") String corePassword
    ) {
        // SUMTALLY_DB_* 가 비면 core 의 DB_URL 에서 currentSchema=sumtally 로 자동 derive
        super("sumtally", url, user, password, coreUrl, coreUser, corePassword);
    }

    @Bean(name = "sumtallyDataSource")
    public DataSource sumtallyDataSource() {
        return buildDataSource();
    }

    @Bean(name = "sumtallyEntityManagerFactory")
    @DependsOn("sumtallyFlyway")  // Flyway 가 먼저 migrate → 테이블 생성 후 EMF
    public LocalContainerEntityManagerFactoryBean sumtallyEntityManagerFactory(
        @Qualifier("sumtallyDataSource") DataSource ds
    ) {
        return buildEntityManagerFactory(ds);
    }

    @Bean(name = "sumtallyTransactionManager")
    public PlatformTransactionManager sumtallyTransactionManager(
        @Qualifier("sumtallyEntityManagerFactory") EntityManagerFactory emf
    ) {
        return buildTransactionManager(emf);
    }

    @Bean(name = "sumtallyFlyway", initMethod = "migrate")
    public Flyway sumtallyFlyway(
        @Qualifier("sumtallyDataSource") DataSource ds
    ) {
        return buildFlyway(ds);
    }
}
```

> `@Profile("!test")` 가 함께 붙어 있어요. bootstrap test (Testcontainers 단일 DB) 환경에서 slug 모듈을 비활성화해서, slug 별 schema 가 없는 환경에서도 부팅이 되게 합니다. 같은 어노테이션이 `<Slug>AppAutoConfiguration` 에도 붙어 있어요.

### 빈 이름 규칙

| 역할 | 빈 이름 |
|---|---|
| DataSource | `<slug>DataSource` |
| EntityManagerFactory | `<slug>EntityManagerFactory` |
| TransactionManager | `<slug>TransactionManager` |
| Flyway | `<slug>Flyway` |

slug 에 하이픈이 있으면 (예: `my-app`) 빈 이름에서는 하이픈을 제거한 소문자 (`myapp`) 를 씁니다. `new-app.sh` 의 `SLUG_PACKAGE` 변환 규칙이에요.

### Repository scan 주의사항

앱 DataSourceConfig 의 `@EnableJpaRepositories` 는 앱 자기 패키지만 scan 해요 (`com.factory.apps.<slug>.repository`). core repository 는 이미 `UserAutoConfiguration`, `AuthAutoConfiguration`, `DeviceAutoConfiguration` 의 `@EnableJpaRepositories` 가 기본 EMF 에 등록했기 때문에, 여기서 core 패키지를 다시 scan 하면 `userRepository` 같은 빈이 `BeanDefinitionOverrideException` 으로 충돌합니다.

### Flyway 초기화 순서

`@DependsOn("<slug>Flyway")` 로 EMF 가 Flyway 보다 뒤에 초기화되도록 강제합니다. Flyway 가 먼저 migration 을 실행해서 테이블을 만들어 둬야, 그 schema 위에서 EMF 가 정상적으로 뜨고 첫 쿼리가 닿을 곳이 존재합니다.

---

## 5. 환경변수 규약

앱별 DB 접속 정보는 `<SLUG_UPPER>_DB_URL`, `<SLUG_UPPER>_DB_USER`, `<SLUG_UPPER>_DB_PASSWORD` 환경변수로 주입합니다.

```bash
# .env
SUMTALLY_DB_URL=jdbc:postgresql://localhost:5433/postgres?currentSchema=sumtally
SUMTALLY_DB_USER=sumtally_app
SUMTALLY_DB_PASSWORD=<실제 비밀번호>

GYMLOG_DB_URL=jdbc:postgresql://localhost:5433/postgres?currentSchema=gymlog
GYMLOG_DB_USER=gymlog_app
GYMLOG_DB_PASSWORD=<실제 비밀번호>
```

Role 이름은 `<slug_package>_app` 규칙이고, 각 role 은 자기 schema 에만 grant 를 받아요. `infra/scripts/init-app-schema.sql` 이 schema 생성·role 생성·grant 설정을 함께 처리하고, `new-app.sh` 가 기본 동작으로 이 스크립트를 psql 로 실행합니다 (`--skip-provision-db` 로 끌 수 있어요).

---

## 6. appSlug 검증 흐름

멀티테넌시의 격리를 실제로 강제하는 것은 인증·인가 레이어예요. JWT 의 `appSlug` 클레임과 URL path 의 slug 가 일치하지 않으면 요청을 차단합니다.

### JWT 클레임

`common-security` 의 `JwtService.issueAccessToken(userId, email, appSlug, role)` 이 발급하는 access token 에 `appSlug` 클레임이 들어가요. sumtally 로 로그인한 유저는 `appSlug=sumtally` 토큰을 받습니다.

### URL path 추출

```java
// common-web/AppSlugExtractor.java 발췌
private static final Pattern APP_SLUG_PATTERN =
        Pattern.compile("^/api/apps/([a-z][a-z0-9-]*)/");

public static String extract(String uri) {
    if (uri == null) {
        return null;
    }
    Matcher m = APP_SLUG_PATTERN.matcher(uri);
    return m.find() ? m.group(1) : null;
}
```

정규식은 `/api/apps/{slug}/...` 패턴에서 slug 를 뽑아요. slug 는 소문자·숫자·하이픈만 허용합니다.

### 검증 필터

`AppSlugVerificationFilter` 가 JWT 의 `appSlug` 와 path slug 를 대조해서 불일치 시 403 Forbidden 을 반환합니다.

```java
// common-security/AppSlugVerificationFilter.java 발췌
if (!pathSlug.equals(user.appSlug())) {
    response.setStatus(HttpServletResponse.SC_FORBIDDEN);
    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
    ApiError error = ApiError.of(CommonError.FORBIDDEN.getCode(),
        "app mismatch: JWT issued for '" + user.appSlug() + "' but accessing '" + pathSlug + "'");
    ApiResponse<Void> body = ApiResponse.error(error);
    response.getWriter().write(objectMapper.writeValueAsString(body));
    return;
}
```

sumtally JWT 로 `/api/apps/gymlog/users/me` 를 호출하면 403 이 돌아와요. 인증은 됐지만 "그 앱에 대한 권한이 없다" 는 의미라서 401 이 아니라 403 을 씁니다.

`/api/apps/` 가 없는 경로 (health, swagger 등) 는 검증을 건너뛰어요. JWT 가 없는 요청도 여기서는 통과시키고, 그 경우는 `SecurityConfig` 의 `anyRequest().authenticated()` 가 401 을 내려 줍니다.

### slug 를 ThreadLocal 에 싣는 필터

`AppSlugMdcFilter` 가 검증과는 별개로 routing 용 slug 를 `SlugContext` 에 적재해요. 인증된 유저면 JWT 의 `appSlug` 를 먼저 쓰고, 아니면 URL path 에서 뽑은 slug 로 fallback 합니다. 같은 slug 를 MDC 에도 넣어 로그 라벨로 쓰고, 요청이 끝나면 `finally` 에서 `SlugContext.clear()` 와 MDC 정리를 합니다.

```java
// common-security/AppSlugMdcFilter.java 발췌
private String resolveAppSlug(HttpServletRequest request) {
    Authentication auth = SecurityContextHolder.getContext().getAuthentication();
    if (auth != null && auth.isAuthenticated()
            && auth.getPrincipal() instanceof AuthenticatedUser user) {
        return user.appSlug();
    }
    return AppSlugExtractor.extract(request.getRequestURI());
}
```

---

## 7. 모듈별 역할 분담

멀티테넌시를 성립시키는 모듈 책임이에요.

| 모듈 | 역할 |
|---|---|
| `common-persistence` | `AbstractAppDataSourceConfig`, `SchemaRoutingDataSource`, `SlugContext` |
| `common-security` | `AppSlugVerificationFilter` (검증), `AppSlugMdcFilter` (slug 적재 + 로그 라벨), `JwtService` |
| `common-web` | `AppSlugExtractor` — URL 정규식 |
| `core-user-impl`, `core-auth-impl`, `core-device-impl` | 공통 엔티티 + `@EnableJpaRepositories` (기본 EMF 에 등록) |
| `bootstrap/RoutingDataSourceConfig` | `@Primary` routing dataSource + 공유 EMF·TM + 멀티테넌트 dbHealthContributor |
| `apps/app-<slug>/config/<Slug>DataSourceConfig` | 앱 schema 용 slug-prefix DataSource·EMF·TM·Flyway + 앱 고유 repository scan |

core 는 엔티티와 Port 만 정의하고 DataSource 는 제공하지 않습니다. 앱 모듈이 DataSource 를 제공하면서 core 의 엔티티와 엮여 하나의 EMF 가 돼요. 이 구조 덕분에 새 앱을 추가할 때 core 코드를 전혀 손대지 않아도 됩니다.

---

## 8. new-app 운영 철학

`<your-backend> new <slug>` 가 만드는 모듈 폭발 패턴의 트레이드오프와, slug 가 늘었을 때 수직 운영에서 수평 분리로 넘어가는 시점을 정리해요.

### 장점

- **격리가 여러 겹으로 쌓여요.** slug schema, slug bucket, slug DataSource pool, JWT 의 `appSlug` 클레임, URL path 의 slug prefix 가 차곡차곡 쌓여 한 slug 의 데이터가 다른 slug 로 새는 경로를 막습니다. ADR-005 의 단일 DB / per-schema 결정 위에 애플리케이션 레벨 방어선이 더해지는 구조예요.
- **추가가 빨라요.** `<your-backend> new <slug>` 한 번으로 schema, Flyway 마이그레이션, 시드 데이터, `<Slug>DataSourceConfig`, `<Slug>AppAutoConfiguration`, 컨트롤러 골격이 한꺼번에 생성됩니다. 운영자는 비즈니스 로직만 채우면 돼요.
- **마이그레이션이 slug 별로 독립적이에요.** slug 마다 `db/migration/<slug>/` 디렉토리가 분리돼 있어, 한 slug 의 마이그레이션이 다른 slug 의 히스토리와 충돌하지 않습니다.
- **도메인별 책임이 분리돼요.** 각 slug 모듈은 자기 controller 와 repository scan 범위만 가지므로, 한 slug 의 코드 진화가 다른 slug 에 영향을 주지 않습니다.

### 단점

- **모듈 수가 slug 에 비례해 늘어요.** slug 가 늘수록 `apps/app-<slug>` 모듈이 추가돼 jar 크기와 Gradle 빌드 시간이 함께 늘어납니다.
- **리소스가 slug 수만큼 곱해져요.** slug 마다 독립 HikariCP pool (`<slug>-pool`) 이 생기기 때문에, 10개 slug 를 운영하면 pool 이 10개입니다. 메모리와 DB connection 수가 그만큼 곱해져요.
- **빈 정의가 slug 마다 반복돼요.** `<Slug>DataSourceConfig`, `<Slug>EntityManagerFactory`, `<Slug>TransactionManager`, `<Slug>Flyway` 가 slug 마다 등록돼 ApplicationContext 부팅 시간이 slug 수에 비례해 늘어납니다.
- **slug 골격 클래스가 반복돼요.** 각 slug 의 `<Slug>HealthController` 와 설정 클래스들은 거의 같은 구조의 사본입니다. 다만 인증·결제·IAP 는 core 공유 컨트롤러 (`AuthController`·`PaymentController`·`IapController`) 가 `{appSlug}` path 변수로 처리하므로, slug 별 컨트롤러 중복은 HealthController 하나에 그쳐요.

### 스케일 아웃 전환점

| slug 수 | 운영 형태 | 권장 대응 |
|---|---|---|
| 1~5 | 단일 instance | 템플릿 기본 동작이에요. `SchemaRoutingDataSource` 가 ThreadLocal 로 slug → DataSource 분기를 처리합니다. |
| 5~10 | 단일 instance + tuning | HikariCP pool size 를 slug 별로 조정해요. `AbstractAppDataSourceConfig.poolSize()` 를 override 해 traffic 이 큰 slug 만 pool 을 키울 수 있습니다. |
| 10+ | 수평 분리 검토 | slug 그룹별로 별도 Spring instance 를 띄워요. traffic 이 가장 큰 slug 하나만 떼어 별도 deploy 로 운영하는 방법도 있습니다. 같은 코드를 재사용하면서 `KAMAL_SERVICE_NAME` 만 분리하면 돼요. |
| 30+ | DB 분리 | slug 그룹별로 별도 Postgres instance 를 씁니다. Supabase 의 multi-project 또는 dedicated DB 인스턴스를 활용할 수 있어요. |

템플릿은 slug 5~10개까지를 단일 instance 로 자연스럽게 동작하도록 설계됐어요. 그 이상에서도 코드 패턴 자체가 수평 분리를 막지는 않습니다. `SchemaRoutingDataSource` 가 Spring 의 `AbstractRoutingDataSource` 를 상속하므로, DB 별 routing key 를 추가로 도입하면 slug 단위 분리와 같은 패턴으로 DB 분리까지 확장할 수 있어요.

위 slug 수치는 권장 가이드라인이고, 실제 메모리·connection 사용량은 slug 별 traffic 과 쿼리 패턴에 따라 달라져요. `<your-backend> prod logs` 로 HikariCP 와 JVM heap 사용량을 모니터링하면서 임계점에 닿았는지 검토하길 권장해요.

### 트레이드오프 결론

솔로·인디 규모 (slug 5~10) 에서는 위 단점들이 실질적인 운영 부담으로 다가오지 않습니다. `core 1 + apps N` 패턴이 코드 검토와 운영 단순성에서 큰 가치를 갖기 때문이에요. 조직이 커져 slug 가 30개를 넘거나 다른 팀이 독립 운영하는 시스템이 등장하면, 템플릿 자체를 다시 fork 한 별도 레포로 분리하는 흐름이 자연스러워요. ADR-007 의 솔로 친화적 운영, ADR-005 의 단일 DB / per-schema 결정과 일관된 흐름이고, "운영 단위는 한 벌, slug 는 N 개, 그 이상은 fork" 가 템플릿이 권장하는 운영 철학입니다.

→ [`ADR-007 · 솔로 친화적 운영`](../philosophy/adr-007-solo-friendly-operations.md) · [`ADR-005 · 단일 DB / per-schema`](../philosophy/adr-005-db-schema-isolation.md)

---

## 관련 문서

- [`ADR-005 · 단일 Postgres database + 앱당 schema`](../philosophy/adr-005-db-schema-isolation.md) — schema 격리 + 방어선 결정
- [`ADR-012 · 앱별 독립 유저 모델`](../philosophy/adr-012-per-app-user-model.md) — 통합 계정 폐기
- [`ADR-018 · SchemaRoutingDataSource`](../philosophy/adr-018-schema-routing-datasource.md) — derive 로직 + ThreadLocal routing
- [`ADR-037 · core schema 폐기`](../philosophy/adr-037-core-schema-deprecation.md) — fail-secure routing + connection 기반 schema 결정
- [`JWT Authentication`](./jwt-authentication.md) — `appSlug` 검증 필터
- [`인프라 (Infrastructure)`](../production/deploy/infrastructure.md) — 실제 schema 배치 (Supabase)
- [`도그푸딩 walkthrough`](../start/dogfood-walkthrough.md) — slug 별 자격 derive 패턴이 정착된 흐름

---

## 9. 관련 파일

| 파일 | 역할 |
|---|---|
| `common-persistence/.../AbstractAppDataSourceConfig.java` | 앱별 DataSource·JPA·Flyway abstract 기반 |
| `common-persistence/.../SchemaRoutingDataSource.java` | slug 별 connection 분기 (fail-secure) |
| `common-persistence/.../SlugContext.java` | slug ThreadLocal 홀더 |
| `common-web/.../AppSlugExtractor.java` | `/api/apps/{slug}/` 정규식 |
| `common-security/.../AppSlugVerificationFilter.java` | JWT vs URL path slug 검증 (403) |
| `common-security/.../AppSlugMdcFilter.java` | SlugContext 적재 + MDC 라벨 |
| `common-security/.../jwt/JwtService.java` | `appSlug` 클레임 포함 access token 발급 |
| `bootstrap/.../config/RoutingDataSourceConfig.java` | `@Primary` routing + 공유 EMF·TM + 멀티테넌트 dbHealthContributor |
| `core-auth-impl/.../AuthAutoConfiguration.java` | core-auth repository `@EnableJpaRepositories` (기본 EMF) |
| `tools/app/new-app.sh` | 앱 모듈 생성 시 `<Slug>DataSourceConfig` 자동 생성 |
| `infra/scripts/init-app-schema.sql` | schema + role + grant 생성 (psql 실행) |
