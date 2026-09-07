/*
 * Turns an image reference from Markdown into a File the X editor accepts.
 *
 *  - data: URLs are decoded in place
 *  - http(s) URLs are fetched by the background worker (cross-origin)
 *  - relative paths are looked up in the files that were dropped or picked
 *    together with the .md (ctx.files: Map<normalized path, File>, ctx.mdDir)
 *
 * Unsupported formats (svg, bmp, ...) are re-encoded to PNG through a canvas
 * when possible. Returns null when the image cannot be resolved.
 */
(function (root) {
  const XMD = (root.XMD = root.XMD || {});

  const BODY_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const EXT_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif' };

  function normalizePath(p) {
    const parts = [];
    for (const seg of String(p).replace(/\\/g, '/').split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') parts.pop();
      else parts.push(seg);
    }
    return parts.join('/');
  }

  function dirname(p) {
    const n = normalizePath(p);
    const i = n.lastIndexOf('/');
    return i < 0 ? '' : n.slice(0, i);
  }

  function basename(p) {
    const n = normalizePath(p);
    return n.slice(n.lastIndexOf('/') + 1);
  }

  function guessMime(name, fallback) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    return EXT_MIME[ext] || fallback || 'application/octet-stream';
  }

  function base64ToFile(base64, mime, name) {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], name, { type: mime });
  }

  function fetchViaBackground(url) {
    return new Promise((resolve, reject) => {
      if (!root.chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
        return reject(new Error('extension runtime unavailable'));
      }
      chrome.runtime.sendMessage({ type: 'xmd:fetch', url }, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res || !res.ok) return reject(new Error((res && res.error) || 'fetch failed'));
        resolve(res);
      });
    });
  }

  async function resolveSource(src, ctx) {
    src = String(src || '').trim();
    if (!src) throw new Error('empty image source');

    if (/^data:/i.test(src)) {
      const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(src);
      if (!m) throw new Error('bad data URL');
      const mime = m[1] || 'application/octet-stream';
      const data = m[2] ? m[3] : btoa(unescape(encodeURIComponent(decodeURIComponent(m[3]))));
      return base64ToFile(data, mime, 'image.' + (mime.split('/')[1] || 'bin'));
    }

    if (/^https?:\/\//i.test(src)) {
      const res = await fetchViaBackground(src);
      const name = basename(src.split(/[?#]/)[0]) || 'image';
      const mime = res.mime && res.mime.startsWith('image/') ? res.mime : guessMime(name);
      return base64ToFile(res.base64, mime, name);
    }

    if (/^[a-z]+:/i.test(src)) throw new Error(`unsupported URL scheme: ${src}`);

    // Relative path: resolve against the .md file's directory inside the dropped set.
    const files = (ctx && ctx.files) || new Map();
    const candidates = [normalizePath((ctx && ctx.mdDir ? ctx.mdDir + '/' : '') + src), normalizePath(src)];
    for (const c of candidates) if (files.has(c)) return files.get(c);
    // Fall back to a unique basename match (e.g. images dropped without their folder).
    const base = basename(src);
    const matches = [...files.keys()].filter((k) => basename(k) === base);
    if (matches.length === 1) return files.get(matches[0]);
    throw new Error(`local image not found: ${src}`);
  }

  async function toSupported(file, allowed) {
    const type = file.type || guessMime(file.name);
    if (allowed.includes(type)) return file;
    // Re-encode through a canvas (works for svg, bmp, avif, ... when the browser can decode them).
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error(`cannot decode ${file.name}`));
        i.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width || 1024;
      canvas.height = img.naturalHeight || img.height || 768;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      if (!blob) throw new Error(`cannot re-encode ${file.name}`);
      return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.png', { type: 'image/png' });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function resolveImage(src, ctx, { forCover = false } = {}) {
    const file = await resolveSource(src, ctx);
    return toSupported(file, forCover ? COVER_TYPES : BODY_TYPES);
  }

  // Build the lookup map from a drop/pick. Entries come from
  // DataTransferItem.webkitGetAsEntry() (folders) or plain File objects.
  async function collectFiles(dataTransferOrFiles) {
    const map = new Map();
    // A native drop's DataTransfer is only readable during the event, so snapshot now.
    const plainFiles = Array.from((dataTransferOrFiles && dataTransferOrFiles.files) || []);
    const addFile = (file, path) => map.set(normalizePath(path || file.webkitRelativePath || file.name), file);

    const walkEntry = (entry, prefix) =>
      new Promise((resolve) => {
        if (entry.isFile) {
          entry.file((f) => {
            addFile(f, prefix + entry.name);
            resolve();
          }, () => resolve());
        } else if (entry.isDirectory) {
          const reader = entry.createReader();
          const all = [];
          const readBatch = () =>
            reader.readEntries(async (entries) => {
              if (!entries.length) {
                for (const e of all) await walkEntry(e, prefix + entry.name + '/');
                resolve();
              } else {
                all.push(...entries);
                readBatch();
              }
            }, () => resolve());
          readBatch();
        } else resolve();
      });

    const items = dataTransferOrFiles && dataTransferOrFiles.items;
    if (items && items.length) {
      const entries = [];
      for (const it of items) {
        if (it.kind !== 'file') continue;
        const entry = it.webkitGetAsEntry && it.webkitGetAsEntry();
        if (entry) entries.push(entry);
        else {
          const f = it.getAsFile();
          if (f) addFile(f);
        }
      }
      for (const e of entries) await walkEntry(e, '');
    }
    if (map.size === 0) for (const f of plainFiles) addFile(f);
    return map;
  }

  function findMarkdownFiles(map) {
    return [...map.keys()].filter((k) => /\.(md|markdown|mdown|mkd)$/i.test(k)).sort();
  }

  XMD.images = { resolveImage, collectFiles, findMarkdownFiles, normalizePath, dirname, basename, BODY_TYPES, COVER_TYPES };
})(typeof window !== 'undefined' ? window : globalThis);
