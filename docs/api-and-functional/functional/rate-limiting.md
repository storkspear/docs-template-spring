# Rate Limit 규약

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~2분

`common/common-web/ratelimit/` 의 Bucket4j 기반 rate limit 정책.

## 개요

`common/common-web/ratelimit/` 의 **Bucket4j 기반 rate limit 정책** 명세. 키 설계 · 기본값 · 민감 엔드포인트 · 429 응답 포맷.

---

## 키 설계

```
{appSlug}:{principal}
```

- `appSlug`: URL path `/api/apps/{slug}/...` 에서 추출
- `principal`:
  - 인증된 요청 → `user:{userId}`
  - 미인증 요청 → `ip:{clientIp}` (X-Forwarded-For 첫 IP 우선)

→ **앱별 독립**, **유저별 독립**. 한 유저가 다른 유저의 할당량 소비 불가.

## 기본값

| 프로파일 | default | strict |
|---------|---------|--------|
| dev | 1000 rpm | 100 rpm |
| test | 60 rpm | 10 rpm |
| prod | 60 rpm | 10 rpm |

환경변수 override: `APP_RATE_LIMIT_{DEFAULT,STRICT}_RPM`.

## 민감 엔드포인트 (strict 적용)

`ApiEndpoints.Auth` 중:
- `EMAIL_SIGNUP`, `EMAIL_SIGNIN`
- `APPLE`, `GOOGLE` (소셜 로그인)
- `REFRESH` (토큰 갱신)
- `PASSWORD_RESET_REQUEST`, `PASSWORD_RESET_CONFIRM`, `PASSWORD_CHANGE`
- `VERIFY_EMAIL`, `RESEND_VERIFICATION`

나머지는 default 적용.

## 초과 시 응답

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 45
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 0
Content-Type: application/json

{"error":{"code":"CMN_429","message":"rate limit exceeded; retry after 45s"}}
```

## 구현 확장

기본은 ConcurrentHashMap (단일 JVM). 수평 확장 시:
- Redis 로 교체 → `BucketRegistry` 인터페이스화 후 Redis 구현 주입
- Bucket4j 공식 `bucket4j-redis` 사용

## 검증

- 단위 테스트: `RateLimitFilterTest` (7개)
- 통합: signup 엔드포인트 11회 호출 → 마지막 429

## 관련 문서

- [`observability.md`](./observability.md) — `appSlug` 태깅 (버킷 키와 동일 원칙)
- [`../api-contract/api-response.md`](../api/api-response.md) — 429 응답 포맷 표준
