# 도그푸딩 FAQ

> **유형**: How-to · **독자**: Level 1 · **읽는 시간**: ~5분

> 셋업 가이드: [`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md)
> 함정 모음: [`도그푸딩 함정 모음 (사고 실록)`](./dogfood-pitfalls.md)
> 다이어그램: [`CI / CD 전체 플로우 — commit 부터 운영 반영까지`](../production/deploy/ci-cd-flow.md)

---

### Q1. "use this template" 으로 만든 파생 레포에서도 도그푸딩 해야 하나요?

**권장**. 이유:
- template 의 `setup.sh` / `cleanup.sh` 는 그대로 복사되지만 **GitHub Settings (Variables/Secrets) / Mac mini 의 SSH 키 / GHCR 패키지** 는 파생 레포가 직접 셋업해야 함.
- 첫 실배포 전에 도그푸딩으로 한 번 검증하면 실제 사용자 트래픽 들어오기 전에 모든 함정을 잡을 수 있음.

수행: `bash tools/dogfooding/setup.sh` → 검증 후 `bash tools/dogfooding/cleanup.sh`.

---

### Q2. cleanup 한 후 setup 다시 반복해도 되나요?

**OK**. 두 스크립트 모두 멱등성 보장:
- `setup.sh`: `gh secret set` 은 overwrite, `authorized_keys` 는 grep 후 append (중복 안 추가)
- `cleanup.sh`: 없는 자원 삭제 시도하면 `[WARN] ... 없음 (skip)` 만 출력하고 graceful

검증을 여러 번 돌려서 자동화 안정성 확인하는 워크플로우 권장.

---

### Q3. PAT 안 쓰고 `GITHUB_TOKEN` 으로만 가능한가요?

**현재 안 됨** (2026-04 기준). 이유는 [`pitfalls #5 ~ #7`](./dogfood-pitfalls.md):
- 첫 GHCR 패키지 생성 시 repo↔package 자동 연결이 안 되어 GITHUB_TOKEN 으로 push 시 403
- `workflow permissions = write` + `provenance/sbom: false` 다 적용해도 동일

GitHub 측에서 이 동작이 개선되면 PAT 폐기 가능 ([`I-10 결정 카드 의 재검토 트리거`](../production/deploy/decisions-infra.md)).

---

### Q4. `DEPLOY_ENABLED=false` 일 때도 GHA 비용이 드나요?

**거의 0원**:
- `ci.yml` (push, PR) 은 항상 동작 — 분 사용 (CI 5분/회)
- `deploy.yml` 은 `workflow_run` 으로 트리거되지만 gate 가 즉시 skip → **2~3초** 만에 종료, billed ~0.05분
- 즉 CI 비용은 그대로, deploy 는 사실상 무시 가능

template 상태에서 DEPLOY_ENABLED 기본 미설정인 이유.

---

### Q5. Mac mini 가 아니라 다른 호스트 (e.g. 클라우드 VPS) 면?

**가능**. 변경 포인트:
- `.env.dogfood` 의 `DEPLOY_HOST`, `DEPLOY_SSH_USER` 만 그 호스트에 맞춰 변경
- 그 호스트에 docker / kamal-proxy 가 기동 가능해야 함 (ARM64 이미지를 풀 수 있어야)
- 만약 x86 호스트면 `.github/workflows/deploy.yml` 의 `platforms: linux/arm64` 를 `linux/amd64` 로 변경 (template 결정 [`I-04`](../production/deploy/decisions-infra.md) 와 충돌하므로 별도 ADR 필요)
- Tailscale 로 도달 가능한 호스트면 OAuth 셋업 그대로
- Tailscale 안 쓰면 `tailscale-action` step 제거 + 호스트 public IP 또는 다른 VPN 셋업

---

### Q6. cleanup 후 Mac mini 의 `kamal-proxy` 컨테이너가 사라졌어요. 다음 배포가 또 setup 부터?

**네**. 다음 `setup.sh` + 첫 배포 시 kamal 이 자동으로 setup (kamal-proxy 컨테이너 + docker network) 다시 합니다 (~30초).

매번 setup 시간이 부담이면 `bash tools/dogfooding/cleanup.sh --keep-proxy` 로 컨테이너 유지. 메모리 ~15MB / 디스크 ~150MB 정도 추가 사용.

---

### Q7. `.env.dogfood` 가 실수로 commit 되면?

**즉시 행동**:
1. (가능하면) 새 commit 으로 파일 삭제 + push
2. **모든 키 즉시 폐기 + 재발급** ([`key-rotation.md`](../production/setup/key-rotation.md))
   - GitHub history 에 남으니 noting 안 됨 — 이미 노출됐다고 가정
3. (선택) `git filter-repo` 또는 BFG 로 history 재작성 + force push

**예방**:
- `.gitignore` 에 `.env.*` 가 잡고 있음
- `setup.sh` 시작 시 `git check-ignore` 로 검증 (실수 가능성 줄임)
- pre-commit hook 으로 `.env.dogfood` 패턴 차단 (option)

---

### Q8. 도그푸딩으로 띄운 컨테이너가 운영 트래픽도 받을 수 있나요?

**기술적으로 가능**:
- kamal-proxy 가 `Host: server.<도메인>` 헤더로 라우팅
- cloudflared tunnel 이 연결되어 있으면 외부에서 `https://server.<도메인>` 로 접근 가능

**도그푸딩 의도와 불일치 — 권장 안 함**:
- DB/secrets 가 dummy 또는 테스트 값일 수 있음
- 도그푸딩은 "한 사이클 검증" 용. 본격 운영은 별도 변수 / 별도 도메인 / 별도 인프라 권장

---

### Q9. setup.sh 가 중간에 fail 하면 어디서부터 재실행?

**처음부터 그냥 재실행 OK**. 멱등성 설계:
- prereq 점검: 매번 같음
- gh permissions write: 이미 write 면 no-op
- gha_deploy 키: 이미 있으면 skip
- Mac mini authorized_keys: grep 으로 중복 방지
- Variables/Secrets: 매번 overwrite (gh CLI 동작)

→ fail 한 step 부터 다시 시작하지 않고 그냥 `bash tools/dogfooding/setup.sh` 한 번 더.

---

### Q10. 외부 도메인 없이 localhost 로 검증만 가능?

**Tailscale IP 로 가능**:
```bash
# 본인 Tailscale 디바이스에서
curl -H "Host: server.<도메인>" http://100.X.X.X/actuator/health/liveness
```

도메인 (PUBLIC_HOSTNAME) 은 placeholder 라도 상관없음 — kamal-proxy 의 host-based routing 에 사용되므로 curl 의 Host 헤더와 일치하면 됨. 외부 인터넷 접근만 cloudflared 필요.

---

### Q11. 11회 시도했다는데 다시 셋업하면 또 11번 걸리나요?

**1번에 끝납니다**. 11회 함정 중 8개는 워크플로우/스크립트 코드에 박혀 영구 회피, 3개는 외부 발급 (PAT / Tailscale OAuth / DB URL 형식) 이고 가이드 §3 에 정확한 절차 + 함정 강조.

→ 가이드 따라 1번에 setup → 자동 trigger → 배포 success 가 정상 흐름.

(만약 새로운 함정 만나면 [`pitfalls.md`](./dogfood-pitfalls.md) §"새 함정 발견 시" 절차로 추가 PR.)

---

## 개요

도그푸딩 환경 셋업 시 자주 묻는 질문 11 개 모음. 본 가이드 ([`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md)) 를 따라가다 막히는 지점별 해결 포인터.

---

## 더 궁금한 게 있다면

- [`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md) — 정상 흐름
- [`도그푸딩 함정 모음 (사고 실록)`](./dogfood-pitfalls.md) — 11회 함정 자세히
- [`CI / CD 전체 플로우 — commit 부터 운영 반영까지`](../production/deploy/ci-cd-flow.md) — 다이어그램
- [`키 교체 절차 (Key Rotation)`](../production/setup/key-rotation.md) — 키 교체
- [`인프라 결정 기록 (Decisions — Infrastructure)`](../production/deploy/decisions-infra.md) — 결정 근거 (I-09 ~ I-14)

---

## 다음 단계

- 함정 사례 검색: [`도그푸딩 함정 모음 (사고 실록)`](./dogfood-pitfalls.md) — 실제 겪은 11 개 사고 기록
- 본 가이드 전체: [`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md)
