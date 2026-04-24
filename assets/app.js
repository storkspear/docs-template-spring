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

// 문서 경로 → Lucide 아이콘 이름 매핑. 문서 성격에 맞는 아이콘 선택.
const NAV_ICONS = [
  { prefix: 'onboarding/',                 icon: 'compass' },         // Level 0 — 방향 잡기
  { prefix: 'start/',                      icon: 'rocket' },          // Level 1 — 시작
  { prefix: 'structure/',                  icon: 'layout-grid' },     // Level 2 — 구조
  { prefix: 'philosophy/',                 icon: 'scroll-text' },     // Level 3 — ADR (결정 기록)
  { prefix: 'convention/',                 icon: 'ruler' },           // 코딩 규약
  { prefix: 'api-and-functional/api/',     icon: 'plug' },            // API 계약
  { prefix: 'api-and-functional/functional/', icon: 'sparkles' },     // 기능
  { prefix: 'production/deploy/',          icon: 'ship' },            // 배포
  { prefix: 'production/setup/',           icon: 'wrench' },          // 설정 (How-to)
  { prefix: 'production/test/',            icon: 'flask-conical' },   // 테스트
  { prefix: 'reference/',                  icon: 'book-open' },       // 참고 자료
  { prefix: 'planned/',                    icon: 'list-todo' },       // 예정 항목
];

function iconFor(path) {
  if (!path) return null;
  const hit = NAV_ICONS.find(e => path.startsWith(e.prefix));
  return hit ? hit.icon : 'file-text';
}

function iconHTML(path) {
  const name = iconFor(path);
  return name ? `<i class="nav-icon" data-lucide="${name}"></i>` : '<span class="nav-icon-placeholder"></span>';
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
