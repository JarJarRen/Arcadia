import { STORE_IDS, type StoreId } from '@shared/types'
import type { LibraryEntry } from '@shared/library'
import type { Freebie } from '@shared/freebies'
import { t } from '@shared/i18n'
import { STORE_LABELS } from './components/storeLabels'

export type SortKey = 'name' | 'playtime' | 'lastPlayed' | 'size'

/**
 * Ascending or descending, held apart from the key and kept across a change
 * of key.
 *
 * Deliberately not a per-key default that resets: a direction that silently
 * changes underneath you is harder to trust than one that stays put. The
 * toolbar's arrow states which one is active, so the ordering never has to be
 * inferred from the list.
 */
export type SortDirection = 'asc' | 'desc'

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
  /**
   * The stores to show, ORed. Empty means every store.
   *
   * One representation rather than an `'all'` sentinel beside the list: the
   * empty selection *is* the neutral state, so unticking the last store
   * shows the whole library instead of an empty one, and "nothing selected"
   * never becomes a second way of saying "everything selected".
   */
  stores: StoreId[]
  onlyInstalled: boolean
  onlyFavorites: boolean
  shared: SharedFilter
}

/**
 * Adds or removes one store, in the canonical store order.
 *
 * Sorting the result rather than appending keeps the label stable: ticking
 * Epic then Steam reads "Steam, Epic", exactly as the other way round would.
 */
export function toggleStore(stores: StoreId[], id: StoreId): StoreId[] {
  const next = stores.includes(id) ? stores.filter((s) => s !== id) : [...stores, id]
  return STORE_IDS.filter((s) => next.includes(s))
}

/** What the store button reads: "All stores", "Steam, Epic", "3 stores". */
export function storeFilterLabel(stores: StoreId[]): string {
  if (stores.length === 0) return t().toolbar.allStores
  // Two names still fit the toolbar; from three on the row would start to
  // shift about as the selection changes, so the count takes over.
  if (stores.length > 2) return t().toolbar.storesSelected(stores.length)
  return stores.map((id) => STORE_LABELS[id] ?? id).join(', ')
}

/**
 * What the store button's tooltip reads: the same selection, but always by
 * name. Once the label counts, "3 stores" is all the toolbar says, and
 * which three is otherwise only answerable by opening the menu.
 */
export function storeFilterTitle(stores: StoreId[]): string {
  const selection =
    stores.length === 0
      ? t().toolbar.allStores
      : stores.map((id) => STORE_LABELS[id] ?? id).join(', ')
  return t().toolbar.storeFilterTitle(selection)
}

/**
 * The store selection, with anything no longer offered removed.
 *
 * Returns the **same array** when nothing changed, so a caller can hand the
 * result straight to `setState` without causing a render on every pass.
 *
 * Without this a store switched off in the configuration screen would stay
 * in the filter: the grid would keep filtering on it, the menu would no
 * longer list it, and the library would look empty for no visible reason.
 */
export function pruneStores(selected: StoreId[], enabled: StoreId[]): StoreId[] {
  const pruned = selected.filter((id) => enabled.includes(id))
  return pruned.length === selected.length ? selected : pruned
}

export function filterGames(entries: LibraryEntry[], filter: LibraryFilter): LibraryEntry[] {
  const needle = filter.search.trim().toLowerCase()

  return entries.filter((entry) => {
    // The store filter considers EVERY source, not just the active one:
    // otherwise a merged game would vanish when filtering by a store it
    // also belongs to.
    if (
      filter.stores.length > 0 &&
      !entry.sources.some((s) => filter.stores.includes(s.storeId))
    ) {
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

/**
 * Narrows a list of offers by the two controls the free-games page shares
 * with the library.
 *
 * Takes the two values rather than a `LibraryFilter` on purpose: an offer has
 * no install state, no favourite and no shared licence, so handing this the
 * whole filter would invite reading fields that mean nothing here.
 */
export function filterFreebies(rows: Freebie[], search: string, stores: StoreId[]): Freebie[] {
  const needle = search.trim().toLowerCase()

  return rows.filter((row) => {
    if (stores.length > 0 && !stores.includes(row.storeId)) return false
    if (needle !== '' && !row.title.toLowerCase().includes(needle)) return false
    return true
  })
}

/**
 * Compares two numbers in the direction `sign` gives, missing values last.
 *
 * The `undefined` checks sit outside the multiplication on purpose: an entry
 * with no playtime, no last-played date or no known size has nothing to
 * compare, and flipping the direction would otherwise wash all of them to
 * the top — burying the very games the reversed order was opened to find.
 */
function byNumber(a: number | undefined, b: number | undefined, sign: number): number {
  if (a === undefined && b === undefined) return 0
  if (a === undefined) return 1
  if (b === undefined) return -1
  return sign * (a - b)
}

export function sortGames(
  entries: LibraryEntry[],
  key: SortKey,
  direction: SortDirection
): LibraryEntry[] {
  const sorted = [...entries]
  const sign = direction === 'asc' ? 1 : -1

  switch (key) {
    case 'name':
      // Collator taken from the active language rather than fixed: an
      // English collator sorts “Ärger” after “Zorn”, which reads as a bug.
      return sorted.sort(
        (a, b) => sign * a.name.localeCompare(b.name, t().format.locale, { sensitivity: 'base' })
      )
    case 'playtime':
      return sorted.sort((a, b) => byNumber(a.playtimeMinutes, b.playtimeMinutes, sign))
    case 'lastPlayed':
      return sorted.sort((a, b) => byNumber(a.lastPlayed, b.lastPlayed, sign))
    case 'size':
      return sorted.sort((a, b) => byNumber(a.installSizeBytes, b.installSizeBytes, sign))
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
