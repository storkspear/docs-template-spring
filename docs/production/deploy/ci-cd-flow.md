# CI / CD 전체 플로우 — commit 부터 운영 반영까지

> **유형**: Explanation · **독자**: Level 2.5 · **읽는 시간**: ~15분

**설계 근거**: [ADR-007 (솔로 친화적 운영)](../../philosophy/adr-007-solo-friendly-operations.md) · [ADR-015 (Conventional Commits + SemVer)](../../philosophy/adr-015-conventional-commits-semver.md)

> 결정 근거: [인프라 결정 기록 (Decisions — Infrastructure) I-09 ~ I-14](./decisions-infra.md)
> 셋업 가이드: [도그푸딩 환경 셋업 가이드](../../start/dogfood-setup.md)
> 함정 모음: [도그푸딩 함정 모음 (사고 실록)](../../start/dogfood-pitfalls.md)

---

## 한 문장 요약

이 문서는 **`main` 브랜치 push 부터 운영 배포까지** 의 전체 CI/CD 흐름을 다이어그램과 Phase 별로 추적합니다. 함정 11 개 + 시간 분석 포함.

---

## 1. 개요

**`git commit` → 사용자에게 노출까지 ~15~20분, billed 8분.**

CI workflow 가 jar 를 만들면 deploy workflow 가 `workflow_run` 으로 자동 트리거되어 jar 를 받아 docker 이미지로 패키징 + GHCR push + Mac mini 의 kamal 이 swap. **gradle build 1회만** (CI 가 만든 jar 를 deploy 가 재사용 — 중복 빌드 제거 [I-12](./decisions-infra.md)).

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
  │         (type / scope / subject / ...)    │
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
                     ├──────────────┬─────────────┐
                     ▼              ▼             ▼
              ┌──────────┐   ┌──────────┐   (deploy 안 돔
              │ ci.yml   │   │docs-check│    main 만 트리거)
              │  (push)  │   │  (push)  │
              │          │   │          │
              │ gradle   │   │ docs     │
              │ build    │   │ contract │
              └────┬─────┘   └────┬─────┘
                   ▼              ▼
              SHA 옆 ✓ or ❌ 표시

══════════════════════════════════════════════════════════════════════
  PHASE 3 — PR 생성 (Pull Request 열기)
══════════════════════════════════════════════════════════════════════

  GitHub UI → Compare & pull request → Title 입력 → Create PR
                     │
                     │ pull_request:opened 이벤트
                     ▼
        ┌─────────────────────────────────────┐
        │  5개 워크플로우 동시 실행            │
        ├─────────────────────────────────────┤
        │  ① commit-lint.yml                  │
        │     wagoid/commitlint-github-action │
        │     → PR 의 모든 commit 메시지 검사  │
        │     → no-ai-coauthor 룰도 적용       │
        │                                     │
        │  ② pr-title.yml                     │
        │     amannn/action-semantic-pr       │
        │     → PR 제목 conventional 검사      │
        │                                     │
        │  ③ ci.yml (pull_request)            │
        │     ./gradlew build                 │
        │     → 컴파일 + 테스트                │
        │                                     │
        │  ④ docs-check.yml                   │
        │     docs-contract-test.sh           │
        │                                     │
        │  ⑤ changelog-check.yml              │
        │     CHANGELOG.md 갱신 여부          │
        │                                     │
        └──────────┬──────────────────────────┘
                   │
                   ▼
            PR 페이지 Checks 섹션
              ✓ ✓ ✓ ✓ ✓   ← 전부 초록
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
  PHASE 5 — Post-merge: CI artifact 업로드
══════════════════════════════════════════════════════════════════════

           push:main 이벤트
                   │
                   ├──────────────┬──────────────┐
                   ▼              ▼              ▼
            ┌──────────────┐  ┌──────────┐  ┌──────────┐
            │ ci.yml       │  │docs-check│  │deploy.yml│
            │ (push, ~5분) │  │ (push)   │  │  안 시작  │
            │              │  │          │  │ (workflow│
            │ gradle build │  │          │  │  _run    │
            │ + 테스트       │  │          │  │  대기)   │
            │ + jar artifact│  └──────────┘  └──────────┘
            │   업로드      │
            │ (main only)  │
            └──────┬───────┘
                   │ 성공
                   ▼
        bootstrap-jar artifact 생성 (retention 1일)
                   │
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
            │   conclusion ==      │
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
   │ deploy job (~3~4분 + arm64 첫 빌드 시 +5분)  │
   ├─────────────────────────────────┤
   │ 1. checkout (gate.outputs.sha)  │
   │ 2. download-artifact (CI run) → │
   │    ./_artifact/bootstrap.jar    │
   │ 3. find ... -not -name '*-plain'│
   │    → ./app.jar                  │
   │ 4. tailscale connect (OAuth)    │
   │ 5. SSH key (gha_deploy) 셋업    │
   │ 6. docker buildx setup          │
   │ 7. docker login GHCR (PAT)      │
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
   │     (keep latest 2)             │
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

**husky `commit-msg` hook**:
- `Co-Authored-By: Claude` 라인 정규식 검사 → 매치 시 `exit 1`
- `npx commitlint --edit` → conventional commits 룰 검사

→ commit 자체가 거절됨 (`.git/objects` 생성 전).

### PHASE 2 — feature 브랜치 push

`ci.yml` 과 `docs-check.yml` 이 `on: push: branches: ['**']` 라 모든 브랜치 push 시 동작.

**이 단계에서 jar artifact 업로드는 안 됨** — `if: github.event_name == 'push' && github.ref == 'refs/heads/main'` 조건이라 main push 시에만.

### PHASE 3 — PR 생성

5개 워크플로우 모두 `on: pull_request` 트리거.
- `commit-lint`: PR 의 commit 메시지 (보통 squash 후 PR 제목과 별개)
- `pr-title`: PR 제목 자체 (squash 시 commit 메시지가 됨)
- `ci`: 코드 빌드 + 테스트
- `docs-check`: docs-contract 검사
- `changelog-check`: feat/fix PR 이면 CHANGELOG.md 변경 강제

### PHASE 4 — Merge

GitHub squash merge 가 새 commit 을 main 에 push.

⚠️ **불가역** — 이후 fail 나도 자동 revert 안 됨.

### PHASE 5 — Post-merge CI

`ci.yml` 이 main 에서 다시 실행. 이번엔 jar artifact 업로드 step 동작.

```yaml
- name: Upload bootstrap jar (main only)
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
  uses: actions/upload-artifact@v4
  with:
    name: bootstrap-jar
    path: bootstrap/build/libs/bootstrap.jar   # *-plain.jar 제외
    retention-days: 1
    if-no-files-found: error
```

artifact retention 1일 → storage 거의 안 차지함.

### PHASE 6 — workflow_run + deploy

```yaml
# deploy.yml
on:
  workflow_run:
    workflows: ["CI"]
    types: [completed]
    branches: [main]
  workflow_dispatch:
    inputs:
      version:
        description: '재배포할 commit SHA'
```

CI 의 success 가 트리거. 단 workflow_run 은 default 로 trigger 자체가 발동하지만 conclusion 이 success 인지 별도 체크 필요:

```yaml
gate:
  if: |
    (github.event_name == 'workflow_dispatch' ||
     github.event.workflow_run.conclusion == 'success') &&
    vars.DEPLOY_ENABLED == 'true'
```

이게 **명시적 CI→CD 게이트**. CI fail 이면 deploy 시작 자체 안 함.

### PHASE 7 — 운영 노출

kamal-proxy 가 80/443 listen. host header 로 라우팅:
- `Host: server.<도메인>` → spring 컨테이너 :8080
- 다른 host → 404

cloudflared tunnel 이 외부 도메인을 Mac mini :80 으로 outbound 연결. (cloudflared 미기동 시 외부 접근 불가, Tailscale IP 로만 가능.)

---

## 4. 시간 분석 — billed 8분의 정체

| 단계 | wall-clock | billed (GHA Actions minutes) |
|---|---|---|
| ci.yml (push, main) | ~5분 | 5분 |
| docs-check.yml (push, main) | ~15초 | 0.3분 |
| deploy.yml (gate + deploy) | ~3~4분 (cache 후), ~8~12분 (첫 빌드) | 3~4분 |
| **합계 / 머지** | **~5분** (CI/deploy 직렬, deploy 가 CI 후 시작) | **~8~9분** |

**이전 (개선 전, 병렬 + 중복 빌드)**: 같은 wall-clock 8분 + billed 13분.
→ **billed 5분 절약 (38%)**.

이유: deploy 가 더 이상 자체 gradle build 안 함 ([I-12](./decisions-infra.md)). CI 의 jar 를 artifact 로 받아 패키징만.

---

## 5. 안전망 — 어디서 막히나

| 시점 | 안전망 | 막히면? |
|---|---|---|
| commit | husky + commitlint | commit 거절 (로컬에서) |
| feature push | ci/docs (push) | commit SHA 옆 X (정보용) |
| PR 생성 | 5개 workflow | branch protection 시 머지 차단 |
| Merge | (사용자 판단) | 클릭 안 함 |
| Post-merge CI | ci.yml (push) | workflow_run 트리거 안 됨 → deploy 시작 안 함 |
| **Deploy gate** | **DEPLOY_ENABLED + workflow_run.conclusion == success** | **Deploy 시작 안 함 (명시적 게이트)** |
| Deploy 빌드 | docker buildx | 빌드 fail → push 안 됨 |
| kamal pull | docker pull | 이미지 없으면 fail → 이전 버전 유지 |
| 컨테이너 기동 | kamal healthcheck | healthcheck fail 시 Green 폐기, Blue 유지 (rollback) |
| 라우팅 swap | kamal-proxy | swap 실패 시 트래픽 안 옮김 (Blue 그대로) |

---

## 6. 함정 11개 (자세히 → [pitfalls](../../start/dogfood-pitfalls.md))

| # | 단계 | 키워드 | 자동화로 회피? |
|---|---|---|---|
| 1 | Locate jar | multi-line $JAR | ✅ 워크플로우 코드 |
| 2 | Cleanup step | Package not found | ✅ continue-on-error |
| 3 | Tailscale | action v2 | ✅ @v4 박힘 |
| 4 | Tailscale | OAuth scope auth_keys | ⚠️ 사람이 발급 (가이드 §3.2) |
| 5 | GHCR push | workflow permissions | ✅ setup.sh 자동 |
| 6 | GHCR push | provenance/sbom | ✅ 워크플로우 코드 |
| 7 | GHCR push | GITHUB_TOKEN 한계 | ⚠️ PAT 발급 (가이드 §3.1) |
| 8 | kamal SSH | root 시도 | ✅ DEPLOY_SSH_USER variable |
| 9 | docker login | $GHCR_TOKEN 미주입 | ✅ env 박힘 |
| 10a | kamal pull | ghcr.io 이중 prefix | ✅ KAMAL_IMAGE 코드 |
| 10b | kamal inspect | service label 누락 | ✅ docker labels 박힘 |
| 11 | Spring 기동 | jdbc URL 형식 | ⚠️ setup.sh 검증 + 가이드 §3.5 |

→ **8개는 자동화로 영구 회피, 3개는 사람 손 (외부 서비스 발급) — 가이드가 보완**.

---

## 관련 문서

- [도그푸딩 환경 셋업 가이드](../../start/dogfood-setup.md) — 셋업 가이드 (정상 흐름)
- [도그푸딩 함정 모음 (사고 실록)](../../start/dogfood-pitfalls.md) — 함정 모음 (사고 실록)
- [도그푸딩 FAQ](../../start/dogfood-faq.md) — 자주 묻는 질문
- [운영 배포 가이드 (파생레포 onboarding)](./deployment.md) — 운영 배포 (cloudflared, observability)
- [운영 런북 (Runbook)](./runbook.md) — 평시 운영 / 장애 대응
- [인프라 결정 기록 (Decisions — Infrastructure) I-09 ~ I-14](./decisions-infra.md) — 결정 카드
