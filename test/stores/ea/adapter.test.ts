import { describe, expect, it } from 'vitest'
import { EaAdapter } from '@main/stores/ea'
import { gameId, type Game } from '@shared/types'

function game(id: string): Game {
  return {
    id: gameId('ea', id),
    storeId: 'ea',
    storeGameId: id,
    name: 'X',
    installed: true,
    favorite: false,
    hidden: false,
    firstSeen: 0,
    lastSeen: 0
  }
}

describe('EaAdapter', () => {
  it('reports itself unavailable when no offers are found', async () => {
    const adapter = new EaAdapter({}, { readOffers: async () => [] })
    const result = await adapter.isAvailable()
    expect(result.available).toBe(false)
    expect(result.reason).toMatch(/EA/i)
  })

  it('reports itself available when offers exist', async () => {
    const adapter = new EaAdapter({}, {
      readOffers: async () => [{ offerId: '16050355', name: 'It Takes Two' }]
    })
    expect((await adapter.isAvailable()).available).toBe(true)
  })

  it('names the registry name matching as a limitation', async () => {
    // The owned library is readable now, but the install state still hangs
    // off a name match between two registry trees that can be wrong in
    // individual cases.
    const adapter = new EaAdapter({}, {
      readOffers: async () => [{ offerId: '16050355', name: 'It Takes Two' }]
    })
    const result = await adapter.isAvailable()
    expect(result.limitations?.join(' ')).toMatch(/registry/i)
  })

  it('returns an empty list when the store is missing', async () => {
    const adapter = new EaAdapter({}, {
      readOffers: async () => [],
      readInstalls: async () => [{ name: 'Irrelevant', installPath: 'C:\\Irrelevant\\' }]
    })
    expect(await adapter.scanInstalled()).toEqual([])
  })

  it('links offers and installations during the scan', async () => {
    const adapter = new EaAdapter({}, {
      readOffers: async () => [{ offerId: '16050355', name: 'It Takes Two' }],
      readInstalls: async () => [
        { name: 'It Takes Two', installPath: 'D:\\Games\\It Takes Two\\', sizeBytes: 1000 }
      ]
    })
    const games = await adapter.scanInstalled()
    expect(games).toHaveLength(1)
    expect(games[0]).toMatchObject({
      storeGameId: '16050355',
      name: 'It Takes Two',
      installed: true,
      installPath: 'D:\\Games\\It Takes Two\\',
      installSizeBytes: 1000
    })
  })

  it('does not ask the catalogue when nothing is owned', async () => {
    // The local read failing is a normal state — EA not installed, or never
    // signed in here. A request asking about an empty list would be pure
    // waste, and a failing one would turn that normal state into a scan error.
    let asked = false
    const adapter = new EaAdapter(
      {},
      {
        readOwnedOffers: async () => [],
        resolveOffers: async () => {
          asked = true
          return []
        }
      }
    )
    expect(await adapter.scanOwned()).toEqual([])
    expect(asked).toBe(false)
  })

  it('turns owned offers into games keyed by the master title ID', async () => {
    const adapter = new EaAdapter(
      {},
      {
        readOwnedOffers: async () => ['Origin.OFR.50.0004024'],
        resolveOffers: async (offerIds) => {
          expect(offerIds).toEqual(['Origin.OFR.50.0004024'])
          return [
            {
              offerId: 'Origin.OFR.50.0004024',
              name: 'It Takes Two',
              masterTitleId: '16050355',
              gameType: 'BASE_GAME'
            }
          ]
        }
      }
    )
    // The same identifier the registry scan produces, so sync.ts merges the
    // two without a second row for one game.
    expect(await adapter.scanOwned()).toEqual([
      { storeGameId: '16050355', name: 'It Takes Two', installed: false }
    ])
  })

  it('passes a catalogue failure upwards', async () => {
    // Deliberately not swallowed: sync.ts records it as a partial failure and
    // keeps the installed games, which is more use than a silently empty
    // library.
    const adapter = new EaAdapter(
      {},
      {
        readOwnedOffers: async () => ['Origin.OFR.50.0004024'],
        resolveOffers: async () => {
          throw new Error('catalogue down')
        }
      }
    )
    await expect(adapter.scanOwned()).rejects.toThrow(/catalogue down/)
  })

  it('builds the launch URI', () => {
    const adapter = new EaAdapter({}, { readOffers: async () => [] })
    expect(adapter.launchUri(game('16050355'))).toBe(
      'origin2://game/launch?offerIds=16050355'
    )
  })

  it('refuses the launch URI for a non-numeric offer ID', () => {
    const adapter = new EaAdapter({}, { readOffers: async () => [] })
    for (const bad of ['16050355; x', '../1', '']) {
      expect(() => adapter.launchUri(game(bad)), `ID "${bad}"`).toThrow(/EA/i)
    }
  })
})
