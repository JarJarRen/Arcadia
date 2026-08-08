import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEpicCatalog, readEpicCatalog } from '@main/stores/epic/catalog'

/** Builds a catalogue cache the way Epic stores it. */
function catalogue(entries: unknown[]): string {
  return Buffer.from(JSON.stringify(entries), 'utf8').toString('base64')
}

const game = (id: string, title: string, extra: Record<string, unknown> = {}): unknown => ({
  id,
  title,
  entitlementName: `ent-${id}`,
  categories: [{ path: 'public' }, { path: 'games' }, { path: 'applications' }],
  ...extra
})

describe('parseEpicCatalog', () => {
  it('reads owned games', () => {
    expect(parseEpicCatalog(catalogue([game('abc', 'Hogwarts Legacy')]))).toEqual([
      { storeGameId: 'abc', name: 'Hogwarts Legacy', installed: false }
    ])
  })

  it('marks everything as not installed', () => {
    // What is installed is decided by the manifest scan alone.
    const games = parseEpicCatalog(catalogue([game('a', 'X'), game('b', 'Y')]))
    expect(games.every((entry) => entry.installed === false)).toBe(true)
  })

  it('discards entries without the games category', () => {
    // On the development machine: 189 entries, only 37 of them games. The
    // rest are engines, plugins, audiences and tools.
    const rest = [
      { id: '1', title: 'Unreal Engine', entitlementName: 'e', categories: [{ path: 'engines' }] },
      { id: '2', title: 'Fab Plugin', entitlementName: 'e', categories: [{ path: 'plugins' }] },
      { id: '3', title: 'Audience', entitlementName: 'e', categories: [{ path: 'audience' }] }
    ]
    expect(parseEpicCatalog(catalogue(rest))).toEqual([])
  })

  it('discards entries without an entitlementName', () => {
    // That field separates genuine ownership from merely cached catalogue
    // entries.
    const without = [{ id: '1', title: 'Only viewed', categories: [{ path: 'games' }] }]
    expect(parseEpicCatalog(catalogue(without))).toEqual([])
  })

  it('deduplicates by catalogue ID', () => {
    const twice = [
      game('a', 'Galactic Civilizations III'),
      game('a', 'Galactic Civilizations III')
    ]
    expect(parseEpicCatalog(catalogue(twice))).toHaveLength(1)
  })

  it('keeps titles that differ only in their suffix', () => {
    // "... (Test branch)" is its own entry with its own ID and must not
    // merge with the main game — that is decided later by the merge layer,
    // not by the parser.
    const two = [
      game('a', 'Galactic Civilizations III'),
      game('b', 'Galactic Civilizations III (Test branch)')
    ]
    expect(parseEpicCatalog(catalogue(two))).toHaveLength(2)
  })

  it('returns an empty list for broken base64 or JSON', () => {
    // The format is undocumented. If it breaks, the library must not be
    // dragged down with it — an empty result leaves the installed games
    // standing.
    expect(parseEpicCatalog('not base64 !!!')).toEqual([])
    expect(parseEpicCatalog(Buffer.from('{not json', 'utf8').toString('base64'))).toEqual([])
    expect(parseEpicCatalog(Buffer.from('null', 'utf8').toString('base64'))).toEqual([])
    expect(parseEpicCatalog(Buffer.from('{"a":1}', 'utf8').toString('base64'))).toEqual([])
    expect(parseEpicCatalog('')).toEqual([])
  })

  it('skips individual broken entries without losing the others', () => {
    const mixed = [
      game('a', 'Good game'),
      null,
      'not an object',
      { id: 42, title: 'ID not a string', entitlementName: 'e', categories: [{ path: 'games' }] },
      { id: 'b', title: '', entitlementName: 'e', categories: [{ path: 'games' }] },
      game('c', 'Another good game')
    ]
    expect(parseEpicCatalog(catalogue(mixed)).map((entry) => entry.name)).toEqual([
      'Good game',
      'Another good game'
    ])
  })

  it('takes the launch identifier from releaseInfo when present', () => {
    // Until this existed, the launch identifier came only from the local
    // manifest — leaving an owned but uninstalled game impossible to launch
    // or install.
    const entries = [
      game('a', 'Foretales', {
        releaseInfo: [{ appId: '4256d7c7170f4326a1a861d0b30f1af7', platform: ['Windows'] }]
      })
    ]
    expect(parseEpicCatalog(catalogue(entries))[0]?.launchId).toBe(
      '4256d7c7170f4326a1a861d0b30f1af7'
    )
  })

  it('leaves out the launch identifier when releaseInfo has none usable', () => {
    const noArray = parseEpicCatalog(catalogue([game('a', 'X', { releaseInfo: 'not an array' })]))
    expect(noArray[0]?.launchId).toBeUndefined()

    const noAppId = parseEpicCatalog(
      catalogue([game('b', 'Y', { releaseInfo: [{ platform: ['Windows'] }] })])
    )
    expect(noAppId[0]?.launchId).toBeUndefined()

    // Entries that are not objects at all must not stop the search for a
    // usable one further down the list.
    const skipsNonObjects = parseEpicCatalog(
      catalogue([
        game('c', 'Z', {
          releaseInfo: [null, 'not an object', { appId: 'real-app-id' }]
        })
      ])
    )
    expect(skipsNonObjects[0]?.launchId).toBe('real-app-id')
  })

  it('rejects a releaseInfo appId that must not enter a URI', () => {
    // The same barrier as the manifest branch: the identifier ends up in a
    // URI handed to the shell.
    const entries = parseEpicCatalog(
      catalogue([game('a', 'X', { releaseInfo: [{ appId: 'a b' }] })])
    )
    expect(entries[0]?.launchId).toBeUndefined()
  })
})

describe('readEpicCatalog', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'arcadia-epic-catalog-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reads and decodes a real catalogue cache file', async () => {
    const path = join(dir, 'catcache.bin')
    await writeFile(path, catalogue([game('abc', 'Hogwarts Legacy')]), 'utf8')

    expect(await readEpicCatalog(path)).toEqual([
      { storeGameId: 'abc', name: 'Hogwarts Legacy', installed: false }
    ])
  })

  it('returns an empty list when the cache file is missing', async () => {
    // The cache is undocumented and can go missing or unreadable; the
    // installed games must not be dragged down with it.
    expect(await readEpicCatalog(join(dir, 'does-not-exist.bin'))).toEqual([])
  })
})
