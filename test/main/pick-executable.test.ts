import { describe, expect, it, vi } from 'vitest'
import { pickExecutable, type PickDeps } from '@main/pick-executable'

function deps(overrides: Partial<PickDeps> = {}): PickDeps {
  return {
    showOpenDialog: async () => ({ canceled: false, filePaths: ['C:\\Games\\mc.exe'] }),
    readShortcutLink: () => ({ target: 'C:\\Games\\mc.exe' }),
    exists: async () => true,
    platform: 'win32',
    ...overrides
  }
}

describe('pickExecutable', () => {
  it('answers with the chosen program and a name to start from', async () => {
    const result = await pickExecutable(deps())
    expect(result).toEqual({
      ok: true,
      exe: 'C:\\Games\\mc.exe',
      args: [],
      suggestedName: 'mc'
    })
  })

  it('says nothing at all when the dialog is closed', async () => {
    const result = await pickExecutable(
      deps({ showOpenDialog: async () => ({ canceled: true, filePaths: [] }) })
    )
    // No error: closing a dialog is not a failure, and a message would be
    // noise on a screen the user just dismissed.
    expect(result).toEqual({ ok: false })
  })

  it('follows a shortcut to the program it points at', async () => {
    const result = await pickExecutable(
      deps({
        showOpenDialog: async () => ({
          canceled: false,
          filePaths: ['C:\\Users\\me\\Minecraft Launcher.lnk']
        }),
        readShortcutLink: () => ({ target: 'C:\\Games\\mc.exe', args: '--profile "My Pack"' })
      })
    )

    expect(result).toEqual({
      ok: true,
      exe: 'C:\\Games\\mc.exe',
      args: ['--profile', 'My Pack'],
      // The shortcut's own name, which is what the user recognises.
      suggestedName: 'Minecraft Launcher'
    })
  })

  it('explains a shortcut it cannot read', async () => {
    const result = await pickExecutable(
      deps({
        showOpenDialog: async () => ({ canceled: false, filePaths: ['C:\\a\\b.lnk'] }),
        readShortcutLink: () => {
          throw new Error('nope')
        }
      })
    )
    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('refuses a batch file', async () => {
    const result = await pickExecutable(
      deps({ showOpenDialog: async () => ({ canceled: false, filePaths: ['C:\\a\\run.bat'] }) })
    )
    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('refuses a shortcut pointing at something that is not a program', async () => {
    // The check runs after resolution, which is the only order that works:
    // the extension that matters belongs to the target, not to the .lnk.
    const result = await pickExecutable(
      deps({
        showOpenDialog: async () => ({ canceled: false, filePaths: ['C:\\a\\b.lnk'] }),
        readShortcutLink: () => ({ target: 'C:\\a\\run.bat' })
      })
    )
    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('refuses a program that is not there', async () => {
    const result = await pickExecutable(deps({ exists: async () => false }))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('C:\\Games\\mc.exe')
  })

  it('does not try to resolve a shortcut away from Windows', async () => {
    const readShortcutLink = vi.fn()
    const result = await pickExecutable(
      deps({
        showOpenDialog: async () => ({ canceled: false, filePaths: ['/opt/mc/launcher'] }),
        readShortcutLink,
        platform: 'linux'
      })
    )
    expect(result.ok).toBe(true)
    expect(readShortcutLink).not.toHaveBeenCalled()
  })
})
