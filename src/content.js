/*
 * UI + orchestration: a floating "Import .md" button on the X Articles editor,
 * plus drag-and-drop of .md files (or a folder holding the .md and its images).
 */
(function () {
  const XMD = window.XMD;
  if (!XMD || !XMD.editor || !XMD.images) return;

  const OPTIONS = {
    inlineCode: 'plain', // 'plain' | 'backticks'
    cover: 'auto', // 'auto' (leading image becomes the cover) | 'none'
  };

  const EDIT_RE = /^\/compose\/articles\/edit\//;
  const BTN_ID = 'xmd-import-btn';
  const TOAST_ID = 'xmd-toast';
  let busy = false;

  function toast(msg, { sticky = false, kind = 'info' } = {}) {
    let el = document.getElementById(TOAST_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = TOAST_ID;
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.dataset.kind = kind;
    el.hidden = false;
    clearTimeout(el._t);
    if (!sticky) el._t = setTimeout(() => (el.hidden = true), 6000);
  }

  function describe(block) {
    if (!block) return '';
    return { html: '본문', table: '표', code: '코드 블록', divider: '구분선', image: '이미지', cover: '커버 이미지' }[block.type] || block.type;
  }

  function readText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsText(file);
    });
  }

  // files: Map<path, File> from a drop or pick. Picks the .md and resolves images against it.
  async function importFromFiles(files) {
    if (busy) return;
    const mds = XMD.images.findMarkdownFiles(files);
    if (!mds.length) return toast('.md 파일이 없습니다.', { kind: 'error' });
    const mdPath = mds[0];
    if (mds.length > 1) toast(`.md 파일이 ${mds.length}개라 첫 번째(${mdPath})를 가져옵니다.`, { sticky: true });
    const mdFile = files.get(mdPath);
    const text = await readText(mdFile);
    const ctx = { files, mdDir: XMD.images.dirname(mdPath) };
    await importMarkdown(text, mdFile.name, ctx);
  }

  async function importMarkdown(text, name, ctx) {
    if (busy) return;
    busy = true;
    const btn = document.getElementById(BTN_ID);
    if (btn) btn.disabled = true;
    try {
      const plan = XMD.parse(text, OPTIONS);
      const counts = plan.blocks.reduce((a, b) => ((a[b.type] = (a[b.type] || 0) + 1), a), {});
      if (!XMD.editor.isEmpty()) toast('에디터에 내용이 있어 끝에 이어 붙입니다.', { sticky: true });
      const { skipped } = await XMD.editor.runPlan(plan, {
        resolveImage: (img, { forCover }) => XMD.images.resolveImage(img.src, ctx, { forCover }),
        onProgress(i, total, block) {
          if (block) toast(`가져오는 중 ${Math.max(i, 0) + 1}/${total} · ${describe(block)}`, { sticky: true });
        },
      });
      const summary = `완료: ${name || 'markdown'} · 본문 ${counts.html || 0}, 표 ${counts.table || 0}, 코드 ${counts.code || 0}, 이미지 ${counts.image || 0}${plan.cover ? ' + 커버' : ''}`;
      if (skipped.length) {
        console.warn('[xmd] skipped images:\n' + skipped.join('\n'));
        toast(`${summary}\n이미지 ${skipped.length}개는 넣지 못해 텍스트로 남겼습니다 (콘솔 참고).`, { sticky: true, kind: 'warn' });
      } else {
        toast(summary, { kind: 'ok' });
      }
    } catch (e) {
      console.error('[xmd]', e);
      toast(`실패: ${e.message}`, { sticky: true, kind: 'error' });
    } finally {
      busy = false;
      if (btn) btn.disabled = false;
    }
  }

  function pickFiles() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.md,.markdown,.mdown,.mkd,.txt,text/markdown,text/plain,image/*';
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const list = input.files;
      input.remove();
      if (!list || !list.length) return;
      importFromFiles(await XMD.images.collectFiles({ files: list }));
    });
    document.body.appendChild(input);
    input.click();
  }

  function mountButton() {
    if (document.getElementById(BTN_ID)) return;
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.textContent = 'Import .md';
    btn.title = 'Markdown 파일(과 이미지)을 선택하거나, .md 파일 또는 폴더를 페이지에 끌어다 놓으세요';
    btn.addEventListener('click', pickFiles);
    document.body.appendChild(btn);
  }

  function unmountButton() {
    const b = document.getElementById(BTN_ID);
    if (b) b.remove();
  }

  function onDragOver(e) {
    if (!EDIT_RE.test(location.pathname)) return;
    if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }
  async function onDrop(e) {
    if (!EDIT_RE.test(location.pathname)) return;
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
    // Only claim drops that contain a Markdown file somewhere; leave image-only drops to X.
    e.preventDefault();
    e.stopPropagation();
    const files = await XMD.images.collectFiles(e.dataTransfer);
    if (!XMD.images.findMarkdownFiles(files).length) return toast('.md 파일이 없습니다.', { kind: 'error' });
    importFromFiles(files);
  }

  function sync() {
    if (EDIT_RE.test(location.pathname)) mountButton();
    else unmountButton();
  }

  // X is a SPA: watch for route changes.
  let last = location.href;
  setInterval(() => {
    if (location.href !== last) {
      last = location.href;
      sync();
    }
  }, 500);
  document.addEventListener('dragover', onDragOver, true);
  document.addEventListener('drop', onDrop, true);
  sync();

  // Exposed for manual use from the console of the extension's isolated world.
  XMD.importMarkdown = importMarkdown;
  XMD.importFromFiles = importFromFiles;
  XMD.OPTIONS = OPTIONS;
})();
