import type { StoreAdapter } from './types'
import { SteamAdapter, type SteamAdapterConfig } from './steam'
import { EpicAdapter } from './epic'
import { EaAdapter } from './ea'
import { UbisoftAdapter } from './ubisoft'

export interface AdapterConfig {
  steam: SteamAdapterConfig
  /**
   * AppID to game name, from Steam's app list.
   *
   * Passes the loaded list through to the Steam adapter without the
   * adapter having to know about it: `localconfig.vdf` supplies only
   * identifiers, and a game without a name is skipped.
   */
  resolveSteamName?: (appId: number) => string | undefined
}

/**
 * Builds every adapter.
 *
 * Only Steam needs configuration (API key and account). The other three
 * read purely locally — Epic from the manifest files, EA and Ubisoft from
 * the registry — and need no credentials at all.
 */
export function createAdapters(config: AdapterConfig): StoreAdapter[] {
  return [
    new SteamAdapter(
      config.steam,
      config.resolveSteamName === undefined ? {} : { resolveName: config.resolveSteamName }
    ),
    new EpicAdapter(),
    new EaAdapter(),
    new UbisoftAdapter()
  ]
}

export type { StoreAdapter }
