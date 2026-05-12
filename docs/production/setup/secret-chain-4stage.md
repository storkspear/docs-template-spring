# Secret Chain 4-Stage 동기화

> **유형**: Reference · **독자**: 운영자 (Level 2) · **읽는 시간**: ~6분

운영 자격을 컨테이너에 주입하려면 네 곳 모두에 등록되어 있어야 합니다. 한 곳이라도 누락되면 부팅이 차단되거나 silent skip 으로 빠지므로, 새 자격을 추가할 때마다 네 곳을 일괄 갱신해야 합니다.

> 📌 **자주 발생하는 사고**. PortOne 키, `APP_STORAGE_MINIO_BUCKETS_0`, 신규 OAuth provider 자격 같은 것을 추가할 때 한 곳을 빠뜨려 운영 부팅이 실패하는 사례가 반복됩니다. 이 문서는 그 매핑 표와 추가 체크리스트입니다.

> 키 자체의 *발급 절차* (어느 콘솔에서 어떤 권한을 골라 발급하는지) 는 [`운영 키 발급 통합 가이드`](./key-issuance.md) 를 참조하세요. 이 문서는 *발급한 키가 컨테이너에 주입되는 4 단계 동기화* 만 다룹니다.

---

## 1. 4-Stage 매핑

| Stage | 파일 | 역할 |
|---|---|---|
| 1 | `.env.prod.example` (`.env.prod`) | 사용자 입력 폼 — 운영자가 실제 값 채우는 곳 |
| 2 | `config/deploy.yml` `env.secret:` | kamal 이 *컨테이너에 주입* 할 secret list (이름만) |
| 3 | `.kamal/secrets.example` | `KEY=$ENV_VAR` 매핑 — kamal 이 호스트 환경변수에서 값 resolve |
| 4 | `.github/workflows/deploy.yml` `env:` block | GHA 의 GitHub Secrets → kamal 호스트 환경변수 export |

흐름:
```
GitHub Secrets store
    ↓ (Stage 4) GHA workflow_run → env: 로 export
호스트 환경변수
    ↓ (Stage 3) .kamal/secrets 의 $VAR resolve
kamal secrets resolution
    ↓ (Stage 2) deploy.yml env.secret 의 이름 매칭
컨테이너 ENV
    ↓ (Stage 1) Spring 이 ENV 읽기
@Value / @ConfigurationProperties
```

로컬 `tools/deploy.sh` 경로는 GHA 를 우회하므로 Stage 4 가 사용되지 않습니다. 대신 `.env.prod` 를 `set -a; source` 로 호스트 환경변수에 직접 export 하며, 그 이후의 Stage 3·2·1 흐름은 GHA 와 동일합니다.

---

## 2. 새 자격 추가 시 4-Stage 체크리스트

예시 — `MY_NEW_KEY` 추가 시:

### 1) `.env.prod.example` 에 키 추가

```bash
# .env.prod.example (commit)
MY_NEW_KEY=
```

운영자가 `.env.prod` 에 실제 값을 채우는 위치입니다. `.env.prod` 자체는 `.gitignore` 에 등록되어 있어 commit 되지 않습니다.

### 2) `config/deploy.yml` 의 `env.secret` 에 추가

```yaml
env:
  secret:
    - DB_URL
    - DB_USER
    - DB_PASSWORD
    - MY_NEW_KEY        # ← 추가
```

### 3) `.kamal/secrets.example` 에 매핑 추가

```bash
DB_URL=$DB_URL
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
MY_NEW_KEY=$MY_NEW_KEY    # ← 추가
```

### 4) `.github/workflows/deploy.yml` `env:` block 에 export 추가

```yaml
env:
  KAMAL_REGISTRY_PASSWORD: ${{ secrets.GHCR_TOKEN }}
  DB_URL: ${{ secrets.DB_URL }}
  DB_USER: ${{ secrets.DB_USER }}
  DB_PASSWORD: ${{ secrets.DB_PASSWORD }}
  MY_NEW_KEY: ${{ secrets.MY_NEW_KEY }}    # ← 추가
```

### 5) GitHub Secrets store 에 실 값 push

```bash
gh secret set MY_NEW_KEY --repo <owner>/<repo>
# stdin 으로 값 입력 또는 --body
```

또는 `<your-backend> prod init` 을 재실행하면 `.env.prod` 의 채워진 값을 자동으로 push 합니다 (REQUIRED 항목과 활성화된 OPTIONAL feature 의 키만 대상).

---

## 3. 자주 누락되는 케이스

### 케이스 1 — 슬러그 컨트롤러가 새 Port 의존을 추가한 경우

`<your-backend> new <slug>` 가 생성하는 슬러그 컨트롤러는 core 의 Port (Auth / Iap / Payment) 에 의존합니다. 그 Port 가 prod profile 에서 자격을 검증하도록 되어 있다면 자격이 누락된 환경에서는 부팅이 차단됩니다.

대표 사례는 **PortOne 자격 (`APP_PAYMENT_PORTONE_*`)** 입니다. `*PaymentController` 가 `PaymentPort` 를 필수로 의존하고, prod profile 의 `PortOneProdConfigGuard` 가 부팅 시 v1 키와 webhook secret 의 비어있지 않음을 검증합니다. 결제를 실제로 사용하지 않더라도 더미값을 네 곳 모두에 등록해야 부팅이 통과합니다. 키가 세 개 (`API_V1_KEY`, `API_V1_SECRET`, `WEBHOOK_SECRET`) 이고 Stage 가 네 개이므로 총 12 곳을 일괄 갱신해야 합니다.

### 케이스 2 — `BucketProvisioner` 가 자동 생성하는 버킷

`APP_STORAGE_MINIO_BUCKETS_0`, `_1` 처럼 인덱스가 붙는 키들은 부팅 시 `BucketProvisioner` 가 자동으로 생성할 버킷의 목록입니다. 한 곳에서 누락되면 silent skip 으로 빠지므로 부팅은 통과하지만 해당 버킷이 만들어지지 않으며, 스토리지 호출이 발생하는 시점에 가서야 문제가 드러납니다.

### 케이스 3 — `APP_CREDENTIALS_<SLUG>_*` (소셜 로그인 자격)

`<your-backend> new <slug>` 는 Stage 1 의 `.env.prod` 에만 자동으로 주입합니다. Stage 2·3·4 의 추가는 현재 수동이며, 자세한 흐름은 [`도그푸딩 FAQ Q17`](../../start/dogfood-faq.md#q17) 를 참조하세요.

---

## 4. 동기화 검증

`docs-check` 의 C4 (`deploy-secrets-sync`) 가 Stage 2 ↔ Stage 4 의 일치를 자동 검증:

```bash
bash tools/docs-check/docs-contract-test.sh
# → ✅ C4 (deploy-secrets-sync) PASS
```

Stage 1 ↔ Stage 3 일치는 *수동 grep*:

```bash
diff <(grep -E '^[A-Z_]+=' .kamal/secrets.example | sort) \
     <(grep -E '^[A-Z_][A-Z0-9_]*=' .env.prod.example | sort)
# 차이 없어야 정상 (Stage 3 는 KAMAL_REGISTRY_PASSWORD 추가 1개만 더 있음)
```

---

## 5. 로컬 vs GHA 흐름 차이

| 흐름 | Stage 4 | Stage 3 | Stage 2·1 |
|---|---|---|---|
| **로컬 deploy** (`tools/deploy.sh`) | (skip — GHA 우회) | `.env.prod` source → 호스트 ENV | 동일 |
| **GHA 자동 deploy** | GitHub Secrets → workflow env | `.kamal/secrets.example` resolve | 동일 |

로컬에서는 Stage 1 의 `.env.prod` 값이 그대로 Stage 3 의 호스트 ENV 가 됩니다. GHA 에서는 Stage 4 의 GitHub Secrets store 가 source 역할을 합니다. 따라서 새 자격을 추가할 때는 로컬과 GHA 양쪽을 모두 채워야 어느 경로로 deploy 하더라도 정상 동작합니다.

---

## 관련 문서

- [`dogfood-setup §5`](../../start/dogfood-setup.md) — `.env.prod` REQUIRED 5 + OPTIONAL feature
- [`FAQ Q17`](../../start/dogfood-faq.md#q17) — `APP_CREDENTIALS_<SLUG>_*` 수동 추가 흐름
- `tools/init-server.sh` — Stage 4 (GitHub Secrets) push 자동화
- `tools/deploy.sh` — 로컬 흐름 진입점
