# 오브젝트 스토리지 규약

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~5분

**설계 근거**: [`ADR-003 · -api / -impl 분리`](../../philosophy/adr-003-api-impl-split.md) · [`ADR-007 · 솔로 친화적 운영`](../../philosophy/adr-007-solo-friendly-operations.md)

`core-storage-api` 의 `StoragePort` 와 그 구현 `core-storage-impl` 을 쓰는 규약을 모읍니다. Signed URL 패턴, bucket 네이밍, retention, 용량 계산을 다뤄요.

함께 보면 좋은 문서:

- 인프라 전체 구성과 프로비저닝 상태: [`인프라 (Infrastructure)`](../../production/deploy/infrastructure.md)
- 로컬 docker / NAS 셋업 절차: [`스토리지 셋업 가이드 (MinIO / 시놀로지 NAS)`](../../production/setup/storage-setup.md)
- 2-tier bucket 정책의 선택 근거: [`인프라 결정 기록 (Decisions — Infrastructure)`](../../production/deploy/decisions-infra.md) 의 결정 I-07

## 개요

`StoragePort` 는 S3 API 호환 backend (MinIO · AWS S3 · Cloudflare R2 등) 를 추상화하는 포트입니다. 핵심 가치는 **Signed URL 발급** — 클라이언트가 스토리지에 직접 업로드·다운로드해서 백엔드의 CPU 와 대역폭을 거의 쓰지 않고 대용량 파일을 처리해요. 권한 검증과 DB 메타 저장 같은 비즈니스 로직은 이 포트를 소비하는 앱의 책임이고, 포트는 스토리지 접근 계약만 정의합니다.

---

## Local 개발 — MinIO 접근

`<repo> local start` 또는 `<repo> local init` 이 docker-compose 로 MinIO 컨테이너를 자동 기동해요. Spring 이 부팅을 마치면 `BucketProvisioner` 가 `app.storage.minio.buckets` 설정 (`APP_STORAGE_MINIO_BUCKETS_0`, `_1`, ...) 에 적힌 버킷을 자동으로 만듭니다 (`core-storage-impl/.../BucketProvisioner.java`).

| 항목 | 로컬 default |
|---|---|
| MinIO API endpoint | `http://localhost:9000` |
| MinIO 콘솔 (브라우저) | `http://localhost:9001` |
| Access Key | `.env` 의 `APP_STORAGE_MINIO_ACCESS_KEY` (default `minioadmin`) |
| Secret Key | `.env` 의 `APP_STORAGE_MINIO_SECRET_KEY` (default `minioadmin`) |
| 자동 생성 bucket | `.env` 의 `APP_STORAGE_MINIO_BUCKETS_0`, `_1`, ... 에 적힌 이름 |

buckets 키가 비어 있으면 `BucketProvisioner` 가 그대로 건너뛰어요. 부팅은 통과하지만 버킷은 만들어지지 않습니다. `<repo> new <slug>` 로 새 슬러그를 추가하면 비어 있는 다음 인덱스에 버킷 이름이 자동으로 붙어요 (`tools/new-app/new-app.sh`).

운영에서는 endpoint 가 NAS 의 MinIO (예: `http://100.x.x.x:9000`) 나 별도의 S3 호환 서비스로 바뀌고, access key 와 secret key 도 운영용으로 따로 발급한 값을 씁니다. 버킷 자동 생성은 환경변수 기반이라 동작 자체는 로컬과 같아요. 자세한 절차는 [`스토리지 셋업 가이드`](../../production/setup/storage-setup.md) 를 참고하세요.

---

## Signed URL 패턴 (권장)

업로드는 다음 흐름으로 흘러갑니다.

```
[client] → [server]   UploadUrlRequest (bucket, objectKey, sizeBytes, contentType)
   ↓
[server]              검증 (userId · quota · 파일 크기 상한)
   ↓
[server]              StoragePort.generatePresignedUpload() → presigned PUT URL (TTL 5분)
   ↓
[server] → [client]   UploadUrlResponse (uploadUrl, objectKey, expiresAt, maxSize)
   ↓
[client] → [MinIO]    직접 PUT (백엔드 CPU·대역폭 0)
   ↓
[client] → [server]   "업로드 완료" (objectKey 확정)
   ↓
[server]              DB 에 도메인 엔티티 저장 (objectKey, uploaderId, ...)
```

다운로드는 더 짧아요. 권한을 확인한 뒤 `generatePresignedDownload(bucket, key, ttl)` 로 GET URL 을 발급합니다. TTL 의 기본값은 `app.storage.minio.signed-url-ttl` (default `PT5M`, 5분) 이고, 호출 시 직접 넘기면 그 값이 우선합니다.

TTL 기본 5분은 `MinioProperties.signedUrlTtl` 에서 옵니다. 발급 URL 의 상한 크기는 `UploadUrlResponse.maxSize` 로 함께 내려가는데, 이 값은 `app.storage.minio.max-upload-bytes` (default 10MB) 예요.

---

## Bucket 네이밍 (2-tier 환경 분리)

bucket 네이밍은 [`인프라 결정 기록`](../../production/deploy/decisions-infra.md) I-07 에서 정한 **2-tier 정책** 입니다. 환경마다 다른 bucket 을 쓰되, 코드는 환경을 모르고 `.env` 의 bucket 이름만 읽어 스위치해요. 이 정책은 `core-storage-impl` 이 강제하는 게 아니라 운영 컨벤션이라, 파생 레포가 자기 환경에 맞게 적용합니다.

> 템플릿 레포 자체의 로컬 docker-compose MinIO 는 `.env.example` 의 기본값 `basic-bucket` 을 그대로 씁니다 (템플릿 통합 테스트용). 파생 레포가 `Use this template` 로 생성된 뒤에 아래 2-tier 규약을 적용하세요. 이 차이는 [`스토리지 셋업 가이드`](../../production/setup/storage-setup.md) 에도 정리돼 있어요.

| 환경 | bucket 컨벤션 | 예시 | 특징 |
|---|---|---|---|
| 로컬 개발 | `dev-shared` (단일, 파생 레포 공유) | `dev-shared` | disposable. `mc rb --force dev-shared` 로 수시 wipe 가능 |
| 운영 | `<slug>-<category>` (앱별 + 용도별 분리) | `voicechat-voices`, `sumtally-receipts` | 각자 lifecycle / retention 정책. 철수 시 bucket 단위 정리 용이 |

`.env` 설정은 환경에 따라 이렇게 달라져요.

```bash
# 로컬
APP_STORAGE_MINIO_BUCKETS_0=dev-shared

# 운영 (앱·용도별로 여러 줄)
APP_STORAGE_MINIO_BUCKETS_0=sumtally-receipts
APP_STORAGE_MINIO_BUCKETS_1=sumtally-avatars
```

버킷을 직접 만들 필요는 없어요. `BucketProvisioner` 가 Spring 부팅 시 `.env` 의 이름을 읽어 없으면 생성하고 retention 을 적용합니다. 이름만 추가하고 앱을 재기동하면 끝이에요. `new-app.sh` 는 파생 레포에 슬러그를 추가할 때 `APP_STORAGE_MINIO_BUCKETS_<N>=<slug>-uploads` 한 줄을 자동으로 주입합니다 (category 는 `uploads` 가 기본값). 다른 category 가 필요하면 그 줄을 직접 늘리거나 바꿔요.

## Object Key 패턴 (환경 무관, 항상 동일)

```
{appSlug}/{category}/{yyyy}/{MM}/{dd}/{userId}/{uuid}.{ext}
```

적용 예:

- 로컬: `dev-shared` 버킷의 `sumtally/receipts/2026/04/01/u123/abc.png`
- 운영: `sumtally-receipts` 버킷의 `sumtally/receipts/2026/04/01/u123/abc.png` (경로 중복이지만 코드 분기는 없어요)

이 키 패턴은 `core-storage-impl` 이 만들어 주는 게 아닙니다. `StoragePort` 는 호출자가 넘긴 `objectKey` 를 그대로 쓰므로, 키를 위 규약대로 조립하는 건 포트를 소비하는 앱의 책임이에요. 그래서 모든 앱이 같은 규약을 따르도록 컨벤션으로 고정합니다.

### 설계 근거

코드가 환경을 모르게 두는 게 핵심이에요. Spring 은 `.env` 의 bucket 값만 읽고, 키는 늘 `{appSlug}/{category}/...` 로 시작합니다. 덕분에 로컬과 운영 사이에 object 를 그대로 복사해도 키가 깨지지 않고, 나중에 bucket 을 통합해도 키 충돌이 없어요. S3 는 prefix 를 자동으로 인식하므로 "폴더를 미리 만든다" 는 개념도 없습니다 — 첫 업로드 시 prefix 가 바로 생겨요.

각 필드의 역할은 이래요.

| 필드 | 역할 |
|---|---|
| `{appSlug}` | `dev-shared` 안에서 앱 구분. 운영에선 redundant 하지만 일관성을 위해 유지 |
| `{category}` | receipts · avatars · voices 등 용도별 구분 |
| `{yyyy}/{MM}/{dd}` | MinIO 의 prefix 기반 lifecycle rule 적용 용이 |
| `{userId}` | 유저별 조회·삭제 용이 |
| `{uuid}` | 충돌 방지 |

## Retention (Lifecycle)

기본 retention 은 **90일** 입니다. `BucketProvisioner` 가 부팅 시 lifecycle rule 로 자동 적용해요 (`BucketPolicy.retention` → MinIO `SetBucketLifecycle`).

앱별로 다른 retention 이 필요하면 두 가지 방법이 있어요.

- 환경변수 `APP_STORAGE_MINIO_DEFAULT_RETENTION_DAYS` 를 바꾸거나,
- 파생 레포가 자기 `BucketProvisioner` 빈을 override 합니다.

## 파일 크기 상한

템플릿 기본값은 **10MB** 이고, `APP_STORAGE_MINIO_MAX_UPLOAD_BYTES` 로 조정해요. 정상적인 음성 (약 120KB) 이나 이미지 (약 2MB) 에는 여유가 충분하고, 악용을 막는 게 주 목적입니다. 동영상 앱처럼 큰 파일을 다루면 100MB 등으로 올려요.

## 폴리모픽 모델 (`StorageObject`)

`StorageObject` 는 sealed interface 이고 4개 타입만 permit 합니다.

| 타입 | 용도 | 추가 필드 |
|---|---|---|
| `GenericObject` | 범용 | — |
| `AudioObject` | 음성 | `durationMs`, `codec` |
| `ImageObject` | 이미지 | `width`, `height`, `format` |
| `VideoObject` | 동영상 | `durationMs`, `width`, `height`, `codec` |

공통 필드는 `objectKey` · `sizeBytes` · `contentType` · `createdAt` · `expiresAt` · `customMetadata` 입니다 (`core-storage-api/.../model/StorageObject.java`).

파생 레포가 도메인 타입을 추가하고 싶으면 DB 엔티티로 분리하는 걸 권장해요. `StorageObject` 는 파일 자체의 속성만 담고, 비즈니스 컨텍스트는 엔티티에 두는 분리예요.

```java
@Entity
class VoiceMessage {
    Long id;
    String objectKey;        // StorageObject 는 이 키만 참조
    Long senderUserId;       // 비즈니스 컨텍스트는 여기에
    Long recipientUserId;
    Instant matchedAt;
    // ...
}
```

## 용량 계산 (참고)

30초 음성을 Opus 32kbps 로 인코딩하면 약 120KB 입니다. 이 값을 기준으로 누적 용량을 어림하면 이래요.

| MAU | 유저당 일 10개 메시지 | 90일 축적 | 1TB 사용률 |
|-----|---------------------|----------|-----------|
| 1,000 | 1.2GB | 108GB | 11% |
| 5,000 | 6GB | 540GB | 54% |
| 10,000 | 12GB | 1,080GB | 100%+ — retention 조정 필요 |

MAU 가 1만에 다다르면 retention 을 60일로 줄이거나 NAS 를 증설할지 결정할 시점이에요.

## 환경별 구현 (`StoragePort`)

어떤 구현이 등록되는지는 endpoint 설정 하나로 갈립니다 (`StorageAutoConfiguration`).

| 조건 | StoragePort 구현 |
|------|-----------------|
| `app.storage.minio.endpoint` 가 설정됨 | `MinIOStorageAdapter` |
| endpoint 가 비어 있음 (test · 단위) | `InMemoryStorageAdapter` |

`InMemoryStorageAdapter` 는 실제 presigned URL 을 만들지 못하고 `mem://` scheme 의 placeholder URL 을 돌려줘요. 업로드 내용은 메모리에만 담기고 재시작하면 사라집니다. 빠른 실험이나 테스트에는 충분하지만, 실 서명·업로드 흐름은 MinIO 환경에서만 검증됩니다. 소비자가 자기 `StoragePort` 빈을 직접 등록하면 두 자동 구성은 모두 생략돼요.

## 검증

- 단위: `InMemoryStorageAdapterContractTest`
- 통합: `MinIOStorageAdapterContractTest` (Testcontainers)
- 로컬 수동: Synology NAS 의 MinIO 컨테이너 (`http://<NAS-IP>:9001`), 또는 `docker compose up minio` 뒤 Web UI (`http://localhost:9001`)

두 contract test 는 `core-storage-api` 의 `AbstractStoragePortContractTest` 를 공유해서, 두 구현이 같은 계약을 만족하는지 한 벌의 테스트로 확인합니다.

---

## 관련 문서

- [`스토리지 셋업 가이드 (MinIO / 시놀로지 NAS)`](../../production/setup/storage-setup.md) — MinIO 로컬·NAS 셋업 절차
- [`인프라 결정 기록 (Decisions — Infrastructure)`](../../production/deploy/decisions-infra.md) — 2-tier bucket 정책 (결정 I-07) 의 선택 근거
- [`ADR-003 · core 모듈을 -api / -impl 로 분리`](../../philosophy/adr-003-api-impl-split.md) — `StoragePort` 가 `-api` 모듈에 있는 근거
- [`ADR-007 · 솔로 친화적 운영`](../../philosophy/adr-007-solo-friendly-operations.md) — 관리형 스토리지를 선호하는 근거
