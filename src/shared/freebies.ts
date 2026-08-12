import type { StoreId } from './types'

export type FreebieKind = 'game' | 'dlc' | 'loot'
export type FreebieSource = 'epic' | 'steam' | 'gamerpower'

/**
 * How far a claim has got.
 *
 * `pending` is the honest middle: Arcadia opened the store's page and
 * cannot know whether the button there was pressed. Only a later library
 * scan can turn that into `confirmed`.
 *
 * `owned` is a different fact from `confirmed`: it says the library already
 * had the game before the giveaway ever appeared, not that Arcadia watched
 * a claim succeed. It is derived at read time from the current library
 * rather than stored, and a `confirmed` claim always outranks it — see
 * FreebieService.getList.
 */
export type ClaimState = 'unclaimed' | 'pending' | 'confirmed' | 'owned'

/** What a source parser produces, before dedup and before the database. */
export interface RawFreebie {
  storeId: StoreId
  title: string
  kind: FreebieKind
  /** Steam AppID or Epic page slug, where the source supplies one. */
  storeGameId?: string
  /** https fallback, where it does not. */
  claimUrl?: string
  imageUrl?: string
  /** Epoch ms. Set when the promotion has not started yet. */
  startsAt?: number
  /** Epoch ms. */
  endsAt?: number
  source: FreebieSource
}

/** A row as the renderer sees it. */
export interface Freebie extends RawFreebie {
  /** `storeId + ':' + mergeKey(title)`, stable across refreshes. */
  id: string
  claim: ClaimState
  /** When the claim button was last pressed. Epoch ms. */
  openedAt?: number
}

export interface FreebieList {
  current: Freebie[]
  upcoming: Freebie[]
  /** When the cache was last successfully written. Epoch ms. */
  fetchedAt?: number
  /** Sources that failed on the most recent attempt, already localised. */
  failures: string[]
}
