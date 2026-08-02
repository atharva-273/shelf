import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowUpDownIcon,
  BookPlusIcon,
  HeadphonesIcon,
  LayoutGridIcon,
  ListIcon,
  PlusIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  TabletSmartphoneIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { BookCover } from '@/components/book-cover'
import { FilterDrawer, EMPTY_FILTERS, countFilters, type Filters } from '@/components/filter-drawer'
import { db } from '@/lib/db'
import { authorLine } from '@/lib/book'
import { genresInUse } from '@/lib/genres'
import type { Book, ReadStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

type Layout = 'grid' | 'list'
type StatusChip = 'all' | ReadStatus
type SortKey = 'recent' | 'title' | 'author' | 'pages'

const STATUS_CHIPS: { value: StatusChip; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'read', label: 'Read' },
  { value: 'reading', label: 'Reading' },
  { value: 'unread', label: 'Unread' },
]

/**
 * The design draws header actions as plain 18px marks, not buttons. `p-2` on a
 * `gap-1` row gives a 34px tap target while keeping the *visual* gap at the
 * specified 20px (4 + 8 + 8).
 */
const ICON_BUTTON =
  'flex items-center justify-center rounded-full p-2 text-foreground transition-colors active:bg-accent'

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'recent', label: 'Recently added' },
  { value: 'title', label: 'Title A–Z' },
  { value: 'author', label: 'Author A–Z' },
  { value: 'pages', label: 'Longest first' },
]

export function LibraryView({
  onOpenBook,
  onOpenSearch,
}: {
  onOpenBook: (book: Book) => void
  onOpenSearch: () => void
}) {
  const [query, setQuery] = useState('')
  const [layout, setLayout] = useState<Layout>('grid')
  const [status, setStatus] = useState<StatusChip>('all')
  const [sort, setSort] = useState<SortKey>('recent')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [filterOpen, setFilterOpen] = useState(false)

  const books = useLiveQuery(() => db.books.orderBy('addedAt').reverse().toArray(), [], [])

  const availableGenres = useMemo(() => genresInUse(books), [books])
  const activeFilters = countFilters(filters)

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase()

    const filtered = books.filter((book) => {
      if (status !== 'all' && (book.readStatus ?? 'unread') !== status) return false
      if (filters.formats.length && !filters.formats.includes(book.format ?? 'physical')) {
        return false
      }
      // Genres are OR'd within the facet: picking Fiction + History means
      // "either", which is what a multi-select reads as.
      if (filters.genres.length) {
        const genres = book.genres ?? []
        if (!filters.genres.some((g) => genres.includes(g))) return false
      }
      if (!term) return true
      return (
        book.title.toLowerCase().includes(term) ||
        book.authors.some((a) => a.toLowerCase().includes(term)) ||
        book.isbn13?.includes(term) ||
        book.location?.toLowerCase().includes(term)
      )
    })

    const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
    const sorted = [...filtered]
    switch (sort) {
      case 'title':
        // Ignore a leading article so "The Alchemist" files under A.
        sorted.sort((a, b) => collator.compare(fileAs(a.title), fileAs(b.title)))
        break
      case 'author':
        sorted.sort((a, b) => collator.compare(a.authors[0] ?? '￿', b.authors[0] ?? '￿'))
        break
      case 'pages':
        sorted.sort((a, b) => (b.pageCount ?? 0) - (a.pageCount ?? 0))
        break
      default:
        sorted.sort((a, b) => b.addedAt - a.addedAt)
    }
    return sorted
  }, [books, query, status, sort, filters])

  const totalCopies = useMemo(() => books.reduce((sum, b) => sum + b.copies, 0), [books])

  if (books.length === 0) {
    return (
      <EmptyLibrary onAdd={onOpenSearch} />
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/*
        Header geometry is taken from the Figma frame: 24px side margins, a
        28px/Medium title over a 14px uppercase count, then the search row.
        Flat white with a single hairline rule — no translucency, no blur.
      */}
      <div className="pt-safe shrink-0 border-b border-border bg-background px-6 pt-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[28px] leading-none font-medium tracking-[-1px]">My Library</h1>
            <p className="mt-2.5 text-[14px] leading-none tracking-[0.14px] text-muted-foreground uppercase">
              {books.length} {books.length === 1 ? 'title' : 'titles'}
              {totalCopies !== books.length && ` · ${totalCopies} copies`}
            </p>
          </div>

          {/*
            Bare 18px icons, 20px apart, per the design. The padding is
            cancelled by the gap and the negative margin, so the tap target is
            34px while the icons still read as unbuttoned marks on the page.
          */}
          <div className="-mr-2 flex shrink-0 items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={ICON_BUTTON}
                  aria-label={`Sort: ${SORTS.find((s) => s.value === sort)?.label}`}
                >
                  <ArrowUpDownIcon className="size-[18px]" strokeWidth={1.75} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {SORTS.map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    onClick={() => setSort(option.value)}
                    className={cn(sort === option.value && 'font-semibold text-primary')}
                  >
                    {option.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <button
              type="button"
              onClick={() => setLayout((l) => (l === 'grid' ? 'list' : 'grid'))}
              aria-label={layout === 'grid' ? 'Switch to list' : 'Switch to grid'}
              className={ICON_BUTTON}
            >
              {layout === 'grid' ? (
                <ListIcon className="size-[18px]" strokeWidth={1.75} />
              ) : (
                <LayoutGridIcon className="size-[18px]" strokeWidth={1.75} />
              )}
            </button>

            <button
              type="button"
              onClick={onOpenSearch}
              aria-label="Add a book"
              className={ICON_BUTTON}
            >
              <PlusIcon className="size-[18px]" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {/* 48px search pill and a matching 48px filter circle. */}
        <div className="mt-4 flex items-center gap-3">
          <div className="relative flex flex-1 items-center">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex w-12 items-center justify-center text-muted-foreground">
              <SearchIcon className="size-[18px]" strokeWidth={1.75} />
            </span>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search your shelf"
              className="h-12 rounded-full border-input bg-background pl-12 text-[14px] font-medium placeholder:font-medium placeholder:text-muted-foreground"
              autoComplete="off"
            />
          </div>
          <button
            type="button"
            onClick={() => setFilterOpen(true)}
            aria-label={
              activeFilters > 0 ? `Filters, ${activeFilters} applied` : 'Filter your library'
            }
            className={cn(
              'relative flex size-12 shrink-0 items-center justify-center rounded-full border transition-colors',
              activeFilters > 0
                ? 'border-transparent bg-primary text-primary-foreground'
                : 'border-input bg-background text-foreground active:bg-accent',
            )}
          >
            <SlidersHorizontalIcon className="size-[18px]" strokeWidth={1.75} />
            {activeFilters > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex size-4.5 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-white tabular-nums">
                {activeFilters}
              </span>
            )}
          </button>
        </div>

        {/* Status chips stay, below the search bar. */}
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pt-4 pb-4">
          {STATUS_CHIPS.map((chip) => (
            <Chip
              key={chip.value}
              active={status === chip.value}
              onClick={() => setStatus(chip.value)}
            >
              {chip.label}
            </Chip>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-7">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <p className="text-sm text-muted-foreground">
              {query.trim() ? `Nothing matches “${query.trim()}”` : 'Nothing matches those filters'}
            </p>
            {(activeFilters > 0 || status !== 'all') && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setFilters(EMPTY_FILTERS)
                  setStatus('all')
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        ) : layout === 'grid' ? (
          // 164px tiles with a 24px gutter — two-up at 400px, widening on
          // anything larger rather than adding a third cramped column.
          <div className="grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-3 lg:grid-cols-4">
            {visible.map((book) => (
              <GridCard key={book.id} book={book} onOpen={() => onOpenBook(book)} />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map((book) => (
              <ListRow key={book.id} book={book} onOpen={() => onOpenBook(book)} />
            ))}
          </div>
        )}
        <div className="h-7" />
      </div>

      <FilterDrawer
        open={filterOpen}
        onOpenChange={setFilterOpen}
        available={availableGenres}
        value={filters}
        onApply={setFilters}
      />
    </div>
  )
}

/** "The Alchemist" should sort under A, the way it would on a real shelf. */
function fileAs(title: string): string {
  return title.replace(/^(the|a|an)\s+/i, '').trim() || title
}

function EmptyLibrary({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-8 text-center">
      <div className="flex size-20 items-center justify-center rounded-3xl bg-linear-to-b from-primary-light/15 to-primary/15">
        <BookPlusIcon className="size-8 text-primary" strokeWidth={1.6} />
      </div>
      <div className="max-w-xs space-y-2.5">
        <h2 className="text-[26px] leading-tight font-medium tracking-[-1px]">
          Your shelf is empty
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Nothing catalogued yet. Add your first book and start building the library you'll
          actually want to show people.
        </p>
      </div>
      <Button size="lg" onClick={onAdd} className="gap-2">
        <PlusIcon className="size-4" />
        Add a book
      </Button>
    </div>
  )
}

function Chip({
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
      aria-pressed={active}
      className={cn(
        'shrink-0 rounded-full border px-4 py-2 text-[13px] font-medium whitespace-nowrap transition-colors',
        active
          ? 'border-transparent bg-primary text-primary-foreground'
          : 'border-input bg-background text-muted-foreground active:bg-accent',
      )}
    >
      {children}
    </button>
  )
}

/** Only non-physical formats get a marker — paper is the unremarkable default. */
function FormatMark({ book, className }: { book: Book; className?: string }) {
  if (book.format === 'audiobook') return <HeadphonesIcon className={className} />
  if (book.format === 'ebook') return <TabletSmartphoneIcon className={className} />
  return null
}

/**
 * Jacket on the page, caption under it — no card container, no ring, no panel,
 * exactly as drawn. The tile keeps the design's 164×184 proportion and 4px
 * radius, but the jacket is *contained* rather than cropped: the mock's
 * placeholder is a landscape photo, whereas a real cover is roughly 2:3, and
 * filling this box would cut about 40% off it.
 */
function GridCard({ book, onOpen }: { book: Book; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${book.title || 'Untitled'} by ${authorLine(book)}`}
      className="group flex flex-col text-left transition-transform active:scale-[0.985]"
    >
      <div className="relative aspect-[164/184] w-full overflow-hidden rounded-[var(--radius-media)]">
        <BookCover book={book} fit="contain" className="size-full bg-transparent" size="L" />

        {book.format !== 'physical' && (
          <span className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full bg-background/85 text-foreground/70 shadow-sm backdrop-blur">
            <FormatMark book={book} className="size-3.5" />
          </span>
        )}
        {book.copies > 1 && (
          <span className="absolute bottom-1.5 left-1.5 rounded-full bg-foreground/80 px-2 py-0.5 text-[10px] font-semibold text-background tabular-nums">
            ×{book.copies}
          </span>
        )}
      </div>

      {/* 8px to the title, 4px from title to author — measured off the frame. */}
      <p className="mt-2 line-clamp-2 text-[16px] leading-[1.25] font-medium tracking-[-0.5px] text-foreground">
        {book.title || 'Untitled'}
      </p>
      <p className="mt-1 line-clamp-1 text-[14px] leading-[1.25] tracking-[-0.5px] text-muted-foreground">
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
      className="flex w-full items-center gap-3.5 border-b border-border py-3 text-left transition-opacity active:opacity-60"
    >
      <BookCover
        book={book}
        size="M"
        fit="contain"
        className="h-[68px] w-[52px] shrink-0 rounded-[var(--radius-media)] bg-transparent"
      />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-1 text-[16px] leading-[1.25] font-medium tracking-[-0.5px] text-foreground">
          {book.title || 'Untitled'}
        </p>
        <p className="mt-1 line-clamp-1 text-[14px] leading-[1.25] tracking-[-0.5px] text-muted-foreground">
          {authorLine(book)}
        </p>
        {book.genres?.length ? (
          <p className="mt-1 line-clamp-1 text-[11px] tracking-wide text-muted-foreground/70 uppercase">
            {book.genres.join(' · ')}
          </p>
        ) : null}
      </div>
      {book.format !== 'physical' && (
        <FormatMark book={book} className="size-4 shrink-0 text-muted-foreground" />
      )}
    </button>
  )
}
