import type { StoreAdapter } from './types'
import { SteamAdapter, type SteamAdapterConfig } from './steam'
import { EpicAdapter } from './epic'
import { EaAdapter, type EaAdapterConfig } from './ea'
import { UbisoftAdapter } from './ubisoft'
import { MicrosoftAdapter, type MicrosoftAdapterConfig } from './microsoft'
import type { MicrosoftSession } from './microsoft/session'
import { OtherAdapter, type OtherAdapterDeps } from './other'

export interface AdapterConfig {
  steam: SteamAdapterConfig
  ea?: EaAdapterConfig
  microsoft?: MicrosoftAdapterConfig
  /** The signed-in Microsoft account, or undefined where there is none. */
  microsoftSession?: MicrosoftSession
  /**
   * AppID to game name, from Steam's app list.
   *
   * Passes the loaded list through to the Steam adapter without the
   * adapter having to know about it: `localconfig.vdf` supplies only
   * identifiers, and a game without a name is skipped.
   */
  resolveSteamName?: (appId: number) => string | undefined
  /**
   * How the storeless store reads its own rows and checks its files.
   *
   * Required rather than optional: without it that store would report an
   * empty library on every scan, and `upsertScan` would mark every entry
   * the user had added as uninstalled.
   */
  other: OtherAdapterDeps
}

/**
 * Builds every adapter.
 *
 * Steam is the only one that needs a credential. Epic reads its manifests and
 * catalogue cache, Ubisoft the registry, and EA reads the registry plus its
 * own encrypted entitlement store — EA then asks a public catalogue service
 * for the names, which needs a connection but no sign-in. The Microsoft
 * adapter reads the registry too, and likewise needs no credential for its
 * local half. Nothing here holds a store account.
 */
export function createAdapters(config: AdapterConfig): StoreAdapter[] {
  return [
    new SteamAdapter(
      config.steam,
      config.resolveSteamName === undefined ? {} : { resolveName: config.resolveSteamName }
    ),
    new EpicAdapter(),
    new EaAdapter(config.ea ?? {}),
    new UbisoftAdapter(),
    new MicrosoftAdapter(config.microsoft ?? {}, {
      ...(config.microsoftSession === undefined ? {} : { session: config.microsoftSession })
    }),
    new OtherAdapter(config.other)
  ]
}

export type { StoreAdapter }
export type { EaAdapterConfig }
export type { OtherAdapterDeps }
