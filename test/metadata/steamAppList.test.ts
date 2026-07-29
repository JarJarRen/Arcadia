import { describe, expect, it } from 'vitest'
import { buildIndex, fetchAppList, normalizeTitle, searchApps } from '@main/metadata/steamAppList'

const respond = (body: unknown, status = 200) =>
  async (): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  })

describe('normalizeTitle', () => {
  it('strips trademark symbols and punctuation and normalises whitespace', () => {
    expect(normalizeTitle('STAR WARS™ Battlefront™ II')).toBe(
      normalizeTitle('star wars battlefront ii')
    )
    expect(normalizeTitle('EA  SPORTS   FC 26')).toBe(normalizeTitle('ea sports fc 26'))
  })

  it('treats Epic question mark like a trademark symbol', () => {
    // Epic catalogue contains a literal "?" (character 63) in places where
    // a registered-trademark sign originally stood — checked on the
    // development machine, for instance in "RollerCoaster Tycoon? 3".
    // Without this handling the matching would fail for no reason.
    expect(normalizeTitle('RollerCoaster Tycoon? 3')).toBe(
      normalizeTitle('RollerCoaster Tycoon 3')
    )
    expect(normalizeTitle('Rocket League?')).toBe(normalizeTitle('Rocket League'))
  })

  it('keeps different games apart', () => {
    expect(normalizeTitle('Far Cry 4')).not.toBe(normalizeTitle('Far Cry 5'))
    expect(normalizeTitle('Football Manager 2020')).not.toBe(
      normalizeTitle('Football Manager 2021')
    )
    expect(normalizeTitle('Far Cry 4')).not.toBe(normalizeTitle('Far Cry 4 Gold Edition'))
  })

  it('copes with empty and punctuation-only names', () => {
    expect(normalizeTitle('')).toBe('')
    expect(normalizeTitle('---')).toBe('')
  })
})

describe('buildIndex', () => {
  it('takes the first entry for duplicate names', () => {
    // Steam lists the same title more than once, as a demo or soundtrack.
    // In practice the first hit is the main product.
    const index = buildIndex([
      { appid: 100, name: 'Game' },
      { appid: 200, name: 'Game' }
    ])
    expect(index.get('game')?.appid).toBe(100)
  })

  it('keeps the original name alongside, not just the AppID', () => {
    // The matching would only need the ID. Manual correction shows a human
    // suggestions, and "far cry 4 gold edition" is not one.
    const index = buildIndex([{ appid: 100, name: 'Far Cry 4 Gold Edition' }])
    expect(index.get('far cry 4 gold edition')?.name).toBe('Far Cry 4 Gold Edition')
  })

  it('skips entries without a usable name', () => {
    const index = buildIndex([
      { appid: 1, name: '' },
      { appid: 2, name: '   ' },
      { appid: 3 } as never
    ])
    expect(index.size).toBe(0)
  })
})

describe('fetchAppList', () => {
  it('fetches every page, not just the first', async () => {
    // On the development machine: 176,253 apps across 4 pages. Reading
    // only the first gets 50,000 and notices nothing — the matching would
    // simply not find the missing games.
    const pages = [
      { response: { apps: [{ appid: 1, name: 'A' }], have_more_results: true, last_appid: 1 } },
      { response: { apps: [{ appid: 2, name: 'B' }], have_more_results: false } }
    ]
    let n = 0
    const apps = await fetchAppList({
      apiKey: 'K',
      fetchFn: async () => ({ ok: true, status: 200, json: async () => pages[n++]! })
    })
    expect(apps.map((a) => a.appid)).toEqual([1, 2])
  })

  it('passes last_appid on as the page cursor', async () => {
    const gesehen: string[] = []
    let n = 0
    await fetchAppList({
      apiKey: 'K',
      fetchFn: async (url) => {
        gesehen.push(url)
        n++
        return {
          ok: true,
          status: 200,
          json: async () => ({
            response: {
              apps: [{ appid: n * 10, name: `A${n}` }],
              have_more_results: n < 2,
              last_appid: n * 10
            }
          })
        }
      }
    })
    expect(gesehen[0]).toContain('last_appid=0')
    expect(gesehen[1]).toContain('last_appid=10')
  })

  it('stops after an upper bound on pages', async () => {
    // Schutz gegen einen Endpunkt, der have_more_results dauerhaft meldet —
    // sonst liefe der Abruf endlos.
    let n = 0
    const apps = await fetchAppList({
      apiKey: 'K',
      fetchFn: async () => {
        n++
        return {
          ok: true,
          status: 200,
          json: async () => ({
            response: {
              apps: [{ appid: n, name: `A${n}` }],
              have_more_results: true,
              last_appid: n
            }
          })
        }
      }
    })
    expect(n).toBeLessThanOrEqual(50)
    expect(apps.length).toBeLessThanOrEqual(50)
  })

  it('gives up on an error response rather than returning half a list', async () => {
    // An incomplete list would be worse than none: the matching would
    // silently fail to find games, and nobody would work out that the list
    // is to blame.
    await expect(fetchAppList({ apiKey: 'K', fetchFn: respond({}, 503) })).rejects.toThrow()
  })

  it('gives up on an unexpected response shape', async () => {
    await expect(fetchAppList({ apiKey: 'K', fetchFn: respond(null) })).rejects.toThrow()
    await expect(
      fetchAppList({ apiKey: 'K', fetchFn: respond({ response: {} }) })
    ).rejects.toThrow()
  })

  it('does not put the API key into an error message', async () => {
    // Error messages land in the log and in the interface.
    const throwing = async (): Promise<never> => {
      throw new Error('failed: https://api.steampowered.com/?key=GEHEIM123')
    }
    for (const fetchFn of [throwing, respond({}, 500)]) {
      let gefangen: unknown
      try {
        await fetchAppList({ apiKey: 'GEHEIM123', fetchFn })
      } catch (e) {
        gefangen = e
      }
      expect((gefangen as Error).message).not.toContain('GEHEIM123')
    }
  })
})

describe('searchApps', () => {
  const apps = [
    { appid: 400, name: 'Portal' },
    { appid: 620, name: 'Portal 2' },
    { appid: 323180, name: 'Portal 2 Soundtrack' },
    { appid: 219, name: 'Half-Life 2: Deathmatch' },
    { appid: 220, name: 'Half-Life 2' },
    { appid: 1, name: 'Aperture Desk Job — a Portal spin-off' }
  ]

  it('puts the exact hit ahead of every partial hit', () => {
    // Without ranking, across 176,000 apps the wanted game would sit
    // somewhere among its soundtracks and demos.
    expect(searchApps(apps, 'Portal')[0]).toEqual({ appid: 400, name: 'Portal' })
  })

  it('puts prefix hits ahead of hits inside a word', () => {
    const names = searchApps(apps, 'Portal').map((a) => a.name)
    expect(names.indexOf('Portal 2')).toBeLessThan(
      names.indexOf('Aperture Desk Job — a Portal spin-off')
    )
  })

  it('puts the shorter name first at equal rank', () => {
    const names = searchApps(apps, 'Portal 2').map((a) => a.name)
    expect(names).toEqual(['Portal 2', 'Portal 2 Soundtrack'])
  })

  it('finds a match despite differing punctuation', () => {
    // normalizeTitle turns the colon into a space; without that,
    // "Half Life 2 Deathmatch" would not find its own entry.
    expect(searchApps(apps, 'half life 2 deathmatch')[0]?.appid).toBe(219)
  })

  it('returns nothing for empty input', () => {
    // Otherwise an empty search box would return the first 20 of 176,000 apps.
    expect(searchApps(apps, '   ')).toEqual([])
  })

  it('honours the upper bound', () => {
    expect(searchApps(apps, 'a', 2)).toHaveLength(2)
  })

  it('skips broken entries rather than throwing', () => {
    const broken = [{ appid: 1 }, { name: 'Portal' }, null, { appid: 400, name: 'Portal' }]
    expect(searchApps(broken as never, 'Portal')).toEqual([{ appid: 400, name: 'Portal' }])
  })
})
