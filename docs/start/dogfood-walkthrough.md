# 도그푸딩 walkthrough — 사이클 흐름과 정착된 패턴

> **유형**: How-to · **독자**: Level 1 · **읽는 시간**: ~20분

이 문서는 도그푸딩을 시간 순으로 따라가는 이야기예요. 막힌 자리를 어떻게 빠져나왔는지, 그래서 어떤 안전장치가 코드에 영구히 박혔는지를 한 흐름으로 읽어 내려가요.

함께 보면 좋은 문서가 둘 있어요.

- 정상 흐름을 단계별로 따라가고 싶을 때: [`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md)
- 특정 에러로 검색해서 찾아볼 때: [`도그푸딩 함정 모음`](./dogfood-pitfalls.md) · [`도그푸딩 FAQ`](./dogfood-faq.md)

---

## 이 가이드가 다루는 것

도그푸딩 사이클에서 사용자가 실제로 겪었던 흐름을 시간 순으로 풀어 쓴 가이드예요. "어떤 셋업을 어떤 순서로 하는가" 보다, 어떤 함정을 만났을 때 어떤 패턴으로 정착됐는지에 초점을 맞췄어요.

각 함정의 상세한 에러 메시지와 원인, 해결책은 [`도그푸딩 함정 모음`](./dogfood-pitfalls.md) 에 정리돼 있어요. 이 walkthrough 는 왜 이런 패턴이 정착됐는지의 서사를 보여드리고, 자세한 참조가 필요할 때마다 해당 문서로 안내해드려요.

---

## 1. 도그푸딩이 뭐예요?

도그푸딩은 템플릿 자기 자신을 Mac mini 에 배포해서 한 사이클을 검증하는 일이에요. "Use this template" 으로 만든 새 [파생 레포](../reference/glossary.md#이-레포-고유-용어) 에서도 똑같은 검증을 합니다.

왜 필요할까요? 템플릿의 자동화 코드는 파생 레포로 그대로 복사돼요. `tools/init-prod.sh`, `tools/init-local.sh`, `tools/init-dev.sh` 같은 스크립트가 한 글자도 빠짐없이 따라가요. 하지만 자동화가 건드리지 못하는 자리가 있어요. GitHub Settings 의 Variables 와 Secrets, Mac mini 의 SSH 키, [GHCR](../reference/glossary.md#ci--배포-파이프라인) 패키지는 파생 레포가 직접 셋업해야 합니다. 첫 실배포 전에 도그푸딩으로 한 바퀴 돌려 두면, 실제 사용자 트래픽이 들어오기 전에 이 함정들을 미리 잡을 수 있어요.

설계 근거는 [`ADR-002 · Use this template`](../philosophy/adr-002-use-this-template.md) 에 정리돼 있어요.

---

## 2. 사이클의 큰 그림

도그푸딩은 두 회차로 나뉩니다.

| 회차 | 대상 | 시점 | 함정 분포 |
|---|---|---|---|
| **1회차** | `template-spring` 자체 | 템플릿 첫 배포 | 12 함정 ([`pitfalls.md`](./dogfood-pitfalls.md) `#1~#12`) |
| **2회차** | "Use this template" 파생 레포 | 파생 레포의 첫 셋업 | 별도 함정군 (이 walkthrough §4) |

1회차 함정은 대부분 자동화 코드 자체에 안전장치로 박혀서 회피됩니다. 그래서 2회차 파생 레포에서는 1회차 함정을 거의 만나지 않아요. 대신 2회차에서만 나타나는 함정이 따로 있어요. 파생 레포가 자기 secret 을 처음 채우는 순간에 생기는 문제들이에요.

이 walkthrough 는 주로 2회차의 흐름과 함정에 집중합니다.

---

## 3. 1회차 — template 자체 도그푸딩

이 회차는 [`도그푸딩 함정 모음`](./dogfood-pitfalls.md) 의 `#1~#12` 에 자세히 정리돼 있어요. 여기서는 핵심만 짚고 넘어갈게요. 대표 함정 세 가지만 골라 보면 이래요.

- **`#7` GHCR push 권한** — `GITHUB_TOKEN` 만으로는 첫 GHCR 패키지를 만들 권한이 부족해서, [PAT](../reference/glossary.md#ci--배포-파이프라인) 를 따로 발급해야 합니다.
- **`#11` JDBC URL 형식** — [Supabase](../reference/glossary.md#데이터베이스) 가 보여주는 connection string 을 그대로 복사하면 `jdbc:` 접두사가 빠져 있어 "No suitable driver" 에러가 납니다.
- **`#12` JDK 26 호환성** — Gradle 의 Groovy 가 class file major 70(JDK 26)을 읽지 못해 빌드 자체가 막힙니다. JDK 21 LTS 를 권장해요.

이 12 함정의 결과로 여러 자동화 가드가 코드에 박혔어요.

- `init-prod.sh` 와 `init-local.sh` 의 첫 단계에서 prereq 를 검증합니다. Java 21~25 범위, gh 설치 여부, ssh-keygen 존재 등을 `tools/lib/init-common.sh` 의 `_validate_prereqs` 가 점검해요.
- `tools/dogfooding/setup.sh` 가 `DB_URL` 이 `jdbc:postgresql://` 로 시작하는지 정규식으로 확인합니다.
- `deploy.yml` 의 docker build 단계에 `provenance: false` 와 `sbom: false` 를 박았습니다.

이 가드들 덕분에 2회차 파생 레포에서는 1회차 함정을 거의 만나지 않아요.

---

## 4. 2회차 — 파생 레포에서 만나는 함정

여기부터가 walkthrough 의 본론이에요. 파생 레포에서 처음으로 발견된 함정들과, 그것이 어떻게 영구 패턴으로 정착됐는지를 시간 순으로 풀어 드려요.

### 4.1 첫 push 가 빨갛게 — `GHCR_TOKEN` 미등록

파생 레포를 만들고 코드를 한 번 push 했는데, GitHub Actions 의 `sync-docs` 워크플로가 빨갛게 떴어요. 며칠치 push 가 모두 같은 에러로 실패해 있는 상태로 뒤늦게 발견됐어요.

**왜 발생했나요?** `sync-docs.yml` 은 docs 변경분을 `docs-template-spring` 레포로 자동 PR 보내는데, 이 cross-repo 동작에 PAT 가 필요해요. 그런데 파생 레포의 GitHub Settings 에 `GHCR_TOKEN` secret 이 등록되지 않은 상태였어요. `GHCR_TOKEN` 은 1회차 `template-spring` 에서 이미 발급해 등록했지만, 파생 레포는 별개의 GitHub 레포라 secret 이 자동으로 상속되지 않습니다.

**무엇이 정착됐나요?** 파생 레포의 secret 등록은 [4-stage secret chain](../reference/glossary.md#이-레포-고유-용어) 의 마지막 단계, 즉 GitHub Actions 워크플로의 `env:` 블록과 직접 이어져요. 본문이 `${{ secrets.X }}` 로 등록되지 않은 secret 을 참조하면 빈 문자열이 되고, 워크플로가 어느 단계에서 조용히 실패합니다. 그래서 모든 secret 이 4-stage 모두에 등록됐는지 확인하는 원칙이 [`secret chain 4-stage 통합 가이드`](../production/setup/secret-chain-4stage.md) 에 명문화됐어요. `init-prod.sh` 가 8개의 REQUIRED secret 을 push 하지만, 그 밖에도 워크플로가 의존하는 secret 이 빠져 있을 수 있어서, 운영자가 한 번 더 명시적으로 점검해야 합니다.

### 4.2 결제 모듈이 부팅을 막는다 — PortOne 부분 설정 함정

파생 레포의 `.env.prod` 를 채우다가, 결제를 쓸 예정이라 PortOne 키를 일부만 먼저 넣어 뒀어요. `APP_PAYMENT_PORTONE_API_V1_KEY` 와 `API_V1_SECRET` 은 채웠는데 `WEBHOOK_SECRET` 은 비워 둔 상태였어요. 그랬더니 prod 프로파일 부팅이 거부됐어요.

**왜 발생했나요?** 슬러그 컨트롤러는 `PaymentPort` 를 필수 의존으로 받아요. [`ADR-019`](../philosophy/adr-019-billing-iap-payment-separation.md) 가 IAP·PG·Billing 을 분리하기로 결정한 결과예요. prod 와 dev 프로파일에서는 `PortOneProdConfigGuard`(`core/core-payment-impl/.../impl/PaymentAutoConfiguration.java`)가 부팅 시 PortOne 설정을 검증하는데, 그 정책이 세 갈래예요.

| PortOne 설정 상태 | 부팅 | 결과 |
|---|---|---|
| v1 키·secret·webhook secret **셋 다 빔** | 통과 | fallback 의도로 판단 → `StubPaymentAdapter`(prod) / WireMock(dev). 결제 호출 시 stub 응답 |
| **일부만** 채워짐 | 차단 | strict fail. webhook 만 빠지면 위조 위험, v1 키만 빠지면 결제 불가 — 둘 다 사고라 fail-fast |
| **셋 다** 채워짐 | 통과 | 정상. `PortOneAdapter` + webhook 검증기 등록 |

핵심은 이거예요. 셋을 다 비우는 건 "결제를 의도적으로 안 쓴다" 는 명확한 신호라 허용돼요. 막히는 건 어중간하게 일부만 채운 상태예요. 사용자가 webhook secret 하나를 빠뜨린 게 바로 두 번째 줄에 걸린 거예요.

**무엇이 정착됐나요?** 정착된 원칙은 "셋 다 채우거나, 셋 다 비우거나 — 절대 부분만 채우지 않는다" 예요. [`dogfood-setup.md`](./dogfood-setup.md) 의 환경 변수 절에 이 안내가 들어갔어요. 그리고 셋 다 비운 fallback 경로에서도 서버가 멈추지 않도록, `StubPaymentAdapter` 가 결제 호출에 graceful 503(`PAY_008`)으로 응답하는 패턴으로 통일됐어요. 같은 시점에 `StubIapAdapter` 와 패턴을 맞춰서, 결제 미설정 환경에서도 서버는 부팅하고 결제 API 만 503 으로 답합니다. 이 패턴은 commit `c982a84` 에서 정착됐어요.

### 4.3 Cloudflare 가 옛 NXDOMAIN 을 캐싱한다 — NS internal cache

`prod force-clear` 로 인프라를 깨끗이 정리한 뒤 다시 `prod init` 으로 등록했더니, [Cloudflare](../reference/glossary.md#운영--인프라) DNS 가 예전 NXDOMAIN 을 계속 캐싱해서 새 DNS 레코드가 외부에서 보이지 않았어요.

**왜 발생했나요?** Cloudflare 의 internal NS 서버는 한 번 NXDOMAIN 을 응답하면 일정 시간 그 결과를 캐싱합니다(TTL 과 무관). 도메인이 빠르게 삭제·재생성되는 force-clear → init 흐름에서는, NS 가 옛 응답을 기억하는 바람에 새 레코드가 propagation 되지 않은 것처럼 보여요.

**무엇이 정착됐나요?** `tools/lib/cloudflare.sh` 의 `cloudflare_register_hostname` 함수에 NS propagation polling 과 자동 record 재생성 패턴이 보강됐어요(commit `988bf47`). 레코드 등록 후 30초 동안 polling 하면서 외부 NS 가 새 값을 응답할 때까지 기다리고, 그 안에 안 보이면 record 를 한 번 삭제했다가 재생성해서 propagation 을 강제로 트리거합니다. 새 record 는 NS internal index 에서 새 id 로 다시 인식돼요. 이 동작은 `prod init` 1회차에서 NS 경고로 사용자에게도 노출됩니다("NS 30s 내 응답 X — record 강제 재생성...").

### 4.4 multi-app 추가 후 secret chain 갭 — `APP_FLYWAY_MODE`

파생 레포에 두 번째 슬러그를 추가하고 deploy 했더니, [Flyway](../reference/glossary.md#데이터베이스) 가 `Schema "core" doesn't exist yet` 에러로 부팅을 막았어요.

**왜 발생했나요?** `APP_FLYWAY_MODE` 환경변수가 4-stage chain 중 한 곳에서 누락된 상태였어요. 사용자가 `.env.prod` 에 `APP_FLYWAY_MODE=AUTO` 를 명시했지만, `config/deploy.yml` 의 `env.secret:` 리스트, `.kamal/secrets.example`, 워크플로의 `env:` 블록 가운데 한 단계라도 연결이 빠지면 컨테이너 안에서는 빈 값으로 fallback 합니다. `application-prod.yml` 의 기본값인 [`VALIDATE_ONLY`](../reference/glossary.md#데이터베이스) 로 fallback 하면, 빈 schema 에서 부팅이 실패해요([`ADR-033`](../philosophy/adr-033-flyway-hybrid-policy.md)).

**무엇이 정착됐나요?** `APP_FLYWAY_MODE` 를 4-stage chain 모두에 연결했어요(commit `5a04206`). 그리고 `.env.prod.example` 의 기본값을 빈 문자열에서 `AUTO` 로 바꿨어요. `init-prod.sh` 가 이 example 을 그대로 복사해 `.env.prod` 를 만들기 때문에, 사용자가 따로 채우지 않아도 첫 deploy 가 부팅에 실패하지 않습니다. 모든 새 env 변수는 4-stage 에 동시에 등록한다는 일반 교훈이 [`secret-chain-4stage.md`](../production/setup/secret-chain-4stage.md) 의 체크리스트에 명문화됐어요.

### 4.5 alias 'test' 가 bash builtin 과 충돌

`./factory install test` 로 alias 를 등록했더니, `test` 명령을 실행할 때 의도와 다른 동작이 나왔어요. `test` 가 bash 내장 명령이거든요.

**왜 발생했나요?** bash 에는 `test`, `time`, `if`, `for` 같은 키워드와 내장 명령이 있어요. 사용자가 같은 이름으로 PATH alias 를 만들어도 shell 이 내장 명령을 먼저 해석해서 alias 가 호출되지 않습니다. 당시 `factory install` 이 alias 이름의 충돌 여부를 사전 검증하지 않은 게 원인이었어요.

**무엇이 정착됐나요?** 임시로는 사용자가 alias 를 `stest` 로 다시 등록해서 진행했어요. 영구 수정은 backlog 에 등록됐어요(commit `1f24fb9`). `factory install` 이 `command -v <name>` 또는 bash `type -t <name>` 으로 사전 검증하고, 내장 명령이나 예약어면 등록을 차단하고 경고하는 방향이에요.

### 4.6 placeholder `<repo-name>` 이 그대로 출력 — alias 감지 실패

`factory new-app <slug>` 끝의 안내 문구에서 `<repo-name>` placeholder 가 치환되지 않고 그대로 노출됐어요. 다른 alias 로 호출했는데도 첫 alias 이름만 쓰이는 현상도 같이 있었어요.

**왜 발생했나요?** placeholder 치환은 사용자가 방금 호출한 factory alias 이름을 알아야 해요. 처음엔 `~/.local/bin/*` symlink 를 거꾸로 따라가 이름을 추정했는데, 같은 factory 에 여러 alias 가 걸려 있으면 알파벳 순으로 첫 번째만 매치돼서, 사용자가 실제로 입력한 alias 와 어긋날 수 있었어요.

**무엇이 정착됐나요?** `factory` wrapper 가 시작할 때 `export FACTORY_ALIAS="$(basename "$0")"` 로 사용자가 입력한 이름을 그대로 export 해요(commit `e822736`). 자식 프로세스(`new-app.sh`, `init-prod.sh`, `init-local.sh`)는 이 `$FACTORY_ALIAS` 를 먼저 읽고, 없을 때만 symlink 역추적으로 fallback 합니다. 이 로직이 `tools/lib/common.sh` 의 `detect_factory_alias()` 로 정착했어요. 같은 시점에 `<repo-name>` placeholder 가 출력될 때 ANSI 컬러로 시각적 강조를 더했어요(commit `16e50de`).

### 4.7 `init-prod.sh` partial-fail 의 인지성

`init-prod.sh`(당시 이름은 `init-server.sh`) 실행이 중간에 "명령 not found" 에러를 출력했는데, 그다음 단계에서 "[OK] 등록 완료" 가 떠서 정상 종료처럼 보였어요. 사용자는 정상 완료로 인식했지만, 실제로는 8개 REQUIRED secret 중 7개만 push 되고 1개가 빠진 상태였어요.

**왜 발생했나요?** `init-prod.sh` 는 부분 실패가 나도 그대로 다음 단계로 진행하는 구조였어요. 어떤 단계의 "[OK] 등록 완료" 는 그 단계만의 성공 메시지인데, 사용자 입장에선 전체 init 의 종료 메시지처럼 보였습니다. 그래서 뒤따라야 할 단계가 조용히 건너뛰어졌어요.

**무엇이 정착됐나요?** 영구 수정은 backlog 에 등록됐어요(commit `254fb30`). 부분 실패 시 명시적 SUMMARY 를 출력해서(성공 N개 / 실패 M개 / skip K개), 사용자가 init 종료 후 "어디까지 됐고 어디부터 다시 해야 하는지" 를 한눈에 보게 하고, 가능하면 fail-fast 모드(`--strict`) 옵션을 더하는 방향이에요. 그때까지의 임시 대응은, init 이 끝난 뒤 `gh secret list -R <repo>` 로 직접 확인하는 거예요.

### 4.8 `sync-docs` 가 며칠치 모든 push 에서 실패

§4.1 의 `GHCR_TOKEN` 미등록 함정이 드러나기 전, 사용자는 며칠 동안 모든 push 가 빨갛게 뜨는 상태로 작업하고 있었어요. 빨간 표시가 붙은 워크플로 이름이 바로 `sync-docs` 였어요.

**왜 발생했나요?** `sync-docs.yml` 은 docs 변경분을 `docs-template-spring` 레포로 PR 보내고, 이 cross-repo 동작에 PAT 가 필요해요. 이 PAT 는 secret 이름 `GHCR_TOKEN` 으로 함께 씁니다(이름이 GHCR 인 건 주 용도가 GHCR push 라서예요). 그런데 ci-test 5단계(spotless · build · docs-contract · docs-unit · gitleaks)는 내용을 검증할 뿐, 워크플로 YAML 자체의 런타임 의존성, 예컨대 등록되지 않은 secret 참조까지는 보지 않아요. 그래서 secret 누락이 CI 를 통과해 버린 거예요.

**무엇이 정착됐나요?** 사용자가 `gh secret set GHCR_TOKEN -R <repo>` 로 등록하고 정상화했어요. backlog 에는 actionlint 통합 항목이 올라갔어요(commit `d1baf27`). actionlint 는 GitHub Actions 워크플로의 정적 검증 도구로, `.github/workflows/*.yml` 의 YAML 구문, 잘못된 action 버전, job dependency 누락 등을 잡아 줍니다. 다만 secret 부재 같은 런타임 에러는 actionlint 도 못 잡아요. 그건 워크플로 시작 시 토큰 존재를 검증하고 없으면 graceful skip 하는, 별개의 보강이 필요한 영역이에요.

---

## 5. 정착된 패턴 — 한 곳에 정리

위 함정들이 어떤 영구 패턴으로 정착됐는지 한눈에 봐요.

| 패턴 | canonical 문서 / 코드 |
|---|---|
| **secret chain 4-stage** | [`secret-chain-4stage.md`](../production/setup/secret-chain-4stage.md) — 4 곳 매핑 + 체크리스트 |
| **deploy.sh = origin/main SHA 기준** | [`runbook.md`](../production/deploy/runbook.md) — 로컬 working tree / HEAD 무관 |
| **`@Profile("!test")` 슬러그 모듈** | `apps/app-*/.../*AppAutoConfiguration.java` — bootstrap test 에서 비활성 |
| **`AbstractAppDataSourceConfig.deriveSlugUrl`** | `common/common-persistence/.../AbstractAppDataSourceConfig.java` — `<SLUG>_DB_URL` 을 비우면 `${DB_URL}` 의 currentSchema 만 슬러그로 자동 교체 |
| **`BucketProvisioner` 멱등** | `core/core-storage-impl/.../impl/BucketProvisioner.java` — `APP_STORAGE_MINIO_BUCKETS_*` 부팅 시 자동 생성 |
| **force-clear 5단계 confirm** | [`runbook.md`](../production/deploy/runbook.md), [`cli-guide.md`](./cli-guide.md) — DB · Storage · 관측성 · 백업 · 최종 |
| **Stub 503 graceful (IAP / Payment 동일)** | `core/core-iap-impl/.../impl/StubIapAdapter.java` + `core/core-payment-impl/.../impl/StubPaymentAdapter.java` |
| **`PortOneProdConfigGuard` 부팅 검증** | `core/core-payment-impl/.../impl/PaymentAutoConfiguration.java` — prod / dev 에서 v1 키 + webhook secret 을 "셋 다 또는 셋 다 빔" 으로 강제 |
| **factory wrapper alias 감지** | `factory:112`(`export FACTORY_ALIAS=$(basename "$0")`) + `tools/lib/common.sh:191` `detect_factory_alias()` |
| **Cloudflare NS polling** | `tools/lib/cloudflare.sh:118` `cloudflare_register_hostname` — propagation 검증 + 자동 record 재생성 |
| **`APP_FLYWAY_MODE` 기본값 = AUTO** | `.env.prod.example` — 빈 schema 첫 deploy 시 부팅 fail 방지 |

---

## 6. 다음 단계

처음 도그푸딩을 시작한다면 [`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md) 의 정상 흐름부터 따라가세요. 에러를 만나 검색용 참조가 필요하면 [`도그푸딩 함정 모음`](./dogfood-pitfalls.md) 과 [`도그푸딩 FAQ`](./dogfood-faq.md) 를 보면 돼요. secret 을 점검할 때는 [`secret-chain-4stage.md`](../production/setup/secret-chain-4stage.md) 의 4-stage 체크리스트가, 전체 파이프라인을 그림으로 보고 싶을 때는 [`CI / CD 전체 플로우`](../production/deploy/ci-cd-flow.md) 가 도움이 돼요.

---

## 관련 문서

- [`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md) — step-by-step 정상 흐름
- [`도그푸딩 함정 모음`](./dogfood-pitfalls.md) — 12 함정 참조 (1회차 위주)
- [`도그푸딩 FAQ`](./dogfood-faq.md) — Q&A 형식
- [`secret chain 4-stage 통합 가이드`](../production/setup/secret-chain-4stage.md) — 4 곳 매핑 표
- [`인프라 결정 기록`](../production/deploy/decisions-infra.md) — I-09 ~ I-14 (왜 이 결정을 내렸나)
- [`ADR-002 · Use this template`](../philosophy/adr-002-use-this-template.md) — 도그푸딩의 설계 근거
- [`ADR-019 · billing / IAP / payment 분리`](../philosophy/adr-019-billing-iap-payment-separation.md) — 결제 도메인 분리 결정
- [`ADR-033 · Flyway Hybrid 정책`](../philosophy/adr-033-flyway-hybrid-policy.md) — `APP_FLYWAY_MODE` 의 결정 근거
