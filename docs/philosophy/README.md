<a id="repository-philosophy--책-안내"></a>

# Repository Philosophy — 책 안내

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~30분 (프롤로그 + 테마 1) / 2~3시간 (전체)

이 문서는 `template-spring`의 설계 결정을 찾아보는 안내예요. 각 ADR은 당시의 문제와 선택, 이유와 제약을 기록해요. 현재 구현은 구조·API·운영 문서와 소스를 함께 확인해요.

여러 앱을 혼자 개발하고 운영할 때 반복되는 작업을 줄이는 것이 공통 배경이에요. 아래 제약과 주제별 목록에서 필요한 결정으로 이동할 수 있어요.

---

<a id="프롤로그--배경-및-철학"></a>

## 프롤로그 — 배경 및 철학

### 맥락: 앱 공장 전략

이 저장소는 한 사람이 여러 앱을 반복해서 출시하는 작업을 지원해요. 운영 단위를 줄이고 공통 기능을 재사용하면서 앱별 데이터와 도메인 경계를 유지해요.

<a id="제약-1--운영-가능성이-최우선"></a>

#### 제약 1 — 운영 가능성이 최우선

앱마다 서버·배포·관측·DB를 따로 운영하면 앱 수만큼 관리 대상이 늘어요. 앱 10개를 각각 운영하는 경우를 예로 들면 다음과 같아요.

- 독립된 Spring Boot 서버 1개 = 10개 프로세스
- 독립된 배포 파이프라인 1개 = 10개 CI/CD
- 독립된 모니터링 대시보드 1개 = 10개 Grafana
- 독립된 Postgres 인스턴스 1개 = 10개 DB 관리

장애 대응까지 혼자 맡아야 하므로, 구조를 선택할 때 운영자가 감당할 수 있는 복잡도를 함께 판단해요.

<a id="제약-2--시간이-가장-희소한-자원"></a>

#### 제약 2 — 시간이 가장 희소한 자원

Supabase, 홈서버, Cloudflare Tunnel, MinIO 같은 기존 자원을 활용해 인프라 비용을 줄여요. 실제 비용은 구성과 사용량에 따라 달라지며, 공통 기능을 다시 구현하고 운영하는 시간도 비용으로 봐요.

이 기준을 다음 작업에 적용해요.

- 매번 재구현되는 공통 작업 (인증, 유저 관리, 푸시, 결제) 은 **반드시 한 번만 잘 만들고 재사용**
- 새 앱 추가는 **스크립트 한 줄** (`./tools/app/new-app.sh <slug>`) — 수동 셋업 금지
- 문서 작성에 들어가는 시간도 비용이므로, 코드 자체가 읽기 쉽게 (**"코드가 문서"** 원칙)

이렇게 반복 작업을 줄여 앱별 도메인 구현과 검증에 시간을 쓸 수 있도록 해요.

<a id="제약-3-복권-사기-모델"></a>

<a id="제약-3--복권-사기-모델"></a>
#### 제약 3 — 새 앱을 반복해서 시도할 수 있어야 해요

새 앱의 수요는 출시 전부터 확정하기 어려워요. 공통 인증·결제·배포를 매번 다시 만들지 않으면 새 아이디어를 구현하고 검증하는 부담을 줄일 수 있어요.

이 템플릿은 앱의 성공률이나 개발 시간을 보장하는 도구가 아니에요. 새 앱에 필요한 공통 기반을 재사용하고, 앱 고유의 기능에 집중할 수 있도록 준비해 두는 것이 목적이에요.

### 이 세 제약이 모든 ADR 의 공통 전제

아래 ADR들은 이 제약을 서로 다른 설계 문제에 적용한 기록이에요. 각 결정의 구체적인 조건과 대안은 해당 ADR에서 확인해요.

예를 들어:

- [`ADR-001`](./adr-001-modular-monolith.md) 이 "모듈러 모놀리스" 를 선택한 이유는 제약 1 (운영 단위 1 유지) 때문
- [`ADR-002`](./adr-002-use-this-template.md) 가 "Use this template + cherry-pick" 을 선택한 이유는 제약 2 (공통 코드 재사용) 때문
- [ADR-007](./adr-007-solo-friendly-operations.md)은 운영 부담과 반복 작업을 함께 줄이기 위해 관리형 서비스와 직접 운영의 시간·비용을 비교해요.
- ADR-008 이 "API 버전 관리 미도입" 을 결정한 이유는 제약 3 (작은 스케일이라 아직 불필요)

프롤로그에서 공통 배경을 읽고, 작업 중인 영역의 ADR로 이어가면 돼요.

---

## 이 문서의 사용법

39개의 ADR을 주제별로 묶었어요. 처음 구조를 익힐 때는 테마 1부터 읽고, 특정 결정이 궁금할 때는 아래 질문표에서 찾아보세요.

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
| "공개 webhook 등 외부 호출의 SSRF 방어는?" | [`ADR-036: SSRF URL whitelist 정책`](./adr-036-ssrf-url-whitelist.md) |
| "core schema 가 *legacy* 잔재라면?" | [`ADR-037: core schema + coreDataSource Bean 폐기`](./adr-037-core-schema-deprecation.md) |
| "SMS 발송과 휴대폰 점유인증은 어떻게 도입하지?" | [`ADR-038: SMS 발송 (core-sms) + 휴대폰 점유인증 (core-phone-auth)`](./adr-038-sms-phone-auth.md) |
| "솔로 운영자가 여러 앱을 한 화면에서 보려면? (cross-app 콘솔)" | [`ADR-039: admin 모듈 (superadmin + admin 스키마 + in-process fan-out)`](./adr-039-admin-module.md) |

> **39 개 ADR 작성 완료** (ADR-001 ~ ADR-039). 테마별로 그룹화되어 있고 각 카드는 독립적으로 읽을 수 있습니다.

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

<a id="테마-1--레포지토리-구조의-기반--완료"></a>

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

**테마 1의 결론**: 여러 앱을 한 JAR에 담되 Gradle과 ArchUnit으로 모듈 경계를 검사해요. 앱 도메인은 파생 저장소에 두고, 공통 모듈은 Port 인터페이스를 통해 사용해요.

<a id="테마-2--모듈-내부-설계--완료"></a>

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

**테마 2의 결론**: 모듈 내부는 Spring 레이어드 구조로 작성하고, 외부에는 `-api`의 Port를 노출해요. 공통 엔티티 기반과 조회 도구로 반복 코드를 줄이며, 엔티티의 DTO 변환은 `to<Dto>()` 메서드에 둬요.

<a id="테마-3--데이터--멀티-테넌시--완료"></a>

### 테마 3 — 데이터 & 멀티 테넌시 ✅ 완료

**이 테마가 답하는 물음**: "여러 앱이 한 Postgres 인스턴스를 공유하면서 서로의 데이터를 건드리지 못하게 하려면 어떻게 해야 하는가?"

```
ADR-005 (단일 Postgres + 앱당 schema)
  "한 database, schema 분리, 5중 방어선"
   │
   │ 유저 테이블은 어디에? 통합인가 앱별인가?
   ▼
ADR-012 (앱별 독립 유저 모델)
  "같은 이메일도 앱마다 별개 계정. 현재 라우팅은 ADR-018 참고"
```

- [`ADR-005 · 단일 Postgres + 앱당 schema`](./adr-005-db-schema-isolation.md)
- [`ADR-012 · 앱별 독립 유저 모델 (통합 계정 폐기)`](./adr-012-per-app-user-model.md)
- [`ADR-018 · SchemaRoutingDataSource (service-layer 까지 라우팅)`](./adr-018-schema-routing-datasource.md)

**테마 3의 결론**: 앱마다 스키마와 사용자 테이블을 분리해요. DataSource·Flyway·Port·ArchUnit으로 앱 경계를 관리하며, 별도 DB role을 설정한 앱은 DB 권한도 분리돼요. JWT의 `appSlug`와 URL은 `AppSlugVerificationFilter`가 대조해요. 공유 core 서비스의 영속성은 `SlugContext`와 `SchemaRoutingDataSource`로 선택하고, 생성된 앱 자체의 Repository는 앱 전용 EntityManager와 트랜잭션 매니저를 사용해요.

<a id="테마-4--인증--보안--완료"></a>

### 테마 4 — 인증 & 보안 ✅ 완료

**이 테마가 답하는 물음**: "단일 JVM 모놀리스에서 JWT 알고리즘과 엔드포인트 구조를 어떻게 설계하는가?"

```
ADR-006 (HS256 JWT 대칭키)
  "발급자=검증자 단일 프로세스. 비밀키 1개로 끝"
   │
   │ 이 JWT 를 사용하는 엔드포인트는 어떻게 생겼는가?
   ▼
ADR-013 (앱별 인증 엔드포인트)
  "/api/apps/{slug}/auth/*. 현재는 공유 컨트롤러가 처리"
   │
   │ 이메일/비번 외에 OAuth 도 지원하려면?
   ▼
ADR-017 (OAuth 2.0 통합)
  "Google/Apple/Kakao/Naver. provider 별 Service 복제 패턴"
```

- [`ADR-006 · HS256 JWT (대칭키)`](./adr-006-hs256-jwt.md)
- [`ADR-013 · 앱별 인증 엔드포인트 (core-auth 는 라이브러리 역할)`](./adr-013-per-app-auth-endpoints.md)
- [`ADR-017 · OAuth 2.0 통합 (Google / Apple / Kakao / Naver)`](./adr-017-oauth-integration.md)

**테마 4의 결론**: 같은 프로세스가 발급·검증하는 access token에 HS256과 `JWT_SECRET`을 사용해요. 인증 URL은 `/api/apps/{slug}/auth/*`로 앱을 구분하며 현재 컨트롤러는 `core-auth-impl`의 공유 빈이에요. 인증·소셜 로그인·2FA 등은 각 서비스가 맡고, JWT와 URL의 앱 경계는 `AppSlugVerificationFilter`가 검사해요. ADR-013의 당시 구조와 현재 구현을 함께 구분해서 읽어요.

<a id="테마-5--운영--개발-방법론--완료"></a>

### 테마 5 — 운영 & 개발 방법론 ✅ 완료

**이 테마가 답하는 물음**: 개발과 운영의 일상 작업을 어떤 기준으로 결정하나요?

```text
ADR-007 (솔로 친화적 운영)
  한 사람이 감당할 시간·비용·복구 책임을 기준으로 판단해요.
   │
   ├──> ADR-008 (API 버전 관리 미도입)
   │     현재 계약과 요구를 기준으로 도입 시점을 판단해요.
   │
   ├──> ADR-014 (Delegation mock 금지)
   │     관측 가능한 행위를 검증하고 내부 위임의 호출 검증은 금지해요.
   │
   └──> ADR-015 (Conventional Commits + SemVer)
         파생 저장소에 필요한 변경을 찾아 전파할 수 있게 관리해요.
```

- [`ADR-007 · 솔로 친화적 운영`](./adr-007-solo-friendly-operations.md)
- [`ADR-008 · API 버전 관리 미도입`](./adr-008-no-api-versioning.md)
- [`ADR-014 · Delegation mock 테스트 금지`](./adr-014-no-delegation-mock.md)
- [`ADR-015 · Conventional Commits + 템플릿 전체 semver`](./adr-015-conventional-commits-semver.md)

**테마 5의 결론**: 솔로 한 사람이 감당할 수 있는지를 운영 결정의 상위 기준으로 삼아요. 관리형 서비스와 홈서버·MinIO·관측 스택의 직접 운영을 시간·비용·복구 책임으로 비교하고, 현재는 두 방식을 함께 사용해요. Kamal blue-green도 채택한 운영 방식이에요. 99.99% 가용성 SLA 보장, 멀티 리전, Kubernetes·서비스 메시, 마이크로서비스 분산 추적을 기본 목표로 두지는 않아요.

로컬에서 먼저 개발하고 필요한 기능을 선택하며, 공유 자격과 환경별 자격의 소유자를 구분해요. Spring의 `develop`→dev와 `main`→prod 배포는 각각의 CI 결과와 배포 gate를 확인해 진행해요. blue-green 전환을 사용한다는 사실과 모든 상황에서 무중단을 보장한다는 약속은 구분해요.

이 기준 아래 API 버전 관리의 도입을 유보하고, 테스트는 내부 위임 호출에 결합하지 않도록 해요. Conventional Commits와 `template-v*` 태그는 파생 저장소에서 변경을 선택해 전파하기 위한 기준이에요. 자동화와 검증에 드는 초기 비용뿐 아니라 이후의 유지 비용과 반복 작업 감소도 함께 판단해요.

<a id="테마-6--결제--구독-도메인--완료"></a>

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

**테마 6의 결론**: 구독 정책은 Billing, 스토어 결제는 IAP, PG 연동은 Payment가 맡아요. 구독·요금제·결제·webhook 기록은 앱 스키마에 저장해요. webhook의 진위 확인은 공급자별로 다르며, 현재 PortOne v1은 `imp_uid`를 재조회하고 v2 자격은 설정 가드가 거부해요. 처리 중복은 `(source, externalId, eventStatus)` 고유 키로 관리해요. 외부 HTTP 호출과 DB 작업은 트랜잭션 단계를 나누며, 갱신·환불·알림의 상세 흐름은 ADR-021~026과 ADR-031~032에서 다뤄요.

<a id="테마-7--보안--감사--알림-도메인--완료"></a>

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

**테마 7의 결론**: 이메일은 `EmailPort`로 제공하고, 앱 사용자용 관리자 API는 `@AdminOnly`와 JWT role로 제한해요. 별도 운영 콘솔의 RBAC는 ADR-039와 [운영 콘솔 API](../api-and-functional/admin-console.md)가 정본이에요. 감사 AOP는 대상 메서드의 실행 결과를 별도 트랜잭션에 기록하며, 인증 단계에서 거부된 모든 요청까지 기록하는 것은 아니에요. 비밀번호 정책과 TOTP는 각각 Bean Validation과 RFC 6238을 바탕으로 구현해요.

<a id="테마-8--운영-정책--lite-모드--ssrf--완료"></a>

### 테마 8 — 운영 정책 / Lite 모드 / SSRF ✅ 완료

**이 테마가 답하는 물음**: "프로덕션 안정성과 도메인 토글 가능성, 외부 호출 보안 baseline 을 어떻게 양립시키는가?"

```
ADR-033 (Flyway Hybrid Policy)
  "유효한 app.flyway.mode에 따라 migrate 또는 validate"
   │
   │ 도메인을 부분만 켜고 끄려면?
   ▼
ADR-034 (Feature Toggle Lite mode)
  "@ConditionalOnProperty 기반 기능별 opt-out"
   │
   │ 사용자 UI 에는 어떻게 노출?
   ▼
ADR-035 (Lite mode 사용자 인터페이스)
  ".env.prod 의 토글 상태가 사용자에게 보이는 흐름 정리"
   │
   │ 외부 HTTP 호출의 보안 baseline 은?
   ▼
ADR-036 (SSRF URL whitelist 정책)
  "URL 은 hardcode 또는 환경변수만. 사용자 입력으로 host/path 결정 금지"
```

- [`ADR-033 · Flyway Hybrid Policy`](./adr-033-flyway-hybrid-policy.md)
- [`ADR-034 · Feature Toggle Lite mode`](./adr-034-feature-toggle-lite-mode.md)
- [`ADR-035 · Lite mode 사용자 인터페이스`](./adr-035-lite-mode-user-interface.md)
- [`ADR-036 · SSRF URL whitelist 정책`](./adr-036-ssrf-url-whitelist.md)
- [`ADR-037 · core schema + coreDataSource Bean 폐기`](./adr-037-core-schema-deprecation.md)
- [`ADR-038 · SMS 발송 (core-sms) + 휴대폰 점유인증 (core-phone-auth)`](./adr-038-sms-phone-auth.md)
- [`ADR-039 · admin 모듈 (cross-app 운영 콘솔 — superadmin + admin 스키마 + in-process fan-out)`](./adr-039-admin-module.md)

**테마 8의 결론**: 앱 Flyway는 실제 `app.flyway.mode` 값으로 동작해요. dev·prod 프로파일의 기본값은 `VALIDATE_ONLY`지만 환경 예시는 `AUTO`를 지정하므로 배포 전 유효 값을 확인해요. 관리자 스키마는 별도 초기화 경로를 사용해요. Lite 모드는 `app.features.*`로 기능별 빈 등록을 제어하며, CLI와 검증 범위는 ADR-034·035에서 구분해요. 외부 호출 URL은 고정값이나 운영자 설정으로 제한해 사용자 입력이 목적지를 정하지 못하게 해요. 이것만으로 모든 SSRF 위험이 사라지는 것은 아니에요. 공유 core 스키마는 폐기했고, 별도 `admin` 스키마는 운영 계정·권한·앱 최소 버전 설정 등을 관리해요.

---

<a id="l2--l3-매핑--어떤-l2-문서가-어느-adr-의-결과인가"></a>

## L2 ↔ L3 매핑 — 어떤 L2 문서가 어느 ADR 의 결과인가

L2 (구조 · 규약 · API · 운영) 의 각 문서가 어느 ADR 결정의 *구체 구현* 인지를 한눈에 보는 표예요. ADR 만 읽고 나서 *실제 코드 · 운영* 으로 어디로 가야 할지 모를 때 참고하세요.

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
| [`운영 콘솔 API`](../api-and-functional/admin-console.md) | superadmin 인증 + cross-app fan-out 엔드포인트 | ADR-039, 005, 012, 018, 037 |

---

## 템플릿 유지 규칙 (절대 금지)

이 템플릿 레포에 커밋할 때 **반드시** 지킵니다. 파생 레포에는 적용되지 않아요 — 거기에선 오히려 도메인 로직을 적극적으로 씁니다.

- **특정 앱/도메인/팀/회사 이름** 을 코드나 문서에 박지 않습니다. 템플릿이 중립적이어야 어느 도메인으로든 가지를 뻗을 수 있어요.
- **특정 인프라 자격증명, 계정 식별자, 프로젝트 ID** 를 커밋하지 않습니다. Supabase project-ref, Google Client ID, Firebase 키 등은 파생 레포의 `.env` 에서만 존재해야 합니다.
- **실제 비즈니스 로직** 을 이 레포에 쓰지 않습니다 — 그건 파생 레포의 역할이에요. 여기에는 뼈대, 포트 인터페이스, 공통 인프라만 둡니다.
- **구체적인 스펙 문서** (특정 앱이 언급되는 요구사항/API 문서 등) 를 여기 두지 않습니다.
- 운영 환경 파일(`.env.prod`, `.env.production` 등)은 커밋하지 않아요. 로컬 파일에서 관리한 값을 초기화 도구로 GitHub Secrets·Variables에 등록하고 배포 경로에 전달해요.
- `docs/planned/`는 템플릿 내부 계획 문서예요. `tools/docs/sync-docs.sh`는 공개 미러로 복사할 때 `planned/`와 `superpowers/`를 제외해요. 이 스크립트가 파생 저장소의 파일을 동기화하거나 삭제하는 것은 아니에요.

이유의 배경은 [`ADR-002`](./adr-002-use-this-template.md) 참조.

---

## 관련 문서

- [`Architecture Reference`](../structure/architecture.md) — 실제 구조의 상세 레퍼런스
- [`../convention/`](../convention) — 코딩 규약

---

<a id="-책-목차--journey-1단계"></a>

## 📖 책 목차 — Journey 1단계

[`📚 template-spring — 책 목차 (Developer Journey)`](../onboarding/README.md) 의 **1단계 — 이 레포가 뭐야?** 입니다.

| 방향 | 문서 | 한 줄 |
|---|---|---|
| ← 이전 | (없음, 첫 단계) | README 의 30분 QuickStart 가 선행 |
| → 다음 | [`Architecture Reference`](../structure/architecture.md) | 같은 1단계, 모듈 구조 한눈 요약 |

**막혔을 때**: [도그푸딩 함정](../start/dogfood-pitfalls.md)과 [설정 가이드](../start/dogfood-setup.md)를 확인해요.

**왜 이렇게?**: 이 문서가 "왜" 의 본진입니다. 더 깊은 인프라 결정은 [`인프라 결정 기록 (Decisions — Infrastructure)`](../production/deploy/decisions-infra.md).
