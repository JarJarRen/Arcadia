/**
 * Every installed package, by family name.
 *
 * One `reg query /s` for the whole repository rather than a query per
 * package: there are 198 of them on the development machine, and a process
 * per package would cost more than the scan it serves.
 */
import { describe, expect, it } from 'vitest'
import {
  familyNameFromFullName,
  readInstalledPackages,
  usableDisplayName
} from '@main/stores/microsoft/packages'

const REPOSITORY = String.raw`
HKEY_CURRENT_USER\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Packages\ROBLOXCORPORATION.ROBLOX_2.699.877.0_x64__55nm5eh3cm0pr
    DisplayName    REG_SZ    Roblox
    PackageID    REG_SZ    ROBLOXCORPORATION.ROBLOX_2.699.877.0_x64__55nm5eh3cm0pr
    PackageRootFolder    REG_SZ    C:\Program Files\WindowsApps\ROBLOXCORPORATION.ROBLOX_2.699.877.0_x64__55nm5eh3cm0pr

HKEY_CURRENT_USER\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Packages\ROBLOXCORPORATION.ROBLOX_2.699.877.0_x64__55nm5eh3cm0pr\App

HKEY_CURRENT_USER\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Packages\Microsoft.MSPaint_6.2410.13017.0_x64__8wekyb3d8bbwe
    DisplayName    REG_SZ    @{Microsoft.MSPaint_6.2410.13017.0_x64__8wekyb3d8bbwe?ms-resource://Microsoft.MSPaint/resources/AppName}
    PackageID    REG_SZ    Microsoft.MSPaint_6.2410.13017.0_x64__8wekyb3d8bbwe
    PackageRootFolder    REG_SZ    C:\Program Files\WindowsApps\Microsoft.MSPaint_6.2410.13017.0_x64__8wekyb3d8bbwe
`

describe('familyNameFromFullName', () => {
  it('drops the version and architecture, keeping name and publisher', () => {
    expect(familyNameFromFullName('ROBLOXCORPORATION.ROBLOX_2.699.877.0_x64__55nm5eh3cm0pr')).toBe(
      'ROBLOXCORPORATION.ROBLOX_55nm5eh3cm0pr'
    )
  })

  it('rejects a name with no publisher suffix', () => {
    expect(familyNameFromFullName('NotAPackage')).toBeUndefined()
  })

  it('rejects a name with a leading underscore', () => {
    expect(familyNameFromFullName('_something_8wekyb3d8bbwe')).toBeUndefined()
  })

  it('rejects a name with a trailing underscore', () => {
    expect(familyNameFromFullName('something_')).toBeUndefined()
  })
})

describe('usableDisplayName', () => {
  it('passes a real name through', () => {
    expect(usableDisplayName('Roblox')).toBe('Roblox')
  })

  it('rejects an unresolved resource reference', () => {
    // Windows resolves these lazily; read from the registry they are a
    // string nobody should ever see in a library.
    expect(usableDisplayName('@{Microsoft.MSPaint_x64__8wekyb3d8bbwe?ms-resource://x}')).toBeUndefined()
  })

  it('rejects an empty value', () => {
    expect(usableDisplayName('')).toBeUndefined()
  })
})

describe('readInstalledPackages', () => {
  it('keys the packages by family name', async () => {
    const packages = await readInstalledPackages(async () => REPOSITORY)

    expect([...packages.keys()].sort()).toEqual([
      'Microsoft.MSPaint_8wekyb3d8bbwe',
      'ROBLOXCORPORATION.ROBLOX_55nm5eh3cm0pr'
    ])
  })

  it('reads the display name and the install path', async () => {
    const packages = await readInstalledPackages(async () => REPOSITORY)

    expect(packages.get('ROBLOXCORPORATION.ROBLOX_55nm5eh3cm0pr')).toEqual({
      packageFamilyName: 'ROBLOXCORPORATION.ROBLOX_55nm5eh3cm0pr',
      displayName: 'Roblox',
      installPath: String.raw`C:\Program Files\WindowsApps\ROBLOXCORPORATION.ROBLOX_2.699.877.0_x64__55nm5eh3cm0pr`
    })
  })

  it('leaves out a display name that is only a resource reference', async () => {
    const packages = await readInstalledPackages(async () => REPOSITORY)

    expect(packages.get('Microsoft.MSPaint_8wekyb3d8bbwe')?.displayName).toBeUndefined()
  })

  it('skips the subkeys that carry no package', async () => {
    // The `\App` block under each package has no PackageID at all.
    const packages = await readInstalledPackages(async () => REPOSITORY)

    expect(packages.size).toBe(2)
  })

  it('returns an empty map when the key cannot be read', async () => {
    const packages = await readInstalledPackages(async () => {
      throw new Error('ERROR: Access is denied.')
    })

    expect(packages.size).toBe(0)
  })

  it('skips entries with a malformed PackageID while including valid entries', async () => {
    const fixture = String.raw`
HKEY_CURRENT_USER\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Packages\ROBLOXCORPORATION.ROBLOX_2.699.877.0_x64__55nm5eh3cm0pr
    DisplayName    REG_SZ    Roblox
    PackageID    REG_SZ    ROBLOXCORPORATION.ROBLOX_2.699.877.0_x64__55nm5eh3cm0pr
    PackageRootFolder    REG_SZ    C:\Program Files\WindowsApps\ROBLOXCORPORATION.ROBLOX_2.699.877.0_x64__55nm5eh3cm0pr

HKEY_CURRENT_USER\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Packages\MalformedPackage
    DisplayName    REG_SZ    Bad Package
    PackageID    REG_SZ    MalformedPackage
    PackageRootFolder    REG_SZ    C:\Program Files\WindowsApps\MalformedPackage

HKEY_CURRENT_USER\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Packages\Microsoft.MSPaint_6.2410.13017.0_x64__8wekyb3d8bbwe
    DisplayName    REG_SZ    Paint
    PackageID    REG_SZ    Microsoft.MSPaint_6.2410.13017.0_x64__8wekyb3d8bbwe
    PackageRootFolder    REG_SZ    C:\Program Files\WindowsApps\Microsoft.MSPaint_6.2410.13017.0_x64__8wekyb3d8bbwe
`
    const packages = await readInstalledPackages(async () => fixture)

    // The malformed package should be skipped, but valid packages should be present
    expect([...packages.keys()].sort()).toEqual([
      'Microsoft.MSPaint_8wekyb3d8bbwe',
      'ROBLOXCORPORATION.ROBLOX_55nm5eh3cm0pr'
    ])
    expect(packages.has('MalformedPackage')).toBe(false)
  })

  it('includes an entry without PackageRootFolder as having no installPath', async () => {
    const fixture = String.raw`
HKEY_CURRENT_USER\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Packages\Microsoft.NoPath_6.2410.13017.0_x64__8wekyb3d8bbwe
    DisplayName    REG_SZ    App Without Path
    PackageID    REG_SZ    Microsoft.NoPath_6.2410.13017.0_x64__8wekyb3d8bbwe

HKEY_CURRENT_USER\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Packages\Microsoft.WithPath_6.2410.13017.0_x64__8wekyb3d8bbwe
    DisplayName    REG_SZ    App With Path
    PackageID    REG_SZ    Microsoft.WithPath_6.2410.13017.0_x64__8wekyb3d8bbwe
    PackageRootFolder    REG_SZ    C:\Program Files\WindowsApps\Microsoft.WithPath_6.2410.13017.0_x64__8wekyb3d8bbwe
`
    const packages = await readInstalledPackages(async () => fixture)

    const noPath = packages.get('Microsoft.NoPath_8wekyb3d8bbwe')
    expect(noPath?.packageFamilyName).toBe('Microsoft.NoPath_8wekyb3d8bbwe')
    expect(noPath?.displayName).toBe('App Without Path')
    expect(noPath?.installPath).toBeUndefined()

    const withPath = packages.get('Microsoft.WithPath_8wekyb3d8bbwe')
    expect(withPath?.installPath).toBe(String.raw`C:\Program Files\WindowsApps\Microsoft.WithPath_6.2410.13017.0_x64__8wekyb3d8bbwe`)
  })
})
