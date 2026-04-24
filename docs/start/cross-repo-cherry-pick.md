# 크로스 레포 Cherry-pick 가이드

이 문서는 `spring-backend-template` 의 변경을 파생 레포(Use this template 으로 복제한 서비스 레포)로 가져오는 플로우 또는 역방향을 설명합니다.

---

## 전제

이 템플릿은 **Use this template** 모델을 사용합니다. 파생 레포는 git 히스토리가 분리되어 있어 fork 와 달리 merge 로 동기화할 수 없습니다. 공통 코드 개선은 **cherry-pick** 으로 전파합니다.

자세한 철학: [ADR-002 (GitHub Template Repository 패턴)](../philosophy/adr-002-use-this-template.md), [ADR-015 (Conventional Commits + SemVer)](../philosophy/adr-015-conventional-commits-semver.md).

---

## 파생 레포의 템플릿 마커

파생 레포의 README 최상단에 필수 기재:

```markdown
## Template base

Based on [spring-backend-template](https://github.com/<you>/spring-backend-template) `template-v0.3.0`.

Last synced: 2026-04-25
Pending sync: v0.4.0 (auth.isPremium 필요)
```

이 마커는 "내가 지금 어느 버전까지 반영했는가" 를 명시적으로 기록 — git 대신 사람이 읽는 문서로 관리.

---

## 방향 A: 템플릿 → 파생 레포 (주 방향)

새 공통 기능/수정을 파생 레포에 가져오기.

```bash
# 파생 레포에서 시작 (최초 1회만 remote 등록)
cd ~/workspace/app-sumtally
git remote add template git@github.com:<you>/spring-backend-template.git
git fetch template --tags

# 1. 내 버전 확인 — README 의 "Based on" 확인
# 2. 템플릿 최신 태그 확인
git tag -l "template-v*" --sort=-v:refname | head -5

# 3. 내 마지막 동기화 지점 → 최신 사이 변경 확인
git log template-v0.3.0..template-v0.4.0 --oneline -- core/ common/

# 4. 필요한 커밋 선택 후 cherry-pick
git checkout -b sync/template-v0.4.0
git cherry-pick <sha1> <sha2> ...

# 5. 충돌 시 수동 해결 후:
#    git add <file>
#    git cherry-pick --continue

# 6. README 의 "Based on" 을 v0.4.0 으로 업데이트
# 7. 자기 레포 PR → 머지
```

---

## 방향 B: 파생 레포 → 템플릿 (역방향)

파생 레포에서 공통 코드 버그/개선 발견 시 템플릿으로 역전파.

```bash
# 1. 파생 레포에서 먼저 fix 커밋 (Conventional Commits 준수)
git commit -m "fix(auth): race condition in refresh token rotation"
# SHA: abc9999

# 2. 템플릿 레포로 이동
cd ~/workspace/spring-backend-template

# 3. 파생 레포를 remote 로 등록 (최초 1회)
git remote add app-sumtally git@github.com:<you>/app-sumtally.git
git fetch app-sumtally

# 4. feature 브랜치에서 cherry-pick
git checkout -b fix/refresh-token-race
git cherry-pick abc9999

# 5. (중요) 파생 레포 고유 도메인 코드가 딸려왔는지 검증
#    ADR-002 의 커밋 위생 원칙: "공통·도메인 분리" (cherry-pick 기계 필터링 가능하도록)
#    딸려왔다면 해당 부분 revert 후 다시 커밋

# 6. CHANGELOG [Unreleased] 에 추가 → PR → main
git commit --amend  # CHANGELOG 수정 포함
git push origin fix/refresh-token-race
```

---

## 충돌 해결 가이드

### 흔한 충돌 시나리오

| 원인 | 해결 |
|---|---|
| 파일이 파생 레포에서 이미 수정됨 | 수동 merge 후 `git cherry-pick --continue` |
| 기반 버전이 너무 옛날 (v0.1 → v0.5 점프) | 한 단계씩: v0.1 → v0.2 먼저, 그 다음 v0.2 → v0.3 ... |
| deprecated API 이미 쓰고 있음 | `docs/features/migration.md` 참고 후 신규 API 로 교체 |
| 공통 코드와 도메인 코드가 한 커밋에 섞임 | `git cherry-pick -n <sha>` 로 staged 상태만 가져와 선별 |

### 커밋 위생 원칙

**한 커밋은 한 논리적 변경만.** 파생 레포에서 공통 코드 수정이 도메인 코드 수정과 섞이면 역 cherry-pick 불가.

- 공통 코드 개선 의도면 **먼저 템플릿에서 작성** → 파생 레포로 내려감
- 파생 레포에서 우연히 공통 코드 고친 경우 **별도 커밋으로 분리**
- 템플릿 레포는 apps/ 가 비어있어 혼합 위험 없음

---

## 업그레이드 결정 체크리스트

새 템플릿 버전이 나오면 파생 레포에서 검토:

- [ ] 내 현재 버전 확인 (README "Based on")
- [ ] 템플릿 최신 태그 확인 (`git tag -l "template-v*" --sort=-v:refname`)
- [ ] CHANGELOG 의 해당 버전 섹션 읽기 — breaking 있으면 migration guide 필수 확인
- [ ] `### Deprecated` 섹션 — 내 앱에서 쓰는 API 가 있으면 미래 주요 버전 업데이트 계획 준비
- [ ] 필요한 커밋만 cherry-pick (전체 merge 불가)
- [ ] 충돌 해결
- [ ] 내 앱 전체 테스트 통과
- [ ] README "Based on" 업데이트
- [ ] README "Last synced" 날짜 업데이트

---

## 관련 문서

- [Git 워크플로우 (Git Workflow)](../convention/git-workflow.md) — 브랜치 · 커밋 규약
- [버전 규약 & Deprecation 프로세스](../api-and-functional/api/versioning.md) — 버전 · Deprecation
- [ADR-002 · GitHub Template Repository 패턴 (Use this template)](../philosophy/adr-002-use-this-template.md) — template 패턴 + cherry-pick 전파
- [ADR-015 · Conventional Commits + 템플릿 전체 semver](../philosophy/adr-015-conventional-commits-semver.md) — Conventional Commits + template-v* SemVer
- [Migration Guides](../api-and-functional/functional/migration.md) — 버전별 migration guide (breaking 있을 때만)

---

## 📖 책 목차 — Journey 7단계 (마지막)

[📚 spring-backend-template — 책 목차 (Developer Journey)](../onboarding/README.md) 의 **7단계 — 이제 use this template** 의 마무리 문서입니다.

| 방향 | 문서 | 한 줄 |
|---|---|---|
| ← 이전 | [운영 배포 가이드 (파생레포 onboarding)](../production/deploy/deployment.md) | 같은 7단계, 파생 레포 첫 운영 배포 |
| → 다음 | (책 끝) — 본인 도메인 작업 시작 | 막히면 [운영 런북 (Runbook)](../production/deploy/runbook.md) (운영 절차) 참고 |

**막혔을 때**: [운영 런북 (Runbook)](../production/deploy/runbook.md) (장애 대응) / [Edge Cases & Risk Analysis](../reference/edge-cases.md) (리스크 시나리오)
**왜 이렇게?**: [ADR-002 (template 패턴)](../philosophy/adr-002-use-this-template.md) + [ADR-015 (Conventional Commits)](../philosophy/adr-015-conventional-commits-semver.md)
