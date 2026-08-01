import { createDecipheriv, createHash } from 'node:crypto'
import { sha3_256, sha3_256Hex } from './sha3'

/**
 * Decryption of EA Desktop's local stores.
 *
 * EA Desktop keeps its state in `C:\ProgramData\EA Desktop\<hash>\<name>`,
 * encrypted with a key derived from this machine's hardware. The scheme was
 * confirmed on the development machine by decrypting the install queue and
 * the entitlement list and reading valid JSON back out of both:
 *
 * ```
 * key = SHA3-256( scope + contentId + SHA1_hex(hardware) )
 * iv  = SHA3-256( scope + contentId )[0..16]
 *       AES-256-CBC, PKCS#7
 * ```
 *
 * `scope` is `allUsersGenericId` for the machine-wide stores and the numeric
 * Nucleus user ID for the per-user ones. The directory a store lives in is
 * `SHA3-256(scope)`, which is what makes a guessed user ID checkable: only a
 * guess that hashes to a directory that actually exists can be right.
 *
 * **Nothing here touches the disk.** Buffers in, string out — so the one
 * genuinely subtle part of this feature can be tested without a fixture taken
 * from a real machine, and without a hardware serial in the repository.
 *
 * Not everything under that directory yields to this. `IS` and `CATS2` do not
 * decrypt with their file name as `contentId`; 1.17 million string literals
 * harvested from EA's own binaries and 2,160 variants of the hardware string
 * were tried against them without a hit. Neither is needed — the entitlement
 * list carries ownership, and names come from EA's catalogue service.
 */

/** The scope EA uses for stores that are not tied to an account. */
export const GENERIC_SCOPE = 'allUsersGenericId'

/**
 * The store file begins with 64 ASCII hex characters before the ciphertext.
 *
 * Measured identical for every store file on the development machine. It is
 * not needed for decryption and is skipped rather than verified: what it
 * hashes is unknown, and guessing wrong would reject files that decrypt
 * perfectly well.
 */
const HEADER_LENGTH = 64

const AES_BLOCK = 16

/**
 * The directory name a scope's stores live in.
 *
 * SHA-3 comes from sha3.ts, not from `node:crypto`: Electron links BoringSSL,
 * which has no SHA-3 at all and throws "Digest method not supported". SHA-1
 * and AES below are fine there and stay where they are.
 */
export function scopeDirectory(scope: string): string {
  return sha3_256Hex(scope)
}

export function deriveKey(scope: string, contentId: string, hardware: string): Buffer {
  // SHA1 of the hardware string, as lowercase hex — not raw bytes. Both were
  // tried; only the hex form decrypts.
  const fingerprint = createHash('sha1').update(hardware, 'utf8').digest('hex')
  return sha3_256(`${scope}${contentId}${fingerprint}`)
}

/**
 * The IV, which depends on no secret at all.
 *
 * It is therefore identical on every machine for a given store. That is EA's
 * design, not an oversight on this side.
 */
export function deriveIv(scope: string, contentId: string): Buffer {
  return sha3_256(`${scope}${contentId}`).subarray(0, AES_BLOCK)
}

/**
 * Removes PKCS#7 padding, rejecting anything that is not valid padding.
 *
 * The check matters: a wrong key produces plausible-looking bytes, and
 * accepting whatever the last byte claims would silently truncate the
 * plaintext instead of failing.
 */
function stripPadding(plain: Buffer): Buffer | undefined {
  const pad = plain[plain.length - 1]
  if (pad === undefined || pad < 1 || pad > AES_BLOCK || pad > plain.length) return undefined
  for (let i = plain.length - pad; i < plain.length; i++) {
    if (plain[i] !== pad) return undefined
  }
  return plain.subarray(0, plain.length - pad)
}

export interface DecryptOptions {
  scope: string
  contentId: string
  hardware: string
}

/**
 * Decrypts a store file to its plaintext.
 *
 * Returns `undefined` for every failure — a truncated file, a key that no
 * longer fits because EA changed the scheme, anything. The caller's answer to
 * all of them is the same: no owned games this time, and the installed ones
 * are unaffected.
 */
export function decryptStore(file: Buffer, options: DecryptOptions): string | undefined {
  const payload = file.subarray(HEADER_LENGTH)
  if (payload.length === 0 || payload.length % AES_BLOCK !== 0) return undefined

  let plain: Buffer
  try {
    const decipher = createDecipheriv(
      'aes-256-cbc',
      deriveKey(options.scope, options.contentId, options.hardware),
      deriveIv(options.scope, options.contentId)
    )
    // Padding is removed here rather than by Node, so that invalid padding is
    // a return value instead of an exception.
    decipher.setAutoPadding(false)
    plain = Buffer.concat([decipher.update(payload), decipher.final()])
  } catch {
    return undefined
  }

  const body = stripPadding(plain)
  return body === undefined ? undefined : body.toString('utf8')
}
