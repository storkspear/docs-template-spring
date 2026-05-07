# ADR-036 — SSRF 방어: 외부 URL whitelist 정책

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~5분

**Status**: Accepted. 모든 외부 HTTP 호출의 URL 은 hardcode 또는 운영자 통제 환경변수로만 결정해요. 사용자 입력으로 URL 이 결정되는 지점은 코드 어디에도 없습니다. 본 ADR 은 이 정책을 명문화하고 새 외부 호출 추가 시 가이드라인을 정의해요.

---

## 결론부터

SSRF (Server-Side Request Forgery) 는 *공격자가 서버를 통해 임의 URL 로 요청을 보내게 만드는* 취약점이에요. 클라우드 환경에서는 *내부 메타데이터 endpoint* (예: AWS `169.254.169.254`) 접근으로 *credential 탈취* 가 가능하고, 내부 사설망에서는 *DB / 관리 API* 우회 접근이 가능해요. *공개되면 안 될 IP / 도메인* 으로의 요청을 막는 것이 방어의 핵심이에요.

본 프로젝트의 모든 외부 HTTP 호출은 *고정 URL (hardcode)* 또는 *운영자가 통제하는 환경변수* 로만 결정돼요. 사용자가 입력한 값으로 URL 이 만들어지거나 redirect 가 자동 따라가는 지점이 *코드 어디에도 없어요*. 즉 SSRF 의 일반적 공격 벡터가 *설계상 불가능* 합니다.

이 정책의 핵심은 *명문화* 와 *향후 확장 가이드* 예요. 현재 8 곳의 외부 호출 (Apple JWKS / Google tokeninfo / Google JWKS / Kakao API 2 / Naver API / Resend / MinIO / FCM) 모두 정책 부합 상태이지만, 새 외부 호출을 추가하는 개발자가 *별생각 없이 사용자 입력으로 URL 을 만드는 케이스* 를 사전에 차단해야 해요. ADR 에 정책을 박아두면 *코드 review / ArchUnit / 향후 본인의 future-self* 에게 같은 message 를 일관되게 전달할 수 있어요.

---

## 왜 이런 결정이 필요했나?

웹 백엔드의 외부 호출은 보통 *third-party API 통합* (소셜 로그인 검증, 결제 webhook, 푸시 발송, 이메일 발송, 스토리지 등) 에서 발생해요. 이런 호출은 종종 *동적 URL* 형태로 구현되는데, *사용자 입력* 이 URL 의 일부에 들어가면 SSRF 가 가능해져요.

전형적 SSRF 공격 사례를 보면 위험이 명확해요. *URL preview / image proxy* 같은 기능에서 사용자가 `http://169.254.169.254/latest/meta-data/iam/security-credentials/<role>` 같은 URL 을 입력하면, AWS EC2 의 IMDSv1 엔드포인트가 응답해서 *해당 인스턴스의 IAM credential* 이 공격자에게 노출됩니다. *RDS endpoint / Redis / Elasticsearch* 같은 내부 서비스도 같은 방식으로 우회 접근될 수 있어요.

본 프로젝트는 *다행히* 이런 동적 URL 처리를 하지 않습니다. 외부 호출은 모두 *고정된 third-party endpoint* (Apple, Google, Kakao 등) 로 향하고, 사용자가 보내는 *token / id* 는 query parameter 또는 body 에만 들어가지 *호스트네임이나 path* 를 결정하지 않아요.

그러나 *현재 안전하다는 것* 과 *앞으로도 안전하다는 것* 은 다른 이야기예요. 새 기능 추가 시 *예: 사용자가 자기 프로필에 외부 이미지 URL 을 등록하면 서버가 다운로드해서 캐싱* 같은 기능이 추가되면 SSRF 가 즉시 가능해져요. 이런 시나리오를 사전에 차단하려면 *"외부 URL 은 hardcode 또는 환경변수만"* 이라는 정책이 코드 baseline 으로 박혀있어야 해요.

또 *복합 방어 (defense in depth)* 측면에서 개별 호출의 timeout, redirect 정책, private IP 차단 같은 *secondary defenses* 도 명시할 가치가 있어요. URL whitelist 만으로 100% 방어가 안 되는 경우 (예: 환경변수가 잘못 설정되어 internal IP 로 향하는 케이스) 에 *추가 안전망* 이 필요해요.

이 결정이 답해야 할 물음은 이거예요.

> **외부 HTTP 호출 추가 시 SSRF 가 발생할 가능성을 사전에 차단하려면 어떤 정책 baseline 이 필요한가?**

---

## 결정

| 항목 | 정책 | 사유 |
|---|---|---|
| **URL 결정 방식** | hardcode (소스 상수) 또는 환경변수 (운영자 통제) | 사용자 입력으로 host / path 결정 금지 |
| **timeout** | connect ≤ 5s, request ≤ 10s | 응답 안 오는 endpoint 가 서버 스레드 점유하는 것 차단 |
| **redirect** | 자동 follow 비활성 (Java HttpClient default) | redirect 체인을 통한 우회 차단 |
| **private IP 차단** | 명시 정책 없음 (추후 도입 검토) | 현 호출 모두 public cloud endpoint 라 현실 위험 낮음 |
| **DNS rebinding 방어** | 명시 정책 없음 (추후 도입 검토) | TOCTOU 공격 매우 낮은 확률 |
| **새 호출 추가 시** | 본 ADR 의 가이드라인 4 항목 모두 충족 | review 시 검증 |

### 4 가지 가이드라인 (새 외부 호출 추가 시)

새 third-party API 통합을 추가할 때 *반드시* 다음 4 가지를 충족해야 해요:

1. **URL 의 host + path 는 hardcode 또는 환경변수**. 사용자 입력은 query parameter / body 에만.
2. **HttpClient 에 connectTimeout = 5s 명시**. `HttpClient.newHttpClient()` 의 기본값에 의존하지 말 것.
3. **HttpRequest 에 timeout = 10s 명시**. per-request 단위.
4. **redirect 자동 follow 활성화하지 말 것**. `HttpClient.Builder.followRedirects(NEVER)` 가 default 여서 명시 불필요하지만, 실수로 `ALWAYS` 로 변경 금지.

InterruptedException 처리도 표준 패턴 따름 — `Thread.currentThread().interrupt()` 로 인터럽트 상태 복원 후 application 예외로 변환 (`AuthException`, `EmailException` 등).

---

## 현재 적용 상태 (감사 결과)

본 ADR 작성 시점 (2026-05-06) 의 외부 호출 인벤토리:

| # | 호출 | 파일 (식별자) | URL 결정 | timeout |
|---|---|---|---|---|
| 1 | Apple JWKS | `AppleJwksClient.DEFAULT_JWKS_URL` | hardcode | connect 5s |
| 2 | Google tokeninfo | `GoogleSignInService.DEFAULT_TOKENINFO_URL` | hardcode | connect 5s, req 10s |
| 3 | Google JWKS | `GoogleJwksClient.DEFAULT_JWKS_URL` | hardcode | connect 5s |
| 4 | Kakao token info | `KakaoSignInService.DEFAULT_TOKEN_INFO_URL` | hardcode | connect 5s, req 10s |
| 5 | Kakao user/me | `KakaoSignInService.DEFAULT_USER_ME_URL` | hardcode | connect 5s, req 10s |
| 6 | Naver user info | `NaverSignInService.DEFAULT_USER_ME_URL` | hardcode | connect 5s, req 10s |
| 7 | Resend 이메일 | `ResendEmailAdapter.RESEND_API_URL` | hardcode | connect 5s, req 10s |
| 8 | MinIO 스토리지 | (MinIO SDK 내부) | `APP_STORAGE_MINIO_ENDPOINT` (env) | SDK default |
| 9 | FCM 푸시 | (Firebase Admin SDK 내부) | SDK 내부 관리 | SDK default |

> 식별자 (상수명) 로 인벤토리화 — line number 는 코드 편집 빈번하므로 자동 outdated 위험. 정확한 위치는 `grep -rn '<상수명>' core/` 로 즉시 파악 가능.

모두 정책 부합. 사용자 입력으로 URL 결정되는 지점 0건.

---

## Consequences

**얻는 것**:
- 새 외부 호출 추가 시 SSRF 위험 사전 차단 (review 기준선)
- 향후 본인 또는 협업자가 *별생각 없이 사용자 입력으로 URL 만들기* 케이스 방지
- 보안 audit 응답 즉시 가능 ("SSRF 방어 정책 ADR-036 참조")

**잃는 것 / Trade-off**:
- 사용자가 URL 을 입력해야 하는 기능 (예: webhook 등록, RSS 구독, 이미지 URL 자동 미리보기) 추가 시 *별도 whitelist + private IP 차단* 메커니즘이 필요해서 작업량 증가
- 단 본 프로젝트 *현재 스코프* 에서는 이런 기능이 없으므로 부담 없음

**확장 시 고려사항**:
- 사용자 URL 입력이 필요한 기능 추가하면 본 ADR 을 *amendment* 해서 whitelist + private IP 차단 정책 추가
- DNS rebinding 방어는 *매우 낮은 우선순위* — 실제 공격 사례 발생 시 별도 cycle 에서 도입

---

## 관련 문서

- [`OWASP Top 10 매핑 — A10`](../production/setup/owasp-top10-mapping.md) — SSRF 카테고리의 현 방어 + Gap
- [`Exception Handling`](../convention/exception-handling.md) — InterruptedException 처리 패턴
- [`ADR-027 (Admin Role)`](./adr-027-admin-role-authorization.md) — 권한 검증의 first defense
- [`ADR-016 (DTO Mapper 금지)`](./adr-016-dto-mapper-forbidden.md) — 비슷한 결의 *원칙 명문화* ADR
