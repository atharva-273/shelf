import type { Book, LookupResult } from './types'
import { db } from './db'

export function makeId(): string {
  return crypto.randomUUID()
}

export function bookFromLookup(result: LookupResult, overrides: Partial<Book> = {}): Book {
  const now = Date.now()
  return {
    id: result.isbn13 ?? makeId(),
    isbn13: result.isbn13,
    isbn10: result.isbn10,
    title: result.title,
    subtitle: result.subtitle,
    authors: result.authors ?? [],
    publisher: result.publisher,
    publishedYear: result.publishedYear,
    pageCount: result.pageCount,
    summary: result.summary,
    descriptionRaw: result.descriptionRaw,
    subjects: result.subjects,
    genres: result.genres,
    coverRemote: result.coverRemote,
    coverId: result.coverId,
    workKey: result.workKey,
    language: result.language,
    source: result.source,
    status: result.status,
    copies: 1,
    readStatus: 'unread',
    format: 'physical',
    addedAt: now,
    updatedAt: now,
    ...overrides,
  }
}

/**
 * Placeholder for an ISBN that resolved to nothing.
 *
 * Only reachable from the parked scanner (components/scan-view.tsx); the
 * search flow always has a title before it writes anything.
 */
export function unresolvedBook(isbn13: string): Book {
  const now = Date.now()
  return {
    id: isbn13,
    isbn13,
    title: '',
    authors: [],
    source: 'manual',
    status: 'unresolved',
    copies: 1,
    readStatus: 'unread',
    format: 'physical',
    addedAt: now,
    updatedAt: now,
  }
}

export function authorLine(book: Pick<Book, 'authors'>): string {
  if (!book.authors.length) return 'Unknown author'
  if (book.authors.length <= 2) return book.authors.join(' & ')
  return `${book.authors[0]} + ${book.authors.length - 1} more`
}

// ---------------------------------------------------------------------------
// Cover capture
// ---------------------------------------------------------------------------

/**
 * Downscale before storing. A raw phone photo is 3–6 MB; 400 of those would
 * blow past IndexedDB quotas and make the backup file unusable.
 */
export async function compressImage(file: File | Blob, maxEdge = 900, quality = 0.82): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return file
  }
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob ?? file),
      'image/jpeg',
      quality,
    )
  })
}

// ---------------------------------------------------------------------------
// Export / import
// ---------------------------------------------------------------------------

interface BackupFile {
  format: 'shelf-backup'
  version: 1
  exportedAt: string
  books: Book[]
  covers: { key: string; dataUrl: string }[]
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob()
}

export async function exportBackup(): Promise<Blob> {
  const books = await db.books.toArray()
  const storedCovers = await db.covers.toArray()
  const covers = await Promise.all(
    storedCovers.map(async (cover) => ({
      key: cover.key,
      dataUrl: await blobToDataUrl(cover.blob),
    })),
  )

  const payload: BackupFile = {
    format: 'shelf-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    books,
    covers,
  }
  return new Blob([JSON.stringify(payload)], { type: 'application/json' })
}

export async function importBackup(file: File): Promise<{ added: number; skipped: number }> {
  const text = await file.text()
  const payload = JSON.parse(text) as BackupFile

  if (payload.format !== 'shelf-backup' || !Array.isArray(payload.books)) {
    throw new Error("That doesn't look like a Shelf backup file.")
  }

  let added = 0
  let skipped = 0

  for (const book of payload.books) {
    const existing = await db.books.get(book.id)
    if (existing) {
      skipped++
      continue
    }
    await db.books.put(book)
    added++
  }

  for (const cover of payload.covers ?? []) {
    if (await db.covers.get(cover.key)) continue
    await db.covers.put({ key: cover.key, blob: await dataUrlToBlob(cover.dataUrl) })
  }

  return { added, skipped }
}

function csvCell(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export async function exportCsv(): Promise<Blob> {
  const books = await db.books.orderBy('addedAt').toArray()
  const headers = [
    'Title',
    'Subtitle',
    'Authors',
    'ISBN-13',
    'Publisher',
    'Year',
    'Pages',
    'Copies',
    'Summary',
    'Location',
    'Read status',
    'Notes',
    'Added',
  ]

  const rows = books.map((book) =>
    [
      book.title,
      book.subtitle,
      book.authors.join('; '),
      book.isbn13,
      book.publisher,
      book.publishedYear,
      book.pageCount,
      book.copies,
      book.summary,
      book.location,
      book.readStatus,
      book.notes,
      new Date(book.addedAt).toISOString().slice(0, 10),
    ]
      .map(csvCell)
      .join(','),
  )

  return new Blob([[headers.join(','), ...rows].join('\n')], {
    type: 'text/csv;charset=utf-8',
  })
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
