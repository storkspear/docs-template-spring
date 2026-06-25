# 첫 실행 결과 해석

> **유형**: How-to · **독자**: Level 0~1 · **읽는 시간**: ~7분

로컬에서 `./gradlew bootRun` 을 처음 돌리면 콘솔에 로그가 빠르게 한 화면 지나가요. 그 로그 한 줄 한 줄이 무슨 뜻인지, 옆에서 짚어 주듯 처음부터 끝까지 따라가 볼게요. 지금 당장 직접 돌리지 않아도 읽으면서 그림이 잡히도록 구성했어요. 기동 중 막히는 줄이 있으면 이 문서로 돌아와 그 단락을 찾아보세요.

> **전제**: [`Onboarding — 템플릿 첫 사용 가이드`](../start/onboarding.md) 의 환경 셋업을 마쳤어요. 셋업은 `<repo> init` 한 번이면 끝나고, 이후 기동은 `<repo> start` 또는 `./gradlew :bootstrap:bootRun` 으로 해요.

> **프로필 한 가지만 미리** — 이 문서의 로그는 모두 **local 프로필** 기준이에요. `./gradlew :bootstrap:bootRun` 은 별도 설정 없이도 자동으로 local 을 활성화하고 루트의 `.env` 를 읽어 들이거든요. 그래서 기동을 좌우하는 설정 파일은 `application-local.yml` 이에요. Mac mini 의 dev 서버나 운영은 각각 `application-dev.yml`·`application-prod.yml` 이 따로 담당해요.

## 1. Gradle 단계

```
Reloading settings
> Task :common:common-logging:compileJava
> Task :common:common-web:compileJava
> Task :core:core-user-api:compileJava
...
BUILD SUCCESSFUL in 8s
```

Gradle 이 멀티모듈을 순서대로 컴파일하는 단계예요. 공통 인프라 모듈, core 도메인 모듈, 그리고 이들을 하나로 조립하는 `bootstrap` 모듈이 각각 독립적으로 빌드돼요. 첫 빌드는 의존성을 모두 내려받느라 2~5분쯤 걸리고, 그다음부터는 바뀐 부분만 다시 빌드하는 증분 빌드라 몇 초면 끝나요.

여기서 실패한다면 원인은 보통 둘 중 하나예요. Java 21 이 깔려 있지 않거나, Gradle 캐시가 꼬인 경우죠. `java --version` 으로 버전을 먼저 확인하고, 그래도 안 되면 `./gradlew clean` 으로 캐시를 비운 뒤 다시 시도하세요.

## 2. Spring 기동 — 배너와 프로필

```
  .   ____          _            __ _ _
 /\\ / ___'_ __ _ _(_)_ __  __ _ \ \ \ \
( ( )\___ | '_ | '_| | '_ \/ _` | \ \ \ \
 \\/  ___)| |_)| | | | | || (_| |  ) ) ) )
  '  |____| .__|_| |_|_| |_\__, | / / / /
 =========|_|==============|___/=/_/_/_/
 :: Spring Boot ::                (v3.3.x)

Starting FactoryApplication using Java 21 ...
Active Spring profiles: [local]
```

Spring Boot 의 시작을 알리는 배너예요. 바로 아래 `Active Spring profiles: [local]` 줄이 핵심이에요. 활성 프로필이 `local` 이라는 건 `application-local.yml` 의 설정으로 떴다는 뜻이고, 이 파일이 로컬 docker 환경의 DB 주소와 fallback 값들을 모두 잡아 줘요.

이 자리에 프로필 이름 대신 `No active Spring profile set — default profile in use ...` 경고가 보인다면, `.env` 가 셸로 주입되지 않은 거예요. `<repo> start` 로 띄우면 자동으로 처리되지만, `bootRun` 을 직접 부를 때 막혔다면 [`Onboarding §6 흔한 에러`](../start/onboarding.md#6-흔한-에러) 의 프로필 항목을 보세요.

## 3. DB 연결 — [HikariCP](../reference/glossary.md#데이터베이스) 풀 기동

```
HikariPool-1 - Starting...
HikariPool-1 - Added connection org.postgresql.jdbc.PgConnection@...
HikariPool-1 - Start completed.
```

Postgres 에 연결이 성공했다는 신호예요. 매 요청마다 DB 연결을 새로 여는 건 느리니까, [HikariCP](../reference/glossary.md#데이터베이스) 가 연결 몇 개를 미리 열어 풀로 만들어 두고 돌려 써요. 이 레포는 앱마다 전용 풀을 따로 두는데, 그래서 앱이 여럿이면 `HikariPool-1`, `HikariPool-2` 처럼 풀이 여러 개 떠요.

연결에 실패하면 메시지를 보고 두 가지를 확인하세요.

- `Connection refused` — Postgres 컨테이너가 아직 안 떴어요. `docker compose -f infra/docker-compose.local.yml up -d postgres` 로 띄우세요.
- `password authentication failed` — `.env` 의 DB 접속값이 컨테이너 설정과 어긋났어요. `application-local.yml` 의 기본값(`localhost:5433`, 사용자 `postgres`)과 맞는지 보세요.

## 4. [Flyway](../reference/glossary.md#데이터베이스) 마이그레이션

```
Flyway Community Edition 10.x.x by Redgate
Database: jdbc:postgresql://localhost:5433/postgres (PostgreSQL 16.x)
Schema: [sumtally]
Successfully validated 15 migrations (execution time 00:00.015s)
Creating schema history table "sumtally"."flyway_schema_history" ...
Current version of schema "sumtally": << Empty Schema >>
Migrating schema "sumtally" to version "1 - init users"
Migrating schema "sumtally" to version "2 - init social identities"
...
Migrating schema "sumtally" to version "15 - init phone otp codes"
Successfully applied 15 migrations to schema "sumtally"
```

[Flyway](../reference/glossary.md#데이터베이스) 가 `V001` 부터 `V015` 까지 SQL 파일을 번호 순서대로 한 번씩 실행하는 단계예요. 실행 이력은 그 앱 schema 안의 `flyway_schema_history` 테이블에 남아서, 다음 기동 때는 "이미 최신" 이라 모두 건너뛰어요.

마이그레이션 로그에 schema 이름이 앱 슬러그(`sumtally`)로 찍히는 게 핵심이에요. 이 레포는 앱마다 독립된 schema 를 쓰고, schema 마다 이력을 따로 관리하거든요. `<repo> new <slug>` 로 앱을 추가할 때 이 15개 마이그레이션이 그 앱 schema 에 자동으로 깔려요. 번호별로 무엇이 들어가는지는 이렇게 나뉘어요.

| 버전 | 내용 | 비고 |
|---|---|---|
| **V001 ~ V006** | 인증 기반. users · social_identities · refresh_tokens · email/password 토큰 · devices | 모든 앱 공통 |
| **V007** | admin 유저 1명 시드 | `admin@<slug>.local`, 임시 비밀번호 — 첫 로그인 시 변경 |
| **V008 ~ V012** | 결제와 구독. plans · subscriptions · webhook_events · renewal_attempts · audit_logs | |
| **V013 ~ V014** | 2FA([TOTP](../reference/glossary.md#인증--보안)) 컬럼 · 사용자 알림 채널 toggle | |
| **V015** | phone_otp_codes(휴대폰 점유인증) | 옵트인 — 점유인증을 안 쓰면 이 파일은 삭제 가능 |

본인 도메인 테이블은 V016 부터 직접 작성하면 돼요.

## 5. [Hibernate ORM](../reference/glossary.md#데이터베이스)

```
HHH000412: Hibernate ORM core version 6.x.x
HHH000204: Processing PersistenceUnitInfo ...
```

[JPA](../reference/glossary.md#데이터베이스) 엔티티를 스캔해서 DB 테이블과의 매핑을 검증하는 단계예요. 엔티티 클래스와 실제 테이블 구조가 어긋나 있으면 바로 이 자리에서 에러가 나요. 그래서 컬럼을 추가했는데 마이그레이션을 빠뜨렸다면 여기서 걸려요.

## 6. Tomcat 서버 시작

```
Tomcat initialized with port(s): 8081 (http)
Starting service [Tomcat]
Starting Servlet engine: [Apache Tomcat/10.x.x]
Root WebApplicationContext: initialization completed
Tomcat started on port(s): 8081 (http) with context path ''
```

내장 Tomcat 이 8081 포트에서 HTTP 요청을 기다리기 시작했어요. 마지막 `Tomcat started` 줄이 나오면 앱이 거의 준비된 거예요.

> **왜 8081 일까요?** Spring Boot 기본 포트는 8080 인데, 로컬에서 다른 서비스와 자주 부딪혀서 `application.yml` 에서 8081 로 고정했어요. 운영 컨테이너 안에서는 Dockerfile 의 `EXPOSE 8080` 과 맞추려고 `config/deploy.yml` 의 `SERVER_PORT=8080` 환경변수로 다시 8080 으로 바꿔요. 로컬은 8081, 운영 컨테이너 안은 8080 인 셈이죠.

포트가 이미 점유돼 있어 기동이 막힌다면, `application-local.yml` 에서 `server.port` 를 비우거나 그 포트를 쓰는 다른 프로세스를 종료하세요.

## 7. 최종 준비 완료

```
Started FactoryApplication in 3.842 seconds (process running for 4.521)
```

부팅이 끝났어요. 이제 HTTP 요청을 받을 수 있는 상태예요. 이 줄이 보이면 다음 단계로 넘어가서 직접 요청을 한 번 보내 봐요.

## 8. 첫 HTTP 호출 — 헬스 체크

먼저 서버가 정말 살아 있는지 확인하는 게 좋아요. 앱을 띄운 터미널은 그대로 두고, 다른 터미널을 열어 다음 명령을 실행하세요.

```bash
curl http://localhost:8081/actuator/health
```

서버가 정상이면 이런 응답이 와요.

```json
{"status":"UP"}
```

[Actuator](../reference/glossary.md#운영--인프라) 의 헬스 엔드포인트는 인증 없이 열려 있어서, 토큰 없이도 바로 찔러 볼 수 있어요. `status` 가 `UP` 이면 서버는 물론이고 DB 연결까지 정상이라는 뜻이에요. local 프로필에서는 상세 표시가 켜져 있어, 위 한 줄 대신 각 앱 DB 의 상태까지 담긴 더 긴 JSON 이 올 수도 있어요. 어느 쪽이든 `"status":"UP"` 만 보이면 통과예요.

## 9. 인증이 필요한 엔드포인트 호출

이번엔 보호된 엔드포인트를 토큰 없이 호출해서, 인증 필터가 제대로 작동하는지 확인해 봐요.

```bash
curl http://localhost:8081/api/apps/sumtally/users/me
```

토큰을 안 붙였으니 401 과 함께 이런 응답이 와요.

```json
{"error":{"code":"CMN_004","message":"Authentication required"}}
```

이건 정상 동작이에요. 인증 필터가 살아 있어서, [JWT](../reference/glossary.md#인증--보안) 가 없으면 보호된 경로를 막고 401 을 돌려줘요. 응답에서 `data` 필드가 안 보이는 건, 이 레포가 값이 없는 필드를 JSON 에서 아예 빼도록 설정해 둔 덕분이에요. 에러 코드 `CMN_004` 는 "인증이 필요합니다" 를 뜻하는 이 레포 고유의 코드고, 만료된 토큰이나 잘못된 토큰은 각각 `CMN_007`·`CMN_008` 로 더 구체적으로 구분돼요.

> `/api/apps/<slug>/users/me` 는 코어 `UserController` 가 제공하는 유저 프로필 엔드포인트로, auth·device 처럼 앱별 경로(`/api/apps/<slug>/`) 아래에 두어 path slug ↔ JWT slug 일치를 강제해요 (`AppSlugVerificationFilter`). 토큰 검증은 그보다 먼저 일어나므로, 토큰 없이 호출하면 슬러그와 무관하게 항상 401 이에요.

## 10. 로그 수준과 색깔

local 프로필의 콘솔 로그는 이렇게 보여요.

- `INFO` 가 기본 수준이에요.
- `DEBUG` 는 `logging.level.com.factory=DEBUG` 환경변수로 켤 수 있어요.
- `ERROR` 는 눈에 띄게 빨간색으로 강조돼요.
- 각 줄에 `requestId` 가 대괄호로 붙어서, 한 HTTP 요청이 남긴 로그를 묶어서 추적할 수 있어요. 그 옆 대괄호에는 어느 앱(`appSlug`)의 요청인지도 함께 찍혀요.

운영에서는 콘솔 텍스트 대신 JSON 포맷 로그를 써요. 로그 수집 도구인 [Loki](../reference/glossary.md#관측성--로깅) 가 파싱하기 쉽도록 한 형식이에요.

## 11. 끝낼 때

`Ctrl+C` 를 한 번 누르면 이런 종료 로그가 나와요.

```
Stopping service [Tomcat]
HikariPool-1 - Shutdown initiated...
HikariPool-1 - Shutdown completed.
```

[graceful shutdown](../reference/glossary.md#운영--인프라)이에요. 처리 중이던 요청을 끝까지 마친 뒤에 DB 연결을 정리하고 종료하죠. 그래서 진행 중인 요청이 있으면 종료가 몇 초쯤 늦어질 수 있는데, 정상 동작이에요. 급하게 끄고 싶으면 `Ctrl+C` 를 한 번 더 누르세요.

## 체크리스트 — 여기까지 봤나요?

- [ ] `BUILD SUCCESSFUL` 이 떴어요
- [ ] `Active Spring profiles: [local]` 이 보였어요
- [ ] `HikariPool-1 - Start completed.` 가 떴어요
- [ ] `Successfully applied 15 migrations to schema "<slug>"` 가 떴어요
- [ ] `Tomcat started on port(s): 8081` 이 떴어요
- [ ] `Started FactoryApplication` 이 떴어요
- [ ] `curl .../actuator/health` 가 `"status":"UP"` 을 돌려줬어요

모두 체크됐다면, 이 레포가 당신의 노트북에서 살아 있는 상태예요. 축하드려요.

## 다음

| 다음 행동 | 문서 |
|---|---|
| 실제 코드를 한 번 수정해 보기 | [`첫 수정 — nickname 컬럼 추가`](./first-change.md) |
| 앱 모듈을 만들어 보기 | [`Onboarding — 템플릿 첫 사용 가이드`](../start/onboarding.md) |
| 에러로 막혔을 때 | [`Onboarding §6 흔한 에러`](../start/onboarding.md#6-흔한-에러) |

---

## 📖 책 목차 — Journey 입문 단계

이 문서는 [`📚 template-spring — 책 목차 (Developer Journey)`](./README.md) 의 **입문 단계 (첫 기동 직후 로그 해석)** 에 해당해요.

| 방향 | 문서 | 한 줄 |
|---|---|---|
| ← 이전 | [`Onboarding — 템플릿 첫 사용 가이드`](../start/onboarding.md) | 환경 셋업과 첫 기동까지 |
| → 다음 | [`첫 수정 — nickname 컬럼 추가`](./first-change.md) | 코드 한 줄을 직접 바꿔 보기 |

## 관련 문서

- [`Onboarding — 템플릿 첫 사용 가이드`](../start/onboarding.md) — 환경 셋업부터 첫 기동까지
- [`첫 수정 — nickname 컬럼 추가`](./first-change.md) — 코드 수정과 마이그레이션 첫 경험
- [`첫 배포`](./first-deploy.md) — Mac mini 운영 환경 배포 첫 경험
- [`도그푸딩 환경 셋업 가이드`](../start/dogfood-setup.md) — 운영 검증 사이클
