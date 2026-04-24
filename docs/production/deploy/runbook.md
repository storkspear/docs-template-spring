# 운영 런북 (Runbook)

평시 배포·롤백·장애 대응 절차. 파생 레포 최초 onboarding 은 [운영 배포 가이드 (파생레포 onboarding)](./deployment.md).

> **설계 배경**: [ADR-007 (솔로 친화적 운영)](../../philosophy/adr-007-solo-friendly-operations.md) — 운영 단위 1, 관리형 서비스 선호, 회색 지대 없는 CI. 운영 구성 상세: [인프라 (Infrastructure)](./infrastructure.md). 배포 결정 근거: [인프라 결정 기록 (Decisions — Infrastructure)](./decisions-infra.md).
>
> **독자 대상**: Level 2~3. 장애 상황에서 빠르게 찾을 수 있도록 최단 경로 · 명령어 중심으로 기술.

---

## 평시 배포

**자동**: `main` 브랜치에 push → CI 성공 → `deploy` workflow 가 `workflow_run` 으로 자동 트리거.

흐름:
1. CI (`./gradlew build`) 성공 → bootstrap jar 를 GHA artifact 로 업로드
2. deploy gate: CI 성공 + `DEPLOY_ENABLED=true` 통과
3. deploy job: artifact 다운로드 → `Dockerfile.runtime` 으로 docker build/push (`ghcr.io/.../...:<sha>`) → `kamal deploy --skip-push --version=<sha>`
4. 옛 GHCR 이미지 cleanup (최신 2개만 유지 — storage 한도 관리)

CI 가 실패하면 deploy 시작 안 함 (gate 차단). Test fail 코드는 절대 main 에서 배포 안 됨.

**수동 재배포** (GHA UI):
- Repo → Actions → deploy workflow → "Run workflow" → `version` 에 commit SHA 입력 (또는 비우면 현재 HEAD).
- 해당 SHA 의 이미지가 GHCR 에 있어야 함 (최신 2개만 유지하므로 그 이상 옛 SHA 면 없음 → 로컬 수동 경로 사용).

**수동 배포** (로컬, hotfix 시):
```bash
set -a; source .env; set +a
kamal deploy                    # 기존 Dockerfile (full build) 사용
kamal deploy --version <sha>    # 특정 커밋 재배포
```
로컬 경로는 GHA 와 별개로 기존 `Dockerfile` (multi-stage) 을 사용한다.

배포 중 실시간 로그: `kamal app logs -f`

---

## 롤백

### 옵션 A — kamal rollback (직전 배포로)
```bash
kamal app details                  # 최근 배포 목록 확인
kamal rollback <previous-version>  # 이전 version (SHA) 으로
```
GHCR 의 이미지가 살아있어야 함 (최신 2개 유지 정책 → 직전 1개는 항상 가능).

### 옵션 B — GHA workflow_dispatch (특정 SHA 재배포)
- Repo → Actions → deploy → "Run workflow" → `version` 에 commit SHA.
- 해당 SHA 의 이미지가 GHCR 에 없으면 GHA 가 jar 재빌드 → 이미지 새로 만들어 push 후 배포 (8분+).

### 옵션 C — revert PR (코드 자체를 되돌림)
- 깨진 PR 을 revert → main 에 머지 → 자동 CI/CD 사이클 (~10분).
- 가장 안전하지만 가장 느림.

---

## 블루/그린 배포 + Flyway migration 원칙

### 일반 원칙
- Spring 기동 시 Flyway 가 **advisory lock** 을 잡아 Blue 와 Green 이 동시에 migrate 시도해도 스키마 손상은 없다. 뒤에 온 쪽이 락 경쟁에 지면 blocked → health check 타임아웃 → 해당 컨테이너만 실패 (서비스 전체는 Blue 로 계속 서빙).
- 이 상황이 발생하면 재시도하면 대부분 해결된다 (첫 쪽이 migrate 완료한 후).

### Expand/Contract 규율 (파괴적 DDL 금지)
한 배포에 들어가는 Flyway migration 은 "뒤로 호환" 해야 한다:
- ✅ 컬럼 추가 (NULL 허용)
- ✅ 인덱스 추가
- ✅ 새 테이블 생성
- ❌ 컬럼 삭제 / 이름 변경
- ❌ NOT NULL 로 변경 (기존 데이터에 NULL 있을 때)
- ❌ 데이터 타입 변경

파괴적 DDL 이 필요할 땐 **2단계 배포**:
1. 코드 + 신규 컬럼 추가 migration (뒤로 호환) → 배포 → 모든 요청이 신규 필드 사용 확인
2. 다음 배포에서 구 컬럼 삭제 migration

### 수동 out-of-band migration (DB 변경만 먼저 돌리기)
Green 기동 전에 미리 migrate 만 끝내고 싶을 때:
```bash
ssh storkspear@<tailscale-ip>
docker pull ghcr.io/<owner>/<repo>:<tag>
docker run --rm --env-file /path/to/prod.env ghcr.io/<owner>/<repo>:<tag> migrate-only
```
`migrate-only` 모드는 docker-entrypoint.sh 가 처리 — Flyway 만 실행 후 exit 0.

---

## 로그 확인

### 1차 진단 (컨테이너 직접)
```bash
kamal app logs -f --lines 500
# 또는 원격에서 직접:
ssh storkspear@<tailscale-ip> 'docker ps --filter "name=<파생레포>-web"'
ssh storkspear@<tailscale-ip> 'docker logs <container-id> -f'
```

### Grafana / Loki
`https://log.<도메인>` → Explore → Data source: Loki → 쿼리:
```
{app="<slug>"} |= "ERROR"
{app="<slug>"} | json | level="ERROR" | traceId != ""
```

---

## SSH 접근 / 긴급 조치

```bash
ssh storkspear@<tailscale-ip>        # Tailscale IP 로 접근 (public IP 노출 없음)
```

**Grafana OTP 이메일 안 옴**:
Tailscale 로 Mac mini 에 붙은 뒤 `http://localhost:3000` 직접 접속 (LAN 내부라 CF Access 우회).

**kamal-proxy 가 죽었을 때**:
```bash
ssh storkspear@<tailscale-ip>
docker ps -a --filter name=kamal-proxy
docker start kamal-proxy
# 심하면: kamal proxy reboot
```

---

## 장애 첫 3가지 체크

장애 감지 시 순서:

1. **외부 HTTPS 엔드포인트 상태**
   ```bash
   curl -sSfv https://server.<도메인>/actuator/health/liveness 2>&1 | head -30
   ```
   - 200 OK → 앱은 살아있음, 특정 엔드포인트 문제일 수 있음
   - 522/530 → Cloudflare Tunnel 장애 (cloudflared 프로세스 확인)
   - 502/503 → kamal-proxy 는 살아있으나 백엔드 Spring 컨테이너 문제
   - 이상 없으면 사용자 측 문제일 수도 (Cloudflare 대시보드 → Analytics 확인)

2. **Mac mini 메모리 / 디스크 / CPU**
   ```bash
   ssh storkspear@<tailscale-ip> 'vm_stat | head -20; top -l 1 -n 10 -o mem; df -h /'
   ```
   - free memory < 500MB → 컨테이너 일부 OOM 킬 의심. `docker logs` 로 확인
   - disk < 5GB → `docker system prune` 또는 Prometheus retention 축소

3. **관측성 스택 상태**
   ```bash
   ssh storkspear@<tailscale-ip> 'docker compose -f /path/to/<파생레포>/infra/docker-compose.observability.yml ps'
   ```
   - 모두 running 이어야 함. 내려가 있으면 `up -d` 로 재기동.

---

## Mac mini 재부팅 후 자동 복구 확인

- **cloudflared**: launchd `KeepAlive=true` → 자동 기동.
- **관측성 컨테이너**: `restart: unless-stopped` → 자동 기동.
- **Kamal Spring 컨테이너**: `restart: unless-stopped` (Kamal 기본) → 자동 기동.

수동 재기동:
```bash
launchctl kickstart -k gui/$(id -u)/site.<파생레포>.cloudflared
docker compose -f <repo>/infra/docker-compose.observability.yml up -d
kamal app boot                # 마지막 배포 버전으로 다시 기동
```

---

## 인시던트 회고 템플릿

장애 해결 후:
1. 무엇이 깨졌는가 (증상)
2. 근본 원인
3. 임시 조치
4. 영구 조치 (아직 안 한 것 포함)
5. 재발 방지 체크 / 테스트 / 모니터링 개선
6. 이 런북에 추가할 내용

`docs/infra/edge-cases.md` 와 `docs/reference/backlog.md` 에 해당 항목 반영 또는 추가.

---

## 관련 문서

### 배포 / 운영
- [운영 배포 가이드 (파생레포 onboarding)](./deployment.md) — 파생 레포 onboarding (최초 1회)
- [CI / CD 전체 플로우 — commit 부터 운영 반영까지](./ci-cd-flow.md) — commit → 운영 반영 전체 흐름
- [인프라 (Infrastructure)](./infrastructure.md) — 전체 구성도
- [인프라 결정 기록 (Decisions — Infrastructure)](./decisions-infra.md) — 인프라 결정 카드 (I-01~I-09)

### 관측성 / 보안
- [운영 모니터링 셋업 가이드](../setup/monitoring-setup.md) — 관측성 스택 기동
- [Observability 규약](../../api-and-functional/functional/observability.md) — 관측성 규약
- [키 교체 절차 (Key Rotation)](../setup/key-rotation.md) — 보안 키 로테이션 절차

### 장애 / 회고
- [Edge Cases & Risk Analysis](../../reference/edge-cases.md) — 리스크 시나리오 · 엣지 케이스 목록
- [Backlog](../../planned/backlog.md) — 미완료 항목 (인시던트 회고 추가 대상)

### 설계 배경
- [ADR-007 · 솔로 친화적 운영](../../philosophy/adr-007-solo-friendly-operations.md) — 솔로 운영 원칙
- [ADR-001 · 모듈러 모놀리스 (Modular Monolith)](../../philosophy/adr-001-modular-monolith.md) — 단일 JVM 운영 단위
