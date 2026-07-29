import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseVdf } from '@main/platform/vdf'

/**
 * Path to the app entries inside `localconfig.vdf`.
 *
 * The lookup ignores case: Steam is not consistent about spelling at this
 * point, and an exact comparison would find nothing depending on the file.
 * The branch would then be silently empty — not an error, just no games,
 * and nobody would work out why.
 */
const APPS_PATH = ['UserLocalConfigStore', 'Software', 'Valve', 'Steam', 'apps']

function descend(root: unknown, path: readonly string[]): unknown {
  let node = root
  for (const segment of path) {
    if (typeof node !== 'object' || node === null) return undefined
    const entries = node as Record<string, unknown>
    const key = Object.keys(entries).find(
      (candidate) => candidate.toLowerCase() === segment.toLowerCase()
    )
    if (key === undefined) return undefined
    node = entries[key]
  }
  return node
}

/**
 * App IDs that have been played on this machine.
 *
 * Only entries carrying play traces — `Playtime` or `LastPlayed`. Steam
 * also stores entries under `apps` for its own components (client,
 * screenshots, controller configurations); those carry configuration and
 * no playtime.
 *
 * This is the only local source for games `GetOwnedGames` does not report:
 * family sharing and free-to-play. On the development machine that is 45
 * IDs, of which 24 real games remain after name resolution.
 */
export function parseLocalPlayedApps(content: string): string[] {
  // A corrupted file must not drag the scan down. This source only adds to
  // things — if it fails, shared and free games are missing, but the 193
  // licensed ones still stand. A thrown error would have cost the entire
  // Steam branch.
  let root: unknown
  try {
    root = parseVdf(content)
  } catch {
    return []
  }

  const apps = descend(root, APPS_PATH)
  if (typeof apps !== 'object' || apps === null) return []

  const found: string[] = []
  for (const [appId, entry] of Object.entries(apps as Record<string, unknown>)) {
    if (!/^\d+$/.test(appId)) continue
    if (typeof entry !== 'object' || entry === null) continue

    const fields = Object.keys(entry as Record<string, unknown>).map((key) =>
      key.toLowerCase()
    )
    if (fields.includes('playtime') || fields.includes('lastplayed')) {
      found.push(appId)
    }
  }
  return found
}

/**
 * Converts a SteamID64 into the account number used by `userdata` folders.
 *
 * Steam does not store `userdata` under the 17-digit SteamID64 but under
 * its lower 32 bits. Without this conversion the signed-in account's folder
 * would not be found.
 */
export function accountIdFromSteamId64(steamId64: string): string | undefined {
  if (!/^\d{17}$/.test(steamId64)) return undefined
  // BigInt, because the ID exceeds JavaScript's safe integer range and a
  // calculation with number would lose the final digits.
  const universe = BigInt('76561197960265728')
  const account = BigInt(steamId64) - universe
  return account > 0n ? account.toString() : undefined
}

/** Reads the account's played apps; empty when the file is missing. */
export async function readLocalPlayedApps(
  steamPath: string,
  steamId64: string
): Promise<string[]> {
  const accountId = accountIdFromSteamId64(steamId64)
  if (accountId === undefined) return []

  try {
    const path = join(steamPath, 'userdata', accountId, 'config', 'localconfig.vdf')
    return parseLocalPlayedApps(await readFile(path, 'utf8'))
  } catch {
    // The file is missing for a freshly signed-in account and lives
    // elsewhere on Linux. No reason to fail the scan.
    return []
  }
}
