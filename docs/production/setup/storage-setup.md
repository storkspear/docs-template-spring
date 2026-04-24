# 스토리지 셋업 가이드 (MinIO / 시놀로지 NAS)

> **유형**: How-to · **독자**: Level 2.5 · **읽는 시간**: ~3분

**설계 근거**: [ADR-007 (솔로 친화적 운영)](../../philosophy/adr-007-solo-friendly-operations.md)

> **대상**: 이 문서는 **template 레포 자체** 의 MinIO 셋업 (docker-compose 기반, 기본 bucket=`template-default`) 을 설명합니다.
> **파생 레포 개발자** 는 [Onboarding — 템플릿 첫 사용 가이드](../../start/onboarding.md) §3.3 를 참조하세요 (`dev-shared` 또는 본인 환경 이름).
>
> 인프라 전체 구성 / 책임 분담: [인프라 (Infrastructure)](../deploy/infrastructure.md)
> bucket 네이밍 / key 패턴 규약: [오브젝트 스토리지 규약](../../api-and-functional/functional/storage.md)
> 선택 근거 (왜 NAS MinIO?): [인프라 결정 기록 (Decisions — Infrastructure)](../deploy/decisions-infra.md) I-03

## 개요

MinIO 스토리지의 **로컬 개발** (Docker Compose) + **운영 NAS** (시놀로지) 셋업 절차. 연결 확인 · 용량 모니터링 · 백업 · 장애 대응 포함.

---

## 로컬 개발

`docker-compose.dev.yml` 에 MinIO 가 이미 포함됨:
```bash
docker compose -f infra/docker-compose.dev.yml up -d minio minio-setup
```

- S3 API: `http://localhost:9000`
- Web UI: `http://localhost:9001` (minioadmin/minioadmin)
- 기본 bucket: `template-default` (90일 lifecycle 자동 적용)

**백엔드 연결** (`.env`):
```bash
APP_STORAGE_MINIO_ENDPOINT=http://localhost:9000
APP_STORAGE_MINIO_ACCESS_KEY=minioadmin
APP_STORAGE_MINIO_SECRET_KEY=minioadmin
APP_STORAGE_MINIO_BUCKETS_0=template-default
```

## 시놀로지 NAS (prod)

### 1. Container Manager 에서 MinIO 기동

DSM → Container Manager → Project → Create:

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

**volume**: NAS 의 대용량 디스크 경로 (`/volume1/docker/minio/data`). RAID/SHR 구성된 볼륨 권장.

### 2. 방화벽·접근 제어

- 9000 (S3 API) — 백엔드 서버 IP 만 허용
- 9001 (Web UI) — 관리자 IP 만 허용 (또는 Tailscale)

### 3. 맥북 백엔드에서 연결

```bash
# .env (prod)
APP_STORAGE_MINIO_ENDPOINT=http://<NAS_IP_OR_TAILSCALE>:9000
APP_STORAGE_MINIO_ACCESS_KEY=<1번에서 설정>
APP_STORAGE_MINIO_SECRET_KEY=<1번에서 설정>
APP_STORAGE_MINIO_REGION=us-east-1
APP_STORAGE_MINIO_DEFAULT_RETENTION_DAYS=90
APP_STORAGE_MINIO_MAX_UPLOAD_BYTES=10485760   # 10MB
APP_STORAGE_MINIO_SIGNED_URL_TTL=PT5M
```

### 4. 초기 버킷 생성

```bash
# mc (MinIO client) 설치 필요
mc alias set nas http://<NAS_IP>:9000 <access> <secret>
mc mb -p nas/voicechat-voices
mc ilm rule add --expire-days 90 nas/voicechat-voices
```

또는 `APP_STORAGE_MINIO_BUCKETS_N` 환경변수로 자동 생성 (BucketProvisioner).

## 용량 모니터링

Grafana 대시보드 "App Factory Overview" 에 MinIO 용량 패널 자동 표시.

Alertmanager 규칙 (이미 설정됨):
- 70% — info 알림
- 85% — warning
- 95% — critical (즉시 조치)

## 조치 옵션 (용량 초과 시)

| 순서 | 조치 | 난이도 |
|-----|------|--------|
| 1 | Retention 90 → 60일 단축 | 5분 |
| 2 | Opus 32kbps → 16kbps | 10분 (클라이언트 업데이트) |
| 3 | NAS 디스크 증설 | 1~2시간 |
| 4 | 30일 이상 콜드 아카이브 | 반나절 (스크립트 작성) |

## 백업

NAS 자체 RAID/Snapshot 활용 권장. docker volume 은 NAS 볼륨 안이라 NAS 가 백업하면 자동 포함.

## 장애 대응

**"presigned URL 이 403"** — endpoint URL 이 외부에서 접근 가능한지 확인. Tailscale/VPN 뒤면 클라이언트도 동일 네트워크.

**"lifecycle 안 먹힘"** — `mc ilm rule ls nas/<bucket>` 으로 규칙 확인.

**"업로드 느림"** — 홈 네트워크 대역폭 확인. 원격 접속 중이면 VPN 병목 가능성.

## 다음 단계

- 스토리지 사용 규약: [오브젝트 스토리지 규약](../../api-and-functional/functional/storage.md)
- 키 로테이션 (MinIO access key 포함): [키 교체 절차 (Key Rotation)](./key-rotation.md)
- 인프라 구성: [인프라 (Infrastructure)](../deploy/infrastructure.md)

---

## 관련 문서

- [오브젝트 스토리지 규약](../../api-and-functional/functional/storage.md) — StoragePort 사용 패턴
- [운영 모니터링 셋업 가이드](./monitoring-setup.md) — Grafana/Prometheus 연동
