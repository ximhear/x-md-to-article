/*
 * Markdown -> block plan for the X Articles editor.
 *
 * Output: { title: string|null, blocks: Block[] }
 *   Block = { type: 'html',    html: string, text: string }   -> pasted as rich text
 *         | { type: 'table',   markdown: string }             -> Insert > Table dialog
 *         | { type: 'code',    lang: string, text: string }   -> Insert > Code dialog
 *         | { type: 'divider' }                               -> Insert > Divider
 *
 * Works in the browser (global `marked`) and in Node (require('marked')).
 */
(function (root) {
  const marked = root.marked || (typeof require === 'function' ? require('marked') : null);
  if (!marked) throw new Error('marked is not available');

  const DEFAULTS = {
    // How to render `inline code` in body text. X has no inline-code style,
    // so it is either plain text or wrapped in backticks.
    inlineCode: 'plain', // 'plain' | 'backticks'
    // 'auto': an image that appears before any body text becomes the cover image.
    // 'none': every image stays in the body. Frontmatter `cover:` always wins.
    cover: 'auto', // 'auto' | 'none'
  };

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Returns { body, meta } where meta holds simple `key: value` pairs (title, cover).
  function splitFrontmatter(md) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
    if (!m) return { body: md, meta: {} };
    const meta = {};
    for (const line of m[1].split('\n')) {
      const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
      if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, '');
    }
    return { body: md.slice(m[0].length), meta };
  }

  function makeRenderer(opts, { dropImages = false } = {}) {
    const r = new marked.Renderer();
    r.codespan = ({ text }) => {
      const t = escapeHtml(text);
      return opts.inlineCode === 'backticks' ? '`' + t + '`' : t;
    };
    r.image = ({ href, text }) => {
      if (dropImages) return '';
      // Images that cannot become their own block (inside lists, quotes, table
      // cells) stay as a visible pointer, since the editor drops <img> on paste.
      return imageFallbackHtml(href, text);
    };
    r.html = ({ text }) => escapeHtml(text);
    r.br = () => '<br>';
    return r;
  }

  function imageFallbackHtml(href, alt) {
    const label = `[image: ${alt || href}]`;
    return /^https?:\/\//i.test(href || '')
      ? `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`
      : escapeHtml(label);
  }

  function inline(tokens, ctx, renderer) {
    return marked.Parser.parseInline(tokens || [], { renderer: renderer || ctx.renderer });
  }

  // Top-level and nested image tokens of a paragraph, in document order.
  function collectImages(tokens, out = []) {
    for (const t of tokens || []) {
      if (t.type === 'image') out.push({ src: t.href, alt: t.text || '', title: t.title || '' });
      else if (t.tokens) collectImages(t.tokens, out);
    }
    return out;
  }

  function plainText(tokens) {
    return (tokens || [])
      .map((t) => {
        if (t.tokens) return plainText(t.tokens);
        if (t.type === 'image') return t.text || '';
        return t.text != null ? t.text : t.raw || '';
      })
      .join('');
  }

  function renderList(tok, ctx) {
    const tag = tok.ordered ? 'ol' : 'ul';
    const items = tok.items
      .map((item) => {
        const parts = [];
        for (const t of item.tokens || []) {
          if (t.type === 'text' || t.type === 'paragraph') parts.push(inline(t.tokens, ctx));
          else if (t.type === 'list') parts.push(renderList(t, ctx));
          else if (t.type === 'code') parts.push('<br>' + escapeHtml(t.text).replace(/\n/g, '<br>'));
          else if (t.type === 'space') continue;
          else parts.push(escapeHtml(t.raw || ''));
        }
        return `<li>${parts.join('')}</li>`;
      })
      .join('');
    return `<${tag}>${items}</${tag}>`;
  }

  function renderBlockquote(tok, ctx) {
    const parts = [];
    for (const t of tok.tokens || []) {
      if (t.type === 'paragraph') parts.push(inline(t.tokens, ctx));
      else if (t.type === 'list') parts.push(renderList(t, ctx));
      else if (t.type === 'space') continue;
      else parts.push(escapeHtml(t.raw || ''));
    }
    return `<blockquote>${parts.join('<br>')}</blockquote>`;
  }

  // Rebuild a GFM table from the token so the editor always gets a clean,
  // fully piped table regardless of how loosely the source was written.
  function tableMarkdown(tok) {
    const cell = (c) => (c.text || '').replace(/\|/g, '\\|').trim();
    const header = '| ' + tok.header.map(cell).join(' | ') + ' |';
    const sep =
      '| ' +
      tok.align
        .map((a) => (a === 'center' ? ':---:' : a === 'right' ? '---:' : a === 'left' ? ':---' : '---'))
        .join(' | ') +
      ' |';
    const rows = tok.rows.map((r) => '| ' + r.map(cell).join(' | ') + ' |');
    return [header, sep, ...rows].join('\n');
  }

  // The editor has only Heading (h1) and Subheading (h2). The shallowest heading
  // depth remaining after the title is taken becomes Heading; everything deeper
  // becomes Subheading.
  function headingLevel(depth, minDepth) {
    return depth <= minDepth ? 1 : 2;
  }

  function parse(markdown, options) {
    const opts = Object.assign({}, DEFAULTS, options || {});
    const ctx = { renderer: makeRenderer(opts), noImageRenderer: makeRenderer(opts, { dropImages: true }) };
    const { body: md, meta } = splitFrontmatter(String(markdown).replace(/\r\n/g, '\n'));
    const tokens = marked.lexer(md, { gfm: true });

    let title = meta.title || null;
    let cover = meta.cover ? { src: meta.cover, alt: '' } : null;
    const blocks = [];
    let htmlBuf = [];
    let textBuf = [];
    const flush = () => {
      if (htmlBuf.length) {
        blocks.push({ type: 'html', html: htmlBuf.join(''), text: textBuf.join('\n') });
        htmlBuf = [];
        textBuf = [];
      }
    };
    const pushHtml = (html, text) => {
      htmlBuf.push(html);
      textBuf.push(text);
    };

    const firstHeading = tokens.find((t) => t.type === 'heading');
    // The first H1 is the title. With a frontmatter title it is dropped instead.
    const titleToken = firstHeading && firstHeading.depth === 1 ? firstHeading : null;
    const minDepth = Math.min(
      ...tokens.filter((t) => t.type === 'heading' && t !== titleToken).map((t) => t.depth),
      6
    );

    for (const t of tokens) {
      switch (t.type) {
        case 'space':
          break;
        case 'heading': {
          if (t === titleToken) {
            if (!title) title = plainText(t.tokens).trim();
            break;
          }
          const lvl = headingLevel(t.depth, minDepth);
          pushHtml(`<h${lvl}>${inline(t.tokens, ctx)}</h${lvl}>`, plainText(t.tokens));
          break;
        }
        case 'paragraph': {
          const images = collectImages(t.tokens);
          if (!images.length) {
            pushHtml(`<p>${inline(t.tokens, ctx)}</p>`, plainText(t.tokens));
            break;
          }
          const html = inline(t.tokens, ctx, ctx.noImageRenderer);
          const text = html.replace(/<[^>]+>/g, '').trim();
          if (text) pushHtml(`<p>${html}</p>`, text);
          for (const img of images) {
            // A leading image (nothing but the title before it) becomes the cover.
            if (opts.cover === 'auto' && !cover && !blocks.length && !htmlBuf.length) {
              cover = img;
              continue;
            }
            flush();
            blocks.push({ type: 'image', src: img.src, alt: img.alt, title: img.title });
          }
          break;
        }
        case 'list':
          pushHtml(renderList(t, ctx), t.raw.trim());
          break;
        case 'blockquote':
          pushHtml(renderBlockquote(t, ctx), t.raw.trim());
          break;
        case 'code':
          flush();
          blocks.push({ type: 'code', lang: (t.lang || '').trim(), text: t.text });
          break;
        case 'table':
          flush();
          blocks.push({ type: 'table', markdown: tableMarkdown(t) });
          break;
        case 'hr':
          flush();
          blocks.push({ type: 'divider' });
          break;
        case 'html':
          pushHtml(`<p>${escapeHtml(t.raw.trim())}</p>`, t.raw.trim());
          break;
        default:
          pushHtml(`<p>${escapeHtml(t.raw || '')}</p>`, t.raw || '');
      }
    }
    flush();
    return { title, cover, blocks };
  }

  const XMD = (root.XMD = root.XMD || {});
  XMD.parse = parse;
  XMD.tableMarkdown = tableMarkdown;
  XMD.imageFallbackHtml = imageFallbackHtml;
  XMD.DEFAULTS = DEFAULTS;
})(typeof window !== 'undefined' ? window : globalThis);
