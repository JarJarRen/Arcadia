import { describe, expect, it, vi } from 'vitest'
import { SteamAdapter } from '@main/stores/steam'
import type { RawGame } from '@shared/types'

/** Valve's public example ID — never a real one in test data. */
const STEAM_ID = '76561197960287930'

const NAMES = new Map<number, string>([
  [440, 'Team Fortress 2'],
  [916440, 'Anno 1800'],
  [413150, 'Stardew Valley'],
  [220, 'Half-Life 2']
])

function adapter(
  options: {
    owned?: RawGame[]
    local?: string[]
    withoutNames?: boolean
  } = {}
) {
  return new SteamAdapter(
    { apiKey: 'testkey', steamId64: STEAM_ID },
    {
      findPath: async () => 'D:\\Steam',
      fetchOwned: async () => options.owned ?? [],
      readLocalPlayed: async () => options.local ?? [],
      resolveName:
        options.withoutNames === true ? (): undefined => undefined : (id) => NAMES.get(id)
    }
  )
}

describe('Shared and free games from localconfig.vdf', () => {
  it('adds games the API does not report', async () => {
    // The measured case: GetOwnedGames returns 193 while Steam's interface
    // shows 226. Anno 1800 and Team Fortress 2 exist only locally.
    const games = await adapter({
      owned: [{ storeGameId: '220', name: 'Half-Life 2', installed: false }],
      local: ['440', '916440']
    }).scanOwned()

    expect(games.map((game) => game.name).sort()).toEqual([
      'Anno 1800',
      'Half-Life 2',
      'Team Fortress 2'
    ])
  })

  it('marks only the added games', async () => {
    const games = await adapter({
      owned: [{ storeGameId: '220', name: 'Half-Life 2', installed: false }],
      local: ['440']
    }).scanOwned()

    expect(games.find((game) => game.name === 'Half-Life 2')?.sharedOrFree).toBeUndefined()
    expect(games.find((game) => game.name === 'Team Fortress 2')?.sharedOrFree).toBe(true)
  })

  it('does not mark a game the API already reports', async () => {
    // A game can appear in both sources: licensed and played locally. Then
    // it is licensed, and the mark would be wrong.
    const games = await adapter({
      owned: [{ storeGameId: '440', name: 'Team Fortress 2', installed: false }],
      local: ['440']
    }).scanOwned()

    expect(games).toHaveLength(1)
    expect(games[0]!.sharedOrFree).toBeUndefined()
  })

  it('skips app IDs whose names cannot be resolved', async () => {
    // Steam's own components (client 7, screenshots 760, controller
    // configurations 241100) are not in the games list. An entry reading
    // "Unknown game (760)" would be worse than none.
    const games = await adapter({ local: ['7', '760', '241100', '440'] }).scanOwned()

    expect(games.map((game) => game.name)).toEqual(['Team Fortress 2'])
  })

  it('stays quiet while the app list is not loaded', async () => {
    // On the very first start the cache does not exist yet. Not an error —
    // these games then arrive with the next scan.
    const games = await adapter({ local: ['440', '916440'], withoutNames: true }).scanOwned()
    expect(games).toEqual([])
  })

  it('marks the added games as not installed', async () => {
    // What is installed is decided by the manifest scan alone.
    const games = await adapter({ local: ['440'] }).scanOwned()
    expect(games[0]!.installed).toBe(false)
  })

  it('leaves the local branch alone without an API key', async () => {
    // Without a key scanOwned returns nothing at all — not even from the
    // local file. Otherwise shared games would sit in a library where the
    // user's own games are missing.
    const read = vi.fn(async () => ['440'])
    const withoutKey = new SteamAdapter(
      {},
      { findPath: async () => 'D:\\Steam', readLocalPlayed: read }
    )
    expect(await withoutKey.scanOwned()).toEqual([])
    expect(read).not.toHaveBeenCalled()
  })

  it('does not let an empty local read drag the owned games down', async () => {
    // readLocalPlayedApps catches for itself; all that matters here is that
    // an empty answer leaves the owned games standing.
    const games = await adapter({
      owned: [{ storeGameId: '220', name: 'Half-Life 2', installed: false }],
      local: []
    }).scanOwned()
    expect(games).toHaveLength(1)
  })
})
