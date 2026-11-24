# docs-template-spring

[`template-spring`](https://github.com/storkspear/template-spring)의 문서를 웹에서 읽을 수 있게 제공하는 미러예요. 문서 본문은 원본 저장소의 `docs/`에서, 뷰어와 탐색 메뉴는 이 저장소에서 관리해요.

## 사이트 주소

[문서 사이트 열기](https://storkspear.github.io/docs-template-spring/)

문서 사이트는 공개되어 있어요. 원본 소스 링크는 해당 저장소에 접근할 수 있는 계정이 필요해요. 사이트에서 문서를 고르면 마크다운을 불러오고, 표·코드·Mermaid 그림을 표시해요.

## 구조

| 경로 | 역할 |
|---|---|
| `index.html` | 문서 사이트 진입점 |
| `blog_server.py` | 로컬 확인용 서버 |
| `assets/app.js` | 문서 표시, 사이드바, 링크 이동 |
| `assets/style.css` | 화면 스타일 |
| `assets/diagrams.js` | 뷰어 전용 그림 |
| `docs/manifest.json` | 사이드바 그룹, 문서 순서와 소개 |
| `docs/**/*.md` | 원본에서 가져온 문서 |

## 로컬에서 실행

저장소 루트에서 실행하고 `http://localhost:8878`을 열어요.

```bash
python3 -m http.server 8878 --bind 127.0.0.1
```

`blog_server.py`도 로컬 확인에 사용할 수 있어요. HTML 파일을 직접 열면 브라우저가 문서 요청을 차단할 수 있으므로 HTTP 서버로 확인해주세요.

## 문서를 수정하는 순서

1. 원본 `template-spring/docs/`에서 본문을 수정해요.
2. 로컬 확인은 원본 저장소의 `tools/docs/sync-docs.sh`로 이 미러에 동기화해요. `--dry-run`을 붙이면 실제 복사 전에 변경 목록을 볼 수 있어요.
3. 문서가 추가되거나 통합됐다면 이 저장소의 `docs/manifest.json`도 고쳐요. 통합된 문서의 옛 주소와 절 링크는 이동 안내로 유지해요.
4. 문서 내용, 링크, PC·모바일 표시를 확인한 뒤 원본 main에 반영해요. 원본의 `sync-docs.yml`이 동기화 PR을 만들고 squash 병합해요.
5. 미러 고유 파일의 변경도 이 저장소의 main에 반영해요. 게시가 끝나면 사이트에서 확인해요.

동기화는 원본에서 미러로만 진행해요. 미러의 문서 본문을 직접 고치면 다음 동기화에서 덮어써질 수 있어요. `manifest.json`은 동기화에서 보호하고, 내부 설계·계획 폴더(`superpowers/`, `planned/`)는 공개 미러에 포함하지 않아요.

## 자동 배포

GitHub Pages가 main 브랜치의 루트 폴더를 게시해요. 이 저장소에는 별도 배포 워크플로가 없어요.

## 참고

- [원본 소스](https://github.com/storkspear/template-spring)
- [Spring 문서](https://storkspear.github.io/docs-template-spring/)
- [Flutter 문서](https://storkspear.github.io/docs-template-flutter/)
- [React 관리자 문서](https://storkspear.github.io/docs-template-react-admin/)
