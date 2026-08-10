/**
 * The aggregator.
 *
 * It is the only source that sees EA, Ubisoft and Microsoft giveaways, and
 * the only one Arcadia does not control. Everything it returns is treated
 * as hostile input: the store is mapped through a fixed table, unmapped
 * platforms are dropped, and the URL is validated later in claim.ts.
 */
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import {
  parseGamerPowerFreebies,
  fetchGamerPowerFreebies
} from '@main/freebies/sources/gamerpower'

const NOW = Date.parse('2026-08-10T12:00:00.000Z')

async function fixture(): Promise<unknown> {
  return JSON.parse(await readFile('test/fixtures/freebies/gamerpower.json', 'utf8'))
}

describe('parseGamerPowerFreebies', () => {
  it('maps a Ubisoft giveaway onto the ubisoft store', async () => {
    const rows = parseGamerPowerFreebies(await fixture(), NOW)
    expect(rows.find((row) => row.title === 'Ubisoft Giveaway Game')).toEqual({
      storeId: 'ubisoft',
      title: 'Ubisoft Giveaway Game',
      kind: 'game',
      claimUrl: 'https://www.gamerpower.com/open/ubisoft-giveaway-game',
      imageUrl: 'https://www.gamerpower.com/offers/1.jpg',
      endsAt: Date.parse('2026-08-20T23:59:00Z'),
      source: 'gamerpower'
    })
  })

  it('never sets a store game id, because the feed has none', async () => {
    // Everything here claims through the browser. Inventing an identifier
    // would produce a deep link into the wrong game.
    const rows = parseGamerPowerFreebies(await fixture(), NOW)
    expect(rows.every((row) => row.storeGameId === undefined)).toBe(true)
  })

  it('keeps DLC and loot, labelled apart from games', async () => {
    const rows = parseGamerPowerFreebies(await fixture(), NOW)
    expect(rows.find((row) => row.title === 'Fall Guys Skin Pack')?.kind).toBe('dlc')
    expect(rows.find((row) => row.title === 'Beta Key Drop')?.kind).toBe('loot')
  })

  it('drops a store Arcadia does not integrate', async () => {
    // A row Arcadia cannot deep-link and cannot confirm in the library has
    // no business on the page.
    const rows = parseGamerPowerFreebies(await fixture(), NOW)
    expect(rows.map((row) => row.title)).not.toContain('GOG Only Game')
  })

  it('drops anything not currently active', async () => {
    const rows = parseGamerPowerFreebies(await fixture(), NOW)
    expect(rows.map((row) => row.title)).not.toContain('Already Over')
  })

  it('drops an offer still flagged active whose end date has passed', () => {
    // The two guards are separate and both are load-bearing: the feed has
    // been seen to leave `status` at Active past the end date, and a stale
    // response must not resurrect a promotion that has already closed.
    const rows = parseGamerPowerFreebies(
      [
        {
          id: 6,
          title: 'Active But Ended',
          thumbnail: 'https://www.gamerpower.com/offers/6.jpg',
          open_giveaway_url: 'https://www.gamerpower.com/open/active-but-ended',
          type: 'Game',
          platforms: 'PC, Steam',
          end_date: '2026-08-05 23:59:00',
          status: 'Active'
        }
      ],
      NOW
    )
    expect(rows).toEqual([])
  })

  it('leaves the end date absent when the feed says N/A', async () => {
    const rows = parseGamerPowerFreebies(await fixture(), NOW)
    expect(rows.find((row) => row.title === 'Fall Guys Skin Pack')?.endsAt).toBeUndefined()
  })

  it('survives a response that is not shaped as expected', () => {
    expect(parseGamerPowerFreebies({}, NOW)).toEqual([])
    expect(parseGamerPowerFreebies(null, NOW)).toEqual([])
    expect(parseGamerPowerFreebies(['nonsense'], NOW)).toEqual([])
  })

  it('drops an active, mapped entry with no title', () => {
    // Reaches the title guard specifically: status and platform both pass,
    // so this fails on the missing title rather than on an earlier check.
    const rows = parseGamerPowerFreebies(
      [
        {
          id: 7,
          open_giveaway_url: 'https://www.gamerpower.com/open/no-title',
          type: 'Game',
          platforms: 'PC, Steam',
          status: 'Active'
        }
      ],
      NOW
    )
    expect(rows).toEqual([])
  })

  it('drops an active, mapped entry with no giveaway URL', () => {
    // Reaches the URL guard specifically: status, title and platform all
    // pass, so this fails on the missing URL rather than on an earlier check.
    const rows = parseGamerPowerFreebies(
      [
        {
          id: 8,
          title: 'No URL Game',
          type: 'Game',
          platforms: 'PC, Steam',
          status: 'Active'
        }
      ],
      NOW
    )
    expect(rows).toEqual([])
  })
})

describe('fetchGamerPowerFreebies', () => {
  it('requests the giveaways endpoint and returns the parsed rows', async () => {
    const seen: string[] = []
    const json = await fixture()
    const rows = await fetchGamerPowerFreebies({
      now: NOW,
      fetchFn: async (url) => {
        seen.push(url)
        return { ok: true, status: 200, json: async () => json }
      }
    })
    expect(seen[0]).toBe('https://www.gamerpower.com/api/giveaways')
    expect(rows.find((row) => row.title === 'Ubisoft Giveaway Game')).toBeDefined()
  })

  it('throws when the endpoint refuses', async () => {
    await expect(
      fetchGamerPowerFreebies({
        now: NOW,
        fetchFn: async () => ({ ok: false, status: 500, json: async () => [] })
      })
    ).rejects.toThrow('500')
  })
})
