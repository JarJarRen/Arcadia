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

describe('stripping marketing boilerplate from the title', () => {
  /** A minimal active, mapped, dated record — only `title` varies per case. */
  function record(title: string): unknown {
    return {
      id: 99,
      title,
      open_giveaway_url: 'https://www.gamerpower.com/open/x',
      type: 'Game',
      platforms: 'PC, Steam',
      end_date: 'N/A',
      status: 'Active'
    }
  }

  function titleOf(input: string): string | undefined {
    return parseGamerPowerFreebies([record(input)], NOW)[0]?.title
  }

  it('strips a trailing store parenthetical plus "Steam Key" plus "Giveaway"', () => {
    // Only a known store name in parentheses is stripped — "(Playtest)" is
    // part of the product's own name and must survive.
    expect(titleOf('Drop Loot (Playtest) Steam Key Giveaway')).toBe('Drop Loot (Playtest)')
  })

  it('leaves a bare trailing "Code" alone', () => {
    expect(titleOf('The Elder Scrolls Online: 2000 Trade Bars Code Giveaway')).toBe(
      'The Elder Scrolls Online: 2000 Trade Bars Code'
    )
  })

  it('strips a known store parenthetical and the trailing Giveaway around it', () => {
    expect(titleOf("Tom Clancy's Ghost Recon Future Soldier (Ubisoft) Giveaway")).toBe(
      "Tom Clancy's Ghost Recon Future Soldier"
    )
  })

  it('strips "(Epic Games) Giveaway" — the exact case that duplicated Beacon Pines', () => {
    expect(titleOf('Beacon Pines (Epic Games) Giveaway')).toBe('Beacon Pines')
  })

  it('leaves a title with no boilerplate untouched', () => {
    expect(titleOf('Plain Title With No Boilerplate')).toBe('Plain Title With No Boilerplate')
  })

  it('keeps the original title rather than emptying it', () => {
    // "Giveaway" alone no longer strips at all — the patterns require a
    // preceding space, and there is nothing before it. It reaches the
    // caller unchanged without the empty-result guard being involved.
    expect(titleOf('Giveaway')).toBe('Giveaway')
  })

  it('keeps a title that really does strip down to nothing', () => {
    // The leading space is what makes this one reach the empty-result
    // guard: the pattern matches " Giveaway" and leaves an empty string.
    // A blank card is worse than a slightly ugly one, so the original
    // wins — and this is the only input shape that proves that branch
    // still works.
    expect(titleOf(' Giveaway')).toBe(' Giveaway')
  })

  it('leaves "NHL 24: Hockey" alone — "key$" must not match inside "Hockey"', () => {
    expect(titleOf('NHL 24: Hockey')).toBe('NHL 24: Hockey')
  })

  it('leaves "Old Whiskey" alone — "key$" must not match inside "Whiskey"', () => {
    expect(titleOf('Old Whiskey')).toBe('Old Whiskey')
  })

  it('leaves "Assassins Creed Turkey" alone — "key$" must not match inside "Turkey"', () => {
    expect(titleOf('Assassins Creed Turkey')).toBe('Assassins Creed Turkey')
  })

  it('leaves "Endgame" alone — "game$" must not match inside a word ending in it', () => {
    expect(titleOf('Endgame')).toBe('Endgame')
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
