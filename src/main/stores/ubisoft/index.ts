import type { AvailabilityResult, Game, RawGame } from '@shared/types'
import { t } from '@shared/i18n'
import type { StoreAdapter } from '@main/stores/types'
import {
  findValue,
  readRegistrySubKeys,
  readRegistryValues,
  type ExecFn
} from '@main/platform/registry'
import { readUbisoftOwnedIds } from './ownership'
import { readUbisoftCatalogue } from './configuration'

const LAUNCHER_KEY = 'HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher'
const INSTALLS_KEY = `${LAUNCHER_KEY}\\Installs`

export interface UbisoftAdapterDeps {
  exec?: ExecFn
  /** Owned numeric IDs from the launcher's ownership cache. */
  readOwnedIds?: () => Promise<string[]>
  /** Numeric ID to name, from the launcher's configuration cache. */
  readCatalogue?: (locale: string) => Promise<Map<string, string>>
}

/**
 * Derives the game name from the install folder.
 *
 * A fallback now rather than the only option. The registry carries no name,
 * and until the configuration cache was readable the folder was all there
 * was — which produced whatever the folder happened to be called.
 *
 * Still worth keeping: a game installed while its configuration is missing
 * from the cache would otherwise vanish from a library it used to be in.
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
  private readonly readOwnedIds: NonNullable<UbisoftAdapterDeps['readOwnedIds']>
  private readonly readCatalogue: NonNullable<UbisoftAdapterDeps['readCatalogue']>

  constructor(deps: UbisoftAdapterDeps = {}) {
    this.exec = deps.exec
    this.readOwnedIds = deps.readOwnedIds ?? ((): Promise<string[]> => readUbisoftOwnedIds())
    this.readCatalogue =
      deps.readCatalogue ??
      ((locale): Promise<Map<string, string>> => readUbisoftCatalogue(locale))
  }

  /** Names in the interface language, falling back to the catalogue default. */
  private catalogue(): Promise<Map<string, string>> {
    return this.readCatalogue(t().format.locale)
  }

  async isAvailable(): Promise<AvailabilityResult> {
    const values = await readRegistryValues(LAUNCHER_KEY, this.exec)
    if (findValue(values, 'InstallDir') === undefined) {
      return { available: false, reason: t().stores.ubisoft.notFound }
    }
    return {
      available: true,
      limitations: [t().stores.ubisoft.ownedFromLocalCache]
    }
  }

  async scanInstalled(): Promise<RawGame[]> {
    const games: RawGame[] = []
    const names = await this.catalogue()

    for (const key of await readRegistrySubKeys(INSTALLS_KEY, this.exec)) {
      const id = key.split('\\').pop()
      if (id === undefined || !/^\d+$/.test(id)) continue

      const values = await readRegistryValues(key, this.exec)
      const dir = findValue(values, 'InstallDir')
      // Skip orphaned entries without a path — on the development machine
      // entry 7013 carries a language and nothing else.
      if (dir === undefined || dir === '') continue

      // The catalogue name is the real title; the folder is the fallback.
      const name = names.get(id) ?? nameFromInstallDir(dir)
      if (name === undefined) continue

      games.push({ storeGameId: id, name, installed: true, installPath: dir })
    }

    return games
  }

  /**
   * The owned library, including games not installed here.
   *
   * Both halves are local files the launcher writes: ownership.ts says which
   * numeric IDs are owned, configuration.ts puts a name to each. No sign-in
   * and no network — which is why, unlike EA, nothing here can throw. Every
   * failure downgrades to an empty list and leaves the registry scan alone.
   *
   * The IDs are the ones the registry uses, so `merge` in sync.ts unites the
   * two without a second row for a game that is both owned and installed.
   */
  async scanOwned(): Promise<RawGame[]> {
    const ids = await this.readOwnedIds()
    if (ids.length === 0) return []

    const names = await this.catalogue()
    const games: RawGame[] = []
    for (const id of ids) {
      // An owned game the catalogue cannot name is left out: entry 856 is
      // called "GAMENAME" there, and a row saying that would be worse than
      // no row. Adding it by hand remains possible.
      const name = names.get(id)
      if (name === undefined) continue
      games.push({ storeGameId: id, name, installed: false })
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
