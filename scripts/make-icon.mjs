/**
 * Draws the application icon.
 *
 * A script rather than a checked-in binary drawn elsewhere: this repository
 * has no image tooling and no designer, and a generated file that can be
 * regenerated and reviewed as code beats an opaque blob nobody can change.
 *
 * PNG is written by hand — signature, IHDR, IDAT, IEND — because the only
 * dependency available is node:zlib, which is all a PNG actually needs.
 * electron-builder converts this to .ico and .icns itself, as long as the
 * source is at least 256x256.
 *
 *   node scripts/make-icon.mjs
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 512
const BG = [0x14, 0x16, 0x1b] // --bg from styles.css
const SURFACE = [0x24, 0x28, 0x32] // --surface-hover
const ACCENT = [0x4a, 0x8c, 0xff] // --accent

const pixels = Buffer.alloc(SIZE * SIZE * 4)

const set = (x, y, [r, g, b], alpha = 255) => {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
  const at = (y * SIZE + x) * 4
  // Straightforward source-over onto whatever is already there.
  const a = alpha / 255
  pixels[at] = Math.round(pixels[at] * (1 - a) + r * a)
  pixels[at + 1] = Math.round(pixels[at + 1] * (1 - a) + g * a)
  pixels[at + 2] = Math.round(pixels[at + 2] * (1 - a) + b * a)
  pixels[at + 3] = 255
}

// Rounded-square background, the shape Windows and Linux both expect.
const RADIUS = 96
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const dx = Math.max(RADIUS - x, x - (SIZE - 1 - RADIUS), 0)
    const dy = Math.max(RADIUS - y, y - (SIZE - 1 - RADIUS), 0)
    const distance = Math.hypot(dx, dy)
    if (distance <= RADIUS) {
      // Feather the last pixel so the corner is not stepped.
      const alpha = distance > RADIUS - 1 ? (RADIUS - distance) * 255 : 255
      set(x, y, BG, Math.max(0, Math.min(255, alpha)))
    }
  }
}

/** Thick line segment, drawn by distance to the segment. */
const stroke = (x1, y1, x2, y2, width, colour) => {
  const half = width / 2
  const vx = x2 - x1
  const vy = y2 - y1
  const lengthSquared = vx * vx + vy * vy
  const minX = Math.floor(Math.min(x1, x2) - half - 1)
  const maxX = Math.ceil(Math.max(x1, x2) + half + 1)
  const minY = Math.floor(Math.min(y1, y2) - half - 1)
  const maxY = Math.ceil(Math.max(y1, y2) + half + 1)

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const t =
        lengthSquared === 0
          ? 0
          : Math.max(0, Math.min(1, ((x - x1) * vx + (y - y1) * vy) / lengthSquared))
      const distance = Math.hypot(x - (x1 + t * vx), y - (y1 + t * vy))
      if (distance <= half) {
        set(x, y, colour, distance > half - 1 ? (half - distance) * 255 : 255)
      }
    }
  }
}

// An "A": two legs and a crossbar. The right leg is the accent colour so
// the mark reads at 16x16, where the crossbar disappears.
const TOP = 128
const BOTTOM = 392
stroke(256, TOP, 168, BOTTOM, 44, SURFACE)
stroke(256, TOP, 344, BOTTOM, 44, ACCENT)
stroke(200, 318, 312, 318, 36, SURFACE)

// --- PNG ------------------------------------------------------------------
const chunk = (type, data) => {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])

  // CRC-32, computed rather than table-driven: it runs four times.
  let crc = 0xffffffff
  for (const byte of body) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)

  return Buffer.concat([length, body, checksum])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // colour type: RGBA
// 10..12 stay zero: deflate, adaptive filtering, no interlace.

// Each scanline is prefixed with its filter type; 0 means "none".
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, png)
console.log(`wrote ${out} (${png.length} bytes, ${SIZE}x${SIZE})`)
