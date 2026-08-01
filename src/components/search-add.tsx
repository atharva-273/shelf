import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2Icon, MicIcon, PlusIcon, SearchIcon, SquarePenIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useSpeech } from '@/hooks/use-speech'
import { searchBooks } from '@/lib/lookup'
import { addBook, bookExists, incrementCopies } from '@/lib/db'
import { bookFromLookup, makeId } from '@/lib/book'
import { scheduleEnrichment } from '@/lib/enrich'
import { formatIsbn } from '@/lib/isbn'
import type { Book, LookupResult } from '@/lib/types'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

/**
 * The fallback path: type it or say it, then pick from a list.
 *
 * Voice fills the box; it never selects a result. Showing author + year +
 * cover in the dropdown is also what solves the "two books with the same
 * title" problem — she picks the right one by looking at it.
 */
export function SearchAddSheet({
  open,
  onOpenChange,
  prefillIsbn,
  onAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  prefillIsbn?: string
  onAdded?: (book: Book) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LookupResult[]>([])
  const [searching, setSearching] = useState(false)
  const [manual, setManual] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const { supported: voiceSupported, listening, error: voiceError, toggle } = useSpeech({
    onTranscript: (text) => setQuery(text),
  })

  // Reset whenever the sheet opens.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setResults([])
    setManual(false)
    const timer = setTimeout(() => inputRef.current?.focus(), 120)
    return () => clearTimeout(timer)
  }, [open])

  // Debounced live search.
  useEffect(() => {
    if (!open) return
    const trimmed = query.trim()
    if (trimmed.length < 3) {
      setResults([])
      setSearching(false)
      abortRef.current?.abort()
      return
    }

    setSearching(true)
    const timer = setTimeout(async () => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const found = await searchBooks(trimmed, controller.signal)
        setResults(found)
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.warn('Search failed', error)
          setResults([])
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false)
      }
    }, 350)

    return () => clearTimeout(timer)
  }, [query, open])

  useEffect(() => () => abortRef.current?.abort(), [])

  const commit = useCallback(
    async (book: Book) => {
      if (book.isbn13) {
        const existing = await bookExists(book.isbn13)
        if (existing) {
          await incrementCopies(existing.id)
          toast('Already in your library', {
            description: `${existing.title} — now ${existing.copies + 1} copies`,
          })
          onOpenChange(false)
          return
        }
      }
      await addBook(book)
      scheduleEnrichment()
      toast.success('Added', { description: book.title })
      onAdded?.(book)
      onOpenChange(false)
    },
    [onAdded, onOpenChange],
  )

  const pick = useCallback(
    (result: LookupResult) => {
      // If she got here from a failed barcode scan, keep that ISBN — it's the
      // one physically on her copy, which may be a different edition.
      const isbn13 = prefillIsbn ?? result.isbn13
      void commit(bookFromLookup(result, { id: isbn13 ?? makeId(), isbn13 }))
    },
    [commit, prefillIsbn],
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/*
        Fixed height here (not max-h): the results list must not resize as
        results stream in, or the row under her thumb moves mid-tap. The `!`
        is needed to beat shadcn's `data-[side=bottom]:h-auto`.
      */}
      <SheetContent
        side="bottom"
        className="flex h-[92dvh]! flex-col gap-0 rounded-t-2xl p-0"
      >
        <SheetHeader className="shrink-0 border-b px-4 pt-4 pb-3">
          <SheetTitle className="text-base">
            {manual ? 'Add by hand' : 'Add a book to your library'}
          </SheetTitle>
          {prefillIsbn && (
            <p className="text-xs text-muted-foreground">
              Scanned {formatIsbn(prefillIsbn)} — nothing found for it
            </p>
          )}
        </SheetHeader>

        {manual ? (
          <ManualForm
            prefillIsbn={prefillIsbn}
            initialTitle={query}
            onCancel={() => setManual(false)}
            onSubmit={commit}
          />
        ) : (
          <>
            <div className="shrink-0 px-4 py-3">
              <div className="relative flex items-center">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex w-11 items-center justify-center text-muted-foreground">
                  <SearchIcon className="size-4" />
                </span>
                <Input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Title, or a few words of it"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className={cn('h-12 pl-11 text-base', voiceSupported && 'pr-13')}
                />
                {voiceSupported && (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant={listening ? 'default' : 'ghost'}
                    onClick={toggle}
                    aria-label={listening ? 'Stop listening' : 'Speak the title'}
                    className={cn('absolute right-1.5', listening && 'animate-pulse')}
                  >
                    <MicIcon className="size-4" />
                  </Button>
                )}
              </div>

              <p className="mt-2 px-0.5 text-xs text-muted-foreground">
                {listening
                  ? 'Listening — say a few words of the title'
                  : voiceError
                    ? voiceError
                    : voiceSupported
                      ? 'Type it, or tap the mic. A few words is enough.'
                      : 'A few words of the title is enough.'}
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {searching && results.length === 0 && (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2Icon className="size-4 animate-spin" />
                  Searching…
                </div>
              )}

              {!searching && query.trim().length >= 3 && results.length === 0 && (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <p className="text-sm text-muted-foreground">No matches for “{query.trim()}”</p>
                  <Button variant="outline" size="sm" onClick={() => setManual(true)}>
                    <SquarePenIcon className="size-4" />
                    Add it by hand
                  </Button>
                </div>
              )}

              {results.map((result, index) => (
                <ResultRow key={`${result.isbn13 ?? result.title}-${index}`} result={result} onPick={pick} />
              ))}
            </div>

            <div className="pb-safe shrink-0 border-t px-4 py-3">
              <Button variant="ghost" className="w-full gap-2" onClick={() => setManual(true)}>
                <SquarePenIcon className="size-4" />
                Can't find it? Add by hand
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function ResultRow({
  result,
  onPick,
}: {
  result: LookupResult
  onPick: (result: LookupResult) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(result)}
      className="flex w-full items-start gap-3 rounded-xl p-2 text-left transition-colors hover:bg-accent active:bg-accent"
    >
      {result.coverRemote ? (
        <img
          src={result.coverRemote}
          alt=""
          loading="lazy"
          className="h-20 w-14 shrink-0 rounded-md bg-secondary object-cover"
        />
      ) : (
        <div className="h-20 w-14 shrink-0 rounded-md bg-secondary" />
      )}

      <div className="min-w-0 flex-1 py-0.5">
        <p className="line-clamp-2 text-sm leading-snug font-medium">{result.title}</p>
        <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
          {result.authors.length ? result.authors.join(', ') : 'Unknown author'}
        </p>
        <p className="mt-1 line-clamp-1 text-xs text-muted-foreground/80">
          {[result.publishedYear, result.publisher, result.pageCount && `${result.pageCount}pp`]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>

      <PlusIcon className="mt-6 size-4 shrink-0 text-primary" />
    </button>
  )
}

function ManualForm({
  prefillIsbn,
  initialTitle,
  onCancel,
  onSubmit,
}: {
  prefillIsbn?: string
  initialTitle: string
  onCancel: () => void
  onSubmit: (book: Book) => Promise<void>
}) {
  const [title, setTitle] = useState(initialTitle)
  const [author, setAuthor] = useState('')
  const [summary, setSummary] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    const now = Date.now()
    await onSubmit({
      id: prefillIsbn ?? makeId(),
      isbn13: prefillIsbn,
      title: title.trim(),
      authors: author.trim() ? author.split(',').map((a) => a.trim()).filter(Boolean) : [],
      summary: summary.trim() || undefined,
      source: 'manual',
      status: 'manual',
      copies: 1,
      readStatus: 'unread',
      addedAt: now,
      updatedAt: now,
    })
    setSaving(false)
  }

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div className="space-y-1.5">
          <Label htmlFor="manual-title">Title</Label>
          <Input
            id="manual-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="The book's title"
            className="h-11 text-base"
            autoFocus
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="manual-author">Author</Label>
          <Input
            id="manual-author"
            value={author}
            onChange={(event) => setAuthor(event.target.value)}
            placeholder="Separate multiple authors with commas"
            className="h-11 text-base"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="manual-summary">
            Note <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id="manual-summary"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="A line or two about it"
            rows={3}
            className="resize-none text-base"
          />
        </div>

        {prefillIsbn && (
          <p className="text-xs text-muted-foreground">
            Saving with ISBN {formatIsbn(prefillIsbn)}
          </p>
        )}
      </div>

      <div className="pb-safe flex shrink-0 gap-2 border-t px-4 py-3">
        <Button type="button" variant="ghost" onClick={onCancel} className="flex-1">
          Back to search
        </Button>
        <Button type="submit" disabled={!title.trim() || saving} className="flex-1">
          {saving ? <Loader2Icon className="size-4 animate-spin" /> : 'Add book'}
        </Button>
      </div>
    </form>
  )
}
