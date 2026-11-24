# Migration Guides

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~2분

**설계 근거**: [`ADR-015 · Conventional Commits + SemVer`](../../philosophy/adr-015-conventional-commits-semver.md)

이 문서는 템플릿 버전 변경을 파생 레포에 반영하는 가이드의 작성 기준을 정해요. 코드·API 호환성이 바뀔 때 무엇을 어떻게 옮기는지 설명하는 자리예요. DB 스키마 변경 절차는 [`Flyway 런북`](../../production/deploy/flyway-runbook.md)에서 확인해요.

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

````markdown
# Migration Guide: v1.9.0 → v2.0.0

## Overview
v2.0.0에서 제거한 API와 대체 사용법을 정리해요.

## 1. ModulePort.oldMethodName → newMethodName

### Before (v1.9.0)
```java
modulePort.oldMethodName(new RequestType(arg));
```

### After (v2.0.0)
```java
modulePort.newMethodName(new RequestType(arg));
```

### Reason
이름을 바꾼 이유와 두 메서드의 동작 차이가 있는지 설명해요.

### Migration Steps
1. 기존 호출을 찾아 새 API로 옮겨요.
2. 입력·출력·예외 계약과 테스트 결과를 확인해요.

### Deprecation 정책
- v1.8.0에서 `@Deprecated(since = "1.8.0", forRemoval = true)`로 표시했어요.
- v1.9.0까지 기존 API를 유지하고 v2.0.0에서 제거해요.
````

---

## Deprecation 흐름과의 관계

호환성을 유지하며 API를 옮기려면 새 API를 먼저 추가하고 기존 API를 deprecated로 표시해요. 이후 minor 버전에서 두 API를 함께 유지한 뒤, 정해진 다음 major에서 기존 API를 제거해요. 파생 레포는 이 기간에 호출부를 옮기고 계약 테스트로 동작을 확인해요.

```text
v1.8.0  신규 API 추가 + 기존 API @Deprecated
v1.9.0  기존 API 유지, deprecated 경고
v2.0.0  기존 API 제거 → migration guide 필요
```

가이드의 Before에는 제거될 API의 사용법을, After에는 대체 API의 사용법을 적어요. deprecation 표시와 제거 시점, CHANGELOG 기록 기준은 [버전 규약](../api/versioning.md)에서 관리해요.

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

루트 `CHANGELOG.md`는 2026-07-21에 `template-v1.0.0`으로 버전 기준을 정리한 기록을 담고 있어요. 적용할 버전과 변경 내용은 해당 태그·CHANGELOG를 확인해요. 이 문서에 최신 버전 번호를 별도로 반복해 관리하지 않아요.

---

## 관련 문서

- [`버전 규약 · Deprecation 프로세스`](../api/versioning.md) — SemVer 규약 · deprecation 마킹 · removal 시점
- [`크로스 레포 Cherry-pick 가이드`](../../start/cross-repo-cherry-pick.md) — 파생 레포 코드 동기화
- [`ADR-015 · Conventional Commits + SemVer`](../../philosophy/adr-015-conventional-commits-semver.md) — 커밋·태그 체계의 설계 근거
- `CHANGELOG.md` (레포 루트) — 버전별 전체 변경 이력
