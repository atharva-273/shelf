import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  AlertCircleIcon,
  LayoutGridIcon,
  ListIcon,
  PlusIcon,
  ScanLineIcon,
  SearchIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { BookCover } from '@/components/book-cover'
import { db } from '@/lib/db'
import { authorLine, needsAttention } from '@/lib/book'
import type { Book } from '@/lib/types'
import { cn } from '@/lib/utils'

type Layout = 'grid' | 'list'
type Filter = 'all' | 'attention'

export function LibraryView({
  onOpenBook,
  onOpenSearch,
  onGoScan,
}: {
  onOpenBook: (book: Book) => void
  onOpenSearch: () => void
  onGoScan: () => void
}) {
  const [query, setQuery] = useState('')
  const [layout, setLayout] = useState<Layout>('grid')
  const [filter, setFilter] = useState<Filter>('all')

  const books = useLiveQuery(() => db.books.orderBy('addedAt').reverse().toArray(), [], [])

  const attentionCount = useMemo(() => books.filter(needsAttention).length, [books])

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase()
    return books
      .filter((book) => (filter === 'attention' ? needsAttention(book) : true))
      .filter((book) => {
        if (!term) return true
        return (
          book.title.toLowerCase().includes(term) ||
          book.authors.some((a) => a.toLowerCase().includes(term)) ||
          book.isbn13?.includes(term) ||
          book.location?.toLowerCase().includes(term)
        )
      })
  }, [books, query, filter])

  const totalCopies = useMemo(
    () => books.reduce((sum, book) => sum + book.copies, 0),
    [books],
  )

  if (books.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-5 px-8 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-secondary">
          <ScanLineIcon className="size-7 text-primary" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold">No books yet</h2>
          <p className="text-sm text-muted-foreground">
            Scan the barcode on the back of a book to start. Pull a stack onto a table and sweep
            through them — it's about ten seconds a book.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={onGoScan}>
            <ScanLineIcon className="size-4" />
            Start scanning
          </Button>
          <Button variant="outline" onClick={onOpenSearch}>
            <PlusIcon className="size-4" />
            Add by title
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="pt-safe shrink-0 border-b bg-background px-4 pt-3">
        <div className="flex items-baseline justify-between pb-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
            <p className="text-xs text-muted-foreground">
              {books.length} {books.length === 1 ? 'title' : 'titles'}
              {totalCopies !== books.length && ` · ${totalCopies} copies`}
            </p>
          </div>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLayout((l) => (l === 'grid' ? 'list' : 'grid'))}
              aria-label={layout === 'grid' ? 'Switch to list' : 'Switch to grid'}
            >
              {layout === 'grid' ? (
                <ListIcon className="size-4" />
              ) : (
                <LayoutGridIcon className="size-4" />
              )}
            </Button>
            <Button variant="ghost" size="icon" onClick={onOpenSearch} aria-label="Add a book">
              <PlusIcon className="size-4" />
            </Button>
          </div>
        </div>

        {/*
          Flex-centred icon rather than absolute + translate: with a pill input
          the optical centre and the geometric centre differ enough that the
          translate approach leaves the glyph sitting a pixel or two low.
        */}
        <div className="relative flex items-center pb-3">
          <span className="pointer-events-none absolute inset-y-0 left-0 flex w-11 items-center justify-center pb-3 text-muted-foreground">
            <SearchIcon className="size-4" />
          </span>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your shelf"
            className="pl-11"
            autoComplete="off"
          />
        </div>

        {attentionCount > 0 && (
          <div className="flex gap-2 pb-3">
            <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
              All
            </FilterChip>
            <FilterChip active={filter === 'attention'} onClick={() => setFilter('attention')}>
              <AlertCircleIcon className="size-3.5" />
              Needs attention
              <Badge
                variant="secondary"
                className="ml-0.5 h-4 px-1.5 text-[10px] tabular-nums"
              >
                {attentionCount}
              </Badge>
            </FilterChip>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {visible.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Nothing matches “{query.trim()}”
          </p>
        ) : layout === 'grid' ? (
          <div className="grid grid-cols-3 items-start gap-x-3 gap-y-4 sm:grid-cols-4 md:grid-cols-6">
            {visible.map((book) => (
              <GridCard key={book.id} book={book} onOpen={() => onOpenBook(book)} />
            ))}
          </div>
        ) : (
          <div className="divide-y">
            {visible.map((book) => (
              <ListRow key={book.id} book={book} onOpen={() => onOpenBook(book)} />
            ))}
          </div>
        )}
        <div className="h-4" />
      </div>
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-muted-foreground hover:bg-accent',
      )}
    >
      {children}
    </button>
  )
}

function GridCard({ book, onOpen }: { book: Book; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${book.title || 'Untitled'} by ${authorLine(book)}`}
      className="group text-left"
    >
      <div className="relative aspect-2/3 overflow-hidden rounded-lg shadow-sm transition-transform group-active:scale-[0.97]">
        <BookCover book={book} className="size-full" />
        {needsAttention(book) && (
          <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-ochre text-ochre-foreground shadow">
            <AlertCircleIcon className="size-3" />
          </span>
        )}
        {book.copies > 1 && (
          <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums">
            ×{book.copies}
          </span>
        )}
      </div>
      {/*
        min-h, not h: an explicit height fights `line-clamp-2` and clips
        descenders on the second line. Reserving the space instead keeps
        one- and two-line cards aligned without ever cutting the text.
      */}
      <p className="mt-2 line-clamp-2 min-h-[2.25rem] text-xs leading-[1.35] font-medium">
        {book.title || 'Untitled'}
      </p>
      <p className="line-clamp-1 text-[11px] leading-tight text-muted-foreground">
        {authorLine(book)}
      </p>
    </button>
  )
}

function ListRow({ book, onOpen }: { book: Book; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${book.title || 'Untitled'} by ${authorLine(book)}`}
      className="flex w-full items-start gap-3 py-3 text-left"
    >
      <BookCover book={book} size="S" className="h-16 w-11 shrink-0 rounded-md" />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-1 text-sm font-medium">{book.title || 'Untitled'}</p>
        <p className="line-clamp-1 text-sm text-muted-foreground">{authorLine(book)}</p>
        {book.summary && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground/80">{book.summary}</p>
        )}
      </div>
      {needsAttention(book) && (
        <AlertCircleIcon className="mt-1 size-4 shrink-0 text-ochre" />
      )}
    </button>
  )
}
