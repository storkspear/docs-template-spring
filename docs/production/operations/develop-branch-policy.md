# Develop Branch Policy

> **유형**: Runbook · **독자**: 운영자 / 기여자 (Level 2~3) · **읽는 시간**: ~6분

이 문서는 **main / develop 브랜치 정책 + GHA workflow trigger + 자동 배포 흐름** 을 정리합니다. main = prod, develop = dev-server 자동 배포.

> 📌 **현재 상태**: GHA workflow 가 `branches: [main, develop]` 두 곳을 검증하고, 그 결과로 `deploy.yml` (main → prod) 와 `deploy-dev.yml` (develop → dev-server) 가 각자 자동 트리거돼요. dev 자동 배포는 `DEPLOY_ENABLED_DEV=true` repo variable 가 있어야 동작 — template 레포는 기본 off → no-op.

---

## 1. 의도 — 왜 develop 분기

GHA Actions 는 사용량 기반 빌링 (Free tier — public 무제한 / private 2,000분/월). 빈번한 feature 푸시마다 CI 가 돌면:
- private repo 의 경우 빌링 누적
- 팀 푸시 동시성에 의해 큐 대기 + 디버깅 노이즈
- main 의 안정성과 무관한 in-progress 푸시까지 검증 → 노이즈

**develop 브랜치** 도입으로:
- feature 브랜치 직접 push: CI 안 돔 (push trigger 가 main/develop 만 잡음). PR 시점에 1회 검증.
- develop push: CI → 통과 시 dev-server 자동 배포 (`deploy-dev.yml`).
- main push (release): CI → 통과 시 prod 자동 배포 (`deploy.yml`).

---

## 2. 브랜치 정책 (현재 적용 중)

```
feature/<topic>           ← 개인/팀 작업 (push 시 CI 안 돔)
      │
      ▼ (PR / merge)
develop                   ← 통합 점검 + dev-server 자동 배포
      │                      (CI → deploy-dev.yml → dev-server.<도메인>)
      ▼ (PR / merge)
main                      ← 운영 reflection + prod 자동 배포
      │                      (CI → deploy.yml → server.<도메인>)
      ▼ (tag v0.X.0)
release/v0.X.0            ← 운영 배포 reference
```

**규칙**:
- `feature/*` → `develop` PR: CI 정식 실행 (build + spotless + ArchUnit + 통합 테스트)
- `develop` push: CI + dev-server 배포
- `develop` → `main` PR: 동일 CI 1회 더 (안전망)
- `main` push: CI + prod 배포 (kamal build + push + blue/green cutover)

---

## 3. GHA workflow trigger (현재 상태)

`.github/workflows/ci.yml` 는 두 브랜치를 검증:

```yaml
# ci.yml — main / develop push + PR(→main, →develop) 검증
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]
```

`deploy.yml` 와 `deploy-dev.yml` 는 CI 성공을 `workflow_run` 으로 잡아서 각자 자기 환경에 배포:

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

> 💡 `deploy-dev.yml` 는 `vars.DEPLOY_ENABLED_DEV == 'true'` 인 경우만 실제 배포 진행. template 레포는 미설정 → 항상 skip (no-op). 파생 레포에서 dev-server 셋업 후 `gh variable set DEPLOY_ENABLED_DEV --body true` 로 opt-in.

> ⚠️ `changelog-check / docs-check / security-scan / sync-docs` 등 부가 workflow 들도 main / develop 양쪽 push 와 PR 시점에 동일 trigger. private 레포 빌링이 부담되면 develop trigger 만 lint workflow 로 좁힐 수 있음 (현재는 통일 운영).

---

## 4. 운영 흐름

### 4-1. feature 작업 시작

```bash
git checkout develop
git pull
git checkout -b feature/<topic>
```

### 4-2. develop 으로 merge → dev-server 자동 배포

```bash
git push origin feature/<topic>
gh pr create --base develop --title "feat: <topic>"
# 정식 CI — pass 시 merge
gh pr merge --squash --delete-branch

# develop merge 직후:
#   ci.yml 가 develop push 트리거로 1회 더 실행 → 성공
#   deploy-dev.yml 가 workflow_run 으로 트리거 → dev-server 배포
#   (DEPLOY_ENABLED_DEV=true 인 파생 레포만, template 은 skip)
```

### 4-3. main 으로 promote (release) → prod 자동 배포

```bash
gh pr create --base main --head develop --title "release: <date>"
# CI pass 시 merge
gh pr merge --merge  # squash X (release 흔적 보존)
# main merge → CI → deploy.yml 자동 trigger → prod
```

### 4-4. hotfix 흐름

긴급한 운영 수정은 `develop` 우회:
```bash
git checkout main
git checkout -b hotfix/<topic>
# fix 후
gh pr create --base main --title "fix: <urgent>"
# main merge → prod 즉시 배포
git checkout develop && git merge main  # hotfix 를 develop 에도 동기
```

---

## 5. dev-server vs prod — 격리 모델

같은 Mac mini host 에 service 이름만 다르게 격리 (kamal 의 service 단위 컨테이너 + 네트워크 분리).

| 항목 | prod | dev |
|---|---|---|
| kamal service | `KAMAL_SERVICE_NAME` (예: `server`) | `KAMAL_SERVICE_NAME_DEV` (예: `server-dev`) |
| 공개 호스트 | `PUBLIC_HOSTNAME` (예: `server.<도메인>`) | `PUBLIC_HOSTNAME_DEV` (예: `dev-server.<도메인>`) |
| GHCR 이미지 태그 | `:<sha>` | `:dev-<sha>` (cleanup 시 prod 와 격리) |
| Spring profile | `prod` | `dev` |
| DB | Supabase prod 계정 | **별도** Supabase dev 계정 (직접 관리) |
| MinIO bucket | `<slug>-uploads` | `<slug>-uploads-dev` (같은 NAS MinIO, bucket 만 분리) |
| MinIO ENDPOINT/KEY | 공용 | 공용 |
| 관측성 (Loki/Grafana) | 공용 인스턴스 — label `env=prod` | 공용 인스턴스 — label `env=dev` |

자세한 dev 셋업: [`deployment.md`](../deploy/deployment.md#dev-환경-자동-배포-opt-in) 의 dev opt-in 섹션.

---

## 6. 빌링 측정

GHA Actions 사용량:
```bash
gh api /repos/$ORG/$REPO/actions/runs?per_page=50 | jq '.workflow_runs[] | {name, conclusion, run_started_at, head_branch}'
```

또는 Settings → Billing → Action minutes 차트.

현재 모델 (main + develop 동일 CI):
- feature push: 0 분 (trigger 안 잡음)
- PR open / sync: ~5 분 × 1 (PR 검증)
- develop merge: ~5 분 (CI) + ~3 분 (dev 배포)
- main merge (release): ~5 분 (CI) + ~5 분 (prod 배포)

월 100 푸시 + 20 PR + 10 develop merge + 2 release 가정: 5×20 + 8×10 + 10×2 = 200 분.

빌링 부담이 더 커지면:
- develop push 시 docs-check / changelog-check 만 돌리고 build/test 는 PR 시점으로 일원화
- deploy-dev.yml 에 `if: changes-to-spring-code` 같은 path filter 도입

---

## 7. 관련 문서

- [`CI/CD Flow`](../deploy/ci-cd-flow.md) — 전체 파이프라인
- [`Deployment`](../deploy/deployment.md) — kamal 흐름 + dev opt-in 섹션
- [`CLI 가이드`](../../start/cli-guide.md) — `<repo> dev *` / `<repo> prod *` 명령
- `.github/workflows/deploy-dev.yml` 상단 주석 — dev 자동 배포 trigger / secrets 정책
