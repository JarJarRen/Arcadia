/**
 * The title history: names, package family names, last played.
 *
 * Two jobs. It supplies the last-played date that collections has no idea
 * about, and its package family names are what identify an installed
 * package as a game — which is how a Store-bought game installed outside
 * the Xbox app becomes visible at all.
 */
import { describe, expect, it, vi } from 'vitest'
import { readPlayedTitles } from '@main/stores/microsoft/titlehub'
import type { HttpFn } from '@main/stores/microsoft/http'

const TOKEN = { token: 'tok', userHash: 'uhs', xuid: '2533', gamertag: 'g' }

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

const TITLES = {
  titles: [
    {
      name: 'Forza Horizon',
      devices: ['PC'],
      pfn: 'Microsoft.Forza_8wekyb3d8bbwe',
      titleHistory: { lastTimePlayed: '2026-01-02T03:04:05.000Z' }
    },
    {
      name: 'Halo on the console only',
      devices: ['XboxOne'],
      pfn: 'Microsoft.Halo_8wekyb3d8bbwe',
      titleHistory: { lastTimePlayed: '2025-01-01T00:00:00.000Z' }
    },
    { name: 'A title with no package', devices: ['PC'] }
  ]
}

describe('readPlayedTitles', () => {
  it('reads the name, the package family name and the last-played time', async () => {
    const http = vi.fn(async () => respond(200, TITLES))

    const titles = await readPlayedTitles(TOKEN, { http })

    expect(titles).toEqual([
      {
        packageFamilyName: 'Microsoft.Forza_8wekyb3d8bbwe',
        name: 'Forza Horizon',
        lastPlayed: Math.floor(Date.parse('2026-01-02T03:04:05.000Z') / 1000)
      }
    ])
  })

  it('leaves out titles that cannot run on a PC', async () => {
    const http = vi.fn(async () => respond(200, TITLES))

    const titles = await readPlayedTitles(TOKEN, { http })

    expect(titles.map((title) => title.name)).not.toContain('Halo on the console only')
  })

  it('leaves out a title with no package family name', async () => {
    // Nothing to key it on, nothing to launch, nothing to match against a
    // local install.
    const http = vi.fn(async () => respond(200, TITLES))

    expect((await readPlayedTitles(TOKEN, { http })).length).toBe(1)
  })

  it('accepts Win32 as a PC device', async () => {
    const http = vi.fn(async () =>
      respond(200, {
        titles: [{ name: 'A', devices: ['Win32'], pfn: 'A_pub' }]
      })
    )

    expect((await readPlayedTitles(TOKEN, { http })).length).toBe(1)
  })

  it('leaves lastPlayed out when the history has none', async () => {
    const http = vi.fn(async () => respond(200, { titles: [{ name: 'A', devices: ['PC'], pfn: 'A_pub' }] }))

    expect(await readPlayedTitles(TOKEN, { http })).toEqual([
      { packageFamilyName: 'A_pub', name: 'A' }
    ])
  })

  it('asks with the XUID and the contract version the service needs', async () => {
    // `vi.fn<HttpFn>` rather than plain `vi.fn`: with a zero-argument
    // implementation TS would otherwise infer `mock.calls` as `[][]`, and
    // indexing the call's second argument below would not typecheck.
    const http = vi.fn<HttpFn>(async () => respond(200, { titles: [] }))

    await readPlayedTitles(TOKEN, { http })

    expect(http.mock.calls[0]?.[0]).toContain('xuid(2533)')
    expect(http.mock.calls[0]?.[1]?.headers?.['x-xbl-contract-version']).toBe('2')
  })

  it('throws on a refusal', async () => {
    const http = vi.fn(async () => respond(401, {}))

    await expect(readPlayedTitles(TOKEN, { http })).rejects.toThrow(/401/)
  })

  it('refuses to ask with an empty XUID rather than send a malformed request', async () => {
    // `authorizeXsts` silently defaults `xuid` to '' when the Xbox claims
    // carry no `xid`. Interpolated straight into the URL that becomes
    // `xuid()`, a malformed call to a live Microsoft service — fail fast
    // instead, before any request goes out.
    const http = vi.fn(async () => respond(200, { titles: [] }))
    const token = { ...TOKEN, xuid: '' }

    await expect(readPlayedTitles(token, { http })).rejects.toThrow(/player id/i)
    expect(http).not.toHaveBeenCalled()
  })

  it('treats a response with no titles field as an empty library', async () => {
    const http = vi.fn(async () => respond(200, {}))

    expect(await readPlayedTitles(TOKEN, { http })).toEqual([])
  })

  it('leaves out a title with no usable name', async () => {
    const http = vi.fn(async () =>
      respond(200, { titles: [{ devices: ['PC'], pfn: 'A_pub' }] })
    )

    expect(await readPlayedTitles(TOKEN, { http })).toEqual([])
  })

  it('leaves out a title with no device list at all', async () => {
    // Nothing to check against `PC_DEVICES`, so it cannot be trusted to run
    // here — the same outcome as a device list that names only consoles.
    const http = vi.fn(async () => respond(200, { titles: [{ name: 'A', pfn: 'A_pub' }] }))

    expect(await readPlayedTitles(TOKEN, { http })).toEqual([])
  })

  it('leaves lastPlayed out when the history has an unparseable date', async () => {
    const http = vi.fn(async () =>
      respond(200, {
        titles: [
          {
            name: 'A',
            devices: ['PC'],
            pfn: 'A_pub',
            titleHistory: { lastTimePlayed: 'not-a-date' }
          }
        ]
      })
    )

    expect(await readPlayedTitles(TOKEN, { http })).toEqual([
      { packageFamilyName: 'A_pub', name: 'A' }
    ])
  })
})
