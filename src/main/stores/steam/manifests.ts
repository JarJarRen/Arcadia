import { readdir, readFile } from 'node:fs/promises'
import { join, posix, win32 } from 'node:path'
import { parseVdf, vdfNumber, vdfObject, vdfString } from '@main/platform/vdf'
import type { RawGame } from '@shared/types'

/** StateFlags bit 4 = StateFullyInstalled. */
const STATE_FULLY_INSTALLED = 4

/**
 * Steam stores runtimes and tools as perfectly ordinary entries in
 * `steamapps` — they are indistinguishable from real games in the manifest,
 * because the `.acf` format carries no type.
 *
 * Checked on the development machine: on Windows this affects exactly one
 * entry (`Steamworks Common Redistributables`). On Linux there are notably
 * more, because every installed Proton version appears as its own entry —
 * so it matters for a dual-boot system.
 *
 * The IDs cover the stable cases, the name patterns the two families that
 * keep getting new versions. Deliberately narrow: `^Proton \d` and
 * `^Steam Linux Runtime` match no real games, whereas a bare `Proton`
 * would (there is a game called "Proton Pulse").
 *
 * From plan 3 onwards the Steam store API supplies an authoritative `type`
 * field. This heuristic then becomes redundant and can go.
 */
const NON_GAME_APP_IDS = new Set([
  '228980', // Steamworks Common Redistributables
  '1070560', // Steam Linux Runtime 1.0 (scout)
  '1391110', // Steam Linux Runtime 2.0 (soldier)
  '1628350', // Steam Linux Runtime 3.0 (sniper)
  '1493710', // Proton Experimental
  '1826330', // Proton EasyAntiCheat Runtime
  '1161040' // Proton BattlEye Runtime
])

/**
 * Name patterns for non-games.
 *
 * The first three cover Steam's own runtimes, the rest the developer extras
 * some games install alongside. All were actually observed on the
 * development machine: without them `CS:GO - SDK`,
 * `Civilization VI Development Tools`, `Development Assets` and
 * `RaceRoom Dedicated Server` sat as tiles in the library.
 *
 * Deliberately anchored rather than free-floating: `SDK` only as a standalone
 * word at the end, `Dedicated Server` and `Development Tools/Assets`
 * likewise only as a suffix. A free-floating /SDK/ would otherwise match
 * any game with those letters in its title.
 */
const NON_GAME_NAME_PATTERNS = [
  /^Proton \d/,
  /^Proton (Experimental|Hotfix)/,
  /^Steam Linux Runtime/,
  /\bSDK$/,
  /\bDedicated Server$/,
  /\bDevelopment (Tools|Assets)$/
]

function isNonGame(appId: string, name: string): boolean {
  return (
    NON_GAME_APP_IDS.has(appId) ||
    NON_GAME_NAME_PATTERNS.some((pattern) => pattern.test(name))
  )
}

/**
 * Reads the library paths out of libraryfolders.vdf.
 *
 * Two formats are in circulation: in the current one each entry is an
 * object with a "path" field, in the older one the path is the value
 * directly. Both occur on machines that have carried Steam along for years.
 */
export function parseLibraryFolders(content: string): string[] {
  let document
  try {
    document = parseVdf(content)
  } catch {
    return []
  }

  // vdfObject already looks up without regard to case and therefore finds
  // the older spelling "LibraryFolders" as well.
  const root = vdfObject(document, 'libraryfolders')
  if (root === undefined) return []

  const paths: string[] = []
  for (const [key, value] of Object.entries(root)) {
    // Only numeric keys are libraries. Everything else is bookkeeping such
    // as TimeNextStatsReport or ContentStatsID.
    if (!/^\d+$/.test(key)) continue

    if (typeof value === 'string') {
      paths.push(value)
    } else {
      const path = vdfString(value, 'path')
      if (path !== undefined) paths.push(path)
    }
  }
  return paths
}

export function parseAppManifest(content: string): RawGame | undefined {
  let document
  try {
    document = parseVdf(content)
  } catch {
    return undefined
  }

  const state = vdfObject(document, 'AppState')
  if (state === undefined) return undefined

  const appId = vdfString(state, 'appid')
  const name = vdfString(state, 'name')
  if (appId === undefined || name === undefined) return undefined

  // Steam AppIDs are always purely numeric. Checking here matters because
  // the value later travels into the launch URI handed to the operating
  // system's shell — and an .acf file may have been altered by any program
  // with write access to the Steam folder.
  if (!/^\d+$/.test(appId)) return undefined

  // Weed out runtimes and tools early so they never become a tile in the
  // library in the first place.
  if (isNonGame(appId, name)) return undefined

  const stateFlags = vdfNumber(state, 'StateFlags') ?? 0
  const lastPlayed = vdfNumber(state, 'LastPlayed')

  const game: RawGame = {
    storeGameId: appId,
    name,
    installed: (stateFlags & STATE_FULLY_INSTALLED) !== 0
  }

  const installDir = vdfString(state, 'installdir')
  if (installDir !== undefined) game.installPath = installDir

  const size = vdfNumber(state, 'SizeOnDisk')
  if (size !== undefined && size > 0) game.installSizeBytes = size

  // LastPlayed is 0 when the game was never started — better left out than
  // shown as 1 January 1970.
  if (lastPlayed !== undefined && lastPlayed > 0) game.lastPlayed = lastPlayed

  return game
}

/** Reads every installed game across all Steam libraries. */
export async function scanSteamLibraries(steamPath: string): Promise<RawGame[]> {
  const rootSteamApps = join(steamPath, 'steamapps')

  let libraryPaths: string[]
  try {
    const content = await readFile(join(rootSteamApps, 'libraryfolders.vdf'), 'utf8')
    libraryPaths = parseLibraryFolders(content)
  } catch {
    libraryPaths = []
  }

  // The main installation is not always listed in libraryfolders.vdf.
  const roots = new Set([steamPath, ...libraryPaths])
  const games = new Map<string, RawGame>()

  for (const root of roots) {
    const steamApps = join(root, 'steamapps')

    let entries: string[]
    try {
      entries = await readdir(steamApps)
    } catch {
      // Library on a disconnected drive — skip it, do not throw.
      continue
    }

    for (const entry of entries) {
      if (!entry.startsWith('appmanifest_') || !entry.endsWith('.acf')) continue

      let content: string
      try {
        content = await readFile(join(steamApps, entry), 'utf8')
      } catch {
        continue
      }

      const game = parseAppManifest(content)
      if (game === undefined) continue

      // Complete the install path.
      //
      // Valve normally writes just a folder name into `installdir`. If an
      // absolute path happens to be there, blindly joining would produce
      // nonsense such as a drive letter in the middle of a path. Both
      // platform conventions are checked, because a Windows library can be
      // read under Linux and the other way round.
      if (game.installPath !== undefined) {
        const pathIsAbsolute =
          win32.isAbsolute(game.installPath) || posix.isAbsolute(game.installPath)
        game.installPath = pathIsAbsolute
          ? game.installPath
          : join(steamApps, 'common', game.installPath)
      }

      // The same game can sit in several libraries; the installed entry
      // wins.
      const existing = games.get(game.storeGameId)
      if (existing === undefined || (!existing.installed && game.installed)) {
        games.set(game.storeGameId, game)
      }
    }
  }

  return [...games.values()]
}
