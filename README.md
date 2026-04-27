# docs-template-spring

[`template-spring`](https://github.com/storkspear/template-spring) 의 `docs/` 를 **웹에서 보기 위한 static site** 입니다.
`docs/` 원본은 이 레포 안에 복사본으로 들어있고, SPA (index.html + assets/*) 가 마크다운을 런타임에 렌더링합니다.

## 🌐 라이브 URL

**<https://storkspear.github.io/docs-template-spring/>**

사이드바 네비게이션, Mermaid 다이어그램, 내부 링크 SPA 라우팅, 책 목차 / 관련 문서 분리된 footer 카드 등의 기능을 제공합니다.

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

CORS 이슈 때문에 `file://` 로 직접 열면 `fetch('docs/...')` 가 실패합니다. 반드시 로컬 서버로 서빙하세요.

## 문서 수정 흐름

1. **원본 수정**: `template-spring/docs/` 에서 먼저 수정 후 push
2. **이 레포에 반영**: 해당 파일(들) 을 여기 `docs/` 로 복사 (수동 또는 스크립트)
3. **manifest.json 업데이트** (새 파일 추가 / 순서 변경 시)
4. commit & push → GitHub Actions 가 자동으로 GitHub Pages 배포

## 자동 배포

`.github/workflows/` 의 Pages workflow 가 main push 시 자동으로 배포합니다. 별도 빌드 스텝 없이 정적 파일만 업로드.

## 참고

- 원본 레포: [`template-spring`](https://github.com/storkspear/template-spring)
- 자매 뷰어: [`docs-template-flutter`](https://storkspear.github.io/docs-template-flutter/)
