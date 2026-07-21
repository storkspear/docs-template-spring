# 도그푸딩 FAQ

> **유형**: How-to · **독자**: Level 1 · **읽는 시간**: ~5분

> 셋업 가이드: [`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md)
> 함정 모음: [`도그푸딩 함정 모음 (사고 실록)`](./dogfood-pitfalls.md)
> 시간 순 흐름: [`도그푸딩 walkthrough`](./dogfood-walkthrough.md)
> 다이어그램: [`CI / CD 전체 플로우 — commit 부터 운영 반영까지`](../production/deploy/ci-cd-flow.md)

이 문서는 [도그푸딩](../reference/glossary.md#이-레포-고유-용어) 환경을 셋업하다 자주 막히는 지점을 질문-답변으로 모은 거예요. 정상 흐름 전체는 위 셋업 가이드에서 따라가고, 여기서는 "이건 왜 이렇게 동작하지?" 싶은 순간에 해당 질문만 찾아 읽으면 돼요.

---

### Q1. "Use this template" 으로 만든 파생 레포에서도 도그푸딩을 해야 하나요?

**권장해요.** 이유는 두 가지예요.

[템플릿](../reference/glossary.md#이-레포-고유-용어)의 `tools/init-prod.sh` · `init-local.sh` 같은 자동화 코드는 그대로 복사돼요. 하지만 GitHub 설정(Variables · Secrets), Mac mini 의 SSH 키, [GHCR](../reference/glossary.md#운영--인프라) 패키지는 [파생 레포](../reference/glossary.md#이-레포-고유-용어)가 직접 셋업해야 해요. 자동화가 복사된다고 해서 외부 자격까지 따라오는 건 아니에요.

또 첫 실배포 전에 도그푸딩으로 한 번 검증하면, 실제 사용자 트래픽이 들어오기 전에 모든 함정을 미리 잡을 수 있어요.

검증 흐름은 이래요. 첫 작업자가 `./factory all init <owner>/<repo>`(= `init-local.sh` → `init-prod.sh` 순차; `init` 만 쓰면 local 셋업만 돼요)를 1·2회차로 돌리고, `verify-server.sh` 가 7/7 PASS 를 내고, `./gradlew :bootstrap:bootRun` 으로 Spring 이 UP 상태가 되는 데까지를 확인해요. 자세한 흐름은 [`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md) 와 [`도그푸딩 walkthrough`](./dogfood-walkthrough.md) 에서 볼 수 있어요.

> 임시 시험 환경을 한 번에 정리하고 싶을 때만 옛 `tools/dogfooding/setup.sh` + `cleanup.sh` 를 써요. 위의 새 흐름과는 별개예요.

---

### Q2. 한 번 정리한 뒤에 셋업을 다시 반복해도 되나요?

**괜찮아요.** 두 스크립트 모두 [멱등성](../reference/glossary.md#코드-패턴)을 보장해요.

- `setup.sh` — `gh secret set` 은 덮어쓰기로 동작하고, `authorized_keys` 는 grep 으로 확인한 뒤 추가하므로 같은 키가 중복으로 쌓이지 않아요.
- `cleanup.sh` — 없는 자원을 지우려고 하면 `[WARN] ... 없음 (skip)` 만 출력하고 부드럽게 넘어가요.

검증을 여러 번 돌려서 자동화의 안정성을 확인하는 워크플로우를 권장해요.

---

### Q3. [PAT](../reference/glossary.md#ci--배포-파이프라인) 없이 `GITHUB_TOKEN` 만으로 가능한가요?

**지금은 안 돼요** (2026-04 기준). 자세한 근거는 [`함정 모음 #5 ~ #7`](./dogfood-pitfalls.md) 에 정리돼 있어요.

- 첫 GHCR 패키지를 만들 때 레포와 패키지가 자동으로 연결되지 않아서, `GITHUB_TOKEN` 으로 push 하면 403 이 나요.
- `workflow permissions = write` 와 `provenance: false` · `sbom: false` 를 다 적용해도 똑같이 실패해요.

GitHub 쪽에서 이 동작이 개선되면 그때 PAT 를 폐기할 수 있어요 (재검토 트리거는 [`인프라 결정 기록 I-10`](../production/deploy/decisions-infra.md) 에 적어 뒀어요).

---

### Q4. `DEPLOY_ENABLED=false` 일 때도 GitHub Actions 비용이 드나요?

**거의 0원이에요.**

- `ci.yml`(push · PR)은 항상 동작해요 — 회당 약 5분의 [CI](../reference/glossary.md#ci--배포-파이프라인) 시간을 써요.
- `deploy.yml` 은 `workflow_run` 으로 트리거되지만, 게이트가 즉시 건너뛰어 2~3초 만에 끝나요. 청구되는 시간은 약 0.05분 정도예요.

즉 CI 비용은 그대로지만 배포 쪽은 사실상 무시할 만해요. 템플릿 상태에서 `DEPLOY_ENABLED` 를 기본 미설정으로 두는 이유예요.

---

### Q5. Mac mini 가 아니라 다른 호스트(예: 클라우드 VPS)면요?

**가능해요.** 바꿔야 할 지점은 다음과 같아요.

- `.env.dogfood` 의 `DEPLOY_HOST` 와 `DEPLOY_SSH_USER` 를 그 호스트에 맞춰 바꿔요.
- 그 호스트에서 Docker 와 [kamal-proxy](../reference/glossary.md#운영--인프라) 가 기동 가능해야 해요(ARM64 이미지를 받을 수 있어야 해요).
- x86 호스트라면 `.github/workflows/deploy.yml` 의 `platforms: linux/arm64` 를 `linux/amd64` 로 바꿔요. 이건 템플릿 결정 [`I-04`](../production/deploy/decisions-infra.md) 와 충돌하므로 별도 ADR 이 필요해요.
- [Tailscale](../reference/glossary.md#운영--인프라) 로 도달할 수 있는 호스트라면 OAuth 셋업을 그대로 쓰면 돼요.
- Tailscale 을 안 쓴다면 `tailscale-action` 단계를 제거하고, 호스트의 공인 IP 나 다른 VPN 셋업이 필요해요.

---

### Q6. 정리 후 Mac mini 의 `kamal-proxy` 컨테이너가 사라졌어요. 다음 배포는 또 셋업부터인가요?

**네.** 다음에 `setup.sh` 와 첫 배포를 돌리면 [Kamal](../reference/glossary.md#운영--인프라) 이 셋업(kamal-proxy 컨테이너 + Docker 네트워크)을 자동으로 다시 해요(약 30초).

매번 이 셋업 시간이 부담이라면 `bash tools/dogfooding/cleanup.sh --keep-proxy` 로 컨테이너를 유지할 수 있어요. 대신 메모리 약 15MB, 디스크 약 150MB 가 추가로 쓰여요.

---

### Q7. `.env.dogfood` 를 실수로 commit 하면요?

**즉시 행동하세요.** 순서는 이래요.

1. 가능하면 새 commit 으로 파일을 삭제하고 push 해요.
2. 모든 키를 즉시 폐기하고 재발급해요([`키 교체 절차`](../production/setup/key-rotation.md)). GitHub 히스토리에 남으니 "못 봤겠지" 하고 넘기면 안 돼요 — 이미 노출됐다고 가정하는 게 안전해요.
3. (선택) `git filter-repo` 나 BFG 로 히스토리를 재작성한 뒤 force push 해요.

예방 장치도 세 겹으로 깔려 있어요.

- `.gitignore` 가 `.env.*` 를 잡고 있어요.
- `setup.sh` 는 시작할 때 `git check-ignore` 로 추적 여부를 검증해 실수 가능성을 줄여요.
- pre-commit 훅으로 `.env.dogfood` 패턴을 막아 둘 수도 있어요(선택).

---

### Q8. 도그푸딩으로 띄운 컨테이너가 운영 트래픽도 받을 수 있나요?

**기술적으로는 가능해요.**

- kamal-proxy 가 `Host: server.<도메인>` 헤더로 라우팅해요.
- cloudflared 터널이 연결돼 있으면 외부에서 `https://server.<도메인>` 으로 접근할 수 있어요.

**하지만 도그푸딩의 의도와는 맞지 않아서 권장하지 않아요.**

- DB 와 secret 이 더미나 테스트 값일 수 있어요.
- 도그푸딩은 "한 사이클 검증" 용이에요. 본격 운영은 별도 변수, 별도 도메인, 별도 인프라로 분리하는 걸 권장해요.

---

### Q9. `setup.sh` 가 중간에 실패하면 어디서부터 다시 실행하나요?

**처음부터 그냥 다시 실행해도 돼요.** 멱등 설계라 각 단계가 이렇게 동작해요.

| 단계 | 재실행 시 동작 |
|---|---|
| 사전 요구사항 점검 | 매번 동일하게 다시 확인 |
| GitHub workflow permissions = write | 이미 write 면 아무 일도 안 함 |
| `gha_deploy` 키 | 이미 있으면 건너뜀 |
| Mac mini `authorized_keys` | grep 으로 중복 방지 |
| Variables · Secrets | 매번 덮어쓰기(gh CLI 기본 동작) |

그래서 실패한 단계를 찾아 거기서부터 이어 갈 필요 없이, `bash tools/dogfooding/setup.sh` 를 한 번 더 돌리면 돼요.

---

### Q10. 외부 도메인 없이 localhost 로 검증만 할 수 있나요?

**Tailscale IP 로 가능해요.**

```bash
# 본인 Tailscale 디바이스에서
curl -H "Host: server.<도메인>" http://100.X.X.X/actuator/health/liveness
```

도메인(`PUBLIC_HOSTNAME`)은 자리표시자라도 괜찮아요. kamal-proxy 의 호스트 기반 라우팅에 쓰이므로 `curl` 의 `Host` 헤더와만 일치하면 돼요. 외부 인터넷에서 접근하는 경우에만 cloudflared 가 필요해요.

---

### Q11. 11번 시도했다는데, 다시 셋업하면 또 11번 걸리나요?

**한 번에 끝나요.** 11번의 시도에서 나온 함정 가운데 8개는 워크플로우와 스크립트 코드에 박혀서 영구히 회피되고, 나머지 3개는 외부 발급(PAT, Tailscale OAuth, DB URL 형식)이라 셋업 가이드 §3 에 정확한 절차와 함정 강조가 들어 있어요. 그 뒤에 추가된 JDK 26 함정([`함정 모음 #12`](./dogfood-pitfalls.md))만, 사람이 JDK 21~25 환경을 보장해 주면 돼요.

그래서 가이드를 따라 한 번에 셋업 → 자동 트리거 → 배포 성공으로 이어지는 게 정상 흐름이에요.

> 새로운 함정을 만나면 [`함정 모음`](./dogfood-pitfalls.md) 의 "새 함정 발견 시 추가하는 방법" 절차에 따라 추가 PR 을 올려 주세요.

---

### Q12. 공동 작업자나 fresh clone 받은 두 번째 작업자도 `init-prod.sh` · `init-local.sh` 를 돌려야 하나요? <a id="q12"></a>

**아니에요.** 첫 작업자가 이미 셋업해서 main 에 push 한 레포를 fresh clone 한 두 번째 이상의 작업자는, 운영 secret 을 다시 push 할 필요가 없어요(이미 GitHub Secrets 에 등록돼 있어요).

`./factory init` 은 local 셋업(`init-local.sh`)만 실행해요 — 운영까지 순차로 돌리려면 `./factory all init` 이에요. 어느 쪽이든 그대로 돌리면 **공동 작업자 모드**가 자동으로 감지돼요. 판단 단서는 셋이에요.

1. `settings.gradle` 에 sentinel `template-spring` 매칭이 0이에요(이미 이름이 바뀐 상태).
2. `PROJECT_README_TEMPLATE.md` 가 없어요(이미 README.md 로 교체된 상태).
3. `.env.prod` 가 없어요(이 작업자는 운영 secret 이 필요 없어요).

단서 1·2 만으로 `init-local.sh` 가 rename·README 단계를 건너뛰어요 — 로컬 셋업 판단은 `.env.prod` 유무와 무관해요. 단서 3 은 `init-prod.sh` 만 추가로 봐요. 운영 secret push 를 건너뛸지의 판단이라, `.env.prod` 가 있는 운영자 본인 머신에서는 push 가 정상 진행돼요.

이 모드에서는 `init-prod.sh` 의 운영 셋업 단계(.env.prod 생성, Secrets push, observability 배포, verify-server)와 `init-local.sh` 의 rename · README 교체 단계를 자동으로 건너뛰고, **로컬 환경(.env + docker compose + postgres ready)만 준비해요**.

```bash
# 두 번째 이상의 작업자: REPO 인자 없이 실행 가능
./factory init
```

더 가벼운 흐름을 쓸 수도 있어요.

```bash
cp .env.example .env       # (없으면)
<repo> local start         # docker compose + postgres ready 만
./gradlew :bootstrap:bootRun
```

최초 셋업 흐름을 강제로 다시 돌려야 한다면(운영 secret 을 갈아엎는 경우 등) `--reinit` 을 붙여요.

```bash
./factory init <owner>/<repo> --reinit
# 또는 개별로: bash tools/init-local.sh <owner>/<repo> --reinit
#              bash tools/init-prod.sh  <owner>/<repo> --reinit
```

> `--reinit` 은 운영 secret(`JWT_SECRET` · `DB_PASSWORD` 등)이 무작위 새 값으로 덮어쓰일 수 있어요. 이미 발급된 토큰이 무효화될 수 있으니, 팀과 충분히 협의한 뒤에 쓰세요.

---

### Q13. `verify-server.sh` 의 7단계는 무엇을 검증하나요?

`init-prod.sh` 의 마지막 검증 단계에서 자동으로 호출돼요(단독 실행도 가능해요: `<repo> prod server-test`).

| 단계 | 분류 | 항목 | PASS 의미 |
|---|---|---|---|
| 1 | REQUIRED | backend health (kamal-proxy → `/actuator/health`) | 운영 Spring 컨테이너가 `status:UP` 과 함께 200 OK |
| 2 | REQUIRED | DB 연결 (psql 직접 ping) | `psql` 로 `SELECT 1` 이 응답 — backend 가 죽어 있어도 독립 검증 |
| 3 | OPTIONAL: deploy | SSH + Tailscale (`kamal app version`) | GitHub Actions 에서 Mac mini 까지 Tailscale 도달 OK |
| 4 | OPTIONAL: storage | [MinIO](../reference/glossary.md#운영--인프라) 업로드 (PUT · STAT · DEL) | 스토리지 기능 정상 |
| 5 | OPTIONAL: email | [Resend](../reference/glossary.md#운영--인프라) API 발송 | 이메일 기능 정상 |
| 6 | OPTIONAL: logging | [Loki](../reference/glossary.md#관측성--로깅) readiness | 로깅 기능 정상 |
| 7 | OPTIONAL: alertmanager | [Alertmanager](../reference/glossary.md#관측성--로깅) 컨테이너 Up 확인 | 컨테이너는 떠 있음 — Discord 도착은 기술적으로 검증 불가라, 알람을 수동으로 발생시킨 뒤 채널에서 확인 |

REQUIRED 가 실패하면 즉시 중단해요(운영 backend 가 응답하지 않는 상태). OPTIONAL 이 실패하면 경고만 남기고 계속 진행해요.

**선택 기능의 키가 `.env.prod` 에서 비어 있으면 자동으로 건너뜀(SKIP)으로 처리해요** — 그 기능을 안 쓴다는 뜻으로 보거든요. 예를 들어 `RESEND_API_KEY=` 가 비어 있으면 Step 5 를 건너뛰고 "기능 비활성"으로 취급해요. 그래서 SKIP 은 실패가 아니에요. 활성화하고 싶으면 해당 키들을 `.env.prod` 에 채우고 `init-prod.sh` 를 다시 실행하세요.

기대 결과는 `DEPLOY_ENABLED=true` 이고 모든 선택 기능을 활성화했을 때 **7/7 PASS**(`✅ 운영 가용 상태 — 활성 기능 모두 작동`)예요.

> Step 2 는 backend 를 거치지 않고 `psql` 로 DB 에 직접 접속해요. 그래서 backend 가 부팅에 실패해도 DB 연결 자체는 따로 확인할 수 있어요.

---

### Q14. `init-prod.sh` 의 1회차와 2회차는 어떻게 자동으로 갈리나요? <a id="q14"></a>

`init-prod.sh` 는 별도 플래그 없이 **`.env.prod` 의 상태**만 보고 1·2회차를 멱등하게 나눠요(`init-local.sh` 는 `.env` 만 다루므로 `.env.prod` 와 무관해요).

| 상태 | 판정 | 동작 |
|---|---|---|
| `.env.prod` 없음 | 1회차 (또는 공동 작업자) | Step 5 에서 `.env.prod` 생성 + `JWT_SECRET` 자동 발급. 단, 이름 변경이 끝났고 `PROJECT_README_TEMPLATE.md` 가 없으면 공동 작업자로 감지해 Step 5 도 건너뜀 ([Q12](#q12) 참고) |
| `.env.prod` 있음 + 사용자 입력 값 비어 있음 | 1회차 직후 (사용자가 채우는 중) | Step 6 에서 안내만 출력하고 종료(이후 단계로 진행 안 함) |
| `.env.prod` 있음 + 사용자 입력 값 채워짐 | 2회차 | Step 6 에서 GitHub Secrets · Variables push → 이후 검증 단계까지 진행 |

판정에 쓰이는 값은 이래요.

- **사용자가 직접 채워야 하는 값** — `BASE_DOMAIN` · `SUBDOMAIN`(이 둘로 `APP_DOMAIN` · `PUBLIC_HOSTNAME` 자동 합성), `DB_URL`, `DB_USER`, `DB_PASSWORD`, `GHCR_TOKEN`, `DEPLOY_HOST`, `DEPLOY_SSH_USER`, `SSH_PRIVATE_KEY` 예요. 운영 배포를 켤 거라면 `CLOUDFLARE_API_TOKEN` 과 Tailscale OAuth 값도 채워요.
- **자동으로 발급되는 값** — `JWT_SECRET`, `KAMAL_SERVICE_NAME`, `DEPLOY_ENABLED`(기본 `false`), `GHCR_USERNAME`, `KAMAL_IMAGE`, Cloudflare ID, PortOne webhook secret 은 `init-prod.sh` 가 채워요. `DB_PASSWORD` 는 **자동 발급이 아니에요** — 외부 DB(Supabase 등)가 발급한 비밀번호를 사용자가 직접 입력해야 해요(Spring 자동 접속과 SSH 수동 접속이 같은 값을 써야 하거든요).
- **멱등 보장** — `.env`(init-local)와 `.env.prod`(init-prod) 모두 "이미 있으면 건너뜀"으로 동작하고, `gh secret set` 은 덮어쓰기, husky 훅도 이미 활성화돼 있으면 건너뛰어요.

그래서 같은 명령을 여러 번 안전하게 다시 실행할 수 있어요. 잘못된 값으로 secret 을 push 했다면, `.env.prod` 의 해당 키만 고친 뒤 다시 돌리면 그 키만 덮어써요.

---

### Q15. `RESEND_TEST_ADMIN_USER_EMAIL` 은 왜 `init-prod.sh` 카탈로그에 없나요? <a id="q15"></a>

이 키는 **운영 배포 자동화에는 필요 없는** 검증 전용이에요. `verify-server.sh` Step 5(이메일 발송)가 Resend API 로 테스트 메일을 보낼 *수신자* 로만 쓰여요.

| 키 | 용도 | init-prod.sh 카탈로그 | GitHub Secrets push |
|---|---|---|---|
| `RESEND_API_KEY` | 운영 발송 + 검증 | 포함 (email 기능) | 함 |
| `RESEND_FROM_ADDRESS` | 운영 발송 + 검증 | 포함 (email 기능) | 함 |
| `RESEND_FROM_NAME` | 운영 발송 | 포함 (email 기능) | 함 |
| `RESEND_TEST_ADMIN_USER_EMAIL` | `verify-server.sh` 검증만 | 제외 (의도된 제외) | 안 함 |

`verify-server.sh` 를 운영 환경에서 SSH 로 실행할 때 `.env.prod` 를 직접 읽으므로, GitHub Secrets 에 push 할 필요가 없어요. 비어 있으면 Step 5 를 자동으로 건너뛰고, 운영 동작에는 영향이 없어요.

채우려면 `.env.prod` 에 본인 이메일을 직접 적어요(Secrets push 는 일어나지 않아요).

---

### Q16. 원본 `template-spring` 자체를 clone 받으면 어떻게 동작하나요? <a id="q16"></a>

템플릿 개발자가 원본 `storkspear/template-spring` 레포를 그대로 clone 받아 `./factory all init`(= `init-local.sh` → `init-prod.sh` 순차)를 돌리면, **공동 작업자 모드가 아니라 1회차 모드**로 들어가요 — 의도된 동작이에요.

| 검사 항목 | 원본 template-spring | 파생 레포 fresh clone |
|---|---|---|
| `settings.gradle` 의 sentinel `template-spring` 매칭 | 있음 (rename 안 됨) → 1회차 후보 | 없음 (rename 완료) → 공동 작업자 후보 |
| `PROJECT_README_TEMPLATE.md` 부재 | 아님 (파일 있음) → 1회차 후보 | 맞음 (이미 삭제됨) → 공동 작업자 후보 |
| `.env.prod` 부재 | 맞음 → 1회차 후보 | 맞음 → 공동 작업자 후보 |
| 결과 | 1회차 모드 | 공동 작업자 모드 |

그래서 원본 레포를 clone 받으면 `./factory init <test-org>/<test-repo>` 처럼 REPO 인자가 필요하고, 실행하면 `settings.gradle` 등이 `<test-repo>` 이름으로 바뀌어요. 즉 *원본을 이름만 바꿔 시험하는* 흐름이에요. 시험이 끝나면 변경을 commit 하지 말고 `git restore .` 로 되돌리면 돼요.

이 동작을 강제로 막고 싶으면 `--reinit` 없이 `bash tools/init-prod.sh`(REPO 인자 없이)를 시도해요. 인자 누락으로 사용법이 출력되면서, 의도치 않은 rename 을 방지할 수 있어요.

---

### Q17. `APP_CREDENTIALS_<SLUG>_*` 를 `.env.prod` 에 추가하면 운영에 자동 반영되나요? <a id="q17"></a>

**아니에요. `init-prod.sh` 는 GitHub Secrets push 까지만 자동이고**, 운영 컨테이너로 주입하는 부분은 아직 *수동 작업* 이에요.

| 흐름 | 자동 / 수동 | 위치 |
|---|---|---|
| `.env.prod` 에 `APP_CREDENTIALS_<SLUG>_GOOGLE_CLIENT_IDS_0` 등 추가 | 수동 | 사용자 |
| `init-prod.sh` 2회차 실행 시 정규식으로 자동 발견 + GitHub Secrets push | 자동 | init-prod.sh |
| `config/deploy.yml` 의 `env.secret` 목록에 같은 키 추가 | 수동 | 파생 레포 |
| `.kamal/secrets.example` 에 같은 키 매핑 추가 | 수동 | 파생 레포 |
| Kamal 이 컨테이너에 주입 → Spring relaxed binding 으로 `app.credentials.<slug>.google-client-ids[0]` 으로 받음 | 자동 | Spring |

GitHub Secrets 에 push 됐다고 해서 운영에서 바로 동작하는 건 아니에요. `config/deploy.yml` 과 `.kamal/secrets` 의 `env.secret` 목록에 같은 키를 명시해야, Kamal 이 그 값을 환경변수로 컨테이너에 전달해요. 이 [4단계 secret 체인](../reference/glossary.md#이-레포-고유-용어)의 자세한 체크리스트는 [`secret chain 4-stage 통합 가이드`](../production/setup/secret-chain-4stage.md) 에서 볼 수 있어요.

두 파일은 **파생 레포가 직접 추가**해야 해요(템플릿의 두 파일에 "Phase 2 자동 추가 예정"이라는 주석이 있지만, 현재는 미구현이에요). 새 앱 모듈을 `tools/new-app/new-app.sh <slug>` 로 추가한 뒤 다음 두 파일을 손봐요.

```yaml
# config/deploy.yml 의 env.secret 끝에 추가
- APP_CREDENTIALS_GYMLOG_GOOGLE_CLIENT_IDS_0
- APP_CREDENTIALS_GYMLOG_APPLE_BUNDLE_ID
- APP_CREDENTIALS_GYMLOG_KAKAO_APP_ID
- APP_CREDENTIALS_GYMLOG_NAVER_CLIENT_ID
```

```bash
# .kamal/secrets 에도 같은 매핑 추가 ($VAR 는 GitHub Actions env 에서 resolve)
APP_CREDENTIALS_GYMLOG_GOOGLE_CLIENT_IDS_0=$APP_CREDENTIALS_GYMLOG_GOOGLE_CLIENT_IDS_0
APP_CREDENTIALS_GYMLOG_APPLE_BUNDLE_ID=$APP_CREDENTIALS_GYMLOG_APPLE_BUNDLE_ID
# Kakao / Naver 도 동일
```

마지막으로 `.github/workflows/deploy.yml` 의 env 블록에도 같은 키를 `${{ secrets.APP_CREDENTIALS_<SLUG>_* }}` 형태로 내보내야, GitHub Actions 런타임에 노출돼요(Phase 2 자동화가 들어오기 전까지는요).

---

## 더 궁금한 게 있다면

- [`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md) — 정상 흐름
- [`도그푸딩 walkthrough`](./dogfood-walkthrough.md) — 시간 순 이야기 + 정착된 패턴
- [`도그푸딩 함정 모음 (사고 실록)`](./dogfood-pitfalls.md) — 함정 15개 자세히 (11번 시도 + JDK 26 호환성 1건 + 운영 함정 3건)
- [`secret chain 4-stage 통합 가이드`](../production/setup/secret-chain-4stage.md) — 4곳 매핑 + 체크리스트
- [`CI / CD 전체 플로우 — commit 부터 운영 반영까지`](../production/deploy/ci-cd-flow.md) — 다이어그램
- [`키 교체 절차 (Key Rotation)`](../production/setup/key-rotation.md) — 키 교체
- [`인프라 결정 기록 (Decisions — Infrastructure)`](../production/deploy/decisions-infra.md) — 결정 근거 (I-09 ~ I-14)

---

## 다음 단계

- 함정 사례 검색: [`도그푸딩 함정 모음 (사고 실록)`](./dogfood-pitfalls.md) — 실제 겪은 함정 15개 기록
- 시간 순 흐름: [`도그푸딩 walkthrough`](./dogfood-walkthrough.md)
- 본 가이드 전체: [`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md)
