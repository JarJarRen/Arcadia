/**
 * The `SteamAppList` class: the loaded, queryable state behind manual
 * matching, reached from `IPC.metadataSearch`.
 *
 * The free functions it wraps — `searchApps`, `buildIndex`, `normalizeTitle`
 * — already have their own tests in steamAppList.test.ts, including the
 * ranking behaviour (exact match first, case-insensitive, capped, empty on
 * no match). This file exercises the class itself: `size`, `findAppId`,
 * `nameFor`, `search`, `loadCache` and `refresh`, none of which any other
 * suite instantiates directly.
 *
 * `loadCache` reads a real file via node:fs/promises. Mocked here for the
 * same reason as in service.test.ts: real disk I/O has no place in a unit
 * test, and Task 5 already established that constructing a loaded instance
 * cheaply means going through this method with a faked `readFile`, not
 * poking at private state.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAppList, SteamAppList } from '@main/metadata/steamAppList'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: vi.fn(),
    writeFile: vi.fn(async () => undefined)
  }
})

import { readFile, writeFile } from 'node:fs/promises'

const APPS = [
  { appid: 400, name: 'Portal' },
  { appid: 620, name: 'Portal 2' },
  { appid: 323180, name: 'Portal 2 Soundtrack' },
  { appid: 1, name: 'Aperture Desk Job — a Portal spin-off' }
]

async function loaded(apps: unknown = APPS): Promise<SteamAppList> {
  vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(apps))
  const list = new SteamAppList()
  await list.loadCache('cache.json')
  return list
}

describe('SteamAppList', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('loadCache', () => {
    it('loads the list from the cache file and reports success', async () => {
      const list = await loaded()
      expect(list.size).toBe(APPS.length)
    })

    it('reports failure when the cache file cannot be read', async () => {
      vi.mocked(readFile).mockRejectedValueOnce(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      )
      const list = new SteamAppList()
      const ok = await list.loadCache('cache.json')
      expect(ok).toBe(false)
      expect(list.size).toBe(0)
    })

    it('reports failure on an empty list rather than discarding what is already loaded', async () => {
      const list = await loaded()
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify([]))
      const ok = await list.loadCache('cache.json')
      expect(ok).toBe(false)
      // The previously loaded entries must still be there.
      expect(list.size).toBe(APPS.length)
    })

    it('reports failure on a file that does not contain a JSON array', async () => {
      const list = new SteamAppList()
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({ not: 'an array' }))
      expect(await list.loadCache('cache.json')).toBe(false)
    })
  })

  describe('findAppId', () => {
    it('finds the AppID for a known title', async () => {
      const list = await loaded()
      expect(list.findAppId('Portal 2')).toBe(620)
    })

    it('returns undefined for a title Steam does not carry', async () => {
      const list = await loaded()
      expect(list.findAppId('No Such Game')).toBeUndefined()
    })

    it('returns undefined while nothing has been loaded', () => {
      const list = new SteamAppList()
      expect(list.findAppId('Portal')).toBeUndefined()
    })
  })

  describe('nameFor', () => {
    it('looks up the name for a known AppID', async () => {
      const list = await loaded()
      expect(list.nameFor(620)).toBe('Portal 2')
    })

    it('returns undefined for an AppID Steam does not list as a game', async () => {
      const list = await loaded()
      expect(list.nameFor(999_999)).toBeUndefined()
    })

    it('rebuilds the reverse map after a reload rather than serving stale names', async () => {
      // The reverse map is built once, on first use, and cached on the
      // instance. A reload must invalidate it — otherwise a renamed or
      // removed AppID would keep answering with the name from the cache
      // that loadCache just replaced.
      const list = await loaded()
      expect(list.nameFor(400)).toBe('Portal') // builds byId from the first load

      vi.mocked(readFile).mockResolvedValueOnce(
        JSON.stringify([{ appid: 400, name: 'Renamed Game' }])
      )
      await list.loadCache('cache.json')
      expect(list.nameFor(400)).toBe('Renamed Game')
    })
  })

  describe('search', () => {
    it('delegates to the ranked search over the loaded list', async () => {
      const list = await loaded()
      expect(list.search('Portal')[0]).toEqual({ appid: 400, name: 'Portal' })
    })

    it('is case-insensitive', async () => {
      const list = await loaded()
      expect(list.search('PORTAL')[0]).toEqual({ appid: 400, name: 'Portal' })
    })

    it('returns nothing for an empty query rather than the whole list', async () => {
      // Across 176,000 entries, an empty search box must not hand back the
      // first 20 in whatever order the index happens to hold them.
      const list = await loaded()
      expect(list.search('   ')).toEqual([])
    })

    it('returns an empty array for a query matching nothing', async () => {
      const list = await loaded()
      expect(list.search('Definitely Not In The List')).toEqual([])
    })

    it('caps results at 20 by default', async () => {
      const many = Array.from({ length: 30 }, (_, i) => ({
        appid: i,
        name: `Portal Clone ${i}`
      }))
      const list = await loaded(many)
      expect(list.search('Portal')).toHaveLength(20)
    })

    it('returns nothing while nothing has been loaded', () => {
      const list = new SteamAppList()
      expect(list.search('Portal')).toEqual([])
    })
  })

  describe('refresh', () => {
    const fetchFn = async (): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> => ({
      ok: true,
      status: 200,
      json: async () => ({ response: { apps: APPS, have_more_results: false } })
    })

    it('replaces the index with the freshly fetched list and writes the cache', async () => {
      const list = new SteamAppList()
      const count = await list.refresh('cache.json', { apiKey: 'K', fetchFn })
      expect(count).toBe(APPS.length)
      expect(list.size).toBe(APPS.length)
      expect(list.findAppId('Portal 2')).toBe(620)
      expect(vi.mocked(writeFile)).toHaveBeenCalledWith(
        'cache.json',
        JSON.stringify(APPS),
        'utf8'
      )
    })

    it('keeps the freshly fetched list even when the cache file cannot be written', async () => {
      // A cache that cannot be written is no reason to discard the list
      // that was just fetched.
      vi.mocked(writeFile).mockRejectedValueOnce(new Error('disk full'))
      const list = new SteamAppList()
      const count = await list.refresh('cache.json', { apiKey: 'K', fetchFn })
      expect(count).toBe(APPS.length)
      expect(list.size).toBe(APPS.length)
    })
  })
})

describe('fetchAppList', () => {
  it('gives up when the response body is not valid JSON', async () => {
    // Distinct from an unexpected-but-parseable shape (covered in
    // steamAppList.test.ts): here response.json() itself throws.
    await expect(
      fetchAppList({
        apiKey: 'K',
        fetchFn: async () => ({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError('Unexpected token in JSON')
          }
        })
      })
    ).rejects.toThrow('Steam app list did not return valid JSON.')
  })
})
