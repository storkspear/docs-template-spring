# Level 0 — 뭔지 일단 감 잡기

여기는 **"이 레포를 써야 하나 말아야 하나"** 를 3~10분 안에 결정할 수 있게 돕는 곳이에요. Spring Boot 경험이 없어도 · 코드를 안 깔아봐도 · 아직 클론을 안 해봤어도 읽을 수 있도록 쓰여 있습니다.

## 누가 읽는가

- 이 레포 링크를 처음 받은 사람
- "Spring 백엔드 템플릿" 이 뭔지 감이 없는 사람
- PM · 디자이너 · 프론트엔드 · 비슷한 걸 찾고 있는 개발자
- 아직 시간 투자 여부를 결정 못 한 사람

## 이 레벨의 목표

당신이 3~10 분 안에 다음 3 가지 질문에 답할 수 있게 하는 것:

1. **이게 뭔가?** — 한 줄로 설명 가능
2. **내 상황에 맞는가?** — yes / no / maybe 판단 가능
3. **그다음 뭘 봐야 하지?** — 다음 문서로 자연스럽게 이동

**목표가 아닌 것**:
- 실제로 돌려보게 만들기 (그건 [Onboarding — 템플릿 첫 사용 가이드](../start/onboarding.md) 의 역할)
- 구조 전체를 이해하게 만들기 (그건 [Architecture Reference](../structure/architecture.md))
- 설계 결정의 이유를 다 알게 만들기 (그건 [Repository Philosophy — 책 안내](../philosophy/README.md))

## 문서

### 읽기 전용 (실행 불필요)
1. [**이게 뭐야? (3분)**](./what-is-this.md) — 한 문장 소개 · 쓰는 맥락 · 안 맞는 경우
2. [**5 분 투어**](./five-minute-tour.md) — 핵심 개념 4 개 · 모듈 그림 · "아하" 순간

### 손에 잡는 단계 (실행 있음)
3. [**첫 실행 결과 해석**](./first-run.md) — `bootRun` 로그 라인별 의미
4. [**첫 수정 — nickname 컬럼 추가**](./first-change.md) — 30 분 튜토리얼, 한 필드 추가의 6 곳 반영
5. [**배포 맛보기**](./first-deploy.md) — 로컬 Docker 로 운영 배포 감 잡기

> 💡 **모르는 용어가 나오면** — [Level 0 용어 사전](../reference/glossary.md) (Reference 그룹) 참조. Spring · JPA · Docker · JWT · Kamal 등 범용 용어 풀이.

## 다음 단계

Level 0 두 문서를 다 읽었다면:

| 다음 행동 | 문서 |
|---|---|
| 내 노트북에서 돌려보기 | [Onboarding — 템플릿 첫 사용 가이드](../start/onboarding.md) — 로컬 개발 환경 셋업 |
| 먼저 구조를 이해하고 싶음 | [Architecture Reference](../structure/architecture.md) — 모듈 · 기술 스택 |
| 왜 이렇게 설계됐는지 궁금 | [Repository Philosophy — 책 안내](../philosophy/README.md) — 16 개 ADR |
| 전체 읽기 순서를 알고 싶음 | [📚 spring-backend-template — 책 목차 (Developer Journey)](./README.md) — Developer Journey |

"나한테 안 맞는다" 가 결론이어도 OK — 이 레벨의 의도 자체가 **빠른 필터링**이에요.
