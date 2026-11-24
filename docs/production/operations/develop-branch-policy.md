# Develop Branch Policy

> **유형**: Runbook · **독자**: Level 2 · **읽는 시간**: ~6분

이 문서는 main·develop 두 브랜치의 정책과 GitHub Actions(GHA) 트리거, 그리고 거기서 갈라지는 자동 배포 흐름을 정리해요. 한 줄로 요약하면, main 은 운영(prod)으로, develop 은 개발 서버(dev-server)로 각자 자동 배포됩니다.

> 📌 **현재 상태**: `ci.yml` 이 main 과 develop 두 브랜치를 검증하고, 그 성공을 신호로 `deploy.yml`(main → prod)과 `deploy-dev.yml`(develop → dev-server)이 각자 자기 환경에 배포합니다. dev 자동 배포는 `DEPLOY_ENABLED_DEV=true` Repo Variable 이 켜져 있을 때만 실제로 동작해요. 템플릿 레포는 이 값이 없어 항상 건너뜁니다.

---

<a id="1-의도--왜-develop-을-따로-두나"></a>

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

<a id="4-2-develop-으로-merge--dev-server-자동-배포"></a>

### 4-2. develop 으로 merge → dev-server 자동 배포

PR 을 develop 으로 열면 정식 CI 가 돌고, 통과하면 merge 합니다.

```bash
git push origin feature/<topic>
gh pr create --base develop --title "feat: <topic>"
# 정식 CI — pass 시 merge
gh pr merge --squash --delete-branch
```

merge 직후 develop push 트리거로 `ci.yml` 이 한 번 더 돌고, 성공하면 `deploy-dev.yml` 이 `workflow_run` 으로 이어받아 dev-server 에 배포해요. 이 배포는 `DEPLOY_ENABLED_DEV=true` 인 파생 레포에서만 실제로 일어나고, 템플릿에서는 건너뜁니다.

<a id="4-3-main-으로-promote-릴리스--prod-자동-배포"></a>

### 4-3. main 으로 promote (릴리스) → prod 자동 배포

dev 에서 충분히 검증했으면 develop 을 main 으로 올려요.

```bash
gh pr create --base main --head develop --title "chore(release): promote develop"
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

<a id="5-dev-server-vs-prod--격리-모델"></a>

## 5. dev-server vs prod — 격리 모델

dev-server와 prod는 같은 Mac mini와 `kamal` Docker 네트워크를 사용해요. 서비스 이름·외부 호스트·DB 자격·JWT·스토리지 접두사를 나누지만 네트워크 자체가 분리된 구성은 아니에요.

`.env.prod`와 `.env.dev`에서는 같은 환경 변수 이름을 사용해요. GitHub에 저장할 때 `init-dev.sh`가 dev 값에 `_DEV`를 붙이고, `deploy-dev.yml`이 컨테이너에 전달할 때 원래 이름으로 바꿔요. 따라서 `config/deploy-dev.yml`은 `KAMAL_SERVICE_NAME`·`PUBLIC_HOSTNAME`처럼 접미사 없는 이름을 참조해요. 아래 표의 GitHub 변수명 열은 GitHub에 저장되는 이름이에요.

| 항목 | prod | dev | GitHub 변수·시크릿명 (dev) |
|---|---|---|---|
| Kamal service | `KAMAL_SERVICE_NAME` (예: `server`) | `KAMAL_SERVICE_NAME` (예: `server-dev`) | `KAMAL_SERVICE_NAME_DEV` |
| 공개 호스트 | `PUBLIC_HOSTNAME` (예: `server.<도메인>`) | `PUBLIC_HOSTNAME` (예: `dev-server.<도메인>`) | `PUBLIC_HOSTNAME_DEV` |
| GHCR 이미지 태그 | `:<sha>` | `:dev-<sha>` (cleanup 시 prod 와 격리) | — |
| Spring profile | `prod` | `dev` | — |
| DB | Supabase prod 계정 | 별도 Supabase dev 계정 | `DB_URL_DEV` · `DB_USER_DEV` · `DB_PASSWORD_DEV` |
| MinIO bucket | `<normalizedSlug>-uploads` | `dev-<normalizedSlug>-uploads` | 앱 DataSource에서 자동 파생. `_DEV` 공유 버킷 슬롯과 별개 |
| MinIO 버킷 접두사 | 빈 값(기본) | `dev-` | `APP_STORAGE_BUCKET_PREFIX_DEV` |
| MinIO endpoint·key | 운영값 | 별도 dev 값 (보통 prod 와 **같은 MinIO 인스턴스**) | `APP_STORAGE_MINIO_ENDPOINT_DEV` 등 |
| 관측성 (Loki·Grafana) | 공유 인스턴스, label `env=prod` | 공유 인스턴스, label `env=dev` | `LOKI_URL_DEV` |

`app.storage.bucket-prefix`(env `APP_STORAGE_BUCKET_PREFIX`)는 `BucketNaming`이 앱 업로드 버킷을 계산할 때 사용해요. 프로비저닝과 런타임 소비가 같은 계산을 쓰므로 앱별 BUCKETS 슬롯을 맞출 필요는 없어요. 이름은 `<prefix><하이픈을 제거한 slug>-uploads`예요. dev/prod가 MinIO를 공유하는 기본 구성에서 dev에는 `dev-`를 설정해요. 실제 MinIO를 쓰는 dev 프로필은 빈 prefix로 부팅할 수 없고, 별도 공유 버킷 목록이 있다면 그 이름도 같은 prefix로 시작해야 해요.

DB·MinIO·JWT·Resend·PortOne·Discord 등 환경별 설정은 dev 전용 `_DEV` 이름으로 저장해요. `.env.infra`의 `GHCR_TOKEN`·`SSH_PRIVATE_KEY`·`TS_OAUTH_*`·`DEPLOY_HOST`·`DEPLOY_SSH_USER`는 같은 배포 호스트에 접근하는 공용 설정이라 접미사를 붙이지 않아요. Loki·Grafana도 인스턴스는 공유하지만 `env` 라벨로 데이터를 구분하고, Loki 접속 설정은 `LOKI_URL_DEV`로 따로 전달해요.

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
