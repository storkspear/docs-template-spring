# Code Comments Convention

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~4분

이 문서는 `template-spring` 과 파생 레포의 코드 주석 규약을 정합니다. Javadoc 과 인라인 주석 두 가지를 다루고, 핵심은 무엇을 적고 무엇을 안 적을지의 기준이에요.

---

## 원칙

기본값은 "주석 안 씀" 입니다. 식별자가 의도를 드러내면 주석은 노이즈가 되고, 코드가 바뀌면 어긋난 채로 남아 부채가 됩니다. 다만 이 레포는 템플릿이라 파생 레포 여러 개에 그대로 복제돼, 신규 개발자가 처음 30분에 읽을 코드가 됩니다. 그래서 비명백한 결정·제약·연결은 명시적으로 적어요.

기준은 한 줄로 요약됩니다. **왜는 적고, 무엇은 안 적어요.**

- 왜(WHY) — 비명백한 결정·제약·트레이드오프는 적습니다.
- 무엇(WHAT) — 식별자가 이미 설명하면 중복이라 안 적습니다.

---

## 적는다 / 안 적는다

| 종류 | 룰 | 예 |
|---|---|---|
| 적는다 — 왜(WHY) | 비명백한 결정·제약·트레이드오프 | "JWT Bearer + 모바일 환경이라 CSRF 토큰 메커니즘 불필요. 끄지 않으면 모든 POST 가 403." |
| 적는다 — 사용 안내 | `-api` 모듈 public method, Controller, public Service 의 호출자 입장 가이드 | `AuthPort.signUpWithEmail` 의 처리 순서 + `@throws` |
| 적는다 — 지뢰 경고 | "이거 바꾸면 X 깨짐" 류, 그 줄에서만 의미 있는 주의 | "기본 차단 — 새 엔드포인트는 위 permitAll 안 거치면 자동 보호" |
| 적는다 — 연결 라벨 | 다른 곳과의 비명백 의존을 한 줄로 | "(2) URL path 의 {appSlug} 를 MDC 에 박음 — 이후 모든 로그·메트릭에 자동 첨부" |
| 안 적는다 — 무엇 반복 | 식별자가 이미 설명하면 금지 | `UserService` 위에 "사용자 서비스" — 식별자 중복, 정보 0 |
| 안 적는다 — 장황한 도입부 | `docs/` 와 중복되는 "이 모듈은 ..." 류 | 큰 그림은 `docs/` 책임, 코드 주석은 그 줄에서만 의미 있는 정보만 |
| 안 적는다 — 인라인 도배 | 명백한 코드에 한 줄씩 | `// add 1 to counter` — 식별자와 연산이면 충분 |
| 안 적는다 — 어긋난 주석 | 코드 변경과 주석이 따로 노는 것 | 주석은 코드와 같은 커밋에서 함께 갱신해요. 어긋날 거면 처음부터 안 적어요. |

---

## 형식 — Javadoc 과 인라인

클래스·메서드 위는 Javadoc 으로, body 안은 읽다가 막힐 곳에만 인라인으로 적어요. 아래는 `@CurrentUser` 로 주입한 유저 정보를 컨트롤러가 그대로 쓰는 실제 패턴이에요. 인라인 주석 두 줄은 "이런 자리에 적는다" 를 보여 주기 위해 이 문서에서 추가한 것이고, 실제 파일에는 없습니다.

```java
// core-user-impl/controller/UserController.java 발췌 — 인라인 주석 2줄은 설명용 추가
@GetMapping(ApiEndpoints.User.ME)
@Operation(summary = "현재 유저 프로필 조회", description = "JWT 토큰의 유저 ID 로 자기 자신의 전체 프로필을 반환합니다.")
public ApiResponse<UserProfile> getMyProfile(@CurrentUser AuthenticatedUser user) {
    // CurrentUserArgumentResolver 가 SecurityContext 에서 AuthenticatedUser 를 꺼내 주입.
    // SecurityConfig 가 미인증을 진입 전 차단하므로 여기선 항상 인증 상태 보장.
    UserProfile profile = userPort.getProfile(user.userId());
    return ApiResponse.ok(profile);
}
```

- Javadoc — 호출자가 그 메서드를 어떤 흐름에서 어떻게 쓰는지를 적어요. `@param`·`@return`·`@throws` 는 비명백한 제약·예외가 있을 때만 적고, 자명한 건 반복하지 않아요.
- 인라인 — 코드 읽다가 멈출 곳에만 적어요. null 보장 가정, 동작 순서, 외부 시스템 결합 같은 게 후보예요.
- 둘 다 짧게 적어요. 한 메서드에 인라인이 다섯 개를 넘으면 메서드를 쪼개야 한다는 신호예요.

---

## 언어

주석은 한국어로 일관되게 작성합니다. 이 레포의 기존 주석이 한국어라, 새 주석도 한국어로 맞춰요. 한국어와 영어가 섞이면 읽는 호흡이 끊겨요. JWT·MDC·idempotent 같은 정착된 기술 용어는 영어 그대로 써도 됩니다.

영어로 된 주석을 발견하면 그 코드를 손볼 때 한국어로 다듬어요.

---

## 기존 주석 다루기

리팩토링이나 기능 추가 중에 기존 주석을 마주치면 다음 순서로 처리합니다.

1. 기본은 유지 — 옛 주석의 의도는 보존해요. 톤만 맞출 거면 한국어로 다듬되, 의미는 바꾸지 말아요.
2. 명백히 장황한 것만 다듬기 — 같은 말 반복, 네 줄짜리를 한 줄로, `docs/` 와 겹치는 부분 삭제.
3. 코드와 어긋난 주석은 즉시 수정 — 그 줄을 손보지 않더라도 같은 커밋에서 정정해요.

추가만 하고 기존을 안 건드리는 패턴은 권장하지 않아요. 시간이 지나면 일관성이 깨져요.

---

## 우선순위 영역

신규 개발자가 처음 30분에 읽을 가능성이 높은 곳부터 주석을 충실히 채워요.

1. `-api` 모듈의 Port interface — 호출자 가시성이 가장 큽니다.
2. AutoConfiguration·Config·Filter — Spring Boot 자동등록과 필터 체인 결정이 들어 있습니다.
3. Controller — `@Operation` summary·description 으로 Swagger 에 노출됩니다.
4. 공용 응답·예외 — `ApiResponse`, `GlobalExceptionHandler`, `BaseException` 같은 것들이에요.
5. DTO·record·enum — 한 줄 Javadoc 으로 언제 어떤 흐름에서 쓰는지만 적어요. 지나치게 자세히 쓰지 않아요.

`-impl` 의 Service body 안 인라인은 진짜로 막히는 곳에만 적어요. 도배는 금지예요.

---

## 자동 강제

주석 내용은 자동으로 강제할 수 없지만, 형식은 빌드가 잡아 줍니다.

- Spotless — `./gradlew spotlessCheck` 가 Javadoc 줄 폭과 들여쓰기를 정렬합니다. 포매터는 google-java-format 의 `.aosp()` 4-space 프로파일이에요.
- CI — `spotlessCheck` step 이 PR 단계에서 위반을 차단합니다.
- 위반 시 — `./gradlew spotlessApply` 로 자동 정리합니다.

---

## 관련 문서

- [`Coding Conventions 개요`](./README.md) — 본 디렉토리 진입점
- [`Documentation Style Guide`](../reference/STYLE_GUIDE.md) — 문서 작성 규칙 (md 파일용)
- [`ADR-016 · Mapper 클래스 금지`](../philosophy/adr-016-dto-mapper-forbidden.md) — 식별자가 의도를 드러내야 한다는 같은 정신
