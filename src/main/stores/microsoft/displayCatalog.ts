import { readFile, writeFile } from 'node:fs/promises'
import { t } from '@shared/i18n'
import { defaultHttp, type HttpFn } from './http'

const ENDPOINT = 'https://displaycatalog.mp.microsoft.com/v7.0/products'

/**
 * Products per request.
 *
 * The service takes the ids in the query string, so an unbatched library
 * would build a URL of unbounded length. Twenty is comfortably inside every
 * limit involved.
 */
const BATCH_SIZE = 20

export interface CatalogEntry {
  productId: string
  name: string
  /** Games without one are console titles and never reach this list. */
  packageFamilyName: string
}

interface Deps {
  http?: HttpFn
  /**
   * Where the resolved names are cached.
   *
   * Without it every scan asks the catalogue about the whole library again.
   * Not fatal, just wasteful — so this stays optional and tests leave it
   * out. It is also what `installUri` reads a ProductId back out of.
   */
  cachePath?: string
  locale?: string
}

/**
 * Names and packages for owned products.
 *
 * Needs no authentication at all, which is why it is separate from the two
 * token-bearing modules: the entitlement service says *what* is owned, and
 * this says what any of it is called.
 */
export async function resolveProducts(
  productIds: string[],
  deps: Deps = {}
): Promise<CatalogEntry[]> {
  if (productIds.length === 0) return []

  const cached =
    deps.cachePath === undefined ? [] : await readCatalogCache(deps.cachePath)
  const known = new Map(cached.map((entry) => [entry.productId, entry]))

  const missing = productIds.filter((id) => !known.has(id))
  if (missing.length > 0) {
    for (const entry of await fetchProducts(missing, deps)) {
      known.set(entry.productId, entry)
    }
    if (deps.cachePath !== undefined) await writeCatalogCache(deps.cachePath, [...known.values()])
  }

  // Only what was asked for, in the order it was asked for.
  const resolved: CatalogEntry[] = []
  for (const id of productIds) {
    const entry = known.get(id)
    if (entry !== undefined) resolved.push(entry)
  }
  return resolved
}

async function fetchProducts(productIds: string[], deps: Deps): Promise<CatalogEntry[]> {
  const http = deps.http ?? defaultHttp
  const locale = deps.locale ?? t().format.locale
  const entries: CatalogEntry[] = []

  for (let start = 0; start < productIds.length; start += BATCH_SIZE) {
    const batch = productIds.slice(start, start + BATCH_SIZE)
    const query = new URLSearchParams({
      bigIds: batch.join(','),
      market: 'US',
      languages: locale,
      fieldsTemplate: 'details'
    })

    const response = await http(`${ENDPOINT}?${query.toString()}`, {
      headers: { Accept: 'application/json' }
    })
    if (!response.ok) {
      throw new Error(t().stores.microsoft.catalogFailed(String(response.status)))
    }

    const body = (await response.json()) as {
      Products?: Array<{
        ProductId?: unknown
        ProductKind?: unknown
        LocalizedProperties?: Array<{ ProductTitle?: unknown }>
        Properties?: { PackageFamilyName?: unknown }
      }>
    }

    for (const product of body.Products ?? []) {
      // Apps, DLC and subscriptions share the catalogue with the games.
      if (product.ProductKind !== 'Game') continue

      const productId = product.ProductId
      const name = product.LocalizedProperties?.[0]?.ProductTitle
      const packageFamilyName = product.Properties?.PackageFamilyName
      if (typeof productId !== 'string' || productId === '') continue
      if (typeof name !== 'string' || name === '') continue
      // No package: a console title, which cannot run on this machine.
      if (typeof packageFamilyName !== 'string' || packageFamilyName === '') continue

      entries.push({ productId, name, packageFamilyName })
    }
  }
  return entries
}

/**
 * The cache on its own.
 *
 * Read by `installUri` as well as by `resolveProducts`: opening a product
 * page needs the ProductId, and the game row carries only the package
 * family name.
 */
export async function readCatalogCache(cachePath: string): Promise<CatalogEntry[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(cachePath, 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is CatalogEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as CatalogEntry).productId === 'string' &&
        typeof (entry as CatalogEntry).name === 'string' &&
        typeof (entry as CatalogEntry).packageFamilyName === 'string'
    )
  } catch {
    // No file yet, or one that cannot be parsed. Either way the answer is
    // the same: nothing is cached, so everything is fetched.
    return []
  }
}

async function writeCatalogCache(cachePath: string, entries: CatalogEntry[]): Promise<void> {
  try {
    await writeFile(cachePath, JSON.stringify(entries), 'utf8')
  } catch (error) {
    // A cache that cannot be written costs requests, not correctness.
    console.warn('Microsoft catalogue cache could not be written:', error)
  }
}
