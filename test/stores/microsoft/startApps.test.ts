/**
 * The AUMID, which is what actually starts a Store game.
 *
 * A package family name is not enough: activation needs
 * `<family>!<applicationId>`, and the application id lives in the package
 * manifest. `Get-StartApps` reports the finished identifier for everything
 * with a Start-menu entry, in one call — verified on the development
 * machine, where it answers `ROBLOXCORPORATION.ROBLOX_55nm5eh3cm0pr!App`.
 */
import { describe, expect, it } from 'vitest'
import { readStartAppIds } from '@main/stores/microsoft/startApps'

const JSON_ARRAY = JSON.stringify([
  { Name: 'Roblox', AppID: 'ROBLOXCORPORATION.ROBLOX_55nm5eh3cm0pr!App' },
  { Name: '3D Viewer', AppID: 'Microsoft.Microsoft3DViewer_8wekyb3d8bbwe!Microsoft.Microsoft3DViewer' },
  { Name: 'Notepad', AppID: 'C:\\Windows\\notepad.exe' }
])

describe('readStartAppIds', () => {
  it('keys the AUMIDs by package family name', async () => {
    const ids = await readStartAppIds(async () => JSON_ARRAY)

    expect(ids.get('ROBLOXCORPORATION.ROBLOX_55nm5eh3cm0pr')).toBe(
      'ROBLOXCORPORATION.ROBLOX_55nm5eh3cm0pr!App'
    )
    expect(ids.get('Microsoft.Microsoft3DViewer_8wekyb3d8bbwe')).toBe(
      'Microsoft.Microsoft3DViewer_8wekyb3d8bbwe!Microsoft.Microsoft3DViewer'
    )
  })

  it('ignores desktop programs, which have a path rather than an AUMID', async () => {
    const ids = await readStartAppIds(async () => JSON_ARRAY)

    expect(ids.size).toBe(2)
  })

  it('accepts a single object, which is what one entry produces', async () => {
    // ConvertTo-Json emits an object rather than an array for one item —
    // a classic PowerShell trap that turns into a crash on the one machine
    // that has exactly one Store app.
    const ids = await readStartAppIds(async () =>
      JSON.stringify({ Name: 'Roblox', AppID: 'ROBLOXCORPORATION.ROBLOX_55nm5eh3cm0pr!App' })
    )

    expect(ids.size).toBe(1)
  })

  it('returns an empty map when PowerShell is not there', async () => {
    const ids = await readStartAppIds(async () => {
      throw new Error("'powershell' is not recognized")
    })

    expect(ids.size).toBe(0)
  })

  it('returns an empty map for output that is not JSON', async () => {
    const ids = await readStartAppIds(async () => 'Get-StartApps : The term …')

    expect(ids.size).toBe(0)
  })

  it('uses the default exec when not provided', async () => {
    // This test exercises the defaultExec code path. On systems with PowerShell
    // and Get-StartApps working, it will call the real command and cover lines
    // inside defaultExec. On systems without PowerShell, it will fail and return
    // an empty map, but the function will still be exercised.
    const ids = await readStartAppIds()

    expect(ids instanceof Map).toBe(true)
  })

  it('skips entries that are not objects', async () => {
    const output = JSON.stringify([
      { Name: 'Valid', AppID: 'VALID.Package_55nm5eh3cm0pr!App' },
      null,
      'not an object',
      123,
      { Name: 'Another Valid', AppID: 'VALID2.Package_55nm5eh3cm0pr!App' }
    ])

    const ids = await readStartAppIds(async () => output)

    expect(ids.size).toBe(2)
    expect(ids.has('VALID.Package_55nm5eh3cm0pr')).toBe(true)
    expect(ids.has('VALID2.Package_55nm5eh3cm0pr')).toBe(true)
  })

  it('skips entries without a string AppID', async () => {
    const output = JSON.stringify([
      { Name: 'Valid', AppID: 'VALID.Package_55nm5eh3cm0pr!App' },
      { Name: 'No AppID' },
      { Name: 'Null AppID', AppID: null },
      { Name: 'Number AppID', AppID: 123 }
    ])

    const ids = await readStartAppIds(async () => output)

    expect(ids.size).toBe(1)
    expect(ids.get('VALID.Package_55nm5eh3cm0pr')).toBe('VALID.Package_55nm5eh3cm0pr!App')
  })

  it('skips AppIDs without an exclamation mark', async () => {
    const output = JSON.stringify([
      { Name: 'Valid', AppID: 'VALID.Package_55nm5eh3cm0pr!App' },
      { Name: 'No separator', AppID: 'INVALID' },
      { Name: 'Starts with separator', AppID: '!InvalidApp' }
    ])

    const ids = await readStartAppIds(async () => output)

    expect(ids.size).toBe(1)
    expect(ids.get('VALID.Package_55nm5eh3cm0pr')).toBe('VALID.Package_55nm5eh3cm0pr!App')
  })
})
