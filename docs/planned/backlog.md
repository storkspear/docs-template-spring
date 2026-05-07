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

## 진행 중 (1)

- [ ] **Item Ops-1** — 홈서버 MVP (feature 브랜치 `feature/ops-1-home-server-mvp`). Template 쪽 Stage A 완료 (아래 완료 섹션 참조). 파생레포 생성 + Mac mini 최초 배포 (Stage B~F) 는 파생레포 측에서 진행.

---

## 대기

### 운영 배포 / 파이프라인 (Item Ops-1 — 파생레포/호스트 작업)

- [ ] [Ops] 무지개 스택 cutover — 기존 moojigae vite/webhook/nginx/duckdns cron 종료, 기존 cloudflared tunnel 제거 (2026-04-19)
- [ ] [Ops] Secrets management 체계 선택 (1Password CLI / sops / Vault / AWS Parameter Store) — `.env` 수기 관리 탈피 (2026-04-18)
- [ ] [Ops] MinIO root credential → service account 로테이션 (`mc admin user svcacct add`) — root 남용 위험 제거 (2026-04-18)
- [ ] [Ops] MinIO ↔ Supabase 동일 비번 사용 분리 — 하나 유출 시 연쇄 위험 (2026-04-18)

### 보안 / 자격증명

- [ ] [Security] TLS/HTTPS 내부 구간 검토 — CF 가 edge 처리 OK, 맥미니 ↔ NAS 내부 통신은? (2026-04-18)
- [ ] [Security] 로그인 실패 계정 잠금 정책 — N회 실패 후 계정 lockout. 현재 rate limit (요청 횟수) 만 있고 brute-force 방어로 부족. ADR-029 line 187 에 등재된 항목 (owasp A07.1) (생성일: 2026-05-06)
- [ ] [Security] 보안 이벤트 명시 로그 정책 — 로그인 실패/권한 거부/TOTP 실패/webhook 서명 실패/암호 변경 같은 보안 이벤트의 로그 레벨 + 형식 명시 (`observability.md` 보강 또는 별도 security-logging.md). Grafana alert rule cycle 과 묶어 진행 가능 (owasp A09.1) (생성일: 2026-05-06)
- [ ] [Security] Docker image signing (cosign / Sigstore) CI 통합 — GHCR push 한 image 가 진짜 우리 CI 에서 온 건지 검증 부재. Kamal 배포 시 서명 검증 추가 (owasp A08.1) (생성일: 2026-05-06)
- [ ] [Security] Gradle dependency verification 활성화 — `org.gradle.dependency-verification` 으로 jar checksum lock. Maven central 에서 받은 의존성 무결성 검증 (owasp A06.3 + A08.2) (생성일: 2026-05-06)
- [ ] [Security] Audit log 조회 endpoint — `GET /api/admin/audit-logs?action=...&since=...` 운영자 UI. ADR-028 line 222 에 다음 사이클로 등재 (owasp A09.3) (생성일: 2026-05-06)
- [ ] [Security] Log retention 정책 1년으로 연장 — 현재 `loki-config.yml` 의 14일은 PCI-DSS / 일반 compliance 권장 1년 미달. 비용/스토리지 trade-off 검토 후 결정 (owasp A09.5) (생성일: 2026-05-06)
- [ ] [Security] 이메일 OTP brute-force 방어 명시 — `EmailVerificationService` 의 attempt counter / exponential backoff 정책 코드 + 문서 검증. 6자리 OTP 는 1M 조합이라 TTL 5분만으론 부족 가능 (owasp A07.2) (생성일: 2026-05-06)
- [ ] [Security] 2FA backup codes 자동 복구 endpoint — 8개 다 소진 시 admin intervention 대신 recovery code 발급. ADR-030 보강 (owasp A07.4) (생성일: 2026-05-06)

### 데이터 / DB

- [ ] [Data] 백업 실행 (pg_dump 주기, NAS 보관, retention) — `backup-to-nas.sh.example` 은 placeholder (2026-04-18)
- [ ] [Data] 복구 drill — "edge-cases 3-1: 1~2 시간 내 복구" 주장 실측 (2026-04-18)
- [ ] [Data] GDPR / 개인정보 export/delete 요청 대응 절차 — 법적 대비 (2026-04-18)
- [ ] [Data] Supabase pooler 모드 (transaction vs session) 튜닝 가이드 — 성능 이슈 예방 (2026-04-18)
- [ ] [Data] Supabase Free → Pro 전환 기준 + 절차 — MAU 1K 도달 대비 (2026-04-18)

### 관측성 / 운영

- [ ] [Obs] Performance baseline (JMeter / Gatling) — 릴리스 전 기준 RPS / p95 (2026-04-18)
- [ ] [Obs] On-call 알림 피로 방지 규칙 (솔로 운영 기준) — 중요도별 알림 채널 분리 (2026-04-18)
- [ ] [Obs] Performance playbook 작성 — `docs/production/operations/performance-playbook.md` 신규. DB 인덱스 정책, Caffeine 캐시 hit-rate, connection pool 튜닝, N+1 추적 절차. 추측 기반 회피 위해 트리거: 첫 prod 앱 슬로우쿼리 1건 발생 또는 DAU 1000 도달 (생성일: 2026-05-06)
- [ ] [Obs] DB connection pool metric panel — Hikari prometheus metric (`hikaricp_connections_active` / `_max` / `_pending` / `_timeout_total`) 을 시각화하는 panel. infra-level dashboard 별도 신설 또는 app-factory-overview 에 추가. 트리거: 첫 prod 앱 출시 후 connection pool 이슈 발생 또는 의도적 점검 (생성일: 2026-05-06)

### 앱 기능 (Phase 1+)

- [ ] [Feature] Billing 실제 구현 (Apple StoreKit + Google Play Billing) — 현재 Stub (2026-04-18)
- [ ] [Feature] 이미지 검열용 Admin 페이지 (유저 업로드 모더레이션) — Cyberduck/콘솔 대체 (2026-04-18)
- [ ] [Feature] i18n / 다국어 지원 전략 — 모바일 클라이언트와 계약 (2026-04-18)

### 개발자 경험 / 툴링 (DX)

- [ ] [DX] Inventory 기계 추출 파일 `docs/.inventory.yml` — Item 9 plan 의 embed 인벤토리 drift 방지 (2026-04-18)
- [ ] [DX] Multi-app 로컬 병렬 개발 가이드 (포트 충돌, IntelliJ run config 공유) — 여러 앱 동시 기동 (2026-04-18)
- [x] ~~WireMock opt-in 정책 문서 정정~~ — 본 사이클 (S12) 완료. `cli-guide.md` / `onboarding.md` 의 "wiremock 자동 기동" 표기를 "(옵션) wiremock" 으로 정정 (2026-05-03)
- [x] ~~`<repo> local stop` / `<repo> local restart` 명령 신규~~ — `factory:408,413` 에 구현 완료 (`local-stop)` / `local-restart)` case). `restart` 는 `docker compose ... up -d --build spring` 으로 강제 rebuild (2026-05-03)
- [ ] [DX] `<repo> prod db-backup [slug]` / `<repo> prod storage-backup [slug]` 명령 — `prod force-clear` (이번 사이클 추가) 의 Step 3 백업 안내가 manual `pg_dump` / `mc cp` 로 출력. 자동화 시 일관된 백업 위치 + tar.gz 압축 + retention 정책 가능. force-clear 와 짝 (clear/init 의 symmetry 와 같이). 본 사이클은 force-clear 만 추가 — 백업 자동화는 별도 사이클 (2026-05-02)
- [x] ~~multi-app prod env 자동 derive 패턴~~ — `common-persistence/AbstractAppDataSourceConfig.deriveSlugUrlOrEmpty` 에 구현 완료. `<SLUG>_DB_URL` 비우면 `${DB_URL}` 의 `currentSchema=<slug>` 자동 교체, USER/PASSWORD 는 core 그대로 재사용 (2026-05-03)
- [x] ~~`tools/deploy.sh` 시작 시 uncommitted 경고~~ — `tools/deploy.sh` Step 0 에 정보성 warning 으로 구현 완료. 운영 빌드는 origin/main SHA 기준이라 로컬 working tree 무관, warning 만 출력하고 차단 X (2026-05-03)
- [ ] [DX] `<repo> prod force-clear <slug>` 의 관측성 데이터 처리 — 현재 슬러그 지정 시에도 `[3/5]` 단계가 *모든 관측성 데이터* (Grafana / Loki / Prometheus / Alertmanager) 삭제 confirm 을 묻는다. 관측성 스택은 모든 슬러그가 공유하므로 *특정 슬러그 정리 시* 보존이 자연스러움. slug 지정 케이스에선 `[3/5]` 자동 skip + 안내 또는 *해당 슬러그의 dashboard / log stream 만 분리 정리* 가 정확. 현재 운영자가 실수로 'y' 입력 시 *전체 모니터링 히스토리* 손실 가능. force-clear 와 함께 들어간 사이클에 후속 보강 권장 (2026-05-03)
- [ ] [DX] `factory install` 의 alias 이름 입력 단계에 *bash 빌트인·예약어 충돌 검증* — 운영자가 `test` 같은 빌트인 명령을 입력하면 `~/.local/bin/test` symlink 가 등록되어도 bash 가 빌트인을 우선해 `test init` 이 no-op 으로 동작 (조건 검사로 해석되어 0 exit). 차단 대상 후보: `test`, `[`, `[[`, `true`, `false`, `cd`, `pwd`, `echo`, `set`, `eval`, `source`, `.`, `:`, `command`, `type`, `which`, `time`, `exec`, `exit`, `kill`, `jobs`, `bg`, `fg`, `wait`, `read`, `local`, `export`, `unset`, `alias`, `unalias`, `history`, `let`, `printf`. 입력 후 `compgen -b <name>` 또는 hardcoded 목록으로 검증 → 매치 시 *재입력 요구*. 도그푸딩 사이클에서 `test` 입력으로 발견됨 (2026-05-03)
- [ ] [DX] `init-server.sh` 의 partial-fail 인지성 강화 — 현재 Step 6 끝의 `[OK] GitHub Secrets / Variables 등록 완료` 가 *최종 성공* 처럼 보여 사용자가 그 뒤의 Step 9.5 (observability deploy) / Step 10 (verify-server) 가 안 돈 partial fail 을 놓치는 케이스 발생. 보강 방향: ①중간 step 메시지를 `[OK] Step 6 완료` 처럼 단계 표시로 약화. ②`trap EXIT` 추가해 비정상 종료 시 `❌ init 비정상 종료 (exit=$rc) — re-run 권장` 명시. ③최종 success 마커를 박스 형태로 강조 (없으면 곧 실패). 도그푸딩 사이클에서 line 559 bash 에러로 init 이 partial 종료됐는데 deploy 는 decoupled 라 정상 동작 → 사용자가 init 결함을 늦게 발견 (2026-05-03)
- [ ] [DX] `tools/ci-test.sh` 에 `actionlint` 통합 — 현재 ci-test 는 *content* (build / docs / secrets) 만 검증하고 `.github/workflows/*.yml` 자체의 정적 검증은 누락돼요. 결과적으로 워크플로우의 YAML 구문 오류 / 잘못된 action 버전 / job dependency 누락 같은 컨피그 실수가 push 전에 catch 되지 않아요. `actionlint` 단계 추가 (5-stage → 6-stage 또는 spotless 단계와 병합). 한계: secret 부재 같은 *runtime* 에러는 actionlint 도 catch 하지 못해요 — 그건 별개 보강 (예: 워크플로우 시작 시 token 존재 검증 + graceful skip). 도그푸딩 사이클에서 `template-spring` 의 `GHCR_TOKEN` 미등록으로 sync-docs 가 2일치 모든 push 에서 실패한 케이스로 발견 (2026-05-03)
- [ ] [DX] Mutation testing (PIT) threshold + CI 통합 — 시범 (core-audit-impl) mutation score 81% 확인. 모든 *-impl 모듈 audit 후 적정 threshold 결정 (예: 70%). pitest task 를 ci.yml 에 nightly 또는 weekly cron 으로 통합 (default build 무거우니 별도). 트리거: 첫 manual audit 사이클 완료 후 (생성일: 2026-05-06)
- [ ] [DX] Jacoco 6차 점진 상향 (default 80/70) — 약점 모듈 (common-logging 67/100, core-storage-impl 67/46, core-user-impl 68/50) 본격 보강 후. common-logging 의 ConsoleAppender / LogstashEncoder 통합 테스트, storage 의 MinIO mock 통합, user 의 UserController + Repository 통합. 트리거: prod 가동 + 운영 데이터 1~2개월 후 (생성일: 2026-05-06)
- [ ] [DX] Multi-session spec 진행 상태 헤더 (S1~SN 체크박스) — multi-session spec 의 복귀 비용 차단. 8-subsession spec (예: 종료 archive `docs/planned/archive/cleanup-legacy-cycle.md` 의 S1~S8 추적) 이 중단된 후 "어디까지 했지?" 추적 어려움. 헤더에 체크박스 도입 후 각 subsession 완료 시 체크. 트리거: 다음 multi-session spec 작성 시 적용 (생성일: 2026-05-06)
- [ ] [Template] **ADR 형식 통일 사이클** — ADR-021~035 의 *결론부터* 섹션 헤더 명시 (현재는 *상태* 다음 단락으로 통합). ADR-018 같은 *명시 헤더* 형식과 일관성 맞추기 — 15+ 파일 산문 재구성 (생성일: 2026-05-04, audit T9 발견)
- [x] ~~[Template] ADR Code Reference 보강~~ — T14 재검증 결과 *이미 충실* (모든 ADR 이 file 경로 + 클래스 + 메서드 + line 번호 보유). audit T9 의 누락 분류는 과도 엄격이었음. **불필요로 closed** (2026-05-04)
- [ ] [Template] **ADR-002 + ADR-015 consolidation** — *Template Governance + Versioning* 으로 통합. 현재 두 ADR 이 *commitlint / template-v* 태그 / CHANGELOG / Deprecation* 의 같은 메커니즘을 별도로 기록 (~70% 중복). 단일 ADR 로 통합 (생성일: 2026-05-04, audit T9 발견)
- [x] ~~[Template] Lite 모드 검증 강화~~ — `FeatureToggleTest` 정독 결과 *이미 8 도메인 모두 검증* (audit, push, payment, iap, email, 2fa, billing-notification, password-policy). audit T10 진단은 ADR-034 line 117 의 stale backlog 인용에서 비롯. **이미 완료, backlog closed** (2026-05-04)

### 템플릿 진화

- [ ] [Template] Roll-forward 가이드 보강 (`cross-repo-cherry-pick.md` 에 인프라 변경 반영법) — 파생 레포가 template 업데이트 가져가는 법 (2026-04-18)
- [ ] [Template] Release cadence 규칙 (`template-v` 태그 찍는 주기) — 의도적 cadence 정의 (2026-04-18)
- [ ] [Template] 파생 레포 "inventory 자동 업데이트" 가이드 — 본인 파생 레포가 새 env/service 추가 시 문서 동기화 (2026-04-18)
- [ ] [Template] template-spring-lite-example sample 파생 레포 — ADR-034 의 lite 변형 (PAYMENT/IAP/2FA 비활성) 시나리오를 fresh fork 환경에서 1회 검증 + 결과 docs 화. 본 template repo 는 fork 받는 출발점이므로 sample repo 생성은 사용자 GitHub 영역 — 본 repo 안에는 docs 만 (사용자 작업 후 결과 backlog 갱신) (2026-05-02)

### 단순 가정 → 검증 미흡 (2026-05 사이클 — ADR-021~035)

> 본 사이클 진행 중 추측/가정으로 진행된 부분. 실 검증 별도 task 로 분리 (사용자 피드백 2026-05-02).

- [ ] [DX] `tools/monitor-local.sh` P95 의 정확한 quantile 계산 — 현재 "0.5 bucket 비율" 단순 근사. histogram_quantile 정확 구현 또는 명시적 "approximate" 표기 강화 (2026-05-02)
- [ ] [DX] `tools/api-smoke-test.sh` 실 실행 검증 — 도그푸딩 또는 fresh 파생 레포 환경에서 11 step PASS 확인 필요 (2026-05-02)
  - 본 사이클 (2026-05-02) 에서 시도 — 기존 junwoo-service container 가 8081 점유 + 옛 fork 라 ADR-031 controller 미존재 → 의미 있는 실행 불가
  - 자동화 가능 부분은 통합 테스트로 대체 완료: FeatureToggleTest (8 test), NotificationPreferenceControllerTest (6 test), BillingServiceImplContractTest, FactoryApplicationTests, HealthEndpointsTest
  - 11 step 전체 e2e 는 사용자 도그푸딩 환경 (별도 fresh repo + WireMock + .env.prod) 에서 1회 실행 후 결과 backlog 에 기록 — 본 작업이 backlog 의 잔여 검증
- [x] [Feature] WireMock stub 응답 backend 호환 검증 — 본 사이클 (2026-05-02) audit 결과 명시 + 후속 task 분리:
  - `apple-server-notification-v2.json` 의 outer JWS body decode OK (notificationType=REFUND, signedDate, data 등 schema 정합).
  - 그러나 `data.signedTransactionInfo: "smoke-txn"` 은 JWS 형식 아님 + outer payload 의 `dev-signature` 가 실 cert chain 검증 통과 X.
  - 본 stub 은 **운영자 reproducer 용** (dev 환경에서 endpoint round-trip 시연). 실 decoder 통과 검증은 별도 task 로 분리.
- [x] [Feature] IAP adapter (Apple) 의 dev-mock 모드 추가 — `app.iap.apple.dev-mock=true` 시 AppleJwsVerifier 가 cert chain + ES256 signature 검증 우회. WireMock stub payload 가 실 decoder 통과 검증 (5+2 test PASS). prod 절대 금지 명시. **Google RTDN dev-mock 은 후속** (완료일: 2026-05-02 — Apple only)
- [x] [Feature] Google RTDN 의 dev-mock 모드 검증 — audit 결과: GoogleNotificationDecoder 자체는 서명 검증 X (별도 layer GoogleWebhookAuthFilter 가 verifyToken=true 일 때만 등록, default false). 즉 Apple 의 dev-mock 동등 기능이 이미 default 상태에 구현되어 있음. WireMock stub 호환 4 test 추가로 검증 완료 (완료일: 2026-05-02, GoogleNotificationDecoderStubTest 4 test PASS)
- [ ] [Ops] `tools/migrate-prod.sh` checksum 알고리즘 실 Flyway 비교 검증 — 본 사이클 (2026-05-02) audit 결과:
  - 현재 python3 zlib.crc32 (CRLF 제거 후) 사용
  - Flyway 의 `org.flywaydb.core.internal.resource.ResourceProvider` 정확 알고리즘 (라인별 trim + CRC32 누적) 과 1:1 매칭 보장 X
  - mismatch 시 부팅 시 `Migration checksum mismatch` → 운영자가 `schema_history.checksum` UPDATE 후 재 deploy
  - 본 task 처리 결과: `migrate-prod.sh` + `flyway-runbook.md` 의 mismatch 절차 상세 문서화 (2026-05-02)
  - 후속: Flyway library 직접 호출 Java helper — 본 사이클 (2026-05-02) audit 결과: Flyway 의 정확 checksum = internal API (`org.flywaydb.core.internal.resource.LoadableResource`) 사용 — 버전 의존 위험. 운영 절차 (flyway-runbook.md §4-3 의 schema_history.checksum UPDATE) 가 mismatch 시 안전망. nice-to-have 로 별도 사이클 — 운영 환경에서 첫 mismatch 사례 발생 후 priority 재평가
- [ ] [Feature] ADR-031 controller 실 endpoint 호출 검증 — `/me/notification-preferences` GET/PATCH 의 컴파일/spotless 만 검증됐고 실 부팅 후 200/204 응답 미확인 (2026-05-02)
- [ ] [Feature] ADR-034 non-leaf 토글 invasive 작업 — payment/iap/email/2fa 를 `ObjectProvider` 변환 + `ApiError.FEATURE_DISABLED` (CMN_009 신규) 추가 → 부팅 fail 없이 토글 가능하게 (2026-05-02)
- [ ] [DX] `bootstrap/FeatureToggleTest` 의 leaf domain 외 검증 추가 — billing-notification / password-policy 도 disable 시 정상 부팅 + bean 미등록 명시 검증 (2026-05-02)
- [x] [DX] GlobalExceptionHandler 에 ConversionFailedException + MethodArgumentTypeMismatchException → 422 (CMN_001) 매핑 — details 에 param/rejected/allowed 포함. NotificationPreferenceControllerTest 의 invalid kind 케이스 정확 검증 (완료일: 2026-05-02, commit: 4c2f1a3 예정)

---

## 완료 (archive, 지난 2개월)

- [x] [DX] Mutation testing (PIT) 도입 — `info.solidsoft.pitest` 1.15.0 + pitest-core 1.17.0 + junit5 1.2.1. *-impl 모듈 10개 적용. measure-only (threshold 미설정 첫 도입). 분기 1회 manual audit 권장 — `./gradlew :<module>:pitest`. 시범 (core-audit-impl): mutation score 81% (43 mutations / 35 killed) — coverage % 의 진실성 검증 통과. CI 통합 + threshold 설정은 별도 cycle (완료일: 2026-05-06, commit: `69fcff6`)
- [x] [DX] Jacoco 5차 점진 상향 — default line 65%→70% / branch 45%→55% (4차에서 +5/+10pp). common-persistence override 제거 (AbstractAppDataSourceConfig 보강으로 100%/84.6% 도달, default 통과). 신규 override 3건: common-logging (line 65%, 비-impl 모듈이라 보강 비용 큼), core-storage-impl (line 65%, branch 45% — MinIO 통합 별도 cycle), core-user-impl (line 65%, branch 50% — User entity 23 lines + UserController DispatcherServlet 보강 별도 cycle). AbstractAppDataSourceConfigUnitTest 17 tests 신규 (Constructor derive / deriveSlugUrl / FlywayMode / runFlywayWithMode 등). common-persistence 73%→100% (완료일: 2026-05-06, commit: `0ac2f74` + `d5f1854`)
- [x] [DX] Jacoco 4차 점진 상향 — default branch 40%→45% (line 65 그대로). common-persistence override 갱신 (line 60→70, branch 15→20). 신규 보강: SlugContextTest (4 tests, 0%→100%), SchemaRoutingDataSourceTest (4 tests, 0%→100%), AuditAspect 보강 (6 tests, 83%→96.2%). audit-impl 85.4%→93.3% / 60%→90%. common-persistence 60%→73.3% / 17.9%→23.1%. 잔여 AbstractAppDataSourceConfig 의 27 branch 는 5차 cycle (완료일: 2026-05-06, commit: `92a1540` + `25dd6d7`)
- [x] [DX] Jacoco 3차 점진 상향 — default line 60%→65% / branch 40 그대로 (2차에서 +5pp line). audit override 제거 (audit 보강으로 50.6%→85.4% 도달, default 통과). user override 제거 (Q* exclude 효과로 55%→68.1% 자연 통과). 신규 override: common-persistence (line 60%, branch 15%) — Q* exclude 후 비즈 branch 17.9% 노출. 신규 jacoco 정책: `tasks.withType(JacocoReportBase)` 의 classDirectories 에서 `**/Q*.class` 제외 (QueryDSL 자동 생성 코드, 비즈 의미 없음). 신규 audit tests (AuditLog 3 + AuditServiceImpl 6). 모든 비-면제 모듈 통과 (완료일: 2026-05-06, commit: `b529efc` + `16050dd`)
- [x] [DX] Jacoco 2차 점진 상향 — default line 50%→60% / branch 35%→40% (1차에서 +10/+5pp). 약점 모듈 per-module override 2건: core-audit-impl (line 50% / branch 45%, 51%/53% baseline 의 -1pp regression 방어), core-user-impl (line 55% / branch 45%, 55%/50% baseline). 모든 비-면제 모듈 통과. 다음 3차 상향 (70/50) 은 약점 모듈 보강 후 (완료일: 2026-05-06, commit: `c6cd6cc`)
- [x] [DX] Cycle C-B-2~5: GooglePlayAdapter + IapAdapter + FcmPushAdapter 본격 보강 — `GooglePlayAdapter` line 0%→96.2% (15 tests, OAuth + subscription 두 endpoint flow + RSA service account mock). `IapAdapter` line 0%→94.6% (12 tests, SlugContext + 6 mocks + webhook 위임). `FcmPushAdapter` line 16%→96.1% (10 tests, protected method spy 패턴 + BatchResponse/SendResponse mock + UNREGISTERED/INVALID_ARGUMENT 토큰 추적). production code 1건 변경: FcmPushAdapter 에 doMulticastSend / doSend protected 메서드 추가 (SDK final class 의존 회피). **iap-impl line 50.8% → 72.8% / branch 44.9% → 63.6%**. **push-impl line 52.2% → 94.7% / branch 40% → 90%**. 다음 달 prod 가동 전 baseline 견고. mockito 5.x 의 inline default 로 final class mock OK 검증됨 (완료일: 2026-05-06, commit: `28d9cea` + `d91ea26` + `c8f407d`)
- [x] [DX] Cycle C-B-1: AppleAppStoreAdapter 본격 cover → iap 50%+ 도달 — `AppleAppStoreAdapter` line 0%→98.2% (109/111). 13 tests: short-circuit 4 (platform/config/bundleId), happy path, error paths (non-2xx/missing field/productId mismatch/IOException/InterruptedException), JWT 발급 + 캐시 + invalid key. `core-iap-impl` line 33%→50.8% / branch 31%→44.9%. **모든 비-면제 모듈이 default 50/35 통과 — build.gradle 의 override Map 빈 상태**. 잔여 (GooglePlayAdapter / IapAdapter / FcmPushAdapter spy) 는 별도 cycle (완료일: 2026-05-06, commit: `ec73fdc`)
- [x] [DX] Cycle C-A: push 50%+ 도달 + iap 작은 클래스 보강 — `core-push-impl` line 40%→52.2% / branch 30%→40% (FcmPropertiesTest + FcmPushAdapterTest 의 short-circuit paths). `core-iap-impl` line 28%→33.2% / branch 23%→31.1% (StubIapAdapterTest + IapPropertiesTest + IapAppCredentialPropertiesTest). build.gradle 의 push override 제거 (default 50/35 통과) + iap override 25/20→30/25 갱신 (regression 방어). 본격 50% (AppleAppStoreAdapter / GooglePlayAdapter / FcmPushAdapter spy) 은 별도 cycle (완료일: 2026-05-06, commit: `9e4e9dd` + `8406416`)
- [x] [Obs] Grafana 대시보드 passive 정책 명시 — `infra/grafana/dashboards/` 의 4 dashboard (`app-factory-overview` / `auth-flow` / `billing-notifications` / `logs-quickview`) 가 이미 panel-level alert 미첨부 (passive). app-factory-overview 가 RPS / 5xx / p95 / 429 / JVM Heap / ERROR logs 를 cover. `monitoring-setup.md` 에 "Passive monitoring 정책" 섹션 추가. DB connection pool metric panel 만 후속 backlog 로 분리 (완료일: 2026-05-06, commit: `0c81c59`)
- [x] [Security] OWASP Dependency Check CI 통합 — `.github/workflows/ci.yml` 에 cache + `dependencyCheckAggregate` step 추가. `NVD_API_KEY` secret 환경변수. NVD DB cache 는 `~/.gradle/dependency-check-data` 를 actions/cache@v4 로 (libs.versions.toml hashFiles + restore-keys fallback). CVSS 7.0 이상 발견 시 build fail. NVD key 발급은 운영자 별도 작업 (완료일: 2026-05-06, commit: `f2b20a4`)
- [x] [DX] Jacoco coverage 1차 점진 상향 — default LINE>=50% / BRANCH>=35% (기존 25/20 강화). per-module override 로 약점 모듈 regression 방어 (core-iap-impl 25/20, core-push-impl 38/28). 모든 비-면제 모듈 통과. 다음 2차 상향 (60%/45%) 은 약점 모듈 보강 후 별도 cycle (완료일: 2026-05-06, commit: `cf89f4c`)
- [x] [Security] 의존성 CVE 스캔 도구 도입 — OWASP Dependency Check Gradle 플러그인 (`org.owasp.dependencycheck` 11.1.0) + `failBuildOnCVSS=7.0`. Dependabot 안 쓰는 정책 대체. 로컬: `./gradlew dependencyCheckAnalyze` (첫 실행 NVD DB ~5분). CI 자동 통합은 NVD API key + GHA cache 가 별도 작업이라 후속 backlog (owasp A06.1) (완료일: 2026-05-06, commit: `c6d62d6`)
- [x] [Template] 보안 정책 ADR/문서 보강 묶음 — TLS sslmode=require (.env.example), SSRF ADR-036 신규, 404 vs 500 service-layer convention (exception-handling.md), stacktrace=never (application.yml). CORS 는 jwt-authentication.md:33 에 이미 있어서 skip. 4 정책 처리 (owasp A02.1 / A04.1 / A05.3 / A10.1) (완료일: 2026-05-06, commit: `f408768` + `d7be4ea`)
- [x] [DX] husky hook 활성화 자동화 — 3중 안전망: A) factory CLI 의 `_factory_ensure_husky` 헬퍼가 모든 ./factory <cmd> 진입 시 npm install 자동 실행 (idempotent, ~5초 첫회). B) build.gradle 의 `gradle.projectsEvaluated` 가 미활성 시 warning 출력 (factory 우회 사용자 백업). C) docs/start/onboarding.md 의 Section 2.3 보강. 새 clone 사용자 전부 커버 (완료일: 2026-05-06, commit: `3644bd1`)
- [x] [DX] Jacoco coverage 게이트 도입 — `build.gradle` 의 subprojects 에 `jacocoTestCoverageVerification` 룰 추가. baseline LINE>=25%, BRANCH>=20% (보수적 첫 도입). 면제: bootstrap, common-testing, *-api. 신규 도메인 추가 시 0% 코드 main 합류 차단. 점진 상향 backlog 등재 (완료일: 2026-05-06, commit: `8765428`)
- [x] [DX] Pre-push hook — `.husky/pre-push` 신규. spotlessCheck + compileJava + 빠른 단위 테스트 (common-web/security/persistence). 시간 목표 1분 이내. `git push --no-verify` escape hatch. 활성화 전제: `npm install` 1회 (prepare 스크립트가 git config 설정) (완료일: 2026-05-06, commit: `3857614`)
- [x] [Security] Swagger UI prod 노출 차단 — `application-prod.yml` 에 `springdoc.swagger-ui.enabled=false` + `api-docs.enabled=false` 추가. /swagger-ui.html 과 /v3/api-docs 둘 다 prod 에서 404. dev profile 은 활성 유지 (OWASP A05.1) (완료일: 2026-05-06, commit: `ceb9d45`)
- [x] [Security] Resend HTTP timeout 명시 — `ResendEmailAdapter` 의 HttpClient 에 connectTimeout=5s, HttpRequest 에 timeout=10s 적용. 다른 외부 client (Apple/Google/Kakao/Naver JWKS) 와 동일 패턴 (OWASP A10.2) (완료일: 2026-05-06, commit: `c8eb350`)
- [x] Item 7 — DTO/API 네이밍 정리 (완료일: 2026-04-18, commit: `647b0c4`)
- [x] Item 9 v1 → v2 plan 개정 (완료일: 2026-04-18, commit: `ef9b912`)
- [x] Item 10 — 앱 프로비저닝 통합 스크립트 (완료일: 2026-04-19, merge: `ff4bcbb`)
- [x] Item 10b — Multi-DataSource wiring (완료일: 2026-04-19, merge: `69ca16d`)
- [x] Item 11 — Documentation contract test (완료일: 2026-04-19, merge: `03112a6`)
- [x] [Ops] Jenkins vs GitHub Actions 결정 + 파이프라인 구축 → GHA + Kamal 선택. Item Ops-1 Stage A (template-ready). 완료일: 2026-04-19, feature/ops-1-home-server-mvp 의 `6f08db4`
- [x] [Ops] 맥미니 배포 메커니즘 선택 → Docker + Kamal + kamal-proxy (launchd 는 cloudflared 에만). 완료일: 2026-04-19, `0254e09` + `99aaa79`
- [x] [Ops] Graceful shutdown / health check / 자동 재시작 룰 → Spring `server.shutdown=graceful` + `timeout-per-shutdown-phase=30s` + Kamal healthcheck `/actuator/health/liveness` + Docker `restart: unless-stopped`. 완료일: 2026-04-19, `8d9263a`
- [x] [Ops] Cloudflare Tunnel 셋업 (template-ready) → `guides/deployment.md §2.3` 에 tunnel create / DNS / ingress / Access 절차. 실제 tunnel 생성은 파생레포 onboarding 시. 완료일: 2026-04-19, `7f9acae`
- [x] [Obs] 로컬 관측성 → 운영 전용으로 한정 (infra/docker-compose.observability.yml 분리). 완료일: 2026-04-19, `895ef84` + `47eeced`
- [x] [Obs] Prometheus retention 정책 → 운영 compose 에서 7일 확정. 완료일: 2026-04-19, `47eeced`
- [x] [DX] `bootstrap/build.gradle` bootRun 기본 프로파일 dev 주입 → convention plugin 에서 처리. 완료일: 2026-04-19, `d781b34`
- [x] [Security] JWT_SECRET prod 전용 생성 + 로테이션 주기 규약 → [`key-rotation.md §5 JWT_SECRET`](../production/setup/key-rotation.md) 에 6개월 주기 + 즉시 폐기 절차 문서화. JwtProperties 가 32자 미만 거부. 완료일: 2026-04-24
- [x] [Obs] Loki retention 정책 확정 → `infra/loki/loki-config.yml` 에 `retention_period: 336h` (14일) 확정. 완료일: 2026-04-24
- [x] [Feature] API 버저닝 롤아웃 결정 → [`ADR-008 (API 버전 관리 미도입)`](../philosophy/adr-008-no-api-versioning.md) 으로 의도적 미도입 확정. 도입 경로 (Cloudflare rewrite / ApiEndpoints prefix) 사전 기록. 완료일: 2026-04-24
- [x] [Feature] Push 실제 구현 → `FcmPushAdapter` 에 Firebase Admin SDK 호출 + MulticastMessage + 토픽 푸시 + 무효 토큰 추적 완료. APNs 는 iOS 고급 기능 필요 시점에 별도. 완료일: 2026-04-24
- [x] [Feature] OpenAPI → Flutter 클라이언트 계약 export → springdoc-openapi 2.6.0 로 `/v3/api-docs` + Swagger UI 제공. Flutter 측 자동 생성은 `openapi-generator-cli` 사용 (백엔드 쪽 준비 완료). 완료일: 2026-04-24

> 2개월 경과 후 CHANGELOG 로 이관.

---

## 관련 문서

- [`Git 워크플로우 (Git Workflow)`](../convention/git-workflow.md) — backlog 운영 규칙 상세
- [`CHANGELOG.md`](https://github.com/storkspear/template-spring/blob/main/CHANGELOG.md) — archive 된 완료 항목의 최종 기록처
