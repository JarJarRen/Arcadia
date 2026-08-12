/**
 * Turning "opened" into "claimed".
 *
 * Arcadia cannot see the button press in the launcher. All it can do is
 * notice, later, that the game has appeared in the library — which is
 * exactly what a scan already establishes.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '@main/db/schema'
import { FreebieRepository } from '@main/db/freebies'
import { confirmClaims } from '@main/freebies/confirm'
import type { Game } from '@shared/types'
import type { RawFreebie } from '@shared/freebies'

const NOW = Date.parse('2026-08-10T12:00:00.000Z')

/**
 * `Game` extends `RawGame`; only the six fields below are required, the
 * rest of `RawGame` is optional.
 */
function game(overrides: Partial<Game>): Game {
  return {
    id: 'steam:42',
    storeId: 'steam',
    storeGameId: '42',
    name: 'Test',
    installed: false,
    favorite: false,
    hidden: false,
    firstSeen: NOW,
    lastSeen: NOW,
    ...overrides
  }
}

const steamRow: RawFreebie = {
  storeId: 'steam',
  title: 'Steam Freebie',
  kind: 'game',
  storeGameId: '42',
  source: 'steam'
}

const epicRow: RawFreebie = {
  storeId: 'epic',
  title: 'Ghostrunner™',
  kind: 'game',
  storeGameId: 'ghostrunner',
  source: 'epic'
}

// GamerPower is the only source for EA, Ubisoft and Microsoft, and it never
// supplies a store_game_id (the column is nullable for exactly that case).
// This is the normal row shape for three of the five stores, not an edge
// case, so it needs its own coverage rather than riding along on Steam/Epic
// rows that happen to carry an id.
const ubisoftRow: RawFreebie = {
  storeId: 'ubisoft',
  title: 'Anno 1800',
  kind: 'game',
  source: 'gamerpower'
}

describe('confirmClaims', () => {
  let db: DatabaseSync
  let repo: FreebieRepository

  beforeEach(() => {
    db = openDatabase(':memory:')
    repo = new FreebieRepository(db)
    repo.replaceAll([steamRow, epicRow, ubisoftRow], NOW)
  })

  it('confirms a Steam claim on the AppID', () => {
    repo.markOpened('steam:steam freebie', NOW)
    const confirmed = confirmClaims(repo, [game({ storeGameId: '42' })], NOW + 1000)
    expect(confirmed).toEqual(['steam:steam freebie'])
    expect(repo.find('steam:steam freebie')?.claim).toBe('confirmed')
  })

  it('confirms an Epic claim on the normalised title', () => {
    // Epic's library entries are keyed by the catalogue's AppName, which
    // has nothing to do with the promotion's page slug. The title is the
    // only bridge there is.
    repo.markOpened('epic:ghostrunner', NOW)
    const confirmed = confirmClaims(
      repo,
      [game({ id: 'epic:abc', storeId: 'epic', storeGameId: 'abc', name: 'Ghostrunner' })],
      NOW + 1000
    )
    expect(confirmed).toEqual(['epic:ghostrunner'])
  })

  it('leaves a claim pending when the game has not turned up', () => {
    repo.markOpened('epic:ghostrunner', NOW)
    expect(confirmClaims(repo, [], NOW + 1000)).toEqual([])
    expect(repo.find('epic:ghostrunner')?.claim).toBe('pending')
  })

  it('does not confirm from a different store', () => {
    // Owning it on Steam says nothing about having claimed it on Epic.
    repo.markOpened('epic:ghostrunner', NOW)
    expect(
      confirmClaims(repo, [game({ storeId: 'steam', name: 'Ghostrunner' })], NOW + 1000)
    ).toEqual([])
  })

  it('does nothing when there is nothing pending', () => {
    expect(confirmClaims(repo, [game({ storeGameId: '42' })], NOW)).toEqual([])
  })

  it('confirms a GamerPower-sourced claim (no storeGameId) on the normalised title', () => {
    // Ubisoft/EA/Microsoft rows all come from GamerPower and never carry a
    // storeGameId, so `claim.storeGameId` is undefined here — this is the
    // common path, not a corner case.
    repo.markOpened('ubisoft:anno 1800', NOW)
    const confirmed = confirmClaims(
      repo,
      [game({ id: 'ubisoft:999', storeId: 'ubisoft', storeGameId: '999', name: 'Anno 1800' })],
      NOW + 1000
    )
    expect(confirmed).toEqual(['ubisoft:anno 1800'])
  })

  it('does not confirm a titleless match from a library game with no usable storeGameId', () => {
    // Guards the `claim.storeGameId !== undefined` check: a pending claim
    // without an id must not be confirmed by coincidence against a library
    // row whose own id is blank, when the titles do not actually agree.
    repo.markOpened('ubisoft:anno 1800', NOW)
    const confirmed = confirmClaims(
      repo,
      [game({ id: 'ubisoft:blank', storeId: 'ubisoft', storeGameId: '', name: 'Some Other Game' })],
      NOW + 1000
    )
    expect(confirmed).toEqual([])
    expect(repo.find('ubisoft:anno 1800')?.claim).toBe('pending')
  })

  it('does not confirm an Epic claim on a coincidentally equal storeGameId', () => {
    // Epic's promotion id is a page slug; its library id is the catalogue's
    // AppName. They live in different namespaces, so a match between them
    // is chance, not signal — and confirming on it would tag the wrong
    // game as claimed.
    repo.markOpened('epic:ghostrunner', NOW)
    const confirmed = confirmClaims(
      repo,
      [
        game({
          id: 'epic:ghostrunner',
          storeId: 'epic',
          storeGameId: 'ghostrunner',
          name: 'Totally Different Game'
        })
      ],
      NOW + 1000
    )
    expect(confirmed).toEqual([])
    expect(repo.find('epic:ghostrunner')?.claim).toBe('pending')
  })
})
