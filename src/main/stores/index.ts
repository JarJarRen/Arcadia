import type { StoreAdapter } from './types'
import { SteamAdapter, type SteamAdapterConfig } from './steam'
import { EpicAdapter } from './epic'
import { EaAdapter, type EaAdapterConfig } from './ea'
import { UbisoftAdapter } from './ubisoft'

export interface AdapterConfig {
  steam: SteamAdapterConfig
  ea?: EaAdapterConfig
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
 * Steam is the only one that needs a credential. Epic reads its manifests and
 * catalogue cache, Ubisoft the registry, and EA reads the registry plus its
 * own encrypted entitlement store — EA then asks a public catalogue service
 * for the names, which needs a connection but no sign-in. Nothing here holds
 * a store account.
 */
export function createAdapters(config: AdapterConfig): StoreAdapter[] {
  return [
    new SteamAdapter(
      config.steam,
      config.resolveSteamName === undefined ? {} : { resolveName: config.resolveSteamName }
    ),
    new EpicAdapter(),
    new EaAdapter(config.ea ?? {}),
    new UbisoftAdapter()
  ]
}

export type { StoreAdapter }
export type { EaAdapterConfig }
