# Rate Limit 규약

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~2분

`common/common-web/ratelimit/` 의 Bucket4j 기반 rate limit 정책을 정리한 문서예요. 버킷 키 설계와 프로파일별 기본값, strict 가 붙는 민감 엔드포인트, 한도 초과 시 응답 포맷을 한곳에 모았어요.

## 개요

요청 한도는 `RateLimitFilter` 가 강제합니다. 이 필터는 버킷 키를 만들어 분당 토큰을 소비하고, 토큰이 떨어지면 HTTP 429 를 돌려줍니다. 버킷 자체는 Bucket4j 의 Token Bucket 으로, `BucketRegistry` 가 Caffeine 캐시에 담아 관리합니다.

필터는 `common-security` 의 `SecurityConfig` 가 인증 필터 뒤에 등록합니다. 인증이 끝난 뒤에 실행되므로 로그인한 유저는 토큰의 유저 식별자로, 비로그인 요청은 IP 로 버킷을 가릅니다.

## 키 설계

버킷 키는 두 조각을 콜론으로 이은 문자열이에요.

```text
{appSlug}:{principal}
```

- `appSlug` 는 URL `/api/apps/{appSlug}/...` 에서 뽑아내고, 못 뽑으면 `unknown` 으로 둡니다.
- `principal` 은 인증 여부로 갈립니다. 인증된 요청은 `user:{userId}`, 미인증 요청은 `ip:{clientIp}` 가 돼요. 프록시 뒤에서는 `X-Forwarded-For` 의 첫 IP 를 쓰고, 없으면 `getRemoteAddr()` 로 떨어집니다.

이렇게 앱과 유저가 키에 모두 들어가므로 버킷이 앱별·유저별로 독립합니다. 한 유저가 다른 유저의 할당량을 대신 소비할 수 없어요.

## 기본값

한도는 프로파일별로 다르게 잡혀 있어요. 로컬과 dev 는 반복 호출을 방해하지 않으려고 느슨하게, 운영은 엄격하게 둡니다.

| 프로파일 | default | strict |
|---|---|---|
| local | 1000 rpm | 100 rpm |
| dev | 1000 rpm | 100 rpm |
| prod | 60 rpm | 10 rpm |

test 프로파일에는 별도 설정이 없어 `RateLimitProperties` 의 기본값인 60 rpm, 10 rpm 이 그대로 적용됩니다. 모든 값은 환경변수로 덮어쓸 수 있어요. 키는 `APP_RATE_LIMIT_DEFAULT_RPM` 과 `APP_RATE_LIMIT_STRICT_RPM`, 그리고 전역 on/off 인 `APP_RATE_LIMIT_ENABLED` 입니다.

## 민감 엔드포인트

다음 인증 엔드포인트에는 strict 한도가 붙어요. brute-force 나 이메일 폭탄, 인증 회피 공격의 표적이 되기 쉬운 경로들이라 더 빡빡하게 잠급니다. 경로 상수는 `ApiEndpoints.Auth` 에 정의돼 있고, 필터는 요청 경로가 이 접미사로 끝나는지로 판별합니다.

| 경로 상수 | 설명 |
|---|---|
| `EMAIL_SIGNUP` · `EMAIL_SIGNIN` | 이메일 가입·로그인 |
| `APPLE` · `GOOGLE` | 소셜 로그인 |
| `PASSWORD_RESET_REQUEST` · `PASSWORD_RESET_CONFIRM` · `PASSWORD_CHANGE` | 비밀번호 재설정·변경 |
| `VERIFY_EMAIL` · `RESEND_VERIFICATION` | 이메일 검증·재발송 |

나머지 경로에는 default 한도가 적용돼요.

토큰 갱신 경로인 `REFRESH` 는 의도적으로 strict 에서 뺐어요. access token 의 수명이 15분이라 정상 유저도 하루 96회까지 갱신하는데, strict 10 rpm 을 걸면 정상 사용까지 막힙니다. 대신 default 60 rpm 으로 두어, 공격자의 초당 반복은 막으면서 정상 갱신에는 여유를 줬어요.

## 초과 시 응답

한도를 넘기면 필터가 HTTP 429 와 함께 남은 대기 시간을 헤더로 알려줍니다. body 는 다른 API 와 같은 응답 봉투를 따라요. 운영 프로파일은 봉투의 null 필드를 직렬화에서 빼므로 `data` 는 나타나지 않습니다.

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 45
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 0
Content-Type: application/json

{"error":{"code":"CMN_429","message":"rate limit exceeded; retry after 45s"}}
```

`Retry-After` 는 버킷이 토큰 하나를 다시 채우기까지 남은 초이고, 최소 1초로 내림됩니다. 에러 코드 `CMN_429` 는 `CommonError.RATE_LIMIT_EXCEEDED` 에 묶여 있어요.

## 구현 확장

`BucketRegistry` 는 Caffeine 캐시 위에 버킷을 얹습니다. 1시간 동안 접근이 없는 버킷은 만료되고, 전체 개수가 10만을 넘으면 LRU 로 밀려나요. 공격자가 IP 나 appSlug 를 바꿔가며 버킷을 무한히 늘려 JVM 메모리를 고갈시키는 상황을 막기 위한 장치예요.

다만 이 캐시는 단일 JVM 안에서만 유효합니다. 인스턴스를 수평 확장하면 노드마다 버킷이 따로 노므로 한도가 노드 수만큼 느슨해져요. 그때는 `BucketRegistry` 를 인터페이스로 추상화한 뒤 Bucket4j 공식 `bucket4j-redis` 로 분산 구현을 주입하면 됩니다.

## 검증

`RateLimitFilterTest` 가 필터 동작을 9개 단위 테스트로 검증해요. strict 한도까지의 정상 통과, 초과 시 429, 앱별·IP별 버킷 분리, 비민감 경로의 default 적용, 선행 default 트래픽이 strict 한도를 무력화하지 못함, 신뢰 헤더(`CF-Connecting-IP`) 기반 버킷 키와 스푸핑된 `X-Forwarded-For` 무시, 전역 비활성화 동작을 각각 확인합니다. 초과 케이스는 strict 한도를 3으로 잡고 4번째 호출에서 429 와 `CMN_429` 가 나오는지를 봅니다.

## 관련 문서

- [`Observability 규약`](./observability.md) — 버킷 키와 같은 원칙으로 메트릭·로그에 `appSlug` 를 태깅하는 규약
- [`API Response Format`](../api/api-response.md) — 429 를 포함한 에러 응답 봉투 표준
