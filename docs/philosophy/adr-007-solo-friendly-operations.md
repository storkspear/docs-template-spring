# ADR-007 · 솔로 친화적 운영

**Status**: Accepted. 2026-04-24 기준 운영 모든 결정의 **상위 판단 기준**. 개별 ADR 들은 이 원칙의 구체 적용이에요. 단일 bootstrap JAR + 관리형 서비스 스택 + 한 Postgres 인스턴스 + 하나의 GitHub Actions CI 로 운영 중.

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~5분

## 결론부터

운영 결정은 전부 한 가지 물음에 답합니다 — **"솔로 한 사람이 감당 가능한가?"**. 이 물음이 통과하지 못하면 기각해요. 단일 JAR 배포 · Supabase/Resend/FCM/R2 같은 관리형 서비스 의존 · 로컬 개발 우선 · 코드가 문서 · CI 는 빨간불 아니면 초록불 — 전부 이 원칙의 파생입니다. 동시에 **"우리 목표가 아닌 것"** 도 명시 — HA 99.99%, 멀티 리전, 무중단 배포, 분산 트레이싱. 이것들은 "나쁘다" 가 아니라 **"지금 필요하지 않다"**.

## 왜 이런 고민이 시작됐나?

[프롤로그의 제약 3 (복권 사기 모델)](./README.md#제약-3--복권-사기-모델) 에서 우리는 한 명이 **여러 앱을 동시에** 운영하는 구조를 전제로 했어요. 이 구조의 현실은 아래처럼 보입니다:

- 오전 9시: 개발 (앱 A 신기능)
- 11시: 앱 B 버그 리포트 대응
- 오후 2시: 앱 C 배포
- 3시: 앱 D 유저 문의 응대
- 5시: 전체 모니터링 확인
- 7시: 다시 앱 A 개발 복귀

문제는 **각 앱이 "자기 몫의 운영 부담"** 을 가져온다는 거예요. 유지 가능한 범위를 넘으면 다음 중 하나 발생:

1. **어느 앱이든 버린다** — 실제 앱 공장의 공장성 파괴
2. **운영 수준을 낮춘다** — 장애 대응 지연, 유저 이탈
3. **번아웃** — 개발 자체가 중단

이 결정이 답할 물음은 이거예요.

> **솔로 개발자가 N 개 앱을 동시 운영하는 것이 지속 가능하려면, 각 운영 결정의 상위 기준은 무엇이어야 하는가?**

단순히 "단순하게 하자" 가 아니라 — **"새 운영 결정 하나하나가 솔로 여유 시간을 얼마나 잡아먹는가"** 를 계산하는 **명시적 프레임** 이 필요했어요.

## 고민했던 대안들

### Option 1 — 업계 표준 따르기 (마이크로서비스 · K8s · 분산 추적 · 99.99% SLA)

테크 조직의 기본 스택. "대기업 backend 처럼" 을 기본값으로.

- **장점**:
  - 확장 시점 도달 시 그대로 통함 (ambition 을 미리 확보)
  - 이력서상 매력적 (채용 대비)
  - 업계 표준이라 레퍼런스/인재 풀 풍부
- **단점**:
  - **모든 스택 레이어가 운영 부담을 추가** — K8s 는 노드/Helm/Ingress 관리, 분산 추적은 Zipkin/Jaeger 운영, HA 99.99% 는 멀티 리전 페일오버
  - 앱당 운영 부담 = 스택 복잡도 × 앱 수 → 앱 3개만 되어도 솔로 임계치 초과
  - "쓸 데가 없는 복잡도" — 하루 유저 100명 규모에서 K8s 노드 자동 스케일링은 비즈니스 가치 0
- **탈락 이유**: 이력서 이득 vs 실제 운영 붕괴 위험. 앱 공장 전략 ([제약 3](./README.md#제약-3--복권-사기-모델)) 의 "여러 앱 시도" 자체가 불가능해짐.

### Option 2 — 각 결정을 "감당 시간" 기준으로 개별 판단

스택 전체에 라벨을 붙이지 않고, 개별 결정마다 "내가 감당 가능한가?" 를 묻는 방식.

- **장점**:
  - 유연함. 맥락별 판단.
- **단점**:
  - **기준이 매 순간 재계산됨** — 지칠 때는 "다 접자", 컨디션 좋을 때는 "다 도입하자". 결과적으로 무원칙.
  - 과거 결정과의 일관성 점검 불가 — "이 결정이 제약 1 과 정합?" 같은 메타 질문을 물을 축이 없음
  - 다른 사람이 레포를 보면 결정의 근거가 흩어져 있어 복원 불가
- **탈락 이유**: 원칙 없이 판단하는 건 결국 원칙 있는 판단보다 더 많은 피로를 낳음. 매번 재고하는 비용.

### Option 3 — "솔로 감당 가능성" 을 **명시적 상위 원칙** 으로 선언 ★ (채택)

모든 운영 결정의 **메타 기준** 으로 "솔로가 감당 가능한가?" 를 선언. 개별 결정들은 이 원칙의 파생물이라는 구조.

- **장점**:
  - **결정 프레임 통일** — 새 결정이 들어왔을 때 물을 질문이 명확
  - **일관성 자동 검증** — 개별 결정들이 상위 원칙과 정합한지 점검 가능
  - **"비목표" 명시로 거부 근거 보존** — "HA 99.99% 왜 안 해?" 에 매번 해명할 필요 없음
  - **ADR 들의 서사 통일** — 각 ADR 이 왜 그렇게 결정됐는지의 뿌리가 이 원칙
- **단점**:
  - 원칙 선언 자체는 문서 작업. 코드 변화 없음.
  - 잘못된 원칙이면 하위 결정들이 전부 틀어짐 (단일 실패 지점)
- **채택 이유**:
  - 단점 중 "원칙이 틀릴 수 있다" 는 아래 '교훈' 섹션에서 검증 가능
  - 앱 공장 전략의 성립 전제이기도 함 — 원칙 없이 감당은 불가능

## 결정

### 상위 원칙 선언

> **모든 운영 결정은 "솔로 한 사람이 감당 가능한가?" 를 통과해야 한다.**

이 원칙의 **현재 구체 적용** 은 아래와 같아요.

### 적용 1 — 단일 배포 단위

```
bootstrap/ (모든 core-*-impl 포함)
   │
   │ bootJar
   ▼
bootstrap/build/libs/bootstrap.jar  ← 단일 fat JAR
   │
   │ docker build
   ▼
Single container image  ← 단일 배포 유닛
```

```gradle
// bootstrap/build.gradle 발췌
plugins { id 'factory.bootstrap-module' }

dependencies {
    implementation project(':common:common-logging')
    implementation project(':common:common-web')
    // core-auth-impl · core-device-impl · core-push-impl ... 모두 포함
}
```

여러 서비스를 동시에 배포하지 않아요. 한 명령 = 한 개 배포.

### 적용 2 — 관리형 서비스 선호

직접 운영하지 않고 **외부 관리** 에 맡깁니다. 우리가 직접 운영하는 건 Spring Boot 프로세스 + 몇 개의 bash 스크립트뿐.

| 영역 | 관리형 | 우리 역할 |
|---|---|---|
| Postgres | Supabase | 스키마 정의, 마이그레이션 |
| 이메일 | Resend | API 호출 + 템플릿 |
| 푸시 알림 | FCM (Firebase) | 디바이스 토큰 관리 + send 호출 |
| 스토리지 | Cloudflare R2 (MinIO 호환) | 업로드 API |
| 배포 | GitHub Actions + 맥미니 | bash 스크립트 + blue/green swap |

각 관리형 서비스의 비용 (월 단위) 은 의식적으로 추적. 운영 부담 → 돈으로 환산해서 비교.

### 적용 3 — 로컬 개발 우선

```yaml
# infra/docker-compose.dev.yml 발췌
services:
  postgres:
    image: postgres:16-alpine
  minio:
    image: minio/minio:RELEASE.2025-01-20T14-49-07Z
```

개발은 **로컬 Docker** 에서. 프로덕션에서 실험 금지. `application-dev.yml` vs `application-prod.yml` 을 파일 단위로 분리.

```yaml
# application-dev.yml — 모든 actuator endpoint 노출 (디버깅 편의)
management:
  endpoints.exposure.include: "*"

# application-prod.yml — 민감 endpoint 제한
management:
  endpoints.exposure.include: health,info,prometheus
```

### 적용 4 — 코드가 문서

긴 README 를 쓰기보다 **스크립트를 완성** 하는 걸 우선.

```bash
# 새 앱 추가: 한 줄
./tools/new-app/new-app.sh gymlog

# 도그푸딩 환경 셋업: 한 줄
bash tools/dogfooding/setup.sh

# 파생 레포 부팅: 한 줄
bash tools/bootstrap.sh
```

"README 를 자주 업데이트한다" 는 약속보다, 스크립트가 의도대로 동작한다는 게 더 신뢰 가능.

### 적용 5 — CI 는 빨간불 아니면 초록불

```yaml
# .github/workflows/ci.yml 발췌
- name: Build
  run: ./gradlew build --no-daemon --stacktrace  # 테스트 + ArchUnit 전부 포함

# 빌드 실패 → main push/merge 차단
# 경고 무시 · 테스트 스킵 · 커버리지 <100% 허용 같은 회색 지대 없음
```

회색 지대 (경고만 있음 / 일부 테스트 스킵 / "나중에 고치면 됨") 를 만들지 않음. 회색 지대는 솔로의 정신력을 매일 조금씩 갉아먹는다는 걸 반복 경험으로 학습.

### 비목표 — "우리 목표가 아닌 것" 명시

이 원칙의 뒷면은 아래가 **우리 목표가 아니다** 라는 선언.

| 비목표 | 왜 아닌가 |
|---|---|
| **고가용성 99.99% SLA** | 인디 스케일에서는 99% 면 충분. 관리형 서비스의 SLA 에 편승. |
| **전 세계 멀티 리전** | 국내 유저 대상. Seoul 리전 하나면 충분. 멀티 리전 = 복제 지연 · 데이터 정합성 관리 추가. |
| **무중단 배포** | 짧은 재시작 다운타임 (30초) 수용. blue/green swap 으로 0 다운타임 구현은 과잉. |
| **마이크로서비스 분산 추적** | 단일 프로세스라 필요 없음. 한 로그 파일에 전부 있음. |
| **쿠버네티스 / Helm** | `infra/` 에 관련 파일 없음. 운영 단위 1 = 컨테이너 1 = K8s 불필요. |

이것들은 "**중요하지 않다**" 가 아니라 **"우리 단계에서는 필요하지 않다"** 입니다. 필요해지는 시점이 오면 그때 추가.

## 이 선택이 가져온 것

### 긍정적 결과

**결정 시간 단축** — 새로운 기술/스택이 제안됐을 때, "솔로 감당 가능?" 한 질문으로 대부분 필터링. 세부 비교를 거치지 않고도 거절 가능.

**원칙의 파급 효과** — [ADR-001 (모듈러 모놀리스)](./adr-001-modular-monolith.md) 의 "운영 단위 1", [ADR-005 (단일 Postgres)](./adr-005-db-schema-isolation.md) 의 "Supabase 관리형", [ADR-006 (HS256 JWT)](./adr-006-hs256-jwt.md) 의 "비밀 키 1개" — 전부 본 ADR 의 파생. 결정들의 서사가 통일됨.

**비용 추적의 가시성** — 관리형 서비스 지출이 월 $50~$100 (Supabase + Resend + FCM + R2 + 도메인) 수준. 앱이 10개여도 동일. 솔로 개발자의 가처분 시간 vs 관리형 지출의 트레이드오프가 숫자로 보임.

**번아웃 회피** — 매 결정마다 "이거 감당 가능한가?" 를 물으므로, 감당 불가 결정이 사전 차단됨. 실제 운영 1년 경과 후 여전히 개발 지속 중.

### 부정적 결과

**확장 시점에 부채로 돌아올 가능성** — 만약 한 앱이 대박 터져서 유저 수가 10배 증가하면, 관리형 서비스의 제약/단가가 문제될 수 있음. K8s · 분산 추적 · 멀티 리전이 진짜로 필요해짐. 완화: 본 ADR 은 **"지금 필요하지 않다"** 를 명시 — 필요해진 시점에 도입. 현재 구조는 미래 확장 경로가 차단되지 않음 (단일 Postgres → 멀티 인스턴스, 모놀리스 → 마이크로서비스 모두 이행 가능).

**레퍼런스 / 인재 풀 협소** — "한국 인디가 썼던 기법" 은 "대기업 backend" 레퍼런스보다 적음. 대부분의 튜토리얼이 K8s · 마이크로서비스 전제라 번역 필요. 완화: 본 문서화 프로젝트 (ADR 시리즈) 가 그 "레퍼런스 부재" 를 스스로 채우는 행위.

**채용 시 "너무 단순한 스택" 인식** — 주니어 개발자가 본 레포를 보고 "기술 스택이 평범해서 배울 게 없다" 고 느낄 위험. 완화: 본 ADR 시리즈 자체가 "평범한 스택을 왜 선택했는가" 의 깊이를 보여줌. 단순함이 단지 게으름이 아니라 **의도적 선택** 임을 증명.

### "비목표" 명시의 효과

비목표 선언은 단순한 스타일이 아니에요. 다음 두 가지를 방지:

1. **반복 설명 비용 제거** — "왜 K8s 안 써?" 같은 질문에 매번 답변 대신 본 문서를 가리키면 끝
2. **slippery slope 방지** — 작은 "있으면 좋지" 결정들이 쌓여 운영 부담 임계치 넘는 걸 차단. 비목표는 **명시적 거절** 이 되어 슬쩍 추가되지 못하게 함.

## 교훈

### "비목표" 선언이 선언 자체로 가치 있음

초기에는 "무엇을 할 것인가" 만 ADR 에 써두면 충분하다고 생각했어요. 근데 6개월 지나니 같은 질문이 반복적으로 들어오기 시작함 — "왜 K8s 안 써?", "왜 HA 를 99.99% 안 세팅?", "왜 분산 추적 안 깔아?".

매번 답변하는 피로 + "혹시 내가 틀린 게 아닐까?" 재검토 비용이 누적. 그래서 **비목표 명시** 를 추가:

```markdown
## 비목표
- 고가용성 99.99% SLA → 99% 면 충분
- 멀티 리전 → Seoul 하나면 충분
- 무중단 배포 → 30초 다운타임 수용
- 분산 추적 → 단일 프로세스라 불필요
```

이후 같은 질문이 오면 이 섹션을 가리킴. **재고 비용이 0 으로** 떨어짐. 답변 작성 시간 절약 + 심리적 안정 (이미 검토했음).

**교훈**: ADR 은 "무엇을 할 것인가" 만 아니라 "무엇을 안 할 것인가" 도 명시해야 함. 비목표 선언은 문서 길이만 늘리는 게 아니라 **미래의 재고 비용을 선불** 하는 것.

### 원칙은 예외를 관리해야 함

"솔로 감당 가능?" 이라는 원칙이 있어도 예외가 생김. 예: [ADR-015 (Conventional Commits + SemVer)](./adr-015-conventional-commits-semver.md) 의 commitlint · husky · CHANGELOG · tag-validate 는 **초기 셋업 비용이 큼** — 감당 가능성만 보면 과하게 보임.

그런데 이 초기 비용이 **미래의 솔로 감당 가능성을 높여주는 투자** 라는 걸 실험으로 검증: commitlint 없이 6개월 개발 → commit history 가 지저분해져서 cherry-pick 가 어려워짐 → 파생 레포 전파가 작동 안 함 → 앱 공장 전략 자체가 흔들림.

그래서 원칙 적용에 **"현재 부담 vs 미래 부담 감소"** 를 명시적으로 계산. 초기 비용이 크더라도 그 이후의 운영 부담이 크게 줄면 채택.

**교훈**: 원칙은 절대적 규칙이 아니라 **판단 기준**. "현재 비용" 만 보지 말고 "미래 부담 감소" 까지 묶어 계산해야 함. 원칙은 예외를 관리하는 방식까지 포함할 때 완성.

### 업계 표준 거절의 정당성은 **기록** 으로만 유지됨

K8s · 마이크로서비스 · 분산 추적을 거절할 때, "지금 이 순간의 판단" 은 확신이 있어요. 근데 6개월 지나면 **그 판단 근거** 를 까먹음. 외부 누군가가 "왜 K8s 안 써?" 라고 물으면 "음... 필요 없어서" 라는 모호한 답만 남음.

이게 누적되면 "어쩌면 내가 틀렸던 걸까" 로 기울어짐. 업계 표준은 기본값의 관성이 강하니까.

그래서 각 비목표에 **"왜 아닌가"** 를 한 줄이라도 명시 (표 참조). 6개월 후의 자신이 같은 질문을 받았을 때 **즉답 가능** 하도록.

**교훈**: 업계 표준을 거절하는 결정은 시간이 지나면서 자기 의심으로 침식됨. 이를 막으려면 **거절 근거를 문서에 박아두는 것** 외에는 방법이 없음. "나중에 기억할 것" 은 작동 안 함.

## 관련 사례 (Prior Art)

- **[DHH · "The One Person Framework"](https://world.hey.com/dhh/the-one-person-framework-711e6318)** — Rails 창시자 DHH 의 "한 사람 프레임워크" 선언. 본 ADR 의 철학적 전신. "대기업 툴이 인디에게 맞지 않는다" 는 논리 동일.
- **[Indie Hackers Community](https://www.indiehackers.com/)** — 솔로 개발자들의 운영 결정 사례집. 본 ADR 의 "솔로 감당 가능" 기준은 이 커뮤니티의 공통 문법.
- **[Basecamp HEY Stack](https://world.hey.com/jorge/our-cloud-exit-has-already-yielded-$1m-2c7f9f29)** — Basecamp 의 "클라우드 탈출" 결정. "필요 이상의 복잡도를 거부" 라는 동일한 철학.
- **[Gitea vs GitLab](https://gitea.io/)** — GitLab 의 마이크로서비스 K8s 배포 vs Gitea 의 단일 바이너리. 본 ADR 의 "단일 배포 단위" 와 일치.
- **[JetBrains Fleet](https://www.jetbrains.com/fleet/)** — "당신이 쓰지 않는 기능은 메모리도 먹지 않아야 한다" 철학. 본 ADR 의 "비목표 명시" 와 일치.
- **[Chesterton's Fence 원리](https://fs.blog/chestertons-fence/)** — "왜 이 울타리가 있는지 모르면 부수지 마라" — 역으로 "왜 이 울타리가 필요한지 모르면 세우지 마라". 본 ADR 의 "우리에겐 필요 없다" 거절 논리.

## Code References

**단일 배포 단위**:
- [`bootstrap/build.gradle`](https://github.com/storkspear/spring-backend-template/blob/main/bootstrap/build.gradle) — 모든 core-*-impl 포함 · bootJar 구성
- [`Dockerfile`](https://github.com/storkspear/spring-backend-template/blob/main/Dockerfile) L33, 41 — 단일 이미지 빌드
- [`docker-entrypoint.sh`](https://github.com/storkspear/spring-backend-template/blob/main/docker-entrypoint.sh) — migration vs 앱 기동 단일 entrypoint

**관리형 서비스 연동**:
- [`application-prod.yml`](https://github.com/storkspear/spring-backend-template/blob/main/bootstrap/src/main/resources/application-prod.yml) L56-80 — JWT · Resend · FCM · R2 환경변수 기반 주입
- [`core-auth-impl/email/ResendEmailAdapter.java`](https://github.com/storkspear/spring-backend-template/blob/main/core/core-auth-impl/src/main/java/com/factory/core/auth/impl/email/ResendEmailAdapter.java) — Resend API 클라이언트
- [`core-storage-impl/build.gradle`](https://github.com/storkspear/spring-backend-template/blob/main/core/core-storage-impl/build.gradle) — MinIO/S3 SDK

**로컬 개발 분리**:
- [`infra/docker-compose.dev.yml`](https://github.com/storkspear/spring-backend-template/blob/main/infra/docker-compose.dev.yml) — 로컬 Postgres + MinIO
- [`application-dev.yml`](https://github.com/storkspear/spring-backend-template/blob/main/bootstrap/src/main/resources/application-dev.yml) — dev profile 전용 설정
- [`application-prod.yml`](https://github.com/storkspear/spring-backend-template/blob/main/bootstrap/src/main/resources/application-prod.yml) — prod profile 엄격 설정

**자동화 스크립트**:
- [`tools/new-app/new-app.sh`](https://github.com/storkspear/spring-backend-template/blob/main/tools/new-app/new-app.sh) — 앱 스캐폴딩 한 줄
- [`tools/dogfooding/setup.sh`](https://github.com/storkspear/spring-backend-template/blob/main/tools/dogfooding/setup.sh) — 도그푸딩 환경 9단계 자동화
- [`tools/bootstrap.sh`](https://github.com/storkspear/spring-backend-template/blob/main/tools/bootstrap.sh) — 파생 레포 부팅

**CI 정책**:
- [`.github/workflows/ci.yml`](https://github.com/storkspear/spring-backend-template/blob/main/.github/workflows/ci.yml) — 전체 빌드/테스트/ArchUnit
- [`.github/workflows/deploy.yml`](https://github.com/storkspear/spring-backend-template/blob/main/.github/workflows/deploy.yml) — main only + workflow_run 게이트
- [`.github/workflows/security-scan.yml`](https://github.com/storkspear/spring-backend-template/blob/main/.github/workflows/security-scan.yml) — gitleaks + Dependabot

**부재 확인 (비목표 증거)**:
- `infra/kubernetes/` 또는 `infra/helm/` — 없음
- `zipkin`, `jaeger`, `opentelemetry-exporter` 의존성 — 없음 (로깅은 단일 파일)
- 멀티 리전 deployment workflow — 없음

**관련 ADR**:
- [ADR-001 · 모듈러 모놀리스](./adr-001-modular-monolith.md) — 운영 단위 1 의 결정
- [ADR-005 · 단일 Postgres + 앱당 schema](./adr-005-db-schema-isolation.md) — Supabase 관리형 의존
- [ADR-006 · HS256 JWT](./adr-006-hs256-jwt.md) — 관리 대상 최소화 (비밀 키 1개)
- [ADR-008 · API 버전 관리 미도입](./adr-008-no-api-versioning.md) — "지금 필요 없다" 의 다른 적용
- [ADR-015 · Conventional Commits + SemVer](./adr-015-conventional-commits-semver.md) — "초기 투자 vs 미래 부담 감소" 트레이드오프
