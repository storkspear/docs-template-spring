<a id="adr-018--schemaroutingdatasource--service-layer-의-슬러그-격리"></a>

# ADR-018 · SchemaRoutingDataSource — service-layer 의 슬러그 격리

**Status**: Accepted. *Updated by [ADR-037](./adr-037-core-schema-deprecation.md)* — *core fallback* → `IllegalStateException` (fail-secure). slug 없는 DB 접근은 *configuration 오류* 로 간주, silent core fallback 폐기. `SchemaRoutingDataSource` 가 `SlugContext` (ThreadLocal) 의 슬러그 값으로 connection 을 슬러그별 DataSource 로 분기해요. INSERT / SELECT 가 자동으로 슬러그 schema 로 라우팅됩니다.

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~4분

## 결론부터

여러 앱이 하나의 공통 서비스를 사용하더라도 데이터는 요청한 앱의 스키마에 저장해야 해요. 공통 core 저장소는 라우팅 DataSource와 기본 EntityManager·트랜잭션 매니저를 사용하고, `SlugContext`가 연결을 얻는 시점의 앱을 정해요. 생성된 앱의 고유 저장소는 앱 전용 EntityManager·트랜잭션 매니저를 사용한다는 차이를 함께 구분해요.

`SchemaRoutingDataSource` 는 그 격리를 service-layer 까지 완성하는 메커니즘이에요. Spring 의 `AbstractRoutingDataSource` 를 확장한 단일 Bean 으로, connection 을 잡는 시점에 `SlugContext` (ThreadLocal) 의 현재 슬러그 값을 보고 해당 슬러그의 `<slug>DataSource` — 슬러그별 HikariCP pool — 로 분기해요. 요청이 들어오면 `AppSlugMdcFilter` 가 URL 의 `{appSlug}` 를 `SlugContext.set` 으로 박아두고, 요청이 끝나면 finally 블록에서 `clear` 합니다.

공통 서비스와 저장소는 하나의 구현을 유지하면서 연결 대상만 슬러그별로 선택해요. 공통 core 저장소는 기본 라우팅 EntityManager·트랜잭션 매니저를 사용해요. 연결을 얻기 전에 올바른 `SlugContext`가 설정돼 있어야 하며, 이미 시작한 트랜잭션에서 슬러그를 바꾸면 같은 보장을 기대할 수 없어요. 앱 고유 저장소의 전용 EntityManager·트랜잭션 매니저와도 구분해요.

## 왜 이런 고민이 시작됐나?

[`ADR-013`](./adr-013-per-app-auth-endpoints.md) 이 *공유 controller + 공통 `AuthPort` 위임* 패턴을 정했지만, 이 패턴은 *controller 와 service 사이의 위임* 까지만 책임집니다. service 가 실제로 *어느 schema 에 INSERT 할지* 는 [`ADR-013`](./adr-013-per-app-auth-endpoints.md) 의 범위 밖이에요. 결과적으로 *controller 는 슬러그를 알지만 service 는 슬러그에 무관* 한 비대칭이 생기고, 이 비대칭을 메우지 않으면 [`ADR-005`](./adr-005-db-schema-isolation.md) 의 5중 방어선 중 *DataSource 분리 방어선* 이 사실상 작동하지 않아요.

이 비대칭을 메우는 길에는 두 갈래가 있어요. 하나는 *service 시그니처에 `String appSlug` 파라미터를 모두 추가* 해서 *service 가 슬러그를 명시적으로 받는* 형태이고, 다른 하나는 *connection 자체가 현재 슬러그를 알아서 라우팅* 하는 ThreadLocal 기반 형태입니다.

명시적 파라미터 방식은 *시그니처가 비대해지는* 비용이 크고, *서비스 한 메서드가 다른 메서드를 부르는 체인* 에서 슬러그를 계속 전달해야 하는 부담이 누적돼요. 17 개 메서드를 가진 `AuthPort` 를 비롯해 모든 service 인터페이스가 *모든 메서드 첫 파라미터에 appSlug* 를 갖는 형태가 되고, 그 파라미터를 *service 안에서 어떤 분기에 쓰는지도 모호* 해집니다.

ThreadLocal 기반 라우팅은 *Spring 의 표준 패턴* 이에요. `AbstractRoutingDataSource` 가 *현재 lookup key* 를 ThreadLocal 에서 읽어 적절한 DataSource 로 분기하는 구조는 Spring 공식 문서가 멀티테넌시 패턴으로 권장하는 형태입니다. 우리 환경에서 ThreadLocal 의 약점 — *비동기 경계에서 컨텍스트 유실* — 도 [`ADR-007`](./adr-007-solo-friendly-operations.md) 의 비목표 (분산 추적·비동기 처리 회피) 정신과 정합해 큰 문제가 되지 않아요.

이 결정이 답해야 할 물음은 이거예요.

> **service-layer 가 슬러그를 명시적으로 받지 않으면서도 슬러그별 schema 격리를 자연스럽게 따르게 하는 구조는 무엇인가?**

<a id="결정--채택한-패턴"></a>

## 결정 — 채택한 패턴

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
        // ADR-037 — slug 없으면 fail-secure. core fallback 폐기.
        if (slug == null) {
            throw new IllegalStateException("SlugContext not set — 비-slug DB 접근은 configuration 오류");
        }
        // Bean 이름 규약 (<slug>DataSource, 하이픈 제거된 형태) 와 매칭
        return slug.replace("-", "");
    }
}
```

<a id="bootstrapconfigroutingdatasourceconfig--primary-datasource-를-routing-으로"></a>

### `bootstrap/config/RoutingDataSourceConfig` — Primary `dataSource` 를 routing 으로

```java
@Primary @Bean(name = "dataSource")
public DataSource dataSource(Map<String, DataSource> allDataSources) {
    SchemaRoutingDataSource routing = new SchemaRoutingDataSource();
    Map<Object, Object> targets = new HashMap<>();
    allDataSources.forEach((beanName, ds) -> {
        // adminDataSource 는 admin 콘솔 전용 고정 DS — 라우팅 대상 아님
        if (beanName.endsWith("DataSource")
                && !beanName.equals("dataSource")
                && !beanName.equals("adminDataSource")) {
            String slug = beanName.substring(0, beanName.length() - "DataSource".length());
            targets.put(slug, ds);
        }
    });
    routing.setTargetDataSources(targets);
    // ADR-037 — setDefaultTargetDataSource 미설정 → slug null 시 fail-secure
    routing.afterPropertiesSet();
    return routing;
}
```

**`adminDataSource` 제외는 fail-secure 가드예요.** 이름 규약만 보고 수집하면 `adminDataSource` 가 슬러그 `"admin"` 으로 라우팅 맵에 등록됩니다. 그러면 `appSlug` claim 이 `"admin"` 고정값인 superadmin 토큰 ([`ADR-039`](./adr-039-admin-module.md)) 이 `/api/apps/admin/...` 경로를 통과했을 때 `AppSlugVerificationFilter` 가 "슬러그 일치" 로 판정하고, `SlugContext` 가 `"admin"` 이 되어 **앱 데이터용 요청이 admin 스키마로 라우팅되는** 사고가 납니다. 등록 자체를 막아 두면 `"admin"` 은 미등록 슬러그가 되어 `UnknownAppSlugFilter` 의 404 나 `SchemaRoutingDataSource` 의 `IllegalStateException` 에서 끊깁니다 — 조건 하나를 빼먹었을 때 열리는 게 아니라 닫히는 쪽으로 설계한 겁니다.

이 발췌는 설명용 축약본이에요. **정본은 [`RoutingDataSourceConfig`](https://github.com/storkspear/template-spring/blob/main/bootstrap/src/main/java/com/factory/bootstrap/config/RoutingDataSourceConfig.java) 의 `dataSource(...)`** 이고, `SchemaRoutingDataSource` javadoc 의 예제도 같은 이유로 그쪽을 정본으로 가리킵니다. 가드 조건을 고칠 일이 생기면 정본만 고치면 돼요.

<a id="appslugmdcfilter--request-진입-시-slugcontextset--finally-clear"></a>

### `AppSlugMdcFilter` — request 진입 시 SlugContext.set + finally clear

기존 MDC 주입 filter 에 `SlugContext.set/clear` 한 줄 추가. JwtAuthFilter 뒤, AppSlugVerificationFilter 앞.

<a id="abstractappdatasourceconfig--hibernatedefault_schema-제거"></a>

### `AbstractAppDataSourceConfig` — `hibernate.default_schema` 제거

Entity (`@Table(name = "users")`) 가 schema 를 박지 않으므로 connection 의 search_path (DataSource URL 의 `currentSchema=<slug>`) 가 결정합니다. `hibernate.default_schema` 가 박혀 있으면 connection schema 가 무시되므로 제거해요.

## ADR-013 거부 사유 vs 현재 상황

ADR-013 이 ThreadLocal 라우팅 거부한 두 이유:

1. **"URL 에서 어느 앱인지 안 보임"** — ADR-012 의 URL 명시 이후 무효해요. `/api/apps/{slug}/auth/...` 경로에서 slug 가 명시적이에요.
2. **"ThreadLocal + AbstractRoutingDataSource 불안정성"** — Spring 표준 패턴이고 간단하다는 게 사실이에요. ADR-013 이 단순 거부했지만 실제 구현 시 안전해요 (filter 가 set/clear 를 보장).

→ ADR-013 의 거부는 그 시점의 결정이에요. ADR-012 가 URL 을 바꿨으니 재검토가 필요했고, 본 ADR-018 이 그 재검토 결과예요.

## 채택 이유 (ADR-013 대비 구체화)

- **ADR-005 (앱당 schema 격리) 의 진짜 보장** — controller 만 분리한 대안은 데이터가 core 통합 상태로 남아요 (격리 미달)
- **service·`@Transactional` 변경 0** — 단일 service Bean 그대로. 시그니처에 slug 파라미터를 추가하지 않아요
- **각 앱 module 의 `<slug>DataSource` Bean 활용** — 데드 코드 → 라우팅 target
- **filter 한 군데서 set/clear** — context 누수 위험 통제 가능

## 검증 결과 (2026-05-01)

```
slug=test-svc → testsvc.users INSERT (확인됨)
slug=helloworld → helloworld.users INSERT (확인됨)
test-svc 슬러그 + helloworld admin signin 시도 → 401 (격리 정상)
hibernate SQL log: insert into users (...) — schema prefix 없음, connection 이 결정
```

## Code References

- `common/common-persistence/SlugContext.java` (신규)
- `common/common-persistence/SchemaRoutingDataSource.java` (신규)
- `common/common-persistence/AbstractAppDataSourceConfig.java` (`hibernate.default_schema` 제거)
- `bootstrap/config/RoutingDataSourceConfig.java` (Primary `dataSource` → routing)
- `common/common-security/AppSlugMdcFilter.java` (SlugContext.set/clear)

## 안 다루는 범위

- **Cross-schema 트랜잭션** — 한 트랜잭션 안에서 여러 슬러그 변경 불가 (intentional — schema 격리 보장).
- **백그라운드 작업의 슬러그 컨텍스트** — request 외 (Scheduled task 등) 에선 `SlugContext` 미설정 → ADR-037 이후 `IllegalStateException` (fail-secure). 슬러그 작업이 필요하면 작업 진입에서 명시 set, 종료에서 clear.
