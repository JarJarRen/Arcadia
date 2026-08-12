/**
 * What holds the three sources together.
 *
 * Its one real job is that no source can take another down. A hanging
 * aggregator must not empty the page, and a failing Epic must not hide
 * Steam's list.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '@main/db/schema'
import { SettingsRepository } from '@main/db/settings'
import { FreebieRepository } from '@main/db/freebies'
import { FreebieService } from '@main/freebies/service'
import { STORE_IDS, type Game } from '@shared/types'

const NOW = Date.parse('2026-08-10T12:00:00.000Z')

const EPIC_JSON = {
  data: {
    Catalog: {
      searchStore: {
        elements: [
          {
            title: 'Ghostrunner',
            catalogNs: { mappings: [{ pageSlug: 'ghostrunner' }] },
            keyImages: [],
            promotions: {
              promotionalOffers: [
                {
                  promotionalOffers: [
                    {
                      startDate: '2026-08-07T15:00:00.000Z',
                      endDate: '2026-08-14T15:00:00.000Z',
                      discountSetting: { discountPercentage: 0 }
                    }
                  ]
                }
              ],
              upcomingPromotionalOffers: []
            }
          }
        ]
      }
    }
  }
}

const STEAM_JSON = {
  specials: {
    items: [{ id: 42, name: 'Steam Freebie', discount_percent: 100, header_image: 'https://x/y.jpg' }]
  }
}

/** Routes by URL, so one stub can serve all three sources. */
function router(overrides: Record<string, () => Promise<unknown>> = {}) {
  return vi.fn(async (url: string) => {
    for (const [needle, body] of Object.entries(overrides)) {
      if (url.includes(needle)) {
        const value = await body()
        if (value instanceof Error) throw value
        return { ok: true, status: 200, json: async () => value }
      }
    }
    if (url.includes('epicgames')) return { ok: true, status: 200, json: async () => EPIC_JSON }
    if (url.includes('steampowered')) return { ok: true, status: 200, json: async () => STEAM_JSON }
    return { ok: true, status: 200, json: async () => [] }
  })
}

describe('FreebieService', () => {
  let db: DatabaseSync
  let repo: FreebieRepository
  let settings: SettingsRepository

  beforeEach(() => {
    db = openDatabase(':memory:')
    repo = new FreebieRepository(db)
    settings = new SettingsRepository(db)
  })

  function service(fetchFn = router()) {
    return new FreebieService({
      repo,
      settings,
      locale: () => ({ language: 'en', country: 'US' }),
      // Empty by default so the ownership marking added for getList stays
      // out of the way of every test below that is not about it; the
      // "marks a row owned" tests further down override this per case.
      games: () => [],
      fetchFn
    })
  }

  it('collects every source into one list', async () => {
    const svc = service()
    await svc.refresh(NOW, true)
    const list = svc.getList([...STORE_IDS], NOW)
    expect(list.current.map((row) => row.title).sort()).toEqual(['Ghostrunner', 'Steam Freebie'])
    expect(list.failures).toEqual([])
  })

  it('still shows the other two when one source fails', async () => {
    // The point of the whole design. A third party's outage is not an
    // outage of the page.
    const svc = service(router({ gamerpower: async () => new Error('down') }))
    await svc.refresh(NOW, true)
    const list = svc.getList([...STORE_IDS], NOW)
    expect(list.current).toHaveLength(2)
    expect(list.failures).toHaveLength(1)
  })

  it('keeps the previous cache when every source fails', async () => {
    const svc = service()
    await svc.refresh(NOW, true)

    const broken = service(
      router({
        epicgames: async () => new Error('down'),
        steampowered: async () => new Error('down'),
        gamerpower: async () => new Error('down')
      })
    )
    await broken.refresh(NOW + 1000, true)

    // The list survives; the failures say why it is not fresh.
    const list = broken.getList([...STORE_IDS], NOW + 1000)
    expect(list.current).toHaveLength(2)
    expect(list.failures).toHaveLength(3)
    expect(list.fetchedAt).toBe(NOW)
  })

  it('does not fetch again inside the TTL', async () => {
    const fetchFn = router()
    const svc = service(fetchFn)
    await svc.refresh(NOW, true)
    const callsAfterFirst = fetchFn.mock.calls.length

    await svc.refresh(NOW + 60_000, false)
    expect(fetchFn.mock.calls.length).toBe(callsAfterFirst)
  })

  it('reports whether it actually fetched', async () => {
    // The caller sends freebies:changed only when this is true. Sending it
    // unconditionally would loop: the renderer reloads on the event, the
    // reload calls getList, and getList refreshes behind the answer.
    const svc = service()
    expect(await svc.refresh(NOW, true)).toBe(true)
    expect(await svc.refresh(NOW + 60_000, false)).toBe(false)
    expect(await svc.refresh(NOW + 7 * 3_600_000, false)).toBe(true)
  })

  it('fetches again once the TTL has passed', async () => {
    const fetchFn = router()
    const svc = service(fetchFn)
    await svc.refresh(NOW, true)
    const callsAfterFirst = fetchFn.mock.calls.length

    await svc.refresh(NOW + 7 * 3_600_000, false)
    expect(fetchFn.mock.calls.length).toBeGreaterThan(callsAfterFirst)
  })

  it('shows only the stores that are switched on', async () => {
    const svc = service()
    await svc.refresh(NOW, true)
    expect(svc.getList(['steam'], NOW).current.map((row) => row.title)).toEqual(['Steam Freebie'])
  })

  it('resolves a claim by id and refuses an unknown one', async () => {
    const svc = service()
    await svc.refresh(NOW, true)
    expect(svc.claimById('epic:ghostrunner')).toBe('com.epicgames.launcher://store/p/ghostrunner')
    expect(() => svc.claimById('epic:does-not-exist')).toThrow()
  })

  it('runs the sources at the same time rather than one after another', async () => {
    // Three sequential requests to three different services would make the
    // slowest one the floor for all of them.
    let inFlight = 0
    let peak = 0
    const fetchFn = vi.fn(async (url: string) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      if (url.includes('epicgames')) return { ok: true, status: 200, json: async () => EPIC_JSON }
      if (url.includes('steampowered'))
        return { ok: true, status: 200, json: async () => STEAM_JSON }
      return { ok: true, status: 200, json: async () => [] }
    })
    await service(fetchFn).refresh(NOW, true)
    expect(peak).toBeGreaterThan(1)
  })

  it('has no fetchedAt before the first refresh', () => {
    // The unset arm of the getter: nothing has ever been written to
    // settings, so getList must not invent a timestamp.
    const svc = service()
    expect(svc.getList([...STORE_IDS], NOW).fetchedAt).toBeUndefined()
  })

  it('treats an unparseable stored timestamp as unset', async () => {
    // The settings table is a plain file a user (or an old version of the
    // app) could have written anything into. Garbage must not surface as a
    // fetchedAt the renderer treats as a real number.
    settings.set('freebies-fetched-at', 'not-a-number')
    const svc = service()
    expect(svc.getList([...STORE_IDS], NOW).fetchedAt).toBeUndefined()
  })

  it('fetches on an unforced call when nothing has ever been cached', async () => {
    // force is false, but there is no previous fetchedAt to compare the TTL
    // against — the short-circuit must not treat "never fetched" as "fresh".
    const fetchFn = router()
    const svc = service(fetchFn)
    expect(await svc.refresh(NOW, false)).toBe(true)
    expect(fetchFn.mock.calls.length).toBeGreaterThan(0)
  })

  it('shares one set of requests between overlapping refresh calls', async () => {
    // A startup refresh and a page opened at the same instant must not each
    // fire their own three requests.
    const fetchFn = router()
    const svc = service(fetchFn)
    const [first, second] = await Promise.all([svc.refresh(NOW, true), svc.refresh(NOW, true)])
    expect(first).toBe(true)
    expect(second).toBe(true)
    expect(fetchFn.mock.calls.length).toBe(3)
  })

  it('records when a claim was opened', async () => {
    const svc = service()
    await svc.refresh(NOW, true)
    svc.markOpened('epic:ghostrunner', NOW)
    const row = repo.find('epic:ghostrunner')
    expect(row?.claim).toBe('pending')
    expect(row?.openedAt).toBe(NOW)
  })

  it('falls back to English for Steam when the interface language has no mapping', async () => {
    // STEAM_LANGUAGE only knows the languages Arcadia's UI offers. A locale
    // outside that set must still produce a usable Steam request rather
    // than sending `undefined` as the language parameter.
    const fetchFn = router()
    const svc = new FreebieService({
      repo,
      settings,
      locale: () => ({ language: 'fr', country: 'US' }),
      games: () => [],
      fetchFn
    })
    await svc.refresh(NOW, true)
    const steamCall = fetchFn.mock.calls.find(([url]) => url.includes('steampowered'))
    expect(steamCall?.[0]).toContain('l=english')
  })

  describe('an offline machine that has never fetched successfully', () => {
    function allDown() {
      return router({
        epicgames: async () => new Error('down'),
        steampowered: async () => new Error('down'),
        gamerpower: async () => new Error('down')
      })
    }

    it('attempts once, then stays quiet inside the TTL instead of re-hitting the network', async () => {
      // fetchedAt never gets written on this machine, so the TTL guard must
      // read attempted-at instead — otherwise "last !== undefined" is
      // forever false and every call re-fetches.
      const fetchFn = allDown()
      const svc = service(fetchFn)
      await svc.refresh(NOW, false)
      expect(fetchFn.mock.calls.length).toBe(3)

      await svc.refresh(NOW + 60_000, false)
      expect(fetchFn.mock.calls.length).toBe(3)
    })

    it('returns true on that first failing refresh, because failures went from none to some', async () => {
      const svc = service(allDown())
      expect(await svc.refresh(NOW, false)).toBe(true)
    })

    it('returns false on a second consecutive total failure once the TTL has passed', async () => {
      // Same three messages as last time: nothing new for the renderer to
      // show, so no second event should fire.
      const svc = service(allDown())
      await svc.refresh(NOW, false)
      expect(await svc.refresh(NOW + 7 * 3_600_000, false)).toBe(false)
    })

    it('returns true once a source recovers, because the cache gets written again', async () => {
      const options = {
        repo,
        settings,
        locale: () => ({ language: 'en', country: 'US' }),
        games: () => [],
        fetchFn: allDown()
      }
      const svc = new FreebieService(options)
      await svc.refresh(NOW, false)
      expect(svc.getList([...STORE_IDS], NOW).failures).toHaveLength(3)

      options.fetchFn = router()
      expect(await svc.refresh(NOW + 7 * 3_600_000, false)).toBe(true)
      expect(svc.getList([...STORE_IDS], NOW + 7 * 3_600_000).failures).toEqual([])
    })

    it('leaves fetchedAt unset after a total failure, and sets it only once a fetch actually succeeds', async () => {
      const svc = service(allDown())
      await svc.refresh(NOW, false)
      expect(svc.getList([...STORE_IDS], NOW).fetchedAt).toBeUndefined()

      // A fresh instance sharing the same settings/repo, standing in for the
      // next successful attempt on this machine.
      const recovered = service(router())
      await recovered.refresh(NOW + 1000, true)
      expect(recovered.getList([...STORE_IDS], NOW + 1000).fetchedAt).toBe(NOW + 1000)
    })

    it('still lets force bypass the TTL guard even though attempted-at was just written', async () => {
      const fetchFn = router()
      const svc = service(fetchFn)
      await svc.refresh(NOW, false)
      const callsAfterFirst = fetchFn.mock.calls.length

      await svc.refresh(NOW + 1000, true)
      expect(fetchFn.mock.calls.length).toBeGreaterThan(callsAfterFirst)
    })

    it('treats an unparseable stored attempted-at as unset, so an unforced call still fetches', async () => {
      // Mirrors the existing fetchedAt garbage-value test: the settings
      // table is a plain file that a user or an old app version could have
      // written anything into.
      settings.set('freebies-attempted-at', 'not-a-number')
      const fetchFn = router()
      const svc = service(fetchFn)
      expect(await svc.refresh(NOW, false)).toBe(true)
      expect(fetchFn.mock.calls.length).toBeGreaterThan(0)
    })
  })

  describe('marking a row owned from the current library', () => {
    /** `Game` extends `RawGame`; only the six fields below are required. */
    function game(overrides: Partial<Game>): Game {
      return {
        id: 'ubisoft:1234',
        storeId: 'ubisoft',
        storeGameId: '1234',
        name: 'Test',
        installed: false,
        favorite: false,
        hidden: false,
        firstSeen: NOW,
        lastSeen: NOW,
        ...overrides
      }
    }

    it('marks the row owned end to end: GamerPower boilerplate stripped, then matched against the library', async () => {
      // The exact screenshot bug: GamerPower reports the game with a
      // trailing "(Ubisoft) Giveaway" that gamerpower.ts strips at parse
      // time (see its own tests) — without that stripping this row would
      // never match the library's plain title at all.
      const fetchFn = router({
        gamerpower: async () => [
          {
            id: 50,
            title: "Tom Clancy's Ghost Recon Future Soldier (Ubisoft) Giveaway",
            open_giveaway_url: 'https://www.gamerpower.com/open/ghost-recon',
            type: 'Game',
            platforms: 'PC, Ubisoft',
            end_date: 'N/A',
            status: 'Active'
          }
        ]
      })
      const svc = new FreebieService({
        repo,
        settings,
        locale: () => ({ language: 'en', country: 'US' }),
        games: () => [game({ name: "Tom Clancy's Ghost Recon Future Soldier" })],
        fetchFn
      })
      await svc.refresh(NOW, true)
      const row = svc.getList([...STORE_IDS], NOW).current.find((r) => r.storeId === 'ubisoft')
      expect(row?.title).toBe("Tom Clancy's Ghost Recon Future Soldier")
      expect(row?.claim).toBe('owned')
    })

    it('does not mark a row owned when the matching game sits in a different store', async () => {
      // Ownership must not cross stores: owning it on Steam says nothing
      // about whether the Ubisoft copy was ever claimed.
      const fetchFn = router({
        gamerpower: async () => [
          {
            id: 51,
            title: 'Anno 1800 (Ubisoft) Giveaway',
            open_giveaway_url: 'https://www.gamerpower.com/open/anno-1800',
            type: 'Game',
            platforms: 'PC, Ubisoft',
            end_date: 'N/A',
            status: 'Active'
          }
        ]
      })
      const svc = new FreebieService({
        repo,
        settings,
        locale: () => ({ language: 'en', country: 'US' }),
        games: () => [game({ id: 'steam:9', storeId: 'steam', storeGameId: '9', name: 'Anno 1800' })],
        fetchFn
      })
      await svc.refresh(NOW, true)
      const row = svc.getList([...STORE_IDS], NOW).current.find((r) => r.storeId === 'ubisoft')
      expect(row?.claim).toBe('unclaimed')
    })

    it('keeps a confirmed claim reading confirmed rather than flipping it to owned', async () => {
      const svc = new FreebieService({
        repo,
        settings,
        locale: () => ({ language: 'en', country: 'US' }),
        games: () => [game({ id: 'epic:abc', storeId: 'epic', storeGameId: 'abc', name: 'Ghostrunner' })],
        fetchFn: router()
      })
      await svc.refresh(NOW, true)
      repo.markOpened('epic:ghostrunner', NOW)
      repo.markConfirmed('epic:ghostrunner', NOW + 1000)

      const row = svc.getList([...STORE_IDS], NOW + 1000).current.find((r) => r.id === 'epic:ghostrunner')
      expect(row?.claim).toBe('confirmed')
    })
  })
})
