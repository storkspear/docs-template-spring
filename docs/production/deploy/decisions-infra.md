# 인프라 결정 기록 (Decisions — Infrastructure)

> **유형**: ADR · **독자**: Level 2~3 · **읽는 시간**: ~25분

물리·운영 인프라 선택의 결정과 근거, 그리고 어떤 지표가 넘으면 다시 볼지를 추적해요. 코드 설계 결정은 [`Repository Philosophy`](../../philosophy/README.md) 의 39개 ADR 이 따로 담당하고, 이 문서는 DB·스토리지·운영 호스트·엣지·배포 파이프라인처럼 *물리적으로 돈과 전기가 드는* 결정만 모읍니다.

## 이 문서의 역할

philosophy/ 와 이 문서는 다루는 결정의 성격이 달라요.

| 문서 | 범위 |
|---|---|
| [`Repository Philosophy — 책 안내`](../../philosophy/README.md) | 코드 설계 결정 39개 ADR — 모듈 구조, 포트·어댑터, Mapper 금지, 테스트 전략 |
| `decisions-infra.md` (이 문서) | 물리·운영 인프라 결정 — DB, 오브젝트 스토리지, 운영 호스트, 엣지, 관측성, 배포 |

경계에 걸친 결정도 있어요. 예를 들어 서비스별 schema 는 코드 규약이면서 동시에 인프라 결정이라, 양쪽 문서에서 서로 참조해요.

## 결정 카드 필드 포맷

각 결정은 다음 8개 필드를 채워요.

- **status**: `planned` · `provisioned` · `in-prod` · `hardware-acquired` · `template-ready`
- **결정일**: YYYY-MM-DD
- **결정**: 한 줄 요약
- **근거**: 왜 이 선택인가
- **대안**: 고려한 다른 선택지들
- **Trade-off**: 감수하는 비용
- **재검토 트리거**: 어떤 지표나 이벤트가 넘으면 다시 볼지
- **관련 문서**: 링크

## 결정 간 충돌 해결 규칙 (Phase 0 기준)

결정이 서로 충돌할 때의 우선순위는 다음을 따릅니다.

1. **솔로 친화** ([`ADR-007`](../../philosophy/adr-007-solo-friendly-operations.md)) — 운영 부담이 기능 완성도보다 앞섭니다
2. **보안 최소 기준** — 시크릿 분리, JWT, 엣지 TLS
3. **파생 레포 일관성** — breaking 변경은 Item 단위로 묶어 일괄 전파합니다
4. **비용** — 클라우드 무료티어 우선, 셀프 호스트 우선 (Phase 0)

Phase 1 부터는 우선순위를 재조정해요. 예를 들어 보안 기준을 상향합니다.

---

## 결정 I-01. Postgres provider — Supabase (template 관리자 default, 교체 가능)

- **status**: template 자체는 provider 중립. template 관리자 본인의 운영 배포는 Supabase `provisioned`
- **결정일**: 2026-04-18 Supabase 선택, 2026-04-20 multi-provider 지원 명시
- **결정**: template 이 요구하는 건 표준 JDBC Postgres 인스턴스 하나뿐이에요. 코드는 HikariCP 와 표준 JDBC 만 쓰고 Supabase 전용 API 에 의존하지 않아서, provider 는 자유롭게 교체할 수 있어요. template 관리자 본인은 Supabase 를 default 로 씁니다.

template 이 DB 에 거는 요구사항은 최소한이에요. 런타임 자격 세 개와 schema·role 을 만들 관리자 자격 한 개면 충분합니다.

| 환경변수 | 용도 |
|---|---|
| `DB_URL` · `DB_USER` · `DB_PASSWORD` | 앱 런타임 connection |
| `DB_PSQL_URL` | schema·role 생성용 관리자 connection (`new app --provision-db`) |

코드가 표준 JDBC 만 쓰는 덕분에 provider 를 바꿔도 Java 코드와 Flyway 마이그레이션은 손대지 않아요. `.env` 의 connection 자격만 바뀝니다.

**Supabase 를 default 로 고른 근거** (template 관리자 본인 기준):

- 관리형 Postgres 라 백업·스케일·보안패치를 대행해 줍니다
- 대시보드와 CLI 가 솔로 운영 편의를 높여요
- Free tier (500MB DB, 2GB egress) 가 Phase 0 에 충분해요
- Seoul region (`aws-1-ap-northeast-2`) 이라 한국 유저 지연이 작아요
- Supavisor pooler 가 blue/green 배포의 connection 폭증을 완충해 줍니다

**교체 가능한 옵션** (파생레포 소유자 선택):

| Provider | 강점 | 비용·한계 |
|---|---|---|
| AWS RDS | 유연성, VPC 통합, `:5432` direct | 관리 오버헤드, 초기 월 $15 이상 |
| Fly.io Postgres | 앱 근접 배포, 글로벌 edge, `.flycast` endpoint | 관리 UI 빈약 |
| self-host Postgres | 완전 통제, 비용 0 | 백업·SPOF 부담 |
| Neon | branching DB 우수 | Seoul region 부재로 지연 증가 |

- **Trade-off** (Supabase 사용 시):
  - Free tier 는 7일 비활성 시 pause 돼요. `keep-alive.sh` cron 으로 막거나 Pro 로 올립니다
  - IPv6 이슈를 겪어서 pooler 경유로 우회 중이에요
  - 표준 Postgres 기능만 쓰면 이관이 쉽지만, Realtime 이나 Edge Functions 같은 전용 기능을 쓰면 고착됩니다
- **재검토 트리거**:
  - MAU 1K 이상 — Supabase Pro 전환 또는 다른 provider 검토
  - 월 egress 2GB 초과 — CDN 앞단화 또는 Pro
  - 쿼리 성능 이슈 — 전용 DB (RDS) 검토
  - Supabase 가격 정책 변경
  - 파생레포 소유자가 이미 보유한 Postgres (회사 RDS 등) 를 재사용하고 싶을 때
- **관련 문서**:
  - [`인프라`](./infrastructure.md) — 현재 상태와 연결 방식
  - [`Onboarding §4.3`](../../start/onboarding.md#43-운영-db-provider-는-배포-시점에만-고르면-돼요) — 운영 DB provider 선택 가이드
  - `infra/scripts/keep-alive.sh` — Free tier pause 방지 (다른 provider 는 불요)

---

## 결정 I-02. 서비스별 schema (ADR-005 인프라 측면)

- **status**: `provisioned`
- **결정일**: Phase 0 초기 (ADR-005 정의 시점), 2026-05 ADR-037 로 core schema 폐기
- **결정**: 단일 Postgres DB 안에서 앱별 schema (`<slug>`) 로 데이터를 격리합니다. users·auth·device 같은 공통 인증 테이블도 각 앱 schema 안에 V001~V0xx 로 생성돼요. `core/core-*-impl` 의 Java 코드는 *라이브러리* 로 남아 각 앱 schema 의 같은 테이블에서 동작합니다.

초기 설계에는 cross-app 공통 데이터를 담는 `core` schema 가 따로 있었어요. 그런데 ADR-012 의 앱별 격리 결정 이후 `core.users` 와 `<slug>.users` 가 둘 다 존재하는 중복이 생겼고, idle connection 낭비까지 더해져 [`ADR-037`](../../philosophy/adr-037-core-schema-deprecation.md) 에서 `core` schema 를 폐기했습니다. 지금은 앱 schema 만 존재해요.

- **근거**: [`ADR-005 (단일 Postgres + 앱당 schema)`](../../philosophy/adr-005-db-schema-isolation.md) 에 정의. 솔로 운영에서 DB 인스턴스를 여러 개 관리하는 부담을 피합니다.
- **대안**: DB 분리, 단일 schema, 단일 테이블에 tenant_id 컬럼
- **Trade-off**:
  - schema 경계를 넘는 FK 를 실수로 걸면 cascade 영향이 번질 수 있어요. `search_path` 와 앱별 DB role 로 완화합니다
  - 단일 DB 용량 한계 (Supabase Free 500MB) 가 있어 재검토 트리거에 포함했어요
- **재검토 트리거**:
  - 앱당 DB 용량 200MB 초과 (5앱이면 1GB 초과 예상) — DB 분리 검토
  - 컴플라이언스 등 앱 격리 요구 상승
- **관련 문서**:
  - [`ADR-005`](../../philosophy/adr-005-db-schema-isolation.md), [`ADR-037`](../../philosophy/adr-037-core-schema-deprecation.md)
  - `infra/scripts/init-app-schema.sql` — 앱 schema·role 생성 (`core` schema 초기화 스크립트는 ADR-037 로 폐기 완료)
  - `tools/app/new-app.sh` — 앱 추가 시 schema 자동 provisioning

---

## 결정 I-03. 오브젝트 스토리지 — NAS MinIO (LAN-only)

- **status**: `provisioned` (template 관리자 LAN 내부에서만 접근)
- **결정일**: 2026-04-18
- **결정**: 오브젝트 스토리지는 시놀로지 NAS 의 MinIO 컨테이너예요. S3 호환이라 나중에 AWS S3 나 Cloudflare R2 로 옮길 때 endpoint 만 바꾸면 돼요. 외부 네트워크에서 닿게 하는 방식은 Item Ops-1 에서 결정합니다.
- **근거**:
  - 보유 NAS 를 활용해서 추가 호스팅비가 0 이에요
  - S3 호환이라 클라우드 이관이 유연해요
  - LAN 대역폭이 넓어 이미지 업로드와 썸네일 처리가 빠릅니다
  - `BucketProvisioner` 가 부팅 시 bucket 을 자동 생성해서 수동 운영이 거의 없어요
- **대안**:

| 옵션 | 강점 | 한계 |
|---|---|---|
| AWS S3 | 안정적, 글로벌 | 업로드량 늘면 비용 |
| Cloudflare R2 | egress 무료, S3 호환 (Phase 1 전환 1순위) | — |
| Backblaze B2 | 저가 | 대역폭 제한 |
| self-host MinIO on 맥미니 | 통제력 | NAS 디스크 여유가 많아 NAS 우선 |

- **Trade-off**:
  - LAN 전용이라 외부 개발자는 닿지 못해요. onboarding 에 명시하고, 파생 레포는 자체 MinIO 나 로컬 docker 를 쓰도록 권고합니다
  - NAS 가 단일 장애점이에요. RAID 와 Snapshot Replication 으로 완화합니다
  - 외부 노출 시 집 인터넷 업로드 속도가 병목이 될 수 있어요
- **재검토 트리거**:
  - 외부 개발자 합류 — Tailscale 또는 Cloudflare Tunnel (Item Ops-1)
  - NAS 디스크 사용량 80% 초과 — 증설 또는 R2 이관
  - 집 인터넷 업로드 10 Mbps 미만 — 업로드 병목
  - 파생 레포 5개 이상 — 공용 인프라 분리 검토
- **관련 문서**:
  - [`인프라`](./infrastructure.md)
  - [`오브젝트 스토리지 규약`](../../api-and-functional/functional/storage.md) — 2-tier bucket 정책 (I-07)
  - `core/core-storage-impl/` — `BucketProvisioner`, `MinIOStorageAdapter`

---

## 결정 I-04. 운영 호스트 — Apple Silicon 맥미니 (홈 서버)

- **status**: `hardware-acquired` (물리 보유, 네트워크·배포 셋업은 Item Ops-1)
- **결정일**: 2026-04-18
- **결정**: 운영 단일 호스트로 Apple Silicon 맥미니를 가정 내에 설치해 사용합니다. 권장 사양은 16GB 이고, 실제 도그푸딩 운영 장비는 M2 8GB 예요 (현재 트래픽 규모에는 충분).
- **근거**:
  - 전기세가 월 4달러 수준이에요. 클라우드 VM 의 월 20달러 이상과 대비됩니다
  - 권장 사양 기준 M4 16GB 성능이 AWS t4g.xlarge 급이에요 (실보유 M2 8GB 도 Phase 0 부하에는 여유)
  - 발열과 소음이 낮아 가정 상시 운영이 가능해요
  - SSH 와 launchd 에 익숙한 macOS 환경이에요
  - Time Machine 자동 백업으로 장애를 완화합니다
- **대안**:

| 옵션 | 강점 | 한계 |
|---|---|---|
| AWS EC2 t4g.xlarge | 안정적, 확장 쉬움 | 월 $25 이상 |
| Fly.io | 글로벌 edge 배포 | 월 $10 이상 |
| 오라클 클라우드 Free | 무료 | 계정 정지 리스크 |
| Raspberry Pi 5 | 전력 낮음 | 성능·메모리 부족 |

- **Trade-off**:
  - 단일 호스트라 고장 시 서비스가 중단돼요. 복구 시나리오는 edge-cases 3-1 에 있어요
  - 집 ISP 장애가 곧 서비스 중단이라 SLA 가 없어요
  - 초기 하드웨어 비용 약 100만원은 1년 뒤 클라우드 대비 break-even 입니다
  - 도난·화재 위험이 있어 외부 백업 (NAS 또는 Cloudflare R2) 이 필수예요
- **재검토 트리거**:
  - MAU 5K 이상 — 클라우드 분산 검토
  - 집 ISP 장애 월 2회 이상
  - 서비스 SLA 99.9% 이상 요구 — 클라우드 이관
- **관련 문서**:
  - [`인프라`](./infrastructure.md) — 구성도
  - [`Edge Cases`](../../reference/edge-cases.md) 3-1 — 고장 복구 시나리오
  - Item Ops-1 — 배포 메커니즘 (launchd)

---

## 결정 I-05. 외부 접근 — Cloudflare Tunnel

- **status**: `template-ready` (`prod init` 이 DNS · Tunnel ingress 를 자동 등록, cloudflared 설치·launchd 등록은 파생 레포 몫)
- **결정일**: 2026-04-18 (계획 확정)
- **결정**: 운영 외부 접근은 Cloudflare Tunnel (`cloudflared`) 을 경유합니다. 공개 IP 노출 없이 홈 네트워크와 인터넷이 연결돼요. TLS, WAF, Rate limit 은 Cloudflare edge 에서 처리합니다.
- **근거**:
  - 홈 IP 를 노출하지 않아 보안상 중요해요
  - TLS 인증서가 자동으로 발급·갱신돼요
  - WAF, DDoS, Rate limit 을 edge 에서 처리해 맥미니 부담이 줄어요
  - Cloudflare Free 플랜에 포함돼 무료예요
  - 호스트명 기반 ingress 규칙으로 멀티앱을 지원합니다
- **대안**:

| 옵션 | 강점 | 한계 |
|---|---|---|
| DDNS + 포트포워딩 | 무료 | 홈 IP 노출, 보안 위험 |
| Tailscale | 개발자 간 연결 쉬움 | 엔드유저 공개 접근 어려움 |
| Nginx + Let's Encrypt | 통제력 | edge 기능을 모두 직접 구축 |
| AWS ALB + CloudFront | 엔터프라이즈 | 복잡도 과도, 맥미니 직접 연결 불가 |

- **Trade-off**:
  - Cloudflare 에 의존해요. 터널이 멈추면 서비스 접근이 끊깁니다
  - cloudflared 프로세스를 launchd 로 등록해 관리해야 해요
  - tunnel create, ingress rules, DNS records 의 초기 학습이 필요해요
- **재검토 트리거**:
  - Cloudflare Free 정책 변경
  - 더 전문적인 글로벌 edge 가속 요구
  - Tunnel 장애 월 2회 이상
- **관련 문서**:
  - Item Ops-1 — 실제 셋업
  - [`인프라`](./infrastructure.md) — 운영 구성도 (planned 박스)

---

## 결정 I-06. 관측성 스택 — 셀프 호스트 (Loki + Grafana + Prometheus)

- **status**: `provisioned` (`infra/docker-compose.observability.yml` 준비 완료, 실제 기동은 파생레포 onboarding 시 Mac mini 에서)
- **적용 범위**: 운영 전용 (로컬 개발에서는 제외)
- **결정**: 로그·메트릭·대시보드·알림 스택은 셀프 호스트 오픈소스로 구성합니다. Loki, Grafana, Prometheus, Alertmanager 네 가지예요. Mac mini 운영 환경 전용이고, 로컬 개발에서는 메모리·docker 부담이 활용 빈도 대비 커서 기동하지 않아요. 대시보드 동작은 운영의 `log.<domain>` 에서 확인합니다.
- **근거**:
  - 데이터 주권 — 유저 로그와 메트릭이 외부 SaaS 로 나가지 않아요
  - 비용 0 — 맥미니에 함께 기동합니다
  - 파생 레포에 compose 파일을 그대로 전파할 수 있어요
  - 각 도구의 공식 문서와 커뮤니티가 활발해요
  - LogQL 과 PromQL 이 표준이라 이관이 쉬워요
- **대안**:

| 옵션 | 강점 | 한계 |
|---|---|---|
| Grafana Cloud | Free tier 존재 | 로그 retention 14일 제한 |
| Datadog | 강력 | 월 $31 이상 (APM, host 당) |
| ELK stack | 검색 강함 | Java 기반이라 JVM 메모리 경합 |
| New Relic · Dynatrace | 통합 관측성 | 유료 |

- **Trade-off**:
  - retention 설정, 디스크 관리, 업그레이드 같은 셀프 호스트 운영 부담이 있어요
  - 맥미니 메모리를 약 1.5GB 상시 소비해요
  - LogQL, PromQL 학습 곡선이 있어요
  - Loki retention 은 1년 (8760h), Prometheus retention 은 7일이에요 (2026-07-21 갱신 — 초기 14일에서 보안 조사·compliance 우선으로 1년 채택. 단일 인스턴스 유지)
- **재검토 트리거**:
  - 맥미니 메모리 12GB 상시 사용 초과 — 관측성 분리 (NAS)
  - Loki 디스크 사용 증가 관측 — 단일 인스턴스 Loki 부담 (2026-07-21 대체 — retention 1년 채택으로 기존 "30일 초과 요구" 트리거는 소멸)
  - 팀 3명 이상 — 관리형 (Grafana Cloud Pro)
- **관련 문서**:
  - [`Observability 규약`](../../api-and-functional/functional/observability.md)
  - `infra/docker-compose.observability.yml`
  - Item Ops-1 — 알림 종류와 임계치 정의

---

## 결정 I-07. 오브젝트 스토리지 Bucket — 2-tier 분리

- **status**:
  - 로컬 (`dev-shared`): `provisioned`
  - 운영 (`{slug}-{category}`): `planned` (Item Ops-1 에서 앱별 bucket 생성)
- **결정일**: 2026-04-18
- **결정**: 오브젝트 저장소를 환경별 2-tier 로 나눕니다. 코드는 환경과 무관하고, `.env` 의 bucket 이름만 스위치해요.
  - 로컬: `dev-shared` 단일 bucket (여러 파생 레포가 공유)
  - 운영: `{appSlug}-{category}` per-app (예: `sumtally-receipts`, `rny-avatars`)
  - Key 패턴 (환경 무관): `{appSlug}/{category}/{yyyy}/{MM}/{dd}/{userId}/{uuid}.{ext}`
- **근거**:
  - 로컬은 `mc rb --force dev-shared` 로 자유롭게 비울 수 있고, 파생 레포 동시 개발을 지원해요
  - 운영은 앱별 lifecycle·retention·권한을 분리하고, 서비스 철수 시 bucket 삭제로 정리합니다
  - Spring 은 bucket 이름만 읽고 key 생성은 항상 같아서 환경 분기가 코드에 없어요
  - `BucketProvisioner` 가 `.env` 에 이름을 추가하고 재기동하면 자동으로 provisioning 합니다
- **대안**:
  - 단일 bucket + key prefix — IAM 정책이 복잡하고 lifecycle 을 통짜로 적용해야 해요
  - 환경 × 앱 full cartesian (`dev-sumtally-*`, `prod-sumtally-*`) — bucket 수가 폭발해요
  - 운영에서 appSlug key prefix 제거 — 환경별 코드 분기가 필요하고 이관 비용이 커요
- **Trade-off**:
  - 운영 bucket 안의 key 에 appSlug 가 중복돼요 (`sumtally-receipts/sumtally/...`). 일관성을 우선했어요
  - 로컬 `dev-shared` 를 비우면 모든 파생 레포의 dev 데이터에 영향이 가요
- **재검토 트리거**:
  - 파생 레포 5개 이상 — 로컬 분리 검토 (`dev-{slug}-shared`)
  - 운영 bucket 20개 이상 — IAM 관리 부담
  - S3 (AWS·R2) 이관 시점 — 해당 provider 의 bucket 네이밍 제한 확인
- **관련 문서**:
  - [`오브젝트 스토리지 규약`](../../api-and-functional/functional/storage.md) — 상세 규약
  - `core/core-storage-impl/` — `BucketProvisioner`, `MinIOStorageAdapter`

---

## 결정 I-08. Multi-DataSource — 앱 모듈 자기 제공 패턴

- **status**: `provisioned`
- **결정일**: 2026-04-19, 2026-05 ADR-037 반영
- **결정**: 각 앱 모듈이 `AbstractAppDataSourceConfig` (common-persistence) 를 상속한 `<Slug>DataSourceConfig` 를 소유합니다. template 은 abstract 구현과 `new-app.sh` 자동 생성 로직만 제공해요. bootstrap 의 `RoutingDataSourceConfig` 가 모든 `<slug>DataSource` 를 모아 `SchemaRoutingDataSource` 로 라우팅하고, `@Primary` 로 통합 EntityManagerFactory 와 TransactionManager 를 묶습니다.

ADR-037 이전에는 `CoreDataSourceConfig` 가 `@Primary` 로 core schema 와 앱 schema 를 공존시켰어요. core schema 폐기 후에는 [`RoutingDataSourceConfig`](../../philosophy/adr-037-core-schema-deprecation.md) 가 routing 과 JPA 통합 레이어만 담당하고, slug 없는 DB 접근은 `IllegalStateException` 으로 막는 fail-secure 가 됐습니다.

- **근거**:
  - [`ADR-003 (core -api/-impl 분리)`](../../philosophy/adr-003-api-impl-split.md) 정신과 일치해요. 앱이 자기 인프라를 책임집니다
  - 파생 레포가 template bootstrap 을 수정할 필요가 없어 cherry-pick 충돌을 피해요
  - `new-app.sh` 가 Config 를 자동 생성해서 boilerplate 부담이 0 이에요
  - Spring Boot auto-config 의 silent back-off 문제를 `@Primary` 명시 선언으로 해결합니다
- **대안**:
  - Bootstrap 중앙 집중 (yml map + AbstractRoutingDataSource) — 파생 레포가 template 을 고쳐야 하고 런타임 분기 복잡도가 올라가요
  - Spring Boot auto-config 유지 — app DataSource 추가 시 silent back-off 로 부팅이 실패해요
- **Trade-off**:
  - 앱마다 Config 파일이 하나씩 생기지만 자동 생성이라 실제 부담은 0 이에요
  - 같은 Repository 가 여러 EMF 에 스캔돼서 Spring Data JPA 의 bean 이름 구분에 의존해요
  - HikariCP pool size 는 `DEFAULT_POOL_SIZE=5` 가 기본값이에요. Supabase NANO 의 session pooler 한도 (max_connections=60) 안에서 4~5개 앱 마진을 확보하려는 값입니다. 필요하면 concrete Config 에서 `poolSize()` 로 override 해요
  - 전체 connection 은 대략 앱 수 × 5 예요. core 풀이 사라져 ADR-037 이전보다 여유가 큽니다
  - 각 Flyway 인스턴스가 자기 schema 만 migrate 해요. cross-schema FK 참조는 wiring 이 보장하지 않습니다
  - `init-app-schema.sql` 이 app role 에 `USAGE, CREATE ON SCHEMA` 를 줍니다. Flyway history 테이블 생성에 필요한 자기 schema 범위 DDL 권한이고, schema 간 격리는 유지돼요
- **재검토 트리거**:
  - DataSource 10개 초과 (bean context 부하) — AbstractRoutingDataSource 재고
  - Hot-swap DataSource 필요 — AbstractRoutingDataSource
  - 파생 레포에서 pool size 튜닝이 빈번해짐 — yml externalization 도입
  - 전체 pool 합이 Supabase pooler 한도에 근접 — `poolSize()` 를 더 낮추거나 Pro 전환
- **관련 문서**:
  - [`Architecture`](../../structure/architecture.md) — 멀티 DataSource Wiring 섹션
  - [`ADR-037`](../../philosophy/adr-037-core-schema-deprecation.md) — core schema 폐기와 fail-secure routing
  - `common/common-persistence/` — abstract 구현, `DEFAULT_POOL_SIZE`
  - `bootstrap/src/main/java/com/factory/bootstrap/config/RoutingDataSourceConfig.java` — `@Primary` routing 통합
  - `tools/app/new-app.sh` Step 13.5 — `<Slug>DataSourceConfig` 자동 생성

---

## 결정 I-09. 배포 — Kamal + Docker blue/green (Mac mini)

- **status**: `template-ready` (`config/deploy.yml`, `.github/workflows/deploy.yml`, `Dockerfile`, `docker-entrypoint.sh` 가 커밋돼 있어 파생레포가 env·Secrets 만 채우고 `kamal setup` 한 번이면 운영 진입)
- **결정일**: 2026-04-19
- **결정**: 운영 Spring 배포는 Kamal (37signals) 과 Docker, GitHub Actions 조합이에요. Mac mini 에서 컨테이너를 blue/green 으로 스왑하고, kamal-proxy 가 health check 통과 후 트래픽을 Green 으로 원자 전환합니다. GHA runner 는 Tailscale 로 tailnet 에 조인해 SSH 로 Mac mini 를 원격 제어해요.
- **근거**:
  - blue/green 무중단 배포가 검증된 툴이에요. 커스텀 bash 로 상태 기계를 재구현하는 비용을 피하고, 롤백이 `kamal rollback <version>` 한 줄이에요
  - 솔로 친화 ([`ADR-007`](../../philosophy/adr-007-solo-friendly-operations.md)) — `config/deploy.yml` 과 GHA workflow 두 파일이면 파이프라인이 끝나요. Jenkins 호스팅이나 플러그인 관리 부담이 0 입니다
  - 파생레포 재사용성 — template 이 placeholder 만 제공하면 파생레포는 env·Secrets 로 값을 주입해요. 배포 로직을 재작성하지 않습니다 ([`ADR-002`](../../philosophy/adr-002-use-this-template.md))
  - Tailscale 위에서 SSH 하므로 public webhook endpoint 나 HMAC 구현이 필요 없어요. tailnet ACL 이 authZ 를 대체합니다
- **대안**:

| 옵션 | 탈락 이유 |
|---|---|
| launchd + 커스텀 deploy.sh | blue/green 상태 기계, health check polling, rollback 구현 비용이 Kamal 학습 비용보다 큼 |
| Jenkins | 호스팅 머신과 플러그인 관리. 솔로 Phase 0 에 오버헤드 과대 |
| Watchtower · Portainer | blue/green 이 아닌 rolling restart 만 지원. 모놀리스 시점에 문제 |
| 커스텀 HTTPS webhook + deploy.sh | HMAC 서명·재시도·롤백을 모두 재구현 |

- **Trade-off**:
  - Kamal 학습에 2~3시간 스파이크가 필요해요
  - arm64 cross-compile 이 x86 runner 에서 느려요. 빌드가 4분을 넘으면 `builder.remote` 로 Mac mini 에 빌드를 넘기는 걸 검토합니다
  - Kamal 업그레이드 시 `config/deploy.yml` schema 변경 리스크가 있어요. 파생레포에 cherry-pick 이 필요합니다
  - kamal-proxy 는 nginx 를 대체해요. 복잡한 URL path rewrite 가 필요해지면 nginx 를 kamal-proxy 앞에 두는 식으로 확장합니다
- **재검토 트리거**:
  - 파생레포 2개 이상 동시 운영 — kamal-proxy 호스트명 매핑 한계 검토
  - GHA runner 가 1시간에 10회 이상 deploy 호출 — Mac mini 리소스 경쟁 우려
  - Kamal upstream 단종 또는 라이선스 변경
  - blue/green 스왑 실패로 다운타임 관측 — 원인 조사 후 롤백 전략 재점검
- **관련 문서**:
  - [`인프라`](./infrastructure.md) — 운영 구성도와 blue/green 설명
  - [`deployment`](./deployment.md) — 파생레포 onboarding
  - [`Runbook`](./runbook.md) — 배포·롤백·장애 대응 절차
  - `config/deploy.yml`, `.github/workflows/deploy.yml`, `Dockerfile`, `docker-entrypoint.sh`
  - `bootstrap/src/main/java/com/factory/bootstrap/MigrateOnlyRunner.java` — out-of-band migration 엔트리

---

## 결정 I-10. GHCR push — GITHUB_TOKEN 대신 PAT (GHCR_TOKEN)

- **status**: `template-ready`
- **결정일**: 2026-04-20
- **결정**: GHA 가 `ghcr.io` 로 docker 이미지를 push 할 때 `secrets.GITHUB_TOKEN` 대신 별도 PAT 를 씁니다. scope 는 `write:packages`, `read:packages`, `delete:packages`, `repo` 네 가지이고, `secrets.GHCR_TOKEN` 으로 등록해요. `docker/login-action`, `KAMAL_REGISTRY_PASSWORD`, `actions/delete-package-versions` 셋 다 이 PAT 를 사용합니다.
- **근거**:
  - 첫 GHCR 패키지 생성 시 repo 와 새 패키지의 자동 연결이 안 돼서, GITHUB_TOKEN 으로 push 하면 403 Forbidden 이 나요. 도그푸딩 시도에서 workflow permissions write 와 provenance·sbom 끄기를 둘 다 적용한 뒤에도 같은 403 이 떴고, PAT 만이 이를 해결했어요
  - `delete:packages` scope 는 이미지 2개 유지 cleanup step 에 필수예요
  - 매번 권한 정책을 토글하지 말고 PAT 하나로 통일하는 게 운영상 단순해요
- **대안**:
  - GITHUB_TOKEN + workflow permissions write — 첫 패키지 생성 후엔 동작한다는 보고가 있지만 일관성이 없어 탈락
  - OIDC + GHCR — GHCR 의 OIDC 가 packages scope 에선 불완전해서 탈락
  - Docker Hub 전환 — 외부 의존성 추가라 현 단계엔 불필요해서 탈락
- **Trade-off**:
  - PAT expiration 을 관리해야 해요 (90일 권장)
  - 노출 시 즉시 폐기하고 재발급해야 해요
- **재검토 트리거**:
  - GitHub 의 GHCR + GITHUB_TOKEN 권한 매핑 개선 발표
  - PAT expiration 자동화가 필요해짐 (3개월 주기 reminder 로 부족할 때)
- **관련 문서**:
  - [`dogfood-setup §3.1`](../../start/dogfood-setup.md) — PAT 발급 절차
  - [`키 교체 절차`](../setup/key-rotation.md) — rotation 정책
  - [`dogfood-pitfalls`](../../start/dogfood-pitfalls.md) — 403 함정 분석
  - 레포 루트 `.github/workflows/deploy.yml` — 사용 위치

---

## 결정 I-11. Dockerfile 이중 — runtime 전용 + 풀빌드 보존

- **status**: `template-ready`
- **결정일**: 2026-04-20
- **결정**: docker 이미지 빌드를 두 경로로 나눕니다.
  - `Dockerfile` (기존): multi-stage builder + runtime. 로컬 수동 `kamal deploy` (hotfix) 경로용으로 보존해요
  - `Dockerfile.runtime` (신규): JRE alpine 베이스에 미리 빌드된 `app.jar` 만 COPY. GHA deploy 가 빌드한 jar 를 받아 패키징합니다
- **근거**:
  - GHA 경로에서는 빌드 stage 가 없어 이미지 빌드가 약 30초로 짧아져요
  - 로컬에서 노트북으로 `kamal deploy` 를 직접 칠 때는 jar 가 미리 없으니 multi-stage 풀빌드가 필요해요. 기존 `Dockerfile` 을 그대로 둡니다
  - runtime 은 패키징만, builder 는 빌드와 패키징을 맡아 책임이 명확해요
- **대안**:
  - 단일 Dockerfile 에 `ARG SKIP_BUILD` 분기 — 한 파일 안 분기가 복잡하고 디버그가 어려워 탈락
  - runtime 만 두고 로컬 수동 폐기 — hotfix 시 GHA 를 우회 못 하면 위험해서 탈락
- **Trade-off**:
  - entrypoint 와 JRE 버전 같은 두 파일의 동기화 부담이 있어요. 양쪽 같은 베이스 이미지를 쓰도록 컨벤션화합니다
- **재검토 트리거**:
  - 로컬 수동 `kamal deploy` 가 한 분기 동안 0회 사용 — `Dockerfile` 폐기 검토
  - JRE 버전 업그레이드 시 두 파일 동시 수정을 누락
- **관련 문서**:
  - 레포 루트 `Dockerfile` — multi-stage 풀빌드 (`eclipse-temurin:21-jdk-alpine` → `21-jre-alpine`)
  - 레포 루트 `Dockerfile.runtime` — runtime 전용 (`eclipse-temurin:21-jre-alpine`)
  - [`dogfood-setup §5`](../../start/dogfood-setup.md) — GHA 자동 경로
  - [`Runbook`](./runbook.md) — 로컬 수동 배포 절차

---

## 결정 I-12. workflow_run 게이트 + jar artifact 패스

> **anchor 노트**: 본 결정의 원래 제목은 jar artifact 를 *전달* 하는 흐름을 가정했지만, 실제 구현은 artifact 를 쓰지 않아요 (아래 본문). 다른 결정이 이 anchor (`#결정-i-12-workflow_run-게이트--jar-artifact-패스`) 를 참조하므로 제목과 anchor 는 보존합니다.

- **status**: `template-ready`
- **결정일**: 2026-04-20
- **결정**: deploy workflow 는 `on: push: main` 이 아니라 `on: workflow_run` 으로, CI 가 main 에서 성공한 뒤 자동 시작합니다. deploy 는 해당 SHA 를 체크아웃해 `./gradlew bootstrap:bootJar -x test` 로 jar 를 직접 빌드하고, `Dockerfile.runtime` 으로 패키징해요. CI 와 deploy 사이에 jar artifact 를 전달하지 않습니다.
- **근거**:
  - artifact 를 쓰지 않는 이유 — `bootstrap-jar` 가 약 80MB 인데 main push 마다 누적되면 Actions storage 무료 한도 (500MB) 를 빠르게 소진해요. deploy 가 SHA 를 다시 체크아웃해 빌드하는 편이 storage 압박이 없어요
  - 명시적 CI→CD 게이트 — gate job 의 `if: workflow_run.conclusion == 'success'` 가 CI 실패 시 deploy 시작 자체를 막아요. 기존 구조는 docker build 안 컴파일 fail 에 기댄 우연한 차단이었어요
  - 수동 rollback 경로 — `workflow_dispatch.inputs.version` 으로 과거 SHA 를 재배포해요 (deploy job 이 그 SHA 에서 jar·이미지를 다시 빌드해 push 하므로 GHCR 에 옛 이미지가 남아 있을 필요는 없어요)
- **대안**:
  - 단일 workflow + jobs needs — PR 단계의 ci 와 main 의 deploy 가 한 파일에서 분기해 가독성이 떨어져 탈락
  - Self-hosted runner on Mac mini — runner agent 운영 부담과 격리성 손실로 탈락
  - jar artifact 전달 — upload/download 시간보다 storage 한도 소진이 더 큰 비용이라 탈락
- **Trade-off**:
  - deploy 가 jar 를 한 번 더 빌드해요. 다만 CI 는 테스트 포함 풀빌드, deploy 는 `-x test` 빌드라 성격이 달라요
  - workflow_run 의 함정 — CI 가 fail 이나 skipped 여도 trigger 자체는 발동하므로 gate 의 conclusion 체크가 필수예요
- **재검토 트리거**:
  - 빌드 시간이 길어져 CI 와 deploy 의 중복 빌드가 병목이 됨 — artifact 전달 또는 self-hosted runner 재검토
  - CI·deploy 분리가 디버그를 어렵게 만들면 단일 workflow 재검토
- **관련 문서**:
  - [`ci-cd-flow §6`](./ci-cd-flow.md) — workflow_run + deploy phase
  - 레포 루트 `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`
  - [`dogfood-pitfalls`](../../start/dogfood-pitfalls.md) — workflow_run 함정

---

## 결정 I-13. kamal deploy --skip-push + 직접 buildx push

- **status**: `template-ready`
- **결정일**: 2026-04-20
- **결정**: deploy workflow 가 `docker/build-push-action` 으로 GHCR 에 직접 push 한 뒤 `kamal deploy --skip-push --version=<sha> --verbose` 를 호출합니다. kamal 의 자체 빌드와 push 를 우회해요.
- **근거**:
  - kamal 의 docker build 는 또 gradle 빌드를 호출해요. 우리는 이미 `Dockerfile.runtime` 으로 패키징한 이미지를 push 해 둔 상태라, `--skip-push` 로 같은 작업의 반복을 막아요
  - `--version=<commit-sha>` 로 이미지 태그를 명시해 push 한 태그와 정확히 매치시킵니다
  - `docker/build-push-action` 은 provenance·sbom 토글, multi-platform, cache 가 검증된 GHA 표준이에요
- **대안**:
  - kamal 의 builder 사용 (`builder.arch: arm64` + `cache: type: gha`) — 위와 같은 중복 빌드로 탈락
  - 로컬 빌드 후 ssh scp — GHCR 를 활용 못 하고 blue/green 추적이 어려워 탈락
- **Trade-off**:
  - kamal 의 `service` label 이 자동 부여되지 않아서 `docker/build-push-action` 의 `labels` 로 명시해야 해요
  - kamal 의 이미지 검증 (label·architecture) 단계는 그대로 동작해요
  - kamal 업그레이드 시 `--skip-push` flag 호환성을 추적해야 해요
- **재검토 트리거**:
  - kamal 이 `--skip-push` 옵션을 deprecate
  - GHA cache 가 너무 커져 storage 한도를 위협
- **관련 문서**:
  - 레포 루트 `.github/workflows/deploy.yml` — `docker/build-push-action` + `kamal deploy --skip-push`
  - 레포 루트 `Dockerfile.runtime`
  - [`dogfood-pitfalls`](../../start/dogfood-pitfalls.md) — 이미지 경로·service label 함정
  - [kamal deploy 공식 문서](https://kamal-deploy.org/docs/commands/deploy/)

---

## 결정 I-14. Tailscale OAuth client — scope 2개 모두 필수

- **status**: `template-ready`
- **결정일**: 2026-04-20
- **결정**: GHA 가 ephemeral device 로 tailnet 에 join 하기 위한 OAuth client 를 발급할 때 scope 두 개를 모두 체크해야 합니다.
  - `Devices → Core → Write` (+ `tag:ci`)
  - `Keys → Auth Keys → Write` (+ `tag:ci`)

  ACL 의 `tagOwners` 에 `tag:ci` 정의가 선행돼야 하고, `tailscale/github-action@v4` 를 사용해요.
- **근거**:
  - `tailscale up --authkey=...` 흐름은 ephemeral auth key 발급 권한 (`Keys: Auth Keys: Write`) 과 device 등록 권한 (`Devices: Core: Write`) 을 둘 다 요구해요. 하나만 있으면 `403 calling actor does not have enough permissions` 가 나요
  - 도그푸딩 초기 시도에서 `Devices: Core: Write` 만 체크해 실패했고, 두 번째 scope 를 체크하지 않은 게 원인이었어요
  - `tailscale/github-action@v2` 는 옛 1.42.0 을 받아 신 OAuth API 와 호환되지 않아요. `@v4` 가 최신 stable 이에요
- **대안**:
  - 미리 발급한 ephemeral auth key 를 `auth-key` 로 직접 전달 — auth key 도 expiration·rotation 부담이 있어 OAuth client 가 더 깔끔해서 탈락
  - Self-hosted runner on Mac mini — Tailscale 자체가 불필요하지만 I-12 와 같은 이유로 탈락
- **Trade-off**:
  - OAuth client scope 변경 시 client 를 재발급해야 해요 (편집 불가)
  - 노출 시 즉시 폐기해야 해요
- **재검토 트리거**:
  - Tailscale 의 OAuth API 변경 (scope 이름 변경 등)
  - GHA runner 가 Tailscale 없이 Mac mini 에 도달하는 다른 경로 등장 (예: Cloudflare Tunnel SSH)
- **관련 문서**:
  - [`dogfood-setup §3.2`](../../start/dogfood-setup.md) — 발급 절차 (ACL HuJSON 포함)
  - [`dogfood-pitfalls`](../../start/dogfood-pitfalls.md) — Tailscale 함정 분석
  - [`키 교체 절차`](../setup/key-rotation.md) — rotation
  - [Tailscale OAuth clients 공식 문서](https://tailscale.com/kb/1215/oauth-clients)

---

## 재검토 트리거 요약 표

| 트리거 | 영향 결정 | 대응 |
|---|---|---|
| MAU 1K 이상 | I-01 Supabase | Free → Pro |
| MAU 5K 이상 | I-04 맥미니 | 클라우드 분산 이관 |
| 외부 개발자 합류 | I-03 NAS, I-05 Tunnel | Tailscale 또는 CF Tunnel 서비스 계정 |
| NAS 디스크 80% 초과 | I-03 MinIO | 증설 또는 Cloudflare R2 이관 |
| 집 ISP 업로드 10Mbps 미만 | I-03 MinIO, I-04 맥미니 | 클라우드 이관 |
| Supabase egress 2GB/월 초과 | I-01 Supabase | CDN 앞단 또는 Pro |
| 파생 레포 5개 이상 | I-07 bucket 분리 | 로컬 per-repo bucket |
| 맥미니 RAM 12GB 상시 초과 | I-06 관측성 | 스택 분리 (NAS) 또는 Grafana Cloud |
| 서비스 SLA 99.9% 이상 | I-04 맥미니 | 클라우드 이관 |
| Loki 디스크 사용 증가 관측 (retention 1년, 2026-07-21) | I-06 관측성 | retention 단축, 관리형 또는 클러스터링 |
| DataSource 10개 초과 | I-08 multi-DS | AbstractRoutingDataSource 재고 |
| 파생레포 2개 이상 동시 운영 | I-09 Kamal 배포 | 서브도메인별 host 매핑 분리 |
| blue/green 스왑 실패 관측 | I-09 Kamal 배포 | Kamal healthcheck 튜닝, nginx 앞단화 검토 |
| Kamal upstream 단종·라이선스 변경 | I-09 Kamal 배포 | 커스텀 bash 또는 Docker Swarm 이관 |
| GitHub PAT expiration 임박 (90일 주기) | I-10 GHCR_TOKEN | 새 PAT 발급 + setup 재실행 |
| GHCR storage 한도 임박 (500MB) | I-10, I-12 | image cleanup 강화 (keep-2 → keep-1) 또는 retention 단축 |
| `--skip-push` flag deprecation | I-13 | kamal build 활성화 또는 다른 deploy tool |
| Tailscale OAuth API scope 이름 변경 | I-14 | OAuth client 재발급 + 가이드 §3.2 갱신 |
| 로컬 수동 `kamal deploy` 0회/분기 | I-11 | `Dockerfile` 폐기, `Dockerfile.runtime` 만 유지 |

## 상태 진화 추적

각 결정의 status 변화는 이 문서를 편집할 때 결정일을 갱신하고, 변경 사유를 commit 메시지에 기록합니다. 주요 상태 전이는 다음과 같아요.

- `planned` → `hardware-acquired`: 물리 하드웨어 확보 (맥미니 구입 등)
- `planned` → `provisioned`: 서비스 계정 발급 + 기본 연결 테스트 완료
- `provisioned` → `in-prod`: 실제 트래픽 처리 (첫 유저 가입 등)
- 어느 상태 → `deprecated`: 대체 수단 확정 + 이관 시작

## 관련 문서

- [`Repository Philosophy — 책 안내`](../../philosophy/README.md) — 코드 설계 결정 39개 ADR
- [`인프라 (Infrastructure)`](./infrastructure.md) — 인프라 현재 상태와 구성도
- [`오브젝트 스토리지 규약`](../../api-and-functional/functional/storage.md) — 2-tier bucket 상세 규약
- [`Observability 규약`](../../api-and-functional/functional/observability.md) — 관측성 규약
- [`Edge Cases & Risk Analysis`](../../reference/edge-cases.md) — 리스크 시나리오 분석
- Item Ops-1 (예정) — 운영 배포 구현
