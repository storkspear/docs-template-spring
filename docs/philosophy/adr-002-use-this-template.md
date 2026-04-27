# ADR-002 · GitHub Template Repository 패턴 (Use this template)

**Status**: Accepted. 현재 유효. 2026-04-20 기준 `template-v*` 태그 + 자동 Release 워크플로우 + `cross-repo-cherry-pick.md` 가이드 로 정교화 완료.

> **유형**: ADR · **독자**: Level 3 · **읽는 시간**: ~5분

## 결론부터

이 레포는 **"완성된 프로젝트" 가 아니라 "프로젝트의 출발점"** 입니다. `create-react-app`, `cargo new`, `django-admin startproject` 와 비슷한 위치에 있어요 — 다만 우리만의 아키텍처와 인프라가 이미 녹아있는 출발점. `Use this template` 버튼을 누르면 깨끗한 사본이 만들어지고, **그 사본부터가 실제 개발이 일어나는 곳** 이에요. 원본 레포는 앞으로도 계속 "깨끗한 출발점" 상태를 유지합니다.

> 중요한 구분: 이 레포 자체는 **직접 개발하지 않습니다**. 여기엔 뼈대, 포트 인터페이스, 공통 인프라만 있어요. 실제 비즈니스 로직 — 예를 들어 "가계부 앱의 예산 계산", "운동 앱의 운동 기록" — 은 파생 레포의 영역입니다.

## 왜 이런 고민이 시작됐나?

프롤로그의 `앱 공장 전략` 에서 전제된 상황을 조금 구체화해보면, 이런 질문이 떠오릅니다.

**"앱 여러 개를 만든다면, 그 앱들을 한 레포에 다 넣어야 하나? 별도 레포로 가야 하나?"**

처음엔 "한 레포에 다 넣는 게 공통 코드 재사용에 유리해 보인다" 고 생각할 수 있어요. 실제로 모노레포(monorepo) 전략을 쓰는 회사도 많고요. 하지만 솔로 인디 스케일에서는 **한 레포가 여러 도메인을 담는 순간 생기는 문제들** 이 빠르게 드러났습니다.

**문제 1 — 도메인이 섞이면 재사용이 막힌다**  
가계부 앱의 로직을 운동 앱에 그대로 옮길 수 없어요. 도메인 언어, 테이블 구조, UX 패턴 모두 다릅니다. 한 레포에 두 도메인을 섞으면 **어느 쪽도 "깨끗한 출발점" 으로 재사용할 수 없는** 상태가 됩니다.

**문제 2 — 팀 경계가 생기면 운영이 꼬인다**  
외부 팀과 협업할 때 같은 백엔드 서버를 공유할 수 없습니다. 팀 A 의 배포가 팀 B 를 중단시키면 안 돼요. 지금은 솔로지만 **언젠가 특정 앱이 성공해서 팀이 붙을 수 있음** 을 감안하면, 처음부터 레포 경계를 분리해두는 게 안전합니다.

**문제 3 — "출발점은 순수해야 한다"**  
이 레포는 다른 사람도 사용할 수 있는 공개 템플릿입니다. 특정 앱/회사/도메인의 흔적이 박히면 다른 맥락에서 쓸 때 **그 흔적을 지우는 작업부터** 해야 해요. 출발점은 처음부터 **도메인 중립** 이어야 합니다.

이 세 문제를 동시에 피하려면 다음 물음에 답해야 했어요.

> **"공통 코드의 재사용성" 과 "도메인의 독립성" 을 어떻게 둘 다 잡을 것인가?**  
> 공통 코드를 공유하려면 어딘가 한 곳에 있어야 하지만, 도메인은 각자 독립 레포에 있어야 하는데?

## 고민했던 대안들

### Option 1 — 한 레포에 여러 도메인 공존 (모노레포)

`apps/sumtally/`, `apps/rny/`, `apps/gymlog/` 같은 식으로 한 레포에 모든 앱을 넣는 구조. 공통 코드는 `core/` 에.

- **장점**: 공통 코드 수정이 즉시 모든 앱에 반영됨. 리팩토링이 한 PR 로 끝남.
- **단점**:
  - 위 문제 1, 2, 3 모두 정면 위반.
  - 특정 앱의 비즈니스 로직이 다른 앱 코드 옆에 쌓임 — 도메인 언어가 섞임.
  - 한 앱이 배포 사고를 내면 같은 CI 파이프라인에서 다른 앱 PR 도 막힘.
  - 원본 레포를 **공개 템플릿** 으로 쓸 수 없음 — 특정 도메인 코드가 박혀있으니.
- **탈락 이유**: 솔로 인디 전제와 맞지 않음. Google/Meta 같은 대기업의 모노레포는 강력한 빌드 인프라가 있어 가능. 솔로는 감당 불가.

### Option 2 — GitHub Fork 사용

각 앱은 원본을 Fork 해서 만듦. 원본에 공통 코드 개선이 생기면 upstream 에서 merge.

- **장점**: git 수준에서 원본과 연결됨. 업스트림 변경 추적이 자동 (`git fetch upstream` + `git merge`).
- **단점**:
  - **Fork 는 계정당 1개만** — 한 계정에서 여러 앱 만들면 각 앱이 서로 다른 Fork 가 될 수 없음.
  - Fork 는 "원본에 PR 보낸다" 를 전제한 협업 모델. 우리는 각 파생이 **독립 진화** 하는 것이 목적. 방향이 반대.
  - merge 로 upstream 변경을 자동 반영하면 **원치 않는 변경까지 강제** 됨.
- **탈락 이유**: 협업 방향성이 다름. Fork 는 오픈소스 기여 모델, 우리 필요는 "시작점 복제 모델".

### Option 3 — 공통 코드를 JAR 라이브러리로 배포

`core-*` 를 `@factory/core-auth@1.0.0` 같은 Maven 의존성으로 발행. 각 앱 레포가 버전 고정해서 의존.

- **장점**: 각 앱이 독립 레포 + 공통 코드는 라이브러리로 공유.
- **단점**:
  - 라이브러리 발행 인프라 (사내 Maven repo 또는 GitHub Packages) 가 추가 운영 부담.
  - 공통 코드 개선마다 "수정 → 라이브러리 발행 → 각 앱에서 버전 올림 → 테스트 → 배포" 사이클.
  - 가장 큰 문제: 라이브러리는 **로직만** 공유합니다. `users` 테이블 같은 **DB 스키마** 와 **Flyway 마이그레이션** 은 라이브러리로 표현 불가.
- **탈락 이유**: 운영 오버헤드 + 공통 DB 스키마 공유 불가능.

### Option 4 — GitHub "Use this template" + cherry-pick 전파 ★ (채택)

GitHub 의 **Use this template** 기능으로 파일만 복제. 원본과 git 히스토리 단절. 공통 코드 개선은 파생 레포로 **수동 cherry-pick**.

- **장점**:
  - 각 파생 레포가 **완전 독립된 git 히스토리** — 도메인 코드가 원본을 오염시키지 않음.
  - 계정당 무제한 생성 가능 (Fork 의 1개 제한 없음).
  - 파생 레포가 공통 코드 개선을 **선택적으로** 가져올 수 있음.
  - 공통 DB 스키마, Flyway 마이그레이션, 인프라 스크립트 전부 복제됨.
- **단점**:
  - 자동 전파 없음 — 사람이 직접 cherry-pick 해야 함.
  - "내가 어느 버전까지 반영했는가" 추적이 수동.
  - 원본 개선이 여러 커밋에 섞여 있으면 cherry-pick 이 복잡해짐 → **커밋 위생** 이 중요해짐.
- **이 단점들이 감당 가능한 이유**: 전파를 **의도적으로 수동화** 한 것이 **실은 장점**. 자동 전파는 "원치 않는 강제 변경" 을 만듭니다. cherry-pick 은 솔로에게 "이번엔 받지 않겠다" 선택지를 줘요.

#### 왜 "자동 전파를 안 하는 것" 이 장점인가

예를 들어 내가 운영하는 `sumtally-backend` 가 있는데, 원본 `template-spring` 에 "회원 가입 시 이메일 인증을 기본값으로 켜도록" 이 변경되었다고 가정해봅시다. 내 sumtally 는 이메일 인증을 쓰지 않는 소셜 로그인 전용 앱이에요. 자동 전파면 내 앱이 **의도치 않게 회원가입 플로우가 망가집니다**.

cherry-pick 모델에서는 내가 원본 릴리스 노트를 읽고 **"이 변경은 안 가져오겠다"** 를 명시적으로 선택할 수 있어요. 의도성이 복구됩니다.

## 결정

**GitHub "Use this template" 모델을 채택하되, 4가지 장치로 실효성을 확보** 합니다. 단순히 파일 복제만 하면 "어느 버전까지 반영했는지 알 수 없는" 혼돈이 오거든요.

### 장치 1 — Conventional Commits 강제

모든 커밋이 `<type>(<scope>): <subject>` 형식을 따릅니다. 이유는 **cherry-pick 때 "어느 커밋이 공통 코드 개선인지" 를 기계가 알아볼 수 있게 하기 위함** 입니다.

```bash
# 파생 레포에서 "template v0.3.0 이후 공통 개선만 가져오기"
git log template-v0.3.0..template-v0.4.0 \
  --grep="^feat\|^fix" \
  --oneline -- core/ common/
```

이 명령이 가능하려면 커밋 메시지 형식이 통일되어야 합니다. 그래서 다음 3중 방어선이 있어요:

- **[`.husky/commit-msg`](https://github.com/storkspear/template-spring/blob/main/.husky/commit-msg)** — 로컬에서 `git commit` 순간 검증. 형식 위반 시 커밋 자체 거부.
- **[`.github/workflows/commit-lint.yml`](https://github.com/storkspear/template-spring/blob/main/.github/workflows/commit-lint.yml)** — CI 에서 PR 의 모든 커밋 검증. 로컬 훅을 `--no-verify` 로 우회한 경우도 잡음.
- **[`.github/workflows/pr-title.yml`](https://github.com/storkspear/template-spring/blob/main/.github/workflows/pr-title.yml)** — PR 제목도 같은 형식 강제.

[`commitlint.config.mjs`](https://github.com/storkspear/template-spring/blob/main/commitlint.config.mjs) 가 canonical 규칙. [`.gitmessage`](https://github.com/storkspear/template-spring/blob/main/.gitmessage) 가 에디터 템플릿으로 개발자 학습을 돕습니다.

### 장치 2 — 템플릿 전체 단위 SemVer + 태그

`template-v<major>.<minor>.<patch>` 형식의 태그. **템플릿 레포 전체** 가 한 단위로 버전 관리됩니다.

```
template-v0.1.0
template-v0.2.0  ← 여기에 auth.isPremium 필드 추가
template-v0.3.0  ← 여기에 push 모듈 추가
template-v0.4.0  ← 여기에 billing 모듈 추가
```

파생 레포 README 최상단에 템플릿 마커 명시:

```markdown
## Template base

Based on [template-spring](https://github.com/<you>/template-spring) `template-v0.3.0`.

Last synced: 2026-04-25
Pending sync: v0.4.0 (auth.isPremium 필요)
```

"내가 지금 어느 버전까지 반영했는가" 를 git 대신 **사람이 읽는 문서** 로 관리. 간단하지만 효과적입니다.

### 장치 3 — CHANGELOG 강제 업데이트

모든 feat/fix PR 은 [`CHANGELOG.md`](https://github.com/storkspear/template-spring/blob/main/CHANGELOG.md) 의 `[Unreleased]` 섹션 갱신이 필수입니다. [`changelog-check.yml`](https://github.com/storkspear/template-spring/blob/main/.github/workflows/changelog-check.yml) 이 PR 단계에서 검증합니다.

```yaml
# changelog-check.yml 핵심 로직
- name: Check CHANGELOG.md Unreleased section was updated
  if: steps.skip.outputs.skip == 'false'
  run: |
    BASE=${{ github.event.pull_request.base.sha }}
    HEAD=${{ github.event.pull_request.head.sha }}
    DIFF=$(git diff $BASE $HEAD -- CHANGELOG.md)
    if [ -z "$DIFF" ]; then
      echo "::error::feat/fix PR must update CHANGELOG.md '[Unreleased]' section"
      exit 1
    fi
```

`docs:`, `chore:`, `style:`, `ci:` 타입은 skip. 태그가 push 되면 [`release.yml`](https://github.com/storkspear/template-spring/blob/main/.github/workflows/release.yml) 이 해당 버전 섹션을 CHANGELOG 에서 추출해서 GitHub Release 본문으로 자동 등록해요.

### 장치 4 — Deprecation 유예 기간

Breaking change 를 도입할 때 **최소 1 minor 주기의 Deprecation 기간** 을 거칩니다. 이유는 **파생 레포가 따라올 시간 확보**.

갑작스러운 major bump (v0.3.0 → v1.0.0) 는 파생 레포 관점에서 "나중에 업그레이드 포기" 로 귀결됩니다. 그래서:

1. v0.4.0 에서 `@Deprecated` 표시 + 대체 API 도입 + CHANGELOG 에 마이그레이션 가이드
2. v0.5.0 에서 실제 제거 (major bump)
3. 파생 레포는 v0.4.0 ~ v0.5.0 사이에 마이그레이션

ArchUnit 규칙 r20 (`DEPRECATED_MUST_DECLARE_SINCE_AND_FOR_REMOVAL`) 이 `@Deprecated(since, forRemoval)` 형식을 강제해서 **기계가 읽을 수 있는 메타데이터** 로 남깁니다.

## Counter-example 1 — Fork 와의 실질적 차이

"Use this template 과 Fork 가 뭐가 다른가?" 는 가장 자주 받는 질문이에요.

| 항목 | Fork | Use this template |
|---|---|---|
| 원본과 git 히스토리 연결 | ✅ 연결됨 | ❌ 단절 |
| 계정당 생성 개수 | 1개 | 무제한 |
| upstream 변경 가져오기 | `git merge upstream` 자동 | `git cherry-pick` 선택적 |
| 원본에 PR 보내기 | ✅ 전제된 기능 | ❌ 불가 (연결 없음) |
| 사용 목적 | 오픈소스 기여 | 프로젝트 시작점 복제 |

**우리 상황을 Fork 로 하려고 하면 어떤 일이 벌어지나?**

```bash
# 첫 번째 앱은 OK
$ gh repo fork storkspear/template-spring \
    --repo storkspear/sumtally-backend --clone
# ✅ Fork 생성됨

# 두 번째 앱 시도
$ gh repo fork storkspear/template-spring \
    --repo storkspear/rny-backend --clone
# ❌ You have already forked this repository.
#    You can only create one fork per account.
```

이 한계가 앱 공장 전략의 핵심을 정면 부정합니다. Use this template 은 이 제약이 없습니다.

## Counter-example 2 — "템플릿 순수성" 의 기계 강제 (ArchUnit r7, r8)

"특정 앱 이름을 원본에 박지 않는다" 는 이 ADR 의 절대 금지 규칙 중 하나예요. 이걸 **문서로만** 선언하면 사람이 깜빡하기 쉽습니다. 그래서 [`ADR-004`](./adr-004-gradle-archunit.md) 의 기계 강제 도구 (ArchUnit) 중 **r7, r8** 이 이 원칙을 **바이트코드 수준에서** 차단합니다.

```java
// 규칙 정의 (ArchitectureRules.java)
public static final ArchRule CORE_API_MUST_NOT_DEPEND_ON_APPS =
    noClasses()
        .that().resideInAPackage("com.factory.core.(*).api..")
        .should().dependOnClassesThat().resideInAPackage("com.factory.apps..")
        .allowEmptyShould(true)
        .as("r7: core-*-api must not depend on apps/* (upward direction)");

public static final ArchRule CORE_IMPL_MUST_NOT_DEPEND_ON_APPS =
    noClasses()
        .that().resideInAPackage("com.factory.core.(*).impl..")
        .should().dependOnClassesThat().resideInAPackage("com.factory.apps..")
        .allowEmptyShould(true)
        .as("r8: core-*-impl must not depend on apps/* (upward direction)");
```

**잘못된 코드 예시** — `core-auth-impl` 안에서 "sumtally 앱 전용 로직" 을 참조:

```java
// core/core-auth-impl/src/.../AuthServiceImpl.java (위반)
import com.factory.apps.sumtally.hooks.SumtallyAuthHook;  // ← 특정 앱 이름

@Override
public AuthResponse signUpWithEmail(SignUpRequest request) {
    // ... 공통 가입 로직 ...
    SumtallyAuthHook.onSignUp(user);  // ← sumtally 에만 의존
    return response;
}
```

**ArchUnit r8 차단**:

```
Architecture Violation [Priority: MEDIUM] - Rule 'r8: core-*-impl must not
depend on apps/* (upward direction)' was violated (1 times):
Method <com.factory.core.auth.impl.AuthServiceImpl.signUpWithEmail(SignUpRequest)>
references class <com.factory.apps.sumtally.hooks.SumtallyAuthHook>

> Task :bootstrap:test FAILED
```

**이 규칙이 의미하는 것**:

1. **의존 방향은 항상 `apps → core`** (위에서 아래). 반대 방향 (`core → apps`) 은 core 가 특정 앱에 종속되는 것이라 **재사용성 파괴**. 템플릿이 한 도메인에 물들면 다른 파생 레포에서 그 core 를 못 씀.
2. **앱별 hook 이 필요하면 Dependency Inversion 으로 해결** — core 에 `AuthHook` Port 인터페이스 정의, 각 앱이 구현체를 Spring 빈으로 등록. core 는 Port 만 알고 구현체 이름은 모름. 이건 [`ADR-003`](./adr-003-api-impl-split.md) 의 포트/어댑터 패턴 그대로 적용.

**고치는 방법**:

```java
// core/core-auth-api/.../AuthHook.java (새로 추가)
public interface AuthHook {
    void onSignUp(UserSummary user);
}

// core/core-auth-impl/.../AuthServiceImpl.java (수정)
private final List<AuthHook> hooks;  // Spring 이 모든 구현체 주입

public AuthResponse signUpWithEmail(SignUpRequest request) {
    // ... 공통 가입 로직 ...
    hooks.forEach(h -> h.onSignUp(user));  // 앱 이름 모름
    return response;
}

// apps/app-sumtally/.../SumtallyAuthHook.java (앱이 구현 제공)
@Component
public class SumtallyAuthHook implements AuthHook {
    @Override
    public void onSignUp(UserSummary user) {
        // sumtally 전용 로직
    }
}
```

이제 core 는 `AuthHook` 인터페이스만 알고, 앱 이름은 모릅니다. r7, r8 통과.

**"문서만으로는 부족" 한 이유를 체감하는 지점** — 이 규칙이 없으면 어느 날 "한 줄만 넣으면 되는데..." 하는 유혹으로 특정 앱 이름이 core 에 들어올 수 있어요. r7, r8 이 이 유혹을 **빌드 단계에서** 차단합니다.

## 이 선택이 가져온 것

### 긍정적 결과

**도메인 격리가 레포 수준으로 물리화** — `sumtally-backend` 와 `rny-backend` 는 완전 별개의 git 레포이며 서로의 존재를 모릅니다. 한쪽의 배포 사고가 다른 쪽에 파급될 수 없어요.

**원본의 순수성 유지** — `template-spring` 은 앞으로도 "깨끗한 출발점" 상태. 새 사용자가 이 레포를 평가할 때 특정 도메인 코드에 혼란받지 않음. ArchUnit r7, r8 이 **기계 강제** 로 이 순수성을 보장.

**전파의 의도성** — 파생 레포가 "이번 변경은 받는다 / 안 받는다" 를 매번 판단할 수 있어요.

**무제한 파생** — 앱 5개든 50개든 같은 원본에서 파생 가능.

### 부정적 결과

**자동 전파 없음** — 공통 개선을 각 파생 레포로 전파하려면 **사람이 cherry-pick** 해야 함. 완화: [`cross-repo-cherry-pick.md`](https://github.com/storkspear/template-spring/blob/main/docs/journey/cross-repo-cherry-pick.md) 가이드로 절차화.

**커밋 위생의 강제 부담** — "공통 코드 수정" 과 "도메인 수정" 이 한 커밋에 섞이면 cherry-pick 사고. 완화: [`git-workflow.md`](https://github.com/storkspear/template-spring/blob/main/docs/conventions/git-workflow.md) 의 "한 커밋 = 한 논리적 변경" 규칙.

**버전 추적 수동화** — 파생 레포마다 "내가 template-v0.X.Y 까지 반영했다" 를 README 에 직접 적어야 함.

### 감당 가능성 판단

수동성이 감내할 만한 이유는 **"손 가는 과정이 곧 검토 과정"** 이기 때문입니다. cherry-pick 은 파생 레포 개발자가 매번 "이 변경을 내 앱에 받을까?" 를 판단하게 합니다. 의도적 마찰(deliberate friction) 이 솔로 인디가 여러 앱을 독립 진화시키는 상황에서는 친구 역할을 해요.

## 교훈

**2026 초반 — 파생 레포 전파 실험 초기에 발견한 3가지 함정.**

1. **한 PR 에 공통 코드 + 도메인 코드 섞어 커밋했다가 cherry-pick 할 때 분리 불가능** 했던 사례. 이후 [`git-workflow.md`](https://github.com/storkspear/template-spring/blob/main/docs/conventions/git-workflow.md) 에 "한 커밋 = 한 논리적 변경" 규칙을 명시화.

2. **Breaking change 를 major bump 로 바로 도입**했다가 파생 레포 업그레이드가 "다음 분기로 미뤄진" 사례. 이후 Deprecation 유예 기간 1 minor 의무화.

3. **CHANGELOG 를 PR 에 포함시키지 않는 관행** 이 있었는데, 파생 레포가 "뭐가 바뀌었지" 를 찾을 곳이 없어 GitHub Release 만 보고 추측해야 했음. 이후 `changelog-check.yml` 도입.

**교훈**: Use this template 은 **"복제" 가 쉬울 뿐 "동기화" 는 여전히 어렵다**. 동기화 인프라 (커밋 위생, 버전 태그, CHANGELOG, 마이그레이션 가이드) 를 템플릿 자체에 박아두지 않으면 파생 레포들이 **각자 다른 방향으로 표류** 하게 됩니다.

## 관련 사례 (Prior Art)

- **[Cookiecutter](https://github.com/cookiecutter/cookiecutter)** — Python 생태계의 대표 template 도구. 파라미터 주입 (`{{cookiecutter.project_name}}`) 까지 지원해서 복제 시 자동 치환.
- **[create-react-app](https://create-react-app.dev/)** / **[Vite](https://vitejs.dev/)** / **[Nx](https://nx.dev/)** — JS 생태계의 프로젝트 부트스트래핑 도구들. Nx 는 migration schema 로 자동 마이그레이션 지원.

우리는 가장 "수동적이지만 가장 투명한" 선택지를 골랐습니다. 자동화 레이어가 적을수록 파생 레포의 자율성이 커지고, 디버깅이 쉬워져요.

## Code References

**Template 메타데이터** (GitHub 설정):
- GitHub repository settings > General > "Template repository" 체크박스 활성화. **파일로 증거 없음** — GitHub UI 설정.

**Workflows**:
- [`commit-lint.yml`](https://github.com/storkspear/template-spring/blob/main/.github/workflows/commit-lint.yml)
- [`pr-title.yml`](https://github.com/storkspear/template-spring/blob/main/.github/workflows/pr-title.yml)
- [`changelog-check.yml`](https://github.com/storkspear/template-spring/blob/main/.github/workflows/changelog-check.yml)
- [`release.yml`](https://github.com/storkspear/template-spring/blob/main/.github/workflows/release.yml)

**Git 훅 & 설정**:
- [`.husky/commit-msg`](https://github.com/storkspear/template-spring/blob/main/.husky/commit-msg)
- [`commitlint.config.mjs`](https://github.com/storkspear/template-spring/blob/main/commitlint.config.mjs)
- [`.gitmessage`](https://github.com/storkspear/template-spring/blob/main/.gitmessage)

**버전/체인지로그**:
- [`CHANGELOG.md`](https://github.com/storkspear/template-spring/blob/main/CHANGELOG.md)

**파생 레포 전파 도구**:
- [`docs/journey/cross-repo-cherry-pick.md`](https://github.com/storkspear/template-spring/blob/main/docs/journey/cross-repo-cherry-pick.md)
- [`docs/conventions/git-workflow.md`](https://github.com/storkspear/template-spring/blob/main/docs/conventions/git-workflow.md)

**ArchUnit 템플릿 순수성 강제**:
- [`ArchitectureRules.java`](https://github.com/storkspear/template-spring/blob/main/common/common-testing/src/main/java/com/factory/common/testing/architecture/ArchitectureRules.java) 의 r7, r8, r20

