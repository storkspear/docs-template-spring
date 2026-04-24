# ADR-006 · HS256 JWT (대칭키)

**Status**: Accepted. 2026-04-24 기준 `common-security/jwt/JwtService.java` 에서 HS256 로 발급/검증. jjwt 0.13.0 사용. 서명 키는 환경변수 `JWT_SECRET` 주입. 로테이션 전략은 `docs/infra/key-rotation.md` 에 기록.

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~5분

## 결론부터

우리가 쓰는 JWT 는 **가장 단순한 서명** 방식인 HS256 (대칭키) 입니다. 비밀 키 **하나** 로 서명도 하고 검증도 해요. 공개키/개인키 쌍 같은 비대칭 구조는 없어요. 이유는 단 하나 — 우리는 **한 JVM 프로세스 안에서** 토큰을 만들고 같은 프로세스에서 검증하기 때문. 마이크로서비스가 여러 개 있고 각자가 토큰을 **독립적으로 검증** 해야 하는 상황이 아니라면, RS256 의 공개키 배포 이점은 쓸 데가 없어요. access 는 15분, refresh 는 30일. claims 는 `sub / email / appSlug / role / iss / iat / exp`.

## 왜 이런 고민이 시작됐나?

[ADR-001 (모듈러 모놀리스)](./adr-001-modular-monolith.md) 에서 우리는 **한 JAR, 한 프로세스** 로 운영 단위를 1개로 묶기로 했어요. 이 전제 위에서 JWT 서명 알고리즘을 고를 때의 선택지는 크게 둘입니다.

### 대칭키 계열 (HSnnn)

- 하나의 비밀 키로 **서명과 검증을 모두** 함
- 서명자 = 검증자 — 비밀 키를 공유할 수 있어야 함
- 예: HS256, HS384, HS512

### 비대칭키 계열 (RSnnn, ESnnn)

- 개인키로 **서명**, 공개키로 **검증**
- 서명자만 개인키 보유, 검증자는 공개키만 있으면 됨
- 공개키를 여러 서비스에 배포 가능
- 예: RS256 (RSA), ES256 (ECDSA)

비대칭키의 핵심 가치는 **"검증자가 여러 곳"** 일 때 발휘됩니다:

- 인증 서버가 토큰 발급
- 각 마이크로서비스가 **독립적으로** 그 토큰을 검증 (공개키만 있으면 됨)
- JWKS 엔드포인트로 공개키 회전 자동화

우리 상황은 다음과 같아요:

- **단일 JVM**: 토큰 발급 Controller 와 검증 Filter 가 **같은 프로세스** 에서 돌아감
- **공유 가능한 상태**: `JwtService` Bean 하나가 발급과 검증을 모두 담당
- **JWKS 불필요**: 공개키를 배포할 대상 자체가 없음

이 결정이 답할 물음은 이거예요.

> **단일 JVM 모놀리스에서 JWT 서명 알고리즘을 고른다면, 비대칭키의 복잡도를 감수할 이유가 있는가?**

## 고민했던 대안들

### Option 1 — RS256 (비대칭키 RSA 2048)

개인키로 서명, 공개키로 검증. 마이크로서비스 표준.

- **장점**:
  - 공개키는 유출되어도 토큰 위조 불가 (개인키만 안전하면 됨)
  - JWKS 엔드포인트로 키 로테이션을 유저 앱 재배포 없이 가능
  - OAuth2 / OpenID Connect 생태계 표준
- **단점**:
  - **키 관리 복잡도 2배** — 개인키 + 공개키 쌍 관리. JWKS endpoint 운영 (캐싱, 만료).
  - **서명 속도 느림** — HS256 대비 10~50배 느림 (RSA 연산). 우리 요청량에선 무시 가능하지만 이득도 없음.
  - **토큰 크기 증가** — RSA 2048 서명은 256 바이트, HS256 은 32 바이트. access 토큰 헤더 사이즈 영향.
  - **우리에겐 사용할 곳 없음** — 공개키를 배포할 "다른 서비스" 가 존재하지 않음
- **탈락 이유**: 관리 비용 증가 + 속도 손해 vs 이득 0. 마이크로서비스 전환 시점이 오면 그때 이행하면 됨 (Deprecation 경로 열려 있음).

### Option 2 — HS512 (더 긴 대칭키 서명)

HS256 의 SHA-256 대신 SHA-512. 서명 길이 256 비트 → 512 비트.

- **장점**:
  - 이론적으로 충돌 저항성 ↑ (실제로 HS256 도 충분)
  - 일부 보안 감사에서 "더 길면 더 좋다" 로 선호
- **단점**:
  - 서명 크기 2배 (토큰 전체 크기 ↑)
  - 연산 속도 느려짐 (유의미 차이 없음)
  - **HS256 이 암호학적으로 이미 충분** — 현재 컴퓨팅 능력으로 HMAC-SHA256 을 brute-force 하는 건 비현실적
- **탈락 이유**: 실질 보안 이득 없이 토큰 크기만 증가. 과잉 엔지니어링.

### Option 3 — HS256 (HMAC-SHA256 대칭키) ★ (채택)

JWT 표준 기본 알고리즘. 하나의 비밀 키로 서명/검증 모두.

- **장점**:
  - **관리 대상 = 비밀 키 1개** — 환경변수 `JWT_SECRET` 하나면 끝
  - **충분한 보안** — 32자 이상 랜덤 문자열이면 brute-force 비현실적
  - **jjwt 라이브러리 기본 경로** — `Jwts.SIG.HS256` 한 줄
  - **토큰 크기 최소** — 서명 32 바이트, 전체 access 토큰 200~300 바이트 수준
  - **단일 JVM 모델과 완전 정합** — 발급자-검증자가 같은 프로세스 (Bean 하나가 양쪽 담당)
- **단점**:
  - 비밀 키가 유출되면 **누구든 토큰 위조 가능** — 시크릿 관리 실수의 결과가 큼
  - 검증자가 여러 서비스면 비밀 키를 공유해야 함 (마이크로서비스로 가는 날의 부담)
- **채택 이유**:
  - 현재 아키텍처 (단일 JVM) 와 완전 정합
  - 단점은 시크릿 관리 + 미래 이행 경로로 해결 가능
  - [제약 2](./README.md#제약-2--시간이-가장-희소한-자원) (운영 단순성) 에 최적

## 결정

### 의존성

```gradle
// common/common-security/build.gradle
implementation 'io.jsonwebtoken:jjwt-api:0.13.0'
runtimeOnly 'io.jsonwebtoken:jjwt-impl:0.13.0'
runtimeOnly 'io.jsonwebtoken:jjwt-jackson:0.13.0'
```

### 토큰 수명

| 토큰 | TTL | 근거 |
|---|---|---|
| access | 15분 (`PT15M`) | 짧을수록 탈취 피해 최소. 15분이면 유저 UX 저해 없음 + refresh 로 투명 갱신 |
| refresh | 30일 (`P30D`) | 재로그인 주기. "거의 매달 한 번은 로그인" 수준이 합리적 |

### 서명 + claim 구조

```java
// JwtService.issueAccessToken 발췌
return Jwts.builder()
    .subject(String.valueOf(userId))
    .claim("email", email)
    .claim("appSlug", appSlug)       // ADR-012 의 단일 appSlug
    .claim("role", role)
    .issuer(properties.issuer())
    .issuedAt(Date.from(now))
    .expiration(Date.from(expiresAt))
    .signWith(signingKey, Jwts.SIG.HS256)
    .compact();
```

claims 전체 목록:

| claim | 출처 | 용도 |
|---|---|---|
| `sub` | userId (Long → String) | JWT 표준 subject |
| `email` | 사용자 이메일 | 로깅 / 감사 편의 |
| `appSlug` | 앱 슬러그 (단일) | [ADR-012](./adr-012-per-app-user-model.md) 의 경계 강제 |
| `role` | 유저 role ("USER", "ADMIN") | Spring Security 권한 부여 |
| `iss` | `JWT_ISSUER` 환경변수 | 발급처 검증 |
| `iat` | 발급 시각 | 표준 |
| `exp` | 만료 시각 | 표준 |

### 비밀 키 관리

```yaml
# bootstrap/src/main/resources/application-prod.yml
app:
  jwt:
    secret: ${JWT_SECRET}           # 기본값 없음 — 누락 시 부트 실패
    access-token-ttl: PT15M
    refresh-token-ttl: P30D
    issuer: ${JWT_ISSUER:app-factory}
```

```yaml
# bootstrap/src/main/resources/application-dev.yml
app:
  jwt:
    secret: ${JWT_SECRET:dev-secret-that-is-at-least-32-characters-long-for-testing}
    # ...
```

- **prod**: 환경변수 주입 필수. 누락 시 즉시 부트 실패.
- **dev**: 개발 편의를 위한 고정 기본값 (32자 이상). 프로덕션 키 아님.

```java
// JwtProperties compact constructor — 부팅 시 길이 검증
public JwtProperties {
    Objects.requireNonNull(secret, "JWT secret is required");
    if (secret.length() < 32) {
        throw new IllegalStateException(
            "JWT secret must be at least 32 characters (HS256 requires 256 bits)");
    }
}
```

### 검증 경로 — `JwtAuthFilter`

```java
// common-security/jwt/JwtAuthFilter.java 발췌
String token = header.substring(BEARER_PREFIX.length()).trim();
try {
    AuthenticatedUser user = jwtService.validateAccessToken(token);
    UsernamePasswordAuthenticationToken auth = new UsernamePasswordAuthenticationToken(
        user, null,
        List.of(new SimpleGrantedAuthority("ROLE_" + user.role().toUpperCase())));
    SecurityContextHolder.getContext().setAuthentication(auth);
} catch (CommonException e) {
    SecurityContextHolder.clearContext();
    // JsonAuthenticationEntryPoint 가 401 로 변환
}
```

검증 단계:

1. **Bearer prefix 파싱** (RFC 6750) — `Authorization: Bearer <token>`
2. **서명 검증** (`verifyWith(signingKey)`)
3. **issuer 검증** (`requireIssuer(properties.issuer())`)
4. **만료 검증** — `ExpiredJwtException` 처리 (`ACCESS_TOKEN_EXPIRED`)
5. **기타 예외** — `JwtException` (위변조, malformed) (`ACCESS_TOKEN_INVALID`)
6. 성공 시 `SecurityContextHolder` 에 `AuthenticatedUser` 주입

### 키 로테이션 전략

`docs/infra/key-rotation.md` 에 상세. 요약:

- **주기**: 6개월 권장
- **grace period 없음** — 새 키로 교체 = 모든 기존 access/refresh 토큰 즉시 무효화 = 유저 재로그인 강제
- **회전 명령**: `openssl rand -base64 48 | tr -d '\n'` → `JWT_SECRET` 환경변수 업데이트 → 배포
- **긴급 회전 시**: 유출 의심 즉시 새 키 생성 및 배포. Supabase 대시보드에 공지.

## 이 선택이 가져온 것

### 긍정적 결과

**관리 대상 = 환경변수 1개** — `JWT_SECRET` 만 신경 쓰면 됨. 키 파일 관리, JWKS 엔드포인트 운영, 공개키 배포 — 전부 불필요. [제약 2](./README.md#제약-2--시간이-가장-희소한-자원) 에 최적.

**서명/검증 속도 무시 가능** — HS256 은 HMAC 이라 사실상 CPU cost 없음. JWKS fetching + RSA 검증의 수십 ms 대비 μs 수준.

**토큰 크기 작음** — 전체 access 토큰 ~250 바이트. HTTP 헤더 부담 최소.

**jjwt 0.13.x 모던 API 사용** — `.signWith(key, Jwts.SIG.HS256)` / `.verifyWith(key)` 형태로 타입 세이프. 0.11.x 까지 있던 deprecated API 없음.

**issuer claim 으로 교차 환경 오용 차단** — prod `JWT_ISSUER` 와 dev `JWT_ISSUER` 가 다르므로 dev 토큰을 prod 에 붙여도 `requireIssuer()` 에서 실패. 작은 방어선이지만 실수 방지 효과.

### 부정적 결과

**비밀 키 유출 = 전면 토큰 위조** — 유출 시 복구 방법은 키 교체뿐. 기존 유저 모두 재로그인 강제. 완화: 시크릿 관리 다층화 (`.env.prod` 커밋 금지 · GHA Secrets · ArchUnit 보안 규칙).

**마이크로서비스 전환 시 마이그레이션 필요** — 언젠가 앱을 별도 프로세스로 빼면 HS256 의 "비밀 키 공유" 모델이 부담. 그 시점에 RS256 + JWKS 로 이행 필요. 완화: JWT 발급 인터페이스 (`JwtService`) 를 추상화해두어 알고리즘 교체 시 구현체만 교체.

**grace period 없는 키 교체** — 유저가 갑자기 로그아웃당하는 UX 부작용. 완화: 키 교체를 정기 작업 (6개월) 으로 스케줄링 + 점검 공지. 긴급 교체는 드물어야 함.

### Apple Sign In 예외는 **다른 맥락**

`core-auth-impl/build.gradle` 에 RS256 관련 의존성이 있는데, 이건 **Apple Sign In 토큰 검증** 용입니다. Apple 이 발급한 identity token 을 우리가 받아서 검증할 때 Apple 의 공개키 (JWKS endpoint) 를 가져와 RS256 검증하는 것 — **우리 JWT 발급/검증과는 별개**입니다.

즉 **우리가 발급하는 JWT** = HS256 대칭키, **Apple 이 발급하는 JWT 를 검증할 때만** = RS256 (Apple JWKS). 이 구분은 중요해요 — 혼동하면 "왜 RS256 의존성이 있지?" 로 오해 가능.

## 교훈

### 32자 이상 검증을 compact constructor 에 박아둘 것

초기에 `JWT_SECRET=dev-secret` (11자) 으로 설정했더니 jjwt 가 내부에서 길이 불충분 에러를 던졌어요. 에러 메시지가 약간 모호해서 원인 파악에 시간 소요. 이후 `JwtProperties` compact constructor 에서:

```java
if (secret.length() < 32) {
    throw new IllegalStateException(
        "JWT secret must be at least 32 characters (HS256 requires 256 bits)");
}
```

로 **부팅 즉시** 명확한 메시지로 실패. HS256 이 요구하는 256 비트 키 = 32 바이트 = 문자열 32자 (ASCII 기준) 라는 정보가 에러 메시지에 포함되도록.

**교훈**: 보안 설정의 실수는 **최대한 이른 시점** 에서 **명확한 메시지** 로 터져야 함. 부팅 직후 > 첫 토큰 발급 시점 > 첫 검증 시점 > 프로덕션 후 발견.

### dev secret 기본값을 application-dev.yml 에 박아둘 것

dev 환경에서 `JWT_SECRET` 환경변수를 설정하지 않으면 매번 "Secret must be provided" 로 부트 실패 → 개발 시작마다 환경변수 설정하는 번거로움. 그래서 `application-dev.yml` 에:

```yaml
secret: ${JWT_SECRET:dev-secret-that-is-at-least-32-characters-long-for-testing}
```

이 `dev-secret-...` 은 **명백히 프로덕션 키가 아님을 이름으로 표명**. 실수로 prod 로 새어나가도 즉시 식별 가능. prod yml 에는 기본값 없음 (`${JWT_SECRET}` only) — prod 에서 환경변수 누락은 반드시 실패해야 함.

**교훈**: 개발 편의를 위한 기본값과 프로덕션 strict 모드는 **파일 단위로 분리**. 같은 파일에서 profile 조건부로 두면 실수 여지 있음.

### key-rotation 은 grace period 가 없으니 정기화할 것

"키를 교체하면 모든 유저가 로그아웃된다" 는 UX 충격이 크기 때문에 키 교체를 미루게 됨. 이걸 방지하려면:

- 6개월 단위 달력 등록 (운영 리마인더)
- 교체 시점에 "점검 공지" 를 앱 푸시로 미리 전송
- 로그아웃된 유저가 다시 로그인하면 새 키로 정상 발급 — 실제 장애 아님을 커뮤니케이션

**교훈**: HS256 의 "grace period 없음" 은 설계상 피할 수 없음. 운영 프로세스로 보완. `key-rotation.md` 에 전체 절차 문서화.

## 관련 사례 (Prior Art)

- **[RFC 7519 · JSON Web Token](https://datatracker.ietf.org/doc/html/rfc7519)** — JWT 표준. HS256 이 기본 알고리즘.
- **[RFC 7518 · JSON Web Algorithms](https://datatracker.ietf.org/doc/html/rfc7518)** — HS256 / HS512 / RS256 정의.
- **[RFC 6750 · Bearer Token Usage](https://datatracker.ietf.org/doc/html/rfc6750)** — `Authorization: Bearer <token>` 헤더 표준. 본 ADR 의 `JwtAuthFilter` 가 따름.
- **[OWASP · JWT Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html)** — HS256 vs RS256 선택 기준. 본 ADR 의 근거 출처 중 하나.
- **[Auth0 · When to Use Symmetric vs Asymmetric Algorithms](https://auth0.com/blog/rs256-vs-hs256-whats-the-difference/)** — "발급자=검증자면 HS256" 논리.
- **[jjwt Documentation](https://github.com/jwtk/jjwt)** — `Jwts.SIG.HS256`, `Keys.hmacShaKeyFor()`, `verifyWith()` 모던 API.

## Code References

**JWT 발급 / 검증**:
- [`JwtService.java`](https://github.com/storkspear/spring-backend-template/blob/main/common/common-security/src/main/java/com/factory/common/security/jwt/JwtService.java) — `issueAccessToken()` L42-56, `validateAccessToken()` L65-85
- [`JwtProperties.java`](https://github.com/storkspear/spring-backend-template/blob/main/common/common-security/src/main/java/com/factory/common/security/jwt/JwtProperties.java) — compact constructor 에서 32자 검증
- [`JwtAuthFilter.java`](https://github.com/storkspear/spring-backend-template/blob/main/common/common-security/src/main/java/com/factory/common/security/jwt/JwtAuthFilter.java) — Bearer 파싱 + 검증 + SecurityContext 주입

**의존성 / 설정**:
- [`common/common-security/build.gradle`](https://github.com/storkspear/spring-backend-template/blob/main/common/common-security/build.gradle) — jjwt 0.13.0
- [`bootstrap/src/main/resources/application-prod.yml`](https://github.com/storkspear/spring-backend-template/blob/main/bootstrap/src/main/resources/application-prod.yml) — prod strict 설정
- [`bootstrap/src/main/resources/application-dev.yml`](https://github.com/storkspear/spring-backend-template/blob/main/bootstrap/src/main/resources/application-dev.yml) — dev 기본값
- [`.env.example`](https://github.com/storkspear/spring-backend-template/blob/main/.env.example) — `JWT_SECRET` 생성 명령 포함

**로테이션 가이드**:
- [키 교체 절차 (Key Rotation)](../production/setup/key-rotation.md) — 6개월 주기, 교체 절차

**부재 확인 (HS256 only 검증)**:
- `grep -r "RS256"` 결과: core-auth-impl (Apple JWKS) 외 없음
- `PrivateKey` / `PublicKey` 사용: 없음
- JWKS endpoint 노출: 없음

**관련 ADR**:
- [ADR-001 · 모듈러 모놀리스](./adr-001-modular-monolith.md) — 단일 JVM 전제
- [ADR-012 · 앱별 독립 유저 모델](./adr-012-per-app-user-model.md) — `appSlug` claim 사용
- [ADR-013 · 앱별 인증 엔드포인트](./adr-013-per-app-auth-endpoints.md) — 이 JWT 를 사용하는 엔드포인트 구조
