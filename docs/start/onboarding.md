# Onboarding — 템플릿 첫 사용 가이드

> **유형**: How-to · **독자**: Level 1 · **읽는 시간**: ~1~2시간 (실제 셋업 포함)

> **편의를 위해 `<repo-name>` 심볼릭 링크를 등록했습니다.**
>
> 본 문서의 `<repo-name> <verb>` 표기는 `./factory install` 후 등록된
> `~/.local/bin/<repo-name>` symlink 를 의미해요. `<repo-name>` 자리에는
> *파생 레포의 이름* (예: `sumtally`, `gymlog`) 이 들어가요.
>
> symlink 미등록 시 `bash ./factory <verb>` 또는 직접 `bash tools/<low-level>.sh`
> 호출도 동등해요.

GitHub Template 을 "Use this template" 으로 복제한 직후부터 **로컬에서 Spring 앱 첫 기동** 까지의 가이드예요.

## 대상 + 선행 지식

- **대상**: 이 템플릿으로 새 프로젝트를 시작하는 Java 백엔드 개발자 (본인 미래의 자신 포함)
- **선행 지식**:
  - Java / Spring Boot 기초 (JPA, DI, application.yml)
  - Git 기본
  - Docker 개념 (container, compose)
  - 터미널 (macOS / Linux)

---

## 1. 사전 설치 체크리스트

아래 도구가 **모두 이미 설치되어 있으면 Section 3~4 로 바로 건너뛰세요**. 처음 설치라면 각 항목에 15~20분씩 더 소요돼요.

| 도구 | 버전 | 설치 (macOS) | 설치 (Linux) |
|---|---|---|---|
| **JDK** | 21 (Temurin 권장) | `brew install --cask temurin@21` | [adoptium.net](https://adoptium.net/) tarball |
| **Docker Desktop** | 최신 | [docker.com](https://www.docker.com/products/docker-desktop/) | `apt install docker.io` |
| **mc** (MinIO Client) | 최신 | `brew install minio/stable/mc` | [min.io/docs/minio/linux/reference/minio-mc.html](https://min.io/docs/minio/linux/reference/minio-mc.html) |
| **Node.js** | 18+ | `brew install node` | `nvm install 20` |
| **gh** (GitHub CLI, 선택) | 최신 | `brew install gh` | [cli.github.com](https://cli.github.com/) |

### 검증
```bash
java --version     # 21.x.x 이상
docker --version   # 20.x 이상
mc --version       # RELEASE.2024.xx.xx 이상
node --version     # v18 이상
```

---

## 2. 파생 레포 생성

### 2.1 GitHub 에서 복제
1. 템플릿 레포 페이지 → **Use this template** → Create new repository
2. 이름 설정 (예: `myapp-backend`)

### 2.2 로컬 clone
```bash
git clone git@github.com:<your-org>/myapp-backend.git
cd myapp-backend
```

### 2.3 `npm install` — **bootstrap 이 자동 실행**

이 프로젝트는 Java Gradle 기반이지만 **커밋 메시지 규약 도구 (husky / commitlint / commitizen)** 를 npm 으로 관리해요.

`./tools/init-server.sh` 실행 시 (또는 `./factory <cmd>` 의 어떤 명령이든 첫 진입 시) 내부적으로 `npm install` 을 자동 수행하므로 **별도로 수동 실행할 필요가 없어요**. 대신 **Node 18+ 가 필수** 예요. bootstrap 이 Node 를 찾지 못하면 즉시 fail 해요.

> **백업 안전망**: `./gradlew` 를 직접 호출 (factory CLI 우회) 시에는 build 시점에 husky 미활성 warning 이 출력돼요. 그래도 활성화하려면 `npm install` 1회 수동.

자동 수행되는 것:
- `node_modules/` 디렉토리 생성 (약 50 MB, `.gitignore` 포함)
- `.husky/` 의 git hook 활성화 (`prepare` 스크립트)
- `git commit` 마다 `.husky/commit-msg` 가 **Conventional Commits 형식 + Claude 트레일러 차단** 검증
- `npx cz` 로 대화형 커밋 메시지 작성 가능

**재실행 시에도 안전**: bootstrap 은 `node_modules` + `.husky/_` 가 이미 있으면 skip 하므로 여러 번 돌려도 비용이 거의 0 이에요.

---

## 3. 환경 변수 설정

### 3.1 `.env` 생성
```bash
cp .env.example .env
```

### 3.2 **최소 필수** 편집 (로컬 dev 기준)

**dev 프로파일은 사실상 `cp .env.example .env` 만으로 충분해요.**
`application-dev.yml` 이 JWT_SECRET 등 필수 값의 fallback 을 내장하고 있어 `.env` 가 비어있어도 기동돼요.

**prod 기동 또는 본인만의 비밀키를 쓰고 싶을 때** 아래 값들을 덮어쓰세요.

```bash
# JWT 서명 비밀키 — 아래 생성 명령으로 만든 64자 문자열을 여기에 붙여넣기 (prod 필수)
JWT_SECRET=<put-generated-value-here>
```

**JWT_SECRET 생성 명령**:
```bash
openssl rand -hex 32
```
출력된 64자 hex 문자열을 복사해서 `JWT_SECRET=` 뒤에 붙여넣어요.

⚠️ `.env` 파일은 shell substitution 을 **해석하지 않아요**. `JWT_SECRET=$(openssl rand -hex 32)` 를 그대로 넣으면 리터럴 문자열 17자로 저장되어 `JwtProperties` 의 32자 검증에 실패해요.

### 3.3 선택 — 오브젝트 스토리지 (MinIO)

**로컬 docker MinIO** 를 쓸 경우 다음과 같이 설정해요.
```bash
APP_STORAGE_MINIO_ENDPOINT=http://localhost:9000
APP_STORAGE_MINIO_ACCESS_KEY=minioadmin
APP_STORAGE_MINIO_SECRET_KEY=minioadmin
APP_STORAGE_MINIO_REGION=us-east-1
APP_STORAGE_MINIO_BUCKETS_0=dev-shared
```

**template 관리자의 NAS MinIO 는 LAN 전용** 이라 파생 레포 개발자는 쓸 수 없어요. 본인 NAS / S3 호환 서비스 / 로컬 docker 중에서 선택하세요.

endpoint 미설정 시 `InMemoryStorageAdapter` 로 fallback 돼요 (업로드는 메모리에만 저장되고, 재시작하면 소실돼요).

**Bucket 자동 생성 (수동 `mc mb` 불필요)** — `APP_STORAGE_MINIO_BUCKETS_*` 리스트에 이름만 넣으면 Spring 부팅 시 `BucketProvisioner` 가 자동 생성하고 retention 도 적용해요. Idempotent 라서 재기동해도 중복 생성 에러가 없어요. 여러 개를 추가하려면 다음과 같이 인덱스를 늘려요.
```bash
APP_STORAGE_MINIO_BUCKETS_0=dev-shared
APP_STORAGE_MINIO_BUCKETS_1=sumtally-receipts   # 운영 앱별 분리 시
APP_STORAGE_MINIO_BUCKETS_2=rny-avatars
```

---

## 4. 첫 기동

### 4.1 시간 예상

| 조건 | 예상 시간 |
|---|---|
| Prereqs 모두 설치됨 (JDK/Docker/mc/Node) | **10~15분** |
| Cold install (프레쉬 맥북, 처음 설치) | **25~30분** (Gradle 의존성 5~12분 + Docker 이미지 pull 1~2분 포함) |

Gradle 첫 빌드는 모든 모듈의 의존성을 다운로드해요. 두 번째부터는 캐시를 사용해요.

### 4.2 빠른 경로 — `./factory init` (권장)

> **TL;DR — 한 줄이 아래 §4.3 의 수동 단계를 모두 자동화해요 (관측성 제외 — §4.4 참고).**
> **로컬 → 운영 단계적 셋업** 이라 첫 사용자가 운영값까지 한 번에 채울 부담이 없어요.

```bash
# ── 로컬 셋업 (운영값 미요구) ────────────────────────────
./factory init <owner>/<repo>           # = ./factory local init
#  → .env 생성 + docker(postgres + minio + spring, 옵션: wiremock) 기동
#    + verify-local 자동 호출 + ~/.local/bin/<repo> symlink 등록
#  이후 어디서든:    <repo> test / <repo> new <slug> / <repo> start

# ── 운영 셋업 (.env.prod REQUIRED 채운 후) ─────────────
<repo> prod init
#  → CLOUDFLARE_API_TOKEN 으로 ZONE_ID/ACCOUNT_ID/TUNNEL_ID 자동 추출
#    + DNS CNAME + Tunnel ingress 자동 등록
#    + GitHub Secrets / Variables push + verify-server 자동 호출

# ── 한 번에 모두 (local + prod 동시) ──────────────────
<repo> all init
#  → 위 둘 한 번에 (= tools/init-server.sh 직접 호출과 동등)
```

자동 수행:
- **prereqs 검증** (JDK 21~25 / Docker / Node 18+ / gh CLI) — 누락 시 설치 명령을 안내해요
  - JDK 부재 시 brew openjdk@21 자동 탐지 + JAVA_HOME 자동 export 까지 처리해요
- **`.env` / `.env.prod` 자동 생성** + `JWT_SECRET` / `DB_PASSWORD` 자동 발급
- **`BASE_DOMAIN` + `SUBDOMAIN` 으로 `PUBLIC_HOSTNAME` / `APP_DOMAIN` 자동 조립**
- **`CLOUDFLARE_API_TOKEN` 1개로 모든 ID + DNS + Tunnel 자동** (prod init)
- **GitHub Secrets / Variables 자동 push** (transient 에러 시 3회 재시도, prod init)
- **docker compose up** + Postgres ready 대기 (local init)
- **Spring 컨테이너 기동** — `infra/docker-spring-dev-entrypoint.sh` 가 `.env` 의 host 를 컨테이너 네트워크에 맞게 자동 변환해요
- **`verify-server.sh` (운영) / `verify-local.sh` (로컬) 자동 호출**

완료 후엔 다음과 같이 사용할 수 있어요.

```bash
<repo> test         # 로컬 e2e 4/4 PASS 재검증
<repo> new gymlog   # 새 앱 모듈 (schema + V001~V007 + admin user 시드 + SELECT)
<repo> prod deploy  # kamal blue/green 배포 (.env.prod 채워진 상태에서)
```

📖 명령어 전체 매트릭스는 [`docs/start/cli-guide.md`](./cli-guide.md) 에 정리돼 있어요.

아래 §4.3 (수동 최소 기동) 은 **wrapper 안 쓰고 단계를 직접 확인하고 싶을 때** 참고해요.

---

### 4.3 최소 기동 (DB 만) — 수동

```bash
# 1. Postgres 컨테이너 기동
docker compose -f infra/docker-compose.dev.yml up -d postgres

# 2. Postgres 준비 확인 (optional, 컨테이너명은 settings.gradle 의 rootProject.name 기반)
docker exec "$(grep -E '^rootProject.name' settings.gradle | sed -E "s/.*=[[:space:]]*'([^']+)'.*/\1/")-postgres-dev" pg_isready -U postgres
# 또는 더 간단히: bash tools/verify-local.sh   # Postgres + MinIO + (옵션) WireMock + bootRun 한 번에 검증

# 3. .env 를 shell 환경변수로 로드 (Spring Boot 는 .env 를 자동으로 읽지 않아요)
set -a; source .env; set +a

# 4. Spring Boot 기동 (첫 실행은 Gradle 의존성 다운로드로 수 분 소요)
./gradlew :bootstrap:bootRun

# 5. 다른 터미널에서 헬스 체크
curl http://localhost:8081/actuator/health
# → {"status":"UP",...}
```

⚠️ **Step 3 필수** — Spring Boot 는 `.env` 파일을 직접 읽지 않아요. 건너뛰면 `SPRING_PROFILES_ACTIVE=dev` 가 적용되지 않아 `app.jwt.secret must be at least 32 characters` 에러와 함께 기동에 실패해요. 한 줄로 끝내고 싶다면 다음과 같이 해요.
```bash
SPRING_PROFILES_ACTIVE=dev ./gradlew :bootstrap:bootRun
```
또는
```bash
./gradlew :bootstrap:bootRun --args='--spring.profiles.active=dev'
```

성공 지표는 다음과 같아요.
```
MinIO client configured: endpoint=http://...      (MinIO 설정했을 경우)
Tomcat started on port 8081 (http)
Started FactoryApplication in 4.xxx seconds
```

### 4.4 관측성은 로컬 dev 에서 제외돼요

관측성 스택(Loki/Grafana/Prometheus/Alertmanager)은 운영 전용으로 범위가 조정됐어요. 로컬에서 대시보드/쿼리 동작 확인이 필요하면 Mac mini 운영 환경의 `log.<domain>` 에서 확인하세요. 자세한 기동 방법은 [`운영 모니터링 셋업 가이드`](../production/setup/monitoring-setup.md) (Mac mini 기준) 를 참고하세요.

로컬 dev 에 관측성 스택이 필요 없는 이유 — 메모리·docker 리소스 부담 대비 실제 활용 빈도가 낮아요. 로그는 `./gradlew :bootstrap:bootRun` 콘솔 출력으로, 메트릭은 `/actuator/prometheus` HTTP 엔드포인트로 충분해요.

> **여기까지 `curl /actuator/health` 로 `UP` 응답을 받았으면 onboarding 성공이에요.** 아래 §5 이후는 실제 앱 개발을 시작할 때 읽어도 돼요.

### 4.5 운영 DB provider 선택 (prod 배포 시점에만 결정)

**로컬 dev 는 Supabase 가 필요 없어요** — 위 §4.3 의 `docker compose ... postgres` 로 자급자족이 돼요. 아래는 **운영 배포 (Mac mini Kamal) 시점에 결정**할 내용이에요.

`tools/new-app/new-app.sh <slug> --provision-db` 는 어떤 provider 여도 동일한 표준 `psql` 을 호출해요. 결정해야 할 것은 **`DB_PSQL_URL`** (admin role, schema/role 생성 용) 한 줄과 **`DB_URL` / `DB_USER` / `DB_PASSWORD`** (앱 런타임 credential) 예요.

| Provider | 특징 | connection string 형태 |
|---|---|---|
| **Supabase** ⭐ (template 관리자 default) | 관리형, Free tier 충분, Seoul region 지연 최소, Supavisor pooler 제공 | `jdbc:postgresql://aws-1-<region>.pooler.supabase.com:6543/postgres?currentSchema=core&pgbouncer=true` |
| **AWS RDS** | 엔터프라이즈 안정성, VPC 통합 | `jdbc:postgresql://<rds-endpoint>.rds.amazonaws.com:5432/<db>?currentSchema=core` |
| **Fly.io Postgres** | 앱 근접 배포, 글로벌 edge | `jdbc:postgresql://<app>.flycast:5432/<db>?currentSchema=core` |
| **자체 호스트 Postgres** | 완전 통제, 비용 0 | `jdbc:postgresql://<host>:5432/<db>?currentSchema=core` |

준비 체크리스트 (운영 provider 사용 시):
- [ ] 인스턴스/프로젝트 생성
- [ ] admin credential 확보 (운영용 `DB_PSQL_URL` — `.env` 에 저장 금지, shell export 로만 사용)
- [ ] 앱용 `DB_URL` / `DB_USER` / `DB_PASSWORD` 확보 — `.env` 에 저장
- [ ] `new-app.sh --provision-db` 실행 **직전에** shell 에서 `export DB_PSQL_URL='postgresql://postgres:<pw>@<host>:5432/postgres'` (운영 DB 에 provision 할 때만. 로컬 docker 는 `.env.example` 의 기본값으로 자동 처리)

**Supabase 사용 시 주의**: Supavisor pooler (`:6543`) 를 쓰면 Spring Boot blue/green 배포 오버랩 구간의 connection 폭증이 안전해져요. Free tier 의 direct (`:5432`) connection 한도가 낮아서 production 부하엔 pooler 가 필수예요.

**AWS RDS / Fly.io / 자체 호스트 주의**: instance 의 `max_connections` 설정과 HikariCP pool size (`spring.datasource.hikari.maximum-pool-size`) 합이 맞는지 확인하세요. 앱 모듈이 많아지면 total = N개 × pool × blue/green(2) 로 빠르게 증가해요.

---

## 5. 앱 모듈 추가 (`new-app.sh`)

새 앱 추가는 **2 단계** — **1단계(코드) 자동**, **2단계(환경)도 대부분 자동** 이에요.

```bash
./tools/new-app/new-app.sh gymlog
```

### 1단계 — 코드 scaffolding (자동)

- `apps/app-gymlog/` 모듈 생성 (build.gradle, HealthController, AuthController 예시)
- `apps/app-gymlog/src/main/java/com/factory/apps/gymlog/config/GymlogDataSourceConfig.java` 자동 생성 (multi-DataSource wiring, Item 10b)
- Flyway 마이그레이션 디렉토리 + V001~V006 기본 파일
- AutoConfiguration 등록
- `settings.gradle` 에 `:apps:app-gymlog` include 추가
- `bootstrap/build.gradle` 에 의존성 추가
- 모듈 README 생성 (`template-v` 버전 기반)

### 2단계 — 환경 setup (대부분 자동)

`./tools/new-app/new-app.sh gymlog` 가 자동 수행해요.
- ✅ `.env` 에 `GYMLOG_DB_URL/USER/PASSWORD` placeholder 추가
- ✅ `.env` 에 `APP_STORAGE_MINIO_BUCKETS_<N>=gymlog-uploads` 추가 (BucketProvisioner 가 Spring 기동 시 실제 생성)
- ✅ `.env` 에 `APP_CREDENTIALS_GYMLOG_*` placeholder 추가

Opt-in 자동 수행 (`--provision-db` 플래그 사용 시):
- ✅ Postgres 에 `gymlog` schema + role 생성

> **`DB_PSQL_URL` 이 뭔가요?** schema 와 role 을 **생성할 관리자 권한** connection string 이에요.
> 앱 전용 `GYMLOG_DB_URL` (앱 role `gymlog_app` 로 접속) 과는 다른 개념 — 수퍼유저/관리자 credential 이 필요해요.
>
> - **로컬 dev** (docker-compose postgres): **별도 설정 불필요** — `.env.example` 에 `DB_PSQL_URL=postgresql://postgres:dev@localhost:5433/postgres` 기본값이 있고, `new-app.sh` 가 `.env` 에서 자동 로드해요. 로컬 docker 환경은 결정적이라 사용자 조작이 없어요.
> - **운영** (Supabase 등): 관리자 credential 을 **shell 에서 export** 해야 해요 (`.env` 에 저장 금지). `new-app.sh` 는 shell 환경변수를 `.env` 값보다 우선 사용하므로 일시 덮어써요.
>
> ```bash
> # 로컬 docker — export 불필요
> ./tools/new-app/new-app.sh gymlog --provision-db
>
> # 운영 (Supabase 등) — shell export 필수
> export DB_PSQL_URL='postgresql://postgres:<pw>@<host>:5432/postgres'
> ./tools/new-app/new-app.sh gymlog --provision-db
> ```
>
> `--provision-db` 없이 수동 실행도 가능해요: `psql "$DB_PSQL_URL" -v ON_ERROR_STOP=1 -f infra/scripts/init-app-schema.sql`

여전히 수동으로 채워야 해요.
- DB_URL 의 `<host>` 실제 값으로 교체
- GOOGLE_CLIENT_IDS / APPLE_BUNDLE_ID 실제 값 발급 ([`docs/social-auth-setup.md`](./social-auth-setup.md))
- 도메인 테이블 작성 (V007+, 비즈니스 로직)

### 5.1 N번째 앱 추가 — 첫 앱과 **완전 동일한 명령**

`new-app.sh` 는 멱등 설계라서 첫 앱이든 10번째 앱이든 동일한 명령으로 호출해요.

```bash
./tools/new-app/new-app.sh foodlog --provision-db
```

기존 앱(`gymlog`)에 **영향 없이** 자동 처리되는 것:

| 항목 | 자동 동작 |
|---|---|
| `apps/app-foodlog/` | 신규 디렉토리 (기존 `apps/app-gymlog/` 무관) |
| `.env` 의 `FOODLOG_DB_*`, `APP_CREDENTIALS_FOODLOG_*` | placeholder append — 키 중복 시 skip |
| `APP_STORAGE_MINIO_BUCKETS_<N>=foodlog-uploads` | 인덱스 **자동 증가** (`_0=gymlog-uploads` 다음 `_1=foodlog-uploads`) |
| `settings.gradle`, `bootstrap/build.gradle` | 중복 체크 후 append |
| Postgres `foodlog` schema + `foodlog_app` role | `--provision-db` 플래그 시 생성 |
| `FoodlogDataSourceConfig.java` | bean 이름이 slug prefix 로 격리 → `gymlog` bean 과 충돌 없음 |

격리 보장:
- **ArchUnit r2** (`APPS_MUST_NOT_DEPEND_ON_EACH_OTHER`) — `foodlog` 에서 실수로 `gymlog` 패키지 import 시 CI 가 차단해요
- **Flyway 히스토리** — schema 별 독립 (`db/migration/foodlog/`)
- **HikariCP 풀** — `foodlog-pool` 로 분리

**주의**: 이미 떠있는 Spring 프로세스는 신규 모듈을 감지하지 못해요. 스크립트 실행 후 재기동해야 해요.

---

## 6. 흔한 에러 5개

### 6.1 `YAML DuplicateKeyException` — application.yml 파싱 실패

증상은 다음과 같아요.
```
org.yaml.snakeyaml.constructor.DuplicateKeyException: 
  found duplicate key app in application-xxx.yml
```

원인 — YAML 에 같은 레벨의 키가 중복으로 선언됐어요.

해결 방법:
```bash
grep -nE "^<key>:" bootstrap/src/main/resources/application-*.yml
# 같은 키가 2번 이상 나오는 파일을 찾아서 병합
```

### 6.2 DB 연결 실패 — Connection refused `localhost:5433`

증상:
```
org.postgresql.util.PSQLException: Connection to localhost:5433 refused
```

원인 — Postgres 컨테이너가 안 떠 있어요.

해결:
```bash
docker ps | grep postgres
# 없으면:
docker compose -f infra/docker-compose.dev.yml up -d postgres
```

### 6.3 Docker daemon not running

증상 (OS 별 경로가 다름):
```
Cannot connect to the Docker daemon at unix:///var/run/docker.sock              # Linux
Cannot connect to the Docker daemon at unix:///Users/<you>/.docker/run/docker.sock  # macOS
```

해결:
- **macOS**: Docker Desktop 앱 실행 (`open -a Docker` 로도 가능해요)
- **Linux**: `sudo systemctl start docker`
- daemon 준비 대기: `until docker info >/dev/null 2>&1; do sleep 2; done`

### 6.4 MinIO 접속 불가 (template 관리자의 NAS 시도 시)

증상:
- `Connection refused` 또는 timeout

원인 — `.env` 의 `APP_STORAGE_MINIO_ENDPOINT` 가 template 관리자의 LAN 주소 (예: `192.168.45.x`) 라서 파생 레포 개발자 네트워크에서 접근이 안 돼요.

해결 3가지 중 선택하세요.
1. **로컬 docker MinIO** 사용:
   ```bash
   docker compose -f infra/docker-compose.dev.yml up -d minio
   # .env: APP_STORAGE_MINIO_ENDPOINT=http://localhost:9000
   ```
2. **본인 NAS / 클라우드 S3** 엔드포인트로 교체
3. **InMemoryStorageAdapter fallback**: `APP_STORAGE_MINIO_ENDPOINT` 라인 주석 처리 → 메모리 기반 fake 동작

### 6.5 Flyway checksum mismatch

증상:
```
Validate failed: Migration checksum mismatch for migration version V00x
```

원인 — 마이그레이션 파일이 적용 후 수정됐어요 (해시 변경).

해결 (**로컬 dev 만**):
```bash
# 1. DB 초기화
docker compose -f infra/docker-compose.dev.yml down -v
docker compose -f infra/docker-compose.dev.yml up -d postgres

# 2. 다시 기동 — Spring 이 모든 마이그레이션을 재실행해요
./gradlew :bootstrap:bootRun
```

운영에선 절대 이 방법을 쓰면 안 돼요. `flyway repair` 또는 신규 마이그레이션 (`Vnnn`) 으로 해결하세요.

### 6.6 JwtProperties 에러 — 기동 시 "app.jwt.secret must be at least 32 characters"

증상:
```
Failed to bind properties under 'app.jwt' to com.factory.common.security.jwt.JwtProperties:
  Reason: app.jwt.secret must be at least 32 characters (256 bits) for HS256
```
직전 로그에 `No active profile set, falling back to 1 default profile: "default"` 가 있으면 **원인 A** 예요.

**원인 A (가장 흔함)**: `.env` 의 `SPRING_PROFILES_ACTIVE=dev` 가 Spring 에 전달되지 않아 `application-dev.yml` 이 로드되지 않아요. Spring Boot 는 `.env` 를 **자동으로 읽지 않아요**.

해결 — bootRun 전에 env 를 shell 에 export 하세요.
```bash
set -a; source .env; set +a
./gradlew :bootstrap:bootRun
```
또는 한 줄로:
```bash
SPRING_PROFILES_ACTIVE=dev ./gradlew :bootstrap:bootRun
```

**원인 B**: `.env` 의 `JWT_SECRET` 값이 실제로 32자 미만이에요. 자주 발생하는 케이스 두 가지:
- `JWT_SECRET=$(openssl rand -hex 32)` 을 그대로 복사해서 리터럴 17자로 저장돼요 (`.env` 는 shell substitution 을 안 해요)
- 임의로 짧은 문자열 입력

해결:
```bash
openssl rand -hex 32   # 64자 출력
```
출력된 값을 `.env` 에 `JWT_SECRET=<값>` 형태로 직접 붙여넣어요.

### 6.7 `./gradlew bootRun` 중지 후 Ctrl+C 반응 느림

증상 — Ctrl+C 눌러도 최대 30초 대기 후 종료돼요.

원인 — `application.yml` 에 `server.shutdown: graceful` 설정이 있어요. 진행 중인 요청을 안전하게 마무리하려고 대기하는 동작이에요.

해결:
- 급하면 Ctrl+C 두 번 (SIGINT 2회) 또는 `kill -9 <pid>`
- 정상 흐름에서는 기다리면 돼요 (요청이 없으면 즉시 종료돼요)

---

## 7. 현재 미구현 / Stub 상태인 기능

이 표는 *진짜 미구현 / stub fallback* 만 정리해요. 운영 배포 / 앱 프로비저닝은 *이미 구현* 되어 있어서 표에서 제거됐어요.

| 영역 | 상태 | 동작 |
|---|---|---|
| **이메일/비밀번호 가입/로그인** | ✅ 완전 동작 | - |
| **Apple / Google 소셜 로그인** | ✅ 완전 동작 (credential 설정 시) | `.env` 에 `APP_CREDENTIALS_<SLUG>_*` 필요 |
| **JWT 발급/회전** | ✅ 완전 동작 | - |
| **Kamal 배포 파이프라인** | ✅ 완전 동작 | `factory prod deploy` / `factory prod init` / `factory prod force-clear` 등 (`docs/start/cli-guide.md`) |
| **앱 프로비저닝 (`new-app.sh`)** | ✅ 완전 동작 | `factory new <slug>` 또는 `--provision-db` 플래그 — schema + role 자동 생성 |
| **이메일 발송** (Resend) | dev: optional / prod: 필수 | 키 없으면 `LoggingEmailAdapter` fallback (콘솔 로그 + dev 응답에 raw token 노출). prod 는 strict — 키 누락 시 부팅 실패. 자세히: [`email-verification.md`](../api-and-functional/functional/email-verification.md) |
| **오브젝트 스토리지** | ⚠️ endpoint 필요 | 미설정 시 `InMemoryStorageAdapter` fallback |
| **결제 (PortOne PG)** | ⚠️ key 필요 | 미설정 시 `StubPaymentAdapter` 가 graceful 503 응답 (`PAY_008 CONFIG_MISSING`) |
| **인앱 결제 (IAP)** | ⚠️ key 필요 | 미설정 시 `StubIapAdapter` 가 graceful 503 응답 |
| **Push Notification** | 🚧 NoOp | `NoOpPushAdapter` 가 로그만 남겨요. FCM 설정 시 `FcmPushAdapter` 활성 |

---

## 8. 그 다음 읽을 것

| 목적 | 문서 |
|---|---|
| 코드 아키텍처 (포트/어댑터, 모듈 의존) | [`Architecture Reference`](../structure/architecture.md) |
| 인프라 구성 (DB/스토리지/관측성 전체 상태) | [`인프라 (Infrastructure)`](../production/deploy/infrastructure.md) |
| 설계 철학 (36개 ADR) | [`Repository Philosophy — 책 안내`](../philosophy/README.md) |
| 문서 작성 규칙 | [`Documentation Style Guide`](../reference/STYLE_GUIDE.md) |
| 인프라 결정 근거 (Supabase/NAS/맥미니 등) | [`인프라 결정 기록 (Decisions — Infrastructure)`](../production/deploy/decisions-infra.md) |
| 코딩 규약 (naming, DTO, exception 등) | [`../convention/`](../convention/) |
| 테스트 전략 (4층 구조) | [`Testing Strategy`](../production/test/testing-strategy.md) |
| 미완료 / 향후 작업 목록 | [`Backlog`](../planned/backlog.md) |
| 장애 시나리오 분석 | [`Edge Cases & Risk Analysis`](../reference/edge-cases.md) |
| 도그푸딩 시간 순 walkthrough | [`도그푸딩 walkthrough`](./dogfood-walkthrough.md) |

---

## 도움 요청 체크리스트

문제가 생기면 이슈 만들기 전 이 체크리스트를 확인하세요.

- [ ] Section 1 의 도구 버전이 맞는가? (`java --version` 등)
- [ ] `.env` 파일이 존재하고 `JWT_SECRET` 이 32자 이상인가?
- [ ] `docker ps` 로 postgres 컨테이너가 `Up` 상태인가?
- [ ] Section 6 의 흔한 에러 5개에 해당하는가?
- [ ] `./gradlew clean build` 가 성공하는가?

그래도 해결이 안 되면 로그 전체 + `.env` (비밀번호는 가려서) + `docker ps` 출력을 첨부해서 이슈를 제기하세요.

---

## 📖 책 목차 — Journey 2~3단계

[`📚 template-spring — 책 목차 (Developer Journey)`](../onboarding/README.md) 의 **2단계 (어떻게 써? 로컬 dev)** 와 **3단계 (클론 후 뭐부터? 첫 앱 모듈 추가)** 예요.

| 방향 | 문서 | 한 줄 |
|---|---|---|
| ← 이전 | [`Architecture Reference`](../structure/architecture.md) | 1단계 — 모듈 구조 한 눈 |
| → 다음 | [`소셜 로그인 설정 가이드`](./social-auth-setup.md) | 4단계 — 외부 자격 증명 발급 (Google/Apple) |

**막혔을 때**: §6 흔한 에러 / [`도그푸딩 함정`](./dogfood-pitfalls.md) / [`FAQ`](./dogfood-faq.md) / [`도그푸딩 walkthrough`](./dogfood-walkthrough.md)
**왜 이렇게?**: [`Repository Philosophy — 책 안내`](../philosophy/README.md) (36개 ADR · 테마 1~8) / [`인프라 결정 기록 (Decisions — Infrastructure)`](../production/deploy/decisions-infra.md) (I-01~I-13)
