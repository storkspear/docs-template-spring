# Onboarding — 템플릿 첫 사용 가이드

> **유형**: How-to · **독자**: Level 1 · **읽는 시간**: ~1~2시간 (실제 셋업 포함)

이 문서는 GitHub Template 을 "Use this template" 으로 복제한 직후부터 **내 노트북에서 Spring 앱이 살아 움직이는 순간** 까지, 첫 사용자를 옆에서 한 단계씩 안내하는 가이드예요. 처음 보는 도구가 나오면 설치하는 법까지 같이 짚고, 왜 이 단계가 필요한지를 먼저 설명한 뒤 명령을 보여줘요.

전체 흐름은 시간 순으로 이렇게 흘러가요.

```
도구 설치 (§1)  →  레포 만들기 + 첫 기동 (§2)  →  첫 앱 모듈 추가 (§3)
                                                        ↓
        부가 — 환경 변수 (§4) · 공동 작업자 (§5) · 흔한 에러 (§6) · 미구현 기능 (§7)
```

처음이라면 §1 → §2 → §3 만 차례로 따라가면 "첫 앱이 뜨는" 데까지 도달해요. §4 이후는 필요해질 때 돌아와 읽어도 괜찮아요.

## 누구를 위한 문서인가

이 템플릿으로 새 프로젝트를 시작하는 Java 백엔드 개발자를 위한 문서예요. 6개월 뒤 이 레포를 다시 켜는 미래의 나 자신도 포함이고요.

### 선행 지식

아래는 "있으면 막힘 없이 따라갈 수 있는" 배경 지식이에요. 모르는 게 있어도 겁먹지 마세요. 각 항목에 학습 링크를 달아 뒀고, 처음 보는 용어는 [용어 사전](../reference/glossary.md) 에서 바로 찾아볼 수 있어요.

**꼭 필요해요 (없으면 중간에 막혀요)**

- **터미널 기본** — `cd`, 명령 실행, 환경 변수 정도. 이 가이드는 macOS / Linux 기준이에요 ([Windows 는 §1 의 안내](#1-도구-설치) 참고).
- **Git 기본** — clone / commit / push. 익숙하지 않다면 [git 공식 핸드북](https://git-scm.com/book/ko/v2) 의 1~2장이면 충분해요.
- **Java + Spring Boot 감각** — `@Service` / `@Controller` / `application.yml` 이 무엇인지 정도. 처음이라면 [Spring 공식 "Building an Application with Spring Boot" 가이드](https://spring.io/guides/gs/spring-boot) 를 한 번 따라 해 보면 그림이 잡혀요. 용어는 [`Spring Boot`](../reference/glossary.md#프레임워크--빌드) · [`DI`](../reference/glossary.md#프레임워크--빌드) 항목을 참고하세요.

**있으면 더 편해요 (없어도 진행은 돼요)**

- **Docker 개념** — [`container`](../reference/glossary.md#운영--인프라) 와 [`Docker Compose`](../reference/glossary.md#운영--인프라) 가 무엇인지. [Docker 공식 "Get started"](https://docs.docker.com/get-started/) 의 첫 페이지면 감이 잡혀요. 이 템플릿은 Postgres / MinIO 를 docker 로 자동 기동하므로, 직접 명령을 칠 일은 거의 없어요.
- **JPA / Flyway 감각** — [`JPA`](../reference/glossary.md#데이터베이스) 는 객체와 DB 테이블 매핑, [`Flyway`](../reference/glossary.md#데이터베이스) 는 `V001__init.sql` 같은 SQL 파일을 순서대로 한 번씩 실행하는 마이그레이션 도구예요. 첫 기동에는 몰라도 되고, 앱 도메인을 만들 때 다시 만나요.

---

## 1. 도구 설치

먼저 노트북에 필요한 도구를 갖춰요. 이미 다 설치돼 있다면 [§2 레포 만들기](#2-레포-만들기--첫-기동) 로 바로 넘어가도 돼요.

> **이 팩토리는 macOS 기준이에요** (brew · bash · Kamal 전제). Linux 도 대부분 동작하고, 각 도구마다 Linux 설치 경로를 함께 적어 뒀어요. **Windows 는 직접 지원하지 않아요** — WSL2(Windows Subsystem for Linux) 안에서 Linux 환경으로 진행하는 걸 권장해요.

### 한 번에 진단하기 — `./factory doctor`

도구를 하나씩 확인하기 전에, 레포를 clone 한 뒤라면 진단 명령 하나로 무엇이 빠졌는지 한눈에 볼 수 있어요.

```bash
./factory doctor
#  → OS 를 감지하고 도구별로 ✓(설치됨) / ✗(미설치) 를 표시해요.
#    빠진 도구는 OS 에 맞는 설치 명령까지 같이 안내해요 (설치는 직접).
```

`doctor` 는 아무것도 설치하거나 바꾸지 않는 안전한 진단 명령이라, 셋업 전에 먼저 한 번 돌려 보는 걸 권장해요. 아래 표는 그 진단이 확인하는 도구들을 도구별로 정리한 거예요 — **각 도구의 설치와 검증을 한 흐름으로** 묶었어요.

### 로컬 개발에 꼭 필요한 도구

| 도구 | 역할 | 설치 (macOS) | 설치 (Linux) |
|---|---|---|---|
| **JDK 21~25** | Java 빌드/실행 ([`Temurin`](https://adoptium.net/) 권장) | `brew install --cask temurin@21` | [adoptium.net](https://adoptium.net/) tarball |
| **Docker** | Postgres/MinIO 컨테이너 기동 | [OrbStack](https://orbstack.dev/) 또는 [Docker Desktop](https://www.docker.com/products/docker-desktop/) | `apt install docker.io` |
| **Node.js 18+** | 커밋 규약 도구(husky) 구동 | `brew install node` | `nvm install 20` |
| **git** | 버전 관리 | `brew install git` | `apt install git` |
| **psql** | `new app` 의 schema/role 생성 | `brew install libpq` | `apt install postgresql-client` |
| **jq** | 셋업 스크립트의 JSON 처리 | `brew install jq` | `apt install jq` |

설치한 뒤 아래로 각 도구를 검증해요.

```bash
java --version     # 21 ~ 25 사이여야 해요
docker info        # daemon 이 떠 있으면 정보가 출력돼요 (Docker Desktop/OrbStack 실행 필요)
node --version     # v18 이상
git --version
psql --version
jq --version
```

> **Java 버전 주의** — JDK 는 **21 부터 25 까지만** 지원해요. JDK 26 이상은 Gradle 이 아직 그 class file 형식(major 70)을 읽지 못해 빌드가 실패해요. 시스템 java 가 범위를 벗어나도, `factory init` 은 `brew` 의 `openjdk@21` 을 자동으로 찾아 `JAVA_HOME` 을 잡아 주니 너무 걱정하지 않아도 돼요.

### 운영/배포에 필요한 도구

| 도구 | 역할 | 설치 (macOS) | 설치 (Linux) |
|---|---|---|---|
| **gh** (GitHub CLI) | repo 셋업 + Secrets 등록 | `brew install gh` | [cli.github.com](https://cli.github.com/) |
| **mc** (MinIO Client) | 외부 MinIO 운영 (선택) | `brew install minio/stable/mc` | [min.io docs](https://min.io/docs/minio/linux/reference/minio-mc.html) |

```bash
gh --version && gh auth status   # 설치 + 로그인 확인 (gh auth login 으로 로그인)
```

- **gh 는 로컬만이면 없어도 되지만, 운영/배포엔 필수예요.** [§2.3](#23-factory-install--명령어-등록) 의 `./factory install` 이 GitHub 에 `develop` 브랜치와 보호 규칙을 만들 때, 그리고 운영 셋업(`prod init`)이 GitHub Secrets 를 push 할 때 `gh` 가 필요해요. 셋업 스크립트가 `gh auth status` 로 로그인 상태까지 확인하니 미리 `gh auth login` 을 해 두면 매끄러워요.
- **mc 는 선택이에요.** 로컬 개발은 docker 로 띄우는 MinIO 를 root 자격으로 바로 쓰므로 CLI 가 필요 없어요. 본인 NAS 나 외부 S3 호환 스토리지를 직접 운영할 때만 챙기면 돼요.

> **푸시 알림(FCM)을 쓸 때만** `firebase` / `gcloud` 가 추가로 필요해요. 첫 기동에는 무관하니 지금은 건너뛰어도 돼요. `factory doctor` 가 이 둘도 "선택" 으로 함께 점검해 줘요.

---

## 2. 레포 만들기 + 첫 기동

이 절은 **첫 작업자의 최초 셋업** 흐름이에요. 템플릿에서 내 레포를 만들고, clone 해서, 명령 하나로 로컬 환경을 띄우고, 첫 앱까지 올리는 happy path 를 한 번에 따라가요.

> 두 번째 노트북이나 합류하는 동료가 *이미 셋업된* 레포를 새로 clone 하는 경우라면, 여기 말고 [§5 공동 작업자](#5-공동-작업자-두-번째-노트북) 로 가세요. 그쪽이 더 짧아요.

### 2.1 GitHub 에서 내 레포 만들기

1. 템플릿 레포 페이지에서 **Use this template → Create new repository** 를 눌러요.
2. 레포 이름을 정해요 (예: `myapp-backend`). 이게 [파생 레포](../reference/glossary.md#이-레포-고유-용어) 가 돼요.

### 2.2 로컬로 clone

```bash
git clone git@github.com:<your-org>/myapp-backend.git
cd myapp-backend
```

### 2.3 `./factory install` — 명령어 등록

clone 직후 가장 먼저 할 일은 `factory` 를 설치하는 거예요. `factory` 는 셋업 · 기동 · 테스트 · 배포 · 정리를 한곳에서 호출하는 명령 dispatcher 인데, 매번 `bash ./factory ...` 로 부르긴 번거로워요.

```bash
./factory install
#  → ~/.local/bin/<레포-이름> 에 symlink(짧은 호출용 바로가기) 를 등록해요.
#    이후로는 어디서든 '<레포-이름> <명령>' 한 번으로 factory 를 부를 수 있어요.
#  → gh 가 로그인돼 있으면 GitHub 에 develop 브랜치 + 보호 규칙도 함께 만들어 줘요.
```

여기서 **왜 symlink 일까요?** 이 템플릿은 한 사람이 여러 앱을 빠르게 찍어내는 "공장형" 모델이라, `<레포> <env> <verb>` 형태의 자동화 명령을 수시로 부르게 돼요. 긴 경로 대신 짧은 이름으로 부를 수 있게 symlink 라는 바로가기를 하나 등록하는 거예요. 등록 후엔 이 문서에서 `<repo>` 라고 쓴 자리에 *내 레포 이름*(예: `myapp-backend`, 또는 설치 때 정한 짧은 별칭)이 들어가요.

설치하면 어디서든 `<repo> init`, `<repo> test` 같은 명령을 쓸 수 있어요. `~/.local/bin` 이 `PATH` 에 없다는 경고가 뜨면, 안내대로 `~/.zshenv` 에 `export PATH="$HOME/.local/bin:$PATH"` 한 줄을 추가하세요. 명령 전체 매트릭스와 별칭 변경법은 [`CLI 가이드`](./cli-guide.md) 에 정리돼 있어요.

> symlink 를 등록하지 않아도 `bash ./factory <verb>` 또는 `bash tools/<스크립트>.sh` 직접 호출로 동등하게 동작해요.

### 2.4 `<repo> init` — 로컬 환경 셋업

이제 명령 하나로 로컬 개발 환경을 통째로 셋업해요. 운영값은 전혀 요구하지 않으니, 첫 사용자가 부담 없이 돌릴 수 있어요.

```bash
<repo> init
#  자동으로 처리되는 것:
#   · prereqs 검증 (JDK 21~25 / Docker / Node 18+ / gh)
#   · .env 자동 생성 (.env.example → .env) — 직접 복사할 필요 없어요
#   · 프로젝트 이름 rename (template-spring → 내 레포 이름)
#   · docker 로 Postgres + MinIO 기동
#   · verify-local 자동 검증
#   · ~/.local/bin/<repo> symlink 재확인
```

여기서 한 가지 알아 둘 게 있어요. **갓 만든 레포는 앱 모듈이 0개라, 이 시점엔 Spring 이 아직 부팅되지 않아요.** 빈 상태로 뜨는 걸 막는 안전장치(ADR-037)예요. Postgres 와 MinIO 는 떠 있고, [§3 에서 첫 앱을 추가](#3-첫-앱-모듈-추가) 하면 그때 Spring 이 부팅돼요. `init` 이 끝나면 화면에도 "다음 단계 — 첫 앱을 추가하세요" 안내가 떠요.

> **시간 예상** — 도구가 모두 깔려 있으면 **10~15분**, 프레쉬 맥북에서 처음 설치하는 거라면 **25~30분** 정도 걸려요. Gradle 첫 빌드가 모든 모듈의 의존성을 내려받기 때문인데(5~12분), 두 번째부터는 캐시를 써서 훨씬 빨라요.

> **관측성 스택은 로컬에 없어요** — Loki/Grafana/Prometheus 는 운영 전용이에요. 로컬에서는 로그를 콘솔 출력으로, 메트릭을 `/actuator/prometheus` 로 충분히 볼 수 있어 메모리 부담만 큰 스택을 띄우지 않아요. 운영 대시보드가 필요하면 [`운영 모니터링 셋업 가이드`](../production/setup/monitoring-setup.md) 를 참고하세요.

직접 단계를 손으로 확인하고 싶다면 [§2.6 수동 기동](#26-수동으로-한-단계씩-기동하고-싶다면) 을 참고하세요. 보통은 `<repo> init` 하나로 충분해요.

> **로컬은 한 번, 운영은 두 번이에요.** 이 "한 번으로 끝" 은 로컬 기준이에요. 운영(`prod init`)은 1회차에 `.env.prod` 를 만들어 두고 "REQUIRED 값을 채우세요" 하며 멈췄다가, 값을 채운 뒤 같은 명령을 한 번 더 돌려 GitHub Secrets 까지 push 하는 2회차 흐름이에요. 그래서 운영은 `.env.prod` 를 한 번 채워 넣는 단계가 끼어요. 운영 셋업은 배포 단계에서 따로 다뤄요 ([도그푸딩 셋업 가이드](./dogfood-setup.md)).

### 2.5 첫 앱을 올리고 검증

`init` 다음은 [§3 첫 앱 모듈 추가](#3-첫-앱-모듈-추가) 예요. 앱을 하나 추가하면 Spring 이 부팅되고, 아래로 헬스 체크가 통과하면 onboarding 의 첫 목표를 달성한 거예요.

```bash
<repo> new myapp    # 첫 앱 모듈 생성 (자세히는 §3)
<repo> test         # 로컬 e2e 재검증 — spring UP 확인
curl http://localhost:8081/actuator/health
# → {"status":"UP",...}  ← 이게 보이면 성공이에요!
```

### 2.6 수동으로 한 단계씩 기동하고 싶다면

`<repo> init` 이 내부에서 무슨 일을 하는지 직접 확인하고 싶을 때를 위한 참고용이에요. 평소엔 필요 없어요.

```bash
# 1. Postgres 컨테이너 기동
docker compose -f infra/docker-compose.local.yml up -d postgres

# 2. .env 를 shell 환경변수로 로드
#    Spring Boot 는 .env 파일을 자동으로 읽지 않아요 (이게 빠지면 §6.1 에러의 원인).
set -a; source .env; set +a

# 3. Spring Boot 기동
#    ⚠ 앱 모듈이 0개면 부팅이 실패해요 (ADR-037). 먼저 `<repo> new <slug>` 로 앱을 추가하세요.
./gradlew :bootstrap:bootRun

# 4. 다른 터미널에서 헬스 체크
curl http://localhost:8081/actuator/health
```

성공하면 콘솔에 이런 줄들이 보여요.

```
Tomcat started on port 8081 (http)
Started FactoryApplication in 4.xxx seconds
```

---

## 3. 첫 앱 모듈 추가

[파생 레포](../reference/glossary.md#이-레포-고유-용어) 는 처음엔 비즈니스 로직 없이 뼈대만 가지고 있어요. 실제로 쓰려면 [앱 모듈](../reference/glossary.md#이-레포-고유-용어) 을 하나 추가해야 해요. 이 한 번의 명령으로 코드 골격과 DB schema 가 같이 만들어지고, 비로소 Spring 이 부팅돼요.

```bash
<repo> new gymlog
# 또는 직접: ./tools/new-app/new-app.sh gymlog
```

이 명령은 두 가지 일을 해요 — **코드 골격 만들기** 와 **환경 채우기**. 둘 다 거의 자동이에요.

### 3.1 코드 골격 (자동)

- `apps/app-gymlog/` 모듈 생성 (build.gradle, HealthController, `GymlogApiEndpoints` 경로 카탈로그 포함 — 인증·결제 엔드포인트는 core 공유 컨트롤러가 처리해요)
- `GymlogDataSourceConfig.java` 자동 생성 — 앱 전용 DataSource 를 격리해서 연결해요
- Flyway 마이그레이션 디렉토리 + 인증·결제 공통 테이블 SQL 파일들 (아래 표)
- AutoConfiguration 등록 + `settings.gradle` / `bootstrap/build.gradle` 에 의존성 추가
- 모듈 README 생성

`new app` 이 깔아 주는 공통 마이그레이션은 V001~V025 (V007 제외 24개) 로, 모든 앱이 똑같이 받는 인증·결제·알림·운영 기반이에요.

| 버전 | 내용 | 비고 |
|---|---|---|
| **V001 ~ V006** | 인증 기반 (users · auth_social_identities · auth_refresh_tokens · email/password 토큰 · devices) | 모든 앱 공통 |
| **V007** | admin user 시드 (`V007__seed_admin_user.sql`) | `--seed-admin` 을 붙였을 때만 생성 (opt-in). 비밀번호는 랜덤 생성돼 완료 안내에 1회만 출력돼요 |
| **V008 ~ V012** | 결제·구독·감사 (subscription_plans · subscriptions · payment_webhook_events · subscription_renewals · audit_logs) | |
| **V013 ~ V014** | 2FA(TOTP) 컬럼 · 사용자 알림 채널 toggle | |
| **V015** | auth_phone_verification_codes (휴대폰 점유인증) | **옵트인** — 점유인증을 안 쓰면 이 파일은 삭제 가능 |
| **V016** | auth_email_verification_codes (가입 전 이메일 소유확인 코드) | |
| **V017** | user_activity_days (DAU/MAU 활동 추적) | 운영 콘솔(`/api/admin/*`)의 DAU/MAU·리텐션 지표 원천 |
| **V018 ~ V021** | attachment_file · user_read_history · message_send_history · audit_logs_archive | 첨부파일·열람이력·발송이력·감사 아카이브 |
| **V022 ~ V023** | payment 환불 컬럼 · payment_refunds | |
| **V024 ~ V025** | posts · analytics | |

본인 도메인 테이블은 그다음 빈 번호(현재 **V026**)부터 직접 작성하면 돼요. V001~V025 가 이미 차 있고, V007 은 도메인이 아니라 `--seed-admin` 전용 관리자 시드 자리예요.

### 3.2 환경 채우기 (대부분 자동)

`new app` 이 `.env` 에 다음을 자동으로 추가해요.

- `GYMLOG_DB_URL` / `GYMLOG_DB_USER` / `GYMLOG_DB_PASSWORD` placeholder
- `APP_STORAGE_MINIO_BUCKETS_<N>=gymlog-uploads` (Spring 기동 시 `BucketProvisioner` 가 실제 버킷 생성)
- `APP_CREDENTIALS_GYMLOG_*` 소셜 로그인 placeholder

DB schema 와 role 생성은 **기본 동작**이라 플래그가 필요 없어요. 코드만 만들고 DB 는 건너뛰고 싶을 때만 `--skip-provision-db` 를 붙여요. (예전 문서의 `--provision-db` 는 지금도 받아들여지지만 아무 동작도 하지 않는 no-op 이에요.)

```bash
# 로컬 docker postgres — 별도 설정 없이 바로 동작 (.env.example 의 기본 DB_PSQL_URL 사용)
<repo> new gymlog
```

> **`DB_PSQL_URL` 이 뭔가요?** schema 와 role 을 *생성할 관리자 권한* connection string 이에요. 앱이 실제로 쓰는 `GYMLOG_DB_URL`(앱 전용 role 로 접속)과는 별개로, 더 높은 권한이 필요해요. **로컬 docker 는 손댈 게 없어요** — `.env.example` 에 기본값이 있어 자동으로 처리돼요. **운영 DB(Supabase 등)** 에 provision 할 때만, `.env` 에 저장하지 말고 명령 직전에 shell 에서 export 하세요.
>
> ```bash
> export DB_PSQL_URL='postgresql://postgres:<pw>@<host>:5432/postgres'
> <repo> new gymlog
> ```

운영으로 넘어갈 때 직접 채워야 하는 것도 있어요.

- `GYMLOG_DB_URL` 의 `<host>` 를 실제 운영 DB 주소로 교체
- 소셜 로그인 자격(Google / Apple) 발급 → [`소셜 로그인 설정 가이드`](./social-auth-setup.md)
- 도메인 테이블 작성 (다음 빈 번호부터 — 현재 V026)

### 3.3 앱이 떠야 코드가 반영돼요

이미 떠 있는 Spring 프로세스는 새로 추가한 모듈을 자동으로 감지하지 못해요. `new app` 뒤에는 재기동이 필요해요.

```bash
<repo> restart      # spring 컨테이너만 재빌드 + 재기동 (다른 컨테이너는 유지)
<repo> test         # spring UP 재확인
```

### 3.4 두 번째, 세 번째 앱 — 명령은 똑같아요

`new app` 은 멱등(여러 번 호출해도 안전)하게 설계돼서, 첫 앱이든 열 번째 앱이든 같은 명령으로 추가해요.

```bash
<repo> new foodlog
```

기존 앱(`gymlog`)에 **영향 없이** 자동 처리돼요.

| 항목 | 자동 동작 |
|---|---|
| `apps/app-foodlog/` | 신규 디렉토리 (기존 앱과 무관) |
| `.env` 의 `FOODLOG_DB_*` / `APP_CREDENTIALS_FOODLOG_*` | placeholder append (키 중복 시 skip) |
| `APP_STORAGE_MINIO_BUCKETS_<N>=foodlog-uploads` | 인덱스 자동 증가 |
| `settings.gradle` / `bootstrap/build.gradle` | 중복 체크 후 append |
| Postgres `foodlog` schema + `foodlog_app` role | 기본 생성 (`--skip-provision-db` 시 생략) |
| `FoodlogDataSourceConfig.java` | bean 이름이 slug prefix 로 격리 → 충돌 없음 |

앱 사이의 격리는 빌드 시점에 강제돼요. `foodlog` 에서 실수로 `gymlog` 패키지를 import 하면 [`ArchUnit`](../reference/glossary.md#라이브러리--sdk) 규칙(r2)이 CI 에서 차단하고, Flyway 히스토리와 [`HikariCP`](../reference/glossary.md#데이터베이스) 풀도 앱별로 따로 관리돼요.

### 3.5 앱 모듈 제거

잘못 만들었거나 은퇴시킬 앱은 `new app` 의 역방향인 `remove app` 으로 되돌려요. 한 번의 명령으로 코드와 `.env` 슬러그 라인, DB schema, Firebase 까지 정리해요.

```bash
<repo> remove gymlog      # 1회 confirm ('y')
```

정리 범위는 환경마다 달라요.

| 대상 | 정리되는 것 |
|---|---|
| 코드 (환경 무관) | `apps/app-gymlog/` · `settings.gradle` include · `bootstrap/build.gradle` 의존성 |
| local | `.env` 의 슬러그 라인 · 로컬 docker postgres(5433)의 `gymlog` schema 와 `gymlog_app` role |
| dev | `.env.dev` 의 슬러그 라인 · dev DB 의 schema·role · Firebase **dev** 프로젝트 |
| prod | 아무것도 건드리지 않아요 — `.env.prod` 라인도, 운영 DB 도, Firebase prod 도 그대로 |

코드는 레포에 하나뿐이라 환경과 무관하게 지워지고, local 과 dev 는 한 번에 함께 정리돼요. 두 환경 모두 Flyway 로 언제든 똑같이 재생성되고 실데이터가 없어서, 같이 비워도 안전하거든요.

**Firebase 는 dev 만 자동, prod 는 수동이에요.** dev 프로젝트(`<org>-gymlog-dev`)는 `gcloud` 가 설치돼 있으면 confirm 을 한 번 받고 삭제해요. 곧바로 영영 사라지는 게 아니라 30일간 복구할 수 있는 soft-delete 라 되돌릴 여지도 있어요. 반면 prod 프로젝트는 자동으로 지우지 않고 Console 링크만 안내해요. 실제 사용자 기기의 푸시 토큰이 그 프로젝트에 묶여 있어서, 한 번 지우면 알림이 끊기기 때문이에요.

**운영(`prod`)은 명령 자체가 막혀 있어요.** `<repo> prod remove` 를 부르면 실행을 거부해요.

```
❌ prod 앱 제거(remove app)는 미지원 — 실데이터 + 공유 소스 보호.
```

두 가지를 지키려는 안전장치예요.

- **실데이터** — 운영 DB 에는 진짜 사용자 데이터가 있어요. `remove` 의 `DROP SCHEMA ... CASCADE` 를 운영에 그대로 적용하면 되돌릴 수 없어요.
- **재배포 가능성** — 코드 모듈을 먼저 지우면 그 코드로 다시 빌드·롤백·재배포하는 길이 막혀요. 운영 중인 앱은 코드를 "삭제" 하는 게 아니라 "내려놓는(undeploy)" 게 안전해요.

그래서 운영 앱은 데이터 정리와 코드 제거를 나눠 단계적으로 은퇴시켜요.

1. 데이터 백업
2. `<repo> prod force-clear gymlog` — 운영 데이터·인프라(schema · 버킷 · 컨테이너) 정리
3. undeploy 확인
4. `<repo> remove gymlog` — 그제서야 코드 모듈 제거 (local·dev 에서)

데이터는 `force-clear` 가, 코드는 `remove app` 이 맡는 이 분리가 핵심이에요. 더 자세히는 [`CLI 가이드 §9`](./cli-guide.md) 와 [`App Scaffolding`](./app-scaffolding.md) 을 참고하세요.

---

## 4. 환경 변수 (.env) 자세히

[§2.4](#24-repo-init--로컬-환경-셋업) 에서 봤듯 `<repo> init` 이 `.env.example` 을 복사해 `.env` 를 **자동으로 만들어 줘요**. 직접 `cp` 할 필요가 없어요. 이 절은 그 `.env` 를 손봐야 할 때를 위한 참고예요.

**로컬 개발은 사실 `.env` 를 거의 건드릴 필요가 없어요.** `application-local.yml` 이 `JWT_SECRET` 등 필수 값의 fallback 을 내장하고 있어, `.env` 가 기본값 그대로여도 기동돼요. 각 변수의 의미는 `.env` 파일 자체의 주석에 잘 정리돼 있으니, 여기서는 운영이나 커스텀 시 알아 둘 핵심만 짚을게요.

### 4.1 JWT 서명 비밀키 (운영 시)

운영을 띄우거나 본인만의 비밀키를 쓰고 싶을 때 `JWT_SECRET` 을 채워요. 아래 명령으로 만든 64자 hex 문자열을 그대로 붙여넣으면 돼요.

```bash
openssl rand -hex 32   # 64자 hex 출력
```

출력값을 복사해 `.env` 에 `JWT_SECRET=<붙여넣기>` 형태로 저장하세요. (흔히 빠지는 함정은 [§6.6](#66-jwt_secret-가-32자-미만이라고-나와요) 에 모아 뒀어요.)

### 4.2 오브젝트 스토리지 (MinIO)

로컬 docker MinIO 는 `.env.example` 의 기본값으로 바로 동작해요. 핵심만 정리하면 이래요.

- `APP_STORAGE_MINIO_ENDPOINT` 를 비우면 `InMemoryStorageAdapter` 로 fallback 해요. 업로드가 메모리에만 저장되고 재시작하면 사라지는 동작이라, 빠른 실험에는 충분해요.
- 버킷은 `mc mb` 같은 수동 명령이 필요 없어요. `APP_STORAGE_MINIO_BUCKETS_*` 에 이름만 적어 두면 Spring 부팅 시 `BucketProvisioner` 가 자동으로 만들고, 멱등이라 재기동해도 중복 에러가 없어요.
- 템플릿 관리자의 NAS MinIO 는 LAN 전용이라 파생 레포에서는 못 써요. 본인 NAS / S3 호환 서비스 / 로컬 docker 중에서 고르세요.

### 4.3 운영 DB provider 는 배포 시점에만 고르면 돼요

**로컬은 Supabase 가 필요 없어요** — docker postgres 로 자급자족돼요. 아래는 운영 배포 때 결정할 내용이에요. `new app` 의 DB provisioning(기본 동작)은 어떤 provider 든 표준 `psql` 을 호출하므로, 결정할 건 관리자용 `DB_PSQL_URL` 한 줄과 앱 런타임용 `DB_URL` / `DB_USER` / `DB_PASSWORD` 예요.

| Provider | 특징 |
|---|---|
| **Supabase** (관리자 default) | 관리형, Free tier 충분, Seoul region, Supavisor pooler 제공 |
| **AWS RDS** | 엔터프라이즈 안정성, VPC 통합 |
| **Fly.io Postgres** | 앱 근접 배포, 글로벌 edge |
| **자체 호스트 Postgres** | 완전 통제, 비용 0 |

Supabase 를 쓴다면 운영 부하에서는 pooler(`:6543`)가 사실상 필수예요. blue/green 배포가 겹치는 구간의 connection 폭증을 안전하게 흡수하고, Free tier 의 direct(`:5432`) 연결 한도가 낮기 때문이에요. RDS / Fly.io / 자체 호스트라면 인스턴스의 `max_connections` 와 [`HikariCP`](../reference/glossary.md#데이터베이스) pool size 합이 맞는지 확인하세요. 앱이 늘면 `앱 수 × pool × blue/green(2)` 로 빠르게 증가해요.

---

## 5. 공동 작업자 (두 번째 노트북)

첫 작업자가 [§2](#2-레포-만들기--첫-기동) 를 끝낸 뒤에는(rename + 첫 앱 + `.env.prod` 완료), 다른 노트북이나 합류하는 동료는 훨씬 짧게 시작할 수 있어요. fresh clone 후 아래 두 줄이면 끝이에요.

```bash
git clone git@github.com:<org>/<repo>.git
cd <repo>
./factory install        # symlink 등록 (머신마다 1회)
<repo> init              # 이미 셋업된 레포로 자동 감지 (rename/README skip)
```

`<repo> init` 은 settings.gradle rename 이 끝났고 `PROJECT_README_TEMPLATE.md` 가 없으면 — 즉 **이미 셋업된 레포면** — rename 과 README 교체(첫 작업자가 이미 한 일)를 자동으로 건너뛰고, `.env` 생성 + 로컬 docker 기동 + 검증 + symlink 만 진행해요. 이 판단은 레포에 커밋된 상태(rename·README)만 보고, `.env.prod` 같은 머신마다 다른 파일은 보지 않아요. 그래서 운영을 아직 안 띄운 솔로 작업자나 두 번째 노트북이나 똑같이 매끄럽게 동작해요.

핵심은 **두 번째 노트북은 외부 DB 자격이 전혀 필요 없다** 는 점이에요. 로컬 docker postgres 만 쓰고, 앱 schema 는 `<repo> new <slug>` 가 결정적 Flyway 마이그레이션(V001~V025)으로 동일하게 재생성해요. `.env` 는 `.gitignore` 라 머신마다 각자 생성되니 자격 충돌도 없어요.

> `.env.prod` 는 커밋되지 않으므로(secret 보호) 두 번째 노트북엔 없어요. 로컬 개발엔 불필요하고, 운영 변경(`prod init` / Secrets 갱신)은 **첫 작업자(운영자) 한 명** 이 맡는 걸 권장해요. 만약 두 번째 개발자가 `prod init` 을 돌려도, `.env.prod` 가 없는 머신에서는 운영 secret 을 GitHub 에 push 하는 단계가 자동으로 건너뛰어져 운영자의 secret 을 덮어쓰지 않아요. 바로 이 `.env.prod` 유무가 운영 secret push 의 안전장치예요(로컬 셋업 모드 판별과는 별개).

---

## 6. 흔한 에러

### 6.1 기동 시 프로파일이 안 잡혀요

증상 — `app.jwt.secret must be at least 32 characters` 에러와 함께, 직전 로그에 `No active profile set, falling back to ... "default"` 가 보여요.

원인 — Spring Boot 는 `.env` 를 **자동으로 읽지 않아요**. `.env` 의 `SPRING_PROFILES_ACTIVE=local` 가 전달되지 않아 `application-local.yml` 이 로드되지 않은 거예요.

해결 — bootRun 전에 `.env` 를 shell 에 export 하세요. (`<repo> init` / `<repo> start` 로 띄우면 이 과정이 자동이에요.)

```bash
set -a; source .env; set +a
./gradlew :bootstrap:bootRun
# 또는 한 줄로:
SPRING_PROFILES_ACTIVE=local ./gradlew :bootstrap:bootRun
```

### 6.2 DB 연결 실패 — `Connection refused localhost:5433`

원인 — Postgres 컨테이너가 안 떠 있어요.

```bash
docker ps | grep postgres
# 없으면:
docker compose -f infra/docker-compose.local.yml up -d postgres
```

### 6.3 Docker daemon not running

증상 — `Cannot connect to the Docker daemon ...` (OS 별 소켓 경로가 달라요).

해결 — Docker 를 먼저 실행하세요.

- **macOS**: Docker Desktop(또는 OrbStack) 앱 실행 (`open -a Docker` 로도 가능)
- **Linux**: `sudo systemctl start docker`
- daemon 준비 대기: `until docker info >/dev/null 2>&1; do sleep 2; done`

### 6.4 MinIO 접속 불가

원인 — `.env` 의 `APP_STORAGE_MINIO_ENDPOINT` 가 템플릿 관리자의 LAN 주소(예: `192.168.x.x`)라 본인 네트워크에서 닿지 않아요.

해결 — 셋 중 하나를 고르세요.

1. **로컬 docker MinIO** 사용 — `docker compose -f infra/docker-compose.local.yml up -d minio` 후 `APP_STORAGE_MINIO_ENDPOINT=http://localhost:9000`
2. **본인 NAS / 클라우드 S3** 엔드포인트로 교체
3. **InMemory fallback** — `APP_STORAGE_MINIO_ENDPOINT` 라인을 주석 처리 (메모리 기반 fake 동작)

### 6.5 Flyway checksum mismatch

증상 — `Migration checksum mismatch for migration version V00x`.

원인 — 이미 적용된 마이그레이션 파일이 나중에 수정돼 해시가 바뀌었어요.

해결 (**로컬에서만**) — DB 를 초기화하고 다시 기동해요. 운영에서는 절대 이 방법을 쓰면 안 되고, `flyway repair` 또는 새 마이그레이션 번호로 해결하세요.

```bash
docker compose -f infra/docker-compose.local.yml down -v
docker compose -f infra/docker-compose.local.yml up -d postgres
./gradlew :bootstrap:bootRun
```

### 6.6 `JWT_SECRET` 가 32자 미만이라고 나와요

증상 — `app.jwt.secret must be at least 32 characters (256 bits) for HS256`.

가장 흔한 함정 — `.env` 는 shell 치환을 **하지 않아요**. `JWT_SECRET=$(openssl rand -hex 32)` 를 그대로 적으면 이 문자열이 리터럴(17자)로 저장돼 검증에 실패해요.

해결 — 명령을 먼저 실행해 출력값을 받은 뒤, 그 값을 붙여넣으세요.

```bash
openssl rand -hex 32   # 64자 출력 → 이 값을 복사
# .env 에:  JWT_SECRET=<복사한 64자>
```

(직전 로그에 `falling back to "default"` 가 보였다면 값이 아니라 프로파일 문제예요 — [§6.1](#61-기동-시-프로파일이-안-잡혀요) 을 보세요.)

### 6.7 `bootRun` 종료가 느려요 (Ctrl+C 후 ~30초)

원인 — `application.yml` 의 `server.shutdown: graceful` 설정 때문이에요. 진행 중인 요청을 안전하게 마무리하려고 대기하는 정상 동작이에요.

해결 — 급하면 Ctrl+C 두 번 또는 `kill -9 <pid>`. 처리 중인 요청이 없으면 즉시 종료돼요.

---

## 7. 아직 미구현 / Stub 상태인 기능

이 표는 *진짜 미구현 또는 stub fallback* 만 정리해요. 운영 배포와 앱 프로비저닝은 이미 완전히 구현돼 있어요.

| 영역 | 상태 | 동작 |
|---|---|---|
| 이메일/비밀번호 가입·로그인 | ✅ 완전 동작 | — |
| Apple / Google 소셜 로그인 | ✅ 완전 동작 (credential 설정 시) | `.env` 에 `APP_CREDENTIALS_<SLUG>_*` 필요 |
| JWT 발급/회전 | ✅ 완전 동작 | — |
| Kamal 배포 파이프라인 | ✅ 완전 동작 | `prod deploy` / `prod init` 등 ([`CLI 가이드`](./cli-guide.md)) |
| 앱 프로비저닝 (`new app`) | ✅ 완전 동작 | 기본 동작으로 schema + role 자동 생성 (`--skip-provision-db` 로 끔) |
| 앱 제거 (`remove app`) | ✅ 완전 동작 (prod 미지원) | `new app` 역방향 |
| 이메일 발송 (Resend) | dev 선택 / prod 필수 | 키 없으면 `LoggingEmailAdapter` 로 콘솔 출력. prod 는 키 누락 시 부팅 실패. [`email-verification.md`](../api-and-functional/functional/email-verification.md) |
| 오브젝트 스토리지 | ⚠️ endpoint 필요 | 미설정 시 `InMemoryStorageAdapter` fallback |
| 결제 (PortOne PG) | ⚠️ key 필요 | 미설정 시 `StubPaymentAdapter` 가 graceful 503 (`PAY_008`) |
| 인앱 결제 (IAP) | ⚠️ key 필요 | 미설정 시 `StubIapAdapter` 가 graceful 503 |
| 푸시 알림 | 🚧 NoOp | `NoOpPushAdapter` 가 로그만 남겨요. FCM 설정 시 `FcmPushAdapter` 활성 |

---

## 8. 그 다음 읽을 것

| 목적 | 문서 |
|---|---|
| 코드 아키텍처 (포트/어댑터, 모듈 의존) | [`Architecture Reference`](../structure/architecture.md) |
| 명령어 전체 매트릭스 | [`CLI 가이드`](./cli-guide.md) |
| 인프라 구성 (DB/스토리지/관측성 전체 상태) | [`인프라 (Infrastructure)`](../production/deploy/infrastructure.md) |
| 설계 철학 (39개 ADR) | [`Repository Philosophy — 책 안내`](../philosophy/README.md) |
| 코딩 규약 (naming, DTO, exception 등) | [`코딩 규약`](../convention/README.md) |
| 테스트 전략 (4층 구조) | [`Testing Strategy`](../production/test/testing-strategy.md) |
| 인프라 결정 근거 (Supabase/NAS/맥미니 등) | [`인프라 결정 기록`](../production/deploy/decisions-infra.md) |
| 미완료 / 향후 작업 목록 | [`Backlog`](../planned/backlog.md) |
| 장애 시나리오 분석 | [`Edge Cases & Risk Analysis`](../reference/edge-cases.md) |
| 도그푸딩 시간 순 walkthrough | [`도그푸딩 walkthrough`](./dogfood-walkthrough.md) |
| 문서 작성 규칙 (저자용) | [`Documentation Style Guide`](../reference/STYLE_GUIDE.md) |

---

## 도움 요청 체크리스트

문제가 생기면 이슈를 만들기 전에 이 항목들을 먼저 확인하세요.

- [ ] [§1](#1-도구-설치) 의 도구 버전이 맞나요? (`./factory doctor` 한 번이면 한눈에 확인돼요)
- [ ] `.env` 가 존재하고 `JWT_SECRET` 이 32자 이상인가요?
- [ ] `docker ps` 로 postgres 컨테이너가 `Up` 상태인가요?
- [ ] [§6 흔한 에러](#6-흔한-에러) 에 해당하나요?
- [ ] `./gradlew clean build` 가 성공하나요?

그래도 안 풀리면 로그 전체 + `.env`(비밀번호는 가려서) + `docker ps` 출력을 첨부해 이슈를 올리세요.

---

## 📖 책 목차 — Journey 2~3단계

이 문서는 [`📚 template-spring — 책 목차 (Developer Journey)`](../onboarding/README.md) 의 **2단계 (어떻게 써? 로컬 개발)** 와 **3단계 (클론 후 뭐부터? 첫 앱 모듈 추가)** 에 해당해요.

| 방향 | 문서 | 한 줄 |
|---|---|---|
| ← 이전 | [`Architecture Reference`](../structure/architecture.md) | 1단계 — 모듈 구조 한눈에 |
| → 다음 | [`소셜 로그인 설정 가이드`](./social-auth-setup.md) | 4단계 — 외부 자격 증명 발급 (Google/Apple) |

**막혔을 때**: [§6 흔한 에러](#6-흔한-에러) · [`도그푸딩 함정`](./dogfood-pitfalls.md) · [`FAQ`](./dogfood-faq.md) · [`도그푸딩 walkthrough`](./dogfood-walkthrough.md)
**왜 이렇게?**: [`Repository Philosophy`](../philosophy/README.md) (39개 ADR) · [`인프라 결정 기록`](../production/deploy/decisions-infra.md)
