# Coding Conventions

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~3분

이 디렉토리는 `template-spring` 과 이를 파생한 모든 레포의 코딩 규약을 모아 둔 인덱스예요. 네이밍, 예외 처리, DTO 패턴, git 워크플로우처럼 실무 코드에 직접 적용되는 규칙을 다루고, 각 규칙의 상세 문서로 안내해요.

규약은 취향이 아니라 일관성을 위한 계약입니다. 혼자 작업하더라도 6개월 뒤의 내가 과거 코드를 이해할 수 있어야 하고, 파생 레포가 여러 개로 늘어나면 각 레포의 코드 스타일이 비슷해야 [cherry-pick](../reference/glossary.md#개발-프로세스) 전파가 매끄러워요.

---

## 개요

순수한 코드 작성 규약만 이 디렉토리에 모여 있어요. 시스템 구조, API 계약, 기능 가이드, 테스팅처럼 성격이 다른 문서는 별도 폴더에서 관리하고, 그 위치는 [같은 성격의 인접 그룹](#같은-성격의-인접-그룹) 에 정리해 뒀어요.

---

## 이 폴더의 문서 (순수 코드 작성 규약)

- [`Design Principles`](./design-principles.md) — SOLID, DRY, YAGNI, 포트·어댑터, 의존 방향
- [`Naming Conventions`](./naming.md) — 패키지, 클래스, 메서드, DB 네이밍 규칙
- [`record vs class 선택 기준`](./records-and-classes.md) — record 와 class 를 가르는 결정 기준
- [`DTO 팩토리 컨벤션`](./dto-factory.md) — DTO 팩토리 패턴(from·of·with) 과 Entity 의 `to<Dto>()` 패턴
- [`Exception Handling Convention`](./exception-handling.md) — 예외 계층, ErrorCode enum, HTTP 매핑
- [`Git 워크플로우`](./git-workflow.md) — 브랜치, 커밋 규약, Merge 전략, Conventional Commits
- [`Code Comments Convention`](./code-comments.md) — Javadoc 과 인라인 주석 규약(적는다·안 적는다·형식·우선순위)
- [`Dynamic Query 컨벤션`](./dynamic-query.md) — RequestDTO → Assembler → conditions Map → JPAQuery 표준 패턴

---

## 같은 성격의 인접 그룹

구조 재편으로 코드 작성 규약과 성격이 다른 문서들은 각자 별도 폴더에서 관리합니다. 자주 함께 보는 그룹은 다음과 같아요.

- **시스템 구조** → [`structure/`](../structure/) — [`Module Dependencies`](../structure/module-dependencies.md), [`Architecture Rules (ArchUnit)`](../structure/architecture-rules.md), [`Multi-tenant`](../structure/multitenant-architecture.md), [`JWT Authentication`](../structure/jwt-authentication.md)
- **API 계약** → [`api-and-functional/api/`](../api-and-functional/api/) — [`API Response`](../api-and-functional/api/api-response.md), [`JSON Contract`](../api-and-functional/api/json-contract.md), [`Versioning`](../api-and-functional/api/versioning.md), [`Flutter 연동`](../api-and-functional/api/flutter-backend-integration.md)
- **기능 가이드** → [`api-and-functional/functional/`](../api-and-functional/functional/) — Push, Email, Observability, Rate Limiting, Storage, Migration, Seed Data 등
- **테스팅** → [`production/test/`](../production/test/) — [`Contract Testing`](../production/test/contract-testing.md), [`Testing Strategy`](../production/test/testing-strategy.md)

---

## 규약의 우선순위

서로 충돌하는 것처럼 보이는 규약이 있을 때 다음 순서로 해결해요.

1. **동작하는 코드** 가 이상적인 규약보다 우선이에요. 규약을 지키려다 테스트가 실패하거나 런타임 동작이 깨지면 규약이 틀린 거예요.
2. **이 문서에 명시된 규약** 이 개인 취향보다 우선합니다.
3. **프로젝트 내 기존 패턴** 이 새 패턴보다 우선해요. 기존 코드와 일관되게 따라가고, 필요하면 문서를 먼저 업데이트한 뒤 일괄 리팩토링합니다.
4. **SOLID·DRY·YAGNI** 같은 원칙은 참조점이지 절대 기준이 아니에요. 상황에 맞게 적용합니다.

---

## 규약을 지키는 방법

자동화가 1순위예요. 가능한 한 IDE, 빌드, CI 가 규약을 강제하도록 만듭니다.

- **Gradle 빌드** — 모듈 의존 관계를 강제합니다.
- **ArchUnit 테스트** — 패키지 구조와 네이밍을 강제합니다. 전체 22개 규칙 r1~r22(r12 는 예약 번호라 활성 규칙은 21개)의 목록은 [`Architecture Rules (ArchUnit)`](../structure/architecture-rules.md) 에 있어요.
- **spotless** — google-java-format(4-space)을 커밋 전에 적용합니다.
- **commitlint + husky** — 커밋 메시지를 Conventional Commits 형식으로 강제합니다.

사람의 의지로 지키는 규약은 2~3주 안에 무너져요. 기계가 막아 주도록 만드는 것이 유일하게 지속 가능한 방법이에요.

---

## 모듈 README 유지 규칙

모듈 디렉토리에는 `README.md` 를 둡니다. 현재는 `common/*` 전부, `bootstrap`, 그리고 core 도메인 일부(auth·user·device·billing·push·storage 의 api/impl)에 있고, 나머지 core 모듈은 아직 없어요. README 가 있는 모듈의 코드를 변경할 때 다음 중 하나라도 해당되면 **같은 커밋에서** 그 모듈의 `README.md` 를 함께 업데이트해요.

1. **새 public 클래스를 추가**했을 때 → "제공 기능" 섹션에 추가
2. **기존 클래스를 삭제하거나 이름을 바꿨을 때** → README 에서 제거·수정
3. **의존 모듈이 바뀌었을 때**(build.gradle 변경) → "의존" 섹션 업데이트
4. **주요 설계 결정이 바뀌었을 때** → "주의" 섹션 업데이트
5. **환경변수나 설정이 추가·변경**됐을 때 → 해당 섹션 업데이트

별도 "docs 업데이트" 커밋으로 분리하지 않고 코드 변경과 같은 커밋에 포함합니다. 이렇게 해야 코드와 문서가 어긋나지 않아요.

---

## 기여

규약은 고정되어 있지 않습니다. 개선 의견이 있으면 해당 문서에 직접 수정을 제안하고, 기존 규약이 실제 코드 작성에서 걸림돌이 되면 즉시 재평가해요. 다만 **"이 결정의 이유가 여전히 유효한가"** 를 먼저 확인한 뒤에 바꿉니다.

---

## 관련 문서

- [`Documentation Style Guide`](../reference/STYLE_GUIDE.md) — 문서 작성 규칙(코드 규약의 문서 버전)
- [`Architecture Reference`](../structure/architecture.md) — 모듈 구조, 의존 그래프, Extraction 6 레이어
- [`ADR-016 · DTO 변환은 Entity 메서드로 (Mapper 클래스 금지)`](../philosophy/adr-016-dto-mapper-forbidden.md) — Mapper 금지 설계 근거
- [`ADR-015 · Conventional Commits + 템플릿 전체 semver`](../philosophy/adr-015-conventional-commits-semver.md) — 커밋 규약 설계 근거
- [`Architecture Rules (ArchUnit)`](../structure/architecture-rules.md) — ArchUnit 이 기계로 강제하는 규약 목록
