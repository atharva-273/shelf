import { useCallback, useEffect, useState } from 'react'
import { LibraryBigIcon, ScanLineIcon, SettingsIcon } from 'lucide-react'
import { Toaster } from '@/components/ui/sonner'
import { ScanView } from '@/components/scan-view'
import { LibraryView } from '@/components/library-view'
import { SettingsView } from '@/components/settings-view'
import { SearchAddSheet } from '@/components/search-add'
import { BookSheet } from '@/components/book-sheet'
import { db } from '@/lib/db'
import { scheduleEnrichment } from '@/lib/enrich'
import type { Book } from '@/lib/types'
import { cn } from '@/lib/utils'

type Tab = 'scan' | 'library' | 'settings'
type Theme = 'light' | 'dark'

const TABS = [
  { id: 'scan' as const, label: 'Scan', icon: ScanLineIcon },
  { id: 'library' as const, label: 'Library', icon: LibraryBigIcon },
  { id: 'settings' as const, label: 'Settings', icon: SettingsIcon },
]

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('shelf-theme')
    if (stored === 'light' || stored === 'dark') return stored
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem('shelf-theme', theme)
  }, [theme])

  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))] as const
}

export default function App() {
  const [tab, setTab] = useState<Tab>('library')
  const [theme, toggleTheme] = useTheme()

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchPrefill, setSearchPrefill] = useState<string | undefined>()
  const [activeBook, setActiveBook] = useState<Book | null>(null)

  const openSearch = useCallback((prefillIsbn?: string) => {
    setSearchPrefill(prefillIsbn)
    setSearchOpen(true)
  }, [])

  // Pick up any summaries left unfetched from a previous session.
  useEffect(() => {
    scheduleEnrichment(4000)
  }, [])

  // Keep the open sheet in sync if the record changes underneath it.
  const refreshActiveBook = useCallback(async (id: string) => {
    const fresh = await db.books.get(id)
    setActiveBook(fresh ?? null)
  }, [])

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <main className="min-h-0 flex-1">
        {tab === 'scan' && (
          <ScanView
            onOpenSearch={openSearch}
            onOpenBook={(book) => void refreshActiveBook(book.id)}
          />
        )}
        {tab === 'library' && (
          <LibraryView
            onOpenBook={(book) => void refreshActiveBook(book.id)}
            onOpenSearch={() => openSearch()}
            onGoScan={() => setTab('scan')}
          />
        )}
        {tab === 'settings' && <SettingsView theme={theme} onToggleTheme={toggleTheme} />}
      </main>

      <nav
        className={cn(
          'pb-safe grid shrink-0 grid-cols-3 border-t',
          tab === 'scan'
            ? 'border-white/10 bg-[oklch(0.135_0.021_293)]'
            : 'border-border bg-background',
        )}
      >
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id
          const onDark = tab === 'scan'
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                'flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors',
                active
                  ? onDark
                    ? 'text-ochre'
                    : 'text-primary'
                  : onDark
                    ? 'text-white/45'
                    : 'text-muted-foreground',
              )}
            >
              <Icon className="size-5" strokeWidth={active ? 2.4 : 1.9} />
              {label}
            </button>
          )
        })}
      </nav>

      <SearchAddSheet
        open={searchOpen}
        onOpenChange={setSearchOpen}
        prefillIsbn={searchPrefill}
        onAdded={() => setTab('library')}
      />

      <BookSheet
        book={activeBook}
        onOpenChange={(open) => !open && setActiveBook(null)}
        onDeleted={() => setActiveBook(null)}
      />

      <Toaster position="top-center" richColors />
    </div>
  )
}
