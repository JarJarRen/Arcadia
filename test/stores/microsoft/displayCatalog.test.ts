/**
 * Package family name → the Store product behind it.
 *
 * Unauthenticated, which is why it is a separate module: it needs neither of
 * the two Xbox tokens. Cached to disk the way EA's catalogue is, so a rescan
 * of an unchanged library costs no request at all.
 *
 * The shapes below are the live service's, checked against it with a real
 * account rather than taken from documentation: the lookup form answers
 * `Products` with `ProductId`, `ProductKind` and
 * `LocalizedProperties[].ProductTitle`, and 404s for a package it has never
 * heard of. It does **not** answer `Properties` — see `product()` below for
 * why that mattered.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  readCatalogCache,
  resolveByPackageFamilyName
} from '@main/stores/microsoft/displayCatalog'
import type { HttpFn } from '@main/stores/microsoft/http'

function respond(status: number, body: unknown): Awaited<ReturnType<HttpFn>> {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  }
}

const FORZA = 'Microsoft.OpusPG_8wekyb3d8bbwe'
const PAINT = 'Microsoft.MSPaint_8wekyb3d8bbwe'

/**
 * One product, shaped as the lookup form actually answers.
 *
 * **There is deliberately no `Properties` here.** An earlier version of this
 * fixture had one, carrying the package family name, and that is why these
 * tests passed against code that returned nothing at all in production: the
 * `bigIds` query returns `Properties` when asked for `fieldsTemplate=details`,
 * the `alternateId` lookup does not, and code that read the package name back
 * out of the answer dropped every product on the floor. The fixture agreed
 * with the code instead of with the service, so nothing failed.
 */
function product(productId: string, kind: string, title: string): unknown {
  return {
    Products: [
      {
        ProductId: productId,
        ProductKind: kind,
        LocalizedProperties: [{ ProductTitle: title }]
      }
    ]
  }
}

/**
 * Answers each lookup according to the package it asked about.
 *
 * Typed as `vi.fn<HttpFn>` rather than left to inference: the calls are
 * inspected by index, and an untyped mock infers an empty-tuple call
 * signature that will not accept the `Deps.http` slot.
 */
function catalogue(): ReturnType<typeof vi.fn<HttpFn>> {
  return vi.fn<HttpFn>(async (url: string) => {
    if (url.includes(encodeURIComponent(FORZA))) {
      return respond(200, product('9NBLGGH1Z7TW', 'Game', 'Forza Horizon 3'))
    }
    if (url.includes(encodeURIComponent(PAINT))) {
      return respond(200, product('APP1', 'Application', 'Paint'))
    }
    return respond(404, {})
  })
}

describe('resolveByPackageFamilyName', () => {
  let dir: string | undefined

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('turns a package into its product id and title', async () => {
    // The ProductId is the whole reason this module exists: it is the only
    // identifier `ms-windows-store://pdp/` accepts, and the game row carries
    // nothing but the package name.
    expect(await resolveByPackageFamilyName([FORZA], { http: catalogue() })).toEqual([
      { productId: '9NBLGGH1Z7TW', name: 'Forza Horizon 3', packageFamilyName: FORZA }
    ])
  })

  it('asks by package family name rather than by product id', async () => {
    const http = catalogue()
    await resolveByPackageFamilyName([FORZA], { http })

    const url = String(http.mock.calls[0]?.[0])
    expect(url).toContain('/lookup')
    expect(url).toContain('alternateId=PackageFamilyName')
    expect(url).toContain(encodeURIComponent(FORZA))
  })

  it('drops a package the catalogue does not call a game', async () => {
    // The title history reports what was launched and does not classify it,
    // so this is the only thing keeping an application out of a game
    // library.
    expect(await resolveByPackageFamilyName([PAINT], { http: catalogue() })).toEqual([])
  })

  it('takes the package name from the request, not from the answer', async () => {
    // The regression this file exists to prevent. The lookup response carries
    // no `Properties` — only the `bigIds` query does, and only when asked for
    // `fieldsTemplate=details` — so code that read the package name back out
    // of the answer resolved nothing at all, while tests whose fixture
    // included the field passed happily.
    const http = vi.fn<HttpFn>(async () =>
      respond(200, product('9NBLGGH1Z7TW', 'Game', 'Forza Horizon 3'))
    )

    const resolved = await resolveByPackageFamilyName([FORZA], { http })

    expect(resolved).toEqual([
      { productId: '9NBLGGH1Z7TW', name: 'Forza Horizon 3', packageFamilyName: FORZA }
    ])
  })

  it('skips a package the catalogue has never heard of rather than failing', async () => {
    // One delisted title must not cost the whole library.
    const http = catalogue()
    const resolved = await resolveByPackageFamilyName(['Unknown.Thing_abc', FORZA], { http })

    expect(resolved.map((entry) => entry.packageFamilyName)).toEqual([FORZA])
  })

  it('asks once per package', async () => {
    const http = catalogue()
    await resolveByPackageFamilyName([FORZA, PAINT, 'Unknown.Thing_abc'], { http })

    expect(http).toHaveBeenCalledTimes(3)
  })

  it('asks nothing when the list is empty', async () => {
    const http = catalogue()

    expect(await resolveByPackageFamilyName([], { http })).toEqual([])
    expect(http).not.toHaveBeenCalled()
  })

  it('keeps a product the catalogue could not title', async () => {
    // A product with no localisation for the interface language comes back
    // titleless rather than absent. Dropping it would lose the game outright,
    // where the title history can still name it.
    const http = vi.fn<HttpFn>(async () =>
      respond(200, {
        Products: [{ ProductId: 'GAME2', ProductKind: 'Game', LocalizedProperties: [] }]
      })
    )

    expect(await resolveByPackageFamilyName([FORZA], { http })).toEqual([
      { productId: 'GAME2', name: '', packageFamilyName: FORZA }
    ])
  })

  it('reuses the cache instead of asking again', async () => {
    dir = mkdtempSync(join(tmpdir(), 'arcadia-mscat-'))
    const cachePath = join(dir, 'microsoft-catalog.json')
    const http = catalogue()

    await resolveByPackageFamilyName([FORZA], { http, cachePath })
    const second = await resolveByPackageFamilyName([FORZA], { http, cachePath })

    expect(http).toHaveBeenCalledTimes(1)
    expect(second[0]?.name).toBe('Forza Horizon 3')
  })

  it('asks only about the packages the cache does not already hold', async () => {
    dir = mkdtempSync(join(tmpdir(), 'arcadia-mscat-'))
    const cachePath = join(dir, 'microsoft-catalog.json')
    const http = catalogue()

    await resolveByPackageFamilyName([FORZA], { http, cachePath })
    http.mockClear()
    await resolveByPackageFamilyName([FORZA, PAINT], { http, cachePath })

    expect(http).toHaveBeenCalledTimes(1)
    expect(String(http.mock.calls[0]?.[0])).toContain(encodeURIComponent(PAINT))
  })

  it('reads the cache back on its own, for installUri', async () => {
    dir = mkdtempSync(join(tmpdir(), 'arcadia-mscat-'))
    const cachePath = join(dir, 'microsoft-catalog.json')
    await resolveByPackageFamilyName([FORZA], { http: catalogue(), cachePath })

    expect(await readCatalogCache(cachePath)).toEqual([
      { productId: '9NBLGGH1Z7TW', name: 'Forza Horizon 3', packageFamilyName: FORZA }
    ])
  })

  it('answers with an empty cache where there is no file', async () => {
    expect(await readCatalogCache(join(tmpdir(), 'arcadia-nothing-here.json'))).toEqual([])
  })

  it('answers with an empty cache for a file that is not a list', async () => {
    dir = mkdtempSync(join(tmpdir(), 'arcadia-mscat-'))
    const cachePath = join(dir, 'microsoft-catalog.json')
    writeFileSync(cachePath, '{"not":"an array"}')

    expect(await readCatalogCache(cachePath)).toEqual([])
  })

  it('throws on a refusal, so the scan records a partial failure', async () => {
    const http = vi.fn(async () => respond(500, {}))

    await expect(resolveByPackageFamilyName([FORZA], { http })).rejects.toThrow(/500/)
  })

  it('carries on when the cache cannot be written', async () => {
    // A cache that cannot be written costs requests, not correctness.
    dir = mkdtempSync(join(tmpdir(), 'arcadia-mscat-'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const cachePath = join(dir, 'no-such-directory', 'microsoft-catalog.json')

    const resolved = await resolveByPackageFamilyName([FORZA], { http: catalogue(), cachePath })

    expect(resolved[0]?.productId).toBe('9NBLGGH1Z7TW')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
