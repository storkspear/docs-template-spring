# Seed Data Management

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~10분

이 문서는 `spring-backend-template` 및 그 파생 레포가 **초기 데이터(seed data)** 를 관리하는 전략을 정리합니다. Flyway 스키마 마이그레이션과 구분되는 "데이터 채우기" 작업의 위치, 권장 방식, 피해야 할 함정을 다룹니다.

스키마 변경 자체는 Flyway 마이그레이션의 영역이며, 상세한 마이그레이션 가이드는 [`Migration Guides`](./migration.md) 에서 관리합니다. 여기서는 **"스키마는 이미 있다, 이제 어떤 데이터를 넣을 것인가"** 에 집중합니다.

---

## 개요

`spring-backend-template` 및 파생 레포의 **초기/테스트 데이터 관리 전략**. Flyway 반복 마이그레이션 / ApplicationRunner / Testcontainers fixture 3 종 비교.

---

## 스키마와 데이터의 구분

| 영역 | 도구 | 관리 위치 | 실행 시점 |
|---|---|---|---|
| **스키마 (DDL)** | Flyway `V***` | `core/*/src/main/resources/db/migration/core/` <br> `apps/app-<slug>/src/main/resources/db/migration/<slug>/` | 부팅 시 1회 (`@Bean(initMethod = "migrate")`) |
| **Seed 데이터 (DML)** | 옵션 A/B/C | 아래 섹션 참조 | 환경에 따라 다름 |

스키마 변경은 모든 환경(local, CI, dev, prod) 에서 **동일하게** 적용되어야 하지만, seed 데이터는 환경별로 넣거나 말거나가 달라지는 것이 자연스럽습니다. 그래서 두 영역은 별도 전략이 필요합니다.

---

## 현재 템플릿이 제공하는 seed 데이터

**없습니다.**

`spring-backend-template` 은 데모/샘플 데이터를 포함하지 않습니다. 현재 제공되는 Flyway 마이그레이션은 모두 스키마 정의(DDL)에 해당하고, INSERT 문은 없습니다.

| 모듈 | 마이그레이션 | 성격 |
|---|---|---|
| `core-user-impl` | `V001__init_users.sql` | DDL (CREATE TABLE + UNIQUE INDEX) |
| `core-user-impl` | `V002__init_social_identities.sql` | DDL |
| `core-user-impl` | `V003__add_users_email_index.sql` | DDL |
| `core-auth-impl` | `V005__init_refresh_tokens.sql` | DDL |
| `core-auth-impl` | `V006__init_email_verification_tokens.sql` | DDL |
| `core-auth-impl` | `V007__init_password_reset_tokens.sql` | DDL |
| `core-device-impl` | `V008__init_devices.sql` | DDL |
| `core-device-impl` | `V009__add_devices_updated_at.sql` | DDL |

따라서 **파생 레포가 seed 데이터를 넣고 싶으면, 아래 3가지 옵션 중 하나를 골라 직접 구현** 해야 합니다.

---

## 옵션 A — Flyway repeatable migration

**언제 적합한가:** 카테고리/역할/국가 코드 같은 **"모든 환경에서 동일해야 하는 참조 데이터(reference data)"** 를 넣을 때.

### 파일 위치와 이름 규약

`V***` (versioned) 마이그레이션과 별도로 `R__` (repeatable) 접두사를 쓰면, Flyway 가 해당 파일의 체크섬이 바뀔 때마다 재실행합니다.

```
apps/app-sumtally/src/main/resources/db/migration/sumtally/
├── V001__init_users.sql                 ← 스키마 (한 번만)
├── V007__init_expense_categories.sql    ← 스키마
└── R__seed_expense_categories.sql       ← 데이터 (수정 시마다 재실행)
```

### 예시

```sql
-- R__seed_expense_categories.sql
INSERT INTO expense_categories (code, name_ko, sort_order)
VALUES
    ('food',      '식비',   1),
    ('transport', '교통비', 2),
    ('leisure',   '여가',   3)
ON CONFLICT (code) DO UPDATE
    SET name_ko    = EXCLUDED.name_ko,
        sort_order = EXCLUDED.sort_order;
```

**주의:** `R__` 파일은 **모든 환경(dev/staging/prod)** 에서 실행되므로, 운영에서도 들어가도 무관한 데이터만 둬야 합니다. 개발자 계정 같은 것을 넣으면 안 됩니다.

---

## 옵션 B — Spring `ApplicationRunner`

**언제 적합한가:** "**dev 프로파일에서만** 테스트 유저 몇 명을 미리 만들어두고 싶다" 같은 **환경 조건부** seed.

### 기본 구조

`@Profile("dev")` 로 범위를 좁힌 `@Configuration` 안에 `ApplicationRunner` bean 을 선언하면, 앱 기동 시 1회 실행됩니다.

```java
@Configuration
@Profile("dev")
public class DevSeedRunner {

    private static final Logger log = LoggerFactory.getLogger(DevSeedRunner.class);

    @Bean
    ApplicationRunner seedDevUsers(JdbcTemplate jdbc, PasswordHasher hasher) {
        return args -> {
            Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM users WHERE email = ?",
                Integer.class,
                "dev@example.com"
            );
            if (count != null && count > 0) {
                log.info("dev seed users already present — skipping");
                return;
            }
            jdbc.update(
                "INSERT INTO users (email, password_hash, display_name, email_verified, "
                    + "role, created_at, updated_at) "
                    + "VALUES (?, ?, ?, true, 'user', NOW(), NOW())",
                "dev@example.com", hasher.hash("devpassword"), "Dev User"
            );
            log.info("dev seed users created");
        };
    }
}
```

핵심 규칙:
- **멱등성** 을 반드시 보장합니다. 같은 runner 가 여러 번 실행되어도 안전해야 합니다 (존재 확인 → skip).
- **`@Profile("dev")` (또는 `local`, `test`)** 로 운영에서 실행되지 않도록 막습니다.
- `MigrateOnlyRunner` (이미 템플릿에 있음) 가 `@Profile("migrate-only")` 로 보호되는 것과 같은 패턴입니다.

### 기존 레퍼런스

템플릿에는 `bootstrap/src/main/java/.../MigrateOnlyRunner.java` 가 있어 blue/green 배포 시 Flyway 만 실행하고 종료하는 `ApplicationRunner` 를 제공합니다. 구조만 참고하되, 이 클래스 자체는 seed 목적이 아닙니다.

---

## 옵션 C — Testcontainers fixture

**언제 적합한가:** 통합 테스트/계약 테스트에서 **테스트 데이터만** 준비하고 싶을 때. 운영/개발 DB 와 완전히 분리됩니다.

이 방법은 이미 템플릿에 **구현되어 있습니다**. 각 도메인의 `<X>Fixtures` 인터페이스와 `Jpa<X>Fixtures` 구현이 그것입니다.

### 예시 — AuthFixtures

인터페이스 (`core-auth-api/src/testFixtures/...`):

```java
public interface AuthFixtures {
    long createVerifiedUser(String email, String rawPassword);
    long createUnverifiedUser(String email, String rawPassword);
    String issueRefreshToken(long userId, String appSlug);
    String issueExpiredRefreshToken(long userId, String appSlug);
    String issueVerificationToken(long userId);
    String issuePasswordResetToken(long userId);
}
```

구현 (`core-auth-impl/src/test/...`):

```java
@TestComponent
public class JpaAuthFixtures implements AuthFixtures {

    @Override
    public long createVerifiedUser(String email, String rawPassword) {
        String hashed = passwordHasher.hash(rawPassword);
        Long id = jdbcTemplate.queryForObject(
            "INSERT INTO users (email, password_hash, display_name, email_verified, role, created_at, updated_at) "
                + "VALUES (?, ?, ?, true, 'user', NOW(), NOW()) RETURNING id",
            Long.class,
            email, hashed, email.split("@")[0]
        );
        return id != null ? id : 0L;
    }
    // ...
}
```

이 방식의 장점은 **테스트마다 필요한 최소한의 데이터만** 생성하고, `@Sql(contract-cleanup.sql)` 로 매 테스트 전에 깨끗이 지운다는 점입니다. 상세는 [`계약 테스트 (Contract Testing)`](../../production/test/contract-testing.md) 를 참조하세요.

**운영/개발 DB 에는 전혀 영향을 주지 않습니다** — Testcontainers 가 ephemeral Docker Postgres 를 기동하기 때문입니다.

---

## 세 옵션 비교

| 기준 | 옵션 A (R__) | 옵션 B (ApplicationRunner) | 옵션 C (Fixtures) |
|---|---|---|---|
| 실행 환경 | 모든 환경 | 프로파일로 제한 | 테스트만 |
| 실행 시점 | 부팅 시 (Flyway) | 부팅 시 (bean 초기화 후) | 테스트 메서드 전/중 |
| 수정 반영 | 파일 체크섬 변경 시 자동 | 코드 재배포 필요 | 코드 재컴파일 |
| 운영 위험 | **높음** (실수로 넣으면 그대로 prod 에) | 낮음 (@Profile 가드) | 없음 (ephemeral) |
| 권장 데이터 | 참조 데이터 (카테고리, 코드) | 개발자 테스트 계정 | 테스트 케이스별 fixture |

---

## 파생 레포가 자기 앱 schema 에 seed 를 넣는 방법

새 앱을 `./tools/new-app/new-app.sh <slug>` 로 생성하면 다음 구조가 만들어집니다.

```
apps/app-<slug>/
├── src/main/resources/
│   └── db/migration/<slug>/
│       ├── V001__init_users.sql             (자동 생성)
│       ├── V002__init_social_identities.sql (자동 생성)
│       ├── V003__init_refresh_tokens.sql    (자동 생성)
│       ├── V004__init_email_verification_tokens.sql (자동 생성)
│       ├── V005__init_password_reset_tokens.sql     (자동 생성)
│       └── V006__init_devices.sql           (자동 생성)
└── build.gradle
```

각 앱은 **자기 schema** 를 가지며, Flyway 는 `classpath:db/migration/<slug>` 를 해당 schema 에 대해 독립적으로 실행합니다 (`common-persistence/src/main/java/.../AbstractAppDataSourceConfig.java` 의 `buildFlyway` 참조).

### 도메인 테이블과 seed 추가

앱 고유 도메인 테이블(예: `expense_categories`, `workout_types`) 은 V007 부터 이어서 추가합니다.

```
apps/app-sumtally/src/main/resources/db/migration/sumtally/
├── V001 ~ V006                              ← 유저/인증 (자동 생성)
├── V007__init_expense_categories.sql        ← 도메인 스키마
├── V008__init_expenses.sql                  ← 도메인 스키마
└── R__seed_expense_categories.sql           ← 옵션 A 로 참조 데이터
```

### 개발자 테스트 계정 (옵션 B)

`apps/app-<slug>/src/main/java/com/factory/apps/<slug>/config/<Slug>DevSeedRunner.java` 같은 위치에 `@Profile("dev")` 로 보호된 `ApplicationRunner` 를 두는 것이 자연스럽습니다. bootstrap 의 `MigrateOnlyRunner` 와 같은 패턴을 참고하되, seed 용도로는 옵션 B 의 예시 코드를 그대로 써도 됩니다.

---

## SQL 스크립트 위치 규약

한 레포 안에서 SQL 파일이 분산되면 금방 혼란이 생기므로, 다음과 같이 고정합니다.

| 목적 | 위치 | 성격 |
|---|---|---|
| Core 스키마 DDL | `core/core-<x>-impl/src/main/resources/db/migration/core/V*.sql` | Flyway versioned |
| 앱 스키마 DDL | `apps/app-<slug>/src/main/resources/db/migration/<slug>/V*.sql` | Flyway versioned |
| 앱 참조 데이터 | `apps/app-<slug>/src/main/resources/db/migration/<slug>/R__*.sql` | Flyway repeatable |
| 테스트 cleanup | `common/common-testing/src/main/resources/contract-cleanup.sql` | 테스트 전용 |
| 인프라 부트스트랩 | `infra/scripts/init-app-schema.sql`, `init-core-schema.sql` | psql 로 수동 실행 |

**"어디에 둘지 헷갈리는 SQL 파일은 대개 Flyway 마이그레이션이 아닙니다."** `db/migration/` 밖의 임의 위치에 `.sql` 을 두면 Flyway 가 자동 실행하지 않으므로, 자칫 "의도한 스키마와 실제 DB 가 다름" 상태가 됩니다. 가능한 한 위 4가지 중 하나로 분류합니다.

---

## 주의사항

### 운영 DB 에 seed 데이터를 넣지 마십시오

개발자 계정, 테스트 이메일, 샘플 데이터를 `R__seed.sql` 이나 운영 프로파일의 `ApplicationRunner` 에 넣는 것은 금지입니다. 다음과 같은 이유 때문입니다.

- **보안** — 알려진 비밀번호로 생성된 계정이 운영에 들어가면 즉시 공격 대상이 됩니다.
- **삭제 불가** — 한 번 운영에 들어간 데이터는 추적이 어렵고, 외래 키 관계로 얽히면 나중에 제거하기 힘듭니다.
- **감사 로그 오염** — 실제 유저 활동과 seed 데이터가 섞여 분석이 어려워집니다.

`@Profile("dev")` / `@Profile("local")` 등으로 **반드시** 환경을 제한합니다.

### 민감 정보를 커밋하지 마십시오

- 실제 서비스 이메일 주소 (`admin@company.com` 같은 내부 계정)
- 실제 비밀번호 해시
- API key, 토큰, 시크릿
- 실제 유저의 PII

seed 파일은 레포에 커밋되어 공개 상태가 되므로, **더미 값** 만 쓰거나 환경 변수로 외부 주입합니다. `.env` 는 이미 `.gitignore` 에 있지만, SQL 파일에 하드코딩하면 방어선이 무너집니다.

### 멱등성을 보장하십시오

옵션 A (`R__`) 는 `ON CONFLICT ... DO UPDATE` 또는 `INSERT ... WHERE NOT EXISTS` 로 재실행에 안전하게 작성합니다. 옵션 B (`ApplicationRunner`) 는 실행 전에 존재 여부를 확인하고 skip 합니다. 그렇지 않으면 재부팅마다 유니크 제약 위반이 발생합니다.

### 마이그레이션과 seed 를 한 파일에 섞지 마십시오

`V007__init_expenses_and_seed.sql` 같은 혼합 파일은 체크섬이 한 번 고정되면 데이터만 바꾸고 싶어도 새 V 파일을 만들어야 합니다. 스키마(V)와 데이터(R)는 별 파일로 분리하세요.

---

## 요약

- **템플릿 자체는 seed 데이터를 제공하지 않습니다.** 모든 Flyway 마이그레이션은 DDL.
- **참조 데이터(카테고리 등)** 는 `R__` repeatable migration 으로 넣는 것을 권장합니다.
- **개발자 계정/테스트 데이터** 는 `@Profile("dev")` 로 보호된 `ApplicationRunner` 를 사용합니다.
- **테스트 전용 데이터** 는 `Jpa<X>Fixtures` 패턴으로 이미 구현되어 있으므로 재사용합니다.
- 운영 DB 에 seed 를 넣는 것은 **금지**. 민감 정보/실제 비밀번호 커밋도 금지.
- SQL 파일 위치는 `db/migration/<schema>/` 를 원칙으로 하며, 그 외 위치는 테스트 cleanup 또는 인프라 스크립트만 해당합니다.

---

## 관련 문서

- [`Migration Guides`](./migration.md) — Flyway 마이그레이션 (스키마 관리)
- [`계약 테스트 (Contract Testing)`](../../production/test/contract-testing.md) — 테스트 fixture 전략
- [`Testing Strategy`](../../production/test/testing-strategy.md) — 4 층 테스트 구조 (Integration 층에서 seed 사용)
