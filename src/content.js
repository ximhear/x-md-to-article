/*
 * UI + orchestration: a floating "Import .md" button on the X Articles editor,
 * plus drag-and-drop of .md files anywhere on the page.
 */
(function () {
  const XMD = window.XMD;
  if (!XMD || !XMD.editor) return;

  const OPTIONS = {
    inlineCode: 'plain', // 'plain' | 'backticks'
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
    if (!sticky) el._t = setTimeout(() => (el.hidden = true), 4000);
  }

  function describe(block) {
    if (!block) return '';
    return { html: '본문', table: '표', code: '코드 블록', divider: '구분선' }[block.type] || block.type;
  }

  async function importMarkdown(text, name) {
    if (busy) return;
    busy = true;
    const btn = document.getElementById(BTN_ID);
    if (btn) btn.disabled = true;
    try {
      const plan = XMD.parse(text, OPTIONS);
      const counts = plan.blocks.reduce((a, b) => ((a[b.type] = (a[b.type] || 0) + 1), a), {});
      if (!XMD.editor.isEmpty()) toast('에디터에 내용이 있어 끝에 이어 붙입니다.', { sticky: true });
      await XMD.editor.runPlan(plan, {
        onProgress(i, total, block) {
          if (block) toast(`가져오는 중 ${i + 1}/${total} · ${describe(block)}`, { sticky: true });
        },
      });
      toast(
        `완료: ${name || 'markdown'} · 본문 ${counts.html || 0}, 표 ${counts.table || 0}, 코드 ${counts.code || 0}, 구분선 ${counts.divider || 0}`,
        { kind: 'ok' }
      );
    } catch (e) {
      console.error('[xmd]', e);
      toast(`실패: ${e.message}`, { sticky: true, kind: 'error' });
    } finally {
      busy = false;
      if (btn) btn.disabled = false;
    }
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsText(file);
    });
  }

  function pickFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.mdown,.txt,text/markdown,text/plain';
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      input.remove();
      if (f) importMarkdown(await readFile(f), f.name);
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
    btn.title = 'Markdown 파일을 X Article로 가져오기 (파일을 페이지에 끌어다 놓아도 됩니다)';
    btn.addEventListener('click', pickFile);
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
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f || !/\.(md|markdown|mdown|txt)$/i.test(f.name)) return;
    e.preventDefault();
    e.stopPropagation();
    importMarkdown(await readFile(f), f.name);
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

  // Expose for manual/e2e use from the console.
  XMD.importMarkdown = importMarkdown;
  XMD.OPTIONS = OPTIONS;
})();
