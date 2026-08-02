import type { LookupResult } from './types'
import { normalizeGenres } from './genres'
import { openLibraryCoverById } from './lookup'

/**
 * Open Library's trending endpoint — free, no key, no account.
 *
 * Returns *works* rather than editions, so entries frequently have no ISBN.
 * That's fine for a discovery list; anything added from here is matched on
 * title + author instead.
 */

export type TrendingWindow = 'daily' | 'weekly' | 'monthly'

interface TrendingWork {
  key?: string
  title?: string
  author_name?: string[]
  first_publish_year?: number
  cover_i?: number
  ia_collection?: string[]
  subject?: string[]
  number_of_pages_median?: number
}

const CACHE_TTL_MS = 15 * 60_000
const cache = new Map<TrendingWindow, { at: number; results: LookupResult[] }>()

export async function fetchTrending(
  window: TrendingWindow,
  signal?: AbortSignal,
): Promise<LookupResult[]> {
  const hit = cache.get(window)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.results

  const params = new URLSearchParams({
    limit: '30',
    fields: [
      'key',
      'title',
      'author_name',
      'first_publish_year',
      'cover_i',
      'subject',
      'number_of_pages_median',
    ].join(','),
  })

  const response = await fetch(`https://openlibrary.org/trending/${window}.json?${params}`, {
    signal,
  })
  if (!response.ok) throw new Error(`Trending request failed: ${response.status}`)

  const data = (await response.json()) as { works?: TrendingWork[] }

  const results = (data.works ?? [])
    .filter((work): work is TrendingWork & { title: string } => Boolean(work.title))
    // Trending is deduped by work, but the same title can appear under
    // slightly different records — collapse those.
    .filter((work, index, all) => {
      const key = `${work.title.toLowerCase()}|${work.author_name?.[0]?.toLowerCase() ?? ''}`
      return (
        all.findIndex(
          (other) =>
            `${other.title?.toLowerCase()}|${other.author_name?.[0]?.toLowerCase() ?? ''}` === key,
        ) === index
      )
    })
    .map<LookupResult>((work) => ({
      title: work.title,
      authors: work.author_name ?? [],
      publishedYear: work.first_publish_year ? String(work.first_publish_year) : undefined,
      pageCount: work.number_of_pages_median,
      coverId: work.cover_i,
      coverRemote: work.cover_i ? openLibraryCoverById(work.cover_i, 'M') : undefined,
      subjects: work.subject?.slice(0, 12),
      genres: normalizeGenres(work.subject),
      workKey: work.key,
      source: 'openlibrary',
      status: 'partial',
    }))

  cache.set(window, { at: Date.now(), results })
  return results
}
