# JSON 계약 규약 (JSON Contract)

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~5분

**설계 근거**: [`ADR-016 · DTO 변환은 Entity 메서드로`](../../philosophy/adr-016-dto-mapper-forbidden.md)

이 문서는 DTO 의 JSON 직렬화·역직렬화 정책과 계약 테스트 규약을 정의해요.

---

## 개요

이 문서가 담는 항목은 세 가지입니다. DTO 직렬화·역직렬화 정책, 모든 DTO 가 자동으로 받는 계약 테스트, 필드를 더하거나 바꿀 때의 절차예요. DTO 작성 규약 자체는 [`records-and-classes.md`](../../convention/records-and-classes.md) 와 [`naming.md`](../../convention/naming.md) 가 다루고, 여기서는 그 DTO 가 JSON 으로 오갈 때의 약속에 집중해요.

---

## 계약 테스트의 Jackson 정책

JSON 계약 테스트는 프로젝트 정책을 재현한 `ObjectMapper` 로 직렬화 결과를 검증해요. 이 ObjectMapper 는 [`AbstractJsonContractTest`](../../production/test/contract-testing.md#layer-1--json-계약-테스트) 의 `contractObjectMapper()` 가 직접 구성하고, Spring 컨텍스트 없이 순수하게 동작합니다.

| 항목 | 정책 | 이유 |
|---|---|---|
| null 필드 직렬화 | `NON_NULL` 으로 생략 | 모바일 대역폭 절약, REST 관습 |
| 알 수 없는 필드 역직렬화 | `FAIL_ON_UNKNOWN_PROPERTIES=false` 로 무시 | 클라이언트 버전 호환 (forward compat) |
| Date·Time | ISO-8601 문자열 (`JavaTimeModule`) | 숫자 timestamp 금지 |
| 날짜 timestamp | `WRITE_DATES_AS_TIMESTAMPS=false` | ISO-8601 강제 |
| Enum | `name()` 문자열 | `ordinal` 금지 — 순서 바뀌면 값이 어긋나요 |
| 필드 네이밍 | camelCase (record 컴포넌트 이름 그대로) | `@JsonProperty` 없이 |
| 빈 컬렉션 | `[]` 로 직렬화 (null 아님) | 클라이언트 분기 단순화 |

### null 생략은 어디서 일어나나

테스트 ObjectMapper 는 `NON_NULL` 을 전역으로 설정하지만, 프로덕션 Spring Boot 의 기본 Jackson 은 null 을 그대로 직렬화해요. 두 곳이 다르기 때문에, null 이 될 수 있는 응답 필드는 DTO 에 `@JsonInclude(NON_NULL)` 을 명시적으로 달아 줘야 프로덕션에서도 생략됩니다.

이걸 실제로 적용한 곳이 `AuthResponse` 예요. 정상 응답이면 `user` 와 `tokens` 만 채우고, 2FA 가 필요한 응답이면 `twoFactorToken` 만 채우는 두 모양을 가져서, 나머지 필드는 컴포넌트마다 `@JsonInclude(NON_NULL)` 로 생략해요.

```java
// core-auth-api/.../dto/AuthResponse.java 발췌
public record AuthResponse(
        @JsonInclude(JsonInclude.Include.NON_NULL) UserSummary user,
        @JsonInclude(JsonInclude.Include.NON_NULL) AuthTokens tokens,
        @JsonInclude(JsonInclude.Include.NON_NULL) String devVerificationToken,
        @JsonInclude(JsonInclude.Include.NON_NULL) String twoFactorToken) {}
```

모든 필드가 항상 채워지는 DTO 는 이 어노테이션이 필요 없어요. null 변형이 실제로 나가는 응답에만 붙입니다.

---

## DTO 구조 원칙

### 기본은 record

모든 DTO 는 Java `record` 로 작성합니다. ArchUnit r18 이 `..dto..` 패키지의 클래스가 record(또는 sealed interface)이도록 빌드 시점에 강제해요.

```java
public record UserSummary(
    long id,
    String email,
    String displayName,
    boolean emailVerified
) {}
```

### Validation 어노테이션

Request DTO 는 입력 검증 어노테이션을 포함합니다. 비밀번호처럼 정책이 복잡한 값은 `@ValidPassword` 같은 도메인 전용 어노테이션을 씁니다.

```java
// core-auth-api/.../dto/SignUpRequest.java 전체
public record SignUpRequest(
        @Email @NotBlank String email,
        @NotBlank @ValidPassword String password,
        @NotBlank @Size(max = 30) String displayName,
        @NotBlank String proofToken) {}
```

Response DTO 에는 validation 어노테이션이 없어도 돼요. 값을 서버가 만들어 내보내니까요.

### 접미사 규약

DTO 이름의 접미사는 ArchUnit r19 가 허용하는 13개로 한정돼요. 그 외 이름은 빌드가 차단합니다. 분류와 예시는 [`naming.md`](../../convention/naming.md#dto) 의 DTO 절이 단일 출처예요. 자주 만나는 몇 개만 옮기면 이래요.

| 접미사 | 용도 | 예시 |
|---|---|---|
| `Request` | 클라이언트 입력 | `SignInRequest` |
| `Summary` | 최소 필드 요약 뷰 | `UserSummary` |
| `Profile` | 전체 필드 상세 뷰 | `UserProfile` |
| `Account` | 인증·인가 컨텍스트 뷰 | `UserAccount` |
| `Response` | 여러 도메인을 묶은 응답 | `AuthResponse` |
| `Tokens` | 토큰 묶음 | `AuthTokens` |
| `Result` | 연산 결과 | `PaymentResult`, `PushSendResult` |
| `Message` | 외부로 보낼 메시지 | `PushMessage` |
| `Dto` | 위 분류에 안 맞는 교환 객체 | `DeviceDto` |

---

## 자동으로 받는 계약 테스트 3가지

DTO 의 JsonTest 가 `AbstractJsonContractTest<T>` 를 상속하면 아래 세 가지가 자동으로 수행돼요. `sampleType()`, `sample()`, `canonicalJson()` 세 메서드만 구현하면 됩니다.

| 테스트 | 검증 내용 |
|---|---|
| `serialize_roundTripsToSample` | DTO → JSON → DTO 왕복 후 record `equals` 비교 |
| `deserialize_parsesCanonicalJson` | canonical JSON → DTO 매핑 정확성 |
| `deserialize_ignoresUnknownField` | 알 수 없는 필드가 있어도 무시하고 파싱 (forward compat) |

특수한 검증이 더 필요하면 그 DTO 의 JsonTest 에 개별 `@Test` 메서드를 추가해요. 보안 민감 필드의 존재 확인, null 변형의 round-trip, enum·timestamp 포맷 단언이 대표적인 추가 케이스예요.

---

## 샘플 — 기본 형태

`@JsonTest` 어노테이션은 붙이지 않아요. Spring 컨텍스트 없이 순수 `ObjectMapper` 로 동작합니다.

```java
class SignUpRequestJsonTest extends AbstractJsonContractTest<SignUpRequest> {
    @Override protected Class<SignUpRequest> sampleType() {
        return SignUpRequest.class;
    }

    @Override protected SignUpRequest sample() {
        return new SignUpRequest("a@b.com", "pw12345678", "홍길동", "proof-jwt");
    }

    @Override protected String canonicalJson() {
        return """
            {"email":"a@b.com","password":"pw12345678","displayName":"홍길동","proofToken":"proof-jwt"}
            """;
    }
}
```

---

## 샘플 — 보안 민감 필드

`passwordHash` 같은 필드는 JSON 에 존재하지만 값을 단언하면 안 돼요. 실제 운영에선 해시 값이 매번 다르니까요. 그래서 **존재만 확인** 합니다.

```java
class UserAccountJsonTest extends AbstractJsonContractTest<UserAccount> {
    // ... sample(), canonicalJson() ...

    @Test
    void serialize_passwordHashFieldPresent_valueNotAsserted() throws Exception {
        String json = serialize(sample());
        assertThat(json).contains("\"passwordHash\":");
    }
}
```

---

## 샘플 — 중첩 record

`AuthResponse` 의 정상 응답은 `UserSummary` 와 `AuthTokens` 를 품어요. 두 컴포넌트만 채우는 생성자를 쓰면 `devVerificationToken` 과 `twoFactorToken` 은 null 이 되고, 위에서 본 `@JsonInclude(NON_NULL)` 덕분에 JSON 에서 빠집니다.

```java
class AuthResponseJsonTest extends AbstractJsonContractTest<AuthResponse> {
    @Override protected AuthResponse sample() {
        return new AuthResponse(
            new UserSummary(1L, "a@b.com", "홍길동", true),
            new AuthTokens("access-t", "refresh-t")
        );
    }

    @Override protected String canonicalJson() {
        return """
            {"user":{"id":1,"email":"a@b.com","displayName":"홍길동","emailVerified":true},\
            "tokens":{"accessToken":"access-t","refreshToken":"refresh-t"}}
            """;
    }
}
```

중첩 record 도 `equals` 가 자동으로 만들어지니까 round-trip 테스트가 그대로 작동해요.

---

## 샘플 — Instant 필드

날짜·시간은 ISO-8601 문자열로 직렬화돼요. `JavaTimeModule` 이 등록돼 있어서 `@JsonFormat` 이 필요 없어요.

```java
@Override protected UserProfile sample() {
    return new UserProfile(
        1L, "a@b.com", "홍길동", "kingoo", true, false, "USER",
        Instant.parse("2026-04-01T00:00:00Z"),
        Instant.parse("2026-04-15T12:00:00Z")
    );
}

@Override protected String canonicalJson() {
    return """
        {"id":1,"email":"a@b.com","displayName":"홍길동","nickname":"kingoo",\
        "emailVerified":true,"isPremium":false,"role":"USER",\
        "createdAt":"2026-04-01T00:00:00Z","updatedAt":"2026-04-15T12:00:00Z"}
        """;
}
```

---

## 샘플 — Map 필드

```java
@Override protected PushMessage sample() {
    Map<String, String> data = new LinkedHashMap<>();   // 키 순서 고정
    data.put("type", "alert");
    data.put("id", "42");
    return new PushMessage("알림 제목", "알림 본문", data, "https://cdn.example.com/image.png");
}

@Override protected String canonicalJson() {
    return """
        {"title":"알림 제목","body":"알림 본문",\
        "data":{"type":"alert","id":"42"},\
        "imageUrl":"https://cdn.example.com/image.png"}
        """;
}
```

Jackson 의 Map 직렬화는 insertion order 를 따릅니다. canonicalJson 과 순서를 맞추려면 `HashMap` 대신 `LinkedHashMap` 을 쓰세요.

---

## 필드 추가·변경 절차

### 필드 추가 (non-breaking)

1. DTO 에 필드를 추가합니다. primitive 는 default 값을 고려하세요.
2. `sample()` 에 새 필드 값을 넣어요.
3. `canonicalJson()` 에 새 필드를 필드 선언 순서대로 추가해요.
4. 테스트를 실행하고, 실패하면 2·3 을 조정합니다.

### 필드 타입 변경 (breaking)

타입 변경은 버저닝의 breaking change 에 해당해요. 기존 필드를 `@Deprecated` 로 유지하고 새 필드를 따로 추가합니다. 한 번에 교체하지는 마세요. 절차는 [`versioning.md`](./versioning.md#deprecation-프로세스) 의 Deprecation 프로세스를 따릅니다.

### 필드 제거

소비자 앱의 버전 호환을 위해 `@Deprecated` 기간을 거친 뒤 제거합니다. 제거 시점에 JsonTest 의 `sample()` 과 `canonicalJson()` 도 함께 수정해요.

---

## 체크리스트

새 DTO 를 추가할 때:

- [ ] record 로 작성했나요
- [ ] Request 라면 validation 어노테이션을 달았나요
- [ ] 접미사가 [`naming.md`](../../convention/naming.md#dto) 의 13개 안에 드나요
- [ ] `<Dto>JsonTest` 를 작성하고 `sample()` 과 `canonicalJson()` 을 채웠나요
- [ ] null 변형이 나가는 응답 필드에 `@JsonInclude(NON_NULL)` 을 달았나요
- [ ] `./gradlew :core:core-<x>-api:test` 가 통과하나요

필드를 추가할 때:

- [ ] DTO 정의를 바꿨나요
- [ ] `sample()` 과 `canonicalJson()` 을 업데이트했나요
- [ ] `deserialize_ignoresUnknownField` 가 여전히 통과하나요 (forward compat 유지)
- [ ] Instant 필드가 `@JsonFormat` 없이 ISO-8601 로 직렬화되나요
- [ ] Map 을 `LinkedHashMap` 으로 순서 고정했나요

---

## 관련 문서

- [`계약 테스트 (Contract Testing)`](../../production/test/contract-testing.md) — 3층 테스트 구조 전체와 `AbstractJsonContractTest` 동작
- [`Naming Conventions`](../../convention/naming.md#dto) — DTO 접미사 13개의 단일 출처
- [`API Response Format`](./api-response.md) — `data` / `error` 응답 envelope
- [`Versioning`](./versioning.md#deprecation-프로세스) — breaking change 와 Deprecation 절차
- [`ADR-016 · DTO Mapper 금지`](../../philosophy/adr-016-dto-mapper-forbidden.md) — Entity `to<Dto>()` 변환 패턴의 근거
