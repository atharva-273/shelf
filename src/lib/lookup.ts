import type { LookupResult } from './types'
import { normalizeIsbn } from './isbn'
import { normalizeGenres } from './genres'

/**
 * Metadata resolution.
 *
 * Open Library is the primary source and Google Books is a best-effort
 * enhancement — not the other way round. That's a deliberate inversion of the
 * obvious design: Google Books has better descriptions, but *keyless* requests
 * get a hard 429 from most IPs, so building the critical path on it means the
 * app fails for anyone who hasn't set up a Cloud project. Open Library needs no
 * key, no account, and answers reliably.
 *
 * With `VITE_GOOGLE_BOOKS_KEY` set, Google comes back into play and summaries
 * get noticeably better. Without it, everything still works.
 *
 * Both APIs are CORS-enabled, so this all runs in the browser with no backend.
 */

const GOOGLE_BOOKS = 'https://www.googleapis.com/books/v1/volumes'
const OPEN_LIBRARY_SEARCH = 'https://openlibrary.org/search.json'

const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_BOOKS_KEY as string | undefined

// ---------------------------------------------------------------------------
// Rate limiting and failure handling
// ---------------------------------------------------------------------------

/**
 * Open Library asks for ~1 request/second. Browsers can't set a User-Agent
 * header (it's forbidden), so we can't claim the higher identified-app limit —
 * we just have to be polite. A serialised queue keeps a 400-book sweep from
 * getting 403'd halfway through.
 */
function createThrottle(minIntervalMs: number) {
  let chain: Promise<unknown> = Promise.resolve()
  let lastRun = 0

  return function throttle<T>(task: () => Promise<T>): Promise<T> {
    const result = chain.then(async () => {
      const wait = Math.max(0, lastRun + minIntervalMs - Date.now())
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      lastRun = Date.now()
      return task()
    })
    chain = result.catch(() => undefined)
    return result
  }
}

const throttleOpenLibrary = createThrottle(1100)

/**
 * Once Google rate-limits us it stays rate-limited for a while. Without a
 * breaker, all 400 lookups in a sweep would each waste a round trip on a
 * guaranteed 429.
 */
const googleBreaker = {
  openUntil: 0,
  get isOpen() {
    return Date.now() < this.openUntil
  },
  trip(minutes = 10) {
    this.openUntil = Date.now() + minutes * 60_000
    console.info(`Google Books rate-limited — skipping it for ${minutes} minutes.`)
  },
}

export function googleAvailable(): boolean {
  return !googleBreaker.isOpen
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Strip HTML and decode entities without ever evaluating the markup. */
function toPlainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  let text = (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim()

  // Order matters: strip the markdown artefacts first, because removing them
  // frequently *exposes* a leading quote or dash that then needs trimming too.
  // Crowdsourced records are full of `**"** Once upon a time…` shapes.
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_]{2,}/g, '')

  // Trailing source credits ("-- from the publisher") read as noise on a card.
  text = text.replace(/\s*[-–—(]*\s*(source|from the publisher|back cover)\b.*$/i, '')

  // Descriptions are often pasted starting mid-quote.
  text = text.replace(/^[”“"'’‘\s.,;:—–-]+/, '')

  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Sentence splitter.
 *
 * The trailing `["”'’)\]]*` is load-bearing. Publisher copy routinely ends a
 * sentence with the full stop *inside* a quotation — `…what it means to be
 * "human."` — and a naive `[.!?]+(\s|$)` fails to match there, silently
 * dropping the entire first sentence and resuming at the orphaned quote mark.
 */
const SENTENCE = /[^.!?]+[.!?]+["”'’)\]]*(?:\s|$)/g

/**
 * Publisher descriptions are typically 300–800 words of marketing copy. She
 * wants two lines. Take whole sentences up to a budget so it never ends
 * mid-clause.
 */
export function condenseDescription(raw?: string, budget = 220): string | undefined {
  if (!raw) return undefined
  const text = toPlainText(raw)
  if (!text) return undefined
  if (text.length <= budget) return text

  const sentences = text.match(SENTENCE)
  if (!sentences?.length) return truncateAtWord(text, budget)

  let out = ''
  for (const sentence of sentences) {
    if (out && out.length + sentence.length > budget) break
    out += sentence
  }
  out = out.trim()

  // A single sentence can blow the whole budget on its own — publisher copy
  // loves a 300-character opener — so it still needs trimming.
  if (!out) return truncateAtWord(text, budget)
  if (out.length > budget * 1.35) return truncateAtWord(out, budget)
  return out
}

/** Cut at the last word boundary before the budget so it never ends mid-word. */
function truncateAtWord(text: string, budget: number): string {
  if (text.length <= budget) return text
  const slice = text.slice(0, budget)
  const lastSpace = slice.lastIndexOf(' ')
  const cut = lastSpace > budget * 0.6 ? slice.slice(0, lastSpace) : slice
  return `${cut.replace(/[\s,;:.–—-]+$/, '')}…`
}

function cleanGoogleThumbnail(url?: string): string | undefined {
  if (!url) return undefined
  // Google serves these over http and with a fake page-curl graphic.
  return url.replace(/^http:\/\//, 'https://').replace(/&edge=curl/g, '')
}

function yearOf(dateish?: string): string | undefined {
  return dateish?.match(/\d{4}/)?.[0]
}

/**
 * `default=false` matters more than it looks: without it, Open Library serves a
 * 1×1 transparent pixel for covers it doesn't have, instead of a 404. That
 * means `onError` never fires and the UI sits on a blank box forever. With it,
 * a missing cover is a real 404 and the fallback chain advances.
 */
const NO_PLACEHOLDER = '?default=false'

/**
 * Cover by numeric id — this endpoint is NOT subject to the 100-per-5-minutes
 * cap that applies to ISBN lookups, so prefer it wherever we have the id.
 */
export function openLibraryCoverById(coverId: number, size: 'S' | 'M' | 'L' = 'M'): string {
  return `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg${NO_PLACEHOLDER}`
}

/** Cover by ISBN — rate-limited; only use as a last resort. */
export function openLibraryCoverUrl(isbn13: string, size: 'S' | 'M' | 'L' = 'M'): string {
  return `https://covers.openlibrary.org/b/isbn/${isbn13}-${size}.jpg${NO_PLACEHOLDER}`
}

// ---------------------------------------------------------------------------
// Open Library
// ---------------------------------------------------------------------------

/**
 * A search hit is a *work*, not an edition. `publisher`, `language` and `isbn`
 * on the doc are aggregates over every edition ever published — Harry Potter
 * comes back with 196 publishers, 49 languages and 628 ISBNs, in no
 * meaningful order. Reading `[0]` off those is how the shelf ended up
 * attributing Harry Potter to Росмэн and filing Sapiens under Portuguese.
 *
 * The `editions` subquery answers the edition-shaped half of the question in
 * the same request, so we read titles and publishers from there instead.
 */
interface OpenLibraryEditionDoc {
  title?: string
  subtitle?: string
  publisher?: string[]
  publish_date?: string[]
  language?: string[]
  isbn?: string[]
  number_of_pages?: number
}

interface OpenLibrarySearchDoc {
  key?: string
  title?: string
  subtitle?: string
  author_name?: string[]
  first_publish_year?: number
  cover_i?: number
  number_of_pages_median?: number
  first_sentence?: string[]
  subject?: string[]
  editions?: { docs?: OpenLibraryEditionDoc[] }
}

const SEARCH_FIELDS = [
  'key',
  'title',
  'subtitle',
  'author_name',
  // Legitimately work-level: the year the work first appeared, and the median
  // extent across editions. Neither claims to describe a specific printing.
  'first_publish_year',
  'cover_i',
  'number_of_pages_median',
  'first_sentence',
  'subject',
  // Everything edition-shaped comes from here. The API caps this at one
  // edition per work and ignores `editions.limit`, so we can't ask for
  // several and choose — the language preference has to go on the request.
  'editions',
  'editions.title',
  'editions.subtitle',
  'editions.publisher',
  'editions.publish_date',
  'editions.language',
  'editions.isbn',
  'editions.number_of_pages',
].join(',')

function fromSearchDoc(doc: OpenLibrarySearchDoc, knownIsbn?: string): LookupResult | null {
  const edition = doc.editions?.docs?.[0]

  // The work's own title is stored in the language the work was written in —
  // "O Alquimista", "Преступление и наказание". The edition's title is the one
  // printed on the copy in front of you, so it wins whenever we have it.
  const title = edition?.title ?? doc.title
  if (!title) return null

  // `first_sentence` is the book's opening line, not a blurb — only worth
  // showing when nothing better turns up, so it goes in as a placeholder that
  // the background enrichment pass can overwrite.
  const opener = doc.first_sentence?.[0]

  return {
    // Only ever the ISBN we were *given* — from a barcode or a typed-in
    // number. A searched book is catalogued at the level of the title, not
    // the printing, so there is no honest answer to "which ISBN"; picking one
    // out of the edition's list would just be a confident guess.
    isbn13: knownIsbn,
    title,
    subtitle: edition?.subtitle ?? doc.subtitle,
    authors: doc.author_name ?? [],
    publisher: edition?.publisher?.[0],
    publishedYear: doc.first_publish_year ? String(doc.first_publish_year) : undefined,
    pageCount: edition?.number_of_pages ?? doc.number_of_pages_median,
    summary: opener && opener.length > 40 ? condenseDescription(opener) : undefined,
    // Keep a slice of the raw subjects for re-derivation, but the whole list
    // for the genre pass — the useful BISAC headings are often near the end.
    subjects: doc.subject?.slice(0, 12),
    genres: normalizeGenres(doc.subject),
    coverId: doc.cover_i,
    coverRemote: doc.cover_i ? openLibraryCoverById(doc.cover_i, 'M') : undefined,
    workKey: doc.key,
    language: edition?.language?.[0],
    source: 'openlibrary',
    status: 'partial',
  }
}

/**
 * One request gets title, authors, pages, cover id, subjects AND the work key.
 * Cheaper and richer than the `api/books` endpoint, which needs a second hop
 * for the work and returns a rate-limited cover URL.
 */
async function fetchOpenLibraryByIsbn(
  isbn13: string,
  signal?: AbortSignal,
): Promise<LookupResult | null> {
  const params = new URLSearchParams({
    q: `isbn:${isbn13}`,
    limit: '1',
    fields: SEARCH_FIELDS,
  })

  const response = await throttleOpenLibrary(() =>
    fetch(`${OPEN_LIBRARY_SEARCH}?${params}`, { signal }),
  )
  if (!response.ok) return null

  const data = (await response.json()) as { docs?: OpenLibrarySearchDoc[] }
  const doc = data.docs?.[0]
  return doc ? fromSearchDoc(doc, isbn13) : null
}

export interface EditionFacts {
  /**
   * The work's own title, in its original language. Not for display — it's
   * how a repair pass tells an untouched machine-written title from one she
   * has since corrected by hand.
   */
  workTitle?: string
  title?: string
  publisher?: string
  language?: string
  pageCount?: number
}

/**
 * Edition-level facts for a book already in the library, looked up by the
 * work key we stored when it was added. Exists to repair records written
 * before we asked for editions, whose publisher and language were read off
 * work-level aggregates and are mostly wrong.
 */
export async function fetchEditionFacts(
  workKey: string,
  signal?: AbortSignal,
): Promise<EditionFacts | null> {
  const key = workKey.startsWith('/') ? workKey : `/${workKey}`
  let docs = await fetchOpenLibraryDocs(`key:"${key}"`, 1, 'eng', signal)
  if (docs.length === 0) docs = await fetchOpenLibraryDocs(`key:"${key}"`, 1, undefined, signal)

  const doc = docs[0]
  if (!doc) return null
  const edition = doc.editions?.docs?.[0]

  return {
    workTitle: doc.title,
    title: edition?.title,
    publisher: edition?.publisher?.[0],
    language: edition?.language?.[0],
    pageCount: edition?.number_of_pages,
  }
}

export interface WorkDetails {
  description: string | null
  /** The work's full subject list — richer than the edition search result. */
  subjects: string[]
}

/**
 * Descriptions live on the work record, not the edition. This is the second
 * request we deliberately *don't* make during a sweep — it runs afterwards in
 * the background so scanning stays fast.
 *
 * It also returns the full subject list, which matters: the search endpoint's
 * subjects arrive in no useful order, so a truncated slice of them produces
 * bad genres. Re-deriving from the complete list here corrects that.
 */
export async function fetchWorkDetails(
  workKey: string,
  signal?: AbortSignal,
): Promise<WorkDetails | null> {
  const key = workKey.startsWith('/') ? workKey : `/${workKey}`
  const response = await throttleOpenLibrary(() =>
    fetch(`https://openlibrary.org${key}.json`, { signal }),
  )
  if (!response.ok) return null

  const work = (await response.json()) as {
    description?: string | { value?: string }
    subjects?: string[]
  }
  const description =
    typeof work.description === 'string' ? work.description : (work.description?.value ?? null)

  return { description, subjects: work.subjects ?? [] }
}

async function fetchOpenLibraryDocs(
  query: string,
  limit: number,
  language: string | undefined,
  signal?: AbortSignal,
): Promise<OpenLibrarySearchDoc[]> {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
    fields: SEARCH_FIELDS,
  })
  // Has to be its own parameter. Inside `q` as `language:eng` it is silently
  // ignored, and the edition subquery comes back in whatever language it
  // likes — that is how a search for Sapiens returned a Polish printing.
  if (language) params.set('language', language)

  const response = await throttleOpenLibrary(() =>
    fetch(`${OPEN_LIBRARY_SEARCH}?${params}`, { signal }),
  )
  if (!response.ok) return []

  const data = (await response.json()) as { docs?: OpenLibrarySearchDoc[] }
  return data.docs ?? []
}

/**
 * English first, then anything.
 *
 * `language=eng` is what makes the edition subquery return an English
 * printing, and with it the English title. But it filters *works*, not just
 * editions — a book with no English edition disappears entirely. "Gunahon Ka
 * Devta" goes from two hits to zero. So the unfiltered query runs as a
 * fallback, which costs a second request only for books that have never been
 * published in English, and those are exactly the books whose regional title
 * is the correct answer anyway. She can rename any of them by hand.
 */
async function searchOpenLibrary(
  query: string,
  signal?: AbortSignal,
): Promise<LookupResult[]> {
  let docs = await fetchOpenLibraryDocs(query, 10, 'eng', signal)
  if (docs.length === 0) docs = await fetchOpenLibraryDocs(query, 10, undefined, signal)

  return docs
    .map((doc) => fromSearchDoc(doc))
    .filter((result): result is LookupResult => result !== null)
}

// ---------------------------------------------------------------------------
// Google Books (best effort)
// ---------------------------------------------------------------------------

interface GoogleVolume {
  id: string
  volumeInfo?: {
    title?: string
    subtitle?: string
    authors?: string[]
    publisher?: string
    publishedDate?: string
    description?: string
    pageCount?: number
    categories?: string[]
    language?: string
    imageLinks?: { thumbnail?: string; smallThumbnail?: string }
    industryIdentifiers?: { type: string; identifier: string }[]
  }
}

function googleUrl(query: string, maxResults = 1): string {
  const params = new URLSearchParams({
    q: query,
    maxResults: String(maxResults),
    printType: 'books',
  })
  if (GOOGLE_KEY) params.set('key', GOOGLE_KEY)
  return `${GOOGLE_BOOKS}?${params}`
}

function fromGoogleVolume(volume: GoogleVolume): LookupResult | null {
  const info = volume.volumeInfo
  if (!info?.title) return null

  const ids = info.industryIdentifiers ?? []
  const isbn13 = ids.find((i) => i.type === 'ISBN_13')?.identifier
  const isbn10 = ids.find((i) => i.type === 'ISBN_10')?.identifier

  return {
    isbn13: isbn13 ? normalizeIsbn(isbn13) : undefined,
    isbn10: isbn10 ? normalizeIsbn(isbn10) : undefined,
    title: info.title,
    subtitle: info.subtitle,
    authors: info.authors ?? [],
    publisher: info.publisher,
    publishedYear: yearOf(info.publishedDate),
    pageCount: info.pageCount,
    descriptionRaw: info.description,
    summary: condenseDescription(info.description),
    subjects: info.categories,
    genres: normalizeGenres(info.categories),
    coverRemote: cleanGoogleThumbnail(info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail),
    language: info.language,
    source: 'google',
    status: 'partial',
  }
}

/** Returns null on any failure — Google is never allowed to break a lookup. */
async function tryGoogle(query: string, signal?: AbortSignal, max = 1): Promise<GoogleVolume[] | null> {
  if (googleBreaker.isOpen) return null
  try {
    const response = await fetch(googleUrl(query, max), { signal })
    if (response.status === 429 || response.status === 403) {
      googleBreaker.trip()
      return null
    }
    if (!response.ok) return null
    const data = (await response.json()) as { items?: GoogleVolume[] }
    return data.items ?? []
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    return null
  }
}

// ---------------------------------------------------------------------------
// Merge + grade
// ---------------------------------------------------------------------------

function merge(primary: LookupResult, filler: Partial<LookupResult>): LookupResult {
  const merged: LookupResult = { ...primary }
  let usedFiller = false

  const isEmpty = (value: unknown) =>
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)

  for (const key of [
    'title',
    'subtitle',
    'authors',
    'publisher',
    'publishedYear',
    'pageCount',
    'descriptionRaw',
    'summary',
    'subjects',
    'genres',
    'coverRemote',
    'coverId',
    'workKey',
    'isbn10',
    'language',
  ] as const) {
    if (isEmpty(merged[key]) && !isEmpty(filler[key])) {
      // Widening through unknown: each key's types line up by construction.
      ;(merged as Record<string, unknown>)[key] = filler[key]
      usedFiller = true
    }
  }

  if (usedFiller && merged.source !== filler.source) merged.source = 'mixed'
  return merged
}

function grade(result: LookupResult): LookupResult {
  const hasCore = Boolean(result.title && result.authors.length)
  const hasExtra = Boolean(result.summary || result.pageCount || result.coverRemote)
  return { ...result, status: hasCore && hasExtra ? 'resolved' : 'partial' }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve an ISBN. Returns null only when neither source knows about it — at
 * which point the UI drops her into the search box.
 */
export async function lookupByIsbn(
  isbn13: string,
  signal?: AbortSignal,
): Promise<LookupResult | null> {
  let base: LookupResult | null = null
  try {
    base = await fetchOpenLibraryByIsbn(isbn13, signal)
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    console.warn('Open Library lookup failed', error)
  }

  // Google fills in what Open Library is weakest at — descriptions.
  const wantsGoogle = !base || !base.summary || !base.authors.length || !base.coverRemote
  if (wantsGoogle) {
    const volumes = await tryGoogle(`isbn:${isbn13}`, signal)
    const google = volumes?.[0] ? fromGoogleVolume(volumes[0]) : null

    if (google && base) return grade(merge(base, google))
    if (google) return grade({ ...google, isbn13: google.isbn13 ?? isbn13 })
  }

  return base ? grade(base) : null
}

/**
 * Free-text search — this backs the search box and the voice input.
 *
 * Open Library first because it always answers; Google's results are folded in
 * when it's reachable, since its relevance ranking on partial titles is better.
 */
export async function searchBooks(
  query: string,
  signal?: AbortSignal,
): Promise<LookupResult[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  const [googleVolumes, openLibraryResults] = await Promise.all([
    tryGoogle(trimmed, signal, 10),
    searchOpenLibrary(trimmed, signal).catch((error) => {
      if ((error as Error).name === 'AbortError') throw error
      return [] as LookupResult[]
    }),
  ])

  const googleResults = (googleVolumes ?? [])
    .map(fromGoogleVolume)
    .filter((r): r is LookupResult => r !== null)

  // Interleave so the top of the list has the best of both, then dedupe.
  const seen = new Set<string>()
  const merged: LookupResult[] = []
  const longest = Math.max(googleResults.length, openLibraryResults.length)

  for (let i = 0; i < longest; i++) {
    for (const candidate of [googleResults[i], openLibraryResults[i]]) {
      if (!candidate) continue
      const key =
        candidate.isbn13 ??
        `${candidate.title.toLowerCase()}|${candidate.authors[0]?.toLowerCase() ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(candidate)
    }
  }

  return merged.slice(0, 12)
}
