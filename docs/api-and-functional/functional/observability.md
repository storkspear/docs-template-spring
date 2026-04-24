# Observability 규약

> **유형**: Explanation · **독자**: Level 2 · **읽는 시간**: ~3분

**설계 근거**: [ADR-007 (솔로 친화적 운영)](../../philosophy/adr-007-solo-friendly-operations.md)

이 문서는 `spring-backend-template` 의 **메트릭·로그·알림** 규약을 정의합니다.

> 인프라 스택 구성 / 프로비저닝 상태: [`infra/infrastructure.md §5`](../../production/deploy/infrastructure.md)
> 셋업 가이드 (도커 기동, 대시보드 프로비저닝): [`infra/monitoring-setup.md`](../../production/setup/monitoring-setup.md)
> 선택 근거 (셀프 호스트 vs 관리형): [`decisions-infra.md`](../../production/deploy/decisions-infra.md) I-06
> 알림 종류/임계치 확정: Item Ops-1 (`../reference/backlog.md`)

## 한 문장 요약

이 문서는 `spring-backend-template` 의 **메트릭 · 로그 · 알림 3 대 축** 규약을 정의합니다. `appSlug` 태깅 의무 + 로그 레벨 가이드 + 알림 임계치.

---

## 3대 축

| 축 | 도구 | 목적 |
|----|------|------|
| 메트릭 | Prometheus + Micrometer | 요청량·에러율·레이턴시·JVM |
| 로그 | Loki + logback (loki4j) | 구조화 로그, 앱별 필터링 |
| 알림 | Alertmanager + Discord webhook | 임계치 초과 시 푸시 |

### 데이터 흐름

```
 Spring Boot (bootstrap)
 │
 ├── Micrometer ──► Prometheus (scrape) ──► Grafana (dashboard)
 │                                          │
 │                                          ▼
 │                                   Alertmanager ──► Discord webhook
 │
 └── logback-loki ──► Loki (push) ──► Grafana (explore)
```

각 축이 독립적으로 작동하므로 한 축이 다운돼도 다른 축은 영향 없음 (예: Loki 다운 시 메트릭/알림은 유지).

## 필수 태깅 — `appSlug` 의무

모든 요청은 **`appSlug` 라벨로 태깅**되어야 합니다. 앱공장 맥락에서 멀티앱이 한 백엔드에 공존하므로, 태그 없이는 모니터링 분리 불가.

- **메트릭**: `AppSlugObservationConvention` 이 `http.server.requests` 에 `app=<slug>` 라벨 자동 부여
- **로그**: `AppSlugMdcFilter` 가 MDC 에 `appSlug` 주입 → Loki label 로 승격
- **Rate limit**: 버킷 키에 `appSlug` 포함

**해석 순서** (MDC + Observation 동일):
1. `SecurityContextHolder.AuthenticatedUser.appSlug()` (인증된 요청)
2. URL path `/api/apps/{slug}/...` (미인증 요청 fallback)
3. 둘 다 없으면 `unknown`

## 로그 레벨 가이드

| 레벨 | 사용 |
|------|------|
| `ERROR` | 시스템 장애, 복구 불가 예외, 외부 서비스 다운 |
| `WARN` | 비즈니스 예외 (인증 실패, 404 등), rate limit 초과 |
| `INFO` | 주요 이벤트 (signin 성공, 백업 완료) |
| `DEBUG` | 개발·디버깅. prod 기본 비활성 |

민감 정보(password, token, JWT secret) 는 **절대** 로그에 남기지 않습니다. `toString()` 오버라이드 시 `@ToString.Exclude` 등으로 명시 제외.

### 로그 작성 Good / Bad 예시

```java
// ✅ Good — 구조화 필드 + 민감정보 제외 + 레벨 적합
log.info("user signed up: userId={}, appSlug={}", user.id(), appSlug);
log.warn("rate limit exceeded: bucket={}, principal={}", bucketKey, principalMask);

// ❌ Bad — 민감정보 노출
log.info("user signed up: {}", user);  // user.passwordHash, user.refreshToken 등 유출 위험
log.debug("JWT payload: {}", jwtToken); // 토큰 전체 로깅 금지

// ❌ Bad — 레벨 오용
log.error("user typed wrong password");  // 비즈니스 예외는 WARN, 시스템 장애만 ERROR
log.info("method foo() called with x=5"); // 디버깅 흔적은 DEBUG
```

## 메트릭 naming

- HTTP: `http.server.requests` (Spring Boot 기본, 자동)
- 도메인 카운터: `<domain>.<verb>.count` (예: `auth.signup.count{app=sumtally}`)
- 도메인 타이머: `<domain>.<verb>.duration`

Prometheus scrape 시 Micrometer 가 `.` → `_` 변환: `http_server_requests_seconds_count`.

## 알림 임계치 (기본값)

`infra/prometheus/rules.yml` 에 정의:

| Alert | 조건 | severity |
|-------|------|---------|
| HighErrorRate | 5xx 비율 > 1% / 5분 | warning |
| HighLatencyP95 | p95 > 1s / 5분 | warning |
| RateLimitSpike | 429 > 10/분 / 3분 | info |
| BackendDown | scrape 실패 / 2분 | critical |
| MinioDown | MinIO scrape 실패 / 2분 | critical |
| MinioDiskUsage* | 70/85/95% | info/warning/critical |

파생 레포가 자기 SLA 에 맞게 `rules.yml` 을 override.

## 환경별 동작

| 환경 | Actuator endpoint | Loki | Alertmanager |
|------|-------------------|------|---------------|
| dev (로컬) | `/actuator/*` 전노출 | `http://localhost:3100` (docker) | Discord webhook 없으면 무음 |
| test (CI) | `health,info,prometheus` | off | off |
| prod | 내부 포트(9090) 만 | `${LOKI_URL}` | Discord webhook |

## 검증

- 로컬: `curl localhost:8081/actuator/prometheus | grep app=`
- CI: `ObservabilityIntegrationTest` / `AppSlugMdcFilterTest` / `AppSlugObservationConventionTest`
- 대시보드: `http://localhost:3000` Grafana "App Factory Overview"

## 관련 문서

- [`infra/monitoring-setup.md`](../../production/setup/monitoring-setup.md) — 프로덕션 모니터링 스택 배포
- [`features/rate-limiting.md`](./rate-limiting.md) — Rate limit 정책
