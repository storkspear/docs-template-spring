# 배포 맛보기

"운영 배포가 **어떤 일들** 을 하는가?" 를 **실제 운영 배포 없이** 맛보는 문서. 로컬에서 Docker 로 돌려보면서 "프로덕션에서도 대략 이런 일이 일어난다" 를 체감합니다.

> **주의**: 이 문서는 **실제 운영 배포 가이드가 아님**. 실전 배포는 [`운영 배포 가이드 (파생레포 onboarding)`](../production/deploy/deployment.md) 가 담당.
>
> **목표 시간**: 20 분.

## 1. "배포" 란 뭘 하나

한 줄로: **"내 컴퓨터에서 돌던 코드를 **서버** 에서 돌게 만든다."**

구체적으로:

1. **코드 컴파일** — `./gradlew build` 로 JAR 생성
2. **이미지 패키징** — Docker 이미지로 OS + JRE + JAR 한 덩어리
3. **이미지 레지스트리에 업로드** — GitHub Container Registry (GHCR) 또는 Docker Hub
4. **서버에서 다운로드** — 서버가 레지스트리에서 이미지 pull
5. **기존 버전과 교체** — blue/green 스왑으로 무중단 전환
6. **health check** — 새 버전이 정상 기동했는지 확인

이 레포는 이걸 **GitHub Actions + Kamal** 로 자동화.

## 2. 로컬에서 Docker 이미지 빌드

```bash
# 레포 루트에서
docker build -t my-backend-template:local .
```

`Dockerfile` 의 흐름:

```
FROM eclipse-temurin:21-jdk-alpine AS builder       # 빌드 stage
COPY . /app
WORKDIR /app
RUN ./gradlew bootJar --no-daemon -x test           # JAR 생성

FROM eclipse-temurin:21-jre-alpine                   # 실행 stage
COPY --from=builder /app/bootstrap/build/libs/*.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

**Multi-stage build**: 빌드 도구 (JDK + Gradle) 는 최종 이미지에 없음 → 이미지 크기 작음 (약 200MB).

결과:
```
Successfully built abc123...
Successfully tagged my-backend-template:local
```

## 3. 이미지 실행

```bash
# Postgres 먼저 떠 있어야 함
docker compose -f infra/docker-compose.dev.yml up -d postgres

# 앱 실행
docker run --rm -it \
  --name backend-test \
  -p 8080:8080 \
  --env-file .env \
  --network host \
  my-backend-template:local
```

**결과**: `./gradlew bootRun` 과 똑같은 로그가 나오지만, 이번엔 **컨테이너 안에서** 실행.

다른 터미널:
```bash
curl http://localhost:8080/actuator/health
# {"status":"UP"}
```

컨테이너를 끄는 법: `docker stop backend-test`.

## 3. Blue/Green 개념 (그림)

실전 배포는 무중단 (zero-downtime) 을 위해 blue/green:

```
배포 전:
 ┌──────────────┐
 │ Blue (v1.0)  │ ← 포트 8080, 모든 트래픽 여기로
 └──────────────┘
           ▲
           │ (Cloudflare Tunnel)
           │
         사용자

배포 중:
 ┌──────────────┐   ┌──────────────┐
 │ Blue (v1.0)  │   │ Green (v1.1) │ ← 새 버전 기동 중
 │ (여전히 서빙)│   │ (health 체크)│
 └──────────────┘   └──────────────┘
           ▲
           │
         사용자

Health check 통과 후:
 ┌──────────────┐   ┌──────────────┐
 │ Blue (v1.0)  │   │ Green (v1.1) │ ← 트래픽 전환 완료
 │ (graceful    │   │ (활성)       │
 │  shutdown)   │   │              │
 └──────────────┘   └──────────────┘
                          ▲
                          │
                        사용자
```

**핵심**: 사용자 요청은 **한 순간도 끊기지 않음**. 구 버전은 진행 중이던 요청을 마친 후 종료.

이 스왑을 **Kamal** 이 관리. [`운영 런북 (Runbook)`](../production/deploy/runbook.md) 에 실전 명령어.

## 4. GitHub Actions 가 실제로 하는 일

`main` 브랜치에 push 하면 자동으로:

```
┌─────────────────────────────────────────────────────┐
│ ci.yml                                              │
│  1. ./gradlew build (테스트 + ArchUnit 전부)         │
│  2. bootstrap.jar 를 artifact 로 업로드             │
└────────────┬────────────────────────────────────────┘
             │ (CI 성공 시에만)
             ▼
┌─────────────────────────────────────────────────────┐
│ deploy.yml (workflow_run 트리거)                    │
│  1. artifact 다운로드                               │
│  2. docker build → ghcr.io/.../...:<sha>            │
│  3. docker push to GHCR                             │
│  4. Tailscale VPN 조인                              │
│  5. ssh → Mac mini → kamal deploy --version=<sha>   │
│  6. Kamal: blue/green 스왑 + health check          │
└─────────────────────────────────────────────────────┘
```

이 10 분 내외 프로세스가 **한 `git push` 로** 자동 실행. 개발자는 CI 성공 알림만 확인.

## 5. Flyway 마이그레이션은 언제 돌아가나?

**컨테이너 기동 시** 자동. Spring Boot 가 시작되면서 `application-prod.yml` 설정대로 Flyway 실행. 즉:

1. Green 컨테이너 기동 → Flyway 가 migration 적용 (advisory lock 으로 동시성 안전)
2. Health check → `/actuator/health` 가 `UP` 반환
3. Kamal 이 트래픽 전환

**파괴적 DDL (DROP COLUMN 등) 이 걱정되면**: `migrate-only` 모드로 **배포 전 수동 실행** 가능:
```bash
ssh mac-mini
docker run --rm --env-file /path/to/.env my-backend:v1.1 migrate-only
# Flyway 만 실행하고 종료. Spring 은 기동 안 함
```

Expand/Contract 규율 (뒤로 호환 마이그레이션) 은 [`운영 런북 (Runbook)`](../production/deploy/runbook.md) 의 "블루/그린 배포 + Flyway 원칙" 섹션.

## 6. 배포 실패하면?

### 롤백 — 가장 간단한 경로

```bash
ssh mac-mini
kamal app details         # 최근 배포 목록
kamal rollback v1.0       # 이전 버전 (SHA) 로 돌아감
```

**즉시 롤백** — 이전 이미지가 GHCR 에 있으면 수 초 내 전환.

### 코드 수정 후 재배포

```bash
# 깨진 PR 을 revert 하는 PR 생성
git revert HEAD
git push origin main
# → CI/CD 사이클 자동 실행 (약 10 분)
```

[`운영 런북 (Runbook)`](../production/deploy/runbook.md) 에 "롤백 3 옵션" 상세.

## 7. 맥미니? 클라우드 VM?

이 레포의 **기본 전제** 는 **맥미니 홈서버** ([`Mac mini 운영 호스트 설정 — 레퍼런스`](../production/setup/mac-mini-setup.md)). 이유:

- 전기세 월 $4
- 클라우드 VM 대비 break-even 약 1 년
- 홈 네트워크의 LAN 직접 활용 (MinIO NAS 등)

**언제 클라우드 이관?**: MAU 10K~100K 도달 시점 ([`인프라 (Infrastructure) §7`](../production/deploy/infrastructure.md)). 이 때 AWS EC2 또는 Fly.io 로.

## 8. 관측성 — 배포 후 모니터링

로그:
```
https://log.<domain>
```
Grafana 에서 Loki 쿼리로 실시간 로그 필터링.

메트릭:
```
request rate · error rate · p95 latency
```
Prometheus 가 `actuator/prometheus` 를 스크래핑 → Grafana 대시보드.

알림:
- **Alertmanager → Discord** (CPU · 메모리 · 5xx · p95 임계 시)

상세: [`운영 모니터링 셋업 가이드`](../production/setup/monitoring-setup.md).

## 이 맛보기에서 배운 것

- 배포 = 이미지 빌드 + 레지스트리 업로드 + 서버 교체 + health check
- Blue/Green = 무중단 전환의 표준 패턴
- Flyway 는 기동 시 자동 실행 (advisory lock 으로 동시성 안전)
- 실패 시 롤백은 `kamal rollback` 한 줄
- 이 레포는 맥미니 + GitHub Actions 조합이 기본

## 다음

| 다음 행동 | 문서 |
|---|---|
| 실제로 배포해보기 | [`운영 배포 가이드 (파생레포 onboarding)`](../production/deploy/deployment.md) — 파생 레포 첫 운영 배포 |
| 운영 중 장애 대응 | [`운영 런북 (Runbook)`](../production/deploy/runbook.md) |
| 인프라 전체 구성 | [`인프라 (Infrastructure)`](../production/deploy/infrastructure.md) |
| 왜 맥미니인가? | [`ADR-007 · 솔로 친화적 운영`](../philosophy/adr-007-solo-friendly-operations.md), [`인프라 결정 기록 (Decisions — Infrastructure) I-04`](../production/deploy/decisions-infra.md) |

여기까지 읽으면 **Level 0 완료**. 다음은 Level 1 — 실제 운영에 들어가는 여정입니다.
