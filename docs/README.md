# template-spring — Docs

이 폴더의 문서는 전용 뷰어 사이트에서 보는 것이 편합니다. 사이드바, 목차, 검색이 포함되어 있습니다.

**👉 https://storkspear.github.io/docs-template-spring**

GitHub 에서 바로 읽고 싶다면 아래 목차를 따라가세요. 섹션 순서는 뷰어 사이드바 그룹과 **1:1 로 일치**합니다.

---

## Level 0 - Onboarding

- [`Overview - 전체 읽기 순서`](./onboarding/README.md)
- [`감 잡기`](./onboarding/getting-started.md) — 쓸지 말지 3~10분 안에 결정
  - [`이게 뭐야?`](./onboarding/what-is-this.md)
  - [`5 분 투어`](./onboarding/five-minute-tour.md)
  - [`첫 실행 결과 해석`](./onboarding/first-run.md)
  - [`첫 수정 튜토리얼`](./onboarding/first-change.md)
  - [`배포 맛보기`](./onboarding/first-deploy.md)

## Level 1 - Start

- [`Onboarding`](./start/onboarding.md) — 로컬 개발 환경 + 첫 앱 모듈 추가
- [`Social Auth Setup`](./start/social-auth-setup.md) — Google/Apple 소셜 로그인
- [`App Scaffolding`](./start/app-scaffolding.md) — `new-app.sh`
- [`Dogfood Setup`](./start/dogfood-setup.md)
  - [`Dogfood FAQ`](./start/dogfood-faq.md)
  - [`Dogfood Pitfalls`](./start/dogfood-pitfalls.md)
- [`Cross-repo Cherry-pick`](./start/cross-repo-cherry-pick.md)

## Level 2 - Structure

- [`Architecture`](./structure/architecture.md)
- [`Module Dependencies`](./structure/module-dependencies.md)
- [`Architecture Rules`](./structure/architecture-rules.md)
- [`Multitenant Architecture`](./structure/multitenant-architecture.md)
- [`JWT Authentication`](./structure/jwt-authentication.md)

## Level 3 - Philosophy

- [`개요`](./philosophy/README.md) — 프롤로그 (3 제약) + 16 ADR 인덱스

**모듈 설계**
- [`Modular Monolith`](./philosophy/adr-001-modular-monolith.md) — ADR-001
- [`Use this template`](./philosophy/adr-002-use-this-template.md) — ADR-002
- [`api/impl 분리`](./philosophy/adr-003-api-impl-split.md) — ADR-003
- [`Gradle + ArchUnit`](./philosophy/adr-004-gradle-archunit.md) — ADR-004

**데이터 & 인증**
- [`Postgres Schema Isolation`](./philosophy/adr-005-db-schema-isolation.md) — ADR-005
- [`HS256 JWT`](./philosophy/adr-006-hs256-jwt.md) — ADR-006
- [`Per-App User Model`](./philosophy/adr-012-per-app-user-model.md) — ADR-012
- [`Per-App Auth Endpoints`](./philosophy/adr-013-per-app-auth-endpoints.md) — ADR-013

**운영 철학**
- [`Solo-Friendly Operations`](./philosophy/adr-007-solo-friendly-operations.md) — ADR-007
- [`No API Versioning`](./philosophy/adr-008-no-api-versioning.md) — ADR-008

**엔티티 & 쿼리**
- [`BaseEntity`](./philosophy/adr-009-base-entity.md) — ADR-009
- [`SearchCondition`](./philosophy/adr-010-search-condition.md) — ADR-010

**레이어 설계**
- [`Layered + Port/Adapter`](./philosophy/adr-011-layered-port-adapter.md) — ADR-011

**테스트 & 배포**
- [`No Delegation Mock`](./philosophy/adr-014-no-delegation-mock.md) — ADR-014
- [`Conventional Commits + SemVer`](./philosophy/adr-015-conventional-commits-semver.md) — ADR-015
- [`No DTO Mapper`](./philosophy/adr-016-dto-mapper-forbidden.md) — ADR-016

## Convention

- [`Overview`](./convention/README.md)
- [`Design Principles`](./convention/design-principles.md) — SOLID 등
- [`Naming`](./convention/naming.md)
- [`Records & Classes`](./convention/records-and-classes.md)
- [`DTO Factory`](./convention/dto-factory.md)
- [`Exception Handling`](./convention/exception-handling.md)
- [`Git Workflow`](./convention/git-workflow.md)

## API & Functional

**API**
- [`API Response`](./api-and-functional/api/api-response.md)
- [`JSON Contract`](./api-and-functional/api/json-contract.md)
- [`Versioning`](./api-and-functional/api/versioning.md)
- [`Flutter Integration`](./api-and-functional/api/flutter-backend-integration.md)

**Functional**
- [`Push Notifications`](./api-and-functional/functional/push-notifications.md)
- [`Email Verification`](./api-and-functional/functional/email-verification.md)
- [`Storage`](./api-and-functional/functional/storage.md) — StoragePort · signed URL · bucket 네이밍
- [`Migration`](./api-and-functional/functional/migration.md)
- [`Seed Data Management`](./api-and-functional/functional/seed-data-management.md)
- [`Rate Limiting`](./api-and-functional/functional/rate-limiting.md)
- [`Observability`](./api-and-functional/functional/observability.md)

## Production

**Deploy**
- [`Infrastructure`](./production/deploy/infrastructure.md)
- [`Infra Decisions`](./production/deploy/decisions-infra.md) — I-01~I-13
- [`CI/CD Flow`](./production/deploy/ci-cd-flow.md)
- [`Deployment`](./production/deploy/deployment.md) — 파생 레포 첫 운영 배포
- [`Runbook`](./production/deploy/runbook.md) — 평시 배포 · 롤백 · 장애 대응

**Setup**
- [`Key Rotation`](./production/setup/key-rotation.md)
- [`Mac Mini Setup`](./production/setup/mac-mini-setup.md)
- [`Monitoring Setup`](./production/setup/monitoring-setup.md)
- [`Storage Setup`](./production/setup/storage-setup.md)

**Test**
- [`Testing Strategy`](./production/test/testing-strategy.md) — 4 층 전략
- [`Contract Testing`](./production/test/contract-testing.md)

## Reference

- [`용어 사전`](./reference/glossary.md) — Spring · JPA · Docker · JWT · Kamal 등
- [`Environment`](./reference/environment.md) — 프레임워크 · 라이브러리 · 외부 서비스 인벤토리
- [`Edge Cases`](./reference/edge-cases.md)
- [`Documentation Style Guide`](./reference/STYLE_GUIDE.md) — 저자용

## Planned

- [`Backlog`](./planned/backlog.md) — 개발 예정 항목

---

## 문서 관리 규칙

이 레포의 `docs/` 는 뷰어 레포 (`docs-template-spring`) 와 **동일한 디렉토리 구조 + 동일한 파일 내용** 을 유지합니다. 변경 시 양쪽에 반영하세요.

```bash
# 뷰어 → 이 레포 (manifest.json 과 최상위 README.md 만 제외)
rsync -av --exclude='manifest.json' --exclude='/README.md' \
  <viewer>/docs/ <template>/docs/

# 이 레포 → 뷰어 (최상위 README.md 제외)
rsync -av --exclude='/README.md' <template>/docs/ <viewer>/docs/
# 뷰어의 manifest.json 만 수동 관리
```

두 레포의 차이는 단 2 개 파일: 이 레포의 `docs/README.md` (GitHub 진입점), 뷰어의 `docs/manifest.json` (사이드바 구성).
