# 첫 실행 결과 해석

로컬에서 `./gradlew bootRun` 을 처음 돌렸을 때 나오는 로그가 **무엇을 의미하는지** 한 번 훑어봅니다. 실제로 돌리지 않아도 읽을 수 있도록 구성. 막히는 로그가 있으면 이 문서로 돌아오세요.

> **전제**: [`Onboarding — 템플릿 첫 사용 가이드`](../start/onboarding.md) 의 환경 셋업 (§1~§3) 완료. `./tools/bootstrap.sh` 또는 `./gradlew bootRun` 직접 실행.

## 1. Gradle 단계

```
Reloading settings
> Task :common:common-logging:compileJava
> Task :common:common-web:compileJava
> Task :core:core-user-api:compileJava
...
BUILD SUCCESSFUL in 8s
```

**의미**: Gradle 이 멀티모듈을 순서대로 컴파일. 각 모듈 (`common/common-*`, `core/core-*-api`, `core/core-*-impl`, `bootstrap`) 이 독립 빌드됨. **첫 빌드는 의존성 다운로드로 2~5분**, 이후는 증분 빌드로 몇 초.

실패하면: Java 21 미설치 (`java --version` 확인) 또는 Gradle cache 충돌 → `./gradlew clean` 후 재시도.

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

**의미**: Spring Boot 가 시작. 활성 프로필이 `dev` 면 `application-dev.yml` 의 설정 사용.

## 3. DB 연결 (HikariCP)

```
HikariPool-1 - Starting...
HikariPool-1 - Added connection org.postgresql.jdbc.PgConnection@...
HikariPool-1 - Start completed.
```

**의미**: Postgres 에 연결 성공. `core` schema 용 DataSource bean 이 뜬 상태.

실패하면: 
- `Connection refused` → Docker Postgres 안 켜져 있음. `docker compose -f infra/docker-compose.dev.yml up -d postgres`
- `password authentication failed` → `.env` 의 `DATABASE_URL` 또는 POSTGRES_PASSWORD 불일치

## 4. Flyway 마이그레이션

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

**의미**: `V001~V003` SQL 파일이 **순서대로** 실행됨. `flyway_schema_history` 테이블에 기록. 재실행 시에는 "이미 최신" 이라 건너뜀.

**앱이 추가되어 있으면** (`new-app.sh` 실행 후):
```
Migrating schema "sumtally" to version "1 - init users"
...
Successfully applied 6 migrations to schema "sumtally"
```
각 앱 schema 마다 독립 이력.

## 5. Hibernate ORM

```
HHH000412: Hibernate ORM core version 6.x.x
HHH000204: Processing PersistenceUnitInfo ...
```

**의미**: JPA 엔티티 스캔 + DB 테이블 매핑 검증. 엔티티와 실제 테이블 구조가 다르면 여기서 에러.

## 6. Tomcat 서버 시작

```
Tomcat initialized with port(s): 8080 (http)
Starting service [Tomcat]
Starting Servlet engine: [Apache Tomcat/10.x.x]
Root WebApplicationContext: initialization completed
Tomcat started on port(s): 8080 (http) with context path ''
```

**의미**: 내장 Tomcat 이 8080 포트에서 HTTP 요청 대기. **이 줄이 나오면 앱 준비 완료**.

포트 충돌 시: `application-dev.yml` 의 `server.port` 를 변경하거나 다른 프로세스 종료.

## 7. 최종 준비 완료

```
Started FactoryApplication in 3.842 seconds (process running for 4.521)
```

**의미**: 부팅 완료. 이제 HTTP 요청 받을 수 있음.

## 8. 첫 HTTP 호출 — health check

다른 터미널에서:

```bash
curl http://localhost:8080/actuator/health
```

**성공 응답**:
```json
{"status":"UP"}
```

**의미**: 서버 정상 · DB 연결 OK.

## 9. 인증 필요한 엔드포인트 호출

```bash
curl http://localhost:8080/api/apps/sumtally/users/me
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

**의미**: 정상 동작. **인증 필터가 작동 중** — JWT 가 없으니 401 반환. 앱을 아직 안 만들었다면 `/api/apps/sumtally/...` 는 아예 404 (Controller 가 없음). `new-app.sh sumtally` 를 먼저 실행해야 이 경로가 살아남.

## 10. 로그 수준 · 색깔

dev profile 에서는:
- **INFO** 가 기본 (회색)
- **DEBUG** 는 `logging.level.com.factory=DEBUG` 로 활성
- **ERROR** 는 빨간색
- 로그 패턴에 `requestId` 가 포함 (각 HTTP 요청 단위로 추적 가능)

prod profile 에서는 JSON 포맷 로그 (Loki 파싱 용도).

## 11. 끝낼 때

`Ctrl+C` 한 번:
```
Stopping service [Tomcat]
HikariPool-1 - Shutdown initiated...
HikariPool-1 - Shutdown completed.
```

**의미**: graceful shutdown. 진행 중인 요청을 기다린 후 DB 연결 정리.

## 체크리스트 — 여기까지 봤는가?

- [ ] `BUILD SUCCESSFUL` 이 뜸
- [ ] `HikariPool-1 - Start completed.` 가 뜸
- [ ] `Successfully applied N migrations to schema "core"` 가 뜸
- [ ] `Tomcat started on port(s): 8080` 가 뜸
- [ ] `Started FactoryApplication` 이 뜸
- [ ] `curl .../actuator/health` → `{"status":"UP"}` 받음

6 개 모두 ✅ 면 **이 레포가 당신의 노트북에서 살아있음**. 축하.

## 다음

| 다음 행동 | 문서 |
|---|---|
| 실제 코드를 수정해보기 | [`**첫 수정 — nickname 컬럼 추가**`](./first-change.md) |
| 앱 모듈을 만들어보기 | [`Onboarding — 템플릿 첫 사용 가이드`](../start/onboarding.md) §5 `new-app.sh` |
| 뭔가 에러로 막힘 | [`Onboarding — 템플릿 첫 사용 가이드`](../start/onboarding.md) §6 "흔한 에러" |
