import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CameraOffIcon,
  CheckIcon,
  CopyIcon,
  FlashlightIcon,
  Loader2Icon,
  SearchIcon,
  XIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BookCover } from '@/components/book-cover'
import { useScanner } from '@/hooks/use-scanner'
import { classifyBarcode } from '@/lib/isbn'
import { lookupByIsbn } from '@/lib/lookup'
import { addBook, bookExists, incrementCopies } from '@/lib/db'
import { bookFromLookup, unresolvedBook } from '@/lib/book'
import { scheduleEnrichment } from '@/lib/enrich'
import { feedbackDuplicate, feedbackHit, feedbackMiss, primeAudio } from '@/lib/feedback'
import type { Book } from '@/lib/types'
import { cn } from '@/lib/utils'

type Outcome = 'looking' | 'added' | 'duplicate' | 'missing' | 'rejected'

interface ScanEntry {
  key: string
  isbn13?: string
  outcome: Outcome
  book?: Book
  message?: string
}

/**
 * Continuous scanning. She never taps the screen between books — pull, flip,
 * beep, reshelve. Lookups run in the background so a slow network never blocks
 * the next scan.
 */
export function ScanView({
  onOpenSearch,
  onOpenBook,
}: {
  onOpenSearch: (prefillIsbn?: string) => void
  onOpenBook: (book: Book) => void
}) {
  const [entries, setEntries] = useState<ScanEntry[]>([])
  const [sessionCount, setSessionCount] = useState(0)
  const [active, setActive] = useState(true)
  const inFlight = useRef<Set<string>>(new Set())

  const update = useCallback((key: string, patch: Partial<ScanEntry>) => {
    setEntries((current) =>
      current.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)),
    )
  }, [])

  const handleDetect = useCallback(
    (raw: string) => {
      const verdict = classifyBarcode(raw)
      const key = `${raw}-${Date.now()}`

      if (verdict.kind !== 'isbn') {
        feedbackMiss()
        setEntries((current) =>
          [{ key, outcome: 'rejected' as const, message: verdict.message }, ...current].slice(0, 30),
        )
        return
      }

      const { isbn13 } = verdict
      if (inFlight.current.has(isbn13)) return
      inFlight.current.add(isbn13)

      feedbackHit()
      setEntries((current) =>
        [{ key, isbn13, outcome: 'looking' as const }, ...current].slice(0, 30),
      )

      void (async () => {
        try {
          const existing = await bookExists(isbn13)
          if (existing) {
            await incrementCopies(existing.id)
            feedbackDuplicate()
            update(key, { outcome: 'duplicate', book: existing })
            return
          }

          const result = await lookupByIsbn(isbn13)
          if (!result) {
            const placeholder = unresolvedBook(isbn13)
            await addBook(placeholder)
            feedbackMiss()
            update(key, { outcome: 'missing', book: placeholder })
            setSessionCount((n) => n + 1)
            return
          }

          const book = bookFromLookup(result, { id: isbn13, isbn13 })
          await addBook(book)
          update(key, { outcome: 'added', book })
          setSessionCount((n) => n + 1)
          // Summaries get filled in afterwards so they don't slow the sweep.
          scheduleEnrichment()
        } catch (error) {
          console.error('Lookup failed', error)
          update(key, { outcome: 'rejected', message: 'Lookup failed — check your connection.' })
        } finally {
          // Let her deliberately re-scan the same book to add a second copy.
          setTimeout(() => inFlight.current.delete(isbn13), 3000)
        }
      })()
    },
    [update],
  )

  const { videoRef, state, error, torchOn, torchAvailable, toggleTorch, restart } = useScanner({
    onDetect: handleDetect,
    enabled: active,
  })

  useEffect(() => {
    primeAudio()
  }, [])

  const latest = entries[0]

  return (
    <div className="flex h-full flex-col bg-[oklch(0.135_0.021_293)] text-white">
      {/* Header */}
      <div className="pt-safe shrink-0 px-4 pt-3">
        <div className="flex items-center justify-between pb-3">
          <div>
            <p className="text-xs font-medium tracking-wide text-white/50 uppercase">Scanning</p>
            <p className="text-2xl font-semibold tabular-nums">
              {sessionCount}
              <span className="ml-1.5 text-sm font-normal text-white/50">
                {sessionCount === 1 ? 'book' : 'books'} this session
              </span>
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setActive((v) => !v)}
            className="rounded-full text-white hover:bg-white/10 hover:text-white"
            aria-label={active ? 'Pause camera' : 'Resume camera'}
          >
            {active ? <XIcon className="size-5" /> : <CameraOffIcon className="size-5" />}
          </Button>
        </div>
      </div>

      {/* Camera */}
      <div className="relative mx-4 flex-1 overflow-hidden rounded-2xl bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="size-full object-cover"
        />

        {/* Reticle */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative h-32 w-64 rounded-xl">
            {(['left-0 top-0 border-l-2 border-t-2 rounded-tl-xl',
               'right-0 top-0 border-r-2 border-t-2 rounded-tr-xl',
               'left-0 bottom-0 border-l-2 border-b-2 rounded-bl-xl',
               'right-0 bottom-0 border-r-2 border-b-2 rounded-br-xl'] as const).map((pos) => (
              <span
                key={pos}
                className={cn('absolute size-7 border-ochre/90', pos)}
              />
            ))}
          </div>
        </div>

        {state === 'starting' && (
          <Overlay>
            <Loader2Icon className="size-5 animate-spin" />
            <span>Starting camera…</span>
          </Overlay>
        )}

        {(state === 'denied' || state === 'error') && (
          <Overlay>
            <CameraOffIcon className="size-6 text-ochre" />
            <span className="max-w-64 text-center text-sm">{error}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => void restart()}>
                Try again
              </Button>
              <Button size="sm" variant="secondary" onClick={() => onOpenSearch()}>
                Search instead
              </Button>
            </div>
          </Overlay>
        )}

        {!active && state === 'idle' && (
          <Overlay>
            <span>Camera paused</span>
            <Button size="sm" variant="secondary" onClick={() => setActive(true)}>
              Resume
            </Button>
          </Overlay>
        )}

        {/* Transient result banner */}
        {latest && <ResultBanner entry={latest} onOpenSearch={onOpenSearch} />}

        {torchAvailable && (
          <Button
            variant="secondary"
            size="icon"
            onClick={() => void toggleTorch()}
            aria-label="Toggle torch"
            className={cn(
              'absolute bottom-3 left-3 rounded-full border-0 backdrop-blur',
              torchOn
                ? 'bg-ochre text-ochre-foreground hover:bg-ochre/90'
                : 'bg-black/50 text-white hover:bg-black/70',
            )}
          >
            <FlashlightIcon className="size-4" />
          </Button>
        )}
      </div>

      {/* Recent adds */}
      <div className="shrink-0 px-4 pt-3">
        {entries.length === 0 ? (
          <p className="py-2 text-center text-xs text-white/40">
            Point at the barcode on the back of a book
          </p>
        ) : (
          <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
            {entries.slice(0, 14).map((entry) => (
              <RecentChip key={entry.key} entry={entry} onOpenBook={onOpenBook} />
            ))}
          </div>
        )}
      </div>

      {/* Fallback */}
      <div className="pb-safe shrink-0 px-4 pt-2 pb-3">
        <Button
          variant="ghost"
          onClick={() => onOpenSearch()}
          className="w-full justify-center gap-2 rounded-xl bg-white/8 text-sm text-white hover:bg-white/15 hover:text-white"
        >
          <SearchIcon className="size-4" />
          No barcode? Search by title
        </Button>
      </div>
    </div>
  )
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 text-sm text-white backdrop-blur-sm">
      {children}
    </div>
  )
}

function ResultBanner({
  entry,
  onOpenSearch,
}: {
  entry: ScanEntry
  onOpenSearch: (prefillIsbn?: string) => void
}) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    setVisible(true)
    if (entry.outcome === 'looking' || entry.outcome === 'missing') return
    const timer = setTimeout(() => setVisible(false), 2400)
    return () => clearTimeout(timer)
  }, [entry.key, entry.outcome])

  if (!visible) return null

  const tone =
    entry.outcome === 'added'
      ? 'bg-primary text-primary-foreground'
      : entry.outcome === 'duplicate'
        ? 'bg-ochre text-ochre-foreground'
        : entry.outcome === 'looking'
          ? 'bg-black/70 text-white backdrop-blur'
          : 'bg-white text-foreground'

  return (
    <div
      className={cn(
        'absolute inset-x-3 bottom-3 flex items-center gap-3 rounded-xl px-3 py-2.5 shadow-lg',
        tone,
      )}
    >
      {entry.outcome === 'looking' && <Loader2Icon className="size-4 shrink-0 animate-spin" />}
      {entry.outcome === 'added' && <CheckIcon className="size-4 shrink-0" />}
      {entry.outcome === 'duplicate' && <CopyIcon className="size-4 shrink-0" />}

      <div className="min-w-0 flex-1">
        {entry.outcome === 'looking' && <p className="text-sm">Looking it up…</p>}
        {entry.outcome === 'added' && (
          <p className="truncate text-sm font-medium">{entry.book?.title}</p>
        )}
        {entry.outcome === 'duplicate' && (
          <p className="truncate text-sm font-medium">
            Already have it — now {entry.book?.copies ?? 2} copies
          </p>
        )}
        {entry.outcome === 'missing' && (
          <p className="text-sm font-medium">Not found — added to Needs attention</p>
        )}
        {entry.outcome === 'rejected' && <p className="text-sm font-medium">{entry.message}</p>}
      </div>

      {entry.outcome === 'missing' && (
        <Button
          size="sm"
          className="h-7 shrink-0 px-2 text-xs"
          onClick={() => onOpenSearch(entry.isbn13)}
        >
          Search
        </Button>
      )}
    </div>
  )
}

function RecentChip({
  entry,
  onOpenBook,
}: {
  entry: ScanEntry
  onOpenBook: (book: Book) => void
}) {
  if (entry.outcome === 'looking') {
    return <div className="h-16 w-11 shrink-0 animate-pulse rounded-md bg-white/15" />
  }
  if (!entry.book) {
    return (
      <div className="flex h-16 w-11 shrink-0 items-center justify-center rounded-md bg-white/10">
        <XIcon className="size-4 text-white/40" />
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={() => onOpenBook(entry.book!)}
      className={cn(
        'relative h-16 w-11 shrink-0 overflow-hidden rounded-md ring-offset-1 ring-offset-[oklch(0.135_0.021_293)]',
        entry.outcome === 'missing' && 'ring-2 ring-ochre',
      )}
    >
      <BookCover book={entry.book} size="S" className="size-full" />
    </button>
  )
}
