# 운영 배포 가이드 (파생레포 onboarding)

> **유형**: How-to · **독자**: Level 2~3 · **읽는 시간**: ~15분

template 에서 "Use this template" 으로 만든 파생레포를 Mac mini 홈서버에 처음 배포하는 순서를 정리해요. 첫 코드 준비부터 Cloudflare Tunnel, GitHub Secrets, Kamal blue/green 배포까지 한 흐름으로 따라가요.

> ⚡ **자동화 흐름 (권장)** — 아래 §1~§5 는 한 단계씩 손으로 하는 수동 안내예요. 같은 흐름을 한 번에 자동화한 명령은 다음과 같아요.
> ```bash
> ./factory init <owner>/<repo>     # = local init (.env / docker / verify-local)
> <repo> prod init                  # = §2~§3 (Cloudflare Tunnel / DNS / GitHub Secrets push / verify-server)
> <repo> prod deploy                # = §5 (origin/main SHA → kamal build/push/blue-green)
> ```
> 자동 흐름의 자세한 설명은 두 문서에 있어요.
> - 환경 셋업: [`도그푸딩 환경 셋업 가이드`](../../start/dogfood-setup.md)
> - 명령어 매트릭스: [`CLI 가이드`](../../start/cli-guide.md)
>
> 본 문서는 그 자동 명령이 *안으로 무엇을 하는지* 가 궁금할 때 참고하세요.

> 결정 근거: [`인프라 결정 기록 (Decisions — Infrastructure) I-09`](./decisions-infra.md)
> 전체 구성도: [`인프라 (Infrastructure)`](./infrastructure.md)
> 평시 운영 / 장애 대응: [`운영 런북 (Runbook)`](./runbook.md)

---

## 전제조건

- Mac mini (Apple Silicon) 운영 호스트가 Tailscale 에 올라와 있고 SSH 로 접근 가능
- Cloudflare 계정 + 도메인이 Cloudflare NS 로 등록됨
- GitHub 계정 + 파생레포가 "Use this template" 으로 생성됨
- 본인 Supabase 프로젝트가 Seoul 리전으로 생성되어 있음 (`I-01`)
- NAS MinIO 가 기동 중 (`I-03`)

---

## 1. 파생레포 코드 준비

### 1.1 첫 앱 모듈 만들기

파생레포는 처음엔 앱 모듈이 0개라 Spring 이 아직 부팅되지 않아요. 첫 앱을 하나 추가해야 코드 골격과 DB schema 가 같이 만들어져요.

```bash
# 파생레포 로컬 clone 후
export DB_PSQL_URL='postgresql://postgres:<pw>@<supabase-host>:5432/postgres'  # Supabase 관리자 credential
./tools/new-app/new-app.sh <slug> --provision-db
```

결과로 `apps/app-<slug>/` 디렉토리가 생기고, Supabase 에 `<slug>` schema 와 role 이 만들어지고, `.env` 에 placeholder 가 추가돼요.

### 1.2 `.env` 채우기 (로컬 빌드/검증용, gitignored)

로컬 빌드와 검증에 쓰는 `.env` 예요. `.gitignore` 라 커밋되지 않아요.

```bash
DB_URL=postgresql://postgres.<ref>:<pw>@aws-1-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true
DB_USER=postgres.<ref>
DB_PASSWORD=<supabase-pw>
JWT_SECRET=<32+ chars 랜덤>
APP_DOMAIN=https://server.<도메인>
RESEND_API_KEY=re_<prod>
RESEND_FROM_ADDRESS=noreply@<도메인>
RESEND_FROM_NAME=<서비스 이름>
APP_STORAGE_MINIO_ENDPOINT=http://192.168.X.X:9000
APP_STORAGE_MINIO_ACCESS_KEY=<nas-minio-key>
APP_STORAGE_MINIO_SECRET_KEY=<nas-minio-secret>
LOKI_URL=http://loki:3100/loki/api/v1/push   # Mac mini prod 에선 kamal 네트워크의 loki container name
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
# 앱 모듈별 credential
APP_CREDENTIALS_<SLUG>_GOOGLE_CLIENT_IDS_0=...
APP_CREDENTIALS_<SLUG>_APPLE_BUNDLE_ID=...
```

### 1.3 로컬 Docker 빌드·기동 검증

운영 배포 전에 prod 프로파일로 로컬 smoke test 를 한 번 돌려 보면 안전해요. prod 프로파일은 관측성과 시크릿이 전부 채워져야 Spring property resolution 을 통과하므로, 위 `.env` 가 다 채워져 있어야 해요. 제일 편한 방식은 `--env-file` 로 일괄 주입하는 거예요.

```bash
docker build -t <파생레포>-test .
# SPRING_PROFILES_ACTIVE 와 SERVER_PORT 를 prod 에 맞추기 위해 별도 override env 파일을 하나 더 둠:
cat > .env.docker <<EOF
SPRING_PROFILES_ACTIVE=prod
SERVER_PORT=8080
EOF
docker run --rm -p 8080:8080 \
  --env-file .env \
  --env-file .env.docker \
  <파생레포>-test
```

다른 터미널에서 헬스 체크를 보면 성공이에요.

```bash
curl localhost:8080/actuator/health    # → 200
```

> dev 프로파일로 smoke test 하려면 `.env.docker` 에서 `SPRING_PROFILES_ACTIVE=dev` 로 바꿔요. prod 는 관측성·시크릿을 전부 채워야 기동되므로, 기동에 실패하면 `docker logs` 에서 어떤 `${VAR}` 가 resolve 안 됐는지 확인하세요.

---

## 2. Mac mini 호스트 준비 (최초 1회)

### 2.1 OrbStack 설치 (Docker Desktop 대체 권장)

```bash
brew install --cask orbstack
```

Docker Desktop 이 이미 있다면 OrbStack 설치 후 Desktop 은 종료하세요. 메모리 350MB 이상을 절약해요.

### 2.2 GHA 전용 deploy SSH 키 생성

배포는 GitHub Actions 가 Mac mini 에 SSH 로 붙어 진행하므로, GHA 전용 키를 따로 발급해요.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/gha_deploy -C "gha-deploy@<파생레포>" -N ""
cat ~/.ssh/gha_deploy.pub >> ~/.ssh/authorized_keys
```

발급한 private 키 `~/.ssh/gha_deploy` 의 내용을 GitHub Secret `SSH_PRIVATE_KEY` 로 등록해요 (§3 에서).

### 2.3 Cloudflare Tunnel 준비

집 서버는 공인 IP 노출 없이 Cloudflare Tunnel 로 인터넷에 공개해요. 새 tunnel 을 만들고 DNS 를 연결해요.

```bash
# 설치 확인
which cloudflared || brew install cloudflared

# 새 tunnel (기존 tunnel 과 이름 충돌 없게)
cloudflared tunnel login    # 브라우저로 example.com 같은 zone 선택
cloudflared tunnel create <파생레포>-home
# → credentials 파일: ~/.cloudflared/<uuid>.json
```

config 파일 `~/.cloudflared/<파생레포>.yml` 을 작성해요.

```yaml
tunnel: <uuid>
credentials-file: /Users/<user>/.cloudflared/<uuid>.json
ingress:
  - hostname: server.<도메인>
    service: http://localhost:80       # kamal-proxy
  - hostname: log.<도메인>
    service: http://localhost:3000     # Grafana
  - service: http_status:404
```

DNS 레코드를 등록해요.

```bash
cloudflared tunnel route dns <파생레포>-home server.<도메인>
cloudflared tunnel route dns <파생레포>-home log.<도메인>
```

### 2.4 Cloudflare Access 정책 — `log.<도메인>` 게이팅

Grafana 대시보드는 본인만 보도록 Cloudflare Access 로 게이팅해요. 대시보드에서 Zero Trust → Access → Applications → Add application 으로 들어가 다음처럼 설정해요.

- Type: Self-hosted
- Application domain: `log.<도메인>`
- Policy: Include → Emails → 본인 이메일
- Identity provider: One-time PIN (Free tier 기본)

### 2.5 관측성 스택 기동

Loki / Grafana / Prometheus 는 운영 전용이라 별도 compose 로 띄워요.

```bash
# 파생레포를 Mac mini 에 clone 한 뒤
cd <파생레포>
docker compose -f infra/docker-compose.observability.yml up -d
```

`curl localhost:3000` 하면 Grafana 로그인 화면이 떠요.

### 2.6 cloudflared launchd 등록 (영속)

Mac 재부팅 후에도 tunnel 이 자동으로 살아나도록 launchd 에 등록해요. `~/Library/LaunchAgents/site.<파생레포>.cloudflared.plist` 를 작성해요.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>site.<파생레포>.cloudflared</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/cloudflared</string>
    <string>tunnel</string>
    <string>--config</string>
    <string>/Users/<user>/.cloudflared/<파생레포>.yml</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/cloudflared.out.log</string>
  <key>StandardErrorPath</key><string>/tmp/cloudflared.err.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/site.<파생레포>.cloudflared.plist
```

---

## 3. GitHub Secrets / Variables 등록 (파생레포)

배포 workflow 가 읽을 값을 GitHub 에 등록해요. 공개해도 되는 구성값은 Variables 로, 시크릿은 Secrets 로 나눠 둬요.

### 3.1 Repository Variables (공개 가능한 구성값)

```bash
gh variable set DEPLOY_ENABLED --body 'true'
gh variable set KAMAL_SERVICE_NAME --body '<파생레포-slug>'
gh variable set DEPLOY_HOST --body '100.x.x.x'          # Mac mini Tailscale IP
gh variable set PUBLIC_HOSTNAME --body 'server.<도메인>'
gh variable set DEPLOY_SSH_USER --body '<mac-mini-계정>'  # 미설정 시 root 로 폴백 → SSH 접속 실패 함정
```

### 3.2 Repository Secrets (시크릿)

```bash
gh secret set TS_OAUTH_CLIENT_ID --body '<tailscale-oauth-client-id>'
gh secret set TS_OAUTH_SECRET --body '<tailscale-oauth-secret>'
gh secret set SSH_PRIVATE_KEY < ~/.ssh/gha_deploy        # §2.2 에서 생성한 key

gh secret set DB_URL --body 'postgresql://...'
gh secret set DB_USER --body 'postgres.<ref>'
gh secret set DB_PASSWORD --body '<supabase-pw>'
gh secret set JWT_SECRET --body '<prod-jwt-secret>'
gh secret set APP_DOMAIN --body 'https://server.<도메인>'
gh secret set RESEND_API_KEY --body 're_...'
gh secret set RESEND_FROM_ADDRESS --body 'noreply@<도메인>'
gh secret set RESEND_FROM_NAME --body '<서비스 이름>'
gh secret set APP_STORAGE_MINIO_ENDPOINT --body 'http://192.168.X.X:9000'
gh secret set APP_STORAGE_MINIO_ACCESS_KEY --body '<nas-minio-key>'
gh secret set APP_STORAGE_MINIO_SECRET_KEY --body '<nas-minio-secret>'
gh secret set LOKI_URL --body 'http://loki:3100/loki/api/v1/push'
gh secret set DISCORD_WEBHOOK_URL --body 'https://discord.com/api/webhooks/...'
```

Tailscale OAuth client 는 Tailscale admin → Settings → OAuth clients → `Generate` 로 발급해요. scope 는 `Devices → Core → Write` 와 `Keys → Auth Keys → Write` **두 개를 모두** 체크하고 각각 `tag:ci` 를 부여합니다 — 하나라도 빠지면 배포 시 403 이 나요 ([`decisions-infra.md I-14`](./decisions-infra.md) · [`dogfood-setup §3.2`](../../start/dogfood-setup.md)).

**GHCR 토큰** — `secrets.GITHUB_TOKEN` 자동 주입만으론 부족합니다. 첫 GHCR 패키지 push 시 repo 와 package 가 자동 연결되지 않아 403 이 나거든요. `repo` + `write:packages` scope 의 Classic PAT 를 발급해 `GHCR_TOKEN` secret 으로 등록해야 합니다. `init-prod.sh` 가 `.env.prod` 의 `GHCR_TOKEN` 을 GitHub Secrets 로 자동 push 하므로, 운영자는 PAT 발급과 `.env.prod` 채우기만 하면 끝이에요. 자세한 배경은 [`decisions-infra.md I-10`](./decisions-infra.md) 과 [`dogfood-pitfalls.md #7`](../../start/dogfood-pitfalls.md) 의 함정 사례를 참고하세요.

---

## 4. Kamal 초기 setup (최초 1회)

로컬에서 파생레포 루트 기준으로 Kamal 을 한 번 setup 해요. kamal-proxy 가 Mac mini 에 기동돼요.

```bash
gem install kamal   # Ruby 3.2+ 필요
kamal setup         # SSH 로 Mac mini 에 붙어 docker 확인 + kamal-proxy 기동
```

Mac mini 에 기존 nginx 가 `:80` 을 점유 중이라면 `kamal setup` 이 실패해요. 이럴 땐 nginx 를 내려요.

```bash
ssh storkspear@<tailscale-ip> 'brew services stop nginx; pkill -f "nginx.*worker" || true'
```

---

## 5. 첫 배포

배포 경로는 세 가지예요. 권장은 GitHub Actions 자동 흐름이고, 로컬에서 직접 돌리는 두 가지 수동 경로가 백업이에요. 셋 다 결과는 Kamal blue/green 배포예요.

### 자동 흐름 (GitHub Actions)

파생레포 main 에 push 하면 CI 가 검증을 끝낸 뒤 [`deploy.yml`](../../../.github/workflows/deploy.yml) 이 `workflow_run` 으로 자동 트리거됩니다. 단계는 이렇게 흘러요.

```
main push
   ↓
CI (./gradlew build — test/spotless/owasp 검증)   ← jar 는 검증용, 배포에 안 씀
   ↓ workflow_run (성공 + DEPLOY_ENABLED=true 일 때만)
deploy.yml gate → 배포할 SHA 결정
   ↓
deploy job: 해당 SHA 체크아웃 → ./gradlew bootstrap:bootJar -x test (jar 직접 빌드)
   ↓
Dockerfile.runtime 으로 buildx (arm64) → GHCR push (ghcr.io/<owner>/<repo>:<sha>)
   ↓
kamal deploy --skip-push --version=<sha>   ← kamal 은 빌드 없이 swap 만
   ↓
옛 GHCR 이미지 cleanup (최신 2개만 유지)
```

여기서 중요한 설계 결정이 있어요. **CI 와 deploy 가 각각 따로 빌드합니다.** CI 의 `./gradlew build` 는 test / spotless / OWASP 를 검증할 뿐, 그 jar 를 artifact 로 넘기지 않아요. deploy job 이 같은 SHA 를 다시 체크아웃해서 `bootstrap:bootJar -x test` 로 직접 빌드합니다. 빌드를 한 번 더 도는 비용 (deploy 시간 +4~7분, test 는 빼서 빠름) 을 감수하는 이유는 artifact storage 때문이에요. bootstrap jar (~80MB) 가 main push 마다 누적되면 Actions storage 무료 한도 (500MB) 를 단기간에 소진하거든요. retention 을 1일로 둬도 GitHub GC 지연으로 누적되므로, 아예 artifact 를 안 쓰고 deploy 가 직접 빌드하는 쪽을 택했습니다.

이미지 패키징은 [`Dockerfile.runtime`](../../../Dockerfile.runtime) 이 맡아요. 미리 빌드된 `app.jar` 를 `eclipse-temurin:21-jre-alpine` 에 얹어 GHCR 에 push 하고, `kamal deploy --skip-push` 는 그 이미지를 Mac mini 가 pull 해서 swap 만 해요. kamal 이 직접 빌드하지 않아 배포가 가벼워요. 첫 배포면 kamal 이 자동으로 setup (kamal-proxy 기동) 도 함께 수행합니다.

옛 GHCR 이미지는 매 배포 끝에 cleanup 돼요. 최신 2개 (현재 + rollback 1단계) 만 남겨 500MB packages 한도 안에서 운영합니다.

### 수동 흐름 (factory wrapper, 로컬)

GHA billing 이슈나 hotfix 처럼 로컬에서 바로 배포해야 할 때 쓰는 권장 경로예요.

```bash
<your-backend> prod deploy           # origin/main SHA 자동 감지 + kamal --version 명시
```

내부적으로 [`tools/deploy.sh`](../../../tools/deploy.sh) 가 `git fetch origin main` 으로 최신 SHA 를 가져와 `kamal deploy --version=<origin-main-SHA>` 를 호출합니다. 배포의 source of truth 는 원격 브랜치예요. 로컬 working tree 나 HEAD 와 무관하게 **origin/main 코드 기준** 으로 빌드되므로, 로컬 미커밋·미푸시 변경이 배포에 새지 않아요. dev 배포는 `--target=dev` 로 origin/develop 기준이 돼요. 자세한 동작은 [`runbook §평시 배포`](./runbook.md) 를 참조하세요.

### 수동 흐름 (legacy, kamal 직접 호출)

`tools/deploy.sh` 를 거치지 않고 kamal 을 직접 부르는 가장 낮은 레벨의 경로예요. 이 경우엔 kamal 의 builder 가 기존 multi-stage [`Dockerfile`](../../../Dockerfile) 로 풀 빌드하고, 원격 SHA 보장 없이 **로컬 working tree 기준** 으로 배포됩니다.

```bash
set -a; source .env; set +a
kamal deploy
```

### 성공 확인

```bash
curl -sSf https://server.<도메인>/actuator/health/liveness    # 200
curl -I https://log.<도메인>                                   # 302 (CF Access 리다이렉트)
```

---

## dev 환경 자동 배포 (opt-in)

prod 셋업 완료 후, 같은 Mac mini 에 `dev-server.<도메인>` 을 격리 운영하고 싶을 때 (사내·외주 검증용) 쓰는 선택 흐름이에요. kamal service 이름 (`server-dev`) 으로 컨테이너와 docker network 가 자동 분리되므로 host 충돌이 없어요.

격리 모델은 [`develop-branch-policy.md §5`](../operations/develop-branch-policy.md#5-dev-server-vs-prod--격리-모델) 에 정리돼 있어요.

### 추가 셋업 (1회)

1. `.env.dev` 를 채워요 — `.env.dev.example` 참고. REQUIRED 키는 `BASE_DOMAIN`, `SUBDOMAIN`, `DB_URL` (별도 Supabase dev 계정), `DB_USER`, `DB_PASSWORD`, `APP_STORAGE_MINIO_BUCKETS_0` (같은 MinIO 인스턴스의 dev 전용 bucket) 이에요.
   `.env.dev` 안의 키 이름은 `.env.prod` 와 동일해요 (suffix 없음). `init-dev.sh` 가 GitHub Secrets/Variables 로 push 할 때만 `_DEV` suffix 를 자동으로 붙여요.
   공유 인프라 자격 (Cloudflare · TS_OAUTH · SSH · GHCR · DEPLOY_HOST) 은 `.env.dev` 가 비어 있으면 `.env.prod` 에서 자동 fallback 합니다.

2. `<repo> dev init` 을 실행해요 — Cloudflare DNS / Tunnel ingress 등록 + GitHub Secrets/Variables (`_DEV` suffix) push.

   추가되는 Repo Variables:
   ```bash
   gh variable set KAMAL_SERVICE_NAME_DEV --body 'server-dev'
   gh variable set PUBLIC_HOSTNAME_DEV    --body 'dev-server.<도메인>'
   gh variable set DEPLOY_ENABLED_DEV     --body 'true'   # gate opt-in
   ```

   추가되는 Repo Secrets:
   ```bash
   gh secret set DB_URL_DEV                     # 별도 Supabase
   gh secret set DB_USER_DEV
   gh secret set DB_PASSWORD_DEV
   gh secret set APP_STORAGE_MINIO_BUCKETS_0_DEV     # dev bucket
   ```

   나머지 운영 자격 (JWT · RESEND · PortOne · MinIO ENDPOINT·KEY · APP_DOMAIN · LOKI_URL · DISCORD_WEBHOOK_URL) 도 전부 `_DEV` suffix 의 별도 secret 이에요 — `init-dev.sh` 가 `.env.dev` 값을 `_DEV` suffix 로 push 하고, `deploy-dev.yml` 이 컨테이너 안에서 일반 이름으로 export 합니다. prod 와 공용인 것은 `GHCR_TOKEN` · `SSH_PRIVATE_KEY` · `TS_OAUTH_*` 뿐이에요 ([`develop-branch-policy §5`](../operations/develop-branch-policy.md#5-dev-server-vs-prod--격리-모델) 의 격리 모델과 일치).

### 자동 배포

`develop` 브랜치에 push 하면 CI 통과 후 [`deploy-dev.yml`](../../../.github/workflows/deploy-dev.yml) 이 `workflow_run` 으로 자동 트리거돼요. prod 와 같은 GHCR repo 에 `:dev-<sha>` 태그로 이미지를 빌드·push 한 뒤 `kamal deploy -c config/deploy-dev.yml --skip-push` 로 배포합니다. `DEPLOY_ENABLED_DEV=true` 일 때만 진행하므로, template 레포는 미설정이라 자동으로 skip 돼요.

수동 배포는 `<repo> dev deploy` 또는 `tools/deploy.sh --target=dev` 예요.

### 폐기

```bash
<repo> dev clear         # 인프라만 (Cloudflare + kamal app remove + _DEV secrets 회수)
                          # → Supabase 스키마 / MinIO bucket 보존
<repo> dev force-clear   # + Supabase 스키마 DROP + MinIO bucket 제거 (3단계 confirm)
                          # → prod host 충돌 safety check 내장
```

---

## 6. 체크리스트 (처음 한 번)

- [ ] `new-app.sh` 로 첫 앱 모듈 생성 완료 (Supabase schema 확인)
- [ ] `.env` 채움 / `docker build` + `docker run` 로컬 검증
- [ ] Mac mini OrbStack 설치 / Tailscale 상태 OK / SSH 키 authorized_keys 등록
- [ ] Cloudflare Tunnel 생성 / DNS 레코드 / Access 정책
- [ ] 관측성 compose 기동 / Grafana 로그인 확인
- [ ] cloudflared launchd plist 등록
- [ ] GHA Secrets / Variables 등록 완료 (`DEPLOY_ENABLED=true` 포함)
- [ ] `kamal setup` 성공
- [ ] `kamal deploy` 또는 main push → GHA 배포 성공
- [ ] 외부 HTTPS 접근 확인 (`server.<도메인>`, `log.<도메인>`)

---

## 관련 문서

- [`인프라 결정 기록 (Decisions — Infrastructure) I-09`](./decisions-infra.md) — Kamal 선택 근거
- [`운영 런북 (Runbook)`](./runbook.md) — 평시 배포 / 롤백 / 장애 대응
- [`운영 모니터링 셋업 가이드`](../setup/monitoring-setup.md) — Grafana / Prometheus / Alertmanager 운영
- [`Onboarding — 템플릿 첫 사용 가이드`](../../start/onboarding.md) — 새 개발자 첫 실행 (로컬 dev)
- [`스토리지 셋업 가이드 (MinIO / 시놀로지 NAS)`](../setup/storage-setup.md) — MinIO 로컬/NAS

---

## 📖 책 목차 — Journey 7단계

[`📚 template-spring — 책 목차 (Developer Journey)`](../../onboarding/README.md) 의 **7단계 — 이제 use this template** 입니다. 파생 레포 첫 운영 배포.

| 방향 | 문서 | 한 줄 |
|---|---|---|
| ← 이전 | [`도그푸딩 환경 셋업 가이드`](../../start/dogfood-setup.md) | 4~6단계, template 자체 검증 (셋업/테스트/정리) |
| → 다음 | [`크로스 레포 Cherry-pick 가이드`](../../start/cross-repo-cherry-pick.md) | 같은 7단계, template 변경을 파생 레포로 가져오기 |

**막혔을 때**:
- 함정 사례: [`도그푸딩 함정 모음 (사고 실록)`](../../start/dogfood-pitfalls.md)
- 평시 운영 절차: [`운영 런북 (Runbook)`](./runbook.md)

**왜 이렇게?**:
- Kamal 선택: [`인프라 결정 기록 (Decisions — Infrastructure) I-09`](./decisions-infra.md)
- 템플릿 패턴: [`ADR-002 (GitHub Template Repository 패턴)`](../../philosophy/adr-002-use-this-template.md)
