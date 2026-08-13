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

function adapterWith(
  launchCommand?: () => { exe: string; args: string[]; cwd?: string }
): unknown {
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
    expect(run).toHaveBeenCalledWith('explorer.exe', ['shell:AppsFolder\\x!App'], undefined)
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

  it('reports a clean failure instead of crashing when the real spawn cannot start', async () => {
    // No third argument: this runs the real `defaultRun`, the only way to
    // reach it at all. The executable does not exist on any platform, so the
    // spawn fails immediately with ENOENT and starts nothing.
    const adapters = [
      adapterWith(() => ({ exe: 'arcadia-no-such-binary-4f9c2b', args: [] }))
    ]

    const result = await launchGame(adapters as never, game)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Forza Horizon')
  })

  it('passes the working directory through to the command', async () => {
    const run = vi.fn(async () => undefined)
    const adapters = [
      adapterWith(() => ({ exe: 'C:\\Games\\mc.exe', args: [], cwd: 'C:\\Games' }))
    ]

    const result = await launchGame(adapters as never, game, run)

    expect(result.ok).toBe(true)
    expect(run).toHaveBeenCalledWith('C:\\Games\\mc.exe', [], { cwd: 'C:\\Games' })
  })

  it('asks for no working directory when the adapter names none', async () => {
    const run = vi.fn(async () => undefined)
    const adapters = [adapterWith(() => ({ exe: 'explorer.exe', args: ['shell:AppsFolder\\x!App'] }))]

    await launchGame(adapters as never, game, run)

    expect(run).toHaveBeenCalledWith('explorer.exe', ['shell:AppsFolder\\x!App'], undefined)
  })

  it('hands an argument with shell characters through untouched', async () => {
    const run = vi.fn(async () => undefined)
    const adapters = [adapterWith(() => ({ exe: 'C:\\Games\\mc.exe', args: ['--name', 'a&b'] }))]

    await launchGame(adapters as never, game, run)

    // One argument, not a command. This is what spawning without a shell buys.
    expect(run).toHaveBeenCalledWith('C:\\Games\\mc.exe', ['--name', 'a&b'], undefined)
  })
})
