# 도그푸딩 환경 셋업 가이드

> **유형**: How-to · **독자**: Level 1 · **읽는 시간**: ~12분

**설계 근거**: [`ADR-002 · Use this template`](../philosophy/adr-002-use-this-template.md)

별도 파생 저장소를 시험 환경에 배포해 설정·기동·검증·정리를 확인하는 가이드예요. 원본 `template-spring`은 공통 코드 유지보수용이며 원격 배포 명령의 가드 대상이에요. 최초 배포 전에 외부 자격과 연결을 검증해요. 오류를 찾을 때는 [함정 모음](./dogfood-pitfalls.md)을, 당시 작업 흐름을 확인할 때는 [시간순 기록](./dogfood-walkthrough.md)을 참고하세요.

함께 읽으면 좋은 문서예요.

- 결정 근거: [`인프라 결정 기록 — I-09 ~ I-14`](../production/deploy/decisions-infra.md)
- 전체 플로우: [`CI/CD 전체 플로우`](../production/deploy/ci-cd-flow.md) — commit 부터 운영 반영까지
- 자주 묻는 질문: [`도그푸딩 FAQ`](dogfood-setup.md)

---

## 1. 개요

### 무엇을 하나요

파생 저장소에는 자동화 코드가 복사되지만 GitHub Secrets·Variables, SSH 접근, 이미지 저장소 권한 같은 외부 설정은 따라오지 않아요. 아래 준비와 검증을 별도로 진행해요.

- 외부 리소스 발급 — GitHub PAT, Tailscale OAuth, Mac mini SSH 키, Supabase 연결 정보를 준비해요 (§3).
- `infra init` — 계정/호스트에 속하는 공유 자격을 `.env.infra` 에 모아 한 벌만 올려요 (§3.7).
- `init-prod.sh` 1·2회차 — `.env.prod` 를 자동 생성하고, 채운 뒤 다시 돌려서 GitHub Secrets·Variables 를 push 해요 (§4 ~ §6).
- 검증 — `verify-server.sh` 7단계로 운영 인프라를 확인하고, 로컬에서 Spring 이 UP 까지 뜨는지 확인해요 (§7 ~ §8).

로컬 docker 환경(`.env` · Postgres · MinIO)이 아직 없다면 [`onboarding §2.4`](./onboarding.md#24-repo-init--로컬-환경-셋업) 의 `<repo> init` 으로 먼저 만들고 오세요. 이 문서는 운영(`prod`) 셋업에 집중해요.

### 누가 읽나요

- "Use this template" 으로 만든 새 파생 레포의 첫 작업자
- 기존 파생 레포 셋업의 일부를 다시 검증하려는 사람

이미 셋업된 레포를 새로 clone 받은 두 번째 이상의 작업자는 더 짧은 흐름을 따라요. 아래 [§1.5](#15-공동-작업자-모드-fresh-clone) 를 보세요.

### 시간 비용

설정에 걸리는 시간은 외부 자격 보유 여부, 호스트 접근, 승인과 배포 결과에 따라 달라요. 외부 자격 발급과 공유 인프라 설정을 먼저 마치고 환경 설정·검증으로 진행해요.

### 1.5 공동 작업자 모드 (fresh clone)

이미 초기 설정을 마친 파생 저장소를 새로 복제했다면 운영 자격을 다시 등록할 필요가 없어요.

```bash
git clone <derived-repo>.git
cd <derived-repo>
./factory install
<repo> init
```

`<repo> init`은 로컬 설정만 실행하고, `<repo> all init`은 로컬과 운영 설정을 순서대로 실행해요. `init-local.sh`는 `settings.gradle`의 템플릿 이름이 바뀌었고 `PROJECT_README_TEMPLATE.md`가 없으면 이름 변경과 README 교체를 건너뛰어요. `init-prod.sh`는 여기에 `.env.prod`가 없는 조건까지 맞아야 공동 작업자로 판단해 운영 설정·Secrets 등록·운영 검증을 건너뛰어요. 이 경우 `.env.infra`와 `infra init`도 필요하지 않아요.

로컬 환경만 간단히 준비하려면 `.env`가 없을 때 `.env.example`을 복사하고 `<repo> local start` 뒤 `./gradlew :bootstrap:bootRun`을 실행할 수 있어요.

최초 설정 절차를 의도적으로 다시 수행하려면 해당 명령에 `--reinit`을 붙여요. 다시 등록할 환경과 자격을 먼저 확인하세요. 로컬 설정 명령에 이 옵션을 붙였다고 운영 설정까지 실행되는 것은 아니에요.

원본 템플릿을 시험용 저장소처럼 이름만 바꿔 배포하지 않아요. 파생 저장소에서 시험하고, 원본의 공통 코드 변경은 원본 유지보수 절차로 검증해요. 기존 작업 전체를 `git restore .`로 되돌리는 방식도 이 절차에 포함하지 않아요.

---

## 2. 사전 준비물

| 항목 | 어디서 | 자세히 |
|---|---|---|
| GitHub 레포 | "Use this template" 으로 만든 파생 레포 | §3.1 의 PAT 도 함께 준비 |
| Mac mini SSH 접근 | macOS 운영 호스트 | §3.3 |
| Tailscale 계정 + ACL admin | login.tailscale.com | §3.2 |
| Supabase 프로젝트 (Seoul region 권장) | supabase.com | §3.5 |
| 도메인 + Cloudflare 계정 | 기본 `infra init` 자동화에서 필수 | 요청만 사설망으로 시험하는 방법은 §3.6·§8 참고 |

위 다섯 중 GitHub PAT · SSH · Tailscale · 도메인/Cloudflare 네 가지는 **환경이 아니라 계정/호스트에 속하는 자산**이라 `.env.infra` 가 소유해요 (§3.7). Supabase 연결 정보만 환경별로 달라 `.env.prod` · `.env.dev` 가 각자 가져요.

도구(JDK 21~25 · Docker · Node · `gh` CLI 등)가 다 깔려 있는지는 [`onboarding §1`](./onboarding.md#1-도구-설치) 의 `./factory doctor` 로 한 번에 확인할 수 있어요.

---

<a id="other-hosts"></a>
### 다른 배포 호스트를 사용할 때

현재 자동화는 Mac mini·ARM64 이미지·Tailscale 접근을 기준으로 구성돼 있어요. 다른 호스트를 사용하려면 `DEPLOY_HOST`·`DEPLOY_SSH_USER`, Docker와 배포 프록시 실행 조건을 확인해요. x86 호스트는 이미지 빌드 플랫폼도 맞춰야 해요. Tailscale을 사용하지 않으면 GitHub Actions runner가 호스트에 도달하는 별도 경로와 해당 워크플로 변경이 필요해요. 기존 인프라 결정과 다른 구성이므로 관련 ADR과 배포 검증을 함께 검토해요.

---

## 3. 외부 리소스 발급

여기서 발급한 값 중 GitHub PAT · Tailscale OAuth · SSH 키 · Cloudflare 토큰은 §3.7 의 `.env.infra` 에, Supabase 연결 정보는 §5 의 `.env.prod` 에 채워 넣어요.

이 절은 도그푸딩에 꼭 필요한 다섯 가지(PAT · Tailscale · SSH · workflow 권한 · Supabase)만 다뤄요. 운영에서 쓰는 나머지 키(Cloudflare · Resend · MinIO · PortOne · IAP · Loki · Discord)의 발급 목적·절차·채울 위치를 한곳에서 보려면 [`운영 키 발급 통합 가이드`](../production/setup/key-issuance.md) 를 참고하세요. 이 §3 은 그 통합 가이드에서 도그푸딩 핵심 다섯 항목만 발췌한 거예요.

### 3.1 GitHub PAT (Personal Access Token Classic)

현재 배포 워크플로는 `GHCR_TOKEN`으로 이미지 저장소에 인증해요. 도그푸딩에서 발생했던 403과 PAT 우회는 [GHCR 사례](./dogfood-pitfalls.md#ghcr-auth)에 기록돼 있어요. 당시 실패를 모든 GitHub 저장소에서 `GITHUB_TOKEN`을 사용할 수 없다는 일반 제한으로 해석하지 않아요.

발급 절차예요.

1. [github.com/settings/tokens](https://github.com/settings/tokens) → "Generate new token" → "Generate new token (classic)"
2. Note 에 `dogfood-template-spring` 처럼 알아볼 이름을 적어요.
3. Expiration 은 90일(또는 본인 정책)으로 둬요.
4. 이미지 업로드에는 `write:packages`를 선택해요. 다운로드 권한은 `read:packages`, 패키지 삭제까지 할 때는 `delete:packages`도 확인해요. 발급 화면에서 `repo`가 함께 선택될 수 있지만, 패키지 업로드 자체의 필수 의존 권한은 아니에요. 같은 토큰으로 비공개 저장소 작업도 수행할 때 해당 저장소 권한을 별도로 판단해요.
5. "Generate token" → 즉시 복사해요 (한 번만 보여요). 이 값을 `.env.infra` 의 `GHCR_TOKEN` 에 넣어요.

### 3.2 Tailscale OAuth client

[GitHub Actions](../reference/glossary.md#ci--배포-파이프라인) runner(GitHub 의 ubuntu VM)가 Mac mini 의 [Tailscale](../reference/glossary.md#운영--인프라) 사설 IP(`100.x.x.x`)에 도달하려면, 매 배포마다 일회성 ephemeral device 로 tailnet 에 합류해야 해요. 그 자격이 OAuth client 예요.

**3.2.1 ACL 의 `tagOwners` 정의 먼저 (한 번만)**

[login.tailscale.com/admin/acls/file](https://login.tailscale.com/admin/acls/file) 의 HuJSON 편집기에서 `tagOwners` 를 추가하세요 (없으면 새 섹션으로).

```hujson
"tagOwners": {
    "tag:ci": ["autogroup:admin"],
},
```

Save 를 누르세요. 이 단계를 건너뛰면 다음 OAuth 발급 화면의 "Add tags" 드롭다운이 비활성화돼서 `tag:ci` 를 부여할 수 없어요.

**3.2.2 OAuth client 발급**

[login.tailscale.com/admin/settings/oauth](https://login.tailscale.com/admin/settings/oauth) → "Generate OAuth client" 로 들어가요.

- Custom scopes 를 선택하고, 다음 두 scope 를 모두 체크해요. 둘 중 하나라도 빠지면 배포 시 403 이 나요 ([`pitfalls #4`](./dogfood-pitfalls.md)).
  - Devices → Core → **Write** + Tags 에 `tag:ci` 추가
  - Keys → Auth Keys → **Write** + Tags 에 `tag:ci` 추가
- 다른 scope(Posture, Routes, OAuth Keys 등)는 모두 체크 해제해요.
- "Generate credential" 을 눌러요.
- Client ID 와 Secret 을 즉시 복사해 `.env.infra` 의 `TS_OAUTH_CLIENT_ID` 와 `TS_OAUTH_SECRET` 에 넣어요.

### 3.3 Mac mini SSH 키 준비

GitHub Actions 가 Mac mini 로 SSH 할 때 쓸 private key 가 필요해요. `.env.infra` 의 `SSH_PRIVATE_KEY` 에 private key 의 전체 내용(`-----BEGIN OPENSSH PRIVATE KEY-----` 부터 `-----END OPENSSH PRIVATE KEY-----` 까지)을 그대로 넣어요.

**옵션 A — 이미 키가 있다면 (권장)**

```bash
ssh -i ~/.ssh/macmini storkspear@100.X.X.X 'echo connected'
```

이 명령이 성공하면 그 키를 그대로 써요. `.env.infra` 에는 `SSH_PRIVATE_KEY=$(cat ~/.ssh/macmini)` 의 출력처럼 키 내용을 다중행 값으로 넣되, **큰따옴표로 감싸고 값과 같은 줄에 주석을 달지 않아요**. 셸은 같은 줄 주석을 빈 값으로 읽지만 init 의 값 추출은 주석 문자열까지 값으로 읽어, 잘린 키가 그대로 GitHub 에 올라가요.

**옵션 B — 키가 없다면**

1. 새 키를 만들어요 (passphrase 는 빈칸).
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/macmini -C "macmini-deploy@$(hostname)" -N ""
   ```
2. 공개키(`~/.ssh/macmini.pub` 내용)를 Mac mini 에 직접 등록해요. 화면 공유나 모니터로 Mac mini 터미널을 열고 실행하세요.
   ```bash
   mkdir -p ~/.ssh && chmod 700 ~/.ssh
   echo 'ssh-ed25519 AAAA... macmini-deploy@laptop' >> ~/.ssh/authorized_keys
   chmod 600 ~/.ssh/authorized_keys
   ```
3. 로컬에서 옵션 A 의 명령으로 SSH 가 되는지 확인해요.

> 공개키는 한 줄로 복사하세요. 키 중간에 줄바꿈이 끼면 인식되지 않아요.

<a id="34-레포-workflow-권한-write"></a>

<a id="34-레포-workflow-권한--write"></a>
### 3.4 워크플로 토큰 권한 확인

현재 이미지 push는 `GHCR_TOKEN`을 사용하므로 PAT의 scope와 대상 패키지 권한을 확인해요. 아래 명령은 trial `setup.sh`가 설정하는 `GITHUB_TOKEN`의 기본 권한을 보여줘요. PAT 권한을 바꾸는 명령은 아니에요.

```bash
gh api -X PUT "repos/<owner>/<repo>/actions/permissions/workflow" \
  -f default_workflow_permissions=write \
  -F can_approve_pull_request_reviews=false
```

또는 GitHub 레포 → Settings → Actions → General → "Workflow permissions" → "Read and write permissions" 선택 → Save.

`GITHUB_TOKEN`으로 GHCR에 업로드하는 워크플로라면 해당 job의 `permissions: packages: write`와 패키지 접근 권한을 확인해요. 저장소 전체의 기본 권한을 write로 바꾸는 것은 필수 조건이 아니에요. 당시 권한 문제는 [GHCR 사례](./dogfood-pitfalls.md#ghcr-auth)에 따로 기록했어요.

### 3.5 Supabase 연결 정보

지속 실행하는 Spring 서버는 직접 연결이나 session pooler의 5432 연결을 기준으로 설정해요. 직접 연결의 네트워크 조건이 맞지 않으면 session pooler를 검토해요. transaction pooler 6543은 별도 호환성 판단이 필요한 옵션이며, Flyway는 runtime 연결과 분리된 session/direct 연결을 사용해요. 접속 정보는 Supabase의 현재 프로젝트 연결 화면에서 확인해요.

복사한 문자열은 이런 모양이에요.

```
postgresql://postgres.sebqrqi...:[YOUR-PASSWORD]@aws-1-<region>.pooler.supabase.com:5432/postgres
```

이 문자열을 그대로 쓰면 안 돼요. JDBC 형식이 아니거든요 ([`pitfalls #11`](./dogfood-pitfalls.md)). 다음처럼 세 변수로 분리해서 `.env.prod` 에 넣어요.

```bash
DB_URL=jdbc:postgresql://aws-1-<region>.pooler.supabase.com:5432/postgres
DB_USER=postgres.sebqrqi...
DB_PASSWORD=<your-actual-password>
```

핵심은 세 가지예요.

- `jdbc:` prefix 가 필수예요.
- user 와 password 는 URL 안에 inline 하지 말고 별도 변수로 분리해요.
- `init-prod.sh` 가 `DB_URL` 의 시작 부분을 검증해서, 형식이 틀리면 즉시 멈춰요.

> `DB_PASSWORD` 는 `init-prod.sh` 가 자동 발급하지 않아요. 외부 DB 가 발급한 비밀번호를 그대로 쓰는 설계라, Supabase 의 실제 비밀번호로 채우는 걸 잊지 마세요.

<a id="슬러그별-datasource--slug_db_url-은-비워두세요"></a>

#### 슬러그별 DataSource — `<SLUG>_DB_URL` 은 비워두세요

`<repo> new <slug>`로 앱을 추가하면 슬러그별 DataSource가 등록돼요. 앱별 접속값이 비어 있으면 공통 접속 기본값인 `DB_URL`·`DB_USER`·`DB_PASSWORD`를 사용해요. `AbstractAppDataSourceConfig`는 URL의 `currentSchema`를 앱의 스키마 이름으로 바꿔요. 여기서 공통 접속값은 `core` 스키마를 뜻하지 않아요.

```bash
# .env.prod 의 슬러그별 자격은 비워둬요 — 자동 derive 됩니다
GYMLOG_DB_URL=
GYMLOG_DB_USER=
GYMLOG_DB_PASSWORD=
```

앱별 DB role을 사용하려면 해당 슬러그의 접속값을 채워요. 명시한 값이 공통 기본값보다 우선하며, DB role에 부여한 스키마 권한도 함께 적용돼요.

코드는 `common/common-persistence/src/main/java/com/factory/common/persistence/AbstractAppDataSourceConfig.java` 의 `deriveSlugUrl` 이에요. 설계 근거는 [`ADR-018 · SchemaRoutingDataSource`](../philosophy/adr-018-schema-routing-datasource.md) 에 있어요.

<a id="36-cloudflare-tunnel--외부-도메인-접근-선택"></a>

### 3.6 Cloudflare Tunnel — 외부 도메인 접근 (선택)

HTTP 요청만 시험할 때는 Tailscale IP와 Host 헤더로 배포 프록시에 접근할 수 있어요. 다만 이 문서의 기본 `infra init` 절차는 `BASE_DOMAIN`과 `CLOUDFLARE_API_TOKEN`을 필수로 검사해요. Cloudflare 없이 요청을 보내는 방법과 기본 자동화를 그대로 실행할 수 있는 조건은 구분해요.

도메인은 두 파일로 나뉘어요. 계정 전체가 공유하는 `BASE_DOMAIN` 은 `.env.infra` 가, 환경별로 다른 `SUBDOMAIN` 은 `.env.prod`(`server`) 와 `.env.dev`(`dev-server`) 가 각자 가져요. 둘이 합쳐져 `APP_DOMAIN` 과 `PUBLIC_HOSTNAME` 이 자동 합성돼요. cloudflared 를 깔지 않더라도 `PUBLIC_HOSTNAME` 은 kamal-proxy 의 host-based routing 에 쓰이니 placeholder 라도 채워져 있어야 해요.

`.env.infra` 의 `CLOUDFLARE_API_TOKEN` 까지 채우면 `infra init` 이 Zone·Account·Tunnel ID 를 자동 추출하고, 이후 `prod init`·`dev init` 이 각자의 DNS CNAME 과 Tunnel ingress 를 등록해줘요. 토큰 발급은 [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) 에서 하고, 권한은 Zone DNS Edit + Account Cloudflare Tunnel Edit 이 필요해요.

<a id="37-infra-init--공유-자격-한-벌-등록"></a>

### 3.7 `infra init` — 공유 자격 한 벌 등록

§3.1 ~ §3.3 · §3.6 에서 받은 값은 dev 의 것도 prod 의 것도 아니에요. Mac mini 한 대, Cloudflare 계정 하나, GitHub 계정 하나, tailnet 하나를 두 환경이 함께 쓰거든요. 그래서 `.env.infra` 가 소유하고 `infra init` 이 단독으로 GitHub 에 올려요. 이 분리 덕에 dev 와 prod 는 서로를 선행 조건으로 요구하지 않아요 — dev 만 쓰는 레포도, prod 만 쓰는 레포도 완결돼요.

```bash
<repo> infra init          # 1회차 — .env.infra 생성 후 안내하고 종료
$EDITOR .env.infra         # [REQUIRED] 채우기
<repo> infra init          # 2회차 — 추출 + push + 관측 스택
```

| 키 | 값 출처 | 그룹 |
|---|---|---|
| `BASE_DOMAIN` | 본인 도메인 (예: `example.com`) | REQUIRED |
| `CLOUDFLARE_API_TOKEN` | §3.6 의 Cloudflare 토큰 | REQUIRED |
| `DEPLOY_HOST` | Mac mini Tailscale IP (`100.X.X.X`) | REQUIRED |
| `DEPLOY_SSH_USER` | Mac mini 계정 (예: `storkspear`). `root` 는 macOS SSH 비활성이라 실패해요 ([`pitfalls #8`](./dogfood-pitfalls.md)) | REQUIRED |
| `SSH_PRIVATE_KEY` | §3.3 의 Mac mini private key 전체 내용 | REQUIRED |
| `GHCR_TOKEN` | §3.1 의 GitHub PAT | REQUIRED |
| `TS_OAUTH_CLIENT_ID` · `TS_OAUTH_SECRET` | §3.2 의 Tailscale OAuth. 비워도 `DEPLOY_ENABLED`가 자동으로 꺼지지는 않아요. 자동 배포를 켜면 Tailscale 인증 단계가 실패할 수 있으므로 runner 접근 경로를 먼저 준비해요. 로컬 배포도 실행 머신에서 호스트로 연결할 수 있어야 해요 | OPTIONAL |
| `CLOUDFLARE_ZONE_ID` · `ACCOUNT_ID` · `TUNNEL_ID` | 2회차가 TOKEN 으로 자동 추출 | AUTO |

2회차가 하는 일이에요.

1. `[REQUIRED]` 검증 + Cloudflare ID 3종 자동 추출
2. GitHub Secrets **접미사 없이** push — `GHCR_TOKEN` · `SSH_PRIVATE_KEY` · (둘 다 채웠으면) `TS_OAUTH_CLIENT_ID` · `TS_OAUTH_SECRET`
3. GitHub Variables 접미사 없이 push — `DEPLOY_HOST` · `DEPLOY_SSH_USER`
4. 관측 스택(Loki · Grafana · Prometheus, Discord 있으면 Alertmanager) 배포 — dev·prod 가 `env` 라벨로 구분해 공유해요

다시 실행하면 현재 설정으로 자격과 관련 자원을 갱신해요. 변경할 계정·호스트·대상 저장소를 확인한 뒤 실행하고, 외부 서비스 상태에 따른 실패도 확인해요.

> **기존 레포 마이그레이션** — 이미 `.env.prod` 나 `.env.dev` 에 이 값들을 채워둔 레포라면, 1회차가 그 값을 `.env.infra` 로 자동으로 옮겨 담고 **어떤 키를 옮겼는지 이름만** 출력해요(값은 찍지 않아요). 원본은 지우지 않아요 — 읽기 순서상 환경 파일이 뒤에 얹히므로 중복이 있어도 동작이 같아요.

---

<a id="4-init-prodsh-1회차--envprod-자동-생성"></a>

## 4. `init-prod.sh` 1회차 — `.env.prod` 자동 생성

```bash
bash tools/init/init-prod.sh <owner>/<repo>
# 또는: <repo> prod init <owner>/<repo>
```

처음 설정하는 파생 저장소는 `.env.infra`를 먼저 준비해요. 공동 작업자 모드는 이 확인을 건너뛰어요. 로컬 설정이 아직 없으면 [로컬 온보딩](./onboarding.md)을 먼저 진행해요.

`init-prod.sh`는 `.env.prod`가 없을 때 예시를 복사하고 비어 있는 자동 항목을 채워요. `JWT_SECRET`, 서비스·이미지 이름 같은 값은 생성하거나 저장소에서 유도하고, `BASE_DOMAIN`과 `SUBDOMAIN`으로 도메인 값을 만들어요. PortOne webhook 값은 v1 API key가 설정돼 있을 때만 생성해요. DB 비밀번호는 자동 생성하지 않아요.

| 현재 상태 | 다음 동작 |
|---|---|
| 초기화된 파생 저장소이고 `.env.prod`가 없음 | 공동 작업자 조건을 만족하면 운영 설정을 건너뛰어요 |
| 최초 설정이며 `.env.prod`가 없음 | 파일을 생성하고 자동 값을 채워요 |
| 필수 값이 비어 있음 | 입력할 키를 안내하고 `exit 0`으로 종료해요 |
| 필수 값을 채웠음 | 같은 명령을 다시 실행해 등록과 검증을 진행해요 |

1회차·2회차는 별도 플래그가 아니라 파일과 값의 상태에 따른 설명이에요. 기존 값은 빈 값 채우기 규칙에 따라 유지되지만, Secrets 등록 단계는 현재 파일의 값을 다시 보낼 수 있어요. 재실행 전에 변경한 값과 대상 환경을 확인해요.

---

## 5. `.env.prod` 채우기

`.env.prod` 의 키는 우선순위 그룹으로 나뉘어 있어요. 사용자가 직접 채워야 할 건 [REQUIRED] 그룹뿐이고, [AUTO] 는 1회차가 알아서 채워요.

```bash
$EDITOR .env.prod
```

| 키 | 값 출처 |
|---|---|
| `SUBDOMAIN` | 운영 서브도메인 (기본 `server`). `.env.infra` 의 `BASE_DOMAIN` 과 합쳐 `APP_DOMAIN`·`PUBLIC_HOSTNAME` 자동 합성 |
| `DB_URL` | §3.5 의 Supabase JDBC URL (`jdbc:postgresql://...` — `jdbc:` prefix 필수) |
| `DB_USER` | §3.5 의 Supabase user (`postgres.<ref>`) |
| `DB_PASSWORD` | §3.5 의 Supabase 실제 비밀번호 (자동 발급 안 됨) |

도메인·Cloudflare·SSH·GHCR·Tailscale 은 여기 없어요. `.env.infra` 가 소유하고 `infra init` 이 올려요 (§3.7). 같은 키를 `.env.prod` 에도 두면 그 값이 이기지만, 두 곳을 따로 관리하게 되니 특정 환경만 다른 자격을 써야 할 때만 쓰세요.

`JWT_SECRET`·`KAMAL_SERVICE_NAME`·`APP_DOMAIN`·`PUBLIC_HOSTNAME`·`APP_FLYWAY_MODE` 등은 [AUTO] 그룹이라 1회차가 채워둬요. 직접 값을 넣으면 그 값이 우선해요.

<a id="optional-기능--켜고-싶으면-채워요"></a>

### OPTIONAL 기능 — 켜고 싶으면 채워요

자격을 비웠을 때의 동작은 기능마다 달라요. 결제는 자격이 모두 비어 있으면 Stub을 등록하고 결제 요청에 503을 반환해요. 스토리지 자격 없이 dev·prod를 기동하려면 `APP_STORAGE_IN_MEMORY_FALLBACK=true`가 필요해요. 이메일 기능이 켜진 dev·prod에는 Resend 자격이 필요하며, 로그만 남기는 이메일 어댑터는 local 전용이에요. 기능 자체를 끄는 설정은 `APP_FEATURES_*`이므로, 자격 누락과 기능 비활성화를 구분해요.

| 기능 | 키 |
|---|---|
| 스토리지 | `APP_STORAGE_MINIO_ENDPOINT`, `APP_STORAGE_MINIO_ACCESS_KEY`, `APP_STORAGE_MINIO_SECRET_KEY`, `APP_STORAGE_MINIO_BUCKETS_0` |
| 이메일 | `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, `RESEND_FROM_NAME` |
| 결제 | `APP_PAYMENT_PORTONE_API_V1_KEY`, `APP_PAYMENT_PORTONE_API_V1_SECRET`, `APP_PAYMENT_PORTONE_WEBHOOK_SECRET` |
| 로깅 | `LOKI_URL` |
| 알림 | `DISCORD_WEBHOOK_URL` |

> 앱 업로드 버킷은 등록된 앱 DataSource에서 이름을 계산해 `BucketProvisioner`가 준비해요. `APP_STORAGE_MINIO_BUCKETS_*`는 그 밖의 공유 버킷 목록이에요. 이 목록이 비어 있다고 앱 버킷 생성까지 건너뛰지는 않아요.

> 소셜 로그인 자격은 아래 [컨테이너까지 자격 전달](#app-credentials-chain) 절을 따라 GitHub 등록과 컨테이너 주입을 함께 연결해요.

<a id="결제--v1-키는-둘-다-아니면-둘-다-비우기"></a>

#### 결제 — v1 키는 둘 다, 아니면 둘 다 비우기

공유 결제 컨트롤러는 `PaymentPort`로 결제를 처리해요. dev/prod의 설정 가드는 v1 key·secret 중 하나만 있는 상태, 결제 키 없이 webhook secret만 있는 상태, v2 key가 설정된 상태를 거부해요. 현재 v2는 webhook secret의 유무와 관계없이 지원하지 않아요. v1 webhook은 서버가 `imp_uid`로 결제를 재조회하므로 webhook 서명을 사용하지 않아요.

```bash
# 결제 미사용 — 도그푸딩 단계에서는 전부 비워 StubPaymentAdapter 로 fallback 하는 게 정석
APP_PAYMENT_PORTONE_API_V1_KEY=
APP_PAYMENT_PORTONE_API_V1_SECRET=
APP_PAYMENT_PORTONE_WEBHOOK_SECRET=
```

결제 자격을 전부 비우면 `StubPaymentAdapter`가 등록돼 부팅할 수 있고, 결제 호출은 `PAY_008`로 실패해요. v1 key·secret을 채우면 실제 어댑터가 등록돼요. 임의의 더미 키도 실제 외부 호출을 시도하므로 미사용 상태는 빈 값으로 표현해요. 기능 전체를 끄려면 `APP_FEATURES_PAYMENT=false`를 사용해요. 자격 발급 절차는 [운영 키 가이드](../production/setup/key-issuance.md#47-portone-pg-결제-featurepayment)를 참고하세요.

코드는 `core/core-payment-impl/src/main/java/com/factory/core/payment/impl/PaymentAutoConfiguration.java` 의 `portOneProdConfigGuard` 예요.

---

<a id="app-credentials-chain"></a>
### 컨테이너까지 자격 전달

`.env.prod`의 `APP_CREDENTIALS_*` 값은 `init-prod.sh`가 이름 패턴으로 찾아 GitHub Secrets에 등록해요. 여기서 끝내면 서버 컨테이너에 전달되지 않아요. 앱별 자격을 추가할 때는 다음 경로를 모두 연결해요.

| 위치 | 추가할 내용 |
|---|---|
| `.env.prod` | 사용할 앱 자격의 실제 값 |
| `.github/workflows/deploy.yml` | 해당 Secret을 작업의 환경변수로 내보내는 매핑 |
| `.kamal/secrets.example`과 실행 시 사용하는 `.kamal/secrets` | 환경변수에서 Kamal secret으로 전달하는 매핑 |
| `config/deploy.yml`의 `env.secret` | 컨테이너에 넣을 키 이름 |

예를 들어 `APP_CREDENTIALS_GYMLOG_GOOGLE_CLIENT_IDS_0`를 네 경로에 연결해요. Apple·Kakao·Naver도 사용할 키를 같은 방식으로 연결하고 `init-prod.sh`를 실행한 뒤 다시 배포해요. 슬러그의 실제 Map 바인딩 키도 확인해야 해요. 자세한 체크리스트는 [자격 전달 경로](../production/setup/secret-chain-4stage.md)가 정본이에요.

---

<a id="6-init-prodsh-2회차--secretsvariables-push--검증"></a>

## 6. `init-prod.sh` 2회차 — Secrets·Variables push + 검증

`.env.prod` 의 REQUIRED 를 다 채웠으면 같은 명령을 다시 실행해요.

```bash
bash tools/init/init-prod.sh <owner>/<repo>
# 또는: <repo> prod init <owner>/<repo>
```

이번엔 Step 5.5 이후까지 끝까지 진행돼요.

1. **Step 5.7/5.8** — `.env.infra` 의 Cloudflare 자격으로 운영 DNS·Tunnel ingress 등록 (멱등).
2. **Step 6** — `.env.prod` 검증 후 GitHub 에 push.
   - REQUIRED Secrets 6개: `APP_DOMAIN`, `DB_PASSWORD`, `DB_URL`, `DB_USER`, `JWT_SECRET`, `APP_FLYWAY_MODE`
   - OPTIONAL 키(스토리지·이메일·결제·관리자 콘솔·로깅·알림) — 그룹별 필수 값이 모두 있을 때 등록해요. 값이 부족해 등록을 건너뛰었다고 서버의 기능 토글까지 바뀌지는 않아요
   - 소셜 로그인 자격(`APP_CREDENTIALS_*`) — `.env.prod` 에 있는 만큼 자동 발견·push
   - Variables 3개: `DEPLOY_ENABLED`, `KAMAL_SERVICE_NAME`, `PUBLIC_HOSTNAME`
   - 공유 자격(`GHCR_TOKEN`·`SSH_PRIVATE_KEY`·`TS_OAUTH_*`·`DEPLOY_HOST`·`DEPLOY_SSH_USER`)은 여기서 다루지 않아요 — `infra init` 이 접미사 없이 이미 올렸어요.
3. **Step 10** — `verify-server.sh --init-mode`를 호출해요. backend health는 건너뛰고 DB 연결과 설정된 선택 항목을 확인해요(§7). MinIO는 앱이나 버킷이 아직 없으면 검사를 건너뛰며, 준비돼 있으면 업로드를 검사해요.

> 부분 실패를 놓치지 마세요. 일부 secret push 가 실패해도 후속 step 이 조용히 건너뛰어질 수 있어요. init 종료 후 `gh secret list -R <repo>` 로 등록된 개수를 직접 확인하는 걸 권장해요. 자세한 함정은 [`도그푸딩 walkthrough §4.7`](./dogfood-walkthrough.md) 에 있어요.

> 이 단계는 인프라 셋업과 검증까지만 해요. 실제 운영 배포는 다음 명령이에요.
> ```bash
> <repo> prod deploy       # blue/green 배포 (build + push + cutover)
> <repo> prod test         # 배포 후 인프라 점검 (backend health 포함)
> ```

---

<a id="ci-deploy-gates"></a>
### CI와 배포를 켜는 조건

`DEPLOY_ENABLED`는 배포 게이트이며 CI 실행 전체를 끄는 값은 아니에요. `ci.yml`은 push 이벤트에 한해 `CI_ON_PUSH=false`이면 작업을 건너뛰고, PR과 수동 실행은 별도로 처리해요. 운영 배포는 CI 결과와 `DEPLOY_ENABLED=true` 같은 워크플로 조건을 확인해요. 실행 시간과 비용은 계정·runner·워크플로 실행 결과에 따라 달라 고정 시간이나 금액으로 안내하지 않아요.

---

## 7. `verify-server.sh` 7 단계 검증

`init-prod.sh` Step 10 이 `--init-mode` 로 자동 호출해요. 배포 후 단독 실행도 가능해요 (`<repo> prod test`, 또는 `--skip-deploy` 로 SSH·Tailscale 검증 생략).

| Step | 분류 | 항목 | PASS 의미 |
|---|---|---|---|
| 1 | REQUIRED | backend health (kamal-proxy → `/actuator/health`) | 운영 Spring 컨테이너가 응답. `--init-mode` 에선 배포 전이라 SKIP |
| 2 | REQUIRED | DB 연결 (psql 직접 ping) | backend 와 무관하게 psql `SELECT 1` 성공 |
| 3 | OPTIONAL: deploy | SSH + Tailscale (`kamal app version`) | 이 스크립트를 실행한 머신에서 배포 호스트까지의 SSH 접근 확인. GitHub Actions runner 경로는 실제 워크플로에서 별도 확인 |
| 4 | OPTIONAL: storage | MinIO 업로드 (PUT/STAT/DEL) | 접속값과 도구가 준비됐을 때 앱별 기대 버킷을 확인하고 파일을 업로드·조회·삭제해요. `--init-mode`에서 앱이나 버킷이 아직 없으면 SKIP해요 |
| 5 | OPTIONAL: email | Resend API 발송 | 이메일 기능 활성 시 (`RESEND_TEST_ADMIN_USER_EMAIL` 도 채워야 PASS) |
| 6 | OPTIONAL: logging | Loki 상태 | `LOKI_URL`이 설정됐을 때 컨테이너와 `/metrics` 응답을 확인해요 |
| 7 | OPTIONAL: alertmanager | Alertmanager 컨테이너 Up | 알림 기능 활성 시 (실제 알림 도착 여부는 이 검사에 포함되지 않음) |

판정 규칙이에요.

- REQUIRED 실패는 종료 코드 1로 처리해요.
- REQUIRED 검사를 도구·설정 부재로 수행하지 못하면 종료 코드 2로 판정을 보류해요. `--init-mode`에서 backend health를 건너뛰는 것은 의도된 예외예요.
- OPTIONAL 실패는 경고를 남기고 다음 항목으로 진행해요. 자격이나 도구가 없으면 SKIP할 수 있으며, 서버의 기능 설정을 바꾸지는 않아요.

요약표의 각 PASS·FAIL·SKIP과 사유를 확인해요. 종료 코드 0이어도 OPTIONAL 실패·미검증 항목이 남을 수 있어요. `--init-mode`에서는 backend를, 앱이나 버킷이 아직 없다면 MinIO도 건너뛰어요. 이 검사는 인프라 점검이며 로그인·결제 같은 API 시나리오는 별도로 검증해요.

> 첫 배포 전이라 운영 backend 가 아직 안 떠 있으면 (init-mode 가 아닌 일반 실행에서) Step 1 이 fail 해요. 그땐 `<repo> prod deploy` 로 배포한 뒤 `<repo> prod test` 를 다시 돌려보세요.

---

<a id="email-verification-recipient"></a>
### 테스트 메일의 수신자

`RESEND_TEST_ADMIN_USER_EMAIL`은 `verify-server.sh`가 테스트 메일을 보낼 주소예요. 실행하는 머신의 환경 파일에서 읽으며 운영 서버의 메일 발송 설정이나 GitHub Secrets 등록 항목은 아니에요. 비어 있으면 해당 검증을 건너뛸 수 있어요. `RESEND_API_KEY`·`RESEND_FROM_ADDRESS`·`RESEND_FROM_NAME`은 실제 발송 설정이므로 별도로 전달해요.

`SKIP`은 그 기능을 검증했다는 뜻이 아니에요. 실제 이메일 수신과 Alertmanager의 채널 도착까지 확인하려면 각 기능의 테스트 절차를 추가로 실행해요. [알림 도착 확인](../production/setup/monitoring-setup.md#알림-도착-확인)을 참고하세요.

---

## 8. 로컬 부팅 검증

운영 셋업과 별개로, 로컬에서 Spring 이 뜨는지도 확인해 두면 좋아요.

```bash
./gradlew :bootstrap:bootRun
# → http://localhost:8081/actuator/health 가 UP
```

로컬 서버가 UP인 것은 로컬 기동 확인이에요. 운영 인프라 검사와 실배포 후 API 검증까지 통과했다는 뜻은 아니에요. `bootRun`은 루트 `.env`를 읽고 기본 local 프로파일로 실행하며, 이미 내보낸 환경변수는 우선 적용돼요.

자동 검증을 쓰려면 `<repo> local server-test` 를 돌려요. postgres ready(REQUIRED) · MinIO health(REQUIRED) · WireMock(OPTIONAL, OAuth dev-mock) · Spring Boot bootRun(OPTIONAL) 네 단계를 운영용 `verify-server.sh` 와 같은 패턴으로 검증해요.

---

<a id="private-network-check"></a>
### 외부 도메인 없이 요청 확인

노트북에서 서버 자체를 확인하려면 위 로컬 실행을 사용해요. 이미 원격 호스트에 배포했다면 Tailscale로 도달 가능한 머신에서 프록시의 Host 라우팅을 시험할 수 있어요.

```bash
curl -H "Host: server.<도메인>" http://100.X.X.X/actuator/health/liveness
```

Host 헤더는 프록시에 등록된 이름과 같아야 해요. 이 요청이 성공해도 외부 DNS·Cloudflare 터널 경로를 검증한 것은 아니에요. 기본 init 자동화의 Cloudflare 요구 조건은 §3.6을 확인해요.

---

<a id="9-trial-환경-자동화--toolsdogfoodingsetupsh--cleanupsh-선택"></a>

## 9. Trial 환경 자동화 — `tools/dogfooding/setup.sh` + `cleanup.sh` (선택)

§4 ~ §6 의 `init-prod.sh` 흐름과 별개로, Mac mini 에 trial 환경을 임시로 올렸다가 한 번에 정리하고 싶을 때 쓰는 일괄 도구예요. GitHub 권한·SSH 키 등록·Secrets·Mac mini 컨테이너·GHCR 이미지를 한꺼번에 처리해요. 입력값은 `tools/dogfooding/.env.dogfood` 에 채워요 (`.env.dogfood.example` 복사).

`setup.sh` 가 하는 일이에요.

- 필수 변수 검증 (`GH_REPO`·SSH 키 경로·DB·도메인·Tailscale 등) + `DB_URL` 형식 확인
- GitHub Actions workflow 권한 = write
- `gha_deploy` SSH 키 발급(없으면) + Mac mini authorized_keys 등록
- GitHub 에 Variables 2개(`KAMAL_SERVICE_NAME`, `DEPLOY_ENABLED`)와 지정된 Secrets 등록
- `DEPLOY_ENABLED=true` 토글 후 (옵션) trigger commit push

`cleanup.sh`는 아래 자원을 정리해요. 외부 자격 폐기나 모든 생성 작업을 되돌리는 정확한 역연산은 아니며, 같은 호스트의 공유 프록시·네트워크에도 영향을 줄 수 있어요.

- GitHub 지정된 Variables와 Secrets 삭제
- Mac mini 의 spring 컨테이너 + kamal-proxy 컨테이너 + kamal network 삭제
- Mac mini `authorized_keys` 에서 `gha-deploy@<service>` 줄 제거
- GHCR 패키지(모든 tag) 삭제
- 외부 키 수동 폐기 안내 출력 (PAT · Tailscale OAuth · Supabase 비밀번호)

옵션이에요.

| 옵션 | 효과 |
|---|---|
| `--keep-proxy` | kamal-proxy 컨테이너 유지 (다음 배포 즉시 가능) |
| `--keep-ssh` | Mac mini authorized_keys 의 gha-deploy 줄 유지 |
| `--restore-perms` | workflow 권한을 read 로 복원 |
| `--yes` / `-y` | confirm prompt 생략 |

없는 자원은 건너뛰도록 처리하지만 정리 대상이 맞는지 매번 확인해요. 프록시까지 제거하면 다음 배포에서 다시 준비해야 해요. 같은 호스트에서 프록시를 유지하려면 `--keep-proxy`를 사용해요. 프록시를 다시 준비하는 시간은 호스트 상태에 따라 달라요.

> 외부 키 폐기는 사람이 직접 해야 해요. GitHub PAT 삭제 · Tailscale OAuth client 삭제 · (선택) Supabase 비밀번호 재설정이에요.

---

<a id="trial-retry"></a>
### 중간 실패 뒤 재실행

실패 원인과 현재 자원 상태를 확인한 뒤 `setup.sh`를 다시 실행해요. 이 도구는 일부 단계를 건너뛰거나 덮어쓰도록 작성돼 있어요.

| 단계 | 재실행 시 처리 |
|---|---|
| 사전 요구사항 | 다시 검사해요 |
| workflow 권한 | 설정한 write 권한을 적용해요 |
| 배포 SSH 키 | 기존 키가 있으면 재사용해요 |
| authorized_keys | 같은 키를 중복 추가하지 않도록 검사해요 |
| Variables·Secrets | 현재 입력값으로 덮어써요 |

대상 저장소·호스트·서비스 이름을 바꿨다면 이전 자원과 새 자원이 섞이지 않았는지 확인해요.

<a id="trial-traffic"></a>
### 시험 환경과 실제 트래픽

trial 컨테이너도 프록시의 Host 라우팅과 외부 터널이 연결돼 있으면 실제 요청을 받을 수 있어요. 시험용 서비스 이름·도메인·DB·자격을 운영과 구분하고, 정리 명령이 공유 프록시나 실제 서비스에 미칠 범위를 확인해요. 임시 검증을 통과했다는 이유만으로 더미 설정을 운영 설정으로 간주하지 않아요.

---

<a id="10-보안--노출-시-즉시-폐기"></a>

## 10. 보안 — 노출 시 즉시 폐기

키를 commit하거나 외부에 평문으로 전달했다면 먼저 발급처에서 폐기해요. 파일 삭제나 컨테이너 정리만으로 이미 발급된 자격이 무효화되지는 않아요.

1. 노출된 GitHub PAT·Tailscale OAuth·DB 자격 등 해당 값을 발급처에서 폐기·교체해요.
2. 저장소의 노출 파일을 제거하고 필요한 경우 협의한 절차로 Git 이력을 정리해요. 과거 이력에서 지우는 작업도 자격 폐기를 대신하지 못해요.
3. 공유 자격은 `.env.infra`와 `infra init`, 환경별 자격은 해당 `.env.dev`·`.env.prod`와 init으로 다시 등록해요.
4. 관련 서비스를 다시 배포하고 새 자격으로 동작하는지 확인해요.

`.gitignore`와 trial 스크립트의 무시 여부 검사는 실수를 줄이는 장치예요. 이미 추적한 파일까지 자동으로 보호하지는 않으니 변경 목록을 확인해요. 상세 절차는 [키 교체 문서](../production/setup/key-rotation.md)를 참고하세요. `cleanup.sh`는 배포 자원을 정리하는 도구이며 외부 키를 폐기하지 않아요.

---

## 11. 트러블슈팅

- 에러 메시지로 검색: [`도그푸딩 함정 모음`](./dogfood-pitfalls.md) 의 표
- 자주 묻는 질문: [`도그푸딩 FAQ`](dogfood-setup.md)
- 시간 순 흐름 + 정착된 패턴: [`도그푸딩 walkthrough`](./dogfood-walkthrough.md)

---

## 다음 단계

도그푸딩 검증이 끝났다면 다음으로 진행하세요.

- 운영 장애 대응: [`운영 런북`](../production/deploy/runbook.md) — 평시·장애 운영 절차
- 템플릿 개선을 파생 레포로 전파: [`크로스 레포 Cherry-pick 가이드`](./cross-repo-cherry-pick.md)
- 공동 작업자 합류: [공동 작업자 모드](#15-공동-작업자-모드-fresh-clone) — 두 번째 이상 작업자의 로컬 설정

---

## 관련 문서

- [`도그푸딩 walkthrough`](./dogfood-walkthrough.md) — 시간 순 narrative + 정착된 패턴
- [`CI/CD 전체 플로우`](../production/deploy/ci-cd-flow.md) — commit → 배포 전체 다이어그램
- [`도그푸딩 함정 모음`](./dogfood-pitfalls.md) — 증상별 원인과 현재 대응
- [`도그푸딩 FAQ`](dogfood-setup.md) — 자주 묻는 질문
- [`secret chain 4-stage 통합 가이드`](../production/setup/secret-chain-4stage.md) — 네 곳 매핑 + 체크리스트
- [`키 교체 절차`](../production/setup/key-rotation.md)
- [`운영 배포 가이드`](../production/deploy/deployment.md) — cloudflared 셋업, observability 등
- [`Mac mini 운영 호스트 설정`](../production/setup/mac-mini-setup.md)
- [`운영 런북`](../production/deploy/runbook.md) — 평시 배포 · 롤백 · 장애 대응
- [`ADR-018 · SchemaRoutingDataSource`](../philosophy/adr-018-schema-routing-datasource.md) — `deriveSlugUrl` 설계 근거
- [`ADR-019 · billing / IAP / payment 분리`](../philosophy/adr-019-billing-iap-payment-separation.md) — 결제 도메인 분리 결정

---

<a id="책-목차--journey-46단계"></a>

## 책 목차 — Journey 4~6단계

이 문서는 [`template-spring 책 목차 (Developer Journey)`](../onboarding/README.md) 의 4단계(외부 자격 증명) · 5단계(테스트) · 6단계(정리)를 한 문서로 통합해요.

| 방향 | 문서 | 한 줄 |
|---|---|---|
| ← 이전 | [`소셜 로그인 설정 가이드`](./social-auth-setup.md) | 4단계 첫 번째 — 소셜 로그인 자격 증명 |
| → 다음 | [`운영 배포 가이드`](../production/deploy/deployment.md) | 7단계 — 파생 레포 첫 운영 배포 |

**막혔을 때**: [`도그푸딩 함정 모음`](./dogfood-pitfalls.md) · [`도그푸딩 FAQ`](dogfood-setup.md) · [`도그푸딩 walkthrough`](./dogfood-walkthrough.md)
**왜 이렇게?**: [`인프라 결정 기록`](../production/deploy/decisions-infra.md) — I-09 (Kamal 선택) · I-10 (GHCR PAT) · I-12 (workflow_run 게이트) · I-14 (Tailscale OAuth scope)
