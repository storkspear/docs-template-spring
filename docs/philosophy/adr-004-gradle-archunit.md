# ADR-004 · Gradle 모듈 경계 + ArchUnit 22규칙으로 의존 강제


**Status**: Accepted. 2026-04-20 기준 [`DependencyRules.groovy`](https://github.com/storkspear/spring-backend-template/blob/main/build-logic/src/main/groovy/com/factory/DependencyRules.groovy) DSL + [`ArchitectureRules.java`](https://github.com/storkspear/spring-backend-template/blob/main/common/common-testing/src/main/java/com/factory/common/testing/architecture/ArchitectureRules.java) 22 규칙 공존.

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~5분

> **이 ADR 의 범위** — [ADR-001](./adr-001-modular-monolith.md) 에서 "**왜** 2단계 방어가 필요한가" 를, [ADR-003](./adr-003-api-impl-split.md) 에서 "**무엇을** 분리하는가 (-api/-impl)" 를 다뤘어요. 본 ADR 은 **"어떤 도구로 어떻게 강제할 것인가"** 의 도구 선택과 DSL 설계, 그리고 앞에서 안 다룬 나머지 ArchUnit 규칙 (r16, r18~r22) 에 초점을 맞춥니다.

## 결론부터

Python 의 [`ruff`](https://docs.astral.sh/ruff/), TypeScript 의 `tsc --strict`, Rust 컴파일러처럼 **컨벤션을 문서가 아니라 빌드 자체가 강제** 하는 장치입니다. 우리 프로젝트에서 그 역할을 하는 것이 `DependencyRules.groovy` DSL (빌드 시) 과 ArchUnit (소스 스캔 시) 의 조합이에요. 사람이 "이 규칙 지켜주세요" 라고 부탁하는 대신, **규칙 위반 시 빌드가 실패** 하도록 설계했습니다.

## 왜 이런 고민이 시작됐나?

[ADR-001](./adr-001-modular-monolith.md) 에서 "2단계 방어" 를 선언했어요. [ADR-003](./adr-003-api-impl-split.md) 에서 "-api/-impl 을 분리해서 추출 가능성을 보장한다" 고 선언했고요. 이 선언들이 **실제로 지켜지려면** 누군가가 규칙 위반을 감지해야 합니다. 이 결정이 답해야 할 물음은 이거예요.

> **컨벤션을 어떤 수단으로 강제할 것인가?**  
> PR 리뷰? Git hook? CI lint? 어느 수준의 강제력이 솔로 인디 스케일에 맞는가?

"모듈 경계를 지켜야 한다" 를 문서에 써놓는 것만으로는 부족합니다. **사람은 실수해요**. 특히 솔로 개발자는 피곤한 새벽에 급한 버그 수정하다가 경계를 넘을 수 있습니다. PR 리뷰어도 없고, 내가 내 코드를 리뷰하면 같은 실수를 놓칠 확률이 높아요. **기계가 대신 막아줘야** 합니다.

## 고민했던 대안들

##### Option 1 — PR 리뷰 / 문서에 의존

"conventions/module-dependencies.md 를 읽고 지켜주세요" 같은 방식.

- **장점**: 도구 설치 비용 0.
- **단점**: 솔로 → 리뷰어 없음. 문서 전체를 먼저 읽어야 실수 안 함. 실수가 main 까지 올라간 뒤 한참 지나서야 발견.
- **탈락 이유**: 솔로 인디 환경에서는 강제력이 실질적으로 0.

##### Option 2 — Git pre-commit hook (로컬)

husky 같은 도구로 로컬 커밋 순간 검증.

- **장점**: 가장 빠른 피드백 (커밋 순간).
- **단점**: `git commit --no-verify` 로 우회 가능. CI 환경과 로컬 환경 규칙 동기화 어려움.
- **부분 채택**: 커밋 메시지 검증 ([ADR-002](./adr-002-use-this-template.md) 의 Conventional Commits) 에는 사용. 하지만 **구조 규칙** 에는 부적합.

##### Option 3 — 전통적 Java lint 도구 (Checkstyle, PMD, SpotBugs)

- **장점**: 성숙하고 안정적. IDE 통합 잘 됨.
- **단점**: 기본 rule set 이 **우리 특화 규칙** (-api/-impl 경계, multi-module 의존) 을 커버 못 함. 커스텀 rule 작성 가능하지만 ArchUnit 보다 유연성 떨어짐.
- **탈락 이유**: 범용 도구라 아키텍처 검증에는 맞춤 도구가 더 나음.

##### Option 4 — Gradle convention plugin + ArchUnit ★ (채택)

빌드 단계 검증 (Gradle) + 소스 스캔 검증 (ArchUnit) 두 레이어를 조합.

- **장점**: 기계 강제 — 우회 어려움. Gradle 은 "의존 선언", ArchUnit 은 "소스 참조" — 각자 잘하는 영역 분담. 커스텀 DSL 설계 가능. 로컬/CI 동기화 보장.
- **단점**: 러닝 커브 (DSL 학습 + Gradle lifecycle + ArchUnit 문법).
- **채택 이유**: 단점은 **초기 설정 비용**. 장점은 프로젝트 수명 동안 지속.

## 결정

`DependencyRules.groovy` DSL + ArchUnit 조합. 두 도구가 **서로 다른 실수** 를 잡도록 역할 분담.

### 도구 선택의 메타 철학 — 왜 두 도구?

한 도구로 모든 걸 하려고 하면 복잡도가 폭발합니다. 대신 **각 도구가 가장 잘하는 시점** 에서 활약하게 하면 전체 구조가 단순해져요.

| 도구 | 시점 | 잡는 실수 |
|---|---|---|
| **Gradle convention plugin** | Configuration 단계 (컴파일 전) | `build.gradle` 에 금지된 의존 **선언** |
| **ArchUnit** | Test 단계 (컴파일 후) | 소스 코드에서 금지된 클래스 **import / 참조** |

두 도구의 책임이 **겹치지 않습니다**. Gradle 은 "이 모듈이 뭘 의존한다고 선언했나" 를 보고, ArchUnit 은 "실제 .class 파일이 뭘 참조하나" 를 봅니다.

### DSL 설계 — `DependencyRules.groovy`

DSL 의 핵심 사용 예:

```groovy
// build-logic/src/main/groovy/factory.app-module.gradle
DependencyRules.validate(project, [
    allowedPrefixes : [':common:'],
    allowedPattern  : ~/:core:core-[a-z]+-api/,
    forbiddenPattern: ~/(:core:core-[a-z]+-impl|:apps:app-[a-z]+)/
])
```

4가지 조건 키:

| 키 | 의미 | 예시 |
|---|---|---|
| `allowedPrefixes` | prefix 매치 허용 | `[':common:']` |
| `allowedExact` | 정확 일치 허용 | `[':bootstrap']` |
| `allowedPattern` | regex 허용 | `~/:core:core-[a-z]+-api/` |
| `forbiddenPattern` | regex 금지 (우선 적용) | `~/:core:core-[a-z]+-impl/` |

**설계 의도**: 단순 allowlist 보다 **유연** (정규식 지원). 복잡한 규칙 엔진보다 **간단**. `forbiddenPattern` 우선 적용 → "금지는 절대 금지" 원칙.

### `afterEvaluate` 타이밍 선택의 이유

Gradle 빌드 lifecycle 은 3단계: **Initialization** → **Configuration** → **Execution**.

`afterEvaluate` 는 **Configuration 끝, Execution 시작 전** 실행되는 훅입니다.

- **너무 빠르면** (`build.gradle` 평가 중): 의존 선언이 아직 완성되지 않아 잘못된 통과 가능.
- **너무 느리면** (Execution 중): 이미 Task 그래프가 실행되기 시작. 실패 시 불필요한 작업 낭비.
- **`afterEvaluate`**: 모든 선언이 확정된 뒤, 아직 아무 Task 가 실행되지 않은 **황금 시간**.

### `ProjectDependency` 만 타겟팅

DSL 은 외부 Maven 라이브러리 의존을 **검증하지 않습니다**. 외부 라이브러리 경계 관리는 **다른 문제** (`dependency-check`, Snyk). 모듈 경계는 "내 프로젝트 안의 project 간 관계" 만 다룹니다.

### `test` configuration 예외

DSL 은 `testImplementation`, `testFixturesImplementation` 같은 test 전용 configuration 을 **스킵** 합니다.

```groovy
String name = config.name
if (name.startsWith('test')) return
if (name.startsWith('testFixtures')) return
```

이유: 테스트에서는 **교차 모듈 의존이 필요한 경우** 가 있습니다. 예를 들어 `core-auth-impl` 의 테스트는 `core-user-impl` 의 V001/V002 마이그레이션이 필요 → `testImplementation project(':core:core-user-impl')` 필수. 일반 규칙을 적용하면 테스트 작성 불가능. 이 예외는 [`contract-testing.md`](https://github.com/storkspear/spring-backend-template/blob/main/docs/testing/contract-testing.md) 에 공식화.

### 나머지 ArchUnit 규칙 (r16, r18~r22) — 네이밍/DTO/메타데이터

[ADR-001](./adr-001-modular-monolith.md) 은 r1~r5 를, [ADR-003](./adr-003-api-impl-split.md) 은 r6~r11, r13~r15, r17, r21 을 다뤘어요. [ADR-002](./adr-002-use-this-template.md) 는 r7, r8 을 다뤘고요. 여기서는 남은 **r16, r18, r19, r20, r22** 를 소개합니다.

##### r16 — `*Exception` → `..exception..` 패키지

```java
public static final ArchRule EXCEPTIONS_MUST_RESIDE_IN_EXCEPTION_PACKAGE =
    classes()
        .that().haveSimpleNameEndingWith("Exception")
        .and().areNotInterfaces()
        .should().resideInAPackage("..exception..")
        .as("r16: *Exception classes must reside in ..exception.. packages");
```

**목적**: Exception 클래스를 패키지 한 곳에 모아 검색과 관리를 쉽게. 예외 계층이 분산되면 "이 예외가 어떤 도메인 거지?" 가 모호해집니다.

##### r18 — DTO 는 record (또는 sealed interface)

```java
public static final ArchRule DTOS_MUST_BE_RECORDS =
    classes()
        .that().resideInAPackage("..dto..")
        .should(beRecordOrSealedInterface())
        .as("r18: classes in ..dto.. packages must be records (or sealed interfaces)");
```

**목적**: Java 14+ 의 `record` 는 불변성 + 자동 `equals`/`hashCode`/`toString` + 짧은 선언. DTO 에 완벽.

```java
// r18 통과
public record AuthResponse(long userId, String accessToken, String refreshToken) {}

// r18 위반 — 일반 class
public class AuthResponse {
    private long userId;
    // ...
}
```

##### r19 — DTO 네이밍 접미사

```java
public static final ArchRule DTO_NAMING_SUFFIX =
    classes()
        .that().resideInAPackage("..dto..")
        .and().areRecords()
        .should(haveOneOfSuffixes(
            "Request", "Response", "Dto",
            "Summary", "Profile", "Account",
            "Tokens", "Message", "Result", "Status"
        ))
        .as("r19: DTO record names must end with one of the allowed suffixes");
```

**목적**: DTO 이름이 제각각이면 (`UserData`, `AuthInfo`, `TokenBundle` 등) **용도 파악이 어려워** 집니다. 접미사를 제한해서 이름만 보면 용도가 즉시 이해되게. **이름이 곧 문서** 가 되는 규칙.

##### r20 — `@Deprecated` 는 `since` + `forRemoval` 속성 필수

```java
public static final ArchRule DEPRECATED_MUST_DECLARE_SINCE_AND_FOR_REMOVAL =
    members()
        .that().areAnnotatedWith(Deprecated.class)
        .should(haveDeprecatedWithSinceAndForRemoval())
        .as("r20: @Deprecated must declare since and forRemoval");
```

**목적**: [ADR-002](./adr-002-use-this-template.md) 의 **Deprecation 유예 기간** 을 실천하는 규칙. 단순히 `@Deprecated` 만 붙이면 "언제부터? 언제 제거?" 가 모호. `@Deprecated(since = "0.4.0", forRemoval = true)` 처럼 명시하면 파생 레포가 "내가 지금 v0.3.0 기반인데 이 API 는 v0.4.0 부터 deprecated 니까 아직 사용 가능" 판단 가능.

##### r22 — `*Mapper` 클래스 금지

```java
public static final ArchRule NO_MAPPER_CLASSES =
    noClasses()
        .that().haveSimpleNameEndingWith("Mapper")
        .and().areNotInterfaces()
        .should().bePublic()
        .as("r22: *Mapper classes (non-interface) are forbidden — use Entity to<Dto>() methods instead");
```

**목적**: DTO 변환을 별도 `*Mapper` 클래스로 만들지 말고 **Entity 의 `to<Dto>()` 메서드** 로 하라는 강제. 상세는 ADR-016 에서 다룹니다.

## Counter-example — DSL 타이밍을 잘못 설계하면?

가상 시나리오로 `afterEvaluate` 선택의 이유를 체험해봅시다.

만약 DSL 을 **`beforeEvaluate`** 에서 실행한다고 가정하면:

```groovy
// 가상: beforeEvaluate 로 잘못 설계한 경우
project.beforeEvaluate { p ->
    p.configurations.findAll { ... }.each { ... }
}
```

이때:
- `beforeEvaluate` 는 `build.gradle` 평가 **시작 전**
- `configurations` 블록이 아직 평가되지 않음 → **빈 컬렉션**
- → 어떤 의존도 검증 안 됨, 규칙 무효화

CI 는 녹색인데 실제로는 규칙 위반이 main 까지 올라갑니다.

반대로 **Task 실행 중** 검증하면:
- 컴파일이 이미 시작됨 — 실패 시 캐시 혼란
- 병렬 빌드에서 다른 Task 들이 이미 돌아가고 있을 수도

**`afterEvaluate` 만이** "선언은 확정, 실행은 미시작" 이라는 타이밍을 제공해요.

## 이 선택이 가져온 것

### 긍정적 결과

**컨벤션의 사람 의존성 제거** — "규칙 지켜주세요" 가 필요 없음. 규칙 어기면 빌드가 알아서 막습니다.

**규칙 canonical 위치 단일화** — `DependencyRules.groovy` (1 파일) + `ArchitectureRules.java` (1 파일) 두 곳만 보면 **모든 아키텍처 규칙** 확인 가능.

**규칙이 데이터화됨** — `ArchitectureRules.java` 의 22개 `public static final ArchRule` 은 **다른 테스트에서 재사용** 가능. 규칙이 "lint 설정" 이 아니라 **Java 오브젝트** 로 존재.

**확장성** — 새 규칙은 한 줄 추가로 끝.

### 부정적 결과

**러닝 커브** — DSL + Gradle lifecycle + ArchUnit 문법 세 가지를 이해해야 완전 파악. 완화: 단순해서 건드릴 일 거의 없음.

**ArchUnit 은 bootstrap 테스트에만 의존** — r1~r22 의 실제 스캔은 `BootstrapArchitectureTest` 에서만 완전히 작동. 개별 모듈 테스트에서는 자기 classpath 안의 클래스만 보여서 일부 규칙은 vacuously true. 완화: CI 에서 반드시 `./gradlew :bootstrap:test` 실행.

## 교훈

**2026 초 — `testImplementation` 예외 도입 사건**.

초기 DSL 설계는 **모든 configuration** 을 검증했어요. 문제 발생: `core-auth-impl` 의 `RefreshTokenRepositoryTest` 가 실행되려면 `users` 테이블이 필요 (FK 제약). `users` 테이블은 `core-user-impl` 의 V001 Flyway 마이그레이션이 생성. 따라서 `testImplementation project(':core:core-user-impl')` 필수. 하지만 DSL 은 이를 **`core-impl` 끼리 참조 금지** 위반으로 판단 → 빌드 실패.

두 선택지:
- **(a) 테스트용 마이그레이션 파일을 복사** — 의존 없지만 **드리프트 위험**.
- **(b) DSL 이 test configuration 은 예외로 스킵** — 프로덕션 경계는 유지, 테스트는 실용 우선.

(b) 가 채택됨.

**교훈**: 기계 강제의 엄격함은 **실무 필요** 에 의해 미세 조정되어야 합니다.

### 또 하나의 교훈 — 규칙을 "번호로" 식별하는 것의 가치

ArchUnit 규칙은 `r1`, `r2`, ..., `r22` 처럼 **번호로** 참조합니다.

- 빌드 실패 시: "`r11 violation: AuthPort.signIn() returns User`" 처럼 **번호가 에러 메시지에 등장** → 번호로 검색해서 어떤 규칙인지 즉시 파악.
- ADR 작성 시: "r9 는 extraction-critical 이고..." 처럼 번호가 **구분자** 역할.

## 관련 사례 (Prior Art)

- **[ESLint `no-restricted-imports`](https://eslint.org/docs/latest/rules/no-restricted-imports)** — JS 생태계에서 비슷한 목적.
- **[Dependency Cruiser](https://github.com/sverweij/dependency-cruiser)** — Node.js 모듈 의존 검증.
- **[Nx Tags & Boundaries](https://nx.dev/concepts/more-concepts/enforce-project-boundaries)** — Nx monorepo.
- **Rust 의 module visibility (`pub`, `pub(crate)`, `pub(super)`)** — 언어 레벨 강제.
- **[Checkstyle](https://checkstyle.sourceforge.io/) / [PMD](https://pmd.github.io/) / [SpotBugs](https://spotbugs.github.io/)** — Java 전통 lint.

## Code References

**DSL 구현 & 사용**:
- [`DependencyRules.groovy`](https://github.com/storkspear/spring-backend-template/blob/main/build-logic/src/main/groovy/com/factory/DependencyRules.groovy)
- [`factory.common-module.gradle`](https://github.com/storkspear/spring-backend-template/blob/main/build-logic/src/main/groovy/factory.common-module.gradle)
- [`factory.core-api-module.gradle`](https://github.com/storkspear/spring-backend-template/blob/main/build-logic/src/main/groovy/factory.core-api-module.gradle)
- [`factory.core-impl-module.gradle`](https://github.com/storkspear/spring-backend-template/blob/main/build-logic/src/main/groovy/factory.core-impl-module.gradle)
- [`factory.app-module.gradle`](https://github.com/storkspear/spring-backend-template/blob/main/build-logic/src/main/groovy/factory.app-module.gradle)

**ArchUnit 규칙 canonical**:
- [`ArchitectureRules.java`](https://github.com/storkspear/spring-backend-template/blob/main/common/common-testing/src/main/java/com/factory/common/testing/architecture/ArchitectureRules.java)
- [`BootstrapArchitectureTest.java`](https://github.com/storkspear/spring-backend-template/blob/main/bootstrap/src/test/java/com/factory/bootstrap/BootstrapArchitectureTest.java)

**관련 스펙 문서**:
- [`docs/conventions/module-dependencies.md`](https://github.com/storkspear/spring-backend-template/blob/main/docs/conventions/module-dependencies.md)
- [`docs/testing/contract-testing.md`](https://github.com/storkspear/spring-backend-template/blob/main/docs/testing/contract-testing.md)

