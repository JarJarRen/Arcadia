import type { AvailabilityResult, Game, RawGame } from '@shared/types'
import { t } from '@shared/i18n'
import type { StoreAdapter } from '@main/stores/types'
import {
  findValue,
  readRegistrySubKeys,
  readRegistryValues,
  type ExecFn
} from '@main/platform/registry'

const LAUNCHER_KEY = 'HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher'
const INSTALLS_KEY = `${LAUNCHER_KEY}\\Installs`

export interface UbisoftAdapterDeps {
  exec?: ExecFn
}

/**
 * Derives the game name from the install folder.
 *
 * The registry carries **no** name, only the numeric game ID and the path —
 * verified on the development machine. Ubisoft's own `cache/configuration`
 * would be more precise but is an undocumented binary format; the effort is
 * not worth it while the folder names remain usable.
 *
 * From plan 3 onwards the Steam matching corrects remaining discrepancies,
 * and manual matching catches the rest.
 */
export function nameFromInstallDir(dir: string): string | undefined {
  const parts = dir
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .filter((part) => part !== '' && !/^[A-Za-z]:$/.test(part))
  const last = parts[parts.length - 1]
  return last === undefined || last === '' ? undefined : last
}

export class UbisoftAdapter implements StoreAdapter {
  readonly id = 'ubisoft' as const
  readonly displayName = 'Ubisoft Connect'

  private readonly exec: ExecFn | undefined

  constructor(deps: UbisoftAdapterDeps = {}) {
    this.exec = deps.exec
  }

  async isAvailable(): Promise<AvailabilityResult> {
    const values = await readRegistryValues(LAUNCHER_KEY, this.exec)
    if (findValue(values, 'InstallDir') === undefined) {
      return { available: false, reason: t().stores.ubisoft.notFound }
    }
    return {
      available: true,
      limitations: [t().stores.ubisoft.onlyInstalled, t().stores.ubisoft.namesFromFolders]
    }
  }

  async scanInstalled(): Promise<RawGame[]> {
    const games: RawGame[] = []

    for (const key of await readRegistrySubKeys(INSTALLS_KEY, this.exec)) {
      const id = key.split('\\').pop()
      if (id === undefined || !/^\d+$/.test(id)) continue

      const values = await readRegistryValues(key, this.exec)
      const dir = findValue(values, 'InstallDir')
      // Skip orphaned entries without a path — on the development machine
      // entry 7013 carries a language and nothing else.
      if (dir === undefined || dir === '') continue

      const name = nameFromInstallDir(dir)
      if (name === undefined) continue

      games.push({ storeGameId: id, name, installed: true, installPath: dir })
    }

    return games
  }

  launchUri(game: Game): string {
    if (!/^\d+$/.test(game.storeGameId)) {
      throw new Error(t().stores.ubisoft.invalidGameId(game.storeGameId))
    }
    return `uplay://launch/${game.storeGameId}/0`
  }

  installUri(game: Game): string {
    if (!/^\d+$/.test(game.storeGameId)) {
      throw new Error(t().stores.ubisoft.invalidGameId(game.storeGameId))
    }
    return `uplay://install/${game.storeGameId}`
  }
}
