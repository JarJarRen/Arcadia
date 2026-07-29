import { describe, expect, it } from 'vitest'
import {
  accountIdFromSteamId64,
  parseLocalPlayedApps
} from '@main/stores/steam/localConfig'

/**
 * Modelled on the real file from the development machine, but with
 * invented values: the original carries the user email address inside the
 * ParentalSettings block.
 */
const FILE = `
"UserLocalConfigStore"
{
	"friends"
	{
		"PersonaName"		"testuser"
	}
	"Software"
	{
		"Valve"
		{
			"Steam"
			{
				"apps"
				{
					"400"
					{
						"LastPlayed"		"1717438529"
						"Playtime"		"801"
						"cloud"
						{
							"last_sync_state"		"synchronized"
						}
					}
					"440"
					{
						"LastPlayed"		"1699500000"
						"Playtime"		"12"
					}
					"760"
					{
						"cloud"
						{
							"last_sync_state"		"synchronized"
						}
					}
					"241100"
					{
						"autocloud"
						{
							"lastlaunch"		"1717435405"
						}
					}
				}
			}
		}
	}
}
`

describe('parseLocalPlayedApps', () => {
  it('finds the apps with play traces', () => {
    expect(parseLocalPlayedApps(FILE).sort()).toEqual(['400', '440'])
  })

  it('leaves out entries without play traces', () => {
    // 760 is Steam Screenshots, 241100 the controller configurations.
    // Both carry local configuration but no playtime — they are not games
    // and must not end up in the library.
    const gefunden = parseLocalPlayedApps(FILE)
    expect(gefunden).not.toContain('760')
    expect(gefunden).not.toContain('241100')
  })

  it('finds the branch despite differing capitalisation', () => {
    // A case-sensitive comparison would be silently empty depending on the
    // file — not an error, just no games.
    const anders = FILE.replace('"UserLocalConfigStore"', '"userlocalconfigstore"')
      .replace('"Software"', '"software"')
      .replace('"Steam"', '"steam"')
    expect(parseLocalPlayedApps(anders).sort()).toEqual(['400', '440'])
  })

  it('recognises lower-case field names as play traces too', () => {
    const anders = FILE.replace('"LastPlayed"', '"lastplayed"').replace(
      '"Playtime"',
      '"playtime"'
    )
    expect(parseLocalPlayedApps(anders)).toContain('400')
  })

  it('returns an empty list when the branch is missing', () => {
    expect(parseLocalPlayedApps('"UserLocalConfigStore"\n{\n}\n')).toEqual([])
  })

  it('does not throw on broken content', () => {
    expect(() => parseLocalPlayedApps('this is not VDF {{{')).not.toThrow()
  })

  it('skips keys that are not an app ID', () => {
    const mit = FILE.replace('"400"', '"nichtnumerisch"')
    expect(parseLocalPlayedApps(mit)).toEqual(['440'])
  })
})

describe('accountIdFromSteamId64', () => {
  it('converts the SteamID64 into the account number', () => {
    // Valve public example ID. Steam does not store userdata under the
    // 17-digit ID but under its lower 32 bits.
    expect(accountIdFromSteamId64('76561197960287930')).toBe('22202')
  })

  it('stays exact for large IDs too', () => {
    // With number instead of BigInt the final digits would be lost here:
    // the ID sits close enough to Number.MAX_SAFE_INTEGER that the
    // intermediate arithmetic matters.
    expect(accountIdFromSteamId64('76561198000000000')).toBe('39734272')
  })

  it('rejects anything that is not a SteamID64', () => {
    for (const nonsense of ['', 'abc', '123', '7656119796028793X', '765611979602879301']) {
      expect(accountIdFromSteamId64(nonsense)).toBeUndefined()
    }
  })

  it('rejects an ID below the base', () => {
    expect(accountIdFromSteamId64('00000000000000001')).toBeUndefined()
  })
})
