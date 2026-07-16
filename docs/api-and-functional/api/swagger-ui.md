# Swagger UI — API 탐색

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~4분

이 레포는 [`springdoc-openapi`](https://springdoc.org/) (v2.8.13) 로 OpenAPI 3 문서를 자동 생성하고 Swagger UI 로 제공합니다. 새 `@RestController` 를 추가하면 springdoc 가 component scan 으로 잡아 자동 노출하고, `@Operation`·`@Tag` 어노테이션이 있으면 요약·그룹까지 함께 반영합니다.

핵심을 먼저 짚으면 이래요.

- **노출 경로** — Swagger UI 는 `/swagger-ui.html`, OpenAPI JSON 은 `/v3/api-docs` (둘 다 base `application.yml` 의 `springdoc` 설정).
- **프로파일별 정책** — `local` 에서만 켜져 있고, `dev`·`prod` 는 기본으로 꺼 둡니다 (OWASP A05.1, 외부 노출 차단).
- **인증** — `OpenApiConfig` 가 Bearer JWT 보안 스킴을 글로벌 등록해서 "Authorize" 버튼 한 번으로 모든 호출에 토큰이 붙습니다.

## 접근 URL

`SPRING_PROFILES_ACTIVE` 에 따라 Swagger UI 활성 여부가 갈립니다. 아래는 프로파일별 동작이에요.

| 프로파일 | 환경 | Swagger UI | OpenAPI JSON |
|---|---|---|---|
| `local` | 로컬 (`<repo> init` / `<repo> start`) | `http://localhost:8081/swagger-ui.html` ✅ | `http://localhost:8081/v3/api-docs` ✅ |
| `dev` | dev 서버 (`<repo> dev deploy`) | 404 (기본 비활성) | 404 (기본 비활성) |
| `prod` | 운영 (`<repo> prod deploy`) | 404 (기본 비활성) | 404 (기본 비활성) |

로컬 port 8081 은 base `application.yml` 의 `server.port` 기본값이에요. dev·prod 컨테이너는 `SERVER_PORT=8080` 으로 override 하고 (`config/deploy.yml`, Dockerfile `EXPOSE 8080` 과 일치), 외부 접근은 Cloudflare Tunnel 과 kamal-proxy 를 거쳐 443 으로 통합돼요.

## 자동 등록 메커니즘

새 controller 가 별도 등록 코드 없이 Swagger UI 에 뜨는 흐름은 세 단계예요.

1. **컴포넌트 스캔** — `@SpringBootApplication` 의 component scan 이 `@RestController` 와 `@Configuration` 빈을 등록합니다.
2. **OpenAPI 생성** — springdoc 가 등록된 모든 `@RestController` 를 순회하면서 `@RequestMapping`·`@PathVariable`·`@RequestBody` 메타데이터를 분석해 OpenAPI 3 스펙을 만듭니다. `@Operation` 으로 단 요약·설명도 이때 반영됩니다.
3. **Swagger UI 노출** — `/swagger-ui.html` 이 위 스펙을 사람이 읽는 UI 로 렌더링합니다.

`OpenApiConfig` 의 `openAPI()` 빈이 여기에 한 가지를 더 얹어요. 모든 엔드포인트가 Bearer JWT 를 요구한다는 보안 스킴을 글로벌로 등록해서, Swagger UI 의 "Authorize" 버튼으로 토큰을 한 번 입력하면 이후 모든 호출에 자동으로 첨부됩니다.

## 슬러그별 컨트롤러 — HealthController 하나 + core 공유

`<repo> new <slug>` 가 만드는 앱 모듈의 컨트롤러는 `<Slug>HealthController` **1 개**뿐이에요 (`@Tag(name = "<slug>")`, `GET /api/apps/<slug>/health`). 인증·결제·IAP 는 슬러그별 사본이 아니라 core 의 **공유 런타임 빈**이 `{appSlug}` path 변수로 모든 앱을 처리합니다 (ADR-013 B).

| Controller | 소유 모듈 | base path | `@Tag` |
|---|---|---|---|
| `<Slug>HealthController` | `apps/app-<slug>` (생성됨) | `/api/apps/<slug>` | `<slug>` |
| `AuthController` | `core-auth-impl` (공유) | `/api/apps/{appSlug}/auth` | `auth` |
| `UserController` | `core-user-impl` (공유) | `/api/apps/{appSlug}/users` | `core-user` |
| `DeviceController` | `core-device-impl` (공유) | `/api/apps/{appSlug}/devices` | `core-device` |
| `PaymentController` | `core-billing-impl` (공유) | `/api/apps/{appSlug}/payment` | `payment` |
| `IapController` | `core-billing-impl` (공유) | `/api/apps/{appSlug}/iap` | `iap` |

Swagger UI 에서 슬러그별 그룹은 `<slug>` 태그(헬스체크)로만 보이고, 인증·유저·결제 그룹은 공유 태그(`auth`·`core-user`·`payment`·`iap` 등) 아래에 `{appSlug}` path 변수 형태로 나타나요.

## 새 controller 추가 시

새 controller 를 짠 뒤 Swagger UI 에 반영하려면 컨테이너에 새 코드를 태워야 해요.

```bash
# 1) 코드 추가 (예: /api/apps/myapp/products/*)
# 2) 로컬 — spring 컨테이너만 재빌드
<repo> local restart    # docker compose up -d --build spring

# 3) 운영 — kamal build + 배포 후 자동 갱신
<repo> prod deploy
```

`<repo> local start` 는 이미 떠 있는 컨테이너가 헬스체크에 응답하면 그대로 재사용해요 (early return). 새로 추가한 controller 코드는 이때 반영되지 않으니까, controller 를 추가했거나 `<repo> new <slug>` 직후라면 `<repo> local restart` 로 재빌드를 강제하세요.

## 운영 환경의 Swagger 노출 정책

본 템플릿은 `dev`·`prod` 에서 Swagger UI 와 OpenAPI 명세를 **기본으로 차단**합니다. API 구조 노출을 줄여 공격 표면을 좁히는 fail-secure 기본값이에요 (OWASP A05.1 — Security Misconfiguration).

```yaml
# application-prod.yml / application-dev.yml 공통
springdoc:
  swagger-ui:
    enabled: false
  api-docs:
    enabled: false
```

이 설정으로 `/swagger-ui.html` 과 `/v3/api-docs` 둘 다 404 가 됩니다. dev 가 Cloudflare Tunnel 로 외부에 노출되는 점을 고려해 dev 도 prod 와 같은 정책을 따라요.

| 환경 | 기본값 | 켜는 법 |
|---|---|---|
| `local` | 노출 (개발 편의) | 별도 설정 없음 — base `application.yml` 그대로 |
| `dev` | 차단 | `SPRINGDOC_SWAGGER_UI_ENABLED=true` 환경변수로 일시 override |
| `prod` | 차단 | 권장하지 않음. 필요하면 stage·internal 전용 yml 로만 제한적 활성화 |

운영에서 잠깐 탐색이 필요하면 환경변수로 켜되, 끝나면 다시 끄는 흐름을 권장합니다. 상시 공개가 필요한 조직 도메인이라면 Spring Security 로 `/swagger-ui/**` 와 `/v3/api-docs/**` 경로를 인증 뒤로 두는 방식이 더 안전해요.

## 관련 문서

- [`API Response 규약`](./api-response.md) — `ApiResponse<T>` 표준 envelope
- [`JSON Contract`](./json-contract.md) — DTO 변환 · null 처리
- [`Versioning`](./versioning.md) — API 버전 정책 (ADR-008)
- [`Flutter ↔ Backend Integration`](./flutter-backend-integration.md) — 클라이언트 연동 규약
- [`OWASP Top 10 매핑`](../../production/setup/owasp-top10-mapping.md) — A05.1 Swagger prod 차단 근거
