import { describe, expect, it } from 'vitest'
import { gameId, parseGameId } from '@shared/types'

describe('gameId', () => {
  it('joins store and store ID into a stable ID', () => {
    expect(gameId('steam', '440')).toBe('steam:440')
  })

  it('is reversible', () => {
    expect(parseGameId('steam:440')).toEqual({ storeId: 'steam', storeGameId: '440' })
  })

  it('tolerates colons inside the store ID', () => {
    // Epic AppNames can contain special characters — split at the first
    // colon only, otherwise the ID falls apart.
    const id = gameId('epic', 'Fortnite:Live')
    expect(parseGameId(id)).toEqual({ storeId: 'epic', storeGameId: 'Fortnite:Live' })
  })

  it('rejects unknown store prefixes', () => {
    expect(() => parseGameId('gog:1')).toThrow(/gog/)
    expect(() => parseGameId('broken')).toThrow()
  })

  it('rejects an ID without a game identifier', () => {
    // "steam:" would otherwise pass as valid, with an empty storeGameId.
    expect(() => parseGameId('steam:')).toThrow(/steam:/)
  })

  it('rejects empty IDs and IDs without a store', () => {
    expect(() => parseGameId('')).toThrow()
    expect(() => parseGameId(':anything')).toThrow()
  })
})
