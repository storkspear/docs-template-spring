# 운영 런북 (Runbook)

> **유형**: Runbook · **독자**: Level 2 · **읽는 시간**: ~10분

평시 배포와 롤백, 장애 대응 절차를 한곳에 모은 문서예요. 긴급 상황에서 빠르게 찾을 수 있도록 증상에서 명령으로 가는 최단 경로를 우선했어요. 파생 레포의 최초 onboarding 은 [`운영 배포 가이드 (파생레포 onboarding)`](./deployment.md) 에서 따로 다뤄요.

> **설계 배경**: [`ADR-007 · 솔로 친화적 운영`](../../philosophy/adr-007-solo-friendly-operations.md) — 운영 단위 1, 관리형 서비스 선호, 회색 지대 없는 CI. 운영 구성 상세는 [`인프라 (Infrastructure)`](./infrastructure.md), 배포 결정 근거는 [`인프라 결정 기록 (Decisions — Infrastructure)`](./decisions-infra.md) 을 참고하세요.

이 문서의 명령은 파생 레포 기준이에요. `<repo>` 자리에 본인 레포의 alias 를 넣어 그대로 복사해 쓰면 됩니다.

---

## 상황 매트릭스

증상을 먼저 찾고 해당 섹션으로 점프하세요. 진단 명령은 모두 복사해 바로 실행할 수 있어요.

| 증상 | 1차 의심 | 대응 섹션 |
|---|---|---|
| 외부 HTTPS 가 522 / 530 | Cloudflare Tunnel 장애 | [장애 첫 3가지 체크](#장애-첫-3가지-체크) |
| 외부 HTTPS 가 502 / 503 | Spring 컨테이너 다운 | [장애 첫 3가지 체크](#장애-첫-3가지-체크) · [로그 확인](#로그-확인) |
| 직전 배포가 앱을 깨뜨림 | 롤백 필요 | [롤백](#롤백) |
| 배포 후 Green 부팅이 Flyway validate 로 실패 | 미적용 마이그레이션 | [블루-그린 배포와 Flyway 원칙](#블루-그린-배포와-flyway-원칙) |
| Mac mini 재부팅 후 서비스 안 뜸 | 자동 복구 미동작 | [Mac mini 재부팅 후 복구](#mac-mini-재부팅-후-복구) |
| 메모리 부족 / 컨테이너 OOM | 리소스 고갈 | [장애 첫 3가지 체크](#장애-첫-3가지-체크) |
| Grafana OTP 메일 안 옴 | CF Access 우회 필요 | [SSH 접근과 긴급 조치](#ssh-접근과-긴급-조치) |
| 도그푸딩 종료 / 환경 초기화 | 정리 명령 선택 | [운영 환경 정리](#운영-환경-정리--clear-와-force-clear) |

---

## 평시 배포

평소 배포는 손댈 게 없어요. `main` 에 push 하면 CI 가 통과한 뒤 deploy workflow 가 `workflow_run` 으로 자동 트리거됩니다. 흐름은 다음과 같아요.

```
main push
   ↓
CI (./gradlew build) 성공
   ↓
deploy gate (CI 성공 + DEPLOY_ENABLED=true)
   ↓
Dockerfile.runtime 으로 docker build/push (ghcr.io/<owner>/<repo>:<sha>)
   ↓
kamal deploy --skip-push --version=<sha>  (이미지 swap, kamal 은 빌드 안 함)
   ↓
옛 GHCR 이미지 cleanup (공유 패키지 최신 10개 버전 유지)
```

CI 가 실패하면 deploy 가 시작되지 않아요. gate 가 차단하기 때문에 테스트가 깨진 코드는 절대 운영에 반영되지 않습니다. GHCR cleanup 은 스토리지 한도 관리를 위해 최신 10개 package version 만 남겨요. 단, dev 와 prod 가 같은 GHCR 패키지를 공유하고 cleanup 액션이 태그 필터를 지원하지 않아 환경별 세대 보존은 보장되지 않습니다 — 직전 이미지가 정리됐다면 롤백은 workflow_dispatch 재빌드 (아래 옵션 B) 로 하세요.

### 수동 재배포 (GitHub Actions)

특정 SHA 를 다시 배포하고 싶을 때 GitHub UI 에서 직접 돌릴 수 있어요. Actions 탭에서 deploy workflow 를 열고 "Run workflow" 를 누른 뒤 `version` 칸에 commit SHA 를 입력합니다. 비우면 현재 HEAD 가 적용돼요.

deploy job 은 해당 SHA 를 체크아웃해 jar 부터 다시 빌드하고 이미지를 새로 push 한 뒤 배포합니다. 그래서 GHCR cleanup 보존 범위 밖의 옛 SHA 여도 동작하지만, 빌드를 포함하므로 8분 안팎이 걸려요.

### 수동 배포 (로컬)

GHA 빌링 이슈나 hotfix 처럼 GHA 를 우회해야 할 때 로컬에서 직접 배포합니다.

```bash
<repo> prod deploy                  # 권장 — origin/main 의 최신 SHA 기준
<repo> prod deploy --version <sha>  # 특정 SHA 재배포 (롤백 등)
```

내부 동작은 `tools/deploy/deploy.sh` 의 Step 0 가 처리해요. `git fetch origin main` 으로 원격 최신 SHA 를 `ORIGIN_SHA` 에 담고, `--version` 이 없으면 이 값을 배포 버전으로 자동 설정합니다. 이후 `kamal deploy --version=<sha>` 가 호출되면 kamal 이 `Dockerfile` 의 multi-stage 빌드로 그 SHA 의 코드를 clone 한 뒤 빌드합니다.

이 흐름의 핵심은 로컬 working tree 와 HEAD 가 빌드에 영향을 주지 않는다는 점이에요. 배포는 항상 origin 코드를 기준으로 동작하고, commit 과 push 는 운영자의 책임입니다. 로컬에 미커밋 변경이 있어도 빌드 결과는 동일하고 정보성 경고만 출력돼요. GHA 경로가 `Dockerfile.runtime` 으로 빌드하는 것과 달리 로컬 경로는 `Dockerfile` 로 빌드하므로, 두 경로는 빌드 dockerfile 부터 별개입니다.

배포 중 실시간 로그는 다음으로 확인합니다.

```bash
<repo> prod logs        # kamal app logs -f 래퍼
```

### 이미지 서명 검증 (cosign)

서명 체계는 두 갈래예요 — **로컬 키 (실사용)** 와 **CI keyless (참고용, dormant)**. 배포가 로컬 빌드 경로 (`tools/deploy/deploy.sh`, Actions 과금 회피 — 의도된 결정) 로 돌아가는 현재 구성에서 실제로 동작하는 것은 로컬 키 쪽입니다. 위협 모델은 "빌드 시점의 변조" 가 아니라 서버가 레지스트리에서 이미지를 **다시 받는 경로** (rollback, 이미지 소실 후 re-pull) 에서의 변조예요.

**로컬 키 (실사용)** — 키쌍은 운영자가 로컬에서 발급하고 (opt-in, [`키 발급 통합 §3.3`](../setup/key-issuance.md#33-cosign-이미지-서명-키쌍-선택--로컬-배포-서명-opt-in)), private key 는 레포 밖에 보관하며 `cosign.pub` 만 레포 루트에 커밋합니다.

- **서명 — 배포 시 자동**. `<repo> prod deploy` 가 kamal push 성공 직후 푸시된 이미지의 digest 를 조회해 `cosign sign --key` 로 서명해요 (tag 가 아닌 digest 에 서명 — tag 재지정 공격 무력화). 키 파일이 없으면 warn 후 skip 하므로 미발급 상태에서도 배포는 그대로 됩니다.
- **검증 — rollback 시 자동**. `<repo> prod rollback <sha>` 가 `kamal rollback` 실행 **전에** `cosign verify --key cosign.pub` 를 실행해요. `cosign.pub` 미커밋(키 미발급)이면 warn 후 skip, 검증 실패면 rollback 이 차단됩니다. 서명 도입 이전 이미지 등으로 의식적으로 우회해야 하면 `--no-verify` 를 붙여요.
- **수동 검증 명령** — 아무 때나 현재 GHCR 이미지를 직접 확인할 때:

```bash
cosign verify --key cosign.pub ghcr.io/<owner>/<repo>:<sha>
```

> **인증 선행 필요.** private GHCR 패키지는 `cosign verify` 전에 `docker login ghcr.io` (PAT `read:packages`) 가 되어 있어야 해요. 로그인이 안 된 상태면 registry 가 매니페스트를 안 내줘서 **인증 실패가 서명 검증 실패처럼 표시**될 수 있어요 — rollback 이 `cosign verify 실패` 로 막히면 먼저 `docker login ghcr.io` 부터 확인하세요.

**CI keyless (참고용 — dormant)** — GHA 경로 (`deploy.yml` / `deploy-dev.yml`) 는 GHCR push 직후 이미지 digest 에 GitHub OIDC 기반 keyless 서명을 남기고, 기록은 Sigstore Rekor 투명성 로그에 남아요. 다만 배포가 로컬 빌드 경로로 돌아가는 동안 이 서명은 만들어질 일이 없어 dormant 입니다. GHA 자동 배포를 다시 켜면 (서명 step 은 `continue-on-error`) 다음 명령으로 검증해요 (`<owner>/<repo>` 치환, dev 이미지는 태그가 `dev-<sha>`).

```bash
cosign verify \
  --certificate-identity-regexp "^https://github.com/<owner>/<repo>/\.github/workflows/deploy(-dev)?\.yml@.*$" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  ghcr.io/<owner>/<repo>:<sha>        # dev 이미지는 :dev-<sha>
```

**한계 — 재부팅 re-pull 에는 검증 훅이 없어요**. Mac mini 재부팅 후 컨테이너는 docker 데몬의 restart policy 가 자동으로 되살립니다 (로컬에 남은 이미지 그대로 — 이 경우 re-pull 자체가 없어요). 문제는 로컬 이미지가 사라진 상태의 복구예요 — `<repo> prod start` (kamal app boot) 나 데몬이 스스로 이미지를 pull 하는 경로는 배포 스크립트의 검증 지점을 거치지 않아 자동 검증이 불가능합니다. 이 경로가 의심되면 복구 후 위 **수동 검증 명령**으로 현재 떠 있는 버전 (`<repo> prod status` 로 확인) 을 사후 검증하세요.

---

## 롤백

상황에 따라 세 가지 방법이 있어요. 빠른 순서대로 옵션 A → B → C 입니다.

### 옵션 A — kamal rollback (직전 배포로)

가장 빠른 경로예요. 직전 버전 이미지가 GHCR 에 살아있으면 즉시 전환됩니다. cleanup 은 최신 10개 package version 을 남기지만, dev 와 prod 가 같은 GHCR 패키지를 공유해 태그(환경)별 보존이 보장되지는 않아요 — 직전 이미지가 이미 정리됐다면 옵션 B 로 재빌드 배포하세요.

```bash
<repo> prod status        # 최근 배포 목록 확인 (kamal app details)
<repo> prod rollback <previous-sha>
```

### 옵션 B — GHA workflow_dispatch (특정 SHA 재배포)

여러 단계 이전으로 돌아가야 할 때 사용해요. Actions 탭의 deploy workflow 에서 "Run workflow" 를 누르고 `version` 칸에 되돌릴 commit SHA 를 입력합니다. deploy job 이 그 SHA 에서 jar 부터 다시 빌드해 이미지를 만들고 배포하므로, GHCR 에 옛 이미지가 남아 있지 않아도 되지만 8분 안팎이 걸려요.

### 옵션 C — revert PR (코드 자체를 되돌림)

가장 안전하지만 가장 느린 방법이에요. 깨뜨린 PR 을 revert 해서 `main` 에 머지하면 평시 배포 사이클이 자동으로 돌아 약 10분 뒤 반영됩니다. 코드 히스토리에 되돌림이 남아 추적이 깔끔하다는 장점이 있어요.

---

## 블루-그린 배포와 Flyway 원칙

### prod 는 부팅 시 validate 만 합니다 (VALIDATE_ONLY)

[`ADR-033`](../../philosophy/adr-033-flyway-hybrid-policy.md) 의 Hybrid 정책에 따라 prod 는 `APP_FLYWAY_MODE=VALIDATE_ONLY` 가 기본입니다. Blue 와 Green 어느 쪽도 기동 시 migrate 를 실행하지 않아요. 부팅 시점의 Flyway 는 schema_history 와 classpath 의 정합만 검증하고, 실제 schema 변경은 운영자가 배포 전에 `tools/deploy/migrate-prod.sh` 로 직접 적용합니다.

```bash
# 새 V스크립트가 포함된 배포라면 — 배포 전에 먼저 schema 적용
<repo> prod migrate <slug> V026__add_foo --dry-run    # SQL 미리보기
<repo> prod migrate <slug> V026__add_foo              # 실제 적용
# 그 다음 main push (또는 workflow_dispatch) 로 배포
```

migrate 를 빼먹고 배포하면 Green 부팅 시 validate 가 `Resolved migration not applied` 로 실패하고, health check 타임아웃으로 그 배포만 중단됩니다. 서비스는 Blue 가 계속 서빙하므로 장애는 아니에요. `migrate-prod.sh` 를 실행한 뒤 재배포하면 됩니다. 적용 절차와 validate 실패 대응의 전체 시나리오는 [`Flyway Runbook`](./flyway-runbook.md) 에 있어요.

### Expand/Contract 규율 (파괴적 DDL 금지)

한 배포에 들어가는 Flyway migration 은 뒤로 호환되어야 합니다. 허용과 금지를 정리하면 다음과 같아요.

| 허용 | 금지 |
|---|---|
| 컬럼 추가 (NULL 허용) | 컬럼 삭제 또는 이름 변경 |
| 인덱스 추가 | NOT NULL 로 변경 (기존 데이터에 NULL 있을 때) |
| 새 테이블 생성 | 데이터 타입 변경 |

파괴적 DDL 이 필요하면 두 번의 배포로 나눠요. 첫 배포에서 코드와 신규 컬럼 추가 migration 을 함께 올린 뒤, 모든 요청이 신규 필드를 쓰는지 확인합니다. 그다음 배포에서 구 컬럼 삭제 migration 을 적용해요.

### 보조 경로 — 컨테이너 migrate-only 모드

표준 적용 경로는 위의 `migrate-prod.sh` 예요. 로컬에 psql 이 없는 등 그 경로를 쓸 수 없을 때는 배포 이미지를 `migrate-only` 모드로 한 번 돌려 migrate 만 수행할 수 있습니다. prod profile 은 VALIDATE_ONLY 가 기본이라 `APP_FLYWAY_MODE=AUTO` 를 함께 줘야 실제 migrate 가 실행돼요.

```bash
ssh <deploy-ssh-user>@<tailscale-ip>
docker pull ghcr.io/<owner>/<repo>:<tag>
docker run --rm --env-file /path/to/prod.env -e APP_FLYWAY_MODE=AUTO \
    ghcr.io/<owner>/<repo>:<tag> migrate-only
```

`migrate-only` 모드는 `docker-entrypoint.sh` 가 처리해요. web 서버 없이 Flyway 만 실행한 뒤 exit 0 으로 종료됩니다.

---

## 로그 확인

### 1차 진단 — 컨테이너 직접

가장 빠른 1차 진단은 컨테이너 로그를 직접 보는 거예요.

```bash
<repo> prod logs                     # kamal app logs -f 래퍼 (권장)
kamal app logs -f --lines 500        # kamal 직접 호출
```

원격에서 컨테이너를 직접 들여다봐야 할 때는 SSH 로 붙어 `docker logs` 를 씁니다.

```bash
ssh <deploy-ssh-user>@<tailscale-ip> 'docker ps --filter "name=<repo>-web"'
ssh <deploy-ssh-user>@<tailscale-ip> 'docker logs <container-id> -f'
```

### Grafana 와 Loki

장기 로그나 trace 추적은 Grafana 의 Explore 에서 Loki 를 쿼리해요. `https://log.<도메인>` 으로 접속한 뒤 데이터 소스를 Loki 로 선택합니다.

```text
{app="<slug>"} |= "ERROR"
{app="<slug>"} | json | level="ERROR" | traceId != ""
```

---

## SSH 접근과 긴급 조치

Mac mini 에는 Tailscale IP 로만 접근해요. 공인 IP 는 노출하지 않습니다.

```bash
ssh <deploy-ssh-user>@<tailscale-ip>
```

**Grafana OTP 이메일이 안 올 때** — Tailscale 로 Mac mini 에 붙은 뒤 `http://localhost:3000` 으로 직접 접속하세요. LAN 내부라 Cloudflare Access 를 우회합니다.

**kamal-proxy 가 죽었을 때** — 컨테이너를 다시 start 하면 대부분 복구돼요. 그래도 안 되면 proxy 를 reboot 합니다.

```bash
ssh <deploy-ssh-user>@<tailscale-ip>
docker ps -a --filter name=kamal-proxy
docker start kamal-proxy
# 그래도 안 살면:
kamal proxy reboot
```

---

## 장애 첫 3가지 체크

장애를 감지하면 다음 세 가지를 순서대로 확인해요. 바깥에서 안으로 좁혀 들어가는 순서입니다.

**1. 외부 HTTPS 엔드포인트 상태**

```bash
curl -sSfv https://server.<도메인>/actuator/health/liveness 2>&1 | head -30
```

- 200 OK — 앱은 살아 있어요. 특정 엔드포인트만의 문제일 수 있습니다.
- 522 / 530 — Cloudflare Tunnel 장애예요. Mac mini 의 cloudflared 프로세스를 확인합니다.
- 502 / 503 — kamal-proxy 는 살아있으나 백엔드 Spring 컨테이너가 문제예요.
- 모두 정상인데 사용자만 안 된다면 사용자 측 문제일 수 있어요. Cloudflare 대시보드의 Analytics 를 확인합니다.

**2. Mac mini 리소스 — 메모리, 디스크, CPU**

```bash
ssh <deploy-ssh-user>@<tailscale-ip> 'vm_stat | head -20; top -l 1 -n 10 -o mem; df -h /'
```

- free memory 가 500MB 미만이면 컨테이너 일부가 OOM 으로 killed 됐을 수 있어요. `docker logs` 로 확인합니다.
- 디스크 여유가 5GB 미만이면 `docker system prune` 으로 정리하거나 Prometheus retention 을 줄여요.

**3. 관측성 스택 상태**

```bash
ssh <deploy-ssh-user>@<tailscale-ip> 'docker compose -f /path/to/<repo>/infra/docker-compose.observability.yml ps'
```

모든 컨테이너가 running 이어야 해요. 내려가 있으면 `up -d` 로 다시 띄웁니다.

---

## Mac mini 재부팅 후 복구

재부팅 후에는 대부분 자동으로 복구돼요. 각 컴포넌트의 복구 메커니즘은 다음과 같습니다.

| 컴포넌트 | 자동 복구 방식 |
|---|---|
| cloudflared | launchd `KeepAlive=true` 로 자동 기동 |
| 관측성 컨테이너 | `restart: unless-stopped` 로 자동 기동 |
| Kamal Spring 컨테이너 | `restart: unless-stopped` (Kamal 기본) 로 자동 기동 |

자동 복구가 동작하지 않으면 다음으로 수동 재기동합니다.

```bash
launchctl kickstart -k gui/$(id -u)/site.<repo>.cloudflared
docker compose -f <repo>/infra/docker-compose.observability.yml up -d
<repo> prod start        # 마지막 배포 image 로 재기동 (kamal app boot — 빌드 없음)
```

`prod start` 는 `prod deploy` 와 달라요. deploy 는 현재 코드를 새로 빌드하므로 미검증 코드가 들어갈 위험이 있지만, start 는 마지막으로 검증된 image 를 그대로 다시 띄우므로 빠르고 안전한 복구 경로예요.

---

## 운영 환경 정리 — clear 와 force-clear

도그푸딩이 끝났거나 운영 환경을 처음부터 다시 구성해야 할 때 사용해요. 두 명령은 삭제 범위가 다르므로 상황에 맞게 골라야 합니다.

`prod clear` 는 인프라만 정리합니다. Cloudflare 의 DNS 레코드와 Tunnel ingress 를 제거하고, Mac mini 에서 `kamal app remove` 로 컨테이너를 내려요. DB schema 와 Object Storage bucket 같은 데이터, 그리고 관측성 데이터는 보존됩니다.

```bash
<repo> prod clear        # 'YES' 명시 confirm 후 진행
```

`prod force-clear` 는 clear 의 모든 동작에 더해 데이터와 관측성까지 영구 삭제합니다. 슬러그를 지정하면 그 앱의 schema 와 bucket 만, 슬러그를 생략하면 모든 앱의 schema 와 bucket 을 전부 삭제해요.

```bash
<repo> prod force-clear myapp   # 해당 앱만 (myapp schema + myapp-* bucket)
<repo> prod force-clear         # 모든 앱 schema + bucket + 관측성 전부 삭제
```

`force-clear` 는 5단계 confirm 을 차례로 거치고, 한 단계라도 'y' 외 입력이 들어오면 즉시 abort 됩니다. 단계 순서는 DB 데이터, Storage 데이터, 관측성 데이터, 백업 의향, 최종 확인이에요. 백업 의향 단계에서 'y' 를 선택하면 manual 백업 명령을 출력하고 종료합니다. 자동 백업은 아직 개발 중이라 manual 절차만 안내돼요.

> **코드 정리와 데이터 정리는 별개예요.** `force-clear <slug>` 는 데이터와 인프라 (schema · bucket · 컨테이너) 만 영구 삭제하고, 코드 모듈은 그대로 둡니다. 데이터만 초기화한 뒤 재배포하려는 경우를 위한 동작이에요. 앱을 완전히 은퇴시켜 코드까지 제거하려면 `local` 또는 `dev` 환경에서 `remove app <slug>` 를 추가로 실행합니다. 이 명령은 `new app` 의 역방향이고 `tools/app/remove-app.sh` 가 처리해요. `remove app` 은 실데이터와 공유 소스를 보호하기 위해 prod 를 지원하지 않으므로, prod 배포 앱의 표준 은퇴 순서는 다음과 같아요.
>
> 1. 데이터 백업
> 2. `<repo> prod force-clear <slug>` 로 데이터 삭제
> 3. undeploy 확인
> 4. `<repo> local remove app <slug>` 또는 `<repo> dev remove app <slug>` 로 코드 제거
>
> 자세한 내용은 [`cli-guide.md §9`](../../start/cli-guide.md) 와 [`app-scaffolding.md §10`](../../start/app-scaffolding.md) 을 참조하세요.

### 왜 clear 는 관측성을 보존하는가

관측성 스택은 Grafana 대시보드, Loki 로그 스트림, Prometheus 메트릭으로 이뤄져 있고, 모든 슬러그가 공유하는 단일 인스턴스예요. 슬러그 하나만 정리하려는 운영자가 관측성까지 지우면 다른 슬러그의 모니터링 히스토리도 함께 잃게 됩니다. 그래서 `clear` 는 의도적으로 관측성을 건드리지 않아요. 데이터도 보존합니다 — schema 와 bucket 이 남아 있으면 재배포만으로 서비스가 그대로 복원되기 때문이에요. 공유 `core` schema 는 폐기돼 더는 존재하지 않고 ([`ADR-037`](../../philosophy/adr-037-core-schema-deprecation.md)) 모든 데이터가 슬러그 단위 schema 와 bucket 에 있으므로, 삭제가 필요하면 `force-clear <slug>` 로 슬러그 단위로 정리합니다.

`force-clear` 는 모든 슬러그를 한꺼번에 정리할 때를 위해 관측성까지 삭제하는 옵션을 제공해요. 슬러그를 지정하지 않은 `prod force-clear` 단독 호출이 그 시나리오에 해당합니다.

> **⚠ 슬러그 지정 시의 현재 한계** — `prod force-clear <slug>` 로 특정 슬러그만 정리하려는 경우에도 `[3/5]` 관측성 단계가 동일한 confirm prompt 를 띄워요. 여기서 'y' 를 입력하면 다른 슬러그의 관측성 히스토리까지 모두 삭제됩니다. 슬러그를 지정했다면 `[3/5]` 단계에서 반드시 'n' 으로 건너뛰어야 해요. 슬러그별 분리 정리는 backlog 에 등록돼 있고 후속 사이클에 보강될 예정입니다.

운영자 본인의 정적 페이지 (`homepage-nginx`) 와 다른 도메인의 DNS 레코드, bluebirds NAS 같은 다른 머신은 어느 명령으로도 영향받지 않아요. 자세한 동작은 `tools/cleanup/cleanup-server.sh` 와 `tools/cleanup/force-clear-server.sh` 의 첫 30줄 주석에서 확인할 수 있습니다.

---

## 백업 — 현재 수동

운영 데이터의 백업은 아직 자동화돼 있지 않아요. `prod force-clear` 의 백업 의향 단계에서 'y' 를 선택하면 아래와 같은 manual 백업 명령을 출력하고 종료합니다. 운영자가 직접 실행한 뒤 force-clear 를 다시 시도하는 흐름이에요.

### DB 백업 (모든 schema)

`.env.prod` 의 DB 접속 정보를 환경변수로 export 한 뒤 `pg_dump` 로 받습니다.

```bash
PGPASSWORD="$DB_PASSWORD" pg_dump \
    "postgresql://$DB_USER@${DB_HOST}:${DB_PORT}/postgres" \
    > backup-$(date +%s).sql
```

특정 슬러그 schema 만 받으려면 `--schema=<slug>` 옵션을 더해요.

### Storage 백업 (모든 bucket)

MinIO 의 `mc` 도구를 docker 로 호출합니다. `.env.prod` 의 endpoint 와 access key, secret key 를 alias 에 등록한 뒤 mirror 로 로컬에 복사해요.

```bash
docker run --rm --network host \
    -e MC_HOST_bb="http://$APP_STORAGE_MINIO_ACCESS_KEY:$APP_STORAGE_MINIO_SECRET_KEY@${MINIO_HOST}:${MINIO_PORT}" \
    -v $PWD/backup:/backup \
    minio/mc mirror --remove bb /backup
```

bucket 단위로 받으려면 `bb` 대신 `bb/<bucket-name>` 을 지정해요.

### 자동화 계획

`<repo> prod db-backup [slug]` 와 `<repo> prod storage-backup [slug]` 두 명령은 backlog 에 등록돼 있고 별도 사이클에 추가될 예정이에요. 자동화가 도입되면 일관된 백업 위치와 tar.gz 압축, retention 정책이 함께 적용됩니다. 그전까지는 위 manual 절차를 사용하세요.

---

## 에스컬레이션과 인시던트 회고

이 런북으로 해결되지 않는 장애라면 범위를 넓혀 봐요. 인프라 구성 전체는 [`인프라 (Infrastructure)`](./infrastructure.md), 리스크 시나리오와 엣지 케이스는 [`Edge Cases & Risk Analysis`](../../reference/edge-cases.md) 에서 확인할 수 있어요. 외부 서비스 (Cloudflare, Supabase, GHCR) 자체 장애라면 각 서비스의 status 페이지를 함께 확인합니다.

장애를 해결한 뒤에는 아래 항목으로 짧게 회고해요.

1. 무엇이 깨졌는가 (증상)
2. 근본 원인
3. 임시 조치
4. 영구 조치 (아직 안 한 것 포함)
5. 재발 방지 — 체크, 테스트, 모니터링 개선
6. 이 런북에 추가할 내용

회고 결과는 [`Edge Cases`](../../reference/edge-cases.md) 와 [`Backlog`](../../planned/backlog.md) 에 반영하거나 새 항목으로 추가합니다.

---

## 관련 문서

### 배포와 운영

- [`운영 배포 가이드 (파생레포 onboarding)`](./deployment.md) — 파생 레포 최초 onboarding
- [`CI / CD 전체 플로우`](./ci-cd-flow.md) — commit 부터 운영 반영까지의 전체 흐름
- [`인프라 (Infrastructure)`](./infrastructure.md) — 전체 구성도
- [`인프라 결정 기록 (Decisions — Infrastructure)`](./decisions-infra.md) — 인프라 결정 카드 (I-01~I-14)

### 관측성과 보안

- [`운영 모니터링 셋업 가이드`](../setup/monitoring-setup.md) — 관측성 스택 기동
- [`Observability 규약`](../../api-and-functional/functional/observability.md) — 관측성 규약
- [`키 교체 절차 (Key Rotation)`](../setup/key-rotation.md) — 보안 키 로테이션

### 장애와 회고

- [`Edge Cases & Risk Analysis`](../../reference/edge-cases.md) — 리스크 시나리오와 엣지 케이스
- [`Backlog`](../../planned/backlog.md) — 미완료 항목 (인시던트 회고 추가 대상)

### 설계 배경

- [`ADR-007 · 솔로 친화적 운영`](../../philosophy/adr-007-solo-friendly-operations.md) — 솔로 운영 원칙
- [`ADR-001 · 모듈러 모놀리스 (Modular Monolith)`](../../philosophy/adr-001-modular-monolith.md) — 단일 JVM 운영 단위
