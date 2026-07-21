# Backlog

> **유형**: Reference · **독자**: Level 2~3 · **읽는 시간**: ~5분

프로젝트 진행 중 "지금은 안 하지만 잊지 말 것" 목록. Item 단위 작업이 없어도 주기적으로 점검.

## 사용 규칙

1. **항목 추가 시** — 카테고리별 "대기" 섹션에 추가:
   ```
   - [ ] [카테고리] 제목 — 이유 (생성일: YYYY-MM-DD)
   ```

2. **카테고리 표기**: `Ops` / `Data` / `Obs` / `Security` / `Feature` / `DX` / `Template`

3. **작업 시작 시** — "대기" → "진행 중" 으로 이동 + `(담당 Item: Item X)` 추가:
   ```
   - [x] [Ops] Cloudflare Tunnel 셋업 — 외부 접근 (생성일: 2026-04-18, 담당 Item: Item Ops-1)
   ```

4. **완료 시** — "완료 (archive)" 로 이동 + 커밋 해시 연결:
   ```
   - [x] [Ops] ... — 이유 (완료일: YYYY-MM-DD, commit: abcdef0)
   ```

5. **2개월마다 archive → CHANGELOG 이관**, 이 파일은 가볍게 유지.

6. **새 Item plan 작성 시**: backlog 에서 관련 항목을 plan scope 에 포함 선언. plan 완료 시 해당 backlog 항목 일괄 archive. 규칙 상세: [`Git 워크플로우 (Git Workflow)`](../convention/git-workflow.md).

---

## 진행 중 (0)


---

## 대기

### 운영 배포 / 파이프라인 (Item Ops-1 — 파생레포/호스트 작업)

- [ ] [Ops] Secrets management 체계 선택 (1Password CLI / sops / Vault / AWS Parameter Store) — `.env` 수기 관리 탈피 (2026-04-18)

### 보안 / 자격증명

- [ ] [Security] TLS/HTTPS 내부 구간 검토 — CF 가 edge 처리 OK, 맥미니 ↔ NAS 내부 통신은? (2026-04-18)
- [ ] [Security] 로그인 실패 계정 잠금 정책 — N회 실패 후 계정 lockout. 현재 rate limit (요청 횟수) 만 있고 brute-force 방어로 부족. ADR-029 line 187 에 등재된 항목 (owasp A07.1) (생성일: 2026-05-06)
- [ ] [Security] 보안 이벤트 명시 로그 정책 — 로그인 실패/권한 거부/TOTP 실패/webhook 서명 실패/암호 변경 같은 보안 이벤트의 로그 레벨 + 형식 명시 (`observability.md` 보강 또는 별도 security-logging.md). Grafana alert rule cycle 과 묶어 진행 가능 (owasp A09.1) (생성일: 2026-05-06)
- [ ] [Security] Docker image signing (cosign / Sigstore) CI 통합 — GHCR push 한 image 가 진짜 우리 CI 에서 온 건지 검증 부재. Kamal 배포 시 서명 검증 추가 (owasp A08.1) (생성일: 2026-05-06)
- [ ] [Security] Gradle dependency verification 활성화 — `org.gradle.dependency-verification` 으로 jar checksum lock. Maven central 에서 받은 의존성 무결성 검증 (owasp A06.3 + A08.2) (생성일: 2026-05-06)
- [ ] [Security] Log retention 정책 1년으로 연장 — 현재 `loki-config.yml` 의 14일은 PCI-DSS / 일반 compliance 권장 1년 미달. 비용/스토리지 trade-off 검토 후 결정 (owasp A09.5) (생성일: 2026-05-06)
- [ ] [Security] 이메일 OTP brute-force 방어 명시 — `EmailVerificationService` 의 attempt counter / exponential backoff 정책 코드 + 문서 검증. 6자리 OTP 는 1M 조합이라 TTL 5분만으론 부족 가능 (owasp A07.2) (생성일: 2026-05-06)
- [ ] [Security] 2FA backup codes 자동 복구 endpoint — 8개 다 소진 시 admin intervention 대신 recovery code 발급. ADR-030 보강 (owasp A07.4) (생성일: 2026-05-06)

### 데이터 / DB

- [ ] [Data] 백업 실행 (pg_dump 주기, NAS 보관, retention) — `backup-to-nas.sh.example` 은 placeholder (2026-04-18)
- [ ] [Data] 복구 drill — "edge-cases 3-1: 1~2 시간 내 복구" 주장 실측 (2026-04-18)
- [ ] [Data] GDPR / 개인정보 export/delete 요청 대응 절차 — 법적 대비 (2026-04-18)
- [ ] [Data] Supabase Free → Pro 전환 기준 + 절차 — MAU 1K 도달 대비 (2026-04-18)

### 관측성 / 운영

- [ ] [Obs] Performance baseline (JMeter / Gatling) — 릴리스 전 기준 RPS / p95 (2026-04-18)
- [ ] [Obs] On-call 알림 피로 방지 규칙 (솔로 운영 기준) — 중요도별 알림 채널 분리 (2026-04-18)
- [ ] [Obs] Performance playbook 작성 — `docs/production/operations/performance-playbook.md` 신규. DB 인덱스 정책, Caffeine 캐시 hit-rate, connection pool 튜닝, N+1 추적 절차. 추측 기반 회피 위해 트리거: 첫 prod 앱 슬로우쿼리 1건 발생 또는 DAU 1000 도달 (생성일: 2026-05-06)
- [ ] [Obs] DB connection pool metric panel — Hikari prometheus metric (`hikaricp_connections_active` / `_max` / `_pending` / `_timeout_total`) 을 시각화하는 panel. infra-level dashboard 별도 신설 또는 app-factory-overview 에 추가. 트리거: 첫 prod 앱 출시 후 connection pool 이슈 발생 또는 의도적 점검 (생성일: 2026-05-06)

### 앱 기능 (Phase 1+)

- [ ] [Feature] IAP 실기기 E2E 검증 (Apple sandbox / Google 내부 테스트 트랙) — 서버 측은 stub 이 아니라 완전 구현 상태 (AppleAppStoreAdapter · GooglePlayAdapter · RTDN/ASSN webhook, ADR-019~022). 남은 것은 실 스토어 계정 + 실기기 구매 flow 1회 검증 (2026-04-18, 재정의: 2026-07-15 — 원래 "Billing 실제 구현, 현재 Stub" 이었으나 구현 완료로 범위 재정의)
- [ ] [Feature] i18n / 다국어 지원 전략 — 모바일 클라이언트와 계약 (2026-04-18)
- [ ] [Feature] N일 경과 미연관 POST 첨부 스윕 — 콘솔 게시물 작성 중 업로드만 하고 글 저장을 안 한 미연관(associated_id IS NULL, associated_type='POST') 첨부가 orphan 으로 남음. `AttachmentPurgeScheduler` 에 스윕 추가 (생성일: 2026-07-16)
- [ ] [Feature] 앱 클라이언트용 파일 업로드·조회 API — 현재 attachment 표면은 관리자 콘솔 전용(`POST /api/admin/apps/{slug}/content/uploads` 티켓 → presigned PUT)이고, 앱측은 `PostCreateRequest` 에 첨부 필드가 없으며 flutter `api_endpoints.dart` 에도 upload/file 항목 0건. 유저 업로드가 필요한 파생 앱을 위해 앱 스코프 업로드 티켓·presigned GET 표면 + flutter 계약 추가 필요. AttachmentPort/StoragePort 는 재사용 (생성일: 2026-07-21)

### 개발자 경험 / 툴링 (DX)

- [ ] [DX] Inventory 기계 추출 파일 `docs/.inventory.yml` — Item 9 plan 의 embed 인벤토리 drift 방지 (2026-04-18)
- [ ] [DX] Multi-app 로컬 병렬 개발 가이드 (포트 충돌, IntelliJ run config 공유) — 여러 앱 동시 기동 (2026-04-18)
- [ ] [DX] `<repo> prod db-backup [slug]` / `<repo> prod storage-backup [slug]` 명령 — `prod force-clear` (이번 사이클 추가) 의 Step 3 백업 안내가 manual `pg_dump` / `mc cp` 로 출력. 자동화 시 일관된 백업 위치 + tar.gz 압축 + retention 정책 가능. force-clear 와 짝 (clear/init 의 symmetry 와 같이). 본 사이클은 force-clear 만 추가 — 백업 자동화는 별도 사이클 (2026-05-02)
- [ ] [DX] `<repo> prod force-clear <slug>` 의 관측성 데이터 처리 — 현재 슬러그 지정 시에도 `[3/5]` 단계가 *모든 관측성 데이터* (Grafana / Loki / Prometheus / Alertmanager) 삭제 confirm 을 묻는다. 관측성 스택은 모든 슬러그가 공유하므로 *특정 슬러그 정리 시* 보존이 자연스러움. slug 지정 케이스에선 `[3/5]` 자동 skip + 안내 또는 *해당 슬러그의 dashboard / log stream 만 분리 정리* 가 정확. 현재 운영자가 실수로 'y' 입력 시 *전체 모니터링 히스토리* 손실 가능. force-clear 와 함께 들어간 사이클에 후속 보강 권장 (2026-05-03)
- [ ] [DX] `factory install` 의 alias 이름 입력 단계에 *bash 빌트인·예약어 충돌 검증* — 운영자가 `test` 같은 빌트인 명령을 입력하면 `~/.local/bin/test` symlink 가 등록되어도 bash 가 빌트인을 우선해 `test init` 이 no-op 으로 동작 (조건 검사로 해석되어 0 exit). 차단 대상 후보: `test`, `[`, `[[`, `true`, `false`, `cd`, `pwd`, `echo`, `set`, `eval`, `source`, `.`, `:`, `command`, `type`, `which`, `time`, `exec`, `exit`, `kill`, `jobs`, `bg`, `fg`, `wait`, `read`, `local`, `export`, `unset`, `alias`, `unalias`, `history`, `let`, `printf`. 입력 후 `compgen -b <name>` 또는 hardcoded 목록으로 검증 → 매치 시 *재입력 요구*. 도그푸딩 사이클에서 `test` 입력으로 발견됨 (2026-05-03)
- [ ] [ADR-037 후속] runtime DataSource 의 transaction-mode 전환 설계 — Flyway/session 분리 자체는 구현 완료(`AbstractAppDataSourceConfig.buildFlyway` 별도 session DataSource + `deriveFlywayUrl` 6543→5432). 남은 본체: transaction pooler 는 `currentSchema` 기반 라우팅과 비호환(2026-07 실측 — startup 파라미터 미적용으로 전 앱 misroute) → per-transaction `SET LOCAL search_path` 주입 또는 per-slug role/DB 로 라우팅 재설계 필요 (생성일: 2026-05-26, 재정의: 2026-07-21)
- [ ] [DX] Mutation testing (PIT) threshold + CI 통합 — 시범 (core-audit-impl) mutation score 81% 확인. 모든 *-impl 모듈 audit 후 적정 threshold 결정 (예: 70%). pitest task 를 ci.yml 에 nightly 또는 weekly cron 으로 통합 (default build 무거우니 별도). 트리거: 첫 manual audit 사이클 완료 후 (생성일: 2026-05-06)
- [ ] [DX] Jacoco 6차 점진 상향 (default 80/70) — 약점 모듈 (common-logging 67/100, core-storage-impl 67/46, core-user-impl 68/50) 본격 보강 후. common-logging 의 ConsoleAppender / LogstashEncoder 통합 테스트, storage 의 MinIO mock 통합, user 의 UserController + Repository 통합. 트리거: prod 가동 + 운영 데이터 1~2개월 후 (생성일: 2026-05-06)
- [ ] [DX] Multi-session spec 진행 상태 헤더 (S1~SN 체크박스) — multi-session spec 의 복귀 비용 차단. 8-subsession spec (예: 종료 archive `docs/planned/archive/cleanup-legacy-cycle.md` 의 S1~S8 추적) 이 중단된 후 "어디까지 했지?" 추적 어려움. 헤더에 체크박스 도입 후 각 subsession 완료 시 체크. 트리거: 다음 multi-session spec 작성 시 적용 (생성일: 2026-05-06)
- [~] [DX] `BucketProvisioner` endpoint reach 실패 silent skip 진단성 강화 — **부분 fixed (2026-05-27)**: warn 메시지 *명확화 + 고정 head* 적용 (`BucketProvisioner: endpoint unreachable, bucket creation skipped: bucket=... endpoint=... cause=...`, `BucketProvisioner.java:58-67`) → grep 으로 찾기 쉬움. **남은 작업**: strict mode 옵션 (`app.storage.minio.strict-startup=true` 시 startup fail) 은 *별 cycle* 후보. (2026-05-18)

### 템플릿 진화

- [ ] [Template] Roll-forward 가이드 보강 (`cross-repo-cherry-pick.md` 에 인프라 변경 반영법) — 파생 레포가 template 업데이트 가져가는 법 (2026-04-18)
- [ ] [Template] Release cadence 규칙 (`template-v` 태그 찍는 주기) — 의도적 cadence 정의 (2026-04-18)
- [ ] [Template] 파생 레포 "inventory 자동 업데이트" 가이드 — 본인 파생 레포가 새 env/service 추가 시 문서 동기화 (2026-04-18)
- [ ] [Template] template-spring-lite-example sample 파생 레포 — ADR-034 의 lite 변형 (PAYMENT/IAP/2FA 비활성) 시나리오를 fresh fork 환경에서 1회 검증 + 결과 docs 화. 본 template repo 는 fork 받는 출발점이므로 sample repo 생성은 사용자 GitHub 영역 — 본 repo 안에는 docs 만 (사용자 작업 후 결과 backlog 갱신) (2026-05-02)

### 단순 가정 → 검증 미흡 (2026-05 사이클 — ADR-021~035)

> 본 사이클 진행 중 추측/가정으로 진행된 부분. 실 검증 별도 task 로 분리 (사용자 피드백 2026-05-02).

- [ ] [DX] `tools/api-smoke-test.sh` 실 실행 검증 — 도그푸딩 또는 fresh 파생 레포 환경에서 11 step PASS 확인 필요 (2026-05-02)
  - 본 사이클 (2026-05-02) 에서 시도 — 기존 junwoo-service container 가 8081 점유 + 옛 fork 라 ADR-031 controller 미존재 → 의미 있는 실행 불가
  - 자동화 가능 부분은 통합 테스트로 대체 완료: FeatureToggleTest (8 test), NotificationPreferenceControllerTest (6 test), BillingServiceImplContractTest, FactoryApplicationTests, HealthEndpointsTest
  - 11 step 전체 e2e 는 사용자 도그푸딩 환경 (별도 fresh repo + WireMock + .env.prod) 에서 1회 실행 후 결과 backlog 에 기록 — 본 작업이 backlog 의 잔여 검증
- [ ] [Ops] `tools/migrate-prod.sh` checksum 알고리즘 실 Flyway 비교 검증 — 본 사이클 (2026-05-02) audit 결과:
  - 현재 python3 zlib.crc32 (CRLF 제거 후) 사용
  - Flyway 의 `org.flywaydb.core.internal.resource.ResourceProvider` 정확 알고리즘 (라인별 trim + CRC32 누적) 과 1:1 매칭 보장 X
  - mismatch 시 부팅 시 `Migration checksum mismatch` → 운영자가 `schema_history.checksum` UPDATE 후 재 deploy
  - 본 task 처리 결과: `migrate-prod.sh` + `flyway-runbook.md` 의 mismatch 절차 상세 문서화 (2026-05-02)
  - 후속: Flyway library 직접 호출 Java helper — 본 사이클 (2026-05-02) audit 결과: Flyway 의 정확 checksum = internal API (`org.flywaydb.core.internal.resource.LoadableResource`) 사용 — 버전 의존 위험. 운영 절차 (flyway-runbook.md §4-3 의 schema_history.checksum UPDATE) 가 mismatch 시 안전망. nice-to-have 로 별도 사이클 — 운영 환경에서 첫 mismatch 사례 발생 후 priority 재평가

---

## 완료 (archive, 지난 2개월)

(비어 있음 — 2026-07-21 CHANGELOG 이관 완료)
---

## 관련 문서

- [`Git 워크플로우 (Git Workflow)`](../convention/git-workflow.md) — backlog 운영 규칙 상세
- [`CHANGELOG.md`](https://github.com/storkspear/template-spring/blob/main/CHANGELOG.md) — archive 된 완료 항목의 최종 기록처
