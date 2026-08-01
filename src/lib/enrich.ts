import { db, updateBook } from './db'
import { condenseDescription, fetchWorkDescription } from './lookup'
import type { Book } from './types'

/**
 * Background summary pass.
 *
 * Descriptions live on Open Library's *work* record, which is a second request
 * per book. Making that request during a sweep would roughly double the time
 * to catalogue 400 books for a field she can live without in the moment — so
 * instead we grab title/author/pages/cover fast, and come back for summaries
 * afterwards while she carries on scanning.
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

function wantsSummary(book: Book): boolean {
  return Boolean(book.workKey) && !book.enrichedAt && !book.descriptionRaw
}

async function pending(): Promise<Book[]> {
  const all = await db.books.toArray()
  return all.filter(wantsSummary)
}

/**
 * Walk the queue until it's empty. Safe to call repeatedly — concurrent calls
 * are collapsed into the one already running.
 */
export async function runEnrichment(): Promise<void> {
  if (running) return
  running = true

  try {
    // Re-read each round: she's probably still scanning, so the queue grows.
    for (;;) {
      const queue = await pending()
      remaining = queue.length
      notify()
      if (queue.length === 0) break

      for (const book of queue) {
        if (!book.workKey) continue
        try {
          const description = await fetchWorkDescription(book.workKey)
          await updateBook(book.id, {
            enrichedAt: Date.now(),
            ...(description
              ? {
                  descriptionRaw: description,
                  // Don't clobber anything she's edited by hand.
                  ...(book.source === 'manual' && book.summary
                    ? {}
                    : { summary: condenseDescription(description) }),
                }
              : {}),
          })
        } catch (error) {
          console.warn('Summary enrichment failed', book.id, error)
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
