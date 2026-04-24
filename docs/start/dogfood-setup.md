# 도그푸딩 환경 셋업 가이드

> **유형**: How-to · **독자**: Level 1 · **읽는 시간**: ~12분

**설계 근거**: [ADR-002 (Use this template)](../philosophy/adr-002-use-this-template.md)

template (또는 파생 레포) 가 자기 자신을 Mac mini 에 배포해서 한 사이클 검증하기 위한 가이드. **정상 흐름만** 다룸. 에러 만나면 → [도그푸딩 함정 모음 (사고 실록)](./dogfood-pitfalls.md).

> 결정 근거: [인프라 결정 기록 (Decisions — Infrastructure) I-09 ~ I-14](../production/deploy/decisions-infra.md)
> 전체 플로우: [CI / CD 전체 플로우 — commit 부터 운영 반영까지](../production/deploy/ci-cd-flow.md)
> 자주 묻는 질문: [도그푸딩 FAQ](./dogfood-faq.md)

---

## 1. 개요

### 무엇을 하나
- GHA → Mac mini Kamal blue/green 으로 Spring 컨테이너 배포
- `tools/dogfooding/setup.sh` 한 번 실행 + 끝나면 `cleanup.sh` 한 번으로 template 순수 상태 복원

### 누가 읽나
- 새 파생 레포를 첫 배포해보려는 사람
- 기존 도그푸딩을 cleanup 후 다시 검증하려는 사람

### 시간 비용
- 외부 리소스 발급 (한 번): ~20분
- `.env.dogfood` 작성: ~5분
- `setup.sh` 실행 + 자동 배포 검증: ~10분
- **총 ~35분** (외부 리소스 이미 있으면 ~15분)

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

### 3.1 GitHub PAT (Personal Access Token Classic)

GHCR 에 docker 이미지 push 할 권한이 필요합니다. `GITHUB_TOKEN` 으론 첫 패키지 생성 시 권한이 부족 (알려진 이슈 — [pitfalls #7](./dogfood-pitfalls.md)) → PAT 사용.

**발급**:
1. https://github.com/settings/tokens → "Generate new token" → "Generate new token (classic)"
2. Note: `dogfood-spring-backend-template`
3. Expiration: 90일 (또는 본인 정책)
4. **Scopes** 체크:
   - ☑ `write:packages`
   - ☑ `read:packages`
   - ☑ `delete:packages` (cleanup 용)
   - ☑ `repo` (write:packages 의 dependency)
5. "Generate token" → 즉시 복사 (한 번만 보임) → `.env.dogfood` 의 `GHCR_TOKEN` 으로

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

- **Custom scopes** 선택, 다음 **2개 scope 모두** 체크 (둘 중 하나 빠지면 403 — [pitfalls #4](./dogfood-pitfalls.md)):
  - ☑ Devices → Core → **Write** + Tags `tag:ci` 추가
  - ☑ Keys → Auth Keys → **Write** + Tags `tag:ci` 추가
- 다른 scope (Posture, Routes, OAuth Keys, ...) 는 **모두 체크 해제**
- "Generate credential"
- **Client ID** + **Secret** 즉시 복사 → `.env.dogfood` 의 `TS_OAUTH_CLIENT_ID` + `TS_OAUTH_SECRET`

### 3.3 Mac mini SSH 셋업 (자동화 측)

`setup.sh` 가 Mac mini 에 SSH 해서 GHA 용 공개키를 등록해야 함. 그러려면 **이미 SSH 가능한 키가 로컬에 있어야** 함.

**옵션 A — 이미 있다면 (권장)**:
```bash
ssh -i ~/.ssh/macmini storkspear@100.X.X.X 'echo connected'
```
가 성공하면 OK. `.env.dogfood` 의 `SSH_KEY_FOR_MACMINI=~/.ssh/macmini`.

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

`setup.sh` 가 자동으로 변경합니다 (수동 불필요). 수동으로 확인/변경하려면:

GitHub Repo → Settings → Actions → General → "Workflow permissions" → **"Read and write permissions"** 선택 → Save.

또는 CLI:
```bash
gh api -X PUT "repos/<owner>/<repo>/actions/permissions/workflow" \
  -f default_workflow_permissions=write \
  -F can_approve_pull_request_reviews=false
```

(이 단계 누락 시 GHCR push 403 — [pitfalls #5](./dogfood-pitfalls.md))

### 3.5 Supabase Connection 정보

Supabase Dashboard → Settings → Database → Connection string → **"Session pooler"** (transaction pooler 도 가능, 둘 다 5432 또는 6543 포트).

복사한 connection string 예시:
```
postgresql://postgres.sebqrqi...:[YOUR-PASSWORD]@aws-1-<region>.pooler.supabase.com:5432/postgres
```

**⚠️ 그대로 쓰면 안 됨** — JDBC 형식 아님 ([pitfalls #11](./dogfood-pitfalls.md)). 다음처럼 분리:

```bash
# .env.dogfood
DB_URL=jdbc:postgresql://aws-1-<region>.pooler.supabase.com:5432/postgres
DB_USER=postgres.sebqrqi...
DB_PASSWORD=<your-actual-password>
```

핵심:
- `jdbc:` prefix 필수
- user/password 는 URL 안에 inline 하지 말고 별도 변수로
- `setup.sh` 가 `DB_URL` 시작 부분을 검증해서 잘못 넣으면 즉시 fail

### 3.6 (선택) Cloudflare Tunnel — 외부 도메인 접근

내부 Tailscale IP 만으로 검증할 거면 skip. 외부에서 `https://server.<도메인>` 으로 접근 원하면 [운영 배포 가이드 (파생레포 onboarding) §2.3 ~ §2.6`](../production/deploy/deployment.md) 참조.

`.env.dogfood` 의 `PUBLIC_HOSTNAME` 은 cloudflared 안 깔아도 placeholder 로 채워야 함 (kamal-proxy 의 host-based routing 에 사용).

---

## 4. `.env.dogfood` 작성

```bash
cp tools/dogfooding/.env.dogfood{.example,}
$EDITOR tools/dogfooding/.env.dogfood
```

채울 값:
- §3.1 ~ §3.5 에서 발급/확인한 값들
- 외부 서비스 (Resend / MinIO / Loki / Discord) 안 쓰면 dummy 그대로 OK

`.env.dogfood` 는 `.gitignore` (`.env.*` 패턴) 에 잡혀 commit 안 됨. `setup.sh` 시작 시 한 번 더 체크.

---

## 5. `setup.sh` 실행

```bash
bash tools/dogfooding/setup.sh
```

스크립트가 9 단계로 자동 진행:
1. prereq (gh / docker / ssh / openssl / git)
2. `.env.dogfood` source + 검증 (DB_URL 형식 등)
3. GHA workflow permissions = write
4. `~/.ssh/gha_deploy` SSH 키 발급 + Mac mini authorized_keys 등록
5. GitHub Variables 1개 등록 (`KAMAL_SERVICE_NAME` — 비민감, log 가독성)
6. GitHub Secrets 20개 등록 (개인 인프라 endpoint 포함 — `DEPLOY_HOST` / `DEPLOY_SSH_USER` / `PUBLIC_HOSTNAME` 도 마스킹. `SSH_PRIVATE_KEY` 자동 생성, `JWT_SECRET` 비어있으면 자동 생성)
7. `DEPLOY_ENABLED=true` 토글
8. (옵션, default 켜짐) trigger empty commit + push to main
9. 다음 단계 안내 출력

각 step 별 `[INFO] / [OK] / [WARN] / [ERROR]` prefix 로그.

스크립트 실패 시 그 line + 원인 메시지 출력. 재실행 안전 (멱등성).

옵션:
- `--skip-trigger` — 마지막 trigger commit 생략 (수동 commit 으로 트리거하려면)
- `--env-file <path>` — 다른 경로의 env 파일
- `--skip-prereqs` — prereq 점검 생략

---

## 6. 동작 확인

### Actions 모니터링
```bash
gh run watch --repo <owner>/<repo>
```
또는 https://github.com/<owner>/<repo>/actions 에서 실시간.

기대 흐름 (~5~8분):
1. CI workflow 시작 → gradle build → bootstrap-jar artifact 업로드
2. workflow_run 으로 deploy workflow 자동 트리거
3. deploy: gate 통과 → jar 다운로드 → docker buildx push → kamal deploy --skip-push
4. 첫 배포라 kamal 이 자동으로 setup (kamal-proxy 컨테이너 기동) + spring 컨테이너 배포

### Mac mini 검증
```bash
SSH_KEY=~/.ssh/macmini   # 또는 .env.dogfood 의 값
HOST=100.X.X.X

# 컨테이너 둘 다 Up 인지
ssh -i $SSH_KEY storkspear@$HOST 'docker ps'

# Spring healthcheck (kamal-proxy 가 host header 기반 라우팅이라 헤더 필요)
ssh -i $SSH_KEY storkspear@$HOST \
  'curl -sSf -H "Host: server.<도메인>" http://localhost/actuator/health/liveness'
# → {"status":"UP"}

# Spring info (DogfoodInfoContributor 메시지)
ssh -i $SSH_KEY storkspear@$HOST \
  'curl -sS -H "Host: server.<도메인>" http://localhost/actuator/info'
# → {"message":"Hello World"}
```

### (외부 도메인 셋업 했다면)
```bash
curl -sSf https://server.<도메인>/actuator/health/liveness
```

---

## 7. `cleanup.sh` 실행

```bash
bash tools/dogfooding/cleanup.sh
```

수행 (default):
- GitHub Variables/Secrets 22개 모두 삭제
- Mac mini 의 spring 컨테이너 + kamal-proxy 컨테이너 삭제
- Mac mini 의 `authorized_keys` 에서 `gha-deploy@<service>` 줄 제거
- GHCR 패키지 (모든 tag) 삭제
- 외부 키 수동 폐기 안내 출력 (PAT, Tailscale OAuth, Supabase password)

옵션:
- `--keep-proxy` — kamal-proxy 컨테이너 유지 (다음 배포 즉시 가능, setup 시간 절약)
- `--keep-ssh` — Mac mini authorized_keys 의 gha-deploy 줄 유지
- `--restore-perms` — workflow permissions 를 read 로 복원
- `--yes` / `-y` — confirm prompt 생략 (자동화용)

멱등성: 두 번 실행해도 graceful (없는 자원은 `[WARN] ... 없음 (skip)`).

### 외부 키 폐기

cleanup.sh 가 마지막에 안내 출력. 실제 폐기는 사람이:
1. **GitHub PAT**: https://github.com/settings/tokens → 사용 PAT Delete
2. **Tailscale OAuth client**: https://login.tailscale.com/admin/settings/oauth → 사용 client Delete
3. **(선택) Supabase password reset**: Dashboard → Settings → Database → Reset

자세히: [키 교체 절차 (Key Rotation)](../production/setup/key-rotation.md)

---

## 8. 보안 — 노출 시 즉시 폐기

이 가이드의 절차대로 발급한 키들이 **노출되었다면** (예: 채팅에 평문 전송, public commit 에 포함):
1. 위 §7 의 폐기 절차 즉시 실행
2. 새 키 재발급
3. `.env.dogfood` 갱신 후 `setup.sh` 재실행 → 새 키로 GitHub Secrets 자동 갱신

자세한 rotation 정책: [키 교체 절차 (Key Rotation)](../production/setup/key-rotation.md)

---

## 9. 트러블슈팅

에러 만나면 → [도그푸딩 함정 모음 (사고 실록)](./dogfood-pitfalls.md) 의 표에서 에러 메시지로 검색.

자주 묻는 질문 → [도그푸딩 FAQ](./dogfood-faq.md)

---

## 다음 단계

도그푸딩 검증이 끝났다면:

- **실제 파생 레포 배포**: [운영 배포 가이드 (파생레포 onboarding)](../production/deploy/deployment.md) — "Use this template" 로 만든 본인 레포를 운영 배포
- **운영 시 장애 대응**: [운영 런북 (Runbook)](../production/deploy/runbook.md) — 평시/장애 운영 절차
- **템플릿 개선을 파생 레포로 전파**: [크로스 레포 Cherry-pick 가이드](./cross-repo-cherry-pick.md)

---

## 관련 문서

- [CI / CD 전체 플로우 — commit 부터 운영 반영까지](../production/deploy/ci-cd-flow.md) — commit→배포 전체 다이어그램
- [도그푸딩 함정 모음 (사고 실록)](./dogfood-pitfalls.md) — 11회 시도 함정 모음
- [도그푸딩 FAQ](./dogfood-faq.md) — 자주 묻는 질문
- [키 교체 절차 (Key Rotation)](../production/setup/key-rotation.md) — 키 교체 절차
- [운영 배포 가이드 (파생레포 onboarding)](../production/deploy/deployment.md) — 운영 배포 (cloudflared 셋업, observability 등)
- [Mac mini 운영 호스트 설정 — 레퍼런스](../production/setup/mac-mini-setup.md) — Mac mini 운영 호스트 셋업
- [운영 런북 (Runbook)](../production/deploy/runbook.md) — 평시 배포 / 롤백 / 장애 대응

---

## 📖 책 목차 — Journey 4~6단계

[📚 spring-backend-template — 책 목차 (Developer Journey)](../onboarding/README.md) 의 **4단계 (외부 자격 증명) · 5단계 (테스트) · 6단계 (정리)** 입니다. 한 문서가 세 단계를 통합합니다.

| 방향 | 문서 | 한 줄 |
|---|---|---|
| ← 이전 | [소셜 로그인 설정 가이드](./social-auth-setup.md) | 4단계 첫 번째, 소셜 로그인 자격 증명 |
| → 다음 | [운영 배포 가이드 (파생레포 onboarding)](../production/deploy/deployment.md) | 7단계, 파생 레포 첫 운영 배포 |

**막혔을 때**: [도그푸딩 함정 모음 (사고 실록)](./dogfood-pitfalls.md) / [도그푸딩 FAQ](./dogfood-faq.md)
**왜 이렇게?**: [인프라 결정 기록 (Decisions — Infrastructure)](../production/deploy/decisions-infra.md) — I-09 (Kamal 선택) / I-10 (GHCR PAT) / I-12 (workflow_run 게이트) / I-14 (Tailscale OAuth scope)
