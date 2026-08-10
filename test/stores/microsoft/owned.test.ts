/**
 * The account's games, the half that is not on this disk.
 *
 * The design originally had the entitlement service decide what was owned,
 * with the title history only decorating it. That was measured against the
 * live services and could not be built: `collections.mp.microsoft.com` is
 * the partner API and answers an empty list for a third party however the
 * request is shaped, and `inventory.xboxlive.com` refuses any token that is
 * not first-party. So the title history is the list, and the catalogue says
 * what each package is — the ProductId `installUri` needs, and the
 * ProductKind that keeps an application out of a game library.
 *
 * The package family name is what joins both to the local scan, so a game
 * that is both listed and installed stays one row.
 */
import { describe, expect, it, vi } from 'vitest'
import { MicrosoftAdapter } from '@main/stores/microsoft'
import type { InstalledPackage } from '@main/stores/microsoft/packages'

const FORZA = 'Microsoft.OpusPG_8wekyb3d8bbwe'
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
      readPlayedTitles: async () => [
        { packageFamilyName: FORZA, name: 'Forza Horizon 3', lastPlayed: 1_700_000_000 }
      ],
      resolveByPackageFamilyName: async () => [
        { productId: '9NBLGGH1Z7TW', name: 'Forza Horizon 3', packageFamilyName: FORZA }
      ],
      ...overrides
    }
  )
}

describe('MicrosoftAdapter scanOwned', () => {
  it('lists a game from the title history with its last-played time', async () => {
    expect(await signedIn().scanOwned()).toEqual([
      {
        storeGameId: FORZA,
        name: 'Forza Horizon 3',
        installed: false,
        lastPlayed: 1_700_000_000
      }
    ])
  })

  it('reports no playtime, because Xbox exposes none', async () => {
    const games = await signedIn().scanOwned()

    expect(games[0]?.playtimeMinutes).toBeUndefined()
  })

  it('lists a game the history knows no date for', async () => {
    const games = await signedIn({
      readPlayedTitles: async () => [{ packageFamilyName: FORZA, name: 'Forza Horizon 3' }]
    }).scanOwned()

    expect(games).toEqual([{ storeGameId: FORZA, name: 'Forza Horizon 3', installed: false }])
  })

  it('drops a package the catalogue does not call a game', async () => {
    // The history reports whatever was launched, the Xbox app and media
    // apps included, and does not classify any of it. Without the
    // catalogue's verdict those would all land in the library.
    const games = await signedIn({
      readPlayedTitles: async () => [
        { packageFamilyName: FORZA, name: 'Forza Horizon 3' },
        { packageFamilyName: 'Microsoft.GamingApp_8wekyb3d8bbwe', name: 'XBOX' }
      ]
    }).scanOwned()

    expect(games.map((game) => game.storeGameId)).toEqual([FORZA])
  })

  it('drops a package the catalogue has never heard of', async () => {
    const games = await signedIn({
      resolveByPackageFamilyName: async () => []
    }).scanOwned()

    expect(games).toEqual([])
  })

  it('prefers the catalogue’s title over the history’s', async () => {
    // The catalogue's is the canonical Store name; the history's is
    // whatever the title reported about itself.
    const games = await signedIn({
      resolveByPackageFamilyName: async () => [
        { productId: '9NBLGGH1Z7TW', name: 'Forza Horizon 3', packageFamilyName: FORZA }
      ],
      readPlayedTitles: async () => [
        { packageFamilyName: FORZA, name: 'FH3', lastPlayed: 1_700_000_000 }
      ]
    }).scanOwned()

    expect(games[0]?.name).toBe('Forza Horizon 3')
  })

  it('falls back to the history’s title when the catalogue has none', async () => {
    // A product with no localisation for the interface language comes back
    // titleless rather than absent, and a nameless row is no use to anyone.
    const games = await signedIn({
      resolveByPackageFamilyName: async () => [
        { productId: '9NBLGGH1Z7TW', name: '', packageFamilyName: FORZA }
      ]
    }).scanOwned()

    expect(games[0]?.name).toBe('Forza Horizon 3')
  })

  it('lists nothing while signed out, without asking anything', async () => {
    const readPlayedTitles = vi.fn()
    const games = await signedIn({
      session: { isSignedIn: () => false, gamertag: () => undefined, tokens: async () => undefined },
      readPlayedTitles
    }).scanOwned()

    expect(games).toEqual([])
    expect(readPlayedTitles).not.toHaveBeenCalled()
  })

  it('throws when the service fails, so the installed games are still written', async () => {
    const adapter = signedIn({
      readPlayedTitles: async () => {
        throw new Error('HTTP 503')
      }
    })

    await expect(adapter.scanOwned()).rejects.toThrow(/503/)
  })

  it('lists nothing off Windows, the same as scanInstalled', async () => {
    expect(await signedIn({ platform: 'linux' }).scanOwned()).toEqual([])
  })

  it('lists nothing when the session has no tokens despite reporting signed in', async () => {
    // A session answers isSignedIn() from the stored refresh token alone,
    // before tokens() has exchanged it — so the two can disagree.
    const readPlayedTitles = vi.fn()
    const games = await signedIn({
      session: {
        isSignedIn: () => true,
        gamertag: () => 'Player',
        tokens: async () => undefined
      },
      readPlayedTitles
    }).scanOwned()

    expect(games).toEqual([])
    expect(readPlayedTitles).not.toHaveBeenCalled()
  })

  it('asks the catalogue nothing when the history is empty', async () => {
    const resolveByPackageFamilyName = vi.fn()
    const games = await signedIn({
      readPlayedTitles: async () => [],
      resolveByPackageFamilyName
    }).scanOwned()

    expect(games).toEqual([])
    expect(resolveByPackageFamilyName).not.toHaveBeenCalled()
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

  /**
   * The design's error table has two rows saying so: "Refresh token
   * rejected → scan continues with the local half" and "Xbox Live
   * unreachable → installed games are still written". `scanOne` awaits
   * `scanInstalled()` outside any try, so a throw from the title history
   * escaped past `repo.upsertScan` — and a signed-in user with Xbox Live
   * down lost their installed games from the library too.
   */
  it('still lists the Xbox-app games when the session cannot be refreshed', async () => {
    const games = await signedIn({
      session: {
        isSignedIn: () => true,
        gamertag: () => undefined,
        tokens: async () => {
          throw new Error('fetch failed')
        }
      },
      readXboxAppPackages: async () => [FORZA],
      readInstalledPackages: async () =>
        new Map([[FORZA, { packageFamilyName: FORZA, displayName: 'Forza Horizon 3' }]])
    }).scanInstalled()

    expect(games.map((game) => game.storeGameId)).toEqual([FORZA])
  })

  it('still lists the Xbox-app games when the title history is unreachable', async () => {
    const games = await signedIn({
      readXboxAppPackages: async () => [FORZA],
      readInstalledPackages: async () =>
        new Map([[FORZA, { packageFamilyName: FORZA, displayName: 'Forza Horizon 3' }]]),
      readPlayedTitles: async () => {
        throw new Error('HTTP 503')
      }
    }).scanInstalled()

    expect(games.map((game) => game.storeGameId)).toEqual([FORZA])
  })

  it('does not list a game twice when the Xbox app installed it as well', async () => {
    const games = await signedIn({
      readXboxAppPackages: async () => [FORZA],
      readInstalledPackages: async () =>
        new Map([[FORZA, { packageFamilyName: FORZA, displayName: 'Forza Horizon 3' }]])
    }).scanInstalled()

    expect(games.length).toBe(1)
  })
})

describe('MicrosoftAdapter installUri', () => {
  const game = {
    id: `microsoft:${FORZA}`,
    storeId: 'microsoft' as const,
    storeGameId: FORZA,
    name: 'Forza Horizon 3',
    installed: false,
    favorite: false,
    hidden: false,
    firstSeen: 0,
    lastSeen: 0
  }

  it('opens the product page for a game the catalogue identified', async () => {
    const adapter = signedIn()
    // The index is filled by a scan, which is what always runs first.
    await adapter.scanOwned()

    expect(adapter.installUri(game)).toBe('ms-windows-store://pdp/?productid=9NBLGGH1Z7TW')
  })

  it('explains itself for a game with no known product', () => {
    expect(() => signedIn().installUri(game)).toThrow(/Forza Horizon 3/)
  })
})

describe('MicrosoftAdapter default dependencies', () => {
  it('reaches titlehub and the catalogue through its real defaults', async () => {
    // Stubs the global so this never reaches the network — it proves the two
    // defaults really forward to titlehub.ts and displayCatalog.ts, not that
    // Microsoft answers. The same trick session.test.ts uses.
    function respond(body: unknown): {
      ok: boolean
      status: number
      json: () => Promise<unknown>
      text: () => Promise<string>
    } {
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body)
      }
    }

    const fetchMock = vi
      .fn()
      // readPlayedTitles (titlehub.ts) runs first — it is the list.
      .mockResolvedValueOnce(
        respond({
          titles: [
            {
              pfn: FORZA,
              name: 'Forza Horizon 3',
              devices: ['PC'],
              titleHistory: { lastTimePlayed: '2023-11-14T22:13:20.000Z' }
            }
          ]
        })
      )
      // resolveByPackageFamilyName (displayCatalog.ts) classifies it.
      .mockResolvedValueOnce(
        respond({
          Products: [
            {
              ProductId: '9NBLGGH1Z7TW',
              ProductKind: 'Game',
              LocalizedProperties: [{ ProductTitle: 'Forza Horizon 3' }],
              Properties: { PackageFamilyName: FORZA }
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
        {
          storeGameId: FORZA,
          name: 'Forza Horizon 3',
          installed: false,
          lastPlayed: Math.floor(Date.parse('2023-11-14T22:13:20.000Z') / 1000)
        }
      ])
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain('titlehub.xboxlive.com')
      expect(String(fetchMock.mock.calls[1]?.[0])).toContain('displaycatalog.mp.microsoft.com')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
