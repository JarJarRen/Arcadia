/**
 * Steam's featured categories.
 *
 * Chosen over the search endpoint because it returns the AppID as a field.
 * The search endpoint hides the AppID inside a capsule image URL, and the
 * AppID is what makes the claim a deep link into the client rather than a
 * browser tab.
 */
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { parseSteamFreebies, fetchSteamFreebies } from '@main/freebies/sources/steam'

async function fixture(): Promise<unknown> {
  return JSON.parse(await readFile('test/fixtures/freebies/steam.json', 'utf8'))
}

describe('parseSteamFreebies', () => {
  it('keeps only the fully discounted game', async () => {
    const rows = parseSteamFreebies(await fixture())
    expect(rows).toEqual([
      {
        storeId: 'steam',
        title: 'Free Forever Game',
        kind: 'game',
        storeGameId: '1145360',
        imageUrl: 'https://shared.akamai.steamstatic.com/apps/1145360/header.jpg',
        source: 'steam'
      }
    ])
  })

  it('drops an item whose id is not a plain number', async () => {
    // The AppID goes straight into steam://, so anything that is not a run
    // of digits is refused here rather than at the URI boundary. Both
    // checks exist; this is the cheaper one.
    const rows = parseSteamFreebies(await fixture())
    expect(rows.map((row) => row.title)).not.toContain('No Id Game')
  })

  it('sets no end date, because the endpoint reports none', async () => {
    // Better an absent date than a guessed one: the card says "ends in 2
    // days" only where that is known.
    const rows = parseSteamFreebies(await fixture())
    expect(rows[0]?.endsAt).toBeUndefined()
  })

  it('survives a response that is not shaped as expected', () => {
    expect(parseSteamFreebies({})).toEqual([])
    expect(parseSteamFreebies(null)).toEqual([])
    expect(parseSteamFreebies({ specials: { items: 'no' } })).toEqual([])
  })
})

describe('fetchSteamFreebies', () => {
  it('asks for the given country and language', async () => {
    const seen: string[] = []
    const json = await fixture()
    await fetchSteamFreebies({
      country: 'DE',
      language: 'german',
      fetchFn: async (url) => {
        seen.push(url)
        return { ok: true, status: 200, json: async () => json }
      }
    })
    expect(seen[0]).toContain('cc=DE')
    expect(seen[0]).toContain('l=german')
  })

  it('throws when the endpoint refuses', async () => {
    await expect(
      fetchSteamFreebies({
        country: 'US',
        language: 'english',
        fetchFn: async () => ({ ok: false, status: 429, json: async () => ({}) })
      })
    ).rejects.toThrow('429')
  })
})
