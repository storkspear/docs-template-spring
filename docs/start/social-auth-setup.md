# 소셜 로그인 설정 가이드

앱 추가 시 Google/Apple 소셜 로그인을 위한 credential 설정 방법입니다.

---

## 전체 흐름

```
1. Google Cloud / Apple Developer 에서 credential 발급
2. .env.prod 에 환경변수 추가
3. 재배포 (코드 수정 없음)
```

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

### .env.prod 추가 내용

```bash
APP_CREDENTIALS_MYNEWAPP_GOOGLE_CLIENT_IDS_0=xxx-ios.apps.googleusercontent.com
APP_CREDENTIALS_MYNEWAPP_GOOGLE_CLIENT_IDS_1=xxx-android.apps.googleusercontent.com
APP_CREDENTIALS_MYNEWAPP_APPLE_BUNDLE_ID=com.twosun.mynewapp
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

---

## 관련 코드

- `AppCredentialProperties.java` — 환경변수 → `Map<String, AppCredential>` 바인딩
- `GoogleSignInService.java` — appSlug 로 Client ID 리스트 조회 후 `aud` 검증
- `AppleSignInService.java` — appSlug 로 Bundle ID 조회 후 `aud` 검증

---

## 📖 책 목차 — Journey 4단계

[`📚 template-spring — 책 목차 (Developer Journey)`](../onboarding/README.md) 의 **4단계 — 발급은 어디서?** 의 첫 항목 (소셜 로그인) 입니다.

| 방향 | 문서 | 한 줄 |
|---|---|---|
| ← 이전 | [`Onboarding — 템플릿 첫 사용 가이드`](./onboarding.md) | 2~3단계, 로컬 dev + 첫 앱 모듈 |
| → 다음 | [`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md) §3 | 4단계 두 번째, 운영 자격 증명 (Tailscale OAuth · GitHub PAT · Supabase) |

**막혔을 때**: [`도그푸딩 함정`](./dogfood-pitfalls.md) / [`FAQ`](./dogfood-faq.md)
**왜 이렇게?**: [`ADR-002 (template 패턴)`](../philosophy/adr-002-use-this-template.md), [`ADR-012 (앱별 독립 유저 모델)`](../philosophy/adr-012-per-app-user-model.md) / [`인프라 결정 기록 (Decisions — Infrastructure)`](../production/deploy/decisions-infra.md)
