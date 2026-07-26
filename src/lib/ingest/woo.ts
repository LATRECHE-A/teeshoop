/**
 * INGEST — WooCommerce product fetcher.
 *
 * Talks to `{baseUrl}/wp-json/wc/v3/products` with HTTPS Basic auth
 * (consumer key : consumer secret — WooCommerce accepts Basic over HTTPS).
 *
 * CORS reality check: a browser fetch to a foreign WP site only works when
 * that site sends `Access-Control-Allow-Origin` for the studio origin (via a
 * CORS plugin / server config), or once the studio ships as a WP plugin and
 * becomes same-origin. A blocked request surfaces as a bare TypeError — we
 * catch it and return a typed `cors` error the UI must explain instead of a
 * generic failure.
 *
 * Credentials are NEVER hard-coded; they persist in
 * localStorage['tshop:woo:cred'] only — i.e. stored locally on this device,
 * and the UI says so explicitly (see ingest.woo_local_notice).
 */

export interface WooCredentials {
  baseUrl: string
  consumerKey: string
  consumerSecret: string
}

/** Candidate import mapped from a WC REST product. */
export interface WooProductCandidate {
  id: number
  name: string
  sku: string
  /** Image URLs in WC order (first two feed the photo pipeline). */
  images: string[]
  /** e.g. [{ name: 'Size', options: ['S','M','L'] }] — shown as hints. */
  attributes: { name: string; options: string[] }[]
}

export type WooErrorKind =
  | 'cors' // fetch TypeError: CORS/network — the WP site must allow this origin
  | 'auth' // 401/403 — bad consumer key/secret
  | 'http' // any other non-2xx
  | 'parse' // 2xx but not the expected JSON shape

export interface WooError {
  kind: WooErrorKind
  status?: number
}

export type WooFetchResult =
  | { ok: true; products: WooProductCandidate[]; totalPages: number | null }
  | { ok: false; error: WooError }

const CRED_KEY = 'tshop:woo:cred'

export function loadWooCredentials(): WooCredentials | null {
  try {
    const raw = localStorage.getItem(CRED_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as Partial<WooCredentials>
    if (
      typeof c.baseUrl !== 'string' ||
      typeof c.consumerKey !== 'string' ||
      typeof c.consumerSecret !== 'string'
    )
      return null
    return { baseUrl: c.baseUrl, consumerKey: c.consumerKey, consumerSecret: c.consumerSecret }
  } catch {
    return null
  }
}

export function saveWooCredentials(cred: WooCredentials): void {
  try {
    localStorage.setItem(CRED_KEY, JSON.stringify(cred))
  } catch {
    /* private mode — session-only credentials */
  }
}

export function clearWooCredentials(): void {
  try {
    localStorage.removeItem(CRED_KEY)
  } catch {
    /* ignore */
  }
}

/** Local WordPress dev stores — Basic over loopback never leaves the machine. */
const LOOPBACK_RE = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i

function normalizeBaseUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`
  // A pasted http:// store would send the consumer key/secret in cleartext
  // (and WooCommerce refuses Basic without SSL anyway) — upgrade it.
  if (/^http:\/\//i.test(u) && !LOOPBACK_RE.test(u)) u = u.replace(/^http:/i, 'https:')
  return u
}

interface RawWooProduct {
  id?: unknown
  name?: unknown
  sku?: unknown
  images?: unknown
  attributes?: unknown
}

function mapProduct(raw: RawWooProduct): WooProductCandidate | null {
  if (typeof raw.id !== 'number' || typeof raw.name !== 'string') return null
  const images = Array.isArray(raw.images)
    ? raw.images
        .map((i) => (typeof (i as { src?: unknown }).src === 'string' ? (i as { src: string }).src : ''))
        .filter(Boolean)
    : []
  const attributes = Array.isArray(raw.attributes)
    ? raw.attributes.flatMap((a) => {
        const at = a as { name?: unknown; options?: unknown }
        if (typeof at.name !== 'string' || !Array.isArray(at.options)) return []
        return [{ name: at.name, options: at.options.filter((o): o is string => typeof o === 'string') }]
      })
    : []
  return {
    id: raw.id,
    name: raw.name,
    sku: typeof raw.sku === 'string' ? raw.sku : '',
    images,
    attributes,
  }
}

/** List products (10 per page) from a WooCommerce store. Never throws. */
export async function fetchWooProducts(
  opts: WooCredentials & { page?: number; perPage?: number },
): Promise<WooFetchResult> {
  const base = normalizeBaseUrl(opts.baseUrl)
  const url =
    `${base}/wp-json/wc/v3/products?per_page=${opts.perPage ?? 10}` +
    `&page=${opts.page ?? 1}&status=publish`
  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Basic ${btoa(`${opts.consumerKey}:${opts.consumerSecret}`)}`,
      },
    })
  } catch {
    // fetch rejects with TypeError on CORS/network — indistinguishable in the
    // browser, and CORS is by far the common cause for a foreign WP site.
    return { ok: false, error: { kind: 'cors' } }
  }
  if (res.status === 401 || res.status === 403)
    return { ok: false, error: { kind: 'auth', status: res.status } }
  if (!res.ok) return { ok: false, error: { kind: 'http', status: res.status } }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    return { ok: false, error: { kind: 'parse' } }
  }
  if (!Array.isArray(body)) return { ok: false, error: { kind: 'parse' } }
  const totalPagesHeader = res.headers.get('X-WP-TotalPages')
  return {
    ok: true,
    products: body
      .map((raw) => mapProduct(raw as RawWooProduct))
      .filter((p): p is WooProductCandidate => p !== null),
    totalPages: totalPagesHeader ? Number(totalPagesHeader) || null : null,
  }
}

/**
 * Download a product image for the photo pipeline. Throws {kind:'cors'} /
 * {kind:'http'} WooError-shaped objects — media files need CORS headers just
 * like the REST API.
 */
export async function fetchWooImage(url: string): Promise<Blob> {
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    throw { kind: 'cors' } satisfies WooError
  }
  if (!res.ok) throw { kind: 'http', status: res.status } satisfies WooError
  return res.blob()
}
