# 도그푸딩 walkthrough — 사이클 흐름과 정착된 패턴

> **유형**: How-to · **독자**: Level 1 · **읽는 시간**: ~20분

> 정상 흐름 (step-by-step): [`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md)
> 함정 reference (12개 정리): [`도그푸딩 함정 모음`](./dogfood-pitfalls.md)
> 자주 묻는 질문: [`도그푸딩 FAQ`](./dogfood-faq.md)

---

## 이 가이드가 다루는 것

도그푸딩 사이클에서 사용자가 *실제로 겪었던 흐름* 을 시간 순으로 풀어 쓴 가이드예요. "어떤 셋업을 어떤 순서로 해야 하는가" 보다는 **"어떤 함정을 만나면 어떤 패턴으로 정착되었는가"** 에 초점을 맞췄어요.

각 함정의 *상세한 에러 메시지 / 원인 / 해결* 은 [`dogfood-pitfalls.md`](./dogfood-pitfalls.md) 에 정리되어 있어요. 본 walkthrough 는 *왜 이런 패턴이 정착됐는지* 의 서사를 보여드리고, 자세한 reference 가 필요할 때마다 해당 문서로 안내해드려요.

---

## 1. 도그푸딩이 뭐예요?

도그푸딩은 *template 자기 자신을* Mac mini 에 배포해서 한 사이클 검증하는 일이에요. "Use this template" 으로 만든 새 파생 레포에서도 같은 검증을 합니다.

**왜 필요한가요?**
- template 의 자동화 코드 (`tools/init-prod.sh` / `init-local.sh` / `init-dev.sh` 등) 는 그대로 복사돼요. 하지만 GitHub Settings (Variables/Secrets) / Mac mini SSH 키 / GHCR 패키지는 파생 레포가 *직접 셋업* 해야 해요.
- 첫 실배포 전에 도그푸딩으로 한 번 검증하면, 실제 사용자 트래픽이 들어오기 전에 모든 함정을 잡을 수 있어요.

설계 근거는 [`ADR-002 (Use this template)`](../philosophy/adr-002-use-this-template.md) 에 정리되어 있어요.

---

## 2. 사이클의 큰 그림

도그푸딩은 두 단계로 나뉘어요.

| 단계 | 대상 | 시점 | 함정 분포 |
|---|---|---|---|
| **1회차** | template-spring 자체 | template 첫 배포 | 12 함정 (pitfalls.md `#1~#12`) |
| **2회차** | "Use this template" 파생 레포 | 파생 레포의 첫 셋업 | 별도 함정군 (이번 walkthrough 의 §4) |

1회차 함정들은 대부분 *자동화 코드 자체* 에 박혀서 회피돼요. 그래서 2회차 (파생 레포) 에서는 1회차 함정을 거의 만나지 않아요. 대신 **2회차만의 함정** — 파생 레포가 자기 secret 을 *처음 채울 때* 발생하는 문제 — 가 등장해요.

본 walkthrough 는 주로 *2회차의 흐름과 함정* 에 집중해요.

---

## 3. 1회차 — template 자체 도그푸딩

이 단계는 [`도그푸딩 함정 모음 #1~#12`](./dogfood-pitfalls.md) 에 자세히 정리되어 있어요. 핵심만 짚고 넘어갈게요.

**대표 함정 3가지** (자세한 내용은 위 링크):

- **`#7` GHCR push 권한 (PAT 발급)** — `GITHUB_TOKEN` 만으로는 첫 GHCR 패키지 생성 권한이 부족해서 PAT 가 따로 필요해요.
- **`#11` JDBC URL 형식** — Supabase 가 보여주는 connection string 을 그대로 복사하면 `jdbc:` prefix 가 빠져 있어 "No suitable driver" 가 나요.
- **`#12` JDK 26 호환성** — Gradle 의 Groovy 가 class file major 70 (JDK 26) 을 못 읽어서 빌드 자체가 안 돼요. JDK 21 LTS 권장.

이 12 함정의 결과로 *자동화 가드* 들이 박혔어요:
- `init-prod.sh` / `init-local.sh` Step 1 의 prereq 검증 (Java 21~25, gh 설치, ssh-keygen 등 — `lib/init-common.sh` 의 `_validate_prereqs`)
- `tools/dogfooding/setup.sh` 의 `DB_URL` 형식 정규식 체크
- `deploy.yml` 의 `provenance: false` / `sbom: false`
- 그 외 여러 *defensive default*

이 가드들 덕분에 2회차 (파생 레포) 에서는 1회차 함정을 거의 만나지 않아요.

---

## 4. 2회차 — 파생 레포에서 만나는 함정

여기부터가 walkthrough 의 본격적인 부분이에요. 파생 레포에서 *처음으로* 발견된 함정들과, 그것이 어떻게 영구 패턴으로 정착됐는지를 시간 순으로 풀어 드려요.

### 4.1 첫 push 가 빨갛게 — `GHCR_TOKEN` 미등록

파생 레포를 만들고 코드를 한 번 push 했는데 GHA 의 `sync-docs` workflow 가 빨갛게 떠요. 며칠치 push 가 모두 같은 에러로 실패해 있는 상태로 발견됐어요.

**왜 발생했나요?**
- `sync-docs.yml` 이 docs 변경분을 `docs-template-spring` 레포로 자동 PR 보내는데, 이 동작에 GHCR / cross-repo 권한이 필요해요.
- 파생 레포의 GitHub Settings 에 `GHCR_TOKEN` secret 이 *등록되지 않은* 상태였어요.
- `GHCR_TOKEN` 자체는 1회차 (template-spring) 에서도 PAT 로 발급해서 등록했지만, 파생 레포는 *별개의 GitHub repo* 라 secret 이 자동 상속되지 않아요.

**무엇이 정착됐나요?**
- 파생 레포의 secret 등록은 *4-stage chain* 의 마지막 stage (GHA workflow `env:` 블록) 와 직접 연결돼요. 본문 `${{ secrets.X }}` 가 등록되지 않은 secret 을 참조하면 빈 문자열이 되고, workflow 가 어느 step 에서 silently fail 해요.
- *모든 secret 은 4-stage 모두에 등록됐는지 확인해야 함* — 이 원칙이 [`secret chain 4-stage 통합 가이드`](../production/setup/secret-chain-4stage.md) 의 canonical 위치에서 명문화됐어요.
- `init-prod.sh` 가 8개의 REQUIRED secret 을 push 하지만, *그 외에도 GHA workflow 가 의존하는 secret* 이 빠져 있을 수 있어 운영자가 명시적으로 점검해야 해요.

### 4.2 결제 모듈이 부팅을 막는다 — PortOne 더미값 함정

파생 레포의 `.env.prod` 를 채울 때, 결제를 사용하지 않는 앱이라 `APP_PAYMENT_PORTONE_*` 키들을 비워뒀어요. 그런데 prod profile 부팅이 *부팅 자체가 거부* 되는 현상이 발생했어요.

**왜 발생했나요?**
- 슬러그 컨트롤러는 `PaymentPort` 를 필수 의존으로 받아요 ([`adr-019-billing-iap-payment-separation.md`](../philosophy/adr-019-billing-iap-payment-separation.md) 의 결정 — IAP / PG / Billing 분리).
- prod profile 에서는 `PortOneProdConfigGuard` (실 파일 위치: `core/core-payment-impl/src/main/java/com/factory/core/payment/impl/PaymentAutoConfiguration.java`) 가 부팅 시 *PortOne v1 키 + secret + webhook secret* 의 존재를 검증해요.
- 빈 값이거나 `CHANGE_ME` 같은 placeholder 면 부팅이 즉시 차단돼요.

**무엇이 정착됐나요?**
- *결제 미사용 앱이라도 어떤 값이든 채워야 함* — 이 원칙이 [`dogfood-setup.md §5`](./dogfood-setup.md) 에 안내됐어요.
- `StubPaymentAdapter` 가 graceful 503 응답 패턴으로 통일됐어요. 같은 시점에 `StubIapAdapter` 와 패턴을 일관시켜서, 결제 미설정 환경에서도 *서버는 부팅하고 결제 API 만 503* 으로 응답해요.
- 이 패턴은 commit `c982a84` (`fix(payment): StubPaymentAdapter graceful 503 으로 IAP 와 일관성 맞춤`) 에서 정착됐어요.

### 4.3 Cloudflare 가 옛 NXDOMAIN 을 캐싱한다 — NS internal cache

`prod force-clear` 로 인프라를 깨끗이 정리한 후 다시 `prod init` 으로 등록했더니, Cloudflare DNS 가 *예전 NXDOMAIN 을 계속 캐싱* 해서 새 DNS record 가 외부에서 보이지 않았어요.

**왜 발생했나요?**
- Cloudflare 의 internal NS server 가 한 번 NXDOMAIN 을 응답하면 일정 시간 캐싱해요 (TTL 무관).
- 도메인이 빠르게 삭제·재생성되는 force-clear → init 흐름에서, NS 가 옛 응답을 기억하면 새 record 가 *propagation 되지 않은 것처럼* 보여요.

**무엇이 정착됐나요?**
- `tools/lib/cloudflare.sh` 의 `cloudflare_register_hostname` 함수가 *NS propagation polling + 자동 record 재생성* 패턴으로 보강됐어요 (commit `988bf47`).
- record 등록 후 1~2분 polling 하면서 외부 NS 가 새 값을 응답할 때까지 대기하고, 일정 시간 안에 안 보이면 *record 를 한 번 삭제 후 재생성* 해서 강제로 propagation 을 트리거해요.
- 이 동작은 `prod init` 의 1회차에서 NS 경고가 출력되는 형태로 사용자에게도 노출돼요 ("⚠ NS propagation pending — polling 중...").

### 4.4 multi-app 추가 후 secret chain 갭 — `APP_FLYWAY_MODE`

파생 레포에 두 번째 슬러그를 추가하고 deploy 했는데, Flyway 가 `Schema "core" doesn't exist yet` 에러로 부팅 차단됐어요.

**왜 발생했나요?**
- `APP_FLYWAY_MODE` 환경변수가 4-stage chain 중 *한 곳에서* 누락된 상태였어요.
- 사용자가 `.env.prod` 에 `APP_FLYWAY_MODE=AUTO` 를 명시했지만, `config/deploy.yml` 의 `env.secret:` 리스트 / `.kamal/secrets.example` / GHA `env:` 블록 중 한 단계에서 wire 되지 않으면, 컨테이너 안에서 빈 값으로 fallback 돼요.
- `application-prod.yml` 의 default 인 `VALIDATE_ONLY` 로 fallback 하면 *빈 schema 에서 부팅 fail* 이 발생해요 ([`ADR-033 Flyway Hybrid`](../philosophy/adr-033-flyway-hybrid-policy.md)).

**무엇이 정착됐나요?**
- `APP_FLYWAY_MODE` 가 4-stage chain 모두에 wire 됐어요 (commit `5a04206`).
- 그리고 *`.env.prod.example` 의 default 값* 이 빈 문자열에서 `AUTO` 로 변경됐어요. `init-prod.sh` 가 이 example 을 그대로 복사해서 `.env.prod` 를 만들기 때문에, 사용자가 명시적으로 안 채워도 첫 deploy 가 부팅 fail 하지 않아요.
- 이 함정의 일반화된 교훈 — *모든 새 env 변수는 4-stage 동시 등록* — 이 [`secret-chain-4stage.md`](../production/setup/secret-chain-4stage.md) 의 체크리스트에 명문화됐어요.

### 4.5 alias 'test' 가 bash builtin 과 충돌

`./factory install test` 로 alias 를 등록했더니 `test` 명령을 실행할 때 의도와 다른 동작이 나왔어요. 이유 — `test` 가 *bash built-in 명령* 이거든요.

**왜 발생했나요?**
- bash 에는 `test`, `time`, `if`, `for` 같은 keyword / built-in 들이 있어요. 사용자가 같은 이름으로 PATH alias 를 만들어도 shell 이 built-in 을 우선 해석해서 alias 가 invoke 되지 않아요.
- `factory install` 이 alias 이름의 *충돌 여부를 사전 검증하지 않은* 상태였어요.

**무엇이 정착됐나요?**
- 임시 회피로 사용자가 alias 를 `stest` 로 재등록해서 진행했어요.
- 영구 fix 는 backlog 에 등록됐어요 — `factory install` 이 `command -v <name>` 또는 bash `type -t <name>` 으로 사전 검증하고, built-in / reserved word 면 차단·경고 (commit `1f24fb9`).

### 4.6 placeholder `<repo-name>` 이 그대로 출력 — alias 감지 실패

`factory new-app <slug>` 끝의 안내 문구에서 `<repo-name>` placeholder 가 *그대로 노출* 됐어요. 또 다른 alias 로 호출했는데도 첫 alias 이름만 사용되는 현상도 있었어요.

**왜 발생했나요?**
- placeholder 치환은 *factory wrapper 의 alias 이름* 을 알아야 해요. **대안 — `~/.local/bin/*` symlink reverse-lookup** 의 한계: 같은 factory 에 *여러 alias* 가 등록되면 alphabetical first 만 매치돼서 *현재 사용자가 invoke 한 alias* 와 다를 수 있어요.

**무엇이 정착됐나요?**
- `factory` wrapper 가 시작 시 `export FACTORY_ALIAS="$(basename "$0")"` 를 실행해요 (commit `e822736`).
- 자식 프로세스 (`new-app.sh`, `init-prod.sh`, `init-local.sh`) 는 `$FACTORY_ALIAS` 환경변수를 우선 읽고, 없으면 symlink 리버스 lookup 으로 fallback 해요. 이 helper 가 `tools/lib/common.sh` 의 `detect_factory_alias()` 로 정착했어요.
- 동시에 `<repo-name>` placeholder 가 출력될 때 ANSI 컬러 (red bold border + yellow bg highlight) 로 *시각적 강조* 처리도 추가됐어요 (commit `16e50de`).

### 4.7 `init-prod.sh` partial-fail 의 인지성

`init-prod.sh` (당시엔 `init-server.sh`) 실행이 line 559 부근에서 명령 not found 에러를 출력했는데, 그 다음 단계에서 "[OK] 등록 완료" 가 출력되고 정상 종료처럼 보였어요. 사용자가 정상 완료로 인식했지만, 사실 8 개 REQUIRED secret 중 7 개만 push 되고 1 개가 누락된 상태였어요.

**왜 발생했나요?**
- `init-prod.sh` 가 부분 실패 (partial fail) 시에도 *그대로 다음 step 으로 진행* 하는 구조예요.
- Step 6 의 "[OK] 등록 완료" 는 *해당 step 만의* 성공 메시지인데, 사용자 관점에선 *전체 init 의 종료 메시지* 로 보였어요.
- Step 9.5 / 10 같은 후속 step 이 silently skip 됐어요.

**무엇이 정착됐나요?**
- 영구 fix 는 backlog 에 등록됐어요 (commit `254fb30`):
  - 부분 실패 시 명시적 SUMMARY 출력 (성공 N개 / 실패 M개 / skip K개)
  - 사용자가 init 종료 후 한눈에 "어디까지 됐고 어디부터 다시 해야 하는지" 파악 가능
  - 가능하면 fail-fast 모드 (`--strict`) 옵션 추가
- 임시 대응은 사용자가 init 종료 후 `gh secret list -R <repo>` 로 직접 확인하는 방식이에요.

### 4.8 `sync-docs` 가 2일치 모든 push 에서 실패

위 §4.1 에서 GHCR_TOKEN 미등록 함정이 발견되기 전에, 사용자가 며칠 동안 *모든 push 가 빨갛게* 뜨는 상태로 작업하고 있었어요. 빨간 mark 의 워크플로우 이름은 `sync-docs` 였어요.

**왜 발생했나요?**
- `sync-docs.yml` 이 docs/ 변경분을 `docs-template-spring` 레포로 PR 보내는데, 이 cross-repo 동작에 PAT 가 필요해요.
- 이 PAT 는 secret 이름 `GHCR_TOKEN` 으로 같이 사용돼요 (이름이 GHCR 인 이유는 *주 용도* 가 GHCR push 라서).
- ci-test 5-stage (spotless / build / docs-contract / docs-unit / gitleaks) 는 *content* 를 검증하지만, *workflow YAML 자체의 runtime 의존성 (등록 안 된 secret 참조 등)* 은 검증하지 않아요.

**무엇이 정착됐나요?**
- 사용자가 `gh secret set GHCR_TOKEN -R <repo>` 로 등록 후 정상화했어요.
- backlog 에 *actionlint 통합* 항목이 등록됐어요 (commit `d1baf27`):
  - actionlint 는 GitHub Actions workflow 의 정적 검증 도구
  - `.github/workflows/*.yml` 의 YAML 구문 / 잘못된 action 버전 / job dependency 누락 등 catch
  - 단, *secret 부재* 같은 runtime 에러는 actionlint 도 못 잡아요. 그건 *워크플로우 시작 시 token 존재 검증 + graceful skip* 같은 별개 보강이 필요해요.

---

## 5. 정착된 패턴 — 한 곳에 정리

위 함정들이 어떤 영구 패턴으로 정착됐는지를 한눈에 봐요.

| 패턴 | canonical 문서 / 코드 |
|---|---|
| **secret chain 4-stage** | [`secret-chain-4stage.md`](../production/setup/secret-chain-4stage.md) — 4 곳 매핑 + 체크리스트 |
| **deploy.sh = origin/main SHA 기준** | [`runbook.md §평시배포`](../production/deploy/runbook.md) — 로컬 working tree / HEAD 무관 |
| **`@Profile("!test")` 슬러그 모듈** | `apps/app-*/.../*AppAutoConfiguration.java` + `*DataSourceConfig.java` — bootstrap test 에서 비활성 |
| **`AbstractAppDataSourceConfig.deriveSlugUrl`** | `common/common-persistence/.../AbstractAppDataSourceConfig.java` — `<SLUG>_DB_URL` 비우면 `${DB_URL}` 의 currentSchema 만 슬러그로 자동 교체 |
| **`BucketProvisioner` idempotent** | `core/core-storage-impl/.../BucketProvisioner.java` — `APP_STORAGE_MINIO_BUCKETS_*` 부팅 자동 생성 |
| **force-clear 5단계 confirm** | [`runbook.md`](../production/deploy/runbook.md), [`cli-guide.md`](./cli-guide.md) — DB / Storage / 관측성 / 백업 / 최종 |
| **Stub 503 graceful (IAP / Payment 동일)** | `core/core-iap-impl/.../impl/StubIapAdapter.java` + `core/core-payment-impl/.../impl/StubPaymentAdapter.java` |
| **`PortOneProdConfigGuard` 부팅 검증** | `core/core-payment-impl/.../impl/PaymentAutoConfiguration.java` — prod profile 의 v1 키 + webhook secret 필수 |
| **factory wrapper alias 감지** | `factory:87` (`export FACTORY_ALIAS=$(basename "$0")`) + `tools/lib/common.sh:136` `detect_factory_alias()` |
| **Cloudflare NS polling** | `tools/lib/cloudflare.sh:115` `cloudflare_register_hostname` — propagation 검증 + 자동 record 재생성 |
| **`APP_FLYWAY_MODE` default = AUTO** | `.env.prod.example` — 빈 schema 첫 deploy 시 부팅 fail 방지 |

---

## 6. 다음 단계

- *처음 도그푸딩을 진행하실 때*: [`도그푸딩 환경 셋업 가이드 (정상 흐름)`](./dogfood-setup.md)
- *에러 만났을 때 검색용 reference*: [`도그푸딩 함정 모음`](./dogfood-pitfalls.md)
- *자주 묻는 질문*: [`도그푸딩 FAQ`](./dogfood-faq.md)
- *4-stage secret chain 체크리스트*: [`secret-chain-4stage.md`](../production/setup/secret-chain-4stage.md)
- *전체 CI/CD 플로우 다이어그램*: [`CI / CD 전체 플로우`](../production/deploy/ci-cd-flow.md)

---

## 관련 문서

- [`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md) — step-by-step 정상 흐름
- [`도그푸딩 함정 모음`](./dogfood-pitfalls.md) — 12 함정 reference (1회차 위주)
- [`도그푸딩 FAQ`](./dogfood-faq.md) — Q&A 형식
- [`secret chain 4-stage 통합 가이드`](../production/setup/secret-chain-4stage.md) — 4 곳 매핑 표
- [`인프라 결정 기록 (Decisions — Infrastructure)`](../production/deploy/decisions-infra.md) — I-09 ~ I-14 (왜 이 결정을)
- [`ADR-002 — Use this template`](../philosophy/adr-002-use-this-template.md) — 도그푸딩의 설계 근거
- [`ADR-019 — billing / IAP / payment 분리`](../philosophy/adr-019-billing-iap-payment-separation.md) — 결제 도메인 분리 결정
- [`ADR-033 — Flyway Hybrid 정책`](../philosophy/adr-033-flyway-hybrid-policy.md) — `APP_FLYWAY_MODE` 의 결정 근거
