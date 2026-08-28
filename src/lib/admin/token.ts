/**
 * The admin bearer token for `/api/fr/*` (worker/auth.ts).
 *
 * THIS IS NOT A SECRET BAKED INTO THE BUNDLE, and it must never become one.
 * The same Cloudflare Worker that gates the API also serves this JavaScript,
 * so anything compiled in is published: a token in the source would be a
 * token on the public internet. It is typed by a human, held for the tab only,
 * and deliberately NOT written to localStorage.
 *
 * Contrast `src/lib/ingest/woo.ts`, which persists a WooCommerce consumer
 * key/secret to localStorage in plain text. That is the pattern this module
 * exists to stop repeating; it is on the R0 list to fix next.
 */

const KEY = 'tshop:admin:token'

/**
 * The token for this tab, or ''.
 *
 * The DEV fallback saves retyping it on every reload while working locally.
 * The `import.meta.env.DEV` test is written as a plain ternary on purpose:
 * Vite substitutes it with `false` in a production build, so Rollup folds the
 * whole branch (and the value it reads) out of the bundle. `npm run
 * verify:bundle` proves that stays true.
 */
export function getAdminToken(): string {
  try {
    const v = sessionStorage.getItem(KEY)
    if (v) return v
  } catch {
    // Private mode / storage disabled: fall through to the DEV fallback.
  }
  return import.meta.env.DEV ? (import.meta.env.VITE_ADMIN_TOKEN ?? '') : ''
}

/** Store the token for this tab. An empty value clears it. */
export function setAdminToken(value: string): void {
  const v = value.trim()
  try {
    if (v) sessionStorage.setItem(KEY, v)
    else sessionStorage.removeItem(KEY)
  } catch {
    // Nothing we can do; the caller will simply be asked again.
  }
}

export function clearAdminToken(): void {
  setAdminToken('')
}

/** Auth headers for a fetch, or `{}` when no token is held. */
export function adminAuthHeaders(): Record<string, string> {
  const token = getAdminToken()
  return token ? { authorization: `Bearer ${token}` } : {}
}
