# ADR-032 — Google Pub/Sub webhook bearer token 검증

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~6분

**Status**: Accepted. `GoogleWebhookAuthFilter` 가 `/iap/google/webhook` 의 `Authorization: Bearer <JWT>` 헤더를 RS256 + JWKS + audience + email whitelist 4 단계로 검증.

---

## 결론부터

Google Play 의 RTDN (Real-Time Developer Notifications) webhook 은 *Google Cloud Pub/Sub* 을 통해 우리 백엔드로 push 됩니다. 이 webhook endpoint 는 *공개 인터넷에 노출* 되어 있어 *누구나 임의의 payload 로 POST* 할 수 있는 형태예요. 인증이 없으면 *공격자가 가짜 환불 알림을 보내 사용자 구독을 임의로 취소* 하거나 *가짜 갱신 알림으로 결제 상태를 조작* 할 수 있는 보안 구멍이 됩니다.

본 ADR 은 Google Pub/Sub webhook 의 *Bearer JWT 검증* 을 추가합니다. Google Cloud Pub/Sub 은 push subscription 설정 시 *service account* 를 등록할 수 있고, push 발송 시 *그 service account 의 RS256 서명 JWT 를 `Authorization: Bearer <JWT>` 헤더에 자동 첨부* 합니다. 우리 백엔드는 이 JWT 를 *4 단계로 검증* 해야 진짜 Google 발송으로 신뢰할 수 있어요.

검증의 4 단계는 이렇게 작동합니다. 첫째, *RS256 서명 검증* — Google JWKS endpoint (`https://www.googleapis.com/oauth2/v3/certs`) 의 공개키로 JWT 의 서명을 확인해 *Google 의 service account 가 정말 발급했는지* 를 보증합니다. 둘째, *audience claim 일치 검증* — JWT 의 `aud` claim 이 *우리 webhook URL* 과 일치해야 *다른 시스템용으로 발급된 토큰이 우리에게 replay 되는* 공격을 차단해요. 셋째, *email whitelist 검증* — JWT 의 `email` claim 이 *우리가 사전 등록한 service account 이메일 목록* 에 있어야 *같은 GCP 환경의 다른 프로젝트* 에서 발급한 토큰을 막을 수 있습니다. 넷째, *expiration 검증* — JWT 의 `exp` claim 으로 *오래된 JWT 의 replay* 를 차단해요.

JWKS 공개키는 1 시간 캐시로 두어 *키 회전에 자동 대응* 하면서도 *매 webhook 요청마다 Google JWKS 호출* 하는 비용을 회피합니다. Google 이 권장하는 캐시 주기를 그대로 따른 형태예요. 활성화는 *opt-in* (`app.iap.google.webhook.verify-token=true`) 으로 두어 *개발 / 테스트 환경* 에서는 검증을 끄고 *운영 환경에서만 enable* 하는 형태로 운영자가 통제할 수 있습니다.

이 ADR 의 범위는 Google Pub/Sub push 인증 메커니즘의 본질, 4 단계 검증 흐름의 각 단계 의미, JWKS 캐싱 전략, opt-in 활성화 정책, 그리고 *왜 IP allowlist 같은 단순 대안이 부족한지* 의 트레이드오프 분석까지입니다.

---

## 왜 이런 결정이 필요했나?

[`ADR-022`](./adr-022-iap-server-notifications.md) 가 Google RTDN webhook 의 *처리 로직* 을 정의했지만, *인증* 은 별개의 영역으로 남아 있어요. webhook endpoint 는 *공개 인터넷에 노출* 되어야 Google 의 push 를 받을 수 있고, 그 *공개성* 자체가 *무방비 공격 표면* 의 시작점입니다.

인증 없는 webhook 의 위험성을 시나리오로 보면 명확해요. 공격자가 우리 시스템의 `/iap/google/webhook` URL 만 알면 (URL 은 보통 *문서 / 운영 로그 / 코드 저장소* 어디든 노출될 수 있어요), *임의의 RTDN 페이로드를 POST* 할 수 있습니다. RTDN 페이로드의 형식은 *Google 공식 문서에 공개되어 있어* 누구나 가짜 메시지를 만들어낼 수 있고, 그 메시지가 *REFUND* type 이면 우리 백엔드는 `BillingPort.handleIapNotification` 을 호출해 *PaymentRecord 를 REFUNDED 로 변경 + Subscription 을 CANCELLED 로 전환* 합니다. 사용자가 *결제한 적도 없는 환불* 을 받게 되어 *사용자 자산이 임의로 조작* 되는 사고예요.

*transactionId 가 추측 어렵다* 는 사실이 일부 방어가 되긴 하지만, 완벽하지 않습니다. transactionId 는 *Google 이 발급한 16+ 자리 random ID* 라 brute-force 추측은 불가능하지만, *DB dump 유출 / 로그 노출 / 직원 인사이드 위협* 같은 경로로 *진짜 transactionId 가 leak 되는* 시점이 오면 *그 ID 로 가짜 환불 페이로드* 를 만들어 cross-app 공격이 가능해져요. *데이터 leak 자체가 즉시 자산 손실로 환산되는* 보안 모델은 매우 취약한 형태입니다.

운영 보안 audit 측면에서도 부담이 커요. *PCI-DSS* 나 *ISO 27001* 같은 표준은 *webhook endpoint 에 대한 인증 메커니즘* 을 요구하고, *인증 부재* 는 audit 에서 *compliance 미달* 로 분류돼요. 결제 관련 시스템이 audit 를 통과하지 못하면 *PG 측 약관 위반* 이나 *카드사 수수료 협상의 마이너스 요인* 이 될 수 있습니다.

Apple webhook 은 이 영역이 *자동으로* 해결되어 있어요. Apple App Store Server Notifications V2 의 페이로드는 *JWS (이중 서명)* 형태라 *우리 백엔드가 페이로드를 디코드하면서 자연스럽게 cert chain + ES256 서명 검증* 을 수행하고, 이 검증을 통과하지 못하면 페이로드 자체가 무효해집니다. *별도 인증 단계 없이도 인증이 페이로드에 내장* 된 형태예요. Google RTDN 은 이런 내장 검증이 없어 *별도 Bearer JWT 인증* 을 추가해야 같은 수준의 안전성을 확보할 수 있습니다.

해결책의 후보로 *IP allowlist* 같은 단순한 형태도 있어요. *Google Pub/Sub 의 발송 IP 범위만 허용* 하는 방식인데, 이는 두 가지 한계가 있습니다. 첫째, *Google Pub/Sub IP 범위* 는 *모든 GCP 사용자가 공유* 해서 *같은 GCP 의 다른 프로젝트* 도 우리 IP allowlist 를 통과할 수 있어요. 둘째, 우리 인프라가 *Cloudflare Tunnel / Kamal proxy* 를 거치면 *원본 IP 가 가짜화* 되어 IP 검증 자체가 무력화됩니다.

진짜 안전한 방법은 *Bearer JWT 검증* 이에요. Google Pub/Sub push 발송 시 첨부되는 JWT 는 *우리가 지정한 service account 가 발급한 RS256 서명* 이라 *위조가 사실상 불가능* 하고, *우리 audience URL 매칭 + email whitelist* 까지 더하면 *우리 plzkt 만이 발급할 수 있는 토큰* 으로 좁혀집니다. 추가 인프라 없이 *Google JWKS endpoint* 만으로 검증이 가능한 점도 [`ADR-007`](./adr-007-solo-friendly-operations.md) 의 솔로 친화 정신에 정합해요.

이 결정이 답해야 할 물음은 이거예요.

> **공개 webhook endpoint 에서 Google Pub/Sub 발송만을 진짜로 신뢰할 수 있게 하려면, 어떤 검증 메커니즘이 외부 의존 없이 cross-app 공격과 replay 공격을 동시에 차단하는가?**

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

1. `validJwt_passesThrough` — 정상 JWT (RS256 + 올바른 audience + allowed email) → FilterChain.doFilter 통과
2. `missingBearerHeader_rejects401` — Authorization 헤더가 없으면 401
3. `wrongAudience_rejects401` — audience 미스매치 시 401 (replay 공격 차단)
4. `unauthorizedEmail_rejects401` — service account email 미등록 시 401
5. `wrongSignature_rejects401` — 다른 RSA keypair 로 서명 시 401 (위조 차단)
6. `shouldNotFilter_nonWebhookPath` — webhook path 외에는 filter 가 적용되지 않아요

**테스트 셋업**: `KeyPairGenerator.RSA(2048)` 로 직접 keypair 를 생성해요 → JWT 서명 → `FakeJwksClient` 가 public key 반환 → filter 통과/실패를 검증해요. 외부 Google JWKS 호출은 0 이에요.

---

## 대안 비교

### 옵션 A — IP allowlist (Google Pub/Sub IP 범위)

- 단순해요. 인증 X, 발신자 IP 만 검증해요
- ❌ Google IP 범위가 광범위해요 (모든 GCP 사용자 공유) — 같은 GCP 계정의 다른 프로젝트도 공격 가능해요
- ❌ Cloudflare Tunnel / Kamal 을 통하면 IP 가 가짜화돼요

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
