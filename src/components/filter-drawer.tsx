import { useEffect, useState } from 'react'
import { CheckIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import { FORMAT_LABELS, type BookFormat } from '@/lib/types'
import type { Genre } from '@/lib/genres'
import { cn } from '@/lib/utils'

export interface Filters {
  genres: Genre[]
  formats: BookFormat[]
}

export const EMPTY_FILTERS: Filters = { genres: [], formats: [] }

export function countFilters(filters: Filters): number {
  return filters.genres.length + filters.formats.length
}

const FORMATS: BookFormat[] = ['physical', 'ebook', 'audiobook']

/**
 * Multi-select filters in a side drawer.
 *
 * Edits are staged locally and only committed on Apply, so half-made
 * selections don't re-render a 400-book grid underneath her thumb on every tap.
 */
export function FilterDrawer({
  open,
  onOpenChange,
  available,
  value,
  onApply,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Only the genres actually present in her library — no empty options. */
  available: Genre[]
  value: Filters
  onApply: (filters: Filters) => void
}) {
  const [draft, setDraft] = useState<Filters>(value)

  // Re-sync whenever it opens, so cancelling discards the staged edits.
  useEffect(() => {
    if (open) setDraft(value)
  }, [open, value])

  const toggleGenre = (genre: Genre) =>
    setDraft((current) => ({
      ...current,
      genres: current.genres.includes(genre)
        ? current.genres.filter((g) => g !== genre)
        : [...current.genres, genre],
    }))

  const toggleFormat = (format: BookFormat) =>
    setDraft((current) => ({
      ...current,
      formats: current.formats.includes(format)
        ? current.formats.filter((f) => f !== format)
        : [...current.formats, format],
    }))

  const staged = countFilters(draft)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-[86vw] max-w-sm flex-col gap-0 p-0">
        <SheetHeader className="shrink-0 border-b px-4 pt-4 pb-3">
          <SheetTitle className="text-base">Filter</SheetTitle>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4">
          <section className="space-y-2.5">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Format
            </h3>
            <div className="space-y-1.5">
              {FORMATS.map((format) => (
                <OptionRow
                  key={format}
                  label={FORMAT_LABELS[format]}
                  selected={draft.formats.includes(format)}
                  onClick={() => toggleFormat(format)}
                />
              ))}
            </div>
          </section>

          <Separator />

          <section className="space-y-2.5">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Genre
            </h3>
            {available.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No genres yet — they're picked up automatically as you add books.
              </p>
            ) : (
              <div className="space-y-1.5">
                {available.map((genre) => (
                  <OptionRow
                    key={genre}
                    label={genre}
                    selected={draft.genres.includes(genre)}
                    onClick={() => toggleGenre(genre)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="pb-safe flex shrink-0 gap-2 border-t px-4 py-3">
          <Button
            variant="ghost"
            size="lg"
            className="flex-1"
            disabled={staged === 0}
            onClick={() => setDraft(EMPTY_FILTERS)}
          >
            Clear
          </Button>
          <Button
            size="lg"
            className="flex-1"
            onClick={() => {
              onApply(draft)
              onOpenChange(false)
            }}
          >
            {staged > 0 ? `Apply (${staged})` : 'Apply'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function OptionRow({
  label,
  selected,
  onClick,
}: {
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors',
        selected
          ? 'border-primary/30 bg-primary/8 font-medium'
          : 'border-transparent bg-secondary/60 hover:bg-secondary',
      )}
    >
      {/*
        Squared corners on purpose: these are multi-select, and a circular
        indicator reads as a radio button — i.e. "pick one".
      */}
      <span
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-[5px] border-2 transition-colors',
          selected
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-muted-foreground/35',
        )}
      >
        {selected && <CheckIcon className="size-3.5" strokeWidth={3} />}
      </span>
      {label}
    </button>
  )
}
