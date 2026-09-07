/*
 * Driver for the X Articles composer (Draft.js).
 *
 * Verified against x.com on 2026-09-07:
 *  - composer:        [data-testid="composer"], blocks [data-block="true"]
 *  - title:           textarea[placeholder="Add a title"]
 *  - toolbar Insert:  button whose visible text is "Insert"; opens [role="menuitem"]s
 *                     Media / GIF / Posts / Link preview / Divider / Code / LaTeX / Table
 *  - Table flow:      menuitem Table -> size grid (button "Insert a 1 by 1 table")
 *                     -> block <section> with <table> + pencil/close buttons
 *                     -> pencil opens dialog with <textarea> (GFM) and "Update" button
 *  - Code flow:       menuitem Code -> dialog with language <input>, <textarea>, "Insert"
 *  - Rich text:       synthetic ClipboardEvent('paste') with text/html on the composer
 */
(function (root) {
  const XMD = (root.XMD = root.XMD || {});

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(fn, { timeout = 8000, interval = 80, label = 'condition' } = {}) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(interval);
    }
    throw new Error(`Timed out waiting for ${label}`);
  }

  const q = (sel, r = document) => r.querySelector(sel);
  const qa = (sel, r = document) => Array.from(r.querySelectorAll(sel));
  const byText = (els, text) => els.find((e) => e.textContent.trim() === text);

  function composer() {
    return q('[data-testid="composer"]');
  }
  function blocks() {
    const c = composer();
    return c ? qa('[data-block="true"]', c) : [];
  }
  function isEmpty() {
    const b = blocks();
    return b.length <= 1 && b.every((x) => x.textContent.trim() === '' && !x.querySelector('table,pre,img'));
  }

  function setReactValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function setTitle(text) {
    const ta = await waitFor(() => q('textarea[placeholder="Add a title"]'), { label: 'title field' });
    ta.focus();
    setReactValue(ta, text);
    await sleep(150);
    ta.blur();
  }

  // Focus the composer and put the caret at the very end of the last block.
  async function placeCursorAtEnd() {
    const c = await waitFor(composer, { label: 'composer' });
    c.focus();
    await sleep(50);
    const b = blocks();
    const last = b[b.length - 1];
    if (!last) return;
    const range = document.createRange();
    range.selectNodeContents(last);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    await sleep(80);
  }

  async function pasteHtml(html, plain) {
    const c = composer();
    const dt = new DataTransfer();
    dt.setData('text/html', html);
    dt.setData('text/plain', plain || html.replace(/<[^>]+>/g, ''));
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    c.dispatchEvent(ev);
    await sleep(250);
  }

  function insertButton() {
    // The toolbar "Insert ▾" button. Fall back to its aria-label.
    return byText(qa('button'), 'Insert') || q('button[aria-label="Add Media"]');
  }

  async function openInsertItem(label) {
    const btn = await waitFor(insertButton, { label: 'Insert button' });
    btn.click();
    const item = await waitFor(() => byText(qa('[role="menuitem"]'), label), { label: `menu item ${label}` });
    item.click();
  }

  // Dialog nodes get replaced by React while they animate in, so never hold a
  // reference to one: query "[role=dialog] ..." fresh on every poll.
  const dialog = () => q('[role="dialog"]');
  const inDialog = (sel) => q('[role="dialog"] ' + sel);
  const dialogButton = (text) => byText(qa('[role="dialog"] button'), text);
  const waitDialogClosed = () => waitFor(() => !dialog(), { label: 'dialog to close' });

  function tableSections() {
    return blocks().filter((b) => b.querySelector('table'));
  }

  async function insertTable(markdown) {
    const before = tableSections().length;
    await openInsertItem('Table');
    const cell = await waitFor(() => inDialog('button[aria-label="Insert a 1 by 1 table"]'), { label: '1x1 cell' });
    cell.click();
    await waitDialogClosed();

    const section = await waitFor(
      () => {
        const s = tableSections();
        return s.length > before ? s[s.length - 1] : null;
      },
      { label: 'new table block' }
    );
    const btns = qa('button', section);
    const edit = btns.find((b) => /edit|수정/i.test(b.getAttribute('aria-label') || '')) || btns[0];
    if (!edit) throw new Error('Table edit button not found');
    edit.click();

    const ta = await waitFor(() => inDialog('textarea'), { label: 'table markdown textarea' });
    setReactValue(ta, markdown);
    await sleep(120);
    const update = await waitFor(() => dialogButton('Update'), { label: 'Update button' });
    update.click();
    await waitDialogClosed();
    await sleep(200);
  }

  async function insertCode(text, lang) {
    await openInsertItem('Code');
    const ta = await waitFor(() => inDialog('textarea'), { label: 'code textarea' });
    setReactValue(ta, text);
    if (lang) {
      // Best effort: type the language and pick the first suggestion if one appears.
      const input = inDialog('input');
      if (input) {
        setReactValue(input, lang);
        const opt = await waitFor(() => inDialog('[role="option"], [role="listbox"] [role="menuitem"]'), {
          timeout: 1200,
          label: 'language option',
        }).catch(() => null);
        if (opt) opt.click();
      }
    }
    await sleep(120);
    const ins = await waitFor(() => dialogButton('Insert'), { label: 'Insert button' });
    ins.click();
    await waitDialogClosed();
    await sleep(200);
  }

  async function insertDivider() {
    await openInsertItem('Divider');
    await sleep(250);
  }

  // Run a parsed plan against the editor. onProgress(i, total, block) is optional.
  async function runPlan(plan, { onProgress } = {}) {
    if (plan.title) await setTitle(plan.title);
    await placeCursorAtEnd();
    const total = plan.blocks.length;
    for (let i = 0; i < total; i++) {
      const b = plan.blocks[i];
      if (onProgress) onProgress(i, total, b);
      if (b.type === 'html') await pasteHtml(b.html, b.text);
      else if (b.type === 'table') await insertTable(b.markdown);
      else if (b.type === 'code') await insertCode(b.text, b.lang);
      else if (b.type === 'divider') await insertDivider();
    }
    if (onProgress) onProgress(total, total, null);
  }

  XMD.editor = {
    composer,
    blocks,
    isEmpty,
    setTitle,
    placeCursorAtEnd,
    pasteHtml,
    insertTable,
    insertCode,
    insertDivider,
    runPlan,
    waitFor,
    sleep,
  };
})(typeof window !== 'undefined' ? window : globalThis);
