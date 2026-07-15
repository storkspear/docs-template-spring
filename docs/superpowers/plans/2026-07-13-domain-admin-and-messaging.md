# 도메인 admin + 발송 구현 플랜 (P1~P4)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 또는 superpowers:executing-plans 로 태스크 단위 구현. 스텝은 `- [ ]` 체크박스.

**Goal:** 스펙 [`2026-07-13-domain-admin-and-messaging-design.md`](../specs/2026-07-13-domain-admin-and-messaging-design.md) 을 P1(앱 컨텍스트 전환)→P2(발송)→P3(도메인 확장포인트)→P4(파생 샘플) 순으로 구현.

**Architecture:** 앱 컨텍스트 전환형 네비(앱 스위처 ↔ SlugContext). 도메인 admin 은 백=앱모듈·프=파생레포 확장포인트. 발송은 per-app `message_send_history` + 세그먼트 타겟팅.

**Tech Stack:** 프론트 React 19 + Vite + Ant Design 5 + TanStack Query + MSW. 백엔드 Spring Boot 멀티모듈 + JdbcTemplate + Flyway + Testcontainers.

## Global Constraints

- 프론트 단위 테스트 하네스 없음 → 검증 = `npx tsc -b` + `npm run build` + `npm run lint`(oxlint) + MSW 목 동작 확인. 백엔드 = Testcontainers IT + `:bootstrap:test`(ArchUnit r1~r22).
- Mapper/Converter 클래스 신설 금지 — Entity `toXxx()`. Controller→Service→Repository. cross-domain 은 Port.
- `ErrorInfo`/`AdminError` enum 기존 번호 재배치 금지, 추가만.
- 커밋 Conventional Commits(`type(scope): subject`), Co-Authored-By 금지. scope enum: auth/user/device/push/billing/sms/phone-auth/common/bootstrap/admin/spec/docs/core/apps/tools/ops/infra/env/deploy.
- 프론트 변경은 `template-react-admin` 에서 하고, 사이클 끝에 `rsync -a --delete src/ ../admin-console-v2/src/` 로 전파. push 는 사이클 누적 후 마지막에.
- 권한/역할 변경은 재로그인 시 반영(JWT claim 발급 시점 고정).

---

# P1 — 앱 컨텍스트 전환 (프론트 전용, 공통 콘솔만으로 완결)

**현재 상태(조사 확정)**: 백엔드는 이미 per-app 엔드포인트(`/api/admin/apps/{slug}/users|billing|files|...`). 프론트 페이지(UsersPage·FilesPage·AuditLogsPage·SendPage)는 각자 `useAppOptions()` 로컬 드롭다운으로 앱 선택(기본 `firstSlug`). AppLayout 사이드바는 `MENU_ITEMS.filter(canReadKey)` 평면 렌더. PaymentsPage 의 앱 선택 방식은 Task 4 에서 파일 확인 후 처리.

**P1 목표**: 페이지별 앱 드롭다운 → **전역 앱 스위처**(AppLayout) 로 승격 + nav 를 `scope`(global/app) 인지로 재편. `전체` 컨텍스트에선 cross-app 메뉴만, 앱 선택 시 per-app 메뉴 + (P3 이후) 도메인 섹션.

## File Structure (P1)
- Create `src/lib/appContext.tsx` — 선택 slug 전역 상태(`null`=전체) + provider + `useAppContext()`. sessionStorage 지속.
- Modify `src/nav.tsx` — `NavItem.scope` 추가 + `menuItemsForScope()`.
- Modify `src/components/AppLayout.tsx` — 앱 스위처 Select(헤더) + 스코프 기반 사이드바.
- Modify `src/App.tsx` — Provider 배선 + 전체 컨텍스트에서 app-scoped 라우트 접근 시 가드.
- Modify 페이지들 — 로컬 앱 드롭다운 제거, `useAppContext().slug` 소비: `UsersPage.tsx`, `FilesPage.tsx`, `AuditLogsPage.tsx`, `SendPage.tsx`, (+`PaymentsPage.tsx` 확인 후).

---

### Task 1: 앱 컨텍스트 provider/hook

**Files:**
- Create: `src/lib/appContext.tsx`

**Interfaces:**
- Produces: `AppContextProvider` (컴포넌트), `useAppContext(): { slug: string | null; setSlug(s: string | null): void; apps: AppSummary[]; options: {value:string;label:string}[]; isLoading: boolean }`. `slug === null` ⇒ 전체(global) 컨텍스트.

- [ ] **Step 1: 컨텍스트 작성**

```tsx
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { useAppOptions } from './useAppOptions'

const KEY = 'admin.appSlug'
type Ctx = {
  slug: string | null
  setSlug: (s: string | null) => void
  apps: ReturnType<typeof useAppOptions>['apps']
  options: { value: string; label: string }[]
  isLoading: boolean
}
const AppCtx = createContext<Ctx | null>(null)

export function AppContextProvider({ children }: { children: ReactNode }) {
  const { apps, options, isLoading } = useAppOptions()
  const [slug, setSlugState] = useState<string | null>(() => sessionStorage.getItem(KEY))
  const setSlug = useCallback((s: string | null) => {
    setSlugState(s)
    if (s) sessionStorage.setItem(KEY, s)
    else sessionStorage.removeItem(KEY)
  }, [])
  return <AppCtx.Provider value={{ slug, setSlug, apps, options, isLoading }}>{children}</AppCtx.Provider>
}

export function useAppContext(): Ctx {
  const c = useContext(AppCtx)
  if (!c) throw new Error('useAppContext must be used within AppContextProvider')
  return c
}
```

- [ ] **Step 2: 검증** — `npx tsc -b` (에러 0). 커밋: `feat(admin): 앱 컨텍스트 provider/hook 추가`

---

### Task 2: nav 에 scope 필드 + 스코프 필터

**Files:**
- Modify: `src/nav.tsx`

**Interfaces:**
- Produces: `NavItem.scope?: 'global' | 'app'` (기본 global), `menuItemsForScope(hasApp: boolean): NavItem[]`.

- [ ] **Step 1: NavItem 인터페이스에 scope 추가** — `scope?: 'global' | 'app'` 필드 + 주석.
- [ ] **Step 2: 각 메뉴에 scope 부여** — global: `/`(대시보드), `/apps`(앱·분석), `/roles`, `/settings`, `/components`. app: `/users`, `/payments`, `/files`, `/audit-logs`, `/send`. (`/apps/:slug` 는 label 없음 유지)
- [ ] **Step 3: 필터 헬퍼 추가**

```tsx
/** 현재 컨텍스트(hasApp=앱 선택됨)에서 보일 메뉴. global 은 항상, app 은 앱 선택 시만. */
export function menuItemsForScope(hasApp: boolean): NavItem[] {
  return MENU_ITEMS.filter((n) => (n.scope === 'app' ? hasApp : true))
}
```

- [ ] **Step 4: 검증** — `npx tsc -b`. 커밋: `feat(admin): nav 에 scope(global/app) 필드 + 스코프 필터`

---

### Task 3: AppLayout 앱 스위처 + 스코프 사이드바

**Files:**
- Modify: `src/components/AppLayout.tsx`

**Interfaces:**
- Consumes: `useAppContext()`, `menuItemsForScope()`.

- [ ] **Step 1: 앱 스위처 Select 추가** — 헤더 좌측(모바일 메뉴 버튼 옆)에 `Select`: 옵션 `[{value:'', label:'전체'}, ...options]`. 값은 `slug ?? ''`, onChange 로 `setSlug(v || null)`. `showSearch`, width ~180.
- [ ] **Step 2: 사이드바를 스코프 필터로 교체** — 현재 `MENU_ITEMS.filter((n) => canReadKey(n.path))` → `menuItemsForScope(slug !== null).filter((n) => canReadKey(n.path))`.
- [ ] **Step 3: 검증** — `npm run build` + 목(5174)에서 전체↔앱 전환 시 사이드바 per-app 메뉴 노출/숨김 확인. 커밋: `feat(admin): 헤더 앱 스위처 + 스코프 기반 사이드바`

---

### Task 4: 페이지들 컨텍스트 소비로 전환

**Files (각 파일 먼저 Read 후 편집):**
- Modify: `src/pages/UsersPage.tsx`, `src/pages/FilesPage.tsx`, `src/pages/AuditLogsPage.tsx`, `src/pages/SendPage.tsx`, `src/pages/PaymentsPage.tsx`

**패턴 (페이지마다 반복):**
- 로컬 `const { options, firstSlug } = useAppOptions()` + 로컬 앱 `Select`/`useState(firstSlug)` 제거.
- `const { slug } = useAppContext()` 로 대체. slug 로 기존 per-app 쿼리 호출.
- `slug === null`(전체)일 때: "앱을 선택하세요" 안내(Empty) 렌더 — app-scoped 페이지는 앱 필수.

- [ ] **Step 1: UsersPage 전환** — Read → 로컬 앱 셀렉트 제거, `useAppContext().slug` 사용, null 가드. `npx tsc -b`.
- [ ] **Step 2: FilesPage 전환** — 동일 패턴.
- [ ] **Step 3: AuditLogsPage 전환** — `slugOptions` 로컬 필터 제거, 컨텍스트 slug. (감사로그가 전역이면 스펙 #3 결정대로 per-app; 컨텍스트 slug 사용)
- [ ] **Step 4: SendPage 전환** — 앱 선택 필드 제거(컨텍스트 slug 사용). P2 에서 실배선하므로 여기선 slug 소비까지만.
- [ ] **Step 5: PaymentsPage 확인·전환** — Read 로 현재 앱 선택 방식 확인 후 동일 패턴 적용(useAppOptions 미사용이면 최소 변경).
- [ ] **Step 6: 검증** — `npx tsc -b && npm run build && npm run lint`. 커밋: `refactor(admin): per-app 페이지를 전역 앱 컨텍스트 소비로 전환`

---

### Task 5: Provider 배선 + 전체 컨텍스트 가드

**Files:**
- Modify: `src/App.tsx` (또는 `src/main.tsx`)

- [ ] **Step 1: Provider 배선** — 라우터/레이아웃 상위를 `<AppContextProvider>` 로 감쌈.
- [ ] **Step 2: 전체 컨텍스트 가드** — `slug === null` 상태에서 app-scoped 라우트(`/users` 등) 직접 진입 시 Task 4 의 Empty 안내로 처리(라우트는 유지, 페이지가 안내). 별도 리다이렉트 불필요.
- [ ] **Step 3: 검증** — `npm run build` + 목 워크스루: 전체→앱 선택→사용자 목록 스코프 확인, 앱→전체 시 안내. 커밋: `feat(admin): 앱 컨텍스트 provider 배선`

- [ ] **P1 마감**: `rsync -a --delete src/ ../admin-console-v2/src/` 전파 + v2 `npx tsc -b`. (push 안 함)

---

# P2 — 발송(메시징) 기능 (백엔드+프론트, 첫 도메인 기능)

**목표**: per-app `message_send_history` + 발송/preview/이력 엔드포인트 + 세그먼트 타겟팅 엔진 + SendPage 실배선 + 가드.

## Outline (실행 시 상세 플랜으로 확장)
1. **마이그레이션**: `message_send_history` 테이블 — `tools/new-app/new-app.sh` heredoc 추가(신규 앱) + 기존 앱 per-app 마이그레이션(user_read_history 다음 버전). 컬럼: 스펙 E-2.
2. **세그먼트 엔진**(백엔드, 앱 user/billing 스키마 **실검증** 후): `SegmentResolver` — 전체/프리미엄/무료/활성N일/비활성/신규N일 → 유저 id·연락처 조회. 채널별 유효 수신자 교집합(전화/이메일/토큰 보유).
3. **발송 서비스/컨트롤러**: `POST /api/admin/apps/{slug}/messages`(발송), `/messages/preview`(건수), `GET /messages`(이력). `SmsPort/EmailPort/PushPort` 호출, 부분실패→PARTIAL, `sender_ip` 캡처(reveal 유틸 재사용), `PERM_SEND` 게이팅. `ApiEndpoints.Admin` 경로 상수 + SecurityConfig.
4. **AdminError** 신규 코드(대상0/상한초과/연락처없음) — 기존 다음 번호.
5. **프론트**: SendPage 실배선(preview→건수 확인 모달→발송) + 발송 이력 탭(채널 필터). `api/client.ts` 추가. types.
6. **목(MSW)**: 발송/preview/이력 핸들러 + 픽스처.
7. **테스트**: 발송 IT(세그먼트 대상·채널교집합·PARTIAL·sender_ip·PERM_SEND), ArchUnit.

---

# P3 — 도메인 확장 포인트 (백엔드 SPI + 프론트 레지스트리)

## Outline
1. **백엔드 `DomainPermissionProvider` SPI**: 앱 모듈이 도메인 PERM 목록(key·label·category) 노출 빈 → `PermissionCatalog` 부팅 시 집계. 미등록 앱 방어.
2. **매트릭스 확장**: `AdminRolesService.matrix()` 가 공통 + (앱 컨텍스트)도메인 PERM 섹션 반환. `role_permissions` 저장 무변경.
3. **프론트 `src/domains/registry.ts`**: `DomainModule { slug, navItems, permissions }` 수집 → nav 병합(앱 컨텍스트) + 매트릭스 권한 목록 병합. 코어는 빈 레지스트리.
4. **테스트**: 도메인 PERM 등록→매트릭스 노출(픽스처 앱 모듈), 프론트 병합.

---

# P4 — 파생 레포 도메인 샘플 (레퍼런스)

## Outline
1. 한 앱(샘플)에서 도메인 admin 1개(예: 간단 목록 검수)를 P3 확장포인트로 실제 구현.
2. 백엔드 `/api/admin/apps/{slug}/domain/...` 컨트롤러 + 도메인 PERM + 마이그레이션.
3. 프론트 `src/domains/<slug>/` 모듈 등록.
4. 문서화: 파생 레포에서 도메인 admin 추가하는 레시피.

---

## Self-Review (P1)
- **스펙 커버리지**: 앱 컨텍스트 전환(#A1)=T1·T3·T5, 메뉴 스코핑(#3)=T2·T3·T4, per-app 스코프(#B)=T4. ✅
- **Placeholder**: 없음(P2~P4 는 의도적 outline — 실행 시 각자 상세 플랜).
- **타입 일관성**: `useAppContext()` 반환 `slug: string|null` — T1 정의, T3·T4·T5 소비 일치. `menuItemsForScope(hasApp)` — T2 정의, T3 소비 일치.
