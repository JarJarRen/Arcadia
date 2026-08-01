import { readdir, readFile } from 'node:fs/promises'
import { win32 } from 'node:path'
import { decryptStore, scopeDirectory } from './crypto'
import { readHardwareString } from './hardware'
import type { ExecFn } from '@main/platform/registry'

/**
 * The owned EA library, read locally.
 *
 * EA Desktop caches the account's entitlements in a per-user store called
 * `NS`. Decrypted on the development machine it holds 53 entitlements across
 * 34 distinct offers — against 20 keys in the `Origin Games` registry, of
 * which only 5 carry a name. This is the whole purchased library, including
 * games that were never installed here, and it needs no sign-in.
 *
 * **What it does not hold is names.** Entitlements carry `Origin.OFR.*`
 * identifiers and nothing readable. See catalog.ts for the other half.
 *
 * The cache is written when the EA app signs in, so it reflects that moment
 * rather than this one. A purchase made elsewhere since then shows up after
 * EA Desktop next starts.
 */

/** Where EA keeps its machine-wide stores. */
export function eaProgramDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.ProgramData ?? env.ALLUSERSPROFILE
  return win32.join(root !== undefined && root !== '' ? root : 'C:\\ProgramData', 'EA Desktop')
}

/**
 * Where EA keeps the per-user settings files.
 *
 * The same base as the launcher log in launcherLog.ts, one level up. Kept
 * separate rather than shared, because the log path is a detail of that
 * module and joining the two would tie them together for no gain.
 */
export function eaUserDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const local = env.LOCALAPPDATA
  const root =
    local !== undefined && local !== ''
      ? local
      : win32.join('C:\\Users', 'Default', 'AppData', 'Local')
  // win32.join rather than the ambient one, so this stays testable on Linux.
  return win32.join(root, 'Electronic Arts', 'EA Desktop')
}

/**
 * Nucleus user IDs from a `user_*.ini`.
 *
 * These files are a few hundred bytes and hold `user.userid` outright. The
 * ID also appears in `EADesktopVerbose.log`, which was how it was first
 * found — but verbose logging can be switched off, and scanning 8.5 MB for
 * something an INI states plainly would be the wrong way round.
 */
export function parseUserIds(ini: string): string[] {
  const ids: string[] = []
  for (const match of ini.matchAll(/user\.userid\s*=\s*(\d{4,20})/gi)) {
    const id = match[1]
    if (id !== undefined && !ids.includes(id)) ids.push(id)
  }
  return ids
}

/**
 * Picks the user ID whose stores are actually on this machine.
 *
 * A store's directory is `SHA3-256(userId)`, so a candidate can be checked
 * rather than trusted: only one that hashes to a directory that exists is
 * accepted. That turns a guess into a verified fact and makes the failure
 * mode "no owned games" instead of "decrypting the wrong thing".
 */
export function findUserScope(
  candidates: Iterable<string>,
  directories: Iterable<string>
): string | undefined {
  const present = new Set(directories)
  for (const candidate of candidates) {
    if (present.has(scopeDirectory(candidate))) return candidate
  }
  return undefined
}

interface RawEntitlement {
  offerId?: unknown
}

/**
 * The distinct offer IDs from a decrypted `NS`.
 *
 * Deduplicated because one game holds several entitlements — the base
 * download, online access, and separate ones for pre-order or points packs.
 * What kind each is cannot be decided here; the catalogue decides that.
 */
export function parseEntitlementOffers(json: string): string[] {
  let payload: unknown
  try {
    payload = JSON.parse(json)
  } catch {
    return []
  }

  const entitlements = (payload as { entitlements?: unknown } | null)?.entitlements
  if (!Array.isArray(entitlements)) return []

  const offers: string[] = []
  const seen = new Set<string>()
  for (const raw of entitlements as RawEntitlement[]) {
    if (typeof raw !== 'object' || raw === null) continue
    const offerId = raw.offerId
    if (typeof offerId !== 'string' || offerId === '') continue
    if (seen.has(offerId)) continue
    seen.add(offerId)
    offers.push(offerId)
  }
  return offers
}

export interface EaEntitlementDeps {
  env?: NodeJS.ProcessEnv
  exec?: ExecFn
  listDir?: (path: string) => Promise<string[]>
  readText?: (path: string) => Promise<string>
  readBytes?: (path: string) => Promise<Buffer>
  hardware?: () => Promise<string | undefined>
}

/** The per-user store that holds the entitlements. */
const ENTITLEMENT_STORE = 'NS'

/**
 * Reads the owned offer IDs.
 *
 * Returns an empty list for every local problem rather than throwing. None of
 * them — EA not installed, logging off, a scheme EA has since changed — is a
 * reason to fail the scan and drop the installed games with it.
 */
export async function readEaOwnedOffers(deps: EaEntitlementDeps = {}): Promise<string[]> {
  const env = deps.env ?? process.env
  const listDir = deps.listDir ?? ((path: string): Promise<string[]> => readdir(path))
  const readText =
    deps.readText ?? ((path: string): Promise<string> => readFile(path, 'utf8'))
  const readBytes = deps.readBytes ?? ((path: string): Promise<Buffer> => readFile(path))
  const hardware = deps.hardware ?? ((): Promise<string | undefined> => readHardwareString(deps.exec))

  const fingerprint = await hardware()
  if (fingerprint === undefined) return []

  const userDir = eaUserDataDir(env)
  let files: string[]
  try {
    files = await listDir(userDir)
  } catch {
    return []
  }

  const candidates: string[] = []
  for (const file of files) {
    if (!/^user_.*\.ini$/i.test(file)) continue
    try {
      for (const id of parseUserIds(await readText(win32.join(userDir, file)))) {
        if (!candidates.includes(id)) candidates.push(id)
      }
    } catch {
      // One unreadable settings file is no reason to give up on the others.
    }
  }
  if (candidates.length === 0) return []

  const root = eaProgramDataDir(env)
  let directories: string[]
  try {
    directories = await listDir(root)
  } catch {
    return []
  }

  const scope = findUserScope(candidates, directories)
  if (scope === undefined) return []

  let file: Buffer
  try {
    file = await readBytes(win32.join(root, scopeDirectory(scope), ENTITLEMENT_STORE))
  } catch {
    return []
  }

  const plain = decryptStore(file, {
    scope,
    contentId: ENTITLEMENT_STORE,
    hardware: fingerprint
  })
  return plain === undefined ? [] : parseEntitlementOffers(plain)
}
