import { t } from '@shared/i18n'
import { defaultHttp, type HttpFn } from './http'
import { authorizationHeader, type XboxToken } from './xbox'

const ENDPOINT = 'https://collections.mp.microsoft.com/v9.0/collections/query'

/** A page big enough that most libraries need one request. */
const PAGE_SIZE = 100

/**
 * A runaway guard, not a real limit.
 *
 * A service that kept returning a continuation token would otherwise loop
 * for ever. Twenty pages is two thousand products — far past any library.
 */
const MAX_PAGES = 20

/**
 * The ProductIds the account is entitled to.
 *
 * The only source that knows about a game bought and never launched. It
 * carries no names at all — everything here is an identifier like
 * `9NBLGGH4R315` — so `displayCatalog.ts` resolves them afterwards.
 *
 * Throws on any refusal. `scanOne` turns that into a partial failure, which
 * leaves the locally-scanned games alone.
 */
export async function readOwnedProductIds(
  token: XboxToken,
  deps: { http?: HttpFn } = {}
): Promise<string[]> {
  const http = deps.http ?? defaultHttp

  const productIds: string[] = []
  const seen = new Set<string>()
  let continuationToken: string | undefined

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await http(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: authorizationHeader(token),
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        maxPageSize: PAGE_SIZE,
        excludeDuplicates: true,
        entitlementFilters: ['*:*:*'],
        validityType: 'All',
        ...(continuationToken === undefined ? {} : { continuationToken })
      })
    })

    if (!response.ok) {
      throw new Error(t().stores.microsoft.collectionsFailed(String(response.status)))
    }

    const body = (await response.json()) as {
      Items?: Array<{ productId?: unknown; productKind?: unknown }>
      continuationToken?: unknown
    }

    for (const item of body.Items ?? []) {
      // Apps, DLC and subscriptions share this collection with the games.
      if (item.productKind !== 'Game') continue
      const productId = item.productId
      if (typeof productId !== 'string' || seen.has(productId)) continue
      seen.add(productId)
      productIds.push(productId)
    }

    continuationToken =
      typeof body.continuationToken === 'string' && body.continuationToken !== ''
        ? body.continuationToken
        : undefined
    if (continuationToken === undefined) break
  }

  return productIds
}
