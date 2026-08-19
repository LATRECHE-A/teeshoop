/**
 * The shop's production queue, from the studio.
 *
 * TWO CREDENTIALS, TWO SERVERS, AND THEY ARE NOT INTERCHANGEABLE. The workshop
 * tool talks to two different machines and this file is the half that talks to
 * WordPress: what is ready to print, and here is the layout I measured for it.
 * The other half (`fromR2.ts`) talks to the Worker for the artwork, with the
 * admin bearer token. Neither token opens the other door, and that is deliberate:
 * the Worker's token reaches our purchase prices and the supplier catalogue,
 * WooCommerce's key reaches orders and customers.
 *
 * WHY THE ROUTES ARE UNDER `wc-teeshoop/v1`. The studio runs on the Worker's
 * origin, so it has no WordPress cookie and no REST nonce, exactly like the
 * customer studio. WooCommerce authenticates a REST request by consumer key when
 * the route looks like one of its own, and `wc-` is its documented opt-in for
 * third-party endpoints. `Production::register_rest()` says the same thing from
 * the other end.
 *
 * NOTHING HERE COMPUTES MONEY. It carries measurements up and reads an answer
 * back. `Cost::attribute()` splits the bill, in integer cents, on the server.
 */
import { loadWooCredentials, normalizeBaseUrl, type WooCredentials } from '@/lib/ingest/woo'
import type { QueueOrder } from './fromR2'

/** The film geometry the shop is quoted on. The studio must nest on THIS. */
export interface ShopFilm {
  width_cm: number
  gap_cm: number
  max_length_cm: number
  billing_step_cm: number
  days_fr: number
  days_es: number
}

export interface ShopQueue {
  today: string
  orders: QueueOrder[]
  /** True when the shop had more ready orders than one call reads. */
  truncated: boolean
  film: ShopFilm
  capacity: { press_per_day: number; manual_above: number }
  /** Per urgency, working days of slack. Negative is a promise that cannot hold. */
  feasibility: Record<string, { days: number; fr: number; es: number }>
}

/** What the studio posts back once it has nested. */
export interface LayoutReport {
  pooled_m: number
  sheets: number
  /**
   * THE ROLL THE LAYOUT WAS ACTUALLY NESTED ON, cm, and the spacing with it.
   *
   * Without them the shop cannot tell that a run it is buying 56 cm of film for
   * was packed 58 cm wide: the length would simply be shorter, so the floor check
   * passes more easily and the ceiling check, which only refuses a layout that is
   * too long, never fires. Two centimetres of every gang sheet would fall outside
   * the roll, and it is discovered at the press with several customers' garments
   * already pulled off the shelf.
   */
  width_cm: number
  gap_cm: number
  billing_step_cm: number
  packer: 'shelf' | 'trueshape'
  interlock_cm: number
  restarts: number
  flip: boolean
  app_version: string
  orders: Record<
    string,
    {
      solo_m: number
      poses: number
      pieces: { key: string; w_cm: number; h_cm: number; qty: number }[]
    }
  >
}

export type ShopFailure =
  | 'no-credentials'
  | 'auth'
  | 'network'
  | 'refused'
  | 'parse'

export class ShopError extends Error {
  readonly code: ShopFailure
  /** The shop's own French sentence when it refused, so the screen can show it. */
  readonly detail: string
  constructor(code: ShopFailure, detail = '') {
    super(`${code}${detail ? `: ${detail}` : ''}`)
    this.name = 'ShopError'
    this.code = code
    this.detail = detail
  }
}

const NS = 'wp-json/wc-teeshoop/v1'

function auth(cred: WooCredentials): Record<string, string> {
  return {
    authorization: `Basic ${btoa(`${cred.consumerKey}:${cred.consumerSecret}`)}`,
    accept: 'application/json',
  }
}

/**
 * The stored WooCommerce credentials, or a failure the screen can name.
 *
 * WHAT THIS SESSION ASKED OF THAT KEY, said out loud because it went up.
 * `src/lib/ingest/woo.ts` needed a key that could read products, to match the
 * catalogue. These routes are gated on `manage_woocommerce`, so the key now has
 * to belong to a user who can manage the whole shop, and it lives in
 * localStorage in plain text on whatever machine the workshop uses. Anything
 * that can run script on that origin can read it and then read every order and
 * every customer.
 *
 * It is not fixed here because the fix is not local: it is a scoped credential
 * the plugin mints and can revoke, which is a piece of work of its own.
 * `src/lib/admin/token.ts` already refuses to write ITS secret to localStorage
 * and says the Woo pattern is the one to stop repeating. Recorded in
 * `docs/ROADMAP.md` under the assumed exceptions so it is a decision rather than
 * an oversight.
 */
export function shopCredentials(): WooCredentials {
  const cred = loadWooCredentials()
  if (!cred) throw new ShopError('no-credentials')
  return cred
}

async function call(
  cred: WooCredentials,
  path: string,
  init?: { method: 'POST'; body: unknown },
): Promise<unknown> {
  /*
   * THROUGH THE ONE NORMALISER, not off the stored string. `loadWooCredentials`
   * returns what was saved, and what was saved can be `http://boutique.example`:
   * the catalogue importer upgrades it to https before every call, precisely
   * because Basic auth over http puts a read-write WooCommerce key on the wire in
   * clear. This route carries the same key, so it goes through the same function
   * rather than a second `replace` that only trims a slash.
   */
  const url = `${normalizeBaseUrl(cred.baseUrl)}/${NS}/${path}`
  let res: Response
  try {
    res = await fetch(url, {
      method: init ? init.method : 'GET',
      cache: 'no-store',
      headers: init
        ? { ...auth(cred), 'content-type': 'application/json' }
        : auth(cred),
      ...(init ? { body: JSON.stringify(init.body) } : {}),
    })
  } catch {
    throw new ShopError('network')
  }
  if (res.status === 401 || res.status === 403) throw new ShopError('auth')

  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new ShopError('parse')
  }
  if (!res.ok) {
    /*
     * THE SHOP'S OWN SENTENCE, carried through verbatim. Every refusal in
     * `Production::create_lot` names what was wrong with the layout and which
     * order it was wrong about; replacing that with "the request failed" would
     * hand an operator a red box and no way forward.
     */
    const message =
      body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string'
        ? (body as { message: string }).message
        : ''
    throw new ShopError('refused', message)
  }
  return body
}

/** What could go on a press today, with the geometry to nest it on. */
export async function fetchQueue(cred: WooCredentials, today?: string): Promise<ShopQueue> {
  const body = (await call(cred, `production/queue${today ? `?today=${today}` : ''}`)) as ShopQueue
  if (!body || !Array.isArray(body.orders) || !body.film) throw new ShopError('parse')
  return body
}

/**
 * Hand the measured layout to the shop and get the lot back.
 *
 * The shop may refuse it, and a refusal is information rather than an error to
 * retry: it means the layout and the orders describe two different things, and
 * the sentence says which. See `Production::create_lot`.
 */
export async function createLot(
  cred: WooCredentials,
  input: { orders: number[]; origin: 'fr' | 'es'; layout: LayoutReport; today?: string },
): Promise<Record<string, unknown>> {
  const body = (await call(cred, 'production/lots', { method: 'POST', body: input })) as {
    lot?: Record<string, unknown>
  }
  if (!body?.lot) throw new ShopError('parse')
  return body.lot
}

/** What went wrong, in a sentence an operator can act on. */
export function shopFailureFr(err: unknown): string {
  if (!(err instanceof ShopError)) return 'La boutique n’a pas répondu comme prévu.'
  switch (err.code) {
    case 'no-credentials':
      return 'Aucune clé WooCommerce enregistrée dans ce navigateur. Ouvrez le catalogue et renseignez l’adresse de la boutique, la clé et le secret.'
    case 'auth':
      return 'La boutique a refusé la clé WooCommerce. Vérifiez qu’elle est en lecture et écriture et que le compte a le droit de gérer WooCommerce.'
    case 'network':
      return 'La boutique n’a pas répondu. Vérifiez l’adresse enregistrée et que le site est joignable.'
    case 'parse':
      return 'La boutique a répondu quelque chose d’inattendu. L’extension Teeshoop est peut-être plus ancienne que ce studio.'
    case 'refused':
      return err.detail || 'La boutique a refusé le lot.'
  }
}
