# 도그푸딩 FAQ

설정 절차와 문제 해결 설명을 [셋업 가이드](./dogfood-setup.md)와 [함정 모음](./dogfood-pitfalls.md)에 합쳤어요. 기존 질문과 링크는 여기서 계속 찾을 수 있어요.

### Q1. "Use this template" 으로 만든 파생 레포에서도 도그푸딩을 해야 하나요?

[통합한 설명 보기](./dogfood-setup.md#1-개요)

### Q2. 한 번 정리한 뒤에 셋업을 다시 반복해도 되나요?

[통합한 설명 보기](./dogfood-setup.md#trial-retry)

<a id="q3-patreferenceglossarymdci--배포-파이프라인-없이-github_token-만으로-가능한가요"></a>
<a id="q3-pat-없이-github_token-만으로-가능한가요"></a>

### Q3. [PAT](../reference/glossary.md#ci--배포-파이프라인) 없이 `GITHUB_TOKEN` 만으로 가능한가요?

[통합한 설명 보기](./dogfood-pitfalls.md#ghcr-auth)

<a id="q4-deploy_enabledfalse-일-때도-github-actions-비용이-드나요"></a>

### Q4. `DEPLOY_ENABLED=false` 일 때도 GitHub Actions 비용이 드나요?

[통합한 설명 보기](./dogfood-setup.md#ci-deploy-gates)

### Q5. Mac mini 가 아니라 다른 호스트(예: 클라우드 VPS)면요?

[통합한 설명 보기](./dogfood-setup.md#other-hosts)

### Q6. 정리 후 Mac mini 의 `kamal-proxy` 컨테이너가 사라졌어요. 다음 배포는 또 셋업부터인가요?

[통합한 설명 보기](./dogfood-setup.md#9-trial-환경-자동화--toolsdogfoodingsetupsh--cleanupsh-선택)

### Q7. `.env.dogfood` 를 실수로 commit 하면요?

[통합한 설명 보기](./dogfood-setup.md#10-보안--노출-시-즉시-폐기)

### Q8. 도그푸딩으로 띄운 컨테이너가 운영 트래픽도 받을 수 있나요?

[통합한 설명 보기](./dogfood-setup.md#trial-traffic)

### Q9. `setup.sh` 가 중간에 실패하면 어디서부터 다시 실행하나요?

[통합한 설명 보기](./dogfood-setup.md#trial-retry)

### Q10. 외부 도메인 없이 localhost 로 검증만 할 수 있나요?

[통합한 설명 보기](./dogfood-setup.md#private-network-check)

### Q11. 11번 시도했다는데, 다시 셋업하면 또 11번 걸리나요?

[통합한 설명 보기](./dogfood-pitfalls.md#개요)

<a id="q12-공동-작업자나-fresh-clone-받은-두-번째-작업자도-init-prodsh--init-localsh-를-돌려야-하나요-a-idq12a"></a>
<a id="q12-공동-작업자나-fresh-clone-받은-두-번째-작업자도-init-prodsh--init-localsh-를-돌려야-하나요-"></a>

### Q12. 공동 작업자나 fresh clone 받은 두 번째 작업자도 `init-prod.sh` · `init-local.sh` 를 돌려야 하나요? <a id="q12"></a>

[통합한 설명 보기](./dogfood-setup.md#15-공동-작업자-모드-fresh-clone)

### Q13. `verify-server.sh` 의 7단계는 무엇을 검증하나요?

[통합한 설명 보기](./dogfood-setup.md#7-verify-serversh-7-단계-검증)

<a id="q14-init-prodsh-의-1회차와-2회차는-어떻게-자동으로-갈리나요-"></a>

### Q14. `init-prod.sh` 의 1회차와 2회차는 어떻게 자동으로 갈리나요? <a id="q14"></a>

[통합한 설명 보기](./dogfood-setup.md#4-init-prodsh-1회차--envprod-자동-생성)

<a id="q15-resend_test_admin_user_email-은-왜-init-prodsh-카탈로그에-없나요-a-idq15a"></a>
<a id="q15-resend_test_admin_user_email-은-왜-init-prodsh-카탈로그에-없나요-"></a>

### Q15. `RESEND_TEST_ADMIN_USER_EMAIL` 은 왜 `init-prod.sh` 카탈로그에 없나요? <a id="q15"></a>

[통합한 설명 보기](./dogfood-setup.md#email-verification-recipient)

<a id="q16-원본-template-spring-자체를-clone-받으면-어떻게-동작하나요-"></a>

### Q16. 원본 `template-spring` 자체를 clone 받으면 어떻게 동작하나요? <a id="q16"></a>

[통합한 설명 보기](./dogfood-setup.md#15-공동-작업자-모드-fresh-clone)

<a id="q17-app_credentials_slug_-를-envprod-에-추가하면-운영에-자동-반영되나요-a-idq17a"></a>
<a id="q17-app_credentials_slug_-를-envprod-에-추가하면-운영에-자동-반영되나요-"></a>

### Q17. `APP_CREDENTIALS_<SLUG>_*` 를 `.env.prod` 에 추가하면 운영에 자동 반영되나요? <a id="q17"></a>

[통합한 설명 보기](./dogfood-setup.md#app-credentials-chain)

## 더 궁금한 게 있다면

[셋업 가이드](./dogfood-setup.md)에서 준비·설정·검증을, [함정 모음](./dogfood-pitfalls.md)에서 증상별 확인 방법을 찾아보세요.

## 다음 단계

설정을 마쳤다면 셋업 가이드의 [다음 단계](./dogfood-setup.md#다음-단계)로 이어가세요.
