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

<a id="local-개발--minio-접근"></a>

## Local 개발 — MinIO 접근

로컬 MinIO를 띄우고 Spring이 시작되면 `BucketProvisioner`가 등록된 앱 DataSource를 기준으로 앱 업로드 버킷을 준비해요. 이름은 `BucketNaming`의 `<prefix><하이픈을 제거한 slug>-uploads` 규칙을 따라요. `APP_STORAGE_MINIO_BUCKETS_*`에는 별도 공유·임시 버킷만 적어요.

| 항목 | 로컬 default |
|---|---|
| MinIO API endpoint | `http://localhost:9000` |
| MinIO 콘솔 (브라우저) | `http://localhost:9001` |
| Access Key | `.env` 의 `APP_STORAGE_MINIO_ACCESS_KEY` (default `minioadmin`) |
| Secret Key | `.env` 의 `APP_STORAGE_MINIO_SECRET_KEY` (default `minioadmin`) |
| 자동 생성 bucket | 등록된 앱의 `<prefix><normalizedSlug>-uploads`와 `APP_STORAGE_MINIO_BUCKETS_*` 공유 목록의 합집합 |

공유 버킷 목록이 비어도 등록된 앱의 업로드 버킷은 자동 생성해요. 앱마다 BUCKETS 슬롯을 추가할 필요는 없고 `new-app.sh`도 이 슬롯을 주입하지 않아요. 버킷 준비가 비동기인 기본 설정에서는 Spring readiness가 정상이어도 스토리지 준비가 실패할 수 있으므로 준비 로그와 실제 업로드를 확인해요.

운영에서는 endpoint 가 NAS 의 MinIO (예: `http://100.x.x.x:9000`) 나 별도의 S3 호환 서비스로 바뀌고, access key 와 secret key 도 운영용으로 따로 발급한 값을 씁니다. 버킷 자동 생성은 환경변수 기반이라 동작 자체는 로컬과 같아요. 자세한 절차는 [`스토리지 셋업 가이드`](../../production/setup/storage-setup.md) 를 참고하세요.

---

## Signed URL 패턴 (권장)

다음은 `StoragePort`의 presigned PUT을 소비하는 커스텀 도메인을 설계할 때의 예시예요. 권한·quota 검사와 완료 처리 API는 소비자가 구현해야 해요. 내장 파일 API의 실제 POST policy 계약은 이 절 아래에서 별도로 구분해요.

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

일반 `StoragePort` presigned PUT의 기본 TTL은 5분이며 기본 최대 크기는 10MB예요. 내장 앱 파일 API는 별도 계약으로, `UploadProperties`의 크기·종류 제한을 확인한 뒤 10분짜리 presigned POST policy를 발급해요. 크기와 Content-Type을 서명에 묶으며 앱의 상한은 `app.uploads.max-size-bytes`로 설정해요. 운영 콘솔의 콘텐츠 업로드는 별도 10분 PUT 계약이므로 클라이언트가 세 방식을 혼동하지 않아야 해요.

---

## Bucket 네이밍 (2-tier 환경 분리)

I-07의 2-tier 정책은 초기 결정 기록이에요. 현재 내장 파일 API는 모든 환경에서 앱별 버킷 `<prefix><하이픈을 제거한 slug>-uploads`를 사용해요. `BucketProvisioner`와 `FileController`·`AttachmentServiceImpl`·`AdminFileService`·`AdminContentService`가 같은 `BucketNaming`을 공유하므로 프로비저닝 이름과 실제 업로드 대상이 함께 계산돼요.

| 환경 예시 | prefix | slug=`gym-log`의 업로드 버킷 |
|---|---|---|
| local·prod 기본값 | 빈 값 | `gymlog-uploads` |
| prod와 MinIO를 공유하는 dev | `dev-` | `dev-gymlog-uploads` |

`APP_STORAGE_MINIO_BUCKETS_*`에는 별도 공유·임시 버킷만 적어요. 앱 업로드 버킷은 등록된 DataSource에서 자동 파생하므로 슬롯을 추가하지 않아요. `new-app.sh`도 앱 버킷 슬롯을 주입하지 않아요.

공유 목록의 이름은 설정한 prefix와 일치해야 하고, 실제 MinIO를 쓰는 dev 프로필은 빈 prefix로 부팅할 수 없어요. 자세한 부팅 검증·IAM 경계·추가와 정리 절차는 [스토리지 버킷 격리](../../production/setup/storage-bucket-isolation.md)에서 관리해요.

## Object Key 패턴 (환경 무관, 항상 동일)

내장 첨부 도메인은 `AttachmentServiceImpl.create`가 만든 flat UUID를 object key로 사용해요. 앱 파일 API의 `key`가 이 값이고, 앱별 버킷 안에서 같은 키로 POST 업로드·GET 다운로드를 해요. 버킷 이름만 환경에 따라 달라져요.

커스텀 업로드 도메인의 키 규약은 다음과 같아요. 이 규약은 운영 컨벤션이며 `StoragePort`가 자동으로 조립하거나 강제하지 않아요.

```text
{appSlug}/{category}/{yyyy}/{MM}/{dd}/{userId}/{uuid}.{ext}
```

예를 들어 별도로 정의한 영수증 도메인은 dev의 `dev-sumtally-receipts`와 prod의 `sumtally-receipts`에 같은 `sumtally/receipts/2026/04/01/u123/abc.png` 키를 사용할 수 있어요. 이 버킷과 소비 코드는 커스텀 도메인에서 준비해야 하며, 내장 첨부의 기본값은 아니에요.

### 설계 근거

환경별 차이는 endpoint·bucket에 두고 object key를 유지하면 데이터를 옮길 때 키를 다시 만들 필요가 없어요. S3의 prefix는 키 문자열의 일부라 폴더를 먼저 만들지 않아도 돼요. 커스텀 계층형 키의 각 필드는 다음 역할을 해요.

| 필드 | 역할 |
|---|---|
| `{appSlug}` | 공유 버킷에서도 앱을 구분해요 |
| `{category}` | receipts·avatars·voices 등 용도를 구분해요 |
| `{yyyy}/{MM}/{dd}` | 날짜별 조회·정리 조건을 표현해요 |
| `{userId}` | 사용자별 조회·삭제에 활용해요 |
| `{uuid}` | 이름 충돌을 줄여요 |

## Retention (Lifecycle)

버킷 단위 만료 규칙은 **버킷의 종류**에 따라 갈려요. `BucketProvisioner` 가 부팅할 때마다 아래 정책을 다시 적용합니다 (`StoragePort.ensureBucket`, 멱등).

| 버킷 | lifecycle | 객체 수명을 누가 관리하나 |
|---|---|---|
| 앱별 업로드 버킷 `<prefix><slug>-uploads` (등록된 슬러그마다 자동) | **만료 규칙 없음** (`BucketPolicy.noExpiration()`) — 이미 걸려 있던 만료 규칙도 제거 | 첨부 도메인: `AttachmentPort.softDelete` → 30일 뒤 `AttachmentPurgeScheduler` 가 스토리지 객체와 row 를 함께 삭제. 미연관(orphan) 선업로드는 24시간 유예 후 회수 |
| 공유·임시 버킷 (`APP_STORAGE_MINIO_BUCKETS_*` 로 지정한 것, 예: `basic-bucket`) | `APP_STORAGE_MINIO_DEFAULT_RETENTION_DAYS` (기본 **90일**) 의 만료 규칙 적용 (`BucketPolicy.retention` → MinIO `SetBucketLifecycle`) | 스토리지가 기간 만료로 자동 삭제 |

앱 업로드 버킷에 기간 만료를 걸지 않는 이유는, 사용자가 지우지 않은 첨부(프로필 사진·게시물 이미지)가 N일 뒤 조용히 사라지고 DB 의 `attachment_file` 행만 남기 때문이에요. 첨부의 삭제 시점은 도메인이 결정하고, 스토리지는 그 결정을 따릅니다. 같은 이름이 두 분류에 모두 들어 있으면 앱 버킷 정책(만료 없음)이 우선하고, 접두사만 다른 옛 수동 항목(예: dev 가 `dev-` 접두사인데 `.env` 에 `<slug>-uploads` 가 남은 경우)도 다른 환경의 앱 버킷으로 보고 만료를 걸지 않아요.

> **purge 스케줄러는 기본 켜짐이에요.** `APP_ATTACHMENT_PURGE_ENABLED=false`로 끌 수 있고 test 프로필은 꺼져 있어요. 기본 실행 시각은 매일 04:00예요. `DELETED` 상태이면서 `purge_at`이 지난 첨부를 지우며, 보통 soft-delete 후 30일이 기준이에요. 이미 삭제 상태가 된 첨부는 연관 정보가 남아 있어도 대상이 될 수 있어요. `QUARANTINED` 상태와 공유 버킷은 이 경로의 대상이 아니에요. 게시물 purge는 별도 opt-in인 `APP_CONTENT_PURGE_ENABLED`로 켜며 기본 03:30에 실행돼요.
>
> **미연관 회수는 별도 opt-in이에요.** `APP_UPLOADS_ORPHAN_PURGE_ENABLED=true`일 때만 `ACTIVE`이고 `associated_id`가 없으며 생성 후 유예 시간(기본 24시간, 하한 1시간)을 지난 첨부를 회수해요. 키를 자기 테이블에만 보관하거나 본문에 `attachment://{id}`로만 참조하는 것은 첨부 도메인의 연관 등록이 아니에요. 이런 범용 업로드를 사용하면 정상 파일도 대상이 될 수 있으므로 회수 옵션을 켜기 전에 사용 방식을 확인해요. 복원된 미연관 첨부도 생성 시각 기준 유예를 지났다면 다음 회수 대상이 돼요.

공유 버킷의 기간을 바꾸려면 `APP_STORAGE_MINIO_DEFAULT_RETENTION_DAYS` 를 조정하고, 버킷마다 다른 정책이 필요하면 파생 레포가 자기 `BucketProvisioner` 빈을 override 합니다.

이미 운영 중인 앱 버킷에 예전 90일 규칙이 남아 있다면, MinIO 에 닿는 다음 부팅에서 `ensureBucket` 이 지워요. 부팅을 기다리지 않고 바로 지우려면 `mc ilm rule rm --all --force <alias>/<bucket>` 을 쓰고, `mc ilm rule ls <alias>/<bucket>` 으로 비었는지 확인합니다.

## 파일 크기 상한

일반 `StoragePort` 업로드의 기본 상한은 10MiB(10,485,760바이트)이며 `APP_STORAGE_MINIO_MAX_UPLOAD_BYTES`로 조정해요. 내장 앱 파일 API의 상한은 별도 `app.uploads.max-size-bytes`이고 기본값도 10MiB예요. JVM 시작 옵션으로 지정한다면 `-Dapp.uploads.max-size-bytes=5242880`처럼 전달해요. 현재 배포 목록에 자동 연결된 항목은 아니에요. 사용하는 업로드 경로의 설정을 바꿔야 하며, 크기를 늘리는 것만으로 내장 파일 API의 허용 Content-Type까지 늘어나지는 않아요.

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

| MAU | 유저당 일 10개 메시지 | 90일치 누적 (예시 기간) | 1TB 사용률 |
|-----|---------------------|----------|-----------|
| 1,000 | 1.2GB | 108GB | 11% |
| 5,000 | 6GB | 540GB | 54% |
| 10,000 | 12GB | 1,080GB | 100%+ — 정리 정책 필요 |

앱 업로드 버킷은 버킷 단위 만료 규칙이 없어 사용자가 지우지 않는 한 계속 누적돼요. 위 표의 "90일" 은 계산 편의를 위한 예시 기간일 뿐이에요. MAU 가 1만에 다다르면 NAS 를 증설할지, 앱 쪽에서 오래된 첨부를 soft-delete 하는 정책을 둘지(그러면 purge 스케줄러가 치워요) 결정할 시점이에요. `APP_STORAGE_MINIO_DEFAULT_RETENTION_DAYS` 는 공유 버킷에만 적용되므로 줄여도 이 표의 용량에는 영향이 없어요.

## 환경별 구현 (`StoragePort`)

어떤 구현이 등록되는지는 endpoint 설정 하나로 갈립니다 (`StorageAutoConfiguration`).

| 조건 | StoragePort 구현 |
|------|-----------------|
| `app.storage.minio.endpoint` 가 설정됨 | `MinIOStorageAdapter` |
| endpoint 가 비어 있음 (local · test · 단위) | `InMemoryStorageAdapter` |
| endpoint 가 비어 있음 (dev · prod) + `app.storage.in-memory-fallback=true` | `InMemoryStorageAdapter` (명시 동의) |
| endpoint 가 비어 있음 (dev · prod) + 플래그 없음 | 부팅 실패 (`IllegalStateException`) |

`InMemoryStorageAdapter` 는 실제 presigned URL 을 만들지 못하고 `mem://` scheme 의 placeholder URL 을 돌려줘요. 업로드 내용은 메모리에만 담기고 재시작하면 사라집니다. 빠른 실험이나 테스트에는 충분하지만, 실 서명·업로드 흐름은 MinIO 환경에서만 검증됩니다. 소비자가 자기 `StoragePort` 빈을 직접 등록하면 두 자동 구성은 모두 생략돼요.

`app.storage.in-memory-fallback`(env `APP_STORAGE_IN_MEMORY_FALLBACK`, 기본 false)은 dev·prod 에서 스토리지 없이 일부러 부팅할 때만 켜요(예: NAS 를 끈 상태 검증). `migrate-only` 부팅은 스토리지를 쓰지 않아 이 검사를 건너뛰어요. `app.storage.minio.strict-startup` 과는 맡는 상황이 달라요 — strict-startup 은 endpoint 가 *있는데* 닿지 않을 때 부팅을 막을지이고, 이 플래그는 endpoint 가 *없을* 때 메모리로 갈지예요.

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
