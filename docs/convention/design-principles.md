# Design Principles

> **유형**: Explanation · **독자**: Level 2 · **읽는 시간**: ~15분

**설계 근거**: [ADR-011 · 레이어드 + 포트/어댑터](../philosophy/adr-011-layered-port-adapter.md) · [ADR-016 · DTO Mapper 금지](../philosophy/adr-016-dto-mapper-forbidden.md)

이 문서는 코드를 쓰거나 리뷰할 때 판단 기준이 되는 설계 원칙을 정리해요. 원칙은 절대 규칙이 아니에요. 지키기 위해 지키는 게 아니라, 코드를 더 이해하기 쉽고 유지하기 쉽게 만들기 위해 상황에 맞게 적용합니다.

---

## 한 문장 요약

이 문서는 코드 작성 시 판단 기준이 되는 일곱 가지 설계 원칙을 설명해요 — SOLID·DRY·YAGNI·포트/어댑터·의존 방향·TDD·Fail Fast. 절대 규칙이 아니라 상황별 판단 기준이에요.

---

## SOLID

### S — Single Responsibility Principle

한 클래스는 한 가지 이유로만 변경되어야 한다는 원칙이에요.

#### 적용 예시

Good — 인증 방식마다 책임이 분리돼 있어요.

```java
// EmailAuthService: 이메일 로그인만 담당 (core-auth-impl)
@Service
class EmailAuthService {
    AuthResponse signUpWithEmail(SignUpRequest request) { ... }
    AuthResponse signInWithEmail(SignInRequest request) { ... }
}

// AppleSignInService: Apple 로그인 검증만 담당 (core-auth-impl)
@Service
class AppleSignInService {
    AppleIdentity verifyIdentityToken(String identityToken) { ... }
}
```

Bad — 한 클래스가 모든 인증 방식과 토큰 발급, 이메일 발송까지 떠안았어요.

```java
@Service
class AuthService {
    AuthResponse signUpWithEmail(...) { ... }
    AuthResponse signInWithApple(...) { ... }
    AuthResponse signInWithGoogle(...) { ... }
    String issueAccessToken(...) { ... }
    void sendVerificationEmail(...) { ... }
    void resetPassword(...) { ... }
    // ... 200줄 이상
}
```

#### 실전 판단

"한 클래스가 몇 줄인가" 는 기준이 아니에요. 이 클래스를 수정할 이유가 여러 개인가를 봐요.

- 이메일 로그인 로직이 바뀐다 → `EmailAuthService` 수정
- Apple 로그인 검증 방식이 바뀐다 → `AppleSignInService` 수정
- JWT 알고리즘이 바뀐다 → `JwtService` 수정

이 세 가지가 서로 다른 이유라면 분리된 상태가 맞아요. 실제로 이 템플릿은 이메일·Apple·Google·Kakao·Naver 로그인을 각각 별도 서비스로 두고, 토큰 발급은 `common-security` 의 `JwtService` 로 따로 빼 두었어요.

### O — Open/Closed Principle

확장에는 열려 있고 수정에는 닫혀 있다는 원칙이에요. 새 기능을 추가할 때 기존 코드를 고치지 않고 새 클래스를 더하는 방식으로 해결할 수 있어야 해요.

#### 적용 예시

이 템플릿의 `EmailPort` 가 OCP 를 적용한 예시예요. Port 는 `core-email-api` 에 있고, 구현(어댑터)은 `core-email-impl` 에 있어요.

```java
// core-email-api
public interface EmailPort {
    void send(String to, String subject, String htmlBody);
}

// core-email-impl
@Component
class ResendEmailAdapter implements EmailPort {
    public void send(String to, String subject, String htmlBody) {
        // Resend API 호출
    }
}
```

나중에 SendGrid 로 바꾸고 싶으면 `SendGridEmailAdapter implements EmailPort` 를 새로 추가하면 끝이에요. `EmailPort` 를 주입받아 쓰는 `EmailAuthService`·`PasswordResetService` 같은 소비자 코드는 전혀 수정할 필요가 없습니다. 실제로 `RESEND_API_KEY` 가 없으면 `LoggingEmailAdapter` 로 자동 fallback 하는데, 이것도 같은 Port 를 구현한 또 하나의 어댑터예요.

#### 실전 판단

모든 코드를 OCP 에 맞춰 미리 추상화하면 과잉 엔지니어링이 됩니다. 이 부분이 실제로 바뀔 가능성이 높은가를 먼저 판단하고, 그런 경우에만 인터페이스로 분리해요.

이 템플릿에서 인터페이스로 분리한 Port 들이에요.

| Port | 모듈 | 교체 가능성 |
|---|---|---|
| `EmailPort` | core-email-api | 이메일 서비스 (Resend·SendGrid·AWS SES) |
| `PushPort` | core-push-api | 푸시 서비스 (FCM·APNs·OneSignal) |
| `StoragePort` | core-storage-api | 객체 저장소 (MinIO·AWS S3 호환). 현재 구현은 `MinIOStorageAdapter`·`InMemoryStorageAdapter`. Signed URL 방식이라 업로드/다운로드는 클라이언트가 직접 수행해요 |
| `BillingPort` | core-billing-api | 구독·플랜 정책 계층 (활성화·취소·webhook 처리). 채널 무관 비즈니스 로직 (ADR-019·020) |
| `IapPort` | core-iap-api | Apple StoreKit·Google Play receipt 검증 채널 |
| `PaymentPort` | core-payment-api | PG (포트원) 직접 결제 채널 — verify·refund |

반대로 분리하지 않은 것들이에요.

- `UserRepository` 는 인터페이스로 분리 안 함 — DB 종류를 바꿀 일이 없어요 (Postgres 고정). Spring Data JPA 인터페이스 그대로 사용해요.
- `ApiResponse` 는 인터페이스로 분리 안 함 — 응답 포맷을 추상화할 이유가 없어요. `common-web` 의 `record` 하나로 충분해요.

### L — Liskov Substitution Principle

서브타입은 언제든 상위 타입으로 교체 가능해야 한다는 원칙이에요.

#### 적용 예시

Good — 어떤 유효한 이메일 주소에도 동일하게 동작해요.

```java
// core-email-api
public interface EmailPort {
    void send(String to, String subject, String htmlBody);
}

// core-email-impl
@Component
class ResendEmailAdapter implements EmailPort {
    public void send(String to, String subject, String htmlBody) {
        // 정상 호출: Resend API 로 발송
        // 발송 실패 시: RuntimeException (인터페이스 계약에 명시)
    }
}
```

Bad — 특정 도메인만 예외로 거절하면 계약을 위반해요.

```java
@Component
class BadEmailAdapter implements EmailPort {
    public void send(String to, String subject, String htmlBody) {
        if (to.endsWith("@example.com")) {
            throw new IllegalArgumentException("example.com 은 지원하지 않음");
        }
        // 나머지 발송
    }
}
```

소비자 코드는 `EmailPort.send()` 를 호출할 때 "모든 유효한 이메일 주소에 작동한다" 고 기대해요. 특정 도메인을 예외로 내는 것은 계약 위반입니다.

#### 실전 판단

이 구현체로 교체해도 소비자 코드가 깨지지 않는가를 확인해요. 특별한 예외 처리가 필요한 구현체를 만들면 안 됩니다.

### I — Interface Segregation Principle

한 인터페이스에 너무 많은 메서드를 넣지 말라는 원칙이에요. 클라이언트는 자기가 쓰지 않는 메서드까지 의존하면 안 됩니다.

#### 적용 예시

조회와 변경을 한 포트에 몰아넣을지, 나눌지의 선택이에요.

Good — 읽기 책임과 쓰기 책임이 분리돼 있어요.

```java
public interface UserReadPort {
    UserSummary getSummary(long userId);
    UserProfile getProfile(long userId);
}

public interface UserMutationPort {
    UserProfile updateProfile(long userId, UpdateProfileRequest request);
    void softDelete(long userId);
}
```

Bad — 조회만 필요한 소비자도 ban·audit 같은 관리 메서드까지 의존하게 돼요.

```java
public interface UserPort {
    UserSummary getSummary(long userId);
    UserProfile getProfile(long userId);
    UserProfile updateProfile(long userId, UpdateProfileRequest request);
    void softDelete(long userId);
    void banUser(long userId, String reason);
    void unbanUser(long userId);
    List<UserAuditLog> getAuditLog(long userId);
    // ... 메서드가 계속 늘어남
}
```

#### 실전 판단

우리 템플릿에서는 `UserPort` 하나로 통합해요. 이 포트의 소비자(앱 모듈)가 조회·생성·소셜 연동·TOTP 등 대부분의 메서드를 실제로 쓰기 때문이에요. 작은 포트를 인위로 쪼개면 오히려 주입 지점만 늘어나요.

인터페이스가 커지면 나누는 것을 고려해요. 기준은 어떤 소비자가 일부 메서드만 쓰고 나머지는 전혀 쓰지 않는가예요. 그런 소비자가 생기는 순간이 분리 시그널이에요.

### D — Dependency Inversion Principle

상위 레벨 모듈은 하위 레벨 모듈을 의존하지 말고, 둘 다 추상에 의존하라는 원칙이에요.

#### 적용 예시

이 템플릿의 `-api` / `-impl` 분리 전체가 DIP 의 적용이에요.

```
[앱 모듈]            (상위 레벨: "유저 정보가 필요함")
   │
   │ 의존
   ▼
[UserPort]          (추상: "유저를 조회할 수 있음", core-user-api)
   △
   │ 구현
   │
[UserServiceImpl]   (하위 레벨: "Postgres 에서 JPA 로 조회", core-user-impl)
```

앱 모듈은 `UserServiceImpl` 을 직접 의존하지 않습니다. `core-user-api` 의 `UserPort` 인터페이스만 의존해요. Spring 이 런타임에 `UserServiceImpl` 을 주입합니다. 이 방향은 ArchUnit r1 (앱은 `core-*-impl` 의존 금지)으로 빌드 시점에 강제돼요.

이렇게 하면 다음과 같은 이점이 있습니다.

- 앱 모듈 테스트 시 `UserPort` 의 fake/mock 을 주입할 수 있어요
- 추출(Extraction) 시 `UserPort` 구현을 HTTP 클라이언트로 교체할 수 있어요
- 내부 구현을 바꿔도 (JPA → JDBC 등) 앱 모듈은 수정할 필요가 없어요

#### 실전 판단

모든 의존을 인터페이스로 만들 필요는 없습니다. DIP 는 모듈 경계에서 적용해요. 같은 모듈 안의 클래스끼리는 구체 클래스에 직접 의존해도 됩니다.

경계 판단 기준이에요.

- **다른 Gradle 모듈이 쓰는가** → 인터페이스 필요 (`core-*-api` 의 Port)
- **외부 서비스에 의존하는가** → 인터페이스 고려 (`EmailPort`·`PushPort`)
- **같은 모듈 내부에서만 쓰이는가** → 인터페이스 불필요 (`EmailAuthService` 등)

---

## DRY (Don't Repeat Yourself)

같은 지식을 여러 곳에 반복하지 말라는 원칙이에요.

### 적용 예시

공통 응답 포맷 `ApiResponse<T>` 를 `common-web` 에 정의해서 모든 컨트롤러가 재사용합니다. 각 컨트롤러가 자기 응답 포맷을 따로 정의하지 않아요.

### 실전 판단

"세 번째 반복이 나타나기 전까지 추상화하지 않는다" — Rule of Three 예요. 첫 번째 코드는 혼자예요. 두 번째 코드는 패턴이 생기는 중이에요. 세 번째가 나타나야 비로소 공통점이 확실해져요.

```java
// 첫 번째 API: UserController
@GetMapping("/me")
public ApiResponse<UserProfile> getMyProfile(...) {
    return ApiResponse.ok(userPort.getProfile(userId));
}

// 두 번째 API: DeviceController
@GetMapping("/{id}")
public ApiResponse<DeviceDto> getDevice(@PathVariable Long id, ...) {
    return ApiResponse.ok(devicePort.getDevice(id));
}
```

이 시점에서 "공통 조회 패턴을 추상화하자" 는 유혹이 오지만 아직 이르면 기다려요. 세 번째, 네 번째 컨트롤러가 생겼을 때 진짜 공통점이 무엇인지 명확해지고, 그때 추상화해도 늦지 않습니다.

### DRY 가 적용되지 않는 경우

설정 파일의 중복은 DRY 대상이 아니에요. `application-dev.yml` 과 `application-prod.yml` 에 같은 구조가 있지만, 환경별로 독립적으로 관리되어야 하니까 공통화하지 않습니다.

유사해 보이지만 다른 이유로 생긴 코드도 DRY 대상이 아니에요. 지금은 같지만 각자 다른 이유로 변할 코드는 합치면 나중에 분리하기가 더 어려워요.

---

## YAGNI (You Aren't Gonna Need It)

지금 필요하지 않은 기능은 만들지 말라는 원칙이에요.

### 적용 예시

Phase 0 에서 다음을 명시적으로 제외했어요. 각 항목은 지금 당장 필요한가를 물어서 아니면 뺐고, 필요해진 시점에 하나씩 구현했습니다.

- `core-iap-impl` 실제 구현 (Apple StoreKit 2·Google Play Verifier) → 첫 IAP 앱 준비 시점까지 대기 → 이후 구현 완료 (`AppleAppStoreAdapter`·`GooglePlayAdapter`)
- `core-sync-*` 델타 동기화 → 첫 앱이 진짜 필요로 할 때 (아직 미구현 — 유일하게 남은 항목)
- Kakao Sign In → 한국 타겟 앱 출시 직전 → 이후 구현 완료 (`KakaoSignInService`, Naver 포함)
- 관리자 대시보드 UI → 직접 psql 로 충분 → 이후 운영 콘솔 (`core-admin` + template-react-admin) 로 구현 완료
- 2FA·MFA → 금융 앱 수준이 되면 → 이후 TOTP 2FA 구현 완료

미리 만들지 않고 미룬 항목 대부분이 결국 구현됐지만, 그게 YAGNI 실패가 아니에요. 필요가 실제로 확인된 시점에 만들었기 때문에 추측 설계 비용 없이 진행됐다는 게 핵심입니다.

### 실전 판단

YAGNI 위반 신호는 다음과 같아요.

- "혹시 나중에 필요할 수 있으니까" 만드는 추상화
- "언젠가 다른 DB 로 바꿀 수도" 있어서 만드는 Repository 인터페이스
- "미래를 위해" 넣는 설정 플래그
- "혹시 몰라서" 추가하는 로그

기준은 현재나 가까운 미래의 실제 요구에 답하는 코드만 작성하는 거예요. 가정에 기반한 추상화는 대부분 틀리고, 나중에 진짜 요구가 나타났을 때 그 가정과 다르게 생겨서 버려져요.

### YAGNI vs. 미래 보험

YAGNI 와 "Extract 보험"(`core-*-api` / `-impl` 분리)은 상충되어 보일 수 있습니다. 차이는 비용이에요.

- `core-*-api` / `-impl` 분리는 초기 비용이 낮고(인터페이스 1개 + 구현 1개) 이득이 커요(추출 가능성). 가치가 분명한 투자입니다.
- 가상의 미래 플러그인 시스템은 초기 비용이 높고(플러그인 로더·라이프사이클·격리) 이득이 불확실해요. 투기성 투자입니다.

YAGNI 는 투기성 투자를 막는 것이지, 모든 미래 대비를 막는 것이 아니에요.

---

## 포트/어댑터 패턴 (Hexagonal Architecture)

이 템플릿의 `core-*-api` / `-impl` 분리는 포트/어댑터 패턴의 적용이에요.

### 개념

- **Port** — 도메인이 외부와 소통하는 인터페이스. `core-*-api` 의 `XxxPort`.
- **Adapter** — Port 를 실제 기술에 연결하는 구현. Primary Adapter 는 `core-*-impl` 의 `*ServiceImpl`(Port 구현 + 비즈니스 로직), Secondary Adapter 는 `ResendEmailAdapter`·`FcmPushAdapter` 같은 외부 시스템 연결 구현이에요.
- **도메인 코어** — Port 만 알고 어댑터는 모름. 기술에 종속되지 않아요.

용어 매핑은 [ADR-011 의 역할 매핑 표](../philosophy/adr-011-layered-port-adapter.md)에 정리돼 있어요.

### 적용 예시

인증 도메인이 이메일을 보낼 때의 흐름이에요. `core-auth-impl` 의 서비스가 `core-email-api` 의 `EmailPort` 만 알고, 실제 발송은 `core-email-impl` 의 어댑터가 맡아요.

```
[core-auth-impl: EmailAuthService]   (도메인 코어)
        │
        │ 의존
        ▼
[EmailPort]  ←──────────── 인터페이스 (core-email-api 에 정의)
        △
        │ 구현
        │
[ResendEmailAdapter]  ←──── 어댑터 (core-email-impl 에 위치)
        │
        │ 호출
        ▼
[Resend API]
```

도메인 코어는 "이메일을 보낸다" 만 알면 되고, "Resend API 로 HTTP POST 한다" 는 어댑터의 책임이에요. `EmailPort` 는 `core-email-api` 에 있어 auth·billing·운영 공지 등 여러 도메인이 같은 포트로 발송해요.

### 장점

- 도메인 로직을 테스트할 때 어댑터를 fake 로 교체할 수 있어요
- 어댑터를 바꿔도 도메인은 변하지 않아요 (Resend → SendGrid 등)
- 외부 서비스의 장애가 도메인으로 전파되지 않아요 — 어댑터가 예외를 변환합니다

---

## 의존 방향

의존은 아래로만 흘러요.

```
bootstrap
    ↓
core-*-impl
    ↓
core-*-api
    ↓
common-*
```

역방향 의존(예: `common-web` 이 `core-auth-api` 를 의존)은 금지됩니다. 이 규칙은 Gradle 빌드와 ArchUnit 으로 강제돼요 — `common-*` 은 `core-*` 를 의존하지 못하고(r4), `core-*-api` 는 `core-*-impl` 을 의존하지 못합니다(r6). 전체 22개 규칙은 [Architecture Rules](../structure/architecture-rules.md) 에 있어요.

### 왜 한 방향만 허용하는가

순환 의존이 생기면 모듈을 독립적으로 이해할 수 없습니다. A 를 이해하려면 B 를, B 를 이해하려면 A 를 이해해야 하는 상황이 되면 "어디서부터 읽어야 하나" 가 불분명해져요.

추출 가능성도 깨져요. 한 앱을 독립 서비스로 빼려 할 때, 그 앱이 의존하는 모든 것을 같이 가져가야 해요. 순환 의존이 있으면 "일부만 가져간다" 가 불가능해집니다.

---

## 테스트 우선 (TDD)

구현 전에 실패하는 테스트를 먼저 작성한다는 원칙이에요.

### 적용 예시

```java
// 1. 먼저 실패하는 테스트
@Test
void shouldFindUserByEmail() {
    userRepository.save(new User("test@example.com", ...));
    Optional<User> found = userRepository.findByEmail("test@example.com");
    assertThat(found).isPresent().hasValueSatisfying(u ->
        assertThat(u.getEmail()).isEqualTo("test@example.com"));
}

// 2. 테스트 실행 → 실패 확인 (findByEmail 메서드가 아직 없음)

// 3. 최소한의 구현 (UserRepository)
Optional<User> findByEmail(String email);

// 4. 테스트 실행 → 통과 확인

// 5. 리팩토링 (필요 시)

// 6. 커밋
```

### 실전 판단

TDD 는 모든 코드에 적용되는 원칙이 아니에요. 다음은 TDD 가 어울려요.

- 비즈니스 로직이 있는 서비스 클래스
- 경계 값 처리가 복잡한 함수
- 버그 수정 — 먼저 버그를 재현하는 테스트를 작성

다음은 TDD 를 강제하지 않습니다.

- 설정 클래스 (`@Configuration`)
- DTO (데이터만 담는 클래스)
- 간단한 getter/setter
- 프로토타입·탐색 코드

### 테스트의 목적

테스트는 정답 검증이 아니라 다음 목적을 달성하기 위해 써요.

- **회귀 방지** — 나중에 수정할 때 기존 동작이 깨지지 않는지 확인
- **명세 표현** — 이 코드가 무엇을 해야 하는지 실행 가능한 문서로 남김
- **설계 피드백** — 테스트하기 어려운 코드는 설계가 잘못된 코드

자세한 실천 규약은 [Testing Strategy](../production/test/testing-strategy.md) 를 참고하세요.

---

## 빨리 실패하라 (Fail Fast)

잘못된 상태를 발견하면 최대한 빨리 명시적으로 실패해요. 틀린 상태로 계속 진행하지 않습니다.

### 적용 예시

Good — 유저가 없으면 곧바로 도메인 예외를 던져요. 실제 `UserServiceImpl.findActiveUser()` 패턴이에요.

```java
// core-user-impl/UserServiceImpl.java 발췌
private User findActiveUser(long userId) {
    User user = userRepository
            .findById(userId)
            .orElseThrow(() ->
                new UserException(UserError.USER_NOT_FOUND,
                    Map.of("id", String.valueOf(userId))));
    if (user.isDeleted()) {
        throw new UserException(UserError.USER_NOT_FOUND,
            Map.of("id", String.valueOf(userId)));
    }
    return user;
}
```

Bad — 유저가 없을 때를 빈 객체로 숨기면 호출자가 문제를 인식하지 못해요.

```java
public UserProfile getProfile(long userId) {
    User user = userRepository.findById(userId).orElse(null);
    if (user == null) {
        return new UserProfile(null, null, null, ...);  // 빈 객체 반환
    }
    return user.toProfile();
}
```

두 번째 버전은 유저가 없을 때를 빈 객체로 은닉해요. 호출자는 문제를 인식하지 못한 채 빈 객체를 쓰다가 다른 곳에서 NullPointerException 으로 터져요. 원인과 증상이 멀어질수록 디버깅이 어려워집니다.

### 좁힌 catch + fail-secure fallback

외부 토큰 검증처럼 실패 경로가 많은 곳에서는, 좁힌 catch 들을 먼저 두고 그 위에 fail-secure fallback 하나만 허용해요. broad `catch (Exception)` 을 단독으로 쓰지 않습니다. 실제 `AppleSignInService` 의 검증 패턴이에요.

```java
// core-auth-impl/service/AppleSignInService.java 발췌
} catch (ExpiredJwtException e) {
    throw new AuthException(AuthError.SOCIAL_AUTH_FAILED, Map.of("provider", "apple"));
} catch (JwtException e) {
    throw new AuthException(AuthError.SOCIAL_AUTH_FAILED, Map.of("provider", "apple"));
} catch (AuthException e) {
    throw e;
} catch (Exception e) {
    // fail-secure: 예상 못 한 오류는 로그를 남기고 인증 실패로 처리
    log.warn("apple sign-in unexpected error during identity token verification", e);
    throw new AuthException(AuthError.SOCIAL_AUTH_FAILED, Map.of("provider", "apple"));
}
```

좁힌 catch 들이 알려진 실패를 도메인 예외로 변환하고, 맨 끝의 `catch (Exception)` 은 예상 못 한 오류를 "인증 통과" 가 아니라 "인증 실패" 로 닫아요. 이게 fail-secure 의 핵심이에요 — 모르는 상태에서는 안전한 쪽(거절)으로 닫힙니다.

### 입력 검증 위치

입력 검증은 가장 바깥(컨트롤러)에서 한 번만 수행해요. 내부 서비스는 이미 검증된 입력을 신뢰합니다.

잘못된 상태는 예외로 명시적으로 던져요. null 반환·빈 리스트 반환·0 반환 같은 조용한 실패는 피해요.

### null handling 정책

- **`findXxx()`** 는 `Optional<T>` 반환 — 호출자가 없을 수 있는 케이스를 처리. 예: `UserPort.findAccountByEmail()`.
- **`getXxx()`** 는 반드시 존재한다고 가정 — 없으면 도메인 예외를 throw. 예: `UserPort.getProfile()` 은 없으면 `UserException(USER_NOT_FOUND)`.
- **필드·파라미터** 는 `@NonNull` 을 기본 가정. null 이 가능하면 `Optional<T>` 또는 명시적 nullable 표시.
- **null 체크는 boundary 한 곳에서만** — 메서드 초반의 `Objects.requireNonNull()` 또는 Bean Validation(`@NotNull`). 내부 흐름은 non-null 을 가정합니다.

---

## 요약 체크리스트

코드를 작성하거나 리뷰할 때 점검할 것들이에요.

- [ ] 이 클래스는 한 가지 책임만 가지는가?
- [ ] 새 기능 추가 시 기존 코드를 수정하지 않고 추가가 가능한가?
- [ ] 모듈 경계에서 인터페이스로 의존하고 있는가?
- [ ] 같은 지식이 여러 곳에 반복되지 않는가?
- [ ] "혹시 나중에" 를 이유로 만든 코드가 있는가? (YAGNI)
- [ ] 의존은 한 방향으로만 흐르는가?
- [ ] 잘못된 입력이 조용히 넘어가지 않고 빨리 실패하는가?
- [ ] 비즈니스 로직에 대한 테스트가 있는가?

---

이 원칙들은 서로 돕기도 하고 충돌하기도 해요. 충돌할 때는 "유지보수하기 쉬운가" 를 최종 기준으로 삼아요.

---

## 관련 문서

- [Naming Conventions](./naming.md) — 네이밍 규칙 (Design Principles 의 "일관된 표현" 구현)
- [record vs class 선택 기준](./records-and-classes.md) — record 와 class 중 무엇을 쓸지
- [Architecture Reference](../structure/architecture.md) — 모듈 구조와 의존 그래프
- [Architecture Rules](../structure/architecture-rules.md) — ArchUnit r1~r22 명세
- [ADR-011 · 레이어드 아키텍처 + 포트/어댑터 패턴](../philosophy/adr-011-layered-port-adapter.md) — 포트/어댑터 채택 근거
- [ADR-016 · DTO 변환은 Entity 메서드로 (Mapper 클래스 금지)](../philosophy/adr-016-dto-mapper-forbidden.md) — Mapper 금지 결정
- [Testing Strategy](../production/test/testing-strategy.md) — TDD 실천 규약
