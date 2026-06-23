# 소셜 로그인 설정 가이드

> **유형**: How-to · **독자**: Level 1 · **읽는 시간**: ~25분

앱을 하나 추가하면 "구글로 로그인", "Apple 로 로그인" 같은 소셜 로그인을 붙일 수 있어요. 이 문서는 그 로그인이 동작하려면 각 provider 콘솔에서 무엇을 발급받아 어디에 적어야 하는지를, 처음 발급해보는 사람도 따라올 수 있게 한 단계씩 안내해요. 다루는 provider 는 네 곳이에요 — Google, Apple, 그리고 한국 시장용 Kakao·Naver.

> 처음 보는 용어가 나오면 [용어 사전](../reference/glossary.md) 에서 바로 찾아볼 수 있어요. 특히 [`OAuth`](../reference/glossary.md#인증--보안) (제3자 로그인 표준) 과 [`Audience (aud)`](../reference/glossary.md#인증--보안) 두 개념은 이 문서 전체에 깔려 있으니 미리 한 번 읽어 두면 편해요.

이 가이드는 *콘솔 화면 단계까지* 자세히 다루는 소셜 로그인 전용 문서예요. 운영에 필요한 다른 키들 (Cloudflare · Resend · PortOne · Apple IAP · Google IAP · MinIO 등) 까지 한 곳에서 보고 싶다면 먼저 [`운영 키 발급 통합 가이드`](../production/setup/key-issuance.md) 를 확인하세요. 이 문서는 그 통합 가이드 §4.3 (소셜 로그인) 의 상세 보충이에요.

---

## 전체 흐름

provider 가 넷이라 양이 많아 보이지만, 발급 절차의 뼈대는 모두 똑같아요. **콘솔에서 식별자를 발급받아 → `.env.prod` 에 환경변수로 적고 → 재배포** 하면 끝이에요. 코드는 손대지 않아요.

```
1. 활성화할 provider 결정 (글로벌이면 Google + Apple, 한국이면 + Kakao + Naver)
2. 각 provider 콘솔에서 credential 발급
3. .env.prod 에 환경변수 추가
4. 재배포 (코드 수정 없음)
```

활성화하지 않은 provider 는 해당 섹션을 통째로 건너뛰어도 돼요. 예를 들어 글로벌 시장 앱이면 Kakao·Naver 섹션은 무시하고 Google 과 Apple 만 따라가면 돼요.

> **키를 아직 안 받았는데 동작부터 보고 싶다면** [dev-mock 모드 섹션](#oauth-키-발급-전-e2e-시연-dev-mock-모드) 을 먼저 보세요. WireMock 컨테이너가 네 provider 를 가짜로 띄워, 콘솔 작업을 하나도 안 한 상태에서도 백엔드의 [`JWT`](../reference/glossary.md#인증--보안) 발급 흐름을 검증할 수 있어요.

---

## Google Sign In

가장 먼저 할 일은 Google Cloud 에서 OAuth 클라이언트 ID 를 발급받는 거예요. 이 ID 가 곧 서버가 "이 토큰이 정말 우리 앱에서 나온 게 맞나" 를 검증하는 기준이 돼요.

### 1단계: Google Cloud 프로젝트 생성 (최초 1회)

> 이미 `app-factory` 프로젝트를 만들었다면 이 단계는 건너뛰세요.

1. https://console.cloud.google.com 에 접속해요.
2. 상단 프로젝트 선택 드롭다운에서 **새 프로젝트** 를 눌러요.
3. 프로젝트 이름을 `app-factory` 로 정하고 **만들기** 를 눌러요.
4. 이 프로젝트는 모든 앱이 공유해요. 앱마다 새로 만들 필요가 없어요.

### 2단계: OAuth 동의 화면 설정 (최초 1회)

OAuth 동의 화면은 사용자가 "구글 계정으로 로그인" 을 눌렀을 때 보게 되는 동의 안내 화면이에요. 프로젝트당 한 번만 설정하면 돼요.

> 이미 설정했다면 건너뛰세요.

1. 좌측 메뉴에서 **APIs & Services → OAuth 동의 화면** 으로 들어가요. 메뉴가 안 보이면 상단 검색창에 "OAuth" 를 검색하면 돼요.
2. **외부** 를 선택하고 **만들기** 를 눌러요.
3. 필수 항목을 입력해요.
   - 앱 이름: `App Factory`
   - 사용자 지원 이메일: 본인 개발자 이메일
   - 개발자 연락처 이메일: 본인 개발자 이메일
4. 나머지는 비워 두고 **저장 후 계속** 으로 끝까지 넘어가요.
5. 마지막에 **앱 게시** 를 정할 수 있어요. 테스트 모드에서는 등록한 테스트 사용자만 로그인할 수 있고, 출시 전에 "프로덕션으로 푸시" 를 눌러야 모든 사용자가 로그인할 수 있어요.

### 3단계: 앱별 OAuth 클라이언트 ID 발급

여기서부터는 앱마다 따로 해야 하는 작업이에요. 앱 하나당 **iOS용 1개 + Android용 1개, 모두 2개** 를 만들어요. Flutter 앱이 iOS 와 Android 각각에서 Google 로그인할 때 플랫폼별 Client ID 가 다르기 때문이에요.

콘솔 위치는 https://console.cloud.google.com 의 **APIs & Services → 사용자 인증 정보** 예요.

#### iOS용

1. **+ 사용자 인증 정보 만들기 → OAuth 클라이언트 ID** 를 선택해요.
2. 애플리케이션 유형은 **iOS** 를 골라요.
3. 이름은 `sumtally-ios` 처럼 앱 구분용으로 자유롭게 적어요.
4. **번들 ID** 를 입력해요. Flutter 프로젝트에서 다음 중 하나로 확인할 수 있어요.
   - `ios/Runner.xcodeproj` 를 Xcode 로 열어 Runner → General → **Bundle Identifier**
   - 또는 `ios/Runner/Info.plist` 의 `CFBundleIdentifier` 값
   - 예: `com.twosun.sumtally`
5. **만들기** 를 눌러요.
6. 화면에 표시되는 **클라이언트 ID** 를 복사해요.
   - 형태: `123456789-xxxxxxxxxxxx.apps.googleusercontent.com`
   - 이 값이 `.env.prod` 의 `APP_CREDENTIALS_<SLUG>_GOOGLE_CLIENT_IDS_0` 에 들어가요.

#### Android용

1. **+ 사용자 인증 정보 만들기 → OAuth 클라이언트 ID** 를 선택해요.
2. 애플리케이션 유형은 **Android** 를 골라요.
3. 이름은 `sumtally-android` 처럼 적어요.
4. **패키지 이름** 을 입력해요.
   - Flutter 프로젝트의 `android/app/build.gradle` 에서 `namespace` 또는 `applicationId` 로 확인해요.
   - 예: `com.twosun.sumtally`
   - iOS 번들 ID 와 동일하게 맞추는 걸 권장해요.
5. **SHA-1 인증서 지문** 을 입력해요.
   ```bash
   # 디버그 키 (개발 중 테스트용)
   keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android
   # 출력에서 "SHA1:" 뒤의 값을 복사해요.
   # 예: AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12

   # 릴리스 키 (배포용) — 본인 keystore 경로로 변경
   keytool -list -v -keystore /path/to/release.keystore -alias your-alias
   ```
   디버그 키와 릴리스 키를 모두 등록하려면, 같은 패키지 이름으로 OAuth 클라이언트 ID 를 2개 만들면 돼요. 또는 디버그용은 개발 중에만 쓰고 릴리스용만 `.env.prod` 에 등록해도 동작해요.
6. **만들기** 를 누르고 **클라이언트 ID** 를 복사해요.

### 4단계: .env.prod 에 추가

발급받은 두 Client ID 를 환경변수로 적어요. `<SLUG>` 자리에는 앱 슬러그를 대문자로 넣어요 (예: `sumtally` → `SUMTALLY`).

```bash
# sumtally 앱 — Google Sign In
APP_CREDENTIALS_SUMTALLY_GOOGLE_CLIENT_IDS_0=123456789-ios.apps.googleusercontent.com
APP_CREDENTIALS_SUMTALLY_GOOGLE_CLIENT_IDS_1=987654321-android.apps.googleusercontent.com
```

서버는 Google 토큰의 [`aud`](../reference/glossary.md#인증--보안) (수신자) 값이 이 리스트에 들어 있는지 검증해요. iOS 기기에서 로그인하면 `aud` 가 iOS Client ID 가 되고, Android 에서 로그인하면 Android Client ID 가 돼요. 그래서 두 ID 를 모두 리스트에 넣어 둬야 양쪽 플랫폼이 다 통과해요.

---

## Apple Sign In

Apple 은 Google 과 달리 콘솔에서 별도의 "Client ID" 를 발급받지 않아요. 대신 앱의 **Bundle ID** 그 자체가 식별자 역할을 해요. 그래서 발급 작업은 "App ID 에 Sign In with Apple 기능을 켜는 것" 이 핵심이에요.

### 1단계: Apple Developer Program 가입 (최초 1회)

> 이미 가입했다면 건너뛰세요.

1. https://developer.apple.com/programs/ 에 접속해요.
2. **Enroll** 을 눌러 Apple ID 로 로그인해요.
3. 개인 또는 조직을 선택하고 연간 $99 를 결제해요.
4. 승인까지 보통 24~48시간이 걸려요.

### 2단계: App ID 등록 (앱별 1회)

1. https://developer.apple.com/account 에서 **Certificates, Identifiers & Profiles** 로 들어가요.
2. 좌측 메뉴 **Identifiers** 에서 상단 **+** 버튼을 눌러요.
3. **App IDs** 를 선택하고 Continue 를 눌러요.
4. 타입은 **App** 을 선택하고 Continue 를 눌러요.
5. 값을 입력해요.
   - Description: `Sumtally` (앱 이름)
   - Bundle ID: **Explicit** 을 선택하고 `com.twosun.sumtally` 를 입력해요. 이 값은 Xcode 와 Flutter 프로젝트의 Bundle Identifier 와 반드시 같아야 해요.
6. Capabilities 목록에서 **Sign In with Apple** 을 체크해요.
7. **Continue → Register** 를 눌러요.

> 이미 Xcode 에서 앱을 만들면서 App ID 가 자동 등록된 경우라면, Identifiers 목록에서 그 앱을 클릭하고 Capabilities 에서 **Sign In with Apple** 만 체크하면 돼요.

### 3단계: Xcode 프로젝트 설정

1. Xcode 에서 Runner 프로젝트를 열어요.
2. **Signing & Capabilities** 탭으로 가요.
3. **+ Capability** 를 눌러 **Sign in with Apple** 을 추가해요.
4. Team 이 Apple Developer 계정으로 설정돼 있는지 확인해요.
5. Bundle Identifier 가 위에서 등록한 값과 같은지 확인해요.

### 4단계: .env.prod 에 추가

```bash
# sumtally 앱 — Apple Sign In
APP_CREDENTIALS_SUMTALLY_APPLE_BUNDLE_ID=com.twosun.sumtally
```

서버는 Apple 이 발급한 identity token 을 [`JWKS`](../reference/glossary.md#인증--보안) (Apple 공개키) 로 RS256 서명 검증한 뒤, 그 토큰의 `aud` 값이 이 Bundle ID 와 일치하는지 확인해요.

> Apple Sign In 은 iOS 기기에서만 쓰여요. Android 에서는 Google Sign In 만 제공돼요.

---

## Kakao Sign In

> 한국 시장 앱이면 거의 항상 활성화해요. 글로벌 전용 앱이면 이 섹션을 건너뛰세요.

Kakao 는 다른 provider 와 한 가지가 달라요 — **같은 앱에서 키가 두 개** 나오고, 둘이 서로 다른 자리에 들어가요. 여기서 가장 많이 헷갈리니 먼저 짚고 넘어갈게요.

### 키 두 개의 자리 — 헷갈림 주의

카카오 디벨로퍼스 콘솔의 같은 앱 등록 페이지에서 식별자 두 개가 나란히 발급돼요.

| 키 | 형태 | 들어가는 자리 |
|---|---|---|
| Native App Key | 32자 문자열 (예: `1234567890abcdef1234567890abcdef`) | 프론트만 — Flutter 의 `kakao{KEY}` redirect scheme + `KakaoSdk.init()` |
| App ID | 숫자 (예: `1234567`) | 백엔드만 — 토큰 검증 시 `/v1/user/access_token_info` 응답의 `app_id` 와 매칭 |

콘솔 대시보드에 둘 다 보여요. 각자의 자리에 둘 다 등록해야 동작하고, 한 쪽만 등록하면 검증에 실패해요. **이 문서(백엔드)에는 숫자인 App ID 만** 넣어요.

### 1단계: Kakao Developers 앱 등록 (앱별 1회)

1. https://developers.kakao.com 에 접속해 카카오 계정으로 로그인해요.
2. **내 애플리케이션 → 애플리케이션 추가하기** 를 눌러요.
3. 값을 입력해요.
   - 앱 이름: `Sumtally` (표시명, 자유롭게)
   - 사업자명: 본인 또는 조직명
   - 카테고리: 앱 성격에 맞게
4. **저장** 을 눌러 앱 대시보드로 들어가요.
5. **앱 키** 메뉴에서 두 값을 확인해요.
   - **네이티브 앱 키** (32자 문자열) — 프론트용
   - **앱 ID** (숫자) — 백엔드용. 페이지 상단이나 URL `/applications/{ID}` 의 ID 로 확인해요.

### 2단계: 플랫폼 등록

1. 앱 대시보드에서 **플랫폼** 메뉴로 가요.
2. **iOS 플랫폼 등록** 에서 번들 ID 를 입력해요 (`com.twosun.sumtally`).
3. **Android 플랫폼 등록** 에서 패키지명 (`com.twosun.sumtally`) 과 키 해시를 등록해요.
   ```bash
   # 디버그 키 해시
   keytool -exportcert -alias androiddebugkey -keystore ~/.android/debug.keystore -storepass android -keypass android | openssl sha1 -binary | openssl base64
   ```
   릴리스 키 해시는 본인 keystore 로 같은 명령을 실행하면 돼요.

### 3단계: 카카오 로그인 활성화

1. 앱 대시보드에서 **제품 설정 → 카카오 로그인** 으로 가요.
2. **활성화 설정** 을 ON 으로 바꿔요.
3. JWT 검증을 활용한다면 **OpenID Connect 활성화** 도 ON 으로 켜요 (선택).
4. **동의 항목** 에서 닉네임과 이메일을 활성화해요. 이메일은 "필수" 를 권장해요 — 백엔드가 이메일이 없으면 `email_required` 사유로 로그인을 거부하기 때문이에요.

### 4단계: .env.prod 에 추가

```bash
# sumtally 앱 — Kakao Sign In
APP_CREDENTIALS_SUMTALLY_KAKAO_APP_ID=1234567   # 숫자 App ID (Native App Key 아님!)
```

서버는 Kakao access token 으로 `/v1/user/access_token_info` 를 호출하고, 그 응답의 `app_id` 가 이 값과 일치하는지 검증해요.

> 프론트 (Flutter) 에는 Native App Key (문자열) 가 따로 들어가요. `template-flutter` 의 `auth-kit.md` 를 참조하세요.

---

## Naver Sign In

> 한국 시장 앱이면서 30~50대 포털 사용자 비중이 높을 때만 추가하세요. 20~30대 모바일 위주라면 보통 Kakao 만으로 충분해요.

Naver 는 발급이 가장 단출해요. 백엔드에 들어가는 값은 Client ID 하나뿐이에요.

### 1단계: Naver Developers 앱 등록 (앱별 1회)

1. https://developers.naver.com 에 접속해 네이버 계정으로 로그인해요.
2. **Application → 애플리케이션 등록** 을 눌러요.
3. 값을 입력해요.
   - 애플리케이션 이름: `Sumtally`
   - 사용 API: **네이버 로그인** 을 선택해요.
   - 제공 정보: **이메일 주소** 를 필수로 체크해요 (백엔드가 이메일 미동의 시 로그인을 거부해요).
   - 환경 추가: **iOS 설정** 과 **Android 설정** 을 모두 추가해요.
     - iOS: 다운로드 URL (App Store URL — 없으면 임시 placeholder), 번들 ID
     - Android: 다운로드 URL, 패키지명
4. 등록을 마치고 다음 값을 확인해요.
   - **Client ID** (예: `abcDEF123_xyz`)
   - **Client Secret** — 발급은 되지만 백엔드에서는 쓰지 않아요.
   - **URL Scheme** — iOS 용으로 자동 발급돼요.

### 2단계: .env.prod 에 추가

```bash
# sumtally 앱 — Naver Sign In
APP_CREDENTIALS_SUMTALLY_NAVER_CLIENT_ID=abcDEF123_xyz
```

서버는 Naver access token 으로 `/v1/nid/me` 를 호출해 응답의 `resultcode` 가 `00` 인지와 이메일을 검증해요. Naver 가 토큰을 발급한 client 를 자체적으로 검증해 주므로 (다른 client 의 토큰은 401), Client Secret 은 백엔드에 등록하지 않아요.

---

## OAuth 키 발급 전 e2e 시연 (dev-mock 모드)

파생 레포를 만든 첫날, 위 네 provider 의 콘솔 작업이 하나도 안 된 상태에서도 백엔드와 프론트의 종단 흐름을 시연할 수 있어요. 작동 방식은 두 갈래예요. WireMock 컨테이너가 Google·Kakao·Naver 의 HTTP endpoint 를 가짜 응답으로 stub 하고, Apple 만은 별도의 `MockAppleSignInService` 가 RS256 서명 검증을 우회해요. Apple 토큰은 HTTP 응답이 아니라 토큰 자체가 RS256 으로 서명돼 있어 HTTP stub 만으로는 통과시킬 수 없기 때문이에요.

### 1단계: WireMock 컨테이너 띄우기

```bash
docker compose -f infra/docker-compose.local.yml up -d postgres wiremock
```

`infra/wiremock/mappings/` 의 stub JSON (`google-tokeninfo`, `kakao-token-info`, `kakao-user-me`, `naver-nid-me`) 이 자동으로 로드돼요. WireMock 컨테이너는 내부 8080 포트를 호스트의 9999 포트로 노출해요.

### 2단계: 백엔드를 dev-mock 모드로 부팅

Spring 을 호스트 JVM 에서 직접 띄우면 WireMock 에 호스트 포트 `localhost:9999` 로 닿아요. 그래서 OAuth URL 들을 그쪽으로 가리키게 환경변수로 잡아 줘요.

```bash
export APP_OAUTH_DEV_MOCK=true
export APP_OAUTH_GOOGLE_TOKENINFO_URL='http://localhost:9999/tokeninfo?id_token='
export APP_OAUTH_KAKAO_TOKEN_INFO_URL='http://localhost:9999/v1/user/access_token_info'
export APP_OAUTH_KAKAO_USER_ME_URL='http://localhost:9999/v2/user/me'
export APP_OAUTH_NAVER_USER_ME_URL='http://localhost:9999/v1/nid/me'

./gradlew :bootstrap:bootRun
```

`app.oauth.dev-mock=true` 가 `MockAppleSignInService` 를 활성화해요. 이 모드에서는 어떤 identity_token 이 와도 고정된 가짜 사용자 (`dev-apple-mock-user` / `dev-apple@example.com`) 로 통과시켜요.

> 모든 컨테이너를 docker compose 로 함께 띄우는 로컬 local 흐름에서는 Spring 컨테이너가 같은 docker 네트워크 안에서 WireMock 에 `http://wiremock:8080` 으로 닿아요. 이 기본값은 `application-local.yml` 에 이미 들어 있어, 그 경우엔 위 `export` 들이 필요 없어요. 위 명령은 *호스트 JVM 으로 직접 bootRun 할 때* 의 시연용이에요.

### 3단계: 프론트 dev-mock 빌드

```bash
flutter run --dart-define=AUTH_DEV_MOCK=true
```

프론트의 `DevMock*Gate` 가 즉시 dummy 토큰을 반환해요. 그 토큰이 백엔드 → WireMock 을 통과해 JWT 가 발급되고, `/home` 으로 자동 리다이렉트되면 종단 흐름이 검증된 거예요.

### 안전장치

이 모드가 운영에 새지 않도록, 모든 스위치는 환경변수를 명시적으로 주입해야만 켜져요. 주입하지 않으면 실 provider 로 자동 복귀해요.

| 환경변수 / dart-define | 미주입 시 동작 |
|---|---|
| `APP_OAUTH_DEV_MOCK=true` (백엔드) | `MockAppleSignInService` 비활성, 실 Apple JWKS 사용 |
| `APP_OAUTH_*_URL` (백엔드) | `application.yml` 의 기본값 (실 provider URL) 사용 |
| `--dart-define=AUTH_DEV_MOCK=true` (프론트) | 실 SDK 어댑터 사용 |

운영 빌드는 영향이 0 이에요. prod profile 은 wiremock URL 환경변수가 주입되지 않은 게 정상이라, 그대로 `application.yml` 의 실 provider URL 로 fallback 해요.

### 안전 확인용 부팅 로그

dev-mock 모드가 켜지면 부팅 시 다음 WARN 로그가 출력돼요.

```
WARN  MockAppleSignInService activated — Apple RS256 verification is BYPASSED.
      DO NOT enable this in production.
```

이 로그가 운영 환경에서 보이면 즉시 셧다운하고 환경변수를 점검해야 해요.

---

## 앱 추가 체크리스트

새 앱 `my-new-app` 을 추가할 때 provider 별로 체크하세요.

### Google
- [ ] Google Cloud 콘솔 → 사용자 인증 정보 → OAuth 클라이언트 ID → iOS 생성
- [ ] Google Cloud 콘솔 → 사용자 인증 정보 → OAuth 클라이언트 ID → Android 생성
- [ ] `.env.prod` 에 Client ID 2개 추가

### Apple
- [ ] Apple Developer → Identifiers 에서 App ID 에 Sign In with Apple 활성화
- [ ] Xcode → Signing & Capabilities 에서 Sign in with Apple 추가
- [ ] `.env.prod` 에 Bundle ID 추가

### Kakao (한국 시장 앱일 때만)
- [ ] Kakao Developers → 애플리케이션 추가 → 플랫폼 (iOS + Android) 등록
- [ ] 카카오 로그인 활성화 + 동의 항목 (이메일 필수)
- [ ] App ID (숫자) 복사 → 백엔드용
- [ ] Native App Key (문자열) 복사 → 프론트용 (template-flutter)
- [ ] `.env.prod` 에 App ID 추가

### Naver (한국 시장 앱 + 포털 사용자 비중이 높을 때만)
- [ ] Naver Developers → 애플리케이션 등록 → 사용 API: 네이버 로그인
- [ ] 제공 정보: 이메일 주소 필수
- [ ] iOS / Android 환경 추가
- [ ] Client ID 복사
- [ ] `.env.prod` 에 Client ID 추가

### .env.prod 추가 내용

```bash
# 필수 (글로벌·한국 모두)
APP_CREDENTIALS_MYNEWAPP_GOOGLE_CLIENT_IDS_0=xxx-ios.apps.googleusercontent.com
APP_CREDENTIALS_MYNEWAPP_GOOGLE_CLIENT_IDS_1=xxx-android.apps.googleusercontent.com
APP_CREDENTIALS_MYNEWAPP_APPLE_BUNDLE_ID=com.twosun.mynewapp

# 한국 시장 앱일 때 추가
APP_CREDENTIALS_MYNEWAPP_KAKAO_APP_ID=1234567               # 숫자 App ID (Native App Key 아님!)
APP_CREDENTIALS_MYNEWAPP_NAVER_CLIENT_ID=abcDEF123_xyz
```

> **`.env.prod` 에 적기만 해서는 운영에 반영되지 않아요.** 운영 secret 은 네 곳에 같은 키를 명시해야 흘러가요 — `.env.prod`, `config/deploy.yml`, `.kamal/secrets.example`, `.github/workflows/deploy.yml`. 자세한 체크리스트는 [`Secret Chain 4-Stage 동기화`](../production/setup/secret-chain-4stage.md) 를 참조하세요.

### 재배포

키를 추가했으면 운영을 다시 띄워야 반영돼요. 코드는 바뀌지 않으니, 같은 SHA 를 blue/green 으로 다시 굴리는 것뿐이에요.

```bash
<repo> prod deploy      # Kamal blue/green 재배포 (build + push + cutover)
```

`<repo>` 자리에는 본인 레포의 짧은 별칭이 들어가요. 배포 흐름과 롤백은 [`운영 런북`](../production/deploy/runbook.md) 에 정리돼 있어요.

> **환경변수 슬러그 표기** — 앱 슬러그는 대문자로 적고, 하이픈은 언더스코어로 바꿔요. 예: `my-new-app` → `MYNEWAPP` 처럼 붙여 쓰거나 `MY_NEW_APP` 으로 풀어 써도 Spring 의 relaxed binding 이 같은 키로 인식해요.

---

## FAQ

### Q: Google Cloud 프로젝트를 앱마다 새로 만들어야 하나요?

아니요. `app-factory` 프로젝트 하나에서 OAuth 클라이언트 ID 만 앱별로 추가하면 돼요.

### Q: OAuth 동의 화면도 앱마다 설정해야 하나요?

아니요. 프로젝트당 1회 설정으로 충분해요.

### Q: 개발 중에는 어떻게 테스트하나요?

로컬 local 은 WireMock stub 으로 실 키 없이 동작해요. 실제 Google/Apple 로그인까지 테스트하려면 `.env` 에 발급받은 Client ID 와 `APP_OAUTH_DEV_MOCK=false`, 그리고 실 provider URL 을 명시해 stub 을 끄세요.

### Q: 코드를 수정해야 하는 경우가 있나요?

없어요. `AppCredentialProperties` 가 환경변수를 `Map<String, AppCredential>` 로 자동 바인딩하고, 서비스가 요청의 [`appSlug`](../reference/glossary.md#이-레포-고유-용어) 로 그 credential 을 조회해요. 환경변수 추가와 재배포만 하면 돼요.

### Q: Kakao 의 키 두 개가 헷갈려요. 어디에 어느 걸 넣나요?

발급되는 두 키의 자리가 서로 달라요.

- Native App Key (32자 문자열) → 프론트 (Flutter) 의 `Info.plist` URL scheme + `KakaoSdk.init()`
- App ID (숫자) → 백엔드 (이 문서) 의 `APP_CREDENTIALS_<SLUG>_KAKAO_APP_ID`

둘 다 같은 카카오 콘솔 대시보드에 나란히 보여요. 한 쪽이라도 빠지거나 바뀌면 동작하지 않아요.

### Q: dev-mock 모드는 운영 빌드에 영향이 있나요?

없어요. `app.oauth.dev-mock=true` 환경변수가 명시적으로 주입돼야만 `MockAppleSignInService` 가 활성화돼요. prod profile 에서는 wiremock URL 환경변수가 주입되지 않은 게 정상이라, `application.yml` 의 실 provider URL 로 fallback 해요.

### Q: dev-mock 모드가 켜졌는지 어떻게 확인하나요?

부팅 로그에 다음 WARN 한 줄이 보이면 dev-mock 모드예요.

```
WARN  MockAppleSignInService activated — Apple RS256 verification is BYPASSED.
```

운영 환경에서 이 로그가 보이면 즉시 셧다운하고 `APP_OAUTH_DEV_MOCK` 환경변수를 점검하세요.

---

## 관련 코드

각 provider 의 검증 로직은 `core/core-auth-impl` 에 모여 있어요.

| 파일 | 역할 |
|---|---|
| `AppCredentialProperties.java` | 환경변수를 `Map<String, AppCredential>` 로 바인딩. 4 provider 의 client id / bundle id / app id 를 통합 관리합니다. |
| `AuthAutoConfiguration.java` | 4개 SignInService bean 을 등록합니다. `app.oauth.dev-mock=true` 일 때 Apple 빈만 `MockAppleSignInService` 로 교체됩니다. |
| `service/GoogleSignInService.java` | appSlug 로 Client ID 리스트를 조회해 토큰의 `aud` 를 검증합니다. |
| `service/AppleSignInService.java` | appSlug 로 Bundle ID 를 조회하고, JWKS 기반 RS256 서명을 검증합니다. |
| `service/KakaoSignInService.java` | `/v1/user/access_token_info` (app_id 매칭) 와 `/v2/user/me` (이메일 + 닉네임) 를 호출합니다. |
| `service/NaverSignInService.java` | `/v1/nid/me` 를 호출해 `resultcode=00` 과 이메일을 검증합니다. |
| `service/dev/MockAppleSignInService.java` | dev 전용. RS256 검증을 우회하고 고정 가짜 사용자로 통과시킵니다 (`app.oauth.dev-mock=true` 일 때만 활성). |
| `infra/wiremock/mappings/*.json` | dev-mock 모드용 Google/Kakao/Naver stub 응답. |

---

## 책 목차 — Journey 4단계

[`template-spring — 책 목차 (Developer Journey)`](../onboarding/README.md) 의 **4단계 — 발급은 어디서?** 의 첫 항목 (소셜 로그인) 이에요.

| 방향 | 문서 | 한 줄 |
|---|---|---|
| ← 이전 | [`Onboarding — 템플릿 첫 사용 가이드`](./onboarding.md) | 2~3단계, 로컬 개발 + 첫 앱 모듈 |
| → 다음 | [`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md) §3 | 4단계 두 번째, 운영 자격 증명 (Tailscale OAuth · GitHub PAT · Supabase) |

**막혔을 때 참고:**
- 운영 함정 모음: [`도그푸딩 함정`](./dogfood-pitfalls.md)
- 자주 묻는 질문: [`FAQ`](./dogfood-faq.md)
- 시간 순 따라가기: [`도그푸딩 walkthrough`](./dogfood-walkthrough.md)

**왜 이렇게 설계했나:**
- [`ADR-002 · Use this template`](../philosophy/adr-002-use-this-template.md) — 템플릿 패턴
- [`ADR-012 · 앱별 독립 유저 모델`](../philosophy/adr-012-per-app-user-model.md) — 앱별 독립 유저 모델
- [`인프라 결정 기록`](../production/deploy/decisions-infra.md) — 인프라 결정의 배경
