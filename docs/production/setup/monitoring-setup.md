# 운영 모니터링 셋업 가이드

> **유형**: How-to · **독자**: Level 2 · **읽는 시간**: ~5분

**설계 근거**: [`ADR-007 · 솔로 친화적 운영`](../../philosophy/adr-007-solo-friendly-operations.md)

Mac mini 운영 호스트에서 관측성 스택을 기동하고 운영하는 절차예요. 스택은 네 컴포넌트로 구성됩니다. 로그를 모으는 Loki, 메트릭을 수집하는 Prometheus, 둘을 대시보드로 보여주는 Grafana, 임계치를 넘으면 알림을 보내는 Alertmanager.

함께 보면 좋은 문서는 다음과 같아요.

- 인프라 전체 구성과 책임 분담: [`인프라 (Infrastructure)`](../deploy/infrastructure.md)
- 관측성 규약 (로그 레벨·MDC·메트릭 네이밍): [`Observability 규약`](../../api-and-functional/functional/observability.md)
- 왜 Loki·Grafana·Prometheus 를 셀프 호스트하나: [`인프라 결정 기록 (Decisions — Infrastructure)`](../deploy/decisions-infra.md) 의 결정 I-06

## 개요

**목표**는 운영 Mac mini 에서 관측성 스택을 띄우고, 외부에서 안전하게 Grafana 에 접속하고, 알림을 받는 상태까지 도달하는 거예요. **대상 독자**는 이미 한 번 운영 배포를 해 본 운영자예요. **예상 시간**은 처음 셋업 기준 20~30분이고, `prod init` 자동화를 쓰면 더 짧아요.

이 가이드는 운영 호스트에서만 필요해요. 로컬 개발 환경에서는 관측성 스택을 띄우지 않습니다. 메모리와 docker 리소스 부담에 비해 쓰는 빈도가 낮아서예요. 로컬 compose 인 `infra/docker-compose.local.yml` 은 Postgres 와 MinIO 만 제공합니다. 대시보드나 쿼리 동작을 검증해야 하면 운영 Mac mini 의 Grafana 에서 확인하세요.

## 전제조건

- Mac mini (macOS, Apple Silicon 권장)
- OrbStack 설치 — Docker Desktop 대체재로, 메모리 효율이 더 좋아요
- 파생 레포 checkout 상태 — 관측성 compose 는 파생 레포의 `infra/docker-compose.observability.yml` 에 있어요
- `.env` 에 다음 값을 준비:
  - `GRAFANA_ADMIN_PASSWORD` — 기본값 `admin` 을 대체하는 운영 비밀번호 (운영 필수)
  - `DISCORD_WEBHOOK_URL` — 알림 발송용. 비워 두면 Alertmanager 가 무음으로 동작해요

## 기동

```bash
# 파생 레포 루트에서
docker compose -f infra/docker-compose.observability.yml up -d

# 상태 확인
docker compose -f infra/docker-compose.observability.yml ps

# 로컬 엔드포인트 — Mac mini 내부에서만 접근 가능
# Grafana:       http://localhost:3000
# Prometheus:    http://localhost:9090
# Loki ready:    http://localhost:3100/ready
# Alertmanager:  http://localhost:9093
```

성공하면 네 컨테이너가 모두 `Up` 상태로 나와요. 단 Alertmanager 는 `--profile alertmanager` 를 붙여야 기동돼요 (아래 [Discord webhook 발급](#discord-webhook-발급-알림-수신) 참고).

관측성 compose 는 Kamal 이 만든 `kamal` 네트워크에 external 로 조인해요. 그래서 Spring 컨테이너 이름이 배포마다 바뀌어도 Prometheus 가 컨테이너를 찾아낼 수 있어요. Prometheus 는 `docker_sd_configs` 로 `role=web` 라벨이 붙은 컨테이너를 자동 발견해 `:8080/actuator/prometheus` 를 scrape 합니다. 이 actuator 메트릭은 별도 포트가 아니라 앱 포트와 공유해요. prod 컨테이너는 `config/deploy.yml` 의 `SERVER_PORT: 8080` override 로 8080 에서 동작하고, `application-prod.yml` 이 `management.endpoints.web.exposure.include` 를 `health, info, prometheus` 셋으로만 제한합니다.

## Discord webhook 발급 (알림 수신)

1. Discord 서버 설정 → 연동 → 웹후크 → 새 웹후크
2. URL 복사 후 Mac mini `.env` 에 `DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/<id>/<token>/slack` 형태로 저장. URL 끝에 `/slack` 을 붙여야 해요. Discord 가 제공하는 Slack 호환 엔드포인트를 Alertmanager 의 Slack 알림이 그대로 쓰기 때문이에요
3. Alertmanager 를 profile 로 활성: `docker compose -f infra/docker-compose.observability.yml --profile alertmanager up -d`

`DISCORD_WEBHOOK_URL` 이 비어 있으면 Alertmanager 의 webhook URL 도 빈 문자열이 돼 컨테이너가 restart loop 에 빠져요. 그래서 profile 로 분리해 두고, URL 이 채워졌을 때만 켜요. `prod init` 자동화는 이 값이 있을 때만 Alertmanager 를 같이 띄웁니다.

## 외부 접근 — Cloudflare Tunnel + Access

Grafana 를 외부 공개 도메인에서 보려면 Cloudflare Tunnel 의 ingress 규칙에 추가해요. 관리자 외 접근을 막으려면 Cloudflare Access 정책으로 이메일 OTP 게이팅을 걸어요.

Cloudflare Tunnel 설정 파일 `~/.cloudflared/<파생레포>.yml` 에 ingress 라인을 추가합니다.

```yaml
ingress:
  - hostname: log.<domain>            # 예: log.yourdomain.com
    service: http://localhost:3000    # Grafana
  # ... 다른 라우팅
  - service: http_status:404
```

Cloudflare Access 정책은 대시보드에서 설정해요.

- Cloudflare 대시보드 → Zero Trust → Access → Applications → Add application
- Type 은 Self-hosted
- Application domain 은 `log.<domain>`
- Policy 는 본인 이메일만 허용하는 whitelist 방식
- Identity provider 는 One-time PIN (Cloudflare Free 기본 제공)

관리자 브라우저로 `https://log.<domain>` 에 접속하면 이메일 입력 → OTP 수신 → Grafana UI 진입 순서로 들어가요.

## 대시보드 커스터마이징

기본 대시보드는 네 개예요. App Factory Overview, Auth Flow, Billing Notifications, Logs Quickview 가 `infra/grafana/dashboards/` 에 JSON 으로 들어 있어요.

수정 절차는 다음과 같아요.

1. Grafana UI 에서 편집한 뒤 Save as
2. JSON 을 export 해 같은 경로에 commit. 파생 레포의 본인 운영용 커스텀이에요
3. `provisioning/dashboards/dashboards.yml` 이 30초마다 reload 하므로 자동 반영돼요

## dev / prod 라벨 분리

dev-server 도 같은 Loki·Grafana·Prometheus 인스턴스를 공유해요. 관측성 컨테이너를 따로 띄우지 않고, env 라벨로 구분합니다.

| 출처 | dev 라벨 | prod 라벨 | 부여 위치 |
|---|---|---|---|
| Loki 로그 | `env=dev` | `env=prod` | `logback-common.xml` 의 dev / prod profile |
| Prometheus 메트릭 | `env=dev` | `env=prod` | `application.yml` 의 `management.metrics.tags.env` (활성 profile 자동 반영) |

LogQL 과 PromQL 필터 예시는 다음과 같아요. 앱 식별 라벨 `app` 의 값은 `spring.application.name` 으로, 본 템플릿에서는 `app-factory` 예요. 파생 레포는 각자의 `spring.application.name` 으로 바뀝니다.

```
{app="app-factory", env="prod"} |= "ERROR"
sum(rate(http_server_requests_seconds_count{env="prod", status=~"5.."}[5m])) by (app)
```

Grafana 대시보드에 `$env` variable 을 추가하면 dev / prod 토글이 가능해요. 기본 대시보드는 `env="prod"` 로 하드코딩돼 있으니, 필요하면 대시보드 JSON 에 variable 을 추가해 재provision 하세요.

> ⚠ 알람 규칙 `infra/prometheus/rules.yml` 은 현재 env 필터를 적용하지 않아요. dev 도 prod 규칙으로 평가됩니다. 단 Alertmanager 가 운영 가동 전이라 실제 webhook 발사는 일어나지 않아요 (`mac-mini-setup.md` 의 "restart loop, Phase 2 수정 예정"). Alertmanager 활성화 시점에 rule expression 에 `env="prod"` 필터를 명시적으로 추가하세요.

## Passive monitoring 정책

Grafana panel 의 alert 기능은 본 프로젝트에서 쓰지 않아요 (사용자 결정 2026-05-06). 운영자가 직접 대시보드를 보러 가는 passive 모드로 운영하고, 시스템 레벨 alert 만 Prometheus 가 담당해요.

| 영역 | 정책 |
|---|---|
| Grafana panel-level alert | 미사용. 네 대시보드 모두 panel 에 alert 를 달지 않습니다 |
| Prometheus `rules.yml` (system-level) | 사용. 임계치를 넘으면 Discord webhook 으로 발송 |
| 보안 이벤트 alert (로그인 실패 spike, webhook 검증 실패 등) | 미도입. 솔로 운영자의 alert fatigue 를 피하려는 결정. 의심 사건은 `audit_logs` 테이블 + Loki ERROR 로그로 직접 조회 |

이 정책의 trade-off 를 정리하면, 장점은 alert 채널 관리 부담이 없고 alert fatigue 를 자동으로 피한다는 점이에요. 단점은 운영자가 능동 점검을 안 하면 사고 인지가 늦어진다는 점이고요. 솔로 운영자이면서 트래픽 임계점에 도달하지 않은 단계에 맞는 선택이에요. 본격 prod 트래픽이 들어오면 passive 에서 active 로 정책을 재평가해요 (backlog 항목).

새 dashboard 나 panel 을 추가할 때는 panel 에 `"alert"` 키를 두지 마세요. 시스템 critical alert 가 필요하면 `infra/prometheus/rules.yml` 에 Prometheus rule 로 추가합니다.

## 알림 튜닝

`infra/prometheus/rules.yml` 에서 임계치를 조정해요. 현재 정의된 규칙은 8개입니다. 5xx 에러율을 보는 `HighErrorRate`, p95 지연을 보는 `HighLatencyP95`, 429 빈발을 보는 `RateLimitSpike`, scrape 실패를 보는 `BackendDown`, MinIO 도달 실패를 보는 `MinioDown`, 그리고 NAS 디스크 사용률 70 / 85 / 95% 세 단계예요.

임계치 조정 예시는 다음과 같아요.

- 트래픽이 적은 초기엔 `HighErrorRate` 를 5% 로 완화 (현재 기본값은 1%)
- MAU 가 늘면 다시 1% 로 엄격하게

> ⚠ `BackendDown` 규칙은 `up{job="app-factory-backend"}` 를 보지만, `prometheus.yml` 의 실제 scrape job 이름은 `spring-backend` 예요. 라벨이 어긋나 현재로선 발사되지 않아요. Mac mini 자체 down 알림에 의존하려면 rule 의 job 이름을 `spring-backend` 로 맞춰야 합니다 (backlog 항목).

수정한 뒤 Prometheus 를 reload 해요.

```bash
curl -X POST http://localhost:9090/-/reload
```

## 백업 (선택)

`infra/scripts/backup-to-nas.sh.example` 을 복사한 뒤 NAS 마운트 경로에 맞춰 수정해요. 대시보드 설정이 들어 있는 Grafana DB 가 백업 우선순위예요. Prometheus TSDB 와 Loki chunks 는 용량이 크니, 백업보다 retention 재검토가 더 효과적일 수 있어요.

## 장애 대응

**Grafana 에 메트릭이 안 보일 때**:

```bash
curl http://localhost:9090/api/v1/targets
# Prometheus scrape 상태 확인 — "state": "up" 인 job 이 있어야 함.
# Spring 컨테이너 상태 + actuator 경로 응답 확인.
# <service> 자리에 파생 레포의 Kamal service 이름 (KAMAL_SERVICE_NAME, 예: storkspear-backend) 을 넣음.
ssh storkspear@<mac-mini-ip> 'docker ps --filter label=service=<service> --format "{{.Names}}\t{{.Status}}"'
curl -sI https://server.<domain>/actuator/health/liveness
```

**로그가 Loki 에 안 쌓일 때**:

```bash
curl "http://localhost:3100/loki/api/v1/labels"
# Spring 컨테이너 env LOKI_URL 확인 — 컨테이너 내부에서는 http://loki:3100/loki/api/v1/push.
# logback 설정에 LOKI appender 가 활성됐는지 확인 (SPRING_PROFILES_ACTIVE=prod 기준).
```

**재부팅 후 서비스가 안 떠 있을 때**:

```bash
docker compose -f infra/docker-compose.observability.yml ps
# restart: unless-stopped 라 대부분 자동 복구됨.
# 수동 기동: docker compose -f infra/docker-compose.observability.yml up -d
```

**메모리 압박 (8GB Mac mini)**:

```bash
vm_stat        # 또는 top -o mem 으로 메모리 확인
```

그래도 빠듯하면 Prometheus retention 을 줄이거나 (`--storage.tsdb.retention.time=3d` 등), Loki retention 을 줄여요. 한계에 다다르면 I-06 재검토 트리거에 도달한 거라, 관측성 스택을 NAS 로 분리하는 방안을 고려하세요.

## Lifecycle — `prod init` / `prod clear` 자동화 + multi-repo 안전

### 자동 deploy (`prod init`)

`<repo> prod init` 의 Step 9.5 가 Mac mini 측 관측성 스택을 자동 배포해요. 동작 순서는 다음과 같아요.

```
infra/ 디렉토리를 DEPLOY_HOST 로 rsync
   ↓
ssh + docker compose -f infra/docker-compose.observability.yml up -d
   ↓
DISCORD_WEBHOOK_URL 이 채워졌으면 --profile alertmanager 도 활성
```

이미 떠 있으면 `docker compose up` 이 idempotent 하게 동작해 재기동하지 않아요.

### 자동 destroy 와 multi-repo 안전 — `--include-observability` flag 가 의도적인 이유

`<repo> prod clear` 의 default 는 관측성 스택을 유지해요. `--include-observability` flag 를 명시할 때만 컨테이너와 grafana-data volume 까지 함께 destroy 합니다. 이는 여러 backend 가 Mac mini 한 대를 공유하는 시나리오에서 안전을 지키기 위함이에요.

#### 시나리오 — Mac mini 1 대에 backend 2 개 운영

```
Mac mini (예: 100.76.10.127)
├─ kamal app: gymlog-backend  →  gymlog.user.com
├─ kamal app: booklog-backend →  booklog.user.com
└─ observability stack (Loki / Grafana / Prometheus, alertmanager 옵션)
   └─ 두 backend 의 로그·메트릭을 모두 수집 → Grafana 대시보드 한 개에서
      app 라벨 (app=gymlog / app=booklog) 로 구분
```

#### `prod clear` 동작 비교

| gymlog 레포에서 실행한 명령 | 결과 |
|---|---|
| `gymlog-backend prod clear` (default) | gymlog kamal app + Cloudflare DNS / ingress 만 제거. 관측성 스택이 살아 있어 booklog 의 메트릭·로그를 계속 수집 ✅ |
| `gymlog-backend prod clear --include-observability` | gymlog 정리 + 관측성 컨테이너 + grafana-data 까지 제거. booklog 의 dashboard·alert 가 끊김 ❌ |

multi-repo 환경에서 `--include-observability` 는 다른 backend 의 관측성을 끊는 사고를 일으킬 수 있어 default 에서 제외했어요. `cleanup-server.sh` 가 이 flag 를 받으면 grafana·loki·prometheus 세 컨테이너와 grafana-data / loki-data / prometheus-data volume 을 제거합니다.

#### single-repo 사용자 (Mac mini 에 backend 1 개) 흐름

```bash
<repo> prod clear --include-observability   # 관측성도 함께 destroy
<repo> prod init                            # 관측성 자동 재배치 (Step 9.5)
```

도그푸딩이나 backend 1개 운영이라면 매 reset 마다 flag 를 명시해요. `prod init` 이 자동으로 재배치하므로 사이클이 짧아요.

## 다음 단계

- 평시 운영과 장애 대응: [`운영 런북 (Runbook)`](../deploy/runbook.md)
- 관측성 규약 (로깅·메트릭·알림): [`Observability 규약`](../../api-and-functional/functional/observability.md)
- 인프라 구성: [`인프라 (Infrastructure)`](../deploy/infrastructure.md)

---

## 관련 문서

- [`Observability 규약`](../../api-and-functional/functional/observability.md) — 메트릭·로그 규약
- [`운영 배포 가이드 (파생 레포 onboarding)`](../deploy/deployment.md) — 운영 배포 파이프라인 (Kamal + GitHub Actions)
- [`인프라 (Infrastructure)`](../deploy/infrastructure.md) — 운영 구성도
- [`인프라 결정 기록 (Decisions — Infrastructure)`](../deploy/decisions-infra.md) — 관측성 스택 선택 근거 (결정 I-06)
