# ADR-018 · SchemaRoutingDataSource — service-layer 의 슬러그 격리

**Status**: Accepted. `SchemaRoutingDataSource` 가 `SlugContext` (ThreadLocal) 의 슬러그 값으로 connection 을 슬러그별 DataSource 에 분기. INSERT / SELECT 가 자동으로 슬러그 schema 로 라우팅.

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~4분

## 결론부터

[`ADR-005`](./adr-005-db-schema-isolation.md) 의 *앱당 schema 격리* 가 **데이터베이스 레벨에서 작동하려면 서버의 service-layer 도 그 격리를 따라야 해요**. controller 가 *URL 에서 받은 슬러그* 로 자기 앱의 DataSource 를 골랐다 해도, service 가 *single Bean* 으로 동작하면서 *항상 default DataSource 로 INSERT* 를 하면 격리가 무너집니다. *testsvc 슬러그의 회원가입* 이 *core schema 의 users 테이블에 INSERT* 되는 형태로요.

`SchemaRoutingDataSource` 는 그 격리를 service-layer 까지 완성하는 메커니즘이에요. Spring 의 `AbstractRoutingDataSource` 를 확장한 단일 Bean 으로, *connection 을 잡는 시점* 에 `SlugContext` (ThreadLocal) 의 현재 슬러그 값을 보고 *해당 슬러그의 `<slug>DataSource`* (각 슬러그별 HikariCP pool) 로 분기해요. 요청이 들어오면 `AppSlugMdcFilter` 가 URL 의 `{appSlug}` 를 `SlugContext.set` 으로 박아두고, 요청이 끝나면 finally 블록에서 `clear` 합니다.

이 구조의 장점은 *service Bean 은 그대로 단일* 이라는 점이에요. `AuthServiceImpl` 한 개가 모든 슬러그의 회원가입을 처리하지만, *connection 자체가 슬러그별로 분기되므로* `INSERT INTO users` 가 *현재 요청의 슬러그 schema* 로 자동으로 흘러가요. `@Transactional` 도 단일 TransactionManager 그대로 쓰고, JPA Repository 도 default EntityManagerFactory 그대로 쓰는데, *connection 이 결정하는 search_path* 덕에 자연스럽게 격리가 작동합니다.

## 왜 이런 결정이 필요했나?

[`ADR-013`](./adr-013-per-app-auth-endpoints.md) 이 *앱별 controller + 공통 `AuthPort` 위임* 패턴을 정했지만, 이 패턴은 *controller 와 service 사이의 위임* 까지만 책임집니다. service 가 실제로 *어느 schema 에 INSERT 할지* 는 [`ADR-013`](./adr-013-per-app-auth-endpoints.md) 의 범위 밖이에요. 결과적으로 *controller 는 슬러그를 알지만 service 는 슬러그에 무관* 한 비대칭이 생기고, 이 비대칭을 메우지 않으면 [`ADR-005`](./adr-005-db-schema-isolation.md) 의 5중 방어선 중 *DataSource 분리 방어선* 이 사실상 작동하지 않아요.

이 비대칭을 메우는 길에는 두 갈래가 있어요. 하나는 *service 시그니처에 `String appSlug` 파라미터를 모두 추가* 해서 *service 가 슬러그를 명시적으로 받는* 형태이고, 다른 하나는 *connection 자체가 현재 슬러그를 알아서 라우팅* 하는 ThreadLocal 기반 형태입니다.

명시적 파라미터 방식은 *시그니처가 비대해지는* 비용이 크고, *서비스 한 메서드가 다른 메서드를 부르는 체인* 에서 슬러그를 계속 전달해야 하는 부담이 누적돼요. 17 개 메서드를 가진 `AuthPort` 를 비롯해 모든 service 인터페이스가 *모든 메서드 첫 파라미터에 appSlug* 를 갖는 형태가 되고, 그 파라미터를 *service 안에서 어떤 분기에 쓰는지도 모호* 해집니다.

ThreadLocal 기반 라우팅은 *Spring 의 표준 패턴* 이에요. `AbstractRoutingDataSource` 가 *현재 lookup key* 를 ThreadLocal 에서 읽어 적절한 DataSource 로 분기하는 구조는 Spring 공식 문서가 멀티테넌시 패턴으로 권장하는 형태입니다. 우리 환경에서 ThreadLocal 의 약점 — *비동기 경계에서 컨텍스트 유실* — 도 [`ADR-007`](./adr-007-solo-friendly-operations.md) 의 *비목표 (분산 추적 / 비동기 처리 회피)* 정신과 정합해 큰 문제가 되지 않아요.

이 결정이 답해야 할 물음은 이거예요.

> **service-layer 가 슬러그를 명시적으로 받지 않으면서도 슬러그별 schema 격리를 자연스럽게 따르게 하는 구조는 무엇인가?**

## 채택한 패턴

### `SlugContext` (ThreadLocal)

```java
public final class SlugContext {
    private static final ThreadLocal<String> CURRENT = new ThreadLocal<>();

    public static void set(String slug) { CURRENT.set(slug); }
    public static String get() { return CURRENT.get(); }
    public static void clear() { CURRENT.remove(); }
}
```

### `SchemaRoutingDataSource`

```java
public class SchemaRoutingDataSource extends AbstractRoutingDataSource {
    @Override
    protected Object determineCurrentLookupKey() {
        String slug = SlugContext.get();
        // Bean 이름 규약 (<slug>DataSource, 하이픈 제거된 형태) 와 매칭
        return slug != null ? slug.replace("-", "") : "core";
    }
}
```

### `bootstrap/CoreDataSourceConfig` — Primary `dataSource` 를 routing 으로

```java
@Primary @Bean(name = "dataSource")
public DataSource dataSource(
        @Qualifier("coreDataSource") DataSource coreDataSource,
        Map<String, DataSource> allDataSources) {
    SchemaRoutingDataSource routing = new SchemaRoutingDataSource();
    Map<Object, Object> targets = new HashMap<>();
    targets.put("core", coreDataSource);
    allDataSources.forEach((beanName, ds) -> {
        if (beanName.endsWith("DataSource") && !beanName.equals("dataSource")) {
            String slug = beanName.substring(0, beanName.length() - "DataSource".length());
            targets.put(slug, ds);
        }
    });
    routing.setTargetDataSources(targets);
    routing.setDefaultTargetDataSource(coreDataSource);
    routing.afterPropertiesSet();
    return routing;
}
```

### `AppSlugMdcFilter` — request 진입 시 SlugContext.set + finally clear

기존 MDC 주입 filter 에 `SlugContext.set/clear` 한 줄 추가. JwtAuthFilter 뒤, AppSlugVerificationFilter 앞.

### `AbstractAppDataSourceConfig` — `hibernate.default_schema` 제거

Entity (`@Table(name = "users")`) 가 schema 를 박지 않으므로 connection 의 search_path (DataSource URL 의 `currentSchema=<slug>`) 가 결정합니다. `hibernate.default_schema` 가 박혀 있으면 connection schema 가 무시되므로 제거해요.

## ADR-013 거부 사유 vs 현재 상황

ADR-013 이 ThreadLocal 라우팅 거부한 두 이유:

1. **"URL 에서 어느 앱인지 안 보임"** — ADR-012 의 URL 명시 이후 무효해요. `/api/apps/{slug}/auth/...` 경로에서 slug 가 명시적이에요.
2. **"ThreadLocal + AbstractRoutingDataSource 불안정성"** — Spring 표준 패턴이고 간단하다는 게 사실이에요. ADR-013 이 단순 거부했지만 실제 구현 시 안전해요 (filter 가 set/clear 를 보장).

→ ADR-013 의 거부는 그 시점의 결정이에요. ADR-012 가 URL 을 바꿨으니 재검토가 필요했고, 본 ADR-018 이 그 재검토 결과예요.

## 채택 이유 (ADR-013 대비 구체화)

- **ADR-005 (앱당 schema 격리) 의 진짜 보장** — controller 만 분리한 대안은 데이터가 core 통합 상태로 남아요 (격리 미달)
- **service / `@Transactional` 변경 0** — 단일 service Bean 그대로. 시그니처에 slug 파라미터를 추가하지 않아요
- **각 앱 module 의 `<slug>DataSource` Bean 활용** — 데드 코드 → 라우팅 target
- **filter 한 군데서 set/clear** — context 누수 위험 통제 가능

## 검증 결과 (2026-05-01)

```
slug=test-svc → testsvc.users INSERT (확인됨)
slug=helloworld → helloworld.users INSERT (확인됨)
test-svc 슬러그 + helloworld admin signin 시도 → 401 (격리 정상)
hibernate SQL log: insert into users (...) — schema prefix 없음, connection 이 결정
```

## 핵심 파일

- `common/common-persistence/SlugContext.java` (신규)
- `common/common-persistence/SchemaRoutingDataSource.java` (신규)
- `common/common-persistence/AbstractAppDataSourceConfig.java` (`hibernate.default_schema` 제거)
- `bootstrap/config/CoreDataSourceConfig.java` (Primary `dataSource` → routing)
- `common/common-security/AppSlugMdcFilter.java` (SlugContext.set/clear)

## 안 다루는 범위

- **Cross-schema 트랜잭션** — 한 트랜잭션 안에서 여러 슬러그 변경 불가 (intentional — schema 격리 보장).
- **백그라운드 작업의 슬러그 컨텍스트** — request 외 (Scheduled task 등) 에선 `SlugContext` 미설정 → default (`coreDataSource`) 사용. 별도 슬러그 작업 필요 시 명시 set/clear.
