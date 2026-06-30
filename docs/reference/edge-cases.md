# Edge Cases & Risk Analysis

> **유형**: Reference · **독자**: Level 2~3 · **읽는 시간**: ~25분

이 문서는 앱 공장 모델에서 터질 수 있는 엣지케이스를 분류하고, 각 시나리오의 영향과 대응을 정리해요. 시나리오마다 "지금 코드가 어디까지 막아 두었는가" 를 실제 구현과 대조해 표시했으니, 어디가 이미 방어돼 있고 어디가 다음 Phase 의 숙제인지 빠르게 가릴 수 있어요.

분류 기준은 세 단계예요.

- 🔴 **대형 사고** — 한 번 터지면 데이터 유출, 매출 손실, 법적 문제로 번집니다. 사전 차단이 필수예요.
- 🟡 **중간 리스크** — 서비스 장애나 UX 혼란 수준. 대응 방안을 준비해 둬야 합니다.
- 🟢 **낮은 리스크** — 불편하지만 서비스에 심각한 영향은 없어요. 인지만 하면 됩니다.

---

## 1. 보안 (Security)

### 🔴 1-1. 크로스앱 데이터 접근 — JWT appSlug 와 API path 불일치

**시나리오** — 한 유저가 sumtally 와 rny 에 같은 이메일·비밀번호로 가입했어요. sumtally 앱이 실수로, 혹은 공격자가 의도적으로 rny 엔드포인트에 로그인해 rny 용 JWT 를 얻은 뒤, 그 토큰으로 sumtally 엔드포인트를 호출합니다. 두 앱의 `userId` 가 우연히 같으면 다른 유저의 데이터가 노출될 수 있어요.

**영향** — 가계부·포트폴리오 같은 개인정보 유출. 법적 문제로 번질 수 있습니다.

**해결 (이미 구현됨)** — `common-security` 의 `AppSlugVerificationFilter` 가 이 경로를 차단합니다. JWT 의 `appSlug` 클레임과 URL path `/api/apps/{slug}/...` 에서 뽑은 슬러그를 대조하고, 불일치 시 `403 Forbidden` (`CMN_005`) 을 반환하며 로그에 `app mismatch` 경고를 남깁니다. 필터 체인 순서는 `JwtAuthFilter → AppSlugMdcFilter → AppSlugVerificationFilter → RateLimitFilter` 라, 토큰 인증과 슬러그 컨텍스트 주입이 끝난 직후, 컨트롤러 진입 전에 검증이 일어나요.

**상태** — Phase 0 에서 구현 완료. 멀티테넌시 격리의 핵심 방어선입니다.

---

### 🔴 1-2. JWT 비밀키 유출 — 모든 앱의 토큰 위조 가능

**시나리오** — JWT HS256 비밀키가 git 커밋, 로그 파일, 환경변수 노출 등으로 새어 나갔어요. 공격자는 임의의 `userId` 와 `appSlug` 로 토큰을 위조해 어떤 앱의 어떤 유저로든 접근할 수 있습니다.

**영향** — 전체 서비스의 모든 유저 데이터를 탈취당할 수 있어요. 최악의 보안 사고입니다.

**해결** — 비밀키는 환경변수로만 제공하고, `.env` 는 `.gitignore` 에 포함돼 있어요. `JwtProperties` 의 compact constructor 가 32 자(256 비트) 미만 키를 거부해 부팅 단계에서 막습니다. 유출이 감지되면 즉시 키를 교체하는데, `.env` 의 `JWT_SECRET` 을 바꾸고 Spring Boot 를 재시작하면 끝이라 별도 마이그레이션이 필요 없어요. 다만 교체 즉시 모든 JWT 가 무효화돼 전 유저 재로그인이 발생합니다. 무중단 교체가 필요해지면 Phase 1 에서 교체 기간 동안 old key 와 new key 를 모두 수용하는 이중 키 검증을 `JwtService` 에 fallback 으로 추가하는 방안이 있어요.

**상태** — 기본 방어(키 길이 검증, `.gitignore`)는 Phase 0 에 구현돼 있어요. 이중 키 검증은 Phase 1 입니다.

---

### 🔴 1-3. Refresh Token 탈취 — 장기간 세션 하이재킹

**시나리오** — 공격자가 네트워크 스니핑, 기기 탈취, 로컬 스토리지 접근으로 refresh token 을 얻으면 유효 기간(30 일) 동안 그 유저로 접근할 수 있어요.

**영향** — 최대 30 일간 해당 유저의 데이터에 접근당합니다.

**해결 (이미 구현됨)** — `RefreshTokenService` 가 세 겹으로 방어해요. 첫째, 회전(rotation) 시 기존 토큰을 `usedAt` 으로 표시해 무효화하고, 이미 쓰인 토큰이 다시 들어오면 탈취로 간주해 같은 `familyId` 의 토큰 family 전체를 revoke 합니다. 둘째, DB 에는 raw token 을 저장하지 않고 SHA-256 해시만 보관해서, DB 가 통째로 유출돼도 토큰을 복원할 수 없어요. 셋째, 탈취 감지 시 revoke 를 `Propagation.REQUIRES_NEW` 트랜잭션으로 수행해, 바깥 트랜잭션이 rollback 돼도 revoke 는 살아남습니다.

**추가 권장 (Phase 1)** — refresh token 에 디바이스 fingerprint(User-Agent + IP 대역)를 바인딩해 다른 기기에서의 사용을 거부하고, 같은 토큰이 서로 다른 IP 에서 동시에 쓰이는 비정상 패턴을 감지해 자동 revoke 하는 방어를 더할 수 있어요.

**상태** — 기본 방어(rotation + 탈취 감지)는 Phase 0 에 구현돼 있어요. fingerprint 바인딩은 Phase 1 입니다.

---

### 🔴 1-4. Apple Sign In 계정 탈퇴 후 토큰 미 revoke — App Store 리젝

**시나리오** — 유저가 앱 안에서 "계정 삭제" 를 했지만 Apple 서버에 revoke 호출을 보내지 않은 경우예요. App Store Review Guideline 5.1.1(v) 는 Sign in with Apple 을 지원하는 앱이라면 탈퇴 시 Apple 에 토큰 revoke 요청을 보내라고 요구합니다.

**영향** — 앱 심사 거절, 심하면 기존 앱 삭제 조치로 이어집니다.

**해결** — `WithdrawService` 의 탈퇴 흐름에서 Apple 의 `https://appleid.apple.com/auth/revoke` 엔드포인트를 호출해야 해요. 이를 위해 가입 시점에 받은 `AppleSignInRequest.authorizationCode` 를 Apple 토큰 엔드포인트에서 refresh token 으로 교환해 보관해 두고, 탈퇴 시 그 refresh token 으로 revoke 를 호출합니다.

**상태** — `AppleSignInRequest` 에 `authorizationCode` 필드는 이미 있어요. 현재 `WithdrawService` 는 soft delete 와 refresh token 무효화까지만 수행하고, Apple refresh token 저장과 revoke 호출은 코드 안에 `// NOTE ... Phase 1` 주석으로만 남아 있습니다. 첫 iOS 앱 출시 전까지 채워야 하는 Phase 1 필수 항목이에요.

---

### 🟡 1-5. 비밀번호 재설정 이메일 — 다른 앱 컨텍스트로 전송

**시나리오** — 유저가 sumtally 에서 비밀번호 재설정을 요청했는데, 이메일 템플릿에 appSlug 가 잘못 전달돼 "rny 에서 비밀번호를 재설정하세요" 라고 표시되는 실수예요.

**영향** — UX 혼란. 피싱으로 오해받을 수 있어요.

**해결** — 비밀번호 재설정 토큰에 appSlug 를 포함하고, 이메일 템플릿에는 앱 이름을 동적으로 삽입합니다("sumtally 에서 비밀번호를 재설정하세요"). 재설정 확인 엔드포인트에서 토큰의 appSlug 와 요청의 appSlug 를 대조해 불일치 시 거부합니다.

**상태** — `PasswordResetService` 의 향후 멀티앱 확장 시 반영할 항목이에요.

---

### 🟡 1-6. 이메일 열거 공격 (Email Enumeration)

**시나리오** — 공격자가 `POST /api/apps/sumtally/auth/email/signin` 에 여러 이메일을 시도합니다. 응답 메시지나 응답 시간으로 "이메일 없음" 과 "비밀번호 틀림" 을 구분할 수 있으면 유효한 이메일 목록을 수집할 수 있어요.

**영향** — 유저 이메일 목록 유출로 스팸, 피싱, 소셜 엔지니어링의 발판이 됩니다.

**해결 (이미 구현됨)** — `EmailAuthService.signIn` 은 이메일 없음, 소셜 전용 유저(`passwordHash == null`), 비밀번호 불일치를 모두 같은 예외 `AuthError.INVALID_CREDENTIALS`(`ATH_001`, "이메일 또는 비밀번호가 올바르지 않습니다")로 던져, 무엇이 틀렸는지 구분되지 않아요. 같은 정신의 enumeration 방어가 비밀번호 재설정에도 적용돼 있고, `PasswordResetServiceTest` 가 "존재하지 않는 이메일에도 동일 응답" 을 검증합니다.

**남은 보강 (Phase 1)** — 메시지는 동일해도 응답 시간으로 구분될 여지가 남아요. 이메일이 없을 때도 BCrypt 더미 해싱을 한 번 수행해 응답 시간을 일정하게 맞추는 타이밍 공격 방어를 더할 수 있습니다. 현재는 사용자가 없으면 해시 검증 전에 곧바로 예외를 던지므로 이 더미 해싱은 아직 들어가 있지 않아요.

---

### 🟡 1-7. Firebase Service Account Key 유출 — 무단 푸시 발송

**시나리오** — FCM service account JSON 파일이 git 에 커밋되거나 유출됐어요. 공격자가 모든 디바이스에 스팸 푸시를 보낼 수 있습니다.

**영향** — 유저 신뢰 상실, 앱 삭제.

**해결** — service account 파일은 환경변수 경로(`FCM_CREDENTIALS_PATH`)로만 참조하고 git 커밋을 금지합니다. 유출이 의심되면 Firebase Console 에서 key rotation 으로 기존 키를 즉시 비활성화하고 새 키를 발급해요. service account 에는 Firebase Cloud Messaging send 권한만 부여하고 Admin 권한은 주지 않는 최소 권한 원칙을 지킵니다.

---

### 🟡 1-8. CORS 미설정 상태에서 브라우저 기반 공격

**시나리오** — 현재 `SecurityConfig` 에는 CORS 설정이 없어요. 모바일 우선 템플릿이라 의도적으로 비워 둔 거예요. 하지만 나중에 관리자 대시보드 같은 웹 클라이언트를 붙이면 CORS 가 필요해지고, 설정 없이 웹을 붙이면 CSRF 유사 공격에 노출될 수 있습니다.

**영향** — 웹 클라이언트를 추가하는 시점에 생기는 보안 구멍.

**해결** — Phase 0 에서 모바일만 쓰는 동안은 CORS 미설정이 맞아요. 웹 클라이언트를 추가할 때 반드시 `CorsConfigurationSource` 빈을 정의하고 허용 origin 을 좁혀야 합니다. 향후 담당자가 놓치지 않도록 `SecurityConfig` javadoc 에 이 경고를 남겨 둡니다.

---

### 🔴 1-9. Apple Sign In — 클라이언트 제출 email 신뢰 시 계정 탈취

**시나리오** — Apple identity token 의 `email` 클레임과 별개로, 클라이언트는 `request.email` 을 따로 보낼 수 있어요. 서버가 Apple 이 RS256 으로 서명한 `tokenEmail` 보다 클라이언트의 `request.email` 을 우선하면, 공격자가 자기 Apple 토큰으로 피해자 이메일을 가진 계정을 만들 수 있습니다.

**영향** — 공격자가 피해자 이메일로 계정을 만들어 그 이메일 소유자로 위장합니다.

**해결 (이미 구현됨)** — `AppleSignInService.signIn()` 은 Apple 이 서명한 `tokenEmail` 을 항상 우선 사용해요. `request.email` 은 토큰에 email 클레임이 없을 때만 fallback 으로 쓰이는데, 이는 "Hide My Email" 이나 재로그인 상황에서 발생합니다. 이 불변식은 `signIn_newUser_tokenEmailAndRequestEmailDiffer_usesSignedTokenEmail` 과 `signIn_newUser_tokenEmailAbsent_usesRequestEmailAsFallback` 테스트가 강제해요.

**상태** — Phase 0 에서 발견하고 수정 완료.

---

## 2. 데이터 무결성 (Data Integrity)

### 🔴 2-1. Flyway 마이그레이션 실패 — 앱 부팅 불가

**시나리오** — 잘못된 SQL 이 마이그레이션 파일에 들어가 있어요. Spring Boot 기동 시 Flyway 가 그 파일을 실행하다 SQL 에러를 내면 앱 전체 부팅이 실패하고, 한 JAR 에 올라탄 모든 앱이 함께 다운됩니다.

**영향** — 모듈러 모놀리스 전체 다운. 모든 앱 서비스가 중단됩니다.

**해결** — 개발 단계에서 로컬 Docker Postgres 로 먼저 마이그레이션을 검증하고, CI 에서는 Testcontainers 가 실제 Postgres 에 마이그레이션을 돌려 검증합니다. 운영에서는 한 겹을 더 둬요. 운영 프로파일의 Flyway 가 `VALIDATE_ONLY` 라 부팅 시 임의 마이그레이션을 실행하지 않고 checksum 과 history 만 검증하므로, 검증되지 않은 SQL 이 운영 부팅을 깨뜨리는 경로 자체가 막혀 있어요(마이그레이션은 `tools/migrate-prod.sh` 로 명시적으로 적용). 그래도 문제가 생기면 이전 버전 JAR 로 롤백(이전 커밋 재배포)하고, 실패한 마이그레이션은 `flyway_schema_history` 에 `success=false` 로 남으니 `flyway repair` 후 수정본을 다시 적용합니다. 예방의 핵심은 `naming.md` 에 명시된 "이미 배포된 마이그레이션은 수정 금지" 규칙이에요. 항상 새 V 파일로 추가합니다.

---

### 🔴 2-2. Soft Delete 후 30 일 Hard Delete — 법적 의무 누락

**시나리오** — 유저가 탈퇴해 soft delete 된 상태예요. 개인정보보호법과 GDPR 은 일정 기간 뒤 데이터를 완전히 지우길 요구하는데, 스케줄러가 없으면 데이터가 영구 보존돼 법적 요구를 위반하게 됩니다.

**영향** — 개인정보보호 위반과 과태료.

**해결** — Phase 1 에서 `@Scheduled` 스케줄러로 매일 `deleted_at < now() - 30d` 인 유저의 데이터를 hard delete 합니다. 이때 cascade 범위에 주의해야 해요. 유저를 지우면 그 유저의 인증 데이터(refresh_tokens, social_identities, email_verification_tokens, password_reset_tokens, devices)와 결제 데이터(payment_history, subscriptions, payment_webhook_events 등), 그리고 각 앱의 도메인 데이터까지 모두 함께 지워야 합니다. hard delete 전에는 유저가 자기 데이터를 내려받을 수 있는 export 기능을 먼저 제공해야 GDPR 의 이관권 요구를 충족해요.

**상태** — 현재 `WithdrawService` 는 soft delete 까지만 수행하고, 30 일 후 hard delete 스케줄러는 코드 안 `// NOTE ... Phase 1` 주석으로만 남아 있어요. Phase 1 필수입니다.

---

### 🟡 2-3. 같은 이메일 + 같은 비밀번호로 여러 앱 가입 — 유저 혼동

**시나리오** — 유저가 sumtally 와 rny 에 같은 이메일·비밀번호로 가입한 뒤 비밀번호를 재설정하면 "어느 앱 비밀번호를 바꾼 거지?" 하고 헷갈립니다.

**영향** — UX 혼란과 고객 지원 요청 증가.

**해결** — 비밀번호 재설정 이메일에 앱 이름을 명시하고("sumtally 에서 비밀번호를 재설정하세요"), 재설정 링크에 appSlug 를 바인딩하며, Flutter 의 재설정 화면에 앱 로고와 이름을 표시합니다. 이 시나리오는 한 유저가 여러 앱을 동시에 쓸 때만 생기는데, 인디 앱 공장에서 그 확률은 매우 낮아요. 앱별 독립 유저 모델([`ADR-012`](../philosophy/adr-012-per-app-user-model.md))상 두 앱의 계정은 애초에 별개라, 남는 문제는 데이터 침해가 아니라 표기 혼란뿐입니다.

---

### 🟡 2-4. UUID/BIGSERIAL ID 가 다른 앱 스키마에서 우연히 일치

**시나리오** — sumtally 의 `userId=42` 와 rny 의 `userId=42` 는 완전히 다른 사람이에요. 1-1 의 필터가 없다면 잘못된 JWT 로 다른 유저 데이터에 접근할 수 있습니다.

**영향** — 1-1 과 동일한 크로스앱 데이터 접근.

**해결** — 1-1 의 `AppSlugVerificationFilter` 가 이 경로를 완전히 차단해요. 이 시나리오가 바로 1-1 이 필수인 이유입니다.

---

## 3. 운영 (Operations)

### 🔴 3-1. 맥미니 디스크 고장 — 서비스 + 로컬 데이터 소실

**시나리오** — 맥미니 SSD 가 고장 나 Spring Boot JAR, 설정 파일, 로그가 전부 사라졌어요.

**영향** — 서비스 다운과 로컬 설정 소실. DB 데이터는 Supabase 에 있어 안전합니다.

**해결** — 코드는 GitHub 에 push 돼 있으니 다른 기기에서 clone 해 build·deploy 할 수 있어요. 환경변수와 시크릿은 Apple Passwords 에 백업해 두고 `.env` 를 재구성하면 10 분이면 됩니다. DB 데이터는 Supabase 에 안전하게 남아 맥미니 고장과 무관해요. NAS 의 Time Machine 백업이 있다면 맥미니 전체를 복원할 수도 있습니다. 새 맥미니나 Oracle Cloud 에서 `git clone → docker compose up → ./gradlew bootJar → java -jar` 로 1~2 시간이면 서비스를 복구할 수 있어요.

---

### 🔴 3-2. Supabase 계정 정지/삭제 — 모든 앱의 DB 접근 불가

**시나리오** — Supabase 계정에 결제 실패, ToS 위반, 계정 해킹 같은 문제가 생기면 모든 앱의 DB 접근이 막힙니다.

**영향** — 모든 앱 서비스가 완전히 다운되고 데이터에 접근할 수 없어요.

**해결** — NAS 의 `pg_dump` 일일 백업으로 최대 24 시간 전 데이터까지 복구할 수 있어요. 복원은 NAS 의 `pg_dump` 를 새 Postgres(Oracle Cloud Free, 로컬 Docker 등)에 `pg_restore` 한 뒤 `.env` 의 DB URL 을 바꾸면 됩니다. Supabase 자체 일일 백업과 NAS `pg_dump` 의 이중 백업이라 둘 다 동시에 실패할 확률은 극히 낮아요. 안정성을 더 높이려면 Supabase Pro 로 승격해 계정 안정성과 지원 수준을 끌어올릴 수 있습니다.

---

### 🟡 3-3. Supabase Free Tier 7 일 비활성 → 자동 정지

**시나리오** — 모든 앱에 유저가 적어 7 일간 쿼리가 0 건이면 Supabase 가 프로젝트를 일시 정지합니다. 다음 요청에 10~60 초 cold start 가 걸려요.

**영향** — 첫 요청 사용자가 긴 로딩이나 타임아웃을 겪습니다.

**해결 (이미 구현됨)** — `infra/scripts/keep-alive.sh` 가 약 14 분(840 초)마다 앱의 `/actuator/health` 를 HTTP 로 호출해 인스턴스를 깨어 있게 유지해요(cron 예시 `*/14 * * * *`). 모든 앱이 같은 Supabase 인스턴스를 공유하므로, 한 앱이라도 활성이면 전체 인스턴스가 함께 유지됩니다. 첫 유료 앱을 출시할 때 Supabase Pro 로 승격하면 자동 정지 자체가 비활성화돼요.

---

### 🟡 3-4. Resend 무료 티어 소진 — 이메일 인증/재설정 불가

**시나리오** — Resend 무료 한도를 다 쓰면 이후 가입한 유저는 인증 메일을 받지 못하고 비밀번호 재설정도 막힙니다.

**영향** — 신규 유저 이메일 인증 불가, 기존 유저 비밀번호 재설정 불가.

**해결** — Resend 대시보드에서 사용량을 추적하고 80% 도달 시 알림을 받도록 설정해요. 발송 실패가 가입 자체를 막지 않게, `EmailAuthService.signUp` 은 가입과 토큰 발급을 마친 뒤 인증 메일을 보내고 응답을 돌려줍니다(유저는 나중에 "인증 메일 재발송" 으로 만회 가능). 한도가 부족해지면 Resend 유료 플랜으로 승격하거나, `EmailPort` 인터페이스 덕에 SendGrid 같은 다른 제공자 어댑터로 최소 비용에 교체할 수 있어요.

> 운영(prod) 프로파일에서는 Resend 키가 없으면 부팅이 실패하도록 막혀 있어, "이메일이 조용히 안 나가는" 상태를 사전에 차단해요. dev 에서는 키가 없으면 `LoggingEmailAdapter` 로 콘솔에 출력합니다.

---

### 🟡 3-5. 커넥션 풀 고갈 — 일부 또는 전체 앱 응답 불가

**시나리오** — 한 앱에 트래픽이 몰려 그 앱의 HikariCP 풀이 가득 찬 상태에서 새 요청이 계속 들어와요. 다른 앱은 자기 풀이 따로 있어 영향이 없지만, 해당 앱은 커넥션을 못 얻어 timeout 합니다.

**영향** — 해당 앱만 응답 지연 또는 실패.

**해결** — 앱마다 HikariCP 풀이 격리돼 있어 한 앱의 고갈이 다른 앱으로 전파되지 않아요. 기본 풀 크기는 `AbstractAppDataSourceConfig.DEFAULT_POOL_SIZE = 5` 로, 앱별 `*DataSourceConfig` 에서 필요 시 오버라이드할 수 있습니다. 이 5 라는 값은 Supabase NANO 인스턴스의 `max_connections = 60` 기준 4~5 개 앱을 안전 마진과 함께 수용하려고 ADR-037 에서 10 에서 5 로 낮춘 거예요. 전체 커넥션은 대략 `앱 수 × 풀(5) × blue/green(2)` 로 증가하니, 앱이 늘면 인스턴스의 `max_connections` 와 Supabase Pooler 한도 안에서 풀 크기를 조정합니다. 운영 부하에서는 Pooler(`:6543`)를 경유해 blue/green 배포가 겹치는 구간의 커넥션 폭증을 흡수해요. 가시성은 Phase 2 에서 Prometheus + Grafana 로 커넥션 사용률을 추적해 확보하고, 더 나아가 Resilience4j 서킷 브레이커로 커넥션 획득 타임아웃 시 빠른 실패를 반환하는 방안을 둘 수 있습니다.

---

### 🟡 3-6. Spring Boot 재시작 중 짧은 다운타임

**시나리오** — 배포 시 기존 프로세스가 끝나고 새 프로세스가 뜨는 사이에 잠깐 다운이 생길 수 있어요.

**영향** — 그 시간 동안 모든 앱 요청이 실패합니다.

**해결** — 현재 배포는 이미 Kamal 의 blue/green 방식이에요. `config/deploy.yml` 의 kamal-proxy 가 새 버전(green) 을 띄워 healthcheck(`/actuator/health/liveness`)를 통과시킨 뒤 트래픽을 순간 전환하므로, 정상 배포에서는 다운타임이 발생하지 않습니다. 여기에 더해 `server.shutdown: graceful` 과 `timeout-per-shutdown-phase: 30s` 가 설정돼 있어, 전환되는 기존 컨테이너는 처리 중인 요청을 마저 끝낸 뒤 종료해요. 그래서 이 시나리오의 다운타임은 blue/green 전환이 실패하거나 단일 인스턴스를 직접 재기동하는 예외 상황에서만 의미가 있고, 그런 경우엔 Cloudflare 가 503 응답 시 점검 페이지를 자동으로 보여 줍니다.

---

## 4. 앱스토어 / 법적 (App Store / Legal)

### 🔴 4-1. 앱스토어 필수 요구사항 누락 — 심사 거절

아래 항목 중 하나라도 빠지면 Apple App Store 심사에서 거절됩니다.

| 요구사항 | 현재 상태 | 해결 |
|---|---|---|
| Sign in with Apple (소셜 로그인 제공 시 필수) | `AppleSignInService` 로 로그인은 동작 | 출시 앱에 Apple 로그인 포함 |
| 계정 삭제 기능 (2022-06 부터 필수) | `WithdrawService` 로 soft delete 동작 | Settings 화면에 "계정 삭제" 버튼 |
| Apple 토큰 revoke (5.1.1(v)) | Phase 1 (1-4 참조) | 탈퇴 시 Apple revoke 호출 추가 |
| 개인정보처리방침 URL | 아직 없음 | 출시 전 웹페이지 준비 |
| 앱 추적 투명성 (ATT, IDFA 사용 시) | 광고 SDK 도입 시 필요 | Flutter `app_tracking_transparency` 패키지 사용 |

**상태** — 각 Phase 에서 순차 구현하고, 출시 직전 체크리스트로 다시 점검합니다.

---

### 🔴 4-2. 개인정보보호법 / GDPR 위반 — 과태료

**시나리오** — 유저가 "내 데이터를 삭제해 달라" 거나 "내 데이터를 내려받고 싶다" 고 요청했는데 서비스가 이를 처리할 수단이 없는 상황이에요.

**영향** — 국내 개인정보보호법 위반 시 매출액 기준 과태료, EU 유저 대상이면 GDPR 위반으로 더 큰 과징금이 부과됩니다.

**해결** — 데이터 삭제는 Withdraw 흐름과 30 일 후 hard delete(2-2)로 처리하고, 데이터 이관권은 Phase 1 에서 `GET /api/apps/{slug}/me/data-export` 엔드포인트로 유저의 전체 데이터를 JSON 으로 반환해 충족합니다(현재 미구현, Phase 1 계획). 한국 유저 대상이면 개인정보보호법이 적용되고, EU 유저가 없으면 GDPR 은 적용되지 않아요. 어느 경우든 개인정보처리방침은 출시 전에 수집 항목·보유 기간·삭제 절차를 명시해 작성해야 합니다.

---

### 🟡 4-3. Google Play 데이터 안전 양식 — 출시 지연

**시나리오** — Google Play Console 의 "데이터 안전" 섹션을 작성하지 않으면 앱을 출시할 수 없어요. 수집 데이터 종류·목적·공유 여부를 신고해야 합니다.

**영향** — 심사 과정의 보완 요청으로 출시가 지연됩니다.

**해결** — 신고 내용을 미리 정리해 두면 출시 시 빠르게 작성할 수 있어요.

- **수집 데이터** — 이메일 주소, 표시 이름, 비밀번호(해시), 디바이스 정보(push token), 앱 사용 데이터
- **목적** — 계정 관리, 알림 발송, 서비스 기능 제공
- **공유** — 제3 자 공유 없음 (Supabase, Resend, FCM 은 "서비스 제공자" 로 분류)

앱별로 이 답변 템플릿을 만들어 두면 새 앱마다 재사용할 수 있습니다.

---

## 5. 성능 / 스케일 (Performance / Scale)

### 🟡 5-1. 모듈러 모놀리스 기동 시간 증가

**시나리오** — 앱 모듈이 10 개, 20 개로 늘면서 Spring Boot 기동 시간이 30 초에서 1 분, 2 분으로 길어집니다. 배포 시 전환 대기가 늘어나요.

**영향** — 배포 흐름의 여유가 줄어듭니다.

**해결** — `spring.main.lazy-initialization=true` 로 필요할 때만 빈을 생성하고, 앱 모듈별 `@ConditionalOnProperty` 로 특정 앱을 비활성화해 기동 시간을 줄일 수 있어요. 장기적으로는 GraalVM Native Image(Phase 3+)로 기동을 수 초대로 단축하는 길도 있습니다. 실전 기준으로 앱 10 개 수준에서는 20~30 초 이내라 문제가 되지 않고, 체감되는 건 50 개 이상부터예요.

---

### 🟡 5-2. 한 앱의 무거운 쿼리가 JVM 전체에 영향

**시나리오** — rny 의 통계 계산 쿼리가 CPU 를 많이 써서 다른 앱의 응답 시간까지 느려집니다.

**영향** — 다른 앱 유저의 응답 지연.

**해결** — 커넥션 풀 격리로 DB 레벨 병목은 앱별로 막혀 있어요. CPU 병목은 Phase 2 에서 앱별 `TaskExecutor` 를 분리해 격리하고, 오래 걸리는 쿼리에는 `spring.jpa.properties.jakarta.persistence.query.timeout=5000`(5 초)으로 상한을 둡니다. 그래도 한 앱이 계속 부담을 준다면, 5 중 방어선([`ADR-005`](../philosophy/adr-005-db-schema-isolation.md))이 깔아 둔 추출 경로 덕에 해당 앱만 독립 서비스로 떼어 낼 수 있어요.

---

### 🟢 5-3. 매 앱마다 동일한 인증 테이블 Flyway 마이그레이션 반복

**시나리오** — `new-app.sh` 가 공통 마이그레이션 V001~V015 를 앱마다 생성해요(인증·결제·구독·감사·2FA·알림·점유인증 테이블 + V007 admin 시드). 앱이 20 개면 같은 구조의 테이블이 20 벌 생깁니다.

**영향** — Flyway 실행 시간이 약간 늘고 DB 저장 공간을 조금 더 쓰지만, 기능에는 영향이 없어요.

**해결** — 그대로 수용합니다. 각 앱의 유저 수가 적고 테이블 20 벌의 오버헤드는 무시할 만한 수준이라, 멀티테넌시 격리의 대가로 받아들이는 게 합리적이에요. 도메인 테이블은 V001~V015 가 이미 차 있어 그다음 빈 번호인 V016 부터 직접 작성합니다.

---

## 6. 비즈니스 모델 / UX

### 🟡 6-1. 무료 앱 → 유료 전환 시 기존 유저 마이그레이션

**시나리오** — 무료로 출시한 앱에 구독 기능을 더할 때 기존 무료 유저를 어떻게 처리할지 결정해야 해요.

**영향** — UX 결정이 필요하고, 잘못하면 기존 유저가 이탈할 수 있어요.

**해결** — 구독 모델([`ADR-020`](../philosophy/adr-020-subscription-domain-model.md))로 권한을 판단합니다. `BillingPort.findActiveSubscription(userId)` 는 상태가 ACTIVE 이거나, CANCELLED 이지만 아직 만료되지 않은 구독을 반환해요. 기존 무료 유저는 `subscriptions` row 가 없어 기본 'free' plan(V008 시드)의 무료 기능만 씁니다. 결제가 완료되면 `BillingPort.activateFromPayment(userId, planCode, paymentResult)` 가 구독을 활성화해 프리미엄 기능을 풀어요. 초기 유저에게 무료로 프리미엄을 주려면 운영자가 SQL 로 구독을 직접 INSERT(status=ACTIVE, 만료일을 N 개월 뒤로)하는 grandfathering 도 가능합니다(admin 엔드포인트와 RBAC 는 다음 사이클).

---

### 🟢 6-2. 유저가 앱 삭제 후 재설치 — 데이터 복구 불가 (로컬 전용 앱)

**시나리오** — sumtally 가 아직 백엔드에 연결되지 않아 로컬 SQLite 만 쓰는 상태예요. 유저가 앱을 삭제하고 재설치하면 로컬 데이터가 사라집니다.

**영향** — 유저 불만.

**해결** — 이것이 백엔드를 붙이는 가장 큰 이유 중 하나예요. 서버에 데이터가 있으면 재설치 후 로그인만으로 복구됩니다. Phase 0 을 마친 뒤 각 앱에 서버 동기화를 점진적으로 더하고(core-sync, Phase 1), 그 전까지는 Flutter 측에서 iCloud·Google Drive 연동으로 데이터 백업·복원 기능을 제공할 수 있어요.

---

## 요약: Phase 0 에서 반드시 해결할 것

이 항목들은 이미 구현돼 1 차 방어선을 이룹니다.

| # | 시나리오 | 해결 |
|---|---|---|
| 1-1 | 크로스앱 데이터 접근 | `AppSlugVerificationFilter` (구현 완료) |
| 1-2 | JWT 비밀키 유출 방어 | 키 길이 검증, `.gitignore`, 환경변수 |
| 1-3 | Refresh token 탈취 | rotation + 탈취 감지 (구현 완료) |
| 1-9 | Apple email 신뢰 공격 | 서명된 tokenEmail 우선 (구현 완료) |
| 2-1 | Flyway 실패 시 복구 경로 | CI 검증 + prod VALIDATE_ONLY + rollback |
| 4-1 | 앱스토어 필수 요구사항 | 순차 구현 |

## Phase 1 에서 해결할 것

| # | 시나리오 | 해결 |
|---|---|---|
| 1-4 | Apple 토큰 revoke | `WithdrawService` + Apple revoke API |
| 1-6 | 이메일 열거 타이밍 공격 | BCrypt 더미 해싱 |
| 2-2 | 30 일 hard delete | `@Scheduled` 스케줄러 |
| 4-2 | 데이터 이관권 | data-export API |

---

## 관련 문서

- [`Repository Philosophy — 책 안내`](../philosophy/README.md) — 38 개 ADR 인덱스 (설계 결정의 이유)
- [`Architecture Reference`](../structure/architecture.md) — 시스템 구조
- [`API Response Format`](../api-and-functional/api/api-response.md) — API 응답 포맷
- [`Design Principles`](../convention/design-principles.md) — 설계 원칙
