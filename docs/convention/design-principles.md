# Design Principles

> **유형**: Explanation · **독자**: Level 2 · **읽는 시간**: ~15분

**설계 근거**: [ADR-011 (레이어드 + 포트/어댑터)](../philosophy/adr-011-layered-port-adapter.md) · [ADR-016 (DTO Mapper 금지)](../philosophy/adr-016-dto-mapper-forbidden.md)

이 문서는 코드 작성 시 참조하는 **설계 원칙** 을 정리합니다.

원칙은 절대 규칙이 아닙니다. 상황에 맞게 적용하고, 지키기 위해 지키는 게 아니라 **코드를 더 이해하기 쉽고 유지하기 쉽게 만들기 위해** 적용합니다.

---

## 한 문장 요약

이 문서는 코드 작성 시 판단 기준이 되는 **설계 원칙 7 가지** (SOLID · DRY · YAGNI · 포트/어댑터 · 의존 방향 · TDD · Fail Fast) 를 설명합니다. 절대 규칙이 아니라 **상황별 판단 기준**.

---

## SOLID

### S — Single Responsibility Principle

**"한 클래스는 한 가지 이유로만 변경되어야 한다"** 는 원칙입니다.

#### 적용 예시

Good:

```java
// EmailAuthService: 이메일 로그인만 담당
@Service
class EmailAuthService {
    User signUp(SignUpRequest request) { ... }
    User signIn(SignInRequest request) { ... }
}

// AppleSignInService: Apple 로그인만 담당
@Service
class AppleSignInService {
    User signIn(String identityToken) { ... }
}
```

Bad:

```java
// 한 클래스가 모든 인증 방식 + 토큰 발급 + 이메일 발송까지 담당
@Service
class AuthService {
    User signUpWithEmail(...) { ... }
    User signInWithApple(...) { ... }
    User signInWithGoogle(...) { ... }
    String issueJwt(...) { ... }
    void sendVerificationEmail(...) { ... }
    void resetPassword(...) { ... }
    // ... 200줄 이상
}
```

#### 실전 판단

"한 클래스가 몇 줄인가" 는 기준이 아닙니다. **"이 클래스를 수정할 이유가 여러 개인가"** 를 봅니다.

- 이메일 로그인 로직이 바뀐다 → `EmailAuthService` 수정
- Apple 로그인 검증 방식이 바뀐다 → `AppleSignInService` 수정
- JWT 알고리즘이 바뀐다 → `JwtService` 수정

이 세 가지가 **서로 다른 이유** 라면 분리된 상태가 맞습니다.

### O — Open/Closed Principle

**"확장에는 열려있고, 수정에는 닫혀있다"** 는 원칙입니다.

새 기능 추가 시 기존 코드를 수정하지 않고 **새 클래스를 추가** 하는 방식으로 해결할 수 있어야 합니다.

#### 적용 예시

이 템플릿의 `EmailPort` 는 OCP 를 적용한 예시입니다.

```java
// core-auth-api
public interface EmailPort {
    void send(String to, String subject, String htmlBody);
}

// core-auth-impl
@Component
class ResendEmailAdapter implements EmailPort {
    public void send(String to, String subject, String htmlBody) {
        // Resend API 호출
    }
}
```

나중에 SendGrid 로 바꾸고 싶으면? `SendGridEmailAdapter implements EmailPort` 를 새로 추가하면 끝입니다. `EmailVerificationService` 나 `PasswordResetService` 같은 소비자 코드는 전혀 수정할 필요 없습니다.

#### 실전 판단

모든 코드를 OCP 에 맞춰 미리 추상화하면 과잉 엔지니어링이 됩니다. **"이 부분이 바뀔 가능성이 실제로 높은가"** 를 판단하고, 그런 경우에만 인터페이스로 분리합니다.

이 템플릿에서 인터페이스로 분리한 것들:

- `EmailPort` — 이메일 서비스(Resend/SendGrid/AWS SES) 교체 가능성
- `PushPort` — 푸시 서비스(FCM/APNs/OneSignal) 교체 가능성
- `StoragePort` — 객체 저장소 (MinIO/AWS S3 호환) 교체 가능성. 현재 구현: `MinIOStorageAdapter` + `InMemoryStorageAdapter`. Signed URL 패턴으로 업로드/다운로드는 클라이언트가 직접 수행.
- `BillingPort` — 결제 백엔드(Apple/Google/RevenueCat) 교체 가능성

반대로 분리하지 않은 것들:

- `UserRepository` 를 인터페이스로 분리 안 함 — DB 종류를 바꿀 일 없음 (Postgres 고정)
- `ApiResponse` 를 인터페이스로 분리 안 함 — 응답 포맷을 추상화할 이유 없음

### L — Liskov Substitution Principle

**"서브타입은 언제든 상위 타입으로 교체 가능해야 한다"** 는 원칙입니다.

#### 적용 예시

```java
// Good
public interface EmailPort {
    void send(String to, String subject, String html);
}

@Component
class ResendEmailAdapter implements EmailPort {
    public void send(String to, String subject, String html) {
        // 정상 호출: Resend API 로 발송
        // 예외 발생 시: EmailDeliveryException (인터페이스 계약에 명시)
    }
}
```

Bad:

```java
// Liskov 위반
@Component
class BadEmailAdapter implements EmailPort {
    public void send(String to, String subject, String html) {
        if (to.endsWith("@example.com")) {
            throw new IllegalArgumentException("example.com 은 지원하지 않음");
        }
        // 나머지 발송
    }
}
```

소비자 코드는 `EmailPort.send()` 를 호출할 때 "모든 유효한 이메일 주소에 작동한다" 고 기대합니다. 특정 도메인을 예외로 내는 것은 계약 위반입니다.

#### 실전 판단

**"이 구현체로 교체해도 소비자 코드가 깨지지 않는가"** 를 확인합니다. 특별한 예외 처리가 필요한 구현체를 만들면 안 됩니다.

### I — Interface Segregation Principle

**"한 인터페이스에 너무 많은 메서드를 넣지 말라"** 는 원칙입니다. 클라이언트는 자기가 쓰지 않는 메서드까지 의존하면 안 됩니다.

#### 적용 예시

Good:

```java
public interface UserPort {
    UserSummary findById(Long id);
    UserProfile findProfileById(Long id);
}

public interface UserMutationPort {
    UserProfile updateProfile(Long id, UpdateProfileRequest request);
    void delete(Long id);
}
```

Bad:

```java
public interface UserPort {
    UserSummary findById(Long id);
    UserProfile findProfileById(Long id);
    UserProfile updateProfile(Long id, UpdateProfileRequest request);
    void delete(Long id);
    void banUser(Long id, String reason);
    void unbanUser(Long id);
    List<UserAuditLog> getAuditLog(Long id);
    // ... 20 개 메서드
}
```

#### 실전 판단

우리 템플릿에서는 **`UserPort` 하나로 통합** 합니다. 이유는 이 포트가 비교적 작고 (10개 이하), 소비자(앱 모듈) 가 대부분의 메서드를 사용하기 때문입니다.

인터페이스가 커지면 나누는 것을 고려합니다 — 기준: **"어떤 소비자가 일부 메서드만 쓰고 나머지는 쓰지 않는가"**.

### D — Dependency Inversion Principle

**"상위 레벨 모듈은 하위 레벨 모듈을 의존하지 말고, 둘 다 추상에 의존하라"** 는 원칙입니다.

#### 적용 예시

이 템플릿 전체가 DIP 의 적용입니다.

```
[앱 모듈]           (상위 레벨: "유저 정보가 필요함")
   │
   │ 의존
   ▼
[UserPort]         (추상: "유저를 조회할 수 있음")
   △
   │ 구현
   │
[UserServiceImpl]   (하위 레벨: "Postgres 에서 JPA 로 조회")
```

앱 모듈은 `UserServiceImpl` 을 직접 의존하지 않습니다. `UserPort` 인터페이스만 의존합니다. Spring 이 런타임에 `UserServiceImpl` 을 주입합니다.

이렇게 하면:

- 앱 모듈 테스트 시 `UserPort` 의 mock 을 주입 가능
- Extraction 시 `UserPort` 구현을 HTTP 클라이언트로 교체 가능
- 내부 구현 변경(JPA → JDBC 등) 시 앱 모듈 수정 불필요

#### 실전 판단

**모든 의존을 인터페이스로 만들 필요는 없습니다.** DIP 는 "모듈 경계에서" 적용합니다. 같은 모듈 안의 클래스끼리는 구체 클래스에 직접 의존해도 됩니다.

경계 판단 기준:

- **다른 Gradle 모듈이 쓰는가** → 인터페이스 필요 (`core-*-api`)
- **외부 서비스에 의존하는가** → 인터페이스 고려 (`EmailPort`, `PushPort`)
- **같은 모듈 내부에서만 쓰이는가** → 인터페이스 불필요 (`EmailAuthService` 등)

---

## DRY (Don't Repeat Yourself)

**"같은 지식을 여러 곳에 반복하지 말라"** 는 원칙입니다.

### 적용 예시

공통 응답 포맷 `ApiResponse<T>` 를 `common-web` 에 정의해서 모든 컨트롤러가 재사용합니다. 각 컨트롤러가 자기 응답 포맷을 따로 정의하지 않습니다.

### 실전 판단

**"세 번째 반복이 나타나기 전까지 추상화하지 않는다"** — Rule of Three.

첫 번째 코드는 혼자입니다. 두 번째 코드는 "패턴이 생기는 중" 입니다. 세 번째가 나타나야 비로소 공통점이 확실해집니다.

#### 예시

```java
// 첫 번째 API: UserController
@GetMapping("/me")
public ApiResponse<UserProfile> getMyProfile(...) {
    return ApiResponse.ok(service.findProfileById(userId));
}

// 두 번째 API: DeviceController
@GetMapping("/{id}")
public ApiResponse<DeviceDto> getDevice(@PathVariable Long id, ...) {
    return ApiResponse.ok(service.findById(id));
}
```

이 시점에서 "공통 조회 패턴을 추상화하자" 는 유혹이 오지만 **아직 이르면 기다립니다.** 세 번째, 네 번째 컨트롤러가 생겼을 때 진짜 공통점이 뭔지 명확해지고, 그때 추상화해도 늦지 않습니다.

### DRY 가 적용되지 않는 경우

**설정 파일의 중복** 은 DRY 대상이 아닙니다. `application-dev.yml` 과 `application-prod.yml` 에 같은 구조가 있지만, 환경별로 독립적으로 관리되어야 하므로 공통화하지 않습니다.

**유사해 보이지만 다른 이유로 생긴 코드** 는 DRY 대상이 아닙니다. "지금은 같지만 각자 다른 이유로 변할" 코드는 합치면 나중에 분리하기가 더 어렵습니다.

---

## YAGNI (You Aren't Gonna Need It)

**"지금 필요하지 않은 기능은 만들지 말라"** 는 원칙입니다.

### 적용 예시

Phase 0 에서 다음을 **명시적으로 제외** 했습니다.

- `core-billing-impl` 실제 구현 → 첫 유료 앱 준비 시점까지 대기
- `core-sync-*` 델타 동기화 → 첫 앱이 진짜 필요로 할 때
- Kakao Sign In → 한국 타겟 앱 출시 직전
- 관리자 대시보드 UI → 직접 psql 로 충분
- 2FA / MFA → 금융 앱 수준이 되면

각 항목은 **"지금 당장 필요한가"** 를 물어서 아니면 뺐습니다.

### 실전 판단

YAGNI 위반 신호:

- "혹시 나중에 필요할 수 있으니까" 만드는 추상화
- "언젠가 다른 DB 로 바꿀 수도" 있어서 만드는 Repository 인터페이스
- "미래를 위해" 넣는 설정 플래그
- "혹시 몰라서" 추가하는 로그

**기준:** 현재 또는 가까운 미래의 실제 요구에 답하는 코드만 작성합니다. 가정에 기반한 추상화는 대부분 틀리며, 나중에 진짜 요구가 나타났을 때 그 가정과 다르게 생겨서 버립니다.

### YAGNI vs. 미래 보험

YAGNI 와 "Extract 보험" (`core-*-api/impl` 분리) 은 상충되어 보일 수 있습니다.

차이는 **비용** 입니다.

- `core-*-api/impl` 분리 — 초기 비용 낮음 (인터페이스 1개 + 구현 1개), 이득 큼 (Extraction 가능성). **가치가 분명한 투자**.
- 가상의 미래 플러그인 시스템 — 초기 비용 높음 (플러그인 로더, 라이프사이클, 격리), 이득 불확실. **투기성 투자**.

YAGNI 는 투기성 투자를 막는 것이지, 모든 미래 대비를 막는 것이 아닙니다.

---

## 포트/어댑터 패턴 (Hexagonal Architecture)

이 템플릿의 `core-*-api/impl` 분리는 포트/어댑터 패턴의 적용입니다.

### 개념

- **포트 (Port)**: 도메인이 외부와 소통하는 인터페이스. `core-*-api` 의 `XxxPort`.
- **어댑터 (Adapter)**: 포트를 실제 기술에 연결하는 구현. `core-*-impl` 또는 외부 서비스 어댑터(`ResendEmailAdapter`, `FcmPushAdapter` 등).
- **도메인 코어**: 포트만 알고 어댑터는 모름. 기술 비종속.

### 적용 예시

```
[core-user-impl (도메인 코어)]
        │
        │ 의존
        ▼
[EmailPort] ←────────── 인터페이스 (core-auth-api 에 정의)
        △
        │ 구현
        │
[ResendEmailAdapter] ←── 어댑터 (core-auth-impl 에 위치)
        │
        │ 호출
        ▼
[Resend API]
```

도메인 코어는 "이메일을 보낸다" 만 알면 되고, "Resend API 를 HTTP POST 한다" 는 어댑터의 책임입니다.

### 장점

- 도메인 로직 테스트 시 어댑터를 mock 으로 교체 가능
- 어댑터를 바꿔도 도메인 변경 없음 (Resend → SendGrid 등)
- 외부 서비스의 장애가 도메인으로 전파되지 않음 (어댑터가 예외 변환)

---

## 의존 방향

**의존은 아래로만 흐릅니다.**

```
bootstrap
    ↓
core-*-impl
    ↓
core-*-api
    ↓
common-*
```

역방향 의존(예: `common-web` 이 `core-auth-api` 를 의존) 은 금지됩니다. 이 규칙은 Gradle 빌드와 ArchUnit 으로 강제됩니다.

### 왜 한 방향만 허용하는가

**순환 의존이 생기면 모듈을 독립적으로 이해할 수 없습니다.** A 를 이해하려면 B 를 이해해야 하고, B 를 이해하려면 A 를 이해해야 하는 상황이 되면 "어디서부터 읽어야 하나" 가 불분명해집니다.

**추출 가능성이 깨집니다.** 한 앱을 독립 서비스로 빼려 할 때, 해당 앱이 의존하는 모든 것을 같이 가져가야 합니다. 순환 의존이 있으면 "일부만 가져간다" 가 불가능합니다.

---

## 테스트 우선 (TDD)

**"구현 전에 실패하는 테스트를 먼저 작성한다"** 는 원칙입니다.

### 적용 예시

```java
// 1. 먼저 실패하는 테스트
@Test
void shouldFindUserByEmail() {
    User saved = repository.save(new User("test@example.com", ...));
    Optional<User> found = userService.findByEmail("test@example.com");
    assertThat(found).isPresent().hasValueSatisfying(u -> {
        assertThat(u.getEmail()).isEqualTo("test@example.com");
    });
}

// 2. 테스트 실행 → 실패 확인 (findByEmail 메서드가 아직 없음)

// 3. 최소한의 구현
public Optional<User> findByEmail(String email) {
    return userRepository.findByEmail(email);
}

// 4. 테스트 실행 → 통과 확인

// 5. 리팩토링 (필요 시)

// 6. 커밋
```

### 실전 판단

TDD 는 모든 코드에 적용되는 원칙이 아닙니다. 다음은 TDD 가 어울립니다.

- 비즈니스 로직이 있는 서비스 클래스
- 경계 값 처리가 복잡한 함수
- 버그 수정 (먼저 버그를 재현하는 테스트 작성)

다음은 TDD 를 강제하지 않습니다.

- 설정 클래스 (`@Configuration`)
- DTO (데이터만 담는 클래스)
- 간단한 getter/setter
- 프로토타입/탐색 코드

### 테스트의 목적

테스트는 **정답 검증** 이 아니라 **다음의 목적** 을 달성하기 위해 씁니다.

- **회귀 방지** — 나중에 수정할 때 기존 동작이 깨지지 않는지 확인
- **명세 표현** — 이 코드가 무엇을 해야 하는지 실행 가능한 문서로 남김
- **설계 피드백** — 테스트하기 어려운 코드는 설계가 잘못된 코드

---

## "빨리 실패하라" (Fail Fast)

**잘못된 상태를 발견하면 최대한 빨리 명시적으로 실패합니다.** 틀린 상태로 계속 진행하지 않습니다.

### 적용 예시

Good:

```java
public UserProfile findProfileById(Long id) {
    User user = userRepository.findById(id)
        .orElseThrow(() -> new UserException(UserError.USER_NOT_FOUND,
            Map.of("id", String.valueOf(id))));
    return user.toProfile();
}
```

Bad:

```java
public UserProfile findProfileById(Long id) {
    User user = userRepository.findById(id).orElse(null);
    if (user == null) {
        return new UserProfile(null, null, null);  // 빈 객체 반환
    }
    return user.toProfile();
}
```

두 번째 버전은 "유저가 없을 때" 를 빈 객체로 은닉합니다. 호출자는 문제를 인식하지 못한 채 빈 객체를 사용하다가 다른 곳에서 NullPointerException 으로 터집니다. **원인과 증상이 멀어질수록 디버깅이 어렵습니다.**

### 실전 판단

**입력 검증** 은 가장 바깥(컨트롤러) 에서 한 번만 수행합니다. 내부 서비스는 이미 검증된 입력을 신뢰합니다.

**잘못된 상태** 는 예외로 명시적으로 던집니다. null 반환, 빈 리스트 반환, 0 반환 같은 "조용한 실패" 는 피합니다.

---

## 요약 체크리스트

코드를 작성하거나 리뷰할 때 체크할 것들:

- [ ] 이 클래스는 한 가지 책임만 가지는가?
- [ ] 새 기능 추가 시 기존 코드를 수정하지 않고 추가 가능한가?
- [ ] 모듈 경계에서 인터페이스로 의존하고 있는가?
- [ ] 같은 지식이 여러 곳에 반복되지 않는가?
- [ ] "혹시 나중에" 를 이유로 만든 코드가 있는가? (YAGNI)
- [ ] 의존은 한 방향으로만 흐르는가?
- [ ] 잘못된 입력이 조용히 넘어가지 않고 빨리 실패하는가?
- [ ] 비즈니스 로직에 대한 테스트가 있는가?

---

이 원칙들은 **서로 돕기도 하고 충돌하기도** 합니다. 충돌할 때는 **"유지보수하기 쉬운가"** 를 최종 기준으로 삼습니다.

---

## 관련 문서

- [`./naming.md`](./naming.md) — 네이밍 규칙 (Design Principles 의 "일관된 표현" 구현)
- [`./records-and-classes.md`](./records-and-classes.md) — record vs class 선택 기준
- [`../journey/philosophy/adr-011-layered-port-adapter.md`](../philosophy/adr-011-layered-port-adapter.md) — 포트/어댑터 패턴 채택 근거
- [`../journey/philosophy/adr-016-dto-mapper-forbidden.md`](../philosophy/adr-016-dto-mapper-forbidden.md) — Mapper 금지 결정
- [`../testing/testing-strategy.md`](../production/test/testing-strategy.md) — TDD 실천 규약
