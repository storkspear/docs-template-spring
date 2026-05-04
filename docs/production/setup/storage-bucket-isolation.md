# Storage Bucket Isolation

> **유형**: Runbook · **독자**: 운영자 (Level 3) · **읽는 시간**: ~8분

이 문서는 **MinIO/R2 의 슬러그별 bucket 격리 정책**을 정리합니다. 슬러그 누수 / 권한 분리 / 운영 컨벤션.

> 📌 **현재 상태 (2026-05 기준)**: bucket 이름 컨벤션은 자동 prefix 미적용. 운영자가 `APP_STORAGE_MINIO_BUCKETS_*` 에 직접 슬러그 포함 (예: `gymlog-uploads`).
>
> 향후 자동 prefix + slug 격리 IAM 정책 — Phase 4 작업 예정.

---

## 1. 슬러그 격리 원칙

DB schema 와 동일하게 MinIO bucket 도 슬러그 단위로 격리합니다 — 한 앱의 코드 버그가 다른 앱의 파일에 접근하면 안 돼요.

```
postgres (단일 instance)
    ├── core schema     ← 공통 (audit_logs, users 등)
    ├── gymlog schema   ← 슬러그 격리
    └── foodlog schema

MinIO (단일 endpoint)
    ├── gymlog-uploads         ← <slug>-<category> 컨벤션
    ├── gymlog-images
    ├── foodlog-uploads
    └── foodlog-images
```

---

## 2. Bucket 이름 컨벤션

`<slug>-<category>` — 슬러그가 prefix, 용도가 suffix.

| 카테고리 | 용도 | 예시 |
|---|---|---|
| `uploads` | 사용자 업로드 (이미지/문서) | `gymlog-uploads` |
| `images` | 가공된 이미지 (썸네일 등) | `gymlog-images` |
| `videos` | 동영상 자산 | `gymlog-videos` |
| `exports` | 내보내기 / 백업 | `gymlog-exports` |

**규칙**:
- 슬러그 (lowercase a-z0-9-) + `-` + 카테고리. 다른 형식 X.
- 새 슬러그 만들 때 `<your-backend> new <slug>` 가 default category (`<slug>-uploads`) 를 자동 등록 (Phase 4 예정).
- 슬러그 이름이 다른 슬러그 이름의 prefix 가 되면 안 됨 (`gym` vs `gymlog` → 충돌). new-app.sh 가 검증.

---

## 3. 자동 프로비저닝

`BucketProvisioner` 가 부팅 시점에 `APP_STORAGE_MINIO_BUCKETS_*` 환경변수를 순회하며 멱등 생성:

```bash
# .env 또는 .env.prod
APP_STORAGE_MINIO_BUCKETS_0=gymlog-uploads
APP_STORAGE_MINIO_BUCKETS_1=gymlog-images
APP_STORAGE_MINIO_BUCKETS_2=foodlog-uploads
```

**멱등성**: 이미 존재하는 bucket 은 skip — 부팅 시마다 안전.

**동작**:
1. MinIO admin client 로 bucket 존재 확인
2. 미존재 시 createBucket
3. lifecycle policy (있으면) 적용 — `APP_STORAGE_MINIO_DEFAULT_RETENTION_DAYS=90` 등

---

## 4. 권한 분리 (Phase 4 예정)

> 현재는 단일 admin credential (`APP_STORAGE_MINIO_ACCESS_KEY/SECRET_KEY`) 가 모든 bucket 접근. 슬러그 간 격리는 application 레이어 (`StoragePort` 가 슬러그 검증) 만.

향후 (Phase 4):
- 슬러그별 access key / secret key 발급 (MinIO IAM)
- 각 슬러그의 bean 이 자기 key 만 보유
- IAM 정책으로 다른 슬러그 bucket 접근 거부 — application 버그가 있어도 MinIO 가 거부

### 4-1. MinIO IAM 정책 예시 (Phase 4 적용 예정)

```json
{
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
    "Resource": [
      "arn:aws:s3:::gymlog-*",
      "arn:aws:s3:::gymlog-*/*"
    ]
  }]
}
```

`gymlog-` prefix 만 허용 → 다른 슬러그 bucket 접근 시 403.

---

## 5. 운영 절차

### 5-1. 새 슬러그 추가 시

1. `<your-backend> new <slug>` 실행 — schema 자동 + (Phase 4 예정) bucket 자동 등록
2. 현재는 `.env.prod` 에 수동 추가 — 비어있는 다음 인덱스 (`<N>`) 사용:
   ```bash
   # 예: 기존 _0, _1, _2 가 차있으면 _3 부터
   APP_STORAGE_MINIO_BUCKETS_<N>=<slug>-uploads
   ```
3. deploy → 부팅 시 BucketProvisioner 가 자동 생성

### 5-2. Bucket 사용량 모니터링

```bash
# MinIO Console (https://minio-console.example.com)
# 또는 mc 명령:
mc admin info <alias>
mc du <alias>/<bucket>
```

### 5-3. Lifecycle policy 적용

`.env`:
```bash
APP_STORAGE_MINIO_DEFAULT_RETENTION_DAYS=90
```

부팅 시 BucketProvisioner 가 모든 등록 bucket 에 동일 lifecycle 적용. bucket 별 다른 retention 이 필요하면 `APP_STORAGE_MINIO_BUCKETS_<N>_RETENTION_DAYS` 로 override (Phase 4 예정).

---

## 6. 관련 문서

- [`Storage Setup`](./storage-setup.md) — MinIO 초기 설정 (endpoint / IAM)
- [`Multitenant Architecture`](../../structure/multitenant-architecture.md) — 슬러그 격리 원칙
- [`ADR-018 · SchemaRoutingDataSource`](../../philosophy/adr-018-schema-routing-datasource.md)
