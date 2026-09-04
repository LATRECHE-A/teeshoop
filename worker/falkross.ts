/**
 * FALK&ROSS: the supplier webservice, server-side.
 *
 * ============================================================================
 * WHY THIS LIVES IN THE WORKER AND NOT IN THE BROWSER
 * ----------------------------------------------------------------------------
 * Three independent reasons, any one of which would be enough:
 *  1. CREDENTIALS. Prices, stock and order placement are HTTP Basic. A secret
 *     shipped to a browser is a published secret, so the client never sees it.
 *     It reaches these routes, and only these routes reach Falk&Ross.
 *  2. CORS. Not one falk-ross.eu endpoint sends an allow-origin header, so a
 *     browser cannot read any of them, authenticated or not.
 *  3. CANVAS TAINTING. The ingest pipeline (src/lib/ingest/pipeline.ts) draws
 *     the supplier photo into a canvas and reads the pixels back for the
 *     cutout, print-area and back-reconstruction passes. A cross-origin image
 *     without CORS headers taints the canvas and `getImageData` throws, which
 *     would break ingest entirely, so photos are proxied too, same-origin,
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
 * budgeted (see `browseStyles`) because "search 2348 styles" cannot mean
 * "make 2348 subrequests". READ THE SUBREQUEST BUDGET NOTE above the browse
 * constants before touching that path: Cloudflare's free-plan cap of 50
 * subrequests per invocation counts Cache API calls as well as `fetch`, and
 * getting that wrong took the whole catalogue down once already.
 *
 * VERIFIED LIVE on 2026-07-31 against the real account; where the supplier PDF
 * and reality disagree, the code follows reality and says so at the site of the
 * difference.
 */
import { allElements, decodeXml, elementInner, elementText, langText } from './xml'
import { requireAdmin, type AdminEnv } from './auth'

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export interface FalkRossEnv extends AdminEnv {
  /** Webservice account (NOT the webshop login). `wrangler secret put FR_WS_USER`. */
  FR_WS_USER?: string
  /** Webservice password. `wrangler secret put FR_WS_PASS`. */
  FR_WS_PASS?: string
  /**
   * Falk&Ross customer number, and the ONLY place an order may get one.
   *
   * `wrangler secret put FR_CUSTOMER_NR`. Unset means `POST /api/fr/order`
   * answers 503 and nothing is sent, which is the state this ships in.
   *
   * IT USED TO HAVE A FALLBACK AND THAT WAS THE BUG. The login is shaped
   * `{account}-{n}-{token}`, so `placeOrder` derived the customer number from
   * its leading digits when the secret was absent, and reported that it had.
   * A number that decides which account a supplier bills is exactly the kind
   * this project may not guess, and a field saying `derived-from-user` only
   * protects whoever reads it. `scripts/fr-verify.mjs` probes whether that
   * leading segment IS the customer number, and until the supplier says yes,
   * nothing here assumes it.
   */
  FR_CUSTOMER_NR?: string
  /**
   * A SECOND SECRET, FOR THE ONE ROUTE THAT SPENDS MONEY.
   *
   * `wrangler secret put FR_ORDER_TOKEN`. Unset means `POST /api/fr/order`
   * answers 503 and nothing is sent, which is the state this ships in.
   *
   * WHY IT EXISTS. `ADMIN_TOKEN` opens every route in this file, and one of its
   * holders is a cron on the shop that reads the catalogue every night: the
   * token that imports product photographs was also the token that could place a
   * purchase order for any article in any quantity. A read-only job and a
   * spending job had one credential, and the read-only one is the one that lives
   * in a WordPress on shared hosting. `ADMIN_TOKEN` is still required; this is in
   * addition, on a header of its own, and the shop keeps it in a different
   * wp-config constant so the catalogue importer never carries it.
   */
  FR_ORDER_TOKEN?: string
}

const DOWNLOAD = 'https://download.falk-ross.eu'
const WS = 'https://ws.falk-ross.eu'

/**
 * Origin used to MINT CACHE KEYS, deliberately a host we never serve.
 *
 * `caches.default` is keyed by URL, and these entries include `price:{style}`,
 * i.e. our purchase cost. Minting them on our own origin made them look like
 * real paths: an inbound `GET /__fr-cache/price%3A18001` could collide with a
 * stored entry, and the asset layer answered such paths before the Worker ever
 * saw them (verified 2026-08-12: it returned 200). Keying on an origin that
 * resolves to nothing removes the collision instead of routing around it.
 *
 * worker/index.ts still 404s the `/__fr-cache/` path prefix, and wrangler.jsonc
 * routes it to the Worker so that 404 is reachable. Belt and braces, on purpose.
 */
const CACHE_ORIGIN = 'https://fr-cache.tshop.internal'

/**
 * Upstream directories the media proxy will serve, and nothing else.
 *
 * `download.falk-ross.eu` also hosts the XML feed itself; a proxy that took any
 * path would hand the whole catalogue, unauthenticated, to anyone who guessed
 * the URL.
 */
const ALLOWED_MEDIA = new Set(['picture', 'picto', 'sizespecs'])

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
  /** Stock genuinely moves. This is the one number a stale cache misleads on. */
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
  /**
   * Statuses to hand back to the caller instead of throwing.
   *
   * ONE CALLER, AND IT EXISTS BECAUSE THE ABSENCE OF IT WAS A BUG. The order
   * gateway reports a malformed document as HTTP 400 with the reason in the
   * body (`<response><error><code>400</code><message>…`), and that is the
   * response an order is MOST likely to get: `scripts/fr-verify.mjs` gets one
   * on every run. `placeOrder` was written to parse it and could not: the
   * `!res.ok` throw below turned the 400 into a 502 before the body was ever
   * read, and the `catch` that looked for `err.status === 400` was therefore
   * unreachable. Found 2026-08-19 by reading the two paths side by side.
   */
  allowStatus?: readonly number[]
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
 * both sides used 20 s the client always aborted first (it starts its clock
 * earlier), so this module's truthful 502 was unreachable from the browser and
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
  if (opts.allowStatus?.includes(res.status)) return res
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
  const req = new Request(new URL(`/__fr-cache/${encodeURIComponent(key)}`, CACHE_ORIGIN).toString())
  const cache = caches.default
  const hit = await cache.match(req)
  if (hit) {
    try {
      return (await hit.json()) as T
    } catch {
      // Corrupt entry: fall through and rebuild rather than fail the request.
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
  /** Feed version, e.g. "R000-011". Style XML URLs are versioned by it. */
  version: string
  exportedAt: string
  /** Five-digit style numbers, ASCENDING. See `styleIndex`. */
  nrs: string[]
}

/**
 * The complete style list. VERIFIED: 2348 styles, and the per-style link is
 * `…/ws/{version}/xml/{nr}.xml`, NOT the `…/ws/xml/{nr}.xml` the PDF shows.
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
      // workwear. VERIFIED: the first 200 styles in feed order contain zero
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
  /** Colour chip (a JPG, not a hex). See the note on `swatch`. */
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

/**
 * WHICH OF THE SHOP'S DEPARTMENTS A STYLE BELONGS IN, which is a DIFFERENT
 * question from `FrKind` and is deliberately a second field rather than more
 * values on the first.
 *
 * `FrKind` answers « what blank is this », and it is read by
 * `Costing::facts()` in the plugin, which feeds `PriceRule::SELECTORS` and so
 * the floor price and the recommended price. Adding `casquette` to it would put
 * a value in a money selector that `PriceRule::FAMILIES` does not offer, so a
 * rule written for `other` would silently stop matching a cap and no rule could
 * be written to replace it. Measured on a 30-piece order: the same 330,00 EUR
 * moves from « sellable » to « below floor, needs approval ».
 *
 * `FrShelf` answers « where does a shopper look for it », reaches no amount
 * anywhere in the plugin (product_cat appears only in Content, Taxonomy,
 * Importer and Seo), and is the associate's own list of departments.
 *
 * Two fields, two questions, and neither is a second implementation of the
 * other: a bath towel is `other` for pricing, because the studio does not print
 * it, and `maison` for navigation, because that is the aisle it is sold in.
 */
export type FrShelf =
  | 'tshirt'
  | 'polo'
  | 'sweat'
  | 'chemise'
  | 'veste'
  | 'casquette'
  | 'bonnet'
  | 'sac'
  | 'tablier'
  | 'maison'
  | 'autre'
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
  /**
   * The shop's aisle. See `FrShelf`: a second question from `kind`, and the one
   * the customer navigates by. `kind` decides pricing and what the studio can
   * print; this decides where the product is filed.
   */
  shelf: FrShelf
  sleeve: FrSleeve
  gender: string
  neckline: string
  fabric: string[]
  certificates: string[]
  /**
   * The one place Falk&Ross gets near a size table: a PDF of the maker's own
   * size spec. It is a PDF, so nothing here can read it, but a human can, and
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
   * behind (VERIFIED: substituting another colour code into a back filename
   * 404s), while every colourway has its own flat FRONT via
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

/** Grid row, a projection of FrStyle small enough to scan thousands of. */
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
function groupList(xml: string, list: string, item: string, prefer: readonly string[] = LANGS): string[] {
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
 * product types with cross-cutting tags. A style is routinely both "T-Shirts"
 * and "Workwear", and vetoing on the latter would hide half the tees.
 */
const CATEGORY_VETO =
  /bag|cap\b|hat|beanie|scarf|glove|sock|underwear|shoe|footwear|trouser|pant|jogging|skirt|dress|apron|towel|home|horeca|care|jacket|coat|parka|softshell|bodywarmer|umbrella|blanket|accessor/i

/**
 * The same veto applied to a style NAME, for the styles whose only categories
 * are marketing tags ("NEW 2026", "TOP SELLERS") and so say nothing. Without
 * it, "UNLABELED Sweatpants" and "Hooded Softshell Jacket" both classify as
 * sweatshirts on the strength of one word. VERIFIED, both did.
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
 * "Sweatshirts & Hoodies" category classifies as a T-SHIRT, which would then
 * pick the tee size block for every hoodie in the catalogue.
 */
const KIND_PATTERNS: readonly (readonly [RegExp, FrKind])[] = [
  [/\bpolos?\b/i, 'polo'],
  [/\bt-?shirts?\b|\btee-?shirts?\b|\bcamisetas?\b/i, 'tee'],
  /*
   * `hoods` and `hoody` are NOT covered by `hoodie` or `hooded`, and that gap
   * cost 27 printable sweatshirts.
   *
   * MEASURED on 04/09/2026: the supplier's own sub-category for a hooded
   * sweatshirt is the plural « Hoods », which `\bhooded\b` does not match, and
   * many names spell it « Hoody », which `\bhoodie` does not match either. So 27
   * styles (20039 Heavy Hoody, 26600 Men's Authentic Zipped Hood, 29401 Classic
   * Hooded Sweat Jacket…) classified as `other`, and because `isPrintableKind`
   * gates the catalogue list, `--famille=printable` NEVER DOWNLOADED THEM. They
   * are garments the studio prints every week.
   *
   * SINGULAR `\bhood\b` is deliberately absent. It would match the name
   * « Recycled Fleece Hood », which is a fleece BEANIE, and that is the exact
   * mistake the comment on `classifyKind` below records. Plural on the category,
   * « hoody » on the name, and nothing else.
   *
   * THIS MOVES A FAMILY, AND A FAMILY REACHES MONEY: `Costing::facts()` reads it
   * and `PriceRule::SELECTORS` matches on it. It introduces no new value, `sweat`
   * is already in `PriceRule::FAMILIES`, and it moves these styles from a family
   * that is wrong to one that is right. Measured the same day: zero price rules
   * exist (`teeshoop_price_rules` is `[]` on the mirror and absent on the shop),
   * so today it moves no money at all.
   */
  [/\bsweat|\bhoodie|\bhoods\b|\bhoody\b|\bhooded\b|\bkapuzen|\bsudadera/i, 'sweat'],
  [/\bshirts?\b|\bknitwear\b|\bchemises?\b|\bhemd|\bblouse|\bbluse/i, 'shirt'],
]

/**
 * What kind of blank this is: the studio only decorates upper-body garments,
 * and the choice of reference size chart (tee vs hoodie) hangs off it.
 *
 * Driven by the supplier's own SUB-CATEGORIES, which are a controlled
 * vocabulary ("T-Shirts", "Polos", "Bags & Accessories"), with the style name
 * consulted only when they are uninformative. Doing it the other way round,
 * matching the name first, is what turned a fleece beanie called "Recycled
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

/** Blanks the studio can actually print on, the catalogue's default filter. */
export const isPrintableKind = (k: FrKind) => k === 'tee' || k === 'polo' || k === 'sweat'

/* ─────────────────────────────────────────────────────── the shop's aisles ── */

/**
 * THE SUPPLIER'S PRODUCT GROUP IS THE FINE SIGNAL, and it is what this file
 * used to throw away.
 *
 * `parseStyle` reads five of the supplier's group lists (sleeve, gender,
 * neckline, fabric, certificate) and skipped `style_product_group_list`. It is
 * the only field that separates an apron from a towel: style 91367 « Bib Apron
 * Basic with Pocket » carries the sub-categories « Horeca & Care / TOP SELLERS
 * / Washable up to 60°C » and NOTHING else says apron. Its groups say
 * « Gastronomy / Aprons ». Verified against the live payload on 04/09/2026.
 *
 * A WHITELIST AND NOT A REGULAR EXPRESSION, because the group list mixes
 * product types with attributes: the same style carries « Full Zip »,
 * « Showerproof » and « Size 4XL+ » beside « Softshell ». A pattern would match
 * the attributes; an exact table can only match what it was told about, and a
 * label nobody listed simply falls through to the sub-category below.
 *
 * The order is the precedence, and it decides SEVEN styles in the whole
 * catalogue: two sport jackets, two beanies also filed under Caps & Hats, one
 * « Fitted Cap Softshell », and two cushion covers filed as both Bags and
 * Towels. Those seven are inspectable, which is why this is a list and not an
 * argument.
 */
const SHELF_BY_GROUP: readonly (readonly [string, FrShelf])[] = [
  // Aprons first: they hide inside « Horeca & Care » with towels and cookware.
  ['aprons', 'tablier'],
  // Knitted and winter hats are bonnets; « Caps » and plain « Hats » are not.
  ['winter hats', 'bonnet'],
  ['knitted hats', 'bonnet'],
  ['caps', 'casquette'],
  ['hats', 'casquette'],
  ['backpacks', 'sac'],
  ['shopping bags', 'sac'],
  ['special bags', 'sac'],
  ['sportsbags', 'sac'],
  ['travelbags', 'sac'],
  ['shoulder bags', 'sac'],
  ['office bags', 'sac'],
  ['towels', 'maison'],
  ['blankets', 'maison'],
  ['bathrobes', 'maison'],
  ['cookwear', 'maison'],
  ['jackets', 'veste'],
  ['softshell', 'veste'],
  ['bodywarmers', 'veste'],
  ['fleece', 'veste'],
]

/**
 * The fallback, on the supplier's sub-categories, for the styles whose product
 * groups say nothing useful. Fourteen styles carry no group at all.
 *
 * These are the same tokens `CATEGORY_VETO` above already lists, and that is
 * the point rather than a duplication: the veto answers « not printable » and
 * this answers « which aisle ». One says what the studio cannot decorate, the
 * other says where a shopper finds it, and a bag is both.
 */
const SHELF_BY_CATEGORY: readonly (readonly [RegExp, FrShelf])[] = [
  [/beanies/i, 'bonnet'],
  [/caps & hats/i, 'casquette'],
  [/bags & accessories/i, 'sac'],
  [/towels & home/i, 'maison'],
  [/\bjackets?\b|softshell|bodywarmer/i, 'veste'],
]

/**
 * Groups that are NOT one of the eleven aisles, listed so that they stop at the
 * group table instead of falling through to a sub-category that would misfile
 * them.
 *
 * MEASURED, and this is why the table exists: 41 of the 410 styles the supplier
 * files under « Caps & Hats » are not headwear. Nineteen pairs of gloves,
 * eighteen scarves or snoods, three headbands. A rule reading the sub-category
 * alone would have sold every one of them as a cap.
 *
 * The associate has no aisle for gloves, trousers or shoes, so they stay in
 * « Autres textiles » and say so, rather than being pushed into the nearest
 * aisle that would have them.
 */
const GROUP_NOT_AN_AISLE = /^(gloves|scarfs|headbands|shoes|trousers|sweat pants|shorts|underwear|safety vests)$/i

/**
 * Which aisle a style is sold in.
 *
 * The four printable kinds keep their own aisle, so this never disagrees with
 * `classifyKind`: a polo is `polo` in both. Everything the studio cannot print
 * is then placed by the supplier's own vocabulary, group first and
 * sub-category second, and what neither can place stays `autre` rather than
 * being guessed at from its name. Deriving an aisle from a title is the trap
 * this file already records twice: « Tee Jays Luxury Stretch Shirt » is a polo,
 * and « Recycled Fleece Hood » is a fleece beanie, not a hoodie.
 */
export function classifyShelf(kind: FrKind, categories: string[], groups: string[]): FrShelf {
  if (kind === 'tee') return 'tshirt'
  if (kind === 'polo') return 'polo'
  if (kind === 'sweat') return 'sweat'
  if (kind === 'shirt') return 'chemise'

  const seen = groups.map((g) => g.trim().toLowerCase())
  if (seen.some((g) => GROUP_NOT_AN_AISLE.test(g))) return 'autre'
  for (const [label, shelf] of SHELF_BY_GROUP) {
    if (seen.includes(label)) return shelf
  }
  for (const [re, shelf] of SHELF_BY_CATEGORY) {
    if (categories.some((c) => re.test(c))) return shelf
  }
  return 'autre'
}

/**
 * Choose the front/back pair to show for a style.
 *
 * VERIFIED shot types: 'f' flat front, 'b' flat back, 'm' model front, 'mb'
 * model BACK (undocumented: the PDF lists only m/f/b), and '-' for the sleeve
 * detail shots (_sl-/_sr-), which are never a garment side.
 *
 * The pair must be COHERENT, which the obvious "first f, first b" rule is not:
 * on style 00142 that yields a model front in colour 123 beside a flat back in
 * colour 507, two different garments in two different registers. So a pair in
 * one colour and one register wins, and only then do we settle for less.
 */
function pickSides(photos: FrPhoto[]): { front: FrPhoto | null; back: FrPhoto | null } {
  const byPos = (a: FrPhoto, b: FrPhoto) => a.pos - b.pos
  const of = (shot: string) => photos.filter((p) => p.shot === shot).sort(byPos)
  const flatF = of('f')
  const flatB = of('b')
  const modelF = of('m')
  const modelB = of('mb')

  // 1. Same register, same colourway: a real front and back of one garment.
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
  // <style_category_sub> children), so read the SUBS. They carry the real
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
  // ENGLISH, like the classification above and for the same reason: the French
  // labels are marketing copy, the English ones are a controlled vocabulary.
  const productGroupsEn = groupList(style, 'style_product_group_list', 'style_product_group', LANGS_EN)
  const shelf = classifyShelf(kind, categoriesEn, productGroupsEn)

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
    shelf,
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
 * One style's raw XML.
 *
 * `fallback` retries the version-less path, which serves an identical document
 * today. It is on for the detail route (one document, correctness first) and
 * OFF for bulk block builds, where a 404 must cost a predictable ONE subrequest
 * (see the subrequest budget below).
 */
async function fetchStyleXml(version: string, nr: string, fallback: boolean): Promise<string> {
  try {
    return await fetchText(`${DOWNLOAD}/ws/${version}/xml/${nr}.xml`, { cacheTtl: TTL.style })
  } catch (err) {
    if (!fallback || !(err instanceof FrError) || err.code !== 'not_found') throw err
    return fetchText(`${DOWNLOAD}/ws/xml/${nr}.xml`, { cacheTtl: TTL.style })
  }
}

/** One style, parsed and cached, for the detail route. */
async function loadStyle(
  origin: string,
  ctx: ExecutionContext,
  version: string,
  nr: string,
): Promise<FrStyle> {
  return cachedJson(origin, `style:${nr}`, TTL.style, ctx, async () =>
    parseStyle(await fetchStyleXml(version, nr, true), nr),
  )
}

// ---------------------------------------------------------------------------
// Catalogue browse (server-side search + pagination)
// ---------------------------------------------------------------------------

/**
 * ============================================================================
 * THE SUBREQUEST BUDGET, the constraint this whole section is shaped around.
 * ============================================================================
 *
 * Cloudflare caps ONE Worker invocation at 50 subrequests on the Workers FREE
 * plan (1000 on Paid). Crucially, "subrequest" is NOT just `fetch`: every
 * `caches.default.match` and every `.put` counts too, including puts handed to
 * `ctx.waitUntil`, which run inside the same invocation.
 *
 * An earlier version of this file assumed the opposite (its comment read
 * "Cache API reads are not subrequests") and budgeted 48 upstream fetches with
 * a 600-style warm walk. A cold style actually cost FIVE subrequests
 * (match card, match style, fetch, put card, put style), so a single browse
 * could ask for ~240 against a ceiling of 50. It threw
 * `Too many subrequests by single Worker invocation`, the catch-all in
 * `handleFalkRoss` reported it as `{"error":"upstream"}`, and the catalogue
 * looked like a credentials failure. VERIFIED live 2026-08-08 via
 * `wrangler tail`: page 1 worked (warm, and its first 12 styles are printable
 * so the scan stopped), while any cold region 502'd in ~0.4 s, deterministically
 * and forever: a failed request caches nothing, so retrying could never warm it.
 *
 * The fix is BLOCK CACHING plus honest accounting. Cards are cached in
 * aligned blocks of `BLOCK` styles under one key, so a warm block costs ONE
 * subrequest for 12 styles instead of 12, and `Subrequests` reserves worst-case
 * cost before spending it. Out of budget is not an error: the request returns a
 * short page with a non-null `nextOffset`, which is already this endpoint's
 * contract for "more to scan" and the UI resumes from there.
 *
 * Measured effect per invocation: a warm scan covers ~500 styles (was ~45
 * before it threw), a cold scan ~36.
 *
 * ----------------------------------------------------------------------------
 * TODO: DO THIS FIRST if the site ever moves to Workers PAID (or any host
 * without a ~50-subrequest cap; Paid allows 1000).
 *
 * Block caching exists ONLY to survive the free-plan ceiling, and it buys that
 * survival with real costs: a cold block is all-or-nothing (12 fetches must fit
 * at once), pagination is forced to snap to block boundaries, and a browse can
 * build at most ~3 cold blocks before it has to hand back `nextOffset`, so the
 * FIRST pass over the 2316-style catalogue takes many round trips.
 *
 * With a 1000-subrequest budget the better design is:
 *   1. Raise `SUBREQUEST_LIMIT` to the real ceiling. That alone lets one
 *      request build ~70 cold blocks (~840 styles) instead of ~3.
 *   2. Better still, drop blocks and PRECOMPUTE the whole card index once
 *      (a scheduled Cron Worker walking all 2316 styles into a single KV or R2
 *      document). Browse then becomes ONE read, search and filter get exact
 *      totals instead of "scanned so far", `nextOffset` disappears, and the
 *      supplier is hit ~2316 times a DAY rather than once per cold user scroll.
 *      That is the design this endpoint wants; the free plan cannot afford it.
 * ----------------------------------------------------------------------------
 */
const SUBREQUEST_LIMIT = 50
/** Headroom for the route's own work and for a retry inside `fetchUpstream`. */
const SUBREQUEST_RESERVE = 5
/**
 * Worst-case cost of `styleIndex`: match + fetch + put. Charged up front rather
 * than measured, because a reservation that can be wrong is not a budget.
 */
const INDEX_COST = 3
/**
 * Styles per cached card block. 12 keeps the cold fan-out identical to the
 * batch size this endpoint has always used, and keeps a cold block (match + 12
 * fetches + put = 14) small enough that three fit in one free-plan invocation.
 */
const BLOCK = 12
/** Belt-and-braces cap on the walk; the subrequest budget binds first. */
const MAX_SCAN = 600

/**
 * A spend-before-you-act budget. `take` reserves the WORST case and refuses
 * rather than over-spending, so the caller can stop cleanly and report
 * `nextOffset` instead of throwing halfway through a page.
 */
class Subrequests {
  private left: number
  constructor(limit: number) {
    this.left = limit
  }
  take(n: number): boolean {
    if (this.left < n) return false
    this.left -= n
    return true
  }
}
/**
 * Wall-clock ceiling for one browse request, checked between batches. Worst
 * case a batch starts just under it and over-runs by UPSTREAM_TIMEOUT_MS, so
 * the endpoint answers by ~28 s, inside the client's 35 s browse budget.
 */
const BROWSE_BUDGET_MS = 18_000

export interface BrowseResult {
  total: number
  offset: number
  /** Where to resume; null when the catalogue is exhausted. */
  nextOffset: number | null
  scanned: number
  /**
   * Styles in the scanned range whose document could not be read.
   *
   * A caller deciding what the supplier has WITHDRAWN must treat a non-zero
   * value as "this walk was lossy": a style that is merely unreadable today is
   * indistinguishable, in `items`, from one that is gone.
   */
  dropped: number
  items: FrCard[]
  exportedAt: string
}

/**
 * One aligned block of grid cards, the unit the catalogue is cached in.
 *
 * Returns null when the budget cannot cover the work. The caller stops and
 * reports `nextOffset` rather than throwing. Blocks are keyed by FEED VERSION,
 * so the morning's re-export invalidates every block without a purge.
 */
interface Block {
  cards: FrCard[]
  /** Styles in this block whose document could not be read. See below. */
  dropped: number
}

async function loadCardBlock(
  origin: string,
  ctx: ExecutionContext,
  index: StyleListIndex,
  start: number,
  budget: Subrequests,
): Promise<Block | null> {
  const nrs = index.nrs.slice(start, start + BLOCK)
  if (nrs.length === 0) return { cards: [], dropped: 0 }
  const key = new Request(
    new URL(
      `/__fr-cache/${encodeURIComponent(`cards:${index.version}:${start}`)}`,
      CACHE_ORIGIN,
    ).toString(),
  )

  if (!budget.take(1)) return null
  const hit = await caches.default.match(key)
  if (hit) {
    try {
      const cached = (await hit.json()) as Block | FrCard[]
      // Entries written before blocks carried `dropped` are plain arrays.
      return Array.isArray(cached) ? { cards: cached, dropped: 0 } : cached
    } catch {
      // Corrupt entry: fall through and rebuild, budget permitting.
    }
  }

  // Cold: one fetch per style plus the write-back. Reserved as a whole, because
  // a half-built block is worth nothing and would still have cost the fetches.
  if (!budget.take(nrs.length + 1)) return null
  const built = await Promise.all(
    nrs.map(async (nr) => {
      try {
        return toCard(parseStyle(await fetchStyleXml(index.version, nr, false), nr))
      } catch {
        // A single unpublished / malformed style must not sink the block.
        return null
      }
    }),
  )
  /*
   * COUNTED, because silently dropping a style is not free any more.
   *
   * A document that 404s or fails to parse used to vanish here and nowhere
   * else: the caller saw a complete walk that simply did not contain it. That
   * was fine while the only reader was a grid a human scrolls. It is not fine
   * now that the shop's importer walks this to decide which references the
   * supplier has STOPPED selling, because a style dropped here looks exactly
   * like a style withdrawn, and the answer to "withdrawn" is to unpublish a
   * product that is on sale.
   */
  const block: Block = {
    cards: built.filter((c): c is FrCard => c !== null),
    dropped: built.filter((c) => c === null).length,
  }

  ctx.waitUntil(
    caches.default.put(
      key,
      new Response(JSON.stringify(block), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': `public, max-age=${TTL.style}`,
        },
      }),
    ),
  )
  return block
}

async function browseStyles(
  origin: string,
  ctx: ExecutionContext,
  opts: { q: string; kind: string; offset: number; limit: number },
): Promise<BrowseResult> {
  const budget = new Subrequests(SUBREQUEST_LIMIT - SUBREQUEST_RESERVE)
  budget.take(INDEX_COST)
  const index = await styleIndex(origin, ctx)
  const needle = opts.q.trim().toLowerCase()
  const items: FrCard[] = []
  // Snap to a block boundary so a given style always lands in the same cached
  // block. `nextOffset` is itself always a boundary, so after the first request
  // this is a no-op, and offset 0 is already aligned.
  const start =
    Math.floor(Math.max(0, Math.min(opts.offset, index.nrs.length)) / BLOCK) * BLOCK
  let i = start
  let dropped = 0
  const deadline = Date.now() + BROWSE_BUDGET_MS

  const matches = (c: FrCard) => {
    if (opts.kind === 'printable' && !isPrintableKind(c.kind)) return false
    if (opts.kind && opts.kind !== 'printable' && opts.kind !== 'all' && c.kind !== opts.kind) {
      return false
    }
    if (!needle) return true
    return `${c.name} ${c.brand} ${c.supplierRef} ${c.styleNr}`.toLowerCase().includes(needle)
  }

  /*
   * THE PAGE SIZE IS RAISED TO A WHOLE BLOCK, AND THAT IS A CORRECTNESS FIX.
   *
   * The loop below consumed a block card by card and then advanced `i` past the
   * whole block regardless. So when `items` filled up in the middle of a block,
   * every remaining MATCH in that block was dropped AND skipped: `nextOffset`
   * pointed after them, and no later page could ever return them. A caller
   * walking to `nextOffset === null` therefore believed it had seen the whole
   * catalogue while silently missing styles.
   *
   * Harmless while the only caller was a grid a human scrolls. Not harmless now
   * that the shop's importer walks this to decide what the supplier still
   * sells: a style dropped here is a published product the importer unpublishes.
   *
   * A block is 12 and the route clamps `limit` to 1..48, so making the
   * effective limit at least BLOCK guarantees a block is always consumable in
   * one page, which is what makes "advance past the whole block" true again. A
   * caller asking for 1 can get up to 12; over-delivery is not a defect,
   * silently losing a garment is.
   */
  const limit = Math.max(opts.limit, BLOCK)

  while (
    i < index.nrs.length &&
    items.length < limit &&
    i - start < MAX_SCAN &&
    // A WALL-CLOCK budget beside the subrequest one. The budget bounds how much
    // work we ask for, but not how long the supplier takes to do it: one hung
    // document stalls its whole `Promise.all` block for UPSTREAM_TIMEOUT_MS, and
    // several such blocks used to outlast the browser's own deadline, so the
    // client aborted and blamed the backend.
    Date.now() < deadline
  ) {
    const block = await loadCardBlock(origin, ctx, index, i, budget)
    if (block === null) break // out of subrequests: resume from `i`
    dropped += block.dropped
    // Every match in the block is taken, so advancing past the block cannot
    // skip one. `limit` is at least BLOCK, so this overshoots by at most 11.
    for (const c of block.cards) {
      if (matches(c)) items.push(c)
    }
    i += BLOCK
  }
  if (i > index.nrs.length) i = index.nrs.length

  return {
    total: index.nrs.length,
    offset: start,
    nextOffset: i < index.nrs.length ? i : null,
    scanned: i - start,
    dropped,
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
 * do it with HTTP 200, so the body has to be inspected, not the status.
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
  /**
   * SKU → { cost, list }. `cost` is OUR PURCHASE PRICE (`your_price`).
   *
   * `list` IS NOT A LIST PRICE, whatever the name suggests. It is the CSV's
   * `default_price` column, and MEASURED 2026-08-14 on four styles it is
   * consistently BELOW `your_price`, by a third to a half:
   *
   *     18001  default 2,13   your 3,37
   *     15009  default 2,95   your 4,46
   *     01542  default 1,94   your 3,00
   *     22109  default 10,35  your 15,38
   *
   * A price we are charged MORE than cannot be a recommended retail price, so
   * whatever `default_price` is (a base tariff before our account's terms, most
   * likely), it is not a reference price and must never be shown to a customer
   * as one. Crossing it out beside ours would advertise a discount that does
   * not exist, which in France is a prix de référence fictif and unlawful. The
   * cart shipped exactly that mistake once already. Nothing may read this field
   * but a human comparing tariffs.
   */
  prices: Record<string, { cost: number; list: number }>
}

/**
 * Purchase prices for one style.
 *
 * `your_price` IS OUR COST, unlike the Imbretex snapshot's `rrpEur`, which is
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
  /** Upstream timestamp, the first line of the CSV, before any SKU row. */
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

/**
 * ONE ROW PER SKU, FOR THE WHOLE CATALOGUE, IN ONE UPSTREAM CALL.
 *
 * The truncation wildcard the per-style route uses (`18001____`) turns out to
 * accept an underscore at EVERY position. MEASURED 2026-08-19 against the live
 * account, in one run, warm:
 *
 *     18001____   25 lines        529 B   282 ms   (one style)
 *     1800_____   541 lines    10 851 B    95 ms   (a hundred styles)
 *     _________  46 592 lines  908 447 B  674 ms   (everything)
 *
 * That measurement is the whole reason a stock sweep is affordable here. The
 * alternative shapes both fail on Cloudflare's fifty-subrequest ceiling or on
 * time: one call per SKU is 26 399 requests, and one call per style is 460
 * Worker invocations for a number the supplier will happily hand over in a
 * single 900 KB response.
 *
 * THE FIRST LINE IS THE SNAPSHOT'S OWN TIMESTAMP, and it is the point of this
 * route rather than a detail. The Bible's one substantive rule about stock
 * (chapter 05, « Réservation et confirmation ») is that « le stock affiché par
 * une API n'est pas une garantie absolue. Le système doit enregistrer la date
 * de consultation ». A quantity without the moment it was read cannot be shown
 * honestly, so `at` travels with every page and the shop stores it per article.
 *
 * SUBREQUEST BUDGET: one `cache.match`, one upstream `fetch` on a miss, one
 * `cache.put` in `waitUntil`. Three, against a ceiling of fifty, whatever the
 * page asked for: the parse happens once per cache miss and every page after
 * that is a slice of memory.
 */
async function loadStockAll(
  origin: string,
  env: FalkRossEnv,
  ctx: ExecutionContext,
): Promise<{ at: string; rows: [string, number, number, number][] }> {
  return cachedJson(origin, 'stock:all', TTL.stock, ctx, async () => {
    const csv = await fetchText(
      `${WS}/webservice/R03_000/stockinfo/product/_________?format=csv`,
      { auth: true, env },
    )
    throwIfErrorDoc(csv)
    const lines = csv.split(/\r?\n/)
    const at = (lines[0] ?? '').trim()
    const rows: [string, number, number, number][] = []
    for (const line of lines.slice(1)) {
      const [sku, g, y, b] = line.split(';')
      if (!sku || !/^\d{6,}$/.test(sku)) continue
      rows.push([sku, parseInt(g, 10) || 0, parseInt(y, 10) || 0, parseInt(b, 10) || 0])
    }
    /*
     * A SNAPSHOT WITH NO ROWS IS NOT A SNAPSHOT OF AN EMPTY WAREHOUSE.
     *
     * The upstream CGI answers HTTP 200 with a timestamp and nothing else when
     * it is rebuilding, and a sweep that believed it would write zero onto
     * every article in the shop, which reads on a product page as « rupture »
     * on the entire catalogue. Refusing costs one stale hour; believing it
     * costs a day of sales.
     */
    if (rows.length === 0) {
      throw new FrError('parse', 502, 'Falk&Ross returned a stock snapshot with no rows.')
    }
    return { at, rows }
  })
}

export interface FrWsState {
  /** 'test': orders are simulated. 'live': orders are REAL. */
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
// One style, everything the importer needs, in one invocation
// ---------------------------------------------------------------------------

/**
 * Everything WordPress needs to write ONE style into the shop.
 *
 * WHY IT IS ONE PAYLOAD AND NOT THREE CALLS. The catalogue importer runs on
 * shared hosting and walks ~460 styles; asking for detail, prices and stock
 * separately is 1380 HTTPS round trips from o2switch to here, for work that
 * costs the same upstream either way (all three sit behind `cachedJson`).
 * Folded together it is 460. Worst case per invocation is twelve subrequests,
 * index 3, style 3, prices 3, stock 3, against a free-plan ceiling of 50, so
 * this cannot repeat the budget failure the browse path had.
 *
 * PRICES AND STOCK ARE NULLABLE, AND THE REASON TRAVELS WITH THEM. A style the
 * supplier publishes no price for and a style we could not ask about are
 * different facts, and the importer must treat them differently: the first is
 * "not sellable", the second is "come back later, change nothing". Collapsing
 * them into a bare null is how a network blip empties a shop. So the section is
 * null and `pricesError` / `stockError` say which it was.
 *
 * The style itself is NOT nullable: without it there is nothing to import, so
 * its failure is the route's failure and the caller gets the real status.
 */
export interface FrCatalogueEntry {
  style: FrStyle
  prices: FrPrices | null
  pricesError: FrErrorCode | null
  stock: FrStock | null
  stockError: FrErrorCode | null
}

/**
 * The photo prefix this route emits, and why it is not `/api/fr/img/`.
 *
 * These URLs are the only part of the payload that ends up in a customer's
 * page: WordPress stores the per-colour photo on the variation and the shop
 * renders it. `/api/fr/` is on `scripts/php-guard.mjs`'s forbidden list because
 * it names who we buy from, and a rule that the plugin's source obeys while its
 * database quietly publishes the same string is a rule we are pretending to
 * follow. `PHOTO_ALIAS` is the same bytes from the same handler under a name
 * that says nothing about the supplier.
 *
 * `/api/fr/img/` stays exactly where it was: the studio's catalogue modal has
 * used it since July and this is not the session to move it.
 */
const PHOTO_ALIAS = '/media/blank/'

/** Rewrite every proxied photo URL in a payload onto the neutral prefix. */
const alias = (url: string): string =>
  url.startsWith('/api/fr/img/') ? PHOTO_ALIAS + url.slice('/api/fr/img/'.length) : url

/**
 * The maker's size-spec PDF, put behind the same neutral prefix.
 *
 * It arrives as an absolute URL on the supplier's own host, and WordPress
 * stores it on the product. Left as it came, the supplier's domain would sit in
 * the shop's database waiting for the first template that decides to link "le
 * guide des tailles du fabricant", and that link names who we buy from on a
 * customer's page. An unrecognised URL becomes '' rather than being passed
 * through: a half-anonymised field is worse than an absent one, because it
 * looks safe.
 */
function aliasSizespec(url: string): string {
  const m = /\/ws\/(sizespecs)\/([A-Za-z0-9._-]{1,128})$/.exec(url)
  return m ? `${PHOTO_ALIAS}${m[1]}/${m[2]}` : ''
}

function aliasPhotos(style: FrStyle): FrStyle {
  return {
    ...style,
    front: alias(style.front),
    back: alias(style.back),
    sizespecPdf: aliasSizespec(style.sizespecPdf),
    colourways: style.colourways.map((c) => ({
      ...c,
      swatch: alias(c.swatch),
      photo: alias(c.photo),
    })),
  }
}

async function loadCatalogueEntry(
  origin: string,
  env: FalkRossEnv,
  ctx: ExecutionContext,
  version: string,
  nr: string,
): Promise<FrCatalogueEntry> {
  const style = await loadStyle(origin, ctx, version, nr)

  // Settled, not `all`: a stock outage must not cost us the prices we did get.
  const [priceRes, stockRes] = await Promise.allSettled([
    loadPrices(origin, env, ctx, nr),
    loadStock(origin, env, ctx, nr),
  ])

  const why = (r: PromiseRejectedResult): FrErrorCode =>
    r.reason instanceof FrError ? r.reason.code : 'upstream'

  return {
    style: aliasPhotos(style),
    prices: priceRes.status === 'fulfilled' ? priceRes.value : null,
    pricesError: priceRes.status === 'rejected' ? why(priceRes) : null,
    stock: stockRes.status === 'fulfilled' ? stockRes.value : null,
    stockError: stockRes.status === 'rejected' ? why(stockRes) : null,
  }
}

// ---------------------------------------------------------------------------
// Order placement
//
// ── WHY THIS ROUTE EXISTS AGAIN, AND WHAT IS DIFFERENT ──────────────────────
//
// `POST /api/fr/order` was DELETED on 2026-08-12 because it was an
// UNAUTHENTICATED public route that placed a real purchase order on our
// account. It is back on 2026-08-19 as a decision, not as a restoration, and
// the difference is five properties rather than one:
//
//   1. It is behind `requireAdmin` like every other route in this file, and the
//      gate sits at the TOP of `handleFalkRoss`, so it is protected by
//      construction rather than by remembering.
//   2. The customer number comes from `FR_CUSTOMER_NR` ONLY. The old code fell
//      back to the leading digits of the webservice login and reported that it
//      had; a guessed number that decides which account is billed is exactly
//      what this project forbids, and "it reported it" only helps somebody who
//      reads the field. Unset means 503, and nothing leaves.
//   3. The caller must STATE the account mode it believes it is ordering in.
//      The shop shows an operator « compte fournisseur : test » and the human
//      confirms against that word; if the account has been switched to live in
//      between, the belief and the reality differ and the order is refused
//      before it is built. A mode read after the fact would have told us what
//      we had already done.
//   4. Every order carries an idempotency key, which is ALSO sent as the
//      supplier's `order_reference`. There is no way to ask this webservice
//      whether an order already exists (VERIFIED 2026-08-19: `GET
//      /webservice/R02_000/order` answers `<response>0</response>` and there is
//      no `get_orders` action), so the key's job is to make a duplicate
//      recognisable by a human on the supplier's own screen. It cannot prevent
//      one here, and this file does not pretend to: see `outcome` below.
//   5. A lost response is its own answer. `outcome: 'unknown'` means the
//      document may or may not have been received, and the shop records that
//      and refuses to retry blind. Conflating it with a failure is how a
//      delivery arrives twice.
//
// It still encodes two response envelopes verified live against the real
// account, one of which contradicts the supplier's own PDF (see `placeOrder`).
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
  /**
   * Our own key for this purchase, 8 to 32 characters of `[A-Za-z0-9._-]`.
   *
   * It travels as the supplier's `order_reference`, which is capped at 32 by
   * them, so the cap here is theirs and not a choice. It is REQUIRED: an order
   * with no key is an order nobody can recognise twice.
   */
  idempotencyKey: string
  note?: string
  partialShipment?: boolean
  lines: FrOrderLine[]
  /** Omit to ship to the account's registered address. */
  deliveryAddress?: FrOrderAddress
}

/** What the caller believed the account was, before it asked to spend money. */
export type FrExpectedMode = 'test' | 'live'

export interface FrOrderResult {
  /** True only for an order the supplier accepted and gave an id to. */
  ok: boolean
  /**
   * FOUR OUTCOMES, BECAUSE THREE COLLAPSED TWO DIFFERENT FACTS.
   *
   *  - `accepted`: the supplier created an order, named it, and took every line.
   *  - `partial`:  he created it and REFUSED SOME LINES. The run is short by
   *    exactly those articles, and the shop is about to press a job it does not
   *    have the blanks for. This used to report as `accepted` and the per-line
   *    refusals were stored and then hidden by the screen.
   *  - `rejected`: he refused the whole thing and said why. Nothing exists.
   *  - `unknown`:  the request left and no usable answer came back, or the
   *    answer names an order AND a global error, which we cannot read. It may
   *    have been created. Never retry on this; a human has to look.
   */
  outcome: 'accepted' | 'partial' | 'rejected' | 'unknown'
  /** Supplier order id. "0" means the order was REJECTED. */
  orderId: string
  errorCode: string
  message: string
  lines: { sku: string; errorCode: string; message: string }[]
  /** The webservice mode this order was placed in. See `loadState`. */
  mode: FrWsState
  /** Echoed so the caller can pin the answer to the act without matching by time. */
  idempotencyKey: string
}

/**
 * CDATA cannot nest or contain its own terminator, so a payload containing
 * `]]>` is split across two sections: the standard, and only, escape.
 */
const cdata = (v: string) => `<![CDATA[${String(v).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`

/** `2026-07-31 12:00:00` in the supplier's expected shape (UTC). */
function stamp(now: Date): string {
  return now.toISOString().slice(0, 19).replace('T', ' ')
}

/** Our key, as the supplier will store and display it. */
export const FR_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{7,31}$/

/** A Falk&Ross article number. Nine digits, no exceptions seen in 26 399. */
const FR_SKU_RE = /^\d{9}$/

/**
 * Lines one order may carry.
 *
 * Not a supplier limit (they publish none) and not a guess about their
 * gateway: a bound on a body this Worker will build, because an admin route
 * that will assemble a document of any size is a way to spend our CPU and
 * their patience. Two hundred distinct articles is already a purchase nobody
 * on this shop has made; the biggest realistic basket is one style's full size
 * run in a handful of colours, which is tens.
 */
const MAX_ORDER_LINES = 200

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
    // OUR IDEMPOTENCY KEY IS "YOUR REFERENCE". The supplier caps it at 32
    // characters and shows it back on their own order screen, which is the only
    // place a duplicate can be recognised at all: this webservice has no route
    // that lists orders (VERIFIED 2026-08-19).
    `<order_reference><or_value>${cdata(input.idempotencyKey.slice(0, 32))}</or_value></order_reference>` +
    `<order_note><on_value>${cdata(input.note ?? '')}</on_value></order_note>` +
    `<delivery_address>${address}</delivery_address>` +
    `<product_list>${products}</product_list>` +
    `</order>`
  )
}

/** Everything `placeOrder` checks before it is willing to build a document. */
function validateOrder(input: FrOrderInput): void {
  if (!FR_KEY_RE.test(String(input.idempotencyKey ?? ''))) {
    throw new FrError(
      'bad_request',
      400,
      'An order needs an idempotency key of 8 to 32 characters ([A-Za-z0-9._-]).',
    )
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new FrError('bad_request', 400, 'An order needs at least one line.')
  }
  if (input.lines.length > MAX_ORDER_LINES) {
    throw new FrError('bad_request', 400, `An order may not carry more than ${MAX_ORDER_LINES} lines.`)
  }
  const seen = new Set<string>()
  for (const l of input.lines) {
    if (!FR_SKU_RE.test(String(l.sku))) {
      throw new FrError('bad_request', 400, `Not a 9-digit Falk&Ross SKU: ${l.sku}`)
    }
    /*
     * TWO LINES FOR ONE ARTICLE IS AN ARITHMETIC ACCIDENT, NOT AN ORDER.
     * The supplier's echo is per article, so a document naming 180010004 twice
     * comes back with one status for two of our lines and the reconciliation
     * cannot say which quantity was accepted. The caller merges; this refuses.
     */
    if (seen.has(l.sku)) {
      throw new FrError('bad_request', 400, `SKU ${l.sku} appears on two lines; merge them.`)
    }
    seen.add(l.sku)
    if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > 100000) {
      throw new FrError('bad_request', 400, `Bad quantity for SKU ${l.sku}.`)
    }
  }
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
 *    nested in `<item><p_err>30</p_err><msg>Artno not found</msg></item>`,
 *    NOT the `<p_err>/<p_err_msg>` pair the PDF documents (VERIFIED live).
 * Both are parsed, so a caller never has to guess which one it got.
 *
 * NOTHING IS RETRIED HERE, at any level. `Supply::get()` on the shop retries an
 * idempotent GET once; this is the one call in the project where a second
 * attempt can produce a second delivery, and the first attempt's silence is not
 * evidence that it did not arrive.
 */
async function placeOrder(
  origin: string,
  env: FalkRossEnv,
  ctx: ExecutionContext,
  input: FrOrderInput,
  expectMode: FrExpectedMode,
  now: Date,
): Promise<FrOrderResult> {
  validateOrder(input)

  const customerNumber = env.FR_CUSTOMER_NR ?? ''
  if (!customerNumber) {
    throw new FrError(
      'config',
      503,
      'No Falk&Ross customer number. Set it with: wrangler secret put FR_CUSTOMER_NR',
    )
  }

  /*
   * READ THE MODE FIRST, AND REFUSE ON A DISAGREEMENT.
   *
   * `loadState` is cached for two minutes (TTL.state), which is short precisely
   * because this is what it gates. The comparison is the point: the shop wrote
   * « compte fournisseur : test » on the screen a human confirmed against, and
   * an account that has been switched to live since then must not be able to
   * turn that confirmation into a real purchase.
   */
  /*
   * A FAILURE HERE HAPPENS BEFORE ANYTHING IS SENT, and must not reach the shop
   * as the same 502 a lost answer produces. `loadState` throws `upstream` on a
   * timeout, the route's catch turns that into HTTP 502, and the shop's only
   * reading of a 502 is « the document may have gone out »: a purchase would
   * have gone to « envoi incertain », which is terminal, over a supplier who was
   * merely slow to say what mode the account is in.
   */
  let mode: FrWsState
  try {
    mode = await loadState(origin, env, ctx)
  } catch (err) {
    if (err instanceof FrError && (err.code === 'config' || err.code === 'auth')) throw err
    throw new FrError(
      'bad_request',
      409,
      'Could not read the account mode, so nothing was sent. Try again.',
    )
  }
  if (mode.mode !== expectMode) {
    throw new FrError(
      'bad_request',
      409,
      `The account is in ${mode.mode} mode and the caller expected ${expectMode}. Nothing was sent.`,
    )
  }

  const body = buildOrderXml(input, customerNumber, now)

  const unknown = (why: string): FrOrderResult => ({
    ok: false,
    outcome: 'unknown',
    orderId: '',
    errorCode: '',
    message: why,
    lines: [],
    mode,
    idempotencyKey: input.idempotencyKey,
  })

  // The supplier's own reference implementation posts the raw XML under a form
  // content-type; their gateway rejects application/xml. Mirrored.
  let res: Response
  try {
    res = await fetchUpstream(`${WS}/webservice/R02_000/order?format=xml`, {
      auth: true,
      env,
      method: 'POST',
      body,
      contentType: 'application/x-www-form-urlencoded',
      // The gateway's own rejection envelope. Without this it was unreachable:
      // see FetchOpts.allowStatus.
      allowStatus: [400],
    })
  } catch (err) {
    /*
     * A CONFIG OR AUTH FAILURE HAPPENS BEFORE ANYTHING IS SENT and is a plain
     * failure. Everything else here is a timeout or a transport error AFTER the
     * document went out, which is the ambiguous case this function exists to
     * name rather than swallow.
     */
    if (err instanceof FrError && (err.code === 'config' || err.code === 'auth')) throw err
    return unknown(
      'Falk&Ross did not answer. The order may or may not have been created; check the supplier before sending it again.',
    )
  }

  const xml = await res.text().catch(() => '')
  if (!xml) return unknown('Falk&Ross answered with an empty body.')

  const gatewayError = elementInner(xml, 'error')
  if (gatewayError) {
    return {
      ok: false,
      outcome: 'rejected',
      orderId: '0',
      errorCode: elementText(gatewayError, 'code') || '400',
      message: elementText(gatewayError, 'message') || 'Rejected by Falk&Ross.',
      lines: [],
      mode,
      idempotencyKey: input.idempotencyKey,
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

  /*
   * AN ANSWER WITH NEITHER AN ORDER ID NOR AN ERROR IS NOT A REFUSAL.
   *
   * `<orders_id>0</orders_id>` with an `<err>` is the supplier saying no. A
   * document we cannot find either field in is a document we did not
   * understand, and reading it as "rejected" would tell an operator that
   * nothing was created on the strength of not knowing.
   */
  if (!orderId && !errorCode && lines.length === 0) {
    return unknown('Falk&Ross answered in a shape this Worker does not recognise.')
  }

  /*
   * AN ORDER ID IS THE EVIDENCE THAT SOMETHING EXISTS, and it outranks every
   * other field. The first version read `orders_id 4412345` beside an error code
   * as `rejected`, and `Purchase::send` unpins the orders of a rejected purchase
   * so they can be bought again: an order the supplier had created would have
   * been created a second time. `rejected` is now reserved for the two shapes
   * actually verified against the account, `orders_id 0` and the gateway's own
   * `<error>` envelope.
   */
  const created = !!orderId && orderId !== '0'
  const globalError = !!errorCode && errorCode !== '0'
  const outcome: FrOrderResult['outcome'] = !created
    ? 'rejected'
    : lines.length > 0
      ? 'partial'
      : globalError
        ? 'unknown'
        : 'accepted'
  return {
    ok: outcome === 'accepted',
    outcome,
    orderId,
    errorCode,
    message: elementText(xml, 'err_msg') || lines[0]?.message || '',
    lines,
    mode,
    idempotencyKey: input.idempotencyKey,
  }
}

// ---------------------------------------------------------------------------
// Image proxy
// ---------------------------------------------------------------------------

/**
 * Supplier photo, same-origin. Anything outside `ws/picture/` and `ws/picto/`
 * is refused so this cannot be turned into an open proxy for the rest of the
 * internet: the path is validated, never merely concatenated.
 */
async function serveImage(kind: string, file: string): Promise<Response> {
  // `sizespecs` is the maker's own size table, a PDF. It joins the two photo
  // directories here rather than getting its own handler because the rule is
  // identical: an allow-list of upstream directories, a validated file name,
  // and no credentials. Widening the list is a visible decision; concatenating
  // a path is how a proxy becomes an open one.
  if (!ALLOWED_MEDIA.has(kind) || !/^[A-Za-z0-9._-]{1,128}$/.test(file)) {
    return new Response('not found', { status: 404 })
  }
  const upstream = await fetchUpstream(`${DOWNLOAD}/ws/${kind}/${file}`, { cacheTtl: TTL.image })
  const headers = new Headers()
  // The fallback follows the DIRECTORY, not the majority case. Serving a size
  // chart as image/jpeg because that is what photos are makes the browser
  // download a file it will not open, and the operator sees a broken link
  // rather than a wrong header.
  const fallback = kind === 'sizespecs' ? 'application/pdf' : 'image/jpeg'
  headers.set('content-type', upstream.headers.get('content-type') ?? fallback)
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

/**
 * `private`, not `public`: every route that passes a maxAge now sits behind the
 * admin gate, and an authenticated response carrying our purchase costs must
 * never be storable by a shared cache. The browser's own cache is still
 * allowed, which is all these TTLs were ever for. `vary: authorization` keeps a
 * rotated token from reading the previous holder's cached copy.
 *
 * This does NOT govern `serveImage` (still `public, immutable`: public
 * supplier photos) nor the server-side memoisation in `cachedJson`.
 */
function json(body: unknown, status = 200, maxAge = 0): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': maxAge > 0 ? `private, max-age=${maxAge}` : 'no-store',
      vary: 'authorization',
    },
  })
}

/**
 * The second gate, and the only route that has one.
 *
 * BEARER ONLY, and not the Basic form `requireAdmin` also accepts. That form
 * exists so a browser's own login box can open `/admin.html`, and no browser is
 * a legitimate caller here: an operator who has authenticated to the admin page
 * carries a credential their browser will replay on any URL under this origin,
 * so a page on another site could have made their browser place a purchase
 * order. A header nothing replays automatically closes that.
 *
 * Compared the same way `worker/auth.ts` compares its own: SHA-256 first,
 * because `timingSafeEqual` throws on unequal lengths, which would both crash
 * the request and leak the expected length.
 */
async function orderTokenOk(request: Request, env: FalkRossEnv): Promise<boolean> {
  /*
   * BEARER ONLY. `requireAdmin` also accepts `Basic base64(anything:token)`, so
   * that a browser's own login box can open `/admin.html`; a browser that has
   * done that replays the credential on every request to this origin, including
   * one a page on another site caused. The custom header below already blocks
   * that (a cross-origin fetch carrying it needs a preflight, and this route
   * answers no CORS), but a route that spends money should not rest its safety
   * on a second mechanism when refusing the browser form costs one line.
   */
  if (!(request.headers.get('authorization') ?? '').startsWith('Bearer ')) return false
  const expected = env.FR_ORDER_TOKEN ?? ''
  if (expected.length < 24) return false
  const presented = request.headers.get('x-teeshoop-order-token') ?? ''
  if (presented.length === 0) return false
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(presented)),
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(expected)),
  ])
  return crypto.subtle.timingSafeEqual(new Uint8Array(a), new Uint8Array(b))
}

const clampInt = (v: string | null, def: number, min: number, max: number) => {
  const n = parseInt(v ?? '', 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def
}

/**
 * `/api/fr/*`, the whole Falk&Ross surface. Returns null when the path is not
 * ours, so the caller can fall through to the rest of the Worker.
 *
 * ADMIN-ONLY. Every route below requires `Authorization: Bearer <ADMIN_TOKEN>`
 * (worker/auth.ts): they return our purchase cost, our supplier stock and the
 * supplier catalogue, none of which is a customer surface. Unauthenticated
 * callers get 401 `{error:'admin_auth'}`, and with ADMIN_TOKEN unset the gate
 * denies everything. The photo proxy is the single exemption; see the gate.
 *
 * Routes:
 *   GET  /api/fr/state                      webservice mode (test vs live)
 *   GET  /api/fr/styles?q&kind&offset&limit  paged, server-side-filtered cards
 *   GET  /api/fr/style/{styleNr}            one style, full detail
 *   GET  /api/fr/catalogue/{styleNr}        detail + prices + stock, one call
 *   GET  /api/fr/price/{styleNr}            purchase prices per SKU
 *   GET  /api/fr/stock/{styleNr}            stock per SKU
 *   GET  /api/fr/stock?offset&limit         EVERY SKU's stock, paged, one call
 *   GET  /api/fr/deliveries/{styleNr?}      announced restocks
 *   POST /api/fr/order                      place a supplier order. ADMIN_TOKEN
 *                                           **and** FR_ORDER_TOKEN (see below)
 *   GET  /api/fr/img/{picture|picto}/{file} photo proxy (ungated, see below)
 *   GET  /media/blank/{picture|picto}/{file} the same photos, supplier-neutral
 *                                           prefix, for URLs the shop stores
 */
export async function handleFalkRoss(
  request: Request,
  env: FalkRossEnv,
  ctx: ExecutionContext,
): Promise<Response | null> {
  const url = new URL(request.url)
  const path = url.pathname

  /*
   * The neutral photo alias, handled before anything else.
   *
   * Same handler, same bytes, same lack of credentials as `/api/fr/img/*`; the
   * only difference is a prefix that does not name the supplier, because these
   * URLs are the ones that end up in the shop's database and on a customer's
   * page. It is ungated for the same forced reason the original is: an
   * `<img src>` cannot send an Authorization header.
   */
  if (path.startsWith(PHOTO_ALIAS)) {
    const m = /^([a-z]+)\/(.+)$/.exec(path.slice(PHOTO_ALIAS.length))
    if (!m || (request.method !== 'GET' && request.method !== 'HEAD')) {
      return new Response('not found', { status: 404 })
    }
    /*
     * Caught HERE, because this branch sits before the try that wraps the rest
     * of the module (it has to: it is the one route outside the admin gate).
     * `serveImage` reaches `fetchUpstream`, which THROWS on a 404, on a non-2xx
     * and on the 10 s timeout, so a photo the supplier has withdrawn would
     * escape `fetch()` and Cloudflare would answer its own 500 "Worker threw
     * exception" page. In an `<img src>` on a shop that is a broken picture
     * plus a 500 in the logs, where 404 is both true and cheap.
     */
    try {
      return await serveImage(m[1], m[2])
    } catch {
      return new Response('not found', { status: 404 })
    }
  }

  if (!path.startsWith('/api/fr/')) return null
  const rest = path.slice('/api/fr/'.length)
  const origin = url.origin
  const method = request.method

  // AUTH: deny by default. Every /api/fr/* route is admin-only (purchase
  // prices, stock, the catalogue itself), so the gate sits at the TOP: a route
  // added below is protected by construction, not by remembering to protect it.
  // It is also OUTSIDE the try, so the catch-all cannot remap a 401 to a 502.
  //
  // ONE exemption, and it is forced rather than chosen: the photo proxy is
  // rendered by <img src> (CatalogModal), which cannot send an Authorization
  // header, and `serveImage` fetches those files upstream with NO credentials,
  // i.e. they are public supplier photos, not a secret.
  if (!rest.startsWith('img/')) {
    const denied = await requireAdmin(request, env)
    if (denied) return denied
  }

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

    // The catalogue importer's single read. `no-store`, unlike the routes
    // above: it carries stock, whose whole value is being current, and there is
    // exactly one caller (a cron on the shop) with nothing to gain from a
    // browser cache.
    const entry = /^catalogue\/(\d{4,6})$/.exec(rest)
    if (entry && method === 'GET') {
      const index = await styleIndex(origin, ctx)
      return json(await loadCatalogueEntry(origin, env, ctx, index.version, entry[1]))
    }

    const price = /^price\/(\d{4,6})$/.exec(rest)
    if (price && method === 'GET') {
      return json(await loadPrices(origin, env, ctx, price[1]), 200, 300)
    }

    const stock = /^stock\/(\d{4,6})$/.exec(rest)
    if (stock && method === 'GET') {
      return json(await loadStock(origin, env, ctx, stock[1]), 200, 60)
    }

    /*
     * The whole catalogue's stock, paged out of ONE upstream snapshot.
     *
     * `no-store`, like the catalogue route and unlike the per-style one: this
     * exists to be current, its caller is the shop's refresh sweep, and a
     * browser cache would be a second staleness nobody could see. The page cap
     * is 20 000 rows because the snapshot is ~46 600 and a shop on shared
     * hosting parsing a megabyte of JSON in one `wp_remote_get` is a memory
     * limit waiting for the day the catalogue grows.
     *
     * `at` IS PER PAGE, DELIBERATELY. A sweep takes several requests and the
     * five-minute cache can turn over between them, so pages can come from two
     * snapshots. The shop stores the freshness carried by the page that wrote
     * each article, which makes a mixed sweep exactly as honest as a clean one
     * instead of something to detect.
     */
    if (rest === 'stock' && method === 'GET') {
      const all = await loadStockAll(origin, env, ctx)
      const offset = clampInt(url.searchParams.get('offset'), 0, 0, 1_000_000)
      const limit = clampInt(url.searchParams.get('limit'), 5000, 1, 20000)
      const rows = all.rows.slice(offset, offset + limit)
      const next = offset + rows.length
      return json({
        at: all.at,
        total: all.rows.length,
        offset,
        count: rows.length,
        nextOffset: next < all.rows.length ? next : null,
        rows,
      })
    }

    const deliveries = /^deliveries(?:\/(\d{4,6}))?$/.exec(rest)
    if (deliveries && method === 'GET') {
      return json(await loadDeliveries(origin, env, ctx, deliveries[1] ?? ''), 200, 300)
    }

    /*
     * THE ONE ROUTE ON THIS WORKER THAT SPENDS MONEY.
     *
     * Admin-gated above with everything else. What it adds is the refusal to
     * act on a belief that has gone stale: `mode` is what the caller thinks the
     * account is, and `placeOrder` compares it with what the account actually
     * is before building a document. The human confirmation itself lives on the
     * shop, where the basket, the total and the operator are; a Worker cannot
     * confirm anything, and a route that pretended to would be a second,
     * weaker gate beside the real one.
     *
     * `dryRun` returns the exact document instead of sending it. It is how the
     * shop's tests and `scripts/fr-verify.mjs` exercise this path without
     * buying anything, and it is why nothing in the test suite needs a mock of
     * the supplier's gateway.
     */
    if (rest === 'order' && method === 'POST') {
      if (!(await orderTokenOk(request, env))) {
        /*
         * The same body whether the secret is unset or wrong, like `deny()` in
         * worker/auth.ts: a caller must not be able to tell a misconfigured
         * Worker from a wrong credential.
         */
        return json(
          {
            error: 'auth',
            message: 'This route needs its own token (X-Teeshoop-Order-Token).',
          },
          401,
        )
      }
      const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null
      if (!raw || typeof raw !== 'object') {
        throw new FrError('bad_request', 400, 'The order body must be a JSON object.')
      }
      const expect = raw.mode
      if (expect !== 'test' && expect !== 'live') {
        throw new FrError(
          'bad_request',
          400,
          'The order body must state the account mode it expects: "test" or "live".',
        )
      }
      const input: FrOrderInput = {
        idempotencyKey: String(raw.idempotencyKey ?? ''),
        note: typeof raw.note === 'string' ? raw.note : undefined,
        partialShipment: raw.partialShipment === true,
        lines: Array.isArray(raw.lines)
          ? (raw.lines as unknown[]).map((l) => {
              const row = (l ?? {}) as Record<string, unknown>
              return {
                sku: String(row.sku ?? ''),
                qty: Number(row.qty),
                lineRef: typeof row.lineRef === 'string' ? row.lineRef : undefined,
              }
            })
          : [],
      }

      if (raw.dryRun === true) {
        validateOrder(input)
        const customerNumber = env.FR_CUSTOMER_NR ?? ''
        if (!customerNumber) {
          throw new FrError(
            'config',
            503,
            'No Falk&Ross customer number. Set it with: wrangler secret put FR_CUSTOMER_NR',
          )
        }
        const state = await loadState(origin, env, ctx)
        return json({
          dryRun: true,
          mode: state,
          modeMatches: state.mode === expect,
          idempotencyKey: input.idempotencyKey,
          lines: input.lines.length,
          garments: input.lines.reduce((n, l) => n + l.qty, 0),
          xml: buildOrderXml(input, customerNumber, new Date()),
        })
      }

      return json(await placeOrder(origin, env, ctx, input, expect, new Date()))
    }

    return json({ error: 'not_found', message: `No Falk&Ross route ${rest}` }, 404)
  } catch (err) {
    if (err instanceof FrError) {
      return json({ error: err.code, message: err.message }, err.status)
    }
    return json({ error: 'upstream', message: 'Falk&Ross request failed.' }, 502)
  }
}
