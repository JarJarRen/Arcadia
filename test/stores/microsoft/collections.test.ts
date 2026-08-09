/**
 * Ownership, and only ownership.
 *
 * This is the half the title history cannot supply: a game bought and never
 * launched appears here and nowhere else. What it does not supply is names —
 * everything is a ProductId — which is what displayCatalog.ts is for.
 */
import { describe, expect, it, vi } from 'vitest'
import { readOwnedProductIds } from '@main/stores/microsoft/collections'
import type { HttpFn } from '@main/stores/microsoft/http'

const TOKEN = { token: 'tok', userHash: 'uhs', xuid: '1', gamertag: 'g' }

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

describe('readOwnedProductIds', () => {
  it('reads the products the account holds', async () => {
    const http = vi.fn(async () =>
      respond(200, {
        Items: [
          { productId: '9NBLGGH4R315', productKind: 'Game' },
          { productId: '9WZDNCRFJ3TJ', productKind: 'Game' }
        ]
      })
    )

    expect(await readOwnedProductIds(TOKEN, { http })).toEqual(['9NBLGGH4R315', '9WZDNCRFJ3TJ'])
  })

  it('leaves out everything that is not a game', async () => {
    // The collection holds apps, durables and subscriptions too. A library
    // is not the place for any of them.
    const http = vi.fn(async () =>
      respond(200, {
        Items: [
          { productId: 'GAME', productKind: 'Game' },
          { productId: 'APP', productKind: 'Application' },
          { productId: 'DLC', productKind: 'Durable' },
          { productId: 'SUB', productKind: 'Pass' }
        ]
      })
    )

    expect(await readOwnedProductIds(TOKEN, { http })).toEqual(['GAME'])
  })

  it('forwards the continuation token to the next request', async () => {
    const http = vi.fn<HttpFn>()
      .mockResolvedValueOnce(
        respond(200, { Items: [{ productId: 'A', productKind: 'Game' }], continuationToken: 'next' })
      )
      .mockResolvedValueOnce(respond(200, { Items: [{ productId: 'B', productKind: 'Game' }] }))

    expect(await readOwnedProductIds(TOKEN, { http })).toEqual(['A', 'B'])
    expect(http).toHaveBeenCalledTimes(2)

    // First request must not include a continuation token
    const firstBody = JSON.parse(http.mock.calls[0]?.[1]?.body as string)
    expect(firstBody).not.toHaveProperty('continuationToken')

    // Second request must include the continuation token from the first response
    const secondBody = JSON.parse(http.mock.calls[1]?.[1]?.body as string)
    expect(secondBody.continuationToken).toBe('next')
  })

  it('sends the marketplace token', async () => {
    // `vi.fn<HttpFn>` rather than plain `vi.fn`: with a zero-argument
    // implementation TS would otherwise infer `mock.calls` as `[][]`, and
    // indexing the call's second argument below would not typecheck.
    const http = vi.fn<HttpFn>(async () => respond(200, { Items: [] }))

    await readOwnedProductIds(TOKEN, { http })

    expect(http.mock.calls[0]?.[1]?.headers?.Authorization).toBe('XBL3.0 x=uhs;tok')
  })

  it('throws on a refusal, so the scan records a partial failure', async () => {
    const http = vi.fn(async () => respond(403, {}))

    await expect(readOwnedProductIds(TOKEN, { http })).rejects.toThrow(/403/)
  })

  it('drops a duplicate product', async () => {
    const http = vi.fn(async () =>
      respond(200, {
        Items: [
          { productId: 'A', productKind: 'Game' },
          { productId: 'A', productKind: 'Game' }
        ]
      })
    )

    expect(await readOwnedProductIds(TOKEN, { http })).toEqual(['A'])
  })
})
