import { describe, expect, it } from 'vitest'
import { mergeKey, mergeLibrary } from '@main/library/merge'
import type { Game, StoreId } from '@shared/types'

function game(
  storeId: StoreId,
  storeGameId: string,
  name: string,
  overrides: Partial<Game> = {}
): Game {
  return {
    id: `${storeId}:${storeGameId}`,
    storeId,
    storeGameId,
    name,
    installed: true,
    favorite: false,
    hidden: false,
    firstSeen: 0,
    lastSeen: 0,
    ...overrides
  }
}

const EMPTY = { preferred: {}, split: new Set<string>() }

describe('mergeKey', () => {
  it('ignores trademark symbols, punctuation and capitalisation', () => {
    expect(mergeKey('Far Cry 4')).toBe(mergeKey('FAR CRY 4'))
    expect(mergeKey('It Takes Two™')).toBe(mergeKey('It Takes Two'))
  })

  it('keeps different games apart', () => {
    expect(mergeKey('Far Cry 4')).not.toBe(mergeKey('Far Cry 5'))
    expect(mergeKey('Far Cry 4')).not.toBe(mergeKey('Far Cry 4 Gold Edition'))
  })

  it('treats Epic’s question mark like the trademark sign it replaced', () => {
    // Epic's catalogue stores a literal "?" where ® stood — the real entry
    // here reads "Rocket League?" while Steam has "Rocket League", so the
    // two never merged and the library showed the game twice.
    //
    // normalizeTitle in steamAppList.ts has stripped "?" since plan 3. This
    // function is its twin and was otherwise character-for-character
    // identical; the two had simply drifted apart.
    expect(mergeKey('Rocket League?')).toBe(mergeKey('Rocket League'))
    expect(mergeKey('RollerCoaster Tycoon? 3')).toBe(mergeKey('RollerCoaster Tycoon 3'))
  })
})

describe('mergeLibrary', () => {
  it('leaves single games unchanged', () => {
    const entries = mergeLibrary([game('steam', '1', 'Solo')], EMPTY)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.sources).toHaveLength(1)
    expect(entries[0]!.active.storeId).toBe('steam')
  })

  it('merges the same game from two stores', () => {
    // Genau der Fall vom Zielsystem: Far Cry 4 ist bei Steam und Ubisoft
    // registriert und liegt im Steam-Ordner.
    const entries = mergeLibrary(
      [game('steam', '298110', 'Far Cry 4'), game('ubisoft', '856', 'Far Cry 4')],
      EMPTY
    )
    expect(entries).toHaveLength(1)
    expect(entries[0]!.sources.map((s) => s.storeId).sort()).toEqual(['steam', 'ubisoft'])
  })

  it('picks the installed store as active by default', () => {
    const entries = mergeLibrary(
      [
        game('ubisoft', '856', 'Far Cry 4', { installed: false }),
        game('steam', '298110', 'Far Cry 4', { installed: true })
      ],
      EMPTY
    )
    expect(entries[0]!.active.storeId).toBe('steam')
  })

  it('lets an explicit choice beat the default', () => {
    const entries = mergeLibrary(
      [game('steam', '298110', 'Far Cry 4'), game('ubisoft', '856', 'Far Cry 4')],
      { preferred: { [mergeKey('Far Cry 4')]: 'ubisoft:856' }, split: new Set() }
    )
    expect(entries[0]!.active.storeId).toBe('ubisoft')
  })

  it('splits apart again on request', () => {
    // Escape hatch against wrongly merged namesakes.
    const entries = mergeLibrary(
      [game('steam', '1', 'Same Name'), game('epic', '2', 'Same Name')],
      { preferred: {}, split: new Set([mergeKey('Same Name')]) }
    )
    expect(entries).toHaveLength(2)
  })

  it('counts as installed as soon as one source is installed', () => {
    const entries = mergeLibrary(
      [
        game('steam', '1', 'X', { installed: false }),
        game('ubisoft', '2', 'X', { installed: true })
      ],
      EMPTY
    )
    expect(entries[0]!.installed).toBe(true)
  })

  it('takes the highest playtime rather than summing', () => {
    // Summing would be wrong when two stores count the same session.
    const entries = mergeLibrary(
      [
        game('steam', '1', 'X', { playtimeMinutes: 500 }),
        game('ubisoft', '2', 'X', { playtimeMinutes: 100 })
      ],
      EMPTY
    )
    expect(entries[0]!.playtimeMinutes).toBe(500)
  })

  it('takes path and size from the active entry', () => {
    const entries = mergeLibrary(
      [
        game('steam', '1', 'X', { installed: true, installPath: 'S:\\', installSizeBytes: 10 }),
        game('ubisoft', '2', 'X', { installed: false, installPath: 'U:\\', installSizeBytes: 20 })
      ],
      EMPTY
    )
    expect(entries[0]!.installPath).toBe('S:\\')
    expect(entries[0]!.installSizeBytes).toBe(10)
  })

  it('counts as a favourite as soon as one source is', () => {
    const entries = mergeLibrary(
      [game('steam', '1', 'X'), game('ubisoft', '2', 'X', { favorite: true })],
      EMPTY
    )
    expect(entries[0]!.favorite).toBe(true)
  })

  it('hides an entry when every source is hidden', () => {
    const entries = mergeLibrary(
      [game('steam', '1', 'X', { hidden: true }), game('ubisoft', '2', 'X', { hidden: true })],
      EMPTY
    )
    expect(entries).toHaveLength(0)
  })

  it('takes at most one source per store', () => {
    // A store can list the same game under two identifiers when its
    // identifier scheme changed — Epic moved from AppName to
    // CatalogItemId. The old row stays because vanished games are never
    // deleted. Without a selection the tile would carry two Epic badges
    // for the same game.
    const entries = mergeLibrary(
      [
        game('epic', 'old-identifier', 'Foretales', { installed: false }),
        game('epic', 'new-identifier', 'Foretales', { installed: true })
      ],
      EMPTY
    )
    expect(entries).toHaveLength(1)
    expect(entries[0]!.sources).toHaveLength(1)
    expect(entries[0]!.sources[0]!.storeGameId).toBe('new-identifier')
  })

  it('prefers the source with a launch identifier at equal install state', () => {
    const entries = mergeLibrary(
      [
        game('epic', 'ohne', 'X', { installed: false }),
        game('epic', 'mit', 'X', { installed: false, launchId: 'app' })
      ],
      EMPTY
    )
    expect(entries[0]!.sources[0]!.storeGameId).toBe('mit')
  })

  it('lets different stores coexist untouched', () => {
    // Die Auswahl je Store darf echte Mehrfach-Registrierungen nicht
    // zusammenstreichen.
    const entries = mergeLibrary(
      [game('steam', '1', 'Far Cry 4'), game('ubisoft', '856', 'Far Cry 4')],
      EMPTY
    )
    expect(entries[0]!.sources).toHaveLength(2)
  })

  it('sorts the sources stably so the view does not jump', () => {
    const a = mergeLibrary(
      [game('ubisoft', '2', 'X'), game('steam', '1', 'X')],
      EMPTY
    )[0]!.sources.map((s) => s.storeId)
    const b = mergeLibrary(
      [game('steam', '1', 'X'), game('ubisoft', '2', 'X')],
      EMPTY
    )[0]!.sources.map((s) => s.storeId)
    expect(a).toEqual(b)
  })
})
