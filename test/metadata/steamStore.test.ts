import { describe, expect, it } from 'vitest'
import { fetchAppDetails, SteamStoreError, stripHtml } from '@main/metadata/steamStore'

const response = (appid: number, data: unknown, success = true, status = 200) =>
  async (): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ [appid]: { success, data } })
  })

const game = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'game',
  name: 'Cyberpunk 2077',
  short_description: '<strong>Cyberpunk</strong> is a role-playing game.',
  detailed_description: '<p>Long &amp; detailed</p>',
  developers: ['CD PROJEKT RED'],
  publishers: ['CD PROJEKT RED'],
  genres: [{ description: 'RPG' }, { description: 'Action' }],
  release_date: { date: '9 Dec, 2020' },
  metacritic: { score: 86 },
  screenshots: [{ path_full: 'https://a/1.jpg' }, { path_full: 'https://a/2.jpg' }],
  header_image: 'https://a/header.jpg',
  ...o
})

describe('stripHtml', () => {
  it('removes markup and resolves entities', () => {
    // The store API returns HTML. The details page shows text — stripping
    // happens on read, not on display, so that unvetted markup never
    // reaches the renderer.
    expect(stripHtml('<p>Hello &amp; <b>world</b></p>')).toBe('Hello & world')
    expect(stripHtml('Line<br>Line')).toBe('Line Line')
    expect(stripHtml('&quot;Quote&quot; &lt;angled&gt;')).toBe('"Quote" <angled>')
  })

  it('leaves plain text untouched', () => {
    expect(stripHtml('Just text')).toBe('Just text')
    expect(stripHtml('')).toBe('')
  })
})

describe('fetchAppDetails', () => {
  it('translates a complete response', async () => {
    const meta = (await fetchAppDetails(1091500, { fetchFn: response(1091500, game()) }))!
    expect(meta.steamAppId).toBe(1091500)
    expect(meta.genres).toEqual(['RPG', 'Action'])
    expect(meta.developers).toEqual(['CD PROJEKT RED'])
    expect(meta.releaseDate).toBe('9 Dec, 2020')
    expect(meta.metacritic).toBe(86)
    expect(meta.screenshots).toHaveLength(2)
  })

  it('returns the descriptions without HTML', async () => {
    const meta = (await fetchAppDetails(1, { fetchFn: response(1, game()) }))!
    expect(meta.shortDescription).toBe('Cyberpunk is a role-playing game.')
    expect(meta.description).toBe('Long & detailed')
  })

  it('discards entries that are not a game', async () => {
    // Name matching can point at a DLC of the same name. The details page
    // would then carry that DLC's description instead of the game's.
    for (const type of ['dlc', 'demo', 'music', 'video', 'hardware']) {
      const meta = await fetchAppDetails(1, { fetchFn: response(1, game({ type })) })
      expect(meta, `type=${type}`).toBeUndefined()
    }
  })

  it('returns undefined when Steam does not know the entry', async () => {
    // success: false is the normal case for removed games — not an error,
    // just no data.
    expect(await fetchAppDetails(1, { fetchFn: response(1, null, false) })).toBeUndefined()
  })

  it('copes with missing fields', async () => {
    const sparse = { type: 'game', name: 'Sparse' }
    const meta = (await fetchAppDetails(1, { fetchFn: response(1, sparse) }))!
    expect(meta.genres).toEqual([])
    expect(meta.screenshots).toEqual([])
    expect(meta.metacritic).toBeUndefined()
    expect(meta.releaseDate).toBeUndefined()
  })

  it('reports rate limiting separately so the queue can back off', async () => {
    // HTTP 429 is not an ordinary error: the queue has to slow down rather
    // than writing the game off as unfindable.
    let caught: unknown
    try {
      await fetchAppDetails(1, { fetchFn: response(1, null, false, 429) })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(SteamStoreError)
    expect((caught as SteamStoreError).kind).toBe('rate-limited')
  })

  it('reports other error responses as unexpected', async () => {
    let caught: unknown
    try {
      await fetchAppDetails(1, { fetchFn: response(1, null, false, 503) })
    } catch (e) {
      caught = e
    }
    expect((caught as SteamStoreError).kind).toBe('unexpected')
  })

  it('throws SteamStoreError rather than TypeError on a broken response', async () => {
    for (const body of [null, 'not an object', 42, []]) {
      let caught: unknown
      try {
        await fetchAppDetails(1, {
          fetchFn: async () => ({ ok: true, status: 200, json: async () => body })
        })
      } catch (e) {
        caught = e
      }
      expect(caught, `body ${JSON.stringify(body)}`).toBeInstanceOf(SteamStoreError)
    }
  })

  it('asks for the language matching the active setting', async () => {
    // The language used to be hard-wired to german. It now follows the
    // app's language, which defaults to English.
    let url = ''
    await fetchAppDetails(1, {
      fetchFn: async (u) => {
        url = u
        return { ok: true, status: 200, json: async () => ({ 1: { success: true, data: game() } }) }
      }
    })
    expect(url).toContain('l=english')
    expect(url).toContain('appids=1')
  })

  it('lets an explicit language override the setting', async () => {
    let url = ''
    await fetchAppDetails(1, {
      language: 'german',
      fetchFn: async (u) => {
        url = u
        return { ok: true, status: 200, json: async () => ({ 1: { success: true, data: game() } }) }
      }
    })
    expect(url).toContain('l=german')
  })
})
