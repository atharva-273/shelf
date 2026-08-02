# Shelf

**Live: https://atharva-273.github.io/shelf/**

Scan a bookshelf into a searchable library. Point the camera at the barcode on
the back of a book, hear a beep, move on. Local-first, free to run, no account.

Built for cataloguing a few hundred books in one sitting — roughly **10 seconds
a book**, so a 400-book shelf is an afternoon rather than a week.

---

## The portfolio export

A `.json` backup is the right artifact for *restoring* a library and the wrong
one for *showing* it. Settings → **Create shareable portfolio** produces a
single self-contained HTML page — covers, search, read/reading/unread filters,
tap a book for details — that can be emailed, AirDropped or dropped into a
WhatsApp thread and opened by anyone with a browser.

- Every cover is inlined as a downscaled data URI (220px, JPEG 0.72), so the
  file works offline and doesn't depend on Open Library staying up. Budget
  roughly **13 KB per book** — a 400-book portfolio lands around 5 MB.
- **Private fields are excluded by design.** Notes and shelf locations never
  leave the device inside a file meant to be broadcast; "lent to Priya" is not
  something you want in a book-club attachment.
- On Android it goes through the Web Share API, so it lands one tap from
  WhatsApp. Everywhere else it downloads.

Open Library serves permissive CORS headers, so its covers can be read off a
canvas and inlined. Google Books does not — those books fall back to a
typographic tile rather than failing.

---

## Running it

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

### Testing on a phone

The camera **will not start** over a plain `http://` LAN address — `getUserMedia`
requires a secure context, and only `localhost` is exempt. Use the HTTPS mode:

```bash
npm run dev:https
```

Open `https://<your-mac's-LAN-IP>:5173` on the phone. Chrome will warn about the
self-signed certificate once — tap **Advanced → Proceed**. After that the camera
works normally.

Find the LAN IP with:

```bash
ipconfig getifaddr en0
```

---

## How it fits together

| Layer | What it does |
|---|---|
| `lib/isbn.ts` | Check-digit validation, ISBN-10 → 13, ISSN/retail rejection |
| `lib/lookup.ts` | Open Library primary, Google Books enhancement, throttle + breaker |
| `lib/genres.ts` | Turns Open Library's subject noise into ~20 usable genres |
| `lib/trending.ts` | Open Library trending feed (daily / weekly / monthly) |
| `lib/enrich.ts` | Background pass: summaries + genre re-derivation |
| `lib/db.ts` | Dexie/IndexedDB — books and cover photos |
| `lib/book.ts` | Record shaping, image compression, backup export/import |
| `lib/portfolio.ts` | Self-contained shareable HTML export |
| `hooks/use-speech.ts` | Web Speech API voice input |
| `hooks/use-scanner.ts` | Camera + barcode detection — **parked**, see below |

### Genres

Open Library returns 50–65 "subjects" per book, most of which can't be shown
to a person:

```
"Fiction"                                 ← useful
"FICTION / Literary"                      ← useful, and structured (BISAC)
"nyt:trade_fiction_paperback=2008-01-05"  ← bestseller-list metadata
"Weltgeschichte" / "Hombre" / "Historia"  ← same subject, four languages
"Cb113.h4 h3713 2015"                     ← Library of Congress call number
```

`lib/genres.ts` discards the unreadable ones and maps the rest onto a fixed set
of ~20 genres, capped at three per book. A genre must be **corroborated** —
two independent subjects, or one structured BISAC heading. Without that rule a
single stray keyword decides the classification: Harry Potter's first subjects
are *Ghosts, Monsters, Vampires, Witches*, which on their own file it under
Horror.

Because subjects come back in no useful order, genres derived from a truncated
list are unreliable. The background pass re-derives them from each work's full
subject list, which is what actually gets Harry Potter to *Fantasy*.

### The scanner is parked, not deleted

`components/scan-view.tsx` and `hooks/use-scanner.ts` still build and are
covered by typecheck; they're just not mounted as a tab. Re-adding the entry
point in `App.tsx` brings the whole flow back.

### Metadata sources

**Open Library is the primary source; Google Books is a best-effort
enhancement** — deliberately the inverse of the obvious design.

Google Books has better descriptions, but *keyless* requests get a hard `429`
from most IPs (verified during development — three consecutive retries, all
429). Building the critical path on it means the app fails for anyone who
hasn't set up a Cloud project. Open Library needs no key and answers reliably.

A circuit breaker disables Google for 10 minutes after a 429, so a 400-book
sweep doesn't waste a round trip per book on a guaranteed failure.

**Optional:** set a Google Books API key to get better summaries.

```bash
cp .env.example .env.local
# then edit VITE_GOOGLE_BOOKS_KEY
```

Get one from the Google Cloud Console (enable the Books API). Restrict it by
HTTP referrer — it ships in the client bundle. Everything works without it.

### Why summaries arrive late

Descriptions live on Open Library's *work* record, which is a second request per
book. Doing that during a sweep would roughly double the time to catalogue 400
books. Instead the scan grabs title/author/pages/cover fast, and a background
queue fills in summaries afterwards while she keeps scanning. Progress shows in
Settings.

### Rate limits worth knowing

- **Open Library API** — ~1 req/sec. Requests are serialised through a throttle.
  Browsers can't set a `User-Agent`, so the higher identified-app limit isn't
  available to us.
- **Open Library covers** — 100 requests per IP per 5 minutes for *ISBN*
  lookups, and it returns **403** past that. Lookups by numeric cover id are not
  capped, so those are preferred and the id is stored per book. Covers are
  lazy-loaded, and a cover that stalls or fails degrades to a title card rather
  than an empty box.

---

## Data and backups

Everything lives in IndexedDB on the device. No server, no account, nothing that
can expire or be shut down — and nothing that syncs. **Clearing browser data
wipes the library**, which is why the backup button is the most prominent
control in Settings.

- **Download backup** — JSON including cover photos (base64). Restores fully.
- **Export as spreadsheet** — CSV for Excel/Sheets. One-way.

Cover photos are downscaled to 900px JPEG on capture, so 400 of them stay a
sane size rather than 2 GB of raw phone photos.

---

## Browser support

Built and tested against **Chrome on Android**, which is the best case: native
barcode detection and full speech support.

| | Barcode | Voice |
|---|---|---|
| Chrome / Android | Native (Play Services) | Yes, incl. on-device |
| Chrome / Edge desktop | WASM fallback | Yes (cloud) |
| Safari, any iOS browser | WASM fallback | Yes |
| Firefox | WASM fallback | No — mic button hides |

Barcode detection goes through the `barcode-detector` polyfill, which uses the
native `BarcodeDetector` when present and ZXing WASM otherwise — one code path.
The WASM binary is served from `public/` rather than the jsDelivr CDN it
defaults to, so the fallback works offline and doesn't call a third party.

Voice input defaults to `en-IN`, which recognises Indian author and title names
noticeably better than `en-US`. Change it in `hooks/use-speech.ts`.

---

## Deploying

Pushing to `main` deploys to GitHub Pages automatically via
`.github/workflows/deploy.yml`. No manual step.

```bash
git push          # → https://atharva-273.github.io/shelf/
```

To build locally for a subpath:

```bash
VITE_BASE_PATH=/shelf/ npm run build   # → dist/
```

`VITE_BASE_PATH` matters because Pages serves a project repo from `/<repo>/`.
Anything referencing a `public/` file must go through `import.meta.env.BASE_URL`
(TypeScript) or `%BASE_URL%` (HTML) rather than a bare leading slash — the WASM
binary and the manifest both do.

### A note on origins

The library lives in IndexedDB, which is **scoped per origin**. Books added on
`localhost:5173` will not appear on the deployed site and vice versa. That's a
browser guarantee, not a bug. Move data between them with the backup file.
