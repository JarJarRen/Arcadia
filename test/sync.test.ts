import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '@main/db/schema'
import { GameRepository } from '@main/db/repository'
import { runSync } from '@main/sync'
import type { StoreAdapter } from '@main/stores/types'
import type { AvailabilityResult, Game, RawGame, StoreId } from '@shared/types'

const NOW = 1_700_000_000

function adapter(
  id: StoreId,
  overrides: Partial<StoreAdapter> & { available?: AvailabilityResult } = {}
): StoreAdapter {
  const { available, ...rest } = overrides
  return {
    id,
    displayName: id,
    isAvailable: async () => available ?? { available: true },
    scanInstalled: async () => [],
    launchUri: (game: Game) => `${id}://${game.storeGameId}`,
    installUri: (game: Game) => `${id}://install/${game.storeGameId}`,
    ...rest
  }
}

const raw = (storeGameId: string, name: string, installed = true): RawGame => ({
  storeGameId,
  name,
  installed
})

describe('runSync', () => {
  let db: DatabaseSync
  let repo: GameRepository

  beforeEach(() => {
    db = openDatabase(':memory:')
    repo = new GameRepository(db)
  })

  it('writes installed games into the database', async () => {
    const result = await runSync(
      [adapter('steam', { scanInstalled: async () => [raw('440', 'TF2')] })],
      repo,
      NOW
    )

    expect(result.stores[0]).toMatchObject({ storeId: 'steam', ok: true, games: 1 })
    expect(repo.all()).toHaveLength(1)
  })

  it('merges installed and owned games', async () => {
    await runSync(
      [
        adapter('steam', {
          scanInstalled: async () => [raw('440', 'TF2')],
          scanOwned: async () => [
            { storeGameId: '440', name: 'TF2', installed: false, playtimeMinutes: 120 },
            { storeGameId: '730', name: 'CS2', installed: false, playtimeMinutes: 50 }
          ]
        })
      ],
      repo,
      NOW
    )

    const games = repo.all()
    expect(games).toHaveLength(2)

    // The local scan wins on install state, the API contributes the
    // playtime — both have to survive.
    const tf2 = repo.byId('steam:440')!
    expect(tf2.installed).toBe(true)
    expect(tf2.playtimeMinutes).toBe(120)

    expect(repo.byId('steam:730')!.installed).toBe(false)
  })

  it('skips unavailable stores without an error', async () => {
    const result = await runSync(
      [adapter('ea', { available: { available: false, reason: 'Not installed' } })],
      repo,
      NOW
    )

    expect(result.stores[0]).toMatchObject({ storeId: 'ea', ok: true, games: 0 })
    expect(result.stores[0]!.error).toBeUndefined()
  })

  it('does not let a crashing adapter block the others', async () => {
    const result = await runSync(
      [
        adapter('steam', {
          scanInstalled: async () => {
            throw new Error('drive gone')
          }
        }),
        adapter('epic', { scanInstalled: async () => [raw('Fortnite', 'Fortnite')] })
      ],
      repo,
      NOW
    )

    const steam = result.stores.find((s) => s.storeId === 'steam')!
    const epic = result.stores.find((s) => s.storeId === 'epic')!

    expect(steam.ok).toBe(false)
    expect(steam.error).toContain('drive gone')
    expect(epic.ok).toBe(true)
    expect(repo.all()).toHaveLength(1)
  })

  it('keeps installed games when only the owned fetch fails', async () => {
    const result = await runSync(
      [
        adapter('steam', {
          scanInstalled: async () => [raw('440', 'TF2')],
          scanOwned: async () => {
            throw new Error('profile is private')
          }
        })
      ],
      repo,
      NOW
    )

    // Partial success: the game is there, the error is reported anyway.
    expect(repo.all()).toHaveLength(1)
    expect(result.stores[0]!.ok).toBe(false)
    expect(result.stores[0]!.error).toContain('private')
  })

  it('counts the total number of games', async () => {
    const result = await runSync(
      [
        adapter('steam', { scanInstalled: async () => [raw('1', 'A'), raw('2', 'B')] }),
        adapter('epic', { scanInstalled: async () => [raw('3', 'C')] })
      ],
      repo,
      NOW
    )
    expect(result.totalGames).toBe(3)
  })

  it('does not let an unavailable store clear existing games', async () => {
    // Scan Steam normally once ...
    await runSync(
      [adapter('steam', { scanInstalled: async () => [raw('440', 'TF2')] })],
      repo,
      NOW
    )

    // ... and then Steam is no longer findable, because the drive is
    // missing say. The library must not go empty because of that.
    await runSync(
      [adapter('steam', { available: { available: false, reason: 'gone' } })],
      repo,
      NOW + 1
    )

    expect(repo.byId('steam:440')?.installed).toBe(true)
  })

  it('calls the optional afterScan hook with the freshly written library', async () => {
    let seen: Game[] | undefined
    await runSync(
      [adapter('steam', { scanInstalled: async () => [raw('440', 'TF2')] })],
      repo,
      NOW,
      (games) => {
        seen = games
      }
    )

    expect(seen).toHaveLength(1)
    expect(seen?.[0]!.id).toBe('steam:440')
  })

  it('does not let a broken afterScan hook fail the sync', async () => {
    // Confirming freebie claims is a nicety riding along with a scan of
    // hundreds of games — a bug there must not take the whole scan down.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await runSync(
      [adapter('steam', { scanInstalled: async () => [raw('440', 'TF2')] })],
      repo,
      NOW,
      () => {
        throw new Error('boom')
      }
    )

    expect(result.totalGames).toBe(1)
    expect(consoleError).toHaveBeenCalledWith(
      'The freebie claims could not be confirmed:',
      expect.any(Error)
    )

    consoleError.mockRestore()
  })
})
