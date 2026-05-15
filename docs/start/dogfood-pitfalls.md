# 도그푸딩 함정 모음 (사고 실록)

> **유형**: How-to · **독자**: Level 1 · **읽는 시간**: ~10분

> 결정 근거: [`인프라 결정 기록 (Decisions — Infrastructure) I-09 ~ I-14`](../production/deploy/decisions-infra.md)
> 정상 흐름: [`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md)
> 시간 순 narrative: [`도그푸딩 walkthrough`](./dogfood-walkthrough.md)
> 전체 플로우: [`CI / CD 전체 플로우 — commit 부터 운영 반영까지`](../production/deploy/ci-cd-flow.md)

---

## 개요

template 첫 도그푸딩 배포에서 **11번 시도** 후 성공 + 이후 JDK 호환성 함정 1건 추가 = **총 12 함정** 이에요. 매 시도마다 새 에러 한 개씩 나왔어요. 이 문서는 그 실록 — **에러 메시지로 검색해서 원인 + 해결을 빠르게 찾기 위한 reference** 예요. 정상 흐름 설명은 가이드에서 보세요.

자동화된 `tools/dogfooding/setup.sh` + `cleanup.sh` 가 아래 함정 대부분을 회피하지만, 외부 서비스 (Tailscale ACL, GitHub PAT scope) 의 **사람 손이 가야 하는 부분에서 같은 에러를 다시 만날 수 있어요**. 그때 이 문서를 보세요.

---

## 한눈에 — 함정 12개 표

| # | 단계 | 증상 (에러 메시지 검색용 키워드) | 원인 한 줄 | 해결 한 줄 | 관련 commit |
|---|---|---|---|---|---|
| **1** | Locate jar | `[ -f ]` false / multi-line $JAR | `bootstrap.jar` + `bootstrap-plain.jar` 양쪽 매치 | artifact path 좁힘 + `find -not -name '*-plain.jar' \| head -1` | `3af3e89` |
| **2** | Cleanup step | `Package not found` | 첫 배포라 GHCR 패키지 미존재 | cleanup step 에 `continue-on-error: true` | `3af3e89` |
| **3** | Tailscale | `403 calling actor does not have enough permissions` (action v2) | `tailscale/github-action@v2` 가 옛 1.42.0 다운로드 → 신 OAuth API 미호환 | `tailscale/github-action@v4` 업그레이드 | `41e076d` |
| **4** | Tailscale | 같은 `403` (action v4 인데도) | OAuth client scope **`auth_keys`** 미체크 | OAuth client 재발급, 2 scope 둘 다 (Devices Core Write **+ Auth Keys Write**) + tag:ci | `26ff9e0` |
| **5** | GHCR push | `403 Forbidden HEAD blob` | repo workflow permissions 가 read-only default | `gh api PUT actions/permissions/workflow default_workflow_permissions=write` | `8bbb8ea` |
| **6** | GHCR push | 같은 `403` (write 인데도) | `provenance` + `sbom` attestation manifest 가 추가 권한 요구 | `provenance: false`, `sbom: false`, cache export 제거 | `777218d` |
| **7** | GHCR push | 또 같은 `403` | `GITHUB_TOKEN` 자체로 첫 GHCR 패키지 생성 권한 부족 (repo↔package 자동 연결 안 됨) | PAT (write/read/delete:packages) 발급 → `GHCR_TOKEN` secret | `5b2eb7a` |
| **8** | kamal SSH | `ENOTTY ... root@... password:` | `config/deploy.yml` 의 `ssh.user` ENV default `root` → root SSH 비활성 → password 프롬프트 → 비대화형 | `DEPLOY_SSH_USER=storkspear` GHA Variable + env 주입 | `d765372` |
| **9** | kamal docker login | `flag needs argument: 'p' in -p` | `.kamal/secrets.example` 가 `$GHCR_TOKEN` 참조하는데 GHA env 에 `GHCR_TOKEN` 미주입 | env 블록에 `GHCR_TOKEN: ${{ secrets.GHCR_TOKEN }}` 추가 | `c312bb5` |
| **10a** | kamal pull | 이미지 경로 `ghcr.io/ghcr.io/owner/repo:<sha>` 이중 prefix | `KAMAL_IMAGE` 에 `ghcr.io/` 까지 넣음 → kamal `registry.server` 가 자동 prefix → 이중화 | `KAMAL_IMAGE` 를 `owner/repo` 만 (ghcr.io 제거) | `d610cb5` |
| **10b** | kamal inspect | `Image ... is missing the 'service' label` | 직접 `docker buildx` 빌드라 kamal 자동 부여 label 없음 | `docker/build-push-action` 에 `labels: \| service=${KAMAL_SERVICE_NAME}` | `d610cb5` |
| **11** | Spring 기동 | `No suitable driver` for jdbcUrl=postgresql://... | `DB_URL` 이 `postgresql://...` (jdbc: prefix 누락) + user/password inline | `DB_URL = jdbc:postgresql://host:port/db` (host:port/db 만), `DB_USER`/`DB_PASSWORD` 별도 | `5c54b86` |
| **12** | Gradle 빌드 | `Unsupported class file major version 70` | 시스템 JDK 가 26 (또는 17·26 만 설치) — Gradle/Groovy 가 class file major 70 (JDK 26) 을 못 읽음 | `brew install openjdk@21` + `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home` | init-prod.sh / init-local.sh prereq 가 `21 ≤ JAVA < 26` 로 즉시 거부 (`Java 21~25 필요`) |

> 표 안의 "원인 한 줄 / 해결 한 줄" 컬럼은 *명사구 reference* 형식이라 의도적으로 압축돼 있어요 ([`STYLE_GUIDE §3 의 표 안 명사구 허용 규정`](../reference/STYLE_GUIDE.md)).

---

## 함정별 자세한 분석

### #1. jar locate 의 multi-line 매치

**증상 (deploy.yml `Locate jar` step)**:
```
ERROR: jar 파일을 찾지 못함
ls: cannot access 'bootstrap/build/libs/': No such file or directory
_artifact/:
total 82896
-rw-r--r-- bootstrap-plain.jar    11825 bytes
-rw-r--r-- bootstrap.jar       84861270 bytes
```

**왜 발생했나요?**
gradle `bootJar` 태스크는 fat jar (`bootstrap.jar`) 와 plain jar (`bootstrap-plain.jar`) 두 개를 만들어요. CI 가 둘 다 artifact 로 업로드 → deploy 측에서 `ls _artifact/*.jar` 가 두 줄 출력 → `JAR=$(...)` 변수에 multi-line 이 들어감 → `[ ! -f "$JAR" ]` 체크가 multi-line 문자열을 단일 파일 경로로 보려다 false → ERROR. 또한 처음 짠 `JAR=$(ls A 2>/dev/null || ls B | head -1)` 에서 `head -1` 이 `||` 뒤에만 적용되는 함정도 동시에 발생했어요.

**해결 방법**:
1. `ci.yml` upload-artifact path 를 `bootstrap.jar` 로 좁혔어요 (plain 제외)
2. `deploy.yml` Locate step 을 `find ... -not -name '*-plain.jar' | head -1` 로 안전화했어요

자동화 적용 — `setup.sh` 와 무관하고, 워크플로우 코드 자체에 박혀 있어요. 새 fork 에서 다시 발생하지 않아요.

---

### #2. cleanup step 의 첫 배포 케이스

**증상**: `actions/delete-package-versions@v5` step 에서 `get versions API failed. Package not found.`

**왜 발생했나요?** 첫 배포 전엔 GHCR 에 패키지 자체가 없어요 (cleanup 할 게 없는 상태). 액션이 fail 처리해 버려요.

**해결 방법**: cleanup step 에 `continue-on-error: true` 추가. 자동화 적용은 워크플로우 코드에 박혀 있어요.

---

### #3 + #4. Tailscale OAuth — action 버전 + scope 함정

**증상 #3** (action v2 사용 시):
```
Status: 403, Message: "calling actor does not have enough permissions to perform this function"
```

`tailscale/github-action@v2` 는 내부적으로 옛 tailscale 1.42.0 (2023년) 을 다운로드해요. 신규 OAuth API 와 호환이 안 돼요.

**증상 #4** (action v4 인데도 같은 403):
같은 403 메시지지만, 이번엔 action 버전이 아니라 **OAuth client 의 scope** 부족이 원인이에요.

**왜 발생했나요?**
처음 OAuth client 만들 때 `Devices → Core → Write` 만 체크하고 끝내는 경우가 많아요. 그런데 `tailscale/github-action` 이 ephemeral device 등록을 위해 `tailscale up --authkey=...` 를 호출하는데, **auth key 발급 권한이 별도 scope** 인 `Keys → Auth Keys → Write` 에 있어요. 둘 중 하나만 있어도 403 이 나요.

**해결 방법**: OAuth client 를 새로 발급하세요. `Devices → Core → Write` **그리고** `Keys → Auth Keys → Write` 둘 다 체크하고, 두 scope 모두 `tag:ci` 를 부여해요.

**또 ACL 이슈도 있어요**: `tag:ci` 가 ACL 의 `tagOwners` 에 정의가 안 돼 있으면 OAuth 화면의 "Add tags" 드롭다운이 비활성화돼요. ACL HuJSON 에 다음을 추가하세요.
```hujson
"tagOwners": {
    "tag:ci": ["autogroup:admin"],
},
```

자동화 한계 — setup.sh 가 OAuth client 자체는 만들지 못해요 (외부 서비스 OAuth 흐름이라서). 가이드 §3.2 에서 정확한 절차를 안내해요.

---

### #5 + #6 + #7. GHCR push 403 — 세 단계 권한 함정

**증상 (모두 같음)**:
```
ERROR: failed to push ghcr.io/<owner>/<repo>:<sha>:
unexpected status from HEAD request to .../blobs/sha256:...: 403 Forbidden
```

**원인이 세 단계로 누적돼요**:

#### #5 — repo workflow permissions read-only
deploy.yml 에 `permissions: packages: write` 를 명시했어도 **repo 의 default workflow permissions** 가 read-only 면 무시되거나 일부만 적용돼요. 다음 명령으로 확인하세요.
```bash
gh api repos/<owner>/<repo>/actions/permissions/workflow
# {"default_workflow_permissions":"read", ...}
```
해결 — API 로 write 변경
```bash
gh api -X PUT .../actions/permissions/workflow \
  -f default_workflow_permissions=write \
  -F can_approve_pull_request_reviews=false
```

#### #6 — provenance/sbom attestation 추가 권한
`docker/build-push-action@v5` 의 default 가 `provenance: true` + `sbom: true` 예요. attestation manifest 를 별도 blob 으로 push 하는데 이게 추가 권한을 요구해요. 해결은 둘 다 `false` 로 설정하는 거예요.

#### #7 — GITHUB_TOKEN 자체의 한계
위 #5 + #6 조치 후에도 같은 403 이 나요. 결국 **GitHub 의 알려진 이슈** 에 부딪힌 거예요 — 첫 GHCR 패키지 생성 시 repo↔package 의 자동 연결이 안 돼서 GITHUB_TOKEN 의 권한이 부족해요. PAT (Personal Access Token) 으로 우회해야 해요.

해결 — PAT (Classic) 를 발급해요. scope 는 `write:packages` + `read:packages` + `delete:packages` + `repo` 가 필요해요. `GHCR_TOKEN` secret 으로 등록 후 docker/login + KAMAL_REGISTRY_PASSWORD + delete-package-versions 셋 모두 PAT 를 사용해요.

자동화 적용 — setup.sh 가 #5 (workflow permissions write) 를 자동 처리해요. PAT (#7) 는 외부 발급이 필요해요 — 가이드 §3.1 에서 안내해요.

---

### #8. kamal SSH 가 root 시도

**증상**:
```
INFO Running docker login ghcr.io ... on 100.X.X.X
root@100.X.X.X's password:
ERROR (Errno::ENOTTY): Inappropriate ioctl for device
```

**왜 발생했나요?** `config/deploy.yml` 의 ssh 설정 때문이에요.
```yaml
ssh:
  user: <%= ENV.fetch("DEPLOY_SSH_USER", "root") %>
```
`DEPLOY_SSH_USER` env 가 안 주입되면 default 가 `root` 가 돼요. macOS 는 root SSH 가 비활성화 → password 프롬프트 → GHA runner 비대화형 → ENOTTY.

**해결 방법**: GHA Variable `DEPLOY_SSH_USER=storkspear` (또는 본인 계정) 추가 + deploy.yml env 블록에 `DEPLOY_SSH_USER: ${{ vars.DEPLOY_SSH_USER }}` 추가.

자동화 적용 — setup.sh 가 Variable 등록을 자동으로 해요. deploy.yml 코드에 env 주입은 박혀 있어요.

---

### #9. .kamal/secrets 의 $GHCR_TOKEN 미해결

**증상**:
```
ERROR (SSHKit::Command::Failed): docker exit status: 125
docker stdout: Nothing written
docker stderr: flag needs an argument: 'p' in -p
```

**왜 발생했나요?** `.kamal/secrets.example` 가 다음과 같이 환경변수 `GHCR_TOKEN` 을 참조해요.
```
KAMAL_REGISTRY_PASSWORD=$GHCR_TOKEN
```
그런데 GHA env 에 `KAMAL_REGISTRY_PASSWORD` 만 export 하고 `GHCR_TOKEN` 자체는 안 export → kamal 이 `.kamal/secrets` 평가 시 `$GHCR_TOKEN` 이 빈 문자열로 resolve → docker login 명령에 password 자리가 비어서 `-p ` 까지만 → docker 가 "flag needs argument" 에러를 내요.

**해결 방법**: deploy.yml env 블록에 `GHCR_TOKEN: ${{ secrets.GHCR_TOKEN }}` 도 추가하세요 (KAMAL_REGISTRY_PASSWORD 와 함께, redundant 이지만 둘 다).

자동화 적용 — deploy.yml 코드에 박혀 있어요.

---

### #10a + #10b. kamal 이미지 경로 + service label

**증상 #10a**:
```
docker pull ghcr.io/ghcr.io/storkspear/template-spring:<sha>
                ↑↑↑ 이중 prefix
```

**왜 발생했나요?** kamal config 가 다음과 같아요.
```yaml
image: <%= ENV.fetch("KAMAL_IMAGE") %>
registry:
  server: ghcr.io
```
kamal 은 최종 이미지 URL 로 `${registry.server}/${image}:${version}` 을 만들어요. `KAMAL_IMAGE` 에 `ghcr.io/owner/repo` 처럼 ghcr.io 까지 포함하면 → `ghcr.io/ghcr.io/owner/repo:<sha>` 로 이중화돼요.

**해결 방법**: `KAMAL_IMAGE` 를 `owner/repo` 만 (예: `storkspear/template-spring`) 으로 설정하세요.

**증상 #10b**:
```
Image ghcr.io/<owner>/<repo>:<sha> is missing the 'service' label
```

**왜 발생했나요?** kamal 은 image pull 후 `docker inspect -f '{{.Config.Labels.service}}'` 가 `KAMAL_SERVICE_NAME` 과 같은지 검증해요. kamal 이 자체 빌드할 땐 자동으로 label 을 부여하지만, 우리는 직접 `docker/build-push-action` 으로 빌드해서 그 step 이 빠져 있어요.

**해결 방법**: `docker/build-push-action` 에 다음을 추가하세요.
```yaml
labels: |
  service=${{ vars.KAMAL_SERVICE_NAME }}
```

자동화 적용 — deploy.yml 코드에 박혀 있어요.

---

### #11. JDBC URL 형식

**증상 (Spring 기동 시)**:
```
Failed to get driver instance for jdbcUrl=postgresql://...
Caused by: java.sql.SQLException: No suitable driver
```

**왜 발생했나요?** JDBC 가 인식하는 URL 형식은 `jdbc:postgresql://...` 인데 사용자가 자주 헷갈리는 게 Supabase 가 보여주는 connection string `postgresql://user:pass@host:port/db` 를 그대로 복사하는 거예요. 그러면 `jdbc:` prefix 가 없고 user/password 가 inline 이 돼요.

application-prod.yml 은 `spring.datasource.url=${DB_URL}` 로 직접 사용 → URL 형식이 안 맞으면 driver 를 결정하지 못해요 → "No suitable driver" 에러가 나요.

**해결 방법**:
```
DB_URL=jdbc:postgresql://aws-1-<region>.pooler.supabase.com:5432/postgres
DB_USER=postgres.<ref>
DB_PASSWORD=<password>
```
- `jdbc:` prefix 가 필수예요
- `host:port/db` 만 (user/pass 빼고)
- user/pass 는 별도 secret 으로 분리해요

자동화 적용 — setup.sh 의 Step 2 검증에 `DB_URL` 형식 정규식 체크 (`^jdbc:postgresql://`) 가 박혀 있어 잘못된 형식이면 시작 단계에서 즉시 fail 해요.

---

### #12. JDK 26 호환성 (Gradle/Groovy 한계)

**증상 (Gradle 빌드 또는 `./gradlew bootRun` 시)**:
```
> Could not open cp_init class cache for initialization script ...
  > Unsupported class file major version 70
```

**왜 발생했나요?** class file major version `70` 은 **JDK 26** 이에요. Gradle 7.x/8.x 의 Groovy 가 JDK 26 의 class file 포맷을 못 읽어요. 시스템에 JDK 26 만 있거나 (예: `brew install openjdk` 가 latest 인 26 을 설치) JDK 17 + 26 조합이라 21 이 없으면 재현돼요.

**해결 방법**: JDK 21 LTS 설치 후 JAVA_HOME 고정.
```bash
brew install openjdk@21
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
```

쉘 환경에 영구 반영하려면 `~/.zshrc` 등에 export 를 추가하세요. IntelliJ / VS Code 사용 시 프로젝트 SDK 도 21 로 명시해요.

**자동화 적용** — `init-prod.sh` / `init-local.sh` Step 1 의 prereq 검증 (lib/init-common.sh 의 `_validate_prereqs`) 이 `21 ≤ JAVA_VERSION < 26` 로 좁혀져 있어 JDK 26 단독 환경에선 prereq 단계에서 즉시 fail 해요 (`Java 21~25 필요`). 빌드까지 가서 깨지는 일이 없어요.

**결정 카드** — 권장 범위는 `21 ≤ major < 26` 이에요. JDK 22~25 도 사용 가능하지만 LTS 인 21 을 권장해요.

---

## 새 함정 발견 시 추가하는 방법

도그푸딩 / 파생레포 실배포에서 새 함정을 만나면 다음 절차를 따라요.

1. **이 문서의 "한눈에 표" 에 한 행 추가** (다음 번호 #13)
2. **함정별 자세한 분석 섹션** 에 같은 패턴으로 한 항목 추가
3. **commit 메시지** 에 `pitfalls: add #N` 접두사 사용
4. 가능하면 `setup.sh` 의 검증 step 에 가드를 추가하세요 (예: #11 의 DB_URL 형식 체크처럼)
5. ADR 변경이 필요한 결정이면 [`인프라 결정 기록 (Decisions — Infrastructure)`](../production/deploy/decisions-infra.md) 에 새 카드를 추가하세요

## 다음 단계

- 새 함정을 만났을 때 — 이 문서 상단 "새 함정 발견 시 추가하는 방법" 참고
- 시간 순 narrative — [`도그푸딩 walkthrough`](./dogfood-walkthrough.md)
- 본 가이드 전체 — [`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md)
- 자주 묻는 질문 — [`도그푸딩 FAQ`](./dogfood-faq.md)

---

## 관련 문서

- [`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md) — 정상 흐름 (이 함정들 없이 가는 길)
- [`도그푸딩 walkthrough`](./dogfood-walkthrough.md) — 시간 순 narrative + 정착된 패턴
- [`CI / CD 전체 플로우 — commit 부터 운영 반영까지`](../production/deploy/ci-cd-flow.md) — 다이어그램 + phase 별 안전망
- [`인프라 결정 기록 (Decisions — Infrastructure) I-09 ~ I-14`](../production/deploy/decisions-infra.md) — ADR (왜 이 결정을)
- [`키 교체 절차 (Key Rotation)`](../production/setup/key-rotation.md) — 키 노출 시 절차
