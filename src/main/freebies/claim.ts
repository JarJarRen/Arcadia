import type { Freebie } from '@shared/freebies'

/**
 * The hosts an https claim URL may point at.
 *
 * Matched on the registrable domain and its subdomains, never by suffix:
 * `notgamerpower.com` ends with `gamerpower.com` and must not pass.
 */
const ALLOWED_HOSTS: readonly string[] = [
  'gamerpower.com',
  'store.epicgames.com',
  'epicgames.com',
  'steampowered.com',
  'ubisoft.com',
  'ubisoftconnect.com',
  'ea.com',
  'xbox.com',
  'microsoft.com'
]

/** Digits only. Anything else could not be an AppID and must not reach steam://. */
const APP_ID = /^[1-9]\d*$/

/**
 * Epic's page slugs: lowercase, digits and hyphens, starting with a letter
 * or digit. Deliberately narrower than whatever Epic might accept — this is
 * a value going into a URI, and being strict costs nothing but a fallback.
 */
const PAGE_SLUG = /^[a-z0-9][a-z0-9-]*$/

function hostIsAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
}

/**
 * The URL an https claim opens in the browser.
 *
 * Throws rather than falling back to something more permissive: a row whose
 * target cannot be vouched for is not claimable, and saying so is better
 * than opening a URL nobody checked.
 */
function checkedUrl(claimUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(claimUrl)
  } catch {
    throw new Error(`Not a usable claim address: ${claimUrl}`)
  }
  // https only. This is what kills javascript:, file:, data: — and plain
  // http, which is downgradeable and which no store Arcadia knows needs.
  if (parsed.protocol !== 'https:') {
    throw new Error(`Refusing a claim address that is not https: ${claimUrl}`)
  }
  if (!hostIsAllowed(parsed.hostname)) {
    throw new Error(`Refusing a claim address on an unknown host: ${parsed.hostname}`)
  }
  return parsed.toString()
}

export function claimTarget(row: Freebie): string {
  if (row.storeGameId !== undefined) {
    if (row.storeId === 'steam') {
      if (!APP_ID.test(row.storeGameId)) {
        throw new Error(`Not a Steam AppID: ${row.storeGameId}`)
      }
      // The store page inside the client, not steam://install. A game
      // discounted to zero still goes through a purchase step, so install
      // would be right only some of the time; the store page is always
      // right and leaves the last click to the user.
      return `steam://store/${row.storeGameId}`
    }
    if (row.storeId === 'epic') {
      if (!PAGE_SLUG.test(row.storeGameId)) {
        throw new Error(`Not an Epic page slug: ${row.storeGameId}`)
      }
      return `com.epicgames.launcher://store/p/${row.storeGameId}`
    }
  }

  if (row.claimUrl !== undefined && row.claimUrl.length > 0) return checkedUrl(row.claimUrl)

  throw new Error(`Nothing to open for ${row.title}`)
}
