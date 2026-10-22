# docs-template-spring

[`template-spring`](https://github.com/storkspear/template-spring) 의 `docs/` 를 웹에서 읽을 수 있게 만든 정적 사이트입니다. 이 레포에는 `docs/` 복사본이 들어 있고, SPA (index.html + assets/*) 가 브라우저에서 마크다운을 불러와 렌더링합니다.

## 사이트 주소

**<https://storkspear.github.io/docs-template-spring/>**

사이드바 네비게이션과 Mermaid 다이어그램, 내부 링크의 SPA 라우팅을 지원하고, 문서 아래쪽 footer 카드에서는 책 목차와 관련 문서를 나눠서 보여 줍니다.

## 구조

```
.
├── index.html            # SPA 진입점
├── assets/
│   ├── app.js            # 마크다운 로드 / 렌더 / 사이드바 / 링크 인터셉트
│   ├── style.css
│   └── diagrams.js       # ASCII 아트 → 커스텀 다이어그램 변환
└── docs/
    ├── manifest.json     # 사이드바 그룹 · 문서 순서 정의
    └── **/*.md           # template-spring 에서 복사된 문서
```

## 로컬에서 실행

```bash
python3 -m http.server 8878
# http://localhost:8878 접속
```

`file://` 로 직접 열면 CORS 정책 때문에 `fetch('docs/...')` 요청이 실패하므로, 반드시 로컬 서버를 띄워서 확인합니다.

## 문서를 수정하는 순서

1. `template-spring/docs/` 에서 먼저 수정하고 push 합니다.
2. 수정한 파일을 이 레포의 `docs/` 로 복사합니다. 직접 복사해도 되고 스크립트를 사용해도 됩니다.
3. 새 파일을 추가했거나 문서 순서를 바꿨다면 `manifest.json` 도 함께 수정합니다.
4. commit 하고 push 하면 GitHub Actions 가 GitHub Pages 에 배포합니다.

## 자동 배포

main 에 push 하면 `.github/workflows/` 의 Pages workflow 가 자동으로 배포합니다. 따로 빌드하는 단계 없이 정적 파일만 업로드합니다.

## 참고

- 원본 레포: [`template-spring`](https://github.com/storkspear/template-spring)
- 다른 템플릿 문서 사이트: [`docs-template-flutter`](https://storkspear.github.io/docs-template-flutter/)
