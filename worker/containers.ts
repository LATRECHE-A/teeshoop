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

/*
 * THE CHUNKS A PICTURE CAN CARRY (SEC-02). The walk alone let a 1 x 1 PNG carry
 * a private chunk of 39 000 bytes of shell script, served back as image/png
 * from the Worker's origin: the length arithmetic closed, and the payload sat
 * in plain bytes any extractor reads. Every chunk registered by the PNG
 * specification (third edition, including APNG's three) is accepted, and one
 * private chunk that real files carry: Apple's iDOT, written into every macOS
 * screenshot. Anything else is refused.
 *
 * A PICTURE STILL HOLDS ANY BYTES IN ITS PIXELS, and nothing short of decoding
 * it can stop that. What this closes is the payload that needs no decoder: a
 * chunk of raw bytes, or a text chunk, read straight off the file.
 *
 * NOT A REFUSAL A CUSTOMER MEETS. `src/lib/teeshoop/upload.ts` runs this same
 * function before sending, trims what follows the image, and re-encodes through
 * a canvas whatever still fails, so a file with a chunk nobody registered
 * reaches the Worker as a plain PNG instead of a 415.
 */
const PNG_CHUNKS = new Set([
  'IHDR', 'PLTE', 'IDAT', 'IEND',
  'tRNS', 'cHRM', 'gAMA', 'iCCP', 'sBIT', 'sRGB', 'cICP', 'mDCV', 'cLLI',
  'tEXt', 'zTXt', 'iTXt', 'bKGD', 'hIST', 'pHYs', 'sPLT', 'eXIf', 'tIME',
  'acTL', 'fcTL', 'fdAT',
  'iDOT',
])

/*
 * The chunks whose content is free text or an opaque blob. A colour profile is
 * a few kilobytes and metadata rarely more; 256 KiB between them is two orders
 * of magnitude above what a camera, an editor or a canvas writes, and far
 * below what is worth hosting.
 */
const PNG_FREE_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'iCCP', 'sPLT'])
const PNG_MAX_FREE_BYTES = 256 * 1024

/**
 * Where a PNG ends: the byte after IEND, or -1 when the bytes are not one.
 *
 * The walk is the security property. Signature, then a sequence of
 * (u32 length, 4-byte type, length bytes, u32 CRC). The first chunk must be
 * IHDR, every chunk must be one a picture carries, and the picture ends the
 * moment IEND ends.
 *
 * The loop advances by at least 12 bytes per iteration, so it is bounded by
 * size/12 with no per-byte work.
 */
export function pngEnd(b: Uint8Array): number {
  try {
    // Signature (8) + the shortest possible IHDR (12 + 13) + IEND (12).
    if (b.length < 8 + 25 + 12) return -1
    for (let i = 0; i < 8; i++) if (b[i] !== PNG_SIG[i]) return -1

    let off = 8
    let first = true
    let free = 0
    while (off + 12 <= b.length) {
      const len = be32(b, off)
      const end = off + 12 + len
      if (end > b.length) return -1
      const type = String.fromCharCode(b[off + 4], b[off + 5], b[off + 6], b[off + 7])
      if (first ? type !== 'IHDR' : !PNG_CHUNKS.has(type)) return -1
      first = false
      if (PNG_FREE_CHUNKS.has(type) && (free += len) > PNG_MAX_FREE_BYTES) return -1
      if (type === 'IEND') return end
      off = end
    }
    return -1
  } catch {
    return -1
  }
}

/** A PNG that closes exactly on IEND at the end of the file: any byte after it is a payload. */
export function isPng(b: Uint8Array): boolean {
  return pngEnd(b) === b.length
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
 *
 * Returns the byte after EOI, or -1. What follows EOI is not the picture: an
 * iPhone writes a second, gain-map JPEG there, which is why the studio trims
 * at this offset rather than refusing the customer's photo (SEC-05).
 */
export function jpegEnd(b: Uint8Array): number {
  try {
    if (b.length < 4) return -1
    if (b[0] !== 0xff || b[1] !== 0xd8) return -1

    let pos = 2
    let sawSof = false
    for (;;) {
      if (pos >= b.length) return -1
      if (b[pos] !== 0xff) return -1
      // Fill bytes: any number of FFs may precede a marker.
      while (pos < b.length && b[pos] === 0xff) pos++
      if (pos >= b.length) return -1
      const marker = b[pos]
      pos++

      if (marker === 0xd9) return sawSof ? pos : -1
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue
      if (marker === 0x00) return -1 // FF 00 is stuffed data, never a marker here

      if (pos + 2 > b.length) return -1
      const segLen = be16(b, pos)
      if (segLen < 2 || pos + segLen > b.length) return -1
      if (isSof(marker)) sawSof = true
      const afterHeader = pos + segLen
      pos = afterHeader

      if (marker === 0xda) {
        let i = pos
        for (;;) {
          if (i + 1 >= b.length) return -1
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
    return -1
  }
}

/** A JPEG ending on EOI as its last two bytes. */
export function isJpeg(b: Uint8Array): boolean {
  return jpegEnd(b) === b.length
}

/** The format, by its container rather than by what the client called the part. */
export function imageContainer(b: Uint8Array): 'png' | 'jpeg' | null {
  if (isPng(b)) return 'png'
  if (isJpeg(b)) return 'jpeg'
  return null
}

/**
 * The same picture as bytes this module accepts, or null when there is no
 * picture to recover. For the studio, which must send the Worker a file it
 * will take rather than one it will refuse at « Ajouter au panier ».
 *
 * Lossless, and untouched when nothing needs doing. What FOLLOWS the picture
 * is cut off (an iPhone's gain-map JPEG after EOI). In a PNG, an ANCILLARY
 * chunk this module does not accept is left out, which the PNG specification
 * says any decoder may do: the bit that marks a chunk ancillary is the promise
 * that the pixels do not depend on it. Free text beyond the cap goes the same
 * way. An unknown CRITICAL chunk cannot be dropped, so that file is null and
 * the studio re-encodes it through a canvas.
 */
export function acceptedImage(b: Uint8Array): Uint8Array | null {
  const jpeg = jpegEnd(b)
  if (jpeg > 0) return b.subarray(0, jpeg)
  try {
    if (b.length < 8 + 25 + 12) return null
    for (let i = 0; i < 8; i++) if (b[i] !== PNG_SIG[i]) return null
    const keep: [number, number][] = [[0, 8]]
    let off = 8
    let free = 0
    let dropped = false
    while (off + 12 <= b.length) {
      const len = be32(b, off)
      const end = off + 12 + len
      if (end > b.length) return null
      const type = String.fromCharCode(b[off + 4], b[off + 5], b[off + 6], b[off + 7])
      if (keep.length === 1 && type !== 'IHDR') return null
      const known = PNG_CHUNKS.has(type)
      const ancillary = (b[off + 4] & 0x20) !== 0
      if (!known && !ancillary) return null
      const over = known && PNG_FREE_CHUNKS.has(type) && free + len > PNG_MAX_FREE_BYTES
      if (known && !over) {
        if (PNG_FREE_CHUNKS.has(type)) free += len
        keep.push([off, end])
      } else {
        dropped = true
      }
      if (type === 'IEND') {
        if (!dropped) return b.subarray(0, end)
        const out = new Uint8Array(keep.reduce((n, [a, z]) => n + z - a, 0))
        let at = 0
        for (const [a, z] of keep) {
          out.set(b.subarray(a, z), at)
          at += z - a
        }
        return isPng(out) ? out : null
      }
      off = end
    }
    return null
  } catch {
    return null
  }
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
 *
 * AND NOTHING BUT JSON THEN ONE BIN (SEC-02). The specification allows chunks
 * of unknown type and says a reader skips them, which made a third chunk a
 * place to park any bytes at all. The BIN chunk has to be the buffer the JSON
 * declares, to within its padding, so it cannot be a larger box either. Our
 * exporter (three's GLTFExporter, binary) writes exactly this shape.
 */
export function isGlb(b: Uint8Array): boolean {
  try {
    if (b.length < 20) return false // 12-byte header + one 8-byte chunk header
    if (!tagIs(b, 0, 'glTF')) return false
    if (le32(b, 4) !== 2) return false
    if (le32(b, 8) !== b.length) return false

    let off = 12
    let chunk = 0
    let declared = -1
    while (off + 8 <= b.length) {
      const len = le32(b, off)
      const payload = off + 8
      if (payload + len > b.length) return false
      // The spec stores chunks already padded to 4; accept either and require
      // the padded end to stay inside the file.
      const end = payload + ((len + 3) & ~3)
      if (end > b.length) return false
      if (chunk === 0) {
        if (!tagIs(b, off + 4, 'JSON')) return false
        if (len === 0 || len > GLB_MAX_JSON_BYTES) return false
        let parsed: unknown
        try {
          parsed = JSON.parse(new TextDecoder().decode(b.subarray(payload, payload + len)))
        } catch {
          return false
        }
        if (typeof parsed !== 'object' || parsed === null) return false
        const root = parsed as Record<string, unknown>
        const asset = root.asset
        if (typeof asset !== 'object' || asset === null || Array.isArray(asset)) return false
        const buffers = root.buffers
        if (buffers !== undefined) {
          // One buffer at most, and it is the BIN chunk: no uri, a length.
          if (!Array.isArray(buffers) || buffers.length > 1) return false
          if (buffers.length === 1) {
            const buf = buffers[0] as Record<string, unknown> | null
            if (typeof buf !== 'object' || buf === null || buf.uri !== undefined) return false
            const n = buf.byteLength
            if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) return false
            declared = n
          }
        }
      } else if (chunk === 1) {
        if (!tagIs(b, off + 4, 'BIN\x00')) return false
        if (declared < 0 || len < declared || len > declared + 3) return false
      } else {
        return false
      }
      chunk++
      off = end
      if (off === b.length) return chunk === 2 || (chunk === 1 && declared < 0)
    }
    return false
  } catch {
    return false
  }
}

const EOCD_LEN = 22
const CD_ENTRY_LEN = 46

/*
 * What a USDZ may contain, by its specification: USD layers and the images they
 * reference. The audio the specification also lists is never written by our
 * exporter, and a sound file is exactly the kind of opaque box this refuses.
 */
const USD_LAYER = ['.usda', '.usdc', '.usd']
const USD_JPEG = ['.jpg', '.jpeg']

/*
 * An extra field is where the specification's 64-byte alignment padding goes
 * (three's exporter writes at most 4 + 63 bytes there). Anything much larger
 * is room for a payload that no reader lists.
 */
const ZIP_MAX_EXTRA = 256

/**
 * A USDZ: an UNCOMPRESSED zip whose central directory closes, every entry of
 * which is stored, and which starts with a USD layer.
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
 * EVERY ENTRY IS A USD LAYER OR A PICTURE, AND IS WHAT IT SAYS (SEC-02). The
 * first version only asked for ONE layer and let anything ride beside it: a
 * stored zip of `payload.sh` and an empty `a.usda` was served from R2 and
 * `unzip` handed the script straight back. Now each entry's name is one the
 * specification allows, its bytes are checked as that format (a layer by its
 * header, a picture by the walks above), its local header agrees with the
 * directory, and the entries tile the archive end to end: no gap between two
 * of them where bytes no reader lists could sit. The first entry is a layer,
 * as the specification requires of the default layer.
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
    let next = 0 // where the next entry's local header has to start
    for (let n = 0; n < entries; n++) {
      if (off + CD_ENTRY_LEN > eocd) return false
      if (!tagIs(b, off, 'PK\x01\x02')) return false
      if (le16(b, off + 8) & 0x0008) return false // sizes after the data: not a stored USDZ
      if (le16(b, off + 10) !== 0) return false // stored only
      const size = le32(b, off + 20)
      if (le32(b, off + 24) !== size) return false
      const nameLen = le16(b, off + 28)
      const extraLen = le16(b, off + 30)
      const commentLen = le16(b, off + 32)
      const local = le32(b, off + 42)
      const nameAt = off + CD_ENTRY_LEN
      const end = nameAt + nameLen + extraLen + commentLen
      if (end > eocd) return false
      if (nameLen === 0 || extraLen > ZIP_MAX_EXTRA || commentLen !== 0) return false

      // The local header: where the previous entry stopped, and the same name.
      if (local !== next || !tagIs(b, local, 'PK\x03\x04')) return false
      const localName = le16(b, local + 26)
      const localExtra = le16(b, local + 28)
      if (localName !== nameLen || localExtra > ZIP_MAX_EXTRA) return false
      for (let k = 0; k < nameLen; k++) if (b[local + 30 + k] !== b[nameAt + k]) return false
      const data = local + 30 + nameLen + localExtra
      if (data + size > cdOffset) return false

      const kind = entryKind(b, nameAt, nameLen)
      if (kind === null || (n === 0 && kind !== 'layer')) return false
      const bytes = b.subarray(data, data + size)
      if (kind === 'layer' ? !isUsdLayer(bytes) : kind === 'png' ? !isPng(bytes) : !isJpeg(bytes)) return false

      next = data + size
      off = end
    }
    return off === eocd && next === cdOffset
  } catch {
    return false
  }
}

/**
 * The kind an entry's name promises, case-insensitively: the specification
 * writes extensions lowercase, but refusing a customer's archive over the case
 * of a few bytes buys no security, since the content is checked as that kind.
 */
function entryKind(b: Uint8Array, at: number, len: number): 'layer' | 'png' | 'jpeg' | null {
  let name = ''
  for (let k = 0; k < len; k++) name += String.fromCharCode(b[at + k])
  name = name.toLowerCase()
  if (USD_LAYER.some((e) => name.endsWith(e))) return 'layer'
  if (name.endsWith('.png')) return 'png'
  if (USD_JPEG.some((e) => name.endsWith(e))) return 'jpeg'
  return null
}

/** A USD layer by its own header: the crate's magic, or the text form's first line. */
function isUsdLayer(b: Uint8Array): boolean {
  return tagIs(b, 0, 'PXR-USDC') || tagIs(b, 0, '#usda ')
}
