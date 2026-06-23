# 도그푸딩 환경 셋업 가이드

> **유형**: How-to · **독자**: Level 1 · **읽는 시간**: ~12분

**설계 근거**: [`ADR-002 · Use this template`](../philosophy/adr-002-use-this-template.md)

이 문서는 템플릿(또는 파생 레포)을 직접 Mac mini 에 배포해서 한 사이클을 검증하는 [도그푸딩](../reference/glossary.md#이-레포-고유-용어) 가이드예요. 자체 운영 배포를 처음 돌려 보며, 무엇을 발급하고 어떻게 셋업하는지를 시간 순으로 안내해요. 여기서는 정상 흐름만 다뤄요. 에러를 만나면 시간 순 narrative 인 [`도그푸딩 walkthrough`](./dogfood-walkthrough.md) 나 에러별 검색이 빠른 [`도그푸딩 함정 모음`](./dogfood-pitfalls.md) 으로 가세요.

함께 읽으면 좋은 문서예요.

- 결정 근거: [`인프라 결정 기록 — I-09 ~ I-14`](../production/deploy/decisions-infra.md)
- 전체 플로우: [`CI/CD 전체 플로우`](../production/deploy/ci-cd-flow.md) — commit 부터 운영 반영까지
- 자주 묻는 질문: [`도그푸딩 FAQ`](./dogfood-faq.md)

---

## 1. 개요

### 무엇을 하나요

세 가지를 순서대로 해요.

- 외부 리소스 발급 — GitHub PAT, Tailscale OAuth, Mac mini SSH 키, Supabase 연결 정보를 준비해요 (§3).
- `init-prod.sh` 1·2회차 — `.env.prod` 를 자동 생성하고, 채운 뒤 다시 돌려서 GitHub Secrets·Variables 를 push 해요 (§4 ~ §6).
- 검증 — `verify-server.sh` 7단계로 운영 인프라를 확인하고, 로컬에서 Spring 이 UP 까지 뜨는지 확인해요 (§7 ~ §8).

로컬 docker 환경(`.env` · Postgres · MinIO)이 아직 없다면 [`onboarding §2.4`](./onboarding.md#24-repo-init--로컬-환경-셋업) 의 `<repo> init` 으로 먼저 만들고 오세요. 이 문서는 운영(`prod`) 셋업에 집중해요.

### 누가 읽나요

- "Use this template" 으로 만든 새 파생 레포의 첫 작업자
- 기존 파생 레포 셋업의 일부를 다시 검증하려는 사람

이미 셋업된 레포를 새로 clone 받은 두 번째 이상의 작업자는 더 짧은 흐름을 따라요. 아래 [§1.5](#15-공동-작업자-모드-fresh-clone) 를 보세요.

### 시간 비용

| 단계 | 예상 시간 |
|---|---|
| 외부 리소스 발급 (한 번) | ~20분 |
| `.env.prod` 채우기 | ~5분 |
| `init-prod.sh` 1·2회차 + `verify-server.sh` | ~10분 |
| **합계** | **~35분** (외부 리소스가 이미 있으면 ~15분) |

### 1.5 공동 작업자 모드 (fresh clone)

이미 첫 작업자가 `.env.prod` 와 Secrets·Variables 까지 등록한 파생 레포를 새 팀원이 fresh clone 받았다면, §3 ~ §6 의 발급·채우기·push 를 모두 건너뛰어요.

```bash
git clone <derived-repo>.git && cd <derived-repo>
./factory install        # symlink 등록 (머신마다 1회)
<repo> init              # = init-local.sh — 로컬 docker 만 셋업
```

`init-prod.sh` 는 두 조건이 모두 맞으면 공동 작업자 모드로 자동 전환해요.

- settings.gradle rename 이 끝나 있고 `PROJECT_README_TEMPLATE.md` 가 없음 (= 이미 셋업된 레포)
- `.env.prod` 가 없음 (= 이 머신엔 운영 자격이 없음)

이 모드에서는 운영 셋업 단계(Step 5/6/9.5/10)를 자동으로 건너뛰어요. 운영 Secrets 는 첫 작업자가 이미 GitHub 에 올린 상태라, 자격 없는 머신에서 다시 push 해 덮어쓰는 사고를 막아요. 분기 로직은 [`FAQ Q12`](./dogfood-faq.md#q12) 와 [`FAQ Q14`](./dogfood-faq.md#q14) 에 정리돼 있어요.

운영 secrets 를 의도적으로 다시 갈아엎어야 한다면 `--reinit` 플래그를 써요. 운영 자격이 덮여 쓰이므로 팀과 충분히 협의한 뒤 진행하세요.

---

## 2. 사전 준비물

| 항목 | 어디서 | 자세히 |
|---|---|---|
| GitHub 레포 | "Use this template" 또는 fork | §3.1 의 PAT 도 함께 준비 |
| Mac mini SSH 접근 | macOS 운영 호스트 | §3.3 |
| Tailscale 계정 + ACL admin | login.tailscale.com | §3.2 |
| Supabase 프로젝트 (Seoul region 권장) | supabase.com | §3.5 |
| 도메인 + Cloudflare 계정 (선택) | — | 외부 도메인 접근이 필요할 때만 (§3.6) |

도구(JDK 21~25 · Docker · Node · `gh` CLI 등)가 다 깔려 있는지는 [`onboarding §1`](./onboarding.md#1-도구-설치) 의 `./factory doctor` 로 한 번에 확인할 수 있어요.

---

## 3. 외부 리소스 발급

여기서 발급한 값은 §5 의 `.env.prod` 에 채워 넣어요.

이 절은 도그푸딩에 꼭 필요한 다섯 가지(PAT · Tailscale · SSH · workflow 권한 · Supabase)만 다뤄요. 운영에서 쓰는 나머지 키(Cloudflare · Resend · MinIO · PortOne · IAP · Loki · Discord)의 발급 목적·절차·채울 위치를 한곳에서 보려면 [`운영 키 발급 통합 가이드`](../production/setup/key-issuance.md) 를 참고하세요. 이 §3 은 그 통합 가이드에서 도그푸딩 핵심 다섯 항목만 발췌한 거예요.

### 3.1 GitHub PAT (Personal Access Token Classic)

GHCR 에 docker 이미지를 push 할 권한이 필요해요. 워크플로우 기본 토큰인 `GITHUB_TOKEN` 으로는 첫 패키지를 만들 때 권한이 부족한 알려진 이슈가 있어서([`pitfalls #7`](./dogfood-pitfalls.md)), [PAT](../reference/glossary.md#ci--배포-파이프라인) 를 따로 발급해요.

발급 절차예요.

1. [github.com/settings/tokens](https://github.com/settings/tokens) → "Generate new token" → "Generate new token (classic)"
2. Note 에 `dogfood-template-spring` 처럼 알아볼 이름을 적어요.
3. Expiration 은 90일(또는 본인 정책)으로 둬요.
4. Scopes 에서 다음 네 가지를 체크해요.
   - `write:packages`
   - `read:packages`
   - `delete:packages` — 정리용
   - `repo` — `write:packages` 가 의존
5. "Generate token" → 즉시 복사해요 (한 번만 보여요). 이 값을 `.env.prod` 의 `GHCR_TOKEN` 에 넣어요.

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
- Client ID 와 Secret 을 즉시 복사해 `.env.prod` 의 `TS_OAUTH_CLIENT_ID` 와 `TS_OAUTH_SECRET` 에 넣어요.

### 3.3 Mac mini SSH 키 준비

GitHub Actions 가 Mac mini 로 SSH 할 때 쓸 private key 가 필요해요. `.env.prod` 의 `SSH_PRIVATE_KEY` 에 private key 의 전체 내용(`-----BEGIN OPENSSH PRIVATE KEY-----` 부터 `-----END OPENSSH PRIVATE KEY-----` 까지)을 그대로 넣어요.

**옵션 A — 이미 키가 있다면 (권장)**

```bash
ssh -i ~/.ssh/macmini storkspear@100.X.X.X 'echo connected'
```

이 명령이 성공하면 그 키를 그대로 써요. `.env.prod` 에는 `SSH_PRIVATE_KEY=$(cat ~/.ssh/macmini)` 의 출력처럼 키 내용을 다중행 값으로 넣어요 (`gh secret set` 이 다중행을 알아서 처리해요).

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

### 3.4 레포 workflow 권한 = write

GHCR push 권한을 확보해요. CLI 또는 화면에서 처리할 수 있어요.

```bash
gh api -X PUT "repos/<owner>/<repo>/actions/permissions/workflow" \
  -f default_workflow_permissions=write \
  -F can_approve_pull_request_reviews=false
```

또는 GitHub 레포 → Settings → Actions → General → "Workflow permissions" → "Read and write permissions" 선택 → Save.

이 단계가 빠지면 GHCR push 가 403 으로 실패해요 ([`pitfalls #5`](./dogfood-pitfalls.md)).

### 3.5 Supabase 연결 정보

Supabase Dashboard → Settings → Database → Connection string 에서 연결 문자열을 복사해요. Transaction pooler(`:6543`)를 권장해요. blue/green 배포가 겹치는 구간의 연결 폭증을 흡수하고, 앱 수가 늘어도 multiplex 로 확장돼요. Session pooler(`:5432`)도 동작은 하지만 연결 한도에 빨리 도달해요 (이 차이는 [`onboarding §4.3`](./onboarding.md#43-운영-db-provider-는-배포-시점에만-고르면-돼요) 참고).

복사한 문자열은 이런 모양이에요.

```
postgresql://postgres.sebqrqi...:[YOUR-PASSWORD]@aws-1-<region>.pooler.supabase.com:6543/postgres
```

이 문자열을 그대로 쓰면 안 돼요. JDBC 형식이 아니거든요 ([`pitfalls #11`](./dogfood-pitfalls.md)). 다음처럼 세 변수로 분리해서 `.env.prod` 에 넣어요.

```bash
DB_URL=jdbc:postgresql://aws-1-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true
DB_USER=postgres.sebqrqi...
DB_PASSWORD=<your-actual-password>
```

핵심은 세 가지예요.

- `jdbc:` prefix 가 필수예요.
- user 와 password 는 URL 안에 inline 하지 말고 별도 변수로 분리해요.
- `init-prod.sh` 가 `DB_URL` 의 시작 부분을 검증해서, 형식이 틀리면 즉시 멈춰요.

> `DB_PASSWORD` 는 `init-prod.sh` 가 자동 발급하지 않아요. 외부 DB 가 발급한 비밀번호를 그대로 쓰는 설계라, Supabase 의 실제 비밀번호로 채우는 걸 잊지 마세요.

#### 슬러그별 DataSource — `<SLUG>_DB_URL` 은 비워두세요

`<repo> new <slug>` 가 새 앱을 추가하면 슬러그별 DataSource 가 자동 등록돼요. 슬러그별 자격은 따로 채울 필요가 없어요. `AbstractAppDataSourceConfig` 의 derive 로직이 core 의 `DB_URL` 에서 `currentSchema=<slug>` 부분만 슬러그로 바꿔 끼우고, USER 와 PASSWORD 는 core 값을 그대로 재사용하기 때문이에요.

```bash
# .env.prod 의 슬러그별 자격은 비워둬요 — 자동 derive 됩니다
GYMLOG_DB_URL=
GYMLOG_DB_USER=
GYMLOG_DB_PASSWORD=
```

슬러그마다 별도의 DB role 로 분리하고 싶다면 명시적으로 채우면 그 값이 우선해요. 도그푸딩 단계에서는 core 자격을 재사용하는 흐름으로 시작하고, 운영이 안정된 뒤에 분리하는 순서를 권장해요.

코드는 `common/common-persistence/src/main/java/com/factory/common/persistence/AbstractAppDataSourceConfig.java` 의 `deriveSlugUrl` 이에요. 설계 근거는 [`ADR-018 · SchemaRoutingDataSource`](../philosophy/adr-018-schema-routing-datasource.md) 에 있어요.

### 3.6 Cloudflare Tunnel — 외부 도메인 접근 (선택)

내부 Tailscale IP 만으로 검증할 거면 건너뛰어도 돼요. 외부에서 `https://server.<도메인>` 으로 접근하려면 [`운영 배포 가이드 §2.3 ~ §2.6`](../production/deploy/deployment.md) 을 참고하세요.

`.env.prod` 의 도메인은 `BASE_DOMAIN` 과 `SUBDOMAIN` 두 값만 채우면 돼요. 그러면 `init-prod.sh` 가 `APP_DOMAIN` 과 `PUBLIC_HOSTNAME` 을 자동으로 합성해요. cloudflared 를 깔지 않더라도 `PUBLIC_HOSTNAME` 은 kamal-proxy 의 host-based routing 에 쓰이니 placeholder 라도 채워져 있어야 해요.

`CLOUDFLARE_API_TOKEN` 까지 채우면 `init-prod.sh` 가 Zone·Account·Tunnel ID 를 자동 추출하고 DNS CNAME 과 Tunnel ingress 까지 등록해줘요. 토큰 발급은 [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) 에서 하고, 권한은 Zone DNS Edit + Account Cloudflare Tunnel Edit 이 필요해요.

---

## 4. `init-prod.sh` 1회차 — `.env.prod` 자동 생성

```bash
bash tools/init-prod.sh <owner>/<repo>
# 예: bash tools/init-prod.sh storkspear/server-factory
# 또는: <repo> prod init storkspear/server-factory
# 또는: <repo> init storkspear/server-factory   (= local + prod 순차)
```

1회차에서 `init-prod.sh` 가 하는 일이에요.

1. **Step 1** — prereqs 검증 (JDK 21~25 · Docker · Node 18+ · `gh` CLI)
2. **Step 5** — `.env.prod.example` → `.env.prod` 복사 + 자동 채움. `JWT_SECRET`(openssl 랜덤), `KAMAL_SERVICE_NAME`(레포명), `DEPLOY_ENABLED=false`, PortOne webhook secret, `GHCR_USERNAME`/`KAMAL_IMAGE`(git remote 에서 derive)가 빈 자리에 들어가요.
3. **Step 5.5** — `BASE_DOMAIN` + `SUBDOMAIN` 이 채워져 있으면 `APP_DOMAIN`·`PUBLIC_HOSTNAME` 을 자동 합성해요.
4. **Step 6 진입** — `.env.prod` 의 REQUIRED 키가 아직 비어 있으니, 채우라고 안내한 뒤 정상 종료(`exit 0`)해요.

> 1회차에서는 Cloudflare 등록(Step 5.7/5.8)·Secrets push(Step 6)·검증(Step 10)까지 가지 않아요. `.env.prod` 의 빈 REQUIRED 를 채운 뒤 같은 명령을 다시 돌리는 것이 2회차예요.

로컬 docker 환경(`.env` · Postgres · MinIO)이 아직 없다면, 먼저 `bash tools/init-local.sh`(또는 `<repo> local init`)로 rename · `.env` · docker compose · 로컬 검증을 끝내고 오세요. 그건 별도 스크립트이고, `init-prod.sh` 는 운영만 다뤄요.

---

## 5. `.env.prod` 채우기

`.env.prod` 의 키는 우선순위 그룹으로 나뉘어 있어요. 사용자가 직접 채워야 할 건 [REQUIRED] 그룹뿐이고, [AUTO] 는 1회차가 알아서 채워요.

```bash
$EDITOR .env.prod
```

| 키 | 값 출처 |
|---|---|
| `BASE_DOMAIN` | 본인 도메인 (예: `example.com`). `SUBDOMAIN` 과 합쳐 `APP_DOMAIN`·`PUBLIC_HOSTNAME` 자동 합성 |
| `DB_URL` | §3.5 의 Supabase JDBC URL (`jdbc:postgresql://...` — `jdbc:` prefix 필수) |
| `DB_USER` | §3.5 의 Supabase user (`postgres.<ref>`) |
| `DB_PASSWORD` | §3.5 의 Supabase 실제 비밀번호 (자동 발급 안 됨) |
| `GHCR_TOKEN` | §3.1 의 GitHub PAT |
| `DEPLOY_HOST` | Mac mini Tailscale IP (`100.X.X.X`) |
| `DEPLOY_SSH_USER` | Mac mini 계정 (예: `storkspear`). `root` 는 macOS SSH 비활성이라 실패해요 ([`pitfalls #8`](./dogfood-pitfalls.md)) |
| `SSH_PRIVATE_KEY` | §3.3 의 Mac mini private key 전체 내용 |
| `TS_OAUTH_CLIENT_ID` · `TS_OAUTH_SECRET` | §3.2 의 Tailscale OAuth (배포 활성화 시 필수) |
| `CLOUDFLARE_API_TOKEN` | §3.6 의 Cloudflare 토큰 (외부 도메인 쓸 때만) |

`JWT_SECRET`·`KAMAL_SERVICE_NAME`·`APP_DOMAIN`·`PUBLIC_HOSTNAME`·`APP_FLYWAY_MODE` 등은 [AUTO] 그룹이라 1회차가 채워둬요. 직접 값을 넣으면 그 값이 우선해요.

### OPTIONAL 기능 — 켜고 싶으면 채워요

비워두면 운영에서 해당 기능이 자동으로 꺼져요(Stub·InMemory·Logging fallback). 채우면 켜져요.

| 기능 | 키 |
|---|---|
| 스토리지 | `APP_STORAGE_MINIO_ENDPOINT`, `APP_STORAGE_MINIO_ACCESS_KEY`, `APP_STORAGE_MINIO_SECRET_KEY`, `APP_STORAGE_MINIO_BUCKETS_0` |
| 이메일 | `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, `RESEND_FROM_NAME` |
| 결제 | `APP_PAYMENT_PORTONE_API_V1_KEY`, `APP_PAYMENT_PORTONE_API_V1_SECRET`, `APP_PAYMENT_PORTONE_WEBHOOK_SECRET` |
| 로깅 | `LOKI_URL` |
| 알림 | `DISCORD_WEBHOOK_URL` |

> `APP_STORAGE_MINIO_BUCKETS_0` 을 비우면 `BucketProvisioner` 가 자동 버킷 생성을 건너뛰어요(graceful skip). MinIO 콘솔에서 버킷을 직접 만들어 두고 ENDPOINT·ACCESS·SECRET 만 주입하는 운영 정책을 권장해요.

> 소셜 로그인 자격(`APP_CREDENTIALS_<SLUG>_*`)은 `init-prod.sh` 가 `.env.prod` 에서 자동 발견해 GitHub Secrets 로 push 해요. 다만 `config/deploy.yml` 과 `.kamal/secrets` 의 env.secret 목록 추가는 현재 수동이에요. 자세한 흐름은 [`FAQ Q17`](./dogfood-faq.md#q17) 를 보세요.

#### 결제 — 일부만 채우면 부팅이 막혀요

`<repo> new <slug>` 가 만드는 슬러그 컨트롤러(`*PaymentController`)가 `PaymentPort` 를 의존해요. prod profile 의 `PortOneProdConfigGuard` 는 v1 키·secret·webhook secret 셋 중 *일부만* 채워진 상태를 부팅 시점에 막아요. webhook 만 빠지면 위조 위험, v1 키만 빠지면 결제 불가 — 둘 다 사고라 `IllegalStateException` 으로 fail-fast 해요.

```bash
# 결제 미사용 — 도그푸딩 단계에서는 더미값으로 충분합니다
APP_PAYMENT_PORTONE_API_V1_KEY=dogfood-dummy
APP_PAYMENT_PORTONE_API_V1_SECRET=dogfood-dummy
APP_PAYMENT_PORTONE_WEBHOOK_SECRET=dogfood-dummy
```

정리하면, 막히는 건 "일부만 채운" 상태뿐이에요. 셋 다 비워 두면 `StubPaymentAdapter` 로 fallback 해 부팅은 통과하고(결제 호출만 graceful 503 `PAY_008` 으로 응답), 셋 다 채우면 실제 `PortOneAdapter` 가 켜져요. 위 예시처럼 더미값 셋을 채워도 결제 호출이 없으면 똑같이 stub 으로 동작하고요. 결제 모듈 자체를 빼고 싶으면 `APP_FEATURES_PAYMENT=false`(Lite 모드, ADR-034)를 쓰면 돼요. 정식 발급 절차는 [`운영 키 발급 통합 가이드 §4.7`](../production/setup/key-issuance.md#47-portone-pg-결제-featurepayment) 에 있어요.

코드는 `core/core-payment-impl/src/main/java/com/factory/core/payment/impl/PaymentAutoConfiguration.java` 의 `portOneProdConfigGuard` 예요.

---

## 6. `init-prod.sh` 2회차 — Secrets·Variables push + 검증

`.env.prod` 의 REQUIRED 를 다 채웠으면 같은 명령을 다시 실행해요.

```bash
bash tools/init-prod.sh <owner>/<repo>
# 또는: <repo> prod init <owner>/<repo>
```

이번엔 Step 5.5 이후까지 끝까지 진행돼요.

1. **Step 5.7/5.8** — `CLOUDFLARE_API_TOKEN` 이 있으면 Zone·Account·Tunnel ID 자동 추출 + DNS·Tunnel 등록 (멱등).
2. **Step 6** — `.env.prod` 검증 후 GitHub 에 push.
   - REQUIRED Secrets 8개: `APP_DOMAIN`, `DB_PASSWORD`, `DB_URL`, `DB_USER`, `GHCR_TOKEN`, `JWT_SECRET`, `SSH_PRIVATE_KEY`, `APP_FLYWAY_MODE`
   - 활성 OPTIONAL 기능의 키들(스토리지·이메일·결제·tailscale·로깅·알림) — 그룹별로 모두 채워졌을 때만 push, 하나라도 비면 그 기능은 비활성으로 안내
   - 소셜 로그인 자격(`APP_CREDENTIALS_*`) — `.env.prod` 에 있는 만큼 자동 발견·push
   - Variables 5개: `DEPLOY_ENABLED`, `DEPLOY_HOST`, `DEPLOY_SSH_USER`, `KAMAL_SERVICE_NAME`, `PUBLIC_HOSTNAME`
3. **Step 9.5** — `DEPLOY_HOST`·`DEPLOY_SSH_USER` 가 있으면 Mac mini 에 observability 스택(Loki·Grafana·Prometheus, Discord 있으면 Alertmanager 포함)을 docker compose 로 배포 (멱등).
4. **Step 10** — `verify-server.sh --init-mode` 자동 호출. 아직 배포 전이라 backend health 는 SKIP 하고, DB·SSH·Cloudflare·MinIO·Email·Loki 등 인프라만 검증해요 (다음 §7).

> 부분 실패를 놓치지 마세요. 일부 secret push 가 실패해도 후속 step 이 조용히 건너뛰어질 수 있어요. init 종료 후 `gh secret list -R <repo>` 로 등록된 개수를 직접 확인하는 걸 권장해요. 자세한 함정은 [`도그푸딩 walkthrough §4.7`](./dogfood-walkthrough.md) 에 있어요.

> 이 단계는 인프라 셋업과 검증까지만 해요. 실제 운영 배포는 다음 명령이에요.
> ```bash
> <repo> prod deploy       # blue/green 배포 (build + push + cutover)
> <repo> prod test         # 배포 후 e2e 검증 (backend health 포함)
> ```

---

## 7. `verify-server.sh` 7 단계 검증

`init-prod.sh` Step 10 이 `--init-mode` 로 자동 호출해요. 배포 후 단독 실행도 가능해요 (`<repo> prod test`, 또는 `--skip-deploy` 로 SSH·Tailscale 검증 생략).

| Step | 분류 | 항목 | PASS 의미 |
|---|---|---|---|
| 1 | REQUIRED | backend health (kamal-proxy → `/actuator/health`) | 운영 Spring 컨테이너가 응답. `--init-mode` 에선 배포 전이라 SKIP |
| 2 | REQUIRED | DB 연결 (psql 직접 ping) | backend 와 무관하게 psql `SELECT 1` 성공 |
| 3 | OPTIONAL: deploy | SSH + Tailscale (`kamal app version`) | GitHub Actions → Mac mini Tailscale 도달 OK |
| 4 | OPTIONAL: storage | MinIO 업로드 (PUT/STAT/DEL) | 스토리지 기능 활성 시 |
| 5 | OPTIONAL: email | Resend API 발송 | 이메일 기능 활성 시 (`RESEND_TEST_ADMIN_USER_EMAIL` 도 채워야 PASS) |
| 6 | OPTIONAL: logging | Loki readiness | 로깅 기능 활성 시 |
| 7 | OPTIONAL: alertmanager | Alertmanager 컨테이너 Up | 알림 기능 활성 시 (Discord 도착은 기술적으로 검증 불가) |

판정 규칙이에요.

- REQUIRED fail = 즉시 중단 — 운영 backend 가 자체 응답을 못 하는 상태예요.
- OPTIONAL fail = 경고 후 계속 진행.
- OPTIONAL 기능이 `.env.prod` 에서 비어 있으면 SKIP — 그 기능을 비활성으로 간주해요 (예: `RESEND_API_KEY=` 면 Step 5 SKIP).

기대 결과는 `DEPLOY_ENABLED=true` 이고 모든 OPTIONAL 이 활성일 때 **7/7 PASS** (`✅ 운영 가용 상태 — 활성 기능 모두 작동`)예요. `--init-mode` 에선 Step 1 이 SKIP 이라, 인프라 검증 통과 메시지가 대신 떠요.

> 첫 배포 전이라 운영 backend 가 아직 안 떠 있으면 (init-mode 가 아닌 일반 실행에서) Step 1 이 fail 해요. 그땐 `<repo> prod deploy` 로 배포한 뒤 `<repo> prod test` 를 다시 돌려보세요.

---

## 8. 로컬 부팅 검증

운영 셋업과 별개로, 로컬에서 Spring 이 뜨는지도 확인해 두면 좋아요.

```bash
./gradlew :bootstrap:bootRun
# → http://localhost:8081/actuator/health 가 UP
```

여기까지 UP 이면 도그푸딩 e2e 한 사이클을 통과한 거예요. 로컬 프로파일은 `application-local.yml` 의 default 값으로 동작하고 (DB `localhost:5433/postgres`, `JWT_SECRET` 자동 default 등), `.env` 에 값이 있으면 override 돼요.

자동 검증을 쓰려면 `<repo> local server-test` 를 돌려요. postgres ready(REQUIRED) · MinIO health(REQUIRED) · WireMock(OPTIONAL, OAuth dev-mock) · Spring Boot bootRun(OPTIONAL) 네 단계를 운영용 `verify-server.sh` 와 같은 패턴으로 검증해요.

---

## 9. Trial 환경 자동화 — `tools/dogfooding/setup.sh` + `cleanup.sh` (선택)

§4 ~ §6 의 `init-prod.sh` 흐름과 별개로, Mac mini 에 trial 환경을 임시로 올렸다가 한 번에 정리하고 싶을 때 쓰는 일괄 도구예요. GitHub 권한·SSH 키 등록·Secrets·Mac mini 컨테이너·GHCR 이미지를 한꺼번에 처리해요. 입력값은 `tools/dogfooding/.env.dogfood` 에 채워요 (`.env.dogfood.example` 복사).

`setup.sh` 가 하는 일이에요.

- 필수 변수 14개 검증 (`GH_REPO`·SSH 키 경로·DB·도메인·Tailscale 등) + `DB_URL` 형식 확인
- GitHub Actions workflow 권한 = write
- `gha_deploy` SSH 키 발급(없으면) + Mac mini authorized_keys 등록
- GitHub 에 Variables 2개(`KAMAL_SERVICE_NAME`, `DEPLOY_ENABLED`)와 Secrets 20개 등록
- `DEPLOY_ENABLED=true` 토글 후 (옵션) trigger commit push

`cleanup.sh` 는 그 역방향으로 자원을 정리해요 (default).

- GitHub Variables(최대 5개 시도) + Secrets 20개 삭제
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

`cleanup.sh` 는 멱등이라 두 번 실행해도 안전해요. 없는 자원은 `[WARN] ... 없음 (skip)` 으로 표시돼요.

> 외부 키 폐기는 사람이 직접 해야 해요. GitHub PAT 삭제 · Tailscale OAuth client 삭제 · (선택) Supabase 비밀번호 재설정이에요.

---

## 10. 보안 — 노출 시 즉시 폐기

이 가이드대로 발급한 키가 노출됐다면 (예: 채팅에 평문 전송, public commit 에 포함) 다음을 즉시 실행하세요.

1. 위 §9 의 `cleanup.sh` 또는 [`키 교체 절차`](../production/setup/key-rotation.md) 의 폐기 절차를 즉시 실행해요.
2. 새 키를 재발급해요.
3. `.env.prod` 를 갱신한 뒤 `init-prod.sh` 를 재실행해 새 키로 GitHub Secrets 를 자동 갱신해요.

---

## 11. 트러블슈팅

- 에러 메시지로 검색: [`도그푸딩 함정 모음`](./dogfood-pitfalls.md) 의 표
- 자주 묻는 질문: [`도그푸딩 FAQ`](./dogfood-faq.md)
- 시간 순 흐름 + 정착된 패턴: [`도그푸딩 walkthrough`](./dogfood-walkthrough.md)

---

## 다음 단계

도그푸딩 검증이 끝났다면 다음으로 진행하세요.

- 운영 장애 대응: [`운영 런북`](../production/deploy/runbook.md) — 평시·장애 운영 절차
- 템플릿 개선을 파생 레포로 전파: [`크로스 레포 Cherry-pick 가이드`](./cross-repo-cherry-pick.md)
- 공동 작업자 합류: [`FAQ Q12`](./dogfood-faq.md#q12) — 두 번째 이상 작업자의 fresh clone 흐름

---

## 관련 문서

- [`도그푸딩 walkthrough`](./dogfood-walkthrough.md) — 시간 순 narrative + 정착된 패턴
- [`CI/CD 전체 플로우`](../production/deploy/ci-cd-flow.md) — commit → 배포 전체 다이어그램
- [`도그푸딩 함정 모음`](./dogfood-pitfalls.md) — 15 함정 (11회 시도 + JDK 26 + 운영 함정 3건)
- [`도그푸딩 FAQ`](./dogfood-faq.md) — 자주 묻는 질문
- [`secret chain 4-stage 통합 가이드`](../production/setup/secret-chain-4stage.md) — 네 곳 매핑 + 체크리스트
- [`키 교체 절차`](../production/setup/key-rotation.md)
- [`운영 배포 가이드`](../production/deploy/deployment.md) — cloudflared 셋업, observability 등
- [`Mac mini 운영 호스트 설정`](../production/setup/mac-mini-setup.md)
- [`운영 런북`](../production/deploy/runbook.md) — 평시 배포 · 롤백 · 장애 대응
- [`ADR-018 · SchemaRoutingDataSource`](../philosophy/adr-018-schema-routing-datasource.md) — `deriveSlugUrl` 설계 근거
- [`ADR-019 · billing / IAP / payment 분리`](../philosophy/adr-019-billing-iap-payment-separation.md) — 결제 도메인 분리 결정

---

## 책 목차 — Journey 4~6단계

이 문서는 [`template-spring 책 목차 (Developer Journey)`](../onboarding/README.md) 의 4단계(외부 자격 증명) · 5단계(테스트) · 6단계(정리)를 한 문서로 통합해요.

| 방향 | 문서 | 한 줄 |
|---|---|---|
| ← 이전 | [`소셜 로그인 설정 가이드`](./social-auth-setup.md) | 4단계 첫 번째 — 소셜 로그인 자격 증명 |
| → 다음 | [`운영 배포 가이드`](../production/deploy/deployment.md) | 7단계 — 파생 레포 첫 운영 배포 |

**막혔을 때**: [`도그푸딩 함정 모음`](./dogfood-pitfalls.md) · [`도그푸딩 FAQ`](./dogfood-faq.md) · [`도그푸딩 walkthrough`](./dogfood-walkthrough.md)
**왜 이렇게?**: [`인프라 결정 기록`](../production/deploy/decisions-infra.md) — I-09 (Kamal 선택) · I-10 (GHCR PAT) · I-12 (workflow_run 게이트) · I-14 (Tailscale OAuth scope)
