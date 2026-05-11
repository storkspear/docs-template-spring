# 운영 키 발급 통합 가이드

> **유형**: How-to · **독자**: 운영자 · 첫 배포자 (Level 2) · **읽는 시간**: ~15분

**설계 근거**: [`ADR-007 (솔로 친화적 운영)`](../../philosophy/adr-007-solo-friendly-operations.md)

> 셋업 흐름: [`도그푸딩 환경 셋업 가이드`](../../start/dogfood-setup.md) — 전체 1~2회차 절차 안내
> 4-Stage 동기화: [`Secret Chain 4-Stage 동기화`](./secret-chain-4stage.md) — 발급한 키가 컨테이너에 주입되는 경로
> 키 교체 절차: [`키 교체 절차 (Key Rotation)`](./key-rotation.md) — 노출 / 주기적 rotation 시 폐기·재발급
> 소셜 로그인 상세: [`소셜 로그인 설정 가이드`](../../start/social-auth-setup.md) — 앱별 4 provider (Google/Apple/Kakao/Naver) 콘솔 화면 상세

---

## 1. 개요

운영 환경에서 사용되는 모든 외부 자격 증명의 **발급 목적·발급 절차·`.env.prod` 채울 위치**를 한 곳에 모아둔 통합 가이드입니다. 키마다 발급처가 다르고 권한 범위가 다르기 때문에, 어느 콘솔에서 어떤 권한을 골라야 하는지를 잊기 쉽습니다. 이 문서가 그 단일 진입점입니다.

이 가이드는 **`.env.prod.example` 의 주석을 보충**하는 역할입니다. 주석은 `.env.prod` 를 직접 수정할 때 곁눈질로 보는 *현장 메모* 이고, 이 문서는 *발급 절차의 책임자가 책상에서 따라가는 단계별 안내* 입니다. 두 가지를 함께 보면서 채우면 됩니다.

키 발급에 익숙하지 않은 첫 배포자라면 [`도그푸딩 환경 셋업 가이드`](../../start/dogfood-setup.md) 를 먼저 한 번 훑은 뒤 이 문서로 돌아오는 흐름을 권장합니다. 도그푸딩 가이드가 *언제 발급해야 하는지* 의 흐름을, 이 문서가 *무엇을 어떻게 발급하는지* 의 절차를 설명합니다.

### 발급 매트릭스

| 분류 | 키 | 발급처 | 활성 조건 |
|---|---|---|---|
| **필수 — 앱 부팅** | `BASE_DOMAIN` / `SUBDOMAIN` / `APP_DOMAIN` | 도메인 등록 대행 (Cloudflare / Namecheap 등) | 항상 |
|  | `CLOUDFLARE_API_TOKEN` 외 3개 | https://dash.cloudflare.com | Tunnel 사용 시 (사실상 항상) |
|  | `JWT_SECRET` | `init-server.sh` 자동 발급 | 항상 |
|  | `JDBC_DB_URL` / `DB_USER` / `DB_PASSWORD` | Supabase / RDS / Fly Postgres | 항상 |
| **필수 — 배포** | `GHCR_TOKEN` | https://github.com/settings/tokens | 항상 |
|  | `SSH_PRIVATE_KEY` | 로컬 `ssh-keygen` + 운영 서버 등록 | 항상 |
| **선택 — 기능별** | `APP_STORAGE_MINIO_*` | MinIO 콘솔 / `mc admin user add` | `feature=storage` |
|  | `RESEND_*` | https://resend.com | `feature=email` |
|  | `APP_CREDENTIALS_<SLUG>_*` | Google / Apple / Kakao / Naver 콘솔 | `feature=social-auth` |
|  | `TS_OAUTH_*` | https://login.tailscale.com | `DEPLOY_ENABLED=true` 시 |
|  | `LOKI_URL` | Loki 호스트 (자체 / Grafana Cloud) | `feature=logging` |
|  | `DISCORD_WEBHOOK_URL` | Discord 채널 통합 | `feature=alertmanager` |
|  | `APP_PAYMENT_PORTONE_*` | https://portone.io 콘솔 | `feature=payment` |
|  | `APP_IAP_APPLE_*` | App Store Connect | `feature=iap` (iOS) |
|  | `APP_IAP_GOOGLE_*` | Google Cloud Console | `feature=iap` (Android) |

선택 키는 비워두면 해당 기능이 자동 비활성화되며 Spring 부팅에는 영향을 주지 않습니다 ([`ADR-034 — Feature Toggle Lite mode`](../../philosophy/adr-034-feature-toggle-lite-mode.md) 참조).

---

## 2. 필수 — 앱 부팅 자격

### 2.1 도메인 (`BASE_DOMAIN` / `SUBDOMAIN` / `APP_DOMAIN`)

**발급 목적**. 운영 백엔드의 외부 접근 주소입니다. `BASE_DOMAIN` 과 `SUBDOMAIN` 을 분리한 이유는 한 사람이 여러 파생 레포를 운영할 때 같은 도메인을 재사용하기 위해서입니다 (예: `example.com` 아래에 `api.example.com` / `admin.example.com` / `log.example.com` 을 각각 다른 레포로 운영). `init-server.sh` 가 두 값을 합쳐서 `APP_DOMAIN=https://${SUBDOMAIN}.${BASE_DOMAIN}` 을 자동으로 조립하므로 직접 채울 필요는 없습니다.

**발급 절차**. 도메인은 어떤 등록 대행이든 가능합니다. Cloudflare 에 등록해두면 다음 단계의 API Token 발급과 자연스럽게 이어집니다. 도메인을 새로 사는 경우라면 Cloudflare 의 *Add a site* 메뉴에서 도메인을 추가하고 네임서버를 변경하는 절차까지 마쳐야 합니다.

**`.env.prod` 채울 위치**:
```bash
BASE_DOMAIN=example.com
SUBDOMAIN=server
# APP_DOMAIN 은 비워둠 — init-server.sh 가 https://server.example.com 으로 자동 조립
```

**검증**. `init-server.sh` 1회차가 자동 조립한 `APP_DOMAIN` 값을 `.env.prod` 에서 확인합니다. 직접 채워야 한다면 그 값이 우선합니다.

### 2.2 Cloudflare API Token + ID 4종

**발급 목적**. `init-server.sh` 가 `${SUBDOMAIN}.${BASE_DOMAIN}` 의 DNS CNAME 과 Tunnel ingress 를 자동 등록·정리하기 위해 필요합니다. Token 1 개만 채우면 `ZONE_ID` / `ACCOUNT_ID` / `TUNNEL_ID` 는 `BASE_DOMAIN` 을 단서로 자동 추출됩니다. Cloudflare Tunnel 을 쓰지 않고 직접 IP 노출로 운영한다면 이 절을 건너뛸 수 있지만, Mac mini 같은 가정용 회선 환경에서는 Tunnel 사용이 사실상 필수입니다.

**발급 절차**.
1. https://dash.cloudflare.com/profile/api-tokens 접속.
2. *Create Token* → *Custom token* 으로 이동.
3. **Permissions** 에 다음 두 줄을 추가합니다.
   - *Zone* → *DNS* → *Edit*
   - *Account* → *Cloudflare Tunnel* → *Edit*
4. **Zone Resources** 는 *Specific zone* 을 선택하고 본인의 `BASE_DOMAIN` 을 지정합니다. *All zones* 로 두면 다른 사이트까지 접근 가능해집니다.
5. *Continue to summary* → *Create token* 후 표시되는 토큰 값을 즉시 복사합니다 (한 번만 표시됨).

**`.env.prod` 채울 위치**:
```bash
CLOUDFLARE_API_TOKEN=<발급한 토큰 값>
# 나머지 3개는 비워두면 init-server.sh 가 자동 추출
CLOUDFLARE_ZONE_ID=
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_TUNNEL_ID=
```

**검증**. `init-server.sh` 2회차의 *Cloudflare resource discovery* 단계에서 ZONE_ID / ACCOUNT_ID / TUNNEL_ID 를 자동 추출하고 결과를 표시합니다. 추출이 실패하면 토큰 권한·Zone Resources 설정을 다시 확인합니다.

### 2.3 JWT_SECRET

**발급 목적**. JWT 토큰 서명·검증에 사용하는 32자 이상의 임의 시크릿입니다 ([`ADR-006 (HS256 JWT)`](../../philosophy/adr-006-hs256-jwt.md) 참조). 이 값을 알면 임의의 사용자 토큰을 위조할 수 있으므로 절대 노출되어서는 안 됩니다.

**발급 절차**. 별도의 콘솔 발급이 필요 없습니다. `init-server.sh` 1회차가 `openssl rand -base64 48` 결과로 자동 생성해 `.env.prod` 에 채워줍니다. 직접 만들고 싶다면 다음 명령을 사용합니다.

```bash
openssl rand -base64 48 | tr -d '\n'
```

**`.env.prod` 채울 위치**:
```bash
JWT_SECRET=<자동 생성값 또는 위 명령 결과>
```

**검증**. 운영 부팅 후 로그인 API 호출이 토큰을 정상 발급하면 동작 확인 완료입니다.

### 2.4 DB 연결 정보

**발급 목적**. 운영 PostgreSQL 의 JDBC 연결 문자열·계정·비밀번호입니다. Supabase·RDS·Fly Postgres 어느 것이든 가능하지만, 도그푸딩 단계에서는 무료 tier 가 충분한 Supabase 를 권장합니다.

**Supabase 발급 절차** (다른 호스팅을 쓴다면 해당 콘솔의 *Connection string* 메뉴에서 동일한 값을 찾을 수 있습니다).
1. https://supabase.com 에서 새 프로젝트를 만듭니다. region 은 한국 사용자라면 *Northeast Asia (Seoul)* 또는 *Tokyo* 권장.
2. 프로젝트 생성 시 표시되는 *Database password* 를 즉시 복사해 안전한 곳에 저장합니다 (재발급은 가능하나 그 시점에 모든 클라이언트가 갱신 필요).
3. *Settings* → *Database* → *Connection string* → *Session pooler* 탭으로 이동.
4. 표시되는 PostgreSQL URI 형식을 JDBC 형식으로 분리합니다 ([`도그푸딩 함정 #11`](../../start/dogfood-pitfalls.md) 참조).

원본 connection string 예시:
```
postgresql://postgres.sebqrqi...:[YOUR-PASSWORD]@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres
```

위 문자열에서 `jdbc:` prefix 를 붙이고 user/password 를 별도 변수로 분리합니다.

**`.env.prod` 채울 위치**:
```bash
JDBC_DB_URL=jdbc:postgresql://aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres?currentSchema=core
DB_USER=postgres.sebqrqi...
DB_PASSWORD=<2단계에서 복사한 Supabase password>
```

**주의 사항**. `init-server.sh` 1회차가 `DB_PASSWORD` 에 임의 placeholder 를 채워두므로, **반드시 Supabase 의 실제 비밀번호로 덮어써야 합니다**. Placeholder 를 그대로 두면 운영 부팅 시 인증 실패로 차단됩니다.

`<SLUG>_JDBC_DB_URL` 같은 슬러그별 자격은 도그푸딩 단계에서는 비워둡니다. `AbstractAppDataSourceConfig` 의 `deriveSlugUrl` 이 core 의 `JDBC_DB_URL` 에서 `currentSchema=<slug>` 부분만 자동 교체합니다 ([`도그푸딩 환경 셋업 §3.5`](../../start/dogfood-setup.md#슬러그별-datasource-slug_db_url-은-비워두기) 참조).

**검증**. `verify-server.sh` Step 2 (DB 연결) 가 PASS 면 정상입니다. 운영 부팅 시 HikariCP 가 정상 연결되었음을 의미합니다.

---

## 3. 필수 — 배포 파이프라인

### 3.1 GHCR_TOKEN (GitHub Personal Access Token Classic)

**발급 목적**. 다음 세 가지 용도를 한 토큰이 모두 처리합니다.
- GitHub Container Registry (GHCR) 에 docker 이미지를 push·pull. `deploy.yml` 의 `KAMAL_REGISTRY_PASSWORD` 로 사용됩니다.
- 이전 이미지 정리 (`delete-package-versions` 액션).
- `docs-template-spring` 같은 다른 레포로 docs sync 시 PR 자동 생성 (`sync-docs.yml`).

`GITHUB_TOKEN` 으로 첫 패키지 생성 시 권한이 부족한 알려진 이슈 ([`도그푸딩 함정 #7`](../../start/dogfood-pitfalls.md)) 때문에 PAT 를 사용합니다.

**발급 절차**.
1. https://github.com/settings/tokens 으로 이동해 *Generate new token* → *Generate new token (classic)* 을 선택합니다 (fine-grained 가 아닌 classic).
2. *Note* 에 식별 가능한 이름을 적습니다 (예: `dogfood-server-factory`).
3. *Expiration* 은 90일을 권장합니다. 만료 임박 시 GitHub 가 이메일로 알려주므로 잊고 방치하지 않게 됩니다.
4. **Scopes** 에서 다음 네 항목을 모두 체크합니다.
   - `write:packages`
   - `read:packages`
   - `delete:packages`
   - `repo` (`write:packages` 가 의존하는 권한이며 docs sync PR 생성에도 필요)
5. *Generate token* 을 누르고 표시되는 토큰을 즉시 복사합니다. 한 번만 표시됩니다.

**`.env.prod` 채울 위치**:
```bash
GHCR_TOKEN=ghp_<토큰 값>
GHCR_USERNAME=
# GitHub Actions 가 ${{ github.actor }} 로 자동 주입하므로 GHCR_USERNAME 은 보통 비워둡니다.
# 로컬에서 kamal 을 직접 실행할 때만 본인 GitHub 계정명을 채웁니다.
```

**검증**. `init-server.sh` 2회차가 PAT 로 GHCR 로그인을 시도하고, GHA 의 첫 deploy workflow 실행 시 push 가 성공하면 권한 설정 정상입니다.

### 3.2 SSH_PRIVATE_KEY (운영 서버 접근 키)

**발급 목적**. Kamal deploy 가 운영 서버 (Mac mini 등) 에 SSH 로 접속해 컨테이너를 갱신할 때 사용하는 private key 입니다. GHA runner 도 이 키를 통해 운영 서버에 도달합니다.

**발급 절차**.
1. 로컬에서 새 ed25519 키를 발급합니다 (passphrase 없이 — Kamal 이 비대화형으로 사용).
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -C "deploy@$(hostname)" -N ""
   ```
2. 공개키 (`~/.ssh/deploy_key.pub`) 의 한 줄 내용을 운영 서버의 `~/.ssh/authorized_keys` 에 추가합니다. Mac mini 라면 화면 공유나 직접 키보드로 다음과 같이 등록합니다.
   ```bash
   mkdir -p ~/.ssh && chmod 700 ~/.ssh
   echo 'ssh-ed25519 AAAA... deploy@laptop' >> ~/.ssh/authorized_keys
   chmod 600 ~/.ssh/authorized_keys
   ```
3. 로컬에서 SSH 접속이 되는지 확인합니다.
   ```bash
   ssh -i ~/.ssh/deploy_key <운영서버계정>@<운영서버IP> 'echo connected'
   ```

**`.env.prod` 채울 위치**. private key (`~/.ssh/deploy_key`) 의 **전체 내용** 을 BEGIN/END 라인 포함해 그대로 붙여넣습니다. 줄바꿈이 깨지지 않도록 주의합니다.
```bash
SSH_PRIVATE_KEY=-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
... (전체 내용)
-----END OPENSSH PRIVATE KEY-----
```

`gh secret set` 이 다중행 값을 자동 처리하므로 `init-server.sh` 가 큰 수정 없이 GitHub Secrets 로 push 합니다.

**검증**. `verify-server.sh` Step 3 (SSH + Tailscale) 가 PASS 면 정상입니다.

---

## 4. 선택 — 기능별 자격 증명

이 절의 키들은 비워두면 해당 기능이 자동 비활성화됩니다. 운영 부팅에는 영향을 주지 않으므로 *지금 필요한 기능만 채우고 나머지는 나중에* 채워도 됩니다.

### 4.1 MinIO / S3 호환 스토리지 (`feature=storage`)

**발급 목적**. 사용자 업로드 파일·리포트·이미지 등을 영속화하기 위한 객체 스토리지 자격입니다. 비워두면 `InMemoryStorageAdapter` 로 fallback 되어 컨테이너 재시작 시 데이터가 소실됩니다 — 도그푸딩 단계에서는 일부러 비워둘 수도 있지만 운영 단계에서는 반드시 채워야 합니다.

**발급 절차**. 운영 MinIO 인스턴스의 콘솔에서 별도의 access key 를 발급합니다 (root credential 직접 사용은 비권장).
1. MinIO 콘솔 → *Identity* → *Users* → *Create User* 또는 *Service Account* 를 선택합니다.
2. CLI 로 만들고 싶다면 다음 명령을 사용합니다.
   ```bash
   mc admin user add <alias> <newkey> <newsecret>
   mc admin policy attach <alias> readwrite --user=<newkey>
   ```
3. 발급한 access key·secret key·endpoint URL 을 기록합니다.
4. 운영 bucket 을 생성합니다. `APP_STORAGE_MINIO_BUCKETS_<N>` 의 인덱스를 0 부터 순차 부여하며, `BucketProvisioner` 가 부팅 시 자동 생성하므로 콘솔에서 미리 만들 필요는 없습니다 ([`storage-bucket-isolation.md`](./storage-bucket-isolation.md) 참조).

**`.env.prod` 채울 위치**:
```bash
APP_STORAGE_MINIO_ENDPOINT=https://<minio-host>:9000
APP_STORAGE_MINIO_ACCESS_KEY=<발급한 access key>
APP_STORAGE_MINIO_SECRET_KEY=<발급한 secret key>
APP_STORAGE_MINIO_BUCKETS_0=<bucket 이름 (예: server-factory-default)>
```

**검증**. `verify-server.sh` Step 4 (MinIO 업로드) 가 PASS 면 정상입니다. PUT/STAT/DEL 3 동작을 테스트 객체로 검증합니다.

운영 MinIO 호스팅 (Mac mini 의 시놀로지 NAS 등) 셋업은 [`스토리지 셋업 가이드`](./storage-setup.md) 를 참조합니다. 이 통합 가이드는 *키 발급* 만 다룹니다.

### 4.2 Resend 트랜잭셔널 이메일 (`feature=email`)

**발급 목적**. 회원가입 인증·비밀번호 재설정·구독 만료 알림 메일 등을 사용자에게 발송하기 위한 자격입니다. 비워두면 `LoggingEmailAdapter` 로 fallback 되어 메일이 콘솔 로그로만 출력됩니다. **회원가입을 받는 서비스라면 운영에서 반드시 채워야 합니다** — 그렇지 않으면 사용자가 인증 메일을 받지 못합니다.

**발급 절차**.
1. https://resend.com 에 가입합니다 (무료 tier 가 일 100 통).
2. *Domains* 메뉴에서 발신할 도메인을 추가하고 SPF·DKIM 레코드를 도메인 DNS 에 등록합니다 (Cloudflare 를 쓴다면 *Add records* 를 자동으로 적용 가능).
3. 도메인 검증이 *Verified* 로 표시될 때까지 기다립니다 (보통 수 분~수 시간).
4. *API Keys* 메뉴에서 *Create API Key* → *Full access* 를 선택해 키를 발급합니다. 키는 `re_` 로 시작하며 한 번만 표시되므로 즉시 복사합니다.

**`.env.prod` 채울 위치**:
```bash
RESEND_API_KEY=re_<발급한 키>
RESEND_FROM_ADDRESS=noreply@<검증한 도메인>
RESEND_FROM_NAME=<발신인 표시명 (예: ServerFactory)>
RESEND_TEST_ADMIN_USER_EMAIL=<verify-server.sh 검증 시 받을 관리자 메일 주소>
```

`RESEND_TEST_ADMIN_USER_EMAIL` 은 `verify-server.sh` 의 이메일 검증 단계에서만 사용되며 컨테이너 ENV 로 주입되지 않습니다. 비워두면 검증 단계만 SKIP 됩니다.

**검증**. `verify-server.sh` Step 5 (Resend API 발송) 가 PASS 면 정상입니다. `RESEND_TEST_ADMIN_USER_EMAIL` 로 실제 메일이 도착했는지 함께 확인합니다.

### 4.3 소셜 로그인 (`feature=social-auth`)

**발급 목적**. Google · Apple · Kakao · Naver 4 provider 의 OAuth 자격 증명입니다. 앱 슬러그별로 별도 발급해야 하므로 ([`ADR-012 (앱별 독립 유저 모델)`](../../philosophy/adr-012-per-app-user-model.md) 참조) 키 이름이 `APP_CREDENTIALS_<SLUG>_<PROVIDER>_<KEY>` 형태로 동적입니다.

**발급 절차**. 4 provider 의 콘솔 화면 캡처와 Bundle ID·SHA-1 인증서 지문 등의 디테일이 길기 때문에 별도 가이드로 분리되어 있습니다.

→ **자세한 발급 절차**: [`소셜 로그인 설정 가이드`](../../start/social-auth-setup.md)

각 provider 의 콘솔 단계·`.env.prod` 키 매핑·dev-mock 모드를 모두 그곳에서 다룹니다. 이 통합 가이드는 *어디서 발급하는지* 의 전체 그림에서 소셜 로그인의 위치만 표시합니다.

**`.env.prod` 채울 위치** (예시 — 슬러그가 `myapp` 인 경우):
```bash
APP_CREDENTIALS_MYNEWAPP_GOOGLE_CLIENT_IDS_0=<iOS Client ID>
APP_CREDENTIALS_MYNEWAPP_GOOGLE_CLIENT_IDS_1=<Android Client ID>
APP_CREDENTIALS_MYNEWAPP_APPLE_BUNDLE_ID=com.example.mynewapp
APP_CREDENTIALS_MYNEWAPP_KAKAO_APP_ID=<숫자>
APP_CREDENTIALS_MYNEWAPP_NAVER_CLIENT_ID=<문자열>
```

**검증**. 프론트에서 각 provider 의 로그인 버튼을 눌렀을 때 백엔드가 `JWT` 를 정상 발급하면 동작 확인 완료입니다. 키 발급 전에는 [`소셜 로그인 가이드`](../../start/social-auth-setup.md) 의 dev-mock 모드로 e2e 흐름을 미리 시연할 수 있습니다.

### 4.4 Tailscale OAuth (`DEPLOY_ENABLED=true` 시 필수)

**발급 목적**. GHA runner (GitHub 의 ubuntu VM) 가 운영 Mac mini (Tailnet 사설 IP `100.x.x.x`) 에 도달하기 위해 매 배포마다 일회성 ephemeral device 로 tailnet 에 join 할 때 사용합니다. 운영 서버를 Tailscale 로 접근하지 않는다면 이 절을 건너뛸 수 있습니다.

**발급 절차**.
1. ACL 의 `tagOwners` 를 먼저 정의합니다 (한 번만). https://login.tailscale.com/admin/acls/file 의 HuJSON 편집기에서 다음을 추가합니다.
   ```hujson
   "tagOwners": {
       "tag:ci": ["autogroup:admin"],
   },
   ```
2. *Save* 를 누릅니다. 이 단계를 빠뜨리면 다음 OAuth 발급 화면에서 *Add tags* 드롭다운이 비활성화되어 `tag:ci` 를 부여할 수 없습니다.
3. https://login.tailscale.com/admin/settings/oauth → *Generate OAuth client* 로 이동합니다.
4. *Custom scopes* 를 선택하고 다음 두 권한을 모두 체크합니다 (둘 중 하나라도 빠지면 403 — [`도그푸딩 함정 #4`](../../start/dogfood-pitfalls.md)).
   - *Devices* → *Core* → *Write* 에 tags `tag:ci`
   - *Keys* → *Auth Keys* → *Write* 에 tags `tag:ci`
5. 다른 scope (Posture / Routes / OAuth Keys 등) 는 모두 체크 해제합니다.
6. *Generate credential* 을 누르고 표시되는 Client ID 와 Secret 을 즉시 복사합니다.

**`.env.prod` 채울 위치**:
```bash
TS_OAUTH_CLIENT_ID=<발급한 Client ID>
TS_OAUTH_SECRET=<발급한 Secret>
DEPLOY_HOST=100.X.X.X     # Mac mini 의 Tailnet IP (Variables 영역)
DEPLOY_SSH_USER=<Mac mini 계정명>
```

**검증**. `verify-server.sh` Step 3 (SSH + Tailscale) 가 PASS 면 정상입니다. GHA deploy workflow 가 ephemeral device 로 join → SSH → exit 흐름을 자동으로 수행합니다.

### 4.5 Loki 로그 endpoint (`feature=logging`)

**발급 목적**. 운영 Spring 컨테이너의 로그를 Loki 로 전송하기 위한 endpoint URL 입니다. 비워두면 `logback-common.xml` 의 default (`http://loki:3100/loki/api/v1/push`) 가 사용됩니다 — Mac mini 의 Kamal docker network 안에서 `loki` 컨테이너 호스트명으로 접근하는 운영 권장값이라 비워둬도 정상 동작합니다.

**발급 절차**.
- **자체 호스팅 Loki**. 별도 발급이 없습니다. `infra/docker-compose.observability.yml` 로 Mac mini 에 Loki 컨테이너를 기동하면 컨테이너 호스트명 `loki` 가 자동으로 잡힙니다 ([`운영 모니터링 셋업 가이드`](./monitoring-setup.md) 참조).
- **Grafana Cloud Loki**. https://grafana.com/products/cloud/ 에서 무료 tier (50 GB / 월) 가입 → *Loki* 메뉴 → *Send Logs* → *Loki API endpoint* 의 full URL 과 username/password 를 기록합니다.

**`.env.prod` 채울 위치**:
```bash
# 자체 호스팅이라면 비워둠 (default 가 동작)
LOKI_URL=

# Grafana Cloud Loki 사용 시
LOKI_URL=https://logs-prod-XXX.grafana.net/loki/api/v1/push
```

Grafana Cloud 사용 시 basic auth 는 별도 환경변수로 추가해야 합니다 (현재 `.env.prod.example` 에는 노출되어 있지 않음 — 자체 호스팅을 우선 가정).

**검증**. `verify-server.sh` Step 6 (Loki readiness) 가 PASS 면 정상이며, Grafana 에서 `{job="spring"}` 쿼리로 실제 로그가 흘러들어오는지 확인합니다.

### 4.6 Discord Webhook (`feature=alertmanager`)

**발급 목적**. Prometheus 알람을 Discord 채널로 발송하기 위한 webhook URL 입니다. 비워두면 알람은 Alertmanager 에서 동작하지만 외부로 발송되지 않습니다.

**발급 절차**.
1. Discord 서버 → 알림을 받을 채널 → 채널 설정 → *연동* → *웹후크* → *새 웹후크* 를 선택합니다.
2. webhook 이름을 적당히 정하고 *URL 복사* 를 눌러 URL 을 기록합니다.
3. URL 끝에 `/slack` 을 붙입니다 — Discord 의 Slack 호환 endpoint 를 Alertmanager 가 사용하기 때문입니다 (예: `https://discord.com/api/webhooks/<id>/<token>/slack`).

**`.env.prod` 채울 위치**:
```bash
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/<id>/<token>/slack
```

**검증**. Alertmanager 컨테이너의 `/api/v2/status` 가 정상 응답하고 ([`verify-server.sh`](../../start/dogfood-setup.md#7-verify-server-sh-7-단계-검증) Step 7), Prometheus 에서 임의 알람을 수동 발화시켜 Discord 채널에 메시지가 도착하는지 확인합니다.

### 4.7 PortOne PG 결제 (`feature=payment`)

**발급 목적**. 외부 PG (한국형 — 나이스 / 토스 / 이니시스 등) 결제를 PortOne 통합 콘솔로 처리하기 위한 자격입니다. PortOne 의 v1·v2 키, 가맹점 식별 코드, webhook secret 모두 한 콘솔에서 발급됩니다 ([`ADR-019 (billing/iap/payment 분리)`](../../philosophy/adr-019-billing-iap-payment-separation.md) 참조).

**발급 절차**.
1. https://portone.io 에 가입한 뒤 콘솔에 로그인합니다.
2. *상점 정보* → *가맹점 등록* 을 마칩니다 (사업자 등록증·통신판매업 신고증 필요).
3. *결제 연동* → *채널* 메뉴에서 사용할 PG 채널 (나이스 / 토스 / 이니시스 등) 을 활성화합니다. 운영 활성화 전에는 PortOne 측 검수 단계가 있어 며칠 소요될 수 있습니다.
4. *API 키* 메뉴에서 다음 값을 모두 발급·복사합니다.
   - v1 API Key / Secret (legacy 호환)
   - v2 API Key (신규 API 호출용)
   - 가맹점 식별 코드 (Customer Code)
5. *Webhook* 메뉴에서 webhook URL 등록 및 webhook secret 발급. URL 은 `https://<APP_DOMAIN>/api/payment/webhook` 형식.

**`.env.prod` 채울 위치**:
```bash
APP_PAYMENT_PORTONE_API_URL=https://api.iamport.kr   # v1 API base URL
APP_PAYMENT_PORTONE_API_V1_KEY=<v1 키>
APP_PAYMENT_PORTONE_API_V1_SECRET=<v1 시크릿>
APP_PAYMENT_PORTONE_API_V2_KEY=<v2 키>
APP_PAYMENT_PORTONE_CUSTOMER_CODE=<가맹점 식별 코드>
APP_PAYMENT_PORTONE_WEBHOOK_SECRET=<webhook secret>
APP_PAYMENT_PORTONE_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS=300
```

**중요 — 결제 미사용 시에도 채워야 함**. 슬러그 컨트롤러 (`*PaymentController`) 가 `PaymentPort` 를 필수 의존하기 때문에, prod profile 의 `PortOneProdConfigGuard` 가 부팅 시 v1 키 + webhook secret 의 비어있지 않음을 검증합니다. 결제를 실제로 사용하지 않는 도그푸딩 단계에서도 *어떤 더미값이든* 채워야 부팅이 통과합니다.

```bash
# 결제 미사용 — 도그푸딩 단계엔 더미값 OK
APP_PAYMENT_PORTONE_API_V1_KEY=dogfood-dummy
APP_PAYMENT_PORTONE_API_V1_SECRET=dogfood-dummy
APP_PAYMENT_PORTONE_WEBHOOK_SECRET=dogfood-dummy
```

→ 코드 근거: `core/core-payment-impl/.../PaymentAutoConfiguration.java` 의 `portOneProdConfigGuard`

**검증**. 운영 부팅 로그에 `PortOneProdConfigGuard` 의 통과 메시지가 보이고, 실제 결제 흐름이 발생하는 시점에 PortOne 콘솔의 *결제 내역* 메뉴에서 호출이 기록되는지 확인합니다.

### 4.8 Apple StoreKit (`feature=iap`, iOS)

**발급 목적**. iOS 인앱 결제를 서버에서 검증하기 위한 App Store Server API 자격입니다. Apple 1 개 계정에 대해 *글로벌* 키를 한 벌만 발급하면 모든 슬러그·앱이 공유합니다. Bundle ID 만 슬러그별로 분리됩니다 ([`ADR-022 (IAP server notifications)`](../../philosophy/adr-022-iap-server-notifications.md) 참조).

**발급 절차**.
1. https://appstoreconnect.apple.com 에 로그인.
2. *Users and Access* → *Integrations* → *App Store Connect API* 로 이동.
3. *Keys* 탭 → *Generate API Key* (또는 *+* 버튼).
4. *Name* 에 식별 가능한 이름을 적고 *Access* 를 *App Manager* 또는 그 이상으로 설정합니다.
5. *Generate* 후 표시되는 `.p8` 파일을 즉시 다운로드합니다 (한 번만 다운로드 가능). 이 파일이 `APP_IAP_APPLE_PRIVATE_KEY` 의 원본입니다.
6. 같은 화면에서 *Key ID* 와 *Issuer ID* 를 기록합니다.

**`.env.prod` 채울 위치**:
```bash
APP_IAP_APPLE_API_URL=https://api.storekit.itunes.apple.com   # production
APP_IAP_APPLE_KEY_ID=<Key ID (10자 영숫자)>
APP_IAP_APPLE_ISSUER_ID=<Issuer ID (UUID 형태)>
APP_IAP_APPLE_ENVIRONMENT=Production
APP_IAP_APPLE_DEV_MOCK=false   # prod 는 반드시 false (운영 안전망)

# .p8 파일의 BEGIN/END 라인 포함 전체 내용을 그대로 붙여넣음
APP_IAP_APPLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMG...
-----END PRIVATE KEY-----
```

Bundle ID 는 슬러그별 키로 분리됩니다.
```bash
APP_CREDENTIALS_MYNEWAPP_IAP_APPLE_BUNDLE_ID=com.example.mynewapp
```

**검증**. 실제 iOS 빌드에서 인앱 구매를 수행하고 백엔드의 `/iap/apple/verify` 엔드포인트가 200 응답을 내는지 확인합니다. `APP_IAP_APPLE_DEV_MOCK=true` 는 검증 우회 모드이므로 운영에서는 절대 활성화하지 않습니다.

### 4.9 Google Play Developer API (`feature=iap`, Android)

**발급 목적**. Android 인앱 결제를 서버에서 검증하기 위한 Google Cloud Service Account 자격입니다. Apple 과 마찬가지로 글로벌 자격 한 벌이 모든 슬러그를 커버하며, package name 만 슬러그별로 분리됩니다.

**발급 절차**.
1. https://console.cloud.google.com → 프로젝트 선택 또는 신규 생성 (소셜 로그인용 `app-factory` 프로젝트를 재사용 권장).
2. *IAM & Admin* → *Service Accounts* → *Create Service Account*.
3. 이름을 정하고 (예: `play-iap-verifier`) 역할은 빈 채로 *Done*.
4. 생성된 service account → *Keys* 탭 → *Add Key* → *JSON* 을 선택해 JSON 파일을 다운로드합니다 (한 번만 다운로드 가능).
5. https://play.google.com/console → *Settings* → *API Access* → 위 service account 를 연결하고 *Grant Access* 에서 *View financial data* 권한을 부여합니다.

**`.env.prod` 채울 위치**:
```bash
APP_IAP_GOOGLE_API_URL=https://androidpublisher.googleapis.com
# JSON 파일 전체 내용을 한 줄로 변환 (jq -c . < key.json) 또는 multi-line 그대로
APP_IAP_GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...", ...}
```

Package name 은 슬러그별 키로 분리됩니다.
```bash
APP_CREDENTIALS_MYNEWAPP_IAP_GOOGLE_PACKAGE_NAME=com.example.mynewapp
```

**Pub/Sub push 검증** (RTDN webhook). Google Play 의 실시간 알림을 받으려면 Cloud Pub/Sub topic·subscription 추가 발급이 필요합니다.
1. Cloud Console → *Pub/Sub* → *Create Topic* (예: `play-rtdn`).
2. Play Console → *Settings* → *Real-time developer notifications* → 위 topic 을 선택.
3. Cloud Console → *Pub/Sub* → 해당 topic → *Create Subscription* → *Push* → endpoint 에 `https://<APP_DOMAIN>/api/apps/<slug>/iap/google/webhook` 입력 (각 슬러그별로 별도 subscription).
4. Subscription 생성 시 *Authentication* 에서 service account 를 선택. 그 service account 의 email 이 `APP_IAP_GOOGLE_WEBHOOK_ALLOWED_SERVICE_ACCOUNT_EMAILS` 값입니다.

```bash
APP_IAP_GOOGLE_WEBHOOK_VERIFY_TOKEN=true   # prod 는 반드시 true
APP_IAP_GOOGLE_WEBHOOK_AUDIENCE=https://<APP_DOMAIN>/api/apps/<slug>/iap/google/webhook
APP_IAP_GOOGLE_WEBHOOK_ALLOWED_SERVICE_ACCOUNT_EMAILS=pubsub-push@my-project.iam.gserviceaccount.com
```

**검증**. 실제 Android 빌드에서 인앱 구매를 수행하고 백엔드의 `/iap/google/verify` 엔드포인트가 200 응답을 내며, RTDN webhook 으로 갱신·환불 알림이 정상 처리되는지 확인합니다.

---

## 5. 발급 후 — 4-Stage 동기화

`.env.prod` 채우기는 *발급한 키가 컨테이너에 도달하는 4 단계 중 첫 번째* 일 뿐입니다. 새 키를 추가했다면 나머지 3 단계를 함께 갱신해야 부팅 시 주입됩니다.

→ **상세 절차**: [`Secret Chain 4-Stage 동기화`](./secret-chain-4stage.md)

`init-server.sh` 가 `.env.prod` → GitHub Secrets 까지는 자동으로 처리하지만, `config/deploy.yml` 의 `env.secret:` 목록과 `.kamal/secrets.example` 의 `KEY=$VAR` 매핑, `.github/workflows/deploy.yml` 의 `env:` block 은 *현재 수동* 입니다 ([`도그푸딩 FAQ Q17`](../../start/dogfood-faq.md#q17) 참조).

---

## 6. 노출 시 즉시 폐기

이 가이드의 절차대로 발급한 키들이 **노출되었다면** (채팅·public commit·로그 출력 등 어떤 경로로든 평문이 외부에 보였다면) 즉시 폐기·재발급해야 합니다.

→ **상세 절차**: [`키 교체 절차 (Key Rotation)`](./key-rotation.md)

각 키 종류별 폐기 위치 (`https://github.com/settings/tokens` / `https://login.tailscale.com/admin/settings/oauth` 등) 와 재발급 후 `init-server.sh` 재실행으로 GitHub Secrets 을 갱신하는 흐름을 그곳에서 다룹니다.

---

## 7. 트러블슈팅

발급한 키가 동작하지 않을 때의 빈도 높은 케이스를 모았습니다.

### 부팅 시 `IllegalStateException — PortOne API V1 key/secret/webhook secret missing`

**원인**. `APP_PAYMENT_PORTONE_API_V1_KEY` / `_API_V1_SECRET` / `_WEBHOOK_SECRET` 중 하나 이상이 비어있습니다.

**조치**. §4.7 의 안내대로 결제 미사용 단계에서도 더미값 (`dogfood-dummy` 등) 으로 채웁니다.

### Cloudflare Tunnel 에 `${SUBDOMAIN}.${BASE_DOMAIN}` 이 라우팅되지 않음

**원인**. Token 의 *Zone Resources* 가 *All zones* 가 아닌 *Specific zone* 인데 본인 도메인이 누락되었거나, 권한이 *DNS Edit* 만 있고 *Cloudflare Tunnel Edit* 가 빠져있습니다.

**조치**. Cloudflare 의 토큰 편집 화면에서 권한 두 줄과 Zone Resources 를 다시 확인합니다 (§2.2 참조).

### `gh secret set GHCR_TOKEN` 이 *Bad credentials* 응답

**원인**. PAT 가 fine-grained 로 발급되었거나 `repo` scope 가 빠져있습니다.

**조치**. PAT 를 *classic* 으로 다시 발급하고 §3.1 의 4 가지 scope 를 모두 체크합니다.

### Resend API 가 `domain not verified` 응답

**원인**. SPF·DKIM 레코드가 도메인 DNS 에 등록되지 않았거나 propagation 이 끝나지 않았습니다.

**조치**. Resend 콘솔 → *Domains* 에서 *Verify* 가 녹색이 될 때까지 대기 (몇 분~몇 시간). Cloudflare 사용 시 *Proxy status* 를 *DNS only* 로 두어야 propagation 이 빠릅니다.

### Apple `.p8` private key 가 인식되지 않음

**원인**. `.p8` 파일 내용을 환경변수로 옮길 때 줄바꿈이 사라져 한 줄로 합쳐졌습니다.

**조치**. multi-line 변수로 BEGIN/END 라인 포함 그대로 붙여넣고, `init-server.sh` 가 `gh secret set` 으로 push 한 결과를 GitHub Secrets 화면에서 다시 다운로드해 검증합니다.

---

## 다음 단계

- 발급한 자격으로 첫 운영 배포를 진행하려면: [`도그푸딩 환경 셋업 가이드`](../../start/dogfood-setup.md) §6 (`init-server.sh` 2회차) 로 돌아갑니다.
- 4-Stage 동기화 누락 케이스를 방지하려면: [`Secret Chain 4-Stage 동기화`](./secret-chain-4stage.md) 의 체크리스트를 참조합니다.
- 운영 중 키 노출이 의심되면: [`키 교체 절차 (Key Rotation)`](./key-rotation.md) 의 즉시 폐기 절차를 따릅니다.

---

## 관련 문서

- [`.env.prod.example`](../../../.env.prod.example) — 키별 짧은 주석 (현장 메모)
- [`도그푸딩 환경 셋업 가이드`](../../start/dogfood-setup.md) — 전체 1·2회차 흐름 (이 문서가 §3 의 보충 가이드)
- [`소셜 로그인 설정 가이드`](../../start/social-auth-setup.md) — Google / Apple / Kakao / Naver 4 provider 콘솔 단계 상세
- [`Secret Chain 4-Stage 동기화`](./secret-chain-4stage.md) — 발급한 키가 컨테이너로 주입되는 경로
- [`키 교체 절차 (Key Rotation)`](./key-rotation.md) — 노출 시 폐기·재발급
- [`스토리지 셋업 가이드`](./storage-setup.md) — MinIO 호스팅 자체 셋업 (키 발급 외)
- [`운영 모니터링 셋업 가이드`](./monitoring-setup.md) — Loki / Grafana / Prometheus / Alertmanager
- [`인프라 결정 기록 (Decisions — Infrastructure)`](../deploy/decisions-infra.md) — 각 자격을 선택한 근거
