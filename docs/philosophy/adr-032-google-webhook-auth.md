# ADR-032 — Google Pub/Sub webhook bearer token 검증

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~6분

**상태**: 채택 (2026-05-02)
**전제**: ADR-022 (IAP server notifications), 기존 GoogleNotificationDecoder
**연관**: P 사이클 — 운영 보안 baseline

---

## 결론부터

Google Pub/Sub webhook 의 `Authorization: Bearer <JWT>` 검증 추가 — Google 서비스 계정의 RS256 JWT 를 JWKS 공개키로 verify + audience / issuer 일치 검증.

JWKS 는 24h cache (rotation 대응). `allowed-service-account-emails` whitelist 로 *우리 plzkt 의 서비스 계정 만* 허용. webhook 위조 / replay 공격 차단.

---

## 배경

ADR-022 의 `/iap/google/webhook` endpoint = Google Play RTDN Pub/Sub push 받음. 그러나 **인증 무방비**:

- 누구나 fake notification payload + 진짜 transactionId 추측해 POST 가능
- `BillingPort.handleIapNotification` 호출 → REFUND 처리 → 사용자 자산 영향

**realistic 공격**:
- transactionId 가 추측 어렵지만 (16+ random) leak (DB dump / log 노출 / 직원 인사이드) 시 가능
- 운영 보안 audit (PCI-DSS, ISO 27001) 시 webhook 인증 부재 = compliance 미달

Apple webhook 은 JWS 자체 검증으로 자동 차단 (cert chain). Google 만 hole — 본 ADR 가 막음.

---

## 결정

| 항목 | 값 |
|---|---|
| **검증 방식** | Bearer JWT (RS256) — Google service account 가 Pub/Sub push 발급 시 자동 첨부 |
| **검증 대상** | (1) 서명 (RSA + Google JWKS) (2) audience claim = 우리 webhook URL (3) email claim ∈ allowed service account 리스트 |
| **JWKS endpoint** | `https://www.googleapis.com/oauth2/v3/certs` |
| **JWKS cache** | 1시간 (Google 권장) |
| **활성화** | `app.iap.google.webhook.verify-token=true` 일 때만 filter 등록 (default false — 개발/테스트는 검증 X) |
| **실패 시** | 401 Unauthorized + `{"error":"google_webhook_auth_failed"}` |
| **적용 path** | `/iap/google/webhook` 만 — 다른 endpoint 는 영향 X (`shouldNotFilter`) |

---

## Pub/Sub push 인증 메커니즘

Google Cloud Pub/Sub 가 push subscription 설정 시 service account 등록:

```
gcloud pubsub subscriptions create my-sub \
  --topic=play-billing \
  --push-endpoint=https://server.example.com/api/apps/myapp/iap/google/webhook \
  --push-auth-service-account=pubsub@my-project.iam.gserviceaccount.com \
  --push-auth-token-audience=https://server.example.com/api/apps/myapp/iap/google/webhook
```

→ 이후 모든 push 가:

```
POST /api/apps/myapp/iap/google/webhook
Authorization: Bearer <RS256 JWT>
```

JWT 의 claims:
```json
{
  "iss": "https://accounts.google.com",
  "azp": "<service account>",
  "email": "pubsub@my-project.iam.gserviceaccount.com",
  "aud": "https://server.example.com/api/apps/myapp/iap/google/webhook",
  "iat": ..., "exp": ...
}
```

→ filter 가:
1. RSA 서명 검증 (Google JWKS 의 public key 매칭)
2. audience = our URL
3. email = `app.iap.google.webhook.allowed-service-account-emails` 안

→ 셋 다 통과 시 chain.doFilter, 미통과 시 401.

---

## 활성화 (운영자 셋팅)

```yaml
app.iap.google.webhook:
  verify-token: true
  audience: https://server.example.com/api/apps/myapp/iap/google/webhook
  allowed-service-account-emails:
    - pubsub@my-project.iam.gserviceaccount.com
```

또는 .env:
```
APP_IAP_GOOGLE_WEBHOOK_VERIFY_TOKEN=true
APP_IAP_GOOGLE_WEBHOOK_AUDIENCE=https://...
APP_IAP_GOOGLE_WEBHOOK_ALLOWED_SERVICE_ACCOUNT_EMAILS=pubsub@my-project.iam.gserviceaccount.com
```

**default = false** — 개발/테스트는 검증 안 함 (Pub/Sub 안 통하므로 토큰 부재). 운영에서만 명시 ON.

---

## JWKS cache (1시간)

```
첫 요청  → JWKS endpoint GET → RSA keys cache (1시간)
이후 요청 → 캐시 hit, 외부 호출 X
캐시 만료 → 다음 요청 시 refresh
키 rotate → kid 미스매치 → 한 번 더 refresh
```

→ 외부 호출 횟수 = **시간당 최대 1회**. Pub/Sub push 100~1000건/시간이라도 부하 0.

---

## 검증 (단위 테스트 6건)

`GoogleWebhookAuthFilterTest`:

1. `validJwt_passesThrough` — 정상 JWT (RS256 + 올바른 audience + allowed email) → FilterChain.doFilter
2. `missingBearerHeader_rejects401` — Authorization 헤더 없음
3. `wrongAudience_rejects401` — audience 미스매치 (replay 공격 차단)
4. `unauthorizedEmail_rejects401` — service account email 등록 안 됨
5. `wrongSignature_rejects401` — 다른 RSA keypair 로 서명 (위조 차단)
6. `shouldNotFilter_nonWebhookPath` — webhook path 외에는 filter 적용 X

**테스트 셋업**: `KeyPairGenerator.RSA(2048)` 로 직접 keypair 생성 → JWT 서명 → `FakeJwksClient` 가 public key 반환 → filter 통과/실패 검증. 외부 Google JWKS 호출 0.

---

## 대안 비교

### 옵션 A — IP allowlist (Google Pub/Sub IP 범위)

- 단순. 인증 X, 발신자 IP 만 검증
- ❌ Google IP 범위 광범위 (모든 GCP 사용자 공유) — 같은 GCP 계정의 다른 프로젝트도 공격 가능
- ❌ Cloudflare Tunnel / Kamal 통하면 IP 가짜화 됨

### 옵션 B — Pub/Sub bearer JWT 검증 ★ 채택

- Google 표준 인증 패턴 (Cloud Run, GAE 도 동일)
- audience + email claim 으로 명확 식별
- 외부 의존 (JWKS) 1번만 (cache 1시간)

### 옵션 C — Spring Security oauth2-resource-server

- Spring 표준 — JwtDecoder + JwkSetUri 자동
- ❌ spring-security-oauth2-jose 의존 추가 (~500KB jar)
- ❌ WebSecurity 통합 영향 (path 별 옵션화 복잡)
- 우리 환경엔 JJWT 가 이미 있어 직접 구현이 더 가벼움

---

## 안 다루는 범위

- **Apple webhook** — JWS 자체 검증으로 자동 차단 (AppleJwsVerifier). bearer token 별도 필요 X
- **Slack / 다른 webhook 검증** — 발신자별 다른 패턴. 별도 filter
- **Replay 차단 (nonce)** — JWT 의 jti claim + DB nonce 저장. 현재는 audience + 5분 기본 exp 로 충분
- **JWKS 키 prerotation** — Google 이 미리 새 키 publish. 현재 graceful refresh 로 cover

---

## 관련 파일 (신규)

- `core/core-iap-impl/.../google/GoogleJwksClient.java` — JWKS fetcher + cache
- `core/core-iap-impl/.../google/GoogleWebhookProperties.java` — 설정
- `core/core-iap-impl/.../google/GoogleWebhookAuthFilter.java` — Spring filter
- `core/core-iap-impl/src/test/.../google/GoogleWebhookAuthFilterTest.java` — 6건 PASS

수정:
- `core/core-iap-impl/.../IapAutoConfiguration.java` — 2개 신규 bean (`@ConditionalOnProperty`)
- `core/core-iap-impl/build.gradle` — JJWT + Spring web compileOnly + 테스트 의존
