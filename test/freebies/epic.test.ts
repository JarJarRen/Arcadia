/**
 * Epic's promotions feed.
 *
 * The response nests promotional offers twice — `promotions.promotionalOffers`
 * is an array of objects that each hold their own `promotionalOffers` array.
 * Getting that wrong yields an empty list rather than an error, which is
 * exactly the failure mode that once left the EA library silently empty.
 */
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { parseEpicFreebies, fetchEpicFreebies } from '@main/freebies/sources/epic'

const NOW = Date.parse('2026-08-10T12:00:00.000Z')

async function fixture(): Promise<unknown> {
  return JSON.parse(await readFile('test/fixtures/freebies/epic.json', 'utf8'))
}

describe('parseEpicFreebies', () => {
  it('keeps the game that is free right now', async () => {
    const rows = parseEpicFreebies(await fixture(), NOW)
    const ghost = rows.find((row) => row.title === 'Ghostrunner')
    expect(ghost).toEqual({
      storeId: 'epic',
      title: 'Ghostrunner',
      kind: 'game',
      storeGameId: 'ghostrunner',
      imageUrl: 'https://cdn1.epicgames.com/wide.jpg',
      startsAt: Date.parse('2026-08-07T15:00:00.000Z'),
      endsAt: Date.parse('2026-08-14T15:00:00.000Z'),
      source: 'epic'
    })
  })

  it('keeps the giveaway announced for next week, with its future start date', async () => {
    const rows = parseEpicFreebies(await fixture(), NOW)
    const next = rows.find((row) => row.title === 'Next Week Game')
    expect(next?.startsAt).toBe(Date.parse('2026-08-14T15:00:00.000Z'))
    expect(next?.startsAt).toBeGreaterThan(NOW)
  })

  it('drops a discount that is not the whole price', async () => {
    // 50% off is a sale, not a giveaway. The page promises permanence.
    const rows = parseEpicFreebies(await fixture(), NOW)
    expect(rows.map((row) => row.title)).not.toContain('Half Price Game')
  })

  it('falls back to the store URL when there is no page slug', async () => {
    const rows = parseEpicFreebies(await fixture(), NOW)
    const slugless = rows.find((row) => row.title === 'Slugless Game')
    expect(slugless?.storeGameId).toBeUndefined()
    expect(slugless?.claimUrl).toBe('https://store.epicgames.com/')
  })

  it('falls back to the store URL when the slug does not match the shape claim.ts requires', () => {
    // An underscore, an uppercase letter or a percent-escape would pass
    // this parser's old length-only check but fail claim.ts's stricter
    // PAGE_SLUG — producing a card that says "Claim in Epic" and fails on
    // click. Caught here instead, with the same fallback a missing slug
    // already gets.
    const rows = parseEpicFreebies(
      {
        data: {
          Catalog: {
            searchStore: {
              elements: [
                {
                  title: 'Odd Slug Game',
                  catalogNs: { mappings: [{ pageSlug: 'Not_A-Valid.Slug' }] },
                  promotions: {
                    promotionalOffers: [
                      {
                        promotionalOffers: [
                          {
                            discountSetting: { discountPercentage: 0 }
                          }
                        ]
                      }
                    ]
                  }
                }
              ]
            }
          }
        }
      },
      NOW
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.storeGameId).toBeUndefined()
    expect(rows[0]?.claimUrl).toBe('https://store.epicgames.com/')
  })

  it('drops a promotion that has already ended', async () => {
    // A stale response must not resurrect a promotion that has already closed.
    const rows = parseEpicFreebies(await fixture(), NOW)
    expect(rows.map((row) => row.title)).not.toContain('Already Ended')
  })

  it('survives a response that is not shaped as expected', () => {
    // The endpoint is undocumented; a shape change must degrade to an empty
    // list, never to a throw that takes the other two sources down with it.
    expect(parseEpicFreebies({}, NOW)).toEqual([])
    expect(parseEpicFreebies(null, NOW)).toEqual([])
    expect(parseEpicFreebies({ data: { Catalog: { searchStore: { elements: 'no' } } } }, NOW)).toEqual([])
  })
})

describe('fetchEpicFreebies', () => {
  it('asks for the given locale and country', async () => {
    const seen: string[] = []
    const json = await fixture()
    await fetchEpicFreebies({
      locale: 'de',
      country: 'DE',
      now: NOW,
      fetchFn: async (url) => {
        seen.push(url)
        return { ok: true, status: 200, json: async () => json }
      }
    })
    expect(seen[0]).toContain('locale=de')
    expect(seen[0]).toContain('country=DE')
  })

  it('throws when the endpoint refuses', async () => {
    await expect(
      fetchEpicFreebies({
        locale: 'en',
        country: 'US',
        now: NOW,
        fetchFn: async () => ({ ok: false, status: 503, json: async () => ({}) })
      })
    ).rejects.toThrow('503')
  })
})
