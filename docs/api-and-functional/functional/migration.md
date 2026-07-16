# Migration Guides

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~2분

**설계 근거**: [`ADR-015 · Conventional Commits + SemVer`](../../philosophy/adr-015-conventional-commits-semver.md)

이 디렉토리는 breaking change 가 있는 템플릿 버전마다, 그 버전으로 옮겨 가는 단계별 가이드를 담습니다. 파생 레포가 새 버전을 따라잡을 때 "어디가 깨지고, 무엇을 어떻게 고쳐야 하는지" 를 한 파일에서 확인하는 자리예요.

---

## 개요

이 문서가 정하는 것은 세 가지입니다. 언제 migration guide 를 쓰는가, deprecation 흐름과 어떻게 맞물리는가, 파생 레포가 그 가이드를 어떻게 따라가는가. 모두 [`template-v* 태그`](../../reference/glossary.md#이-레포-고유-용어) 단위 SemVer 를 전제로 동작합니다.

---

## 작성 기준

migration guide 는 모든 버전마다 쓰지 않아요. breaking change 가 있을 때만 작성합니다.

| 버전 종류 | 작성 여부 | 근거 |
|---|---|---|
| Major (X.0.0) | 항상 작성 | breaking change 모음이라 이행 절차가 반드시 필요 |
| Minor (0.Y.0) | breaking 없으면 생략 | 기능 추가만이면 CHANGELOG 로 충분 |
| Patch (0.0.Z) | 생략 | 버그 수정이라 호환 깨짐 없음 |

파일 이름은 그 버전으로 이행하는 가이드라는 뜻으로 `v<major>.<minor>.<patch>.md` 를 씁니다.

### 내용 구조

한 변경마다 Before / After / Reason / Migration Steps / Deprecation 정책을 한 묶음으로 둬요. 코드 스니펫은 실제로 깨지는 호출 한 줄이면 충분합니다.

```markdown
# Migration Guide: v0.2.0 → v0.3.0

## Overview
v0.3.0 에서 도입된 breaking change 요약.

## 1. ModulePort.oldMethodName → newMethodName

### Before (v0.2.0)
```java
modulePort.oldMethodName(new RequestType(arg));
```text

### After (v0.3.0)
```java
modulePort.newMethodName(new RequestType(arg));
```text

### Reason
실제 deprecation 사유 (네이밍 일관성·도메인 분리·API 단순화 등).

### Migration Steps
1. 전역 search/replace: `oldMethodName` → `newMethodName`
2. 테스트 실행해 이상 없는지 확인

### Deprecation 정책
- v0.3.0 에서 `@Deprecated(since = "v0.3.0", forRemoval = true)` 로 마킹
- v1.0.0 에서 제거
```

---

## Deprecation 흐름과의 관계

breaking change 는 갑자기 나타나지 않아요. 신규 API 를 먼저 추가하고, 기존 API 를 deprecated 로 마킹한 뒤, 여러 minor 주기 동안 둘 다 동작시키다가, 다음 major 에서야 기존 API 를 제거합니다. 이 단계적 흐름 덕에 파생 레포는 한 번에 깨지지 않고 천천히 따라올 시간을 법니다.

```text
v0.2.0  신규 API 추가 + 기존 API @Deprecated
v0.3.0  기존 API 여전히 동작 (deprecated 경고)
v0.4.0  기존 API 여전히 동작 (deprecated 경고)
v1.0.0  기존 API 제거 → breaking — migration guide 필수
```

그래서 migration guide 의 "Before" 는 deprecated 된 옛 사용법, "After" 는 신규 사용법이 됩니다. deprecation 마킹·removal 시점·CHANGELOG 기록 규칙의 전체 정의는 [`버전 규약 · Deprecation 프로세스`](../api/versioning.md) 에 있어요.

---

## 파생 레포에서 사용

파생 레포가 새 버전을 따라잡을 때는 자기 기준점부터 확인하고 한 단계씩 올라갑니다.

1. 자기 "Based on" 버전을 확인합니다.
2. 올릴 대상 버전의 migration guide 를 읽어요.
3. Before → After 를 따라 코드를 수정합니다.
4. 테스트 통과를 확인해요.
5. "Based on" 을 새 버전으로 갱신합니다.

코드 자체를 동기화하는 cherry-pick 절차는 [`크로스 레포 Cherry-pick 가이드`](../../start/cross-repo-cherry-pick.md) 가 따로 다뤄요.

---

## 현재 상태

최신 릴리스는 `template-v0.3.0` 입니다 (git tag 기준, 2026-07). 지금까지의 릴리스에는 migration guide 를 요구하는 breaking change 가 없어 아직 작성된 가이드는 없어요. 첫 breaking 변경이 나오는 버전부터 `v<...>.md` 파일이 이 디렉토리에 쌓입니다.

---

## 관련 문서

- [`버전 규약 · Deprecation 프로세스`](../api/versioning.md) — SemVer 규약 · deprecation 마킹 · removal 시점
- [`크로스 레포 Cherry-pick 가이드`](../../start/cross-repo-cherry-pick.md) — 파생 레포 코드 동기화
- [`ADR-015 · Conventional Commits + SemVer`](../../philosophy/adr-015-conventional-commits-semver.md) — 커밋·태그 체계의 설계 근거
- `CHANGELOG.md` (레포 루트) — 버전별 전체 변경 이력
