# admin 모듈 설계 — cross-app 운영 콘솔 API

- **날짜**: 2026-07-06
- **대상 레포**: template-spring (주) · template-react-admin (계약 진실화 + factory CLI) · template-flutter (수정 없음)
- **상태**: 구현됨 (feat/admin-module)

---

## 0. 목표와 배경

`template-react-admin`(React 관리자 콘솔)은 9개 `/api/admin/*` 엔드포인트 계약(MSW mock)으로 완성됐지만,
template-spring 에는 **admin API 가 0개**다. 이 설계는:

1. template-spring 에 **admin 모듈**을 신설해 9개 엔드포인트를 실제 core 스키마 데이터로 구현한다.
2. **cross-app(한눈에)**: 관리자 로그인 1번으로 전 앱 데이터를 본다 (솔로 운영자 = 전 앱 소유).
3. React 쪽 계약을 **진실화**한다 — 조회 불가능한 "멋짐용" 필드 제거/정의 확정.
4. 운영에 필요한데 조회 불가능한 지표(DAU/MAU)는 버리지 않고 **템플릿을 고쳐 진짜로 만든다** (활동 추적 신설).

### 전제 사실 (레포 조사로 확정)

- 멀티테넌시: **한 서버 = 전 앱** (schema-per-slug, 단일 Postgres). `SlugContext`(ThreadLocal) → `SchemaRoutingDataSource` 라우팅. slug 없으면 fail-secure 예외 (ADR-037).
- 공유 스키마 없음 — ADR-037 이 core 스키마 폐기. 관리자 전용 테이블은 **원래부터 없었음**.
- JWT 는 앱 종속 (`appSlug` claim). `AppSlugVerificationFilter` 가 타 앱 경로 403.
- `role='admin'` 앱 유저 → `ROLE_ADMIN` (앱 내부용). cross-app 권한 개념 없음.
- 슬러그 열거 프리미티브: `RoutingDataSourceConfig` 가 `Map<String, DataSource>` (`<slug>DataSource` 빈 전부) 주입받는 패턴이 이미 존재.

---

## A. 전체 구조

```
[React admin] ──(superadmin JWT)──> /api/admin/*  ──> admin 모듈 (bootstrap jar 안)
                                                        │
                                                        ├─ admin 스키마: admin_users (운영자 계정)
                                                        └─ 앱 스키마 fan-out: 슬러그 순회 조회 → 메모리 합산
```

- cross-app 조회 = **in-process fan-out** (MSA composition 의 로컬 버전). 모든 앱이 한 JVM·한 DB 에 있어 네트워크 홉·분산 트랜잭션 없음.
- React 계약(types.ts)은 이미 core 테이블과 camelCase 정합 → **백엔드가 기존 계약 shape 에 맞춰 구현** (프론트 계약 변경은 §G 진실화 항목만).

## B. 인증 — admin 스키마 + superadmin role

### 저장소
- **`admin` 스키마 + `admin_users` 테이블** 신설 (기존 users 패턴 축소판):
  `id, email(unique), password_hash, display_name, created_at, updated_at`
- ADR-037 역행 아님 — 폐기된 건 "앱 사용자 데이터 공유"고, 이건 **공장 운영자 계정 저장소** (앱 데이터 0).
- 라우팅 안 타는 **고정 DataSource** 빈으로 바인딩 (AbstractAppDataSourceConfig 패턴 재사용, 라우팅 제외).
- 프로비저닝: `infra/scripts/init-admin-schema.sql` (CREATE SCHEMA admin + 전용 role + grant) + seed 스크립트(bcrypt 해시 1계정).

### 토큰
- `POST /api/admin/auth/login` → JWT 발급, **`role=superadmin`** claim.
- **ROLE_SUPERADMIN 분리 이유**: 앱 유저 중 `role='admin'`(→ROLE_ADMIN)이 존재 — `/api/admin/**` 를 ROLE_ADMIN 으로 걸면 앱 관리자가 전체 콘솔 침입 가능. 분리로 양방향 격리:
  - `/api/admin/**` → `hasRole('SUPERADMIN')` 만 허용
  - superadmin 토큰으로 `/api/apps/{slug}/**` 접근 → 기존 `AppSlugVerificationFilter` 403 유지
- JWT 의 `appSlug` claim 은 `admin` 고정값 (AuthenticatedUser 가 non-blank 요구).
- 응답 shape 은 React 기대 그대로: `{ accessToken, admin: { id, email, displayName } }`.
- 공개 경로 추가: `/api/admin/auth/login`, `/api/admin/health` (프로브용) — `SecurityConfig` PUBLIC_PATTERNS.

## C. 모듈 배치 + fan-out

### 모듈
- **새 최상위 모듈 `admin/`** (`:admin`) — core-X 는 "앱이 소비하는 능력", admin 은 "공장 운영 콘솔"이라 성격이 달라 core 밑에 넣지 않는다.
- 내부 구성은 repo 컨벤션 그대로: `controller / service / repository / entity / config`
- `settings.gradle` 등록 + `bootstrap/build.gradle` 의존 추가. api/impl 분리는 하지 않는다 (admin API 의 소비자가 admin 자신뿐 — YAGNI).

### fan-out 메커니즘
- 슬러그 열거: `Map<String, DataSource>` (`<slug>DataSource` 빈 전부) 주입 — RoutingDataSourceConfig 와 동일 패턴. `admin` DataSource 는 제외.
- 슬러그별 조회: `SlugContext.set(slug)` try/finally 로 감싸 기존 라우팅 인프라 재사용.
- 집계성 쿼리(대시보드 합산·빌링·시계열)는 **JdbcTemplate**(슬러그별 DataSource 직접), 단건/목록(users·devices·subscriptions·payments·audit)은 **기존 core 엔티티/리포지토리 재사용**.

### 구현 반영 (Task 12 — 스펙 대비 의도적 변경)
플랜 문서(`docs/superpowers/plans/2026-07-06-admin-module.md`)의 헤더에 명시된 대로, 구현은 아래 3건을 스펙과 다르게 진행했다:

1. **모듈 위치**: 위 "최상위 `admin/`" 대신 **`:core:core-admin-impl`** 로 배치했다. `factory.core-impl-module` build-logic 컨벤션 플러그인과 ArchUnit 규칙을 그대로 재사용하기 위함 — 최상위 모듈로 만들면 빌드 설정(spotless·jacoco·pitest 등)을 손수 복제해야 한다.
2. **데이터 접근**: 위 "단건/목록은 기존 core 엔티티/리포지토리 재사용" 대신 **전부 JdbcTemplate** 로 구현했다. impl→impl 의존 금지 규칙(`DependencyRules`)상 다른 core-*-impl 의 리포지토리를 재사용할 수 없고, 읽기 전용 콘솔이라 JDBC 직접 조회가 더 단순하다.
3. **DTO**: 응답 DTO 는 모두 `dto` 패키지의 **최상위 record** + `Response` 접미사로 통일했다 (ArchUnit `r18`=`DTOS_MUST_BE_RECORDS`, `r19`=`DTO_NAMING_SUFFIX`). nested class/record 는 사용하지 않는다.

## D. 엔드포인트 ↔ 데이터 매핑 (9개)

| # | 엔드포인트 | 데이터 소스 |
|---|---|---|
| 1 | `POST /api/admin/auth/login` | `admin.admin_users` (bcrypt 검증 → superadmin JWT) |
| 2 | `GET /api/admin/apps` | 슬러그 열거 + 각 스키마 `users` count·`subscriptions` ACTIVE count |
| 3 | `GET /api/admin/dashboard/metrics?window=` (기본 30d) | fan-out 합산: users·신규(created_at)·DAU/MAU(§H)·매출/환불(payment_history)·활성구독·실패24h(audit result='FAILURE') — totals + perSlug |
| 4 | `GET /api/admin/apps/{slug}/metrics` | 단일 스키마: 3번과 동일 지표의 앱 버전 |
| 5 | `GET /api/admin/apps/{slug}/users?query&page&size` | `users` (email·display_name·nickname ILIKE, 페이지네이션) |
| 6 | `GET /api/admin/apps/{slug}/users/{id}` | `users` + `devices` + `subscriptions` + `payment_history` 최근 10건 |
| 7 | `GET /api/admin/apps/{slug}/billing?from&to` | `payment_history` 집계 (gross/refunded/net·채널별·일별 시리즈) + `subscriptions` ACTIVE |
| 8 | `GET /api/admin/audit-logs?slug&...&page&size` | slug 지정 → 단일 스키마 / 미지정 → fan-out + `occurred_at` 병합 정렬 + 메모리 페이징 |
| 9 | `GET /api/admin/analytics/{metric}?from&to&interval` | `signups`=users.created_at 일별 · `revenue`=payment_history.paid_at 일별 · `dau`=user_activity_days (§H) |

### 구현 반영 — gross/revenue 시맨틱 정정 (Task 12)
`payment_history.status` 는 `PaymentHistory.markRefunded()` 가 환불 시 `PAID` → `REFUNDED` 로 **덮어쓴다** (별도 플래그가 아니라 상태 자체가 뒤집힘). 따라서 gross(수금총액)를 `status='PAID'` 로만 집계하면 환불된 결제가 gross 에서도 빠져버리고, 이어서 `gross - refunded` 로 다시 한 번 차감돼 **이중차감** 되는 버그가 생긴다.

올바른 시맨틱: **gross = `status IN ('PAID', 'REFUNDED')` 인 건의 합** (한 번이라도 수금된 금액의 총합 — 환불 여부와 무관), `net = gross - refunded`. 3·4·7·9번 엔드포인트(대시보드/앱 metrics/billing/revenue 시계열)의 매출 집계 쿼리 전부 이 시맨틱을 따른다. 구현: `AdminMetricsService`/`AdminDashboardService`/`AdminAnalyticsService`.

### 알려진 한계 (정직하게 명시)
- **cross-app 감사로그 페이징**: 병합 후 메모리 페이징 — 솔로 규모(앱 수 ~10, 로그 수만 건)에선 문제없음. 커지면 slug 필터 유도 또는 커서 방식으로 개선.
- **DAU 과거 데이터**: §H 추적 시작일 이전은 존재하지 않음. 차트는 데이터 있는 구간만.

## E. React 쪽 (template-react-admin)

1. **factory CLI 신설** (flutter/spring 과 동일 UX):
   - `./factory install` — symlink 등록
   - `<repo> local start` — 백엔드 프로브 후 기동
   - `<repo> test` — build + (옵션) 백엔드 ping
2. **start 시 백엔드 프로브**: `GET /api/admin/health` curl →
   - 성공: `VITE_USE_MOCK=false` 로 실서버 모드 기동
   - 실패: "백엔드 미연결 → mock 데이터로 실행합니다" 안내 후 mock 기동 (헤더의 기존 MOCK 배지가 상태 표시)
3. **`.env.example` 추가**: `VITE_API_BASE`, `VITE_USE_MOCK` 문서화.
4. §G 진실화 반영 (mock fixtures = 진실 계약 레퍼런스).

## F. 테스트

- 엔드포인트별 contract test — repo 기존 contract-test 인프라(테스트 스키마 마이그레이션) 재사용.
- fan-out 검증: 테스트 슬러그 2개에 데이터 seed → dashboard 합산 일치 확인.
- 권한 경계: superadmin 토큰 ↔ 앱 admin 토큰 상호 403 (ROLE_SUPERADMIN/ROLE_ADMIN 분리 검증).
- 활동 추적: 인증 요청 → user_activity_days upsert + 같은 날 중복 1행 검증.

## G. 데이터 진실화 (전 필드 감사 결과)

### ✅ 이미 조회 가능 — 변경 없음
사용자 목록/상세 전 필드(`users`·`devices`·`subscriptions`·`payment_history`), 감사로그 전 필드(`audit_logs`),
빌링 전 필드, 대시보드의 users·신규·매출·환불·활성구독, 분석의 signups·revenue 시계열.

### 판정 변경 필드
| 필드 | 판정 | 처리 |
|---|---|---|
| DAU / MAU | 🔧 **진짜로 만든다** | §H 활동 추적 신설 — 라벨·계약 유지 |
| DAU 시계열 차트 | 🔧 같이 진짜가 됨 | 추적 시작일부터 축적. 차트에 "데이터 시작일" 표기 |
| failures24h | ✅ 정의 확정 | `audit_logs result='FAILURE'` 24h count |

### React 수정 (진실화)
- mock fixtures 를 실 계약 구조로 정비 (DAU 시계열은 "시작일 이후만 존재" 형태 반영).
- 분석/대시보드 화면은 라벨 변경 없음 (DAU/MAU 가 진짜가 되므로).

## H. 활동 추적 신설 (template-spring) — DAU/MAU 의 원천

- **테이블**: `user_activity_days (user_id BIGINT, activity_date DATE, PRIMARY KEY(user_id, activity_date))` — 앱 스키마별 (per-slug).
- **기록**: 인증된 API 요청 인터셉터가 `(user_id, 오늘)` upsert (`ON CONFLICT DO NOTHING`). 유저×날짜 인메모리 캐시(예: Caffeine)로 같은 날 중복 DB 호출 제거 — 부하 사실상 0.
  - **구현 반영 (Task 12)**: "오늘" 은 애플리케이션 서버의 `Instant.now()`/로컬 날짜가 아니라 **DB 의 `CURRENT_DATE`** 로 upsert 쿼리 안에서 결정한다 (앱 서버와 DB 서버의 시계·타임존이 어긋나도 DAU 집계 쿼리(`WHERE activity_date = CURRENT_DATE`)와 기록 시점의 날짜 기준이 항상 일치하도록 — 시계 통일).
- **집계**: DAU = 날짜별 distinct user / MAU = 최근 30일 distinct → 시계열도 사실 기록 기반.
- **마이그레이션**: new-app.sh 세트에 추가 (번호는 구현 시 new-app.sh 의 다음 순번). 신규 앱 자동, 기존 앱은 마이그레이션 1개 적용.
- **template-flutter 수정 불필요**: 앱 시작 시 device 등록/토큰 refresh 가 인증 API 를 치므로 그 요청이 활동 신호. (포그라운드 복귀 수준 정밀도는 v2 — flutter kit ping.)

## I-2. v1.5 확장 (2026-07-07 — §I 의 일부 항목 조기 실행, 사후 기록)

사용자 결정("지금 추가하고 이후에 도그푸딩")으로 §H·§I 의 v2 후보 중 4건을 앞당겨 구현했다. 플랜모드 생략 대신 결정사항을 여기 정식 기록한다.

### 운영 신호 — `GET /api/admin/apps/{slug}/ops` (AppOpsSignalsResponse)
| 필드 | 정의 |
|---|---|
| renewalAttempts7d / renewalFailures7d | `subscription_renewals` attempted_at ≥ now−7d. 실패 = `status <> 'SUCCESS'` (FAILED+ABANDONED — 이탈 조기신호) |
| webhookPending | `payment_webhook_events` processed_at IS NULL AND process_error IS NULL (웹훅 밀림) |
| webhookFailed | process_error IS NOT NULL |
| retentionD1 / retentionD7 | 코호트: 가입일 D1=[−15,−2]·D7=[−21,−8], 생존 = `user_activity_days` 에 가입일+N 행 존재. %(소수1), 코호트 0명이면 null |

React: 분석 페이지 "운영 신호" 카드 4개 (실패>0 → semantic.error, pending>0 → semantic.warning, null → "데이터 수집 중").

### 활동 ping — DAU 를 설계로 보장
- 백엔드: `POST /api/apps/{slug}/users/me/activity` (인증 필수, 204 — 활동 기록은 기존 필터가 수행)
- Flutter(auth_kit 확장): 부팅(인증 복원 후)·포그라운드 복귀 시 **fire-and-forget** ping. 정책: 로그인 상태에서만 / **6시간 스로틀**(PrefsStorage) / 실패 조용히 무시·**성공 시에만** 타임스탬프 갱신(장애 구간 신호 유실 방지) / 부팅을 blocking 하지 않음
- 계약 동기화: flutter contract_test clientPaths + 스냅샷 + docs/api-contract/user-profile.md 반영 완료

## I. 범위 밖 (v2+)

- **광고 수익 (AdMob) 통합** (2026-07-07 사용자 요청, 2026-07-08 차트 요구 추가): AdMob Reporting API OAuth 연동 + 일별 수익 pull 스케줄러 + `ad_revenue_days` 테이블 + 대시보드 "광고 수익" 카드/차트. **차트 통합 요구**: 대시보드 "전체 매출 추이"에 광고수익 stacked 시리즈, "앱별 매출 점유" 도넛에 결제+광고 통합 옵션, 앱별 추이 Drawer 에도 광고 시리즈. 모든 앱에 AdMob 탑재 전제. 사용자 개입 필요(AdMob API 활성화·OAuth 동의). 결제 매출과 별도 축 기본, 통합 보기는 토글.

- 발송(푸시/이메일)·역할권한·설정 화면의 백엔드 — 콘솔 스켈레톤만 존재, API 는 파생/후속.
- 관리자 다계정·TOTP — admin_users 구조상 추가 용이, v1 은 1계정.
- cross-app 감사로그 커서 페이징 — 규모 커지면.
- DAU 정밀화(포그라운드 ping) — flutter kit v2.

---

## 구현 순서 (플랜 문서에서 상세화)

1. template-spring: admin 스키마/계정 + 로그인 + health (React 프로브 대상)
2. template-spring: 활동 추적 (테이블+인터셉터) — 데이터가 쌓이기 시작해야 하므로 이른 순서
3. template-spring: 조회 엔드포인트 2·4·5·6·7 (단일 스키마 — 쉬운 것부터)
4. template-spring: fan-out 엔드포인트 3·8·9
5. template-react-admin: factory CLI + 프로브/mock 폴백 + .env.example + fixtures 진실화
6. 통합 검증: 실서버 연결 상태에서 전 화면 Chrome 검증
