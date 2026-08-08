import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  EA_CATALOG_ENDPOINT,
  fetchEaCatalog,
  parseCatalogResponse,
  resolveEaOffers,
  toOwnedGames,
  type EaCatalogEntry,
  type PostFn
} from '@main/stores/ea/catalog'

function answer(payload: unknown, ok = true, status = 200): ReturnType<PostFn> {
  return Promise.resolve({ ok, status, json: async () => payload })
}

/** Shaped like the real answer, including the empty `displayName`. */
const PAYLOAD = {
  data: {
    legacyOffers: [
      // displayName is empty far more often than not — measured, that is the
      // difference between 18 and 32 named offers out of 34.
      { id: 'Origin.OFR.50.FP4S2YS', displayName: '', primaryMasterTitleId: 16425677 },
      { id: 'Origin.OFR.50.0004024', displayName: 'It Takes Two', primaryMasterTitleId: '16050355' },
      { id: 'Origin.OFR.50.0000583', displayName: '', primaryMasterTitleId: 181837 }
    ],
    gameProducts: {
      items: [
        {
          name: 'EA SPORTS FC™ 26 The World’s Game Edition\n',
          originOfferId: 'Origin.OFR.50.FP4S2YS',
          baseItem: { title: 'EA SPORTS FC™ 26', gameType: 'BASE_GAME' }
        },
        {
          name: '',
          originOfferId: 'Origin.OFR.50.0004024',
          baseItem: { title: 'It Takes Two', gameType: 'BASE_GAME' }
        }
      ]
    }
  }
}

describe('EA catalogue', () => {
  it('falls through the name sources', () => {
    const entries = parseCatalogResponse(PAYLOAD)
    const byId = new Map(entries.map((e) => [e.offerId, e]))
    expect(byId.get('Origin.OFR.50.FP4S2YS')?.name).toBe(
      'EA SPORTS FC™ 26 The World’s Game Edition'
    )
    expect(byId.get('Origin.OFR.50.0004024')?.name).toBe('It Takes Two')
    // Named by neither half — it stays unnamed rather than being invented.
    expect(byId.get('Origin.OFR.50.0000583')?.name).toBeUndefined()
  })

  it('accepts the master title ID as a number or a numeric string', () => {
    const byId = new Map(parseCatalogResponse(PAYLOAD).map((e) => [e.offerId, e]))
    expect(byId.get('Origin.OFR.50.FP4S2YS')?.masterTitleId).toBe('16425677')
    expect(byId.get('Origin.OFR.50.0004024')?.masterTitleId).toBe('16050355')
  })

  it('discards a master title ID that is not a number', () => {
    // It ends up in origin2://game/launch, so it is validated where it enters
    // rather than only where it is used.
    const entries = parseCatalogResponse({
      data: { legacyOffers: [{ id: 'X', primaryMasterTitleId: '16050355; rm' }] }
    })
    expect(entries[0]?.masterTitleId).toBeUndefined()
  })

  it('survives an answer with nothing in it', () => {
    expect(parseCatalogResponse(null)).toEqual([])
    expect(parseCatalogResponse({})).toEqual([])
    expect(parseCatalogResponse({ data: { legacyOffers: 'no' } })).toEqual([])
  })

  it('treats a GraphQL error as a failure, not an empty library', () => {
    // It arrives with HTTP 200. Reading it as "you own nothing" would delete
    // the owned games from the library on the next scan.
    const post: PostFn = () => answer({ errors: [{ message: 'Graphql validation error' }] })
    return expect(fetchEaCatalog(['X'], post)).rejects.toThrow(/EA/i)
  })

  it('fails on an HTTP error and on an unreachable service', async () => {
    await expect(fetchEaCatalog(['X'], () => answer({}, false, 503))).rejects.toThrow(/503/)
    await expect(
      fetchEaCatalog(['X'], () => {
        throw new Error('offline')
      })
    ).rejects.toThrow(/EA/i)
  })

  it('fails when the response body cannot be read as JSON', async () => {
    const post: PostFn = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('unexpected end of input'))
      })
    await expect(fetchEaCatalog(['X'], post)).rejects.toThrow(/EA/i)
  })

  it('posts to the real EA endpoint by default', async () => {
    // The only test here that exercises `defaultPost` rather than an
    // injected fake — everything else in this file goes through the
    // injected `post` to stay off the network.
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ data: { legacyOffers: [] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    try {
      const entries = await fetchEaCatalog(['Origin.OFR.50.0004024'])
      expect(entries).toEqual([])
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]!
      expect(url).toBe(EA_CATALOG_ENDPOINT)
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body as string).variables.offerIds).toEqual([
        'Origin.OFR.50.0004024'
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('asks only about offers it does not already know', async () => {
    const asked: string[][] = []
    const cache: EaCatalogEntry[] = [
      { offerId: 'known', name: 'Known', masterTitleId: '1', gameType: 'BASE_GAME' }
    ]
    let written = ''
    const entries = await resolveEaOffers(['known', 'fresh'], {
      cachePath: 'cache.json',
      readCache: async () => JSON.stringify(cache),
      writeCache: async (_path, contents) => {
        written = contents
      },
      post: (_url, body) => {
        asked.push((JSON.parse(body) as { variables: { offerIds: string[] } }).variables.offerIds)
        return answer({
          data: { legacyOffers: [{ id: 'fresh', displayName: 'Fresh', primaryMasterTitleId: 2 }] }
        })
      }
    })

    expect(asked).toEqual([['fresh']])
    expect(entries.map((e) => e.name)).toEqual(['Known', 'Fresh'])
    expect(written).toContain('fresh')
  })

  it('asks nothing at all when the cache covers everything', async () => {
    let asked = false
    await resolveEaOffers(['known'], {
      cachePath: 'cache.json',
      readCache: async () => JSON.stringify([{ offerId: 'known', name: 'Known' }]),
      writeCache: async () => undefined,
      post: () => {
        asked = true
        return answer({})
      }
    })
    expect(asked).toBe(false)
  })

  it('remembers an offer the catalogue said nothing about', async () => {
    // Otherwise the handful EA classifies as nothing would be re-requested on
    // every scan, forever.
    let written = ''
    await resolveEaOffers(['ghost'], {
      cachePath: 'cache.json',
      readCache: async () => {
        throw new Error('no cache yet')
      },
      writeCache: async (_path, contents) => {
        written = contents
      },
      post: () => answer({ data: { legacyOffers: [] } })
    })
    expect(JSON.parse(written)).toEqual([{ offerId: 'ghost' }])
  })

  it('works without a cache at all', async () => {
    const entries = await resolveEaOffers(['fresh'], {
      post: () => answer({ data: { legacyOffers: [{ id: 'fresh', displayName: 'Fresh' }] } })
    })
    expect(entries[0]?.name).toBe('Fresh')
  })

  it('treats a cache file that is not valid JSON as no cache at all', async () => {
    // A corrupted cache is no reason to fail: everything just gets asked
    // about again, exactly as if the cache had never existed.
    let asked: string[] = []
    const entries = await resolveEaOffers(['x'], {
      cachePath: 'cache.json',
      readCache: async () => 'not { valid json',
      writeCache: async () => undefined,
      post: (_url, body) => {
        asked = (JSON.parse(body) as { variables: { offerIds: string[] } }).variables.offerIds
        return answer({ data: { legacyOffers: [{ id: 'x', displayName: 'X' }] } })
      }
    })
    expect(asked).toEqual(['x'])
    expect(entries[0]?.name).toBe('X')
  })

  it('writes the cache to a real file by default', async () => {
    // The only test here that exercises the default `writeCache` (and
    // `readCache`) rather than an injected fake.
    const dir = await mkdtemp(join(tmpdir(), 'arcadia-ea-cache-'))
    try {
      const cachePath = join(dir, 'ea-catalog-cache.json')
      const entries = await resolveEaOffers(['fresh'], {
        cachePath,
        post: () => answer({ data: { legacyOffers: [{ id: 'fresh', displayName: 'Fresh' }] } })
      })
      expect(entries[0]?.name).toBe('Fresh')

      const written: unknown = JSON.parse(await readFile(cachePath, 'utf8'))
      expect(written).toEqual([{ offerId: 'fresh', name: 'Fresh' }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('EA owned games', () => {
  const entry = (over: Partial<EaCatalogEntry> & { offerId: string }): EaCatalogEntry => ({
    name: 'Game',
    masterTitleId: '1',
    gameType: 'BASE_GAME',
    ...over
  })

  it('keeps only base games', () => {
    // Points packs and pre-order content are owned, but they are not games.
    const games = toOwnedGames([
      entry({ offerId: 'a', name: 'It Takes Two', masterTitleId: '16050355' }),
      entry({ offerId: 'b', name: 'FC Points 1050', masterTitleId: '2', gameType: 'CURRENCY' }),
      entry({ offerId: 'c', name: 'Ultimate Content', masterTitleId: '3', gameType: 'MICRO_CONTENT' }),
      entry({ offerId: 'd', name: 'Unclassified', masterTitleId: '4', gameType: undefined })
    ])
    expect(games).toEqual([
      { storeGameId: '16050355', name: 'It Takes Two', installed: false }
    ])
  })

  it('drops an offer without a name or without an ID', () => {
    // "Unknown game (413150)" would be worse than nothing — the same rule the
    // Steam adapter and the launcher log already follow.
    expect(
      toOwnedGames([
        entry({ offerId: 'a', name: undefined }),
        entry({ offerId: 'b', masterTitleId: undefined })
      ])
    ).toEqual([])
  })

  it('collapses offers that share a master title ID, preferring the full game', () => {
    // EA SPORTS FC 26 is owned as an edition and as a trial under one ID.
    const games = toOwnedGames([
      entry({ offerId: 'trial', name: 'EA SPORTS FC 26 SHOWCASE', masterTitleId: '16425677' }),
      entry({ offerId: 'full', name: 'EA SPORTS FC 26', masterTitleId: '16425677' })
    ])
    expect(games).toEqual([
      { storeGameId: '16425677', name: 'EA SPORTS FC 26', installed: false }
    ])
  })

  it('keeps a trial that is the only thing owned under its ID', () => {
    const games = toOwnedGames([
      entry({ offerId: 'demo', name: 'EA SPORTS FIFA 20 Demo', masterTitleId: '194927' })
    ])
    expect(games[0]?.name).toBe('EA SPORTS FIFA 20 Demo')
  })

  it('never marks an owned game as installed', () => {
    // The registry scan decides that, and sync.ts lets it win.
    expect(toOwnedGames([entry({ offerId: 'a' })])[0]?.installed).toBe(false)
  })
})
