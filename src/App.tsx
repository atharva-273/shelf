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
    // Re-derive genres once per vocabulary change. Bumping this key is how an
    // existing library picks up new genres and classification fixes — without
    // it, books keep whatever they were tagged with when they were added.
    const REGENRE_KEY = 'shelf-regenre-v3'
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

      {/*
        Per the Figma: a hairline rule, 24px icons over 14px labels, and the
        three tabs pulled in from the edges so they read as a cluster rather
        than a stretched toolbar. Inactive tabs dim rather than change colour.
      */}
      <nav className="pb-safe grid shrink-0 grid-cols-3 border-t border-border bg-background px-8 pt-4 pb-1">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                'flex flex-col items-center gap-1 pb-1 text-[13px] font-medium tracking-[-0.3px] transition-opacity',
                active ? 'text-primary' : 'text-foreground/60',
              )}
            >
              <Icon className="size-6" strokeWidth={active ? 2.2 : 1.75} />
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
