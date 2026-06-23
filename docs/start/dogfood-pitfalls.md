# 도그푸딩 함정 모음 — 사고 실록

> **유형**: How-to · **독자**: Level 1 · **읽는 시간**: ~10분

> 결정 근거: [`인프라 결정 기록 I-09 ~ I-14`](../production/deploy/decisions-infra.md)
> 정상 흐름: [`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md)
> 시간 순 narrative: [`도그푸딩 walkthrough`](./dogfood-walkthrough.md)
> 전체 플로우: [`CI/CD 전체 플로우`](../production/deploy/ci-cd-flow.md)

---

## 개요

이 문서는 도그푸딩 배포에서 실제로 부딪힌 함정 15개를 모은 사고 실록이에요. 정상 흐름 설명은 [셋업 가이드](./dogfood-setup.md)에서 다루고, 여기서는 막혔을 때 에러 메시지로 검색해 원인과 해결을 빠르게 찾는 데 집중해요.

함정이 어디서 나왔는지부터 짚어 둘게요.

- template 의 첫 도그푸딩 배포 — 11번 시도 끝에 성공했고, 매 시도마다 새 에러가 하나씩 나왔어요.
- 그 뒤 JDK 호환성 함정 1건이 더 드러났어요.
- 파생 레포 실배포(server-backend 의 dev/prod)에서 운영 함정 3건이 추가됐어요.

이렇게 모인 15개를 아래 표 하나로 먼저 훑고, 필요한 항목만 자세히 펼쳐 보면 돼요.

자동화된 `tools/dogfooding/setup.sh` 와 `cleanup.sh` 가 이 함정 대부분을 알아서 회피해요. 다만 Tailscale ACL, GitHub PAT scope 처럼 외부 서비스라 사람 손이 가야 하는 자리에서는 같은 에러를 다시 만날 수 있어요. 그때 이 문서를 펼치세요.

---

## 한눈에 — 함정 15개 표

| # | 단계 | 증상(검색 키워드) | 원인 한 줄 | 해결 한 줄 | 관련 commit |
|---|---|---|---|---|---|
| **1** | Locate jar | `[ -f ]` false, multi-line `$JAR` | `bootstrap.jar` 과 `bootstrap-plain.jar` 양쪽이 매치 | artifact path 좁힘 + `find -not -name '*-plain.jar' \| head -1` | `3af3e89` |
| **2** | Cleanup step | `Package not found` | 첫 배포라 GHCR 패키지가 아직 없음 | cleanup step 에 `continue-on-error: true` | `3af3e89` |
| **3** | Tailscale | `403 ... does not have enough permissions`(action v2) | `tailscale/github-action@v2` 가 옛 1.42.0 을 받아 신 OAuth API 와 비호환 | `tailscale/github-action@v4` 로 업그레이드 | `41e076d` |
| **4** | Tailscale | 같은 `403`(action v4 인데도) | OAuth client 의 Auth Keys 권한 미체크 | OAuth client 재발급, Devices Core Write 와 Auth Keys Write 둘 다 + tag:ci | `26ff9e0` |
| **5** | GHCR push | `403 Forbidden HEAD blob` | repo 의 default workflow permissions 가 read-only | `gh api`로 `default_workflow_permissions=write` 변경 | `8bbb8ea` |
| **6** | GHCR push | 같은 `403`(write 인데도) | provenance·sbom attestation 이 추가 권한을 요구 | `provenance: false`, `sbom: false`, cache export 제거 | `777218d` |
| **7** | GHCR push | 또 같은 `403` | `GITHUB_TOKEN` 으로는 첫 GHCR 패키지 생성 권한이 부족 | PAT 발급 후 `GHCR_TOKEN` secret 사용 | `5b2eb7a` |
| **8** | kamal SSH | `ENOTTY ... root@... password:` | `ssh.user` default 가 `root` → root SSH 비활성 → 비대화형 프롬프트 | `DEPLOY_SSH_USER` GHA Variable 추가 후 env 주입 | `d765372` |
| **9** | kamal docker login | `flag needs argument: 'p' in -p` | env 에 `GHCR_TOKEN` 미주입 → `$GHCR_TOKEN` 이 빈 값으로 해석 | env 블록에 `GHCR_TOKEN` 추가 | `c312bb5` |
| **10a** | kamal pull | 이미지 경로 `ghcr.io/ghcr.io/...` 이중 prefix | `KAMAL_IMAGE` 에 `ghcr.io/` 까지 포함 → registry.server 가 다시 prefix | `KAMAL_IMAGE` 를 `owner/repo` 만으로 | `d610cb5` |
| **10b** | kamal inspect | `Image ... is missing the 'service' label` | 직접 buildx 빌드라 kamal 자동 부여 label 이 없음 | build-push-action 에 `service` label 추가 | `d610cb5` |
| **11** | Spring 기동 | `No suitable driver` for jdbcUrl=postgresql://... | `DB_URL` 에 `jdbc:` prefix 누락 + user/password inline | `jdbc:postgresql://host:port/db` 로, 자격은 별도 변수로 | `5c54b86` |
| **12** | Gradle 빌드 | `Unsupported class file major version 70` | 시스템 JDK 가 26 — Gradle/Groovy 가 못 읽음 | JDK 21 설치 후 `JAVA_HOME` 고정 | prereq 가드로 차단 |
| **13** | 첫 배포 health | `target failed to become healthy ... timeout (30s)` | 원거리 콜드 DB 라 첫 Flyway 마이그레이션이 30초 초과 | `deploy_timeout: 120` | post-deploy 보강 |
| **14** | Cloudflare 라우팅 | 배포 성공인데 외부 도메인 404, `dig` NXDOMAIN | 터널이 remote-managed + manual deploy 라 ingress·DNS 자동등록을 건너뜀 | `prod init` 로 자동등록, 또는 API 로 수동 추가 | post-deploy 보강 |
| **15** | Loki 로그 | Grafana 로그 0, `loki4j ... ConnectException` 반복 | 앱이 Loki 보다 먼저 떠 appender 가 영구 fail | observability 를 첫 배포 전 기동, 또는 앱 컨테이너 restart | post-deploy 보강 |

> 위 표의 "원인 한 줄"·"해결 한 줄" 칸은 빠르게 훑는 reference 라 의도적으로 명사구로 압축했어요. 표 안 명사구 허용 규정은 [`STYLE_GUIDE §3`](../reference/STYLE_GUIDE.md) 에 있어요.

---

## 함정별 자세한 분석

### #1. jar 찾기에서 두 줄이 잡히는 문제

증상은 `Locate jar` step 에서 jar 파일을 찾지 못하는 거예요. 로그를 보면 `_artifact/` 안에 두 파일이 같이 있어요.

```
ERROR: jar 파일을 찾지 못함
_artifact/:
-rw-r--r-- bootstrap-plain.jar    11825 bytes
-rw-r--r-- bootstrap.jar       84861270 bytes
```

원인은 gradle `bootJar` 가 fat jar 인 `bootstrap.jar` 와 plain jar 인 `bootstrap-plain.jar` 두 개를 만든다는 데 있어요. CI 가 둘 다 artifact 로 올리니 배포 측의 `ls _artifact/*.jar` 가 두 줄을 출력하고, 그 두 줄이 `JAR=$(...)` 변수에 한꺼번에 담겨요. 그러면 `[ ! -f "$JAR" ]` 가 여러 줄짜리 문자열을 단일 경로로 보려다 실패해요. 여기에 더해 처음 작성한 `JAR=$(ls A 2>/dev/null || ls B | head -1)` 는 `head -1` 이 `||` 뒤에만 걸려서, 두 파일이 다 존재하면 첫 줄만 고르는 효과가 사라지는 함정도 겹쳐 있었어요.

해결은 두 군데를 손봤어요.

- `ci.yml` 의 upload-artifact path 를 `bootstrap.jar` 로 좁혀 plain jar 를 제외했어요.
- `deploy.yml` 의 Locate step 을 `find bootstrap/build/libs -maxdepth 1 -name '*.jar' -not -name '*-plain.jar' | head -1` 로 안전하게 바꿨어요.

이 함정은 워크플로우 코드 자체에 박혀 있어서, 새 fork 에서 다시 만나지 않아요. `setup.sh` 와는 무관해요.

---

### #2. cleanup step 이 첫 배포에서 막히는 문제

증상은 `actions/delete-package-versions@v5` step 에서 나는 `get versions API failed. Package not found.` 에요.

원인은 단순해요. 첫 배포 전에는 GHCR 에 패키지 자체가 없어 cleanup 할 대상이 없는데, 액션이 이 상황을 fail 로 처리해 버려요.

해결은 cleanup step 에 `continue-on-error: true` 를 다는 거예요. 워크플로우 코드에 박혀 있어 자동으로 회피돼요.

---

### #3 · #4. Tailscale OAuth — action 버전과 scope 두 함정

같은 `403` 메시지가 두 번 나오는데 원인이 서로 달라요. 먼저 action v2 를 쓸 때 이런 에러가 떠요.

```
Status: 403, Message: "calling actor does not have enough permissions to perform this function"
```

`tailscale/github-action@v2` 는 내부적으로 2023년판 tailscale 1.42.0 을 받아오는데, 이게 신규 OAuth API 와 호환되지 않아요. `tailscale/github-action@v4` 로 올리면 이 #3 은 풀려요.

그런데 v4 로 올린 뒤에도 같은 403 이 또 나요. 이번엔 action 버전이 아니라 OAuth client 의 scope 부족이 원인이에요(#4). 처음 OAuth client 를 만들 때 Devices → Core → Write 만 체크하고 끝내는 경우가 많은데, `tailscale/github-action` 은 ephemeral device 를 등록하려고 `tailscale up --authkey=...` 를 호출해요. auth key 발급 권한은 별도 scope 인 Keys → Auth Keys → Write 에 있어서, 둘 중 하나만 빠져도 403 이 나요.

해결은 OAuth client 를 새로 발급하면서 두 scope 를 모두 체크하는 거예요.

- Devices → Core → Write
- Keys → Auth Keys → Write

두 scope 모두에 `tag:ci` 를 부여해요. 여기서 한 가지 더 걸리는 게, `tag:ci` 가 ACL 의 `tagOwners` 에 정의돼 있지 않으면 OAuth 화면의 "Add tags" 드롭다운이 비활성화돼요. ACL HuJSON 에 다음을 추가하세요.

```hujson
"tagOwners": {
    "tag:ci": ["autogroup:admin"],
},
```

OAuth client 자체는 외부 서비스의 인증 흐름이라 `setup.sh` 가 만들지 못해요. 정확한 발급 절차는 [셋업 가이드 §3.2](./dogfood-setup.md) 에서 안내해요.

---

### #5 · #6 · #7. GHCR push 403 — 세 단계로 누적되는 권한 함정

세 함정 모두 증상이 똑같아요.

```
ERROR: failed to push ghcr.io/<owner>/<repo>:<sha>:
unexpected status from HEAD request to .../blobs/sha256:...: 403 Forbidden
```

같은 403 이 권한 부족의 서로 다른 층위에서 세 번 누적돼요. 하나씩 벗겨 볼게요.

#### #5 — repo 의 workflow permissions 가 read-only

`deploy.yml` 에 `permissions: packages: write` 를 명시했더라도, repo 의 default workflow permissions 가 read-only 면 무시되거나 일부만 적용돼요. 먼저 현재 값을 확인하세요.

```bash
gh api repos/<owner>/<repo>/actions/permissions/workflow
# {"default_workflow_permissions":"read", ...}
```

`read` 로 나오면 API 로 write 로 바꿔요.

```bash
gh api -X PUT repos/<owner>/<repo>/actions/permissions/workflow \
  -f default_workflow_permissions=write \
  -F can_approve_pull_request_reviews=false
```

#### #6 — provenance·sbom attestation 이 추가 권한을 요구

`docker/build-push-action@v5` 는 default 가 `provenance: true` 와 `sbom: true` 예요. 이 둘이 attestation manifest 를 별도 blob 으로 push 하는데, 그게 추가 권한을 요구해요. 둘 다 `false` 로 끄면 풀려요.

#### #7 — `GITHUB_TOKEN` 자체의 한계

#5 와 #6 을 조치한 뒤에도 같은 403 이 나요. 결국 GitHub 의 알려진 이슈에 부딪힌 건데, 첫 GHCR 패키지를 만들 때 repo 와 package 가 자동으로 연결되지 않아 `GITHUB_TOKEN` 의 권한이 모자라요. PAT 로 우회해야 해요.

PAT(Classic)를 발급하고 scope 는 `write:packages`, `read:packages`, `delete:packages`, `repo` 를 줘요. 이걸 `GHCR_TOKEN` secret 으로 등록한 뒤, docker login·`KAMAL_REGISTRY_PASSWORD`·delete-package-versions 세 곳이 모두 이 PAT 를 쓰게 해요.

`setup.sh` 는 #5(workflow permissions 를 write 로)까지 자동으로 처리해요. PAT 발급(#7)은 외부 작업이라 [셋업 가이드 §3.1](./dogfood-setup.md) 에서 안내해요.

---

### #8. kamal 이 root 로 SSH 를 시도하는 문제

증상은 docker login 단계에서 root 비밀번호를 묻다가 막히는 거예요.

```
INFO Running docker login ghcr.io ... on 100.X.X.X
root@100.X.X.X's password:
ERROR (Errno::ENOTTY): Inappropriate ioctl for device
```

원인은 `config/deploy.yml` 의 ssh 설정이에요.

```yaml
ssh:
  user: <%= ENV.fetch("DEPLOY_SSH_USER", "root") %>
```

`DEPLOY_SSH_USER` 가 주입되지 않으면 default 가 `root` 가 돼요. macOS 는 root SSH 가 비활성화돼 있어 비밀번호 프롬프트가 뜨는데, GHA runner 는 비대화형이라 입력할 수 없어 ENOTTY 로 죽어요.

해결은 GHA Variable 로 `DEPLOY_SSH_USER=storkspear`(본인 계정)를 추가하고, `deploy.yml` 의 env 블록에 `DEPLOY_SSH_USER: ${{ vars.DEPLOY_SSH_USER }}` 를 넣는 거예요. `setup.sh` 가 Variable 등록을 자동으로 해 주고, env 주입은 코드에 박혀 있어요.

---

### #9. `.kamal/secrets` 의 `$GHCR_TOKEN` 이 비는 문제

증상은 docker login 명령이 인자 부족으로 죽는 거예요.

```
ERROR (SSHKit::Command::Failed): docker exit status: 125
docker stderr: flag needs an argument: 'p' in -p
```

원인은 `.kamal/secrets.example` 이 환경변수 `GHCR_TOKEN` 을 참조한다는 데 있어요.

```
KAMAL_REGISTRY_PASSWORD=$GHCR_TOKEN
```

GHA env 에 `KAMAL_REGISTRY_PASSWORD` 만 export 하고 `GHCR_TOKEN` 자체는 export 하지 않으면, kamal 이 `.kamal/secrets` 를 평가할 때 `$GHCR_TOKEN` 이 빈 문자열로 해석돼요. 그러면 docker login 의 password 자리가 비어 `-p ` 까지만 만들어지고, docker 가 "flag needs argument" 에러를 내요.

해결은 `deploy.yml` 의 env 블록에 `GHCR_TOKEN: ${{ secrets.GHCR_TOKEN }}` 도 같이 넣는 거예요. `KAMAL_REGISTRY_PASSWORD` 와 중복처럼 보여도 둘 다 필요해요. 코드에 박혀 있어 자동으로 적용돼요.

---

### #10a · #10b. kamal 이미지 경로와 service label

두 함정이 한 commit 에서 같이 잡혔어요. 먼저 #10a 는 이미지 경로가 이중으로 붙는 거예요.

```
docker pull ghcr.io/ghcr.io/storkspear/template-spring:<sha>
                ↑↑↑ 이중 prefix
```

원인은 kamal config 와 `KAMAL_IMAGE` 값이 겹친다는 데 있어요.

```yaml
image: <%= ENV.fetch("KAMAL_IMAGE") %>
registry:
  server: ghcr.io
```

kamal 은 최종 이미지 URL 을 `${registry.server}/${image}:${version}` 으로 조립해요. 그래서 `KAMAL_IMAGE` 에 `ghcr.io/owner/repo` 처럼 registry 까지 포함하면 `ghcr.io/ghcr.io/owner/repo:<sha>` 로 두 번 붙어요. 해결은 `KAMAL_IMAGE` 를 `storkspear/template-spring` 처럼 `owner/repo` 만으로 설정하는 거예요.

다음으로 #10b 는 service label 누락이에요.

```
Image ghcr.io/<owner>/<repo>:<sha> is missing the 'service' label
```

kamal 은 이미지를 pull 한 뒤 `docker inspect -f '{{.Config.Labels.service}}'` 가 `KAMAL_SERVICE_NAME` 과 같은지 검증해요. kamal 이 직접 빌드하면 이 label 을 자동으로 붙이지만, 우리는 `docker/build-push-action` 으로 따로 빌드해서 그 step 이 빠져 있어요. 해결은 build-push-action 에 label 을 명시하는 거예요.

```yaml
labels: |
  service=${{ vars.KAMAL_SERVICE_NAME }}
```

둘 다 `deploy.yml` 코드에 박혀 있어 자동으로 적용돼요.

---

### #11. JDBC URL 형식

증상은 Spring 기동 중 드라이버를 못 찾는 거예요.

```
Failed to get driver instance for jdbcUrl=postgresql://...
Caused by: java.sql.SQLException: No suitable driver
```

원인은 URL 형식이에요. JDBC 가 인식하는 형식은 `jdbc:postgresql://...` 인데, Supabase 가 보여주는 connection string `postgresql://user:pass@host:port/db` 를 그대로 복사하면 `jdbc:` prefix 가 빠지고 user/password 가 inline 으로 들어가요. `application-prod.yml` 은 `spring.datasource.url=${DB_URL}` 을 그대로 쓰니, 형식이 어긋나면 드라이버를 결정하지 못해 "No suitable driver" 가 떠요.

해결은 형식을 맞추고 자격을 분리하는 거예요.

```
DB_URL=jdbc:postgresql://aws-1-<region>.pooler.supabase.com:5432/postgres
DB_USER=postgres.<ref>
DB_PASSWORD=<password>
```

- `jdbc:` prefix 가 필수예요.
- `DB_URL` 에는 `host:port/db` 만 담고 user/pass 는 빼요.
- user/pass 는 별도 secret 으로 분리해요.

`setup.sh` 의 Step 2 검증에 `^jdbc:postgresql://` 정규식 체크가 박혀 있어서, 형식이 틀리면 시작 단계에서 바로 실패해요.

---

### #12. JDK 26 호환성 — Gradle·Groovy 의 한계

증상은 Gradle 빌드나 `./gradlew bootRun` 에서 class file 버전 에러가 나는 거예요.

```
> Could not open cp_init class cache for initialization script ...
  > Unsupported class file major version 70
```

원인은 class file major version `70` 이 JDK 26 이라는 데 있어요. Gradle 7.x·8.x 의 Groovy 가 JDK 26 의 class file 포맷을 아직 읽지 못해요. 시스템에 JDK 26 만 있거나, JDK 17 과 26 만 깔려 있어 21 이 없으면 재현돼요. `brew install openjdk` 가 latest 인 26 을 설치하는 경우가 흔한 트리거예요.

해결은 JDK 21 LTS 를 설치하고 `JAVA_HOME` 을 고정하는 거예요.

```bash
brew install openjdk@21
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
```

쉘에 영구 반영하려면 `~/.zshrc` 에 export 를 추가하고, IntelliJ 나 VS Code 를 쓴다면 프로젝트 SDK 도 21 로 맞춰요. 권장 범위는 `21 ≤ major < 26` 이에요. JDK 22~25 도 동작하지만 LTS 인 21 을 권장해요.

이 함정은 `init-prod.sh` 와 `init-local.sh` 의 첫 step 에서 미리 막아요. `tools/lib/init-common.sh` 의 prereq 검증이 java 버전을 `21 ≤ version < 26` 로 좁혀, 범위를 벗어나면 빌드까지 가기 전에 즉시 거부해요(`Java 21~25 필요`). 시스템 java 가 부적합해도 brew 의 openjdk@21 을 자동 탐지해 `JAVA_HOME` 을 잡아 주는 fallback 도 함께 있어요.

---

### #13. 첫 배포 health-check 타임아웃 — 원거리 DB 의 Flyway 마이그레이션

증상은 kamal 배포가 빌드·push·기동까지 잘 가다가 health-check 에서 막히는 거예요.

```
ERROR: target failed to become healthy within configured timeout (30s)
```

앱 컨테이너 로그를 보면 죽기 직전까지 Flyway 가 `Migrating schema "<slug>" to version "00X"` 를 정상 진행 중이었어요. 재시도하면 더 높은 버전까지 갔다가 또 죽고요.

원인은 첫 배포가 빈 schema 라는 데 있어요. 새 앱이 받는 공통 마이그레이션은 `new-app.sh` 가 생성하는 V001~V015 에 admin 시드인 V007 을 더한 세트예요(V001~V006 인증, V007 admin 시드, V008~V012 결제·audit, V013 2FA, V014 알림, V015 점유인증). 첫 기동에서는 Spring 이 이 전체를 다 migrate 한 뒤에야 `/actuator/health/liveness` 가 200 을 줘요. DB 가 배포 호스트와 멀거나(예: Supabase 가 Mac mini 와 다른 리전 — 시드니 대 서울) 콜드 상태면 쿼리 왕복 지연이 커져서, 마이그레이션이 kamal-proxy 의 기본 `deploy-timeout` 30초를 넘겨요. 그러면 컨테이너가 kill 되고 배포가 실패 루프에 빠져요. dev 는 같은 리전이라 통과하는데 prod 만 실패한다면 이걸 의심하세요.

> 도메인 테이블은 V016 부터 작성해요. V001~V015 가 이미 차 있고 V007 은 도메인이 아니라 admin 시드라, 그다음 빈 번호가 V016 이에요.

해결은 `config/deploy.yml` 루트에 `deploy_timeout: 120` 을 두는 거예요(이제 템플릿 default). kamal 은 로컬 config 를 deploy 설정으로 읽으니(이미지는 origin SHA) 커밋 전이라도 적용돼요. 평시 재배포는 schema 가 이미 최신이라 마이그레이션 없이 빠르게 부팅해요. 매 재시도가 마이그레이션을 버전별로 누적 진행해서 끝내 수렴하긴 하지만, timeout 을 키우는 게 정석이에요. `config/deploy.yml` 과 `config/deploy-dev.yml` 모두 `deploy_timeout: 120` 으로 반영돼 있어요.

---

### #14. 배포는 성공인데 외부 도메인 404 — Cloudflare 터널 remote-managed

증상은 kamal 배포는 성공인데 외부 도메인이 안 열리는 거예요. `kamal-proxy list` 에는 `<host> → :8080 running` 이 등록돼 있는데, `https://<host>/...` 가 404(kamal-proxy 의 styled 404)거나 아예 `dig <host>` 가 NXDOMAIN 이에요.

원인은 두 가지가 겹쳐요.

- 이 인프라의 cloudflared 터널은 remote-managed 라, 실제 라우팅을 로컬 `~/.cloudflared/*.yml` 이 아니라 Cloudflare API/대시보드에서 가져와요. cloudflared 로그에 `Updated to new configuration version=N` 이 보이는 게 그 신호예요. 로컬 yaml 을 편집해도 무효예요.
- manual `<repo> prod deploy` 만 돌리면, `<repo> prod init` 이 하는 DNS CNAME 과 터널 ingress 자동등록을 건너뛰어요. 그러면 해당 host 가 ingress 에 없어 catch-all 404 가 나고, DNS 가 없으면 NXDOMAIN 이 돼요.

해결의 정석은 `<repo> prod init` 을 먼저(또는 함께) 돌리는 거예요. `tools/lib/cloudflare.sh` 가 `PUT /accounts/{acct}/cfd_tunnel/{tunnel}/configurations` 로 ingress 를 등록하고, DNS CNAME(→ `<tunnel>.cfargotunnel.com`, proxied)도 자동으로 만들어요. 이미 배포만 해 버렸다면 같은 API 로 ingress(catch-all 앞)와 DNS 를 직접 추가하면 돼요.

기억할 점 하나 — kamal-proxy 라우트는 있는데 외부에서 404 라면, 앱이나 배포 문제가 아니라 Cloudflare 터널 ingress 누락이에요. 내부에서 `curl -H 'Host: <host>' http://localhost:80/...` 가 200 이면 확정이에요.

---

### #15. Grafana 에 로그가 안 옴 — Loki appender 가 startup 에서 멈춤

증상은 dev/prod 는 정상인데 `log.<domain>`(Grafana)/Loki 에 로그 스트림이 0 인 거예요. 앱 컨테이너 로그에는 `com.github.loki4j ... java.net.ConnectException`(또는 `UnresolvedAddressException`)이 반복돼요. Loki 를 나중에 띄워도 로그가 흐르지 않아요.

원인은 앱 컨테이너가 Loki(observability 스택)보다 먼저 떴다는 데 있어요. loki4j appender 는 startup 때 `loki` 호스트 연결에 실패하면 그 상태로 굳어 버려서, 이후 Loki 가 같은 docker network 에 떠도 자가복구하지 않아요.

해결은 observability 를 먼저 띄우는 거예요. `infra/docker-compose.observability.yml`(Loki/Grafana/Prometheus, `kamal` 네트워크에 external join)을 첫 앱 배포 전에 기동해요. 이미 앱이 떠 있었다면 Loki 를 띄운 뒤 앱 컨테이너를 `docker restart` 하면 appender 가 새로 붙어 즉시 흘러요(`{env="dev"}` / `{env="prod"}` 로 구분). dev 와 prod 둘 다 Loki 로 push 해요(logback-common.xml).

---

## 새 함정 발견 시 추가하는 방법

도그푸딩이나 파생 레포 실배포에서 새 함정을 만나면 다음 절차를 따라요.

1. 이 문서의 "한눈에 표" 에 한 행을 추가해요(다음 번호 #16).
2. "함정별 자세한 분석" 에 같은 패턴으로 한 항목을 추가해요.
3. commit 메시지에 `pitfalls: add #N` 접두사를 써요.
4. 가능하면 `setup.sh` 의 검증 step 에 가드를 추가해요(예: #11 의 DB_URL 형식 체크처럼).
5. 결정이 ADR 변경을 부르면 [`인프라 결정 기록`](../production/deploy/decisions-infra.md) 에 새 카드를 추가해요.

---

## 다음 단계

- 새 함정을 만났을 때 — 위 "새 함정 발견 시 추가하는 방법" 참고
- 시간 순 narrative — [`도그푸딩 walkthrough`](./dogfood-walkthrough.md)
- 정상 셋업 흐름 — [`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md)
- 자주 묻는 질문 — [`도그푸딩 FAQ`](./dogfood-faq.md)

---

## 관련 문서

- [`도그푸딩 환경 셋업 가이드`](./dogfood-setup.md) — 정상 흐름, 이 함정들 없이 가는 길
- [`도그푸딩 walkthrough`](./dogfood-walkthrough.md) — 시간 순 narrative 와 정착된 패턴
- [`CI/CD 전체 플로우`](../production/deploy/ci-cd-flow.md) — 다이어그램과 phase 별 안전망
- [`인프라 결정 기록 I-09 ~ I-14`](../production/deploy/decisions-infra.md) — 왜 이렇게 결정했는지
- [`키 교체 절차`](../production/setup/key-rotation.md) — 키가 노출됐을 때의 절차
