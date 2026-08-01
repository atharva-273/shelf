import { useEffect, useState } from 'react'
import { BookIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getCover } from '@/lib/db'
import { openLibraryCoverById, openLibraryCoverUrl } from '@/lib/lookup'
import type { Book } from '@/lib/types'

/**
 * Cover with a fallback chain: her own photo → the API cover → Open Library
 * by ISBN → a typographic placeholder.
 *
 * The placeholder is always rendered *underneath* the image rather than
 * instead of it. Open Library's cover CDN throttles heavily and often just
 * stalls — neither `onload` nor `onerror` ever fires — so a component that
 * swaps placeholder-for-image would sit on an empty grey box indefinitely.
 * Layering means a slow or dead cover degrades to a readable title card on its
 * own, with no timeout logic to get wrong.
 *
 * `loading="lazy"` matters too: the covers endpoint caps ISBN lookups at 100
 * per 5 minutes, and a 400-book grid would trip that on mount.
 */

type Stage = 'local' | 'remote' | 'openlibrary' | 'placeholder'

export function BookCover({
  book,
  className,
  size = 'M',
}: {
  book: Book
  className?: string
  size?: 'S' | 'M' | 'L'
}) {
  const [localUrl, setLocalUrl] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>(() => firstStage(book, false))
  const [loaded, setLoaded] = useState(false)

  // Her own photo, out of IndexedDB.
  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false

    if (book.coverLocalKey) {
      void getCover(book.coverLocalKey).then((blob) => {
        if (cancelled || !blob) return
        objectUrl = URL.createObjectURL(blob)
        setLocalUrl(objectUrl)
        setStage('local')
        setLoaded(false)
      })
    } else {
      setLocalUrl(null)
    }

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [book.coverLocalKey])

  // Restart the chain if the underlying book changes.
  useEffect(() => {
    setStage(firstStage(book, Boolean(book.coverLocalKey && localUrl)))
    setLoaded(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, book.coverRemote, book.coverId, book.isbn13])

  function advance() {
    setLoaded(false)
    setStage((current) =>
      current === 'local'
        ? book.coverRemote
          ? 'remote'
          : nextAfterRemote(book)
        : current === 'remote'
          ? nextAfterRemote(book)
          : 'placeholder',
    )
  }

  const src =
    stage === 'local'
      ? localUrl
      : stage === 'remote'
        ? (book.coverRemote ?? null)
        : stage === 'openlibrary'
          ? // The by-id endpoint isn't rate-limited; by-ISBN is capped at 100
            // per 5 minutes, so only fall back to it when there's no id.
            book.coverId
            ? openLibraryCoverById(book.coverId, size)
            : book.isbn13
              ? openLibraryCoverUrl(book.isbn13, size)
              : null
          : null

  return (
    <div className={cn('relative overflow-hidden bg-secondary', className)}>
      {/* Always present; the image covers it once it actually arrives. */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-2 text-center">
        <BookIcon className="size-4 shrink-0 text-primary/40" />
        <span className="line-clamp-3 text-[10px] leading-tight font-medium text-secondary-foreground/70">
          {book.title || 'Untitled'}
        </span>
      </div>

      {src && (
        <img
          key={src}
          src={src}
          alt={book.title ? `Cover of ${book.title}` : 'Book cover'}
          loading="lazy"
          decoding="async"
          ref={(node) => {
            // An image already in the HTTP cache finishes loading before React
            // attaches onLoad, so without this every tab switch re-runs the
            // fade and the placeholder flashes through a cover we already have.
            if (node?.complete && node.naturalWidth > 2) setLoaded(true)
          }}
          className={cn(
            'absolute inset-0 size-full bg-secondary object-cover transition-opacity duration-200',
            loaded ? 'opacity-100' : 'opacity-0',
          )}
          onError={advance}
          onLoad={(event) => {
            // Some sources answer a missing cover with a spacer pixel rather
            // than a 404, which would otherwise read as a successful load.
            if (event.currentTarget.naturalWidth <= 2) advance()
            else setLoaded(true)
          }}
        />
      )}
    </div>
  )
}

function firstStage(book: Book, hasLocal: boolean): Stage {
  if (hasLocal) return 'local'
  if (book.coverRemote) return 'remote'
  return nextAfterRemote(book)
}

function nextAfterRemote(book: Book): Stage {
  return book.coverId || book.isbn13 ? 'openlibrary' : 'placeholder'
}
