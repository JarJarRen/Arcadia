import { describe, expect, it } from 'vitest'
import {
  parseOwnership,
  readUbisoftOwnedIds,
  ubisoftCacheDir
} from '@main/stores/ubisoft/ownership'

function varint(value: number): Buffer {
  const bytes: number[] = []
  let rest = value
  do {
    let byte = rest & 0x7f
    rest = Math.floor(rest / 128)
    if (rest > 0) byte |= 0x80
    bytes.push(byte)
  } while (rest > 0)
  return Buffer.from(bytes)
}
const tag = (field: number, wire: number): Buffer => varint((field << 3) | wire)
const varintField = (field: number, value: number): Buffer =>
  Buffer.concat([tag(field, 0), varint(value)])
const record = (id: number, kind: number): Buffer => {
  const body = Buffer.concat([varintField(1, id), varintField(6, kind)])
  return Buffer.concat([tag(1, 2), varint(body.length), body])
}

/** Assembles a file in the shape Ubisoft Connect writes. */
function ownershipFile(
  records: Buffer[],
  options: { version?: Buffer; declared?: number } = {}
): Buffer {
  const payload = Buffer.concat(records)
  const length = Buffer.alloc(4)
  length.writeUInt32LE(options.declared ?? payload.length)
  return Buffer.concat([
    options.version ?? Buffer.from([0x00, 0x01, 0x00, 0x00]),
    // The 256-byte RSA signature. Its content is irrelevant: there is no key
    // to verify it with, and it is skipped rather than checked.
    Buffer.alloc(256, 0xab),
    length,
    payload
  ])
}

describe('Ubisoft ownership cache', () => {
  it('finds the cache under LOCALAPPDATA', () => {
    expect(ubisoftCacheDir({ LOCALAPPDATA: 'C:\\Local' } as NodeJS.ProcessEnv)).toBe(
      'C:\\Local\\Ubisoft Game Launcher\\cache'
    )
  })

  it('reads the owned base games', () => {
    // 4 and 635 are real IDs from the development machine; 635 is Rainbow Six
    // Siege and is also one of the four registry entries.
    const file = ownershipFile([record(4, 0), record(635, 0), record(16232, 0)])
    expect(parseOwnership(file)).toEqual(['4', '635', '16232'])
  })

  it('leaves out add-ons', () => {
    // Measured: 99 records, of which only 17 are games. The rest are DLC that
    // would otherwise each appear as a game of its own.
    const file = ownershipFile([record(4, 0), record(12747, 1), record(12748, 1), record(54, 0)])
    expect(parseOwnership(file)).toEqual(['4', '54'])
  })

  it('deduplicates', () => {
    expect(parseOwnership(ownershipFile([record(4, 0), record(4, 0)]))).toEqual(['4'])
  })

  it('rejects a file whose declared length disagrees', () => {
    // A half-written cache. Parsing it anyway yields records that are merely
    // plausible, which is worse than none.
    const file = ownershipFile([record(4, 0)], { declared: 999 })
    expect(parseOwnership(file)).toEqual([])
  })

  it('rejects an unknown version', () => {
    const file = ownershipFile([record(4, 0)], { version: Buffer.from([0x00, 0x02, 0x00, 0x00]) })
    expect(parseOwnership(file)).toEqual([])
  })

  it('rejects a file too short to hold a header', () => {
    expect(parseOwnership(Buffer.alloc(10))).toEqual([])
    expect(parseOwnership(Buffer.alloc(0))).toEqual([])
  })

  it('rejects a payload that is not protobuf', () => {
    const payload = Buffer.from('this is not protobuf at all', 'utf8')
    const length = Buffer.alloc(4)
    length.writeUInt32LE(payload.length)
    const file = Buffer.concat([
      Buffer.from([0x00, 0x01, 0x00, 0x00]),
      Buffer.alloc(256),
      length,
      payload
    ])
    expect(parseOwnership(file)).toEqual([])
  })

  it('merges the caches of several accounts', async () => {
    // Nothing local says which account is the current one, and a game too
    // many beats a library belonging to the wrong person.
    const ids = await readUbisoftOwnedIds({
      env: { LOCALAPPDATA: 'C:\\Local' } as NodeJS.ProcessEnv,
      listDir: async () => ['account-a', 'account-b'],
      readBytes: async (path) =>
        path.endsWith('account-a')
          ? ownershipFile([record(4, 0)])
          : ownershipFile([record(635, 0), record(4, 0)])
    })
    expect(ids).toEqual(['4', '635'])
  })

  it('returns nothing when Ubisoft Connect has never run here', async () => {
    expect(
      await readUbisoftOwnedIds({
        env: { LOCALAPPDATA: 'C:\\Local' } as NodeJS.ProcessEnv,
        listDir: async () => {
          throw new Error('ENOENT')
        }
      })
    ).toEqual([])
  })

  it('carries on when one account file cannot be read', async () => {
    const ids = await readUbisoftOwnedIds({
      env: { LOCALAPPDATA: 'C:\\Local' } as NodeJS.ProcessEnv,
      listDir: async () => ['locked', 'fine'],
      readBytes: async (path) => {
        if (path.endsWith('locked')) throw new Error('EACCES')
        return ownershipFile([record(635, 0)])
      }
    })
    expect(ids).toEqual(['635'])
  })
})
