# Code Comments Convention

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~4분

이 문서는 `template-spring` 및 파생 레포의 **코드 주석(Javadoc + 인라인) 작성 규약**을 정의합니다. 무엇을 적고 무엇을 안 적을지의 *기준*이 핵심.

---

## 원칙

**기본은 "주석 안 씀" 입니다.** 식별자가 의도를 드러내면 주석은 노이즈가 되고, 코드가 변하면 stale 부채가 됩니다. 다만 이 레포는 **템플릿** — 파생 레포 N개에 그대로 뿌려져 *신규 개발자가 처음 30분에 읽을 코드*가 됩니다. 그래서 *비명백한 결정·제약·연결*은 명시적으로 적습니다.

두 톤 사이의 균형점:

- ✅ **WHY 는 적는다** — 비명백한 결정·제약·트레이드오프
- ❌ **WHAT 은 안 적는다** — 식별자가 이미 설명하면 중복 금지

---

## 적는다 / 안 적는다

| 종류 | 룰 | 예 |
|---|---|---|
| ✅ **WHY** | 비명백한 결정·제약·트레이드오프 | "JWT Bearer + 모바일이라 CSRF 끔 — 끄지 않으면 모든 POST 가 403" |
| ✅ **사용 안내** | `-api` 모듈 public method, Controller, public Service 의 호출자 입장 가이드 | `AuthPort.signUpWithEmail` 의 처리 순서 6단계 + `@throws` |
| ✅ **지뢰 경고** | "이거 바꾸면 X 깨짐" 류 그 줄에서만 의미 있는 주의 | "기본 차단 — 새 엔드포인트는 위 permitAll 안 거치면 자동 보호" |
| ✅ **연결 라벨** | 다른 곳과의 *비명백 의존*을 한 줄로 | "(2) URL path 의 {appSlug} 를 MDC 에 박음 — 이후 모든 로그·메트릭에 자동 첨부" |
| ❌ **WHAT 반복** | 식별자가 이미 설명하면 금지 | `UserService` 위에 "사용자 서비스" — 식별자 중복, 0 정보 |
| ❌ **장황한 도입부** | `docs/` 와 중복되는 "이 모듈은 ..." 류 | 큰 그림은 docs/ 책임, 코드 주석은 *그 줄에서만* 의미 있는 정보만 |
| ❌ **인라인 도배** | 명백한 코드에 한 줄씩 | `// add 1 to counter` — 식별자 + 연산이면 충분 |
| ❌ **변경 stale** | 코드 변경과 주석이 어긋남 | 주석은 코드와 같은 커밋에서 함께 갱신. 어긋날 거면 처음부터 안 적는다. |

---

## 형식 — Javadoc + 인라인 교차

**클래스/메서드 위는 Javadoc**, **body 안은 *읽다가 막힐 곳에만* 인라인** 입니다.

```java
/**
 * 현재 요청자 user id 조회.
 *
 * <p>JwtAuthFilter 가 주입한 Authentication 에서 userId 추출. SecurityConfig 가
 * 미인증을 진입 전 차단하므로 여기선 항상 인증 상태 보장.
 */
public Long currentUserId() {
    // SecurityConfig 차단 후라 auth 는 항상 non-null
    var auth = SecurityContextHolder.getContext().getAuthentication();
    // principal 은 JwtAuthFilter 가 AuthenticatedUser 로 세팅 보장
    return ((AuthenticatedUser) auth.getPrincipal()).id();
}
```

- **Javadoc**: 호출자가 *그 메서드를 어떤 흐름에서 어떻게 쓰는가*. `@param` / `@return` / `@throws` 는 *비명백한 제약·예외*가 있을 때만 (자명한 거 반복 금지).
- **인라인**: 코드 *읽다가 멈출 곳* — null 보장 가정·동작 순서·외부 시스템 결합 등.
- 둘 다 *짧게*. 한 메서드에 인라인 5개 이상이면 메서드를 쪼개야 한다는 신호.

---

## 언어

**한국어 일관**. 이 레포의 기존 주석이 한국어이므로, 새 주석도 한국어로 작성합니다 — 혼재되면 *읽는 호흡*이 깨집니다. 영어 라이브러리 용어(JWT, MDC, idempotent 등)는 그대로 사용해도 됩니다.

영어 주석을 발견하면 *유지+보완 시점*에 한국어로 다듬습니다.

---

## 기존 주석 다루기

리팩토링이나 새 기능 추가 시 기존 주석을 마주치면:

1. **기본은 유지** — 옛 주석의 *의도*는 보존. 톤만 통일이 필요하면 한국어로 다듬되 의미 변경 금지.
2. **명백히 장황한 것만 다듬기** — 같은 말 반복, 4줄짜리를 1줄로, docs/ 와 중복되는 부분 삭제.
3. **stale (코드와 어긋남) 발견 시 즉시 수정** — 그 줄을 손보지 않더라도 같은 커밋에서 정정.

*추가만 하고 기존 안 건드리는 패턴은 권장하지 않습니다* — 시간이 지나면 일관성이 깨집니다.

---

## 우선순위 영역 (이런 곳부터 충실히)

신규 개발자가 *처음 30분에 읽을 가능성이 높은 곳* 부터 주석을 충실히 채웁니다.

1. **`-api` 모듈의 Port interface** — 호출자 가시성이 가장 큼
2. **AutoConfiguration / Config / Filter** — Spring Boot 자동등록·필터 체인 결정
3. **Controller** — `@Operation` summary/description 으로 Swagger 노출
4. **공용 응답·예외** — `ApiResponse`, `GlobalExceptionHandler`, `BaseException` 등
5. DTO/record/enum — 한 줄 Javadoc 으로 *언제 어떤 흐름에서 쓰는지* 만 (지나치게 자세하게 X)

`-impl` 의 Service body 안 인라인은 *진짜로 막히는 곳*만. 도배 금지.

---

## 자동 강제

주석 *내용*은 자동 강제할 수 없지만 *형식*은 빌드가 잡아줍니다:

- **Spotless** (`./gradlew spotlessCheck`) — Javadoc 줄 폭 자동 정렬 (google-java-format `.aosp()`)
- **CI** — `spotlessCheck` step 으로 PR 단계에서 위반 차단
- **위반 시**: `./gradlew spotlessApply` 로 자동 정리

---

## 관련 문서

- [`Coding Conventions 개요`](./README.md) — 본 디렉토리 진입점
- [`Documentation Style Guide`](../reference/STYLE_GUIDE.md) — 문서 작성 규칙 (md 파일용)
- [`ADR-016 · Mapper 클래스 금지`](../philosophy/adr-016-dto-mapper-forbidden.md) — 식별자가 의도 드러내야 한다는 같은 정신
