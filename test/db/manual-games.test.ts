import { beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '@main/db/schema'
import { GameRepository } from '@main/db/repository'

const T0 = 1_700_000_000
const T1 = 1_700_086_400

describe('Manually added games', () => {
  let db: DatabaseSync
  let repo: GameRepository

  beforeEach(() => {
    db = openDatabase(':memory:')
    repo = new GameRepository(db)
  })

  it('adds a game with a generated identifier when none is given', () => {
    const id = repo.addManualGame({ storeId: 'ea', name: 'Dragon Age: Inquisition' }, T0)

    expect(id).toBe('ea:manual-dragon-age-inquisition')
    const game = repo.byId(id)!
    expect(game.name).toBe('Dragon Age: Inquisition')
    expect(game.storeId).toBe('ea')
    expect(game.installed).toBe(false)
    expect(game.manual).toBe(true)
  })

  it('uses a supplied store identifier verbatim', () => {
    const id = repo.addManualGame(
      { storeId: 'ea', name: 'FIFA 23', storeGameId: '16115019' },
      T0
    )
    expect(id).toBe('ea:16115019')
    expect(repo.byId(id)!.manual).toBe(true)
  })

  it('refuses a store identifier that could not reach a launch URI safely', () => {
    expect(() =>
      repo.addManualGame({ storeId: 'ea', name: 'X', storeGameId: '440; calc' }, T0)
    ).toThrow()
  })

  it('refuses an empty name', () => {
    expect(() => repo.addManualGame({ storeId: 'ea', name: '   ' }, T0)).toThrow()
  })

  it('refuses to add the same game twice', () => {
    repo.addManualGame({ storeId: 'ea', name: 'FIFA 23', storeGameId: '16115019' }, T0)
    expect(() =>
      repo.addManualGame({ storeId: 'ea', name: 'FIFA 23', storeGameId: '16115019' }, T0)
    ).toThrow()
  })

  it('removes a manual entry again', () => {
    const id = repo.addManualGame({ storeId: 'ea', name: 'Dragon Age' }, T0)
    repo.removeManualGame(id)
    expect(repo.byId(id)).toBeUndefined()
  })

  it('refuses to remove a game that a scan found', () => {
    // The renderer must not be able to delete real library entries through
    // the channel meant for hand-made ones — the same reasoning as
    // game:open-folder taking a merge key rather than a path.
    repo.upsertScan('steam', [{ storeGameId: '440', name: 'TF2', installed: true }], T0)
    expect(() => repo.removeManualGame('steam:440')).toThrow()
    expect(repo.byId('steam:440')).toBeDefined()
  })

  it('leaves a manual entry untouched when its store is rescanned', () => {
    // It is not installed, so the mark-gone pass skips it — but that has to
    // stay true, or every scan would quietly wipe the list.
    const id = repo.addManualGame({ storeId: 'ea', name: 'Dragon Age' }, T0)
    repo.upsertScan('ea', [], T1)

    const game = repo.byId(id)!
    expect(game.name).toBe('Dragon Age')
    expect(game.manual).toBe(true)
  })

  it('lets a real scan take over an entry added with the same identifier', () => {
    // The point of allowing a real store identifier: once the game is
    // installed for real, the scan owns the row and it stops being a
    // placeholder.
    const id = repo.addManualGame(
      { storeId: 'ea', name: 'FIFA 23', storeGameId: '16115019' },
      T0
    )
    repo.upsertScan(
      'ea',
      [{ storeGameId: '16115019', name: 'EA SPORTS™ FIFA 23', installed: true }],
      T1
    )

    const game = repo.byId(id)!
    expect(game.installed).toBe(true)
    expect(game.name).toBe('EA SPORTS™ FIFA 23')
    // No longer hand-made: the adapter owns the row now. Left marked, the
    // entry could still be "deleted" — and would simply come back on the
    // next scan, which reads as the delete button being broken.
    expect(game.manual).toBeUndefined()
  })

  it('keeps favourites when a manual entry is taken over by a scan', () => {
    const id = repo.addManualGame({ storeId: 'ea', name: 'FIFA', storeGameId: '16115019' }, T0)
    repo.setFavorite(id, true)
    repo.upsertScan('ea', [{ storeGameId: '16115019', name: 'FIFA', installed: true }], T1)
    expect(repo.byId(id)!.favorite).toBe(true)
  })
})

describe('storeless entries', () => {
  let db: DatabaseSync
  let repo: GameRepository

  beforeEach(() => {
    db = openDatabase(':memory:')
    repo = new GameRepository(db)
  })

  it('is installed the moment it is added', () => {
    const id = repo.addManualGame(
      { storeId: 'other', name: 'Minecraft Launcher', launchExe: 'C:\\Games\\mc.exe' },
      T0
    )

    const game = repo.byId(id)!
    expect(id).toBe('other:manual-minecraft-launcher')
    // The file was picked from a dialog and checked before it got here.
    // "Not installed" until the next sync would read as broken.
    expect(game.installed).toBe(true)
    expect(game.installPath).toBe('C:\\Games')
    expect(game.manual).toBe(true)
  })

  it('keeps a hand-made entry for a real store uninstalled', () => {
    const id = repo.addManualGame({ storeId: 'ea', name: 'Dead Space' }, T0)
    expect(repo.byId(id)!.installed).toBe(false)
  })

  it('stores the arguments as given', () => {
    const id = repo.addManualGame(
      {
        storeId: 'other',
        name: 'Minecraft',
        launchExe: 'C:\\Games\\mc.exe',
        launchArgs: ['--profile', 'My Pack']
      },
      T0
    )
    expect(repo.byId(id)!.launchArgs).toEqual(['--profile', 'My Pack'])
  })

  it('refuses a storeless entry with no program', () => {
    expect(() => repo.addManualGame({ storeId: 'other', name: 'Nothing' }, T0)).toThrow()
  })

  it('refuses a program on a store that has one of its own', () => {
    expect(() =>
      repo.addManualGame(
        { storeId: 'steam', name: 'TF2', storeGameId: '440', launchExe: 'C:\\x.exe' },
        T0
      )
    ).toThrow()
  })
})
