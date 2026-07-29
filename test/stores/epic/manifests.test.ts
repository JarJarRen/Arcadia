import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseEpicManifest } from '@main/stores/epic/manifests'

const FIXTURES = join(__dirname, '../../fixtures/epic')
const fixture = (name: string): Promise<string> => readFile(join(FIXTURES, name), 'utf8')

describe('parseEpicManifest', () => {
  it('reads a game', async () => {
    expect(parseEpicManifest(await fixture('game.item'))).toEqual({
      // The stable identifier is the catalogue ID, not the AppName: only
      // that one also applies to owned but uninstalled games.
      storeGameId: '543284ed36b746099afd292d55a0cc63',
      launchId: '4256d7c7170f4326a1a861d0b30f1af7',
      name: 'Foretales',
      installed: true,
      installPath: 'G:\\Foretales',
      installSizeBytes: 1714382780
    })
  })

  it('discards the Unreal Engine, because it is not a game', async () => {
    // AppCategories is the only reliable signal. MainGameAppName does NOT
    // work for this: for real games it is empty, not equal to AppName —
    // checked on the development machine.
    expect(parseEpicManifest(await fixture('engine.item'))).toBeUndefined()
  })

  it('discards plugins', async () => {
    expect(parseEpicManifest(await fixture('plugin.item'))).toBeUndefined()
  })

  it('marks incomplete installations as not installed', () => {
    const raw = JSON.stringify({
      AppName: 'x',
      DisplayName: 'Half a game',
      InstallLocation: 'G:\\X',
      AppCategories: ['games'],
      bIsIncompleteInstall: true
    })
    expect(parseEpicManifest(raw)?.installed).toBe(false)
  })

  it('returns undefined when AppName or DisplayName is missing', () => {
    expect(parseEpicManifest('{"DisplayName":"No ID","AppCategories":["games"]}')).toBeUndefined()
    expect(parseEpicManifest('{"AppName":"x","AppCategories":["games"]}')).toBeUndefined()
  })

  it('returns undefined when AppCategories is missing', () => {
    // Without the categories there is no deciding whether it is a game.
    // When in doubt, leave it out rather than smuggling in tools.
    expect(parseEpicManifest('{"AppName":"x","DisplayName":"Y"}')).toBeUndefined()
  })

  it('returns undefined instead of throwing when the JSON is broken', () => {
    expect(parseEpicManifest('{not json')).toBeUndefined()
  })

  it('rejects AppNames that must not enter a URI', () => {
    // The AppName travels into com.epicgames.launcher://apps/<AppName>.
    // Epic issues hex identifiers or labels such as "UE_5.7".
    for (const appName of ['a b', 'a/b', 'a?b', 'a#b', '']) {
      const raw = JSON.stringify({
        AppName: appName,
        DisplayName: 'X',
        AppCategories: ['games']
      })
      expect(parseEpicManifest(raw), `AppName "${appName}"`).toBeUndefined()
    }
  })
})
