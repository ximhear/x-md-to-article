/*
 * Service worker. Content scripts cannot fetch cross-origin, so remote images
 * are fetched here (host_permissions) and handed back as base64.
 */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'xmd:fetch') return false;
  (async () => {
    try {
      const res = await fetch(msg.url, { credentials: 'omit', redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const mime = (res.headers.get('content-type') || '').split(';')[0].trim();
      const buf = await res.arrayBuffer();
      if (buf.byteLength > 20 * 1024 * 1024) throw new Error('image larger than 20 MB');
      let bin = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      }
      sendResponse({ ok: true, mime, base64: btoa(bin) });
    } catch (e) {
      sendResponse({ ok: false, error: e.message || String(e) });
    }
  })();
  return true; // keep the message channel open for the async response
});
