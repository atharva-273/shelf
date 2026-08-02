import { useCallback, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CheckIcon, Loader2Icon, PlusIcon, RefreshCwIcon, TrendingUpIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { db, addBook } from '@/lib/db'
import { bookFromLookup, makeId } from '@/lib/book'
import { fetchTrending, type TrendingWindow } from '@/lib/trending'
import { scheduleEnrichment } from '@/lib/enrich'
import type { Book, LookupResult } from '@/lib/types'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const WINDOWS: { value: TrendingWindow; label: string }[] = [
  { value: 'daily', label: 'Today' },
  { value: 'weekly', label: 'This week' },
  { value: 'monthly', label: 'This month' },
]

/**
 * What everyone else is reading, from Open Library's trending endpoint.
 *
 * Read-only and disposable — the point is discovery, not a second library.
 * Anything she taps + on goes straight into her own shelf and stops being a
 * trending row.
 */
export function TrendingView({ onOpenBook }: { onOpenBook: (book: Book) => void }) {
  const [window, setWindow] = useState<TrendingWindow>('weekly')
  const [results, setResults] = useState<LookupResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)

  // Live, so a book added here immediately shows as "in your library".
  const owned = useLiveQuery(async () => {
    const books = await db.books.toArray()
    return new Set(books.map((b) => ownedKey(b.title, b.authors[0])))
  }, [], new Set<string>())

  const load = useCallback(async (which: TrendingWindow) => {
    setLoading(true)
    setError(null)
    try {
      setResults(await fetchTrending(which))
    } catch (err) {
      console.error(err)
      setError("Couldn't load trending books. Check your connection.")
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(window)
  }, [window, load])

  async function handleAdd(result: LookupResult) {
    const key = ownedKey(result.title, result.authors[0])
    setAdding(key)
    try {
      const book = bookFromLookup(result, {
        id: result.isbn13 ?? makeId(),
        isbn13: result.isbn13,
      })
      await addBook(book)
      scheduleEnrichment()
      toast.success('Added to your library', { description: book.title })
    } catch (err) {
      console.error(err)
      toast.error("Couldn't add that one")
    } finally {
      setAdding(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="pt-safe shrink-0 border-b bg-background/80 px-4 pt-3 backdrop-blur">
        <div className="flex items-baseline justify-between pb-3">
          <div>
            <h1 className="font-display text-[30px] leading-none tracking-[-0.01em]">Trending</h1>
            <p className="mt-1.5 text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
              What people are reading now
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void load(window)}
            disabled={loading}
            aria-label="Refresh"
          >
            <RefreshCwIcon className={cn('size-4', loading && 'animate-spin')} />
          </Button>
        </div>

        <div className="flex gap-1.5 pb-3">
          {WINDOWS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setWindow(option.value)}
              aria-pressed={window === option.value}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors',
                window === option.value
                  ? 'border-transparent bg-linear-to-b from-primary-light to-primary text-primary-foreground'
                  : 'border-border bg-background/60 text-muted-foreground hover:bg-accent',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {loading && results.length === 0 && (
          <div className="space-y-3 pt-1">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex gap-3">
                <div className="h-[74px] w-[50px] shrink-0 animate-pulse rounded-md bg-secondary" />
                <div className="flex-1 space-y-2 py-1.5">
                  <div className="h-3.5 w-3/4 animate-pulse rounded bg-secondary" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-secondary" />
                </div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <TrendingUpIcon className="size-6 text-muted-foreground" />
            <p className="max-w-64 text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void load(window)}>
              Try again
            </Button>
          </div>
        )}

        {!error && !loading && results.length === 0 && (
          <p className="py-16 text-center text-sm text-muted-foreground">
            Nothing trending right now.
          </p>
        )}

        <div className="space-y-2">
          {results.map((result, index) => {
            const key = ownedKey(result.title, result.authors[0])
            const isOwned = owned.has(key)
            return (
              <TrendingRow
                key={`${result.workKey ?? result.title}-${index}`}
                rank={index + 1}
                result={result}
                owned={isOwned}
                busy={adding === key}
                onAdd={() => void handleAdd(result)}
                onOpen={() => {
                  if (!isOwned) return
                  void db.books
                    .filter((b) => ownedKey(b.title, b.authors[0]) === key)
                    .first()
                    .then((b) => b && onOpenBook(b))
                }}
              />
            )
          })}
        </div>
        <div className="h-4" />
      </div>
    </div>
  )
}

/**
 * Trending entries are works, not editions, so they often have no ISBN —
 * title + first author is the only stable way to tell whether she owns it.
 */
function ownedKey(title: string, author?: string): string {
  return `${title.toLowerCase().trim()}|${(author ?? '').toLowerCase().trim()}`
}

function TrendingRow({
  rank,
  result,
  owned,
  busy,
  onAdd,
  onOpen,
}: {
  rank: number
  result: LookupResult
  owned: boolean
  busy: boolean
  onAdd: () => void
  onOpen: () => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-card)] bg-surface p-2.5 ring-1 ring-black/[0.06] dark:ring-white/[0.07]">
      <span className="w-4 shrink-0 text-right font-display text-[15px] text-muted-foreground/60 tabular-nums">
        {rank}
      </span>

      <button
        type="button"
        onClick={owned ? onOpen : onAdd}
        className="flex h-[68px] w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-media)] bg-surface-sunken p-1.5"
        aria-label={owned ? `Open ${result.title}` : `Add ${result.title}`}
      >
        {result.coverRemote ? (
          <img
            src={result.coverRemote}
            alt=""
            loading="lazy"
            className="size-full object-contain drop-shadow-[0_2px_6px_rgba(23,19,31,0.18)]"
          />
        ) : (
          <span className="line-clamp-3 text-center text-[9px] leading-tight font-medium text-foreground/55">
            {result.title}
          </span>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 font-display text-[16px] leading-[1.15] text-foreground">
          {result.title}
        </p>
        <p className="mt-0.5 line-clamp-1 text-[12.5px] font-medium text-muted-foreground">
          {result.authors.length ? result.authors.join(', ') : 'Unknown author'}
        </p>
        {(result.publishedYear || result.genres?.[0]) && (
          <p className="mt-1 line-clamp-1 text-[11px] tracking-wide text-muted-foreground/70 uppercase">
            {[result.publishedYear, result.genres?.[0]].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>

      <Button
        variant={owned ? 'ghost' : 'outline'}
        size="icon-sm"
        onClick={owned ? onOpen : onAdd}
        disabled={busy}
        aria-label={owned ? 'Already in your library' : `Add ${result.title} to your library`}
        className="shrink-0"
      >
        {busy ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : owned ? (
          <CheckIcon className="size-4 text-primary" />
        ) : (
          <PlusIcon className="size-4" />
        )}
      </Button>
    </div>
  )
}
