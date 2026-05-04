# ADR-018 · SchemaRoutingDataSource — ADR-013 의 service-layer 완성

**Status**: Accepted. 2026-05-01 기준 모든 슬러그별 데이터 격리가 `SchemaRoutingDataSource` 의 ThreadLocal 분기로 동작합니다. ADR-013 (앱별 controller + AuthPort 위임) 의 채택 정신을 service-layer 까지 끝까지 완성했어요.

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~4분

## 결론부터

각 요청에서 URL 의 `{appSlug}` 를 `SlugContext` (ThreadLocal) 에 set → `SchemaRoutingDataSource` (Spring 의 `AbstractRoutingDataSource` 확장) 가 connection 잡을 때 해당 슬러그의 `<slug>DataSource` (HikariCP pool) 로 분기합니다. service Bean 은 단일 (`AuthServiceImpl`), `@Transactional` 도 단일 TM 인데, connection 자체가 슬러그별이라 INSERT/SELECT 가 자동으로 슬러그 schema 로 라우팅돼요.

## 왜 이런 결정이 필요했나?

ADR-013 이 결정한 "앱별 controller + 공통 AuthPort 위임" 패턴이 **service-layer 에서 미완성** 이었어요. 도그푸딩 e2e 검증으로 발견했어요:

```
testsvc 슬러그로 회원가입 호출
  → INSERT INTO core.users  ❌  (testsvc.users 가 아님!)
```

근본 원인:

- `core-auth-impl/AuthAutoConfiguration` 의 `@EnableJpaRepositories` 가 default EMF 로 강제 등록
- `bootstrap/CoreDataSourceConfig` 의 default `dataSource` Bean = core schema 직접 가리키는 단일 HikariCP
- → `AuthServiceImpl` (단일 Bean) 이 호출하는 `UserRepository` 가 항상 core schema 만 봄
- 각 앱의 `<slug>DataSource` Bean 은 등록만 되고 **데드 코드**

ADR-013 은 "ThreadLocal 라우팅을 거부" 했지만 그 거부 이유 (URL 에서 slug 가 안 보임) 는 ADR-012 의 URL 명시 (`/api/apps/{slug}/auth/*`) 이후 무효해진 상태. 다시 검토하면 ThreadLocal 라우팅이 가장 단순하고 ADR-013 의 의도 (앱 모듈이 자기 DataSource 주입) 를 service 까지 완성 가능.

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
