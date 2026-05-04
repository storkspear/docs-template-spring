# Repository Philosophy — 책 안내

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~30분 (프롤로그 + 테마 1) / 2~3시간 (전체)

이 문서는 `template-spring` 이 **왜 현재의 구조를 가지게 되었는지** 설명하는 **ADR(Architecture Decision Record) 카드** 모음입니다.

각 결정은 추상적인 이론이 아니라 **솔로 인디 개발자가 여러 앱을 빠른 주기로 출시할 때 마주치는 구체적인 고통** 에 대한 답변으로 만들어졌어요. 이 문서를 읽고 나면 "왜 굳이 이렇게 복잡하게 만들었지?" 하는 의문이 풀리기를 바랍니다.

---

## 프롤로그 — 배경 및 철학

### 맥락: 앱 공장 전략

이 레포지토리는 **"한 사람이 여러 앱을 고 cadence 로 찍어내는"** 작업 방식을 전제로 합니다. 이 한 문장이 단순해 보이지만, 실제로 펼쳐 보면 다음 세 가지 제약이 자동으로 따라붙어요.

#### 제약 1 — 운영 가능성이 최우선

한 사람이 10개 앱을 동시에 운영한다고 상상해봅시다. 앱 1개당 **운영 부담이 조금만 커져도** 전체가 무너집니다. 예를 들어 앱마다:

- 독립된 Spring Boot 서버 1개 = 10개 프로세스
- 독립된 배포 파이프라인 1개 = 10개 CI/CD
- 독립된 모니터링 대시보드 1개 = 10개 Grafana
- 독립된 Postgres 인스턴스 1개 = 10개 DB 관리

여기에 각 앱의 **장애 대응** 까지 더하면 솔로로는 감당 불가능한 수준이 됩니다. 그래서 이 프로젝트는 "기술적으로 멋있는가" 보다 **"솔로가 감당 가능한가"** 가 설계 기준입니다. 멋있지만 복잡한 구조는 기각, 단순하지만 안정적인 구조는 채택.

#### 제약 2 — 시간이 가장 희소한 자원

돈은 **0에 가깝게 만들 수 있습니다** — Supabase Free tier, 맥미니 홈서버, Cloudflare Tunnel, NAS MinIO 조합이면 월 고정 비용이 한 자릿수 달러. 하지만 개발자 1명의 시간은 **복제 불가능한 자원** 이에요.

이 비대칭성이 설계에 직접 반영됩니다:

- 매번 재구현되는 공통 작업 (인증, 유저 관리, 푸시, 결제) 은 **반드시 한 번만 잘 만들고 재사용**
- 새 앱 추가는 **스크립트 한 줄** (`./tools/new-app/new-app.sh <slug>`) — 수동 셋업 금지
- 문서 작성에 들어가는 시간도 비용이므로, 코드 자체가 읽기 쉽게 (**"코드가 문서"** 원칙)

시간을 아끼는 모든 설계 결정이 여기서 출발합니다.

#### 제약 3 — 복권 사기 모델

인디 앱 하나가 **성공할 확률은 낮습니다**. 경험적으로 80%는 시장 반응이 없고, 15%는 그럭저럭 굴러가며, 5%만 의미 있는 트래픽을 얻어요. 하지만 **새 앱 출시 비용이 0에 가까우면** 많이 시도할 수 있습니다.

복권 사기로 비유하면: 당첨 확률은 낮아도 **한 장의 가격이 100원** 이면 1만 장을 살 수 있습니다. 반대로 한 장이 10만원이면 3장도 못 삽니다. 이 프로젝트의 존재 이유는 **새 앱 출시 비용을 극단적으로 낮추는 것** — 앱 하나 만드는 데 며칠이 아니라 몇 시간 수준으로 압축하는 게 목표입니다.

### 이 세 제약이 모든 ADR 의 공통 전제

이 세 제약을 내재화하고 나면, 뒤따르는 ADR 들의 **"왜 이 선택이 되었는가"** 가 자연스럽게 이해됩니다. 거꾸로 이 제약을 모른 채 ADR 만 읽으면 "왜 굳이 이렇게 복잡하게?" 하는 의문이 끝없이 생겨요.

예를 들어:

- [`ADR-001`](./adr-001-modular-monolith.md) 이 "모듈러 모놀리스" 를 선택한 이유는 제약 1 (운영 단위 1 유지) 때문
- [`ADR-002`](./adr-002-use-this-template.md) 가 "Use this template + cherry-pick" 을 선택한 이유는 제약 2 (공통 코드 재사용) 때문
- ADR-007 이 "관리형 서비스 선호" 를 선택한 이유는 제약 1 + 제약 2 의 결합
- ADR-008 이 "API 버전 관리 미도입" 을 결정한 이유는 제약 3 (작은 스케일이라 아직 불필요)

**모든 결정이 이 세 제약의 세 가지 조합에서 나옵니다.** 프롤로그를 먼저 읽어두면 이후 ADR 독해 속도가 2배 빨라질 거예요.

---

## 이 문서의 사용법

이 문서는 **20개의 ADR 카드** 로 구성되어 있으며, 각 카드는 하나의 설계 결정을 다룹니다. 전체를 순서대로 읽는 것이 가장 좋지만, 독자의 상황과 목적에 따라 진입점이 달라질 수 있습니다.

### 독자별 추천 경로

**처음 이 레포를 만난 분**  
위 프롤로그 → 테마 1 ([`ADR-001`](./adr-001-modular-monolith.md) ~ [`ADR-004`](./adr-004-gradle-archunit.md)) 순서대로 읽기. 테마 1 만 읽어도 "이 레포가 어떻게 생긴 건지" 대부분 이해됩니다.

**Spring Boot 경력이 있고 설계 결정만 빠르게 훑고 싶은 분**  
각 ADR 의 **Status + Decision + Consequences** 섹션만 읽으세요. 이 세 섹션을 합치면 "뭐를 결정했고, 그 결과가 어떤가" 가 5분에 파악됩니다.

**"왜 이렇게 만들었는지" 가 궁금한 분**  
각 ADR 의 **Context + Options Considered + Lessons Learned** 를 읽으세요. 결정의 **배경과 시행착오** 를 담고 있습니다.

**특정 문제에 부딪혀서 해결책 찾는 분**  
아래 "어떤 질문에 어떤 ADR?" 매핑 표로 바로 점프하세요.

### 어떤 질문에 어떤 ADR?

| 이 질문이 궁금하다면 | 이 ADR 을 읽으세요 |
|---|---|
| "여러 앱을 어떻게 한 서버에 올리지?" | [`ADR-001: 모듈러 모놀리스`](./adr-001-modular-monolith.md) |
| "파생 레포끼리 공통 코드를 어떻게 동기화하지?" | [`ADR-002: Use this template`](./adr-002-use-this-template.md) |
| "나중에 특정 앱을 별도 서비스로 빼려면?" | [`ADR-003: -api / -impl 분리`](./adr-003-api-impl-split.md) |
| "경계를 어떻게 기계적으로 강제하지?" | [`ADR-004: Gradle + ArchUnit`](./adr-004-gradle-archunit.md) |
| "앱마다 DB 를 따로 쓰나, 하나를 공유하나?" | [`ADR-005: 단일 Postgres + 앱당 schema`](./adr-005-db-schema-isolation.md) |
| "JWT 서명은 어떤 알고리즘?" | [`ADR-006: HS256 JWT`](./adr-006-hs256-jwt.md) |
| "결정 내릴 때 어떤 기준으로 판단하나?" | [`ADR-007: 솔로 친화적 운영`](./adr-007-solo-friendly-operations.md) |
| "API 버전 관리는 언제 도입하지?" | [`ADR-008: API 버전 관리 미도입`](./adr-008-no-api-versioning.md) |
| "엔티티 공통 필드를 어떻게 처리하지?" | [`ADR-009: BaseEntity`](./adr-009-base-entity.md) |
| "목록 조회 검색 조건을 표준화하려면?" | [`ADR-010: SearchCondition`](./adr-010-search-condition.md) |
| "모듈 내부 구조는 어떻게 잡나?" | [`ADR-011: 레이어드 + 포트/어댑터`](./adr-011-layered-port-adapter.md) |
| "통합 계정인가 앱별 계정인가?" | [`ADR-012: 앱별 독립 유저 모델`](./adr-012-per-app-user-model.md) |
| "인증 엔드포인트 경로는?" | [`ADR-013: 앱별 인증 엔드포인트`](./adr-013-per-app-auth-endpoints.md) |
| "테스트는 어떻게 쓰나?" | [`ADR-014: Delegation mock 금지`](./adr-014-no-delegation-mock.md) |
| "커밋 메시지 규칙은?" | [`ADR-015: Conventional Commits + SemVer`](./adr-015-conventional-commits-semver.md) |
| "DTO 변환은 어떻게 하나?" | [`ADR-016: DTO Mapper 금지`](./adr-016-dto-mapper-forbidden.md) |
| "OAuth (Google/Apple/Kakao/Naver) 는 어떻게 통합?" | [`ADR-017: OAuth 2.0 통합`](./adr-017-oauth-integration.md) |
| "슬러그별 schema 를 service-layer 까지 어떻게 격리?" | [`ADR-018: SchemaRoutingDataSource`](./adr-018-schema-routing-datasource.md) |
| "결제 도메인 (billing/iap/payment) 은 왜 셋으로 나뉘었지?" | [`ADR-019: billing/iap/payment 도메인 분리`](./adr-019-billing-iap-payment-separation.md) |
| "구독/결제 모델은 어디 두고 webhook 은 어떻게 안전하게?" | [`ADR-020: Subscription/Payment 도메인 모델 + Webhook 보안`](./adr-020-subscription-domain-model.md) |
| "갱신 실패는 어떻게 처리하지? (정책 / 알림 / 사용자 UX)" | [`ADR-021: 갱신 실패 정책`](./adr-021-renewal-failure-policy.md) |
| "Apple/Google 의 IAP 서버 알림은 어떻게 받지?" | [`ADR-022: IAP server notifications (Apple/Google)`](./adr-022-iap-server-notifications.md) |
| "구독 갱신/취소 알림은 어떤 layer 가 발송하지?" | [`ADR-023: 구독 알림 listener 분리`](./adr-023-billing-notification-listener.md) |
| "이메일 도메인은 왜 별도 모듈로 빼냈지?" | [`ADR-024: email 도메인 추출`](./adr-024-email-domain-extraction.md) |
| "구독 알림 이메일 채널은 어떻게 라우팅하지?" | [`ADR-025: 구독 알림 이메일 채널`](./adr-025-billing-notification-email-channel.md) |
| "구독 알림의 메트릭은 어떻게 추적하지?" | [`ADR-026: 구독 알림 메트릭`](./adr-026-billing-notification-metrics.md) |
| "관리자 / 일반 유저 권한 분기는?" | [`ADR-027: admin role 권한 분리`](./adr-027-admin-role-authorization.md) |
| "감사 로그는 어떻게 자동 기록?" | [`ADR-028: audit log 도메인 (AOP)`](./adr-028-audit-log-domain.md) |
| "비밀번호 정책은 어떻게 강제?" | [`ADR-029: 비밀번호 정책 (Bean Validation)`](./adr-029-password-policy.md) |
| "2FA 는 어떤 알고리즘 / 어떤 구조?" | [`ADR-030: 2FA TOTP (RFC 6238)`](./adr-030-2fa-totp.md) |
| "유저별 알림 채널 on/off 는?" | [`ADR-031: 알림 사용자 선호도`](./adr-031-notification-preferences.md) |
| "Google webhook (Pub/Sub) 의 인증은?" | [`ADR-032: Google webhook auth (Bearer JWT)`](./adr-032-google-webhook-auth.md) |
| "Flyway 의 prod 자동 migrate 가 위험한데?" | [`ADR-033: Flyway Hybrid Policy`](./adr-033-flyway-hybrid-policy.md) |
| "도메인을 부분만 켜고 끄려면?" | [`ADR-034: Feature Toggle Lite mode`](./adr-034-feature-toggle-lite-mode.md) |
| "Lite 모드의 사용자 UI 노출은?" | [`ADR-035: Lite mode 사용자 인터페이스`](./adr-035-lite-mode-user-interface.md) |

> **35 개 ADR 작성 완료** (ADR-001 ~ ADR-035). 테마별로 그룹화되어 있고 각 카드는 독립적으로 읽을 수 있습니다.

### ADR 카드의 읽는 법

각 카드는 다음 섹션으로 구성돼 있어요:

- **Status** — 현재 유효한지, 언제 정해졌는지
- **결론부터** — 30초 안에 핵심 잡기
- **왜 이런 고민이 시작됐나?** — 이 결정이 답해야 했던 물음
- **고민했던 대안들** — 검토된 대안과 탈락 이유
- **결정** — 실제 채택된 안과 구현
- **이 선택이 가져온 것** — 긍정/부정 결과 모두 정직하게
- **교훈** — 사후에 드러난 교훈 (있을 때만)
- **관련 사례 (Prior Art)** — 업계의 유사 접근
- **Code References** — 실제 구현 파일 링크

각 섹션은 독립적으로 읽을 수 있도록 쓰여 있습니다.

---

## 전체 ADR 목록 (테마별)

### 테마 1 — 레포지토리 구조의 기반 ✅ 완료

**이 테마가 답하는 물음**: "솔로 개발자가 여러 앱을 감당 가능한 레포지토리 구조는 어떤 모양인가?"

```
     ┌─────────────────────────────────────────────────┐
     │                                                 │
     ▼                                                 │
ADR-001 (모듈러 모놀리스)                              │
  "한 JAR 에 여러 앱, 그러나 경계 있음"                │
     │                                                 │
     │ 경계가 어디에?                                  │
     ▼                                                 │
ADR-002 (Use this template)                            │
  "도메인 경계는 레포 수준. 공통은 원본, 도메인은 파생"│
     │                                                 │
     │ 공통 코드의 미래 확장성은?                       │
     ▼                                                 │
ADR-003 (-api / -impl 분리)                            │
  "미래 추출 가능성을 위한 포트 인터페이스"            │
     │                                                 │
     │ 위 3가지를 실제로 지키려면?                      │
     ▼                                                 │
ADR-004 (Gradle + ArchUnit 강제) ────────────────────┘
  "컨벤션을 기계가 강제. 문서 신뢰성 유지"
```

- [`ADR-001 · 모듈러 모놀리스 (Modular Monolith)`](./adr-001-modular-monolith.md)
- [`ADR-002 · GitHub Template Repository 패턴`](./adr-002-use-this-template.md)
- [ADR-003 · core 모듈을 `-api` / `-impl` 로 분리](./adr-003-api-impl-split.md)
- [`ADR-004 · Gradle 모듈 경계 + ArchUnit 22규칙`](./adr-004-gradle-archunit.md)

**테마 1 의 결론**: 하나의 JAR 안에 여러 앱이 공존하되, 모듈 경계는 기계가 강제하고, 도메인은 파생 레포에 두며, 미래의 추출 가능성을 위한 포트 인터페이스를 함께 유지한다.

### 테마 2 — 모듈 내부 설계 ✅ 완료

**이 테마가 답하는 물음**: "모듈 안을 어떻게 짜는가? (한 앱을 구현할 때 어디에 무엇을 두는가)"

```
ADR-011 (레이어드 + 포트/어댑터)
  "안쪽은 익숙한 Spring 레이어, 바깥은 엄격한 포트"
   │
   │ 엔티티 공통 구조는?
   ▼
ADR-009 (BaseEntity)
  "id + 감사 필드 + equals/hashCode 를 한 곳에"
   │
   │ 목록 조회의 반복 패턴은?
   ▼
ADR-010 (SearchCondition + QueryDsl)
  "Map 기반 조건 → 자동 WHERE 절 변환"
   │
   │ DTO 변환은 어디에 두지?
   ▼
ADR-016 (DTO Mapper 금지)
  "Entity 의 to<Dto>() 메서드로. Mapper 클래스는 ArchUnit r22 가 차단"
```

- [`ADR-011 · 모듈 안 레이어드 + 포트/어댑터`](./adr-011-layered-port-adapter.md)
- [`ADR-009 · BaseEntity 공통 슈퍼클래스`](./adr-009-base-entity.md)
- [`ADR-010 · SearchCondition + QueryDslPredicateBuilder`](./adr-010-search-condition.md)
- [`ADR-016 · DTO Mapper 금지, Entity 메서드 패턴`](./adr-016-dto-mapper-forbidden.md)

**테마 2 의 결론**: 전통적 Spring Boot 레이어드를 따르되, `-api` 경계에 Port 를 두어 추출 가능성을 유지한다. 공통 슈퍼클래스와 공통 조회 인프라로 반복 코드를 제거하고, DTO 변환은 Entity 메서드로 담아 Mapper 레이어를 없앤다.

### 테마 3 — 데이터 & 멀티 테넌시 ✅ 완료

**이 테마가 답하는 물음**: "여러 앱이 한 Postgres 인스턴스를 공유하면서 서로의 데이터를 건드리지 못하게 하려면 어떻게 해야 하는가?"

```
ADR-005 (단일 Postgres + 앱당 schema)
  "한 database, schema 분리, 5중 방어선"
   │
   │ 유저 테이블은 어디에? 통합인가 앱별인가?
   ▼
ADR-012 (앱별 독립 유저 모델)
  "같은 이메일도 앱마다 별개 레코드. ThreadLocal 라우팅 폐기"
```

- [`ADR-005 · 단일 Postgres + 앱당 schema`](./adr-005-db-schema-isolation.md)
- [`ADR-012 · 앱별 독립 유저 모델 (통합 계정 폐기)`](./adr-012-per-app-user-model.md)
- [`ADR-018 · SchemaRoutingDataSource (service-layer 까지 라우팅)`](./adr-018-schema-routing-datasource.md)

**테마 3 의 결론**: 한 Postgres 인스턴스 · 한 database 안에서 앱마다 schema 를 분리하고, 유저 테이블도 그 schema 에 독립 소유. DB role · DataSource · Flyway · 포트 · ArchUnit 의 5중 방어선으로 경계를 강제. JWT 의 단일 `appSlug` claim 과 `AppSlugVerificationFilter` 로 런타임 오용을 차단. service-layer 까지 격리는 `SchemaRoutingDataSource` (ThreadLocal `SlugContext` + Spring `AbstractRoutingDataSource`) 로 — controller 만이 아니라 INSERT/SELECT 전부가 슬러그 schema 에 자동 라우팅 (ADR-018).

### 테마 4 — 인증 & 보안 ✅ 완료

**이 테마가 답하는 물음**: "단일 JVM 모놀리스에서 JWT 알고리즘과 엔드포인트 구조를 어떻게 설계하는가?"

```
ADR-006 (HS256 JWT 대칭키)
  "발급자=검증자 단일 프로세스. 비밀키 1개로 끝"
   │
   │ 이 JWT 를 사용하는 엔드포인트는 어떻게 생겼는가?
   ▼
ADR-013 (앱별 인증 엔드포인트)
  "/api/apps/{slug}/auth/*. core-auth-impl 은 라이브러리"
   │
   │ 이메일/비번 외에 OAuth 도 지원하려면?
   ▼
ADR-017 (OAuth 2.0 통합)
  "Google/Apple/Kakao/Naver. provider 별 Service 복제 패턴"
```

- [`ADR-006 · HS256 JWT (대칭키)`](./adr-006-hs256-jwt.md)
- [`ADR-013 · 앱별 인증 엔드포인트 (core-auth 는 라이브러리 역할)`](./adr-013-per-app-auth-endpoints.md)
- [`ADR-017 · OAuth 2.0 통합 (Google / Apple / Kakao / Naver)`](./adr-017-oauth-integration.md)

**테마 4 의 결론**: 단일 JVM 모놀리스 전제에서 JWT 는 HS256 대칭키로 단순화 — 관리 대상은 `JWT_SECRET` 환경변수 하나. 엔드포인트는 `/api/apps/{slug}/auth/*` 경로로 appSlug 를 URL 에 명시하고, Controller 는 각 앱 모듈이 소유. 실제 인증 로직은 `core-auth-impl/AuthServiceImpl` 한 곳에 집중되며, core-auth-impl 은 앱이 가져다 쓰는 **라이브러리** 로 작동. `AppSlugVerificationFilter` ([`ADR-012`](./adr-012-per-app-user-model.md)) 가 JWT-URL 경계를 런타임에 강제.

### 테마 5 — 운영 & 개발 방법론 ✅ 완료

**이 테마가 답하는 물음**: "개발/운영의 일상 작업을 어떤 원칙으로 굴리는가?"

```
ADR-007 (솔로 친화적 운영)
  "모든 운영 결정의 상위 기준. 비목표도 명시"
   │
   ├──> ADR-008 (API 버전 관리 미도입)
   │     "'지금 필요 없다' 의 구체 적용. YAGNI 준수"
   │
   ├──> ADR-014 (Delegation mock 금지)
   │     "리팩토링 안전망 유지. Port 계약만 검증"
   │
   └──> ADR-015 (Conventional Commits + SemVer)
         "cherry-pick 모델의 운영 인프라. 초기 투자 vs 미래 부담"
```

- [`ADR-007 · 솔로 친화적 운영`](./adr-007-solo-friendly-operations.md)
- [`ADR-008 · API 버전 관리 미도입`](./adr-008-no-api-versioning.md)
- [`ADR-014 · Delegation mock 테스트 금지`](./adr-014-no-delegation-mock.md)
- [`ADR-015 · Conventional Commits + 템플릿 전체 semver`](./adr-015-conventional-commits-semver.md)

**테마 5 의 결론**: "솔로 한 사람이 감당 가능한가?" 를 모든 운영 결정의 상위 기준으로 두고, 비목표 (HA 99.99%, 멀티 리전, 무중단 배포, 분산 추적) 를 명시 선언. 이 원칙 아래 API 버전 관리는 YAGNI 로 미도입, 테스트는 delegation mock 금지로 리팩토링 안전망 유지, 커밋/버전 관리는 파생 레포 cherry-pick 을 위한 기계 쿼리 가능 형태 (Conventional Commits + template-v* 태그) 로 강제. 초기 셋업 비용은 1회성, 장기 운영 부담 감소의 복리 효과.

### 테마 6 — 결제 / 구독 도메인 ✅ 완료

**이 테마가 답하는 물음**: "구독형 SaaS 의 결제 도메인은 어떻게 모델링하고 webhook 보안은 어떻게 다지는가?"

```
ADR-019 (billing/iap/payment 분리)
  "정책 (billing) vs 채널 (IAP, PG) 의 layer 분리"
   │
   │ 위 분리 위에 비즈로직과 보안은?
   ▼
ADR-020 (Subscription/Payment 도메인 모델 + Webhook 보안)
  "슬러그별 schema 4 테이블 + HMAC + idempotency + 트랜잭션 phase 분리"
```

- [`ADR-019 · billing / iap / payment 도메인 분리`](./adr-019-billing-iap-payment-separation.md)
- [`ADR-020 · Subscription / Plan / PaymentRecord 도메인 모델 + Webhook 보안`](./adr-020-subscription-domain-model.md)
- [`ADR-021 · 갱신 실패 정책`](./adr-021-renewal-failure-policy.md)
- [`ADR-022 · IAP server notifications (Apple/Google)`](./adr-022-iap-server-notifications.md)
- [`ADR-023 · 구독 알림 listener 분리`](./adr-023-billing-notification-listener.md)
- [`ADR-025 · 구독 알림 이메일 채널`](./adr-025-billing-notification-email-channel.md)
- [`ADR-026 · 구독 알림 메트릭`](./adr-026-billing-notification-metrics.md)
- [`ADR-031 · 알림 사용자 선호도`](./adr-031-notification-preferences.md)
- [`ADR-032 · Google webhook auth (Bearer JWT)`](./adr-032-google-webhook-auth.md)

**테마 6 의 결론**: 결제 도메인은 "정책 (Billing — subscription/plan)" 위에 "채널 (IAP — Apple/Google, Payment — PG=포트원)" 두 갈래를 두는 layer 구조로 분리. Subscription/Plan/PaymentRecord/WebhookEvent 4 테이블은 [`ADR-005`](./adr-005-db-schema-isolation.md) 정합으로 슬러그별 schema 에 위치. Webhook 은 HMAC SHA-256 + timestamp tolerance + (source, externalId) UNIQUE 의 3중 방어. 외부 HTTP 호출이 DB 트랜잭션 안에서 connection 점유하지 않도록 `handleWebhook` 만 `Propagation.NOT_SUPPORTED` 로 격리하고 `TransactionTemplate` 으로 phase 마다 자기 트랜잭션 시작. 갱신 실패 / 환불 / 알림 같은 후속 흐름은 ADR-021~026 + ADR-031~032 에서 listener / email channel / metrics / preference / Pub/Sub 인증 등으로 구체화.

### 테마 7 — 보안 / 감사 / 알림 도메인 ✅ 완료

**이 테마가 답하는 물음**: "기본 인증을 넘어 운영 보안과 감사를 어떻게 강화하는가?"

```
ADR-024 (email 도메인 추출)
  "메일 발송이 auth 의 부속이 아닌 독립 도메인 (EmailPort)"
   │
   │ 관리자 vs 일반 유저는 어떻게 구분?
   ▼
ADR-027 (admin role 권한 분리)
  "@AdminOnly 어노테이션 + role claim 검증"
   │
   │ 누가 무엇을 했는지는?
   ▼
ADR-028 (audit log 도메인)
  "AOP 기반 자동 기록 — 사용자 흐름 차단 X"
   │
   │ 비밀번호와 2FA 는?
   ▼
ADR-029 (password policy) + ADR-030 (2FA TOTP)
  "Bean Validation 으로 정책 강제 + RFC 6238 표준 준수"
```

- [`ADR-024 · email 도메인 추출`](./adr-024-email-domain-extraction.md)
- [`ADR-027 · admin role 권한 분리`](./adr-027-admin-role-authorization.md)
- [`ADR-028 · audit log 도메인 (AOP)`](./adr-028-audit-log-domain.md)
- [`ADR-029 · 비밀번호 정책 (Bean Validation)`](./adr-029-password-policy.md)
- [`ADR-030 · 2FA TOTP (RFC 6238)`](./adr-030-2fa-totp.md)

**테마 7 의 결론**: auth / billing 의 core 흐름과 별도로 *보안 / 감사 / 알림* 도메인을 독립 모듈로 추출. 메일 발송은 EmailPort 로 분리해서 어느 도메인이든 의존 가능하고 (ADR-024), 관리자 권한은 `@AdminOnly` 어노테이션 + JWT role claim 으로 강제 (ADR-027). 감사 로그는 `@Audited` AOP 로 자동 기록되어 *사용자 흐름을 차단하지 않는* 부산물 형태 (ADR-028). 비밀번호 정책 (ADR-029) 과 2FA (ADR-030) 는 표준 라이브러리 (Bean Validation / RFC 6238) 위에서 최소 구현으로 강도를 올림.

### 테마 8 — 운영 정책 / Lite 모드 ✅ 완료

**이 테마가 답하는 물음**: "프로덕션 안정성과 도메인 토글 가능성을 어떻게 양립시키는가?"

```
ADR-033 (Flyway Hybrid Policy)
  "dev/test = AUTO migrate, prod = VALIDATE_ONLY (운영자가 수동 적용)"
   │
   │ 도메인을 부분만 켜고 끄려면?
   ▼
ADR-034 (Feature Toggle Lite mode)
  "@ConditionalOnProperty 기반 opt-out — 8 도메인 토글 가능"
   │
   │ 사용자 UI 에는 어떻게 노출?
   ▼
ADR-035 (Lite mode 사용자 인터페이스)
  ".env.prod 의 토글 상태가 사용자에게 보이는 흐름 정리"
```

- [`ADR-033 · Flyway Hybrid Policy`](./adr-033-flyway-hybrid-policy.md)
- [`ADR-034 · Feature Toggle Lite mode`](./adr-034-feature-toggle-lite-mode.md)
- [`ADR-035 · Lite mode 사용자 인터페이스`](./adr-035-lite-mode-user-interface.md)

**테마 8 의 결론**: 운영 안전성과 유연성을 동시에 확보하는 운영 정책. Flyway 는 dev/test 에서는 자동 migrate, prod 는 validate 만 하고 운영자가 명시적으로 적용 (ADR-033 — `tools/migrate-prod.sh`). Lite 모드는 8 개 도메인 (payment / iap / email / 2fa / audit / push / billing-notification / password-policy) 을 `.env.prod` 의 환경변수로 opt-out 가능 (ADR-034). 사용자 UI 차원의 노출은 ADR-035 에서 별도 정리. *솔로 인디 운영자가 자기 앱의 복잡도에 맞게 도메인을 골라 켜는* 흐름.

---

## L2 ↔ L3 매핑 — 어떤 L2 문서가 어느 ADR 의 결과인가

L2 (구조 / 규약 / API / 운영) 의 각 문서가 어느 ADR 결정의 *구체 구현* 인지를 한눈에 보는 표예요. ADR 만 읽고 나서 *실제 코드 / 운영* 으로 어디로 가야 할지 모를 때 참고하세요.

| L2 문서 | 영역 | 근거 ADR |
|---|---|---|
| [`Architecture Reference`](../structure/architecture.md) | 모듈 구조 + 의존 그래프 | ADR-001, 003, 004, 005, 011 |
| [`Module Dependencies`](../structure/module-dependencies.md) | 의존 매트릭스 + Gradle plugin | ADR-003, 004 |
| [`Architecture Rules (ArchUnit)`](../structure/architecture-rules.md) | r1~r22 규칙 | ADR-004, 016 |
| [`Multi-tenant Architecture`](../structure/multitenant-architecture.md) | per-app schema + DataSource | ADR-005, 012, 018 |
| [`JWT Authentication`](../structure/jwt-authentication.md) | HS256 + AppSlugVerificationFilter | ADR-006, 012, 013 |
| [`Naming Conventions`](../convention/naming.md) | 네이밍 + DB / API | ADR-016 |
| [`DTO Factory`](../convention/dto-factory.md) | Entity `to<Dto>()` 패턴 | ADR-016 |
| [`Exception Handling`](../convention/exception-handling.md) | ErrorCode enum + 도메인별 예외 | ADR-011 |
| [`Git Workflow`](../convention/git-workflow.md) | Conventional Commits + cherry-pick | ADR-002, 015 |
| [`API Response Format`](../api-and-functional/api/api-response.md) | `{data, error}` 래퍼 | ADR-011 |
| [`JSON Contract`](../api-and-functional/api/json-contract.md) | DTO record + ArchUnit r18, r19 | ADR-016 |
| [`Versioning`](../api-and-functional/api/versioning.md) | Deprecation 프로세스 | ADR-008, 015 |
| [`Storage 규약`](../api-and-functional/functional/storage.md) | StoragePort + signed URL | ADR-011 |
| [`Email Verification`](../api-and-functional/functional/email-verification.md) | Resend + EmailPort | ADR-024 |
| [`Push Notifications`](../api-and-functional/functional/push-notifications.md) | PushPort + DevicePort | ADR-011 |
| [`Billing / IAP / Payment`](../api-and-functional/functional/billing-iap-payment.md) | 결제 도메인 통합 가이드 | ADR-019, 020, 021, 022, 023, 025, 026, 031, 032, 034 |
| [`Observability 규약`](../api-and-functional/functional/observability.md) | Loki + Prometheus + appSlug | ADR-007 |
| [`Rate Limiting`](../api-and-functional/functional/rate-limiting.md) | Bucket4j 정책 | ADR-007 |
| [`Infrastructure`](../production/deploy/infrastructure.md) | Mac mini + Supabase + NAS MinIO | ADR-007 |
| [`Runbook`](../production/deploy/runbook.md) | 평시 배포 / 롤백 / 장애 | ADR-007, 033 |
| [`Flyway Runbook`](../production/deploy/flyway-runbook.md) | prod migrate 절차 | ADR-033 |
| [`Feature Toggle 운영자 가이드`](../production/operations/feature-toggle.md) | Lite 모드 운영 | ADR-034 |
| [`Testing Strategy`](../production/test/testing-strategy.md) | 4 층 전략 | ADR-014 |
| [`Contract Testing`](../production/test/contract-testing.md) | Port 계약 + JSON | ADR-003, 014, 016 |

---

## 템플릿 유지 규칙 (절대 금지)

이 템플릿 레포에 커밋할 때 **반드시** 지킨다. 파생 레포에는 적용되지 않는다 — 거기에선 오히려 도메인 로직을 적극적으로 쓴다.

- **특정 앱/도메인/팀/회사 이름** 을 코드나 문서에 박지 않는다. 템플릿이 중립적이어야 어느 도메인으로든 가지를 뻗을 수 있다.
- **특정 인프라 자격증명, 계정 식별자, 프로젝트 ID** 를 커밋하지 않는다. Supabase project-ref, Google Client ID, Firebase 키 등은 파생 레포의 `.env` 에서만 존재해야 한다.
- **실제 비즈니스 로직** 을 이 레포에 쓰지 않는다 — 그건 파생 레포의 역할이다. 여기에는 뼈대, 포트 인터페이스, 공통 인프라만 둔다.
- **구체적인 스펙 문서** (특정 앱이 언급되는 요구사항/API 문서 등) 를 여기 두지 않는다.
- **운영 환경 변수 파일 (`.env.prod`, `.env.production` 등) 을 커밋하지 않는다.** 운영용 값은 GHA Repository Secrets 만 사용.
- **`docs/planned/archive/` 는 template-spring 전용 history** — 파생 레포 (server-factory 등) 와 docs 뷰어 레포 (docs-template-spring) 에는 미반영. `tools/sync-docs.sh` 가 자동 exclude 한다.

이유의 배경은 [`ADR-002`](./adr-002-use-this-template.md) 참조.

---

## 관련 문서

- [`Architecture Reference`](../structure/architecture.md) — 실제 구조의 상세 레퍼런스
- [`../convention/`](../convention) — 코딩 규약

---

## 📖 책 목차 — Journey 1단계

[`📚 template-spring — 책 목차 (Developer Journey)`](../onboarding/README.md) 의 **1단계 — 이 레포가 뭐야?** 입니다.

| 방향 | 문서 | 한 줄 |
|---|---|---|
| ← 이전 | (없음, 첫 단계) | README 의 30분 QuickStart 가 선행 |
| → 다음 | [`Architecture Reference`](../structure/architecture.md) | 같은 1단계, 모듈 구조 한눈 요약 |

**막혔을 때**: [`도그푸딩 함정`](../start/dogfood-pitfalls.md) / [`FAQ`](../start/dogfood-faq.md)  
**왜 이렇게?**: 이 문서가 "왜" 의 본진입니다. 더 깊은 인프라 결정은 [`인프라 결정 기록 (Decisions — Infrastructure)`](../production/deploy/decisions-infra.md).
