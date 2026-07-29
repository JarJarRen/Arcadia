import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseAppManifest, parseLibraryFolders } from '@main/stores/steam/manifests'

const FIXTURES = join(__dirname, '../../fixtures/steam')
const fixture = (name: string): Promise<string> => readFile(join(FIXTURES, name), 'utf8')

describe('parseLibraryFolders', () => {
  it('reads every library path in the current format', async () => {
    expect(parseLibraryFolders(await fixture('libraryfolders.vdf'))).toEqual([
      'F:\\steam',
      'D:\\SteamLibrary'
    ])
  })

  it('reads the older format too, where the path is the value directly', async () => {
    expect(parseLibraryFolders(await fixture('libraryfolders-legacy.vdf'))).toEqual([
      'D:\\SteamLibrary',
      'E:\\Games\\Steam'
    ])
  })

  it('skips bookkeeping fields such as TimeNextStatsReport', async () => {
    const paths = parseLibraryFolders(await fixture('libraryfolders-legacy.vdf'))
    expect(paths).not.toContain('1700000000')
    expect(paths).not.toContain('1234567890')
  })

  it('returns an empty array for broken content instead of throwing', () => {
    expect(parseLibraryFolders('complete nonsense {{{')).toEqual([])
  })
})

describe('parseAppManifest', () => {
  it('reads a fully installed game', async () => {
    expect(parseAppManifest(await fixture('appmanifest_440.acf'))).toEqual({
      storeGameId: '440',
      name: 'Team Fortress 2',
      installed: true,
      installPath: 'Team Fortress 2',
      installSizeBytes: 24696061952,
      lastPlayed: 1699500000
    })
  })

  it('leaves lastPlayed out when the field is missing', async () => {
    const game = parseAppManifest(await fixture('appmanifest_730.acf'))!
    expect(game.name).toBe('Counter-Strike 2')
    expect(game.lastPlayed).toBeUndefined()
  })

  it('marks incomplete downloads as not installed', async () => {
    // StateFlags 1026 = update in progress. Only bit 4 means fully
    // installed.
    const game = parseAppManifest(await fixture('appmanifest_9999.acf'))!
    expect(game.installed).toBe(false)
  })

  it('returns undefined when appid or name is missing', () => {
    expect(parseAppManifest('"AppState" { "name" "No ID" }')).toBeUndefined()
    expect(parseAppManifest('"AppState" { "appid" "1" }')).toBeUndefined()
  })

  it('returns undefined instead of throwing when the file is broken', () => {
    expect(parseAppManifest('broken {{{')).toBeUndefined()
  })

  it('rejects non-numeric AppIDs', () => {
    // The AppID later travels into the launch URI handed to the operating
    // system's shell. An .acf file may have been altered by any program
    // with write access to the Steam folder.
    for (const appId of ['440 & calc', '../../etc', '440; rm -rf /', '', 'abc']) {
      const manifest = `"AppState" { "appid" "${appId}" "name" "X" "StateFlags" "4" }`
      expect(parseAppManifest(manifest), `AppID "${appId}"`).toBeUndefined()
    }

    // The valid form of course remains permissible.
    expect(
      parseAppManifest('"AppState" { "appid" "440" "name" "X" "StateFlags" "4" }')?.storeGameId
    ).toBe('440')
  })

  it('filters Steam runtimes out by ID', async () => {
    // Steamworks Common Redistributables sits in steamapps as a perfectly
    // ordinary entry and would otherwise be a tile in the library.
    expect(parseAppManifest(await fixture('appmanifest_228980.acf'))).toBeUndefined()
  })

  it('filters Proton versions out by name pattern', () => {
    // On Linux every installed Proton version exists as its own entry, and
    // new versions keep arriving — hence a pattern rather than an ID list.
    const proton = '"AppState" { "appid" "2348590" "name" "Proton 9.0" "StateFlags" "4" }'
    expect(parseAppManifest(proton)).toBeUndefined()

    const runtime =
      '"AppState" { "appid" "1628350" "name" "Steam Linux Runtime 3.0 (sniper)" "StateFlags" "4" }'
    expect(parseAppManifest(runtime)).toBeUndefined()
  })

  it('filters out developer extras that games install alongside', () => {
    // All four sat as tiles in the library on the first real app start,
    // because they live in steamapps just like any game.
    const extras = [
      'Counter-Strike: Global Offensive - SDK',
      'RaceRoom Dedicated Server',
      "Sid Meier's Civilization VI Development Tools",
      "Sid Meier's Civilization VI Development Assets"
    ]
    for (const name of extras) {
      const manifest = `"AppState" { "appid" "1" "name" "${name}" "StateFlags" "4" }`
      expect(parseAppManifest(manifest), `${name} should be filtered`).toBeUndefined()
    }
  })

  it('leaves games alone whose title merely contains the filter words', () => {
    // The patterns are anchored: only at the end of the name, not anywhere
    // in the title.
    const titles = ['SDK Simulator Deluxe', 'Dedicated Server Tycoon 2', 'Development Hell']
    for (const name of titles) {
      const manifest = `"AppState" { "appid" "2" "name" "${name}" "StateFlags" "4" }`
      expect(parseAppManifest(manifest)?.name, `${name} must not be filtered`).toBe(name)
    }
  })

  it('leaves real games with a similar name alone', () => {
    // "Proton Pulse" is a real game. The pattern may only match
    // "Proton <digit>" and the named special cases — a bare /Proton/ would
    // wrongly fire here.
    const game =
      '"AppState" { "appid" "391750" "name" "Proton Pulse" "StateFlags" "4" "installdir" "ProtonPulse" }'
    expect(parseAppManifest(game)?.name).toBe('Proton Pulse')
  })
})
