# Multi-tenant Architecture

> **유형**: Explanation · **독자**: Level 2 · **읽는 시간**: ~12분

**설계 근거**: [`ADR-005 (Postgres schema 격리)`](../philosophy/adr-005-db-schema-isolation.md) · [`ADR-012 (앱별 독립 유저 모델)`](../philosophy/adr-012-per-app-user-model.md)

이 문서는 "앱별 독립 유저" 멀티테넌시를 PostgreSQL schema 격리로 구현하는 방식을 설명해요.

한 레포에서 여러 모바일 앱(`sumtally`, `gymlog`, `rny` 등) 을 운영하되, **각 앱은 서로 유저 데이터를 공유하지 않습니다.** 같은 이메일로 sumtally 와 gymlog 에 각각 가입해도 둘은 완전히 별개의 계정이에요.

---

## 한 문장 요약

이 문서는 **"앱별 독립 유저"** 멀티테넌시를 PostgreSQL schema 격리로 구현하는 방식을 설명해요. AbstractAppDataSourceConfig · Core vs App DataSource · appSlug 검증 흐름이 핵심이에요.

---

## 1. 왜 per-app schema 인가

### 요구 조건

- 앱마다 유저 정책이 달라요 (소셜 로그인 provider, 비밀번호 정책, 탈퇴 처리 등).
- 한 앱의 유저가 다른 앱의 데이터에 **접근하면 안 됩니다.**
- 앱을 새로 추가해도 기존 앱의 테이블에 컬럼이 붙거나 쿼리가 복잡해지면 안 됩니다.
- 한 앱을 파생 레포로 추출할 때 유저 테이블을 통째로 떼어갈 수 있어야 해요.

### 선택지 비교

| 방식 | 장점 | 단점 |
|---|---|---|
| 단일 테이블 + `app_id` 컬럼 | 스키마 단순 | 모든 쿼리에 `WHERE app_id = ?` 필요, 실수 시 cross-app 누출 |
| 앱별 DB | 완전 격리 | 운영 부담 (N배 인스턴스 관리, backup, connection pool) |
| **앱별 schema** | **테이블 네임스페이스 격리, 하나의 DB 로 관리** | **DataSource/EMF 다중 와이어링 필요** |

템플릿은 **앱별 schema** 를 채택해요. PostgreSQL 의 schema 는 경량이고, 하나의 connection 으로 여러 schema 에 접근할 수 있고, role/grant 로 읽기/쓰기 권한을 스키마 단위로 제어할 수 있습니다.

---

## 2. AbstractAppDataSourceConfig

`common/common-persistence/.../AbstractAppDataSourceConfig.java` 가 앱별 DataSource + JPA + Flyway 와이어링의 abstract 기반이에요.

### 구성

각 앱 모듈은 이 클래스를 상속해서 **자기 DataSource 빈** 을 등록합니다. 자동 제공되는 빌더는 네 가지예요.

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

`hibernate.default_schema=<slug>` 를 설정하면 JPA 엔티티가 `@Table(name = "users")` 처럼 schema 를 명시하지 않아도 Hibernate 가 모든 쿼리에 `<slug>.` prefix 를 자동으로 붙여요. 그래서 core 의 `User` 엔티티 하나가 sumtally EMF 에서는 `sumtally.users` 를, gymlog EMF 에서는 `gymlog.users` 를 대상으로 동작해요.

같은 논리로 Flyway 의 `.schemas(slug)` 는 해당 schema 에 `flyway_schema_history` 테이블을 만들고 마이그레이션 이력을 관리합니다. 각 앱의 Flyway 디렉토리는 독립적으로 관리됩니다.

### 슬러그별 자격 derive (`<SLUG>_JDBC_DB_URL` 비우기 패턴)

`AbstractAppDataSourceConfig` 는 `<SLUG>_JDBC_DB_URL` 이 비어있을 때 core 의 `${JDBC_DB_URL}` 에서 `currentSchema=<slug>` 부분만 슬러그로 자동 교체해요. USER 와 PASSWORD 도 core 자격을 그대로 재사용합니다.

```bash
# .env.prod 의 슬러그별 자격은 비워두면 derive 됨
GYMLOG_JDBC_DB_URL=
GYMLOG_DB_USER=
GYMLOG_DB_PASSWORD=
```

도그푸딩 단계에서는 별도 role 분리가 필요 없으니 이 derive 패턴으로 시작하는 흐름이 권장됩니다. 운영이 안정되면 슬러그별로 별도 role 을 분리하는 *per-slug role* 정책으로 옮길 수 있습니다.

→ 자세한 설계 근거는 [`ADR-018 — SchemaRoutingDataSource`](../philosophy/adr-018-schema-routing-datasource.md) 와 [`도그푸딩 walkthrough §4`](../start/dogfood-walkthrough.md) 를 참조하세요.

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

앱의 EMF 는 `core-*-impl` 에 정의된 공통 엔티티 (User, RefreshToken, Device 등) 와 `apps.<slug>.entity` 의 앱 고유 엔티티를 모두 스캔합니다. **Entity 정의는 core 가 하고 DataSource 는 앱이 제공하는** 형태예요.

### Concrete subclass contract

- 각 `build*` 헬퍼는 매번 새 인스턴스를 만드므로 반드시 `@Bean` 으로 래핑해 Spring 캐시를 활용해야 해요 (앱당 HikariCP pool 1개 유지).
- Flyway 빈은 `@Bean(initMethod = "migrate")` 로 선언해야 해요. `buildFlyway()` 는 configure 만 하고 migrate 를 실행하지 않습니다.
- `@EnableJpaRepositories` 는 어노테이션 속성이 상속되지 않으므로 **concrete 클래스에 직접 선언** 해야 해요.

---

## 3. Core DataSource (bootstrap)

`bootstrap/.../config/CoreDataSourceConfig.java`

템플릿 상태 (앱 모듈 0개) 에서도 `core` schema 용 DataSource 가 필요합니다. bootstrap 모듈이 이 역할을 맡아요.

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

`UserAutoConfiguration`, `AuthAutoConfiguration`, `DeviceAutoConfiguration` 의 `@EnableJpaRepositories` 는 `entityManagerFactoryRef` 속성 없이 선언됩니다. 이 경우 Spring 은 기본 빈 이름 (`entityManagerFactory`, `transactionManager`) 으로 해결해요.

앱별 DataSourceConfig 가 추가로 등록되어 여러 `EntityManagerFactory` 빈이 생겨도 `@Primary` 로 명시된 core 빈이 우선 선택되므로 core 의 repository 가 안정적으로 동작해요.

Spring Boot 의 auto-config 는 `@ConditionalOnMissingBean(AbstractEntityManagerFactoryBean.class)` 로 back off 해서, 앱 DataSourceConfig 가 등록되는 순간 auto-config 가 전부 사라지는 문제가 있었어요. `@Primary` 를 명시하면 이 문제를 우회할 수 있습니다.

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
        @Value("${SUMTALLY_JDBC_DB_URL}") String url,
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

> `@Profile("!test")` 가 함께 붙어 있습니다. bootstrap test (Testcontainers 단일 DB) 환경에서 슬러그 모듈을 비활성화해서 슬러그별 schema 가 없는 환경에서도 부팅이 가능하게 해요. 같은 어노테이션이 `<Slug>AppAutoConfiguration` 에도 붙어 있습니다.

### 빈 이름 규칙

| 역할 | 빈 이름 |
|---|---|
| DataSource | `<slug>DataSource` |
| EntityManagerFactory | `<slug>EntityManagerFactory` |
| TransactionManager | `<slug>TransactionManager` |
| Flyway | `<slug>Flyway` |

slug 에 하이픈이 있으면 (예: `my-app`) 빈 이름에서는 제거한 소문자 (`myapp`) 를 사용합니다. `SLUG_PACKAGE` 로 변환되는 규칙이에요.

### Repository scan 주의사항

앱 DataSourceConfig 의 `@EnableJpaRepositories` 는 **앱 자기 패키지만** scan 해요 (`com.factory.apps.<slug>.repository`). core repository 는 이미 `UserAutoConfiguration`, `AuthAutoConfiguration`, `DeviceAutoConfiguration` 의 `@EnableJpaRepositories` 가 default EMF (core) 에 등록했기 때문에, 여기서 core 패키지를 다시 scan 하면 `userRepository` 등이 `BeanDefinitionOverrideException` 으로 충돌해요.

### Flyway 초기화 순서

`@DependsOn("<slug>Flyway")` 로 EMF 가 Flyway 보다 뒤에 초기화되도록 강제합니다. Flyway 가 먼저 migration 을 실행해서 스키마를 맞춰놓아야 Hibernate 의 `hbm2ddl.auto=validate` 검사가 통과합니다.

---

## 5. 환경변수 규약

앱별 DB 접속 정보는 `<SLUG_UPPER>_JDBC_DB_URL`, `<SLUG_UPPER>_DB_USER`, `<SLUG_UPPER>_DB_PASSWORD` 환경변수로 주입합니다.

```
# .env
SUMTALLY_JDBC_DB_URL=jdbc:postgresql://localhost:5433/postgres?currentSchema=sumtally
SUMTALLY_DB_USER=sumtally_app
SUMTALLY_DB_PASSWORD=<실제 비밀번호>

GYMLOG_JDBC_DB_URL=jdbc:postgresql://localhost:5433/postgres?currentSchema=gymlog
GYMLOG_DB_USER=gymlog_app
GYMLOG_DB_PASSWORD=<실제 비밀번호>
```

Role 네이밍은 `<slug_package>_app` — 각 schema 에만 grant 를 부여받아요. `infra/scripts/init-app-schema.sql` 이 schema 생성 + role 생성 + grant 설정을 함께 처리하고, `new-app.sh --provision-db` 옵션이 이 스크립트를 psql 로 실행합니다.

---

## 6. appSlug 검증 흐름

멀티테넌시의 격리를 실제로 강제하는 것은 인증/인가 레이어예요. JWT 의 `appSlug` 클레임과 URL path 의 slug 가 일치하지 않으면 요청을 차단해요.

### JWT 클레임

`JwtService.issueAccessToken(userId, email, appSlug, role)` 이 발급하는 토큰에 `appSlug` 클레임이 포함됩니다. sumtally 로 로그인한 유저는 `appSlug=sumtally` 토큰을 받아요.

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

정규식은 `/api/apps/{slug}/...` 패턴에서 slug 를 뽑아요. slug 는 소문자 + 숫자 + 하이픈만 허용합니다.

### 검증 필터

`AppSlugVerificationFilter` 가 JWT 의 `appSlug` 와 path slug 를 대조해서 불일치 시 **403 Forbidden** 을 반환합니다.

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

sumtally JWT 로 `/api/apps/gymlog/users/me` 를 호출하면 403 이 반환됩니다. 인증은 됐지만 "그 앱에 대한 권한이 없다" 는 의미라서 401 이 아닌 403 을 사용합니다.

`/api/apps/` 가 없는 경로 (health, swagger 등) 는 검증을 건너뛰어요. JWT 가 아예 없는 요청도 건너뛰어요 — 이 경우는 `SecurityConfig` 가 401 을 내려줘요.

---

## 7. 모듈별 역할 분담

멀티테넌시를 성립시키는 모듈 책임이에요.

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

## 8. new-app 운영 철학 — 장단점 + 스케일 아웃 전환점

`<your-backend> new <slug>` 가 만드는 *모듈 폭발* 패턴의 트레이드오프와, 슬러그 수가 늘어났을 때 *수직 운영* 에서 *수평 분리* 로 전환하는 시점을 정리해요.

### 장점

- **격리 — 5중 방어선이 자연스럽게 만들어져요.** 슬러그 schema, 슬러그 bucket, 슬러그 DataSource 풀, JWT 의 `appSlug` claim, URL path 의 슬러그 prefix 가 차곡차곡 쌓여서 한 슬러그의 데이터가 다른 슬러그로 새는 경로를 모두 차단해요. ADR-005 의 단일 DB / per-schema 결정 위에 애플리케이션 레벨 방어선 4 개가 추가되는 구조예요.
- **추가 속도가 빨라요.** `<your-backend> new <slug>` 한 번으로 schema, Flyway 마이그레이션, 시드 데이터, `<Slug>DataSourceConfig`, `<Slug>AppAutoConfiguration`, 컨트롤러 골격이 한꺼번에 생성됩니다. 운영자는 비즈니스 로직만 채우면 됩니다.
- **마이그레이션이 슬러그별로 독립적이에요.** 슬러그마다 `db/migration/<slug>/` 디렉토리가 별도로 분리되어 있어서, core 의 V001 변경이 어떤 슬러그의 마이그레이션 히스토리와도 충돌하지 않습니다.
- **도메인별 책임이 분리되어 있습니다.** 각 슬러그 모듈은 자기 controller 와 repository scan 범위만 가지므로, 한 슬러그의 코드 진화가 다른 슬러그에 영향을 주지 않습니다.

### 단점

- **모듈 수가 슬러그에 비례해 증가해요.** 슬러그가 늘어날수록 `apps/app-<slug>` 모듈이 추가돼서 jar 크기와 Gradle 빌드 시간이 함께 늘어나요.
- **리소스가 슬러그 수만큼 곱해져요.** 슬러그마다 독립적인 HikariCP 풀 (`<slug>-pool`) 이 만들어지기 때문에, core 와 10 슬러그를 운영하면 풀이 11 개가 됩니다. 메모리와 DB connection 수가 모두 그만큼 곱해져요 (`AbstractAppDataSourceConfig.java:168` 참조).
- **빈 정의가 슬러그마다 반복됩니다.** `<Slug>DataSourceConfig`, `<Slug>EntityManagerFactory`, `<Slug>TransactionManager`, `<Slug>Flyway` 가 슬러그마다 등록되어 ApplicationContext 부팅 시간이 슬러그 수에 비례해 늘어나요.
- **컨트롤러 boilerplate 가 중복됩니다.** 각 슬러그의 `*AuthController`, `*HealthController`, `*IapController`, `*PaymentController` 는 core Port 의 thin wrapper 형태로 거의 동일한 코드 구조를 가집니다.

### 스케일 아웃 전환점 (권장 가이드라인)

| 슬러그 수 | 운영 형태 | 권장 대응 |
|---|---|---|
| 1~5 | 단일 instance | 본 템플릿의 기본 동작이에요. `SchemaRoutingDataSource` 가 ThreadLocal 로 슬러그 → DataSource 분기를 처리합니다. |
| 5~10 | 단일 instance + tuning | HikariCP 풀 size 를 슬러그별로 조정해요. `AbstractAppDataSourceConfig.poolSize()` 를 override 해서 traffic 이 큰 슬러그만 풀을 키울 수 있습니다. |
| 10+ | 수평 분리 검토 | 슬러그 그룹별로 별도 Spring instance 를 띄워요. 또는 가장 traffic 이 큰 슬러그 하나만 분리해 별도 deploy 로 운영하는 방법도 있습니다. 같은 코드를 재사용하면서 `KAMAL_SERVICE_NAME` 만 분리하면 됩니다. |
| 30+ | DB 분리 | 슬러그 그룹별로 별도 Postgres instance 를 사용합니다. Supabase 의 multi-project 또는 dedicated DB 인스턴스를 활용할 수 있습니다. |

본 템플릿은 슬러그 5~10 개까지를 단일 instance 로 자연스럽게 동작하도록 설계되어 있습니다. 그 이상의 규모에서도 코드 패턴 자체가 수평 분리를 막지는 않습니다. `SchemaRoutingDataSource` 가 Spring 의 `AbstractRoutingDataSource` 를 상속하기 때문에, DB 별 routing key 를 추가로 도입하면 슬러그 단위 분리와 동일한 패턴으로 DB 분리까지 확장할 수 있습니다.

위 슬러그 수치는 권장 가이드라인이고, 실제 메모리·connection 사용량은 슬러그별 traffic 과 쿼리 패턴에 따라 달라져요. `<your-backend> prod logs` 로 HikariCP 와 JVM heap 사용량을 모니터링하면서 임계점에 도달했는지 검토하는 흐름을 권장해요.

### 트레이드오프 결론

솔로·인디 규모 (슬러그 5~10) 에서는 위 단점들이 실질적인 운영 부담으로 다가오지 않습니다. `core 1 + apps N` 패턴이 코드 검토와 운영 단순성에서 큰 가치를 가지기 때문이에요. 조직 규모가 확장되어 슬러그가 30 개를 넘어서거나 다른 팀이 독립적으로 운영하는 시스템이 등장하는 시점에는, 본 템플릿 자체를 다시 fork 한 별도 레포로 분리하는 흐름이 자연스러워요. ADR-007 의 *솔로 친화적 운영* 과 ADR-005 의 *단일 DB / per-schema* 결정과 일관된 흐름이고, *운영 단위는 한 벌, 슬러그는 N 개, 그 이상은 fork* 가 본 템플릿이 권장하는 운영 철학이에요.

→ [`ADR-007 · 솔로 친화적 운영`](../philosophy/adr-007-solo-friendly-operations.md) · [`ADR-005 · 단일 DB / per-schema`](../philosophy/adr-005-db-schema-isolation.md)

---

## 관련 문서

- [`ADR-005 · 단일 Postgres database + 앱당 schema`](../philosophy/adr-005-db-schema-isolation.md) — schema 격리 + 5중 방어선 결정
- [`ADR-012 · 앱별 독립 유저 모델 (통합 계정 폐기)`](../philosophy/adr-012-per-app-user-model.md) — 앱별 독립 유저 모델
- [`ADR-018 · SchemaRoutingDataSource`](../philosophy/adr-018-schema-routing-datasource.md) — `AbstractAppDataSourceConfig` 의 derive 로직 + ThreadLocal routing
- [`JWT Authentication`](./jwt-authentication.md) — `appSlug` 검증 필터
- [`인프라 (Infrastructure)`](../production/deploy/infrastructure.md) — 실제 schema 배치 (Supabase)
- [`도그푸딩 walkthrough`](../start/dogfood-walkthrough.md) — 슬러그별 자격 derive 패턴이 정착된 흐름

---

## 9. 관련 파일

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
