# 모듈 의존 규칙 (Module Dependencies)

이 문서는 `spring-backend-template` 의 **모듈 간 의존 허용 매트릭스** 와 강제 메커니즘을 정의합니다.

---

## 의존 허용 매트릭스

| From ↓ \ To → | common-* | core-*-api | core-*-impl | apps/* | bootstrap |
|---|:---:|:---:|:---:|:---:|:---:|
| **common-*** | ✓ (자기 레이어 내) | ✗ | ✗ | ✗ | ✗ |
| **core-*-api** | ✓ | ✓ (다른 api) | ✗ | ✗ | ✗ |
| **core-*-impl** | ✓ | ✓ (자기 api + 다른 api) | ✗ (자기 외) | ✗ | ✗ |
| **apps/*** | ✓ | ✓ | ✗ | ✗ (다른 apps) | ✗ |
| **bootstrap** | ✓ | ✓ | ✓ | ✓ | — |

**Test 구성 예외**: `core-*-impl` 의 `testImplementation` 은 다른 `core-*-impl` 참조 가능 (Flyway migration 등 test 인프라 조립용). main 규칙만 강제.

---

## 공통 모듈 역할 요약

| 모듈 | 역할 |
|---|---|
| `common-logging` | MDC 필터, logback 포맷, 로깅 autoconfiguration |
| `common-web` | ApiResponse / ApiError, GlobalExceptionHandler, 예외 계층, pagination + search DTO (QueryDsl 비의존) |
| `common-security` | JWT (HS256), Spring Security stateless, @CurrentUser, AppSlugVerificationFilter |
| `common-persistence` | DataSource + JPA + QueryDsl + BaseEntity 를 포괄하는 persistence infrastructure 모듈. `AbstractAppDataSourceConfig` 로 앱별 DataSource / EMF / TransactionManager / Flyway 빈 wiring 지원 (Item 10b). QueryDsl 동적 쿼리 (`QueryDslPredicateBuilder`, `QueryDslSortBuilder`, `QueryUtil`) + `BaseEntity` (id, createdAt, updatedAt, audit 콜백) 도 제공. |
| `common-testing` | Testcontainers Postgres, AbstractIntegrationTest, ArchUnit 규칙 |

---

## 강제 메커니즘 — 2중 방어

### 1차: Gradle Convention Plugin (configuration 단계)

`build-logic/` 에 역할별 plugin 정의. 각 모듈 `build.gradle` 은 해당 plugin 한 줄만 선언.

| 역할 | Plugin | 허용 의존 |
|---|---|---|
| common-* | `factory.common-module` | `:common:*` 만 |
| core-*-api | `factory.core-api-module` | `:common:*`, `:core:core-*-api` |
| core-*-impl | `factory.core-impl-module` | `:common:*`, `:core:core-*-api` (다른 impl 명시 금지) |
| apps/* | `factory.app-module` | `:common:*`, `:core:core-*-api` (impl/다른 apps 명시 금지) |
| bootstrap | `factory.bootstrap-module` | 모든 의존 허용 |

**검증 시점**: Gradle configuration 단계. 위반 시 `GradleException` throw — 컴파일도 시작 안 함.

**검증 범위**: main 구성 (api, implementation, compileOnly, runtimeOnly). test/testFixtures 구성은 제외.

### 2차: ArchUnit (CI 테스트 단계)

`common-testing/src/main/java/.../architecture/ArchitectureRules.java` 에 canonical 정의 (22개 규칙, r1~r22). `BootstrapArchitectureTest` 가 전체 classpath 스캔. 전체 목록은 [architecture-rules.md](./architecture-rules.md) 참고.

---

## ArchUnit 규칙 전체 목록

| # | 규칙 | 검증 |
|---|---|---|
| 1 | `apps/*` → `core-*-impl` 금지 | Gradle 2중 방어 |
| 2 | `apps/*` ↔ `apps/*` 금지 | 앱 간 격리 |
| 3 | `core-*-impl` ↔ `core-*-impl` 금지 | impl 격리 |
| 4 | `common-*` → `core-*` 금지 | 상위 방향 차단 |
| 5 | `common-*` → `apps/*` 금지 | 상위 방향 차단 |
| 6 | `core-*-api` → `core-*-impl` 금지 | api 순수성 |
| 7 | `core-*-api` → `apps/*` 금지 | 상위 방향 |
| 8 | `core-*-impl` → `apps/*` 금지 | 상위 방향 |
| 9 | `core-*-api` → JPA/Hibernate 의존 금지 | **extraction-critical** — api 를 HTTP 어댑터로 교체 가능하게 |
| 10 | `core-*-api` 에 `@Entity`/`@Table`/`@Repository` 사용 금지 | api 에 JPA 오염 방지 |
| 11 | Port 메서드 시그니처에 Entity 등장 금지 | **Port 계약 개념의 전제** |
| 12 | (유보) | 단일 모듈 내 api/impl 분할 시 재평가 |
| 13 | Spring stereotype (`@Service`/`@Component`/`@Repository`/`@Controller`/`@RestController`) 은 impl/apps/bootstrap 에만 | api 에 Spring bean 오염 방지 |

---

## 모듈 build.gradle 작성 가이드

### common-* 모듈 (예: common-logging)

```groovy
plugins {
    id 'factory.common-module'
}

dependencies {
    // 고유 의존만 작성. factory.common-module 이 java-library + 검증 자동 처리.
    compileOnly 'org.springframework.boot:spring-boot-autoconfigure'
    implementation 'net.logstash.logback:logstash-logback-encoder:8.0'
}
```

### core-*-api 모듈 (예: core-user-api)

```groovy
plugins {
    id 'factory.core-api-module'
}

dependencies {
    api project(':common:common-web')
    // jakarta.validation-api, spring-boot-starter-test, common-testing 은 plugin 제공
}
```

### core-*-impl 모듈 (예: core-user-impl)

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

    // test 전용 cross-impl 의존은 허용됨 (Item 2 스펙 예외)
    testImplementation testFixtures(project(':core:core-user-api'))
    testImplementation 'org.springframework.boot:spring-boot-starter-data-jpa'
    testImplementation 'org.springframework.boot:spring-boot-starter-web'
    testImplementation 'org.springframework.boot:spring-boot-starter-security'
    testImplementation 'org.springframework.boot:spring-boot-starter-validation'
}
```

### apps/* 모듈 (예: apps/app-sumtally, 파생 레포에서 생성)

```groovy
plugins {
    id 'factory.app-module'
}

dependencies {
    api project(':common:common-security')
    api project(':core:core-auth-api')
    api project(':core:core-user-api')
    // core-*-impl 참조 시 configuration 실패
}
```

### bootstrap 모듈

```groovy
plugins {
    id 'factory.bootstrap-module'
}

dependencies {
    implementation project(':common:common-*')
    implementation project(':core:core-*-impl')
    // 모든 의존 허용 — ArchUnit 이 보조 방어
}
```

---

## 위반 시 에러 메시지 해석

**Gradle 단계 (configuration)**:
```
[factory] Dependency rule violation
  module : :apps:app-sumtally
  config : implementation
  depends: :core:core-auth-impl
  reason : forbidden pattern
See docs/architecture/module-dependencies.md
```

→ 해결: `project(':core:core-auth-impl')` 을 `project(':core:core-auth-api')` 로 교체.

**ArchUnit 단계**:
```
Rule 'r9: core-*-api must not depend on JPA/Hibernate' was violated (1 time):
  Class <com.factory.core.auth.api.SomeDto> depends on class
  <jakarta.persistence.Entity> in (SomeDto.java:0)
```

→ 해결: api DTO 에서 JPA 어노테이션/타입 제거. Entity → DTO 변환은 impl 의 Mapper 가 담당 (Item 4 결정 참조).

---

## 규칙을 우회하고 싶을 때

**답: 우회하지 말고 논의하세요.** 예외가 정말 필요하면 plugin (build-logic) 또는 ArchitectureRules 자체를 수정. 개별 `@ArchIgnore` 나 `// @SuppressWarnings` 로 숨기지 않음.

이유: 규칙을 우회하는 순간 5중 방어선의 "기계적 강제" 가 무너지고, 3개월 뒤엔 예외가 30개가 됩니다.

---

## 관련 문서

- [ADR-003 · -api / -impl 분리](../philosophy/adr-003-api-impl-split.md)
- [ADR-004 · Gradle + ArchUnit](../philosophy/adr-004-gradle-archunit.md)
- [ADR-014 · Delegation mock 금지](../philosophy/adr-014-no-delegation-mock.md)
- [Architecture Reference](./architecture.md) — "의존 규칙" 및 6중 방어선
- [계약 테스트 (Contract Testing)](../production/test/contract-testing.md) — Port 계약 테스트
