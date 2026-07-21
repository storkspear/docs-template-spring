# 배포 맛보기

> **유형**: Explanation · **독자**: Level 0~1 · **읽는 시간**: ~15분 (직접 따라 하면 ~20분)

운영 배포가 어떤 일들을 하는지를, 실제 운영 서버 없이 로컬에서 맛보는 문서예요. 내 노트북에서 Docker 로 한 번 돌려 보면 "프로덕션에서도 대략 이런 일이 일어나는구나" 하는 그림이 잡혀요.

> **이 문서는 실전 배포 가이드가 아니에요.** 진짜 운영 배포 절차는 [`운영 배포 가이드`](../production/deploy/deployment.md) 가 따로 담당해요. 여기서는 개념을 체험하는 데 집중해요.

> **처음 보는 용어가 나오면** [`용어 사전`](../reference/glossary.md) 에서 바로 찾아볼 수 있어요. 이 문서에 자주 등장하는 것만 먼저 추려 두면 이렇게 돼요.
>
> - [`Docker`](../reference/glossary.md#운영--인프라) — 앱을 컨테이너 한 덩어리로 패키징해, 내 Mac 에서 돌던 게 서버에서도 똑같이 돌게 해요
> - [`Kamal`](../reference/glossary.md#운영--인프라) · [`kamal-proxy`](../reference/glossary.md#운영--인프라) — Docker 와 SSH 로 무중단 배포를 자동화하는 도구와 그 리버스 프록시예요
> - [`Blue/Green 배포`](../reference/glossary.md#운영--인프라) — 기존 버전 옆에 새 버전을 띄워 두고 준비되면 순간 전환하는 무중단 방식이에요
> - [`GHCR`](../reference/glossary.md#운영--인프라) — GitHub 이 제공하는 Docker 이미지 저장소예요
> - [`Graceful Shutdown`](../reference/glossary.md#운영--인프라) — 서버를 끌 때 처리 중이던 요청은 마저 끝낸 뒤 종료하는 방식이에요

이 맛보기는 시간 순으로 이렇게 흘러가요. §1 에서 배포가 무엇인지 그림을 잡고, §2~§4 에서 로컬 Docker 로 직접 손을 움직여 본 다음, §5 부터는 운영에서 실제로 무슨 일이 일어나는지를 차례로 들여다봐요.

```
배포가 뭔가 (§1)  →  로컬에서 이미지 빌드 (§2)  →  이미지 실행 + 헬스 체크 (§3)
                                                            ↓
   무중단 전환 그림 (§4)  →  자동화 파이프라인 (§5)  →  마이그레이션 · 롤백 · 운영 환경 (§6~§9)
```

## 1. 배포가 무엇인가

한 줄로 말하면, 배포는 "내 컴퓨터에서 돌던 코드를 서버에서 돌게 만드는 일" 이에요. 그 한 줄을 풀어 보면 여섯 단계로 나뉘어요.

1. 코드 컴파일 — `./gradlew build` 로 [`JAR`](../reference/glossary.md#프레임워크--빌드) 을 만들어요.
2. 이미지 패키징 — 운영체제와 자바 실행 환경(JRE), JAR 을 [`Docker`](../reference/glossary.md#운영--인프라) 이미지 한 덩어리로 묶어요.
3. 레지스트리에 업로드 — 그 이미지를 [`GHCR`](../reference/glossary.md#운영--인프라) 같은 저장소에 올려요.
4. 서버에서 내려받기 — 서버가 레지스트리에서 이미지를 받아요.
5. 기존 버전과 교체 — [`Blue/Green 배포`](../reference/glossary.md#운영--인프라) 로 끊김 없이 새 버전으로 바꿔요.
6. 헬스 체크 — 새 버전이 정상으로 떴는지 확인해요.

이 레포는 위 여섯 단계를 GitHub Actions 와 [`Kamal`](../reference/glossary.md#운영--인프라) 로 자동화해요. 개발자는 `git push` 한 번만 하면 나머지는 파이프라인이 알아서 돌려 주는데, 그 안에서 무슨 일이 벌어지는지를 이 문서에서 하나씩 체험해 봐요.

## 2. 로컬에서 Docker 이미지 빌드

먼저 내 손으로 이미지를 한 번 만들어 봐요. 위 1~2단계, 즉 코드 컴파일과 이미지 패키징을 명령 한 줄로 합쳐서 체험하는 거예요. 레포 루트에서 다음을 실행해요.

```bash
docker build -t my-backend-template:local .
```

루트의 `Dockerfile` 은 두 단계로 나뉘어 있어요. 빌드용 컨테이너에서 JAR 을 만든 뒤, 실행용 컨테이너에는 그 JAR 만 옮겨 담아요.

```dockerfile
# Dockerfile 발췌
FROM eclipse-temurin:21-jdk-alpine AS builder
WORKDIR /app
COPY . /app
RUN ./gradlew bootJar --no-daemon -x test            # 빌드 단계 — JAR 생성

FROM eclipse-temurin:21-jre-alpine                    # 실행 단계 — JRE 만
COPY --from=builder /app/bootstrap/build/libs/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["/app/docker-entrypoint.sh"]
```

이렇게 단계를 나누는 방식을 멀티 스테이지 빌드라고 불러요. 빌드에만 필요한 JDK 와 Gradle 은 최종 이미지에 남지 않아서, 실행 이미지가 가벼워져요 (약 200MB). 빌드가 끝나면 이런 메시지가 보여요.

```
Successfully built abc123...
Successfully tagged my-backend-template:local
```

> 운영 파이프라인은 이 루트 `Dockerfile` 대신 `Dockerfile.runtime` 을 써요. CI 가 이미 JAR 을 빌드해 두기 때문에, 운영용 이미지는 그 JAR 만 JRE 위에 얹어 더 빠르게 만들어요. 직접 빌드를 체험할 때는 루트 `Dockerfile` 이면 충분해요.

## 3. 이미지 실행

이제 방금 만든 이미지를 띄워 봐요. 앞 단계의 4~6번, 즉 이미지를 받아 실행하고 헬스 체크로 확인하는 흐름을 로컬에서 따라 하는 셈이에요. 앱은 데이터베이스가 필요하니 Postgres 를 먼저 띄워요.

```bash
# 1. Postgres 컨테이너 먼저 기동
docker compose -f infra/docker-compose.local.yml up -d postgres

# 2. 앱 컨테이너 실행
docker run --rm -it \
  --name backend-test \
  -p 8080:8080 \
  -e SERVER_PORT=8080 \
  --env-file .env \
  my-backend-template:local
```

> 왜 포트를 8080 으로 맞추나요? 로컬에서 `bootRun` 으로 띄울 때는 8080 충돌을 피하려고 기본 포트가 8081 이에요. 하지만 컨테이너는 운영과 똑같이 맞추는 게 목적이라, `Dockerfile` 의 `EXPOSE 8080` · `config/deploy.yml` 의 `SERVER_PORT: 8080` 과 일치하도록 8080 으로 덮어써요.

> macOS 의 Docker Desktop 환경이라면 컨테이너에서 호스트의 Postgres 로 닿도록 `--network host` 를 더해도 돼요. Linux 에서는 `--network host` 의 동작이 달라서, 위 예시처럼 `-p 8080:8080` 만 쓰거나 docker compose 로 함께 띄우는 편이 안전해요.

실행하면 `./gradlew bootRun` 으로 띄울 때와 똑같은 로그가 나와요. 다만 이번엔 컨테이너 안에서 돈다는 점만 달라요. 새 터미널을 열어 헬스 체크로 확인해 봐요.

```bash
curl http://localhost:8080/actuator/health
# {"status":"UP"}
```

`{"status":"UP"}` 이 보이면 컨테이너가 정상으로 뜬 거예요. 다 봤으면 컨테이너를 내려요.

```bash
docker stop backend-test
```

## 4. 무중단 전환은 어떻게 일어나나

로컬 체험은 여기까지예요. 지금부터는 운영 서버에서 실제로 무슨 일이 일어나는지를 그림으로 들여다봐요. 운영 배포의 핵심은 사용자 요청을 한 순간도 끊지 않는 거예요. 이를 위해 [`Blue/Green 배포`](../reference/glossary.md#운영--인프라) 를 써요. 기존 버전(Blue) 이 트래픽을 받는 동안 새 버전(Green) 을 옆에 띄우고, 준비가 끝나면 순간 전환해요.

```
배포 전:
 ┌──────────────┐
 │ Blue (v1.0)  │  ← 포트 8080, 모든 트래픽 여기로
 └──────────────┘
        ▲
        │ (Cloudflare Tunnel)
      사용자

배포 중:
 ┌──────────────┐   ┌──────────────┐
 │ Blue (v1.0)  │   │ Green (v1.1) │  ← 새 버전 기동 + 헬스 체크
 │ (여전히 서빙)│   │ (준비 중)    │
 └──────────────┘   └──────────────┘
        ▲
      사용자

헬스 체크 통과 후:
 ┌──────────────┐   ┌──────────────┐
 │ Blue (v1.0)  │   │ Green (v1.1) │  ← 트래픽 전환 완료
 │ (graceful    │   │ (활성)       │
 │  shutdown)   │   │              │
 └──────────────┘   └──────────────┘
                          ▲
                        사용자
```

핵심은 사용자 요청이 한 순간도 끊기지 않는다는 점이에요. 구 버전은 진행 중이던 요청을 다 마친 뒤에야 종료해요. 이 전환을 [`kamal-proxy`](../reference/glossary.md#운영--인프라) 가 관리하고, 실전에서 쓰는 명령어는 [`운영 런북`](../production/deploy/runbook.md) 에 정리돼 있어요.

## 5. 자동화 파이프라인이 하는 일

`main` 브랜치에 push 하면, [`GitHub Actions`](../reference/glossary.md#ci--배포-파이프라인) 가 앞서 본 여섯 단계를 자동으로 이어서 돌려 줘요. 두 단계로 나뉘는데, 먼저 CI 가 코드를 검증하고, 검증이 통과하면 배포 워크플로우가 이어받아요.

```
┌─────────────────────────────────────────────────────┐
│ ci.yml  (push → main)                               │
│  1. ./gradlew spotlessCheck (포맷 검사)              │
│  2. ./gradlew build (테스트 + ArchUnit 규칙 전부)    │
└────────────┬────────────────────────────────────────┘
             │ (CI 성공 시에만)
             ▼
┌─────────────────────────────────────────────────────┐
│ deploy.yml  (CI 성공 후 workflow_run 으로 시작)      │
│  1. bootJar 빌드 → app.jar 추출                      │
│  2. Tailscale VPN 으로 Mac mini 와 연결              │
│  3. Dockerfile.runtime 으로 이미지 빌드 + GHCR push  │
│  4. kamal deploy --version=<sha>                    │
│  5. kamal-proxy: blue/green 전환 + 헬스 체크         │
└─────────────────────────────────────────────────────┘
```

`ci.yml` 은 push 가 `main` 에 들어오면 검증만 하고 끝나요. 배포는 `deploy.yml` 이 따로 맡는데, 직접 push 에 반응하는 게 아니라 CI 가 성공으로 끝난 뒤 [`workflow_run`](../reference/glossary.md#ci--배포-파이프라인) 으로 이어받아 시작해요. 그래서 테스트가 깨진 코드는 배포까지 가지 못해요. 약 10분 안팎의 이 전 과정이 `git push` 한 번으로 돌아가고, 개발자는 CI 성공 알림만 확인하면 돼요.

> `develop` 브랜치에 push 하면 같은 흐름이 dev-server 로 향해요. `deploy-dev.yml` 이 CI 성공을 이어받아 dev 환경에 배포해요. 즉 `main` 은 운영으로, `develop` 은 dev-server 로 갈라져요.

## 6. Flyway 마이그레이션은 언제 도나

DB 스키마 변경은 [`Flyway`](../reference/glossary.md#데이터베이스) 가 맡아요. 그런데 언제 실행되느냐는 환경에 따라 달라요. 운영에서 새 컨테이너가 뜰 때마다 스키마를 건드리면, 파괴적 변경이 의도치 않게 적용될 위험이 있기 때문이에요.

- **로컬 · dev** — `APP_FLYWAY_MODE` 가 `AUTO` 라, 컨테이너가 기동할 때 Flyway 가 마이그레이션을 자동 적용해요. 빠른 반복에 편해요.
- **운영** — 기본값이 `VALIDATE_ONLY` 예요. 기동 시 스키마를 바꾸지 않고, 이미 적용된 마이그레이션의 체크섬만 검증해요 ([`ADR-033`](../philosophy/adr-033-flyway-hybrid-policy.md) 의 하이브리드 정책).

그래서 운영에서 스키마를 바꿀 때는 마이그레이션을 배포와 분리해 미리 적용해요. 두 가지 길이 있어요.

첫째, 운영자가 `tools/migrate-prod.sh` 로 배포 전에 직접 적용하는 방법이에요. 이 스크립트가 마이그레이션 SQL 을 트랜잭션 안에서 실행하고 Flyway 이력에 기록까지 남겨요. 둘째, 이미지의 `migrate-only` 모드를 쓰는 방법이에요. 운영자가 Green 컨테이너를 띄우기 전에 배포 호스트에서 이 모드로 한 번 실행해, DB 마이그레이션만 끝내고 빠져나와요 (web 서버는 띄우지 않아요). 자동 훅으로 걸려 있지는 않고, 배포와 분리해 직접 돌리는 out-of-band 단계예요. [`Blue/Green 배포`](../reference/glossary.md#운영--인프라) 가 겹치는 구간에서 Flyway 가 동시에 도는 레이스를 피하려는 설계예요.

```bash
# migrate-only 모드 — DB 마이그레이션만 적용하고 종료 (web 서버 없음)
docker run --rm --env-file .env.prod my-backend:v1.1 migrate-only
```

> 단, 텅 빈 스키마에 처음 배포할 때는 예외예요. 적용할 이력이 아예 없으니, 이때만 `APP_FLYWAY_MODE=AUTO` 를 줘서 첫 마이그레이션을 기동 중에 한꺼번에 돌려요. 스키마가 자리 잡은 뒤에는 다시 `VALIDATE_ONLY` 로 돌아와요.

뒤로 호환되는 마이그레이션을 쓰는 Expand/Contract 규율은 [`Flyway 운영 런북`](../production/deploy/flyway-runbook.md) 에서 다뤄요.

## 7. 배포가 실패하면

배포가 잘못되면 가장 빠른 복구는 직전 버전으로 되돌리는 거예요.

```bash
<repo> prod status            # 최근 배포 목록 (kamal app details)
<repo> prod rollback <sha>    # 이전 버전(SHA)으로 되돌림 (kamal rollback)
```

이전 이미지가 [`GHCR`](../reference/glossary.md#운영--인프라) 에 남아 있으면 수 초 안에 전환돼요. 파이프라인은 직전 버전을 위해 이미지 두 개(현재 + 직전)를 항상 보관해요.

코드 자체를 고쳐 다시 배포하려면, 문제가 된 변경을 되돌리는 커밋을 만들어 push 하면 돼요.

```bash
git revert HEAD
git push origin main
# → CI/CD 사이클이 다시 돌아요 (약 10분)
```

롤백의 세 가지 선택지는 [`운영 런북`](../production/deploy/runbook.md) 에 더 자세히 정리돼 있어요.

## 8. 맥미니인가 클라우드 VM인가

이 레포는 [`Mac mini`](../production/setup/mac-mini-setup.md) 홈서버를 기본 배포 대상으로 전제해요. 전기세가 월 4달러 수준이고, 클라우드 VM 과 비교하면 약 1년이면 본전을 뽑아요. 홈 네트워크의 LAN 도 직접 활용할 수 있어, NAS 의 MinIO 같은 자원에 바로 붙을 수 있고요.

클라우드로 옮길 시점은 사용자 규모가 MAU 1만~10만에 닿을 무렵이에요 ([`인프라 §7`](../production/deploy/infrastructure.md)). 그때 AWS EC2 나 Fly.io 같은 선택지로 넘어가요. 왜 맥미니를 기본으로 골랐는지는 [`ADR-007`](../philosophy/adr-007-solo-friendly-operations.md) 에 적혀 있어요.

## 9. 배포 후 모니터링

운영에 올린 뒤에는 잘 돌고 있는지를 살펴봐야 해요. 이 레포는 세 가지를 봐요.

| 무엇 | 어디서 | 어떻게 |
|---|---|---|
| 로그 | `log.<domain>` 의 [`Grafana`](../reference/glossary.md#관측성--로깅) | [`Loki`](../reference/glossary.md#관측성--로깅) 쿼리로 실시간 필터링 |
| 메트릭 | Grafana 대시보드 | [`Prometheus`](../reference/glossary.md#관측성--로깅) 가 `/actuator/prometheus` 를 수집 (요청량 · 에러율 · p95 지연) |
| 알림 | Discord | [`Alertmanager`](../reference/glossary.md#관측성--로깅) 가 5xx 에러율 · p95 지연 · 백엔드 다운 · MinIO 디스크 임계 초과 시 발송 |

이 관측성 스택은 운영(Mac mini)에서만 띄워요. 로컬에서는 메모리 부담이 커서 켜지 않고, 로그는 콘솔로 메트릭은 `/actuator/prometheus` 로 충분히 확인해요. 운영 셋업 방법은 [`운영 모니터링 셋업 가이드`](../production/setup/monitoring-setup.md) 에 있어요.

## 이 맛보기에서 배운 것

- 배포는 이미지 빌드 · 레지스트리 업로드 · 서버 교체 · 헬스 체크의 흐름이에요.
- Blue/Green 은 사용자 요청을 끊지 않는 무중단 전환의 표준 패턴이에요.
- Flyway 는 로컬·dev 에서는 기동 시 자동 적용되지만, 운영에서는 기본이 검증만(VALIDATE_ONLY) 이고 마이그레이션은 따로 적용해요.
- 배포가 실패하면 `prod rollback` 한 줄로 직전 버전으로 되돌려요.
- 이 레포는 맥미니 홈서버와 GitHub Actions 자동화를 기본 조합으로 써요.

## 다음

| 다음 행동 | 문서 |
|---|---|
| 실제로 배포해 보기 | [`운영 배포 가이드`](../production/deploy/deployment.md) — 파생 레포 첫 운영 배포 |
| 운영 중 장애 대응 | [`운영 런북`](../production/deploy/runbook.md) |
| 인프라 전체 구성 | [`인프라 (Infrastructure)`](../production/deploy/infrastructure.md) |
| 왜 맥미니인가 | [`ADR-007 · 솔로 친화적 운영`](../philosophy/adr-007-solo-friendly-operations.md), [`인프라 결정 기록 I-04`](../production/deploy/decisions-infra.md) |

여기까지 읽으면 Level 0 완료예요. 다음은 Level 1 — 실제 운영에 들어가는 여정이에요.
