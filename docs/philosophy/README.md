# Repository Philosophy — 책 안내

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

복권 사기로 비유하면: 당첨 확률은 낮아도 **한 장의 가격이 100원** 이면 1만 장을 살 수 있어요. 반대로 한 장이 10만원이면 3장도 못 삽니다. 이 프로젝트의 존재 이유는 **새 앱 출시 비용을 극단적으로 낮추는 것** — 앱 하나 만드는 데 며칠이 아니라 몇 시간 수준으로 압축하는 게 목표입니다.

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

이 문서는 **16개의 ADR 카드** 로 구성되어 있으며, 각 카드는 하나의 설계 결정을 다룹니다. 전체를 순서대로 읽는 것이 가장 좋지만, 독자의 상황과 목적에 따라 진입점이 달라질 수 있어요.

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

> **16 개 ADR 모두 작성 완료**. 테마별로 그룹화되어 있으며, 각 카드는 독립적으로 읽을 수 있어요.

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

**테마 3 의 결론**: 한 Postgres 인스턴스 · 한 database 안에서 앱마다 schema 를 분리하고, 유저 테이블도 그 schema 에 독립 소유. DB role · DataSource · Flyway · 포트 · ArchUnit 의 5중 방어선으로 경계를 강제. JWT 의 단일 `appSlug` claim 과 `AppSlugVerificationFilter` 로 런타임 오용을 차단. ThreadLocal 기반 동적 라우팅은 전면 폐기.

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
```

- [`ADR-006 · HS256 JWT (대칭키)`](./adr-006-hs256-jwt.md)
- [`ADR-013 · 앱별 인증 엔드포인트 (core-auth 는 라이브러리 역할)`](./adr-013-per-app-auth-endpoints.md)

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

---

## 템플릿 유지 규칙 (절대 금지)

이 템플릿 레포에 커밋할 때 **반드시** 지킨다. 파생 레포에는 적용되지 않는다 — 거기에선 오히려 도메인 로직을 적극적으로 쓴다.

- **특정 앱/도메인/팀/회사 이름** 을 코드나 문서에 박지 않는다. 템플릿이 중립적이어야 어느 도메인으로든 가지를 뻗을 수 있다.
- **특정 인프라 자격증명, 계정 식별자, 프로젝트 ID** 를 커밋하지 않는다. Supabase project-ref, Google Client ID, Firebase 키 등은 파생 레포의 `.env` 에서만 존재해야 한다.
- **실제 비즈니스 로직** 을 이 레포에 쓰지 않는다 — 그건 파생 레포의 역할이다. 여기에는 뼈대, 포트 인터페이스, 공통 인프라만 둔다.
- **구체적인 스펙 문서** (특정 앱이 언급되는 요구사항/API 문서 등) 를 여기 두지 않는다.
- **운영 환경 변수 파일 (`.env.prod`, `.env.production` 등) 을 커밋하지 않는다.** 운영용 값은 GHA Repository Secrets 만 사용.

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
