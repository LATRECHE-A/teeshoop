/**
 * FALK&ROSS — the supplier webservice, server-side.
 *
 * ============================================================================
 * WHY THIS LIVES IN THE WORKER AND NOT IN THE BROWSER
 * ----------------------------------------------------------------------------
 * Three independent reasons, any one of which would be enough:
 *  1. CREDENTIALS. Prices, stock and order placement are HTTP Basic. A secret
 *     shipped to a browser is a published secret, so the client never sees it —
 *     it reaches these routes, and only these routes reach Falk&Ross.
 *  2. CORS. Not one falk-ross.eu endpoint sends an allow-origin header, so a
 *     browser cannot read any of them, authenticated or not.
 *  3. CANVAS TAINTING. The ingest pipeline (src/lib/ingest/pipeline.ts) draws
 *     the supplier photo into a canvas and reads the pixels back for the
 *     cutout, print-area and back-reconstruction passes. A cross-origin image
 *     without CORS headers taints the canvas and `getImageData` throws, which
 *     would break ingest entirely — so photos are proxied too, same-origin,
 *     via `/api/fr/img/*`.
 * ============================================================================
 *
 * WHAT THE CLIENT GETS: compact JSON, never raw XML. The style list alone is
 * 770 KB of XML for 2348 styles and a single style detail runs to 300 KB;
 * shipping that to a phone to render a 24-card grid would be absurd. Each
 * route parses upstream once and answers with the few fields the studio uses.
 *
 * CACHING: everything upstream changes at most daily, so every derived payload
 * goes through `caches.default` (see `cachedJson`). The catalogue scan is
 * budgeted — see `browseStyles` — because "search 2348 styles" cannot mean
 * "make 2348 subrequests".
 *
 * VERIFIED LIVE on 2026-07-31 against the real account; where the supplier PDF
 * and reality disagree, the code follows reality and says so at the site of the
 * difference.
 */
import { allElements, decodeXml, elementInner, elementText, langText } from './xml'

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export interface FalkRossEnv {
  /** Webservice account (NOT the webshop login). `wrangler secret put FR_WS_USER`. */
  FR_WS_USER?: string
  /** Webservice password. `wrangler secret put FR_WS_PASS`. */
  FR_WS_PASS?: string
  /**
   * Falk&Ross customer number, needed only to PLACE an order. Absent, the
   * order route falls back to the leading account-number segment of
   * FR_WS_USER, which is shaped `{customer}-{n}-{token}`, and REPORTS that it
   * did (`customerNumberSource`) — guessing a customer number silently is how
   * an order lands on the wrong account.
   */
  FR_CUSTOMER_NR?: string
}

const DOWNLOAD = 'https://download.falk-ross.eu'
const WS = 'https://ws.falk-ross.eu'

/**
 * The style list publishes per-style URLs as `http://` and the host 301s to
 * `https://`; following that redirect on every one of thousands of style
 * fetches is a pointless round trip, so URLs are upgraded on the way in.
 */
const httpsify = (url: string) => url.replace(/^http:\/\//i, 'https://')

// TTLs, in seconds. The upstream files are rebuilt once a day (the style list
// carries an `export_data_date` that moves each morning), so these are chosen
// to be "fresh enough to trust, long enough to be free".
const TTL = {
  styleList: 6 * 3600,
  style: 24 * 3600,
  /** Prices are contractual and stable; an hour bounds a re-negotiation. */
  price: 3600,
  /** Stock genuinely moves — this is the one number a stale cache misleads on. */
  stock: 300,
  deliveries: 1800,
  /** Test-vs-live mode: short, because it gates whether an order is real. */
  state: 120,
  /** Photos are content-addressed by filename and never change in place. */
  image: 30 * 24 * 3600,
} as const

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type FrErrorCode =
  | 'config'
  | 'auth'
  | 'upstream'
  | 'not_found'
  | 'parse'
  | 'bad_request'

/** Typed failure, so each route maps cleanly onto an HTTP status + JSON body. */
export class FrError extends Error {
  readonly code: FrErrorCode
  readonly status: number
  constructor(code: FrErrorCode, status: number, message: string) {
    super(message)
    this.name = 'FrError'
    this.code = code
    this.status = status
  }
}

// ---------------------------------------------------------------------------
// Upstream fetch + cache
// ---------------------------------------------------------------------------

function authHeader(env: FalkRossEnv): string {
  const user = env.FR_WS_USER
  const pass = env.FR_WS_PASS
  if (!user || !pass) {
    throw new FrError(
      'config',
      503,
      'Falk&Ross credentials are not configured (FR_WS_USER / FR_WS_PASS).',
    )
  }
  return `Basic ${btoa(`${user}:${pass}`)}`
}

interface FetchOpts {
  /** Send HTTP Basic credentials (required by ws.falk-ross.eu, not download.*). */
  auth?: boolean
  env?: FalkRossEnv
  method?: string
  body?: string
  contentType?: string
  /** Edge cache lifetime for the RAW upstream response. */
  cacheTtl?: number
}

/**
 * Per-upstream-request deadline. The supplier's CGI endpoints occasionally
 * hang instead of failing; without a deadline that hang propagates through the
 * Worker to the modal as an infinite spinner.
 *
 * THIS MUST STAY COMFORTABLY BELOW THE CLIENT'S OWN BUDGET
 * (src/lib/ingest/falkross.ts GET_TIMEOUT_MS / BROWSE_TIMEOUT_MS). Whoever
 * times out first decides what the user is told: the client can only say
 * "too long", while we know *what* broke and answer a typed JSON error. When
 * both sides used 20 s the client always aborted first — it starts its clock
 * earlier — so this module's truthful 502 was unreachable from the browser and
 * a single hung style was reported to the developer as "your backend is not
 * running". Measured healthy cold cost is ~1.2 s per 12-style batch, so 10 s
 * is ~8x headroom on a real document.
 *
 * NOTE this bounds the wait for RESPONSE HEADERS; the timer is cleared once
 * they arrive so a large image body can stream to a slow client without being
 * cut off. A body that hangs after headers is bounded by the client deadline.
 */
const UPSTREAM_TIMEOUT_MS = 10_000

async function fetchUpstream(url: string, opts: FetchOpts = {}): Promise<Response> {
  const headers: Record<string, string> = {}
  if (opts.auth) headers.authorization = authHeader(opts.env ?? {})
  if (opts.contentType) headers['content-type'] = opts.contentType
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), UPSTREAM_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body,
      signal: deadline.signal,
      // Never let Cloudflare's edge cache an AUTHENTICATED response under a
      // URL another tenant could also request; derived payloads are cached by
      // `cachedJson` under our own zone instead.
      cf: opts.cacheTtl && !opts.auth ? { cacheTtl: opts.cacheTtl, cacheEverything: true } : undefined,
    })
  } catch {
    throw new FrError('upstream', 502, `Falk&Ross unreachable (or timed out): ${url}`)
  } finally {
    clearTimeout(timer)
  }
  if (res.status === 401 || res.status === 403) {
    throw new FrError('auth', 502, 'Falk&Ross rejected the webservice credentials.')
  }
  if (res.status === 404) throw new FrError('not_found', 404, `Not published upstream: ${url}`)
  if (!res.ok) {
    throw new FrError('upstream', 502, `Falk&Ross returned ${res.status} for ${url}`)
  }
  return res
}

const fetchText = async (url: string, opts?: FetchOpts): Promise<string> =>
  (await fetchUpstream(url, opts)).text()

/**
 * Memoise a DERIVED payload (compact JSON, not upstream XML) in the edge cache.
 *
 * The key is minted on OUR origin so it can never collide with, or be served
 * from, another site in the zone. `ctx.waitUntil` keeps the write off the
 * response's critical path.
 */
async function cachedJson<T>(
  origin: string,
  key: string,
  ttl: number,
  ctx: ExecutionContext,
  produce: () => Promise<T>,
): Promise<T> {
  const req = new Request(new URL(`/__fr-cache/${encodeURIComponent(key)}`, origin).toString())
  const cache = caches.default
  const hit = await cache.match(req)
  if (hit) {
    try {
      return (await hit.json()) as T
    } catch {
      // Corrupt entry — fall through and rebuild rather than fail the request.
    }
  }
  const value = await produce()
  const res = new Response(JSON.stringify(value), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${ttl}`,
    },
  })
  ctx.waitUntil(cache.put(req, res.clone()))
  return value
}

// ---------------------------------------------------------------------------
// Style list
// ---------------------------------------------------------------------------

interface StyleListIndex {
  /** Feed version, e.g. "R000-011" — style XML URLs are versioned by it. */
  version: string
  exportedAt: string
  /** Five-digit style numbers, ASCENDING — see `styleIndex`. */
  nrs: string[]
}

/**
 * The complete style list. VERIFIED: 2348 styles, and the per-style link is
 * `…/ws/{version}/xml/{nr}.xml` — NOT the `…/ws/xml/{nr}.xml` the PDF shows.
 * Both paths serve byte-identical documents today, so only the version is
 * stored (20 KB instead of a 250 KB URL table) and the unversioned path is the
 * fallback if a versioned fetch ever 404s.
 */
async function styleIndex(origin: string, ctx: ExecutionContext): Promise<StyleListIndex> {
  return cachedJson(origin, 'stylelist', TTL.styleList, ctx, async () => {
    const xml = await fetchText(`${DOWNLOAD}/ws/falkross-stylelist.xml`, {
      cacheTtl: TTL.styleList,
    })
    const nrs = allElements(xml, 'style')
      .map((s) => elementText(s, 'style_nr'))
      .filter((nr) => /^\d{4,6}$/.test(nr))
      // ASCENDING, deliberately. The feed is ordered by style number
      // DESCENDING, and that end of the catalogue is bags, beanies, towels and
      // workwear — VERIFIED: the first 200 styles in feed order contain zero
      // t-shirts and zero polos, so a browser opening the catalogue would wait
      // through several scan rounds to see its first printable blank. Low style
      // numbers are where the apparel brands live (B&C 00142, Gildan 10209,
      // Fruit of the Loom 18001).
      .sort((a, b) => Number(a) - Number(b))
    if (nrs.length === 0) throw new FrError('parse', 502, 'Empty Falk&Ross style list.')
    return {
      version: elementText(xml, 'file_version') || 'R000-011',
      exportedAt: elementText(xml, 'export_data_date'),
      nrs,
    }
  })
}

// ---------------------------------------------------------------------------
// Style detail
// ---------------------------------------------------------------------------

export interface FrPhoto {
  /** Proxy URL (`/api/fr/img/picture/…`), never the supplier host. */
  url: string
  /** Raw supplier shot type. VERIFIED values: m, f, b, mb, '-'. */
  shot: string
  pos: number
  /** Colour code parsed out of the filename (`180_01_123_f-2019_01.jpg`). */
  colourCode: string | null
}

export interface FrColourway {
  code: string
  name: string
  /** Colour chip (a JPG, not a hex — see the note on `swatch`). */
  swatch: string
  /** Per-colour laid-flat FRONT photo. VERIFIED to exist for every colourway. */
  photo: string
  /** SKU per size name, for price/stock/order lookups. */
  skus: Record<string, string>
}

export interface FrSku {
  sku: string
  colourCode: string
  sizeName: string
  sizeOrder: number
  ean: string
  weightKg: number | null
  coo: string
  closeout: boolean
  isNew: boolean
}

export type FrKind = 'tee' | 'polo' | 'sweat' | 'shirt' | 'other'
export type FrSleeve = 'short' | 'long' | 'sleeveless' | 'unknown'

export interface FrStyle {
  styleNr: string
  brand: string
  supplierRef: string
  name: string
  nameEn: string
  description: string
  /** Supplier sub-categories, FR then EN fallback. */
  categories: string[]
  kind: FrKind
  sleeve: FrSleeve
  gender: string
  neckline: string
  fabric: string[]
  certificates: string[]
  /**
   * The one place Falk&Ross gets near a size table: a PDF of the maker's own
   * size spec. It is a PDF, so nothing here can read it — but a human can, and
   * that is exactly who needs it when checking an estimated table.
   */
  sizespecPdf: string
  /** Laid-flat front, preferred over a model shot. '' when neither exists. */
  front: string
  /** Laid-flat back, else a model back shot. '' when the supplier has none. */
  back: string
  /** True when `back` is a real supplier photograph of the back. */
  hasBack: boolean
  /** Colour code the style-level FRONT photo was shot in. */
  frontColour: string | null
  /**
   * Colour code the back photo was shot in.
   *
   * This is load-bearing, not trivia. Falk&Ross photographs ONE colourway from
   * behind — VERIFIED: substituting another colour code into a back filename
   * 404s — while every colourway has its own flat FRONT via
   * `sku_color_picture_url`. So for any other colour, the only real back on
   * offer is a photo of a DIFFERENT-COLOURED garment, and the client compares
   * these codes to decide between it and an honest reconstruction.
   */
  backColour: string | null
  colourways: FrColourway[]
  /** Size names in supplier order, e.g. ["XS","S","M","L","XL","2XL","3XL"]. */
  sizes: string[]
  skus: FrSku[]
  exportedAt: string
}

/** Grid row — a projection of FrStyle small enough to scan thousands of. */
export interface FrCard {
  styleNr: string
  brand: string
  supplierRef: string
  name: string
  kind: FrKind
  sleeve: FrSleeve
  thumb: string
  hasBack: boolean
  colourCount: number
  sizes: string[]
}

const LANGS = ['fr', 'en', 'de'] as const
const LANGS_EN = ['en', 'de', 'fr'] as const

/** Proxy a supplier asset URL through this Worker (see the header note). */
function proxyImage(url: string): string {
  const m = /\/ws\/(picture|picto)\/([^/?#]+)$/.exec(url)
  return m ? `/api/fr/img/${m[1]}/${m[2]}` : ''
}

/** `180_01_123_f-2019_01.jpg` → "123". Null when the name does not follow it. */
function colourFromFilename(file: string): string | null {
  const m = /^\d{3}_\d{2}_(\d{3})_/.exec(file)
  return m ? m[1] : null
}

/** Every `<style_x_group_list>` entry, translated. */
function groupList(xml: string, list: string, item: string, prefer = LANGS): string[] {
  const inner = elementInner(xml, list)
  if (!inner) return []
  return allElements(inner, item)
    .map((g) => langText(g, prefer))
    .filter(Boolean)
}

function classifySleeve(groups: string[]): FrSleeve {
  const s = groups.join(' ').toLowerCase()
  if (/sleeveless|ärmellos|sans manche/.test(s)) return 'sleeveless'
  if (/long|lang|longue/.test(s)) return 'long'
  if (/short|kurz|courte/.test(s)) return 'short'
  return 'unknown'
}

/**
 * Product categories that are never a printable upper-body blank. Checked only
 * AFTER the positive patterns below, because the sub-category list mixes
 * product types with cross-cutting tags — a style is routinely both "T-Shirts"
 * and "Workwear", and vetoing on the latter would hide half the tees.
 */
const CATEGORY_VETO =
  /bag|cap\b|hat|beanie|scarf|glove|sock|underwear|shoe|footwear|trouser|pant|jogging|skirt|dress|apron|towel|home|horeca|care|jacket|coat|parka|softshell|bodywarmer|umbrella|blanket|accessor/i

/**
 * The same veto applied to a style NAME, for the styles whose only categories
 * are marketing tags ("NEW 2026", "TOP SELLERS") and so say nothing. Without
 * it, "UNLABELED Sweatpants" and "Hooded Softshell Jacket" both classify as
 * sweatshirts on the strength of one word — VERIFIED, both did.
 */
const NAME_VETO =
  // Two deliberate details:
  //  - the `(sweat|jog|track)?` prefix, because `\bpants\b` does NOT match
  //    inside "Sweatpants", and that one word is the whole difference between
  //    a hoodie and a pair of trousers;
  //  - `pants`/`shorts` are matched PLURAL ONLY. Singular "short" would veto
  //    every "Short Sleeve T-Shirt" whose categories happen to be marketing
  //    tags, turning the commonest garment in the catalogue into 'other'.
  /\b(sweat|jog|track)?(pants|shorts)\b|\b(trousers?|leggings?|skirt|dress|apron|beanie|caps?|hats?|bags?|backpack|socks?|gloves?|scarf|shoes?|boots?|towels?|blanket|jackets?|coat|parka|softshell|bodywarmer)\b/i

/**
 * Positive product-type patterns, in precedence order.
 *
 * The leading `\b` on the tee pattern is not decoration: without it,
 * "Swea|tshirts|" matches `t-?shirts?` and the supplier's own
 * "Sweatshirts & Hoodies" category classifies as a T-SHIRT — which would then
 * pick the tee size block for every hoodie in the catalogue.
 */
const KIND_PATTERNS: readonly (readonly [RegExp, FrKind])[] = [
  [/\bpolos?\b/i, 'polo'],
  [/\bt-?shirts?\b|\btee-?shirts?\b|\bcamisetas?\b/i, 'tee'],
  [/\bsweat|\bhoodie|\bhooded\b|\bkapuzen|\bsudadera/i, 'sweat'],
  [/\bshirts?\b|\bknitwear\b|\bchemises?\b|\bhemd|\bblouse|\bbluse/i, 'shirt'],
]

/**
 * What kind of blank this is — the studio only decorates upper-body garments,
 * and the choice of reference size chart (tee vs hoodie) hangs off it.
 *
 * Driven by the supplier's own SUB-CATEGORIES, which are a controlled
 * vocabulary ("T-Shirts", "Polos", "Bags & Accessories"), with the style name
 * consulted only when they are uninformative. Doing it the other way round —
 * matching the name first — is what turned a fleece beanie called "Recycled
 * Fleece Hood" into a hoodie.
 *
 * NOTE: `style_category_main` is useless here; it is the literal string
 * "Products" on every style sampled.
 */
function classifyKind(categories: string[], name: string): FrKind {
  for (const [re, kind] of KIND_PATTERNS) {
    if (categories.some((c) => re.test(c))) return kind
  }
  if (categories.some((c) => CATEGORY_VETO.test(c))) return 'other'
  if (NAME_VETO.test(name)) return 'other'
  for (const [re, kind] of KIND_PATTERNS) {
    if (re.test(name)) return kind
  }
  return 'other'
}

/** Blanks the studio can actually print on — the catalogue's default filter. */
export const isPrintableKind = (k: FrKind) => k === 'tee' || k === 'polo' || k === 'sweat'

/**
 * Choose the front/back pair to show for a style.
 *
 * VERIFIED shot types: 'f' flat front, 'b' flat back, 'm' model front, 'mb'
 * model BACK (undocumented — the PDF lists only m/f/b), and '-' for the sleeve
 * detail shots (_sl-/_sr-), which are never a garment side.
 *
 * The pair must be COHERENT, which the obvious "first f, first b" rule is not:
 * on style 00142 that yields a model front in colour 123 beside a flat back in
 * colour 507 — two different garments in two different registers. So a pair in
 * one colour and one register wins, and only then do we settle for less.
 */
function pickSides(photos: FrPhoto[]): { front: FrPhoto | null; back: FrPhoto | null } {
  const byPos = (a: FrPhoto, b: FrPhoto) => a.pos - b.pos
  const of = (shot: string) => photos.filter((p) => p.shot === shot).sort(byPos)
  const flatF = of('f')
  const flatB = of('b')
  const modelF = of('m')
  const modelB = of('mb')

  // 1. Same register, same colourway — a real front and back of one garment.
  for (const [fronts, backs] of [
    [flatF, flatB],
    [modelF, modelB],
  ] as const) {
    for (const front of fronts) {
      const back = backs.find((b) => b.colourCode && b.colourCode === front.colourCode)
      if (back) return { front, back }
    }
  }
  // 2. Best available front, then the best back sharing its colour.
  const front = flatF[0] ?? modelF[0] ?? null
  const backs = [...flatB, ...modelB]
  if (!front) return { front: null, back: backs[0] ?? null }
  const sameColour = backs.find((b) => b.colourCode && b.colourCode === front.colourCode)
  return { front, back: sameColour ?? backs[0] ?? null }
}

/**
 * Style XML → FrStyle. Exported so it can be exercised against saved real
 * payloads without a Worker runtime (see scripts/fr-verify.mjs).
 */
export function parseStyle(xml: string, styleNr: string): FrStyle {
  const style = elementInner(xml, 'style')
  if (!style) throw new FrError('not_found', 404, `Style ${styleNr} is not published.`)

  const name = langText(elementInner(style, 'style_name'), LANGS)
  const nameEn = langText(elementInner(style, 'style_name'), LANGS_EN)

  // Categories: <style_category_main> is mixed content ("Products" plus nested
  // <style_category_sub> children), so read the SUBS — they carry the real
  // taxonomy and are translated.
  const catMain = elementInner(style, 'style_category_list') ?? ''
  const catBlocks = allElements(catMain, 'style_category_sub')
  const categories = catBlocks.map((c) => langText(c, LANGS)).filter(Boolean)
  // Classification reads the ENGLISH categories: that vocabulary is the stable
  // one ("T-Shirts", "Bags & Accessories"), whereas the French labels are
  // marketing copy that changes ("MEILLEURES VENTES", "SANS ÉTIQUETTE").
  const categoriesEn = catBlocks.map((c) => langText(c, LANGS_EN)).filter(Boolean)

  const sleeve = classifySleeve(groupList(style, 'style_sleeve_group_list', 'style_sleeve_group'))
  const kind = classifyKind(categoriesEn, nameEn || name)

  // --- photos -------------------------------------------------------------
  const photos: FrPhoto[] = []
  const picList = elementInner(style, 'style_picture_list') ?? ''
  for (const p of allElements(picList, 'style_picture')) {
    const url = proxyImage(elementText(p, 'url'))
    if (!url) continue
    photos.push({
      url,
      shot: elementText(p, 'shottype'),
      pos: parseInt(elementText(p, 'pos'), 10) || 0,
      colourCode: colourFromFilename(elementText(p, 'filename')),
    })
  }
  const { front: frontPhoto, back: backPhoto } = pickSides(photos)

  // --- SKUs → colourways --------------------------------------------------
  const skus: FrSku[] = []
  const colourways = new Map<string, FrColourway>()
  const sizeOrder = new Map<string, number>()
  const skuList = elementInner(style, 'sku_list') ?? ''
  for (const s of allElements(skuList, 'sku')) {
    const sku = elementText(s, 'sku_artnum')
    const colourCode = elementText(s, 'sku_color_code')
    const sizeName = elementText(s, 'sku_size_name')
    if (!sku || !sizeName) continue
    const order = parseInt(elementText(s, 'sku_size_order'), 10) || 0
    skus.push({
      sku,
      colourCode,
      sizeName,
      sizeOrder: order,
      ean: elementText(s, 'sku_ean'),
      weightKg: parseFloat(elementText(s, 'sku_weight')) || null,
      coo: elementText(s, 'sku_coo'),
      closeout: elementText(s, 'sku_closeout') === '1',
      isNew: elementText(s, 'sku_new') === '1',
    })
    if (!sizeOrder.has(sizeName)) sizeOrder.set(sizeName, order)
    let cw = colourways.get(colourCode)
    if (!cw) {
      cw = {
        code: colourCode,
        name: elementText(s, 'sku_color_name'),
        swatch: proxyImage(elementText(s, 'sku_color_swatch_url')),
        photo: proxyImage(elementText(s, 'sku_color_picture_url')),
        skus: {},
      }
      colourways.set(colourCode, cw)
    }
    cw.skus[sizeName] = sku
  }

  return {
    styleNr,
    brand: elementText(style, 'brand_name'),
    supplierRef: elementText(style, 'supplier_article_code'),
    name: name || nameEn || `Style ${styleNr}`,
    nameEn,
    description: langText(elementInner(style, 'style_description'), LANGS),
    categories,
    kind,
    sleeve,
    gender: groupList(style, 'style_gender_group_list', 'style_gender_group').join(', '),
    neckline: groupList(style, 'style_neckline_group_list', 'style_neckline_group').join(', '),
    fabric: groupList(style, 'style_fabric_group_list', 'style_fabric_group'),
    certificates: groupList(style, 'style_certificate_group_list', 'style_certificate_group'),
    sizespecPdf: elementText(style, 'sizespec_download_link'),
    front: frontPhoto?.url ?? '',
    back: backPhoto?.url ?? '',
    hasBack: !!backPhoto,
    frontColour: frontPhoto?.colourCode ?? null,
    backColour: backPhoto?.colourCode ?? null,
    colourways: [...colourways.values()],
    sizes: [...sizeOrder.entries()].sort((a, b) => a[1] - b[1]).map(([n]) => n),
    skus,
    exportedAt: elementText(xml, 'export_data_date'),
  }
}

const toCard = (s: FrStyle): FrCard => ({
  styleNr: s.styleNr,
  brand: s.brand,
  supplierRef: s.supplierRef,
  name: s.name,
  kind: s.kind,
  sleeve: s.sleeve,
  thumb: s.front || s.colourways[0]?.photo || '',
  hasBack: s.hasBack,
  colourCount: s.colourways.length,
  sizes: s.sizes,
})

/**
 * One style, parsed and cached. Writes BOTH the full detail and the grid card
 * from a single upstream fetch, so a later catalogue scan reads a ~400-byte
 * card instead of re-parsing 300 KB of XML.
 */
async function loadStyle(
  origin: string,
  ctx: ExecutionContext,
  version: string,
  nr: string,
): Promise<FrStyle> {
  return cachedJson(origin, `style:${nr}`, TTL.style, ctx, async () => {
    let xml: string
    try {
      xml = await fetchText(`${DOWNLOAD}/ws/${version}/xml/${nr}.xml`, { cacheTtl: TTL.style })
    } catch (err) {
      if (!(err instanceof FrError) || err.code !== 'not_found') throw err
      // Version-less path as a fallback (serves an identical document today).
      xml = await fetchText(`${DOWNLOAD}/ws/xml/${nr}.xml`, { cacheTtl: TTL.style })
    }
    const style = parseStyle(xml, nr)
    ctx.waitUntil(
      caches.default.put(
        new Request(new URL(`/__fr-cache/${encodeURIComponent(`card:${nr}`)}`, origin).toString()),
        new Response(JSON.stringify(toCard(style)), {
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': `public, max-age=${TTL.style}`,
          },
        }),
      ),
    )
    return style
  })
}

/** The grid card, preferring the small cache entry written by `loadStyle`. */
async function loadCard(
  origin: string,
  ctx: ExecutionContext,
  version: string,
  nr: string,
): Promise<FrCard | null> {
  const key = new Request(
    new URL(`/__fr-cache/${encodeURIComponent(`card:${nr}`)}`, origin).toString(),
  )
  const hit = await caches.default.match(key)
  if (hit) {
    try {
      return (await hit.json()) as FrCard
    } catch {
      /* rebuild below */
    }
  }
  try {
    return toCard(await loadStyle(origin, ctx, version, nr))
  } catch {
    // A single unpublished / malformed style must not sink the whole page.
    return null
  }
}

// ---------------------------------------------------------------------------
// Catalogue browse (server-side search + pagination)
// ---------------------------------------------------------------------------

/**
 * Scan budgets. Searching 2348 styles cannot mean 2348 subrequests, so a
 * request walks the list until it has filled the page OR spent its budget,
 * then hands back `nextOffset` for the client to continue from.
 *
 * The two limits do different jobs. `MAX_FETCHES` bounds COLD styles — real
 * upstream requests, the expensive thing — while `MAX_SCAN` bounds the walk
 * itself. Cache API reads are not subrequests, so once the catalogue is warm a
 * single request scans hundreds of styles in milliseconds (measured: 24 warm
 * styles in 30 ms against 2.4 s cold) and `MAX_SCAN` is what stops it.
 */
const MAX_SCAN = 600
const MAX_FETCHES = 48
const CHUNK = 12
/**
 * Wall-clock ceiling for one browse request, checked between batches. Worst
 * case a batch starts just under it and over-runs by UPSTREAM_TIMEOUT_MS, so
 * the endpoint answers by ~28 s — inside the client's 35 s browse budget.
 */
const BROWSE_BUDGET_MS = 18_000

export interface BrowseResult {
  total: number
  offset: number
  /** Where to resume; null when the catalogue is exhausted. */
  nextOffset: number | null
  scanned: number
  items: FrCard[]
  exportedAt: string
}

async function browseStyles(
  origin: string,
  ctx: ExecutionContext,
  opts: { q: string; kind: string; offset: number; limit: number },
): Promise<BrowseResult> {
  const index = await styleIndex(origin, ctx)
  const needle = opts.q.trim().toLowerCase()
  const items: FrCard[] = []
  let i = Math.max(0, Math.min(opts.offset, index.nrs.length))
  let scanned = 0
  let fetches = 0
  const start = i
  const deadline = Date.now() + BROWSE_BUDGET_MS

  const matches = (c: FrCard) => {
    if (opts.kind === 'printable' && !isPrintableKind(c.kind)) return false
    if (opts.kind && opts.kind !== 'printable' && opts.kind !== 'all' && c.kind !== opts.kind) {
      return false
    }
    if (!needle) return true
    return `${c.name} ${c.brand} ${c.supplierRef} ${c.styleNr}`.toLowerCase().includes(needle)
  }

  while (
    i < index.nrs.length &&
    items.length < opts.limit &&
    scanned < MAX_SCAN &&
    fetches < MAX_FETCHES &&
    // A WALL-CLOCK budget beside the fetch-count one. `MAX_FETCHES` bounds how
    // much work we ask for, but not how long the supplier takes to do it: one
    // hung document stalls its whole `Promise.all` batch for UPSTREAM_TIMEOUT_MS,
    // and four such batches used to outlast the browser's own deadline — so the
    // client aborted and blamed the backend. Stopping early costs nothing,
    // because a short page with a non-null `nextOffset` is already this
    // endpoint's contract for "more to scan" and the UI resumes from there.
    Date.now() < deadline
  ) {
    const slice = index.nrs.slice(i, i + CHUNK)
    // Count cold styles BEFORE the batch: `loadCard` swallows its own errors,
    // so the budget has to be charged on intent, not on outcome.
    const cards = await Promise.all(slice.map((nr) => loadCard(origin, ctx, index.version, nr)))
    for (const c of cards) {
      if (c && matches(c) && items.length < opts.limit) items.push(c)
    }
    i += slice.length
    scanned += slice.length
    fetches += CHUNK
  }

  return {
    total: index.nrs.length,
    offset: start,
    nextOffset: i < index.nrs.length ? i : null,
    scanned,
    items,
    exportedAt: index.exportedAt,
  }
}

// ---------------------------------------------------------------------------
// Prices, stock, deliveries, webservice mode
// ---------------------------------------------------------------------------

/**
 * `<error><error_code>…` is how the price/stock CGIs report a bad or empty
 * query (VERIFIED: code 10 = bad `style` parameter, 100 = "no data"), and they
 * do it with HTTP 200 — so the body has to be inspected, not the status.
 */
function throwIfErrorDoc(body: string): void {
  if (!body.startsWith('<error') && !body.includes('<error>')) return
  const code = elementText(body, 'error_code')
  const msg = elementText(body, 'error_msg')
  if (code === '100') throw new FrError('not_found', 404, msg || 'No data for this style.')
  throw new FrError('upstream', 502, `Falk&Ross error ${code}: ${msg}`)
}

export interface FrPrices {
  currency: string
  /** SKU → { cost, list }. `cost` is OUR PURCHASE PRICE (`your_price`). */
  prices: Record<string, { cost: number; list: number }>
}

/**
 * Purchase prices for one style.
 *
 * `your_price` IS OUR COST — unlike the Imbretex snapshot's `rrpEur`, which is
 * a recommended RETAIL price. The two must never be conflated: one is what we
 * pay, the other is what the supplier suggests charging. Nothing in this file
 * exposes a retail price, because Falk&Ross does not publish one.
 */
async function loadPrices(
  origin: string,
  env: FalkRossEnv,
  ctx: ExecutionContext,
  styleNr: string,
): Promise<FrPrices> {
  return cachedJson(origin, `price:${styleNr}`, TTL.price, ctx, async () => {
    const csv = await fetchText(
      `${WS}/ws/run/price.pl?format=csv&style=${encodeURIComponent(styleNr)}&action=get_price`,
      { auth: true, env },
    )
    throwIfErrorDoc(csv)
    const out: FrPrices = { currency: 'EUR', prices: {} }
    for (const line of csv.split(/\r?\n/).slice(1)) {
      const [sku, list, cost, currency] = line.split(';')
      if (!sku || !/^\d{6,}$/.test(sku)) continue
      out.prices[sku] = { cost: parseFloat(cost) || 0, list: parseFloat(list) || 0 }
      if (currency) out.currency = currency.trim()
    }
    return out
  })
}

export interface FrStock {
  /** Upstream timestamp — the first line of the CSV, before any SKU row. */
  at: string
  /** SKU → [green, yellow, blue] quantities. */
  stock: Record<string, [number, number, number]>
}

/**
 * Stock for one style, via the truncation wildcard: `_` stands in for one digit
 * from the 6th onward, so `18001____` is "every SKU of style 18001".
 */
async function loadStock(
  origin: string,
  env: FalkRossEnv,
  ctx: ExecutionContext,
  styleNr: string,
): Promise<FrStock> {
  return cachedJson(origin, `stock:${styleNr}`, TTL.stock, ctx, async () => {
    const csv = await fetchText(
      `${WS}/webservice/R03_000/stockinfo/product/${encodeURIComponent(styleNr)}____?format=csv`,
      { auth: true, env },
    )
    throwIfErrorDoc(csv)
    const lines = csv.split(/\r?\n/)
    const out: FrStock = { at: (lines[0] ?? '').trim(), stock: {} }
    for (const line of lines.slice(1)) {
      const [sku, g, y, b] = line.split(';')
      if (!sku || !/^\d{6,}$/.test(sku)) continue
      out.stock[sku] = [parseInt(g, 10) || 0, parseInt(y, 10) || 0, parseInt(b, 10) || 0]
    }
    return out
  })
}

export interface FrWsState {
  /** 'test' — orders are simulated. 'live' — orders are REAL. */
  mode: 'test' | 'live' | 'unknown'
  modeCode: string
  modeName: string
  at: string
}

/**
 * Which mode the webservice account is in. This is not decoration: it is the
 * difference between a rehearsal and a purchase order, so it is reported
 * alongside every order attempt (see `placeOrder`).
 */
async function loadState(
  origin: string,
  env: FalkRossEnv,
  ctx: ExecutionContext,
): Promise<FrWsState> {
  return cachedJson(origin, 'state', TTL.state, ctx, async () => {
    const xml = await fetchText(`${WS}/ws/run/state.pl?action=getstate`, { auth: true, env })
    const code = elementText(xml, 'webservice_mode_code')
    return {
      mode: code === '1' ? 'test' : code === '0' ? 'live' : 'unknown',
      modeCode: code,
      modeName: elementText(xml, 'webservice_mode_name'),
      at: elementText(xml, 'export_data_date'),
    }
  })
}

export interface FrDelivery {
  sku: string
  date: string
  qty: number
  freeToSell: number
}

/** Announced restock dates, optionally narrowed to one style's SKUs. */
async function loadDeliveries(
  origin: string,
  env: FalkRossEnv,
  ctx: ExecutionContext,
  styleNr: string,
): Promise<{ at: string; items: FrDelivery[] }> {
  const all = await cachedJson(origin, 'deliveries', TTL.deliveries, ctx, async () => {
    const xml = await fetchText(`${WS}/ws/run/stock.pl?format=xml&action=get_deliveries`, {
      auth: true,
      env,
    })
    throwIfErrorDoc(xml)
    const list = elementInner(xml, 'deliveries') ?? ''
    const items: FrDelivery[] = []
    for (const it of allElements(list, 'item')) {
      const sku = elementText(it, 'sku')
      if (!sku) continue
      items.push({
        sku,
        date: elementText(it, 'date'),
        qty: parseInt(elementText(it, 'qty'), 10) || 0,
        freeToSell: parseInt(elementText(it, 'free_to_sell_qty'), 10) || 0,
      })
    }
    return { at: elementText(xml, 'export_data_date'), items }
  })
  if (!styleNr) return all
  return { at: all.at, items: all.items.filter((d) => d.sku.startsWith(styleNr)) }
}

// ---------------------------------------------------------------------------
// Order placement
// ---------------------------------------------------------------------------

export interface FrOrderLine {
  sku: string
  qty: number
  lineRef?: string
}

export interface FrOrderAddress {
  lastname?: string
  firstname?: string
  company?: string
  street?: string
  city?: string
  postcode?: string
  countryCode?: string
}

export interface FrOrderInput {
  reference: string
  note?: string
  partialShipment?: boolean
  lines: FrOrderLine[]
  /** Omit to ship to the account's registered address. */
  deliveryAddress?: FrOrderAddress
  customerNumber?: string
}

export interface FrOrderResult {
  ok: boolean
  /** Supplier order id. "0" means the order was REJECTED. */
  orderId: string
  errorCode: string
  message: string
  lines: { sku: string; errorCode: string; message: string }[]
  /** The webservice mode this order was placed in — see `loadState`. */
  mode: FrWsState
  /** Customer number actually sent, and where it came from. */
  customerNumber: string
  customerNumberSource: 'env' | 'request' | 'derived-from-user'
}

/**
 * CDATA cannot nest or contain its own terminator, so a payload containing
 * `]]>` is split across two sections — the standard, and only, escape.
 */
const cdata = (v: string) => `<![CDATA[${String(v).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`

/** `2026-07-31 12:00:00` in the supplier's expected shape (UTC). */
function stamp(now: Date): string {
  return now.toISOString().slice(0, 19).replace('T', ' ')
}

export function buildOrderXml(input: FrOrderInput, customerNumber: string, now: Date): string {
  const addr = input.deliveryAddress
  const field = (tag: string, value: string) =>
    `<${tag}><da_value>${cdata(value)}</da_value></${tag}>`
  const address = addr
    ? [
        '<da_is_different><da_value>true</da_value></da_is_different>',
        field('da_lastname', addr.lastname ?? ''),
        field('da_firstname', addr.firstname ?? ''),
        field('da_company', addr.company ?? ''),
        field('da_street_address', addr.street ?? ''),
        field('da_city', addr.city ?? ''),
        field('da_postcode', addr.postcode ?? ''),
        field('da_country_code', addr.countryCode ?? ''),
      ].join('')
    : '<da_is_different><da_value>false</da_value></da_is_different>'

  const products = input.lines
    .map(
      (l) =>
        `<product><p_sku>${l.sku.replace(/\D/g, '')}</p_sku>` +
        `<p_lineref>${cdata(l.lineRef ?? '')}</p_lineref>` +
        `<p_quantity><pq_ordered>${Math.max(1, Math.round(l.qty))}</pq_ordered></p_quantity>` +
        `</product>`,
    )
    .join('')

  return (
    `<?xml version="1.0" encoding="utf-8"?><order>` +
    `<request_date_time>${stamp(now)}</request_date_time>` +
    `<customers_number><cn_value>${cdata(customerNumber)}</cn_value></customers_number>` +
    // Shipping method 0 = "as agreed"; the doc allows no other value.
    `<shipping_method><sm_value>0</sm_value></shipping_method>` +
    `<partial_shipment><ps_value>${input.partialShipment ? 'true' : 'false'}</ps_value></partial_shipment>` +
    // "Your reference" is capped at 32 characters by the supplier.
    `<order_reference><or_value>${cdata(input.reference.slice(0, 32))}</or_value></order_reference>` +
    `<order_note><on_value>${cdata(input.note ?? '')}</on_value></order_note>` +
    `<delivery_address>${address}</delivery_address>` +
    `<product_list>${products}</product_list>` +
    `</order>`
  )
}

/**
 * Place an order.
 *
 * TWO response envelopes exist, and only one is documented:
 *  - a malformed request is refused at the gateway with HTTP 400 and
 *    `<response><error><code>400</code><message>…</message></error></response>`
 *    (VERIFIED live);
 *  - an accepted-but-rejected order comes back HTTP 200 as the order echo with
 *    `<orders_id>0</orders_id>`, a top-level `<err>` code, and per-line errors
 *    nested in `<item><p_err>30</p_err><msg>Artno not found</msg></item>` —
 *    NOT the `<p_err>/<p_err_msg>` pair the PDF documents (VERIFIED live).
 * Both are parsed, so a caller never has to guess which one it got.
 */
async function placeOrder(
  origin: string,
  env: FalkRossEnv,
  ctx: ExecutionContext,
  input: FrOrderInput,
  now: Date,
): Promise<FrOrderResult> {
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new FrError('bad_request', 400, 'An order needs at least one line.')
  }
  for (const l of input.lines) {
    if (!/^\d{9}$/.test(String(l.sku))) {
      throw new FrError('bad_request', 400, `Not a 9-digit Falk&Ross SKU: ${l.sku}`)
    }
    if (!Number.isFinite(l.qty) || l.qty < 1) {
      throw new FrError('bad_request', 400, `Bad quantity for SKU ${l.sku}.`)
    }
  }

  let customerNumber = input.customerNumber ?? ''
  let source: FrOrderResult['customerNumberSource'] = 'request'
  if (!customerNumber) {
    customerNumber = env.FR_CUSTOMER_NR ?? ''
    source = 'env'
  }
  if (!customerNumber) {
    // Last resort: the webservice login is "{customer}-{n}-{token}".
    customerNumber = /^(\d+)-/.exec(env.FR_WS_USER ?? '')?.[1] ?? ''
    source = 'derived-from-user'
  }
  if (!customerNumber) {
    throw new FrError('config', 503, 'No Falk&Ross customer number (set FR_CUSTOMER_NR).')
  }

  // Read the mode BEFORE ordering: whoever gets this result has to be able to
  // tell a rehearsal from a purchase without a second call.
  const mode = await loadState(origin, env, ctx)

  const body = buildOrderXml(input, customerNumber, now)
  // The supplier's own reference implementation posts the raw XML under a
  // form content-type; their gateway rejects application/xml. Mirrored.
  const res = await fetchUpstream(`${WS}/webservice/R02_000/order?format=xml`, {
    auth: true,
    env,
    method: 'POST',
    body,
    contentType: 'application/x-www-form-urlencoded',
  }).catch((err: unknown) => {
    if (err instanceof FrError && err.status === 400) return null
    throw err
  })

  const xml = res ? await res.text() : ''
  if (!xml) {
    throw new FrError('bad_request', 400, 'Falk&Ross refused the order document.')
  }

  const gatewayError = elementInner(xml, 'error')
  if (gatewayError) {
    return {
      ok: false,
      orderId: '0',
      errorCode: elementText(gatewayError, 'code') || '400',
      message: elementText(gatewayError, 'message') || 'Rejected by Falk&Ross.',
      lines: [],
      mode,
      customerNumber,
      customerNumberSource: source,
    }
  }

  const orderId = elementText(xml, 'orders_id')
  const errorCode = elementText(xml, 'err')
  const lines: FrOrderResult['lines'] = []
  for (const p of allElements(elementInner(xml, 'product_list') ?? '', 'product')) {
    const item = elementInner(p, 'item')
    if (!item) continue
    const code = elementText(item, 'p_err')
    if (!code || code === '0') continue
    lines.push({
      sku: elementText(p, 'p_sku'),
      errorCode: code,
      message: elementText(item, 'msg') || elementText(item, 'p_err_msg'),
    })
  }

  return {
    ok: !!orderId && orderId !== '0' && (!errorCode || errorCode === '0'),
    orderId,
    errorCode,
    message: elementText(xml, 'err_msg') || lines[0]?.message || '',
    lines,
    mode,
    customerNumber,
    customerNumberSource: source,
  }
}

// ---------------------------------------------------------------------------
// Image proxy
// ---------------------------------------------------------------------------

/**
 * Supplier photo, same-origin. Anything outside `ws/picture/` and `ws/picto/`
 * is refused so this cannot be turned into an open proxy for the rest of the
 * internet — the path is validated, never merely concatenated.
 */
async function serveImage(kind: string, file: string): Promise<Response> {
  if ((kind !== 'picture' && kind !== 'picto') || !/^[A-Za-z0-9._-]{1,128}$/.test(file)) {
    return new Response('not found', { status: 404 })
  }
  const upstream = await fetchUpstream(`${DOWNLOAD}/ws/${kind}/${file}`, { cacheTtl: TTL.image })
  const headers = new Headers()
  headers.set('content-type', upstream.headers.get('content-type') ?? 'image/jpeg')
  // Filenames are versioned by the supplier (…-2019_01.jpg), so a given URL's
  // bytes never change: cache hard, both at the edge and in the browser.
  headers.set('cache-control', `public, max-age=${TTL.image}, immutable`)
  // Same-origin already, but explicit CORS keeps the ingest canvas untainted
  // even if the studio is ever served from a different host than the Worker.
  headers.set('access-control-allow-origin', '*')
  const etag = upstream.headers.get('etag')
  if (etag) headers.set('etag', etag)
  return new Response(upstream.body, { status: 200, headers })
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200, maxAge = 0): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': maxAge > 0 ? `public, max-age=${maxAge}` : 'no-store',
    },
  })
}

const clampInt = (v: string | null, def: number, min: number, max: number) => {
  const n = parseInt(v ?? '', 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def
}

/**
 * `/api/fr/*` — the whole Falk&Ross surface. Returns null when the path is not
 * ours, so the caller can fall through to the rest of the Worker.
 *
 * Routes:
 *   GET  /api/fr/state                      webservice mode (test vs live)
 *   GET  /api/fr/styles?q&kind&offset&limit  paged, server-side-filtered cards
 *   GET  /api/fr/style/{styleNr}            one style, full detail
 *   GET  /api/fr/price/{styleNr}            purchase prices per SKU
 *   GET  /api/fr/stock/{styleNr}            stock per SKU
 *   GET  /api/fr/deliveries/{styleNr?}      announced restocks
 *   GET  /api/fr/img/{picture|picto}/{file} photo proxy (CORS + long cache)
 *   POST /api/fr/order                      place an order (see placeOrder)
 */
export async function handleFalkRoss(
  request: Request,
  env: FalkRossEnv,
  ctx: ExecutionContext,
): Promise<Response | null> {
  const url = new URL(request.url)
  const path = url.pathname
  if (!path.startsWith('/api/fr/')) return null
  const rest = path.slice('/api/fr/'.length)
  const origin = url.origin
  const method = request.method

  try {
    const img = /^img\/([a-z]+)\/(.+)$/.exec(rest)
    if (img && (method === 'GET' || method === 'HEAD')) {
      return await serveImage(img[1], img[2])
    }

    if (rest === 'state' && method === 'GET') {
      return json(await loadState(origin, env, ctx), 200, 60)
    }

    if (rest === 'styles' && method === 'GET') {
      const result = await browseStyles(origin, ctx, {
        q: url.searchParams.get('q') ?? '',
        kind: url.searchParams.get('kind') ?? 'printable',
        offset: clampInt(url.searchParams.get('offset'), 0, 0, 100000),
        limit: clampInt(url.searchParams.get('limit'), 24, 1, 48),
      })
      return json(result, 200, 300)
    }

    const style = /^style\/(\d{4,6})$/.exec(rest)
    if (style && method === 'GET') {
      const index = await styleIndex(origin, ctx)
      return json(await loadStyle(origin, ctx, index.version, style[1]), 200, 3600)
    }

    const price = /^price\/(\d{4,6})$/.exec(rest)
    if (price && method === 'GET') {
      return json(await loadPrices(origin, env, ctx, price[1]), 200, 300)
    }

    const stock = /^stock\/(\d{4,6})$/.exec(rest)
    if (stock && method === 'GET') {
      return json(await loadStock(origin, env, ctx, stock[1]), 200, 60)
    }

    const deliveries = /^deliveries(?:\/(\d{4,6}))?$/.exec(rest)
    if (deliveries && method === 'GET') {
      return json(await loadDeliveries(origin, env, ctx, deliveries[1] ?? ''), 200, 300)
    }

    if (rest === 'order' && method === 'POST') {
      let input: FrOrderInput
      try {
        input = (await request.json()) as FrOrderInput
      } catch {
        throw new FrError('bad_request', 400, 'Expected a JSON order body.')
      }
      return json(await placeOrder(origin, env, ctx, input, new Date()))
    }

    return json({ error: 'not_found', message: `No Falk&Ross route ${rest}` }, 404)
  } catch (err) {
    if (err instanceof FrError) {
      return json({ error: err.code, message: err.message }, err.status)
    }
    return json({ error: 'upstream', message: 'Falk&Ross request failed.' }, 502)
  }
}
