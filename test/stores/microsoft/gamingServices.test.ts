/**
 * What the Xbox app registered.
 *
 * This is the only local source that says "this package is a game" without
 * asking anybody: GamingServices registers what it installed, and nothing
 * else lands there. The subkey name is the package family name, which is
 * also what the Xbox Live APIs report — so the two halves of this adapter
 * join without a translation table.
 */
import { describe, expect, it } from 'vitest'
import { readXboxAppPackages } from '@main/stores/microsoft/gamingServices'

const GAME_CONFIG = String.raw`
HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\GamingServices\GameConfig

HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\GamingServices\GameConfig\Microsoft.SunsetOverdrivePC_8wekyb3d8bbwe

HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\GamingServices\GameConfig\Microsoft.Forza_8wekyb3d8bbwe
`

describe('readXboxAppPackages', () => {
  it('reads the package family names from the subkeys', async () => {
    const names = await readXboxAppPackages(async () => GAME_CONFIG)

    expect(names).toEqual([
      'Microsoft.SunsetOverdrivePC_8wekyb3d8bbwe',
      'Microsoft.Forza_8wekyb3d8bbwe'
    ])
  })

  it('returns nothing when the key does not exist', async () => {
    // The normal case on a machine that never installed a game through the
    // Xbox app — measured on the development machine, where the whole
    // GameConfig key is absent. Not an error.
    const names = await readXboxAppPackages(async () => {
      throw new Error('ERROR: The system was unable to find the specified registry key')
    })

    expect(names).toEqual([])
  })

  it('ignores a subkey that is not a package family name', async () => {
    // A family name is always `<name>_<publisherId>`. Anything without the
    // suffix is something else that has been parked under the same key.
    const names = await readXboxAppPackages(
      async () => String.raw`
HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\GamingServices\GameConfig

HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\GamingServices\GameConfig\Settings
`
    )

    expect(names).toEqual([])
  })
})
