import { createHash, getHashes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { sha3_256Hex } from '@main/stores/ea/sha3'

/**
 * Why this exists at all: Electron links BoringSSL, which has no SHA-3, so
 * `createHash('sha3-256')` throws "Digest method not supported" in the
 * packaged app while working perfectly under vitest, which runs on Node's
 * OpenSSL. The implementation therefore has to be ours — and has to be
 * checked against published vectors rather than against itself.
 */
describe('SHA3-256', () => {
  it('matches the published vectors', () => {
    expect(sha3_256Hex('')).toBe(
      'a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a'
    )
    expect(sha3_256Hex('abc')).toBe(
      '3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532'
    )
    expect(sha3_256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '41c0dba2a9d6240849100376a8235e2c82e1b9998a999e21db32dd97496d3376'
    )
    expect(
      sha3_256Hex(
        'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmno' +
          'ijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu'
      )
    ).toBe('916f6061fe879741ca6469b43971dfdb28b1a32dc36cb3254e812be27aad1d18')
  })

  it('reproduces the directory names EA actually uses', () => {
    // Read off the development machine. If the implementation drifts, the EA
    // adapter stops finding any store at all — this is the anchor for that.
    expect(sha3_256Hex('allUsersGenericId')).toBe(
      '530c11479fe252fc5aabc24935b9776d4900eb3ba58fdc271e0d6229413ad40e'
    )
  })

  it('handles the rate boundary', () => {
    // 136 bytes is exactly one block, and padding is never optional: a
    // message that divides evenly still gets a whole extra block. Off-by-one
    // here would break only for particular lengths.
    for (const length of [134, 135, 136, 137, 271, 272, 273]) {
      const input = Buffer.alloc(length, 0x61)
      expect(sha3_256Hex(input), `length ${length}`).toBe(
        createHash('sha3-256').update(input).digest('hex')
      )
    }
  })

  it('agrees with OpenSSL across every length up to three blocks', () => {
    // Node has SHA-3 even though Electron does not, which makes it a free
    // oracle for the implementation the app will actually run.
    if (!getHashes().includes('sha3-256')) return

    for (let length = 0; length <= 300; length++) {
      const input = Buffer.from(Array.from({ length }, (_, i) => (i * 7 + 13) % 256))
      expect(sha3_256Hex(input), `length ${length}`).toBe(
        createHash('sha3-256').update(input).digest('hex')
      )
    }
  })

  it('accepts a string and a buffer alike', () => {
    expect(sha3_256Hex('EA')).toBe(sha3_256Hex(Buffer.from('EA', 'utf8')))
  })

  it('hashes non-ASCII as UTF-8', () => {
    expect(sha3_256Hex('EA SPORTS™')).toBe(
      createHash('sha3-256').update('EA SPORTS™', 'utf8').digest('hex')
    )
  })
})
