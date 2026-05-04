# 운영 런북 (Runbook)

> **유형**: Runbook · **독자**: Level 2~3 · **읽는 시간**: ~10분

평시 배포·롤백·장애 대응 절차예요. 파생 레포 최초 onboarding 은 [`운영 배포 가이드 (파생레포 onboarding)`](./deployment.md) 에서 다룹니다.

> **설계 배경**: [`ADR-007 (솔로 친화적 운영)`](../../philosophy/adr-007-solo-friendly-operations.md) — 운영 단위 1, 관리형 서비스 선호, 회색 지대 없는 CI. 운영 구성 상세: [`인프라 (Infrastructure)`](./infrastructure.md). 배포 결정 근거: [`인프라 결정 기록 (Decisions — Infrastructure)`](./decisions-infra.md).
>
> **독자 대상**: Level 2~3. 장애 상황에서 빠르게 찾을 수 있도록 최단 경로 · 명령어 중심으로 기술.

---

## 평시 배포

**자동 흐름** — `main` 브랜치에 push 하면 CI 가 성공한 뒤 `deploy` workflow 가 `workflow_run` 으로 자동 트리거됩니다.

흐름은 다음과 같아요.

1. CI (`./gradlew build`) 가 성공하면 bootstrap jar 를 GHA artifact 로 업로드합니다.
2. deploy gate 에서 CI 성공 + `DEPLOY_ENABLED=true` 를 통과해야 다음 단계로 넘어갑니다.
3. deploy job 이 artifact 를 다운로드하고 `Dockerfile.runtime` 으로 docker build/push (`ghcr.io/.../...:<sha>`) 한 뒤 `kamal deploy --skip-push --version=<sha>` 를 실행합니다.
4. 옛 GHCR 이미지를 cleanup 합니다 (최신 2개만 유지 — storage 한도 관리).

CI 가 실패하면 deploy 가 시작되지 않아요 (gate 가 차단). Test fail 코드는 절대 main 에서 배포되지 않습니다.

**수동 재배포** (GHA UI):
- Repo → Actions → deploy workflow → "Run workflow" → `version` 에 commit SHA 를 입력합니다 (비우면 현재 HEAD 가 적용돼요).
- 해당 SHA 의 이미지가 GHCR 에 있어야 동작합니다. 최신 2개만 유지하니까 그 이상 옛 SHA 면 GHCR 에 없어서 로컬 수동 경로를 사용해야 해요.

**수동 배포** (로컬, GHA 우회 / hotfix):

```bash
<your-backend> prod deploy              # 권장 — 자동으로 origin/main SHA 기준
<your-backend> prod deploy --version <sha>  # 특정 SHA 재배포 (rollback 등)
```

내부 동작 (`tools/deploy.sh` Step 0) 은 다음 순서로 진행됩니다.

1. `git fetch origin main` 으로 최신 SHA 를 가져와 `ORIGIN_SHA` 변수에 담습니다.
2. `--version` 이 명시되지 않은 경우 `VERSION=$ORIGIN_SHA` 로 자동 설정됩니다.
3. `kamal deploy --version=$VERSION` 이 호출되어, kamal 이 `Dockerfile` (multi-stage) 로 그 SHA 의 코드를 git clone + reset --hard 한 뒤 빌드합니다.

이 흐름의 핵심은 **로컬 working tree 와 HEAD 가 빌드에 영향을 주지 않는다는 점** 입니다. commit·push 는 사용자의 책임이며 deploy 는 항상 origin 코드를 기준으로 동작합니다. 로컬에 미커밋 변경이 있어도 빌드 결과는 동일하고 (정보성 warning 만 출력됩니다), GHA 경로의 `Dockerfile.runtime` 과는 빌드 dockerfile 부터 별개의 흐름입니다.

배포 중 실시간 로그는 `<your-backend> prod logs` 또는 `kamal app logs -f` 로 확인할 수 있습니다.

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

Spring 기동 시 Flyway 가 **advisory lock** 을 잡기 때문에, Blue 와 Green 이 동시에 migrate 를 시도해도 스키마가 손상되지 않습니다. 뒤에 온 쪽이 락 경쟁에서 지면 blocked 상태가 되어 health check 타임아웃이 나고, 해당 컨테이너만 실패합니다 (서비스 전체는 Blue 로 계속 서빙해요).

이 상황이 발생했을 때 재시도하면 대부분 해결돼요. 첫 쪽이 migrate 를 완료한 다음에 두 번째 시도가 진행되기 때문입니다.

### Expand/Contract 규율 (파괴적 DDL 금지)

한 배포에 들어가는 Flyway migration 은 **뒤로 호환** 되어야 합니다.

- ✅ 컬럼 추가 (NULL 허용)
- ✅ 인덱스 추가
- ✅ 새 테이블 생성
- ❌ 컬럼 삭제 / 이름 변경
- ❌ NOT NULL 로 변경 (기존 데이터에 NULL 있을 때)
- ❌ 데이터 타입 변경

파괴적 DDL 이 필요할 땐 **2단계 배포** 로 진행해요.

1. 코드 + 신규 컬럼 추가 migration (뒤로 호환) → 배포 → 모든 요청이 신규 필드를 사용하는지 확인합니다.
2. 다음 배포에서 구 컬럼 삭제 migration 을 적용합니다.

### 수동 out-of-band migration (DB 변경만 먼저 돌리기)

Green 기동 전에 미리 migrate 만 끝내고 싶을 때 다음 명령을 사용합니다.

```bash
ssh storkspear@<tailscale-ip>
docker pull ghcr.io/<owner>/<repo>:<tag>
docker run --rm --env-file /path/to/prod.env ghcr.io/<owner>/<repo>:<tag> migrate-only
```

`migrate-only` 모드는 `docker-entrypoint.sh` 가 처리합니다. Flyway 만 실행한 뒤 exit 0 으로 종료됩니다.

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
   - 모두 running 이어야 해요. 내려가 있으면 `up -d` 로 재기동해요.

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

## 운영 환경 정리 — clear / force-clear

도그푸딩이 끝났거나 운영 환경을 처음부터 다시 구성해야 할 때 사용합니다. 두 명령은 *삭제 범위* 가 다르므로 상황에 맞게 선택해야 합니다.

`prod clear` 는 *인프라만* 정리합니다. Cloudflare 의 DNS 레코드와 Tunnel ingress 를 제거하고, Mac mini 에서 `kamal app remove` 로 컨테이너를 내립니다. 데이터 (DB schema 와 Object Storage bucket) 와 관측성 데이터는 보존됩니다.

```bash
<your-backend> prod clear              # 'YES' 명시 confirm 후 진행
```

`prod force-clear` 는 *clear 의 모든 동작에 더해* 데이터와 관측성까지 영구 삭제합니다. 슬러그를 지정하면 해당 앱의 schema 와 bucket 만, 슬러그를 생략하면 모든 앱과 core 까지 모두 삭제됩니다.

```bash
<your-backend> prod force-clear myapp   # 해당 앱만 (myapp schema + myapp-* bucket)
<your-backend> prod force-clear         # 모든 앱 + core 전부 삭제
```

`force-clear` 는 5 단계의 confirm 을 차례로 거치며, 한 단계라도 'y' 외 입력이 들어오면 즉시 abort 됩니다. 단계는 DB 데이터 / Storage 데이터 / 관측성 데이터 / 백업 의향 / 최종 확인 순서입니다. 백업 의향 단계에서 'y' 를 선택하면 manual 백업 명령을 출력하고 종료하며, 자동 백업은 현재 개발 중이어서 manual 절차만 안내됩니다.

### 왜 `clear` 는 관측성 (로그·메트릭) 을 보존하는가

관측성 스택 (Grafana 대시보드, Loki 로그 스트림, Prometheus 메트릭) 은 *모든 슬러그가 공유하는 단일 인스턴스* 입니다. 슬러그 하나만 정리하려는 운영자가 관측성을 함께 지우면 다른 슬러그의 모니터링 히스토리까지 잃게 되므로, `clear` 는 의도적으로 관측성을 건드리지 않습니다. 데이터도 같은 이유로 보존합니다 — DB 의 `core` schema 와 Object Storage 의 공통 bucket 은 여러 슬러그가 함께 사용하기 때문입니다.

`force-clear` 는 *모든 슬러그를 한꺼번에 정리할 때* (예: 도그푸딩 환경 전체 초기화) 를 위해 관측성까지 삭제 옵션을 제공합니다. 슬러그를 지정하지 않은 경우 (`prod force-clear` 단독 호출) 가 그 시나리오에 해당합니다.

> **⚠ 슬러그 지정 시의 현재 한계** — `prod force-clear <slug>` 로 *특정 슬러그만* 정리하려는 경우라도 `[3/5]` 관측성 단계가 *동일한 confirm prompt* 를 띄웁니다. 'y' 를 입력하면 다른 슬러그의 관측성 히스토리까지 모두 삭제되므로, 슬러그 지정 시에는 `[3/5]` 단계에서 *반드시 'n' 입력* 으로 건너뛰어야 합니다. 슬러그별 분리 정리 (해당 슬러그의 dashboard / log stream 만 제거) 는 backlog 에 등록되어 있으며 후속 사이클에 보강될 예정입니다.

운영자 본인의 정적 페이지 (`homepage-nginx`) 와 다른 도메인의 DNS 레코드, bluebirds NAS 등 다른 머신은 어느 쪽 명령으로도 영향받지 않습니다. 자세한 동작은 `tools/cleanup-server.sh` 와 `tools/force-clear-server.sh` 의 첫 30 줄 주석에서 확인할 수 있습니다.

---

## 백업 — 현재 수동

운영 데이터의 백업은 현재 자동화되어 있지 않습니다. `prod force-clear` 의 4 단계 (백업 의향) 에서 'y' 를 선택하면 다음과 같은 manual 백업 명령을 출력하고 종료합니다. 운영자가 직접 실행한 뒤 force-clear 를 다시 시도하는 흐름입니다.

### DB 백업 (모든 schema)

```bash
# .env.prod 의 DB_URL/USER/PASSWORD 를 환경변수로 export 한 뒤
PGPASSWORD="$DB_PASSWORD" pg_dump \
    "postgresql://$DB_USER@${DB_HOST}:${DB_PORT}/postgres" \
    > backup-$(date +%s).sql
```

특정 슬러그 schema 만 받으려면 `--schema=<slug>` 옵션을 추가하면 됩니다.

### Storage 백업 (모든 bucket)

MinIO 의 `mc` (MinIO Client) 도구를 docker 로 호출합니다. `.env.prod` 의 endpoint / access key / secret key 를 alias 에 등록한 뒤 mirror 로 로컬에 복사합니다.

```bash
docker run --rm --network host \
    -e MC_HOST_bb="http://$APP_STORAGE_MINIO_ACCESS_KEY:$APP_STORAGE_MINIO_SECRET_KEY@${MINIO_HOST}:${MINIO_PORT}" \
    -v $PWD/backup:/backup \
    minio/mc mirror --remove bb /backup
```

bucket 단위로 받으려면 `bb` 대신 `bb/<bucket-name>` 을 지정하면 됩니다.

### 자동화 계획

`<your-backend> prod db-backup [slug]` 와 `<your-backend> prod storage-backup [slug]` 두 명령은 backlog 에 등록되어 있으며 별도 사이클에 추가될 예정입니다. 자동화가 도입되면 일관된 백업 위치 (예: `~/backups/<repo>/<timestamp>/`) 와 tar.gz 압축, retention 정책 (예: 최근 7 회 유지) 이 함께 적용됩니다. 그전까지는 위 manual 절차를 사용하시면 됩니다.

---

## 인시던트 회고 템플릿

장애 해결 후:
1. 무엇이 깨졌는가 (증상)
2. 근본 원인
3. 임시 조치
4. 영구 조치 (아직 안 한 것 포함)
5. 재발 방지 체크 / 테스트 / 모니터링 개선
6. 이 런북에 추가할 내용

`docs/reference/edge-cases.md` 와 `docs/planned/backlog.md` 에 해당 항목 반영 또는 추가.

---

## 관련 문서

### 배포 / 운영
- [`운영 배포 가이드 (파생레포 onboarding)`](./deployment.md) — 파생 레포 onboarding (최초 1회)
- [`CI / CD 전체 플로우 — commit 부터 운영 반영까지`](./ci-cd-flow.md) — commit → 운영 반영 전체 흐름
- [`인프라 (Infrastructure)`](./infrastructure.md) — 전체 구성도
- [`인프라 결정 기록 (Decisions — Infrastructure)`](./decisions-infra.md) — 인프라 결정 카드 (I-01~I-09)

### 관측성 / 보안
- [`운영 모니터링 셋업 가이드`](../setup/monitoring-setup.md) — 관측성 스택 기동
- [`Observability 규약`](../../api-and-functional/functional/observability.md) — 관측성 규약
- [`키 교체 절차 (Key Rotation)`](../setup/key-rotation.md) — 보안 키 로테이션 절차

### 장애 / 회고
- [`Edge Cases & Risk Analysis`](../../reference/edge-cases.md) — 리스크 시나리오 · 엣지 케이스 목록
- [`Backlog`](../../planned/backlog.md) — 미완료 항목 (인시던트 회고 추가 대상)

### 설계 배경
- [`ADR-007 · 솔로 친화적 운영`](../../philosophy/adr-007-solo-friendly-operations.md) — 솔로 운영 원칙
- [`ADR-001 · 모듈러 모놀리스 (Modular Monolith)`](../../philosophy/adr-001-modular-monolith.md) — 단일 JVM 운영 단위
