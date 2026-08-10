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

describe('confirmClaims', () => {
  let db: DatabaseSync
  let repo: FreebieRepository

  beforeEach(() => {
    db = openDatabase(':memory:')
    repo = new FreebieRepository(db)
    repo.replaceAll([steamRow, epicRow], NOW)
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
})
