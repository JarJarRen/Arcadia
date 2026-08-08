import { describe, expect, it, vi } from 'vitest'
import { SteamAdapter } from '@main/stores/steam'
import { fetchOwnedGames, SteamApiError } from '@main/stores/steam/webApi'
import { gameId, type Game } from '@shared/types'

// Only the one test below ("uses the real webApi call by default") relies on
// this: it lets the default `fetchOwned` wiring inside SteamAdapter be
// exercised without a real HTTP call. Every other test in this file injects
// `fetchOwned` directly and never touches the mock.
vi.mock('@main/stores/steam/webApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/stores/steam/webApi')>()
  return {
    ...actual,
    fetchOwnedGames: vi.fn(async () => [])
  }
})

function game(id: string): Game {
  return {
    id: gameId('steam', id),
    storeId: 'steam',
    storeGameId: id,
    name: 'X',
    installed: true,
    favorite: false,
    hidden: false,
    firstSeen: 0,
    lastSeen: 0
  }
}

describe('SteamAdapter', () => {
  it('reports itself unavailable when Steam is not found', async () => {
    const adapter = new SteamAdapter({}, { findPath: async () => undefined })
    const result = await adapter.isAvailable()
    expect(result.available).toBe(false)
    expect(result.reason).toMatch(/not found|not installed/i)
  })

  it('reports itself available when Steam is found', async () => {
    const adapter = new SteamAdapter({}, { findPath: async () => 'd:\\steam' })
    const result = await adapter.isAvailable()
    expect(result.available).toBe(true)
  })

  it('names the missing API key as a limitation, not an error', async () => {
    const adapter = new SteamAdapter({}, { findPath: async () => 'd:\\steam' })
    const result = await adapter.isAvailable()
    expect(result.available).toBe(true)
    expect(result.limitations?.join(' ')).toMatch(/API/i)
  })

  it('names no limitation when the key is present', async () => {
    const adapter = new SteamAdapter(
      { apiKey: 'K', steamId64: '765' },
      { findPath: async () => 'd:\\steam' }
    )
    const result = await adapter.isAvailable()
    expect(result.limitations ?? []).toHaveLength(0)
  })

  it('builds the launch URI', () => {
    const adapter = new SteamAdapter({}, { findPath: async () => 'd:\\steam' })
    expect(adapter.launchUri(game('440'))).toBe('steam://rungameid/440')
  })

  it('refuses the launch URI for a non-numeric AppID', () => {
    // Last barrier before shell.openExternal. A value from the database may
    // come from an older, not yet validated version.
    const adapter = new SteamAdapter({}, { findPath: async () => 'd:\\steam' })
    for (const bad of ['440 & calc', '../../x', '440; rm -rf /', '']) {
      expect(() => adapter.launchUri(game(bad)), `AppID "${bad}"`).toThrow(
        /Invalid Steam AppID/
      )
    }
  })

  it('returns an empty list rather than throwing when the Steam path is missing', async () => {
    const adapter = new SteamAdapter({}, { findPath: async () => undefined })
    expect(await adapter.scanInstalled()).toEqual([])
  })

  it('passes installed games through when the Steam path is present', async () => {
    const adapter = new SteamAdapter(
      {},
      {
        findPath: async () => 'd:\\steam',
        scanLibraries: async () => [{ storeGameId: '440', name: 'TF2', installed: true }]
      }
    )
    expect(await adapter.scanInstalled()).toEqual([
      { storeGameId: '440', name: 'TF2', installed: true }
    ])
  })

  it('returns an empty owned list without an API key', async () => {
    const adapter = new SteamAdapter({}, { findPath: async () => 'd:\\steam' })
    expect(await adapter.scanOwned()).toEqual([])
  })

  it('passes owned games through when key and ID are present', async () => {
    const adapter = new SteamAdapter(
      { apiKey: 'K', steamId64: '765' },
      {
        findPath: async () => 'd:\\steam',
        fetchOwned: async () => [{ storeGameId: '440', name: 'TF2', installed: false }]
      }
    )
    expect(await adapter.scanOwned()).toEqual([
      { storeGameId: '440', name: 'TF2', installed: false }
    ])
  })

  it('derives the SteamID from the account selection when none is configured', async () => {
    let usedId: string | undefined
    const adapter = new SteamAdapter(
      { apiKey: 'K' },
      {
        findPath: async () => 'd:\\steam',
        readAccounts: async () => [
          {
            steamId64: 'AUTO',
            accountName: 'a',
            personaName: 'A',
            autoLogin: true,
            timestamp: 1
          }
        ],
        fetchOwned: async (_key, steamId64) => {
          usedId = steamId64
          return []
        }
      }
    )
    await adapter.scanOwned()
    expect(usedId).toBe('AUTO')
  })

  it('lets a manually chosen account beat the automatic selection', async () => {
    let usedId: string | undefined
    const adapter = new SteamAdapter(
      { apiKey: 'K', steamId64: 'MANUAL' },
      {
        findPath: async () => 'd:\\steam',
        readAccounts: async () => [
          {
            steamId64: 'AUTO',
            accountName: 'a',
            personaName: 'A',
            autoLogin: true,
            timestamp: 1
          }
        ],
        fetchOwned: async (_key, steamId64) => {
          usedId = steamId64
          return []
        }
      }
    )
    await adapter.scanOwned()
    expect(usedId).toBe('MANUAL')
  })

  it('wraps a plain failure from fetchOwned as an unexpected SteamApiError', async () => {
    // Only a SteamApiError already carries a hint the user can act on (wrong
    // key vs. private profile); anything else must not reach sync.ts as a
    // bare, unclassified error.
    const adapter = new SteamAdapter(
      { apiKey: 'K', steamId64: '765' },
      {
        findPath: async () => 'd:\\steam',
        fetchOwned: async () => {
          throw new Error('ECONNRESET')
        }
      }
    )
    await expect(adapter.scanOwned()).rejects.toThrow(SteamApiError)
    await expect(adapter.scanOwned()).rejects.toMatchObject({ kind: 'unexpected' })
  })

  it('lets a SteamApiError through unchanged rather than rewrapping it', async () => {
    const original = new SteamApiError('private', 'profile is private')
    const adapter = new SteamAdapter(
      { apiKey: 'K', steamId64: '765' },
      {
        findPath: async () => 'd:\\steam',
        fetchOwned: async () => {
          throw original
        }
      }
    )
    await expect(adapter.scanOwned()).rejects.toBe(original)
  })

  it('uses the real webApi call by default', async () => {
    // No `fetchOwned` override: this is the only test exercising the
    // module's own default wiring rather than an injected fake.
    vi.mocked(fetchOwnedGames).mockResolvedValueOnce([
      { storeGameId: '440', name: 'TF2', installed: false }
    ])
    const adapter = new SteamAdapter(
      { apiKey: 'K', steamId64: '765' },
      { findPath: async () => 'd:\\steam' }
    )
    const games = await adapter.scanOwned()
    expect(games).toEqual([{ storeGameId: '440', name: 'TF2', installed: false }])
    expect(fetchOwnedGames).toHaveBeenCalledWith({ apiKey: 'K', steamId64: '765' })
  })
})
