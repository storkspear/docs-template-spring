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


### 보안 / 자격증명

- [ ] [Security] TLS/HTTPS 내부 구간 검토 — CF 가 edge 처리 OK, 맥미니 ↔ NAS 내부 통신은? (2026-04-18)
- [x] [Security] 로그인 실패 계정 잠금 — **구현 완료 (2026-07-21)**: `docs/superpowers/plans/2026-07-21-account-lockout.md` (5회/15분·backoff 자동·ATH_014/429·V027·flutter 계약 동기). EmailAuthService.signIn(1단계) + TwoFactorService.loginWith2fa(2단계) 동일 카운터, 실패 기록 REQUIRES_NEW, 비밀번호 재설정 성공 시 즉시 해제. RateLimitFilter 에 TOTP_LOGIN strict 편입 동반. (owasp A07.1) (생성일: 2026-05-06)
- [ ] [Security] 배포 경로 이미지 서명 검증 — **저우선 보류**: 로컬 빌드는 Actions 과금 회피를 위한 의도된 결정(2026-07-21 확인)이라 CI 빌드 의존 전환은 부적합. 실효 위협은 서버의 re-pull/rollback 경로(레지스트리에서 기존 이미지를 다시 받을 때 변조 가능성)뿐 — 대안: 로컬 키(cosign key pair) 서명 + pull 시 검증, 또는 self-hosted runner. 재평가 트리거: GHCR 토큰 사고·다중 운영자·Actions 과금 정책 변화. 태그 기반 GHCR cleanup 액션 교체는 별도 소형 후보 (재정의: 2026-07-21)
- [ ] [Security] 이메일 verify 표적 DoS 완화 (쿨다운) — email 스코프 계약(집단 DoS 제거 + 6자리 브루트포스 방어)은 이미 적용됨. **잔여: 표적 DoS** (공격자가 피해자 email 로 5회 오답 → 피해자 활성 토큰이 `markUsed` 로 영구 소진, 재발송으로만 복구). 계정 잠금 사이클(2026-07-21)에서 완화(5회 도달 시 즉시 폐기 대신 쿨다운) 검토했으나 **이번엔 보류** — `auth_email_verification_tokens` 에 별도 신규 마이그레이션 + 6 fixture 동기 + 쿨다운 리셋 동시성 처리가 필요해 계정 잠금 변경(이미 대규모)과 분리하는 게 리뷰 가능성상 낫다고 판단. 근거·트레이드오프는 `EmailVerificationService.verify` javadoc("보안 경계")에 잔존 명시. 후속 소형 사이클 후보. (재정의: 2026-07-21)
- [ ] [Security] 2FA flutter 표면 전체 사이클 — **승인됨 (2026-07-21)**: ①로그인 2단계 수리 (twoFactorToken 감지→TOTP 입력 — 현재 2FA 유저는 앱 로그인 불가, 감사 후보 확정) ②설정>보안: 활성화(QR+백업코드 8개)·해제 ③백업코드 셀프 재발급 API+화면 (비번+TOTP 재확인, 최악 케이스는 이메일 OTP 로 해제→재등록) ④config 플래그로 노출 통제 (2FA 불요 앱은 흔적 제거). spring+flutter, 계정잠금과 auth 묶음. ADR-030 보강 (owasp A07.4) (재정의: 2026-07-21)
- [ ] [Security] 무로깅 보안 이벤트에 WARN 심기 — security-logging.md 실측 결과 로그인 실패·권한 거부·Apple/PortOne webhook 서명 실패·비밀번호 변경이 무로깅, 콘솔 계정 변경은 audit_logs 미기록(@Audited 미부착). 문서의 인벤토리 표를 스펙 삼아 소형 사이클로 (생성일: 2026-07-21)

### 데이터 / DB

- [ ] [Data] 백업 실행 (pg_dump 주기, NAS 보관, retention) — `backup-to-nas.sh.example` 은 placeholder (2026-04-18)
- [ ] [Data] 복구 drill — "edge-cases 3-1: 1~2 시간 내 복구" 주장 실측 (2026-04-18)
- [ ] [Data] GDPR export·delete — **승인·plan 확정 (2026-07-21)**: `docs/superpowers/plans/2026-07-21-gdpr-export-delete.md` (운영자 절차형 P1 — admin export 버튼+본인확인 2단계 runbook+30일 유예 익명화 배치, 셀프서비스 UI 폐기 결정). **spring 백엔드 구현 완료 (2026-07-21)**: export/delete API + `PERM_USERS_WRITE` + `UserErasureScheduler`/`AdminUserErasureService` + `docs/production/gdpr-request-runbook.md`. **잔여: react-admin 버튼(export/삭제) — 후속 에이전트** (2026-04-18)
- [ ] [Data] Supabase Free → Pro 전환 절차 문단 — 기준(MAU 1K)은 decisions-infra.md 에 기존재, 절차만 부재. **트리거: MAU 1K 접근 시** (2026-07-21 보류 결정) (2026-04-18)

### 관측성 / 운영

- [ ] [Obs] Performance baseline (JMeter / Gatling) — 릴리스 전 기준 RPS / p95 (2026-04-18)
- [ ] [Obs] Performance playbook 작성 — `docs/production/operations/performance-playbook.md` 신규. DB 인덱스 정책, Caffeine 캐시 hit-rate, connection pool 튜닝, N+1 추적 절차. 추측 기반 회피 위해 트리거: 첫 prod 앱 슬로우쿼리 1건 발생 또는 DAU 1000 도달 (생성일: 2026-05-06)
- [ ] [Obs] Mac mini 디스크 사용 알림 부재 — Loki retention 1년 채택 (I-06, 2026-07-21) 으로 재검토 트리거가 "디스크 사용 증가 관측 시" 인데 정작 Mac mini 자체 디스크 사용률 알림이 없음 (rules.yml 의 디스크 알림은 NAS 대상). 트리거 관측 수단 확보 필요 (생성일: 2026-07-21)

### 앱 기능 (Phase 1+)

- [ ] [Feature] IAP 실기기 E2E 검증 (Apple sandbox / Google 내부 테스트 트랙) — 서버 측은 stub 이 아니라 완전 구현 상태 (AppleAppStoreAdapter · GooglePlayAdapter · RTDN/ASSN webhook, ADR-019~022). 남은 것은 실 스토어 계정 + 실기기 구매 flow 1회 검증 (2026-04-18, 재정의: 2026-07-15 — 원래 "Billing 실제 구현, 현재 Stub" 이었으나 구현 완료로 범위 재정의)
- [ ] [Feature] i18n 구현 — **트리거: 첫 글로벌 타깃 앱 파생 시** (한국 시장만인 동안 실익 0 — 2026-07-21 결정). 전략은 plan 확정: 에러코드 기반 클라 번역+서버 message fallback 하이브리드 (`docs/superpowers/plans/2026-07-21-i18n-strategy.md`). 발견 결함(영어 폰에 서버 한국어 노출)도 같은 트리거에 묶음 (재정의: 2026-07-21)
- [ ] [Feature] N일 경과 미연관 POST 첨부 스윕 — 콘솔 게시물 작성 중 업로드만 하고 글 저장을 안 한 미연관(associated_id IS NULL, associated_type='POST') 첨부가 orphan 으로 남음. `AttachmentPurgeScheduler` 에 스윕 추가 — **앱 파일 API 사이클에 편입 (2026-07-21 결정)**: plan `2026-07-21-app-file-api.md` 구현 시 함께 (생성일: 2026-07-16)
- [ ] [Feature] 앱 클라이언트용 파일 업로드·조회 API — **승인·plan 확정 (2026-07-21)**: `docs/superpowers/plans/2026-07-21-app-file-api.md` (storageKey 단일 계약·마이그레이션 0건·flutter file_kit 신설·미연관 첨부 스윕 편입). spring+flutter 3면 동기, 구현 대기열 3순위 (생성일: 2026-07-21)

### 개발자 경험 / 툴링 (DX)

- [ ] [DX] Inventory 기계 추출 파일 `docs/.inventory.yml` — Item 9 plan 의 embed 인벤토리 drift 방지 (2026-04-18)
- [ ] [DX] Multi-app 로컬 병렬 개발 가이드 — **트리거: 두 번째 앱 병렬 개발 시작 시** (2026-07-21 보류 결정). 포트 충돌·run config 공유 (2026-04-18)
- [ ] [DX] `<repo> prod db-backup [slug]` / `storage-backup` 명령 + force-clear 백업 선행 강제 — 백업 자동화(위치·tar.gz·retention)와 `prod force-clear` 의 최근 백업 존재 확인 선행(없으면 차단)을 한 사이클로 설계. **실행 시점: bluepig prod 가동 시** (재정의: 2026-07-21)
- [ ] [ADR-037 후속] runtime DataSource 의 transaction-mode 전환 설계 — Flyway/session 분리 자체는 구현 완료(`AbstractAppDataSourceConfig.buildFlyway` 별도 session DataSource + `deriveFlywayUrl` 6543→5432). 남은 본체: transaction pooler 는 `currentSchema` 기반 라우팅과 비호환(2026-07 실측 — startup 파라미터 미적용으로 전 앱 misroute) → per-transaction `SET LOCAL search_path` 주입 또는 per-slug role/DB 로 라우팅 재설계 필요 (생성일: 2026-05-26, 재정의: 2026-07-21)
- [ ] [DX] PIT mutation threshold 확정 — weekly report-only 워크플로는 2026-07-21 도입 완료(pitest.yml). 첫 주간 측정 결과로 모듈별 baseline 확인 후 threshold 활성화 (재정의: 2026-07-21)
- [ ] [DX] Jacoco 6차 점진 상향 (default 80/70) — 약점 모듈 (common-logging 67/100, core-storage-impl 67/46, core-user-impl 68/50) 본격 보강 후. common-logging 의 ConsoleAppender / LogstashEncoder 통합 테스트, storage 의 MinIO mock 통합, user 의 UserController + Repository 통합. 트리거: prod 가동 + 운영 데이터 1~2개월 후 (생성일: 2026-05-06)
- [ ] [DX] Multi-session spec 진행 상태 헤더 (S1~SN 체크박스) — multi-session spec 의 복귀 비용 차단. 8-subsession spec (예: 종료 archive `docs/planned/archive/cleanup-legacy-cycle.md` 의 S1~S8 추적) 이 중단된 후 "어디까지 했지?" 추적 어려움. 헤더에 체크박스 도입 후 각 subsession 완료 시 체크. 트리거: 다음 multi-session spec 작성 시 적용 (생성일: 2026-05-06)

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
