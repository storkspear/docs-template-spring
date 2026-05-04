# ADR-029 — 비밀번호 정책 강화 (@ValidPassword)

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~6분

**Status**: Accepted. `@ValidPassword` Bean Validation 어노테이션 + `PasswordValidator` 가 길이 / 복잡도 / common blacklist 를 검증해요. `app.security.password.*` properties 로 운영자가 강도를 조정합니다.

---

## 결론부터

비밀번호 정책은 *사용자 계정 보안의 첫 방어선* 이에요. *얼마나 긴 비밀번호를 요구할지*, *흔한 비밀번호를 차단할지*, *어떤 종류의 문자 (대문자 / 소문자 / 숫자 / 특수문자) 를 강제할지* 같은 결정이 *brute-force 공격* 과 *credential stuffing 공격* 의 성공률을 직접 좌우합니다. 기본 정책이 약하면 *유출된 비밀번호 데이터베이스* (RockYou, SecLists 같은) 의 흔한 항목으로 *수만 계정이 한 번에 뚫릴* 수 있어요.

본 ADR 은 비밀번호 검증을 `@ValidPassword` Bean Validation 어노테이션으로 표준화하고, 그 검증 로직을 `PasswordValidator` 한 클래스에 모아두는 구조를 정의합니다. 기본 정책은 *OWASP ASVS L2 권장* 을 따라 *최소 10 자, 대문자 / 소문자 / 숫자 필수, common blacklist (Top 200 흔한 비밀번호) 차단* 의 baseline 이에요. 특수문자 강제는 *사용성 trade-off* 로 default false 로 두고 운영자가 켤 수 있게 했습니다.

이 정책의 핵심은 *property 기반 운영자 override* 예요. 파생 레포가 *비즈니스 특성* 에 맞게 정책을 조정할 수 있도록 `app.security.password.min-length`, `app.security.password.require-special` 같은 properties 를 노출했어요. 금융 앱이라면 *min-length=12 + special=true* 로 강화하고, 캐주얼 게임이라면 *min-length=8* 로 완화하는 식입니다. 코드를 수정하지 않고 `.env` 한 줄로 조정 가능해 *파생 레포의 자유도* 가 보장돼요.

검증은 표준 Bean Validation 흐름을 따릅니다. DTO 의 `password` 필드에 `@ValidPassword` 만 붙이면 *Controller 의 `@Valid` 단계에서 자동 검증* 되어 boilerplate 가 0 이에요. 검증 실패 시 표준 `MethodArgumentNotValidException` 이 던져지고, `GlobalExceptionHandler` 가 *400 Bad Request* 응답으로 정합하게 처리합니다.

이 ADR 의 범위는 baseline 정책 결정 근거 (OWASP ASVS L2 vs NIST SP 800-63B), `@ValidPassword` 어노테이션 설계, common-passwords blacklist 의 출처 (RockYou + SecLists) 와 캐싱 전략, property override 의 적용 흐름, 그리고 *common-web 모듈 위치* 의 정합성까지입니다.

---

## 왜 이런 결정이 필요했나?

비밀번호 정책의 *기본값* 만으로 시스템이 출시되면 운영 보안 audit 에서 *baseline 미달* 로 분류되는 경우가 많아요. *최소 8 자 + 복잡도 요구 없음* 같은 단순 정책은 *brute-force 시간 비용* 을 충분히 늘리지 못하고, *credential stuffing 공격* (다른 사이트에서 유출된 이메일/비밀번호 조합으로 자동 로그인 시도) 에도 무방비입니다.

baseline 강화의 필요성을 보여주는 시나리오를 보면 그 부담이 명확해요. 사용자가 *비밀번호 8 자* 로 가입하면 *brute-force 로 평균 2~3 일 안에* 뚫릴 수 있는 강도예요 (현대 GPU 기준). *aaaaaaaa* 같은 단순 반복도 8 자 정책은 막지 않으므로, *유출된 비밀번호 데이터베이스* 의 Top 100 항목 (`password`, `12345678`, `qwerty`, `abc12345` 등) 으로 *상당수 계정이 즉시 뚫리는* 상태가 됩니다. *유출된 RockYou 비밀번호 데이터베이스* (3천만 항목) 가 인터넷에 공개되어 있어 누구나 다운받아 시도할 수 있어요.

길이 강화의 가치는 *지수적* 입니다. *8 자에서 10 자* 로 올리면 brute-force 시간이 *수십 배* 늘어나요 (각 자리수당 95 가지 문자 조합). *10 자 + 대소문자 + 숫자 강제* 만으로도 *수년 단위* 의 brute-force 비용이 되어 실질적으로 무력화돼요. *common blacklist 차단* 은 그 강화 위에 *가장 흔한 약점* 을 추가로 막는 보완입니다.

*OWASP ASVS L2* (Application Security Verification Standard Level 2) 는 *비밀번호 최소 10 자 + 흔한 비밀번호 차단 + 복잡도 요구* 를 권장 baseline 으로 정해두고 있어요. 이 표준을 따르면 *대부분의 운영 보안 audit* 에서 정책 측면의 베이스라인이 통과됩니다. *NIST SP 800-63B* 는 *최소 8 자 + 흔한 비밀번호 차단* 을 더 느슨하게 권장하는데, 우리는 더 보수적인 OWASP ASVS L2 를 default 로 채택했어요.

다만 *모든 앱이 같은 정책을 따라야 하는 건 아닙니다*. 금융 / 의료 같은 *민감 정보* 를 다루는 앱은 *12 자 이상 + 특수문자 강제* 로 더 강화해야 하고, 캐주얼 게임 / 메모 앱 같은 *낮은 위험* 앱은 *사용자 마찰을 줄이기 위해 정책을 완화* 하는 편이 비즈니스에 더 맞아요. 이 *비즈니스 특성에 따른 조정* 을 코드 수정 없이 가능하게 하려면 *property 기반 override* 가 필요합니다.

검증 로직의 *위치* 도 결정 포인트예요. 비밀번호는 *어느 도메인의 전용 기능* 이 아니라 *모든 도메인이 가입 / 로그인 / 비밀번호 변경에서 공통으로 검증* 하는 *cross-cutting concern* 입니다. `core-auth` 안에 두면 *다른 도메인이 사용할 때 의존 그래프가 어색* 해지므로 ([`ADR-024`](./adr-024-email-domain-extraction.md) 의 정신과 동일), `common-web/security/` 에 두는 것이 자연스러워요.

이 결정이 답해야 할 물음은 이거예요.

> **비밀번호 baseline 정책을 어떤 강도로 두고, 비즈니스 특성에 따른 조정을 코드 수정 없이 가능하게 하려면 어떤 검증 메커니즘이 필요한가?**

---

## 결정

| 항목 | 값 (default) | 사유 |
|---|---|---|
| **min length** | 10 | OWASP ASVS L2 권장 |
| **max length** | 72 (hardcode) | BCrypt 알고리즘 한계 |
| **require uppercase** | true | 복잡도 |
| **require lowercase** | true | 복잡도 |
| **require digit** | true | 복잡도 |
| **require special** | false | 사용성 trade-off — 운영자가 켜기 가능 |
| **block common** | true | Top 200 흔한 비밀번호 blacklist (RockYou + SecLists 기반) |
| **검증 방식** | Bean Validation `@ValidPassword` annotation | DTO 단에서 자동 검증 — boilerplate 0 |
| **위치** | `common-web/security/` | 도메인 횡단, 모든 DTO 가 사용 |
| **Override** | `app.security.password.*` properties | 운영자가 비즈니스 강도에 맞게 조정 |

---

## @ValidPassword 사용 패턴

```java
public record SignUpRequest(
    @Email @NotBlank String email,
    @NotBlank @ValidPassword String password,        // ← @Size 대체
    @NotBlank @Size(max=30) String displayName,
    @NotBlank String appSlug
) {}
```

검증 실패 시 ConstraintValidator 가 한국어 메시지 반환:
- "비밀번호는 최소 10자 이상이어야 합니다"
- "비밀번호에 영문 대문자가 1개 이상 포함되어야 합니다"
- "널리 사용되는 비밀번호는 사용할 수 없습니다"

→ Spring `@RestControllerAdvice` 의 `MethodArgumentNotValidException` 핸들러가 ApiError 응답으로 변환 (이미 구현됨).

---

## Override 예시

```yaml
# .env / application.yml
app.security.password:
  min-length: 12              # 더 강하게
  require-special: true       # 특수문자 필수
  block-common: true
```

또는 .env:
```
APP_SECURITY_PASSWORD_MIN_LENGTH=12
APP_SECURITY_PASSWORD_REQUIRE_SPECIAL=true
```

---

## 흔한 비밀번호 blacklist

`common-web/src/main/resources/security/common-passwords.txt`:
- Top 200 (RockYou + SecLists 추출)
- case-insensitive 매칭 (대소문자 무관)
- `#` 주석 + 빈 줄 무시
- 운영자가 추가 가능 (예: 회사 이름 / 제품명 / 직원 이름)

**성능**: 첫 검증 시 한 번만 파일을 읽어요 → `Set<String>` cached (double-checked lock). 이후 O(1) 조회로 동작해요.

**용량**: 200개 ≈ 2KB 예요. 메모리 부담은 0이에요.

---

## 적용 DTO (3개)

```
SignUpRequest                @ValidPassword newPassword
ChangePasswordRequest         @ValidPassword newPassword
PasswordResetConfirmRequest   @ValidPassword newPassword
```

`currentPassword` (변경 시 검증용) 는 `@NotBlank` 만 적용해요 — 이미 등록된 비밀번호라 정책 재검증은 하지 않아요.

---

## 검증 (단위 테스트 14건)

`PasswordValidatorTest`:

**LengthPolicy**:
- `shorterThanMinLength_invalid`
- `exactMinLength_valid`
- `longerThanMax72_invalid`
- `nullPassword_passes` (`@NotBlank` 가 별도)

**ComplexityPolicy**:
- `noUppercase_whenRequired_invalid`
- `noLowercase_whenRequired_invalid`
- `noDigit_whenRequired_invalid`
- `noSpecial_whenRequired_invalid`
- `hasSpecial_whenRequired_valid`
- `allRequirementsMet_valid`

**CommonPasswordsBlacklist**:
- `commonPassword_password_invalid` — "password" 차단
- `commonPassword_caseInsensitive` — "Password" / "PASSWORD" 차단
- `commonPassword_blockDisabled_valid` — opt-out 시 통과
- `uncommonPassword_valid`

---

## 대안 비교

### 옵션 A — 기존 `@Size` + 정규식 (`@Pattern`)

```java
@Size(min=10, max=72)
@Pattern(regexp="^(?=.*[A-Z])(?=.*[a-z])(?=.*\\d).{10,72}$")
String password
```

- ❌ 복잡도 정책을 변경하려면 regex 자체를 수정해야 해요
- ❌ blacklist 가 통합되지 않아 별도 검증 코드가 따로 필요해요
- ❌ 에러 메시지가 한 줄이라 사용자가 *어떤 정책을 위반했는지* 알 수 없어요

### 옵션 B — 커스텀 `@ValidPassword` ★ 채택

- 정책을 properties 로 분리해서 운영자가 `.env` 로 조정할 수 있어요
- blacklist 가 어노테이션 안에 통합돼요
- 위반한 정책별로 메시지가 분기되어 사용자에게 정확히 안내됩니다
- 검증 로직이 ConstraintValidator 한 개로 통합됩니다

### 옵션 C — Spring Security `PasswordEncoder` 수준 검증

- ❌ Spring Security 의 `PasswordEncoder` 는 hashing / 매칭만 다루고 정책 검증은 책임이 아니에요
- ❌ Passay 같은 별도 라이브러리가 필요해 의존성이 늘어나요

### 옵션 D — haveibeenpwned API (실 leak DB 조회)

- ✅ 강력함 — 실제로 leak 된 비밀번호를 차단할 수 있어요
- ❌ 외부 API 호출이 회원가입 latency 를 늘려요
- ❌ k-anonymity 를 써도 응답 size 가 커서 부담이 있어요
- 별도 사이클로 미뤄요 (출시 후 비즈니스 결정 사항)

---

## 안 다루는 범위 (다음 사이클)

- **로그인 실패 카운터** — N회 실패 시 일시 lock (brute-force 방지). 별도 mechanism (Redis / DB) 가 필요해요.
- **비밀번호 만료** — 90일 후 강제 변경. NIST 는 만료를 비권장합니다 (사용자가 약한 패턴을 양산해요). 환경별 결정에 맡겨요.
- **비밀번호 재사용 차단** — 직전 N개 hash 보존 + 매칭. DB 변경 + 비즈니스 가치 검토 후 진행해요.
- **2FA (TOTP)** — 다음 사이클로 미뤄요. 비밀번호 강화와 분리합니다.
- **haveibeenpwned 통합** — leak DB 를 조회해요. 외부 API 의존 + 운영 결정 사항이에요.

---

## 관련 파일 (신규)

- `common/common-web/src/main/java/com/factory/common/web/security/PasswordPolicyProperties.java`
- `common/common-web/src/main/java/com/factory/common/web/security/ValidPassword.java`
- `common/common-web/src/main/java/com/factory/common/web/security/PasswordValidator.java`
- `common/common-web/src/main/java/com/factory/common/web/security/SecurityValidationAutoConfiguration.java`
- `common/common-web/src/main/resources/security/common-passwords.txt`
- `common/common-web/src/main/resources/META-INF/spring/...AutoConfiguration.imports` — 새 AutoConfig 등록
- `common/common-web/src/test/java/com/factory/common/web/security/PasswordValidatorTest.java`

수정:
- `core/core-auth-api/.../dto/SignUpRequest.java` — `@Size` → `@ValidPassword`
- `core/core-auth-api/.../dto/ChangePasswordRequest.java` — 동일
- `core/core-auth-api/.../dto/PasswordResetConfirmRequest.java` — 동일
