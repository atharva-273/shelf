import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  DownloadIcon,
  FileSpreadsheetIcon,
  Loader2Icon,
  MoonIcon,
  ShieldCheckIcon,
  SunIcon,
  UploadIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { db } from '@/lib/db'
import { exportBackup, exportCsv, downloadBlob, importBackup } from '@/lib/book'
import { onEnrichProgress } from '@/lib/enrich'
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
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => onEnrichProgress(setEnriching), [])

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
      <div className="pt-safe shrink-0 px-4 pt-3">
        <h1 className="pb-4 text-2xl font-semibold tracking-tight">Settings</h1>
      </div>

      <div className="space-y-6 px-4 pb-8">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Titles" value={books.length} />
          <Stat label="Copies" value={books.reduce((s, b) => s + b.copies, 0)} />
          <Stat label="Pages" value={totalPages.toLocaleString()} />
        </div>

        {enriching > 0 && (
          <div className="flex items-center gap-2.5 rounded-xl bg-secondary px-3 py-2.5">
            <Loader2Icon className="size-4 shrink-0 animate-spin text-primary" />
            <p className="text-xs text-secondary-foreground">
              Fetching summaries for {enriching} {enriching === 1 ? 'book' : 'books'} in the
              background. You can keep scanning.
            </p>
          </div>
        )}

        <Separator />

        {/* Backup — deliberately the most prominent thing on this screen */}
        <section className="space-y-3">
          <div className="flex items-start gap-2.5 rounded-xl border border-ochre/40 bg-ochre-muted px-3 py-3">
            <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-ochre-foreground" />
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-ochre-foreground">Back up your library</p>
              <p className="text-xs text-ochre-foreground/80">
                Everything is stored on this device only. Clearing your browser data would wipe it —
                download a backup after a big scanning session.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Button
              onClick={handleExportJson}
              disabled={busy !== null || books.length === 0}
              className="w-full justify-start gap-2"
            >
              {busy === 'json' ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <DownloadIcon className="size-4" />
              )}
              Download backup
              <span className="ml-auto text-xs opacity-70">
                {books.length} books{withCovers > 0 && ` · ${withCovers} photos`}
              </span>
            </Button>

            <Button
              variant="outline"
              onClick={handleExportCsv}
              disabled={busy !== null || books.length === 0}
              className="w-full justify-start gap-2"
            >
              {busy === 'csv' ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <FileSpreadsheetIcon className="size-4" />
              )}
              Export as spreadsheet (CSV)
            </Button>

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
              className="w-full justify-start gap-2"
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
          <h2 className="text-sm font-medium">Appearance</h2>
          <Button variant="outline" onClick={onToggleTheme} className="w-full justify-start gap-2">
            {theme === 'dark' ? <MoonIcon className="size-4" /> : <SunIcon className="size-4" />}
            {theme === 'dark' ? 'Dark' : 'Light'}
            <span className="ml-auto text-xs text-muted-foreground">Tap to switch</span>
          </Button>
        </section>

        <Separator />

        <section className="space-y-2">
          <h2 className="text-sm font-medium">About</h2>
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
    <div className="rounded-xl bg-secondary px-3 py-3 text-center">
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  )
}
