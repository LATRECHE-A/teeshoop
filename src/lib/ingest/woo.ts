/**
 * INGEST: WooCommerce product fetcher.
 *
 * Talks to `{baseUrl}/wp-json/wc/v3/products` with HTTPS Basic auth
 * (consumer key : consumer secret). WooCommerce accepts Basic over HTTPS.
 *
 * CORS reality check: a browser fetch to a foreign WP site only works when
 * that site sends `Access-Control-Allow-Origin` for the studio origin (via a
 * CORS plugin / server config), or once the studio ships as a WP plugin and
 * becomes same-origin. A blocked request surfaces as a bare TypeError. We
 * catch it and return a typed `cors` error the UI must explain instead of a
 * generic failure.
 *
 * Credentials are NEVER hard-coded. The shop address and the consumer key
 * persist in localStorage['tshop:woo:cred']; the SECRET lives in
 * sessionStorage only, for the life of the tab (STU-20), and the UI says so
 * (see ingest.woo.local_notice).
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
  /** e.g. [{ name: 'Size', options: ['S','M','L'] }], shown as hints. */
  attributes: { name: string; options: string[] }[]
}

export type WooErrorKind =
  | 'cors' // fetch TypeError: CORS/network, the WP site must allow this origin
  | 'auth' // 401/403: bad consumer key/secret
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
const SECRET_KEY = 'tshop:woo:secret'

/*
 * THE SECRET IS NOT KEPT ON THE DEVICE (STU-20). A read-write WooCommerce key,
 * one that writes orders and customers, sat in clear in localStorage on the
 * Worker's origin, which also serves the public studio and the /v page anyone
 * opens: one injection or one compromised dependency on those pages read it,
 * for ever. The secret now lives for the life of the tab, and a secret written
 * by an older build is moved out of localStorage the first time this runs.
 */
export function loadWooCredentials(): WooCredentials | null {
  try {
    const raw = localStorage.getItem(CRED_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as Partial<WooCredentials>
    if (typeof c.baseUrl !== 'string' || typeof c.consumerKey !== 'string') return null
    if (typeof c.consumerSecret === 'string') {
      if (c.consumerSecret !== '') sessionStorage.setItem(SECRET_KEY, c.consumerSecret)
      localStorage.setItem(CRED_KEY, JSON.stringify({ baseUrl: c.baseUrl, consumerKey: c.consumerKey }))
    }
    const secret = sessionStorage.getItem(SECRET_KEY) ?? ''
    return { baseUrl: c.baseUrl, consumerKey: c.consumerKey, consumerSecret: secret }
  } catch {
    return null
  }
}

export function saveWooCredentials(cred: WooCredentials): void {
  try {
    localStorage.setItem(CRED_KEY, JSON.stringify({ baseUrl: cred.baseUrl, consumerKey: cred.consumerKey }))
    sessionStorage.setItem(SECRET_KEY, cred.consumerSecret)
  } catch {
    /* private mode: nothing kept, the fields are typed again */
  }
}

export function clearWooCredentials(): void {
  try {
    localStorage.removeItem(CRED_KEY)
    sessionStorage.removeItem(SECRET_KEY)
  } catch {
    /* ignore */
  }
}

/** Local WordPress dev stores: Basic over loopback never leaves the machine. */
const LOOPBACK_RE = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i

export function normalizeBaseUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`
  // A pasted http:// store would send the consumer key/secret in cleartext
  // (and WooCommerce refuses Basic without SSL anyway). Upgrade it.
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
    // fetch rejects with TypeError on CORS/network, indistinguishable in the
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
 * {kind:'http'} WooError-shaped objects: media files need CORS headers just
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
