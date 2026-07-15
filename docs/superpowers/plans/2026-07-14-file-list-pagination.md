# 파일 목록 페이지네이션 구현 플랜

> **For agentic workers:** 스펙 `docs/superpowers/specs/2026-07-14-file-list-pagination-design.md` 를 반드시 대조. 각 Task 끝에 독립 테스트 + 커밋. push 는 배치(누적 후 한 번).

**Goal:** 파일 목록을 서버 페이징화 — 리스트 탭(오디오·전체·삭제대상)=번호 페이지네이션, 이미지·영상=인피니티 스크롤.

**Architecture:** `attachment_file` DB(Spring Data JPA) 를 `@Query` + `Pageable` 로 페이징(kind/prefix/status 서버 필터). `AttachmentPort` 는 도메인 `AttachmentPageDto(items,total)` 반환. 프론트는 리스트=`useQuery`+번호 페이저, 이미지/영상=`useInfiniteQuery`+sentinel.

**Tech Stack:** Spring Boot(멀티모듈, schema-per-app), Spring Data JPA, Testcontainers, React 19 + Vite + antd + TanStack Query + ag-grid + MSW.

## Global Constraints

- Mapper/Converter 클래스 신설 금지 — Entity `toDto()` 등 기존 변환 사용(ArchUnit r22).
- Controller→Repository 직접 호출 금지(Service 경유). cross-domain 은 Port 로만.
- `com.factory.*` 패키지 불변. `ErrorInfo` enum 번호 재배치 금지(추가만).
- `AttachmentPort`(api)에 Spring `Page` 누출 금지 — 도메인 record 사용.
- 커밋 Conventional Commits, **Co-Authored-By 금지**(husky 차단). 한 커밋=한 논리변경.
- 프론트 cssVar 미설정 → `theme.useToken()`(CSS 변수 금지).

---

## Task 1: 백엔드 — attachment 페이징 포트/리포지토리

**Files:**
- Modify: `core/core-attachment-impl/.../repository/AttachmentFileRepository.java` (search `@Query` 추가)
- Create: `core/core-attachment-api/.../dto/AttachmentPageDto.java`
- Modify: `core/core-attachment-api/.../AttachmentPort.java` (listActive/listDeleted 페이징 오버로드)
- Modify: `core/core-attachment-impl/.../AttachmentServiceImpl.java` (구현)
- Test: `core/core-attachment-impl/src/test/.../AttachmentServiceImplTest.java`(또는 신규 페이징 테스트)

**Interfaces (Produces):**
- `record AttachmentPageDto(List<AttachmentFileDto> items, long total)`
- `AttachmentPageDto AttachmentPort.listActive(String slug, String kind, String prefix, int page, int size)`
- `AttachmentPageDto AttachmentPort.listDeleted(String slug, String prefix, int page, int size)`
- Repo: `Page<AttachmentFile> search(boolean deleted, String kindPrefix, String prefix, Pageable pageable)`

- [ ] **Step 1: 실패 테스트** — 시드 N건(오디오/이미지/문서 혼재, 일부 QUARANTINED/DELETED). `listActive(slug,"audio",null,0,2)` → items ≤2, total=오디오 활성 총수, id desc. prefix/삭제 케이스 포함.
- [ ] **Step 2: 실패 확인** — `./gradlew :core:core-attachment-impl:test --tests '*Attachment*Paging*'` → 메서드 없음.
- [ ] **Step 3: 구현** — `AttachmentPageDto` 생성, Repo `search` `@Query`(스펙 코드 그대로), `AttachmentServiceImpl.listActive/listDeleted`(kind→`kind+"/"`, `PageRequest.of(page,size,Sort.by(desc("id")))`, `page.map(AttachmentFile::toDto)` + `page.getTotalElements()`). 기존 `listActive(slug)`/`listDeleted(slug)` 는 유지(다른 호출부).
- [ ] **Step 4: 통과 확인** — 위 테스트 PASS.
- [ ] **Step 5: 커밋** — `feat(attachment): 파일 목록 페이징 조회(kind/prefix 필터) Port·Repository 추가`

## Task 2: 백엔드 — admin service/DTO/controller 페이징

**Files:**
- Modify: `core/core-admin-impl/.../dto/AdminFileListResponse.java` (계약 교체)
- Modify: `core/core-admin-impl/.../AdminFileService.java` (`listFiles` 시그니처 + 페이징 위임)
- Modify: `core/core-admin-impl/.../controller/AdminFilesController.java` (page/size/kind 파라미터)
- Test: `core/core-admin-impl/src/test/.../AdminFileServiceTest.java`, `.../controller/AdminFilesControllerTest.java`

**Interfaces:**
- Consumes: Task 1 의 `AttachmentPort.listActive/listDeleted(...)`, `AttachmentPageDto`.
- Produces: `record AdminFileListResponse(List<AdminFileResponse> files, int page, int size, long total, int totalPages)`;
  `AdminFileListResponse AdminFileService.listFiles(String slug, String prefix, String kind, boolean deleted, int page, int size)`

- [ ] **Step 1: 실패 테스트** — `AdminFileServiceTest`: 포트 페이징 mock → `listFiles(slug,null,"audio",false,0,20)` 가 total/totalPages(`ceil(total/size)`) 산출·매핑. `AdminFilesControllerTest`: page/size clamp([0,∞)/[1,100]), kind/status 전달, `max` 제거.
- [ ] **Step 2: 실패 확인** — `./gradlew :core:core-admin-impl:test`.
- [ ] **Step 3: 구현** — DTO 교체, `listFiles` 가 `deleted?listDeleted:listActive` 페이징 호출 후 `toResponse` 매핑 + `totalPages=(int)Math.ceil((double)total/size)`. 컨트롤러 파라미터/clamp.
- [ ] **Step 4: 통과 확인** — `./gradlew :core:core-admin-impl:test`.
- [ ] **Step 5: ArchUnit** — `./gradlew :bootstrap:test` (r1~r22, 신규 Mapper 없음 확인).
- [ ] **Step 6: 커밋** — `feat(admin): 파일 목록 컨트롤러/서비스 page·size·kind 페이징 계약`

## Task 3: 프론트 — API/타입 + 목 계약 교체·시드 증량

**Files:**
- Modify: `src/lib/types.ts` (`AdminFileList` 계약)
- Modify: `src/api/client.ts` (`getAppFiles` 파라미터)
- Modify: `src/mocks/handlers.ts` (page/size/kind 파싱)
- Modify: `src/mocks/fixtures.ts` (`findFiles` 페이징 + 파일 시드 증량)

**Interfaces (Produces):**
- `type AdminFileList = { files: AdminFile[]; page: number; size: number; total: number; totalPages: number }`
- `getAppFiles(slug, { prefix?, kind?, deleted?, page?, size? }): Promise<AdminFileList>`
- `findFiles(slug, { prefix?, kind?, deleted?, page?, size? }): AdminFileList`

- [ ] **Step 1: 구현** — types 계약(`truncated` 제거). client `qs` 에 kind/page/size. `findFiles`: status→kind(`contentType.startsWith(kind+'/')`)→prefix 필터 → total → `slice(page*size,(page+1)*size)` → `{files,page,size,total,totalPages}`. handlers 파싱. fixtures: 앱당 오디오~25/이미지~40/영상~40/문서 다수 시드(모두 `durationSec` 등 기존 enrich 유지).
- [ ] **Step 2: 빌드** — `npx tsc -b && npm run build` (FilesPage 는 Task4에서 고치므로 일시적 타입 에러 가능 → Task3+4 를 함께 빌드 통과시킴).
- [ ] **Step 3: 커밋** — `feat(admin): 파일 목록 API/목 페이징 계약 교체 + 목 시드 증량`

## Task 4: 프론트 — 리스트 탭 번호 페이지네이션

**Files:**
- Modify: `src/pages/FilesPage.tsx` (리스트 탭 페이징: 전체·삭제대상 `AdminDataGrid`, 오디오 `AudioList`+`<Pagination>`)
- Modify: `src/components/AudioList.tsx` (`truncated` prop 제거, 부모가 페이징)

**Interfaces:**
- Consumes: Task 3 `getAppFiles`, `AdminDataGrid`(total/page/size/onPageChange/onSizeChange), antd `Pagination`.

- [ ] **Step 1: 구현** — `page` state(0-based), `useQuery(['files',slug,prefix,kind,deleted,page,size], keepPreviousData)`. kind 매핑. 탭/prefix/slug 변경 `useEffect`→`setPage(0)`. 전체·삭제대상 렌더를 `AdminMiniGrid`→`AdminDataGrid`. 오디오 탭 하단 `<Pagination current={page+1} pageSize={size} total={total} showSizeChanger={false} onChange={p=>setPage(p-1)}/>` + "총 {total}건". `AudioList` 에서 `truncated` 제거.
- [ ] **Step 2: 빌드/린트** — `npx tsc -b && npm run build && npm run lint`.
- [ ] **Step 3: 브라우저 검증** — 오디오/전체/삭제대상: 페이지 이동, 총건수, 마지막 페이지 clamp, 검역 후 현재 페이지 유지, 탭/prefix 변경 시 1페이지.
- [ ] **Step 4: 커밋** — `feat(admin): 파일 리스트 탭 번호 페이지네이션(전체·삭제대상 AdminDataGrid, 오디오 페이저)`

## Task 5: 프론트 — 이미지·영상 인피니티 스크롤

**Files:**
- Modify: `src/pages/FilesPage.tsx` (이미지·영상 분기 `useInfiniteQuery`)
- Modify: `src/components/MediaGrid.tsx` (하단 sentinel → `onLoadMore`/`hasMore`)

**Interfaces:**
- Consumes: `useInfiniteQuery`, `getAppFiles`. MediaGrid props 에 `onLoadMore?`/`hasMore?`/`loadingMore?` 추가(선택).

- [ ] **Step 1: 구현** — 이미지/영상 탭은 `useInfiniteQuery(['files-inf',slug,prefix,kind], ({pageParam=0})=>getAppFiles(...,{page:pageParam,size}), getNextPageParam:(last)=> last.page+1<last.totalPages? last.page+1: undefined)`. 누적 `data.pages.flatMap(p=>p.files)` → `MediaGrid`. MediaGrid 하단 sentinel `IntersectionObserver` → `hasMore && fetchNextPage()`. 검역/삭제 후 `['files-inf',slug]` 무효화.
- [ ] **Step 2: 빌드/린트** — `npx tsc -b && npm run build && npm run lint`.
- [ ] **Step 3: 브라우저 검증** — 이미지/영상: 스크롤 시 다음 페이지 append(중복 없음), 마지막에서 정지, 탭 전환 시 초기화.
- [ ] **Step 4: 전파 + 커밋** — `rsync -a --delete src/ ../admin-console-v2/src/`; `feat(admin): 이미지·영상 인피니티 스크롤(useInfiniteQuery)`

## Self-Review 체크

- 스펙 커버리지: kind 서버필터(T1/T2/T3), prefix DB-side(T1), 번호페이저(T4), 인피니티(T5), 계약교체(T2/T3), 시드증량(T3) — 전부 태스크 존재.
- 타입 일관성: `AdminFileListResponse`(백)=`AdminFileList`(프) 필드 동일(files/page/size/total/totalPages). `AttachmentPageDto(items,total)` T1→T2 일치.
- 검증 제약: template-spring 부팅 불가 → 백엔드는 모듈 테스트만(T1/T2), e2e 는 목(T4/T5).
