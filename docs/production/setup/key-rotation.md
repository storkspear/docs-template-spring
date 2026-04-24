# 키 교체 절차 (Key Rotation)

> **유형**: How-to · **독자**: Level 2.5 · **읽는 시간**: ~5분

**설계 근거**: [`ADR-006 (HS256 JWT)`](../../philosophy/adr-006-hs256-jwt.md) · [`ADR-007 (솔로 친화적 운영)`](../../philosophy/adr-007-solo-friendly-operations.md)

> 결정 근거: [`인프라 결정 기록 (Decisions — Infrastructure) I-10, I-14`](../deploy/decisions-infra.md)
> 셋업 가이드: [`도그푸딩 환경 셋업 가이드`](../../start/dogfood-setup.md)

---

## 개요

도그푸딩 / 운영 배포에 사용되는 외부 서비스 키들의 **권장 교체 주기 + 즉시 폐기 절차**.

원칙:
- **노출 시 즉시 폐기 + 재발급** — 채팅 / public commit / 로그 출력 등 어떤 경로로든 평문이 외부에 보였다면 무조건.
- **주기적 rotation** — 노출 없어도 정해진 주기마다.
- **rotation 후 setup.sh 재실행** — 새 키가 GitHub Secrets 에 자동 등록됨 (덮어쓰기, 재배포 즉시 가능).

---

## 키 종류 + 교체 주기

| 키 | 권장 주기 | 즉시 폐기 트리거 |
|---|---|---|
| **GitHub PAT (`GHCR_TOKEN`)** | 90일 (PAT classic 의 권장 expiration) | 채팅/공개 노출, repo 외부 인원 노출, 의심 활동 감지 |
| **Tailscale OAuth client** | 6개월 또는 사용 안 할 때 | 노출, ACL 변경 후 scope 재정렬 필요 시 |
| **Mac mini SSH 키 (`gha_deploy`)** | 1년 또는 노출 시 | 노출, 다른 사람이 본 적 있음 |
| **Supabase password** | 6개월 또는 노출 시 | 노출, password 정책 변경 |
| **JWT_SECRET** | 6개월 또는 노출 시 | 노출, 사용자 토큰 무효화 필요 |
| **로컬 키 (`~/.ssh/macmini`)** | 폐기 권장 안 함 (개인 머신 전용) | 머신 도난, 공유 |

---

## 즉시 폐기 절차

### 1. GitHub PAT (Personal Access Token Classic)

**폐기**:
1. https://github.com/settings/tokens
2. 노출된 PAT 옆 **"Delete"** 클릭
3. 확인

**새 발급**:
- [`도그푸딩 환경 셋업 가이드`](../../start/dogfood-setup.md) 의 절차 따름
- 새 토큰 값 → `.env.dogfood` 의 `GHCR_TOKEN` 갱신
- `bash tools/dogfooding/setup.sh` 실행 (멱등 — 기존 secret overwrite)

**확인**:
- 다음 배포 (`git push` 또는 `gh workflow run deploy.yml`) 가 성공하면 새 키 정상 동작.

---

### 2. Tailscale OAuth client

**폐기**:
1. https://login.tailscale.com/admin/settings/oauth
2. 노출된 client 옆 메뉴 (⋯) → **Delete**
3. (선택) 같은 client 로 로그인된 ephemeral devices 가 admin → Machines 에 남아있다면 expired 표시되므로 별도 정리 불필요

**새 발급**:
- [`도그푸딩 환경 셋업 가이드`](../../start/dogfood-setup.md) 의 절차 따름
- ⚠️ **scope 2개 모두 체크 필수** (Devices Core Write + Auth Keys Write, 둘 다 tag:ci)
- ACL 의 `tagOwners` 가 이미 정의되어 있으면 그대로 사용 (재정의 불필요)
- 새 Client ID + Secret → `.env.dogfood` 의 `TS_OAUTH_CLIENT_ID` / `TS_OAUTH_SECRET` 갱신
- `bash tools/dogfooding/setup.sh` 실행

---

### 3. Mac mini SSH 키 (`gha_deploy`)

**폐기**:
1. Mac mini 의 `~/.ssh/authorized_keys` 에서 `gha-deploy@<service>` 줄 삭제:
   ```bash
   ssh -i ~/.ssh/macmini storkspear@100.X.X.X \
     "sed -i '' '/gha-deploy@spring-backend-template/d' ~/.ssh/authorized_keys"
   ```
2. 로컬에서 옛 키 파일 삭제:
   ```bash
   rm ~/.ssh/gha_deploy ~/.ssh/gha_deploy.pub
   ```

**새 발급**:
- `setup.sh` 가 자동 처리:
  - `~/.ssh/gha_deploy` 가 없으면 새로 발급 (`ssh-keygen -t ed25519 -N ""`)
  - 공개키를 Mac mini `authorized_keys` 에 등록
  - 비밀키 내용을 GitHub Secret `SSH_PRIVATE_KEY` 로 등록 (overwrite)

→ 사용자 액션은 그냥 `bash tools/dogfooding/setup.sh` 한 줄.

---

### 4. Supabase password

**폐기 + 재발급** (한 번에):
1. Supabase Dashboard → Settings → Database → "Reset database password"
2. 새 password 표시 → 즉시 복사
3. `.env.dogfood` 의 `DB_PASSWORD` 갱신 (DB_URL / DB_USER 는 그대로)
4. `bash tools/dogfooding/setup.sh` 실행

⚠️ 현재 운영 컨테이너가 옛 password 로 연결 중이면, 새 password 적용 후 재배포 (또는 컨테이너 재기동) 필요.

---

### 5. `JWT_SECRET`

**폐기**:
- 단순히 secret 값을 새로 만들면 됨. 기존 사용자의 발급된 JWT 토큰은 모두 무효화됨 (재로그인 강제).

**재발급**:
1. `.env.dogfood` 의 `JWT_SECRET` 을 비우거나:
   ```bash
   openssl rand -base64 48 | tr -d '\n'
   ```
   결과로 직접 채움.
2. `bash tools/dogfooding/setup.sh` 실행 (`JWT_SECRET` 비어있으면 자동 생성)

---

## 노출이 의심되는 즉시 행동 체크리스트

```
□ 노출된 키 종류 확인 (위 표)
□ 즉시 폐기 (위 절차)
□ 새 키 발급
□ .env.dogfood 갱신
□ bash tools/dogfooding/setup.sh 재실행 (GitHub Secrets 갱신)
□ 다음 배포 성공 확인
□ (외부 서비스의) audit log 확인 — 폐기 전 의심 활동 있었나
□ git history grep — 노출 키가 commit 에 들어간 적 없나 (있으면 history 재작성 검토)
```

---

## 파생 레포 운영 시 추가 권장

- **PAT expiration 알림**: GitHub Settings 의 expiration 알림 이메일 활성화
- **Tailscale audit log**: 정기 검토 (admin → Logs)
- **password manager** 사용 — `.env.dogfood` 같은 파일 대신
- **dependabot / renovate** 으로 GHA action version 자동 PR (예: `tailscale/github-action@v4` 새 패치)

---

## 트러블슈팅

### 키 교체 후 앱이 기동 안 됨

- **원인**: 새 키가 모든 곳에 반영 안 됨 (GitHub Secrets / `.env.prod` / Supabase 대시보드 등 중 누락)
- **확인**: `docker logs <container>` 에서 authentication/JWT 관련 예외 검색
- **조치**: 누락된 위치에 새 키 주입 + 재배포

### 파생 레포 간 키 동기화

파생 레포마다 각자의 시크릿 관리. 템플릿 키 교체해도 파생 레포는 자기 키를 따로 교체해야 함.

## 다음 단계

- 인시던트 회고: [`운영 런북 (Runbook)`](../deploy/runbook.md) 의 "인시던트 회고 템플릿"
- 장애 대응 절차: [`운영 런북 (Runbook)`](../deploy/runbook.md)
- 관측성 알림 설정: [`운영 모니터링 셋업 가이드`](./monitoring-setup.md)

---

## 관련 문서

- [`도그푸딩 환경 셋업 가이드`](../../start/dogfood-setup.md) — 외부 리소스 발급 절차
- [`인프라 결정 기록 (Decisions — Infrastructure) I-10, I-14`](../deploy/decisions-infra.md) — PAT / Tailscale OAuth 결정 근거
- [`도그푸딩 함정 모음 (사고 실록)`](../../start/dogfood-pitfalls.md) — 키 관련 함정
