/**
 * The launch route for a store whose games are not reachable by URI.
 *
 * Everything else in Arcadia hands `shell.openExternal` a protocol URI. The
 * Microsoft Store cannot be started that way at all, so the adapter
 * describes a command as plain data and this bridge is the only thing that
 * runs it — the same split GuidedInstall already uses.
 */
import { describe, expect, it, vi } from 'vitest'

const openExternal = vi.fn(async () => undefined)

vi.mock('electron', () => ({
  shell: { openExternal, showItemInFolder: () => undefined },
  screen: { dipToScreenRect: (_w: unknown, r: unknown) => r }
}))

const { launchGame } = await import('@main/launch-bridge')
const { t } = await import('@shared/i18n')

const game = {
  id: 'microsoft:Pkg_pub',
  storeId: 'microsoft' as const,
  storeGameId: 'Pkg_pub',
  name: 'Forza Horizon',
  installed: true,
  favorite: false,
  hidden: false,
  firstSeen: 0,
  lastSeen: 0
}

function adapterWith(launchCommand?: () => { exe: string; args: string[] }): unknown {
  return {
    id: 'microsoft',
    displayName: 'Microsoft Store',
    isAvailable: async () => ({ available: true }),
    scanInstalled: async () => [],
    launchUri: () => 'ms-nothing://',
    installUri: () => 'ms-nothing://',
    ...(launchCommand === undefined ? {} : { launchCommand })
  }
}

describe('launchGame with a command', () => {
  it('runs the command instead of opening a URI', async () => {
    const run = vi.fn(async () => undefined)
    const adapters = [adapterWith(() => ({ exe: 'explorer.exe', args: ['shell:AppsFolder\\x!App'] }))]

    const result = await launchGame(adapters as never, game, run)

    expect(result.ok).toBe(true)
    expect(run).toHaveBeenCalledWith('explorer.exe', ['shell:AppsFolder\\x!App'])
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('still opens a URI for an adapter with no command', async () => {
    const run = vi.fn(async () => undefined)

    const result = await launchGame([adapterWith()] as never, game, run)

    expect(result.ok).toBe(true)
    expect(run).not.toHaveBeenCalled()
    expect(openExternal).toHaveBeenCalledWith('ms-nothing://')
  })

  it('reports the game by name when building the command throws', async () => {
    const adapters = [
      adapterWith(() => {
        throw new Error('not installed')
      })
    ]

    const result = await launchGame(adapters as never, game, async () => undefined)

    expect(result.ok).toBe(false)
    expect(result.error).toBe(t().errors.launchNameFailed('Forza Horizon', 'not installed'))
  })

  it('reports a command that could not be started', async () => {
    const adapters = [adapterWith(() => ({ exe: 'explorer.exe', args: ['shell:AppsFolder\\x!App'] }))]

    const result = await launchGame(adapters as never, game, async () => {
      throw new Error('ENOENT')
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('ENOENT')
  })
})
