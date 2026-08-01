/**
 * ISBN utilities.
 *
 * Everything here runs locally — validating the check digit before we hit the
 * network catches camera misreads for free, which matters a lot when you're
 * scanning a few hundred books in one sitting.
 */

/** Strip hyphens, spaces and anything else that isn't a digit or a trailing X. */
export function normalizeIsbn(raw: string): string {
  return raw.replace(/[^0-9Xx]/g, '').toUpperCase()
}

export function isValidIsbn13(value: string): boolean {
  const isbn = normalizeIsbn(value)
  if (!/^\d{13}$/.test(isbn)) return false
  let sum = 0
  for (let i = 0; i < 12; i++) {
    sum += Number(isbn[i]) * (i % 2 === 0 ? 1 : 3)
  }
  const check = (10 - (sum % 10)) % 10
  return check === Number(isbn[12])
}

export function isValidIsbn10(value: string): boolean {
  const isbn = normalizeIsbn(value)
  if (!/^\d{9}[\dX]$/.test(isbn)) return false
  let sum = 0
  for (let i = 0; i < 9; i++) {
    sum += Number(isbn[i]) * (10 - i)
  }
  sum += isbn[9] === 'X' ? 10 : Number(isbn[9])
  return sum % 11 === 0
}

export function isbn10To13(value: string): string | null {
  const isbn = normalizeIsbn(value)
  if (!isValidIsbn10(isbn)) return null
  const core = `978${isbn.slice(0, 9)}`
  let sum = 0
  for (let i = 0; i < 12; i++) {
    sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3)
  }
  return core + String((10 - (sum % 10)) % 10)
}

/**
 * 978 and 979 are the "Bookland" prefixes — an EAN-13 starting with either is
 * a book. 977 is an ISSN (a magazine or journal), which we want to reject with
 * a useful message rather than a generic failure.
 */
export function isBooklandEan(value: string): boolean {
  const isbn = normalizeIsbn(value)
  return /^97[89]\d{10}$/.test(isbn) && isValidIsbn13(isbn)
}

export function isIssnBarcode(value: string): boolean {
  return /^977\d{10}$/.test(normalizeIsbn(value))
}

export type BarcodeVerdict =
  | { kind: 'isbn'; isbn13: string }
  | { kind: 'issn'; message: string }
  | { kind: 'not-a-book'; message: string }
  | { kind: 'invalid'; message: string }

/** Turn whatever the camera saw into something we can act on. */
export function classifyBarcode(raw: string): BarcodeVerdict {
  const value = normalizeIsbn(raw)

  if (isIssnBarcode(value)) {
    return {
      kind: 'issn',
      message: "That's a magazine or journal barcode (ISSN), not a book.",
    }
  }

  if (value.length === 13) {
    if (!isValidIsbn13(value)) {
      return { kind: 'invalid', message: 'Barcode misread — try again.' }
    }
    if (!isBooklandEan(value)) {
      return {
        kind: 'not-a-book',
        message: "That barcode isn't a book — it's a regular retail product.",
      }
    }
    return { kind: 'isbn', isbn13: value }
  }

  if (value.length === 10) {
    const converted = isbn10To13(value)
    if (!converted) {
      return { kind: 'invalid', message: 'Barcode misread — try again.' }
    }
    return { kind: 'isbn', isbn13: converted }
  }

  return { kind: 'invalid', message: 'Barcode misread — try again.' }
}

/**
 * Pull an ISBN out of free text (OCR of a copyright page, a pasted string,
 * whatever she types into the search box).
 */
export function extractIsbn(text: string): string | null {
  const candidates = text.match(/97[89][\d\- ]{10,16}|\b\d{9}[\dXx]\b/g)
  if (!candidates) return null
  for (const candidate of candidates) {
    const verdict = classifyBarcode(candidate)
    if (verdict.kind === 'isbn') return verdict.isbn13
  }
  return null
}

/** Pretty-print for display: 978-0-14-311709-7 style grouping. */
export function formatIsbn(isbn13: string): string {
  const v = normalizeIsbn(isbn13)
  if (v.length !== 13) return v
  return `${v.slice(0, 3)}-${v.slice(3, 4)}-${v.slice(4, 8)}-${v.slice(8, 12)}-${v.slice(12)}`
}
