# 스토리지 셋업 가이드 (MinIO · 시놀로지 NAS)

> **유형**: How-to · **독자**: Level 2 · **읽는 시간**: ~3분

**설계 근거**: [`ADR-007 · 솔로 친화적 운영`](../../philosophy/adr-007-solo-friendly-operations.md)

> **대상**: 이 문서는 **template 레포 자체** 의 MinIO 셋업을 설명해요. 로컬은 docker-compose 로 띄우고, 기본 bucket 은 `.env.example` 의 출하값인 `basic-bucket` 을 그대로 씁니다.
> **파생 레포 개발자** 는 [`Onboarding`](../../start/onboarding.md) §4.2 를 참조하세요. 본인 NAS · S3 호환 서비스 · 로컬 docker 중에서 고르고, bucket 이름도 본인 환경에 맞게 정합니다.
>
> 관련 문서:
> - 인프라 전체 구성과 책임 분담: [`인프라 (Infrastructure)`](../deploy/infrastructure.md)
> - bucket 네이밍과 key 패턴 규약: [`오브젝트 스토리지 규약`](../../api-and-functional/functional/storage.md)
> - 선택 근거 (왜 NAS MinIO 인가?): [`인프라 결정 기록 (Decisions — Infrastructure)`](../deploy/decisions-infra.md) I-03

## 개요

MinIO 스토리지를 두 환경에 올리는 절차예요. 로컬 개발은 Docker Compose, 운영은 시놀로지 NAS 로 띄웁니다. 연결 확인부터 용량 모니터링, 백업, 장애 대응까지 다뤄요.

핵심 원리 하나만 먼저 잡고 가면 나머지가 쉬워요. **bucket 은 사람이 `mc` 로 직접 만들지 않습니다.** Spring 부팅이 끝나면 `BucketProvisioner` 가 `.env` 의 `APP_STORAGE_MINIO_BUCKETS_*` 에 적힌 이름을 읽어 없으면 만들고 retention 까지 적용해요. 로컬과 운영이 같은 경로를 타므로, 환경별로 따로 외울 게 없어요.

---

## 로컬 개발

`infra/docker-compose.local.yml` 에 MinIO 컨테이너가 이미 들어 있어요. bucket 생성은 컨테이너가 아니라 Spring 의 `BucketProvisioner` 가 맡으므로, 컨테이너만 띄우면 돼요.

```bash
docker compose -f infra/docker-compose.local.yml up -d minio
```

- S3 API: `http://localhost:9000`
- 웹 콘솔: `http://localhost:9001` (minioadmin / minioadmin)
- 기본 bucket: `basic-bucket` (Spring 기동 시 자동 생성, 90일 retention 적용)

**백엔드 연결** (`.env`) — `.env.example` 의 출하값이라 비워 둬도 그대로 동작해요.

```bash
APP_STORAGE_MINIO_ENDPOINT=http://localhost:9000
APP_STORAGE_MINIO_ACCESS_KEY=minioadmin
APP_STORAGE_MINIO_SECRET_KEY=minioadmin
APP_STORAGE_MINIO_BUCKETS_0=basic-bucket
```

`APP_STORAGE_MINIO_ENDPOINT` 를 비우면 `InMemoryStorageAdapter` 로 fallback 해요. 업로드가 메모리에만 남고 재시작하면 사라지는 동작이라, MinIO 없이 빠르게 실험할 때 충분합니다.

## 시놀로지 NAS (운영)

### 1. Container Manager 에서 MinIO 기동

운영은 NAS 의 대용량 디스크에 데이터를 두려고 직접 컨테이너를 띄워요. DSM 의 Container Manager 에서 Project → Create 로 다음 compose 를 등록합니다.

```yaml
services:
  minio:
    image: minio/minio:latest
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      MINIO_ROOT_USER: <강력한 ID>
      MINIO_ROOT_PASSWORD: <강력한 비밀번호>
      MINIO_PROMETHEUS_AUTH_TYPE: public
    volumes:
      - /volume1/docker/minio/data:/data
    command: server /data --console-address ":9001"
    restart: always
```

**volume**: NAS 의 대용량 디스크 경로(`/volume1/docker/minio/data`)를 씁니다. RAID 또는 SHR 로 구성된 볼륨을 권장해요.

### 2. 방화벽·접근 제어

포트별로 접근 대상을 좁혀요.

- 9000 (S3 API) — 백엔드 서버 IP 만 허용. 접속 표준이 Tailscale 인 만큼 9000 접근 제어는 tailnet ACL (Tailscale admin → Access Controls) 로 관리해요
- 9001 (웹 콘솔) — 관리자 IP 만 허용, 또는 [`Tailscale`](../../reference/glossary.md#운영--인프라) 경유

### 3. 맥북 백엔드에서 연결

운영 `.env` 에 NAS 주소와 1번에서 정한 자격을 적어요. retention 과 업로드 한도는 비워 두면 `MinioProperties` 의 기본값을 씁니다.

```bash
# .env (prod)
APP_STORAGE_MINIO_ENDPOINT=http://<NAS_TAILSCALE_IP>:9000
APP_STORAGE_MINIO_ACCESS_KEY=<1번에서 설정>
APP_STORAGE_MINIO_SECRET_KEY=<1번에서 설정>
APP_STORAGE_MINIO_REGION=us-east-1
APP_STORAGE_MINIO_DEFAULT_RETENTION_DAYS=90
APP_STORAGE_MINIO_MAX_UPLOAD_BYTES=10485760   # 10MB
APP_STORAGE_MINIO_SIGNED_URL_TTL=PT5M
```

### 4. bucket 자동 생성

bucket 은 `.env` 에 이름만 적으면 끝이에요. Spring 부팅 시 `BucketProvisioner` 가 없으면 만들고 90일 lifecycle 까지 적용합니다. 멱등이라 재기동해도 중복 에러가 없어요.

```bash
APP_STORAGE_MINIO_BUCKETS_0=voicechat-voices
APP_STORAGE_MINIO_BUCKETS_1=sumtally-receipts
```

운영 bucket 이름은 앱별·용도별로 나누는 `<slug>-<category>` 컨벤션을 따라요. `new app` 명령은 새 슬러그를 추가할 때 `APP_STORAGE_MINIO_BUCKETS_<N>=<slug>-uploads` 한 줄을 자동으로 주입합니다(category 기본값은 `uploads`). 다른 용도가 필요하면 그 줄을 늘리거나 바꿔요. 자세한 규약은 [`오브젝트 스토리지 규약`](../../api-and-functional/functional/storage.md) 을 참조하세요.

`mc` 로 직접 만들고 싶을 때만 아래처럼 수동 생성도 가능해요. 평소엔 위 자동 경로면 충분합니다.

```bash
mc alias set nas http://<NAS_IP>:9000 <access> <secret>
mc mb -p nas/voicechat-voices
mc ilm rule add --expire-days 90 nas/voicechat-voices
```

## 용량 모니터링

MinIO 디스크 사용량 알림 룰 3단계는 `infra/prometheus/rules.yml` 에 정의돼 있어요.

| 사용률 | 알림 등급 |
|---|---|
| 70% | info |
| 85% | warning |
| 95% | critical (즉시 조치) |

다만 **룰만 정의된 상태라 현재는 발화하지 않습니다.** NAS MinIO 가 관측성 스택과 다른 docker network 밖에 있어 `infra/prometheus/prometheus.yml` 의 MinIO scrape job 이 주석 처리돼 있고, Grafana 대시보드에 MinIO 용량 패널도 아직 없어요. 활성화하려면 Tailscale 등으로 bridge 한 뒤 `prometheus.yml` 의 `minio-cluster` job 주석을 해제하고 target 을 채워야 해요 ([`운영 모니터링 셋업 가이드`](./monitoring-setup.md) 참조).

## 조치 옵션 (용량 초과 시)

| 순서 | 조치 | 난이도 |
|---|---|---|
| 1 | retention 90 → 60일 단축 | 5분 |
| 2 | Opus 32kbps → 16kbps | 10분 (클라이언트 업데이트) |
| 3 | NAS 디스크 증설 | 1~2시간 |
| 4 | 30일 이상 콜드 아카이브 | 반나절 (스크립트 작성) |

## 백업

NAS 자체의 RAID 와 Snapshot 을 활용하는 걸 권장해요. docker volume 이 NAS 볼륨 안에 있어서, NAS 가 백업하면 스토리지 데이터도 자동으로 포함됩니다.

## 장애 대응

**presigned URL 이 403** — endpoint URL 이 외부에서 닿는지 확인하세요. Tailscale 이나 VPN 뒤에 있으면 클라이언트도 같은 네트워크에 있어야 해요.

**lifecycle 이 안 먹힘** — `mc ilm rule ls nas/<bucket>` 으로 규칙을 확인하세요.

**업로드가 느림** — 홈 네트워크 대역폭을 확인하세요. 원격 접속 중이면 VPN 병목일 가능성이 있어요.

## 다음 단계

- 스토리지 사용 규약: [`오브젝트 스토리지 규약`](../../api-and-functional/functional/storage.md)
- 키 로테이션 (MinIO access key 포함): [`키 교체 절차 (Key Rotation)`](./key-rotation.md)
- 인프라 구성: [`인프라 (Infrastructure)`](../deploy/infrastructure.md)

---

## 관련 문서

- [`오브젝트 스토리지 규약`](../../api-and-functional/functional/storage.md) — StoragePort 사용 패턴
- [`운영 모니터링 셋업 가이드`](./monitoring-setup.md) — Grafana / Prometheus 연동
