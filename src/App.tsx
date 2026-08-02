import { useCallback, useEffect, useState } from 'react'
import { LibraryBigIcon, SettingsIcon, TrendingUpIcon } from 'lucide-react'
import { Toaster } from '@/components/ui/sonner'
import { TrendingView } from '@/components/trending-view'
import { LibraryView } from '@/components/library-view'
import { SettingsView } from '@/components/settings-view'
import { SearchAddSheet } from '@/components/search-add'
import { BookSheet } from '@/components/book-sheet'
import { db } from '@/lib/db'
import { reenrichAll, scheduleEnrichment } from '@/lib/enrich'
import type { Book } from '@/lib/types'
import { cn } from '@/lib/utils'

type Tab = 'library' | 'trending' | 'settings'
type Theme = 'light' | 'dark'

/**
 * Library is first and default — it's the reason the app exists, and adding a
 * book has its own entry point (the + in the header), so scanning doesn't need
 * to be a destination. The scanner itself is parked, not deleted:
 * `components/scan-view.tsx` still builds and can be re-mounted as a tab.
 */
const TABS = [
  { id: 'library' as const, label: 'My Library', icon: LibraryBigIcon },
  { id: 'trending' as const, label: 'Trending', icon: TrendingUpIcon },
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

  useEffect(() => {
    // The v2 migration derived genres from whatever six subjects v1 happened
    // to persist, which is not enough to classify reliably. Re-run the
    // enrichment pass once so those come from each work's full subject list.
    const REGENRE_KEY = 'shelf-regenre-v2'
    if (!localStorage.getItem(REGENRE_KEY)) {
      localStorage.setItem(REGENRE_KEY, String(Date.now()))
      void reenrichAll()
      return
    }
    // Otherwise just pick up anything left unfetched from a previous session.
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
        {tab === 'library' && (
          <LibraryView
            onOpenBook={(book) => void refreshActiveBook(book.id)}
            onOpenSearch={() => openSearch()}
          />
        )}
        {tab === 'trending' && (
          <TrendingView onOpenBook={(book) => void refreshActiveBook(book.id)} />
        )}
        {tab === 'settings' && <SettingsView theme={theme} onToggleTheme={toggleTheme} />}
      </main>

      <nav className="pb-safe grid shrink-0 grid-cols-3 border-t border-border bg-background/90 backdrop-blur">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                'flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors',
                active ? 'text-primary' : 'text-muted-foreground',
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
