# Swagger UI — API 탐색

> **유형**: Reference · **독자**: Level 1 · **읽는 시간**: ~3분

Spring Boot 의 [`springdoc-openapi`](https://springdoc.org/) 가 OpenAPI 문서를 *자동 생성* 하고 Swagger UI 로 제공해요. 새 `@RestController` 를 추가하면 별도 설정 없이 *자동* 으로 노출돼요.

## 접근 URL

| 환경 | Swagger UI | OpenAPI JSON |
|---|---|---|
| 로컬 (`<repo> local start`) | `http://localhost:8081/swagger-ui.html` | `http://localhost:8081/v3/api-docs` |
| 운영 (`prod deploy` 후) | `https://<your-domain>/swagger-ui.html` | `https://<your-domain>/v3/api-docs` |

> 로컬 port 8081 은 `bootstrap/src/main/resources/application.yml` 의 `server.port` 기본값이에요. 운영 컨테이너는 8080 으로 override 하지만 외부 접근은 Cloudflare Tunnel + kamal-proxy 를 통해 443 으로 통합돼요.

## 자동 등록 메커니즘

1. **컴포넌트 스캔** — `@SpringBootApplication` 의 component scan 이 `@RestController` 와 `@Configuration` 빈을 등록해요.
2. **OpenAPI 생성** — `springdoc-openapi` 가 등록된 모든 `@RestController` 를 순회하면서 `@RequestMapping`, `@PathVariable`, `@RequestBody` 등 메타데이터를 분석해 OpenAPI 3.x 스펙을 자동으로 생성해요.
3. **Swagger UI 노출** — `/swagger-ui.html` 에서 위 스펙을 사람이 읽기 쉬운 UI 로 렌더링해요.

## 슬러그별 컨트롤러

`<your-backend> new <slug>` 가 생성하는 슬러그 모듈은 4 개의 controller 를 만들어요.

| Controller | base path | 역할 |
|---|---|---|
| `*AuthController` | `/api/apps/<slug>/auth/*` | 회원가입 / 로그인 / 비번 재설정 |
| `*HealthController` | `/api/apps/<slug>/health` | 슬러그별 헬스체크 |
| `*IapController` | `/api/apps/<slug>/iap/*` | Apple/Google IAP 영수증 검증 / webhook |
| `*PaymentController` | `/api/apps/<slug>/payment/*` | PortOne PG 결제 검증 / webhook |

이 4 개는 각 slug 별 *thin wrapper* 예요 — core 의 Port (`AuthPort`, `IapPort`, `PaymentPort`) 호출만 해요. Swagger UI 에서 slug 별로 그룹화돼서 보여요 (예: `banana-auth`, `chiken-iap` 등 `@Tag` 로 구분).

## 새 controller 추가 시

```bash
# 1) 코드 추가 후 (예: /api/apps/myapp/products/*)
# 2) 컨테이너 재빌드 — 새 코드 반영
<repo> local restart    # 로컬: spring 컨테이너 docker compose up -d --build

# 3) 운영
<repo> prod deploy      # kamal build + 배포 후 swagger UI 자동 갱신
```

> `local start` 는 이미 떠 있는 컨테이너를 그대로 재사용해요 (early return). 새로 추가한 controller 코드가 반영되지 않으니까, 새 controller 를 추가했거나 `<repo> new <slug>` 직후라면 반드시 `local restart` 로 재빌드를 강제해야 해요.

## 운영 환경에서 Swagger 노출 정책

운영 환경에서 Swagger UI 를 외부에 그대로 공개할지 여부는 도메인의 보안 정책에 따라 결정해요. API 구조 노출이 큰 위협이 되는 도메인이라면 차단을 권장해요.

- **공개 유지** (default) — 운영자와 QA 담당자가 API 를 빠르게 탐색할 수 있어요. 인증이 필요한 API 는 JWT 없이는 호출되지 않으니까 endpoint 만 노출되는 수준이에요.
- **차단** — `application-prod.yml` 에 `springdoc.swagger-ui.enabled: false` 를 추가하거나, Spring Security 로 `/swagger-ui/**` 와 `/v3/api-docs/**` 경로를 인증 필요로 처리해요.

본 템플릿의 기본값은 공개 유지로 설정되어 있어서 솔로·인디 운영에 친화적이에요. 조직 도메인이라면 보안 검토를 거친 뒤 차단하는 흐름을 권장해요.

## 관련 문서

- [`API Response 규약`](./api-response.md) — `ApiResponse<T>` 표준 envelope
- [`JSON Contract`](./json-contract.md) — DTO 변환 / null 처리
- [`Versioning`](./versioning.md) — API 버전 정책 (ADR-008)
- [`Flutter ↔ Backend Integration`](./flutter-backend-integration.md) — 클라이언트 연동 규약
