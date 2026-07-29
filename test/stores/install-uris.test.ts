import { describe, expect, it } from 'vitest'
import { SteamAdapter } from '@main/stores/steam'
import { EpicAdapter } from '@main/stores/epic'
import { EaAdapter } from '@main/stores/ea'
import { UbisoftAdapter } from '@main/stores/ubisoft'
import type { Game, StoreId } from '@shared/types'
import type { StoreAdapter } from '@main/stores/types'

function game(storeId: StoreId, storeGameId: string, o: Partial<Game> = {}): Game {
  return {
    id: `${storeId}:${storeGameId}`,
    storeId,
    storeGameId,
    name: 'Test game',
    installed: false,
    favorite: false,
    hidden: false,
    firstSeen: 0,
    lastSeen: 0,
    ...o
  }
}

describe('installUri', () => {
  it('Steam opens the install dialog', () => {
    expect(new SteamAdapter({}).installUri(game('steam', '440'))).toBe('steam://install/440')
  })

  it('Ubisoft opens the install dialog', () => {
    expect(new UbisoftAdapter().installUri(game('ubisoft', '856'))).toBe('uplay://install/856')
  })

  it('EA opens the library, because there is nothing better', () => {
    // The first attempt was `origin2://game/download?offerId=...`. Guessed,
    // and it did nothing. Then the installation's binaries were searched:
    // EA Desktop knows exactly three deep links —
    //   origin2://game/launch/?offerIds={}
    //   origin2://library/open/
    //   origin2://store/open/
    // Below game/ there are only `launch` and `key`; a verb containing
    // "install" or "download" appears in none of the 15 binaries, and
    // link2ea:// knows only `launchgame`.
    expect(new EaAdapter().installUri(game('ea', '1234'))).toBe('origin2://library/open/')
  })

  it('EA explains that only the library was opened', () => {
    // Without this hint the click would look as though it had fizzled out —
    // which is exactly how the first attempt felt.
    expect(new EaAdapter().installNotice).toMatch(/EA library/)
  })

  it('only EA carries such a hint', () => {
    // The other three genuinely install. A hint there would be an apology
    // for something that works.
    //
    // Checked through the interface rather than the classes: that is where
    // the field is documented, and only this way does it show up if an
    // adapter starts setting it silently later on.
    const withoutHint: StoreAdapter[] = [
      new SteamAdapter({}),
      new EpicAdapter(),
      new UbisoftAdapter()
    ]
    for (const adapter of withoutHint) {
      expect(adapter.installNotice, `${adapter.id} needs no hint`).toBeUndefined()
    }
  })

  it('Epic takes the catalogue identifier', () => {
    const entry = game('epic', 'catalogue-id', { launchId: 'Balsa' })
    expect(new EpicAdapter().installUri(entry)).toBe(
      'com.epicgames.launcher://apps/Balsa?action=install'
    )
  })

  it('Epic explains a missing identifier instead of inventing one', () => {
    // On the development machine that affects 2 of the 39 Epic games.
    // Handing the shell a guessed identifier would be worse than a message.
    expect(() => new EpicAdapter().installUri(game('epic', 'catalogue-id'))).toThrow(
      /no identifier/
    )
  })

  describe('validates the identifier before it reaches the shell', () => {
    // The same barrier as for launching. The URI ends up at the operating
    // system, and a value from the database may come from an older, not yet
    // validated version.
    const hostile = ['1; rm -rf /', '../../etc', '440 && calc', 'a1', '', '4 4']

    it('Steam', () => {
      for (const id of hostile) {
        expect(() => new SteamAdapter({}).installUri(game('steam', id))).toThrow()
      }
    })

    it('Ubisoft', () => {
      for (const id of hostile) {
        expect(() => new UbisoftAdapter().installUri(game('ubisoft', id))).toThrow()
      }
    })

    it('EA', () => {
      for (const id of hostile) {
        expect(() => new EaAdapter().installUri(game('ea', id))).toThrow()
      }
    })

    it('Epic rejects an illegal identifier', () => {
      for (const launchId of ['a b', 'a/b', 'a?action=launch', '../x']) {
        expect(() => new EpicAdapter().installUri(game('epic', 'k', { launchId }))).toThrow()
      }
    })
  })

  it('differs from the launch command for every store', () => {
    // An adapter that accidentally returned the same URI would launch the
    // game instead of installing it — and for a game that is not installed
    // that means nothing happens at all, with no error message.
    const cases: [{ installUri: (g: Game) => string; launchUri: (g: Game) => string }, Game][] = [
      [new SteamAdapter({}), game('steam', '440')],
      [new UbisoftAdapter(), game('ubisoft', '856')],
      [new EaAdapter(), game('ea', '1234')],
      [new EpicAdapter(), game('epic', 'k', { launchId: 'Balsa' })]
    ]
    for (const [adapter, entry] of cases) {
      expect(adapter.installUri(entry)).not.toBe(adapter.launchUri(entry))
    }
  })
})
