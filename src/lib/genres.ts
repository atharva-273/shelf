/**
 * Genre normalisation.
 *
 * Open Library returns 50–65 "subjects" per book and most of them can't be
 * shown to a person. A real sample from three ordinary books:
 *
 *   "Fiction"                              ← useful
 *   "FICTION / Literary"                   ← useful, and structured (BISAC)
 *   "nyt:trade_fiction_paperback=2008-01-05"  ← bestseller-list metadata
 *   "Weltgeschichte" / "Hombre" / "Historia"  ← the same subject in 4 languages
 *   "Cb113.h4 h3713 2015"                  ← a Library of Congress call number
 *   "Translations into Indonesian"         ← true, irrelevant
 *
 * A filter built straight on that is 200 books × ~55 subjects of mostly noise.
 * So we throw away what we can't read and map the rest onto a small fixed set
 * that fits in a drawer and means something on a shelf.
 *
 * The BISAC-style entries ("FICTION / Literary", "SCIENCE / Life Sciences /
 * Evolution") are the highest-signal input — they're publisher-assigned and
 * structured — so they're weighted above loose keyword hits.
 */

export const GENRES = [
  'Fiction',
  'Classics',
  'Science Fiction',
  'Fantasy',
  'Mystery & Thriller',
  'Romance',
  'Horror',
  'Poetry',
  'History',
  'Biography & Memoir',
  'Science',
  'Philosophy',
  'Psychology',
  'Business',
  'Self-help',
  'Religion & Spirituality',
  'Travel',
  'Food & Cooking',
  'Art & Design',
  "Children's & YA",
] as const

export type Genre = (typeof GENRES)[number]

/** Keywords are matched against lowercased subjects as whole-ish phrases. */
const RULES: { genre: Genre; keywords: string[] }[] = [
  { genre: 'Science Fiction', keywords: ['science fiction', 'sci-fi', 'dystopia', 'space opera', 'cyberpunk', 'time travel'] },
  { genre: 'Fantasy', keywords: ['fantasy', 'magic', 'dragons', 'wizards', 'mythical', 'sword and sorcery'] },
  { genre: 'Mystery & Thriller', keywords: ['mystery', 'thriller', 'detective', 'crime', 'suspense', 'noir', 'espionage', 'murder'] },
  { genre: 'Romance', keywords: ['romance', 'love stories', 'romantic'] },
  { genre: 'Horror', keywords: ['horror', 'ghost stories', 'supernatural', 'vampires', 'gothic'] },
  { genre: 'Poetry', keywords: ['poetry', 'poems', 'verse', 'sonnets'] },
  { genre: 'Classics', keywords: ['classics', 'classic literature', 'literary classics', 'canon'] },
  { genre: 'History', keywords: ['history', 'historical', 'civilization', 'ancient', 'medieval', 'war', 'biography of a place', 'archaeology'] },
  { genre: 'Biography & Memoir', keywords: ['biography', 'autobiography', 'memoir', 'personal narrative', 'diaries', 'letters'] },
  { genre: 'Science', keywords: ['science', 'physics', 'biology', 'chemistry', 'astronomy', 'evolution', 'mathematics', 'nature', 'medicine', 'technology'] },
  { genre: 'Philosophy', keywords: ['philosophy', 'ethics', 'metaphysics', 'logic', 'existential'] },
  { genre: 'Psychology', keywords: ['psychology', 'psychiatry', 'mental health', 'cognition', 'behaviour', 'behavior'] },
  { genre: 'Business', keywords: ['business', 'economics', 'management', 'entrepreneur', 'marketing', 'finance', 'leadership', 'investing'] },
  { genre: 'Self-help', keywords: ['self-help', 'self help', 'personal growth', 'inspiration', 'motivational', 'productivity', 'habits', 'self-realization'] },
  { genre: 'Religion & Spirituality', keywords: ['religion', 'spirituality', 'christian', 'islam', 'hindu', 'buddhis', 'theology', 'bible', 'meditation', 'mind & spirit'] },
  { genre: 'Travel', keywords: ['travel', 'voyages', 'exploration', 'guidebook'] },
  { genre: 'Food & Cooking', keywords: ['cooking', 'cookery', 'food', 'recipes', 'cuisine', 'baking'] },
  { genre: 'Art & Design', keywords: ['art', 'design', 'photography', 'architecture', 'painting', 'music', 'film'] },
  { genre: "Children's & YA", keywords: ['juvenile', 'children', 'young adult', "children's", 'picture book', 'middle grade'] },
  // Deliberately last: "fiction" appears inside many of the above, so the more
  // specific rules get first refusal and this becomes the fallback.
  { genre: 'Fiction', keywords: ['fiction', 'novel', 'literary', 'short stories'] },
]

/** BISAC top-level headings map cleanly and are worth extra weight. */
const BISAC_ROOTS: Record<string, Genre> = {
  fiction: 'Fiction',
  'juvenile fiction': "Children's & YA",
  'juvenile nonfiction': "Children's & YA",
  'young adult fiction': "Children's & YA",
  biography: 'Biography & Memoir',
  'biography & autobiography': 'Biography & Memoir',
  history: 'History',
  science: 'Science',
  philosophy: 'Philosophy',
  psychology: 'Psychology',
  'business & economics': 'Business',
  'self-help': 'Self-help',
  religion: 'Religion & Spirituality',
  'body, mind & spirit': 'Religion & Spirituality',
  travel: 'Travel',
  cooking: 'Food & Cooking',
  art: 'Art & Design',
  photography: 'Art & Design',
  music: 'Art & Design',
  poetry: 'Poetry',
  'literary collections': 'Fiction',
  'literary criticism': 'Fiction',
}

const MAX_GENRES = 3

/**
 * Discard anything a person wouldn't recognise as a genre.
 *
 * Order matters less than coverage here — the goal is to be aggressive, since
 * a false negative costs one subject out of fifty and a false positive puts
 * "Cb113.h4 h3713 2015" in the filter drawer.
 */
function isNoise(subject: string): boolean {
  const s = subject.trim()
  if (s.length < 3 || s.length > 45) return true
  if (s.includes('=')) return true // nyt:trade_fiction_paperback=2008-01-05
  if (/\b(nyt|oclc|lccn|ddc|dewey)\b/i.test(s)) return true
  if (/^[a-z]{1,3}\d/i.test(s)) return true // LC call numbers: Cb113.h4
  if (/^\d/.test(s)) return true // "599.9"
  if ((s.match(/\d/g) ?? []).length >= 3) return true
  if (/^(accessible book|protected daisy|in library|overdrive|large type)/i.test(s)) return true
  if (/^translations? into/i.test(s)) return true
  return false
}

interface Signal {
  score: number
  /** Distinct subjects that pointed here. */
  hits: number
  /** Whether a structured publisher heading backed it. */
  bisac: boolean
}

/**
 * Map a book's raw subjects onto at most three canonical genres.
 *
 * Scoring rather than first-match: a book tagged "Fiction", "FICTION /
 * Literary", "Southern Gothic" and "domestic fiction" should come out as
 * Fiction, not as whichever rule happened to be checked first.
 *
 * A genre also has to be *corroborated* — either two independent subjects
 * point at it, or one structured BISAC heading does. Without that rule a
 * single stray keyword decides the genre, and Open Library's subject lists are
 * full of strays: Harry Potter's first few subjects are "Ghosts", "Monsters",
 * "Vampires", "Witches", which on their own file it under Horror.
 */
export function normalizeGenres(subjects?: string[]): Genre[] {
  if (!subjects?.length) return []

  const signals = new Map<Genre, Signal>()
  const bump = (genre: Genre, score: number, bisac = false) => {
    const current = signals.get(genre) ?? { score: 0, hits: 0, bisac: false }
    signals.set(genre, {
      score: current.score + score,
      hits: current.hits + 1,
      bisac: current.bisac || bisac,
    })
  }

  for (const raw of subjects) {
    if (isNoise(raw)) continue
    const subject = raw.toLowerCase().trim()

    // Structured BISAC heading — strongest signal available.
    if (subject.includes(' / ')) {
      const root = subject.split(' / ')[0].trim()
      const mapped = BISAC_ROOTS[root]
      if (mapped) bump(mapped, 5, true)
      // The tail often names the real genre ("FICTION / Science Fiction").
      const tail = subject.split(' / ').slice(1).join(' ')
      for (const rule of RULES) {
        if (rule.keywords.some((k) => tail.includes(k))) {
          bump(rule.genre, 3, true)
          break
        }
      }
      continue
    }

    for (const rule of RULES) {
      if (rule.keywords.some((k) => subject.includes(k))) {
        // An exact match ("history") beats an incidental one
        // ("technology and civilization").
        bump(rule.genre, rule.keywords.includes(subject) ? 3 : 1)
        break
      }
    }
  }

  const corroborated = [...signals.entries()].filter(
    ([, signal]) => signal.bisac || signal.hits >= 2,
  )
  if (corroborated.length === 0) return []

  const ranked = corroborated.sort((a, b) => b[1].score - a[1].score)
  const top = ranked[0][1].score

  return ranked
    .filter(([, signal]) => signal.score >= Math.max(2, top * 0.25))
    .slice(0, MAX_GENRES)
    .map(([genre]) => genre)
}

/** Genres actually present in a collection, in canonical order. */
export function genresInUse(books: { genres?: string[] }[]): Genre[] {
  const present = new Set<string>()
  for (const book of books) for (const genre of book.genres ?? []) present.add(genre)
  return GENRES.filter((genre) => present.has(genre))
}
