import type { AvailabilityResult, Game, RawGame } from '@shared/types'
import { t } from '@shared/i18n'
import type { StoreAdapter } from '@main/stores/types'
import type { ExecFn } from '@main/platform/registry'
import { readXboxAppPackages } from './gamingServices'
import { readInstalledPackages, type InstalledPackage } from './packages'
import { readStartAppIds } from './startApps'
import { readPlayedTitles, type PlayedTitle } from './titlehub'
import {
  readCatalogCache,
  resolveByPackageFamilyName,
  type CatalogEntry
} from './displayCatalog'
import type { MicrosoftSession } from './session'
import type { XboxToken } from './xbox'

export interface MicrosoftAdapterConfig {
  /**
   * Where resolved product names are cached.
   *
   * Also what `installUri` reads a ProductId back out of, so an installed
   * copy has one after the first scan rather than after the first sign-in.
   */
  catalogCachePath?: string
}

export interface MicrosoftAdapterDeps {
  exec?: ExecFn
  /** Injected so the platform branch is reachable from a test on any OS. */
  platform?: string
  session?: MicrosoftSession
  readXboxAppPackages?: (exec?: ExecFn) => Promise<string[]>
  readInstalledPackages?: (exec?: ExecFn) => Promise<Map<string, InstalledPackage>>
  readStartAppIds?: (exec?: ExecFn) => Promise<Map<string, string>>
  resolveByPackageFamilyName?: (packageFamilyNames: string[]) => Promise<CatalogEntry[]>
  readPlayedTitles?: (token: XboxToken) => Promise<PlayedTitle[]>
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
  private readonly session: MicrosoftSession | undefined
  private readonly readFamilies: NonNullable<MicrosoftAdapterDeps['readXboxAppPackages']>
  private readonly readPackages: NonNullable<MicrosoftAdapterDeps['readInstalledPackages']>
  private readonly readAumids: NonNullable<MicrosoftAdapterDeps['readStartAppIds']>
  private readonly readPlayed: NonNullable<MicrosoftAdapterDeps['readPlayedTitles']>
  private readonly resolve: NonNullable<MicrosoftAdapterDeps['resolveByPackageFamilyName']>

  /**
   * Package family name → ProductId, for `installUri`.
   *
   * `installUri` is synchronous — the interface it implements is — so it
   * cannot read a file. The index is filled by whichever scan runs first,
   * and a scan always runs at startup, so it is in place long before
   * anybody can click Install.
   */
  private productIds = new Map<string, string>()

  constructor(
    private readonly config: MicrosoftAdapterConfig = {},
    deps: MicrosoftAdapterDeps = {}
  ) {
    this.exec = deps.exec
    this.platform = deps.platform ?? process.platform
    this.session = deps.session
    this.readFamilies = deps.readXboxAppPackages ?? readXboxAppPackages
    this.readPackages = deps.readInstalledPackages ?? readInstalledPackages
    this.readAumids = deps.readStartAppIds ?? readStartAppIds
    this.readPlayed = deps.readPlayedTitles ?? ((token) => readPlayedTitles(token))
    this.resolve =
      deps.resolveByPackageFamilyName ??
      ((packageFamilyNames): Promise<CatalogEntry[]> =>
        resolveByPackageFamilyName(
          packageFamilyNames,
          this.config.catalogCachePath === undefined
            ? {}
            : { cachePath: this.config.catalogCachePath }
        ))
  }

  /**
   * The played titles, or an empty list while signed out.
   *
   * Fetched by both scan methods. Two requests per scan rather than one is
   * the price of not holding a cache with a lifetime to get wrong — and
   * `scanOwned` is only reached at all when somebody is signed in.
   *
   * Every failure answers with an empty list rather than throwing. The
   * title history *enhances* the local scan — it names which other packages
   * are games — but it is not a precondition for it, and `scanOne` awaits
   * `scanInstalled()` outside any try: a throw here escaped past
   * `repo.upsertScan`, so a refused refresh token or an unreachable Xbox
   * Live cost the user their installed games as well. The design's error
   * table says the opposite in two rows.
   */
  private async played(): Promise<PlayedTitle[]> {
    try {
      const tokens = await this.session?.tokens()
      if (tokens === undefined) return []
      return await this.readPlayed(tokens.xboxLive)
    } catch (error) {
      // Logged rather than swallowed silently: `scanOwned` reports the same
      // failure to the interface as a partial one, so nothing is hidden,
      // but a console line is what explains a suddenly shorter local list.
      console.warn('[microsoft] the title history could not be read:', error)
      return []
    }
  }

  /** Makes what the catalogue already knows available to `installUri`. */
  private remember(entries: CatalogEntry[]): void {
    for (const entry of entries) {
      this.productIds.set(entry.packageFamilyName, entry.productId)
    }
  }

  private async loadCachedProducts(): Promise<void> {
    if (this.config.catalogCachePath === undefined) return
    this.remember(await readCatalogCache(this.config.catalogCachePath))
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

    await this.loadCachedProducts()

    const fromXboxApp = await this.readFamilies(this.exec)
    // Signed in, the title list names which other packages are games. Signed
    // out there is no way to tell, and guessing would put applications in
    // somebody's library.
    const fromHistory = (await this.played()).map((title) => title.packageFamilyName)

    const families = new Set([...fromXboxApp, ...fromHistory])
    if (families.size === 0) return []

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
   * The account's games, including ones not installed here.
   *
   * **This is the title history, not an ownership record, and the difference
   * is not a shortcut.** The design called for the entitlement service to
   * decide what is owned, so that a Game Pass title played but not bought
   * would be left out. That turned out to be unbuildable: measured against
   * the live services with a real account, `collections.mp.microsoft.com`
   * is the *partner* API — a publisher asking whether a user owns *its*
   * product — and it answers a well-formed empty list for a third party no
   * matter how the request is shaped. The consumer equivalent,
   * `inventory.xboxlive.com`, refuses any token that is not first-party.
   * There is no ownership API an application like this can reach, so the
   * choice was between the title history and an empty library for ever.
   *
   * What that costs, stated plainly: a game bought and never launched does
   * not appear, because the history only knows what has been played; and a
   * Game Pass title that has been played does appear, because nothing
   * available can tell it from a purchase.
   *
   * The catalogue is still consulted, for what only it knows — the
   * ProductId that `installUri` needs, and the ProductKind that keeps an
   * application the account happens to have launched out of a game library.
   *
   * Signed out this is empty rather than an error: not being signed in is a
   * state, not a failure. Everything else throws, which `sync.ts` records as
   * a partial failure while still writing the installed games.
   */
  async scanOwned(): Promise<RawGame[]> {
    if (this.platform !== 'win32') return []
    if (this.session === undefined || !this.session.isSignedIn()) return []

    const tokens = await this.session.tokens()
    if (tokens === undefined) return []

    const played = await this.readPlayed(tokens.xboxLive)
    if (played.length === 0) return []

    // The catalogue classifies and identifies; it does not decide membership.
    // A package it has never heard of is skipped by the lookup, and one it
    // calls something other than a Game — the Xbox app itself, a media
    // app — is dropped here.
    const catalog = await this.resolve(played.map((title) => title.packageFamilyName))
    this.remember(catalog)
    const products = new Map(catalog.map((entry) => [entry.packageFamilyName, entry]))

    const games: RawGame[] = []
    for (const title of played) {
      const product = products.get(title.packageFamilyName)
      if (product === undefined) continue

      games.push({
        storeGameId: title.packageFamilyName,
        // The catalogue's title is the canonical one; the history's is the
        // fallback for a product with no localisation in this language,
        // which comes back titleless rather than absent.
        name: product.name !== '' ? product.name : title.name,
        // Whether a copy sits on this disk is `scanInstalled`'s answer, and
        // `merge` in sync.ts lets the local scan win on exactly this field.
        installed: false,
        // Xbox exposes achievements and a date, never minutes. A fabricated
        // number would be worse than an empty field.
        ...(title.lastPlayed === undefined ? {} : { lastPlayed: title.lastPlayed })
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
    const productId = this.productIds.get(game.storeGameId)
    if (productId === undefined) {
      throw new Error(t().stores.microsoft.noProductId(game.name))
    }
    return `ms-windows-store://pdp/?productid=${productId}`
  }
}
