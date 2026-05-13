# 도그푸딩 환경 셋업 가이드

> **유형**: How-to · **독자**: Level 1 · **읽는 시간**: ~12분

**설계 근거**: [`ADR-002 (Use this template)`](../philosophy/adr-002-use-this-template.md)

template (또는 파생 레포) 가 자기 자신을 Mac mini 에 배포해서 한 사이클 검증하기 위한 가이드예요. **정상 흐름만** 다뤄요. 에러를 만나면 → [`도그푸딩 함정 모음 (사고 실록)`](./dogfood-pitfalls.md) 또는 [`도그푸딩 walkthrough`](./dogfood-walkthrough.md) (시간 순 narrative) 를 보세요.

> 결정 근거: [`인프라 결정 기록 (Decisions — Infrastructure) I-09 ~ I-14`](../production/deploy/decisions-infra.md)
> 전체 플로우: [`CI / CD 전체 플로우 — commit 부터 운영 반영까지`](../production/deploy/ci-cd-flow.md)
> 자주 묻는 질문: [`도그푸딩 FAQ`](./dogfood-faq.md)

---

## 1. 개요

### 무엇을 하나요
- `tools/init-server.sh` 1·2회차 → `.env` / `.env.prod` 자동 생성 + GitHub Secrets / Variables push
- `tools/verify-server.sh` 7단계 검증 (init-server.sh Step 10 에서 자동 호출) — backend health UP / DB / SSH+TS / MinIO / Email / Loki / Alertmanager
- `./gradlew :bootstrap:bootRun` 으로 로컬 local Spring 부팅 UP 까지 e2e 확인

### 누가 읽나요
- "Use this template" 으로 만든 새 파생 레포의 **첫 작업자**
- 기존 파생 레포 셋업을 일부분 다시 검증하려는 사람

> **공동 작업자** (이미 셋업된 레포를 fresh clone 받은 두 번째 이상의 작업자) 는 다른 흐름을 따라요. 아래 [§1.5](#15-공동-작업자-모드-fresh-clone) 를 참조하세요.

### 시간 비용
- 외부 리소스 발급 (한 번): ~20분
- `.env.prod` REQUIRED 5 채우기: ~5분
- `init-server.sh` 1·2회차 + `verify-server.sh`: ~10분
- **총 ~35분** (외부 리소스가 이미 있으면 ~15분)

### 1.5 공동 작업자 모드 (fresh clone)

이미 첫 작업자가 `.env.prod` / Secrets / Variables 까지 모두 등록한 파생 레포를 새 팀원이 fresh clone 받은 경우엔 **§3~§7 의 외부 리소스 발급·`.env.prod` 채우기·Secrets push 를 모두 건너뛰어요.**

```bash
git clone <derived-repo>.git && cd <derived-repo>
bash tools/init-server.sh                  # ← REPO 인자 없음
```

- `init-server.sh` 가 3-sentinel(rename 완료 / `PROJECT_README_TEMPLATE.md` 부재 / `.env.prod` 부재) 로 공동 작업자 모드를 자동 감지해요.
- Step 2/3/5/6/10 자동 skip → `.env` 생성 + docker compose + verify-local 만 진행해요.
- 운영 환경 변수 / Secrets 는 첫 작업자가 이미 GitHub 에 등록 완료한 상태라 다시 push 하면 안 돼요.
- 자세한 분기 로직은 [`FAQ Q12`](./dogfood-faq.md#q12), [`FAQ Q14`](./dogfood-faq.md#q14) 에 정리돼 있어요.

이 흐름을 강제로 다시 첫 작업자처럼 돌려야 한다면 (예: 운영 secrets 갈아엎기) `--reinit` 플래그를 사용해요. 운영 secrets 가 덮여 쓰일 위험이 있어 팀과 충분히 협의 후 진행하세요.

---

## 2. 사전 준비물

| 항목 | 어디서 | 자세히 |
|---|---|---|
| GitHub repo | "Use this template" 또는 fork | §3.1 PAT 도 같이 준비 |
| Mac mini SSH 접근 | macOS 운영 호스트 | §3.3 |
| Tailscale 계정 + ACL admin | https://login.tailscale.com | §3.2 |
| Supabase 프로젝트 (Seoul region 권장) | https://supabase.com | §3.5 |
| (선택) 도메인 + Cloudflare 계정 | — | 외부 도메인 접근 필요 시만 (§3.6) |

---

## 3. 외부 리소스 발급

각 항목에서 발급한 값은 §5 의 `.env.prod` 에 채워 넣어요.

> 이 절은 도그푸딩에 *반드시 필요한 5 가지* (PAT / Tailscale / SSH / workflow 권한 / Supabase) 만 다뤄요. 운영에서 사용하는 다른 키들 (Cloudflare / Resend / MinIO / PortOne / IAP / Loki / Discord) 의 발급 목적·절차·`.env.prod` 채울 위치를 한 곳에서 보려면 [`운영 키 발급 통합 가이드`](../production/setup/key-issuance.md) 를 참고하세요. 이 §3 은 그 통합 가이드의 *도그푸딩 핵심 5 항목 발췌* 예요.

### 3.1 GitHub PAT (Personal Access Token Classic)

GHCR 에 docker 이미지 push 할 권한이 필요해요. `GITHUB_TOKEN` 으론 첫 패키지 생성 시 권한이 부족해요 (알려진 이슈 — [`pitfalls #7`](./dogfood-pitfalls.md)). 그래서 PAT 를 사용해요.

**발급**:
1. https://github.com/settings/tokens → "Generate new token" → "Generate new token (classic)"
2. Note: `dogfood-template-spring`
3. Expiration: 90일 (또는 본인 정책)
4. **Scopes** 체크:
   - ☑ `write:packages`
   - ☑ `read:packages`
   - ☑ `delete:packages` (cleanup 용)
   - ☑ `repo` (write:packages 의 dependency)
5. "Generate token" → 즉시 복사 (한 번만 보여요) → `.env.prod` 의 `GHCR_TOKEN` 에 붙여 넣어요

### 3.2 Tailscale OAuth client

GHA runner (GitHub 의 ubuntu VM) 가 Mac mini (Tailscale 사설 IP `100.x.x.x`) 에 도달하려면 매 배포마다 일회성 ephemeral device 로 tailnet 에 join 해야 해요.

**3.2.1 ACL 의 `tagOwners` 정의 먼저** (한 번만)

https://login.tailscale.com/admin/acls/file 의 HuJSON 편집기에서 `tagOwners` 를 추가하세요 (없으면 신규 섹션):

```hujson
"tagOwners": {
    "tag:ci": ["autogroup:admin"],
},
```

**Save** 를 누르세요. 이 단계를 안 하면 다음 OAuth 발급 화면의 "Add tags" 드롭다운이 비활성화돼서 tag:ci 를 부여할 수 없어요.

**3.2.2 OAuth client 발급**

https://login.tailscale.com/admin/settings/oauth → "Generate OAuth client":

- **Custom scopes** 선택, 다음 **2개 scope 모두** 체크 (둘 중 하나 빠지면 403 — [`pitfalls #4`](./dogfood-pitfalls.md))
  - ☑ Devices → Core → **Write** + Tags `tag:ci` 추가
  - ☑ Keys → Auth Keys → **Write** + Tags `tag:ci` 추가
- 다른 scope (Posture, Routes, OAuth Keys, ...) 는 **모두 체크 해제**
- "Generate credential"
- **Client ID** + **Secret** 즉시 복사해서 `.env.prod` 의 `TS_OAUTH_CLIENT_ID` + `TS_OAUTH_SECRET` 에 붙여 넣어요

### 3.3 Mac mini SSH 키 준비 (자동화 측)

GHA → Mac mini 로 SSH 할 때 사용할 private key 가 필요해요. `.env.prod` 의 `SSH_PRIVATE_KEY` 에 **private key 의 전체 내용** (`-----BEGIN OPENSSH PRIVATE KEY-----` 부터 `-----END OPENSSH PRIVATE KEY-----` 까지) 을 그대로 넣어요.

**옵션 A — 이미 있다면 (권장)**:
```bash
ssh -i ~/.ssh/macmini storkspear@100.X.X.X 'echo connected'
```
가 성공하면 OK. `.env.prod` 의 `SSH_PRIVATE_KEY=$(cat ~/.ssh/macmini)` 로 내용을 그대로 다중행 값으로 넣어요 (gh secret set 이 자동 처리해요).

**옵션 B — 없다면**:
1. 새 키 생성 (passphrase 빈칸):
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/macmini -C "macmini-deploy@$(hostname)" -N ""
   ```
2. 공개키 (`~/.ssh/macmini.pub` 내용) 를 Mac mini 에 직접 등록해요 (화면공유 또는 모니터로 Mac mini 터미널을 열고):
   ```bash
   mkdir -p ~/.ssh && chmod 700 ~/.ssh
   echo 'ssh-ed25519 AAAA... macmini-deploy@laptop' >> ~/.ssh/authorized_keys
   chmod 600 ~/.ssh/authorized_keys
   ```
3. 로컬에서 SSH 테스트.

> ⚠️ 한 줄로 복사하세요 — 키 중간에 줄바꿈이 들어가면 인식이 안 돼요 (frequent gotcha).

### 3.4 Repo workflow permissions = write

GHCR push 권한을 확보해요. 수동 또는 CLI 로 처리할 수 있어요.

```bash
gh api -X PUT "repos/<owner>/<repo>/actions/permissions/workflow" \
  -f default_workflow_permissions=write \
  -F can_approve_pull_request_reviews=false
```

또는 GitHub Repo → Settings → Actions → General → "Workflow permissions" → **"Read and write permissions"** 선택 → Save.

(이 단계가 누락되면 GHCR push 가 403 으로 실패해요 — [`pitfalls #5`](./dogfood-pitfalls.md))

### 3.5 Supabase Connection 정보

Supabase Dashboard → Settings → Database → Connection string → **"Session pooler"** 를 선택해요 (transaction pooler 도 가능, 둘 다 5432 또는 6543 포트).

복사한 connection string 예시:
```
postgresql://postgres.sebqrqi...:[YOUR-PASSWORD]@aws-1-<region>.pooler.supabase.com:5432/postgres
```

**⚠️ 그대로 쓰면 안 돼요** — JDBC 형식이 아니에요 ([`pitfalls #11`](./dogfood-pitfalls.md)). 다음처럼 분리해서 `.env.prod` 에 넣어요.

```bash
DB_URL=jdbc:postgresql://aws-1-<region>.pooler.supabase.com:5432/postgres
DB_USER=postgres.sebqrqi...
DB_PASSWORD=<your-actual-password>
```

핵심:
- `jdbc:` prefix 가 필수예요
- user/password 는 URL 안에 inline 하지 말고 별도 변수로 분리해요
- `init-server.sh` 가 `DB_URL` 시작 부분을 검증해서 잘못 넣으면 즉시 fail 해요

> `DB_PASSWORD` 는 `init-server.sh` Step 5 에서 자동으로 무작위 발급된 값이 들어가 있을 거예요. **Supabase 의 실제 비밀번호로 덮어쓰는 것을 잊지 마세요** — 자동 발급 값은 placeholder 일 뿐이에요.

#### 슬러그별 DataSource — `<SLUG>_DB_URL` 은 비워두세요

`<your-backend> new <slug>` 가 새 앱을 추가하면 슬러그별 DataSource 가 자동으로 등록돼요. 슬러그별 자격은 별도로 채울 필요가 없어요. `AbstractAppDataSourceConfig` 의 derive 로직이 core 의 `DB_URL` 에서 `currentSchema=<slug>` 부분만 슬러그로 자동 교체하기 때문이에요 (USER 와 PASSWORD 도 core 의 값을 그대로 재사용해요).

```bash
# .env.prod 의 슬러그별 자격은 비워둬요 — 자동 derive 돼요
GYMLOG_DB_URL=
GYMLOG_DB_USER=
GYMLOG_DB_PASSWORD=
```

슬러그별로 별도의 DB role 을 분리하고 싶은 경우 (per-slug role 정책) 에는 명시적으로 채우면 그 값이 우선해요. 도그푸딩 단계에서는 core 자격을 재사용하는 흐름으로 시작하고, 운영이 안정된 뒤에 분리하는 순서를 권장해요.

→ 코드: `common/common-persistence/src/main/java/com/factory/common/persistence/AbstractAppDataSourceConfig.java` 의 `deriveSlugUrl`. 더 깊은 설계 근거는 [`ADR-018 — SchemaRoutingDataSource`](../philosophy/adr-018-schema-routing-datasource.md).

### 3.6 (선택) Cloudflare Tunnel — 외부 도메인 접근

내부 Tailscale IP 만으로 검증할 거면 skip 해도 돼요. 외부에서 `https://server.<도메인>` 으로 접근하려면 [`운영 배포 가이드 (파생레포 onboarding) §2.3 ~ §2.6`](../production/deploy/deployment.md) 을 참조하세요.

`.env.prod` 의 `PUBLIC_HOSTNAME` 은 cloudflared 를 안 깔아도 placeholder 로 채워야 해요 (kamal-proxy 의 host-based routing 에 사용돼요).

---

## 4. `init-server.sh` 1회차 — `.env` / `.env.prod` 자동 생성

```bash
bash tools/init-server.sh <owner>/<repo>
# 예: bash tools/init-server.sh storkspear/server-factory
```

처리 순서:
1. **Step 1**: prereqs 검증 (JDK 21+ / Docker / Node 18+ / `gh` CLI)
2. **Step 2**: 자동 rename (settings.gradle 등 6곳 — `template-spring` → `<repo-name>`)
3. **Step 3**: `PROJECT_README_TEMPLATE.md` → `README.md` 교체 + 원본 제거
4. **Step 4**: `.env.example` → `.env` 복사 (없으면)
5. **Step 5**: `.env.prod.example` → `.env.prod` 복사 + `JWT_SECRET` / `DB_PASSWORD` 자동 발급
6. **Step 6 (1회차 종료)**: `.env.prod` 의 REQUIRED 5 가 비어있으니 **에디터로 채우라고 안내 후 종료** (`exit 0`)

> 1회차 시점엔 `Step 7~11` 까지 도달하지 않아요. `.env.prod` 를 채운 뒤 같은 명령을 다시 돌리는 것이 2회차예요.

---

## 5. `.env.prod` REQUIRED 5 채우기

§3 에서 발급한 값으로 `.env.prod` 의 다음 5 줄을 채워요.

```bash
$EDITOR .env.prod
```

| 키 | 값 출처 |
|---|---|
| `APP_DOMAIN` | §3.6 의 도메인 (예: `https://server.example.com`). cloudflared 안 깔면 placeholder OK |
| `DB_URL` | §3.5 의 Supabase JDBC URL (`jdbc:postgresql://...` — `jdbc:` prefix 필수) |
| `DB_USER` | §3.5 의 Supabase user (`postgres.<ref>`) |
| `GHCR_TOKEN` | §3.1 의 GitHub PAT |
| `SSH_PRIVATE_KEY` | §3.3 의 Mac mini private key 전체 내용 (`-----BEGIN ... -----END ...`) |

`DB_PASSWORD` 도 placeholder 자동값을 §3.5 의 실제 Supabase 비밀번호로 갈아끼우는 것을 잊지 마세요.

OPTIONAL — feature 를 켜고 싶으면 채워요. 비어있으면 운영에서 자동 OFF 돼요 (Step 6 에서 `[ ✗ ... 비활성화 ]` 안내).

| feature | 키 |
|---|---|
| storage | `APP_STORAGE_MINIO_ENDPOINT`, `APP_STORAGE_MINIO_ACCESS_KEY`, `APP_STORAGE_MINIO_SECRET_KEY`, `APP_STORAGE_MINIO_BUCKETS_0` |
| email | `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, `RESEND_FROM_NAME` |
| tailscale (DEPLOY_ENABLED=true 시 필수) | `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET` |
| logging | `LOKI_URL` |
| alertmanager | `DISCORD_WEBHOOK_URL` |

> **`APP_STORAGE_MINIO_BUCKETS_0` 비우면**: BucketProvisioner 가 graceful skip 해서 자동 버킷 생성을 안 해요. MinIO 콘솔에서 *수동 생성* 해두고 ENDPOINT/ACCESS/SECRET 만 주입하는 운영 정책을 권장해요.

> **`APP_CREDENTIALS_<SLUG>_*` (소셜 로그인) 추가는 자동 push 만**: 자세한 흐름은 [`FAQ Q17`](./dogfood-faq.md#q17) 를 참조하세요. `init-server.sh` 는 GitHub Secrets 까지만 자동이고, `config/deploy.yml` + `.kamal/secrets` 의 env.secret 목록 추가는 *현재 수동* 이에요.

#### ⚠ payment — 결제 미사용이라도 어떤 값이든 채워야 운영 부팅이 가능해요

`<your-backend> new <slug>` 가 생성하는 슬러그 컨트롤러 (`*PaymentController`) 가 `PaymentPort` 를 필수로 의존해요. prod profile 의 `PortOneProdConfigGuard` 가 부팅 시 v1 키와 webhook secret 의 비어있지 않음을 검증하기 때문에, 미설정 시 `IllegalStateException` 으로 부팅이 차단돼요.

```bash
# 결제 미사용 — 도그푸딩 단계에서는 더미값으로 충분해요
APP_PAYMENT_PORTONE_API_V1_KEY=dogfood-dummy
APP_PAYMENT_PORTONE_API_V1_SECRET=dogfood-dummy
APP_PAYMENT_PORTONE_WEBHOOK_SECRET=dogfood-dummy

# 실제 결제 시작 — PortOne 콘솔 발급값으로 교체해요
```

세 키 모두 비어있지 않게 채우면 부팅은 통과해요. 결제 호출이 실제로 발생하지 않는 한 더미값으로도 운영이 가능해요 (`StubPaymentAdapter` 가 graceful 503 으로 응답해서 IAP 와 같은 패턴을 유지해요). PortOne 콘솔에서 발급받는 정식 절차는 [`운영 키 발급 통합 가이드 §4.7`](../production/setup/key-issuance.md#47-portone-pg-결제-featurepayment) 을 참조하세요.

→ 코드: `core/core-payment-impl/src/main/java/com/factory/core/payment/impl/PaymentAutoConfiguration.java` 의 `portOneProdConfigGuard`

VARIABLE — Variables 로 등록해요 (Secrets 와 별도, 비민감 값).

| 키 | 의미 |
|---|---|
| `DEPLOY_ENABLED` | `true` 면 GHA deploy job 트리거. 검증 단계에서는 `false` 로도 시작 가능 |
| `DEPLOY_HOST` | Mac mini Tailscale IP (`100.X.X.X`) |
| `DEPLOY_SSH_USER` | Mac mini 계정 (예: `storkspear`). `root` 면 SSH 비대화형 fail ([`pitfalls #8`](./dogfood-pitfalls.md)) |
| `KAMAL_SERVICE_NAME` | kamal 서비스 이름 (예: `server-factory`) |
| `PUBLIC_HOSTNAME` | kamal-proxy host-based routing (예: `server.example.com`) |

---

## 6. `init-server.sh` 2회차 — Secrets / Variables push + `verify-server.sh`

같은 명령을 재실행해요.

```bash
bash tools/init-server.sh <owner>/<repo>
```

이번엔 `.env.prod` REQUIRED 5 가 다 채워져 있어 Step 6 ~ 11 까지 진행돼요.

- **Step 6** — GitHub Secrets push (REQUIRED 7 + 활성 OPTIONAL features) + Variables push (5)
  - REQUIRED 7: `APP_DOMAIN`, `DB_PASSWORD`, `DB_URL`, `DB_USER`, `GHCR_TOKEN`, `JWT_SECRET`, `SSH_PRIVATE_KEY`
  - OAuth credentials (`APP_CREDENTIALS_*`) 는 `.env.prod` 에 있는 만큼 자동 push (소셜 로그인 활성 시)
- **Step 7** — `npm install` (husky 훅 활성화)
- **Step 8** — `docker compose -f infra/docker-compose.local.yml up -d postgres minio`
- **Step 9** — Postgres ready 대기 (최대 60초)
- **Step 10** — `verify-server.sh` 자동 호출 → 운영 환경 e2e 검증 (다음 §7)
- **Step 11** — `verify-local.sh` 자동 호출 → 로컬 local 환경 e2e 검증. Spring Boot 는 이 시점에 안 띄워져서 SKIP 돼요 — 사용자가 별도 터미널에서 `./gradlew :bootstrap:bootRun` 띄운 뒤 `<repo-name> local server-test` 다시 돌리면 4/4 PASS 가 나와요.

> **부분 실패 인지성** — 만약 일부 secret push 가 실패하면 Step 6 의 "[OK] 등록 완료" 가 출력되더라도 *후속 step 이 silently skip* 될 수 있어요. init 종료 후 `gh secret list -R <repo>` 로 등록된 secret 개수를 직접 확인하는 것을 권장해요. 자세한 함정은 [`도그푸딩 walkthrough §4.7`](./dogfood-walkthrough.md) 을 참조하세요.

---

## 7. `verify-server.sh` 7 단계 검증

`init-server.sh` Step 10 에서 자동 호출돼요. 단독 실행도 가능해요: `<repo-name> prod server-test` (또는 `--skip-deploy` 로 SSH/TS 검증을 생략).

| Step | 분류 | 항목 | PASS 의미 |
|---|---|---|---|
| 1 | REQUIRED | backend health (kamal-proxy → `/actuator/health`) | 운영 Spring 컨테이너가 응답 |
| 2 | REQUIRED | DB 연결 (HikariCP) | backend health UP 이면 indirect PASS |
| 3 | OPTIONAL: deploy | SSH + Tailscale (`kamal app version`) | GHA → Mac mini Tailscale 도달 OK |
| 4 | OPTIONAL: storage | MinIO 업로드 (PUT/STAT/DEL) | storage feature 활성 시 |
| 5 | OPTIONAL: email | Resend API 발송 | email feature 활성 시 (RESEND_TEST_ADMIN_USER_EMAIL 도 채워야 PASS) |
| 6 | OPTIONAL: logging | Loki readiness | logging feature 활성 시 |
| 7 | OPTIONAL: alertmanager | Alertmanager 컨테이너 Up | alertmanager feature 활성 시 (Discord 도착은 기술적으로 검증 불가) |

REQUIRED fail = 즉시 중단 (운영 backend 가 자체 응답을 못 하는 상태).
OPTIONAL fail = 경고 + 계속 진행.
OPTIONAL feature 가 `.env.prod` 에서 비어있으면 SKIP (예: `RESEND_API_KEY=` 면 Step 5 SKIP, feature 비활성화로 간주).

기대 결과 (DEPLOY_ENABLED=true + 모든 OPTIONAL 활성화 시): **7/7 PASS** (`✅ 운영 가용 상태 — 활성 기능 모두 작동`).

> verify-server.sh 는 SSH 로 Mac mini 에 접속해서 backend health 와 storage/logging 을 검증해요. 첫 배포 전이라 운영 backend 가 아직 안 떠 있으면 Step 1 fail 이 나요. 그땐 deploy workflow 를 수동 / push 로 트리거 후에 다시 돌려보세요.

---

## 8. 로컬 local 부팅 검증

```bash
./gradlew :bootstrap:bootRun
# → http://localhost:8081/actuator/health == UP
```

이 결과까지 UP 이면 도그푸딩 e2e 한 사이클을 통과한 거예요. local 프로파일은 `application-dev.yml` 의 default 값으로 동작해요 (DB: `localhost:5433/postgres`, JWT_SECRET: 자동 default 등) — `.env` 에 값이 있으면 override 돼요.

**자동 검증 (선택)**: `<repo-name> local server-test` — postgres ready (REQUIRED) / MinIO health (REQUIRED) / WireMock (OPTIONAL, OAuth dev-mock) / Spring Boot bootRun (OPTIONAL) 의 4 단계를 자동 검증해요. 운영용 `verify-server.sh` 와 같은 패턴이에요.

---

## 9. (선택) Trial 환경 자동화 — `tools/dogfooding/setup.sh + cleanup.sh`

`init-server.sh` (1·2회차 셋업) 와 별개로 **Mac mini 에 trial 환경을 임시로 올렸다가 한 번에 cleanup 하고 싶을 때** 사용해요. GHA permissions / SSH key 등록 / GitHub Secrets / Mac mini 컨테이너 / GHCR 이미지를 일괄 처리합니다.

cleanup.sh 동작 (default):
- GitHub Variables/Secrets 22개 모두 삭제
- Mac mini 의 spring 컨테이너 + kamal-proxy 컨테이너 삭제
- Mac mini 의 `authorized_keys` 에서 `gha-deploy@<service>` 줄 제거
- GHCR 패키지 (모든 tag) 삭제
- 외부 키 수동 폐기 안내 출력 (PAT, Tailscale OAuth, Supabase password)

옵션:
- `--keep-proxy` — kamal-proxy 컨테이너 유지 (다음 배포 즉시 가능)
- `--keep-ssh` — Mac mini authorized_keys 의 gha-deploy 줄 유지
- `--restore-perms` — workflow permissions 를 read 로 복원
- `--yes` / `-y` — confirm prompt 생략

멱등성 — 두 번 실행해도 graceful 하게 동작해요 (없는 자원은 `[WARN] ... 없음 (skip)` 으로 표시돼요).

> 외부 키 폐기는 사람이 직접 해야 해요 — GitHub PAT delete / Tailscale OAuth client delete / (선택) Supabase password reset.

---

## 10. 보안 — 노출 시 즉시 폐기

이 가이드의 절차대로 발급한 키들이 **노출되었다면** (예: 채팅에 평문 전송, public commit 에 포함) 다음 절차를 즉시 실행하세요.

1. 위 §9 cleanup 또는 [`키 교체 절차 (Key Rotation)`](../production/setup/key-rotation.md) 의 폐기 절차 즉시 실행
2. 새 키 재발급
3. `.env.prod` 갱신 후 `init-server.sh` 재실행 → 새 키로 GitHub Secrets 자동 갱신

---

## 11. 트러블슈팅

에러를 만나면 → [`도그푸딩 함정 모음 (사고 실록)`](./dogfood-pitfalls.md) 의 표에서 에러 메시지로 검색하세요.

자주 묻는 질문 → [`도그푸딩 FAQ`](./dogfood-faq.md)

시간 순 흐름 + 정착된 패턴 → [`도그푸딩 walkthrough`](./dogfood-walkthrough.md)

---

## 다음 단계

도그푸딩 검증이 끝났다면 다음으로 진행하세요.

- **운영 시 장애 대응**: [`운영 런북 (Runbook)`](../production/deploy/runbook.md) — 평시/장애 운영 절차
- **템플릿 개선을 파생 레포로 전파**: [`크로스 레포 Cherry-pick 가이드`](./cross-repo-cherry-pick.md)
- **공동 작업자 합류**: [`FAQ Q12`](./dogfood-faq.md#q12) — 두 번째 이상의 작업자 fresh clone 흐름

---

## 관련 문서

- [`도그푸딩 walkthrough`](./dogfood-walkthrough.md) — 시간 순 narrative + 정착된 패턴
- [`CI / CD 전체 플로우 — commit 부터 운영 반영까지`](../production/deploy/ci-cd-flow.md) — commit → 배포 전체 다이어그램
- [`도그푸딩 함정 모음 (사고 실록)`](./dogfood-pitfalls.md) — 12 함정 (11회 시도 + JDK 26 호환성 1건)
- [`도그푸딩 FAQ`](./dogfood-faq.md) — 자주 묻는 질문
- [`secret chain 4-stage 통합 가이드`](../production/setup/secret-chain-4stage.md) — 4 곳 매핑 + 체크리스트
- [`키 교체 절차 (Key Rotation)`](../production/setup/key-rotation.md) — 키 교체 절차
- [`운영 배포 가이드 (파생레포 onboarding)`](../production/deploy/deployment.md) — 운영 배포 (cloudflared 셋업, observability 등)
- [`Mac mini 운영 호스트 설정 — 레퍼런스`](../production/setup/mac-mini-setup.md) — Mac mini 운영 호스트 셋업
- [`운영 런북 (Runbook)`](../production/deploy/runbook.md) — 평시 배포 / 롤백 / 장애 대응
- [`ADR-018 — SchemaRoutingDataSource`](../philosophy/adr-018-schema-routing-datasource.md) — `deriveSlugUrl` 의 설계 근거
- [`ADR-019 — billing / IAP / payment 분리`](../philosophy/adr-019-billing-iap-payment-separation.md) — 결제 도메인 분리 결정

---

## 📖 책 목차 — Journey 4~6단계

[`📚 template-spring — 책 목차 (Developer Journey)`](../onboarding/README.md) 의 **4단계 (외부 자격 증명) · 5단계 (테스트) · 6단계 (정리)** 예요. 한 문서가 세 단계를 통합해요.

| 방향 | 문서 | 한 줄 |
|---|---|---|
| ← 이전 | [`소셜 로그인 설정 가이드`](./social-auth-setup.md) | 4단계 첫 번째, 소셜 로그인 자격 증명 |
| → 다음 | [`운영 배포 가이드 (파생레포 onboarding)`](../production/deploy/deployment.md) | 7단계, 파생 레포 첫 운영 배포 |

**막혔을 때**: [`도그푸딩 함정 모음 (사고 실록)`](./dogfood-pitfalls.md) / [`도그푸딩 FAQ`](./dogfood-faq.md) / [`도그푸딩 walkthrough`](./dogfood-walkthrough.md)
**왜 이렇게?**: [`인프라 결정 기록 (Decisions — Infrastructure)`](../production/deploy/decisions-infra.md) — I-09 (Kamal 선택) / I-10 (GHCR PAT) / I-12 (workflow_run 게이트) / I-14 (Tailscale OAuth scope)
