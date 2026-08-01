export type ResolveStatus =
  | 'resolved' // came back with title + author + something else useful
  | 'partial' // found, but thin — missing author or summary
  | 'manual' // typed in by hand
  | 'unresolved' // scanned an ISBN, found nothing

export type ReadStatus = 'unread' | 'reading' | 'read'

export type Source = 'google' | 'openlibrary' | 'mixed' | 'manual'

export interface Book {
  /** ISBN-13 when we have one, otherwise a generated id. */
  id: string
  isbn13?: string
  isbn10?: string

  title: string
  subtitle?: string
  authors: string[]

  publisher?: string
  publishedYear?: string
  pageCount?: number

  /** Short 1–2 sentence blurb, condensed from the source description. */
  summary?: string
  /** Full description as retrieved, kept so we can re-condense later. */
  descriptionRaw?: string
  subjects?: string[]

  /** Cover URL from an API (Google Books / Open Library). */
  coverRemote?: string
  /**
   * Open Library numeric cover id. Worth storing separately: the covers
   * endpoint only rate-limits lookups by ISBN, so `/b/id/{coverId}` is
   * unthrottled where `/b/isbn/{isbn}` is capped at 100 per 5 minutes.
   */
  coverId?: number
  /** Key into the `covers` table when she's photographed it herself. */
  coverLocalKey?: string

  language?: string
  source: Source
  status: ResolveStatus

  /**
   * Open Library work key (e.g. "/works/OL17075811W"). Descriptions live on
   * the work, not the edition, so we keep this to enrich the summary in the
   * background instead of paying for the extra request mid-sweep.
   */
  workKey?: string
  /** Set once the background summary pass has run, successful or not. */
  enrichedAt?: number

  /** She may own more than one of the same book. */
  copies: number

  location?: string
  readStatus?: ReadStatus
  notes?: string

  addedAt: number
  updatedAt: number
}

export interface StoredCover {
  key: string
  blob: Blob
}

/** A lookup result before it becomes a Book — no local/user fields yet. */
export type LookupResult = Omit<
  Book,
  | 'id'
  | 'copies'
  | 'addedAt'
  | 'updatedAt'
  | 'enrichedAt'
  | 'coverLocalKey'
  | 'location'
  | 'readStatus'
  | 'notes'
> & { id?: string }
