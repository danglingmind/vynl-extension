/**
 * Generates simple PNG icons for the extension using pure Node.js.
 * Run with: node scripts/generate-icons.mjs
 *
 * Creates solid indigo square icons at 16, 32, 48, and 128px.
 * Replace these with proper brand icons before publishing.
 */

import { writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '../src/public/icons')

// Minimal PNG encoder — writes a solid-color square
function createPng(size, r, g, b) {
  const width = size
  const height = size

  // Raw image data: RGBA per pixel
  const pixels = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4 + 0] = r
    pixels[i * 4 + 1] = g
    pixels[i * 4 + 2] = b
    pixels[i * 4 + 3] = 255
  }

  // Build scanlines: filter byte (0x00 = None) + row data
  const scanlines = new Uint8Array(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    scanlines[y * (1 + width * 4)] = 0 // filter type None
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4
      const dst = y * (1 + width * 4) + 1 + x * 4
      scanlines[dst + 0] = pixels[src + 0]
      scanlines[dst + 1] = pixels[src + 1]
      scanlines[dst + 2] = pixels[src + 2]
      scanlines[dst + 3] = pixels[src + 3]
    }
  }

  const deflated = deflate(scanlines)

  const ihdr = buildChunk('IHDR', buildIHDR(width, height))
  const idat = buildChunk('IDAT', deflated)
  const iend = buildChunk('IEND', new Uint8Array(0))

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  return concat([sig, ihdr, idat, iend])
}

function buildIHDR(w, h) {
  const buf = new DataView(new ArrayBuffer(13))
  buf.setUint32(0, w)
  buf.setUint32(4, h)
  buf.setUint8(8, 8)  // bit depth
  buf.setUint8(9, 2)  // color type: truecolor
  buf.setUint8(10, 0) // compression
  buf.setUint8(11, 0) // filter
  buf.setUint8(12, 0) // interlace
  return new Uint8Array(buf.buffer)
}

function buildChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type)
  const len = new DataView(new ArrayBuffer(4))
  len.setUint32(0, data.length)
  const body = concat([typeBytes, data])
  const crcVal = crc32(body)
  const crcBuf = new DataView(new ArrayBuffer(4))
  crcBuf.setUint32(0, crcVal >>> 0)
  return concat([new Uint8Array(len.buffer), body, new Uint8Array(crcBuf.buffer)])
}

function concat(arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) { out.set(a, offset); offset += a.length }
  return out
}

// CRC32
const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(data) {
  let crc = 0xFFFFFFFF
  for (const b of data) crc = crcTable[(crc ^ b) & 0xFF] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

// Minimal zlib/deflate using Node's built-in zlib
import { deflateSync } from 'zlib'

function deflate(data) {
  return deflateSync(Buffer.from(data))
}

// Vynl brand color: #4f6ef7 (indigo-500ish)
const R = 0x4f, G = 0x6e, B = 0xf7

for (const size of [16, 32, 48, 128]) {
  const png = createPng(size, R, G, B)
  const path = join(outDir, `icon-${size}.png`)
  writeFileSync(path, png)
  console.log(`✓ ${path}`)
}
