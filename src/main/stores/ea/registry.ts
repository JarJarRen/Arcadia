import type { RawGame } from '@shared/types'
import {
  findValue,
  readRegistrySubKeys,
  readRegistryTree,
  readRegistryValues,
  type ExecFn
} from '@main/platform/registry'

const ORIGIN_GAMES_KEY = 'HKLM\\SOFTWARE\\WOW6432Node\\Origin Games'
const UNINSTALL_KEYS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
]

export interface EaOffer {
  offerId: string
  name: string
}

export interface EaInstall {
  name: string
  installPath: string
  sizeBytes?: number
}

/**
 * Normalises a game name for matching across the two registry trees.
 *
 * Necessary because the same games are spelled differently there — checked
 * on the development machine: "STAR WARS Jedi**:** Fallen Order™" in the
 * Origin registry against "STAR WARS Jedi **-** Fallen Order™" in the
 * uninstall registry.
 */
export function normalizeForMatch(name: string): string {
  return name
    .replace(/[™®©]/g, '')
    .toLowerCase()
    .replace(/[:\-–—_,.'’`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Links the offers from the Origin registry to the install paths from the
 * uninstall registry.
 *
 * The Origin registry carries **no** install path, the uninstall registry
 * **no** offer ID. The only connecting element is the name, and it does not
 * match literally.
 *
 * First an exact comparison on the normalised name, then a prefix
 * comparison — Origin likes to append edition labels ("… FC 26 The World's
 * Game Edition" against "EA SPORTS FC 26"). Each install is handed out at
 * most once, so that one offer cannot claim another's installation.
 */
export function matchOffersToInstalls(
  offers: EaOffer[],
  installs: EaInstall[]
): RawGame[] {
  const available = installs.map((install) => ({
    ...install,
    key: normalizeForMatch(install.name)
  }))
  const taken = new Set<number>()

  const find = (offerKey: string, exact: boolean): number => {
    for (let i = 0; i < available.length; i++) {
      if (taken.has(i)) continue
      const key = available[i]!.key
      if (exact ? key === offerKey : offerKey.startsWith(`${key} `)) return i
    }
    return -1
  }

  const games: RawGame[] = []
  const pending: Array<{ offer: EaOffer; key: string; index: number }> = []

  // Hand out every exact match first, then the prefix matches — otherwise a
  // prefix match could take an installation that would have matched another
  // offer exactly.
  for (const offer of offers) {
    const key = normalizeForMatch(offer.name)
    const index = find(key, true)
    if (index !== -1) taken.add(index)
    pending.push({ offer, key, index })
  }

  for (const entry of pending) {
    if (entry.index === -1) {
      entry.index = find(entry.key, false)
      if (entry.index !== -1) taken.add(entry.index)
    }

    const match = entry.index === -1 ? undefined : available[entry.index]
    const game: RawGame = {
      storeGameId: entry.offer.offerId,
      // The Origin name is the more complete one and is kept.
      name: entry.offer.name,
      installed: match !== undefined
    }
    if (match !== undefined) {
      game.installPath = match.installPath
      if (match.sizeBytes !== undefined) game.installSizeBytes = match.sizeBytes
    }
    games.push(game)
  }

  return games
}

/**
 * Reads the offers from the Origin registry.
 *
 * `titles` supplies names for keys the registry leaves empty — see
 * launcherLog.ts. It only fills gaps: the registry is authoritative and
 * current, while the log records whatever a game was called when it was
 * last launched, which for a yearly series is a season out of date.
 *
 * A title is never enough on its own. The registry decides which games
 * exist; the log reaches further back and still names things EA has since
 * forgotten, and inventing entries from it would put games in the library
 * that no store knows about any more.
 */
export async function readEaOffers(
  exec?: ExecFn,
  titles?: ReadonlyMap<string, string>
): Promise<EaOffer[]> {
  const offers: EaOffer[] = []
  for (const key of await readRegistrySubKeys(ORIGIN_GAMES_KEY, exec)) {
    const offerId = key.split('\\').pop()
    if (offerId === undefined) continue

    // Showcase variants share the base ID with an _sc suffix and are not a
    // game of their own — found as 16425677_sc on the development machine.
    if (offerId.endsWith('_sc')) continue
    if (!/^\d+$/.test(offerId)) continue

    const values = await readRegistryValues(key, exec)
    const registryName = findValue(values, 'DisplayName')
    // Of 20 keys, only 5 carry any values at all on the development
    // machine. The rest used to be dropped outright; now the launcher log
    // gets a chance to name them first.
    const name =
      registryName !== undefined && registryName !== ''
        ? registryName
        : titles?.get(offerId)
    if (name === undefined || name === '') continue

    offers.push({ offerId, name })
  }
  return offers
}

/**
 * Reads EA installations from the uninstall registry.
 *
 * **One** recursive call rather than a query per subkey: several hundred
 * entries sit under `Uninstall`, and every query starts its own `reg.exe`
 * process. Queried one by one, the scan took minutes instead of seconds.
 *
 * `readRegistryTree` returns the blocks already split and parsed.
 */
export async function readEaInstalls(exec?: ExecFn): Promise<EaInstall[]> {
  const installs: EaInstall[] = []
  for (const root of UNINSTALL_KEYS) {
    for (const values of await readRegistryTree(root, exec)) {
      const name = findValue(values, 'DisplayName')
      const path = findValue(values, 'InstallLocation')
      if (name === undefined || path === undefined || path === '') continue

      // Only entries that recognisably come from EA.
      const everything = Object.values(values).join(' ')
      if (!/EAInstaller|Electronic Arts|EA Desktop|Origin/i.test(everything)) continue
      if (name === 'EA app') continue

      const install: EaInstall = { name, installPath: path }
      const size = findValue(values, 'EstimatedSize')
      if (size !== undefined) {
        // EstimatedSize is stored as a hex value in kilobytes.
        const kb = Number.parseInt(size.replace(/^0x/i, ''), 16)
        if (Number.isFinite(kb) && kb > 0) install.sizeBytes = kb * 1024
      }
      installs.push(install)
    }
  }
  return installs
}
