# Observability 규약

> **유형**: Explanation · **독자**: Level 2 · **읽는 시간**: ~3분

**설계 근거**: [`ADR-007 · 솔로 친화적 운영`](../../philosophy/adr-007-solo-friendly-operations.md)

이 문서는 `template-spring` 의 메트릭·로그·알림 규약을 설명합니다. 앱공장 맥락에서 여러 앱이 한 백엔드에 공존하므로, 관측성도 앱별로 분리되어야 한다는 게 핵심 제약이에요.

> 인프라 스택 구성 / 프로비저닝 상태: [`인프라 (Infrastructure)`](../../production/deploy/infrastructure.md)
> 셋업 가이드 (도커 기동, 대시보드 프로비저닝): [`운영 모니터링 셋업 가이드`](../../production/setup/monitoring-setup.md)
> 선택 근거 (셀프 호스트 vs 관리형): [`인프라 결정 기록 (Decisions — Infrastructure)`](../../production/deploy/decisions-infra.md) I-06
> 알림 종류·임계치 확정: Item Ops-1 ([`../../planned/backlog.md`](../../planned/backlog.md))

## 한 문장 요약

메트릭·로그·알림 세 축이 각자 독립으로 동작하고, 모든 데이터에 `appSlug` 라벨이 붙어 앱별로 분리 조회됩니다. 관측성 스택 자체는 운영 서버에서만 띄우고 로컬에는 없어요.

## 3대 축

세 축은 서로 다른 도구로 서로 다른 신호를 다룹니다.

| 축 | 도구 | 목적 |
|----|------|------|
| 메트릭 | Prometheus + Micrometer | 요청량·에러율·레이턴시·JVM |
| 로그 | Loki + logback (loki4j) | 구조화 로그, 앱별 필터링 |
| 알림 | Alertmanager + Discord webhook | 임계치 초과 시 푸시 |

세 도구는 모두 `infra/docker-compose.observability.yml` 로 운영 서버 (Mac mini) 에서만 기동합니다. 로컬 개발 환경 (`docker-compose.local.yml`) 에는 의도적으로 빼놨어요. 앱이 내보내는 신호 (메트릭·로그) 자체는 코드에 내장돼 항상 발생하지만, 그걸 수집·시각화하는 스택은 운영 전용입니다.

### 데이터 흐름

```text
 Spring Boot (app-factory)
 │
 ├── Micrometer ──► /actuator/prometheus ──► Prometheus (scrape) ──► Grafana
 │                                              │
 │                                              ▼
 │                                       Alertmanager ──► Discord webhook
 │
 └── logback (loki4j) ──► Loki (push) ──► Grafana (explore)
```

각 축이 독립으로 작동하므로 한 축이 다운돼도 다른 축은 영향이 없어요. 예를 들어 Loki 가 죽어도 메트릭과 알림은 그대로 유지됩니다.

## 필수 태깅 — `appSlug`

모든 요청은 `appSlug` 로 태깅되어야 합니다. 여러 앱이 한 백엔드에 공존하므로, 태그가 없으면 모니터링을 앱별로 분리할 수 없어요. 세 곳에서 슬러그가 주입됩니다.

| 위치 | 주입 주체 | 결과 |
|------|-----------|------|
| 메트릭 | `AppSlugObservationConvention` | `http.server.requests` 에 `app="<slug>"` 라벨 부여 |
| 로그 | `AppSlugMdcFilter` | MDC 의 `appSlug` 키 → Loki label 로 승격 |
| Rate limit | `RateLimitFilter` | 버킷 키 `{appSlug}:{principal}:{rpm}` 에 포함 |

슬러그를 어떻게 알아내는지는 메트릭과 로그가 서로 다릅니다.

- **메트릭** (`AppSlugObservationConvention`) — URL path `/api/apps/{slug}/...` 만 봅니다. 매칭이 안 되면 `unknown`. SecurityContext 는 보지 않아요.
- **로그** (`AppSlugMdcFilter`) — 인증된 요청이면 `SecurityContextHolder` 의 `AuthenticatedUser.appSlug()` 를 먼저 쓰고, 없으면 URL path 로 fallback 합니다. 둘 다 없으면 MDC 주입을 건너뛰어요. 이 경우 DB 라우팅이 필요한 요청은 fail-secure 로 막히고 (ADR-037), actuator 같은 비인증 endpoint 는 DB 접근이 없어 그대로 통과합니다.

URL path 추출 규칙은 [`AppSlugExtractor`](../../../common/common-web/src/main/java/com/factory/common/web/AppSlugExtractor.java) 한 곳에 모아뒀어요. 슬러그는 소문자·숫자·하이픈만 (`[a-z][a-z0-9-]*`) 허용합니다.

## 로그 레벨 가이드

| 레벨 | 사용 |
|------|------|
| `ERROR` | 시스템 장애, 복구 불가 예외, 외부 서비스 다운 |
| `WARN` | 비즈니스 예외 (인증 실패, 404 등), rate limit 초과 |
| `INFO` | 주요 이벤트 (signin 성공, 백업 완료) |
| `DEBUG` | 개발·디버깅용. 운영 기본 비활성 (`root level INFO`) |

민감 정보 (password, token, JWT secret) 는 절대 로그에 남기지 않습니다. 엔티티 `toString()` 을 오버라이드할 땐 `@ToString.Exclude` 같은 표식으로 민감 필드를 명시 제외해요.

### 로그 작성 Good / Bad 예시

```java
// ✅ Good — 구조화 필드 + 민감정보 제외 + 레벨 적합
log.info("user signed up: userId={}, appSlug={}", user.id(), appSlug);
log.warn("rate limit exceeded: bucket={}, principal={}", bucketKey, principalMask);

// ❌ Bad — 민감정보 노출
log.info("user signed up: {}", user);   // user.passwordHash, user.refreshToken 등 유출 위험
log.debug("JWT payload: {}", jwtToken); // 토큰 전체 로깅 금지

// ❌ Bad — 레벨 오용
log.error("user typed wrong password"); // 비즈니스 예외는 WARN, 시스템 장애만 ERROR
log.info("method foo() called with x=5"); // 디버깅 흔적은 DEBUG
```

모든 로그 라인 앞에는 logback pattern 이 `requestId` 와 `appSlug` 를 자동으로 붙입니다 (`[%X{requestId:-}] [%X{appSlug:-}]`). `requestId` 는 [`MdcFilter`](../../../common/common-logging/src/main/java/com/factory/common/logging/MdcFilter.java) 가 요청마다 부여하는 correlation ID 로, 들어온 `X-Request-Id` 헤더가 있으면 재사용하고 없으면 새 UUID 를 만들어 응답 헤더로 echo 해요.

## 메트릭 naming

- HTTP: `http.server.requests` — Spring Boot 기본, 자동 생성. `app` 라벨이 위에서 부여됩니다.
- 도메인 카운터: `<domain>.<verb>` 형태로 직접 등록. 예로 결제 알림 도메인은 `billing.notification.sent` 카운터에 `channel`·`kind`·`result` 태그를 답니다 ([`SubscriptionNotificationListener`](../../../core/core-billing-impl/src/main/java/com/factory/core/billing/impl/listener/SubscriptionNotificationListener.java) 참조).

Prometheus 가 scrape 할 때 Micrometer 가 `.` 을 `_` 로 바꾸므로, `http.server.requests` 는 `http_server_requests_seconds_count` 로 노출됩니다. 앱별 RPS 는 `sum by (app) (rate(http_server_requests_seconds_count[5m]))` 로 조회해요.

`management.metrics.tags` 로 모든 메트릭에 `application` 과 `env` 태그도 공통 부여됩니다. `env` 는 활성 프로파일 (`dev`/`prod`) 값이라 Grafana 에서 환경을 구분하는 데 쓰여요.

## 알림 임계치 (기본값)

`infra/prometheus/rules.yml` 에 정의돼 있고, 파생 레포가 자기 SLA 에 맞게 override 합니다.

| Alert | 조건 | severity |
|-------|------|---------|
| HighErrorRate | 5xx 비율 > 1% / 5분 | warning |
| HighLatencyP95 | p95 > 1s / 5분 | warning |
| RateLimitSpike | 429 > 10/분 / 3분 | info |
| BackendDown | scrape 실패 / 2분 | critical |
| MinioDown | MinIO scrape 실패 / 2분 | critical |
| MinioDiskUsage | 70% / 85% / 95% | info / warning / critical |

발화된 알림은 `infra/alertmanager/config.yml` 의 Discord webhook 으로 나갑니다. `DISCORD_WEBHOOK_URL` 이 비어 있으면 Alertmanager 컨테이너는 아예 뜨지 않아요 (`alertmanager` compose profile 로 게이팅). 즉 webhook 이 설정돼야만 알림 경로가 활성화됩니다.

## 환경별 동작

| 환경 | Actuator 노출 | 관측성 스택 |
|------|---------------|-------------|
| local (로컬) | 전체 (`include: "*"`) | 없음 — 앱 메트릭·로그만 발생, 수집기 미기동 |
| dev (Mac mini) | `health,info,prometheus` | Prometheus·Grafana·Loki·Alertmanager 운영 스택과 공유. logback 이 `LOKI_URL` 로 직접 push |
| test (CI) | `health,info,prometheus` | 없음 |
| prod (Mac mini) | `health,info,prometheus` | 운영 스택 전체. logback JSON 콘솔 + Loki push |

dev 와 prod 의 actuator endpoint 는 앱 포트 (`:8080`) 와 공유합니다. 별도 management port 로 격리하지 않은 건, kamal-proxy healthcheck 가 같은 포트에서 `/actuator/health/liveness` 를 hit 할 수 있어 설정이 단순해지기 때문이에요. 노출 endpoint 는 `health`·`info`·`prometheus` 셋으로 제한해 민감 경로를 차단합니다.

로컬에는 수집 스택이 없으므로 Grafana 대시보드나 Prometheus 알림을 로컬에서 확인할 수는 없어요. 앱이 내보내는 신호 자체는 `/actuator/prometheus` 에서 직접 확인할 수 있습니다.

## 검증

- 메트릭 라벨 확인: `curl localhost:8081/actuator/prometheus | grep 'app='` — `app` 라벨이 앱별로 붙는지 본다 (수집 스택 없이도 동작).
- 단위 테스트: `AppSlugObservationConventionTest` (메트릭 라벨), `AppSlugMdcFilterTest` (MDC 주입), `MdcFilterTest` (requestId 전파).
- 운영 대시보드: 운영 서버에서 `infra/docker-compose.observability.yml` 기동 후 Grafana "App Factory Overview" 확인.

## 관련 문서

- [`운영 모니터링 셋업 가이드`](../../production/setup/monitoring-setup.md) — 운영 관측성 스택 배포 절차
- [`Rate Limit 규약`](./rate-limiting.md) — 버킷 키에 `appSlug` 가 들어가는 rate limit 정책
