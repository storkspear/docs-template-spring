# Migration Guides

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~2분

**설계 근거**: [ADR-015 (Conventional Commits + SemVer)](../../philosophy/adr-015-conventional-commits-semver.md)

이 디렉토리는 **breaking change 가 있는 템플릿 버전마다** 해당 버전으로 이행하는 단계별 가이드를 담습니다.

---

## 개요

**Breaking change 가 있는 템플릿 버전** 의 이행 가이드 작성 규칙 + Deprecation 흐름과의 관계 + 파생 레포 업그레이드 사용법.

---

## 작성 기준

### 언제 작성하는가

- **Major 버전 (X.0.0)** — 항상 작성. Breaking change 모음.
- **Minor 버전 (0.Y.0)** — breaking 없으면 불필요. CHANGELOG 만으로 충분.
- **Patch 버전 (0.0.Z)** — 불필요.

### 파일 이름

- `v<major>.<minor>.<patch>.md` — 해당 버전으로 이행하는 가이드

### 내용 구조

```markdown
# Migration Guide: v0.2.0 → v0.3.0

## Overview
v0.3.0 에서 도입된 breaking change 3 건 요약.

## 1. UserPort.verifyEmailLegacy → verifyEmail

### Before (v0.2.0)
```java
authPort.verifyEmailLegacy(new VerifyEmailRequest(token));
```

### After (v0.3.0)
```java
authPort.verifyEmail(new VerifyEmailRequest(token));
```

### Reason
네이밍 일관성 (기존 인증/재인증 메서드와 정렬).

### Migration Steps
1. 전역 search/replace: `verifyEmailLegacy` → `verifyEmail`
2. 테스트 실행해 이상 없는지 확인

### Deprecation 정책
- v0.3.0 에서 `@Deprecated(since = "v0.3.0", forRemoval = true)` 로 마킹
- v1.0.0 에서 제거

## 2. ...
```

---

## Deprecation 흐름과의 관계

breaking change 는 갑자기 나타나지 않음. 다음 흐름:

```
v0.2.0: 신규 API 추가 + 기존 API @Deprecated
v0.3.0: 기존 API 여전히 작동 (deprecated 경고)
v0.4.0: 기존 API 여전히 작동 (deprecated 경고)
v1.0.0: 기존 API 제거 → breaking — Migration Guide 필수
```

Migration Guide 의 "Before" 는 deprecated 된 사용법, "After" 는 신규 사용법.

---

## 파생 레포에서 사용

파생 레포가 업그레이드 시:
1. 자기 "Based on" 버전 확인
2. 업그레이드 대상 버전의 Migration Guide 읽기
3. 단계별로 따라 하며 코드 수정
4. 테스트 통과 확인
5. "Based on" 업데이트

---

## 현재 상태

**Phase 0 완료 시점**: `template-v0.1.0` (초기 릴리스)
- Breaking 없음 (이전 버전 없음)
- Migration Guide 불필요

---

## 관련 문서

- [버전 규약 & Deprecation 프로세스](../api/versioning.md) — semver 규약 · Deprecation 프로세스
- [크로스 레포 Cherry-pick 가이드](../../start/cross-repo-cherry-pick.md) — 파생 레포 동기화
- `CHANGELOG.md` — 버전별 전체 변경 이력 (레포 루트)
