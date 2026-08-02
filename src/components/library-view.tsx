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
      <div className="pt-safe shrink-0 border-b bg-background/80 px-4 pt-3 backdrop-blur">
        <div className="flex items-baseline justify-between pb-3">
          <div>
            <h1 className="font-display text-[30px] leading-none tracking-[-0.01em]">My Library</h1>
            <p className="mt-1.5 text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
              {books.length} {books.length === 1 ? 'title' : 'titles'}
              {totalCopies !== books.length && ` · ${totalCopies} copies`}
            </p>
          </div>
          <div className="flex gap-0.5">
            {/* Sort lives up here rather than beside the chips: at 375px the
                two together left the chip row 220px for 272px of chips, and
                "Unread" fell off the edge. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={`Sort: ${SORTS.find((s) => s.value === sort)?.label}`}>
                  <ArrowUpDownIcon className="size-4" />
                </Button>
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

        {/* Search + filter entry point */}
        <div className="flex items-center gap-2 pb-3">
          <div className="relative flex flex-1 items-center">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex w-11 items-center justify-center text-muted-foreground">
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
          <Button
            variant={activeFilters > 0 ? 'default' : 'outline'}
            size="icon"
            onClick={() => setFilterOpen(true)}
            aria-label={
              activeFilters > 0 ? `Filters, ${activeFilters} applied` : 'Filter your library'
            }
            className="relative shrink-0"
          >
            <SlidersHorizontalIcon className="size-4" />
            {activeFilters > 0 && (
              <span className="absolute -top-1 -right-1 flex size-4.5 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-white tabular-nums">
                {activeFilters}
              </span>
            )}
          </Button>
        </div>

        {/* Status chips get the whole row now. */}
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-3">
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

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
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
          // Two columns, not three: the cover is the content here, and at
          // three-up on a phone it's a thumbnail rather than a jacket.
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
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
        <div className="h-4" />
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
        <h2 className="font-display text-[26px] leading-tight">Your shelf is empty</h2>
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
        'shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors',
        active
          ? 'border-transparent bg-linear-to-b from-primary-light to-primary text-primary-foreground'
          : 'border-border bg-background/60 text-muted-foreground hover:bg-accent',
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
 * The card is one object: a sunken panel holding the jacket, with the caption
 * bedded into the same white surface underneath. Previously the cover and the
 * text were separate things floating on the page, which is what made the
 * spacing between them read as an accident.
 *
 * Cornered at 4px rather than the 6px card radius — the tile is mostly
 * artwork, and a book jacket has square corners. Any softer and it starts to
 * read as an app icon rather than a book.
 */
function GridCard({ book, onOpen }: { book: Book; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${book.title || 'Untitled'} by ${authorLine(book)}`}
      className="group flex flex-col overflow-hidden rounded-[var(--radius-media)] bg-surface text-left ring-1 ring-black/[0.06] transition-all active:scale-[0.985] dark:ring-white/[0.07]"
    >
      <div className="relative aspect-4/5 w-full overflow-hidden">
        <BookCover book={book} fit="contain" className="size-full p-3.5" size="L" />

        {book.format !== 'physical' && (
          <span className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-surface/85 text-foreground/70 shadow-sm backdrop-blur">
            <FormatMark book={book} className="size-3.5" />
          </span>
        )}
        {book.copies > 1 && (
          <span className="absolute bottom-2 left-2 rounded-full bg-foreground/80 px-2 py-0.5 text-[10px] font-semibold text-background tabular-nums">
            ×{book.copies}
          </span>
        )}
      </div>

      {/*
        Hairline rather than a gap — the caption belongs to the cover.
        No min-height on the title: reserving two lines put ~19px of dead air
        between a one-line title and its author, which is exactly the gap that
        made the old layout feel unresolved. Grid rows stretch to equal height
        anyway, so the slack lands harmlessly at the bottom of the card instead.
      */}
      <div className="flex-1 border-t border-black/[0.05] px-3 py-2.5 dark:border-white/[0.06]">
        <p className="line-clamp-2 font-display text-[15px] leading-[1.18] tracking-[-0.005em] text-foreground">
          {book.title || 'Untitled'}
        </p>
        <p className="mt-1 line-clamp-1 text-[11.5px] leading-tight font-medium tracking-[0.005em] text-muted-foreground">
          {authorLine(book)}
        </p>
      </div>
    </button>
  )
}

function ListRow({ book, onOpen }: { book: Book; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${book.title || 'Untitled'} by ${authorLine(book)}`}
      className="flex w-full items-center gap-3.5 rounded-[var(--radius-card)] bg-surface p-2.5 text-left ring-1 ring-black/[0.06] transition-transform active:scale-[0.99] dark:ring-white/[0.07]"
    >
      <BookCover
        book={book}
        size="M"
        fit="contain"
        className="h-[68px] w-[52px] shrink-0 rounded-[var(--radius-media)] p-1.5"
      />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-1 font-display text-[16px] leading-tight text-foreground">
          {book.title || 'Untitled'}
        </p>
        <p className="mt-0.5 line-clamp-1 text-[12.5px] font-medium text-muted-foreground">
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
