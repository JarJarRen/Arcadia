import type { Game, StoreId } from '@shared/types'
import type { FreebieRepository } from '@main/db/freebies'
import { mergeKey } from '@main/library/merge'

/** The two keys a library game is looked up by. See libraryIndex. */
export interface LibraryIndex {
  byStoreGameId: Set<string>
  byTitle: Set<string>
}

/**
 * Indexes the library the two ways an offer can match it.
 *
 * Two keys, because the stores do not offer the same one. Steam's AppID is
 * in both the promotion and the library, so it is used where it exists.
 * Epic's promotion carries a page slug while its library entry carries the
 * catalogue's AppName — unrelated strings — so there the normalised title
 * is the only bridge.
 *
 * Built once per call site and passed to `matchesLibrary` per offer, rather
 * than rebuilding it per offer: confirmClaims and FreebieService.getList
 * both walk a list of offers against the same, unchanging library.
 */
export function libraryIndex(games: Game[]): LibraryIndex {
  return {
    byStoreGameId: new Set(games.map((game) => `${game.storeId}:${game.storeGameId}`)),
    byTitle: new Set(games.map((game) => `${game.storeId}:${mergeKey(game.name)}`))
  }
}

/**
 * Whether an offer — a pending claim, or any freebie row — is already in
 * the library.
 *
 * Steam only for the ID match: its AppID is the same string on both sides.
 * Everywhere else the promotion's ID and the library's ID come from
 * different namespaces (see the Epic example above) and comparing them is
 * meaningless, not merely redundant — a coincidental match would name the
 * wrong game.
 */
export function matchesLibrary(
  index: LibraryIndex,
  offer: { storeId: StoreId; title: string; storeGameId?: string }
): boolean {
  const idMatch =
    offer.storeId === 'steam' &&
    offer.storeGameId !== undefined &&
    index.byStoreGameId.has(`${offer.storeId}:${offer.storeGameId}`)
  const titleMatch = index.byTitle.has(`${offer.storeId}:${mergeKey(offer.title)}`)
  return idMatch || titleMatch
}

/**
 * Looks for each pending claim in the library.
 *
 * Returns the ids it confirmed, so the caller can decide whether anything
 * is worth telling the renderer about.
 */
export function confirmClaims(
  repo: FreebieRepository,
  games: Game[],
  now: number
): string[] {
  const pending = repo.pendingClaims()
  if (pending.length === 0) return []

  const index = libraryIndex(games)

  const confirmed: string[] = []
  for (const claim of pending) {
    if (!matchesLibrary(index, claim)) continue
    repo.markConfirmed(claim.id, now)
    confirmed.push(claim.id)
  }
  return confirmed
}
