import { STORE_IDS, type Game } from '@shared/types'
import type { LibraryEntry } from '@shared/library'

export interface MergeOverrides {
  /** Merge key → `games.id` of the chosen store. */
  preferred: Record<string, string>
  /** Keys that should explicitly not be merged. */
  split: Set<string>
}

/**
 * Key used for merging.
 *
 * Deliberately conservative: only trademark symbols, punctuation and case
 * are normalised. Edition suffixes stay, so that "Far Cry 4" and "Far Cry 4
 * Gold Edition" remain separate — a wrongly merged pair is more annoying
 * than a duplicate, and for that case there is the split escape hatch
 * anyway.
 */
export function mergeKey(name: string): string {
  return name
    // The "?" belongs with the trademark signs, not with punctuation:
    // Epic's catalogue stores a literal question mark where ® stood, so
    // its entry reads "Rocket League?" against Steam's "Rocket League".
    // Without this the two never merge and the game appears twice.
    //
    // normalizeTitle in steamAppList.ts has done this since plan 3. The
    // two functions are otherwise identical and had simply drifted.
    .replace(/[™®©?]/g, '')
    .toLowerCase()
    .replace(/[:\-–—_,.'’`!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const STORE_ORDER = new Map(STORE_IDS.map((id, i) => [id, i]))

function highest(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return Math.max(a, b)
}

/** Which of two sources from the same store represents the game better. */
function better(a: Game, b: Game): boolean {
  if (a.installed !== b.installed) return a.installed
  const aLaunch = a.launchId !== undefined
  const bLaunch = b.launchId !== undefined
  if (aLaunch !== bLaunch) return aLaunch
  return a.lastSeen > b.lastSeen
}

export function mergeLibrary(games: Game[], overrides: MergeOverrides): LibraryEntry[] {
  const groups = new Map<string, Game[]>()

  for (const game of games) {
    const base = mergeKey(game.name)
    // Split keys get their own bucket per store.
    const key = overrides.split.has(base) ? `${base}#${game.id}` : base
    const existing = groups.get(key)
    if (existing === undefined) groups.set(key, [game])
    else existing.push(game)
  }

  const entries: LibraryEntry[] = []

  for (const [key, raw] of groups) {
    // What stays visible is whatever is not hidden in every source.
    const sources = raw.filter((game) => !game.hidden)
    if (sources.length === 0) continue

    // At most one source per store.
    //
    // A store can list the same game under two identifiers when its
    // identifier scheme changed: Epic moved from `AppName` to
    // `CatalogItemId`, and the old rows stay because vanished games are
    // deliberately never deleted. Without this selection the tile would
    // carry two Epic badges for the same game.
    //
    // The installed source wins, otherwise the one with a launch
    // identifier, otherwise the most recently seen.
    const perStore = new Map<string, Game>()
    for (const source of sources) {
      const current = perStore.get(source.storeId)
      if (current === undefined || better(source, current)) {
        perStore.set(source.storeId, source)
      }
    }
    sources.length = 0
    sources.push(...perStore.values())

    // Stable order so the view does not jump between scans.
    sources.sort((a, b) => {
      const order = (STORE_ORDER.get(a.storeId) ?? 99) - (STORE_ORDER.get(b.storeId) ?? 99)
      return order !== 0 ? order : a.storeGameId.localeCompare(b.storeGameId)
    })

    const chosen = overrides.preferred[key]
    const active =
      sources.find((game) => game.id === chosen) ??
      sources.find((game) => game.installed) ??
      sources[0]!

    entries.push({
      key,
      sources,
      active,
      name: active.name,
      installed: sources.some((game) => game.installed),
      favorite: sources.some((game) => game.favorite),
      // `every`, not `some`: if you own the game at any store, you own it.
      // A game bought on Epic and merely family-shared on Steam would be
      // wrongly labelled "not yours" with `some`.
      sharedOrFree: sources.every((game) => game.sharedOrFree === true),
      playtimeMinutes: sources.reduce<number | undefined>(
        (acc, game) => highest(acc, game.playtimeMinutes),
        undefined
      ),
      lastPlayed: sources.reduce<number | undefined>(
        (acc, game) => highest(acc, game.lastPlayed),
        undefined
      ),
      installPath: active.installPath,
      installSizeBytes: active.installSizeBytes,
      // Filled in by ipc.ts from the metadata repository. The merge stays
      // deliberately free of database access.
      artwork: []
    })
  }

  return entries
}
