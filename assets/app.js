mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  fontFamily: 'Noto Sans KR, Inter, sans-serif',
  flowchart: { useMaxWidth: false, htmlLabels: false },
  sequence:   { useMaxWidth: false },
  gantt:      { useMaxWidth: false },
  themeVariables: {
    edgeLabelBackground: '#ffffff',
  }
});

marked.use({
  breaks: true,
  gfm: true,
  html: true,
  renderer: {
    code({ text, lang }) {
      if (lang === 'mermaid') {
        return `<div class="mermaid">${text}</div>`;
      }
      if (!lang) lang = '';
      const validLang = lang && hljs.getLanguage(lang) ? lang : null;
      const highlighted = validLang
        ? hljs.highlight(text, { language: validLang }).value
        : (lang ? hljs.highlightAuto(text).value : text.replace(/&/g, '&amp;').replace(/</g, '&lt;'));
      const langLabel = lang ? `<div class="code-lang">${lang}</div>` : '';
      return `<div style="position:relative">${langLabel}<pre class="hljs"><code>${highlighted}</code></pre></div>`;
    },
    heading({ text, depth, raw }) {
      const slug = raw
        .replace(/`[^`]*`/g, m => m.slice(1, -1))
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .trim()
        .replace(/\s+/g, '-');
      return `<h${depth} id="${slug}">${text}</h${depth}>\n`;
    }
  }
});

let META = {};

// 관련 문서 / 책 목차 섹션을 content에서 분리해 doc-footer로 이동
function extractDocFooter(contentEl) {
  const children = Array.from(contentEl.children);
  const footerPatterns = [/관련\s*문서/, /책\s*목차/];

  let splitIdx = -1;
  for (let i = 0; i < children.length; i++) {
    const el = children[i];
    if (el.tagName === 'H2') {
      const text = el.textContent.replace(/^\d+\.\s*/, '').trim();
      if (footerPatterns.some(p => p.test(text))) {
        // 앞에 <hr>이 있으면 그것도 포함
        splitIdx = (i > 0 && children[i - 1].tagName === 'HR') ? i - 1 : i;
        break;
      }
    }
  }

  if (splitIdx === -1) return null;

  const toMove = children.slice(splitIdx);
  const wrapper = document.createElement('div');
  toMove.forEach(el => {
    contentEl.removeChild(el);
    wrapper.appendChild(el);
  });
  return wrapper.innerHTML;
}

function transformEmoji(html) {
  return html
    .replace(/✅/g, '<span class="si si-check"></span>')
    .replace(/❌/g, '<span class="si si-cross"></span>')
    .replace(/🔴/g, '<span class="si si-dot si-red"></span>')
    .replace(/🟡/g, '<span class="si si-dot si-yellow"></span>')
    .replace(/🟢/g, '<span class="si si-dot si-green"></span>')
    .replace(/⚠️/g, '<span class="si si-warn"></span>')
    .replace(/🚨/g, '<span class="si si-alert"></span>');
}

// .md 상대 경로 링크를 SPA 내부 라우팅으로 인터셉트
function interceptDocLinks(el, currentDocPath) {
  const baseDir = currentDocPath.includes('/')
    ? currentDocPath.slice(0, currentDocPath.lastIndexOf('/') + 1)
    : '';

  el.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto')) return;
    // .md 뒤에 #anchor 가 붙어있어도 처리 (예: './adr-002.md#adr-002')
    const mdIdx = href.indexOf('.md');
    if (mdIdx === -1) return;

    const mdPath = href.slice(0, mdIdx + 3);        // .md 까지
    const anchor = href.slice(mdIdx + 3);            // '#adr-002' 또는 ''
    const targetId = anchor ? anchor.slice(1) : null;

    const raw = baseDir + mdPath;
    const parts = raw.split('/');
    const resolved = [];
    for (const p of parts) {
      if (p === '..') resolved.pop();
      else if (p && p !== '.') resolved.push(p);
    }
    const docPath = resolved.join('/');

    a.setAttribute('href', '#' + docPath + anchor);
    a.addEventListener('click', e => {
      e.preventDefault();
      const p = loadDoc(docPath);
      // 로드 완료 후 anchor 로 스크롤
      if (targetId && p && typeof p.then === 'function') {
        p.then(() => {
          const target = document.getElementById(targetId);
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      } else if (targetId) {
        setTimeout(() => {
          const target = document.getElementById(targetId);
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      }
    });
  });
}

function isMobile() { return window.innerWidth <= 768; }

let _typewriterTimer = null;
function typewriter(el, text, speed = 32) {
  if (_typewriterTimer) clearTimeout(_typewriterTimer);
  el.textContent = '';
  let i = 0;
  function tick() {
    if (i < text.length) {
      el.textContent += text[i++];
      _typewriterTimer = setTimeout(tick, speed);
    }
  }
  tick();
}

async function loadDoc(docPath) {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.doc === docPath);
  });
  if (isMobile()) closeMobileSidebar();

  const meta = META[docPath] || { title: docPath.split('/').pop().replace('.md', ''), desc: '' };
  typewriter(document.getElementById('post-title'), meta.title, 32);
  document.getElementById('post-desc').textContent = meta.desc;
  document.getElementById('content').innerHTML =
    '<p style="color:#9ca3af;text-align:center;padding:60px 0">로딩 중...</p>';

  const docFooterEl = document.getElementById('doc-footer');
  docFooterEl.style.display = 'none';
  docFooterEl.innerHTML = '';

  try {
    const res = await fetch('docs/' + docPath);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    let md = await res.text();
    md = md.replace(/```\n\[개발자 맥북\][\s\S]*?```/g, '\n%%LOCAL_DEV_DIAGRAM%%\n');
    md = md.replace(/```\n\[인터넷 사용자\][\s\S]*?```/g, '\n%%PROD_DIAGRAM%%\n');
    let html = transformEmoji(marked.parse(md));
    html = html.replace(/<p>%%LOCAL_DEV_DIAGRAM%%<\/p>/g, DIAGRAMS['LOCAL_DEV']);
    html = html.replace(/<p>%%PROD_DIAGRAM%%<\/p>/g, DIAGRAMS['PROD']);

    const contentEl = document.getElementById('content');
    contentEl.innerHTML = html;

    document.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));

    let mermaidId = 0;
    for (const el of document.querySelectorAll('#content .mermaid')) {
      const code = el.textContent.trim();
      const id = `mermaid-${mermaidId++}`;
      try {
        const { svg } = await mermaid.render(id, code);
        el.innerHTML = svg;
        const svgEl = el.querySelector('svg');
        if (svgEl) {
          svgEl.style.maxWidth = '100%';
          svgEl.setAttribute('overflow', 'visible');
          const vb = svgEl.getAttribute('viewBox');
          if (vb) {
            const [x, y, w, h] = vb.trim().split(/[\s,]+/).map(Number);
            svgEl.setAttribute('viewBox', `${x} ${y} ${w + 40} ${h + 10}`);
          }
        }
      } catch(e) {
        el.innerHTML = `<pre style="color:red">${e.message}</pre>`;
      }
    }

    // footer 섹션 분리
    const footerHtml = extractDocFooter(contentEl);
    if (footerHtml) {
      docFooterEl.innerHTML = footerHtml;
      docFooterEl.style.display = 'block';
      interceptDocLinks(docFooterEl, docPath);
    }

    // 모바일 테이블 스크롤 래핑
    if (isMobile()) {
      contentEl.querySelectorAll('table').forEach(table => {
        if (table.closest('.table-wrap')) return;
        const wrap = document.createElement('div');
        wrap.className = 'table-wrap';
        table.parentNode.insertBefore(wrap, table);
        wrap.appendChild(table);
      });
    }

    interceptDocLinks(contentEl, docPath);

    window.scrollTo(0, 0);
    history.pushState({ doc: docPath }, '', '#' + docPath);
  } catch (e) {
    document.getElementById('content').innerHTML =
      `<p style="color:#ef4444;padding:20px">오류: ${e.message}</p>`;
  }
}

// 문서별 Lucide 아이콘 + 색상. 각 문서 주제에 맞는 개별 아이콘.
// 색상은 그룹 단위로 묶어서 시각적 그룹핑 유지.
const NAV_ICON_BY_PATH = {
  // ── Level 0: 입문 (초록 계열) ───────────────────────
  'onboarding/README.md':              { icon: 'map',            color: '#22c55e' },  // 전체 지도
  'onboarding/getting-started.md':     { icon: 'compass',        color: '#22c55e' },  // 방향 잡기
  'onboarding/what-is-this.md':        { icon: 'circle-help',    color: '#22c55e' },  // "이게 뭐야?"
  'onboarding/five-minute-tour.md':    { icon: 'timer',          color: '#22c55e' },  // 5분
  'onboarding/first-run.md':           { icon: 'play',           color: '#22c55e' },  // 첫 실행
  'onboarding/first-change.md':        { icon: 'pencil-line',    color: '#22c55e' },  // 첫 수정
  'onboarding/first-deploy.md':        { icon: 'rocket',         color: '#22c55e' },  // 첫 배포

  // ── Level 1: 시작 (파랑 계열) ───────────────────────
  'start/onboarding.md':               { icon: 'user-plus',      color: '#3b82f6' },  // 신규 개발자
  'start/social-auth-setup.md':        { icon: 'key-round',      color: '#3b82f6' },  // OAuth 키
  'start/app-scaffolding.md':          { icon: 'package-plus',   color: '#3b82f6' },  // 앱 생성
  'start/dogfood-setup.md':            { icon: 'dog',            color: '#3b82f6' },  // 도그푸드
  'start/dogfood-faq.md':              { icon: 'message-circle-question', color: '#3b82f6' },
  'start/dogfood-pitfalls.md':         { icon: 'triangle-alert', color: '#3b82f6' },  // 함정
  'start/cross-repo-cherry-pick.md':   { icon: 'cherry',         color: '#3b82f6' },  // cherry-pick

  // ── Level 2: 구조 (보라 계열) ───────────────────────
  'structure/architecture.md':             { icon: 'building-2',     color: '#a855f7' },  // 건축
  'structure/module-dependencies.md':      { icon: 'network',        color: '#a855f7' },  // 의존 그래프
  'structure/architecture-rules.md':       { icon: 'shield-check',   color: '#a855f7' },  // ArchUnit 규칙
  'structure/multitenant-architecture.md': { icon: 'users-round',    color: '#a855f7' },  // 다중 테넌트
  'structure/jwt-authentication.md':       { icon: 'lock-keyhole',   color: '#a855f7' },  // 인증

  // ── Level 3: 철학 ADR (호박 계열) ────────────────────
  'philosophy/README.md':                              { icon: 'book-open-text',      color: '#f59e0b' },
  // 모듈 설계
  'philosophy/adr-001-modular-monolith.md':            { icon: 'box',                 color: '#f59e0b' },
  'philosophy/adr-002-use-this-template.md':           { icon: 'copy-plus',           color: '#f59e0b' },
  'philosophy/adr-003-api-impl-split.md':              { icon: 'split',               color: '#f59e0b' },
  'philosophy/adr-004-gradle-archunit.md':             { icon: 'shield',              color: '#f59e0b' },
  // 데이터 & 인증
  'philosophy/adr-005-db-schema-isolation.md':         { icon: 'database',            color: '#f59e0b' },
  'philosophy/adr-006-hs256-jwt.md':                   { icon: 'key-square',          color: '#f59e0b' },
  'philosophy/adr-012-per-app-user-model.md':          { icon: 'user-cog',            color: '#f59e0b' },
  'philosophy/adr-013-per-app-auth-endpoints.md':      { icon: 'fingerprint',         color: '#f59e0b' },
  // 운영 철학
  'philosophy/adr-007-solo-friendly-operations.md':    { icon: 'user-round',          color: '#f59e0b' },
  'philosophy/adr-008-no-api-versioning.md':           { icon: 'minus-circle',        color: '#f59e0b' },
  // 엔티티 & 쿼리
  'philosophy/adr-009-base-entity.md':                 { icon: 'layers',              color: '#f59e0b' },
  'philosophy/adr-010-search-condition.md':            { icon: 'search',              color: '#f59e0b' },
  // 레이어 설계
  'philosophy/adr-011-layered-port-adapter.md':        { icon: 'layers-3',            color: '#f59e0b' },
  // 테스트 & 배포
  'philosophy/adr-014-no-delegation-mock.md':          { icon: 'ban',                 color: '#f59e0b' },
  'philosophy/adr-015-conventional-commits-semver.md': { icon: 'git-commit-horizontal',color: '#f59e0b' },
  'philosophy/adr-016-dto-mapper-forbidden.md':        { icon: 'unplug',              color: '#f59e0b' },

  // ── Convention (인디고 계열) ─────────────────────────
  'convention/README.md':              { icon: 'list-ordered',     color: '#6366f1' },
  'convention/design-principles.md':   { icon: 'diamond',          color: '#6366f1' },  // SOLID
  'convention/naming.md':              { icon: 'tag',              color: '#6366f1' },
  'convention/records-and-classes.md': { icon: 'file-code',        color: '#6366f1' },
  'convention/dto-factory.md':         { icon: 'factory',          color: '#6366f1' },
  'convention/exception-handling.md':  { icon: 'octagon-alert',    color: '#6366f1' },
  'convention/git-workflow.md':        { icon: 'git-branch',       color: '#6366f1' },

  // ── API (청록 계열) ──────────────────────────────────
  'api-and-functional/api/api-response.md':               { icon: 'reply',       color: '#06b6d4' },
  'api-and-functional/api/json-contract.md':              { icon: 'braces',      color: '#06b6d4' },  // JSON
  'api-and-functional/api/versioning.md':                 { icon: 'git-compare', color: '#06b6d4' },
  'api-and-functional/api/flutter-backend-integration.md':{ icon: 'smartphone',  color: '#06b6d4' },

  // ── Functional (분홍 계열) ───────────────────────────
  'api-and-functional/functional/push-notifications.md': { icon: 'bell',             color: '#ec4899' },
  'api-and-functional/functional/email-verification.md': { icon: 'mail-check',       color: '#ec4899' },
  'api-and-functional/functional/storage.md':            { icon: 'hard-drive',       color: '#ec4899' },
  'api-and-functional/functional/migration.md':          { icon: 'database-backup',  color: '#ec4899' },
  'api-and-functional/functional/seed-data-management.md':{ icon: 'sprout',          color: '#ec4899' },
  'api-and-functional/functional/rate-limiting.md':      { icon: 'gauge',            color: '#ec4899' },
  'api-and-functional/functional/observability.md':      { icon: 'activity',         color: '#ec4899' },

  // ── Production: Deploy (주황 계열) ───────────────────
  'production/deploy/infrastructure.md':  { icon: 'server',         color: '#f97316' },
  'production/deploy/decisions-infra.md': { icon: 'clipboard-list', color: '#f97316' },
  'production/deploy/ci-cd-flow.md':      { icon: 'workflow',       color: '#f97316' },
  'production/deploy/deployment.md':      { icon: 'cloud-upload',   color: '#f97316' },
  'production/deploy/runbook.md':         { icon: 'book-marked',    color: '#f97316' },

  // ── Production: Setup (슬레이트 계열) ────────────────
  'production/setup/key-rotation.md':     { icon: 'refresh-cw',     color: '#64748b' },
  'production/setup/mac-mini-setup.md':   { icon: 'monitor',        color: '#64748b' },
  'production/setup/monitoring-setup.md': { icon: 'chart-line',     color: '#64748b' },
  'production/setup/storage-setup.md':    { icon: 'hard-drive-download', color: '#64748b' },

  // ── Production: Test (에메랄드 계열) ─────────────────
  'production/test/testing-strategy.md':  { icon: 'flask-conical',  color: '#10b981' },
  'production/test/contract-testing.md':  { icon: 'file-check',     color: '#10b981' },

  // ── Reference (앰버 계열) ────────────────────────────
  'reference/glossary.md':    { icon: 'book-a',          color: '#eab308' },  // 사전 (abc)
  'reference/environment.md': { icon: 'package',         color: '#eab308' },  // 패키지 인벤토리
  'reference/edge-cases.md':  { icon: 'octagon-alert',   color: '#eab308' },
  'reference/STYLE_GUIDE.md': { icon: 'pen-tool',        color: '#eab308' },

  // ── Planned (로즈 계열) ──────────────────────────────
  'planned/backlog.md': { icon: 'list-todo', color: '#f43f5e' },
};

function iconFor(path) {
  if (!path) return null;
  return NAV_ICON_BY_PATH[path] || { icon: 'file-text', color: '#9ca3af' };
}

function iconHTML(path) {
  const hit = iconFor(path);
  if (!hit) return '<span class="nav-icon-wrap"></span>';
  // Lucide 가 <i> 를 <svg> 로 교체하므로 외부에 <span class="nav-icon-wrap"> 로
  // 안정적인 wrapper 를 둠. CSS 는 wrapper 에 레이아웃, svg 에 사이즈/색상/transform.
  return `<span class="nav-icon-wrap"><i class="nav-icon" data-lucide="${hit.icon}" style="color:${hit.color}"></i></span>`;
}

function buildSidebar(manifest) {
  const sidebar = document.querySelector('.sidebar');

  const brand = document.createElement('div');
  brand.className = 'sidebar-brand';
  brand.innerHTML = `
    <div class="name">${manifest.brand.name}</div>
    <div class="sub">${manifest.brand.sub}</div>
    <button class="sidebar-close-btn" id="sidebar-close-btn" title="사이드바 접기">
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
        <rect x="1" y="1" width="4.5" height="13" rx="1" stroke="currentColor" stroke-width="1.2"/>
        <path d="M8.5 4.5L6.5 7.5L8.5 10.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>`;
  sidebar.appendChild(brand);

  manifest.groups.forEach(group => {
    const groupEl = document.createElement('div');
    groupEl.className = 'nav-group';
    groupEl.textContent = group.name;
    sidebar.appendChild(groupEl);

    group.files.forEach(file => {
      const isSubcategory = !file.path;
      if (file.path) {
        META[file.path] = { title: file.title, desc: file.desc };
        const a = document.createElement('a');
        a.className = 'nav-item';
        a.dataset.doc = file.path;
        const descHtml = file.desc ? `<span class="nav-item-desc">${file.desc}</span>` : '';
        a.innerHTML = `${iconHTML(file.path)}<span class="nav-item-inner"><span class="nav-item-title">${file.title}</span>${descHtml}</span>`;
        sidebar.appendChild(a);
      } else {
        // 경로 없는 서브카테고리 헤더 (비클릭, 순수 레이블)
        const sub = document.createElement('div');
        sub.className = 'nav-subcategory';
        sub.textContent = file.title;
        sidebar.appendChild(sub);
      }

      if (file.children) {
        file.children.forEach(child => {
          META[child.path] = { title: child.title, desc: child.desc };
          const ca = document.createElement('a');
          // 서브카테고리의 children 은 1-depth (최상위 동급), 파일의 children 은 2-depth (들여쓰기)
          ca.className = isSubcategory ? 'nav-item' : 'nav-item nav-item-child';
          ca.dataset.doc = child.path;
          const childDescHtml = child.desc ? `<span class="nav-item-desc">${child.desc}</span>` : '';
          ca.innerHTML = `${iconHTML(child.path)}<span class="nav-item-inner"><span class="nav-item-title">${child.title}</span>${childDescHtml}</span>`;
          sidebar.appendChild(ca);
        });
      }
    });
  });

  sidebar.addEventListener('click', e => {
    const item = e.target.closest('.nav-item');
    if (item && item.dataset.doc) loadDoc(item.dataset.doc);
  });

  // Lucide 아이콘 렌더링 (data-lucide 속성을 실제 SVG 로 치환)
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

async function init() {
  const res = await fetch('docs/manifest.json');
  const manifest = await res.json();
  buildSidebar(manifest);

  const hash = location.hash.slice(1);
  const firstDoc = manifest.groups[0].files[0].path;
  loadDoc(hash || firstDoc);
}

window.addEventListener('popstate', e => {
  if (e.state && e.state.doc) loadDoc(e.state.doc);
});

const backdrop = document.createElement('div');
backdrop.id = 'sidebar-backdrop';
document.body.appendChild(backdrop);
backdrop.addEventListener('click', closeMobileSidebar);

function closeMobileSidebar() {
  document.body.classList.remove('sidebar-open');
}

function toggleSidebar() {
  if (isMobile()) {
    document.body.classList.toggle('sidebar-open');
  } else {
    document.body.classList.toggle('sidebar-collapsed');
  }
}

document.getElementById('sidebar-open-btn').addEventListener('click', toggleSidebar);
document.addEventListener('click', e => {
  if (e.target.closest('#sidebar-close-btn')) toggleSidebar();
});

if (isMobile()) {
  document.body.classList.add('sidebar-collapsed');
}

init();
