# CI / CD 전체 플로우 — commit 부터 운영 반영까지

> **유형**: Explanation · **독자**: Level 2 · **읽는 시간**: ~15분

**설계 근거**: [`ADR-007 · 솔로 친화적 운영`](../../philosophy/adr-007-solo-friendly-operations.md) · [`ADR-015 · Conventional Commits + SemVer`](../../philosophy/adr-015-conventional-commits-semver.md)

> 결정 근거: [`인프라 결정 기록 (Decisions — Infrastructure) I-09 ~ I-14`](./decisions-infra.md)
> 셋업 가이드: [`도그푸딩 환경 셋업 가이드`](../../start/dogfood-setup.md)
> 함정 모음: [`도그푸딩 함정 모음 (사고 실록)`](../../start/dogfood-pitfalls.md)

---

> 📌 dev-server 흐름은 본 다이어그램의 `main` 자리를 `develop` 으로 바꾼 평행 경로예요. develop push → `ci.yml` → `deploy-dev.yml` → `dev-server.<도메인>` 으로 흘러요. 격리 모델은 [`develop-branch-policy.md §5`](../operations/develop-branch-policy.md#5-dev-server-vs-prod--격리-모델) 에 있고, 본 문서는 `main` → prod 기준으로 설명해요.

## 한 문장 요약

이 문서는 `git commit` 부터 운영 배포까지의 CI / CD 흐름을, 다이어그램과 Phase 별로 추적하는 설명글이에요. 함정 15개와 시간 분석까지 함께 다뤄요.

---

## 1. 개요

`git commit` 부터 사용자에게 노출되기까지 약 10~12분, billed 8~9분이에요 ([§4 시간 분석](#4-시간-분석--billed-8분의-정체) 실측 기준).

흐름의 골격은 두 개의 워크플로우가 `workflow_run` 으로 이어지는 구조예요. CI 워크플로우가 main 에서 성공으로 끝나면 deploy 워크플로우가 자동으로 트리거됩니다. deploy 는 해당 SHA 를 다시 체크아웃해 jar 를 빌드하고, docker 이미지로 패키징해 GHCR 에 push 한 뒤, Mac mini 의 kamal 이 blue/green 으로 컨테이너를 교체합니다.

여기서 한 가지 짚어 둘 게 있어요. CI 와 deploy 는 **각자 gradle 빌드를 한 번씩** 돌려요. CI 는 spotless · 테스트 · ArchUnit 까지 포함한 full build 를, deploy 는 `-x test` 로 jar 만 빠르게 패키징하는 build 를 합니다. CI 의 산출물을 artifact 로 넘겨 재사용하지 않는 이유는 storage 한도 때문인데, 자세한 배경은 [§4 시간 분석](#4-시간-분석--billed-8분의-정체) 과 [`I-12`](./decisions-infra.md) 에 정리돼 있어요.

> 💡 **push 전 검증** — `<repo> ci-test` 명령이 GitHub Actions 의 5단계(Spotless · Build · Docs contract · Docs-check unit · gitleaks)를 로컬에서 동일하게 돌려, push 전에 사전 통과를 보장해요. 자세한 흐름은 [`CLI 가이드 §4 CI 검증`](../../start/cli-guide.md) 을 참조하세요.

---

## 2. 전체 다이어그램

```
══════════════════════════════════════════════════════════════════════
  PHASE 1 — 로컬 (개발자 머신)
══════════════════════════════════════════════════════════════════════

  코드 수정
     │
     ▼
  git commit -m "feat(auth): add login"
     │
     │ git 이 .husky/commit-msg hook 실행
     ▼
  ┌──────────────────────────────────────────┐
  │ HOOK: .husky/commit-msg                  │
  │ ├─ Co-Authored-By: Claude 검사           │
  │ │   └─ 발견 시 ❌ commit 거절            │
  │ └─ npx commitlint --edit                 │
  │     └─ commitlint.config.mjs 룰 검사      │
  │         (type / scope / subject ...)      │
  │         └─ 위반 시 ❌ commit 거절         │
  └──────────────────┬───────────────────────┘
                     │ pass
                     ▼
              git 객체 생성 (.git/objects)
                     │
                     ▼
           git push origin feature-branch
                     │
                     ▼ HTTPS / SSH
══════════════════════════════════════════════════════════════════════
  PHASE 2 — GitHub: feature 브랜치 push
══════════════════════════════════════════════════════════════════════

           feature 브랜치에 commit 도착
                     │
                     │ push 이벤트 발생
                     ▼
              ┌─────────────────────────────┐
              │ 아무 워크플로우도 안 돔      │
              │ (push 트리거는 ci 가        │
              │  main·develop, docs-check   │
              │  는 main 뿐 → 분 소비 절약, │
              │  검증은 PR 단계에서)        │
              └─────────────────────────────┘

══════════════════════════════════════════════════════════════════════
  PHASE 3 — PR 생성 (Pull Request 열기)
══════════════════════════════════════════════════════════════════════

  GitHub UI → Compare & pull request → Title 입력 → Create PR
                     │
                     │ pull_request 이벤트
                     ▼
        ┌─────────────────────────────────────┐
        │  7개 워크플로우 동시 실행           │
        ├─────────────────────────────────────┤
        │  ① ci.yml (pull_request)            │
        │     spotlessCheck → ./gradlew build │
        │     (compile + test + 22 ArchUnit)  │
        │     + OWASP (non-blocking)          │
        │                                     │
        │  ② docs-check.yml                   │
        │     docs-contract-test.sh + meta    │
        │                                     │
        │  ③ security-scan.yml                │
        │     gitleaks (secret scan)          │
        │                                     │
        │  ④ commit-lint.yml                  │
        │     wagoid/commitlint-github-action │
        │                                     │
        │  ⑤ pr-title.yml                     │
        │     amannn/action-semantic-pr       │
        │                                     │
        │  ⑥ changelog-check.yml              │
        │     CHANGELOG.md 갱신 여부          │
        │     (docs/chore/style/ci 면 skip)   │
        │                                     │
        │  ⑦ contract-snapshot.yml            │
        │     계약 소스 변경 시 스냅샷        │
        │     재생성·커밋 여부 검증           │
        └──────────┬──────────────────────────┘
                   │
                   ▼
            PR 페이지 Checks 섹션
              ✓ ✓ ✓ ✓ ✓ ✓ ✓   ← 전부 초록
                   │
                   │ branch protection 켜져 있으면:
                   │   하나라도 fail → Merge 버튼 회색
                   ▼
            [Squash and merge] 클릭
                   │
══════════════════════════════════════════════════════════════════════
  PHASE 4 — 머지 (불가역)
══════════════════════════════════════════════════════════════════════
                   │
                   │ GitHub 가 새 commit 생성 (squash 라면 단일 commit)
                   ▼
            main 의 HEAD 가 새 SHA 로 이동
                   │
                   ▼
            push:main 이벤트 발생
                   │
                   │ ※ 코드는 이미 main 에 들어감
                   │   이후 fail 나도 자동 revert 안 됨
                   │
══════════════════════════════════════════════════════════════════════
  PHASE 5 — Post-merge: main 에서 CI 재실행
══════════════════════════════════════════════════════════════════════

           push:main 이벤트
                   │
                   ├──────────────┬──────────────┐
                   ▼              ▼              ▼
            ┌──────────────┐ ┌──────────┐  ┌──────────┐
            │ ci.yml       │ │docs-check│  │deploy.yml│
            │ (push, ~5분) │ │ (push)   │  │  안 시작  │
            │              │ │          │  │ (workflow│
            │ spotlessCheck│ │ contract │  │  _run    │
            │ + build      │ │ + meta   │  │  대기)   │
            │ + 22 ArchUnit│ └──────────┘  └──────────┘
            │ + OWASP      │
            └──────┬───────┘
                   │ success conclusion
                   ▼
══════════════════════════════════════════════════════════════════════
  PHASE 6 — workflow_run → deploy
══════════════════════════════════════════════════════════════════════

   CI 의 success conclusion 이 트리거 →
     deploy.yml 의 on.workflow_run 발동
                   │
                   ▼
            ┌──────────────────────┐
            │ gate job             │
            │ if:                  │
            │   workflow_run       │
            │   .conclusion ==     │
            │     'success'        │
            │   AND                │
            │   DEPLOY_ENABLED     │
            │     == 'true'        │
            ├──────────────────────┤
            │ outputs.sha 결정     │
            │   = workflow_run     │
            │     .head_sha        │
            └─────────┬────────────┘
                      │
                ┌─────┴─────┐
              pass       skip (DEPLOY_ENABLED 미설정 — template 상태)
                │         │
                │         └─► deploy job 시작 안 함 (안전한 no-op)
                │
                ▼
   ┌─────────────────────────────────┐
   │ deploy job (~5~7분, arm64 빌드 포함)        │
   ├─────────────────────────────────┤
   │ 1. checkout (gate.outputs.sha)  │
   │ 2. ./gradlew bootstrap:bootJar  │
   │    --no-daemon -x test          │
   │ 3. find ... -not -name '*-plain'│
   │    → ./app.jar                  │
   │ 4. tailscale connect (OAuth)    │
   │ 5. SSH key (deploy_key) 셋업    │
   │ 6. docker buildx setup          │
   │ 7. docker login GHCR (GHCR_TOKEN)│
   │ 8. docker buildx build push     │
   │    Dockerfile.runtime           │
   │    → ghcr.io/.../...:<sha>      │
   │      (linux/arm64,              │
   │       provenance/sbom: false,   │
   │       label service=...)        │
   │ 9. ruby + kamal 설치             │
   │ 10. kamal deploy --skip-push    │
   │     --version=<sha>             │
   │     (env 에 GHCR_TOKEN 도 export)│
   │     ┌─ 첫 배포면 자동 setup:    │
   │     │  - kamal-proxy 컨테이너   │
   │     │    기동                   │
   │     │  - docker network create  │
   │     │    kamal                  │
   │     ├─ docker login (Mac mini)  │
   │     ├─ docker pull image        │
   │     ├─ inspect service label    │
   │     ├─ Green 컨테이너 기동      │
   │     ├─ healthcheck 대기         │
   │     ├─ kamal-proxy 라우팅 swap  │
   │     └─ Blue 컨테이너 종료       │
   │ 11. cleanup old GHCR images    │
   │     (keep 10 versions)          │
   └─────────────┬───────────────────┘
                 ▼
══════════════════════════════════════════════════════════════════════
  PHASE 7 — 운영 (사용자 노출)
══════════════════════════════════════════════════════════════════════

   Mac mini 의 docker network "kamal"
                       │
                       ▼
              kamal-proxy (포트 80/443)
              host-based routing:
                Host: server.<도메인> → spring 컨테이너 :8080
                       │
                       ▼ (외부 접근 시)
              cloudflared tunnel (outbound)
                       │
                       ▼
              Cloudflare edge (전 세계)
                       │
                       │ DNS: server.<도메인>
                       ▼
              ┌──────────────────────┐
              │  최종 사용자 요청 도착  │
              │  ✅ 새 버전 서비스 중  │
              └──────────────────────┘
```

---

## 3. Phase 별 세부

### PHASE 1 — 로컬

husky `commit-msg` hook 이 두 가지를 검사합니다.

- `Co-Authored-By: Claude` 라인 정규식 검사 → 매치 시 `exit 1` 로 거절
- `npx commitlint --edit` → Conventional Commits 룰 검사

위반 시 commit 자체가 거절돼요 (`.git/objects` 생성 전).

### PHASE 2 — feature 브랜치 push

여기가 이전 설명과 가장 크게 달라진 자리예요. `on: push` 트리거를 `ci.yml` 은 `main` · `develop` 으로, `docs-check.yml` 은 `main` 으로만 한정해 둬서, **feature 브랜치 직접 push 에는 어떤 워크플로우도 돌지 않아요**. Actions 분 소비를 아끼려는 의도이고, 코드 검증은 PR 을 열 때 한 번에 모입니다.

```yaml
# ci.yml 발췌
on:
  push:
    branches: [main, develop]   # feature push 는 제외
  pull_request:
    branches: [main, develop]
```

feature 작업 중 빠르게 확인하고 싶으면 로컬에서 `<repo> ci-test` 를 돌리면 돼요.

### PHASE 3 — PR 생성

PR 을 열면 7개 워크플로우가 동시에 돕니다. 코드 게이트(ci · docs-check · security-scan · contract-snapshot)와 메타 게이트(commit-lint · pr-title · changelog-check)로 나눠 볼 수 있어요.

| # | 워크플로우 | 트리거 | 무엇을 검사 |
|---|---|---|---|
| ① | `ci.yml` | pull_request | `spotlessCheck` → `./gradlew build` (compile + test + 22 ArchUnit) + OWASP (non-blocking) |
| ② | `docs-check.yml` | pull_request | `docs-contract-test.sh` (env-var 일관성 · broken link) + meta test |
| ③ | `security-scan.yml` | pull_request | gitleaks 로 커밋된 secret 탐지 |
| ④ | `commit-lint.yml` | pull_request | PR 의 모든 commit 메시지를 commitlint 룰로 검사 |
| ⑤ | `pr-title.yml` | pull_request | PR 제목 Conventional 형식 검사 (squash 시 commit 메시지가 됨) |
| ⑥ | `changelog-check.yml` | pull_request | feat/fix PR 이면 CHANGELOG.md `[Unreleased]` 갱신 강제 (docs/chore/style/ci 타입은 skip) |
| ⑦ | `contract-snapshot.yml` | pull_request | 계약 소스 (ApiEndpoints · ErrorCode enum · record DTO) 변경 시 `docs/api-contract/contract-snapshot.json` 재생성·커밋 여부 검증 |

branch protection 이 켜져 있으면 이 중 하나라도 fail 일 때 Merge 버튼이 회색으로 막혀요.

### PHASE 4 — Merge

GitHub squash merge 가 새 commit 을 `main` 에 push 합니다.

⚠️ **불가역** — 코드가 이미 main 에 들어간 뒤라, 이후 fail 이 나도 자동 revert 가 되지 않아요.

### PHASE 5 — Post-merge CI

`ci.yml` 이 이번엔 `push: main` 트리거로 다시 실행됩니다. PR 단계와 같은 full build(spotless · 테스트 · ArchUnit · OWASP)를 한 번 더 돌려, deploy 의 트리거가 될 **success conclusion** 을 만들어요.

이 단계가 곧 CI → CD 게이트의 출발점이에요. CI 가 여기서 fail 이면 다음 Phase 의 `workflow_run` 이 success 로 발동하지 않아 deploy 가 시작되지 않습니다.

> 참고로 이전 구조에서는 CI 가 jar artifact 를 업로드하고 deploy 가 그걸 내려받아 재사용했는데, artifact storage 한도(Free tier 500MB)를 빠르게 소진하는 문제로 폐기됐어요. 지금은 CI 가 artifact 를 만들지 않고, deploy 가 같은 SHA 에서 jar 를 다시 빌드합니다 ([`I-12`](./decisions-infra.md)).

### PHASE 6 — workflow_run + deploy

`main` 과 `develop` 각자의 deploy 워크플로우가 자기 브랜치 CI 완료에만 반응해 별도로 트리거됩니다.

```yaml
# deploy.yml (prod)         # deploy-dev.yml (dev)
on:                         on:
  workflow_run:               workflow_run:
    workflows: ["CI"]           workflows: ["CI"]
    types: [completed]          types: [completed]
    branches: [main]            branches: [develop]
```

`workflow_run` 은 CI 가 fail / skipped 여도 trigger 자체는 발동해요. 그래서 conclusion 이 정말 success 인지를 gate job 에서 한 번 더 확인합니다.

```yaml
# deploy.yml (prod)              # deploy-dev.yml (dev)
gate:                            gate:
  if: |                            if: |
    workflow_run.conclusion         workflow_run.conclusion
      == 'success' &&                 == 'success' &&
    vars.DEPLOY_ENABLED              vars.DEPLOY_ENABLED_DEV
      == 'true'                       == 'true'
```

이게 **명시적 CI → CD 게이트** 예요. CI fail 이면 해당 환경의 deploy 가 시작되지 않습니다. template 레포는 `DEPLOY_ENABLED` / `DEPLOY_ENABLED_DEV` 가 미설정이라 gate 가 항상 skip 으로 떨어져 안전한 no-op 으로 남아요.

gate 를 통과하면 deploy job 이 SHA 를 체크아웃해 `./gradlew bootstrap:bootJar -x test` 로 jar 를 빌드하고, `Dockerfile.runtime` 으로 arm64 이미지를 buildx 빌드해 GHCR 에 `:<sha>` 태그로 push 합니다. dev 경로는 같은 GHCR repo 에 `:dev-<sha>` 태그로 격리해서 올려요. 그 뒤 `kamal deploy --skip-push --version=<sha>` 가 kamal 의 자체 빌드를 건너뛰고(이미 push 한 이미지를 그대로 swap), Mac mini 가 이미지를 pull 해 blue/green 으로 교체합니다.

### PHASE 7 — 운영 노출

kamal-proxy 가 80/443 포트를 listen 하고 host header 로 라우팅합니다.

- `Host: server.<도메인>` → spring 컨테이너 :8080
- 다른 host → 404

cloudflared tunnel 이 외부 도메인을 Mac mini :80 으로 outbound 연결해요. cloudflared 가 안 떠 있으면 외부 접근이 불가하고 Tailscale IP 로만 닿을 수 있어요.

---

## 4. 시간 분석 — billed 8분의 정체

| 단계 | wall-clock | billed (GHA Actions minutes) |
|---|---|---|
| ci.yml (push, main) | ~5분 | 5분 |
| docs-check.yml (push, main) | ~15초 | 0.3분 |
| deploy.yml (gate + deploy) | ~5~7분 (gradle build + arm64) | ~3~4분 |
| **합계 / 머지** | **~10~12분** (CI → deploy 직렬) | **~8~9분** |

CI 와 deploy 는 직렬이에요. deploy 가 CI 의 success 를 기다렸다가 시작하기 때문이에요. 그래서 wall-clock 은 두 단계의 합에 가깝고, billed 분은 각 단계의 실행 시간을 더한 값이에요.

deploy 가 jar 를 다시 빌드하는데도 비용이 크게 늘지 않는 이유는 `-x test` 덕분이에요. CI 가 이미 테스트 · spotless · OWASP 를 검증했으니, deploy 빌드는 테스트를 건너뛰고 jar 패키징만 합니다. artifact 를 주고받는 대신 빌드를 한 번 더 하는 트레이드오프인데, storage 사용을 0 으로 만들면서 ci ↔ deploy 결합을 단일 build 경로로 단순화하는 선택이에요 ([`I-12`](./decisions-infra.md)).

---

## 5. 안전망 — 어디서 막히나

| 시점 | 안전망 | 막히면? |
|---|---|---|
| commit | husky + commitlint | commit 거절 (로컬에서) |
| feature push | (트리거 없음) | 검증은 PR 단계로 미뤄짐 |
| PR 생성 | 7개 workflow | branch protection 시 머지 차단 |
| Merge | (사용자 판단) | 클릭 안 함 |
| Post-merge CI | ci.yml (push, main) | success conclusion 안 남 → deploy 트리거 안 됨 |
| **Deploy gate** | **DEPLOY_ENABLED + workflow_run.conclusion == success** | **Deploy 시작 안 함 (명시적 게이트)** |
| Deploy 빌드 | docker buildx | 빌드 fail → push 안 됨 |
| kamal pull | docker pull | 이미지 없으면 fail → 이전 버전 유지 |
| 컨테이너 기동 | kamal healthcheck | healthcheck fail 시 Green 폐기, Blue 유지 (rollback) |
| 라우팅 swap | kamal-proxy | swap 실패 시 트래픽 안 옮김 (Blue 그대로) |

---

## 6. 함정 15개 (자세히 → [`pitfalls`](../../start/dogfood-pitfalls.md))

| # | 단계 | 키워드 | 자동화로 회피? |
|---|---|---|---|
| 1 | Locate jar | multi-line `$JAR` | ✅ 워크플로우 코드 (`-not -name '*-plain'`) |
| 2 | Cleanup step | Package not found | ✅ continue-on-error |
| 3 | Tailscale | action v2 | ✅ @v4 박힘 |
| 4 | Tailscale | OAuth scope auth_keys | ⚠️ 사람이 발급 (가이드) |
| 5 | GHCR push | workflow permissions | ✅ setup.sh 자동 |
| 6 | GHCR push | provenance/sbom | ✅ 워크플로우 코드 |
| 7 | GHCR push | GITHUB_TOKEN 한계 | ⚠️ PAT 발급 (가이드) |
| 8 | kamal SSH | root 시도 | ✅ DEPLOY_SSH_USER variable |
| 9 | docker login | `$GHCR_TOKEN` 미주입 | ✅ env 박힘 |
| 10a | kamal pull | ghcr.io 이중 prefix | ✅ KAMAL_IMAGE 코드 |
| 10b | kamal inspect | service label 누락 | ✅ docker labels 박힘 |
| 11 | Spring 기동 | jdbc URL 형식 | ⚠️ setup.sh 검증 + 가이드 |
| 12 | Gradle 빌드 | JDK 26 class file major 70 | ✅ init prereq (`21 ≤ JAVA < 26` 거부) |
| 13 | 첫 배포 health | 원거리 DB Flyway 타임아웃 | ✅ `deploy_timeout: 120` |
| 14 | Cloudflare 라우팅 | 외부 도메인 404 | ⚠️ `prod init` 자동등록 + 가이드 |
| 15 | Loki 로그 | appender startup fail | ⚠️ observability 선기동 + 가이드 |

→ 워크플로우 코드와 init 가드에 박혀 영구 회피되는 항목이 다수이고, Tailscale ACL · GitHub PAT · Cloudflare 등 외부 서비스 발급이 끼는 자리에서는 사람 손이 한 번씩 필요해요. 그 자리는 가이드가 보완합니다.

---

## 관련 문서

- [`도그푸딩 환경 셋업 가이드`](../../start/dogfood-setup.md) — 셋업 가이드 (정상 흐름)
- [`도그푸딩 함정 모음 (사고 실록)`](../../start/dogfood-pitfalls.md) — 함정 모음 (사고 실록)
- [`도그푸딩 FAQ`](../../start/dogfood-faq.md) — 자주 묻는 질문
- [`운영 배포 가이드 (파생레포 onboarding)`](./deployment.md) — 운영 배포 (cloudflared, observability)
- [`운영 런북 (Runbook)`](./runbook.md) — 평시 운영 / 장애 대응
- [`인프라 결정 기록 (Decisions — Infrastructure) I-09 ~ I-14`](./decisions-infra.md) — 결정 카드
