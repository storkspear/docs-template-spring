# Level 0 용어 사전

> **유형**: Reference · **독자**: Level 0~1 · **읽는 시간**: ~7분

이 레포의 문서를 읽다가 "이게 뭐지?" 싶으면 여기서 먼저 찾아보세요. 엄밀한 정의보다 직관적 이해를 우선합니다. 라이브러리·버전·외부 서비스 인벤토리는 [`Environment`](./environment.md) 를 참고하세요.

## 프레임워크 / 빌드

| 용어 | 설명 |
|---|---|
| Spring Boot | Java 웹 서버 프레임워크. "HTTP 요청 받으면 이 함수 실행" 같은 걸 쉽게 쓸 수 있게 해줘요. 이 레포의 핵심이에요 |
| Spring Framework | Spring Boot 의 기반. 의존성 주입·AOP·MVC 같은 뼈대를 담당해요. Boot 은 여기에 기본값을 잔뜩 깔아놓은 버전이에요 |
| DI (Dependency Injection) | 의존성 주입. 객체가 필요한 다른 객체를 직접 만들지 않고 외부에서 받는 설계예요. Spring 이 `@Service` 달린 클래스를 자동으로 만들어서 넣어줘요 |
| DIP (Dependency Inversion Principle) | 의존성 역전 원칙. "고수준 모듈은 저수준 모듈에 의존하지 않는다" 는 규칙이에요. `-api` 가 `-impl` 을 모르고 `-impl` 이 `-api` 를 구현하는 구조의 근거예요 |
| Gradle | Java 빌드 도구. `./gradlew build` 를 치면 전체를 컴파일하고 테스트하고 JAR 을 만들어요. Maven 과 같은 계보예요 |
| Gradle Convention Plugin | 여러 모듈에서 공통 설정을 재사용하는 Gradle 기법. 이 레포의 `build-logic/` 디렉토리가 그것이에요 |
| build-logic | 이 레포의 Gradle convention plugin 모음. 모듈별 공통 설정인 Java 버전·Spring 의존성 등을 이 안에서 관리해요 |
| bootJar | Spring Boot Gradle 플러그인이 만드는 실행 가능한 fat JAR 작업. `./gradlew bootJar` 의 결과물이 곧 배포 단위예요 |
| JAR (Java ARchive) | 컴파일된 Java 코드 한 덩어리. `.zip` 파일과 사실상 같은 구조예요. 실행 가능한 JAR 은 `java -jar xxx.jar` 로 바로 실행돼요 |
| Fat JAR | 의존 라이브러리들까지 전부 한 파일에 담긴 JAR. Spring Boot 기본값이고 이 레포의 배포 단위예요 |
| 멀티모듈 (Multi-module) | 한 레포 안에 여러 Gradle 서브프로젝트를 두는 구조. `common/common-web`, `core/core-auth-impl` 처럼 각자가 독립 빌드 가능한 모듈이에요 |
| Groovy DSL | 이 레포의 Gradle 빌드 스크립트 언어. 빌드 설정은 `build.gradle`, 모듈 목록은 `settings.gradle` 에 Groovy 로 작성돼요. 라이브러리 버전은 `gradle/libs.versions.toml` 한곳에 모여 있어요 |

## Spring 어노테이션 / 런타임

| 용어 | 설명 |
|---|---|
| @Bean | Spring 이 관리하는 객체인 Bean 을 선언해요. `@Configuration` 클래스 안의 메서드에 붙여요 |
| @Configuration | "이 클래스 안에 `@Bean` 메서드가 있다" 고 Spring 에 알리는 표식이에요 |
| @Component / @Service / @Controller / @Repository | 각각 일반 Bean·비즈니스 로직·HTTP 컨트롤러·DB 접근을 의미하는 스테레오타입 어노테이션이에요. Spring 이 자동으로 등록해요 |
| @Autowired | Bean 을 주입받을 지점을 표시해요. 이 레포는 생성자 주입을 선호해서 대부분 생략해요. Spring 4.3 이상은 단일 생성자면 자동으로 주입돼요 |
| @Primary | 같은 타입의 Bean 이 여러 개 있을 때 "기본은 이거다" 라고 지정해요. 다중 DataSource 구성에서 등장해요 |
| @ConfigurationProperties | `application.yml` 의 설정값을 타입 세이프한 클래스에 바인딩해요. `JwtProperties`, `RateLimitProperties` 등이 그 예예요 |
| @ConditionalOnMissingBean | "이 이름의 Bean 이 없을 때만 이 Bean 을 등록하라" 는 조건이에요. 자동 설정에서 사용자 커스터마이즈를 허용하는 패턴이에요 |
| @AutoConfiguration | Spring Boot 3.x 의 자동 설정 선언. `spring.factories` 대신 `AutoConfiguration.imports` 로 로딩돼요 |
| @Import | 다른 `@Configuration` 을 현재 설정에 가져와요. 모듈 경계를 넘나들 때 사용해요 |
| @Transactional | 메서드 실행 전후로 DB 트랜잭션을 자동 관리해요. 예외 발생 시 롤백돼요 |
| @Entity | JPA 가 "이 클래스는 DB 테이블과 매핑된다" 고 인식하는 표식이에요 |
| @MappedSuperclass | 공통 필드인 id, createdAt 등을 담고 실제 테이블로는 매핑되지 않는 부모 클래스예요. `BaseEntity` 가 이것이에요 ([`ADR-009`](../philosophy/adr-009-base-entity.md)) |
| @Id / @GeneratedValue | 엔티티의 PK 와 자동 증가 전략. 이 레포는 `GenerationType.IDENTITY`, 즉 DB 자동 증가를 사용해요 |
| @Column | 엔티티 필드와 DB 컬럼 매핑을 커스터마이즈해요. 이름·nullable·length 등을 지정해요 |
| @CurrentUser | 이 레포 자체의 커스텀 어노테이션. 컨트롤러 파라미터에 붙이면 JWT 에서 추출한 유저 정보를 자동 주입해요 |
| ApplicationRunner | Spring Boot 시작 직후 실행되는 인터페이스. 초기 데이터 로드, 헬스체크 등에 사용해요 |

## 데이터베이스

| 용어 | 설명 |
|---|---|
| JPA (Java Persistence API) | Java 표준 ORM 인터페이스. `@Entity` 로 선언하면 클래스와 DB 테이블을 매핑해요 |
| Hibernate | JPA 의 가장 대중적인 구현체. 이 레포가 쓰는 것이에요 |
| ORM (Object-Relational Mapping) | 객체와 관계형 DB 를 자동으로 연결하는 기술 전반을 가리켜요 |
| Spring Data JPA | Spring 이 JPA 위에 얹은 추상 레이어. `UserRepository extends JpaRepository<User, Long>` 한 줄로 CRUD 메서드가 자동 생성돼요 |
| QueryDsl | 타입 세이프한 동적 쿼리 빌더. `select()`, `from()`, `where()` 를 Java 코드로 조립해요. SQL 오타가 컴파일 타임에 잡혀요 ([`ADR-010`](../philosophy/adr-010-search-condition.md)) |
| Flyway | DB 마이그레이션 도구. `V001__init_users.sql` 같은 파일을 순서대로 한 번씩 실행해서 스키마를 만들어가요. 이미 실행한 건 기억해 둬요 |
| Flyway R__ (Repeatable Migration) | 파일 내용이 바뀔 때마다 다시 실행되는 마이그레이션. `R__seed.sql` 같은 시드 데이터에 사용해요 |
| HikariCP | DB 커넥션 풀. 매 요청마다 DB 연결을 새로 여는 건 느리니까 미리 몇 개를 열어두고 돌려써요. 이 레포는 기본 풀 크기가 5 이고 앱마다 독립 풀을 둬요 |
| Connection Pool | DB 연결을 재사용하기 위해 미리 열어둔 연결의 집합이에요. HikariCP 가 Spring Boot 기본이에요 |
| Schema | 한 DB 안의 논리적 네임스페이스. `sumtally.users` 와 `rny.users` 는 같은 Postgres 안에 있지만 서로 별개 테이블이에요 ([`ADR-005`](../philosophy/adr-005-db-schema-isolation.md)) |
| Role | Postgres 의 사용자 계정. 이 레포에서는 앱마다 전용 role 을 만들어 "다른 앱 schema 접근 불가" 를 강제해요 |
| pg_dump | Postgres 백업 도구. SQL 스크립트로 스키마와 데이터를 덤프해요 |
| Supabase | 클라우드 Postgres·Auth·Storage 서비스. 이 레포는 Supabase Pooler 를 경유해 Postgres 부분만 사용해요 |
| Supabase Pooler | PgBouncer 기반의 연결 풀러. 짧은 트랜잭션용 transaction mode 와 긴 세션용 session mode 두 가지가 있고 각각 특성이 달라요 |
| N+1 쿼리 문제 | JPA 에서 목록을 가져온 후 각 항목의 연관 객체를 하나씩 추가 쿼리로 가져오는 성능 이슈예요. fetch join 또는 배치 로딩으로 해결해요 |
| Baseline (Flyway) | 이미 구축된 schema 의 version checkpoint. 신규 환경에선 V001 부터, 기존 환경엔 baseline 위 마이그레이션부터 실행해요 |
| Validate-only (Flyway) | 마이그레이션을 실행하지 않고 checksum 과 history 검증만 수행해요. 운영 환경 안전 모드예요 ([`ADR-033`](../philosophy/adr-033-flyway-hybrid-policy.md)) |
| Checksum (Flyway) | 마이그레이션 파일의 무결성 체크값. 파일 수정을 감지해서, 이미 실행된 V 파일이 변경되면 부팅이 실패해요 |
| AbstractRoutingDataSource | Spring 의 다중 DataSource 라우팅 클래스. 요청에서 appSlug 를 읽어 올바른 schema 의 DataSource 로 연결해요. 이 레포의 `SchemaRoutingDataSource` 가 이걸 상속해요 ([`ADR-018`](../philosophy/adr-018-schema-routing-datasource.md)) |

## 인증 / 보안

| 용어 | 설명 |
|---|---|
| JWT (JSON Web Token) | 로그인 후 받는 서명된 문자열이에요. 서버가 "이 토큰을 가진 사람 = 유저 42번" 이라는 걸 매 요청마다 암호학적으로 검증할 수 있어요 |
| Access Token | 짧은 수명의 JWT 예요. 이 레포는 15분이에요. API 호출할 때마다 `Authorization: Bearer <token>` 헤더로 전송해요 |
| Refresh Token | 긴 수명의 토큰이에요. 이 레포는 30일이에요. Access 가 만료되면 이걸로 새 Access 를 발급받아요 |
| Bearer Token | HTTP 헤더 포맷 `Authorization: Bearer <token>`. RFC 6750 표준이에요 |
| HS256 vs RS256 | JWT 서명 알고리즘이에요. HS256 은 한 비밀키로 서명과 검증을 하는 대칭키 방식이고, RS256 은 개인키로 서명하고 공개키로 검증하는 비대칭키 방식이에요. 이 레포는 HS256 을 써요 ([`ADR-006`](../philosophy/adr-006-hs256-jwt.md)) |
| jjwt | Java JWT 라이브러리. 이 레포가 사용하는 것이에요 |
| BCrypt | 비밀번호 해싱 알고리즘. 원본 비밀번호를 DB 에 저장하지 않고 해시만 저장해요 |
| OAuth / OpenID | 제3자 로그인 표준. "구글 계정으로 로그인" 같은 플로우예요 |
| Apple Sign In / Google Sign In | 각각 Apple 과 Google 이 제공하는 OAuth 구현이에요 |
| RBAC (Role-Based Access Control) | "이 역할은 이 리소스에 접근 가능" 형태의 권한 모델. 이 레포의 관리자 API 에서 사용해요 |
| Cloudflare Access | Cloudflare 의 Zero-Trust 접근 제어. 관리자 전용 엔드포인트에 "구글 계정으로 인증해야 통과" 같은 정책을 부여해요 |
| TLS / HTTPS | 전송 구간 암호화. CF Tunnel 이 edge 에서 처리하므로 내부 구간은 평문이 가능한 trade-off 가 있어요 |
| SPF / DKIM | 메일 서버가 "이 메일이 정당한 발신자로부터 왔다" 고 증명하는 DNS 레코드예요. 이 레포는 Resend 를 통해 자동 구성해요 |
| JWS (JSON Web Signature) | JWT 의 상위 개념. payload 와 signature 구조예요. Apple App Store webhook 이 JWS 형식으로 전송돼요 ([`ADR-022`](../philosophy/adr-022-iap-server-notifications.md)) |
| JWKS (JSON Web Key Set) | 공개키 집합 endpoint. Apple·Google 같은 OAuth provider 가 자기 공개키를 JWKS URL 로 노출하고, 서버가 RS256 JWT 서명을 검증할 때 가져가요 |
| Audience (JWT claim, `aud`) | JWT 의 수신자 식별 claim. OAuth 토큰 검증 시 우리 앱 ID 와 일치하는지 확인해요. audience 가 다르면 다른 앱의 토큰이에요 |
| Webhook signature | webhook 요청의 인증 도장. 외부 서비스가 비밀키로 서명하고 우리 서버가 검증해서 정당한 발신자인지 확인해요 |
| Service Account (Google Cloud) | Google Cloud 의 서비스용 계정으로 사람이 아니에요. Pub/Sub webhook 인증 주체이고 `@my-project.iam.gserviceaccount.com` 형식이에요 |
| TOTP (Time-based One-Time Password) | 2FA 표준이에요. RFC 6238 기반이고 30초마다 갱신되는 6자리 코드예요. Google Authenticator, Authy 등과 호환돼요 ([`ADR-030`](../philosophy/adr-030-2fa-totp.md)) |
| Backup codes | 2FA 비상용 일회성 코드. TOTP 기기를 분실했을 때 로그인 수단이에요. 8개를 발급하고 사용 후 무효화해요 |

## 운영 / 인프라

| 용어 | 설명 |
|---|---|
| Docker | 앱을 컨테이너로 패키징하는 도구. 내 Mac 에서 돌던 게 리눅스 서버에서도 동일하게 돌게 해줘요 |
| Docker Compose | 여러 컨테이너를 한 번에 띄우는 도구. `docker-compose up` 한 줄로 Postgres, MinIO, 내 앱을 동시에 기동해요 |
| GHCR (GitHub Container Registry) | GitHub 이 제공하는 Docker 이미지 저장소. 이 레포의 이미지가 여기 푸시돼요 |
| Kamal | Rails 생태계에서 나온 배포 도구. Docker, SSH, 작은 설정 파일로 blue/green 배포를 해요 |
| kamal-proxy | Kamal 의 리버스 프록시. Blue/Green 전환 시 트래픽 스위칭을 담당해요 |
| Blue/Green 배포 | 무중단 배포 방식. 기존 버전인 Blue 가 도는 동안 새 버전인 Green 을 띄우고, 준비되면 순간 전환해요. Blue 는 graceful shutdown 으로 내려요 |
| Graceful Shutdown | 서버를 끌 때 새 요청은 안 받되 처리 중인 요청은 끝낸 후 종료해요. Spring `server.shutdown=graceful` 과 `timeout-per-shutdown-phase=30s` 로 설정해요 |
| Liveness Probe / Readiness Probe | "서버가 살아있나" 와 "트래픽 받을 준비 됐나" 를 주기적으로 확인하는 엔드포인트예요. 이 레포는 `/actuator/health/liveness` 와 `/actuator/health/readiness` 를 써요 |
| Actuator | Spring Boot 의 운영 엔드포인트 모음. health, metrics, info 등을 `/actuator/*` 로 노출해요 |
| Cloudflare Tunnel (cloudflared) | 집 서버의 공인 IP 노출 없이 Cloudflare 를 통해 인터넷에 서비스를 공개하는 도구. 이 레포는 맥미니 홈서버 배포에 사용해요 |
| CDN (Content Delivery Network) | 전 세계 엣지 서버에서 콘텐츠를 캐시하고 서빙해요. Cloudflare 가 이 레포의 CDN 이에요 |
| launchd | macOS 의 서비스 관리자로 리눅스 systemd 와 비슷해요. 이 레포는 cloudflared 부팅 시 자동 실행에 사용해요 |
| Tailscale | Zero-Config VPN. 이 레포는 맥미니와 NAS 의 내부망 연결에 활용해요 |
| NAS (Network Attached Storage) | 네트워크 저장소. 이 레포는 Synology NAS 를 백업 대상으로 사용해요 |
| Synology | NAS 제조사. `backup-to-nas.sh.example` 의 대상이에요 |
| FCM (Firebase Cloud Messaging) | 구글 푸시 알림 서비스. iOS 와 Android 양쪽 모두 지원해요 |
| APNs (Apple Push Notification service) | Apple 의 푸시 서비스. FCM 이 내부적으로 APNs 를 호출해요 |
| Resend | 트랜잭셔널 이메일 서비스. 이 레포는 이메일 인증 코드 발송에 사용해요 |
| S3 / MinIO | 파일 업로드용 오브젝트 스토리지. S3 는 Amazon, MinIO 는 S3 호환 오픈소스예요. 이 레포는 MinIO 또는 Cloudflare R2 를 써요 |
| Cloudflare R2 | Cloudflare 의 S3 호환 오브젝트 스토리지. Egress 비용이 무료인 게 특징이에요 |
| Webhook | "이벤트가 발생하면 지정한 URL 로 HTTP POST" 하는 콜백 메커니즘. GitHub Actions, Discord 알림 등에 사용해요 |
| Discord Webhook | Discord 채널에 메시지를 자동 전송하는 URL. 이 레포는 알림 채널로 활용해요 |
| Idempotency key | 같은 요청을 여러 번 받아도 한 번만 처리하기 위한 식별자. webhook 중복 수신을 막아요. 이 레포는 `payment_webhook_events` 테이블의 `(source, externalId)` 복합 UNIQUE 로 보장해요 |
| Feature toggle / Lite mode | 기능을 켜고 끄는 플래그. `app.features.<X>=true|false` 환경변수로 도메인 단위 활성화를 제어해요. 작은 비즈니스용 Lite mode 를 지원해요 ([`ADR-034`](../philosophy/adr-034-feature-toggle-lite-mode.md)) |
| SPEL (Spring Expression Language) | Spring 설정에서 쓰는 조건문·표현식 언어. `@ConditionalOnExpression("${a} and ${b}")` 같이 두 flag 를 AND/OR 로 조합해요 |

## 결제 / IAP / 구독

| 용어 | 설명 |
|---|---|
| PG (Payment Gateway) | 카드 결제 중개 서비스. 한국에선 PortOne 이 나이스·토스·이니시스 같은 여러 PG 를 통합 제공해요 |
| PortOne | 한국형 결제 통합 SDK·콘솔. v1 API base URL 은 `api.iamport.kr` 이에요. 옛 iamport 시절 명세를 따르고 본 레포는 v1 을 사용해요 ([`ADR-019`](../philosophy/adr-019-billing-iap-payment-separation.md)) |
| IAP (In-App Purchase) | 앱 스토어 내결제. Apple App Store 와 Google Play 가 결제를 처리하고 수수료 30% 를 차감해요. 앱 스토어 정책상 외부 PG 는 사용할 수 없어요 |
| Subscription / Renewal | 정기 구독 모델. 월·년 단위로 자동 갱신돼요. 본 레포 `BillingPort` 의 핵심 도메인이에요 ([`ADR-020`](../philosophy/adr-020-subscription-domain-model.md), [`ADR-021`](../philosophy/adr-021-renewal-failure-policy.md)) |
| RTDN (Real-Time Developer Notifications) | Google Play 의 결제 webhook. 갱신·환불·취소 같은 구독 상태 변화를 Google Pub/Sub 로 실시간 push 해요 ([`ADR-022`](../philosophy/adr-022-iap-server-notifications.md)) |
| App Store Server Notifications V2 | Apple 의 결제 webhook 으로 RTDN 의 Apple 버전이에요. JWS 형식이고 SignedDate, SignedTransactionInfo 를 검증해요 |
| OPT-IN / OPT-OUT | 기능 활성화 정책이에요. opt-in 은 사용자가 명시적으로 켜야 활성화돼요. 2FA 가 그 예예요. opt-out 은 기본 활성화이고 사용자가 꺼야 비활성화돼요. 결제 알림이 그 예예요 |

## CI / 배포 파이프라인

| 용어 | 설명 |
|---|---|
| GitHub Actions (GHA) | GitHub 의 CI/CD. 이 레포의 빌드·테스트·배포 자동화를 맡아요 |
| workflow_run trigger | 한 워크플로우가 끝나면 다른 워크플로우를 트리거해요. 이 레포는 "test 성공 → build+push → deploy" 체인에 사용해요 |
| PAT (Personal Access Token) | GitHub 의 개인 토큰. 워크플로우 간 권한 승계, 외부 도구 인증에 사용해요 |
| Artifact | GHA 빌드 산출물이에요. JAR, 로그, 리포트 등을 다른 job 으로 전달할 수 있어요 |
| CI (Continuous Integration) | 코드를 push 할 때마다 자동으로 빌드하고 테스트해요 |
| CD (Continuous Deployment) | CI 통과 시 자동으로 배포해요 |

## 관측성 / 로깅

| 용어 | 설명 |
|---|---|
| Prometheus | 시계열 메트릭 수집 도구. 주기적으로 앱의 `/actuator/prometheus` 를 긁어가요(scrape) |
| Grafana | 메트릭 시각화 대시보드. Prometheus 와 Loki 를 소스로 차트·알람을 구성해요 |
| Loki | 로그 수집 도구로 Prometheus 와 같은 철학이에요. 이 레포는 retention 을 14일로 둬요 |
| Alertmanager | Prometheus 알람 라우팅. 조건을 만족하면 Discord, Email 등으로 발송해요 |
| Micrometer | Spring Boot 의 메트릭 추상화. Prometheus, Datadog 등 여러 백엔드를 지원해요 |
| MDC (Mapped Diagnostic Context) | 로그에 요청별 컨텍스트인 requestId, userId 등을 자동 주입하는 SLF4J 기능이에요 |
| logback | Java 표준 로깅 라이브러리. Spring Boot 기본이에요 |
| Scrape | Prometheus 가 메트릭을 긁어가는 행위. pull 방식이에요 |
| RPS (Requests Per Second) | 초당 요청 수예요 |
| p95 / p99 | 응답 시간 분포의 95·99 백분위수. "전체 요청 중 95% 가 N ms 이내 응답" 을 의미해요 |
| SLA (Service Level Agreement) | 서비스 수준 약속이에요. 가용성 99.9% 같은 지표를 말해요 |

## 테스팅

| 용어 | 설명 |
|---|---|
| JUnit 5 | Java 테스트 프레임워크. `@Test` 어노테이션 기반이에요 |
| @Nested | JUnit 5 의 테스트 클래스 중첩. given-when-then 구조화에 사용해요 |
| AssertJ | 유창한 assert 라이브러리. `assertThat(result).isEqualTo(expected).hasSize(3)` 같은 체이닝을 써요 |
| Mockito | Java 모킹 라이브러리. `when().thenReturn()`, `verify()` 등을 제공해요 |
| ArgumentCaptor | Mockito 의 호출 인자 캡처 도구. "실제로 어떤 값으로 호출됐는지" 를 검증해요 |
| Testcontainers | 테스트에서 진짜 Postgres, MinIO 등을 Docker 로 띄우는 라이브러리. Mock 대신 실제 DB 로 통합 테스트를 해요 |
| @SpringBootTest | Spring ApplicationContext 전체를 띄우는 통합 테스트 어노테이션이에요 |
| @DataJpaTest | JPA 레이어만 띄우는 슬라이스 테스트. H2 가 기본이지만 이 레포는 Testcontainers Postgres 를 써요 |
| @TestConfiguration | 테스트 전용 Bean 정의. 프로덕션 코드에는 영향이 없어요 |
| @ActiveProfiles | 테스트에서 사용할 Spring 프로파일을 지정해요. `@ActiveProfiles("test")` 처럼 써요 |
| @Sql | 테스트 전후로 SQL 파일을 실행해요. 시드 데이터 로드에 사용해요 |
| @DynamicPropertySource | Testcontainers 가 띄운 컨테이너의 동적 포트 주소를 Spring 설정에 주입해요 |
| Contract Testing | API 응답의 JSON 계약을 테스트로 고정해요. 필드 이름이 바뀌면 테스트가 깨져요 ([`production/test/contract-testing`](../production/test/contract-testing.md)) |
| Integration Test | 여러 컴포넌트를 실제로 엮어서 돌리는 테스트. 이 레포는 Testcontainers Postgres 가 필수예요 |
| Delegation Mock | "A 가 B 를 호출하는지" 만 확인하는 테스트로 껍데기만 검증해요. 이 레포는 금지해요 ([`ADR-014`](../philosophy/adr-014-no-delegation-mock.md)) |
| Round-trip | JSON 직렬화와 역직렬화의 왕복 테스트. 필드 손실이나 추가를 막아요 |
| Canonical JSON | 정규화된 JSON 표현이에요. 키 정렬, 공백 제거를 거치고 계약 테스트의 비교 기준이 돼요 |
| Fake Adapter | 테스트용 Port 구현체. HTTP 호출 대신 in-memory 로 구현해요. `InMemoryEmailAdapter` 가 그 예예요. Mock 과 달리 진짜로 동작하므로 호출 횟수가 아니라 결과 상태를 검증해요 ([`ADR-014`](../philosophy/adr-014-no-delegation-mock.md)) |

## 코드 패턴

| 용어 | 설명 |
|---|---|
| Sealed Interface / Sealed Class | Java 17 이상의 "허용된 하위 타입만 구현하거나 상속 가능" 한 인터페이스·클래스. 도메인 타입 제한에 사용해요 |
| Record | Java 14 이상의 불변 데이터 클래스. `record User(Long id, String name) {}` 한 줄로 생성자, getter, equals, hashCode 가 자동 생성돼요 |
| DTO (Data Transfer Object) | 계층 간 데이터 전송 객체. 이 레포는 Record 로 선언하고 Mapper 는 금지해요 ([`ADR-016`](../philosophy/adr-016-dto-mapper-forbidden.md)) |
| DTO Factory | Entity → DTO 변환을 Entity 의 인스턴스 메서드 `to<Dto>()` (예: `user.toProfile()`) 로 처리하는 패턴. Mapper 를 대체해요. Entity 를 받는 DTO 쪽 static factory 는 금지예요 ([`dto-factory`](../convention/dto-factory.md)) |
| SOLID | 객체지향 설계 5원칙. SRP, OCP, LSP, ISP, DIP 를 말해요 |
| Idempotent (멱등) | 같은 요청을 여러 번 보내도 결과가 같은 연산. PUT, DELETE 가 전형적이에요 |
| Ephemeral | "일회성, 휘발성" 을 뜻해요. 테스트 컨테이너, 임시 토큰 등에 쓰는 용어예요 |

## 라이브러리 / SDK

| 용어 | 설명 |
|---|---|
| Jackson | Java 의 JSON 직렬화 표준. Spring Boot 기본이에요 |
| Bucket4j | Java Rate Limiting 라이브러리. Token Bucket 알고리즘을 써요. 이 레포는 모든 요청에 기본 한도(defaultRpm)를 적용하고, signup·signin·소셜 로그인·비밀번호 재설정 같은 민감 엔드포인트에는 더 엄격한 한도(strictRpm)를 걸어요. 민감 엔드포인트는 요청 경로의 접미사 매칭으로 판별해요 |
| springdoc-openapi | Spring Boot 자동 OpenAPI 문서 생성기. `/v3/api-docs` 와 Swagger UI 를 제공해요. 버전은 `gradle/libs.versions.toml` 에, 노출 경로는 `application.yml` 의 springdoc 설정에 정의돼 있어요 |
| Firebase Admin SDK | 서버에서 FCM 을 호출할 때 쓰는 Java SDK 예요 |
| ArchUnit | 아키텍처 규칙을 코드로 테스트하는 라이브러리. "core-api 는 JPA 의존 금지" 같은 걸 컴파일·테스트 레벨에서 강제해요 ([`ADR-004`](../philosophy/adr-004-gradle-archunit.md)) |

## 아키텍처 용어

| 용어 | 설명 |
|---|---|
| Modular Monolith | "한 프로세스 안에 여러 모듈이 공존하되 모듈 간 경계를 강제" 하는 구조. 마이크로서비스의 복잡함 없이 그 이점 일부를 얻어요. 이 레포의 핵심 철학이에요 ([`ADR-001`](../philosophy/adr-001-modular-monolith.md)) |
| Microservice | 앱을 작은 서비스 여러 개로 쪼개서 각자 배포하고 운영해요. 대규모 팀에 유리하지만 솔로에는 과해요 |
| Hexagonal Architecture (Port / Adapter) | 비즈니스 로직인 Port 와 외부 연결인 Adapter 를 분리해요. 이 레포의 `-api` 와 `-impl` 구조가 이것이에요 ([`ADR-003`](../philosophy/adr-003-api-impl-split.md), [`ADR-011`](../philosophy/adr-011-layered-port-adapter.md)) |
| Layered Architecture | Controller → Service → Repository 계층형 구조. 이 레포는 Hexagonal 과 결합해요 |
| Multitenant (멀티테넌트) | 한 서버·DB 에서 여러 테넌트(앱)의 데이터를 분리해 서비스하는 구조. 이 레포는 schema-per-app 방식이에요 |
| Tenant | 멀티테넌트 구조의 각 격리 단위. 본 레포에서는 slug 단위의 한 앱이 한 tenant 예요. tenant 별로 schema, role, bucket, DataSource 가 격리돼요 |
| Audit log | 관리자 환불, role 변경 같은 사용자 행동 기록. 준법성·보안 추적용이에요. AOP `@Audited` 어노테이션과 AuditAspect 로 자동 기록해요 ([`ADR-028`](../philosophy/adr-028-audit-log-domain.md)) |
| Port / Adapter | Hexagonal Architecture 의 핵심 패턴이에요. Port 는 인터페이스 contract 인 `AuthPort` 같은 것이고, Adapter 는 `AuthServiceImpl`, `ResendEmailAdapter` 같은 외부 시스템 어댑터 구현체예요. 본 레포의 `-api` 와 `-impl` 모듈 분리가 이걸 강제해요 |

## 개발 프로세스

| 용어 | 설명 |
|---|---|
| Conventional Commits | 커밋 메시지 포맷 `type(scope): subject` 예요. 예를 들어 `feat(auth): add Apple Sign In` 처럼 쓰고, 기계가 읽어서 릴리스 노트를 자동 생성할 수 있어요 ([`ADR-015`](../philosophy/adr-015-conventional-commits-semver.md)) |
| SemVer (Semantic Versioning) | 버전 번호 규칙 `MAJOR.MINOR.PATCH` 예요. Breaking change 면 major, 기능 추가면 minor, 버그 수정이면 patch 를 올려요 |
| Cherry-pick | git 에서 "특정 커밋만 뽑아서 다른 브랜치에 적용" 해요. 이 레포가 템플릿에서 파생 레포로 개선을 전파할 때 사용해요 |
| Husky | git hook 관리 도구. 커밋할 때 commitlint 를 자동 실행해요 |
| Commitlint | 커밋 메시지 포맷 검증 도구. `chore: foo` 같은 타입을 강제해요 |
| Commitizen | 대화형 Conventional Commits 작성 도구. `cz` 명령으로 type, scope, subject 를 단계별로 입력해요 |

## 이 레포 고유 용어

| 용어 | 설명 |
|---|---|
| 템플릿 레포 | `template-spring`, 즉 본 레포예요. GitHub Template Repository 라서 "Use this template" 버튼으로 복제돼요 |
| 파생 레포 | 템플릿 레포를 "Use this template" 으로 만든 본인 프로젝트 레포예요. `sumtally-backend` 가 그 예예요 |
| 앱 모듈 | `apps/app-<slug>` 디렉토리. 한 모바일 앱의 도메인 로직을 담아요. 템플릿엔 비어 있고 파생 레포에서 생성해요 |
| appSlug | 앱 식별자 문자열. URL `/api/apps/{appSlug}/...`, DB schema 이름, JWT claim 에 일관되게 사용해요 |
| 도그푸딩 (dogfooding) | "자기 제품을 자기가 써보기". 이 레포는 템플릿 자체를 실제 프로젝트로 돌려서 작동을 검증해요 |
| template-v* 태그 | 템플릿 레포의 버전 태그예요. `template-v0.3.0` 처럼 쓰고, 파생 레포는 "v0.3.0 기반" 이라고 단일 버전으로 추적해요 |
| Slug | URL·schema 안전 식별자. 소문자, 숫자, 하이픈만 쓰고 `[a-z][a-z0-9-]*` 형태예요. `sumtally`, `gym-log` 가 그 예예요. 본 레포의 appSlug 가 이 형태예요 |
| 4-stage secret chain | 본 레포의 secret 동기화 패턴. `.env.prod`(1) → `config/deploy.yml` 의 env.secret(2) → `.kamal/secrets.example`(3) → `.github/workflows/deploy.yml` 의 env(4) 순서예요. 한 단계라도 누락하면 운영 부팅이 차단돼요 |
| Bucket prefix policy | S3·MinIO 의 격리 정책. 본 레포는 `<slug>-<category>` 컨벤션을 써요. `gymlog-uploads` 가 그 예예요. 슬러그가 prefix 라 다른 앱 bucket 접근을 차단할 수 있어요 |
