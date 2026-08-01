import { createCipheriv } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  decryptStore,
  deriveIv,
  deriveKey,
  GENERIC_SCOPE,
  scopeDirectory
} from '@main/stores/ea/crypto'

/**
 * Builds a store file the way EA does.
 *
 * The fixture is generated here rather than copied from a real machine: the
 * real files are encrypted with that machine's hardware serials, and neither
 * those nor a stranger's entitlements belong in a repository.
 */
function encrypt(plain: string, scope: string, contentId: string, hardware: string): Buffer {
  const cipher = createCipheriv('aes-256-cbc', deriveKey(scope, contentId, hardware), deriveIv(scope, contentId))
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  // 64 ASCII hex characters before the ciphertext, as EA writes them. The
  // content is irrelevant to decryption — it is skipped, not verified.
  return Buffer.concat([Buffer.from('0'.repeat(64), 'ascii'), body])
}

const HARDWARE = 'ACME;BB-1;ACME BIOS;BIOS-1;7CB7433E;PCI\\VEN_1002;AuthenticAMD;CPU-1;Test CPU;'

describe('EA store decryption', () => {
  it('hashes the scope to the directory EA keeps it in', () => {
    // Both values were read off the development machine and are what makes a
    // guessed user ID checkable rather than merely plausible.
    expect(scopeDirectory(GENERIC_SCOPE)).toBe(
      '530c11479fe252fc5aabc24935b9776d4900eb3ba58fdc271e0d6229413ad40e'
    )
    expect(scopeDirectory('')).toBe(
      'a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a'
    )
  })

  it('produces a 256-bit key and a 128-bit IV', () => {
    expect(deriveKey(GENERIC_SCOPE, 'NS', HARDWARE)).toHaveLength(32)
    expect(deriveIv(GENERIC_SCOPE, 'NS')).toHaveLength(16)
  })

  it('derives the IV without the hardware string', () => {
    // EA's design, not an oversight here: the IV is identical on every
    // machine, and only the key carries the secret.
    expect(deriveIv('1000000000001', 'NS')).toEqual(deriveIv('1000000000001', 'NS'))
    expect(deriveKey('1000000000001', 'NS', HARDWARE)).not.toEqual(
      deriveKey('1000000000001', 'NS', `${HARDWARE}x`)
    )
  })

  it('decrypts what it encrypted', () => {
    const plain = '{"entitlements":[{"offerId":"Origin.OFR.50.0004024"}]}'
    const file = encrypt(plain, '1000000000001', 'NS', HARDWARE)
    expect(decryptStore(file, { scope: '1000000000001', contentId: 'NS', hardware: HARDWARE })).toBe(
      plain
    )
  })

  it('returns undefined for the wrong hardware, scope or content', () => {
    const file = encrypt('{"entitlements":[]}', '1000000000001', 'NS', HARDWARE)
    // A wrong key does not fail loudly — it produces bytes. The padding check
    // is what turns that into a refusal instead of silent nonsense.
    expect(
      decryptStore(file, { scope: '1000000000001', contentId: 'NS', hardware: 'other;' })
    ).toBeUndefined()
    expect(
      decryptStore(file, { scope: '9999999999999', contentId: 'NS', hardware: HARDWARE })
    ).toBeUndefined()
    expect(
      decryptStore(file, { scope: '1000000000001', contentId: 'IS', hardware: HARDWARE })
    ).toBeUndefined()
  })

  it('returns undefined for a file that is not a whole number of blocks', () => {
    const file = encrypt('{"entitlements":[]}', GENERIC_SCOPE, 'NS', HARDWARE)
    const truncated = file.subarray(0, file.length - 3)
    expect(
      decryptStore(truncated, { scope: GENERIC_SCOPE, contentId: 'NS', hardware: HARDWARE })
    ).toBeUndefined()
  })

  it('returns undefined for a file that is only a header', () => {
    expect(
      decryptStore(Buffer.from('0'.repeat(64), 'ascii'), {
        scope: GENERIC_SCOPE,
        contentId: 'NS',
        hardware: HARDWARE
      })
    ).toBeUndefined()
  })
})
