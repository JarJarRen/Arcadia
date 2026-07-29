import type { Game, StoreId } from './types'
import type { ArtworkRef, GameMetadata } from './metadata'

/**
 * A game as the interface sees it — possibly merged from several store
 * entries.
 */
export interface LibraryEntry {
  /** Merge key; doubles as the tile's stable identifier. */
  key: string
  /** Every store entry for this game, stably ordered. */
  sources: Game[]
  /** The entry that launching goes through. */
  active: Game
  name: string
  installed: boolean
  favorite: boolean
  /**
   * Playable, but licensed by none of this account's stores.
   *
   * Only true when **every** source is marked that way: if you own the
   * game at any store, you own it.
   */
  sharedOrFree: boolean
  playtimeMinutes?: number
  lastPlayed?: number
  installPath?: string
  installSizeBytes?: number
  /**
   * Images as URLs. Loaded straight from the source rather than
   * downloaded — the CSP allows exactly four hosts for that.
   */
  artwork: ArtworkRef[]
  /** Absent until the metadata has been fetched. */
  metadata?: GameMetadata
}

export type StoreIdList = readonly StoreId[]
