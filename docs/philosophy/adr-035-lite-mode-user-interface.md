# ADR-035 — Lite 모드 사용자 인터페이스 (CLI + .env, GUI/결제는 future)

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~6분

**Status**: Accepted. Lite 모드 토글 인터페이스는 *CLI* (`<repo> feature list/enable/disable`) 가 1 급, `.env` 직접 편집이 2 급이에요. admin GUI / 결제 게이트는 본 ADR scope 밖으로 미뤘어요.

---

## 결론부터

[`ADR-034`](./adr-034-feature-toggle-lite-mode.md) 가 *backend toggle 메커니즘* (`@ConditionalOnProperty` + `app.features.*` 환경변수) 을 정의했다면, 본 ADR 은 *운영자가 그 토글을 어떻게 조작하는가* 를 결정합니다. 같은 토글이라도 *환경변수를 직접 편집*, *CLI 명령으로 자동화*, *admin GUI 로 클릭*, *결제 게이트로 unlock* 같은 다양한 인터페이스가 가능해요.

본 ADR 은 *CLI 명령* 을 1급 인터페이스로, *.env 직접 편집* 을 2급 보조 인터페이스로 정합니다. CLI 는 `<repo> feature list / enable / disable` 형태로 *토글 상태 조회와 변경* 을 명령 한 줄로 처리해요. fork 시점에 *불필요 도메인을 즉시 끄거나*, 운영 중에 *새 도메인을 활성화* 하는 흐름이 명령 → git commit → deploy 의 단순 체인으로 끝납니다. CLI 가 동작하지 않는 환경 (Windows / 제한된 shell) 의 운영자는 `.env` 를 직접 편집해 같은 결과를 얻을 수 있어요.

admin GUI 와 결제 게이트는 본 ADR 의 scope 밖으로 미뤄요. admin GUI 는 *frontend 영역* (Flutter / 별도 admin 콘솔) 이라 backend 의 결정에서 다룰 자리가 아니고, *운영 중 다양한 운영자가 토글을 자주 변경* 하는 환경에서나 의미가 있는데 *솔로 인디 운영자* 라는 본 template 의 typical 사용자에게는 과한 인프라예요. 결제 게이트 (예: *Pro plan 결제 시 push 모듈 unlock*) 는 *template 자체를 판매* 하는 비즈니스 모델에서나 의미가 있는데, 본 template 은 *fork 받아 자기 SaaS 를 만드는 출발점* 이라 *source 가 이미 사용자 손에 있는* 상태에서 결제 lock 은 우회 가능한 형식적 장치일 뿐입니다.

이 결정의 핵심 정신은 [`ADR-002`](./adr-002-use-this-template.md) 의 *깨끗한 출발점* 철학과 [`ADR-007`](./adr-007-solo-friendly-operations.md) 의 *솔로 친화* 정신이에요. 사용자가 fork 받아 *최소한의 도구 (CLI 또는 텍스트 편집기)* 로 즉시 자기 비즈니스에 맞게 변형할 수 있어야 하고, 그 변형 작업이 *별도 학습 곡선이나 외부 인프라 없이* 끝나야 합니다.

이 ADR 의 범위는 4 가지 인터페이스 옵션 (CLI / .env 직접 편집 / admin GUI / 결제 게이트) 의 트레이드오프 분석, CLI 와 .env 의 관계 (1 급 / 2 급), CLI 명령 동작의 구체 모양 (`feature list / enable / disable`), .env 와 환경변수 동기화 방식, 그리고 future scope (admin GUI / 결제 게이트) 의 도입 시점 가이드까지입니다.

---

## 왜 이런 결정이 필요했나?

backend 의 toggle 메커니즘 ([`ADR-034`](./adr-034-feature-toggle-lite-mode.md)) 만으로는 사용자 경험이 완성되지 않아요. *어떤 도메인이 활성화되어 있는지 조회*, *특정 도메인을 비활성화*, *비활성화 후 git commit + deploy* 같은 운영 작업이 *어떤 인터페이스로 일어나는지* 가 *Lite 모드의 실제 사용성* 을 좌우합니다.

토글 인터페이스의 후보 4 가지를 우리 사용자 환경 — *솔로 인디 운영자가 fork 받아 자기 SaaS 를 만드는 출발점* — 의 맥락에서 검토하면 각각 다른 트레이드오프를 가집니다.

**CLI 명령 (1급 후보)** 의 강점은 *fork 시점의 자동화* 와 *운영 중 빠른 변경* 이에요. 새 사용자가 fork 직후 *내 비즈니스에 결제만 필요해* 라고 결정하면 `<repo> feature disable iap`, `<repo> feature disable 2fa` 같은 명령 두세 줄이면 lite 변형이 끝납니다. 운영 중에도 *새 기능을 활성화* 할 때 같은 명령으로 처리되어 *환경변수 이름을 직접 외울 필요가 없어요*. 솔로 인디 운영자가 *터미널에서 작업하는 흐름* 과 자연스럽게 연결됩니다.

**.env 직접 편집 (2급 후보)** 은 *CLI 가 동작하지 않는 환경* 의 fallback 이에요. Windows 환경에서 bash 의존 명령이 동작하지 않거나, *원격 서버에 SSH 만 가능한 운영자* 가 텍스트 편집기로 토글을 변경할 수 있어야 합니다. CLI 는 *환경변수 이름과 값을 추상화* 하는 편의 도구이고, 그 아래에 있는 *진짜 데이터는 .env 의 텍스트* 라는 사실을 명시적으로 두는 형태예요.

**admin GUI (검토 후 미루기)** 는 *운영 중 다양한 운영자가 토글을 자주 변경* 하는 환경에서 의미가 있어요. 큰 조직이 *Pro / Enterprise 변형을 운영자별로 다르게* 켜는 경우라면 GUI 의 가치가 분명합니다. 다만 본 template 의 typical 사용자는 *솔로 인디 또는 소규모 팀* 이라 *운영자 = 개발자 1 인* 인 환경이고, 이 환경에서는 *CLI 한 줄이 GUI 클릭보다 빠르고 자동화도 쉬워요*. admin GUI 는 *frontend 영역* 이라 backend 의 결정에서 다룰 자리도 아니고, *Flutter / 별도 admin 콘솔* 같은 별도 사이클로 추가될 주제입니다.

**결제 게이트 (검토 후 거부)** 는 *template 자체가 SaaS 형태로 판매되는* 비즈니스 모델에서 의미가 있어요. 사용자가 *Free plan* 으로 시작했다가 *Pro plan 으로 업그레이드 시 push / 2FA 모듈을 unlock* 하는 형태입니다. 그러나 본 template 은 *fork 받아 자기 SaaS 의 source 를 소유* 하는 모델이라 *source 가 이미 사용자 손에 있는* 상태예요. 사용자가 *결제 lock 을 우회* 하려면 그냥 *코드의 conditional 조건을 직접 수정* 하면 되어, 결제 게이트 자체가 형식적 장치일 뿐 진짜 lock 을 만들지 못합니다. 만약 SaaS 형태로 hosted backend 를 판매한다면 그건 본 template 가 아니라 *별도 product 의 영역* 이라 본 ADR scope 밖이에요.

이 분석에서 자연스럽게 *CLI 1 급 + .env 2 급* 의 형태가 나옵니다. 두 인터페이스가 *같은 데이터를 두 가지 방법으로 조작* 하는 형태라 *어느 한쪽이 동작하지 않는 환경에서도 다른 한쪽으로 fallback* 가능하고, *fork 시점의 자동화 / 운영 중 빠른 변경* 의 두 시점을 모두 커버합니다. admin GUI 와 결제 게이트는 *현재 단계에서 도입 비용 vs 가치* 가 맞지 않아 future scope 로 명시 미룹니다.

이 결정이 답해야 할 물음은 이거예요.

> **솔로 인디 운영자가 fork 받아 자기 SaaS 의 출발점으로 쓰는 환경에서, lite 모드 토글을 어떻게 조작하면 fork 시점 자동화와 운영 중 변경을 가장 가벼운 도구로 처리할 수 있는가?**

---

## 결정

| Layer | 선택 | 시점 | 근거 |
|---|---|---|---|
| 1차 — CLI | ✅ 채택 | 즉시 | `<repo> feature list/enable/disable` — 운영자 자동화 가능합니다 |
| 1차 — .env 직접 편집 | ✅ 보조 | 즉시 | docs 가이드. CLI 사용 못 하는 환경의 fallback 이에요 |
| 2차 — admin GUI | ❌ 본 ADR 외 | future | frontend 영역 (Flutter / 별도 admin 콘솔). backend 의 admin endpoint (선택) 만 본 ADR 이 cover 해요 |
| 3차 — 결제 게이트 | ❌ 본 ADR 외 | future | 본 template 의 SaaS 사용자가 자기 자신의 결제 backend (`core-payment-impl`) 를 운영 — 판매 시 결제 lock 은 over-engineering 입니다 |

### 결정 근거

ADR-002 의 정신은 *프로젝트의 출발점* 이에요. 사용자가 fork 후 자기 비즈니스 로직을 추가합니다. lite 모드는 fork 시점의 변형 선택 (또는 운영 중 토글) 이고, 두 시점 모두 **CLI 가 가장 효율적** 이에요:

- fork 시점: `<repo> feature disable payment` 실행 후 `git commit`
- 운영 중: 같은 명령 + `<repo> prod deploy`

GUI 는 미사용 시점의 사용자가 만지는 영역이 아닙니다. admin 콘솔이 필요한 시점은 **운영 중 다양한 운영자가 토글을 변경** 하는 시점인데, 본 template 의 typical 사용자 (솔로 인디 / 소규모 팀) 에선 운영자 = 개발자 1인 → CLI 로 충분해요.

결제 게이트 (옵션 4) 의 한계 — 본 template 는 *판매되는 SaaS 백엔드* 가 아니라 *fork 받아 자기 SaaS 만드는 출발점* 이에요. fork 후 사용자가 자기 비즈니스의 결제를 적용합니다. **lite 모드 토글에 결제 lock 을 거는 건 의미가 없어요** — fork 시점에 source 가 사용자 손에 있어 우회 가능합니다.

---

## 사용자 인터페이스 (현재 적용)

### 1. CLI (1급 — 권장)

```bash
# 토글 list + 현재 상태
<repo> local feature list

# 비활성
<repo> local feature disable audit

# 활성
<repo> local feature enable audit

# 결과 검증
<repo> local server-test           # 부팅 OK
<repo> local api-test              # disabled feature step 자동 SKIP
```

### 2. .env 직접 편집 (보조)

```bash
# .env 또는 .env.prod 에 추가
APP_FEATURES_AUDIT=false

# 적용 — 부팅 시점에만 반영
<repo> local server-test          # docker compose restart spring
```

CLI 가 `.env` + `.env.prod` 를 동시 변경하는 것에 비해 한쪽만 변경합니다. 직접 편집 시 사용자가 양쪽 동기화 책임을 져야 해요.

---

## 토글 매트릭스 (검증 결과)

| Feature | default | toggle off 동작 | 검증 |
|---|---|---|---|
| `audit` | true | AuditPort bean 미등록 → `@Audited` 무동작 | ✅ FeatureToggleTest |
| `push` | true | PushPort bean 미등록 → 푸시 발송 무동작 | ✅ FeatureToggleTest |
| `billing-notification` | true | listener 미등록 → 갱신 알림 X | ✅ ConditionalOnExpression |
| `password-policy` | true | PasswordValidator 미등록 → @ValidPassword 무동작 | ✅ ConditionalOnProperty |
| `payment` | true | 🟡 후속 — 토글 시 부팅 fail | ADR-034 의 invasive 후속 |
| `iap` | true | 🟡 후속 — 토글 시 부팅 fail | 동일 |
| `email` | true | 🟡 후속 — 토글 시 부팅 fail | 동일 |
| `2fa` | true | 🟡 후속 — 토글 시 부팅 fail | 동일 |

### 검증 절차 (운영자가 수동 확인)

```bash
# 1. default true 상태 baseline
<repo> local server-test
<repo> local api-test               # 모든 11 step PASS 확인

# 2. leaf feature 1 종 토글
<repo> local feature disable audit
<repo> local server-test            # 부팅 OK 확인
<repo> local api-test               # step 11 (Audit 로그 검증) → SKIP 확인

# 3. 다시 활성
<repo> local feature enable audit
<repo> local api-test               # step 11 PASS 복귀 확인
```

위 시나리오는 `bootstrap/FeatureToggleTest` 가 자동화합니다 (Testcontainers + @SpringBootTest).

---

## "false 일 때 제공 안 함" 의 정확한 의미

Spring 의 `@ConditionalOnProperty` 동작은 다음과 같습니다:
- false → AutoConfiguration 자체가 등록되지 않아요
- AutoConfiguration 의 bean (Service / Adapter / Aspect) 도 생성되지 않아요
- 의존하는 controller endpoint 의 ApplicationContext mapping 도 등록되지 않아요
- runtime 에 호출 시 → **404 Not Found** (Spring DispatcherServlet 가 매핑이 없어 응답해요)

즉 **물리적으로 endpoint 가 사라집니다** — 우회 불가능. 사용자가 disabled feature 의 URL 을 호출하면 404 가 반환되고, 이는 우리 backend 의 의도된 응답이에요.

코드는 jar 안에 그대로 남습니다 (Spring conditional 의 trade-off — ADR-034 § Alternatives 참조). jar 크기 ~5-10MB 차이는 운영에 영향이 없어요.

---

## Future scope (본 ADR 외)

### admin GUI (옵션 3)

backend 가 admin endpoint 노출 가능:
```
GET  /api/admin/features          # 현재 토글 상태 list
PATCH /api/admin/features/{name}  # 토글 변경 (운영자 권한 필요)
```

`@AdminOnly` (ADR-027) + `@Audited` (ADR-028) 로 보호합니다. frontend (Flutter / 별도 React admin) 가 본 endpoint 를 소비해요.

본 ADR 시점에는 미구현 — 본 template 의 typical 사용자에게는 over-engineering 이라 다음 사이클로 미뤄요.

### 결제 게이트 (옵션 4)

본 template 는 fork-and-go 모델이라 사용자가 source 를 소유합니다. 결제 lock 은 의미가 없어요. 만약 SaaS 형태로 hosted backend 를 판매한다면 본 template 가 아니라 별도 product 의 영역이라 본 ADR scope 밖이에요.

---

## 운영 영향

- ✅ 추가 GUI / 결제 인프라 부담이 0 입니다 (본 시점)
- ✅ CLI 자동화가 가능해요 (`<repo> feature ...` script 작성 가능)
- ✅ ADR-002 의 *출발점* 정신을 유지합니다
- ⚠️ 운영자가 직접 `.env` 를 편집하면 `.env.prod` 동기 책임이 사용자에게 있어요 (CLI 가 자동화하지만 docs 만 보고 편집하면 누락 가능)

---

## 관련 문서

- [`ADR-034 · Lite 모드 토글 메커니즘`](./adr-034-feature-toggle-lite-mode.md)
- [`ADR-002 · Use this template`](./adr-002-use-this-template.md)
- [`ADR-007 · Solo-friendly operations`](./adr-007-solo-friendly-operations.md)
- [`docs/production/operations/feature-toggle.md`](../production/operations/feature-toggle.md) — 운영자 가이드
- `tools/feature.sh` — CLI 구현
- `bootstrap/src/test/java/.../FeatureToggleTest` — 자동 검증
