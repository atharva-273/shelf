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
import { compressImage, makeId, needsAttention } from '@/lib/book'
import { formatIsbn } from '@/lib/isbn'
import type { Book, ReadStatus } from '@/lib/types'
import { toast } from 'sonner'

const READ_STATES: { value: ReadStatus; label: string }[] = [
  { value: 'unread', label: 'Unread' },
  { value: 'reading', label: 'Reading' },
  { value: 'read', label: 'Read' },
]

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

  const attention = needsAttention(draft)

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
        <SheetHeader className="shrink-0 border-b px-4 pt-4 pb-3">
          <SheetTitle className="truncate text-base">
            {draft.title || 'Untitled book'}
          </SheetTitle>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {attention && (
            <div className="rounded-xl border border-ochre/40 bg-ochre-muted px-3 py-2.5">
              <p className="text-sm font-medium text-ochre-foreground">Needs your input</p>
              <p className="mt-0.5 text-xs text-ochre-foreground/80">
                {draft.isbn13
                  ? `Nothing came back for ${formatIsbn(draft.isbn13)}. Fill in what you can.`
                  : 'Add a title and author so you can find this later.'}
              </p>
            </div>
          )}

          {/* Cover + quick facts */}
          <div className="flex gap-4">
            <div className="relative shrink-0">
              <BookCover book={draft} size="L" className="h-40 w-28 rounded-lg shadow-sm" />
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleCoverFile}
                className="hidden"
              />
              <Button
                size="icon"
                variant="secondary"
                onClick={() => fileRef.current?.click()}
                disabled={savingCover}
                aria-label="Photograph the cover"
                className="absolute -right-2 -bottom-2 size-8 rounded-full shadow-md"
              >
                {savingCover ? (
                  <Loader2Icon className="size-3.5 animate-spin" />
                ) : (
                  <CameraIcon className="size-3.5" />
                )}
              </Button>
            </div>

            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {draft.pageCount ? <Badge variant="secondary">{draft.pageCount} pages</Badge> : null}
                {draft.publishedYear ? (
                  <Badge variant="secondary">{draft.publishedYear}</Badge>
                ) : null}
                {draft.copies > 1 ? (
                  <Badge className="bg-ochre text-ochre-foreground hover:bg-ochre">
                    {draft.copies} copies
                  </Badge>
                ) : null}
              </div>
              {draft.publisher && (
                <p className="text-xs text-muted-foreground">{draft.publisher}</p>
              )}
              {draft.isbn13 && (
                <p className="font-mono text-xs text-muted-foreground/80">
                  {formatIsbn(draft.isbn13)}
                </p>
              )}

              <div className="flex gap-1 pt-1">
                {READ_STATES.map((state) => (
                  <Button
                    key={state.value}
                    size="sm"
                    variant={draft.readStatus === state.value ? 'default' : 'outline'}
                    className="h-7 flex-1 px-1 text-xs"
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
          </div>

          <Field label="Title">
            <Input
              value={draft.title}
              onChange={(event) => set('title', event.target.value)}
              onBlur={() => void persist({ title: draft.title })}
              placeholder="Title"
              className="h-11 text-base"
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
              className="h-11 text-base"
            />
          </Field>

          <Field label="Summary">
            <Textarea
              value={draft.summary ?? ''}
              onChange={(event) => set('summary', event.target.value)}
              onBlur={() => void persist({ summary: draft.summary })}
              placeholder="A line or two about it"
              rows={3}
              className="resize-none text-base"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Shelf / location">
              <Input
                value={draft.location ?? ''}
                onChange={(event) => set('location', event.target.value)}
                onBlur={() => void persist({ location: draft.location })}
                placeholder="e.g. Living room"
                className="h-11 text-base"
              />
            </Field>
            <Field label="Copies">
              <Input
                type="number"
                min={1}
                value={draft.copies}
                onChange={(event) => set('copies', Math.max(1, Number(event.target.value) || 1))}
                onBlur={() => void persist({ copies: draft.copies })}
                className="h-11 text-base"
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}
