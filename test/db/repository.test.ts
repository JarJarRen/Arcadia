import { beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '@main/db/schema'
import { GameRepository } from '@main/db/repository'
import type { RawGame } from '@shared/types'

const T0 = 1_700_000_000
const T1 = 1_700_086_400

function raw(overrides: Partial<RawGame> & Pick<RawGame, 'storeGameId' | 'name'>): RawGame {
  return { installed: true, ...overrides }
}

describe('GameRepository', () => {
  let db: DatabaseSync
  let repo: GameRepository

  beforeEach(() => {
    db = openDatabase(':memory:')
    repo = new GameRepository(db)
  })

  it('legt neue Spiele an', () => {
    const diff = repo.upsertScan('steam', [raw({ storeGameId: '440', name: 'TF2' })], T0)
    expect(diff).toEqual({ added: 1, updated: 0, markedUninstalled: 0 })

    const games = repo.all()
    expect(games).toHaveLength(1)
    expect(games[0]).toMatchObject({
      id: 'steam:440',
      storeId: 'steam',
      name: 'TF2',
      installed: true,
      favorite: false,
      firstSeen: T0
    })
  })

  it('updates existing games without changing firstSeen', () => {
    repo.upsertScan('steam', [raw({ storeGameId: '440', name: 'TF2' })], T0)
    repo.upsertScan('steam', [raw({ storeGameId: '440', name: 'Team Fortress 2' })], T1)

    const game = repo.byId('steam:440')!
    expect(game.name).toBe('Team Fortress 2')
    expect(game.firstSeen).toBe(T0)
    expect(game.lastSeen).toBe(T1)
  })

  it('does not delete vanished games but marks them as not installed', () => {
    repo.upsertScan('steam', [raw({ storeGameId: '440', name: 'TF2' })], T0)
    const diff = repo.upsertScan('steam', [], T1)

    expect(diff.markedUninstalled).toBe(1)
    const game = repo.byId('steam:440')!
    expect(game.installed).toBe(false)
    expect(game.name).toBe('TF2')
  })

  it('preserves favourites across a scan', () => {
    repo.upsertScan('steam', [raw({ storeGameId: '440', name: 'TF2' })], T0)
    repo.setFavorite('steam:440', true)
    repo.upsertScan('steam', [raw({ storeGameId: '440', name: 'TF2' })], T1)

    expect(repo.byId('steam:440')!.favorite).toBe(true)
  })

  it('leaves other stores games untouched', () => {
    repo.upsertScan('steam', [raw({ storeGameId: '440', name: 'TF2' })], T0)
    repo.upsertScan('epic', [raw({ storeGameId: 'Fortnite', name: 'Fortnite' })], T0)
    repo.upsertScan('steam', [], T1)

    expect(repo.byId('steam:440')!.installed).toBe(false)
    expect(repo.byId('epic:Fortnite')!.installed).toBe(true)
  })

  it('does not overwrite existing playtime with undefined', () => {
    // Der Web-API-Scan liefert Spielzeit, der lokale Manifest-Scan nicht.
    // If the local scan runs afterwards, it must not wipe the value.
    repo.upsertScan('steam', [raw({ storeGameId: '440', name: 'TF2', playtimeMinutes: 120 })], T0)
    repo.upsertScan('steam', [raw({ storeGameId: '440', name: 'TF2' })], T1)

    expect(repo.byId('steam:440')!.playtimeMinutes).toBe(120)
  })

  it('sorts by name without regard to case', () => {
    // Deliberately 'apple' against 'Zebra': under SQLite's default BINARY
    // collation 'Zebra' would come first, because 'Z' is code point 90 and
    // 'a' is 97. Only COLLATE NOCASE gets the order right. Two capitalised
    // names would not notice a missing collation.
    repo.upsertScan('steam', [
      raw({ storeGameId: '2', name: 'Zebra' }),
      raw({ storeGameId: '1', name: 'apple' })
    ], T0)

    expect(repo.all().map((g) => g.name)).toEqual(['apple', 'Zebra'])
  })

  it('counts a vanished game only at the transition, not on every scan', () => {
    repo.upsertScan('steam', [raw({ storeGameId: '440', name: 'TF2' })], T0)

    expect(repo.upsertScan('steam', [], T1).markedUninstalled).toBe(1)

    // Beim zweiten Scan ohne das Spiel hat der Übergang nicht erneut
    // stattgefunden — es war schon vorher als nicht installiert vermerkt.
    expect(repo.upsertScan('steam', [], T1 + 1).markedUninstalled).toBe(0)
  })

  it('leaves last_seen of a long-uninstalled game untouched', () => {
    repo.upsertScan('steam', [raw({ storeGameId: '440', name: 'TF2' })], T0)
    repo.upsertScan('steam', [], T1)
    const afterTransition = repo.byId('steam:440')!.lastSeen

    repo.upsertScan('steam', [], T1 + 99_999)

    // Otherwise last_seen would no longer mean "last seen" but merely
    // "last scanned" — and would therefore be worthless.
    expect(repo.byId('steam:440')!.lastSeen).toBe(afterTransition)
  })

  it('counts a game reported twice in one scan only once', () => {
    // Happens when the same game is found via two library paths.
    const diff = repo.upsertScan('steam', [
      raw({ storeGameId: '440', name: 'TF2' }),
      raw({ storeGameId: '440', name: 'TF2' })
    ], T0)

    expect(diff.added).toBe(1)
    expect(repo.all()).toHaveLength(1)
  })

  it('protects path and size too from a scan that does not know them', () => {
    // Dasselbe COALESCE-Muster wie bei der Spielzeit, aber andere Spalten.
    repo.upsertScan('steam', [
      raw({
        storeGameId: '440',
        name: 'TF2',
        installPath: 'F:\\steam\\steamapps\\common\\TF2',
        installSizeBytes: 24696061952
      })
    ], T0)
    repo.upsertScan('steam', [raw({ storeGameId: '440', name: 'TF2' })], T1)

    const game = repo.byId('steam:440')!
    expect(game.installPath).toBe('F:\\steam\\steamapps\\common\\TF2')
    expect(game.installSizeBytes).toBe(24696061952)
  })

  it('rolls a scan aborted midway fully back', () => {
    repo.upsertScan('steam', [raw({ storeGameId: '1', name: 'A' })], T0)

    // name is NOT NULL: the third entry makes the INSERT fail after
    // the second one has already been written.
    expect(() =>
      repo.upsertScan(
        'steam',
        [
          raw({ storeGameId: '2', name: 'B' }),
          raw({ storeGameId: '3', name: null as unknown as string })
        ],
        T1
      )
    ).toThrow()

    // Without the ROLLBACK game 2 would be left half-written in the
    // database. node:sqlite has no db.transaction() like better-sqlite3;
    // the bracketing is hand-written, which is why it gets tested.
    expect(repo.byId('steam:2')).toBeUndefined()
    expect(repo.byId('steam:1')).toBeDefined()
  })

  describe('storeless games', () => {
    it('round-trips the program and its arguments', () => {
      repo.upsertScan(
        'other',
        [
          raw({
            storeGameId: 'manual-minecraft',
            name: 'Minecraft',
            launchExe: 'C:\\Games\\mc.exe',
            launchArgs: ['--profile', 'My Pack'],
            manual: true
          })
        ],
        T0
      )

      const game = repo.byId('other:manual-minecraft')!
      expect(game.launchExe).toBe('C:\\Games\\mc.exe')
      expect(game.launchArgs).toEqual(['--profile', 'My Pack'])
    })

    it('survives arguments that are not readable JSON', () => {
      repo.upsertScan('other', [raw({ storeGameId: 'manual-x', name: 'X', manual: true })], T0)
      db.prepare("UPDATE games SET launch_args = 'not json' WHERE id = 'other:manual-x'").run()

      // all() reads the whole library through toGame; one damaged row must not
      // empty it.
      expect(repo.all()).toHaveLength(1)
      expect(repo.byId('other:manual-x')!.launchArgs).toEqual([])
    })

    it('keeps a storeless row deletable across scans', () => {
      repo.upsertScan('other', [raw({ storeGameId: 'manual-x', name: 'X', manual: true })], T0)
      repo.upsertScan('other', [raw({ storeGameId: 'manual-x', name: 'X', manual: true })], T1)

      expect(repo.byId('other:manual-x')!.manual).toBe(true)
    })

    it('still lets a scan claim a hand-made row of a real store', () => {
      repo.addManualGame({ storeId: 'steam', name: 'TF2', storeGameId: '440' }, T0)
      expect(repo.byId('steam:440')!.manual).toBe(true)

      repo.upsertScan('steam', [raw({ storeGameId: '440', name: 'TF2' })], T1)

      // No adapter sets `manual`, so the documented hand-over is unchanged.
      expect(repo.byId('steam:440')!.manual).toBeUndefined()
    })

    it('lists only the storeless rows', () => {
      repo.upsertScan('steam', [raw({ storeGameId: '440', name: 'TF2' })], T0)
      repo.upsertScan('other', [raw({ storeGameId: 'manual-x', name: 'X', manual: true })], T0)

      expect(repo.storeless().map((game) => game.id)).toEqual(['other:manual-x'])
    })
  })
})
