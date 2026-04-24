# Documentation Style Guide

이 문서는 **어떻게 문서를 쓸 것인가** 의 규칙을 모읍니다. 추상 원칙이 아니라 **`journey/philosophy/` 의 16 개 ADR 파일럿에서 귀납적으로 추출된 규칙** 입니다. 각 규칙마다 구체 샘플 링크가 있어야 하며, 샘플 없는 규칙은 근거가 약합니다.

> **이 문서의 위상**: `docs/` 안의 모든 문서가 참조하는 메타 문서. 새 문서 쓸 때 이 가이드를 따르고, 예외가 필요하면 "왜 이 경우에 예외인가" 를 본 문서에 추가.

---

## 1. 독자 페르소나 — Level 0~3

모든 문서는 **어느 레벨의 독자를 대상으로 쓰는지** 를 명시적으로 결정해야 합니다.

| Level | 누구 | 배경 지식 | 예시 문서 타겟 |
|---|---|---|---|
| **Level 0** | 처음 코드를 짜보는 사람 | 프로그래밍 기초만 | "프로젝트 소개", "첫 앱 실행" (아직 미작성) |
| **Level 1** | 주니어 백엔드 개발자 | Spring Boot 튜토리얼 수준 | `journey/onboarding.md`, `reference/app-scaffolding.md` |
| **Level 2** | Spring 실무 중급 | 2+년 현업, 운영 경험 | `journey/architecture.md`, 대부분의 `conventions/*.md` |
| **Level 3** | 시스템 설계 관심자 | 여러 언어/스택 경험, 트레이드오프 사고 | `journey/philosophy/*.md` 전체 |

### 레벨별 톤 규칙

**Level 0~1** — 비유 · 예시 · 단계별 안내 위주:
- 긴 개념 설명 전에 "이게 뭐에 쓰이는가" 먼저
- 코드 스니펫은 **전체 맥락** 을 담아서 (import 포함)
- 실행 명령은 그대로 복붙 가능한 형태

**Level 2** — 의사결정 맥락 + 구체 구현:
- "왜" 와 "어떻게" 를 같이 다룸
- 코드 스니펫은 **핵심만 발췌** 가능 (import 생략 허용)
- 업계 표준과의 비교 자연스럽게

**Level 3** — 트레이드오프 · 대안 검토 · 장기 결과:
- "왜" 중심, "어떻게" 는 Code References 링크로 위임
- 여러 대안을 병렬 비교 (Option 1/2/3 구조)
- 미래 부작용 · 이행 경로까지 기록

### 샘플

- Level 3 예시: [`ADR-005 · 단일 Postgres database + 앱당 schema`](../philosophy/adr-005-db-schema-isolation.md) — 대안 3개 비교 + 5중 방어선 · 미래 이전 경로
- Level 2 예시: [`Design Principles`](../convention/design-principles.md) — SOLID 설명 + 코드 샘플
- Level 1 예시: [App Scaffolding (`new-app.sh`)](../start/app-scaffolding.md) — 단계별 명령 + 트러블슈팅

---

## 2. 문서 유형 5 종 + 공통 메타블록

모든 문서에 **ADR 규격을 강제하지 않습니다**. ADR 은 "결정의 근거" 를 담는 특수 형식이고, 다른 성격의 문서 (참조표 · 절차서 · 설명글 · 운영 런북) 는 각자에 맞는 규격이 따로 있습니다.

### 2.0 공통 메타블록 (전 문서 공통)

h1 바로 아래에 **한 줄 블록** 필수:

```markdown
# {문서 제목}

> **유형**: {ADR | Reference | How-to | Explanation | Runbook} · **독자**: Level {0~3} · **읽는 시간**: {N분}
```

독자가 클릭하자마자 "이건 어떤 성격의 문서인가" 를 즉시 인지하게 함. 유형별 규격 차이가 **혼란이 아니라 목적에 맞는 구조** 로 받아들여짐.

### 2.A — ADR (Architecture Decision Record)

**대상**: `journey/philosophy/` 의 설계 결정 카드. 16 파일.
**독자**: Level 3 (시스템 설계 관심자).
**핵심 가치**: "왜 이 선택을 했는가 + 대안 대비 근거 + 장기 결과".

`journey/philosophy/` 의 16 ADR 은 아래 **8 개 필수 섹션** + 선택 섹션으로 구성. 새 설계 결정을 ADR 로 기록할 때 그대로 따름.

### 필수 섹션 순서 (h2)

1. **결론부터** — 30초 안에 핵심 잡기. 4~6 줄.
2. **왜 이런 고민이 시작됐나?** — 문제 맥락. 마지막에 `> 이 결정이 답할 물음은 이거예요` 블록으로 물음 명확화.
3. **고민했던 대안들** — 최소 2~3 개. 각 대안은 `### Option N — 제목` 서브섹션. 채택안은 `★ (채택)` 표시.
4. **결정** — 실제 채택된 구현. 구조도/코드 스니펫/하위 결정 포함.
5. **이 선택이 가져온 것** — `### 긍정적 결과`, `### 부정적 결과` 서브섹션 필수. 정직하게.
6. **교훈** — 3~4 개 정도. 각 교훈은 `### 교훈 제목` 서브섹션 + 구체 일화 + `**교훈**:` 한 줄 요약.
7. **관련 사례 (Prior Art)** — 업계 레퍼런스 5~7 개 외부 링크.
8. **Code References** — 실제 파일/라인 링크. GitHub raw URL 사용.

### 파일 헤더 (h1 + Status 줄)

```markdown
# ADR-NNN · 제목 한 줄

**Status**: Accepted/Deprecated/Superseded. YYYY-MM-DD 기준 현황 한 줄.
```

- h1 제목 포맷: `ADR-NNN · 제목` (중점 ` · ` 구분자)
- Status 줄은 **파일 상단 고정**. 날짜 · 현재 유효성 · 주요 구현 위치 한 줄 언급.

### 선택 섹션

- `## 비목표` — 명시적 거절이 중요할 때 ([`adr-007`](../philosophy/adr-007-solo-friendly-operations.md) 참조)
- 결정 안의 `### 설계 선택 포인트` — 여러 하위 결정이 있을 때 ([`adr-009`](../philosophy/adr-009-base-entity.md) 의 포인트 1~5)

### 샘플

- 전체 구조 모범: [`ADR-009 · BaseEntity 공통 슈퍼클래스`](../philosophy/adr-009-base-entity.md) — 8 섹션 + 설계 포인트 5개
- "비목표" 추가 예: [`ADR-007 · 솔로 친화적 운영`](../philosophy/adr-007-solo-friendly-operations.md)

### 2.B — Reference (참조 문서)

**대상**: 규칙 · 목록 · 스펙 · 표. 찾아보기 용.
**독자**: Level 2 (개발 중 규약 확인).
**핵심 가치**: "어떤 규칙/항목이 있는가 → 빠르게 찾기".

**필수 섹션 순서 (h2)**:

1. **개요** — 한두 줄. "이 문서가 담는 항목 = 무엇". 전체 독자가 10초 안에 판단.
2. **(본문)** — 표 · 목록 · 카테고리별 항목. anchor 링크로 즉시 점프 가능하게.
3. **관련 문서** — 이 규약을 적용하는 구체 가이드 / 이 규칙의 근거 ADR.

**권장 요소**:

- 각 항목마다 **Good / Bad 예시** 쌍 (반례가 있어야 규칙이 명확)
- 의사결정 트리 (조건별 어느 옵션을 고를지)
- 버전/날짜 (규칙이 바뀌었을 때 추적)

**피해야 할 것**:

- "왜 이 규칙인가" 장황하게 설명 — 이건 ADR 로 옮겨야 함. Reference 는 **규칙 자체** 에 집중.
- 절차 (Step 1/2/3) — 이건 How-to. Reference 는 정적 목록.

**모범**:

- [`Naming Conventions`](../convention/naming.md) — 네이밍 규칙 카테고리별 표 + 반례
- [`Architecture Rules (ArchUnit)`](../structure/architecture-rules.md) — ArchUnit r1~r22 명세

### 2.C — How-to (절차서)

**대상**: 특정 목표 달성 단계별 가이드.
**독자**: Level 1~2 (실행자).
**핵심 가치**: "이걸 따라하면 X 가 완성됨".

**필수 섹션 순서 (h2)**:

1. **개요** — 목표 · 대상 독자 · 예상 시간 · 사전 요구사항.
2. **단계 1 ~ N** — 각 단계에 (1) 무엇을 (2) 명령/코드 (3) 성공 검증 (4) 실패 시 분기 포함.
3. **트러블슈팅** — 자주 만나는 에러 + 해결법.
4. **다음 단계** — 이 가이드 다음에 할 것.

**권장 요소**:

- "한눈에 보기" ASCII 다이어그램 (전체 플로우) — 상단에.
- 명령어는 **복사-붙여넣기 가능** 형태 (주석 포함 OK, 그대로 실행됨).

**피해야 할 것**:

- 왜 이 방법인가 — ADR 또는 Explanation 에 위임.
- 개념 설명이 너무 길어짐 — How-to 는 "따라가면 되는" 체계여야 함.

**모범**:

- [`첫 수정 — nickname 컬럼 추가`](../onboarding/first-change.md) — nickname 컬럼 추가 튜토리얼
- [`키 교체 절차 (Key Rotation)`](../production/setup/key-rotation.md) — 키 교체 절차

### 2.D — Explanation (설명글)

**대상**: 개념 · 구조 · 동작 원리 설명.
**독자**: Level 2~3 (이해하고 싶은 사람).
**핵심 가치**: "이 시스템이 어떻게 생겼고 왜 이렇게 동작하는가".

**필수 섹션 순서 (h2)**:

1. **한 문장 요약** — 이 설명의 핵심을 한 문장으로.
2. **개념** — 원리 · 배경. **다이어그램 필수** (ASCII 또는 그림). 말로만 설명하면 Explanation 자격 미달.
3. **구조** — 컴포넌트 · 각자의 책임 · 상호작용. 표 권장.
4. **사용법 / 예시** — Good example + Bad example 최소 1쌍.
5. **관련 문서** — 이 개념이 전제하는 ADR, 이 개념을 사용하는 How-to.

**권장 요소**:

- FAQ (흔한 오해)
- 확장 시나리오 (이 개념을 더 밀어붙이면?)

**피해야 할 것**:

- 단계별 절차 — How-to 에 속함. Explanation 은 정적 이해.
- 결정 근거만 — ADR 에 속함. Explanation 은 "현재 상태" 를 설명.

**모범**:

- [`JWT Authentication`](../structure/jwt-authentication.md) — JWT 시스템 구조 + 필터 체인
- [`Multi-tenant Architecture`](../structure/multitenant-architecture.md) — per-app schema 구현 패턴

### 2.E — Runbook (운영 절차)

**대상**: 장애 대응 · 정기 운영 작업.
**독자**: Level 2.5 (운영자).
**핵심 가치**: "지금 이 상황이면 뭘 해야 하나" 를 30초 안에.

**필수 섹션 순서 (h2)**:

1. **개요** — 이 runbook 이 다루는 상황 범위.
2. **상황 매트릭스** — 증상 → 원인 → 대응 → 참조 섹션의 표. 빠른 점프용.
3. **(각 상황별 상세 섹션)** — 진단 명령 · 대응 명령 · 확인 명령. **전부 복사-붙여넣기 가능**.
4. **에스컬레이션** — 이 runbook 으로 해결 안 될 때.

**권장 요소**:

- 체크리스트 (대응 완료 확인용)
- 사후 분석 링크 (이 장애 발생 후 무엇을 문서화/백로그에 추가할지)

**피해야 할 것**:

- 장황한 배경 설명 — 긴급 상황에서 방해.
- 개념 · 결정 근거 — ADR/Explanation 에 위임.

**모범**:

- [`운영 런북 (Runbook)`](../production/deploy/runbook.md) — 평시 배포 · 롤백 · 장애 대응

### 2.F — 유형 선택 가이드

새 문서를 쓰기 시작할 때 **이 질문 순서** 로 유형 결정:

1. **"왜 이 선택을 했는가?"** 를 설명하는가 → **ADR**
2. **"어떤 규칙/항목이 있는가?"** 를 정리하는가 → **Reference**
3. **"이걸 하려면 어떻게?"** 단계별 절차인가 → **How-to**
4. **"이 시스템이 어떻게 생겼는가?"** 개념/구조 이해인가 → **Explanation**
5. **"이 상황이 터지면 뭘 해야 하나?"** 긴급 대응인가 → **Runbook**

**복합 유형 허용**: 한 문서가 Explanation + Reference 성격을 동시에 가질 수 있음 (예: `testing-strategy.md` 는 4층 전략 설명 + 각 층 체크리스트). 메타블록에 **주 유형** 만 명시, 본문에서 섞어도 OK.

---

## 3. 톤 · 문체 · 말투

### 기본 말투: 해요체

- `~예요`, `~이에요`, `~해요` 기본.
- 명령조 (`~하라`) 금지. 규칙을 서술할 때도 `~합니다`, `~따릅니다`.
- 학술 톤 (`~하여야 한다`, `~이며`) 회피.

### 섹션명 자연 한국어

학술적 섹션명 대신 물음/감탄 형태 허용:

| ❌ 학술체 | ✅ 자연체 |
|---|---|
| 한 문장 직관 | 결론부터 |
| Context — 이 결정이 답해야 했던 물음 | 왜 이런 고민이 시작됐나? |
| Options Considered | 고민했던 대안들 |
| Consequences | 이 선택이 가져온 것 |
| Lessons Learned | 교훈 |

**예외**: 고유명사는 영문 유지 — `Status`, `Prior Art`, `Code References`, `ArchUnit`, `ADR`.

### 독자에게 직접 말 걸기 허용

- "~해요" 보다 직접적인 톤 OK: "지금은 쓸 데가 없어요", "처음 보는 사람에게는 혼란 가능"
- 감탄사 절제 — `ㅋㅋ`, 이모지 금지 (유저 요청 시만 예외)

### 표현 강도

- 단정적 표현 허용: "**전혀** 하지 않습니다", "**반드시** 따릅니다"
- 단 근거가 없으면 쓰지 말 것. 모든 단정은 뒤에 "왜" 를 수반해야 함.
- 완곡 표현 (`~인 것 같습니다`, `~할 수도 있습니다`) 은 정말 불확실할 때만.

### 샘플

- 해요체 일관: [`ADR-012 · 앱별 독립 유저 모델 (통합 계정 폐기)`](../philosophy/adr-012-per-app-user-model.md) 전체
- 단정적 근거 있는 표현: [`ADR-004 · Gradle 모듈 경계 + ArchUnit 22규칙으로 의존 강제`](../philosophy/adr-004-gradle-archunit.md) "ArchUnit 이 **유일한** 런타임 경계 강제 수단"

---

## 4. 용어집 (Glossary)

프로젝트 특유 용어는 **표기를 고정**. 흔들리면 검색/치환이 안 됨.

| 용어 | 표기 | 설명 |
|---|---|---|
| 템플릿 레포 | `spring-backend-template` | 본 레포 (GitHub Template Repository) |
| 파생 레포 | `backend-server`, `sumtally-backend` 등 | 템플릿에서 "Use this template" 으로 분기된 레포 |
| 앱 모듈 | `apps/app-<slug>` | 하나의 서비스 도메인을 담는 모듈 |
| core 모듈 | `core/core-*-api`, `core/core-*-impl` | 공통 도메인 (auth/user/device 등) |
| common 모듈 | `common/common-*` | 도메인 없는 공통 인프라 |
| Port | `AuthPort`, `UserPort` 등 | `-api` 모듈의 인터페이스 |
| Primary Adapter | Controller | HTTP → 서비스 방향 |
| Secondary Adapter | `ResendEmailAdapter` 등 | 서비스 → 외부 방향 |
| 솔로 | 한 명의 개발자 | "솔로 감당 가능" 등 |
| 도그푸딩 | `tools/dogfooding/` | 자체 템플릿을 자기 프로젝트에 적용하는 검증 |
| cherry-pick 전파 | — | 템플릿 레포 개선 → 파생 레포로 전파 |
| `appSlug` | 단일 문자열 claim | JWT 의 앱 식별자 ([`ADR-012`](../philosophy/adr-012-per-app-user-model.md)) |
| template-v* 태그 | `template-v0.3.0` 등 | 템플릿 레포 전체 단위 SemVer |

### 용어 사용 규칙

- 한 번 정의하면 본문에서 계속 같은 표기 유지
- 약어는 **첫 등장 시 풀어쓰기** + 괄호로 약어: `ADR (Architecture Decision Record)`
- 같은 개념을 한국어/영어 혼용 지양 — "포트" vs "Port" 중 하나로 고정 (본 프로젝트는 **Port** 영문 유지)

---

## 5. 코드 블록 규칙

### 언어 태깅 필수

```java   ← ✅
```
```      ← ❌ (언어 미지정)
```

모든 코드 블록에 언어 태그 (`java`, `bash`, `yaml`, `sql`, `gradle`, `markdown` 등).

### 경로 주석

긴 코드 스니펫에는 **파일 경로 주석** 을 첫 줄에 달기. Truncation 여부도 명시.

```java
// common-security/jwt/JwtService.java 발췌
public String issueAccessToken(...) {
    ...
}
```

`발췌` 표기로 "전체가 아님" 을 명확히. 전체 인용이면 `전체`.

### 공백 / 들여쓰기

- 4 스페이스 (Java/Gradle 기본)
- 2 스페이스 (JSON/YAML/Markdown)
- 탭 금지

### 주석 최소

- 코드 스니펫 안의 주석은 **문서 맥락을 위한 것만**. 실제 코드의 주석이 아닌 것은 `// ← 이 부분이 핵심` 같은 지시 주석 허용.
- 단 이런 지시 주석은 스니펫 1~2개 이하로만. 많으면 본문에서 설명.

### 샘플

- 경로 주석 + 발췌 표기: [`ADR-006 · HS256 JWT (대칭키)`](../philosophy/adr-006-hs256-jwt.md) 의 JwtService 스니펫
- 지시 주석 활용: [`ADR-014 · Delegation mock 테스트 금지`](../philosophy/adr-014-no-delegation-mock.md) 의 "// ← 구현 세부에 결합" 주석

---

## 6. 링크 / Cross-reference 규칙

### 내부 링크는 **상대 경로**

- 같은 디렉토리: `[`ADR-005`](../adr-005-db-schema-isolation.md)` ← ADR 파일에서 다른 ADR 참조
- 상위 경로: `[`testing-strategy`](../../../testing/testing-strategy.md)` ← `journey/philosophy/` 에서 `docs/testing/` 참조
- 절대 경로 · 전체 URL 금지 (레포 이름 바뀌면 깨짐)

### 앵커 링크

```markdown
[제약 2](./README.md#제약-2--시간이-가장-희소한-자원)
```

- 한글 제목의 앵커는 **한글 그대로** + 특수문자는 `-` 로 치환 + 공백도 `-`
- 확인 방법: 실제로 클릭해서 점프 검증

### ADR 간 참조 포맷

**첫 언급 시** — 번호 + 제목 + 링크:
```markdown
[ADR-005 · 단일 Postgres + 앱당 schema](./adr-005-db-schema-isolation.md)
```

**재언급 시** — 번호만 + 링크:
```markdown
[ADR-005](./adr-005-db-schema-isolation.md)
```

### "관련 ADR" 섹션 위치

Code References 마지막에 `**관련 ADR**:` 블록으로 수렴:

```markdown
**관련 ADR**:
- [ADR-003 · -api / -impl 분리](./adr-003-api-impl-split.md) — 본 ADR 의 포트 경계 전제
- [ADR-012 · 앱별 독립 유저 모델](./adr-012-per-app-user-model.md) — 쌍으로 동작
```

각 링크 뒤에 `—` + 한 줄 설명 필수.

### 외부 링크 (Prior Art)

- `[이름](URL)` 기본 형태
- 도메인 권위 (공식 문서 > 블로그 > 포럼) 우선
- URL 이 장기 안정인지 확인 (Medium 개인 블로그 등 링크 rot 위험 높은 것 회피)

### 샘플

- ADR 간 재참조: [`ADR-013 · 앱별 인증 엔드포인트 (core-auth 는 라이브러리 역할)`](../philosophy/adr-013-per-app-auth-endpoints.md) 의 "관련 ADR" 블록
- 앵커 링크: [`adr-005`](../philosophy/adr-005-db-schema-isolation.md) 의 `[`제약 2`](../README.md#제약-2--시간이-가장-희소한-자원)`

---

## 7. 문서 규모별 1 세션 작업량

경험 기반 기준. 무리하면 밀도가 떨어짐.

| 규모 | 예시 | 1 세션 분량 |
|---|---|---|
| **대형 플래그십** | `philosophy/*.md`, `architecture.md`, `infrastructure.md`, `runbook.md` | **1 문서 엄격** |
| **중형 여정** | `onboarding.md`, `deployment.md`, `dogfood-setup.md`, `app-scaffolding.md` | 1 문서 기본 |
| **소형 컨벤션** | `naming.md`, `records-and-classes.md` 등 (100~300 줄) | 관련 주제 **2 개 쌍** |
| **ADR 카드 1 개** | philosophy 테마별 쪼갠 단위 | 4 개까지 몰아 가능 (테마 5 처럼) |

### 1 세션 기준의 근거

- 대형: 코드 감사 20~50 파일 + 독자 시뮬레이션 반복. 분산하면 맥락 유지 비용이 큼.
- 중형: 코드 감사 10~20 파일. 한 흐름을 끝까지.
- 소형 쌍: 짝을 지으면 오히려 일관성 강화 효과.

### 세션 밀도 유지 원칙

- 1 세션 내 **감사 → 작성 → 검증 → 커밋** 한 사이클로 완결
- 컨텍스트 소모가 심하면 중단하고 다음 세션으로
- 4~5 시간 초과 시 밀도 하락 — 강제 종료 권장

---

## 8. 검증 체크리스트 (문서 완료 전)

새 문서 / ADR 작성 후 커밋 전:

- [ ] 섹션 헤더가 STYLE_GUIDE 기준을 따르는가
- [ ] 해요체 일관 유지 (학술체 · 명령조 섞임 없음)
- [ ] 옛 섹션명 본문 참조 없음 (`grep -E '한 문장 직관|Consequences 에서|...'`)
- [ ] 링크가 실제 파일에 도달 (내부 · 외부 모두)
- [ ] Code References 의 파일 경로가 실존 (`ls` 확인)
- [ ] `diff -rq` 로 3 레포 (template / backend-server / docs-viewer) 동기화 확인
- [ ] `docs-viewer/docs/manifest.json` 의 사이드바 엔트리 추가 (새 문서인 경우)
- [ ] 커밋 메시지 Conventional Commits 포맷 + subject 72자 이하

---

## 9. 이 가이드의 진화 원칙

### 귀납이 우선, 연역은 금지

이 가이드의 모든 규칙은 **구체 샘플에서 추출**. 추상 원칙을 먼저 쓰고 "이렇게 쓰자" 선언하지 않음.

- 새 규칙 추가 시 `journey/philosophy/*.md` 또는 다른 완성 문서에서 근거 샘플 제시 필수
- 샘플 없는 규칙은 "아이디어" 로만 보존 — 실제 문서 작성 시 검증되면 본문 이동

### 예외 발생 시 기록 → 패턴 식별 → 규칙 업데이트

한 문서에서 이 가이드를 따르기 어려운 상황 발생 시:

1. **예외를 일단 적용** + 해당 문서 상단에 "본 문서는 STYLE_GUIDE §N 예외" 주석
2. 같은 예외가 3 개 이상 문서에서 발생하면 **패턴 인식**
3. 본 가이드에 예외 조항 추가 또는 기존 규칙 수정

### 로드맵에서 이 가이드의 활용

- **Tier 1 (플래그십)** 작성 시 이 가이드가 주 레퍼런스
- **Tier 2~3** 작성 시 가이드 위반 발견되면 즉시 업데이트
- **Tier 5 (Level 0 신규)** 작성 시 Level 0 톤 규칙 확장 필요 — 작성 결과에서 추출 → 본 가이드 §1 업데이트

---

## 10. 변경 이력

| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-04-24 | 초기 작성 | `journey/philosophy/` 16 ADR 파일럿에서 귀납 추출 |
| 2026-04-24 | §2 재구성: 5 유형 템플릿 (ADR/Reference/How-to/Explanation/Runbook) + 공통 메타블록 추가 | 사이드바 재구성 검토 과정에서 "ADR 규격을 모든 문서에 강제는 비효율" 확인 · Agent B 문서 분류 결과 (26 미정돈 문서 → 5 유형) 기반 |

이후 업데이트 시 상기 표에 추가.
