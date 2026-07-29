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
    const adapter = new UbisoftAdapter({ exec: execStub() })
    const games = await adapter.scanInstalled()
    expect(games.map((entry) => entry.name).sort()).toEqual([
      'Far Cry 4',
      "Ranger's Creed Example"
    ])
  })

  it('skips entries without an install path', async () => {
    // On the development machine 7013 carries only a language and no path.
    const adapter = new UbisoftAdapter({ exec: execStub() })
    expect((await adapter.scanInstalled()).map((entry) => entry.storeGameId)).not.toContain(
      '7013'
    )
  })

  it('finds the path even with a lower-case value name', async () => {
    // Entry 856 writes "installdir", 1771 writes "InstallDir".
    const adapter = new UbisoftAdapter({ exec: execStub() })
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
      }
    })
    await adapter.scanInstalled()
    expect(
      queried.some((c) => c.includes('HKEY_LOCAL_MACHINE') && c.includes('1771'))
    ).toBe(true)
  })

  it('builds the launch URI', () => {
    const adapter = new UbisoftAdapter({ exec: execStub() })
    expect(adapter.launchUri(game('856'))).toBe('uplay://launch/856/0')
  })

  it('refuses the launch URI for a non-numeric ID', () => {
    const adapter = new UbisoftAdapter({ exec: execStub() })
    for (const bad of ['856; x', '../1', '']) {
      expect(() => adapter.launchUri(game(bad)), `ID "${bad}"`).toThrow(/Ubisoft/i)
    }
  })
})
