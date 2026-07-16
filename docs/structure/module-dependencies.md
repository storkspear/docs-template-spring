# 모듈 의존 규칙 (Module Dependencies)

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~10분

## 개요

이 문서는 `template-spring` 의 모듈 간 의존 허용 매트릭스와, 그 규칙을 어떻게 기계적으로 강제하는지를 정리해요. 새 모듈의 `build.gradle` 을 쓰거나 의존 위반 에러를 만났을 때 찾아보는 참조 문서입니다.

전체 의존 방향은 한 줄로 요약돼요. 아래쪽 레이어가 위쪽을 모르고, 위쪽만 아래쪽을 압니다.

```text
common  →  core  →  apps  →  bootstrap
(인프라)   (도메인)   (서비스)   (조립)
```

---

## 의존 허용 매트릭스

각 행은 "이 모듈이" 열의 모듈을 의존할 수 있는지를 나타냅니다.

| From ↓ \ To → | common-* | core-*-api | core-*-impl | apps/* | bootstrap |
|---|:---:|:---:|:---:|:---:|:---:|
| **common-*** | ✓ | ✗ | ✗ | ✗ | ✗ |
| **core-*-api** | ✓ | ✓ | ✗ | ✗ | ✗ |
| **core-*-impl** | ✓ | ✓ | ✗ | ✗ | ✗ |
| **apps/*** | ✓ | ✓ | ✗ | ✗ | ✗ |
| **bootstrap** | ✓ | ✓ | ✓ | ✓ | — |

읽는 법을 몇 가지만 풀어 두면 이래요.

- `common-*` 끼리는 서로 의존할 수 있지만, 자기보다 위 레이어인 core 와 apps 는 절대 모릅니다.
- `core-*-api` 는 다른 `core-*-api` 를 의존할 수 있어요. 단 어떤 impl 도 보지 못합니다.
- `core-*-impl` 은 자기 짝 api 와 다른 api 까지 의존할 수 있지만, **다른 impl 은 보지 못합니다**. 도메인 격리의 핵심이에요.
- `apps/*` 는 core 의 api 까지만 의존하고, impl 과 다른 app 은 차단됩니다.
- `bootstrap` 만 모든 레이어를 의존합니다. 모든 모듈을 한 JAR 로 조립하는 자리라서 그래요.

**테스트 구성 예외** — `core-*-impl` 의 `testImplementation` 은 다른 `core-*-impl` 을 참조할 수 있습니다. Flyway 마이그레이션 등 테스트 인프라를 조립할 때 필요해서예요. 강제는 main 구성에만 적용됩니다.

---

## 공통 모듈 5종

`common/` 에는 도메인 로직이 없는 인프라 모듈 5개가 있습니다. 자신들끼리만 의존하고, 의존 방향은 단방향으로 흘러요.

| 모듈 | 역할 | 의존하는 common |
|---|---|---|
| `common-logging` | MDC 필터, logback 포맷, 로깅 자동 설정 | 없음 |
| `common-web` | `ApiResponse`·`ApiError`·`GlobalExceptionHandler`, 예외 계층, pagination·search DTO | 없음 |
| `common-persistence` | DataSource·JPA·QueryDsl·BaseEntity 를 묶은 persistence 인프라 | `common-web` |
| `common-security` | JWT(HS256), stateless Spring Security, `@CurrentUser`, `AppSlugVerificationFilter` | `common-web`, `common-persistence` |
| `common-testing` | Testcontainers Postgres, `AbstractIntegrationTest`, ArchUnit 규칙 | 없음 |

`common-persistence` 에 대해 한 가지만 덧붙이면, 이 모듈이 `AbstractAppDataSourceConfig` 로 앱별 DataSource·EMF·TransactionManager·Flyway 빈 wiring 을 지원해요. [QueryDsl](../reference/glossary.md#데이터베이스) 동적 쿼리 빌더(`QueryDslPredicateBuilder`, `QueryDslSortBuilder`, `QueryUtil`)와 `BaseEntity`(id·생성/수정 시각·audit 콜백)도 여기서 제공합니다.

핵심 의존 방향은 `common-web → common-persistence → common-security` 로 한 줄로 흘러요. `common-logging` 과 `common-testing` 은 다른 common 에 의존하지 않는 독립 모듈입니다.

---

## core 모듈 16도메인 · 31모듈

`core/` 에는 16개 도메인, 총 31개 모듈이 들어 있어요. 15개 도메인은 각각 `-api` / `-impl` 한 쌍이고, `admin` 만 `-impl` 단독입니다 (콘솔 컨트롤러가 다른 도메인의 Port 를 소비할 뿐 자기 Port 를 노출하지 않아서예요). api 는 [Port](../reference/glossary.md#아키텍처-용어) 인터페이스와 DTO 만 담고, impl 이 그 구현과 [JPA](../reference/glossary.md#데이터베이스) 엔티티를 담습니다. 분리 근거는 [ADR-003](../philosophy/adr-003-api-impl-split.md) 에 있어요.

16개 도메인은 `auth`, `user`, `device`, `push`, `billing`, `iap`, `payment`, `storage`, `email`, `sms`, `phone-auth`, `audit`, `admin`, `analytics`, `attachment`, `content` 입니다.

한 impl 은 자기 짝 api 를 구현하면서, 필요하면 다른 도메인의 api 도 의존해요. 예를 들어 `core-auth-impl` 은 `core-auth-api` 외에 `core-user-api`·`core-email-api` 까지 의존합니다. 인증이 유저 조회와 메일 발송을 [Port](../reference/glossary.md#아키텍처-용어) 로 호출하기 때문이에요. 반대로 다른 impl 을 직접 의존하는 건 빌드 시점에 막힙니다.

---

## 강제 메커니즘 — 2중 방어

같은 규칙을 두 단계에서 검사합니다. 먼저 Gradle 이 빌드 구성 시점에 막고, 그래도 새어 나가면 ArchUnit 이 CI 테스트 단계에서 잡아요.

### 1차 — Gradle Convention Plugin

`build-logic/` 에 역할별 plugin 이 정의돼 있습니다. 각 모듈의 `build.gradle` 은 해당 plugin 한 줄만 선언하면 돼요.

| 역할 | Plugin | 허용 의존 |
|---|---|---|
| common-* | `factory.common-module` | `:common:*` 만 |
| core-*-api | `factory.core-api-module` | `:common:*`, `:core:core-*-api` |
| core-*-impl | `factory.core-impl-module` | `:common:*`, `:core:core-*-api` (다른 impl 금지) |
| apps/* | `factory.app-module` | `:common:*`, `:core:core-*-api` (impl·다른 apps 금지) |
| bootstrap | `factory.bootstrap-module` | 모든 의존 허용 |

검증은 Gradle configuration 단계(`afterEvaluate`)에서 돕니다. 위반하면 `GradleException` 을 던져서 컴파일조차 시작하지 않아요. 검사 대상은 main 구성(`api`·`implementation`·`compileOnly`·`runtimeOnly`)이고, `test`·`testFixtures` 구성은 제외됩니다.

검증 로직 자체는 `DependencyRules.groovy` 에 한 군데로 모여 있어요. plugin 마다 허용·금지 패턴만 넘기는 구조라, 규칙을 바꾸려면 이 파일을 고칩니다.

### 2차 — ArchUnit

`common-testing/src/main/java/.../architecture/ArchitectureRules.java` 에 22개 규칙(r1~r22)의 canonical 정의가 있습니다. `bootstrap` 의 `BootstrapArchitectureTest` 가 `com.factory` 전체 classpath 를 스캔해서 이 규칙들을 한 번에 검증해요. 규칙 전체 목록과 설명은 [`architecture-rules.md`](./architecture-rules.md) 를 참고하세요.

이 문서가 다루는 의존 방향은 r1~r8 이 직접 강제합니다. 아래는 그 8개만 추린 표예요.

| # | 규칙 |
|---|---|
| r1 | `apps/*` → `core-*-impl` 금지 |
| r2 | `apps/*` 끼리 의존 금지 |
| r3 | `core-*-impl` 끼리 의존 금지 |
| r4 | `common-*` → `core-*` 금지 |
| r5 | `common-*` → `apps/*` 금지 |
| r6 | `core-*-api` → `core-*-impl` 금지 |
| r7 | `core-*-api` → `apps/*` 금지 |
| r8 | `core-*-impl` → `apps/*` 금지 |

나머지 r9~r22 는 JPA 누출 방지, Spring stereotype 위치, DTO record 강제 같은 코드 구조 규칙이라 [`architecture-rules.md`](./architecture-rules.md) 에서 따로 다뤄요.

---

## 모듈 build.gradle 작성 가이드

새 모듈을 만들 때는 plugin 한 줄을 선언하고, 그 위에 고유 의존만 얹으면 됩니다. plugin 이 java-library 설정과 의존 검증을 자동으로 처리해요.

### common-* 모듈

```groovy
plugins {
    id 'factory.common-module'
}

dependencies {
    // 고유 의존만 작성. java-library 와 검증은 plugin 이 처리.
    compileOnly 'org.springframework.boot:spring-boot-autoconfigure'
    implementation 'net.logstash.logback:logstash-logback-encoder:8.0'
}
```

### core-*-api 모듈

```groovy
plugins {
    id 'factory.core-api-module'
}

dependencies {
    api project(':common:common-web')
    // jakarta.validation-api, spring-boot-starter-test, common-testing 은 plugin 제공
}
```

### core-*-impl 모듈

```groovy
plugins {
    id 'factory.core-impl-module'
}

dependencies {
    api project(':core:core-user-api')
    api project(':common:common-security')
    api project(':common:common-persistence')

    implementation 'org.flywaydb:flyway-core'
    runtimeOnly 'org.postgresql:postgresql'

    // 다른 impl 을 보는 test 전용 의존은 허용됨
    testImplementation testFixtures(project(':core:core-user-api'))
    testImplementation 'org.springframework.boot:spring-boot-starter-data-jpa'
    testImplementation 'org.springframework.boot:spring-boot-starter-web'
    testImplementation 'org.springframework.boot:spring-boot-starter-security'
    testImplementation 'org.springframework.boot:spring-boot-starter-validation'
}
```

### apps/* 모듈

apps 모듈은 템플릿에는 없고, 파생 레포에서 `new app` 으로 생성됩니다.

```groovy
plugins {
    id 'factory.app-module'
}

dependencies {
    api project(':common:common-security')
    api project(':core:core-auth-api')
    api project(':core:core-user-api')
    // core-*-impl 을 적으면 configuration 단계에서 실패
}
```

### bootstrap 모듈

```groovy
plugins {
    id 'factory.bootstrap-module'
}

dependencies {
    implementation project(':common:common-logging')
    implementation project(':core:core-user-impl')
    // 모든 의존 허용 — ArchUnit 이 보조 방어
}
```

---

## 위반 시 에러 메시지 해석

위반은 두 단계 중 한 곳에서 잡힙니다. 어느 쪽이든 메시지가 "어느 모듈이 무엇을 잘못 의존했는지" 를 그대로 알려줘요.

**Gradle configuration 단계**:

```text
[factory] Dependency rule violation
  module : :apps:app-sumtally
  config : implementation
  depends: :core:core-auth-impl
  reason : forbidden pattern
See docs/conventions/module-dependencies.md
```

`reason` 은 두 가지로 나뉘어요. 금지 패턴에 걸리면 `forbidden pattern`, 허용 목록에 없으면 `not in allowlist` 입니다. 마지막 줄이 가리키는 실제 문서는 지금 보고 있는 이 파일(`docs/structure/module-dependencies.md`)이에요.

해결은 `project(':core:core-auth-impl')` 을 `project(':core:core-auth-api')` 로 바꾸는 거예요. 앱은 impl 의 내부 구현이 아니라 api 의 [Port](../reference/glossary.md#아키텍처-용어) 계약만 알아야 합니다.

**ArchUnit 단계**:

```text
Rule 'r9: core-*-api must not depend on JPA/Hibernate' was violated (1 time):
  Class <com.factory.core.auth.api.SomeDto> depends on class
  <jakarta.persistence.Entity> in (SomeDto.java:0)
```

해결은 api 의 DTO 에서 JPA 어노테이션과 타입을 빼는 거예요. 엔티티에서 DTO 로의 변환은 impl 이 담당합니다([ADR-014](../philosophy/adr-014-no-delegation-mock.md) 의 결정 참조).

---

## 규칙을 우회하고 싶을 때

답은 하나예요. 우회하지 말고 논의하세요.

예외가 정말 필요하면 개별 `@ArchIgnore` 나 `// @SuppressWarnings` 로 숨기지 말고, plugin(`build-logic`)이나 `ArchitectureRules` 자체를 고칩니다. 규칙을 우회하는 순간 6중 방어선의 "기계적 강제" 가 무너지고, 3개월 뒤에는 예외가 30개로 불어나요.

---

## 관련 문서

- [ADR-003 · -api / -impl 분리](../philosophy/adr-003-api-impl-split.md) — 모듈을 api 와 impl 로 가른 결정
- [ADR-004 · Gradle + ArchUnit](../philosophy/adr-004-gradle-archunit.md) — 2중 방어를 택한 근거
- [ADR-014 · Delegation mock 금지](../philosophy/adr-014-no-delegation-mock.md) — Port 계약 테스트가 주력인 이유
- [Architecture Reference](./architecture.md) — 의존 규칙과 6중 방어선의 큰 그림
- [Architecture Rules (ArchUnit r1~r22)](./architecture-rules.md) — 22개 규칙 전체 명세
- [계약 테스트 (Contract Testing)](../production/test/contract-testing.md) — Port 계약 테스트
- [Multitenant Architecture](./multitenant-architecture.md) — schema 격리와 DataSource 설계
