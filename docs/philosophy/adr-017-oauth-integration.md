# ADR-017 · OAuth 2.0 통합 (Google / Apple / Kakao / Naver)

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~8분

**Status**: Accepted. 현재 유효. 2026-04-28 기준 Google · Apple · Kakao · Naver 4 provider 모두 구현 완료. `core-auth-impl/service/{Google,Apple,Kakao,Naver}SignInService.java` + `AuthPort.signInWith{Google,Apple,Kakao,Naver}` + `AppCredentialProperties` 의 `googleClientIds` / `appleBundleId` / `kakaoAppId` / `naverClientId` 필드. WireMock 통합 테스트로 HttpClient 라이프사이클 검증.

## 결론부터

소셜 로그인은 사용자 마찰을 줄이는 가장 효과적인 수단이에요. *Google 로 시작하기* / *Apple 로 시작하기* / *카카오로 시작하기* 버튼 한 번이 *이메일 입력 + 비밀번호 설정 + 인증 메일 클릭* 의 세 단계를 한 번에 건너뛰어 줍니다. 한국 시장 앱이라면 카카오 / 네이버, 글로벌 앱이라면 Google / Apple — 어느 조합이든 *provider 가 점점 늘어나는* 흐름은 자연스러워요.

이 ADR 은 *Google / Apple / Kakao / Naver 네 provider* 를 통합한 패턴을 기록합니다. 각 provider 마다 검증 방식이 다르고 (Google 은 `id_token` 한 번 호출, Apple 은 JWKS 로 RS256 직접 검증, Kakao 는 access token 두 endpoint 호출, Naver 는 `/v1/nid/me` 단일 호출), 토큰 형태와 audience 필드명도 제각각이에요. 그래서 *공통 추상화* 를 강요하는 대신 *Provider 별 SignInService 클래스를 복제* 하는 패턴을 채택했습니다. 각 클래스는 같은 4 단계 흐름 — 토큰 검증 → `social_identities` 조회 → 신규/기존 분기 → 우리 JWT 발급 — 을 따르되, provider 의 미세 차이는 그 클래스 안에 캡슐화돼요.

DB 변경은 0 입니다. `social_identities (provider, provider_id)` PK 가 [`ADR-012`](./adr-012-per-app-user-model.md) 단계에서 이미 범용 VARCHAR 로 설계되어 있어, Kakao 든 Naver 든 새 provider 가 추가돼도 마이그레이션 없이 row 만 추가됩니다. 외부 의존성도 0 — `spring-security-oauth2-client` 같은 무거운 라이브러리 대신 JDK 의 `HttpClient` 와 JJWT 0.13 만으로 구현해 솔로 운영의 단순함 ([`ADR-007`](./adr-007-solo-friendly-operations.md)) 을 유지했어요.

## 왜 이런 고민이 시작됐나?

소셜 로그인을 도입한다는 결정 자체는 단순해요 — *사용자 마찰 감소가 비즈니스 가치가 있다* 는 한 줄짜리 명제입니다. 진짜 고민은 *어떤 형태로 통합할 것인가* 부터 시작돼요. OAuth 는 표준이지만 *provider 마다 그 표준을 다르게 해석* 하기 때문에 통합 코드가 정해진 답이 없습니다.

세 가지 힘이 동시에 작용했어요.

**첫째, provider 별 검증 방식이 본질적으로 달라요.** Google 은 `id_token` 이라는 JWT 를 발급하고 `https://oauth2.googleapis.com/tokeninfo` 한 번 호출로 검증이 끝납니다. Apple 도 JWT 를 발급하지만 *Apple JWKS endpoint 에서 공개키를 받아 RS256 서명을 직접 검증* 하는 형태로, *우리 코드 안에서 JWT 라이브러리를 써야* 해요. Kakao 는 OAuth 표준을 약간 비틀어 *opaque access token* 만 발급하고, *그 토큰의 app_id 와 사용자 정보를 별도 두 endpoint* (`/v1/user/access_token_info` + `/v2/user/me`) 로 받아와야 합니다. Naver 는 또 다르게 *단일 endpoint (`/v1/nid/me`) 가 토큰 검증과 사용자 정보를 한 번에* 처리해요. 이 네 가지 형태를 *하나의 추상화* 로 묶으려고 시도하면 *시그니처가 너무 일반적 (`Map<String, Object>`) 이거나 너무 구체적 (provider 별 record)* 이 되어, 결국 추상화 안에서 `if (provider == "kakao")` 같은 분기 로직이 새로 생깁니다. *공통 본질이 약한 영역에 추상화를 강요* 하면 추상화 자체가 누수돼요.

**둘째, 앱별 credential 격리가 검증 로직의 핵심이에요.** 한 백엔드 인스턴스가 N 개 앱을 서비스 ([`ADR-005`](./adr-005-db-schema-isolation.md), [`ADR-012`](./adr-012-per-app-user-model.md)) 하는 우리 환경에서, *같은 Google id token* 이라도 *어느 앱이 발급한 것인지* 를 audience (Google client ID) 로 검증해야 합니다. 그렇지 않으면 *앱 A 의 클라이언트가 받은 토큰* 이 *앱 B 의 백엔드* 를 통과해버리는 cross-app 토큰 위조가 가능해져요. Kakao 도 마찬가지로 `app_id` 가 우리 앱의 Kakao Developer 등록 앱과 일치해야 하고, Apple 은 `aud` 가 우리 bundle ID 와 같아야 합니다. 즉 *credential 매핑이 검증 로직의 절반* 이고, 이 매핑은 *앱별로 분리된 형태* 로 관리되어야 해요.

**셋째, 솔로 친화 ([`ADR-007`](./adr-007-solo-friendly-operations.md)) 가 도구 선택의 상위 기준이에요.** Spring Security 가 제공하는 `spring-boot-starter-oauth2-client` 는 *표준 OAuth2 / OIDC 흐름 (redirect URI, PKCE 등)* 을 풍부하게 지원하지만, 우리 흐름과 맞지 않아요. 모바일 앱은 *SDK 가 클라이언트 측에서 토큰을 받아오면 그 토큰을 백엔드에 전달* 하는 단순한 모델이고, redirect URI 기반 흐름은 웹 OAuth 에서나 의미가 있어요. 무거운 라이브러리를 도입하는 비용 — *application.yml 의 provider 별 설정 분산*, *비표준 provider (Kakao 같은) 의 어색한 처리*, *프레임워크 학습 곡선* — 이 *우리가 얻는 가치 (표준 흐름)* 보다 커서, *JDK HttpClient + JJWT 만으로 직접 구현* 하는 편이 정합합니다.

이 결정이 답해야 할 물음은 이거예요.

> **OAuth provider 가 점점 늘어나는 환경에서, 매번 같은 패턴으로 추가 가능하되 각 provider 의 미세 차이는 복제로 흡수하는 통합 구조는 어떤 모양인가?**

## 고민했던 대안들

### Option 1 — Spring Security OAuth2 Client

가장 *Spring 스러운* 답이에요. `spring-boot-starter-oauth2-client` 를 도입하고 provider 별 설정을 `application.yml` 에 선언하면, 표준 OAuth2 / OIDC 흐름 (PKCE, refresh token rotation, OIDC discovery 등) 이 한 번에 따라옵니다. *프레임워크가 알아서 해 주는* 가치가 분명한 영역이에요.

다만 우리 흐름과 *세 가지 결정적 미스매치* 가 있어요. 첫째, 표준 OAuth2 는 *redirect URI 기반 흐름* 을 전제하는데 모바일 앱은 *SDK 가 클라이언트 측에서 토큰을 받아 백엔드에 전달* 하는 훨씬 단순한 모델이에요. redirect 흐름의 부가 기능 (PKCE, state 파라미터 등) 이 모바일에서는 의미가 약합니다. 둘째, provider 별 추가 설정 (issuer URI, JWK Set URI, scope 등) 이 `application.yml` 에 분산되는데, 우리는 *앱별 credential 매핑* 을 `AppCredentialProperties` 한 곳에 집중시키고 싶어요. 셋째, Kakao 처럼 *비표준 provider* (JWT 가 아닌 opaque access token + 두 endpoint 호출) 는 spring-security-oauth2 의 가정과 맞지 않아 *우회 코드* 가 필요해집니다.

탈락 이유는 *모바일 토큰 전달 방식에 비해 라이브러리가 무거움* 이에요. 의존성 비용과 학습 곡선이 *우리가 얻는 가치 (표준 흐름)* 보다 크고, 비표준 provider 의 처리도 어색해서 트레이드오프가 우리 환경과 맞지 않습니다.

### Option 2 — 단일 추상 `OAuthProvider` 인터페이스

*객체지향적으로 가장 깔끔한* 답이에요. `interface OAuthProvider { AuthResponse verify(String token, String appSlug); }` 같은 추상을 정의하고, Google / Apple / Kakao / Naver 구현체가 그 인터페이스를 따르는 형태입니다. 새 provider 추가 시 *인터페이스 구현 하나만* 만들면 끝나는 매력이 있어요.

문제는 *공통 본질이 약하면 추상화가 누수된다* 는 점이에요. provider 별로 토큰 형태가 다르고 (Google / Apple 은 JWT, Kakao / Naver 는 opaque access token), 검증 endpoint 가 다르고, audience 필드명이 다르고 (Google `aud`, Apple `aud`, Kakao `app_id`), 응답 구조도 모두 달라요. 이 차이를 한 인터페이스로 묶으려면 *시그니처를 너무 일반화* (`Map<String, Object>` 같은) 하거나 *너무 구체화* (provider 별 record 강요) 해야 합니다. 어느 쪽을 택해도 결국 *공통 진입점에서 `if (provider == "kakao")` 같은 분기 로직이 다시 등장* 해요. 추상화의 가치가 *분기를 한 곳에 모은다* 는 것이라면 그 가치가 사실상 사라집니다.

또 다른 문제는 *클라이언트 입장의 명확성* 이에요. `AuthPort.signInWithGoogle(GoogleSignInRequest)` 처럼 provider 별 메서드를 노출하면 클라이언트가 *어떤 DTO 를 보내야 하는지* 가 시그니처에서 즉시 드러납니다. 추상 `signIn(provider, token, ...)` 형태로 묶으면 *Google 에 access token 을 보내거나 Kakao 에 id_token 을 보내는* 잘못된 조합이 컴파일 타임에 막히지 않아요.

탈락 이유는 *추상화 비용이 복제 비용보다 큼* 이에요. ADR-007 의 *단순함 우선* 원칙에 정합하지 않습니다.

### Option 3 — Provider 별 SignInService 클래스 복제 ★ 채택

각 provider 마다 `GoogleSignInService`, `AppleSignInService`, `KakaoSignInService`, `NaverSignInService` 클래스를 두고, 동일한 4 단계 흐름을 *복제* 하는 형태입니다. 패턴은 같지만 provider API 의 미세 차이는 그 클래스 안에 캡슐화돼요.

```java
// 패턴 — 각 provider 가 자기 검증 로직 캡슐화
@Transactional
public class XxxSignInService {
    public AuthResponse signIn(XxxSignInRequest request) {
        AppCredential cred = credentialProperties.getByAppSlug(request.appSlug());
        XxxTokenInfo info = verifyToken(request.token(), cred);  // provider 별 다름
        Optional<UserAccount> existing = userPort.findBySocialIdentity(PROVIDER, info.id());
        if (existing.isPresent()) return loginExisting(existing.get(), request.appSlug());
        return registerNew(info, request.appSlug());
    }
}
```

이 옵션이 세 가지 힘을 모두 만족해요. *힘 A (provider 별 검증 차이)* 는 각 SignInService 안에 캡슐화되어 *Google 의 tokeninfo*, *Apple 의 JWKS*, *Kakao 의 두 endpoint*, *Naver 의 단일 endpoint* 가 자연스러운 위치에 자리잡습니다. *힘 B (앱별 credential 격리)* 는 `AppCredentialProperties.AppCredential` 의 `googleClientIds` / `appleBundleId` / `kakaoAppId` / `naverClientId` 필드로 표현되고, 각 SignInService 가 `getByAppSlug(appSlug)` 로 자기 앱의 credential 만 조회해요. *힘 C (솔로 친화)* 는 외부 의존성 0 — JDK `HttpClient` + JJWT 만으로 200~300 LOC / provider 정도의 코드 분량으로 끝납니다.

복제의 비용 — *코드 중복* — 은 정직하게 인정해요. 다만 provider 가 *공통 본질이 약한* 영역이라 복제가 *추상화 누수보다 정직한* 선택이고, 새 provider 추가 시 *기존 클래스를 그대로 복사한 뒤 차이만 수정* 하는 흐름이 1 일 안에 끝나는 데다, 한 provider 의 변경이 다른 provider 에 영향을 주지 않는 *격리* 도 따라옵니다.

## 결정

채택은 *Provider 별 SignInService 클래스 복제* 입니다. 같은 4 단계 흐름을 따르되 provider API 의 미세 차이는 각 클래스에 캡슐화하고, 앱별 credential 격리는 `AppCredentialProperties` 의 매핑으로 처리해요.

### Provider 별 검증 차이

| Provider | 토큰 종류 | Endpoint | audience 검증 필드 | 호출 횟수 |
|---|---|---|---|---|
| Google | `id_token` (JWT) | `/tokeninfo?id_token=...` | `aud` ∈ `googleClientIds[]` | 1 |
| Apple | `identity_token` (JWT) | JWKS + 직접 RS256 검증 | `aud` == `appleBundleId` | 1 (JWKS 캐시) |
| Kakao | `access_token` (opaque) | `/v1/user/access_token_info` + `/v2/user/me` | `app_id` == `kakaoAppId` | 2 |
| Naver | `access_token` (opaque) | `/v1/nid/me` | (Naver 자체 검증) `naverClientId` 등록만 확인 | 1 |

Kakao 가 두 호출인 이유: `/v1/user/access_token_info` 는 `app_id` + `id` 만 반환, `/v2/user/me` 는 `email` + `nickname` 반환. 보안 (app_id 검증) + 정보 (email) 가 분리되어 있어 두 호출 필요. 단일 호출로는 `app_id` 검증 누락 위험.

Naver 가 단일 호출인 이유: Naver 는 `/v1/nid/me` 호출 시 토큰 발급 client 를 자체 검증해 다른 client 의 토큰은 401 을 반환합니다. 즉 우리가 client_id 비교 endpoint 를 별도로 호출할 필요가 없어요. 우리 측은 `naverClientId` 가 등록되어 있는지만 확인합니다 (운영 의도 명시).

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

#### 포인트 1 — 토큰은 항상 서버에서 재검증

모바일 SDK 가 클라이언트 측에서 OAuth 토큰을 받아오면, 그 토큰을 *그대로 신뢰하지 않고* 백엔드 endpoint 로 raw 형태 전달합니다. 서버는 그 토큰을 받아 provider 공식 endpoint (Google `tokeninfo`, Apple JWKS, Kakao `access_token_info`, Naver `/v1/nid/me`) 로 재검증한 뒤에야 신뢰해요.

이 단계가 사라지면 *클라이언트가 토큰을 위조해 보내는* 공격에 무방비가 됩니다. 모바일 SDK 가 받아온 토큰은 *클라이언트 환경* 에서 가공될 수 있다는 가정이 있어야 안전해요. 서버 재검증은 응답 시간 ~100~500ms 를 추가하지만, 이 비용은 *보안 핵심* 이라 양보 대상이 아닙니다.

#### 포인트 2 — `social_identities` PK 는 `(provider, provider_id)`

소셜 유저를 *어떤 키로 식별할지* 는 미묘한 결정이에요. *이메일* 을 키로 쓰면 자연스러워 보이지만, 사용자가 provider 측에서 이메일을 변경할 수 있고 (Apple 의 *Hide My Email* 이 대표적), 그러면 *우리 DB 에서 동일 유저가 다른 사람으로 인식* 되는 사고가 생깁니다.

대신 provider 가 부여한 *영속 식별자* — Google 의 `sub`, Apple 의 `sub`, Kakao 의 `id`, Naver 의 `id` — 를 사용해요. 이 값은 *provider 가 그 사용자를 식별하는 영구 키* 라 이메일이 바뀌어도 변하지 않습니다. PK 를 `(provider, provider_id)` 복합 키로 잡으면 *Google 의 12345* 와 *Kakao 의 12345* 가 충돌하지 않게 자연스럽게 격리돼요.

이메일 기반 *계정 통합* (예: *같은 이메일로 다른 provider 로그인 시 동일 유저로 묶기*) 은 별도 ADR 에서 다룰 주제예요. 본 ADR 은 *각 provider 식별자가 별개 유저* 라는 가장 보수적인 모델을 따릅니다.

#### 포인트 3 — `email_verified=true` 자동 부여

Google / Apple / Kakao / Naver 모두 *자체적으로 이메일 검증* 을 거친 뒤에 사용자에게 OAuth 권한을 부여해요. 그 사실을 우리 시스템이 신뢰하면 *소셜 가입자에게 별도 인증 메일을 발송할 필요* 가 없어집니다.

따라서 신규 소셜 유저는 `email_verified=true` 로 즉시 생성되고, 인증 메일도 발송되지 않아요. 사용자 입장에서는 *Google 로 시작* 버튼 한 번에 *이메일 인증까지 끝난 가입* 이 되는 셈입니다. 이메일 가입과 비교해 마찰이 한 단계 더 줄어드는 효과예요.

#### 포인트 4 — Apple Hide My Email / Kakao 이메일 미동의

두 가지 비표준 케이스를 명시적으로 처리해요.

**Apple 의 *Hide My Email*** — 사용자가 *이메일 숨기기* 옵션을 선택하면 Apple 이 `abc@privaterelay.appleid.com` 같은 *relay address* 를 발급합니다. 이 주소도 정상적인 이메일이라 *우리 시스템에서 그대로 사용* 해요 (Apple 이 그 주소로 온 메일을 사용자의 실제 이메일로 forward). 다만 *첫 가입 시점에만* token 에 email 이 포함되고 *이후 로그인에는 email 이 빠져* 있어, 클라이언트가 첫 응답을 로컬에 저장해뒀다가 백엔드에 전달하는 패턴이 필요해요. `AppleSignInRequest.email` 필드가 그 fallback 입니다.

**Kakao 이메일 동의 거부** — Kakao 는 *이메일 정보 제공 동의* 를 사용자가 선택할 수 있게 해서, 거부하면 `kakao_account.email` 이 비어 옵니다. 본 시스템은 email 을 필수로 요구하므로 이 경우 401 (`reason=email_required`) 로 거부해요. *이메일 없이 가입 허용* 은 *유저 식별 정책* 이 통째로 바뀌는 큰 결정이라 별도 ADR 에서 다룰 주제로 남겨뒀습니다.

#### 포인트 5 — `AuthPort.signInWith*` provider 별 메서드

`AuthPort` 에서 *추상 `signIn(provider, token)` 한 메서드* 로 묶지 않고 *provider 별로 분리된 메서드* — `signInWithGoogle`, `signInWithApple`, `signInWithKakao`, `signInWithNaver` — 를 노출합니다.

분리의 이유는 *클라이언트 입장의 명확성* 이에요. provider 마다 DTO 필드가 달라요 — `GoogleSignInRequest.idToken`, `KakaoSignInRequest.accessToken`, `AppleSignInRequest.identityToken + email + name` 처럼 *어떤 토큰을 보내야 하는지* 가 시그니처에 직접 드러나야 *잘못된 토큰을 잘못된 endpoint 로 보내는* 사고가 컴파일 타임에 막힙니다. 추상 메서드로 묶으면 *모든 토큰을 String 으로 받게* 되는데, 그러면 그 안전망이 사라져요.

이 결정은 [`Option 2`](#option-2--단일-추상-oauthprovider-인터페이스) 의 탈락 이유와 같은 맥락이에요 — *공통 본질이 약한 영역에 추상화를 강요하지 않는다* 는 원칙이 메서드 분리에도 일관되게 적용됩니다.

## 이 선택이 가져온 것

### 긍정적 결과

**새 provider 추가가 1 일 안에 끝나요.** 기존 Service 클래스를 복사한 뒤 *토큰 검증 부분 (verifyToken)* 만 그 provider 에 맞게 수정하고 DTO + AuthPort 메서드 + AppCredential 필드 + endpoint + 테스트를 같은 패턴으로 추가하면 됩니다. Naver 가 이 비용으로 Kakao 다음 사이클에 추가됐어요. *추가 비용이 예측 가능* 하다는 점이 프로젝트 운영에서 큰 가치예요.

**DB 변경이 0 이에요.** `social_identities` 의 `provider` 컬럼이 *VARCHAR(20)* 으로 설계된 덕에 새 provider 를 추가해도 ALTER TABLE 이 필요 없습니다. row 의 `provider` 값에 `'naver'` 문자열만 들어가면 끝이에요. enum 으로 박혀 있었다면 매 추가마다 마이그레이션이 필요했을 텐데, 그 미래 비용을 [`ADR-012`](./adr-012-per-app-user-model.md) 단계에서 미리 회피해 둔 결과입니다.

**외부 의존성이 0 이에요.** JDK 의 `HttpClient` (java.net.http) 와 JJWT 0.13.0 만으로 모든 provider 가 통합돼요. `spring-security-oauth2-client` 같은 무거운 라이브러리를 도입하지 않아 *application.yml 의 provider 별 설정 분산* 도, *프레임워크 학습 곡선* 도 없습니다. 의존성 트리가 가벼워서 빌드 시간과 jar 크기에도 직접 도움이 돼요.

**앱별 credential 이 깔끔히 격리됩니다.** 한 앱의 Google client ID 가 다른 앱의 토큰 검증을 통과하지 못해요. 각 SignInService 가 `getByAppSlug(appSlug)` 로 자기 앱의 credential 만 조회하므로, *cross-app 토큰 위조* 가 구조적으로 차단됩니다. [`ADR-012`](./adr-012-per-app-user-model.md) 의 `appSlug` 격리와 자연스럽게 연결돼요.

**provider 별 미세 차이가 캡슐화됩니다.** Apple 의 *Hide My Email* 처리, Kakao 의 *이메일 동의 거부* 분기, Naver 의 *단일 endpoint 검증* — 이런 비표준 케이스가 각 SignInService 안에서 해당 provider 의 맥락 안에서 처리돼요. 다른 provider 의 코드를 건드리지 않으므로, 한 provider 의 변경이 다른 provider 의 동작에 영향을 주지 않는 *격리* 도 따라옵니다.

### 부정적 결과

**Provider 별 코드 중복이 정직하게 존재합니다.** 패턴이 동일하니 클래스마다 200~300 LOC 가 *비슷하지만 같지 않은* 형태로 반복돼요. 이 중복은 *추상화를 거절한 트레이드오프* 의 비용이에요. 새 provider 추가 시에도 이 중복이 함께 추가되므로, *N provider × ~250 LOC* 의 코드 분량이 누적됩니다. 다만 *복제 후 차이만 수정* 하는 작업은 단순해서 *유지 비용* 자체는 작은 편이에요.

**토큰 형태가 provider 마다 달라 클라이언트 측 docs 가 필요해요.** Google 은 `idToken`, Apple 은 `identityToken + email + name`, Kakao 는 `accessToken`, Naver 는 `accessToken` 을 보내야 합니다. 이 정보가 *코드만으로는 자명하지 않아* `docs/api-and-functional/api/flutter-backend-integration.md` 같은 통합 가이드에서 명시적으로 정리해야 해요.

**Kakao 가 두 endpoint 호출이라 살짝 느립니다.** `/v1/user/access_token_info` (app_id 검증) 와 `/v2/user/me` (사용자 정보) 를 순차 호출해서 응답 시간이 합쳐 ~500ms 정도 나올 수 있어요. Google 의 단일 호출 (~150ms) 대비 약 3 배지만, 한국 시장 앱이 아닌 환경에서는 Kakao 자체를 비활성화 ([`ADR-034`](./adr-034-feature-toggle-lite-mode.md) 의 feature toggle) 하면 되므로 운영 부담이 한정돼요.

**표준 OAuth 흐름의 부가 기능 (PKCE, refresh token rotation 등) 이 미적용입니다.** 모바일 SDK 가 자체적으로 처리하는 영역이라 백엔드에서 다시 구현할 필요는 없지만, *웹 OAuth* 가 도입되는 시점에는 redirect URI 흐름 + PKCE 가 필요해질 거예요. 그때 별도 ADR 로 *웹 OAuth 통합* 을 다루면 되고, 모바일 흐름은 영향을 받지 않습니다.

## 교훈

### Provider 별 차이는 추상화로 풀리지 않는다

OAuth 통합을 처음 설계할 때 *공통 인터페이스 + 구현체 N 개* 가 가장 자연스러운 답처럼 보였어요. *추상화로 분기를 한 곳에 모은다* 는 객체지향의 표준 미덕이 작동할 자리처럼 느껴졌습니다.

실제로 시그니처를 잡아 보면 그 미덕이 작동하지 않아요. provider 별로 *토큰 형태 (JWT vs opaque)*, *검증 endpoint*, *audience 필드명*, *응답 구조* 가 모두 다릅니다. 추상 시그니처를 *너무 일반적* (Map) 으로 만들면 타입 안전성이 사라지고, *너무 구체적* (provider 별 record 강요) 으로 만들면 추상화의 의미가 사라져요. 어느 쪽이든 *공통 진입점에서 `if (provider == "kakao")` 같은 분기 로직이 다시 등장* 합니다.

이게 *추상화가 누수되는* 전형적 신호예요. 추상화의 가치는 *공통 본질이 있는 영역에서만* 발휘되고, OAuth provider 처럼 *표면적으로 비슷해 보이지만 본질이 다른* 영역에서는 *복제가 더 정직한 답* 입니다.

**원칙**: 추상화는 *공통 본질이 강한* 영역에서만 가치가 있어요. *표면적 유사성* 만 있고 *본질이 다르면* 복제가 정답이고, 그 복제는 *추상화 누수* 라는 더 큰 비용을 회피하는 선택이에요.

### DB 스키마는 처음부터 *미래 확장* 을 흡수할 수 있게

`social_identities (provider, provider_id)` PK 를 [`ADR-012`](./adr-012-per-app-user-model.md) 단계에서 처음 정의할 때, `provider` 컬럼을 *enum* 이 아닌 *VARCHAR(20)* 으로 잡은 결정이 OAuth 사이클에서 직접적인 보상으로 돌아왔어요. enum 으로 박혀 있었다면 Kakao 추가 시 ALTER TABLE 이 필요했을 텐데, VARCHAR 라 row 추가만으로 끝났습니다.

이 결정의 일반 원칙은 *미래 확장될 식별자는 자유 형식 컬럼으로 두고 값 검증은 코드에서* 라는 거예요. DB 제약은 *현재 알려진 값* 만 허용하므로 *미래 추가* 를 막는 장벽이 되고, 코드 검증은 *현재 검증* 과 *미래 확장* 을 동시에 지원합니다. 다만 *잘못된 값이 들어가지 않도록* 단위 테스트로 검증 영역을 명시해야 해요.

**원칙**: DB 스키마는 *미래에 추가될 가능성이 있는 식별자* 에 대해 자유 형식 (VARCHAR / JSONB) 으로 설계합니다. *현재 알려진 값만* 허용하는 enum / CHECK 제약은 *미래 변경 비용* 을 미리 누적시키는 결정이에요.

### 보안 검증은 매 요청마다, 단 한 번도 양보하지 않기

OAuth 토큰 검증을 *클라이언트 측에서 검증된 것을 신뢰* 하는 형태로 단순화하고 싶은 유혹이 있어요. *Google SDK 가 이미 검증한 토큰을 다시 검증할 필요가 있나?* 같은 질문이 자연스럽게 떠오릅니다.

이 단순화는 보안 사고의 시작이에요. 클라이언트 환경은 *우리가 통제하지 않는* 영역이라 *SDK 가 검증한 척 하는 위조 토큰* 이나 *다른 앱에서 받은 토큰의 replay* 가 가능합니다. 매 요청마다 provider 공식 endpoint 로 재검증해야 *모든 토큰이 우리 앱에 발급된 진짜* 임이 보장돼요.

비용은 응답 시간 ~100~500ms 추가입니다. 이 비용은 *보안 핵심* 의 직접적 트레이드오프라 양보 대상이 아니에요.

**원칙**: 외부 토큰의 검증은 *매 요청마다* 합니다. *한 번 검증된 것을 캐시* 하거나 *클라이언트 측 검증을 신뢰* 하는 단순화는 보안 사고의 시작이에요.

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
