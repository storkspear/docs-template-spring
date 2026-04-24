# JSON 계약 규약 (JSON Contract)

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~5분

**설계 근거**: [ADR-016 (DTO Mapper 금지)](../../philosophy/adr-016-dto-mapper-forbidden.md)

이 문서는 DTO JSON 직렬화/역직렬화의 전역 정책과 테스트 규약을 정의합니다.

---

## 개요

DTO JSON **직렬화/역직렬화 정책** + 필수 테스트 4 종 (샘플/보안/중첩/타입) 목록. 필드 추가/변경 시 절차 포함.

---

## 전역 Jackson 정책

모든 DTO 는 다음 정책을 따릅니다. 정책은 `AbstractJsonContractTest` 내부의 `contractObjectMapper()` 에 내장되어 있으며, 프로덕션 Spring Boot 기본 Jackson 설정과 일치해야 합니다.

| 항목 | 정책 | 이유 |
|---|---|---|
| **null 필드 직렬화** | `NON_NULL` (생략) | 모바일 bandwidth, REST 관습 |
| **알 수 없는 필드 역직렬화** | IGNORE (`FAIL_ON_UNKNOWN_PROPERTIES=false`) | 클라이언트 버전 호환성 (forward compat) |
| **Date/Time** | ISO-8601 문자열 (`JavaTimeModule`) | 숫자 timestamp 금지 |
| **WRITE_DATES_AS_TIMESTAMPS** | `false` | ISO-8601 강제 |
| **Enum** | `name()` (문자열) | `ordinal` 금지 — 순서 변경 시 재앙 |
| **필드 네이밍** | camelCase (record 컴포넌트 이름) | `@JsonProperty` 없이 |
| **빈 컬렉션** | `[]` (null 아님) | 클라이언트 분기 단순화 |

---

## DTO 구조 원칙

### 기본: `record`

모든 DTO 는 Java `record` 로 작성합니다 (Item 4 규칙 — 진행 중).

```java
public record UserSummary(
    long id,
    String email,
    String displayName,
    boolean emailVerified
) {}
```

### Validation 어노테이션

Request DTO 는 validation 어노테이션을 포함합니다:

```java
public record SignUpRequest(
    @Email @NotBlank String email,
    @NotBlank @Size(min = 8, max = 72) String password,
    @NotBlank @Size(max = 30) String displayName,
    @NotBlank String appSlug
) {}
```

Response DTO 에는 validation 어노테이션 불필요 (서버가 생성하므로).

### 접미사 규약 (naming.md 참조)

| 접미사 | 용도 | 예시 |
|---|---|---|
| `Request` | 클라이언트 입력 | `SignUpRequest` |
| `Response` | 복합 서버 응답 | `AuthResponse` |
| `Dto` | 일반 교환 객체 | `DeviceDto` |
| `Summary` | 최소 필드 요약 | `UserSummary` |
| `Profile` | 상세 정보 | `UserProfile` |
| `Tokens` | 토큰 묶음 | `AuthTokens` |
| `Message` | 메시지 객체 | `PushMessage` |
| `Result` | 작업 결과 | `PushSendResult`, `PurchaseVerificationResult` |
| `Status` | 상태 표현 | `SubscriptionStatus` |
| `Account` | 유저 계정 정보 (민감) | `UserAccount` |

---

## JSON 계약 테스트 필수 4가지

모든 DTO 에 대해 `AbstractJsonContractTest<T>` 상속으로 자동 수행:

1. `serialize_roundTripsToSample` — DTO → JSON → DTO (record equals)
2. `deserialize_parsesCanonicalJson` — canonical JSON → DTO
3. `deserialize_ignoresUnknownField` — 알 수 없는 필드 무시

특수 케이스가 필요하면 개별 `@Test` 메서드 추가:

4. 보안 민감 필드 존재 검증 (값 단언 금지)
5. null 필드 포함된 variant round-trip
6. enum · timestamp 포맷 검증

---

## 샘플: 기본 형태

```java
class SignUpRequestJsonTest extends AbstractJsonContractTest<SignUpRequest> {
    @Override protected Class<SignUpRequest> sampleType() {
        return SignUpRequest.class;
    }

    @Override protected SignUpRequest sample() {
        return new SignUpRequest("a@b.com", "pw12345678", "홍길동", "sumtally");
    }

    @Override protected String canonicalJson() {
        return """
            {"email":"a@b.com","password":"pw12345678","displayName":"홍길동","appSlug":"sumtally"}
            """;
    }
}
```

`@JsonTest` 어노테이션 **불필요**. Spring 컨텍스트 없이 순수 `ObjectMapper` 기반.

---

## 샘플: 보안 민감 필드

`passwordHash` 같은 필드는 JSON 에 존재하지만 값은 노출하면 안 됨. 테스트에서 **존재만 확인**:

```java
class UserAccountJsonTest extends AbstractJsonContractTest<UserAccount> {
    // ... sample(), canonicalJson() ...

    @Test
    void serialize_passwordHashFieldPresent_valueNotAsserted() throws Exception {
        String json = serialize(sample());
        assertThat(json).contains("\"passwordHash\":");
        // 값 자체는 단언하지 않음 — 실제 운영에선 hash 값이 매번 다름
    }
}
```

---

## 샘플: 중첩 DTO (record in record)

`AuthResponse` 는 `UserSummary` 와 `AuthTokens` 를 포함:

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

중첩 record 도 `equals` 가 자동 생성되므로 round-trip 테스트가 그대로 작동.

---

## 샘플: Instant / LocalDate 필드

ISO-8601 문자열 강제:

```java
@Override protected UserProfile sample() {
    return new UserProfile(
        1L, "a@b.com", "홍길동", true, false, "USER",
        Instant.parse("2026-04-01T00:00:00Z"),
        Instant.parse("2026-04-15T12:00:00Z")
    );
}

@Override protected String canonicalJson() {
    return """
        {"id":1,"email":"a@b.com","displayName":"홍길동","emailVerified":true,\
        "isPremium":false,"role":"USER",\
        "createdAt":"2026-04-01T00:00:00Z","updatedAt":"2026-04-15T12:00:00Z"}
        """;
}
```

`JavaTimeModule` 이 자동 등록되어 있어 `@JsonFormat` 불필요.

---

## 샘플: Map / List 필드

```java
@Override protected PushMessage sample() {
    Map<String, String> data = new LinkedHashMap<>();   // 키 순서 고정
    data.put("type", "alert");
    data.put("id", "42");
    return new PushMessage("알림 제목", "알림 본문", data, "https://cdn/x.png");
}

@Override protected String canonicalJson() {
    return """
        {"title":"알림 제목","body":"알림 본문",\
        "data":{"type":"alert","id":"42"},\
        "imageUrl":"https://cdn/x.png"}
        """;
}
```

**Map 순서**: Jackson 기본은 insertion order. `HashMap` 대신 `LinkedHashMap` 사용해 canonicalJson 과 일치.

---

## 필드 추가/변경 시 절차

### 필드 추가 (non-breaking)

1. DTO 에 필드 추가 (primitive 는 default 값 고려)
2. `sample()` 에 새 필드 값 포함
3. `canonicalJson()` 에 새 필드 추가 (알파벳·필드 선언 순서 일관)
4. 테스트 실행 — 실패 시 위 둘 조정

### 필드 타입 변경 (breaking)

- 이런 변경은 **Item 3 (버저닝) 의 breaking change** 에 해당.
- `@Deprecated` 로 기존 필드 유지하고 새 필드 추가 → 한 번에 교체 금지.
- 자세한 절차는 `docs/api-contract/versioning.md` (향후 추가 예정, Item 3 구현 시).

### 필드 제거

- 소비자 앱 버전 호환성 위해 `@Deprecated` 기간 거친 후 제거.
- 제거 시점에 Json 테스트도 동시 수정.

---

## 체크리스트

### 새 DTO 추가
- [ ] record 로 작성
- [ ] Request 는 validation 어노테이션
- [ ] 접미사 규약 준수 (naming.md)
- [ ] `<Dto>JsonTest` 작성 — `sample()` + `canonicalJson()`
- [ ] `./gradlew :core:core-<x>-api:test` 통과

### 필드 추가
- [ ] DTO 정의 변경
- [ ] `sample()` 업데이트
- [ ] `canonicalJson()` 업데이트
- [ ] 테스트 통과

### 의심될 때
- [ ] `deserialize_ignoresUnknownField` 가 여전히 통과 (forward compat 유지)
- [ ] Instant 필드는 `@JsonFormat` 없이도 ISO-8601 직렬화
- [ ] Map 은 `LinkedHashMap` 으로 insertion order 확정

## 관련 문서

- [계약 테스트 (Contract Testing)](../../production/test/contract-testing.md) — 3층 테스트 구조 전체
- [Naming Conventions](../../convention/naming.md) — DTO 네이밍 규칙
