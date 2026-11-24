<a id="도그푸딩-walkthrough--사이클-흐름과-정착된-패턴"></a>

# 도그푸딩 walkthrough — 사이클 흐름과 정착된 패턴

> **유형**: How-to · **독자**: Level 1 · **읽는 시간**: ~20분

이 문서는 도그푸딩을 시간 순으로 따라가는 이야기예요. 막힌 자리를 어떻게 빠져나왔는지, 그래서 어떤 안전장치가 코드에 영구히 박혔는지를 한 흐름으로 읽어 내려가요.

함께 보면 좋은 문서가 둘 있어요.

- 정상 흐름을 단계별로 따라가고 싶을 때: [`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md)
- 특정 에러로 검색해서 찾아볼 때: [`도그푸딩 함정 모음`](./dogfood-pitfalls.md) · [`도그푸딩 FAQ`](dogfood-setup.md)

---

## 이 가이드가 다루는 것

이 문서는 템플릿과 파생 저장소를 처음 배포하던 당시의 사건을 시간순으로 정리한 기록이에요. 아래 커밋과 조치는 당시 맥락으로 읽고, 현재 설정 절차는 [셋업 가이드](./dogfood-setup.md)를 따라가세요.

증상별 대응은 [함정 모음](./dogfood-pitfalls.md)에 모았어요. 여기서는 문제가 발견된 흐름과 그 결과 추가한 자동화를 설명해요.

---

## 1. 도그푸딩이 뭐예요?

당시에는 템플릿 자체의 배포부터 검증했고, 이후 파생 저장소의 첫 설정을 확인했어요. 현재 원본 `template-spring`은 공통 코드 유지보수용이며 원격 배포 가드가 적용돼요. 배포 검증은 별도 파생 저장소에서 진행해요.

왜 필요할까요? 템플릿의 자동화 코드는 파생 레포로 그대로 복사돼요. `tools/init/init-prod.sh`, `tools/init/init-local.sh`, `tools/init/init-dev.sh` 같은 스크립트가 한 글자도 빠짐없이 따라가요. 하지만 자동화가 건드리지 못하는 자리가 있어요. GitHub Settings 의 Variables 와 Secrets, Mac mini 의 SSH 키, [GHCR](../reference/glossary.md#ci--배포-파이프라인) 패키지는 파생 레포가 직접 셋업해야 합니다. 첫 실배포 전에 도그푸딩으로 한 바퀴 돌려 두면, 실제 사용자 트래픽이 들어오기 전에 이 함정들을 미리 잡을 수 있어요.

설계 근거는 [`ADR-002 · Use this template`](../philosophy/adr-002-use-this-template.md) 에 정리돼 있어요.

---

## 2. 사이클의 큰 그림

당시 검증은 다음 두 단계로 진행했어요. 이 구분은 `init-prod.sh`를 설정 상태에 따라 다시 실행하는 1·2회차와는 달라요.

| 회차 | 대상 | 시점 | 함정 분포 |
|---|---|---|---|
| **1회차** | `template-spring` 자체 | 템플릿 첫 배포 | 12 함정 ([`pitfalls.md`](./dogfood-pitfalls.md) `#1~#12`) |
| **2회차** | "Use this template" 파생 레포 | 파생 레포의 첫 셋업 | 별도 함정군 (이 walkthrough §4) |

첫 단계에서 찾은 문제는 사전 검사와 설정 가드에 반영했어요. 파생 저장소에서는 새 Secrets와 외부 자격을 등록하는 과정에서 추가 문제가 발견됐어요.

이 walkthrough 는 주로 2회차의 흐름과 함정에 집중합니다.

---

<a id="3-1회차--template-자체-도그푸딩"></a>

## 3. 1회차 — template 자체 도그푸딩

이 회차는 [`도그푸딩 함정 모음`](./dogfood-pitfalls.md) 의 `#1~#12` 에 자세히 정리돼 있어요. 여기서는 핵심만 짚고 넘어갈게요. 대표 함정 세 가지만 골라 보면 이래요.

- **`#7` GHCR push 권한** — 당시 push 실패를 PAT 사용으로 해결했어요. `GITHUB_TOKEN`도 적절한 job 권한과 패키지 접근 권한이 있으면 업로드에 사용할 수 있어요. 현재 템플릿의 PAT 경로와 당시 시도는 [GHCR 사례](./dogfood-pitfalls.md#ghcr-auth)를 참고하세요.
- **`#11` JDBC URL 형식** — [Supabase](../reference/glossary.md#데이터베이스) 가 보여주는 connection string 을 그대로 복사하면 `jdbc:` 접두사가 빠져 있어 "No suitable driver" 에러가 납니다.
- **`#12` JDK 26 호환성** — Gradle 의 Groovy 가 class file major 70(JDK 26)을 읽지 못해 빌드 자체가 막힙니다. JDK 21 LTS 를 권장해요.

이 12 함정의 결과로 여러 자동화 가드가 코드에 박혔어요.

- `init-prod.sh` 와 `init-local.sh` 의 첫 단계에서 prereq 를 검증합니다. Java 21~25 범위, gh 설치 여부, ssh-keygen 존재 등을 `tools/lib/init-common.sh` 의 `_validate_prereqs` 가 점검해요.
- `tools/dogfooding/setup.sh` 가 `DB_URL` 이 `jdbc:postgresql://` 로 시작하는지 정규식으로 확인합니다.
- `deploy.yml` 의 docker build 단계에 `provenance: false` 와 `sbom: false` 를 박았습니다.

이후 파생 저장소에서도 같은 사전 검사를 실행해요. 환경별 자격과 외부 연결은 파생 저장소에서 따로 준비해야 해요.

---

<a id="4-2회차--파생-레포에서-만나는-함정"></a>

## 4. 2회차 — 파생 레포에서 만나는 함정

여기부터가 walkthrough 의 본론이에요. 파생 레포에서 처음으로 발견된 함정들과, 그것이 어떻게 영구 패턴으로 정착됐는지를 시간 순으로 풀어 드려요.

<a id="41-첫-push-가-빨갛게--ghcr_token-미등록"></a>

### 4.1 첫 push 가 빨갛게 — `GHCR_TOKEN` 미등록

당시 파생 저장소에서 며칠 동안 `sync-docs` 워크플로가 실패했고, 공개 문서 저장소에 접근하는 `GHCR_TOKEN`이 빠진 것을 뒤늦게 확인했어요. 원본 저장소에 등록한 Secrets는 파생 저장소로 상속되지 않기 때문에 별도 등록이 필요했어요.

당시에는 `gh secret set GHCR_TOKEN -R <repo>`로 토큰을 등록해 정상화했어요. 현재 `sync-docs.yml`의 job은 `github.repository == 'storkspear/template-spring'` 조건으로 원본에서만 실행해요. 따라서 현재 파생 저장소에 문서 동기화용 토큰을 추가하라는 절차로 읽지는 않아요. 원본의 동기화는 `GHCR_TOKEN`으로 공개 미러를 갱신하고 PR을 만든 뒤 squash merge해요.

이 사건에서 확인한 것은 자격이 필요한 각 전달 지점을 함께 점검해야 한다는 점이에요. 워크플로의 `${{ secrets.X }}`가 등록되지 않은 값을 참조하면 빈 문자열이 될 수 있어요. 애플리케이션 자격은 [secret chain 가이드](../production/setup/secret-chain-4stage.md)의 환경 파일·워크플로·Kamal 매핑·컨테이너 주입 경로를 확인해요. 문서 동기화 토큰은 애플리케이션 컨테이너에 전달하는 자격이 아니에요.

당시 `ci-test`의 일곱 검사(spotless, build, docs-contract, docs-unit, users 스키마 드리프트, 공유 인프라 키 소유권, gitleaks)는 외부에 등록된 Secret의 존재를 확인하지 않았어요. actionlint는 워크플로 구문·표현식·job 관계를 정적으로 검사하지만 GitHub에 실제 등록된 Secret까지 확인하지는 못해요. 이 사건의 대응 기록에서는 2026-05-27에 도입을 보류했어요. 정적 검증과 실행 시 자격 확인은 서로 다른 검사예요.

<a id="42-결제-모듈이-부팅을-막는다--portone-부분-설정-함정"></a>

### 4.2 결제 모듈이 부팅을 막는다 — PortOne 부분 설정 함정

파생 레포의 `.env.prod` 를 채우다가, 결제를 쓸 예정이라 PortOne 키를 일부만 먼저 넣어 뒀어요. `APP_PAYMENT_PORTONE_API_V1_KEY` 만 채우고 `API_V1_SECRET` 은 비워 둔 상태였어요. 그랬더니 prod 프로파일 부팅이 거부됐어요.

**왜 발생했나요?** 슬러그 컨트롤러는 `PaymentPort` 를 필수 의존으로 받아요. [`ADR-019`](../philosophy/adr-019-billing-iap-payment-separation.md) 가 IAP·PG·Billing 을 분리하기로 결정한 결과예요. prod 와 dev 프로파일에서는 `PortOneProdConfigGuard`(`core/core-payment-impl/.../impl/PaymentAutoConfiguration.java`)가 부팅 시 PortOne 설정을 검증해요.

| PortOne 설정 상태(dev·prod) | 부팅 | 결과 |
|---|---|---|
| v1 key·secret, v2 key, webhook secret이 모두 비어 있음 | 통과 | `StubPaymentAdapter` 등록. 결제 요청에는 `PAY_008`(503)을 반환해요 |
| v1 key·secret 중 하나만 있음 | 차단 | 짝이 맞지 않는 설정을 거부해요 |
| 결제 자격 없이 webhook secret만 있음 | 차단 | 결제 자격이 없는 상태를 거부해요 |
| v2 key가 있음 | 차단 | webhook secret 유무와 관계없이 현재 v2는 지원하지 않아요 |
| v1 key·secret이 모두 있고 v2 key가 없음 | 통과 | `PortOneAdapter` 등록. v1 webhook은 `imp_uid`를 재조회해 확인해요 |

이 사례에서는 v1 secret을 빠뜨려 부팅 가드에 걸렸어요. 초기 가드가 v1에도 webhook secret을 요구했던 문제는 v1의 재조회 방식에 맞게 수정했어요. 현재는 v1 key·secret을 함께 채우고, v2 key는 비워 둬요.

**현재 적용된 동작**: 결제 미사용 시 관련 자격을 모두 비우면 Stub으로 기동하고 결제 요청만 503으로 응답해요. dev에서도 자격을 모두 비웠다는 이유만으로 WireMock이 자동 선택되지는 않아요. 당시 IAP Stub과 같은 실패 응답 패턴을 맞춘 변경은 commit `c982a84`에 기록돼 있어요. 현재 설정은 [셋업 가이드의 결제 절](./dogfood-setup.md#결제--v1-키는-둘-다-아니면-둘-다-비우기)을 참고하세요.

<a id="43-cloudflare-가-옛-nxdomain-을-캐싱한다-ns-internal-cache"></a>

<a id="43-cloudflare-가-옛-nxdomain-을-캐싱한다--ns-internal-cache"></a>
### 4.3 DNS 재등록 뒤 응답 지연

`prod force-clear` 후 `prod init`으로 DNS를 다시 등록했지만 외부 조회에서 새 응답을 확인하지 못한 사례예요. 당시에는 Cloudflare 내부 캐시 지연으로 추정했지만, 이 기록만으로 내부 원인이나 TTL과의 관계를 확정할 수는 없어요.

대응으로 `cloudflare_register_hostname`에 조회 대기와 재생성 절차를 추가했어요(commit `988bf47`). 현재 코드는 지정한 NS를 최대 30초 동안 조회하고, 응답이 없으면 해당 레코드를 한 번 삭제·재생성한 뒤 다시 확인해요. 재생성 뒤에도 조회되지 않으면 경고와 수동 확인 안내를 남겨요. 새 record ID가 특정 내부 인덱스를 강제로 갱신한다는 동작까지 보장하는 절차는 아니에요.

<a id="44-multi-app-추가-후-secret-chain-갭--app_flyway_mode"></a>

### 4.4 multi-app 추가 후 secret chain 갭 — `APP_FLYWAY_MODE`

공유 core 스키마를 사용하던 당시, 파생 저장소에 두 번째 슬러그를 추가한 뒤 `Schema "core" doesn't exist yet` 오류로 부팅이 중단됐어요. core 스키마는 이후 [ADR-037](../philosophy/adr-037-core-schema-deprecation.md)에서 폐기했으며, 여기서는 당시 환경변수 전달 누락을 설명해요.

**왜 발생했나요?** `APP_FLYWAY_MODE` 환경변수가 4-stage chain 중 한 곳에서 누락된 상태였어요. 사용자가 `.env.prod` 에 `APP_FLYWAY_MODE=AUTO` 를 명시했지만, `config/deploy.yml` 의 `env.secret:` 리스트, `.kamal/secrets.example`, 워크플로의 `env:` 블록 가운데 한 단계라도 연결이 빠지면 컨테이너 안에서는 빈 값으로 fallback 합니다. `application-prod.yml` 의 기본값인 [`VALIDATE_ONLY`](../reference/glossary.md#데이터베이스) 로 fallback 하면, 빈 schema 에서 부팅이 실패해요([`ADR-033`](../philosophy/adr-033-flyway-hybrid-policy.md)).

**현재 적용된 동작**: `APP_FLYWAY_MODE`를 배포 전달 경로에 연결했고(commit `5a04206`), `.env.prod.example`은 `AUTO`를 지정해요. 이 값을 전달하면 앱 마이그레이션을 자동 실행하고, 전달하지 않으면 prod 프로파일의 `VALIDATE_ONLY`가 적용돼요. 연결·권한·마이그레이션 실패는 별도로 확인해요. 새 환경변수의 전달 위치는 [secret chain 체크리스트](../production/setup/secret-chain-4stage.md)가 정본이에요.

### 4.5 alias 'test' 가 bash builtin 과 충돌

`./factory install test` 로 alias 를 등록했더니, `test` 명령을 실행할 때 의도와 다른 동작이 나왔어요. `test` 가 bash 내장 명령이거든요.

**왜 발생했나요?** bash 에는 `test`, `time`, `if`, `for` 같은 키워드와 내장 명령이 있어요. 사용자가 같은 이름으로 PATH alias 를 만들어도 shell 이 내장 명령을 먼저 해석해서 alias 가 호출되지 않습니다. 당시 `factory install` 이 alias 이름의 충돌 여부를 사전 검증하지 않은 게 원인이었어요.

**무엇이 정착됐나요?** `factory install`(그리고 `alias` 로 이름을 바꿀 때도) 이 등록 전에 셸 빌트인·예약어와 PATH 상 기존 실행파일 충돌을 검사해 차단해요(`factory:353-387`). 당시 임시 대응이던 `stest` 재등록은 더 이상 필요 없어요.

<a id="46-placeholder-repo-name-이-그대로-출력--alias-감지-실패"></a>

### 4.6 placeholder `<repo-name>` 이 그대로 출력 — alias 감지 실패

`factory new-app <slug>` 끝의 안내 문구에서 `<repo-name>` placeholder 가 치환되지 않고 그대로 노출됐어요. 다른 alias 로 호출했는데도 첫 alias 이름만 쓰이는 현상도 같이 있었어요.

**왜 발생했나요?** placeholder 치환은 사용자가 방금 호출한 factory alias 이름을 알아야 해요. 처음엔 `~/.local/bin/*` symlink 를 거꾸로 따라가 이름을 추정했는데, 같은 factory 에 여러 alias 가 걸려 있으면 알파벳 순으로 첫 번째만 매치돼서, 사용자가 실제로 입력한 alias 와 어긋날 수 있었어요.

**무엇이 정착됐나요?** `factory` wrapper 가 시작할 때 `export FACTORY_ALIAS="$(basename "$0")"` 로 사용자가 입력한 이름을 그대로 export 해요(commit `e822736`). 자식 프로세스(`new-app.sh`, `init-prod.sh`, `init-local.sh`)는 이 `$FACTORY_ALIAS` 를 먼저 읽고, 없을 때만 symlink 역추적으로 fallback 합니다. 이 로직이 `tools/lib/common.sh` 의 `detect_factory_alias()` 로 정착했어요. 같은 시점에 `<repo-name>` placeholder 가 출력될 때 ANSI 컬러로 시각적 강조를 더했어요(commit `16e50de`).

### 4.7 `init-prod.sh` partial-fail 의 인지성

`init-prod.sh`(당시 이름은 `init-server.sh`) 실행이 중간에 "명령 not found" 에러를 출력했는데, 그다음 단계에서 "[OK] 등록 완료" 가 떠서 정상 종료처럼 보였어요. 사용자는 정상 완료로 인식했지만, 실제로는 8개 REQUIRED secret 중 7개만 push 되고 1개가 빠진 상태였어요.

**왜 발생했나요?** `init-prod.sh` 는 부분 실패가 나도 그대로 다음 단계로 진행하는 구조였어요. 어떤 단계의 "[OK] 등록 완료" 는 그 단계만의 성공 메시지인데, 사용자 입장에선 전체 init 의 종료 메시지처럼 보였습니다. 그래서 뒤따라야 할 단계가 조용히 건너뛰어졌어요.

**무엇이 정착됐나요?** `init-prod.sh` 가 `trap _on_exit_init_prod EXIT` + `_INIT_PROD_OK` sentinel 로 정상 완료와 비정상 종료를 구별해요(`tools/init/init-prod.sh:41-57`). 비정상 종료면 ❌ 박스와 점검 안내가, 정상 완료면 `✅ 운영 셋업 정상 완료` 박스가 떠서 부분 실패를 성공으로 오인하지 않아요.

### 4.8 `sync-docs` 가 며칠치 모든 push 에서 실패

§4.1과 같은 사건이에요. 토큰 누락, 당시 CI의 검사 범위, actionlint 도입 보류 기록은 [§4.1](#41-첫-push-가-빨갛게--ghcr_token-미등록)에 합쳤어요. 현재 원본 저장소에만 적용되는 워크플로 조건도 그 절에서 확인할 수 있어요.

---

<a id="5-정착된-패턴--한-곳에-정리"></a>

## 5. 정착된 패턴 — 한 곳에 정리

위 함정들이 어떤 영구 패턴으로 정착됐는지 한눈에 봐요.

| 패턴 | canonical 문서 / 코드 |
|---|---|
| **secret chain 4-stage** | [`secret-chain-4stage.md`](../production/setup/secret-chain-4stage.md) — 4 곳 매핑 + 체크리스트 |
| **deploy.sh = origin/main SHA 기준** | [`runbook.md`](../production/deploy/runbook.md) — 로컬 working tree / HEAD 무관 |
| **`@Profile("!test")` 슬러그 모듈** | `apps/app-*/.../*AppAutoConfiguration.java` — bootstrap test 에서 비활성 |
| **`AbstractAppDataSourceConfig.deriveSlugUrl`** | `common/common-persistence/.../AbstractAppDataSourceConfig.java` — `<SLUG>_DB_URL` 을 비우면 `${DB_URL}` 의 currentSchema 만 슬러그로 자동 교체 |
| **`BucketProvisioner` 멱등** | `core/core-storage-impl/.../impl/BucketProvisioner.java` — 등록된 앱의 업로드 버킷과 `APP_STORAGE_MINIO_BUCKETS_*` 공유 목록을 부팅 시 준비 |
| **force-clear 5단계 confirm** | [`runbook.md`](../production/deploy/runbook.md), [`cli-guide.md`](./cli-guide.md) — DB · Storage · 관측성 · 백업 · 최종 |
| **Stub 503 graceful (IAP / Payment 동일)** | `core/core-iap-impl/.../impl/StubIapAdapter.java` + `core/core-payment-impl/.../impl/StubPaymentAdapter.java` |
| **`PortOneProdConfigGuard` 부팅 검증** | `core/core-payment-impl/.../impl/PaymentAutoConfiguration.java` — prod / dev 에서 v1 key·secret 을 "짝으로 또는 둘 다 빔" 으로 강제, v2 key 는 미지원이라 차단 |
| **factory wrapper alias 감지** | `factory:112`(`export FACTORY_ALIAS=$(basename "$0")`) + `tools/lib/common.sh:193` `detect_factory_alias()` |
| **Cloudflare NS polling** | `tools/lib/cloudflare.sh:118` `cloudflare_register_hostname` — propagation 검증 + 자동 record 재생성 |
| **환경 예시의 `APP_FLYWAY_MODE=AUTO`** | `.env.prod.example` — 이 값을 전달하면 앱 마이그레이션을 실행. prod 프로파일 자체의 기본값은 `VALIDATE_ONLY` |

---

## 6. 다음 단계

처음 도그푸딩을 시작한다면 [`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md) 의 정상 흐름부터 따라가세요. 에러를 만나 검색용 참조가 필요하면 [`도그푸딩 함정 모음`](./dogfood-pitfalls.md) 과 [`도그푸딩 FAQ`](dogfood-setup.md) 를 보면 돼요. secret 을 점검할 때는 [`secret-chain-4stage.md`](../production/setup/secret-chain-4stage.md) 의 4-stage 체크리스트가, 전체 파이프라인을 그림으로 보고 싶을 때는 [`CI / CD 전체 플로우`](../production/deploy/ci-cd-flow.md) 가 도움이 돼요.

---

## 관련 문서

- [`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md) — step-by-step 정상 흐름
- [`도그푸딩 함정 모음`](./dogfood-pitfalls.md) — 증상별 원인과 대응
- [`도그푸딩 FAQ`](dogfood-setup.md) — Q&A 형식
- [`secret chain 4-stage 통합 가이드`](../production/setup/secret-chain-4stage.md) — 4 곳 매핑 표
- [`인프라 결정 기록`](../production/deploy/decisions-infra.md) — I-09 ~ I-14 (왜 이 결정을 내렸나)
- [`ADR-002 · Use this template`](../philosophy/adr-002-use-this-template.md) — 도그푸딩의 설계 근거
- [`ADR-019 · billing / IAP / payment 분리`](../philosophy/adr-019-billing-iap-payment-separation.md) — 결제 도메인 분리 결정
- [`ADR-033 · Flyway Hybrid 정책`](../philosophy/adr-033-flyway-hybrid-policy.md) — `APP_FLYWAY_MODE` 의 결정 근거
