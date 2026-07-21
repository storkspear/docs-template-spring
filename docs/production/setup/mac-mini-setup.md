# Mac mini 운영 호스트 설정 — 실제 설치 기록

> **유형**: How-to · **독자**: Level 2 · **읽는 시간**: ~30분

> ⚠️ 이 문서는 template 관리자 본인의 Mac mini 를 실제로 셋업한 기록이에요. 파생 레포 개발자가 자기 환경으로 옮길 때 그대로 베껴 쓰는 샘플로 활용하세요. IP·UUID·도메인·호스트명 같은 개별 값은 본인 환경의 값으로 바꿔야 해요. 전체 구성도·책임 분담·결정 근거는 [`infrastructure.md`](../deploy/infrastructure.md) 가 기준 문서이고, 이 문서는 그 위에 얹은 실제 설치 스냅샷이에요.
>
> 한 가지 더 — 이 문서에 손으로 따라 하는 단계로 적힌 일 가운데 상당수는 이제 자동화돼 있어요. `prod init` 명령 하나가 Cloudflare Tunnel·DNS·GitHub Secrets 등록을 대신 처리해요. 무엇이 자동이고 무엇이 손작업인지는 §11 과 §17 에서 짚어요. 이 문서를 읽으면 그 자동화가 "안에서 무슨 일을 하는지" 까지 이해하게 돼요.
>
> 관련 문서:
> - 운영 배포 절차: [`운영 배포 가이드`](../deploy/deployment.md)
> - 평시 운영과 장애 대응: [`운영 런북`](../deploy/runbook.md)
> - 인프라 결정 카드: [`인프라 결정 기록`](../deploy/decisions-infra.md) — Supabase·MinIO·맥미니·Tunnel·관측성·Kamal
> - 전체 인프라 개요: [`인프라 (Infrastructure)`](../deploy/infrastructure.md)

---

## 목차

1. [개요](#1-개요)
2. [하드웨어 / OS baseline](#2-하드웨어--os-baseline)
3. [기술 스택](#3-기술-스택)
4. [네트워크 구성도](#4-네트워크-구성도)
5. [프로젝트 운영 구성도](#5-프로젝트-운영-구성도)
6. [인프라 리소스 구성도](#6-인프라-리소스-구성도)
7. [개념적 결정 (Why 이렇게 설계했나)](#7-개념적-결정-why-이렇게-설계했나)
8. [시스템 기본 셋업](#8-시스템-기본-셋업)
9. [Shell 환경 (zprofile / zshenv / PATH)](#9-shell-환경)
10. [Docker credential helper (비대화형 SSH 워크어라운드)](#10-docker-credential-helper)
11. [Cloudflare Tunnel 구성](#11-cloudflare-tunnel-구성)
12. [Cloudflare Zone 설정 (DNS / Access / WAF)](#12-cloudflare-zone-설정)
13. [Kamal + kamal-proxy + Spring 컨테이너](#13-kamal--kamal-proxy--spring-컨테이너)
14. [관측성 Stack (Loki + Grafana + Prometheus + Alertmanager)](#14-관측성-stack)
15. [Supabase 연결 (runtime dependency)](#15-supabase-연결)
16. [NAS MinIO 연결 (runtime dependency)](#16-nas-minio-연결)
17. [GitHub Actions 배포 연동](#17-github-actions-배포-연동)
18. [주기적 작업 / cron](#18-주기적-작업--cron)
19. [메모리 예산](#19-메모리-예산)
20. [재해 복구 — 백업해야 할 대상](#20-재해-복구--백업해야-할-대상)
21. [현재 상태 스냅샷 (2026-04-20)](#21-현재-상태-스냅샷-2026-04-20)
22. [체크리스트 — 파생 레포 첫 배포 전 할 것](#22-체크리스트--파생-레포-첫-배포-전-할-것)

---

## 1. 개요

이 Mac mini 는 template-spring 기반 파생 레포의 24/7 운영 호스트입니다. 여러 파생 레포의 Spring Boot JAR 컨테이너를 [blue/green](../../reference/glossary.md#운영--인프라) 무중단 배포로 서빙하고, 자체 관측성 스택도 같은 기기에서 함께 실행합니다.

설계의 바탕에는 솔로 운영 철학이 깔려 있어요. 한 명의 개발자가 여러 앱을 빠르게 출시하는 "앱 공장" 모델이라, 운영 비용을 최대한 낮추는 게 핵심이에요. 그래서 월 $20 이 넘는 클라우드 VM 대신 전기세 월 $4 수준의 가정용 맥미니를 쓰고, 공인 IP 를 외부에 노출하지 않으면서도 접근을 허용하려고 [Cloudflare Tunnel](../../reference/glossary.md#운영--인프라) 을 둬요. 모든 운영 프로세스는 [Docker](../../reference/glossary.md#운영--인프라) 컨테이너로 돌고, 배포 오케스트레이션은 [Kamal](../../reference/glossary.md#운영--인프라) 이 맡아요. 무거운 빌드는 GitHub Actions 가 대신 짊어지고 Mac mini 는 이미지를 받아 실행만 하는 runtime 전용 호스트로 두는데, 8GB 메모리를 아끼기 위한 선택이에요. 결정의 자세한 근거는 [`ADR-007 · 솔로 친화적 운영`](../../philosophy/adr-007-solo-friendly-operations.md) 과 [`인프라 결정 기록`](../deploy/decisions-infra.md) 에 있어요.

서비스되는 도메인은 현재 `example.com` 영역 아래 세 개예요.

| 호스트 | 대상 | 접근 |
|---|---|---|
| `server.example.com` | Spring Boot API | 공개 |
| `log.example.com` | Grafana 대시보드 | Cloudflare Access 이메일 OTP 게이팅 |
| `admin.example.com` | 관리자 UI | 미래 |

---

## 2. 하드웨어 / OS baseline

| 항목 | 값 |
|---|---|
| 모델 | Apple M2 Mac mini |
| CPU | Apple M2 (arm64) |
| 메모리 | 8 GB |
| 디스크 | 228 GB (여유 155 GB / 현재 시점) |
| OS | macOS 15.3 (24D60) |
| 호스트네임 | `SECHANGui-Macmini.local` |
| Tailscale IP | `100.X.X.X` (node name `home-mac-mini-m1`) |
| 가정 LAN 대역 | `192.168.45.0/24` (NAS MinIO `192.168.X.X`) |

메모리 8GB 는 Phase 0 MVP 에 빠듯한 편이에요. 구체 수치는 [§19 메모리 예산](#19-메모리-예산) 에서 확인하세요. 상시 사용량이 12GB 에 도달하면 관측성 스택을 분리해야 하는데, 이게 [`decisions-infra.md I-06`](../deploy/decisions-infra.md) 재검토 트리거예요.

> 결정 카드 [`I-04`](../deploy/decisions-infra.md) 는 운영 호스트 권장값을 16GB 로 잡고 있어요. 이 문서가 기록한 실제 기기는 M2 8GB 라, 권장 대비 한 단계 아래예요. 그래서 메모리 예산을 더 빡빡하게 점검합니다.

---

## 3. 기술 스택

### 시스템 레이어
| 구성 | 도구 | 버전 | 목적 |
|---|---|---|---|
| Docker 엔진 | OrbStack | 28.5.2 | Docker Desktop 대체. 메모리 오버헤드가 ~150MB 로, Desktop 의 500MB~1GB 대비 가벼움 |
| 관리 접근 네트워크 | [Tailscale](../../reference/glossary.md#운영--인프라) | 최신 | Mac mini SSH 와 NAS MinIO 접근용 tailnet |
| 패키지 매니저 | Homebrew | 최신 | Apple Silicon 기본 prefix `/opt/homebrew` |
| 엣지 터널 | cloudflared | 2025.9.0 | Cloudflare Tunnel 클라이언트 |

### 배포와 오케스트레이션
| 구성 | 도구 | 목적 |
|---|---|---|
| 배포 도구 | Kamal (37signals) | Docker 컨테이너 기반 blue/green 무중단 배포 오케스트레이션 |
| 리버스 프록시 | [kamal-proxy](../../reference/glossary.md#운영--인프라) | Kamal 내장. blue/green 스왑 담당. nginx 대체 |
| 컨테이너 런타임 | Docker, OrbStack 경유 | 모든 런타임 프로세스 |
| 이미지 레지스트리 | [GHCR](../../reference/glossary.md#운영--인프라) | `ghcr.io/<owner>/<repo>:<sha>` |
| CI/CD | GitHub Actions | main CI 성공 → build → push → kamal deploy |
| 빌드 환경 | GHA `ubuntu-latest` + buildx arm64 cross-compile | Mac mini 는 빌드를 하지 않고 이미지 pull 만 함 |

### 애플리케이션 레이어
| 구성 | 도구 | 버전 | 목적 |
|---|---|---|---|
| 런타임 이미지 | `eclipse-temurin:21-jre-alpine` | JDK 21 | Dockerfile multi-stage 의 runtime 단. 빌드 단은 `21-jdk-alpine` |
| 프레임워크 | Spring Boot | 3.x | 모듈러 모놀리스 아키텍처 |
| DB driver | HikariCP + PostgreSQL JDBC | 표준 | [HikariCP](../../reference/glossary.md#데이터베이스) 풀 + 표준 JDBC Postgres |
| 마이그레이션 | [Flyway](../../reference/glossary.md#데이터베이스) | 앱 schema 당 V001~V026 | `app.flyway.mode` 분기 (ADR-033) — prod 는 VALIDATE_ONLY (부팅 시 검증만), 적용은 `tools/migrate-prod.sh` |

### 데이터 레이어 — 런타임 의존성
| 자원 | 위치 | 역할 |
|---|---|---|
| [Supabase](../../reference/glossary.md#데이터베이스) Postgres | `aws-1-<region>.pooler.supabase.com` | 운영 DB. pooler 경유 관리형 Postgres |
| NAS MinIO | `192.168.X.X:9000`, LAN | S3 호환 오브젝트 스토리지. Tailscale 없이도 가정 LAN 안에서 접근 |

### 관측성 — Mac mini 셀프 호스트
| 구성 | 도구 | 포트 | retention | 목적 |
|---|---|---|---|---|
| 메트릭 수집 | [Prometheus](../../reference/glossary.md#관측성--로깅) | 9090 | 7일 | docker_sd 로 Spring actuator scrape |
| 로그 수집 | [Loki](../../reference/glossary.md#관측성--로깅) | 3100 | 14일 | Spring 의 logback-loki appender 가 push |
| 대시보드 | [Grafana](../../reference/glossary.md#관측성--로깅) | 3000 | — | Loki·Prometheus 동시 조회. `log.*` 로 공개, CF Access 게이팅 |
| 알림 | [Alertmanager](../../reference/glossary.md#관측성--로깅) | 127.0.0.1:9093 | — | Discord webhook 라우팅. Compose profile 로 옵트인 기동 |

### 엣지와 보안
| 구성 | 제공 | 목적 |
|---|---|---|
| TLS 종료 | Cloudflare Edge | 자동 인증서 발급과 갱신 |
| DDoS 방어 | Cloudflare Free plan | 기본 방어 |
| WAF Rate Limiting | Cloudflare Free | IP 당 100 요청 / 10초 |
| 국가 차단 | Cloudflare Custom Rule | CN·KP·RU·BY·SY 차단 |
| 관리자 인증 | [Cloudflare Access](../../reference/glossary.md#인증--보안) | `log.*` 이메일 OTP. Free plan 50 users |
| 공개 IP 노출 | 없음 | cloudflared 가 outbound-only 라 홈 IP 가 드러나지 않음 |

---

## 4. 네트워크 구성도

```
                         [인터넷 사용자]
                                │ HTTPS
                                ▼
          ┌─────────────────────────────────────────────┐
          │            Cloudflare Edge                    │
          │  - TLS 종료                                    │
          │  - DDoS 방어                                   │
          │  - WAF (rate limit 100/10s, country block)     │
          │  - Access (log.*, admin.* 이메일 OTP)           │
          └────────────────┬────────────────────────────┘
                           │ outbound-only Cloudflare Tunnel
                           │ (cloudflared 프로세스가 4개 edge 연결 유지)
                           ▼
          ┌─────────────────────────────────────────────┐
          │        Mac mini (가정 내, 집 ISP 뒤)            │
          │          Tailscale IP 100.X.X.X          │
          │                                               │
          │   ┌──────────────────────────────────┐        │
          │   │ cloudflared 프로세스              │        │
          │   │   ~/.cloudflared/<your-tunnel-name>.yml   │        │
          │   │   server.<domain> → :80          │        │
          │   │   log.<domain>    → :3000        │        │
          │   └────────┬─────────────────────────┘        │
          │            │                                  │
          │    ┌───────┴───────────────────────┐          │
          │    │                                 │         │
          │    ▼ (server.*)          ▼ (log.*)            │
          │  :80 kamal-proxy        :3000 Grafana          │
          │   │ blue/green 스왑                            │
          │   ▼                                           │
          │  Spring 컨테이너 (:8080)                        │
          │   (kamal 네트워크 내부)                         │
          └───────────────────────────────────────────────┘
                           │
        ┌──────────────────┼────────────────────────┐
        │                  │                         │
        ▼ JDBC             ▼ S3 API (LAN)            ▼ logback-loki
  Supabase Postgres    NAS MinIO                  Loki 컨테이너
  (Seoul pooler)       192.168.X.X:9000        (같은 kamal 네트워크)

[관리 접근 별도 경로]
   개발자 laptop ──Tailscale──▶ Mac mini (100.X.X.X)
                                   │ SSH port 22
                                   ▼
                               shell + docker + kamal CLI
```

세 가지 경로가 핵심이에요. 공개 트래픽은 전부 Cloudflare 엣지를 거쳐 Tunnel 로 들어오므로 집 ISP 의 공인 IP 가 전혀 노출되지 않아요. 관리 접근은 별도 VPN 인 Tailscale 로만 열려서 공인 IP 가 필요 없어요. 내부 LAN 자원인 NAS MinIO 는 외부 노출 없이 가정 LAN 안에서 직접 접근해요.

---

## 5. 프로젝트 운영 구성도

```
   ┌──────────────────────── 개발자 / 파생레포 레이어 ───────────────────────┐
   │                                                                         │
   │  developer laptop                                                       │
   │   ├─ 파생레포 git clone + .env                                          │
   │   ├─ ./gradlew :bootstrap:bootRun    (로컬 dev, docker postgres 공유)    │
   │   └─ git push origin main                                               │
   │              │                                                           │
   │              ▼                                                           │
   │     GitHub (파생레포)                                                    │
   │       ├─ docs-check / ci.yml / commit-lint 등 검증                       │
   │       └─ deploy.yml 워크플로우 트리거 (opt-in gate: DEPLOY_ENABLED=true)   │
   └──────────────────────────────┬──────────────────────────────────────────┘
                                  │
   ┌──────────── GitHub Actions ubuntu-latest runner ────────────────────────┐
   │                                                                         │
   │  1. actions/checkout                                                    │
   │  2. tailscale/github-action — tailnet 임시 조인 (OAuth client)           │
   │  3. ruby/setup-ruby + gem install kamal                                 │
   │  4. docker/setup-buildx-action (arm64 cross-compile)                     │
   │  5. docker/login-action ghcr.io (runner 측 auth)                         │
   │  6. kamal deploy                                                        │
   │       ├─ docker build (멀티스테이지, arm64)                              │
   │       ├─ docker push → ghcr.io/<owner>/<repo>:<sha>                      │
   │       └─ SSH <your-mac-user>@100.X.X.X (Tailscale 경유)                   │
   │                                                                         │
   └──────────────────────────────┬──────────────────────────────────────────┘
                                  │ SSH
                                  ▼
   ┌────────────────────── Mac mini 운영 호스트 ─────────────────────────────┐
   │                                                                         │
   │  Kamal 이 host 에서 지시:                                                │
   │    1. docker pull <새 이미지 태그>                                        │
   │    2. Green 컨테이너 docker run (새 host port, 내부 8080)                 │
   │    3. kamal-proxy 헬스체크 반복 (/actuator/health/liveness)              │
   │    4. 건강해지면 트래픽 원자 전환 (Blue → Green)                          │
   │    5. Blue 컨테이너 SIGTERM → Spring graceful shutdown (30s)              │
   │    6. Blue 제거                                                          │
   │                                                                         │
   │  결과: 사용자는 끊김 없이 새 버전 응답 받음                                 │
   │                                                                         │
   └─────────────────────────────────────────────────────────────────────────┘
```

배포를 트리거하는 경로는 세 가지예요.

| 경로 | 트리거 | 용도 |
|---|---|---|
| 자동 | main CI 성공 → `deploy.yml` 의 `workflow_run` | 기본 루트 |
| 수동 GHA | `workflow_dispatch` 로 특정 커밋 지정 | 재배포 |
| 수동 로컬 | 개발자 노트북에서 `prod deploy` 또는 `kamal deploy` 직접 호출 | 예외 상황과 hotfix |

---

## 6. 인프라 리소스 구성도

```
┌─── GitHub ────────────────────────────────────────────────────┐
│  <your-github-account>/template-spring   (template 레포)           │
│  <your-github-account>/<your-repo>                 (실제 배포 타겟)            │
│  ghcr.io/<your-github-account>/<your-repo>         (이미지 레지스트리)           │
└───────────────────────────────────────────────────────────────┘
                │
                │ GHA runner SSH (Tailscale)
                ▼
┌─── Mac mini (100.X.X.X / home-mac-mini-m1) ───────────────┐
│                                                                │
│  cloudflared 프로세스 (system launchd or nohup)                  │
│  └─ ~/.cloudflared/                                            │
│       ├─ <your-tunnel-name>.yml         (tunnel config)                 │
│       ├─ e1aae337-...json       (tunnel credentials)            │
│       ├─ cert.<your-domain>.pem  (account cert, 갱신 주의)    │
│       └─ config.moojigae.yml.archive  (과거 기록, 보존)          │
│                                                                │
│  Docker (OrbStack) 네트워크 `kamal`:                            │
│    ├─ kamal-proxy                        (:80 호스트 바인드)     │
│    ├─ template-spring-web-<sha>  (Blue)                 │
│    ├─ template-spring-web-<sha>  (Green, 배포 중)        │
│    ├─ observability-prometheus           (:9090 외부 노출)       │
│    ├─ observability-loki                 (:3100)                │
│    ├─ observability-grafana              (:3000)                │
│    └─ observability-alertmanager         (127.0.0.1:9093)       │
│                                                                │
│  Docker credential helper (필수):                                │
│    └─ ~/.docker/bin/docker-credential-filefake                   │
│       + ~/.docker/helper-creds.json (GHCR token 저장)            │
│    (macOS Keychain 비대화형 SSH 실패 회피용)                     │
│                                                                │
│  Shell env (필수):                                               │
│    ├─ ~/.zprofile  (interactive shells)                         │
│    └─ ~/.zshenv    (non-interactive SSH — Kamal 필수 의존)       │
│                                                                │
│  SSH authorized_keys:                                            │
│    ├─ hexator****@gmail.com  (관리자 접근)                       │
│    └─ gha_deploy@<파생레포>  (GHA 배포 전용)                      │
└────────────────────────────────────────────────────────────────┘
       │              │                    │
       │ JDBC :6543  │ S3 API :9000 (LAN) │ Tailscale
       ▼              ▼                    ▼
┌──────────────┐ ┌──────────────────┐ ┌──────────────────┐
│  Supabase    │ │  시놀로지 NAS      │ │  Tailscale 기기들 │
│  Postgres    │ │  192.168.X.X    │ │  - home-macbook   │
│  Seoul       │ │  (MinIO 컨테이너) │ │  - bluebirds     │
│  pooler      │ │                   │ │  - ipad-air      │
│              │ │  * LAN 내 + tailnet │ │  - phone-galaxy   │
│              │ │    (외부 노출 X)  │ │  (총 7개 노드)     │
└──────────────┘ └──────────────────┘ └──────────────────┘

┌─── Cloudflare (account: <your-cloudflare-account>) ──────────────────────────┐
│                                                                │
│  Zone example.com:                                         │
│    DNS CNAME records:                                            │
│      server.example.com → tunnel e1aae337                   │
│      log.example.com    → tunnel e1aae337                   │
│                                                                  │
│  Tunnels:                                                        │
│    <your-tunnel-name> (e1aae337-90b1-4661-a030-dfa498a91648)        │
│      ├─ cert: 이 Cloudflare 계정 권한으로 발급                    │
│      └─ 4 connection 유지 (icn05, icn06, icn01)                  │
│                                                                  │
│  Zero Trust / Access:                                            │
│    Application: Grafana (log.example.com)                   │
│      Policy: Allow emails [dev**rhexa***@gmail.com]            │
│      Session: 24h / One-time PIN                                 │
│                                                                  │
│  WAF:                                                            │
│    Rate Limiting rule: rate-limit-100-per-10s                    │
│      IP Source Address, 100 req / 10s, Block 10s                 │
│    Custom Rule: block-high-risk-countries                        │
│      Country in {CN, KP, RU, BY, SY} → Block                     │
│                                                                  │
│  Free plan 한계:                                                  │
│    - Rate Limiting rule 1개                                       │
│    - Access 50 users                                              │
│    - Period 최대 10초 / duration 최대 10초                         │
└──────────────────────────────────────────────────────────────────┘
```

---

## 7. 개념적 결정 (Why 이렇게 설계했나)

### 7.1 왜 맥미니 홈서버인가
월 $20 이 넘는 클라우드 VM 에 비해 전기세는 월 $4 수준이에요. M2 8GB 는 성능으로 보면 AWS t4g.xlarge 급이라, 1년이면 본전을 뽑아요. 트레이드오프는 단일 장애점이라는 점이에요. 집 ISP 가 멈추면 서비스도 멈춰요. MAU 가 5K 를 넘으면 클라우드 이관을 재검토하는데, 이게 [`decisions-infra.md I-04`](../deploy/decisions-infra.md) 트리거예요.

### 7.2 왜 Cloudflare Tunnel 인가
홈 공인 IP 를 공개 인터넷에 노출하지 않으면서도 외부 접근을 허용하기 위해서예요. TLS 종료와 WAF·DDoS 방어를 Cloudflare 엣지에 위임하므로 Mac mini 부담이 줄어요. Free plan 이라 비용도 0 이에요. 검토했던 대안 — DDNS 와 포트포워딩, Tailscale Funnel, nginx 와 Let's Encrypt — 은 [`decisions-infra.md I-05`](../deploy/decisions-infra.md) 에 있어요.

### 7.3 왜 Docker + Kamal 인가
Docker 이미지는 불변 배포 단위라, 버전 롤백이 이미지 tag 하나를 바꾸는 일로 끝나요. Kamal 은 단일 호스트의 blue/green 스왑을 검증된 도구로 운영하게 해줘요. 커스텀 bash 로 직접 재구현하는 것보다 신뢰할 수 있고요. 대안 검토 기록은 [`decisions-infra.md I-09`](../deploy/decisions-infra.md) 에 있어요.

### 7.4 왜 OrbStack (Docker Desktop 아님)?
Docker Desktop 의 Linux VM 은 메모리 2GB 를 기본 예약하고 반환되지 않아요. OrbStack 은 네이티브 Linux VM 으로 ~150MB 오버헤드만 가져요. 8GB 기기엔 체감 큰 차이가 나요. OrbStack 의 `docker` / `docker compose` CLI 는 완전 호환돼요.

### 7.5 왜 관리 접근에 Tailscale 인가
집 공유기에 포트포워딩을 뚫지 않고도 어디서든 Mac mini 에 SSH 로 접근하기 위해서예요. NAS MinIO 를 외부 개발자와 공유해야 할 때도 tailnet 으로 간단히 확장할 수 있고요. Free plan 이 노드 100개까지 커버해 솔로 운영엔 충분해요.

### 7.6 왜 처음부터 blue/green 인가
파생 레포 하나 안에 모듈러 모놀리스로 N 개의 앱 모듈을 둬요. 앱 하나만 고쳐도 전체를 재배포해야 하는 구조라, 재시작 downtime 이 앱 수만큼 증폭돼요. 앱이 1개일 때 blue/green 을 셋업해 두면 N 이 늘어도 추가 복잡도가 0 이에요.

### 7.7 왜 관측성을 운영(Mac mini) 전용?
로컬 dev 에서 Loki / Grafana / Prom 활용 빈도가 낮아요. 맥북 메모리와 docker 자원만 소비해요. 운영에서 실제 트래픽 분석과 장애 대응에 필요한 도구라 운영 전용으로 범위를 조정했어요 (2026-04-19).

### 7.8 왜 docker credential helper 를 직접 만들었나
Kamal 은 `docker login` 을 비대화형 SSH 로 Mac mini 에 호출해요. macOS 기본 자격 저장소인 `osxkeychain` 은 Keychain 을 열어야 하는데, 비대화형 SSH 세션은 Keychain 을 unlock 하지 못해 에러 `-25308` 이 나요. 그래서 Python 으로 구현한 파일 기반 fake helper 로 우회합니다. 보안 측면에서는 자격이 평문 base64 로 `~/.docker/helper-creds.json` 에 저장되지만, Mac mini 는 단일 사용자에 Tailscale 로만 접근하므로 수용 가능한 위험이에요. 자세한 설치는 [§10](#10-docker-credential-helper) 을 보세요.

### 7.9 왜 DB provider 를 자유롭게 고를 수 있게 했나
템플릿 성격을 유지하기 위해서예요. 코드는 HikariCP 와 표준 JDBC 만 쓰고 Supabase 의 Realtime·RLS·auth 같은 고유 API 에는 의존하지 않습니다. 그래서 파생 레포 소유자가 자기 인프라가 있다면 — 예를 들어 기존 AWS RDS 를 재사용한다면 — `DB_URL` 만 바꾸면 됩니다. 템플릿 관리자의 기본값은 Supabase 예요. Seoul region, Free tier, Supavisor pooler 조합이고요.

### 7.10 왜 actuator 를 별도 포트로 분리하지 않고 app port 와 공유하나
원래는 `management.server.port: 8090` 으로 분리했어요. 그런데 Kamal 2.11 의 `proxy.healthcheck` 스키마가 `port:` 키를 받지 않아요. 그래서 kamal-proxy 의 healthcheck 가 app port 에서 `/actuator/health/liveness` 를 hit 하도록 단일 포트로 통합했어요. 노출은 `health`·`info`·`prometheus` 만 허용해 민감한 엔드포인트를 차단합니다. 더 엄격한 격리가 필요해지면 별도 포트를 두고 kamal-proxy healthcheck 를 main-port 의 가벼운 엔드포인트로 바꿀 수 있어요.

---

## 8. 시스템 기본 셋업

### 8.1 macOS

운영 호스트는 잠들지 않고 재부팅 후 스스로 일어서야 해요. 그래서 네 가지를 잡아 둡니다.

- 버전은 15.3 (24D60) 이에요.
- 업데이트 정책 — 주요 업데이트는 시스템 설정의 소프트웨어 업데이트에서 수동으로만 적용해요. 자동 보안 업데이트는 기본값 그대로 허용하고요.
- 잠자기 방지 — System Settings → Lock Screen 에서 "Start Screen Saver when inactive" 를 Never 로, Power Adapter 설정의 "Prevent automatic sleeping on power adapter when the display is off" 를 ON 으로 둬요.
- 재부팅 후 자동 로그인 — System Settings → Users & Groups 에서 Auto-login 을 켜기를 권장해요. 그래야 재부팅 직후 launchd 에이전트와 cloudflared 가 바로 기동해요.

### 8.2 Homebrew 설치
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
# Prefix: /opt/homebrew (Apple Silicon 기본)
```

### 8.3 Tailscale 설치 + 노드 등록
```bash
brew install --cask tailscale
# GUI 에서 로그인 (hexator****@gmail.com 계정)
# 자동 시작 설정: Tailscale.app 메뉴 → Preferences → "Run Tailscale at login"
```
Tailscale admin console 에서 기기명을 `home-mac-mini-m1` 로 설정. Tailscale IP `100.X.X.X` 가 할당됨 (다른 노드들이 이 IP 로 접근).

### 8.4 OrbStack 설치
```bash
brew install --cask orbstack
# 첫 실행: open -a OrbStack
# 초기 세팅 GUI 에서 완료
```

Docker Desktop 이 이미 설치돼있으면 종료 권장 (메모리 충돌 방지). 이후 `docker` CLI 는 OrbStack 의 바이너리가 응답.

### 8.5 SSH daemon 활성화
System Settings → General → Sharing → Remote Login ON. 이후 Tailscale IP 로 SSH 접근 가능:
```bash
ssh <your-mac-user>@100.X.X.X
```

### 8.6 cloudflared 설치
```bash
brew install cloudflared
```
정상 설치 확인: `cloudflared --version` → `cloudflared version 2025.9.0` (또는 이상).

---

## 9. Shell 환경

### 9.1 `~/.zprofile` — login / interactive shells
Homebrew 설치 시 자동 추가되는 내용 + OrbStack 통합:
```zsh
eval "$(/opt/homebrew/bin/brew shellenv)"

# Added by OrbStack: command-line tools and integration
source ~/.orbstack/shell/init.zsh 2>/dev/null || :
```

### 9.2 `~/.zshenv` — 비대화형 SSH shell, Kamal 이 필수로 의존

비대화형 `ssh host 'command'` 를 실행할 때 macOS 는 `.zprofile` 을 로드하지 않아요. 그러면 Kamal 의 원격 명령이 `docker` 와 `cloudflared` 의 PATH 를 찾지 못해요. 그래서 `.zshenv` 에 환경을 다시 잡아 줍니다.

```zsh
# ~/.zshenv
eval "$(/opt/homebrew/bin/brew shellenv)"
source ~/.orbstack/shell/init.zsh 2>/dev/null || :
export PATH="$HOME/.docker/bin:$PATH"   # docker-credential-filefake 용
```

이 파일은 무조건 필요해요. Kamal 이 동작하지 않는 가장 흔한 원인이 바로 이 설정 누락이에요.

### 9.3 PATH 우선순위 (검증 명령)
```bash
ssh <your-mac-user>@100.X.X.X 'echo $PATH'
# 기대값:
# /Users/<your-mac-user>/.docker/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin:/Users/<your-mac-user>/.orbstack/bin
```

---

## 10. Docker credential helper

### 10.1 문제
Kamal 은 원격 `docker login ghcr.io -u X -p Y` 를 비대화형 SSH 로 호출해요. 이때 macOS 기본 `credsStore=osxkeychain` 이 실행되는데, Keychain 은 GUI 세션에서만 unlock 상태라 비대화형 SSH 에서는 에러가 나요.
```
Error saving credentials: error storing credentials - err: exit status 1
out: `User interaction is not allowed. (-25308)`
```

### 10.2 해결 — 파일 기반 fake helper
`~/.docker/bin/docker-credential-filefake` 스크립트를 작성해요. macOS 에 기본 내장된 Python 3 가 필요해요.
```sh
#!/bin/sh
STORE="$HOME/.docker/helper-creds.json"
[ ! -f "$STORE" ] && echo "{}" > "$STORE"
case "$1" in
  store)
    python3 -c "
import json, sys, os
inp = json.load(sys.stdin)
store = os.path.expanduser(\"$STORE\")
data = json.load(open(store))
data[inp[\"ServerURL\"]] = {\"username\": inp[\"Username\"], \"secret\": inp[\"Secret\"]}
json.dump(data, open(store, \"w\"), indent=2)
"
    ;;
  get)
    python3 -c "
import json, sys, os
server = sys.stdin.read().strip()
data = json.load(open(os.path.expanduser(\"$STORE\")))
entry = data.get(server)
if not entry:
    print(\"{}\"); sys.exit(0)
print(json.dumps({\"ServerURL\": server, \"Username\": entry[\"username\"], \"Secret\": entry[\"secret\"]}))
"
    ;;
  erase)
    python3 -c "
import json, sys, os
server = sys.stdin.read().strip()
store = os.path.expanduser(\"$STORE\")
data = json.load(open(store))
data.pop(server, None)
json.dump(data, open(store, \"w\"), indent=2)
"
    ;;
  list) echo "{}" ;;
esac
```

실행 권한 + Docker 설정:
```bash
chmod +x ~/.docker/bin/docker-credential-filefake

# ~/.docker/config.json
cat > ~/.docker/config.json <<EOF
{
  "auths": {},
  "credsStore": "filefake",
  "currentContext": "orbstack"
}
EOF
```

검증은 비대화형 SSH 를 시뮬레이션해서 해요.
```bash
ssh <your-mac-user>@100.X.X.X 'docker login ghcr.io -u <user> -p <token> 2>&1 | tail -3'
# 기대: "Login Succeeded"
```

### 10.3 보안 주의

이 helper 는 token 을 `~/.docker/helper-creds.json` 에 base64 가 아닌 평문 JSON 으로 저장합니다. Mac mini 가 단일 사용자에 Tailscale 로만 접근하는 호스트라 수용 가능한 수준이지만, 그래도 `chmod 600 ~/.docker/helper-creds.json` 으로 권한을 최소화해 둬요. Phase 2 에서는 1Password CLI·sops·Vault 같은 정식 시크릿 관리 체계로 대체할 예정이에요.

---

## 11. Cloudflare Tunnel 구성

> 무엇이 자동인지 먼저 — 터널을 한 번 만들어 두면, 호스트별 DNS 레코드와 Tunnel ingress 등록은 이제 `prod init` 이 자동으로 처리해요. `tools/init-prod.sh` 가 `tools/lib/cloudflare.sh` 를 호출해 `CLOUDFLARE_API_TOKEN` 하나만으로 Zone ID·Account ID·Tunnel ID 를 추출하고, `server.<도메인>` 의 CNAME 과 ingress 항목을 Cloudflare API 로 생성해요. 아래 §11.3 의 `cloudflared tunnel route dns` 는 그 자동화가 안에서 무슨 일을 하는지 보여주는 손작업 버전이에요. 터널 자체의 최초 생성(§11.1)과 launchd 영속화(§11.4)는 여전히 호스트에서 한 번 손으로 해 둬야 해요. 배포 절차 전체는 [`deployment.md`](../deploy/deployment.md) 를 참고하세요.

### 11.1 tunnel 생성 (최초 1회, 손작업)
```bash
cloudflared tunnel login
# 브라우저로 example.com zone 선택 → Authorize
# → ~/.cloudflared/cert.pem 생성 (account cert)

cloudflared tunnel create <your-tunnel-name>
# → ~/.cloudflared/<uuid>.json 생성 (tunnel credentials)
```

현재 터널 UUID 는 `e1aae337-90b1-4661-a030-dfa498a91648` 이에요. 템플릿 관리자의 개인 UUID 라, 본인 환경에서는 새로 발급되는 UUID 로 바꿔야 해요.

### 11.2 config 파일 — `~/.cloudflared/<your-tunnel-name>.yml`
```yaml
tunnel: e1aae337-90b1-4661-a030-dfa498a91648
credentials-file: /Users/<your-mac-user>/.cloudflared/e1aae337-90b1-4661-a030-dfa498a91648.json
origincert: /Users/<your-mac-user>/.cloudflared/cert.<your-domain>.pem

ingress:
  - hostname: server.example.com
    service: http://localhost:80        # kamal-proxy
  - hostname: log.example.com
    service: http://localhost:3000      # Grafana
  - service: http_status:404
```

### 11.3 DNS 라우팅 (자동화의 손작업 버전)

`prod init` 이 호스트별 라우팅을 자동으로 등록하지만, 안에서 무슨 일이 벌어지는지는 아래 명령으로 드러나요. Cloudflare Zone 에 CNAME 레코드를 만들어 `<uuid>.cfargotunnel.com` 으로 가리키게 하는 거예요.
```bash
cloudflared tunnel route dns <your-tunnel-name> server.example.com
cloudflared tunnel route dns <your-tunnel-name> log.example.com
```

### 11.4 실행과 영속화

터널을 띄우는 방법은 두 가지예요. 임시로 띄울 땐 nohup 을 쓰지만 세션이 끝나면 유지되지 않아요. 운영에서는 부팅 시 자동 기동하도록 launchd plist 로 등록하기를 권장해요.

```bash
# 방법 A — nohup (임시)
nohup cloudflared tunnel --config ~/.cloudflared/<your-tunnel-name>.yml run > /tmp/<your-tunnel-name>-tunnel.log 2>&1 &
```

```bash
# 방법 B — launchd plist (권장, 부팅 시 자동 기동)
cat > ~/Library/LaunchAgents/site.<your-tunnel-name>.cloudflared.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>site.<your-tunnel-name>.cloudflared</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/cloudflared</string>
    <string>tunnel</string>
    <string>--config</string>
    <string>/Users/<your-mac-user>/.cloudflared/<your-tunnel-name>.yml</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/cloudflared.out.log</string>
  <key>StandardErrorPath</key><string>/tmp/cloudflared.err.log</string>
</dict>
</plist>
EOF
launchctl load ~/Library/LaunchAgents/site.<your-tunnel-name>.cloudflared.plist
```

> plist 의 `Label` 은 [`deployment.md §2.6`](../deploy/deployment.md) 의 `site.<파생레포>.cloudflared` 규약과 같은 형태예요. 본인 환경에서는 `<your-tunnel-name>` 자리에 실제 식별자를 넣어요.

현재 상태로는 plist 가 아직 없고 nohup 으로도 떠 있지 않아요. 파생 레포를 배포할 때 기동이 필요해요.

### 11.5 운영 검증

터널이 살아 있는지와 외부 접근이 닿는지를 확인해요.
```bash
# tunnel 활성 connection 확인 — 기대: 4 connections (icn05, icn06, icn01 중 일부)
cloudflared tunnel info <your-tunnel-name>

# 외부 HTTP 접근 — Spring 기동 시 HTTP/2 200
curl -sSfI https://server.example.com/actuator/health
```

---

## 12. Cloudflare Zone 설정

> 여기서 DNS 레코드 생성(§12.1)은 `prod init` 이 자동으로 처리해요. 반면 Access·WAF·Custom Rule(§12.2~§12.4)은 자동화돼 있지 않아서 Cloudflare 대시보드에서 손으로 한 번 설정해야 해요. 이 구분을 먼저 잡아 두세요.

### 12.1 DNS records — zone `example.com`

Tunnel 경유 CNAME 두 개가 잡혀요. `cloudflared tunnel route dns`, 또는 `prod init` 의 자동 등록이 만들어요. TTL 은 처음엔 300 으로 두고 안정되면 3600 으로 올리기를 권장해요.
```
server  CNAME  e1aae337-90b1-4661-a030-dfa498a91648.cfargotunnel.com  (proxied)
log     CNAME  e1aae337-90b1-4661-a030-dfa498a91648.cfargotunnel.com  (proxied)
```

### 12.2 Cloudflare Access (Zero Trust) — 손작업

Dashboard → Zero Trust → Access → Applications → Add application 에서 아래 값으로 등록해요.

| 항목 | 값 |
|---|---|
| Type | Self-hosted |
| Application name | `Grafana - log.example.com` |
| Application domain | `log.example.com` |
| Session duration | 24 hours |
| Policy | `Admin only` · Action Allow · Include → Emails → `dev**rhexa***@gmail.com` |
| Identity provider | One-time PIN (기본) |

Free plan 은 50 users 까지 커버해요. 현재는 개인 이메일 1개만 등록돼 있어요.

### 12.3 WAF Rate Limiting — 손작업

Dashboard → Security → WAF → Rate limiting rules 에서 등록해요.

| 항목 | 값 |
|---|---|
| Name | `rate-limit-100-per-10s` |
| Match | URI 경로 wildcard `/` (모든 요청) |
| Characteristics | IP Source Address |
| Requests / Period | 100 / 10초 |
| Action | Block |
| Duration | 10초 (Free plan 최대값) |

공격자 입장에서는 10초 차단이 풀리자마자 다시 임계치를 넘겨 재차단되므로, 실질적으로 연속 차단이 돼요. Free plan 의 rule 슬롯 1개를 소비해요.

### 12.4 Custom Rule — 국가 차단 (손작업)

Dashboard → Security → WAF → Custom rules 에서 등록해요.

| 항목 | 값 |
|---|---|
| Name | `block-high-risk-countries` |
| Match | Country in `{CN, KP, RU, BY, SY}` (OR 연결) |
| Action | Block |

Free plan 의 5개 슬롯 중 1개를 소비해요.

### 12.5 평가 순서

규칙이 적용되는 순서예요. 위에서부터 차례로 평가돼요.
```
1. IP Access Rules (Allow)  — 본인 IP 화이트리스트는 여기서 우선 처리
2. Custom Rules             — 국가 차단
3. Rate Limiting Rules      — 100 req/10s
4. Managed Rules            — Pro+ 만
5. Origin (Mac mini cloudflared)
```

---

## 13. Kamal + kamal-proxy + Spring 컨테이너

### 13.1 Kamal 은 GHA runner 와 개발자 노트북에서 실행
```bash
gem install kamal
# 버전 2.11 이상
```
Kamal 은 Mac mini 호스트에는 설치하지 않아요. SSH 로 원격 제어합니다.

### 13.2 `kamal setup` 이 Mac mini 에 만드는 것

처음 한 번 `kamal setup` 을 돌리면 세 가지가 생겨요.

- `:80` 을 호스트에 바인드하는 `kamal-proxy` 컨테이너
- Docker 볼륨과 `kamal` 네트워크
- `.kamal/` 안의 관리 파일

### 13.3 Spring 컨테이너 사양

| 항목 | 값 |
|---|---|
| 이미지 | `ghcr.io/<owner>/<repo>:<commit-sha>` |
| 내부 포트 | 8080 (Dockerfile EXPOSE 와 일치, `proxy.app_port` 도 8080) |
| 호스트 포트 | Kamal 이 동적 할당. blue/green 이 번갈아 다른 포트를 잡음 |
| 네트워크 | `kamal` |
| 라벨 | `service=<name>`·`role=web`·`destination=<image>`. Prometheus docker_sd 가 이 라벨로 발견 |
| 환경변수 | `config/deploy.yml` 의 `env.clear` 와 `env.secret` 주입 |

### 13.4 Blue/Green 동작 흐름
자세한 동작은 [`운영 배포 가이드`](../deploy/deployment.md) 와 [`운영 런북`](../deploy/runbook.md) 을 참고하세요.

---

## 14. 관측성 Stack

### 14.1 파일 위치
Mac mini 에 파생 레포를 clone 한 뒤 `infra/docker-compose.observability.yml` 을 써요. 도그푸딩 때는 `prod init` 이 `infra/` 를 호스트로 rsync 해 줘요.

### 14.2 기동
```bash
cd <파생레포>
docker compose -f infra/docker-compose.observability.yml up -d
```
순서가 중요해요. `kamal setup` 이 `kamal` 네트워크를 먼저 만들어야, 관측성 compose 의 `external: true` 조인이 성공해요.

### 14.3 컨테이너와 포트

| 컨테이너 | 이미지 | 호스트 포트 | 외부 접근 | mem_limit | 용도 |
|---|---|---|---|---|---|
| observability-prometheus | `prom/prometheus:v2.55.0` | 9090 | 내부 | 512m | 메트릭 저장, retention 7일 |
| observability-loki | `grafana/loki:3.2.0` | 3100 | 내부 | 256m | 로그 저장, retention 14일 |
| observability-grafana | `grafana/grafana:11.3.0` | 3000 | `log.<domain>`, CF Access | 256m | 대시보드 |
| observability-alertmanager | `prom/alertmanager:v0.27.0` | 127.0.0.1:9093 | 내부 전용 | 64m | Discord webhook 라우팅 |

Alertmanager 는 Compose `profiles: [alertmanager]` 로 묶여 있어요. `DISCORD_WEBHOOK_URL` 이 설정됐을 때만 옵트인으로 기동하므로, 미설정 환경에서는 아예 뜨지 않아요.

### 14.4 Prometheus docker_sd 설정
`infra/prometheus/prometheus.yml` 의 `docker_sd_configs` 가 `kamal` 네트워크 안에서 `role=web` 라벨이 붙은 컨테이너를 자동으로 발견해요. Spring 컨테이너 이름이 배포마다 바뀌어도 라벨 기반이라 안정적으로 잡혀요. scrape 대상 포트는 8080, 경로는 `/actuator/prometheus` 예요.

Prometheus 컨테이너는 `/var/run/docker.sock:ro` 로 호스트 소켓을 읽어요. 권한 때문에 `user: root` 로 실행하는데, Phase 2 에 `docker-socket-proxy` 로 분리할 예정이에요.

---

## 15. Supabase 연결

### 15.1 Template 관리자 현재 프로젝트

| 항목 | 값 |
|---|---|
| Project reference | `***SUPABASE_PROJECT_REF***` |
| Region | `aws-1-ap-northeast-2` (Seoul) |
| Direct | `postgresql://postgres.***SUPABASE_PROJECT_REF***:<pw>@aws-1-<region>.pooler.supabase.com:5432/postgres` |
| Supavisor pooler | 위 URL 의 port 를 `6543` 으로 바꾸고 `?pgbouncer=true` 추가 |

비밀번호는 가끔 rotate 하기를 권장해요. 현재 값은 본인이 관리해요.

### 15.2 Template 요구사항 — provider 무관

코드가 표준 JDBC 만 쓰므로 어떤 Postgres 든 아래 값만 채우면 동작해요.

- `DB_URL` — Spring 기동 시 `spring.datasource.url` 로 바인딩돼요.
- `DB_USER` 와 `DB_PASSWORD`
- `DB_PSQL_URL` — `new app --provision-db` 가 schema 와 role 을 만들 때 쓰는 관리자 권한 connection 이에요. 운영 DB 의 admin 자격은 `.env` 에 저장하지 말고, 명령 실행 직전에 shell 에서 export 로만 주입해요. 로컬 docker URL 만 `.env.example` 에 기본값으로 들어 있어요.

### 15.3 현재 schema 상태

> ⚠️ 정정 — 이전 판의 "Flyway 가 V001~V008 로 core schema 재생성" 설명은 더 이상 맞지 않아요. `core` schema 개념 자체가 [`ADR-037`](../../philosophy/adr-037-core-schema-deprecation.md) 으로 폐기됐어요.

[ADR-037](../../philosophy/adr-037-core-schema-deprecation.md) 이후 별도의 `core` schema 는 존재하지 않아요. 각 앱의 `users`·`auth`·`device` 테이블은 그 앱의 schema 안에 V001~V006 으로 생성돼요. `core/core-*-impl` 의 Java 코드는 라이브러리 역할로 남아서, 각 앱 DataSource 의 `entityPackagesToScan()` 에 포함돼 앱 schema 의 같은 테이블 위에서 동작해요.

그래서 파생 레포에 새 앱을 추가하면, 그 앱 schema 가 기본 25개 마이그레이션 (V001~V026, V007 제외) 을 받아요. 구성은 [onboarding 의 마이그레이션 표](../../start/onboarding.md#3-첫-앱-모듈-추가) 와 같아요. 인증 기반이 V001~V006, admin 시드가 V007 (`--seed-admin` opt-in — 기본 미생성), 결제·구독·감사가 V008~V012, 2FA 와 알림이 V013~V014, 휴대폰 점유인증이 V015, 이메일 소유확인 코드·활동 추적이 V016~V017, 운영·콘솔이 V018~V021, 환불·콘텐츠·분석이 V022~V025 예요. 도메인 테이블은 V027 부터 작성해요.

---

## 16. NAS MinIO 연결

### 16.1 위치

가정 LAN 의 `192.168.X.X` 에 있어요. S3 API 는 `:9000`, 웹 콘솔은 `:9001` 이에요. 외부 개발자와 공유할 때는 Tailscale 로도 접근할 수 있어요.

### 16.2 Spring 이 읽는 env vars
```
APP_STORAGE_MINIO_ENDPOINT=http://192.168.X.X:9000
APP_STORAGE_MINIO_ACCESS_KEY=<key>
APP_STORAGE_MINIO_SECRET_KEY=<secret>
```

### 16.3 Bucket 정책
템플릿의 `BucketProvisioner` 가 Spring 기동 시 `.env` 의 `APP_STORAGE_MINIO_BUCKETS_<N>=<name>` 항목을 읽어 버킷을 자동 생성해요. `new app` 이 `.env` 에 `APP_STORAGE_MINIO_BUCKETS_<N>=<slug>-uploads` 항목을 추가하고요. 자세한 2-tier 규약은 [`오브젝트 스토리지 규약`](../../api-and-functional/functional/storage.md) 을 보세요.

---

## 17. GitHub Actions 배포 연동

> 무엇이 자동인지 먼저 — Secrets·Variables 등록은 `prod init` 이 `.env.prod` 의 값을 읽어 `gh` 로 자동 push 해요. 아래 §17.1 의 SSH 키 생성과 §17.3 의 OAuth client 발급만 호스트와 Tailscale 콘솔에서 손으로 한 번 해 두면 돼요. 목록은 자동 push 가 무엇을 올리는지 보여주는 참고예요.

### 17.1 Mac mini 쪽 준비 — GHA 전용 SSH 키

GHA runner 가 Mac mini 에 SSH 로 붙을 수 있도록 전용 deploy 키 쌍을 만들어요.
```bash
ssh <your-mac-user>@100.X.X.X
ssh-keygen -t ed25519 -f ~/.ssh/gha_deploy -C "gha-deploy@<파생레포>" -N ""
cat ~/.ssh/gha_deploy.pub >> ~/.ssh/authorized_keys
```
private key 인 `~/.ssh/gha_deploy` 를 파생 레포의 `SSH_PRIVATE_KEY` secret 으로 등록해요.

### 17.2 파생 레포 Secrets 와 Variables

`prod init` 이 `.env.prod` 에서 읽어 push 하는 항목들이에요. 평문이어도 되는 구성값은 Variables 로, 민감값은 Secrets 로 올려요.

**Repository Variables**:

| 이름 | 역할 |
|---|---|
| `DEPLOY_ENABLED` | `true` 일 때만 자동 배포. opt-in gate |
| `KAMAL_SERVICE_NAME` | 파생 레포 slug. settings.gradle 에서 자동 도출 |
| `DEPLOY_HOST` | Mac mini Tailscale IP |
| `DEPLOY_SSH_USER` | Mac mini 의 운영 계정 (보통 root 가 아닌 개인 계정) |
| `PUBLIC_HOSTNAME` | `server.example.com` |

`KAMAL_IMAGE` 와 `GHCR_USERNAME` 은 등록할 필요가 없어요 — `deploy.yml` 이 `github.repository` / `github.actor` 컨텍스트에서 자동 계산합니다 (로컬 수동 배포용 `.env.prod` 값은 `init-prod.sh` 가 git remote 에서 자동 도출).

**Repository Secrets**:

- `GHCR_TOKEN` — GHCR push 와 pull 용 Classic PAT. `write:packages`·`read:packages`·`delete:packages`·`repo` 네 scope 가 필요해요 (`delete:packages` 는 이미지 cleanup step 용). `secrets.GITHUB_TOKEN` 자동 주입만으로는 첫 패키지 push 가 403 이 나서 별도 PAT 가 필요해요. 배경은 [`decisions-infra.md I-10`](../deploy/decisions-infra.md) 을 보세요.
- `TS_OAUTH_CLIENT_ID` 와 `TS_OAUTH_SECRET` — Tailscale OAuth client (§17.3)
- `SSH_PRIVATE_KEY` — Mac mini `gha_deploy` private key 내용
- `DB_URL`·`DB_USER`·`DB_PASSWORD`·`JWT_SECRET`·`APP_DOMAIN`
- `RESEND_API_KEY`·`RESEND_FROM_ADDRESS`·`RESEND_FROM_NAME`
- `APP_STORAGE_MINIO_ENDPOINT`·`APP_STORAGE_MINIO_ACCESS_KEY`·`APP_STORAGE_MINIO_SECRET_KEY`
- `LOKI_URL` (예: `http://loki:3100/loki/api/v1/push`)
- `DISCORD_WEBHOOK_URL`
- `APP_FLYWAY_MODE`

### 17.3 Tailscale OAuth 흐름

Tailscale admin console → Settings → OAuth clients → Generate 에서 CI 전용 OAuth client 를 발급해요. 태그는 `tag:ci` 로 줘요. GHA workflow 의 `tailscale/github-action@v4` 가 이 OAuth 를 받아 tailnet 에 임시 노드로 조인하고, 작업이 끝나면 그 노드를 자동으로 제거해요. 두 scope 가 모두 필요한 이유는 [`decisions-infra.md I-14`](../deploy/decisions-infra.md) 에 있어요.

---

## 18. 주기적 작업 / cron

### 18.1 현재

등록된 cron 은 없어요. Cloudflare Tunnel 로 전환한 뒤로 DuckDNS cron 이 불필요해져서, 도그푸딩 정리 단계에서 제거했어요.

### 18.2 Phase 2 로 유예된 것

두 가지를 미뤄 뒀어요.

- **Supabase keep-alive** — Free tier 는 7일 비활성 시 프로젝트가 자동 pause 돼요. 트래픽이 일정하게 있으면 필요 없지만, 조용한 프로젝트라면 `infra/scripts/keep-alive.sh` 를 cron 으로 등록해요.
  ```cron
  */14 * * * * /Users/<your-mac-user>/workspace/<파생레포>/infra/scripts/keep-alive.sh >> /tmp/keep-alive.log 2>&1
  ```
- **NAS 백업** — `pg_dump` 와 MinIO snapshot 을 시놀로지 RAID 로 보내는 작업이에요. 스크립트 원형은 `infra/scripts/backup-to-nas.sh.example` 에 있고, 등록 시점은 Phase 2 에 결정해요.

---

## 19. 메모리 예산

### 19.1 구성 요소별 예상

실측은 도그푸딩 기간을 기준으로 잡았어요.

| 구성 | 상주 (Idle) | 배포 피크 |
|---|---|---|
| macOS baseline | 2.0 ~ 2.5 GB | 동일 |
| OrbStack VM | 150 ~ 200 MB | 동일 |
| cloudflared | 30 ~ 50 MB | 동일 |
| kamal-proxy | 30 ~ 50 MB | 동일 |
| Spring Blue | 800 MB ~ 1 GB | 동일 |
| Spring Green (배포 중) | 없음 | +800 MB ~ 1 GB (일시적) |
| Prometheus | 200 ~ 400 MB | 동일 |
| Loki | 150 ~ 300 MB | 동일 |
| Grafana | 150 ~ 250 MB | 동일 |
| Alertmanager | 50 ~ 80 MB | 동일 |
| 합계 (상주) | ~4.5 ~ 5 GB | |
| 합계 (배포 피크) | | ~5.3 ~ 6 GB |

8GB 중 2~3GB 여유가 남는 안전 범위예요. 관측성 스택이 1.5GB 선을 넘기 시작하면 분리를 고려하는데, 이게 [`I-06`](../deploy/decisions-infra.md) 트리거예요.

### 19.2 측정 명령
```bash
ssh <your-mac-user>@100.X.X.X 'vm_stat; top -l 1 -n 20 -o mem | head -30'
```

---

## 20. 재해 복구 — 백업해야 할 대상

Mac mini 가 고장나서 새 기기로 교체할 때 복원해야 할 핵심 자산을 세 묶음으로 정리해요.

### 20.1 꼭 백업해야 할 파일

외부 클라우드나 NAS 에 주기적으로 복사해 두기를 권장해요.

| 경로 | 왜 중요한가 |
|---|---|
| `~/.cloudflared/cert.<your-domain>.pem` | Cloudflare 계정 인증서. 잃으면 브라우저 플로우로 재로그인해야 함 |
| `~/.cloudflared/e1aae337-....json` | 터널 credentials. 잃으면 같은 UUID 로 재사용 불가, 새 터널 생성 |
| `~/.cloudflared/<your-tunnel-name>.yml` | 터널 config. 재작성도 가능하나 백업이 빠름 |
| `~/.ssh/authorized_keys` | 관리 접근 키 목록 |
| `~/.docker/helper-creds.json` | GHCR 등 registry auth. 재로그인 가능 |
| `~/Library/LaunchAgents/site.<your-tunnel-name>.cloudflared.plist` | 부팅 자동 기동. 재작성도 가능하나 백업이 빠름 |

### 20.2 Cloudflare 대시보드에서 재설정해야 할 것

백업이 불가능해 손으로 다시 잡아야 해요. 다만 Tunnel·DNS 는 `prod init` 이, 나머지는 대시보드에서 처리해요.

- Tunnel `<your-tunnel-name>` — cert 만 있으면 같은 tunnel 로 재연결 가능
- DNS CNAME records
- Access 정책 (`log.*` 이메일 OTP)
- WAF rate limiting rule
- Custom rule 국가 차단
- Tailscale OAuth clients — 새로 발급

### 20.3 재현 가능한 것 — 백업 불필요

- OrbStack·Homebrew·Tailscale 설치는 재설치하면 끝
- Docker 이미지는 GHCR 에서 pull
- 관측성 data volume 은 새로 시작해도 무방 (과거 데이터는 포기)
- Supabase DB 는 Supabase 쪽 daily backup 으로 관리

### 20.4 복구 순서

1. 새 Mac mini 에 macOS·Homebrew·OrbStack·Tailscale 설치
2. SSH daemon 활성화와 `authorized_keys` 복원
3. `.zshenv` 와 `.zprofile` 복원
4. Docker credential helper 복원 ([§10](#10-docker-credential-helper))
5. `~/.cloudflared/` 디렉토리 복원
6. cloudflared launchd plist 복원 후 `launchctl load`
7. 파생 레포 clone 과 `.env` 재구성 (GitHub Secrets 는 그대로 유지)
8. `kamal setup` 후 `kamal deploy`
9. 관측성 compose 기동

MinIO NAS 와 Cloudflare 클라우드 자산이 남아 있다는 전제에서, 예상 복구 시간은 1~2 시간이에요.

---

## 21. 현재 상태 스냅샷 (2026-04-20)

### 21.1 설치됨 / 활성
- ✅ macOS 15.3, Apple M2, 8GB
- ✅ Tailscale (IP 100.X.X.X)
- ✅ Homebrew `/opt/homebrew`
- ✅ OrbStack (Docker 28.5.2)
- ✅ cloudflared 2025.9.0
- ✅ `~/.zshenv` + `~/.zprofile`
- ✅ Docker credential helper (filefake)
- ✅ `~/.cloudflared/cert.<your-domain>.pem` + tunnel config
- ✅ Cloudflare 터널 `<your-tunnel-name>` 등록됨 (현재 프로세스는 **미기동** — 내일 재기동 필요)
- ✅ DNS records (server, log)
- ✅ Cloudflare Access (`log.*` 이메일 OTP)
- ✅ WAF rate limit + country block 규칙

### 21.2 제거됨 — 도그푸딩 cleanup 2026-04-19
- Spring 컨테이너와 kamal-proxy 컨테이너
- 관측성 4개 컨테이너 (compose down — 이미지와 data volume 은 디스크에 존재)
- 무지개 vite·webhook·nginx·cloudflared 프로세스
- 기존 moojigae 터널 (`409f12bb-...`)
- DuckDNS cron
- Supabase `core` schema 전체를 DROP CASCADE
- 로컬 repo 의 `.env.kamal` 과 `.kamal/secrets` (GHCR 토큰 포함)

> 참고 — 이 cleanup 이후 [`ADR-037`](../../philosophy/adr-037-core-schema-deprecation.md) 로 `core` schema 개념 자체가 폐기됐어요. 그래서 이제는 cleanup 으로 비우는 게 아니라, 처음부터 각 앱 schema 에 기본 25개 마이그레이션 (V001~V026, V007 opt-in) 이 생성돼요 ([§15.3](#153-현재-schema-상태) 참고).

### 21.3 아직 안 된 것 — 파생 레포 첫 배포 전까지
- cloudflared 프로세스 재기동 (nohup 또는 launchd plist 등록)
- kamal-proxy 와 Spring 컨테이너 (파생 레포 `kamal setup` 과 `kamal deploy` 로 생성 예정)
- 관측성 compose 재기동
- GHA 전용 deploy SSH 키 생성 (`~/.ssh/gha_deploy`)
- 파생 레포 GitHub Secrets 와 Variables 등록

---

## 22. 체크리스트 — 파생 레포 첫 배포 전 할 것

대부분은 `prod init` 이 자동으로 처리하고, 손으로 확인해야 하는 항목만 남겨 뒀어요.

- [ ] 파생 레포 생성 — GitHub 의 "Use this template"
- [ ] 로컬 clone 후 운영 환경 셋업 — `cp .env.prod.example .env.prod` 한 뒤 REQUIRED 값 채우기 (BASE_DOMAIN·SUBDOMAIN·CLOUDFLARE_API_TOKEN·DB_URL·DB_USER·GHCR_TOKEN·SSH_PRIVATE_KEY 등). 로컬 dev 를 분리해 쓸 거면 `cp .env.example .env` 도 따로
- [ ] Mac mini SSH 키:
  - [ ] `ssh-keygen -t ed25519 -f ~/.ssh/gha_deploy -C "gha-deploy@<파생레포>" -N ""`
  - [ ] `cat ~/.ssh/gha_deploy.pub >> ~/.ssh/authorized_keys`
  - [ ] `launchctl load ~/Library/LaunchAgents/site.<your-tunnel-name>.cloudflared.plist` (또는 nohup 으로 cloudflared 기동)
- [ ] Tailscale admin console 에서 OAuth client 발급 (태그 `tag:ci`)
- [ ] `prod init` 실행 → Cloudflare DNS·ingress 등록 + GitHub Secrets·Variables push (§17.2 목록)
- [ ] `DEPLOY_ENABLED=true` repo variable 로 opt-in gate 활성화
- [ ] `config/deploy.yml` 의 ERB placeholder 가 repo variables 로 resolve 되는지 로컬 `kamal config` 로 검증
- [ ] 로컬에서 `kamal setup` 첫 실행 → Mac mini 에 kamal-proxy 컨테이너 기동 확인
- [ ] `kamal deploy` → Spring 컨테이너 기동 확인
- [ ] Mac mini 에서 관측성 compose 기동 — `docker compose -f infra/docker-compose.observability.yml up -d`
- [ ] 외부 HTTPS 검증:
  - [ ] `curl -sSfI https://server.<domain>/actuator/health` → 200
  - [ ] `curl -I https://log.<domain>` → 302 (CF Access 로그인 페이지)
- [ ] Blue/Green 스왑 리허설 — 파생 레포 main 에 no-op 커밋 푸시 → GHA 자동 배포 → `kamal app details` 로 버전 변경 확인

---

## 관련 문서

- [`운영 배포 가이드`](../deploy/deployment.md) — 파생 레포 onboarding (최초 1회)
- [`운영 런북`](../deploy/runbook.md) — 평시 운영·롤백·장애 대응
- [`운영 모니터링 셋업 가이드`](./monitoring-setup.md) — 관측성 스택 상세
- [`인프라 (Infrastructure)`](../deploy/infrastructure.md) — 전체 인프라 개요
- [`인프라 결정 기록`](../deploy/decisions-infra.md) — 결정 카드 I-01 ~ I-14
- [`Repository Philosophy — 책 안내`](../../philosophy/README.md) — 39 ADR 인덱스. 특히 [`ADR-007`](../../philosophy/adr-007-solo-friendly-operations.md)
- [`ADR-037 · core schema 폐기`](../../philosophy/adr-037-core-schema-deprecation.md) — per-app schema 마이그레이션 근거
- [`Edge Cases & Risk Analysis`](../../reference/edge-cases.md) — 리스크 시나리오
