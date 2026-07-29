import { describe, expect, it } from 'vitest'
import { fetchOwnedGames, SteamApiError } from '@main/stores/steam/webApi'

function respond(status: number, body: unknown) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  })
}

const OPTIONS = { apiKey: 'TESTKEY', steamId64: '76561197960287930' }

describe('fetchOwnedGames', () => {
  it('converts the response into RawGame', async () => {
    const games = await fetchOwnedGames({
      ...OPTIONS,
      fetchFn: respond(200, {
        response: {
          game_count: 2,
          games: [
            {
              appid: 440,
              name: 'Team Fortress 2',
              playtime_forever: 120,
              rtime_last_played: 1699500000
            },
            {
              appid: 730,
              name: 'Counter-Strike 2',
              playtime_forever: 0,
              rtime_last_played: 0
            }
          ]
        }
      })
    })

    expect(games).toEqual([
      {
        storeGameId: '440',
        name: 'Team Fortress 2',
        installed: false,
        playtimeMinutes: 120,
        lastPlayed: 1699500000
      },
      {
        storeGameId: '730',
        name: 'Counter-Strike 2',
        installed: false,
        playtimeMinutes: 0
      }
    ])
  })

  it('marks even a game reported as installed as not installed', async () => {
    // Even if the API were ever to supply such a field, it must not
    // take effect: what is installed is decided solely by the local
    // manifest scan.
    const games = await fetchOwnedGames({
      ...OPTIONS,
      fetchFn: respond(200, {
        response: {
          game_count: 1,
          games: [{ appid: 1, name: 'X', playtime_forever: 0, installed: true }]
        }
      })
    })
    expect(games[0]!.installed).toBe(false)
  })

  it('throws SteamApiError rather than TypeError for a JSON null body', async () => {
    // JSON.parse('null') returns null without throwing. Without a shape
    // check, reaching for .response would produce a bare TypeError and
    // break the promise that every failure is a SteamApiError.
    for (const body of [null, 'kein Objekt', 42, []]) {
      let caught: unknown
      try {
        await fetchOwnedGames({ ...OPTIONS, fetchFn: respond(200, body) })
      } catch (error) {
        caught = error
      }
      expect(caught, `Body ${JSON.stringify(body)}`).toBeInstanceOf(SteamApiError)
      expect((caught as SteamApiError).kind).toBe('unexpected')
    }
  })

  it('treats response: null like an unexpected shape', async () => {
    await expect(
      fetchOwnedGames({ ...OPTIONS, fetchFn: respond(200, { response: null }) })
    ).rejects.toBeInstanceOf(SteamApiError)
  })

  it('reads game_count: null as a private profile, not an empty library', async () => {
    try {
      await fetchOwnedGames({
        ...OPTIONS,
        fetchFn: respond(200, { response: { game_count: null } })
      })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as SteamApiError).kind).toBe('private')
    }
  })

  it('recognises a private profile by the empty response', async () => {
    // For private profiles Steam returns HTTP 200 with an empty response
    // object, not 403. Without special handling that would look like "0 games owned".
    await expect(
      fetchOwnedGames({ ...OPTIONS, fetchFn: respond(200, { response: {} }) })
    ).rejects.toThrow(SteamApiError)

    try {
      await fetchOwnedGames({ ...OPTIONS, fetchFn: respond(200, { response: {} }) })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as SteamApiError).kind).toBe('private')
      expect((error as SteamApiError).message).toMatch(/public/i)
    }
  })

  it('tells an empty account apart from a private profile', async () => {
    // game_count: 0 with the field present really does mean "no games".
    const games = await fetchOwnedGames({
      ...OPTIONS,
      fetchFn: respond(200, { response: { game_count: 0, games: [] } })
    })
    expect(games).toEqual([])
  })

  it('reports an invalid API key as an auth error', async () => {
    try {
      await fetchOwnedGames({ ...OPTIONS, fetchFn: respond(403, {}) })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as SteamApiError).kind).toBe('auth')
    }
  })

  it('reports network failures as a network error', async () => {
    const fetchFn = async (): Promise<never> => {
      throw new Error('getaddrinfo ENOTFOUND')
    }
    try {
      await fetchOwnedGames({ ...OPTIONS, fetchFn })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as SteamApiError).kind).toBe('network')
    }
  })

  it('does not put the API key into an error message', async () => {
    // Fehlermeldungen landen im Log und in der UI — ein Key darf dort nie
    // auftauchen, auch nicht als Teil einer verschluckten URL.
    for (const responder of [respond(403, {}), respond(500, {})]) {
      try {
        await fetchOwnedGames({ ...OPTIONS, apiKey: 'GEHEIM123', fetchFn: responder })
      } catch (error) {
        expect((error as Error).message).not.toContain('GEHEIM123')
      }
    }

    const throwing = async (): Promise<never> => {
      throw new Error('failed: https://api.steampowered.com/?key=GEHEIM123')
    }
    try {
      await fetchOwnedGames({ ...OPTIONS, apiKey: 'GEHEIM123', fetchFn: throwing })
    } catch (error) {
      expect((error as Error).message).not.toContain('GEHEIM123')
    }
  })
})
