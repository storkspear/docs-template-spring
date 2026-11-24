# Storage Bucket Isolation

> **유형**: Explanation · **독자**: Level 2 · **읽는 시간**: ~6분

**설계 근거**: [`인프라 결정 기록 I-07 · 오브젝트 스토리지 2-tier 분리`](../deploy/decisions-infra.md) · [`오브젝트 스토리지 규약`](../../api-and-functional/functional/storage.md)

앱별 버킷을 어떻게 만들고, dev와 prod의 데이터를 어떻게 나누는지 설명해요. 내장 파일 API의 버킷 계산과 부팅 검증은 코드가 맡아요. 다만 공용 스토리지 자격증명으로 호출하는 `StoragePort`까지 앱별 접근을 제한하지는 않으므로, 이 두 경계를 구분해야 해요.

---

## 한 문장 요약

앱 업로드 버킷은 모든 환경에서 `<prefix><하이픈을 제거한 slug>-uploads`로 계산해요. dev와 prod가 MinIO를 공유하는 기본 구성에서는 dev에 `APP_STORAGE_BUCKET_PREFIX=dev-`를 설정해요. 공유 버킷 목록은 별도 용도이며, 내장 파일 API의 기본 업로드 대상을 바꾸지 않아요.

---

## 1. 격리 흐름 한눈에 보기

같은 앱이라도 DB는 연결 대상 schema로, 스토리지는 버킷 이름으로 데이터를 나눠요. 예를 들어 slug가 `gym-log`라면 기본 업로드 버킷에 쓰는 이름은 `gymlog`예요.

```text
PostgreSQL
    ├── gymlog schema  ← SlugContext에 맞는 DataSource로 라우팅
    └── foodlog schema

MinIO (dev/prod 공유 endpoint 예시)
    ├── dev-gymlog-uploads  ← dev, prefix=dev-
    ├── dev-foodlog-uploads
    ├── gymlog-uploads      ← prod, prefix 없음
    └── foodlog-uploads
```

`BucketNaming`은 프로비저닝과 내장 파일 API가 같은 이름을 쓰도록 해요. DB의 `SchemaRoutingDataSource`도 연결 대상을 고르는 역할을 맡아요. 실제 DB 권한 격리는 접속 role의 권한에 달려 있어요. 운영에서 공용 DB 자격증명으로 앱 연결을 파생할 수 있으므로, 라우팅만으로 임의의 다른 schema 접근까지 거부한다고 해석하지 않아요.

---

## 2. 2-tier 컨벤션 (I-07)

[I-07](../deploy/decisions-infra.md)은 로컬 공유 버킷과 운영 앱별 버킷을 나눴던 결정 기록이에요. 현재 내장 파일 API는 로컬을 포함한 모든 환경에서 앱별 업로드 버킷을 사용해요. 환경 차이는 endpoint와 prefix로 표현해요.

| 환경 | 앱 업로드 버킷 예시 | 운영 기준 |
|---|---|---|
| local | `gymlog-uploads` | 로컬 MinIO를 사용하고, prefix를 설정했다면 함께 붙여요 |
| dev-server | `dev-gymlog-uploads` | 기본 구성은 prod와 MinIO를 공유하므로 `dev-`로 나눠요 |
| prod | `gymlog-uploads` | 기본 prefix는 비어 있어요 |

`basic-bucket`·`dev-basic-bucket`·`dev-shared` 같은 이름은 명시적으로 등록한 공유 버킷의 예시예요. 그 이름을 설정했다고 사용자 첨부파일이 공유 버킷으로 이동하지는 않아요. 영수증·음성 등 별도 category 버킷을 추가하려면 해당 도메인의 소비 코드와 정책도 함께 정의해야 해요. 내장 파일 API가 자동으로 category를 나누지는 않아요.

`APP_STORAGE_BUCKET_PREFIX`가 있으면 공유 목록의 각 이름도 그 접두사로 시작해야 해요. prefix가 비었는데 공유 목록에 `dev-`로 시작하는 항목이 있어도 부팅 검증에서 거부해요. 또 실제 MinIO를 사용하는 dev 프로필은 빈 prefix로 부팅할 수 없어요. dev 전용 MinIO를 따로 쓴다면 그 환경에도 명시적인 prefix를 정해요.

버킷 이름과 object key는 별개예요. 같은 object key도 환경별 버킷 안에서는 서로 다른 객체예요. 키 구조와 업로드 계약은 [스토리지 규약](../../api-and-functional/functional/storage.md), dev 배포 경계는 [develop 브랜치 정책](../operations/develop-branch-policy.md#5-dev-server-vs-prod--격리-모델)을 참고해요.

---

## 3. 자동 프로비저닝 (`BucketProvisioner`)

`BucketProvisioner`는 등록된 앱 DataSource에서 슬러그 목록을 얻고, 각 앱의 `BucketNaming.forSlug` 결과와 `APP_STORAGE_MINIO_BUCKETS_*` 공유 목록을 합쳐 버킷을 준비해요. 앱 업로드 버킷을 환경 변수 슬롯에 하나씩 추가할 필요는 없어요.

```bash
# dev 예시: 앱 버킷은 dev-<normalizedSlug>-uploads로 자동 파생해요.
APP_STORAGE_BUCKET_PREFIX=dev-

# 별도 공유 버킷을 쓸 때만 목록에 넣어요. prefix도 맞춰요.
APP_STORAGE_MINIO_BUCKETS_0=dev-basic-bucket
```

같은 이름은 한 번만 준비하고, 앱 업로드 버킷에는 만료 없음 정책을 우선해요. 등록된 앱이 없고 공유 목록도 비었을 때만 준비할 대상이 없어져요. 기본값에서는 virtual thread에서 준비하고 실패한 버킷을 경고로 남겨요. `app.storage.minio.strict-startup=true`면 동기로 준비하다 실패할 때 부팅도 실패해요.

endpoint가 없는 local·test에서는 InMemory를 사용할 수 있어요. dev·prod는 `APP_STORAGE_IN_MEMORY_FALLBACK=true`를 명시해야 허용해요. InMemory의 `mem://` URL은 실제 스토리지 업로드를 검증하지 못해요.

### Retention (lifecycle)

앱 업로드 버킷에는 만료 규칙을 걸지 않아요. `ensureBucket`은 기존 만료 규칙도 제거해요. 사용 중인 첨부가 버킷의 일괄 만료로 사라지지 않도록 수명은 첨부 도메인에서 관리해요.

`AttachmentPurgeScheduler`는 기본적으로 켜져 있고, soft-delete 후 30일이 지난 첨부를 스토리지 객체와 함께 영구 삭제해요. 미연관 선업로드 회수는 기본적으로 꺼져 있어요. `APP_UPLOADS_ORPHAN_PURGE_ENABLED=true`인 앱에서만 기본 24시간 유예를 지난 미연관 객체를 회수해요. 연관 없이 범용 업로드를 사용하는 앱은 이 옵션을 켜기 전에 사용 방식을 확인해요. 세부 조건과 설정은 [스토리지 규약](../../api-and-functional/functional/storage.md)의 Retention 절에서 관리해요.

공유 버킷에는 `APP_STORAGE_MINIO_DEFAULT_RETENTION_DAYS`(기본 90일)를 적용해요. 단, 공유 목록에 남은 이름이 등록된 앱 업로드 버킷의 이름과 일치하거나 접두사만 다르면 만료를 적용하지 않고 정리할 항목임을 경고해요. 앱마다 다른 정책이 필요하면 파생 레포에서 `BucketProvisioner` 빈을 재정의해요.

기존 앱 버킷의 만료 규칙은 다음 프로비저닝 성공 시 제거돼요. 긴급하게 직접 제거할 때는 대상 버킷을 확인한 뒤 `mc ilm rule rm --all --force <alias>/<bucket>`을 사용해요.

---

<a id="4-격리의-경계--코드가-강제하지-않는다"></a>

<a id="4-격리의-경계-코드가-강제하지-않는다"></a>

## 4. 격리의 경계 — 접근 권한은 별도로 제한해요

`BucketNaming`과 부팅 검증은 이름 계산과 설정 일관성을 지켜요. 앱의 `FileController`·`AttachmentServiceImpl`, 운영 콘솔의 `AdminFileService`·`AdminContentService`가 이 계산을 공유해요.

다만 `StoragePort`는 bucket을 문자열로 받아요. 각 호출에서 현재 slug와 버킷의 소유 관계를 검증하지는 않아요.

```java
boolean bucketExists(String bucket);
void ensureBucket(String bucket, BucketPolicy policy);
```

기본 구성은 `APP_STORAGE_MINIO_ACCESS_KEY`·`APP_STORAGE_MINIO_SECRET_KEY` 자격증명을 공유해요. 이 자격증명에 여러 버킷 권한이 있으면 잘못된 버킷 이름을 전달한 코드도 그 권한으로 동작할 수 있어요. 이름 계산을 공통화한 것과 IAM으로 접근을 차단하는 것은 다른 방어선이에요.

앱별 access key와 최소 권한 정책을 도입하려면 자격증명 선택과 운영 절차를 함께 설계해야 해요. 현재 템플릿에 자동으로 구현된 기능으로 가정하지 않아요.

---

## 5. 운영 절차

### 5-1. 새 슬러그의 bucket 추가

`new app`은 앱의 DataSource를 생성해요. 다음 부팅에서 등록된 DataSource를 바탕으로 업로드 버킷을 자동 준비하므로, `APP_STORAGE_MINIO_BUCKETS_<N>`에 앱 버킷을 추가하지 않아요.

```bash
<repo> new gymlog
# 앱을 포함해 다시 빌드·부팅하면 gymlog-uploads가 준비돼요.
# dev prefix가 dev-이면 dev-gymlog-uploads가 준비돼요.
```

공유·임시 버킷을 따로 쓰는 경우에만 환경 변수 목록을 늘려요. 원격 배포에 전달되는 슬롯은 현재 Kamal·GitHub Actions 배선도 확인해야 해요. 로컬 환경 파일에 새 슬롯을 적는 것만으로 원격에 전달되지는 않아요.

### 5-2. 사용량 모니터링

```bash
mc admin info <alias>        # MinIO 클러스터 상태
mc du <alias>/<bucket>       # 버킷 사용량
```

로컬 MinIO 콘솔은 `http://localhost:9001`에서 볼 수 있어요.

### 5-3. 슬러그 철수 시 bucket 정리

정리 전에 실제 bucket·schema 이름과 백업을 확인해요. `force-clear <slug>`는 해당 slug의 데이터만 고르더라도 공용 서비스의 컨테이너·DNS·ingress 정리를 먼저 수행해요. 특정 앱의 버킷만 지우는 명령으로 사용하지 않아요. 단계와 확인 절차는 [운영 런북](../deploy/runbook.md)에서 관리해요.

현재 스크립트는 schema를 입력 slug와 정확히 일치하는 이름으로 찾고, 버킷은 `<입력 slug>-` 접두사로 찾아요. 하이픈을 제거한 앱 이름이나 `dev-` prefix와 자동으로 일치한다고 가정하지 말고, 실행 전 출력되는 인벤토리와 실제 이름을 대조해요.

로컬에서도 앱별 버킷을 통째로 지우면 그 앱의 첨부파일이 모두 사라져요. 별도 공유 버킷은 여러 소비자가 쓸 수 있으므로 소비 범위와 object key 규약을 확인해 필요한 객체만 정리해요.

---

## 6. 관련 문서

- [인프라 결정 기록 I-07](../deploy/decisions-infra.md) — 초기 2-tier 정책의 선택 근거
- [오브젝트 스토리지 규약](../../api-and-functional/functional/storage.md) — 업로드·Signed URL·object key·retention 정본
- [스토리지 셋업 가이드](./storage-setup.md) — MinIO 로컬·NAS 설치와 연결
- [Multi-tenant Architecture](../../structure/multitenant-architecture.md) — DB 연결과 schema 격리
- [ADR-018 · SchemaRoutingDataSource](../../philosophy/adr-018-schema-routing-datasource.md) — 라우팅 설계
