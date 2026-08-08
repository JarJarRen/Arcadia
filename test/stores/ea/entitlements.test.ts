import { createCipheriv } from 'node:crypto'
import { win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deriveIv, deriveKey, scopeDirectory } from '@main/stores/ea/crypto'
import {
  eaProgramDataDir,
  eaUserDataDir,
  findUserScope,
  parseEntitlementOffers,
  parseUserIds,
  readEaOwnedOffers,
  type EaEntitlementDeps
} from '@main/stores/ea/entitlements'

const USER_ID = '1000000000001'
const HARDWARE = 'ACME;BB-1;ACME BIOS;BIOS-1;7CB7433E;PCI\\VEN_1002;AuthenticAMD;CPU-1;Test CPU;'
const ENV = { LOCALAPPDATA: 'C:\\Local', ProgramData: 'C:\\ProgramData' } as NodeJS.ProcessEnv

function encryptStore(plain: string, scope: string, contentId: string): Buffer {
  const cipher = createCipheriv('aes-256-cbc', deriveKey(scope, contentId, HARDWARE), deriveIv(scope, contentId))
  return Buffer.concat([
    Buffer.from('0'.repeat(64), 'ascii'),
    cipher.update(plain, 'utf8'),
    cipher.final()
  ])
}

const ENTITLEMENTS = JSON.stringify({
  entitlements: [
    { offerId: 'Origin.OFR.50.0004024', entitlementType: 'ORIGIN_DOWNLOAD' },
    // The same game again — one game holds several entitlements.
    { offerId: 'Origin.OFR.50.0004024', entitlementType: 'ONLINE_ACCESS' },
    { offerId: 'OFB-EAST:46851', entitlementType: 'ORIGIN_DOWNLOAD' }
  ]
})

function deps(overrides: Partial<EaEntitlementDeps> = {}): EaEntitlementDeps {
  const userDir = eaUserDataDir(ENV)
  const root = eaProgramDataDir(ENV)
  return {
    env: ENV,
    hardware: async () => HARDWARE,
    listDir: async (path) => {
      if (path === userDir) return ['user_1234.ini', 'cookie.ini']
      if (path === root) return [scopeDirectory(USER_ID), 'Logs', 'InstallData']
      throw new Error(`unexpected directory ${path}`)
    },
    readText: async () => `user.userid=${USER_ID}\r\nlocation.language=de`,
    readBytes: async (path) => {
      if (path === win32.join(root, scopeDirectory(USER_ID), 'NS')) {
        return encryptStore(ENTITLEMENTS, USER_ID, 'NS')
      }
      throw new Error(`unexpected file ${path}`)
    },
    ...overrides
  }
}

describe('EA entitlements', () => {
  it('reads the user ID out of a settings file', () => {
    expect(parseUserIds('user.windowposx=10\r\nuser.userid=1000000000001\r\n')).toEqual([
      '1000000000001'
    ])
    expect(parseUserIds('nothing here')).toEqual([])
  })

  it('accepts only a user ID whose store directory exists', () => {
    // The directory is SHA3-256 of the ID, so a candidate can be verified
    // instead of trusted. That is what keeps a wrong guess from decrypting
    // something else.
    expect(findUserScope([USER_ID], [scopeDirectory(USER_ID)])).toBe(USER_ID)
    expect(findUserScope([USER_ID], ['Logs'])).toBeUndefined()
    expect(findUserScope(['999'], [scopeDirectory(USER_ID)])).toBeUndefined()
  })

  it('deduplicates the offers', () => {
    // One game holds a download entitlement and an online-access one; both
    // name the same offer.
    expect(parseEntitlementOffers(ENTITLEMENTS)).toEqual([
      'Origin.OFR.50.0004024',
      'OFB-EAST:46851'
    ])
  })

  it('survives an entitlement store that is not what it should be', () => {
    expect(parseEntitlementOffers('not json')).toEqual([])
    expect(parseEntitlementOffers('{"entitlements":"nope"}')).toEqual([])
    expect(parseEntitlementOffers('{"entitlements":[{"offerId":7},{},null]}')).toEqual([])
  })

  it('reads the owned offers end to end', async () => {
    expect(await readEaOwnedOffers(deps())).toEqual([
      'Origin.OFR.50.0004024',
      'OFB-EAST:46851'
    ])
  })

  it('returns nothing when the hardware string cannot be built', async () => {
    expect(await readEaOwnedOffers(deps({ hardware: async () => undefined }))).toEqual([])
  })

  it('returns nothing when EA is not installed', async () => {
    expect(
      await readEaOwnedOffers(
        deps({
          listDir: async () => {
            throw new Error('ENOENT')
          }
        })
      )
    ).toEqual([])
  })

  it('returns nothing when no settings file names a user', async () => {
    expect(await readEaOwnedOffers(deps({ readText: async () => 'location.language=de' }))).toEqual(
      []
    )
  })

  it('returns nothing when the store belongs to another account', async () => {
    expect(
      await readEaOwnedOffers(
        deps({ readText: async () => 'user.userid=1234567890123' })
      )
    ).toEqual([])
  })

  it('returns nothing when EA has changed the encryption', async () => {
    // A key that no longer fits must not fail the scan — the installed games
    // are read separately and have to survive it.
    expect(
      await readEaOwnedOffers(deps({ hardware: async () => 'different hardware;' }))
    ).toEqual([])
  })

  it('returns nothing when the EA ProgramData store is not readable', async () => {
    // The candidate user ID is found via LOCALAPPDATA, but the store
    // directories themselves live under ProgramData — a separate directory
    // that can fail independently.
    const root = eaProgramDataDir(ENV)
    expect(
      await readEaOwnedOffers(
        deps({
          listDir: async (path) => {
            if (path === root) throw new Error('ENOENT')
            return ['user_1234.ini']
          }
        })
      )
    ).toEqual([])
  })

  it('returns nothing when the entitlement store file cannot be read', async () => {
    expect(
      await readEaOwnedOffers(
        deps({
          readBytes: async () => {
            throw new Error('EPERM')
          }
        })
      )
    ).toEqual([])
  })

  it('carries on when one settings file cannot be read', async () => {
    let first = true
    const overrides = {
      readText: async (): Promise<string> => {
        if (first) {
          first = false
          throw new Error('locked')
        }
        return `user.userid=${USER_ID}`
      },
      listDir: async (path: string): Promise<string[]> => {
        if (path === eaUserDataDir(ENV)) return ['user_a.ini', 'user_b.ini']
        return [scopeDirectory(USER_ID)]
      }
    }
    expect(await readEaOwnedOffers(deps(overrides))).toHaveLength(2)
  })
})
