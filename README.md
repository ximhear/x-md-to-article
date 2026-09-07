# X Article MD Import

A Chrome extension that imports a Markdown file into the **X Articles** editor.
Tables and fenced code blocks become **native X blocks** instead of images, so they stay
editable, searchable, and readable on every device.

[한국어 안내](#한국어-안내)

## Why

Existing tools (browser extensions and publishing scripts alike) render Markdown tables as PNG images
because the X editor drops `<table>` on paste. That loses text selection, search, accessibility and
the ability to fix a typo after import.

The X Articles editor does have a native **Insert → Table** block, and its edit dialog accepts a
GFM table in Markdown. It also has a native **Insert → Code** block. This extension drives those
dialogs for you, and pastes everything else as rich text.

## What you get

| Markdown | X Article |
|---|---|
| First `# H1` | Article title |
| Shallowest remaining heading level | Heading |
| Deeper headings | Subheading |
| Paragraphs, **bold**, *italic*, links, lists, blockquotes | Rich text (pasted as HTML) |
| `` `inline code` `` | Plain text (optional: keep backticks) |
| GFM table | Native **Table** block (Markdown passed through) |
| Fenced code block | Native **Code** block (monospace; language is attempted) |
| `---` | Native **Divider** |
| Image, remote `https://…` | Uploaded through Insert → Media (fetched by the extension's service worker) |
| Image, local `./img/a.png` | Uploaded when the image was dropped or picked together with the `.md` |
| Image alt text | Caption of the media block |
| Leading image (before any body text) | Cover image (can be turned off) |
| YAML front matter `title:` / `cover:` | Article title / cover image; other keys are ignored |

Verified end-to-end on a real draft with a 170-line technical article: title, 45 blocks in order,
2 tables, 6 code blocks (including box-drawing directory trees), 7 headings, 3 subheadings,
27 links, no stray empty blocks.

## Install

The extension is not on the Chrome Web Store yet. Load it unpacked:

1. Clone or download this repository.
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the repository folder.
4. If you use another Markdown-to-X extension, disable it to avoid two scripts fighting over paste.

## Use

1. Go to `https://x.com/compose/articles` and click **Write** to open a draft.
2. Click the **Import .md** button at the bottom right, or drag a `.md` file onto the page.
3. Watch the toast at the bottom right. It reports each block as it goes in and a summary at the end.

Content is appended at the end of the editor regardless of the caret position.
Tables and code blocks take about a second each; every image takes a few seconds to upload.
Keep the X tab visible while it runs. Chrome throttles hidden tabs and X's own dialogs stall.

### Images

- **Remote images** (`https://…`) are downloaded by the extension and uploaded to X. This is why the
  extension asks for access to all sites.
- **Local images** (`./img/a.png`) need the files. Either drag the whole folder that holds the `.md`
  and its images onto the page, or pick the `.md` together with its images in the file dialog.
  Paths are resolved relative to the `.md`; a unique file-name match is used as a fallback.
- **Cover**: an image that appears before any body text becomes the cover, or set `cover:` in the
  front matter. Set `cover: 'none'` in `OPTIONS` to keep every image in the body.
- **Caption**: the alt text becomes the media block's caption.
- Accepted formats are JPEG, PNG, WebP and GIF; anything else is re-encoded to PNG when the browser
  can decode it. Images that cannot be resolved are left as a `[image: alt]` line and listed in the console.

`samples/image-test/` is a small folder to try: drag it onto a draft.

## Options

`src/content.js` has two options:

```js
const OPTIONS = {
  inlineCode: 'plain', // 'plain' | 'backticks'
  cover: 'auto',       // 'auto' | 'none'
};
```

X has no inline-code style. `'plain'` drops the backticks, `'backticks'` keeps them visible.
`cover: 'auto'` promotes a leading image to the cover; `'none'` keeps it in the body.

## How it works

```
manifest.json      MV3; content script on x.com/* (X is a SPA, the script watches the route)
lib/marked.min.js  marked 15.0.12, GFM lexer
src/parser.js      Markdown -> plan: title, cover, [{html} | {table} | {code} | {divider} | {image}]
src/images.js      Resolves image sources to Files (data:, remote via worker, local from the drop)
src/editor.js      Drives the Draft.js composer: synthetic paste, Insert-menu automation, uploads
src/content.js     Floating button, drag and drop (files or folders), progress toast
src/background.js  Service worker that fetches remote images cross-origin
samples/           Example input
test/              node --test parser tests
```

The parser groups consecutive rich-text blocks into one HTML paste and splits on tables, code and
dividers. The editor driver then walks the plan top to bottom:

- **Rich text**: dispatch a `ClipboardEvent('paste')` carrying `text/html` on the composer.
  Draft.js keeps `h1`, `h2`, `strong`, `em`, `a`, `ul/ol`, `blockquote`.
- **Table**: Insert → Table → 1×1 → open the new block's edit dialog → set the Markdown textarea
  through React's native value setter → Update.
- **Code**: Insert → Code → set the textarea → Insert.
- **Divider**: Insert → Divider.
- **Image**: Insert → Media → set `.files` on the dialog's file input and fire `change` → wait until
  the "Cancel upload" button disappears → click the caption placeholder → paste the alt text into the
  caption box → Save.
- **Cover**: set `.files` on the cover input above the title → "Apply" in the crop dialog.

Dialog nodes are replaced by React while they animate in, so the driver never holds a reference
to a dialog; it re-queries `[role="dialog"] …` and reacts to DOM mutations instead of polling.
Timers are hopped through a `MessageChannel` so a hidden tab's timer throttling does not stall the run.

## Notes on the X editor (as of 2026-09-07)

- The composer is Draft.js (`[data-testid="composer"]`, blocks are `[data-block="true"]`).
- The toolbar **Insert** dropdown is visually clipped to three items (Media, GIF, Posts) but the DOM
  holds eight: Link preview, Divider, Code, LaTeX and Table are there too.
- Pasting HTML loses `<table>`, `<pre>`, `<hr>`, `<h3>` and inline `<code>`.
- If X changes its DOM, the selectors live in `src/editor.js`.

## Development

```
npm install   # only needed for tests (marked as a devDependency)
npm test
```

## Limitations

- Images inside lists, quotes and table cells cannot become blocks; they stay as a `[image: alt]` link.
- Videos and GIF-set blocks are not created; one image per media block.
- LaTeX blocks and tweet embeds are not handled.
- The Code dialog's language picker is best-effort; blocks fall back to plain monospace.

## License

MIT. Bundles [marked](https://github.com/markedjs/marked) (MIT).

---

## 한국어 안내

Markdown 파일을 X Articles 편집기에 가져오는 Chrome 확장 프로그램입니다.
표와 코드 블록을 이미지로 바꾸지 않고 X 편집기의 **네이티브 Table / Code 블록**으로 넣습니다.

### 왜 만들었나

기존 도구들은 X 편집기가 HTML 붙여넣기에서 `<table>`을 버리기 때문에 표를 PNG로 바꿉니다.
그러면 텍스트 선택, 검색, 접근성, 가져온 뒤 오타 수정이 전부 불가능해집니다.

X 편집기에는 **Insert → Table** 블록이 있고, 그 편집 화면은 GFM 표 markdown을 그대로 받습니다.
**Insert → Code** 블록도 있습니다. 이 확장은 그 대화상자들을 자동으로 조작하고, 나머지는 서식 있는 텍스트로 붙여넣습니다.

### 설치

1. 이 저장소를 clone 하거나 내려받습니다.
2. `chrome://extensions` 에서 **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다** 를 누르고 저장소 폴더를 선택합니다.
4. 다른 Markdown → X 확장을 쓰고 있다면 붙여넣기 충돌을 피하기 위해 꺼둡니다.

### 사용

1. `https://x.com/compose/articles` 에서 **Write** 로 새 글을 엽니다.
2. 우측 하단 **Import .md** 버튼을 누르거나 `.md` 파일을 페이지에 끌어다 놓습니다.
3. 우측 하단 토스트에 진행 상황과 결과 요약이 표시됩니다.

내용은 커서 위치와 무관하게 편집기 끝에 이어 붙습니다. 이미지는 한 장에 몇 초씩 걸립니다.
실행 중에는 X 탭을 화면에 보이게 두세요. 숨겨진 탭은 Chrome이 느리게 만들고 X의 대화상자도 멈춥니다.

### 이미지

- **원격 이미지**는 확장이 내려받아 X에 업로드합니다. 이 때문에 모든 사이트 접근 권한을 요청합니다.
- **로컬 이미지**는 파일이 필요합니다. `.md`와 이미지가 든 **폴더째로** 페이지에 끌어다 놓거나, 파일 선택 창에서 `.md`와 이미지를 함께 고르세요. 경로는 `.md` 기준 상대 경로로 찾고, 못 찾으면 파일 이름이 유일하게 일치하는 것을 씁니다.
- **커버**: 본문 텍스트보다 앞에 나오는 이미지가 커버가 됩니다. frontmatter의 `cover:`로 지정할 수도 있습니다. `OPTIONS.cover`를 `'none'`으로 두면 모든 이미지가 본문에 남습니다.
- **캡션**: alt 텍스트가 미디어 블록 캡션이 됩니다.
- JPEG, PNG, WebP, GIF를 받습니다. 그 외 형식은 브라우저가 디코딩할 수 있으면 PNG로 다시 인코딩합니다. 못 찾은 이미지는 `[image: alt]` 한 줄로 남고 콘솔에 목록이 찍힙니다.

`samples/image-test/` 폴더를 초안에 끌어다 놓으면 바로 시험해 볼 수 있습니다.

### 변환 규칙

| Markdown | X Article |
|---|---|
| 첫 `# H1` | 글 제목 |
| 나머지 헤딩 중 가장 얕은 깊이 | Heading |
| 그보다 깊은 헤딩 | Subheading |
| 문단, 굵게, 기울임, 링크, 목록, 인용 | 서식 유지 (HTML 붙여넣기) |
| `` `인라인 코드` `` | 일반 텍스트 (옵션으로 백틱 유지) |
| GFM 표 | 네이티브 **Table** 블록 |
| 펜스 코드 블록 | 네이티브 **Code** 블록 (고정폭) |
| `---` | 네이티브 **Divider** |
| 원격 이미지 `https://…` | Insert → Media로 업로드 (확장의 서비스 워커가 내려받음) |
| 로컬 이미지 `./img/a.png` | `.md`와 함께 드롭·선택한 파일에서 찾아 업로드 |
| 이미지 alt 텍스트 | 미디어 블록 캡션 |
| 본문 앞에 오는 첫 이미지 | 커버 이미지 (끌 수 있음) |
| frontmatter `title:` / `cover:` | 글 제목 / 커버 이미지 |

### 옵션

`src/content.js` 의 `OPTIONS.inlineCode` 를 `'backticks'` 로 바꾸면 인라인 코드의 백틱을 그대로 남깁니다.

### 한계

- 목록·인용·표 셀 안의 이미지는 블록이 될 수 없어 `[image: alt]` 링크로 남습니다.
- 동영상과 GIF 묶음 블록은 만들지 않습니다. 미디어 블록 하나에 이미지 하나입니다.
- LaTeX 블록과 트윗 임베드는 처리하지 않습니다.
- X 편집기 DOM이 바뀌면 `src/editor.js` 의 선택자를 손봐야 합니다.
