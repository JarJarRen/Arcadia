/**
 * The preload bridge, faked.
 *
 * Every component that writes anything goes through `window.arcadia`, and
 * under jsdom there is no preload script to define it — a component under
 * test would throw on `undefined`.
 *
 * A .tsx rather than a .ts only because it touches `window`: the extension
 * is what puts a file on the DOM side of the tsconfig split, where the DOM
 * lib exists. The library builders stay in test/fixtures/library.ts, which
 * both projects can read, and are re-exported here so a component test
 * needs one import rather than two.
 */
import type { ArcadiaApi } from '@shared/ipc'
import { STORE_IDS } from '@shared/types'

export { entry, game } from '../fixtures/library'

/**
 * Installs a complete `window.arcadia`.
 *
 * Complete rather than partial: a component reaching a channel the test
 * forgot to stub should fail on the assertion, not on `undefined is not a
 * function`, which says nothing about what went wrong.
 */
export function stubArcadia(overrides: Partial<ArcadiaApi> = {}): ArcadiaApi {
  const api: ArcadiaApi = {
    getGames: async () => [],
    sync: async () =>
      ({ stores: [], totalGames: 0 }) as Awaited<ReturnType<ArcadiaApi['sync']>>,
    launch: async () => ({ ok: true }),
    install: async () => ({ ok: true }),
    cancelInstall: async () => undefined,
    setFavorite: async () => undefined,
    setPreferredStore: async () => undefined,
    setSplit: async () => undefined,
    openFolder: async () => ({ ok: true }),
    searchApps: async () => [],
    setMatch: async () => ({ ok: true }),
    getLanguage: async () => 'en',
    setLanguage: async () => undefined,
    getEnabledStores: async () => [...STORE_IDS],
    setEnabledStores: async () => undefined,
    getStoreAvailability: async () => ({}),
    isSecureStorageAvailable: async () => true,
    getEnvConfig: async () =>
      ({
        values: { STEAM_WEB_API_KEY: '', STEAM_ID64: '', STEAMGRIDDB_API_KEY: '' },
        done: true,
        path: 'C:\\test\\.env'
      }) as Awaited<ReturnType<ArcadiaApi['getEnvConfig']>>,
    saveEnvConfig: async () => ({ ok: true, restarting: false }),
    addManualGame: async () => ({ ok: true, id: 'steam:manual-1' }),
    removeManualGame: async () => ({ ok: true }),
    reportBrokenArtwork: async () => undefined,
    isScanning: async () => false,
    getStartupNotice: async () => undefined,
    onScanningChanged: () => () => undefined,
    onLibraryChanged: () => () => undefined,
    onNavigateBack: () => () => undefined,
    onNavigateForward: () => () => undefined,
    getMicrosoftAuth: async () => ({ signedIn: false }),
    signInToMicrosoft: async () => ({ ok: false, error: 'not configured' }),
    signOutOfMicrosoft: async () => undefined,
    onMicrosoftAuthChanged: () => () => undefined,
    getFreebies: async () => ({ current: [], upcoming: [], failures: [] }),
    refreshFreebies: async () => ({ current: [], upcoming: [], failures: [] }),
    claimFreebie: async () => ({ ok: true }),
    onFreebiesChanged: () => () => undefined,
    ...overrides
  }

  window.arcadia = api
  return api
}
