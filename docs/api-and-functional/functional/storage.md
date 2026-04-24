# 오브젝트 스토리지 규약

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~5분

**설계 근거**: [ADR-003 (-api / -impl 분리)](../../philosophy/adr-003-api-impl-split.md) · [ADR-007 (솔로 친화적 운영)](../../philosophy/adr-007-solo-friendly-operations.md)

`core-storage-api` / `core-storage-impl` 의 `StoragePort` 사용 가이드.

> 인프라 전체 구성 / 프로비저닝 상태: [인프라 (Infrastructure)](../../production/deploy/infrastructure.md)
> 셋업 가이드 (로컬 docker / NAS): [스토리지 셋업 가이드 (MinIO / 시놀로지 NAS)](../../production/setup/storage-setup.md)
> 선택 근거 (2-tier bucket): [인프라 결정 기록 (Decisions — Infrastructure)](../../production/deploy/decisions-infra.md) I-07

## 개요

`core-storage-api` / `core-storage-impl` 의 **`StoragePort` 사용 규약**. Signed URL · 2-tier bucket 네이밍 · retention · 용량 계산.

---

## Signed URL 패턴 (권장)

**업로드**:
```
1. [client] → [server]: UploadUrlRequest (bucket, objectKey, sizeBytes, contentType)
2. [server]: 검증 (userId, quota, 파일 크기 상한)
   → StoragePort.generatePresignedUpload() → presigned PUT URL (TTL 5분)
3. [server] → [client]: UploadUrlResponse (uploadUrl, objectKey, expiresAt)
4. [client] → [MinIO]: 직접 PUT (백엔드 CPU·대역폭 0)
5. [client] → [server]: "업로드 완료" (objectKey 확정)
6. [server]: DB 에 VoiceMessage/Receipt 등 엔티티 저장 (objectKey, uploaderId, ...)
```

**다운로드**: 권한 체크 → `generatePresignedDownload()` → TTL 5분 GET URL

## Bucket 네이밍 (2-tier 환경 분리)

> **이 규약은 파생 레포 기준**. Template 레포 자체의 로컬 docker-compose MinIO 는 `template-default` 를 기본값으로 유지합니다 (template 의 통합 테스트용). 파생 레포가 `Use this template` 로 생성된 후에 아래 2-tier 규약을 적용하세요.

### 로컬 개발
- **Bucket**: `dev-shared` (단일, 모든 파생 레포 공유)
- **특징**: disposable. `mc rb --force dev-shared` 수시 wipe 가능.
- `.env` 설정:
  ```
  APP_STORAGE_MINIO_BUCKETS_0=dev-shared
  ```

### 운영
- **Bucket**: `{appSlug}-{category}` (앱별 + 카테고리별 분리)
- 각자 lifecycle/retention 정책. 서비스 철수 시 bucket 단위 정리 용이.
- 예: `voicechat-voices`, `sumtally-receipts`, `rny-avatars`
- `.env` 설정:
  ```
  APP_STORAGE_MINIO_BUCKETS_0=sumtally-receipts
  APP_STORAGE_MINIO_BUCKETS_1=sumtally-avatars
  ```

### Bucket 생성 자동화 (실수 방지)
- `BucketProvisioner` 가 Spring 부팅 시 `.env` 의 bucket 이름 읽어서 **없으면 자동 생성** + retention 적용.
- **수동 생성 불필요**. `.env` 에 이름 추가 후 앱 재기동만 하면 됨.
- 파생 레포 생성 시 `new-app.sh` 가 `.env.example` 에 앱별 bucket 이름을 자동 주입.

## Object Key 패턴 (환경 무관, 항상 동일)

```
{appSlug}/{category}/{yyyy}/{MM}/{dd}/{userId}/{uuid}.{ext}
```

**적용 예**:
- 로컬: `dev-shared/sumtally/receipts/2026/04/01/u123/abc.png`
- 운영: `sumtally-receipts/sumtally/receipts/2026/04/01/u123/abc.png` (경로 중복이지만 코드 분기 없음)

### 설계 근거
- **코드는 환경을 모름** — Spring 은 `.env` 의 bucket 값만 읽고, key 는 항상 `{appSlug}/{category}/...` 로 시작
- **로컬 ↔ 운영 이관 용이** — object 그대로 복사 가능
- **향후 bucket 통합 시 키 충돌 없음**
- **prefix 는 S3 가 자동 인식** — "폴더 사전 생성" 개념 없음, 첫 업로드 시 자동

### 필드 역할
- `{appSlug}` → dev-shared 에서 앱 구분. 운영에선 redundant 하지만 일관성 유지
- `{category}` → receipts/avatars/voices 등 용도별 구분
- `{yyyy}/{MM}/{dd}` → MinIO prefix-based lifecycle rule 적용 용이
- `{userId}` → 유저별 조회/삭제 용이
- `{uuid}` → 충돌 방지

## Retention (Lifecycle)

기본 **90일**. `BucketProvisioner` 가 부팅 시 자동 적용.

앱별 다른 retention:
- 환경변수 `APP_STORAGE_MINIO_DEFAULT_RETENTION_DAYS` 변경 or
- 파생 레포가 자기 `BucketProvisioner` 빈 override

## 파일 크기 상한

템플릿 기본: **10MB**. 환경변수 `APP_STORAGE_MINIO_MAX_UPLOAD_BYTES`.

악용 방지 목적 — 정상 음성(120KB)·이미지(2MB) 등은 여유 충분. 동영상 앱이면 100MB 로 override.

## 폴리모픽 모델 (`StorageObject`)

sealed interface + 4 permits:
- `GenericObject` — 범용
- `AudioObject` — durationMs, codec
- `ImageObject` — width, height, format
- `VideoObject` — durationMs, width, height, codec

파생 레포가 도메인 타입을 추가하고 싶으면 **DB 엔티티로 분리** 권장 (StorageObject 는 파일 속성만):

```java
@Entity
class VoiceMessage {
    Long id;
    String objectKey;        // StorageObject 는 이것만 참조
    Long senderUserId;       // 비즈니스 컨텍스트는 여기
    Long recipientUserId;
    Instant matchedAt;
    // ...
}
```

## 용량 계산 (참고)

**30초 음성 (Opus 32kbps) = 120KB** 기준:

| MAU | 유저당 일 10개 메시지 | 90일 축적 | 1TB 사용률 |
|-----|---------------------|----------|-----------|
| 1,000 | 1.2GB | 108GB | 11% |
| 5,000 | 6GB | 540GB | 54% |
| 10,000 | 12GB | 1,080GB | **100%+ — retention 조정** |

→ MAU 1만 시점이 retention 60일 단축 또는 NAS 증설 결정 시점.

## 환경별 동작

| 환경 | StoragePort 구현 |
|------|-----------------|
| `app.storage.minio.endpoint` 설정 | `MinIOStorageAdapter` |
| 미설정 (test/단위) | `InMemoryStorageAdapter` (fake URL, 업로드 내용만 메모리 보관) |

## 검증

- 단위: `InMemoryStorageAdapterContractTest`
- 통합: `MinIOStorageAdapterContractTest` (Testcontainer)
- 로컬 수동: Synology NAS 의 MinIO 컨테이너 (`http://<NAS-IP>:9001`) 또는
  `docker compose up minio` + Web UI (http://localhost:9001)

---

## 관련 문서

- [스토리지 셋업 가이드 (MinIO / 시놀로지 NAS)](../../production/setup/storage-setup.md) — MinIO 로컬 / NAS 셋업 가이드
- [ADR-003 · core 모듈을 `-api` / `-impl` 로 분리](../../philosophy/adr-003-api-impl-split.md) — StoragePort 가 `-api` 모듈에 있는 근거
- [ADR-007 · 솔로 친화적 운영](../../philosophy/adr-007-solo-friendly-operations.md) — 관리형 스토리지 선호 근거
