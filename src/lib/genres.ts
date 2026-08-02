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
  // Fiction
  'Fiction',
  'Classics',
  'Science Fiction',
  'Fantasy',
  'Mystery & Thriller',
  'Romance',
  'Horror',
  'Historical Fiction',
  'Short Stories',
  // Form
  'Poetry',
  'Drama & Plays',
  'Graphic Novels',
  'Essays',
  // Non-fiction
  'History',
  'Biography & Memoir',
  'True Crime',
  'Science',
  'Nature & Environment',
  'Technology',
  'Philosophy',
  'Psychology',
  'Politics & Society',
  'Business',
  'Self-help',
  'Health & Wellness',
  'Religion & Spirituality',
  'Travel',
  'Food & Cooking',
  'Art & Design',
  'Sport',
  'Humour',
  "Children's & YA",
] as const

export type Genre = (typeof GENRES)[number]

/**
 * Keywords split into two kinds, because they carry very different weight:
 *
 * - `strong` — terms that *name* the genre ("true crime", "poetry"). A subject
 *   that is exactly one of these is conclusive on its own.
 * - `weak` — themes that merely suggest it ("vampires", "dragons"). These need
 *   corroboration; on their own they misfile books. Harry Potter's subjects
 *   include Ghosts, Monsters, Vampires and Witches, none of which make it
 *   a horror novel.
 *
 * Order matters too: the first matching rule wins for a given subject, so the
 * specific ones precede the general. "Fiction" is deliberately last — the word
 * appears inside most fiction sub-genres and would otherwise swallow them.
 */
const RULES: { genre: Genre; strong: string[]; weak?: string[] }[] = [
  // Non-fiction that's easy to mistake for fiction — these go first so a
  // stray "crime" or "novel" in the subject list doesn't claim them.
  { genre: 'True Crime', strong: ['true crime', 'true-crime'], weak: ['criminology', 'criminal investigation', 'case studies'] },
  { genre: 'Graphic Novels', strong: ['graphic novel', 'comic book', 'comics & graphic novels', 'manga'], weak: ['comic strips', 'cartoons', 'comics'] },
  { genre: 'Essays', strong: ['essays'], weak: ['essay', 'literary collections'] },
  { genre: 'Drama & Plays', strong: ['drama', 'plays'], weak: ['tragedies', 'comedies', 'theater', 'theatre'] },

  { genre: 'Science Fiction', strong: ['science fiction', 'sci-fi'], weak: ['dystopia', 'space opera', 'cyberpunk', 'time travel'] },
  { genre: 'Fantasy', strong: ['fantasy', 'magical realism'], weak: ['magic', 'dragons', 'wizards', 'mythical', 'sword and sorcery'] },
  { genre: 'Historical Fiction', strong: ['historical fiction'], weak: ['historical novel'] },
  { genre: 'Mystery & Thriller', strong: ['mystery', 'thriller', 'detective'], weak: ['suspense', 'noir', 'espionage', 'whodunit'] },
  { genre: 'Romance', strong: ['romance'], weak: ['love stories', 'romantic'] },
  { genre: 'Horror', strong: ['horror'], weak: ['ghost stories', 'supernatural', 'vampires', 'gothic'] },
  { genre: 'Short Stories', strong: ['short stories'], weak: ['short story'] },
  { genre: 'Poetry', strong: ['poetry', 'poems'], weak: ['verse', 'sonnets', 'lyrik'] },
  { genre: 'Classics', strong: ['classics'], weak: ['classic literature', 'literary classics', 'canon'] },

  { genre: 'Biography & Memoir', strong: ['biography', 'autobiography', 'memoir'], weak: ['personal narrative', 'diaries', 'letters'] },
  { genre: 'History', strong: ['history'], weak: ['historical', 'civilization', 'ancient', 'medieval', 'war', 'archaeology'] },
  { genre: 'Politics & Society', strong: ['politics', 'sociology', 'social science'], weak: ['political', 'current affairs', 'government', 'feminism', 'race relations', 'human rights'] },
  { genre: 'Nature & Environment', strong: ['nature', 'ecology', 'natural history'], weak: ['environment', 'climate', 'wildlife', 'conservation', 'gardening'] },
  { genre: 'Technology', strong: ['computers', 'programming'], weak: ['computing', 'software', 'artificial intelligence', 'internet', 'engineering'] },
  { genre: 'Science', strong: ['science', 'physics', 'biology', 'chemistry', 'astronomy'], weak: ['evolution', 'mathematics', 'medicine'] },
  { genre: 'Philosophy', strong: ['philosophy'], weak: ['ethics', 'metaphysics', 'logic', 'existential', 'stoicism'] },
  { genre: 'Psychology', strong: ['psychology', 'psychiatry'], weak: ['mental health', 'cognition', 'behaviour', 'behavior'] },
  { genre: 'Health & Wellness', strong: ['health', 'fitness'], weak: ['wellness', 'nutrition', 'diet', 'yoga', 'mindfulness'] },
  { genre: 'Business', strong: ['business', 'economics'], weak: ['management', 'entrepreneur', 'marketing', 'finance', 'leadership', 'investing'] },
  { genre: 'Self-help', strong: ['self-help', 'self help'], weak: ['personal growth', 'inspiration', 'motivational', 'productivity', 'habits', 'self-realization', 'success'] },
  { genre: 'Religion & Spirituality', strong: ['religion', 'spirituality'], weak: ['christian', 'islam', 'hindu', 'buddhis', 'theology', 'bible', 'meditation', 'mind & spirit'] },
  { genre: 'Travel', strong: ['travel'], weak: ['voyages', 'exploration', 'guidebook'] },
  { genre: 'Food & Cooking', strong: ['cooking', 'cookery'], weak: ['food', 'recipes', 'cuisine', 'baking'] },
  { genre: 'Sport', strong: ['sports'], weak: ['cricket', 'football', 'athletics', 'olympic'] },
  { genre: 'Humour', strong: ['humor', 'humour'], weak: ['satire', 'comedy'] },
  { genre: 'Art & Design', strong: ['art', 'design', 'photography', 'architecture'], weak: ['painting', 'music', 'film'] },
  { genre: "Children's & YA", strong: ['juvenile', 'young adult'], weak: ['children', "children's", 'picture book', 'middle grade'] },

  { genre: 'Fiction', strong: ['fiction'], weak: ['novel', 'literary'] },
]

/**
 * Genres that cannot also be prose fiction. When one of these lands, "Fiction"
 * is dropped even if it scored higher.
 *
 * Open Library tags a lot of non-fiction as Fiction regardless: In Cold Blood
 * carries "Fiction, coming of age", and Milk and Honey — a poetry collection —
 * carries a bare "FICTION" plus "FICTION / Romance".
 *
 * History, Science, Philosophy and Politics are deliberately *absent*: those
 * legitimately co-occur with fiction (a historical novel is both), and
 * excluding them would strip Fiction off half the shelf.
 */
const NOT_FICTION: Genre[] = [
  'True Crime',
  'Biography & Memoir',
  'Poetry',
  'Essays',
  'Drama & Plays',
  'Self-help',
  'Business',
  'Health & Wellness',
  'Travel',
  'Food & Cooking',
  'Sport',
  'Technology',
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
  'performing arts': 'Art & Design',
  poetry: 'Poetry',
  drama: 'Drama & Plays',
  'true crime': 'True Crime',
  'comics & graphic novels': 'Graphic Novels',
  'political science': 'Politics & Society',
  'social science': 'Politics & Society',
  nature: 'Nature & Environment',
  computers: 'Technology',
  'health & fitness': 'Health & Wellness',
  medical: 'Health & Wellness',
  sports: 'Sport',
  'sports & recreation': 'Sport',
  humor: 'Humour',
  'literary collections': 'Essays',
  'literary criticism': 'Essays',
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
  /** Backed by a structured publisher heading, or an exact genre-name match. */
  conclusive: boolean
}

/**
 * Map a book's raw subjects onto at most three canonical genres.
 *
 * Scoring rather than first-match: a book tagged "Fiction", "FICTION /
 * Literary", "Southern Gothic" and "domestic fiction" should come out as
 * Fiction, not as whichever rule happened to be checked first.
 *
 * A genre has to be *corroborated* before it counts — by a structured BISAC
 * heading, by a subject that exactly names it, or by two independent hits.
 * Both halves of that rule earn their place:
 *
 * - Without it, one stray theme decides the genre. Harry Potter's subjects
 *   include Ghosts, Monsters, Vampires and Witches, which filed it as Horror.
 * - With *only* the two-hits half, a single decisive subject gets thrown away.
 *   In Cold Blood is literally tagged "True crime" once, and lost to two
 *   incidental "Fiction, …" tags.
 */
export function normalizeGenres(subjects?: string[]): Genre[] {
  if (!subjects?.length) return []

  const signals = new Map<Genre, Signal>()
  const bump = (genre: Genre, score: number, conclusive = false) => {
    const current = signals.get(genre) ?? { score: 0, hits: 0, conclusive: false }
    signals.set(genre, {
      score: current.score + score,
      hits: current.hits + 1,
      conclusive: current.conclusive || conclusive,
    })
  }

  const match = (text: string, exact: boolean) => {
    for (const rule of RULES) {
      if (rule.strong.some((k) => text.includes(k))) {
        // A subject that *is* the genre name settles it by itself.
        return { genre: rule.genre, score: exact ? 4 : 2, conclusive: exact }
      }
      if (rule.weak?.some((k) => text.includes(k))) {
        return { genre: rule.genre, score: 1, conclusive: false }
      }
    }
    return null
  }

  for (const raw of subjects) {
    if (isNoise(raw)) continue
    const subject = raw.toLowerCase().trim()

    // Structured BISAC heading — strongest signal available.
    if (subject.includes(' / ')) {
      const [root, ...rest] = subject.split(' / ').map((s) => s.trim())
      const mapped = BISAC_ROOTS[root]
      if (mapped) bump(mapped, 5, true)
      // The tail often names the real genre ("FICTION / Science Fiction").
      const tail = match(rest.join(' '), false)
      if (tail) bump(tail.genre, 3, true)
      continue
    }

    const hit = match(subject, true)
    if (hit) {
      // `exact` means the whole subject is the keyword, not merely contains it:
      // "history" is decisive, "technology and civilization" is incidental.
      const isExact = RULES.some((r) => r.strong.includes(subject))
      bump(hit.genre, isExact ? 4 : hit.score === 1 ? 1 : 2, isExact)
    }
  }

  const corroborated = [...signals.entries()].filter(
    ([, signal]) => signal.conclusive || signal.hits >= 2,
  )
  if (corroborated.length === 0) return []

  const ranked = corroborated.sort((a, b) => b[1].score - a[1].score)
  const top = ranked[0][1].score

  let winners = ranked
    .filter(([, signal]) => signal.score >= Math.max(2, top * 0.25))
    .map(([genre]) => genre)

  // Regardless of rank: Fiction usually scores highest simply because the word
  // is scattered through the subject list, so only suppressing it when it
  // *loses* would never fire.
  if (winners.some((g) => NOT_FICTION.includes(g))) {
    winners = winners.filter((g) => g !== 'Fiction')
  }

  return winners.slice(0, MAX_GENRES)
}

/** Genres actually present in a collection, in canonical order. */
export function genresInUse(books: { genres?: string[] }[]): Genre[] {
  const present = new Set<string>()
  for (const book of books) for (const genre of book.genres ?? []) present.add(genre)
  return GENRES.filter((genre) => present.has(genre))
}
