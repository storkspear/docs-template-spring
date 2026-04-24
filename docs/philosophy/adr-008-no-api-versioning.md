# ADR-008 · API 버전 관리는 Phase 0 에서 미도입

**Status**: Accepted. 2026-04-24 기준 모든 API 경로에서 `/v1/` 같은 버전 접두사 **없음**. 현재 경로는 `/api/core/*`, `/api/apps/{appSlug}/*` 두 가지 prefix 만. 미래 도입 경로 (Cloudflare 리버스 프록시 경유 또는 `@RequestMapping` prefix 변경) 는 한 줄 작업으로 열려 있음.

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~5분

## 결론부터

API 엔드포인트에 `/v1/` 을 붙이지 않아요. 이유는 단순 — **버전 관리가 필요한 시나리오가 아직 아니기 때문**. 버전 관리의 본질은 "서버 측에서 통제할 수 없는 클라이언트" 를 위한 것이고, 우리는 서버와 Flutter 앱을 **같은 사람이 운영**합니다. API 가 바뀌면 서버 + 앱을 같이 배포하면 끝. 미래에 공개 API 나 멀티 버전 클라이언트가 생기면 그 시점에 Cloudflare 리버스 프록시 (`/api/v1/*` → `/api/*`) 또는 한 줄 `@RequestMapping` prefix 수정으로 도입. YAGNI 원칙의 전형.

## 왜 이런 고민이 시작됐나?

백엔드 컨벤션의 **거의 항상적 권장사항** 이 "API 는 처음부터 `/v1/` 을 붙이세요" 예요. Stripe, GitHub, Twitter 같은 대형 API 들은 전부 버전 접두사를 사용. "당연히 해야 하는 것" 처럼 받아들여져요.

그런데 **버전 관리가 실제로 해결하는 문제** 를 다시 생각해보면:

> 여러 버전의 API 를 **동시에** 운영해야 한다.

이게 왜 필요한가? — **"버전 n 을 쓰는 클라이언트" 와 "버전 n+1 을 쓰는 클라이언트" 가 공존하기 때문**. 즉 서버 API 가 변경되어도 예전 버전을 쓰는 클라이언트를 즉시 깨뜨릴 수 없음.

이 상황이 성립하는 조건은 셋:

1. **공개 API** — 외부 개발자가 우리 API 를 씀. 그들의 배포 스케줄을 통제 못 함.
2. **제3자 통합** — 파트너 시스템이 우리 API 를 호출. 그들의 업그레이드를 강제 못 함.
3. **멀티 버전 클라이언트** — 같은 우리 앱도 "구버전 유저 + 신버전 유저" 가 공존 (앱스토어 업데이트 지연).

**우리 상황을 대비하면**:

- 공개 API **아님** — API 소비자 = Flutter 앱 1개
- 제3자 통합 **없음** — 파트너 API 없음
- 멀티 버전 클라이언트 **부분 해당** — 앱스토어 업데이트는 지연 가능. 하지만 Flutter "강제 업데이트" 화면으로 대응 가능.

즉 버전 관리의 전통적 정당화 세 가지 중 **2.5개가 안 맞음**.

이 결정이 답할 물음은 이거예요.

> **"모든 API 는 처음부터 `/v1/` 을 붙여라" 라는 업계 권장이 우리 상황에서도 적용되는가?**

## 고민했던 대안들

### Option 1 — 처음부터 `/v1/` 접두사 (업계 표준)

`/api/v1/core/users/me`, `/api/v1/apps/{slug}/auth/email/signup` 형태.

- **장점**:
  - 업계 표준. 다른 백엔드 개발자가 보면 즉시 이해.
  - 미래 v2 로 변경될 때 공존 가능한 구조.
  - Stripe, GitHub 등 대규모 API 레퍼런스와 일관.
- **단점**:
  - **현재 쓰는 `v1` 외에는 아무 가치 없음** — 모든 URL 에 `/v1/` 을 3 글자 더하는 사소한 비용. 그런데 곱하기 엔드포인트 수 × 문서 반복 = 누적됨
  - 버전 관리 인프라 (deprecation scheduler, 다중 버전 라우팅) 를 미리 준비할 **심리적 부담**
  - "v1 을 썼으니 v2 도 준비해야" 라는 연쇄 압력 — 쓸 일이 없어도
- **탈락 이유**: 현재 이득 0, 미래 이득도 한 줄 리팩토링으로 얻을 수 있음. 업계 표준 이라는 이유만으론 채택 근거 부족.

### Option 2 — 처음엔 붙이지 않고 필요해지면 Cloudflare 리버스 프록시로 소급

현재: `/api/core/*`, `/api/apps/*`. 필요해지면 Cloudflare (또는 nginx) 에서 `/api/v1/*` → `/api/*` 리다이렉트 규칙만 추가.

- **장점**:
  - 현재 URL 이 단순
  - 미래 도입 시점이 왔을 때 **한 줄 설정** 으로 해결
  - 도입 시점을 미룰 수 있음 (필요해질 때 도입)
- **단점**:
  - Cloudflare / nginx 설정 복잡도 (우리 환경에서는 이미 Cloudflare Tunnel 사용중이라 추가 부담 없음)
  - URL 재작성 시 클라이언트 로그 / 모니터링의 "원본 vs 재작성" 이 혼란 가능
- **보완**: **도입 시점의 선택지 하나** 로 문서화. 현재는 Option 3 우선.

### Option 3 — 처음엔 붙이지 않고 필요해지면 `@RequestMapping` prefix 변경 ★ (채택)

현재: `/api/core/*`, `/api/apps/*`. 필요해지면 `ApiEndpoints` 상수 + `@RequestMapping` prefix 를 `api/v1` 로 한 줄 변경. 또는 `common-web` 에 `@RequestMapping(prefix = "/api/v1")` 글로벌 prefix 설정.

- **장점**:
  - **URL 이 현재 깔끔** — `/api/apps/sumtally/auth/email/signup` (verbose 하지 않음)
  - **도입 시점에 비용 소수 분** — `ApiEndpoints` 의 `public static final String API_BASE = "/api"` 한 줄을 `"/api/v1"` 로 수정
  - **미래 옵션 보존** — 필요해지면 Cloudflare 방식과 병행 가능
  - **YAGNI 원칙 준수** — "미래에 쓸 지도" 기반 복잡도 선제 도입 금지
- **단점**:
  - 업계 표준과 다름. 새로 합류하는 개발자가 "왜 v1 없지?" 라고 물을 수 있음 (본 ADR 이 답)
  - 진짜 필요해진 시점에 "이미 늦었나?" 라는 의심 생길 수 있음
- **채택 이유**:
  - [`제약 2 (시간이 가장 희소한 자원)`](./README.md#제약-2--시간이-가장-희소한-자원) 에 부합 — 지금 쓸데없는 복잡도 제거
  - 도입 시점 비용이 저렴 (한 줄 설정)
  - [`ADR-007 (솔로 친화적 운영)`](./adr-007-solo-friendly-operations.md) 의 "지금 필요 없으면 안 한다" 원칙과 정합

## 결정

### 현재 URL 구조

```java
// common-web/ApiEndpoints.java
public final class ApiEndpoints {
    public static final String APP_BASE = "/api/apps/{appSlug}";

    public static final class Auth {
        public static final String BASE = APP_BASE + "/auth";
        // /api/apps/{appSlug}/auth
    }

    public static final class User {
        public static final String BASE = "/api/core/users";
        // /api/core/users
    }
}
```

모든 경로는 **두 가지 prefix** 로 분류:

| Prefix | 용도 |
|---|---|
| `/api/apps/{appSlug}/*` | 앱별 엔드포인트 ([`ADR-013`](./adr-013-per-app-auth-endpoints.md)) |
| `/api/core/*` | 크로스 앱 공통 엔드포인트 (header, admin 등) |

**`/v1/` 접두사는 없음**. [`ApiEndpoints.java`](https://github.com/storkspear/spring-backend-template/blob/main/common/common-web/src/main/java/com/factory/common/web/ApiEndpoints.java) 에서 grep 검증: `/v1/`, `/v2/` 문자열 0건.

### 미래 도입 시점 체크리스트

**버전 관리가 필요해진 신호**:

1. **외부 개발자가 우리 API 를 쓰기 시작** — OAuth 파트너, SDK 사용자 등장
2. **앱스토어 업데이트 지연으로 구버전 트래픽 관찰됨** — 새 API 배포했는데 구버전 앱 트래픽이 주 단위로 지속
3. **모바일 외 클라이언트 추가** — 웹 대시보드, 서드파티 봇 등

### 도입 경로 두 가지

**경로 A** — Cloudflare 리버스 프록시 재작성:

```
외부 요청: /api/v1/apps/sumtally/auth/email/signup
   ↓ (Cloudflare rewrite 규칙)
내부 처리: /api/apps/sumtally/auth/email/signup
```

장점: 코드 변경 0. 단점: 인프라 단에서 URL 이 변경되므로 로그/관측 복잡.

**경로 B** — `ApiEndpoints` prefix 변경 (한 줄):

```java
// ApiEndpoints.java 한 줄 수정
public static final String APP_BASE = "/api/v1/apps/{appSlug}";
public static final String CORE_BASE = "/api/v1/core";
```

장점: URL 이 실제 코드 레벨에서 v1. Flutter 클라이언트 `base_url` 도 `/api/v1` 로 명시. 단점: 배포 시 Flutter 도 같이 업데이트 필요.

실제 도입 시점에는 **대개 경로 B** — 클라이언트와 서버를 동시에 배포할 수 있는 우리 상황에서는 인프라 복잡도를 더하지 않음.

### 전환 기간이 필요해지면 (멀티 버전 공존)

진짜로 "구버전과 신버전 공존" 이 필요해지면 (공개 API 단계) 경로 A + B 를 조합:

```
/api/v1/* → 구버전 라우트 (deprecate 스케줄)
/api/v2/* → 신버전 (현재 `/api/*` 를 여기로 매핑)
/api/*    → /api/v2/* 로 301 redirect (기본값)
```

이 복잡도는 **진짜 필요해진 시점** 에만. 지금은 위 구조를 만들 준비조차 필요 없음.

## 이 선택이 가져온 것

### 긍정적 결과

**URL 이 간결** — `/api/apps/sumtally/auth/email/signup` 대신 `/api/v1/apps/sumtally/auth/email/signup` 를 쓰지 않음. 로그 / Swagger / 문서의 시각적 노이즈 감소.

**심리적 부담 감소** — "버전 관리 인프라" (deprecation scheduler, multi-version routing) 를 준비해야 한다는 압력이 없음. `ApiEndpoints` 상수 관리에 집중.

**YAGNI 증명** — 2026-04-24 현재까지 "버전 관리 필요해진 시점" 은 한 번도 도래하지 않음. 초기 도입 안 한 결정이 실질 비용으로 돌아온 사례 0.

**도입 경로가 명확** — 미래에 필요해지면 어떻게 할지 본 ADR 에 두 경로로 기록. 의사 결정 재고 비용 없음.

### 부정적 결과

**업계 표준과 다른 URL** — 외부 개발자가 우리 레포를 보고 "왜 v1 없지?" 라고 의아해할 수 있음. 완화: 본 ADR 이 답변. `docs/api-contract/versioning.md` 에도 교차 참조.

**도입 시점 판단의 모호함** — "외부 개발자가 쓰기 시작" 은 스펙트럼이다. 몇 명부터 "필요한 시점" 인가? 완화: 도입 체크리스트의 3개 신호 중 하나라도 관찰되면 ADR 재검토.

**전환 기간 설계의 미준비** — 멀티 버전 공존이 갑자기 필요해지면, 그 시점에 설계를 처음 하게 됨. 완화: 대부분의 경우 "한 번에 v2 로 통째 이전" 이 가능 (서버+클라 같이 배포). 공개 API 단계에서만 공존 이슈 발생 — 그 단계에 도달하면 충분한 설계 시간 확보 가능.

### 현재 구조는 [`ADR-013`](./adr-013-per-app-auth-endpoints.md) 와 함께 읽을 것

API URL 구조는 버전 관리 외에도 **다른 축** 이 있어요:

| 축 | ADR | 현재 선택 |
|---|---|---|
| 버전 관리 | 본 ADR | 미도입 |
| 앱 식별 방식 | [`ADR-013`](./adr-013-per-app-auth-endpoints.md) | URL path (`{appSlug}`) |
| 인증 토큰 | [`ADR-006`](./adr-006-hs256-jwt.md) | HS256 Bearer header |

미래에 버전 관리 도입 시에도 이 축들은 유지. `/api/v1/apps/{appSlug}/...` 로 앱 식별은 그대로, 버전만 추가되는 형태.

## 교훈

### "업계 표준을 왜 안 따르나" 에 답할 준비가 필요함

API 버전 접두사는 **거의 반사적으로 당연하게** 권장되는 패턴. 신입 개발자 / 외부 리뷰어가 본 레포를 보면 **가장 먼저 지적하는 포인트** 일 수 있음.

이때 "필요 없어서요" 로 답하면 신뢰를 잃어요. "모르는 것" 과 "알고 거절한 것" 의 구분이 흐려지니까.

본 ADR 은 다음 두 가지를 명시:

1. **버전 관리가 해결하는 문제** (공개 API, 제3자 통합, 멀티 버전 클라이언트)
2. **우리 상황이 그 문제에 해당 안 되는 이유** (서버-클라 동시 배포 가능)

"모르고 안 한 것" 이 아니라 "알고 거절한 것" 이 드러나야 합의 가능.

**교훈**: 업계 표준을 거절하는 결정은 **거절 근거를 문서로 박아두는 것** 이 가장 중요. 말로 설명하면 흩어짐.

### YAGNI 는 **미래 옵션 보존** 과 한 묶음

YAGNI (You Aren't Gonna Need It) 의 단순 해석은 "쓸데없는 거 만들지 마" 지만, 실제 적용은 **"쓸데없는 것 생성하지 않기 + 미래 도입 경로 보존"** 의 한 쌍.

본 ADR 은 "지금 안 한다" 만 하고 끝나면 불완전. "나중에 어떻게 할지" 를 함께 명시해야 YAGNI 가 안전한 선택이 됨.

경로 A (Cloudflare) + 경로 B (ApiEndpoints prefix) + 멀티 버전 공존 시나리오 까지 기록. 미래의 본인 (또는 후임) 이 "시점이 왔을 때 뭘 해야 하는지" 를 당황하지 않고 수행 가능.

**교훈**: YAGNI 로 뭔가를 거절할 때는, **도입 시점 시나리오를 함께 기록**해야 함. 그렇지 않으면 "언젠가 해야 한다는데 뭘 해야 할지 모르는" 상태가 됨.

### 작은 복잡도의 누적을 경계

"`/v1/` 세 글자만 붙이면 되는데?" 라는 관점은 **복잡도를 과소평가** 하는 함정. 실제로는:

- 모든 엔드포인트 URL 3글자 더함 → 로그 엔트리 더 길어짐
- Swagger / 문서에서 반복 출현
- 테스트 assertion 에 반영
- Flutter 클라이언트 base URL 변경

누적 비용이 적지 않음. 버전 관리 **가치가 분명한 시점** 전에는 이 비용을 회피하는 게 합리적.

**교훈**: "세 글자" 같은 작은 변경이라도, 곱하기 엔드포인트 수 × 문서 반복 × 테스트 = 무시 못 할 누적. 소소해 보이는 복잡도를 먼저 거절하는 태도가 **[`ADR-007 (솔로 친화적 운영)`](./adr-007-solo-friendly-operations.md)** 과 일치.

## 관련 사례 (Prior Art)

- **[Stripe API · Versioning](https://docs.stripe.com/api/versioning)** — 공개 API 의 대표적 버전 관리 (`/v1/`). 본 ADR 이 비교 대상으로 언급.
- **[GitHub REST API · Versioning](https://docs.github.com/en/rest/overview/api-versions)** — 헤더 기반 버전 관리 + URL 접두사. 공개 API 전제.
- **[Basecamp API · Unversioned URLs](https://github.com/basecamp/bc3-api)** — Basecamp 3 API. 버전 접두사 없이 단순 URL 구조. 본 ADR 과 같은 철학.
- **[Martin Fowler · "Is Design Dead?"](https://martinfowler.com/articles/designDead.html)** — YAGNI 원칙의 원조 문서.
- **[Kent Beck · Extreme Programming Explained](https://www.goodreads.com/book/show/67833.Extreme_Programming_Explained)** — YAGNI + "simplest thing that could possibly work" 철학의 출처.
- **[Pragmatic REST — "Web API Design: The Missing Link"](https://cloud.google.com/blog/products/application-development/api-design-why-you-should-use-links-not-keys-to-represent-relationships-in-apis)** — "버전 관리의 실제 가치" 분석. 본 ADR 의 거절 논리 참조.

## Code References

**현재 API 경로 구조**:
- [`common-web/ApiEndpoints.java`](https://github.com/storkspear/spring-backend-template/blob/main/common/common-web/src/main/java/com/factory/common/web/ApiEndpoints.java) — 모든 API 경로 상수, `/v1/` 없음 (grep 검증)
- 모든 `@RequestMapping` 이 `ApiEndpoints` 상수를 참조 — 일원화

**미래 도입 관련 문서**:
- [`버전 규약 & Deprecation 프로세스`](../api-and-functional/api/versioning.md) — 템플릿 단위 SemVer + API URL 버전 관리 **미도입** 근거
- [`Flutter ↔ Backend Integration`](../api-and-functional/api/flutter-backend-integration.md) — 클라이언트 통합 (버전 언급 없음)

**YAGNI 증명 (부재 확인)**:
- `grep -r "/v1/" common/ core/ apps/ bootstrap/ tools/` — 0건
- `grep -r "api/v" docs/` — versioning.md 의 "미도입" 설명 외 없음
- 버전 관리 인프라 (deprecation scheduler, multi-version router) — 없음

**관련 ADR**:
- [`ADR-007 · 솔로 친화적 운영`](./adr-007-solo-friendly-operations.md) — "지금 필요 없다" 원칙의 뿌리
- [`ADR-013 · 앱별 인증 엔드포인트`](./adr-013-per-app-auth-endpoints.md) — URL 구조의 다른 축 (앱 식별)
- [`ADR-015 · Conventional Commits + SemVer`](./adr-015-conventional-commits-semver.md) — 템플릿 전체 SemVer (API 버전과 별개)
