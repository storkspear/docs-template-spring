# Architecture Rules (ArchUnit)

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~10분

**설계 근거**: [`ADR-004 · Gradle 모듈 경계 + ArchUnit`](../philosophy/adr-004-gradle-archunit.md)

이 문서는 ArchUnit 으로 강제되는 모듈 경계와 코드 구조 규칙을 정리해요.

---

## 개요

ArchUnit 으로 강제되는 22 개 규칙 r1~r22 의 전체 목록이에요. 각 규칙의 내용과 위반 예시, 규칙 정의 위치, 새 규칙 추가 절차, 테스트 실행 방법까지 담아요. 규칙 자체의 도입 배경은 [`ADR-004`](../philosophy/adr-004-gradle-archunit.md) 에 있고, 여기서는 규칙 목록을 빠르게 찾는 데 집중해요.

> r12 는 현재 비어 있는 예약 번호예요. 활성 규칙은 21 개고, 번호 체계는 r22 까지 이어져요. 자세한 사유는 [r12 항목](#r12-예약-번호) 을 참고하세요.

---

## 1. 왜 ArchUnit 인가

모듈 의존 방향, DTO 구조, Entity 위치 같은 구조적 결정을 문서로만 관리하면 몇 주 안에 어긋납니다. 리뷰에서 매번 잡아내는 것은 비효율적이고, 사람이 개입해야 지켜지는 규칙은 결국 깨집니다.

ArchUnit 은 이런 규칙을 JUnit 테스트로 강제합니다. 규칙 위반이 있으면 CI 빌드가 실패하므로 규칙이 자동으로 지켜져요. 규칙이 실제 구조와 어긋나면 테스트가 깨지면서 리팩터링의 진입점 역할을 합니다.

### 목적

- **경계 강제** — `common` 은 `core` 에 의존할 수 없고, `apps` 는 `core-*-impl` 에 의존할 수 없습니다.
- **추출 안전성** — `core-*-api` 는 JPA 에 의존하지 않아 다른 저장소 구현체로 교체하거나 별도 서비스로 떼어낼 수 있습니다.
- **리팩터링 안전망** — 패키지를 옮기다 경계를 깨면 즉시 알려줘요.
- **네이밍 강제** — `*Port` 인터페이스는 `api`, `*ServiceImpl` 은 `impl` 패키지에만 존재합니다.

---

## 2. 규칙 정의 위치

규칙의 canonical 정의는 한 곳뿐이에요.

```text
common/common-testing/src/main/java/com/factory/common/testing/architecture/ArchitectureRules.java
```

각 규칙을 `public static final ArchRule` 로 선언하고, 두 테스트 클래스가 이를 참조만 합니다.

```text
common/common-testing/src/test/java/.../architecture/ArchitectureTest.java
    └─ common-testing 의 test classpath 기준 — 대부분 vacuously true

bootstrap/src/test/java/.../BootstrapArchitectureTest.java
    └─ bootstrap 의 test classpath 는 전체 모듈을 포함 — 여기서 실제로 검증돼요
```

`BootstrapArchitectureTest` 가 `@AnalyzeClasses("com.factory")` 로 common · core · apps · bootstrap 전 모듈을 스캔하므로 실제 검증을 담당합니다. `ArchitectureTest` 는 common-testing 자체를 변경할 때 문법 오류를 빠르게 잡는 용도예요.

### 규칙 분류

| 번호 | 분류 | 목적 |
|---|---|---|
| r1~r5 | 레이어 기본 | common·core·apps 기본 의존 방향 |
| r6~r8 | 레이어 보강 | core-api·core-impl 분리, 상위 방향 차단 |
| r9~r11 | JPA 누출 방지 | core-api 는 JPA 독립 |
| r12 | 예약 | 현 구조에서 vacuous |
| r13 | Spring stereotype 위치 | `@Service` 등은 impl·apps·bootstrap 에만 |
| r14~r17 | 네이밍 기반 위치 | Port · ServiceImpl · Exception · Repository |
| r18~r19 | DTO 구조 | record 와 허용된 suffix |
| r20 | `@Deprecated` 메타 | since 와 forRemoval 강제 |
| r21 | Entity 위치 | `@Entity` 는 entity 패키지에만 |
| r22 | Mapper 금지 | Entity 의 `to<Dto>()` 패턴 유도 |

---

## 3. 규칙 전체 목록

### r1: APPS_MUST_NOT_DEPEND_ON_CORE_IMPL

**내용** — `..apps..` 패키지의 클래스는 `..core..impl..` 패키지에 의존할 수 없습니다.

**목적** — 앱은 core 의 Port 인터페이스만 사용하고 구현체 내부에 커플링되지 않습니다. 덕분에 core repository 의 내부 변경이 앱에 영향을 주지 않아요.

**위반 예시** — `apps.sumtally.SomeService` 가 `core.auth.impl.service.EmailAuthService` 를 import 하는 경우.

### r2: APPS_MUST_NOT_DEPEND_ON_EACH_OTHER

**내용** — `com.factory.apps.<a>` 와 `com.factory.apps.<b>` 는 서로 의존할 수 없습니다. ArchUnit slices 로 검사해요.

**목적** — 각 앱 모듈을 독립적으로 유지합니다. 그래야 한 앱을 파생 레포로 추출할 때 다른 앱 코드를 함께 가져갈 필요가 없어요.

**위반 예시** — `apps.sumtally.something` 이 `apps.gymlog.other` 를 사용하는 경우.

### r3: CORE_IMPL_MUST_NOT_DEPEND_ON_EACH_OTHER

**내용** — `com.factory.core.<a>.impl..` 과 `com.factory.core.<b>.impl..` 은 서로 의존할 수 없습니다. ArchUnit slices 로 검사해요.

**목적** — core-*-impl 간 직접 의존을 금지해서 impl 을 독립적으로 교체할 수 있게 유지합니다. 다른 도메인이 필요하면 반드시 그 도메인의 `*Port` 인터페이스만 참조합니다.

**위반 예시** — `core.auth.impl.service.AuthServiceImpl` 이 Port 가 아니라 `core.user.impl.service.UserServiceImpl` 을 직접 의존하는 경우.

### r4: COMMON_MUST_NOT_DEPEND_ON_CORE

**내용** — `com.factory.common..` 은 `com.factory.core..` 에 의존할 수 없습니다.

**목적** — common 은 도메인 독립적인 인프라 유틸이에요. 도메인 지식이 common 으로 새어들면 재사용성을 잃습니다.

**위반 예시** — `common.web.SomeHelper` 가 `core.user.api.UserPort` 를 import 하는 경우.

### r5: COMMON_MUST_NOT_DEPEND_ON_APPS

**내용** — `com.factory.common..` 은 `com.factory.apps..` 에 의존할 수 없습니다.

**목적** — common 은 모든 레이어의 최하단이에요. 상위 레이어를 참조하면 의존 순환이 생깁니다.

**위반 예시** — `common.logging.LogContext` 가 `apps.sumtally.Something` 을 import 하는 경우.

### r6: CORE_API_MUST_NOT_DEPEND_ON_CORE_IMPL

**내용** — `core.<module>.api..` 는 `core.<module>.impl..` 에 의존할 수 없습니다.

**목적** — api 모듈은 계약만 담고 구현에 무지해야 합니다. 이 규칙이 깨지면 api 만 쓰려는 소비자가 impl 을 강제로 끌어오게 돼요.

**위반 예시** — `core.auth.api.AuthPort` 가 `core.auth.impl.service.EmailAuthService` 를 return type 에 노출하는 경우.

### r7: CORE_API_MUST_NOT_DEPEND_ON_APPS

**내용** — `core.<module>.api..` 는 `apps..` 에 의존할 수 없습니다. 상위 방향을 차단해요.

**목적** — 의존 방향은 항상 apps → core 입니다. 반대 방향이 생기면 순환이 되어 모듈을 독립적으로 빌드할 수 없게 돼요.

**위반 예시** — `core.user.api.UserPort` 가 `apps.sumtally.SomeClass` 를 파라미터로 받는 경우.

### r8: CORE_IMPL_MUST_NOT_DEPEND_ON_APPS

**내용** — `core.<module>.impl..` 는 `apps..` 에 의존할 수 없습니다. r7 과 같은 상위 방향 차단이에요.

**목적** — core 는 어떤 앱이 자기를 쓰는지 알 필요가 없습니다. 알게 되면 의존 방향이 뒤집혀요.

**위반 예시** — `core.auth.impl.service.AuthServiceImpl` 이 `apps.sumtally.SumtallySomeClass` 를 import 하는 경우.

### r9: CORE_API_MUST_NOT_DEPEND_ON_JPA

**내용** — `core.<module>.api..` 는 `jakarta.persistence..`, `org.hibernate..`, `org.springframework.data.jpa..`, `org.springframework.data.repository..` 에 의존할 수 없습니다.

**목적** — 추출 가능성의 핵심이에요. core-api 가 JPA 에 오염되면 다른 저장소 구현으로 교체하거나 api 만 떼어 별도 서비스로 추출하기 어려워집니다.

**위반 예시** — `core.user.api.UserPort` 가 `org.springframework.data.jpa.repository.JpaRepository` 를 extend 하는 경우.

### r10: CORE_API_MUST_NOT_USE_JPA_ANNOTATIONS

**내용** — `core.<module>.api..` 클래스는 `@Entity`, `@Table`, `@MappedSuperclass`, `@Embeddable`, `@Repository` 어노테이션을 사용할 수 없습니다.

**목적** — r9 의 어노테이션 버전이에요. DTO 라고 선언해놓고 실수로 `@Entity` 가 붙으면 api 가 Hibernate runtime 을 끌어오게 됩니다.

**위반 예시** — `core.user.api.dto.UserSummary` 에 `@Entity` 를 붙이는 경우.

### r11: PORT_METHODS_MUST_NOT_EXPOSE_ENTITIES

**내용** — `core.<module>.api..` 의 interface 메서드는 `..impl.entity..` 패키지 타입을 return type 이나 parameter 로 노출할 수 없습니다.

**목적** — Port 가 엔티티를 노출하면 소비자인 apps 가 엔티티의 lazy loading, proxy 같은 JPA 내부 세부사항에 엮입니다. DTO 로 경계를 끊어야 api·impl 분리 효과가 유지돼요.

**위반 예시** — `UserPort.findById(Long id)` 가 `core.user.impl.entity.User` 를 반환하는 경우.

### r12: 예약 번호

현재 구조에서 vacuous 한 예약 번호예요. 단일 모듈 안에서 api·impl 서브패키지 분할이 생기면 그때 재평가합니다. 활성 규칙이 아니라 `ArchitectureRules.java` 에 상수가 선언되어 있지 않고, 테스트 클래스에는 `// r12: reserved` 주석만 남아 있어요. [§4 의 번호 재사용 금지 원칙](#규칙-번호-재사용-금지) 에 따라 이 번호는 다른 규칙에 다시 쓰지 않습니다.

### r13: SPRING_BEANS_MUST_RESIDE_IN_IMPL_OR_APPS

**내용** — `@Service`, `@Component`, `@Repository`, `@Controller`, `@RestController` 어노테이션이 붙은 클래스는 `core.<module>.impl..`, `apps..`, `bootstrap..` 패키지에만 존재해야 합니다.

**목적** — api 모듈에 Spring 빈이 있으면 api 가 Spring 컨텍스트를 강제로 끌어와 테스트와 추출을 어렵게 만들어요. 빈은 구현 레이어에만 있어야 합니다.

**위반 예시** — `core.user.api` 에 `@Service` 가 붙은 클래스가 있는 경우.

### r14: PORT_INTERFACES_MUST_RESIDE_IN_API

**내용** — 이름이 `Port` 로 끝나는 (`com.factory..` 안의) interface 는 `core.<module>.api..` 패키지에만 존재해야 합니다.

**목적** — "Port 는 외부 노출 계약" 이라는 관례를 위치로 강제합니다. 네이밍만으로는 실수가 생기므로 패키지 위치까지 함께 묶어요.

**위반 예시** — `core.user.impl.SomePort` 인터페이스.

### r15: SERVICE_IMPL_MUST_RESIDE_IN_IMPL

**내용** — 이름이 `ServiceImpl` 로 끝나는 (`com.factory..` 안의) 클래스는 `core.<module>.impl..` 패키지에만 존재해야 합니다.

**목적** — 구현체 접미사의 위치를 강제합니다. api 에 `XxxServiceImpl` 이 있으면 구현 노출이 되어 r6 의 정신에 어긋나요.

**위반 예시** — `core.user.api.UserServiceImpl`.

### r16: EXCEPTIONS_MUST_RESIDE_IN_EXCEPTION_PACKAGE

**내용** — 이름이 `Exception` 으로 끝나는 클래스 (interface 제외) 는 `..exception..` 패키지에만 존재해야 합니다.

**목적** — 예외 클래스의 위치를 통일해 탐색성을 높여요. `core-user-api/.../exception/UserException.java` 처럼 모든 예외가 같은 서브패키지에 모입니다.

**위반 예시** — `core.auth.impl.service.SomeException`.

### r17: REPOSITORIES_MUST_RESIDE_IN_IMPL_REPOSITORY

**내용** — 이름이 `Repository` 로 끝나는 (`com.factory..` 안의) 클래스는 `..impl.repository..` 또는 `com.factory.apps..repository..` 패키지에만 존재해야 합니다.

**목적** — core 도메인은 api·impl 분리 구조라 repository 가 `..impl.repository..` 에 살아요. 반면 앱 모듈 (`apps.<slug>`) 은 그 분리가 없어 자체 도메인 repository 가 `apps.<slug>.repository` 에 사는데, 이는 `AbstractAppDataSourceConfig` 의 `@EnableJpaRepositories` 스캔 기본 위치예요. 두 위치는 허용하되 controller·dto 같은 비-데이터 패키지로 새는 것은 여전히 막습니다.

**위반 예시** — `core.user.api.UserRepository` (api 패키지에 노출).

### r18: DTOS_MUST_BE_RECORDS

**내용** — `..dto..` 패키지의 클래스는 record 이거나, 다형 DTO 인 경우 sealed interface 여야 합니다.

**목적** — DTO 는 불변 데이터 컨테이너예요. `class` 로 쓰면 setter, 상속, equals·hashCode 버그가 들어오기 쉽습니다. record 는 언어 차원에서 이를 보장해요.

**위반 예시** — `core.user.api.dto.UserSummary` 가 일반 `class` 인 경우.

### r19: DTO_NAMING_SUFFIX

**내용** — `..dto..` 패키지의 record 는 이름이 다음 13 개 suffix 중 하나로 끝나야 합니다: `Request`, `Response`, `Dto`, `Summary`, `Profile`, `Account`, `Tokens`, `Message`, `Result`, `Status`, `Event`, `Notification`, `Info`.

**목적** — DTO 네이밍을 통일하면 이름만 보고 용도 (입력·출력·뷰·결과) 를 구분할 수 있어요. 뒤쪽 세 suffix 는 도메인 확장과 함께 추가됐습니다.

| suffix | 추가 배경 |
|---|---|
| `Event` | [`ADR-028`](../philosophy/adr-028-audit-log-domain.md) — `AuditEvent` 등 도메인 이벤트 |
| `Notification` | [`ADR-022`](../philosophy/adr-022-iap-server-notifications.md) — `IapNotification` 등 외부 알림 |
| `Info` | [`ADR-030`](../philosophy/adr-030-2fa-totp.md) — `TotpInfo` 등 정보성 응답 |

핵심 view·입력 suffix (`Request`, `Summary`, `Profile`, `Account`, `Response`, `Tokens`, `Dto`) 의 용도 구분은 [`naming.md`](../convention/naming.md) 의 DTO 표에 정리돼 있어요. 허용 목록의 권위 있는 출처는 `ArchitectureRules.java` 의 `r19` 정의입니다.

**위반 예시** — `core.auth.api.dto.AuthData` (허용되지 않은 suffix).

### r20: DEPRECATED_MUST_DECLARE_SINCE_AND_FOR_REMOVAL

**내용** — `@Deprecated` 어노테이션이 붙은 멤버는 `since = "..."` 와 `forRemoval = ...` 속성을 반드시 지정해야 합니다.

**목적** — 언제 deprecated 됐는지, 제거 예정인지를 명시하게 해서 유지보수를 강제합니다. 빈 `@Deprecated` 는 소비자가 언제까지 유예가 있는지 알 수 없어요.

위반과 올바른 예시는 이렇게 나뉘어요.

```java
@Deprecated  // 속성 없음 — 위반
public void oldMethod() { ... }

@Deprecated(since = "1.3.0", forRemoval = true)  // 올바름
public void oldMethod() { ... }
```

[`versioning.md`](../api-and-functional/api/versioning.md) 의 Deprecation 절차와 연동됩니다.

### r21: ENTITIES_MUST_RESIDE_IN_IMPL_ENTITY

**내용** — `@jakarta.persistence.Entity` 어노테이션이 붙은 (`com.factory..` 안의) 클래스는 `..impl.entity..` 또는 `com.factory.apps..entity..` 패키지에만 존재해야 합니다.

**목적** — core 도메인의 `@Entity` 는 `..impl.entity..` 에, 앱 모듈 자체의 `@Entity` 는 `apps.<slug>.entity` 에 삽니다. 후자는 `AbstractAppDataSourceConfig` 의 `entityPackagesToScan` 기본값이에요. 엔티티가 api 패키지에 있으면 r9 (JPA 독립) 가 자동으로 깨지므로 위치를 함께 강제해요. controller·dto 로의 유출도 여전히 막습니다.

**위반 예시** — `core.user.api.User` 에 `@Entity` 가 붙은 경우.

### r22: NO_MAPPER_CLASSES

**내용** — 이름이 `Mapper` 로 끝나는 public 클래스 (interface 제외) 는 존재할 수 없습니다.

**목적** — `UserMapper.toDto(user)` 같은 별도 Mapper 클래스 대신 Entity 안에 `toDto()` 메서드를 두는 패턴을 강제합니다. Mapper 클래스는 Entity 와 DTO 양쪽을 알아야 해서 변경 추적이 흩어지고, 엔티티의 도메인 지식을 외부로 끄집어내요.

상세 배경은 [`dto-factory.md`](../convention/dto-factory.md) 를 참고하세요.

**위반 예시** — `core.user.impl.mapper.UserMapper` 클래스.

---

## 4. 새 규칙 추가 절차

새 규칙은 다음 순서로 추가해요.

1. **`ArchitectureRules.java` 에 상수 추가** — `public static final ArchRule` 로 선언합니다. 규칙 이름은 UPPER_SNAKE (예: `NEW_RULE_NAME`), `.as("rN: 설명")` 으로 번호와 설명을 지정하고, `.allowEmptyShould(true)` 로 위반 대상이 없는 시점에도 룰을 등록할 수 있게 합니다.

2. **두 테스트 클래스에 `@ArchTest` 필드 추가** — `common/common-testing/.../ArchitectureTest.java` 와 `bootstrap/.../BootstrapArchitectureTest.java` 에 같은 번호로 선언합니다.
   ```java
   @ArchTest static final ArchRule r23 = ArchitectureRules.NEW_RULE_NAME;
   ```

3. **이 문서의 목록에 규칙 추가** — `### rN: RULE_NAME` 형식의 항목을 더합니다.

4. **기존 위반 사례를 먼저 정리** — 규칙만 추가하고 위반을 두면 CI 가 빨간불이 됩니다.

### 규칙 번호 재사용 금지

r12 처럼 예약된 번호가 있지만, 한 번 쓰인 번호는 재사용하지 않습니다. 새 규칙은 항상 다음 번호를 써요. 히스토리 추적을 위함이에요.

---

## 5. 테스트 실행

### 전체 프로젝트 검증

```bash
./gradlew :bootstrap:test --tests BootstrapArchitectureTest
```

bootstrap 의 test classpath 가 common · core · apps · bootstrap 전 모듈을 포함하므로 실제 규칙 검증이 여기서 일어나요.

### 빠른 피드백 (common-testing 작업 시)

```bash
./gradlew :common:common-testing:test --tests ArchitectureTest
```

common-testing 의 test classpath 에는 자기 모듈 클래스만 있어 대부분 규칙이 vacuously true 로 통과합니다. `ArchitectureRules` 자체의 문법 오류만 빠르게 잡는 용도예요.

### 위반 시 출력

ArchUnit 은 위반 항목을 파일명과 줄 번호까지 알려줘요.

```text
Architecture Violation [r1: apps/* must not depend on core-*-impl (ports only)]
- Class <com.factory.apps.sumtally.SomeService> depends on class <com.factory.core.auth.impl.service.EmailAuthService>
  in (SomeService.java:15)
```

수정 지점을 바로 찾을 수 있습니다.

---

## 관련 문서

- [`ADR-004 · Gradle 모듈 경계 + ArchUnit`](../philosophy/adr-004-gradle-archunit.md) — ArchUnit 도입 결정과 Gradle convention plugin 관계
- [`모듈 의존 규칙 (Module Dependencies)`](./module-dependencies.md) — 모듈 의존 매트릭스 (r1~r8 의 의존 방향 상세)
- [`Naming Conventions`](../convention/naming.md) — DTO suffix 의 용도 분류 (r19 와 연관)
- [`DTO 팩토리 컨벤션`](../convention/dto-factory.md) — Entity 의 `to<Dto>()` 패턴 (r22 의 배경)
- [`API 버전 정책 (Versioning)`](../api-and-functional/api/versioning.md) — Deprecation 절차 (r20 과 연동)

---

## 6. 관련 파일

| 파일 | 역할 |
|---|---|
| `common-testing/.../architecture/ArchitectureRules.java` | 모든 규칙의 canonical 정의 |
| `common-testing/.../architecture/ArchitectureTest.java` | common-testing classpath 용 (빠른 피드백) |
| `bootstrap/.../BootstrapArchitectureTest.java` | 전체 프로젝트 classpath 용 (실제 검증) |
| `convention/naming.md` | r14~r22 와 짝을 이루는 네이밍 규칙 |
| `structure/module-dependencies.md` | r1~r8 과 짝을 이루는 의존 매트릭스 |
| `convention/dto-factory.md` | r22 의 배경 (Mapper 대신 `to<Dto>()` 패턴) |
