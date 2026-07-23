# 운영 키 발급 통합 가이드

> **유형**: How-to · **독자**: 운영자 · 첫 배포자 (Level 2) · **읽는 시간**: ~15분

**설계 근거**: [`ADR-007 · 솔로 친화적 운영`](../../philosophy/adr-007-solo-friendly-operations.md)

> 셋업 흐름: [`도그푸딩 환경 셋업 가이드`](../../start/dogfood-setup.md) — 전체 1·2회차 절차 안내
> 4-Stage 동기화: [`Secret Chain 4-Stage 동기화`](./secret-chain-4stage.md) — 발급한 키가 컨테이너에 주입되는 경로
> 키 교체 절차: [`키 교체 절차 (Key Rotation)`](./key-rotation.md) — 노출 또는 주기적 rotation 시 폐기·재발급
> 소셜 로그인 상세: [`소셜 로그인 설정 가이드`](../../start/social-auth-setup.md) — 앱별 4 provider 콘솔 화면 상세

---

## 1. 개요

운영 환경에서 쓰는 모든 외부 자격 증명을 한 곳에 모은 통합 가이드예요. 키마다 발급처가 다르고 권한 범위가 다르기 때문에, 어느 콘솔에서 어떤 권한을 골라야 하는지를 잊기 쉬워요. 이 문서가 그 단일 진입점이에요. 각 키마다 세 가지를 다뤄요 — 무엇에 쓰는지, 어디서 어떻게 발급하는지, `.env.prod` 의 어디에 채우는지.

이 가이드는 [`.env.prod.example`](../../../.env.prod.example) 의 주석을 보충하는 역할이에요. 주석은 `.env.prod` 를 직접 수정할 때 곁눈질로 보는 현장 메모이고, 이 문서는 발급 절차를 책상에서 따라가는 단계별 안내예요. 두 가지를 함께 펼쳐 놓고 채우면 됩니다.

키 발급에 익숙하지 않은 첫 배포자라면 [`도그푸딩 환경 셋업 가이드`](../../start/dogfood-setup.md) 를 먼저 한 번 훑은 뒤 이 문서로 돌아오는 흐름을 권장해요. 도그푸딩 가이드가 *언제 발급해야 하는지* 의 흐름을, 이 문서가 *무엇을 어떻게 발급하는지* 의 절차를 설명해요.

### 발급 매트릭스

| 분류 | 키 | 발급처 | 활성 조건 |
|---|---|---|---|
| 필수 — 앱 부팅 | `BASE_DOMAIN`, `SUBDOMAIN`, `APP_DOMAIN` | 도메인 등록 대행 (Cloudflare, Namecheap 등) | 항상 |
|  | `CLOUDFLARE_API_TOKEN` 외 3개 | dash.cloudflare.com | Tunnel 사용 시 (사실상 항상) |
|  | `JWT_SECRET` | `init-prod.sh` 자동 발급 | 항상 |
|  | `DB_URL`, `DB_USER`, `DB_PASSWORD` | Supabase, RDS, Fly Postgres 등 | 항상 |
| 필수 — 배포 | `GHCR_TOKEN` | github.com/settings/tokens | 항상 |
|  | `SSH_PRIVATE_KEY` | 로컬 `ssh-keygen` + 운영 서버 등록 | 항상 |
| 선택 — 기능별 | `APP_STORAGE_MINIO_*` | MinIO 콘솔, `mc admin user add` | `feature=storage` |
|  | `RESEND_*` | resend.com | `feature=email` |
|  | `COOLSMS_*` | solapi.com | `feature=sms`, `feature=phone-auth` |
|  | `APP_CREDENTIALS_<SLUG>_*` | Google, Apple, Kakao, Naver 콘솔 | `feature=social-auth` |
|  | `TS_OAUTH_*` | login.tailscale.com | `DEPLOY_ENABLED=true` 시 |
|  | `LOKI_URL` | Loki 호스트 (자체 또는 Grafana Cloud) | `feature=logging` |
|  | `DISCORD_WEBHOOK_URL` | Discord 채널 통합 | `feature=alertmanager` |
|  | `APP_PAYMENT_PORTONE_*` | portone.io 콘솔 | `feature=payment` |
|  | `APP_IAP_APPLE_*` | App Store Connect | `feature=iap` (iOS) |
|  | `APP_IAP_GOOGLE_*` | Google Cloud Console | `feature=iap` (Android) |
| 선택 — 배포 | `COSIGN_KEY_PATH`·`COSIGN_PASSWORD` | 로컬 `cosign generate-key-pair` | 로컬 배포 이미지 서명 opt-in 시 (§3.3) |

선택 키는 비워두면 해당 기능이 자동으로 비활성화되며 Spring 부팅에는 영향을 주지 않습니다 ([`ADR-034 · Feature Toggle Lite mode`](../../philosophy/adr-034-feature-toggle-lite-mode.md) 참조). 단 PortOne 은 *일부만* 채우면 부팅이 막히는 예외가 있어요. 자세한 가드 규칙은 §4.7 에 있어요.

---

## 2. 필수 — 앱 부팅 자격

### 2.1 도메인 — `BASE_DOMAIN`·`SUBDOMAIN`·`APP_DOMAIN`

**발급 목적**. 운영 백엔드의 외부 접근 주소예요. `BASE_DOMAIN` 과 `SUBDOMAIN` 을 분리한 이유는 한 사람이 여러 파생 레포를 운영할 때 같은 도메인을 재사용하기 위해서예요. 예를 들어 `example.com` 아래에 `api.example.com`·`admin.example.com`·`log.example.com` 을 각각 다른 레포로 운영하는 식이에요. `init-prod.sh` 가 두 값을 합쳐서 `APP_DOMAIN=https://${SUBDOMAIN}.${BASE_DOMAIN}` 을 자동으로 조립하므로 `APP_DOMAIN` 을 직접 채울 필요는 없어요.

**발급 절차**. 도메인은 어떤 등록 대행이든 가능해요. Cloudflare 에 등록해두면 다음 단계의 API Token 발급과 자연스럽게 이어져요. 도메인을 새로 사는 경우라면 Cloudflare 의 *Add a site* 메뉴에서 도메인을 추가하고 네임서버를 변경하는 절차까지 마쳐야 해요.

**`.env.prod` 채울 위치**:
```bash
BASE_DOMAIN=example.com
SUBDOMAIN=server
# APP_DOMAIN 은 비워둠 — init-prod.sh 가 https://server.example.com 으로 자동 조립
```

**검증**. `init-prod.sh` 1회차가 자동 조립한 `APP_DOMAIN` 값을 `.env.prod` 에서 확인하세요. 직접 채워야 한다면 그 값이 우선해요.

### 2.2 Cloudflare API Token + ID 4종

**발급 목적**. `init-prod.sh` 가 `${SUBDOMAIN}.${BASE_DOMAIN}` 의 DNS CNAME 과 Tunnel ingress 를 자동으로 등록하고 정리하기 위해 필요해요. Token 하나만 채우면 `ZONE_ID`·`ACCOUNT_ID`·`TUNNEL_ID` 는 `BASE_DOMAIN` 을 단서로 자동 추출돼요. Cloudflare Tunnel 을 쓰지 않고 IP 를 직접 노출해 운영한다면 이 절을 건너뛸 수 있지만, Mac mini 같은 가정용 회선 환경에서는 Tunnel 사용이 사실상 필수예요.

**발급 절차**.
1. [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) 에 접속해요.
2. *Create Token* → *Custom token* 으로 이동해요.
3. **Permissions** 에 다음 두 줄을 추가해요.
   - *Zone* → *DNS* → *Edit*
   - *Account* → *Cloudflare Tunnel* → *Edit*
4. **Zone Resources** 는 *Specific zone* 을 선택하고 본인의 `BASE_DOMAIN` 을 지정해요. *All zones* 로 두면 다른 사이트까지 접근 가능해져요.
5. *Continue to summary* → *Create token* 후 표시되는 토큰 값을 즉시 복사해요. 한 번만 표시돼요.

**`.env.prod` 채울 위치**:
```bash
CLOUDFLARE_API_TOKEN=<발급한 토큰 값>
# 나머지 3개는 비워두면 init-prod.sh 가 자동 추출
CLOUDFLARE_ZONE_ID=
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_TUNNEL_ID=
```

**검증**. `init-prod.sh` 2회차가 토큰으로 `ZONE_ID`·`ACCOUNT_ID`·`TUNNEL_ID` 를 자동 추출하고 결과를 표시해요 (Step 5.7). 추출이 실패하면 토큰 권한과 Zone Resources 설정을 다시 확인하세요.

### 2.3 JWT_SECRET

**발급 목적**. JWT 토큰의 서명과 검증에 쓰는 임의 시크릿이에요 ([`ADR-006 · HS256 JWT`](../../philosophy/adr-006-hs256-jwt.md) 참조). 이 값을 알면 임의의 사용자 토큰을 위조할 수 있으므로 절대 노출되어서는 안 됩니다.

**발급 절차**. 별도의 콘솔 발급이 필요 없어요. `init-prod.sh` 1회차가 `openssl rand -base64 64` 결과로 자동 생성해 `.env.prod` 에 채워줘요. 직접 만들고 싶다면 다음 명령을 쓰세요.

```bash
openssl rand -base64 64 | tr -d '\n'
```

**`.env.prod` 채울 위치**:
```bash
JWT_SECRET=<자동 생성값 또는 위 명령 결과>
```

**검증**. 운영 부팅 후 로그인 API 호출이 토큰을 정상 발급하면 동작 확인 완료예요.

### 2.4 DB 연결 정보

**발급 목적**. 운영 PostgreSQL 의 JDBC 연결 문자열·계정·비밀번호예요. Supabase·RDS·Fly Postgres 어느 것이든 가능하지만, 도그푸딩 단계에서는 무료 tier 가 충분한 Supabase 를 권장해요.

**Supabase 발급 절차**. 다른 호스팅을 쓴다면 해당 콘솔의 *Connection string* 메뉴에서 같은 값을 찾을 수 있어요.
1. [supabase.com](https://supabase.com) 에서 새 프로젝트를 만들어요. region 은 한국 사용자라면 *Northeast Asia (Seoul)* 또는 *Tokyo* 를 권장해요.
2. 프로젝트 생성 시 표시되는 *Database password* 를 즉시 복사해 안전한 곳에 저장해요. 재발급은 가능하지만 그 시점에 모든 클라이언트를 갱신해야 해요.
3. *Settings* → *Database* → *Connection string* → *Transaction pooler* 탭으로 이동해요.
4. 표시되는 PostgreSQL URI 를 JDBC 형식으로 분리해요 ([`도그푸딩 함정 #11`](../../start/dogfood-pitfalls.md) 참조).

원본 connection string 예시:
```
postgresql://postgres.sebqrqi...:[YOUR-PASSWORD]@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres
```

위 문자열에서 `jdbc:` prefix 를 붙이고 user 와 password 를 별도 변수로 분리해요.

**`.env.prod` 채울 위치**:
```bash
DB_URL=jdbc:postgresql://aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true
DB_USER=postgres.sebqrqi...
DB_PASSWORD=<2단계에서 복사한 Supabase password>
```

**Transaction pooler 를 쓰는 이유**. Supabase 의 Session pooler (port 5432) 는 클라이언트 하나가 서버 연결 하나를 점유하므로 connection 한도에 빠르게 도달해요. Transaction pooler (port 6543 + `?pgbouncer=true`) 는 연결을 multiplex 해 수십 개 앱까지 확장돼요. `init-prod.sh` 도 `DB_URL` 이 5432 면 경고를 띄우고 6543 을 권장해요. Flyway 는 코드가 자동으로 session-mode 로 derive 하니 신경 쓰지 않아도 돼요.

**비밀번호는 직접 채우세요**. `init-prod.sh` 1회차는 `DB_PASSWORD` 를 자동 발급하지 않아요. 외부 DB 가 발급한 비밀번호를 그대로 쓰는 설계라서, **반드시 Supabase 의 실제 비밀번호로 직접 채워야 합니다**. 비워두거나 placeholder 그대로 두면 운영 부팅 시 인증 실패로 차단돼요.

슬러그별 자격 (`<SLUG>_DB_URL` 같은 키) 은 도그푸딩 단계에서는 비워둬요. `AbstractAppDataSourceConfig` 의 `deriveSlugUrl` 이 `DB_URL` 에서 `currentSchema=<slug>` 부분만 자동으로 바꿔 끼우기 때문이에요 ([`도그푸딩 환경 셋업 §3.5`](../../start/dogfood-setup.md#슬러그별-datasource--slug_db_url-은-비워두세요) 참조).

**검증**. `verify-server.sh` Step 2 (DB 연결) 가 PASS 면 정상이에요. 운영 부팅 시 HikariCP 가 정상 연결되었음을 의미해요.

---

## 3. 필수 — 배포 파이프라인

### 3.1 GHCR_TOKEN — GitHub Personal Access Token (Classic)

**발급 목적**. 한 토큰이 다음 세 가지 용도를 모두 처리해요.
- GitHub Container Registry 에 docker 이미지를 push·pull 해요. `deploy.yml` 의 `KAMAL_REGISTRY_PASSWORD` 로 쓰여요.
- 이전 이미지를 정리해요 (`delete-package-versions` 액션).
- docs sync 시 다른 레포로 PR 을 자동 생성해요 (`sync-docs.yml`).

`GITHUB_TOKEN` 으로 첫 패키지를 만들 때 권한이 부족한 알려진 이슈 ([`도그푸딩 함정 #7`](../../start/dogfood-pitfalls.md)) 때문에 PAT 를 써요.

**발급 절차**.
1. [github.com/settings/tokens](https://github.com/settings/tokens) 로 이동해 *Generate new token* → *Generate new token (classic)* 을 선택해요. fine-grained 가 아닌 classic 이에요.
2. *Note* 에 식별 가능한 이름을 적어요 (예: `dogfood-server-factory`).
3. *Expiration* 은 90일을 권장해요. 만료가 임박하면 GitHub 가 이메일로 알려주므로 잊고 방치하지 않게 돼요.
4. **Scopes** 에서 다음 네 항목을 모두 체크해요.
   - `write:packages`
   - `read:packages`
   - `delete:packages`
   - `repo` — `write:packages` 가 의존하는 권한이며 docs sync PR 생성에도 필요해요
5. *Generate token* 을 누르고 표시되는 토큰을 즉시 복사해요. 한 번만 표시돼요.

**`.env.prod` 채울 위치**:
```bash
GHCR_TOKEN=ghp_<토큰 값>
GHCR_USERNAME=
# GitHub Actions 가 github.actor 로 자동 주입하므로 GHCR_USERNAME 은 보통 비워둠.
# 로컬에서 kamal 을 직접 실행할 때만 본인 GitHub 계정명을 채움.
```

**검증**. `init-prod.sh` 2회차가 PAT 로 GHCR 로그인을 시도하고, GHA 의 첫 deploy workflow 실행 시 push 가 성공하면 권한 설정이 정상이에요.

### 3.2 SSH_PRIVATE_KEY — 운영 서버 접근 키

**발급 목적**. Kamal deploy 가 운영 서버 (Mac mini 등) 에 SSH 로 접속해 컨테이너를 갱신할 때 쓰는 private key 예요. GHA runner 도 이 키를 통해 운영 서버에 도달해요.

**발급 절차**.
1. 로컬에서 새 ed25519 키를 발급해요. passphrase 는 없이 만들어요. Kamal 이 비대화형으로 사용하기 때문이에요.
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -C "deploy@$(hostname)" -N ""
   ```
2. 공개키 (`~/.ssh/deploy_key.pub`) 의 한 줄 내용을 운영 서버의 `~/.ssh/authorized_keys` 에 추가해요. Mac mini 라면 화면 공유나 직접 키보드로 다음과 같이 등록해요.
   ```bash
   mkdir -p ~/.ssh && chmod 700 ~/.ssh
   echo 'ssh-ed25519 AAAA... deploy@laptop' >> ~/.ssh/authorized_keys
   chmod 600 ~/.ssh/authorized_keys
   ```
3. 로컬에서 SSH 접속이 되는지 확인해요.
   ```bash
   ssh -i ~/.ssh/deploy_key <운영서버계정>@<운영서버IP> 'echo connected'
   ```

**`.env.prod` 채울 위치**. private key (`~/.ssh/deploy_key`) 의 **전체 내용** 을 BEGIN/END 라인까지 포함해 그대로 붙여넣어요. 줄바꿈이 깨지지 않도록 주의하세요.
```bash
SSH_PRIVATE_KEY=-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
... (전체 내용)
-----END OPENSSH PRIVATE KEY-----
```

`gh secret set` 이 다중행 값을 자동 처리하므로 `init-prod.sh` 가 큰 수정 없이 GitHub Secrets 로 push 해요.

**검증**. `verify-server.sh` Step 3 (SSH + Tailscale) 가 PASS 면 정상이에요.

### 3.3 cosign 이미지 서명 키쌍 (선택 — 로컬 배포 서명 opt-in)

**발급 목적**. 로컬 수동 배포 (`tools/deploy/deploy.sh`) 가 GHCR 에 push 한 이미지 digest 에 서명을 남기고, rollback 처럼 서버가 레지스트리에서 이미지를 **다시 받는** 경로에서 변조 여부를 검증하기 위한 키쌍이에요. GHA 의 CI keyless 서명과는 별개의 로컬 키입니다 ([`운영 런북 cosign 절`](../deploy/runbook.md#이미지-서명-검증-cosign) 참조). opt-in 이라 발급 전에는 서명·검증 모두 warn 후 skip 되고 배포에 영향이 없어요.

**발급 절차**.
1. cosign 을 설치해요.
   ```bash
   brew install cosign
   ```
2. **레포 밖** 디렉토리에서 키쌍을 생성해요. `COSIGN_PASSWORD` 를 미리 export 하면 프롬프트 없이 생성되고, 이 암호로 private key 파일이 암호화돼요.
   ```bash
   mkdir -p ~/.factory && cd ~/.factory
   cosign generate-key-pair      # 프롬프트에 키 암호 입력 → cosign.key + cosign.pub 생성
   ```
3. `cosign.key` (private) 는 **레포 밖 보관이 원칙**이에요 — `.env` 백업과 동일 취급. `deploy.sh` 의 기본 참조 경로가 `$HOME/.factory/cosign.key` 라서 위 위치 그대로 두면 추가 설정이 없어요. 다른 경로에 두면 `.env.prod` 의 `COSIGN_KEY_PATH` 로 지정해요. `.gitignore` 에 `cosign.key` 가 등재되어 있어 실수 커밋은 차단되지만, 애초에 워킹트리 안에 두지 마세요. 백업은 `_env-backup-*` 폴더 관행처럼 레포 밖 백업 폴더에 사본으로 보관해요 (분실 시 재발급 + `cosign.pub` 재커밋이 필요할 뿐, 기존 서명이 깨지지는 않아요).
4. `cosign.pub` (public) 은 **레포 루트에 커밋**해요. `deploy.sh` 의 rollback 검증이 이 경로를 참조합니다. 공개키라 커밋해도 안전해요. (템플릿 레포에는 placeholder 를 커밋하지 않아요 — 파생 레포에서 본인 키를 생성해 커밋하는 파일이에요.)
   ```bash
   cp ~/.factory/cosign.pub <repo-root>/cosign.pub
   git add cosign.pub && git commit -m "chore(deploy): cosign 서명 공개키 등록"
   ```

**`.env.prod` 채울 위치** (둘 다 optional — 주석 해제 후 사용):
```bash
# 기본 경로($HOME/.factory/cosign.key)를 쓰면 COSIGN_KEY_PATH 는 생략 가능
COSIGN_KEY_PATH=<cosign.key 절대경로>
COSIGN_PASSWORD=<generate-key-pair 때 설정한 키 암호>
```

`COSIGN_PASSWORD` 를 비워두면 서명 시점에 cosign 이 대화형으로 물어봐요. `deploy.sh` 는 원래 대화형 스크립트라 그대로 둬도 됩니다. 두 값 모두 컨테이너 ENV 로 주입되지 않고 GitHub Secrets push 대상도 아니에요 — 로컬 배포 머신에서만 쓰는 값이에요.

**검증**. 서명이 붙은 배포를 1회 실행한 뒤 (`<repo> prod deploy` 출력에 `cosign 서명 완료` 확인), 다음 명령이 PASS 하면 정상이에요.
```bash
cosign verify --key cosign.pub ghcr.io/<owner>/<repo>:<배포 SHA>
```

교체 주기는 연 1회를 권장해요 — [`키 교체 절차`](./key-rotation.md) 의 cosign 절 참조.

---

## 4. 선택 — 기능별 자격 증명

이 절의 키들은 비워두면 해당 기능이 자동으로 비활성화돼요. 운영 부팅에는 영향을 주지 않으므로 지금 필요한 기능만 채우고 나머지는 나중에 채워도 됩니다. 단 PortOne 만은 *일부만* 채우면 부팅이 막히는 예외라서 §4.7 을 꼭 확인하세요.

### 4.1 MinIO / S3 호환 스토리지 (`feature=storage`)

**발급 목적**. 사용자 업로드 파일·리포트·이미지 등을 영속화하기 위한 객체 스토리지 자격이에요. 비워두면 `InMemoryStorageAdapter` 로 fallback 되어 컨테이너 재시작 시 데이터가 사라져요. 도그푸딩 단계에서는 일부러 비워둘 수도 있지만 운영 단계에서는 반드시 채워야 해요.

**발급 절차**. 운영 MinIO 인스턴스의 콘솔에서 별도의 access key 를 발급해요. root credential 을 직접 쓰는 건 권장하지 않아요.
1. MinIO 콘솔에서 *Identity* → *Users* → *Create User* 또는 *Service Account* 를 선택해요.
2. CLI 로 만들고 싶다면 다음 명령을 써요.
   ```bash
   mc admin user add <alias> <newkey> <newsecret>
   mc admin policy attach <alias> readwrite --user=<newkey>
   ```
3. 발급한 access key·secret key·endpoint URL 을 기록해요.
4. 운영 bucket 을 생성해요. `APP_STORAGE_MINIO_BUCKETS_<N>` 의 인덱스를 0 부터 순차로 부여하며, `BucketProvisioner` 가 부팅 시 자동 생성하므로 콘솔에서 미리 만들 필요는 없어요 ([`스토리지 버킷 격리`](./storage-bucket-isolation.md) 참조).

**`.env.prod` 채울 위치**:
```bash
APP_STORAGE_MINIO_ENDPOINT=http://<NAS_TAILSCALE_IP>:9000   # http — TLS 는 tailnet WireGuard 암호화가 대체
APP_STORAGE_MINIO_ACCESS_KEY=<발급한 access key>
APP_STORAGE_MINIO_SECRET_KEY=<발급한 secret key>
APP_STORAGE_MINIO_BUCKETS_0=<bucket 이름 (예: server-factory-default)>
```

**검증**. `verify-server.sh` Step 4 (MinIO 업로드) 가 PASS 면 정상이에요. PUT·STAT·DEL 세 동작을 테스트 객체로 검증해요.

운영 MinIO 호스팅 (Mac mini 의 시놀로지 NAS 등) 셋업은 [`스토리지 셋업 가이드`](./storage-setup.md) 를 참조하세요. 이 통합 가이드는 키 발급만 다뤄요.

### 4.2 Resend 트랜잭셔널 이메일 (`feature=email`)

**발급 목적**. 회원가입 인증·비밀번호 재설정·구독 만료 알림 메일을 사용자에게 발송하기 위한 자격이에요. 비워두면 `LoggingEmailAdapter` 로 fallback 되어 메일이 콘솔 로그로만 출력돼요. **회원가입을 받는 서비스라면 운영에서 반드시 채워야 합니다.** 그렇지 않으면 사용자가 인증 메일을 받지 못해요.

**발급 절차**.
1. [resend.com](https://resend.com) 에 가입해요. 무료 tier 가 하루 100통이에요.
2. *Domains* 메뉴에서 발신할 도메인을 추가하고 SPF·DKIM 레코드를 도메인 DNS 에 등록해요. Cloudflare 를 쓴다면 *Add records* 로 자동 적용할 수 있어요.
3. 도메인 검증이 *Verified* 로 표시될 때까지 기다려요. 보통 수 분에서 수 시간 걸려요.
4. *API Keys* 메뉴에서 *Create API Key* → *Full access* 를 선택해 키를 발급해요. 키는 `re_` 로 시작하며 한 번만 표시되므로 즉시 복사해요.

**`.env.prod` 채울 위치**:
```bash
RESEND_API_KEY=re_<발급한 키>
RESEND_FROM_ADDRESS=noreply@<검증한 도메인>
RESEND_FROM_NAME=<발신인 표시명 (예: ServerFactory)>
RESEND_TEST_ADMIN_USER_EMAIL=<verify-server.sh 검증 시 받을 관리자 메일 주소>
```

`RESEND_TEST_ADMIN_USER_EMAIL` 은 `verify-server.sh` 의 이메일 검증 단계에서만 쓰이며 컨테이너 ENV 로는 주입되지 않아요. 비워두면 검증 단계만 건너뛰어요.

**검증**. `verify-server.sh` Step 5 (Email 발송) 가 PASS 면 정상이에요. `RESEND_TEST_ADMIN_USER_EMAIL` 로 실제 메일이 도착했는지 함께 확인하세요.

### 4.3 소셜 로그인 (`feature=social-auth`)

**발급 목적**. Google·Apple·Kakao·Naver 네 provider 의 OAuth 자격 증명이에요. 앱 슬러그별로 따로 발급해야 하므로 ([`ADR-012 · 앱별 독립 유저 모델`](../../philosophy/adr-012-per-app-user-model.md) 참조) 키 이름이 `APP_CREDENTIALS_<SLUG>_<PROVIDER>_<KEY>` 형태로 동적이에요.

**발급 절차**. 네 provider 의 콘솔 화면 캡처, Bundle ID·SHA-1 인증서 지문 같은 디테일이 길어서 별도 가이드로 분리되어 있어요.

→ **자세한 발급 절차**: [`소셜 로그인 설정 가이드`](../../start/social-auth-setup.md)

각 provider 의 콘솔 단계, `.env.prod` 키 매핑, dev-mock 모드를 모두 그곳에서 다뤄요. 이 통합 가이드는 전체 그림에서 소셜 로그인의 위치만 표시해요.

**`.env.prod` 채울 위치** (슬러그가 `mynewapp` 인 경우):
```bash
APP_CREDENTIALS_MYNEWAPP_GOOGLE_CLIENT_IDS_0=<iOS Client ID>
APP_CREDENTIALS_MYNEWAPP_GOOGLE_CLIENT_IDS_1=<Android Client ID>
APP_CREDENTIALS_MYNEWAPP_APPLE_BUNDLE_ID=com.example.mynewapp
APP_CREDENTIALS_MYNEWAPP_KAKAO_APP_ID=<숫자>
APP_CREDENTIALS_MYNEWAPP_NAVER_CLIENT_ID=<문자열>
```

**검증**. 프론트에서 각 provider 의 로그인 버튼을 눌렀을 때 백엔드가 JWT 를 정상 발급하면 동작 확인 완료예요. 키 발급 전에는 [`소셜 로그인 설정 가이드`](../../start/social-auth-setup.md) 의 dev-mock 모드로 e2e 흐름을 미리 시연할 수 있어요.

### 4.4 Tailscale OAuth (`DEPLOY_ENABLED=true` 시 필수)

**발급 목적**. GHA runner (GitHub 의 ubuntu VM) 가 운영 Mac mini (Tailnet 사설 IP `100.x.x.x`) 에 도달하려면, 매 배포마다 일회성 ephemeral device 로 tailnet 에 join 해야 해요. 그때 쓰는 자격이에요. 운영 서버를 Tailscale 로 접근하지 않는다면 이 절을 건너뛸 수 있어요.

**발급 절차**.
1. ACL 의 `tagOwners` 를 먼저 정의해요. 한 번만 하면 돼요. [login.tailscale.com/admin/acls/file](https://login.tailscale.com/admin/acls/file) 의 HuJSON 편집기에서 다음을 추가해요.
   ```hujson
   "tagOwners": {
       "tag:ci": ["autogroup:admin"],
   },
   ```
2. *Save* 를 눌러요. 이 단계를 빠뜨리면 다음 OAuth 발급 화면에서 *Add tags* 드롭다운이 비활성화되어 `tag:ci` 를 부여할 수 없어요.
3. [login.tailscale.com/admin/settings/oauth](https://login.tailscale.com/admin/settings/oauth) → *Generate OAuth client* 로 이동해요.
4. *Custom scopes* 를 선택하고 다음 두 권한을 모두 체크해요. 둘 중 하나라도 빠지면 403 이 떠요 ([`도그푸딩 함정 #4`](../../start/dogfood-pitfalls.md)).
   - *Devices* → *Core* → *Write* 에 tags `tag:ci`
   - *Keys* → *Auth Keys* → *Write* 에 tags `tag:ci`
5. 다른 scope (Posture, Routes, OAuth Keys 등) 는 모두 체크 해제해요.
6. *Generate credential* 을 누르고 표시되는 Client ID 와 Secret 을 즉시 복사해요.

**`.env.prod` 채울 위치**:
```bash
TS_OAUTH_CLIENT_ID=<발급한 Client ID>
TS_OAUTH_SECRET=<발급한 Secret>
DEPLOY_HOST=100.X.X.X     # Mac mini 의 Tailnet IP (Variables 영역)
DEPLOY_SSH_USER=<Mac mini 계정명>
```

**검증**. `verify-server.sh` Step 3 (SSH + Tailscale) 가 PASS 면 정상이에요. GHA deploy workflow 가 ephemeral device 로 join → SSH → exit 흐름을 자동으로 수행해요.

### 4.5 Loki 로그 endpoint (`feature=logging`)

**발급 목적**. 운영 Spring 컨테이너의 로그를 Loki 로 전송하기 위한 endpoint URL 이에요. 비워두면 default `http://loki:3100/loki/api/v1/push` 가 쓰여요. Mac mini 의 Kamal docker network 안에서 `loki` 컨테이너 호스트명으로 접근하는 운영 권장값이라, 비워둬도 정상 동작해요.

**발급 절차**.
- **자체 호스팅 Loki**. 별도 발급이 없어요. `infra/docker-compose.observability.yml` 로 Mac mini 에 Loki 컨테이너를 기동하면 컨테이너 호스트명 `loki` 가 자동으로 잡혀요 ([`운영 모니터링 셋업 가이드`](./monitoring-setup.md) 참조).
- **Grafana Cloud Loki**. [grafana.com/products/cloud](https://grafana.com/products/cloud/) 에서 무료 tier (월 50 GB) 에 가입한 뒤, *Loki* → *Send Logs* → *Loki API endpoint* 의 full URL 과 username·password 를 기록해요.

**`.env.prod` 채울 위치**:
```bash
# 자체 호스팅이라면 비워둠 (default 가 동작)
LOKI_URL=

# Grafana Cloud Loki 사용 시
LOKI_URL=https://logs-prod-XXX.grafana.net/loki/api/v1/push
```

Grafana Cloud 를 쓸 때는 basic auth 를 별도 환경변수로 추가해야 해요. 현재 `.env.prod.example` 에는 노출되어 있지 않아요. 자체 호스팅을 우선 가정하기 때문이에요.

**검증**. `verify-server.sh` Step 6 (Loki readiness) 가 PASS 면 정상이며, Grafana 에서 `{job="spring"}` 쿼리로 실제 로그가 흘러들어오는지 확인하세요.

### 4.6 Discord Webhook (`feature=alertmanager`)

**발급 목적**. Prometheus 알람을 Discord 채널로 발송하기 위한 webhook URL 이에요. 비워두면 알람은 Alertmanager 에서 동작하지만 외부로 발송되지는 않아요.

**발급 절차**.
1. Discord 서버에서 알림을 받을 채널을 고르고 채널 설정 → *연동* → *웹후크* → *새 웹후크* 를 선택해요.
2. webhook 이름을 적당히 정하고 *URL 복사* 를 눌러 URL 을 기록해요.
3. URL 끝에 `/slack` 을 붙여요. Discord 의 Slack 호환 endpoint 를 Alertmanager 가 쓰기 때문이에요. 예를 들면 `https://discord.com/api/webhooks/<id>/<token>/slack` 형태가 돼요.

**`.env.prod` 채울 위치**:
```bash
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/<id>/<token>/slack
```

**검증**. Alertmanager 컨테이너의 `/api/v2/status` 가 정상 응답하고 (`verify-server.sh` Step 7), Prometheus 에서 임의 알람을 수동으로 발화시켜 Discord 채널에 메시지가 도착하는지 확인하세요.

### 4.7 PortOne PG 결제 (`feature=payment`)

**발급 목적**. 외부 PG (한국형 — 나이스·토스·이니시스 등) 결제를 PortOne 통합 콘솔로 처리하기 위한 자격이에요. PortOne 의 v1·v2 키와 가맹점 식별 코드는 한 콘솔에서 발급돼요 ([`ADR-019 · billing/iap/payment 분리`](../../philosophy/adr-019-billing-iap-payment-separation.md) 참조). webhook secret 은 결이 조금 달라요. 아래 발급 절차 4번에서 설명해요.

**발급 절차**.
1. [portone.io](https://portone.io) 에 가입한 뒤 콘솔에 로그인해요.
2. *상점 정보* → *가맹점 등록* 을 마쳐요. 사업자 등록증과 통신판매업 신고증이 필요해요.
3. *결제 연동* → *채널* 메뉴에서 쓸 PG 채널 (나이스·토스·이니시스 등) 을 활성화해요. 운영 활성화 전에는 PortOne 측 검수 단계가 있어 며칠 걸릴 수 있어요.
4. *API 키* 메뉴에서 다음 값을 발급·복사해요.
   - v1 API Key 와 Secret — legacy 호환용
   - v2 API Key — 신규 API 호출용
   - 가맹점 식별 코드 (Customer Code)
5. **webhook secret 은 `init-prod.sh` 가 자동 발급해요.** 사용자가 콘솔에서 따로 발급하는 값이 아니에요. `init-prod.sh` 1회차가 random 32자를 생성해 `APP_PAYMENT_PORTONE_WEBHOOK_SECRET` 에 채워주면, 그 값을 PortOne 콘솔의 *Webhook* 메뉴에 가서 webhook secret 입력란에 그대로 붙여넣어요. webhook URL 은 `https://<APP_DOMAIN>/api/apps/<slug>/payment/webhook` 형식으로 등록해요 (payment 엔드포인트는 앱 slug 경로 아래에 있어요 — `/api/payment/webhook` 으로 등록하면 전부 404 가 납니다).

**`.env.prod` 채울 위치**:
```bash
APP_PAYMENT_PORTONE_API_URL=https://api.iamport.kr   # v1 base URL (비우면 코드 default 동일)
APP_PAYMENT_PORTONE_API_V1_KEY=<v1 키>
APP_PAYMENT_PORTONE_API_V1_SECRET=<v1 시크릿>
APP_PAYMENT_PORTONE_API_V2_KEY=<v2 키>
APP_PAYMENT_PORTONE_CUSTOMER_CODE=<가맹점 식별 코드>
APP_PAYMENT_PORTONE_WEBHOOK_SECRET=<init-prod.sh 자동 생성값>
```

webhook timestamp 허용 오차는 코드 default 가 300초 (5분) 라서 별도 키를 두지 않아요.

**결제 가드 — 셋 다 비우거나 셋 다 채우거나**. prod profile 의 `PortOneProdConfigGuard` 는 v1 key·v1 secret·webhook secret 세 값을 다음 규칙으로 검사해요.

| 상태 | 부팅 | 동작 |
|---|---|---|
| 셋 다 비어 있음 | 통과 | `StubPaymentAdapter` fallback. 결제 호출 시점에만 graceful 503 (`PAY_008`) |
| 셋 다 채워짐 | 통과 | 실제 `PortOneAdapter` 활성 |
| 일부만 채워짐 | **차단** | `IllegalStateException` — webhook 위조 위험 / 키 누락 방지 |

결제를 쓰지 않는 도그푸딩 단계라면 세 값을 모두 비워두면 돼요. 부팅은 통과하고 결제 호출만 stub 으로 응답해요. 더미값 세 개를 채워도 같은 stub 으로 동작하지만, 굳이 채울 필요는 없어요. 결제 모듈 자체를 끄고 싶으면 `APP_FEATURES_PAYMENT=false` (Lite 모드, ADR-034) 를 쓰면 돼요. **막히는 건 "일부만 채운" 상태뿐이에요.**

→ 코드 근거: `core/core-payment-impl/.../PaymentAutoConfiguration.java` 의 `portOneProdConfigGuard`

**검증**. 운영 부팅 로그에 `PortOneProdConfigGuard` 통과 메시지가 보이고, 실제 결제가 발생하는 시점에 PortOne 콘솔의 *결제 내역* 메뉴에서 호출이 기록되는지 확인하세요.

### 4.8 Apple StoreKit (`feature=iap`, iOS)

**발급 목적**. iOS 인앱 결제를 서버에서 검증하기 위한 App Store Server API 자격이에요. Apple 한 계정에 대해 글로벌 키를 한 벌만 발급하면 모든 슬러그·앱이 공유해요. Bundle ID 만 슬러그별로 분리돼요 ([`ADR-022 · IAP server notifications`](../../philosophy/adr-022-iap-server-notifications.md) 참조).

**발급 절차**.
1. [appstoreconnect.apple.com](https://appstoreconnect.apple.com) 에 로그인해요.
2. *Users and Access* → *Integrations* → *App Store Connect API* 로 이동해요.
3. *Keys* 탭에서 *Generate API Key* (또는 *+* 버튼) 를 눌러요.
4. *Name* 에 식별 가능한 이름을 적고 *Access* 를 *App Manager* 또는 그 이상으로 설정해요.
5. *Generate* 후 표시되는 `.p8` 파일을 즉시 다운로드해요. 한 번만 다운로드할 수 있어요. 이 파일이 `APP_IAP_APPLE_PRIVATE_KEY` 의 원본이에요.
6. 같은 화면에서 *Key ID* 와 *Issuer ID* 를 기록해요.

**`.env.prod` 채울 위치**:
```bash
APP_IAP_APPLE_API_URL=https://api.storekit.itunes.apple.com   # production
APP_IAP_APPLE_KEY_ID=<Key ID (10자 영숫자)>
APP_IAP_APPLE_ISSUER_ID=<Issuer ID (UUID 형태)>
APP_IAP_APPLE_ENVIRONMENT=Production   # 참고용 라벨 (서버 동작에는 영향 없음)

# .p8 파일의 BEGIN/END 라인까지 포함한 전체 내용을 그대로 붙여넣음
APP_IAP_APPLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMG...
-----END PRIVATE KEY-----
```

Bundle ID 는 슬러그별 키로 분리돼요.
```bash
APP_CREDENTIALS_MYNEWAPP_IAP_APPLE_BUNDLE_ID=com.example.mynewapp
```

dev-mock 키 (`APP_IAP_APPLE_DEV_MOCK`) 는 운영 `.env.prod` 에 두지 않아요. 코드 default 가 false 이고 dev profile 에서만 의미가 있어요. 이 키가 true 면 cert chain 과 signature 검증을 우회하므로 운영에서는 절대 켜지 않아요.

**검증**. 실제 iOS 빌드에서 인앱 구매를 수행하고 백엔드의 `/iap/apple/verify` 엔드포인트가 200 을 응답하는지 확인하세요.

### 4.9 Google Play Developer API (`feature=iap`, Android)

**발급 목적**. Android 인앱 결제를 서버에서 검증하기 위한 Google Cloud Service Account 자격이에요. Apple 과 마찬가지로 글로벌 자격 한 벌이 모든 슬러그를 커버하며, package name 만 슬러그별로 분리돼요.

**발급 절차**.
1. [console.cloud.google.com](https://console.cloud.google.com) 에서 프로젝트를 선택하거나 새로 만들어요. 소셜 로그인용 `app-factory` 프로젝트를 재사용하길 권장해요.
2. *IAM & Admin* → *Service Accounts* → *Create Service Account* 로 이동해요.
3. 이름을 정하고 (예: `play-iap-verifier`) 역할은 빈 채로 *Done* 을 눌러요.
4. 생성된 service account 의 *Keys* 탭에서 *Add Key* → *JSON* 을 선택해 JSON 파일을 다운로드해요. 한 번만 다운로드할 수 있어요.
5. [play.google.com/console](https://play.google.com/console) 에서 *Settings* → *API Access* 로 가서 위 service account 를 연결하고 *Grant Access* 에서 *View financial data* 권한을 부여해요.

**`.env.prod` 채울 위치**:
```bash
APP_IAP_GOOGLE_API_URL=https://androidpublisher.googleapis.com
# JSON 파일 전체 내용을 한 줄로 변환 (jq -c . < key.json) 또는 multi-line 그대로
APP_IAP_GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...", ...}
```

Package name 은 슬러그별 키로 분리돼요.
```bash
APP_CREDENTIALS_MYNEWAPP_IAP_GOOGLE_PACKAGE_NAME=com.example.mynewapp
```

**Pub/Sub push 검증 (RTDN webhook)**. Google Play 의 실시간 알림을 받으려면 Cloud Pub/Sub topic 과 subscription 을 추가로 발급해야 해요.
1. Cloud Console 에서 *Pub/Sub* → *Create Topic* 으로 topic 을 만들어요 (예: `play-rtdn`).
2. Play Console 에서 *Settings* → *Real-time developer notifications* 로 가서 위 topic 을 선택해요.
3. Cloud Console 에서 해당 topic 의 *Create Subscription* → *Push* 로 가서 endpoint 에 `https://<APP_DOMAIN>/api/apps/<slug>/iap/google/webhook` 을 입력해요. 슬러그별로 별도 subscription 을 만들어요.
4. Subscription 생성 시 *Authentication* 에서 service account 를 선택해요. 그 service account 의 email 이 `APP_IAP_GOOGLE_WEBHOOK_ALLOWED_SERVICE_ACCOUNT_EMAILS` 값이에요.

```bash
APP_IAP_GOOGLE_WEBHOOK_AUDIENCE=https://<APP_DOMAIN>/api/apps/<slug>/iap/google/webhook
APP_IAP_GOOGLE_WEBHOOK_ALLOWED_SERVICE_ACCOUNT_EMAILS=pubsub-push@my-project.iam.gserviceaccount.com
```

webhook 토큰 검증 (`APP_IAP_GOOGLE_WEBHOOK_VERIFY_TOKEN`) 키는 운영 `.env.prod` 에 두지 않아요. `ProdSafetyEnvironmentPostProcessor` 가 prod profile 에서 코드로 true 를 강제하기 때문이에요. 사용자가 `.env.prod` 에 false 를 박아도 무시돼요. `audience` 는 Pub/Sub push subscription 에 등록한 endpoint URL 과 정확히 일치해야 해요.

**검증**. 실제 Android 빌드에서 인앱 구매를 수행하고 백엔드의 `/iap/google/verify` 엔드포인트가 200 을 응답하며, RTDN webhook 으로 갱신·환불 알림이 정상 처리되는지 확인하세요.

### 4.10 CoolSMS / SOLAPI 문자 발송 (`feature=sms`, `feature=phone-auth`)

**발급 목적**. 휴대폰 점유인증 (SMS OTP) 발송과 운영 알림 문자를 위한 SOLAPI (CoolSMS) 자격이에요. 비워두면 `LoggingSmsAdapter` 로 fallback 되어 OTP 가 콘솔 로그로만 출력돼요. **점유인증으로 가입·로그인을 받는 서비스라면 운영에서 반드시 채워야 합니다.** 그렇지 않으면 사용자가 인증번호를 받지 못해요. 운영에서 발신사가 미설정이면 OTP 발송 시점에 `OTP_SMS_UNAVAILABLE` 로 차단돼요. 점유인증 도메인 동작 상세는 [`Phone Auth (점유인증) & SMS`](../../api-and-functional/functional/phone-auth-and-sms.md) 를 참조하세요.

**발급 절차**.
1. [solapi.com](https://solapi.com) 에 가입한 뒤 콘솔에 로그인해요. SOLAPI 가 CoolSMS 를 운영하는 통합 콘솔이에요.
2. *API Key 관리* 메뉴에서 *API Key 생성* 으로 `apiKey` (예: `NCS...`) 와 `apiSecret` 한 쌍을 발급해요. `apiSecret` 은 발급 시 한 번만 표시되므로 즉시 복사해요.
3. *발신번호 관리* 메뉴에서 문자를 보낼 **발신번호를 등록**해요. 통신사 정책상 사전 등록되지 않은 번호로는 발송이 안 돼요.
   - 본인 명의 휴대폰·유선번호는 본인인증 (ARS 또는 문자) 으로 즉시 등록돼요.
   - 사업자·법인 번호는 통신서비스 가입증명원 등 서류를 제출한 뒤 검수를 거쳐요. 보통 영업일 기준 1~2일 걸려요.
4. 등록 완료된 발신번호를 국내형 (`01012345678`) 으로 기록해요. 어댑터가 E.164 (`+8210…`) 수신번호를 국내형으로 자동 변환하지만, 발신번호 (`COOLSMS_FROM`) 는 등록한 형식 그대로 채워요.

**`.env.prod` 채울 위치**:
```bash
COOLSMS_API_KEY=<발급한 API Key>
COOLSMS_API_SECRET=<발급한 API Secret>
COOLSMS_FROM=01012345678          # SOLAPI 에 사전등록한 발신번호 (국내형)
# COOLSMS_API_URL 은 비워둠 — 미설정 시 운영 SOLAPI 엔드포인트로 자동 보정.
#                  (dev/local 도그푸딩은 WireMock 으로 override 해 실 발송·과금 없이 검증)
```

`COOLSMS_API_KEY` 와 `COOLSMS_API_SECRET` 이 **둘 다** 채워져야 `CoolSmsAdapter` (실 발송) 가 등록돼요. 하나라도 비면 `core-email` 과 동일하게 fallback 어댑터로 내려가요. dev 단계에서는 일부러 비워둬도 무방하며, 이때 OTP 는 콘솔 로그 (`[DEV-SMS]`) 로 확인해요.

**검증**. 운영 부팅 로그에 `CoolSmsAdapter registered — SMS will be delivered via SOLAPI(CoolSMS) API.` 가 보이고, 점유인증 `request` 호출 후 실제 휴대폰으로 인증번호 문자가 도착하는지 확인하세요. dev 에서는 `LoggingSmsAdapter` 의 `[DEV-SMS]` WARN 로그에 OTP 가 캡처돼요.

---

## 5. 발급 후 — 4-Stage 동기화

`.env.prod` 채우기는 발급한 키가 컨테이너에 도달하는 4 단계 중 첫 번째일 뿐이에요. 새 키를 추가했다면 나머지 3 단계를 함께 갱신해야 부팅 시 주입돼요.

→ **상세 절차**: [`Secret Chain 4-Stage 동기화`](./secret-chain-4stage.md)

`init-prod.sh` 가 `.env.prod` 에서 GitHub Secrets 까지는 자동으로 처리하지만, `config/deploy.yml` 의 `env.secret:` 목록, `.kamal/secrets.example` 의 `KEY=$VAR` 매핑, `.github/workflows/deploy.yml` 의 `env:` 블록은 현재 수동이에요 ([`도그푸딩 FAQ Q17`](../../start/dogfood-faq.md#q17) 참조).

---

## 6. 노출 시 즉시 폐기

이 가이드의 절차대로 발급한 키들이 **노출되었다면** (채팅·public commit·로그 출력 등 어떤 경로로든 평문이 외부에 보였다면) 즉시 폐기·재발급해야 합니다.

→ **상세 절차**: [`키 교체 절차 (Key Rotation)`](./key-rotation.md)

각 키 종류별 폐기 위치와, 재발급 후 `init-prod.sh` 재실행으로 GitHub Secrets 를 갱신하는 흐름을 그곳에서 다뤄요.

---

## 7. 트러블슈팅

발급한 키가 동작하지 않을 때 자주 만나는 케이스를 모았어요.

### 부팅 시 PortOne `IllegalStateException`

**원인**. `APP_PAYMENT_PORTONE_API_V1_KEY`·`_API_V1_SECRET`·`_WEBHOOK_SECRET` 중 *일부만* 채워졌어요. 가드는 셋 다 비거나 셋 다 채운 상태만 허용해요.

**조치**. 결제를 쓰지 않는 단계라면 세 값을 모두 비우세요 (`StubPaymentAdapter` fallback). 결제를 쓴다면 셋을 모두 채우세요. §4.7 의 가드 표를 참고하세요.

### Cloudflare Tunnel 에 `${SUBDOMAIN}.${BASE_DOMAIN}` 이 라우팅되지 않음

**원인**. 토큰의 *Zone Resources* 가 *Specific zone* 인데 본인 도메인이 누락되었거나, 권한이 *DNS Edit* 만 있고 *Cloudflare Tunnel Edit* 가 빠졌어요.

**조치**. Cloudflare 의 토큰 편집 화면에서 권한 두 줄과 Zone Resources 를 다시 확인하세요 (§2.2 참조).

### `gh secret set GHCR_TOKEN` 이 *Bad credentials* 응답

**원인**. PAT 가 fine-grained 로 발급되었거나 `repo` scope 가 빠졌어요.

**조치**. PAT 를 classic 으로 다시 발급하고 §3.1 의 네 가지 scope 를 모두 체크하세요.

### Resend API 가 `domain not verified` 응답

**원인**. SPF·DKIM 레코드가 도메인 DNS 에 등록되지 않았거나 propagation 이 끝나지 않았어요.

**조치**. Resend 콘솔의 *Domains* 에서 *Verify* 가 녹색이 될 때까지 기다리세요. 몇 분에서 몇 시간 걸려요. Cloudflare 를 쓴다면 *Proxy status* 를 *DNS only* 로 두어야 propagation 이 빨라요.

### Apple `.p8` private key 가 인식되지 않음

**원인**. `.p8` 파일 내용을 환경변수로 옮길 때 줄바꿈이 사라져 한 줄로 합쳐졌어요.

**조치**. multi-line 변수로 BEGIN/END 라인까지 포함해 그대로 붙여넣고, `init-prod.sh` 가 `gh secret set` 으로 push 한 결과를 GitHub Secrets 화면에서 다시 다운로드해 검증하세요.

---

## 다음 단계

- 발급한 자격으로 첫 운영 배포를 진행하려면 [`도그푸딩 환경 셋업 가이드`](../../start/dogfood-setup.md) 의 `init-prod.sh` 2회차로 돌아가세요.
- 4-Stage 동기화 누락을 방지하려면 [`Secret Chain 4-Stage 동기화`](./secret-chain-4stage.md) 의 체크리스트를 참조하세요.
- 운영 중 키 노출이 의심되면 [`키 교체 절차 (Key Rotation)`](./key-rotation.md) 의 즉시 폐기 절차를 따르세요.

---

## 관련 문서

- [`.env.prod.example`](../../../.env.prod.example) — 키별 짧은 주석 (현장 메모)
- [`도그푸딩 환경 셋업 가이드`](../../start/dogfood-setup.md) — 전체 1·2회차 흐름 (이 문서가 그 보충 가이드)
- [`소셜 로그인 설정 가이드`](../../start/social-auth-setup.md) — Google·Apple·Kakao·Naver 4 provider 콘솔 단계 상세
- [`Secret Chain 4-Stage 동기화`](./secret-chain-4stage.md) — 발급한 키가 컨테이너로 주입되는 경로
- [`키 교체 절차 (Key Rotation)`](./key-rotation.md) — 노출 시 폐기·재발급
- [`스토리지 셋업 가이드`](./storage-setup.md) — MinIO 호스팅 자체 셋업 (키 발급 외)
- [`운영 모니터링 셋업 가이드`](./monitoring-setup.md) — Loki·Grafana·Prometheus·Alertmanager
- [`Phone Auth (점유인증) & SMS`](../../api-and-functional/functional/phone-auth-and-sms.md) — CoolSMS 키로 동작하는 SMS OTP 점유인증 도메인
- [`인프라 결정 기록 (Decisions — Infrastructure)`](../deploy/decisions-infra.md) — 각 자격을 선택한 근거
