/**
 * From a Microsoft token to two Xbox tokens.
 *
 * Two, from one user token: the title history is served to
 * `xboxlive.com` and the entitlement service to `mp.microsoft.com`, and a
 * token minted for one audience is refused by the other.
 *
 * The refusal codes are worth naming rather than passing through. "The
 * account has no Xbox profile" is something the user can act on; XSTS
 * error 2148916233 is not.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  authenticateXboxUser,
  authorizationHeader,
  authorizeXsts,
  MARKETPLACE_RELYING_PARTY,
  XBOX_LIVE_RELYING_PARTY
} from '@main/stores/microsoft/xbox'
import type { HttpFn } from '@main/stores/microsoft/http'

function respond(status: number, body: unknown): {
  ok: boolean
  status: number
  json: () => Promise<unknown>
  text: () => Promise<string>
} {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  }
}

const XSTS_BODY = {
  Token: 'xsts-token',
  DisplayClaims: { xui: [{ uhs: 'user-hash', xid: '2533274800000000', gtg: 'Gamertag' }] }
}

describe('authenticateXboxUser', () => {
  it('exchanges the Microsoft token for an Xbox user token', async () => {
    const http = vi.fn(async () => respond(200, { Token: 'user-token' }))

    expect(await authenticateXboxUser('ms-access', { http })).toBe('user-token')
  })

  it('sends the access token as an RPS ticket', async () => {
    // `vi.fn<HttpFn>` rather than plain `vi.fn`: with a zero-argument
    // implementation TS would otherwise infer `mock.calls` as `[][]`, and
    // indexing the call's second argument below would not typecheck.
    const http = vi.fn<HttpFn>(async () => respond(200, { Token: 'user-token' }))

    await authenticateXboxUser('ms-access', { http })

    expect(http.mock.calls[0]?.[1]?.body ?? '').toContain('d=ms-access')
  })

  it('reports a refusal', async () => {
    const http = vi.fn(async () => respond(401, {}))

    await expect(authenticateXboxUser('ms-access', { http })).rejects.toThrow(/401/)
  })

  it('throws when the response carries no usable token', async () => {
    const http = vi.fn(async () => respond(200, {}))

    await expect(authenticateXboxUser('ms-access', { http })).rejects.toThrow(/token/i)
  })
})

describe('authorizeXsts', () => {
  it('returns the token, the user hash and the XUID', async () => {
    const http = vi.fn(async () => respond(200, XSTS_BODY))

    expect(await authorizeXsts('user-token', XBOX_LIVE_RELYING_PARTY, { http })).toEqual({
      token: 'xsts-token',
      userHash: 'user-hash',
      xuid: '2533274800000000',
      gamertag: 'Gamertag'
    })
  })

  it('asks for the relying party it was given', async () => {
    const http = vi.fn<HttpFn>(async () => respond(200, XSTS_BODY))

    await authorizeXsts('user-token', MARKETPLACE_RELYING_PARTY, { http })

    expect(http.mock.calls[0]?.[1]?.body ?? '').toContain(MARKETPLACE_RELYING_PARTY)
  })

  it('says an account has no Xbox profile rather than quoting a number', async () => {
    const http = vi.fn(async () => respond(401, { XErr: 2148916233 }))

    await expect(authorizeXsts('user-token', XBOX_LIVE_RELYING_PARTY, { http })).rejects.toThrow(
      /Xbox profile/i
    )
  })

  it('says a child account needs a family rather than quoting a number', async () => {
    const http = vi.fn(async () => respond(401, { XErr: 2148916238 }))

    await expect(authorizeXsts('user-token', XBOX_LIVE_RELYING_PARTY, { http })).rejects.toThrow(
      /family/i
    )
  })

  it('keeps the number for a refusal it does not name', async () => {
    const http = vi.fn(async () => respond(401, { XErr: 2148916235 }))

    await expect(authorizeXsts('user-token', XBOX_LIVE_RELYING_PARTY, { http })).rejects.toThrow(
      /2148916235/
    )
  })

  it('falls back to the HTTP status when the refusal carries no XErr', async () => {
    const http = vi.fn(async () => respond(401, {}))

    await expect(authorizeXsts('user-token', XBOX_LIVE_RELYING_PARTY, { http })).rejects.toThrow(
      /401/
    )
  })

  it('throws when the response is missing usable claims', async () => {
    const http = vi.fn(async () => respond(200, { Token: 'xsts-token' }))

    await expect(authorizeXsts('user-token', XBOX_LIVE_RELYING_PARTY, { http })).rejects.toThrow(
      /claims/i
    )
  })

  it('throws when the response has claims but no token', async () => {
    const http = vi.fn(async () =>
      respond(200, { DisplayClaims: XSTS_BODY.DisplayClaims })
    )

    await expect(authorizeXsts('user-token', XBOX_LIVE_RELYING_PARTY, { http })).rejects.toThrow(
      /claims/i
    )
  })

  it('falls back to an empty XUID and gamertag when the claims omit them', async () => {
    const http = vi.fn(async () =>
      respond(200, { Token: 'xsts-token', DisplayClaims: { xui: [{ uhs: 'user-hash' }] } })
    )

    expect(await authorizeXsts('user-token', XBOX_LIVE_RELYING_PARTY, { http })).toEqual({
      token: 'xsts-token',
      userHash: 'user-hash',
      xuid: '',
      gamertag: ''
    })
  })
})

describe('authorizationHeader', () => {
  it('builds the XBL3.0 header both services expect', () => {
    expect(
      authorizationHeader({ token: 'tok', userHash: 'uhs', xuid: 'x', gamertag: 'g' })
    ).toBe('XBL3.0 x=uhs;tok')
  })
})
