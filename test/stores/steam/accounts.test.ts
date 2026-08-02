import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseLoginUsers,
  readSteamAccounts,
  selectAccount,
  type SteamAccount
} from '@main/stores/steam/accounts'

const FIXTURES = join(__dirname, '../../fixtures/steam')
const fixture = (name: string): Promise<string> => readFile(join(FIXTURES, name), 'utf8')

function account(overrides: Partial<SteamAccount> = {}): SteamAccount {
  return {
    steamId64: '76561197960287930',
    accountName: 'testuser',
    personaName: 'Test account',
    autoLogin: false,
    timestamp: 0,
    ...overrides
  }
}

describe('parseLoginUsers', () => {
  it('reads every account', async () => {
    const accounts = parseLoginUsers(await fixture('loginusers.vdf'))
    expect(accounts).toHaveLength(2)
    expect(accounts[0]).toEqual({
      steamId64: '76561197960287930',
      accountName: 'testuser',
      personaName: 'Test account',
      autoLogin: true,
      timestamp: 1784969728
    })
  })

  it('reads a file with only one account too', async () => {
    const accounts = parseLoginUsers(await fixture('loginusers-single.vdf'))
    expect(accounts).toHaveLength(1)
    expect(accounts[0]?.accountName).toBe('testuser')
  })

  it('returns an empty array for broken content', () => {
    expect(parseLoginUsers('broken {{{')).toEqual([])
    expect(parseLoginUsers('')).toEqual([])
  })
})

describe('selectAccount', () => {
  it('prefers MostRecent when present', () => {
    // Older Steam versions wrote this field. Current ones no longer do — it
    // is still checked, because old installations still carry it.
    const accounts = [
      account({ steamId64: 'A', timestamp: 100 }),
      account({ steamId64: 'B', timestamp: 50, mostRecent: true })
    ]
    expect(selectAccount(accounts)?.steamId64).toBe('B')
  })

  it('otherwise takes the account with AutoLogin', () => {
    const accounts = [
      account({ steamId64: 'A', timestamp: 999 }),
      account({ steamId64: 'B', autoLogin: true, timestamp: 1 })
    ]
    expect(selectAccount(accounts)?.steamId64).toBe('B')
  })

  it('otherwise takes the most recent timestamp', () => {
    const accounts = [
      account({ steamId64: 'A', timestamp: 100 }),
      account({ steamId64: 'B', timestamp: 500 })
    ]
    expect(selectAccount(accounts)?.steamId64).toBe('B')
  })

  it('takes the only account when there is exactly one', () => {
    expect(selectAccount([account({ steamId64: 'X' })])?.steamId64).toBe('X')
  })

  it('returns undefined when there are no accounts', () => {
    expect(selectAccount([])).toBeUndefined()
  })

  it('picks the AutoLogin account on the real target structure', async () => {
    const accounts = parseLoginUsers(await fixture('loginusers.vdf'))
    expect(selectAccount(accounts)?.accountName).toBe('testuser')
  })
})

describe('readSteamAccounts', () => {
  // Real directories rather than a mocked file system, matching how the
  // rest of this store's I/O-error handling is tested.
  let steamPath: string

  beforeEach(async () => {
    steamPath = await mkdtemp(join(tmpdir(), 'arcadia-steam-accounts-'))
  })

  afterEach(async () => {
    await rm(steamPath, { recursive: true, force: true })
  })

  it('reads accounts from a real loginusers.vdf', async () => {
    await mkdir(join(steamPath, 'config'), { recursive: true })
    await writeFile(
      join(steamPath, 'config', 'loginusers.vdf'),
      await fixture('loginusers.vdf'),
      'utf8'
    )

    const accounts = await readSteamAccounts(steamPath)
    expect(accounts).toHaveLength(2)
    expect(accounts.map((a) => a.accountName)).toContain('testuser')
  })

  it('returns an empty list when loginusers.vdf does not exist', async () => {
    expect(await readSteamAccounts(steamPath)).toEqual([])
  })
})
