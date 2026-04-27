# 5 분 투어

[`이게 뭐야?`](./what-is-this.md) 를 읽고 "조금 더 봐볼까" 싶을 때 읽는 문서예요. 코드를 돌려보지 않고도 **"이 레포의 정체를 대충 알겠다"** 는 상태에 도달하는 게 목적. 5 분 안에 다음 4 가지 그림이 머릿속에 잡힙니다.

1. **모듈 4 종류** 가 어떻게 생겼나
2. **앱 하나를 추가** 한다는 게 무슨 뜻인가
3. **DB 가 분리** 되어 있다는 건 어떤 모양인가
4. **배포되면 무엇이 1 개 · 무엇이 N 개** 인가

## 1. 모듈 4 종류

이 레포는 Gradle 멀티모듈이에요. 모듈의 종류는 네 가지:

```
┌──────────────────────────────────────────────────────────────┐
│  bootstrap/                                                  │
│   └─ 모든 것을 조립해 단일 JAR 만드는 곳                    │
│     (한 JVM = 한 bootstrap = 한 프로세스)                   │
└──────┬───────────────────────────────────────────────────────┘
       │
       ├── common/              ← 상태 없는 유틸리티
       │   ├── common-logging        → 로깅 포맷
       │   ├── common-web            → 응답 포맷, 예외 처리
       │   ├── common-security       → JWT, 인증 필터
       │   ├── common-persistence    → DB 연결 도구
       │   └── common-testing        → 테스트 기반
       │
       ├── core/               ← 상태 있는 공통 기능 (라이브러리 역할)
       │   ├── core-user-{api,impl}      → 유저 관리
       │   ├── core-auth-{api,impl}      → 인증 (signup/signin/refresh)
       │   ├── core-device-{api,impl}    → 디바이스 등록 (푸시)
       │   ├── core-push-{api,impl}      → FCM 푸시 전송
       │   ├── core-storage-{api,impl}   → 파일 업로드/다운로드
       │   └── core-billing-{api,impl}   → 결제 (Phase 0 스텁)
       │
       └── apps/               ← 앱별 도메인 (템플릿에는 비어있음)
           ├── app-sumtally       → 가계부 앱 (예시)
           ├── app-rny            → 자산 트래커 앱 (예시)
           └── app-<slug>         → 새 앱은 여기에 자동 생성
```

**핵심**: `common/` 은 "재료", `core/` 는 "조립된 부품", `apps/` 는 "각 앱의 실제 제품", `bootstrap/` 은 "이것들을 다 담아 배송하는 상자".

각 `core-*` 가 왜 **`-api` 와 `-impl` 두 개** 로 쪼개져 있는지는 [`ADR-003`](../philosophy/adr-003-api-impl-split.md) 이 답해요 — 한 줄로 말하면 **"나중에 뽑을 수 있게 하기 위한 경계"**.

## 2. 앱 하나를 추가한다는 것

"새 앱 시작합시다" 가 뭘 의미하는가:

```bash
./tools/new-app/new-app.sh gymlog --provision-db
```

이 한 줄이 **자동으로** 만드는 것:

```
apps/app-gymlog/                             ← 새 앱 모듈 디렉토리
├── build.gradle                             ← Gradle 설정
├── src/main/java/.../app/gymlog/
│   ├── GymlogAppAutoConfiguration.java      ← Spring Boot 자동 설정
│   ├── config/GymlogDataSourceConfig.java   ← DB 연결 (gymlog schema 전용)
│   └── auth/GymlogAuthController.java       ← /api/apps/gymlog/auth/* 경로 11 개
└── src/main/resources/db/migration/gymlog/
    ├── V001__init_users.sql                 ← gymlog 유저 테이블
    ├── V002__init_social_identities.sql
    ├── V003__init_refresh_tokens.sql
    ├── V004__init_email_verification_tokens.sql
    ├── V005__init_password_reset_tokens.sql
    └── V006__init_devices.sql               ← 푸시 디바이스
```

**그리고 PostgreSQL 에**:
- `gymlog` schema 자동 생성
- `gymlog_app` DB role 자동 생성 (다른 앱 schema 접근 불가)

**당신이 이제 할 일**:
- `apps/app-gymlog/` 안에 가계부 앱처럼 **도메인 코드만** 추가 (set, reps, workout 등)
- 인증은 안 건드려도 됨 (`core-auth-impl` 가 이미 해줌)

이 "복사-자동화" 덕분에 앱 추가 시간이 **분 단위로 떨어집니다**.

## 3. DB 가 분리되어 있다는 것

한 Postgres 인스턴스 안에 **schema 라는 논리 경계** 가 앱마다 하나씩:

```
postgres (database)
│
├── core schema                     ← 템플릿 기준선
│   └── users, refresh_tokens, ...
│
├── sumtally schema                 ← 가계부 앱 전용
│   ├── users                       ← sumtally 유저 (독립)
│   ├── refresh_tokens
│   ├── budget_groups               ← 가계부 도메인
│   └── expenses
│
├── rny schema                      ← 자산 앱 전용
│   ├── users                       ← rny 유저 (sumtally 와 완전 별개)
│   ├── refresh_tokens
│   └── asset_groups                ← 자산 도메인
│
└── gymlog schema                   ← 방금 만든 앱 전용
    ├── users
    └── (아직 비어있음)
```

**중요한 규칙 3 개**:

1. **같은 이메일** 이 sumtally 와 rny 에 있어도 **서로 다른 유저** ([`ADR-012`](../philosophy/adr-012-per-app-user-model.md))
2. **DB role** 이 분리되어 있어서 sumtally 코드가 rny schema 에 접근하려 하면 **PostgreSQL 이 거절**
3. **HikariCP 커넥션 풀** 도 앱별로 따로 — 한 앱이 DB 를 과부하시켜도 다른 앱은 무사

이것이 [`ADR-005`](../philosophy/adr-005-db-schema-isolation.md) 의 **5중 방어선** 중 핵심 내용.

## 4. 배포되면 1 개 vs N 개

| 배포 후 뭐가 존재하나 | 개수 |
|---|---|
| 서버 (JVM 프로세스) | **1 개** ← 모든 앱이 한 프로세스 안 |
| JAR 파일 | **1 개** |
| Docker 이미지 | **1 개** |
| PostgreSQL 인스턴스 | **1 개** |
| GitHub Actions workflow | 몇 개 (빌드 · 배포 · 릴리스) |
|  |  |
| HTTP 엔드포인트 prefix | **N 개** ← `/api/apps/sumtally/*`, `/api/apps/rny/*`, ... |
| PostgreSQL schema | **N 개** ← 앱마다 하나 |
| DataSource bean | **N 개** ← 앱마다 하나 |
| Flyway 마이그레이션 히스토리 | **N 개** ← schema 마다 독립 |

**한 줄**: **"외부에는 앱이 N 개처럼 보이고, 내부 운영은 1 개처럼 운영됩니다."**

## 5 분이 지나서

여기까지 읽으면:
- 이 레포의 **큰 그림** 이 머릿속에 있음
- "아, 이게 'modular monolith' 구나" 라는 납득이 생김
- 개별 ADR 들 (예: "왜 HS256 JWT?") 에 들어갈 준비 완료

## 다음

| 다음 행동 | 문서 |
|---|---|
| **설계 결정의 이유를 읽고 싶다** | [`Repository Philosophy — 책 안내`](../philosophy/README.md) — 프롤로그 + 테마 1 (ADR-001~004) |
| **직접 돌려보고 싶다** | [`Onboarding — 템플릿 첫 사용 가이드`](../start/onboarding.md) — 로컬 환경 셋업 |
| **구조의 전체 레퍼런스** | [`Architecture Reference`](../structure/architecture.md) — 파일 트리 + 의존 그래프 |
| **Developer Journey 전체 순서** | [`📚 template-spring — 책 목차 (Developer Journey)`](./README.md) |

"관심은 있는데 지금은 시간 없음" → 이 2 개 Level 0 문서로 충분. 필요할 때 돌아오세요.
