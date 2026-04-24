# Level 0 용어 사전

이 레포의 문서를 읽다가 **"이게 뭐지?"** 싶으면 여기서 먼저 찾아보세요. 엄밀한 정의보다 **직관적 이해 우선**. 더 깊이 들어가고 싶으면 각 용어 옆의 관련 문서 링크를 따라가면 됩니다.

## 프레임워크 / 빌드

**Spring Boot** — Java 웹 서버 프레임워크. "HTTP 요청 받으면 이 함수 실행" 같은 걸 쉽게 쓸 수 있게 해줌. 이 레포의 핵심.

**Spring Framework** — Spring Boot 의 기반. DI (의존성 주입) · AOP · MVC 등의 뼈대. Boot 은 이걸 **기본값 잔뜩 깔아놓은 버전**.

**Gradle** — Java 빌드 도구. `./gradlew build` 치면 전체를 컴파일하고 테스트하고 JAR 을 만듦. Maven 과 같은 계보.

**JAR (Java ARchive)** — 컴파일된 Java 코드 한 덩어리. `.zip` 파일과 사실상 같은 구조. "실행 가능한 JAR" 은 `java -jar xxx.jar` 로 바로 실행됨.

**Fat JAR** — 의존 라이브러리들까지 전부 한 파일에 담긴 JAR. Spring Boot 기본. 이 레포의 배포 단위.

**멀티모듈 (Multi-module)** — 한 레포 안에 여러 Gradle 서브프로젝트. `common/common-web`, `core/core-auth-impl` 등 각자가 독립 빌드 가능한 모듈.

## 데이터베이스

**JPA (Java Persistence API)** — Java 표준 ORM 인터페이스. `@Entity` 로 선언하면 **클래스 ↔ DB 테이블** 매핑.

**Hibernate** — JPA 의 가장 대중적인 구현체. 이 레포가 쓰는 것.

**ORM (Object-Relational Mapping)** — "객체와 관계형 DB 를 자동 연결" 하는 기술 전반.

**QueryDsl** — 타입 세이프한 동적 쿼리 빌더. `select()·from()·where()` 를 Java 코드로 조립. SQL 오타가 **컴파일 타임에** 잡힘 ([`ADR-010`](../philosophy/adr-010-search-condition.md)).

**Flyway** — DB 마이그레이션 도구. `V001__init_users.sql` 같은 파일을 **순서대로 한 번씩** 실행해서 스키마를 만들어감. 이미 실행한 건 기억해둠.

**HikariCP** — DB 커넥션 풀. 매 요청마다 DB 연결을 새로 여는 건 느리니까 **미리 10 개 정도 열어두고 돌려씀**. 이 레포는 앱마다 독립 풀.

**Schema** — 한 DB 안의 논리적 네임스페이스. `sumtally.users` 와 `rny.users` 는 같은 Postgres 안에 있지만 서로 별개 테이블 ([`ADR-005`](../philosophy/adr-005-db-schema-isolation.md)).

**Role** — Postgres 의 사용자 계정. 이 레포에서는 앱마다 전용 role 을 만들어 "다른 앱 schema 접근 불가" 를 강제.

## 인증 / 보안

**JWT (JSON Web Token)** — 로그인 후 받는 **서명된 문자열**. 서버가 "이 토큰을 가진 사람 = 유저 42번" 이라는 걸 매 요청마다 암호학적으로 검증 가능.

**Access Token** — 짧은 수명 JWT (이 레포는 15 분). API 호출할 때마다 `Authorization: Bearer <token>` 헤더로 전송.

**Refresh Token** — 긴 수명 (30 일). Access 만료되면 이걸로 새 Access 발급받음.

**Bearer Token** — HTTP 헤더 포맷: `Authorization: Bearer <token>`. RFC 6750 표준.

**HS256 vs RS256** — JWT 서명 알고리즘. HS256 은 **한 비밀키로 서명+검증** (대칭키). RS256 은 **개인키 서명 + 공개키 검증** (비대칭키). 이 레포는 HS256 ([`ADR-006`](../philosophy/adr-006-hs256-jwt.md)).

**BCrypt** — 비밀번호 해싱 알고리즘. 원본 비밀번호를 DB 에 저장하지 않고 해시만 저장.

**OAuth / OpenID** — 제3자 로그인 표준. "구글 계정으로 로그인" 같은 플로우.

**Apple Sign In / Google Sign In** — 각각 Apple · Google 이 제공하는 OAuth 구현.

## 운영 / 인프라

**Docker** — 앱을 "컨테이너" 로 패키징하는 도구. 내 Mac 에서 돌던 게 리눅스 서버에서도 동일하게 돌게 함.

**Docker Compose** — 여러 컨테이너를 한 번에 띄우는 도구. `docker-compose up` 한 줄로 Postgres + MinIO + 내 앱 동시 기동.

**Kamal** — Rails 생태계에서 나온 배포 도구. Docker + SSH + 작은 설정 파일로 blue/green 배포.

**Blue/Green 배포** — 무중단 배포 방식. 기존 버전(Blue) 이 도는 동안 새 버전(Green) 을 띄우고, 준비되면 **순간 전환**. Blue 는 graceful shutdown.

**Cloudflare Tunnel** — 집 서버의 공인 IP 노출 없이 Cloudflare 를 통해 인터넷에 서비스 공개하는 도구. 이 레포는 맥미니 홈서버 배포에 사용.

**FCM (Firebase Cloud Messaging)** — 구글 푸시 알림 서비스. iOS/Android 양쪽 모두 지원.

**S3 / MinIO** — 파일 업로드용 오브젝트 스토리지. S3 는 Amazon, MinIO 는 S3 호환 오픈소스. 이 레포는 MinIO 또는 Cloudflare R2.

## 아키텍처 용어

**Modular Monolith** — "한 프로세스 안에 여러 모듈 공존 + 모듈 간 경계 강제". 마이크로서비스의 복잡함 없이 마이크로서비스의 이점 일부 얻기. 이 레포의 핵심 철학 ([`ADR-001`](../philosophy/adr-001-modular-monolith.md)).

**Microservice** — 앱을 작은 서비스 여러 개로 쪼개서 각자 배포/운영. 대규모 팀에 유리, 솔로에 과함.

**Port / Adapter (Hexagonal Architecture)** — "비즈니스 로직(Port)" 과 "외부 연결(Adapter)" 분리. 이 레포의 `-api` vs `-impl` 구조 ([`ADR-003`](../philosophy/adr-003-api-impl-split.md), [`ADR-011`](../philosophy/adr-011-layered-port-adapter.md)).

**ArchUnit** — 아키텍처 규칙을 **코드로 테스트** 하는 라이브러리. "core-api 는 JPA 의존 금지" 같은 걸 컴파일/테스트 레벨에서 강제 ([`ADR-004`](../philosophy/adr-004-gradle-archunit.md)).

## 개발 프로세스

**Conventional Commits** — 커밋 메시지 포맷: `type(scope): subject`. 예: `feat(auth): add Apple Sign In`. 기계가 읽어서 릴리스 노트 자동 생성 가능 ([`ADR-015`](../philosophy/adr-015-conventional-commits-semver.md)).

**SemVer (Semantic Versioning)** — 버전 번호 규칙: `MAJOR.MINOR.PATCH`. Breaking change → major, 기능 추가 → minor, 버그 수정 → patch.

**Cherry-pick** — git 에서 "특정 커밋만 뽑아서 다른 브랜치에 적용". 이 레포가 템플릿 → 파생 레포 전파에 사용.

**Husky** — git hook 관리 도구. 커밋할 때 commitlint 자동 실행 등.

**Commitlint** — 커밋 메시지 포맷 검증 도구. `chore: foo` 같은 타입 강제.

## 이 레포 고유 용어

**템플릿 레포** — `spring-backend-template` 본 레포. GitHub Template Repository 로 "Use this template" 버튼으로 복제됨.

**파생 레포** — 템플릿 레포를 "Use this template" 으로 만든 본인 프로젝트 레포. 예: `sumtally-backend`.

**앱 모듈** — `apps/app-<slug>` 디렉토리. 한 모바일 앱의 도메인 로직. 템플릿엔 비어있고 파생 레포에서 생성.

**appSlug** — 앱 식별자 문자열. URL (`/api/apps/{appSlug}/...`) 과 DB schema 이름과 JWT claim 에 일관 사용.

**도그푸딩 (dogfooding)** — "자기 제품을 자기가 써보기". 이 레포는 템플릿 자체를 실제 프로젝트로 돌려서 작동 검증.

**template-v* 태그** — 템플릿 레포의 버전 태그. 예: `template-v0.3.0`. 파생 레포는 "v0.3.0 기반" 이라고 단일 버전으로 추적.

## 다음

- 여전히 감이 안 오는 용어가 있으면 [`Repository Philosophy — 책 안내`](../philosophy/README.md) 의 프롤로그부터 훑어보세요.
- 실전 용어는 [`Architecture Reference`](../structure/architecture.md) 의 각 섹션에서 맥락과 함께 등장합니다.
