/**
 * The studio's end of the WordPress bridge.
 *
 * The studio runs cross-origin in an iframe on a WooCommerce product page. It
 * cannot read WordPress cookies, so it cannot call the REST API and it cannot
 * hold the nonce. Everything payable is asked for by message: the frame asks,
 * the parent page acts, and the nonce never crosses the boundary.
 * `wp-plugins/teeshoop-core/assets/bridge.js` is the other half, and its README
 * is the contract this file implements.
 *
 * ON THE WAY OUT, `postMessage` is given an explicit target origin, never '*'.
 * That single argument is also the strongest inbound guarantee we have: the
 * browser DROPS the message if the parent is not that origin, so a message
 * addressed to `https://teeshoop.com` cannot be read by anything else, whatever
 * the frame is embedded in. It is what makes the handshake below safe.
 *
 * ON THE WAY IN, all three of the parent's own checks, mirrored:
 *   1. `event.origin` must equal an allowed origin, compared with `===` (a Set
 *      lookup is an exact match). NEVER a prefix test: `startsWith` passes for
 *      `https://teeshoop.com.evil.tld`. Once the handshake has settled the
 *      comparison narrows further, to the one origin that answered.
 *   2. `event.source` must be `window.parent`, or a sibling frame or an
 *      opener can speak in the shop's name.
 *   3. the payload must be an object with a known string `type`.
 *
 * HOW THE PARENT ORIGIN IS DECIDED, and why it is not guessed. The studio is
 * one static bundle serving every deployment, so it cannot be built knowing
 * which page framed it. It does not need to: it posts `teeshoop:ready` to every
 * origin on its ALLOW-LIST, and the browser delivers it only to the one that
 * actually matches. Whichever origin answers with `teeshoop:context` is the
 * parent, and the client locks onto it for the rest of the session. No
 * `document.referrer`, no query parameter, nothing the framing page can assert
 * about itself. The list is the only trust anchor, and it is closed by default:
 * with no allowed origin configured the bridge does not run at all.
 *
 * WHAT IS NEVER SENT: a price. The studio displays what the server tells it. It
 * sends what the customer chose (garment, quantity, printed sides and their
 * ink area in cm²) and WordPress decides what that costs.
 */

/** One printed side, in the unit the PHP price authority reads. cm², never in². */
export interface BridgeSide {
  id: string
  area_sq_cm: number
}

/** What the shop page tells us about the product we are decorating. */
export interface ShopContext {
  productId: number
  garment: string
  locale: string
}

/**
 * A quote, as `Rest::quote()` returns it. Cents are authoritative; the `_eur`
 * floats and `display` strings exist so no client ever divides by 100 or
 * invents a rounding of its own.
 */
export interface ShopQuote {
  currency: string
  garment: string
  qty: number
  sides: number
  vat_rate: number
  discount_rate: number
  unit_ht: number
  unit_ttc: number
  total_ht: number
  total_vat: number
  total_ttc: number
  unit_ht_eur: number
  unit_ttc_eur: number
  total_ht_eur: number
  total_vat_eur: number
  total_ttc_eur: number
  display: { unit_ht: string; total_ht: string; total_ttc: string }
}

/** What the parent reports after `POST /wp-json/teeshoop/v1/cart`. */
export interface CartOutcome {
  cartCount: number
  cartUrl: string
  message: string
}

export interface AddToCartInput {
  garment: string
  qty: number
  sides: BridgeSide[]
  designId: string
  sizeGrid?: Record<string, number>
}

/**
 * `standalone`  : not framed, or no shop origin is configured. The studio works
 *                 exactly as it always has; nothing here runs.
 * `connecting`  : framed, handshake in flight.
 * `connected`   : the shop answered. Buying is possible.
 * `unavailable` : framed, but nothing on the allow-list answered in time. The
 *                 studio falls back to its standalone behaviour rather than
 *                 offering a basket it cannot reach.
 */
export type BridgeStatus = 'standalone' | 'connecting' | 'connected' | 'unavailable'

/**
 * The shop origins this build is allowed to talk to.
 *
 * A SECURITY PARAMETER, and the mirror of the plugin's `studio_origin`. Set
 * `VITE_TEESHOOP_SHOP_ORIGINS` at build time (comma-separated) to replace the
 * list; the local WordPress mirror in `wp-local/` is not in the default,
 * because a development host has no business being trusted by a production
 * bundle. An empty list means the bridge never runs.
 */
const DEFAULT_SHOP_ORIGINS = 'https://teeshoop.com,https://www.teeshoop.com'

/** Origins are compared as whole strings, so they are normalised to one form. */
function parseOrigins(raw: string): string[] {
  const out: string[] = []
  for (const part of raw.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    let url: URL
    try {
      url = new URL(trimmed)
    } catch {
      continue
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue
    // `URL.origin` drops any path, trailing slash, credentials and default
    // port. That is the exact shape `event.origin` arrives in, and the reason the
    // plugin normalises its own setting the same way (Settings::studio_origin).
    if (!out.includes(url.origin)) out.push(url.origin)
  }
  return out
}

function configuredOrigins(): string[] {
  const raw = import.meta.env.VITE_TEESHOOP_SHOP_ORIGINS
  return parseOrigins(typeof raw === 'string' && raw.trim() !== '' ? raw : DEFAULT_SHOP_ORIGINS)
}

/**
 * Handshake attempts, milliseconds after start.
 *
 * `bridge.js` is enqueued in the page footer and the frame is `loading="lazy"`,
 * so the listener is almost always attached first, but "almost always" is not
 * a protocol. The retries cost four postMessages to close that window; after
 * the last one the shop is declared unreachable rather than spinning forever.
 */
const HANDSHAKE_RETRY_MS = [120, 400, 1000, 2200]
const HANDSHAKE_GIVE_UP_MS = 3200

/** A request the shop does not answer is a failure, not a wait. */
const REQUEST_TIMEOUT_MS = 20000

type Pending = {
  kind: 'quote' | 'cart'
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let status: BridgeStatus = 'standalone'
let context: ShopContext | null = null
let allowed: string[] = []
/** The one origin that answered. Every later comparison is against this. */
let parentOrigin: string | null = null
let started = false
let seq = 0
const sessionTag = Math.random().toString(36).slice(2, 8)
const pending = new Map<string, Pending>()
const listeners = new Set<() => void>()
const handshakeTimers: ReturnType<typeof setTimeout>[] = []

function notify(): void {
  for (const fn of listeners) fn()
}

function setStatus(next: BridgeStatus): void {
  if (status === next) return
  status = next
  notify()
}

/** Said once, in the console, so a misconfigured embed is diagnosable. */
let explained = false
function explain(message: string): void {
  if (explained) return
  explained = true
  // eslint-disable-next-line no-console
  console.info('[teeshoop] ' + message)
}

export function bridgeStatus(): BridgeStatus {
  return status
}

export function shopContext(): ShopContext | null {
  return context
}

/** True when the protocol is up: the shop answered and we know its origin. */
export function isShopConnected(): boolean {
  return status === 'connected' && parentOrigin !== null
}

/**
 * True when an add-to-cart can actually produce a cart line.
 *
 * Connected is not enough. A page can frame the studio without being a set-up
 * product page: `Cart::add` needs a purchasable product and a garment declared
 * ON that product (Product.php), and the context says whether both exist. The
 * studio uses this to keep offering its standalone quote flow rather than a
 * basket button that would be refused at the last click of a purchase.
 */
export function canOrderFromShop(): boolean {
  return isShopConnected() && !!context && context.productId > 0 && context.garment !== ''
}

export function subscribeBridge(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function post(message: Record<string, unknown>, origin: string): void {
  window.parent.postMessage(message, origin)
}

function settle(id: string, ok: boolean, value: unknown, error: string): void {
  const entry = pending.get(id)
  if (!entry) return
  pending.delete(id)
  clearTimeout(entry.timer)
  if (ok) entry.resolve(value)
  else entry.reject(new Error(error))
}

function nextId(): string {
  seq += 1
  return `${sessionTag}-${seq}`
}

/**
 * Send a request and wait for the reply that carries its own `requestId`.
 *
 * The id is what stops two quotes in flight from resolving into each other.
 * the customer bumping the quantity twice quickly gets two requests, and the
 * slower one must not overwrite the fresher answer.
 */
function request<T>(kind: 'quote' | 'cart', type: string, payload: Record<string, unknown>): Promise<T> {
  if (!parentOrigin) return Promise.reject(new Error('not_connected'))
  const origin = parentOrigin
  const requestId = nextId()
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error('timeout'))
    }, REQUEST_TIMEOUT_MS)
    pending.set(requestId, { kind, resolve: resolve as (v: unknown) => void, reject, timer })
    post({ type, requestId, ...payload }, origin)
  })
}

function onQuoteResult(data: Record<string, unknown>): void {
  const id = typeof data.requestId === 'string' ? data.requestId : null
  if (!id) return
  if (data.ok === true && data.quote && typeof data.quote === 'object')
    settle(id, true, data.quote, '')
  else settle(id, false, null, typeof data.error === 'string' ? data.error : 'quote_failed')
}

function onCartResult(data: Record<string, unknown>): void {
  // `requestId` is echoed by the current bridge.js. Older copies of it did not
  // echo one, so a reply without an id resolves the single cart request that
  // can be in flight. `addToShopCart` refuses to start a second one, which is
  // what makes that fallback unambiguous rather than a guess.
  let id = typeof data.requestId === 'string' ? data.requestId : null
  if (!id) for (const [key, entry] of pending) if (entry.kind === 'cart') id = key
  if (!id) return
  if (data.ok === true) {
    settle(
      id,
      true,
      {
        cartCount: typeof data.cartCount === 'number' ? data.cartCount : 0,
        cartUrl: typeof data.cartUrl === 'string' ? data.cartUrl : '',
        message: typeof data.message === 'string' ? data.message : '',
      } satisfies CartOutcome,
      '',
    )
    return
  }
  settle(id, false, null, typeof data.error === 'string' ? data.error : 'cart_failed')
}

function onContext(origin: string, data: Record<string, unknown>): void {
  parentOrigin = origin
  context = {
    productId: typeof data.productId === 'number' ? data.productId : 0,
    garment: typeof data.garment === 'string' ? data.garment : '',
    locale: typeof data.locale === 'string' ? data.locale : 'fr',
  }
  for (const t of handshakeTimers) clearTimeout(t)
  handshakeTimers.length = 0
  status = 'connected'
  notify()
}

function onMessage(event: MessageEvent): void {
  // 2. our own parent, and nothing else on the page.
  if (event.source !== window.parent) return
  // 1. an exact origin match. Before the handshake settles, any origin on the
  //    list may answer; after it, only the one that did.
  if (parentOrigin !== null) {
    if (event.origin !== parentOrigin) return
  } else if (!allowed.includes(event.origin)) return
  // 3. an object with a known type.
  const data = event.data
  if (!data || typeof data !== 'object') return
  const payload = data as Record<string, unknown>
  if (typeof payload.type !== 'string') return

  switch (payload.type) {
    case 'teeshoop:context':
      if (status !== 'connected') onContext(event.origin, payload)
      return
    case 'teeshoop:quote-result':
      onQuoteResult(payload)
      return
    case 'teeshoop:cart-result':
      onCartResult(payload)
      return
    default:
      return
  }
}

/**
 * Start the bridge. Safe to call once, from the customer entry.
 *
 * Inert and silent about it exactly once when the studio is not framed, so the
 * standalone editor keeps working with nothing to configure and nothing to
 * clean up.
 */
export function startShopBridge(): void {
  if (started) return
  started = true

  if (typeof window === 'undefined' || window.parent === window) {
    explain('the studio is not embedded in a shop page, so the basket bridge is inactive.')
    setStatus('standalone')
    return
  }

  allowed = configuredOrigins()
  if (allowed.length === 0) {
    explain(
      'no shop origin is allowed in this build, so the basket bridge is inactive. ' +
        'Set VITE_TEESHOOP_SHOP_ORIGINS to the shop origin and rebuild.',
    )
    setStatus('standalone')
    return
  }

  window.addEventListener('message', onMessage)
  setStatus('connecting')

  // Addressed to each allowed origin in turn. The browser delivers only to the
  // one the parent actually is; the rest are dropped unread.
  const offer = (): void => {
    for (const origin of allowed) post({ type: 'teeshoop:ready' }, origin)
  }
  offer()
  for (const delay of HANDSHAKE_RETRY_MS) {
    handshakeTimers.push(
      setTimeout(() => {
        if (status !== 'connecting') return
        offer()
      }, delay),
    )
  }
  handshakeTimers.push(
    setTimeout(() => {
      if (status === 'connected') return
      explain(
        'the page framing the studio did not answer the handshake. Allowed shop origins: ' +
          allowed.join(', ') +
          '. The studio stays in standalone mode.',
      )
      setStatus('unavailable')
    }, HANDSHAKE_GIVE_UP_MS),
  )
}

/** Ask the shop what a run costs. The answer is the only price we display. */
export function requestShopQuote(input: {
  garment: string
  qty: number
  sides: BridgeSide[]
}): Promise<ShopQuote> {
  return request<ShopQuote>('quote', 'teeshoop:quote', {
    garment: input.garment,
    qty: input.qty,
    sides: input.sides,
  })
}

/**
 * Ask the shop to add a personalised line.
 *
 * ONE AT A TIME, on purpose. `Cart::keep_items_distinct()` gives every
 * personalised line its own cart row (correctly, since two different designs
 * are two lines), which means a double click would buy the same shirt twice.
 * The second call is refused here rather than deduplicated over there, because
 * the shop cannot tell an accidental repeat from a customer deliberately
 * ordering the same design again.
 */
export function addToShopCart(input: AddToCartInput): Promise<CartOutcome> {
  for (const entry of pending.values())
    if (entry.kind === 'cart') return Promise.reject(new Error('already_in_flight'))
  return request<CartOutcome>('cart', 'teeshoop:add-to-cart', {
    garment: input.garment,
    qty: input.qty,
    sides: input.sides,
    designId: input.designId,
    sizeGrid: input.sizeGrid ?? {},
  })
}

/**
 * Ask the page for a taller frame.
 *
 * The parent clamps to 320-4000 px and this only ever grows the box, never
 * shrinks it. Both matter: the studio measures its own content inside the
 * frame, so a request derived from the frame's own height could chase itself.
 * Growth is bounded by the clamp and by callers asking at most once per reason.
 */
export function requestFrameHeight(px: number): void {
  if (!parentOrigin) return
  const height = Math.round(px)
  if (!Number.isFinite(height) || height <= window.innerHeight) return
  post({ type: 'teeshoop:resize', height: Math.min(height, 4000) }, parentOrigin)
}

/** Test seam: drop all bridge state so a suite can start from nothing. */
export function resetShopBridgeForTests(): void {
  if (typeof window !== 'undefined') window.removeEventListener('message', onMessage)
  for (const t of handshakeTimers) clearTimeout(t)
  handshakeTimers.length = 0
  for (const entry of pending.values()) clearTimeout(entry.timer)
  pending.clear()
  started = false
  status = 'standalone'
  context = null
  parentOrigin = null
  allowed = []
  explained = false
  seq = 0
}

/** Test seam: the message handler, so the three checks can be exercised directly. */
export const __handleMessageForTests = onMessage
/** Test seam: origin parsing is a security rule and is asserted on its own. */
export const __parseOriginsForTests = parseOrigins
