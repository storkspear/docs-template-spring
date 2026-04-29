# 소셜 로그인 설정 가이드

앱 추가 시 4 provider 소셜 로그인 (Google · Apple · Kakao · Naver) 을 위한 credential 설정 방법입니다.

---

## 전체 흐름

```
1. 활성화할 provider 결정 (글로벌이면 Google+Apple, 한국이면 +Kakao+Naver)
2. 각 provider 콘솔에서 credential 발급
3. .env.prod 에 환경변수 추가
4. 재배포 (코드 수정 없음)
```

> **활성 안 한 provider 는 이 가이드의 해당 섹션 전부 생략 가능**. 예: 글로벌 시장 앱이면 Kakao/Naver 섹션은 무시하고 Google + Apple 만 따라가면 됩니다.

> **OAuth 키 발급 전 e2e 시연** 이 필요하면 [dev-mock 모드 섹션](#oauth-키-발급-전-e2e-시연-dev-mock-모드) 을 먼저 참조하세요. WireMock 컨테이너로 4 provider 를 통째 가짜로 띄워 키 없이도 백엔드 → JWT 발급 흐름을 검증할 수 있습니다.

---

## Google Sign In

### 1단계: Google Cloud 프로젝트 생성 (최초 1회)

> 이미 `app-factory` 프로젝트를 생성했다면 이 단계는 건너뛰세요.

1. https://console.cloud.google.com 접속
2. 상단 프로젝트 선택 드롭다운 → **새 프로젝트**
3. 프로젝트 이름: `app-factory` → 만들기
4. 이 프로젝트는 모든 앱에서 공유합니다. 앱마다 새로 만들 필요 없습니다.

### 2단계: OAuth 동의 화면 설정 (최초 1회)

> 이미 설정했다면 건너뛰세요.

1. 좌측 메뉴 → **APIs & Services** → **OAuth 동의 화면**
   - 메뉴가 안 보이면 상단 검색창에 "OAuth" 검색
2. **외부** 선택 → 만들기
3. 필수 입력:
   - 앱 이름: `App Factory`
   - 사용자 지원 이메일: `dev**rhexa***@gmail.com`
   - 개발자 연락처 이메일: `dev**rhexa***@gmail.com`
4. 나머지는 비워두고 **저장 후 계속** → 끝까지 쭉 다음
5. **앱 게시** (선택) — 테스트 모드에서는 등록된 테스트 사용자만 로그인 가능합니다.
   출시 전에 "프로덕션으로 푸시"를 눌러야 모든 사용자가 로그인할 수 있습니다.

### 3단계: 앱별 OAuth 클라이언트 ID 발급

앱 하나당 **iOS용 1개 + Android용 1개 = 2개** 만들어야 합니다.
Flutter 앱이 iOS/Android 각각에서 Google 로그인할 때 플랫폼별 Client ID가 다르기 때문입니다.

콘솔 위치: https://console.cloud.google.com → **APIs & Services** → **사용자 인증 정보**

#### iOS용

1. **+ 사용자 인증 정보 만들기** → **OAuth 클라이언트 ID** 선택
2. 애플리케이션 유형: **iOS**
3. 이름: `sumtally-ios` (앱 구분용, 자유롭게)
4. **번들 ID** 입력:
   - Flutter 프로젝트에서 확인: `ios/Runner.xcodeproj` → Xcode 열기 → Runner → General → **Bundle Identifier**
   - 또는 `ios/Runner/Info.plist` 에서 `CFBundleIdentifier` 값 확인
   - 예: `com.twosun.sumtally`
5. **만들기** 클릭
6. 화면에 표시되는 **클라이언트 ID** 를 복사합니다
   - 형태: `123456789-xxxxxxxxxxxx.apps.googleusercontent.com`
   - 이 값이 `.env.prod` 의 `GOOGLE_CLIENT_IDS_0` 에 들어갑니다

#### Android용

1. **+ 사용자 인증 정보 만들기** → **OAuth 클라이언트 ID** 선택
2. 애플리케이션 유형: **Android**
3. 이름: `sumtally-android`
4. **패키지 이름** 입력:
   - Flutter 프로젝트에서 확인: `android/app/build.gradle` 의 `namespace` 또는 `applicationId`
   - 예: `com.twosun.sumtally`
   - iOS 번들 ID와 동일하게 맞추는 것을 권장합니다
5. **SHA-1 인증서 지문** 입력:
   ```bash
   # 디버그 키 (개발 중 테스트용)
   keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android
   # 출력에서 "SHA1:" 뒤의 값을 복사합니다
   # 예: AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12

   # 릴리스 키 (배포용) — 본인 keystore 경로로 변경
   keytool -list -v -keystore /path/to/release.keystore -alias your-alias
   ```
   - 디버그/릴리스 키 모두 등록하려면 같은 패키지 이름으로 OAuth 클라이언트 ID를 **2개** 만드세요
   - 또는 디버그용은 개발 중에만 쓰고, 릴리스용만 `.env.prod` 에 등록해도 됩니다
6. **만들기** 클릭 → **클라이언트 ID** 복사

### 4단계: .env.prod 에 추가

```bash
# sumtally 앱 — Google Sign In
APP_CREDENTIALS_SUMTALLY_GOOGLE_CLIENT_IDS_0=123456789-ios.apps.googleusercontent.com
APP_CREDENTIALS_SUMTALLY_GOOGLE_CLIENT_IDS_1=987654321-android.apps.googleusercontent.com
```

서버는 Google 토큰의 `aud` 값이 이 리스트에 포함되는지 검증합니다.
iOS 기기에서 로그인하면 `aud` 가 iOS Client ID, Android에서 로그인하면 Android Client ID가 됩니다.

---

## Apple Sign In

### 1단계: Apple Developer Program 가입 (최초 1회)

> 이미 가입했다면 건너뛰세요.

1. https://developer.apple.com/programs/ 접속
2. **Enroll** → Apple ID 로 로그인
3. 개인 또는 조직 선택 → 연간 $99 결제
4. 승인까지 보통 24~48시간 소요

### 2단계: App ID 등록 (앱별 1회)

1. https://developer.apple.com/account → **Certificates, Identifiers & Profiles**
2. 좌측 메뉴 → **Identifiers** → 상단 **+** 버튼
3. **App IDs** 선택 → Continue
4. 타입: **App** 선택 → Continue
5. 입력:
   - Description: `Sumtally` (앱 이름)
   - Bundle ID: **Explicit** 선택 → `com.twosun.sumtally` 입력
     - 이 값은 Xcode 와 Flutter 프로젝트에서 사용하는 Bundle Identifier 와 반드시 동일해야 합니다
6. Capabilities 목록에서 **Sign In with Apple** 체크
7. **Continue** → **Register**

> 이미 Xcode 에서 앱을 만들면서 App ID 가 자동 등록된 경우, Identifiers 목록에서 해당 앱을 클릭하고 Capabilities 에서 **Sign In with Apple** 을 체크하면 됩니다.

### 3단계: Xcode 프로젝트 설정

1. Xcode → Runner 프로젝트 열기
2. **Signing & Capabilities** 탭
3. **+ Capability** → **Sign in with Apple** 추가
4. Team 이 Apple Developer 계정으로 설정되어 있는지 확인
5. Bundle Identifier 가 위에서 등록한 값과 동일한지 확인

### 4단계: .env.prod 에 추가

```bash
# sumtally 앱 — Apple Sign In
APP_CREDENTIALS_SUMTALLY_APPLE_BUNDLE_ID=com.twosun.sumtally
```

서버는 Apple identity token 의 `aud` 값이 이 Bundle ID 와 일치하는지 검증합니다.

> Apple Sign In 은 iOS 기기에서만 사용됩니다 (Android 에서는 Google Sign In 만 제공).

---

## Kakao Sign In

> 한국 시장 앱이면 거의 항상 활성화. 글로벌 전용이면 이 섹션 생략.

### ⚠️ Kakao 만 키 2개 — 헷갈림 주의

카카오 디벨로퍼스 콘솔의 **같은 앱 등록 페이지**에서 두 개의 식별자가 발급됩니다:

| 키 | 형태 | 어디에 들어가나 |
|---|---|---|
| **Native App Key** | 32자 문자열 (예: `1234567890abcdef1234567890abcdef`) | **프론트만** — Flutter 의 `kakao{KEY}` redirect scheme + `KakaoSdk.init()` |
| **App ID** | 숫자 (예: `1234567`) | **백엔드만** — 토큰 검증 시 `/v1/user/access_token_info` 응답의 `app_id` 매칭 |

콘솔 대시보드에 둘 다 나란히 표시됩니다. **둘 다 복사해서 각자 자리에 등록**해야 동작합니다. 한 쪽만 등록하면 검증 실패.

### 1단계: Kakao Developers 앱 등록 (앱별 1회)

1. https://developers.kakao.com 접속 → 카카오 계정 로그인
2. **내 애플리케이션** → **애플리케이션 추가하기**
3. 입력:
   - 앱 이름: `Sumtally` (앱 표시명, 자유롭게)
   - 사업자명: 본인 또는 조직명
   - 카테고리: 앱 성격에 맞게
4. **저장** → 앱 대시보드 진입
5. **앱 키** 메뉴에서 두 값 확인:
   - **앱 키** 섹션의 **네이티브 앱 키** (32자 문자열) — 프론트용
   - **앱 ID** (숫자) — 백엔드용 (페이지 상단 또는 URL `/applications/{ID}` 의 ID)

### 2단계: 플랫폼 등록

1. 앱 대시보드 → **플랫폼** 메뉴
2. **iOS 플랫폼 등록** → 번들 ID 입력 (`com.twosun.sumtally`)
3. **Android 플랫폼 등록** → 패키지명 입력 (`com.twosun.sumtally`) + 키 해시 등록
   - 디버그 키 해시:
     ```bash
     keytool -exportcert -alias androiddebugkey -keystore ~/.android/debug.keystore -storepass android -keypass android | openssl sha1 -binary | openssl base64
     ```
   - 릴리스 키 해시: 본인 keystore 로 동일 명령

### 3단계: 카카오 로그인 활성화

1. 앱 대시보드 → **제품 설정** → **카카오 로그인**
2. **활성화 설정** ON
3. **OpenID Connect 활성화** ON (선택, JWT 검증 활용 시)
4. **동의 항목** → 닉네임 + 이메일 활성화 (이메일은 "선택" 또는 "필수")
   - "필수" 권장 — 백엔드가 이메일 누락 시 `email_required` 401 응답

### 4단계: .env.prod 에 추가

```bash
# sumtally 앱 — Kakao Sign In
APP_CREDENTIALS_SUMTALLY_KAKAO_APP_ID=1234567   # 숫자 (Native App Key 아님!)
```

서버는 Kakao access token 으로 `/v1/user/access_token_info` 호출 → 응답의 `app_id` 가 이 값과 일치하는지 검증합니다.

> 프론트 (Flutter) 에는 Native App Key (문자열) 가 따로 들어갑니다 — `template-flutter` 의 `auth-kit.md` 참조.

---

## Naver Sign In

> 한국 시장 + 30~50대 포털 사용자 비중 높을 때만 추가. 20~30대 모바일 위주면 보통 Kakao 만으로 충분.

### 1단계: Naver Developers 앱 등록 (앱별 1회)

1. https://developers.naver.com 접속 → 네이버 계정 로그인
2. **Application** → **애플리케이션 등록**
3. 입력:
   - 애플리케이션 이름: `Sumtally`
   - 사용 API: **네이버 로그인** 선택
   - 제공 정보: **이메일 주소** 필수 (백엔드가 이메일 미동의 시 거부)
   - 환경 추가: **iOS 설정** + **Android 설정**
     - iOS: 다운로드 URL (App Store URL — 없으면 임시 placeholder), 번들 ID
     - Android: 다운로드 URL, 패키지명
4. 등록 완료 후:
   - **Client ID** 확인 (예: `abcDEF123_xyz`)
   - **Client Secret** 확인 (백엔드 미사용이지만 발급은 됨)
   - **URL Scheme** (iOS 용, 자동 발급)

### 2단계: .env.prod 에 추가

```bash
# sumtally 앱 — Naver Sign In
APP_CREDENTIALS_SUMTALLY_NAVER_CLIENT_ID=abcDEF123_xyz
```

서버는 Naver access token 으로 `/v1/nid/me` 호출 → 응답 `resultcode=00` + 이메일 검증. Naver 가 자체적으로 토큰 발급 client 검증을 하므로 (다른 client 토큰은 401) Client Secret 은 백엔드에 등록 안 합니다.

---

## OAuth 키 발급 전 e2e 시연 (dev-mock 모드)

파생 레포 만든 첫날, 위 4 provider 의 콘솔 작업이 **하나도 안 된 상태**에서도 백엔드 + 프론트 종단 흐름을 시연할 수 있습니다. WireMock standalone 컨테이너가 Google/Kakao/Naver 의 4 endpoint 를 가짜 응답으로 stub 하고, Apple 만 별도 `MockAppleSignInService` 가 RS256 검증을 우회합니다.

### 1단계: WireMock 컨테이너 띄우기

```bash
cd infra
docker compose -f docker-compose.dev.yml up -d postgres wiremock
```

`infra/wiremock/mappings/` 의 4개 stub JSON (google-tokeninfo, kakao-token-info, kakao-user-me, naver-nid-me) 이 자동 로드됩니다.

### 2단계: 백엔드 dev-mock 모드로 부팅

```bash
export APP_OAUTH_DEV_MOCK=true
export APP_OAUTH_GOOGLE_TOKENINFO_URL='http://localhost:9999/tokeninfo?id_token='
export APP_OAUTH_KAKAO_TOKEN_INFO_URL='http://localhost:9999/v1/user/access_token_info'
export APP_OAUTH_KAKAO_USER_ME_URL='http://localhost:9999/v2/user/me'
export APP_OAUTH_NAVER_USER_ME_URL='http://localhost:9999/v1/nid/me'

./gradlew :apps:app-template:bootRun
```

`app.oauth.dev-mock=true` 가 `MockAppleSignInService` 를 활성화 — 어떤 identity_token 이 와도 고정 fake user (`dev-apple-mock-user` / `dev-apple@example.com`) 로 통과시킵니다.

### 3단계: 프론트 dev-mock 빌드

```bash
flutter run --dart-define=AUTH_DEV_MOCK=true
```

프론트의 `DevMock*Gate` 가 즉시 dummy 토큰 반환 → 백엔드 → WireMock 통과 → JWT 발급 → /home 자동 리다이렉트.

### 안전장치

| 환경변수 / dart-define | 미주입 시 동작 |
|---|---|
| `APP_OAUTH_DEV_MOCK=true` (백엔드) | `MockAppleSignInService` 비활성, 실 Apple JWKS 사용 |
| `APP_OAUTH_*_URL` (백엔드) | `application.yml` 의 default (실 provider URL) 사용 |
| `--dart-define=AUTH_DEV_MOCK=true` (프론트) | 실 SDK 어댑터 사용 |

→ **운영 빌드는 영향 0**. prod profile 은 wiremock URL 환경변수 미주입 시 실 provider URL 로 fallback (안전망).

### 안전 확인용 부팅 로그

dev-mock 모드 활성 시 다음 WARN 로그가 출력됩니다:
```
WARN  MockAppleSignInService activated — Apple RS256 verification is BYPASSED.
      DO NOT enable this in production.
```

이 로그가 운영 환경에서 보이면 즉시 셧다운 + 환경변수 점검.

---

## 앱 추가 체크리스트

새 앱 `my-new-app` 을 추가할 때:

### Google
- [ ] Google Cloud 콘솔 → 사용자 인증 정보 → OAuth 클라이언트 ID → **iOS** 생성
- [ ] Google Cloud 콘솔 → 사용자 인증 정보 → OAuth 클라이언트 ID → **Android** 생성
- [ ] `.env.prod` 에 Client ID 2개 추가

### Apple
- [ ] Apple Developer → Identifiers 에서 App ID 에 **Sign In with Apple** 활성화
- [ ] Xcode → Signing & Capabilities 에서 **Sign in with Apple** 추가
- [ ] `.env.prod` 에 Bundle ID 추가

### Kakao (한국 시장 앱일 때만)
- [ ] Kakao Developers → 애플리케이션 추가 → 플랫폼 (iOS + Android) 등록
- [ ] **카카오 로그인** 활성화 + 동의 항목 (이메일 필수)
- [ ] **App ID (숫자)** 복사 → 백엔드용
- [ ] **Native App Key (문자열)** 복사 → 프론트용 (template-flutter)
- [ ] `.env.prod` 에 App ID 추가

### Naver (한국 시장 앱 + 포털 사용자 비중 높을 때만)
- [ ] Naver Developers → 애플리케이션 등록 → 사용 API: 네이버 로그인
- [ ] 제공 정보: **이메일 주소 필수**
- [ ] iOS / Android 환경 추가
- [ ] **Client ID** 복사
- [ ] `.env.prod` 에 Client ID 추가

### .env.prod 추가 내용

```bash
# 필수 (글로벌·한국 모두)
APP_CREDENTIALS_MYNEWAPP_GOOGLE_CLIENT_IDS_0=xxx-ios.apps.googleusercontent.com
APP_CREDENTIALS_MYNEWAPP_GOOGLE_CLIENT_IDS_1=xxx-android.apps.googleusercontent.com
APP_CREDENTIALS_MYNEWAPP_APPLE_BUNDLE_ID=com.twosun.mynewapp

# 한국 시장 앱일 때 추가
APP_CREDENTIALS_MYNEWAPP_KAKAO_APP_ID=1234567               # 숫자 (Native App Key 아님!)
APP_CREDENTIALS_MYNEWAPP_NAVER_CLIENT_ID=abcDEF123_xyz
```

### 재배포

```bash
docker restart factory-app
```

> **환경변수 네이밍 규칙:** 앱 slug 는 대문자로, 하이픈은 언더스코어로 변환합니다.
> 예: `my-new-app` → `MY_NEW_APP`

---

## FAQ

### Q: Google Cloud 프로젝트를 앱마다 새로 만들어야 하나요?

아니요. `app-factory` 프로젝트 하나에서 OAuth 클라이언트 ID 만 앱별로 추가하면 됩니다.

### Q: OAuth 동의 화면도 앱마다 설정해야 하나요?

아니요. 프로젝트당 1회 설정이면 충분합니다.

### Q: 개발 중에는 어떻게 테스트하나요?

`application-dev.yml` 에 dev 용 credential 이 설정되어 있습니다. 실제 Google/Apple 로그인을 테스트하려면 해당 값을 실제 발급받은 Client ID 로 교체하세요.

### Q: 코드를 수정해야 하는 경우가 있나요?

없습니다. `AppCredentialProperties` 가 환경변수를 `Map<String, AppCredential>` 로 자동 바인딩하고, 서비스가 요청의 `appSlug` 로 조회합니다. 환경변수 추가 + 재배포만 하면 됩니다.

### Q: Kakao 의 키 두 개가 헷갈립니다. 어디에 어느 걸 넣나요?

콘솔에서 발급되는 두 키의 위치가 다릅니다:
- **Native App Key (32자 문자열)** → 프론트 (Flutter) 의 `Info.plist` URL scheme + `KakaoSdk.init()` 에만
- **App ID (숫자)** → 백엔드 (이 문서) 의 `APP_CREDENTIALS_<SLUG>_KAKAO_APP_ID` 에만

둘 다 같은 카카오 콘솔 대시보드에서 나란히 보입니다. 한 쪽이라도 빠지거나 바뀌면 동작 안 합니다.

### Q: dev-mock 모드는 운영 빌드에 영향이 있나요?

없습니다. `app.oauth.dev-mock=true` 환경변수가 명시적으로 주입돼야만 `MockAppleSignInService` 가 활성화됩니다. prod profile 에서는 wiremock URL 환경변수도 미주입이 정상이라 `application.yml` 의 default (실 provider URL) 로 fallback 됩니다.

### Q: dev-mock 모드 활성 여부는 어떻게 확인하나요?

부팅 로그에서 다음 WARN 한 줄이 나오면 dev-mock 모드:
```
WARN  MockAppleSignInService activated — Apple RS256 verification is BYPASSED.
```
운영 환경에서 이 로그가 보이면 즉시 셧다운 + `APP_OAUTH_DEV_MOCK` 환경변수 점검.

---

## 관련 코드

- `AppCredentialProperties.java` — 환경변수 → `Map<String, AppCredential>` 바인딩 (4 provider 의 client id/secret 통합 관리)
- `AuthAutoConfiguration.java` — 4 SignInService bean 등록. dev profile + `app.oauth.dev-mock=true` 일 때 `MockAppleSignInService` 로 교체
- `GoogleSignInService.java` — appSlug 로 Client ID 리스트 조회 후 `aud` 검증
- `AppleSignInService.java` — appSlug 로 Bundle ID 조회 + JWKS 기반 RS256 서명 검증
- `KakaoSignInService.java` — `/v1/user/access_token_info` (app_id 매칭) + `/v2/user/me` (이메일 + 닉네임) 2회 호출
- `NaverSignInService.java` — `/v1/nid/me` 호출 + `resultcode=00` 검증 (Naver 가 자체적으로 client 검증)
- `dev/MockAppleSignInService.java` — dev 전용. RS256 검증 우회 + 고정 fake user (`app.oauth.dev-mock=true` 일 때만 활성)
- `infra/wiremock/mappings/*.json` — Google/Kakao/Naver stub 응답 (dev-mock 모드용)

---

## 📖 책 목차 — Journey 4단계

[`📚 template-spring — 책 목차 (Developer Journey)`](../onboarding/README.md) 의 **4단계 — 발급은 어디서?** 의 첫 항목 (소셜 로그인) 입니다.

| 방향 | 문서 | 한 줄 |
|---|---|---|
| ← 이전 | [`Onboarding — 템플릿 첫 사용 가이드`](./onboarding.md) | 2~3단계, 로컬 dev + 첫 앱 모듈 |
| → 다음 | [`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md) §3 | 4단계 두 번째, 운영 자격 증명 (Tailscale OAuth · GitHub PAT · Supabase) |

**막혔을 때**: [`도그푸딩 함정`](./dogfood-pitfalls.md) / [`FAQ`](./dogfood-faq.md)
**왜 이렇게?**: [`ADR-002 (template 패턴)`](../philosophy/adr-002-use-this-template.md), [`ADR-012 (앱별 독립 유저 모델)`](../philosophy/adr-012-per-app-user-model.md) / [`인프라 결정 기록 (Decisions — Infrastructure)`](../production/deploy/decisions-infra.md)
