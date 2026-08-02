import { db, updateBook } from './db'
import { condenseDescription, fetchEditionFacts, fetchWorkDetails } from './lookup'
import { normalizeGenres } from './genres'
import type { Book } from './types'

/**
 * Background enrichment pass.
 *
 * Two things live on Open Library's *work* record rather than the edition: the
 * description, and the complete subject list. Both need a second request per
 * book, which would roughly double the time to catalogue 400 books if it
 * happened inline — so it runs afterwards, while she carries on adding.
 *
 * The subject list matters as much as the description. The search endpoint
 * returns subjects in no meaningful order, so genres derived from a truncated
 * slice are unreliable: Harry Potter's first six are "Ghosts", "Monsters",
 * "Vampires", "Witches", which classify it as Horror. Re-deriving from the
 * full work list fixes those.
 *
 * The queue is deliberately slow and serial: it shares Open Library's ~1/sec
 * budget with live lookups, and live lookups must always win.
 */

let running = false
const listeners = new Set<(remaining: number) => void>()
let remaining = 0

function notify() {
  for (const listener of listeners) listener(remaining)
}

export function onEnrichProgress(listener: (remaining: number) => void): () => void {
  listeners.add(listener)
  listener(remaining)
  return () => {
    listeners.delete(listener)
  }
}

function wantsEnrichment(book: Book): boolean {
  return Boolean(book.workKey) && !book.enrichedAt
}

async function pending(): Promise<Book[]> {
  const all = await db.books.toArray()
  return all.filter(wantsEnrichment)
}

/**
 * Walk the queue until it's empty. Safe to call repeatedly — concurrent calls
 * are collapsed into the one already running.
 */
export async function runEnrichment(): Promise<void> {
  if (running) return
  running = true

  try {
    // Re-read each round: she's probably still adding, so the queue grows.
    for (;;) {
      const queue = await pending()
      remaining = queue.length
      notify()
      if (queue.length === 0) break

      for (const book of queue) {
        if (!book.workKey) continue
        try {
          const details = await fetchWorkDetails(book.workKey)
          const patch: Partial<Book> = { enrichedAt: Date.now() }

          if (details?.description && !book.descriptionRaw) {
            patch.descriptionRaw = details.description
            // Don't clobber a summary she's written herself.
            if (!(book.source === 'manual' && book.summary)) {
              patch.summary = condenseDescription(details.description)
            }
          }

          // Re-derive from the full list, which beats whatever slice we stored.
          if (details?.subjects.length) {
            const merged = [...new Set([...(book.subjects ?? []), ...details.subjects])]
            const genres = normalizeGenres(merged)
            patch.subjects = merged.slice(0, 20)
            if (genres.length) patch.genres = genres
          }

          await updateBook(book.id, patch)
        } catch (error) {
          console.warn('Enrichment failed', book.id, error)
          // Mark it done anyway so one bad record can't wedge the queue.
          await updateBook(book.id, { enrichedAt: Date.now() })
        }

        remaining = Math.max(0, remaining - 1)
        notify()
      }
    }
  } finally {
    running = false
    remaining = 0
    notify()
  }
}

/** Kick the queue after a short idle delay so it never races a live lookup. */
export function scheduleEnrichment(delayMs = 2500) {
  setTimeout(() => void runEnrichment(), delayMs)
}

/**
 * Repair records written before we asked Open Library for editions.
 *
 * Those took `publisher`, `language` and `isbn` off work-level aggregates
 * spanning every edition ever printed, so Harry Potter was published by
 * Росмэн, To Kill a Mockingbird was in Korean, and the ISBN belonged to
 * whichever printing happened to sort first.
 *
 * The delicate part is the title. It is hand-editable now, so overwriting it
 * blindly would throw away her corrections. It is only replaced when the
 * stored title still matches the work title the API returns — that is proof
 * nobody has touched it since we wrote it. The moment she renames anything,
 * this pass leaves it alone forever.
 */
export async function repairEditionFacts(): Promise<void> {
  const books = await db.books.toArray()

  for (const book of books) {
    if (!book.workKey) continue
    try {
      const facts = await fetchEditionFacts(book.workKey)
      if (!facts) continue

      const patch: Partial<Book> = {}

      if (facts.publisher && facts.publisher !== book.publisher) patch.publisher = facts.publisher
      if (facts.language && facts.language !== book.language) patch.language = facts.language
      if (facts.pageCount && !book.pageCount) patch.pageCount = facts.pageCount

      // Untouched machine title, and the edition has a better one.
      if (facts.title && facts.workTitle && book.title === facts.workTitle) {
        if (facts.title !== book.title) patch.title = facts.title
      }

      // A searched book is catalogued by title, not by printing — the stored
      // ISBN was a guess from a list of hundreds. Dropping it costs an ISBN
      // search on these books and returns the record to only claiming what
      // it actually knows.
      if (book.isbn13 && book.source === 'openlibrary') patch.isbn13 = undefined

      if (Object.keys(patch).length) await updateBook(book.id, patch)
    } catch (error) {
      console.warn('Edition repair failed', book.id, error)
    }
  }
}

/**
 * Force a re-run over every book — used once after the v2 migration, whose
 * genres came from the six subjects v1 happened to persist.
 */
export async function reenrichAll(): Promise<void> {
  await db.books.toCollection().modify((book) => {
    book.enrichedAt = undefined
  })
  await runEnrichment()
}
