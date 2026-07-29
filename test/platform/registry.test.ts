import { describe, expect, it } from 'vitest'
import {
  findValue,
  parseRegQueryOutput,
  readRegistrySubKeys,
  readRegistryTree,
  readRegistryValue,
  readRegistryValues
} from '@main/platform/registry'

// Exactly the format `reg query` prints on Windows:
// blank line, key path, then indented value lines.
const OUTPUT = [
  '',
  'HKEY_CURRENT_USER\\SOFTWARE\\Valve\\Steam',
  '    SteamPath    REG_SZ    d:/steam',
  '    SteamExe    REG_SZ    d:/steam/steam.exe',
  '    RunningAppID    REG_DWORD    0x0',
  ''
].join('\r\n')

describe('parseRegQueryOutput', () => {
  it('reads value name and content', () => {
    expect(parseRegQueryOutput(OUTPUT)).toEqual({
      SteamPath: 'd:/steam',
      SteamExe: 'd:/steam/steam.exe',
      RunningAppID: '0x0'
    })
  })

  it('tolerates spaces inside the value', () => {
    const output = '\r\nHKEY_LOCAL_MACHINE\\X\r\n    InstallDir    REG_SZ    E:\\Ubisoft Game Launcher\\\r\n'
    expect(parseRegQueryOutput(output)).toEqual({
      InstallDir: 'E:\\Ubisoft Game Launcher\\'
    })
  })

  it('returns an empty object for empty output', () => {
    expect(parseRegQueryOutput('')).toEqual({})
    expect(parseRegQueryOutput('ERROR: The system was unable to find the specified registry key.')).toEqual({})
  })
})

describe('readRegistryValue', () => {
  it('returns the value', async () => {
    const exec = async (): Promise<string> => OUTPUT
    expect(await readRegistryValue('HKCU\\SOFTWARE\\Valve\\Steam', 'SteamPath', exec))
      .toBe('d:/steam')
  })

  it('returns undefined when the key is missing', async () => {
    const exec = async (): Promise<string> => {
      throw new Error('ERROR: The system was unable to find the specified registry key.')
    }
    expect(await readRegistryValue('HKCU\\Fehlt', 'X', exec)).toBeUndefined()
  })

  it('returns undefined when the value name is missing', async () => {
    const exec = async (): Promise<string> => OUTPUT
    expect(await readRegistryValue('HKCU\\SOFTWARE\\Valve\\Steam', 'GibtEsNicht', exec))
      .toBeUndefined()
  })

  it('forces UTF-8 for the output of reg.exe', async () => {
    // Without chcp 65001 reg.exe converts characters lossily: "Fallen
    // Order(tm)" becomes "Fallen OrderT", with a real 0x54 byte.
    // Not repairable afterwards, because the information is already lost
    // inside reg.exe. Verified on the development machine.
    let command_ = ''
    const exec = async (command: string): Promise<string> => {
      command_ = command
      return OUTPUT
    }
    await readRegistryValue('HKCU\\X', 'Y', exec)
    expect(command_).toContain('chcp 65001')
    expect(command_.indexOf('chcp')).toBeLessThan(command_.indexOf('reg query'))
  })
})

describe('readRegistryValues and findValue', () => {
  // Ubisoft schreibt bei einem Spiel "InstallDir", beim naechsten
  // "installdir"; EA mal "DisplayName", mal "displayname". Beim Auslesen
  // eines ganzen Schluessels kommt die echte Schreibweise zurueck — anders
  // als bei einer gezielten /v-Abfrage, die den abgefragten Namen echot.
  const GEMISCHT = [
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs\\856',
    '    installdir    REG_SZ    E:\\SteamLibrary\\steamapps\\common\\Far Cry 4',
    '    language    REG_SZ    en-US',
    ''
  ].join('\r\n')

  const FAR_CRY = 'E:\\SteamLibrary\\steamapps\\common\\Far Cry 4'

  it('reads every value of a key', async () => {
    const werte = await readRegistryValues('HKLM\\X', async () => GEMISCHT)
    expect(werte).toEqual({ installdir: FAR_CRY, language: 'en-US' })
  })

  it('finds values regardless of capitalisation', async () => {
    const werte = await readRegistryValues('HKLM\\X', async () => GEMISCHT)
    expect(findValue(werte, 'InstallDir')).toBe(FAR_CRY)
    expect(findValue(werte, 'INSTALLDIR')).toBe(FAR_CRY)
    expect(findValue(werte, 'installdir')).toBe(FAR_CRY)
    expect(findValue(werte, 'Language')).toBe('en-US')
    expect(findValue(werte, 'gibtesnicht')).toBeUndefined()
  })

  it('returns an empty object when the key is missing', async () => {
    const werte = await readRegistryValues('HKLM\\Fehlt', async () => {
      throw new Error('nicht gefunden')
    })
    expect(werte).toEqual({})
  })
})

describe('readRegistrySubKeys', () => {
  const OUT = [
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs',
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs\\1771',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs\\856',
    ''
  ].join('\r\n')

  it('lists only the subkeys, not the key itself', async () => {
    const keys = await readRegistrySubKeys(
      'HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs',
      async () => OUT
    )
    expect(keys).toEqual([
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs\\1771',
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs\\856'
    ])
  })

  it('returns an empty list when the key is missing', async () => {
    const keys = await readRegistrySubKeys('HKLM\\Fehlt', async () => {
      throw new Error('nicht gefunden')
    })
    expect(keys).toEqual([])
  })
})

describe('readRegistryTree', () => {
  const TREE = [
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\X\\{aaa}',
    '    DisplayName    REG_SZ    Erstes Programm',
    '    InstallLocation    REG_SZ    C:\\Eins\\',
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\X\\{bbb}',
    '    DisplayName    REG_SZ    Zweites Programm',
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\X\\{ccc}',
    '',
    ''
  ].join('\r\n')

  it('returns one set of values per subkey', async () => {
    const bloecke = await readRegistryTree('HKLM\\SOFTWARE\\X', async () => TREE)
    expect(bloecke).toHaveLength(3)
    expect(findValue(bloecke[0]!, 'DisplayName')).toBe('Erstes Programm')
    expect(findValue(bloecke[1]!, 'DisplayName')).toBe('Zweites Programm')
    expect(bloecke[2]).toEqual({})
  })

  it('queries only ONCE, not per subkey', async () => {
    // Several hundred keys sit under Uninstall. One query per key starts
    // just as many reg.exe processes and makes the scan unusably slow.
    
    let calls = 0
    await readRegistryTree('HKLM\\SOFTWARE\\X', async () => {
      calls++
      return TREE
    })
    expect(calls).toBe(1)
  })

  it('uses the recursive form of reg query', async () => {
    let command_ = ''
    await readRegistryTree('HKLM\\SOFTWARE\\X', async (c) => {
      command_ = c
      return TREE
    })
    expect(command_).toMatch(/\/s\b/)
    expect(command_).toContain('chcp 65001')
  })
})
