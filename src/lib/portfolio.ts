import { db } from './db'
import type { Book } from './types'

/**
 * Portfolio export — a single self-contained HTML file.
 *
 * The JSON backup is for restoring; this is for *showing*. A shelf someone has
 * spent years building is closer to a portfolio than an inventory, and a
 * .json attachment is not something you send to a book club.
 *
 * Two constraints shape the implementation:
 *
 * 1. **Self-contained.** Every cover is inlined as a data URI, so the file
 *    survives being emailed, AirDropped or dropped in a WhatsApp thread, and
 *    keeps working when Open Library is slow or the recipient is offline.
 *
 * 2. **Safe to share.** Private fields — her notes and shelf locations — are
 *    deliberately excluded. "Lent to Priya" and "bedroom shelf, third row"
 *    should not leave the device inside something she broadcasts.
 */

/** Deliberately narrow: this is the shape that goes into a shared file. */
interface PortfolioEntry {
  t: string // title
  a: string // authors, joined
  y?: string // year
  p?: number // pages
  pub?: string // publisher
  s?: string // summary
  r?: 'unread' | 'reading' | 'read'
  c?: number // copies
  img?: string // data URI
}

const THUMB_WIDTH = 220
const THUMB_QUALITY = 0.72
const CONCURRENCY = 6
const IMAGE_TIMEOUT_MS = 8000

// ---------------------------------------------------------------------------
// Cover collection
// ---------------------------------------------------------------------------

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/**
 * Downscale to a thumbnail data URI.
 *
 * Goes through a canvas rather than inlining the original bytes: a 400-book
 * library of full-size covers would be a 40 MB file nobody can send.
 */
function toThumbnail(source: CanvasImageSource, width: number, height: number): string | null {
  const scale = Math.min(1, THUMB_WIDTH / width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  try {
    return canvas.toDataURL('image/jpeg', THUMB_QUALITY)
  } catch {
    // Tainted canvas — the source didn't allow cross-origin reads.
    return null
  }
}

function loadCrossOriginImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    const timer = setTimeout(() => resolve(null), IMAGE_TIMEOUT_MS)
    image.onload = () => {
      clearTimeout(timer)
      resolve(image)
    }
    image.onerror = () => {
      clearTimeout(timer)
      resolve(null)
    }
    image.src = url
  })
}

/**
 * Her own photo first (we already hold the bytes), then the remote cover.
 *
 * Open Library serves permissive CORS headers so its covers can be read off a
 * canvas; Google Books does not, so those quietly fall back to the
 * typographic tile the template renders when `img` is absent.
 */
async function coverDataUrl(book: Book): Promise<string | undefined> {
  if (book.coverLocalKey) {
    const blob = await db.covers.get(book.coverLocalKey).then((c) => c?.blob)
    if (blob) {
      try {
        const bitmap = await createImageBitmap(blob)
        const thumb = toThumbnail(bitmap, bitmap.width, bitmap.height)
        bitmap.close()
        if (thumb) return thumb
      } catch {
        return await blobToDataUrl(blob)
      }
    }
  }

  if (book.coverRemote) {
    const image = await loadCrossOriginImage(book.coverRemote)
    if (image?.naturalWidth && image.naturalWidth > 2) {
      const thumb = toThumbnail(image, image.naturalWidth, image.naturalHeight)
      if (thumb) return thumb
    }
  }

  return undefined
}

/** Bounded-concurrency map, so 400 covers don't open 400 sockets at once. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  let done = 0

  async function worker() {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
      done++
      onProgress?.(done, items.length)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Embedding JSON in a <script> is only safe once `<` is escaped — otherwise a
 * book whose summary contains "</script>" ends the block early and breaks the
 * whole file.
 */
function embedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    // Valid inside JSON but a syntax error inside a JS string literal,
    // so they have to be escaped before going into the inline <script>.
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function buildHtml(title: string, entries: PortfolioEntry[]): string {
  const totalPages = entries.reduce((sum, e) => sum + (e.p ?? 0) * (e.c ?? 1), 0)
  const authors = new Set(entries.map((e) => e.a).filter(Boolean))
  const readCount = entries.filter((e) => e.r === 'read').length
  const generated = new Date().toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#fff; --fg:#17131f; --muted:#6c6579; --line:#e8e4ef;
    --primary:#5b21b6; --primary-light:#7c46e0; --tint:#f4f0fb; --ochre:#c8901a;
    /* Sunken panel a jacket sits on, and crisp corners for artwork —
       matching the app so the exported page reads as the same product. */
    --sunken:#f1eef8;
    --radius:14px; --radius-card:6px; --radius-media:4px;
    /* One typeface, matching the app. Anything set in --display just leans on
       Medium weight and tighter tracking rather than a second family. */
    --display:'Montserrat', ui-sans-serif, system-ui, sans-serif;
  }
  *{box-sizing:border-box}
  html{ -webkit-text-size-adjust:100% }
  body{
    margin:0; color:var(--fg); background:var(--bg);
    font-family:'Montserrat',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;
    letter-spacing:-.011em; -webkit-font-smoothing:antialiased;
    background-image:
      radial-gradient(120% 80% at 15% -10%, #f1ecfa 0%, transparent 60%),
      radial-gradient(110% 70% at 95% 105%, #faf6ec 0%, transparent 55%);
    background-attachment:fixed;
  }
  /* Same matte grain as the app */
  body::after{
    content:''; position:fixed; inset:0; z-index:100; pointer-events:none; opacity:.038;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E");
  }
  .wrap{max-width:1080px;margin:0 auto;padding:32px 20px 64px}
  header{margin-bottom:28px}
  h1{font-family:var(--display);font-size:clamp(30px,6.2vw,46px);line-height:1.08;margin:0 0 12px;font-weight:500;letter-spacing:-.035em}
  .stats{display:flex;flex-wrap:wrap;gap:8px 18px;color:var(--muted);font-size:14px;font-weight:500}
  .stats b{color:var(--fg);font-weight:600}
  .toolbar{display:flex;flex-wrap:wrap;gap:10px;margin:22px 0 24px;align-items:center}
  .search{position:relative;flex:1 1 220px;min-width:180px}
  .search input{
    width:100%;height:44px;border-radius:999px;border:1px solid var(--line);
    background:rgba(255,255,255,.7);padding:0 18px 0 42px;font:inherit;font-size:15px;outline:none;color:inherit;
  }
  .search input:focus{border-color:var(--primary);box-shadow:0 0 0 3px rgba(91,33,182,.14)}
  .search svg{position:absolute;left:15px;top:50%;transform:translateY(-50%);width:16px;height:16px;stroke:var(--muted)}
  .chips{display:flex;gap:8px;flex-wrap:wrap}
  .chip{
    height:38px;padding:0 16px;border-radius:999px;border:1px solid var(--line);
    background:rgba(255,255,255,.6);font:inherit;font-size:13px;font-weight:500;color:var(--muted);
    cursor:pointer;transition:.15s;
  }
  .chip:hover{border-color:var(--primary);color:var(--primary)}
  .chip[aria-pressed="true"]{
    background:linear-gradient(180deg,var(--primary-light),var(--primary));
    border-color:transparent;color:#fff;
  }
  /* Two-up on a phone so the jacket is a jacket, not a thumbnail. */
  .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
  @media(min-width:560px){.grid{grid-template-columns:repeat(auto-fill,minmax(190px,1fr))}}

  /* The card is one object: sunken panel holding the jacket, caption bedded
     into the same white surface below a hairline. */
  .card{
    display:flex;flex-direction:column;border:0;padding:0;text-align:left;cursor:pointer;
    font:inherit;color:inherit;background:#fff;border-radius:var(--radius-card);overflow:hidden;
    box-shadow:0 0 0 1px rgba(23,19,31,.06);
    transition:transform .18s ease, box-shadow .18s ease;
  }
  .card:hover{transform:translateY(-2px);box-shadow:0 0 0 1px rgba(23,19,31,.08),0 12px 24px -12px rgba(23,19,31,.25)}
  /* Deliberately not a centred grid: place-items:center stops the item
     stretching, so height:100% on the image resolves against its own
     intrinsic size and tall jackets spill past the padding. A plain block with
     padding gives the image a real box to be contained inside.
     (No backticks in comments here — this whole stylesheet lives inside a JS
     template literal, and a backtick would end the string.) */
  .thumb{
    position:relative;aspect-ratio:4/5;overflow:hidden;background:var(--sunken);padding:14px;
  }
  /* contain, not cover: cropping a jacket eats the typography that makes it
     recognisable, and book proportions vary far more than product shots.
     width/height 100% + object-fit rather than max-*: as a centred grid item
     the intrinsic size wins over max-height, and tall jackets spill past the
     panel's padding. */
  .thumb img{width:100%;height:100%;object-fit:contain;display:block;
    filter:drop-shadow(0 3px 10px rgba(23,19,31,.2))}
  .fallback{
    width:100%;height:100%;display:flex;align-items:center;justify-content:center;
    padding:10px;text-align:center;
    font-family:var(--display);font-size:13px;font-weight:500;letter-spacing:-.03em;color:rgba(23,19,31,.55);line-height:1.2;
  }
  .badge{
    position:absolute;top:8px;right:8px;width:22px;height:22px;border-radius:999px;
    background:var(--primary);color:#fff;display:grid;place-items:center;
  }
  .badge svg{width:12px;height:12px;stroke:#fff;stroke-width:3}
  .meta{flex:1;padding:10px 12px 12px;border-top:1px solid rgba(23,19,31,.05)}
  .meta .t{font-family:var(--display);font-size:15px;font-weight:500;letter-spacing:-.03em;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .meta .a{font-size:11.5px;font-weight:500;color:var(--muted);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .empty{padding:60px 0;text-align:center;color:var(--muted)}
  footer{margin-top:56px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:12.5px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}

  /* ---- Detail drawer -------------------------------------------------
     A bottom sheet rather than a centred modal, matching the app. Built on
     <dialog> so the backdrop, Esc-to-close and focus trap come for free;
     only the positioning and transition are overridden.                  */
  dialog{
    border:0;padding:0;background:#fff;color:inherit;
    /* margin-bottom:0 with auto elsewhere anchors it to the bottom edge
       while staying horizontally centred on wide screens. */
    margin:auto auto 0;
    width:min(560px,100%);max-width:100%;
    max-height:88dvh;
    border-radius:22px 22px 0 0;
    box-shadow:0 -8px 60px -12px rgba(23,19,31,.4);
    display:flex;flex-direction:column;overflow:hidden;

    /* The resting state is *visible*. The slide-up lives entirely in
       @starting-style, so a browser that doesn't support it — or one that
       simply doesn't run the transition — shows the drawer in place instead
       of leaving it parked off-screen. This file gets opened on whatever
       browser a book club happens to have; an un-animated drawer is a
       cosmetic loss, an invisible one is a broken page. */
    translate:0 0;
    transition:translate .3s cubic-bezier(.32,.72,0,1), overlay .3s allow-discrete, display .3s allow-discrete;
  }
  @starting-style{ dialog[open]{translate:0 100%} }
  dialog.dragging{transition:none}

  dialog::backdrop{
    background:rgba(23,19,31,.5);backdrop-filter:blur(3px);
    opacity:1;transition:opacity .3s, overlay .3s allow-discrete, display .3s allow-discrete;
  }
  @starting-style{ dialog[open]::backdrop{opacity:0} }

  .grab{flex:none;padding:10px 0 2px;display:flex;justify-content:center;cursor:grab;touch-action:none}
  .grab::before{content:'';width:38px;height:4px;border-radius:999px;background:var(--line)}

  .sheet-head{
    flex:none;display:flex;align-items:center;gap:12px;
    padding:6px 18px 12px;border-bottom:1px solid var(--line);
  }
  .sheet-head h2{
    margin:0;font-size:15.5px;font-weight:600;letter-spacing:-.015em;flex:1;min-width:0;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  }
  .close{
    flex:none;width:32px;height:32px;border-radius:999px;border:0;
    background:rgba(23,19,31,.06);cursor:pointer;font-size:18px;line-height:1;color:var(--muted)
  }
  .close:hover{background:rgba(23,19,31,.11)}

  .sheet-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding-bottom:max(28px,env(safe-area-inset-bottom))}
  /* Same product-page hero as the app: jacket centred on a sunken panel,
     everything factual underneath. */
  .hero{background:var(--sunken);display:grid;place-items:center;padding:26px 24px 22px}
  .hero img{height:190px;width:100%;max-width:170px;object-fit:contain;display:block;
    filter:drop-shadow(0 4px 14px rgba(23,19,31,.24))}
  .hero .fallback{font-size:16px;min-height:150px}
  .sheet-info{padding:18px 18px 6px}
  .sheet-info h3{margin:0 0 5px;font-family:var(--display);font-size:22px;line-height:1.2;font-weight:500;letter-spacing:-.035em}
  .sheet-info .by{color:var(--muted);font-size:13.5px;margin:0 0 12px;font-weight:500}
  .pills{display:flex;flex-wrap:wrap;gap:6px}
  .pill{background:var(--tint);color:#54407e;border-radius:999px;padding:4px 11px;font-size:11.5px;font-weight:600}
  .pill.read{background:var(--primary);color:#fff}
  p.sum{margin:16px 0 0;font-size:13.5px;line-height:1.65;color:#3c3548}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${escapeHtml(title)}</h1>
    <div class="stats">
      <span><b>${entries.length}</b> ${entries.length === 1 ? 'book' : 'books'}</span>
      ${totalPages > 0 ? `<span><b>${totalPages.toLocaleString()}</b> pages</span>` : ''}
      ${authors.size > 0 ? `<span><b>${authors.size}</b> ${authors.size === 1 ? 'author' : 'authors'}</span>` : ''}
      ${readCount > 0 ? `<span><b>${readCount}</b> read</span>` : ''}
    </div>
  </header>

  <div class="toolbar">
    <label class="search">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="q" type="search" placeholder="Search this library" autocomplete="off" aria-label="Search this library">
    </label>
    <div class="chips" id="chips">
      <button class="chip" data-f="all" aria-pressed="true">All</button>
      <button class="chip" data-f="read" aria-pressed="false">Read</button>
      <button class="chip" data-f="reading" aria-pressed="false">Reading</button>
      <button class="chip" data-f="unread" aria-pressed="false">Unread</button>
    </div>
  </div>

  <div class="grid" id="grid"></div>
  <p class="empty" id="empty" hidden>Nothing matches that.</p>

  <footer>
    <span>${escapeHtml(generated)}</span>
    <span>Catalogued with Shelf</span>
  </footer>
</div>

<dialog id="dlg" aria-labelledby="dlgTitle">
  <div class="grab" id="grab" aria-hidden="true"></div>
  <div class="sheet-head">
    <h2 id="dlgTitle"></h2>
    <button class="close" id="x" aria-label="Close">&times;</button>
  </div>
  <div class="sheet-body" id="sheet"></div>
</dialog>

<script>
const BOOKS = ${embedJson(entries)};
const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const dlg = document.getElementById('dlg');
const sheet = document.getElementById('sheet');
const dlgTitle = document.getElementById('dlgTitle');
const grab = document.getElementById('grab');
let filter = 'all', term = '';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const tile = (b) => b.img
  ? '<img loading="lazy" alt="" src="' + b.img + '">'
  : '<div class="fallback">' + esc(b.t) + '</div>';

function render() {
  const list = BOOKS.filter((b) => {
    if (filter !== 'all' && (b.r || 'unread') !== filter) return false;
    if (!term) return true;
    return (b.t + ' ' + b.a).toLowerCase().includes(term);
  });

  grid.innerHTML = list.map((b) => {
    const i = BOOKS.indexOf(b);
    const check = b.r === 'read'
      ? '<span class="badge"><svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>'
      : '';
    return '<button class="card" data-i="' + i + '">'
      + '<div class="thumb">' + tile(b) + check + '</div>'
      + '<div class="meta"><div class="t">' + esc(b.t) + '</div>'
      + '<div class="a">' + esc(b.a || 'Unknown author') + '</div></div>'
      + '</button>';
  }).join('');

  empty.hidden = list.length > 0;
}

function open(i) {
  const b = BOOKS[i];
  const bits = [];
  if (b.y) bits.push('<span class="pill">' + esc(b.y) + '</span>');
  if (b.p) bits.push('<span class="pill">' + b.p + ' pages</span>');
  if (b.c && b.c > 1) bits.push('<span class="pill">' + b.c + ' copies</span>');
  if (b.r === 'read') bits.push('<span class="pill read">Read</span>');
  else if (b.r === 'reading') bits.push('<span class="pill read">Reading</span>');

  dlgTitle.textContent = b.t;
  sheet.innerHTML =
    '<div class="hero">'
    + (b.img ? '<img alt="" src="' + b.img + '">' : '<div class="fallback">' + esc(b.t) + '</div>')
    + '</div>'
    + '<div class="sheet-info">'
    + '<h3>' + esc(b.t) + '</h3>'
    + '<p class="by">' + esc(b.a || 'Unknown author') + (b.pub ? ' &middot; ' + esc(b.pub) : '') + '</p>'
    + (bits.length ? '<div class="pills">' + bits.join('') + '</div>' : '')
    + (b.s ? '<p class="sum">' + esc(b.s) + '</p>' : '')
    + '</div>';
  sheet.scrollTop = 0;
  dlg.showModal();
}

function close() {
  dlg.style.translate = '';
  dlg.classList.remove('dragging');
  dlg.close();
}

grid.addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (card) open(Number(card.dataset.i));
});
document.getElementById('x').addEventListener('click', close);
dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
// Reset any drag offset when Esc closes it, so the next open animates cleanly.
dlg.addEventListener('close', () => { dlg.style.translate = ''; dlg.classList.remove('dragging'); });

/* Swipe down to dismiss. The grab handle promises this works, so it has to.
   Only starts from the handle or a body already scrolled to the top —
   otherwise a downward swipe that should scroll the summary would close it. */
let dragFrom = null;
function dragStart(e) {
  if (sheet.scrollTop > 0 && e.currentTarget !== grab) return;
  dragFrom = e.touches[0].clientY;
  dlg.classList.add('dragging');
}
function dragMove(e) {
  if (dragFrom === null) return;
  const dy = e.touches[0].clientY - dragFrom;
  if (dy <= 0) { dlg.style.translate = '0 0'; return; }
  e.preventDefault();
  dlg.style.translate = '0 ' + dy + 'px';
}
function dragEnd() {
  if (dragFrom === null) return;
  const dy = parseFloat((dlg.style.translate || '0 0').split(' ')[1]) || 0;
  dragFrom = null;
  dlg.classList.remove('dragging');
  if (dy > 90) close();
  else dlg.style.translate = '';
}
for (const el of [grab, sheet]) {
  el.addEventListener('touchstart', dragStart, { passive: true });
  el.addEventListener('touchmove', dragMove, { passive: false });
  el.addEventListener('touchend', dragEnd);
  el.addEventListener('touchcancel', dragEnd);
}
document.getElementById('q').addEventListener('input', (e) => {
  term = e.target.value.trim().toLowerCase();
  render();
});
document.getElementById('chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  filter = chip.dataset.f;
  [...document.querySelectorAll('.chip')].forEach((c) =>
    c.setAttribute('aria-pressed', String(c === chip)));
  render();
});

render();
</script>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PortfolioOptions {
  title: string
  onProgress?: (done: number, total: number) => void
}

export async function buildPortfolio({ title, onProgress }: PortfolioOptions): Promise<Blob> {
  const books = (await db.books.orderBy('addedAt').reverse().toArray()).filter((b) =>
    b.title.trim(),
  )

  const covers = await mapLimit(books, CONCURRENCY, (book) => coverDataUrl(book), onProgress)

  const entries: PortfolioEntry[] = books.map((book, index) => ({
    t: book.title,
    a: book.authors.join(', '),
    y: book.publishedYear,
    p: book.pageCount,
    pub: book.publisher,
    s: book.summary,
    r: book.readStatus,
    c: book.copies > 1 ? book.copies : undefined,
    img: covers[index],
    // `notes` and `location` are intentionally absent — see the file header.
  }))

  return new Blob([buildHtml(title, entries)], { type: 'text/html;charset=utf-8' })
}

/**
 * Hand the file to the OS share sheet when we can — on Android that puts it
 * one tap from WhatsApp, which is where a book club actually lives. Falls back
 * to a download everywhere else.
 */
export async function sharePortfolio(blob: Blob, filename: string): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], filename, { type: 'text/html' })

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename.replace(/\.html$/, '') })
      return 'shared'
    } catch (error) {
      // AbortError means she dismissed the sheet — don't then force a download.
      if ((error as Error).name === 'AbortError') return 'shared'
    }
  }

  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return 'downloaded'
}
