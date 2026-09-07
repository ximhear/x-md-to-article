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
 *  - Media flow:      menuitem Media -> dialog with input[type=file][multiple]; setting
 *                     .files + change uploads it; "Cancel upload" button exists until done.
 *                     The new <section> has an "Edit media" button and a caption span that
 *                     opens an "Edit Caption" dialog with a contenteditable textbox + Save.
 *  - Cover:           input[type=file][accept="image/jpeg,image/png,image/webp"] outside
 *                     any dialog; setting .files opens a crop dialog whose "Apply" confirms.
 */
(function (root) {
  const XMD = (root.XMD = root.XMD || {});

  // Hidden tabs throttle chained setTimeouts down to once a minute. Hopping through a
  // MessageChannel after every timer resets the nesting level so we only ever pay the
  // 1-second alignment, and waitFor reacts to DOM mutations instead of polling.
  const hop = () =>
    new Promise((r) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => r();
      ch.port2.postMessage(0);
    });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms)).then(hop);

  function waitFor(fn, { timeout = 15000, interval = 250, label = 'condition' } = {}) {
    const end = Date.now() + timeout;
    const first = safe(fn);
    if (first) return Promise.resolve(first);
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = () => {
        done = true;
        mo.disconnect();
        clearInterval(timer);
      };
      const check = () => {
        if (done) return;
        const v = safe(fn);
        if (v) {
          finish();
          resolve(v);
        } else if (Date.now() > end) {
          finish();
          reject(new Error(`Timed out waiting for ${label}`));
        }
      };
      const mo = new MutationObserver(() => queueMicrotask(check));
      mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
      const timer = setInterval(check, interval);
    });
  }
  function safe(fn) {
    try {
      return fn();
    } catch (e) {
      return null;
    }
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
    if (dialog()) await closeDialogs();
    const btn = await waitFor(insertButton, { label: 'Insert button' });
    btn.click();
    const item = await waitFor(() => byText(qa('[role="menuitem"]'), label), { label: `menu item ${label}` });
    item.click();
  }

  // Dialog nodes get replaced by React while they animate in, so never hold a
  // reference to one: query "[role=dialog] ..." fresh on every poll.
  // Dialogs can stack (e.g. Media on top of the cover cropper), so always look in
  // the topmost one first.
  const dialogs = () => qa('[role="dialog"]');
  const dialog = () => dialogs()[0] || null;
  const inDialog = (sel) => {
    const ds = dialogs();
    for (let i = ds.length - 1; i >= 0; i--) {
      const el = ds[i].querySelector(sel);
      if (el) return el;
    }
    return null;
  };
  const dialogButton = (text) => {
    const ds = dialogs();
    for (let i = ds.length - 1; i >= 0; i--) {
      const b = byText(qa('button', ds[i]), text);
      if (b) return b;
    }
    return null;
  };
  const waitDialogClosed = () => waitFor(() => !dialog(), { label: 'dialog to close' });

  // Close whatever dialog is open (leftover from a failed step) so the next step
  // starts from the editor. Tries Close/Back buttons, then Escape.
  async function closeDialogs() {
    for (let i = 0; i < 4 && dialog(); i++) {
      const btn =
        inDialog('button[aria-label="Close"]') ||
        inDialog('button[aria-label="Back"]') ||
        dialogButton('Cancel') ||
        dialogButton('Close');
      if (btn) btn.click();
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
      await sleep(400);
    }
    return !dialog();
  }

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

  function setFiles(input, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // X disables the editor and shows "Cancel upload" / "Processing media…" while a
  // file is uploading. Wait until that is gone.
  async function waitUploadIdle(timeout = 120000) {
    await sleep(300);
    await waitFor(() => !byText(qa('button'), 'Cancel upload') && !qa('button').some((b) => /Processing media/i.test(b.textContent)), {
      timeout,
      interval: 200,
      label: 'upload to finish',
    });
    await sleep(300);
  }

  function imageSections() {
    return blocks().filter((b) => b.querySelector('img, video'));
  }

  // Put text into a React/Draft.js contenteditable box without relying on focus:
  // a synthetic paste first, then execCommand as a fallback.
  async function typeInto(box, text) {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await sleep(150);
    if ((box.textContent || '').includes(text)) return true;
    box.focus();
    await sleep(80);
    if (document.activeElement === box || box.contains(document.activeElement)) {
      document.execCommand('insertText', false, text);
      await sleep(120);
    }
    return (box.textContent || '').includes(text);
  }

  async function setCaption(section, caption) {
    const leaf = qa('*', section).find((e) => e.children.length === 0 && /caption/i.test(e.textContent));
    if (!leaf) return false;
    const titleBox = q('textarea[placeholder="Add a title"]');
    const titleBefore = titleBox ? titleBox.value : null;
    leaf.click();
    const box = await waitFor(() => {
      const d = qa('[role="dialog"]').find((x) => /caption/i.test(x.textContent));
      return d && d.querySelector('[role="textbox"], [contenteditable="true"], textarea');
    }, { label: 'caption box' });
    let ok;
    if (box.tagName === 'TEXTAREA' || box.tagName === 'INPUT') {
      setReactValue(box, caption);
      ok = true;
    } else {
      ok = await typeInto(box, caption);
    }
    const save = await waitFor(() => dialogButton('Save'), { label: 'caption Save' });
    if (ok) save.click();
    else (dialogButton('Close') || inDialog('button[aria-label="Close"]') || save).click();
    await waitDialogClosed();
    await sleep(150);
    // execCommand can leak into whatever had focus; undo that if it hit the title.
    if (titleBox && titleBefore !== null && titleBox.value !== titleBefore) setReactValue(titleBox, titleBefore);
    return ok;
  }

  async function insertImage(file, caption) {
    const before = imageSections().length;
    await openInsertItem('Media');
    const input = await waitFor(() => inDialog('input[type="file"]'), { label: 'media file input' });
    setFiles(input, file);
    await waitDialogClosed();
    const section = await waitFor(
      () => {
        const s = imageSections();
        return s.length > before ? s[s.length - 1] : null;
      },
      { timeout: 30000, label: 'new media block' }
    );
    await waitUploadIdle();
    if (caption) {
      try {
        await setCaption(section, caption);
      } catch (e) {
        console.warn('[xmd] caption skipped:', e.message);
        const close = dialogButton('Close') || inDialog('button[aria-label="Close"]');
        if (close) close.click();
        await waitDialogClosed().catch(() => {});
      }
    }
    await placeCursorAtEnd();
  }

  // Click a dialog button whose handler may ignore early clicks (the cover cropper
  // needs its image decoded first). Re-click every couple of seconds until it is gone.
  async function clickUntilGone(text, { timeout = 60000, every = 2000 } = {}) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const btn = dialogButton(text);
      if (!btn) return true;
      btn.click();
      await waitFor(() => !dialogButton(text), { timeout: every, label: `${text} to take effect` }).catch(() => null);
    }
    return !dialogButton(text);
  }

  async function setCover(file) {
    const input = qa('input[type="file"]').find(
      (i) => i.accept === 'image/jpeg,image/png,image/webp' && !i.closest('[role="dialog"]')
    );
    if (!input) throw new Error('cover image input not found');
    setFiles(input, file);
    await waitFor(() => dialogButton('Apply'), { timeout: 30000, label: 'cover Apply button' });
    // Let the cropper decode the image before applying.
    await waitFor(() => {
      const img = inDialog('img');
      return (img && img.complete && img.naturalWidth > 0) || inDialog('canvas');
    }, { timeout: 15000, label: 'cover preview' }).catch(() => null);
    await sleep(500);
    if (!(await clickUntilGone('Apply'))) throw new Error('cover crop dialog did not close');
    await waitUploadIdle();
  }

  async function insertDivider() {
    await openInsertItem('Divider');
    await sleep(250);
  }

  // Run a parsed plan against the editor.
  //   resolveImage(block|cover, {forCover}) -> File | null (null = skip with fallback text)
  //   onProgress(i, total, block) is optional. Returns { skipped: [reasons] }.
  async function runPlan(plan, { onProgress, resolveImage } = {}) {
    const skipped = [];
    if (plan.title) await setTitle(plan.title);
    if (plan.cover && resolveImage) {
      if (onProgress) onProgress(-1, plan.blocks.length, { type: 'cover' });
      try {
        const file = await resolveImage(plan.cover, { forCover: true });
        if (file) await setCover(file);
        else skipped.push(`cover: ${plan.cover.src}`);
      } catch (e) {
        skipped.push(`cover: ${e.message}`);
        await closeDialogs();
      }
    }
    await placeCursorAtEnd();
    const total = plan.blocks.length;
    for (let i = 0; i < total; i++) {
      const b = plan.blocks[i];
      if (onProgress) onProgress(i, total, b);
      if (b.type === 'html') await pasteHtml(b.html, b.text);
      else if (b.type === 'table') await insertTable(b.markdown);
      else if (b.type === 'code') await insertCode(b.text, b.lang);
      else if (b.type === 'divider') await insertDivider();
      else if (b.type === 'image') {
        let file = null;
        let reason = 'no image resolver';
        if (resolveImage) {
          try {
            file = await resolveImage(b, { forCover: false });
          } catch (e) {
            reason = e.message;
          }
        }
        if (file) {
          try {
            await insertImage(file, b.alt || b.title || '');
          } catch (e) {
            reason = e.message;
            await closeDialogs();
            await placeCursorAtEnd();
            file = null;
          }
        }
        if (!file) {
          skipped.push(`${b.src}: ${reason}`);
          const label = `[image: ${b.alt || b.src}]`;
          const html = /^https?:\/\//i.test(b.src) ? `<p><a href="${b.src}">${label}</a></p>` : `<p>${label}</p>`;
          await pasteHtml(html, label);
        }
      }
    }
    if (onProgress) onProgress(total, total, null);
    return { skipped };
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
    closeDialogs,
    insertImage,
    setCover,
    setCaption,
    waitUploadIdle,
    runPlan,
    waitFor,
    sleep,
  };
})(typeof window !== 'undefined' ? window : globalThis);
