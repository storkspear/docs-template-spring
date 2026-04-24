# 인프라 (Infrastructure)

프로젝트의 환경별 인프라 구성, 책임 분담, 프로비저닝 상태를 기록합니다. 코드 아키텍처의 **왜** 는 [`philosophy/` 16 개 ADR](../../philosophy/README.md) 에, **무엇/어디** 는 [`architecture.md`](../../structure/architecture.md) 에 있으며, 이 문서는 그 위에서 **운영 환경의 실체** 를 다룹니다.

> **독자 대상**: Level 2~3. 본인 (미래의 자신) / 파생 레포를 만든 개발자 / 운영 담당 (Phase 1+).

## 1. 이 문서의 범위

- **포함**: 물리/운영 인프라 (DB, 오브젝트 스토리지, 운영 호스트, 엣지, 관측성) 구성과 현재 상태
- **제외**:
  - 코드 아키텍처 (포트/어댑터, 모듈 구조) → [`architecture.md`](../../structure/architecture.md)
  - 인프라 결정의 근거/대안 → [`decisions-infra.md`](./decisions-infra.md)
  - 코드 설계 철학 → [`philosophy/README.md`](../../philosophy/README.md)
  - 배포 파이프라인 상세 → [`ci-cd-flow.md`](./ci-cd-flow.md)
  - 운영 절차 / 장애 대응 → [`runbook.md`](./runbook.md)

---

## 2. 현재 프로비저닝 상태 (2026-04-24 기준)

| 컴포넌트 | Status | 메모 |
|---|---|---|
| Supabase (운영 DB) | `provisioned` | aws-1-ap-northeast-2 Supavisor pooler :6543. 계정 + 연결 테스트 완료. CI secrets 등록은 파생레포 몫 |
| NAS MinIO (오브젝트 스토리지) | `provisioned` | `192.168.X.X:9000`. **LAN 전용** — template 관리자 홈 네트워크만 접근 |
| 맥미니 (운영 호스트) | `hardware-acquired` | 물리 보유 / Kamal 초기 셋업은 파생레포 `kamal setup` 한 번 |
| Cloudflare Tunnel | `template-ready` | cloudflared 설치는 파생레포 개발자 몫. ingress 샘플은 `§4.2`. 상세: `guides/deployment.md` |
| 배포 파이프라인 (Kamal + GHA) | `template-ready` | `config/deploy.yml` + `.github/workflows/deploy.yml` 커밋됨. 파생레포가 env + Secrets 채우면 바로 동작. 결정 I-09 |
| 알림 (Discord webhook) | `provisioned (임계치 미정)` | Alertmanager 컨테이너 · Slack-compat Discord receiver 구성 완료. `DISCORD_WEBHOOK_URL` env 로 즉시 동작. 실제 알림 룰(CPU/메모리/5xx/p95 임계치)은 Phase 2 |
| 운영 관측성 스택 | `template-ready` | `infra/docker-compose.observability.yml` (retention 7일, mem_limit 명시). Mac mini 에서 `docker compose up -d` 한 번 |
| 로컬 docker 관측성 | `deprecated` | 로컬에서는 기동하지 않음 (2026-04-19 변경). 운영 전용으로 범위 재조정 (I-06 노트) |
| 2-tier bucket 정책 | `provisioned` (로컬 `dev-shared`) / `planned` (운영 `{slug}-{category}`) | `BucketProvisioner` 자동 생성. 상세: `features/storage.md` I-07 |

상태 필드 정의 (`planned` / `provisioned` / `in-prod` / `hardware-acquired`) 및 전이 규칙: [`decisions-infra.md`](./decisions-infra.md) 참조.

---

## 3. 로컬 개발 구성도

```
[개발자 맥북]
                  HTTP
 [Flutter 앱] ─────────────▶ [Spring Boot] ── JVM 프로세스, Docker 아님
                             :8081
                                │
                 ┌──────────────┼──────────────────────────────┐
                 │              │                              │
                 ▼              ▼                              ▼
            [docker]       [docker]                    [NAS (LAN)]
            postgres       (optional) MinIO             MinIO (실데이터)
            :5433          :9000 / :9001                :9000 / :9001

로컬 개발은 Spring 을 gradle bootRun 으로 JVM 직접 실행 (컨테이너화 불필요).
DB 는 docker-compose postgres (dev 전용), MinIO 는 로컬 docker 또는 NAS (선택).
관측성 스택(Loki/Grafana/Prometheus/Alertmanager)은 로컬 dev 에서 제외 —
운영(Mac mini) 전용이다. 자세한 것은 `§4` 운영 구성도.
```

### 3.1 로컬 포트 표

| 서비스 | 호스트 포트 | 용도 |
|---|---|---|
| Spring Boot | 8081 | REST API, Swagger (`/swagger-ui.html`) |
| Postgres | 5433 | 로컬 DB (docker compose) |
| 로컬 MinIO API (선택) | 9000 | 오프라인/독립 개발용. NAS 접근 가능하면 불필요 |
| 로컬 MinIO Console (선택) | 9001 | MinIO 웹 UI |
| NAS MinIO API | 9000 | S3 호환 — LAN 내부에서 Spring 이 호출 |
| NAS MinIO Console | 9001 | MinIO 웹 UI |

> **관측성은 로컬에 없다.** Loki/Grafana/Prometheus/Alertmanager 는 운영 전용 compose(`infra/docker-compose.observability.yml`) 로 Mac mini 에서만 기동. 이유: 로컬에서 실제로 활용 빈도 낮고 메모리·docker 부담 > 이득. 대시보드·쿼리 동작 확인이 필요하면 Mac mini 의 `log.example.com` 에서 검증.

### 3.2 기동 단계 옵션

최소 (DB 만 — 빠른 테스트용, 대부분의 개발에 충분):
```bash
docker compose -f infra/docker-compose.dev.yml up -d postgres
./gradlew :bootstrap:bootRun
```

MinIO 포함 (로컬에서 파일 업로드 경로 테스트):
```bash
docker compose -f infra/docker-compose.dev.yml up -d postgres minio
./gradlew :bootstrap:bootRun
```

자세한 onboarding 흐름: [`guides/onboarding.md`](../../start/onboarding.md).

---

## 4. 운영 구성도 (planned)

> ⚠️ **현재 `planned` 상태이나 배포 파이프라인 인프라는 template 에 구축 완료**.
> 파생레포가 "Use this template" → 환경값 채움 → `kamal setup` 한 번 실행 → GHA 자동 배포로 운영 진입.
> 자세한 onboarding: [`guides/deployment.md`](./deployment.md). 결정 근거: [`decisions-infra.md#결정-i-09`](./decisions-infra.md).

```
[인터넷 사용자]
       │  HTTPS
       ▼
[Cloudflare 엣지]                          ← TLS 종료, DDoS, WAF, Rate limit
       │
       ├─ server.<domain> ─┐
       ├─ log.<domain> ────┼─ Cloudflare Tunnel (cloudflared, 홈 IP 노출 없이 연결)
       └─ admin.<domain> ──┘   (log.*, admin.* 은 Cloudflare Access 이메일 OTP 게이팅)
       │
       ▼
[맥미니 — 가정 내 설치 / Apple Silicon / OrbStack]
       │
       ├─→ kamal-proxy :80  (Kamal 이 관리, blue/green 스왑)
       │         │
       │         └─→ Spring Boot 컨테이너 (docker, eclipse-temurin:21-jre-alpine)
       │             - 내부 :8080  (비즈니스 HTTP + /actuator/* 공유)
       │                   actuator exposure 는 health/info/prometheus 만 노출
       │                   (민감 endpoint 는 management.endpoints.web.exposure 에서 제외)
       │             - Flyway migrate 는 컨테이너 기동 시 advisory lock 으로 직렬화
       │             - 파괴적 DDL 은 `migrate-only` 모드로 사전 수동 실행 권장
       │             │
       │             ├─→ JDBC (Supavisor :6543) → [Supabase Seoul]
       │             │     - core schema (users/auth/devices)
       │             │     - <slug> schema (apps/app-<slug>/ 가 소유)
       │             │
       │             └─→ S3 API (Tailscale) → [시놀로지 NAS MinIO]
       │                   192.168.X.X:9000 / 9001  (LAN 직접 접근)
       │
       └─→ 관측성 스택  (infra/docker-compose.observability.yml — 별도 기동)
           prometheus :9090  (docker_sd 로 Spring actuator :8080 scrape, retention 7일)
           loki :3100        (logback-loki push endpoint)
           grafana :3000     (log.<domain> 공개 + CF Access 게이팅)
           alertmanager :9093 (loopback 전용)
```

**배포 파이프라인**: GitHub Actions → Tailscale 조인 → Kamal → SSH → Mac mini pull + blue/green 스왑.
**운영 프로세스는 컨테이너 기반** (launchd 대신 docker + Kamal). cloudflared 자체는 여전히 launchd 로 supervise.

**외부 서비스 연회비** (운영 전 발생):
- Apple Developer Program: $99 / 년
- Google Play Console: $25 (1회)

### 4.1 운영 포트

| 서비스 | 외부 노출 | 바인딩 | 접근 |
|---|---|---|---|
| Spring 비즈니스 | `server.<domain>` (CF Tunnel → kamal-proxy :80) | 컨테이너 :8080, 호스트 Blue/Green 포트는 Kamal 할당 | 공개 |
| Spring actuator (management) | `server.<domain>/actuator/{health,info,prometheus}` (app port 공유) | 컨테이너 :8080 공유 | `exposure.include` 로 health/info/prometheus 만 노출, 나머지 차단 |
| Grafana | `log.<domain>` (CF Tunnel + CF Access) | :3000 | 관리자만 (이메일 OTP) |
| Prometheus | ❌ | :9090 | 내부 전용 |
| Loki | ❌ | :3100 | Spring logback-loki push endpoint |
| Alertmanager | ❌ | 127.0.0.1:9093 | 내부 전용 |
| cloudflared | — | outbound only | — |
| kamal-proxy | ← cloudflared 경유 | :80 (호스트) | 내부 전용 (CF Tunnel 만 접근) |

### 4.2 배포 모델 — Modular Monolith + Blue/Green

**하나의 JVM 이 N 개 앱 모듈을 서브합니다.** [ADR-001 (모듈러 모놀리스)](../../philosophy/adr-001-modular-monolith.md) 와 [ADR-007 (솔로 친화적 운영)](../../philosophy/adr-007-solo-friendly-operations.md) 의 직접 적용 — 여러 Spring 프로세스를 띄우지 않습니다. 각 앱 모듈은 URL path 로 구분되며 JVM / DB 커넥션 풀 / 배포 / 모니터링을 공유합니다.

**무중단 배포는 blue/green 컨테이너** — Blue (현재 live) 와 Green (새 버전) 이 서로 다른 호스트 포트에 동시 존재, kamal-proxy 가 health check 통과 후 트래픽을 Green 으로 원자 전환, Blue 는 graceful shutdown.

**파생레포 여러 개 케이스** (외부 팀 협업 or 특정 앱이 MAU 100만 도달로 추출): 그때만 `<slug>.<domain>` 식으로 서브도메인 분리 + 파생레포마다 독립 JVM 컨테이너. 현 MVP 는 파생레포 1개 기준이므로 `server.<domain>` 한 개로 시작.

**cloudflared ingress 예시** (호스트명 → 내부 경로):
```yaml
ingress:
  - hostname: server.<domain>      # 비즈니스 API
    service: http://localhost:80   # kamal-proxy
  - hostname: log.<domain>         # 관측성 UI (CF Access 게이팅)
    service: http://localhost:3000 # Grafana
  - service: http_status:404
```

---

## 5. 책임 분담 표

| 기능 | 담당 | 상태 | 참조 |
|---|---|---|---|
| **TLS 종료** | Cloudflare | planned | Item Ops-1 |
| **DDoS 방어** | Cloudflare | planned | Item Ops-1 |
| **Rate limit (엣지)** | Cloudflare | planned | Item Ops-1 |
| **Rate limit (앱 내)** | Spring (`bucket4j`) | provisioned | `features/rate-limiting.md` |
| **DB (운영)** | Supabase | provisioned | I-01, keep-alive.sh |
| **DB (로컬)** | docker postgres | provisioned | compose |
| **오브젝트 스토리지** | NAS MinIO | provisioned (LAN-only) | I-03, `storage.md` |
| **관측성 (메트릭/로그/알림)** | 셀프 호스트 스택 | provisioned (로컬) / planned (운영) | I-06 |
| **이메일 발송** | Resend | 계정 준비, app key 등록 필요 | `social-auth-setup.md` (유사) |
| **푸시 (FCM)** | Firebase Cloud Messaging | 설정 pending, NoOp fallback | `core-push-impl` |
| **소셜 로그인 검증** | Apple/Google API 직접 호출 | provisioned (Java impl 완료) | `social-auth-setup.md` |
| **백업** | pg_dump → NAS | planned | Item Ops-1 |
| **시크릿 보관** | `.env` (로컬), GitHub Secrets (CI 예정) | provisioned (로컬) / planned (CI) | Item Ops-1 |

---

## 6. 선택 근거 요약

각 선택의 "왜 이거인가" 는 [`infra/decisions-infra.md`](./decisions-infra.md) 의 결정 카드 참조. 요약만:

- **Supabase** (I-01) — 관리형 Postgres Free tier, Seoul region, 솔로 친화
- **NAS MinIO** (I-03) — 보유 하드웨어 활용, S3 호환 → 미래 이관 유연, LAN 대역폭
- **맥미니 16GB** (I-04) — 전기세 월 $4, 클라우드 VM 대비 break-even 1년
- **Cloudflare Tunnel** (I-05) — 홈 IP 노출 없이 TLS/WAF/DDoS edge 처리
- **셀프 호스트 관측성** (I-06) — 데이터 주권 + 비용 0
- **2-tier bucket** (I-07) — 로컬 공용 / 운영 앱별 분리

---

## 7. 규모 기준 (스택 진화 경로)

서비스 성장에 따른 재검토 시점:

### MAU 0 ~ 1K (현재 / Phase 0)
- 현재 스택 그대로 충분
- Supabase Free, NAS MinIO, 맥미니 단일, 셀프 관측성

### MAU 1K ~ 10K (Phase 1)
- Supabase Free → **Pro 전환** ($25/월) — egress 2GB 초과 예상
- NAS 디스크 80% 도달 검토 → Cloudflare R2 이관 고려
- 맥미니 메모리 > 8GB 사용 시 관측성 retention 조정

### MAU 10K ~ 100K (Phase 2+)
- **맥미니 → 클라우드 이관** 검토 (AWS EC2 또는 Fly.io)
- DB 성능 튜닝 (connection pool, 인덱스, read replica)
- 관측성 → Grafana Cloud 또는 Datadog 고려
- CDN 앞단 (정적 자산 + 이미지)

### MAU 100K 이상
- 이 문서는 현재 프로젝트 스케일 범위 밖. 아키텍처 재설계 시점.

**재검토 트리거 구체 표**: [`decisions-infra.md` 말미](./decisions-infra.md#재검토-트리거-요약-표).

---

## 8. 보안 / 네트워크 경계 (planned)

> 현재 외부 노출 서비스가 없습니다 (개발 단계). 실제 경계 규칙은 Item Ops-1 에서 확정.

### 8.1 현재 (Phase 0)
- 로컬 개발만 — 전체 포트가 `localhost` 또는 `192.168.*` LAN
- NAS MinIO 는 LAN 외부에서 접근 불가 (공유기 NAT 차단)
- 공개 인터넷 접근 지점 없음

### 8.2 운영 설계
- **외부 노출**: Cloudflare Tunnel 경유 호스트명 — `server.<domain>` (Spring), `log.<domain>` (Grafana, CF Access 게이팅)
- **Spring actuator**: app port (:8080) 와 공유. `management.endpoints.web.exposure.include` 로 `health, info, prometheus` 만 열어두고 나머지 경로는 차단. 더 엄격한 격리가 필요해지면 `management.server.port` 를 별도 포트로 분리하고 kamal-proxy healthcheck 를 main-port 의 가벼운 엔드포인트로 교체하는 후속 과제.
- **내부 전용 포트** (kamal 네트워크 내부 + loopback): Prometheus :9090, Loki :3100, Alertmanager 127.0.0.1:9093 — 어느 것도 cloudflared ingress 에 노출하지 않음
- **NAS MinIO 외부 접근**: Tailscale vs Cloudflare Tunnel vs DDNS+포트포워딩 선택은 Phase 2 에서 결정 (backlog 참조)

### 8.3 시크릿 보관 (planned)
- **로컬**: `.env` (gitignored)
- **운영 CI**: GitHub Secrets (Item Ops-1 에서 등록)
- **중앙 관리 체계**: Item Ops-1 에서 선택 (`1Password CLI / sops / Vault`)

---

## 9. 인프라 변경 프로세스

새 인프라 요소 (환경변수, Docker 서비스, Cloudflare 규칙 등) 추가 시 업데이트해야 할 파일:

### 9.1 새 환경변수 추가
1. `.env.example` 에 주석 형태로 이름 + 설명 추가
2. `application-{dev,prod}.yml` 에 `${VAR}` 바인딩
3. 해당 `@ConfigurationProperties` 클래스 필드 추가
4. `infrastructure.md §5` 책임 분담 표 업데이트 (필요 시)
5. `guides/onboarding.md` 흔한 에러 목록에 누락 시 동작 추가 (필요 시)

### 9.2 새 Docker 서비스 추가
1. `infra/docker-compose.dev.yml` 에 서비스 정의
2. `infrastructure.md §3.1` 포트 표 업데이트
3. `.gitignore` 에 volume 디렉토리 추가
4. `guides/monitoring-setup.md` 또는 `storage-setup.md` 에 설정 가이드 (해당 시)

### 9.3 새 결정 (Supabase 이관, CDN 추가 등)
1. `decisions-infra.md` 에 새 결정 카드 `I-NN` 추가 (status / 근거 / 대안 / 트리거)
2. `infrastructure.md §2` 상태 표 업데이트
3. `infrastructure.md §5` 책임 분담 표 업데이트
4. `backlog.md` 에서 관련 항목 archive

### 9.4 인프라 컴포넌트 상태 변경
- `planned` → `provisioned`: decisions-infra.md status 갱신 + `§2` 상태 표 갱신 + commit 메시지에 상태 전이 명시
- `provisioned` → `in-prod`: 위와 동일 + first 유저 가입 시점 기록

---

## 10. DB 스키마 관리

### 10.1 Schema 구조

단일 DB 안에 앱별 schema ([ADR-005](../../philosophy/adr-005-db-schema-isolation.md)):
```
postgres (Supabase or 로컬 docker)
├── core schema              ← 템플릿 기준선 (users/auth/devices 레거시, core_app role)
│   ├── users
│   ├── social_identities
│   ├── refresh_tokens
│   ├── email_verification_tokens
│   ├── password_reset_tokens
│   └── devices
└── <slug> schema            ← apps/app-<slug> 이 소유 — 자기 users/auth/devices + 도메인 테이블
    ├── users / social_identities / refresh_tokens / ...  ([ADR-012](../journey/philosophy/adr-012-per-app-user-model.md): 앱별 독립 유저)
    └── (앱 도메인 테이블)
```

> **Template 상태**: 현재 레포에는 앱이 없으므로 core schema 만 존재. 파생 레포가 `new-app.sh <slug> --provision-db` 실행 시 `<slug>` schema 가 자동 생성되고 Flyway 가 users/auth/device 기본 테이블 세트를 앱 schema 에 migrate. Multi-DataSource wiring 은 구현 완료 (`CoreDataSourceConfig` + `<Slug>DataSourceConfig`, `common-persistence/AbstractAppDataSourceConfig` 기반).

### 10.2 초기 Schema 스크립트

| 파일 | 용도 |
|---|---|
| `infra/scripts/init-core-schema.sql` | core schema 생성 + role grant (Supabase 초기 셋업용) |
| `infra/scripts/init-app-schema.sql` | 앱별 schema 생성 template (`{slug}` placeholder) |

파생 레포가 새 앱 만들 때 `new-app.sh <slug> --provision-db` 를 실행하면 `init-app-schema.sql` 이 자동 실행됨 (Item 10 완료). 수동 실행이 필요한 경우 `APP_SLUG=<slug> APP_ROLE=<slug>_app APP_PASSWORD=<pw> psql ... -f infra/scripts/init-app-schema.sql`.

### 10.3 Flyway 마이그레이션

현재 core schema 의 마이그레이션 파일:
```
V001__init_users.sql
V002__init_social_identities.sql
V003__add_users_email_index.sql
V005__init_refresh_tokens.sql
V006__init_email_verification_tokens.sql
V007__init_password_reset_tokens.sql
V008__init_devices.sql
V009__add_devices_updated_at.sql
```

**V004 는 번호 건너뜀** — 과거에 존재했으나 `87fb8e2` (per-app independent users model 리팩토링) 에서 삭제됨. Flyway 관례 상 번호 재사용 금지 → V004 는 영구 결번.

### 10.4 서비스별 DataSource

앱별 schema 에 붙는 DataSource 는 각 앱 모듈의 `<Slug>DataSourceConfig` 에서 `@Value` 로 환경변수 주입. Bootstrap 은 core schema 만, 각 앱은 자기 schema 에. 5중 방어선 (DB role · DataSource · Flyway · 포트 · ArchUnit) 의 구조적 근거: [ADR-005 (단일 Postgres + 앱당 schema)](../../philosophy/adr-005-db-schema-isolation.md). 구조 상세: [`architecture.md`](../../structure/architecture.md) 데이터베이스 구조 섹션.

### 10.5 `keep-alive.sh` — Supabase Free 7일 비활성 방지

`infra/scripts/keep-alive.sh`:
- Supabase Free tier 는 7일 비활성 시 자동 pause
- `curl /actuator/health` 를 주기적으로 호출해서 DB 연결 유지
- **cron 예시** (매 14분):
  ```
  */14 * * * * /path/to/keep-alive.sh >> /var/log/keep-alive.log 2>&1
  ```
- 환경변수: `BASE_URL`, `INTERVAL_SEC`, `ENDPOINTS`
- Item Ops-1 에서 launchd 등록 or Supabase Pro 업그레이드 결정

---

## 11. 관련 문서

### 코드 아키텍처 / 설계 결정
- [`architecture.md`](../../structure/architecture.md) — 코드 아키텍처 (포트/어댑터, 모듈 의존성)
- [`philosophy/README.md`](../../philosophy/README.md) — 16 개 ADR 인덱스 (설계 결정의 근거)
- 특히: [ADR-001 (모듈러 모놀리스)](../../philosophy/adr-001-modular-monolith.md), [ADR-005 (Postgres schema 격리)](../../philosophy/adr-005-db-schema-isolation.md), [ADR-007 (솔로 친화적 운영)](../../philosophy/adr-007-solo-friendly-operations.md)

### 인프라 결정 / 운영
- [`decisions-infra.md`](./decisions-infra.md) — 인프라 결정 카드 I-01~I-07
- [`ci-cd-flow.md`](./ci-cd-flow.md) — commit → 운영 반영까지 전체 배포 흐름
- [`runbook.md`](./runbook.md) — 운영 절차 + 장애 대응
- [`edge-cases.md`](../../reference/edge-cases.md) — 엣지 케이스 / 예외 처리 목록
- [`key-rotation.md`](../setup/key-rotation.md) — 보안 키 로테이션 절차
- [`mac-mini-setup.md`](../setup/mac-mini-setup.md) — 맥미니 홈서버 셋업

### 기능 별 상세
- [`../features/storage.md`](../../api-and-functional/functional/storage.md) — MinIO 2-tier bucket 정책
- [`../features/observability.md`](../../api-and-functional/functional/observability.md) — 관측성 규약
- [`storage-setup.md`](../setup/storage-setup.md) — MinIO 로컬/NAS 셋업
- [`monitoring-setup.md`](../setup/monitoring-setup.md) — 관측성 스택 기동

### 여정 / 진입점
- [`../journey/onboarding.md`](../../start/onboarding.md) — 템플릿 첫 사용 가이드
- [`../journey/deployment.md`](./deployment.md) — 파생 레포 첫 운영 배포
- [`../reference/backlog.md`](../../planned/backlog.md) — 미완료 항목 (Item Ops-1 묶음 포함)
