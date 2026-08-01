/**
 * Just enough protobuf to read Ubisoft's two local caches.
 *
 * Both the ownership cache and the configuration catalogue are protobuf with
 * no schema published anywhere, so there is nothing to generate code from and
 * a dependency would buy nothing: what is needed is the wire format, which is
 * four wire types and a varint.
 *
 * Fields are returned as they appear, without merging repeats — the ownership
 * cache is a hundred records under the same field number, and collapsing them
 * into one value would be the wrong shape entirely.
 */

export type ProtoValue = number | Buffer

export interface ProtoField {
  field: number
  value: ProtoValue
}

/** Wire types. Group start/end (3 and 4) are deprecated and never appear. */
const VARINT = 0
const FIXED64 = 1
const LENGTH = 2
const FIXED32 = 5

/**
 * Reads a base-128 varint.
 *
 * Returns `undefined` for one that never terminates or runs off the end,
 * which is how a truncated or misaligned file announces itself.
 */
function readVarint(buffer: Buffer, from: number): { value: number; next: number } | undefined {
  let result = 0n
  let shift = 0n
  let pos = from
  // Ten groups of seven bits covers the full 64-bit range; more than that is
  // a malformed stream rather than a large number.
  for (let count = 0; count < 10 && pos < buffer.length; count++) {
    const byte = buffer[pos]!
    pos++
    result |= BigInt(byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return { value: Number(result), next: pos }
    shift += 7n
  }
  return undefined
}

/**
 * Parses one message into its fields.
 *
 * Returns `undefined` rather than throwing or returning a partial list: a
 * message that does not parse cleanly to the end is not a message, and half
 * of one would be indistinguishable from a short but valid one.
 */
export function parseMessage(buffer: Buffer): ProtoField[] | undefined {
  const fields: ProtoField[] = []
  let pos = 0

  while (pos < buffer.length) {
    const key = readVarint(buffer, pos)
    if (key === undefined) return undefined
    pos = key.next

    const field = key.value >>> 3
    const wire = key.value & 7
    // Field number 0 is illegal and is the usual sign of reading at the wrong
    // offset — worth rejecting rather than carrying on into nonsense.
    if (field === 0) return undefined

    if (wire === VARINT) {
      const value = readVarint(buffer, pos)
      if (value === undefined) return undefined
      pos = value.next
      fields.push({ field, value: value.value })
    } else if (wire === LENGTH) {
      const length = readVarint(buffer, pos)
      if (length === undefined) return undefined
      const end = length.next + length.value
      if (length.value < 0 || end > buffer.length) return undefined
      fields.push({ field, value: buffer.subarray(length.next, end) })
      pos = end
    } else if (wire === FIXED32) {
      if (pos + 4 > buffer.length) return undefined
      pos += 4
    } else if (wire === FIXED64) {
      if (pos + 8 > buffer.length) return undefined
      pos += 8
    } else {
      return undefined
    }
  }

  return fields
}

/** The first value for a field number, or undefined. */
export function firstField(fields: ProtoField[], field: number): ProtoValue | undefined {
  return fields.find((entry) => entry.field === field)?.value
}

export function numberField(fields: ProtoField[], field: number): number | undefined {
  const value = firstField(fields, field)
  return typeof value === 'number' ? value : undefined
}

export function bytesField(fields: ProtoField[], field: number): Buffer | undefined {
  const value = firstField(fields, field)
  return Buffer.isBuffer(value) ? value : undefined
}
