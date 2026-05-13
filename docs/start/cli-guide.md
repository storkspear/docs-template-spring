# CLI 가이드 — `factory` / `<repo-name>` 명령어

> **유형**: Reference · **독자**: Level 1 · **읽는 시간**: ~10분

> **편의를 위해 `<repo-name>` 심볼릭 링크를 등록했습니다.**
>
> 본 문서의 `<repo-name> <verb>` 표기는 `./factory install` 후 등록된
> `~/.local/bin/<repo-name>` symlink 를 의미해요. `<repo-name>` 자리에는
> *파생 레포의 이름* (예: `sumtally`, `gymlog`) 이 들어가요.
>
> symlink 미등록 시 `bash ./factory <verb>` 또는 직접 `bash tools/<low-level>.sh`
> 호출도 동등해요.

파생 레포의 모든 작업 (셋업 / 기동 / 테스트 / 배포 / 정리 / 마이그레이션) 은 `factory` wrapper 한 곳에서 호출해요. `factory install` 또는 `init-server.sh` 의 Step 12 가 `~/.local/bin/<repo-name>` symlink 를 자동으로 등록하므로, 그 이후로는 어디서든 `<repo-name> <subcommand>` 형태로 명령을 실행할 수 있어요.

## 명령어 패턴

```
<repo-name> <env> <verb> [args...]
<repo-name> <verb> [args...]              ← env 생략 시 local
```

## 환경 (env)

| env | 의미 | 대상 |
|---|---|---|
| `local` | 개발자 맥북의 docker-compose 환경 | postgres / minio / spring / wiremock 컨테이너. application-local.yml (WireMock fallback + dev-fallback-raw) |
| `dev`   | Mac mini dev 서버 (사내 / 외주 검증용) | 별도 Supabase + MinIO 의 dev bucket + Cloudflare Tunnel (`dev-server.<도메인>`). application-dev.yml (production-like, 실 OAuth + strict ${VAR}) |
| `prod`  | 운영 | Mac mini + Supabase prod + NAS MinIO + Cloudflare Tunnel (`server.<도메인>`). application-prod.yml |
| `all` | 셋 다 sequential (local → dev → prod) | 가용한 env 만 호출됨 |

> `dev` 와 `prod` 는 같은 Mac mini host 에 kamal service 이름만 다르게 격리돼요 (`server` vs `server-dev`). 자세한 격리 모델: [`develop-branch-policy.md §5`](../production/operations/develop-branch-policy.md#5-dev-server-vs-prod--격리-모델).

## 명령 매트릭스

### 셋업 / 기동

| verb | local | dev | prod | all |
|---|---|---|---|---|
| **init** | `.env` + docker + verify-local + symlink 등록 | `.env.dev` + Cloudflare 자동 등록 + GitHub Secrets/Variables (`_DEV`) push | `.env.prod` + Cloudflare + Secrets/Variables push + verify-server | sequential |
| **start** | docker 컨테이너 기동 | `kamal app boot -c config/deploy-dev.yml` — 마지막 dev image 로 재기동 | `kamal app boot` — 마지막 prod image 로 재기동 (장애 복구용) | local 먼저 |
| **stop** | spring 컨테이너 stop (postgres / minio / 옵션 wiremock 유지) | ❌ | ❌ | ❌ |
| **restart** | spring 컨테이너 *재빌드* + 재기동 — `new app` 직후 새 코드 반영 | ❌ | ❌ | ❌ |

### 테스트

| verb | local | dev | prod | all |
|---|---|---|---|---|
| **server-test** | `verify-local.sh` — Spring 부팅 + actuator health | `verify-server.sh --target=dev` — dev-server actuator | `verify-server.sh` — prod actuator | ❌ |
| **api-test** | `api-smoke-test.sh` — 11 단계 deep e2e | `api-smoke-test.sh --target=dev` — dev-server 대상 | 운영 환경 deep e2e (WireMock 활성) | ❌ |
| **test** | `server-test` + `api-test` 순차 | `server-test` + `api-test` 순차 | `server-test` + `api-test` 순차 | sequential |
| **ci-test** | GitHub Actions CI 동일 5-stage 로컬 검증 — push 전 사전 통과 보장 | (env 무관) | (env 무관) | (env 무관) |

### 배포 / 운영

| verb | dev | prod | 비고 |
|---|---|---|---|
| **deploy** | `kamal deploy -c config/deploy-dev.yml` (`:dev-<sha>` 태그) | `kamal deploy` (build + push + blue/green) — `git fetch origin main` 후 `--version=$ORIGIN_SHA` → 로컬 working tree 무관 | `tools/deploy.sh --target={dev,prod}` |
| **rollback** `<sha>` | 특정 dev SHA 로 롤백 | 특정 prod SHA 로 롤백 | — |
| **status** | `kamal app details -c config/deploy-dev.yml` | `kamal app details` | — |
| **logs** | `kamal app logs -f -c config/deploy-dev.yml` | `kamal app logs -f` | — |
| **monitor** | ❌ (Grafana 사용 안내로 거부 — env=dev 라벨로 필터) | ❌ (Grafana 사용 안내로 거부 — env=prod 라벨로 필터) | dev/prod Loki/Grafana 공유 |

### 앱 / 모듈

| verb | local | 비고 |
|---|---|---|
| **new app** `[slug]` | 새 앱 모듈 (schema + V001~V014 + V007 admin 시드 + 검증). `slug` 생략 시 prompt | `tools/new-app/new-app.sh` |
| **feature list** | Lite 모드 토글 가능 모듈 + 현재 상태 (ADR-034) | `local feature` 만 |
| **feature enable** `<n>` | `APP_FEATURES_<N>=true` (`.env` + `.env.prod` 동시 갱신) | — |
| **feature disable** `<n>` | `APP_FEATURES_<N>=false` | — |

### 마이그레이션 / 정리 (DESTRUCTIVE)

| verb | dev | prod | 비고 |
|---|---|---|---|
| **migrate** `<slug> <V*>` | dev DB 에 V스크립트 적용 (`.env.dev` 의 DB_URL 사용) | prod DB 에 V스크립트 직접 적용 (ADR-033 Hybrid). `--dry-run` / `--force` 지원 | [`flyway-runbook`](../production/deploy/flyway-runbook.md) — `migrate-prod.sh --target={dev,prod}` |
| **cleanup** | dev 인프라만 정리 — Cloudflare 서브도메인 제거 + `kamal app remove -c deploy-dev.yml` + GH `_DEV` secrets 회수. **데이터 (Supabase / MinIO bucket) 보존**. 'YES' 명시 confirm | — | `tools/dev-cleanup.sh` |
| **clear** | — | 운영 *인프라* 정리 — Cloudflare DNS + Tunnel ingress 제거 + `kamal app remove` + workspace dir archive. **데이터 보존**. 'YES' 명시 confirm | `--cloudflare-only` / `--include-observability` / `--skip-confirm` / `--dry-run` |
| **force-clear** `[slug]` | ⚠ `cleanup` + dev Supabase 스키마 DROP + dev MinIO bucket 제거. **3단계 confirm** + prod host 충돌 safety check (`.env.dev` 의 DB_URL host 가 `.env.prod` 와 같으면 즉시 abort) | ⚠ `clear` (인프라) + 데이터 + 관측성까지 *모두* 영구 삭제. `[slug]` 생략 시 모든 앱 + core. **5단계 confirm** — 한 단계라도 'y' 외 입력 시 즉시 abort | dev 백업 모드 없음 (외부 Supabase 는 콘솔에서 직접 백업) / prod 자동 백업 미구현 (manual 안내만) |

## 단축 — env 생략 = local

```
<repo> init        = <repo> local init
<repo> start       = <repo> local start
<repo> test        = <repo> local test
<repo> new myapp   = <repo> local new app myapp
<repo> ci-test     = (env 무관 — 어디서든)
```

`dev` 와 `prod` 는 항상 env prefix 가 필수예요 (`<repo> dev deploy`, `<repo> prod deploy`).

## 표준 사용자 흐름

### 1. 첫 셋업 (파생 레포 처음 받은 개발자)

```bash
# 1) local init — .env 자동 생성 + docker 기동, 운영값 미요구
<repo> init
   → .env 생성 (HELLOWORLD_DB_PASSWORD 등 자동 발급)
   → docker compose up postgres + minio + spring (옵션: wiremock)
   → verify-local 4/4 PASS
   → ~/.local/bin/<repo> symlink 등록 (어디서든 명령 가능)

# 2) test — 동작 확인
<repo> test
   → 로컬 e2e 검증

# 3) (선택) 새 앱 추가
<repo> new myapp
   → apps/app-myapp + schema + V001~V007 + admin user 시드
   → 끝나면: <repo> local restart   (새 코드 반영)
```

### 2. dev-server 셋업 (사내/외주 검증용 — 선택)

prod 환경 셋업 후 같은 Mac mini 에 dev-server 를 격리 운영하고 싶을 때.

`.env.dev` 의 REQUIRED 키 (`BASE_DOMAIN`, `SUBDOMAIN`, `DB_URL` — 별도 Supabase, `APP_STORAGE_MINIO_BUCKETS_0` — dev bucket) 를 채운 뒤에 진행해요. `.env.dev` 안의 키 이름은 `.env.prod` 와 동일 — `init-dev.sh` 가 GitHub 에 push 할 때만 `_DEV` suffix 자동 부여. 공유 자격 (Cloudflare / Tailscale / SSH 등) 은 `.env.dev` 비어있으면 `.env.prod` 에서 자동 fallback.

```bash
# dev init — dev 환경 자동 셋업
<repo> dev init
   → dev-server.<도메인> Cloudflare DNS + Tunnel ingress 자동 등록
   → GitHub Secrets/Variables (_DEV) push
   → DEPLOY_ENABLED_DEV=true 안내 (develop push 자동 배포 opt-in)

# develop 브랜치에 push → GHA 가 자동 배포 (deploy-dev.yml)
# 또는 수동:
<repo> dev deploy

<repo> dev status
<repo> dev logs

# 폐기:
<repo> dev cleanup       # 인프라만 (Supabase / MinIO bucket 보존)
<repo> dev force-clear   # 스키마 DROP + MinIO bucket 제거까지
```

자세한 격리 모델: [`develop-branch-policy.md §5`](../production/operations/develop-branch-policy.md#5-dev-server-vs-prod--격리-모델).

### 3. 운영 셋업 (로컬 익숙해진 후)

`.env.prod` 의 REQUIRED 키 (`BASE_DOMAIN`, `SUBDOMAIN`, `CLOUDFLARE_API_TOKEN`, `DB_URL`, `DB_USER`, `GHCR_TOKEN`, `SSH_PRIVATE_KEY`) 를 채운 뒤에 진행해요.

```bash
# 4) prod init — 운영 환경 자동 셋업
<repo> prod init
   → CLOUDFLARE_API_TOKEN 으로 ZONE_ID/ACCOUNT_ID/TUNNEL_ID 자동 추출
   → DNS CNAME + Tunnel ingress 자동 등록 (NS propagation 자동 검증 + 실패 시 record 강제 재생성)
   → GitHub Secrets / Variables push
   → verify-server e2e (REQUIRED PASS 시 진행)

# 5) prod deploy
<repo> prod deploy
   → git fetch origin main → ORIGIN_SHA 추출 → kamal --version=$ORIGIN_SHA
   → kamal build + push + blue/green cutover (5~8분)
   → 로컬 working tree / HEAD 무관 (origin 기준)

# 6) (운영 후) 모니터링
<repo> prod status         # 현재 배포 버전
<repo> prod logs           # 실시간 로그
```

### 4. CI 검증 (push 전)

GitHub Actions 의 CI / docs-check / Security Scan 워크플로와 동일한 5 단계를 로컬에서 미리 수행할 수 있어요.

```bash
<repo> ci-test
   → [1/5] Spotless apply (자동 fix — strict 모드: --strict)
   → [2/5] Build (compile + unit test + 22 ArchUnit + jacoco)
   → [3/5] Docs contract test (env-var consistency / broken links / deploy-secrets-sync)
   → [4/5] Docs-check 자체의 unit test
   → [5/5] gitleaks (secret scan)
```

5 단계가 모두 PASS 면 안전하게 push 할 수 있고, fail 이 발생하면 어떤 명령으로 해결해야 하는지를 출력 끝에서 안내해요.

> 단, ci-test 는 *content* 검증만 해요. `.github/workflows/*.yml` 의 *runtime 의존성* (등록되지 않은 secret 참조 등) 은 잡지 못해요. 이 갭을 보강하기 위한 actionlint 통합이 [`backlog`](../planned/backlog.md) 에 등록되어 있어요.

### 5. 운영 트러블 대응

```bash
<repo> prod start          # 마지막 배포 image 로 재기동 (빌드 없음 — known-good state 로 빠른 복구)
<repo> prod rollback <sha> # 이전 SHA 로 롤백
<repo> prod logs           # 실시간 로그로 원인 파악
```

`prod start` 와 `prod deploy` 는 둘 다 spring 컨테이너를 다시 띄우지만 동작 의미가 달라요.

- `prod deploy` 는 `origin/main` 의 코드를 새로 빌드하기 때문에, 미검증 커밋이 origin 에 올라와 있으면 그 코드가 그대로 운영에 진입할 위험이 있어요.
- `prod start` 는 마지막에 정상 배포된 image 를 그대로 재기동하므로, 항상 known-good state 로 복귀하는 안전한 동작이에요.

따라서 장애 복구가 목적이면 `prod start` 가 안전하고, 새 코드를 배포하는 것이 목적이면 `prod deploy` 를 사용하세요.

자세한 운영 절차 (평시 배포 / 롤백 / 장애 시 분기) 는 [`운영 런북 (Runbook)`](../production/deploy/runbook.md) 에서 확인하세요.

### 6. DB 마이그레이션 (수동 — ADR-033)

운영 DB 의 Flyway 모드는 두 단계로 결정돼요. `application-prod.yml` 의 yml default 는 `VALIDATE_ONLY` 지만, `.env.prod.example` 가 `APP_FLYWAY_MODE=AUTO` 를 명시하므로 *처음 배포 시점에는 AUTO* 로 동작해요. 빈 schema 부팅이 차단되지 않도록 정착된 default 예요. 운영이 안정되면 `VALIDATE_ONLY` 로 전환하는 것이 권장이에요.

새로운 V 스크립트는 운영자가 수동으로 적용해야 하며, 의도적으로 안전성 위주의 흐름을 채택한 결과예요.

```bash
# dry-run (실제 적용은 일어나지 않고 SQL 만 출력해요)
<repo> prod migrate <slug> V008__add_my_table --dry-run

# 실제 적용
<repo> prod migrate <slug> V008__add_my_table

# checksum 어긋남 등 의도적 force (운영 DB 를 직접 수정하므로 주의)
<repo> prod migrate <slug> V008__add_my_table --force
```

자세한 절차는 [`flyway-runbook`](../production/deploy/flyway-runbook.md) 을 참조하세요. 결정 근거는 [`ADR-033 Flyway Hybrid`](../philosophy/adr-033-flyway-hybrid-policy.md) 에 정리되어 있어요.

### 7. Feature toggle (Lite 모드 — ADR-034)

도메인별 안전 토글을 8 개 모듈 (`payment` / `iap` / `email` / `2fa` / `audit` / `push` / `billing-notification` / `password-policy`) 에 대해 제공해요. 기본값은 모두 활성이고, 비활성 상태에서 호출이 발생하면 `CMN_009` 로 명시적인 에러가 발생해요.

```bash
<repo> feature list                # 현재 상태 (8 모듈 × on/off)
<repo> feature disable payment     # APP_FEATURES_PAYMENT=false (.env + .env.prod 동시 갱신)
<repo> feature enable iap          # APP_FEATURES_IAP=true (또는 unset 시 default true)
```

자세한 운영자 가이드는 [`feature-toggle`](../production/operations/feature-toggle.md) 을 참조하세요. 설계 근거는 [`ADR-034 Feature Toggle Lite Mode`](../philosophy/adr-034-feature-toggle-lite-mode.md) 에서 확인할 수 있어요.

### 8. 운영 환경 정리 (DESTRUCTIVE)

도그푸딩이 끝났거나 운영 환경을 처음부터 다시 구성해야 할 때 사용하는 명령이에요.

```bash
# 인프라만 정리 (데이터 보존) — 'YES' 명시 confirm
<repo> prod clear

# clear + 데이터 + 관측성 모두 영구 삭제 — 5단계 confirm
<repo> prod force-clear            # ⚠ 모든 앱 + core 전부
<repo> prod force-clear myapp      # 해당 앱만 (myapp schema + myapp-* bucket)
```

`force-clear` 는 다섯 단계의 confirm 을 차례로 거쳐요. 단계는 DB 데이터, Storage 데이터, 관측성 데이터, 백업 의향 (자동 백업은 현재 개발 진행 중이며 manual 절차만 안내), 최종 확인 순서예요. 한 단계라도 'y' 외 입력이 들어오면 즉시 abort 돼요.

> ⚠ 슬러그 지정 시 ([3/5] 관측성 단계) 의 현재 한계 — 슬러그 지정 (`prod force-clear myapp`) 시에도 관측성 단계가 *모든 앱의* 관측성 데이터 삭제 confirm 을 띄워요. 슬러그 단위 격리 의도와 어긋나는 동작이라 backlog 에 영구 fix 가 등록되어 있어요. 임시 회피는 [3/5] 단계에서 'n' 입력으로 건너뛰는 거예요.

## 디렉터리 구조로 진행 단계 시각화

```
파생 레포 클론 직후:        .env.example / .env.dev.example / .env.prod.example 만 있음
local init 후:              + .env (로컬 셋업 완료)
dev init 후:                + .env.dev (dev-server 셋업 완료)
prod init 후:               + .env.prod (운영 셋업 완료)
dev deploy / prod deploy:   Mac mini 에 dev / prod 컨테이너 떠있음
dev cleanup / prod clear:   인프라 정리 — 데이터 보존
dev force-clear / prod force-clear: 모든 자원 영구 삭제 (clean slate)
```

## 메타 레포 (template-spring) 분기

`template-spring` 자체에서 명령 호출 시 다음과 같이 동작해요.

| 명령 | 동작 |
|---|---|
| `template-spring init` | 메타 레포 안내 + 진행 (template 유지보수 시 필요) |
| `template-spring test` | 메타 레포 안내 + 진행 |
| `template-spring ci-test` | 정상 동작 (template 자체 검증) |
| `template-spring prod *` | ⚠ "파생 레포에서 진행하세요" 안내 + exit (메타 레포는 운영 X) |

운영 셋업과 배포는 반드시 파생 레포에서 진행해야 해요. template-spring 자체에서는 template 의 자체 검증 (도그푸딩) 흐름만 동작해요.

## 직접 호출 (backward compat)

`factory` wrapper 를 거치지 않고도 다음과 같이 직접 호출할 수 있어요.

```bash
bash tools/init-server.sh --local <owner>/<repo>
bash tools/init-dev.sh                          # dev init 본체
bash tools/verify-local.sh
bash tools/verify-server.sh --target={prod,dev} # server-test 본체
bash tools/deploy.sh --target={prod,dev}        # deploy 본체
bash tools/api-smoke-test.sh --target={local,dev,prod}
bash tools/migrate-prod.sh --target={prod,dev}  # migrate 본체 (이름은 호환성 유지)
bash tools/new-app/new-app.sh <slug>
bash tools/ci-test.sh
bash tools/cleanup-server.sh                    # prod clear 본체
bash tools/force-clear-server.sh                # prod force-clear 본체
bash tools/dev-cleanup.sh                       # dev cleanup 본체
bash tools/dev-force-clear.sh                   # dev force-clear 본체
```

다만 `<repo> <verb>` 패턴이 더 짧고 일관성이 있어 wrapper 사용을 권장해요.

## 안 다루는 범위 (다음 사이클)

- 환경 자동 추가 (사용자가 새 `.env.<env>` 만들면 명령어 자동 인식 — 지금은 local/dev/prod 하드코딩)
- `prod db-backup` / `prod storage-backup` (현재 force-clear 의 백업 단계는 manual 안내만)
- dev force-clear 자동 백업 (외부 Supabase 라 콘솔 백업 안내만)

---

## 관련 문서

- [`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md) — 첫 셋업 정상 흐름
- [`도그푸딩 walkthrough`](./dogfood-walkthrough.md) — 시간 순 narrative + 정착된 패턴
- [`운영 런북 (Runbook)`](../production/deploy/runbook.md) — 평시 배포 / 롤백 / 장애 대응 절차
- [`Flyway Runbook`](../production/deploy/flyway-runbook.md) — `prod migrate` 의 자세한 절차
- [`Feature toggle 운영자 가이드`](../production/operations/feature-toggle.md) — `feature` 명령의 영향
- [`ADR-033 Flyway Hybrid`](../philosophy/adr-033-flyway-hybrid-policy.md) — Flyway 모드 결정 근거
- [`ADR-034 Feature Toggle Lite Mode`](../philosophy/adr-034-feature-toggle-lite-mode.md) — 토글 메커니즘 설계
- [`Backlog`](../planned/backlog.md) — actionlint 통합 / db-backup 자동화 등 미완 항목
