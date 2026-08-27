#!/usr/bin/env node
/**
 * Core Web Vitals, on a throttled mobile profile, page type by page type.
 *
 *   node scripts/cwv-bench.mjs                    every page type, 5 runs each
 *   node scripts/cwv-bench.mjs --pages=categorie  one of them
 *   node scripts/cwv-bench.mjs --runs=3 --etiquette=apres
 *
 * WHY A HARNESS AND NOT A ONE-OFF. Session 13 is a before/after session: every
 * claim it makes about speed has to be a diff against a number taken before the
 * change, on the same instrument. A number produced once by hand cannot be
 * re-taken, so it cannot prove anything later. This writes both a JSON file and
 * a table, and the JSON is what the second run is compared against.
 *
 * THE INSTRUMENT, stated so a reading is reproducible and so nobody compares two
 * numbers taken on different ones:
 *
 *   viewport      375 x 812 CSS px, device pixel ratio 3, touch, mobile UA.
 *                 375 px because that is the width this project designs at
 *                 (CLAUDE.md section 7) and because the srcset a phone actually
 *                 picks depends on the ratio.
 *   network       1,6 Mbit/s down, 750 kbit/s up, 150 ms RTT. This is
 *                 Lighthouse's "slow 4G", which is the profile a French mobile
 *                 buyer on a train has, not the one they have on the platform.
 *   processor     4x slowdown, again Lighthouse's mobile default. Most of what
 *                 WordPress serves is parsed and laid out on that processor.
 *   cache         cold. Each measured run gets a NEW browser context, so the
 *                 reading is a first visit. The server is warmed once first,
 *                 because a cold opcache measures PHP starting up rather than
 *                 the page.
 *
 * WHAT IS MEASURED, and what each one fails as:
 *
 *   TTFB   how long the server thought. Everything else waits behind it.
 *   FCP    when the visitor stops looking at nothing.
 *   LCP    the Core Web Vital. Good under 2500 ms, poor over 4000 ms.
 *   CLS    the Core Web Vital for stability. Good under 0,1.
 *   TBT    total blocking time, the load-time proxy for INP. INP itself needs a
 *          real interaction and is measured separately by --interaction on the
 *          pages that have one; a page that blocks the main thread for a second
 *          during load will miss the first tap whatever INP says afterwards.
 *
 * The weight breakdown is included because it is what the fixes act on: an LCP
 * number with no bytes beside it says a page is slow and not why.
 *
 * Exit: 0 measured, 1 a page failed to load, 2 NOTHING was measured, which is
 * not a pass. A harness that scans nothing must not print a tick.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT_DIR = join(ROOT, 'docs', 'perf')

const ARGS = process.argv.slice(2)
const arg = (name, fallback) => {
  const hit = ARGS.find((a) => a.startsWith(`--${name}=`))
  return hit === undefined ? fallback : hit.slice(name.length + 3)
}

const SHOP = arg('shop', 'http://localhost:8080').replace(/\/$/, '')
const RUNS = Number(arg('runs', '5'))
const LABEL = arg('etiquette', 'avant')
const ONLY = arg('pages', '')
const HEADLESS = !ARGS.includes('--tete')

/* Lighthouse's mobile emulation, verbatim. Changing any of these invalidates
 * every stored reading, which is why they are constants and not options. */
const NET = { offline: false, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, latency: 150 }
const CPU_SLOWDOWN = 4
const VIEWPORT = { width: 375, height: 812 }
const DPR = 3
const UA =
  'Mozilla/5.0 (Linux; Android 12; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36'

/*
 * THE PAGE TYPES. Session 13 names six and they are the six a buyer walks
 * through, not the six that are easiest to measure.
 *
 * `panier` and `commande` need a cart, so they carry a `prepare` that puts one
 * line in it before the reading. Without it both render their empty state,
 * which is a different page and a much lighter one: measuring that and calling
 * it the checkout would be measuring the wrong thing on purpose.
 */
const PAGES = [
  { key: 'accueil', label: 'Accueil', path: '/' },
  { key: 'categorie', label: 'Catégorie (139 références)', path: '/categorie/manches-courtes/' },
  { key: 'categorie-filtree', label: 'Catégorie, deux facettes', path: '/categorie/manches-courtes/?f_couleur[]=white&f_taille[]=m' },
  { key: 'produit', label: 'Fiche produit (catalogue)', path: '/produit/bc-e150-women-t-shirt/' },
  { key: 'produit-studio', label: 'Fiche produit avec le studio', path: null, resolve: 'studio' },
  { key: 'panier', label: 'Panier, une ligne', path: '/cart/', prepare: true },
  { key: 'commande', label: 'Commander, une ligne', path: '/checkout/', prepare: true },
]

const median = (xs) => {
  const s = [...xs].filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (s.length === 0) return null
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Collect the vitals from inside the page.
 *
 * Registered through `addInitScript` so the observers exist BEFORE the document
 * does. A PerformanceObserver added after load misses every entry that has
 * already been buffered away, and the buffered flag only covers some types, so
 * an LCP read late is an LCP read wrong.
 */
const COLLECTOR = `
window.__ts = { lcp: 0, cls: 0, clsMax: 0, fcp: 0, longtasks: [], shifts: [] };
try {
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__ts.lcp = e.startTime;
  }).observe({ type: 'largest-contentful-paint', buffered: true });
} catch (e) {}
try {
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__ts.fcp = e.startTime;
  }).observe({ type: 'paint', buffered: true });
} catch (e) {}
try {
  /* CLS is the largest SESSION WINDOW, not the sum: a 1 s gap or a 5 s window
     starts a new one. Summing every shift overstates a long page and is the
     usual way a hand-rolled CLS disagrees with the field data. */
  let cur = 0, first = 0, last = 0;
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      if (e.hadRecentInput) continue;
      window.__ts.shifts.push({ v: e.value, t: e.startTime });
      if (cur && (e.startTime - last > 1000 || e.startTime - first > 5000)) cur = 0;
      if (!cur) first = e.startTime;
      last = e.startTime;
      cur += e.value;
      if (cur > window.__ts.clsMax) window.__ts.clsMax = cur;
    }
    window.__ts.cls = window.__ts.clsMax;
  }).observe({ type: 'layout-shift', buffered: true });
} catch (e) {}
try {
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__ts.longtasks.push({ start: e.startTime, dur: e.duration });
  }).observe({ type: 'longtask', buffered: true });
} catch (e) {}
`

const READ = `(() => {
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const res = performance.getEntriesByType('resource');
  const bucket = { document: 0, script: 0, css: 0, image: 0, font: 0, fetch: 0, other: 0 };
  const countBy = { document: 0, script: 0, css: 0, image: 0, font: 0, fetch: 0, other: 0 };
  const size = (e) => e.transferSize || e.encodedBodySize || 0;
  bucket.document += nav.transferSize || nav.encodedBodySize || 0;
  countBy.document += 1;
  for (const e of res) {
    let k = e.initiatorType;
    if (k === 'link' || k === 'style') k = 'css';
    else if (k === 'img' || k === 'imageset') k = 'image';
    else if (k === 'script') k = 'script';
    else if (k === 'css') k = 'css';
    else if (k === 'xmlhttprequest' || k === 'fetch' || k === 'beacon') k = 'fetch';
    else if (k === 'iframe' || k === 'navigation') k = 'other';
    else k = 'other';
    if (/\\.woff2?($|\\?)/.test(e.name)) k = 'font';
    else if (/\\.(png|jpe?g|webp|avif|gif|svg)($|\\?)/.test(e.name)) k = 'image';
    else if (/\\.css($|\\?)/.test(e.name)) k = 'css';
    else if (/\\.m?js($|\\?)/.test(e.name)) k = 'script';
    bucket[k] = (bucket[k] || 0) + size(e);
    countBy[k] = (countBy[k] || 0) + 1;
  }
  const t = window.__ts || {};
  const fcp = t.fcp || 0;
  /* TBT counts only what blocks AFTER first paint, and only the part of each
     task beyond 50 ms. Counting whole tasks, or tasks before FCP, is the usual
     way a hand-rolled TBT reads several times too high. */
  let tbt = 0;
  for (const lt of t.longtasks || []) {
    if (lt.start + lt.dur < fcp) continue;
    const start = Math.max(lt.start, fcp);
    const blocking = lt.start + lt.dur - start - 50;
    if (blocking > 0) tbt += blocking;
  }
  return {
    ttfb: nav.responseStart || 0,
    domContentLoaded: nav.domContentLoadedEventEnd || 0,
    load: nav.loadEventEnd || 0,
    fcp,
    lcp: t.lcp || 0,
    cls: Number((t.cls || 0).toFixed(4)),
    tbt: Math.round(tbt),
    longtasks: (t.longtasks || []).length,
    requests: res.length + 1,
    bytes: bucket,
    counts: countBy,
    total_bytes: Object.values(bucket).reduce((a, b) => a + b, 0),
  };
})()`

async function throttle(page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', NET)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN })
  return cdp
}

/**
 * One reading. A fresh context each time, so the browser cache is cold and the
 * number is a first visit rather than a second one.
 */
async function measure(browser, url, storageState) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DPR,
    isMobile: true,
    hasTouch: true,
    userAgent: UA,
    storageState,
  })
  await context.addInitScript(COLLECTOR)
  const page = await context.newPage()
  const failures = []
  page.on('requestfailed', (r) => failures.push(`${r.method()} ${r.url().slice(0, 120)}: ${r.failure()?.errorText}`))
  let status = 0
  try {
    const res = await page.goto(url, { waitUntil: 'load', timeout: 180000 })
    status = res ? res.status() : 0
    /* Let LCP settle. An LCP read at `load` is not final: a late image or a font
     * swap can still replace the candidate. Two seconds of quiet is what
     * Lighthouse waits for and it is enough here. */
    await page.waitForTimeout(2500)
  } catch (e) {
    await context.close()
    return { error: String(e.message || e).slice(0, 200), status }
  }
  const m = await page.evaluate(READ)
  await context.close()
  return { ...m, status, failures: failures.slice(0, 5) }
}

/** A cart with one real line, as a storage state the measured runs reuse. */
async function cartState(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT, userAgent: UA })
  const page = await context.newPage()
  await page.goto(`${SHOP}/?add-to-cart=60&quantity=2`, { waitUntil: 'load', timeout: 120000 })
  const state = await context.storageState()
  await context.close()
  return state
}

function resolveStudioUrl() {
  try {
    const out = execFileSync(
      'docker',
      ['compose', '-f', 'wp-local/docker-compose.yml', 'run', '--rm', '-T', 'wpcli', 'eval',
        'global $wpdb; $id=(int)$wpdb->get_var("SELECT post_id FROM {$wpdb->postmeta} WHERE meta_key=\'_teeshoop_garment\' AND meta_value<>\'\' LIMIT 1"); echo $id? get_permalink($id) : "";'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const url = (out.match(/https?:\/\/\S+/) || [''])[0].trim()
    return url || null
  } catch {
    return null
  }
}

const bytes = (n) => (n >= 1024 * 1024 ? `${(n / 1048576).toFixed(2)} Mo` : `${Math.round(n / 1024)} ko`)
const ms = (n) => (n === null ? '   n/a' : `${Math.round(n)}`.padStart(6))

async function main() {
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--host-resolver-rules=MAP host.docker.internal 127.0.0.1'],
  })

  const selected = ONLY ? PAGES.filter((p) => ONLY.split(',').includes(p.key)) : PAGES
  if (selected.length === 0) {
    console.error(`cwv-bench: aucune page ne correspond à --pages=${ONLY}`)
    process.exit(2)
  }

  let state
  if (selected.some((p) => p.prepare)) {
    try {
      state = await cartState(browser)
      console.log('panier préparé : une ligne, deux exemplaires du produit 60.')
    } catch (e) {
      console.error(`cwv-bench: le panier n'a pas pu être rempli (${String(e.message || e).slice(0, 120)})`)
    }
  }

  const results = []
  for (const p of selected) {
    let url
    if (p.resolve === 'studio') {
      url = resolveStudioUrl()
      if (!url) {
        console.log(`\n${p.label} : aucune fiche produit ne déclare de vêtement, page ignorée.`)
        continue
      }
    } else {
      url = SHOP + p.path
    }

    /* One unmeasured request first: opcache, the object cache and MySQL's own
     * buffers are cold on the first hit of a process and that is not what this
     * is measuring. */
    try {
      await fetch(url, { redirect: 'follow' }).then((r) => r.text())
    } catch {
      /* the measured run will report the failure properly */
    }

    const runs = []
    for (let i = 0; i < RUNS; i++) {
      const r = await measure(browser, url, p.prepare ? state : undefined)
      if (r.error) {
        console.error(`  ${p.key} run ${i + 1} : ${r.error}`)
        continue
      }
      runs.push(r)
    }
    if (runs.length === 0) {
      results.push({ ...p, url, runs: 0, error: 'aucune mesure' })
      continue
    }
    const pick = (f) => median(runs.map(f))
    const last = runs[runs.length - 1]
    results.push({
      key: p.key,
      label: p.label,
      url,
      runs: runs.length,
      status: last.status,
      ttfb: pick((r) => r.ttfb),
      fcp: pick((r) => r.fcp),
      lcp: pick((r) => r.lcp),
      cls: pick((r) => r.cls),
      tbt: pick((r) => r.tbt),
      load: pick((r) => r.load),
      requests: pick((r) => r.requests),
      total_bytes: pick((r) => r.total_bytes),
      bytes: last.bytes,
      counts: last.counts,
      failures: last.failures,
    })
    const r = results[results.length - 1]
    console.log(
      `\n${p.label}\n  ${url}\n` +
        `  TTFB ${ms(r.ttfb)} ms   FCP ${ms(r.fcp)} ms   LCP ${ms(r.lcp)} ms   ` +
        `CLS ${(r.cls ?? 0).toFixed(3)}   TBT ${ms(r.tbt)} ms\n` +
        `  ${r.requests} requêtes, ${bytes(r.total_bytes)} ` +
        `(html ${bytes(r.bytes.document)}, js ${bytes(r.bytes.script)}, css ${bytes(r.bytes.css)}, ` +
        `images ${bytes(r.bytes.image)}, polices ${bytes(r.bytes.font)})`,
    )
    if (r.failures?.length) console.log(`  requêtes en échec : ${r.failures.join(' | ')}`)
  }

  await browser.close()

  const measured = results.filter((r) => r.runs > 0)
  mkdirSync(OUT_DIR, { recursive: true })
  const path = join(OUT_DIR, `cwv-${LABEL}.json`)
  const payload = {
    label: LABEL,
    shop: SHOP,
    runs_per_page: RUNS,
    instrument: { viewport: VIEWPORT, dpr: DPR, network: 'slow 4G 1.6/0.75 Mbit/s 150 ms', cpu: `${CPU_SLOWDOWN}x`, cache: 'froid' },
    measured_at: new Date().toISOString(),
    pages: results,
  }
  writeFileSync(path, JSON.stringify(payload, null, 2))
  console.log(`\nécrit dans ${path.replace(ROOT + '/', '')}`)

  /* The comparison, when there is one to make. */
  const beforePath = join(OUT_DIR, 'cwv-avant.json')
  if (LABEL !== 'avant' && existsSync(beforePath)) {
    const before = JSON.parse(readFileSync(beforePath, 'utf8'))
    console.log('\nÉCART CONTRE LA MESURE « avant »\n')
    console.log('  page                              LCP avant    LCP après      écart')
    for (const r of measured) {
      const b = before.pages.find((x) => x.key === r.key)
      if (!b || !b.lcp) continue
      const d = r.lcp - b.lcp
      const pct = ((d / b.lcp) * 100).toFixed(0)
      console.log(
        `  ${r.key.padEnd(30)} ${ms(b.lcp)} ms  ${ms(r.lcp)} ms   ${d < 0 ? '-' : '+'}${Math.abs(Math.round(d))} ms (${pct} %)`,
      )
    }
  }

  /*
   * NOTHING MEASURED IS NOT A PASS. Every gate in this repository owes the same
   * distinction: "no problem found" and "nothing was looked at" are different
   * results and only one of them is a tick.
   */
  if (measured.length === 0) {
    console.error('\ncwv-bench : aucune page n’a pu être mesurée. Ce n’est pas un succès.')
    process.exit(2)
  }
  const broken = results.filter((r) => r.runs === 0 || (r.status && r.status >= 400))
  if (broken.length) {
    console.error(`\ncwv-bench : ${broken.length} page(s) n’ont pas répondu : ${broken.map((b) => b.key).join(', ')}`)
    process.exit(1)
  }
  console.log(`\ncwv-bench : ${measured.length} pages mesurées, ${RUNS} chargements chacune.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
