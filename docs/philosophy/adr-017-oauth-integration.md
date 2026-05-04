# ADR-017 · OAuth 2.0 통합 (Google / Apple / Kakao / Naver)

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~8분

**Status**: Accepted. 현재 유효. 2026-04-28 기준 Google · Apple · Kakao · Naver 4 provider 모두 구현 완료. `core-auth-impl/service/{Google,Apple,Kakao,Naver}SignInService.java` + `AuthPort.signInWith{Google,Apple,Kakao,Naver}` + `AppCredentialProperties` 의 `googleClientIds` / `appleBundleId` / `kakaoAppId` / `naverClientId` 필드. WireMock 통합 테스트로 HttpClient 라이프사이클 검증.

## 결론부터

OAuth 소셜 로그인을 **provider 한 명을 추가할 때마다 같은 패턴을 복제** 하는 방식으로 통합해요. 각 provider 마다 (1) 클라이언트가 받은 토큰을 서버로 전달 → (2) 서버가 provider 공식 endpoint 로 토큰 검증 + audience(앱 식별자) 확인 → (3) `social_identities` 테이블 조회 후 신규/기존 분기 → (4) 우리 JWT 발급. DB 변경은 0 — `social_identities (provider, provider_id)` PK 가 이미 범용 설계.

## 왜 이런 고민이 시작됐나?

이메일/비밀번호 가입 외에 사용자가 익숙한 OAuth provider 로 즉시 로그인할 수 있어야 마찰이 줄어요. 그런데 OAuth 는 provider 마다 검증 방식 / 토큰 형태 / API 가 달라서 솔로 운영자가 매 앱마다 새로 짜면 ADR-007 (솔로 친화) 위반.

**힘 A — provider 별 검증 방식 차이**  
Google `id_token` 은 [`tokeninfo`](https://oauth2.googleapis.com/tokeninfo) 한 번 호출로 끝. Apple 은 JWKS 로 RS256 서명 직접 검증. Kakao 는 access token 두 endpoint (`/v1/user/access_token_info` + `/v2/user/me`) 호출 — 단일 호출로 app_id + email 모두 받지 못함. 즉 **공통 추상화는 어렵고, provider 패턴을 복제**하는 게 자연.

**힘 B — 앱별 credential 분리**  
한 백엔드 인스턴스가 N개 앱을 서비스해요 (ADR-005, ADR-012). 같은 Google id token 이라도 어느 앱에서 발급됐는지 audience (Google client id) 검증이 필요해요. Kakao 도 같은 access token 이라도 `app_id` 가 우리 앱과 일치해야 해요. 즉 **앱별 credential 매핑이 검증 로직의 핵심** 이에요.

**힘 C — 솔로 친화 (ADR-007)**  
provider 별 SDK 를 도입하지 않고 **HttpClient + JJWT** 만으로 구현. `spring-security-oauth2-client` 같은 라이브러리는 매 provider 별 설정 파일 + 흐름 (redirect URI 등) 을 강요하는데, 우리는 모바일 SDK 가 토큰을 받아 보낸다는 단순화로 의존성 0 유지.

이 결정이 답해야 했던 물음이에요.

> **OAuth provider 가 늘어날 때 (Google→Apple→Kakao→...) 매번 같은 패턴으로 추가 가능하되, 각 provider 의 미세 차이는 복제로 흡수하는 구조** 는?

## 고민했던 대안들

### Option 1 — Spring Security OAuth2 Client

`spring-boot-starter-oauth2-client` 도입. provider 별 application.yml 설정.

- **장점**: 표준 OAuth2 / OIDC 흐름 지원 (PKCE 등). 잘 알려진 패턴.
- **단점 1**: 모바일 앱 흐름과 미스매치 — 표준 OAuth2 는 redirect URI 기반 흐름. 모바일은 SDK 가 토큰을 받아 백엔드에 전달하는 단순한 흐름.
- **단점 2**: provider 별 추가 설정 (issuer URI, JWK Set URI 등) 이 application.yml 에 분산. 우리는 `AppCredentialProperties` 한 곳으로 모음.
- **단점 3**: Kakao 같은 비표준 provider (JWT 가 아닌 access token 기반 user info) 는 spring-security-oauth2 가 어색하게 처리.
- **탈락 이유**: 모바일 토큰 전달 방식에 무거운 라이브러리. 의존성 비용 vs 우리 직접 구현의 단순성 비교 시 직접이 우세.

### Option 2 — 단일 추상 `OAuthProvider` 인터페이스

`interface OAuthProvider { AuthResponse verify(String token, String appSlug); }` 같은 추상화 + Google/Apple/Kakao 구현체.

- **장점**: 새 provider 추가 시 인터페이스 구현만.
- **단점 1**: provider 별 토큰 형태 (id_token vs access_token), 검증 endpoint, audience 필드명 모두 달라 추상화 시그니처가 너무 일반적이거나 (`Map<String, Object>`) 너무 구체적 (provider 별 record). 결국 분기 로직이 `if (provider == "kakao")` 형태로 새로 들어감.
- **단점 2**: `AuthPort` 가 provider 별 메서드 (`signInWithGoogle`, `signInWithApple`, ...) 를 노출하는 게 클라이언트 입장에서 더 명확. 추상 `signIn(provider, token, ...)` 은 클라이언트가 잘못된 토큰 형태를 보낼 위험.
- **탈락 이유**: 추상화 비용 > 복제 비용. 솔로 친화 ADR-007 의 "단순함 우선".

### Option 3 — Provider 별 Service 클래스 복제 ★ (채택)

각 provider 마다 `*SignInService` 클래스. 동일 패턴 (token 검증 → social_identities 조회 → 신규/기존 분기 → JWT 발급) 을 따르되 provider API 차이는 클래스 안에서 흡수.

- **힘 A 만족**: provider 별 차이 (Google tokeninfo / Apple JWKS / Kakao 두 endpoint) 가 한 클래스에 캡슐화.
- **힘 B 만족**: `AppCredentialProperties.AppCredential` 에 `googleClientIds` / `appleBundleId` / `kakaoAppId` 필드. 앱별 검증.
- **힘 C 만족**: 의존성 0 (HttpClient + JJWT 만). 200~300 LOC / provider.

## 결정

### Provider 별 Service 클래스

```java
// 패턴 — 각 provider 가 자기 검증 로직 캡슐화
@Transactional
public class XxxSignInService {
    public AuthResponse signIn(XxxSignInRequest request) {
        // 1. 앱별 credential 조회
        AppCredential cred = credentialProperties.getByAppSlug(request.appSlug());
        
        // 2. provider 토큰 검증 (provider 별 다름)
        XxxTokenInfo info = verifyToken(request.token(), cred);
        
        // 3. social_identities 조회
        Optional<UserAccount> existing = userPort.findBySocialIdentity(PROVIDER, info.id());
        
        // 4-a. 기존 유저 → JWT 발급
        if (existing.isPresent()) {
            return loginExisting(existing.get(), request.appSlug());
        }
        
        // 4-b. 신규 유저 → 가입 + JWT 발급
        return registerNew(info, request.appSlug());
    }
}
```

### Provider 별 검증 차이

| Provider | 토큰 종류 | Endpoint | audience 검증 필드 | 호출 횟수 |
|---|---|---|---|---|
| Google | `id_token` (JWT) | `/tokeninfo?id_token=...` | `aud` ∈ `googleClientIds[]` | 1 |
| Apple | `identity_token` (JWT) | JWKS + 직접 RS256 검증 | `aud` == `appleBundleId` | 1 (JWKS 캐시) |
| Kakao | `access_token` (opaque) | `/v1/user/access_token_info` + `/v2/user/me` | `app_id` == `kakaoAppId` | 2 |
| Naver | `access_token` (opaque) | `/v1/nid/me` | (Naver 자체 검증) `naverClientId` 등록만 확인 | 1 |

Kakao 가 두 호출인 이유: `/v1/user/access_token_info` 는 `app_id` + `id` 만 반환, `/v2/user/me` 는 `email` + `nickname` 반환. 보안 (app_id 검증) + 정보 (email) 가 분리되어 있어 두 호출 필요. 단일 호출로는 `app_id` 검증 누락 위험.

Naver 가 단일 호출인 이유: Naver 가 `/v1/nid/me` 호출 시 토큰 발급 client 를 자체 검증해 다른 client 의 토큰은 401 반환. 즉 우리가 client_id 비교 endpoint 를 별도로 호출할 필요 없음. 우리 측은 `naverClientId` 가 등록되어 있는지만 확인 (운영 의도 명시).

### `social_identities` 테이블 (DB 변경 0)

```
core.social_identities (
    provider VARCHAR(20) NOT NULL,    -- 'google' | 'apple' | 'kakao'
    provider_id VARCHAR(255) NOT NULL,
    user_id BIGINT NOT NULL REFERENCES users(id),
    PRIMARY KEY (provider, provider_id)
)
```

이 테이블이 이미 ADR-012 에서 도입됐기 때문에 Kakao 추가 시 마이그레이션 불필요. provider 컬럼에 `'kakao'` 문자열만 들어가면 끝.

### `AppCredentialProperties` 의 앱별 매핑

```yaml
# application-dev.yml 발췌
app:
  credentials:
    sumtally:
      google-client-ids:
        - 123456789-ios.apps.googleusercontent.com
        - 987654321-android.apps.googleusercontent.com
      apple-bundle-id: com.twosun.sumtally
      kakao-app-id: 1234567   # Kakao Developers 의 앱 ID (숫자)
      naver-client-id: abcDEF123_xyz   # Naver Developers Client ID (영숫자)
```

각 provider service 가 `credentialProperties.getByAppSlug(request.appSlug())` 로 자기 앱의 credential 만 조회.

### 설계 선택 포인트

**포인트 1 — 토큰을 서버에서 검증, 클라이언트는 전달만**  
모바일 SDK 가 토큰을 받아오면 백엔드 endpoint 에 raw 토큰을 전달. 서버는 provider 공식 endpoint 로 재검증. 클라이언트가 토큰을 위조해 보내도 검증에서 막힘.

**포인트 2 — `social_identities` PK = (provider, provider_id)**  
이메일이 아니라 provider 의 `sub` / `id` 가 영속 식별자. 사용자가 provider 에서 이메일을 바꿔도 같은 유저로 인식. 이메일 기반 매핑은 별도 ADR 로.

**포인트 3 — `email_verified=true` 가정 (provider 가 보장)**  
Google / Apple / Kakao 모두 자체 이메일 검증을 해요. 우리 시스템은 신규 소셜 유저를 `email_verified=true` 로 생성합니다. 이메일 인증 메일은 발송하지 않아요.

**포인트 4 — Apple "Hide My Email" / Kakao 이메일 미동의**  
- Apple: `Hide My Email` 사용 시 token 의 email 이 relay address (`abc@privaterelay.appleid.com`). 그대로 사용. 첫 가입 시만 받을 수 있어 `AppleSignInRequest.email` 를 fallback 으로.
- Kakao: 사용자가 이메일 동의 거부 시 `kakao_account.email` 이 비어있음. 본 시스템은 email 필수라 401 (`reason=email_required`) 으로 거부. (이메일 없이 가입 허용은 별도 ADR.)

**포인트 5 — `AuthPort.signInWith*` provider 별 메서드**  
추상 `signIn(provider, token)` 보다 메서드 분리가 클라이언트 입장에서 명확 (DTO 가 provider 마다 다른 필드를 가질 수 있음). `KakaoSignInRequest.accessToken` vs `GoogleSignInRequest.idToken` 같은 필드명 차이도 자연스럽게.

## 이 선택이 가져온 것

### 긍정적 결과

- **새 provider 추가 비용 ~1일**: 패턴 복제 (Service 클래스 + DTO + AuthPort 메서드 + AppCredential 필드 + endpoint + 테스트). Kakao 도 이 비용으로 추가됨.
- **DB 변경 0**: `social_identities` 가 범용 설계라 마이그레이션 불필요.
- **외부 의존성 0**: HttpClient (java.net.http) + JJWT 0.13.0 만 사용해요. spring-security-oauth2-client 는 도입하지 않아요.
- **앱별 credential 격리**: 한 앱의 Google client id 가 다른 앱 토큰 검증을 통과하지 않음. ADR-012 의 `appSlug` 격리와 자연 연결.
- **provider 별 미세 차이 흡수**: Apple Hide My Email / Kakao 이메일 미동의 같은 케이스를 각 service 에서 명확히 처리.

### 부정적 결과

- **provider 별 코드 중복**: 패턴은 동일하지만 200~300 LOC × N provider. 추상화 안 한 트레이드오프.
- **토큰 형태가 provider 마다 다름**: 클라이언트가 어느 endpoint 에 어느 필드를 보내야 하는지 docs 명시 필요 (`docs/api-and-functional/api/flutter-backend-integration.md`).
- **Kakao 두 endpoint 호출**: 응답 시간 합쳐 ~500ms 가능. Google (1 호출) 대비 살짝 느림. 단 한국 사용자 대상 앱에서만 활성화 (ADR-024 `enabledProviders` 기본값).
- **`spring-security-oauth2-client` 가 가져왔을 표준 흐름 (PKCE 등) 미적용**: 모바일 SDK 가 자체 처리. 웹 OAuth 도입 시 별도 ADR 필요.

## 교훈

### 교훈 1 — Provider 별 차이는 추상화로 안 풀린다

**대안 — `OAuthProvider` 인터페이스 + 구현체 N개** 의 한계: provider 별 토큰 형태 (JWT vs opaque), 검증 endpoint, audience 필드명, 응답 구조가 모두 달라 추상화 시그니처가 점점 일반적 (Map) 또는 추상 누수 (`if/else`) 로 가요. **"같은 패턴이지만 코드는 복사"** 가 솔로 친화에 더 부합.

**교훈**: 추상화는 **공통 본질** 이 있어야 가치. 표면적으로 비슷해 보여도 미세 차이가 많으면 복제가 정답.

### 교훈 2 — DB 스키마는 처음부터 범용으로

`social_identities (provider, provider_id)` PK 를 ADR-012 에서 도입할 때 provider 컬럼을 enum 이 아닌 VARCHAR(20) 으로 한 결정이 OAuth 추가 시 자체 보상. provider 추가에 마이그레이션 0. **enum 으로 박았으면 매 추가마다 ALTER TABLE**.

**교훈**: 미래 확장될 식별자 컬럼은 VARCHAR + 값 검증을 코드에서 (DB 제약 X). 단 잘못된 값이 안 들어가도록 단위 테스트 필수.

### 교훈 3 — provider 공식 endpoint 로 재검증은 절대 양보 X

클라이언트가 받은 토큰을 그대로 신뢰하면 토큰 위조 / replay 공격 가능. 매 provider 마다 공식 verification endpoint (Google tokeninfo / Apple JWKS / Kakao token_info) 로 재검증. 응답 시간 ~100~500ms 추가지만 보안 핵심.

**교훈**: 보안 검증은 "한 번만 하면 충분" 이 아님. 매 요청마다 provider 에 검증 호출.

## 관련 사례 (Prior Art)

- [Google Sign-In for Server-Side Apps — Verify the integrity of the ID token](https://developers.google.com/identity/sign-in/web/backend-auth) — 본 ADR 의 Google 구현 근거. tokeninfo endpoint 호출 패턴.
- [Sign in with Apple — Verifying a User](https://developer.apple.com/documentation/sign_in_with_apple/sign_in_with_apple_rest_api/verifying_a_user) — Apple JWKS + RS256 검증 표준.
- [Kakao Login — REST API: 토큰 정보 보기](https://developers.kakao.com/docs/latest/ko/kakaologin/rest-api#get-token-info) + [사용자 정보 가져오기](https://developers.kakao.com/docs/latest/ko/kakaologin/rest-api#req-user-info) — 본 ADR 의 Kakao 구현 근거. 두 endpoint.
- [Naver Login — 회원 프로필 조회 API (`/v1/nid/me`)](https://developers.naver.com/docs/login/profile/profile.md) — 본 ADR 의 Naver 구현 근거.
- [OAuth 2.0 RFC 6749](https://datatracker.ietf.org/doc/html/rfc6749) — 흐름 표준 (본 ADR 은 모바일 SDK + 백엔드 검증의 단순화 모델).
- [Spring Security OAuth2 Client](https://docs.spring.io/spring-security/reference/servlet/oauth2/client/index.html) — 본 ADR 이 채택하지 않은 대안.
- [`template-flutter` ADR-024 · OAuth_SignIn](https://github.com/storkspear/template-flutter/blob/main/docs/philosophy/adr-024-oauth-signin.md) — 짝 프론트 ADR. 클라이언트 SDK 통합 + 위젯.

## Code References

**Provider 검증 서비스**
- [`core-auth-impl/service/GoogleSignInService.java`](https://github.com/storkspear/template-spring/blob/main/core/core-auth-impl/src/main/java/com/factory/core/auth/impl/service/GoogleSignInService.java) — Google tokeninfo 1 호출
- [`core-auth-impl/service/AppleSignInService.java`](https://github.com/storkspear/template-spring/blob/main/core/core-auth-impl/src/main/java/com/factory/core/auth/impl/service/AppleSignInService.java) — Apple JWKS + RS256
- [`core-auth-impl/service/KakaoSignInService.java`](https://github.com/storkspear/template-spring/blob/main/core/core-auth-impl/src/main/java/com/factory/core/auth/impl/service/KakaoSignInService.java) — Kakao access_token_info + user/me 2 호출
- [`core-auth-impl/service/NaverSignInService.java`](https://github.com/storkspear/template-spring/blob/main/core/core-auth-impl/src/main/java/com/factory/core/auth/impl/service/NaverSignInService.java) — Naver /v1/nid/me 1 호출

**DTO**
- [`core-auth-api/dto/GoogleSignInRequest.java`](https://github.com/storkspear/template-spring/blob/main/core/core-auth-api/src/main/java/com/factory/core/auth/api/dto/GoogleSignInRequest.java)
- [`core-auth-api/dto/AppleSignInRequest.java`](https://github.com/storkspear/template-spring/blob/main/core/core-auth-api/src/main/java/com/factory/core/auth/api/dto/AppleSignInRequest.java)
- [`core-auth-api/dto/KakaoSignInRequest.java`](https://github.com/storkspear/template-spring/blob/main/core/core-auth-api/src/main/java/com/factory/core/auth/api/dto/KakaoSignInRequest.java)
- [`core-auth-api/dto/NaverSignInRequest.java`](https://github.com/storkspear/template-spring/blob/main/core/core-auth-api/src/main/java/com/factory/core/auth/api/dto/NaverSignInRequest.java)

**Port + 위임**
- [`core-auth-api/AuthPort.java`](https://github.com/storkspear/template-spring/blob/main/core/core-auth-api/src/main/java/com/factory/core/auth/api/AuthPort.java) — `signInWith{Google,Apple,Kakao}` 메서드
- [`core-auth-impl/AuthServiceImpl.java`](https://github.com/storkspear/template-spring/blob/main/core/core-auth-impl/src/main/java/com/factory/core/auth/impl/AuthServiceImpl.java) — provider service 위임

**Endpoint + 보안**
- [`common-web/ApiEndpoints.java`](https://github.com/storkspear/template-spring/blob/main/common/common-web/src/main/java/com/factory/common/web/ApiEndpoints.java) — `Auth.{GOOGLE,APPLE,KAKAO,NAVER}` + `PUBLIC_PATTERNS`
- [`core-auth-impl/controller/AuthController.java`](https://github.com/storkspear/template-spring/blob/main/core/core-auth-impl/src/main/java/com/factory/core/auth/impl/controller/AuthController.java) — 레퍼런스 endpoint (런타임 미등록, ADR-013)

**앱별 credential**
- [`core-auth-impl/AppCredentialProperties.java`](https://github.com/storkspear/template-spring/blob/main/core/core-auth-impl/src/main/java/com/factory/core/auth/impl/AppCredentialProperties.java) — `googleClientIds` / `appleBundleId` / `kakaoAppId` / `naverClientId`
- [`.env.example`](https://github.com/storkspear/template-spring/blob/main/.env.example) — `APP_CREDENTIALS_<SLUG>_*` 환경변수 매핑

**유저 식별**
- [`core-user-impl/entity/SocialIdentity.java`](https://github.com/storkspear/template-spring/blob/main/core/core-user-impl/src/main/java/com/factory/core/user/impl/entity/SocialIdentity.java) — `(provider, provider_id)` PK
- [`core-user-api/UserPort.java`](https://github.com/storkspear/template-spring/blob/main/core/core-user-api/src/main/java/com/factory/core/user/api/UserPort.java) — `findBySocialIdentity` / `createSocialUser`

**테스트 — 단위 (HTTP mock spy)**
- [`core-auth-impl/test/.../GoogleSignInServiceTest.java`](https://github.com/storkspear/template-spring/blob/main/core/core-auth-impl/src/test/java/com/factory/core/auth/impl/service/GoogleSignInServiceTest.java)
- [`core-auth-impl/test/.../AppleSignInServiceTest.java`](https://github.com/storkspear/template-spring/blob/main/core/core-auth-impl/src/test/java/com/factory/core/auth/impl/service/AppleSignInServiceTest.java)
- [`core-auth-impl/test/.../KakaoSignInServiceTest.java`](https://github.com/storkspear/template-spring/blob/main/core/core-auth-impl/src/test/java/com/factory/core/auth/impl/service/KakaoSignInServiceTest.java)
- [`core-auth-impl/test/.../NaverSignInServiceTest.java`](https://github.com/storkspear/template-spring/blob/main/core/core-auth-impl/src/test/java/com/factory/core/auth/impl/service/NaverSignInServiceTest.java)

**테스트 — 통합 (WireMock)** — 실제 HttpClient 라이프사이클 검증
- [`core-auth-impl/test/.../GoogleSignInServiceWireMockIT.java`](https://github.com/storkspear/template-spring/blob/main/core/core-auth-impl/src/test/java/com/factory/core/auth/impl/service/GoogleSignInServiceWireMockIT.java)
- [`core-auth-impl/test/.../AppleSignInServiceWireMockIT.java`](https://github.com/storkspear/template-spring/blob/main/core/core-auth-impl/src/test/java/com/factory/core/auth/impl/service/AppleSignInServiceWireMockIT.java) — 자체 RSA keypair + JWT 서명
- [`core-auth-impl/test/.../KakaoSignInServiceWireMockIT.java`](https://github.com/storkspear/template-spring/blob/main/core/core-auth-impl/src/test/java/com/factory/core/auth/impl/service/KakaoSignInServiceWireMockIT.java)
- [`core-auth-impl/test/.../NaverSignInServiceWireMockIT.java`](https://github.com/storkspear/template-spring/blob/main/core/core-auth-impl/src/test/java/com/factory/core/auth/impl/service/NaverSignInServiceWireMockIT.java)

**관련 ADR**:
- [`ADR-012 · 앱별 독립 유저 모델`](./adr-012-per-app-user-model.md) — `social_identities` 테이블 도입 + appSlug 격리
- [`ADR-013 · 앱별 인증 엔드포인트`](./adr-013-per-app-auth-endpoints.md) — Controller 위치 + URL 구조
- [`ADR-007 · 솔로 친화적 운영`](./adr-007-solo-friendly-operations.md) — 외부 의존성 0 / 패턴 복제 정당성
- [`ADR-011 · 모듈 안 레이어드 + 포트/어댑터`](./adr-011-layered-port-adapter.md) — Port (`AuthPort`) + Service 위치
- [`ADR-016 · DTO Mapper 금지`](./adr-016-dto-mapper-forbidden.md) — DTO 직접 사용
