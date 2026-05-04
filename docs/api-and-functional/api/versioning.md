# 버전 규약 & Deprecation 프로세스

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~6분

이 문서는 `template-spring` 의 semver 버저닝 · CHANGELOG · Deprecation 프로세스를 정의해요.

> 📌 **현재 상태**: 최신 태그 `template-v0.3.0` (CHANGELOG.md 의 *Released versions* 참조). major 0 → 1 승격은 *Phase 0 안정화* 후 예정 — breaking change 없이 기본 기능이 완성되는 시점이에요.

---

## 버전 단위 — 템플릿 전체

Git 태그 형식은 `template-v<major>.<minor>.<patch>` 예요.

| | 값 | 이유 |
|---|---|---|
| 단위 | 템플릿 레포 전체 (core-*-api + common + bootstrap + docs) | 솔로 운영, 모듈 간 의존 그래프 연관 |
| 첫 버전 | `template-v0.1.0` | 초기 템플릿 공개 시점 |
| 1.0.0 승격 | Phase 0 안정화 후 | breaking 없이 기본 기능 완성 시 |

### semver 판단

| 상황 | bump |
|---|---|
| BREAKING CHANGE 포함 | **major** (X.0.0) |
| 새 기능 (feat) 있고 breaking 없음 | **minor** (0.X.0) |
| fix / chore / docs / style / refactor 만 | **patch** (0.0.X) |

**Breaking 판단 예시**:
- Port 메서드 시그니처 변경
- DTO 필드 rename / 타입 변경
- DB 스키마 변경 (신규 NOT NULL 컬럼 추가)
- 환경변수 이름 변경
- DTO suffix 변경 (예: `UserSummary` → `UserDigest`)

**Non-breaking 예시**:
- DTO 에 optional 필드 추가 (NON_NULL 정책 + IGNORE unknown 덕분)
- 새 Port 메서드 추가
- 새 엔드포인트 추가

---

## CHANGELOG 규약 (Keep a Changelog)

### 파일 구조

루트 `CHANGELOG.md` 의 구조예요.

```markdown
# Changelog

## [Unreleased]

### Added
-

### Changed
-

### Deprecated
-

### Removed
-

### Fixed
-

### Security
-

---

## [0.2.0] - 2026-04-25

### Added
- **core-auth-api**: `isPremium` field on `AuthResponse`

### Changed
- **core-auth-impl**: `RefreshTokenService` now requires explicit `TokenFamily` param

### Deprecated
- **module-name**: `oldMethodName` — use `newMethodName`. Removal in `v1.0.0`.

### Fixed
- **core-auth-impl**: race condition in refresh token rotation
```

### 운영 규칙

1. `[Unreleased]` 섹션은 항상 상단에 둬요. 모든 PR 이 여기에 한 줄을 추가해요.
2. 각 항목엔 **scope 접두사가 필수** 예요 — `**core-auth-api**:`, `**common-web**:` 처럼 적어요.
3. 릴리스 시엔 `[Unreleased]` → `[x.y.z] - YYYY-MM-DD` 로 이동하고, 새 빈 `[Unreleased]` 를 상단에 추가해요.
4. Scope 가 여러 모듈에 걸치면 **여러 항목으로 분할** 해요 (한 항목은 한 scope).
5. **docs/chore/style/ci 타입이라도 의미 있는 정리는 명시 기록해요.** CI 에서 자동 스킵되지만, 아래 경우는 `[Unreleased]` 에 수기로 추가해요.
   - 공개 용어·표현의 통일 (예: 문서 용어 규약 변경)
   - 다수 파일의 문서 정리 (삭제/이동/구조 변경)
   - 파생 레포에 영향 가는 컨벤션 변경
   - 깨진 내부 링크·참조 일괄 정리

### CI 강제

- `changelog-check` workflow — `feat/fix/...` PR 이 `[Unreleased]` 섹션을 수정했는지 확인해요 (`docs/chore/style/ci` 는 skip — 규칙 5번 운영자 책임).
- `release-pr-validate` workflow — `release/v*` 브랜치 PR 은 `[x.y.z]` 섹션 추가 + 새 `[Unreleased]` 유지를 확인해요.

### 자동화 로드맵

현재는 **수기 기입** 이에요. 릴리즈 빈도가 늘거나 파생 레포 수가 많아지면 다음 단계로 전환해요.

| 단계 | 방식 | 도구 | 시점 |
|------|------|------|------|
| **현재** | 수기 기입 + CI 존재 검사 | commitlint + changelog-check.yml | — |
| **다음** | 릴리즈 직전 초안 자동 생성 → 사람이 보정 | `conventional-changelog-cli` + `tools/changelog/update-unreleased.sh` | 릴리즈 월 2회 이상 시 |
| **이후** | PR 단위 changeset 파일 | `changesets` (`.changeset/*.md` 자동 머지) | 파생 레포 5개 이상 시 |

도입 시 배치 위치는 `tools/changelog/` + `package.json` 스크립트 등록이에요. 규약 자체 (상단 "운영 규칙") 는 자동화 여부와 무관하게 고정이에요.

---

## 릴리스 프로세스

### 평상시 (feat / fix)

```bash
git checkout -b feat/isPremium
# 작업 + conventional commit
git commit -m "feat(auth): add isPremium field"

# CHANGELOG [Unreleased] 에 한 줄 추가
git commit -m "docs: CHANGELOG for isPremium"
git push
# PR → rebase merge
```

### 릴리스 시점

```bash
git checkout -b release/v0.3.0

# CHANGELOG 편집:
#  [Unreleased] → [0.3.0] - 2026-04-25 로 이동
#  새 빈 [Unreleased] 섹션 상단 추가
git add CHANGELOG.md
git commit -m "chore: release v0.3.0"
git push
# PR "chore: release v0.3.0" → CI green → rebase merge

# 태그 생성
git checkout main && git pull
git tag -a template-v0.3.0 -m "Release v0.3.0"
git push origin template-v0.3.0
# release.yml workflow 자동 실행 → GitHub Release 생성
```

### 릴리스 주기 가이드

- **Patch** (x.y.Z) — 버그 발견 시 즉시 ~ 1~2일
- **Minor** (x.Y.0) — 월 1~2회, 누적 기능 묶음
- **Major** (X.0.0) — 분기·반기, breaking 모아서

Breaking 을 미루는 이유는 파생 레포 마이그레이션 시간을 확보하기 위함이에요.

---

## Deprecation 프로세스

### 3단계 라이프사이클

```
[Active] ──deprecate──> [Deprecated] ──next major──> [Removed]
 v0.2.0                  v0.3.0 ~ v0.x.y              v1.0.0
```

### 필수 4가지 요소

**1. Java `@Deprecated`**:
```java
@Deprecated(since = "v0.3.0", forRemoval = true)
public void oldMethodName(RequestType request) {
    newMethodName(request);
}
```

**2. Javadoc `@deprecated`** — 마이그레이션 경로 적기:
```java
/**
 * @deprecated since v0.3.0, for removal in v1.0.0.
 *             Use {@link #newMethodName(RequestType)} instead.
 *             Migration: behavior is identical; just rename the call.
 */
```

**3. CHANGELOG `### Deprecated`**:
```markdown
### Deprecated
- **module-name**: `oldMethodName` — use `newMethodName`.
  Removal in `v1.0.0`. No behavioral change.
```

**4. `docs/api-and-functional/functional/migration.md`** — 복잡한 경우만:

단순 rename 은 CHANGELOG 만으로 충분해요. 필드 의미 변경·연쇄 변경·DTO 재구성 시엔 별도 guide 가 필요해요.

### Removal 규칙

- Removal 시점은 **다음 major 버전** 이에요
- 최소 유예는 **1 개 이상의 minor 주기** 예요
- 긴급 보안 예외 — deprecation 없이 즉시 major + 제거가 가능해요

### 신규 기능 동시 deprecation

같은 PR 에서 **신규 API + 기존 deprecated 마킹** 을 함께 해요. 단순 삭제·rename 은 금지예요. 반드시 "신규 추가 → 기존 deprecated → 다음 major 제거" 3단계를 거쳐요.

### 되살리기

Deprecated 취소가 가능해요. 어노테이션 제거 + CHANGELOG `### Changed` 에 기록해요.

---

## Git 태그 운영

### 태그 이름 규약

- 형식 — `template-v<major>.<minor>.<patch>` (예: `template-v0.3.0`)
- Pre-release — `template-v1.0.0-rc1` (suffix 허용)
- CI 가 `tag-validate.yml` 로 정규식 검증 — 위반 시 거부

### 태그 실수 시 원복

```bash
# 잘못된 태그 이름
git tag -d tempalte-v1.3.0              # 로컬 삭제
git push origin :tempalte-v1.3.0         # 원격 삭제

# 재생성
git tag -a template-v1.3.0 -m "..."
git push origin template-v1.3.0
```

**태그는 코드를 바꾸지 않아요** — 실수해도 원복이 안전해요.

### 자동 GitHub Release

`template-v*` 태그 push → `release.yml` workflow 가 CHANGELOG 해당 섹션을 추출해서 GitHub Release 를 자동 생성해요.

---

## 관련 문서

- [`Git 워크플로우 (Git Workflow)`](../../convention/git-workflow.md) — 브랜치 · 커밋 규약 · Merge 정책
- [`크로스 레포 Cherry-pick 가이드`](../../start/cross-repo-cherry-pick.md) — 파생 레포 동기화
- [`ADR-002 · GitHub Template Repository 패턴`](../../philosophy/adr-002-use-this-template.md) — 템플릿 전파
- [`ADR-008 · API 버전 관리 미도입`](../../philosophy/adr-008-no-api-versioning.md) — URL 버저닝 거절 근거
- [`ADR-015 · Conventional Commits + SemVer`](../../philosophy/adr-015-conventional-commits-semver.md) — 커밋/태그 체계
- [`Migration Guides`](../functional/migration.md) — 버전별 migration guide
