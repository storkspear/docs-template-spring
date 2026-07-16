# 📚 template-spring — 책 목차 (Developer Journey)

> **유형**: Reference · **독자**: Level 0~1 · **읽는 시간**: ~5분 (목차 자체)

이 문서는 `docs/` 안의 모든 문서를 읽는 순서로 안내해요.

레포 루트의 `README.md` 에 있는 30분 QuickStart 만으로도 첫 기동은 돼요. 이 책은 그 이후에 읽는 안내서예요. 레포가 무엇이고 어떻게 쓰는지를 차근차근 이해하고 싶을 때 펼치면 돼요.

각 단계 끝에는 다음 단계로 넘어가는 링크가 있어요. 책처럼 위에서 아래로 한 번 흐르듯 읽으면 전체 그림이 자연스럽게 잡혀요.

> 💡 막히면 [`도그푸딩 함정 모음`](../start/dogfood-pitfalls.md) 과 [`도그푸딩 FAQ`](../start/dogfood-faq.md) 부터 검색해 보세요.

---

## 0. 시작 전 — README 의 QuickStart (30분)

이미 마쳤다면 1단계로 넘어가세요. 안 했다면 레포 루트 `README.md` 의 "30분 QuickStart" 부터 따라가세요.

> 💡 아직 이 레포를 쓸지 말지 결정 전이라면, 먼저 [`Level 0 진입점 — 뭔지 일단 감 잡기`](./getting-started.md) (~3분) 를 읽으세요. 코드를 돌리지 않고도 레포의 정체와 구조의 큰 그림이 잡혀요.

QuickStart 는 다음 세 가지를 해요.

- 로컬 dev 환경 부팅 (`tools/init-local.sh`)
- Spring 첫 기동 확인
- 첫 앱 모듈 생성 (`tools/new-app/new-app.sh`)

이 책은 QuickStart 가 끝났다는 가정에서 시작해요.

---

## 1. 이 레포가 뭐야? (15분)

이 레포의 정체를 이해해요. 어떤 종류의 프로젝트이고, 왜 이렇게 설계됐는지 큰 그림을 잡아요.

읽을 문서는 두 가지예요.

1. [`Repository Philosophy — 책 안내`](../philosophy/README.md) 의 프롤로그 (3 제약과 독자 페르소나) 와 테마 1 의 ADR-001 ~ ADR-004 만 먼저 읽으세요.
   - [`ADR-001 · 모듈러 모놀리스`](../philosophy/adr-001-modular-monolith.md) — 왜 마이크로서비스가 아닌가
   - [`ADR-002 · GitHub Template Repository 패턴`](../philosophy/adr-002-use-this-template.md) — 왜 fork 가 아닌 template 인가
   - [ADR-003 · `-api` / `-impl` 분리](../philosophy/adr-003-api-impl-split.md) — 왜 포트 인터페이스를 분리하나
2. [`Architecture Reference`](../structure/architecture.md) 의 "전체 구성 요약" 한 섹션만 읽으세요. 모듈 4종류와 기술 스택의 한눈 요약이 있어요. 네 종류는 `common/`, `core/`, `apps/`, `bootstrap` 이에요.

여기까지 읽으면 이 레포가 뭘 하려는 도구인지 감이 잡혀요. 나머지 ADR 은 해당 영역이 궁금해질 때 돌아오면 돼요. 전체 39개 중 테마 1 의 4개를 뺀 35개가 테마 2~8 에 흩어져 있어요. 어떤 L2 문서가 어느 ADR 의 결과인지는 [`philosophy/README.md`](../philosophy/README.md) 끝의 "L2 ↔ L3 매핑" 표에서 빠르게 찾을 수 있어요.

---

## 2. 어떻게 써? — 로컬 개발 (1시간)

본인 노트북에 dev 환경을 띄우고 Spring 을 직접 돌려 봐요.

읽을 문서는 [`Onboarding — 템플릿 첫 사용 가이드`](../start/onboarding.md) 한 편이에요. 전체를 한 번 정독하세요.

핵심 흐름은 세 단계예요.

1. **§1 도구 설치** — JDK 21~25, Docker, Node 18+ 등을 설치하고 확인해요. `./factory doctor` 한 번이면 무엇이 빠졌는지 한눈에 보여줘요.
2. **§2 레포 만들기 + 첫 기동** — "Use this template" 으로 레포를 만들고, clone 한 뒤, `./factory install` 과 `<repo> init` 을 차례로 돌려요. `.env` 는 `init` 이 자동으로 만들어요.
3. **§3 첫 앱 모듈 추가** — `<repo> new <slug>` 로 첫 앱을 올리면 그때 Spring 이 부팅돼요.

여기까지 마치면 본인 노트북에서 Spring 이 살아 움직여요. 환경 변수 `.env` 를 손봐야 할 때는 onboarding 의 §4 를 참고하세요.

---

## 3. 클론 후 뭐부터? — 첫 앱 모듈 추가 (30분)

template 은 비즈니스 로직 없이 뼈대만 가지고 있어요. 실제로 쓰려면 앱 모듈을 하나 추가해야 해요.

읽을 문서는 [`Onboarding — 템플릿 첫 사용 가이드`](../start/onboarding.md) 의 "§3 첫 앱 모듈 추가" 섹션이에요.

수행하는 일은 한 줄이에요.

```bash
./tools/new-app/new-app.sh <slug>
```

이 명령은 `apps/app-<slug>/` 디렉터리를 만들고, Postgres 에 앱 전용 schema 와 role 을 자동으로 생성해요. 생성되는 파일 목록과 동작은 onboarding 의 §3 에 표로 정리돼 있어요.

여기까지 끝나면 본인 앱 도메인이 코드 위에 올라간 상태가 돼요.

---

## 4. 발급은 어디서? — 외부 리소스 (1시간)

운영 배포로 넘어가려면 외부 서비스의 자격 증명을 발급받아야 해요. 어디서 어떻게 받는지가 가장 막히는 지점이라, 두 문서로 나눠 안내해요.

### 4.1 소셜 로그인 자격 증명

[`소셜 로그인 설정 가이드`](../start/social-auth-setup.md) 를 읽으세요. 두 가지를 다뤄요.

- Google Sign In Client ID 발급 절차와 Console 에 입력할 값
- Apple Sign In Bundle ID 와 Service ID 발급 절차

발급한 뒤에는 `.env` 의 `APP_CREDENTIALS_<SLUG>_*` 변수에 채워 넣어요.

### 4.2 운영 배포 자격 증명

운영 배포에는 Tailscale OAuth, GitHub PAT, Supabase 자격이 필요해요. [`도그푸딩 환경 셋업 가이드`](../start/dogfood-setup.md) 의 "§3 외부 리소스 발급" 섹션을 읽으세요.

- §3.1 GitHub PAT — GHCR push 권한
- §3.2 Tailscale OAuth client — GHA 에서 Mac mini 로 라우팅
- §3.3 Mac mini SSH 키 준비
- §3.5 Supabase Connection 정보

각 항목은 화면 캡처 없이도 따라갈 수 있게 클릭 경로와 주의사항까지 적혀 있어요. 잘못 발급되는 함정도 함께 짚어 줘요.

---

## 5. 테스트 어떻게? — 도그푸딩 자동 검증 (자동)

발급받은 값으로 template 자체가 운영 환경에 올라가는지 한 사이클 검증해요.

읽을 문서는 세 가지예요.

- [`도그푸딩 환경 셋업 가이드`](../start/dogfood-setup.md) 의 §4 ~ §7 — `.env.prod` 작성과 2회차 push, 그리고 7단계 검증까지의 정상 흐름이에요.
- [`도그푸딩 walkthrough`](../start/dogfood-walkthrough.md) — 시간 순 narrative 와 정착된 패턴이에요. 함정마다 왜 이런 영구 fix 가 자리잡았는지를 흐름으로 풀어 줘요.
- [`도그푸딩 함정 모음 (사고 실록)`](../start/dogfood-pitfalls.md) — 막혔을 때 찾는 15 함정 reference 예요.

핵심 명령은 세 줄이에요.

```bash
cp tools/dogfooding/.env.dogfood{.example,}
$EDITOR tools/dogfooding/.env.dogfood
bash tools/dogfooding/setup.sh
```

`setup.sh` 가 한 번에 처리해요. GitHub Actions 의 Variables 와 Secrets 일괄 등록, GHA 용 SSH 키 발급, DEPLOY_ENABLED 토글, 자동 배포 trigger 까지예요.

배포가 실행되는 전체 흐름이 궁금하다면 [`CI / CD 전체 플로우`](../production/deploy/ci-cd-flow.md) 의 다이어그램을 참고하세요. commit 부터 운영 반영까지를 그림으로 보여줘요.

---

## 6. 정리? — cleanup (5분)

검증이 끝났으면 깨끗하게 정리하고 template 을 순수 상태로 돌려요.

읽을 문서는 [`도그푸딩 환경 셋업 가이드`](../start/dogfood-setup.md) 의 "§9 Trial 환경 자동화" 섹션이에요. `setup.sh` 와 짝을 이루는 `cleanup.sh` 의 동작을 정리해 둔 곳이에요.

핵심 명령은 한 줄이에요.

```bash
bash tools/dogfooding/cleanup.sh
```

이 명령이 다음을 모두 처리해요.

- GitHub 의 Variables 와 Secrets 전체 삭제
- Mac mini 의 spring 컨테이너와 kamal-proxy, 그리고 `authorized_keys` 의 GHA 키 정리
- GHCR 의 도그푸딩 이미지 삭제

외부 서비스의 키 자체는 본인이 직접 폐기해야 해요. GitHub PAT, Tailscale OAuth, Supabase password 가 여기에 해당하고, 절차는 [`키 교체 절차 (Key Rotation)`](../production/setup/key-rotation.md) 에 있어요.

---

## 7. 이제 use this template — 파생 레포 첫 배포 (30분)

template 의 구조와 자동화를 이해했으니, 이제 실제 본인 프로젝트로 옮길 차례예요.

읽을 문서는 두 가지예요.

1. [`운영 배포 가이드 (파생레포 onboarding)`](../production/deploy/deployment.md) — "Use this template" 으로 만든 파생 레포를 Mac mini 에 처음 배포하는 onboarding 이에요.
2. [`크로스 레포 Cherry-pick 가이드`](../start/cross-repo-cherry-pick.md) — template 에 새 변경이 생겼을 때 파생 레포로 가져오는 방법이에요.

핵심 흐름은 도그푸딩과 거의 같아요. 차이는 두 가지예요.

- 파생 레포는 본인 도메인과 본인 인프라 값으로 채워요.
- DEPLOY_ENABLED 가 본격 운영 모드라 cleanup 으로 되돌릴 일이 없어요.

---

## 사이드바 9 그룹 — 어떤 순서로 읽을까

문서는 독자 Level 별로 9개 그룹으로 묶여 있어요. 처음 방문이라면 위에서 아래로 읽고, 익숙해지면 관심 그룹만 펼쳐 보세요.

| 그룹 | Level | 시간 | 무엇을 찾을 수 있나 |
|---|---|---|---|
| 📚 입문 | 0 | 3~10분 | [`Level 0 진입점`](./getting-started.md) · [`5분 투어`](./five-minute-tour.md) · 용어 사전 · 첫 실행·수정·배포 맛보기 |
| 🏃 시작하기 | 1 | 1~2시간 | [`Onboarding`](../start/onboarding.md) · 소셜 로그인 · 앱 스캐폴딩 · 도그푸딩 · Cherry-pick |
| 🏗️ 구조 이해하기 | 2 | 1시간 | [`Architecture`](../structure/architecture.md) · 모듈 의존 · ArchUnit 규칙 · 멀티테넌시 · JWT 인증 |
| 📖 프로젝트 철학 | 3 | 2~3시간 | [`39 ADR 인덱스`](../philosophy/README.md) · 테마 1~8 |
| 📝 코딩 규약 | 2 | 1시간 | 설계 원칙 · 네이밍 · DTO · 예외 처리 · Git 워크플로 |
| 🔌 API 및 기능 | 2 | 필요 시 | API 응답 · 푸시 · 이메일 · 스토리지 · 마이그레이션 · 관측성 |
| ✅ 테스팅 | 2 | 필요 시 | [`Testing Strategy`](../production/test/testing-strategy.md) · 계약 테스트 |
| 🛠️ 운영 | 2.5+ | 운영자용 | 인프라 · CI/CD · 배포 · [`Runbook`](../production/deploy/runbook.md) · 엣지 케이스 · 키 교체 |
| 📚 참고 | — | — | 앱 스캐폴딩 · 백로그 · [`STYLE_GUIDE`](../reference/STYLE_GUIDE.md) (저자용) |

8개 테마의 주제는 차례로 레포 구조의 기반, 모듈 내부 설계, 데이터·멀티테넌시, 인증·보안, 운영·개발 방법론, 결제·구독 도메인, 보안·감사·알림 도메인, 운영 정책·Lite 모드·SSRF 예요.

## 깊이 있는 참조 — 자주 찾는 것

| 궁금한 것 | 문서 | 한 줄 |
|---|---|---|
| 왜 이렇게 설계? | [`Repository Philosophy — 책 안내`](../philosophy/README.md) | 39 ADR · 프롤로그 3 제약 |
| 문서 작성 규칙 (저자) | [`Documentation Style Guide`](../reference/STYLE_GUIDE.md) | 5 유형 템플릿 · 메타블록 규격 · 검증 체크리스트 |
| 모듈 구조 상세 | [`Architecture Reference`](../structure/architecture.md) | 파일 트리 + 의존 그래프 + Extraction 레이어 |
| 환경별 인프라 현황 | [`인프라 (Infrastructure)`](../production/deploy/infrastructure.md) | 어떤 서비스가 어디에서 도는지 |
| 인프라 결정 근거 | [`인프라 결정 기록 (Decisions — Infrastructure)`](../production/deploy/decisions-infra.md) | I-01 ~ I-14 |
| ArchUnit 규칙 | [`Architecture Rules (ArchUnit)`](../structure/architecture-rules.md) | r1 ~ r22 |
| 평시 배포·롤백·장애 | [`운영 런북 (Runbook)`](../production/deploy/runbook.md) | 운영자용 절차서 |
| CI/CD 전체 흐름 | [`CI / CD 전체 플로우`](../production/deploy/ci-cd-flow.md) | commit 부터 운영 반영까지 |
| 도그푸딩 walkthrough | [`도그푸딩 walkthrough`](../start/dogfood-walkthrough.md) | 시간 순 narrative + 정착된 패턴 |
| secret 동기화 | [`secret chain 4-stage 통합 가이드`](../production/setup/secret-chain-4stage.md) | 4 곳 매핑 + 체크리스트 |
| 장애 시나리오 분석 | [`Edge Cases & Risk Analysis`](../reference/edge-cases.md) | 무엇이 깨질 수 있나 |
| 미완 항목 | [`Backlog`](../planned/backlog.md) | 진행 중 · 대기 |
| 키 교체 절차 | [`키 교체 절차 (Key Rotation)`](../production/setup/key-rotation.md) | PAT · Tailscale · Supabase · SSH |
| Mac mini 셋업 | [`Mac mini 운영 호스트 설정`](../production/setup/mac-mini-setup.md) | 물리 호스트 셋업 |
| 관측성 스택 | [`운영 모니터링 셋업 가이드`](../production/setup/monitoring-setup.md) | Loki · Grafana · Prometheus |
| 스토리지 셋업 | [`스토리지 셋업 가이드`](../production/setup/storage-setup.md) | MinIO · 시놀로지 NAS |
| 마이그레이션 | [`Migration Guides`](../api-and-functional/functional/migration.md) | Flyway 규칙 |

---

## 이 책 다음에는?

7단계까지 한 번 흐르고 나면 template 의 전체 사용 흐름이 머릿속에 잡혀요. 그다음은 본인 프로젝트의 도메인을 만들어 나가는 게 자연스러운 다음 단계예요.

진행하다 막히는 부분이 있으면 위 "깊이 있는 참조" 의 해당 문서를 펼쳐 보세요. 모든 문서는 서로 연결돼 있고, 어디로 가야 할지 막힌다면 이 책 목차로 다시 돌아오면 돼요.

행운을 빌어요.
