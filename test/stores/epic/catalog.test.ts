import { describe, expect, it } from 'vitest'
import { parseEpicCatalog } from '@main/stores/epic/catalog'

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
})
