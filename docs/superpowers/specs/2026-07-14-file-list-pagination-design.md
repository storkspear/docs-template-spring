# 파일 목록 페이지네이션 설계

> **유형**: Design(spec) · **작성일**: 2026-07-14 · **범위**: template-spring(backend) + template-react-admin(frontend) → admin-console-v2 전파

## 배경 / 문제

관리자 콘솔 **파일 페이지**는 현재 페이지네이션이 없다. `AdminFileService.listFiles(slug, prefix, max, deleted)` 가 `AttachmentPort.listActive/listDeleted(slug)` 로 **`attachment_file` DB 전체를 받아** in-memory 로 `subList(0, max)` + `truncated` 플래그만 내려준다(`max` 기본 200, clamp [1,1000]). 프론트는 최대 1000건을 한 번에 받아 타입 탭(오디오/이미지/영상)을 **클라이언트에서** 필터해 전부 렌더한다. 행이 많아지면 prefix 로 좁히라는 배너만 뜬다.

**핵심 사실**: 목록 소스가 스토리지 직접 리스팅이 아니라 **`attachment_file` DB(Spring Data `JpaRepository`)** 라, `Pageable`/`Page`(총건수 포함)로 **진짜 번호 페이지네이션(1·2·3…N + 총건수 + 페이지 점프)** 이 가능하다. schema-per-app 라우팅(`SchemaRoutingDataSource` + `SlugContext`)이라 쿼리에 slug 조건도 불필요.

## 목표

- **리스트 탭(오디오·전체·삭제대상)**: 하단 **번호 페이지네이션 UI** + 서버 페이징(page/size/total).
- **이미지·영상**: **인피니티 스크롤**(같은 paged 계약을 append 방식으로 소비) — 사용자 기존 선호.
- 타입 필터를 **서버로 이동**(kind) — 그래야 "오디오 3페이지"가 일관됨.
- `truncated` 플래그를 **page/size/total/totalPages 계약으로 교체**.

## 승인된 결정 (2026-07-14)

1. **범위**: 리스트 탭 = 번호 페이지네이션 / 이미지·영상 = 인피니티 스크롤. (다른 옵션 기각)
2. **kind 필터 서버 이동**: `content_type` prefix(`audio/`·`image/`·`video/`) 기준. 전체=kind 없음.
3. **prefix 필터도 DB-side 이동**: 지금은 리스팅 후 in-memory. 페이징하면 총건수가 틀어지므로 `originalFilename` prefix 를 쿼리로.
4. **리스트 페이지 크기 기본 20**, clamp [1,100]. size changer 없음(고정) — `AdminDataGrid` 컨벤션.
5. **전체·삭제대상 → `AdminDataGrid` 재사용**(서버 페이징 + `[틀고정·페이징·페이지크기]` footer 내장). 기존 `AdminMiniGrid` 대체.
6. **오디오 → `AudioList` + 하단 중앙 `<Pagination>` + "총 N건"**(ag-grid 아니라 틀고정 개념 없음, 심플 페이저).
7. **이미지·영상 → `MediaGrid` + `useInfiniteQuery`**(하단 근접 시 다음 페이지 append, `hasMore = page+1 < totalPages`).

## 아키텍처

### A. 백엔드 (template-spring)

**`core-attachment`**
- `AttachmentFileRepository (JpaRepository)` — 파생 메서드 조합 폭발(status×kind×prefix)을 피하려 **단일 `@Query`(JPQL) 2개**(활성/삭제)로 nullable 필터 처리. `Pageable`(정렬 `id desc`) 받아 `Page<AttachmentFile>` 반환:
  ```java
  @Query("""
      select a from AttachmentFile a
      where (:deleted = true and a.status = com.factory.core.attachment.api.AttachmentStatus.DELETED
             or :deleted = false and a.status <> com.factory.core.attachment.api.AttachmentStatus.DELETED)
        and (:kindPrefix is null or a.contentType like concat(:kindPrefix, '%'))
        and (:prefix is null or a.originalFilename like concat(:prefix, '%'))
      """)
  Page<AttachmentFile> search(
      @Param("deleted") boolean deleted,
      @Param("kindPrefix") String kindPrefix,   // "audio/" | "image/" | "video/" | null
      @Param("prefix") String prefix,           // originalFilename 접두 | null
      Pageable pageable);
  ```
  정렬은 `Pageable` 의 `Sort.by(desc("id"))` 로 주입(JPQL 에 order by 미기재). 기존 `findByStatusNotOrderByIdDesc`/`findByStatusOrderByIdDesc` 는 다른 호출부(purge 등)가 쓰므로 **유지**(제거하지 않음).
- `AttachmentPort (api)` — Spring `Page` 를 경계 밖으로 누출하지 않도록 도메인 페이지 record 도입:
  - `record AttachmentPageDto(List<AttachmentFileDto> items, long total)` (core-attachment-api/dto)
  - `AttachmentPageDto listActive(String slug, String kind, String prefix, int page, int size)`
  - `AttachmentPageDto listDeleted(String slug, String prefix, int page, int size)`
  - (`kind` 은 `"audio"|"image"|"video"|null`, impl 이 `kind + "/"` prefix 로 변환)
- `AttachmentServiceImpl` — 위 포트 구현. `PageRequest.of(page, size, Sort.by(desc("id")))`.

**`core-admin`**
- `AdminFileService.listFiles(String slug, String prefix, String kind, boolean deleted, int page, int size)` → `AdminFileListResponse`. 포트 페이징 호출 → `AttachmentFileDto` → `AdminFileResponse` 매핑(기존 `toResponse` 재사용), 총건수로 totalPages 산출.
- `AdminFileListResponse` DTO 변경:
  ```java
  record AdminFileListResponse(
      List<AdminFileResponse> files, int page, int size, long total, int totalPages) {}
  ```
  (`truncated` 제거)
- `AdminFilesController.files(...)` — 파라미터 추가:
  ```java
  @RequestParam(value="prefix", required=false) String prefix,
  @RequestParam(value="kind",   required=false) String kind,     // audio|image|video
  @RequestParam(value="status", required=false) String status,   // deleted
  @RequestParam(value="page", defaultValue="0")  int page,
  @RequestParam(value="size", defaultValue="20") int size
  ```
  size clamp [1,100], page clamp [0,∞). `max` 파라미터는 제거(계약 교체) — 구 클라이언트 없음(내부 콘솔).

### B. 프론트엔드 (template-react-admin)

- `types.ts AdminFileList`: `{ files, page, size, total, totalPages }` (`truncated` 제거).
- `api/client.ts getAppFiles(slug, { prefix, kind, deleted, page, size })`.
- `FilesPage.tsx`:
  - **kind 매핑**: `image→'image'`, `video→'video'`, `audio→'audio'`, `all→undefined`, `deleted→{status:'deleted', kind:undefined}`.
  - **리스트 탭(오디오·전체·삭제대상)**: `useQuery(['files', slug, prefix, kind, deleted, page, size])`, `page` state(0-based). 탭/prefix/slug 변경 시 `page=0` 리셋.
    - 전체·삭제대상 → `AdminDataGrid`(total/page/size/onPageChange/onSizeChange).
    - 오디오 → `AudioList` + 하단 `<Pagination current={page+1} pageSize={size} total={total} showSizeChanger={false}/>` + "총 N건".
  - **이미지·영상**: `useInfiniteQuery(['files-inf', slug, prefix, kind])`, `getNextPageParam = (last) => last.page+1 < last.totalPages ? last.page+1 : undefined`. `MediaGrid` 가 누적 `files` 렌더 + 하단 sentinel(IntersectionObserver) → `fetchNextPage()`.
- `AudioList`/`MediaGrid` props 는 유지(부모가 페이징/누적 처리, 컴포넌트는 받은 배열만 렌더). `truncated` prop 제거 → 빈 상태 문구는 총건수 0 기준.

### C. 목 (MSW)

- `fixtures.ts findFiles(slug, { prefix, kind, deleted, page, size })`: pool → status 필터(deleted/active) → kind 필터(`contentType.startsWith(kind+'/')`) → prefix 필터(`originalFilename`/key) → **총건수 계산** → `slice(page*size, page*size+size)` → `{ files, page, size, total, totalPages }`.
- `handlers.ts`: `page`/`size`/`kind` 파싱(`intParam`), 응답 계약 교체.
- **fixtures 파일 수 증량**: 앱당 오디오 ~25건, 이미지/영상 각 ~40건 등 여러 페이지 시연 가능하게 시드. 마스킹은 기존 유지.

## 데이터 흐름

```
탭 클릭(오디오) → kind='audio', page=0
  ├─ 리스트 탭: GET /files?kind=audio&page=0&size=20&status=  → {files, page, size, total, totalPages}
  │    → AudioList(files) + Pagination(total) ; 페이지 클릭 → page=n → refetch
  └─ 이미지/영상: useInfiniteQuery → page 0,1,2… append → MediaGrid(누적 files) ; sentinel 보이면 fetchNext
```

## 엣지 / 에러

- **page 범위 초과**(데이터 삭제로 마지막 페이지가 비는 경우): 서버는 빈 `files` + 올바른 total 반환 → 프론트가 마지막 유효 페이지로 clamp(안티 빈화면).
- **kind 미지원 값**: 컨트롤러가 `audio|image|video` 외는 무시(kind 없음 처리).
- **탭 전환 중 stale**: `keepPreviousData` 유지(깜빡임 방지). page 리셋과 kind 변경이 같은 렌더에 일어나므로 queryKey 에 둘 다 포함.
- **검역/복원/삭제 후**: `invalidateQueries(['files', slug])` 로 현재 페이지 refetch(기존 패턴 유지). 인피니티(이미지/영상)는 `['files-inf', slug]` 무효화.

## 테스트

- **백엔드**(Testcontainers, per-schema):
  - `AttachmentFileRepository` 페이징 쿼리 — kind/prefix/status 필터 + 총건수 + 정렬 id desc + 페이지 경계.
  - `AdminFileService.listFiles` — totalPages 산출, kind→contentType prefix 변환, 매핑.
  - `AdminFilesController` — page/size clamp, kind/status 파라미터 전달(단위 테스트, 기존 `AdminFilesControllerTest` 갱신).
  - ArchUnit r1~r22 그대로 통과(신규 Mapper/Converter 없음, 계층 유지).
- **프론트**: `npm run build` + `lint`. 목으로 브라우저 검증 — 오디오/전체/삭제대상 번호 페이징(페이지 이동·총건수·마지막 페이지), 이미지/영상 인피니티(스크롤 append·중복 없음), 탭/prefix 변경 시 page 리셋, 검역 후 현재 페이지 유지. → admin-console-v2 전파.

## 검증 제약 (중요)

template-spring 은 **META repo(app module 0개 → 부팅 불가, ADR-037 fail-secure)**. 백엔드는 **core-attachment/core-admin 모듈 테스트(`./gradlew :core:core-attachment-impl:test :core:core-admin-impl:test`)** + ArchUnit(`:bootstrap:test`) 로만 검증 가능. 실제 end-to-end 는 **프론트 목(MSW)** + 파생 앱 repo. Flyway: attachment_file 은 core 모듈 마이그레이션(신규 컬럼 없음 — content_type 이미 존재).

## 범위 밖 (YAGNI)

- size changer(페이지 크기 사용자 변경) — 고정 20. 필요 시 후속.
- "기타(문서)" 전용 탭 — 전체 탭에 포함.
- 커서(continuation-token) 페이징 — DB 기반이라 offset 으로 충분(대량 스토리지 리스팅이 아님).
- 정렬 옵션 서버화 — 정렬은 현재 id desc(최신순) 고정. 프론트 정렬 토글은 현 페이지 내 한정(기존 동작 유지) 또는 후속.

## 커밋 계획 (논리단위, push 배치)

1. `feat(attachment)`: Repository 페이징 쿼리 + Port `AttachmentPageDto` + ServiceImpl + 테스트
2. `feat(admin)`: AdminFileService/DTO/Controller page/size/kind + 테스트
3. `feat(admin)`: 프론트 api/types + 목 handlers/fixtures(증량) 계약 교체
4. `feat(admin)`: FilesPage 리스트 탭 번호 페이지네이션(전체·삭제대상 AdminDataGrid, 오디오 페이저)
5. `feat(admin)`: 이미지·영상 인피니티 스크롤(useInfiniteQuery + MediaGrid sentinel)
