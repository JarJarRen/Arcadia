import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Game, StoreId } from '@shared/types'
import type { StoreAdapter } from '@main/stores/types'

const opened: string[] = []

vi.mock('electron', () => ({
  shell: {
    openExternal: async (uri: string) => {
      opened.push(uri)
    }
  }
}))

const { installGame, launchGame } = await import('@main/launch-bridge')

function game(storeId: StoreId): Game {
  return {
    id: `${storeId}:1`,
    storeId,
    storeGameId: '1',
    name: 'Test game',
    installed: false,
    favorite: false,
    hidden: false,
    firstSeen: 0,
    lastSeen: 0
  }
}

function adapter(id: StoreId, overrides: Partial<StoreAdapter> = {}): StoreAdapter {
  return {
    id,
    displayName: id,
    isAvailable: async () => ({ available: true }),
    scanInstalled: async () => [],
    launchUri: () => `${id}://launch`,
    installUri: () => `${id}://install`,
    ...overrides
  }
}

describe('installGame', () => {
  beforeEach(() => {
    opened.length = 0
  })

  it('opens the install URI, not the launch URI', async () => {
    // Swapped, a game that is not installed would do nothing at all — no
    // error, no message.
    await installGame([adapter('steam')], game('steam'))
    expect(opened).toEqual(['steam://install'])
  })

  it('passes the adapter hint through', async () => {
    // EA cannot install from outside; without the hint the click would look
    // as though it had fizzled out.
    const result = await installGame(
      [adapter('ea', { installNotice: 'Only opened the library.' })],
      game('ea')
    )
    expect(result).toEqual({ ok: true, notice: 'Only opened the library.' })
  })

  it('leaves the field out when the adapter has nothing to say', async () => {
    expect(await installGame([adapter('steam')], game('steam'))).toEqual({ ok: true })
  })

  it('does not attach the hint to a launch', async () => {
    // The hint explains a quirk of installing. On a launch it would be
    // pointless and confusing.
    const result = await launchGame(
      [adapter('ea', { installNotice: 'Only opened the library.' })],
      game('ea')
    )
    expect(result).toEqual({ ok: true })
  })

  it('reports the install URI when opening fails', async () => {
    const broken = adapter('epic', {
      installUri: () => {
        throw new Error('no identifier')
      }
    })
    const result = await installGame([broken], game('epic'))

    expect(result.ok).toBe(false)
    // "Install", not "Launch" — the message goes to the user.
    expect(result.error).toMatch(/^Installing/)
    expect(opened).toEqual([])
  })

  it('reports a missing adapter instead of silently doing nothing', async () => {
    const result = await installGame([], game('ubisoft'))
    expect(result.ok).toBe(false)
    expect(opened).toEqual([])
  })
})
