# ADR-035 — Lite 모드 사용자 인터페이스 (CLI + .env, GUI/결제는 future)

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~6분

**상태**: 채택 (2026-05-02)
**전제**: ADR-002 (Use this template — 심플 출발점), ADR-007 (solo-friendly), ADR-034 (Lite 모드 토글 메커니즘)
**연관**: 템플릿 판매 — 사용자 UX 결정

---

## 결론부터

Lite 모드의 *사용자 인터페이스* — 현재는 *CLI + .env* (사용자가 `app.features.X=false` 직접 편집). GUI / 결제게이트 (구독 결제로 unlock 등) 는 *future*.

이유: ADR-002 의 *심플 출발점* 정신 + ADR-007 의 *solo-friendly* — *솔로 운영자가 * 빠르게 활용* 가능한 가장 가벼운 형태가 *환경변수 토글*. GUI / 결제는 *복잡도 vs 가치* 검증 후 별도 사이클.

---

## 배경

ADR-034 가 backend 토글 메커니즘 (`@ConditionalOnProperty` + `app.features.*` env) 을 결정합니다. 본 ADR 은 **운영자/사용자가 어떻게 토글을 조작하는가** 를 결정해요.

검토한 옵션 4가지:
1. CLI 명령 (`<repo> feature disable payment`)
2. 사용자가 `.env` 직접 편집 (운영자 가이드)
3. admin 페이지 GUI (frontend 영역)
4. 결제 게이트 — false → true 시 결제 (template 판매 형태)

사용자 명시 원칙 — *심플 + 확장 가능*, *결제 게이트는 과한 설계*. ADR-002 의 *출발점* 철학과 ADR-007 의 *solo-friendly* 와 정합해요.

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
