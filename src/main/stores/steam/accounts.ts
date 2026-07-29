import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseVdf, vdfNumber, vdfObject, vdfString } from '@main/platform/vdf'

export interface SteamAccount {
  steamId64: string
  accountName: string
  personaName: string
  autoLogin: boolean
  /** Unix seconds of the last sign-in. */
  timestamp: number
  /**
   * Present only in older Steam versions. Current installations lack the
   * field — the selection then falls back to autoLogin and timestamp.
   */
  mostRecent?: boolean
}

export function parseLoginUsers(content: string): SteamAccount[] {
  let document
  try {
    document = parseVdf(content)
  } catch {
    return []
  }

  const users = vdfObject(document, 'users')
  if (users === undefined) return []

  const accounts: SteamAccount[] = []
  for (const [steamId64, value] of Object.entries(users)) {
    if (typeof value === 'string') continue

    const account: SteamAccount = {
      steamId64,
      accountName: vdfString(value, 'AccountName') ?? '',
      personaName: vdfString(value, 'PersonaName') ?? '',
      autoLogin: vdfString(value, 'AutoLogin') === '1',
      timestamp: vdfNumber(value, 'Timestamp') ?? 0
    }

    const mostRecent = vdfString(value, 'MostRecent')
    if (mostRecent !== undefined) account.mostRecent = mostRecent === '1'

    accounts.push(account)
  }
  return accounts
}

/**
 * Picks the account most likely meant.
 *
 * Order per spec section 7.1:
 *   1. MostRecent === true (no longer exists in current Steam versions)
 *   2. AutoLogin === true
 *   3. highest timestamp
 *
 * The choice is surfaced in the settings as soon as more than one account
 * exists — an automatically chosen identity must never stay invisible.
 */
export function selectAccount(accounts: SteamAccount[]): SteamAccount | undefined {
  if (accounts.length === 0) return undefined
  if (accounts.length === 1) return accounts[0]

  const mostRecent = accounts.find((account) => account.mostRecent === true)
  if (mostRecent !== undefined) return mostRecent

  const autoLogin = accounts.find((account) => account.autoLogin)
  if (autoLogin !== undefined) return autoLogin

  return accounts.reduce((best, current) =>
    current.timestamp > best.timestamp ? current : best
  )
}

export async function readSteamAccounts(steamPath: string): Promise<SteamAccount[]> {
  try {
    const content = await readFile(join(steamPath, 'config', 'loginusers.vdf'), 'utf8')
    return parseLoginUsers(content)
  } catch {
    return []
  }
}
