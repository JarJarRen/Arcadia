import type { AvailabilityResult, Game, RawGame } from '@shared/types'
import { t } from '@shared/i18n'
import type { StoreAdapter } from '@main/stores/types'
import type { ExecFn } from '@main/platform/registry'
import { readXboxAppPackages } from './gamingServices'
import { readInstalledPackages, type InstalledPackage } from './packages'
import { readStartAppIds } from './startApps'

export interface MicrosoftAdapterDeps {
  exec?: ExecFn
  /** Injected so the platform branch is reachable from a test on any OS. */
  platform?: string
  readXboxAppPackages?: (exec?: ExecFn) => Promise<string[]>
  readInstalledPackages?: (exec?: ExecFn) => Promise<Map<string, InstalledPackage>>
  readStartAppIds?: (exec?: ExecFn) => Promise<Map<string, string>>
}

/**
 * The application id nearly every package declares.
 *
 * Used when `Get-StartApps` reports nothing for a package — a game with no
 * Start-menu entry, or a machine where PowerShell could not be run. Wrong
 * for a handful of packages, and a wrong guess produces a failed activation
 * with a message rather than silence.
 */
const DEFAULT_APPLICATION_ID = 'App'

export class MicrosoftAdapter implements StoreAdapter {
  readonly id = 'microsoft' as const
  readonly displayName = 'Microsoft Store'

  private readonly exec: ExecFn | undefined
  private readonly platform: string
  private readonly readFamilies: NonNullable<MicrosoftAdapterDeps['readXboxAppPackages']>
  private readonly readPackages: NonNullable<MicrosoftAdapterDeps['readInstalledPackages']>
  private readonly readAumids: NonNullable<MicrosoftAdapterDeps['readStartAppIds']>

  constructor(deps: MicrosoftAdapterDeps = {}) {
    this.exec = deps.exec
    this.platform = deps.platform ?? process.platform
    this.readFamilies = deps.readXboxAppPackages ?? readXboxAppPackages
    this.readPackages = deps.readInstalledPackages ?? readInstalledPackages
    this.readAumids = deps.readStartAppIds ?? readStartAppIds
  }

  /**
   * Available on Windows, with or without a Microsoft account.
   *
   * Reporting unavailable while signed out would be the wrong kind of
   * honest: `scanOne` returns before `upsertScan` for an unavailable store,
   * so every Microsoft game already in the library would be marked
   * uninstalled the first time somebody signed out.
   */
  async isAvailable(): Promise<AvailabilityResult> {
    if (this.platform !== 'win32') {
      return { available: false, reason: t().stores.microsoft.windowsOnly }
    }
    return {
      available: true,
      limitations: [
        t().stores.microsoft.noPlaytime,
        t().stores.microsoft.noInstallSize,
        t().stores.microsoft.signedOutOnlyXboxApp
      ]
    }
  }

  async scanInstalled(): Promise<RawGame[]> {
    if (this.platform !== 'win32') return []

    const families = await this.readFamilies(this.exec)
    if (families.length === 0) return []

    // Both reads are one process each, no matter how many games there are.
    const installed = await this.readPackages(this.exec)
    const aumids = await this.readAumids(this.exec)

    const games: RawGame[] = []
    for (const family of families) {
      const found = installed.get(family)
      // Registered but not installed: uninstalling does not always clear the
      // GameConfig entry. Nothing to list and no name to list it under.
      if (found?.displayName === undefined) continue

      games.push({
        storeGameId: family,
        name: found.displayName,
        installed: true,
        ...(found.installPath === undefined ? {} : { installPath: found.installPath }),
        // The identifier that actually starts it — exactly the case
        // `launchId` exists for, as Epic's AppName already uses it.
        launchId: aumids.get(family) ?? `${family}!${DEFAULT_APPLICATION_ID}`
      })
    }
    return games
  }

  /**
   * Never reached in practice: `launchCommand` takes precedence in the
   * bridge. Present because `StoreAdapter` requires it, and it says the same
   * thing the command would.
   */
  launchUri(game: Game): string {
    throw new Error(t().stores.microsoft.notInstalledCannotLaunch(game.name))
  }

  launchCommand(game: Game): { exe: string; args: string[] } {
    // The AUMID comes from the local package data, so an owned game that is
    // not installed has none — there is genuinely nothing to start.
    if (game.launchId === undefined || game.launchId === '') {
      throw new Error(t().stores.microsoft.notInstalledCannotLaunch(game.name))
    }
    return { exe: 'explorer.exe', args: [`shell:AppsFolder\\${game.launchId}`] }
  }

  installUri(game: Game): string {
    throw new Error(t().stores.microsoft.noProductId(game.name))
  }
}
