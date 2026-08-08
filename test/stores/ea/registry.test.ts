import { describe, expect, it } from 'vitest'
import { matchOffersToInstalls, normalizeForMatch, readEaInstalls } from '@main/stores/ea/registry'

describe('normalizeForMatch', () => {
  it('strips trademark symbols and normalises punctuation', () => {
    // Exactly the case from the development machine: the Origin registry
    // writes a colon, the uninstall registry a hyphen.
    expect(normalizeForMatch('STAR WARS Jedi: Fallen Order™')).toBe(
      normalizeForMatch('STAR WARS Jedi - Fallen Order™')
    )
  })

  it('ignores case and repeated spaces', () => {
    expect(normalizeForMatch('EA  SPORTS   FC™ 26')).toBe(normalizeForMatch('ea sports fc 26'))
  })

  it('leaves different games different', () => {
    expect(normalizeForMatch('FIFA 23')).not.toBe(normalizeForMatch('FIFA 24'))
    expect(normalizeForMatch('Battlefield 1')).not.toBe(normalizeForMatch('Battlefield V'))
  })
})

describe('matchOffersToInstalls', () => {
  const offers = [
    { offerId: '196485', name: 'STAR WARS Jedi: Fallen Order™' },
    { offerId: '16425677', name: 'EA SPORTS FC™ 26 The World‘s Game Edition' },
    { offerId: '16115019', name: 'EA SPORTS™ FIFA 23' },
    { offerId: '16050355', name: 'It Takes Two' }
  ]
  const installs = [
    { name: 'STAR WARS Jedi - Fallen Order™', installPath: 'G:\\origin\\Jedi Fallen Order\\' },
    { name: 'EA SPORTS FC 26', installPath: 'M:\\EA SPORTS FC 26\\', sizeBytes: 62_000_000_000 }
  ]

  it('links via the normalised name despite differing punctuation', () => {
    const games = matchOffersToInstalls(offers, installs)
    const jedi = games.find((g) => g.storeGameId === '196485')!
    expect(jedi.installed).toBe(true)
    expect(jedi.installPath).toBe('G:\\origin\\Jedi Fallen Order\\')
  })

  it('links via the prefix when a name carries an edition suffix', () => {
    // Origin calls it "… FC™ 26 The World's Game Edition", the uninstall
    // registry only "EA SPORTS FC 26".
    const fc = matchOffersToInstalls(offers, installs).find((g) => g.storeGameId === '16425677')!
    expect(fc.installed).toBe(true)
    expect(fc.installSizeBytes).toBe(62_000_000_000)
  })

  it('reports offers without an installation as not installed', () => {
    // FIFA 23 is registered on the development machine, but the folder is
    // gone.
    const fifa = matchOffersToInstalls(offers, installs).find((g) => g.storeGameId === '16115019')!
    expect(fifa.installed).toBe(false)
    expect(fifa.installPath).toBeUndefined()
  })

  it('keeps the name from the Origin registry, not the uninstall one', () => {
    // The Origin names are the more complete ones.
    const jedi = matchOffersToInstalls(offers, installs).find((g) => g.storeGameId === '196485')!
    expect(jedi.name).toBe('STAR WARS Jedi: Fallen Order™')
  })

  it('links an installation at most once', () => {
    const duplicates = [
      { offerId: '1', name: 'Same Game' },
      { offerId: '2', name: 'Same Game' }
    ]
    const games = matchOffersToInstalls(duplicates, [
      { name: 'Same Game', installPath: 'X:\\' }
    ])
    expect(games.filter((g) => g.installed)).toHaveLength(1)
  })
})

describe('readEaInstalls', () => {
  // Exactly the shape reg query /s prints: a blank line, then per subkey a
  // HKEY_ line followed by its indented values. Fakes the registry the same
  // way test/platform/registry.test.ts does for readRegistryTree, since
  // readEaInstalls is built directly on top of it.
  const PRIMARY_ROOT = [
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{ea-game}',
    '    DisplayName    REG_SZ    STAR WARS Jedi: Fallen Order (TM)',
    '    InstallLocation    REG_SZ    G:\\Games\\Jedi Fallen Order\\',
    '    Publisher    REG_SZ    Electronic Arts',
    '    EstimatedSize    REG_DWORD    0x186a0',
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{other-game}',
    '    DisplayName    REG_SZ    Some Other Game',
    '    InstallLocation    REG_SZ    D:\\Games\\Other\\',
    '    Publisher    REG_SZ    Some Other Publisher',
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{ea-app}',
    '    DisplayName    REG_SZ    EA app',
    '    InstallLocation    REG_SZ    C:\\Program Files\\EA Desktop\\',
    '    Publisher    REG_SZ    Electronic Arts',
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{no-name}',
    '    InstallLocation    REG_SZ    H:\\Games\\Nameless\\',
    '    Publisher    REG_SZ    Electronic Arts',
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{no-path}',
    '    DisplayName    REG_SZ    Missing Path Game',
    '    Publisher    REG_SZ    Electronic Arts',
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{empty-path}',
    '    DisplayName    REG_SZ    Empty Path Game',
    '    InstallLocation    REG_SZ    ',
    '    Publisher    REG_SZ    Electronic Arts',
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{zero-size}',
    '    DisplayName    REG_SZ    Battlefield 1',
    '    InstallLocation    REG_SZ    E:\\Games\\Battlefield 1\\',
    '    Publisher    REG_SZ    Electronic Arts',
    '    EstimatedSize    REG_DWORD    0x0',
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{bad-size}',
    '    DisplayName    REG_SZ    Dead Space',
    '    InstallLocation    REG_SZ    F:\\Games\\Dead Space\\',
    '    Publisher    REG_SZ    Electronic Arts',
    '    EstimatedSize    REG_SZ    not-a-number',
    ''
  ].join('\r\n')

  const WOW_ROOT = [
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{32bit-ea-game}',
    '    DisplayName    REG_SZ    Need for Speed Heat',
    '    InstallLocation    REG_SZ    J:\\Games\\NFS Heat\\',
    '    Publisher    REG_SZ    Electronic Arts',
    ''
  ].join('\r\n')

  // Routes on which of the two UNINSTALL_KEYS roots the command targets,
  // the same way a real `reg query "<key>" /s` would answer for each.
  const exec = async (command: string): Promise<string> =>
    command.includes('WOW6432Node') ? WOW_ROOT : PRIMARY_ROOT

  it('collects EA installs from both the 64-bit and the WOW6432Node uninstall roots', async () => {
    const installs = await readEaInstalls(exec)
    const names = installs.map((i) => i.name)
    expect(names).toContain('STAR WARS Jedi: Fallen Order (TM)')
    expect(names).toContain('Need for Speed Heat')
  })

  it('excludes entries that are not recognisably from EA', async () => {
    const installs = await readEaInstalls(exec)
    expect(installs.some((i) => i.name === 'Some Other Game')).toBe(false)
  })

  it('excludes the EA app launcher itself', async () => {
    // "EA app" is EA's own launcher, not a game — it carries the same
    // publisher signature as everything else here, so only the exact-name
    // check keeps it out.
    const installs = await readEaInstalls(exec)
    expect(installs.some((i) => i.name === 'EA app')).toBe(false)
  })

  it('skips entries without a display name', async () => {
    const installs = await readEaInstalls(exec)
    expect(installs.some((i) => i.installPath === 'H:\\Games\\Nameless\\')).toBe(false)
  })

  it('skips entries without an install location', async () => {
    const installs = await readEaInstalls(exec)
    expect(installs.some((i) => i.name === 'Missing Path Game')).toBe(false)
  })

  it('skips entries with an empty install location', async () => {
    const installs = await readEaInstalls(exec)
    expect(installs.some((i) => i.name === 'Empty Path Game')).toBe(false)
  })

  it('converts EstimatedSize from hex kilobytes to bytes', async () => {
    const jedi = (await readEaInstalls(exec)).find(
      (i) => i.name === 'STAR WARS Jedi: Fallen Order (TM)'
    )!
    // 0x186a0 = 100,000 KB.
    expect(jedi.sizeBytes).toBe(100_000 * 1024)
  })

  it('leaves the size unset when EstimatedSize is zero or not a number', async () => {
    const installs = await readEaInstalls(exec)
    const battlefield = installs.find((i) => i.name === 'Battlefield 1')!
    const deadSpace = installs.find((i) => i.name === 'Dead Space')!
    expect(battlefield.sizeBytes).toBeUndefined()
    expect(deadSpace.sizeBytes).toBeUndefined()
  })
})
