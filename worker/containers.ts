/**
 * Container validation for the two OPEN upload routes.
 *
 * WHY THIS EXISTS, measured. Both routes claimed to be non-abusable through
 * "magic-byte checks". Against a real `wrangler dev` on 2026-08-27 that claim
 * was false: eight PNG signature bytes followed by 300 000 bytes of urandom was
 * accepted by `POST /api/design` and served back byte-identical from
 * `/r2/design/<id>/preview.png` with `content-type: image/png` and
 * `cache-control: public, max-age=31536000, immutable`. The same for `POST
 * /api/ar`: four bytes of 'glTF' plus urandom, and an ordinary zip of a text
 * file renamed .usdz, whose payload `unzip -l` listed straight off
 * `/r2/ar/<id>.usdz`. That is free, permanent, immutable, unauthenticated
 * hosting for arbitrary bytes on the origin that serves the shop.
 *
 * A prefix test cannot fix that, because the whole point of the attack is what
 * comes AFTER the prefix. So each function here walks the container's own
 * length arithmetic and requires it to close exactly on the end of the file.
 * That, not the signature, is what stops appended data.
 *
 * TWO RULES SHAPE EVERY FUNCTION.
 *
 *   Strict enough that trailing bytes cannot ride along, and NO stricter. A
 *   false refusal is a paying customer whose upload fails. Nothing here
 *   verifies a checksum, decodes an image, or insists on structure the format
 *   merely recommends. The CRCs in a PNG are deliberately not checked: that is
 *   a pass over every byte, and an attacker who can append can also compute a
 *   CRC, so it buys nothing here.
 *
 *   Refuse, never throw. An uncaught throw in these handlers is a 500 on input
 *   anyone can send (the same mistake `decodeURIComponent` already forced a
 *   note about in index.ts). Every exported function is total: malformed input
 *   returns false, and the bodies are wrapped so that a bounds or parse
 *   surprise is a refusal rather than an exception.
 *
 * PURE ON PURPOSE. No imports, no DOM, no node builtins, so it typechecks under
 * worker/tsconfig.json and runs unchanged in a node test. It works on
 * Uint8Array views and never copies the file: the only allocation is the glTF
 * JSON chunk, which is capped below for exactly that reason.
 */

/** Big-endian u32. `>>> 0` because bit 31 set would otherwise read negative. */
function be32(b: Uint8Array, i: number): number {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
}

function be16(b: Uint8Array, i: number): number {
  return (b[i] << 8) | b[i + 1]
}

function le16(b: Uint8Array, i: number): number {
  return b[i] | (b[i + 1] << 8)
}

function le32(b: Uint8Array, i: number): number {
  return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0
}

/** Compare `n` bytes at `i` against an ASCII tag, without allocating a string. */
function tagIs(b: Uint8Array, i: number, tag: string): boolean {
  if (i + tag.length > b.length) return false
  for (let k = 0; k < tag.length; k++) if (b[i + k] !== tag.charCodeAt(k)) return false
  return true
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * A PNG whose chunk arithmetic closes exactly on IEND at the end of the file.
 *
 * The walk is the security property. Signature, then a sequence of
 * (u32 length, 4-byte type, length bytes, u32 CRC). The first chunk must be
 * IHDR, and the file ends the moment IEND ends: any byte after that is an
 * attacker's payload, not a picture.
 *
 * The loop advances by at least 12 bytes per iteration, so it is bounded by
 * size/12 with no per-byte work.
 */
export function isPng(b: Uint8Array): boolean {
  try {
    // Signature (8) + the shortest possible IHDR (12 + 13) + IEND (12).
    if (b.length < 8 + 25 + 12) return false
    for (let i = 0; i < 8; i++) if (b[i] !== PNG_SIG[i]) return false

    let off = 8
    let first = true
    while (off + 12 <= b.length) {
      const len = be32(b, off)
      const end = off + 12 + len
      if (end > b.length) return false
      if (first) {
        if (!tagIs(b, off + 4, 'IHDR')) return false
        first = false
      }
      if (tagIs(b, off + 4, 'IEND')) return end === b.length
      off = end
    }
    return false
  } catch {
    return false
  }
}

/** SOFn: 0xC0..0xCF minus DHT (C4), the reserved JPG marker (C8) and DAC (CC). */
function isSof(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

/**
 * A JPEG walked segment by segment, ending on EOI as the last two bytes.
 *
 * Two shapes have to be handled and only one of them is length-prefixed.
 * Marker segments carry a big-endian length that includes its own two bytes.
 * Stand-alone markers (TEM 0x01, RSTn 0xD0..0xD7, SOI, EOI) carry nothing. And
 * after SOS the entropy-coded scan is not delimited at all, so it is scanned
 * for the next real marker: an FF followed by 0x00 is a stuffed data byte, an
 * FF followed by an RSTn is a restart inside the scan, and a run of FFs is
 * legal padding before a marker. Anything else ends the scan.
 *
 * At least one SOFn is required, because a file with no frame header describes
 * no image whatever its markers say.
 */
export function isJpeg(b: Uint8Array): boolean {
  try {
    if (b.length < 4) return false
    if (b[0] !== 0xff || b[1] !== 0xd8) return false
    if (b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9) return false

    let pos = 2
    let sawSof = false
    for (;;) {
      if (pos >= b.length) return false
      if (b[pos] !== 0xff) return false
      // Fill bytes: any number of FFs may precede a marker.
      while (pos < b.length && b[pos] === 0xff) pos++
      if (pos >= b.length) return false
      const marker = b[pos]
      pos++

      if (marker === 0xd9) return pos === b.length && sawSof
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue
      if (marker === 0x00) return false // FF 00 is stuffed data, never a marker here

      if (pos + 2 > b.length) return false
      const segLen = be16(b, pos)
      if (segLen < 2 || pos + segLen > b.length) return false
      if (isSof(marker)) sawSof = true
      const afterHeader = pos + segLen
      pos = afterHeader

      if (marker === 0xda) {
        let i = pos
        for (;;) {
          if (i + 1 >= b.length) return false
          if (b[i] !== 0xff) {
            i++
            continue
          }
          const next = b[i + 1]
          if (next === 0x00) {
            i += 2
          } else if (next >= 0xd0 && next <= 0xd7) {
            i += 2
          } else if (next === 0xff) {
            i++
          } else {
            break
          }
        }
        pos = i
      }
    }
  } catch {
    return false
  }
}

/** The format, by its container rather than by what the client called the part. */
export function imageContainer(b: Uint8Array): 'png' | 'jpeg' | null {
  if (isPng(b)) return 'png'
  if (isJpeg(b)) return 'jpeg'
  return null
}

/*
 * The one allocation in this file. A glTF JSON chunk has to become a string to
 * be parsed, so it is capped rather than decoded blind: without a cap, a GLB
 * that is 12 MB of JSON would be copied whole, which is the thing this module
 * is supposed to avoid. Our own exporter (three's GLTFExporter in binary mode)
 * puts every buffer and texture in the BIN chunk, so its JSON is tens of KB.
 * 4 MiB leaves two orders of magnitude of headroom before a real upload could
 * be refused.
 */
const GLB_MAX_JSON_BYTES = 4 * 1024 * 1024

/**
 * A glTF-binary whose declared total length IS the file, and whose chunk list
 * closes on that same byte.
 *
 * The header's length field is the first thing that makes appended bytes
 * detectable, and the chunk walk is what makes them detectable when the header
 * is forged too. The first chunk must be JSON and must parse as an object with
 * an `asset` member: that is the one field glTF 2.0 makes mandatory, so it is
 * the cheapest proof that the bytes are a scene and not a container shell
 * wrapped round a payload.
 */
export function isGlb(b: Uint8Array): boolean {
  try {
    if (b.length < 20) return false // 12-byte header + one 8-byte chunk header
    if (!tagIs(b, 0, 'glTF')) return false
    if (le32(b, 4) !== 2) return false
    if (le32(b, 8) !== b.length) return false

    let off = 12
    let first = true
    while (off + 8 <= b.length) {
      const len = le32(b, off)
      const payload = off + 8
      if (payload + len > b.length) return false
      // The spec stores chunks already padded to 4; accept either and require
      // the padded end to stay inside the file.
      const end = payload + ((len + 3) & ~3)
      if (end > b.length) return false
      if (first) {
        if (!tagIs(b, off + 4, 'JSON')) return false
        if (len === 0 || len > GLB_MAX_JSON_BYTES) return false
        let parsed: unknown
        try {
          parsed = JSON.parse(new TextDecoder().decode(b.subarray(payload, payload + len)))
        } catch {
          return false
        }
        if (typeof parsed !== 'object' || parsed === null) return false
        const asset = (parsed as Record<string, unknown>).asset
        if (typeof asset !== 'object' || asset === null || Array.isArray(asset)) return false
        first = false
      }
      off = end
      if (off === b.length) return !first
    }
    return false
  } catch {
    return false
  }
}

const EOCD_LEN = 22
const CD_ENTRY_LEN = 46

/**
 * A USDZ: an UNCOMPRESSED zip whose central directory closes, every entry of
 * which is stored, and which contains at least one .usdc or .usda.
 *
 * Compression method 0 is not a nicety, it is what the USDZ specification
 * requires (Quick Look memory-maps the crate straight out of the archive), and
 * it is also the check that turns "any zip" into "a zip a USDZ reader could
 * actually open". A plain `zip -j payload.txt` fails both halves.
 *
 * The archive comment is refused above 21 bytes. A comment is the one place a
 * zip can carry arbitrary trailing bytes, and 22 is the length of an End Of
 * Central Directory record, so a comment that long can hide a second EOCD and
 * make two readers disagree about what the archive contains.
 *
 * The walk is bounded by the entry count, which the EOCD stores in 16 bits.
 */
export function isUsdz(b: Uint8Array): boolean {
  try {
    if (b.length < EOCD_LEN) return false

    // The comment cap means the EOCD can only be in the last 43 bytes, so this
    // is a fixed-size search, not a scan back over the file.
    let eocd = -1
    for (let comment = 0; comment <= EOCD_LEN - 1; comment++) {
      const at = b.length - EOCD_LEN - comment
      if (at < 0) break
      if (!tagIs(b, at, 'PK\x05\x06')) continue
      if (le16(b, at + 20) !== comment) continue
      eocd = at
      break
    }
    if (eocd < 0) return false

    const entries = le16(b, eocd + 10)
    if (entries === 0) return false
    if (le16(b, eocd + 8) !== entries) return false // split archives are not USDZ
    const cdSize = le32(b, eocd + 12)
    const cdOffset = le32(b, eocd + 16)
    if (cdOffset + cdSize !== eocd) return false

    let off = cdOffset
    let sawUsd = false
    for (let n = 0; n < entries; n++) {
      if (off + CD_ENTRY_LEN > eocd) return false
      if (!tagIs(b, off, 'PK\x01\x02')) return false
      if (le16(b, off + 10) !== 0) return false // stored only
      const nameLen = le16(b, off + 28)
      const extraLen = le16(b, off + 30)
      const commentLen = le16(b, off + 32)
      const nameAt = off + CD_ENTRY_LEN
      const end = nameAt + nameLen + extraLen + commentLen
      if (end > eocd) return false
      if (nameLen >= 5 && endsWithUsd(b, nameAt, nameLen)) sawUsd = true
      off = end
    }
    return off === eocd && sawUsd
  } catch {
    return false
  }
}

/**
 * Case-insensitive suffix test on the raw name bytes. The specification writes
 * the extension lowercase, but refusing a customer's archive over the case of
 * five bytes buys no security at all: a payload named .USDC is still refused by
 * the stored-method and the walk.
 */
function endsWithUsd(b: Uint8Array, at: number, len: number): boolean {
  const i = at + len - 5
  if (b[i] !== 0x2e) return false // '.'
  const lower = (c: number) => (c >= 0x41 && c <= 0x5a ? c + 32 : c)
  if (lower(b[i + 1]) !== 0x75 || lower(b[i + 2]) !== 0x73 || lower(b[i + 3]) !== 0x64) return false
  const last = lower(b[i + 4])
  return last === 0x63 || last === 0x61 // 'c' or 'a'
}
