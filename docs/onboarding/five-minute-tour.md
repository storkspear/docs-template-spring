# 5 분 투어

> **유형**: How-to · **독자**: Level 0 · **읽는 시간**: ~5분

[`이게 뭐야?`](./what-is-this.md) 를 읽고 "조금 더 봐볼까" 싶어졌다면 잘 오셨어요. 이 문서는 코드를 직접 돌려보지 않고도 "이 레포의 정체를 대충 알겠다" 는 상태에 닿는 게 목적이에요. 빠르게 한 바퀴 둘러보는 투어라, 5 분이면 다음 네 가지 그림이 머릿속에 잡혀요.

1. 모듈이 어떻게 생겼나
2. 앱 하나를 추가한다는 게 무슨 뜻인가
3. 앱마다 데이터가 분리된다는 건 어떤 모양인가
4. 배포하면 무엇이 하나로, 무엇이 여러 개로 존재하나

본격적으로 손을 움직이는 건 [`Onboarding`](../start/onboarding.md) 에서 다뤄요. 여기서는 눈으로만 따라오면 돼요.

## 1. 모듈은 어떻게 생겼나

이 레포는 [Gradle](../reference/glossary.md#프레임워크--빌드) [멀티모듈](../reference/glossary.md#프레임워크--빌드) 이에요. 안쪽이 여러 모듈로 나뉘어 있고, 종류는 크게 네 가지예요.

```
┌──────────────────────────────────────────────────────────────┐
│  bootstrap/                                                    │
│   └─ 모든 것을 조립해 단일 JAR 을 만드는 곳                    │
│      한 JVM = 한 bootstrap = 한 프로세스                       │
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
       │   ├── core-user        → 유저 관리
       │   ├── core-auth        → 인증 (가입·로그인·토큰 갱신)
       │   ├── core-device      → 디바이스 등록
       │   ├── core-push        → FCM 푸시 전송
       │   ├── core-storage     → 파일 업로드·다운로드
       │   ├── core-attachment  → 첨부파일 메타 관리
       │   ├── core-content     → 콘텐츠·게시글
       │   ├── core-email       → 이메일 발송 (Resend)
       │   ├── core-sms         → SMS 발송
       │   ├── core-phone-auth  → 휴대폰 점유인증 (SMS OTP)
       │   ├── core-audit       → 감사 로그
       │   ├── core-analytics   → 사용 분석 이벤트
       │   ├── core-admin       → admin 운영 콘솔
       │   ├── core-billing     → 구독·플랜 정책
       │   ├── core-iap         → Apple·Google 인앱 결제 채널
       │   └── core-payment     → PG 채널 (포트원 어댑터)
       │
       └── apps/               ← 앱별 도메인 (템플릿에는 비어 있음)
           └── app-<slug>       → 새 앱은 여기에 자동 생성
```

각 모듈의 역할은 한 줄로 이렇게 정리돼요.

- `common/` 은 재료예요. 어디서든 쓰는 상태 없는 도구 모음이에요.
- `core/` 는 조립된 부품이에요. 인증이나 결제처럼 앱이 공통으로 쓰는 기능을 라이브러리로 담아요.
- `apps/` 는 각 앱의 실제 제품이에요. 가계부면 가계부, 운동 기록이면 운동 기록의 도메인 코드가 들어가요.
- `bootstrap/` 은 이것들을 다 담아 배송하는 상자예요. 전부 조립해 단일 [fat JAR](../reference/glossary.md#프레임워크--빌드) 하나로 빌드돼요.

`core/` 의 모듈은 `-api` 와 `-impl` 두 짝으로 쪼개져 있어요. 예를 들어 `core-auth` 는 인터페이스만 담은 `core-auth-api` 와 실제 구현을 담은 `core-auth-impl` 로 나뉘어요. 예외는 하나, 운영 콘솔인 `core-admin` 은 `-api` 쌍 없이 `core-admin-impl` 단독이에요. 왜 이렇게 나누는지는 [`ADR-003 · -api / -impl 분리`](../philosophy/adr-003-api-impl-split.md) 가 답해요. 한 줄로 말하면 나중에 한 기능을 따로 떼어낼 수 있게 미리 그어둔 경계예요.

## 2. 앱 하나를 추가한다는 것

"새 앱 시작합시다" 가 실제로 뭘 의미하는지 봐요. 명령은 단 한 줄이에요.

```bash
<repo> new gymlog
# 또는 직접: ./tools/app/new-app.sh gymlog
```

이 한 줄이 자동으로 만드는 것은 이렇게 생겼어요.

```
apps/app-gymlog/                             ← 새 앱 모듈 디렉터리
├── build.gradle                             ← Gradle 설정
├── README.md                                ← 앱 모듈 안내
├── src/main/java/com/factory/apps/gymlog/
│   ├── GymlogApiEndpoints.java              ← 앱 전용 경로 상수 카탈로그
│   ├── config/GymlogAppAutoConfiguration.java ← Spring Boot 자동 설정
│   ├── config/GymlogDataSourceConfig.java   ← 앱 전용 DB 연결
│   └── controller/GymlogHealthController.java ← /api/apps/gymlog/health
└── src/main/resources/db/migration/gymlog/
    ├── V001__init_users.sql                 ← 유저·인증 기반 테이블
    ├── ...                                  ← V002 ~ V006
    ├── V008__init_subscription_plans.sql    ← 구독·결제 테이블
    ├── ...                                  ← V009 ~ V024 (감사·알림·첨부·환불·게시글 등)
    └── V025__add_analytics.sql              ← 분석 이벤트 테이블
```

[Flyway](../reference/glossary.md#데이터베이스) 마이그레이션이 꽤 많아 보이지만, 대부분 모든 앱이 똑같이 쓰는 인증·결제 기반이에요. admin 유저 시드(V007)는 `--seed-admin` 을 붙였을 때만 생성돼서 기본 실행에는 없어요. 본인 도메인 테이블은 그다음 비어 있는 번호(현재 V026)부터 직접 작성하면 돼요. 자세한 구성은 [`Onboarding §3`](../start/onboarding.md#3-첫-앱-모듈-추가) 에 표로 정리돼 있어요.

그리고 PostgreSQL 쪽에서도 두 가지가 자동으로 생겨요.

- `gymlog` [schema](../reference/glossary.md#데이터베이스) 가 새로 만들어져요.
- `gymlog_app` 이라는 전용 [role](../reference/glossary.md#데이터베이스) 이 만들어져요. 이 role 은 다른 앱 schema 에는 접근하지 못해요.

인증 컨트롤러는 앱 모듈에 새로 생기지 않아요. `core-auth-impl` 의 공유 `AuthController` 한 개가 `/api/apps/{appSlug}/auth/*` 경로로 모든 앱의 인증을 처리해요. 가입·로그인·소셜 로그인·토큰 갱신·비밀번호 재설정·2단계 인증까지 엔드포인트 열아홉 개가 이미 들어 있어서, 직접 손으로 짤 필요가 없어요.

그래서 새 앱을 받은 당신이 할 일은 단순해요. `apps/app-gymlog/` 안에 그 앱만의 도메인 코드를 더하면 돼요. 운동 기록 앱이라면 세트·반복·운동 같은 것들이요. 이 "복사 자동화" 덕분에 앱 추가에 걸리는 시간이 분 단위로 떨어져요.

## 3. 앱마다 데이터가 분리된다는 것

한 Postgres 인스턴스 안에서, 앱마다 [schema](../reference/glossary.md#데이터베이스) 하나씩을 논리적 경계로 가져요. 아래는 가계부 앱과 자산 앱, 그리고 방금 만든 `gymlog` 까지 세 앱이 올라간 모습을 그린 거예요.

```
postgres (database)
│
├── sumtally schema                 ← 가계부 앱 전용 (예시)
│   ├── users                       ← sumtally 유저
│   ├── auth_refresh_tokens
│   ├── budget_groups               ← 가계부 도메인
│   └── expenses
│
├── rny schema                      ← 자산 앱 전용 (예시)
│   ├── users                       ← rny 유저 (sumtally 와 완전 별개)
│   ├── auth_refresh_tokens
│   └── asset_groups                ← 자산 도메인
│
└── gymlog schema                   ← 방금 만든 앱 전용
    ├── users
    └── (도메인 테이블은 아직 비어 있음)
```

유저·인증 테이블은 공유 저장소 한 곳에 모이지 않아요. 각 앱 schema 안에 똑같은 모양으로 따로 생겨요. `core-*` 의 자바 코드는 라이브러리로서 공유되지만, 데이터가 사는 자리는 앱마다 격리돼요. 이 per-app 격리 결정은 [`ADR-037 · core schema 폐기`](../philosophy/adr-037-core-schema-deprecation.md) 가 기록해요.

여기서 기억할 규칙은 세 가지예요.

- 같은 이메일이 sumtally 와 rny 양쪽에 있더라도, 둘은 서로 다른 유저예요 ([`ADR-012`](../philosophy/adr-012-per-app-user-model.md)).
- DB [role](../reference/glossary.md#데이터베이스) 이 분리돼 있어서, sumtally 코드가 rny schema 에 접근하려 하면 PostgreSQL 이 거절합니다.
- [HikariCP](../reference/glossary.md#데이터베이스) 커넥션 풀도 앱별로 따로예요. 한 앱이 DB 를 과부하시켜도 다른 앱은 멀쩡합니다.

이 격리가 어떻게 여러 겹으로 지켜지는지는 [`ADR-005 · DB schema 격리`](../philosophy/adr-005-db-schema-isolation.md) 가 자세히 다뤄요.

## 4. 배포하면 하나일까 여러 개일까

배포가 끝나고 나면, 어떤 것은 단 하나로 존재하고 어떤 것은 앱 수만큼 존재해요. 한 프로세스 안에 여러 앱이 공존하는 [모듈러 모놀리스](../reference/glossary.md#아키텍처-용어) 구조라서 그래요.

| 배포 후 존재하는 것 | 개수 |
|---|---|
| 서버 (JVM 프로세스) | 1 개 — 모든 앱이 한 프로세스 안 |
| JAR 파일 | 1 개 |
| Docker 이미지 | 1 개 |
| PostgreSQL 인스턴스 | 1 개 |
| HTTP 엔드포인트 prefix | N 개 — `/api/apps/sumtally/*`, `/api/apps/rny/*`, ... |
| PostgreSQL schema | N 개 — 앱마다 하나 |
| DataSource bean | N 개 — 앱마다 하나 |
| Flyway 마이그레이션 히스토리 | N 개 — schema 마다 독립 |

한 줄로 요약하면 이래요. 외부에서 보면 앱이 N 개처럼 보이고, 내부 운영은 한 개처럼 굴러갑니다.

## 5 분이 지나서

여기까지 따라왔다면 이런 상태가 됐을 거예요.

- 이 레포의 큰 그림이 머릿속에 들어와요.
- "아, 이게 [모듈러 모놀리스](../reference/glossary.md#아키텍처-용어) 구나" 라는 납득이 생겨요.
- "왜 HS256 JWT 를 쓰지?" 같은 개별 설계 결정으로 파고들 준비가 끝나요.

## 다음으로

| 다음 행동 | 문서 |
|---|---|
| 설계 결정의 이유를 읽고 싶다 | [`Repository Philosophy — 책 안내`](../philosophy/README.md) — 프롤로그 + 테마 1 (ADR-001~004) |
| 직접 돌려보고 싶다 | [`Onboarding — 템플릿 첫 사용 가이드`](../start/onboarding.md) — 로컬 환경 셋업 |
| 구조의 전체 레퍼런스가 필요하다 | [`Architecture Reference`](../structure/architecture.md) — 파일 트리 + 의존 그래프 |
| Developer Journey 전체 순서가 궁금하다 | [`📚 template-spring — 책 목차`](./README.md) |

"관심은 있는데 지금은 시간이 없다" 면, 이 문서와 [`이게 뭐야?`](./what-is-this.md) 두 개로 충분해요. 필요해지면 다시 돌아오세요.
