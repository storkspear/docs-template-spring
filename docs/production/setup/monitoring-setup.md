# 운영 모니터링 셋업 가이드

> **유형**: How-to · **독자**: Level 2.5 · **읽는 시간**: ~5분

**설계 근거**: [ADR-007 (솔로 친화적 운영)](../../philosophy/adr-007-solo-friendly-operations.md)

Mac mini 운영 호스트에서 관측성 스택(Loki + Grafana + Prometheus + Alertmanager)을 기동·운영하는 방법.

> 인프라 전체 구성 / 책임 분담: [인프라 (Infrastructure)](../deploy/infrastructure.md)
> 관측성 규약 (로그 레벨, MDC, 메트릭 네이밍): [Observability 규약](../../api-and-functional/functional/observability.md)
> 선택 근거 (왜 Loki/Graf/Prom 셀프 호스트?): [인프라 결정 기록 (Decisions — Infrastructure)](../deploy/decisions-infra.md) I-06

## 개요

**이 가이드는 운영(Mac mini)에서만 필요하다.** 로컬 개발 환경에서는 관측성 스택을 띄우지 않는다 — 메모리·docker 리소스 부담 대비 활용 빈도가 낮다. 대시보드·쿼리 동작 검증이 필요하면 운영 Mac mini 의 Grafana (예: `log.<domain>`) 에서 확인한다.

로컬 compose(`infra/docker-compose.dev.yml`)는 Postgres + MinIO 만 제공한다.

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

## 알림 튜닝

`infra/prometheus/rules.yml` 에서 임계치 조정. 예:
- 트래픽 적은 초기엔 `HighErrorRate > 5%` 로 완화
- MAU 증가 후 `> 1%` 로 엄격화

수정 후 Prometheus 재로드:
```bash
curl -X POST http://localhost:9090/-/reload
```

## 백업 (선택)

`infra/scripts/backup-to-nas.sh.example` 복사 후 NAS 마운트 경로 맞춰 수정. 대시보드 설정(Grafana DB) 은 백업 우선순위. TSDB(Prometheus) 와 Loki chunks 는 용량 크니 retention 재검토가 더 효과적일 수 있음.

## 장애 대응

**"Grafana 에 메트릭 안 보임"**:
```bash
curl http://localhost:9090/api/v1/targets
# Prometheus scrape 상태 확인 — "state": "up" 인 job 이 있어야 함
# Spring 컨테이너 상태 + actuator 경로 응답 확인.
# 호스트에서 컨테이너 :8080 에 직접 접근하려면 docker exec 로 내부 진입하거나
# public 엔드포인트 (kamal-proxy 경유) 로 확인.
ssh storkspear@<mac-mini-ip> 'docker ps --filter label=service=spring-backend-template --format "{{.Names}}\t{{.Status}}"'
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

## 다음 단계

- 평시/장애 대응: [운영 런북 (Runbook)](../deploy/runbook.md)
- 관측성 규약 (로깅/메트릭/알림): [Observability 규약](../../api-and-functional/functional/observability.md)
- 인프라 구성: [인프라 (Infrastructure)](../deploy/infrastructure.md)

---

## 관련 문서

- [Observability 규약](../../api-and-functional/functional/observability.md) — 메트릭/로그 규약
- [운영 배포 가이드 (파생레포 onboarding)](../deploy/deployment.md) — 운영 배포 파이프라인 (Kamal + GHA)
- [인프라 (Infrastructure)](../deploy/infrastructure.md) — 운영 구성도
- [인프라 결정 기록 (Decisions — Infrastructure) I-06](../deploy/decisions-infra.md) — 관측성 스택 선택 근거
