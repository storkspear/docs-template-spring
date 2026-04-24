# 운영 배포 가이드 (파생레포 onboarding)

template 에서 "Use this template" 으로 만든 파생레포를 Mac mini 홈서버에 처음 배포할 때의 순서.

> 결정 근거: [`infra/decisions-infra.md` I-09](./decisions-infra.md)
> 전체 구성도: [`infra/infrastructure.md §4`](./infrastructure.md)
> 평시 운영 / 장애 대응: [`infra/runbook.md`](./runbook.md)

---

## 전제조건

- Mac mini (Apple Silicon) 운영 호스트가 Tailscale 에 올라와 있고 SSH 로 접근 가능
- Cloudflare 계정 + 도메인이 Cloudflare NS 로 등록됨
- GitHub 계정 + 파생레포가 `Use this template` 으로 생성됨
- 본인 Supabase 프로젝트가 Seoul 리전으로 생성되어 있음 (`I-01`)
- NAS MinIO 가 기동 중 (`I-03`)

---

## 1. 파생레포 코드 준비

### 1.1 첫 앱 모듈 만들기
```bash
# 파생레포 로컬 clone 후
export DATABASE_URL='postgresql://postgres:<pw>@<supabase-host>:5432/postgres'  # Supabase 관리자 credential
./tools/new-app/new-app.sh <slug> --provision-db
```
결과: `apps/app-<slug>/` 디렉토리 + Supabase 에 `<slug>` schema & role 생성 + `.env` 에 placeholder 추가.

### 1.2 `.env` 채우기 (로컬 빌드/검증용, gitignored)
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

prod 프로파일로 로컬 smoke test 하려면 위 `.env` 가 전부 채워져 있어야 Spring property resolution 통과. 제일 편한 방식은 `--env-file` 로 일괄 주입:

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

> Note: dev 프로파일로 smoke test 하려면 `.env.docker` 의 `SPRING_PROFILES_ACTIVE=dev`. prod 는 관측성/시크릿 완전 채움을 요구하므로 기동 실패 시 `docker logs` 에서 어떤 `${VAR}` 가 resolve 안 됐는지 확인.

다른 터미널에서: `curl localhost:8080/actuator/health` → 200.

---

## 2. Mac mini 호스트 준비 (최초 1회)

### 2.1 OrbStack 설치 (Docker Desktop 대체 권장)
```bash
brew install --cask orbstack
```
Docker Desktop 이 이미 있다면 OrbStack 설치 후 Desktop 은 종료 — 메모리 350MB+ 절약.

### 2.2 GHA 전용 deploy SSH 키 생성
```bash
ssh-keygen -t ed25519 -f ~/.ssh/gha_deploy -C "gha-deploy@<파생레포>" -N ""
cat ~/.ssh/gha_deploy.pub >> ~/.ssh/authorized_keys
```
`~/.ssh/gha_deploy` (private) 내용을 GitHub Secret `SSH_PRIVATE_KEY` 로 등록 (아래 §3).

### 2.3 Cloudflare Tunnel 준비
```bash
# 설치 확인
which cloudflared || brew install cloudflared

# 새 tunnel (기존 tunnel 과 이름 충돌 없게)
cloudflared tunnel login    # 브라우저로 example.com 같은 zone 선택
cloudflared tunnel create <파생레포>-home
# → credentials 파일: ~/.cloudflared/<uuid>.json
```
config 파일 작성: `~/.cloudflared/<파생레포>.yml`
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
DNS 레코드:
```bash
cloudflared tunnel route dns <파생레포>-home server.<도메인>
cloudflared tunnel route dns <파생레포>-home log.<도메인>
```

### 2.4 Cloudflare Access 정책 — `log.<도메인>` 게이팅
Cloudflare 대시보드 → Zero Trust → Access → Applications → Add application:
- Type: Self-hosted
- Application domain: `log.<도메인>`
- Policy: Include → Emails → 본인 이메일
- Identity provider: One-time PIN (Free tier 기본)

### 2.5 관측성 스택 기동
```bash
# 파생레포를 Mac mini 에 clone 한 뒤
cd <파생레포>
docker compose -f infra/docker-compose.observability.yml up -d
```
확인: `curl localhost:3000` 하면 Grafana 로그인 화면.

### 2.6 cloudflared launchd 등록 (영속)
`~/Library/LaunchAgents/site.<파생레포>.cloudflared.plist` 작성:
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

### 3.1 Repository Variables (공개 가능한 구성값)
```bash
gh variable set DEPLOY_ENABLED --body 'true'
gh variable set KAMAL_SERVICE_NAME --body '<파생레포-slug>'
gh variable set DEPLOY_HOST --body '100.x.x.x'          # Mac mini Tailscale IP
gh variable set PUBLIC_HOSTNAME --body 'server.<도메인>'
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

Tailscale OAuth client 발급: Tailscale admin → Settings → OAuth clients → `Generate` (scope `devices:ci`, tag `tag:ci`).
GHCR 토큰은 `secrets.GITHUB_TOKEN` 자동 주입이라 별도 등록 불필요 (workflow `packages: write` permission 포함). ⚠️ 파생레포가 여러 개가 돼서 이미지를 공유 pull 해야 하는 구도가 되면 `secrets.GITHUB_TOKEN` 은 repo-scoped 라 pull 실패 가능 — 그때는 org-scoped `packages:read` PAT 를 `GHCR_TOKEN` secret 으로 추가 (decisions-infra.md I-09 재검토 트리거).

---

## 4. Kamal 초기 setup (최초 1회)

로컬에서 파생레포 루트 기준:
```bash
gem install kamal   # Ruby 3.2+ 필요
kamal setup         # SSH 로 Mac mini 에 붙어 docker 확인 + kamal-proxy 기동
```

주의: Mac mini 에 기존 nginx 가 `:80` 을 점유 중이라면 `kamal setup` 실패. 해결:
```bash
ssh storkspear@<tailscale-ip> 'brew services stop nginx; pkill -f "nginx.*worker" || true'
```

---

## 5. 첫 배포

자동: 파생레포 main 에 push → CI 성공 → `deploy` workflow 가 `workflow_run` 으로 자동 트리거.
- CI: `./gradlew build` (테스트 포함) → bootstrap jar 를 GHA artifact 로 업로드
- deploy: artifact 다운로드 → `Dockerfile.runtime` 으로 docker build/push (`ghcr.io/.../...:<sha>`) → `kamal deploy --skip-push` (kamal 이 빌드 안 하고 swap 만)
- 빌드 1회 (CI), 이미지 패키징 1회 (deploy) → 총 ~8분 billed (gradle 중복 제거)
- 옛 GHCR 이미지 자동 cleanup (최신 2개만 유지 → 500MB packages 한도 안전)

수동 (로컬, 첫 setup 또는 hotfix):
```bash
set -a; source .env; set +a
kamal deploy           # 기존 Dockerfile (multi-stage full build) 사용
```

성공 확인:
```bash
curl -sSf https://server.<도메인>/actuator/health/liveness    # 200
curl -I https://log.<도메인>                                   # 302 (CF Access 리다이렉트)
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

- [`infra/decisions-infra.md` I-09](./decisions-infra.md) — Kamal 선택 근거
- [`infra/runbook.md`](./runbook.md) — 평시 배포 / 롤백 / 장애 대응
- [`monitoring-setup.md`](../setup/monitoring-setup.md) — Grafana / Prometheus / Alertmanager 운영
- [`onboarding.md`](../../start/onboarding.md) — 새 개발자 첫 실행 (로컬 dev)
- [`storage-setup.md`](../setup/storage-setup.md) — MinIO 로컬/NAS

---

## 📖 책 목차 — Journey 7단계

[`journey/README.md`](../../onboarding/README.md) 의 **7단계 — 이제 use this template** 입니다. 파생 레포 첫 운영 배포.

| 방향 | 문서 | 한 줄 |
|---|---|---|
| ← 이전 | [`journey/dogfood-setup.md`](../../start/dogfood-setup.md) | 4~6단계, template 자체 검증 (셋업/테스트/정리) |
| → 다음 | [`journey/cross-repo-cherry-pick.md`](../../start/cross-repo-cherry-pick.md) | 같은 7단계, template 변경을 파생 레포로 가져오기 |

**막혔을 때**: [`journey/dogfood-pitfalls.md`](../../start/dogfood-pitfalls.md) (도그푸딩과 같은 함정 적용) / [`infra/runbook.md`](./runbook.md) (평시 운영 절차)
**왜 이렇게?**: [`infra/decisions-infra.md` I-09](./decisions-infra.md) (Kamal 선택) / [ADR-002 (GitHub Template Repository 패턴)](../../philosophy/adr-002-use-this-template.md)
