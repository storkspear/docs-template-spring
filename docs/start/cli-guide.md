# CLI 가이드 — `factory` / `<repo-name>` 명령어

> **유형**: Reference · **독자**: Level 1 · **읽는 시간**: ~10분

파생 레포의 모든 작업 (셋업 / 기동 / 테스트 / 배포 / 정리 / 마이그레이션) 은 `factory` wrapper 한 곳에서 호출합니다. `factory install` 또는 `init-server.sh` 의 Step 12 가 `~/.local/bin/<repo-name>` symlink 를 자동으로 등록하므로, 그 이후로는 어디서든 `<repo-name> <subcommand>` 형태로 명령을 실행할 수 있습니다.

## 명령어 패턴

```
<repo-name> <env> <verb> [args...]
<repo-name> <verb> [args...]              ← env 생략 시 local
```

## 환경 (env)

| env | 의미 | 대상 |
|---|---|---|
| `local` | 로컬 dev (docker compose) | postgres / minio / spring 컨테이너 (wiremock 은 OAuth dev-mock 옵션) |
| `prod` | 운영 | Mac mini + Supabase + GHCR + Cloudflare Tunnel |
| `all` | 둘 다 sequential | local 먼저, 그 다음 prod |

## 명령 매트릭스

### 셋업 / 기동

| verb | local | prod | all |
|---|---|---|---|
| **init** | `.env` + docker + verify-local + symlink 등록 (운영값 X) | `.env.prod` + Cloudflare 자동 등록 + GitHub Secrets / Variables push + verify-server | 둘 다 한 번에 (legacy) |
| **start** | docker 컨테이너 기동 | `kamal app boot` — 마지막 배포 image 로 재기동 (빌드 X, 장애 복구용) | local 먼저 + prod 후 |
| **stop** | spring 컨테이너 stop (postgres / minio / 옵션 wiremock 유지) | ❌ | ❌ |
| **restart** | spring 컨테이너 *재빌드* + 재기동 — `new app` 직후 새 코드 반영 | ❌ | ❌ |

### 테스트

| verb | local | prod | all |
|---|---|---|---|
| **server-test** | `verify-local.sh` — Spring 부팅 + actuator health | `verify-server.sh` — kamal-proxy + actuator (운영) | ❌ |
| **api-test** | `api-smoke-test.sh` — 11 단계 deep e2e | 운영 환경 deep e2e (WireMock 활성) | ❌ |
| **test** | `server-test` + `api-test` 순차 (legacy 호환) | `server-test` + `api-test` 순차 | sequential (server-test 기준) |
| **ci-test** | GitHub Actions CI 동일 5-stage 로컬 검증 — push 전 사전 통과 보장 | (env 무관) | (env 무관) |

### 배포 / 운영

| verb | prod | 비고 |
|---|---|---|
| **deploy** | `kamal deploy` (build + push + blue/green) — 내부적으로 `git fetch origin main` 후 `kamal --version=$ORIGIN_SHA` 명시 → *로컬 working tree / HEAD 무관, origin 코드 기준* 빌드 | `tools/deploy.sh` Step 0 |
| **rollback** `<sha>` | 특정 SHA 로 롤백 | — |
| **status** | `kamal app details` | — |
| **logs** | `kamal app logs -f` | — |

### 앱 / 모듈

| verb | local | 비고 |
|---|---|---|
| **new app** `[slug]` | 새 앱 모듈 (schema + V001~V007 + 시드 + 검증). `slug` 생략 시 prompt | `tools/new-app/new-app.sh` |
| **feature list** | Lite 모드 토글 가능 모듈 + 현재 상태 (ADR-034) | `local feature` 만 |
| **feature enable** `<n>` | `APP_FEATURES_<N>=true` (`.env` + `.env.prod` 동시 갱신) | — |
| **feature disable** `<n>` | `APP_FEATURES_<N>=false` | — |
| **monitor** | actuator/prometheus 메트릭 폴링 (5초 간격, Grafana 대안). `--interval=N` / `--base=URL` | — |

### 마이그레이션 / 정리 (DESTRUCTIVE)

| verb | prod | 비고 |
|---|---|---|
| **migrate** `<slug> <V*>` | prod DB 에 V스크립트 직접 적용 (ADR-033 Hybrid). `--dry-run` / `--force` 지원 | [`flyway-runbook`](../production/deploy/flyway-runbook.md) |
| **clear** | 운영 *인프라* 정리 — Cloudflare DNS + Tunnel ingress 제거 + `kamal app remove` + workspace dir archive 후 삭제. **데이터 (DB / Storage) 보존**. 'YES' 명시 confirm | `--cloudflare-only` / `--include-observability` / `--skip-confirm` / `--dry-run` |
| **force-clear** `[slug]` | ⚠ `clear` (인프라) + 데이터 + 관측성까지 *모두* 영구 삭제. `[slug]` 생략 시 모든 앱 + core 전부. **5단계 confirm** — 한 단계라도 'y' 외 입력 시 즉시 abort | 백업 모드는 현재 개발 진행중 (자동 백업 미구현 — manual 안내만) |

## 단축 — env 생략 = local

```
<repo> init        = <repo> local init
<repo> start       = <repo> local start
<repo> test        = <repo> local test
<repo> new myapp   = <repo> local new app myapp
<repo> ci-test     = (env 무관 — 어디서든)
```

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

### 2. 운영 셋업 (로컬 익숙해진 후)

`.env.prod` 의 REQUIRED 키 (`BASE_DOMAIN`, `SUBDOMAIN`, `CLOUDFLARE_API_TOKEN`, `DB_URL`, `DB_USER`, `GHCR_TOKEN`, `SSH_PRIVATE_KEY`) 채운 뒤:

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

### 3. CI 검증 (push 전)

GitHub Actions 의 CI / docs-check / Security Scan 워크플로와 동일한 5 단계를 로컬에서 미리 수행할 수 있습니다.

```bash
<repo> ci-test
   → [1/5] Spotless apply (자동 fix — strict 모드: --strict)
   → [2/5] Build (compile + unit test + 22 ArchUnit + jacoco)
   → [3/5] Docs contract test (env-var consistency / broken links / deploy-secrets-sync)
   → [4/5] Docs-check 자체의 unit test
   → [5/5] gitleaks (secret scan)
```

5 단계가 모두 PASS 면 안전하게 push 할 수 있고, fail 이 발생하면 어떤 명령으로 해결해야 하는지를 출력 끝에서 안내합니다.

### 4. 운영 트러블 대응

```bash
<repo> prod start          # 마지막 배포 image 로 재기동 (빌드 없음 — known-good state 로 빠른 복구)
<repo> prod rollback <sha> # 이전 SHA 로 롤백
<repo> prod logs           # 실시간 로그로 원인 파악
```

`prod start` 와 `prod deploy` 는 둘 다 spring 컨테이너를 다시 띄우지만 동작 의미가 다릅니다.

- `prod deploy` 는 `origin/main` 의 코드를 새로 빌드하기 때문에, 미검증 커밋이 origin 에 올라와 있으면 그 코드가 그대로 운영에 진입할 위험이 있습니다.
- `prod start` 는 마지막에 정상 배포된 image 를 그대로 재기동하므로, 항상 known-good state 로 복귀하는 안전한 동작입니다.

따라서 장애 복구가 목적이면 `prod start` 가 안전하고, 새 코드를 배포하는 것이 목적이면 `prod deploy` 를 사용합니다.

### 5. DB 마이그레이션 (수동 — ADR-033)

운영 DB 의 Flyway 모드는 `validate-only` 가 기본값이라 자동 실행이 일어나지 않습니다. 새로운 V 스크립트는 운영자가 수동으로 적용해야 하며, 의도적으로 안전성 위주의 흐름을 채택한 결과입니다.

```bash
# dry-run (실제 적용은 일어나지 않고 SQL 만 출력합니다)
<repo> prod migrate <slug> V008__add_my_table --dry-run

# 실제 적용
<repo> prod migrate <slug> V008__add_my_table

# checksum 어긋남 등 의도적 force (운영 DB 를 직접 수정하므로 주의)
<repo> prod migrate <slug> V008__add_my_table --force
```

자세한 절차는 [`flyway-runbook`](../production/deploy/flyway-runbook.md) 을 참조하세요.

### 6. Feature toggle (Lite 모드 — ADR-034)

도메인별 안전 토글을 8 개 모듈 (`payment` / `iap` / `email` / `2fa` / `audit` / `push` / `billing-notification` / `password-policy`) 에 대해 제공합니다. 기본값은 모두 활성이며, 비활성 상태에서 호출이 발생하면 `CMN_009` 로 명시적인 에러가 발생합니다.

```bash
<repo> feature list                # 현재 상태 (8 모듈 × on/off)
<repo> feature disable payment     # APP_FEATURES_PAYMENT=false (.env + .env.prod 동시 갱신)
<repo> feature enable iap          # APP_FEATURES_IAP=true (또는 unset 시 default true)
```

자세한 운영자 가이드는 [`feature-toggle`](../production/operations/feature-toggle.md) 을 참조하세요.

### 7. 운영 환경 정리 (DESTRUCTIVE)

도그푸딩이 끝났거나 운영 환경을 처음부터 다시 구성해야 할 때 사용하는 명령입니다.

```bash
# 인프라만 정리 (데이터 보존) — 'YES' 명시 confirm
<repo> prod clear

# clear + 데이터 + 관측성 모두 영구 삭제 — 5단계 confirm
<repo> prod force-clear            # ⚠ 모든 앱 + core 전부
<repo> prod force-clear myapp      # 해당 앱만 (myapp schema + myapp-* bucket)
```

`force-clear` 는 다섯 단계의 confirm 을 차례로 거치며, 단계는 DB 데이터, Storage 데이터, 관측성 데이터, 백업 의향 (자동 백업은 현재 개발 진행 중이며 manual 절차만 안내), 최종 확인 순서입니다. 한 단계라도 'y' 외 입력이 들어오면 즉시 abort 됩니다.

## 디렉터리 구조로 진행 단계 시각화

```
파생 레포 클론 직후:        .env.example / .env.prod.example 만 있음
local init 후:              + .env (로컬 셋업 완료)
prod init 후:               + .env.prod (운영 셋업 완료)
prod deploy 후:             Mac mini 에 컨테이너 떠있음
prod clear 후:              인프라 정리 — 데이터 보존
prod force-clear 후:        모든 자원 영구 삭제 (clean slate)
```

## 메타 레포 (template-spring) 분기

`template-spring` 자체에서 명령 호출 시:

| 명령 | 동작 |
|---|---|
| `template-spring init` | 메타 레포 안내 + 진행 (template 유지보수 시 필요) |
| `template-spring test` | 메타 레포 안내 + 진행 |
| `template-spring ci-test` | 정상 동작 (template 자체 검증) |
| `template-spring prod *` | ⚠ "파생 레포에서 진행하세요" 안내 + exit (메타 레포는 운영 X) |

운영 셋업과 배포는 반드시 파생 레포에서 진행해야 합니다. template-spring 자체에서는 template 의 자체 검증 (도그푸딩) 흐름만 동작합니다.

## 직접 호출 (backward compat)

`factory` wrapper 를 거치지 않고도 다음과 같이 직접 호출할 수 있습니다.

```bash
bash tools/init-server.sh --local <owner>/<repo>
bash tools/verify-local.sh
bash tools/deploy.sh
bash tools/new-app/new-app.sh <slug>
bash tools/ci-test.sh
bash tools/cleanup-server.sh           # prod clear 본체
bash tools/force-clear-server.sh       # prod force-clear 본체
```

다만 `<repo> <verb>` 패턴이 더 짧고 일관성이 있어 wrapper 사용을 권장합니다.

## 안 다루는 범위 (다음 사이클)

- `.env.devel` 분리 → `<repo> devel init` / `<repo> devel deploy` (지금은 prod 만)
- 환경 자동 추가 (사용자가 새 `.env.<env>` 만들면 명령어 자동 인식)
- `prod db-backup` / `prod storage-backup` (현재 force-clear 의 백업 단계는 manual 안내만)
