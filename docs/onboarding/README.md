# 📚 spring-backend-template — 책 목차 (Developer Journey)

이 문서는 `docs/` 안의 모든 문서를 **읽는 순서** 로 안내합니다.

`README.md` 의 30분 QuickStart 만으로도 첫 기동은 됩니다. 이 책은 그 이후, 레포의 정체와 사용 흐름을 차근차근 이해하고 싶을 때 읽는 안내서입니다.

각 단계 끝에는 다음 단계로 넘어가는 링크가 있습니다. 책처럼 위에서 아래로 한 번 흐르듯 읽으면 자연스럽게 전체 그림이 잡힙니다.

> 💡 막히면: [도그푸딩 함정 모음](../start/dogfood-pitfalls.md) / [도그푸딩 FAQ](../start/dogfood-faq.md) 부터 검색해 보세요.

---

## 0. 시작 전 — README 의 QuickStart (30분)

이미 마치셨다면 1단계로 넘어가세요. 안 했다면 레포 루트의 `README.md` 의 "30분 QuickStart" 부터 따라가세요.

> 💡 **아직 "이 레포를 쓸지 말지" 결정 전** 이면 먼저 [`level0/`](./getting-started.md) (3~10 분) 를 읽으세요. 코드를 돌리지 않고도 레포의 정체와 구조 큰 그림이 잡힙니다.

QuickStart 는 다음을 합니다.

- 로컬 dev 환경 부팅 (`tools/bootstrap.sh`)
- Spring 첫 기동 확인
- 첫 앱 모듈 생성 (`tools/new-app/new-app.sh`)

이 책은 QuickStart 가 끝났다는 가정에서 시작합니다.

---

## 1. 이 레포가 뭐야? (15분)

이 레포의 **정체** 를 이해합니다. 어떤 종류의 프로젝트이고, 왜 이렇게 설계됐는지 큰 그림을 잡습니다.

읽을 문서:

1. [`philosophy/README.md`](../philosophy/README.md) 의 **프롤로그** (3 제약 · 독자 페르소나) + **테마 1 의 ADR-001 ~ ADR-003** 만 먼저 읽으세요.
   - [ADR-001 · 모듈러 모놀리스](../philosophy/adr-001-modular-monolith.md) (왜 마이크로서비스가 아닌가)
   - [ADR-002 · GitHub Template Repository 패턴](../philosophy/adr-002-use-this-template.md) (왜 fork 가 아닌 template 인가)
   - [ADR-003 · `-api` / `-impl` 분리](../philosophy/adr-003-api-impl-split.md) (왜 포트 인터페이스 분리인가)

2. [`architecture.md`](../structure/architecture.md) 의 **§ 전체 구성 요약** 한 섹션만 읽으세요. 모듈 4종류 (`common/` · `core/` · `apps/` · `bootstrap`) 와 기술 스택의 한눈 요약이 있습니다.

여기까지 읽으면 "이 레포가 뭘 하려는 도구인지" 감이 잡힙니다. 나머지 ADR (총 16 개, 테마 2~5) 은 나중에 해당 영역이 궁금해질 때 돌아오세요.

---

## 2. 어떻게 써? — 로컬 개발 (1시간)

본인 노트북에서 dev 환경을 띄우고 Spring 을 직접 돌려 봅니다.

읽을 문서:

- [`guides/onboarding.md`](../start/onboarding.md) — 전체 한 번 정독.

핵심 흐름은 다음과 같습니다.

1. `§1 사전 설치 체크리스트` — JDK 21+, Docker, Node 18+ 설치 확인.
2. `§2 파생 레포 생성` — "Use this template" 으로 본인 레포 만들기 (지금은 template 자체를 보고 있다면 skip).
3. `§3 환경 변수 설정` — `.env.example` → `.env` 복사 후 채우기.
4. `§4 첫 기동` — `tools/bootstrap.sh` 실행 → Spring `bootRun` 으로 동작 확인.

여기까지 마치면 본인 노트북에서 Spring 이 살아 움직입니다.

---

## 3. 클론 후 뭐부터? — 첫 앱 모듈 추가 (30분)

template 은 비즈니스 로직 없이 뼈대만 가지고 있습니다. 실제로 쓰려면 **앱 모듈** 을 하나 추가해야 합니다.

읽을 문서:

- [`guides/onboarding.md`](../start/onboarding.md) **§5 앱 모듈 추가 (`new-app.sh`)** 섹션.

수행하는 일:

```bash
./tools/new-app/new-app.sh <slug> --provision-db
```

이 명령은 `apps/app-<slug>/` 디렉터리를 만들고, Postgres 에 앱 전용 schema + role 을 자동 생성합니다. 자세한 동작과 생성되는 파일 목록은 위 §5 에 표로 정리돼 있습니다.

여기까지 끝나면 본인 앱 도메인이 코드 위에 올라간 상태가 됩니다.

---

## 4. 발급은 어디서? — 외부 리소스 (1시간)

운영 배포로 넘어가려면 외부 서비스의 자격 증명을 발급받아야 합니다. 어디서 어떻게 받는지가 막히는 지점이라, 두 문서로 나뉘어 안내합니다.

### 4.1 소셜 로그인 자격 증명

[`social-auth-setup.md`](../start/social-auth-setup.md) 를 읽으세요.

- Google Sign In Client ID 발급 절차 + Console 에서 입력할 값
- Apple Sign In Bundle ID + Service ID 발급 절차

각 발급 후 `.env` 의 `APP_CREDENTIALS_<SLUG>_*` 변수에 채워 넣습니다.

### 4.2 운영 배포 자격 증명 (Tailscale OAuth · GitHub PAT · Supabase)

[`guides/dogfood-setup.md`](../start/dogfood-setup.md) **§3 외부 리소스 발급** 섹션을 읽으세요.

- §3.1 GitHub PAT (GHCR push 권한)
- §3.2 Tailscale OAuth client (GHA → Mac mini 라우팅)
- §3.3 Mac mini SSH 셋업
- §3.5 Supabase Connection 정보

각 항목에 화면 캡처 없이도 따라갈 수 있게 클릭 경로 + 주의사항 (잘못 발급되는 함정 포함) 까지 적혀 있습니다.

---

## 5. 테스트 어떻게? — 도그푸딩 자동 검증 (자동)

발급 받은 값으로 template 자체가 운영 환경에 올라가는지 한 사이클 검증합니다.

읽을 문서:

- [`guides/dogfood-setup.md`](../start/dogfood-setup.md) **§4 ~ §6** (작성 + 실행 + 동작 확인).
- 막히면 [`troubleshooting/dogfood-pitfalls.md`](../start/dogfood-pitfalls.md).

핵심 명령은 두 줄입니다.

```bash
cp tools/dogfooding/.env.dogfood{.example,}
$EDITOR tools/dogfooding/.env.dogfood
bash tools/dogfooding/setup.sh
```

`setup.sh` 가 GitHub Actions Variables / Secrets 일괄 등록 + GHA 용 SSH 키 발급 + DEPLOY_ENABLED 토글 + 자동 배포 trigger 까지 한 번에 처리합니다.

배포가 실행되는 전체 흐름이 궁금하다면 [`architecture/ci-cd-flow.md`](../production/deploy/ci-cd-flow.md) 의 다이어그램을 참고하세요.

---

## 6. 정리? — cleanup (5분)

검증이 끝났으면 깨끗하게 정리하고 template 순수 상태로 돌립니다.

읽을 문서:

- [`guides/dogfood-setup.md`](../start/dogfood-setup.md) **§7 `cleanup.sh` 실행** 섹션.

핵심 명령은 한 줄입니다.

```bash
bash tools/dogfooding/cleanup.sh
```

이 명령이 다음을 모두 처리합니다.

- GitHub Variables / Secrets 전체 삭제
- Mac mini 의 spring 컨테이너 + kamal-proxy + authorized_keys 의 GHA 키 정리
- GHCR 의 도그푸딩 이미지 삭제

외부 서비스 (PAT / Tailscale OAuth) 의 키 자체는 **본인이 직접 폐기** 해야 합니다. 절차는 [`security/key-rotation.md`](../production/setup/key-rotation.md) 에 있습니다.

---

## 7. 이제 use this template — 파생 레포 첫 배포 (30분)

template 의 구조와 자동화를 이해했으니, 이제 실제 본인 프로젝트로 옮길 차례입니다.

읽을 문서:

1. [`guides/deployment.md`](../production/deploy/deployment.md) — "Use this template" 으로 만든 파생 레포를 Mac mini 에 처음 배포하는 onboarding.
2. [`guides/cross-repo-cherry-pick.md`](../start/cross-repo-cherry-pick.md) — template 에 새 변경이 생겼을 때 파생 레포로 가져오는 방법.

핵심 흐름은 도그푸딩과 거의 동일합니다 (5 ~ 6단계). 차이는:

- 파생 레포는 본인 도메인 / 본인 인프라 값으로 채웁니다.
- DEPLOY_ENABLED 가 본격 운영 모드라 cleanup 으로 되돌릴 일이 없습니다.

---

## 사이드바 9 그룹 — 어떤 순서로 읽을까

문서는 독자 Level 별로 9 그룹으로 묶여 있습니다. 처음 방문이라면 위에서 아래로, 숙련되면 관심 그룹만 펼쳐 보세요.

| 그룹 | Level | 시간 | 무엇을 찾을 수 있나 |
|---|---|---|---|
| 📚 입문 | 0 | 3~10분 | [Level 0 진입점](./getting-started.md) · [5분 투어](./five-minute-tour.md) · 용어 사전 · 첫 실행/수정/배포 맛보기 |
| 🏃 시작하기 | 1 | 1~2시간 | [Onboarding](../start/onboarding.md) · Social Auth · App Scaffolding · Dogfood · Cherry-pick |
| 🏗️ 구조 이해하기 | 2 | 1시간 | [Architecture](../structure/architecture.md) · Module Deps · ArchUnit Rules · Multitenant · JWT Auth |
| 📖 프로젝트 철학 | 3 | 2~3시간 | [16 ADR 인덱스](../philosophy/README.md) · 테마 1~6 (모듈/데이터/운영/엔티티/레이어/테스트) |
| 📝 코딩 규약 | 2 | 1시간 | Design Principles · Naming · DTO · Exception · Git Workflow |
| 🔌 API 및 기능 | 2 | 필요 시 | API Response · Push · Email · Storage · Migration · Observability |
| ✅ 테스팅 | 2 | 필요 시 | [Testing Strategy](../production/test/testing-strategy.md) · Contract Testing |
| 🛠️ 운영 | 2.5+ | 운영자용 | Infrastructure · CI/CD · Deployment · [Runbook](../production/deploy/runbook.md) · Edge Cases · Key Rotation |
| 📚 참고 | — | — | App Scaffolding · Backlog · [STYLE_GUIDE](../reference/STYLE_GUIDE.md) (저자용) |

## 깊이 있는 참조 — 자주 찾는 것

| 궁금한 것 | 문서 | 한 줄 |
|---|---|---|
| 왜 이렇게 설계? | [`philosophy/README.md`](../philosophy/README.md) | 16 ADR · 프롤로그 3 제약 |
| 문서 작성 규칙 (저자) | [`../STYLE_GUIDE.md`](../reference/STYLE_GUIDE.md) | 5 유형 템플릿 · 메타블록 규격 · 검증 체크리스트 |
| 모듈 구조 상세 | [`./architecture.md`](../structure/architecture.md) | 파일 트리 + 의존 그래프 + Extraction 6 레이어 |
| 환경별 인프라 현황 | [`../infra/infrastructure.md`](../production/deploy/infrastructure.md) | 어떤 서비스가 어디에서 도는지 |
| 인프라 결정 근거 | [`../infra/decisions-infra.md`](../production/deploy/decisions-infra.md) | I-01~I-13 |
| ArchUnit 22 규칙 | [`../architecture/architecture-rules.md`](../structure/architecture-rules.md) | r1~r22 |
| 평시 배포/롤백/장애 | [`../infra/runbook.md`](../production/deploy/runbook.md) | 운영자용 절차서 |
| CI/CD 전체 흐름 | [`../infra/ci-cd-flow.md`](../production/deploy/ci-cd-flow.md) | commit → 운영 반영 |
| 장애 시나리오 분석 | [`../infra/edge-cases.md`](../reference/edge-cases.md) | 무엇이 깨질 수 있나 |
| 미완 항목 | [`../reference/backlog.md`](../planned/backlog.md) | 진행 중 / 대기 |
| 키 교체 절차 | [`../infra/key-rotation.md`](../production/setup/key-rotation.md) | PAT / Tailscale / Supabase / SSH |
| Mac mini 셋업 | [`../infra/mac-mini-setup.md`](../production/setup/mac-mini-setup.md) | 물리 호스트 셋업 |
| 관측성 스택 | [`../infra/monitoring-setup.md`](../production/setup/monitoring-setup.md) | Loki / Grafana / Prometheus |
| 스토리지 셋업 | [`../infra/storage-setup.md`](../production/setup/storage-setup.md) | MinIO / NAS |
| 마이그레이션 | [`../features/migration.md`](../api-and-functional/functional/migration.md) | Flyway 규칙 |

---

## 이 책 다음에는?

7단계까지 한 번 흐르고 나면 template 의 전체 사용 흐름이 머릿속에 잡힙니다. 그 다음은 **본인 프로젝트의 도메인을 만들어 나가는 것** 이 자연스러운 다음 단계입니다.

진행하면서 막히는 부분이 있으면 위 "깊이 있는 참조" 의 해당 문서를 펼쳐 보세요. 모든 문서는 서로 연결돼 있으며, 어디로 가야 할지 막힌다면 이 책 목차로 다시 돌아오면 됩니다.

행운을 빕니다.
