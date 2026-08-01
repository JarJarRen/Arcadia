import { app } from 'electron'
import { createCipheriv, createHash, getHashes } from 'node:crypto'
import { decryptStore, deriveIv, deriveKey, scopeDirectory } from '@main/stores/ea/crypto'
import { sha3_256Hex } from '@main/stores/ea/sha3'

/**
 * Runtime test for the primitives the main process relies on.
 *
 * Why this exists: `npm test` runs under vitest, which runs on **Node**. The
 * application runs on **Electron**, and the two do not offer the same crypto.
 * Electron links BoringSSL rather than OpenSSL — `process.versions.openssl`
 * reads `0.0.0` — and BoringSSL ships no SHA-3 at all.
 *
 * That difference shipped once already. `createHash('sha3-256')` throws
 * "Digest method not supported" in Electron while passing every test under
 * Node, so 604 green tests sat next to an EA library that was silently always
 * empty: a wrong or missing hash cannot decrypt a store, and an unreadable
 * store is indistinguishable from owning nothing.
 *
 * The layout smoke test next door catches what the unit tests cannot see
 * because they never render. This catches what they cannot see because they
 * never run on Electron.
 *
 * Deliberately independent of this machine: it needs no EA installation, no
 * account and no network. The store it decrypts is one it encrypted itself.
 *
 * Run with: npm run smoke:runtime
 */

const problems: string[] = []

function check(condition: boolean, failure: string): void {
  if (!condition) problems.push(failure)
}

/** NIST vectors, plus a directory name read off a real EA installation. */
function checkSha3(): void {
  const vectors: Array<[string, string]> = [
    ['', 'a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a'],
    ['abc', '3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '41c0dba2a9d6240849100376a8235e2c82e1b9998a999e21db32dd97496d3376'
    ],
    // The scope every machine-wide EA store lives under. If this one is
    // wrong, the adapter finds no store at all.
    ['allUsersGenericId', '530c11479fe252fc5aabc24935b9776d4900eb3ba58fdc271e0d6229413ad40e']
  ]

  for (const [input, expected] of vectors) {
    const actual = sha3_256Hex(input)
    check(
      actual === expected,
      `SHA3-256(${JSON.stringify(input.slice(0, 20))}) is ${actual.slice(0, 16)}…, expected ${expected.slice(0, 16)}…`
    )
  }

  check(
    scopeDirectory('allUsersGenericId') ===
      '530c11479fe252fc5aabc24935b9776d4900eb3ba58fdc271e0d6229413ad40e',
    'scopeDirectory does not reproduce the directory EA actually uses.'
  )
}

/**
 * The primitives that do come from node:crypto.
 *
 * SHA-1 and AES-256-CBC are present under BoringSSL and are used as they
 * come. If a future Electron loses either, the EA adapter breaks in the same
 * silent way SHA-3 did, and this is where that shows up.
 */
function checkNodeCrypto(): void {
  for (const algorithm of ['sha1', 'sha256']) {
    try {
      createHash(algorithm).update('x').digest()
    } catch {
      problems.push(`node:crypto no longer provides ${algorithm}.`)
    }
  }
  try {
    createCipheriv('aes-256-cbc', Buffer.alloc(32), Buffer.alloc(16))
  } catch {
    problems.push('node:crypto no longer provides aes-256-cbc.')
  }
}

/** The whole derivation and decryption path, on a store built here. */
function checkEaRoundTrip(): void {
  const scope = '1000000000001'
  const contentId = 'NS'
  const hardware = 'ACME;BB-1;ACME BIOS;BIOS-1;7CB7433E;PCI\\VEN_1002;AuthenticAMD;CPU-1;Test CPU   ;'
  const plain = '{"entitlements":[{"offerId":"Origin.OFR.50.0004024"}]}'

  const cipher = createCipheriv(
    'aes-256-cbc',
    deriveKey(scope, contentId, hardware),
    deriveIv(scope, contentId)
  )
  const file = Buffer.concat([
    // 64 ASCII hex characters of header before the ciphertext, as EA writes.
    Buffer.from('0'.repeat(64), 'ascii'),
    cipher.update(plain, 'utf8'),
    cipher.final()
  ])

  check(
    decryptStore(file, { scope, contentId, hardware }) === plain,
    'An EA store encrypted and decrypted in the same process did not survive the round trip.'
  )
  // A wrong key has to be refused rather than silently truncated.
  check(
    decryptStore(file, { scope, contentId, hardware: 'wrong;' }) === undefined,
    'A store decrypted with the wrong hardware string was not rejected.'
  )
}

app.whenReady().then(() => {
  console.log(`Electron ${process.versions.electron}, OpenSSL "${process.versions.openssl}"`)
  // Informational, never a failure: the point is that Arcadia does not depend
  // on it either way.
  console.log(`node:crypto offers sha3-256: ${getHashes().includes('sha3-256')}`)

  checkSha3()
  checkNodeCrypto()
  checkEaRoundTrip()

  if (problems.length > 0) {
    console.error('\nRuntime test failed:')
    for (const problem of problems) console.error(`  - ${problem}`)
    app.exit(1)
    return
  }

  console.log('Runtime test passed: SHA-3, SHA-1 and AES all behave under Electron.')
  app.exit(0)
})
