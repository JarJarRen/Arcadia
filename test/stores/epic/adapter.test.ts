import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EpicAdapter } from '@main/stores/epic'
import { gameId, type Game } from '@shared/types'

function game(launchId: string | undefined, storeGameId = 'catalogue-id'): Game {
  return {
    id: gameId('epic', storeGameId),
    storeId: 'epic',
    storeGameId,
    name: 'X',
    installed: true,
    favorite: false,
    hidden: false,
    firstSeen: 0,
    lastSeen: 0,
    ...(launchId === undefined ? {} : { launchId })
  }
}

describe('EpicAdapter', () => {
  it('reports itself unavailable when the manifest directory is missing', async () => {
    const adapter = new EpicAdapter({ exists: async () => false })
    const result = await adapter.isAvailable()
    expect(result.available).toBe(false)
    expect(result.reason).toMatch(/Epic/i)
  })

  it('reports itself available when the directory exists', async () => {
    const adapter = new EpicAdapter({ exists: async () => true })
    expect((await adapter.isAvailable()).available).toBe(true)
  })

  it('names a missing catalogue as a limitation, not an error', async () => {
    // Without the catalogue cache Arcadia only sees the installed games.
    // That is a limitation — the store stays usable.
    const adapter = new EpicAdapter({
      exists: async (p) => !p.includes('catcache')
    })
    const result = await adapter.isAvailable()
    expect(result.available).toBe(true)
    expect(result.limitations?.join(' ')).toMatch(/cache/i)
  })

  it('names no limitation when the catalogue is present', async () => {
    const adapter = new EpicAdapter({ exists: async () => true })
    expect((await adapter.isAvailable()).limitations ?? []).toHaveLength(0)
  })

  it('builds the launch URI from the launchId, not the catalogue ID', () => {
    // The catalogue ID is stable, but Epic only launches via the AppName.
    const adapter = new EpicAdapter({ exists: async () => true })
    expect(adapter.launchUri(game('UE_5.7', 'catalogue-id'))).toBe(
      'com.epicgames.launcher://apps/UE_5.7?action=launch&silent=true'
    )
  })

  it('refuses to launch an owned but uninstalled game', () => {
    // Without a manifest there is no AppName — there is simply nothing
    // there that could be launched.
    const adapter = new EpicAdapter({ exists: async () => true })
    expect(() => adapter.launchUri(game(undefined))).toThrow(/not installed/i)
  })

  it('refuses the launch URI for an illegal AppName', () => {
    const adapter = new EpicAdapter({ exists: async () => true })
    for (const bad of ['a b', 'a/b', '../x', '']) {
      expect(() => adapter.launchUri(game(bad)), `AppName "${bad}"`).toThrow()
    }
  })

  it('returns an empty list when the directory is missing', async () => {
    const adapter = new EpicAdapter({ exists: async () => false })
    expect(await adapter.scanInstalled()).toEqual([])
  })

  it('passes found games through', async () => {
    const adapter = new EpicAdapter({
      exists: async () => true,
      scan: async () => [{ storeGameId: 'x', name: 'Foretales', installed: true }]
    })
    expect(await adapter.scanInstalled()).toHaveLength(1)
  })

  it('supplies the owned library from the catalogue', async () => {
    const adapter = new EpicAdapter({
      exists: async () => true,
      readCatalog: async () => [
        { storeGameId: 'a', name: 'Hogwarts Legacy', installed: false },
        { storeGameId: 'b', name: 'Alien: Isolation', installed: false }
      ]
    })
    expect((await adapter.scanOwned()).map((entry) => entry.name)).toEqual([
      'Hogwarts Legacy',
      'Alien: Isolation'
    ])
  })

  it('does not let a broken catalogue drag the installed games down', async () => {
    // The catalogue format is undocumented and can change. If it breaks,
    // the library has to fall back to the installed games — not go empty.
    const adapter = new EpicAdapter({
      exists: async () => true,
      readCatalog: async () => [],
      scan: async () => [{ storeGameId: 'x', name: 'Foretales', installed: true }]
    })
    expect(await adapter.scanOwned()).toEqual([])
    expect(await adapter.scanInstalled()).toHaveLength(1)
  })
})

describe('EpicAdapter with the default file existence check', () => {
  // No `exists` override here: these exercise the real node:fs/promises
  // `access` call, using real directories rather than mocking the file
  // system.
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'arcadia-epic-adapter-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reports itself available when the real manifest directory exists', async () => {
    const adapter = new EpicAdapter({ manifestDir: dir, catalogFile: join(dir, 'nope.bin') })
    const result = await adapter.isAvailable()
    expect(result.available).toBe(true)
    expect(result.limitations?.join(' ')).toMatch(/cache/i)
  })

  it('reports itself unavailable when the real manifest directory is missing', async () => {
    const adapter = new EpicAdapter({ manifestDir: join(dir, 'does-not-exist') })
    const result = await adapter.isAvailable()
    expect(result.available).toBe(false)
  })
})
