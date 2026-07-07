# admin 모듈 구현 플랜 (template-spring)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cross-app 운영 콘솔 API — `/api/admin/*` 9개 엔드포인트를 core 스키마 실데이터로 구현 (스펙: `docs/superpowers/specs/2026-07-06-admin-module-design.md`).

**Architecture:** 새 모듈 `:core:core-admin-impl` (JdbcTemplate 전용 — 빌드 규칙상 타 impl 의존 금지라 JPA 엔티티 재사용 불가, 읽기 콘솔이라 JDBC 가 적합). admin 스키마(고정 DataSource) + 앱 스키마 fan-out (`Map<String,DataSource>` 주입). 인증은 `role=superadmin` JWT (기존 JwtService 재사용, 코드 수정 없음).

**Tech Stack:** Spring Boot · JdbcTemplate · Flyway · Testcontainers(Postgres 16) · JJWT(기존 JwtService)

**스펙 대비 의도적 변경 2건** (Task 12 에서 스펙에 반영):
1. 모듈 위치: 스펙 §C "최상위 admin/" → **`:core:core-admin-impl`** — build-logic 컨벤션 플러그인(factory.core-impl-module)·ArchUnit 규칙을 그대로 재사용하기 위함 (최상위 모듈은 빌드 설정을 손수 복제해야 함).
2. 데이터 접근: 스펙 §C "단건/목록은 core 엔티티 재사용" → **전부 JdbcTemplate** — impl→impl 의존 금지 규칙상 core 리포지토리 재사용 불가, 읽기 전용 콘솔이라 JDBC 가 더 단순.

## Global Constraints

- 커밋: commitlint — subject ≤ **72자**, type ∈ {feat,fix,docs,style,refactor,perf,test,chore,build,ci}, **`Co-Authored-By: Claude` 트레일러 금지**(no-ai-coauthor 룰이 거부함)
- 응답 계약: **React types.ts 와 필드명 정확 일치** (아래 각 Task 의 DTO record 가 진실 — 임의 변경 금지)
- 모든 응답은 `ApiResponse.ok(...)` 봉투 (`com.factory.common.web.response.ApiResponse`)
- 테스트 DB: `PostgresTestContainer` (common-testing) — H2 금지
- 패키지 루트: `com.factory.core.admin.impl`
- `./gradlew :core:core-admin-impl:test` 그린 후에만 커밋

---

### Task 1: 모듈 스캐폴드 + ApiEndpoints.Admin + SecurityConfig 규칙

**Files:**
- Create: `core/core-admin-impl/build.gradle`
- Modify: `settings.gradle` (`include ':bootstrap'` 직전에 include 추가)
- Modify: `bootstrap/build.gradle` (dependencies 블록의 core impl 나열부)
- Modify: `common/common-web/src/main/java/com/factory/common/web/ApiEndpoints.java`
- Modify: `common/common-security/src/main/java/com/factory/common/security/SecurityConfig.java`
- Modify: `commitlint.config.mjs` (scope-enum 에 `'admin'` 추가)

**Interfaces:**
- Produces: `ApiEndpoints.Admin.BASE="/api/admin"`, `.LOGIN`, `.HEALTH`, `.SECURED_PATTERN`, `.PUBLIC_PATTERNS` — 이후 모든 Task 의 컨트롤러/보안이 참조

- [ ] **Step 1: 모듈 생성**

`core/core-admin-impl/build.gradle`:
```gradle
plugins {
    id 'factory.core-impl-module'
}

dependencies {
    compileOnly project(':common:common-web')
    compileOnly project(':common:common-security')
    compileOnly 'org.springframework.boot:spring-boot-starter-web'
    compileOnly 'org.springframework.boot:spring-boot-starter-validation'
    implementation 'org.springframework:spring-jdbc'
    implementation 'org.flywaydb:flyway-core'
    implementation 'com.zaxxer:HikariCP'

    testImplementation project(':common:common-testing')
    testImplementation project(':common:common-web')
    testImplementation project(':common:common-security')
    testImplementation 'org.springframework.boot:spring-boot-starter-web'
    testImplementation 'org.springframework.boot:spring-boot-starter-jdbc'
    runtimeOnly 'org.postgresql:postgresql'
    runtimeOnly 'org.flywaydb:flyway-database-postgresql'
}
```

`settings.gradle` — `include ':bootstrap'` 바로 위에:
```gradle
include ':core:core-admin-impl'
```

`bootstrap/build.gradle` — `implementation project(':core:core-phone-auth-impl')` 아래에:
```gradle
    implementation project(':core:core-admin-impl')
```

- [ ] **Step 2: ApiEndpoints.Admin 추가** — `ApiEndpoints.java` 의 `System` 클래스 아래에 (기존 nested class 스타일 그대로):

```java
    /** 운영 콘솔 (cross-app). 앱 경로(/api/apps/*)와 분리 — superadmin 전용. */
    public static final class Admin {
        private Admin() {}

        public static final String BASE = "/api/admin";
        public static final String LOGIN = BASE + "/auth/login";
        public static final String HEALTH = BASE + "/health";

        /** SecurityConfig 용 — 이 패턴 전체가 ROLE_SUPERADMIN 요구. */
        public static final String SECURED_PATTERN = BASE + "/**";

        /** 로그인·헬스(프로브)만 public. */
        public static final String[] PUBLIC_PATTERNS = {LOGIN, HEALTH};
    }
```

- [ ] **Step 3: SecurityConfig 에 admin 규칙 추가** — `authorizeHttpRequests` 안, `ApiEndpoints.Auth.PUBLIC_PATTERNS` permitAll 바로 위에 (permitAll 이 hasRole 보다 먼저 매치돼야 하므로 순서 중요):

```java
                                    // 운영 콘솔 — 로그인/헬스만 public, 나머지는 superadmin 전용
                                    .requestMatchers(ApiEndpoints.Admin.PUBLIC_PATTERNS)
                                    .permitAll()
                                    .requestMatchers(ApiEndpoints.Admin.SECURED_PATTERN)
                                    .hasRole("SUPERADMIN")
```

- [ ] **Step 4: commitlint scope 추가** — `commitlint.config.mjs` 의 scope-enum 배열에 `'admin',` 추가 (`'bootstrap',` 뒤).

- [ ] **Step 5: 빌드 확인**

Run: `./gradlew :core:core-admin-impl:build :common:common-web:build :common:common-security:build -q`
Expected: BUILD SUCCESSFUL (빈 모듈 + 수정 컴파일 통과)

- [ ] **Step 6: Commit**
```bash
git add settings.gradle bootstrap/build.gradle core/core-admin-impl commitlint.config.mjs \
  common/common-web/src/main/java/com/factory/common/web/ApiEndpoints.java \
  common/common-security/src/main/java/com/factory/common/security/SecurityConfig.java
git commit -m "feat(admin): admin 모듈 스캐폴드 + /api/admin 보안 규칙"
```

---

### Task 2: admin 스키마 — DataSource·Flyway·admin_users·시더

**Files:**
- Create: `core/core-admin-impl/src/main/resources/db/migration/admin/V001__init_admin_users.sql`
- Create: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/config/AdminDataSourceConfig.java`
- Create: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/repository/AdminAccountRepository.java`
- Create: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/AdminAccountSeeder.java`
- Create: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/AdminAutoConfiguration.java`
- Create: `core/core-admin-impl/src/main/resources/META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`
- Create: `infra/scripts/init-admin-schema.sql`
- Test: `core/core-admin-impl/src/test/java/com/factory/core/admin/impl/repository/AdminAccountRepositoryIT.java`

**Interfaces:**
- Produces: `@Qualifier("adminJdbcTemplate") JdbcTemplate` 빈, `AdminAccountRepository.findByEmail(String) → Optional<AdminAccount>`, record `AdminAccount(long id, String email, String passwordHash, String displayName)`

- [ ] **Step 1: 마이그레이션** — `V001__init_admin_users.sql`:

```sql
-- 운영 콘솔 관리자 계정 (공장 운영자 전용 — 앱 데이터 아님, ADR-037 비저촉)
CREATE TABLE admin_users (
    id            BIGSERIAL PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    display_name  VARCHAR(30),
    created_at    TIMESTAMPTZ  NOT NULL,
    updated_at    TIMESTAMPTZ  NOT NULL
);
```

- [ ] **Step 2: 실패 테스트 작성** — `AdminAccountRepositoryIT.java`:

```java
package com.factory.core.admin.impl.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.factory.common.testing.PostgresTestContainer;
import com.zaxxer.hikari.HikariDataSource;
import java.time.Instant;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class AdminAccountRepositoryIT {

    static JdbcTemplate jdbc;
    static AdminAccountRepository repository;

    @BeforeAll
    static void setUp() {
        HikariDataSource ds = new HikariDataSource();
        ds.setJdbcUrl(PostgresTestContainer.getJdbcUrl());
        ds.setUsername(PostgresTestContainer.getUsername());
        ds.setPassword(PostgresTestContainer.getPassword());
        Flyway.configure()
                .dataSource(ds)
                .schemas("admin")
                .defaultSchema("admin")
                .createSchemas(true)
                .locations("classpath:db/migration/admin")
                .load()
                .migrate();
        jdbc = new JdbcTemplate(ds);
        repository = new AdminAccountRepository(jdbc);
    }

    @Test
    void insert_and_findByEmail() {
        repository.insert("op@example.com", "$2a$12$hash", "운영자");
        var found = repository.findByEmail("op@example.com");
        assertThat(found).isPresent();
        assertThat(found.get().email()).isEqualTo("op@example.com");
        assertThat(found.get().displayName()).isEqualTo("운영자");
    }

    @Test
    void findByEmail_missing_returnsEmpty() {
        assertThat(repository.findByEmail("nope@example.com")).isEmpty();
    }
}
```

- [ ] **Step 3: 실패 확인**

Run: `./gradlew :core:core-admin-impl:test --tests '*AdminAccountRepositoryIT*'`
Expected: 컴파일 실패 (AdminAccountRepository 미존재)

- [ ] **Step 4: 구현** — `AdminAccountRepository.java`:

```java
package com.factory.core.admin.impl.repository;

import java.time.Instant;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;

/** admin.admin_users 접근 (JdbcTemplate — admin 모듈은 JPA 비사용). */
public class AdminAccountRepository {

    /** 운영 콘솔 관리자 계정. */
    public record AdminAccount(long id, String email, String passwordHash, String displayName) {}

    private final JdbcTemplate jdbc;

    public AdminAccountRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<AdminAccount> findByEmail(String email) {
        var rows =
                jdbc.query(
                        "SELECT id, email, password_hash, display_name FROM admin_users WHERE email = ?",
                        (rs, i) ->
                                new AdminAccount(
                                        rs.getLong("id"),
                                        rs.getString("email"),
                                        rs.getString("password_hash"),
                                        rs.getString("display_name")),
                        email);
        return rows.stream().findFirst();
    }

    public long count() {
        Long n = jdbc.queryForObject("SELECT COUNT(*) FROM admin_users", Long.class);
        return n == null ? 0 : n;
    }

    public void insert(String email, String passwordHash, String displayName) {
        Instant now = Instant.now();
        jdbc.update(
                "INSERT INTO admin_users (email, password_hash, display_name, created_at, updated_at)"
                        + " VALUES (?, ?, ?, ?, ?)",
                email, passwordHash, displayName, java.sql.Timestamp.from(now), java.sql.Timestamp.from(now));
    }
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `./gradlew :core:core-admin-impl:test --tests '*AdminAccountRepositoryIT*'`
Expected: PASS (2 tests)

- [ ] **Step 6: DataSource 설정 + 시더 + AutoConfiguration**

`AdminDataSourceConfig.java`:
```java
package com.factory.core.admin.impl.config;

import com.zaxxer.hikari.HikariDataSource;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * admin 스키마 전용 고정 DataSource — 라우팅(SlugContext) 을 타지 않는다.
 * ADMIN_DB_* 미설정 시 core DB_URL 의 currentSchema 를 admin 으로 치환해 파생 (앱 슬러그 패턴과 동일).
 */
@Configuration
public class AdminDataSourceConfig {

    @Bean(name = "adminDataSource")
    public DataSource adminDataSource(
            @Value("${ADMIN_DB_URL:}") String adminUrl,
            @Value("${ADMIN_DB_USER:}") String adminUser,
            @Value("${ADMIN_DB_PASSWORD:}") String adminPassword,
            @Value("${spring.datasource.url}") String coreUrl,
            @Value("${spring.datasource.username}") String coreUser,
            @Value("${spring.datasource.password}") String corePassword) {
        String url =
                !adminUrl.isBlank()
                        ? adminUrl
                        : coreUrl.contains("currentSchema=")
                                ? coreUrl.replaceAll("currentSchema=[^&]+", "currentSchema=admin")
                                : coreUrl + (coreUrl.contains("?") ? "&" : "?") + "currentSchema=admin";
        HikariDataSource ds = new HikariDataSource();
        ds.setJdbcUrl(url);
        ds.setUsername(adminUser.isBlank() ? coreUser : adminUser);
        ds.setPassword(adminPassword.isBlank() ? corePassword : adminPassword);
        ds.setMaximumPoolSize(2); // 콘솔 트래픽은 극소
        ds.setPoolName("admin");
        return ds;
    }

    @Bean(name = "adminFlyway", initMethod = "migrate")
    public Flyway adminFlyway(@Qualifier("adminDataSource") DataSource adminDataSource) {
        return Flyway.configure()
                .dataSource(adminDataSource)
                .schemas("admin")
                .defaultSchema("admin")
                .createSchemas(true)
                .locations("classpath:db/migration/admin")
                .load();
    }

    @Bean(name = "adminJdbcTemplate")
    public JdbcTemplate adminJdbcTemplate(@Qualifier("adminDataSource") DataSource adminDataSource) {
        return new JdbcTemplate(adminDataSource);
    }
}
```

`AdminAccountSeeder.java`:
```java
package com.factory.core.admin.impl;

import com.factory.common.security.PasswordHasher;
import com.factory.core.admin.impl.repository.AdminAccountRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;

/** 기동 시 admin_users 가 비어 있고 ADMIN_EMAIL/ADMIN_PASSWORD env 가 있으면 1계정 시드. */
public class AdminAccountSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(AdminAccountSeeder.class);

    private final AdminAccountRepository repository;
    private final PasswordHasher passwordHasher;
    private final String email;
    private final String password;

    public AdminAccountSeeder(
            AdminAccountRepository repository, PasswordHasher passwordHasher, String email, String password) {
        this.repository = repository;
        this.passwordHasher = passwordHasher;
        this.email = email;
        this.password = password;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (email == null || email.isBlank() || password == null || password.isBlank()) {
            return;
        }
        if (repository.count() > 0) {
            return;
        }
        repository.insert(email, passwordHasher.hash(password), "operator");
        log.info("admin 계정 시드 완료: {}", email);
    }
}
```

`AdminAutoConfiguration.java` (Task 진행하며 빈 추가 — 이 시점 형태):
```java
package com.factory.core.admin.impl;

import com.factory.common.security.PasswordHasher;
import com.factory.core.admin.impl.config.AdminDataSourceConfig;
import com.factory.core.admin.impl.repository.AdminAccountRepository;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

@AutoConfiguration
@Import(AdminDataSourceConfig.class)
public class AdminAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public AdminAccountRepository adminAccountRepository(
            @Qualifier("adminJdbcTemplate") JdbcTemplate adminJdbcTemplate) {
        return new AdminAccountRepository(adminJdbcTemplate);
    }

    @Bean
    @ConditionalOnMissingBean
    public AdminAccountSeeder adminAccountSeeder(
            AdminAccountRepository repository,
            PasswordHasher passwordHasher,
            @Value("${ADMIN_EMAIL:}") String email,
            @Value("${ADMIN_PASSWORD:}") String password) {
        return new AdminAccountSeeder(repository, passwordHasher, email, password);
    }
}
```

`META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`:
```
com.factory.core.admin.impl.AdminAutoConfiguration
```

`infra/scripts/init-admin-schema.sql` (init-app-schema.sql 미러 — 운영 프로비저닝):
```sql
-- 운영 콘솔 admin 스키마 프로비저닝 (init-app-schema.sql 의 admin 버전)
CREATE SCHEMA IF NOT EXISTS admin;
-- 필요 시 전용 role 부여는 init-app-schema.sql 패턴을 따라 확장 (v1 은 앱 role 재사용)
```

- [ ] **Step 7: 시더 단위 테스트** — `src/test/java/com/factory/core/admin/impl/AdminAccountSeederTest.java`:

```java
package com.factory.core.admin.impl;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

import com.factory.common.security.PasswordHasher;
import com.factory.core.admin.impl.repository.AdminAccountRepository;
import org.junit.jupiter.api.Test;

class AdminAccountSeederTest {

    @Test
    void seeds_when_empty_and_env_present() {
        var repo = mock(AdminAccountRepository.class);
        when(repo.count()).thenReturn(0L);
        new AdminAccountSeeder(repo, new PasswordHasher(), "op@example.com", "secret1234").run(null);
        verify(repo).insert(anyString(), anyString(), anyString());
    }

    @Test
    void skips_when_already_seeded() {
        var repo = mock(AdminAccountRepository.class);
        when(repo.count()).thenReturn(1L);
        new AdminAccountSeeder(repo, new PasswordHasher(), "op@example.com", "secret1234").run(null);
        verify(repo, never()).insert(any(), any(), any());
    }

    @Test
    void skips_when_env_blank() {
        var repo = mock(AdminAccountRepository.class);
        new AdminAccountSeeder(repo, new PasswordHasher(), "", "").run(null);
        verify(repo, never()).insert(any(), any(), any());
    }
}
```

- [ ] **Step 8: 전체 테스트 + 커밋**

Run: `./gradlew :core:core-admin-impl:test`
Expected: PASS

```bash
git add core/core-admin-impl infra/scripts/init-admin-schema.sql
git commit -m "feat(admin): admin 스키마 + admin_users + env 시더"
```

---

### Task 3: 로그인 + health 엔드포인트

**Files:**
- Create: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/dto/AdminDtos.java`
- Create: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/AdminAuthService.java`
- Create: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/controller/AdminAuthController.java`
- Modify: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/AdminAutoConfiguration.java` (빈 추가)
- Test: `core/core-admin-impl/src/test/java/com/factory/core/admin/impl/AdminAuthServiceTest.java`

**Interfaces:**
- Consumes: `AdminAccountRepository.findByEmail`, `PasswordHasher.verify`, `JwtService.issueAccessToken(long, String, String, String)` (common-security)
- Produces: React 계약 그대로 — `AdminLoginResponse(String accessToken, AdminAccountResponse admin)`, `AdminAccountResponse(long userId, String email, String role, String appSlug)`. 상수: `role="superadmin"`, `appSlug="admin"`

- [ ] **Step 1: 실패 테스트** — `AdminAuthServiceTest.java`:

```java
package com.factory.core.admin.impl;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.factory.common.security.PasswordHasher;
import com.factory.common.security.jwt.JwtProperties;
import com.factory.common.security.jwt.JwtService;
import com.factory.core.admin.impl.repository.AdminAccountRepository;
import com.factory.core.admin.impl.repository.AdminAccountRepository.AdminAccount;
import java.time.Duration;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class AdminAuthServiceTest {

    private final PasswordHasher hasher = new PasswordHasher();
    private final JwtService jwtService =
            new JwtService(new JwtProperties(
                    "test-secret-test-secret-test-secret-1234", Duration.ofMinutes(30), Duration.ofDays(14), "factory-test"));
    // ↑ JwtProperties 시그니처가 다르면 common-security 의 record 정의에 맞춰 조정 (테스트 의도: 실제 서명 토큰 발급)

    @Test
    void login_success_returns_superadmin_token() {
        var repo = mock(AdminAccountRepository.class);
        when(repo.findByEmail("op@example.com"))
                .thenReturn(Optional.of(new AdminAccount(1L, "op@example.com", hasher.hash("secret1234"), "op")));
        var service = new AdminAuthService(repo, hasher, jwtService);

        var res = service.login("op@example.com", "secret1234");

        assertThat(res.accessToken()).isNotBlank();
        assertThat(res.admin().role()).isEqualTo("superadmin");
        assertThat(res.admin().appSlug()).isEqualTo("admin");
        assertThat(res.admin().email()).isEqualTo("op@example.com");
    }

    @Test
    void login_wrong_password_throws() {
        var repo = mock(AdminAccountRepository.class);
        when(repo.findByEmail("op@example.com"))
                .thenReturn(Optional.of(new AdminAccount(1L, "op@example.com", hasher.hash("secret1234"), "op")));
        var service = new AdminAuthService(repo, hasher, jwtService);

        assertThatThrownBy(() -> service.login("op@example.com", "wrong"))
                .isInstanceOf(AdminAuthService.InvalidAdminCredentialsException.class);
    }

    @Test
    void login_unknown_email_throws() {
        var repo = mock(AdminAccountRepository.class);
        when(repo.findByEmail(anyString())).thenReturn(Optional.empty());
        var service = new AdminAuthService(repo, hasher, jwtService);

        assertThatThrownBy(() -> service.login("nope@example.com", "x"))
                .isInstanceOf(AdminAuthService.InvalidAdminCredentialsException.class);
    }
}
```

- [ ] **Step 2: 실패 확인**

Run: `./gradlew :core:core-admin-impl:test --tests '*AdminAuthServiceTest*'`
Expected: 컴파일 실패

- [ ] **Step 3: 구현**

`dto/AdminDtos.java`:
```java
package com.factory.core.admin.impl.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

/** /api/admin 응답 DTO 모음 — 필드명은 React types.ts 계약과 1:1 (변경 금지). */
public final class AdminDtos {
    private AdminDtos() {}

    public record AdminLoginRequest(@Email @NotBlank String email, @NotBlank String password) {}

    public record AdminAccountResponse(long userId, String email, String role, String appSlug) {}

    public record AdminLoginResponse(String accessToken, AdminAccountResponse admin) {}
}
```

`AdminAuthService.java`:
```java
package com.factory.core.admin.impl;

import com.factory.common.security.PasswordHasher;
import com.factory.common.security.jwt.JwtService;
import com.factory.core.admin.impl.dto.AdminDtos.AdminAccountResponse;
import com.factory.core.admin.impl.dto.AdminDtos.AdminLoginResponse;
import com.factory.core.admin.impl.repository.AdminAccountRepository;

/** 운영 콘솔 로그인 — admin_users 검증 후 superadmin JWT 발급. */
public class AdminAuthService {

    /** 존재하지 않는 계정/비밀번호 불일치 — 컨트롤러가 401 로 매핑. */
    public static class InvalidAdminCredentialsException extends RuntimeException {
        public InvalidAdminCredentialsException() {
            super("이메일 또는 비밀번호가 올바르지 않아요.");
        }
    }

    /** superadmin 토큰 상수 — 앱 admin(ROLE_ADMIN)과 분리해 양방향 격리. */
    public static final String SUPERADMIN_ROLE = "superadmin";
    public static final String ADMIN_APP_SLUG = "admin";

    private final AdminAccountRepository repository;
    private final PasswordHasher passwordHasher;
    private final JwtService jwtService;

    public AdminAuthService(
            AdminAccountRepository repository, PasswordHasher passwordHasher, JwtService jwtService) {
        this.repository = repository;
        this.passwordHasher = passwordHasher;
        this.jwtService = jwtService;
    }

    public AdminLoginResponse login(String email, String password) {
        var account =
                repository.findByEmail(email).orElseThrow(InvalidAdminCredentialsException::new);
        if (!passwordHasher.verify(password, account.passwordHash())) {
            throw new InvalidAdminCredentialsException();
        }
        String token =
                jwtService.issueAccessToken(account.id(), account.email(), ADMIN_APP_SLUG, SUPERADMIN_ROLE);
        return new AdminLoginResponse(
                token, new AdminAccountResponse(account.id(), account.email(), SUPERADMIN_ROLE, ADMIN_APP_SLUG));
    }
}
```

`controller/AdminAuthController.java`:
```java
package com.factory.core.admin.impl.controller;

import com.factory.common.web.ApiEndpoints;
import com.factory.common.web.response.ApiError;
import com.factory.common.web.response.ApiResponse;
import com.factory.core.admin.impl.AdminAuthService;
import com.factory.core.admin.impl.dto.AdminDtos.AdminLoginRequest;
import com.factory.core.admin.impl.dto.AdminDtos.AdminLoginResponse;
import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
public class AdminAuthController {

    private final AdminAuthService authService;

    public AdminAuthController(AdminAuthService authService) {
        this.authService = authService;
    }

    @PostMapping(ApiEndpoints.Admin.LOGIN)
    public ApiResponse<AdminLoginResponse> login(@RequestBody @Valid AdminLoginRequest request) {
        return ApiResponse.ok(authService.login(request.email(), request.password()));
    }

    /** React factory CLI 의 백엔드 프로브 대상 (public). */
    @GetMapping(ApiEndpoints.Admin.HEALTH)
    public ApiResponse<Map<String, String>> health() {
        return ApiResponse.ok(Map.of("status", "UP"));
    }

    @ExceptionHandler(AdminAuthService.InvalidAdminCredentialsException.class)
    @ResponseStatus(HttpStatus.UNAUTHORIZED)
    public ApiResponse<Void> invalidCredentials(AdminAuthService.InvalidAdminCredentialsException e) {
        return ApiResponse.error(ApiError.of("ADMIN_001", e.getMessage()));
    }
}
```
(주의: `ApiError.of` 시그니처는 `common/common-web/.../response/ApiError.java` 를 열어 확인 — code/message 순.)

`AdminAutoConfiguration` 에 빈 추가:
```java
    @Bean
    @ConditionalOnMissingBean
    public AdminAuthService adminAuthService(
            AdminAccountRepository repository,
            PasswordHasher passwordHasher,
            com.factory.common.security.jwt.JwtService jwtService) {
        return new AdminAuthService(repository, passwordHasher, jwtService);
    }

    @Bean
    @org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(
            type = org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
    @ConditionalOnMissingBean
    public com.factory.core.admin.impl.controller.AdminAuthController adminAuthController(
            AdminAuthService adminAuthService) {
        return new com.factory.core.admin.impl.controller.AdminAuthController(adminAuthService);
    }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `./gradlew :core:core-admin-impl:test --tests '*AdminAuthServiceTest*'`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**
```bash
git add core/core-admin-impl
git commit -m "feat(admin): superadmin 로그인 + health 엔드포인트"
```

---

### Task 4: 활동 추적 — user_activity_days + 기록 필터

**Files:**
- Modify: `tools/new-app/new-app.sh` (V017 생성 heredoc 추가 + "도메인 테이블은 V017부터" 문구 2곳 → V018)
- Create: `core/core-user-impl/src/main/java/com/factory/core/user/impl/UserActivityTrackingFilter.java`
- Modify: `core/core-user-impl/src/main/java/com/factory/core/user/impl/UserAutoConfiguration.java` (필터 빈)
- Create: `core/core-user-impl/src/test/resources/db/migration/core/V017__test_init_user_activity_days.sql`
- Test: `core/core-user-impl/src/test/java/com/factory/core/user/impl/UserActivityTrackingFilterTest.java`

**Interfaces:**
- Produces: 테이블 `user_activity_days(user_id BIGINT, activity_date DATE, PK(user_id, activity_date))` — Task 8·9·11 의 DAU/MAU 쿼리가 읽음

- [ ] **Step 1: new-app.sh 에 V017 추가** — V016 heredoc 블록 뒤에 동일 스타일로:

```bash
cat > "${MIGRATION_DIR}/V017__init_user_activity_days.sql" <<'EOF'
-- 유저 활동일 기록 (DAU/MAU 원천) — 인증 요청 시 (user_id, 오늘) upsert
CREATE TABLE user_activity_days (
    user_id       BIGINT NOT NULL REFERENCES users (id),
    activity_date DATE   NOT NULL,
    PRIMARY KEY (user_id, activity_date)
);
CREATE INDEX idx_user_activity_days_date ON user_activity_days (activity_date);
EOF
```

그리고 스크립트 내 안내 문구 2곳 수정: `V001~V016 은 공통 테이블` → `V001~V017 은 공통 테이블`, `도메인 테이블 작성 (V017+)` → `도메인 테이블 작성 (V018+)` (`V017__init_<your-domain>.sql` 예시도 `V018__...` 로).

- [ ] **Step 2: 테스트 마이그레이션 복사** — `V017__test_init_user_activity_days.sql` 에 위 SQL 과 동일 내용 (헤더 주석에 "new-app.sh V017 미러 — 테스트 전용 사본" 추가).

- [ ] **Step 3: 실패 테스트** — `UserActivityTrackingFilterTest.java` (Mockito 단위 — 같은 유저·같은 날 1회만 기록):

```java
package com.factory.core.user.impl;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class UserActivityTrackingFilterTest {

    @Test
    void records_once_per_user_per_day() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        var filter = new UserActivityTrackingFilter(jdbc);

        filter.record("tradelog", 42L);
        filter.record("tradelog", 42L); // 같은 날 중복 — 캐시로 skip

        verify(jdbc, times(1)).update(anyString(), eq(42L), any());
    }

    @Test
    void different_users_recorded_separately() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        var filter = new UserActivityTrackingFilter(jdbc);

        filter.record("tradelog", 1L);
        filter.record("tradelog", 2L);

        verify(jdbc, times(2)).update(anyString(), anyLong(), any());
    }
}
```

- [ ] **Step 4: 실패 확인**

Run: `./gradlew :core:core-user-impl:test --tests '*UserActivityTrackingFilterTest*'`
Expected: 컴파일 실패

- [ ] **Step 5: 구현** — `UserActivityTrackingFilter.java`:

```java
package com.factory.core.user.impl;

import com.factory.common.persistence.SlugContext;
import com.factory.common.security.AuthenticatedUser;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.LocalDate;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * 인증된 앱 요청마다 (user_id, 오늘) 을 user_activity_days 에 upsert — DAU/MAU 원천 (ADR: admin 콘솔 스펙 §H).
 * 같은 유저·같은 날 중복은 인메모리 캐시로 걸러 DB 호출 1회. 실패해도 요청 흐름에 영향 없음 (best-effort).
 */
public class UserActivityTrackingFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(UserActivityTrackingFilter.class);
    private static final String UPSERT =
            "INSERT INTO user_activity_days (user_id, activity_date) VALUES (?, ?)"
                    + " ON CONFLICT DO NOTHING";

    private final JdbcTemplate routingJdbc; // @Primary 라우팅 DataSource — SlugContext 가 스키마 결정
    private final Map<String, LocalDate> recorded = new ConcurrentHashMap<>();

    public UserActivityTrackingFilter(JdbcTemplate routingJdbc) {
        this.routingJdbc = routingJdbc;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        try {
            Authentication auth = SecurityContextHolder.getContext().getAuthentication();
            String slug = SlugContext.get();
            if (slug != null
                    && auth != null
                    && auth.getPrincipal() instanceof AuthenticatedUser user
                    && request.getRequestURI().startsWith("/api/apps/")) {
                record(slug, user.userId());
            }
        } catch (Exception e) {
            log.debug("활동 기록 실패 (무시): {}", e.getMessage());
        }
        chain.doFilter(request, response);
    }

    /** 패키지 공개 — 단위 테스트용. */
    void record(String slug, long userId) {
        LocalDate today = LocalDate.now();
        String key = slug + ":" + userId;
        if (today.equals(recorded.get(key))) {
            return;
        }
        // 날짜가 바뀌면 맵 전체 초기화 (전날 키 누적 방지)
        recorded.values().removeIf(d -> !today.equals(d));
        routingJdbc.update(UPSERT, userId, java.sql.Date.valueOf(today));
        recorded.put(key, today);
    }
}
```
(주의: `AuthenticatedUser.userId()` 접근자 이름은 `common-security/.../AuthenticatedUser.java` 를 열어 확인 — record 필드명 그대로 사용.)

`UserAutoConfiguration` 에 빈 추가:
```java
    @Bean
    @ConditionalOnMissingBean
    public UserActivityTrackingFilter userActivityTrackingFilter(
            org.springframework.jdbc.core.JdbcTemplate jdbcTemplate) {
        return new UserActivityTrackingFilter(jdbcTemplate);
    }
```
(참고: bootstrap 에 `JdbcTemplate` @Primary 빈이 없으면 `javax.sql.DataSource` 를 직접 주입받아 내부에서 `new JdbcTemplate(dataSource)` 생성으로 변경.)

- [ ] **Step 6: 테스트 통과 + 커밋**

Run: `./gradlew :core:core-user-impl:test --tests '*UserActivityTrackingFilterTest*'`
Expected: PASS

```bash
git add tools/new-app/new-app.sh core/core-user-impl
git commit -m "feat(user): user_activity_days 활동 추적 (DAU/MAU 원천)"
```

---

### Task 5: fan-out 프리미티브 — AdminSlugRegistry + 테스트 하네스

**Files:**
- Create: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/AdminSlugRegistry.java`
- Modify: `AdminAutoConfiguration.java` (빈 추가)
- Create: `core/core-admin-impl/src/test/java/com/factory/core/admin/impl/AdminFanoutTestSupport.java`
- Create: `core/core-admin-impl/src/test/resources/db/migration/apps/` (앱 스키마 테스트 마이그레이션 — 아래 참조)
- Test: `core/core-admin-impl/src/test/java/com/factory/core/admin/impl/AdminSlugRegistryTest.java`

**Interfaces:**
- Produces: `AdminSlugRegistry.slugs() → List<String>` (정렬, "admin" 제외), `AdminSlugRegistry.jdbcFor(String slug) → JdbcTemplate` — 이후 모든 조회 Task 가 사용
- Produces(테스트): `AdminFanoutTestSupport.provisionApps("t1","t2") → AdminSlugRegistry` — 컨테이너에 앱 스키마 N개 생성

- [ ] **Step 1: 실패 테스트** — `AdminSlugRegistryTest.java`:

```java
package com.factory.core.admin.impl;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import java.util.Map;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;

class AdminSlugRegistryTest {

    @Test
    void slugs_derived_from_bean_names_excluding_admin_and_routing() {
        var registry =
                new AdminSlugRegistry(
                        Map.of(
                                "tradelogDataSource", mock(DataSource.class),
                                "gymlogDataSource", mock(DataSource.class),
                                "adminDataSource", mock(DataSource.class),
                                "dataSource", mock(DataSource.class)));
        assertThat(registry.slugs()).containsExactly("gymlog", "tradelog");
    }

    @Test
    void jdbcFor_returns_template_bound_to_that_slug() {
        var ds = mock(DataSource.class);
        var registry = new AdminSlugRegistry(Map.of("tradelogDataSource", ds));
        assertThat(registry.jdbcFor("tradelog").getDataSource()).isSameAs(ds);
    }
}
```

- [ ] **Step 2: 실패 확인** → Run: `./gradlew :core:core-admin-impl:test --tests '*AdminSlugRegistryTest*'` → 컴파일 실패

- [ ] **Step 3: 구현** — `AdminSlugRegistry.java`:

```java
package com.factory.core.admin.impl;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import javax.sql.DataSource;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 앱 슬러그 열거 + 슬러그별 JdbcTemplate — RoutingDataSourceConfig 와 동일하게
 * {@code <slug>DataSource} 빈 네이밍 컨벤션에서 파생. "admin"(콘솔 자신)과
 * "dataSource"(@Primary 라우팅) 는 제외.
 */
public class AdminSlugRegistry {

    private static final String SUFFIX = "DataSource";

    private final Map<String, DataSource> bySlug;
    private final Map<String, JdbcTemplate> templates = new ConcurrentHashMap<>();

    public AdminSlugRegistry(Map<String, DataSource> allDataSources) {
        this.bySlug =
                allDataSources.entrySet().stream()
                        .filter(e -> e.getKey().endsWith(SUFFIX))
                        .collect(
                                java.util.stream.Collectors.toMap(
                                        e -> e.getKey().substring(0, e.getKey().length() - SUFFIX.length()),
                                        Map.Entry::getValue))
                        .entrySet().stream()
                        .filter(e -> !e.getKey().isBlank() && !e.getKey().equals("admin"))
                        .collect(java.util.stream.Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
    }

    /** 정렬된 앱 슬러그 목록. */
    public List<String> slugs() {
        return bySlug.keySet().stream().sorted().toList();
    }

    public JdbcTemplate jdbcFor(String slug) {
        DataSource ds = bySlug.get(slug);
        if (ds == null) {
            throw new IllegalArgumentException("unknown app slug: " + slug);
        }
        return templates.computeIfAbsent(slug, s -> new JdbcTemplate(ds));
    }

    public boolean has(String slug) {
        return bySlug.containsKey(slug);
    }
}
```

`AdminAutoConfiguration` 에 빈 추가:
```java
    @Bean
    @ConditionalOnMissingBean
    public AdminSlugRegistry adminSlugRegistry(Map<String, javax.sql.DataSource> allDataSources) {
        return new AdminSlugRegistry(allDataSources);
    }
```

- [ ] **Step 4: 테스트 하네스** — `AdminFanoutTestSupport.java` (이후 모든 IT 가 재사용):

```java
package com.factory.core.admin.impl;

import com.factory.common.testing.PostgresTestContainer;
import com.zaxxer.hikari.HikariDataSource;
import java.util.HashMap;
import java.util.Map;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;

/**
 * 컨테이너에 앱 스키마 N개를 프로비저닝하고 AdminSlugRegistry 를 만드는 IT 헬퍼.
 * 마이그레이션은 src/test/resources/db/migration/apps (core 세트 사본 + V017 활동추적).
 */
public final class AdminFanoutTestSupport {
    private AdminFanoutTestSupport() {}

    public static AdminSlugRegistry provisionApps(String... slugs) {
        Map<String, DataSource> map = new HashMap<>();
        for (String slug : slugs) {
            HikariDataSource ds = new HikariDataSource();
            ds.setJdbcUrl(PostgresTestContainer.getJdbcUrl() + "&currentSchema=" + slug);
            ds.setUsername(PostgresTestContainer.getUsername());
            ds.setPassword(PostgresTestContainer.getPassword());
            Flyway.configure()
                    .dataSource(ds)
                    .schemas(slug)
                    .defaultSchema(slug)
                    .createSchemas(true)
                    .locations("classpath:db/migration/apps")
                    .load()
                    .migrate();
            map.put(slug + "DataSource", ds);
        }
        return new AdminSlugRegistry(map);
    }
}
```
(주의: `PostgresTestContainer.getJdbcUrl()` 이 `?` 파라미터를 이미 포함하는지 확인 — 미포함이면 `"?currentSchema="` 로.)

- [ ] **Step 5: 앱 스키마 테스트 마이그레이션 준비** — `core/core-admin-impl/src/test/resources/db/migration/apps/` 에 다음을 복사:
  - `core/core-audit-impl/src/test/resources/db/migration/core/` 의 `V001__init_users.sql`, `V002__init_auth_social_identities.sql`, `V003__add_users_nickname.sql`, `V008__init_devices.sql`, `V016__test_init_audit_logs.sql`
  - `core/core-billing-impl/src/test/resources/db/migration/core/` 의 `V010__test_init_subscription_plans.sql`, `V011__test_init_subscriptions.sql`
  - Task 4 의 `V017__test_init_user_activity_days.sql`
  - 각 파일 헤더에 `-- admin IT 전용 사본 (원본: <경로>)` 주석 추가. 번호 충돌 시 (V00N 중복) 이 디렉터리 안에서 V001 부터 순차 재번호.

- [ ] **Step 6: 테스트 통과 + 커밋**

Run: `./gradlew :core:core-admin-impl:test --tests '*AdminSlugRegistryTest*'`
Expected: PASS

```bash
git add core/core-admin-impl
git commit -m "feat(admin): AdminSlugRegistry fan-out 프리미티브 + IT 하네스"
```

---

### Task 6: GET /api/admin/apps (엔드포인트 2)

**Files:**
- Create: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/AdminAppsService.java`
- Create: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/controller/AdminAppsController.java`
- Modify: `AdminAutoConfiguration.java`, `dto/AdminDtos.java`
- Test: `core/core-admin-impl/src/test/java/com/factory/core/admin/impl/AdminAppsServiceIT.java`

**Interfaces:**
- Consumes: `AdminSlugRegistry`, `AdminFanoutTestSupport`
- Produces: `AppSummaryResponse(String slug, long userCount, long activeSubscriptions)` (React `AppSummary` 1:1), `AdminAppsService.listApps() → List<AppSummaryResponse>`

- [ ] **Step 1: 실패 테스트** — `AdminAppsServiceIT.java`:

```java
package com.factory.core.admin.impl;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

class AdminAppsServiceIT {

    static AdminSlugRegistry registry;
    static AdminAppsService service;

    @BeforeAll
    static void setUp() {
        registry = AdminFanoutTestSupport.provisionApps("t1", "t2");
        service = new AdminAppsService(registry);
        // seed: t1 유저 2 (1명 탈퇴), t2 유저 1
        var t1 = registry.jdbcFor("t1");
        t1.update("INSERT INTO users (email, created_at, updated_at) VALUES ('a@x.com', now(), now())");
        t1.update(
                "INSERT INTO users (email, created_at, updated_at, deleted_at) VALUES ('b@x.com', now(), now(), now())");
        registry.jdbcFor("t2")
                .update("INSERT INTO users (email, created_at, updated_at) VALUES ('c@x.com', now(), now())");
    }

    @Test
    void listApps_counts_alive_users_per_slug() {
        var apps = service.listApps();
        assertThat(apps).hasSize(2);
        assertThat(apps.get(0).slug()).isEqualTo("t1");
        assertThat(apps.get(0).userCount()).isEqualTo(1); // 탈퇴 제외
        assertThat(apps.get(1).slug()).isEqualTo("t2");
        assertThat(apps.get(1).userCount()).isEqualTo(1);
        assertThat(apps.get(0).activeSubscriptions()).isZero();
    }
}
```
(주의: users INSERT 의 NOT NULL 컬럼은 테스트 마이그레이션의 실제 스키마에 맞춰 조정 — email_verified/is_premium/role 은 DEFAULT 있음.)

- [ ] **Step 2: 실패 확인** → 컴파일 실패 확인

- [ ] **Step 3: 구현**

`dto/AdminDtos.java` 에 추가:
```java
    public record AppSummaryResponse(String slug, long userCount, long activeSubscriptions) {}
```

`AdminAppsService.java`:
```java
package com.factory.core.admin.impl;

import com.factory.core.admin.impl.dto.AdminDtos.AppSummaryResponse;
import java.util.List;

/** 앱 목록 + 앱별 기본 카운트 (fan-out). */
public class AdminAppsService {

    private static final String USER_COUNT =
            "SELECT COUNT(*) FROM users WHERE deleted_at IS NULL";
    private static final String ACTIVE_SUBS =
            "SELECT COUNT(*) FROM subscriptions WHERE status = 'ACTIVE'";

    private final AdminSlugRegistry registry;

    public AdminAppsService(AdminSlugRegistry registry) {
        this.registry = registry;
    }

    public List<AppSummaryResponse> listApps() {
        return registry.slugs().stream()
                .map(
                        slug -> {
                            var jdbc = registry.jdbcFor(slug);
                            long users = queryLong(jdbc, USER_COUNT);
                            long subs = queryLong(jdbc, ACTIVE_SUBS);
                            return new AppSummaryResponse(slug, users, subs);
                        })
                .toList();
    }

    static long queryLong(org.springframework.jdbc.core.JdbcTemplate jdbc, String sql, Object... args) {
        Long v = jdbc.queryForObject(sql, Long.class, args);
        return v == null ? 0 : v;
    }
}
```

`controller/AdminAppsController.java`:
```java
package com.factory.core.admin.impl.controller;

import com.factory.common.web.ApiEndpoints;
import com.factory.common.web.response.ApiResponse;
import com.factory.core.admin.impl.AdminAppsService;
import com.factory.core.admin.impl.dto.AdminDtos.AppSummaryResponse;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AdminAppsController {

    private final AdminAppsService appsService;

    public AdminAppsController(AdminAppsService appsService) {
        this.appsService = appsService;
    }

    @GetMapping(ApiEndpoints.Admin.BASE + "/apps")
    public ApiResponse<List<AppSummaryResponse>> apps() {
        return ApiResponse.ok(appsService.listApps());
    }
}
```

`AdminAutoConfiguration` 에 `AdminAppsService`/`AdminAppsController` 빈 추가 (Task 3 컨트롤러 빈과 동일 패턴 — `@ConditionalOnMissingBean` + 컨트롤러는 `@ConditionalOnWebApplication`).

- [ ] **Step 4: 통과 확인 + 커밋**

Run: `./gradlew :core:core-admin-impl:test --tests '*AdminAppsServiceIT*'`
Expected: PASS

```bash
git add core/core-admin-impl
git commit -m "feat(admin): GET /api/admin/apps — 앱 목록 fan-out"
```

---

### Task 7: 사용자 목록/상세 (엔드포인트 5·6)

**Files:**
- Create: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/AdminUsersService.java`
- Create: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/controller/AdminUsersController.java`
- Modify: `dto/AdminDtos.java`, `AdminAutoConfiguration.java`
- Test: `core/core-admin-impl/src/test/java/com/factory/core/admin/impl/AdminUsersServiceIT.java`

**Interfaces:**
- Produces (React 1:1):
```java
public record PageResponse<T>(java.util.List<T> content, int page, int size, long totalElements) {}
public record AdminUserRow(long id, String email, String displayName, String nickname, String role,
        boolean isPremium, boolean emailVerified, java.time.Instant createdAt, java.time.Instant deletedAt) {}
public record AdminUserFull(long id, String email, String displayName, String nickname, String role,
        boolean isPremium, boolean emailVerified, java.time.Instant createdAt, java.time.Instant deletedAt,
        java.time.Instant updatedAt) {}
public record AdminDeviceRow(long id, String platform, String deviceName, java.time.Instant lastSeenAt,
        java.time.Instant createdAt) {}
public record AdminSubscriptionRow(long id, long planId, String status, java.time.Instant startedAt,
        java.time.Instant expiresAt, java.time.Instant cancelledAt, String cancelReason) {}
public record AdminPaymentRow(long id, String channel, long amount, String currency, String status,
        java.time.Instant paidAt, java.time.Instant refundedAt) {}
public record AdminUserDetailResponse(AdminUserFull user, java.util.List<AdminDeviceRow> devices,
        java.util.List<AdminSubscriptionRow> subscriptions, java.util.List<AdminPaymentRow> recentPayments) {}
```
- `AdminUsersService.listUsers(slug, query, page, size) → PageResponse<AdminUserRow>` / `.userDetail(slug, userId) → AdminUserDetailResponse`

- [ ] **Step 1: 실패 테스트** — `AdminUsersServiceIT.java`:

```java
package com.factory.core.admin.impl;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

class AdminUsersServiceIT {

    static AdminSlugRegistry registry;
    static AdminUsersService service;

    @BeforeAll
    static void setUp() {
        registry = AdminFanoutTestSupport.provisionApps("u1");
        service = new AdminUsersService(registry);
        var jdbc = registry.jdbcFor("u1");
        for (int i = 1; i <= 25; i++) {
            jdbc.update(
                    "INSERT INTO users (email, display_name, created_at, updated_at) VALUES (?, ?, now(), now())",
                    "user" + i + "@x.com", "유저" + i);
        }
        Long uid = jdbc.queryForObject("SELECT id FROM users WHERE email = 'user1@x.com'", Long.class);
        jdbc.update(
                "INSERT INTO devices (user_id, app_slug, platform, device_name, created_at, updated_at)"
                        + " VALUES (?, 'u1', 'ios', 'iPhone', now(), now())",
                uid);
    }

    @Test
    void listUsers_paginates() {
        var page0 = service.listUsers("u1", null, 0, 20);
        assertThat(page0.totalElements()).isEqualTo(25);
        assertThat(page0.content()).hasSize(20);
        var page1 = service.listUsers("u1", null, 1, 20);
        assertThat(page1.content()).hasSize(5);
    }

    @Test
    void listUsers_query_filters_email_and_name() {
        var res = service.listUsers("u1", "user1@", 0, 20);
        assertThat(res.totalElements()).isEqualTo(1);
        assertThat(res.content().get(0).email()).isEqualTo("user1@x.com");
    }

    @Test
    void userDetail_joins_devices_subs_payments() {
        long uid = service.listUsers("u1", "user1@", 0, 1).content().get(0).id();
        var detail = service.userDetail("u1", uid);
        assertThat(detail.user().email()).isEqualTo("user1@x.com");
        assertThat(detail.devices()).hasSize(1);
        assertThat(detail.subscriptions()).isEmpty();
        assertThat(detail.recentPayments()).isEmpty();
    }
}
```

- [ ] **Step 2: 실패 확인** → 컴파일 실패

- [ ] **Step 3: 구현** — `AdminUsersService.java`:

```java
package com.factory.core.admin.impl;

import com.factory.core.admin.impl.dto.AdminDtos.*;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/** 앱 사용자 목록/상세 (단일 슬러그 스키마 조회). */
public class AdminUsersService {

    private final AdminSlugRegistry registry;

    public AdminUsersService(AdminSlugRegistry registry) {
        this.registry = registry;
    }

    private static Instant ts(ResultSet rs, String col) throws SQLException {
        var t = rs.getTimestamp(col);
        return t == null ? null : t.toInstant();
    }

    private static final RowMapper<AdminUserRow> USER_ROW =
            (rs, i) ->
                    new AdminUserRow(
                            rs.getLong("id"), rs.getString("email"), rs.getString("display_name"),
                            rs.getString("nickname"), rs.getString("role"), rs.getBoolean("is_premium"),
                            rs.getBoolean("email_verified"), ts(rs, "created_at"), ts(rs, "deleted_at"));

    public PageResponse<AdminUserRow> listUsers(String slug, String query, int page, int size) {
        JdbcTemplate jdbc = registry.jdbcFor(slug);
        String like = query == null || query.isBlank() ? null : "%" + query.trim() + "%";
        String where =
                like == null
                        ? ""
                        : " WHERE (email ILIKE ? OR display_name ILIKE ? OR nickname ILIKE ?)";
        Object[] whereArgs = like == null ? new Object[0] : new Object[] {like, like, like};

        Long total = jdbc.queryForObject("SELECT COUNT(*) FROM users" + where, Long.class, whereArgs);
        Object[] pageArgs = new Object[whereArgs.length + 2];
        System.arraycopy(whereArgs, 0, pageArgs, 0, whereArgs.length);
        pageArgs[whereArgs.length] = size;
        pageArgs[whereArgs.length + 1] = page * size;
        List<AdminUserRow> rows =
                jdbc.query(
                        "SELECT id, email, display_name, nickname, role, is_premium, email_verified,"
                                + " created_at, deleted_at FROM users" + where
                                + " ORDER BY id LIMIT ? OFFSET ?",
                        USER_ROW,
                        pageArgs);
        return new PageResponse<>(rows, page, size, total == null ? 0 : total);
    }

    public AdminUserDetailResponse userDetail(String slug, long userId) {
        JdbcTemplate jdbc = registry.jdbcFor(slug);
        AdminUserFull user =
                jdbc.queryForObject(
                        "SELECT id, email, display_name, nickname, role, is_premium, email_verified,"
                                + " created_at, deleted_at, updated_at FROM users WHERE id = ?",
                        (rs, i) ->
                                new AdminUserFull(
                                        rs.getLong("id"), rs.getString("email"), rs.getString("display_name"),
                                        rs.getString("nickname"), rs.getString("role"), rs.getBoolean("is_premium"),
                                        rs.getBoolean("email_verified"), ts(rs, "created_at"), ts(rs, "deleted_at"),
                                        ts(rs, "updated_at")),
                        userId);
        List<AdminDeviceRow> devices =
                jdbc.query(
                        "SELECT id, platform, device_name, last_seen_at, created_at FROM devices"
                                + " WHERE user_id = ? ORDER BY id",
                        (rs, i) ->
                                new AdminDeviceRow(
                                        rs.getLong("id"), rs.getString("platform"), rs.getString("device_name"),
                                        ts(rs, "last_seen_at"), ts(rs, "created_at")),
                        userId);
        List<AdminSubscriptionRow> subs =
                jdbc.query(
                        "SELECT id, plan_id, status, started_at, expires_at, cancelled_at, cancel_reason"
                                + " FROM subscriptions WHERE user_id = ? ORDER BY id DESC",
                        (rs, i) ->
                                new AdminSubscriptionRow(
                                        rs.getLong("id"), rs.getLong("plan_id"), rs.getString("status"),
                                        ts(rs, "started_at"), ts(rs, "expires_at"), ts(rs, "cancelled_at"),
                                        rs.getString("cancel_reason")),
                        userId);
        List<AdminPaymentRow> payments =
                jdbc.query(
                        "SELECT id, channel, amount, currency, status, paid_at, refunded_at"
                                + " FROM payment_history WHERE user_id = ? ORDER BY id DESC LIMIT 10",
                        (rs, i) ->
                                new AdminPaymentRow(
                                        rs.getLong("id"), rs.getString("channel"), rs.getLong("amount"),
                                        rs.getString("currency"), rs.getString("status"), ts(rs, "paid_at"),
                                        ts(rs, "refunded_at")),
                        userId);
        return new AdminUserDetailResponse(user, devices, subs, payments);
    }
}
```

`controller/AdminUsersController.java`:
```java
package com.factory.core.admin.impl.controller;

import com.factory.common.web.ApiEndpoints;
import com.factory.common.web.response.ApiResponse;
import com.factory.core.admin.impl.AdminUsersService;
import com.factory.core.admin.impl.dto.AdminDtos.*;
import org.springframework.web.bind.annotation.*;

@RestController
public class AdminUsersController {

    private final AdminUsersService usersService;

    public AdminUsersController(AdminUsersService usersService) {
        this.usersService = usersService;
    }

    @GetMapping(ApiEndpoints.Admin.BASE + "/apps/{slug}/users")
    public ApiResponse<PageResponse<AdminUserRow>> users(
            @PathVariable String slug,
            @RequestParam(required = false) String query,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.ok(usersService.listUsers(slug, query, page, Math.min(size, 100)));
    }

    @GetMapping(ApiEndpoints.Admin.BASE + "/apps/{slug}/users/{userId}")
    public ApiResponse<AdminUserDetailResponse> userDetail(
            @PathVariable String slug, @PathVariable long userId) {
        return ApiResponse.ok(usersService.userDetail(slug, userId));
    }
}
```

DTO 추가(Interfaces 블록의 record 들을 `AdminDtos.java` 에), AutoConfiguration 빈 추가 (기존 패턴).

- [ ] **Step 4: 통과 + 커밋**

Run: `./gradlew :core:core-admin-impl:test --tests '*AdminUsersServiceIT*'` → PASS

```bash
git add core/core-admin-impl
git commit -m "feat(admin): 사용자 목록/상세 조회 (앱 스키마 직조회)"
```

---

### Task 8: 앱 metrics + billing (엔드포인트 4·7)

**Files:**
- Create: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/AdminMetricsService.java`
- Create: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/controller/AdminMetricsController.java`
- Modify: `dto/AdminDtos.java`, `AdminAutoConfiguration.java`
- Test: `core/core-admin-impl/src/test/java/com/factory/core/admin/impl/AdminMetricsServiceIT.java`

**Interfaces:**
- Produces (React 1:1):
```java
public record AppMetricsResponse(String slug, java.time.Instant generatedAt, long users, long newUsers7d,
        long premiumUsers, long dau, long mau, long revenue30d, long activeSubscriptions) {}
public record BillingByChannelRow(String channel, long amount, long count) {}
public record BillingDailyRow(String date, long amount) {}
public record BillingSummaryResponse(String slug, String from, String to, long gross, long refunded, long net,
        java.util.List<BillingByChannelRow> byChannel, long activeSubscriptions,
        java.util.List<BillingDailyRow> dailySeries) {}
```
- `AdminMetricsService.appMetrics(slug)` / `.billing(slug, from, to)` — from/to 는 ISO instant 문자열(null 허용, 기본 최근 30일)
- **핵심 SQL 시맨틱** (Task 9·11 도 동일 사용):
  - DAU: `SELECT COUNT(DISTINCT user_id) FROM user_activity_days WHERE activity_date = CURRENT_DATE`
  - MAU: `... WHERE activity_date >= CURRENT_DATE - INTERVAL '29 days'`
  - revenue: `SELECT COALESCE(SUM(amount),0) FROM payment_history WHERE status = 'PAID' AND paid_at >= ?`
  - refunded: `SELECT COALESCE(SUM(amount),0) FROM payment_history WHERE refunded_at >= ?`

- [ ] **Step 1: 실패 테스트** — `AdminMetricsServiceIT.java` (u1 스키마에 유저 3·활동 2일·결제 PAID 2건/환불 1건 seed → appMetrics 필드 검증 + billing gross/net/byChannel/dailySeries 검증. seed SQL 은 Task 7 IT 패턴 재사용):

```java
package com.factory.core.admin.impl;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

class AdminMetricsServiceIT {

    static AdminSlugRegistry registry;
    static AdminMetricsService service;

    @BeforeAll
    static void setUp() {
        registry = AdminFanoutTestSupport.provisionApps("m1");
        service = new AdminMetricsService(registry);
        var jdbc = registry.jdbcFor("m1");
        jdbc.update("INSERT INTO users (email, is_premium, created_at, updated_at) VALUES ('p@x.com', true, now(), now())");
        jdbc.update("INSERT INTO users (email, created_at, updated_at) VALUES ('q@x.com', now(), now())");
        Long u1 = jdbc.queryForObject("SELECT id FROM users WHERE email='p@x.com'", Long.class);
        Long u2 = jdbc.queryForObject("SELECT id FROM users WHERE email='q@x.com'", Long.class);
        jdbc.update("INSERT INTO user_activity_days (user_id, activity_date) VALUES (?, CURRENT_DATE)", u1);
        jdbc.update("INSERT INTO user_activity_days (user_id, activity_date) VALUES (?, CURRENT_DATE - 3)", u2);
        jdbc.update(
                "INSERT INTO payment_history (user_id, channel, external_id, amount, currency, status, paid_at, created_at, updated_at)"
                        + " VALUES (?, 'PG', 'ext-1', 5000, 'KRW', 'PAID', now(), now(), now())", u1);
        jdbc.update(
                "INSERT INTO payment_history (user_id, channel, external_id, amount, currency, status, paid_at, refunded_at, created_at, updated_at)"
                        + " VALUES (?, 'IAP', 'ext-2', 3000, 'KRW', 'PAID', now(), now(), now(), now())", u2);
    }

    @Test
    void appMetrics_fields() {
        var m = service.appMetrics("m1");
        assertThat(m.users()).isEqualTo(2);
        assertThat(m.premiumUsers()).isEqualTo(1);
        assertThat(m.newUsers7d()).isEqualTo(2);
        assertThat(m.dau()).isEqualTo(1);
        assertThat(m.mau()).isEqualTo(2);
        assertThat(m.revenue30d()).isEqualTo(8000);
    }

    @Test
    void billing_summary() {
        var b = service.billing("m1", null, null);
        assertThat(b.gross()).isEqualTo(8000);
        assertThat(b.refunded()).isEqualTo(3000);
        assertThat(b.net()).isEqualTo(5000);
        assertThat(b.byChannel()).hasSize(2);
        assertThat(b.dailySeries()).isNotEmpty();
    }
}
```

- [ ] **Step 2: 실패 확인** → 컴파일 실패

- [ ] **Step 3: 구현** — `AdminMetricsService.java` (Interfaces 의 SQL 시맨틱 그대로; billing 은 from/to null 이면 `Instant.now().minus(30, DAYS)`~now; dailySeries 는 `GROUP BY paid_at::date ORDER BY 1`, byChannel 은 `GROUP BY channel`; `AdminAppsService.queryLong` 재사용):

```java
package com.factory.core.admin.impl;

import static com.factory.core.admin.impl.AdminAppsService.queryLong;

import com.factory.core.admin.impl.dto.AdminDtos.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;

/** 앱 단일 지표 + 빌링 요약. */
public class AdminMetricsService {

    private final AdminSlugRegistry registry;

    public AdminMetricsService(AdminSlugRegistry registry) {
        this.registry = registry;
    }

    public AppMetricsResponse appMetrics(String slug) {
        JdbcTemplate jdbc = registry.jdbcFor(slug);
        Timestamp d7 = Timestamp.from(Instant.now().minus(7, ChronoUnit.DAYS));
        Timestamp d30 = Timestamp.from(Instant.now().minus(30, ChronoUnit.DAYS));
        return new AppMetricsResponse(
                slug,
                Instant.now(),
                queryLong(jdbc, "SELECT COUNT(*) FROM users WHERE deleted_at IS NULL"),
                queryLong(jdbc, "SELECT COUNT(*) FROM users WHERE created_at >= ?", d7),
                queryLong(jdbc, "SELECT COUNT(*) FROM users WHERE is_premium AND deleted_at IS NULL"),
                queryLong(jdbc, "SELECT COUNT(DISTINCT user_id) FROM user_activity_days WHERE activity_date = CURRENT_DATE"),
                queryLong(jdbc, "SELECT COUNT(DISTINCT user_id) FROM user_activity_days WHERE activity_date >= CURRENT_DATE - INTERVAL '29 days'"),
                queryLong(jdbc, "SELECT COALESCE(SUM(amount),0) FROM payment_history WHERE status='PAID' AND paid_at >= ?", d30),
                queryLong(jdbc, "SELECT COUNT(*) FROM subscriptions WHERE status='ACTIVE'"));
    }

    public BillingSummaryResponse billing(String slug, String fromIso, String toIso) {
        JdbcTemplate jdbc = registry.jdbcFor(slug);
        Instant from = fromIso == null ? Instant.now().minus(30, ChronoUnit.DAYS) : Instant.parse(fromIso);
        Instant to = toIso == null ? Instant.now() : Instant.parse(toIso);
        Timestamp f = Timestamp.from(from);
        Timestamp t = Timestamp.from(to);
        long gross =
                queryLong(jdbc, "SELECT COALESCE(SUM(amount),0) FROM payment_history WHERE status='PAID' AND paid_at BETWEEN ? AND ?", f, t);
        long refunded =
                queryLong(jdbc, "SELECT COALESCE(SUM(amount),0) FROM payment_history WHERE refunded_at BETWEEN ? AND ?", f, t);
        List<BillingByChannelRow> byChannel =
                jdbc.query(
                        "SELECT channel, COALESCE(SUM(amount),0) AS amount, COUNT(*) AS cnt FROM payment_history"
                                + " WHERE status='PAID' AND paid_at BETWEEN ? AND ? GROUP BY channel ORDER BY channel",
                        (rs, i) -> new BillingByChannelRow(rs.getString("channel"), rs.getLong("amount"), rs.getLong("cnt")),
                        f, t);
        List<BillingDailyRow> daily =
                jdbc.query(
                        "SELECT paid_at::date AS d, COALESCE(SUM(amount),0) AS amount FROM payment_history"
                                + " WHERE status='PAID' AND paid_at BETWEEN ? AND ? GROUP BY 1 ORDER BY 1",
                        (rs, i) -> new BillingDailyRow(rs.getString("d"), rs.getLong("amount")),
                        f, t);
        long activeSubs = queryLong(jdbc, "SELECT COUNT(*) FROM subscriptions WHERE status='ACTIVE'");
        return new BillingSummaryResponse(
                slug, from.toString(), to.toString(), gross, refunded, gross - refunded, byChannel, activeSubs, daily);
    }
}
```

`controller/AdminMetricsController.java` — `GET {BASE}/apps/{slug}/metrics` → `appMetrics`, `GET {BASE}/apps/{slug}/billing?from&to` → `billing` (Task 7 컨트롤러 패턴 그대로, `ApiResponse.ok` 반환). DTO/빈 등록 동일 패턴.

- [ ] **Step 4: 통과 + 커밋**

Run: `./gradlew :core:core-admin-impl:test --tests '*AdminMetricsServiceIT*'` → PASS
```bash
git add core/core-admin-impl
git commit -m "feat(admin): 앱 metrics + billing 요약"
```

---

### Task 9: 대시보드 (엔드포인트 3, fan-out 합산)

**Files:**
- Create: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/AdminDashboardService.java`
- Create: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/controller/AdminDashboardController.java`
- Modify: `dto/AdminDtos.java`, `AdminAutoConfiguration.java`
- Test: `core/core-admin-impl/src/test/java/com/factory/core/admin/impl/AdminDashboardServiceIT.java`

**Interfaces:**
- Produces (React 1:1):
```java
public record SlugMetricsRow(String slug, long users, long newUsers, long dau, long mau, long revenue,
        long refunded, long activeSubscriptions, long failures24h) {}
public record DashboardTotalsRow(long users, long newUsers, long dau, long mau, long revenue, long refunded,
        long activeSubscriptions, long failures24h) {}
public record DashboardMetricsResponse(java.time.Instant generatedAt, String window,
        DashboardTotalsRow totals, java.util.List<SlugMetricsRow> perSlug) {}
```
- `AdminDashboardService.dashboard(String window)` — window "30d"|"7d" (기본 "30d", 그 외 값은 30d 취급). failures24h = `audit_logs result='FAILURE' AND occurred_at >= now()-24h`

- [ ] **Step 1: 실패 테스트** — 슬러그 2개(d1, d2)에 각각 유저/결제/활동/감사FAILURE seed → `dashboard("30d")` 의 `perSlug` 가 슬러그별 값, `totals` 가 합산과 일치함을 검증:

```java
package com.factory.core.admin.impl;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

class AdminDashboardServiceIT {

    static AdminSlugRegistry registry;
    static AdminDashboardService service;

    @BeforeAll
    static void setUp() {
        registry = AdminFanoutTestSupport.provisionApps("d1", "d2");
        service = new AdminDashboardService(registry);
        for (String slug : new String[] {"d1", "d2"}) {
            var jdbc = registry.jdbcFor(slug);
            jdbc.update("INSERT INTO users (email, created_at, updated_at) VALUES ('a@" + slug + "', now(), now())");
            Long uid = jdbc.queryForObject("SELECT id FROM users LIMIT 1", Long.class);
            jdbc.update("INSERT INTO user_activity_days (user_id, activity_date) VALUES (?, CURRENT_DATE)", uid);
            jdbc.update(
                    "INSERT INTO payment_history (user_id, channel, external_id, amount, currency, status, paid_at, created_at, updated_at)"
                            + " VALUES (?, 'PG', 'e-" + slug + "', 1000, 'KRW', 'PAID', now(), now(), now())", uid);
            jdbc.update(
                    "INSERT INTO audit_logs (action, result, occurred_at, created_at, updated_at)"
                            + " VALUES ('X', 'FAILURE', now(), now(), now())");
        }
    }

    @Test
    void totals_equal_sum_of_perSlug() {
        var d = service.dashboard("30d");
        assertThat(d.perSlug()).hasSize(2);
        assertThat(d.totals().users()).isEqualTo(2);
        assertThat(d.totals().revenue()).isEqualTo(2000);
        assertThat(d.totals().dau()).isEqualTo(2);
        assertThat(d.totals().failures24h()).isEqualTo(2);
        assertThat(d.window()).isEqualTo("30d");
    }
}
```

- [ ] **Step 2: 실패 확인** → 컴파일 실패

- [ ] **Step 3: 구현** — `AdminDashboardService.java` (슬러그별 `SlugMetricsRow` 계산 → 스트림 합산으로 totals; newUsers/revenue/refunded 는 window 기준, DAU/MAU/failures24h 는 정의 고정):

```java
package com.factory.core.admin.impl;

import static com.factory.core.admin.impl.AdminAppsService.queryLong;

import com.factory.core.admin.impl.dto.AdminDtos.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

/** 대시보드 — 전 슬러그 fan-out 후 메모리 합산. */
public class AdminDashboardService {

    private final AdminSlugRegistry registry;

    public AdminDashboardService(AdminSlugRegistry registry) {
        this.registry = registry;
    }

    public DashboardMetricsResponse dashboard(String window) {
        String w = "7d".equals(window) ? "7d" : "30d";
        int days = "7d".equals(w) ? 7 : 30;
        Timestamp since = Timestamp.from(Instant.now().minus(days, ChronoUnit.DAYS));
        Timestamp h24 = Timestamp.from(Instant.now().minus(24, ChronoUnit.HOURS));

        List<SlugMetricsRow> perSlug =
                registry.slugs().stream()
                        .map(
                                slug -> {
                                    var jdbc = registry.jdbcFor(slug);
                                    return new SlugMetricsRow(
                                            slug,
                                            queryLong(jdbc, "SELECT COUNT(*) FROM users WHERE deleted_at IS NULL"),
                                            queryLong(jdbc, "SELECT COUNT(*) FROM users WHERE created_at >= ?", since),
                                            queryLong(jdbc, "SELECT COUNT(DISTINCT user_id) FROM user_activity_days WHERE activity_date = CURRENT_DATE"),
                                            queryLong(jdbc, "SELECT COUNT(DISTINCT user_id) FROM user_activity_days WHERE activity_date >= CURRENT_DATE - INTERVAL '29 days'"),
                                            queryLong(jdbc, "SELECT COALESCE(SUM(amount),0) FROM payment_history WHERE status='PAID' AND paid_at >= ?", since),
                                            queryLong(jdbc, "SELECT COALESCE(SUM(amount),0) FROM payment_history WHERE refunded_at >= ?", since),
                                            queryLong(jdbc, "SELECT COUNT(*) FROM subscriptions WHERE status='ACTIVE'"),
                                            queryLong(jdbc, "SELECT COUNT(*) FROM audit_logs WHERE result='FAILURE' AND occurred_at >= ?", h24));
                                })
                        .toList();

        DashboardTotalsRow totals =
                new DashboardTotalsRow(
                        perSlug.stream().mapToLong(SlugMetricsRow::users).sum(),
                        perSlug.stream().mapToLong(SlugMetricsRow::newUsers).sum(),
                        perSlug.stream().mapToLong(SlugMetricsRow::dau).sum(),
                        perSlug.stream().mapToLong(SlugMetricsRow::mau).sum(),
                        perSlug.stream().mapToLong(SlugMetricsRow::revenue).sum(),
                        perSlug.stream().mapToLong(SlugMetricsRow::refunded).sum(),
                        perSlug.stream().mapToLong(SlugMetricsRow::activeSubscriptions).sum(),
                        perSlug.stream().mapToLong(SlugMetricsRow::failures24h).sum());
        return new DashboardMetricsResponse(Instant.now(), w, totals, perSlug);
    }
}
```

`AdminDashboardController` — `GET {BASE}/dashboard/metrics?window=30d` → `ApiResponse.ok(service.dashboard(window))`. 빈 등록 동일.

- [ ] **Step 4: 통과 + 커밋**

Run: `./gradlew :core:core-admin-impl:test --tests '*AdminDashboardServiceIT*'` → PASS
```bash
git add core/core-admin-impl
git commit -m "feat(admin): 대시보드 fan-out 합산 (totals=perSlug 합)"
```

---

### Task 10: 감사로그 (엔드포인트 8, cross-app 병합)

**Files:**
- Create: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/AdminAuditService.java`
- Create: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/controller/AdminAuditController.java`
- Modify: `dto/AdminDtos.java`, `AdminAutoConfiguration.java`
- Test: `core/core-admin-impl/src/test/java/com/factory/core/admin/impl/AdminAuditServiceIT.java`

**Interfaces:**
- Produces (React 1:1 — `resourceId` 는 String, DB BIGINT → String 변환. `slug` 는 응답에서 조회 대상 슬러그로 채움):
```java
public record AuditLogRow(long id, Long actorUserId, String actorEmail, String action, String resourceType,
        String resourceId, String slug, String result, String ipAddress, java.time.Instant occurredAt) {}
```
- `AdminAuditService.search(slug, actorEmail, action, result, fromIso, toIso, page, size) → PageResponse<AuditLogRow>`
- slug 지정 → 단일 스키마 SQL 페이징 / 미지정 → 슬러그별 (page+1)*size 건씩 가져와 occurred_at DESC 병합 후 메모리 페이징 (totalElements = 슬러그별 count 합)

- [ ] **Step 1: 실패 테스트** — 슬러그 2개에 로그 3+2건 seed (occurred_at 어긋나게) → ① slug 미지정: 5건 병합 + 최신순 정렬 검증 ② slug 지정: 그 앱 것만 ③ result=FAILURE 필터 ④ 페이징(size 2, page 1) 검증:

```java
package com.factory.core.admin.impl;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

class AdminAuditServiceIT {

    static AdminSlugRegistry registry;
    static AdminAuditService service;

    @BeforeAll
    static void setUp() {
        registry = AdminFanoutTestSupport.provisionApps("a1", "a2");
        service = new AdminAuditService(registry);
        var a1 = registry.jdbcFor("a1");
        for (int i = 0; i < 3; i++) {
            a1.update(
                    "INSERT INTO audit_logs (actor_email, action, result, occurred_at, created_at, updated_at)"
                            + " VALUES ('op@x.com', 'ACT" + i + "', 'SUCCESS', now() - make_interval(hours => " + i * 2 + "), now(), now())");
        }
        var a2 = registry.jdbcFor("a2");
        a2.update(
                "INSERT INTO audit_logs (actor_email, action, result, occurred_at, created_at, updated_at)"
                        + " VALUES ('op@x.com', 'ACT9', 'FAILURE', now() - make_interval(hours => 1), now(), now())");
        a2.update(
                "INSERT INTO audit_logs (actor_email, action, result, occurred_at, created_at, updated_at)"
                        + " VALUES ('op@x.com', 'ACT8', 'SUCCESS', now() - make_interval(hours => 9), now(), now())");
    }

    @Test
    void merged_across_slugs_sorted_desc() {
        var res = service.search(null, null, null, null, null, null, 0, 20);
        assertThat(res.totalElements()).isEqualTo(5);
        assertThat(res.content().get(0).action()).isEqualTo("ACT0"); // 최신
        assertThat(res.content().get(1).action()).isEqualTo("ACT9");
    }

    @Test
    void slug_filter_single_schema() {
        var res = service.search("a2", null, null, null, null, null, 0, 20);
        assertThat(res.totalElements()).isEqualTo(2);
        assertThat(res.content()).allMatch(r -> r.slug().equals("a2"));
    }

    @Test
    void result_filter() {
        var res = service.search(null, null, null, "FAILURE", null, null, 0, 20);
        assertThat(res.totalElements()).isEqualTo(1);
    }

    @Test
    void memory_pagination() {
        var res = service.search(null, null, null, null, null, null, 1, 2);
        assertThat(res.content()).hasSize(2);
        assertThat(res.totalElements()).isEqualTo(5);
    }
}
```

- [ ] **Step 2: 실패 확인** → 컴파일 실패

- [ ] **Step 3: 구현** — `AdminAuditService.java`:

```java
package com.factory.core.admin.impl;

import com.factory.core.admin.impl.dto.AdminDtos.AuditLogRow;
import com.factory.core.admin.impl.dto.AdminDtos.PageResponse;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/** 감사로그 검색 — slug 지정 시 단일 스키마, 미지정 시 전 슬러그 병합 (메모리 페이징). */
public class AdminAuditService {

    private final AdminSlugRegistry registry;

    public AdminAuditService(AdminSlugRegistry registry) {
        this.registry = registry;
    }

    private static RowMapper<AuditLogRow> mapper(String slug) {
        return (rs, i) -> {
            long resourceId = rs.getLong("resource_id");
            boolean ridNull = rs.wasNull();
            long actorId = rs.getLong("actor_user_id");
            boolean actorNull = rs.wasNull();
            var occurred = rs.getTimestamp("occurred_at");
            return new AuditLogRow(
                    rs.getLong("id"),
                    actorNull ? null : actorId,
                    rs.getString("actor_email"),
                    rs.getString("action"),
                    rs.getString("resource_type"),
                    ridNull ? null : String.valueOf(resourceId),
                    slug,
                    rs.getString("result"),
                    rs.getString("ip_address"),
                    occurred == null ? null : occurred.toInstant());
        };
    }

    public PageResponse<AuditLogRow> search(
            String slug, String actorEmail, String action, String result,
            String fromIso, String toIso, int page, int size) {
        StringBuilder where = new StringBuilder(" WHERE 1=1");
        List<Object> args = new ArrayList<>();
        if (actorEmail != null && !actorEmail.isBlank()) {
            where.append(" AND actor_email ILIKE ?");
            args.add("%" + actorEmail.trim() + "%");
        }
        if (action != null && !action.isBlank()) {
            where.append(" AND action ILIKE ?");
            args.add("%" + action.trim() + "%");
        }
        if (result != null && !result.isBlank()) {
            where.append(" AND result = ?");
            args.add(result);
        }
        if (fromIso != null && !fromIso.isBlank()) {
            where.append(" AND occurred_at >= ?");
            args.add(Timestamp.from(Instant.parse(fromIso)));
        }
        if (toIso != null && !toIso.isBlank()) {
            where.append(" AND occurred_at <= ?");
            args.add(Timestamp.from(Instant.parse(toIso)));
        }
        String select =
                "SELECT id, actor_user_id, actor_email, action, resource_type, resource_id, result,"
                        + " ip_address, occurred_at FROM audit_logs" + where;

        List<String> targets =
                slug == null || slug.isBlank() ? registry.slugs() : List.of(slug);

        long total = 0;
        List<AuditLogRow> merged = new ArrayList<>();
        int fetch = (page + 1) * size; // 병합 페이징에 필요한 상한만 슬러그별로 가져옴
        for (String s : targets) {
            JdbcTemplate jdbc = registry.jdbcFor(s);
            Long cnt =
                    jdbc.queryForObject(
                            "SELECT COUNT(*) FROM audit_logs" + where, Long.class, args.toArray());
            total += cnt == null ? 0 : cnt;
            merged.addAll(
                    jdbc.query(
                            select + " ORDER BY occurred_at DESC LIMIT " + fetch, mapper(s), args.toArray()));
        }
        merged.sort(Comparator.comparing(AuditLogRow::occurredAt).reversed());
        int fromIdx = Math.min(page * size, merged.size());
        int toIdx = Math.min(fromIdx + size, merged.size());
        return new PageResponse<>(merged.subList(fromIdx, toIdx), page, size, total);
    }
}
```

`AdminAuditController` — `GET {BASE}/audit-logs` (@RequestParam 전부 required=false, page 기본 0, size 기본 20·최대 100) → `ApiResponse.ok(...)`. 빈 등록 동일.

- [ ] **Step 4: 통과 + 커밋**

Run: `./gradlew :core:core-admin-impl:test --tests '*AdminAuditServiceIT*'` → PASS
```bash
git add core/core-admin-impl
git commit -m "feat(admin): 감사로그 cross-app 병합 검색"
```

---

### Task 11: 분석 시계열 (엔드포인트 9)

**Files:**
- Create: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/AdminAnalyticsService.java`
- Create: `core/core-admin-impl/src/main/java/com/factory/core/admin/impl/controller/AdminAnalyticsController.java`
- Modify: `dto/AdminDtos.java`, `AdminAutoConfiguration.java`
- Test: `core/core-admin-impl/src/test/java/com/factory/core/admin/impl/AdminAnalyticsServiceIT.java`

**Interfaces:**
- Produces (React 1:1):
```java
public record TimeSeriesPointRow(String ts, long value) {}
public record TimeSeriesResponse(String metric, String interval, java.util.List<TimeSeriesPointRow> points) {}
```
- `AdminAnalyticsService.series(metric, slug, fromIso, toIso) → TimeSeriesResponse` — metric ∈ {dau, signups, revenue}; slug 필수(@RequestParam — React 분석 페이지는 앱 단위 조회); interval 은 "day" 고정; from/to 기본 최근 30일; 미지원 metric → IllegalArgumentException → 400

- [ ] **Step 1: 실패 테스트** — s1 에 활동 2일·가입 2건·결제 1건 seed → 각 metric 의 points 날짜·값 검증 + 미지원 metric 예외:

```java
package com.factory.core.admin.impl;

import static org.assertj.core.api.Assertions.*;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

class AdminAnalyticsServiceIT {

    static AdminSlugRegistry registry;
    static AdminAnalyticsService service;

    @BeforeAll
    static void setUp() {
        registry = AdminFanoutTestSupport.provisionApps("s1");
        service = new AdminAnalyticsService(registry);
        var jdbc = registry.jdbcFor("s1");
        jdbc.update("INSERT INTO users (email, created_at, updated_at) VALUES ('a@x.com', now() - interval '1 day', now())");
        jdbc.update("INSERT INTO users (email, created_at, updated_at) VALUES ('b@x.com', now(), now())");
        Long uid = jdbc.queryForObject("SELECT id FROM users LIMIT 1", Long.class);
        jdbc.update("INSERT INTO user_activity_days (user_id, activity_date) VALUES (?, CURRENT_DATE)", uid);
        jdbc.update("INSERT INTO user_activity_days (user_id, activity_date) VALUES (?, CURRENT_DATE - 1)", uid);
        jdbc.update(
                "INSERT INTO payment_history (user_id, channel, external_id, amount, currency, status, paid_at, created_at, updated_at)"
                        + " VALUES (?, 'PG', 'x-1', 7000, 'KRW', 'PAID', now(), now(), now())", uid);
    }

    @Test
    void signups_series() {
        var s = service.series("signups", "s1", null, null);
        assertThat(s.metric()).isEqualTo("signups");
        assertThat(s.points()).hasSize(2);
        assertThat(s.points().stream().mapToLong(p -> p.value()).sum()).isEqualTo(2);
    }

    @Test
    void dau_series() {
        var s = service.series("dau", "s1", null, null);
        assertThat(s.points()).hasSize(2);
        assertThat(s.points()).allMatch(p -> p.value() == 1);
    }

    @Test
    void revenue_series() {
        var s = service.series("revenue", "s1", null, null);
        assertThat(s.points()).hasSize(1);
        assertThat(s.points().get(0).value()).isEqualTo(7000);
    }

    @Test
    void unknown_metric_throws() {
        assertThatThrownBy(() -> service.series("nope", "s1", null, null))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
```

- [ ] **Step 2: 실패 확인** → 컴파일 실패

- [ ] **Step 3: 구현** — `AdminAnalyticsService.java`:

```java
package com.factory.core.admin.impl;

import com.factory.core.admin.impl.dto.AdminDtos.TimeSeriesPointRow;
import com.factory.core.admin.impl.dto.AdminDtos.TimeSeriesResponse;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;

/** 앱 시계열 — dau(user_activity_days 실데이터) · signups(users) · revenue(payment_history). */
public class AdminAnalyticsService {

    private final AdminSlugRegistry registry;

    public AdminAnalyticsService(AdminSlugRegistry registry) {
        this.registry = registry;
    }

    public TimeSeriesResponse series(String metric, String slug, String fromIso, String toIso) {
        JdbcTemplate jdbc = registry.jdbcFor(slug);
        Instant from = fromIso == null ? Instant.now().minus(30, ChronoUnit.DAYS) : Instant.parse(fromIso);
        Instant to = toIso == null ? Instant.now() : Instant.parse(toIso);
        Timestamp f = Timestamp.from(from);
        Timestamp t = Timestamp.from(to);
        String sql =
                switch (metric) {
                    case "dau" ->
                            "SELECT activity_date::text AS ts, COUNT(DISTINCT user_id) AS v FROM user_activity_days"
                                    + " WHERE activity_date BETWEEN ?::date AND ?::date GROUP BY 1 ORDER BY 1";
                    case "signups" ->
                            "SELECT created_at::date::text AS ts, COUNT(*) AS v FROM users"
                                    + " WHERE created_at BETWEEN ? AND ? GROUP BY 1 ORDER BY 1";
                    case "revenue" ->
                            "SELECT paid_at::date::text AS ts, COALESCE(SUM(amount),0) AS v FROM payment_history"
                                    + " WHERE status='PAID' AND paid_at BETWEEN ? AND ? GROUP BY 1 ORDER BY 1";
                    default -> throw new IllegalArgumentException("unsupported metric: " + metric);
                };
        List<TimeSeriesPointRow> points =
                jdbc.query(sql, (rs, i) -> new TimeSeriesPointRow(rs.getString("ts"), rs.getLong("v")), f, t);
        return new TimeSeriesResponse(metric, "day", points);
    }
}
```
(주의: `dau` 분기는 `?::date` 캐스팅 — Timestamp 파라미터를 date 와 비교. 통합 시 동작 확인.)

`AdminAnalyticsController` — `GET {BASE}/analytics/{metric}?slug=&from=&to=` → `ApiResponse.ok(...)` + `@ExceptionHandler(IllegalArgumentException.class)` → 400 `ApiError.of("ADMIN_002", e.getMessage())`. 빈 등록 동일.

- [ ] **Step 4: 통과 + 커밋**

Run: `./gradlew :core:core-admin-impl:test --tests '*AdminAnalyticsServiceIT*'` → PASS
```bash
git add core/core-admin-impl
git commit -m "feat(admin): 분석 시계열 (dau/signups/revenue)"
```

---

### Task 12: 마무리 — 전체 그린 + .env 문서 + 스펙 동기화

**Files:**
- Modify: `.env.example` (루트에 있으면 — ADMIN_EMAIL/ADMIN_PASSWORD/ADMIN_DB_* 항목 추가; 없으면 README 의 env 표에)
- Modify: `docs/superpowers/specs/2026-07-06-admin-module-design.md` (상태를 "구현됨"으로)

- [ ] **Step 1: 전체 빌드/테스트**

Run: `./gradlew build -x :bootstrap:test && ./gradlew :bootstrap:test`
Expected: BUILD SUCCESSFUL — bootstrap ArchUnit 포함 전부 그린. (ArchUnit 이 admin 모듈 규칙 위반을 지적하면 해당 룰 메시지를 읽고 모듈 의존을 수정 — impl→impl 의존이 없는지 재확인.)

- [ ] **Step 1.5: 권한 경계 확인 (스펙 §F)** — 로컬 기동 후 curl 로:

```bash
# 앱 admin 토큰(ROLE_ADMIN)으로 /api/admin/apps → 403 이어야 함
curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $APP_ADMIN_TOKEN" \
  http://localhost:8080/api/admin/apps   # expected: 403
# superadmin 토큰으로 /api/apps/{slug}/users/me → 403 이어야 함 (AppSlugVerificationFilter)
curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $SUPERADMIN_TOKEN" \
  http://localhost:8080/api/apps/tradelog/users/me   # expected: 403
```

- [ ] **Step 2: env 문서 + 스펙 정정** — `.env.example` (또는 README env 섹션) 에 아래 추가, 그리고 스펙 §C 를 "스펙 대비 의도적 변경 2건" (플랜 헤더) 내용으로 정정:

```bash
# --- 운영 콘솔 (admin) ---
ADMIN_EMAIL=            # 최초 기동 시 admin_users 시드 (비어 있으면 시드 안 함)
ADMIN_PASSWORD=         # 시드용 초기 비밀번호 (기동 후 삭제 권장)
# ADMIN_DB_URL=         # 미설정 시 DB_URL 의 currentSchema=admin 으로 자동 파생
# ADMIN_DB_USER=
# ADMIN_DB_PASSWORD=
```

- [ ] **Step 3: Commit**
```bash
git add -A
git commit -m "docs(admin): env 문서 + 스펙 상태 동기화"
```
