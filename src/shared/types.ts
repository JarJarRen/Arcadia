export const STORE_IDS = ['steam', 'epic', 'ea', 'ubisoft'] as const
export type StoreId = (typeof STORE_IDS)[number]

/** What an adapter reads raw from a store. */
export interface RawGame {
  storeGameId: string
  name: string
  installed: boolean
  installPath?: string
  installSizeBytes?: number
  playtimeMinutes?: number
  /** Unix seconds. */
  lastPlayed?: number
  /**
   * Identifier for the launch URI, when it differs from `storeGameId`.
   *
   * Epic needs this: owned games are only known to the catalogue (keyed by
   * `CatalogItemId`), but launching goes through the `AppName`, which only
   * an installed game's local manifest carries. Without this field the
   * game ID would have to change on installation — the same game would end
   * up with two rows in the database, and favourites or store choice would
   * hang off the wrong one.
   *
   * When absent, `storeGameId` doubles as the launch identifier.
   */
  launchId?: string

  /**
   * The game is playable but does not belong to this account.
   *
   * Steam only. `GetOwnedGames` reports licensed games exclusively — 193
   * on the development machine, while Steam's own interface shows 226. The
   * gap sits in `localconfig.vdf`: 24 games played here that the API does
   * not know about.
   *
   * The name says exactly as much as can be proven. **Whether it is family
   * sharing or free-to-play cannot be decided from the data** — Team
   * Fortress 2 and Anno 1800 sit in the same list. A field named
   * `familyShared` would be a lie for half the cases.
   */
  sharedOrFree?: boolean

  /**
   * Added by hand rather than found by an adapter.
   *
   * Introduced when EA reported only what had been installed on this machine.
   * That is no longer true — the EA adapter now reads the entitlement store
   * and sees the whole owned library — but the escape hatch stays: EA's
   * catalogue leaves a few offers unnamed and unclassified, and those are
   * still dropped rather than shown as a number. Such an entry can be deleted
   * again, which a scanned one cannot.
   *
   * A scan may take the row over: if the identifier turns out to be a real
   * one, the adapter's data wins and the placeholder becomes an ordinary
   * entry.
   */
  manual?: boolean
}

/** A game as it exists in the database and the UI. */
export interface Game extends RawGame {
  /** `${storeId}:${storeGameId}` — stable across reinstalls. */
  id: string
  storeId: StoreId
  favorite: boolean
  hidden: boolean
  firstSeen: number
  lastSeen: number
}

export interface AvailabilityResult {
  available: boolean
  /** Human-readable reason when unavailable. */
  reason?: string
  /** What is restricted on this platform. */
  limitations?: string[]
}

export function gameId(storeId: StoreId, storeGameId: string): string {
  return `${storeId}:${storeGameId}`
}

/**
 * Splits a game ID, validating both halves along the way.
 *
 * The split happens at the **first** colon only: Epic's `AppName` may
 * contain colons itself, and splitting on every colon would tear the ID
 * apart. Since no store identifier contains a colon, the first one is
 * always the separator that was inserted.
 */
export function parseGameId(id: string): { storeId: StoreId; storeGameId: string } {
  const separator = id.indexOf(':')
  if (separator === -1) throw new Error(`Invalid game ID: ${id}`)

  const storeId = id.slice(0, separator)
  if (!STORE_IDS.includes(storeId as StoreId)) {
    throw new Error(`Unknown store in game ID: ${storeId}`)
  }

  // Check the second half too: "steam:" would otherwise pass as a valid ID
  // with an empty game identifier. No store produces that, and this
  // function is the validation boundary for IDs arriving over IPC.
  const storeGameId = id.slice(separator + 1)
  if (storeGameId === '') throw new Error(`Game ID without game identifier: ${id}`)

  return { storeId: storeId as StoreId, storeGameId }
}
