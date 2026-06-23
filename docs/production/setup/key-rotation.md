# 키 교체 절차 (Key Rotation)

> **유형**: How-to · **독자**: 운영자 (Level 2) · **읽는 시간**: ~6분

**설계 근거**: [`ADR-006 · HS256 JWT`](../../philosophy/adr-006-hs256-jwt.md) · [`ADR-007 · 솔로 친화적 운영`](../../philosophy/adr-007-solo-friendly-operations.md)

> 키 발급 통합: [`운영 키 발급 통합 가이드`](./key-issuance.md) — 각 키의 *최초 발급 절차*. 이 문서는 *재발급·폐기* 만 다룹니다.
> 4-Stage 동기화: [`Secret Chain 4-Stage 동기화`](./secret-chain-4stage.md) — 교체한 키가 컨테이너에 주입되는 4 곳 경로
> 결정 근거: [`인프라 결정 기록 (Decisions — Infrastructure)`](../deploy/decisions-infra.md) — I-10 (GHCR_TOKEN) · I-14 (Tailscale OAuth)

---

## 개요

운영에 쓰이는 자격(JWT_SECRET·DB·GHCR_TOKEN·SSH·Tailscale 등)을 **주기적으로 교체하거나 노출 시 즉시 폐기·재발급** 하는 절차입니다. 발급 자체는 [`운영 키 발급 통합 가이드`](./key-issuance.md) 가 다루고, 여기서는 *기존 값을 새 값으로 갈아끼우는* 흐름만 다룹니다.

원칙은 세 가지예요.

- **노출 시 즉시 폐기 + 재발급** — 채팅·public commit·로그 출력 등 어떤 경로로든 평문이 외부에 보였다면 무조건 폐기합니다.
- **주기적 rotation** — 노출이 없어도 정해진 주기마다 갱신합니다.
- **재발급 후 `prod init` 재실행** — 새 값을 `.env.prod` 에 채우고 `<repo> prod init` 을 다시 돌리면 GitHub Secrets 가 덮어쓰기로 갱신됩니다. 다음 배포부터 새 키가 주입돼요.

> 이 문서는 *파생 레포 운영자* 기준입니다. 명령은 `<repo> prod init`(= `tools/init-prod.sh`)·`<repo> prod deploy` 처럼 적었어요. `<repo>` 자리에는 본인 레포 별칭(예: `myapp-backend`)이 들어갑니다.

---

## 키 종류 + 교체 주기

| 키 | 권장 주기 | 즉시 폐기 트리거 |
|---|---|---|
| **GitHub PAT (`GHCR_TOKEN`)** | 90일 (classic PAT 권장 expiration) | 채팅·공개 노출, repo 외부 인원 노출, 의심 활동 감지 |
| **Tailscale OAuth client** | 6개월 또는 사용 종료 시 | 노출, ACL scope 재정렬 필요 시 |
| **운영 서버 SSH 키 (`SSH_PRIVATE_KEY`)** | 1년 또는 노출 시 | 노출, 제3자가 본 적 있음 |
| **DB password (`DB_PASSWORD`)** | 6개월 또는 노출 시 | 노출, DB password 정책 변경 |
| **`JWT_SECRET`** | 6개월 또는 노출 시 | 노출, 발급된 access token 전면 무효화가 필요할 때 |
| **PortOne webhook secret** | 노출 시 | 노출, PortOne 콘솔에서 secret 재설정 시 |

> `JWT_SECRET` 은 dev·prod 가 각각 별도 값입니다. prod 는 `JWT_SECRET`, dev 는 `JWT_SECRET_DEV` 로 GitHub Secrets 에 분리 저장돼요 ([`Secret Chain 4-Stage §3`](./secret-chain-4stage.md)). 한쪽을 교체해도 다른 쪽은 그대로입니다.

---

## 공통 흐름 — 재발급 후 적용

키 종류와 무관하게, 폐기·재발급 후 운영에 반영하는 흐름은 같아요.

```
옛 키 폐기 (외부 콘솔)
   ↓
새 키 발급 → .env.prod 의 해당 변수 갱신
   ↓
<repo> prod init        (GitHub Secrets 덮어쓰기 push)
   ↓
<repo> prod deploy      (blue/green 으로 새 컨테이너에 주입)
   ↓
<repo> prod test        (배포 후 health 확인)
```

`<repo> prod init` 은 `.env.prod` 의 REQUIRED 키를 항상 GitHub Secrets 로 다시 push 하고, `gh secret set` 이 overwrite 라 재실행은 멱등합니다 ([`키 발급 통합 §5`](./key-issuance.md#5-발급-후--4-stage-동기화)). 단 `JWT_SECRET`·`GHCR_TOKEN` 처럼 `config/deploy.yml`·`.kamal/secrets.example`·`deploy.yml` 에 이미 등록된 키는 4 곳 동기화를 새로 손댈 필요가 없어요 — *값만* 바뀌고 *키 이름* 은 그대로니까요.

---

## 즉시 폐기 절차

### 1. GitHub PAT (`GHCR_TOKEN`)

**폐기**: [github.com/settings/tokens](https://github.com/settings/tokens) 에서 노출된 PAT 옆 *Delete* 를 누르고 확인합니다.

**재발급**: [`키 발급 통합 §3.1`](./key-issuance.md#31-ghcr_token--github-personal-access-token-classic) 의 절차로 새 classic PAT 를 발급해요. 네 scope(`write:packages`·`read:packages`·`delete:packages`·`repo`)를 모두 체크합니다.

**적용**:
1. 새 토큰 값 → `.env.prod` 의 `GHCR_TOKEN` 갱신
2. `<repo> prod init` 실행 (GitHub Secrets overwrite)

**확인**: 다음 배포(`<repo> prod deploy` 또는 main push)의 GHCR push 가 성공하면 새 키가 정상 동작합니다.

### 2. Tailscale OAuth client

**폐기**: [login.tailscale.com/admin/settings/oauth](https://login.tailscale.com/admin/settings/oauth) 에서 노출된 client 옆 메뉴(⋯) → *Delete*. 같은 client 로 join 했던 ephemeral device 는 admin → Machines 에서 자동으로 expired 표시되므로 별도 정리가 필요 없어요.

**재발급**: [`키 발급 통합 §4.4`](./key-issuance.md#44-tailscale-oauth-deploy_enabledtrue-시-필수) 의 절차로 새 client 를 발급합니다.
- ⚠️ scope 2개를 모두 체크해야 해요 — `Devices → Core → Write` + `Keys → Auth Keys → Write`, 둘 다 `tag:ci`. 하나라도 빠지면 배포 시 403 이 떠요 ([`I-14`](../deploy/decisions-infra.md)).
- ACL 의 `tagOwners` 가 이미 정의돼 있으면 그대로 두면 됩니다 (재정의 불필요).

**적용**:
1. 새 Client ID + Secret → `.env.prod` 의 `TS_OAUTH_CLIENT_ID`·`TS_OAUTH_SECRET` 갱신
2. `<repo> prod init` 실행

### 3. 운영 서버 SSH 키 (`SSH_PRIVATE_KEY`)

**폐기**: 운영 서버(Mac mini 등)의 `~/.ssh/authorized_keys` 에서 옛 공개키 줄을 삭제합니다.

```bash
ssh <운영서버계정>@<운영서버주소> \
  "sed -i '' '/deploy@/d' ~/.ssh/authorized_keys"
# Linux 운영 서버라면 sed -i '/deploy@/d' (BSD/GNU sed 차이)
```

로컬에 보관한 옛 private/public 키 파일도 함께 지워요.

**재발급**: [`키 발급 통합 §3.2`](./key-issuance.md#32-ssh_private_key--운영-서버-접근-키) 의 절차로 새 ed25519 키를 발급합니다 (passphrase 없이 — Kamal 이 비대화형으로 사용).

```bash
ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -C "deploy@$(hostname)" -N ""
```

**적용**:
1. 새 공개키를 운영 서버 `authorized_keys` 에 등록
2. 새 private key **전체 내용**(BEGIN/END 라인 포함)을 `.env.prod` 의 `SSH_PRIVATE_KEY` 에 갱신
3. `<repo> prod init` 실행

**확인**: `verify-server.sh` Step 3 (SSH + Tailscale) 이 PASS 면 정상입니다.

### 4. DB password (`DB_PASSWORD`)

**폐기 + 재발급** (한 번에):
1. DB provider 콘솔에서 password 를 reset 합니다. Supabase 라면 *Settings* → *Database* → *Reset database password*.
2. 표시되는 새 password 를 즉시 복사
3. `.env.prod` 의 `DB_PASSWORD` 갱신 (`DB_URL`·`DB_USER` 는 그대로)
4. `<repo> prod init` 실행

⚠️ 현재 운영 컨테이너가 옛 password 로 연결 중이라면, 새 password 적용 후 `<repo> prod deploy`(또는 재기동)로 컨테이너를 갱신해야 끊김이 풀려요. `DB_PASSWORD` 는 외부 DB 발급값이라 `prod init` 이 자동 생성하지 않습니다 — 반드시 콘솔 reset 값을 직접 채워야 해요.

### 5. `JWT_SECRET`

**폐기**: 별도 콘솔 폐기가 없어요. 새 값으로 갈아끼우는 순간 옛 서명 키로 발급된 access token 이 검증에 실패합니다.

**재발급**: `prod init` 1회차가 `openssl rand -base64 64` 로 자동 생성하지만, 직접 새 값을 만들려면 같은 명령을 씁니다.

```bash
openssl rand -base64 64 | tr -d '\n'
```

**적용**:
1. 결과값 → `.env.prod` 의 `JWT_SECRET` 갱신 (비워두면 `prod init` 이 자동 재생성)
2. `<repo> prod init` → `<repo> prod deploy`

**무효화 범위 — access token 만, refresh token 은 살아있어요.** 서명 키는 HS256 access token 에만 쓰입니다. access token 은 새 키로 검증에 실패해 즉시 무효가 돼요. 반면 refresh token 은 `SecureRandom` 으로 만든 *불투명(opaque) 문자열* 이고 DB 에 SHA-256 해시로만 저장돼서, `JWT_SECRET` 과 무관해요. 그래서 유효한 refresh token 을 가진 클라이언트는 재로그인 없이 `/auth/refresh` 로 새 access token 을 곧바로 받습니다. *모든 사용자에게 강제 재로그인* 을 걸려면 `JWT_SECRET` 교체만으로는 부족하고, refresh token 까지 별도로 일괄 revoke 해야 해요.

> **blue/green 전환 중 주의.** `prod deploy` 는 blue(옛 컨테이너)가 도는 동안 green(새 컨테이너)을 띄우고 cutover 합니다. 두 컨테이너가 잠깐 공존하는 구간에 옛 키의 blue 와 새 키의 green 이 서로 다른 서명 키를 쓰므로, 막 발급된 access token 이 다른 쪽 컨테이너로 라우팅되면 401 이 날 수 있어요. access token TTL 이 15분이라 cutover 직후 짧은 구간에만 영향이 있고, 클라이언트가 refresh 로 곧 새 토큰을 받으므로 자연 회복됩니다. 사용자 영향을 줄이려면 트래픽이 낮은 시간대에 교체하세요.

### 6. PortOne webhook secret (`APP_PAYMENT_PORTONE_WEBHOOK_SECRET`)

**폐기 + 재발급**: PortOne 콘솔에서 webhook secret 을 재설정하거나, 직접 새 값을 만듭니다.

```bash
openssl rand -base64 32 | tr -d '\n=+/' | head -c 32
```

**적용**:
1. PortOne 콘솔의 webhook secret 과 `.env.prod` 의 값을 **동일하게** 맞춰요 (서버가 이 값으로 webhook 서명을 HMAC 검증).
2. `<repo> prod init` 실행

⚠️ PortOne 키는 *전부 아니면 전무* 규칙이에요. `APP_PAYMENT_PORTONE_API_V1_KEY`·`_API_V1_SECRET`·`_WEBHOOK_SECRET` 중 하나만 채워진 채로 두면 `PortOneProdConfigGuard` 가 부팅을 차단합니다 ([`Secret Chain 4-Stage §4`](./secret-chain-4stage.md#4-자주-누락되는-케이스)). 셋을 함께 다뤄요.

---

## 노출이 의심될 때 즉시 행동 체크리스트

```
□ 노출된 키 종류 확인 (위 표)
□ 즉시 폐기 (해당 절차)
□ 새 키 발급 → .env.prod 갱신
□ <repo> prod init  (GitHub Secrets 덮어쓰기)
□ <repo> prod deploy → <repo> prod test  (배포 + health 확인)
□ (외부 서비스의) audit log 확인 — 폐기 전 의심 활동이 있었나
□ git history grep — 노출 키가 commit 에 들어간 적 없나 (있으면 history 재작성 검토)
□ JWT_SECRET 노출이면 — refresh token 일괄 revoke 도 검토 (access 만으론 강제 재로그인 안 됨)
```

---

## 파생 레포 운영 시 추가 권장

- **PAT expiration 알림** — GitHub Settings 의 expiration 만료 알림 이메일을 켜 두면 90일 주기를 놓치지 않아요.
- **Tailscale audit log** — admin → Logs 를 정기 검토합니다.
- **password manager** — `.env.prod` 같은 파일 대신 password manager 에 원본을 보관합니다.
- **dependabot / renovate** — GHA action 버전(예: `tailscale/github-action@v4`)을 자동 PR 로 추적합니다.

---

## 트러블슈팅

### 키 교체 후 앱이 기동 안 됨

- **원인**: 새 키가 모든 경로에 반영되지 않았어요 (GitHub Secrets·`.env.prod`·외부 콘솔 중 누락). 4-Stage 동기화 한 곳이 빠진 경우가 많아요.
- **확인**: `docker logs <container>` 에서 authentication·JWT·HikariCP 관련 예외를 검색합니다.
- **조치**: 누락된 위치에 새 키를 주입한 뒤 `<repo> prod deploy` 로 재배포해요. 4 곳 매핑은 [`Secret Chain 4-Stage`](./secret-chain-4stage.md) 를 참고하세요.

### 교체 직후 일부 요청이 401

`JWT_SECRET` 교체 후 blue/green cutover 구간에서 옛 키로 발급된 access token 이 새 컨테이너로 가면 검증에 실패해요. cutover 가 끝나면 자연 해소되고, 클라이언트는 refresh 로 새 토큰을 받습니다. 지속적으로 401 이 난다면 두 컨테이너가 모두 새 키를 쓰는지(`<repo> prod status`)와 GitHub Secrets 갱신 여부를 확인하세요.

### 파생 레포 간 키 동기화

파생 레포마다 각자의 secret 을 따로 관리해요. 템플릿 레포의 키를 교체해도 파생 레포는 자기 키를 별도로 교체해야 합니다.

---

## 다음 단계

- 인시던트 회고: [`운영 런북 (Runbook)`](../deploy/runbook.md#에스컬레이션과-인시던트-회고) 의 회고 6단계
- 장애 대응 절차: [`운영 런북 (Runbook)`](../deploy/runbook.md)
- 관측성 알림 설정: [`운영 모니터링 셋업 가이드`](./monitoring-setup.md)

---

## 관련 문서

- [`운영 키 발급 통합 가이드`](./key-issuance.md) — 각 키의 최초 발급 절차
- [`Secret Chain 4-Stage 동기화`](./secret-chain-4stage.md) — 교체한 키가 컨테이너에 주입되는 4 곳
- [`인프라 결정 기록 (Decisions — Infrastructure)`](../deploy/decisions-infra.md) — I-10 (GHCR_TOKEN) · I-14 (Tailscale OAuth) 결정 근거
- [`도그푸딩 함정 모음 (사고 실록)`](../../start/dogfood-pitfalls.md) — 키 관련 함정
