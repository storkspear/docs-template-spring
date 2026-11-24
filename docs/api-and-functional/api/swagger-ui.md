<a id="swagger-ui--api-탐색"></a>

# Swagger UI — API 탐색

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~4분

이 레포는 [`springdoc-openapi`](https://springdoc.org/) (v3.0.3) 로 OpenAPI 3 문서를 자동 생성하고 Swagger UI 로 제공합니다. 새 `@RestController` 를 추가하면 springdoc 가 component scan 으로 잡아 자동 노출하고, `@Operation`·`@Tag` 어노테이션이 있으면 요약·그룹까지 함께 반영합니다.

핵심을 먼저 짚으면 이래요.

- **노출 경로** — Swagger UI 는 `/swagger-ui.html`, OpenAPI JSON 은 `/v3/api-docs` (둘 다 base `application.yml` 의 `springdoc` 설정).
- **프로파일별 정책** — `local` 과 `dev` 는 기본으로 켜져 있고, `prod` 만 꺼 둡니다 (OWASP A05.1). dev 는 `SPRINGDOC_SWAGGER_UI_ENABLED=false` 환경변수로 끌 수 있어요.
- **인증** — `OpenApiConfig` 가 Bearer JWT 보안 스킴을 글로벌 등록해서 "Authorize" 버튼 한 번으로 모든 호출에 토큰이 붙습니다.

## 접근 URL

`SPRING_PROFILES_ACTIVE` 에 따라 Swagger UI 활성 여부가 갈립니다. 아래는 프로파일별 동작이에요.

| 프로파일 | 환경 | Swagger UI | OpenAPI JSON |
|---|---|---|---|
| `local` | 로컬 (`<repo> init` / `<repo> start`) | `http://localhost:8081/swagger-ui.html` ✅ | `http://localhost:8081/v3/api-docs` ✅ |
| `dev` | dev 서버 (`<repo> dev deploy`) | ✅ 기본 활성 (`SPRINGDOC_SWAGGER_UI_ENABLED=false` 로 차단) | ✅ 기본 활성 (`SPRINGDOC_API_DOCS_ENABLED=false` 로 차단) |
| `prod` | 운영 (`<repo> prod deploy`) | 404 (비활성) | 404 (비활성) |

로컬 port 8081 은 base `application.yml` 의 `server.port` 기본값이에요. dev·prod 컨테이너는 `SERVER_PORT=8080` 으로 override 하고 (`config/deploy.yml`, Dockerfile `EXPOSE 8080` 과 일치), 외부 접근은 Cloudflare Tunnel 과 kamal-proxy 를 거쳐 443 으로 통합돼요.

## 자동 등록 메커니즘

새 controller 가 별도 등록 코드 없이 Swagger UI 에 뜨는 흐름은 세 단계예요.

1. **컴포넌트 스캔** — `@SpringBootApplication` 의 component scan 이 `@RestController` 와 `@Configuration` 빈을 등록합니다.
2. **OpenAPI 생성** — springdoc 가 등록된 모든 `@RestController` 를 순회하면서 `@RequestMapping`·`@PathVariable`·`@RequestBody` 메타데이터를 분석해 OpenAPI 3 스펙을 만듭니다. `@Operation` 으로 단 요약·설명도 이때 반영됩니다.
3. **Swagger UI 노출** — `/swagger-ui.html` 이 위 스펙을 사람이 읽는 UI 로 렌더링합니다.

`OpenApiConfig`는 Bearer JWT 스킴을 문서에 등록해 Swagger UI에서 토큰을 입력할 수 있게 해요. 이는 API의 인증 정책을 강제하는 장치가 아니에요. 공개 경로와 보호 경로의 실제 인증·권한은 `SecurityConfig`가 결정해요.

<a id="슬러그별-컨트롤러--healthcontroller-하나--core-공유"></a>

## 슬러그별 컨트롤러 — HealthController 하나 + core 공유

`<repo> new <slug>`는 앱 전용 `<Slug>HealthController`를 만들어요. 이 컨트롤러는 `@Tag(name = "<slug>")`와 `GET /api/apps/<slug>/health`를 사용해요. 인증·결제·IAP 컨트롤러는 앱마다 복제하지 않고 core의 공유 빈이 `{appSlug}`로 요청을 구분해요. 앱 전용 기능이 필요할 때 해당 모듈에 컨트롤러를 추가해요.

| Controller | 소유 모듈 | base path | `@Tag` |
|---|---|---|---|
| `<Slug>HealthController` | `apps/app-<slug>` (생성됨) | `/api/apps/<slug>` | `<slug>` |
| `AuthController` | `core-auth-impl` (공유) | `/api/apps/{appSlug}/auth` | `auth` |
| `PhoneAuthController` | `core-phone-auth-impl` (공유) | `/api/apps/{appSlug}/auth` | `phone-auth` |
| `UserController` | `core-user-impl` (공유) | `/api/apps/{appSlug}/users` | `core-user` |
| `DeviceController` | `core-device-impl` (공유) | `/api/apps/{appSlug}/devices` | `core-device` |
| `PaymentController` | `core-billing-impl` (공유) | `/api/apps/{appSlug}/payment` | `payment` |
| `IapController` | `core-billing-impl` (공유) | `/api/apps/{appSlug}/iap` | `iap` |
| `NotificationSettingController` | `core-billing-impl` (공유) | `/api/apps/{appSlug}/me/notification-settings` | `notification-settings` |

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

본 템플릿은 `prod` 에서 Swagger UI 와 OpenAPI 명세를 **차단**합니다. API 구조 노출을 줄여 공격 표면을 좁히는 fail-secure 기본값이에요 (OWASP A05.1 — Security Misconfiguration).

```yaml
# application-prod.yml
springdoc:
  swagger-ui:
    enabled: false
  api-docs:
    enabled: false
```

이 설정으로 `/swagger-ui.html` 과 `/v3/api-docs` 둘 다 404 가 됩니다. 반면 dev 는 API 탐색 편의를 위해 기본 활성이에요 — `application-dev.yml` 이 `${SPRINGDOC_SWAGGER_UI_ENABLED:true}` / `${SPRINGDOC_API_DOCS_ENABLED:true}` 로 환경변수 override 를 열어 두므로, 노출을 줄이고 싶으면 두 값을 `false` 로 주입하세요.

| 환경 | 기본값 | 바꾸는 법 |
|---|---|---|
| `local` | 노출 (개발 편의) | 별도 설정 없음 — base `application.yml` 그대로 |
| `dev` | 노출 | `SPRINGDOC_SWAGGER_UI_ENABLED=false`·`SPRINGDOC_API_DOCS_ENABLED=false` 환경변수로 차단 |
| `prod` | 차단 (yml 고정) | 권장하지 않음. 필요하면 stage·internal 전용 yml 로만 제한적 활성화 |

prod YAML은 Swagger UI와 OpenAPI를 비활성화하는 기본 정책을 제공해요. 환경변수 등 우선순위가 높은 외부 설정으로 덮어쓸 수 있으므로, YAML의 false만으로 변경이 불가능하다고 보지는 않아요. 운영 설정도 이 비활성 정책을 유지해요.

## 관련 문서

- [`API Response 규약`](./api-response.md) — `ApiResponse<T>` 표준 envelope
- [`JSON Contract`](./json-contract.md) — DTO 변환 · null 처리
- [`Versioning`](./versioning.md) — API 버전 정책 (ADR-008)
- [`Flutter ↔ Backend Integration`](./flutter-backend-integration.md) — 클라이언트 연동 규약
- [`OWASP Top 10 매핑`](../../production/setup/owasp-top10-mapping.md) — A05.1 Swagger prod 차단 근거
