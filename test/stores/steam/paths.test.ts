import { describe, expect, it } from 'vitest'
import { findSteamPath } from '@main/stores/steam/paths'

describe('findSteamPath on Windows', () => {
  it('reads the path from the registry and normalises the slashes', async () => {
    // Steam writes the path into the registry with forward slashes.
    const exec = async (): Promise<string> =>
      '\r\nHKEY_CURRENT_USER\\SOFTWARE\\Valve\\Steam\r\n    SteamPath    REG_SZ    d:/steam\r\n'

    const result = await findSteamPath({
      platform: 'win32',
      exec,
      exists: async () => true
    })
    expect(result).toBe('d:\\steam')
  })

  it('returns undefined when the registry path points nowhere', async () => {
    const exec = async (): Promise<string> =>
      '\r\nHKEY_CURRENT_USER\\SOFTWARE\\Valve\\Steam\r\n    SteamPath    REG_SZ    d:/steam\r\n'

    const result = await findSteamPath({
      platform: 'win32',
      exec,
      exists: async () => false
    })
    expect(result).toBeUndefined()
  })

  it('returns undefined when Steam is not installed', async () => {
    const exec = async (): Promise<string> => {
      throw new Error('not found')
    }
    const result = await findSteamPath({ platform: 'win32', exec, exists: async () => true })
    expect(result).toBeUndefined()
  })
})

describe('findSteamPath on Linux', () => {
  it('takes the first candidate that exists', async () => {
    const result = await findSteamPath({
      platform: 'linux',
      homeDir: '/home/test',
      exists: async (p) => p === '/home/test/.local/share/Steam'
    })
    expect(result).toBe('/home/test/.local/share/Steam')
  })

  it('finds the Flatpak installation too', async () => {
    const result = await findSteamPath({
      platform: 'linux',
      homeDir: '/home/test',
      exists: async (p) => p === '/home/test/.var/app/com.valvesoftware.Steam/data/Steam'
    })
    expect(result).toBe('/home/test/.var/app/com.valvesoftware.Steam/data/Steam')
  })

  it('returns undefined when no candidate exists', async () => {
    const result = await findSteamPath({
      platform: 'linux',
      homeDir: '/home/test',
      exists: async () => false
    })
    expect(result).toBeUndefined()
  })
})
