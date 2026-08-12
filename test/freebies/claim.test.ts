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

  it('never puts the attacker-chosen part of a rejected claim address into the thrown message', () => {
    // The message this throws reaches errors.claimFailed and is rendered in
    // a UI banner. A third party choosing the words shown in Arcadia's own
    // error banner is a phishing surface, even though React's escaping
    // already rules out injection. The host is allowed — gamerpower.com — so
    // this is rejected for its credentials, not its host, which is the
    // branch that used to interpolate the whole URL including the userinfo.
    const phishText = 'free-steam-keys-click-here-now'
    try {
      claimTarget(
        row({ source: 'gamerpower', claimUrl: `https://${phishText}@gamerpower.com/x` })
      )
      throw new Error('expected claimTarget to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).not.toContain(phishText)
    }
  })

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

  it('refuses a storeGameId on a store with no URI scheme when the claim URL is hostile', () => {
    // Same shape as above, but the fallthrough must not treat a foreign
    // storeGameId as a pass for whatever claimUrl happens to be attached.
    expect(() =>
      claimTarget(
        row({
          storeId: 'ubisoft',
          source: 'gamerpower',
          storeGameId: 'some-ubisoft-id',
          claimUrl: 'https://evil.example.com/x'
        })
      )
    ).toThrow()
  })

  it('refuses a claim address that carries credentials in its authority', () => {
    // evil.com@gamerpower.com resolves to hostname gamerpower.com, so this
    // is not an open redirect — but the userinfo is attacker-controlled
    // text that must not reach shell.openExternal unexamined.
    expect(() =>
      claimTarget(row({ source: 'gamerpower', claimUrl: 'https://evil.com@gamerpower.com/x' }))
    ).toThrow()
  })

  it('refuses a non-string claimUrl instead of crashing', () => {
    // The third-party JSON this file's header warns about can hand back
    // null for a field the type says is a string. Refuse deliberately
    // rather than fail on `.length` with an unrelated TypeError.
    expect(() =>
      claimTarget(row({ source: 'gamerpower', claimUrl: null as unknown as string }))
    ).toThrow()
  })

  it('refuses a claim host with a trailing dot', () => {
    // gamerpower.com. is a different hostname string than gamerpower.com
    // and must not slip past either the exact-match or suffix-match arm.
    expect(() =>
      claimTarget(row({ source: 'gamerpower', claimUrl: 'https://gamerpower.com./x' }))
    ).toThrow()
  })

  it('refuses a claim host spoofed with a homoglyph', () => {
    // U+0430 (Cyrillic а) looks like ASCII a but punycode-encodes to a
    // different hostname entirely, so it is not on the allow-list.
    expect(() =>
      claimTarget(row({ source: 'gamerpower', claimUrl: 'https://gаmerpower.com/x' }))
    ).toThrow()
  })

  it('refuses a claim host hidden behind a percent-encoded dot', () => {
    expect(() =>
      claimTarget(row({ source: 'gamerpower', claimUrl: 'https://gamerpower.com%2eevil.com/x' }))
    ).toThrow()
  })

  it('accepts a backslash-mangled claim URL because the hostname still resolves to gamerpower.com', () => {
    // A literal backslash before @ normalises to a forward slash, so
    // @evil.com becomes part of the path rather than the authority and the
    // parsed hostname is still gamerpower.com. Pinning the exact accepted
    // value here so a future change to this behaviour is a visible diff,
    // not a silent one.
    expect(
      claimTarget(row({ source: 'gamerpower', claimUrl: 'https://gamerpower.com\\@evil.com/x' }))
    ).toBe('https://gamerpower.com/@evil.com/x')
  })
})
