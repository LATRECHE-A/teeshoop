#!/usr/bin/env node
/**
 * What the theme decision actually costs a visitor, measured.
 *
 *   node scripts/theme-bench.mjs [url]
 *
 * Session 09 chose a classic theme we own over a block theme, and the reasons
 * that matter are not performance: a block theme puts the page structure in the
 * database, where the repository cannot check it, and WooCommerce's block
 * product template strips the studio iframe through `wp_kses_post`. But the
 * decision record also claims a classic theme is cheaper to serve on shared
 * hosting, and a claim in a comment is worth nothing without a number.
 *
 * So this switches the mirror between the two, hits the same URL, and prints
 * what each one costs. It ALWAYS puts the theme back, including when it fails.
 *
 * IT IS NOT A CONTROLLED A/B OF "CLASSIC VS BLOCK". Two themes differ in more
 * than their kind, and ours renders a filter panel Twenty Twenty-Five does not.
 * What it measures is what a visitor to THIS shop would actually download and
 * wait for under each, which is the only comparison that decides anything.
 *
 * Exit: 0 both themes measured - 1 a measurement failed - 2 nothing was measured.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const URL_ = process.argv[2] || 'http://localhost:8080/shop/'
const RUNS = 15
const WARMUP = 3
const COMPOSE = ['compose', '-f', 'wp-local/docker-compose.yml', 'run', '--rm', '-T', 'wpcli']

const wp = (...args) =>
  execFileSync('docker', [...COMPOSE, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const active = () => wp('option', 'get', 'stylesheet')

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Server time to the first byte and the size of the HTML it produced. */
async function serverSide(url) {
  const ttfbs = []
  let bytes = 0
  for (let i = 0; i < WARMUP + RUNS; i++) {
    const t0 = performance.now()
    const res = await fetch(url, { cache: 'no-store' })
    const body = await res.text()
    const dt = performance.now() - t0
    if (i >= WARMUP) {
      ttfbs.push(dt)
      bytes = body.length
    }
  }
  return { ms: median(ttfbs), html: bytes }
}

/** What the browser actually downloads, and how long until it can paint. */
async function browserSide(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'fr-FR' })
  const page = await context.newPage()
  let transferred = 0
  let requests = 0
  page.on('response', async (r) => {
    requests++
    try {
      const len = Number((await r.allHeaders())['content-length'] || 0)
      transferred += Number.isFinite(len) ? len : 0
    } catch {
      /* a response that went away before we could read it is not a measurement */
    }
  })
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 })
  const paint = await page.evaluate(() => {
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]
    return fcp ? Math.round(fcp.startTime) : null
  })
  const sheets = await page.evaluate(() => document.styleSheets.length)
  await context.close()
  return { transferred, requests, paint, sheets }
}

const started = active()
const results = []
let failed = false
let browser

try {
  browser = await chromium.launch()
  for (const theme of ['teeshoop', 'twentytwentyfive']) {
    try {
      wp('theme', 'activate', theme)
    } catch (e) {
      console.error(`FAIL could not activate ${theme}: ${String(e).slice(0, 200)}`)
      failed = true
      continue
    }
    const server = await serverSide(URL_)
    const client = await browserSide(browser, URL_)
    results.push({ theme, ...server, ...client })
  }
} finally {
  if (browser) await browser.close()
  try {
    wp('theme', 'activate', started)
    /*
     * AND FLUSH THE REWRITE RULES.
     *
     * `switch_theme` fires `after_switch_theme`, and a block theme registers
     * post types and templates a classic one does not. Switching away and back
     * left this mirror with rules that no longer resolved `/devis/`, which
     * answered 404 while `get_permalink()` still returned the pretty URL: the
     * page existed, the link was right, and the address did not work. A
     * benchmark has no business leaving a shop in that state.
     */
    wp('rewrite', 'flush')
  } catch (e) {
    console.error(`the theme could NOT be put back to ${started}: ${String(e).slice(0, 200)}`)
    failed = true
  }
}

if (results.length < 2) {
  console.error(`theme-bench: measured ${results.length} theme(s), which proves nothing.`)
  process.exit(2)
}

console.log(`\n${URL_}   median of ${RUNS} requests, warm\n`)
console.log(
  ['theme', 'server ms', 'html kb', 'transferred kb', 'requests', 'stylesheets', 'first paint ms']
    .map((h, i) => (i ? h.padStart(15) : h.padEnd(20)))
    .join(''),
)
for (const r of results) {
  console.log(
    [
      r.theme.padEnd(20),
      r.ms.toFixed(0).padStart(15),
      (r.html / 1024).toFixed(1).padStart(15),
      (r.transferred / 1024).toFixed(1).padStart(15),
      String(r.requests).padStart(15),
      String(r.sheets).padStart(15),
      String(r.paint ?? '?').padStart(15),
    ].join(''),
  )
}

const [ours, theirs] = results
console.log(
  `\n${theirs.theme} costs ${(theirs.ms / ours.ms).toFixed(2)}x the server time, ` +
    `${(theirs.transferred / ours.transferred).toFixed(2)}x the bytes and ` +
    `${(theirs.requests / ours.requests).toFixed(2)}x the requests of ${ours.theme}, on the same page.`,
)
console.log('theme restored to ' + started)

process.exit(failed ? 1 : 0)
