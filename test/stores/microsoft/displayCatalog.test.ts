/**
 * ProductId → a name and a package family name.
 *
 * Unauthenticated, which is why it is a separate module: it needs neither
 * of the two Xbox tokens. Cached to disk the way EA's catalogue is, so a
 * rescan of an unchanged library costs no request at all.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readCatalogCache, resolveProducts } from '@main/stores/microsoft/displayCatalog'

function respond(status: number, body: unknown): {
  ok: boolean
  status: number
  json: () => Promise<unknown>
  text: () => Promise<string>
} {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  }
}

const PRODUCTS = {
  Products: [
    {
      ProductId: 'GAME1',
      ProductKind: 'Game',
      LocalizedProperties: [{ ProductTitle: 'Forza Horizon' }],
      Properties: { PackageFamilyName: 'Microsoft.Forza_8wekyb3d8bbwe' }
    },
    {
      ProductId: 'APP1',
      ProductKind: 'Application',
      LocalizedProperties: [{ ProductTitle: 'Paint' }],
      Properties: { PackageFamilyName: 'Microsoft.MSPaint_8wekyb3d8bbwe' }
    },
    {
      ProductId: 'CONSOLE1',
      ProductKind: 'Game',
      LocalizedProperties: [{ ProductTitle: 'A console game' }],
      Properties: {}
    }
  ]
}

describe('resolveProducts', () => {
  let dir: string | undefined

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('reads the name and the package family name', async () => {
    const http = vi.fn(async () => respond(200, PRODUCTS))

    expect(await resolveProducts(['GAME1'], { http })).toEqual([
      {
        productId: 'GAME1',
        name: 'Forza Horizon',
        packageFamilyName: 'Microsoft.Forza_8wekyb3d8bbwe'
      }
    ])
  })

  it('drops anything that is not a game', async () => {
    const http = vi.fn(async () => respond(200, PRODUCTS))

    expect((await resolveProducts(['GAME1', 'APP1'], { http })).map((e) => e.productId)).toEqual([
      'GAME1'
    ])
  })

  it('drops a game with no package, which cannot run here', async () => {
    const http = vi.fn(async () => respond(200, PRODUCTS))

    expect(
      (await resolveProducts(['GAME1', 'CONSOLE1'], { http })).map((e) => e.productId)
    ).toEqual(['GAME1'])
  })

  it('batches a long list rather than building one enormous URL', async () => {
    const http = vi.fn(async () => respond(200, { Products: [] }))

    await resolveProducts(Array.from({ length: 45 }, (_, index) => `P${index}`), { http })

    expect(http.mock.calls.length).toBe(3)
  })

  it('asks nothing when the list is empty', async () => {
    const http = vi.fn(async () => respond(200, { Products: [] }))

    expect(await resolveProducts([], { http })).toEqual([])
    expect(http).not.toHaveBeenCalled()
  })

  it('reuses the cache instead of asking again', async () => {
    dir = mkdtempSync(join(tmpdir(), 'arcadia-mscat-'))
    const cachePath = join(dir, 'microsoft-catalog.json')
    const http = vi.fn(async () => respond(200, PRODUCTS))

    await resolveProducts(['GAME1'], { http, cachePath })
    const second = await resolveProducts(['GAME1'], { http, cachePath })

    expect(http).toHaveBeenCalledTimes(1)
    expect(second[0]?.name).toBe('Forza Horizon')
  })

  it('reads the cache back on its own, for installUri', async () => {
    dir = mkdtempSync(join(tmpdir(), 'arcadia-mscat-'))
    const cachePath = join(dir, 'microsoft-catalog.json')
    await resolveProducts(['GAME1'], { http: async () => respond(200, PRODUCTS), cachePath })

    expect(await readCatalogCache(cachePath)).toEqual([
      {
        productId: 'GAME1',
        name: 'Forza Horizon',
        packageFamilyName: 'Microsoft.Forza_8wekyb3d8bbwe'
      }
    ])
  })

  it('answers with an empty cache where there is no file', async () => {
    expect(await readCatalogCache(join(tmpdir(), 'arcadia-nothing-here.json'))).toEqual([])
  })

  it('throws on a refusal, so the scan records a partial failure', async () => {
    const http = vi.fn(async () => respond(500, {}))

    await expect(resolveProducts(['GAME1'], { http })).rejects.toThrow(/500/)
  })

  // The following tests close coverage gaps the brief's own nine tests leave
  // open: a response with no `Products` at all, a product missing the
  // fields the filters depend on, a cache file that exists but is not the
  // shape expected, and a cache directory that cannot be written to.

  it('treats a response with no Products array as nothing found', async () => {
    const http = vi.fn(async () => respond(200, {}))

    expect(await resolveProducts(['GAME1'], { http })).toEqual([])
  })

  it('drops a game with no ProductId', async () => {
    const http = vi.fn(async () =>
      respond(200, {
        Products: [
          {
            ProductKind: 'Game',
            LocalizedProperties: [{ ProductTitle: 'Nameless' }],
            Properties: { PackageFamilyName: 'Some.Package_8wekyb3d8bbwe' }
          }
        ]
      })
    )

    expect(await resolveProducts(['GAME1'], { http })).toEqual([])
  })

  /**
   * `languages` is the interface language, and a product with no
   * localisation for it answers with an empty `LocalizedProperties`.
   * Dropping it lost an owned game outright — while the title history,
   * which joins on this very package family name, can still name it. The
   * design puts it plainly: the history contributes "a name for anything
   * the catalogue could not resolve". `scanOwned` drops what neither
   * source names.
   */
  it('keeps a game with no title, nameless, so the title history can name it', async () => {
    const http = vi.fn(async () =>
      respond(200, {
        Products: [
          {
            ProductId: 'GAME1',
            ProductKind: 'Game',
            LocalizedProperties: [],
            Properties: { PackageFamilyName: 'Some.Package_8wekyb3d8bbwe' }
          }
        ]
      })
    )

    expect(await resolveProducts(['GAME1'], { http })).toEqual([
      { productId: 'GAME1', name: '', packageFamilyName: 'Some.Package_8wekyb3d8bbwe' }
    ])
  })

  it('still drops a nameless product with no package, console-only as ever', async () => {
    const http = vi.fn(async () =>
      respond(200, {
        Products: [{ ProductId: 'GAME1', ProductKind: 'Game', LocalizedProperties: [] }]
      })
    )

    expect(await resolveProducts(['GAME1'], { http })).toEqual([])
  })

  it('answers with an empty cache where the file is not the expected shape', async () => {
    dir = mkdtempSync(join(tmpdir(), 'arcadia-mscat-'))
    const cachePath = join(dir, 'microsoft-catalog.json')
    writeFileSync(cachePath, JSON.stringify({ not: 'an array' }), 'utf8')

    expect(await readCatalogCache(cachePath)).toEqual([])
  })

  it('still resolves products when the cache cannot be written', async () => {
    dir = mkdtempSync(join(tmpdir(), 'arcadia-mscat-'))
    // The parent directory does not exist, so writing the cache fails with
    // ENOENT. That must not surface as a rejection of resolveProducts.
    const cachePath = join(dir, 'missing-subdir', 'microsoft-catalog.json')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const http = vi.fn(async () => respond(200, PRODUCTS))

    const resolved = await resolveProducts(['GAME1'], { http, cachePath })

    expect(resolved).toEqual([
      {
        productId: 'GAME1',
        name: 'Forza Horizon',
        packageFamilyName: 'Microsoft.Forza_8wekyb3d8bbwe'
      }
    ])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
