/**
 * Minimal, dependency-free ZIP writer — the DTF export bundles a whole order
 * (N print sheets + N cutting plans + the manifest + a human-readable summary)
 * into ONE download instead of firing N `downloadBlob` calls that browsers
 * throttle, reorder and silently drop.
 *
 * SHAPE — why it looks like this
 * -----------------------------
 * • STORE only (compression method 0). The payload is almost entirely PNG,
 *   which is already DEFLATEd; re-compressing it costs seconds of main-thread
 *   time for ~0 % gain. The JSON/TXT members are kilobytes. Storing also keeps
 *   this file small enough to audit, which matters more than a rounding error
 *   on the download size.
 * • Blobs are never materialised into memory. Each member's CRC-32 and length
 *   are computed by STREAMING the blob, then the final archive is assembled as
 *   a `Blob` whose parts are the (still lazy, possibly disk-backed) member
 *   blobs. A 12-sheet 300-dpi gang-sheet order is easily 1.5 GB of PNG; reading
 *   that into ArrayBuffers would kill the tab.
 * • ZIP64 is implemented, not skipped. Those same orders cross the 4 GiB /
 *   0xFFFFFFFF offset ceiling for real, and a truncated archive is a silent
 *   data-loss bug that only shows up at the print shop.
 * • Filenames are written UTF-8 with general-purpose bit 11 (EFS) set, because
 *   French order names ("Commande Été — Résidence") are the normal case here.
 *
 * Deterministic given its inputs: the only clock reading is the caller-supplied
 * `date` (the modal passes ONE timestamp for the whole archive), never
 * `Date.now()` from inside.
 */

/** One member of the archive. */
export interface ZipEntry {
  /**
   * Path inside the archive, `/`-separated. Sanitised on write (backslashes,
   * leading slashes, `..` segments and control characters are removed) — a
   * relative, forward-slashed path is the only portable form.
   */
  name: string
  blob: Blob
  /** Modification time written into the DOS date fields. Defaults to `opts.date`. */
  date?: Date
}

export interface ZipOptions {
  /** Timestamp for members that carry no `date` of their own. */
  date?: Date
  /** Archive comment (EOCD). Kept short — many tools truncate it. */
  comment?: string
}

// --- CRC-32 ---------------------------------------------------------------

/** Standard IEEE 802.3 polynomial, reflected (0xEDB88320), built once. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32Update(crc: number, bytes: Uint8Array): number {
  let c = crc
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return c >>> 0
}

/** Chunk size for the no-`Blob.stream()` fallback path. */
const FALLBACK_CHUNK = 8 << 20

/**
 * CRC-32 of a blob's bytes, read incrementally so a multi-hundred-megabyte
 * PNG never sits in memory as one ArrayBuffer.
 */
async function crc32OfBlob(blob: Blob): Promise<number> {
  let crc = 0xffffffff
  if (typeof blob.stream === 'function') {
    const reader = blob.stream().getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) crc = crc32Update(crc, value)
    }
  } else {
    for (let off = 0; off < blob.size; off += FALLBACK_CHUNK) {
      const part = new Uint8Array(await blob.slice(off, off + FALLBACK_CHUNK).arrayBuffer())
      crc = crc32Update(crc, part)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

// --- little-endian writer -------------------------------------------------

class ByteWriter {
  private bytes: number[] = []

  u16(v: number): void {
    this.bytes.push(v & 0xff, (v >>> 8) & 0xff)
  }

  u32(v: number): void {
    this.bytes.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff)
  }

  /**
   * 64-bit little-endian. Written from a JS number, which is exact to 2^53 —
   * three orders of magnitude past any archive a browser can build, so the
   * BigInt ceremony would buy nothing.
   */
  u64(v: number): void {
    const lo = v >>> 0
    const hi = Math.floor(v / 0x100000000)
    this.u32(lo)
    this.u32(hi >>> 0)
  }

  raw(b: Uint8Array): void {
    for (let i = 0; i < b.length; i++) this.bytes.push(b[i])
  }

  done(): Uint8Array<ArrayBuffer> {
    return new Uint8Array(this.bytes)
  }
}

// --- DOS date/time --------------------------------------------------------

/** MS-DOS packed time (2-second resolution) and date (epoch 1980). */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear())
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

// --- names ----------------------------------------------------------------

const UTF8 = new TextEncoder()

/**
 * A ZIP member path must be relative and forward-slashed. Anything else is
 * either a portability trap or a zip-slip vector for whoever extracts it.
 */
export function sanitizeZipName(name: string): string {
  const parts = name
    .replace(/\\/g, '/')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '.' && s !== '..')
  return parts.join('/') || 'file'
}

/**
 * Filesystem-safe file/folder name for the archive itself and for members
 * built from user input (order names). Keeps accents — every OS this ships to
 * handles UTF-8 filenames — and drops only what is genuinely illegal.
 */
export function safeFileName(s: string, fallback = 'export'): string {
  const cleaned = s
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .slice(0, 80)
  return cleaned || fallback
}

/** `YYYY-MM-DD` in LOCAL time — the operator's date, not UTC's. */
export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** `YYYY-MM-DD_HHhMM` in LOCAL time, for archive names that must not collide. */
export function isoStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${isoDate(d)}_${p(d.getHours())}h${p(d.getMinutes())}`
}

// --- archive --------------------------------------------------------------

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
const SIG_ZIP64_EOCD = 0x06064b50
const SIG_ZIP64_LOC = 0x07064b50
const U32_MAX = 0xffffffff
const U16_MAX = 0xffff
/** 2.0 = store + folders; 4.5 = the minimum that understands ZIP64. */
const VER_STORE = 20
const VER_ZIP64 = 45
/** UTF-8 filename flag (EFS, APPNOTE §4.4.4 bit 11). */
const FLAG_UTF8 = 0x0800

interface Member {
  nameBytes: Uint8Array
  blob: Blob
  crc: number
  size: number
  offset: number
  time: number
  date: number
  /** The member itself needs the 64-bit size fields. */
  zip64: boolean
}

/**
 * Build a ZIP archive from `entries`.
 *
 * Members are streamed twice (once to CRC, once by the browser when the
 * resulting Blob is read), which is the price of a valid archive without a
 * data-descriptor pass. Duplicate paths are de-duplicated with a ` (2)` suffix
 * rather than silently producing an archive with two identical entries.
 */
export async function createZip(entries: ZipEntry[], opts: ZipOptions = {}): Promise<Blob> {
  const fallbackDate = opts.date ?? new Date()
  const parts: BlobPart[] = []
  const members: Member[] = []
  const used = new Set<string>()
  let offset = 0

  for (const entry of entries) {
    let name = sanitizeZipName(entry.name)
    if (used.has(name)) {
      const dot = name.lastIndexOf('.')
      const stem = dot > 0 ? name.slice(0, dot) : name
      const ext = dot > 0 ? name.slice(dot) : ''
      let n = 2
      while (used.has(`${stem} (${n})${ext}`)) n++
      name = `${stem} (${n})${ext}`
    }
    used.add(name)

    const nameBytes = UTF8.encode(name)
    const crc = await crc32OfBlob(entry.blob)
    const size = entry.blob.size
    const { time, date } = dosDateTime(entry.date ?? fallbackDate)
    // ZIP64 in the LOCAL header is decided by the member's SIZE alone — a
    // local header has no offset field, so promoting it because the archive
    // grew past 4 GiB would write 0xFFFFFFFF sizes the central record then
    // contradicts. The 64-bit relative offset is a central-directory concern.
    const zip64 = size > U32_MAX

    const h = new ByteWriter()
    h.u32(SIG_LOCAL)
    h.u16(zip64 ? VER_ZIP64 : VER_STORE)
    h.u16(FLAG_UTF8)
    h.u16(0) // method: store
    h.u16(time)
    h.u16(date)
    h.u32(crc)
    h.u32(zip64 ? U32_MAX : size) // compressed
    h.u32(zip64 ? U32_MAX : size) // uncompressed
    h.u16(nameBytes.length)
    h.u16(zip64 ? 20 : 0) // extra field length
    h.raw(nameBytes)
    if (zip64) {
      h.u16(0x0001) // ZIP64 extended information
      h.u16(16)
      h.u64(size) // uncompressed
      h.u64(size) // compressed
    }
    const header = h.done()

    parts.push(header, entry.blob)
    members.push({ nameBytes, blob: entry.blob, crc, size, offset, time, date, zip64 })
    offset += header.length + size
  }

  // --- central directory ---------------------------------------------------
  const cdStart = offset
  const cd = new ByteWriter()
  for (const m of members) {
    const bigSize = m.size > U32_MAX
    const bigOffset = m.offset > U32_MAX
    const extraLen = (bigSize ? 16 : 0) + (bigOffset ? 8 : 0)
    cd.u32(SIG_CENTRAL)
    // version made by: 0x031E = UNIX (3) + spec 3.0. The high byte tells the
    // extractor the external attributes below are UNIX permission bits.
    cd.u16(0x031e)
    cd.u16(extraLen > 0 ? VER_ZIP64 : VER_STORE)
    cd.u16(FLAG_UTF8)
    cd.u16(0) // method: store
    cd.u16(m.time)
    cd.u16(m.date)
    cd.u32(m.crc)
    cd.u32(bigSize ? U32_MAX : m.size)
    cd.u32(bigSize ? U32_MAX : m.size)
    cd.u16(m.nameBytes.length)
    cd.u16(extraLen > 0 ? extraLen + 4 : 0)
    cd.u16(0) // file comment length
    cd.u16(0) // disk number start
    cd.u16(0) // internal attributes
    cd.u32(0o644 << 16) // external attributes: regular file, rw-r--r--
    cd.u32(bigOffset ? U32_MAX : m.offset)
    cd.raw(m.nameBytes)
    if (extraLen > 0) {
      cd.u16(0x0001)
      cd.u16(extraLen)
      if (bigSize) {
        cd.u64(m.size) // uncompressed
        cd.u64(m.size) // compressed
      }
      if (bigOffset) cd.u64(m.offset)
    }
  }
  const cdBytes = cd.done()
  parts.push(cdBytes)

  // --- end of central directory -------------------------------------------
  const commentBytes = opts.comment ? UTF8.encode(opts.comment.slice(0, 1000)) : new Uint8Array(0)
  const needZip64Eocd =
    members.length > U16_MAX || cdStart > U32_MAX || cdBytes.length > U32_MAX

  const tail = new ByteWriter()
  if (needZip64Eocd) {
    const eocd64Offset = cdStart + cdBytes.length
    tail.u32(SIG_ZIP64_EOCD)
    tail.u64(44) // size of this record minus its 12-byte prologue
    tail.u16(0x031e) // version made by
    tail.u16(VER_ZIP64) // version needed
    tail.u32(0) // this disk
    tail.u32(0) // disk with the central directory
    tail.u64(members.length)
    tail.u64(members.length)
    tail.u64(cdBytes.length)
    tail.u64(cdStart)
    tail.u32(SIG_ZIP64_LOC)
    tail.u32(0) // disk with the ZIP64 EOCD
    tail.u64(eocd64Offset)
    tail.u32(1) // total disks
  }
  tail.u32(SIG_EOCD)
  tail.u16(0) // this disk
  tail.u16(0) // disk with the central directory
  tail.u16(needZip64Eocd ? U16_MAX : members.length)
  tail.u16(needZip64Eocd ? U16_MAX : members.length)
  tail.u32(needZip64Eocd ? U32_MAX : cdBytes.length)
  tail.u32(needZip64Eocd ? U32_MAX : cdStart)
  tail.u16(commentBytes.length)
  tail.raw(commentBytes)
  parts.push(tail.done())

  return new Blob(parts, { type: 'application/zip' })
}

/** Convenience: a UTF-8 text member (README, CSV, JSON). */
export function textEntry(name: string, text: string, date?: Date): ZipEntry {
  return { name, blob: new Blob([text], { type: 'text/plain;charset=utf-8' }), date }
}
