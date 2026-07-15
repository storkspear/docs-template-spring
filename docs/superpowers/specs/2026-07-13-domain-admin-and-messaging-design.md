# 도메인 admin 아키텍처 + 발송(메시징) 설계

> **유형**: Design Spec · **작성일**: 2026-07-13 · **대상 레포**: template-spring(백엔드) + template-react-admin(프론트) → 파생 어드민 레포
> **선행 스펙**: [`2026-07-06-admin-module-design.md`](./2026-07-06-admin-module-design.md) (cross-app 운영 콘솔 API), RBAC 편집 매트릭스(구현 완료)

---

## 0. 목표와 배경

3개 템플릿 역할:

| 템플릿 | 성격 | 파생물 |
|---|---|---|
| **template-spring** | 백엔드 멀티모듈 모놀리스 — schema-per-app 로 N개 앱 서빙 + admin API | backend-server 등 |
| **template-flutter** | Flutter 앱 공장(FeatureKit) — 앱마다 파생 | gymlog, tradelog, site-* |
| **template-react-admin** | 단일 admin 콘솔 프론트 — 하나 파생, 스키마 라우팅으로 N개 앱 관리 | admin-console(-v2) |

**현재 상태**: admin 콘솔의 사이드바 메뉴(사용자·결제·파일·감사로그·발송…)는 **모든 앱이 공통으로 갖는 도메인**만 다룬다. 실제로 N개 서비스를 붙이면 각 앱은 **자기 도메인 고유의 admin 기능**(예: gymlog 운동 라이브러리, tradelog 종목·저널 검수)이 필요한데, 이를 담을 구조가 없다.

**이 스펙이 정하는 것**: (1) 도메인별 admin 기능을 어디에 담고 어떻게 노출할지(아키텍처), (2) 그 첫 구체 사례이자 공통 기능인 **발송(SMS/Email/Push)** 을 어떻게 지을지.

### 전제 사실 (레포 조사로 확정, 2026-07-13)

- **발송 채널 엔진 존재**: `SmsPort.send(toE164, text)`(CoolSMS·Logging), `EmailPort.send(to, subject, htmlBody)`(Resend·Logging), `PushPort.sendToUser(userId,msg)`/`sendToDevices(tokens,msg)`/`sendToTopic(topic,msg)`(FCM·NoOp).
- **admin 발송 백엔드 없음**: `PERM_SEND` 상수만 있고 controller/service/경로 상수 없음. 프론트 `SendPage` 는 UI 셸만(채널 토글·앱 선택·수신대상·제목/내용 폼, `onFinish` 미배선).
- **발송 이력 테이블 없음, 사용자 그룹/세그먼트 모델 없음.**
- **참고 패턴 `user_read_history`**(new-app.sh 로 앱마다 생성): `admin_user_id, admin_email(계정 삭제 후 보존), viewed_user_id, resource_type, ip_address VARCHAR(45), viewed_at` + 인덱스. 발송 이력이 1:1 미러 가능.
- **RBAC**: `PermissionCatalog`(FIXED/DOMAIN/GOVERNANCE 분류) + `role_permissions(role, permission)` 테이블 + 매트릭스(role×permission, editable). `effectivePermissions(role) = fixedFor(role) ∪ DB grants`. 저장 키가 `(role, permission)` 문자열이라 **임의 permission 문자열 수용 가능**.
- **멀티테넌시**: `SchemaRoutingDataSource` + `SlugContext`(ThreadLocal) 로 앱 스키마 라우팅. `/api/admin/apps/{slug}/...` 경로가 slug 를 컨텍스트로 설정.
- **앱 지표 원천**: `getAppMetrics`(users, newUsers7d, premiumUsers, dau, mau), `getAppBilling`(activeSubscriptions) — 세그먼트 술어의 근거는 있으나 **정확한 컬럼은 구현 시 앱 user/billing 스키마로 검증**(추측 금지).
- **프론트 nav 단일 소스**: `nav.tsx` 의 `NAV_ITEMS` 에서 라우트·사이드바·활성표시 파생.
- **ArchUnit r1~r22**: cross-domain 은 Port 로만, Mapper/Converter 클래스 금지(Entity `toXxx()`), Controller→Service→Repository.

---

## A. 확정 결정 (4)

1. **UI 스코핑 = 앱 컨텍스트 전환형.** 상단 앱 스위처로 앱 선택 → 그 앱 스코프에서 공통+도메인 메뉴가 함께 뜬다. 사이드바는 항상 "공통 + 현재 앱 도메인"만 → N=10 이어도 안 무너짐. 앱 스위처 ↔ `SlugContext` 1:1.
2. **코드 위치.** 도메인 admin **백엔드 = 각 앱 모듈 안**(`/api/admin/apps/{slug}/…`, 자기 스키마·RBAC 게이팅). **프론트 = 파생 어드민 레포의 확장 포인트**(`src/domains/<slug>/`). 공통 템플릿 코어는 공통만 유지(template-flutter "스텁만, 도메인은 파생 레포" 원칙과 동일).
3. **메뉴 스코핑.** cross-app(전체 컨텍스트): 대시보드·앱·분석·역할·권한·설정. per-app(앱 선택 시 그 앱): **사용자·결제·파일·감사로그·발송 + 도메인 섹션.**
4. **도메인 RBAC.** 앱 모듈이 자기 도메인 PERM(예: `PERM_GYMLOG_ROUTINE_MODERATE`)을 카탈로그에 **등록**. 기존 `(role, permission)` 저장·매트릭스 재사용. 앱 컨텍스트에서 매트릭스가 그 앱 도메인 권한 섹션만 표시.

---

## B. 앱 컨텍스트 전환 네비게이션 모델 (#1, #3)

### 컨텍스트 2단계

- **전체(global) 컨텍스트** — 앱 미선택. cross-app 메뉴만 노출: 대시보드(전 앱 요약), 앱·분석(앱 비교), 역할·권한, 설정.
- **앱(slug) 컨텍스트** — 앱 스위처에서 앱 선택. per-app 메뉴가 그 앱으로 필터(사용자·결제·파일·감사로그·발송) + 그 앱 **도메인 섹션** 등장. 다른 앱 선택 시 도메인 섹션만 그 앱 것으로 교체.

```
[앱 ▾ gymlog]              ← 상단 앱 스위처 (전체 | gymlog | tradelog | …)
── 공통 ──
  사용자 / 결제 / 파일 / 감사로그 / 발송        (선택 앱으로 스코프)
── gymlog 도메인 ──                              (파생 레포 domains/gymlog 등록분)
  운동 라이브러리 / 루틴 검수 / 챌린지 관리
── 시스템 ──
  역할·권한 / 설정                               (항상 cross-app)
전체 컨텍스트일 때: 대시보드·앱·분석·역할·권한·설정만, per-app 섹션 숨김
```

### 프론트 구현

- 앱 스위처 상태(선택 slug 또는 '전체')를 전역 컨텍스트(예: `useAppContext`)로. per-app API 호출은 자동으로 `{slug}` 주입.
- `nav.tsx` 를 **스코프 인지**로 확장: 각 `NavItem` 에 `scope: 'global' | 'app'` 필드. 사이드바는 (현재 컨텍스트 + RBAC read 권한)으로 필터.
- 도메인 메뉴는 아래 C의 레지스트리에서 병합.

---

## C. 확장 포인트 (#1, #2)

### 백엔드 — 앱 모듈이 도메인 admin 제공

- 앱 모듈(파생 레포)이 `/api/admin/apps/{slug}/domain/...` 컨트롤러를 자체 소유. `{slug}` 경로가 `SlugContext` 설정 → 그 앱 스키마로 라우팅.
- 도메인 컨트롤러는 도메인 PERM 으로 게이팅(`hasAuthority(PERM_XXX)`), 공통 `AdminSecurity`/`GlobalExceptionHandler` 재사용.
- 공통 template-spring 엔 도메인 코드 없음. 앱 모듈이 자기 도메인 서비스/리포지토리/마이그레이션 소유.

### 프론트 — 파생 레포 도메인 모듈 등록

- 파생 어드민 레포가 `src/domains/<slug>/index.ts` 로 **도메인 모듈 계약**을 export:
  ```ts
  export interface DomainModule {
    slug: string
    navItems: DomainNavItem[]   // { path, label, icon, element, read: PERM, write?: PERM }
    permissions: DomainPermMeta[] // 매트릭스 표시용 { key, label, category }
  }
  ```
- 코어(template-react-admin)는 `domains/registry.ts` 에서 등록된 모듈을 수집 → nav 병합(앱 컨텍스트에서만) + 매트릭스 권한 목록 병합. **코어는 빈 레지스트리로 빌드되고, 파생 레포가 채운다.**

---

## D. 도메인 RBAC 통합 (#4)

- **백엔드**: 앱 모듈이 도메인 PERM 목록을 SPI(예: `DomainPermissionProvider` 빈)로 노출 → 부팅 시 `PermissionCatalog` 가 공통 + 전 앱 도메인 PERM 을 집계. 분류는 DOMAIN(역할별 토글 가능).
- **저장/강제**: 기존 `role_permissions(role, permission)` 그대로. 도메인 PERM 문자열은 앱 특정(`PERM_GYMLOG_*`)이라, 전역 role 에 grant 해도 그 앱 엔드포인트에서만 의미(tradelog 엔드포인트는 `PERM_TRADELOG_*` 체크). → **전역 role grant + 앱 특정 PERM = 자연 스코핑.**
- **매트릭스 UI**: 앱 컨텍스트에서 역할·권한 열면 공통 권한 + 그 앱 도메인 권한 섹션 표시. 편집 계층(계층 가드·의존·editable)은 기존 규칙 재사용.
- **주의**: 매트릭스 편집 결과는 기존과 동일하게 **다음 로그인부터** 반영(JWT permissions claim 은 발급 시점 고정).

---

## E. 발송(메시징) 기능 (#2) — 첫 구체 사례, 공통 도메인

발송은 **공통 메뉴**(모든 앱 공통, per-app 스코프)다. 채널 엔진은 있으니 admin UX·타겟팅·이력을 신설.

### E-1. 타겟팅

`앱(slug=컨텍스트) → 채널(SMS|EMAIL|PUSH) → 수신대상`:

- **단일 유저** — id 또는 email 로 지정.
- **전체 broadcast** — 앱 전체 유저.
- **세그먼트** — 조건 기반: 전체 / 프리미엄 / 무료 / 최근 N일 활성 / 비활성 / 신규 N일. **술어→컬럼 매핑은 구현 시 앱 user/billing 스키마로 검증**(premium 은 billing/subscription 테이블일 가능성).
- **Push 전용** — FCM `sendToTopic`(토픽 구독자) 옵션.

**세그먼트 × 채널 = 연락처 교집합**(핵심): SMS 는 전화번호(E164) 보유 유저, Email 은 이메일 보유 유저, Push 는 토큰 보유 유저만 유효 수신자. 처리 순서 = **대상 산출 → 채널별 유효 수신자 필터 → 건수 확정 → (확인) → 발송 → 이력 기록.**

### E-2. 발송 이력 — per-app `message_send_history` (user_read_history 미러)

앱 스키마에 신설(new-app.sh heredoc + 기존 앱은 신규 마이그레이션):

| 컬럼 | 타입 | 내용 |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `sender_admin_id` | BIGINT NOT NULL | 발송한 콘솔 계정 |
| `sender_email` | VARCHAR(255) | 계정 삭제 후에도 보존 |
| `sender_ip` | VARCHAR(45) | 발송자 IP |
| `channel` | VARCHAR(10) NOT NULL | SMS \| EMAIL \| PUSH |
| `target_type` | VARCHAR(16) NOT NULL | USER \| SEGMENT \| BROADCAST \| TOPIC |
| `target_ref` | VARCHAR(255) | 유저 id/email, 세그먼트 코드, 토픽명 |
| `recipient_count` | INT NOT NULL | 확정 유효 수신자 수 |
| `subject` | VARCHAR(200) | (SMS 는 NULL) |
| `body_preview` | VARCHAR(500) | 발송 내역(원문 앞부분) |
| `result` | VARCHAR(10) NOT NULL | SUCCESS \| PARTIAL \| FAILED |
| `sent_at` | TIMESTAMPTZ NOT NULL | |
| `created_at`/`updated_at` | TIMESTAMPTZ NOT NULL | |

인덱스: `(sent_at DESC)`, `(channel, sent_at DESC)`, `(sender_admin_id)`.

### E-3. 엔드포인트 (admin, per-app)

- `POST /api/admin/apps/{slug}/messages` — 발송(body: channel, target, subject, body). `PERM_SEND`(write).
- `POST /api/admin/apps/{slug}/messages/preview` — 대상 건수·유효 수신자 미리보기(발송 없음). `PERM_SEND`.
- `GET /api/admin/apps/{slug}/messages` — 발송 이력(채널·기간 필터, 페이지). `PERM_SEND`.

`sender_ip` 는 요청 컨텍스트에서 클라이언트 IP 캡처(user_read_history/reveal 과 동일 방식 — 구현 시 해당 유틸 확인·재사용).

### E-4. 가드 (실발송은 비용·비가역)

- 발송 전 **preview → 건수 확인 모달**(N명에게 보냅니다) 필수.
- **broadcast 건수 상한**(설정값). 초과 시 세그먼트로 좁히도록 차단.
- 대량 발송: **MVP = 동기 + 상한**, 스케일업 = 비동기 잡(라벨만 남김, [비활성 인프라 위 작업 미루기] 원칙).
- 부분 실패 허용: 채널 Port 예외를 수신자 단위로 집계 → `PARTIAL`.

### E-5. 메뉴

`발송`(per-app) 하위: `보내기`(채널 탭 SMS/Email/Push) + `발송 이력`(채널 필터로 통합 조회). RBAC `PERM_SEND`.

---

## F. 데이터 모델 / 마이그레이션

- **`message_send_history`** — 앱 스키마. `tools/new-app/new-app.sh` heredoc 에 추가(신규 앱 자동) + 기존 앱은 다음 per-app 버전 마이그레이션(V0xx). `user_read_history` 바로 다음 번호 관례.
- **도메인 PERM** — 코드 상수(앱 모듈), `role_permissions` 는 스키마 변경 없이 문자열 수용.
- **admin 스키마 변경 없음**(발송 이력은 per-app).

---

## G. 에러 처리

- 발송 검증 실패(대상 0명, 상한 초과, 채널 연락처 없음) → `AdminError` 신규 코드(기존 enum 다음 번호, 재배치 금지). fail-secure: 건수 미확정이면 발송 거부.
- 채널 Port 예외는 좁혀 catch(전 채널 broad catch 금지) → 수신자별 결과 집계.
- 크로스 도메인 접근은 Port 경유(ArchUnit r 준수). Mapper 클래스 신설 금지 — Entity `toSummary()` 등.

---

## H. 테스트

- **백엔드(Testcontainers)**: `message_send_history` 리포지토리 CRUD, 세그먼트 대상 산출(채널 교집합), preview 건수, 부분 실패 → PARTIAL, `PERM_SEND` 게이팅, sender_ip 기록. 도메인 PERM 등록 → 매트릭스 노출(앱 모듈 있는 파생 레포 픽스처).
- **ArchUnit**: 신규 코드 r1~r22 통과(`:bootstrap:test`).
- **프론트**: `npm run build`+lint. 앱 컨텍스트 스위칭 시 메뉴 스코프, 도메인 모듈 등록 병합, 발송 preview→confirm 플로우, 이력 조회. 목(MSW) 확장.

---

## I. 단계별 구현 (플랜 문서에서 상세화)

큰 스펙 → 4 페이즈로 분해, 각 페이즈는 자체 구현 플랜 사이클:

1. **P1 앱 컨텍스트 전환** — 프론트 앱 스위처 + `nav.tsx` scope 인지 + per-app API slug 주입. (백엔드는 기존 `{slug}` 경로 재사용, 최소 변경)
2. **P2 발송 기능** — per-app `message_send_history` + 발송/preview/이력 엔드포인트 + 세그먼트 타겟팅 엔진 + SendPage 실배선 + 가드. (독립적으로 가치 있는 첫 도메인 기능)
3. **P3 도메인 확장 포인트** — 백엔드 `DomainPermissionProvider` SPI + 프론트 `domains/registry` + 매트릭스 도메인 권한 병합.
4. **P4 파생 레포 도메인 샘플** — 한 앱(예: 샘플)에서 도메인 admin 1개를 P3 확장 포인트로 실제 구현(레퍼런스).

> P1·P2 는 공통 콘솔만으로 완결(즉시 유용). P3·P4 는 파생 레포 확장 인프라(도메인 admin 이 실제 필요해질 때).

---

## J. 범위 밖 (v2+)

- 비동기 대량 발송 잡/큐(스케일업 시).
- 예약 발송·발송 템플릿·A-B.
- 세그먼트 저장 그룹(수동 멤버십 테이블) — 이번엔 조건 세그먼트까지만.
- 토큰 즉시 무효화(권한 변경 즉시 반영) — 기존과 동일하게 재로그인 반영.

---

## 리스크

- **중대형** — 신규 per-app 테이블 + 발송 엔진 + 프론트 네비 모델 전환 + RBAC 확장. P1~P4 로 무중단 점진.
- **실발송 비가역성** — preview/confirm/상한 가드 필수. dev 는 Logging/NoOp 어댑터라 안전, prod 는 실제 과금.
- **세그먼트 술어 정확도** — premium/활성 컬럼은 구현 시 실제 스키마로 검증(추측 금지). 틀리면 잘못된 대상에 발송.
- **도메인 PERM 집계** — 앱 모듈 부팅 순서/미등록 앱의 매트릭스 표시를 방어적으로.
