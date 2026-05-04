# Develop Branch Policy

> **유형**: Runbook · **독자**: 운영자 / 기여자 (Level 2~3) · **읽는 시간**: ~6분

이 문서는 **main / develop 브랜치 정책 + GHA workflow trigger** 를 정리합니다. 빌링 절약 + 리뷰 품질.

> 📌 **현재 상태**: GHA workflow 가 `branches: [main]` 으로 trigger 제한되어 있어요 — develop / feature 브랜치 push 는 CI 안 돌아요. main push 또는 main 으로의 PR 시점에만 검증 + deploy 가 진행돼요. 본 문서는 정책 운영 가이드.

---

## 1. 의도 — 왜 develop 분기

GHA actions 는 사용량 기반 빌링 (Free tier — public 무제한 / private 2,000분/월). 빈번한 feature 푸시마다 CI 가 돌면:
- private repo 의 경우 빌링 누적
- 팀 푸시 동시성에 의해 큐 대기 + 디버깅 노이즈
- main 의 안정성과 무관한 in-progress 푸시까지 검증 → 노이즈

**develop 브랜치** 도입으로:
- feature 브랜치 → develop merge: CI **안 돔** (또는 가벼운 lint 만)
- develop → main merge: 정식 CI + deploy trigger

---

## 2. 브랜치 정책 (현재 적용 중)

```
feature/<topic>           ← 개인/팀 작업
      │
      ▼ (PR / merge)
develop                   ← 통합 점검용 (CI 가벼움)
      │
      ▼ (PR / merge)
main                      ← 운영 reflection (CI + deploy)
      │
      ▼ (tag v0.X.0)
release/v0.X.0            ← 운영 배포 reference
```

**규칙**:
- `feature/*` → `develop` PR: lint / typo 만 (또는 manual trigger)
- `develop` → `main` PR: 정식 CI (build + spotless + ArchUnit + 통합 테스트)
- `main` push: `deploy.yml` trigger (kamal build + push + cutover)

---

## 3. GHA workflow trigger (현재 상태)

`.github/workflows/*.yml` 의 trigger 는 모두 main / PR(→main) 만:

```yaml
# ci.yml — main push + main PR 만 실행
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

# deploy.yml — CI 성공 후 자동 (workflow_run)
on:
  workflow_run:
    workflows: ["CI"]
    types: [completed]

# changelog-check / docs-check / security-scan / sync-docs — 동일 패턴
```

즉 `feature/<topic>` 푸시 → CI 안 돔. PR 만들 때 1회 검증. main merge → CI + deploy.

> ⚠️ develop 브랜치를 만들고 거기에 PR 도입하려면 위 trigger 에 `[develop, main]` 추가 필요. 현재 정책은 main 단일 — develop 도입은 별도 결정.

---

## 4. 운영 흐름

### 4-1. feature 작업 시작

```bash
git checkout develop
git pull
git checkout -b feature/<topic>
```

### 4-2. develop 으로 merge

```bash
git push origin feature/<topic>
gh pr create --base develop --title "feat: <topic>"
# CI 가벼움 (lint / typo) — pass 시 merge
gh pr merge --squash --delete-branch
```

### 4-3. main 으로 promote (release)

```bash
gh pr create --base main --head develop --title "release: <date>"
# 정식 CI (build / spotless / ArchUnit / 통합 테스트) — pass 시 merge
# main merge → deploy.yml 자동 trigger
gh pr merge --merge  # squash X (release 흔적 보존)
```

### 4-4. hotfix 흐름

긴급한 운영 수정은 `develop` 우회:
```bash
git checkout main
git checkout -b hotfix/<topic>
# fix 후
gh pr create --base main --title "fix: <urgent>"
# main merge → deploy 즉시
git checkout develop && git merge main  # hotfix 를 develop 에도 동기
```

---

## 5. 빌링 측정 (Phase 3 검증)

GHA Actions 사용량:
```bash
gh api /repos/$ORG/$REPO/actions/runs?per_page=50 | jq '.workflow_runs[] | {name, conclusion, run_started_at, head_branch}'
```

또는 Settings → Billing → Action minutes 차트.

기대 효과:
- 변경 전: 모든 feature 푸시 → CI 1회 (~5분)
- 변경 후: develop 푸시 → CI 가벼움 (~30초), main merge 시점만 정식 CI

월 100 푸시 가정: 5분 × 100 = 500분 → 0.5분 × 90 + 5분 × 10 = 95분 → **80% 절감**.

---

## 6. 관련 문서

- [`CI/CD Flow`](../deploy/ci-cd-flow.md) — 전체 파이프라인
- [`Deployment`](../deploy/deployment.md) — kamal 흐름
- (예정) Phase 3 작업 — 본 문서의 변경 적용 시점
