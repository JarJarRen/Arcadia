import type { AvailabilityResult, Game, RawGame } from '@shared/types'
import { t } from '@shared/i18n'
import type { StoreAdapter } from '@main/stores/types'
import type { ExecFn } from '@main/platform/registry'
import { matchOffersToInstalls, readEaInstalls, readEaOffers } from './registry'
import { readLauncherTitles } from './launcherLog'

export interface EaAdapterDeps {
  exec?: ExecFn
  readOffers?: (
    exec?: ExecFn,
    titles?: ReadonlyMap<string, string>
  ) => Promise<Array<{ offerId: string; name: string }>>
  readInstalls?: (exec?: ExecFn) => Promise<
    Array<{ name: string; installPath: string; sizeBytes?: number }>
  >
  /** Names for registry keys that carry none — see launcherLog.ts. */
  readTitles?: () => Promise<ReadonlyMap<string, string>>
}

export class EaAdapter implements StoreAdapter {
  readonly id = 'ea' as const
  readonly displayName = 'EA'

  private readonly exec: ExecFn | undefined
  private readonly readOffers: NonNullable<EaAdapterDeps['readOffers']>
  private readonly readInstalls: NonNullable<EaAdapterDeps['readInstalls']>
  private readonly readTitles: NonNullable<EaAdapterDeps['readTitles']>

  constructor(deps: EaAdapterDeps = {}) {
    this.exec = deps.exec
    this.readOffers = deps.readOffers ?? readEaOffers
    this.readInstalls = deps.readInstalls ?? readEaInstalls
    this.readTitles = deps.readTitles ?? ((): Promise<ReadonlyMap<string, string>> =>
      readLauncherTitles())
  }

  async isAvailable(): Promise<AvailabilityResult> {
    // Availability only asks whether EA is here at all; the extra names
    // would change nothing about the answer and cost two file reads.
    const offers = await this.readOffers(this.exec)
    if (offers.length === 0) {
      return { available: false, reason: t().stores.ea.notFound }
    }
    return {
      available: true,
      limitations: [
        t().stores.ea.noPublicLibraryApi,
        t().stores.ea.installStateHeuristic
      ]
    }
  }

  async scanInstalled(): Promise<RawGame[]> {
    // The titles are read first because the offers depend on them: they
    // decide whether a nameless registry key becomes a game or is dropped.
    const titles = await this.readTitles()
    const [offers, installs] = await Promise.all([
      this.readOffers(this.exec, titles),
      this.readInstalls(this.exec)
    ])
    return matchOffersToInstalls(offers, installs)
  }

  launchUri(game: Game): string {
    if (!/^\d+$/.test(game.storeGameId)) {
      throw new Error(t().stores.ea.invalidOfferId(game.storeGameId))
    }
    return `origin2://game/launch?offerIds=${game.storeGameId}`
  }

  get installNotice(): string {
    return t().stores.ea.installNotice
  }

  /**
   * Opens EA's library instead of installing.
   *
   * A first attempt used `origin2://game/download?offerId=...`. That form
   * was guessed, and it does nothing. Afterwards the installation's
   * binaries were searched: **EA Desktop knows exactly three deep links**,
   * and none of them installs.
   *
   * ```
   * origin2://game/launch/?offerIds={}
   * origin2://library/open/
   * origin2://store/open/
   * ```
   *
   * Below `game/` only `launch` and `key` exist; a verb containing
   * "install" or "download" appears in none of the 15 binaries. `link2ea://`
   * likewise knows only `launchgame`.
   *
   * Pointing `game/launch` at a game that is not installed does not help
   * either: EA Desktop then logs "not installed for offerId" and gives up.
   * So no working variant exists — hence the library plus a message that
   * explains it, rather than a button promising something the store cannot
   * do.
   */
  installUri(game: Game): string {
    if (!/^\d+$/.test(game.storeGameId)) {
      throw new Error(t().stores.ea.invalidOfferId(game.storeGameId))
    }
    return 'origin2://library/open/'
  }
}
