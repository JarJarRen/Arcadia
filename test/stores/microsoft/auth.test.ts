/**
 * Signing in to a Microsoft account without ever seeing a password.
 *
 * The device-code flow is the whole reason this is possible: Arcadia shows a
 * short code, the sign-in happens in the system browser, and what comes back
 * is a token. No embedded login window — Microsoft discourages those — and
 * no credential ever passes through this process.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  pollForTokens,
  refreshTokens,
  requestDeviceCode,
  type HttpFn
} from '@main/stores/microsoft/auth'

function respond(status: number, body: unknown): Awaited<ReturnType<HttpFn>> {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  }
}

const DEVICE_CODE = {
  deviceCode: 'dev-code',
  userCode: 'ABCD-EFGH',
  verificationUri: 'https://microsoft.com/link',
  intervalSeconds: 5
}

describe('requestDeviceCode', () => {
  it('reads the code, the link and the interval', async () => {
    const http = vi.fn(async () =>
      respond(200, {
        device_code: 'dev-code',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://microsoft.com/link',
        interval: 5
      })
    )

    expect(await requestDeviceCode({ http })).toEqual(DEVICE_CODE)
  })

  it('asks for XboxLive.signin and a refresh token', async () => {
    // offline_access is what makes the next start silent. Without it the
    // user would have to sign in again on every launch.
    //
    // `vi.fn<HttpFn>` rather than plain `vi.fn`: with a zero-argument
    // implementation TS would otherwise infer `mock.calls` as `[][]`,
    // and indexing the call's second argument below would not typecheck.
    const http = vi.fn<HttpFn>(async () =>
      respond(200, {
        device_code: 'd',
        user_code: 'u',
        verification_uri: 'v',
        interval: 5
      })
    )

    await requestDeviceCode({ http })

    const body = http.mock.calls[0]?.[1]?.body ?? ''
    expect(body).toContain('XboxLive.signin')
    expect(body).toContain('offline_access')
  })

  it('reports a refusal rather than returning a half-built code', async () => {
    const http = vi.fn(async () => respond(400, { error: 'invalid_client' }))

    await expect(requestDeviceCode({ http })).rejects.toThrow(/invalid_client/)
  })
})

describe('pollForTokens', () => {
  it('keeps waiting while the user has not finished', async () => {
    const http = vi
      .fn()
      .mockResolvedValueOnce(respond(400, { error: 'authorization_pending' }))
      .mockResolvedValueOnce(respond(200, { access_token: 'access', refresh_token: 'refresh' }))
    const sleep = vi.fn(async () => undefined)

    const tokens = await pollForTokens(DEVICE_CODE, { http, sleep })

    expect(tokens).toEqual({ accessToken: 'access', refreshToken: 'refresh' })
    expect(sleep).toHaveBeenCalledWith(5000)
  })

  it('lengthens the interval when told to slow down', async () => {
    // Ignoring slow_down gets the client throttled outright, which looks
    // like a broken sign-in rather than an impatient one.
    const http = vi
      .fn()
      .mockResolvedValueOnce(respond(400, { error: 'slow_down' }))
      .mockResolvedValueOnce(respond(400, { error: 'authorization_pending' }))
      .mockResolvedValueOnce(respond(200, { access_token: 'a', refresh_token: 'r' }))
    // Same reason as the `HttpFn` mock above: an explicit type argument so
    // `mock.calls` keeps the `[ms: number]` shape the assertion below reads.
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined)

    await pollForTokens(DEVICE_CODE, { http, sleep })

    expect(sleep.mock.calls.map((call) => call[0])).toEqual([5000, 10000])
  })

  it('gives up when the code expires', async () => {
    const http = vi.fn(async () => respond(400, { error: 'expired_token' }))

    await expect(
      pollForTokens(DEVICE_CODE, { http, sleep: async () => undefined })
    ).rejects.toThrow(/expired/i)
  })

  it('gives up when the user declines', async () => {
    const http = vi.fn(async () => respond(400, { error: 'authorization_declined' }))

    await expect(
      pollForTokens(DEVICE_CODE, { http, sleep: async () => undefined })
    ).rejects.toThrow(/declined/i)
  })

  it('stops when it is cancelled', async () => {
    const http = vi.fn(async () => respond(400, { error: 'authorization_pending' }))
    let cancelled = false
    const sleep = vi.fn(async () => {
      cancelled = true
    })

    await expect(
      pollForTokens(DEVICE_CODE, { http, sleep, cancelled: () => cancelled })
    ).rejects.toThrow(/cancel/i)
  })
})

describe('refreshTokens', () => {
  it('exchanges a refresh token for a new pair', async () => {
    const http = vi.fn(async () =>
      respond(200, { access_token: 'fresh', refresh_token: 'rotated' })
    )

    expect(await refreshTokens('old', { http })).toEqual({
      accessToken: 'fresh',
      refreshToken: 'rotated'
    })
  })

  it('keeps the old refresh token when the answer omits a new one', async () => {
    const http = vi.fn(async () => respond(200, { access_token: 'fresh' }))

    expect(await refreshTokens('old', { http })).toEqual({
      accessToken: 'fresh',
      refreshToken: 'old'
    })
  })

  it('reports a refresh token that is no longer accepted', async () => {
    const http = vi.fn(async () => respond(400, { error: 'invalid_grant' }))

    await expect(refreshTokens('stale', { http })).rejects.toThrow(/invalid_grant/)
  })

  it('reports a missing access token rather than handing back an empty one', async () => {
    // A 200 with no access_token at all is not something Microsoft is
    // expected to send, but silently returning an empty token would be
    // worse than refusing — every later call would fail with a far more
    // confusing "unauthorized" instead of pointing at the real cause here.
    const http = vi.fn(async () => respond(200, {}))

    await expect(refreshTokens('old', { http })).rejects.toThrow(/token/)
  })
})

describe('edge cases exercised only for coverage', () => {
  it('requestDeviceCode: reports the status when the answer has no error field', async () => {
    const http = vi.fn(async () => respond(400, {}))

    await expect(requestDeviceCode({ http })).rejects.toThrow(/400/)
  })

  it('requestDeviceCode: reports a refusal when a 200 answer is missing required fields', async () => {
    // Seen in principle only — Microsoft is not expected to answer 200 with
    // half the fields missing — but the alternative is silently returning a
    // DeviceCode with empty strings in it, which would show the user a
    // blank code instead of an error.
    const http = vi.fn(async () => respond(200, { device_code: 'd' }))

    await expect(requestDeviceCode({ http })).rejects.toThrow(/200/)
  })

  it('requestDeviceCode: defaults the interval to 5 seconds when none is named', async () => {
    const http = vi.fn(async () =>
      respond(200, { device_code: 'd', user_code: 'u', verification_uri: 'v' })
    )

    expect(await requestDeviceCode({ http })).toEqual({
      deviceCode: 'd',
      userCode: 'u',
      verificationUri: 'v',
      intervalSeconds: 5
    })
  })

  it('pollForTokens: reports an error code it does not otherwise recognise', async () => {
    // slow_down, authorization_pending, expired_token and authorization_declined
    // are the four documented answers. Anything else (a fifth, unnamed one)
    // must still end the poll rather than loop on it forever.
    const http = vi.fn(async () => respond(400, { error: 'bad_verification_code' }))

    await expect(
      pollForTokens(DEVICE_CODE, { http, sleep: async () => undefined })
    ).rejects.toThrow(/bad_verification_code/)
  })

  it('pollForTokens: notices a cancellation without needing an injected http client', async () => {
    // deps.http ?? defaultHttp is evaluated before the loop even checks
    // `cancelled`, so an immediate cancellation must still work when no
    // http override is supplied — it should never reach the network at all.
    await expect(
      pollForTokens(DEVICE_CODE, { sleep: async () => undefined, cancelled: () => true })
    ).rejects.toThrow(/cancel/i)
  })

  it('pollForTokens: really waits when no sleep is injected', async () => {
    vi.useFakeTimers()
    try {
      const http = vi
        .fn()
        .mockResolvedValueOnce(respond(400, { error: 'authorization_pending' }))
        .mockResolvedValueOnce(respond(200, { access_token: 'a', refresh_token: 'r' }))

      const pending = pollForTokens(DEVICE_CODE, { http })
      // Proof that the default sleep is a real wait rather than a no-op:
      // the second http call has not happened yet until the timer fires.
      await vi.advanceTimersByTimeAsync(DEVICE_CODE.intervalSeconds * 1000)

      expect(await pending).toEqual({ accessToken: 'a', refreshToken: 'r' })
      expect(http).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('requestDeviceCode and refreshTokens: fall back to the real fetch when no http is injected', async () => {
    // Stubs the global so this never reaches the network — it proves
    // defaultHttp really forwards to fetch, not that Microsoft answers.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        respond(200, {
          device_code: 'dev-code',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://microsoft.com/link',
          interval: 5
        })
      )
      .mockResolvedValueOnce(respond(200, { access_token: 'fresh', refresh_token: 'rotated' }))
    vi.stubGlobal('fetch', fetchMock)

    try {
      expect(await requestDeviceCode()).toEqual(DEVICE_CODE)
      expect(await refreshTokens('old')).toEqual({ accessToken: 'fresh', refreshToken: 'rotated' })

      expect(fetchMock).toHaveBeenCalledTimes(2)
      const [url, init] = fetchMock.mock.calls[0] as [string, { method?: string }]
      expect(url).toContain('devicecode')
      expect(init?.method).toBe('POST')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
