# ADR-011 · 모듈 안 레이어드 아키텍처 + 포트/어댑터 패턴

**Status**: Accepted. 현재 유효. 2026-04-20 기준 `core-*-impl` 6개 모듈 모두 동일 레이어 구조. ArchUnit 규칙 r13, r14, r15, r17, r21 이 위치 강제.

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~5분

## 결론부터

한 `core-*-impl` 모듈 안은 **전통적 Spring Boot 레이어드 아키텍처** (controller → service → repository → entity) 를 따릅니다. 차이점은 **모듈의 바깥 경계** 예요 — 외부(앱 모듈) 로 노출되는 것은 오직 `-api` 의 Port 인터페이스뿐, `-impl` 의 내부 클래스는 절대 노출 안 됩니다. 즉 **안쪽은 익숙한 레이어, 바깥은 엄격한 포트** 의 구조입니다. 우리에게 익숙한 Spring Boot 관용 (`@Service`, `@Repository`, `@Component`) 을 그대로 쓰면서 경계만 강하게 긋는 타협안이에요.

## 왜 이런 고민이 시작됐나?

[`ADR-001`](./adr-001-modular-monolith.md) 이 "전체 레포를 어떤 모듈로 나눌지" 를 정했고, [`ADR-003`](./adr-003-api-impl-split.md) 이 "core 도메인을 `-api` / `-impl` 로 어떻게 쪼갤지" 를 정했어요. 그러면 이제 다음 질문이 남습니다.

> **한 `core-*-impl` 모듈 안쪽의 코드를 어떤 구조로 배치할 것인가?**

이 질문이 답되지 않으면:
- 개발자마다 자기 스타일로 코드 배치 → 일관성 깨짐
- 비슷한 기능 찾을 때 매번 다른 곳 → 탐색 비용 ↑
- 리팩토링 시 "이 클래스 어디로 가야 하지?" 고민 반복

Spring Boot 생태계에는 **이미 널리 쓰이는 관용** 이 있어요 — 컨트롤러 / 서비스 / 리포지토리 / 엔티티의 4층 구조. 이걸 쓰느냐, 아니면 DDD 같은 더 복잡한 패턴으로 가느냐의 선택이 필요합니다.

또 하나 중요한 물음: **Port 인터페이스 (`-api` 의)** 와 **내부 레이어** 가 어떻게 연결되는가? Port 가 단순히 "파일이 다른 모듈에 있다" 수준인가, 아니면 "구조적 역할이 다른가"?

## 고민했던 대안들

### Option 1 — 레이어별 모듈 분리 (module-controller, module-service, module-repository)

각 레이어를 별도 Gradle 모듈로 분리. `auth-controller`, `auth-service`, `auth-repository` 같은 식.

- **장점**: 레이어 간 의존 방향이 Gradle 수준에서 강제됨 (controller → service → repository 만 허용).
- **단점**:
  - 기능 하나 수정에 **3개 모듈을 건드려야 함**. 작은 변경도 multi-module 수정이 되어버림.
  - 도메인 코드가 흩어져서 **전체 파악이 어려움** — "이 앱의 기능 전체" 를 보려면 3개 모듈을 왔다 갔다.
  - Gradle 모듈 수가 폭발적으로 증가 (6 도메인 × 3 레이어 = 18 모듈 + 기존 common/bootstrap).
- **탈락 이유**: 솔로 인디 스케일에서 과도한 구조화. 이점 (강제된 레이어 의존) 대비 비용 (모듈 폭증) 이 큼.

### Option 2 — DDD Aggregate 패턴 (feature 단위 패키지)

도메인을 Aggregate 로 쪼개고 feature 단위로 패키지 분리. 예: `auth/email-signup/`, `auth/social-signin/`, `auth/password-reset/` 식.

- **장점**: 기능 단위로 파일이 모여있음. 한 feature 수정 시 한 패키지만 건드림.
- **단점**:
  - **각 모듈이 5~10 클래스 수준** 에서는 feature 분리의 이득이 없음. 오히려 패키지 수만 많아져서 탐색 어려움.
  - DDD 는 복잡한 도메인 (은행, ERP) 에서 가치. 우리 스케일 (인증, 푸시, 결제 같은 표준 기능) 에서는 과투자.
- **탈락 이유**: YAGNI (You Aren't Gonna Need It). 지금 스케일에서는 불필요. 한 모듈이 20+ 클래스로 커지는 시점이 오면 그때 재검토.

### Option 3 — 전통적 Spring Boot 레이어드 아키텍처 ★ (채택)

controller / service / repository / entity 의 4층 구조. Spring Boot 공식 가이드에도 나오는 가장 일반적 Best Practice.

- **장점**:
  - **친숙함** — Spring Boot 개발자라면 누구나 한 번쯤 본 구조. 새 팀원이 바로 파악 가능.
  - **기능 수정이 한 모듈 안에서 완결** — Gradle 모듈 여러 개를 건드릴 필요 없음.
  - **Best Practice 와 정렬** — Spring 공식 문서, Baeldung, 많은 오픈소스 예제가 같은 구조.
  - `@Service`, `@Repository` 같은 Spring 스테레오타입을 **자연스럽게** 쓸 수 있음.
- **단점**:
  - 레이어 간 의존이 **Gradle 수준으로 강제되지 않음** — controller 가 repository 를 직접 참조해도 컴파일 성공.
- **완화**: ArchUnit 규칙 r13~r17 이 "어느 클래스가 어느 패키지에 있어야 하는지" 를 바이트코드 수준에서 검증. 패키지 위치로 레이어 위반 간접 차단.

## 결정

각 `core-*-impl` 모듈 내부를 **4층 레이어 + 외부 Port** 구조로 배치합니다.

### 모듈 내부 구조

```
core-auth-impl/                          ← core-auth 도메인 구현 라이브러리
├── service/                             ← 비즈니스 계층
│   └── AuthServiceImpl.java             ← Primary Adapter (AuthPort 구현)
├── entity/                              ← JPA 엔티티
│   ├── RefreshToken.java
│   ├── EmailVerificationToken.java
│   └── PasswordResetToken.java
├── repository/                          ← 데이터 접근 계층
│   ├── RefreshTokenRepository.java
│   └── EmailVerificationTokenRepository.java
├── email/                               ← Secondary Adapter
│   ├── ResendEmailAdapter.java          ← EmailPort 구현 (외부 API)
│   └── ResendProperties.java
├── config/                              ← Spring 설정
│   ├── AuthAutoConfiguration.java
│   └── AppCredentialProperties.java
└── controller/
    └── AuthController.java              ← ⚠️ 스캐폴딩 소스 only (런타임 bean 아님)
                                           `new-app.sh` 가 이 패턴 참조해
                                           apps/app-<slug>/auth/ 에 복제
```

**각 레이어의 역할**:

| 레이어 | 책임 | 예시 |
|---|---|---|
| `service/` | 비즈니스 로직. **Port 구현체** (Primary Adapter) 가 여기에 위치. | `AuthServiceImpl implements AuthPort` |
| `entity/` | JPA `@Entity` 클래스. DB 테이블과 1:1 매핑. | `RefreshToken`, `User` |
| `repository/` | Spring Data JPA `*Repository` 인터페이스. CRUD + 커스텀 쿼리. | `RefreshTokenRepository extends JpaRepository` |
| `email/`, `push/` 등 | **Secondary Adapter**. 외부 시스템 (Resend, FCM 등) 호출 구현체. | `ResendEmailAdapter implements EmailPort` |
| `config/` | `@AutoConfiguration`, `@ConfigurationProperties`, `@Bean` 선언. | `AuthAutoConfiguration` |
| `controller/` | **스캐폴딩 소스만** 존재 (런타임 bean 아님). | `AuthController.java` (참조 템플릿) |

### 앱 모듈의 구조

앱 모듈(`apps/app-<slug>/`) 도 **같은 레이어 패턴** 을 따릅니다. 차이점은 "Port 사용자 위치" 만.

```
apps/app-<slug>/                         ← 앱별 도메인 + 인증 컨트롤러
├── controller/                          ← 앱 전용 API (예: health, 도메인 endpoint)
│   └── <SlugPascal>HealthController.java
├── auth/                                ← 인증 컨트롤러 (AuthPort 주입받아 사용)
│   └── <SlugPascal>AuthController.java
├── service/                             ← 앱 도메인 서비스
├── entity/                              ← 앱 도메인 엔티티
├── repository/
└── config/
```

**Controller 위치의 이중성**:
- **앱 전용 Controller** (예: `GymlogHealthController`, 도메인 로직) → `apps/app-<slug>/controller/`
- **인증 Controller** (AuthPort 를 주입받는 얇은 래퍼) → `apps/app-<slug>/auth/`

이 분리는 **엔드포인트 경로** 와 일치해요:
- `/api/apps/<slug>/health`, `/api/apps/<slug>/dashboard` 같은 도메인 경로 → `controller/`
- `/api/apps/<slug>/auth/email/signup` 같은 인증 경로 → `auth/`

자세한 내용은 [`ADR-013 (앱별 인증 엔드포인트)`](./adr-013-per-app-auth-endpoints.md) 참조.

### 포트/어댑터 패턴의 역할 매핑

[`ADR-003`](./adr-003-api-impl-split.md) 에서 포트 패턴의 큰 그림을 잡았어요. 여기서는 **레이어와 포트가 어떻게 대응되는지** 명시합니다.

| 개념 | 위치 | 역할 |
|---|---|---|
| **Port** | `core-*-api/` 의 인터페이스 | 도메인의 공개 계약 (`AuthPort`, `UserPort`, `EmailPort`) |
| **Primary Adapter (Inbound)** | `core-*-impl/service/*ServiceImpl` | Port 를 구현하고 비즈니스 로직 수행 |
| **Secondary Adapter (Outbound)** | `core-*-impl/email/*Adapter`, `core-*-impl/push/*Adapter` | 외부 시스템에 연결 (HTTP, SDK 호출) |
| **Port 사용자** | `apps/app-*/auth/*Controller`, 다른 `*ServiceImpl` 내부 | Port 를 주입받아 호출 |

### 런타임 호출 흐름

```
[앱 AuthController]          — "Port 사용자" (apps/app-<slug>/auth/)
       │
       │ @Autowired private AuthPort authPort;
       ▼
[AuthPort 인터페이스]         — "Port" (core-auth-api/)
       │
       │ Spring DI
       ▼
[AuthServiceImpl]            — "Primary Adapter" (core-auth-impl/service/)
       │
       ├─► [RefreshTokenRepository]  — Spring Data JPA (core-auth-impl/repository/)
       │       └─► [RefreshToken Entity]  — JPA (core-auth-impl/entity/)
       │
       ├─► [EmailPort]        — Secondary Port (core-auth-api/)
       │       │ Spring DI
       │       ▼
       │   [ResendEmailAdapter]  — Secondary Adapter (core-auth-impl/email/)
       │       │ HTTP
       │       ▼
       │   [Resend API]     — 외부 시스템
       │
       └─► [UserPort]         — 다른 도메인 Port (core-user-api/)
               │ Spring DI
               ▼
           [UserServiceImpl]   — core-user-impl 의 Primary Adapter
```

화살표가 **항상 바깥(Controller) → 안(Repository/외부)** 방향으로만 흐릅니다. 이게 Hexagonal Architecture 의 의존 방향입니다.

### ArchUnit 이 강제하는 위치 규칙 (r13~r17, r21)

ADR-004 의 22규칙 중 **5개가 이 결정과 연관** 됩니다.

| # | 규칙 | 강제하는 것 |
|---|---|---|
| **r13** | `SPRING_BEANS_MUST_RESIDE_IN_IMPL_OR_APPS` | `@Service`, `@Repository`, `@Component` 등은 `core-*-impl/`, `apps/`, `bootstrap/` 에만 |
| **r14** | `PORT_INTERFACES_MUST_RESIDE_IN_API` | `*Port` 인터페이스는 `core-*-api/` 에만 |
| **r15** | `SERVICE_IMPL_MUST_RESIDE_IN_IMPL` | `*ServiceImpl` 은 `core-*-impl/` 에만 |
| **r17** | `REPOSITORIES_MUST_RESIDE_IN_IMPL_REPOSITORY` | `*Repository` 는 `impl/repository/` 패키지에 |
| **r21** | `ENTITIES_MUST_RESIDE_IN_IMPL_ENTITY` | `@Entity` 는 `impl/entity/` 패키지에 |

이 규칙들은 **"레이어 위치" 를 네이밍과 패키지로 강제** 합니다. 파일을 잘못된 위치에 두면 빌드 실패.

## 이 선택이 가져온 것

### 긍정적 결과

**친숙한 구조** — Spring Boot 를 한 번이라도 해본 개발자라면 `controller`, `service`, `repository` 를 바로 이해합니다. 새로운 DDD 용어나 커스텀 레이어를 배울 필요 없음.

**기능 수정이 한 모듈에서 완결** — "인증에 새 엔드포인트 추가" 시 같은 `core-auth-impl/` 안에서 service → repository → entity 추가하면 끝. 다른 Gradle 모듈을 건드릴 일 없음.

**Port 와 내부 레이어의 역할 구분 명확** — "외부로 노출되는 것은 Port 만, 내부는 자유롭게 Spring 관용" 이라는 두 세계가 공존. 어떤 클래스가 Port 인지 (`-api`) 아닌지 (`-impl`) 위치로 바로 판단 가능.

**ArchUnit 과 정렬** — 레이어 위치가 패키지 이름으로 표현되어 ArchUnit r13~r17, r21 이 자동으로 위반을 잡음. 사람 리뷰 없이 기계 강제.

**테스트 구조 명확**:
- Port 단위 테스트 (`core-*-api/test/`) → 계약 검증
- ServiceImpl 단위 테스트 (`core-*-impl/service/test/`) → 비즈니스 로직 검증
- Repository 테스트 (`core-*-impl/repository/test/`) → `@DataJpaTest` + Testcontainers

### 부정적 결과

**레이어 간 의존 방향이 Gradle 수준 강제 X** — Controller 가 Repository 를 직접 import 해도 컴파일 성공. 완화: ArchUnit r13 (Spring 빈 위치) 과 코드 리뷰 관행으로 간접 방어. 실제로 이 관행 위반이 많지 않은 이유는, 패키지 구분이 명확해서 "controller 에서 repository 호출" 이 시각적으로 부자연스러워 보이기 때문.

**feature 단위 탐색이 필요할 때 불편** — "이메일 인증 전체" 를 보려면 `service/EmailVerificationService` + `entity/EmailVerificationToken` + `repository/EmailVerificationTokenRepository` 3곳을 왔다 갔다. 완화: 현재 스케일에서는 각 feature 가 3~5 파일 수준이라 탐색 부담 작음. IDE 의 "Find Usages" 와 파일명 탭 검색으로 충분.

### 감당 가능성 판단

단점들은 **솔로 인디 스케일에서는 실질적 문제 아님**. 레이어 강제 부재는 ArchUnit + 관행으로 커버. feature 탐색은 모듈당 클래스 수가 20+ 로 커지면 재검토 (Option 2 DDD 전환).

## 교훈

### 2026-04-20 — `AuthController` 를 `core-auth-impl` 에서 "스캐폴딩 소스" 로 격하

초기 설계에서는 `core-auth-impl/controller/AuthController` 가 **런타임 Spring bean** 으로 등록되었습니다. `AuthAutoConfiguration` 의 `@Import(AuthController.class)` 를 통해서요. 경로는 `/api/core/auth/*` 로, 모든 앱이 공유했어요.

문제는 "어느 앱의 인증 요청인지" 를 런타임에 구분해야 했다는 점. 멀티테넌트 라우팅 (`AbstractRoutingDataSource` + `ThreadLocal`) 이 필요했는데, 이게 `@Async` / Virtual Thread 환경에서 컨텍스트 소실 문제를 일으켰습니다.

2026-04-20 에 이 구조를 수정:
- `AuthAutoConfiguration.class` 에서 `@Import(AuthController.class)` 제거
- `AuthController.java` 는 파일은 남지만 **런타임 bean 으로 등록 안 됨** — `new-app.sh` 가 참조할 스캐폴딩 소스로만 존재
- 각 앱 모듈이 자기 `<Slug>AuthController` 를 가지며 경로는 `/api/apps/<slug>/auth/*` — [`ADR-013`](./adr-013-per-app-auth-endpoints.md) 에서 상세

**교훈**: 레이어 구조는 "파일이 어디에 있는가" 뿐만 아니라 **"런타임에 무엇이 bean 으로 활성화되는가"** 까지 포함합니다. `core-*-impl` 의 `controller/` 는 이제 관습적으로 "템플릿 소스 영역" 이 되었고, 실제 bean 등록은 `apps/app-<slug>/auth/` 에서만 일어나요. 이 구분이 명시적으로 유지되지 않으면 "같은 파일이 어떨 땐 런타임, 어떨 땐 참조용" 이 되어 혼란.

### "Adapter vs ServiceImpl" 네이밍의 의도

Hexagonal 원문은 "Primary Adapter" 라고 부르지만, Spring 생태계 관용은 `*ServiceImpl` 이에요. 초기엔 "Adapter" 로 통일할지 고민했지만, **Spring 관용을 따르는 게 더 익숙** 했습니다.

규칙 정리:
- **`*ServiceImpl`**: Port 구현 + 비즈니스 로직 (Primary Adapter)
- **`*Adapter`**: 외부 시스템 연결 구현 (Secondary Adapter)

이 구분이 ArchUnit 으로 강제되진 않지만 (둘 다 `@Service` / `@Component` 로 등록) 관행상 네이밍을 분리하면 **역할이 이름으로 드러남**. "ResendEmailServiceImpl" 이라고 하면 비즈니스 로직이 있는 것 같지만 실제는 HTTP 호출만 하는 얇은 어댑터라서 잘못된 신호. `ResendEmailAdapter` 가 맞음.

## 관련 사례 (Prior Art)

- **[Spring Boot Reference — Code Organization](https://docs.spring.io/spring-boot/docs/current/reference/html/using.html#using.structuring-your-code)** — Spring 공식 문서의 권장 구조. 이 ADR 이 거의 그대로 따름.
- **[Hexagonal Architecture (Alistair Cockburn)](https://alistair.cockburn.us/hexagonal-architecture/)** — Port / Primary Adapter / Secondary Adapter 용어 원형. 우리는 Spring 관용과 타협해서 용어 일부만 적용.
- **[Clean Architecture (Robert Martin)](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)** — Dependency Rule (의존 방향은 항상 안쪽으로) 의 출처.
- **Java DDD 생태계** (Vlad Mihalcea, Vernon 의 Implementing DDD 등) — Aggregate 분리의 이론적 토대. 우리는 현재 스케일에서 채택하지 않지만 미래 옵션으로 보관.

## Code References

**Port 인터페이스** (`core-*-api/`):
- [`AuthPort.java`](https://github.com/storkspear/spring-backend-template/blob/main/core/core-auth-api/src/main/java/com/factory/core/auth/api/AuthPort.java)
- [`EmailPort.java`](https://github.com/storkspear/spring-backend-template/blob/main/core/core-auth-api/src/main/java/com/factory/core/auth/api/EmailPort.java)
- [`UserPort.java`](https://github.com/storkspear/spring-backend-template/blob/main/core/core-user-api/src/main/java/com/factory/core/user/api/UserPort.java)

**Primary Adapter** (ServiceImpl):
- [`AuthServiceImpl.java`](https://github.com/storkspear/spring-backend-template/blob/main/core/core-auth-impl/src/main/java/com/factory/core/auth/impl/AuthServiceImpl.java)

**Secondary Adapter**:
- [`ResendEmailAdapter.java`](https://github.com/storkspear/spring-backend-template/blob/main/core/core-auth-impl/src/main/java/com/factory/core/auth/impl/email/ResendEmailAdapter.java)

**Repository / Entity 패턴**:
- [`core-auth-impl/repository/`](https://github.com/storkspear/spring-backend-template/tree/main/core/core-auth-impl/src/main/java/com/factory/core/auth/impl/repository) — Spring Data JPA 인터페이스
- [`core-auth-impl/entity/`](https://github.com/storkspear/spring-backend-template/tree/main/core/core-auth-impl/src/main/java/com/factory/core/auth/impl/entity) — @Entity 클래스들

**Config 패턴**:
- [`AuthAutoConfiguration.java`](https://github.com/storkspear/spring-backend-template/blob/main/core/core-auth-impl/src/main/java/com/factory/core/auth/impl/AuthAutoConfiguration.java)

**스캐폴딩 소스** (런타임 bean 아님):
- [`AuthController.java`](https://github.com/storkspear/spring-backend-template/blob/main/core/core-auth-impl/src/main/java/com/factory/core/auth/impl/controller/AuthController.java) — `new-app.sh` 가 참조하는 템플릿

**ArchUnit 레이어 위치 규칙** (`ArchitectureRules.java` 의 r13~r17, r21):
- [`ArchitectureRules.java`](https://github.com/storkspear/spring-backend-template/blob/main/common/common-testing/src/main/java/com/factory/common/testing/architecture/ArchitectureRules.java)

