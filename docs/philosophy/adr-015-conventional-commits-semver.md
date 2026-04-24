# ADR-015 · Conventional Commits + 템플릿 전체 semver

**Status**: Accepted. 2026-04-24 기준 모든 커밋에 Conventional Commits 포맷 강제 (commitlint + husky + CI). Git 태그는 `template-v<major>.<minor>.<patch>` 템플릿 레포 전체 단위. CHANGELOG 는 Keep a Changelog 포맷. Breaking change 는 Deprecation 3단계 경유 (ArchUnit r20 강제).

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~5분

## 결론부터

커밋 메시지 포맷을 기계가 강제하고 (`commitlint`), 버전은 **모듈별이 아니라 템플릿 레포 전체** 를 한 단위로 SemVer 관리해요. 이렇게 한 이유는 단 하나 — **파생 레포의 cherry-pick 을 가능하게 만들기 위해서**. Conventional Commits 는 "어느 커밋이 공통 코드 개선인지" 를 `git log --grep="^feat\\|^fix"` 같은 명령으로 기계가 읽을 수 있게 해줘요. 파생 레포는 "template-v0.3.0 기반" 한 줄로 간단하게 추적. Breaking change 는 반드시 Deprecation 3단계 (Active → Deprecated → Removed) 를 거치며, ArchUnit r20 이 `@Deprecated(since, forRemoval)` 선언을 기계 강제.

## 왜 이런 고민이 시작됐나?

[ADR-002 (Use this template)](./adr-002-use-this-template.md) 에서 우리는 **파생 레포 패턴** 을 채택했어요:

- 템플릿 레포 (본 레포) 에서 공통 코드 개선
- 파생 레포 (`sumtally-backend`, `rny-backend` 등) 가 그 개선을 **cherry-pick** 으로 받음

이 전파 메커니즘이 작동하려면 핵심 질문 하나가 해결되어야 해요:

> **"어느 커밋을 cherry-pick 해야 공통 코드 개선을 전파하는가?"**

예를 들어 템플릿 레포에 지난 한 달 동안 커밋 50 개가 있다면:

- 5개: 새 공통 기능 (모든 파생 레포에 필요)
- 10개: 버그 수정 (모든 파생 레포에 필요)
- 15개: 문서 업데이트 (선택적)
- 20개: 특정 앱 스캐폴딩 템플릿 (파생 레포마다 판단)

**사람이 커밋 메시지를 읽고 분류** 하는 건 매번 피로 + 실수 가능. 자동화가 필요.

게다가 파생 레포 운영자는 "template-v0.3.0 을 썼는데 v0.4.0 에 뭐가 바뀌었지?" 를 빠르게 확인할 수 있어야 함. 이를 위해:

1. 커밋 메시지가 **기계 읽기 가능한 포맷** 이어야 함 (`feat:`, `fix:` 등)
2. 버전이 **template 전체 단위** 로 찍혀 있어야 함 (`template-v0.4.0`)
3. `CHANGELOG` 가 모든 변경을 요약해야 함

이 결정이 답할 물음은 이거예요.

> **파생 레포 cherry-pick 모델이 실제로 작동하려면, 템플릿 레포의 커밋/버전 관리는 어떤 모양이어야 하는가?**

## 고민했던 대안들

### Option 1 — 자유 형식 커밋 + 모듈별 SemVer

각 모듈 (core-auth-api, common-web 등) 이 자기 버전을 가짐. 커밋 메시지 포맷은 강제 없음.

- **장점**:
  - 개발 자유도 높음
  - 모듈 단위로 "안 바뀐 모듈" 을 파생 레포가 건너뛸 수 있음 (이론적으로)
- **단점**:
  - cherry-pick 필터링 불가 — `git log` 에서 "어떤 커밋이 공통 개선?" 기계 판별 불가
  - 모듈 간 의존 관계 (auth ↔ user) 로 인해 실제로는 한 모듈만 독립 업데이트 거의 불가
  - 모듈 5개 × 버전 추적 = 솔로 운영에서 감당 어려움
  - "현재 레포 상태" 를 한 줄로 표현 불가
- **탈락 이유**: cherry-pick 모델 자체가 불가능해짐. [제약 2 (시간이 가장 희소한 자원)](./README.md#제약-2--시간이-가장-희소한-자원) 에 정면 충돌.

### Option 2 — Conventional Commits + 커밋 단위 SemVer (commit 마다 tag)

커밋마다 태그 자동 부여 (`template-v0.1.0`, `template-v0.1.1`, ...). semantic-release 같은 도구로 자동화.

- **장점**:
  - 매 커밋이 릴리스 단위. 극도로 fine-grained 추적
  - 완전 자동화
- **단점**:
  - **태그 수 폭증** — 1년에 태그 수천 개. `git tag --list` 가 쓸모없음
  - 실제로 **"의미있는 버전"** 은 커밋마다 찍히지 않음 — 누적된 변경이 의미 있을 때가 버전 단위
  - 세밀함이 곧 혼란 — 파생 레포가 "v0.3.47 과 v0.3.48 중 뭘 써?" 라고 물으면 답이 어려움
- **탈락 이유**: fine-grained 의 함정. 버전 정보의 가치는 **집약된 의미** 에서 나옴.

### Option 3 — Conventional Commits + 템플릿 전체 SemVer (수동 tag) ★ (채택)

모든 커밋에 Conventional Commits 포맷 강제. 버전 태그는 **의미있는 시점에 수동으로** 찍음 (`template-v0.1.0`, `template-v0.2.0`, `template-v0.3.0`).

- **장점**:
  - **cherry-pick 쿼리 가능** — `git log template-v0.2.0..template-v0.3.0 --grep="^feat\\|^fix"` 로 공통 개선만 필터
  - **버전 추적 간단** — 파생 레포는 "v0.3.0 기반" 한 줄로 충분
  - **릴리스 서사** — CHANGELOG 의 [0.3.0] 섹션이 "이 버전의 주요 변경" 을 요약
  - **Breaking change 의 Deprecation 경로 보장** — minor/major 구분이 명확하므로 deprecation 주기 관리 가능
- **단점**:
  - 초기 셋업 비용 (commitlint, husky, CHANGELOG, workflows) — 1회성
  - 학습 곡선 — 개발자가 `feat:`, `fix:` 타입에 익숙해져야 함
  - 태그 찍는 타이밍이 판단 필요 (자동 아님)
- **채택 이유**:
  - cherry-pick 모델 + 버전 추적 단순화를 동시 확보
  - 초기 비용은 1회성, 장기 이득은 운영 내내 작동 ([ADR-007](./adr-007-solo-friendly-operations.md) 의 "현재 부담 vs 미래 부담 감소" 트레이드오프)
  - 솔로 운영에서 "여러 버전 동기화" 를 **한 버전 추적** 으로 환원

## 결정

### 구성 요소 전체 매트릭스

| 구성요소 | 도구 | 역할 |
|---|---|---|
| 커밋 포맷 | `commitlint` + `@commitlint/config-conventional` | `type(scope): subject` 포맷 강제 |
| Git 훅 | `husky` | 로컬에서 commit-msg 검증 + Claude 코어서 차단 |
| CI 검증 | `.github/workflows/commit-lint.yml` | PR 커밋의 포맷 재검증 |
| PR 제목 | `.github/workflows/pr-title.yml` | PR 제목도 Conventional Commits 준수 |
| CHANGELOG | `CHANGELOG.md` (Keep a Changelog) | [Unreleased] + 릴리스별 섹션 |
| 버전 tag | `template-v<M>.<m>.<p>` | 템플릿 레포 전체 단위 |
| 릴리스 자동화 | `.github/workflows/release.yml` | tag push → CHANGELOG 추출 → GitHub Release 생성 |
| Deprecation | `@Deprecated(since, forRemoval)` + ArchUnit r20 | 3단계 라이프사이클 강제 |
| 커밋 템플릿 | `.gitmessage` | Commitizen 없이도 커밋 메시지 가이드 |

### commitlint 룰 (핵심)

```javascript
// commitlint.config.mjs
export default {
    extends: ['@commitlint/config-conventional'],
    rules: {
        'type-enum': [2, 'always', [
            'feat', 'fix', 'docs', 'style', 'refactor',
            'perf', 'test', 'chore', 'build', 'ci'
        ]],
        'scope-enum': [1, 'always', [
            'auth', 'user', 'device', 'push', 'billing',
            'common', 'bootstrap', 'spec', 'docs',
            'core', 'apps', 'tools', 'ops', 'infra', 'env'
        ]],
        'subject-case': [2, 'never', ['upper-case', 'pascal-case']],
        'subject-empty': [2, 'never'],
        'subject-max-length': [2, 'always', 72],
        'body-leading-blank': [2, 'always'],
    }
};
```

- **10개 type** — feat, fix 는 버전 영향 (minor/patch), 나머지는 문서/내부
- **15개 scope** — 경고 레벨 (2=error, 1=warning). 새 모듈 추가 시 warning 발생하면 리스트 업데이트
- **72자 제한** — git log 의 한 줄 표시 가독성

### husky commit-msg 훅

```bash
# .husky/commit-msg
if grep -qiE '^Co-Authored-By:[[:space:]]*Claude' "$1"; then
  echo "✗ commit-msg: 'Co-Authored-By: Claude' 트레일러 금지" >&2
  exit 1
fi

npx --no -- commitlint --edit "$1"
```

두 가지 역할:

1. **AI coauthor 차단** — Claude/GPT 같은 LLM coauthor 트레일러를 로컬 레벨에서 거부 (정책 판단: 책임 소재 명확화 + 외부 검토 시 신뢰)
2. **commitlint 실행** — 포맷 검증 실패 시 커밋 거부

로컬 차단 + CI 재검증의 **이중 방어**.

### template-v* 태그 + 릴리스 자동화

```yaml
# .github/workflows/release.yml
on:
  push:
    tags:
      - 'template-v*'

jobs:
  github-release:
    steps:
      - name: Extract CHANGELOG section
        run: |
          VERSION=${GITHUB_REF#refs/tags/template-v}
          SECTION=$(awk "/^## \\[$VERSION\\]/{flag=1;next}/^## \\[/{flag=0}flag" CHANGELOG.md)
      - uses: softprops/action-gh-release@v3
```

프로세스:

1. 개발자: `CHANGELOG.md` 의 `[Unreleased]` 를 `[0.3.0]` 으로 변경 + 새 `[Unreleased]` 헤더 추가
2. 커밋 + push
3. `git tag template-v0.3.0 && git push --tags`
4. `release.yml` 자동 실행 → CHANGELOG 섹션 추출 → GitHub Release 본문으로 등록

### SemVer 규칙

| 변경 유형 | 버전 영향 | 커밋 type |
|---|---|---|
| Breaking change (API/DB 호환성 깨짐) | major | `feat!:`, `fix!:`, 또는 `BREAKING CHANGE:` 푸터 |
| 새 기능 | minor | `feat:` |
| 버그 수정 | patch | `fix:` |
| 내부 변경 (문서/refactor/test) | 버전 영향 없음 | `docs:`, `refactor:`, `test:` 등 |

### Deprecation 3단계 라이프사이클

Breaking change 는 직접 도입하지 않고 아래 경로로:

```
[Active] ──deprecate──> [Deprecated] ──next major──> [Removed]
 v0.2.0                  v0.3.0 ~ v0.x.y              v1.0.0
```

**필수 4가지 요소**:

1. **Java `@Deprecated` 어노테이션**:
   ```java
   @Deprecated(since = "v0.3.0", forRemoval = true)
   public void oldMethod() { ... }
   ```
2. **Javadoc `@deprecated` 태그** — 대체 방안 명시
3. **CHANGELOG `### Deprecated` 섹션** — 이번 릴리스에서 deprecate 된 것
4. **`docs/features/migration.md`** — 복잡한 이행이 필요한 경우

**ArchUnit r20 이 기계 강제**:
```java
@ArchTest
static final ArchRule r20 = ArchitectureRules.DEPRECATED_MUST_DECLARE_SINCE_AND_FOR_REMOVAL;
```

`@Deprecated` 만 쓰고 `since`, `forRemoval` 속성 빠뜨리면 빌드 실패.

### `.gitmessage` — 커밋 템플릿

```
# <type>(<scope>): <subject>
# |<----  50 chars  ---->|
#
# <body — what and why, not how>
# |<----   72 chars per line   ---->|
#
# <footer — BREAKING CHANGE / Refs / Fixes>

# Type:   feat fix docs style refactor perf test chore build ci
# Scope:  auth user device push billing common bootstrap spec docs core apps
# Subject: imperative mood, lowercase start, no trailing period
```

`git config commit.template .gitmessage` 로 활성화. `git commit` (편집기 모드) 시 이 템플릿이 자동 열림. Commitizen 을 설치하지 않아도 형식 가이드 확보.

### PR / Branch 보호

**PR 템플릿 파일 없음** — 대신 Branch protection 으로 보장:

```
main 브랜치 보호 규칙 (Settings → Branches):
- ☑ Require pull request before merging
- ☑ Require status checks to pass:
  - commit-lint
  - pr-title
  - changelog-check
  - test (CI)
  - archunit
- ☑ Require linear history
- ☑ Automatically delete head branches
```

PR 제목도 Conventional Commits 포맷 강제 (`pr-title.yml` workflow).

### CHANGELOG 형식

```markdown
# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added
- 새 기능 A

### Changed
- 기존 기능 B 개선

### Deprecated
- 구 API C — v1.0.0 에서 제거 예정

## [0.3.0] - 2026-04-15

### Added
- ...
```

**`[Unreleased]` 섹션** — 모든 PR 이 머지 전에 업데이트. `changelog-check.yml` workflow 가 검증.

## 이 선택이 가져온 것

### 긍정적 결과

**cherry-pick 이 기계 쿼리로 작동** — `git log template-v0.3.0..template-v0.4.0 --grep="^feat\\|^fix"` 한 줄로 파생 레포가 받아갈 공통 개선 목록 획득. [ADR-002 (Use this template)](./adr-002-use-this-template.md) 의 전파 모델이 이 ADR 위에서 실제로 작동.

**파생 레포 관리 단순화** — 파생 레포 README 에 "기반: template-v0.3.0" 한 줄이면 끝. 어느 모듈이 어느 버전인지 N개 추적 불필요.

**CHANGELOG 가 릴리스 노트 역할** — 태그 push 시 자동으로 GitHub Release 본문 생성. 수동 릴리스 노트 작성 비용 0.

**Breaking change 가 예측 가능** — `@Deprecated(since, forRemoval)` + ArchUnit r20 강제로 "어느 API 가 언제 사라지나" 가 코드상 명시. 파생 레포가 따라올 시간 확보.

**커밋 히스토리 가독성** — `git log --oneline` 으로 봐도 `feat(auth): add Apple Sign In` 같은 형식이 통일. 한 달 전 커밋도 빠르게 목적 파악.

**AI 협업 트레이서빌리티** — Claude coauthor 트레일러 차단으로 "이 변경의 책임자는 사람" 이 명확. 외부 리뷰 시 신뢰도 유지.

### 부정적 결과

**초기 셋업 비용** — commitlint · husky · workflows · CHANGELOG · tag-validate · release.yml · .gitmessage — 설정할 게 많음. 프로젝트 시작 시 약 4~6시간 투입. 완화: 1회성이며, 템플릿으로 박혀있어 파생 레포는 clone 만으로 상속.

**학습 곡선** — "왜 `feat:` 로 시작해야 하지?" 같은 초기 당혹감. 완화: `.gitmessage` 에 가이드, [Git 워크플로우 (Git Workflow)](../convention/git-workflow.md) 에 FAQ.

**모듈별 세밀 버전의 손실** — "common-web 만 업그레이드" 불가. 완화: 프로젝트 스케일에서 불필요. 필요해지면 본 ADR 재검토.

**Breaking change 가 번거로움** — 바로 고치고 싶어도 Deprecation 3단계 경유 필수. 완화: 의도된 브레이크. "갑작스러운 major bump" 의 비용이 더 큼 — 파생 레포가 "업그레이드 포기" 로 귀결되면 cherry-pick 모델 자체가 붕괴.

### 1 minor 주기 유예의 가치

Deprecation 의 핵심은 "**최소 1 minor 버전 유예**" 예요. 예:

- v0.3.0 에서 `oldMethod()` 를 `@Deprecated(since="v0.3.0", forRemoval=true)` 선언
- v0.4.0 까지는 여전히 작동 (파생 레포 따라오는 시간)
- v1.0.0 에서 제거 (major bump)

파생 레포 관점:

- v0.3.0 upgrade 시 "oldMethod 가 곧 사라진다" 는 경고 확인
- v0.4.0 까지 여유있게 이행
- v1.0.0 upgrade 전에 newMethod 로 이미 교체됐음

**유예 없이 제거하면** 파생 레포가 갑자기 깨져서 upgrade 를 포기하게 됨. 포기가 누적되면 "파생 레포가 template 과 멀어짐" → cherry-pick 모델 붕괴. 유예는 **전파 모델의 생명줄**.

## 교훈

### AI coauthor 트레일러 차단은 실수로 배운 규칙

초기에는 `Co-Authored-By: Claude` 트레일러를 자유롭게 썼음. 외부 감사/리뷰 시점에 문제 인식:

- **책임 소재 불명확** — 코드 문제 발생 시 "Claude 가 쓴 줄이라" 같은 책임 회피 여지
- **감사 추적 노이즈** — 실제 기여한 사람 vs AI 도구 사용이 혼재
- **법적/라이선스 모호성** — AI 생성 코드의 저작권 판례가 아직 불안정

해결: husky commit-msg hook 에 `Co-Authored-By: Claude` 트레일러를 거부하는 grep 추가. 실수로라도 들어가면 커밋이 막힘.

**교훈**: AI 도구 사용은 **사람의 판단 + 검토** 를 전제로만 정당화됨. 트레일러로 AI 를 공동 저자로 표기하는 건 이 전제를 흐림. 정책을 husky 로 기계 강제.

(docs-viewer 레포는 예외 — husky 없음. 별도 정책.)

### Scope 리스트는 초기엔 warning, 점차 error 로

처음엔 scope-enum 을 `[2, ...]` (error) 로 설정했어요. 그런데 새 모듈 (`common-notification`, `core-billing`) 추가할 때 commitlint 가 즉시 거부 → 커밋 불가 → scope 리스트 업데이트 → 재시도 반복.

[1, ...] (warning) 로 낮춤. 변경 결과:

- 새 scope 사용 시 경고만 발생, 커밋은 통과
- 경고를 본 개발자가 나중에 scope 리스트 업데이트
- 실질적 거부는 CI 에서 일관성 체크

**교훈**: 강제 규칙이 개발 흐름을 막을 때는 **warning 수준** 으로 낮추고, **CI/리뷰 시점에 체크** 로 이동. "개발 flow 를 막는 규칙" 은 결국 우회당함.

### 템플릿 태그는 `template-v` prefix 필수

다른 프로젝트 관습: `v1.2.3` 형태. 우리는 `template-v1.2.3` 을 쓰는 이유:

- 파생 레포가 같은 Git 히스토리 상에 자기 태그 (`prod-20260401`, `v1.0.0-sumtally`) 를 가짐
- 태그가 섞이면 `git tag --list` 가 혼돈
- `git tag --list 'template-v*'` 으로 **템플릿 릴리스만 필터** 가능

파생 레포로 cherry-pick 해도 템플릿 태그는 건너뛰므로 (태그는 커밋에 속하지만 prefix 차이로 구분) 섞이지 않음.

**교훈**: 태그 이름 규칙은 단순해 보이지만, **여러 레포 워크플로우** 에서 크리티컬. prefix 가 prefix 인 이유는 "레포들 간 충돌 없이 공존" 때문.

### Deprecation ArchUnit 규칙이 문화 유지

ArchUnit r20 (`DEPRECATED_MUST_DECLARE_SINCE_AND_FOR_REMOVAL`) 없으면 `@Deprecated` 어노테이션만 대충 붙이고 since/forRemoval 생략 — 파생 레포는 "언제 사라지는지" 모름.

r20 이 빌드 실패로 강제하므로:
- `@Deprecated` 를 찍는 순간부터 since/forRemoval 필수
- 파생 레포가 `IDE inspection` 으로 "언제까지 이 API 쓸 수 있지" 확인 가능

**교훈**: 규약 (Deprecation 3단계) 은 기계 강제가 없으면 시간이 지나면서 느슨해짐. **문화는 도구로 받쳐야** 지속됨.

## 관련 사례 (Prior Art)

- **[Conventional Commits 1.0.0](https://www.conventionalcommits.org/)** — 커밋 메시지 스펙. 본 ADR 의 기반.
- **[Keep a Changelog 1.1.0](https://keepachangelog.com/)** — CHANGELOG 포맷. Added / Changed / Deprecated / Removed / Fixed / Security 6 섹션.
- **[Semantic Versioning 2.0.0](https://semver.org/)** — SemVer 스펙. major/minor/patch 의 공식 정의.
- **[commitlint](https://commitlint.js.org/)** — Conventional Commits 강제 도구. 본 ADR 의 핵심 의존.
- **[husky](https://typicode.github.io/husky/)** — Git hooks 관리. commit-msg 훅 통해 로컬 검증.
- **[semantic-release](https://semantic-release.gitbook.io/semantic-release/)** — Option 2 (커밋당 자동 tag) 의 대표 도구. 본 ADR 에서 채택 안 함.
- **[JDK Deprecation Policy](https://openjdk.org/jeps/277)** — `@Deprecated(since, forRemoval)` 의 Java 표준 정의. 본 ADR 의 r20 은 이를 기계 강제.

## Code References

**commitlint / 커밋 검증**:
- [`commitlint.config.mjs`](https://github.com/storkspear/spring-backend-template/blob/main/commitlint.config.mjs) — 10 type + 15 scope + 72자 제한
- [`.husky/commit-msg`](https://github.com/storkspear/spring-backend-template/blob/main/.husky/commit-msg) — AI coauthor 차단 + commitlint 실행
- [`package.json`](https://github.com/storkspear/spring-backend-template/blob/main/package.json) — commitlint 19 · husky 9 · commitizen 4.3

**CI 검증 워크플로**:
- [`.github/workflows/commit-lint.yml`](https://github.com/storkspear/spring-backend-template/blob/main/.github/workflows/commit-lint.yml) — PR 커밋 포맷 재검증
- [`.github/workflows/pr-title.yml`](https://github.com/storkspear/spring-backend-template/blob/main/.github/workflows/pr-title.yml) — PR 제목 포맷
- [`.github/workflows/changelog-check.yml`](https://github.com/storkspear/spring-backend-template/blob/main/.github/workflows/changelog-check.yml) — CHANGELOG 업데이트 여부
- [`.github/workflows/release.yml`](https://github.com/storkspear/spring-backend-template/blob/main/.github/workflows/release.yml) — tag → GitHub Release 자동 생성

**CHANGELOG / 버저닝**:
- [`CHANGELOG.md`](https://github.com/storkspear/spring-backend-template/blob/main/CHANGELOG.md) — Keep a Changelog 포맷, [Unreleased] 유지
- [버전 규약 & Deprecation 프로세스](../api-and-functional/api/versioning.md) — template-v* 태그 + Deprecation 상세
- [Git 워크플로우 (Git Workflow)](../convention/git-workflow.md) — 브랜치 + 커밋 규칙 통합 가이드

**Deprecation 강제**:
- [`common-testing/architecture/ArchitectureRules.java`](https://github.com/storkspear/spring-backend-template/blob/main/common/common-testing/src/main/java/com/factory/common/testing/architecture/ArchitectureRules.java) — r20 규칙 정의
- [`bootstrap/test/BootstrapArchitectureTest.java`](https://github.com/storkspear/spring-backend-template/blob/main/bootstrap/src/test/java/com/factory/bootstrap/BootstrapArchitectureTest.java) — r20 ArchTest 바인딩

**개발자 편의**:
- [`.gitmessage`](https://github.com/storkspear/spring-backend-template/blob/main/.gitmessage) — 커밋 템플릿 (Commitizen 없이도 가이드)

**관련 ADR**:
- [ADR-002 · Use this template](./adr-002-use-this-template.md) — 본 ADR 이 해결하는 근본 문제 (파생 레포 cherry-pick)
- [ADR-004 · Gradle + ArchUnit](./adr-004-gradle-archunit.md) — r20 이 같은 체계에 속함
- [ADR-007 · 솔로 친화적 운영](./adr-007-solo-friendly-operations.md) — "초기 투자 vs 미래 부담 감소" 트레이드오프 원칙
