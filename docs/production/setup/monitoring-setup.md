# 운영 모니터링 셋업 가이드

> **유형**: How-to · **독자**: Level 2.5 · **읽는 시간**: ~5분

**설계 근거**: [`ADR-007 (솔로 친화적 운영)`](../../philosophy/adr-007-solo-friendly-operations.md)

Mac mini 운영 호스트에서 관측성 스택(Loki + Grafana + Prometheus + Alertmanager)을 기동·운영하는 방법.

> 인프라 전체 구성 / 책임 분담: [`인프라 (Infrastructure)`](../deploy/infrastructure.md)
> 관측성 규약 (로그 레벨, MDC, 메트릭 네이밍): [`Observability 규약`](../../api-and-functional/functional/observability.md)
> 선택 근거 (왜 Loki/Graf/Prom 셀프 호스트?): [`인프라 결정 기록 (Decisions — Infrastructure)`](../deploy/decisions-infra.md) I-06

## 개요

**이 가이드는 운영(Mac mini)에서만 필요해요.** 로컬 개발 환경에서는 관측성 스택을 띄우지 않습니다 — 메모리·docker 리소스 부담 대비 활용 빈도가 낮아서예요. 대시보드·쿼리 동작 검증이 필요하면 운영 Mac mini 의 Grafana (예: `log.<domain>`) 에서 확인하세요.

로컬 compose(`infra/docker-compose.dev.yml`)는 Postgres + MinIO 만 제공합니다.

## 전제조건

- Mac mini (macOS, Apple Silicon 권장)
- OrbStack (Docker Desktop 대체, 메모리 효율 ↑) 설치
- 파생레포 checkout 상태 — 관측성 compose 는 파생레포 `infra/docker-compose.observability.yml` 에 있음
- `.env` 에 다음 값 준비:
  - `GRAFANA_ADMIN_PASSWORD` — 기본값 `admin` 대체 (운영 필수)
  - `DISCORD_WEBHOOK_URL` — 알림 발송용 (없으면 no-op)

## 기동

```bash
# 파생레포 루트에서
docker compose -f infra/docker-compose.observability.yml up -d

# 상태 확인
docker compose -f infra/docker-compose.observability.yml ps

# 로컬 엔드포인트 (Mac mini 내부에서만 접근 가능)
# Grafana:       http://localhost:3000
# Prometheus:    http://localhost:9090
# Loki ready:    http://localhost:3100/ready
# Alertmanager:  http://localhost:9093
```

**Spring (컨테이너) 이 actuator 메트릭을 `:8080/actuator/prometheus` 에 노출** (app port 와 공유). Prometheus 가 docker_sd_configs 로 kamal 네트워크 내 `role=web` 라벨 컨테이너를 자동 발견해 scrape. `application-prod.yml` 의 `management.endpoints.web.exposure.include` 로 `health, info, prometheus` 만 열어둠.

## Discord webhook 발급 (알림 수신)

1. Discord 서버 설정 → 연동 → 웹후크 → 새 웹후크
2. URL 복사 → Mac mini `.env` 에 `DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/<id>/<token>`
3. Alertmanager 가 URL 뒤에 `/slack` 을 자동 추가 (Discord 의 Slack-compat endpoint)

## 외부 접근 — Cloudflare Tunnel + Access

Grafana 를 외부(공개 도메인)에서 접근하려면 Cloudflare Tunnel ingress 규칙에 추가한다. 관리자 외 접근을 막으려면 Cloudflare Access 정책으로 이메일 OTP 게이팅.

**Cloudflare Tunnel (`~/.cloudflared/<파생레포>.yml` 예시 라인)**:
```yaml
ingress:
  - hostname: log.<domain>            # 예: log.yourdomain.com
    service: http://localhost:3000    # Grafana
  # ... 다른 라우팅
  - service: http_status:404
```

**Cloudflare Access 정책**:
- Cloudflare 대시보드 → Zero Trust → Access → Applications → Add application
- Type: Self-hosted
- Application domain: `log.<domain>`
- Policy: Email is `<본인-이메일>` (whitelist 방식)
- Identity provider: One-time PIN (Cloudflare Free 기본)

관리자 브라우저로 `https://log.<domain>` 접속 → 이메일 입력 → OTP 받기 → Grafana UI 진입.

## 대시보드 커스터마이징

기본 대시보드: `infra/grafana/dashboards/app-factory-overview.json`

수정 절차:
1. Grafana UI 에서 편집 → Save as
2. JSON export → 같은 경로에 commit (파생레포에서 — 본인 운영용 커스텀)
3. `provisioning/dashboards/dashboards.yml` 이 30초마다 reload

## dev / prod 라벨 분리

dev-server 도 같은 Loki/Grafana/Prometheus 인스턴스를 공유 (관측성 컨테이너 추가 X). env 라벨로 구분:

| metric 출처 | dev | prod |
|---|---|---|
| Loki (logback) | `env=dev` (`logback-common.xml` 의 dev profile) | `env=prod` (prod profile) |
| Prometheus metrics | `env=dev` (`management.metrics.tags.env`, `spring.profiles.active` 자동 반영) | `env=prod` |

LogQL / PromQL 필터 예:
```
{app="app-server-bootstrap", env="prod"} |= "ERROR"
sum(rate(http_server_requests_seconds_count{env="prod", status=~"5.."}[5m])) by (app)
```

Grafana 대시보드에 `$env` variable 을 추가하면 dev/prod 토글 가능. 기본 dashboard 는 `env="prod"` 하드코딩 — 필요 시 사용자가 dashboard JSON 에 variable 추가하여 재provision.

> ⚠ 알람 규칙 (`infra/prometheus/rules.yml`) 은 현재 env 필터 미적용 → dev 도 prod 규칙으로 평가됨. 단 alertmanager 가 운영 가동 전이라 실제 webhook 발사는 발생 안 함 (`mac-mini-setup.md` "restart loop, Phase 2 수정 예정"). alertmanager 활성화 시점에 rule expression 에 `env="prod"` 필터를 명시적으로 추가.

## Passive monitoring 정책

**Grafana panel 의 alert 기능은 본 프로젝트에서 사용 안 해요** (사용자 결정 2026-05-06).

| 영역 | 정책 |
|---|---|
| **Grafana panel-level alert** | **미사용**. 4 dashboard 모두 panel 에 alert 미첨부 — 운영자가 직접 보러 가는 passive 모드 |
| **Prometheus rules.yml (system-level)** | 사용 — `HighErrorRate`, `HighLatencyP95`, `RateLimitSpike`, `BackendDown`, `MinioDown` 5건. Discord webhook 으로 발송 |
| **보안 이벤트 alert** (로그인 실패 spike, webhook 검증 실패 등) | **미도입**. 솔로 운영자 alert fatigue 회피. 의심 사건은 `audit_logs` 테이블 + Loki ERROR 로그 직접 조회 |

이 정책의 trade-off:
- 장점: alert 발송 채널 (Discord 등) 관리 부담 0. alert fatigue 자동 회피.
- 단점: 운영자가 능동 점검 안 하면 사고 인지 늦음. Mac mini 자체 down (`BackendDown`) 같은 critical 사건만 Prometheus rules.yml 가 커버.
- 적용 조건: 솔로 운영자 + 트래픽 임계점 미도달 단계. 본격 prod 트래픽 들어오면 *passive → active* 로 정책 재평가 (backlog 항목).

새 dashboard / panel 추가 시:
- panel 의 `"alert"` 키 두지 말 것 (passive 정책)
- 시스템 critical alert 가 필요하면 `infra/prometheus/rules.yml` 에 Prometheus rule 로 추가

## 알림 튜닝

`infra/prometheus/rules.yml` 에서 임계치 조정. 예:
- 트래픽 적은 초기엔 `HighErrorRate > 5%` 로 완화
- MAU 증가 후 `> 1%` 로 엄격화

수정 후 Prometheus 재로드:
```bash
curl -X POST http://localhost:9090/-/reload
```

## 백업 (선택)

`infra/scripts/backup-to-nas.sh.example` 을 복사한 뒤 NAS 마운트 경로에 맞춰 수정해요. 대시보드 설정 (Grafana DB) 이 백업 우선순위예요. TSDB (Prometheus) 와 Loki chunks 는 용량이 크기 때문에 retention 재검토가 더 효과적일 수 있어요.

## 장애 대응

**"Grafana 에 메트릭 안 보임"**:
```bash
curl http://localhost:9090/api/v1/targets
# Prometheus scrape 상태 확인 — "state": "up" 인 job 이 있어야 함
# Spring 컨테이너 상태 + actuator 경로 응답 확인.
# 호스트에서 컨테이너 :8080 에 직접 접근하려면 docker exec 로 내부 진입하거나
# public 엔드포인트 (kamal-proxy 경유) 로 확인.
ssh storkspear@<mac-mini-ip> 'docker ps --filter label=service=template-spring --format "{{.Names}}\t{{.Status}}"'
curl -sI https://server.<domain>/actuator/health/liveness
```

**"로그가 Loki 에 안 쌓임"**:
```bash
curl "http://localhost:3100/loki/api/v1/labels"
# Spring 컨테이너 env LOKI_URL 확인 (컨테이너 내부에서는 http://host.docker.internal:3100)
# logback 설정에 loki appender 활성됐는지 확인 (SPRING_PROFILES_ACTIVE=prod 기준)
```

**재부팅 후 서비스 미기동**:
```bash
docker compose -f infra/docker-compose.observability.yml ps
# restart: unless-stopped 로 설정됐으니 대부분 자동 복구
# 수동 기동: docker compose ... up -d
```

**메모리 압박 (8GB 맥미니)**:
- `vm_stat` / `top -o mem` 로 확인
- Prometheus retention 단축 (`--storage.tsdb.retention.time=3d` 등)
- Loki log retention 감소
- 그래도 빠듯하면 I-06 재검토 트리거 도달 → NAS 로 관측성 분리 고려

## Lifecycle — `prod init` / `prod clear` 자동화 + multi-repo 안전

### 자동 deploy (`prod init`)

`<repo> prod init` 의 Step 9.5 가 Mac mini 측 observability stack 을 자동 deploy:

```
1. infra/ 디렉토리를 DEPLOY_HOST 로 rsync (compose + alertmanager/grafana/loki/prometheus config)
2. ssh + docker compose -f infra/docker-compose.observability.yml up -d
3. DISCORD_WEBHOOK_URL 채워졌으면 --profile alertmanager 도 함께 활성
```

이미 떠있으면 docker compose up 가 idempotent — 재기동 X.

### 자동 destroy 와 multi-repo 안전 — `--include-observability` flag 가 의도적인 이유

`<repo> prod clear` 의 default 는 observability 를 **유지** 해요. `--include-observability` flag 를 명시할 때만 4 컨테이너 + grafana-data volume 까지 함께 destroy 합니다. 이는 **여러 backend 가 1 대 Mac mini 를 공유하는 시나리오** 의 안전을 위함이에요.

#### 시나리오 — Mac mini 1 대에 backend 2 개 운영

```
Mac mini (예: 100.76.10.127)
├─ kamal app: gymlog-backend  →  gymlog.user.com
├─ kamal app: booklog-backend →  booklog.user.com
└─ observability stack (Loki / Grafana / Prometheus, alertmanager 옵션)
   └─ 두 backend 의 로그/메트릭을 모두 수집 → Grafana 대시보드 1 개에서
      label (app=gymlog / app=booklog) 로 구분
```

#### `prod clear` 동작 비교

| 명령 (gymlog repo 에서 실행) | 결과 |
|---|---|
| `gymlog-backend prod clear` (default) | gymlog kamal app + Cloudflare DNS/ingress 만 제거. observability 살아있어 **booklog 의 메트릭/로그 계속 수집** ✅ |
| `gymlog-backend prod clear --include-observability` | gymlog 정리 + observability 4 컨테이너 + grafana-data 까지 제거 → **booklog 의 dashboard/alert 끊김** ❌ |

→ multi-repo 환경에서 `--include-observability` 는 **다른 backend 의 관측성을 끊는 사고**를 일으킬 수 있어 default 제외. 명시적 flag 입력으로만 활성.

#### single-repo 사용자 (Mac mini 에 backend 1 개) 흐름

```bash
<repo> prod clear --include-observability   # observability 도 함께 destroy
<repo> prod init                              # observability 자동 재배치 (Step 9.5)
```

dogfood 또는 1 backend 운영 시에는 매 reset 마다 flag 를 명시해요. `prod init` 이 자동으로 재배치하므로 사이클이 짧아요.

## 다음 단계

- 평시/장애 대응: [`운영 런북 (Runbook)`](../deploy/runbook.md)
- 관측성 규약 (로깅/메트릭/알림): [`Observability 규약`](../../api-and-functional/functional/observability.md)
- 인프라 구성: [`인프라 (Infrastructure)`](../deploy/infrastructure.md)

---

## 관련 문서

- [`Observability 규약`](../../api-and-functional/functional/observability.md) — 메트릭/로그 규약
- [`운영 배포 가이드 (파생레포 onboarding)`](../deploy/deployment.md) — 운영 배포 파이프라인 (Kamal + GHA)
- [`인프라 (Infrastructure)`](../deploy/infrastructure.md) — 운영 구성도
- [`인프라 결정 기록 (Decisions — Infrastructure) I-06`](../deploy/decisions-infra.md) — 관측성 스택 선택 근거
