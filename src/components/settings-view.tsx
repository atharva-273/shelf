import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  DownloadIcon,
  FileSpreadsheetIcon,
  Loader2Icon,
  MoonIcon,
  ShareIcon,
  ShieldCheckIcon,
  SunIcon,
  UploadIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { db } from '@/lib/db'
import { exportBackup, exportCsv, downloadBlob, importBackup } from '@/lib/book'
import { onEnrichProgress } from '@/lib/enrich'
import { buildPortfolio, sharePortfolio } from '@/lib/portfolio'
import {
  formatBytes,
  getStorageStatus,
  requestPersistentStorage,
  type StorageStatus,
} from '@/lib/storage'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

export function SettingsView({
  theme,
  onToggleTheme,
}: {
  theme: 'light' | 'dark'
  onToggleTheme: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [enriching, setEnriching] = useState(0)
  const [storage, setStorage] = useState<StorageStatus>({ persisted: false, supported: false })
  const [libraryName, setLibraryName] = useState(
    () => localStorage.getItem('shelf-library-name') ?? 'My Library',
  )
  const [portfolioProgress, setPortfolioProgress] = useState<{ done: number; total: number } | null>(
    null,
  )
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => onEnrichProgress(setEnriching), [])
  useEffect(() => {
    void getStorageStatus().then(setStorage)
  }, [])

  async function handlePersist() {
    setBusy('persist')
    const granted = await requestPersistentStorage()
    setStorage(await getStorageStatus())
    setBusy(null)
    if (granted) {
      toast.success('Protected', { description: "Your browser won't clear this library." })
    } else {
      toast('Not granted yet', {
        description: 'Add Shelf to your home screen, then try again.',
      })
    }
  }

  const books = useLiveQuery(() => db.books.toArray(), [], [])
  const totalPages = books.reduce((sum, book) => sum + (book.pageCount ?? 0) * book.copies, 0)
  const withCovers = books.filter((b) => b.coverLocalKey).length

  const today = new Date().toISOString().slice(0, 10)

  async function handleExportJson() {
    setBusy('json')
    try {
      downloadBlob(await exportBackup(), `shelf-backup-${today}.json`)
      toast.success('Backup downloaded')
    } catch (error) {
      console.error(error)
      toast.error("Couldn't create the backup")
    } finally {
      setBusy(null)
    }
  }

  async function handlePortfolio() {
    setBusy('portfolio')
    setPortfolioProgress({ done: 0, total: books.length })
    try {
      const name = libraryName.trim() || 'My Library'
      localStorage.setItem('shelf-library-name', name)
      const blob = await buildPortfolio({
        title: name,
        onProgress: (done, total) => setPortfolioProgress({ done, total }),
      })
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const result = await sharePortfolio(blob, `${slug || 'library'}.html`)
      toast.success(result === 'shared' ? 'Portfolio shared' : 'Portfolio downloaded', {
        description: `${books.length} books · ${formatBytes(blob.size)}`,
      })
    } catch (error) {
      console.error(error)
      toast.error("Couldn't build the portfolio")
    } finally {
      setBusy(null)
      setPortfolioProgress(null)
    }
  }

  async function handleExportCsv() {
    setBusy('csv')
    try {
      downloadBlob(await exportCsv(), `shelf-${today}.csv`)
      toast.success('Spreadsheet downloaded')
    } catch (error) {
      console.error(error)
      toast.error("Couldn't create the spreadsheet")
    } finally {
      setBusy(null)
    }
  }

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy('import')
    try {
      const { added, skipped } = await importBackup(file)
      toast.success(`Restored ${added} ${added === 1 ? 'book' : 'books'}`, {
        description: skipped ? `${skipped} already in your library` : undefined,
      })
    } catch (error) {
      toast.error((error as Error).message || "Couldn't read that file")
    } finally {
      setBusy(null)
      event.target.value = ''
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="pt-safe shrink-0 px-6 pt-3">
        <h1 className="pb-5 text-[28px] leading-none font-medium tracking-[-1px]">Settings</h1>
      </div>

      <div className="space-y-7 px-6 pb-8">
        {/* Stats — one card, three columns, hairline dividers. Three separate
            tiles read as three unrelated facts; this reads as a summary. */}
        <div className="grid grid-cols-3 divide-x divide-black/[0.06] rounded-[var(--radius-card)] bg-surface py-4 ring-1 ring-black/[0.06] dark:divide-white/[0.07] dark:ring-white/[0.07]">
          <Stat label="Titles" value={books.length} />
          <Stat label="Copies" value={books.reduce((s, b) => s + b.copies, 0)} />
          <Stat label="Pages" value={totalPages.toLocaleString()} />
        </div>

        {enriching > 0 && (
          <div className="flex items-center gap-2.5 rounded-2xl bg-secondary px-3.5 py-3">
            <Loader2Icon className="size-4 shrink-0 animate-spin text-primary" />
            <p className="text-xs text-secondary-foreground">
              Fetching summaries for {enriching} {enriching === 1 ? 'book' : 'books'} in the
              background. You can keep scanning.
            </p>
          </div>
        )}

        <Separator />

        {/* Portfolio — the thing she actually shows people */}
        <section className="space-y-3">
          <div>
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">Share your library</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              A single web page of your shelf — covers, search, tap a book for details. Send it to
              a friend or your book club; it works offline and needs nothing installed.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="library-name" className="text-xs text-muted-foreground">
              Name it
            </Label>
            <Input
              id="library-name"
              value={libraryName}
              onChange={(event) => setLibraryName(event.target.value)}
              onBlur={() =>
                localStorage.setItem('shelf-library-name', libraryName.trim() || 'My Library')
              }
              placeholder="My Library"
              maxLength={60}
            />
          </div>

          <Button
            onClick={handlePortfolio}
            disabled={busy !== null || books.length === 0}
            size="lg"
            className="w-full justify-start gap-2.5"
          >
            {busy === 'portfolio' ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <ShareIcon className="size-4" />
            )}
            {busy === 'portfolio' ? 'Building…' : 'Create shareable portfolio'}
            {portfolioProgress && portfolioProgress.total > 0 && (
              <span className="ml-auto text-xs tabular-nums opacity-70">
                {portfolioProgress.done}/{portfolioProgress.total}
              </span>
            )}
          </Button>

          <p className="px-1 text-xs text-muted-foreground">
            Your private notes and shelf locations are left out — only what you'd want people to
            see.
          </p>
        </section>

        <Separator />

        {/* Storage durability — what actually keeps the library safe */}
        <section className="space-y-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">Keeping your library safe</h2>

          <div
            className={cn(
              'flex items-start gap-2.5 rounded-2xl border px-3.5 py-3',
              storage.persisted
                ? 'border-primary/25 bg-primary/6'
                : 'border-ochre/40 bg-ochre-muted',
            )}
          >
            <ShieldCheckIcon
              className={cn(
                'mt-0.5 size-4 shrink-0',
                storage.persisted ? 'text-primary' : 'text-ochre-foreground',
              )}
            />
            <div className="space-y-0.5">
              <p
                className={cn(
                  'text-sm font-medium',
                  storage.persisted ? 'text-foreground' : 'text-ochre-foreground',
                )}
              >
                {storage.persisted
                  ? 'Protected on this device'
                  : 'Not yet protected on this device'}
              </p>
              <p
                className={cn(
                  'text-xs',
                  storage.persisted ? 'text-muted-foreground' : 'text-ochre-foreground/80',
                )}
              >
                {storage.persisted
                  ? "Your browser won't clear this library to free up space. It still can't survive a lost or reset phone — keep a backup file too."
                  : 'Your browser is allowed to delete this library if the phone runs low on space. Tap below to ask it not to.'}
                {storage.usageBytes !== undefined && ` Using ${formatBytes(storage.usageBytes)}.`}
              </p>
            </div>
          </div>

          {!storage.persisted && storage.supported && (
            <Button
              onClick={handlePersist}
              disabled={busy !== null}
              size="lg"
              className="w-full justify-start gap-2.5"
            >
              {busy === 'persist' ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <ShieldCheckIcon className="size-4" />
              )}
              Protect this library from being cleared
            </Button>
          )}

          <div className="space-y-2">
            <Button
              variant={storage.persisted ? 'default' : 'outline'}
              onClick={handleExportJson}
              disabled={busy !== null || books.length === 0}
              size="lg"
              className="w-full justify-start gap-2.5"
            >
              {busy === 'json' ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <DownloadIcon className="size-4" />
              )}
              Download backup file
              <span className="ml-auto text-xs opacity-70">
                {books.length} books{withCovers > 0 && ` · ${withCovers} photos`}
              </span>
            </Button>
            <p className="px-1 text-xs text-muted-foreground">
              A single <code className="font-mono text-[11px]">.json</code> file holding every
              book and cover photo. Save it to Drive or email it to yourself — restoring from it
              rebuilds the library exactly.
            </p>

            <Button
              variant="outline"
              onClick={handleExportCsv}
              disabled={busy !== null || books.length === 0}
              size="lg"
              className="w-full justify-start gap-2.5"
            >
              {busy === 'csv' ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <FileSpreadsheetIcon className="size-4" />
              )}
              Export as spreadsheet
            </Button>
            <p className="px-1 text-xs text-muted-foreground">
              A <code className="font-mono text-[11px]">.csv</code> for Excel or Google Sheets —
              readable, but for browsing rather than restoring.
            </p>

            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              onChange={handleImport}
              className="hidden"
            />
            <Button
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={busy !== null}
              size="lg"
              className="w-full justify-start gap-2.5"
            >
              {busy === 'import' ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <UploadIcon className="size-4" />
              )}
              Restore from a backup
            </Button>
          </div>
        </section>

        <Separator />

        <section className="space-y-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">Appearance</h2>
          <Button
            variant="outline"
            onClick={onToggleTheme}
            size="lg"
            className="w-full justify-start gap-2.5"
          >
            {theme === 'dark' ? <MoonIcon className="size-4" /> : <SunIcon className="size-4" />}
            {theme === 'dark' ? 'Dark' : 'Light'}
            <span className="ml-auto text-xs text-muted-foreground">Tap to switch</span>
          </Button>
        </section>

        <Separator />

        <section className="space-y-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">About</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Book data comes from Google Books and Open Library, both free. Nothing is sent anywhere
            else — your library never leaves this device.
          </p>
        </section>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="px-2 text-center">
      <p className="text-[26px] leading-none font-medium tracking-[-1px] tabular-nums">{value}</p>
      <p className="mt-1.5 text-[10.5px] font-medium tracking-[0.07em] text-muted-foreground uppercase">
        {label}
      </p>
    </div>
  )
}
