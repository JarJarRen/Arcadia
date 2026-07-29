import type { StoreId } from '@shared/types'
import type { LibraryEntry } from '@shared/library'
import { t } from '@shared/i18n'

export type SortKey = 'name' | 'playtime' | 'lastPlayed' | 'size'

/**
 * Three states rather than a checkbox.
 *
 * `exclude` is the one a checkbox cannot express, and it answers the more
 * common question: which games does this account actually hold a licence
 * for? Steam reports family-shared and free-to-play titles the same way, so
 * without this the two are inseparable in the library.
 */
export type SharedFilter = 'all' | 'only' | 'exclude'

/**
 * Grid of tiles, or a list beside the details of the selected entry.
 *
 * Not persisted: unlike the language this is a per-session choice, and one
 * `settings` row can be added later if that turns out to be wrong.
 */
export type ViewMode = 'grid' | 'list'

export interface LibraryFilter {
  search: string
  store: StoreId | 'all'
  onlyInstalled: boolean
  onlyFavorites: boolean
  shared: SharedFilter
}

export function filterGames(entries: LibraryEntry[], filter: LibraryFilter): LibraryEntry[] {
  const needle = filter.search.trim().toLowerCase()

  return entries.filter((entry) => {
    // The store filter considers EVERY source, not just the active one:
    // otherwise a merged game would vanish when filtering by a store it
    // also belongs to.
    if (filter.store !== 'all' && !entry.sources.some((s) => s.storeId === filter.store)) {
      return false
    }
    if (filter.onlyInstalled && !entry.installed) return false
    if (filter.onlyFavorites && !entry.favorite) return false
    if (filter.shared === 'only' && !entry.sharedOrFree) return false
    if (filter.shared === 'exclude' && entry.sharedOrFree) return false
    if (needle !== '' && !entry.name.toLowerCase().includes(needle)) return false
    return true
  })
}

/** Descending; entries without a value always sort last. */
function byNumberDesc(a: number | undefined, b: number | undefined): number {
  if (a === undefined && b === undefined) return 0
  if (a === undefined) return 1
  if (b === undefined) return -1
  return b - a
}

export function sortGames(entries: LibraryEntry[], key: SortKey): LibraryEntry[] {
  const sorted = [...entries]

  switch (key) {
    case 'name':
      // Collator taken from the active language rather than fixed: an
      // English collator sorts “Ärger” after “Zorn”, which reads as a bug.
      return sorted.sort((a, b) =>
        a.name.localeCompare(b.name, t().format.locale, { sensitivity: 'base' })
      )
    case 'playtime':
      return sorted.sort((a, b) => byNumberDesc(a.playtimeMinutes, b.playtimeMinutes))
    case 'lastPlayed':
      return sorted.sort((a, b) => byNumberDesc(a.lastPlayed, b.lastPlayed))
    case 'size':
      return sorted.sort((a, b) => byNumberDesc(a.installSizeBytes, b.installSizeBytes))
  }
}

export function formatPlaytime(minutes: number | undefined): string | undefined {
  if (minutes === undefined || minutes === 0) return undefined
  if (minutes < 60) return t().format.minutes(minutes)
  return t().format.hours(Math.round(minutes / 60))
}

export function formatSize(bytes: number | undefined): string | undefined {
  if (bytes === undefined || bytes === 0) return undefined
  const gb = bytes / 1024 ** 3
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`
}
