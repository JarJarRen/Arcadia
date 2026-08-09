/**
 * The preload script is a pure channel-mapping table: every `ArcadiaApi`
 * method calls `ipcRenderer.invoke` (or `.on`/`.removeListener`) on one
 * specific `IPC.*` channel. TypeScript checks that each method matches
 * `ArcadiaApi`'s signature, but it checks nothing about which channel a
 * method actually invokes — `launch` calling `IPC.gameInstall` instead of
 * `IPC.gameLaunch` would compile and silently make "Play" install the game.
 * This file is the guard against that, one row per method.
 *
 * Same harness shape as ipc-validation.test.ts: recording arrays declared
 * first, `electron` mocked around them, then the module under test dynamic-
 * imported so the mock is already in place when it evaluates.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArcadiaApi } from '@shared/ipc'

interface InvokeCall {
  channel: string
  args: unknown[]
}

interface ListenerCall {
  channel: string
  listener: (...args: unknown[]) => void
}

const exposeCalls: Array<{ key: string; api: unknown }> = []
const invokeCalls: InvokeCall[] = []
const onCalls: ListenerCall[] = []
const removeListenerCalls: ListenerCall[] = []

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, api: unknown) => {
      exposeCalls.push({ key, api })
    }
  },
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => {
      invokeCalls.push({ channel, args })
      return Promise.resolve(undefined)
    },
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      onCalls.push({ channel, listener })
    },
    removeListener: (channel: string, listener: (...args: unknown[]) => void) => {
      removeListenerCalls.push({ channel, listener })
    }
  }
}))

// The module has a side effect on import (calling exposeInMainWorld), so it
// must load after the electron mock is registered above.
await import('../../src/preload/index')
const { IPC } = await import('@shared/ipc')

describe('preload bridge', () => {
  it('is exposed under the "arcadia" key, exactly once', () => {
    expect(exposeCalls).toHaveLength(1)
    expect(exposeCalls[0]?.key).toBe('arcadia')
    expect(exposeCalls[0]?.api).toBeTruthy()
  })

  const api = exposeCalls[0]?.api as ArcadiaApi

  /**
   * One row per invoke-based method on `ArcadiaApi` — 16 of them. Every
   * argument is a distinct literal per row, so a channel that leaked
   * another row's argument would also fail the "unchanged, in order"
   * assertion, not just the channel one.
   */
  const INVOKE_TABLE: Array<{ name: string; channel: string; args: unknown[]; call: () => unknown }> = [
    { name: 'getGames', channel: IPC.libraryGet, args: [], call: () => api.getGames() },
    { name: 'sync', channel: IPC.librarySync, args: [], call: () => api.sync() },
    {
      name: 'launch',
      channel: IPC.gameLaunch,
      args: ['game-launch-id'],
      call: () => api.launch('game-launch-id')
    },
    {
      name: 'install',
      channel: IPC.gameInstall,
      args: ['game-install-id'],
      call: () => api.install('game-install-id')
    },
    {
      name: 'cancelInstall',
      channel: IPC.gameInstallCancel,
      args: [],
      call: () => api.cancelInstall()
    },
    {
      name: 'setFavorite',
      channel: IPC.gameSetFavorite,
      args: ['merge-favorite', true],
      call: () => api.setFavorite('merge-favorite', true)
    },
    {
      name: 'setPreferredStore',
      channel: IPC.mergeSetPreferred,
      args: ['merge-preferred', 'steam-store-id'],
      call: () => api.setPreferredStore('merge-preferred', 'steam-store-id')
    },
    {
      name: 'setSplit',
      channel: IPC.mergeSetSplit,
      args: ['merge-split', false],
      call: () => api.setSplit('merge-split', false)
    },
    {
      name: 'openFolder',
      channel: IPC.gameOpenFolder,
      args: ['merge-open-folder'],
      call: () => api.openFolder('merge-open-folder')
    },
    {
      name: 'searchApps',
      channel: IPC.metadataSearch,
      args: ['half life'],
      call: () => api.searchApps('half life')
    },
    {
      name: 'setMatch',
      channel: IPC.metadataSetMatch,
      args: ['merge-set-match', 440],
      call: () => api.setMatch('merge-set-match', 440)
    },
    {
      name: 'getLanguage',
      channel: IPC.settingsGetLanguage,
      args: [],
      call: () => api.getLanguage()
    },
    {
      name: 'setLanguage',
      channel: IPC.settingsSetLanguage,
      args: ['de'],
      call: () => api.setLanguage('de')
    },
    { name: 'getEnvConfig', channel: IPC.envConfigGet, args: [], call: () => api.getEnvConfig() },
    {
      name: 'saveEnvConfig',
      channel: IPC.envConfigSave,
      args: [{ STEAM_WEB_API_KEY: 'key-1', STEAM_ID64: '76561198000000000', STEAMGRIDDB_API_KEY: 'key-2' }],
      call: () =>
        api.saveEnvConfig({
          STEAM_WEB_API_KEY: 'key-1',
          STEAM_ID64: '76561198000000000',
          STEAMGRIDDB_API_KEY: 'key-2'
        })
    },
    {
      name: 'addManualGame',
      channel: IPC.libraryAddManual,
      args: [{ storeId: 'manual', name: 'My Game', storeGameId: 'abc123' }],
      call: () => api.addManualGame({ storeId: 'manual', name: 'My Game', storeGameId: 'abc123' })
    },
    {
      name: 'removeManualGame',
      channel: IPC.libraryRemoveManual,
      args: ['game-remove-id'],
      call: () => api.removeManualGame('game-remove-id')
    },
    {
      name: 'reportBrokenArtwork',
      channel: IPC.artworkBroken,
      args: ['merge-artwork', 'grid'],
      call: () => api.reportBrokenArtwork('merge-artwork', 'grid')
    },
    {
      name: 'getMicrosoftAuth',
      channel: IPC.microsoftAuthState,
      args: [],
      call: () => api.getMicrosoftAuth()
    },
    {
      name: 'signInToMicrosoft',
      channel: IPC.microsoftSignIn,
      args: [],
      call: () => api.signInToMicrosoft()
    },
    {
      name: 'signOutOfMicrosoft',
      channel: IPC.microsoftSignOut,
      args: [],
      call: () => api.signOutOfMicrosoft()
    },
    // The five the table used to miss, despite claiming to cover every
    // invoke-based method. Each is a channel mapping like any other, and
    // each would have been just as capable of pointing at the wrong one.
    {
      name: 'getEnabledStores',
      channel: IPC.settingsGetStores,
      args: [],
      call: () => api.getEnabledStores()
    },
    {
      name: 'setEnabledStores',
      channel: IPC.settingsSetStores,
      args: [['steam', 'microsoft']],
      call: () => api.setEnabledStores(['steam', 'microsoft'])
    },
    {
      name: 'getStoreAvailability',
      channel: IPC.storesAvailability,
      args: [],
      call: () => api.getStoreAvailability()
    },
    {
      name: 'isSecureStorageAvailable',
      channel: IPC.storesSecureStorage,
      args: [],
      call: () => api.isSecureStorageAvailable()
    },
    { name: 'isScanning', channel: IPC.libraryScanState, args: [], call: () => api.isScanning() },
    {
      name: 'getStartupNotice',
      channel: IPC.startupNotice,
      args: [],
      call: () => api.getStartupNotice()
    }
  ]

  beforeEach(() => {
    invokeCalls.length = 0
    onCalls.length = 0
    removeListenerCalls.length = 0
  })

  it.each(INVOKE_TABLE)('$name invokes its own channel with unchanged, ordered arguments', (row) => {
    row.call()

    expect(invokeCalls).toHaveLength(1)
    expect(invokeCalls[0]?.channel).toBe(row.channel)
    expect(invokeCalls[0]?.args).toEqual(row.args)
  })

  it('covers every invoke-based method exactly once, with twenty-seven distinct channels', () => {
    expect(INVOKE_TABLE).toHaveLength(27)
    expect(new Set(INVOKE_TABLE.map((row) => row.name)).size).toBe(27)
    // Exhaustive for real, rather than by assertion: every method on the
    // bridge is either in the table above or one of the five listeners.
    const listenerMethods = [
      'onScanningChanged',
      'onLibraryChanged',
      'onNavigateBack',
      'onNavigateForward',
      'onMicrosoftAuthChanged'
    ]
    const covered = new Set([...INVOKE_TABLE.map((row) => row.name), ...listenerMethods])
    expect(Object.keys(api).filter((name) => !covered.has(name))).toEqual([])
  })

  it('never sends two methods down the same channel', () => {
    // Includes the four listener channels too: a copy-paste could just as
    // easily point a listener method at an invoke channel, or at another
    // listener's channel, and this is the one assertion that would catch
    // that shape of mistake as well as the invoke-only one.
    const allChannels = [
      ...INVOKE_TABLE.map((row) => row.channel),
      IPC.libraryChanged,
      IPC.navigateBack,
      IPC.navigateForward,
      IPC.microsoftAuthChanged
    ]

    expect(new Set(allChannels).size).toBe(allChannels.length)
    expect(allChannels).toHaveLength(31)
  })

  /**
   * The three listener methods. Each must: subscribe to its own channel,
   * invoke the caller's callback when that channel fires, and return a
   * disposer that removes the very listener it registered — the comment at
   * src/preload/index.ts:26-28 exists because a disposer that removed a
   * *different* function would leak exactly as if there were no disposer at
   * all.
   */
  const LISTENER_TABLE: Array<{
    name: string
    channel: string
    subscribe: (callback: () => void) => () => void
  }> = [
    { name: 'onLibraryChanged', channel: IPC.libraryChanged, subscribe: (cb) => api.onLibraryChanged(cb) },
    { name: 'onNavigateBack', channel: IPC.navigateBack, subscribe: (cb) => api.onNavigateBack(cb) },
    { name: 'onNavigateForward', channel: IPC.navigateForward, subscribe: (cb) => api.onNavigateForward(cb) },
    {
      name: 'onMicrosoftAuthChanged',
      channel: IPC.microsoftAuthChanged,
      subscribe: (cb) => api.onMicrosoftAuthChanged(cb)
    }
  ]

  it.each(LISTENER_TABLE)(
    '$name subscribes to its own channel, forwards the event, and disposes the same listener',
    (row) => {
      let fired = 0
      const dispose = row.subscribe(() => {
        fired += 1
      })

      expect(onCalls).toHaveLength(1)
      expect(onCalls[0]?.channel).toBe(row.channel)
      const registeredListener = onCalls[0]?.listener

      // The channel firing should reach the caller's callback, with
      // whatever arguments ipcRenderer.on passes the raw listener.
      registeredListener?.({}, 'ignored-event-payload')
      expect(fired).toBe(1)

      dispose()

      expect(removeListenerCalls).toHaveLength(1)
      expect(removeListenerCalls[0]?.channel).toBe(row.channel)
      // The crux of the disposer test: it must remove the exact function
      // reference that was registered, not merely a same-shaped one.
      expect(removeListenerCalls[0]?.listener).toBe(registeredListener)
    }
  )

  it('gives each listener method its own distinct channel', () => {
    const channels = LISTENER_TABLE.map((row) => row.channel)
    expect(new Set(channels).size).toBe(4)
  })
})
