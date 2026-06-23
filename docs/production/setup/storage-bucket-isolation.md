# Storage Bucket Isolation

> **유형**: Explanation · **독자**: Level 2 · **읽는 시간**: ~6분

**설계 근거**: [`인프라 결정 기록 I-07 · 오브젝트 스토리지 2-tier 분리`](../deploy/decisions-infra.md) · [`오브젝트 스토리지 규약`](../../api-and-functional/functional/storage.md)

이 문서는 MinIO·R2 의 bucket 을 슬러그 단위로 어떻게 격리하는지 설명해요. DB schema 격리와 같은 정신인데, 스토리지 쪽은 코드가 강제하는 게 아니라 운영 컨벤션으로 정착돼 있어서 그 경계가 어디까지인지를 짚는 게 핵심이에요.

---

## 한 문장 요약

스토리지 격리는 환경별 2-tier 컨벤션입니다. 로컬은 파생 레포가 공유하는 단일 `dev-shared` bucket 을 쓰고, 운영은 앱별·용도별 `<slug>-<category>` bucket 으로 나눠요. 코드는 환경을 모르고 `.env` 의 bucket 이름만 읽습니다.

---

## 1. 격리 흐름 한눈에 보기

DB schema 격리와 스토리지 격리를 나란히 두면 결이 보여요. schema 는 한 Postgres 안에서 네임스페이스로 갈리고, bucket 은 한 MinIO endpoint 안에서 이름으로 갈립니다.

```
postgres (단일 instance)
    ├── gymlog schema          ← 슬러그 격리 (코드 강제: SchemaRoutingDataSource)
    └── foodlog schema

MinIO (단일 endpoint)
    ├── [로컬]  dev-shared      ← 파생 레포 공유, disposable
    │
    └── [운영]  gymlog-uploads  ← <slug>-<category>, 앱별 + 용도별
                foodlog-uploads
```

차이가 하나 있어요. schema 격리는 DB role 과 `SchemaRoutingDataSource` 가 런타임에 강제하지만, bucket 격리는 그런 코드 강제가 없어요. 단일 admin 자격이 모든 bucket 에 접근하고, 슬러그 간 분리는 이름 컨벤션과 운영 절차로만 지켜집니다. 이 한계는 [§4](#4-격리의-경계-코드가-강제하지-않는다) 에서 자세히 다뤄요.

---

## 2. 2-tier 컨벤션 (I-07)

bucket 네이밍은 [`I-07`](../deploy/decisions-infra.md) 에서 정한 환경별 2-tier 정책입니다. 환경마다 다른 bucket 을 쓰되, 코드는 환경을 모르고 `.env` 의 이름만 읽어 스위치해요.

| 환경 | 컨벤션 | 예시 | 특징 |
|---|---|---|---|
| 로컬 개발 | `dev-shared` (단일, 파생 레포 공유) | `dev-shared` | disposable — `mc rb --force dev-shared` 로 수시 wipe |
| 운영 | `<slug>-<category>` (앱별 + 용도별) | `gymlog-uploads`, `sumtally-receipts` | 앱별 lifecycle·retention·정리 |

`<slug>` 은 소문자 영문·숫자·하이픈만 쓰는 [`appSlug`](../../reference/glossary.md#이-레포-고유-용어) 형식이고, `<category>` 는 용도 구분이에요. `new app` 이 자동 주입하는 기본 category 는 `uploads` 입니다.

| 카테고리 | 용도 | 예시 |
|---|---|---|
| `uploads` | 사용자 업로드 — `new app` 기본값 | `gymlog-uploads` |
| `receipts` | 영수증·증빙 | `sumtally-receipts` |
| `avatars` | 프로필 이미지 | `sumtally-avatars` |
| `voices` | 음성 자산 | `voicechat-voices` |

> 템플릿 레포 자체의 로컬 docker MinIO 는 `.env.example` 출하값 `basic-bucket` 을 그대로 씁니다 (템플릿 통합 테스트용). 파생 레포를 만든 뒤에 위 2-tier 규약을 적용하세요.

object key 는 환경과 무관하게 `<appSlug>/<category>/...` 로 시작해서, 로컬과 운영 사이에 object 를 그대로 복사해도 키가 깨지지 않아요. 키 패턴의 상세는 [`오브젝트 스토리지 규약`](../../api-and-functional/functional/storage.md) 에 있습니다.

---

## 3. 자동 프로비저닝 (`BucketProvisioner`)

bucket 은 `mc mb` 같은 명령으로 사람이 직접 만들지 않아요. Spring 부팅이 끝나면 `BucketProvisioner` 가 `.env` 의 `APP_STORAGE_MINIO_BUCKETS_*` 를 순회하며 없는 bucket 을 만들고 retention 을 적용합니다 (`core/core-storage-impl/.../BucketProvisioner.java`).

```bash
# .env 또는 .env.prod — 인덱스 0 부터 순차
APP_STORAGE_MINIO_BUCKETS_0=gymlog-uploads
APP_STORAGE_MINIO_BUCKETS_1=foodlog-uploads
```

동작은 bucket 마다 이렇게 흘러가요.

```
ApplicationReadyEvent
   ↓
buckets 가 비어 있으면 skip (부팅은 통과)
   ↓
bucketExists 확인
   ↓
없으면 makeBucket
   ↓
retention lifecycle 적용 (SetBucketLifecycle)
```

이미 존재하는 bucket 은 생성을 건너뛰므로 부팅 시마다 안전합니다 (멱등). endpoint 에 닿지 못하면 그 bucket 만 경고를 남기고 넘어가며, 부팅 자체를 막지는 않아요.

> **virtual thread 분리** — provisioning 은 별도 virtual thread 에서 돌아요. MinIO endpoint 가 응답하지 않을 때 그 대기가 readiness 신호를 막아 `/actuator/health/readiness` 가 영구 `OUT_OF_SERVICE` 로 남는 걸 피하기 위함입니다.

`APP_STORAGE_MINIO_ENDPOINT` 가 비어 있으면 `MinIOStorageAdapter` 대신 `InMemoryStorageAdapter` 가 등록돼요 (`StorageAutoConfiguration`). 이 fallback 은 `mem://` placeholder URL 만 돌려주고 업로드를 메모리에만 담아서 재시작하면 사라지니, 실제 bucket 격리는 endpoint 가 설정된 환경에서만 의미가 있어요.

### Retention (lifecycle)

기본 retention 은 **90일** 이고, `BucketProvisioner` 가 부팅 시 lifecycle rule 로 적용합니다 (`BucketPolicy.retention` → MinIO `SetBucketLifecycle`). 값을 바꾸려면 두 가지 방법이 있어요.

- 환경변수 `APP_STORAGE_MINIO_DEFAULT_RETENTION_DAYS` 를 바꿔요 (모든 등록 bucket 에 동일 적용).
- 파생 레포가 자기 `BucketProvisioner` 빈을 override 해서 bucket 별로 다른 정책을 줘요.

> bucket 별 retention 을 환경변수만으로 따로 주는 인덱스 문법은 아직 없어요. bucket 마다 다른 retention 이 필요하면 빈 override 가 현재 방법입니다.

---

## 4. 격리의 경계 — 코드가 강제하지 않는다

여기가 이 문서에서 가장 중요한 부분이에요. **bucket 격리는 이름 컨벤션과 운영 절차로만 지켜지고, 코드가 런타임에 막지는 않습니다.**

`StoragePort` 는 `bucket` 을 그냥 문자열로 받아요. 슬러그 검증도, prefix 강제도 하지 않습니다.

```java
// core-storage-api/.../StoragePort.java 발췌
boolean bucketExists(String bucket);
void ensureBucket(String bucket, BucketPolicy policy);
```

운영의 모든 bucket 은 단일 admin 자격 (`APP_STORAGE_MINIO_ACCESS_KEY` / `SECRET_KEY`) 으로 접근해요. 애플리케이션이 잘못된 bucket 이름을 넘기면 MinIO 는 그대로 처리합니다. 즉 슬러그 간 분리를 보장하는 건 "각 앱이 자기 bucket 이름만 넘긴다" 는 컨벤션이지, IAM 정책이나 포트 레벨 검증이 아니에요.

이것이 DB schema 격리와의 결정적 차이예요. schema 쪽은 DB role 과 `SchemaRoutingDataSource` 가 다른 schema 접근을 런타임에 거부하지만, 스토리지 쪽은 그런 방어선이 없어요. 슬러그별 access key 발급과 IAM 정책으로 코드 버그가 있어도 MinIO 가 거부하게 만드는 강화는 향후 작업으로 남아 있습니다 (Item Ops-1, [`I-07`](../deploy/decisions-infra.md) 의 운영 tier).

---

## 5. 운영 절차

### 5-1. 새 슬러그의 bucket 추가

`new app` 이 슬러그를 추가할 때 `APP_STORAGE_MINIO_BUCKETS_<N>=<slug>-uploads` 한 줄을 자동으로 주입해요 (`tools/new-app/new-app.sh` Step 12). 인덱스 `<N>` 은 `.env` 의 기존 최대값 다음으로 자동 증가하므로 직접 셀 필요가 없어요.

```bash
<repo> new gymlog
# → .env 에 APP_STORAGE_MINIO_BUCKETS_2=gymlog-uploads 자동 추가 (다음 빈 인덱스)
# → 재기동 시 BucketProvisioner 가 생성
```

`uploads` 외의 category (예: `gymlog-receipts`) 가 필요하면 그 줄을 직접 늘리거나 바꿔요. 같은 키가 이미 있으면 주입은 건너뛰어 (idempotent) 여러 번 실행해도 안전합니다.

### 5-2. 사용량 모니터링

```bash
mc admin info <alias>        # MinIO 클러스터 상태
mc du <alias>/<bucket>       # bucket 사용량
```

웹으로 보려면 MinIO 콘솔 (로컬 `http://localhost:9001`) 을 쓰면 돼요.

### 5-3. 슬러그 철수 시 bucket 정리

운영 앱을 은퇴시킬 때 데이터 정리는 `force-clear` 가 맡아요. bucket 이 앱별로 나뉘어 있어 (`<slug>-<category>`) bucket 단위로 깔끔하게 비우거나 삭제할 수 있습니다.

```bash
<repo> prod force-clear gymlog   # 운영 데이터·인프라 (schema · 버킷 · 컨테이너) 정리
```

로컬은 `dev-shared` 가 공유라서 bucket 을 통째로 비우면 다른 파생 레포의 dev 데이터에도 영향이 가니, 슬러그 prefix 로 object 만 골라 지우는 게 안전해요.

---

## 6. 관련 문서

- [`인프라 결정 기록 I-07`](../deploy/decisions-infra.md) — 2-tier 분리 정책의 선택 근거
- [`오브젝트 스토리지 규약`](../../api-and-functional/functional/storage.md) — Signed URL·object key·retention 상세 규약
- [`스토리지 셋업 가이드 (MinIO · 시놀로지 NAS)`](./storage-setup.md) — MinIO 로컬·NAS 셋업 절차
- [`Multi-tenant Architecture`](../../structure/multitenant-architecture.md) — 슬러그 격리 원칙 (schema 쪽)
- [`ADR-018 · SchemaRoutingDataSource`](../../philosophy/adr-018-schema-routing-datasource.md) — schema 격리의 런타임 강제
