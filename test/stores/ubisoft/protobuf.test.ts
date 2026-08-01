import { describe, expect, it } from 'vitest'
import { bytesField, numberField, parseMessage } from '@main/stores/ubisoft/protobuf'

/** Encodes a base-128 varint, so the fixtures are built rather than pasted. */
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
const bytesFieldOf = (field: number, value: Buffer | string): Buffer => {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8')
  return Buffer.concat([tag(field, 2), varint(body.length), body])
}

describe('protobuf reader', () => {
  it('reads varints, including ones spanning several bytes', () => {
    const message = Buffer.concat([
      varintField(1, 4),
      varintField(2, 300),
      varintField(3, 16884),
      varintField(4, 0)
    ])
    const fields = parseMessage(message)
    expect(fields?.map((f) => f.value)).toEqual([4, 300, 16884, 0])
  })

  it('reads length-delimited fields', () => {
    const fields = parseMessage(bytesFieldOf(4, 'NWXH-8TMF-E83A-3HJT'))
    expect(bytesField(fields!, 4)?.toString()).toBe('NWXH-8TMF-E83A-3HJT')
  })

  it('keeps repeated fields apart instead of merging them', () => {
    // The ownership cache is a hundred records under field 1; collapsing them
    // would lose all but one game.
    const message = Buffer.concat([bytesFieldOf(1, 'a'), bytesFieldOf(1, 'b'), bytesFieldOf(1, 'c')])
    expect(parseMessage(message)).toHaveLength(3)
  })

  it('parses a nested message', () => {
    const inner = Buffer.concat([varintField(1, 635), varintField(6, 0)])
    const fields = parseMessage(bytesFieldOf(1, inner))
    const nested = parseMessage(bytesField(fields!, 1)!)
    expect(numberField(nested!, 1)).toBe(635)
    expect(numberField(nested!, 6)).toBe(0)
  })

  it('skips fixed-width fields without losing its place', () => {
    const message = Buffer.concat([
      Buffer.concat([tag(1, 5), Buffer.alloc(4)]),
      Buffer.concat([tag(2, 1), Buffer.alloc(8)]),
      varintField(3, 7)
    ])
    expect(numberField(parseMessage(message)!, 3)).toBe(7)
  })

  it('refuses a truncated message rather than returning half of one', () => {
    // Half a parse is indistinguishable from a short but valid message, and
    // reading at a wrong offset produces exactly that.
    const message = Buffer.concat([tag(1, 2), varint(50), Buffer.from('too short')])
    expect(parseMessage(message)).toBeUndefined()
  })

  it('refuses field number zero and unknown wire types', () => {
    expect(parseMessage(Buffer.from([0x00, 0x01]))).toBeUndefined()
    expect(parseMessage(Buffer.concat([tag(1, 7), varint(1)]))).toBeUndefined()
  })

  it('refuses a varint that never ends', () => {
    expect(parseMessage(Buffer.from([0x08, 0xff, 0xff, 0xff]))).toBeUndefined()
  })

  it('returns no fields for an empty message', () => {
    expect(parseMessage(Buffer.alloc(0))).toEqual([])
  })
})
