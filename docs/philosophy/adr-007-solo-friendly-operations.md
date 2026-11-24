<a id="adr-007--솔로-친화적-운영"></a>

# ADR-007 · 솔로 친화적 운영

**Status**: Accepted. 2026-11-24 개정: 솔로 한 사람이 감당할 수 있어야 한다는 상위 기준은 유지하고, 관리형 서비스와 직접 운영을 함께 사용하는 현재 구성에 맞춰 운영 방침을 정리했어요.

> **유형**: ADR · **독자**: Level 3

## 결론부터

모든 운영 결정의 상위 기준은 **솔로 한 사람이 감당할 수 있는가**예요. 도입 비용뿐 아니라 반복 작업, 장애 대응, 백업·복구, 이후 변경에 드는 시간을 함께 판단해요.

관리형 서비스와 직접 운영 중 하나만 고집하지 않아요. 현재는 Supabase·Resend·FCM 같은 외부 서비스와 홈서버의 Spring·MinIO·관측 스택을 함께 사용해요. 어느 쪽이든 실제 지출과 유지 시간을 비교하고, 운영자가 책임질 수 있는 범위에서 선택해요.

로컬 개발, 공통 기능 재사용, 필요한 기능만 선택하는 구조, 자격의 소유자별 관리 원칙은 유지해요. Kamal의 blue-green 배포도 현재 운영 방식에 포함해요. 다만 99.99% 가용성 SLA 보장, 멀티 리전, Kubernetes·서비스 메시, 마이크로서비스 분산 추적을 기본 운영 목표로 두지는 않아요.

## 왜 이런 고민이 시작됐나?

[프롤로그](./README.md)는 한 사람이 여러 앱을 개발하고 운영하는 상황을 전제로 해요. 앱마다 서버·배포·관측·자격 관리를 따로 만들면 공통 기능을 구현하는 것 외에도 관리할 대상이 늘어나요. 개발 중에도 버그 대응, 배포, 사용자 문의, 상태 확인에 시간을 나눠 써야 해요.

이 ADR은 운영 부담이 늘 때마다 같은 기준으로 판단하기 위한 기록이에요. 어떤 기술이 일반적으로 우수한지를 정하는 대신, 현재 앱에 필요한 효과와 운영자가 맡아야 할 일을 비교해요. 앱 수나 특정 일정만으로 감당할 수 있는 범위를 단정하지는 않아요.

> 새 운영 방식을 도입했을 때, 한 사람이 평소 관리와 장애 복구를 계속 책임질 수 있나요?

## 고민했던 대안들

<a id="option-1--업계-표준-따르기-마이크로서비스--k8s--분산-추적--9999-sla"></a>

### Option 1 — 업계 표준 따르기 (마이크로서비스 · K8s · 분산 추적 · 99.99% SLA)

확장과 팀별 독립 운영에 필요한 도구를 처음부터 도입하는 방식이에요. 여러 팀이 서비스를 따로 배포하거나 높은 가용성을 요구받는 환경에서는 검토할 이유가 있어요.

하지만 이 템플릿에 모두 도입하면 클러스터, 배포 설정, 서비스 간 통신, 추적 시스템까지 운영 대상이 늘어요. 현재 요구가 없는 기능을 준비하느라 앱 개발과 운영 검증에 쓸 시간을 줄일 수 있어요. 그래서 이 구성을 기본값으로 채택하지 않아요. 필요성이 확인되면 해당 요구와 비용을 따로 검토해요.

<a id="option-2--각-결정을-감당-시간-기준으로-개별-판단"></a>

### Option 2 — 각 결정을 감당 시간 기준으로 개별 판단

매번 상황에 맞게 판단할 수 있다는 장점이 있어요. 다만 판단 기준과 이유를 남기지 않으면, 비슷한 결정을 다시 검토하거나 과거 선택과의 차이를 설명하기 어려워요.

개별 판단은 계속하되 공통 기준과 기록 없이 운영하는 방식은 채택하지 않아요.

<a id="option-3-솔로-감당-가능성-을-명시적-상위-원칙-으로-선언-채택"></a>
<a id="option-3--솔로-감당-가능성-을-명시적-상위-원칙-으로-선언--채택"></a>

### Option 3 — 솔로 감당 가능성을 명시적 상위 원칙으로 선언 ★ (채택)

각 결정에 같은 질문을 적용하고, 채택한 이유와 맡게 될 운영 책임을 ADR에 남겨요. 비목표도 적어 두어 어떤 요구를 아직 지원하지 않는지 알 수 있게 해요.

이 원칙만으로 좋은 설계가 자동으로 나오지는 않아요. 예상한 비용과 실제 운영 부담이 다르면 판단을 다시 검토해야 해요. 따라서 도입 시의 편의와 이후의 유지 비용을 함께 보는 기준으로 사용해요.

## 결정

### 상위 원칙 선언

> 모든 운영 결정은 솔로 한 사람이 감당할 수 있어야 해요.

판단할 때는 다음을 확인해요.

- 지금 필요한 기능이나 운영 문제를 해결하는지 확인해요.
- 정기 점검, 업데이트, 자격 교체, 백업·복구를 누가 어떻게 수행할지 정해요.
- 앱이 늘어날 때 같은 작업을 반복해야 하는지 확인해요.
- 초기 도입 비용과 이후에 줄어드는 작업량을 함께 비교해요.
- 비용·시간 목표를 넘거나 장애 복구가 어려워지면 구성을 재검토해요.

<a id="적용-1--단일-배포-단위"></a>

### 적용 1 — 단일 배포 단위

`bootstrap`이 공통 구현 모듈과 등록된 앱을 하나의 실행 JAR로 조립하고, 이를 하나의 애플리케이션 이미지로 배포해요. 앱별 마이크로서비스를 각각 배포하는 방식은 기본 구조로 사용하지 않아요.

```text
common + core + 등록된 앱
             ↓ bootstrap:bootJar
          실행 JAR
             ↓ 이미지 빌드
      환경별 Spring 애플리케이션 배포
```

단일 배포 단위는 호스트의 컨테이너가 항상 하나라는 뜻은 아니에요. dev와 prod는 별도 서비스로 실행하고, blue-green 전환 중에는 이전·새 애플리케이션 컨테이너가 함께 있을 수 있어요. MinIO와 관측 스택도 애플리케이션과 별도로 운영해요.

<a id="적용-2-관리형-서비스-선호"></a>
<a id="적용-2--관리형-서비스-선호"></a>

### 적용 2 — 관리형 서비스와 직접 운영의 비교

관리형 서비스는 운영 작업을 줄일 수 있어요. 직접 운영도 기존 장비와 공통 인프라를 활용할 수 있으므로, **두 방식에 드는 시간·비용·복구 책임을 함께 비교해요**.

현재 구성에서 맡는 일은 다음과 같아요.

| 영역 | 현재 구성 | 운영자가 맡는 일 |
|---|---|---|
| 데이터베이스 | Supabase의 PostgreSQL | 앱별 스키마·권한, 마이그레이션, 백업·복구 절차 확인 |
| 이메일 | Resend | 발신 설정, 자격 관리, 발송 결과 확인 |
| 푸시 알림 | FCM | 앱 자격과 디바이스 토큰 관리, 발송·수신 확인 |
| 애플리케이션 호스트 | Mac mini 홈서버 | 호스트·Docker·네트워크·디스크 상태와 복구 관리 |
| 파일 스토리지 | NAS의 MinIO | 접근 권한, 용량, 데이터 보존·복구 관리 |
| 관측 | Prometheus·Loki·Grafana, 선택적으로 Alertmanager | 수집·보존·대시보드 관리와 알림 도착 확인 |
| 빌드·배포 | GitHub Actions·GHCR·Kamal | CI 결과, 이미지·자격, 배포·롤백 확인 |

관측 스택은 공통 인프라로 운영하고 dev·prod를 환경 라벨로 구분해요. Alertmanager는 알림 자격을 갖추고 해당 프로필을 활성화했을 때 사용해요. 로컬 개발 환경에는 이 운영 관측 스택을 기본으로 띄우지 않아요.

관리형 요금만 보거나 직접 운영의 전기·장비·저장 공간·유지 시간을 빠뜨리지 않아요. 월 비용은 실제 사용량과 직접 운영 지출을 합산해 기록하고, 서비스 조건이 달라지면 다시 비교해요.

<a id="적용-3--로컬-개발-우선"></a>

### 적용 3 — 로컬 개발 우선

일상 개발과 실험은 로컬에서 진행해요. 로컬 Docker의 PostgreSQL·MinIO와 필요한 개발용 어댑터로 피드백을 얻고, 실제 외부 서비스와의 연결은 dev 환경에서 확인해요. 운영 환경을 실험용으로 사용하지 않아요.

환경별 설정은 `.env`와 `application-local.yml`, `.env.dev`와 `application-dev.yml`, `.env.prod`와 `application-prod.yml`로 구분해요. 로컬에서 성공했다는 이유만으로 운영 자격이나 외부 연결까지 검증됐다고 보지는 않아요.

local 프로파일은 디버깅에 필요한 Actuator endpoint를 넓게 노출해요. dev·prod는 health·info·prometheus로 노출 범위를 제한하고, 실제 접근 통제는 보안 설정과 운영 네트워크에서 함께 관리해요.

<a id="적용-4--코드가-문서"></a>

### 적용 4 — 코드가 문서

반복 절차는 가능한 한 실행 가능한 스크립트로 제공해요. 새 앱 생성, 환경 초기화, 배포, 검증을 매번 수작업으로 재현하지 않도록 해요.

```bash
# 새 앱 뼈대 생성
./tools/app/new-app.sh <slug>

# 파생 저장소의 로컬·공유 인프라·운영 환경 초기화
bash tools/init/init-local.sh
bash tools/init/init-infra.sh
bash tools/init/init-prod.sh
# dev를 사용할 때는 init-dev.sh로 해당 환경을 준비해요.
```

명령이 있다고 필요한 자격과 입력까지 사라지는 것은 아니에요. 문서에는 준비 조건, 영향을 받는 자원, 실패 시 확인할 위치를 남겨요. 명령의 실제 동작은 코드에 맞추고, 같은 절차를 여러 문서에 복제하지 않아요. 시험 배포와 정리는 [도그푸딩 가이드](../start/dogfood-setup.md)를 따라 파생 저장소에서 진행해요.

공통 기능도 필요한 범위에서 사용해요. Lite 모드의 기능 토글과 외부 자격이 없는 상태의 동작은 서로 다르므로, 기능을 끌 때는 [기능 토글 가이드](../production/operations/feature-toggle.md)의 지원 범위와 의존 관계를 확인해요.

<a id="적용-5--자격의-소유자는-자격이-속한-곳"></a>

### 적용 5 — 자격의 소유자는 자격이 속한 곳

공유 호스트와 계정의 자격을 prod 환경의 소유로 두지 않아요. SSH·Cloudflare·GHCR·Tailscale처럼 dev와 prod가 함께 사용하는 값은 계정·호스트에 속하고, DB 연결이나 앱 자격은 사용하는 환경에 속해요.

공유 값을 `prod init`에서만 등록하면 dev만 사용하는 저장소도 prod 초기화에 의존하게 돼요. 두 환경이 같은 이름의 Secret을 각각 올리면 나중에 실행한 값으로 덮어쓸 수도 있어요. 이를 피하려고 다음처럼 나눠요.

| 소유 범위 | 파일 | 등록 책임 |
|---|---|---|
| 로컬 개발 | `.env` | 로컬 초기화 |
| 공유 계정·호스트 | `.env.infra` | `infra init`이 공유 자격을 접미사 없이 등록 |
| 환경별 설정 | `.env.dev`·`.env.prod` | 각 환경의 init이 해당 값을 등록 |

공유 인프라를 준비한 뒤에는 dev와 prod 중 어느 환경을 먼저 초기화해도 돼요. 서로의 환경 초기화를 선행 조건으로 요구하지 않아요.

`load_infra_env`는 `.env.infra`를 먼저 읽고 환경 파일을 나중에 읽어요. 같은 키가 양쪽에 있으면 환경 파일이 우선하므로 특정 환경만 다른 값을 사용할 수 있어요. 공통 로더는 `.env.infra`가 없는 기존 저장소도 읽을 수 있지만, 새 초기화 절차의 필수 입력까지 면제하는 것은 아니에요. 값의 소유자와 전달 경로를 분명히 해서 초기화 순서에 대한 기억에 의존하지 않도록 해요.

<a id="적용-6--ci-는-빨간불-아니면-초록불"></a>

### 적용 6 — CI 는 빨간불 아니면 초록불

필수 검사가 실패한 상태를 정상으로 취급하지 않아요. 포맷, 빌드·테스트, ArchUnit, 설정된 커버리지 기준처럼 배포 판단에 사용하는 검사는 성공과 실패를 명확히 구분해요. 이 원칙이 모든 경고를 실패로 바꾸거나 커버리지 100%를 요구한다는 뜻은 아니에요.

현재 `ci.yml`은 main·develop 대상 PR과 두 브랜치의 push, 수동 실행을 처리해요. `CI_ON_PUSH=false`는 push 검증을 건너뛰게 하므로, 자동 배포에 CI 성공이 필요한 파생 저장소에서는 실행 조건을 함께 확인해요. 자동 배포는 다음처럼 나뉘어요.

| 검증 브랜치 | 배포 환경 | 배포 조건 |
|---|---|---|
| `develop` | dev | 해당 CI 성공과 `DEPLOY_ENABLED_DEV=true` |
| `main` | prod | 해당 CI 성공과 `DEPLOY_ENABLED=true` |

각 배포는 대상 SHA의 이미지를 준비하고 Kamal로 새 컨테이너의 health를 확인한 뒤 트래픽을 전환해요. 수동 배포는 별도 경로이므로 검증한 SHA를 선택해야 해요. 머지 전 검사를 강제하려면 저장소의 branch protection도 설정해야 해요.

실패해도 배포를 막지 않는 검사는 구분해서 관리해요. 현재 OWASP 검사는 CI에서 `continue-on-error`로 실행하고, gitleaks는 별도 보안 워크플로예요. 결과를 확인하고 후속 조치를 해야 하며, CI 성공을 모든 보안 검사의 통과로 해석하지 않아요. 정확한 게이트는 [CI/CD 흐름](../production/deploy/ci-cd-flow.md)이 정본이에요.

<a id="비목표--우리-목표가-아닌-것-명시"></a>

### 비목표 — 우리 목표가 아닌 것 명시

| 비목표 | 현재 범위와 이유 |
|---|---|
| 99.99% 고가용성 SLA 보장 | 이 템플릿은 해당 가용성을 측정·보증하는 운영 체계를 제공하지 않아요. 외부 서비스의 SLA만으로 앱 전체의 가용성을 보장하지도 않아요. |
| 멀티 리전 배포 | 기본 운영에 리전 간 복제·장애 전환을 넣지 않아요. 실제 지연·복구 요구가 생기면 데이터 정합성과 운영 비용을 함께 검토해요. |
| 모든 상황의 무중단 보장 | Kamal blue-green은 채택하지만 호스트·외부 서비스 장애, 장기 요청, 호환되지 않는 스키마 변경까지 무중단을 보장하지 않아요. 고정된 중단 시간을 약속하지 않아요. |
| 마이크로서비스 분산 추적 | 단일 애플리케이션 프로세스를 기본으로 로그·메트릭·알림을 관리해요. Jaeger·Zipkin 같은 분산 추적 체계를 기본으로 추가하지 않아요. |
| Kubernetes·Helm·서비스 메시 | 현재 배포 단위에 클러스터와 서비스 간 제어 계층을 추가하지 않아요. 독립 서비스 운영 요구가 생기면 다시 판단해요. |

blue-green 자체나 관측 스택의 직접 운영은 비목표가 아니에요. 현재 채택한 수단이며, 같은 상위 기준으로 유지 비용을 점검해요. 비목표를 바꿀 때는 새 요구와 감당할 운영 책임을 후속 결정으로 남겨요.

## 이 선택이 가져온 것

### 긍정적 결과

운영 단위와 자격의 소유자가 정해져 있어 새 앱에도 같은 절차를 사용할 수 있어요. 공통 관측 스택을 사용하면 앱마다 별도 수집·대시보드 체계를 만들 필요를 줄일 수 있어요. 관리형 비용과 직접 운영 시간을 나란히 비교할 기준도 생겨요.

[모듈러 모놀리스](./adr-001-modular-monolith.md), [앱별 스키마](./adr-005-db-schema-isolation.md), [HS256 JWT](./adr-006-hs256-jwt.md) 같은 결정도 이 기준 아래에서 이해할 수 있어요. 실제 효과는 각 환경의 지출과 운영에 든 시간을 기록해 확인해요.

### 부정적 결과

한 호스트와 공유 관측 스택에 의존하므로 호스트 장애나 자원 경합이 여러 환경에 영향을 줄 수 있어요. 직접 운영하는 MinIO와 관측 데이터에는 용량·업데이트·백업·복구 책임이 남아요. 관리형 서비스도 요금, 한도, 장애, 외부 자격 관리의 영향을 받아요.

트래픽·팀·복구 요구가 바뀌면 배포 단위나 데이터베이스 구성을 다시 나눠야 할 수 있어요. 모듈 경계는 그 작업을 돕지만 전환 비용을 없애지는 않아요. blue-green 중에는 이전 코드와 새 코드가 함께 실행될 수 있으므로 스키마 변경의 호환성도 지켜야 해요.

### 비목표 명시의 효과

비목표는 검토한 범위와 아직 맡지 않은 운영 책임을 알려줘요. 같은 논의를 반복할 때 이전 이유를 확인할 수 있고, 새 기능이 추가될 때 현재 책임 범위를 넘는지도 판단할 수 있어요. 요구가 달라졌는데도 재검토를 막기 위한 규칙으로 사용하지 않아요.

## 교훈

### 비목표 선언이 선언 자체로 가치를 가져요

무엇을 채택했는지만큼 무엇을 제공하지 않는지도 적어요. 특히 blue-green을 사용한다는 설명과 가용성을 보장한다는 약속을 구분해요. 독자가 현재 운영의 한계를 알 수 있어야 해요.

### 원칙은 예외를 관리해야 해요

초기 비용이 있다는 이유만으로 자동화나 검사를 거절하지 않아요. [Conventional Commits와 SemVer](./adr-015-conventional-commits-semver.md), 문서 검증, 배포 자동화처럼 이후의 반복 작업을 줄이는 수단은 유지 비용까지 함께 비교해요. 기대한 절감 효과가 나타나지 않으면 구성과 범위를 다시 검토해요.

<a id="업계-표준-거절의-정당성은-기록-으로만-유지돼요"></a>

### 업계 표준 거절의 정당성은 기록으로 유지해요

도구를 채택하거나 보류할 때 현재 요구, 기대 효과, 추가 책임, 다시 검토할 조건을 남겨요. 운영자가 바뀌거나 규모가 달라져도 당시 판단을 이해할 수 있도록 하기 위해서예요. 기술의 유행 여부만으로 채택하거나 거절하지 않아요.

## 관련 사례 (Prior Art)

- [DHH, The One Person Framework](https://world.hey.com/dhh/the-one-person-framework-711e6318) — 한 사람이 앱을 만들 수 있도록 도구의 복잡도를 줄이는 관점을 참고할 수 있어요.
- [DHH, The Majestic Monolith](https://signalvnoise.com/svn3/the-majestic-monolith/) — 조직 규모와 운영 구조를 함께 판단하는 사례예요.

## Code References

| 영역 | 현재 구현 |
|---|---|
| 애플리케이션 조립 | [bootstrap/build.gradle](https://github.com/storkspear/template-spring/blob/main/bootstrap/build.gradle), [Dockerfile.runtime](https://github.com/storkspear/template-spring/blob/main/Dockerfile.runtime) |
| 로컬 실행 | [docker-compose.local.yml](https://github.com/storkspear/template-spring/blob/main/infra/docker-compose.local.yml), [application-local.yml](https://github.com/storkspear/template-spring/blob/main/bootstrap/src/main/resources/application-local.yml) |
| 운영 관측 스택 | [docker-compose.observability.yml](https://github.com/storkspear/template-spring/blob/main/infra/docker-compose.observability.yml) |
| 공유 자격과 초기화 | [tools/lib/common.sh](https://github.com/storkspear/template-spring/blob/main/tools/lib/common.sh), [init-infra.sh](https://github.com/storkspear/template-spring/blob/main/tools/init/init-infra.sh), [init-dev.sh](https://github.com/storkspear/template-spring/blob/main/tools/init/init-dev.sh), [init-prod.sh](https://github.com/storkspear/template-spring/blob/main/tools/init/init-prod.sh) |
| 앱 생성 | [new-app.sh](https://github.com/storkspear/template-spring/blob/main/tools/app/new-app.sh) |
| 검증과 배포 | [ci.yml](https://github.com/storkspear/template-spring/blob/main/.github/workflows/ci.yml), [deploy-dev.yml](https://github.com/storkspear/template-spring/blob/main/.github/workflows/deploy-dev.yml), [deploy.yml](https://github.com/storkspear/template-spring/blob/main/.github/workflows/deploy.yml) |
| 배포·관측 운영 절차 | [운영 런북](../production/deploy/runbook.md), [모니터링 설정](../production/setup/monitoring-setup.md) |

관련 결정은 [ADR-001](./adr-001-modular-monolith.md), [ADR-005](./adr-005-db-schema-isolation.md), [ADR-006](./adr-006-hs256-jwt.md), [ADR-008](./adr-008-no-api-versioning.md), [ADR-015](./adr-015-conventional-commits-semver.md)를 함께 읽어요.
