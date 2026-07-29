import { readFile } from 'node:fs/promises'
import { win32 } from 'node:path'

/**
 * Names for EA games the registry does not name.
 *
 * The `Origin Games` registry is the only local list of EA content ids, and
 * on this machine 15 of its 20 keys are completely empty — no DisplayName,
 * no values at all. Those games are invisible to Arcadia, and EA offers no
 * interface that would reveal them.
 *
 * One local source does pair an id with a readable name: EA's own launcher
 * writes the title into the URI it hands to its helper process, and that
 * line lands in `EALauncher.log`.
 *
 * ```
 * origin2://game/launch/?offerIds=198235&title=EA%u0020SPORTS%u0020FC%u002024
 * ```
 *
 * **The reach is limited and worth stating plainly:** only games that have
 * actually been launched appear, because that is the only moment EA writes
 * the title down. Measured on the development machine, that recovered
 * exactly one of the 15 nameless entries. It grows by itself over time —
 * every EA game launched from then on names itself — but it will never
 * reach a game that was never started here.
 */

/** Where EA's launcher writes its log. */
export function eaLauncherLogDir(env: NodeJS.ProcessEnv = process.env): string {
  const local = env.LOCALAPPDATA
  const root =
    local !== undefined && local !== ''
      ? local
      : win32.join('C:\\Users', 'Default', 'AppData', 'Local')
  // win32.join, not the ambient join: on Linux the latter would mix
  // separators and make this branch untestable there — the same reason as
  // in epic/paths.ts.
  return win32.join(root, 'Electronic Arts', 'EA Desktop', 'Logs')
}

/** The files worth reading, newest first. */
export const EA_LAUNCHER_LOGS = ['EALauncher.log', 'EALauncher.bak'] as const

/**
 * EA's own placeholder when it cannot find a name either.
 *
 * Written verbatim into the title field, so without this check the library
 * would show a game called "DisplayName field missing from registry" —
 * found in the log from 2023 on the development machine.
 */
const PLACEHOLDER = /displayname\s*field\s*missing/i

/**
 * Decodes the title EA writes.
 *
 * Two encodings in one field: `%uXXXX` for anything non-ASCII, which is a
 * JScript-era form that `decodeURIComponent` does not understand, and
 * ordinary percent escapes for the rest.
 */
function decodeTitle(raw: string): string | undefined {
  const widened = raw.replace(/%u([0-9a-fA-F]{4})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16))
  )
  try {
    return decodeURIComponent(widened).trim()
  } catch {
    // A stray percent sign makes decodeURIComponent throw. Losing one name
    // is acceptable; losing the whole scan for it is not.
    return undefined
  }
}

/**
 * Content id to game name, mined from a launcher log.
 *
 * Later entries win: a game renamed between seasons — FIFA 23 becoming EA
 * SPORTS FC 24 — should show up under the name it was last launched with.
 */
export function parseLauncherTitles(log: string): Map<string, string> {
  const titles = new Map<string, string>()

  for (const match of log.matchAll(/offerIds?=([A-Za-z0-9.]+)&title=([^&\s'"\]]+)/g)) {
    const id = match[1]
    const raw = match[2]
    if (id === undefined || raw === undefined) continue

    const title = decodeTitle(raw)
    if (title === undefined || title === '') continue
    if (PLACEHOLDER.test(title)) continue

    titles.set(id, title)
  }

  return titles
}

/** Reads the launcher logs and merges what they name. */
export async function readLauncherTitles(
  env?: NodeJS.ProcessEnv
): Promise<Map<string, string>> {
  const dir = eaLauncherLogDir(env)
  const titles = new Map<string, string>()

  for (const file of EA_LAUNCHER_LOGS) {
    let text: string
    try {
      text = await readFile(win32.join(dir, file), 'utf8')
    } catch {
      // No log, no launcher, no permission — all mean the same here: no
      // extra names. Never a reason to fail the scan.
      continue
    }
    for (const [id, title] of parseLauncherTitles(text)) titles.set(id, title)
  }

  return titles
}
