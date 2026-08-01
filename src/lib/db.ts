import Dexie, { type Table } from 'dexie'
import type { Book, StoredCover } from './types'

/**
 * Local-first storage. Everything lives in IndexedDB on her device — no
 * account, no server, nothing that can expire or get shut down.
 *
 * The tradeoff is that clearing browser data wipes it, which is why the
 * export button in Settings is not optional.
 */
class ShelfDatabase extends Dexie {
  books!: Table<Book, string>
  covers!: Table<StoredCover, string>

  constructor() {
    super('shelf')
    this.version(1).stores({
      // Indexed fields only; the rest of the record rides along unindexed.
      books: 'id, isbn13, title, addedAt, status, readStatus',
      covers: 'key',
    })
  }
}

export const db = new ShelfDatabase()

export async function bookExists(isbn13: string): Promise<Book | undefined> {
  return db.books.where('isbn13').equals(isbn13).first()
}

export async function addBook(book: Book): Promise<void> {
  await db.books.put(book)
}

export async function updateBook(id: string, patch: Partial<Book>): Promise<void> {
  await db.books.update(id, { ...patch, updatedAt: Date.now() })
}

export async function deleteBook(id: string): Promise<void> {
  const book = await db.books.get(id)
  if (book?.coverLocalKey) {
    await db.covers.delete(book.coverLocalKey)
  }
  await db.books.delete(id)
}

/** Bump the copy count when she scans a book she already owns. */
export async function incrementCopies(id: string): Promise<void> {
  const book = await db.books.get(id)
  if (!book) return
  await db.books.update(id, { copies: book.copies + 1, updatedAt: Date.now() })
}

export async function saveCover(key: string, blob: Blob): Promise<void> {
  await db.covers.put({ key, blob })
}

export async function getCover(key: string): Promise<Blob | undefined> {
  return (await db.covers.get(key))?.blob
}
