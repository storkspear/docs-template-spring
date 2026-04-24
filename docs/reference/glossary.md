# Level 0 용어 사전

이 레포의 문서를 읽다가 **"이게 뭐지?"** 싶으면 여기서 먼저 찾아보세요. 엄밀한 정의보다 **직관적 이해 우선**. 더 깊이 들어가고 싶으면 각 용어 옆의 관련 문서 링크를 따라가면 됩니다.

## 프레임워크 / 빌드

**Spring Boot** — Java 웹 서버 프레임워크. "HTTP 요청 받으면 이 함수 실행" 같은 걸 쉽게 쓸 수 있게 해줌. 이 레포의 핵심.

**Spring Framework** — Spring Boot 의 기반. DI (의존성 주입) · AOP · MVC 등의 뼈대. Boot 은 이걸 **기본값 잔뜩 깔아놓은 버전**.

**DI (Dependency Injection, 의존성 주입)** — 객체가 필요한 다른 객체를 "직접 만들지 않고 외부에서 받는" 설계. Spring 이 `@Service` 달린 클래스를 자동으로 만들어서 넣어줌.

**DIP (Dependency Inversion Principle)** — "고수준 모듈은 저수준 모듈에 의존하지 않는다" 원칙. `-api` 가 `-impl` 을 모르고, `-impl` 이 `-api` 를 구현하는 구조의 근거.

**Gradle** — Java 빌드 도구. `./gradlew build` 치면 전체를 컴파일하고 테스트하고 JAR 을 만듦. Maven 과 같은 계보.

**Gradle Convention Plugin** — 여러 모듈에서 공통 설정을 재사용하는 Gradle 기법. 이 레포의 `build-logic/` 디렉토리가 그것.

**build-logic** — 이 레포의 Gradle convention plugin 모음. 모듈별 공통 설정 (Java 버전, Kotlin DSL, Spring 의존성 등) 을 이 안에서 관리.

**bootJar** — Spring Boot Gradle 플러그인이 만드는 실행 가능한 fat JAR 작업. `./gradlew bootJar` 의 결과물이 곧 배포 단위.

**JAR (Java ARchive)** — 컴파일된 Java 코드 한 덩어리. `.zip` 파일과 사실상 같은 구조. "실행 가능한 JAR" 은 `java -jar xxx.jar` 로 바로 실행됨.

**Fat JAR** — 의존 라이브러리들까지 전부 한 파일에 담긴 JAR. Spring Boot 기본. 이 레포의 배포 단위.

**멀티모듈 (Multi-module)** — 한 레포 안에 여러 Gradle 서브프로젝트. `common/common-web`, `core/core-auth-impl` 등 각자가 독립 빌드 가능한 모듈.

**Kotlin DSL** — Gradle 빌드 스크립트 언어. `build.gradle.kts` · `settings.gradle.kts` 가 Groovy 대신 Kotlin 으로 작성된 것. 이 레포는 Kotlin DSL 사용.

## Spring 어노테이션 / 런타임

**@Bean** — Spring 이 관리하는 객체 (Bean) 를 선언. `@Configuration` 클래스 안의 메서드에 붙임.

**@Configuration** — "이 클래스 안에 `@Bean` 메서드가 있다" 고 Spring 에 알리는 표식.

**@Component / @Service / @Controller / @Repository** — 각각 "일반 Bean / 비즈니스 로직 / HTTP 컨트롤러 / DB 접근" 을 의미하는 스테레오타입 어노테이션. Spring 이 자동으로 등록.

**@Autowired** — Bean 을 주입받을 지점 표시. 이 레포는 생성자 주입 선호 → 대부분 생략 (Spring 4.3+ 는 단일 생성자면 자동).

**@Primary** — 같은 타입의 Bean 이 여러 개 있을 때 "기본은 이거다" 고 지정. Multi-DataSource 구성에서 등장.

**@ConfigurationProperties** — `application.yml` 의 설정값을 타입 세이프한 클래스에 바인딩. `JwtProperties`, `CorsProperties` 등.

**@ConditionalOnMissingBean** — "이 이름의 Bean 이 없을 때만 이 Bean 을 등록하라". 자동 설정에서 사용자 커스터마이즈를 허용하는 패턴.

**@AutoConfiguration** — Spring Boot 3.x 의 자동 설정 선언. `spring.factories` 대신 `AutoConfiguration.imports` 로 로딩.

**@Import** — 다른 `@Configuration` 을 현재 설정에 가져옴. 모듈 경계를 넘나들 때 사용.

**@Transactional** — 메서드 실행 전후로 DB 트랜잭션 자동 관리. 예외 발생 시 롤백.

**@Entity** — JPA 가 "이 클래스는 DB 테이블과 매핑된다" 고 인식하는 표식.

**@MappedSuperclass** — 공통 필드 (id, createdAt 등) 를 담고, 실제 테이블로는 매핑되지 않는 부모 클래스. `BaseEntity` 가 이것 ([`ADR-009`](../philosophy/adr-009-base-entity.md)).

**@Id / @GeneratedValue** — 엔티티의 PK 와 자동 증가 전략. 이 레포는 `GenerationType.IDENTITY` (DB 자동 증가) 사용.

**@Column** — 엔티티 필드와 DB 컬럼 매핑 커스터마이즈 (이름 / nullable / length 등).

**@CurrentUser** — 이 레포 자체의 커스텀 어노테이션. 컨트롤러 파라미터에 붙이면 JWT 에서 추출한 유저 정보를 자동 주입.

**ApplicationRunner** — Spring Boot 시작 직후 실행되는 인터페이스. 초기 데이터 로드, 헬스체크 등에 사용.

## 데이터베이스

**JPA (Java Persistence API)** — Java 표준 ORM 인터페이스. `@Entity` 로 선언하면 **클래스 ↔ DB 테이블** 매핑.

**Hibernate** — JPA 의 가장 대중적인 구현체. 이 레포가 쓰는 것.

**ORM (Object-Relational Mapping)** — "객체와 관계형 DB 를 자동 연결" 하는 기술 전반.

**Spring Data JPA** — Spring 이 JPA 위에 얹은 추상 레이어. `UserRepository extends JpaRepository<User, Long>` 한 줄로 CRUD 메서드 자동 생성.

**QueryDsl** — 타입 세이프한 동적 쿼리 빌더. `select()·from()·where()` 를 Java 코드로 조립. SQL 오타가 **컴파일 타임에** 잡힘 ([`ADR-010`](../philosophy/adr-010-search-condition.md)).

**Flyway** — DB 마이그레이션 도구. `V001__init_users.sql` 같은 파일을 **순서대로 한 번씩** 실행해서 스키마를 만들어감. 이미 실행한 건 기억해둠.

**Flyway R__ (Repeatable Migration)** — 파일 내용이 바뀔 때마다 다시 실행되는 마이그레이션. `R__seed.sql` 같은 시드 데이터에 사용.

**HikariCP** — DB 커넥션 풀. 매 요청마다 DB 연결을 새로 여는 건 느리니까 **미리 10 개 정도 열어두고 돌려씀**. 이 레포는 앱마다 독립 풀.

**Connection Pool** — DB 연결을 재사용하기 위해 미리 열어둔 연결의 집합. HikariCP 가 Spring Boot 기본.

**Schema** — 한 DB 안의 논리적 네임스페이스. `sumtally.users` 와 `rny.users` 는 같은 Postgres 안에 있지만 서로 별개 테이블 ([`ADR-005`](../philosophy/adr-005-db-schema-isolation.md)).

**Role** — Postgres 의 사용자 계정. 이 레포에서는 앱마다 전용 role 을 만들어 "다른 앱 schema 접근 불가" 를 강제.

**pg_dump** — Postgres 백업 도구. SQL 스크립트로 스키마+데이터를 덤프.

**Supabase** — 클라우드 Postgres + Auth + Storage 서비스. 이 레포는 Postgres 부분만 사용 (Supabase Pooler 경유).

**Supabase Pooler** — PgBouncer 기반의 연결 풀러. transaction mode (짧은 트랜잭션) 와 session mode (긴 세션) 두 가지. 각각 특성이 다름.

**N+1 쿼리 문제** — JPA 에서 목록을 가져온 후 각 항목의 연관 객체를 하나씩 추가 쿼리로 가져오는 성능 이슈. `fetch join` 또는 배치 로딩으로 해결.

## 인증 / 보안

**JWT (JSON Web Token)** — 로그인 후 받는 **서명된 문자열**. 서버가 "이 토큰을 가진 사람 = 유저 42번" 이라는 걸 매 요청마다 암호학적으로 검증 가능.

**Access Token** — 짧은 수명 JWT (이 레포는 15 분). API 호출할 때마다 `Authorization: Bearer <token>` 헤더로 전송.

**Refresh Token** — 긴 수명 (30 일). Access 만료되면 이걸로 새 Access 발급받음.

**Bearer Token** — HTTP 헤더 포맷: `Authorization: Bearer <token>`. RFC 6750 표준.

**HS256 vs RS256** — JWT 서명 알고리즘. HS256 은 **한 비밀키로 서명+검증** (대칭키). RS256 은 **개인키 서명 + 공개키 검증** (비대칭키). 이 레포는 HS256 ([`ADR-006`](../philosophy/adr-006-hs256-jwt.md)).

**jjwt** — Java JWT 라이브러리. 이 레포가 사용하는 것 (0.13.0).

**BCrypt** — 비밀번호 해싱 알고리즘. 원본 비밀번호를 DB 에 저장하지 않고 해시만 저장.

**OAuth / OpenID** — 제3자 로그인 표준. "구글 계정으로 로그인" 같은 플로우.

**Apple Sign In / Google Sign In** — 각각 Apple · Google 이 제공하는 OAuth 구현.

**RBAC (Role-Based Access Control)** — "이 역할은 이 리소스에 접근 가능" 형태의 권한 모델. 이 레포의 관리자 API 에서 사용.

**Cloudflare Access** — Cloudflare 의 Zero-Trust 접근 제어. 관리자 전용 엔드포인트에 "구글 계정으로 인증해야 통과" 같은 정책 부여.

**TLS / HTTPS** — 전송 구간 암호화. CF Tunnel 이 edge 에서 처리 → 내부 구간은 평문 가능 (trade-off 존재).

**SPF / DKIM** — 메일 서버가 "이 메일이 정당한 발신자로부터 왔다" 고 증명하는 DNS 레코드. 이 레포는 Resend 를 통해 자동 구성.

## 운영 / 인프라

**Docker** — 앱을 "컨테이너" 로 패키징하는 도구. 내 Mac 에서 돌던 게 리눅스 서버에서도 동일하게 돌게 함.

**Docker Compose** — 여러 컨테이너를 한 번에 띄우는 도구. `docker-compose up` 한 줄로 Postgres + MinIO + 내 앱 동시 기동.

**GHCR (GitHub Container Registry)** — GitHub 이 제공하는 Docker 이미지 저장소. 이 레포의 이미지가 여기 푸시됨.

**Kamal** — Rails 생태계에서 나온 배포 도구. Docker + SSH + 작은 설정 파일로 blue/green 배포.

**kamal-proxy** — Kamal 의 리버스 프록시. Blue/Green 전환 시 트래픽 스위칭을 담당.

**Blue/Green 배포** — 무중단 배포 방식. 기존 버전(Blue) 이 도는 동안 새 버전(Green) 을 띄우고, 준비되면 **순간 전환**. Blue 는 graceful shutdown.

**Graceful Shutdown** — 서버를 끌 때 "새 요청은 안 받되, 처리 중인 요청은 끝낸 후" 종료. Spring `server.shutdown=graceful` + `timeout-per-shutdown-phase=30s`.

**Liveness Probe / Readiness Probe** — "서버가 살아있나 / 트래픽 받을 준비 됐나" 를 주기적으로 확인하는 엔드포인트. 이 레포는 `/actuator/health/liveness`, `/actuator/health/readiness`.

**Actuator** — Spring Boot 의 운영 엔드포인트 모음. health, metrics, info 등을 `/actuator/*` 로 노출.

**Cloudflare Tunnel (cloudflared)** — 집 서버의 공인 IP 노출 없이 Cloudflare 를 통해 인터넷에 서비스 공개하는 도구. 이 레포는 맥미니 홈서버 배포에 사용.

**CDN (Content Delivery Network)** — 전 세계 엣지 서버에서 콘텐츠를 캐시/서빙. Cloudflare 가 이 레포의 CDN.

**launchd** — macOS 의 서비스 관리자 (리눅스 systemd 와 유사). 이 레포는 cloudflared 부팅 시 자동 실행에 사용.

**Tailscale** — Zero-Config VPN. 이 레포는 맥미니 ↔ NAS 내부망 연결에 활용.

**NAS (Network Attached Storage)** — 네트워크 저장소. 이 레포는 Synology NAS 를 백업 대상으로 사용.

**Synology** — NAS 제조사. `backup-to-nas.sh.example` 의 대상.

**FCM (Firebase Cloud Messaging)** — 구글 푸시 알림 서비스. iOS/Android 양쪽 모두 지원.

**APNs (Apple Push Notification service)** — Apple 의 푸시 서비스. FCM 이 내부적으로 APNs 호출.

**Resend** — 트랜잭셔널 이메일 서비스. 이 레포는 이메일 인증 코드 발송에 사용.

**S3 / MinIO** — 파일 업로드용 오브젝트 스토리지. S3 는 Amazon, MinIO 는 S3 호환 오픈소스. 이 레포는 MinIO 또는 Cloudflare R2.

**Cloudflare R2** — Cloudflare 의 S3 호환 오브젝트 스토리지. Egress 비용 무료가 특징.

**Webhook** — "이벤트 발생 시 지정한 URL 로 HTTP POST" 하는 콜백 메커니즘. GHA, Discord 알림 등에 사용.

**Discord Webhook** — Discord 채널에 메시지를 자동 전송하는 URL. 이 레포는 알림 채널로 활용.

## CI / 배포 파이프라인

**GitHub Actions (GHA)** — GitHub 의 CI/CD. 이 레포의 빌드/테스트/배포 자동화.

**workflow_run trigger** — 한 워크플로우가 끝나면 다른 워크플로우를 트리거. 이 레포는 "test 성공 → build+push → deploy" 체인에 사용.

**PAT (Personal Access Token)** — GitHub 의 개인 토큰. 워크플로우 간 권한 승계, 외부 도구 인증에 사용.

**Artifact** — GHA 빌드 산출물 (JAR, 로그, 리포트 등). 다른 job 으로 전달 가능.

**CI (Continuous Integration)** — 코드 push 마다 자동 빌드 + 테스트.

**CD (Continuous Deployment)** — CI 통과 시 자동 배포.

## 관측성 / 로깅

**Prometheus** — 시계열 메트릭 수집 도구. 주기적으로 앱의 `/actuator/prometheus` 를 긁어감 (scrape).

**Grafana** — 메트릭 시각화 대시보드. Prometheus + Loki 를 소스로 차트/알람 구성.

**Loki** — 로그 수집 도구 (Prometheus 와 같은 철학). 이 레포는 retention 14 일.

**Alertmanager** — Prometheus 알람 라우팅. 조건 만족 시 Discord/Email 등으로 발송.

**Micrometer** — Spring Boot 의 메트릭 추상화. 여러 백엔드 (Prometheus, Datadog 등) 지원.

**MDC (Mapped Diagnostic Context)** — 로그에 요청별 컨텍스트 (requestId, userId 등) 를 자동 주입하는 SLF4J 기능.

**logback** — Java 표준 로깅 라이브러리. Spring Boot 기본.

**Scrape** — Prometheus 가 메트릭을 "긁어간다" 는 행위. pull 방식.

**RPS (Requests Per Second)** — 초당 요청 수.

**p95 / p99** — 응답 시간 분포의 95/99 백분위수. "전체 요청 중 95% 가 N ms 이내 응답" 의미.

**SLA (Service Level Agreement)** — 서비스 수준 약속 (가용성 99.9% 등).

## 테스팅

**JUnit 5** — Java 테스트 프레임워크. `@Test` 어노테이션 기반.

**@Nested** — JUnit 5 의 테스트 클래스 중첩. "given-when-then" 구조화에 사용.

**AssertJ** — 유창한 assert 라이브러리. `assertThat(result).isEqualTo(expected).hasSize(3)` 같은 체이닝.

**Mockito** — Java 모킹 라이브러리. `when().thenReturn()`, `verify()`.

**ArgumentCaptor** — Mockito 의 호출 인자 캡처 도구. "실제로 어떤 값으로 호출됐는지" 검증.

**Testcontainers** — 테스트에서 진짜 Postgres / MinIO 등을 Docker 로 띄우는 라이브러리. Mock 대신 실 DB 로 통합 테스트.

**@SpringBootTest** — Spring ApplicationContext 전체를 띄우는 통합 테스트 어노테이션.

**@DataJpaTest** — JPA 레이어만 띄우는 슬라이스 테스트. H2 기본이지만 이 레포는 Testcontainers Postgres 사용.

**@TestConfiguration** — 테스트 전용 Bean 정의. 프로덕션 코드에 영향 없음.

**@ActiveProfiles** — 테스트에서 사용할 Spring 프로파일 지정 (`@ActiveProfiles("test")`).

**@Sql** — 테스트 전후로 SQL 파일 실행. 시드 데이터 로드에 사용.

**@DynamicPropertySource** — Testcontainers 가 띄운 컨테이너의 주소 (동적 포트) 를 Spring 설정에 주입.

**Contract Testing** — API 응답의 JSON 계약을 테스트로 고정. "필드 이름이 바뀌면 테스트 깨짐" ([`production/test/contract-testing`](../production/test/contract-testing.md)).

**Integration Test** — 여러 컴포넌트를 실제로 엮어서 돌리는 테스트. 이 레포는 Testcontainers Postgres 필수.

**Delegation Mock** — "A 가 B 를 호출하는지" 만 확인하는 테스트 (껍데기만 검증). 이 레포는 금지 ([`ADR-014`](../philosophy/adr-014-no-delegation-mock.md)).

**Round-trip** — JSON 직렬화 ↔ 역직렬화 왕복 테스트. 필드 손실/추가 방지.

**Canonical JSON** — 정규화된 JSON 표현 (키 정렬, 공백 제거). 계약 테스트의 비교 기준.

## 코드 패턴

**Sealed Interface / Sealed Class** — Java 17+ 의 "허용된 하위 타입만 구현/상속 가능" 한 인터페이스/클래스. 도메인 타입 제한에 사용.

**Record** — Java 14+ 의 불변 데이터 클래스. `record User(Long id, String name) {}` 한 줄로 생성자+getter+equals+hashCode 자동.

**DTO (Data Transfer Object)** — 계층 간 데이터 전송 객체. 이 레포는 Record 로 선언, Mapper 금지 ([`ADR-016`](../philosophy/adr-016-dto-mapper-forbidden.md)).

**DTO Factory** — DTO 생성을 엔티티의 static 메서드 (`UserResponse.of(user)`) 로 처리하는 패턴. Mapper 대체.

**SOLID** — 객체지향 설계 5 원칙 (SRP, OCP, LSP, ISP, DIP).

**Idempotent (멱등)** — 같은 요청을 여러 번 보내도 결과가 같은 연산. PUT, DELETE 가 전형적.

**Ephemeral** — "일회성, 휘발성" 의 의미. 테스트 컨테이너, 임시 토큰 등에 쓰는 용어.

## 라이브러리 / SDK

**Jackson** — Java 의 JSON 직렬화 표준. Spring Boot 기본.

**Bucket4j** — Java Rate Limiting 라이브러리. Token Bucket 알고리즘. 이 레포의 `/auth/*` 엔드포인트에 적용.

**springdoc-openapi** — Spring Boot 자동 OpenAPI 문서 생성 (2.6.0). `/v3/api-docs` · Swagger UI 제공. 버전 · 경로는 `build.gradle.kts`, `application.yml` 의 springdoc 설정을 기준으로 확인.

**Firebase Admin SDK** — 서버에서 FCM 을 호출할 때 쓰는 Java SDK.

**ArchUnit** — 아키텍처 규칙을 **코드로 테스트** 하는 라이브러리. "core-api 는 JPA 의존 금지" 같은 걸 컴파일/테스트 레벨에서 강제 ([`ADR-004`](../philosophy/adr-004-gradle-archunit.md)).

## 아키텍처 용어

**Modular Monolith** — "한 프로세스 안에 여러 모듈 공존 + 모듈 간 경계 강제". 마이크로서비스의 복잡함 없이 마이크로서비스의 이점 일부 얻기. 이 레포의 핵심 철학 ([`ADR-001`](../philosophy/adr-001-modular-monolith.md)).

**Microservice** — 앱을 작은 서비스 여러 개로 쪼개서 각자 배포/운영. 대규모 팀에 유리, 솔로에 과함.

**Hexagonal Architecture (Port / Adapter)** — "비즈니스 로직(Port)" 과 "외부 연결(Adapter)" 분리. 이 레포의 `-api` vs `-impl` 구조 ([`ADR-003`](../philosophy/adr-003-api-impl-split.md), [`ADR-011`](../philosophy/adr-011-layered-port-adapter.md)).

**Layered Architecture** — Controller → Service → Repository 계층형 구조. 이 레포는 Hexagonal 과 결합.

**Multitenant (멀티테넌트)** — 한 서버/DB 에서 여러 "테넌트 (앱)" 의 데이터를 분리해 서비스하는 구조. 이 레포는 schema-per-app 방식.

## 개발 프로세스

**Conventional Commits** — 커밋 메시지 포맷: `type(scope): subject`. 예: `feat(auth): add Apple Sign In`. 기계가 읽어서 릴리스 노트 자동 생성 가능 ([`ADR-015`](../philosophy/adr-015-conventional-commits-semver.md)).

**SemVer (Semantic Versioning)** — 버전 번호 규칙: `MAJOR.MINOR.PATCH`. Breaking change → major, 기능 추가 → minor, 버그 수정 → patch.

**Cherry-pick** — git 에서 "특정 커밋만 뽑아서 다른 브랜치에 적용". 이 레포가 템플릿 → 파생 레포 전파에 사용.

**Husky** — git hook 관리 도구. 커밋할 때 commitlint 자동 실행 등.

**Commitlint** — 커밋 메시지 포맷 검증 도구. `chore: foo` 같은 타입 강제.

**Commitizen** — 대화형 Conventional Commits 작성 도구. `cz` 명령으로 type/scope/subject 단계별 입력.

## 이 레포 고유 용어

**템플릿 레포** — `spring-backend-template` 본 레포. GitHub Template Repository 로 "Use this template" 버튼으로 복제됨.

**파생 레포** — 템플릿 레포를 "Use this template" 으로 만든 본인 프로젝트 레포. 예: `sumtally-backend`.

**앱 모듈** — `apps/app-<slug>` 디렉토리. 한 모바일 앱의 도메인 로직. 템플릿엔 비어있고 파생 레포에서 생성.

**appSlug** — 앱 식별자 문자열. URL (`/api/apps/{appSlug}/...`) 과 DB schema 이름과 JWT claim 에 일관 사용.

**도그푸딩 (dogfooding)** — "자기 제품을 자기가 써보기". 이 레포는 템플릿 자체를 실제 프로젝트로 돌려서 작동 검증.

**template-v* 태그** — 템플릿 레포의 버전 태그. 예: `template-v0.3.0`. 파생 레포는 "v0.3.0 기반" 이라고 단일 버전으로 추적.
