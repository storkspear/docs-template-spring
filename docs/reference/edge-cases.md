# Edge Cases & Risk Analysis

이 문서는 앱 공장 모델에서 발생할 수 있는 엣지케이스를 분류하고, 각각의 영향과 해결 방법을 제시합니다.

**분류 기준:**
- 🔴 **대형 사고** — 한 번 발생하면 데이터 유출, 매출 손실, 법적 문제. 반드시 사전 차단.
- 🟡 **중간 리스크** — 서비스 장애나 UX 혼란. 대응 방안 필요.
- 🟢 **낮은 리스크** — 불편하지만 서비스에 심각한 영향 없음. 인지만 하면 됨.

---

## 1. 보안 (Security)

### 🔴 1-1. 크로스앱 데이터 접근 — JWT appSlug 와 API path 불일치

**시나리오:** 유저가 sumtally 와 rny 에 동일한 이메일/비밀번호로 가입. sumtally 앱이 실수로(또는 공격자가 의도적으로) rny 엔드포인트에 로그인 → rny JWT 획득 → 이 JWT 로 sumtally 엔드포인트 접근 시도. 만약 userId 가 우연히 일치하면 **다른 유저의 데이터가 노출**.

**영향:** 개인정보 유출 (가계부, 포트폴리오 데이터). 법적 문제 가능.

**해결:**
- `AppSlugVerificationFilter` 를 `common-security` 에 추가합니다.
- JWT 의 `appSlug` 클레임과 URL path 의 `/api/apps/{slug}/` 를 대조합니다.
- 불일치 시 `403 Forbidden` 반환. 로그에 경고 기록.
- 이 필터는 `JwtAuthFilter` 이후, 컨트롤러 이전에 실행됩니다.

**상태:** Phase 0 리팩토링에 포함. 필수.

---

### 🔴 1-2. JWT 비밀키 유출 — 모든 앱의 토큰 위조 가능

**시나리오:** JWT HS256 비밀키가 git 커밋, 로그 파일, 환경변수 노출 등으로 유출됨. 공격자가 임의의 userId + appSlug 로 JWT 를 위조하여 어떤 앱의 어떤 유저로든 접근 가능.

**영향:** 전체 서비스의 모든 유저 데이터 탈취 가능. 최악의 보안 사고.

**해결:**
- 비밀키는 **환경변수로만** 제공. `.env` 는 `.gitignore` 에 포함.
- `JwtProperties` compact constructor 가 **32 자 미만 키를 거부** (부팅 실패).
- 유출 감지 시: 즉시 키 교체 → 모든 JWT 무효화 → 모든 유저 재로그인 필요.
- **키 교체 절차**: `.env` 에서 `JWT_SECRET` 변경 → Spring Boot 재시작. 별도 마이그레이션 불필요.
- **이중 키 검증** (Phase 1 고려): 교체 기간 동안 old key + new key 모두 수용. `JwtService` 에 fallback key 지원 추가.

**상태:** 기본 방어 (키 길이 검증, .gitignore) 는 Phase 0 에 포함. 이중 키 검증은 Phase 1.

---

### 🔴 1-3. Refresh Token 탈취 — 장기간 세션 하이재킹

**시나리오:** 공격자가 네트워크 스니핑, 기기 탈취, 로컬 스토리지 접근 등으로 refresh token 획득. 유효 기간 (30 일) 동안 지속적 접근.

**영향:** 30 일간 해당 유저의 데이터 접근.

**해결 (이미 구현됨):**
- **Refresh token rotation**: 회전 시 old token 은 `usedAt` 으로 무효화. 같은 token 재사용 시 **family 전체 revoke** (탈취 감지).
- **SHA-256 해시 저장**: DB 에 raw token 저장하지 않음. DB 유출 시에도 토큰 위조 불가.
- **`REQUIRES_NEW` 트랜잭션으로 revoke**: 탈취 감지 시 rollback 되어도 revoke 는 유지.

**추가 권장 (Phase 1):**
- Refresh token 에 디바이스 fingerprint 바인딩 (User-Agent + IP 대역). 다른 기기에서 사용 시 거부.
- 비정상 사용 패턴 감지 (같은 token 이 서로 다른 IP 에서 동시 사용) → 자동 revoke.

**상태:** 기본 방어 (rotation + 탈취 감지) Phase 0 에 포함. fingerprint 바인딩 Phase 1.

---

### 🔴 1-4. Apple Sign In 계정 탈퇴 후 토큰 미 revoke — App Store 리젝

**시나리오:** 유저가 앱 내에서 "계정 삭제" 를 수행했지만, Apple 서버에 대한 revoke token 호출을 안 했을 경우. Apple 의 App Store Review Guideline 5.1.1(v) 는 **"앱이 Sign in with Apple 을 지원하면 탈퇴 시 Apple 에 토큰 revoke 요청을 보내야 한다"** 고 요구합니다.

**영향:** 앱 심사 거절 또는 기존 앱 삭제 조치.

**해결:**
- `WithdrawService` 에서 탈퇴 시 Apple 의 `https://appleid.apple.com/auth/revoke` 엔드포인트를 호출합니다.
- 이를 위해 `AppleSignInRequest.authorizationCode` 를 가입 시점에 저장하고, 이를 Apple 토큰 엔드포인트에서 refresh token 으로 교환하여 보관합니다.
- 탈퇴 시 이 Apple refresh token 으로 revoke 호출.

**상태:** `AppleSignInRequest` 에 `authorizationCode` 필드는 이미 추가됨 (E1/E2 리뷰 fix). Apple refresh token 저장 + revoke 호출은 **Phase 1 필수** (첫 iOS 앱 출시 전).

---

### 🟡 1-5. 비밀번호 재설정 이메일 — 다른 앱 컨텍스트로 전송

**시나리오:** 유저가 sumtally 에서 비밀번호 재설정 요청. 이메일 템플릿에 "rny 에서 비밀번호를 재설정하세요" 라고 표시되는 실수 (appSlug 가 이메일 템플릿에 잘못 전달).

**영향:** UX 혼란. 피싱으로 오해 가능.

**해결:**
- 비밀번호 재설정 토큰에 **appSlug 를 포함**합니다.
- 이메일 템플릿에 **앱 이름을 동적 삽입** (`"sumtally 에서 비밀번호를 재설정하세요"`).
- 재설정 확인 엔드포인트에서 **토큰의 appSlug 와 요청의 appSlug 대조**. 불일치 시 거부.

**상태:** Phase E.5 (PasswordResetService) 에서 구현 시 반영.

---

### 🟡 1-6. 이메일 열거 공격 (Email Enumeration)

**시나리오:** 공격자가 `POST /api/apps/sumtally/auth/email/signin` 에 다양한 이메일을 시도. 응답 메시지나 응답 시간이 "이메일 없음" vs "비밀번호 틀림" 을 구분할 수 있으면 유효한 이메일 목록을 수집 가능.

**영향:** 유저 이메일 목록 유출 → 스팸, 피싱, 소셜 엔지니어링.

**해결 (이미 구현됨):**
- `InvalidCredentialsException` 메시지가 이메일 없음 / 비밀번호 틀림 / 소셜 전용 유저 모두 **동일** (`"invalid email or password"`).
- 테스트 (`signIn_invalidCredentialsMessages_doNotDifferentiate`) 가 이 동작을 강제.
- **타이밍 공격 방어** (Phase 1 고려): 이메일이 없을 때도 BCrypt 더미 해싱을 수행하여 응답 시간을 일정하게.

---

### 🟡 1-7. Firebase Service Account Key 유출 — 무단 푸시 발송

**시나리오:** FCM service account JSON 파일이 git 에 커밋되거나 유출됨. 공격자가 모든 디바이스에 스팸 푸시 발송.

**영향:** 유저 신뢰 상실, 앱 삭제.

**해결:**
- Service account 파일은 **환경변수 경로로만** 참조 (`FCM_CREDENTIALS_PATH`).
- git 에 커밋 금지 (`.gitignore` 에 `*.json` 은 안 넣되, 구체 파일명 기반 관리).
- Firebase Console 에서 key rotation 가능 (old key 즉시 비활성화 + new key 생성).
- **최소 권한**: service account 에 `Firebase Cloud Messaging send` 권한만 부여. Admin 권한 금지.

---

### 🟡 1-8. CORS 미설정 상태에서 브라우저 기반 공격

**시나리오:** 현재 `SecurityConfig` 에 CORS 설정 없음 (mobile-first 템플릿이라 의도적 미설정). 하지만 나중에 웹 클라이언트(관리자 대시보드 등) 를 추가하면 CORS 가 필요해짐. 설정 없이 웹 클라이언트를 붙이면 CSRF-like 공격에 노출 가능.

**영향:** 웹 클라이언트 추가 시점에 보안 구멍.

**해결:**
- 현재 Phase 0 에서는 CORS 미설정이 맞음 (모바일만).
- 웹 클라이언트 추가 시 **반드시** `CorsConfigurationSource` bean 을 정의하고 허용 origin 을 제한.
- 이 문서를 향후 담당자가 참조할 수 있도록 `SecurityConfig` javadoc 에 경고 포함.

---

### 🔴 1-9. Apple Sign In — 클라이언트 제출 email 신뢰 시 계정 탈취

**시나리오:** Apple identity token 의 `email` claim 과 별도로 클라이언트가 `request.email` 을 전송할 수 있다. 만약 서버가 클라이언트가 보낸 `request.email` 을 Apple 이 RS256 으로 서명한 `tokenEmail` 보다 우선 사용하면, 공격자가 자기 Apple 계정의 identity token 으로 피해자의 이메일 주소를 가진 계정을 생성할 수 있다.

**영향:** 공격자가 피해자 이메일로 계정을 생성하여 해당 이메일의 소유자로 위장.

**해결 (구현됨):**
- `AppleSignInService.signIn()` 에서 **Apple 이 서명한 `tokenEmail` 을 항상 우선** 사용.
- `request.email` 은 token 에 email claim 이 없는 경우에만 fallback 으로 사용 (Apple "Hide My Email" 또는 재로그인 시 발생).
- 테스트 `signIn_newUser_tokenEmailAndRequestEmailDiffer_usesSignedTokenEmail` 이 이 불변식을 강제.

**상태:** Phase 0 에서 발견 및 수정 완료.

---

## 2. 데이터 무결성 (Data Integrity)

### 🔴 2-1. Flyway 마이그레이션 실패 — 앱 부팅 불가

**시나리오:** 잘못된 SQL 이 마이그레이션 파일에 포함됨. Spring Boot 기동 시 Flyway 가 마이그레이션 실행 → SQL 에러 → **앱 전체 부팅 실패**. 모든 앱이 다운.

**영향:** 모듈러 모놀리스 전체 다운. 모든 앱 서비스 중단.

**해결:**
- **개발 시**: 로컬 Docker Postgres 에서 먼저 마이그레이션 검증.
- **CI 에서**: Testcontainers 가 실제 Postgres 에 마이그레이션을 실행해서 검증 (이미 구현).
- **운영 시**: 마이그레이션 실패 시 **이전 버전 JAR 로 롤백** (이전 커밋으로 deploy). 실패한 마이그레이션은 `flyway_schema_history` 에 `success=false` 로 기록됨 → `flyway repair` 후 수정된 마이그레이션 재실행.
- **예방**: `이미 배포된 마이그레이션은 수정 금지` 규칙 (naming.md 에 명시됨). 항상 새 V 파일로.

---

### 🔴 2-2. Soft Delete 후 30 일 Hard Delete — 법적 의무 누락

**시나리오:** 유저가 탈퇴 (soft delete). 30 일 후 hard delete 를 해야 하는데 (개인정보보호법, GDPR 요구), 스케줄러가 없어서 데이터가 영구 보존됨. 법적 요구 위반.

**영향:** 개인정보보호 위반, 과태료.

**해결:**
- Phase 1 에서 **스케줄러** (`@Scheduled`) 로 매일 `deleted_at < now() - 30d` 인 유저의 모든 데이터 hard delete.
- **Cascade 주의**: 유저 삭제 시 해당 유저의 refresh_tokens, social_identities, email_verification_tokens, password_reset_tokens, devices, 그리고 **앱 도메인 데이터** (expenses, asset_groups 등) 모두 삭제.
- Hard delete 전 **데이터 export** 기능 제공 (유저에게 자기 데이터를 다운로드할 수 있게 — GDPR 요구).

**상태:** Phase 1 필수. Phase 0 에서는 soft delete 만.

---

### 🟡 2-3. 같은 이메일 + 같은 비밀번호로 여러 앱 가입 — 유저 혼동

**시나리오:** 유저가 sumtally 와 rny 에 같은 이메일 + 같은 비밀번호로 가입. 비밀번호 재설정을 했을 때 "어느 앱의 비밀번호를 바꾼 거지?" 혼란.

**영향:** UX 혼란. 고객 지원 요청 증가.

**해결:**
- 비밀번호 재설정 이메일에 **앱 이름 명시** ("sumtally 에서 비밀번호를 재설정하세요").
- 재설정 링크에 **appSlug 포함** (재설정 토큰에 바인딩).
- Flutter 앱의 비밀번호 재설정 화면에 **앱 로고 + 이름 표시**.
- 이 시나리오는 근본적으로 **유저가 여러 앱을 쓸 때만** 발생하며, 인디 앱 공장에서 한 유저가 여러 앱을 동시에 쓸 확률은 매우 낮음.

---

### 🟡 2-4. UUID/BIGSERIAL ID 가 다른 앱 스키마에서 우연히 일치

**시나리오:** sumtally 의 userId=42 와 rny 의 userId=42 가 완전히 다른 사람. AppSlugVerificationFilter 가 없으면 잘못된 JWT 로 다른 유저 데이터 접근 가능.

**영향:** 1-1 과 동일 (크로스앱 데이터 접근).

**해결:** 1-1 의 `AppSlugVerificationFilter` 가 완전히 차단. 이 시나리오가 **1-1 이 필수인 이유**.

---

## 3. 운영 (Operations)

### 🔴 3-1. 맥미니 디스크 고장 — 서비스 + 로컬 데이터 소실

**시나리오:** 맥미니의 SSD 가 고장나서 Spring Boot JAR, 설정 파일, 로그 등 전부 소실.

**영향:** 서비스 다운 + 로컬 설정 소실. (DB 데이터는 Supabase 에 있어서 안전.)

**해결:**
- **코드**: GitHub 에 push 되어 있으므로 다른 기기에서 clone → build → deploy 가능.
- **환경변수/시크릿**: Apple Passwords 에 백업. `.env` 재구성 필요 (10 분 작업).
- **DB 데이터**: Supabase 에 안전. 맥미니 고장과 무관.
- **NAS**: Time Machine 백업이 있으면 맥미니 전체 복원 가능.
- **복구 시간**: 새 맥미니 (또는 Oracle Cloud) 에서 `git clone → docker compose up → ./gradlew bootJar → java -jar` — **1~2 시간이면 서비스 복구**.

---

### 🔴 3-2. Supabase 계정 정지/삭제 — 모든 앱의 DB 접근 불가

**시나리오:** Supabase 계정에 문제 발생 (결제 실패, ToS 위반, 계정 해킹 등). 모든 앱의 DB 접근이 차단됨.

**영향:** 모든 앱 서비스 완전 다운. 데이터 접근 불가.

**해결:**
- **NAS `pg_dump` 일일 백업**: 최대 24 시간 전 데이터까지 복구 가능.
- **백업으로부터 복원**: NAS 에 있는 `pg_dump` 를 새 Postgres (Oracle Cloud Free, 로컬 Docker 등) 에 `pg_restore` → `.env` 의 DB URL 변경 → 서비스 복구.
- **이중 백업**: Supabase 자체 일일 백업 + NAS `pg_dump`. 두 개 모두 실패할 확률은 극히 낮음.
- **예방**: Supabase Pro ($25/월) 로 승격하면 계정 안정성과 지원 수준 향상.

---

### 🟡 3-3. Supabase Free Tier 7 일 비활성 → 자동 정지

**시나리오:** 모든 앱에 유저가 적어서 7 일 간 쿼리가 0 건. Supabase 가 프로젝트를 일시 정지. 다음 요청에 10~60 초 cold start.

**영향:** 첫 요청 사용자가 긴 로딩 또는 타임아웃 경험.

**해결 (이미 구현됨):**
- **keep-alive 크론**: `infra/scripts/keep-alive.sh` 로 5 분마다 `SELECT 1` 실행.
- 모든 앱이 같은 Supabase 인스턴스를 공유하므로 **한 앱이라도 활성이면 전체 인스턴스 유지**.
- 첫 유료 앱 출시 시 Supabase Pro ($25/월) 승격 → 자동 정지 기능 비활성화.

---

### 🟡 3-4. Resend 무료 티어 소진 — 이메일 인증/재설정 불가

**시나리오:** 월 3,000 통 (일 100 통) 한도 소진. 이후 가입한 유저는 이메일 인증 메일을 받지 못함. 비밀번호 재설정도 불가.

**영향:** 신규 가입 유저 이메일 인증 불가. 기존 유저 비밀번호 재설정 불가.

**해결:**
- **모니터링**: Resend 대시보드에서 사용량 추적. 80% 도달 시 알림 설정.
- **가입은 성공 처리**: `EmailAuthService.signUp` 에서 이메일 발송 실패해도 가입 자체는 성공 (이미 구현됨). 유저는 나중에 "인증 메일 재발송" 가능.
- **승격**: 월 $20 (Resend Growth) 으로 월 50,000 통.
- **대체**: SendGrid 무료 (일 100 통) 으로 어댑터 교체 (`EmailPort` 인터페이스 덕에 교체 비용 최소).

---

### 🟡 3-5. 커넥션 풀 고갈 — 일부 또는 전체 앱 응답 불가

**시나리오:** 한 앱에 트래픽 급증. 해당 앱의 HikariCP 풀이 가득 찬 상태에서 새 요청이 계속 들어옴. 다른 앱은 자기 풀이 있어서 영향 없지만, 해당 앱은 timeout.

**영향:** 해당 앱만 응답 지연 또는 실패.

**해결:**
- **앱별 HikariCP 풀 격리** (이미 설계됨): `maximum-pool-size` 를 앱별로 설정. 한 앱의 고갈이 다른 앱에 전파되지 않음.
- **HikariCP 메트릭 모니터링** (Phase 2): Prometheus + Grafana 로 커넥션 사용률 추적.
- **풀 사이즈 튜닝**: Supabase Pooler 한도 (200) 안에서 앱별 배분. 앱 10 개 × 풀 10 = 100 커넥션.
- **서킷 브레이커** (Phase 2+): Resilience4j 로 커넥션 획득 타임아웃 시 빠른 실패 반환.

---

### 🟡 3-6. Spring Boot 재시작 중 짧은 다운타임

**시나리오:** 배포 시 기존 프로세스 종료 → 새 프로세스 기동. 사이에 10~30 초 다운.

**영향:** 해당 시간 동안 모든 앱 요청 실패.

**해결:**
- Phase 0: 수용. 새벽 시간에 배포하여 영향 최소화.
- Cloudflare 가 503 응답 시 "일시적 서비스 점검" 페이지 자동 표시.
- Phase 1+: **Blue-Green 배포** (포트 8080/8081 교대) 또는 **graceful shutdown** (`server.shutdown=graceful` 설정).

---

## 4. 앱스토어 / 법적 (App Store / Legal)

### 🔴 4-1. 앱스토어 필수 요구사항 누락 — 심사 거절

아래 항목 중 하나라도 빠지면 **Apple App Store 심사에서 거절**됩니다.

| 요구사항 | 현재 상태 | 해결 |
|---|---|---|
| **Sign in with Apple** (소셜 로그인 제공 시 필수) | Phase F 에서 구현 예정 | Apple 로그인 반드시 포함 |
| **계정 삭제 기능** (2022 년 6 월부터 필수) | Phase G 에서 WithdrawService 구현 예정 | Settings 화면에 "계정 삭제" 버튼 필수 |
| **Apple 토큰 Revoke** (5.1.1(v), 소셜 로그인 사용 시) | Phase 1 에서 구현 예정 | 1-4 참조 |
| **개인정보처리방침 URL** | 아직 없음 | 앱 출시 전 웹페이지 준비 필요 |
| **앱 추적 투명성 (ATT)** (IDFA 사용 시) | AdMob 사용 예정 → 필요 | Flutter `app_tracking_transparency` 패키지 사용 |

**상태:** 각 Phase 에서 순차 구현. 출시 직전 체크리스트로 재확인.

---

### 🔴 4-2. 개인정보보호법 / GDPR 위반 — 과태료

**시나리오:** 유저가 "내 데이터를 삭제해달라" / "내 데이터를 다운로드 하고 싶다" 요청. 서비스가 이를 처리할 방법이 없음.

**영향:** 국내 개인정보보호법 위반 시 최대 매출액 3% 과태료. GDPR (EU 유저 대상 시) 위반 시 최대 2,000 만 유로.

**해결:**
- **데이터 삭제**: Withdraw 플로우 (Phase G) + 30 일 후 hard delete (Phase 1 스케줄러).
- **데이터 이관권 (export)**: Phase 1 에서 `GET /api/apps/{slug}/me/data-export` 엔드포인트 추가. 유저의 모든 데이터를 JSON 으로 반환.
- **국내 서비스**: 한국 유저 대상이면 개인정보보호법 적용. EU 유저가 없으면 GDPR 적용 안 됨.
- **개인정보처리방침**: 앱 출시 전 작성 필수. 수집 항목, 보유 기간, 삭제 절차 명시.

---

### 🟡 4-3. Google Play 데이터 안전 양식 — 출시 지연

**시나리오:** Google Play Console 에서 "데이터 안전" 섹션을 작성하지 않으면 앱 출시 불가. 앱이 수집하는 데이터 종류, 목적, 공유 여부를 신고해야 함.

**영향:** 출시 지연 (심사 과정에서 보완 요청).

**해결:**
- 수집 데이터 목록: 이메일 주소, 표시 이름, 비밀번호 (해시), 디바이스 정보 (push token), 앱 사용 데이터
- 목적: 계정 관리, 알림 발송, 서비스 기능 제공
- 공유: 제3 자 공유 없음 (Supabase, Resend, FCM 은 "서비스 제공자" 로 분류)
- **사전 준비**: 앱별로 데이터 안전 양식 답변 템플릿을 만들어두면 출시 시 빠르게 작성 가능.

---

## 5. 성능 / 스케일 (Performance / Scale)

### 🟡 5-1. 모듈러 모놀리스 기동 시간 증가

**시나리오:** 앱 모듈이 10 개, 20 개로 늘어나면서 Spring Boot 기동 시간이 30 초 → 60 초 → 2 분으로 증가. 배포 시 다운타임 확대.

**영향:** 배포 시 서비스 다운타임 증가.

**해결:**
- **Lazy initialization**: `spring.main.lazy-initialization=true` — 필요할 때만 빈 생성.
- **앱 모듈별 `@ConditionalOnProperty`**: 특정 앱을 비활성화하여 기동 시간 단축 가능.
- **GraalVM Native Image** (Phase 3+): 기동 시간을 수 초로 단축. Spring Boot 3.x 지원.
- **실전 기준**: 앱 10 개 수준에서는 20~30 초 이내. 문제가 되는 건 50 개+.

---

### 🟡 5-2. 한 앱의 무거운 쿼리가 JVM 전체에 영향

**시나리오:** rny 의 통계 계산 쿼리가 CPU 집중적이라 다른 앱의 응답 시간도 느려짐.

**영향:** 다른 앱 유저의 응답 지연.

**해결:**
- **커넥션 풀 격리** (이미 설계됨): DB 레벨 병목은 앱별로 격리.
- **스레드 풀 격리** (Phase 2): 앱별 `TaskExecutor` 를 분리하여 CPU 집중 작업을 격리.
- **오래 걸리는 쿼리 타임아웃**: `spring.jpa.properties.jakarta.persistence.query.timeout=5000` (5 초).
- **최종 해결**: 해당 앱만 독립 서비스로 추출 (5 중 방어선 덕에 가능).

---

### 🟢 5-3. 매 앱마다 동일한 인증 테이블 Flyway 마이그레이션 반복

**시나리오:** `new-app.sh` 가 V001~V006 (유저/인증 테이블) 을 매 앱마다 생성. 앱 20 개면 동일 구조 테이블이 20 벌.

**영향:** Flyway 실행 시간 약간 증가. DB 저장 공간 약간 증가. 기능에는 영향 없음.

**해결:** 수용. 각 앱의 유저 수는 적고, 테이블 20 벌의 오버헤드는 무시 가능. 격리의 대가로 받아들임.

---

## 6. 비즈니스 모델 / UX

### 🟡 6-1. 무료 앱 → 유료 전환 시 기존 유저 마이그레이션

**시나리오:** 무료로 출시한 앱에 구독 기능 추가. 기존 무료 유저를 어떻게 처리할지.

**영향:** UX 결정 필요. 기존 유저 이탈 가능.

**해결:**
- `User.isPremium` 필드로 무료/유료 구분 (이미 존재).
- 기존 유저는 `isPremium = false` 유지 → 무료 기능만 사용.
- 구독 결제 완료 시 `isPremium = true` → 프리미엄 기능 해제.
- **Grandfathering**: 초기 유저에게 일정 기간 무료 프리미엄 제공 가능 (비즈니스 결정).

---

### 🟢 6-2. 유저가 앱 삭제 후 재설치 — 데이터 복구 불가 (로컬 전용 앱)

**시나리오:** sumtally 가 아직 백엔드 연결 안 된 상태 (로컬 SQLite 전용). 유저가 앱 삭제 → 재설치. 로컬 데이터 소실.

**영향:** 유저 불만.

**해결:**
- 이것이 **백엔드를 붙이는 가장 큰 이유** 중 하나. 서버에 데이터가 있으면 재설치해도 로그인하면 복구.
- Phase 0 완료 후 각 앱에 서버 동기화를 점진적으로 추가 (core-sync, Phase 1).
- 그 전까지는 앱 내에 "데이터 백업/복원" 기능 (iCloud/Google Drive 연동) 을 Flutter 측에서 제공 가능.

---

## 요약: Phase 0 에서 반드시 해결할 것

| # | 시나리오 | 해결 |
|---|---|---|
| 1-1 | 크로스앱 데이터 접근 | `AppSlugVerificationFilter` |
| 1-2 | JWT 비밀키 유출 방어 | 키 길이 검증, .gitignore, .env |
| 1-3 | Refresh token 탈취 | Rotation + 탈취 감지 (구현 완료) |
| 2-1 | Flyway 실패 시 복구 경로 | CI 에서 검증, rollback 절차 |
| 4-1 | 앱스토어 필수 요구사항 | Phase F/G 에서 순차 구현 |

## Phase 1 에서 해결할 것

| # | 시나리오 | 해결 |
|---|---|---|
| 1-4 | Apple 토큰 Revoke | WithdrawService + Apple API |
| 1-6 | 이메일 열거 타이밍 공격 | BCrypt 더미 해싱 |
| 2-2 | 30 일 hard delete | 스케줄러 |
| 4-2 | 데이터 이관권 | export API |

---

## 관련 문서

- [Repository Philosophy — 책 안내](../philosophy/README.md) — 16 개 ADR 인덱스 (설계 결정의 이유)
- [Architecture Reference](../structure/architecture.md) — 시스템 구조
- [API Response Format](../api-and-functional/api/api-response.md) — API 응답 포맷
- [Design Principles](../convention/design-principles.md) — 설계 원칙
