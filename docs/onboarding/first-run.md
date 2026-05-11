# 첫 실행 결과 해석

> **유형**: How-to · **독자**: Level 0~1 · **읽는 시간**: ~7분

로컬에서 `./gradlew bootRun` 을 처음 돌렸을 때 나오는 로그가 **무엇을 의미하는지** 한 번 훑어봐요. 실제로 돌리지 않아도 읽을 수 있도록 구성했어요. 막히는 로그가 있으면 이 문서로 돌아오세요.

> **전제**: [`Onboarding — 템플릿 첫 사용 가이드`](../start/onboarding.md) 의 환경 셋업 (§1~§3) 완료. `./tools/init-server.sh` 또는 `./gradlew bootRun` 직접 실행.

## 1. Gradle 단계

```
Reloading settings
> Task :common:common-logging:compileJava
> Task :common:common-web:compileJava
> Task :core:core-user-api:compileJava
...
BUILD SUCCESSFUL in 8s
```

**의미**: Gradle 이 멀티모듈을 순서대로 컴파일해요. 각 모듈 (`common/common-*`, `core/core-*-api`, `core/core-*-impl`, `bootstrap`) 이 독립적으로 빌드돼요. **첫 빌드는 의존성 다운로드 때문에 2~5분** 정도 걸리고, 이후는 증분 빌드라 몇 초면 끝나요.

실패하면: Java 21 미설치 (`java --version` 으로 확인) 또는 Gradle cache 충돌이 원인일 수 있어요. `./gradlew clean` 후 다시 시도하세요.

## 2. Spring 기동 — 배너 + 초기화

```
  .   ____          _            __ _ _
 /\\ / ___'_ __ _ _(_)_ __  __ _ \ \ \ \
( ( )\___ | '_ | '_| | '_ \/ _` | \ \ \ \
 \\/  ___)| |_)| | | | | || (_| |  ) ) ) )
  '  |____| .__|_| |_|_| |_\__, | / / / /
 =========|_|==============|___/=/_/_/_/
 :: Spring Boot ::                (v3.3.x)

Starting FactoryApplication using Java 21 ...
The following 1 profile is active: "dev"
```

**의미**: Spring Boot 가 시작했어요. 활성 프로필이 `dev` 면 `application-dev.yml` 의 설정을 사용해요.

## 3. DB 연결 ([HikariCP](../reference/glossary.md#데이터베이스))

```
HikariPool-1 - Starting...
HikariPool-1 - Added connection org.postgresql.jdbc.PgConnection@...
HikariPool-1 - Start completed.
```

**의미**: Postgres 에 연결이 성공했어요. `core` schema 용 DataSource bean 이 뜬 상태예요.

실패하면 다음 두 가지를 확인하세요.

- `Connection refused` → Docker Postgres 가 안 켜져 있어요. `docker compose -f infra/docker-compose.dev.yml up -d postgres`
- `password authentication failed` → `.env` 의 `PSQL_DB_URL` 또는 POSTGRES_PASSWORD 가 일치하지 않아요.

## 4. [Flyway](../reference/glossary.md#데이터베이스) 마이그레이션

```
Flyway Community Edition 10.x.x by Redgate
Database: jdbc:postgresql://localhost:5433/postgres (PostgreSQL 16.x)
Schema: [core]
Successfully validated 3 migrations (execution time 00:00.015s)
Creating schema history table "core"."flyway_schema_history" ...
Current version of schema "core": << Empty Schema >>
Migrating schema "core" to version "1 - init users"
Migrating schema "core" to version "2 - init social identities"
Migrating schema "core" to version "3 - add users email index"
Successfully applied 3 migrations to schema "core"
```

**의미**: `V001~V003` SQL 파일이 **순서대로** 실행됐어요. `flyway_schema_history` 테이블에 이력이 기록돼요. 재실행 시에는 "이미 최신" 이라 건너뛰어요.

**앱이 추가되어 있으면** (`new-app.sh` 실행 후):
```
Migrating schema "sumtally" to version "1 - init users"
...
Successfully applied 6 migrations to schema "sumtally"
```
각 앱 schema 마다 독립적인 이력을 관리해요.

## 5. [Hibernate ORM](../reference/glossary.md#데이터베이스)

```
HHH000412: Hibernate ORM core version 6.x.x
HHH000204: Processing PersistenceUnitInfo ...
```

**의미**: JPA 엔티티를 스캔해서 DB 테이블 매핑을 검증해요. 엔티티와 실제 테이블 구조가 다르면 이 단계에서 에러가 나요.

## 6. Tomcat 서버 시작

```
Tomcat initialized with port(s): 8081 (http)
Starting service [Tomcat]
Starting Servlet engine: [Apache Tomcat/10.x.x]
Root WebApplicationContext: initialization completed
Tomcat started on port(s): 8081 (http) with context path ''
```

**의미**: 내장 Tomcat 이 8081 포트에서 HTTP 요청을 대기해요. **이 줄이 나오면 앱이 준비됐어요**.

> 왜 8081? Spring Boot 기본은 8080 이지만 다른 로컬 서비스와 자주 충돌해서 `application.yml:12` 에서 8081 로 고정했어요. prod 컨테이너 내부는 Dockerfile 의 `EXPOSE 8080` 과 일치하도록 `config/deploy.yml:55` 의 `SERVER_PORT=8080` ENV 로 override 해요.

포트 충돌 시: `application-dev.yml` 의 `server.port` 를 변경하거나 다른 프로세스를 종료하세요.

## 7. 최종 준비 완료

```
Started FactoryApplication in 3.842 seconds (process running for 4.521)
```

**의미**: 부팅이 완료됐어요. 이제 HTTP 요청을 받을 수 있어요.

## 8. 첫 HTTP 호출 — health check

다른 터미널에서 다음 명령을 실행해요.

```bash
curl http://localhost:8081/actuator/health
```

**성공 응답**:
```json
{"status":"UP"}
```

**의미**: 서버가 정상이고 DB 연결도 OK 상태예요.

## 9. 인증 필요한 엔드포인트 호출

```bash
curl http://localhost:8081/api/apps/sumtally/users/me
```

**응답**:
```json
{
  "data": null,
  "error": {
    "code": "CMN_401",
    "message": "Unauthorized"
  }
}
```

**의미**: 정상 동작이에요. **인증 필터가 작동 중** 이라서 JWT 가 없으니 401 을 반환해요. 앱을 아직 안 만들었다면 `/api/apps/sumtally/...` 는 아예 404 가 나와요 (Controller 가 등록되지 않아서). `new-app.sh sumtally` 를 먼저 실행해야 이 경로가 살아 있어요.

## 10. 로그 수준 · 색깔

dev profile 에서는 다음과 같이 보여요.

- **INFO** 가 기본 (회색)
- **DEBUG** 는 `logging.level.com.factory=DEBUG` 로 활성화돼요
- **ERROR** 는 빨간색
- 로그 패턴에 `requestId` 가 포함돼서 각 HTTP 요청 단위로 추적할 수 있어요

prod profile 에서는 JSON 포맷 로그를 사용해요 (Loki 파싱 용도).

## 11. 끝낼 때

`Ctrl+C` 한 번 누르면 다음 로그가 나와요.
```
Stopping service [Tomcat]
HikariPool-1 - Shutdown initiated...
HikariPool-1 - Shutdown completed.
```

**의미**: graceful shutdown 이에요. 진행 중인 요청을 기다린 후 DB 연결을 정리해요.

## 체크리스트 — 여기까지 봤는가?

- [ ] `BUILD SUCCESSFUL` 이 떴어요
- [ ] `HikariPool-1 - Start completed.` 가 떴어요
- [ ] `Successfully applied N migrations to schema "core"` 가 떴어요
- [ ] `Tomcat started on port(s): 8081` 가 떴어요
- [ ] `Started FactoryApplication` 이 떴어요
- [ ] `curl .../actuator/health` → `{"status":"UP"}` 받았어요

6개 모두 ✅ 면 **이 레포가 당신의 노트북에서 살아 있는 상태** 예요. 축하드려요.

## 다음

| 다음 행동 | 문서 |
|---|---|
| 실제 코드를 수정해보기 | [`첫 수정 — nickname 컬럼 추가`](./first-change.md) |
| 앱 모듈을 만들어보기 | [`Onboarding — 템플릿 첫 사용 가이드`](../start/onboarding.md) §5 `new-app.sh` |
| 뭔가 에러로 막힘 | [`Onboarding — 템플릿 첫 사용 가이드`](../start/onboarding.md) §6 "흔한 에러" |

---

## 관련 문서

- [`Onboarding — 템플릿 첫 사용 가이드`](../start/onboarding.md) — 환경 셋업 + 첫 기동
- [`첫 수정 — nickname 컬럼 추가`](./first-change.md) — 코드 수정 + 마이그레이션 첫 경험
- [`첫 배포`](./first-deploy.md) — Mac mini 운영 환경 배포 첫 경험
- [`도그푸딩 환경 셋업 가이드`](../start/dogfood-setup.md) — 운영 검증 사이클
