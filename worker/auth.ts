/**
 * Admin authentication for the Worker's shop-internal routes.
 *
 * WHY THIS EXISTS. `/api/fr/*` is not a customer surface. It returns our
 * PURCHASE COST per SKU (`/api/fr/price/…`), our supplier stock, and the
 * supplier catalogue itself. Until 2026-08-12 every one of those routes was
 * open to anyone who knew the URL, and `POST /api/fr/order` could place a real
 * purchase order on our Falk&Ross account. That route is gone (see the order
 * section in falkross.ts); everything else now sits behind this gate.
 *
 * FAIL-CLOSED IS THE POINT. With `ADMIN_TOKEN` unset the gate denies every
 * request. The tempting inversion,
 *
 *     if (!env.ADMIN_TOKEN) return null   // "don't break local dev"
 *
 * must never appear here: a Worker deployed before the secret is set would
 * then be wide open, which is exactly the state we are fixing. Local dev sets
 * the same key in `.dev.vars`.
 *
 * UPGRADE PATH. This is a bearer token because it needs no Cloudflare
 * dashboard access to deploy. Putting Cloudflare Access in front of the same
 * paths later is purely a dashboard change: no code here has to move.
 */

export interface AdminEnv {
  /**
   * Shared secret for `/api/fr/*`. `wrangler secret put ADMIN_TOKEN`, and the
   * same key in `.dev.vars` for local `wrangler dev`. Generate with
   * `openssl rand -base64 32`. UNSET MEANS DENY ALL.
   */
  ADMIN_TOKEN?: string
}

/** Shorter than this is treated as unset: a 4-char "secret" is not one. */
const MIN_TOKEN_LEN = 24

const enc = new TextEncoder()

const digest = (s: string): Promise<ArrayBuffer> => crypto.subtle.digest('SHA-256', enc.encode(s))

/**
 * Constant-time compare.
 *
 * `crypto.subtle.timingSafeEqual` THROWS when the two views differ in length,
 * which would both crash the request and leak the expected length through the
 * error. Hashing first makes both operands exactly 32 bytes, so the comparison
 * is total and reveals nothing about the token's shape.
 */
async function secretEquals(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([digest(a), digest(b)])
  return crypto.subtle.timingSafeEqual(new Uint8Array(x), new Uint8Array(y))
}

/**
 * Proof that the caller is the one who uploaded design `id`: HMAC-SHA256 of
 * `teeshoop-modele:<id>` under `ADMIN_TOKEN`, in lowercase hex. '' when the
 * token is unset or too short, which the shop refuses (fail closed).
 *
 * WHY IT EXISTS. The id travels (share links, the public preview URL), and the
 * shop's saved-models routes relay a design's ORIGINALS back to the account
 * that saved it. Without this, anyone who knew an id could save someone else's
 * design and read their source images through the shop. Only the response to
 * the upload carries the proof; WordPress holds the same token and recomputes
 * it (`Modeles::preuve`) without a round trip.
 */
export async function ownerProof(env: AdminEnv, id: string): Promise<string> {
  const token = env.ADMIN_TOKEN ?? ''
  if (token.length < MIN_TOKEN_LEN) return ''
  const key = await crypto.subtle.importKey('raw', enc.encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`teeshoop-modele:${id}`)))
  return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The presented token, or '' when the header is absent or malformed.
 *
 * TWO encodings of the SAME secret, because two different clients need it:
 *  - `Bearer <token>`, what `fetch` from the admin studio sends.
 *  - `Basic base64(anything:<token>)`, what a BROWSER sends after being
 *    prompted. A bearer challenge shows no prompt, so a plain navigation to
 *    /admin.html could never authenticate; Basic is the only scheme browsers
 *    have a built-in login box for. The username is ignored: there is one
 *    secret, not an account system.
 *
 * The useful side effect: once a human has answered the prompt for the admin
 * page, the browser attaches those Basic credentials to same-origin API calls
 * on its own, so the studio works without anyone pasting a token anywhere.
 */
function presentedToken(request: Request): string {
  const header = request.headers.get('authorization') ?? ''

  const bearer = /^Bearer\s+(.+)$/i.exec(header)
  if (bearer) return bearer[1].trim()

  const basic = /^Basic\s+(.+)$/i.exec(header)
  if (basic) {
    try {
      const decoded = atob(basic[1].trim())
      const colon = decoded.indexOf(':')
      return colon >= 0 ? decoded.slice(colon + 1) : ''
    } catch {
      return ''
    }
  }
  return ''
}

/**
 * Returns `null` when the caller is an authenticated admin, or the 401 to send
 * back when it is not. Callers gate on the return value:
 *
 *     const denied = await requireAdmin(request, env)
 *     if (denied) return denied
 *
 * The response is deliberately identical for "no token configured" and "wrong
 * token": an attacker learns nothing about whether the deployment is
 * misconfigured.
 */
export async function requireAdmin(
  request: Request,
  env: AdminEnv,
  challenge: 'api' | 'page' = 'api',
): Promise<Response | null> {
  const expected = env.ADMIN_TOKEN ?? ''
  const presented = presentedToken(request)

  if (expected.length < MIN_TOKEN_LEN) {
    // Surfaces in `wrangler tail`; the client is told nothing extra.
    console.warn('ADMIN_TOKEN is not configured (or is too short): every admin request is denied.')
    return deny(challenge)
  }
  if (presented.length === 0) return deny(challenge)
  return (await secretEquals(presented, expected)) ? null : deny(challenge)
}

/**
 * `page` sends a Basic challenge so the browser shows its login box; `api`
 * does not, so a failed fetch surfaces as a JSON error the modal can render
 * instead of a native popup appearing over the studio.
 */
function deny(challenge: 'api' | 'page'): Response {
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    vary: 'authorization',
  }
  if (challenge === 'page') headers['www-authenticate'] = 'Basic realm="Teeshoop atelier"'

  return new Response(
    JSON.stringify({ error: 'admin_auth', message: 'Admin authentication required.' }),
    { status: 401, headers },
  )
}
