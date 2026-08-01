/**
 * SHA3-256, implemented here rather than taken from `node:crypto`.
 *
 * **Electron does not have it.** Electron links BoringSSL, not OpenSSL —
 * `process.versions.openssl` reads `0.0.0` — and BoringSSL ships no SHA-3.
 * `createHash('sha3-256')` throws `Digest method not supported` there, while
 * `sha1` and `aes-256-cbc` work fine.
 *
 * This is exactly the kind of gap the test suite cannot see: vitest runs on
 * Node, whose OpenSSL does support SHA-3, so all 604 tests passed while the
 * packaged application could not read a single EA store. It was found by
 * running the real app and reading the log.
 *
 * EA's key derivation needs SHA3-256 twice — once for the key, once for the
 * IV — and the directory a store lives in is SHA3-256 of its scope, so there
 * is no way around it.
 *
 * Written with BigInt lanes. Keccak is usually implemented on 32-bit halves
 * for speed, but a scan performs a few dozen hashes of a few dozen bytes;
 * clarity is worth more here than a throughput nobody will measure.
 */

const MASK = (1n << 64n) - 1n

/** Rate for SHA3-256: 1600 - 2*256 bits, as bytes. */
const RATE = 136

const OUTPUT_BYTES = 32

/**
 * The domain separator that distinguishes SHA-3 from plain Keccak.
 *
 * `0x06` for SHA-3; original Keccak used `0x01`. Getting this wrong yields a
 * hash that is self-consistent and matches nothing else in the world — which
 * is why the tests compare against published vectors rather than against
 * this file's own output.
 */
const PADDING = 0x06

const ROUND_CONSTANTS: readonly bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n
]

function rotl(value: bigint, shift: bigint): bigint {
  if (shift === 0n) return value & MASK
  return ((value << shift) | ((value & MASK) >> (64n - shift))) & MASK
}

/** Keccak-f[1600], in place. */
function permute(lanes: bigint[]): void {
  const c = new Array<bigint>(5)
  const d = new Array<bigint>(5)

  for (const roundConstant of ROUND_CONSTANTS) {
    // theta
    for (let x = 0; x < 5; x++) {
      c[x] = lanes[x]! ^ lanes[x + 5]! ^ lanes[x + 10]! ^ lanes[x + 15]! ^ lanes[x + 20]!
    }
    for (let x = 0; x < 5; x++) {
      d[x] = c[(x + 4) % 5]! ^ rotl(c[(x + 1) % 5]!, 1n)
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 25; y += 5) lanes[x + y] = lanes[x + y]! ^ d[x]!
    }

    // rho and pi, walked rather than tabulated: the offsets follow from the
    // step itself, which removes a 25-entry table that is easy to mistype and
    // impossible to spot once wrong.
    let x = 1
    let y = 0
    let current = lanes[1]!
    for (let t = 0; t < 24; t++) {
      const nextX = y
      const nextY = (2 * x + 3 * y) % 5
      const index = nextX + 5 * nextY
      const held = lanes[index]!
      lanes[index] = rotl(current, BigInt((((t + 1) * (t + 2)) / 2) % 64))
      current = held
      x = nextX
      y = nextY
    }

    // chi
    for (let row = 0; row < 25; row += 5) {
      const t0 = lanes[row]!
      const t1 = lanes[row + 1]!
      const t2 = lanes[row + 2]!
      const t3 = lanes[row + 3]!
      const t4 = lanes[row + 4]!
      lanes[row] = t0 ^ (~t1 & t2 & MASK)
      lanes[row + 1] = t1 ^ (~t2 & t3 & MASK)
      lanes[row + 2] = t2 ^ (~t3 & t4 & MASK)
      lanes[row + 3] = t3 ^ (~t4 & t0 & MASK)
      lanes[row + 4] = t4 ^ (~t0 & t1 & MASK)
    }

    // iota
    lanes[0] = lanes[0]! ^ roundConstant
  }
}

/** Absorbs one rate-sized block of little-endian lanes. */
function absorb(lanes: bigint[], block: Buffer): void {
  for (let offset = 0; offset < RATE; offset += 8) {
    lanes[offset / 8] = lanes[offset / 8]! ^ block.readBigUInt64LE(offset)
  }
  permute(lanes)
}

export function sha3_256(input: Buffer | string): Buffer {
  const message = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  const lanes = new Array<bigint>(25).fill(0n)

  let offset = 0
  for (; offset + RATE <= message.length; offset += RATE) {
    absorb(lanes, message.subarray(offset, offset + RATE))
  }

  // The final block always exists, even for an empty message and even when
  // the message divides evenly by the rate — padding is never optional.
  const tail = Buffer.alloc(RATE)
  message.copy(tail, 0, offset)
  tail[message.length - offset] = PADDING
  tail[RATE - 1] = (tail[RATE - 1] ?? 0) | 0x80
  absorb(lanes, tail)

  const digest = Buffer.alloc(OUTPUT_BYTES)
  for (let i = 0; i < OUTPUT_BYTES; i += 8) {
    digest.writeBigUInt64LE(lanes[i / 8]! & MASK, i)
  }
  return digest
}

export function sha3_256Hex(input: Buffer | string): string {
  return sha3_256(input).toString('hex')
}
