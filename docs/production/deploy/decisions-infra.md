# 인프라 결정 기록 (Decisions — Infrastructure)

물리/운영 인프라 선택의 결정·근거·대안·재검토 트리거를 추적합니다.

## 이 문서의 역할 (philosophy/ 와의 구분)

| 문서 | 범위 |
|---|---|
| [Repository Philosophy — 책 안내](../../philosophy/README.md) | **코드 설계 결정 (16 ADR)** — 모듈 구조, 포트/어댑터, Mapper 금지, 테스트 전략 등 |
| **`decisions-infra.md`** (이 문서) | **물리/운영 인프라 결정** — DB, 오브젝트 스토리지, 운영 호스트, 엣지, 관측성 |

경계 케이스 (예: 서비스별 schema — 코드 규약이자 인프라 결정) 는 양쪽에서 상호 참조합니다.

## 결정 카드 필드 포맷

각 결정은 다음 8개 필드를 채웁니다:

- **status**: `planned` / `provisioned` / `in-prod` / `hardware-acquired`
- **결정일**: YYYY-MM-DD
- **결정**: 한 줄 요약
- **근거**: 왜 이 선택인가
- **대안**: 고려한 다른 선택지들
- **Trade-off**: 감수하는 비용
- **재검토 트리거**: 어떤 지표/이벤트가 넘으면 다시 볼지
- **관련 문서**: 링크

## 결정 간 충돌 해결 규칙 (Phase 0 기준)

결정이 서로 충돌할 때 우선순위:

1. **솔로 친화** ([ADR-007](../../philosophy/adr-007-solo-friendly-operations.md)) — 운영 부담 < 기능 완성도
2. **보안 최소 기준** — 시크릿 분리, JWT, TLS (edge)
3. **파생 레포 일관성** — breaking 변경은 Item 단위로 묶어서 일괄
4. **비용** — 클라우드 무료티어 > 유료, 셀프 호스트 > SaaS (Phase 0)

Phase 1+ 에는 우선순위 재조정 (예: 보안 기준 상향).

---

## 결정 I-01. Postgres provider — Supabase (template 관리자 default, 교체 가능)

- **status**: template 자체는 provider-agnostic. template 관리자 본인의 운영 배포는 Supabase `provisioned`.
- **결정일**: 2026-04-18 (Supabase 선택), 2026-04-20 (multi-provider 지원 명시)
- **Template 의 요구사항**: 표준 JDBC Postgres 인스턴스 하나. `DB_URL` / `DB_USER` / `DB_PASSWORD` + `DATABASE_URL` (admin, `new-app.sh --provision-db` 용) 만 있으면 됨. 코드는 HikariCP + 표준 JDBC 만 사용 — provider 특화 API (Supabase Realtime/RLS/auth.users 등) 미의존.
- **Template 관리자 default**: **Supabase** (aws-1-ap-northeast-2 Supavisor pooler). 파생레포는 이 default 그대로 써도 되고, 다른 provider 로 교체 가능.
- **Supabase 를 default 로 고른 근거** (template 관리자 본인 기준):
  - 관리형 Postgres — 백업/스케일/보안패치 대행
  - Supabase 대시보드/CLI — 솔로 운영 편의
  - Free tier (500MB DB, 2GB egress) — Phase 0 충분
  - Seoul region — 한국 유저 타겟에 지연 최소
  - Supavisor pooler — blue/green 배포 overlap 구간의 connection 폭증 완충
- **교체 가능한 옵션** (파생레포 소유자 선택):
  - **AWS RDS** — 유연, VPC 통합. 관리 오버헤드 + 초기 월 $15+. `:5432` direct.
  - **Fly.io Postgres** — 앱 근접 배포, 글로벌 edge. 관리 UI 빈약. `.flycast` endpoint.
  - **self-host Postgres** — 완전 통제, 비용 0. 백업/SPOF 부담 ↑.
  - **Neon** — branching DB 훌륭. Seoul region 부재 → latency ↑.
  - Provider 교체 시 코드/Flyway 수정 0 — `.env` 의 `DB_URL` / `DB_USER` / `DB_PASSWORD` 만 바뀜.
- **Trade-off** (Supabase 사용 시):
  - Free tier 7일 비활성 → pause — `keep-alive.sh` cron 또는 Pro 업그레이드 필요
  - IPv6 이슈 경험 — pooler 경유로 우회 중
  - Vendor lock-in — 표준 Postgres 기능만 쓰면 이관 용이. Supabase 전용 기능 (Realtime, Edge Functions) 사용 시 고착
- **재검토 트리거**:
  - MAU 1K 이상 → Supabase Pro 전환 ($25/월) 검토 or 다른 provider 로 교체
  - 월 egress 2GB 초과 → CDN 앞단화 or Pro
  - 쿼리 성능 이슈 → 전용 DB (RDS) 검토
  - Supabase 가격 정책 변경
  - 파생레포 소유자가 이미 보유한 Postgres 인프라 (회사 RDS 등) 재사용하고 싶을 때
- **관련 문서**:
  - `infrastructure.md §2, §10` — 현재 상태, 연결 방식
  - `../journey/onboarding.md §4.5` — 운영 DB provider 선택 가이드 (provider 별 connection string + 준비 체크리스트)
  - `infra/scripts/keep-alive.sh` — Supabase Free tier 7일 pause 방지 (Supabase 이외 provider 는 불요)

---

## 결정 I-02. 서비스별 schema (ADR-005 인프라 측면)

- **status**: `provisioned`
- **결정일**: Phase 0 초기 (ADR-005 정의 시점)
- **결정**: 단일 Postgres DB 에서 **앱별 schema 로 분리** (`core`, `<slug>`). `core` 는 공통 (users, auth 등), 앱별 schema 는 도메인 테이블.
- **근거**: [ADR-005 (단일 Postgres + 앱당 schema)](../../philosophy/adr-005-db-schema-isolation.md) 에 정의. 솔로 운영에서 DB 인스턴스 N개 관리 부담 회피.
- **대안**: DB 분리, 단일 schema, 단일 테이블 + tenant_id
- **Trade-off**:
  - schema 경계 실수 위험 (FK cross-schema 사용 시 cascade 영향) — `search_path` + 앱별 DB user 로 완화
  - 단일 DB 용량 한계 (Supabase Free 500MB) → 재검토 트리거에 포함
- **재검토 트리거**:
  - 앱당 DB 용량 > 200MB (5앱 = 1GB 초과 예상) → DB 분리 검토
  - 앱 격리 요구 상승 (컴플라이언스 등)
- **관련 문서**:
  - [ADR-005](../../philosophy/adr-005-db-schema-isolation.md)
  - `infra/scripts/init-core-schema.sql`, `init-app-schema.sql`
  - `tools/new-app/new-app.sh` (앱 schema 는 수동, Item 10 에서 자동화)

---

## 결정 I-03. 오브젝트 스토리지 — NAS MinIO (LAN-only)

- **status**: `provisioned` (template 관리자 LAN 내부에서만 접근)
- **결정일**: 2026-04-18
- **결정**: 오브젝트 스토리지는 시놀로지 NAS 의 MinIO 컨테이너 (`192.168.X.X:9000`). S3 호환이라 추후 AWS S3 / Cloudflare R2 이관 시 endpoint 변경만으로 가능. 외부 네트워크 접근 방식은 **Item Ops-1** 에서 결정.
- **근거**:
  - 보유 NAS 활용 — 추가 호스팅비 0
  - S3 호환 — 클라우드 이관 유연성
  - LAN 대역폭 — 이미지 업로드/썸네일 처리 빠름
  - `BucketProvisioner` 가 부팅 시 bucket 자동 생성 → 수동 운영 최소
- **대안**:
  - **AWS S3** — 안정적, 글로벌, but 업로드량↑ 시 비용
  - **Cloudflare R2** — egress 무료, S3 호환 (Phase 1+ 전환 1순위)
  - **Backblaze B2** — 저가 but 대역폭 제한
  - **self-host MinIO on 맥미니** — NAS 에 디스크 여유 많음 → NAS 우선
- **Trade-off**:
  - **LAN-only** — 외부 개발자 접근 불가. `onboarding.md` 에서 명시 + 파생 레포는 자체 MinIO 또는 로컬 docker 사용 권고
  - NAS 단일 장애점 — RAID + Snapshot Replication 으로 완화 (storage.md 참조)
  - 외부 노출 시 대역폭 병목 (향후 집 인터넷 업로드 속도)
- **재검토 트리거**:
  - 외부 개발자 합류 → Tailscale / Cloudflare Tunnel (Item Ops-1)
  - NAS 디스크 사용량 > 80% → 증설 or R2 이관
  - 집 인터넷 업로드 < 10 Mbps (업로드 병목)
  - 파생 레포 5+ → 공용 인프라 분리 검토
- **관련 문서**:
  - `infrastructure.md §4`
  - `features/storage.md` — 2-tier bucket 정책 (I-07)
  - `onboarding.md` — LAN 한계 명시

---

## 결정 I-04. 운영 호스트 — 맥미니 16GB (홈 서버)

- **status**: `hardware-acquired` (물리 보유 / 네트워크·배포 셋업은 Item Ops-1)
- **결정일**: 2026-04-18
- **결정**: 운영 단일 호스트로 **Apple Silicon 맥미니 16GB** 사용. 집 가정 내 설치.
- **근거**:
  - 전기세 ~$4/월 (클라우드 VM $20+ 대비)
  - M4 16GB ≈ AWS t4g.xlarge 급 성능
  - 발열/소음 낮음 — 가정 상시 운영 가능
  - SSH + launchd 친숙 (맥OS 환경)
  - Time Machine 자동 백업 (edge-cases 3-1 완화)
- **대안**:
  - **AWS EC2 t4g.xlarge** — 안정적, 확장 쉬움, 월 $25+
  - **Fly.io** — 글로벌 edge 배포, 월 $10+
  - **오라클 클라우드 Free** — 무료 but 계정 정지 리스크
  - **Raspberry Pi 5** — 전력 ↓ but 성능/메모리 부족
- **Trade-off**:
  - **SPOF** — 고장 시 서비스 중단 (edge-cases 3-1 참고, 복구 1~2시간 주장)
  - 집 ISP 장애 = 서비스 중단 (SLA 없음)
  - 초기 하드웨어 비용 ~100만원 → 1년 뒤 클라우드 대비 break-even
  - 물리 도난/화재 위험 — 외부 백업 (NAS or Cloudflare R2) 필수
- **재검토 트리거**:
  - MAU 5K 이상 → 클라우드 분산 검토
  - 집 ISP 장애 월 2회 이상
  - 서비스 SLA 99.9%+ 요구 → 클라우드 이관
- **관련 문서**:
  - `infrastructure.md §4` — 구성도
  - `edge-cases.md 3-1` — 고장 복구 시나리오
  - Item Ops-1 — 배포 메커니즘 (launchd / systemd)

---

## 결정 I-05. 외부 접근 — Cloudflare Tunnel (`planned`)

- **status**: `planned` (Item Ops-1)
- **결정일**: 2026-04-18 (계획 확정)
- **결정**: 운영 외부 접근은 **Cloudflare Tunnel** (`cloudflared`) 경유. 공개 IP 노출 없이 홈 네트워크 ↔ 인터넷 연결. TLS/WAF/Rate limit 은 Cloudflare edge 에서 처리.
- **근거**:
  - **홈 IP 노출 안 함** — 보안 상 중요
  - TLS 인증서 자동 발급/갱신
  - WAF/DDoS/Rate limit edge 처리 → 맥미니 부담 ↓
  - 무료 (Cloudflare Free 플랜 포함)
  - 호스트명 기반 ingress 규칙 — 멀티앱 지원 (`sumtally.*.com → :8081`, `rny.*.com → :8082`)
- **대안**:
  - **DDNS + 포트포워딩** — 무료 but 홈 IP 노출, 보안 위험
  - **Tailscale** — VPN 방식, 개발자 간 쉬움 but 엔드유저 공개 접근 어려움
  - **Nginx + Let's Encrypt** — edge 기능 모두 직접 구축
  - **AWS ALB + CloudFront** — 복잡도 과도, 맥미니 직접 연결 불가
- **Trade-off**:
  - Cloudflare 의존 (vendor lock-in) — 터널 서비스 중단 = 서비스 접근 불가
  - cloudflared 프로세스 관리 필요 (launchd 등록)
  - 초기 설정 학습 (tunnel create, ingress rules, DNS records)
- **재검토 트리거**:
  - Cloudflare Free 정책 변경
  - 글로벌 edge 가속 요구 (더 전문 CDN 필요)
  - Tunnel 장애 월 2회 이상
- **관련 문서**:
  - Item Ops-1 — 실제 셋업
  - `infrastructure.md §4` — 운영 구성도 (planned 박스)

---

## 결정 I-06. 관측성 스택 — 셀프 호스트 (Loki + Grafana + Prometheus)

- **status**: `provisioned` (운영 `infra/docker-compose.observability.yml` 파일 준비 완료; 실제 기동은 파생레포 onboarding 시 Mac mini 에서)
- **결정일**: Item 5 (Phase A~M). **2026-04-19 범위 재조정** — 로컬 dev 에서 제거, 운영 전용으로 한정.
- **결정**: 로그/메트릭/대시보드/알림 스택은 **셀프 호스트 오픈소스** — Loki, Grafana, Prometheus, Alertmanager. **운영(Mac mini) 전용** 구성. 로컬 개발에서는 활용 빈도 대비 메모리/docker 부담이 크므로 기동하지 않는다 (대시보드 동작 확인은 운영 `log.<domain>` 에서).
- **근거**:
  - 데이터 주권 — 유저 로그/메트릭이 외부 SaaS 로 나가지 않음
  - 비용 0 (맥미니에 같이 기동)
  - 파생 레포에 compose 파일 그대로 전파
  - 각 도구 공식 문서 + 활발한 커뮤니티
  - LogQL/PromQL — 표준 (이관 쉬움)
- **대안**:
  - **Grafana Cloud** — Free tier 있으나 로그 retention 14일 제한
  - **Datadog** — 강력 but 월 $31+/host (APM)
  - **ELK stack** — Java 기반, 무거움 (JVM 메모리 경합)
  - **New Relic / Dynatrace** — 유료
- **Trade-off**:
  - 셀프 호스트 운영 부담 — retention 설정, 디스크 관리, 업그레이드
  - 맥미니 메모리 ~1.5GB RAM 상시 소비
  - LogQL/PromQL 학습 곡선
- **재검토 트리거**:
  - 맥미니 메모리 > 12GB 상시 사용 → 관측성 분리 (NAS?)
  - 로그 retention 요구 > 30일 → 단일 인스턴스 Loki 부담
  - 팀 3명+ → 관리형 (Grafana Cloud Pro)
- **관련 문서**:
  - `features/observability.md`
  - `guides/monitoring-setup.md`
  - `infra/docker-compose.dev.yml`
  - Item Ops-1 — 알림 종류/임계치 정의

---

## 결정 I-07. 오브젝트 스토리지 Bucket — 2-tier 분리

- **status**:
  - 로컬 (`dev-shared`): `provisioned`
  - 운영 (`{slug}-{category}`): `planned` (Item Ops-1 에서 앱별 bucket 생성)
- **결정일**: 2026-04-18 (Item 7 작업 중)
- **결정**: 오브젝트 저장소는 2-tier 로 환경 분리. 코드는 env 무관, `.env` 의 bucket 이름만 스위치:
  - **로컬 dev**: `dev-shared` 단일 bucket (여러 파생 레포 공유)
  - **운영**: `{appSlug}-{category}` per-app (예: `sumtally-receipts`, `rny-avatars`)
  - **Key 패턴 (환경 무관)**: `{appSlug}/{category}/{yyyy}/{MM}/{dd}/{userId}/{uuid}.{ext}`
- **근거**:
  - **로컬**: wipe 자유 (`mc rb --force dev-shared`), 파생 레포 동시 개발 지원
  - **운영**: 앱별 lifecycle/retention/권한 분리, 서비스 철수 시 bucket 삭제로 정리
  - **코드 env 무관**: Spring 은 bucket 이름만 읽음, key 생성은 항상 동일
  - **`BucketProvisioner` 자동 생성** — `.env` 에 이름 추가 후 재기동만으로 provisioning
- **대안**:
  - **단일 bucket + key prefix** — IAM 정책 복잡, lifecycle 통짜 적용
  - **환경 × 앱 full cartesian** (`dev-sumtally-*`, `prod-sumtally-*`) — bucket 수 폭발
  - **prod 에 appSlug key prefix 제거** — 환경별 code 분기 필요, 이관 비용 ↑
- **Trade-off**:
  - 운영 bucket 내부 key 에 appSlug 가 redundant (`sumtally-receipts/sumtally/...`) — 일관성 우선
  - 로컬 `dev-shared` wipe 시 모든 파생 레포 dev 데이터 영향
- **재검토 트리거**:
  - 파생 레포 5+ → 로컬 분리 검토 (`dev-{slug}-shared`)
  - 운영 bucket 수 20+ → IAM 관리 부담
  - S3 (AWS/R2) 이관 시점 — 해당 provider 의 bucket 네이밍 제한 확인
- **관련 문서**:
  - `features/storage.md` — 상세 규약
  - `infrastructure.md §4`
  - `core/core-storage-impl/` — `BucketProvisioner`, `MinIOStorageAdapter`

---

## 결정 I-08. Multi-DataSource — 앱 모듈 자기 제공 패턴

- **status**: `provisioned` (Item 10b 구현 완료)
- **결정일**: 2026-04-19
- **결정**: 각 앱 모듈이 `AbstractAppDataSourceConfig` (common-persistence) 를 extends 한 `<Slug>DataSourceConfig` 를 소유. Template 은 abstract + `new-app.sh` 자동 생성 로직만 제공. Bootstrap 은 `CoreDataSourceConfig` 를 `@Primary` 로 선언하여 core schema 와 app schema 공존.
- **근거**:
  - [ADR-003 (core -api/-impl 분리)](../../philosophy/adr-003-api-impl-split.md) 정신 일치 — 앱이 자기 infra 책임
  - 파생 레포가 template bootstrap 수정 불필요 → cherry-pick 충돌 회피
  - Spring Boot 의 `@ConditionalOnMissingBean(AbstractEntityManagerFactoryBean.class)` back-off 문제는 `CoreDataSourceConfig` 의 명시적 `@Primary` 선언으로 해결 (canonical Spring 공식 multi-DS 패턴)
  - `new-app.sh` 자동 생성으로 boilerplate 부담 제거
- **대안**:
  - Bootstrap 중앙 집중 (yml map + AbstractRoutingDataSource) — 파생 레포가 template 수정해야 함, 런타임 분기 복잡도 ↑
  - Spring Boot auto-config 유지 — app DataSource 추가 시 silent back-off 로 부팅 실패
- **Trade-off**:
  - 앱 당 Config 파일 1개 (자동 생성이라 실제 부담 0)
  - 같은 Repository 가 여러 EMF 에 scan → Spring Data JPA 의 bean name 구분 의존
  - HikariCP pool size 는 `DEFAULT_POOL_SIZE=10` 하드코딩 (Phase 0 기본값, 필요 시 concrete 에서 `poolSize()` override)
  - Connection 총량 = (N 앱 × 10) + 10(core) — 5 앱 = 60 connections. Supabase Free tier pooler 제한 유의
  - 각 Flyway 인스턴스가 자기 schema 만 migrate — cross-schema FK 참조는 wiring 보장 안 함
  - `init-app-schema.sql` 이 app role 에 `USAGE, CREATE ON SCHEMA` 부여 (Flyway history table 생성 필수) — 자기 schema 범위 DDL 권한 허용 (schema 간 격리는 유지)
  - `QueryDslAutoConfiguration.jpaQueryFactory` 는 `@Primary` core EMF 에 바인딩 — 앱별 QueryDsl 은 각 `<Slug>DataSourceConfig` 에 별도 빈 선언 필요 (Javadoc 참조)
- **재검토 트리거**:
  - DataSource 수 > 10 (bean context 부하) → AbstractRoutingDataSource 재고
  - Hot-swap DataSource 필요 → AbstractRoutingDataSource
  - HikariCP pool size 튜닝이 파생 레포에서 빈번 → yml externalization 도입
  - 전체 pool 합이 Supabase pooler limit 접근 → `poolSize()` override 로 5 로 낮추거나 Pro 전환
- **관련 문서**:
  - `../journey/architecture.md` (Multi-DataSource Wiring 섹션)
  - `common/common-persistence/` (abstract 구현)
  - `bootstrap/src/main/java/com/factory/bootstrap/config/CoreDataSourceConfig.java` (@Primary core 선언)
  - `tools/new-app/new-app.sh` Step 13.5 (Config 자동 생성)

---

## 결정 I-09. 배포 — Kamal + Docker blue/green (Mac mini)

- **status**: `template-ready` (template 에 `config/deploy.yml`, `.github/workflows/deploy.yml`, `Dockerfile`, `docker-entrypoint.sh` 커밋됨. 파생레포가 env/Secrets 채우고 `kamal setup` 한 번 실행하면 운영 진입)
- **결정일**: 2026-04-19
- **결정**: 운영 Spring 배포는 **Kamal (37signals) + Docker + GHA** 조합. Mac mini 에서 blue/green 컨테이너 스왑, kamal-proxy 가 health check 통과 후 트래픽을 Green 으로 원자 전환. GHA runner 가 Tailscale 로 tailnet 조인 → SSH → Kamal 로 Mac mini 원격 제어.
- **근거**:
  - **Blue/green 무중단 배포가 검증된 툴** — 커스텀 bash 로 상태 기계 재구현 비용 회피. 롤백이 `kamal rollback <version>` 한 줄.
  - **솔로 친화** ([ADR-007](../../philosophy/adr-007-solo-friendly-operations.md)) — `config/deploy.yml` + GHA workflow 두 파일이면 배포 파이프라인 끝. Jenkins 호스팅/플러그인 관리 부담 0.
  - **파생레포 재사용성** — template 이 deploy.yml placeholder 만 제공하면 파생레포는 env/Secrets 로 값 주입. 새 파생레포마다 배포 로직 재작성 불필요 ([ADR-002](../../philosophy/adr-002-use-this-template.md)).
  - **Tailscale 위에서 SSH** — public webhook endpoint / HMAC 구현 불필요. tailnet ACL 이 authZ 대체.
- **대안**:
  - **launchd + 커스텀 deploy.sh** — Spring JAR 을 native JVM 으로 launchd 관리, bash 로 blue/green 로직 직접. 탈락: blue/green 상태 기계, health check polling, rollback 구현 비용이 Kamal 학습 비용보다 큼.
  - **Jenkins** — Jenkins 호스팅 머신 별도 + 플러그인/업데이트 관리. 탈락: 솔로 Phase 0 오버헤드 과대.
  - **Watchtower / Portainer** — 컨테이너 자동 업데이트. 탈락: blue/green 이 아닌 rolling restart 만 지원 (앱 10개 모놀리스 시점에 문제).
  - **커스텀 HTTPS webhook + deploy.sh** — 기존 moojigae 패턴. 탈락: HMAC 서명, 재시도, 롤백 모두 재구현.
- **Trade-off**:
  - Kamal 학습 곡선 — 2~3 시간 스파이크 필요.
  - GHA minutes 소비 — arm64 cross-compile 이 x86 runner 에서 느림. 빌드 시간 > 4분 되면 `builder.remote` 로 Mac mini 에 빌드 전가 검토.
  - Kamal 업그레이드 시 `config/deploy.yml` schema 변경 리스크. 파생레포에 cherry-pick 필요.
  - kamal-proxy 는 nginx 대체 — 파생레포가 URL path rewrite 같은 복잡한 라우팅 필요해지면 nginx 를 kamal-proxy 앞에 두는 식으로 확장 필요.
- **재검토 트리거**:
  - 파생레포 2개 이상 동시 운영 → kamal-proxy 의 호스트명 매핑 한계 검토
  - GHA runner 가 1시간에 10회 이상 deploy 호출 → Mac mini 리소스 경쟁 우려
  - Kamal upstream 이 단종되거나 라이선스 변경
  - 배포 중 다운타임 관측 (blue/green 스왑 실패) → 원인 조사 후 롤백 전략 재점검
- **관련 문서**:
  - `../infra/infrastructure.md §4, §4.2` — 운영 구성도, blue/green 설명
  - `../journey/deployment.md` — 파생레포 onboarding
  - `../infra/runbook.md` — 배포/롤백/장애 대응 절차
  - `config/deploy.yml`, `.github/workflows/deploy.yml`, `Dockerfile`, `docker-entrypoint.sh`
  - `bootstrap/src/main/java/com/factory/bootstrap/MigrateOnlyRunner.java` — out-of-band migration 엔트리

---

## 결정 I-10. GHCR push — `GITHUB_TOKEN` 대신 PAT (`GHCR_TOKEN`)

- **status**: `template-ready`
- **결정일**: 2026-04-20
- **결정**: GHA 가 `ghcr.io` 로 docker 이미지 push 할 때 `secrets.GITHUB_TOKEN` 이 아닌 **별도 PAT (Personal Access Token Classic, scope `write:packages` + `read:packages` + `delete:packages` + `repo`)** 을 `secrets.GHCR_TOKEN` 으로 등록해서 사용. `docker/login-action` + `KAMAL_REGISTRY_PASSWORD` env + `actions/delete-package-versions` 셋 모두 PAT 사용.
- **근거**:
  - **첫 GHCR 패키지 생성 시 권한 매핑 이슈** — repo 와 새 패키지의 자동 연결이 안 되어 GITHUB_TOKEN 으로 push 하면 403 Forbidden. 11회 도그푸딩 시도 중 #5 (workflow permissions write) + #6 (provenance/sbom 끄기) 둘 다 적용 후에도 같은 403 → PAT 만이 해결.
  - **delete:packages scope** 는 cleanup step (image 2개 유지 정책) 에 필수.
  - **operational simplicity** — 매번 권한 정책 토글하지 말고 PAT 하나로 통일.
- **대안**:
  - **GITHUB_TOKEN + workflow permissions write** — 첫 패키지 생성 후엔 동작할 수 있다는 보고 있으나 일관성 없음. 탈락.
  - **OIDC + GHCR** — GitHub OIDC 토큰으로 ghcr 인증. 탈락: 본 GHCR 의 OIDC 지원이 packages scope 에선 불완전.
  - **Docker Hub 전환** — 한도 더 넉넉하지만 외부 의존성 추가. 탈락 (현 단계 불필요).
- **Trade-off**:
  - PAT expiration 관리 부담 (90일 권장).
  - 노출 시 즉시 폐기 + 재발급 필요 (`docs/infra/key-rotation.md` 참조).
- **재검토 트리거**:
  - GitHub 의 GHCR + GITHUB_TOKEN 권한 매핑 개선 발표
  - PAT expiration 관리 자동화 필요해짐 (3개월 주기 reminder 만으론 부족)
- **관련 문서**:
  - `../journey/dogfood-setup.md §3.1` — PAT 발급 절차
  - `../infra/key-rotation.md` — rotation 정책
  - `../journey/dogfood-pitfalls.md #5 ~ #7` — 403 함정 분석
  - `../../.github/workflows/deploy.yml` — 사용 위치

---

## 결정 I-11. Dockerfile 이중 — runtime 전용 + 풀빌드 보존

- **status**: `template-ready`
- **결정일**: 2026-04-20
- **결정**: docker 이미지 빌드를 두 경로로 분리:
  - **`Dockerfile`** (기존): multi-stage builder + runtime. 로컬 수동 `kamal deploy` (hotfix) 경로용. 보존.
  - **`Dockerfile.runtime`** (신규): JRE alpine + 미리 빌드된 `./app.jar` COPY 만. GHA deploy.yml 이 CI 의 jar artifact 받아서 이걸로 패키징.
- **근거**:
  - **GHA 경로의 gradle 중복 빌드 제거** ([I-12](#결정-i-12-workflow_run-게이트--jar-artifact-패스)) — runtime Dockerfile 은 빌드 stage 가 없어 이미지 빌드가 ~30초로 단축.
  - **로컬 수동 경로 보존** — 개발자가 노트북에서 `kamal deploy` 직접 칠 때 jar 가 미리 없으니 multi-stage 풀빌드가 필요. 기존 `Dockerfile` 그대로 둠.
  - **두 경로 분리로 책임 명확** — runtime 은 패키징만, builder 는 빌드 + 패키징.
- **대안**:
  - **단일 Dockerfile 에 ARG 분기** — `ARG SKIP_BUILD=false` 로 build stage skip. 탈락: 한 파일 안에서 분기가 복잡, 디버그 어려움.
  - **runtime 만 두고 로컬 수동 폐기** — 모든 배포를 GHA 강제. 탈락: hotfix 시 GHA 우회 못 하면 위험.
- **Trade-off**:
  - 두 파일 동기화 부담 (entrypoint, JRE 버전 등). 양쪽 같은 베이스 이미지 사용하도록 컨벤션.
- **재검토 트리거**:
  - 로컬 수동 `kamal deploy` 가 한 분기 동안 0회 사용 → `Dockerfile` 폐기 검토
  - JRE 버전 업그레이드 시 두 파일 동시 수정 누락 발생
- **관련 문서**:
  - `../../Dockerfile` — multi-stage 풀빌드
  - `../../Dockerfile.runtime` — runtime 전용
  - `../journey/dogfood-setup.md §5` — GHA 자동 경로
  - `../infra/runbook.md` — 로컬 수동 배포 절차

---

## 결정 I-12. workflow_run 게이트 + jar artifact 패스

- **status**: `template-ready`
- **결정일**: 2026-04-20
- **결정**: deploy workflow 가 `on: push: main` 이 아닌 **`on: workflow_run` (CI 완료 후)** 로 트리거. CI 가 `bootstrap-jar` artifact 업로드 → deploy 가 `actions/download-artifact@v4` (run-id 지정) 로 다운로드 → `Dockerfile.runtime` 로 패키징.
- **근거**:
  - **gradle 중복 빌드 제거** — 기존 구조: ci.yml gradle build (5분, 테스트) + deploy.yml 의 docker build 안 gradle build (5분, 테스트 skip) 가 병렬 → wall-clock 8분, billed 13분. 변경 후: gradle build 1회 (CI) + 패키징만 (deploy) → billed ~8분 (38% 절약).
  - **명시적 CI→CD 게이트** — gate job 의 `if: workflow_run.conclusion == 'success'` 로 CI fail 시 deploy 시작 자체 안 함. 기존 구조는 docker build 안 컴파일 fail 에 의존하는 우연한 차단.
  - **수동 rollback 경로** — `workflow_dispatch.inputs.version` 으로 과거 SHA 재배포 (해당 이미지가 GHCR 에 살아있어야).
- **대안**:
  - **단일 workflow + jobs needs** — ci/deploy 합치고 `jobs.deploy.needs: build`. 탈락: PR 단계의 ci 와 main 의 deploy 가 같은 파일에서 분기 — 가독성 저하.
  - **Self-hosted runner on Mac mini** — runner 가 Mac mini 자체에서 도니 jar 패스 불필요. 탈락: runner agent 운영 부담 + 격리성 손실.
- **Trade-off**:
  - artifact 업로드/다운로드 시간 (~30초). 직렬 실행이라 wall-clock 동일하지만 1단계 추가.
  - workflow_run 트리거의 한 함정: CI 가 fail/skipped 여도 trigger 자체는 발동, gate 의 conclusion 체크 필수.
- **재검토 트리거**:
  - artifact storage 한도 임박 (500MB) → retention 줄이기 또는 다른 방식
  - CI / deploy 분리가 디버그 어려움 만들면 단일 workflow 재검토
- **관련 문서**:
  - `../infra/ci-cd-flow.md §6` — workflow_run + deploy phase
  - `../../.github/workflows/ci.yml`, `../../.github/workflows/deploy.yml`
  - `../journey/dogfood-pitfalls.md #1, #2` — artifact 함정

---

## 결정 I-13. `kamal deploy --skip-push` + 직접 buildx push

- **status**: `template-ready`
- **결정일**: 2026-04-20
- **결정**: deploy workflow 가 `docker/build-push-action` 으로 직접 GHCR 에 push 한 뒤 `kamal deploy --skip-push --version=<sha> --verbose` 호출. kamal 의 자체 빌드 / push 우회.
- **근거**:
  - **kamal 의 docker build 가 또 gradle 빌드를 부름** — 우리는 이미 CI artifact 의 jar 를 받아 Dockerfile.runtime 으로 패키징했음. kamal 이 같은 작업 반복 안 하도록 `--skip-push`.
  - **이미지 태그 일치 보장** — `--version=<commit-sha>` 로 명시. CI 의 `${{ github.sha }}` 로 push 한 태그와 정확히 매치.
  - **`docker/build-push-action` 의 안정성** — provenance/sbom 토글, multi-platform, cache 등 검증된 GHA 표준.
- **대안**:
  - **kamal 의 builder 사용** — config/deploy.yml 의 `builder.arch: arm64` + `cache: type: gha`. 탈락: 위와 같은 중복 빌드.
  - **로컬 빌드 → ssh scp** — Mac mini 에 직접 image 보내기. 탈락: GHCR registry 활용 못 함, blue/green 추적 어려움.
- **Trade-off**:
  - kamal 의 `service` label 이 자동 부여 안 됨 → `docker/build-push-action` 의 `labels: service=...` 필요.
  - kamal 이 image 검증 (label/architecture) 단계는 그대로 동작.
  - kamal upgrade 시 `--skip-push` flag 호환성 추적 필요.
- **재검토 트리거**:
  - kamal 이 `--skip-push` 옵션 deprecation
  - GHA cache 가 너무 커져 storage 한도 위협
- **관련 문서**:
  - `../../.github/workflows/deploy.yml` — `docker/build-push-action` + `kamal deploy --skip-push`
  - `../../Dockerfile.runtime`
  - `../journey/dogfood-pitfalls.md #10a #10b` — image 경로 / service label 함정
  - https://kamal-deploy.org/docs/commands/deploy/

---

## 결정 I-14. Tailscale OAuth client — scope 2개 모두 필수

- **status**: `template-ready`
- **결정일**: 2026-04-20
- **결정**: GHA 가 ephemeral device 로 tailnet 에 join 하기 위한 OAuth client 발급 시 **scope 2개 모두 체크 필수**:
  - `Devices → Core → Write` (+ tag:ci)
  - `Keys → Auth Keys → Write` (+ tag:ci)
  ACL 의 `tagOwners` 에 `tag:ci` 정의 선행. `tailscale/github-action@v4` 사용.
- **근거**:
  - `tailscale up --authkey=...` 흐름이 ephemeral auth key 발급 권한 (`Keys: Auth Keys: Write`) + device 등록 권한 (`Devices: Core: Write`) 둘 다 요구. 하나만 있어도 `403 calling actor does not have enough permissions`.
  - 도그푸딩 #4 시도까지 `Devices: Core: Write` 만 체크해서 실패 — 두 번째 scope 체크 안 한 게 원인.
  - `tailscale/github-action@v2` 는 옛 1.42.0 다운로드 → 신 OAuth API 미호환. `@v4` 가 최신 stable.
- **대안**:
  - **`oauth-client-id/secret` 대신 미리 발급한 ephemeral auth key 직접 전달** — `auth-key` parameter. 탈락: auth key 도 expiration / rotation 부담, OAuth client 가 더 깔끔.
  - **Self-hosted runner on Mac mini** — Tailscale 자체가 불필요. 탈락 ([I-12](#결정-i-12-workflow_run-게이트--jar-artifact-패스) 와 같은 이유).
- **Trade-off**:
  - OAuth client scope 변경 시 client 재발급 필요 (편집 불가).
  - 노출 시 즉시 폐기 (`docs/infra/key-rotation.md`).
- **재검토 트리거**:
  - Tailscale 의 OAuth API 변경 (scope 이름 바뀜 등)
  - GHA runner 가 tailscale 없이 Mac mini 에 도달 가능한 다른 경로 등장 (예: Cloudflare Tunnel SSH)
- **관련 문서**:
  - `../journey/dogfood-setup.md §3.2` — 발급 절차 (ACL HuJSON 포함)
  - `../journey/dogfood-pitfalls.md #3 #4` — 함정 분석
  - `../infra/key-rotation.md` — rotation
  - https://tailscale.com/kb/1215/oauth-clients

---

## 재검토 트리거 요약 표

| 트리거 | 영향 결정 | 대응 |
|---|---|---|
| MAU 1K 이상 | I-01 Supabase | Free → Pro |
| MAU 5K 이상 | I-04 맥미니 | 클라우드 분산 이관 |
| 외부 개발자 합류 | I-03 NAS, I-05 Tunnel | Tailscale or CF Tunnel 서비스 계정 |
| NAS 디스크 > 80% | I-03 MinIO | 증설 or Cloudflare R2 이관 |
| 집 ISP 업로드 < 10Mbps | I-03 MinIO, I-04 맥미니 | 클라우드 이관 |
| Supabase egress > 2GB/월 | I-01 Supabase | CDN 앞단 or Pro |
| 파생 레포 5+ | I-07 bucket 분리 | 로컬 per-repo bucket |
| 맥미니 RAM > 12GB 상시 | I-06 관측성 | 스택 분리 (NAS) or Grafana Cloud |
| 서비스 SLA 99.9%+ | I-04 맥미니 | 클라우드 이관 |
| Loki retention > 30일 요구 | I-06 관측성 | 관리형 or 클러스터링 |
| DataSource 수 > 10 | I-08 multi-DS | AbstractRoutingDataSource 재고 |
| 파생레포 2+ 동시 운영 | I-09 Kamal 배포 | 서브도메인 별 host 매핑 분리 or 호스트당 파생레포 분리 |
| 배포 blue/green 스왑 실패 관측 | I-09 Kamal 배포 | Kamal healthcheck 튜닝, nginx 앞단화 검토 |
| Kamal upstream 단종/라이선스 변경 | I-09 Kamal 배포 | 커스텀 bash 또는 Docker Swarm 이관 |
| GitHub PAT expiration 임박 (90일 주기) | I-10 GHCR_TOKEN | 새 PAT 발급 + setup.sh 재실행 |
| GHCR storage 한도 임박 (500MB) | I-10, I-12 | image cleanup 정책 강화 (keep-2 → keep-1) 또는 retention 단축 |
| `--skip-push` flag deprecation | I-13 | kamal build 활성화 또는 다른 deploy tool |
| Tailscale OAuth API scope 이름 변경 | I-14 | OAuth client 재발급 + 가이드 §3.2 갱신 |
| 로컬 수동 `kamal deploy` 사용 0회/분기 | I-11 | `Dockerfile` 폐기, `Dockerfile.runtime` 만 유지 |

## 상태 진화 추적

각 결정의 status 변화는 이 문서 편집 시 결정일을 갱신하고, 변경 사유를 commit 메시지에 기록합니다. 주요 상태 전이:

- `planned` → `hardware-acquired`: 물리 하드웨어 확보 (맥미니 구입 등)
- `planned` → `provisioned`: 서비스 계정 발급 + 기본 연결 테스트 완료
- `provisioned` → `in-prod`: 실제 트래픽 처리 (첫 유저 가입 등)
- 어느 상태 → `deprecated`: 대체 수단 확정 + 이관 시작

## 관련 문서

- [Repository Philosophy — 책 안내](../../philosophy/README.md) — 코드 설계 결정 (16 ADR)
- [인프라 (Infrastructure)](./infrastructure.md) — 인프라 현재 상태 + 구성도
- [오브젝트 스토리지 규약](../../api-and-functional/functional/storage.md) — 2-tier bucket 상세 규약
- [Observability 규약](../../api-and-functional/functional/observability.md) — 관측성 규약
- [Edge Cases & Risk Analysis](../../reference/edge-cases.md) — 리스크 시나리오 분석
- Item Ops-1 (예정) — 운영 배포 구현
