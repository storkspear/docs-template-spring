# Environment UI — 기술 스택 다이어그램

> **유형**: Reference · **독자**: Level 0~1 · **읽는 시간**: ~2분

이 문서는 [`Environment`](./environment.md) 인벤토리를 **한 장의 다이어그램**으로 요약해요. 버전·수치의 정본은 언제나 [`environment.md`](./environment.md) 와 `gradle/libs.versions.toml` 이에요 — 여기서는 "무엇이 어느 층에 있는가" 의 큰 그림만 잡으면 돼요.

%%TECH_STACK_DIAGRAM%%

## 읽는 법

- **위에서 아래**가 요청이 흐르는 방향이에요. 클라이언트(Flutter 앱 · React Admin)가 REST `{data, error}` 계약으로 백엔드를 호출하고, 백엔드가 데이터 층과 외부 연동 층을 사용해요.
- **점선 카드(외부 연동)** 는 feature toggle 로 앱별 on/off 가 가능한 선택 연동이에요. 토글의 동작 방식은 [`Feature Toggle`](../production/operations/feature-toggle.md) 에 있어요.
- 관측성과 품질 게이트 층은 특정 요청 경로에 속하지 않고 전체를 감싸는 횡단 관심사예요.

> 💡 이 다이어그램은 docs 뷰어에서만 렌더링돼요. GitHub 에서 raw 마크다운으로 보면 `%%TECH_STACK_DIAGRAM%%` 플레이스홀더만 보여요 — 기존 운영 구성도(LOCAL/PROD)와 같은 방식이에요.

## 관련 문서

- [`Environment`](./environment.md) — 전체 인벤토리 · 버전표 (이 다이어그램의 정본)
- [`Architecture`](../structure/architecture.md) — 모듈 구조와 스택이 엮이는 방식
- [`Infrastructure`](../production/deploy/infrastructure.md) — 운영 배포 구성도
