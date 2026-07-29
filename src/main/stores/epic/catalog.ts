import { readFile } from 'node:fs/promises'
import type { RawGame } from '@shared/types'

/**
 * Reads Epic's catalogue cache: the owned library.
 *
 * The file `Data/Catalog/catcache.bin` holds base64-encoded JSON with every
 * entitlement of the signed-in account. On the development machine: 189
 * entries, 37 of them in the `games` category — the complete owned library,
 * while the manifests know only the 2 installed games.
 *
 * **Deliberately not Legendary.** The spec originally called for that
 * external tool plus an Epic login. The cache supplies the same thing with
 * no sign-in and no extra dependency.
 *
 * **Limits the caller has to know about:** the format is undocumented and
 * can change with any launcher update. The content is a cache — it mirrors
 * the state of the last launcher start, not necessarily current ownership.
 * That is why this function returns an empty list on any problem rather
 * than throwing: an unreadable cache must not drag the installed games
 * down with it.
 */
const GAME_CATEGORY = 'games'

interface CatalogEntry {
  id?: unknown
  title?: unknown
  categories?: unknown
  entitlementName?: unknown
  releaseInfo?: unknown
}

/**
 * Permitted shape of an Epic AppName.
 *
 * The same barrier as in the manifest branch: the identifier ends up in a
 * URI that goes to the shell.
 */
const SAFE_APP_NAME = /^[A-Za-z0-9._-]+$/

/**
 * The launch identifier from the catalogue.
 *
 * Until now it came only from the local manifest, which exists solely for
 * installed games. That left an owned but uninstalled game impossible to
 * launch or install.
 *
 * Measured on the development machine: 37 of the 39 Epic games carry it in
 * the catalogue, and for the installed ones it matches the manifest
 * identifier **exactly** (2 of 2, no divergence). It is therefore the same
 * identifier, only available earlier.
 */
function appNameFrom(releaseInfo: unknown): string | undefined {
  if (!Array.isArray(releaseInfo)) return undefined
  for (const entry of releaseInfo) {
    if (typeof entry !== 'object' || entry === null) continue
    const appId = (entry as { appId?: unknown }).appId
    if (typeof appId === 'string' && SAFE_APP_NAME.test(appId)) return appId
  }
  return undefined
}

export function parseEpicCatalog(base64: string): RawGame[] {
  let entries: unknown
  try {
    entries = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'))
  } catch {
    return []
  }
  if (!Array.isArray(entries)) return []

  const games: RawGame[] = []
  const seen = new Set<string>()

  for (const raw of entries as CatalogEntry[]) {
    if (typeof raw !== 'object' || raw === null) continue

    const id = raw.id
    const title = raw.title
    if (typeof id !== 'string' || typeof title !== 'string') continue
    if (id === '' || title === '') continue

    // `entitlementName` separates genuine ownership from merely cached
    // catalogue entries. On the development machine all 37 games carry it.
    if (typeof raw.entitlementName !== 'string' || raw.entitlementName === '') continue

    const categories = raw.categories
    if (!Array.isArray(categories)) continue
    const paths = categories
      .map((c) => (typeof c === 'object' && c !== null ? (c as { path?: unknown }).path : undefined))
      .filter((p): p is string => typeof p === 'string')
    if (!paths.includes(GAME_CATEGORY)) continue

    // The same title can appear several times in the cache, for instance as
    // a test branch ("... (Test branch)"). Deduplicate by catalogue ID.
    if (seen.has(id)) continue
    seen.add(id)

    const appName = appNameFrom(raw.releaseInfo)

    games.push({
      storeGameId: id,
      name: title,
      // What is installed is decided by the manifest scan alone.
      installed: false,
      ...(appName === undefined ? {} : { launchId: appName })
    })
  }

  return games
}

export async function readEpicCatalog(path: string): Promise<RawGame[]> {
  try {
    return parseEpicCatalog(await readFile(path, 'utf8'))
  } catch {
    return []
  }
}
