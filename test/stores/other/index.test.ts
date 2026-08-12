import { describe, expect, it, vi } from 'vitest'
import type { Game } from '@shared/types'
import { OtherAdapter } from '@main/stores/other'

function game(overrides: Partial<Game> = {}): Game {
  return {
    id: 'other:manual-minecraft',
    storeId: 'other',
    storeGameId: 'manual-minecraft',
    name: 'Minecraft',
    installed: true,
    favorite: false,
    hidden: false,
    firstSeen: 0,
    lastSeen: 0,
    manual: true,
    launchExe: 'C:\\Games\\mc.exe',
    launchArgs: [],
    ...overrides
  }
}

function adapter(games: Game[], exists: (path: string) => boolean): OtherAdapter {
  return new OtherAdapter({ listStoreless: () => games, fileExists: exists })
}

describe('OtherAdapter', () => {
  it('is available everywhere, because there is nothing to detect', async () => {
    const result = await adapter([], () => true).isAvailable()
    expect(result.available).toBe(true)
  })

  it('reports a game whose program is there as installed', async () => {
    const scanned = await adapter([game()], () => true).scanInstalled()
    expect(scanned).toHaveLength(1)
    expect(scanned[0]).toMatchObject({
      storeGameId: 'manual-minecraft',
      installed: true,
      installPath: 'C:\\Games',
      manual: true
    })
  })

  it('returns a game whose program has gone, marked uninstalled', async () => {
    // Returned rather than omitted: upsertScan's mark-gone pass only touches
    // rows absent from the scan, and would then report the same row as newly
    // uninstalled on every scan afterwards.
    const scanned = await adapter([game()], () => false).scanInstalled()
    expect(scanned).toHaveLength(1)
    expect(scanned[0]!.installed).toBe(false)
  })

  it('keeps the hand-made mark on every scanned row', async () => {
    const scanned = await adapter([game()], () => true).scanInstalled()
    expect(scanned[0]!.manual).toBe(true)
  })

  it('launches the program from its own folder', () => {
    const command = adapter([], () => true).launchCommand(
      game({ launchArgs: ['--profile', 'My Pack'] })
    )
    expect(command).toEqual({
      exe: 'C:\\Games\\mc.exe',
      args: ['--profile', 'My Pack'],
      cwd: 'C:\\Games'
    })
  })

  it('refuses to launch a program that is no longer there', () => {
    const exists = vi.fn(() => false)
    expect(() => adapter([], exists).launchCommand(game())).toThrow(/C:\\Games\\mc\.exe/)
    expect(exists).toHaveBeenCalledWith('C:\\Games\\mc.exe')
  })

  it('refuses to launch a row with no program at all', () => {
    const broken = game()
    delete broken.launchExe
    expect(() => adapter([], () => true).launchCommand(broken)).toThrow(/Minecraft/)
  })

  it('has nothing to install', () => {
    expect(() => adapter([], () => true).installUri(game())).toThrow()
  })

  it('has no launch URI', () => {
    expect(() => adapter([], () => true).launchUri(game())).toThrow()
  })

  it('skips a row with no program when scanning', async () => {
    const broken = game()
    delete broken.launchExe
    expect(await adapter([broken], () => true).scanInstalled()).toEqual([])
  })
})
