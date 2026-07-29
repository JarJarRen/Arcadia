import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RawGame } from '@shared/types'

/**
 * Epic stores games, the Unreal Engine and its plugins in the same manifest
 * directory. They can only be told apart via `AppCategories`.
 *
 * `MainGameAppName` does **not** work for this, tempting though it looks:
 * on the development machine it is empty (`""`) for real games and set to
 * the parent product for plugins. A filter on `AppName === MainGameAppName`
 * would have yielded zero games there.
 */
const GAME_CATEGORY = 'games'

/** Epic AppNames are hex identifiers or labels such as `UE_5.7`. */
const SAFE_APP_NAME = /^[A-Za-z0-9_.-]+$/

interface EpicManifest {
  AppName?: unknown
  CatalogItemId?: unknown
  DisplayName?: unknown
  InstallLocation?: unknown
  InstallSize?: unknown
  AppCategories?: unknown
  bIsIncompleteInstall?: unknown
}

export function parseEpicManifest(json: string): RawGame | undefined {
  let manifest: EpicManifest
  try {
    manifest = JSON.parse(json) as EpicManifest
  } catch {
    return undefined
  }
  if (typeof manifest !== 'object' || manifest === null) return undefined

  const appName = manifest.AppName
  const displayName = manifest.DisplayName
  const catalogItemId = manifest.CatalogItemId
  if (typeof appName !== 'string' || typeof displayName !== 'string') return undefined
  if (appName === '' || displayName === '') return undefined

  // The AppName ends up in the launch URI and therefore at the operating
  // system.
  if (!SAFE_APP_NAME.test(appName)) return undefined

  const categories = manifest.AppCategories
  if (!Array.isArray(categories)) return undefined
  if (!categories.includes(GAME_CATEGORY)) return undefined

  // The catalogue ID is the stable identifier: it also applies to owned but
  // uninstalled games, which only the catalogue knows about. The AppName by
  // contrast exists only while the game is installed — which is why it goes
  // into `launchId`. Without that split the game ID would change on
  // installation, and favourites or store choice would hang off the wrong
  // row.
  //
  // If an old manifest lacks the catalogue ID, the AppName serves as a
  // fallback — the identifier is then unstable, but the game shows up.
  const stableId =
    typeof catalogItemId === 'string' && catalogItemId !== '' ? catalogItemId : appName

  const game: RawGame = {
    storeGameId: stableId,
    name: displayName,
    installed: manifest.bIsIncompleteInstall !== true,
    launchId: appName
  }

  if (typeof manifest.InstallLocation === 'string' && manifest.InstallLocation !== '') {
    game.installPath = manifest.InstallLocation
  }
  if (typeof manifest.InstallSize === 'number' && manifest.InstallSize > 0) {
    game.installSizeBytes = manifest.InstallSize
  }

  return game
}

export async function scanEpicManifests(dir: string): Promise<RawGame[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }

  const games: RawGame[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.item')) continue
    try {
      const game = parseEpicManifest(await readFile(join(dir, entry), 'utf8'))
      if (game !== undefined) games.push(game)
    } catch {
      // Skip an unreadable manifest rather than abandoning the whole scan.
    }
  }
  return games
}
