import type { LibraryEntry } from '@shared/library'
import type { StoreId } from '@shared/types'
import type { ArtworkKind, ArtworkRef } from '@shared/metadata'
import { t } from '@shared/i18n'

/**
 * Looks for artwork of the requested kind, falling back in order.
 *
 * The chain is not arbitrary: `hero` is wide (page header), `grid` is
 * portrait (tile), `logo` is cut out. A portrait image in the header looks
 * worse than a wide one — but still better than an empty area, and with
 * `object-fit: cover` it stays undistorted.
 *
 * On the real library Steam and Epic both supply the two kinds together,
 * so the chain rarely fires. It carries the cases where a source has only
 * one of them — with SteamGridDB (task 6) that is the rule.
 */
export function pickArtwork(
  artwork: ArtworkRef[],
  kind: ArtworkKind
): ArtworkRef | undefined {
  const order: ArtworkKind[] =
    kind === 'hero' ? ['hero', 'grid'] : kind === 'grid' ? ['grid', 'hero'] : ['logo']

  for (const candidate of order) {
    const match = artwork.find((image) => image.kind === candidate)
    if (match !== undefined) return match
  }
  return undefined
}

/**
 * “Last played” as a date.
 *
 * Steam supplies a Unix timestamp in seconds. There, 0 means “never
 * played”, not 1 January 1970 — it has to count as missing, otherwise the
 * page claims a date that never existed.
 */
export function formatLastPlayed(unixSeconds: number | undefined): string | undefined {
  if (unixSeconds === undefined || unixSeconds <= 0) return undefined
  const date = new Date(unixSeconds * 1000)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toLocaleDateString(t().format.locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })
}

export interface StoreOrigin {
  gameId: string
  storeId: StoreId
  installed: boolean
  active: boolean
}

/**
 * Where the game lives — for the origin row on the details page.
 *
 * Lists every source, not just the active one: for a merged game that is
 * exactly the information the tile cannot convey.
 *
 * Returns the `storeId`, not the label. Mapping an identifier to a
 * readable name is the view's job — and keeping it out of here is what
 * keeps this file free of components the Node project does not know about.
 */
export function storeOrigins(entry: LibraryEntry): StoreOrigin[] {
  return entry.sources.map((source) => ({
    gameId: source.id,
    storeId: source.storeId,
    installed: source.installed,
    active: source.id === entry.active.id
  }))
}
