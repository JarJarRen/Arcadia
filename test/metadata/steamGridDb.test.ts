import { describe, expect, it, vi } from 'vitest'
import { fetchArtwork, lookupBySteamAppId, searchExact } from '@main/metadata/steamGridDb'

const OPT = { apiKey: 'testkey' }

/** Answers according to the path; records every URL called. */
function fetchMock(routes: Record<string, unknown>, status = 200) {
  const calls: { url: string; headers: Record<string, string> }[] = []
  const fetchFn = vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, headers: init.headers })
    const match = Object.entries(routes).find(([part]) => url.includes(part))
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => match?.[1] ?? { data: [] }
    }
  })
  return { fetchFn, calls }
}

describe('lookupBySteamAppId', () => {
  it('returns the SteamGridDB identifier', async () => {
    const { fetchFn, calls } = fetchMock({
      '/games/steam/252490': { success: true, data: { id: 3095, name: 'Rust' } }
    })
    expect(await lookupBySteamAppId(252490, { ...OPT, fetchFn })).toBe(3095)
    expect(calls[0]!.headers.Authorization).toBe('Bearer testkey')
  })

  it('returns undefined on an HTTP error instead of throwing', async () => {
    const { fetchFn } = fetchMock({}, 401)
    expect(await lookupBySteamAppId(1, { ...OPT, fetchFn })).toBeUndefined()
  })

  it('survives a response without data', async () => {
    const { fetchFn } = fetchMock({ '/games/steam/': { success: false } })
    expect(await lookupBySteamAppId(1, { ...OPT, fetchFn })).toBeUndefined()
  })

  it('survives a network error', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('ENOTFOUND')
    })
    expect(await lookupBySteamAppId(1, { ...OPT, fetchFn })).toBeUndefined()
  })

  it('does not carry the key into the message when something goes wrong', async () => {
    // The thrown exception can contain the full URL including the key. It
    // is discarded — pinned down here so it stays that way.
    const fetchFn = vi.fn(async () => {
      throw new Error('connection to ...?key=secret failed')
    })
    await expect(lookupBySteamAppId(1, { apiKey: 'secret', fetchFn })).resolves.toBeUndefined()
  })
})

describe('searchExact', () => {
  it('accepts a hit on exact name equality', async () => {
    const { fetchFn } = fetchMock({
      '/search/autocomplete/': {
        data: [{ id: 5268147, name: 'Football Manager 2021' }]
      }
    })
    expect(await searchExact('Football Manager 2021', { ...OPT, fetchFn })).toBe(5268147)
  })

  it('discards a merely similar hit', async () => {
    // The measured case: searching for "EA SPORTS(tm) FIFA 23" returns
    // "EA Sports FIFA 21" as the best hit. HTTP 200, ten results, nothing
    // suggesting a mistake. Taking the first hit hangs FIFA 21s packshot
    // over FIFA 23 — and unlike a missing image, a wrong one goes
    // unnoticed.
    const { fetchFn } = fetchMock({
      '/search/autocomplete/': {
        data: [
          { id: 5262608, name: 'EA Sports FIFA 21' },
          { id: 5254845, name: 'EA Sports UFC 2' }
        ]
      }
    })
    expect(await searchExact('EA SPORTS™ FIFA 23', { ...OPT, fetchFn })).toBeUndefined()
  })

  it('finds a match despite trademark symbols and capitalisation', async () => {
    // normalizeTitle strips the trademark symbol and normalises case.
    const { fetchFn } = fetchMock({
      '/search/autocomplete/': { data: [{ id: 42, name: 'EA SPORTS FC™ 26' }] }
    })
    expect(await searchExact('EA Sports FC 26', { ...OPT, fetchFn })).toBe(42)
  })

  it('takes the matching hit even when it is not the first', async () => {
    const { fetchFn } = fetchMock({
      '/search/autocomplete/': {
        data: [
          { id: 1, name: 'Portal 2' },
          { id: 2, name: 'Portal' }
        ]
      }
    })
    expect(await searchExact('Portal', { ...OPT, fetchFn })).toBe(2)
  })

  it('does not even search for an empty name', async () => {
    const { fetchFn } = fetchMock({})
    expect(await searchExact('   ', { ...OPT, fetchFn })).toBeUndefined()
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('fetchArtwork', () => {
  const IMAGES = {
    '/grids/game/3095': { data: [{ url: 'https://cdn2.steamgriddb.com/grid/a.png' }] },
    '/heroes/game/3095': { data: [{ url: 'https://cdn2.steamgriddb.com/hero/b.jpg' }] }
  }

  it('fetches grid and hero', async () => {
    const { fetchFn } = fetchMock(IMAGES)
    expect(await fetchArtwork(3095, { ...OPT, fetchFn })).toEqual([
      { kind: 'grid', url: 'https://cdn2.steamgriddb.com/grid/a.png' },
      { kind: 'hero', url: 'https://cdn2.steamgriddb.com/hero/b.jpg' }
    ])
  })

  it('requests the measured sizes and static images only', async () => {
    // Heroes come in 3840x1240 and 1920x620. The smaller one is plenty
    // for a 260-pixel header and is a quarter of the data. Without
    // types=static, animated grids would arrive.
    const { fetchFn, calls } = fetchMock(IMAGES)
    await fetchArtwork(3095, { ...OPT, fetchFn })

    expect(calls[0]!.url).toContain('dimensions=600x900')
    expect(calls[0]!.url).toContain('types=static')
    expect(calls[1]!.url).toContain('dimensions=1920x620')
    expect(calls[1]!.url).toContain('types=static')
  })

  it('returns only the kind that actually has an image', async () => {
    const { fetchFn } = fetchMock({ '/grids/game/7': { data: [{ url: 'https://x/a.png' }] } })
    const bilder = await fetchArtwork(7, { ...OPT, fetchFn })
    expect(bilder.map((b) => b.kind)).toEqual(['grid'])
  })

  it('discards images without https', async () => {
    // The CSP permits https only. An http image would be blocked silently
    // and leave an empty tile — worse than no entry at all, because the
    // fallback to the initials would then not kick in.
    const { fetchFn } = fetchMock({
      '/grids/game/7': { data: [{ url: 'http://cdn2.steamgriddb.com/grid/a.png' }] }
    })
    expect(await fetchArtwork(7, { ...OPT, fetchFn })).toEqual([])
  })

  it('skips entries without a usable URL', async () => {
    const { fetchFn } = fetchMock({
      '/grids/game/7': { data: [{ url: '' }, {}, { url: 'https://x/good.png' }] }
    })
    expect(await fetchArtwork(7, { ...OPT, fetchFn })).toEqual([
      { kind: 'grid', url: 'https://x/good.png' }
    ])
  })

  it('returns an empty list for an empty response', async () => {
    const { fetchFn } = fetchMock({}, 500)
    expect(await fetchArtwork(7, { ...OPT, fetchFn })).toEqual([])
  })
})
