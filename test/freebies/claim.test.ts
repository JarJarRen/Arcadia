/**
 * The only place a claim target is built.
 *
 * Two of the three sources are outside Arcadia's control, and one of them
 * is a third party whose response is JSON Arcadia never validates upstream.
 * Everything that reaches shell.openExternal passes through here first.
 */
import { describe, expect, it } from 'vitest'
import type { Freebie } from '@shared/freebies'
import { claimTarget } from '@main/freebies/claim'

function row(overrides: Partial<Freebie>): Freebie {
  return {
    id: 'steam:test',
    storeId: 'steam',
    title: 'Test',
    kind: 'game',
    source: 'steam',
    claim: 'unclaimed',
    ...overrides
  }
}

describe('claimTarget', () => {
  it('builds the Steam client store page from an AppID', () => {
    expect(claimTarget(row({ storeId: 'steam', storeGameId: '1145360' }))).toBe(
      'steam://store/1145360'
    )
  })

  it('builds the Epic launcher store page from a page slug', () => {
    expect(
      claimTarget(row({ storeId: 'epic', source: 'epic', storeGameId: 'ghostrunner' }))
    ).toBe('com.epicgames.launcher://store/p/ghostrunner')
  })

  it('falls back to an https URL where there is no store identifier', () => {
    expect(
      claimTarget(
        row({
          storeId: 'ubisoft',
          source: 'gamerpower',
          claimUrl: 'https://www.gamerpower.com/open/x'
        })
      )
    ).toBe('https://www.gamerpower.com/open/x')
  })

  it.each([
    ['javascript:alert(1)'],
    ['file:///C:/Windows/System32/calc.exe'],
    ['data:text/html,<script>alert(1)</script>'],
    ['http://www.gamerpower.com/open/x'],
    ['steam://install/1145360'],
    ['not a url at all'],
    ['']
  ])('refuses the URL %s', (claimUrl) => {
    // Plain http is refused alongside the exotic schemes: it is downgrade
    // -able, and every store Arcadia knows serves https.
    expect(() => claimTarget(row({ source: 'gamerpower', claimUrl }))).toThrow()
  })

  it('refuses an https URL on a host that is not a store Arcadia knows', () => {
    expect(() =>
      claimTarget(row({ source: 'gamerpower', claimUrl: 'https://evil.example.com/open/x' }))
    ).toThrow()
  })

  it('refuses a host that merely ends with an allowed one', () => {
    // notgamerpower.com must not pass because it ends in gamerpower.com.
    expect(() =>
      claimTarget(row({ source: 'gamerpower', claimUrl: 'https://notgamerpower.com/x' }))
    ).toThrow()
  })

  it('accepts a subdomain of an allowed host', () => {
    expect(
      claimTarget(row({ source: 'gamerpower', claimUrl: 'https://store.ubisoft.com/x' }))
    ).toBe('https://store.ubisoft.com/x')
  })

  it.each([['12abc'], ['../../evil'], ['1145360/../x'], [''], ['-1']])(
    'refuses the Steam AppID %s',
    (storeGameId) => {
      expect(() => claimTarget(row({ storeId: 'steam', storeGameId }))).toThrow()
    }
  )

  it.each([['../evil'], ['Ghost Runner'], ['ghost/runner'], [''], ['-leading-dash']])(
    'refuses the Epic slug %s',
    (storeGameId) => {
      expect(() => claimTarget(row({ storeId: 'epic', source: 'epic', storeGameId }))).toThrow()
    }
  )

  it('refuses a row with neither an identifier nor a URL', () => {
    expect(() => claimTarget(row({}))).toThrow()
  })

  it('falls back to the claim URL for a storeGameId on a store with no URI scheme', () => {
    // GamerPower can attach a storeGameId for a store Arcadia has no deep
    // link for (e.g. ubisoft). That identifier is not a Steam AppID or an
    // Epic slug, so it must not be treated as one; the https fallback is
    // still the right target.
    expect(
      claimTarget(
        row({
          storeId: 'ubisoft',
          source: 'gamerpower',
          storeGameId: 'some-ubisoft-id',
          claimUrl: 'https://store.ubisoft.com/x'
        })
      )
    ).toBe('https://store.ubisoft.com/x')
  })
})
