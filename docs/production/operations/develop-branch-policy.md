# Develop Branch Policy

> **유형**: Runbook · **독자**: Level 2 · **읽는 시간**: ~6분

이 문서는 main·develop 두 브랜치의 정책과 GitHub Actions(GHA) 트리거, 그리고 거기서 갈라지는 자동 배포 흐름을 정리해요. 한 줄로 요약하면, main 은 운영(prod)으로, develop 은 개발 서버(dev-server)로 각자 자동 배포됩니다.

> 📌 **현재 상태**: `ci.yml` 이 main 과 develop 두 브랜치를 검증하고, 그 성공을 신호로 `deploy.yml`(main → prod)과 `deploy-dev.yml`(develop → dev-server)이 각자 자기 환경에 배포합니다. dev 자동 배포는 `DEPLOY_ENABLED_DEV=true` Repo Variable 이 켜져 있을 때만 실제로 동작해요. 템플릿 레포는 이 값이 없어 항상 건너뜁니다.

---

## 1. 의도 — 왜 develop 을 따로 두나

GHA 는 사용량 기반으로 과금됩니다. public 레포는 무제한이지만 private 레포는 Free tier 가 월 2,000분이에요. 그래서 feature 를 push 할 때마다 CI 가 돌면 세 가지 비용이 쌓여요. private 레포에서는 분이 누적되고, 팀이 동시에 push 하면 큐가 밀리며, 아직 진행 중인 작업까지 검증되어 노이즈가 늘어납니다.

develop 브랜치를 두면 이 비용을 줄이면서 안전망은 유지할 수 있어요. feature 브랜치에 직접 push 해도 CI 가 돌지 않고(push 트리거가 main·develop 만 잡아요), 검증은 PR 시점에 한 번만 합니다. develop 에 merge 되면 CI 통과 후 dev-server 에 자동 배포되고, main 에 merge(릴리스)되면 CI 통과 후 운영에 자동 배포돼요.

---

## 2. 브랜치 정책

현재 적용 중인 흐름은 이래요.

```
feature/<topic>           ← 개인·팀 작업 (push 시 CI 안 돔)
      │
      ▼ (PR / merge)
develop                   ← 통합 점검 + dev-server 자동 배포
      │                      (CI → deploy-dev.yml → dev-server.<도메인>)
      ▼ (PR / merge)
main                      ← 운영 반영 + prod 자동 배포
      │                      (CI → deploy.yml → server.<도메인>)
      ▼ (tag)
template-v0.X.0           ← 릴리스 태그 (template 레포 SemVer)
```

각 경계에서 일어나는 일은 다음과 같습니다.

| 이벤트 | CI | 배포 |
|---|---|---|
| `feature/*` → `develop` PR | 정식 실행 (build + spotless + ArchUnit + 통합 테스트) | 없음 |
| `develop` push | 실행 | dev-server (`deploy-dev.yml`) |
| `develop` → `main` PR | 동일 CI 1회 더 (안전망) | 없음 |
| `main` push | 실행 | prod (`deploy.yml`, Kamal blue/green) |

> 마지막 줄의 `template-v0.X.0` 은 브랜치가 아니라 태그예요. 템플릿 레포는 `template-v*` 태그가 붙으면 `release.yml` 이 SemVer 릴리스를 만듭니다. 파생 레포는 develop → main 으로 promote 한 뒤 필요할 때 태그를 붙이는 식으로 같은 흐름을 가져가면 돼요.

---

## 3. GHA 트리거

검증과 배포의 트리거가 어떻게 맞물리는지가 이 정책의 핵심이에요. `ci.yml` 은 main 과 develop 두 브랜치의 push 및 PR 을 검증합니다.

```yaml
# ci.yml — main / develop push + PR(→main, →develop) 검증
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]
```

배포 워크플로 둘은 직접 push 를 잡지 않고, CI 의 성공을 `workflow_run` 으로 받아 각자 자기 환경에 배포해요.

```yaml
# deploy.yml (prod) — main 의 CI 성공 후
on:
  workflow_run:
    workflows: ["CI"]
    types: [completed]
    branches: [main]

# deploy-dev.yml (dev) — develop 의 CI 성공 후
on:
  workflow_run:
    workflows: ["CI"]
    types: [completed]
    branches: [develop]
```

dev 배포에는 한 단계의 게이트가 더 있어요. `deploy-dev.yml` 은 CI 성공에 더해 `vars.DEPLOY_ENABLED_DEV == 'true'` 일 때만 실제 배포를 진행합니다. 템플릿 레포는 이 변수를 설정하지 않아 항상 건너뛰므로 안전한 no-op 이에요. 파생 레포에서 dev-server 를 셋업한 뒤 `gh variable set DEPLOY_ENABLED_DEV --body true` 로 직접 켜면 됩니다.

> 💡 부가 워크플로의 트리거는 CI 와 다르니 주의해요. `changelog-check`·`docs-check`·`security-scan`·`sync-docs` 는 main 만 검증합니다. develop push 에는 돌지 않고, PR 도 `→ main` 만 잡아요. 그래서 develop 흐름에서 도는 워크플로는 사실상 `ci.yml`(과 PR 제목·커밋린트 검사)뿐이에요. develop 에도 docs·security 게이트를 걸고 싶다면 각 워크플로의 `branches:` 에 develop 을 추가하면 됩니다.

---

## 4. 운영 흐름

### 4-1. feature 작업 시작

develop 에서 분기해서 작업을 시작해요.

```bash
git checkout develop
git pull
git checkout -b feature/<topic>
```

### 4-2. develop 으로 merge → dev-server 자동 배포

PR 을 develop 으로 열면 정식 CI 가 돌고, 통과하면 merge 합니다.

```bash
git push origin feature/<topic>
gh pr create --base develop --title "feat: <topic>"
# 정식 CI — pass 시 merge
gh pr merge --squash --delete-branch
```

merge 직후 develop push 트리거로 `ci.yml` 이 한 번 더 돌고, 성공하면 `deploy-dev.yml` 이 `workflow_run` 으로 이어받아 dev-server 에 배포해요. 이 배포는 `DEPLOY_ENABLED_DEV=true` 인 파생 레포에서만 실제로 일어나고, 템플릿에서는 건너뜁니다.

### 4-3. main 으로 promote (릴리스) → prod 자동 배포

dev 에서 충분히 검증했으면 develop 을 main 으로 올려요.

```bash
gh pr create --base main --head develop --title "release: <date>"
# CI pass 시 merge
gh pr merge --merge  # squash 안 함 — 릴리스 흔적 보존
```

main merge 가 CI 를 통과하면 `deploy.yml` 이 트리거되어 운영에 배포됩니다.

### 4-4. hotfix 흐름

긴급한 운영 수정은 develop 을 거치지 않고 main 에서 바로 분기해요.

```bash
git checkout main
git checkout -b hotfix/<topic>
# fix 후
gh pr create --base main --title "fix: <urgent>"
# main merge → prod 즉시 배포
git checkout develop && git merge main   # hotfix 를 develop 에도 동기
```

마지막 줄을 잊지 마세요. hotfix 를 develop 에 다시 합쳐 두지 않으면 다음 릴리스에서 같은 수정이 되돌려질 수 있어요.

---

## 5. dev-server vs prod — 격리 모델

dev-server 와 prod 는 같은 Mac mini 한 대 위에서 돕니다. Kamal 의 service 단위로 컨테이너와 네트워크를 나눠 서로 간섭하지 않게 격리해요.

격리의 핵심은 환경값이 어느 계층에서 갈라지느냐예요. 운영값의 키 이름 자체는 `.env.prod` 와 `.env.dev` 가 똑같습니다(suffix 없는 일반 이름). 분리는 GitHub 계층에서 일어나요. `init-dev.sh` 가 dev 값을 GitHub 에 올릴 때 `_DEV` suffix 를 붙여 Variables·Secrets 로 저장하고, `deploy-dev.yml` 이 컨테이너 안으로 넘길 때 다시 suffix 를 떼어 일반 이름으로 export 합니다. 그래서 `config/deploy-dev.yml` 이 참조하는 이름은 `KAMAL_SERVICE_NAME`·`PUBLIC_HOSTNAME` 처럼 suffix 가 없어요. 표의 "GitHub 변수명" 열이 곧 `_DEV` 가 붙는 자리입니다.

| 항목 | prod | dev | GitHub 변수·시크릿명 (dev) |
|---|---|---|---|
| Kamal service | `KAMAL_SERVICE_NAME` (예: `server`) | `KAMAL_SERVICE_NAME` (예: `server-dev`) | `KAMAL_SERVICE_NAME_DEV` |
| 공개 호스트 | `PUBLIC_HOSTNAME` (예: `server.<도메인>`) | `PUBLIC_HOSTNAME` (예: `dev-server.<도메인>`) | `PUBLIC_HOSTNAME_DEV` |
| GHCR 이미지 태그 | `:<sha>` | `:dev-<sha>` (cleanup 시 prod 와 격리) | — |
| Spring profile | `prod` | `dev` | — |
| DB | Supabase prod 계정 | 별도 Supabase dev 계정 | `DB_URL_DEV` · `DB_USER_DEV` · `DB_PASSWORD_DEV` |
| MinIO bucket | `<slug>-uploads` | `<slug>-uploads-dev` | `APP_STORAGE_MINIO_BUCKETS_0_DEV` |
| MinIO endpoint·key | 운영값 | 별도 dev 값 | `APP_STORAGE_MINIO_ENDPOINT_DEV` 등 |
| 관측성 (Loki·Grafana) | 공유 인스턴스, label `env=prod` | 공유 인스턴스, label `env=dev` | `LOKI_URL_DEV` |

표에서 한 가지만 짚고 넘어갈게요. 운영 자격은 거의 전부 dev 전용 값으로 분리됩니다. DB 와 bucket 뿐 아니라 MinIO endpoint·key, JWT, Resend, PortOne, Discord 까지 모두 `_DEV` 시크릿으로 따로 올라가요. prod 와 진짜로 공유되는 건 GHCR 인증용 `GHCR_TOKEN` 같은 인프라 시크릿 정도입니다. 관측성은 조금 결이 달라요. Loki·Grafana 인스턴스 자체는 한 대를 공유하되 `env` 라벨로 대시보드를 구분하고, 접속 URL 시크릿(`LOKI_URL`)은 `LOKI_URL_DEV` 로 분리해 둡니다.

dev 환경 셋업 절차는 [`deployment.md`](../deploy/deployment.md#dev-환경-자동-배포-opt-in) 의 opt-in 섹션에 단계별로 정리돼 있어요.

---

## 6. 빌링 측정

GHA 사용량은 API 로 바로 뽑아 볼 수 있어요.

```bash
gh api /repos/$ORG/$REPO/actions/runs?per_page=50 \
  | jq '.workflow_runs[] | {name, conclusion, run_started_at, head_branch}'
```

대시보드로 보고 싶으면 Settings → Billing → Action minutes 차트를 확인하세요.

현재 모델에서 한 번의 흐름이 소비하는 분은 대략 이래요.

| 이벤트 | 소비 (분) |
|---|---|
| feature push | 0 (트리거 안 잡음) |
| PR open / sync | ~5 (PR 검증 1회) |
| develop merge | ~5 (CI) + ~3 (dev 배포) |
| main merge (릴리스) | ~5 (CI) + ~5 (prod 배포) |

월 100 push + 20 PR + develop merge 10회 + 릴리스 2회를 가정하면 `5×20 + 8×10 + 10×2 = 200분` 정도예요.

빌링이 더 부담되면 두 방향으로 줄일 수 있어요. develop push 에서는 무거운 build·test 를 건너뛰고 가벼운 검사만 돌린 뒤 build·test 는 PR 시점으로 일원화하거나, `deploy-dev.yml` 에 Spring 코드 변경만 잡는 path filter 를 붙이는 방법입니다.

---

## 7. 관련 문서

- [`CI/CD Flow`](../deploy/ci-cd-flow.md) — 전체 파이프라인
- [`Deployment`](../deploy/deployment.md) — Kamal 흐름 + dev opt-in 섹션
- [`CLI 가이드`](../../start/cli-guide.md) — `<repo> dev *` · `<repo> prod *` 명령
- `.github/workflows/deploy-dev.yml` 상단 주석 — dev 자동 배포 트리거와 시크릿 정책
