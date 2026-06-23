# 레포 간 변경 전파 가이드 — cherry-pick

> **유형**: How-to · **독자**: Level 1 · **읽는 시간**: ~10분

이 문서는 템플릿 레포(`template-spring`)의 공통 코드 개선을 파생 레포로 가져오는 흐름과, 반대로 파생 레포에서 발견한 공통 코드 수정을 템플릿으로 되돌리는 흐름을 다뤄요. 두 방향 모두 핵심 도구는 `git cherry-pick` 한 가지예요.

여기서 [파생 레포](../reference/glossary.md#이-레포-고유-용어)는 템플릿을 "Use this template" 으로 복제해 만든 본인 서비스 레포를 가리켜요. 예를 들면 `sumtally-backend` 같은 것이에요.

---

## 왜 merge 가 아니라 cherry-pick 인가

이 템플릿은 "Use this template" 모델을 써요. 이 방식으로 만든 파생 레포는 원본과 git 히스토리가 **완전히 끊어져 있어요**. fork 와 달리 공통 조상 커밋이 없어서, `git merge` 로 원본 변경을 한꺼번에 따라갈 수 없어요. 그래서 공통 코드 개선은 필요한 커밋만 골라 옮기는 cherry-pick 으로 전파해요.

이 단절은 불편이 아니라 의도예요. 자동 merge 라면 내가 원치 않는 변경까지 강제로 딸려 와요. cherry-pick 은 파생 레포가 "이번 변경은 받고, 저건 안 받겠다" 를 매번 직접 고르게 해줘요. 손이 한 번 더 가는 그 과정이 곧 검토 과정인 셈이에요.

자세한 배경은 [`ADR-002 · GitHub Template Repository 패턴`](../philosophy/adr-002-use-this-template.md) 에, 버전 태그와 커밋 규약은 [`ADR-015 · Conventional Commits + SemVer`](../philosophy/adr-015-conventional-commits-semver.md) 에 정리돼 있어요.

> **꼭 지켜야 할 전제 — `com.factory.*` 패키지는 건드리지 마세요.** 모든 모듈이 `com.factory.core...`, `com.factory.apps...` 같은 패키지를 써요. 파생 레포에서 이 base 패키지를 자기 이름으로 바꾸면, 나중에 템플릿 커밋을 cherry-pick 할 때 `import` 가 전부 어긋나 충돌이 무더기로 나요. 파생 레포의 정체성은 패키지명이 아니라 [`appSlug`](../reference/glossary.md#이-레포-고유-용어) 로 구분하니, 패키지는 그대로 두는 게 안전해요.

---

## 전체 흐름 한눈에

```
[방향 A] 주 방향 — 템플릿의 공통 개선을 받아오기
   template-spring  ──cherry-pick──▶  파생 레포

[방향 B] 역방향 — 파생 레포의 공통 수정을 되돌리기
   파생 레포  ──cherry-pick──▶  template-spring
```

대부분의 작업은 방향 A 예요. 방향 B 는 파생 레포에서 공통 코드의 버그나 개선을 발견했을 때만 가끔 일어나요.

---

## 파생 레포의 템플릿 마커

cherry-pick 을 시작하기 전에, 내가 지금 템플릿 어느 버전까지 반영했는지부터 알아야 해요. git 히스토리가 끊겨 있어서 이 정보는 git 이 대신 기억해주지 않아요. 그래서 파생 레포 README 최상단에 사람이 읽는 마커로 직접 적어 둬요.

```markdown
## Template base

Based on [template-spring](https://github.com/<you>/template-spring) `template-v0.3.0`.

Last synced: 2026-04-25
Pending sync: v0.4.0 (auth.isPremium 필요)
```

`Based on` 한 줄이 동기화의 기준점이에요. 다음 cherry-pick 은 항상 "여기 적힌 버전 이후" 부터 찾으면 돼요.

---

## 방향 A — 템플릿에서 받아오기

템플릿에 새 공통 기능이나 수정이 생겼을 때, 그 변경을 파생 레포로 가져오는 흐름이에요. 처음 한 번만 템플릿을 remote 로 등록하면, 이후로는 마지막 4단계만 반복하면 돼요.

```bash
# 최초 1회만 — 파생 레포에 템플릿을 remote 로 등록
cd ~/workspace/sumtally-backend
git remote add template git@github.com:<you>/template-spring.git
git fetch template --tags
```

준비가 끝나면 아래 순서로 진행해요.

```bash
# 1. 내 현재 버전 확인 — README 의 "Based on" 줄을 봐요
# 2. 템플릿의 최신 태그 확인
git tag -l "template-v*" --sort=-v:refname | head -5

# 3. 내 마지막 동기화 지점부터 최신까지의 변경 목록
#    --grep 으로 공통 개선(feat/fix)만 추리고, core/ · common/ 경로로 한 번 더 좁혀요
git log template-v0.3.0..template-v0.4.0 \
  --grep="^feat\|^fix" \
  --oneline -- core/ common/

# 4. 필요한 커밋만 골라 전용 브랜치에서 cherry-pick
git checkout -b sync/template-v0.4.0
git cherry-pick <sha1> <sha2>
```

3단계의 `--grep="^feat\|^fix"` 필터가 동작하는 건 모든 커밋이 [Conventional Commits](../reference/glossary.md#개발-프로세스) 형식을 지키기 때문이에요. 어느 커밋이 공통 개선인지를 기계가 알아볼 수 있어서, 도메인 커밋과 섞이지 않고 깔끔하게 추려져요.

충돌이 나면 cherry-pick 이 멈춰요. 해당 파일을 손으로 정리한 뒤 이어가요.

```bash
# 충돌 파일을 수정한 다음
git add <충돌_해결한_파일>
git cherry-pick --continue
```

cherry-pick 이 모두 끝나면 README 의 `Based on` 을 `template-v0.4.0` 으로, `Last synced` 날짜를 오늘로 고친 뒤 PR 을 올려 머지해요.

> 브랜치 이름(`sync/...`)은 예시예요. 템플릿은 자기 브랜치로 `feature/<topic>` 을 쓰지만, 파생 레포의 브랜치 전략은 강제하지 않아요. 본인 팀 컨벤션을 따르면 돼요. 자세한 규약은 [`Git 워크플로우`](../convention/git-workflow.md) 에 있어요.

---

## 방향 B — 템플릿으로 되돌리기

파생 레포를 만지다가 공통 코드의 버그를 고쳤거나 개선했을 때, 그 커밋을 템플릿으로 역전파하는 흐름이에요. 다른 파생 레포들도 같은 개선을 받을 수 있게 되니, 공통 코드 수정은 가능하면 템플릿까지 올려 두는 게 좋아요.

```bash
# 1. 파생 레포에서 먼저 수정을 커밋 (Conventional Commits 형식)
git commit -m "fix(auth): race condition in refresh token rotation"
# 이 커밋의 SHA 를 기억해 둬요 (예: abc9999)

# 2. 템플릿 레포로 이동
cd ~/workspace/template-spring

# 3. 최초 1회만 — 파생 레포를 remote 로 등록
git remote add sumtally git@github.com:<you>/sumtally-backend.git
git fetch sumtally

# 4. 전용 브랜치에서 cherry-pick
git checkout -b fix/refresh-token-race
git cherry-pick abc9999
```

여기서 가장 중요한 검증은 **파생 레포 고유의 도메인 코드가 딸려 오지 않았는지** 확인하는 거예요. 한 커밋에 공통 수정과 도메인 수정이 섞여 있으면, 그 도메인 코드까지 템플릿에 들어와 순수성이 깨져요. 딸려 왔다면 그 부분만 되돌린 뒤 다시 커밋해요.

검증이 끝나면 `CHANGELOG.md` 의 `[Unreleased]` 섹션에 변경을 적고 PR 을 올려요. 템플릿은 feat/fix PR 에서 CHANGELOG 갱신을 CI 로 강제하니 이 단계를 빠뜨리면 머지가 막혀요.

```bash
git add CHANGELOG.md
git commit --amend --no-edit   # CHANGELOG 갱신을 같은 커밋에 포함
git push origin fix/refresh-token-race
```

---

## 충돌이 났을 때

cherry-pick 충돌은 같은 코드가 두 레포에서 따로 진화했다는 신호예요. 흔한 상황과 풀이를 정리하면 이래요.

| 상황 | 풀이 |
|---|---|
| 파일이 파생 레포에서 이미 수정돼 있음 | 손으로 합친 뒤 `git cherry-pick --continue` |
| 기반 버전이 너무 옛날이라 한 번에 점프 (v0.1 → v0.5) | 한 단계씩 — v0.1 → v0.2, 그다음 v0.2 → v0.3 순서로 |
| 이미 deprecated 된 API 를 쓰고 있음 | [`Migration Guides`](../api-and-functional/functional/migration.md) 를 보고 새 API 로 교체 |
| 공통 코드와 도메인 코드가 한 커밋에 섞임 | `git cherry-pick -n <sha>` 로 staged 상태만 가져와 필요한 부분만 선별 |

여러 버전을 한 번에 건너뛰면 충돌이 눈덩이처럼 커져요. 동기화는 자주, 한 단계씩 하는 쪽이 결국 더 빨라요.

---

## 커밋 위생 — cherry-pick 이 되는 커밋 만들기

cherry-pick 이 성립하려면 커밋이 깔끔하게 나뉘어 있어야 해요. **한 커밋은 한 논리적 변경만 담아요.** 공통 코드 수정과 도메인 코드 수정이 한 커밋에 섞이면, 역방향 cherry-pick 때 둘을 떼어낼 수 없어요.

- 공통 코드 개선이 의도라면 **템플릿에서 먼저 작성**하고 파생 레포로 내려보내는 게 정방향이에요.
- 파생 레포에서 우연히 공통 코드를 고쳤다면 **별도 커밋으로 분리**해요.
- 템플릿 레포는 `apps/` 가 비어 있어서 애초에 도메인 코드가 섞일 일이 없어요. 이 순수성은 ArchUnit 규칙 r7·r8 이 빌드 단계에서 강제해요.

같은 원칙이 [`Git 워크플로우 — 커밋 위생`](../convention/git-workflow.md#커밋-위생-cherry-pick-가능성) 에도 정리돼 있어요.

---

## 업그레이드 결정 체크리스트

템플릿에 새 버전이 나오면, 받기 전에 파생 레포에서 다음을 짚어요.

- [ ] 내 현재 버전 확인 — README 의 `Based on`
- [ ] 템플릿 최신 태그 확인 — `git tag -l "template-v*" --sort=-v:refname`
- [ ] CHANGELOG 의 해당 버전 섹션 읽기 — breaking change 가 있으면 migration guide 를 반드시 확인
- [ ] `### Deprecated` 섹션 확인 — 내 앱이 쓰는 API 가 보이면 다음 major 업데이트 계획을 미리 준비
- [ ] 필요한 커밋만 cherry-pick — 전체 merge 는 불가능
- [ ] 충돌 해결
- [ ] 내 앱 전체 테스트 통과
- [ ] README 의 `Based on` 과 `Last synced` 갱신

---

## 관련 문서

- [`Git 워크플로우`](../convention/git-workflow.md) — 브랜치 구조와 커밋 규약
- [`버전 규약 & Deprecation 프로세스`](../api-and-functional/api/versioning.md) — template-v* 태그와 deprecation lifecycle
- [`Migration Guides`](../api-and-functional/functional/migration.md) — breaking change 가 있는 버전의 마이그레이션 절차
- [`ADR-002 · GitHub Template Repository 패턴`](../philosophy/adr-002-use-this-template.md) — 템플릿 패턴과 cherry-pick 전파를 채택한 근거
- [`ADR-015 · Conventional Commits + SemVer`](../philosophy/adr-015-conventional-commits-semver.md) — 커밋 규약과 버전 태그가 cherry-pick 을 가능하게 하는 메커니즘

---

## 책 목차 — Journey 7단계, 마지막

이 문서는 [`template-spring 책 목차`](../onboarding/README.md) 의 **7단계 — 이제 use this template** 을 마무리하는 글이에요. 여기까지 오면 본인 도메인 작업을 시작할 준비가 끝나요.

| 방향 | 문서 | 한 줄 |
|---|---|---|
| ← 이전 | [`운영 배포 가이드`](../production/deploy/deployment.md) | 같은 7단계, 파생 레포의 첫 운영 배포 |
| → 다음 | (책의 끝) | 이제 본인 도메인 코드를 작성할 차례예요 |

막혔을 때 참고할 곳:

- 운영 절차와 장애 대응: [`운영 런북`](../production/deploy/runbook.md)
- 리스크 시나리오 분석: [`Edge Cases & Risk Analysis`](../reference/edge-cases.md)

이 흐름을 왜 이렇게 설계했는지는 [`ADR-002`](../philosophy/adr-002-use-this-template.md) 와 [`ADR-015`](../philosophy/adr-015-conventional-commits-semver.md) 에서 확인하세요.
</content>
</invoke>
