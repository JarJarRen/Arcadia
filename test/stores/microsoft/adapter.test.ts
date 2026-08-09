/**
 * The Microsoft adapter's local half.
 *
 * Signed out it lists exactly what the Xbox app installed and nothing else.
 * That restraint is the design: a package listing cannot tell Paint from a
 * game, and an application in somebody's library is worse than a game that
 * turns up one sign-in later.
 */
import { describe, expect, it } from 'vitest'
import { MicrosoftAdapter } from '@main/stores/microsoft'
import type { InstalledPackage } from '@main/stores/microsoft/packages'
import type { Game } from '@shared/types'

const FORZA = 'Microsoft.Forza_8wekyb3d8bbwe'

function packages(...entries: InstalledPackage[]): Map<string, InstalledPackage> {
  return new Map(entries.map((entry) => [entry.packageFamilyName, entry]))
}

function adapter(overrides: {
  platform?: string
  families?: string[]
  installed?: Map<string, InstalledPackage>
  aumids?: Map<string, string>
}): MicrosoftAdapter {
  return new MicrosoftAdapter({
    platform: overrides.platform ?? 'win32',
    readXboxAppPackages: async () => overrides.families ?? [],
    readInstalledPackages: async () => overrides.installed ?? new Map(),
    readStartAppIds: async () => overrides.aumids ?? new Map()
  })
}

describe('MicrosoftAdapter availability', () => {
  it('is unavailable off Windows', async () => {
    const result = await adapter({ platform: 'linux' }).isAvailable()

    expect(result.available).toBe(false)
    expect(result.reason).toBeDefined()
  })

  it('is available on Windows, and says what it cannot report', async () => {
    // Deliberately available even with no account connected: the local scan
    // works without one, and reporting unavailable would make scanOne return
    // before upsertScan — marking every Microsoft game uninstalled.
    const result = await adapter({}).isAvailable()

    expect(result.available).toBe(true)
    expect(result.limitations?.length).toBeGreaterThan(0)
  })
})

describe('MicrosoftAdapter scanInstalled', () => {
  it('lists a game the Xbox app installed', async () => {
    const games = await adapter({
      families: [FORZA],
      installed: packages({
        packageFamilyName: FORZA,
        displayName: 'Forza Horizon',
        installPath: 'C:\\XboxGames\\Forza Horizon\\Content'
      }),
      aumids: new Map([[FORZA, `${FORZA}!Game`]])
    }).scanInstalled()

    expect(games).toEqual([
      {
        storeGameId: FORZA,
        name: 'Forza Horizon',
        installed: true,
        installPath: 'C:\\XboxGames\\Forza Horizon\\Content',
        launchId: `${FORZA}!Game`
      }
    ])
  })

  it('falls back to the usual application id when Get-StartApps says nothing', async () => {
    const games = await adapter({
      families: [FORZA],
      installed: packages({ packageFamilyName: FORZA, displayName: 'Forza Horizon' })
    }).scanInstalled()

    expect(games[0]?.launchId).toBe(`${FORZA}!App`)
  })

  it('skips a game whose package carries no readable name', async () => {
    // A number would be worse than no row, and the entry can still be added
    // by hand. Same rule Ubisoft applies to its unnamed catalogue entries.
    const games = await adapter({
      families: [FORZA],
      installed: packages({ packageFamilyName: FORZA })
    }).scanInstalled()

    expect(games).toEqual([])
  })

  it('skips a registered game whose package is no longer installed', async () => {
    const games = await adapter({ families: [FORZA] }).scanInstalled()

    expect(games).toEqual([])
  })

  it('reports nothing when the Xbox app has not installed anything', async () => {
    // families = [] short-circuits before either registry read runs — there
    // is nothing a package listing or an AUMID lookup could add.
    const games = await adapter({ families: [] }).scanInstalled()

    expect(games).toEqual([])
  })

  it('lists nothing off Windows', async () => {
    const games = await adapter({ platform: 'linux', families: [FORZA] }).scanInstalled()

    expect(games).toEqual([])
  })

  it('reports no install size, because nothing cheap knows it', async () => {
    const games = await adapter({
      families: [FORZA],
      installed: packages({ packageFamilyName: FORZA, displayName: 'Forza Horizon' })
    }).scanInstalled()

    expect(games[0]?.installSizeBytes).toBeUndefined()
  })
})

describe('MicrosoftAdapter default dependencies', () => {
  it('defaults the platform to process.platform', async () => {
    // Readers are still stubbed — only `platform` is left to its default —
    // so this never touches the real (Windows-only) registry or PowerShell.
    // Comparing against an adapter with the platform passed explicitly
    // proves the omitted value actually resolves to process.platform,
    // whatever that happens to be on the machine running the test.
    const withDefaultPlatform = new MicrosoftAdapter({
      readXboxAppPackages: async () => [],
      readInstalledPackages: async () => new Map(),
      readStartAppIds: async () => new Map()
    })
    const withExplicitPlatform = adapter({ platform: process.platform })

    expect(await withDefaultPlatform.isAvailable()).toEqual(await withExplicitPlatform.isAvailable())
  })

  it('never reaches the real readers off Windows, even when none are stubbed', async () => {
    // With no reader overrides, scanInstalled would use the genuine
    // registry/PowerShell-backed implementations — which must never run in
    // a test. Forcing platform off Windows proves the guard on line 1 of
    // scanInstalled short-circuits before any of them are called.
    const games = await new MicrosoftAdapter({ platform: 'linux' }).scanInstalled()

    expect(games).toEqual([])
  })
})

describe('MicrosoftAdapter launchUri and installUri', () => {
  // Both are placeholders that always throw: a Store game cannot be started
  // or installed through a URI at all. Task 10 adds launchCommand; Task 17
  // gives installUri a real ProductId. Until then, every call must fail
  // with a message that explains why rather than doing nothing silently.
  const game = { name: 'Forza Horizon' } as Game

  it('launchUri always throws, naming the game', () => {
    expect(() => adapter({}).launchUri(game)).toThrow(/Forza Horizon/)
  })

  it('installUri always throws, naming the game', () => {
    expect(() => adapter({}).installUri(game)).toThrow(/Forza Horizon/)
  })
})
