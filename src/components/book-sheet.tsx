import { useEffect, useRef, useState } from 'react'
import { CameraIcon, Loader2Icon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { BookCover } from '@/components/book-cover'
import { deleteBook, saveCover, updateBook } from '@/lib/db'
import { compressImage, makeId } from '@/lib/book'
import { formatIsbn } from '@/lib/isbn'
import { FORMAT_LABELS, type Book, type BookFormat, type ReadStatus } from '@/lib/types'
import { toast } from 'sonner'

const READ_STATES: { value: ReadStatus; label: string }[] = [
  { value: 'unread', label: 'Unread' },
  { value: 'reading', label: 'Reading' },
  { value: 'read', label: 'Read' },
]

const FORMATS: BookFormat[] = ['physical', 'ebook', 'audiobook']

export function BookSheet({
  book,
  onOpenChange,
  onDeleted,
}: {
  book: Book | null
  onOpenChange: (open: boolean) => void
  onDeleted?: () => void
}) {
  const [draft, setDraft] = useState<Book | null>(book)
  const [savingCover, setSavingCover] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => setDraft(book), [book])

  if (!draft) return null

  /**
   * Title, author and summary are the catalogue's answer, not hers — editing
   * them on a book she looked up would just let a typo overwrite Open
   * Library. On a book typed in by hand there is no catalogue answer, so those
   * three become fields; `status: 'unresolved'` is included because a book
   * that resolved to nothing has the same problem as one never looked up.
   */
  const editableIdentity = draft.source === 'manual' || draft.status === 'unresolved'

  const set = <K extends keyof Book>(key: K, value: Book[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current))

  /** Persist on blur rather than on every keystroke — fewer IndexedDB writes. */
  const persist = async (patch: Partial<Book>) => {
    await updateBook(draft.id, patch)
  }

  async function handleCoverFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file || !draft) return
    setSavingCover(true)
    try {
      const compressed = await compressImage(file)
      const key = draft.coverLocalKey ?? makeId()
      await saveCover(key, compressed)
      await updateBook(draft.id, { coverLocalKey: key })
      set('coverLocalKey', key)
      toast.success('Cover saved')
    } catch (error) {
      console.error(error)
      toast.error("Couldn't save that photo")
    } finally {
      setSavingCover(false)
      event.target.value = ''
    }
  }

  return (
    <Sheet open={Boolean(book)} onOpenChange={onOpenChange}>
      {/*
        max-h rather than h: shadcn's bottom sheet ships `data-[side=bottom]:h-auto`,
        which out-specifies a plain `h-*` utility — the sheet then grows past the
        viewport and its header scrolls off the top. Capping the height instead
        sidesteps the conflict and lets short books use a shorter sheet.
      */}
      <SheetContent
        side="bottom"
        className="flex max-h-[92dvh] flex-col gap-0 rounded-t-2xl p-0"
      >
        <SheetHeader className="shrink-0 border-b px-5 pt-4 pb-3">
          <SheetTitle className="truncate pr-8 text-base font-semibold tracking-[-0.02em]">
            {draft.title || 'Untitled book'}
          </SheetTitle>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/*
            Product-page hero: the jacket presented whole and centred on a
            sunken panel, the way a shop shows the object before it tells you
            about it. Everything factual follows underneath.
          */}
          <div className="relative flex justify-center bg-surface-sunken px-6 pt-9 pb-7">
            <BookCover
              book={draft}
              size="L"
              fit="contain"
              className="h-52 w-full max-w-[168px] bg-transparent"
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleCoverFile}
              className="hidden"
            />
            <Button
              size="icon-sm"
              variant="secondary"
              onClick={() => fileRef.current?.click()}
              disabled={savingCover}
              aria-label="Photograph the cover"
              className="absolute right-4 bottom-4 shadow-sm"
            >
              {savingCover ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <CameraIcon className="size-3.5" />
              )}
            </Button>
          </div>

          {/*
            Catalogue facts read; only what she owns about the book is a form.
            Title, author and summary come from Open Library and are presented
            rather than edited — except on a book she typed in herself, where
            there is no catalogue to defer to and she is the only source.
          */}
          <div className="space-y-6 px-5 pt-5 pb-4">
            <div>
              {editableIdentity ? (
                <div className="space-y-4">
                  <Field label="Title">
                    <Input
                      value={draft.title}
                      onChange={(event) => set('title', event.target.value)}
                      onBlur={() => void persist({ title: draft.title })}
                      placeholder="Title"
                      className="text-base"
                    />
                  </Field>
                  <Field label="Author">
                    <Input
                      value={draft.authors.join(', ')}
                      onChange={(event) =>
                        set(
                          'authors',
                          event.target.value.split(',').map((a) => a.trim()).filter(Boolean),
                        )
                      }
                      onBlur={() => void persist({ authors: draft.authors })}
                      placeholder="Author"
                      className="text-base"
                    />
                  </Field>
                </div>
              ) : (
                <>
                  <h2 className="text-[26px] leading-[1.18] font-semibold tracking-[-0.03em]">
                    {draft.title || 'Untitled book'}
                  </h2>
                  <p className="mt-1.5 text-sm font-medium text-muted-foreground">
                    {draft.authors.length ? draft.authors.join(', ') : 'Unknown author'}
                  </p>
                </>
              )}

              {(draft.publishedYear || draft.pageCount || draft.publisher) && (
                <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium tracking-[0.04em] text-muted-foreground/80 uppercase">
                  {[
                    draft.publishedYear,
                    draft.pageCount ? `${draft.pageCount} pages` : null,
                    draft.publisher,
                  ]
                    .filter(Boolean)
                    .map((fact, index) => (
                      <span key={fact as string} className="flex items-center gap-2">
                        {index > 0 && <span className="text-muted-foreground/40">·</span>}
                        {fact}
                      </span>
                    ))}
                </div>
              )}

              {draft.genres && draft.genres.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {draft.genres.map((genre) => (
                    <Badge key={genre} variant="secondary" className="rounded-full font-medium">
                      {genre}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* About sits above the controls: what the book *is* before what
                she has done with it. */}
            {editableIdentity ? (
              <div>
                <SectionLabel>About</SectionLabel>
                <Textarea
                  value={draft.summary ?? ''}
                  onChange={(event) => set('summary', event.target.value)}
                  onBlur={() => void persist({ summary: draft.summary })}
                  placeholder="A line or two about it"
                  rows={3}
                  className="resize-none text-base"
                />
              </div>
            ) : (
              draft.summary && (
                <div>
                  <SectionLabel>About</SectionLabel>
                  <p className="text-[13.5px] leading-[1.65] text-foreground/80">{draft.summary}</p>
                </div>
              )
            )}

            <div>
              <SectionLabel>Reading</SectionLabel>
              <div className="flex gap-1.5">
                {READ_STATES.map((state) => (
                  <Button
                    key={state.value}
                    size="sm"
                    variant={draft.readStatus === state.value ? 'default' : 'outline'}
                    className="h-9 flex-1 text-xs"
                    onClick={() => {
                      set('readStatus', state.value)
                      void persist({ readStatus: state.value })
                    }}
                  >
                    {state.label}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <SectionLabel>Format</SectionLabel>
              <div className="flex gap-1.5">
                {FORMATS.map((format) => (
                  <Button
                    key={format}
                    size="sm"
                    variant={(draft.format ?? 'physical') === format ? 'default' : 'outline'}
                    className="h-9 flex-1 text-xs"
                    onClick={() => {
                      set('format', format)
                      void persist({ format })
                    }}
                  >
                    {FORMAT_LABELS[format]}
                  </Button>
                ))}
              </div>
            </div>

            {draft.isbn13 && (
              <p className="font-mono text-[11px] tracking-wide text-muted-foreground/70">
                ISBN {formatIsbn(draft.isbn13)}
              </p>
            )}

            {/* A rule, not a boxed panel — below it is the part of the record
                that is hers rather than the catalogue's. */}
            <div className="space-y-4 border-t pt-6">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Shelf">
                  <Input
                    value={draft.location ?? ''}
                    onChange={(event) => set('location', event.target.value)}
                    onBlur={() => void persist({ location: draft.location })}
                    placeholder="Living room"
                    className="text-base"
                  />
                </Field>
                <Field label="Copies">
                  <Input
                    type="number"
                    min={1}
                    value={draft.copies}
                    onChange={(event) => set('copies', Math.max(1, Number(event.target.value) || 1))}
                    onBlur={() => void persist({ copies: draft.copies })}
                    className="text-base"
                  />
                </Field>
              </div>

              <Field label="Notes">
                <Textarea
                  value={draft.notes ?? ''}
                  onChange={(event) => set('notes', event.target.value)}
                  onBlur={() => void persist({ notes: draft.notes })}
                  placeholder="Lent to someone, signed copy, anything"
                  rows={2}
                  className="resize-none text-base"
                />
              </Field>
            </div>
          </div>
        </div>

        <div className="pb-safe flex shrink-0 items-center justify-between gap-2 border-t px-4 py-3">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                <Trash2Icon className="size-4" />
                Remove
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove this book?</AlertDialogTitle>
                <AlertDialogDescription>
                  {draft.title || 'This book'} will be deleted from your library. This can't be
                  undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={async () => {
                    await deleteBook(draft.id)
                    toast('Removed', { description: draft.title })
                    onOpenChange(false)
                    onDeleted?.()
                  }}
                >
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** Small caps label — the quiet tier that separates sections without a rule. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2.5 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground/80 uppercase">
      {children}
    </p>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}
