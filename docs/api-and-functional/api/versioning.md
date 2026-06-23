# 버전 규약 · API 버전 정책 · Deprecation 프로세스

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~7분

이 문서는 `template-spring` 의 세 가지 규약을 한곳에 모아요 — 템플릿 전체의 SemVer 버저닝, API URL 의 버전 정책, 그리고 Deprecation 라이프사이클이에요. 릴리스를 자르거나, 엔드포인트를 바꾸거나, 메서드를 은퇴시킬 때 여기서 규칙을 찾아보세요.

> 📌 **현재 상태**: 최신 태그는 `template-v0.3.0` 입니다 (루트 `CHANGELOG.md` 의 *Released versions* 참조). major 0 → 1 승격은 *Phase 0 안정화* 이후 예정이에요. breaking change 없이 기본 기능이 완성되는 시점이에요.

---

## 버전 단위 — 템플릿 전체

Git 태그 형식은 `template-v<major>.<minor>.<patch>` 입니다.

| | 값 | 이유 |
|---|---|---|
| 단위 | 템플릿 레포 전체 (core 모듈 · common · bootstrap · docs) | 솔로 운영, 모듈 간 의존 그래프 연관 |
| 첫 버전 | `template-v0.1.0` | 초기 템플릿 공개 시점 |
| 1.0.0 승격 | Phase 0 안정화 이후 | breaking 없이 기본 기능 완성 시 |

### SemVer 판단

| 상황 | bump |
|---|---|
| breaking change 포함 | major (X.0.0) |
| 새 기능 (feat) 있고 breaking 없음 | minor (0.X.0) |
| 버그 수정·잡무·문서·스타일·리팩토링만 | patch (0.0.X) |

breaking 인지 아닌지의 판단은 "파생 레포가 그대로 빌드되는가" 가 기준이에요. 아래 예시로 감을 잡아요.

| breaking (major) | non-breaking (minor/patch) |
|---|---|
| Port 메서드 시그니처 변경 | 새 Port 메서드 추가 |
| DTO 필드 rename·타입 변경 | DTO 에 optional 필드 추가 (NON_NULL + unknown IGNORE 정책 덕) |
| DB 스키마 변경 (신규 NOT NULL 컬럼) | 새 엔드포인트 추가 |
| 환경변수 이름 변경 | — |
| DTO suffix 변경 (`UserSummary` → `UserDigest`) | — |

optional 필드 추가가 안전한 이유는 직렬화 정책에 있어요. 응답은 `NON_NULL` 이라 null 필드가 빠지고, 요청은 unknown 필드를 무시하므로, 클라이언트가 모르는 새 필드가 생겨도 깨지지 않아요.

---

## API URL 버전 정책

**API 경로에 `/v1/` 같은 버전 접두사를 쓰지 않아요.** 이건 누락이 아니라 의도된 결정이에요. 근거는 [`ADR-008 · API 버전 관리 미도입`](../../philosophy/adr-008-no-api-versioning.md) 에 정리돼 있어요 — 서버와 Flutter 앱을 같은 사람이 운영해서, API 가 바뀌면 둘을 같이 배포하면 끝이라 버전 공존이 필요 없거든요.

### 현재 경로 체계

모든 경로는 `common-web` 의 [`ApiEndpoints`](https://github.com/storkspear/template-spring/blob/main/common/common-web/src/main/java/com/factory/common/web/ApiEndpoints.java) 상수 한곳에서 관리돼요. 컨트롤러의 `@RequestMapping`, `SecurityConfig` 의 `requestMatchers`, 테스트의 MockMvc 가 전부 이 상수를 참조합니다. 경로 prefix 는 두 가지뿐이에요.

| Prefix | 용도 | 예시 |
|---|---|---|
| `/api/apps/{appSlug}/*` | 앱별 엔드포인트 ([`ADR-013`](../../philosophy/adr-013-per-app-auth-endpoints.md)) | `/api/apps/{appSlug}/auth/email/signup` |
| `/api/core/*` | 크로스 앱 공통 엔드포인트 | `/api/core/users/me` |

`ApiEndpoints.APP_BASE` 가 `/api/apps/{appSlug}` 이고, 앱별 도메인 (auth · device · notification-preferences) 이 그 아래로 붙어요. core 도메인 (user 등) 은 `appSlug` 와 무관해서 `/api/core/*` 를 직접 써요.

### 도입은 한 줄 작업으로 열려 있어요

미래에 공개 API 나 멀티 버전 클라이언트가 생기면 버전 접두사를 도입할 수 있어요. 두 경로가 있어요.

- **`ApiEndpoints` prefix 변경** — `APP_BASE` 를 `/api/v1/apps/{appSlug}` 로 한 줄 수정 (대개 이쪽)
- **Cloudflare 리버스 프록시 재작성** — `/api/v1/*` → `/api/*` 규칙 추가 (코드 변경 0)

도입 시점 신호와 멀티 버전 공존 설계는 [`ADR-008`](../../philosophy/adr-008-no-api-versioning.md) 의 *도입 경로 두 가지* 에 기록돼 있어요. 지금은 그 구조를 준비할 필요조차 없어요.

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

1. `[Unreleased]` 섹션은 항상 상단에 둡니다. 모든 PR 이 여기에 한 줄을 추가해요.
2. 각 항목엔 scope 접두사가 필수입니다 — `**core-auth-api**:`, `**common-web**:` 처럼 적어요.
3. 릴리스 시엔 `[Unreleased]` → `[x.y.z] - YYYY-MM-DD` 로 옮기고, 새 빈 `[Unreleased]` 를 상단에 추가해요.
4. Scope 가 여러 모듈에 걸치면 항목을 분할합니다 (한 항목은 한 scope).
5. docs·chore·style·ci 타입이라도 의미 있는 정리는 명시 기록해요. CI 에서 자동 스킵되지만, 아래 경우는 운영자가 `[Unreleased]` 에 수기로 추가합니다.
   - 공개 용어·표현의 통일 (예: 문서 용어 규약 변경)
   - 다수 파일의 문서 정리 (삭제·이동·구조 변경)
   - 파생 레포에 영향 가는 컨벤션 변경
   - 깨진 내부 링크·참조 일괄 정리

### CI 강제

- `changelog-check` workflow — feat·fix 류 PR 이 `[Unreleased]` 섹션을 수정했는지 확인합니다 (docs·chore·style·ci 는 skip — 위 규칙 5번이 운영자 책임).
- `release-pr-validate` workflow — `release/v*` 브랜치 PR 은 `[x.y.z]` 섹션 추가와 새 `[Unreleased]` 유지를 확인합니다.

### 자동화 로드맵

현재는 수기 기입이에요. 릴리스 빈도가 늘거나 파생 레포 수가 많아지면 다음 단계로 전환해요.

| 단계 | 방식 | 도구 | 시점 |
|---|---|---|---|
| **현재** | 수기 기입 + CI 존재 검사 | commitlint + `changelog-check.yml` | — |
| **다음** | 릴리스 직전 초안 자동 생성 → 사람이 보정 | `conventional-changelog-cli` + `tools/changelog/update-unreleased.sh` | 릴리스 월 2회 이상 시 |
| **이후** | PR 단위 changeset 파일 | `changesets` (`.changeset/*.md` 자동 머지) | 파생 레포 5개 이상 시 |

도입 시 배치 위치는 `tools/changelog/` + `package.json` 스크립트 등록이에요. 규약 자체 (위 *운영 규칙*) 는 자동화 여부와 무관하게 고정입니다.

---

## 릴리스 프로세스

### 평상시 (feat · fix)

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

breaking 을 미루는 이유는 파생 레포 마이그레이션 시간을 확보하기 위함이에요.

---

## Deprecation 프로세스

### 3단계 라이프사이클

```
[Active] ──deprecate──> [Deprecated] ──next major──> [Removed]
 v0.2.0                  v0.3.0 ~ v0.x.y              v1.0.0
```

### 필수 요소 — 코드·CHANGELOG·문서

deprecation 1건은 어노테이션 두 개와 CHANGELOG 한 줄로 끝나요. 복잡한 변경일 때만 별도 migration guide 가 붙어요.

**1. Java `@Deprecated`** — `since` 와 `forRemoval` 을 반드시 채웁니다. 빈 `@Deprecated` 는 ArchUnit 규칙 r20 (`DEPRECATED_MUST_DECLARE_SINCE_AND_FOR_REMOVAL`) 이 빌드 시점에 막아요.

```java
@Deprecated(since = "0.3.0", forRemoval = true)
public void oldMethodName(RequestType request) {
    newMethodName(request);
}
```

r20 은 두 속성의 *존재* 만 검사해요 — `since` 가 비어 있거나 `forRemoval` 이 없으면 위반이에요. 값의 형식 (예: `0.3.0` vs `v0.3.0`) 까지는 강제하지 않으니, 본 레포는 태그에서 `template-v` 를 뗀 `0.3.0` 형태로 적어요.

**2. Javadoc `@deprecated`** — 마이그레이션 경로를 적어요.

```java
/**
 * @deprecated since 0.3.0, for removal in v1.0.0.
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

**4. Migration guide** ([`migration.md`](../functional/migration.md)) — 복잡한 경우만 작성합니다. 단순 rename 은 CHANGELOG 만으로 충분해요. 필드 의미 변경·연쇄 변경·DTO 재구성처럼 단계가 여럿이면 별도 guide 를 둬요.

> 참고 — 현재 템플릿 소스에는 `@Deprecated(since=…, forRemoval=…)` 사용 사례가 아직 없어요. 첫 메서드를 은퇴시킬 때 r20 이 위 형식을 그대로 강제하므로, 위 예시가 곧 실제 작성 형태가 돼요.

### Removal 규칙

- Removal 시점은 다음 major 버전입니다.
- 최소 유예는 1개 이상의 minor 주기예요.
- 긴급 보안 예외 — deprecation 없이 즉시 major + 제거가 가능해요.

### 신규 기능과 동시 deprecation

같은 PR 에서 신규 API 추가와 기존 메서드 deprecated 마킹을 함께 합니다. 단순 삭제·rename 은 금지예요. 반드시 "신규 추가 → 기존 deprecated → 다음 major 제거" 3단계를 거쳐요.

### 되살리기

Deprecated 취소가 가능해요. 어노테이션을 제거하고 CHANGELOG `### Changed` 에 기록합니다.

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

태그는 코드를 바꾸지 않아요 — 실수해도 원복이 안전해요.

### 자동 GitHub Release

`template-v*` 태그를 push 하면 `release.yml` workflow 가 CHANGELOG 의 해당 섹션을 추출해서 GitHub Release 를 자동 생성합니다.

---

## 관련 문서

- [`ADR-008 · API 버전 관리 미도입`](../../philosophy/adr-008-no-api-versioning.md) — URL `/v1/` 거절 근거 + 도입 경로
- [`ADR-015 · Conventional Commits + SemVer`](../../philosophy/adr-015-conventional-commits-semver.md) — 커밋·태그 체계
- [`ADR-002 · GitHub Template Repository 패턴`](../../philosophy/adr-002-use-this-template.md) — 템플릿 전파
- [`Architecture Rules (ArchUnit)`](../../structure/architecture-rules.md) — r20 (`@Deprecated` 속성 강제) 정의
- [`Git 워크플로우`](../../convention/git-workflow.md) — 브랜치 · 커밋 규약 · Merge 정책
- [`크로스 레포 Cherry-pick 가이드`](../../start/cross-repo-cherry-pick.md) — 파생 레포 동기화
- [`Migration Guides`](../functional/migration.md) — 버전별 migration guide
