import type { AvailabilityResult, Game, RawGame } from '@shared/types'
import { t } from '@shared/i18n'
import type { StoreAdapter } from '@main/stores/types'
import { findSteamPath } from './paths'
import { scanSteamLibraries } from './manifests'
import { readSteamAccounts, selectAccount, type SteamAccount } from './accounts'
import { fetchOwnedGames, SteamApiError } from './webApi'
import { readLocalPlayedApps } from './localConfig'

export interface SteamAdapterConfig {
  apiKey?: string
  /** Manually chosen account. Overrides the automatic selection. */
  steamId64?: string
}

/** Injection points for tests. In production every default is in force. */
export interface SteamAdapterDeps {
  findPath?: () => Promise<string | undefined>
  scanLibraries?: (steamPath: string) => Promise<RawGame[]>
  readAccounts?: (steamPath: string) => Promise<SteamAccount[]>
  fetchOwned?: (apiKey: string, steamId64: string) => Promise<RawGame[]>
  readLocalPlayed?: (steamPath: string, steamId64: string) => Promise<string[]>
  /**
   * AppID to name. Comes from the cached Steam app list.
   *
   * Without it the shared games stay out — the local file knows only
   * identifiers, and a library full of numbers would be worse than one
   * without those games.
   */
  resolveName?: (appId: number) => string | undefined
}

export class SteamAdapter implements StoreAdapter {
  readonly id = 'steam' as const
  readonly displayName = 'Steam'

  private readonly findPath: () => Promise<string | undefined>
  private readonly scanLibraries: (steamPath: string) => Promise<RawGame[]>
  private readonly readAccounts: (steamPath: string) => Promise<SteamAccount[]>
  private readonly fetchOwned: (apiKey: string, steamId64: string) => Promise<RawGame[]>
  private readonly readLocalPlayed: (steamPath: string, steamId64: string) => Promise<string[]>
  private readonly resolveName: (appId: number) => string | undefined

  /**
   * Steam path cached for the duration of one scan.
   *
   * On Windows `findSteamPath` starts a `reg query` process. Without this
   * cache that would happen three times per scan: `isAvailable`,
   * `scanInstalled` and the SteamID resolution each ask separately.
   */
  private cachedPath: Promise<string | undefined> | undefined

  constructor(
    private readonly config: SteamAdapterConfig,
    deps: SteamAdapterDeps = {}
  ) {
    this.findPath = deps.findPath ?? ((): Promise<string | undefined> => findSteamPath())
    this.scanLibraries = deps.scanLibraries ?? scanSteamLibraries
    this.readAccounts = deps.readAccounts ?? readSteamAccounts
    this.fetchOwned =
      deps.fetchOwned ??
      ((apiKey, steamId64): Promise<RawGame[]> => fetchOwnedGames({ apiKey, steamId64 }))
    this.readLocalPlayed = deps.readLocalPlayed ?? readLocalPlayedApps
    // Without a name source the branch stays off. Not an error — the app
    // list is only cached after the first start.
    this.resolveName = deps.resolveName ?? ((): undefined => undefined)
  }

  /** Resolves the path at most once per scan. */
  private steamPath(): Promise<string | undefined> {
    this.cachedPath ??= this.findPath()
    return this.cachedPath
  }

  async isAvailable(): Promise<AvailabilityResult> {
    // `isAvailable` is the first call of every scan — the cache is renewed
    // here so that a Steam installation or removal in the meantime shows up
    // on the next pass.
    this.cachedPath = this.findPath()
    const steamPath = await this.cachedPath
    if (steamPath === undefined) {
      return { available: false, reason: t().stores.steam.notFound }
    }

    const limitations: string[] = []
    if (this.config.apiKey === undefined || this.config.apiKey === '') {
      limitations.push(t().stores.steam.noApiKey)
    }

    return { available: true, limitations }
  }

  async scanInstalled(): Promise<RawGame[]> {
    const steamPath = await this.steamPath()
    if (steamPath === undefined) return []
    return this.scanLibraries(steamPath)
  }

  async scanOwned(): Promise<RawGame[]> {
    const apiKey = this.config.apiKey
    if (apiKey === undefined || apiKey === '') return []

    const steamId64 = await this.resolveSteamId()
    if (steamId64 === undefined) return []

    let owned: RawGame[]
    try {
      owned = await this.fetchOwned(apiKey, steamId64)
    } catch (error) {
      // Pass upwards so sync.ts can show the cause to the user — a private
      // profile needs a different hint than a wrong key.
      if (error instanceof SteamApiError) throw error
      throw new SteamApiError('unexpected', t().stores.steam.libraryFailed)
    }

    return [...owned, ...(await this.scanSharedOrFree(steamId64, owned))]
  }

  /**
   * Games played here that the API does not know about.
   *
   * `GetOwnedGames` reports only what is licensed. On the development
   * machine that is 193, while Steam's own interface shows 226. The gap
   * sits locally in `localconfig.vdf` — 45 app IDs measured, of which 24
   * real games remain after name resolution, among them Anno 1800, Stardew
   * Valley and Team Fortress 2.
   *
   * Added, never substituted: what the API reports wins. A game present in
   * both sources is licensed and is not marked.
   */
  private async scanSharedOrFree(steamId64: string, owned: RawGame[]): Promise<RawGame[]> {
    const steamPath = await this.steamPath()
    if (steamPath === undefined) return []

    const known = new Set(owned.map((game) => game.storeGameId))
    const result: RawGame[] = []

    for (const appId of await this.readLocalPlayed(steamPath, steamId64)) {
      if (known.has(appId)) continue

      // Without a resolvable name the game is skipped. An entry reading
      // "Unknown game (413150)" would be worse than none — and the side
      // effect is welcome: Steam's own components (client, screenshots,
      // controller configurations) are not in the games list and drop out
      // by themselves.
      const name = this.resolveName(Number.parseInt(appId, 10))
      if (name === undefined || name === '') continue

      result.push({ storeGameId: appId, name, installed: false, sharedOrFree: true })
    }
    return result
  }

  launchUri(game: Game): string {
    // Last barrier before the shell. Both read paths already validate, but
    // this string ends up at the operating system — and a value from the
    // database may come from an older, not yet validated version.
    if (!/^\d+$/.test(game.storeGameId)) {
      throw new Error(t().stores.steam.invalidAppId(game.storeGameId))
    }
    return `steam://rungameid/${game.storeGameId}`
  }

  installUri(game: Game): string {
    if (!/^\d+$/.test(game.storeGameId)) {
      throw new Error(t().stores.steam.invalidAppId(game.storeGameId))
    }
    // Opens Steam's install dialog. Works for family-shared games too —
    // Steam decides for itself whether it is allowed.
    return `steam://install/${game.storeGameId}`
  }

  /** A manually chosen account beats the automatic selection. */
  private async resolveSteamId(): Promise<string | undefined> {
    if (this.config.steamId64 !== undefined && this.config.steamId64 !== '') {
      return this.config.steamId64
    }
    const steamPath = await this.steamPath()
    if (steamPath === undefined) return undefined
    return selectAccount(await this.readAccounts(steamPath))?.steamId64
  }
}
