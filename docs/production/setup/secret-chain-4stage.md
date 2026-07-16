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
| 입력 폼 | `.env.prod.example` → `.env.prod` | 운영자가 실제 값을 채우는 곳 |
| 컨테이너 주입 목록 | `config/deploy.yml` 의 `env.secret` | Kamal 이 컨테이너에 주입할 secret 이름 목록 (이름만) |
| 값 매핑 | `.kamal/secrets.example` | `KEY=$ENV_VAR` 매핑. Kamal 이 호스트 환경변수에서 값을 resolve |
| 자격 export | `.github/workflows/deploy.yml` 의 `env:` 블록 | GitHub Secrets → GHA 호스트 환경변수로 export |

GitHub Secrets store 자체는 다섯 번째 자리가 아니라, `.env.prod` 의 값이 흘러 들어가는 *저장소* 예요. `init-prod.sh` 가 `.env.prod` 의 값을 읽어 GitHub Secrets 와 Variables 에 push 하고, 그 값이 위 네 곳을 거쳐 컨테이너에 도달합니다.

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

GitHub Actions 를 통한 자동 배포가 기본 경로예요. 로컬 수동 배포(`tools/deploy.sh`)는 GHA 를 우회하므로 `deploy.yml` 의 `env:` export 단계가 빠지고, 대신 `.env.prod` 를 `set -a; source` 로 호스트 환경변수에 직접 export 합니다. 그 뒤 `cp .kamal/secrets.example .kamal/secrets` 부터의 흐름은 두 경로가 똑같아요.

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

또는 `<your-backend> prod init` 을 다시 실행하면 `.env.prod` 의 채워진 값을 자동으로 push 합니다. `init-prod.sh` 는 REQUIRED 8 개 키를 항상 push 하고, OPTIONAL 기능은 *그룹의 키가 모두 채워졌을 때만* push 합니다. 하나라도 비면 그 기능은 운영에서 꺼진 채로 남아요.

---

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

### 케이스 1 — 슬러그 컨트롤러가 새 Port 의존을 추가한 경우

`<your-backend> new <slug>` 가 만드는 슬러그 컨트롤러는 core 의 Port (Auth · Iap · Payment) 에 의존합니다. 그 Port 가 prod profile 에서 자격을 검증하면, 자격이 누락된 환경에서는 부팅이 차단돼요.

대표 사례는 PortOne 자격(`APP_PAYMENT_PORTONE_*`)입니다. `*PaymentController` 가 `PaymentPort` 를 의존하고, prod·dev profile 에서 `PaymentAutoConfiguration` 의 `PortOneProdConfigGuard` bean 이 부팅 시점에 키 조합을 검증합니다. 검증 정책은 *전부 아니면 전무* 예요.

| v1 key/secret + webhook secret 상태 | 부팅 |
|---|---|
| 셋 다 비어있음 | 통과 — 결제를 의도적으로 끈 것으로 보고 Stub fallback |
| 일부만 채워짐 | 차단 — webhook 위조나 결제 불가 위험으로 fail-fast |
| 셋 다 채워짐 | 통과 — PortOneAdapter 등록 |

즉 "비어 있으면 안 된다" 가 아니라 *셋을 묶어서 다 채우거나 다 비우거나* 가 규칙입니다. 결제를 실제로 안 쓰더라도 일부만 채워두면 부팅이 막히므로, 세 키를 모두 비워 fallback 으로 보내거나 더미값 세 개를 네 곳에 모두 등록해야 해요. 키가 세 개고 등록처가 네 곳이라 총 12 곳을 한 번에 갱신하게 됩니다.

### 케이스 2 — `BucketProvisioner` 가 자동 생성하는 버킷

`APP_STORAGE_MINIO_BUCKETS_0`, `_1` 처럼 인덱스가 붙는 키는 부팅 시 `BucketProvisioner` 가 만들 버킷 목록입니다. 한 곳에서 누락되면 목록이 비어 조용히 건너뛰어지므로, 부팅은 통과하지만 버킷이 만들어지지 않아요. 문제는 스토리지 호출이 처음 발생하는 시점에 가서야 드러납니다.

### 케이스 3 — `APP_CREDENTIALS_<SLUG>_*` (소셜 로그인 자격)

`<your-backend> new <slug>` 는 이 키를 `.env.prod` 에만 자동으로 넣습니다. 나머지 세 곳(`config/deploy.yml` · `.kamal/secrets.example` · `deploy.yml`)은 아직 수동 추가예요. 자세한 흐름은 [`도그푸딩 FAQ Q17`](../../start/dogfood-faq.md#q17) 을 참조하세요.

---

## 5. 동기화 검증

`docs-check` 의 C4(`deploy-secrets-sync`)가 `config/deploy.yml` 의 `env.secret` 과 `deploy.yml` 워크플로의 `secrets.*` 참조가 일치하는지 자동 검증합니다.

```bash
bash tools/docs-check/docs-contract-test.sh
# → ✅ C4 (deploy-secrets-sync) PASS
```

`.env.prod.example` 과 `.kamal/secrets.example` 는 1:1 이 아니에요. `.env.prod.example` 은 로컬 초기화·프로비저닝용 키까지 포함해 컨테이너 주입 대상보다 훨씬 큽니다 (실측 53 vs 22 키). 그래서 양방향 diff 는 항상 수십 개 차이가 나고, 의미 있는 검증은 한 방향이에요 — **컨테이너에 주입되는 키 (`.kamal/secrets.example`) 가 전부 `.env.prod.example` 에 존재하는가**.

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
| **로컬 수동 배포** (`tools/deploy.sh`) | 건너뜀 (GHA 우회) | `.env.prod` 를 `source` 한 호스트 env | 동일 |

GHA 배포에서는 GitHub Secrets store 가 값의 출처예요. 로컬 배포에서는 `.env.prod` 의 값이 그대로 호스트 환경변수가 됩니다. 그래서 새 자격을 추가할 때는 `.env.prod` 와 GitHub Secrets 양쪽을 모두 채워야, 어느 경로로 배포하더라도 정상 동작해요.

---

## 관련 문서

- [`dogfood-setup §5`](../../start/dogfood-setup.md) — `.env.prod` REQUIRED 8 + OPTIONAL 기능
- [`FAQ Q17`](../../start/dogfood-faq.md#q17) — `APP_CREDENTIALS_<SLUG>_*` 수동 추가 흐름
- `tools/init-prod.sh` — GitHub Secrets push 자동화
- `tools/deploy.sh` — 로컬 배포 진입점
