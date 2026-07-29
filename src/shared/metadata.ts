/**
 * Where a game's match to a Steam AppID came from.
 *
 * The order in the type mirrors trustworthiness: `steam-appid` is not a
 * match at all but the identity itself; `manual` beats every automatic
 * source and is never overwritten.
 */
export type MatchSource = 'steam-appid' | 'name-exact' | 'epic-catalog' | 'manual'

export interface GameMetadata {
  steamAppId?: number
  matchSource?: MatchSource
  shortDescription?: string
  description?: string
  developers: string[]
  publishers: string[]
  genres: string[]
  releaseDate?: string
  metacritic?: number
  screenshots: string[]
  fetchedAt?: number
  fetchFailedAt?: number
  fetchAttempts: number
}

export type ArtworkKind = 'grid' | 'hero' | 'logo'

/**
 * Root of Steam's image URLs.
 *
 * It lives here because two places have to agree on it: the queue builds
 * the URLs from the AppID, and the database recognises by exactly this
 * prefix which images came from Steam — in order to discard them after a
 * manual correction. Two separate strings would drift apart on the first
 * change without anything breaking: the wrong image would simply stay.
 */
export const STEAM_ASSET_BASE =
  'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps'

/**
 * An image as a **URL**, not as a file.
 *
 * Images are deliberately not downloaded. The view loads them straight
 * from the source, and the CSP allows exactly the four hosts involved.
 * Consequence: no images offline, and opening the app produces requests to
 * Epic, Valve and SteamGridDB.
 */
export interface ArtworkRef {
  kind: ArtworkKind
  url: string
}
