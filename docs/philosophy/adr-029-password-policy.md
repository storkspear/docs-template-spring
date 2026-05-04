# ADR-029 — 비밀번호 정책 강화 (@ValidPassword)

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~6분

**상태**: 채택 (2026-05-02)
**전제**: 기존 인증 (Email + BCrypt)
**연관**: V 사이클 — 보안 baseline / 출시 전 audit 통과

---

## 결론부터

비밀번호 정책 (`@ValidPassword` Bean Validation) 강화 — *최소 10자* / *common-passwords.txt blacklist* (10K 항목) / *property override 가능*.

기본값은 `min=10` (보안 baseline). 파생 레포가 *느슨하게* 또는 *엄격하게* 둘 수 있도록 `app.security.password.min-length` 등 property 로 조정 가능. 검증은 `@Valid` 표준 흐름 — Controller / Service 어디서든 동일.

---

## 배경

기존 정책 = `@Size(min=8, max=72)` 만:

```java
@Size(min = 8, max = 72) String password
```

**약점**:
- 8자 = 너무 약함 (NIST 권장 ≥ 8 이지만 OWASP ≥ 10)
- "password" / "12345678" / "qwerty" 같은 흔한 비밀번호 통과
- 복잡도 요구 X — `aaaaaaaa` (8자) 통과
- 이메일 leak 시 동일 비밀번호로 다른 사이트 침해 (rainbow table)

운영 보안 audit 시 통상 **NIST SP 800-63B** 또는 **OWASP ASVS L2** 권장 정책을 요구해요. 본 사이클에서 baseline 을 강화합니다.

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

`currentPassword` (변경 시 검증용) 는 `@NotBlank` 만 — 이미 등록된 비밀번호라 정책 검증 X.

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

- ❌ 복잡도 정책 변경 시 코드 변경 (regex 수정)
- ❌ blacklist 미통합 — 별도 검증 코드
- ❌ 에러 메시지 1줄 (어떤 정책 위반인지 모름)

### 옵션 B — 커스텀 `@ValidPassword` ★ 채택

- 정책 properties 분리 → 운영자가 .env 로 조정
- blacklist 통합
- 위반 정책별 메시지 분기
- ConstraintValidator 1개로 통합

### 옵션 C — Spring Security `PasswordEncoder` 수준 검증

- ❌ Spring Security 의 PasswordEncoder 는 hashing/검증만 — 정책 검증 X
- ❌ 별도 라이브러리 (Passay 등) 필요 — 의존성 ↑

### 옵션 D — haveibeenpwned API (실 leak DB 조회)

- 강력 — 실 leak 된 비밀번호 차단
- ❌ 외부 API 호출 → 회원가입 latency ↑
- ❌ k-anonymity 사용해도 응답 size 큼
- 별도 사이클 (출시 후 비즈니스 결정)

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
