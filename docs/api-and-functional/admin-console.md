# 운영 콘솔 API — admin-console

> **유형**: Explanation · **독자**: Level 2 · **읽는 시간**: ~15분

**설계 근거**: [`ADR-039 (admin 모듈 — superadmin + admin 스키마 + in-process fan-out)`](../philosophy/adr-039-admin-module.md) · [`ADR-005 (단일 Postgres + 앱당 schema)`](../philosophy/adr-005-db-schema-isolation.md) · [`ADR-012 (앱별 독립 유저 모델)`](../philosophy/adr-012-per-app-user-model.md) · [`ADR-018 (SchemaRoutingDataSource)`](../philosophy/adr-018-schema-routing-datasource.md) · [`ADR-037 (core schema 폐기)`](../philosophy/adr-037-core-schema-deprecation.md) · [`ADR-027 (admin role 권한 분리)`](../philosophy/adr-027-admin-role-authorization.md)

이 문서는 `template-react-admin`(React 운영 콘솔)이 소비하는 `/api/admin/*` 백엔드 계약을 정리합니다. 솔로 운영자가 자기가 만든 여러 앱(슬러그)의 유저·매출·실패율·활동 지표를 **한 번 로그인으로 전부** 보기 위한 cross-app 콘솔이에요. 앱 사용자가 쓰는 `/api/apps/{slug}/*` 와는 완전히 분리된 인증·권한 체계를 씁니다.

---

## 1. 개요

`core-admin-impl` 모듈이 이 API 를 제공합니다. 앱 데이터를 저장하는 곳은 아니고, 이미 존재하는 앱별 schema 를 **fan-out** 으로 읽기만 하는 조회 전용 콘솔이에요. 운영자 계정만 담는 `admin` schema(`admin_users` 테이블 1개)가 유일한 예외적인 신규 저장소입니다.

```
[React admin] ──(superadmin JWT)──> /api/admin/*  ──> core-admin-impl (bootstrap jar 안)
                                                        │
                                                        ├─ admin 스키마: admin_users (운영자 계정)
                                                        └─ 앱 스키마 fan-out: 슬러그 순회 조회 → 메모리 합산/병합
```

- **cross-app 조회 = in-process fan-out** — MSA 라면 필요했을 서비스 간 호출·분산 트랜잭션이 없습니다. 모든 앱이 한 JVM·한 Postgres 인스턴스에 있어서, 슬러그별 `JdbcTemplate` 을 순회하며 메모리에서 합산·병합할 뿐이에요.
- **조회는 JPA 미사용** — `core-admin-impl` 은 다른 `core-*-impl` 의 리포지토리를 재사용할 수 없다는 impl→impl 의존 금지 규칙 때문에, 모든 조회를 `JdbcTemplate` 직접 쿼리로 구현합니다.
- **write 는 포트 재사용** — 결제 환불(§4-11)과 파일 검역/복원/삭제(§4-14~4-16, v1.8)가 write 액션이에요. `core-admin-impl` 이 자체 JPA를 갖는 게 아니라, `core-billing-api`/`core-payment-api`/`core-storage-api` 의 **포트 인터페이스**(`PaymentPort`/`BillingPort`/`StoragePort`)만 의존해서 앱쪽 컨트롤러가 쓰는 것과 **같은 포트 메서드**를 그대로 호출해요(impl→impl 의존은 여전히 금지 — api 포트 인터페이스만 compileOnly 의존). 파일 관리는 슬러그별 schema 가 아니라 슬러그별 **bucket**(`<slug>-uploads`)을 다루기 때문에 `JdbcTemplate` 을 전혀 쓰지 않아요 — `AdminSlugRegistry` 는 슬러그 존재 검증 용도로만 씁니다.
- **응답 포맷은 템플릿 표준을 그대로 따름** — `ApiResponse<T>`(`{ data, error }`) 래퍼와 목록 조회의 `PageResponse<T>` 는 [`API Response Format`](./api/api-response.md) 과 동일합니다.

---

## 2. 인증 흐름 — env 시더 → superadmin JWT → Bearer

### 2-1. 최초 계정 시딩

부팅 시 `admin_users` 테이블이 비어 있고 `ADMIN_EMAIL`/`ADMIN_PASSWORD` env 가 모두 채워져 있으면, `AdminAccountSeeder` 가 1계정을 시드합니다(비어 있으면 조용히 no-op). 표시 이름은 고정값 `"operator"` 예요. 이미 계정이 1개 이상 있으면 다시 시드하지 않습니다.

### 2-2. 로그인 → superadmin JWT

```mermaid
sequenceDiagram
    participant React as template-react-admin
    participant API as AdminAuthController
    participant Svc as AdminAuthService
    participant DB as admin.admin_users

    React->>API: POST /api/admin/auth/login { email, password }
    API->>Svc: login(email, password)
    Svc->>DB: findByEmail(email)
    DB-->>Svc: AdminAccount(passwordHash)
    Svc->>Svc: PasswordHasher.verify(password, passwordHash)
    Svc->>Svc: JwtService.issueAdminAccessToken(id, email, appSlug="admin", role="superadmin")
    Svc-->>API: AdminLoginResponse { accessToken, admin }
    API-->>React: 200 { data: AdminLoginResponse }

    Note over React,API: 이후 모든 /api/admin/* 요청은 Authorization: Bearer <accessToken>
```

발급되는 JWT 의 `appSlug` claim 은 실제 앱 슬러그가 아니라 **고정값 `"admin"`** 이고, `role` claim 은 `"superadmin"` 입니다. 이 두 값이 이후 모든 권한 검사의 기준이 돼요.

콘솔 세션은 앱 유저 access token(`app.jwt.access-token-ttl`, 기본 15분)과 별도로 `app.jwt.admin-access-token-ttl`(기본 `PT12H`, 12시간)을 TTL 로 씁니다. `JwtService.issueAccessToken` 은 앱 유저 전용 TTL 만 계속 쓰고, `issueAdminAccessToken` 은 콘솔 전용 TTL 을 써서 — 운영자가 앱 유저와 같은 15분마다 재로그인하지 않게 분리했어요.

### 2-3. 권한 검사 — 양방향 격리

| 시나리오 | 결과 |
|---|---|
| superadmin JWT 로 `/api/admin/**` 호출 | 200 — 정상 처리 |
| 앱 유저(`ROLE_USER`/`ROLE_ADMIN`) JWT 로 `/api/admin/**` 호출 | 403 (인증은 됐으나 권한 부족 — `JsonAccessDeniedHandler`) |
| superadmin JWT 로 `/api/apps/{slug}/**` 호출 | 403 — `AppSlugVerificationFilter` 가 JWT 의 `appSlug="admin"` 과 path 의 실제 슬러그 불일치를 차단 |
| JWT 없이 `/api/admin/**`(로그인·헬스 제외) 호출 | 401 CMN_004 |

`ROLE_SUPERADMIN` 을 `ROLE_ADMIN`(앱 내부 관리자, [`ADR-027`](../philosophy/adr-027-admin-role-authorization.md))과 완전히 분리한 이유는 앱 admin 이 전체 콘솔에 침입하는 걸 막기 위해서예요. 자세한 배경은 [`ADR-039`](../philosophy/adr-039-admin-module.md) §결정-1 을 참고하세요.

### 2-4. 헬스 프로브

`GET /api/admin/health` 는 인증 없이 호출 가능한 유일한 조회 엔드포인트예요(`{ "status": "UP" }`). `template-react-admin` 의 factory CLI 가 기동 시 이 엔드포인트로 백엔드 연결을 확인하고, 실패하면 mock 데이터 모드로 자동 폴백합니다.

---

## 3. 엔드포인트 카탈로그

14개 조회 엔드포인트(#1~12, #14~15) + 4개 write 엔드포인트(#13 환불, #16~18 파일 검역/복원/삭제)입니다. 활동 ping 만 소유가 다른 도메인(user)이라 별도로 표시했어요.

| # | 메서드 · 경로 | 인증 | 데이터 소스 |
|---|---|---|---|
| 1 | `POST /api/admin/auth/login` | public | `admin.admin_users` |
| 2 | `GET /api/admin/health` | public | — (liveness) |
| 3 | `GET /api/admin/apps` | superadmin | 슬러그 fan-out — 앱별 `users`/`subscriptions` count |
| 4 | `GET /api/admin/dashboard/metrics?window=` | superadmin | 슬러그 fan-out — 전체 합산 (기본 `window=30d`, `7d` 도 가능) |
| 5 | `GET /api/admin/apps/{slug}/metrics` | superadmin | 단일 슬러그 — #4 와 동일 지표의 앱 단위 스냅샷 |
| 6 | `GET /api/admin/apps/{slug}/users?query&page&size` | superadmin | 단일 슬러그 — `users` 검색 + 페이지네이션 |
| 7 | `GET /api/admin/apps/{slug}/users/{userId}` | superadmin | 단일 슬러그 — `users`+`devices`+`subscriptions`+`payment_history`(최근 10건) |
| 8 | `GET /api/admin/apps/{slug}/billing?from&to` | superadmin | 단일 슬러그 — `payment_history` 집계 |
| 9 | `GET /api/admin/audit-logs?slug&...&page&size` | superadmin | `slug` 지정 시 단일 스키마, 미지정 시 fan-out 병합 |
| 10 | `GET /api/admin/analytics/{metric}?slug&from&to` | superadmin | `metric∈{dau,signups,revenue}` — `slug` 생략 시 전 슬러그 fan-out sum-merge (v1.7), 지정 시 단일 슬러그 일별 시계열 |
| 11 | `GET /api/admin/apps/{slug}/ops` | superadmin | 단일 슬러그 — 갱신 실패율·webhook 처리·리텐션 (v1.5) |
| 12 | `GET /api/admin/apps/{slug}/payments?query&channel&status&type&from&to&page&size` | superadmin | 단일 슬러그 — `payment_history`+`users` 조인 목록 (v1.5) |
| 13 | `POST /api/admin/apps/{slug}/payments/{paymentId}/refund` | superadmin | 단일 슬러그 — PG 환불(write). `PaymentPort`/`BillingPort` 재사용 |
| 14 | `GET /api/admin/dashboard/top-customers?window&size` | superadmin | 슬러그 fan-out — 결제 TOP N 고객 병합 후 금액 내림차순 재정렬 (v1.7) |
| 15 | `GET /api/admin/apps/{slug}/files?prefix&max` | superadmin | 단일 슬러그 — `<slug>-uploads` bucket 목록 (v1.8) |
| 16 | `POST /api/admin/apps/{slug}/files/quarantine?key` | superadmin | 단일 슬러그 — bucket write(검역, write). `StoragePort` 재사용 (v1.8) |
| 17 | `POST /api/admin/apps/{slug}/files/restore?key` | superadmin | 단일 슬러그 — bucket write(복원, write) (v1.8) |
| 18 | `DELETE /api/admin/apps/{slug}/files?key` | superadmin | 단일 슬러그 — bucket write(불가역 삭제) (v1.8) |
| — | `POST /api/apps/{slug}/users/me/activity` | 앱 유저 인증 | **user 도메인 소유** — DAU/MAU 원천 활동 ping (아래 §6 참고) |

---

## 4. 엔드포인트 상세

### 4-1. `GET /api/admin/apps` — 앱 목록

슬러그별 유저 수·활성 구독 수 요약. `AdminSlugRegistry.slugs()` 가 열거한 모든 앱을 순회합니다.

```json
{
  "data": [
    { "slug": "gymlog", "userCount": 128, "activeSubscriptions": 34 },
    { "slug": "sumtally", "userCount": 512, "activeSubscriptions": 201 }
  ],
  "error": null
}
```

### 4-2. `GET /api/admin/dashboard/metrics` — 대시보드 fan-out 합산

`window` 는 `"7d"` 또는 `"30d"`(기본값, 그 외 값은 `30d` 로 취급). 전 슬러그를 순회해 슬러그별 지표(`perSlug`)를 만들고, 그 합이 `totals` 입니다.

```json
{
  "data": {
    "generatedAt": "2026-07-07T09:00:00Z",
    "window": "30d",
    "totals": {
      "users": 640, "newUsers": 45, "dau": 88, "mau": 310,
      "revenue": 8000000, "refunded": 120000,
      "activeSubscriptions": 235, "failures24h": 2,
      "renewalFailures7d": 6, "webhookPending": 1, "webhookFailed": 3
    },
    "perSlug": [
      { "slug": "gymlog", "users": 128, "newUsers": 10, "dau": 20, "mau": 70,
        "revenue": 2000000, "refunded": 0, "activeSubscriptions": 34, "failures24h": 0 }
    ]
  },
  "error": null
}
```

`revenue`/`refunded` 는 §5 의 gross 시맨틱을 따릅니다. `failures24h` 는 `audit_logs` 의 `result='FAILURE'` 이고 `occurred_at` 이 최근 24시간 이내인 건수예요.

`renewalFailures7d`/`webhookPending`/`webhookFailed` 는 §4-9(운영 신호)와 **동일 SQL 시맨틱**을 전 슬러그로 합산한 치명신호 필드예요(v1.7, additive). `perSlug`(`SlugMetricsResponse`)에는 반영하지 않고 `totals` 에만 추가했어요 — 앱별 세부 신호는 §4-9 `GET /api/admin/apps/{slug}/ops` 로 확인하세요.

### 4-3. `GET /api/admin/apps/{slug}/metrics` — 앱 단일 지표

```json
{
  "data": {
    "slug": "gymlog", "generatedAt": "2026-07-07T09:00:00Z",
    "users": 128, "newUsers7d": 6, "premiumUsers": 34,
    "dau": 20, "mau": 70, "revenue30d": 2000000, "activeSubscriptions": 34
  },
  "error": null
}
```

대시보드가 `newUsers`(window 기준)를 쓰는 것과 달리, 이 엔드포인트는 `newUsers7d`(고정 7일)·`revenue30d`(고정 30일)로 필드명 자체에 기간이 붙어 있어요 — window 파라미터가 없습니다.

### 4-4. `GET /api/admin/apps/{slug}/users` — 사용자 목록

`query` 는 `email`/`display_name`/`nickname` 에 대한 `ILIKE` 검색(생략 가능). `page`(기본 0)·`size`(기본 20)는 내부 콘솔 전용이라 400 대신 **clamp** 로 방어합니다 — `page<0→0`, `size` 는 `[1,100]` 범위로 보정.

```json
{
  "data": {
    "content": [
      { "id": 1, "email": "user@example.com", "displayName": "홍길동", "nickname": "gil",
        "role": "user", "isPremium": true, "emailVerified": true,
        "createdAt": "2026-01-15T03:20:00Z", "deletedAt": null }
    ],
    "page": 0, "size": 20, "totalElements": 128, "totalPages": 7
  },
  "error": null
}
```

### 4-5. `GET /api/admin/apps/{slug}/users/{userId}` — 사용자 상세

`users` 1건 + `devices` 전체 + `subscriptions` 전체(최신순) + `payment_history` 최근 10건을 한 번에 묶어 줍니다. 존재하지 않는 `userId` 는 404 `ADMIN_005`.

```json
{
  "data": {
    "user": { "id": 1, "email": "user@example.com", "displayName": "홍길동", "nickname": "gil",
              "role": "user", "isPremium": true, "emailVerified": true,
              "createdAt": "2026-01-15T03:20:00Z", "deletedAt": null, "updatedAt": "2026-06-01T00:00:00Z" },
    "devices": [
      { "id": 9, "platform": "ANDROID", "deviceName": "Pixel 8", "lastSeenAt": "2026-07-06T22:00:00Z", "createdAt": "2026-01-15T03:21:00Z" }
    ],
    "subscriptions": [
      { "id": 3, "planId": 2, "status": "ACTIVE", "startedAt": "2026-06-01T00:00:00Z",
        "expiresAt": "2026-07-01T00:00:00Z", "cancelledAt": null, "cancelReason": null }
    ],
    "recentPayments": [
      { "id": 11, "channel": "PG", "amount": 9900, "currency": "KRW", "status": "PAID",
        "paidAt": "2026-06-01T00:00:00Z", "refundedAt": null }
    ]
  },
  "error": null
}
```

### 4-6. `GET /api/admin/apps/{slug}/billing` — 빌링 요약

`from`/`to` 는 ISO-8601 인스턴트(생략 시 각각 "30일 전"/"지금"). 형식이 잘못되면 400 `ADMIN_004`.

```json
{
  "data": {
    "slug": "gymlog", "from": "2026-06-07T00:00:00Z", "to": "2026-07-07T00:00:00Z",
    "gross": 5000000, "refunded": 100000, "net": 4900000,
    "byChannel": [
      { "channel": "PG", "amount": 3000000, "count": 15 },
      { "channel": "IAP", "amount": 2000000, "count": 8 }
    ],
    "activeSubscriptions": 34,
    "dailySeries": [
      { "date": "2026-06-07", "amount": 150000 }
    ]
  },
  "error": null
}
```

`gross`/`net` 시맨틱은 §5 를 참고하세요 — **환불 여부와 무관하게 한 번이라도 결제된 금액의 총합**입니다.

### 4-7. `GET /api/admin/audit-logs` — 감사로그 검색

`slug` 를 지정하면 그 스키마만, 생략하면 **전 슬러그를 fan-out 후 `occurred_at` 기준 병합 정렬** 합니다. `actorEmail`/`action` 은 `ILIKE`, `result` 는 정확히 일치(`SUCCESS`/`FAILURE`), `from`/`to` 는 ISO-8601. `page`/`size` 는 §4-4 와 동일한 clamp 규칙.

```json
{
  "data": {
    "content": [
      { "id": 77, "actorUserId": 3, "actorEmail": "admin@gymlog.local", "action": "PAYMENT_REFUND",
        "resourceType": "PaymentHistory", "resourceId": "11", "slug": "gymlog", "result": "SUCCESS",
        "ipAddress": "127.0.0.1", "occurredAt": "2026-07-06T10:00:00Z" }
    ],
    "page": 0, "size": 20, "totalElements": 3, "totalPages": 1
  },
  "error": null
}
```

> **알려진 한계** — `slug` 미지정(전 슬러그) 조회는 각 슬러그에서 `(page+1)*size` 만큼 가져온 뒤 메모리에서 병합·정렬·페이징합니다. 솔로 규모(앱 수 ~10, 로그 수만 건)에선 문제없지만 커지면 커서 방식 개선이 필요해요([`ADR-039`](../philosophy/adr-039-admin-module.md) 후속 참고).

### 4-8. `GET /api/admin/analytics/{metric}` — 분석 시계열

`metric` 은 경로변수, `slug` 는 **선택** 쿼리 파라미터예요(v1.7 — 이전엔 필수였습니다). 지원 metric 은 3종류. 지원하지 않는 값은 400 `ADMIN_002`.

| metric | 데이터 소스 | 의미 |
|---|---|---|
| `dau` | `user_activity_days` | 일별 distinct 활동 유저 수 |
| `signups` | `users.created_at` | 일별 신규 가입자 수 |
| `revenue` | `payment_history` | 일별 매출(§5 gross 시맨틱) |

```json
{
  "data": {
    "metric": "dau", "interval": "day",
    "points": [
      { "ts": "2026-07-01", "value": 18 },
      { "ts": "2026-07-02", "value": 22 }
    ]
  },
  "error": null
}
```

`dau` 시계열은 `user_activity_days` 추적 시작일 이전 구간에는 데이터가 없습니다 — 차트는 데이터가 쌓인 구간만 표시하세요.

**`slug` 생략 시 — 전 슬러그 합산 모드(v1.7)**: `slug` 를 지정하면 그 앱만(기존 동작), 생략(또는 blank)하면 `AdminSlugRegistry.slugs()` 전체를 순회해 동일 쿼리를 돌리고 **일자(`ts`)별로 값을 sum-merge** 합니다 — 한쪽 슬러그에만 있는 날짜도 결과에 그대로 포함돼요(그 날짜의 값 = 그 슬러그 값 그대로). 응답 shape 은 단일 슬러그 조회와 동일합니다.

### 4-9. `GET /api/admin/apps/{slug}/ops` — 운영 신호 (v1.5)

구독 갱신 실패율·결제 웹훅 처리 상태·리텐션 3종을 한 번에 반환합니다. 리텐션 정의는 §5-2 참고.

```json
{
  "data": {
    "slug": "gymlog",
    "renewalAttempts7d": 40, "renewalFailures7d": 3,
    "webhookPending": 0, "webhookFailed": 1,
    "retentionD1": 50.0, "retentionD7": 33.3
  },
  "error": null
}
```

`renewalFailures7d` 는 `subscription_renewals.status <> 'SUCCESS'`(즉 `FAILED` + `ABANDONED`) 를 모두 셉니다 — 재시도 대기 중인 것도, 최종 실패한 것도 운영자가 봐야 할 신호이기 때문이에요. `retentionD1`/`retentionD7` 은 코호트 크기가 0이면 `null` 입니다(React 는 "데이터 수집 중"으로 표시).

### 4-10. `GET /api/admin/apps/{slug}/payments` — 결제 내역 목록 (v1.5)

`payment_history` 를 `users` 와 조인해 이메일까지 함께 보여주는 목록 조회예요. `query` 는 `users.email` 에 대한 `ILIKE` 부분일치, `channel`/`status`/`type` 은 정확 일치, `from`/`to` 는 `paid_at` 기준 ISO-8601 범위(형식이 잘못되면 400 `ADMIN_004`). `page`/`size` 는 §4-4 와 동일한 clamp 규칙.

`paymentType` 은 `payment_history.payment_type` 컬럼(기록 시점 확정)이에요 — 구독 활성화/갱신이 이 결제 건을 `payment_record_id` 로 링크하는 순간 같은 트랜잭션에서 `"SUBSCRIPTION"` 으로 확정되고, 그 외에는 기본값 `"ONE_TIME"`(단건 결제)이에요. `type` 쿼리 파라미터로 이 컬럼 값을 그대로 필터링할 수 있어요.

`refundedAmount` 는 누적 환불액(`payment_history.refunded_amount`)이에요 — 부분환불(§4-11) 추적용이고, `amount - refundedAmount` 가 남은 환불 가능액이에요. `periodStart`/`periodEnd` 는 이 결제에 링크된 구독의 현재 기간(`subscriptions.started_at`/`expires_at`)을 `LEFT JOIN LATERAL` 로 붙인 값이에요 — 부분환불 모달의 **일할계산**(잔여기간 비례) 근거로 쓰고, 비구독·미링크 결제는 `null` 이에요.

```json
{
  "data": {
    "content": [
      { "id": 11, "userId": 1, "userEmail": "user@example.com", "channel": "PG",
        "amount": 9900, "refundedAmount": 0, "currency": "KRW", "status": "PAID",
        "paidAt": "2026-06-01T00:00:00Z", "refundedAt": null,
        "externalId": "imp_123456789", "paymentType": "SUBSCRIPTION",
        "periodStart": "2026-06-01T00:00:00Z", "periodEnd": "2026-07-01T00:00:00Z" }
    ],
    "page": 0, "size": 20, "totalElements": 1, "totalPages": 1
  },
  "error": null
}
```

### 4-11. `POST /api/admin/apps/{slug}/payments/{paymentId}/refund` — PG 환불 (write, v1.6 · 부분환불 v1.9)

이 콘솔의 **첫 write 액션**이에요. 요청 본문은 `{ "amount": <원, 선택>, "reason": <필수> }` — `amount` 를 생략(또는 `null`)하면 **남은 잔액 전액**을, 양수를 주면 그 금액만 **부분환불**해요(잔액 이하만 허용). 갱신된 결제 1건을 #4-10 과 동일한 `AdminPaymentListItemResponse` 로 돌려줘요(React 가 이 값으로 목록 행을 즉시 갱신).

**부분환불 모델**(E-Commerce/구독 서비스 관행): `payment_history.refunded_amount` 에 누적 환불액을 쌓아요. `amount - refunded_amount` 가 남은 환불 가능액이고, 잔액을 다 환불하면 `REFUNDED`, 일부만 남기면 `PARTIALLY_REFUNDED` 로 상태가 바뀌어요(둘 다 환불 가능 상태 → 잔액이 남는 한 여러 번 부분환불 가능). 구독 결제는 응답의 `periodStart`/`periodEnd`(§4-10)로 프론트가 **일할계산**(잔여기간 비례 환불액) 버튼을 제공해요 — 한국 계속거래/전자상거래법의 잔여분 환급 관행.

**환불 이력 원장**: 환불 1건마다 `payment_refunds`(금액·사유·처리자 email·시각) 에 1행을 기록해요 — 누적값만으로는 다회 부분환불 시 건별 사유/시각/처리자가 덮여 사라지기 때문이에요. `GET /api/admin/apps/{slug}/payments/{paymentId}/refunds` 로 최신순 이력을 조회하고(모달의 "환불 이력" 리스트), 매출 `refunded` 집계(§5-1)도 이 원장을 씁니다.

**흐름**: admin 요청은 `SlugContext` 가 `"admin"` 으로 고정돼 있어요. 컨트롤러가 서비스 호출 직전에 대상 슬러그로 스왑(`try`) → 원복(`finally`) 하고, 서비스는 그 스왑된 컨텍스트 안에서 앱쪽 결제 컨트롤러가 쓰는 것과 **같은** `PaymentPort.refund(...)`(전액이면 `amount=null`, 부분이면 해당 금액)를 호출해요(환불 로직 중복 없음). 상태 반영은 두 경로로 갈려요:
- **첫 환불이 전액(`PAID` → 전액)**: 기존 경로 유지 — 환불 성공 직후 **같은 (source, externalId) 로 `BillingPort.handleWebhook(...)` 을 직접 트리거**해서 앱쪽 실제 webhook 이 도착했을 때와 동일한 코드 경로로 `payment_history` 를 `REFUNDED` 로 반영해요(idempotency 키 공유 → 이후 PortOne 진짜 webhook 도착해도 안전하게 skip).
- **부분환불 · 부분→완납**: webhook(전액 `REFUNDED` 전제)을 쓰지 않고 `payment_history` 를 직접 갱신해요 — `status = PARTIALLY_REFUNDED | REFUNDED`, `refunded_amount` 누적, `refunded_at`/`refund_reason`.

**검증 순서**:
1. `AdminSlugRegistry.has(slug)` — 없는 슬러그면 404 `ADMIN_003`.
2. 대상 슬러그 스키마에서 `paymentId` 조회 — 없으면 404 `ADMIN_007`.
3. `channel != 'PG'`(즉 IAP)면 400 `ADMIN_006` — Apple/Google 스토어가 결제를 소유해서 콘솔이 환불을 대행할 수 없어요.
4. 환불 가능 잔액이 0 이하이거나 상태가 `PAID`/`PARTIALLY_REFUNDED` 가 아니면 400 `ADMIN_021`(환불 불가 상태).
5. 요청 금액이 남은 잔액을 초과하면 400 `ADMIN_020`(환불 금액 오류). `amount` 는 `@Positive` 라서 0·음수는 그 전에 bean validation(422 `CMN_*`)에서 걸러져요 — `ADMIN_020` 은 "잔액 초과" 전용이에요.
6. 그 외 PortOne 이 거부하는 케이스는 `PaymentPort` 예외를 `GlobalExceptionHandler` 가 매핑해요.

**감사로그**: `@Audited("admin.payment.refund")` 가 `AuditAspect` 를 트리거해요. 컨트롤러가 `SlugContext` 를 스왑한 *이후* 서비스를 호출하기 때문에, 감사 이벤트는 `"admin"` 이 아니라 **대상 앱 슬러그의 스키마**(`audit_logs`)에 남습니다.

부분환불 응답(12000 중 4000 환불 → 잔액 8000):

```json
{
  "data": {
    "id": 11, "userId": 1, "userEmail": "user@example.com", "channel": "PG",
    "amount": 12000, "refundedAmount": 4000, "currency": "KRW", "status": "PARTIALLY_REFUNDED",
    "paidAt": "2026-06-01T00:00:00Z", "refundedAt": "2026-07-07T09:10:00Z",
    "externalId": "imp_123456789", "paymentType": "SUBSCRIPTION",
    "periodStart": "2026-06-01T00:00:00Z", "periodEnd": "2026-07-01T00:00:00Z"
  },
  "error": null
}
```

IAP 결제 환불 시도 응답:

```json
{ "data": null, "error": { "code": "ADMIN_006", "message": "PG 결제만 콘솔에서 환불할 수 있어요.", "details": { "channel": "IAP" } } }
```

잔액 초과 환불 시도 응답:

```json
{ "data": null, "error": { "code": "ADMIN_020", "message": "환불 금액이 환불 가능 잔액을 벗어났어요.", "details": { "requested": 9999, "refundable": 8000 } } }
```

### 4-12. `GET /api/admin/dashboard/top-customers` — 결제 TOP N 고객 (v1.7)

`window`(기본 `"30d"`, `"7d"` 도 가능, 그 외 값은 `30d`)와 `size`(기본 5, `[1,20]` 범위로 clamp — 내부 콘솔 전용이라 400 대신 보정)를 받아 전 슬러그의 결제 TOP N 을 병합합니다.

슬러그별로 `payment_history` 를 `users` 와 조인해(§5-1 gross 시맨틱과 동일하게 `status IN ('PAID','REFUNDED')` 필터) 유저당 합산 금액 기준 상위 `size` 명을 먼저 뽑고, 전 슬러그 결과를 합쳐 `totalAmount` 내림차순으로 다시 상위 `size` 만 추립니다 — 슬러그별 상위 `size` 사전 필터링만으로 전역 정확도가 보장돼요(한 슬러그가 최종 top-`size` 에 `size` 건보다 많이 기여할 수 없기 때문).

```json
{
  "data": [
    { "slug": "gymlog", "userId": 7, "userEmail": "vip@example.com", "totalAmount": 990000, "paymentCount": 12 },
    { "slug": "sumtally", "userId": 3, "userEmail": "big@example.com", "totalAmount": 450000, "paymentCount": 5 }
  ],
  "error": null
}
```

### 4-13. `GET /api/admin/apps/{slug}/files` — 업로드 파일 목록 (v1.8)

앱별 업로드 bucket(`<slug>-uploads` 컨벤션 — [`스토리지 버킷 격리`](../production/setup/storage-bucket-isolation.md) §2)의 object 를 `prefix` 로 필터링해 조회해요. `max`(기본 200)는 §4-4 와 같은 내부 콘솔 clamp 규칙으로 `[1, 1000]` 범위로 보정됩니다. `url` 은 만료 ~10분짜리 presigned GET URL(미리보기/다운로드 용도)이고, `quarantined` 는 `key` 가 `quarantine/` 프리픽스로 시작하는지로 판정해요.

```json
{
  "data": {
    "files": [
      { "key": "avatars/42.png", "size": 10240, "lastModified": "2026-07-06T10:00:00Z",
        "url": "https://minio.example.com/gymlog-uploads/avatars/42.png?X-Amz-...", "quarantined": false },
      { "key": "quarantine/avatars/7.png", "size": 5120, "lastModified": "2026-07-05T09:00:00Z",
        "url": "https://minio.example.com/gymlog-uploads/quarantine/avatars/7.png?X-Amz-...", "quarantined": true }
    ],
    "truncated": false
  },
  "error": null
}
```

`truncated` 는 실제 object 수가 `max` 를 초과해 목록이 잘렸는지 여부예요(별도 COUNT 쿼리 없이 `max+1` 개를 조회해 판정).

### 4-14. `POST /api/admin/apps/{slug}/files/quarantine` — 파일 검역 (write, v1.8)

유해 컨텐츠 대응용 write 액션이에요. `key` 를 `quarantine/` 프리픽스 하위로 옮깁니다(`StoragePort.copyObject` + `deleteObject` 조합 — move 는 별도 API 가 없어 두 호출을 조합해요). 이미 `quarantine/` 로 시작하는 `key` 를 다시 검역하려 하면 400 `ADMIN_008`.

```json
{ "data": { "key": "quarantine/avatars/42.png", "size": 10240, "lastModified": "2026-07-07T09:10:00Z", "url": "https://minio.example.com/...", "quarantined": true }, "error": null }
```

### 4-15. `POST /api/admin/apps/{slug}/files/restore` — 파일 복원 (write, v1.8)

`quarantine/` 프리픽스를 제거해 원래 위치로 되돌려요. 검역되지 않은(즉 `quarantine/` 로 시작하지 않는) `key` 를 복원하려 하면 400 `ADMIN_009`.

```json
{ "data": { "key": "avatars/42.png", "size": 10240, "lastModified": "2026-07-07T09:20:00Z", "url": "https://minio.example.com/...", "quarantined": false }, "error": null }
```

### 4-16. `DELETE /api/admin/apps/{slug}/files` — 파일 삭제 (write, v1.8)

불가역 삭제예요. `StoragePort.deleteObject` 가 idempotent(존재하지 않는 key 를 지워도 예외 없음)라 이 엔드포인트도 그렇습니다. 본문 없이 204 No Content 를 돌려줘요(`ApiResponse.empty()` — [`API Response Format`](./api/api-response.md) 의 "본문 없는 성공" 참고).

**§4-13~4-16 공통 검증 순서**: `AdminSlugRegistry.has(slug)` 가 false 면 404 `ADMIN_003` — bucket 이름 자체를 슬러그로부터 조립하기 때문에(schema 라우팅과 달리 코드가 bucket 접근을 막지 않음) 존재하지 않는 슬러그를 조기에 걸러내는 이 검증이 유일한 방어선이에요. 검역/복원 대상 `key` 가 실제로 존재하지 않으면 `StoragePort.copyObject` 가 던지는 `StorageException`(`STG_002 OBJECT_NOT_FOUND`, 404)이 그대로 노출됩니다 — §4-11 의 "포트가 거부하는 케이스는 그대로 노출" 패턴과 동일하게, 이 도메인에 별도 FILE_NOT_FOUND 코드를 새로 만들지 않았어요.

**감사로그**: `@Audited("admin.file.quarantine"/"admin.file.restore"/"admin.file.delete")` 가 §4-11 환불과 동일하게 `AuditAspect` 를 트리거해요. 컨트롤러가 서비스 호출 전 `SlugContext` 를 대상 슬러그로 스왑(`try`)하고 호출 후 원복(`finally`)하기 때문에, 감사 이벤트는 대상 앱 슬러그의 스키마에 남습니다 — bucket 접근 자체는 이름으로 직접 라우팅돼 `SlugContext` 를 보지 않지만, 감사로그 라우팅을 위해 스왑이 필요해요.

---

## 5. 핵심 시맨틱 정의

### 5-1. gross 수금총액 — `status IN ('PAID', 'REFUNDED', 'PARTIALLY_REFUNDED')`

`payment_history.status` 는 환불 시 `PAID` → `REFUNDED`(전액) 또는 `PARTIALLY_REFUNDED`(부분, §4-11)로 **덮어씁니다**(별도 플래그가 아니라 상태 자체가 바뀜). 이 때문에 gross 를 `status='PAID'` 로만 집계하면 환불된 결제가 gross 에서도 빠져버리고, 이어서 `gross - refunded` 로 다시 한 번 차감되는 **이중차감** 버그가 생깁니다. 부분환불 건도 **전액이 한 번 수금**됐으므로 gross 엔 전액이 들어가야 해요(그래서 세 상태 모두 포함).

올바른 시맨틱은 다음과 같습니다.

| 필드 | 정의 |
|---|---|
| `gross` | `status IN ('PAID', 'REFUNDED', 'PARTIALLY_REFUNDED')` 인 건의 `amount` 합 — **환불 여부와 무관하게 한 번이라도 수금된 금액의 총합** |
| `refunded` | **`payment_refunds` 원장**에서 `refunded_at` 이 조회 기간에 속하는 건의 `amount` 합 — 부분/전액 환불마다 원장에 1행 쌓이므로, 다회 부분환불도 **각 환불이 실제 발생한 기간에 정확히 귀속**됩니다(§4-11) |
| `net` | `gross - refunded` |

대시보드(§4-2)·앱 metrics(§4-3)·billing(§4-6)·analytics revenue(§4-8) **4곳 모두** 이 시맨틱을 동일하게 따릅니다. 구현은 `AdminMetricsService`/`AdminDashboardService`/`AdminAnalyticsService` 를 참고하세요. top-customers(§4-12)도 랭킹 대상을 뽑을 때 같은 `status IN ('PAID', 'REFUNDED', 'PARTIALLY_REFUNDED')` 필터를 씁니다.

> **환불 원장으로 기간 귀속 정확**: `refunded` 는 `payment_history.refunded_amount`(누적)·`refunded_at`(마지막 값)이 아니라 `payment_refunds` **건별 원장**에서 집계합니다 — 한 결제를 서로 다른 기간에 걸쳐 여러 번 부분환불해도 각 건이 자기 기간에 정확히 잡혀요(예: 6월 4000 + 7월 3000 → 6월 4000·7월 3000). 과거(원장 도입 전) 환불 건은 V023 마이그레이션이 누적액 1행(시각=마지막 환불 시각)으로 백필합니다.

### 5-2. 리텐션 정의 — 코호트 D1/D7

`retentionD1`/`retentionD7` 은 "가입 후 N일째에도 활동했는가" 를 코호트로 계산합니다.

| 구분 | 코호트(가입일 구간) | 생존 판정 |
|---|---|---|
| D1 | `created_at::date` 가 `[오늘-15, 오늘-2]` | 가입일+1일에 `user_activity_days` 행 존재 |
| D7 | `created_at::date` 가 `[오늘-21, 오늘-8]` | 가입일+7일에 `user_activity_days` 행 존재 |

퍼센트는 소수 1자리로 반올림하고, **코호트 크기가 0이면 `null`** 을 반환합니다(0으로 나누기 회피 + "데이터 없음"과 "생존율 0%"를 구분하기 위해). 코호트 구간을 `[오늘-N, 오늘-2]`처럼 하한을 살짝 당겨 둔 이유는 "가입 직후라 아직 D1/D7 판정 시점이 안 된" 유저를 코호트에서 자연히 제외하기 위해서예요.

---

## 6. 활동 ping — DAU 를 설계로 보장 (user 도메인 소유)

이 엔드포인트는 `core-admin-impl` 이 아니라 **`core-user-impl` 소유**지만, admin 콘솔의 DAU/MAU/리텐션 지표(§4-2, §4-3, §4-8, §4-9)의 유일한 원천이라 여기서 함께 설명합니다.

- **엔드포인트**: `POST /api/apps/{slug}/users/me/activity` — 인증 필수, 본문 없음, 응답 **204 No Content**.
- **동작**: 이 요청 자체가 활동 신호예요. `UserActivityTrackingFilter` 가 `/api/apps/**` 로 오는 모든 인증된 요청에서 `(user_id, 오늘)` 을 `user_activity_days` 에 upsert 하므로, 이 엔드포인트는 "본문 로직 없이 인증만 통과하면 되는" 최소 호출 지점 역할만 합니다.
- **"오늘" 판정**: 애플리케이션 서버 시계가 아니라 **DB 의 `CURRENT_DATE`** 로 upsert 쿼리 안에서 결정합니다 — 서버·DB 시계가 어긋나도 기록 시점과 집계 쿼리 기준이 항상 일치하도록.
- **클라이언트(Flutter) 호출 정책**: 부팅(인증 복원 후)·포그라운드 복귀 시 fire-and-forget 호출. 로그인 상태에서만, **6시간 스로틀**, 실패는 조용히 무시하고 **성공 시에만** 마지막 호출 시각을 갱신(장애 구간의 신호 유실 방지), 부팅을 블로킹하지 않음.

---

## 7. 에러 코드 — `ADMIN_001` ~ `ADMIN_009`

| 코드 | HTTP | 발생 상황 |
|---|---|---|
| `ADMIN_001` INVALID_CREDENTIALS | 401 | 로그인 시 이메일 또는 비밀번호 불일치 |
| `ADMIN_002` UNSUPPORTED_METRIC | 400 | `/analytics/{metric}` 의 `metric` 이 `dau`/`signups`/`revenue` 가 아님 |
| `ADMIN_003` UNKNOWN_SLUG | 404 | 존재하지 않는 슬러그로 조회(`AdminSlugRegistry` 에 없는 slug) |
| `ADMIN_004` INVALID_DATE_RANGE | 400 | `from`/`to` 쿼리 파라미터가 ISO-8601 형식이 아님 |
| `ADMIN_005` USER_NOT_FOUND | 404 | `/apps/{slug}/users/{userId}` 조회 시 해당 유저 없음 |
| `ADMIN_006` PG_REFUND_ONLY | 400 | 환불 대상 결제의 `channel` 이 `PG` 가 아님(IAP 는 스토어가 결제를 소유해 콘솔 대행 불가) |
| `ADMIN_007` PAYMENT_NOT_FOUND | 404 | 환불 대상 슬러그 스키마에 그 `paymentId` 의 결제가 없음 |
| `ADMIN_008` FILE_ALREADY_QUARANTINED | 400 | 이미 `quarantine/` 프리픽스인 `key` 를 다시 검역 시도(v1.8) |
| `ADMIN_009` FILE_NOT_QUARANTINED | 400 | `quarantine/` 프리픽스가 아닌 `key` 를 복원 시도(v1.8) |

에러 응답은 다른 모든 API 와 동일한 `ApiResponse` 래퍼를 씁니다.

```json
{ "data": null, "error": { "code": "ADMIN_003", "message": "알 수 없는 앱이에요.", "details": null } }
```

`ADMIN_003`/`ADMIN_005`/`ADMIN_006`/`ADMIN_007`/`ADMIN_008`/`ADMIN_009` 는 모두 `BaseException` 계열(각각 `AdminSlugNotFoundException`/`AdminPaymentNotFoundException`/`AdminUnsupportedRefundChannelException`/`AdminFileAlreadyQuarantinedException`/`AdminFileNotQuarantinedException`)이라 공용 `GlobalExceptionHandler` 가 자동 매핑하고, `ADMIN_004`(날짜 파싱 실패)와 `ADMIN_005`(유저 없음의 JDBC 0-rows 케이스)는 admin 컨트롤러 전용 `AdminControllerAdvice` 가 매핑합니다. 이미 환불된 결제처럼 "포트가 거부하는" 케이스는 이 카탈로그에 없고 `core-payment-api`(`PaymentError`)/`core-billing-api`(`BillingError`)/`core-storage-api`(`StorageError`, 예: 검역/복원 대상 `key` 가 없으면 `STG_002 OBJECT_NOT_FOUND`) 쪽 코드가 그대로 노출돼요. 전체 에러 코드 카탈로그는 [`exception-handling.md`](../convention/exception-handling.md) 를 참고하세요.

---

## 8. 환경변수

| 키 | 의미 | 비우면 |
|---|---|---|
| `ADMIN_EMAIL` | 최초 기동 시 시드할 운영자 계정 이메일 | `AdminAccountSeeder` no-op(시드 안 함) |
| `ADMIN_PASSWORD` | 시드용 초기 비밀번호 | 〃 |
| `ADMIN_DB_URL` | `admin` schema 전용 DataSource 접속 URL | 코어 `DB_URL` 에서 `currentSchema=admin` 으로 자동 파생 |
| `ADMIN_DB_USER` | 〃 사용자 | 코어 `DB_USER` 재사용 |
| `ADMIN_DB_PASSWORD` | 〃 비밀번호 | 코어 `DB_PASSWORD` 재사용 |

> **`ADMIN_DB_URL` 을 명시할 때 주의** — URL 에 `?currentSchema=admin` 이 반드시 포함돼야 해요. 누락하면 `admin` schema 가 아니라 default schema 로 라우팅되는 사고가 납니다. 로컬/dev 는 보통 세 값을 모두 비워 두고 코어 `DB_URL` 파생에 맡기세요.

운영에서는 `ADMIN_EMAIL`/`ADMIN_PASSWORD` 로 최초 계정을 시드한 뒤, **첫 로그인 직후 비밀번호를 바꾸고 두 값을 삭제**하는 걸 권장합니다.

---

## 관련 문서

- [`ADR-039 · admin 모듈`](../philosophy/adr-039-admin-module.md) — 이 API 의 설계 결정 전체(대안 비교, 도그푸딩 교훈)
- [`코어 데이터 모델`](../reference/data-model.md) — `admin.admin_users` + `user_activity_days` 테이블 정의
- [`API Response Format`](./api/api-response.md) — `ApiResponse`/`PageResponse` 공통 래퍼
- [`JWT Authentication`](../structure/jwt-authentication.md) — 토큰 발급/검증 공통 흐름
- [`Multi-tenant Architecture`](../structure/multitenant-architecture.md) — `SchemaRoutingDataSource` + `SlugContext`
- [`Exception Handling`](../convention/exception-handling.md) — 전체 에러 코드 카탈로그 규약
- [`ADR-027 · admin role 권한 분리`](../philosophy/adr-027-admin-role-authorization.md) — `ROLE_ADMIN`(앱 내부) vs `ROLE_SUPERADMIN`(콘솔) 구분
- [`ADR-028 · audit log 도메인`](../philosophy/adr-028-audit-log-domain.md) — `audit_logs` 가 쌓이는 방식(AOP)
- [`오브젝트 스토리지 규약`](./functional/storage.md) — `StoragePort`, presigned URL, object key 패턴
- [`스토리지 버킷 격리`](../production/setup/storage-bucket-isolation.md) — `<slug>-uploads` bucket 네이밍 컨벤션(§4-13~4-16 이 의존)
