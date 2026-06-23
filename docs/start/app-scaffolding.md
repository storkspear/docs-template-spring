# App Scaffolding — 앱 모듈 만들기와 지우기

> **유형**: How-to · **독자**: Level 1~2 · **읽는 시간**: ~20분

**설계 근거**: [`ADR-002 · Use this template`](../philosophy/adr-002-use-this-template.md) · [`ADR-005 · Postgres schema 격리`](../philosophy/adr-005-db-schema-isolation.md) · [`ADR-013 · 앱별 인증 엔드포인트`](../philosophy/adr-013-per-app-auth-endpoints.md)

## 개요

이 문서는 새 앱 도메인 모듈을 만드는 `tools/new-app/new-app.sh` 와, 그 정확한 역방향인 `tools/new-app/remove-app.sh` 를 자세히 다뤄요. [`onboarding.md`](./onboarding.md) 의 §3 이 "첫 앱을 올려서 Spring 을 띄우는" 흐름만 짧게 보여줬다면, 이 문서는 그 한 줄 명령이 안에서 무엇을 만들고 무엇을 검증하는지를 끝까지 풀어 줘요.

이 템플릿은 하나의 바이너리로 여러 앱을 호스팅하는 모듈러 모놀리스예요. 앱을 하나 추가하려면 [Gradle](../reference/glossary.md#프레임워크--빌드) 모듈, [AutoConfiguration](../reference/glossary.md#spring-어노테이션--런타임), 컨트롤러 스켈레톤, [Flyway](../reference/glossary.md#데이터베이스) 마이그레이션, DataSource 설정, `.env` 변수, Postgres [schema](../reference/glossary.md#데이터베이스) 와 [role](../reference/glossary.md#데이터베이스) 까지 여러 곳을 한꺼번에 손대야 해요. 이걸 매번 손으로 반복하면 빠뜨리는 곳이 생기죠. `new-app.sh` 는 이 과정을 한 번에, 멱등하게 처리합니다.

> **한 줄 요약** — 모듈러 모놀리스에 새 앱 도메인을 추가하는 스크립트예요. Gradle 모듈, Java 컨트롤러, Flyway 마이그레이션, `.env` 변수, Postgres schema·role 을 한 번에 만들고, Flyway 적용과 admin 시드까지 검증한 뒤 끝나요.
>
> **최소 명령**: `<repo> new <slug>` (또는 `./tools/new-app/new-app.sh <slug>`). DB schema·role 생성은 **기본 동작**이라 별도 플래그가 필요 없어요. DB 작업을 빼고 싶을 때만 `--skip-provision-db` 를 붙여요.

---

## 1. 사전 조건 — `<repo> init` 으로 환경 부팅

`new-app.sh` 는 로컬 환경이 이미 부팅된 상태를 가정해요. schema·role 을 만들려면 DB 에 접속할 수 있어야 하니까요. 처음 파생 레포를 clone 했다면 시간 순으로 이렇게 흘러가요.

```
git clone <파생레포>
    │
    ▼
./factory install              ← 짧은 호출용 symlink 등록 (머신마다 1회)
    │
    ▼
<repo> init                    ← prereqs 검증 · .env 생성 · docker 로 Postgres + MinIO 기동
    │
    ▼
<repo> new <slug>              ← 이 문서가 다루는 단계
    │
    ▼
<repo> restart                 ← 새 모듈을 spring jar 에 반영해 재기동
```

`<repo> init` (내부적으로 `tools/init-local.sh`) 이 해 주는 일은 다음과 같아요.

- [JDK](../reference/glossary.md#프레임워크--빌드) 21~25 · Docker · Node 18+ prereqs 체크 (없으면 즉시 멈춤)
- `.env` 준비 — 없으면 `.env.example` 에서 복사하고, `DB_PSQL_URL` 기본값도 같이 들어와요
- `npm install` 로 husky 훅 활성화
- docker 로 Postgres + MinIO 기동 후 Postgres ready 대기

이 상태까지 갖춰져 있어야 `new-app.sh` 가 DB 에 붙어서 schema·role 을 만들 수 있어요. 환경 셋업 전체 흐름은 [`onboarding.md §2`](./onboarding.md#2-레포-만들기--첫-기동) 에 단계별로 정리돼 있어요.

> 갓 만든 레포는 앱 모듈이 0개라 `init` 직후에는 Spring 이 아직 부팅되지 않아요. 빈 상태로 뜨는 걸 막는 안전장치예요 ([`ADR-037 · core schema 폐기`](../philosophy/adr-037-core-schema-deprecation.md)). 이 문서의 `new` 로 첫 앱을 추가하면 그때 Spring 이 부팅돼요.

---

## 2. 실행 방법

프로젝트 루트(`settings.gradle` 이 있는 디렉토리) 에서 실행해요.

```bash
<repo> new <slug>                        # 코드 + DB schema·role + Flyway 적용 (기본)
<repo> new <slug> --skip-provision-db    # 코드만 생성, DB 는 건드리지 않음
```

`<repo> new` 는 `<repo> new app <slug>` 와 같고, 둘 다 `./tools/new-app/new-app.sh <slug>` 를 호출해요. slug 를 생략하면 입력 prompt 가 떠요.

```bash
<repo> new gymlog
<repo> new my-app
<repo> new fintrack2
```

### 2.1 인자 요약

| 인자 | 설명 |
|---|---|
| `<slug>` | 앱 식별자. 소문자 알파벳으로 시작, 소문자·숫자·하이픈만 허용. 생략하면 prompt |
| `--skip-provision-db` | DB schema·role 생성과 Flyway 적용을 건너뜀. 코드 파일과 `.env` 항목만 만들어요 — §5 참조 |
| `--skip-verify` | Flyway 마이그레이션 적용과 SELECT 검증을 건너뜀 (CI 등에서 사용) |

> 예전 문서에 보이던 `--provision-db` 플래그는 지금도 받아들여지지만 **아무 동작도 하지 않는 no-op** 이에요. provisioning 이 기본이 되면서 의미가 사라졌거든요. 명령에 붙어 있어도 무해해요.

### 2.2 slug 검증 규칙

스크립트는 다음 정규식으로 slug 를 검증해요. 형식이 어긋나면 즉시 멈춰요.

```bash
# tools/new-app/new-app.sh — _valid_slug 발췌
[[ "$1" =~ ^[a-z][a-z0-9-]*$ ]]
```

### 2.3 slug 의 네 가지 변형

내부적으로 같은 slug 에서 네 가지 변형이 만들어져 각각 제 용도에 쓰여요.

| 변형 | 규칙 | `my-app` 예시 | 용도 |
|---|---|---|---|
| `SLUG` | 원본 | `my-app` | URL 경로(`/api/apps/my-app/...`), 디렉토리명 |
| `SLUG_PASCAL` | Pascal case | `MyApp` | Java 클래스명 |
| `SLUG_UPPER` | UPPER_SNAKE | `MY_APP` | 환경변수(`MY_APP_DB_URL`) |
| `SLUG_PACKAGE` | 하이픈 제거 | `myapp` | Java 패키지, Postgres 식별자(schema·role 이름) |

Postgres 는 식별자에 하이픈을 허용하지 않으므로, schema·role 이름에는 `SLUG_PACKAGE` 를 써요. 그래서 `my-app` 으로 만든 앱의 schema 는 `myapp` 이에요.

---

## 3. 자동으로 만들어지는 것

### 3.1 Gradle 모듈

```
apps/app-<slug>/
└── build.gradle
```

핵심 의존은 아래와 같아요.

```gradle
// tools/new-app/new-app.sh — build.gradle 템플릿 발췌
dependencies {
    implementation project(':core:core-auth-api')
    implementation project(':core:core-user-api')
    implementation project(':core:core-device-api')
    implementation project(':core:core-push-api')
    implementation project(':core:core-iap-api')
    implementation project(':core:core-payment-api')
    implementation project(':core:core-billing-api')
    implementation project(':core:core-phone-auth-api')
    implementation project(':common:common-web')
    implementation project(':common:common-persistence')
    implementation project(':common:common-security')

    // QueryDsl
    implementation "com.querydsl:querydsl-jpa:${libs.versions.querydsl.get()}:jakarta"
    annotationProcessor "com.querydsl:querydsl-apt:${libs.versions.querydsl.get()}:jakarta"

    implementation 'org.flywaydb:flyway-core'
    runtimeOnly 'org.flywaydb:flyway-database-postgresql'
    runtimeOnly 'org.postgresql:postgresql'
    // ...
}
```

앱 모듈은 `core-*-api` 에만 의존해요. `core-*-impl` 을 직접 의존하지 않아서 모듈 경계가 지켜집니다. 이 격리는 빌드 시점에 [`ArchUnit`](../reference/glossary.md#라이브러리--sdk) 이 강제해요.

### 3.2 Java 컨트롤러와 패키지 구조

```
apps/app-<slug>/src/main/java/com/factory/apps/<slugPackage>/
├── <SlugPascal>ApiEndpoints.java          ← 이 앱 전용 경로 상수 카탈로그
├── controller/
│   ├── <SlugPascal>HealthController.java
│   ├── <SlugPascal>AuthController.java
│   ├── <SlugPascal>PaymentController.java
│   └── <SlugPascal>IapController.java
├── service/
├── repository/
├── entity/
└── config/
    ├── <SlugPascal>AppAutoConfiguration.java
    └── <SlugPascal>DataSourceConfig.java
```

컨트롤러 네 개는 모두 `controller/` 안에 모여 있고, 경로는 패키지 루트의 `<SlugPascal>ApiEndpoints` 상수를 참조해요. 이 카탈로그 클래스가 앱 모듈 안에 닫혀 있어서, 코어의 공용 경로 목록을 건드리지 않고도 앱이 자기 path 만 관리해요.

**HealthController** 는 `GET /api/apps/<slug>/health` 를 제공해서 앱이 떴는지 빠르게 확인하게 해 줘요.

```java
// apps/app-<slug>/.../controller/<SlugPascal>HealthController.java 발췌
@RestController
@RequestMapping(<SlugPascal>ApiEndpoints.BASE)            // = /api/apps/<slug>
@Tag(name = "<slug>", description = "<SlugPascal> 앱 API")
public class <SlugPascal>HealthController {

    @GetMapping(<SlugPascal>ApiEndpoints.System.HEALTH)   // = /health
    public ApiResponse<Map<String, String>> health() {
        return ApiResponse.ok(Map.of("app", "<slug>", "status", "ok"));
    }
}
```

**AuthController** 는 `/api/apps/<slug>/auth/*` 경로의 얇은 컨트롤러예요. 이메일 가입·로그인, Apple·Google 소셜 로그인, 토큰 refresh, 비밀번호 재설정, 2FA 등을 [`AuthPort`](../reference/glossary.md#아키텍처-용어) 에 위임해요. **PaymentController** 와 **IapController** 도 같은 패턴으로 PG 결제와 인앱 결제 엔드포인트를 노출해요.

> 코어의 `AuthController` 는 런타임 bean 으로 등록되지 않아요. 앱 모듈이 추가되는 순간부터 그 slug 의 인증 엔드포인트만 노출됩니다. 앱이 0개인 템플릿 상태에서는 인증 엔드포인트가 전혀 노출되지 않아요. 이 결정의 근거는 [`ADR-013`](../philosophy/adr-013-per-app-auth-endpoints.md) 에 있어요.

### 3.3 AutoConfiguration 등록

```java
// apps/app-<slug>/.../config/<SlugPascal>AppAutoConfiguration.java
@AutoConfiguration
@Profile("!test")
@ComponentScan(basePackages = "com.factory.apps.<slugPackage>")
public class <SlugPascal>AppAutoConfiguration {
}
```

`@Profile("!test")` 가 붙어 있어서 bootstrap 테스트(단일 [Testcontainers](../reference/glossary.md#테스팅) DB) 환경에서는 슬러그 모듈이 비활성화돼요. 슬러그별 schema 가 없는 테스트 환경에서도 부팅이 막히지 않게 하려는 장치예요. 같은 이유로 `<SlugPascal>DataSourceConfig` 에도 `@Profile("!test")` 가 붙어 있어요.

Spring Boot 가 이 설정을 인식하도록 `AutoConfiguration.imports` 파일도 같이 생성돼요.

```
apps/app-<slug>/src/main/resources/META-INF/spring/
└── org.springframework.boot.autoconfigure.AutoConfiguration.imports
```

내용은 한 줄이에요.

```
com.factory.apps.<slugPackage>.config.<SlugPascal>AppAutoConfiguration
```

### 3.4 DataSource Config — 앱별 격리

각 앱은 독립된 schema, DataSource, Flyway 히스토리를 가져요. `<SlugPascal>DataSourceConfig` 가 이걸 담당해요.

```java
// apps/app-<slug>/.../config/<SlugPascal>DataSourceConfig.java 발췌
@Configuration
@Profile("!test")
@EnableJpaRepositories(
    basePackages = "com.factory.apps.<slugPackage>.repository",
    entityManagerFactoryRef = "<slugPackage>EntityManagerFactory",
    transactionManagerRef = "<slugPackage>TransactionManager"
)
public class <SlugPascal>DataSourceConfig extends AbstractAppDataSourceConfig {

    public <SlugPascal>DataSourceConfig(
        @Value("${<SLUG_UPPER>_DB_URL:}") String url,
        @Value("${<SLUG_UPPER>_DB_USER:}") String user,
        @Value("${<SLUG_UPPER>_DB_PASSWORD:}") String password,
        @Value("${DB_URL:}") String coreUrl,
        @Value("${DB_USER:}") String coreUser,
        @Value("${DB_PASSWORD:}") String corePassword
    ) {
        super("<slugPackage>", url, user, password, coreUrl, coreUser, corePassword);
    }

    @Bean(name = "<slugPackage>DataSource")
    public DataSource <slugPackage>DataSource() {
        return buildDataSource();
    }

    @Bean(name = "<slugPackage>EntityManagerFactory")
    @DependsOn("<slugPackage>Flyway")   // Flyway 선행 → hbm2ddl=validate 통과
    public LocalContainerEntityManagerFactoryBean <slugPackage>EntityManagerFactory(
        @Qualifier("<slugPackage>DataSource") DataSource ds
    ) {
        return buildEntityManagerFactory(ds);
    }
    // ... TransactionManager, Flyway 빈도 같은 패턴
}
```

`AbstractAppDataSourceConfig` 가 `build*` 헬퍼를 제공하고, concrete class 가 `@Bean` 으로 래핑해요. 이렇게 하면 앱마다 [`HikariCP`](../reference/glossary.md#데이터베이스) 풀이 하나씩 생기고, 빈 이름이 `<slugPackage>` prefix 로 유니크하게 갈라져 여러 앱이 한 JVM 에서 충돌 없이 공존해요.

> 생성자가 슬러그 자격(`<SLUG_UPPER>_DB_*`)과 코어 자격(`DB_*`) 을 함께 받는 게 핵심이에요. 슬러그 자격이 비어 있으면 `AbstractAppDataSourceConfig` 가 코어 `DB_URL` 에서 `currentSchema` 만 슬러그로 바꿔 자동 derive 해요. 그래서 운영 `.env.prod` 는 코어 `DB_URL` 한 벌만 채우면 멀티앱이 자동으로 동작합니다. 설계 상세는 [`ADR-018 · SchemaRoutingDataSource`](../philosophy/adr-018-schema-routing-datasource.md) 를 참고하세요.

Repository scan 을 `apps.<slugPackage>.repository` 로만 한정하는 건, `core-*` 레포지토리가 이미 자기 AutoConfiguration 의 `@EnableJpaRepositories` 로 default EMF 에 등록됐기 때문이에요. 여기서 코어 패키지를 다시 스캔하면 `BeanDefinitionOverrideException` 이 나요.

### 3.5 Flyway Migration — 공통 V001~V015

```
apps/app-<slug>/src/main/resources/db/migration/<slugPackage>/
├── V001__init_users.sql
├── V002__init_social_identities.sql
├── V003__init_refresh_tokens.sql
├── V004__init_email_verification_tokens.sql
├── V005__init_password_reset_tokens.sql
├── V006__init_devices.sql
├── V008__init_plans.sql
├── V009__init_subscriptions.sql
├── V010__init_webhook_events.sql
├── V011__init_renewal_attempts.sql
├── V012__init_audit_logs.sql
├── V013__add_totp_to_users.sql
├── V014__init_user_notification_preferences.sql
└── V015__init_phone_otp_codes.sql
```

`new-app.sh` 가 깔아 주는 공통 마이그레이션은 V001~V015 로, 모든 앱이 똑같이 받는 인증·결제·알림 기반이에요. 어떤 버전이 무엇을 담는지는 아래와 같아요.

| 버전 | 내용 | 비고 |
|---|---|---|
| **V001 ~ V006** | 인증 기반 (users · social_identities · refresh_tokens · email/password 토큰 · devices) | 모든 앱 공통 |
| **V007** | admin user 시드 (`V007__seed_admin_user.sql`) | 도메인 테이블이 아니라 첫 관리자 계정 1명. §5.2 |
| **V008 ~ V012** | 결제·구독·감사 (plans · subscriptions · webhook_events · renewal_attempts · audit_logs) | |
| **V013 ~ V014** | 2FA(TOTP) 컬럼 · 사용자 알림 채널 toggle | |
| **V015** | phone_otp_codes (휴대폰 점유인증) | 옵트인 — 점유인증을 안 쓰면 이 파일은 삭제해도 돼요 |

여기서 V007 만 위 디렉토리 목록에 없는 걸 눈치챘을 거예요. `V007__seed_admin_user.sql` 은 Step 6 의 테이블 마이그레이션과 따로, DB provisioning 이 끝난 뒤 별도 단계에서 생성돼요 (§5.2). 본인 도메인 테이블은 V001~V015 다음 빈 번호인 **V016 부터** 직접 작성하면 돼요 (§7).

마이그레이션 경로가 `db/migration/<slugPackage>/` 처럼 하이픈을 뺀 패키지명으로 격리돼 있어서, 각 앱 DataSource 의 Flyway 가 자기 디렉토리만 읽어요.

### 3.6 README · settings.gradle · bootstrap.gradle 업데이트

`apps/app-<slug>/README.md` 에 해당 앱의 구조와 템플릿 동기화 방법이 기록돼요. `template-v*` 태그가 있으면 그 버전도 함께 적어요.

그리고 다음 두 파일에 자동으로 줄이 추가돼요.

```gradle
// settings.gradle
include ':apps:app-<slug>'
```

```gradle
// bootstrap/build.gradle
dependencies {
    // ...
    implementation project(':apps:app-<slug>')
}
```

bootstrap 이 앱 모듈을 `implementation` 으로 의존해야 `@AutoConfiguration` 이 활성화되고 컨트롤러가 런타임에 노출돼요.

---

## 4. 환경 변수 (`.env`) 주입

`.env` 파일이 없으면 `.env.example` 에서 복사하고, 다음 변수들을 슬러그 섹션 헤더 아래에 추가해요. 이미 같은 키가 있으면 건드리지 않아요 (§6 멱등성 참조).

### 4.1 DB 변수

```env
<SLUG_UPPER>_DB_URL=jdbc:postgresql://<host>:<port>/postgres?currentSchema=<slugPackage>
<SLUG_UPPER>_DB_USER=<slugPackage>_app
<SLUG_UPPER>_DB_PASSWORD=CHANGE_ME
```

`<host>:<port>` 는 `DB_PSQL_URL` 에서 그대로 가져와 채워요. 로컬 docker 라면 `localhost:5433` 이 자동으로 들어가니 손댈 게 없어요. provisioning 이 끝나면 `<SLUG_UPPER>_DB_PASSWORD=CHANGE_ME` 자리는 랜덤 생성된 비밀번호로 자동 치환돼요 (§5.1).

> 운영(`.env.prod`)으로 넘어갈 때는 보통 이 슬러그별 자격을 **비워 두고** 코어 `DB_URL` 한 벌만 채워요. §3.4 의 derive 로직이 슬러그별 URL 을 자동으로 만들어 주거든요.

### 4.2 MinIO 버킷

```env
APP_STORAGE_MINIO_BUCKETS_<N>=<slug>-uploads
```

`<N>` 은 기존 `APP_STORAGE_MINIO_BUCKETS_*` 변수들의 최대 인덱스 + 1 로 정해져요. Spring 기동 시 `BucketProvisioner` 가 `<slug>-uploads` 버킷을 [MinIO](../reference/glossary.md#운영--인프라) 에 자동 생성해요. 멱등이라 재기동해도 중복 에러가 없어요. `images`·`exports` 같은 추가 카테고리는 운영자가 `.env` 에 직접 더하면 돼요.

### 4.3 소셜 로그인·결제 Credentials

```env
APP_CREDENTIALS_<SLUG_UPPER>_GOOGLE_CLIENT_IDS_0=CHANGE_ME
APP_CREDENTIALS_<SLUG_UPPER>_GOOGLE_CLIENT_IDS_1=CHANGE_ME
APP_CREDENTIALS_<SLUG_UPPER>_APPLE_BUNDLE_ID=<app-package>
APP_CREDENTIALS_<SLUG_UPPER>_IAP_APPLE_BUNDLE_ID=<app-package>
APP_CREDENTIALS_<SLUG_UPPER>_IAP_GOOGLE_PACKAGE_NAME=<app-package>
APP_CREDENTIALS_<SLUG_UPPER>_FCM_SERVICE_ACCOUNT_JSON=
```

`<app-package>` 는 `.env` 의 `APP_PACKAGE_PREFIX` 나 `BASE_DOMAIN` 을 보고 `cloud.storkspear.<slug>` 같은 형태로 추정해 채워요. 둘 다 없으면 `com.example.<slug>` placeholder 가 들어가는데, 로컬 테스트엔 무방하지만 실제 스토어 등록 전에는 본인 값으로 바꿔야 해요. 실제 값 발급 방법은 [`소셜 로그인 설정 가이드`](./social-auth-setup.md) 를 참고하세요. `FCM_SERVICE_ACCOUNT_JSON` 은 비워 두면 푸시 발송이 graceful no-op 이라, 푸시를 쓸 때만 채우면 돼요.

### 4.4 멱등성 — 이미 있는 키는 skip

`.env` 에 같은 키가 이미 있으면 덮어쓰지 않고 넘어가요. 같은 명령을 다시 돌려도 기존 값은 안전해요.

```bash
# tools/new-app/new-app.sh — inject_env_line 헬퍼 발췌
if grep -qE "^${key}=" .env 2>/dev/null; then
    info "  skip: ${key} already in .env"
    return 0
fi
echo "${key}=${value}" >> .env
```

`.env`·Gradle·DB 전체 멱등성 매트릭스는 §6 을 참조하세요.

---

## 5. Postgres Schema·Role Provisioning

앞 §3, §4 가 코드와 설정 파일을 만들었다면, 이 단계는 실제 DB 에 물리적으로 공간을 마련해요. provisioning 은 **기본 동작**이라 `new` 명령만으로 일어나요. 코드만 만들고 DB 는 따로 처리하고 싶을 때만 `--skip-provision-db` 로 꺼요.

스크립트는 본격적으로 시작하기 전에 DB 연결을 먼저 확인해요 (Step 0). `DB_PSQL_URL` 로 `SELECT 1` 이 통과해야 진행하고, 주소가 `localhost`·`127.0.0.1`·`host.docker.internal` 이 아니면 "운영 DB 감지" confirm 을 띄워 사고를 막아요.

### 5.1 이 단계가 하는 일

`new-app.sh` 는 `psql` 로 `infra/scripts/init-app-schema.sql` 을 실행해 세 가지를 수행해요.

1. **Schema 생성** — `CREATE SCHEMA IF NOT EXISTS <slugPackage>`
2. **Role 생성** — `CREATE ROLE <slugPackage>_app LOGIN PASSWORD <random>` (이미 있으면 skip)
3. **권한 부여** — 해당 schema 의 테이블·시퀀스에 ALL 권한을 주고, 이후 생성될 객체에도 default privileges 를 적용. `public` schema 접근은 revoke

비밀번호는 `openssl rand -hex 24` 로 48자 hex 를 만들어, `.env` 의 `<SLUG_UPPER>_DB_PASSWORD=CHANGE_ME` 자리에 자동으로 치환해요.

### 5.2 admin user 시드와 Flyway 적용·검증

provisioning 이 끝나면 스크립트가 거기서 멈추지 않고, 실제로 마이그레이션을 적용하고 검증까지 해요. 이 흐름이 `--skip-provision-db` 없이 돌렸을 때의 happy path 예요.

```
schema·role 생성 (Step 14)
   ↓
V007__seed_admin_user.sql 생성 (Step 15)   ← admin 계정 1명 INSERT
   ↓
Flyway migrate-only 로 V001~V015 적용 (Step 16)
   ↓
admin user SELECT 검증 (Step 17)            ← 시드 row 가 보이는지 확인
```

`V007__seed_admin_user.sql` 은 임시 관리자 계정(`admin@<slug>.local` / 비밀번호 `admin1234`)을 넣어요. 시드가 필요 없으면 이 파일을 지우고 spring 을 재기동하면 돼요. **운영에서는 첫 로그인 직후 반드시 비밀번호를 바꿔야 해요.**

Step 16 은 web server 를 띄우지 않는 migrate-only 모드로 Flyway 를 돌려 V001~V015 를 적용하고, Step 17 은 `flyway_schema_history` 와 `users` 테이블을 직접 조회해 마이그레이션과 시드가 실제로 반영됐는지 확인해요. 그래서 `new` 가 정상 종료했다면 DB 는 이미 준비된 상태예요.

### 5.3 로컬 docker 에 provision 하는 경우

`.env.example` 에 다음 값이 기본으로 들어 있어서 추가 설정 없이 바로 동작해요.

```env
DB_PSQL_URL=postgresql://postgres:dev@localhost:5433/postgres
```

```bash
<repo> new gymlog        # .env 의 DB_PSQL_URL 로 로컬 docker postgres 에 provision
```

`DB_PSQL_URL` 이 shell 에 없으면 스크립트가 `.env` 에서 자동으로 읽어요. 로컬 docker 환경은 결정적이라 사용자가 손댈 게 없어요.

### 5.4 운영 DB 에 provision 하는 경우

운영 admin 자격은 `.env` 에 저장하지 말고 shell 에서 일시 export 해요. shell 환경변수가 `.env` 값보다 우선하므로 로컬 기본값을 자연스럽게 덮어써요.

```bash
# Supabase / RDS / Fly.io 등 운영 Postgres admin 자격
export DB_PSQL_URL='postgresql://postgres.<ref>:<pw>@aws-1-<region>.pooler.supabase.com:5432/postgres'
<repo> new gymlog

# 작업이 끝나고 shell 을 닫으면 export 가 자연스럽게 사라져요
```

`DB_PSQL_URL` 은 schema·role 을 **생성할 권한이 있는 관리자 자격**이어야 해요 (앱 role 이 아니라). 로컬에선 docker-compose 의 superuser, 운영에선 [Supabase](../reference/glossary.md#데이터베이스) 의 `postgres` 같은 계정이에요. `psql` 도 설치돼 있어야 해요 (`brew install libpq` 또는 `postgresql`).

### 5.5 `provision_db` 함수 내부 동작

```bash
# tools/new-app/new-app.sh — provision_db 발췌
provision_db() {
    local SLUG_IDENT="$1"      # schema 이름
    local SLUG_PACKAGE="$2"    # role prefix

    # DB_PSQL_URL 이 shell 에 없으면 .env 에서 자동 로드 (로컬 docker 케이스)
    if [[ -z "${DB_PSQL_URL:-}" ]] && [[ -f .env ]]; then
        DB_PSQL_URL=$(grep -E '^DB_PSQL_URL=' .env | head -1 | cut -d= -f2- | tr -d '"' || true)
        export DB_PSQL_URL
    fi

    local password
    password=$(openssl rand -hex 24)

    APP_SLUG="${SLUG_IDENT}" APP_ROLE="${SLUG_PACKAGE}_app" APP_PASSWORD="${password}" \
    psql "${DB_PSQL_URL}" \
        -v ON_ERROR_STOP=1 \
        -v app_slug="${SLUG_IDENT}" \
        -v app_role="${SLUG_PACKAGE}_app" \
        -v app_password="${password}" \
        -f "${REPO_ROOT}/infra/scripts/init-app-schema.sql"

    # .env 의 _DB_PASSWORD 를 생성된 값으로 교체
    if grep -q "^${SLUG_UPPER}_DB_PASSWORD=CHANGE_ME$" .env; then
        sed_inplace "s|^${SLUG_UPPER}_DB_PASSWORD=CHANGE_ME$|${SLUG_UPPER}_DB_PASSWORD=${password}|" .env
    fi
}
```

### 5.6 `init-app-schema.sql` 이 수행하는 SQL

```sql
-- infra/scripts/init-app-schema.sql (요약)

-- 1. Schema 생성 (이미 있으면 skip)
CREATE SCHEMA IF NOT EXISTS <app_slug>

-- 2. Role 생성 (pg_roles 에 없을 때만)
CREATE ROLE <app_role> LOGIN PASSWORD <app_password>

-- 3. schema 권한 — Flyway 가 flyway_schema_history 생성 + DDL 실행 가능해야 함
GRANT USAGE, CREATE ON SCHEMA <app_slug> TO <app_role>
GRANT ALL ON ALL TABLES IN SCHEMA <app_slug> TO <app_role>
GRANT ALL ON ALL SEQUENCES IN SCHEMA <app_slug> TO <app_role>

-- 4. Default privileges — 이후 생성될 테이블·시퀀스에도 자동 적용
ALTER DEFAULT PRIVILEGES IN SCHEMA <app_slug> GRANT ALL ON TABLES TO <app_role>
ALTER DEFAULT PRIVILEGES IN SCHEMA <app_slug> GRANT ALL ON SEQUENCES TO <app_role>

-- 5. public schema 접근 금지 (5중 방어선 #1)
REVOKE ALL ON SCHEMA public FROM <app_role>
```

SQL 도 slug 형식을 방어해요. Postgres 식별자는 소문자·숫자·밑줄만 허용하므로, 하이픈이 들어간 slug 는 `SLUG_PACKAGE`(하이픈 제거) 로 변환되어 전달돼요. 형식이 어긋나면 division-by-zero 로 실행이 중단돼요.

---

## 6. 멱등성

`new-app.sh` 는 같은 slug 로 두 번 실행하는 걸 **허용하지 않아요**. 앱 모듈 디렉토리가 이미 있으면 즉시 멈춰요.

```bash
# tools/new-app/new-app.sh 발췌
APP_DIR="${REPO_ROOT}/apps/app-${SLUG}"
if [[ -d "${APP_DIR}" ]]; then
    fail "이미 존재합니다: ${APP_DIR}"
fi
```

그 대신, 실패 시 자동 롤백이 있어서 중간에 멈춰도 깔끔해요. 스크립트는 시작할 때 trap 을 걸어 두고, 어느 단계에서 실패하든 그때까지 만든 결과물을 전부 되돌려요 — 앱 디렉토리, `settings.gradle` 줄, `bootstrap/build.gradle` 줄, `.env` 추가 라인, 그리고 DB schema·role 까지. 그래서 실패 후에는 원인만 고쳐 다시 실행하면 돼요. 손으로 정리할 게 거의 없어요.

스크립트가 건드리는 개별 요소들은 각각 멱등하게 설계돼 있어요.

| 대상 | 멱등성 | 구현 방식 |
|---|---|---|
| `apps/app-<slug>/` 디렉토리 | 없음 | 존재 시 스크립트 종료 |
| `settings.gradle` 의 include 줄 | 있음 | grep 체크 후 skip |
| `bootstrap/build.gradle` 의 implementation 줄 | 있음 | 같은 줄 있으면 skip |
| `.env` 변수 (`<SLUG>_DB_*`, `APP_CREDENTIALS_*`, `MINIO_BUCKETS_*`) | 있음 | 키 존재 시 skip |
| Postgres schema 생성 | 있음 | `CREATE SCHEMA IF NOT EXISTS` |
| Postgres role 생성 | 있음 | `pg_roles` 체크 후 skip |
| `.env` 의 `_DB_PASSWORD=CHANGE_ME` 치환 | 있음 | `CHANGE_ME` 일 때만 치환 |

---

## 7. 실행 후 남은 수동 작업

스크립트가 성공하면 무엇을 자동으로 했고 무엇이 남았는지 안내해요. 실제 출력은 다음과 같아요.

```
자동 수행됨:
  ✅ Java 모듈 scaffolding (Step 1~9)
  ✅ .env 에 DB / bucket / credentials placeholder 추가 (Step 10~13)
  ✅ Postgres schema + role 생성 (Step 14)
  ✅ V007__seed_admin_user.sql 자동 생성 (Step 15)
  ✅ Flyway V001~V015 적용 (Step 16, migrate-only)
  ✅ admin user 시드 SELECT 검증 (Step 17)

임시 admin 계정 (운영에선 즉시 변경 필수):
  email:    admin@<slug>.local
  password: admin1234

남은 수동 작업:

1. (선택) 소셜 로그인 credentials 채움:
   - APP_CREDENTIALS_<SLUG_UPPER>_GOOGLE_CLIENT_IDS_0/1, _APPLE_BUNDLE_ID
   → 발급 방법: docs/start/social-auth-setup.md

2. (선택) FCM 푸시 발송 켜기:
   APP_CREDENTIALS_<SLUG_UPPER>_FCM_SERVICE_ACCOUNT_JSON 가 비어있으면 graceful no-op

3. 도메인 테이블 작성:
   apps/app-<slug>/src/main/resources/db/migration/<slugPackage>/V016__init_<your-domain>.sql

4. 커밋:
   feat(apps): scaffold app-<slug>
```

이어서 빨간 배너로 가장 중요한 다음 동작을 한 번 더 강조해요.

### 7.1 반드시 — spring 재기동

이미 떠 있는 spring 프로세스는 새 모듈을 자동으로 감지하지 못해요. 새 controller 와 `DataSourceConfig` 가 jar 에 컴파일돼야 `/api/apps/<slug>/*` 가 동작하므로, `new` 뒤에는 재기동이 필요해요.

```bash
<repo> restart      # spring 컨테이너만 재빌드 + 재기동 (다른 컨테이너는 유지)
<repo> test         # spring UP 재확인
```

재기동 후 다음 명령으로 `<slugPackage>` DataSource 등록을 검증할 수 있어요.

```bash
curl -s http://localhost:8081/actuator/health | jq '.components.db.components | keys'
# → ['<slugPackage>', ...] 처럼 슬러그가 포함되면 OK
```

### 7.2 도메인 테이블은 V016 부터

본인 비즈니스 로직 테이블은 `V016__init_<your-domain>.sql` 부터 작성해요. V001~V015 가 이미 차 있고 V007 은 도메인이 아니라 관리자 시드라, 그다음 빈 번호가 V016 이에요.

### 7.3 `--skip-provision-db` 로 돌렸다면

이 플래그를 붙이면 코드 파일과 `.env` 항목만 만들고 DB·시드·Flyway 적용은 모두 건너뛰어요. 이 경우 schema 를 직접 만들거나, 아래처럼 한 번 더 그냥 `new` 로 이어가면 돼요. 멱등 요소가 skip 되어 코드 파일은 그대로 두고 DB schema·role 만 추가로 생성해요.

```bash
# 직접 schema 생성
export APP_SLUG=<slugPackage> APP_ROLE=<slugPackage>_app APP_PASSWORD='강력한비번'
psql "$DB_PSQL_URL" -f infra/scripts/init-app-schema.sql
```

---

## 8. 문제 해결

### 8.1 "이미 존재합니다" 에러

같은 slug 로 다시 실행했거나, 과거 실행물이 일부 남은 경우예요. 정상 실패는 자동 롤백되므로 보통 남지 않지만, 손으로 만든 잔재가 있다면 디렉토리와 Gradle 줄을 정리하고 다시 실행해요.

```bash
rm -rf apps/app-<slug>
# settings.gradle 과 bootstrap/build.gradle 의 해당 줄도 제거
<repo> new <slug>
```

### 8.2 Flyway checksum mismatch

V001~V015 의 체크섬이 맞지 않으면 Flyway 가 거부해요. 공통 마이그레이션을 수정하지 않았다면 원인은 대개 DB 에 남은 이전 실행 흔적이에요. 로컬에서만 schema 를 drop 하고 재생성하세요. 운영에서는 이 방법을 쓰면 안 되고 `flyway repair` 또는 새 번호로 해결해요.

```sql
DROP SCHEMA <slugPackage> CASCADE;
-- 그다음 new 재실행 또는 init-app-schema.sql 수동 실행
```

### 8.3 `<SLUG_UPPER>_DB_PASSWORD=CHANGE_ME` 가 남아 있음

`--skip-provision-db` 를 썼거나, 스크립트가 치환 전에 실패한 경우예요. `.env` 에 직접 값을 넣거나, schema 를 drop 한 뒤 `new` 로 재실행하면 자동 치환돼요.

### 8.4 Postgres identifier 에러 (하이픈 관련)

slug 자체는 하이픈을 허용하지만, schema·role 이름에는 `SLUG_PACKAGE`(하이픈 제거) 가 쓰여요. `my-app` slug 의 schema 는 `myapp` 이에요. 수동 `psql` 명령을 돌릴 때 `APP_SLUG` 는 반드시 하이픈을 뺀 버전으로 지정하세요.

---

## 9. 한눈에 요약

| 항목 | 내용 |
|---|---|
| **사전 조건** | `<repo> init` 선행 (docker postgres 기동 + `.env` 준비) |
| **최소 명령** | `<repo> new <slug>` — DB provisioning 이 기본 |
| **DB 끄기** | `--skip-provision-db` 로 코드만 생성 |
| **slug 규칙** | `^[a-z][a-z0-9-]*$`, 내부 4종 변형 전개 |
| **생성되는 것** | Gradle 모듈 · 컨트롤러 4종(Health·Auth·Payment·Iap) · ApiEndpoints · AutoConfiguration · DataSource · Flyway V001~V015 · README · settings.gradle / bootstrap.gradle 업데이트 |
| **`.env` 주입** | DB 3종 · MinIO `<slug>-uploads` · 소셜·IAP·FCM credentials placeholder |
| **provisioning** | schema + role + grant 생성, 비밀번호 랜덤 생성 후 `.env` 치환 |
| **검증** | V007 admin 시드 생성 → V001~V015 Flyway 적용 → admin SELECT 확인 |
| **로컬 docker** | `.env` 의 `DB_PSQL_URL` 기본값 자동 로드 — export 불필요 |
| **운영 DB** | `export DB_PSQL_URL='postgresql://...'` 로 일시 덮어쓰기 |
| **실패 시** | 자동 롤백 (디렉토리 · Gradle · `.env` · DB schema·role) |
| **재기동** | `new` 후 `<repo> restart` 필수 — 새 코드 반영 |
| **남은 수동 작업** | (선택) credentials · V016 도메인 테이블 · 커밋 |

---

## 10. 앱 모듈 제거 (`remove-app.sh`)

앞의 §1~§9 가 앱을 추가하는 흐름이라면, `tools/new-app/remove-app.sh` 는 그 정확한 역방향이에요. `new-app.sh` 가 만든 것을 전부 되돌려 앱을 코드 레벨까지 완전히 은퇴시켜요.

```bash
<repo> remove <slug>          # 1회 confirm ('y' 입력)
<repo> remove <slug> --yes    # confirm 생략 (자동화)
```

`<repo> remove` 는 `<repo> remove app <slug>` 와 같고, 둘 다 `remove-app.sh` 를 호출해요.

### 10.1 제거 대상 — `new-app.sh` 가 추가한 것의 역

| 대상 | 동작 |
|---|---|
| **코드 모듈** | `apps/app-<slug>/` 디렉토리 `rm -rf` + `settings.gradle` include 줄 + `bootstrap/build.gradle` implementation 줄 제거 |
| **`.env` · `.env.dev`** | `<SLUG_UPPER>_DB_*` · `APP_CREDENTIALS_<SLUG_UPPER>_*` · `<slug>-` bucket 라인 + `# ─── app-<slug> ───` 헤더 제거. `.env.prod` 라인은 보존 |
| **DB schema·role** | local(5433) 과 dev(`.env.dev` 의 `DB_URL`) 의 `<slugPackage>` schema 와 `<slugPackage>_app` role 을 `DROP SCHEMA ... CASCADE` + `DROP ROLE` |
| **Firebase 프로젝트** | dev 프로젝트는 confirm 후 삭제 (gcloud 필요, 30일 복구 가능). prod 는 자동 삭제하지 않고 Console 링크만 안내 |

`new-app.sh` 가 건드린 곳과 정확히 같은 지점을 역순으로 정리하므로, 추가와 제거를 반복해도 잔재가 남지 않아요.

### 10.2 prod 는 차단 — 실데이터 + 공유 소스 보호

`remove-app.sh` 는 prod DB schema 를 절대 건드리지 않아요. local 과 dev 만 정리하고, `.env.prod` 라인도 보존해요. factory 레벨에서도 `prod remove app` 과 `all remove app` 은 에러로 차단됩니다.

```
❌ prod 앱 제거(remove app)는 미지원 — 실데이터 + 공유 소스 보호.
```

두 가지를 지키려는 안전장치예요. 운영 DB 에는 진짜 사용자 데이터가 있어서 `DROP SCHEMA ... CASCADE` 를 그대로 적용하면 되돌릴 수 없고, 코드 모듈을 먼저 지우면 그 코드로 다시 빌드·롤백·재배포하는 길이 막히거든요.

실행 시점에 `.env.prod` 의 DB 에 해당 slug schema 가 살아 있으면 (= prod 에 배포된 채면) "코드를 지우면 prod 재배포 불가" 경고를 띄워요. 이 검사는 read-only 라 prod 는 읽기만 하고 바꾸지 않아요.

prod 에 배포된 앱을 완전히 내릴 때는 데이터 정리와 코드 제거를 나눠 단계적으로 진행해요.

```
① 데이터 백업 (pg_dump --schema=<slug> + MinIO mirror)
② <repo> prod force-clear <slug>   (prod 데이터·인프라 영구 삭제)
③ undeploy 확인
④ <repo> remove <slug>             (그제서야 코드 모듈 + local·dev schema 제거)
```

### 10.3 `force-clear` 와의 구분

| 명령 | 다루는 것 | 코드 모듈 | 용도 |
|---|---|---|---|
| `force-clear <slug>` | 배포된 데이터·인프라 (schema · bucket · 컨테이너) | 유지 | 재배포 가능 — 데이터만 초기화 |
| `remove <slug>` | 코드 모듈 + `.env` 라인 + local·dev schema·role | 제거 | 앱 완전 은퇴 (`new` 의 역) |

MinIO 버킷과 운영 컨테이너 정리는 `force-clear` 가 맡고, `remove-app.sh` 는 코드 모듈과 DB schema·role 만 다뤄요. 둘을 조합하면 한 앱을 데이터·인프라부터 코드까지 완전히 폐기할 수 있어요 ([`CLI 가이드`](./cli-guide.md) 의 prod 앱 은퇴 절차 참조).

---

## 다음 단계

새 앱 모듈이 준비됐다면 다음으로 진행하세요.

- **도메인 코드 작성** — `apps/app-<slug>/` 에 Controller · Service · Entity · Repository 추가
- **소셜 로그인 설정** — [`소셜 로그인 설정 가이드`](./social-auth-setup.md) — Google·Apple 자격 발급
- **Flutter 연동** — [`Flutter ↔ Backend Integration`](../api-and-functional/api/flutter-backend-integration.md)
- **배포** — [`운영 배포 가이드`](../production/deploy/deployment.md)

---

## 관련 문서

- [`Onboarding — 템플릿 첫 사용 가이드`](./onboarding.md) — 환경 셋업 + 첫 기동
- [`소셜 로그인 설정 가이드`](./social-auth-setup.md) — Google·Apple 자격 발급
- [`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md) — 운영 검증 사이클
- [`Multitenant Architecture`](../structure/multitenant-architecture.md) — schema 격리 + DataSource 설계 상세
- [`ADR-005 · Postgres schema 격리`](../philosophy/adr-005-db-schema-isolation.md) — schema 격리 결정 근거
- [`ADR-013 · 앱별 인증 엔드포인트`](../philosophy/adr-013-per-app-auth-endpoints.md) — 앱별 controller 패턴 결정
- [`ADR-018 · SchemaRoutingDataSource`](../philosophy/adr-018-schema-routing-datasource.md) — `AbstractAppDataSourceConfig` 의 derive 로직
