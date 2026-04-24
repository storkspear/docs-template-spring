# record vs class 선택 기준

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~3분

**설계 근거**: [`ADR-016 (DTO Mapper 금지)`](../philosophy/adr-016-dto-mapper-forbidden.md)

이 문서는 새 Java 타입을 정의할 때 `record` 와 `class` 중 무엇을 선택할지 결정 기준을 제공합니다.

---

## 개요

새 Java 타입 정의 시 **`record` 와 `class` 중 어느 것을 쓸지** 결정 기준을 제공합니다. DTO · 값 객체 · 유틸 · 다형 DTO 케이스별 의사결정 트리.

---

## 결정 트리

```
새 타입 만들 때
  │
  ├── 불변 데이터 carrier?       → ✓ record (기본)
  │
  ├── JPA @Entity?               → ✓ class (JPA 가 record 미지원)
  │
  ├── 가변 상태 필요?              → ✓ class (드묾, 합리적 근거 필요)
  │
  ├── 상속 계층 필요?              → ✓ sealed interface + record 구현
  │
  └── 기타                        → ✓ record
```

**기본 원칙**: 모르겠으면 record.

---

## class 허용 리스트

`class` 사용이 허용되는 명시적 경우:

| 용도 | 위치 | 이유 |
|---|---|---|
| JPA Entity | `..impl.entity..` | `@Entity` 가 record 미지원 |
| JPA Repository (interface → class 아님) | `..impl.repository..` | Spring Data 표준 |
| `@Service`, `@Component`, `@Controller` | `..impl..`, `..apps..`, `..bootstrap..` | 로직 보유, Spring 빈 |
| `@ConfigurationProperties` | `..impl..` | record 도 가능하나 class 허용 |
| `@Configuration` | `..impl..`, `bootstrap..` | 빈 정의 보유 |
| Utility class | 자유 | `final` + `private constructor` 필수 |
| Custom Exception | `..exception..` | `extends RuntimeException` 필요 |

**이 외**: record 필수. 특히 `..dto..` 패키지는 **ArchUnit 규칙 18** 로 record 강제.

---

## Utility class 스타일

static 메서드만 있는 클래스는 **`final` + `private constructor`**:

```java
public final class JsonContractAssertions {
    private JsonContractAssertions() {}   // 인스턴스화 금지

    public static <T> void assertRoundTrip(JacksonTester<T> tester, T original) { ... }
}
```

---

## sealed interface + record (다형 DTO)

여러 타입을 하나의 계약으로 다룰 때 (현재 사용 없음, 미래 확장):

```java
public sealed interface PaymentResult
    permits PaymentSuccess, PaymentPending, PaymentFailure {}

public record PaymentSuccess(String txId, Instant at) implements PaymentResult {}
public record PaymentPending(String reference) implements PaymentResult {}
public record PaymentFailure(String code, String message) implements PaymentResult {}
```

Jackson 은 `@JsonSubTypes` 로 직렬화 가능. ArchUnit 규칙 18 도 `sealed interface` 는 예외 처리.

---

## 왜 record 가 기본인가

1. **불변성 기본값** — Thread-safe, 부작용 없음
2. **equals / hashCode / toString 자동 생성** — JSON 계약 테스트의 round-trip 검증에 필수
3. **생성자 파라미터로 명시적 선언** — 필드 순서·타입 명확
4. **deconstruction 가능** (Java 21+ pattern matching)
5. **더 적은 코드** — 같은 역할에 class 는 20줄+, record 는 1줄

---

## record 사용 시 주의

### 필드 수정이 필요하면 `with` 메서드

record 는 불변. 수정하려면 새 instance 생성:

```java
public record UserProfile(long id, String email, String displayName, /* ... */) {
    public UserProfile withDisplayName(String newName) {
        return new UserProfile(id, email, newName, /* 나머지 */);
    }
}
```

전체 필드에 대해 기계적으로 만들지 말고 **자주 쓰이는 것만**. 자세한 기준은 `dto-factory.md`.

### JPA Entity 와 함께 사용 불가

`@Entity` 는 no-arg constructor + setter 기대. record 는 constructor 고정이라 불가. Entity 는 반드시 class.

### `@JsonProperty` 는 최후 수단

record 컴포넌트 이름이 자동으로 JSON 키가 됨. 네이밍 충돌 시에만 `@JsonProperty` 고려 — 일반적으로는 record 필드 이름을 JSON 규약에 맞춰 조정.

---

## 관련 문서

- [`DTO 팩토리 컨벤션`](./dto-factory.md) — DTO 팩토리 패턴
- [`Naming Conventions`](./naming.md) — 네이밍 규칙
- [`모듈 의존 규칙 (Module Dependencies)`](../structure/module-dependencies.md) — ArchUnit 규칙 18, 19
