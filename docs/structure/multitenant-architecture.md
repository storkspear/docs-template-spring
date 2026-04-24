# Multi-tenant Architecture

> **유형**: Explanation · **독자**: Level 2 · **읽는 시간**: ~12분

**설계 근거**: [`ADR-005 (Postgres schema 격리)`](../philosophy/adr-005-db-schema-isolation.md) · [`ADR-012 (앱별 독립 유저 모델)`](../philosophy/adr-012-per-app-user-model.md)

이 문서는 "앱별 독립 유저" 멀티테넌시를 PostgreSQL schema 격리로 구현하는 방식을 설명합니다.

한 레포에서 여러 모바일 앱(`sumtally`, `gymlog`, `rny` 등) 을 운영하되, **각 앱은 서로 유저 데이터를 공유하지 않습니다.** 같은 이메일로 sumtally 와 gymlog 에 각각 가입해도 둘은 완전히 별개의 계정입니다.

---

## 한 문장 요약

이 문서는 **"앱별 독립 유저"** 멀티테넌시를 PostgreSQL schema 격리로 구현하는 방식을 설명합니다. AbstractAppDataSourceConfig · Core vs App DataSource · appSlug 검증 흐름.

---

## 1. 왜 per-app schema 인가

### 요구 조건

- 앱마다 유저 정책이 다릅니다 (소셜 로그인 provider, 비밀번호 정책, 탈퇴 처리 등).
- 한 앱의 유저가 다른 앱의 데이터에 **접근하면 안 됩니다.**
- 앱을 새로 추가해도 기존 앱의 테이블에 컬럼이 붙거나 쿼리가 복잡해지면 안 됩니다.
- 한 앱을 파생 레포로 추출할 때 유저 테이블을 통째로 떼어갈 수 있어야 합니다.

### 선택지 비교

| 방식 | 장점 | 단점 |
|---|---|---|
| 단일 테이블 + `app_id` 컬럼 | 스키마 단순 | 모든 쿼리에 `WHERE app_id = ?` 필요, 실수 시 cross-app 누출 |
| 앱별 DB | 완전 격리 | 운영 부담 (N배 인스턴스 관리, backup, connection pool) |
| **앱별 schema** | **테이블 네임스페이스 격리, 하나의 DB 로 관리** | **DataSource/EMF 다중 와이어링 필요** |

템플릿은 **앱별 schema** 를 채택합니다. PostgreSQL 의 schema 는 경량이고, 하나의 connection 으로 여러 schema 에 접근 가능하며, role/grant 로 읽기/쓰기 권한을 스키마 단위로 제어할 수 있습니다.

---

## 2. AbstractAppDataSourceConfig

`common/common-persistence/.../AbstractAppDataSourceConfig.java` 가 앱별 DataSource + JPA + Flyway 와이어링의 abstract 기반입니다.

### 구성

각 앱 모듈은 이 클래스를 상속하여 **자기 DataSource 빈** 을 등록합니다. 자동 제공되는 빌더는 네 가지입니다.

| 빌더 메서드 | 반환 | 설명 |
|---|---|---|
| `buildDataSource()` | `DataSource` (`HikariDataSource`) | Pool name `<slug>-pool`, 기본 maxSize 10 |
| `buildEntityManagerFactory(ds)` | `LocalContainerEntityManagerFactoryBean` | `hibernate.default_schema=<slug>`, persistence unit 이름 `<slug>` |
| `buildTransactionManager(emf)` | `PlatformTransactionManager` | `JpaTransactionManager` |
| `buildFlyway(ds)` | `Flyway` | `.schemas(slug).locations("classpath:db/migration/<slug>")` |

### 핵심 구현

```java
protected DataSource buildDataSource() {
    HikariConfig config = new HikariConfig();
    config.setJdbcUrl(url);
    config.setUsername(username);
    config.setPassword(password);
    config.setMaximumPoolSize(poolSize());
    config.setPoolName(slug + "-pool");
    return new HikariDataSource(config);
}

protected LocalContainerEntityManagerFactoryBean buildEntityManagerFactory(DataSource ds) {
    LocalContainerEntityManagerFactoryBean emf = new LocalContainerEntityManagerFactoryBean();
    emf.setDataSource(ds);
    emf.setPackagesToScan(entityPackagesToScan());
    emf.setPersistenceUnitName(slug);

    HibernateJpaVendorAdapter vendor = new HibernateJpaVendorAdapter();
    emf.setJpaVendorAdapter(vendor);

    Properties props = new Properties();
    props.setProperty("hibernate.default_schema", slug);
    props.setProperty("hibernate.hbm2ddl.auto", "validate");
    emf.setJpaProperties(props);

    return emf;
}

protected Flyway buildFlyway(DataSource ds) {
    return Flyway.configure()
        .dataSource(ds)
        .schemas(slug)
        .locations("classpath:db/migration/" + slug)
        .baselineOnMigrate(true)
        .load();
}
```

### Hibernate 의 default_schema

`hibernate.default_schema=<slug>` 를 설정하면 JPA 엔티티가 `@Table(name = "users")` 처럼 schema 를 명시하지 않아도 Hibernate 가 모든 쿼리에 `<slug>.` prefix 를 자동으로 붙입니다. 그래서 core 의 `User` 엔티티 하나가 sumtally EMF 에서는 `sumtally.users` 를, gymlog EMF 에서는 `gymlog.users` 를 대상으로 동작합니다.

같은 논리로 Flyway 의 `.schemas(slug)` 는 해당 schema 에 `flyway_schema_history` 테이블을 만들고 마이그레이션 이력을 관리합니다. 각 앱의 Flyway 디렉토리는 독립적으로 관리됩니다.

### Entity 스캔 패키지

```java
protected static final String[] CORE_ENTITY_PACKAGES = {
    "com.factory.core.user.impl.entity",
    "com.factory.core.auth.impl.entity",
    "com.factory.core.device.impl.entity",
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

앱의 EMF 는 `core-*-impl` 에 정의된 공통 엔티티 (User, RefreshToken, Device 등) 와 `apps.<slug>.entity` 의 앱 고유 엔티티를 모두 스캔합니다. **Entity 정의는 core 가 하고 DataSource 는 앱이 제공합니다.**

### Concrete subclass contract

- 각 `build*` 헬퍼는 매번 새 인스턴스를 만드므로 반드시 `@Bean` 으로 래핑해 Spring 캐시를 활용해야 합니다 (앱당 HikariCP pool 1개 유지).
- Flyway 빈은 `@Bean(initMethod = "migrate")` 로 선언해야 합니다 — `buildFlyway()` 는 configure 만 하고 migrate 를 실행하지 않습니다.
- `@EnableJpaRepositories` 는 어노테이션 속성이 상속되지 않으므로 **concrete 클래스에 직접 선언** 해야 합니다.

---

## 3. Core DataSource (bootstrap)

`bootstrap/.../config/CoreDataSourceConfig.java`

템플릿 상태 (앱 모듈 0개) 에서도 `core` schema 용 DataSource 가 필요합니다. bootstrap 모듈이 이 역할을 맡습니다.

```java
@Configuration
public class CoreDataSourceConfig extends AbstractAppDataSourceConfig {

    public CoreDataSourceConfig(
        @Value("${spring.datasource.url}") String url,
        @Value("${spring.datasource.username}") String username,
        @Value("${spring.datasource.password}") String password
    ) {
        super("core", url, username, password);
    }

    @Override
    protected String[] entityPackagesToScan() {
        return CORE_ENTITY_PACKAGES;  // core 패키지만
    }

    @Primary
    @Bean(name = "dataSource")
    public DataSource dataSource() { return buildDataSource(); }

    @Primary
    @Bean(name = "entityManagerFactory")
    @DependsOn("flyway")
    public LocalContainerEntityManagerFactoryBean entityManagerFactory(
        @Qualifier("dataSource") DataSource ds
    ) { return buildEntityManagerFactory(ds); }

    @Primary
    @Bean(name = "transactionManager")
    public PlatformTransactionManager transactionManager(
        @Qualifier("entityManagerFactory") EntityManagerFactory emf
    ) { return buildTransactionManager(emf); }

    @Primary
    @Bean(name = "flyway", initMethod = "migrate")
    public Flyway flyway(@Qualifier("dataSource") DataSource ds) {
        return buildFlyway(ds);
    }
}
```

### `@Primary` 가 필요한 이유

`UserAutoConfiguration`, `AuthAutoConfiguration`, `DeviceAutoConfiguration` 의 `@EnableJpaRepositories` 는 `entityManagerFactoryRef` 속성 없이 선언됩니다. 이 경우 Spring 은 기본 빈 이름 (`entityManagerFactory`, `transactionManager`) 으로 해결합니다.

앱별 DataSourceConfig 가 추가로 등록되어 여러 `EntityManagerFactory` 빈이 생겨도 `@Primary` 로 명시된 core 빈이 우선 선택되므로 core 의 repository 가 안정적으로 동작합니다.

Spring Boot 의 auto-config 는 `@ConditionalOnMissingBean(AbstractEntityManagerFactoryBean.class)` 로 back off 하기 때문에, 앱 DataSourceConfig 가 등록되는 순간 auto-config 가 전부 사라지는 문제가 있었습니다. `@Primary` 를 명시하면 이 문제를 우회할 수 있습니다.

---

## 4. 앱별 DataSourceConfig 패턴

`new-app.sh` 가 앱을 추가할 때 자동 생성하는 `<SlugPascal>DataSourceConfig.java` 의 구조입니다.

```java
@Configuration
@EnableJpaRepositories(
    basePackages = "com.factory.apps.sumtally.repository",
    entityManagerFactoryRef = "sumtallyEntityManagerFactory",
    transactionManagerRef = "sumtallyTransactionManager"
)
public class SumtallyDataSourceConfig extends AbstractAppDataSourceConfig {

    public SumtallyDataSourceConfig(
        @Value("${SUMTALLY_DB_URL}") String url,
        @Value("${SUMTALLY_DB_USER}") String user,
        @Value("${SUMTALLY_DB_PASSWORD}") String password
    ) {
        super("sumtally", url, user, password);
    }

    @Bean(name = "sumtallyDataSource")
    public DataSource sumtallyDataSource() {
        return buildDataSource();
    }

    @Bean(name = "sumtallyEntityManagerFactory")
    @DependsOn("sumtallyFlyway")  // Flyway 선 migrate → hbm2ddl=validate 통과
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

### 빈 이름 규칙

| 역할 | 빈 이름 |
|---|---|
| DataSource | `<slug>DataSource` |
| EntityManagerFactory | `<slug>EntityManagerFactory` |
| TransactionManager | `<slug>TransactionManager` |
| Flyway | `<slug>Flyway` |

slug 에 하이픈이 있으면 (예: `my-app`) 빈 이름에서는 제거한 소문자 (`myapp`) 를 사용합니다 — `SLUG_PACKAGE` 로 변환됩니다.

### Repository scan 주의사항

앱 DataSourceConfig 의 `@EnableJpaRepositories` 는 **앱 자기 패키지만** scan 합니다 (`com.factory.apps.<slug>.repository`). core repository 는 이미 `UserAutoConfiguration`, `AuthAutoConfiguration`, `DeviceAutoConfiguration` 의 `@EnableJpaRepositories` 가 default EMF (core) 에 등록했기 때문에, 여기서 core 패키지를 다시 scan 하면 `userRepository` 등이 `BeanDefinitionOverrideException` 으로 충돌합니다.

### Flyway 초기화 순서

`@DependsOn("<slug>Flyway")` 로 EMF 가 Flyway 보다 뒤에 초기화되도록 강제합니다. Flyway 가 먼저 migration 을 실행해 스키마를 맞춰놓아야 Hibernate 의 `hbm2ddl.auto=validate` 검사가 통과합니다.

---

## 5. 환경변수 규약

앱별 DB 접속 정보는 `<SLUG_UPPER>_DB_URL`, `<SLUG_UPPER>_DB_USER`, `<SLUG_UPPER>_DB_PASSWORD` 환경변수로 주입합니다.

```
# .env
SUMTALLY_DB_URL=jdbc:postgresql://localhost:5433/postgres?currentSchema=sumtally
SUMTALLY_DB_USER=sumtally_app
SUMTALLY_DB_PASSWORD=<실제 비밀번호>

GYMLOG_DB_URL=jdbc:postgresql://localhost:5433/postgres?currentSchema=gymlog
GYMLOG_DB_USER=gymlog_app
GYMLOG_DB_PASSWORD=<실제 비밀번호>
```

Role 네이밍은 `<slug_package>_app` — 각 schema 에만 grant 를 부여받습니다. `infra/scripts/init-app-schema.sql` 이 schema 생성 + role 생성 + grant 설정을 함께 처리하며, `new-app.sh --provision-db` 옵션이 이 스크립트를 psql 로 실행합니다.

---

## 6. appSlug 검증 흐름

멀티테넌시의 격리를 실제로 강제하는 것은 인증/인가 레이어입니다. JWT 의 `appSlug` 클레임과 URL path 의 slug 가 일치하지 않으면 요청을 차단합니다.

### JWT 클레임

`JwtService.issueAccessToken(userId, email, appSlug, role)` 이 발급하는 토큰에 `appSlug` 클레임이 포함됩니다. sumtally 로 로그인한 유저는 `appSlug=sumtally` 토큰을 받습니다.

### URL path 추출

`common/common-web/.../AppSlugExtractor.java`

```java
private static final Pattern APP_SLUG_PATTERN = Pattern.compile("^/api/apps/([a-z][a-z0-9-]*)/");

public static String extract(String uri) {
    if (uri == null) {
        return null;
    }
    Matcher m = APP_SLUG_PATTERN.matcher(uri);
    return m.find() ? m.group(1) : null;
}
```

정규식은 `/api/apps/{slug}/...` 패턴에서 slug 를 뽑습니다. slug 는 소문자 + 숫자 + 하이픈만 허용합니다.

### 검증 필터

`AppSlugVerificationFilter` 가 JWT 의 `appSlug` 와 path slug 를 대조하여 불일치 시 **403 Forbidden** 을 반환합니다.

```java
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

sumtally JWT 로 `/api/apps/gymlog/users/me` 를 호출하면 403 이 반환됩니다. 인증은 됐으나 "그 앱에 대한 권한이 없다" 는 의미이므로 401 이 아닌 403 을 사용합니다.

`/api/apps/` 가 없는 경로 (health, swagger 등) 는 검증을 건너뜁니다. JWT 가 아예 없는 요청도 건너뜁니다 — 이 경우는 `SecurityConfig` 가 401 을 내려줍니다.

---

## 7. 모듈별 역할 분담

멀티테넌시를 성립시키는 모듈 책임입니다.

| 모듈 | 역할 |
|---|---|
| `common-persistence` | `AbstractAppDataSourceConfig` — DataSource/EMF/TM/Flyway 빌더 제공 |
| `common-security` | `AppSlugVerificationFilter`, `AppSlugMdcFilter` — path/JWT slug 검증 및 로그 라벨링 |
| `common-web` | `AppSlugExtractor` — URL 정규식 |
| `core-user-impl`, `core-auth-impl`, `core-device-impl` | 공통 엔티티 + `@EnableJpaRepositories` (default EMF 에 등록) |
| `bootstrap/CoreDataSourceConfig` | `core` schema 용 `@Primary` DataSource/EMF/TM/Flyway |
| `apps/app-<slug>/config/<Slug>DataSourceConfig` | 앱 schema 용 slug-prefix DataSource/EMF/TM/Flyway + 앱 고유 repository scan |

core 는 Entity 와 Port 만 정의하고 DataSource 는 제공하지 않습니다. 앱 모듈이 DataSource 를 제공하면서 동시에 core 의 Entity 와 엮여 하나의 EMF 가 됩니다. 이 구조 덕분에 새 앱을 추가할 때 core 코드를 전혀 수정하지 않아도 됩니다.

---

## 관련 문서

- [`ADR-005 · 단일 Postgres database + 앱당 schema`](../philosophy/adr-005-db-schema-isolation.md) — schema 격리 + 5중 방어선 결정
- [`ADR-012 · 앱별 독립 유저 모델 (통합 계정 폐기)`](../philosophy/adr-012-per-app-user-model.md) — 앱별 독립 유저 모델
- [`JWT Authentication`](./jwt-authentication.md) — `appSlug` 검증 필터
- [`인프라 (Infrastructure)`](../production/deploy/infrastructure.md) — 실제 schema 배치 (Supabase)

---

## 8. 관련 파일

| 파일 | 역할 |
|---|---|
| `common-persistence/.../AbstractAppDataSourceConfig.java` | 앱별 DataSource/JPA/Flyway abstract 기반 |
| `common-web/.../AppSlugExtractor.java` | `/api/apps/{slug}/` 정규식 |
| `common-security/.../AppSlugVerificationFilter.java` | JWT vs URL path slug 검증 (403) |
| `common-security/.../AppSlugMdcFilter.java` | MDC 에 appSlug 주입 (로그 라벨) |
| `common-security/.../jwt/JwtService.java` | `appSlug` 클레임 포함 access token 발급 |
| `bootstrap/.../config/CoreDataSourceConfig.java` | `core` schema 용 `@Primary` DataSource/EMF/TM/Flyway |
| `core-auth-impl/.../AuthAutoConfiguration.java` | core-auth repository `@EnableJpaRepositories` (default EMF) |
| `tools/new-app/new-app.sh` | 앱 모듈 생성 시 `<Slug>DataSourceConfig` 자동 생성 |
| `infra/scripts/init-app-schema.sql` | schema + role + grant 생성 (psql 실행) |
