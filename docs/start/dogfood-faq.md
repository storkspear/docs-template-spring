# 도그푸딩 FAQ

> **유형**: How-to · **독자**: Level 1 · **읽는 시간**: ~5분

> 셋업 가이드: [`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md)
> 함정 모음: [`도그푸딩 함정 모음 (사고 실록)`](./dogfood-pitfalls.md)
> 다이어그램: [`CI / CD 전체 플로우 — commit 부터 운영 반영까지`](../production/deploy/ci-cd-flow.md)

---

### Q1. "use this template" 으로 만든 파생 레포에서도 도그푸딩 해야 하나요?

**권장**. 이유:
- template 의 `tools/init-server.sh` 등 자동화 코드는 그대로 복사되지만 **GitHub Settings (Variables/Secrets) / Mac mini 의 SSH 키 / GHCR 패키지** 는 파생 레포가 직접 셋업해야 함.
- 첫 실배포 전에 도그푸딩으로 한 번 검증하면 실제 사용자 트래픽 들어오기 전에 모든 함정을 잡을 수 있음.

수행: 첫 작업자가 `bash tools/init-server.sh <owner>/<repo>` 1·2회차 → `verify-server.sh` 6/6 PASS → `./gradlew :bootstrap:bootRun` UP 까지 검증. 자세한 흐름은 [`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md).

(임시 trial 환경을 한 번에 cleanup 하고 싶을 때만 옛 `tools/dogfooding/setup.sh + cleanup.sh` 사용 — 새 흐름과 별개.)

---

### Q2. cleanup 한 후 setup 다시 반복해도 되나요?

**OK**. 두 스크립트 모두 멱등성 보장:
- `setup.sh`: `gh secret set` 은 overwrite, `authorized_keys` 는 grep 후 append (중복 안 추가)
- `cleanup.sh`: 없는 자원 삭제 시도하면 `[WARN] ... 없음 (skip)` 만 출력하고 graceful

검증을 여러 번 돌려서 자동화 안정성 확인하는 워크플로우 권장.

---

### Q3. PAT 안 쓰고 `GITHUB_TOKEN` 으로만 가능한가요?

**현재 안 됨** (2026-04 기준). 이유는 [`pitfalls #5 ~ #7`](./dogfood-pitfalls.md):
- 첫 GHCR 패키지 생성 시 repo↔package 자동 연결이 안 되어 GITHUB_TOKEN 으로 push 시 403
- `workflow permissions = write` + `provenance/sbom: false` 다 적용해도 동일

GitHub 측에서 이 동작이 개선되면 PAT 폐기 가능 ([`I-10 결정 카드 의 재검토 트리거`](../production/deploy/decisions-infra.md)).

---

### Q4. `DEPLOY_ENABLED=false` 일 때도 GHA 비용이 드나요?

**거의 0원**:
- `ci.yml` (push, PR) 은 항상 동작 — 분 사용 (CI 5분/회)
- `deploy.yml` 은 `workflow_run` 으로 트리거되지만 gate 가 즉시 skip → **2~3초** 만에 종료, billed ~0.05분
- 즉 CI 비용은 그대로, deploy 는 사실상 무시 가능

template 상태에서 DEPLOY_ENABLED 기본 미설정인 이유.

---

### Q5. Mac mini 가 아니라 다른 호스트 (e.g. 클라우드 VPS) 면?

**가능**. 변경 포인트:
- `.env.dogfood` 의 `DEPLOY_HOST`, `DEPLOY_SSH_USER` 만 그 호스트에 맞춰 변경
- 그 호스트에 docker / kamal-proxy 가 기동 가능해야 함 (ARM64 이미지를 풀 수 있어야)
- 만약 x86 호스트면 `.github/workflows/deploy.yml` 의 `platforms: linux/arm64` 를 `linux/amd64` 로 변경 (template 결정 [`I-04`](../production/deploy/decisions-infra.md) 와 충돌하므로 별도 ADR 필요)
- Tailscale 로 도달 가능한 호스트면 OAuth 셋업 그대로
- Tailscale 안 쓰면 `tailscale-action` step 제거 + 호스트 public IP 또는 다른 VPN 셋업

---

### Q6. cleanup 후 Mac mini 의 `kamal-proxy` 컨테이너가 사라졌어요. 다음 배포가 또 setup 부터?

**네**. 다음 `setup.sh` + 첫 배포 시 kamal 이 자동으로 setup (kamal-proxy 컨테이너 + docker network) 다시 합니다 (~30초).

매번 setup 시간이 부담이면 `bash tools/dogfooding/cleanup.sh --keep-proxy` 로 컨테이너 유지. 메모리 ~15MB / 디스크 ~150MB 정도 추가 사용.

---

### Q7. `.env.dogfood` 가 실수로 commit 되면?

**즉시 행동**:
1. (가능하면) 새 commit 으로 파일 삭제 + push
2. **모든 키 즉시 폐기 + 재발급** ([`key-rotation.md`](../production/setup/key-rotation.md))
   - GitHub history 에 남으니 noting 안 됨 — 이미 노출됐다고 가정
3. (선택) `git filter-repo` 또는 BFG 로 history 재작성 + force push

**예방**:
- `.gitignore` 에 `.env.*` 가 잡고 있음
- `setup.sh` 시작 시 `git check-ignore` 로 검증 (실수 가능성 줄임)
- pre-commit hook 으로 `.env.dogfood` 패턴 차단 (option)

---

### Q8. 도그푸딩으로 띄운 컨테이너가 운영 트래픽도 받을 수 있나요?

**기술적으로 가능**:
- kamal-proxy 가 `Host: server.<도메인>` 헤더로 라우팅
- cloudflared tunnel 이 연결되어 있으면 외부에서 `https://server.<도메인>` 로 접근 가능

**도그푸딩 의도와 불일치 — 권장 안 함**:
- DB/secrets 가 dummy 또는 테스트 값일 수 있음
- 도그푸딩은 "한 사이클 검증" 용. 본격 운영은 별도 변수 / 별도 도메인 / 별도 인프라 권장

---

### Q9. setup.sh 가 중간에 fail 하면 어디서부터 재실행?

**처음부터 그냥 재실행 OK**. 멱등성 설계:
- prereq 점검: 매번 같음
- gh permissions write: 이미 write 면 no-op
- gha_deploy 키: 이미 있으면 skip
- Mac mini authorized_keys: grep 으로 중복 방지
- Variables/Secrets: 매번 overwrite (gh CLI 동작)

→ fail 한 step 부터 다시 시작하지 않고 그냥 `bash tools/dogfooding/setup.sh` 한 번 더.

---

### Q10. 외부 도메인 없이 localhost 로 검증만 가능?

**Tailscale IP 로 가능**:
```bash
# 본인 Tailscale 디바이스에서
curl -H "Host: server.<도메인>" http://100.X.X.X/actuator/health/liveness
```

도메인 (PUBLIC_HOSTNAME) 은 placeholder 라도 상관없음 — kamal-proxy 의 host-based routing 에 사용되므로 curl 의 Host 헤더와 일치하면 됨. 외부 인터넷 접근만 cloudflared 필요.

---

### Q11. 11회 시도했다는데 다시 셋업하면 또 11번 걸리나요?

**1번에 끝납니다**. 11회 함정 중 8개는 워크플로우/스크립트 코드에 박혀 영구 회피, 3개는 외부 발급 (PAT / Tailscale OAuth / DB URL 형식) 이고 가이드 §3 에 정확한 절차 + 함정 강조. JDK 26 함정 ([`pitfalls #12`](./dogfood-pitfalls.md)) 만 사람이 JDK 21 환경 보장 필요.

→ 가이드 따라 1번에 setup → 자동 trigger → 배포 success 가 정상 흐름.

(만약 새로운 함정 만나면 [`pitfalls.md`](./dogfood-pitfalls.md) §"새 함정 발견 시" 절차로 추가 PR.)

---

### Q12. 공동 작업자/fresh clone 받은 두 번째 작업자도 `init-server.sh` 를 돌려야 하나요? <a id="q12"></a>

**아니요**. 이미 첫 작업자가 셋업해서 main 에 push 한 레포를 fresh clone 한 두 번째+ 작업자는 운영 secrets 를 다시 push 할 필요가 없습니다 (이미 GitHub Secrets 에 등록됨).

`init-server.sh` 를 그대로 돌리면 **공동 작업자 모드**가 자동 감지됩니다 — 다음 세 단서가 모두 만족할 때:
1. `settings.gradle` 에 sentinel `template-spring` 매칭 0 (이미 rename 됨)
2. `PROJECT_README_TEMPLATE.md` 부재 (이미 README.md 로 교체)
3. `.env.prod` 부재 (이 작업자는 운영 secrets 가 필요 없음)

이 모드에서는 `Step 5 (.env.prod 생성)` / `Step 6 (Secrets push)` / `Step 10 (verify-server.sh)` 를 자동 skip 하고 **로컬 dev 환경 (.env + docker compose + postgres ready) 만 준비**합니다.

```bash
# 두 번째+ 작업자: REPO 인자 없이 실행 가능
bash tools/init-server.sh
```

또는 더 가벼운 흐름:
```bash
cp .env.example .env       # (없으면)
bash tools/start-server.sh # docker compose + postgres ready 만
./gradlew :bootstrap:bootRun
```

**최초 셋업 흐름을 강제로 다시 돌려야 한다면** (운영 secrets 갈아엎기 등):
```bash
bash tools/init-server.sh <owner>/<repo> --reinit
```
⚠️ `--reinit` 은 운영 secrets 가 무작위 새 값(`JWT_SECRET`/`DB_PASSWORD`)으로 덮어쓰일 수 있어 팀과 충분히 협의 후 사용 — 모든 발급된 토큰이 무효화될 수 있음.

---

### Q13. `verify-server.sh` 의 6 단계는 무엇을 검증하나요?

`init-server.sh` Step 10 에서 자동 호출 (단독 실행도 가능: `bash tools/verify-server.sh`).

| Step | 분류 | 항목 | PASS 의미 |
|---|---|---|---|
| 1 | REQUIRED | backend health (kamal-proxy → `/actuator/health`) | 운영 Spring 컨테이너가 200 OK + `status:UP` |
| 2 | REQUIRED | DB 연결 (HikariCP) | backend health UP 이면 indirect PASS |
| 3 | OPTIONAL: deploy | SSH + Tailscale (`kamal app version`) | GHA → Mac mini Tailscale 도달 OK |
| 4 | OPTIONAL: storage | MinIO 업로드 (PUT/STAT/DEL) | storage feature 정상 |
| 5 | OPTIONAL: email | Resend API 발송 | email feature 정상 |
| 6 | OPTIONAL: logging | Loki readiness | logging feature 정상 |

REQUIRED fail = 즉시 중단 (운영 backend 가 응답 안 함). OPTIONAL fail = 경고 + 계속.

**OPTIONAL feature 가 `.env.prod` 에서 비어있으면 자동 SKIP** — 그 feature 를 안 쓴다는 뜻으로 간주 (예: `RESEND_API_KEY=` 비어있으면 Step 5 SKIP, "feature 비활성화" 로 취급). 따라서 SKIP 결과는 **fail 이 아닙니다**. 활성화하고 싶으면 해당 키들을 `.env.prod` 에 채우고 `init-server.sh` 재실행.

기대 결과 (DEPLOY_ENABLED=true + 모든 OPTIONAL 활성화 시): **6/6 PASS** (`✅ 운영 가용 상태 — 활성 기능 모두 작동`).

---

### Q14. `init-server.sh` 1회차/2회차는 어떻게 자동 분기되나요? <a id="q14"></a>

`init-server.sh` 는 명시 플래그 없이 **`.env.prod` 의 상태**로 1·2회차를 idempotent 하게 분기합니다.

| 상태 | 판정 | 동작 |
|---|---|---|
| `.env.prod` 부재 | **1회차 (또는 공동 작업자)** | Step 5 에서 `.env.prod` 생성 + JWT_SECRET / DB_PASSWORD 자동 발급. 단, sentinel rename 완료 + PROJECT_README_TEMPLATE.md 부재면 공동 작업자로 감지해 Step 5 도 skip ([Q12](#q12) 참조) |
| `.env.prod` 존재 + REQUIRED 5 비어있음 | **1회차 직후 (사용자가 채우는 중)** | Step 6 에서 안내만 출력 후 종료 (Step 7~10 도달 안 함) |
| `.env.prod` 존재 + REQUIRED 5 채움 | **2회차** | Step 6 에서 GitHub Secrets/Variables push → Step 7~10 까지 진행 |

판정 키:
- **REQUIRED 5**: `APP_DOMAIN`, `DB_URL`, `DB_USER`, `GHCR_TOKEN`, `SSH_PRIVATE_KEY` (사용자 채우기). `JWT_SECRET` / `DB_PASSWORD` 는 자동 발급되므로 사용자 입력 대상 아님.
- **idempotent 보장**: Step 4 (.env), Step 5 (.env.prod) 둘 다 "이미 존재하면 skip", `gh secret set` 은 overwrite, husky 훅도 이미 활성화면 skip.

따라서 같은 명령을 여러 번 안전하게 재실행 가능. 잘못된 값으로 secrets 를 push 했다면 `.env.prod` 의 해당 키만 갱신 후 다시 돌리면 그 키만 overwrite 됩니다.

---

### Q15. `RESEND_TEST_ADMIN_USER_EMAIL` 은 왜 `init-server.sh` 카탈로그에 없나요? <a id="q15"></a>

이 키는 **운영 deploy 자동화에 필요 없는** 검증 전용입니다 — `verify-server.sh` Step 5 (이메일 발송) 가 Resend API 로 테스트 메일을 보낼 *수신자* 로만 사용됩니다.

| 키 | 용도 | init-server.sh 카탈로그 | GitHub Secrets push |
|---|---|---|---|
| `RESEND_API_KEY` | 운영 발송 + 검증 | ✓ (email feature) | ✓ |
| `RESEND_FROM_ADDRESS` | 운영 발송 + 검증 | ✓ (email feature) | ✓ |
| `RESEND_FROM_NAME` | 운영 발송 | ✓ (email feature) | ✓ |
| **`RESEND_TEST_ADMIN_USER_EMAIL`** | **`verify-server.sh` 검증만** | ✗ (의도) | ✗ |

`verify-server.sh` 를 운영 환경에서 SSH 로 실행할 때 `.env.prod` 를 직접 source 하므로 GitHub Secrets 에 push 할 필요 없습니다. 비어있으면 Step 5 가 자동 SKIP — 운영 동작에 영향 없음.

채우려면 `.env.prod` 에 본인 이메일을 직접 입력 (Secrets push 안 됨).

---

### Q17. `APP_CREDENTIALS_<SLUG>_*` 를 `.env.prod` 에 추가하면 운영에 자동 반영되나요? <a id="q17"></a>

**아니오. `init-server.sh` 가 GitHub Secrets push 까지만 자동**, 운영 컨테이너 inject 는 현재 *수동 작업* 입니다.

| 흐름 | 자동/수동 | 위치 |
|---|---|---|
| `.env.prod` 에 `APP_CREDENTIALS_<SLUG>_GOOGLE_CLIENT_IDS_0` 등 추가 | 수동 | 사용자 |
| `init-server.sh` 2회차 실행 시 정규식으로 자동 발견 + GitHub Secrets push | ✅ 자동 | init-server.sh L376~395 |
| `config/deploy.yml` 의 `env.secret` 목록에 같은 키 추가 | ❌ **수동** | 파생 레포 |
| `.kamal/secrets.example` 에 같은 키 매핑 추가 | ❌ **수동** | 파생 레포 |
| Kamal 이 컨테이너에 inject → Spring relaxed binding 으로 `app.credentials.<slug>.google-client-ids[0]` 으로 받음 | ✅ 자동 | Spring |

**즉 GitHub Secrets 에 push 됐다고 운영에서 동작하는 게 아닙니다.** `config/deploy.yml` + `.kamal/secrets` 의 env.secret 목록에 같은 키를 명시해야 Kamal 이 환경변수로 컨테이너에 전달합니다.

이 두 파일은 **파생 레포가 직접 append** 해야 합니다 (template 의 두 파일에 코멘트로 "Phase 2 자동 append 예정" 명시 — 현재는 미구현). 새 앱 모듈을 `tools/new-app/new-app.sh <slug>` 로 추가한 뒤:

```yaml
# config/deploy.yml 의 env.secret 끝에 추가
- APP_CREDENTIALS_GYMLOG_GOOGLE_CLIENT_IDS_0
- APP_CREDENTIALS_GYMLOG_APPLE_BUNDLE_ID
- APP_CREDENTIALS_GYMLOG_KAKAO_APP_ID
- APP_CREDENTIALS_GYMLOG_NAVER_CLIENT_ID
```

```bash
# .kamal/secrets 에도 같은 매핑 추가 ($VAR 는 GHA env 에서 resolve)
APP_CREDENTIALS_GYMLOG_GOOGLE_CLIENT_IDS_0=$APP_CREDENTIALS_GYMLOG_GOOGLE_CLIENT_IDS_0
APP_CREDENTIALS_GYMLOG_APPLE_BUNDLE_ID=$APP_CREDENTIALS_GYMLOG_APPLE_BUNDLE_ID
# Kakao/Naver 동일
```

또 `.github/workflows/deploy.yml` 의 env 블록에도 같은 키를 `${{ secrets.APP_CREDENTIALS_<SLUG>_* }}` 형태로 export 해야 GHA runtime 에 노출됩니다 (Phase 2 자동화 전까지).

---

### Q16. 원본 `template-spring` 자체를 clone 받으면 어떻게 동작하나요? <a id="q16"></a>

template 개발자가 원본 `storkspear/template-spring` repo 를 그대로 clone 받아 `init-server.sh` 를 돌리면 **공동 작업자 모드가 아닌 1회차 모드** 로 진입합니다 — 의도된 동작입니다.

| 검사 항목 | 원본 template-spring | 파생 레포 fresh clone |
|---|---|---|
| `settings.gradle` sentinel `template-spring` 매칭 | ✓ (rename 안 됨) → 1회차 후보 | ✗ (rename 완료) → 공동작업자 후보 |
| `PROJECT_README_TEMPLATE.md` 부재 | ✗ (있음) → 1회차 후보 | ✓ (이미 삭제됨) → 공동작업자 후보 |
| `.env.prod` 부재 | ✓ → 1회차 후보 | ✓ → 공동작업자 후보 |
| **결과** | **1회차 모드** | **공동 작업자 모드** |

따라서 원본 repo 를 clone 받으면 `bash tools/init-server.sh <test-org>/<test-repo>` 처럼 REPO 인자가 필요하고, 실행 시 settings.gradle 등이 `<test-repo>` 이름으로 rename 됩니다 — 즉 *원본을 이름만 바꿔 시험하는* 흐름. 시험 후엔 변경을 commit 하지 말고 `git restore .` 로 되돌리면 됩니다.

이 동작을 강제로 막으려면 `--reinit` 없이 `init-server.sh` (REPO 인자 없음) 를 시도하면 인자 누락으로 usage 출력 → 의도치 않은 rename 방지.

---

## 개요

도그푸딩 환경 셋업 시 자주 묻는 질문 16 개 모음. 본 가이드 ([`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md)) 를 따라가다 막히는 지점별 해결 포인터.

---

## 더 궁금한 게 있다면

- [`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md) — 정상 흐름
- [`도그푸딩 함정 모음 (사고 실록)`](./dogfood-pitfalls.md) — 11회 함정 자세히
- [`CI / CD 전체 플로우 — commit 부터 운영 반영까지`](../production/deploy/ci-cd-flow.md) — 다이어그램
- [`키 교체 절차 (Key Rotation)`](../production/setup/key-rotation.md) — 키 교체
- [`인프라 결정 기록 (Decisions — Infrastructure)`](../production/deploy/decisions-infra.md) — 결정 근거 (I-09 ~ I-14)

---

## 다음 단계

- 함정 사례 검색: [`도그푸딩 함정 모음 (사고 실록)`](./dogfood-pitfalls.md) — 실제 겪은 11 개 사고 기록
- 본 가이드 전체: [`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md)
