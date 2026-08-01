import { readdir, readFile } from 'node:fs/promises'
import { win32 } from 'node:path'
import { numberField, parseMessage } from './protobuf'

/**
 * The owned Ubisoft library, read locally.
 *
 * Ubisoft Connect caches the account's entitlements in
 * `cache\ownership\<accountId>`. Unlike EA's stores the file is not
 * encrypted, only signed:
 *
 * ```
 * bytes 0-3      00 01 00 00                version
 * bytes 4-259    256-byte RSA signature
 * bytes 260-263  uint32 LE payload length
 * bytes 264+     protobuf, repeated field 1 = entitlement
 * ```
 *
 * Measured on the development machine: 99 entitlements, 17 of them base
 * games and 82 add-ons, against 4 entries in the registry.
 *
 * **The signature is not verified.** There is no public key to verify it
 * with, and this is read as a local cache rather than trusted as an
 * authority: the worst a tampered file achieves is listing a game the user
 * does not own, which the store itself refuses to launch.
 */

const VERSION = Buffer.from([0x00, 0x01, 0x00, 0x00])
const SIGNATURE_LENGTH = 256
const LENGTH_OFFSET = VERSION.length + SIGNATURE_LENGTH
const PAYLOAD_OFFSET = LENGTH_OFFSET + 4

/** Field numbers inside one entitlement. */
const PRODUCT_ID = 1
/** 0 for a base entitlement, 1 for an add-on. */
const KIND = 6
const BASE_GAME = 0

/** Where Ubisoft Connect keeps its caches. */
export function ubisoftCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  const local = env.LOCALAPPDATA
  const root =
    local !== undefined && local !== ''
      ? local
      : win32.join('C:\\Users', 'Default', 'AppData', 'Local')
  // win32.join rather than the ambient one, so this stays testable on Linux.
  return win32.join(root, 'Ubisoft Game Launcher', 'cache')
}

/**
 * The numeric IDs of the owned base games.
 *
 * These are the same identifiers the registry uses under `Installs` and that
 * `uplay://launch/{id}/0` expects — confirmed for all four installed entries
 * on the development machine. Owned and installed rows therefore share one
 * key space and merge without any special handling.
 */
export function parseOwnership(file: Buffer): string[] {
  if (file.length < PAYLOAD_OFFSET) return []
  if (!file.subarray(0, VERSION.length).equals(VERSION)) return []

  const declared = file.readUInt32LE(LENGTH_OFFSET)
  const payload = file.subarray(PAYLOAD_OFFSET)
  // A length that disagrees with the file means a truncated or half-written
  // cache. Reading it anyway would produce records that are merely plausible.
  if (declared !== payload.length) return []

  const records = parseMessage(payload)
  if (records === undefined) return []

  const ids: string[] = []
  const seen = new Set<string>()
  for (const record of records) {
    if (!Buffer.isBuffer(record.value)) continue
    const fields = parseMessage(record.value)
    if (fields === undefined) continue

    if (numberField(fields, KIND) !== BASE_GAME) continue
    const id = numberField(fields, PRODUCT_ID)
    if (id === undefined || id <= 0) continue

    const key = String(id)
    if (seen.has(key)) continue
    seen.add(key)
    ids.push(key)
  }
  return ids
}

export interface OwnershipDeps {
  env?: NodeJS.ProcessEnv
  listDir?: (path: string) => Promise<string[]>
  readBytes?: (path: string) => Promise<Buffer>
}

/**
 * Reads the owned IDs for whichever account is cached here.
 *
 * The directory is named after the account, and there is normally exactly
 * one. Where there are several — a machine two people have signed in on —
 * every file is read and the results merged, because nothing local says which
 * account is the current one, and a game too many is a smaller error than a
 * library that silently belongs to the wrong person.
 */
export async function readUbisoftOwnedIds(deps: OwnershipDeps = {}): Promise<string[]> {
  const listDir = deps.listDir ?? ((path: string): Promise<string[]> => readdir(path))
  const readBytes = deps.readBytes ?? ((path: string): Promise<Buffer> => readFile(path))
  const dir = win32.join(ubisoftCacheDir(deps.env), 'ownership')

  let files: string[]
  try {
    files = await listDir(dir)
  } catch {
    return []
  }

  const ids: string[] = []
  for (const file of files) {
    try {
      for (const id of parseOwnership(await readBytes(win32.join(dir, file)))) {
        if (!ids.includes(id)) ids.push(id)
      }
    } catch {
      // An unreadable cache is no reason to abandon the others.
    }
  }
  return ids
}
