import { readFile, writeFile } from 'node:fs/promises'
import { t } from '@shared/i18n'
import { defaultHttp, type HttpFn } from './http'

const ENDPOINT = 'https://displaycatalog.mp.microsoft.com/v7.0/products'

export interface CatalogEntry {
  productId: string
  /**
   * Empty where the catalogue named the product in no language Arcadia
   * asked for.
   *
   * Kept rather than dropped, because the title history can still name it:
   * the design says the history contributes "a name for anything the
   * catalogue could not resolve", and the package family name below is the
   * key that joins the two. `scanOwned` drops what neither source names.
   */
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
 * The Store product behind each package, by package family name.
 *
 * Needs no authentication at all, which is why it is separate from the
 * token-bearing modules: the title history says which packages the account
 * has, and this says what each one is in the Store.
 *
 * Two things come back that nothing else can supply. The ProductId, which is
 * the only identifier `ms-windows-store://pdp/` accepts, so without this
 * there is no Install. And the ProductKind, which is how an application that
 * happens to be in a game library gets left out — the title history reports
 * what was launched and does not classify it.
 *
 * One request per package, because `alternateId` takes a single value; the
 * `bigIds` form that batched twenty at a time only accepts ProductIds, which
 * is the thing we are trying to obtain. The cache is what keeps that from
 * mattering: a library only pays it once.
 */
export async function resolveByPackageFamilyName(
  packageFamilyNames: string[],
  deps: Deps = {}
): Promise<CatalogEntry[]> {
  if (packageFamilyNames.length === 0) return []

  const cached =
    deps.cachePath === undefined ? [] : await readCatalogCache(deps.cachePath)
  const known = new Map(cached.map((entry) => [entry.packageFamilyName, entry]))

  const missing = packageFamilyNames.filter((name) => !known.has(name))
  if (missing.length > 0) {
    for (const entry of await lookUpPackages(missing, deps)) {
      known.set(entry.packageFamilyName, entry)
    }
    if (deps.cachePath !== undefined) await writeCatalogCache(deps.cachePath, [...known.values()])
  }

  // Only what was asked for, in the order it was asked for.
  const resolved: CatalogEntry[] = []
  for (const name of packageFamilyNames) {
    const entry = known.get(name)
    if (entry !== undefined) resolved.push(entry)
  }
  return resolved
}

async function lookUpPackages(
  packageFamilyNames: string[],
  deps: Deps
): Promise<CatalogEntry[]> {
  const http = deps.http ?? defaultHttp
  const locale = deps.locale ?? t().format.locale
  const entries: CatalogEntry[] = []

  for (const packageFamilyName of packageFamilyNames) {
    const query = new URLSearchParams({
      market: 'US',
      languages: locale,
      alternateId: 'PackageFamilyName',
      value: packageFamilyName
    })

    const response = await http(`${ENDPOINT}/lookup?${query.toString()}`, {
      headers: { Accept: 'application/json' }
    })
    // A package the catalogue has never heard of answers 404. That is a
    // gap in what can be shown, not a failure of the scan, so it is skipped
    // rather than thrown — one delisted title must not cost the whole
    // library.
    if (response.status === 404) continue
    if (!response.ok) {
      throw new Error(t().stores.microsoft.catalogFailed(String(response.status)))
    }

    const body = (await response.json()) as {
      Products?: Array<{
        ProductId?: unknown
        ProductKind?: unknown
        LocalizedProperties?: Array<{ ProductTitle?: unknown }>
      }>
    }

    for (const product of body.Products ?? []) {
      // Apps, DLC and subscriptions share the catalogue with the games.
      if (product.ProductKind !== 'Game') continue

      const productId = product.ProductId
      const name = product.LocalizedProperties?.[0]?.ProductTitle
      if (typeof productId !== 'string' || productId === '') continue

      // The package name is the one we asked with, not one read back out of
      // the answer. The lookup form does not return `Properties` at all —
      // that came with the `bigIds` query's `fieldsTemplate=details` — so
      // reading it back dropped every single product on the floor. It was
      // redundant besides: a lookup by package family name can only answer
      // about that package.
      //
      // A missing title is not a reason to drop the product either.
      // `languages` is the interface language, and a product with no
      // localisation for it comes back with an empty LocalizedProperties;
      // the title history can still name it.
      entries.push({
        productId,
        name: typeof name === 'string' ? name : '',
        packageFamilyName
      })
    }
  }
  return entries
}

/**
 * The cache on its own.
 *
 * Read by `installUri` as well as by `resolveByPackageFamilyName`: opening a
 * product page needs the ProductId, and the game row carries only the
 * package family name.
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
