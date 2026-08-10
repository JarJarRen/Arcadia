import type { Game } from '@shared/types'
import type { FreebieRepository } from '@main/db/freebies'
import { mergeKey } from '@main/library/merge'

/**
 * Looks for each pending claim in the library.
 *
 * Two keys, because the stores do not offer the same one. Steam's AppID is
 * in both the promotion and the library, so it is used where it exists.
 * Epic's promotion carries a page slug while its library entry carries the
 * catalogue's AppName — unrelated strings — so there the normalised title
 * is the only bridge.
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

  const byStoreGameId = new Set(games.map((game) => `${game.storeId}:${game.storeGameId}`))
  const byTitle = new Set(games.map((game) => `${game.storeId}:${mergeKey(game.name)}`))

  const confirmed: string[] = []
  for (const claim of pending) {
    // Steam only: its AppID is the same string on both sides. Everywhere
    // else the promotion's ID and the library's ID come from different
    // namespaces (see the Epic example above) and comparing them is
    // meaningless, not merely redundant — a coincidental match would
    // confirm the wrong game.
    const idMatch =
      claim.storeId === 'steam' &&
      claim.storeGameId !== undefined &&
      byStoreGameId.has(`${claim.storeId}:${claim.storeGameId}`)
    const titleMatch = byTitle.has(`${claim.storeId}:${mergeKey(claim.title)}`)
    if (!idMatch && !titleMatch) continue
    repo.markConfirmed(claim.id, now)
    confirmed.push(claim.id)
  }
  return confirmed
}
