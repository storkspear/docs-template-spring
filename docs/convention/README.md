# Coding Conventions

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~3분

이 디렉토리는 `spring-backend-template` 및 이를 파생한 모든 레포의 **코딩 규약** 을 담습니다.

규약은 취향이 아니라 **일관성을 위한 계약** 입니다. 혼자 작업하더라도, 6개월 뒤의 나 자신이 과거 코드를 이해할 수 있어야 합니다. 그리고 파생 레포가 여러 개 생겼을 때 각 레포의 코드 스타일이 비슷해야 cherry-pick backport 가 매끄럽습니다.

---

## 개요

이 디렉토리는 `spring-backend-template` 및 파생 레포의 **코드 작성 규약** 을 모읍니다. 네이밍 · 예외 처리 · DTO 패턴 · git workflow 등 실무 코드에 직접 적용되는 규칙들.

---

## 이 폴더의 문서 (순수 코드 작성 규약)

- [`Design Principles`](./design-principles.md) — SOLID · DRY · YAGNI · 포트/어댑터 · 의존 방향
- [`Naming Conventions`](./naming.md) — 패키지/클래스/메서드/DB 네이밍 규칙
- [`record vs class 선택 기준`](./records-and-classes.md) — record vs class 결정 기준
- [`DTO 팩토리 컨벤션`](./dto-factory.md) — DTO 팩토리 패턴 (from/of/with) · Entity `to<Dto>()` 패턴
- [`Exception Handling Convention`](./exception-handling.md) — 예외 계층 · ErrorCode enum · HTTP 매핑
- [`Git 워크플로우 (Git Workflow)`](./git-workflow.md) — 브랜치 · 커밋 규약 · Merge 전략 · Conventional Commits

---

## 같은 성격의 인접 그룹

구조 재편으로 **코드 작성 규약** 과 다른 성격의 문서들은 별도 폴더에서 관리합니다.

- 시스템 구조 → [`architecture/`](../architecture/) — Module Dependencies · Architecture Rules (ArchUnit) · Multitenant · JWT
- API 계약 → [`api-contract/`](../api-contract/) — API Response · JSON Contract · Versioning · Flutter Integration
- 기능 가이드 → [`features/`](../features/) — Push · Email · Observability · Rate Limiting · Storage · Migration · Seed Data
- 테스팅 → [`testing/`](../testing/) — Contract Testing · Testing Strategy

---

## 규약의 우선순위

서로 충돌하는 것처럼 보이는 규약이 있을 때 다음 순서로 해결합니다.

1. **동작하는 코드** 가 이상적인 규약보다 우선입니다. 규약을 지키기 위해 테스트가 실패하거나 런타임 동작이 깨지면 규약이 틀린 것입니다.
2. **이 문서에 명시된 규약** 이 개인 취향보다 우선합니다.
3. **프로젝트 내 기존 패턴** 이 새 패턴보다 우선입니다. 기존 코드와 일관성 있게 따라가고, 필요하면 문서를 업데이트한 후 일괄 리팩토링합니다.
4. **SOLID/DRY/YAGNI** 같은 원칙은 참조점이지 절대 기준이 아닙니다. 상황에 맞게 적용합니다.

---

## 규약을 지키는 방법

**자동화가 1순위입니다.** 가능한 한 IDE, 빌드, CI 가 규약을 강제하도록 만듭니다.

- **Gradle 빌드** — 모듈 의존 관계 강제
- **ArchUnit 테스트** — 패키지 구조 및 네이밍 강제 (전체 22개 규칙: [`Architecture Rules (ArchUnit)`](../structure/architecture-rules.md))
- **checkstyle / spotless** — 포맷팅 강제 (Phase 1+ 도입 예정)
- **pre-commit hook** — 커밋 메시지 형식 검증 (선택)

사람의 의지로 지키는 규약은 2~3주 안에 무너집니다. 기계가 막아주도록 만드는 것이 유일한 지속 가능한 방법입니다.

---

## 모듈 README 유지 규칙

각 모듈 디렉토리(`common/*`, `core/*`, `bootstrap`, `apps/*`)에는 `README.md` 가 있습니다. 코드를 변경할 때 다음 중 하나라도 해당되면 **같은 커밋에서** 해당 모듈의 `README.md` 를 함께 업데이트합니다.

1. **새 public 클래스를 추가**했을 때 → "제공 기능" 섹션에 추가
2. **기존 클래스를 삭제/이름 변경**했을 때 → README 에서 제거/수정
3. **의존 모듈이 바뀌었을 때** (build.gradle 변경) → "의존" 섹션 업데이트
4. **주요 설계 결정이 바뀌었을 때** → "주의" 섹션 업데이트
5. **환경변수/설정이 추가/변경**됐을 때 → 해당 섹션 업데이트

별도 "docs 업데이트" 커밋으로 분리하지 않고, 코드 변경과 같은 커밋에 포함합니다. 이렇게 해야 코드와 문서가 어긋나지 않습니다.

---

## 기여

규약은 고정되어 있지 않습니다. 개선 의견이 있으면 해당 문서에 직접 수정을 제안하거나, 기존 규약이 실제 코드 작성에서 걸림돌이 되면 즉시 재평가합니다. 다만 **"이 결정의 이유가 여전히 유효한가"** 를 먼저 확인한 후 바꿉니다.

---

## 관련 문서

- [`Documentation Style Guide`](../reference/STYLE_GUIDE.md) — 문서 작성 규칙 (코드 규약의 문서 버전)
- [`ADR-016 · DTO 변환은 Entity 메서드로 (Mapper 클래스 금지)`](../philosophy/adr-016-dto-mapper-forbidden.md) — Mapper 금지 설계 근거
- [`ADR-015 · Conventional Commits + 템플릿 전체 semver`](../philosophy/adr-015-conventional-commits-semver.md) — 커밋 규약 설계 근거
- [`Architecture Rules (ArchUnit)`](../structure/architecture-rules.md) — ArchUnit 이 기계 강제하는 규약 목록
