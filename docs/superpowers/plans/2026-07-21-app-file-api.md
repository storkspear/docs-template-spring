# 앱 클라이언트용 파일 업로드·조회 API 구현 플랜 (DRAFT)

> **상태: 초안 — 리뷰용. 커밋 금지.** 스펙 MD 미작성(이 문서가 유일 소스) — 리뷰 확정 후 스펙 분리 여부 결정.
> **For agentic workers:** 각 Task 끝에 독립 테스트 + 커밋. push 는 배치. 계약 변경(Task 4)은 3면(spring/admin/flutter) 동기 완료 전 push 금지.

**Goal:** Flutter 앱 유저가 파일(이미지)을 presigned 로 직접 업로드하고, 본인 소유 또는 공개 게시물 첨부를 presigned GET 으로 조회. 게시물 작성 시 `attachmentKeys` 로 첨부 연관 확정.

**Architecture:** 관리자 업로드 플로우(`AdminContentService.issueUpload` = `AttachmentPort.create`(미연관 선등록) → `StoragePort.generatePresignedUpload/Download`, 버킷 `{slug}-uploads`)를 앱 스코프로 재사용. 신규 `FileController` 는 `PostController` 패턴(impl 모듈의 Port-based controller, AutoConfiguration 자동 노출)으로 `core-attachment-impl` 에 배치. DB 는 기존 `attachment_file`(V018) 그대로 — **마이그레이션 없음**.

**Tech Stack:** Spring Boot 멀티모듈(schema-per-app), core-attachment/-storage/-content Port 조합, Bucket4j RateLimitFilter, Flutter FeatureKit(Dio), contract-snapshot 파이프라인.

---

## 설계 결정 (①~⑦)

### ① API 표면

| 메서드 | 경로 | 요청 | 응답 |
|---|---|---|---|
| POST | `{APP_BASE}/files/uploads` | `{filename, contentType, sizeBytes}` | `{attachmentKey, uploadUrl, previewUrl, expiresAt}` |
| GET | `{APP_BASE}/files/{key}` | — | `{downloadUrl, expiresAt, contentType, sizeBytes, originalFilename}` |

- `ApiEndpoints.Files` inner class 신설: `BASE = APP_BASE + "/files"`, `UPLOADS = "/uploads"`, `BY_KEY = "/{key}"`. PUBLIC_PATTERNS 미등록 → `anyRequest().authenticated()` 기본 차단으로 자동 보호(SecurityConfig 변경 불필요).
- 앱 계약은 **id 가 아니라 `storageKey`(UUID, 비추측)** — admin(`AdminContentUploadResponse.attachmentId`)과 달리 내부 id 미노출. GET 경로 변수와 게시물 연관 키가 동일 값으로 일관.
- 발급 시 검증: contentType 화이트리스트 + sizeBytes 상한(아래 ②). `AttachmentCreateRequest` 의 `uploadedBy/uploadedIp/userAgent` 를 앱 흐름이 처음으로 채움(admin 은 null) — 콘솔 "업로더" 컬럼이 자동으로 살아남.
- GET 인가: `storageKey` 조회 → `status==ACTIVE` ∧ (`uploadedBy==인증 userId` ∨ (`associatedType=="POST"` ∧ `associatedId!=null` ∧ 해당 게시물 `ACTIVE`)). 불충족은 전부 **404**(존재 은닉 — 비추측 키 정책과 일관).

**게시물 첨부 연관 (계약 변경):** 앱-facing 작성 body 는 실물 조사 결과 `PostWriteRequest`(port DTO 인 `PostCreateRequest` 가 아님 — 지시문 정정). `PostWriteRequest` 에 `List<String> attachmentKeys`(선택, ≤10) 추가. `PostController.create` 가 admin 패턴(`AdminContentService.associateAttachments`)대로 `content.create(...)` 후 `AttachmentPort` 로 연관 확정 — 단 **업로더 본인 검증 추가**(`uploaded_by == authorUserId`, 타인 선업로드 탈취 방지). `PostCreateRequest`(port)·`AdminPostWriteRequest`(admin, attachmentIds 기반)는 불변.

**3면 동기 절차 (계약 변경이므로 필수):**
1. **template-spring** — `ApiEndpoints.Files`·`PostWriteRequest`·신규 에러코드 반영 후 `./tools/contract-snapshot/gen-snapshot.sh` 재실행 → `docs/api-contract/contract-snapshot.json` 갱신 커밋(안 하면 `contract-snapshot.yml` CI staleness FAIL). `DTO_ALLOWLIST` 에 `PostWriteRequest`·`FileUploadRequest` 추가(flutter 가 body 로 보내는 record 만 등재하는 규칙).
2. **admin-api(react-admin)** — port DTO 불변이므로 코드 변경 0. 확인만: `ContentComposePage`(attachmentIds 흐름)·`FilesPage` 회귀 그린.
3. **template-flutter** — `tools/contract-check/refresh-spec.sh` 로 스냅샷 복사 → `api_endpoints.dart`(files 경로)·`error_code.dart`(ATC_*) 갱신 → `flutter test` 의 `test/contract/contract_test.dart`(클라 참조 ⊆ 스냅샷) 그린. 두 레포 **같은 커밋 메시지**(`docs/api-contract/README.md` 쌍 운영 규칙).

### ② 권한·정책

- **인증 필수** — 두 엔드포인트 모두. `@CurrentUser AuthenticatedUser` + `AppSlugVerificationFilter`(path slug ↔ JWT slug) 기존 체계 그대로.
- **용량 상한** — `app.uploads.max-size-bytes`(default 10MiB) 프로퍼티. 발급 시 `sizeBytes` 검증. 한계: presigned PUT 은 실제 크기를 스토리지가 강제하지 않음(`UploadUrlResponse.maxSizeBytes` 는 권고) — 사후 방어는 콘솔 검역 + purge 로 커버, `headObject` 사후검증은 backlog.
- **kind 화이트리스트** — `app.uploads.allowed-content-types`(default `image/jpeg,image/png,image/webp,image/gif,image/heic`). admin 의 `image/*` startsWith 보다 좁은 정확 매치. 위반 422.
- **per-user rate limit** — `RateLimitFilter.SENSITIVE_SUFFIXES` 에 `"/files/uploads"` 추가 → strictRpm(10/min), 키 `{appSlug}:user:{userId}`. suffix 는 `"/uploads"` 단독이 아닌 `"/files/uploads"` 로 — admin `/content/uploads` 오매칭 방지.
- **검역 차단** — `QUARANTINED/DELETED` 는 GET 404(위 인가 규칙에 포함). 콘솔 검역 즉시 앱 서빙 중단.

### ③ attachment_file 재사용 (associated_type 확장 여부)

**확장 불필요 — 스키마·마이그레이션 변경 0.** `associated_type` 은 free-form VARCHAR(50)(enum 제약 없음), 앱 업로드도 admin 과 동일하게 `"POST"` 미연관 선등록 → 글 저장 시 연관 확정. `uploaded_by/uploaded_ip/user_agent` 컬럼 기존재. GET 은 `uk_attachment_file_storage_key` 유니크 인덱스 사용 — 신규 인덱스 불필요. `new-app.sh` V018 블록 무변경.

### ④ Flutter kit 설계 — 신규 `file_kit` (backend_api_kit 확장 아님)

근거(기존 kit 컨벤션): backend_api_kit 은 순수 transport(Dio+인터셉터 3종, 도메인 무지)이고 도메인 플로우는 전용 kit(auth_kit/payment_kit/notifications_kit)로 분리하는 구조. 또 presigned PUT 은 절대 URL 로 스토리지 호스트에 직접 쏘는 raw HTTP — `ApiClient` 계약(`/api/apps/{slug}` 자동 prefix + `ApiResponse` 래핑 + Auth 인터셉터) 밖이라 별도 plain Dio 가 필요 → kit 분리가 자연스러움.

- `lib/kits/file_kit/`: `kit_manifest.yaml`(requires: backend_api_kit), `file_kit.dart`, `file_upload_service.dart`, `README.md`.
- `FileUploadService.upload(bytes, filename, contentType)`: ① `ApiClient.post('/files/uploads')` 티켓 ② plain Dio 로 `uploadUrl` PUT(Content-Type 를 티켓과 **동일하게** — presigned 서명 포함이라 불일치 시 403) ③ `attachmentKey` 반환. `getDownloadUrl(key)` = `ApiClient.get('/files/$key')`.
- 경로 상수는 `api_endpoints.dart` 에 상대 경로로 추가(`userMe` 컨벤션) — `contract_test.dart` 가 이 파일을 읽으므로 계약 검증 자동 편입.
- 조립 3곳 동기: `app_kits.yaml` + `main.dart` `AppKits.install` + `dart run tool/configure_app.dart` OK.
- 게시물 `attachmentKeys` 사용부는 `features/`(파생 레포 영역) — 템플릿은 file_kit README 에 예시만.

### ⑤ react-admin 영향 — 변경 없음(확인만)

`FilesPage.tsx` 가 이미 유저 업로드 모더레이션 콘솔: 목록(kind/prefix/페이징)·검역/해제·삭제대상 복원·reveal(열람이력)·업로더 컬럼(`uploadedBy`). 앱 업로드도 같은 `attachment_file` 행이므로 자동 노출. `ContentDetailPage` 첨부 표시도 기존 `AttachmentPort.listByAssociated` 경유로 동일. 검증 스텝에서 확인만.

### ⑥ 마이그레이션·에러코드

- **마이그레이션: 없음** (③ 참조).
- **에러코드**: 신규 `AttachmentError implements ErrorInfo` + `AttachmentException` (`core-attachment-api/.../exception/` — StorageError 패턴). 번호는 추가만:
  - `ATC_001` FILE_NOT_FOUND (404) — 미존재·비ACTIVE·소유/공개 불충족 공용(존재 은닉)
  - `ATC_002` CONTENT_TYPE_NOT_ALLOWED (422)
  - `ATC_003` FILE_SIZE_EXCEEDED (413)
  - `ATC_004` ATTACHMENT_ASSOCIATION_INVALID (422) — attachmentKeys 검증 위반
- `gen-snapshot.sh` 가 `*Error.java` enum 을 자동 수집 → 스냅샷 반영. flutter `error_code.dart` 미러 추가.

### ⑦ 단계 분할

서버(Task 1~3) → 계약 동기(Task 4) → Flutter(Task 5) → 검증(Task 6). 아래 상세.

---

## Global Constraints

- Mapper/Converter 신설 금지(ArchUnit r22). Controller→Repository 직접 호출 금지(Service 경유). cross-domain 은 Port 로만 — `FileController` 의 `ContentPort` 의존은 `PostController`→`UserPort` 선례.
- `ErrorInfo` enum 번호 재배치 금지(추가만). `com.factory.*` 패키지 불변.
- `AttachmentPort`(api) 에 Spring 타입 누출 금지 — 도메인 record 만.
- 커밋 Conventional Commits, **Co-Authored-By 금지**(husky 차단). 한 커밋=한 논리변경.
- 계약 변경 커밋 후 `gen-snapshot.sh` 미실행 상태로 push 금지(CI staleness FAIL).
- flutter: `app_kits.yaml`↔`main.dart` 수동 동기 + `configure_app.dart` OK, i18n ko/en ARB 동시.

---

## Task 1: 백엔드 — AttachmentPort 확장 + AttachmentError

**Files:**
- Create: `core/core-attachment-api/.../exception/AttachmentError.java`, `AttachmentException.java`
- Modify: `core/core-attachment-api/.../AttachmentPort.java` (`getByStorageKey`/`associateByKeys` 추가)
- Modify: `core/core-attachment-impl/.../AttachmentServiceImpl.java` (구현 — repo `findByStorageKey` 기존재)
- Test: `core/core-attachment-impl/src/test/.../AttachmentServiceImplIT.java`

**Interfaces (Produces):**
- `Optional<AttachmentFileDto> getByStorageKey(String slug, String storageKey)`
- `void associateByKeys(String slug, List<String> storageKeys, String associatedType, Long associatedId, Long requiredUploader)` — slug 일치 ∧ ACTIVE ∧ (미연관 ∨ 동일 대상 멱등) ∧ `uploadedBy==requiredUploader` 위반 시 IllegalArgumentException(기존 `associate` 규약과 동일 채널)

- [ ] **Step 1: 실패 테스트** — 키 조회(slug 불일치/미존재 empty), associateByKeys(정상 확정·멱등·타인 업로드 거부·QUARANTINED 거부).
- [ ] **Step 2: 실패 확인** — `./gradlew :core:core-attachment-impl:test`.
- [ ] **Step 3: 구현 → 통과** — 동일 명령 PASS.
- [ ] **Step 4: 커밋** — `feat(attachment): storageKey 조회·업로더 검증 연관 확정 Port 추가`

## Task 2: 백엔드 — FileController(티켓 발급·presigned GET) + 정책

**Files:**
- Modify: `common/common-web/.../ApiEndpoints.java` (`Files` inner class)
- Create: `core/core-attachment-impl/.../controller/FileController.java`
- Create: `core/core-attachment-api/.../dto/FileUploadRequest.java`, `FileUploadResponse.java`, `FileDownloadResponse.java` (naming.md suffix 대조 후 확정)
- Create: 업로드 정책 프로퍼티(`app.uploads.*` — RateLimitProperties record 패턴)
- Modify: `core/core-attachment-impl/.../AttachmentAutoConfiguration.java` (controller 노출), `build.gradle` (`core-content-api` 의존 추가)
- Modify: `common/common-web/.../ratelimit/RateLimitFilter.java` (SENSITIVE_SUFFIXES 에 `"/files/uploads"`)
- Test: `FileControllerTest`(MockMvc — 화이트리스트 422/상한 413/미인증 401/검역 404/공개 게시물 첨부 200)

**Interfaces:**
- Consumes: Task 1 Port, `StoragePort.generatePresignedUpload/Download`(버킷 `{slug}-uploads`, TTL 10분 — AdminContentService 상수 준용), `ContentPort`(게시물 ACTIVE 확인), `@CurrentUser`.

- [ ] **Step 1: 실패 테스트** → **Step 2: 실패 확인** → **Step 3: 구현** → **Step 4: 통과** — `./gradlew :core:core-attachment-impl:test :common:common-web:test`
- [ ] **Step 5: ArchUnit** — `./gradlew :bootstrap:test`
- [ ] **Step 6: 커밋** — `feat(attachment): 앱 파일 업로드 티켓·presigned 조회 API(/files)`

## Task 3: 백엔드 — PostWriteRequest.attachmentKeys 연관 확정

**Files:**
- Modify: `core/core-content-api/.../dto/PostWriteRequest.java` (`@Size(max=10) List<String> attachmentKeys` 선택 필드)
- Modify: `core/core-content-impl/.../controller/PostController.java` (`AttachmentPort` ObjectProvider 주입 — 미조립 시 attachmentKeys 존재하면 CMN_009, admin `requireAttachmentPort` 패턴)
- Modify: `core/core-content-impl/build.gradle` (`core-attachment-api`)
- Test: `PostControllerTest` (연관 확정 위임·null/빈 리스트 무변화·검증 위반 ATC_004)

- [ ] **Step 1~4: TDD** — `./gradlew :core:core-content-impl:test`
- [ ] **Step 5: admin 회귀** — `./gradlew :core:core-admin-impl:test` (port DTO 불변 확인)
- [ ] **Step 6: 커밋** — `feat(content): 게시물 작성 attachmentKeys 첨부 연관(업로더 본인 검증)`

## Task 4: 계약 스냅샷 3면 동기

**Files:**
- Modify: `tools/contract-snapshot/gen-snapshot.sh` (`DTO_ALLOWLIST` += PostWriteRequest·FileUploadRequest)
- Regen: `docs/api-contract/contract-snapshot.json`

- [ ] **Step 1** — `./tools/contract-snapshot/gen-snapshot.sh` 실행, diff 에 files 경로·ATC_* 코드·DTO 필드 확인.
- [ ] **Step 2** — react-admin 무영향 확인: `template-react-admin` 에서 `npx tsc -b && npm run build`, `ContentComposePage`/`FilesPage` 목 회귀(코드 변경 0 기대 — grep 으로 admin 계약 파일 diff 없음 확인).
- [ ] **Step 3: 커밋** — `docs(api-contract): 앱 파일 API 계약 스냅샷 갱신` (docs/** 는 main push 시 docs-template-spring 자동 sync — 별도 절차 불필요)

## Task 5: Flutter — file_kit 신설 + 계약 sync

**Files (template-flutter):**
- Copy: `tools/contract-check/refresh-spec.sh` 실행(스냅샷 복사)
- Modify: `lib/kits/backend_api_kit/api_endpoints.dart` (`fileUploads`, `fileByKey(key)` 상대 경로), `error_code.dart` (ATC_001~004)
- Create: `lib/kits/file_kit/` (manifest·service·README — ④ 설계)
- Modify: `app_kits.yaml`, `lib/main.dart`
- Test: `test/kits/file_kit/file_upload_service_test.dart` (티켓→PUT 순서·Content-Type 동일성·에러 전파)

- [ ] **Step 1: 계약 sync** — refresh-spec 후 `flutter test test/contract` 그린.
- [ ] **Step 2: TDD 구현** — `flutter analyze && flutter test`, `dart run tool/configure_app.dart` Status: OK.
- [ ] **Step 3: 커밋** — template-spring Task 4 와 **같은 커밋 메시지** 규칙 준수.

## Task 6: 검증·리포트

- [ ] 백엔드 전 모듈 테스트 + ArchUnit: `./gradlew spotlessApply && ./gradlew build` (부팅 e2e 불가 시 모듈 테스트로 한정 — 선행 플랜과 동일 제약).
- [ ] 시나리오 통합테스트(Testcontainers): 업로드 티켓 → (모의) 오브젝트 존재 → 게시물 작성 attachmentKeys → 타 유저 GET 404 → 게시물 공개 후 GET 200 → 콘솔 검역 → GET 404.
- [ ] react-admin FilesPage 에서 앱 업로드 행 노출·검역 동작 확인(목 또는 로컬).
- [ ] 완료 보고: API PASS/FAIL 표 + 주요 응답 JSON 2~3개 + 코드리뷰(N+1/Exception/계층) + grep 검증(신규 엔드포인트/에러코드 개수 일치) 포함.

## Self-Review 체크

- 요구 커버리지: 티켓 발급 검증(T2), presigned GET 인가(T1/T2), attachmentKeys 계약(T3), 3면 동기(T4/T5), 정책 4종(T2), file_kit(T5), react-admin 확인(T4/T6), 마이그레이션 없음(③) — 전부 태스크 존재.
- 계약 일관성: 앱 표면은 storageKey 단일 식별자(POST 응답 `attachmentKey` = GET `{key}` = `attachmentKeys[]`). admin 표면(attachmentIds)은 불변.
- 지시문 정정 1건: 계약 변경 지점은 `PostCreateRequest`(port, 내부 DTO)가 아니라 앱-facing `PostWriteRequest` — 실물 조사(`PostController.create`, `AdminContentService.associateAttachments`) 근거.

## 리뷰 포인트 (미확정 — 확정 후 초안 해제)

1. GET 인가 불충족 404 vs 403 — 초안은 404(존재 은닉). 콘솔 UX 요구 시 재론.
2. HEIC 화이트리스트 포함 여부(iOS 기본 포맷 vs 서버측 변환 부재).
3. 미연관(orphan) 선업로드 정리 정책 — admin 흐름도 동일 미해결, 공용 backlog 로 분리 제안.
4. `attachmentKeys` 상한 10 의 근거(게시판 UX) — 앱별 프로퍼티화 여부.
5. presigned PUT 실제 크기 미강제 — `headObject` 사후검증 도입 시점.
