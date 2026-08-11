/**
 * Generates the PWA icons with zero dependencies.
 *
 * There is no ImageMagick / sharp / PIL in this environment, so this writes
 * PNGs by hand: rasterise with supersampling, then deflate the scanlines and
 * wrap them in the three chunks a PNG needs (IHDR / IDAT / IEND).
 *
 * Design: dark rounded tile with two concentric "macro rings" — an outer
 * green protein ring and an inner amber calorie ring.
 *
 *   node scripts/gen-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const SS = 4 // supersample factor per axis

// ---------------------------------------------------------------- png writing

const crcTable = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** rgba: Uint8Array of size * size * 4 */
function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // truecolour with alpha
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  // Each scanline is prefixed with its filter type (0 = none).
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ------------------------------------------------------------------- geometry

const TAU = Math.PI * 2
const START = -Math.PI / 2 // rings begin at 12 o'clock and sweep clockwise

const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
]

const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]

/** Point-in-rounded-rectangle, centred on the canvas. */
function inRoundRect(x, y, size, radius) {
  const inset = 0
  const min = inset
  const max = size - inset
  if (x < min || y < min || x > max || y > max) return false
  const cx = Math.min(Math.max(x, min + radius), max - radius)
  const cy = Math.min(Math.max(y, min + radius), max - radius)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= radius * radius
}

/** Point-in-arc with round caps: annulus ∩ angular sweep, plus end circles. */
function inArc(dx, dy, rCenter, halfThick, frac) {
  const d = Math.hypot(dx, dy)
  const sweep = frac * TAU
  if (Math.abs(d - rCenter) <= halfThick) {
    let t = (Math.atan2(dy, dx) - START) % TAU
    if (t < 0) t += TAU
    if (t <= sweep) return true
  }
  for (const angle of [START, START + sweep]) {
    const cx = Math.cos(angle) * rCenter
    const cy = Math.sin(angle) * rCenter
    if (Math.hypot(dx - cx, dy - cy) <= halfThick) return true
  }
  return false
}

// -------------------------------------------------------------------- drawing

const BG_TOP = hex('#153324')
const BG_BOTTOM = hex('#080d0a')
const TRACK = hex('#222e28')
const RING_OUTER_A = hex('#3ddc84')
const RING_OUTER_B = hex('#b6f24a')
const RING_INNER_A = hex('#ffc24b')
const RING_INNER_B = hex('#ff8a3d')

const OUTER_FRAC = 0.78
const INNER_FRAC = 0.56

/**
 * @param size    pixel dimensions
 * @param maskable full-bleed square background and shrunken art, so Android
 *                 can crop it to any shape without clipping the rings
 */
function render(size, maskable) {
  const px = new Uint8Array(size * size * 4)
  const c = size / 2
  const art = maskable ? 0.72 : 1 // keep art inside the maskable safe zone
  const radius = maskable ? 0 : size * 0.2237 // iOS-ish squircle-adjacent corner
  const rOuter = size * 0.335 * art
  const rInner = size * 0.196 * art
  const thick = size * 0.088 * art
  const half = thick / 2

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px_ = x + (sx + 0.5) / SS
          const py_ = y + (sy + 0.5) / SS

          if (!inRoundRect(px_, py_, size, radius)) continue

          const dx = px_ - c
          const dy = py_ - c
          let col = mix(BG_TOP, BG_BOTTOM, Math.min(1, (py_ / size) * 1.15))

          // Rotational position, used to shade each ring along its sweep.
          let t = (Math.atan2(dy, dx) - START) % TAU
          if (t < 0) t += TAU

          const d = Math.hypot(dx, dy)
          const onOuterTrack = Math.abs(d - rOuter) <= half
          const onInnerTrack = Math.abs(d - rInner) <= half

          if (inArc(dx, dy, rOuter, half, OUTER_FRAC)) {
            col = mix(RING_OUTER_A, RING_OUTER_B, Math.min(1, t / (OUTER_FRAC * TAU)))
          } else if (inArc(dx, dy, rInner, half, INNER_FRAC)) {
            col = mix(RING_INNER_A, RING_INNER_B, Math.min(1, t / (INNER_FRAC * TAU)))
          } else if (onOuterTrack || onInnerTrack) {
            col = mix(col, TRACK, 0.85) // unfilled remainder of the ring
          }

          r += col[0]
          g += col[1]
          b += col[2]
          a += 255
        }
      }

      const n = SS * SS
      const i = (y * size + x) * 4
      if (a > 0) {
        // Un-premultiply: colour is averaged over covered subsamples only.
        const covered = a / 255
        px[i] = Math.round(r / covered)
        px[i + 1] = Math.round(g / covered)
        px[i + 2] = Math.round(b / covered)
        px[i + 3] = Math.round(a / n)
      }
    }
  }

  return encodePng(px, size)
}

// ----------------------------------------------------------------------- main

mkdirSync(OUT, { recursive: true })

const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, false],
]

for (const [name, size, maskable] of targets) {
  writeFileSync(join(OUT, name), render(size, maskable))
  console.log(`wrote ${name} (${size}×${size})`)
}

// Crisp vector favicon for browser tabs, mirroring the PNG design.
const arcPath = (r, frac) => {
  const sweep = frac * TAU
  const x0 = 256 + Math.cos(START) * r
  const y0 = 256 + Math.sin(START) * r
  const x1 = 256 + Math.cos(START + sweep) * r
  const y1 = 256 + Math.sin(START + sweep) * r
  return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#153324"/><stop offset="1" stop-color="#080d0a"/>
    </linearGradient>
    <linearGradient id="p" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3ddc84"/><stop offset="1" stop-color="#b6f24a"/>
    </linearGradient>
    <linearGradient id="k" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffc24b"/><stop offset="1" stop-color="#ff8a3d"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="115" fill="url(#bg)"/>
  <g fill="none" stroke-linecap="round">
    <circle cx="256" cy="256" r="171" stroke="#222e28" stroke-width="45"/>
    <circle cx="256" cy="256" r="100" stroke="#222e28" stroke-width="45"/>
    <path d="${arcPath(171, OUTER_FRAC)}" stroke="url(#p)" stroke-width="45"/>
    <path d="${arcPath(100, INNER_FRAC)}" stroke="url(#k)" stroke-width="45"/>
  </g>
</svg>
`
writeFileSync(join(OUT, 'favicon.svg'), svg)
console.log('wrote favicon.svg')
