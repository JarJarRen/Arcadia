/**
 * The owned half.
 *
 * Ownership comes from the entitlement service, names from the catalogue,
 * last-played from the title history — and the package family name is what
 * joins all three to the local scan, so a game that is both owned and
 * installed stays one row.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MicrosoftAdapter } from '@main/stores/microsoft'
import type { InstalledPackage } from '@main/stores/microsoft/packages'

const FORZA = 'Microsoft.Forza_8wekyb3d8bbwe'
const ROBLOX = 'ROBLOXCORPORATION.ROBLOX_55nm5eh3cm0pr'
const TOKENS = {
  xboxLive: { token: 'xbl', userHash: 'u', xuid: '1', gamertag: 'Player' },
  marketplace: { token: 'mp', userHash: 'u', xuid: '1', gamertag: 'Player' }
}

function signedIn(overrides: Record<string, unknown> = {}): MicrosoftAdapter {
  return new MicrosoftAdapter(
    {},
    {
      platform: 'win32',
      session: {
        isSignedIn: () => true,
        gamertag: () => 'Player',
        tokens: async () => TOKENS
      } as never,
      readXboxAppPackages: async () => [],
      readInstalledPackages: async () => new Map<string, InstalledPackage>(),
      readStartAppIds: async () => new Map<string, string>(),
      readOwnedProductIds: async () => ['GAME1'],
      resolveProducts: async () => [
        { productId: 'GAME1', name: 'Forza Horizon', packageFamilyName: FORZA }
      ],
      readPlayedTitles: async () => [
        { packageFamilyName: FORZA, name: 'Forza Horizon', lastPlayed: 1_700_000_000 }
      ],
      ...overrides
    }
  )
}

describe('MicrosoftAdapter scanOwned', () => {
  it('lists an owned game with its name and last-played time', async () => {
    expect(await signedIn().scanOwned()).toEqual([
      {
        storeGameId: FORZA,
        name: 'Forza Horizon',
        installed: false,
        lastPlayed: 1_700_000_000
      }
    ])
  })

  it('reports no playtime, because Xbox exposes none', async () => {
    const games = await signedIn().scanOwned()

    expect(games[0]?.playtimeMinutes).toBeUndefined()
  })

  it('lists an owned game that has never been played', async () => {
    const games = await signedIn({ readPlayedTitles: async () => [] }).scanOwned()

    expect(games).toEqual([{ storeGameId: FORZA, name: 'Forza Horizon', installed: false }])
  })

  it('does not list a played title the account does not own', async () => {
    // A Game Pass title, most often. It is playable while the subscription
    // lasts, but it is not owned, and it still shows up while installed.
    const games = await signedIn({
      readPlayedTitles: async () => [{ packageFamilyName: ROBLOX, name: 'Roblox' }]
    }).scanOwned()

    expect(games.map((game) => game.storeGameId)).toEqual([FORZA])
  })

  it('lists nothing while signed out, without asking anything', async () => {
    const readOwnedProductIds = vi.fn()
    const games = await signedIn({
      session: { isSignedIn: () => false, gamertag: () => undefined, tokens: async () => undefined },
      readOwnedProductIds
    }).scanOwned()

    expect(games).toEqual([])
    expect(readOwnedProductIds).not.toHaveBeenCalled()
  })

  it('throws when the service fails, so the installed games are still written', async () => {
    const adapter = signedIn({
      readOwnedProductIds: async () => {
        throw new Error('HTTP 503')
      }
    })

    await expect(adapter.scanOwned()).rejects.toThrow(/503/)
  })
})

describe('MicrosoftAdapter scanInstalled while signed in', () => {
  it('adds a Store game installed outside the Xbox app', async () => {
    // The title history is what identifies this package as a game at all —
    // no local source can tell it from an application.
    const games = await signedIn({
      readInstalledPackages: async () =>
        new Map([
          [ROBLOX, { packageFamilyName: ROBLOX, displayName: 'Roblox', installPath: 'C:\\R' }]
        ]),
      readPlayedTitles: async () => [{ packageFamilyName: ROBLOX, name: 'Roblox' }]
    }).scanInstalled()

    expect(games.map((game) => game.storeGameId)).toEqual([ROBLOX])
  })

  it('does not add an installed package the title history says nothing about', async () => {
    const games = await signedIn({
      readInstalledPackages: async () =>
        new Map([
          [
            'Microsoft.MSPaint_8wekyb3d8bbwe',
            { packageFamilyName: 'Microsoft.MSPaint_8wekyb3d8bbwe', displayName: 'Paint' }
          ]
        ]),
      readPlayedTitles: async () => []
    }).scanInstalled()

    expect(games).toEqual([])
  })

  it('does not list a game twice when the Xbox app installed it as well', async () => {
    const games = await signedIn({
      readXboxAppPackages: async () => [FORZA],
      readInstalledPackages: async () =>
        new Map([[FORZA, { packageFamilyName: FORZA, displayName: 'Forza Horizon' }]])
    }).scanInstalled()

    expect(games.length).toBe(1)
  })
})

describe('MicrosoftAdapter installUri', () => {
  const game = {
    id: `microsoft:${FORZA}`,
    storeId: 'microsoft' as const,
    storeGameId: FORZA,
    name: 'Forza Horizon',
    installed: false,
    favorite: false,
    hidden: false,
    firstSeen: 0,
    lastSeen: 0
  }

  it('opens the product page for a game the catalogue named', async () => {
    const adapter = signedIn()
    // The index is filled by a scan, which is what always runs first.
    await adapter.scanOwned()

    expect(adapter.installUri(game)).toBe('ms-windows-store://pdp/?productid=GAME1')
  })

  it('explains itself for a game with no known product', () => {
    expect(() => signedIn().installUri(game)).toThrow(/Forza Horizon/)
  })
})

// The following tests close coverage gaps the brief's own tests leave open.
// Every test above overrides readOwnedProductIds, resolveProducts and
// readPlayedTitles, so the adapter's own default wiring for those three —
// and its use of config.catalogCachePath — is never exercised. Two branches
// inside scanOwned itself are likewise never taken: running off Windows, and
// a session that answers isSignedIn() with true but tokens() with undefined.

describe('MicrosoftAdapter scanOwned edge branches', () => {
  it('lists nothing off Windows, the same as scanInstalled', async () => {
    const games = await signedIn({ platform: 'linux' }).scanOwned()

    expect(games).toEqual([])
  })

  it('lists nothing when the session has no tokens despite reporting signed in', async () => {
    // A session can answer isSignedIn() from the stored refresh token alone,
    // before tokens() has actually exchanged it — so the two can disagree.
    const readOwnedProductIds = vi.fn()
    const games = await signedIn({
      session: {
        isSignedIn: () => true,
        gamertag: () => 'Player',
        tokens: async () => undefined
      },
      readOwnedProductIds
    }).scanOwned()

    expect(games).toEqual([])
    expect(readOwnedProductIds).not.toHaveBeenCalled()
  })
})

describe('MicrosoftAdapter default dependencies', () => {
  it('resolves an owned game through its real collections/catalogue/titlehub defaults', async () => {
    // Stubs the global so this never reaches the network — it proves the
    // three defaults really forward to collections.ts, displayCatalog.ts and
    // titlehub.ts, not that Microsoft answers. The same trick
    // session.test.ts uses for MicrosoftSession's own defaults.
    function respond(body: unknown): {
      ok: boolean
      status: number
      json: () => Promise<unknown>
      text: () => Promise<string>
    } {
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }
    }

    const fetchMock = vi
      .fn()
      // readOwnedProductIds (collections.ts)
      .mockResolvedValueOnce(respond({ Items: [{ productId: 'GAME1', productKind: 'Game' }] }))
      // resolveProducts (displayCatalog.ts)
      .mockResolvedValueOnce(
        respond({
          Products: [
            {
              ProductId: 'GAME1',
              ProductKind: 'Game',
              LocalizedProperties: [{ ProductTitle: 'Forza Horizon' }],
              Properties: { PackageFamilyName: FORZA }
            }
          ]
        })
      )
      // readPlayedTitles (titlehub.ts)
      .mockResolvedValueOnce(
        respond({
          titles: [
            {
              pfn: FORZA,
              name: 'Forza Horizon',
              devices: ['PC'],
              titleHistory: { lastTimePlayed: '2023-11-14T22:13:20.000Z' }
            }
          ]
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    try {
      const adapter = new MicrosoftAdapter(
        {},
        {
          platform: 'win32',
          session: {
            isSignedIn: () => true,
            gamertag: () => 'Player',
            tokens: async () => TOKENS
          } as never
        }
      )

      expect(await adapter.scanOwned()).toEqual([
        { storeGameId: FORZA, name: 'Forza Horizon', installed: false, lastPlayed: 1_700_000_000 }
      ])
      expect(fetchMock).toHaveBeenCalledTimes(3)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('MicrosoftAdapter catalogue cache wiring', () => {
  let dir: string | undefined

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('reads config.catalogCachePath during scanInstalled, so installUri works after a local-only scan', async () => {
    dir = mkdtempSync(join(tmpdir(), 'arcadia-ms-adapter-'))
    const catalogCachePath = join(dir, 'catalog.json')
    writeFileSync(
      catalogCachePath,
      JSON.stringify([{ productId: 'GAME1', name: 'Forza Horizon', packageFamilyName: FORZA }]),
      'utf8'
    )

    const adapter = new MicrosoftAdapter(
      { catalogCachePath },
      {
        platform: 'win32',
        readXboxAppPackages: async () => [FORZA],
        readInstalledPackages: async () =>
          new Map([[FORZA, { packageFamilyName: FORZA, displayName: 'Forza Horizon' }]]),
        readStartAppIds: async () => new Map<string, string>()
      }
    )

    await adapter.scanInstalled()

    expect(
      adapter.installUri({
        id: `microsoft:${FORZA}`,
        storeId: 'microsoft' as const,
        storeGameId: FORZA,
        name: 'Forza Horizon',
        installed: true,
        favorite: false,
        hidden: false,
        firstSeen: 0,
        lastSeen: 0
      })
    ).toBe('ms-windows-store://pdp/?productid=GAME1')
  })
})
