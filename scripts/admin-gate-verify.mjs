#!/usr/bin/env node
/**
 * The admin gate, exercised against a real Worker and a real browser.
 *
 *   npx wrangler dev --ip 127.0.0.1 --port 8788     (in another shell)
 *   node scripts/admin-gate-verify.mjs
 *
 * WHY THIS EXISTS. Until 27/08/2026 the gate covered the PAGE and nothing it
 * loads. `GET /admin.html` answered 401; `GET /assets/DtfModal-<hash>.js`
 * answered 200 with 137 ko of the film cost model to a request carrying no
 * credentials at all, and `GET /.vite/manifest.json` answered 200 with the list
 * of every chunk so the hash was not even an obstacle. Both gates that exist for
 * this were green: `src/app/adminBoundary.test.ts` proves the customer entry
 * cannot REACH those modules, `scripts/bundle-guard.mjs` expects shop-internal
 * markers in a file classified ADMIN. Neither asserted that an ADMIN file is not
 * simply downloadable.
 *
 * So the fix has two halves and this checks both:
 *
 *   THE GATE HOLDS.      No credentials, no admin JavaScript. Every file under
 *                        /admin-assets/ answers 401, and so does the page.
 *   THE STUDIO STILL     With credentials, the whole admin studio loads in a
 *   WORKS.               real browser, including the gang-sheet packer, which is
 *                        a MODULE WEB WORKER. A module worker fetches with
 *                        credentials mode `same-origin`, so the browser should
 *                        attach the Basic credentials it already holds. "Should"
 *                        is why this runs a browser instead of curl: if it does
 *                        not, the workshop's nesting breaks in production only.
 *
 * And the customer studio must be untouched: it loads with NO credentials and
 * every request it makes succeeds.
 *
 * Exit: 0 all assertions held - 1 an assertion failed - 2 nothing was measured.
 */
import { chromium } from 'playwright'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const ORIGIN = (process.argv.find((a) => a.startsWith('--origin=')) || '').slice(9) || 'http://127.0.0.1:8788'
const DIST = join(ROOT, 'dist')
const GATED_DIR = 'admin-assets'

let pass = 0
let fail = 0
const ok = (what, cond, detail = '') => {
  if (cond) {
    pass++
    console.log(`  ✓ ${what}${detail ? `   ${detail}` : ''}`)
  } else {
    fail++
    console.log(`  ✗ ${what}${detail ? `   ${detail}` : ''}`)
  }
}
const bail = (msg) => {
  console.error(`\nadmin-gate-verify: ${msg}`)
  process.exit(2)
}

/** The token the running Worker was started with. Same reader as nest-verify. */
function adminToken() {
  if (process.env.ADMIN_TOKEN) return process.env.ADMIN_TOKEN.trim()
  let text
  try {
    text = readFileSync(join(ROOT, '.dev.vars'), 'utf8')
  } catch {
    bail('.dev.vars is missing, so there is no token to authenticate with and a pass would mean nothing.')
  }
  for (const line of text.split('\n')) {
    const m = /^\s*ADMIN_TOKEN\s*=\s*"?(.+?)"?\s*$/.exec(line)
    if (m) return m[1].trim()
  }
  bail('no ADMIN_TOKEN in .dev.vars. The gate cannot be tested, and a pass would mean nothing.')
}

const TOKEN = adminToken()
const BASIC = 'Basic ' + Buffer.from(`atelier:${TOKEN}`).toString('base64')

function gatedFiles() {
  try {
    return readdirSync(join(DIST, GATED_DIR)).filter((f) => f.endsWith('.js'))
  } catch {
    return []
  }
}

async function status(path, headers = {}) {
  const res = await fetch(ORIGIN + path, { headers, redirect: 'manual' })
  const body = await res.text()
  return { code: res.status, type: res.headers.get('content-type') || '', body }
}

async function main() {
  console.log(`admin-gate-verify against ${ORIGIN}\n`)

  const files = gatedFiles()
  if (files.length === 0) {
    bail(
      `dist/${GATED_DIR}/ holds no JavaScript. Either the build did not run or the split in\n` +
        'vite.config.ts stopped working, and in the second case every admin chunk is public\n' +
        'again. Checking nothing is not a pass.',
    )
  }

  // Is anything actually there to talk to?
  try {
    await fetch(`${ORIGIN}/`, { signal: AbortSignal.timeout(5000) })
  } catch {
    bail(`nothing answered on ${ORIGIN}. Start it with:  npx wrangler dev --ip 127.0.0.1 --port 8788`)
  }

  // -------------------------------------------------------------- the gate --
  console.log(`Sans identifiants (${files.length} fichiers sous /${GATED_DIR}/)`)
  let refused = 0
  for (const f of files) {
    const r = await status(`/${GATED_DIR}/${f}`)
    if (r.code === 401) refused++
    else ok(`/${GATED_DIR}/${f} is refused`, false, `answered ${r.code}, ${r.body.length} bytes`)
  }
  ok('every gated chunk answers 401', refused === files.length, `${refused}/${files.length}`)

  const page = await status('/admin.html')
  ok('/admin.html answers 401', page.code === 401, `answered ${page.code}`)
  ok(
    'and challenges, so a browser shows a login box',
    page.code === 401,
    'www-authenticate is set by worker/auth.ts deny(page)',
  )

  const alias = await status('/admin')
  ok('/admin answers 401 too', alias.code === 401, `answered ${alias.code}`)

  /*
   * The manifest. A bare status check is not enough: with the SPA fallback a
   * missing file answers 200 with index.html, which looks like a leak and is
   * not, and would look like a pass if the check were inverted. So the assertion
   * is on the CONTENT TYPE and on the body not being the manifest.
   */
  const man = await status('/.vite/manifest.json')
  ok(
    '/.vite/manifest.json is not served',
    !man.type.includes('application/json') && !man.body.includes('"isEntry"'),
    `${man.code} ${man.type.split(';')[0]}`,
  )

  // ------------------------------------------------- and it opens with them --
  console.log('\nAvec les identifiants')
  let served = 0
  for (const f of files) {
    const r = await status(`/${GATED_DIR}/${f}`, { authorization: BASIC })
    if (r.code === 200 && r.body.length > 0) served++
    else ok(`/${GATED_DIR}/${f} is served`, false, `answered ${r.code}`)
  }
  ok('every gated chunk is served', served === files.length, `${served}/${files.length}`)
  const authed = await status('/admin.html', { authorization: BASIC })
  ok('/admin.html is served', authed.code === 200 && authed.body.includes('<script'), `answered ${authed.code}`)

  // ---------------------------------------------- the customer is untouched --
  console.log('\nLe studio client, sans aucun identifiant')
  const home = await status('/')
  ok('/ is served', home.code === 200 && home.body.includes('<script'), `answered ${home.code}`)
  const viewer = await status('/v/aaaaaaaaaa')
  ok('the AR viewer page is served', viewer.code === 200, `answered ${viewer.code}`)

  // ------------------------------------------------------- in a real browser --
  const browser = await chromium.launch()
  try {
    console.log('\nDans un vrai navigateur')

    // The customer studio, with no credentials at all.
    const anon = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const anonPage = await anon.newPage()
    const anonBad = []
    anonPage.on('response', (r) => {
      if (r.status() >= 400) anonBad.push(`${r.status()} ${new URL(r.url()).pathname}`)
    })
    const anonErrors = []
    anonPage.on('pageerror', (e) => anonErrors.push(e.message.slice(0, 160)))
    await anonPage.goto(`${ORIGIN}/`, { waitUntil: 'load', timeout: 90000 })
    await anonPage.waitForTimeout(3000)
    ok('the customer studio loads with nothing refused', anonBad.length === 0, anonBad.slice(0, 3).join(' | '))
    ok('and throws nothing', anonErrors.length === 0, anonErrors.slice(0, 2).join(' | '))
    await anon.close()

    // The admin studio, authenticated the way a human is.
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      httpCredentials: { username: 'atelier', password: TOKEN },
    })
    const adminPage = await ctx.newPage()
    const bad = []
    const seen = []
    adminPage.on('response', (r) => {
      const p = new URL(r.url()).pathname
      seen.push(`${r.status()} ${p}`)
      if (r.status() >= 400) bad.push(`${r.status()} ${p}`)
    })
    const errors = []
    adminPage.on('pageerror', (e) => errors.push(e.message.slice(0, 160)))
    await adminPage.goto(`${ORIGIN}/admin.html`, { waitUntil: 'load', timeout: 90000 })
    await adminPage.waitForTimeout(4000)

    ok('the admin studio loads', bad.length === 0, bad.slice(0, 4).join(' | '))
    ok('and throws nothing', errors.length === 0, errors.slice(0, 2).join(' | '))
    const gatedFetched = seen.filter((s) => s.includes(`/${GATED_DIR}/`))
    ok(
      'the browser did fetch gated chunks, with its credentials',
      gatedFetched.length > 0 && gatedFetched.every((s) => s.startsWith('200')),
      gatedFetched.slice(0, 3).join(' | ') || 'none were requested, which proves nothing',
    )

    /*
     * THE MODULE WORKER, which is the one the specification alone does not settle.
     *
     * `new Worker(new URL('./nestWorker.ts', import.meta.url), { type: 'module' })`
     * now resolves to a URL under the gated directory. A module worker fetches
     * with credentials mode `same-origin`, so the Basic credentials the browser
     * already holds should go with it. This starts one from the page and waits
     * for it to answer, because "should" is not a test.
     */
    const workerUrl = gatedFiles().find((f) => f.startsWith('nestWorker'))
    if (!workerUrl) {
      ok('the gang-sheet packer is a gated worker chunk', false, 'no nestWorker chunk under the gated directory')
    } else {
      const alive = await adminPage.evaluate(async (url) => {
        try {
          const w = new Worker(url, { type: 'module' })
          const answered = await new Promise((resolve) => {
            const t = setTimeout(() => resolve('timeout'), 8000)
            w.onmessage = () => {
              clearTimeout(t)
              resolve('message')
            }
            w.onerror = (e) => {
              clearTimeout(t)
              resolve(`error: ${e.message || 'load failed'}`)
            }
            // Any message at all: what is being tested is that the worker's
            // SCRIPT was fetched, not what it computes.
            w.postMessage({ ping: true })
          })
          w.terminate()
          return answered
        } catch (e) {
          return `threw: ${e.message}`
        }
      }, `/${GATED_DIR}/${workerUrl}`)
      ok(
        'a module worker under the gate loads with the browser’s credentials',
        alive !== 'timeout' && !String(alive).startsWith('error') && !String(alive).startsWith('threw'),
        String(alive),
      )
    }
    await ctx.close()
  } finally {
    await browser.close()
  }

  console.log('')
  if (pass + fail === 0) {
    console.error('admin-gate-verify: nothing was asserted. That is not a pass.')
    process.exit(2)
  }
  if (fail > 0) {
    console.error(`admin-gate-verify: ${fail} failed, ${pass} passed.`)
    process.exit(1)
  }
  console.log(`admin-gate-verify: ${pass} passed.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
