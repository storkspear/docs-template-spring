# record vs class 선택 기준

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~3분

설계 근거는 [`ADR-016 · DTO Mapper 금지`](../philosophy/adr-016-dto-mapper-forbidden.md) 에 있어요.

---

## 개요

새 Java 타입을 정의할 때 `record` 와 `class` 중 무엇을 고를지 정리한 문서입니다. 일반 데이터 객체부터 JPA 엔티티, 유틸, 다형 타입까지 케이스별 기준을 표와 결정 트리로 담았어요.

한 줄 원칙은 이거예요. 모르겠으면 record 를 씁니다. class 는 아래 허용 목록에 든 경우에만 골라요.

---

## 결정 트리

```
새 타입 만들 때
  │
  ├── 불변 데이터를 담는 타입인가?   → record (기본값)
  │
  ├── JPA @Entity 인가?            → class
  │
  ├── 가변 상태가 꼭 필요한가?       → class (드묾, 근거 필요)
  │
  ├── 상속 계층이 필요한가?          → sealed interface + record 구현
  │
  └── 그 외                        → record
```

---

## class 허용 리스트

아래는 class 사용이 허용되는 경우예요. 이 목록 밖이면 record 가 기본입니다. 특히 `..dto..` 패키지는 ArchUnit [`r18`](../structure/architecture-rules.md) 이 record 를 강제하므로 class 로 두면 빌드가 깨져요.

| 용도 | 위치 | 이유 |
|---|---|---|
| JPA Entity | `..impl.entity..` | `@Entity` 가 record 를 지원하지 않습니다 |
| JPA Repository | `..impl.repository..` | Spring Data 표준 인터페이스예요 |
| `@Service`·`@Component`·`@Controller` | `..impl..`·`..apps..`·`..bootstrap..` | 로직을 가진 Spring 빈입니다 |
| `@ConfigurationProperties` | `..impl..` | record 도 되지만 class 도 허용해요 |
| `@Configuration` | `..impl..`·`..bootstrap..` | 빈 정의를 담습니다 |
| Utility class | 자유 | `final` + `private constructor` 필수 |
| Custom Exception | `..exception..` | `RuntimeException` 을 상속해야 합니다 |

`@ConfigurationProperties` 는 단순 설정값이면 record 로 쓰는 게 깔끔해요. `JwtProperties`·`MinioProperties` 가 그 예입니다. 중첩 구조나 가변 필드가 필요하면 class 로 둡니다 — `BillingNotificationProperties`·`AppCredentialProperties`·`PasswordPolicyProperties` 등이 그 예예요.

---

## Utility class 스타일

static 메서드만 모은 클래스는 인스턴스를 만들 이유가 없어요. 그래서 `final` 로 상속을 막고, `private` 생성자로 인스턴스화를 막습니다. 둘 다 필수입니다.

```java
// common-persistence/QueryUtil.java 발췌
public final class QueryUtil {
    private QueryUtil() {}   // 인스턴스화 금지

    public static void addCondition(Map<String, Object> conditions, String key, Object value) { ... }
}
```

`QueryUtil`·`ApiEndpoints` 같은 정적 헬퍼가 모두 이 형태예요.

---

## sealed interface + record (다형 타입)

여러 구현을 하나의 계약으로 묶되, 허용된 하위 타입만 두고 싶을 때 sealed interface 를 씁니다. 각 구현은 record 로 두는 게 자연스러워요.

```java
// core-storage-api/model/StorageObject.java 발췌
public sealed interface StorageObject
    permits GenericObject, AudioObject, ImageObject, VideoObject {

    String objectKey();
    long sizeBytes();
    String contentType();
}
```

`StorageObject` 가 이 패턴의 실제 사례예요. 스토리지 객체의 타입을 Generic·Audio·Image·Video 네 가지로 닫아 두고, 각 타입을 record 로 구현합니다.

ArchUnit [`r18`](../structure/architecture-rules.md) 은 record 와 sealed interface 둘 다 허용하므로 이 패턴은 규칙을 통과해요. 다만 `StorageObject` 는 `dto/` 가 아니라 `model/` 패키지에 있어서, suffix 를 강제하는 r19 는 적용되지 않습니다. `..dto..` 안에서 같은 패턴을 쓴다면 이름이 r19 의 허용 suffix 로 끝나야 해요.

---

## 왜 record 가 기본인가

record 를 기본으로 두는 이유는 다섯 가지예요.

- 불변이라 여러 스레드에서 안전하고, 만든 뒤 값이 바뀌는 부작용이 없습니다.
- `equals`·`hashCode`·`toString` 이 자동 생성돼요. JSON 계약 테스트가 직렬화·역직렬화 왕복을 비교할 때 이게 필수입니다.
- 생성자 파라미터로 필드를 선언하니 순서와 타입이 한눈에 드러나요.
- Java 21 이상의 패턴 매칭에서 구조 분해가 됩니다.
- 같은 역할을 class 로 쓰면 20줄이 넘는데 record 는 한 줄로 끝나요.

---

## record 사용 시 주의

### 필드를 바꿔야 하면 with 메서드

record 는 불변이라 필드를 직접 수정할 수 없어요. 값을 바꾼 복사본이 필요하면 새 인스턴스를 돌려주는 with 메서드를 둡니다. 아래는 그 패턴의 예시예요.

```java
public record UserProfile(long id, String email, String displayName /* ... */) {
    public UserProfile withDisplayName(String newName) {
        return new UserProfile(id, email, newName /* 나머지 */);
    }
}
```

모든 필드에 기계적으로 만들지 말고 실제로 자주 바꾸는 필드만 둡니다. 자세한 기준은 [`dto-factory.md`](./dto-factory.md) 를 참고하세요.

### JPA Entity 에는 못 써요

`@Entity` 는 인자 없는 생성자와 setter 를 기대합니다. record 는 생성자가 고정이라 이 요구를 맞출 수 없어요. 그래서 Entity 는 반드시 class 로 작성하고, JPA 용 기본 생성자를 `protected` 로 둡니다. `User`·`RefreshToken` 엔티티가 그 형태예요.

### `@JsonProperty` 는 최후의 수단

record 컴포넌트 이름이 그대로 JSON 키가 됩니다. 그래서 보통은 컴포넌트 이름을 JSON 규약에 맞춰 짓는 게 가장 깔끔해요. 이름을 도저히 맞출 수 없을 때만 `@JsonProperty` 를 붙입니다.

---

## 관련 문서

- [`DTO 팩토리 컨벤션`](./dto-factory.md) — DTO 변환을 Mapper 없이 처리하는 패턴
- [`네이밍 규칙`](./naming.md) — DTO suffix 분류를 포함한 네이밍 규약
- [`모듈 의존 규칙`](../structure/module-dependencies.md) — r1~r22 의 모듈 경계 규칙 개요
- [`Architecture Rules (ArchUnit)`](../structure/architecture-rules.md) — r18 (DTOS_MUST_BE_RECORDS) · r19 (DTO_NAMING_SUFFIX) 명세
