# Seed Data Management

> **유형**: Reference · **독자**: Level 2 · **읽는 시간**: ~10분

이 문서는 `template-spring` 과 파생 레포가 **초기 데이터(seed data)** 를 다루는 전략을 정리합니다. Flyway 스키마 마이그레이션과 구분되는 "데이터 채우기" 작업이 어디에 위치하고, 어떤 방식이 권장되며, 무엇을 피해야 하는지를 다룹니다.

스키마 변경 자체는 Flyway 마이그레이션의 영역입니다. 상세한 마이그레이션 가이드는 [`Migration Guides`](./migration.md) 에서 관리하고, 여기서는 "스키마는 이미 있다, 이제 어떤 데이터를 넣을 것인가" 에 집중합니다.

---

## 개요

이 문서가 담는 항목은 두 가지입니다. 하나는 템플릿이 **실제로 어떤 seed 를 제공하는지** (결론부터 말하면 기본 subscription plan 2행 + opt-in admin 계정 1명), 다른 하나는 파생 레포가 자기 데이터를 넣을 때 고를 수 있는 **세 가지 방식** 입니다. 세 방식은 Flyway repeatable 마이그레이션, Spring `ApplicationRunner`, Testcontainers fixture 이고, 각각 실행 환경과 운영 위험이 다릅니다.

---

## 스키마와 데이터의 구분

| 영역 | 도구 | 관리 위치 | 실행 시점 |
|---|---|---|---|
| 스키마 (DDL) | Flyway `V***` | `apps/app-<slug>/src/main/resources/db/migration/<slug>/` | 부팅 시 1회 (`@Bean(initMethod = "migrate")`) |
| Seed 데이터 (DML) | 옵션 A·B·C | 아래 섹션 참조 | 환경에 따라 다름 |

스키마 변경은 모든 환경(local, CI, dev, prod)에서 동일하게 적용되어야 합니다. 반면 seed 데이터는 환경별로 넣거나 말거나가 갈리는 것이 자연스러워요. 개발 DB 에는 테스트 계정이 있어도 되지만 운영 DB 에는 없어야 하는 식입니다. 그래서 두 영역은 별도 전략이 필요합니다.

---

## 템플릿이 제공하는 seed 데이터

템플릿이 자동으로 넣는 seed 는 **기본 subscription plan 2행** 입니다. `V008__init_subscription_plans.sql` 이 테이블 DDL 과 함께 무료 plan(`free`)과 샘플 유료 plan(`PRO`, dogfood/smoke-test 의 PG/IAP 흐름 검증용)을 INSERT 해요 — 모든 신규 가입자의 default 가 되는 참조 데이터입니다.

**admin 계정 1명은 opt-in seed** 예요. `./tools/app/new-app.sh <slug> --seed-admin` 을 명시한 경우에만 생성기가 `V007__seed_admin_user.sql` 을 떨굽니다 (Step 15, 기본 off). 비밀번호는 앱별로 **랜덤 생성**되어 BCrypt 해시로만 저장되고, 평문은 생성 시 콘솔에 1회만 출력돼요 — 파생 앱들이 공유하는 고정/공개 비밀번호(계정 탈취 벡터)를 만들지 않기 위해서입니다.

```sql
-- new-app.sh Step 15 (--seed-admin) 가 생성하는 V007__seed_admin_user.sql 발췌
-- 비번은 생성 시 랜덤 발급 + bcrypt 해시만 저장 (평문은 콘솔에 1회만 출력됨).
INSERT INTO <slug>.users (email, password_hash, email_verified, created_at, updated_at)
VALUES (
    'admin@<slug>.local',
    '$2a$10$...',          -- 랜덤 생성 비밀번호의 BCrypt(round 10) 해시
    TRUE,
    NOW(),
    NOW()
);
```

versioned `V***` 파일이라 Flyway 가 **한 번만** 실행합니다. 그래서 `ON CONFLICT` 없이도 멱등이 보장돼요. 시드를 비활성하려면 이 파일을 삭제하면 됩니다(이미 적용됐다면 해당 row 도 삭제). 운영에서는 첫 로그인 즉시 비밀번호를 바꾸는 것을 권장해요.

그 외에 `V023__add_payment_refunds.sql` 이 과거 환불 건을 원장으로 백필하는 DML 을 담고 있고, 나머지 마이그레이션은 모두 스키마 정의(DDL)입니다. 카테고리·역할 같은 참조 데이터나 추가 테스트 계정이 필요하면 파생 레포가 아래 세 옵션 중 하나로 직접 구현합니다.

### 앱이 생성하는 마이그레이션 한눈에

`new-app.sh` 가 만드는 `db/migration/<slug>/` 의 versioned 파일은 기본 25개(V001~V026, V007 은 `--seed-admin` 시에만 생성)입니다. 도메인 테이블은 **V027 부터** 이어집니다.

| 파일 | 성격 |
|---|---|
| `V001__init_users.sql` ~ `V006__init_devices.sql` | DDL — users · auth_social_identities · auth_refresh_tokens · auth_email_verification_tokens · auth_password_reset_tokens · devices |
| `V007__seed_admin_user.sql` | **DML — admin 계정 시드 (opt-in, `--seed-admin` 시에만 생성)** |
| `V008__init_subscription_plans.sql` ~ `V012__init_audit_logs.sql` | DDL + **V008 은 plan seed 2행(DML) 포함** — 결제(subscription_plans · subscriptions/payment_history · payment_webhook_events · subscription_renewals) · audit |
| `V013__add_totp_to_users.sql` ~ `V015__init_auth_phone_verification_codes.sql` | DDL — 2FA · 알림 설정 · 점유인증 OTP |
| `V016__init_auth_email_verification_codes.sql` | DDL — 가입 전 이메일 소유확인 코드 |
| `V017__init_user_activity_days.sql` | DDL — 유저 활동 추적 (운영 콘솔 DAU/MAU·리텐션 원천) |
| `V018__init_attachment_file.sql` ~ `V021__init_audit_logs_archive.sql` | DDL — 첨부파일 · 열람이력 · 발송이력 · 감사로그 아카이브 |
| `V022__add_payment_refunded_amount.sql` ~ `V023__add_payment_refunds.sql` | DDL + **V023 은 환불 원장 백필(DML) 포함** — 부분환불 |
| `V024__add_posts.sql` ~ `V025__add_analytics.sql` | DDL — 공유 게시물 · 제품 이벤트 |
| `V026__...` 이후 | 파생 레포의 도메인 테이블 (직접 작성) |

> **혼동 주의** — 위 표의 `V007` 은 **앱 슬러그 schema** 의 admin 시드입니다. core 모듈(`core-auth-impl` 등)의 테스트 리소스에는 `db/migration/core/V007__init_auth_password_reset_tokens.sql` 이라는 동명 버전 번호가 있는데, 그건 core 네임스페이스의 **테스트 전용 스키마** 라 별개예요. 같은 V007 이라도 schema 가 다르면 다른 파일입니다.

---

## 옵션 A — Flyway repeatable migration

**언제 적합한가:** 카테고리·역할·국가 코드처럼 모든 환경에서 동일해야 하는 참조 데이터(reference data)를 넣을 때.

### 파일 위치와 이름 규약

`V***` (versioned) 와 별도로 `R__` (repeatable) 접두사를 쓰면, Flyway 가 해당 파일의 체크섬이 바뀔 때마다 재실행합니다. 템플릿에는 아직 `R__` 파일이 하나도 없어요. 참조 데이터가 필요한 파생 레포가 처음 추가하게 됩니다.

```text
apps/app-sumtally/src/main/resources/db/migration/sumtally/
├── V001__init_users.sql                 ← 스키마 (한 번만)
├── V026__init_expense_categories.sql    ← 도메인 스키마
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

`R__` 파일은 dev·staging·prod 모든 환경에서 실행됩니다. 그래서 운영에 들어가도 무관한 데이터만 둬야 해요. 개발자 계정 같은 것을 여기에 넣으면 안 됩니다.

---

## 옵션 B — Spring `ApplicationRunner`

**언제 적합한가:** "dev 프로파일에서만 테스트 유저 몇 명을 미리 만들어두고 싶다" 같은 환경 조건부 seed.

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

핵심 규칙은 두 가지입니다.

- **멱등성을 반드시 보장합니다.** 같은 runner 가 여러 번 실행돼도 안전해야 해요 (존재 확인 후 skip).
- **`@Profile("dev")` (또는 `local`, `test`)** 로 운영에서 실행되지 않도록 막습니다. 템플릿의 `MigrateOnlyRunner` 가 `@Profile("migrate-only")` 로 보호되는 것과 같은 패턴이에요.

### 기존 레퍼런스

템플릿에는 `bootstrap/src/main/java/com/factory/bootstrap/MigrateOnlyRunner.java` 가 있습니다. blue/green 배포 시 Flyway 만 실행하고 JVM 을 종료하는 `ApplicationRunner` 예요. 구조만 참고하되, 이 클래스 자체는 seed 목적이 아닙니다.

---

## 옵션 C — Testcontainers fixture

**언제 적합한가:** 통합 테스트·계약 테스트에서 테스트 데이터만 준비하고 싶을 때. 운영·개발 DB 와 완전히 분리됩니다.

이 방법은 이미 템플릿에 구현돼 있습니다. 각 도메인의 `<X>Fixtures` 인터페이스와 `Jpa<X>Fixtures` 구현이 그것이에요.

### 예시 — AuthFixtures

인터페이스 (`core-auth-api/src/testFixtures/...`):

```java
public interface AuthFixtures {
    long createVerifiedUser(String email, String rawPassword);
    long createUnverifiedUser(String email, String rawPassword);
    String issueAuthRefreshToken(long userId, String appSlug);
    String issueExpiredAuthRefreshToken(long userId, String appSlug);
    String issueVerificationToken(long userId);
    String issueAuthPasswordResetToken(long userId);
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

이 방식의 장점은 테스트마다 필요한 최소한의 데이터만 생성하고, `contract-cleanup.sql` 로 매 테스트 전에 깨끗이 지운다는 점입니다. 상세는 [`계약 테스트 (Contract Testing)`](../../production/test/contract-testing.md) 를 참조하세요.

운영·개발 DB 에는 전혀 영향을 주지 않습니다. Testcontainers 가 일회용 Docker Postgres 를 기동하기 때문이에요.

---

## 개발 반복 픽스처 — `db/seed/<slug>.dev.sql` + `reset --fixtures`

옵션 A~C 가 "코드/마이그레이션에 seed 를 심는" 방식이라면, 이건 **설계 중 로컬 반복**을 위한 별도 경량 경로예요. 스키마를 자주 갈아엎는 단계에서 매번 테스트 데이터를 다시 넣기 번거로울 때 씁니다.

- 파일: **`db/seed/<slug>.dev.sql`** (repo 루트 `db/seed/`, 앱별). 해당 slug 스키마에 넣을 raw `INSERT` SQL.
- 로드: `<repo> local reset <slug> --fixtures` 가 스키마를 비우고 Flyway 가 재migrate 로 **테이블을 만든 뒤** psql 로 이 파일을 로드해요. (`db/seed/README.md` 참조.)
- **local/dev 전용, prod 거부** — `reset`/`truncate` 자체가 prod 를 막습니다. 실데이터가 아니라 개발 편의 데이터라 여기 둬요.
- 이건 versioned 마이그레이션이 아니므로 flyway_schema_history 에 안 남고, 부팅 validate 에 영향 없어요.

관련 명령(설계 반복 툴킷, `docs/start/cli-guide.md` "마이그레이션 / 정리"):
- `local reset <slug>` — 스키마 통째 비우고 spring 재시작→Flyway AUTO 재migrate(올바른 checksum). `V028` 을 반복 편집하며 처음부터 재적용할 때.
- `local truncate <slug>` — 스키마·마이그레이션 유지, **데이터만** TRUNCATE(재migrate 불필요).
- `dev migrate <slug> --all-pending` — 로컬에서 확정한 마이그레이션을 dev 로 일괄 승격.

---

## 세 옵션 비교

| 기준 | 옵션 A (R__) | 옵션 B (ApplicationRunner) | 옵션 C (Fixtures) |
|---|---|---|---|
| 실행 환경 | 모든 환경 | 프로파일로 제한 | 테스트만 |
| 실행 시점 | 부팅 시 (Flyway) | 부팅 시 (bean 초기화 후) | 테스트 메서드 전·중 |
| 수정 반영 | 파일 체크섬 변경 시 자동 | 코드 재배포 필요 | 코드 재컴파일 |
| 운영 위험 | **높음** (실수로 넣으면 그대로 prod 에) | 낮음 (@Profile 가드) | 없음 (ephemeral) |
| 권장 데이터 | 참조 데이터 (카테고리, 코드) | 개발자 테스트 계정 | 테스트 케이스별 fixture |

---

## 파생 레포가 자기 앱 schema 에 seed 를 넣는 방법

새 앱을 `./tools/app/new-app.sh <slug>` 로 생성하면 `db/migration/<slug>/` 에 V001~V026 공통 테이블(V007 admin 시드는 `--seed-admin` opt-in)이 자동으로 만들어집니다. 각 앱은 자기 schema 를 가지며, Flyway 는 `classpath:db/migration/<slug>` 를 해당 schema 에 대해 독립적으로 실행해요 (`common-persistence/src/main/java/com/factory/common/persistence/AbstractAppDataSourceConfig.java` 의 `buildFlyway` 참조).

### 도메인 테이블과 seed 추가

앱 고유 도메인 테이블은 V027 부터 이어서 추가합니다. 참조 데이터는 옵션 A 로 같은 디렉터리에 둬요.

```text
apps/app-sumtally/src/main/resources/db/migration/sumtally/
├── V001 ~ V006                              ← 유저·인증 (자동 생성)
├── V007__seed_admin_user.sql                ← admin 시드 (--seed-admin 시에만 생성)
├── V008 ~ V025                              ← 결제·audit·2FA·알림·점유인증·활동추적·첨부·게시물·분석 (자동 생성)
├── V026__init_expense_categories.sql        ← 도메인 스키마
├── V027__init_expenses.sql                  ← 도메인 스키마
└── R__seed_expense_categories.sql           ← 옵션 A 로 참조 데이터
```

### 개발자 테스트 계정 (옵션 B)

`apps/app-<slug>/src/main/java/com/factory/apps/<slug>/config/<Slug>DevSeedRunner.java` 같은 위치에 `@Profile("dev")` 로 보호된 `ApplicationRunner` 를 두는 것이 자연스럽습니다. bootstrap 의 `MigrateOnlyRunner` 와 같은 패턴을 참고하되, seed 용도로는 옵션 B 의 예시 코드를 그대로 써도 돼요.

---

## SQL 스크립트 위치 규약

한 레포 안에서 SQL 파일이 흩어지면 금방 혼란이 생기므로, 다음과 같이 고정합니다.

| 목적 | 위치 | 성격 |
|---|---|---|
| 앱 스키마 DDL | `apps/app-<slug>/src/main/resources/db/migration/<slug>/V*.sql` | Flyway versioned |
| 앱 admin 시드 (opt-in) | `apps/app-<slug>/src/main/resources/db/migration/<slug>/V007__seed_admin_user.sql` | Flyway versioned (DML, `--seed-admin` 시에만) |
| 앱 참조 데이터 | `apps/app-<slug>/src/main/resources/db/migration/<slug>/R__*.sql` | Flyway repeatable |
| 테스트 cleanup | `common/common-testing/src/main/resources/contract-cleanup.sql` | 테스트 전용 |
| 인프라 부트스트랩 | `infra/scripts/init-app-schema.sql` | psql 로 수동 실행 |

"어디에 둘지 헷갈리는 SQL 파일은 대개 Flyway 마이그레이션이 아닙니다." `db/migration/` 밖의 임의 위치에 `.sql` 을 두면 Flyway 가 자동 실행하지 않아요. 그러면 "의도한 스키마와 실제 DB 가 다름" 상태가 됩니다. 가능한 한 위 다섯 가지 중 하나로 분류하세요.

---

## 주의사항

### 운영 DB 에 위험한 seed 데이터를 넣지 마십시오

추가 개발자 계정, 테스트 이메일, 샘플 데이터를 `R__seed.sql` 이나 운영 프로파일의 `ApplicationRunner` 에 넣는 것은 금지입니다. 이유는 세 가지예요.

- **보안** — 알려진 비밀번호로 만든 계정이 운영에 들어가면 즉시 공격 대상이 됩니다. 템플릿의 `V007` admin 시드가 opt-in + 랜덤 비밀번호로 설계된 이유가 이것이고, 그래도 운영에서는 첫 로그인 즉시 비밀번호를 바꾸길 권장해요.
- **삭제 불가** — 한 번 운영에 들어간 데이터는 추적이 어렵고, 외래 키 관계로 얽히면 나중에 제거하기 힘듭니다.
- **감사 로그 오염** — 실제 유저 활동과 seed 데이터가 섞여 분석이 어려워집니다.

환경 조건부 seed 는 `@Profile("dev")`·`@Profile("local")` 등으로 반드시 환경을 제한합니다.

### 민감 정보를 커밋하지 마십시오

seed 파일은 레포에 커밋돼 공개 상태가 됩니다. 다음은 커밋하면 안 돼요.

- 실제 서비스 이메일 주소 (`admin@company.com` 같은 내부 계정)
- 실제 비밀번호 해시
- API key, 토큰, 시크릿
- 실제 유저의 PII

더미 값만 쓰거나 환경 변수로 외부 주입합니다. 템플릿의 admin 시드도 `admin@<slug>.local` 이라는 더미 도메인에 랜덤 생성 비밀번호의 해시만 커밋하는 이유예요 (평문은 콘솔 1회 출력뿐). `.env` 는 이미 `.gitignore` 에 있지만, SQL 파일에 하드코딩하면 그 방어선이 무너집니다.

### 멱등성을 보장하십시오

옵션 A (`R__`) 는 `ON CONFLICT ... DO UPDATE` 또는 `INSERT ... WHERE NOT EXISTS` 로 재실행에 안전하게 작성합니다. 옵션 B (`ApplicationRunner`) 는 실행 전에 존재 여부를 확인하고 skip 해요. 그렇지 않으면 재부팅마다 유니크 제약 위반이 발생합니다. 참고로 versioned `V***` 시드(템플릿의 `V007`)는 Flyway 가 한 번만 실행하므로 멱등 처리가 따로 필요 없습니다.

### 마이그레이션과 데이터를 한 파일에 섞지 마십시오

`V018__init_expenses_and_seed.sql` 처럼 스키마와 데이터를 한 파일에 합치면, 체크섬이 한 번 고정된 뒤 데이터만 바꾸고 싶어도 새 V 파일을 만들어야 합니다. 스키마는 versioned `V`, 갱신되는 데이터는 repeatable `R` 로 분리하세요. 템플릿의 `V007` admin 시드는 "단 한 번만 넣고 갱신하지 않는다" 는 성격이라 예외적으로 versioned 를 씁니다.

---

## 요약

- 템플릿이 자동으로 넣는 seed 는 **V008 의 기본 plan 2행(free·PRO)** 이고, **admin 계정 1명은 `--seed-admin` opt-in**(랜덤 비밀번호)입니다. V023 의 환불 원장 백필을 빼면 나머지 마이그레이션은 모두 DDL 이에요.
- 참조 데이터(카테고리 등)는 `R__` repeatable migration 으로 넣는 것을 권장합니다. 템플릿에는 아직 `R__` 파일이 없어요.
- 추가 개발자·테스트 데이터는 `@Profile("dev")` 로 보호된 `ApplicationRunner` 를 사용합니다.
- 테스트 전용 데이터는 `Jpa<X>Fixtures` 패턴으로 이미 구현돼 있으니 재사용합니다.
- 운영 DB 에 위험한 seed 를 넣는 것은 금지입니다. admin 계정은 첫 로그인 즉시 비밀번호를 바꾸고, 민감 정보·실제 비밀번호 커밋도 금지예요.
- SQL 파일 위치는 `db/migration/<schema>/` 를 원칙으로 하며, 그 외 위치는 테스트 cleanup 또는 인프라 스크립트만 해당합니다.

---

## 관련 문서

- [`Migration Guides`](./migration.md) — Flyway 마이그레이션 (스키마 관리)
- [`계약 테스트 (Contract Testing)`](../../production/test/contract-testing.md) — 테스트 fixture 전략
- [`Testing Strategy`](../../production/test/testing-strategy.md) — 4 층 테스트 구조 (Integration 층에서 seed 사용)
