/**
 * The stored sign-in.
 *
 * What is kept is the refresh token and nothing else: the access tokens live
 * minutes and are re-derived at the start of a scan. It is encrypted through
 * an injected pair rather than by importing Electron — safeStorage lives in
 * the main process, and an adapter that imported it could not be tested.
 */
import { describe, expect, it, vi } from 'vitest'
import { MicrosoftSession } from '@main/stores/microsoft/session'
import { OAuthRefusedError } from '@main/stores/microsoft/auth'

function store(initial?: string): {
  read: () => string | undefined
  write: (value: string | undefined) => void
  value: () => string | undefined
} {
  let value = initial
  return {
    read: () => value,
    write: (next) => {
      value = next
    },
    value: () => value
  }
}

const XBL = { token: 'xbl', userHash: 'uhs', xuid: '123', gamertag: 'Player' }
const MP = { token: 'mp', userHash: 'uhs', xuid: '123', gamertag: 'Player' }

function session(overrides: Record<string, unknown> = {}): {
  session: MicrosoftSession
  tokens: ReturnType<typeof store>
} {
  const tokens = store(overrides.stored as string | undefined)
  return {
    tokens,
    session: new MicrosoftSession({
      store: { read: tokens.read, write: tokens.write },
      refreshTokens: async () => ({ accessToken: 'access', refreshToken: 'rotated' }),
      authenticateXboxUser: async () => 'user-token',
      authorizeXsts: async (_user: string, relyingParty: string) =>
        relyingParty.includes('mp.microsoft') ? MP : XBL,
      ...overrides
    })
  }
}

describe('MicrosoftSession', () => {
  it('is signed out when nothing is stored', () => {
    expect(session().session.isSignedIn()).toBe(false)
  })

  it('is signed in once a refresh token has been kept', () => {
    const { session: subject, tokens } = session()
    subject.signIn({ accessToken: 'a', refreshToken: 'r' })

    expect(subject.isSignedIn()).toBe(true)
    expect(tokens.value()).toBe('r')
  })

  it('answers with both audiences', async () => {
    const { session: subject } = session({ stored: 'stored-refresh' })

    expect(await subject.tokens()).toEqual({ xboxLive: XBL, marketplace: MP })
  })

  it('rotates the stored refresh token', async () => {
    // Microsoft hands back a new one; storing it is what keeps the next
    // start silent instead of asking for a second sign-in.
    const { session: subject, tokens } = session({ stored: 'stored-refresh' })
    await subject.tokens()

    expect(tokens.value()).toBe('rotated')
  })

  it('answers undefined while signed out, without calling anything', async () => {
    const refreshTokens = vi.fn()
    const { session: subject } = session({ refreshTokens })

    expect(await subject.tokens()).toBeUndefined()
    expect(refreshTokens).not.toHaveBeenCalled()
  })

  it('signs out when the refresh is refused outright', async () => {
    // A refused refresh token is dead: keeping it would make every scan
    // fail the same way for ever, with no route back but a sign-out nobody
    // knew to perform.
    const { session: subject, tokens } = session({
      stored: 'stale',
      refreshTokens: async () => {
        throw new OAuthRefusedError('invalid_grant', 'The Microsoft sign-in failed: invalid_grant')
      }
    })

    await expect(subject.tokens()).rejects.toThrow(/invalid_grant/)
    expect(tokens.value()).toBeUndefined()
    expect(subject.isSignedIn()).toBe(false)
  })

  /**
   * The reachable case, and the one that used to behave backwards.
   *
   * This test injected its failure at `authorizeXsts` before, which runs
   * *after* the refresh and outside the `try` that signs out — so it passed
   * against code that discarded the credential for every failure at the
   * refresh itself. A dropped connection there is the ordinary case: a
   * laptop that starts Arcadia before its Wi-Fi has associated.
   */
  it('keeps the sign-in when the refresh fails for want of a network', async () => {
    const { session: subject, tokens } = session({
      stored: 'good',
      refreshTokens: async () => {
        throw new Error('fetch failed')
      }
    })

    await expect(subject.tokens()).rejects.toThrow(/fetch failed/)
    expect(tokens.value()).toBe('good')
    expect(subject.isSignedIn()).toBe(true)
  })

  it('keeps the sign-in when a later step fails', async () => {
    // Everything past the refresh was always outside the sign-out path;
    // this pins that it stays that way.
    const { session: subject, tokens } = session({
      stored: 'good',
      authorizeXsts: async () => {
        throw new Error('fetch failed')
      }
    })

    await expect(subject.tokens()).rejects.toThrow(/fetch failed/)
    expect(tokens.value()).toBe('rotated')
    expect(subject.isSignedIn()).toBe(true)
  })

  it('lets a second caller retry after the shared exchange failed', async () => {
    // A failure must not be memoised either: the network coming back should
    // be enough, without restarting Arcadia.
    const refreshTokens = vi
      .fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce({ accessToken: 'access', refreshToken: 'rotated' })
    const { session: subject } = session({ stored: 'stored-refresh', refreshTokens })

    await expect(subject.tokens()).rejects.toThrow(/fetch failed/)

    expect(await subject.tokens()).toEqual({ xboxLive: XBL, marketplace: MP })
  })

  /**
   * The overlap is not hypothetical: `scan-state.ts` counts scans with a
   * depth counter precisely because a Refresh click can land while the
   * startup scan is still running. Both scans reach `tokens()`, and
   * Microsoft's consumer endpoint invalidates a refresh token the moment it
   * is presented — so a second, concurrent exchange of the *same* stored
   * token comes back `invalid_grant` and signs the user out of an account
   * they never asked to leave.
   */
  it('exchanges once for two concurrent callers, and answers both with the same tokens', async () => {
    const refreshTokens = vi.fn(async () => ({ accessToken: 'access', refreshToken: 'rotated' }))
    const { session: subject } = session({ stored: 'stored-refresh', refreshTokens })

    const [first, second] = await Promise.all([subject.tokens(), subject.tokens()])

    expect(refreshTokens).toHaveBeenCalledTimes(1)
    expect(first).toEqual({ xboxLive: XBL, marketplace: MP })
    expect(second).toBe(first)
  })

  it('starts a fresh exchange once the shared one has settled', async () => {
    // The access tokens live minutes. Holding the promise for ever would
    // hand a later scan tokens that had long since expired.
    const refreshTokens = vi.fn(async () => ({ accessToken: 'access', refreshToken: 'rotated' }))
    const { session: subject } = session({ stored: 'stored-refresh', refreshTokens })

    await subject.tokens()
    await subject.tokens()

    expect(refreshTokens).toHaveBeenCalledTimes(2)
  })

  it('reports the gamertag once it has one', async () => {
    const { session: subject } = session({ stored: 'stored-refresh' })
    await subject.tokens()

    expect(subject.gamertag()).toBe('Player')
  })

  it('forgets everything on sign-out', async () => {
    const { session: subject, tokens } = session({ stored: 'stored-refresh' })
    await subject.tokens()
    subject.signOut()

    expect(subject.isSignedIn()).toBe(false)
    expect(subject.gamertag()).toBeUndefined()
    expect(tokens.value()).toBeUndefined()
  })

  it('falls back to the real exchange when no functions are injected', async () => {
    // Stubs the global so this never reaches the network — it proves the
    // three defaults really forward to auth.ts/xbox.ts, not that Microsoft
    // answers. Task 17 is what constructs a MicrosoftSession this way.
    function respond(body: unknown): {
      ok: boolean
      status: number
      json: () => Promise<unknown>
      text: () => Promise<string>
    } {
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }
    }

    const fetchMock = vi
      .fn()
      // refreshTokens (auth.ts token endpoint)
      .mockResolvedValueOnce(respond({ access_token: 'access', refresh_token: 'rotated' }))
      // authenticateXboxUser (xbox.ts user auth endpoint)
      .mockResolvedValueOnce(respond({ Token: 'user-token' }))
      // authorizeXsts for XBOX_LIVE_RELYING_PARTY, then MARKETPLACE_RELYING_PARTY
      .mockResolvedValueOnce(
        respond({ Token: 'xbl', DisplayClaims: { xui: [{ uhs: 'uhs', xid: '123', gtg: 'Player' }] } })
      )
      .mockResolvedValueOnce(
        respond({ Token: 'mp', DisplayClaims: { xui: [{ uhs: 'uhs', xid: '123', gtg: 'Player' }] } })
      )
    vi.stubGlobal('fetch', fetchMock)

    try {
      const tokens = store('stored-refresh')
      const subject = new MicrosoftSession({ store: { read: tokens.read, write: tokens.write } })

      expect(await subject.tokens()).toEqual({ xboxLive: XBL, marketplace: MP })
      expect(tokens.value()).toBe('rotated')
      expect(fetchMock).toHaveBeenCalledTimes(4)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
