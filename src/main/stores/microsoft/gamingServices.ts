import { readRegistrySubKeys, type ExecFn } from '@main/platform/registry'

/**
 * Where the Xbox app records what it installed.
 *
 * Under HKLM rather than HKCU: Gaming Services is a system service, and the
 * games it installs are machine-wide.
 */
const GAME_CONFIG_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\GamingServices\\GameConfig'

/**
 * The package family names of games the Xbox app installed.
 *
 * The only local source that can distinguish a game from an app without
 * asking a server. A plain package listing cannot: Paint, the Xbox app and
 * the 3D Viewer are all Store-signed, and a heuristic over publishers or
 * install locations would sooner or later put an application in somebody's
 * game library. Everything else Arcadia lists comes from the account's own
 * title list, which names its packages explicitly.
 *
 * Only the names are read. The install path comes from the package
 * repository in `packages.ts`, which is one query for every package rather
 * than one per game, and whose value names have actually been verified.
 */
export async function readXboxAppPackages(exec?: ExecFn): Promise<string[]> {
  const keys = await readRegistrySubKeys(GAME_CONFIG_KEY, exec)

  const names: string[] = []
  for (const key of keys) {
    const name = key.split('\\').pop()
    // A package family name is always `<name>_<publisherId>`. Anything
    // without the suffix is a settings key, not a game.
    if (name === undefined || !name.includes('_')) continue
    names.push(name)
  }
  return names
}
