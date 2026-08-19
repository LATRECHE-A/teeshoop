#!/usr/bin/env node
/**
 * The site, driven and photographed, and asserted while it is open.
 *
 *   node scripts/site-shots.mjs [base] [outDir]
 *
 * Seven pages at three widths, which is the evidence the session brief asks for.
 * It also ASSERTS, because a screenshot proves a page rendered and nothing else,
 * and because two of the things this session added cannot be checked any other
 * way:
 *
 *   THE FACET COUNTS ARE NOT DECORATIVE. Every number beside a checkbox claims
 *   "this many references remain if you tick me". The suite ticks one and counts
 *   what comes back. A count computed with the facet's own selection applied,
 *   which is the obvious and wrong way to write it, fails here.
 *
 *   THE FILTERS WORK WITHOUT JAVASCRIPT. The whole panel is a GET form on
 *   purpose. One pass runs with scripting disabled and submits it.
 *
 * Plus the things that are cheap to check and expensive to discover late: no
 * horizontal scroll at 375 px, one `h1` per page, an alt on every image, no
 * console error, no placeholder text left behind, and the headline price on the
 * homepage equal to the one the REST grid publishes.
 *
 * Exit: 0 all assertions passed - 1 an assertion failed - 2 nothing was asserted.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = (process.argv[2] || 'http://localhost:8080').replace(/\/$/, '')
const OUT = process.argv[3] || 'docs/screens/session09'
const WIDTHS = [375, 768, 1440]

const PAGES = [
  ['accueil', '/'],
  ['catalogue', '/shop/'],
  ['categorie', '/product-category/t-shirts/'],
  ['produit', '/product/teeshoop-demo-tee/'],
  ['studio', '/product/teeshoop-demo-tee/?personnaliser=1'],
  ['devis', '/devis/'],
  ['entreprises', '/entreprises/'],
]

/* Words that must never survive into a shipped page. */
const PLACEHOLDERS = [/lorem ipsum/i, /\bTODO\b/, /\bFIXME\b/, /Sample Page/i, /\bplaceholder\b/i]

mkdirSync(OUT, { recursive: true })

/*
 * IS THE EDITOR'S OWN ORIGIN UP?
 *
 * The studio is served cross-origin by the Cloudflare Worker. This gate drives
 * the SHOP; it does not start a Worker, and `npm run verify:wp-e2e` is the one
 * that does, with a real browser, a real upload and a real cart. When the Worker
 * is not running the frame simply fails to connect, and the parent page logs the
 * failure. Failing the console assertion on that would be this gate reporting
 * that another gate's dependency is not running, which is noise, so it is stated
 * instead: what was not checked is printed, and only for that page.
 */
const shopAnswers = await (async () => {
  try {
    const res = await fetch(`${BASE}/wp-json/`, { cache: 'no-store' })
    if (!res.ok) return null
  } catch {
    return null
  }
  return true
})()
if (!shopAnswers) {
  console.error(`site-shots: ${BASE} does not answer. Start the mirror with npm run wp:up.`)
  process.exit(2)
}

const results = []
const skipped = []
const skip = (name, why) => {
  skipped.push({ name, why })
  console.log(`SKIP ${name}  ${why}`)
}
const ok = (name, pass, extra = '') => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`)
  return pass
}

const browser = await chromium.launch()

/* ------------------------------------------------------- the six pages -- */

for (const [name, path] of PAGES) {
  for (const width of WIDTHS) {
    const context = await browser.newContext({
      viewport: { width, height: width < 500 ? 900 : 1000 },
      deviceScaleFactor: 2,
      locale: 'fr-FR',
    })
    const page = await context.newPage()
    const noise = []
    page.on('pageerror', (e) => noise.push(`script: ${e.message.slice(0, 160)}`))
    page.on('console', (m) => {
      if (m.type() === 'error') noise.push(`console: ${m.text().slice(0, 160)}`)
    })

    const res = await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 60000 })
    ok(`[${width}] ${name} answers 200`, res && res.status() === 200, String(res && res.status()))

    await page.screenshot({ path: `${OUT}/${name}-${width}.png`, fullPage: true })

    /*
     * NO HORIZONTAL SCROLL. Mobile first is a claim and this is the number
     * behind it. The masthead broke this on every page at 375 px before it was
     * measured: 457 px of bar in a 375 px viewport.
     */
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth)
    ok(`[${width}] ${name} does not scroll sideways`, scrollW <= width, `${scrollW} px`)

    const h1s = await page.locator('main h1').count()
    ok(`[${width}] ${name} has exactly one h1`, h1s === 1, String(h1s))

    const noAlt = await page.evaluate(
      () => [...document.images].filter((i) => !i.hasAttribute('alt')).map((i) => i.currentSrc).slice(0, 3),
    )
    ok(`[${width}] ${name} gives every image an alt`, noAlt.length === 0, noAlt.join(' '))

    const text = await page.evaluate(() => document.body.innerText)
    const found = PLACEHOLDERS.filter((re) => re.test(text)).map(String)
    ok(`[${width}] ${name} ships no placeholder text`, found.length === 0, found.join(' '))

    /*
     * `ERR_NETWORK_CHANGED` is Chromium saying the machine's network interface
     * moved under it, not the page saying anything. It is dropped by name,
     * here, rather than by widening the filter to "errors that mention a URL".
     */
    const ours = noise.filter((n) => !n.includes('ERR_NETWORK_CHANGED'))
    if ('studio' === name && ours.length > 0 && ours.every((n) => /Failed to load resource/.test(n))) {
      skip(
        `[${width}] ${name} logs nothing to the console`,
        'the editor is served by the Worker, which this gate does not start; npm run verify:wp-e2e drives it',
      )
    } else {
      ok(`[${width}] ${name} logs nothing to the console`, ours.length === 0, ours.slice(0, 2).join(' | '))
    }

    await context.close()
  }
}

/* ------------------------------------------ the numbers, against their source -- */

{
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'fr-FR' })
  const page = await context.newPage()

  /*
   * THE HOMEPAGE PRICE IS THE SHOP'S PRICE.
   *
   * `Pricing::grid()` is the authority; the REST route publishes it; the
   * homepage reads `Pricing::headline()`, which takes its anchors out of that
   * same grid. If a template ever formats a price itself, these two stop
   * agreeing here rather than on an invoice.
   */
  const grid = await (await fetch(`${BASE}/wp-json/teeshoop/v1/grid?garment=tee`)).json()
  const cells = (grid.rows || []).flatMap((r) => r.cells || [])
  const best = cells.filter((c) => !c.needs_quote).sort((a, b) => a.unit_ht - b.unit_ht)[0]

  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  const fact = (await page.locator('.ts-facts__value').first().innerText()).replace(/\s/g, ' ')
  const expected = (best.unit_ht / 100).toFixed(2).replace('.', ',')
  ok('the homepage price is the one the grid publishes', fact.includes(expected), `${fact.trim()} vs ${expected}`)

  /*
   * THE PRINT ZONE ON THE HOMEPAGE IS THE ONE THE STUDIO GENERATED.
   *
   * `data/garments.json` is generated from the studio's own definitions and
   * `npm run verify:garments` fails when they diverge. This checks the third
   * copy, the one a customer reads.
   */
  const garments = JSON.parse(
    await (await fetch(`${BASE}/wp-content/plugins/teeshoop-core/data/garments.json`)).text(),
  )
  const tee = garments.garments.tee
  const priced = tee.pricedSize
  const front = tee.areas.find((a) => a.side === 'front').bySize[priced]
  const zoneText = await page.locator('.ts-zone').innerText()
  const w = String(front.wCm).replace('.', ',')
  const h = String(front.hCm).replace('.', ',')
  ok(
    'the printed zone on the homepage is the generated one',
    zoneText.includes(w) && zoneText.includes(h),
    `${w} x ${h} cm`,
  )

  /* The quote path is one click from every page. */
  const devisHref = await page.locator('.ts-mast__quote').getAttribute('href')
  ok('the quote page is one click from the masthead', /\/devis\/?$/.test(devisHref || ''), devisHref || '')

  /*
   * THE FACET COUNTS ARE HONEST.
   *
   * Read the number beside the first checkbox of the brand facet, tick it,
   * submit, and count what the listing shows. They have to be the same number.
   */
  await page.goto(BASE + '/product-category/t-shirts/', { waitUntil: 'networkidle' })
  const chip = page.locator('.ts-facet:has(legend:text-is("Marque")) .ts-chip').first()
  const claimed = Number((await chip.locator('.ts-chip__n').innerText()).replace(/\D/g, ''))
  await chip.click()
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }),
    page.locator('.ts-filters .ts-cta').click(),
  ])
  /*
   * Compared against the LISTING'S OWN TOTAL, not against the number of `li`
   * elements on screen. Counting the cards works only while the result fits on
   * one page: the day a facet returns more than `loop_shop_per_page` the
   * assertion would fail on pagination and say nothing about the count.
   */
  const shown = Number(((await page.locator('.ts-shop__count').innerText()) || '').replace(/\D/g, ''))
  const cards = await page.locator('ul.products li.product').count()
  ok(
    'a facet count is what the facet actually returns',
    claimed === shown,
    `annoncé ${claimed}, obtenu ${shown} (${cards} sur cette page)`,
  )

  const applied = await page.locator('.ts-applied__item').count()
  ok('the applied filter says so and can be removed', applied === 1, `${applied} chip(s)`)

  /* A filtered listing is not a page to index. */
  const robots = await page.locator('meta[name="robots"]').getAttribute('content')
  ok('a filtered listing is noindex', /noindex/.test(robots || ''), robots || '(aucune)')

  await context.close()
}

/* ------------------------------------------------ keyboard, and the names -- */

/*
 * WHAT A PERSON WITHOUT A MOUSE CAN DO.
 *
 * Session 12 audits accessibility, and the session brief is explicit that
 * retrofitting focus is the one thing that cannot be done cheaply later. These
 * five are the load-bearing ones, and they are asserted rather than checked
 * once, because a checked-once claim decays on the next stylesheet.
 */
{
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'fr-FR' })
  const page = await context.newPage()
  await page.goto(BASE + '/product-category/t-shirts/', { waitUntil: 'networkidle' })

  await page.keyboard.press('Tab')
  const first = await page.evaluate(() => {
    const el = document.activeElement
    const cs = getComputedStyle(el)
    return {
      cls: (el.className || '').toString(),
      onScreen: el.getBoundingClientRect().left >= 0,
      ring: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0,
    }
  })
  ok('the first tab stop is the skip link', first.cls.includes('ts-skip'), first.cls)
  ok('and it becomes visible, with a focus ring', first.onScreen && first.ring, JSON.stringify(first))

  await page.evaluate(() => document.activeElement.blur())

  /*
   * FOCUS IS MOVED INTO THE MENU FIRST, or the assertion is vacuous.
   *
   * Clicking the button leaves focus on the button, so "focus is on the button
   * after Escape" is true whether or not anything hands it back. Checked by
   * deleting `burger.focus()` from site.js: the first version of this assertion
   * still passed. A person who opens the menu is inside it by the time they give
   * up on it, and that is the state that has to be tested.
   */
  await page.locator('.ts-burger').click()
  const opened = await page.locator('#ts-nav').evaluate((e) => e.classList.contains('is-open'))
  await page.locator('#ts-nav a').first().focus()
  const inside = await page.evaluate(() => !!document.activeElement.closest('#ts-nav'))
  await page.keyboard.press('Escape')
  const closed = await page.evaluate(() => ({
    open: document.getElementById('ts-nav').classList.contains('is-open'),
    onBurger: document.activeElement.classList.contains('ts-burger'),
  }))
  ok(
    'escape closes the menu and hands focus back',
    opened && inside && !closed.open && closed.onBurger,
    JSON.stringify({ opened, inside, ...closed }),
  )

  await page.locator('.ts-filters__toggle').focus()
  await page.keyboard.press('Enter')
  ok(
    'the filter panel opens from the keyboard',
    await page.locator('#ts-filters-body').evaluate((e) => e.classList.contains('is-open')),
  )

  /*
   * A control with no accessible name is a control a screen reader announces as
   * "button". The chips hide their checkbox visually and must never hide it from
   * the accessibility tree, which is why they are a `<label>` and not a `<div>`.
   */
  const nameless = await page.evaluate(() =>
    [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea')]
      .filter((el) => {
        const name =
          el.getAttribute('aria-label') ||
          el.textContent ||
          el.getAttribute('title') ||
          (el.labels && el.labels[0] && el.labels[0].textContent) ||
          el.getAttribute('placeholder') ||
          ''
        return name.trim() === ''
      })
      .map((el) => el.tagName.toLowerCase() + '.' + (el.className || '').toString().slice(0, 40))
      .slice(0, 5),
  )
  ok('every control has an accessible name', nameless.length === 0, nameless.join(' '))

  await context.close()
}

/* --------------------------------------------------- and without a script -- */

{
  const context = await browser.newContext({
    viewport: { width: 375, height: 900 },
    locale: 'fr-FR',
    javaScriptEnabled: false,
  })
  const page = await context.newPage()
  await page.goto(BASE + '/product-category/t-shirts/', { waitUntil: 'domcontentloaded' })

  const navVisible = await page.locator('#ts-nav a').first().isVisible()
  ok('the navigation is reachable with no script', navVisible)

  const panelVisible = await page.locator('.ts-filters__body').isVisible()
  ok('the filter panel is open with no script', panelVisible)

  /*
   * Clicked through the LABEL, the way a person does. The checkbox itself is
   * visually replaced by the chip (never removed from the accessibility tree),
   * so a direct `.check()` on the input is not a real interaction and Playwright
   * says so: "span.ts-chip__label intercepts pointer events".
   */
  const chip = page.locator('.ts-facet:has(legend:text-is("Marque")) .ts-chip').first()
  await chip.click()
  const checked = await chip.locator('input').isChecked()
  ok('a facet chip toggles its checkbox with no script', checked)
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }),
    page.locator('.ts-filters .ts-cta').click(),
  ])
  ok('the filters submit with no script', /f_marque/.test(page.url()), page.url())

  await context.close()
}

await browser.close()

const failed = results.filter((r) => !r.pass)
if (results.length === 0) {
  console.error('site-shots: nothing was asserted, which is not the same as everything passing.')
  process.exit(2)
}
console.log(
  `\nsite-shots ${failed.length ? 'FAIL' : 'PASS'}: ${results.length - failed.length}/${results.length} assertions` +
    (skipped.length ? `, ${skipped.length} skipped and said so` : '') +
    `, ${PAGES.length * WIDTHS.length} shots in ${OUT}`,
)
for (const s of skipped) console.log(`  not checked: ${s.name} - ${s.why}`)
process.exit(failed.length ? 1 : 0)
