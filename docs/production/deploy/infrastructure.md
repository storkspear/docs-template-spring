# 인프라 (Infrastructure)

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~12분

프로젝트의 환경별 인프라 구성, 책임 분담, 프로비저닝 상태를 기록해요. 코드 아키텍처의 "왜" 는 [`philosophy/` 의 39 개 ADR](../../philosophy/README.md) 에, "무엇이 어디에" 는 [`Architecture Reference`](../../structure/architecture.md) 에 있어요. 이 문서는 그 위에서 운영 환경의 실체 — 어떤 호스트에 무엇이 떠 있고 누가 책임지는가 — 를 다룹니다.

독자는 셋입니다. 본인 (미래의 자신), 파생 레포를 만든 개발자, 그리고 운영 담당 (Phase 1 이후).

## 1. 이 문서의 범위

물리·운영 인프라의 구성과 현재 상태를 담아요. DB, 오브젝트 스토리지, 운영 호스트, 엣지, 관측성이 여기에 들어갑니다.

아래 네 가지는 이 문서가 다루지 않아요. 각자 전용 문서가 있어요.

- 코드 아키텍처 (포트·어댑터, 모듈 구조) → [`Architecture Reference`](../../structure/architecture.md)
- 인프라 결정의 근거와 대안 → [`인프라 결정 기록 (Decisions — Infrastructure)`](./decisions-infra.md)
- 코드 설계 철학 → [`Repository Philosophy — 책 안내`](../../philosophy/README.md)
- 배포 파이프라인 상세 → [`CI / CD 전체 플로우`](./ci-cd-flow.md)
- 운영 절차와 장애 대응 → [`운영 런북 (Runbook)`](./runbook.md)

---

## 2. 현재 프로비저닝 상태 (2026-04-24 기준)

| 컴포넌트 | Status | 메모 |
|---|---|---|
| Supabase (운영 DB) | `provisioned` | aws-1-ap-northeast-2, Supavisor pooler `:6543`. 계정과 연결 테스트는 완료. CI Secrets 등록은 파생 레포 몫 |
| NAS MinIO (오브젝트 스토리지) | `provisioned` | `192.168.X.X:9000`, LAN 전용. template 관리자의 홈 네트워크에서만 접근 |
| 맥미니 (운영 호스트) | `hardware-acquired` | 물리 보유. Kamal 초기 셋업은 파생 레포가 `kamal setup` 한 번 |
| Cloudflare Tunnel | `template-ready` | cloudflared 설치는 파생 레포 개발자 몫. ingress 샘플은 `§4.2`, 상세는 `deployment.md` |
| 배포 파이프라인 (Kamal + GHA) | `template-ready` | `config/deploy.yml` 과 `.github/workflows/deploy.yml` 가 커밋돼 있어요. 파생 레포가 env 와 Secrets 만 채우면 바로 동작. 결정 I-09 |
| 알림 (Discord webhook) | `provisioned` | Alertmanager 컨테이너와 Discord receiver 구성 완료. `DISCORD_WEBHOOK_URL` env 로 즉시 동작. 알림 룰 8개 정의됨 (`infra/prometheus/rules.yml` — 에러율·지연·rate-limit·백엔드 다운·MinIO 다운/디스크 3단계) |
| 운영 관측성 스택 | `template-ready` | `infra/docker-compose.observability.yml`, retention Prometheus 7일·Loki 14일, `mem_limit` 명시. Mac mini 에서 `docker compose up -d` 한 번 |
| 로컬 docker 관측성 | `not-applicable` | 로컬에서는 기동하지 않아요. 운영 전용 (I-06 노트) |
| 2-tier bucket 정책 | `provisioned` (로컬 `dev-shared`) / `planned` (운영 `{slug}-{category}`) | `BucketProvisioner` 가 자동 생성. 상세는 `storage.md`, I-07 |

상태 필드 정의 (`planned` · `provisioned` · `in-prod` · `hardware-acquired`) 와 전이 규칙은 [`인프라 결정 기록 (Decisions — Infrastructure)`](./decisions-infra.md) 를 참조하세요.

---

## 3. 로컬 개발 구성도

로컬은 Spring 을 컨테이너 없이 JVM 으로 직접 실행해요. DB 만 docker 로 띄우면 대부분의 개발에 충분합니다.

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
            postgres       (선택) MinIO                 MinIO (실데이터)
            :5433          :9000 / :9001                :9000 / :9001
```

Spring 은 `gradle bootRun` 으로 JVM 에서 직접 돕니다. 컨테이너화는 로컬에 불필요해요. DB 는 docker compose 의 postgres (dev 전용) 를 쓰고, MinIO 는 로컬 docker 또는 NAS 중에서 고를 수 있어요. 관측성 스택 (Loki·Grafana·Prometheus·Alertmanager) 은 로컬에서 기동하지 않습니다. 운영 (Mac mini) 전용이에요. 운영 구성은 `§4` 에서 다뤄요.

### 3.1 로컬 포트 표

| 서비스 | 호스트 포트 | 용도 |
|---|---|---|
| Spring Boot | 8081 | REST API, Swagger (`/swagger-ui.html`) |
| Postgres | 5433 | 로컬 DB (docker compose) |
| 로컬 MinIO API (선택) | 9000 | 오프라인·독립 개발용. NAS 에 접근 가능하면 불필요 |
| 로컬 MinIO Console (선택) | 9001 | MinIO 웹 UI |
| NAS MinIO API | 9000 | S3 호환. LAN 안에서 Spring 이 호출 |
| NAS MinIO Console | 9001 | MinIO 웹 UI |

> **관측성은 로컬에 없어요.** Loki·Grafana·Prometheus·Alertmanager 는 운영 전용 compose (`infra/docker-compose.observability.yml`) 로 Mac mini 에서만 기동합니다. 로컬에서는 활용 빈도가 낮은데 메모리와 docker 부담이 이득보다 커서예요. 대시보드나 쿼리 동작을 확인해야 하면 Mac mini 의 `log.<domain>` 에서 검증하세요.

### 3.2 기동 단계 옵션

빠른 테스트에는 DB 만 띄우면 충분해요. 대부분의 개발이 여기에 해당합니다.

```bash
docker compose -f infra/docker-compose.local.yml up -d postgres
./gradlew :bootstrap:bootRun
```

로컬에서 파일 업로드 경로까지 테스트하려면 MinIO 를 같이 띄워요.

```bash
docker compose -f infra/docker-compose.local.yml up -d postgres minio
./gradlew :bootstrap:bootRun
```

자세한 onboarding 흐름은 [`Onboarding — 템플릿 첫 사용 가이드`](../../start/onboarding.md) 에 있어요.

---

## 4. 운영 구성도 (planned)

> ⚠️ 환경 자체는 `planned` 상태이지만, 배포 파이프라인 인프라는 template 에 이미 구축돼 있어요. 파생 레포가 "Use this template" 으로 분기하고, 환경값을 채우고, `kamal setup` 을 한 번 실행하면 GHA 자동 배포로 운영에 진입합니다. 자세한 onboarding 은 [`운영 배포 가이드`](./deployment.md), 결정 근거는 [`인프라 결정 기록`](./decisions-infra.md) 을 보세요.

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
       │                   actuator 는 health, info, prometheus 만 노출
       │                   (민감 endpoint 는 exposure 에서 제외)
       │             - Flyway 는 prod 부팅 시 validate 만 수행 (VALIDATE_ONLY, ADR-033)
       │             - schema 변경은 배포 전 tools/migrate-prod.sh 로 사전 적용
       │             │
       │             ├─→ JDBC (Supavisor :6543) → [Supabase Seoul]
       │             │     - <slug> schema (apps/app-<slug> 소유 — users/auth/devices/도메인 테이블)
       │             │     - ADR-037: core schema 는 unused (coreDataSource Bean 폐기)
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

배포 파이프라인은 GitHub Actions → Tailscale 조인 → Kamal → SSH → Mac mini pull + blue/green 스왑 순서로 진행됩니다. 운영 프로세스는 launchd 대신 docker 와 Kamal 로 컨테이너 기반으로 돌아가요. 다만 cloudflared 자체는 여전히 launchd 로 supervise 합니다.

운영 진입 전에 발생하는 외부 서비스 연회비도 있어요.

- Apple Developer Program: $99 / 년
- Google Play Console: $25 (1 회)

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

하나의 JVM 이 N 개의 앱 모듈을 서브합니다. [`ADR-001 · 모듈러 모놀리스`](../../philosophy/adr-001-modular-monolith.md) 와 [`ADR-007 · 솔로 친화적 운영`](../../philosophy/adr-007-solo-friendly-operations.md) 을 직접 적용한 결과예요. 여러 Spring 프로세스를 띄우지 않습니다. 각 앱 모듈은 URL path 로 구분되고 JVM, DB 커넥션 풀, 배포, 모니터링을 공유합니다.

무중단 배포는 blue/green 컨테이너로 합니다. 현재 live 인 Blue 와 새 버전 Green 이 서로 다른 호스트 포트에 동시에 존재해요. kamal-proxy 가 health check 통과를 확인한 뒤 트래픽을 Green 으로 원자적으로 전환하고, Blue 는 graceful shutdown 됩니다.

파생 레포가 여러 개가 되는 경우 — 외부 팀과 협업하거나 특정 앱이 MAU 100 만에 도달해 추출하는 경우 — 에는 그때만 `<slug>.<domain>` 식으로 서브도메인을 분리하고 레포마다 독립 JVM 컨테이너를 띄웁니다. 현 MVP 는 파생 레포 1 개 기준이라 `server.<domain>` 한 개로 시작해요.

cloudflared ingress 는 호스트명을 내부 경로로 매핑합니다.

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
| TLS 종료 | Cloudflare | planned | Item Ops-1 |
| DDoS 방어 | Cloudflare | planned | Item Ops-1 |
| Rate limit (엣지) | Cloudflare | planned | Item Ops-1 |
| Rate limit (앱 내) | Spring (`bucket4j`) | provisioned | `rate-limiting.md` |
| DB (운영) | Supabase | provisioned | I-01, keep-alive.sh |
| DB (로컬) | docker postgres | provisioned | compose |
| 오브젝트 스토리지 | NAS MinIO | provisioned (LAN 전용) | I-03, `storage.md` |
| 관측성 (메트릭·로그·알림) | 셀프 호스트 스택 | template-ready (운영 전용 — 로컬 미기동, §2 상태 표) | I-06 |
| 이메일 발송 | Resend | 계정 준비, app key 등록 필요 | `social-auth-setup.md` (유사) |
| 푸시 (FCM) | Firebase Cloud Messaging | 설정 pending, NoOp fallback | `core-push-impl` |
| 소셜 로그인 검증 | Apple·Google API 직접 호출 | provisioned (Java 구현 완료) | `social-auth-setup.md` |
| 백업 | pg_dump → NAS | planned | Item Ops-1 |
| 시크릿 보관 | `.env` (로컬), GitHub Secrets (CI) | provisioned — `init-prod.sh` 가 `.env.prod` 를 GitHub Secrets 로 자동 push | `secret-chain-4stage.md` |

---

## 6. 선택 근거 요약

각 선택의 "왜 이거인가" 는 [`인프라 결정 기록 (Decisions — Infrastructure)`](./decisions-infra.md) 의 결정 카드에 있어요. 여기서는 요약만 짚어요.

- **Supabase** (I-01) — 관리형 Postgres Free tier, Seoul region, 솔로 친화
- **NAS MinIO** (I-03) — 보유 하드웨어 활용, S3 호환이라 미래 이관에 유연, LAN 대역폭
- **맥미니 16GB** (I-04) — 전기세 월 $4, 클라우드 VM 대비 break-even 1 년
- **Cloudflare Tunnel** (I-05) — 홈 IP 노출 없이 TLS·WAF·DDoS 를 엣지에서 처리
- **셀프 호스트 관측성** (I-06) — 데이터 주권 확보, 비용 0
- **2-tier bucket** (I-07) — 로컬은 공용, 운영은 앱별 분리

---

## 7. 규모 기준 (스택 진화 경로)

서비스 성장에 따라 스택을 재검토할 시점을 정리해요.

### MAU 0 ~ 1K (현재 / Phase 0)
- 현재 스택 그대로 충분
- Supabase Free, NAS MinIO, 맥미니 단일, 셀프 관측성

### MAU 1K ~ 10K (Phase 1)
- Supabase Free → Pro 전환 ($25/월). egress 2GB 초과 예상
- NAS 디스크 80% 도달 시 Cloudflare R2 이관 검토
- 맥미니 메모리 8GB 초과 사용 시 관측성 retention 조정

### MAU 10K ~ 100K (Phase 2+)
- 맥미니 → 클라우드 이관 검토 (AWS EC2 또는 Fly.io)
- DB 성능 튜닝 (connection pool, 인덱스, read replica)
- 관측성 → Grafana Cloud 또는 Datadog 검토
- CDN 앞단 추가 (정적 자산과 이미지)

### MAU 100K 이상
- 이 문서가 가정한 프로젝트 스케일 범위 밖이에요. 아키텍처 재설계 시점입니다.

재검토 트리거의 구체 표는 [`인프라 결정 기록 말미`](./decisions-infra.md#재검토-트리거-요약-표) 에 있어요.

---

## 8. 보안 / 네트워크 경계 (planned)

> 현재는 외부 노출 서비스가 없어요 (개발 단계). 실제 경계 규칙은 Item Ops-1 에서 확정합니다.

### 8.1 현재 (Phase 0)
- 로컬 개발만 진행 중이라 전체 포트가 `localhost` 또는 `192.168.*` LAN 안에 있어요
- NAS MinIO 는 공유기 NAT 가 막아 LAN 외부에서 접근할 수 없습니다
- 공개 인터넷 접근 지점이 없습니다

### 8.2 운영 설계
- **외부 노출** — Cloudflare Tunnel 경유 호스트명. `server.<domain>` 은 Spring, `log.<domain>` 은 Grafana (CF Access 게이팅)
- **Spring actuator** — app port (:8080) 와 공유합니다. `management.endpoints.web.exposure.include` 로 `health, info, prometheus` 만 열고 나머지 경로는 차단해요. 더 엄격한 격리가 필요해지면 `management.server.port` 를 별도 포트로 분리하고 kamal-proxy healthcheck 를 main-port 의 가벼운 엔드포인트로 교체하는 후속 과제가 있어요.
- **내부 전용 포트** — Prometheus :9090, Loki :3100, Alertmanager 127.0.0.1:9093 은 kamal 네트워크 내부와 loopback 에만 두고, 어느 것도 cloudflared ingress 에 노출하지 않아요
- **NAS MinIO 외부 접근** — Tailscale, Cloudflare Tunnel, DDNS + 포트포워딩 중 무엇을 쓸지는 Phase 2 에서 결정합니다 (backlog 참조)

### 8.3 시크릿 보관
- **로컬** — `.env` (gitignored)
- **운영 CI** — GitHub Secrets. `init-prod.sh` / `init-dev.sh` 가 `.env.prod` / `.env.dev` 값을 자동 push 해요 (4단계 체인은 [`secret-chain-4stage.md`](../setup/secret-chain-4stage.md))
- **중앙 관리 체계** — 미도입 (1Password CLI, sops, Vault 중 선택은 후속 과제)

---

## 9. 인프라 변경 프로세스

새 인프라 요소 (환경변수, Docker 서비스, Cloudflare 규칙 등) 를 추가할 때 함께 업데이트할 파일을 정리해요.

### 9.1 새 환경변수 추가
1. `.env.example` 에 주석 형태로 이름과 설명 추가
2. `application-{dev,prod}.yml` 에 `${VAR}` 바인딩
3. 해당 `@ConfigurationProperties` 클래스에 필드 추가
4. `infrastructure.md §5` 책임 분담 표 업데이트 (필요 시)
5. `onboarding.md` 흔한 에러 목록에 누락 시 동작 추가 (필요 시)

### 9.2 새 Docker 서비스 추가
1. `infra/docker-compose.local.yml` 에 서비스 정의
2. `infrastructure.md §3.1` 포트 표 업데이트
3. `.gitignore` 에 volume 디렉토리 추가
4. `monitoring-setup.md` 또는 `storage-setup.md` 에 설정 가이드 (해당 시)

### 9.3 새 결정 (Supabase 이관, CDN 추가 등)
1. `decisions-infra.md` 에 새 결정 카드 `I-NN` 추가 (status, 근거, 대안, 트리거)
2. `infrastructure.md §2` 상태 표 업데이트
3. `infrastructure.md §5` 책임 분담 표 업데이트
4. `backlog.md` 의 관련 항목 archive

### 9.4 인프라 컴포넌트 상태 변경
- `planned` → `provisioned` — decisions-infra.md status 갱신, `§2` 상태 표 갱신, commit 메시지에 상태 전이 명시
- `provisioned` → `in-prod` — 위와 동일, 첫 유저 가입 시점 기록 추가

---

## 10. DB 스키마 관리

### 10.1 Schema 구조

단일 DB 안에서 앱별 schema 로 격리합니다 ([`ADR-005`](../../philosophy/adr-005-db-schema-isolation.md), [`ADR-037`](../../philosophy/adr-037-core-schema-deprecation.md)).

```
postgres (Supabase 또는 로컬 docker)
└── <slug> schema            ← apps/app-<slug> 소유 — 자기 users/auth/devices + 도메인 테이블
    ├── users / auth_social_identities / auth_refresh_tokens / auth_email_verification_tokens
    ├── auth_password_reset_tokens / devices
    └── (앱 도메인 테이블)
```

> **Template 상태** — 현재 레포에는 앱이 없어서 Spring application 자체가 부팅되지 않아요 (`RoutingDataSourceConfig` 의 routing targets 가 비어 fail-secure, [`ADR-037`](../../philosophy/adr-037-core-schema-deprecation.md)). 파생 레포가 `new-app.sh <slug> --provision-db` 를 실행하면 `<slug>` schema 가 자동 생성되고, Flyway 가 users/auth/device 기본 테이블 세트를 앱 schema 에 migrate 해요. Multi-DataSource wiring 은 구현이 끝났습니다 (`RoutingDataSourceConfig` + `<Slug>DataSourceConfig`, `common-persistence/AbstractAppDataSourceConfig` 기반).
>
> `core` schema 는 ADR-037 이후 unused 였고, 물리 잔재까지 제거 완료(2026-07-01)예요 — 더는 어떤 스크립트도 `core` schema 를 생성하지 않아요.

### 10.2 초기 Schema 스크립트

| 파일 | 용도 |
|---|---|
| `infra/scripts/init-app-schema.sql` | 앱별 schema 생성 template (`{slug}` placeholder) |

파생 레포가 새 앱을 만들 때 `new-app.sh <slug> --provision-db` 를 실행하면 `init-app-schema.sql` 이 자동으로 돌아요 (Item 10 완료). 수동 실행이 필요하면 `APP_SLUG=<slug> APP_ROLE=<slug>_app APP_PASSWORD=<pw> psql ... -f infra/scripts/init-app-schema.sql` 로 호출합니다.

### 10.3 Flyway 마이그레이션

`new-app.sh` 는 모든 앱이 똑같이 받는 공통 마이그레이션 기본 25개 (V001 ~ V026, V007 제외) 를 앱의 `<slug>` schema 에 생성해요. 인증·결제·감사·운영 콘솔 기반이 여기에 들어갑니다. 본인 도메인 테이블은 **V027 부터** 직접 작성하면 돼요. V007 은 admin user 시드로 `--seed-admin` 을 붙일 때만 생성되지만 (opt-in, 랜덤 비밀번호), 생성하지 않아도 번호는 시드용으로 비워 둡니다.

| 버전 | 내용 |
|---|---|
| V001 ~ V006 | 인증 기반 — users · auth_social_identities · auth_refresh_tokens · auth_email_verification_tokens · auth_password_reset_tokens · devices |
| V007 | admin user 시드 (`V007__seed_admin_user.sql`, `--seed-admin` opt-in) |
| V008 ~ V012 | 결제·구독·감사 — subscription_plans · subscriptions · payment_webhook_events · subscription_renewals · audit_logs |
| V013 ~ V014 | 2FA (TOTP) 컬럼 · user_notification_settings |
| V015 | auth_phone_verification_codes (휴대폰 점유인증, 옵트인 — 안 쓰면 삭제 가능) |
| V016 ~ V017 | auth_email_verification_codes · user_activity_days |
| V018 ~ V021 | 운영·콘솔 — attachment_file · user_read_history · message_send_history · audit_logs_archive |
| V022 ~ V025 | 환불·콘텐츠·분석 — payment refunded_amount · payment_refunds · posts · analytics |
| V026 ~ | 앱 도메인 테이블 (파생 레포가 직접 작성) |

> ADR-037 이후 `core/core-*-impl/src/main/resources/db/migration/core/` 의 production migration 7 개는 삭제됐어요. 각 앱은 자기 `<slug>` schema 만 마이그레이션합니다. `core/core-*-impl/src/test/resources/db/migration/core/` 는 Testcontainers 용으로만 잔존하며, 거기 파일의 버전 번호는 테스트 픽스처용이라 위 운영 번호 체계와는 별개예요. production runtime 에는 영향이 없습니다.

### 10.4 서비스별 DataSource

앱별 schema 에 붙는 DataSource 는 각 앱 모듈의 `<Slug>DataSourceConfig` 에서 `@Value` 로 환경변수를 주입받아요. ADR-037 이후 bootstrap 은 `RoutingDataSourceConfig` 만 가지고, core schema DataSource 는 없습니다. 각 앱이 자기 schema 의 DataSource Bean 을 등록하고, `SchemaRoutingDataSource` 가 ThreadLocal `SlugContext` 의 slug 로 connection 을 분기합니다. 4 중 방어선 (DB role · DataSource · Flyway · ArchUnit) 의 구조적 근거는 [`ADR-005`](../../philosophy/adr-005-db-schema-isolation.md) 에 있어요 (5 중 → 4 중 정정은 `Updated by ADR-037`). 구조 상세는 [`Architecture Reference`](../../structure/architecture.md) 의 데이터베이스 구조 섹션을 참조하세요.

### 10.5 `keep-alive.sh` — Supabase Free 7 일 비활성 방지

Supabase Free tier 는 7 일 비활성 시 자동으로 pause 됩니다. `infra/scripts/keep-alive.sh` 가 `curl /actuator/health` 를 주기적으로 호출해 DB 연결을 유지해요.

cron 예시는 매 14 분 호출입니다.

```
*/14 * * * * /path/to/keep-alive.sh >> /var/log/keep-alive.log 2>&1
```

환경변수는 `BASE_URL`, `INTERVAL_SEC`, `ENDPOINTS` 예요. launchd 등록 또는 Supabase Pro 업그레이드는 Item Ops-1 에서 결정합니다.

---

## 11. 관련 문서

### 코드 아키텍처 / 설계 결정
- [`Architecture Reference`](../../structure/architecture.md) — 코드 아키텍처 (포트·어댑터, 모듈 의존성)
- [`Repository Philosophy — 책 안내`](../../philosophy/README.md) — 39 개 ADR 인덱스 (설계 결정의 근거)
- 특히 [`ADR-001 · 모듈러 모놀리스`](../../philosophy/adr-001-modular-monolith.md), [`ADR-005 · Postgres schema 격리`](../../philosophy/adr-005-db-schema-isolation.md), [`ADR-007 · 솔로 친화적 운영`](../../philosophy/adr-007-solo-friendly-operations.md)

### 인프라 결정 / 운영
- [`인프라 결정 기록 (Decisions — Infrastructure)`](./decisions-infra.md) — 인프라 결정 카드 I-01 ~ I-14
- [`CI / CD 전체 플로우`](./ci-cd-flow.md) — commit 부터 운영 반영까지 전체 배포 흐름
- [`운영 런북 (Runbook)`](./runbook.md) — 운영 절차와 장애 대응
- [`Edge Cases & Risk Analysis`](../../reference/edge-cases.md) — 엣지 케이스와 예외 처리 목록
- [`키 교체 절차 (Key Rotation)`](../setup/key-rotation.md) — 보안 키 로테이션 절차
- [`Mac mini 운영 호스트 설정`](../setup/mac-mini-setup.md) — 맥미니 홈서버 셋업

### 기능별 상세
- [`오브젝트 스토리지 규약`](../../api-and-functional/functional/storage.md) — MinIO 2-tier bucket 정책
- [`Observability 규약`](../../api-and-functional/functional/observability.md) — 관측성 규약
- [`스토리지 셋업 가이드 (MinIO / 시놀로지 NAS)`](../setup/storage-setup.md) — MinIO 로컬·NAS 셋업
- [`운영 모니터링 셋업 가이드`](../setup/monitoring-setup.md) — 관측성 스택 기동

### 여정 / 진입점
- [`Onboarding — 템플릿 첫 사용 가이드`](../../start/onboarding.md) — 템플릿 첫 사용 가이드
- [`운영 배포 가이드 (파생 레포 onboarding)`](./deployment.md) — 파생 레포 첫 운영 배포
- [`Backlog`](../../planned/backlog.md) — 미완료 항목 (Item Ops-1 묶음 포함)
