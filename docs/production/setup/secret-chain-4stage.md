# Secret Chain 4-Stage 동기화

> **유형**: Reference · **독자**: 운영자 (Level 2) · **읽는 시간**: ~6분

운영 자격 하나를 컨테이너에 주입하려면 네 곳에 같은 키를 등록해야 합니다. 한 곳이라도 빠지면 부팅이 차단되거나 조용히 건너뛰어지므로, 새 자격을 추가할 때마다 네 곳을 한 번에 갱신해야 합니다.

> 📌 **자주 발생하는 사고**. PortOne 키나 버킷 이름, 신규 소셜 로그인 자격을 추가할 때 한 곳을 빠뜨려 운영 부팅이 실패하는 사례가 반복됩니다. 이 문서는 그 매핑 표와 추가 체크리스트입니다.

> 키 자체를 *발급* 하는 절차 — 어느 콘솔에서 어떤 권한을 골라 발급하는지 — 는 [`운영 키 발급 통합 가이드`](./key-issuance.md) 를 참조하세요. 이 문서는 *발급한 키가 컨테이너에 주입되는 4 곳 동기화* 만 다룹니다.

---

## 1. 네 곳 매핑

새 자격을 운영에 흘려보내려면 아래 네 파일에 같은 키 이름을 등록해야 합니다.

| 등록처 | 파일 | 역할 |
|---|---|---|
| 입력 폼 | `.env.prod.example` → `.env.prod` | 운영자가 환경별 값을 채우는 곳 (공유 자격은 `.env.infra`) |
| 컨테이너 주입 목록 | `config/deploy.yml` 의 `env.secret` | Kamal 이 컨테이너에 주입할 secret 이름 목록 (이름만) |
| 값 매핑 | `.kamal/secrets.example` | `KEY=$ENV_VAR` 매핑. Kamal 이 호스트 환경변수에서 값을 resolve |
| 자격 export | `.github/workflows/deploy.yml` 의 `env:` 블록 | GitHub Secrets → GHA 호스트 환경변수로 export |

GitHub Secrets는 값을 저장하는 곳이에요. `init-prod.sh`는 REQUIRED 목록과 조건을 충족한 OPTIONAL 그룹, 별도로 발견한 `APP_CREDENTIALS_*`만 업로드해요. 새 키를 `.env.prod`에 적었다고 모두 자동으로 올라가지는 않으므로 init의 등록 목록과 Spring의 바인딩 경로도 함께 확인해요. OPTIONAL 그룹을 건너뛰어도 기존 원격 Secret을 자동으로 삭제하지는 않아요.

계정/호스트에 속하는 자격(`GHCR_TOKEN`·`SSH_PRIVATE_KEY`·`TS_OAUTH_*`·`DEPLOY_HOST`·`DEPLOY_SSH_USER`)만 출처가 달라요. `.env.infra` 에서 `init-infra.sh` 가 **접미사 없이** 한 벌만 올리고, dev·prod 워크플로가 같은 값을 봐요. 이 키들은 컨테이너 안으로 주입되는 게 아니라 배포 파이프라인 자체가 쓰는 자격이라 4-Stage 를 타지 않아요.

<a id="흐름--자격이-컨테이너에-도달하기까지"></a>

### 흐름 — 자격이 컨테이너에 도달하기까지

```
.env.prod (운영자 입력)
    ↓  init-prod.sh 가 값을 push
GitHub Secrets / Variables (저장소)
    ↓  deploy.yml env: 블록이 ${{ secrets.X }} 로 호스트 env export
GHA 호스트 환경변수
    ↓  cp .kamal/secrets.example .kamal/secrets → Kamal 이 $VAR resolve
Kamal secrets
    ↓  config/deploy.yml env.secret 의 이름 매칭으로 컨테이너 주입
컨테이너 ENV
    ↓  Spring 이 ENV 읽기
@Value / @ConfigurationProperties
```

GitHub Actions 를 통한 자동 배포가 기본 경로예요. 로컬 수동 배포(`tools/deploy/deploy.sh`)는 GHA 를 우회하므로 `deploy.yml` 의 `env:` export 단계가 빠지고, 대신 `.env.prod` 를 `set -a; source` 로 호스트 환경변수에 직접 export 합니다. 그 뒤 `cp .kamal/secrets.example .kamal/secrets` 부터의 흐름은 두 경로가 똑같아요.

---

## 2. 새 자격 추가 시 체크리스트

`MY_NEW_KEY` 를 추가한다고 가정하면, 네 곳을 다음 순서로 등록합니다.

### 1) `.env.prod.example` 에 키 추가

```bash
# .env.prod.example (commit 됨)
MY_NEW_KEY=
```

운영자가 `.env.prod` 에 실제 값을 채우는 위치입니다. `.env.prod` 자체는 `.gitignore` 라 commit 되지 않아요.

### 2) `config/deploy.yml` 의 `env.secret` 에 추가

```yaml
env:
  secret:
    - DB_URL
    - DB_USER
    - DB_PASSWORD
    - MY_NEW_KEY        # ← 추가
```

여기에 적힌 이름이 곧 컨테이너 ENV 로 주입될 목록입니다.

### 3) `.kamal/secrets.example` 에 매핑 추가

```bash
DB_URL=$DB_URL
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
MY_NEW_KEY=$MY_NEW_KEY    # ← 추가
```

`KEY=$ENV_VAR` 형태로, Kamal 이 호스트 환경변수에서 값을 resolve 하는 매핑입니다.

### 4) `.github/workflows/deploy.yml` 의 `env:` 블록에 export 추가

```yaml
env:
  KAMAL_REGISTRY_PASSWORD: ${{ secrets.GHCR_TOKEN }}
  DB_URL: ${{ secrets.DB_URL }}
  DB_USER: ${{ secrets.DB_USER }}
  DB_PASSWORD: ${{ secrets.DB_PASSWORD }}
  MY_NEW_KEY: ${{ secrets.MY_NEW_KEY }}    # ← 추가
```

GitHub Secrets 에 저장된 값을 GHA 호스트 환경변수로 끌어오는 자리입니다.

### 5) GitHub Secrets store 에 실제 값 push

```bash
gh secret set MY_NEW_KEY --repo <owner>/<repo>
# stdin 으로 값 입력, 또는 --body 로 전달
```

또는 `<your-backend> prod init` 을 다시 실행하면 `.env.prod` 의 채워진 값을 자동으로 push 합니다. `init-prod.sh` 는 REQUIRED 6 개 키를 항상 push 하고, OPTIONAL 기능은 *그룹의 키가 모두 채워졌을 때만* push 합니다. 하나라도 비면 그 기능은 운영에서 꺼진 채로 남아요.

---

<a id="3-dev-와-prod--_dev-suffix-로-격리"></a>

## 3. dev 와 prod — `_DEV` suffix 로 격리

dev 서버를 함께 운영하면 같은 자격을 두 벌로 보관합니다. dev 자격은 GitHub Secrets / Variables 에 `_DEV` suffix 를 붙여 prod 와 분리 저장해요. 예를 들어 prod 는 `DB_URL`, dev 는 `DB_URL_DEV` 입니다.

`deploy-dev.yml` 의 `env:` 블록이 이 suffix 를 풀어, 컨테이너 안에서는 prod 와 똑같은 이름으로 노출합니다.

```yaml
# .github/workflows/deploy-dev.yml — env 블록 발췌
env:
  DB_URL: ${{ secrets.DB_URL_DEV }}
  JWT_SECRET: ${{ secrets.JWT_SECRET_DEV }}
  APP_STORAGE_MINIO_BUCKETS_0: ${{ secrets.APP_STORAGE_MINIO_BUCKETS_0_DEV }}
```

핵심은 **격리는 저장소 이름에서만, 컨테이너 안에서는 동일** 하다는 점입니다. dev 컨테이너도 `DB_URL` 이라는 이름으로 값을 읽으므로 Spring 설정은 한 벌로 유지돼요. 그래서 새 자격을 추가할 때 dev 도 같이 쓴다면, `_DEV` suffix 키를 GitHub 에 별도로 등록하고 `deploy-dev.yml` 에도 같은 매핑을 추가해야 합니다.

---

## 4. 자주 누락되는 케이스

<a id="케이스-1--슬러그-컨트롤러가-새-port-의존을-추가한-경우"></a>

### 케이스 1 — 슬러그 컨트롤러가 새 Port 의존을 추가한 경우

`new <slug>`가 생성하는 앱 컨트롤러는 헬스체크예요. 인증·IAP·결제는 core의 공유 컨트롤러가 `{appSlug}` 경로로 처리해요. 외부 자격 검증도 공유 모듈의 자동 구성에서 수행해요.

PortOne 자격(`APP_PAYMENT_PORTONE_*`)이 대표적인 예예요. payment 기능이 활성일 때 공유 `PaymentController`는 `PaymentPort`를 사용해요. dev·prod에서는 `PortOneProdConfigGuard`가 부팅 중 키 조합을 검사하므로, 선택 기능이라도 잘못된 조합을 넣으면 부팅에 실패할 수 있어요.

| PortOne 키 상태 | 부팅 |
|---|---|
| v1 key/secret, v2 key, webhook secret 전부 비어있음 | 통과 — 결제를 의도적으로 끈 것으로 보고 Stub fallback |
| v1 key/secret 중 하나만 채워짐 | 차단 — 결제 불가인데 stub 이 조용히 뜨는 위험으로 fail-fast |
| webhook secret 만 채워짐 | 차단 — 결제 자격 없음 |
| v2 key가 채워짐 | 차단 — webhook secret 유무와 관계없이 v2 결제 어댑터 미지원 |
| v1 key/secret 둘 다 채워짐 | 통과 — PortOneAdapter 등록 (v1 webhook 은 서명이 없어 secret 불필요, `imp_uid` 재조회로 검증) |

v1 key·secret은 둘 다 채우거나 둘 다 비워요. 결제를 사용하지 않아도 한쪽만 채우면 부팅이 실패해요. 실제 연동을 추가할 때는 §4의 네 전달 지점에서 두 키가 모두 연결됐는지 확인해요. webhook secret의 전달 조건은 런타임 키 조합 검증과 별도로 확인해야 해요.

<a id="케이스-2--bucketprovisioner-가-자동-생성하는-버킷"></a>

### 케이스 2 — `BucketProvisioner` 가 자동 생성하는 버킷

앱 업로드 버킷은 등록된 앱 DataSource 목록과 `BucketNaming`으로 자동 파생해요. `APP_STORAGE_MINIO_BUCKETS_*`는 공유·임시 버킷을 추가하는 목록이에요. 이 목록이 비어도 앱 업로드 버킷은 준비하며, `new-app.sh`가 앱 버킷 슬롯을 추가하지는 않아요. 다만 현재 init의 storage OPTIONAL 그룹은 `BUCKETS_0`도 업로드 조건으로 검사하므로 CLI 조건과 runtime 자동 생성은 구분해요.

<a id="케이스-3--app_credentials_slug_-소셜-로그인-자격"></a>

### 케이스 3 — `APP_CREDENTIALS_<SLUG>_*` (소셜 로그인 자격)

`<your-backend> new <slug>` 는 이 키를 `.env.prod` 에만 자동으로 넣습니다. 나머지 세 곳(`config/deploy.yml` · `.kamal/secrets.example` · `deploy.yml`)은 아직 수동 추가예요. 자세한 흐름은 [`도그푸딩 FAQ Q17`](../../start/dogfood-setup.md#app-credentials-chain) 을 참조하세요.

---

## 5. 동기화 검증

`docs-check` 의 C4(`deploy-secrets-sync`)가 `config/deploy.yml` 의 `env.secret` 과 `deploy.yml` 워크플로의 `secrets.*` 참조가 일치하는지 자동 검증합니다.

```bash
bash tools/docs/docs-contract-test.sh
# → ✅ C4 (deploy-secrets-sync) PASS
```

`.env.prod.example` 과 `.kamal/secrets.example` 는 1:1 이 아니에요. `.env.prod.example` 은 로컬 초기화·프로비저닝용 키까지 포함해 컨테이너 주입 대상보다 큽니다 (실측 43 vs 22 키). 그래서 양방향 diff 는 항상 수십 개 차이가 나고, 의미 있는 검증은 한 방향이에요 — **컨테이너에 주입되는 키 (`.kamal/secrets.example`) 가 전부 `.env.prod.example` 에 존재하는가**.

```bash
comm -23 <(grep -E '^[A-Z]' .kamal/secrets.example | cut -d= -f1 | sort) \
         <(grep -E '^[A-Z]' .env.prod.example | cut -d= -f1 | sort)
# 출력이 KAMAL_REGISTRY_PASSWORD 한 줄뿐이어야 정상
# (KAMAL_REGISTRY_PASSWORD 는 GHCR_TOKEN 을 매핑한 kamal 전용 이름이라 .env 에 없음)
```

---

## 6. 로컬 배포와 GHA 배포의 차이

| 흐름 | GitHub Secrets export | 값의 source | Kamal resolve 이후 |
|---|---|---|---|
| **GHA 자동 배포** (`deploy.yml`) | `env:` 블록이 수행 | GitHub Secrets store | 동일 |
| **로컬 수동 배포** (`tools/deploy/deploy.sh`) | 건너뜀 (GHA 우회) | `.env.prod` 를 `source` 한 호스트 env | 동일 |

GHA 배포에서는 GitHub Secrets store 가 값의 출처예요. 로컬 배포에서는 `.env.prod` 의 값이 그대로 호스트 환경변수가 됩니다. 그래서 새 자격을 추가할 때는 `.env.prod` 와 GitHub Secrets 양쪽을 모두 채워야, 어느 경로로 배포하더라도 정상 동작해요.

---

## 관련 문서

- [`dogfood-setup §5`](../../start/dogfood-setup.md) — `.env.prod` REQUIRED 4 + OPTIONAL 기능
- [`dogfood-setup §3.7`](../../start/dogfood-setup.md) — `.env.infra` 공유 자격
- [`FAQ Q17`](../../start/dogfood-setup.md#app-credentials-chain) — `APP_CREDENTIALS_<SLUG>_*` 수동 추가 흐름
- `tools/init/init-prod.sh` — 운영 GitHub Secrets push 자동화
- `tools/init/init-infra.sh` — 공유 자격 push 자동화 (접미사 없음)
- `tools/deploy/deploy.sh` — 로컬 배포 진입점
