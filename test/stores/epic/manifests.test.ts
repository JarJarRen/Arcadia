import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEpicManifest, scanEpicManifests } from '@main/stores/epic/manifests'

const FIXTURES = join(__dirname, '../../fixtures/epic')
const fixture = (name: string): Promise<string> => readFile(join(FIXTURES, name), 'utf8')

/** A minimal but valid `.item` manifest for a game. */
const gameManifest = (appName: string, name: string): string =>
  JSON.stringify({
    AppName: appName,
    DisplayName: name,
    AppCategories: ['games'],
    InstallLocation: `G:\\${name}`
  })

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

describe('scanEpicManifests', () => {
  // Real directories rather than a mocked file system, matching
  // scanLibraries.test.ts: this is almost entirely I/O error handling, and a
  // mock would abstract away exactly what is being tested.
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'arcadia-epic-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reads every .item manifest in the directory', async () => {
    await writeFile(join(dir, 'a.item'), gameManifest('AppA', 'Foretales'), 'utf8')
    await writeFile(join(dir, 'b.item'), gameManifest('AppB', 'Hogwarts Legacy'), 'utf8')

    const games = await scanEpicManifests(dir)
    expect(games.map((g) => g.name).sort()).toEqual(['Foretales', 'Hogwarts Legacy'])
  })

  it('ignores files that are not .item manifests', async () => {
    await writeFile(join(dir, 'a.item'), gameManifest('AppA', 'Foretales'), 'utf8')
    // These two would each parse into a perfectly valid game if the .item
    // filter were not applied — the point is that they are skipped by
    // extension, not that their content happens to be unparseable.
    await writeFile(join(dir, 'notes.txt'), gameManifest('AppB', 'Should Not Appear'), 'utf8')
    await writeFile(join(dir, 'Manifests.mf'), gameManifest('AppC', 'Also Not'), 'utf8')

    const games = await scanEpicManifests(dir)
    expect(games.map((g) => g.name)).toEqual(['Foretales'])
  })

  it('discards manifests that parse to undefined without losing the others', async () => {
    // A plugin manifest — the same shape catalog.ts documents as coexisting
    // with real games in this directory.
    await writeFile(
      join(dir, 'plugin.item'),
      JSON.stringify({ AppName: 'Plugin', DisplayName: 'A Plugin', AppCategories: ['plugins'] }),
      'utf8'
    )
    await writeFile(join(dir, 'game.item'), gameManifest('AppA', 'Foretales'), 'utf8')

    expect((await scanEpicManifests(dir)).map((g) => g.name)).toEqual(['Foretales'])
  })

  it('skips a manifest that cannot be read without abandoning the scan', async () => {
    // A directory named *.item cannot be read with readFile — it throws
    // EISDIR — which stands in here for any manifest the file system will
    // not hand over.
    await mkdir(join(dir, 'broken.item'))
    await writeFile(join(dir, 'game.item'), gameManifest('AppA', 'Foretales'), 'utf8')

    expect((await scanEpicManifests(dir)).map((g) => g.name)).toEqual(['Foretales'])
  })

  it('returns an empty list when the manifest directory does not exist', async () => {
    expect(await scanEpicManifests(join(dir, 'does-not-exist'))).toEqual([])
  })
})
