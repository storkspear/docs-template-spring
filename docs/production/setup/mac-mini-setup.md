# Mac mini 운영 호스트 설정 — 레퍼런스

> 이 문서는 **template 관리자 본인의 Mac mini** 를 운영 호스트로 쓰는 실제 설정을 기록한 참조 문서다. 파생레포 개발자들이 자기 환경으로 어댑팅할 때 복제 대상이 되는 "worked example" 이기도 하다. 템플릿 원칙에 따라 개별 값(IP, UUID, 도메인 등)은 예시이며, 본인 환경에선 각자 값으로 치환하면 된다.
>
> 관련 문서:
> - 운영 배포 절차: [`운영 배포 가이드 (파생레포 onboarding)`](../deploy/deployment.md)
> - 평시 운영 / 장애 대응: [`운영 런북 (Runbook)`](../deploy/runbook.md)
> - 인프라 결정 카드 (Supabase, MinIO, 맥미니, Tunnel, 관측성, Kamal): [`인프라 결정 기록 (Decisions — Infrastructure)`](../deploy/decisions-infra.md)
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
22. [체크리스트 — 파생레포 첫 배포 전에 할 것](#22-체크리스트)

---

## 1. 개요

**역할**: spring-backend-template 기반 파생레포의 24/7 운영 호스트. 여러 파생레포의 Spring Boot JAR 컨테이너를 blue/green 무중단 배포로 서빙하며, 자체 관측성 스택도 같이 실행한다.

**철학 요약** (자세한 근거는 [`Repository Philosophy — 책 안내`](../../philosophy/README.md) 의 [`ADR-007 (솔로 친화적 운영)`](../../philosophy/adr-007-solo-friendly-operations.md) / [`인프라 결정 기록 (Decisions — Infrastructure)`](../deploy/decisions-infra.md)):
- 솔로 개발자가 여러 앱을 빠르게 출시하는 "앱 공장" 전략 → **저비용 홈서버**
- 클라우드 VM ($20+/월) 대신 집 가정 내 맥미니 (전기세 ~$4/월)
- Public IP 노출 없이 **Cloudflare Tunnel** 로 외부 접근
- 모든 프로덕션 프로세스는 컨테이너 (**Docker + Kamal**)
- 빌드는 GitHub Actions 가 담당 — Mac mini 는 runtime 전용 (8GB 자원 보존)

**서비스되는 도메인** (현재 `example.com`):
- `server.example.com` — Spring Boot API (공개)
- `log.example.com` — Grafana UI (Cloudflare Access 이메일 OTP 게이팅)
- (미래) `admin.example.com` — 관리자 UI

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

메모리 8GB 는 Phase 0 MVP 에 빠듯한 편 — §19 메모리 예산 섹션에서 구체 수치 확인. 12GB 상시 사용 도달하면 관측성 분리 (decisions-infra.md I-06 재검토 트리거).

---

## 3. 기술 스택

### 시스템 레이어
| 구성 | 도구 | 버전 | 목적 |
|---|---|---|---|
| Docker 엔진 | **OrbStack** | 28.5.2 | Docker Desktop 대체. 메모리 오버헤드 ↓ (~150MB vs 500MB~1GB) |
| 네트워크 (관리 접근) | **Tailscale** | 최신 | Mac mini SSH + NAS MinIO 접근용 tailnet |
| 패키지 매니저 | **Homebrew** | 최신 | `/opt/homebrew` prefix (Apple Silicon) |
| 엣지 터널 | **cloudflared** | 2025.9.0 | Cloudflare Tunnel 클라이언트 |

### 배포 / 오케스트레이션
| 구성 | 도구 | 목적 |
|---|---|---|
| 배포 도구 | **Kamal (37signals)** | Docker 컨테이너 기반 blue/green 무중단 배포 오케스트레이션 |
| 리버스 프록시 | **kamal-proxy** | Kamal 내장. Blue/Green 스왑 담당. nginx 대체 |
| 컨테이너 런타임 | Docker (OrbStack 경유) | 모든 런타임 프로세스 |
| 이미지 레지스트리 | **GitHub Container Registry (GHCR)** | `ghcr.io/<owner>/<repo>:<sha>` |
| CI/CD | **GitHub Actions** | main push → build → push → kamal deploy |
| 빌드 환경 | GHA `ubuntu-latest` + buildx arm64 cross-compile | Mac mini 는 빌드 안 함 — 이미지 pull 만 |

### 애플리케이션 레이어
| 구성 | 도구 | 버전 | 목적 |
|---|---|---|---|
| 런타임 | **eclipse-temurin:21-jre-alpine** | JDK 21 | Dockerfile multi-stage 의 runtime 이미지 |
| 프레임워크 | **Spring Boot** | 3.x | 모듈러 모놀리스 아키텍처 |
| DB driver | HikariCP + PostgreSQL JDBC | 표준 | HAKARICP pool + 표준 JDBC Postgres |
| 마이그레이션 | **Flyway** | core → <slug> schema | `@Bean(initMethod="migrate")` + advisory lock |

### 데이터 레이어 (런타임 의존성)
| 자원 | 위치 | 역할 |
|---|---|---|
| **Supabase Postgres** | `aws-1-<region>.pooler.supabase.com` | 운영 DB. 관리형 Postgres (pooler 경유) |
| **NAS MinIO** | `192.168.X.X:9000` (LAN) | 오브젝트 스토리지. S3 호환. Tailscale 없이도 가정 LAN 내 접근 |

### 관측성 (self-host on Mac mini)
| 구성 | 도구 | 포트 | 목적 |
|---|---|---|---|
| 메트릭 수집 | **Prometheus** | 9090 | Spring actuator scrape via docker_sd. Retention 7일 |
| 로그 수집 | **Loki** | 3100 | Spring logback-loki appender 가 push |
| 대시보드 | **Grafana** | 3000 | Loki + Prometheus 동시 조회. `log.*` 공개 (CF Access) |
| 알림 | **Alertmanager** | 127.0.0.1:9093 | Discord webhook (임계치 정의는 Phase 2) |

### 엣지 / 보안
| 구성 | 제공 | 목적 |
|---|---|---|
| TLS 종료 | **Cloudflare Edge** | 자동 인증서 발급/갱신 |
| DDoS 방어 | Cloudflare Free plan | 기본 방어 |
| WAF Rate Limiting | Cloudflare Free | 100 req / 10s per IP |
| 국가 차단 | Cloudflare Custom Rule | CN / KP / RU / BY / SY block |
| 관리자 인증 | **Cloudflare Access** (Zero Trust) | `log.*` 이메일 OTP (Free plan 50 users) |
| Mac mini 공개 IP 노출 | **❌** | cloudflared outbound-only tunnel, 홈 IP 불노출 |

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

**핵심**:
- **공개 트래픽은 전부 Cloudflare 엣지 → Tunnel 경유** (집 ISP 공인 IP 노출 0)
- **관리 접근은 Tailscale** (별도 VPN, 공인 IP 불필요)
- **내부 LAN 자원 (NAS MinIO)** 은 외부 노출 없이 직접 접근

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

**배포 트리거** 세 경로:
1. **자동** — main 에 push → GHA 가 빌드 + 배포 (기본 루트)
2. **수동 GHA** — workflow_dispatch 로 특정 커밋 재배포
3. **수동 로컬** — 개발자 laptop 에서 `kamal deploy` 직접 호출 (예외 상황 / hotfix)

---

## 6. 인프라 리소스 구성도

```
┌─── GitHub ────────────────────────────────────────────────────┐
│  <your-github-account>/spring-backend-template   (template 레포)           │
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
│    ├─ spring-backend-template-web-<sha>  (Blue)                 │
│    ├─ spring-backend-template-web-<sha>  (Green, 배포 중)        │
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
│    ├─ hexator****@gmail.com  (Claude/관리자 접근)                │
│    └─ gha_deploy@<파생레포>  (예정: GHA 배포 전용)                │
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

### 7.1 왜 Mac mini (홈서버)?
클라우드 VM ($20+/월) 대비 전기세 $4/월. M2 8GB 는 AWS t4g.xlarge 급. 1년이면 break-even. 트레이드오프: SPOF (집 ISP 장애 = 서비스 중단). MAU 5K 넘어가면 클라우드 이관 재검토 (decisions-infra.md I-04 재검토 트리거).

### 7.2 왜 Cloudflare Tunnel?
홈 공인 IP 를 공개 인터넷에 노출하지 않고 외부 접근 허용. TLS/WAF/DDoS 방어는 Cloudflare 엣지에 위임 (Mac mini 부담 ↓). Free plan 이라 비용 0. 대안 (DDNS+포트포워딩 / Tailscale Funnel / nginx+LE) 는 [`decisions-infra.md I-05`](../deploy/decisions-infra.md) 참조.

### 7.3 왜 Docker + Kamal?
- **Docker**: 이미지 = 불변 배포 단위. 버전 롤백이 이미지 tag 하나로 해결.
- **Kamal**: 단일 호스트 blue/green 스왑을 검증된 툴로 운영. 커스텀 bash 재구현보다 신뢰.
- 대안 검토 기록: [`decisions-infra.md I-09`](../deploy/decisions-infra.md).

### 7.4 왜 OrbStack (Docker Desktop 아님)?
Docker Desktop 의 Linux VM 은 메모리 2GB 기본 예약 + 반환 안 됨. OrbStack 은 네이티브 Linux VM 으로 ~150MB 오버헤드. 8GB 기기엔 체감 큰 차이. OrbStack 의 `docker` / `docker compose` CLI 는 완전 호환.

### 7.5 왜 Tailscale (관리 접근)?
- 집 공유기 포트포워딩 없이 어디서든 Mac mini SSH 접근
- NAS MinIO 를 외부 개발자(파생레포)가 공유해야 할 때 Tailscale tailnet 으로 간단히 확장
- Free plan 노드 100개까지 충분

### 7.6 왜 blue/green from day 1?
파생레포 하나 안에 modular monolith 로 N개 앱 모듈. "앱 1개만 고쳐도 전체 재배포 필요" 구조라 재시작 downtime 이 N 배로 증폭됨. 1개 앱 시점에서 B/G 를 셋업해놓으면 N 증가 시 복잡도 0.

### 7.7 왜 관측성을 운영(Mac mini) 전용?
로컬 dev 에서 Loki/Grafana/Prom 활용 빈도 낮음. 맥북 메모리·docker 자원만 소비. 운영에서 실제 트래픽 분석·장애 대응에 필요한 도구라 운영 전용으로 범위 조정 (2026-04-19).

### 7.8 왜 docker credential helper 를 커스텀으로 짰나?
Kamal 이 `docker login` 을 비대화형 SSH 로 Mac mini 에 호출. macOS 기본 credsStore (`osxkeychain`) 는 Keychain 을 열어야 하는데, 비대화형 SSH 세션은 Keychain 을 unlock 못 함 (error `-25308`). Python 으로 구현한 file-based fake helper 로 회피. 보안 측면: credential 이 평문 base64 로 `~/.docker/helper-creds.json` 에 저장되지만 Mac mini 는 단일 사용자 + Tailscale-only 접근이라 수용. 자세한 설치: §10.

### 7.9 왜 DB provider 를 자유 선택?
Template 성격 유지. 코드는 HikariCP + 표준 JDBC 만 사용 — Supabase Realtime/RLS/auth 같은 API 미의존. 파생레포 소유자가 자기 인프라 (AWS RDS 재사용 등) 가 있다면 DB_URL 만 바꾸면 된다. Template 관리자 default 는 Supabase (Seoul region, Free tier, Supavisor pooler).

### 7.10 왜 actuator 를 app port 와 공유 (별도 management port 아님)?
원래 `management.server.port: 8090` 으로 분리했으나 Kamal 2.11 의 `proxy.healthcheck` 스키마가 `port:` 키를 받지 않음. kamal-proxy healthcheck 가 `/actuator/health/liveness` 를 app port 에서 hit 하도록 단일 포트로 통합. Exposure 는 `health / info / prometheus` 만 허용해 민감 엔드포인트 차단. 더 엄격한 격리가 필요해지면 별도 port + kamal-proxy healthcheck 를 main-port 가벼운 엔드포인트로 교체.

---

## 8. 시스템 기본 셋업

### 8.1 macOS
- 버전: 15.3 (24D60)
- 업데이트 정책: 주요 업데이트는 수동 (시스템 설정 → 소프트웨어 업데이트). 자동 보안 업데이트는 기본값 허용.
- 잠자기 방지: System Settings → Lock Screen → "Start Screen Saver when inactive" = Never (Mac mini 용) / "Prevent automatic sleeping on power adapter when the display is off" = ON (Power Adapter 설정).
- 재부팅 후 자동 로그인: System Settings → Users & Groups → Auto-login 활성화 (권장). 그래야 재부팅 후 launchd 에이전트와 cloudflared 가 즉시 기동.

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

### 9.2 `~/.zshenv` — 비대화형 SSH shells (**Kamal 필수 의존**)
비대화형 `ssh host 'command'` 실행 시 macOS 는 `.zprofile` 을 로드하지 않음 → Kamal 의 원격 명령이 `docker` / `cloudflared` PATH 를 못 찾음. 대응:
```zsh
# ~/.zshenv
eval "$(/opt/homebrew/bin/brew shellenv)"
source ~/.orbstack/shell/init.zsh 2>/dev/null || :
export PATH="$HOME/.docker/bin:$PATH"   # docker-credential-filefake 용
```
이 파일은 **무조건 필요** — Kamal 이 동작 안 하는 원인의 #1 이 이 설정 누락.

### 9.3 PATH 우선순위 (검증 명령)
```bash
ssh <your-mac-user>@100.X.X.X 'echo $PATH'
# 기대값:
# /Users/<your-mac-user>/.docker/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin:/Users/<your-mac-user>/.orbstack/bin
```

---

## 10. Docker credential helper

### 10.1 문제
Kamal 은 원격 `docker login ghcr.io -u X -p Y` 를 비대화형 SSH 로 호출. macOS 기본 `credsStore=osxkeychain` 이 실행되는데, Keychain 은 GUI 세션에서만 unlock 상태 → 비대화형 SSH 에서 에러:
```
Error saving credentials: error storing credentials - err: exit status 1
out: `User interaction is not allowed. (-25308)`
```

### 10.2 해결 — file-based fake helper
`~/.docker/bin/docker-credential-filefake` 스크립트 작성 (Python 3 필요 — macOS 기본):
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

검증:
```bash
# Mac mini 에서 (비대화형 SSH 시뮬레이션)
ssh <your-mac-user>@100.X.X.X 'docker login ghcr.io -u <user> -p <token> 2>&1 | tail -3'
# 기대: "Login Succeeded"
```

### 10.3 보안 주의
- `~/.docker/helper-creds.json` 에 token 이 base64 가 아닌 **평문 JSON** 저장됨
- Mac mini 는 **단일 사용자 + Tailscale-only 접근** 전제라 수용 가능
- 파일 권한: `chmod 600 ~/.docker/helper-creds.json` 로 최소화
- Phase 2 에서 **1Password CLI / sops / Vault** 같은 정식 시크릿 관리 체계로 대체 예정

---

## 11. Cloudflare Tunnel 구성

### 11.1 tunnel 생성 (이미 완료)
```bash
cloudflared tunnel login
# 브라우저로 example.com zone 선택 → Authorize
# → ~/.cloudflared/cert.pem 생성 (account cert)

cloudflared tunnel create <your-tunnel-name>
# → ~/.cloudflared/<uuid>.json 생성 (tunnel credentials)
```

현재 터널 UUID: **`e1aae337-90b1-4661-a030-dfa498a91648`**
(템플릿 관리자 개인 UUID. 본인 환경에선 새로 발급되는 UUID 로 대체)

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

### 11.3 DNS 라우팅
```bash
cloudflared tunnel route dns <your-tunnel-name> server.example.com
cloudflared tunnel route dns <your-tunnel-name> log.example.com
```
→ Cloudflare Zone 의 DNS 레코드 자동 생성 (CNAME → `<uuid>.cfargotunnel.com`).

### 11.4 실행 / 영속화
**방법 A** — nohup (임시, 세션 종료 시 유지 안됨):
```bash
nohup cloudflared tunnel --config ~/.cloudflared/<your-tunnel-name>.yml run > /tmp/<your-tunnel-name>-tunnel.log 2>&1 &
```

**방법 B** — launchd plist (권장, 부팅 시 자동 기동):
```bash
cat > ~/Library/LaunchAgents/site.example.comflared.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>site.example.comflared</string>
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
launchctl load ~/Library/LaunchAgents/site.example.comflared.plist
```
(현재 상태: **plist 없음, 방법 A nohup 으로도 안 떠있음.** 파생레포 배포 시 기동 필요)

### 11.5 운영 검증
```bash
# tunnel 활성 connection 확인
cloudflared tunnel info <your-tunnel-name>
# 기대: 4 connections (icn05, icn06, icn01 중 일부)

# 외부 HTTP 접근
curl -sSfI https://server.example.com/actuator/health
# 기대: HTTP/2 200 (Spring 기동 시)
```

---

## 12. Cloudflare Zone 설정

### 12.1 DNS records (zone `example.com`)
Tunnel 경유:
```
server  CNAME  e1aae337-90b1-4661-a030-dfa498a91648.cfargotunnel.com  (proxied)
log     CNAME  e1aae337-90b1-4661-a030-dfa498a91648.cfargotunnel.com  (proxied)
```
`cloudflared tunnel route dns` 명령이 자동 생성. TTL 300 권장 (안정 후 3600).

### 12.2 Cloudflare Access (Zero Trust)
Dashboard → Zero Trust → Access → Applications → Add application:
- **Type**: Self-hosted
- **Application name**: `Grafana - log.example.com`
- **Application domain**: `log.example.com`
- **Session duration**: `24 hours`
- **Policy**:
  - Name: `Admin only`
  - Action: `Allow`
  - Include → Emails → `dev**rhexa***@gmail.com`
- **Identity provider**: One-time PIN (기본)

Free plan 50 users 까지. 현재 1명 (개인 이메일 1개) 등록.

### 12.3 WAF Rate Limiting
Dashboard → Security → WAF → Rate limiting rules:
- **Name**: `rate-limit-100-per-10s`
- **Match**: URI 경로 wildcard `/` (모든 요청)
- **Characteristics**: IP Source Address
- **Requests / Period**: 100 / 10초
- **Action**: Block
- **Duration**: 10초 (Free plan 최대값)

공격자 입장에선 10초 block 이 해제되자마자 다시 threshold 초과 → 재차단 반복 → 실질적 연속 차단. Free plan 에 rule 1개 슬롯 소비.

### 12.4 Custom Rule — 국가 차단
Dashboard → Security → WAF → Custom rules:
- **Name**: `block-high-risk-countries`
- **Match**: Country in `{CN, KP, RU, BY, SY}` (OR 연결)
- **Action**: Block

Free plan 에 5개 슬롯 중 1개 소비.

### 12.5 평가 순서 (요약)
```
1. IP Access Rules (Allow)  — 본인 IP 화이트리스트는 여기서 우선 처리
2. Custom Rules             — 국가 차단
3. Rate Limiting Rules      — 100 req/10s
4. Managed Rules            — Pro+ 만
5. Origin (Mac mini cloudflared)
```

---

## 13. Kamal + kamal-proxy + Spring 컨테이너

### 13.1 Kamal (GHA runner / 개발자 laptop 에서 실행)
```bash
gem install kamal
# 버전 2.11+
```
Kamal 은 host (Mac mini) 에는 설치 안됨 — SSH 로 원격 제어.

### 13.2 `kamal setup` 이 Mac mini 에 생성하는 것
- `kamal-proxy` 컨테이너 (`:80` 호스트 바인드)
- 필요한 Docker 볼륨·네트워크 (`kamal`)
- `.kamal/` 내부 관리 파일

### 13.3 Spring 컨테이너 사양
- 이미지: `ghcr.io/<owner>/<repo>:<commit-sha>`
- 내부 포트: **8080** (Dockerfile EXPOSE 와 일치)
- 호스트 포트: **Kamal 이 동적 할당** (Blue/Green 번갈아 :8081 / :8082)
- 네트워크: `kamal`
- 라벨: `service=<name>`, `role=web`, `destination=<image>` (Prometheus docker_sd 가 이 라벨로 발견)
- 환경변수: `config/deploy.yml` 의 `env.clear` + `env.secret` 주입

### 13.4 Blue/Green 동작 흐름
자세한 동작은 [`운영 배포 가이드 (파생레포 onboarding)`](../deploy/deployment.md) + [`운영 런북 (Runbook)`](../deploy/runbook.md) 참조.

---

## 14. 관측성 Stack

### 14.1 파일 위치
Mac mini 에 파생레포 clone 후 `infra/docker-compose.observability.yml` 사용. 또는 도그푸딩 때 `/tmp/infra/` 로 scp.

### 14.2 기동
```bash
cd <파생레포>
docker compose -f infra/docker-compose.observability.yml up -d
```
**주의 순서**: `kamal setup` 이 `kamal` 네트워크를 먼저 만들어야 관측성 compose 의 `external: true` 조인이 성공.

### 14.3 컨테이너 + 포트 표
| 컨테이너 | 호스트 포트 | 외부 접근 | mem_limit | 용도 |
|---|---|---|---|---|
| observability-prometheus | :9090 | 내부 | 512m | 메트릭 저장 (retention 7일) |
| observability-loki | :3100 | 내부 | 256m | 로그 저장 |
| observability-grafana | :3000 | `log.<domain>` (CF Access) | 256m | 대시보드 |
| observability-alertmanager | 127.0.0.1:9093 | 내부 전용 | 64m | 알림 분기 (현재 restart loop, Phase 2 수정 예정) |

### 14.4 Prometheus docker_sd 설정
`infra/prometheus/prometheus.yml` 에서 `docker_sd_configs` 로 `kamal` 네트워크 내 `role=web` 라벨 컨테이너 자동 발견. Spring 컨테이너 이름이 배포마다 변해도 라벨 기반이라 안정.

Docker socket mount: Prometheus 컨테이너가 `/var/run/docker.sock:ro` 로 호스트 소켓을 읽음. 권한 때문에 `user: root` 로 실행. Phase 2 에 `docker-socket-proxy` 로 분리 예정.

---

## 15. Supabase 연결

### 15.1 Template 관리자 현재 프로젝트
- **Project reference**: `***SUPABASE_PROJECT_REF***`
- **Region**: `aws-1-ap-northeast-2` (Seoul)
- **Connection**:
  - Direct: `postgresql://postgres.***SUPABASE_PROJECT_REF***:<pw>@aws-1-<region>.pooler.supabase.com:5432/postgres`
  - Supavisor pooler: 위 URL 의 port 를 `6543` 으로 + `?pgbouncer=true` 쿼리스트링
- **Password**: 가끔 rotate 권장. 현재 값은 본인 관리.

### 15.2 Template 요구사항 (provider 무관)
- `DB_URL` — Spring 기동 시 `spring.datasource.url` 로 바인딩
- `DB_USER`, `DB_PASSWORD`
- `DATABASE_URL` (admin) — `new-app.sh --provision-db` 가 사용. **운영 DB admin credential 은 `.env` 에 저장 금지** — 실행 직전 shell export 로만 주입. (로컬 docker URL 만 `.env.example` 기본값으로 포함됨)

### 15.3 현재 schema 상태 (2026-04-20)
- `core` schema: **존재하지 않음** (도그푸딩 cleanup 에서 DROP CASCADE)
- 파생레포 첫 기동 시 Flyway 가 V001~V009 자동 적용해 core schema 재생성

---

## 16. NAS MinIO 연결

### 16.1 위치
- IP: `192.168.X.X` (가정 LAN)
- Port: `:9000` (S3 API), `:9001` (웹 콘솔)
- Tailscale 로도 접근 가능 (외부 개발자 공유 시)

### 16.2 Spring 이 읽는 env vars
```
APP_STORAGE_MINIO_ENDPOINT=http://192.168.X.X:9000
APP_STORAGE_MINIO_ACCESS_KEY=<key>
APP_STORAGE_MINIO_SECRET_KEY=<secret>
```

### 16.3 Bucket 정책
템플릿의 `BucketProvisioner` 가 Spring 기동 시 `.env` 의 `APP_STORAGE_MINIO_BUCKETS_<N>=<name>` 항목을 읽어 자동 생성. `new-app.sh` 가 `.env` 에 `APP_STORAGE_MINIO_BUCKETS_<N>=<slug>-uploads` 항목을 append.

자세한 2-tier bucket 규약: [`오브젝트 스토리지 규약`](../../api-and-functional/functional/storage.md).

---

## 17. GitHub Actions 배포 연동

### 17.1 Mac mini 쪽 준비 (**아직 미완료 — 내일 할 작업**)
GHA 전용 deploy SSH 키 쌍 생성:
```bash
ssh <your-mac-user>@100.X.X.X
ssh-keygen -t ed25519 -f ~/.ssh/gha_deploy -C "gha-deploy@<파생레포>" -N ""
cat ~/.ssh/gha_deploy.pub >> ~/.ssh/authorized_keys
```
`~/.ssh/gha_deploy` (private) 를 파생레포 `SSH_PRIVATE_KEY` secret 으로 등록.

### 17.2 파생레포 Secrets / Variables 목록
**Repository Variables** (평문, 역할):
- `DEPLOY_ENABLED=true` (opt-in gate)
- `KAMAL_SERVICE_NAME=<파생레포-slug>`
- `DEPLOY_HOST=100.X.X.X`
- `PUBLIC_HOSTNAME=server.example.com`

**Repository Secrets**:
- `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET` — Tailscale admin console → OAuth clients (scope `devices:ci`, tag `tag:ci`)
- `SSH_PRIVATE_KEY` — Mac mini `gha_deploy` private key 내용
- `DB_URL`, `DB_USER`, `DB_PASSWORD`, `JWT_SECRET`, `APP_DOMAIN`
- `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, `RESEND_FROM_NAME`
- `APP_STORAGE_MINIO_ENDPOINT`, `APP_STORAGE_MINIO_ACCESS_KEY`, `APP_STORAGE_MINIO_SECRET_KEY`
- `LOKI_URL=http://loki:3100/loki/api/v1/push`
- `DISCORD_WEBHOOK_URL`

GHCR_TOKEN 은 `secrets.GITHUB_TOKEN` 자동 주입으로 대체 (workflow `permissions: packages: write`).

### 17.3 Tailscale OAuth 흐름 (새 개념)
Tailscale admin console → Settings → OAuth clients → Generate:
- Scope: `devices:ci` (CI 전용 device 등록 권한)
- Tags: `tag:ci`

GHA workflow 의 `tailscale/github-action@v2` 가 이 OAuth 를 받아 tailnet 에 임시 노드로 조인 → 작업 끝나면 자동 제거.

---

## 18. 주기적 작업 / cron

### 18.1 현재 (2026-04-20)
- **없음.** 도그푸딩 정리 단계에서 DuckDNS cron 제거됨 (Cloudflare Tunnel 로 전환 이후 불필요).

### 18.2 Phase 2 로 유예된 것
- **Supabase keep-alive** — Free tier 는 7일 비활성 시 프로젝트 자동 pause. 실제 트래픽이 일정하게 있으면 불필요, 조용한 프로젝트면 `infra/scripts/keep-alive.sh` 를 cron 으로 등록.
  ```cron
  */14 * * * * /Users/<your-mac-user>/workspace/<파생레포>/infra/scripts/keep-alive.sh >> /tmp/keep-alive.log 2>&1
  ```
- **NAS 백업** — `pg_dump` + MinIO snapshot → 시놀로지 RAID. Phase 2 결정.

---

## 19. 메모리 예산

### 19.1 구성 요소별 예상 (실측은 도그푸딩 기간 기준)
| 구성 | 상주 (Idle) | 배포 피크 |
|---|---|---|
| macOS baseline | 2.0 ~ 2.5 GB | 동일 |
| OrbStack VM | 150 ~ 200 MB | 동일 |
| cloudflared | 30 ~ 50 MB | 동일 |
| kamal-proxy | 30 ~ 50 MB | 동일 |
| Spring Blue | 800 MB ~ 1 GB | 동일 |
| Spring Green (배포 중) | **신규** | +800 MB ~ 1 GB (일시적) |
| Prometheus | 200 ~ 400 MB | 동일 |
| Loki | 150 ~ 300 MB | 동일 |
| Grafana | 150 ~ 250 MB | 동일 |
| Alertmanager | 50 ~ 80 MB | 동일 |
| **합계 (상주)** | **~4.5 ~ 5 GB** | |
| **합계 (배포 피크)** | | **~5.3 ~ 6 GB** |

8GB 중 2~3GB 여유. 안전 범위. 관측성이 1.5GB 선 넘기 시작하면 분리 고려 (I-06 트리거).

### 19.2 측정 명령
```bash
ssh <your-mac-user>@100.X.X.X 'vm_stat; top -l 1 -n 20 -o mem | head -30'
```

---

## 20. 재해 복구 — 백업해야 할 대상

Mac mini 가 고장나서 새 기기로 교체 시 복원해야 할 핵심 자산:

### 20.1 꼭 백업해야 할 파일 (외부 클라우드·NAS 에 주기 복사 권장)
| 경로 | 왜 중요 |
|---|---|
| `~/.cloudflared/cert.<your-domain>.pem` | Cloudflare 계정 인증서 — 잃으면 재로그인 필요 (브라우저 플로우) |
| `~/.cloudflared/e1aae337-....json` | 터널 credentials — 잃으면 같은 UUID 로 재사용 불가, 새 터널 생성 |
| `~/.cloudflared/<your-tunnel-name>.yml` | 터널 config (재작성 가능하나 백업이 빠름) |
| `~/.ssh/authorized_keys` | 관리 접근 키 목록 |
| `~/.docker/helper-creds.json` | GHCR 등 registry auth (재로그인 가능) |
| `~/Library/LaunchAgents/site.example.comflared.plist` | 부팅 자동 기동 (재작성 가능하나 백업이 빠름) |

### 20.2 Cloudflare 대시보드에서 재설정 해야 할 것 (백업 불가)
- Tunnel `<your-tunnel-name>` — 기기 복구 시 cert 만 있으면 같은 tunnel 재연결 가능
- DNS CNAME records
- Access 정책 (`log.*` 이메일 OTP)
- WAF rate limiting rule
- Custom rule 국가 차단
- (Tailscale) OAuth clients — 새로 발급

### 20.3 재현 가능한 것 (백업 불필요)
- OrbStack / Homebrew / Tailscale 설치 (재설치)
- Docker 이미지 (GHCR 에서 pull)
- 관측성 data volume (새로 시작해도 문제 없음, 과거 데이터 포기)
- Supabase DB (Supabase 쪽에서 daily backup 관리)

### 20.4 복구 순서 (기기 고장 시)
1. 새 Mac mini 에 macOS + Homebrew + OrbStack + Tailscale 설치
2. SSH daemon 활성화 + `authorized_keys` 복원
3. `.zshenv`, `.zprofile` 복원
4. Docker credential helper (§10) 복원
5. `~/.cloudflared/` 디렉토리 복원
6. cloudflared launchd plist 복원 + `launchctl load`
7. 파생레포 clone + `.env` 재구성 (GitHub Secrets 는 그대로 유지)
8. `kamal setup` → `kamal deploy`
9. 관측성 compose 기동

예상 복구 시간: **1~2 시간** (MinIO NAS 와 Cloudflare 클라우드 자산은 남아있다는 전제).

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

### 21.2 제거됨 (도그푸딩 cleanup 2026-04-19)
- Spring 컨테이너 + kamal-proxy 컨테이너
- 관측성 4개 컨테이너 (compose down — 이미지·data volume 은 디스크에 존재)
- 무지개 vite / webhook / nginx / cloudflared 프로세스
- 기존 moojigae 터널 (`409f12bb-...`)
- DuckDNS cron
- Supabase `core` schema (DROP CASCADE — V001~V009 테이블 전부)
- 로컬 repo 의 `.env.kamal`, `.kamal/secrets` (GHCR 토큰 포함)

### 21.3 아직 안 된 것 (파생레포 첫 배포 전까지)
- cloudflared 프로세스 재기동 (nohup 또는 launchd plist 등록)
- kamal-proxy + Spring 컨테이너 (파생레포 `kamal setup` + `kamal deploy` 로 생성 예정)
- 관측성 compose 재기동
- GHA 전용 deploy SSH 키 생성 (`~/.ssh/gha_deploy`)
- 파생레포 GitHub Secrets / Variables 등록

---

## 22. 체크리스트 — 파생레포 첫 배포 전 할 것

- [ ] **파생레포 생성** (GitHub "Use this template")
- [ ] 로컬 clone + `cp .env.example .env` → 값 채움 (Supabase DB_URL 등)
- [ ] Mac mini SSH:
  - [ ] `ssh-keygen -t ed25519 -f ~/.ssh/gha_deploy -C "gha-deploy@<파생레포>" -N ""`
  - [ ] `cat ~/.ssh/gha_deploy.pub >> ~/.ssh/authorized_keys`
  - [ ] `launchctl load ~/Library/LaunchAgents/site.example.comflared.plist` (또는 nohup 으로 cloudflared 기동)
- [ ] Tailscale admin console → OAuth client 발급 (scope `devices:ci`)
- [ ] 파생레포 GitHub Secrets / Variables 등록 (§17.2 목록)
- [ ] `DEPLOY_ENABLED=true` repo variable 설정 (opt-in gate 활성화)
- [ ] `config/deploy.yml` ERB placeholder 값이 repo variables 로 resolve 되는지 로컬 `kamal config` 검증
- [ ] 로컬에서 `kamal setup` 첫 실행 → Mac mini 에 kamal-proxy 컨테이너 기동 확인
- [ ] `kamal deploy` → Spring 컨테이너 기동 확인
- [ ] Mac mini 에서 관측성 compose 기동: `docker compose -f infra/docker-compose.observability.yml up -d`
- [ ] 외부 HTTPS 검증:
  - [ ] `curl -sSfI https://server.<domain>/actuator/health` → 200
  - [ ] `curl -I https://log.<domain>` → 302 (CF Access 로그인 페이지)
- [ ] Blue/Green 스왑 리허설: 파생레포 main 에 no-op 커밋 푸시 → GHA 가 자동 배포 → `kamal app details` 로 버전 변경 확인

---

## 관련 문서

- [`운영 배포 가이드 (파생레포 onboarding)`](../deploy/deployment.md) — 파생레포 onboarding (최초 1회)
- [`운영 런북 (Runbook)`](../deploy/runbook.md) — 평시 운영 / 롤백 / 장애 대응
- [`운영 모니터링 셋업 가이드`](./monitoring-setup.md) — 관측성 스택 상세
- [`인프라 (Infrastructure)`](../deploy/infrastructure.md) — 전체 인프라 개요
- [`인프라 결정 기록 (Decisions — Infrastructure)`](../deploy/decisions-infra.md) — 결정 카드 I-01 ~ I-09
- [`Repository Philosophy — 책 안내`](../../philosophy/README.md) — 16 ADR 인덱스 (특히 [`ADR-007`](../../philosophy/adr-007-solo-friendly-operations.md))
- [`Edge Cases & Risk Analysis`](../../reference/edge-cases.md) — 리스크 시나리오
