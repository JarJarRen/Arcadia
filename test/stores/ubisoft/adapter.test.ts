import { describe, expect, it } from 'vitest'
import { nameFromInstallDir, UbisoftAdapter } from '@main/stores/ubisoft'
import { gameId, type Game } from '@shared/types'

/**
 * Simulates reg.exe for the four real entries of the development machine.
 *
 * The distinction is made on the **last path segment** of the queried key,
 * not on the whole path. That matters because `readRegistrySubKeys` returns
 * the long form `HKEY_LOCAL_MACHINE\…`, the adapter carries on with that
 * long form, while the constants in the code use the short form `HKLM\…`.
 * reg.exe accepts both — a stub checking the full path would wrongly miss
 * here and fake a bug that does not exist.
 */
function execStub(present = true) {
  return async (command: string): Promise<string> => {
    if (!present) throw new Error('not found')

    const key = /reg query "([^"]+)"/.exec(command)?.[1] ?? ''
    const segment = key.split('\\').pop() ?? ''

    if (segment === '1771') {
      return `\r\n${key}\r\n    Language    REG_SZ    en-US\r\n    InstallDir    REG_SZ    D:/Ubisoft Game Launcher/games/Ranger's Creed Example/\r\n`
    }
    if (segment === '856') {
      // Lower case, exactly as found on the development machine.
      return `\r\n${key}\r\n    installdir    REG_SZ    E:\\SteamLibrary\\steamapps\\common\\Far Cry 4\r\n    language    REG_SZ    en-US\r\n`
    }
    if (segment === '7013') {
      // Orphaned entry without a path.
      return `\r\n${key}\r\n    language    REG_SZ    en-US\r\n`
    }
    if (segment === 'Installs') {
      return [
        '',
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs',
        '',
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs\\1771',
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs\\7013',
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs\\856',
        ''
      ].join('\r\n')
    }
    if (segment === 'Launcher') {
      return `\r\n${key}\r\n    InstallDir    REG_SZ    D:\\Ubisoft Game Launcher\\\r\n`
    }
    throw new Error('not found')
  }
}

function game(id: string): Game {
  return {
    id: gameId('ubisoft', id),
    storeId: 'ubisoft',
    storeGameId: id,
    name: 'X',
    installed: true,
    favorite: false,
    hidden: false,
    firstSeen: 0,
    lastSeen: 0
  }
}

describe('nameFromInstallDir', () => {
  it('takes the last folder name', () => {
    expect(nameFromInstallDir("D:/Ubisoft Game Launcher/games/Falcon's Watch Example/")).toBe(
      "Falcon's Watch Example"
    )
  })

  it('copes with backslashes and a missing trailing slash', () => {
    expect(nameFromInstallDir('E:\\SteamLibrary\\steamapps\\common\\Far Cry 4')).toBe(
      'Far Cry 4'
    )
  })

  it('returns undefined for an empty or unusable path', () => {
    expect(nameFromInstallDir('')).toBeUndefined()
    expect(nameFromInstallDir('/')).toBeUndefined()
    expect(nameFromInstallDir('E:\\')).toBeUndefined()
  })
})

describe('UbisoftAdapter', () => {
  it('reports itself unavailable when the launcher is missing', async () => {
    const adapter = new UbisoftAdapter({ exec: execStub(false) })
    expect((await adapter.isAvailable()).available).toBe(false)
  })

  it('reads the installed games', async () => {
    const adapter = new UbisoftAdapter({ exec: execStub(), readCatalogue: async () => new Map() })
    const games = await adapter.scanInstalled()
    expect(games.map((entry) => entry.name).sort()).toEqual([
      'Far Cry 4',
      "Ranger's Creed Example"
    ])
  })

  it('skips entries without an install path', async () => {
    // On the development machine 7013 carries only a language and no path.
    const adapter = new UbisoftAdapter({ exec: execStub(), readCatalogue: async () => new Map() })
    expect((await adapter.scanInstalled()).map((entry) => entry.storeGameId)).not.toContain(
      '7013'
    )
  })

  it('finds the path even with a lower-case value name', async () => {
    // Entry 856 writes "installdir", 1771 writes "InstallDir".
    const adapter = new UbisoftAdapter({ exec: execStub(), readCatalogue: async () => new Map() })
    const farCry = (await adapter.scanInstalled()).find((entry) => entry.storeGameId === '856')
    expect(farCry?.installPath).toBe('E:\\SteamLibrary\\steamapps\\common\\Far Cry 4')
  })

  it('works with the long key form that reg query returns', async () => {
    // readRegistrySubKeys returns "HKEY_LOCAL_MACHINE\…" while the adapter
    // constants use "HKLM\…". The adapter has to pass the returned long
    // form through unchanged — reg.exe accepts both.
    const queried: string[] = []
    const adapter = new UbisoftAdapter({
      exec: async (command) => {
        queried.push(command)
        return execStub()(command)
      },
      readCatalogue: async () => new Map()
    })
    await adapter.scanInstalled()
    expect(
      queried.some((c) => c.includes('HKEY_LOCAL_MACHINE') && c.includes('1771'))
    ).toBe(true)
  })

  it('prefers the catalogue name over the folder name', async () => {
    // The folder is called "Far Cry 4"; the catalogue knows the real title.
    // This is what retires the old "names come from folders" limitation.
    const adapter = new UbisoftAdapter({
      exec: execStub(),
      readCatalogue: async () => new Map([['856', 'Far Cry® 4 Gold Edition']])
    })
    const games = await adapter.scanInstalled()
    expect(games.find((g) => g.storeGameId === '856')?.name).toBe('Far Cry® 4 Gold Edition')
    // 1771 is not in the catalogue here and keeps its folder name, so a game
    // the catalogue has never heard of does not vanish.
    expect(games.find((g) => g.storeGameId === '1771')?.name).toBe("Ranger's Creed Example")
  })

  it('reads the owned games and names them from the catalogue', async () => {
    const adapter = new UbisoftAdapter({
      exec: execStub(),
      readOwnedIds: async () => ['4', '635', '856'],
      readCatalogue: async () =>
        new Map([
          ['4', "Assassin's Creed II"],
          ['635', "Tom Clancy's Rainbow Six® Siege"],
          ['856', 'Far Cry® 4']
        ])
    })
    expect(await adapter.scanOwned()).toEqual([
      { storeGameId: '4', name: "Assassin's Creed II", installed: false },
      { storeGameId: '635', name: "Tom Clancy's Rainbow Six® Siege", installed: false },
      { storeGameId: '856', name: 'Far Cry® 4', installed: false }
    ])
  })

  it('leaves out an owned game the catalogue cannot name', async () => {
    // Entry 856 is called "GAMENAME" in the real catalogue, which
    // configuration.ts reports as no name at all.
    const adapter = new UbisoftAdapter({
      exec: execStub(),
      readOwnedIds: async () => ['4', '856'],
      readCatalogue: async () => new Map([['4', "Assassin's Creed II"]])
    })
    expect((await adapter.scanOwned()).map((g) => g.storeGameId)).toEqual(['4'])
  })

  it('reports nothing owned rather than failing when the cache is missing', async () => {
    // No network is involved anywhere here, so unlike EA there is nothing
    // that could justify throwing.
    const adapter = new UbisoftAdapter({
      exec: execStub(),
      readOwnedIds: async () => [],
      readCatalogue: async () => new Map()
    })
    expect(await adapter.scanOwned()).toEqual([])
  })

  it('gives owned games the same IDs the registry uses', async () => {
    // 856 is both installed and owned. Different identifiers would put one
    // game in the library twice.
    const adapter = new UbisoftAdapter({
      exec: execStub(),
      readOwnedIds: async () => ['856'],
      readCatalogue: async () => new Map([['856', 'Far Cry® 4']])
    })
    const installed = await adapter.scanInstalled()
    const owned = await adapter.scanOwned()
    expect(owned[0]?.storeGameId).toBe(
      installed.find((g) => g.storeGameId === '856')?.storeGameId
    )
  })

  it('builds the launch URI', () => {
    const adapter = new UbisoftAdapter({ exec: execStub(), readCatalogue: async () => new Map() })
    expect(adapter.launchUri(game('856'))).toBe('uplay://launch/856/0')
  })

  it('refuses the launch URI for a non-numeric ID', () => {
    const adapter = new UbisoftAdapter({ exec: execStub(), readCatalogue: async () => new Map() })
    for (const bad of ['856; x', '../1', '']) {
      expect(() => adapter.launchUri(game(bad)), `ID "${bad}"`).toThrow(/Ubisoft/i)
    }
  })
})
