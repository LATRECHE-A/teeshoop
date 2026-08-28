/**
 * The Content Security Policy for everything the Worker serves as a document.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A NONCE, NOT A HASH, AND THAT IS THE WHOLE DESIGN DECISION.
 *
 * Each of the three HTML entries carries exactly one inline `<script>` (the
 * no-flash-of-unstyled-content bootstrap that reflects the stored theme and
 * language before any CSS runs) and one inline `<style>`. A policy has to allow
 * those two or the studio boots dark for every light-theme customer.
 *
 * The obvious answer is `'sha256-…'`, computed at build time. It is also a trap:
 * `dist/` is not committed, Vite copies those blocks through byte for byte, and
 * the next whitespace edit to `index.html` ships a policy whose hash no longer
 * matches, with no test failing and the symptom appearing only in a customer's
 * browser. A stale hash is a blank page.
 *
 * So the nonce is minted per request and written into the tags by HTMLRewriter
 * on the way out. It cannot go stale because it is derived from nothing: the
 * policy and the markup are stamped in the same breath.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE STUDIO AND THE VIEWER GET DIFFERENT POLICIES
 *
 * The viewer (`/v/{id}`) is the one surface with no authentication in front of
 * it at all: a stranger opens it from a QR code on a phone. It is also simpler,
 * and every place it is simpler is a directive that can be tighter. It compiles
 * no WebAssembly and starts no worker, so it gets neither `'wasm-unsafe-eval'`
 * nor a `worker-src`, and it refuses to be framed by anybody.
 *
 * The studio needs both: `'wasm-unsafe-eval'` because background removal runs an
 * ONNX model, and `worker-src blob:` because that model and the gang-sheet
 * packer run in Web Workers.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * frame-ancestors IS OMITTED WHEN NOBODY HAS SAID WHO MAY FRAME US.
 *
 * The shop frames the studio, so the studio must allow exactly the shop and
 * nothing else. That origin is deployment configuration (`SHOP_ORIGINS` in
 * wrangler.jsonc), and when it is unset the directive is left out rather than
 * set to `'none'`. Setting `'none'` would be the fail-closed reflex and it would
 * be wrong here: it takes the editor off the product page, which is the shop's
 * only way of selling, for a misconfiguration rather than for an attack. The
 * real gate on who may DRIVE the studio is the postMessage bridge's exact origin
 * comparison, which is unaffected; this directive is depth, and a warning is
 * logged so a deployment missing it is not silent.
 */

export interface CspEnv {
  /**
   * Space-separated origins allowed to frame the studio, normally the shop.
   * Unset means the frame-ancestors directive is omitted, see the header.
   */
  SHOP_ORIGINS?: string
}

/** 128 bits, base64. Fresh per request; never derived from anything. */
export function cspNonce(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  let s = ''
  for (const byte of b) s += String.fromCharCode(byte)
  return btoa(s)
}

function ancestors(env: CspEnv, what: string): string | null {
  const raw = (env.SHOP_ORIGINS ?? '').trim()
  if (raw === '') {
    console.warn(
      `SHOP_ORIGINS is unset, so ${what} is served with no frame-ancestors directive. ` +
        'Set it in wrangler.jsonc to the shop origin that embeds the studio.',
    )
    return null
  }
  return `frame-ancestors ${raw}`
}

/** The customer and admin studio. */
export function studioPolicy(nonce: string, env: CspEnv): string {
  return [
    // Achievable here, unlike on the WordPress side: every fetch this bundle
    // makes is a relative path on its own origin.
    "default-src 'none'",
    // 'wasm-unsafe-eval' and NOT 'unsafe-eval': the narrow token is enough.
    // onnxruntime-web instantiates the background-removal model, and drei's
    // meshopt decoder is compiled for the 3D board. Neither needs eval, and a
    // scan of the built chunks for new Function( and eval( finds none.
    `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval'`,
    `style-src 'self' 'nonce-${nonce}'`,
    // blob: for a canvas the customer's own artwork is drawn into, data: for
    // an imported design file and for the inline favicon.
    "img-src 'self' data: blob:",
    // data: MEASURED, not assumed. Four `font-src` refusals on the studio under
    // the first version of this policy: @fontsource inlines the smallest faces
    // as data: URLs in the built CSS, so 'self' alone refuses them and the
    // studio renders in a fallback face with nothing in the console a customer
    // would think to report.
    "font-src 'self' data:",
    // data: because reopening a shared design fetches its own data URL.
    "connect-src 'self' data: blob:",
    // Vite starts module workers from a blob: in some browsers, and worker-src
    // does NOT fall back to script-src: it falls back to child-src and then to
    // default-src, which is 'none'. Omitting this line stops the background
    // remover with no error a customer could report.
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    ancestors(env, 'the studio'),
  ]
    .filter((d): d is string => d !== null)
    .join('; ')
}

/** The AR viewer a QR code opens, which nobody may frame. */
export function viewerPolicy(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' blob:",
    "media-src 'self' blob:",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}

/**
 * Stamp the policy and write the same nonce into every inline tag.
 *
 * HTMLRewriter streams, so the document is never buffered. Only tags WITHOUT a
 * `src`/`href` are given a nonce: an external script is already covered by
 * `'self'`, and adding one there would be noise.
 */
export function withCsp(response: Response, policy: string, nonce: string): Response {
  const headers = new Headers(response.headers)
  headers.set('content-security-policy', policy)
  headers.set('x-content-type-options', 'nosniff')
  headers.set('referrer-policy', 'strict-origin-when-cross-origin')

  const stamped = new Response(response.body, { status: response.status, headers })
  return new HTMLRewriter()
    .on('script', {
      element(el) {
        if (!el.hasAttribute('src')) el.setAttribute('nonce', nonce)
      },
    })
    .on('style', {
      element(el) {
        el.setAttribute('nonce', nonce)
      },
    })
    .transform(stamped)
}
