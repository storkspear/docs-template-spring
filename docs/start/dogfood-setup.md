# 도그푸딩 환경 셋업 가이드

> **유형**: How-to · **독자**: Level 1 · **읽는 시간**: ~12분

**설계 근거**: [`ADR-002 (Use this template)`](../philosophy/adr-002-use-this-template.md)

template (또는 파생 레포) 가 자기 자신을 Mac mini 에 배포해서 한 사이클 검증하기 위한 가이드. **정상 흐름만** 다룸. 에러 만나면 → [`도그푸딩 함정 모음 (사고 실록)`](./dogfood-pitfalls.md).

> 결정 근거: [`인프라 결정 기록 (Decisions — Infrastructure) I-09 ~ I-14`](../production/deploy/decisions-infra.md)
> 전체 플로우: [`CI / CD 전체 플로우 — commit 부터 운영 반영까지`](../production/deploy/ci-cd-flow.md)
> 자주 묻는 질문: [`도그푸딩 FAQ`](./dogfood-faq.md)

---

## 1. 개요

### 무엇을 하나
- `tools/init-server.sh` 1·2회차 → `.env` / `.env.prod` 자동 생성 + GitHub Secrets / Variables push
- `tools/verify-server.sh` 7단계 검증 (init-server.sh Step 10 에서 자동 호출) — backend health UP / DB / SSH+TS / MinIO / Email / Loki / Alertmanager
- `./gradlew :bootstrap:bootRun` 으로 로컬 dev Spring 부팅 UP 까지 e2e 확인

### 누가 읽나
- "Use this template" 으로 만든 새 파생 레포의 **첫 작업자**
- 기존 파생 레포 셋업을 일부분 다시 검증하려는 사람

> **공동 작업자** (이미 셋업된 레포를 fresh clone 받은 두 번째+ 작업자) 는 다른 흐름 — 아래 [§1.5](#15-공동-작업자-모드-fresh-clone) 참조.

### 시간 비용
- 외부 리소스 발급 (한 번): ~20분
- `.env.prod` REQUIRED 5 채우기: ~5분
- `init-server.sh` 1·2회차 + `verify-server.sh`: ~10분
- **총 ~35분** (외부 리소스 이미 있으면 ~15분)

### 1.5 공동 작업자 모드 (fresh clone)

이미 첫 작업자가 `.env.prod` / Secrets / Variables 까지 모두 등록한 파생 레포를 새 팀원이 fresh clone 받은 경우, **§3~§7 의 외부 리소스 발급·`.env.prod` 채우기·Secrets push 를 모두 건너뜁니다.**

```bash
git clone <derived-repo>.git && cd <derived-repo>
bash tools/init-server.sh                  # ← REPO 인자 없음
```

- `init-server.sh` 가 3-sentinel(rename 완료 / `PROJECT_README_TEMPLATE.md` 부재 / `.env.prod` 부재) 로 공동 작업자 모드 자동 감지.
- Step 2/3/5/6/10 자동 skip → `.env` 생성 + docker compose + verify-local 만 진행.
- 운영 환경 변수 / Secrets 는 첫 작업자가 이미 GitHub 에 등록 완료 — 다시 push 하면 안 됨.
- 자세한 분기 로직: [`FAQ Q12`](./dogfood-faq.md#q12), [`FAQ Q14`](./dogfood-faq.md#q14).

이 흐름을 강제로 다시 첫 작업자처럼 돌려야 한다면(예: 운영 secrets 갈아엎기) `--reinit` 플래그 사용 — 운영 secrets 가 덮여 쓰일 위험이 있어 팀과 충분히 협의 후 진행.

---

## 2. 사전 준비물

| 항목 | 어디서 | 자세히 |
|---|---|---|
| GitHub repo | "Use this template" 또는 fork | §3.1 PAT 도 같이 준비 |
| Mac mini SSH 접근 | macOS 운영 호스트 | §3.3 |
| Tailscale 계정 + ACL admin | https://login.tailscale.com | §3.2 |
| Supabase 프로젝트 (Seoul region 권장) | https://supabase.com | §3.5 |
| (선택) 도메인 + Cloudflare 계정 | — | 외부 도메인 접근 필요시만 (§3.6) |

---

## 3. 외부 리소스 발급

각 항목에서 발급한 값은 §5 의 `.env.prod` 에 채워 넣습니다.

### 3.1 GitHub PAT (Personal Access Token Classic)

GHCR 에 docker 이미지 push 할 권한이 필요합니다. `GITHUB_TOKEN` 으론 첫 패키지 생성 시 권한이 부족 (알려진 이슈 — [`pitfalls #7`](./dogfood-pitfalls.md)) → PAT 사용.

**발급**:
1. https://github.com/settings/tokens → "Generate new token" → "Generate new token (classic)"
2. Note: `dogfood-template-spring`
3. Expiration: 90일 (또는 본인 정책)
4. **Scopes** 체크:
   - ☑ `write:packages`
   - ☑ `read:packages`
   - ☑ `delete:packages` (cleanup 용)
   - ☑ `repo` (write:packages 의 dependency)
5. "Generate token" → 즉시 복사 (한 번만 보임) → `.env.prod` 의 `GHCR_TOKEN` 으로

### 3.2 Tailscale OAuth client

GHA runner (GitHub 의 ubuntu VM) 가 Mac mini (Tailscale 사설 IP `100.x.x.x`) 에 도달하려면 매 배포마다 일회성 ephemeral device 로 tailnet 에 join 해야 함.

**3.2.1 ACL 의 `tagOwners` 정의 먼저** (한 번만)

https://login.tailscale.com/admin/acls/file 의 HuJSON 편집기에서 `tagOwners` 추가 (없으면 신규 섹션):

```hujson
"tagOwners": {
    "tag:ci": ["autogroup:admin"],
},
```

**Save** 누름. 이 단계 안 하면 다음 OAuth 발급 화면의 "Add tags" 드롭다운이 비활성 → tag:ci 부여 불가.

**3.2.2 OAuth client 발급**

https://login.tailscale.com/admin/settings/oauth → "Generate OAuth client":

- **Custom scopes** 선택, 다음 **2개 scope 모두** 체크 (둘 중 하나 빠지면 403 — [`pitfalls #4`](./dogfood-pitfalls.md)):
  - ☑ Devices → Core → **Write** + Tags `tag:ci` 추가
  - ☑ Keys → Auth Keys → **Write** + Tags `tag:ci` 추가
- 다른 scope (Posture, Routes, OAuth Keys, ...) 는 **모두 체크 해제**
- "Generate credential"
- **Client ID** + **Secret** 즉시 복사 → `.env.prod` 의 `TS_OAUTH_CLIENT_ID` + `TS_OAUTH_SECRET`

### 3.3 Mac mini SSH 키 준비 (자동화 측)

GHA → Mac mini 로 SSH 할 때 사용할 private key 가 필요. `.env.prod` 의 `SSH_PRIVATE_KEY` 에 **private key 의 전체 내용** (`-----BEGIN OPENSSH PRIVATE KEY-----` 부터 `-----END OPENSSH PRIVATE KEY-----` 까지) 을 그대로 넣음.

**옵션 A — 이미 있다면 (권장)**:
```bash
ssh -i ~/.ssh/macmini storkspear@100.X.X.X 'echo connected'
```
가 성공하면 OK. `.env.prod` 의 `SSH_PRIVATE_KEY=$(cat ~/.ssh/macmini)` 로 내용을 그대로 다중행 값으로 넣음 (gh secret set 이 자동 처리).

**옵션 B — 없다면**:
1. 새 키 생성 (passphrase 빈칸):
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/macmini -C "macmini-deploy@$(hostname)" -N ""
   ```
2. 공개키 (`~/.ssh/macmini.pub` 내용) 를 Mac mini 에 직접 등록 (화면공유 또는 모니터로 Mac mini 터미널 열고):
   ```bash
   mkdir -p ~/.ssh && chmod 700 ~/.ssh
   echo 'ssh-ed25519 AAAA... macmini-deploy@laptop' >> ~/.ssh/authorized_keys
   chmod 600 ~/.ssh/authorized_keys
   ```
3. 로컬에서 SSH 테스트.

> ⚠️ 한 줄로 복사하세요 — 키 중간에 줄바꿈 들어가면 인식 안 됨 (frequent gotcha).

### 3.4 Repo workflow permissions = write

GHCR push 권한 확보. 수동 또는 CLI:

```bash
gh api -X PUT "repos/<owner>/<repo>/actions/permissions/workflow" \
  -f default_workflow_permissions=write \
  -F can_approve_pull_request_reviews=false
```

또는 GitHub Repo → Settings → Actions → General → "Workflow permissions" → **"Read and write permissions"** 선택 → Save.

(이 단계 누락 시 GHCR push 403 — [`pitfalls #5`](./dogfood-pitfalls.md))

### 3.5 Supabase Connection 정보

Supabase Dashboard → Settings → Database → Connection string → **"Session pooler"** (transaction pooler 도 가능, 둘 다 5432 또는 6543 포트).

복사한 connection string 예시:
```
postgresql://postgres.sebqrqi...:[YOUR-PASSWORD]@aws-1-<region>.pooler.supabase.com:5432/postgres
```

**⚠️ 그대로 쓰면 안 됨** — JDBC 형식 아님 ([`pitfalls #11`](./dogfood-pitfalls.md)). 다음처럼 분리해 `.env.prod` 에:

```bash
DB_URL=jdbc:postgresql://aws-1-<region>.pooler.supabase.com:5432/postgres
DB_USER=postgres.sebqrqi...
DB_PASSWORD=<your-actual-password>
```

핵심:
- `jdbc:` prefix 필수
- user/password 는 URL 안에 inline 하지 말고 별도 변수로
- `init-server.sh` 가 `DB_URL` 시작 부분을 검증해서 잘못 넣으면 즉시 fail

> `DB_PASSWORD` 는 `init-server.sh` Step 5 에서 자동으로 무작위 발급된 값이 들어가있을 것. **Supabase 의 실제 비번으로 덮어쓰는 것을 잊지 마세요** — 자동 발급 값은 placeholder 일 뿐.

### 3.6 (선택) Cloudflare Tunnel — 외부 도메인 접근

내부 Tailscale IP 만으로 검증할 거면 skip. 외부에서 `https://server.<도메인>` 으로 접근 원하면 [`운영 배포 가이드 (파생레포 onboarding) §2.3 ~ §2.6`](../production/deploy/deployment.md) 참조.

`.env.prod` 의 `PUBLIC_HOSTNAME` 은 cloudflared 안 깔아도 placeholder 로 채워야 함 (kamal-proxy 의 host-based routing 에 사용).

---

## 4. `init-server.sh` 1회차 — `.env` / `.env.prod` 자동 생성

```bash
bash tools/init-server.sh <owner>/<repo>
# 예: bash tools/init-server.sh storkspear/server-factory
```

처리:
1. **Step 1**: prereqs 검증 (JDK 21+ / Docker / Node 18+ / `gh` CLI)
2. **Step 2**: 자동 rename (settings.gradle 등 6곳 — `template-spring` → `<repo-name>`)
3. **Step 3**: `PROJECT_README_TEMPLATE.md` → `README.md` 교체 + 원본 제거
4. **Step 4**: `.env.example` → `.env` 복사 (없으면)
5. **Step 5**: `.env.prod.example` → `.env.prod` 복사 + `JWT_SECRET` / `DB_PASSWORD` 자동 발급
6. **Step 6 (1회차 종료)**: `.env.prod` 의 REQUIRED 5 가 비어있으니 **에디터로 채우라고 안내 후 종료** (`exit 0`)

> 1회차 시점에 `Step 7~10` 까지는 도달하지 않습니다. `.env.prod` 채운 뒤 같은 명령을 다시 돌리는 것이 2회차.

---

## 5. `.env.prod` REQUIRED 5 채우기

§3 에서 발급한 값으로 `.env.prod` 의 다음 5 줄을 채움:

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

`DB_PASSWORD` 도 placeholder 자동값을 §3.5 의 실제 Supabase 비번으로 갈아끼우는 것을 잊지 마세요.

OPTIONAL — feature 켜고 싶으면 채움. 비어있으면 운영에서 자동 OFF (Step 6 에서 `[ ✗ ... 비활성화 ]` 안내):

| feature | 키 |
|---|---|
| storage | `APP_STORAGE_MINIO_ENDPOINT`, `APP_STORAGE_MINIO_ACCESS_KEY`, `APP_STORAGE_MINIO_SECRET_KEY`, `APP_STORAGE_MINIO_BUCKETS_0` |
| email | `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, `RESEND_FROM_NAME` |
| tailscale (DEPLOY_ENABLED=true 시 필수) | `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET` |
| logging | `LOKI_URL` |
| alertmanager | `DISCORD_WEBHOOK_URL` |

> **`APP_STORAGE_MINIO_BUCKETS_0` 비우면**: BucketProvisioner 가 graceful skip — 자동 버킷 생성 안 함. MinIO 콘솔에서 *수동 생성* 해두고 ENDPOINT/ACCESS/SECRET 만 주입하는 운영 정책 권장.

> **`APP_CREDENTIALS_<SLUG>_*` (소셜 로그인) 추가는 자동 push 만**: 자세한 흐름은 [`FAQ Q17`](./dogfood-faq.md#q17) 참조 — `init-server.sh` 는 GitHub Secrets 까지만 자동, `config/deploy.yml` + `.kamal/secrets` 의 env.secret 목록 추가는 *현재 수동*.

VARIABLE — Variables 로 등록 (Secrets 와 별도, 비민감):

| 키 | 의미 |
|---|---|
| `DEPLOY_ENABLED` | `true` 면 GHA deploy job 트리거. 검증 단계에서는 `false` 로도 시작 가능 |
| `DEPLOY_HOST` | Mac mini Tailscale IP (`100.X.X.X`) |
| `DEPLOY_SSH_USER` | Mac mini 계정 (예: `storkspear`). `root` 면 SSH 비대화형 fail ([`pitfalls #8`](./dogfood-pitfalls.md)) |
| `KAMAL_SERVICE_NAME` | kamal 서비스 이름 (예: `server-factory`) |
| `PUBLIC_HOSTNAME` | kamal-proxy host-based routing (예: `server.example.com`) |

---

## 6. `init-server.sh` 2회차 — Secrets / Variables push + `verify-server.sh`

같은 명령 재실행:

```bash
bash tools/init-server.sh <owner>/<repo>
```

이번엔 `.env.prod` REQUIRED 5 가 다 채워져 있어 Step 6 ~ 10 까지 진행:

- **Step 6** — GitHub Secrets push (REQUIRED 7 + 활성 OPTIONAL features) + Variables push (5)
  - REQUIRED 7: `APP_DOMAIN`, `DB_PASSWORD`, `DB_URL`, `DB_USER`, `GHCR_TOKEN`, `JWT_SECRET`, `SSH_PRIVATE_KEY`
  - OAuth credentials (`APP_CREDENTIALS_*`) 는 `.env.prod` 에 있는 만큼 자동 push (소셜 로그인 활성 시)
- **Step 7** — `npm install` (husky 훅 활성화)
- **Step 8** — `docker compose -f infra/docker-compose.dev.yml up -d postgres minio`
- **Step 9** — Postgres ready 대기 (최대 60초)
- **Step 10** — `verify-server.sh` 자동 호출 → 운영 환경 e2e 검증 (다음 §7)
- **Step 11** — `verify-local.sh` 자동 호출 → 로컬 dev 환경 e2e 검증 (postgres / minio / wiremock / Spring Boot, 모드 무관). Spring Boot 는 이 시점에 안 띄워졌으므로 SKIP — 사용자가 별도 터미널에서 `./gradlew :bootstrap:bootRun` 띄운 뒤 `bash tools/verify-local.sh` 다시 돌리면 4/4 PASS

---

## 7. `verify-server.sh` 7 단계 검증

`init-server.sh` Step 10 에서 자동 호출. 단독 실행도 가능: `bash tools/verify-server.sh` (또는 `--skip-deploy` 로 SSH/TS 검증 생략).

| Step | 분류 | 항목 | PASS 의미 |
|---|---|---|---|
| 1 | REQUIRED | backend health (kamal-proxy → `/actuator/health`) | 운영 Spring 컨테이너가 응답 |
| 2 | REQUIRED | DB 연결 (HikariCP) | backend health UP 이면 indirect PASS |
| 3 | OPTIONAL: deploy | SSH + Tailscale (`kamal app version`) | GHA → Mac mini Tailscale 도달 OK |
| 4 | OPTIONAL: storage | MinIO 업로드 (PUT/STAT/DEL) | storage feature 활성 시 |
| 5 | OPTIONAL: email | Resend API 발송 | email feature 활성 시 (RESEND_TEST_ADMIN_USER_EMAIL 도 채워야 PASS) |
| 6 | OPTIONAL: logging | Loki readiness | logging feature 활성 시 |
| 7 | OPTIONAL: alertmanager | Alertmanager 컨테이너 Up | alertmanager feature 활성 시 (Discord 도착은 기술 불가) |

REQUIRED fail = 즉시 중단 (운영 backend 가 자체 응답 못 함).
OPTIONAL fail = 경고 + 계속.
OPTIONAL feature 가 `.env.prod` 에서 비어있으면 SKIP (예: `RESEND_API_KEY=` 면 Step 5 SKIP, feature 비활성화로 간주).

기대 결과 (DEPLOY_ENABLED=true + 모든 OPTIONAL 활성화 시): **7/7 PASS** (`✅ 운영 가용 상태 — 활성 기능 모두 작동`).

> verify-server.sh 는 SSH 로 Mac mini 에 접속해서 backend health 와 storage/logging 을 검증합니다. 첫 배포 전이라 운영 backend 가 아직 안 떠 있으면 Step 1 fail. 그땐 deploy workflow 를 수동/푸시로 트리거 후 다시 돌려보세요.

---

## 8. 로컬 dev 부팅 검증

```bash
./gradlew :bootstrap:bootRun
# → http://localhost:8081/actuator/health == UP
```

이 결과까지 UP 이면 도그푸딩 e2e 한 사이클 통과. dev 프로파일은 `application-dev.yml` 의 default 값으로 동작 (DB: `localhost:5433/postgres`, JWT_SECRET: 자동 default 등) — `.env` 에 값이 있으면 override.

**자동 검증 (선택)**: `bash tools/verify-local.sh` — postgres ready (REQUIRED) / MinIO health (REQUIRED) / WireMock (OPTIONAL, OAuth dev-mock) / Spring Boot bootRun (OPTIONAL) 4 단계 자동 검증. 운영용 `verify-server.sh` 와 같은 패턴.

---

## 9. (선택) 옛 자동화 — `tools/dogfooding/setup.sh + cleanup.sh`

`init-server.sh` 흐름 이전에 사용하던 도그푸딩 자동화. **Mac mini 에 trial 환경을 임시로 올렸다가 한 번에 cleanup 하고 싶을 때** 별도로 사용 가능. 새 흐름과 별개로 유지.

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

멱등성: 두 번 실행해도 graceful (없는 자원은 `[WARN] ... 없음 (skip)`).

> 외부 키 폐기는 사람이 직접: GitHub PAT delete / Tailscale OAuth client delete / (선택) Supabase password reset.

---

## 10. 보안 — 노출 시 즉시 폐기

이 가이드의 절차대로 발급한 키들이 **노출되었다면** (예: 채팅에 평문 전송, public commit 에 포함):
1. 위 §9 cleanup 또는 [`키 교체 절차 (Key Rotation)`](../production/setup/key-rotation.md) 의 폐기 절차 즉시 실행
2. 새 키 재발급
3. `.env.prod` 갱신 후 `init-server.sh` 재실행 → 새 키로 GitHub Secrets 자동 갱신

---

## 11. 트러블슈팅

에러 만나면 → [`도그푸딩 함정 모음 (사고 실록)`](./dogfood-pitfalls.md) 의 표에서 에러 메시지로 검색.

자주 묻는 질문 → [`도그푸딩 FAQ`](./dogfood-faq.md)

---

## 다음 단계

도그푸딩 검증이 끝났다면:

- **운영 시 장애 대응**: [`운영 런북 (Runbook)`](../production/deploy/runbook.md) — 평시/장애 운영 절차
- **템플릿 개선을 파생 레포로 전파**: [`크로스 레포 Cherry-pick 가이드`](./cross-repo-cherry-pick.md)
- **공동 작업자 합류**: [`FAQ Q12`](./dogfood-faq.md#q12) — 두 번째+ 작업자 fresh clone 흐름

---

## 관련 문서

- [`CI / CD 전체 플로우 — commit 부터 운영 반영까지`](../production/deploy/ci-cd-flow.md) — commit→배포 전체 다이어그램
- [`도그푸딩 함정 모음 (사고 실록)`](./dogfood-pitfalls.md) — 12 함정 (11회 시도 + JDK 26 호환성 1건)
- [`도그푸딩 FAQ`](./dogfood-faq.md) — 자주 묻는 질문
- [`키 교체 절차 (Key Rotation)`](../production/setup/key-rotation.md) — 키 교체 절차
- [`운영 배포 가이드 (파생레포 onboarding)`](../production/deploy/deployment.md) — 운영 배포 (cloudflared 셋업, observability 등)
- [`Mac mini 운영 호스트 설정 — 레퍼런스`](../production/setup/mac-mini-setup.md) — Mac mini 운영 호스트 셋업
- [`운영 런북 (Runbook)`](../production/deploy/runbook.md) — 평시 배포 / 롤백 / 장애 대응

---

## 📖 책 목차 — Journey 4~6단계

[`📚 template-spring — 책 목차 (Developer Journey)`](../onboarding/README.md) 의 **4단계 (외부 자격 증명) · 5단계 (테스트) · 6단계 (정리)** 입니다. 한 문서가 세 단계를 통합합니다.

| 방향 | 문서 | 한 줄 |
|---|---|---|
| ← 이전 | [`소셜 로그인 설정 가이드`](./social-auth-setup.md) | 4단계 첫 번째, 소셜 로그인 자격 증명 |
| → 다음 | [`운영 배포 가이드 (파생레포 onboarding)`](../production/deploy/deployment.md) | 7단계, 파생 레포 첫 운영 배포 |

**막혔을 때**: [`도그푸딩 함정 모음 (사고 실록)`](./dogfood-pitfalls.md) / [`도그푸딩 FAQ`](./dogfood-faq.md)
**왜 이렇게?**: [`인프라 결정 기록 (Decisions — Infrastructure)`](../production/deploy/decisions-infra.md) — I-09 (Kamal 선택) / I-10 (GHCR PAT) / I-12 (workflow_run 게이트) / I-14 (Tailscale OAuth scope)
