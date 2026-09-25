#!/usr/bin/env node
/**
 * CATALOG-VERIFY: the Falk&Ross catalogue must never be a dead end.
 *
 * The live path needs two processes (Worker + Vite) and one supplier all up at
 * once; this suite pins the two degraded modes that used to render the modal
 * useless:
 *
 *   1. BACKEND DOWN, NOTHING CACHED: the error must say the *backend* is not
 *      running and how to start it (dev builds diagnose the Vite-proxy
 *      ECONNREFUSED as "backend", not "supplier"), and must offer a retry.
 *   2. BACKEND DOWN, SNAPSHOT PRESENT: the modal must replay the last-good
 *      catalogue (grid, detail, ws-mode badge) with an explicit "cached from…"
 *      banner, because stale-and-labelled beats dead.
 *
 * The live path itself is exercised against a STUB backend on :8787 (the vite
 * proxy's default target) serving canned /api/fr/* fixtures: no credentials,
 * no network, CI-safe. fr-verify.mjs owns the real-supplier contract; this
 * suite owns the modal's failure behaviour.
 *
 *   node scripts/catalog-verify.mjs
 */
import { spawn } from 'node:child_process'
import http from 'node:http'
import { chromium } from 'playwright'
import { NODE, VITE } from './bin.mjs'

const PORT = 5193
const BASE = `http://localhost:${PORT}`
const API_PORT = 8787

let failures = 0
const ok = (label, detail) => console.log(`  \x1b[32mok\x1b[0m   ${label}${detail ? ': ' + detail : ''}`)
const bad = (label, detail) => {
  failures++
  console.error(`  \x1b[31mBAD\x1b[0m  ${label}${detail ? ': ' + detail : ''}`)
}
const section = (s) => console.log(`\n\x1b[1m${s}\x1b[0m`)

// --- fixtures (shapes mirror worker/falkross.ts payloads) -------------------

const CARD = {
  styleNr: '18001',
  brand: 'Fruit of the Loom',
  supplierRef: '61-212-0',
  name: 'Fixture Valueweight Tee',
  kind: 'tee',
  sleeve: 'short',
  thumb: '',
  hasBack: true,
  colourCount: 2,
  sizes: ['S', 'M', 'L', 'XL'],
}
const PAGE = { total: 1, offset: 0, nextOffset: null, scanned: 1, items: [CARD], exportedAt: '2026-08-07' }
const STYLE = {
  ...CARD,
  nameEn: CARD.name,
  description: 'Fixture style for catalog-verify.',
  categories: ['T-Shirts'],
  gender: 'unisex',
  neckline: 'crew',
  fabric: ['100% cotton'],
  certificates: [],
  sizespecPdf: '',
  front: '',
  back: '',
  frontColour: 'white',
  backColour: 'white',
  colourways: [
    { code: 'white', name: 'White', swatch: '', photo: '', skus: { S: '180010001', M: '180010002', L: '180010003', XL: '180010004' } },
    { code: 'black', name: 'Black', swatch: '', photo: '', skus: { S: '180010011', M: '180010012', L: '180010013', XL: '180010014' } },
  ],
  skus: [],
  exportedAt: '2026-08-07',
}
const STATE = { mode: 'test', modeCode: '1', modeName: 'Test', at: '2026-08-07' }

function stubApi() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    const json = (body) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (url.pathname === '/api/fr/state') return json(STATE)
    if (url.pathname === '/api/fr/styles') return json(PAGE)
    if (url.pathname === '/api/fr/style/18001') return json(STYLE)
    if (url.pathname.startsWith('/api/fr/price/')) return json({ currency: 'EUR', prices: {} })
    if (url.pathname.startsWith('/api/fr/stock/')) return json({ at: '', stock: {} })
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end('{"error":"not_found"}')
  })
  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(API_PORT, '127.0.0.1', () => resolve(server))
  })
}

const waitServer = (url, ms = 30000) =>
  new Promise((res, rej) => {
    const s = Date.now()
    const t = async () => {
      try {
        if ((await fetch(url)).ok) return res()
      } catch {}
      if (Date.now() - s > ms) return rej(new Error('dev server timeout'))
      setTimeout(t, 400)
    }
    t()
  })

const englishPrefs = () => {
  try {
    localStorage.setItem(
      'tshop:prefs',
      JSON.stringify({ theme: 'dark', lang: 'en', scene: 'studio', showGuides: false }),
    )
  } catch {}
}

const openCatalog = async (page) => {
  // The ADMIN entry, not '/': since the customer/admin bundle split the
  // supplier catalogue is rendered only by admin.html. Flipping the store flag
  // on the customer page now sets a boolean nothing renders, and this script
  // would time out on an empty modal.
  await page.goto(BASE + '/admin.html', { waitUntil: 'load', timeout: 45000 })
  await page.waitForFunction(() => !!window.__tshop, { timeout: 30000 })
  await page.evaluate(() => window.__tshop.getState().openModal('catalog'))
}

const bodyHas = (page, needle, timeout = 20000) =>
  page
    .waitForFunction((n) => document.body.innerText.includes(n), needle, { timeout })
    .then(() => true)
    .catch(() => false)

/** Absence, given a grace period for it to have appeared. */
const bodyLacks = async (page, needle, settle = 1500) => {
  await page.waitForTimeout(settle)
  return !(await page.evaluate((n) => document.body.innerText.includes(n), needle))
}

/**
 * Wait for the snapshot the modal writes, instead of sleeping and hoping.
 * Reads IndexedDB directly (idb-keyval's default 'keyval-store'/'keyval'), so
 * it needs no module resolution and works the same on a dev or built bundle.
 * The old 800 ms sleep meant a loaded machine reported working code as broken.
 */
const snapshotStored = (page, kind, q = '') =>
  page
    .waitForFunction(
      ([k, query]) =>
        new Promise((resolve) => {
          const open = indexedDB.open('keyval-store')
          open.onerror = () => resolve(false)
          open.onsuccess = () => {
            const db = open.result
            if (!db.objectStoreNames.contains('keyval')) return resolve(false)
            const req = db.transaction('keyval', 'readonly').objectStore('keyval').get(`tshop:fr:browse:${k} ${query}`)
            req.onerror = () => resolve(false)
            req.onsuccess = () => resolve(!!req.result?.data?.items?.length)
          }
        }),
      [kind, q],
      { timeout: 20000 },
    )
    .then(() => true)
    .catch(() => false)

// --- run --------------------------------------------------------------------

const vite = spawn(NODE, [VITE, '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(),
  stdio: 'ignore',
})
let browser
let stub = null
const done = async (code) => {
  try {
    await browser?.close()
  } catch {}
  try {
    vite.kill('SIGTERM')
  } catch {}
  try {
    stub?.close()
  } catch {}
  process.exit(code)
}

try {
  // Preflight: anything already answering on 8787 (a wrangler you left
  // running, or a TSHOP_WORKER override) makes section 1 assert "the backend
  // is down" against a live backend, and then stubApi() dies with EADDRINUSE
  // and no explanation. Fail loudly instead.
  const squatter = await fetch(`http://127.0.0.1:${API_PORT}/api/fr/state`, {
    signal: AbortSignal.timeout(2000),
  })
    // ANY response means something is listening. Not `r.ok`: /api/fr/* is now
    // admin-gated, so a real wrangler answers 401 and would slip past an
    // ok-only check: straight back into the EADDRINUSE this preflight exists
    // to prevent.
    .then(() => true)
    .catch(() => false)
  if (squatter) {
    console.error(`\nport ${API_PORT} is already serving /api/fr/*. Stop wrangler (or unset TSHOP_WORKER) first.`)
    process.exit(1)
  }

  await waitServer(BASE)
  browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] })

  // ---- 1. backend down, nothing cached ----
  section('1. Backend down, empty cache: actionable error')
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await ctx.addInitScript(englishPrefs)
    const page = await ctx.newPage()
    await openCatalog(page)
    if (await bodyHas(page, 'npm run dev'))
      ok('dev error names the backend and the command that starts it')
    else bad('dev error names the backend', 'expected “backend … npm run dev” in the modal')
    if (await bodyHas(page, 'Retry', 4000)) ok('retry affordance present')
    else bad('retry affordance present')

    // …and the Retry must actually RE-RUN the load. Asserting the button
    // exists only proves the i18n key is present: wiring its onClick to a
    // no-op left the suite green while the user's only escape from the error
    // state was dead. Bring the backend up and click it.
    stub = await stubApi()
    await page.click('text=Retry')
    if (await bodyHas(page, 'Fixture Valueweight Tee', 20000))
      ok('Retry re-runs the load and recovers once the backend is up')
    else bad('Retry re-runs the load', 'grid still empty after clicking Retry with the backend up')
    stub.close()
    stub = null
    await ctx.close()
  }

  // ---- 2. live browse via stub, then offline replay from the snapshot ----
  section('2. Stub backend live, then killed: snapshot replay')
  {
    stub = await stubApi()
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await ctx.addInitScript(englishPrefs)
    const page = await ctx.newPage()
    await openCatalog(page)
    if (await bodyHas(page, 'Fixture Valueweight Tee')) ok('live browse renders the stub card')
    else bad('live browse renders the stub card')
    if (await bodyHas(page, 'Test mode', 5000)) ok('ws-mode badge renders live')
    else bad('ws-mode badge renders live')

    // NEGATIVE CONTROL, and the most important check in the file. frCache's
    // whole promise is that the snapshot is WRITE-ONLY while the backend
    // answers. A cache-first regression (replay first, fetch later) would
    // satisfy every other assertion here byte-for-byte, because the fixture
    // and the replayed data are the same object, and would silently put a user
    // in front of yesterday's catalogue. The absence of the banner is the only
    // thing that can tell the two apart.
    if (await bodyLacks(page, 'cached catalogue from'))
      ok('live data is served live, no cache banner while the backend is up')
    else bad('cache banner shown while the backend is up', 'the snapshot is shadowing a working backend')

    // Open the detail (this writes the style snapshot).
    await page.click('text=Fixture Valueweight Tee')
    if (await bodyHas(page, 'Estimated measurements', 15000))
      ok('style detail renders from the stub')
    else bad('style detail renders from the stub')
    if (await bodyLacks(page, 'from the cache'))
      ok('live detail is served live, no cache line while the backend is up')
    else bad('cache line shown on a live detail')

    if (await snapshotStored(page, 'printable')) ok('browse snapshot persisted to IndexedDB')
    else bad('browse snapshot persisted', 'nothing under tshop:fr:browse:*. Replay cannot be meaningful')

    // Kill the backend. server.close() only stops NEW connections, and Vite's
    // proxy agent holds a keep-alive socket, so without this route abort a
    // "replay" assertion could still be reading live data and pass vacuously.
    stub.close()
    stub = null
    await page.route('**/api/fr/**', (r) => r.abort('connectionrefused'))
    await openCatalog(page)
    if (await bodyHas(page, 'Fixture Valueweight Tee'))
      ok('snapshot replays the last-good grid with the backend dead')
    else bad('snapshot replays the last-good grid')
    if (await bodyHas(page, 'cached catalogue from', 5000))
      ok('grid staleness is labelled (cached-from banner)')
    else bad('grid staleness is labelled', 'no “cached catalogue from …” banner')
    // The DATE is the point of the banner: "cached" without a when forces the
    // user to guess how much to trust it. Matching only the constant prefix
    // let 'Invalid Date' (or a literal '{date}') through.
    const bannerDate = await page.evaluate(() => {
      const m = document.body.innerText.match(/cached catalogue from ([^.]+)\./)
      return m ? m[1].trim() : null
    })
    if (bannerDate && !/invalid date|\{date\}/i.test(bannerDate) && /\d{4}/.test(bannerDate))
      ok('banner carries a real date', bannerDate)
    else bad('banner carries a real date', `got ${JSON.stringify(bannerDate)}`)
    if (await bodyHas(page, 'Test mode', 5000)) ok('ws-mode badge replays from the snapshot')
    else bad('ws-mode badge replays from the snapshot')

    await page.click('text=Fixture Valueweight Tee')
    const detailBack = await bodyHas(page, 'Estimated measurements', 15000)
    const detailLabel = detailBack && (await bodyHas(page, 'from the cache', 5000))
    if (detailBack) ok('style detail replays from the snapshot')
    else bad('style detail replays from the snapshot')
    if (detailLabel) ok('detail staleness is labelled')
    else bad('detail staleness is labelled', 'no “from the cache” line in the detail')

    // ---- 3. backend BACK up, snapshot present: live must win ----
    // The strongest control in the file, and the only one positioned to catch
    // a cache-first regression: unlike the live phase above (which starts on a
    // fresh IndexedDB and so has nothing to serve stale), here a populated
    // snapshot and a working backend exist at the same time. Stale data must
    // lose, and the banner must disappear on its own.
    //
    // KNOWN LIMIT, stated so nobody reads more into a green run than is there:
    // this catches PERSISTENT shadowing, not a transient one. A cache-first
    // implementation that paints the snapshot and then replaces it when the
    // fetch lands self-corrects inside the settle window and passes, verified
    // by mutation. Catching that would mean sampling a race, which would buy a
    // flaky suite for a much smaller harm than the one guarded here.
    // (Mutation-tested the other way too: disabling frCache's reads turns the
    // section-2 replay checks red, so they are not vacuous.)
    section('3. Backend restored with a snapshot present: live wins')
    await page.unroute('**/api/fr/**')
    stub = await stubApi()
    await openCatalog(page)
    if (await bodyHas(page, 'Fixture Valueweight Tee')) ok('grid renders with the backend back up')
    else bad('grid renders with the backend back up')
    if (await bodyLacks(page, 'cached catalogue from', 2500))
      ok('the cache banner clears once live data is available again')
    else bad('stale banner persists over a working backend', 'the snapshot is shadowing live data')
    await ctx.close()
  }

  section(failures ? `${failures} FAILURE(S)` : 'All checks passed.')
  await done(failures ? 1 : 0)
} catch (e) {
  console.error(e)
  await done(1)
}
