# App Scaffolding (`new-app.sh`)

> **유형**: How-to · **독자**: Level 1~2 · **읽는 시간**: ~20분

**설계 근거**: [ADR-002 (Use this template)](../philosophy/adr-002-use-this-template.md) · [ADR-005 (Postgres schema 격리)](../philosophy/adr-005-db-schema-isolation.md) · [ADR-013 (앱별 인증 엔드포인트)](../philosophy/adr-013-per-app-auth-endpoints.md)

## 개요

이 문서는 새로운 앱 도메인 모듈을 생성하는 `tools/new-app/new-app.sh` 스크립트를 정리합니다.

템플릿은 하나의 바이너리로 여러 앱을 호스팅하는 **모듈러 모놀리스** 구조입니다. 앱을 추가할 때 Gradle 모듈, AutoConfiguration, 컨트롤러 스켈레톤, Flyway 마이그레이션, DataSource 설정, `.env` 변수, Postgres schema/role 까지 **여러 곳을 동시에** 건드려야 하는데, 이를 수작업으로 반복하면 실수가 쌓입니다. `new-app.sh` 는 이 과정을 **한 번에, 멱등하게** 수행합니다.

> **한 줄 요약** — 모듈러 모놀리스에 새 앱 도메인을 추가하는 스크립트. Gradle 모듈 · Java 컨트롤러 · Flyway 마이그레이션 · `.env` 변수 · Postgres schema/role 을 **한 번에, 멱등하게** 생성합니다.
>
> **최소 명령**: `./tools/new-app/new-app.sh <slug> --provision-db` — `--provision-db` 를 붙이면 DB schema/role 까지 자동 생성되므로 **기본으로 붙이길 권장**합니다.

---

## 1. 사전 조건 — `bootstrap.sh` 먼저 돌린 상태

`new-app.sh` 는 환경이 이미 부팅된 상태를 가정합니다. 처음 파생 레포를 clone 했다면 다음 순서로 진행합니다.

```
git clone <파생레포>
    │
    ▼
./tools/bootstrap.sh           ← prereqs 검증, .env 생성, docker compose(postgres+minio) 기동
    │
    ▼
./tools/new-app/new-app.sh <slug> --provision-db   ← 이 문서가 다루는 단계
    │
    ▼
./gradlew :bootstrap:bootRun   ← Spring 기동, 모듈 자동 로딩
```

`bootstrap.sh` 가 해주는 것:

- JDK 21+ / Docker / Node 18+ prereqs 체크 (없으면 즉시 fail)
- `.env` 준비 (없으면 `.env.example` 에서 복사 — `DATABASE_URL` 기본값 포함)
- `npm install` 자동 실행 → husky 훅 활성화
- docker compose 로 Postgres + MinIO 기동
- Postgres ready 대기

이 상태까지 갖춰져 있어야 `new-app.sh` 가 DB 에 접속해서 schema/role 을 만들 수 있습니다.

---

## 2. 실행 방법

프로젝트 루트(`settings.gradle` 이 있는 디렉토리) 에서 실행합니다.

```bash
./tools/new-app/new-app.sh <slug>                  # 코드만 생성
./tools/new-app/new-app.sh <slug> --provision-db   # 코드 + DB schema/role 까지
```

예:

```bash
./tools/new-app/new-app.sh gymlog --provision-db
./tools/new-app/new-app.sh my-app --provision-db
./tools/new-app/new-app.sh fintrack2 --provision-db
```

### 2.1 인자 요약

| 인자 | 설명 |
|---|---|
| `<slug>` | 앱 식별자. 소문자 알파벳으로 시작, 소문자/숫자/하이픈만 허용 |
| `--provision-db` | Postgres schema + role 까지 자동 생성. 없으면 DB 작업은 skip — §5 참조 |

### 2.2 slug 검증 규칙

스크립트는 다음 정규식으로 slug 를 검증합니다.

```bash
if ! [[ "$SLUG" =~ ^[a-z][a-z0-9-]*$ ]]; then
    fail "유효하지 않은 slug: '${SLUG}'. 소문자 알파벳으로 시작, 소문자/숫자/하이픈만 허용."
fi
```

### 2.3 slug 의 네 가지 변형

내부적으로 같은 slug 에서 네 가지 변형이 만들어져 각각 용도에 맞게 사용됩니다.

| 변형 | 규칙 | `my-app` 예시 | 용도 |
|---|---|---|---|
| `SLUG` | 원본 | `my-app` | URL 경로 (`/api/apps/my-app/...`), 디렉토리명 |
| `SLUG_PASCAL` | Pascal case | `MyApp` | Java 클래스명 |
| `SLUG_UPPER` | UPPER_SNAKE | `MY_APP` | 환경변수 (`MY_APP_DB_URL`) |
| `SLUG_PACKAGE` | 하이픈 제거 | `myapp` | Java 패키지, Postgres 식별자 (schema/role 이름) |

Postgres 는 식별자에 하이픈을 허용하지 않으므로 schema/role 이름에는 `SLUG_PACKAGE` 를 사용합니다.

---

## 3. 자동으로 만들어지는 것

### 3.1 Gradle 모듈

```
apps/app-<slug>/
└── build.gradle
```

핵심 의존은 아래와 같습니다.

```gradle
// tools/new-app/new-app.sh — build.gradle 템플릿
dependencies {
    implementation project(':core:core-auth-api')
    implementation project(':core:core-user-api')
    implementation project(':core:core-device-api')
    implementation project(':core:core-push-api')
    implementation project(':common:common-web')
    implementation project(':common:common-persistence')
    implementation project(':common:common-security')

    // QueryDsl
    implementation "com.querydsl:querydsl-jpa:${querydslVersion}:jakarta"
    annotationProcessor "com.querydsl:querydsl-apt:${querydslVersion}:jakarta"

    implementation 'org.flywaydb:flyway-core'
    runtimeOnly 'org.flywaydb:flyway-database-postgresql'
    runtimeOnly 'org.postgresql:postgresql'
    // ...
}
```

앱 모듈은 `core-*-api` 만 의존합니다. `core-*-impl` 에 직접 의존하지 않아서 모듈 경계가 지켜집니다.

### 3.2 Java 컨트롤러

```
apps/app-<slug>/src/main/java/com/factory/apps/<slugPackage>/
├── controller/
│   └── <SlugPascal>HealthController.java
├── auth/
│   └── <SlugPascal>AuthController.java
├── service/
├── repository/
├── entity/
└── config/
    ├── <SlugPascal>AppAutoConfiguration.java
    └── <SlugPascal>DataSourceConfig.java
```

**HealthController** 는 `GET /api/apps/<slug>/health` 를 제공하여 빠르게 동작 확인을 할 수 있게 해줍니다.

```java
@RestController
@RequestMapping("/api/apps/<slug>")
@Tag(name = "<slug>", description = "<SlugPascal> 앱 API")
public class <SlugPascal>HealthController {

    @GetMapping("/health")
    public ApiResponse<Map<String, String>> health() {
        return ApiResponse.ok(Map.of("app", "<slug>", "status", "ok"));
    }
}
```

**AuthController** 는 `core/core-auth-impl/src/main/java/com/factory/core/auth/impl/controller/AuthController.java` 를 레퍼런스 소스로 삼아 복제됩니다. `AuthPort` 에 위임하는 얇은 컨트롤러이며, 경로는 `/api/apps/<slug>/auth/*` 입니다.

> `core-auth-impl` 의 `AuthController` 는 `@Import` 되지 않아 런타임 bean 으로 등록되지 않습니다. 앱 모듈이 추가되는 순간부터 해당 slug 의 인증 엔드포인트만 노출됩니다. 템플릿 상태(앱 0개) 에서는 인증 엔드포인트가 전혀 노출되지 않습니다.

### 3.3 AutoConfiguration 등록

```java
// apps/app-<slug>/src/main/java/.../config/<SlugPascal>AppAutoConfiguration.java
@AutoConfiguration
@ComponentScan(basePackages = "com.factory.apps.<slugPackage>")
public class <SlugPascal>AppAutoConfiguration {
}
```

Spring Boot 가 이를 인식하도록 `AutoConfiguration.imports` 파일도 같이 생성됩니다.

```
apps/app-<slug>/src/main/resources/META-INF/spring/
└── org.springframework.boot.autoconfigure.AutoConfiguration.imports
```

내용:

```
com.factory.apps.<slugPackage>.config.<SlugPascal>AppAutoConfiguration
```

### 3.4 DataSource Config (multi-DataSource)

각 앱은 **독립된 schema + DataSource + Flyway 히스토리**를 갖습니다. `<SlugPascal>DataSourceConfig` 가 이를 담당합니다.

```java
// apps/app-<slug>/src/main/java/.../config/<SlugPascal>DataSourceConfig.java
@Configuration
@EnableJpaRepositories(
    basePackages = "com.factory.apps.<slugPackage>.repository",
    entityManagerFactoryRef = "<slugPackage>EntityManagerFactory",
    transactionManagerRef = "<slugPackage>TransactionManager"
)
public class <SlugPascal>DataSourceConfig extends AbstractAppDataSourceConfig {

    public <SlugPascal>DataSourceConfig(
        @Value("${<SLUG_UPPER>_DB_URL}") String url,
        @Value("${<SLUG_UPPER>_DB_USER}") String user,
        @Value("${<SLUG_UPPER>_DB_PASSWORD}") String password
    ) {
        super("<slugPackage>", url, user, password);
    }

    @Bean(name = "<slugPackage>DataSource")
    public DataSource <slugPackage>DataSource() {
        return buildDataSource();
    }

    @Bean(name = "<slugPackage>EntityManagerFactory")
    @DependsOn("<slugPackage>Flyway")  // Flyway 선행 → hbm2ddl=validate 통과
    public LocalContainerEntityManagerFactoryBean <slugPackage>EntityManagerFactory(
        @Qualifier("<slugPackage>DataSource") DataSource ds
    ) {
        return buildEntityManagerFactory(ds);
    }
    // ... Flyway, TransactionManager 빈도 동일 패턴
}
```

`AbstractAppDataSourceConfig` 가 build\* 헬퍼를 제공하고 concrete class 가 `@Bean` 으로 래핑하는 구조입니다. 이렇게 하면 앱마다 `HikariCP` pool 이 하나씩 생기고, 빈 이름이 `<slugPackage>` prefix 로 유니크하게 갈라져 여러 앱이 한 JVM 에서 충돌 없이 공존합니다.

Repository scan 이 `apps.<slugPackage>.repository` 만 대상으로 한정되는 이유는, `core-*` 레포지토리가 이미 자기 `@EnableJpaRepositories` 에서 default EMF 에 등록되었기 때문입니다. 여기서 다시 core 패키지를 스캔하면 `BeanDefinitionOverrideException` 이 납니다.

### 3.5 Flyway Migration (V001 ~ V006)

```
apps/app-<slug>/src/main/resources/db/migration/<slug>/
├── V001__init_users.sql
├── V002__init_social_identities.sql
├── V003__init_refresh_tokens.sql
├── V004__init_email_verification_tokens.sql
├── V005__init_password_reset_tokens.sql
└── V006__init_devices.sql
```

V001~V006 은 인증/디바이스 공통 테이블입니다 (`core-auth`, `core-user`, `core-device` 엔티티에 매핑). V007 이상부터는 앱 도메인 테이블을 직접 작성합니다 (§7 참조).

마이그레이션 경로가 `db/migration/<slug>/` 처럼 slug 별로 격리되어 있어서, 각 앱 DataSource 의 Flyway 가 자기 디렉토리만 읽습니다.

### 3.6 README / settings.gradle / bootstrap.gradle 업데이트

`apps/app-<slug>/README.md` 에 해당 앱의 구조와 템플릿 동기화 방법이 기록됩니다. `template-v*` 태그가 있으면 그 버전을 함께 기록합니다.

그리고 다음 두 파일에 자동으로 줄이 추가됩니다.

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

bootstrap 은 앱 모듈을 `implementation` 으로 의존해야 `@AutoConfiguration` 이 활성화되고 컨트롤러가 런타임에 노출됩니다.

---

## 4. 환경 변수 (`.env`) 주입

`.env` 파일이 없으면 `.env.example` 에서 복사하고, 다음 변수들을 추가합니다 (이미 있으면 skip — §6 멱등성 참조).

### 4.1 DB 변수

```env
<SLUG_UPPER>_DB_URL=jdbc:postgresql://<host>:5432/postgres?currentSchema=<slugPackage>
<SLUG_UPPER>_DB_USER=<slugPackage>_app
<SLUG_UPPER>_DB_PASSWORD=CHANGE_ME
```

`<host>` 는 수동으로 교체해야 합니다 (로컬은 `localhost:5433`, 운영은 Supabase pooler 호스트 등). `--provision-db` 를 지정하면 `_DB_PASSWORD` 는 자동으로 랜덤 생성되어 치환됩니다 — §5 참조.

### 4.2 MinIO 버킷

```env
APP_STORAGE_MINIO_BUCKETS_<N>=<slug>-bucket
```

`<N>` 은 기존 `APP_STORAGE_MINIO_BUCKETS_*` 변수들의 최대 인덱스 + 1 로 결정됩니다. Spring 기동 시 `BucketProvisioner` 가 해당 이름의 버킷을 MinIO 에 자동 생성합니다.

### 4.3 소셜 로그인 Credentials

```env
APP_CREDENTIALS_<SLUG_UPPER>_GOOGLE_CLIENT_IDS_0=CHANGE_ME
APP_CREDENTIALS_<SLUG_UPPER>_GOOGLE_CLIENT_IDS_1=CHANGE_ME
APP_CREDENTIALS_<SLUG_UPPER>_APPLE_BUNDLE_ID=com.example.<slugLower>
```

실제 값 발급 방법은 [소셜 로그인 설정 가이드](./social-auth-setup.md) 를 참조합니다.

### 4.4 멱등성 — 이미 있는 키는 skip

`.env` 에 이미 동일한 키가 있으면 덮어쓰지 않고 넘어갑니다. 같은 명령을 다시 돌려도 기존 값은 안전합니다.

```bash
# tools/new-app/new-app.sh — inject_env_line 헬퍼
if grep -qE "^${key}=" .env 2>/dev/null; then
    info "  skip: ${key} already in .env"
    return 0
fi
echo "${key}=${value}" >> .env
```

전체 멱등성 매트릭스(`.env` / Gradle / DB) 는 §6 참조.

---

## 5. Postgres Schema / Role Provisioning (`--provision-db`)

앞 §3, §4 가 **코드와 설정 파일** 만 만들었다면, 이 단계는 **실제 DB 에 물리적으로 공간을 마련하는** 작업입니다. `--provision-db` 플래그로 opt-in 하면 스크립트가 `psql` 을 호출해 `infra/scripts/init-app-schema.sql` 을 실행합니다.

### 5.1 이 단계가 하는 일

세 가지를 수행합니다.

1. **Schema 생성** — `CREATE SCHEMA IF NOT EXISTS <slugPackage>`
2. **Role 생성** — `CREATE ROLE <slugPackage>_app LOGIN PASSWORD <random-48-hex>` (이미 있으면 skip)
3. **권한 부여** — 해당 schema 의 테이블/시퀀스에 대해 앱 role 에게 ALL 권한, 이후 생성될 객체에도 default privileges 적용. `public` schema 접근은 revoke.

생성된 비밀번호는 `.env` 의 `<SLUG_UPPER>_DB_PASSWORD=CHANGE_ME` placeholder 에 자동으로 치환됩니다.

### 5.2 로컬 docker 에 provision 하는 경우

`.env.example` 에 다음 값이 기본으로 들어있어서 **추가 설정 없이** 바로 동작합니다.

```env
DATABASE_URL=postgresql://postgres:dev@localhost:5433/postgres
```

```bash
# .env 기본값으로 로컬 docker postgres 에 provision
./tools/new-app/new-app.sh gymlog --provision-db
```

스크립트 내부적으로 `DATABASE_URL` 환경변수가 shell 에 없으면 `.env` 에서 자동 로드합니다. Docker 로컬 환경은 결정적이라 사용자 조작이 전혀 필요 없습니다.

### 5.3 운영 DB 에 provision 하는 경우

운영 admin credential 은 **`.env` 에 저장하지 않고** shell 에서 일시 export 합니다. shell 환경변수가 `.env` 값보다 우선 사용되므로 로컬 기본값을 자연스럽게 덮어씁니다.

```bash
# Supabase / RDS / Fly.io 등 운영 Postgres admin credential
export DATABASE_URL='postgresql://postgres.<ref>:<pw>@aws-1-<region>.pooler.supabase.com:5432/postgres'
./tools/new-app/new-app.sh gymlog --provision-db

# 작업 끝나면 shell 종료 시 자연스럽게 export 사라짐
```

`DATABASE_URL` 은 schema/role 을 **생성할 권한이 있는 관리자 credential** 이어야 합니다 (앱 role 아님). 로컬에선 docker-compose 의 superuser, 운영에선 Supabase `postgres` 같은 계정입니다. `psql` 이 설치되어 있어야 합니다 (`brew install libpq` 또는 `postgresql`).

### 5.4 `provision_db` 함수 내부 동작

```bash
# tools/new-app/new-app.sh
provision_db() {
    local SLUG_IDENT="$1"      # schema 이름
    local SLUG_PACKAGE="$2"    # role prefix

    # DATABASE_URL 이 shell 에 없으면 .env 에서 자동 로드 (로컬 docker 케이스)
    if [[ -z "${DATABASE_URL:-}" ]] && [[ -f .env ]]; then
        DATABASE_URL=$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"' || true)
        export DATABASE_URL
    fi

    local password
    password=$(openssl rand -hex 24)

    APP_SLUG="${SLUG_IDENT}" \
    APP_ROLE="${SLUG_PACKAGE}_app" \
    APP_PASSWORD="${password}" \
    psql "${DATABASE_URL}" \
        -v ON_ERROR_STOP=1 \
        -v app_slug="${SLUG_IDENT}" \
        -v app_role="${SLUG_PACKAGE}_app" \
        -v app_password="${password}" \
        -f "${REPO_ROOT}/infra/scripts/init-app-schema.sql"

    # .env 의 _DB_PASSWORD 를 생성된 값으로 교체
    if grep -q "^${SLUG_UPPER}_DB_PASSWORD=CHANGE_ME$" .env; then
        sed -i.bak "s|^${SLUG_UPPER}_DB_PASSWORD=CHANGE_ME$|${SLUG_UPPER}_DB_PASSWORD=${password}|" .env
        rm -f .env.bak
    fi
}
```

`openssl rand -hex 24` 로 48자 hex 비밀번호를 만들고, SQL 실행 후 `.env` 의 placeholder 를 해당 비밀번호로 치환합니다.

### 5.5 `init-app-schema.sql` 이 수행하는 SQL

```sql
-- infra/scripts/init-app-schema.sql (요약)

-- 1. Schema 생성 (이미 있으면 skip)
CREATE SCHEMA IF NOT EXISTS <app_slug>

-- 2. Role 생성 (이미 있으면 skip)
CREATE ROLE <app_role> LOGIN PASSWORD <app_password>
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = <app_role>)

-- 3. schema 권한 부여 — Flyway 가 flyway_schema_history 생성 / DDL 실행 가능해야 함
GRANT USAGE, CREATE ON SCHEMA <app_slug> TO <app_role>
GRANT ALL ON ALL TABLES IN SCHEMA <app_slug> TO <app_role>
GRANT ALL ON ALL SEQUENCES IN SCHEMA <app_slug> TO <app_role>

-- 4. Default privileges — 이후 생성될 테이블/시퀀스에도 자동 적용
ALTER DEFAULT PRIVILEGES IN SCHEMA <app_slug> GRANT ALL ON TABLES TO <app_role>
ALTER DEFAULT PRIVILEGES IN SCHEMA <app_slug> GRANT ALL ON SEQUENCES TO <app_role>

-- 5. public schema 접근 금지
REVOKE ALL ON SCHEMA public FROM <app_role>
```

스크립트는 slug 형식도 방어합니다 — Postgres identifier 는 소문자/숫자/밑줄만 허용하므로, 하이픈이 포함된 slug 는 내부적으로 `SLUG_PACKAGE` (하이픈 제거) 로 변환되어 전달됩니다. 형식이 어긋나면 `division-by-zero` trick 으로 실행이 중단됩니다.

---

## 6. 멱등성

`new-app.sh` 자체는 같은 slug 로 두 번 실행해도 안전하도록 설계되지는 **않았습니다** — 앱 모듈 디렉토리가 이미 있으면 즉시 종료합니다.

```bash
APP_DIR="${REPO_ROOT}/apps/app-${SLUG}"
if [[ -d "${APP_DIR}" ]]; then
    fail "이미 존재합니다: ${APP_DIR}"
fi
```

반면 **스크립트가 건드리는 개별 요소들**은 각각 멱등합니다. 예를 들어 디렉토리만 직접 삭제하고 재실행하면 `.env` / DB schema 는 영향 없이 재사용됩니다.

| 대상 | 멱등성 | 구현 방식 |
|---|---|---|
| `apps/app-<slug>/` 디렉토리 | ❌ 없음 | 존재 시 스크립트 종료 |
| `settings.gradle` 의 include 줄 | ✅ 있음 | grep 체크 후 skip |
| `bootstrap/build.gradle` 의 implementation 줄 | ✅ 있음 | 같은 줄 있으면 skip |
| `.env` 변수 (`<SLUG>_DB_*`, `APP_CREDENTIALS_*`, `MINIO_BUCKETS_*`) | ✅ 있음 | 키 존재 시 skip |
| Postgres schema 생성 | ✅ 있음 | `CREATE SCHEMA IF NOT EXISTS` |
| Postgres role 생성 | ✅ 있음 | `pg_roles` 체크 후 skip |
| `.env` 의 `_DB_PASSWORD=CHANGE_ME` 치환 | ✅ 있음 | `CHANGE_ME` 인 경우만 sed 치환 |

재시도 흐름: 스크립트가 `apps/app-<slug>/` 생성 후 중간에 실패한 경우, 해당 디렉토리만 수동 삭제하고 (`rm -rf apps/app-<slug>`) 재실행하면 나머지 멱등 요소가 skip 되어 안전하게 이어집니다. DB schema 는 그대로 두어도 됩니다.

---

## 7. 실행 후 남은 수동 작업

스크립트 마지막에 무엇이 **자동으로 처리됐고** 무엇이 **남아있는지** 를 안내합니다. 이때 출력되는 내용은 `--provision-db` 플래그를 **붙였느냐에 따라 달라집니다**. DB schema 를 자동 생성했느냐 여부가 "남은 작업" 개수에 영향을 주기 때문입니다.

### 7.1 케이스 A — `--provision-db` 를 붙인 경우 (권장)

```bash
./tools/new-app/new-app.sh gymlog --provision-db
```

스크립트가 DB schema 와 role 까지 만들어 줘서 **남는 작업이 한 가지 줄어듭니다**. 실제 스크립트 출력은 다음과 같습니다.

```
자동 수행됨:
  ✅ Java 모듈 scaffolding
  ✅ .env 에 DB / bucket / credentials placeholder 추가
  ✅ Postgres schema + role 생성       ← 자동 완료

남은 수동 작업:

1. .env 의 placeholder 값 실제 값으로 교체:
   - <SLUG_UPPER>_DB_URL 의 <host> (Supabase pooler 호스트 등)
   - APP_CREDENTIALS_<SLUG_UPPER>_GOOGLE_CLIENT_IDS_0/1, _APPLE_BUNDLE_ID
   → 발급 방법: docs/journey/social-auth-setup.md

2. 도메인 테이블 작성:
   apps/app-<slug>/src/main/resources/db/migration/<slug>/V007__init_domain.sql
   (이 앱의 비즈니스 로직 테이블)

3. 커밋:
   feat(apps): scaffold app-<slug>
```

이 케이스에서는 **DB schema 수동 생성 단계가 출력에 아예 등장하지 않습니다.** 이미 DB 에 반영되었기 때문입니다. 로컬 `docker compose` 환경이든 운영 Postgres 든 동일하게 적용되며, `new-app.sh` 가 실행 시점에 `.env` 의 `DATABASE_URL` (또는 shell export) 을 보고 해당 DB 에 적용합니다.

### 7.2 케이스 B — `--provision-db` 를 붙이지 않은 경우

```bash
./tools/new-app/new-app.sh gymlog
```

스크립트는 코드 파일과 `.env` 항목만 준비하고, **DB 는 건드리지 않습니다.** 이 경우 출력에는 DB schema 생성이 "남은 작업" 1번으로 추가됩니다.

```
자동 수행됨:
  ✅ Java 모듈 scaffolding
  ✅ .env 에 DB / bucket / credentials placeholder 추가
  ⏭  Postgres schema 생성 skip         ← 수동 처리 필요

남은 수동 작업:

1. Postgres schema 수동 생성 (또는 --provision-db 로 재실행):
   export APP_SLUG=<slug> APP_ROLE=<slug>_app APP_PASSWORD='강력한비번'
   psql "$DATABASE_URL" -f infra/scripts/init-app-schema.sql

2. .env 의 placeholder 값 실제 값으로 교체:
   - <SLUG_UPPER>_DB_URL 의 <host> (Supabase pooler 호스트 등)
   - APP_CREDENTIALS_<SLUG_UPPER>_GOOGLE_CLIENT_IDS_0/1, _APPLE_BUNDLE_ID
   → 발급 방법: docs/journey/social-auth-setup.md

3. 도메인 테이블 작성:
   apps/app-<slug>/src/main/resources/db/migration/<slug>/V007__init_domain.sql

4. 커밋:
   feat(apps): scaffold app-<slug>
```

이때 schema 를 직접 만들고 싶지 않다면 `./tools/new-app/new-app.sh gymlog --provision-db` 로 **한 번 더 실행** 하면 됩니다. 스크립트는 멱등하게 설계되어 있어서 이미 만들어진 코드 파일은 건드리지 않고, DB schema / role 만 추가로 생성합니다.

### 7.3 요약 — 사람이 직접 할 일

두 케이스 모두 **공통으로 남는 3가지** 작업:

1. `.env` 의 `<host>` 자리와 소셜 로그인 credential placeholder 를 실제 값으로 교체
2. 도메인 테이블용 `V007__init_domain.sql` 작성 (이 앱의 비즈니스 로직)
3. 커밋

여기에 **케이스 B** 에서는 **"DB schema 수동 생성"** 이 하나 더 추가됩니다. DB 를 처음부터 자동으로 만들게 하려면 **케이스 A (`--provision-db` 를 붙이는 쪽)** 를 기본으로 쓰는 것을 권장합니다.

---

## 8. 문제 해결

### 8.1 "이미 존재합니다" 에러

스크립트 중간에 실패했거나 일부만 생성된 경우 발생합니다.

```bash
rm -rf apps/app-<slug>
# settings.gradle 과 bootstrap/build.gradle 에서 해당 줄도 수동 제거
./tools/new-app/new-app.sh <slug> --provision-db
```

### 8.2 Spring bootRun 시 Flyway validate 실패

V001~V006 의 체크섬이 맞지 않으면 Flyway 가 거부합니다. 공통 마이그레이션 파일을 수정하지 않았다면 원인은 대개 DB 에 남은 이전 실행 흔적입니다. schema 를 drop 하고 재생성합니다.

```sql
DROP SCHEMA <slug> CASCADE;
-- 그 다음 --provision-db 재실행 또는 init-app-schema.sql 수동 실행
```

### 8.3 `<SLUG_UPPER>_DB_PASSWORD=CHANGE_ME` 가 남아있음

`--provision-db` 를 쓰지 않았거나, 스크립트가 sed 치환 전에 실패한 경우입니다. `.env` 에서 직접 값을 넣거나, schema 를 drop 한 뒤 `--provision-db` 로 재실행하면 자동 치환됩니다.

### 8.4 Postgres identifier 에러 (하이픈 관련)

slug 자체는 하이픈을 허용하지만 Postgres schema/role 이름에는 `SLUG_PACKAGE` (하이픈 제거 버전) 가 사용됩니다. `my-app` slug 로 만든 앱의 schema 는 `myapp` 입니다. 수동 psql 명령 실행 시 `APP_SLUG` 환경변수는 반드시 하이픈을 뺀 버전으로 설정해야 합니다.

---

## 9. 한눈에 요약

| 항목 | 내용 |
|---|---|
| **사전 조건** | `bootstrap.sh` 선행 (docker postgres 기동 + `.env` 준비) |
| **최소 명령** | `./tools/new-app/new-app.sh <slug> --provision-db` |
| **slug 규칙** | `^[a-z][a-z0-9-]*$`, 내부 4종 변형 전개 |
| **생성되는 것** | Gradle 모듈 · Java 컨트롤러 (Health+Auth) · AutoConfiguration · DataSource · Flyway V001~V006 · README · settings.gradle / bootstrap.gradle 업데이트 |
| **`.env` 주입** | DB 3종 · MinIO bucket · 소셜 credentials placeholder |
| **`--provision-db` 없으면** | DB 작업 skip → 7.2 "0번" 이 수동 작업으로 추가 |
| **`--provision-db` 있으면** | schema + role + grant 자동 생성, DB 비밀번호 랜덤 생성 후 `.env` 치환 |
| **로컬 docker** | `.env` 의 `DATABASE_URL` 기본값 자동 로드 — export 불필요 |
| **운영 DB** | `export DATABASE_URL='postgresql://...'` 로 일시 덮어쓰기 |
| **멱등성** | 디렉토리만 없음. `.env` / settings.gradle / DB schema/role 모두 있음 |
| **남은 수동 작업** | `.env` host/credentials 실제 값 · V007 도메인 테이블 · 커밋 |

---

## 다음 단계

새 앱 모듈이 준비되었다면:

- **도메인 코드 작성**: `apps/app-<slug>/` 에 Controller · Service · Entity · Repository 추가
- **소셜 로그인 설정**: [소셜 로그인 설정 가이드](./social-auth-setup.md) — Google/Apple credential 발급
- **Flutter 연동**: [Flutter ↔ Backend Integration](../api-and-functional/api/flutter-backend-integration.md)
- **배포**: [운영 배포 가이드 (파생레포 onboarding)](../production/deploy/deployment.md)
