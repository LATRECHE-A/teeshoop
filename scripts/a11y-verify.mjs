#!/usr/bin/env node
/**
 * ACCESSIBILITY GATE: WCAG 2.2 AA on the buying path, measured in a real browser.
 *
 *   node scripts/a11y-verify.mjs [base]
 *
 * WHY THIS FILE COMPUTES ITS OWN RULES INSTEAD OF LOADING axe-core: axe is not a
 * dependency of this project and the session that needed this gate could not add
 * one. That constraint turned out to be useful rather than painful, because the
 * four criteria that actually bite this shop (2.4.11, 2.5.8, 2.5.3, 3.2.2) are
 * WCAG 2.2 additions that a rule engine reports as "incomplete" and a human then
 * has to judge. A gate that says "needs review" is a gate nobody runs twice.
 * Everything below produces a number, and every number was checked against a
 * value measured by hand on this shop first.
 *
 * WHAT IT DRIVES. The six pages a buyer walks through, at 375 px and at 1440 px,
 * plus /checkout/, which redirects to /cart/ while the cart is empty and is
 * therefore reported as NOT AUDITED rather than passed. Filling the cart needs
 * the whole personalised add-to-cart path, which `npm run verify:wp-e2e` owns.
 *
 * THE RULES, and the failure each one was calibrated against.
 *
 *   (a) 1.4.3 text contrast. Every element with its own text node, against the
 *       background resolved by walking its ancestors. 4,5:1, or 3:1 for large
 *       text. Calibrated on the single-product price: rgb(149, 142, 9) on white
 *       at 18,75 px weight 400, which is 3,41:1, out of WooCommerce's own sheet.
 *
 *   (b) 1.4.11 focus indicator contrast. Read at a real tab stop, never with
 *       el.focus(), because `:focus-visible` does not match a programmatic focus
 *       and the ring being measured would not be the ring a keyboard user sees.
 *       Calibrated on the skip link and the footer links: outline
 *       rgb(31, 79, 216) on rgb(20, 23, 26), which is 2,71:1.
 *
 *   (c) 2.4.11 focus not obscured. Every tab stop is hit-tested with
 *       elementsFromPoint. Run TWICE, once as a visitor who has already refused
 *       and once as a first visit, because with the refusal cookie the consent
 *       strip is gone and the rule looks clean: on a first visit it covers most
 *       of a 375 px viewport.
 *
 *   (d) 2.5.8 target size, 24 by 24 CSS px, with the spacing exception and a
 *       narrow reading of the inline exception implemented (see the rule).
 *
 *   (e) 2.5.3 label in name. Calibrated on the variable-product tiles, whose
 *       visible text is « Lire la suite » and whose accessible name is
 *       « Sélectionner les options pour ... ».
 *
 *   (f) 3.1.1 and 3.1.2. A short list of EXACT English strings, never a language
 *       guesser: this catalogue is full of English product names from the
 *       supplier (« Tee Jays Mountain Hooded Fleece ») that are not a defect, and
 *       a heuristic would drown the real finding in them.
 *
 *   (g) The cheap structural ones, which no other gate covers for these pages.
 *
 *   (h) 3.2.2 on input. Probed by dispatching a real change event with form
 *       submission intercepted, not by looking for an onchange attribute, which
 *       WooCommerce does not use.
 *
 * KNOWN LIMITS, stated because a limit nobody wrote down becomes a false clean:
 *   - a background-image (a gradient included) makes a background unresolvable;
 *     those elements are counted and printed as « non mesurables », never passed.
 *   - elementsFromPoint does not see an overlay with `pointer-events: none`, so
 *     rule (c) under-reports rather than over-reports.
 *   - rule (b) measures the ring against the focused element's own resolved
 *     background. A ring is also adjacent to whatever is outside its border box,
 *     which this does not look at, so it is a lower bound on the failures.
 *
 * THE SELF-TESTS RUN ON EVERY INVOCATION and are not behind a flag, for the
 * reason `scripts/consent-verify.mjs` gives: a `--self-test` whose green only
 * means "the harness can record a failure" gets quoted as if the shop had
 * passed. Each one breaks the real page in the real browser and requires the
 * real rule to name the element it broke. Any that stays silent exits 2.
 *
 * TWO THINGS FOUND IN A FILE THIS ONE MAY NOT TOUCH, so that they are not lost:
 * `scripts/site-shots.mjs` carries a weaker copy of « every control has an
 * accessible name » and of the one-h1 count, on one page at one width, and two
 * implementations of one rule is what this project forbids. It also writes a
 * `v1:` consent cookie, which `Consent::VERSION` stopped accepting the same
 * morning, so its « visitor who has already decided » passes are now driving a
 * shop with the banner still up. Both belong to whoever owns that file.
 *
 * Exit: 0 all assertions passed - 1 an assertion failed - 2 nothing was asserted
 *       (the shop was unreachable, or a self-test did not fire).
 */
import { chromium } from 'playwright'

const BASE = (process.argv.find((a) => a.startsWith('http')) || 'http://localhost:8080').replace(/\/$/, '')
const WIDTHS = [375, 1440]

/*
 * The buying path. `/checkout/` is here on purpose even though it cannot be
 * reached with an empty cart: a page silently dropped from a suite is a page
 * nobody remembers is unchecked.
 */
const PAGES = [
  ['accueil', '/'],
  ['catalogue', '/shop/'],
  ['categorie', '/categorie/t-shirts/'],
  ['produit', '/produit/teeshoop-demo-tee/'],
  ['panier', '/cart/'],
  ['devis', '/devis/'],
  ['commande', '/checkout/'],
  /*
   * The four legal pages, added in session 12 the day they existed. They are not
   * the buying path, and they are the pages a buyer is sent to from the checkout
   * to read what they are agreeing to: a contract nobody can read is a contract
   * nobody agreed to. They also carry the only definition lists on the site,
   * which is a structure none of the other pages exercises.
   */
  ['mentions', '/mentions-legales/'],
  ['cgv', '/cgv/'],
  ['confidentialite', '/confidentialite/'],
  ['accessibilite', '/accessibilite/'],
]

/*
 * ENGLISH THAT IS A DEFECT, listed one string at a time.
 *
 * The first three were measured on this shop on 26/08/2026. The rest are the
 * WooCommerce block strings that appear on the same two pages the moment the
 * cart is not empty, which this gate cannot make happen (see the /checkout/
 * note above), so they are armed in advance rather than discovered by a
 * customer. Nothing here is a pattern or a guess: an exact string, or nothing.
 */
const ANGLAIS = [
  'Your cart is currently empty!',
  'New in store',
  'Breadcrumb',
  'Proceed to Checkout',
  'Continue shopping',
  'Browse store',
  'Order summary',
  'Remove item',
  'Your cart',
  'Place Order',
  'Contact information',
  'Shipping address',
  'Billing address',
  'Payment options',
  'Delivery options',
  'Add to cart',
  'Select options',
  'Read more',
]

/* ---------------------------------------------------------------- harness */

const results = []
const notLooked = []
const fired = []

const ok = (name, pass, extra = '') => {
  results.push({ name, pass, extra })
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'} ${name}${extra ? `  (${extra})` : ''}\n`)
  return pass
}

/* « rien trouvé » and « rien regardé » are different results, and this is the second one. */
const notChecked = (name, why) => {
  notLooked.push({ name, why })
  process.stdout.write(`NON VERIFIE ${name}  (${why})\n`)
}

const die = (why) => {
  process.stdout.write(`\na11y-verify: ${why}\n`)
  process.exit(2)
}

/**
 * Load a page and wait until the document is really finished.
 *
 * NOT `networkidle`, and this is not a preference. Playwright resolves it after
 * 500 ms with no connections, and on `/cart/` the block bundle leaves gaps that
 * long WHILE THE PARSER IS STILL WORKING: three consecutive loads snapshotted a
 * DOM whose last element was missing. Every count below would then have been
 * taken off a half-built page, which is a gate that passes because it looked too
 * early. Measured an hour before this file was written, in consent-verify.mjs.
 */
const load = async (page, url) => {
  const res = await page.goto(url, { waitUntil: 'load', timeout: 45000 })
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 45000 })
  return res
}

/*
 * A VISITOR WHO HAS ALREADY DECIDED, carrying the cookie THE SHOP ITSELF WROTE.
 *
 * Not a hand-written `v1:<date>:`. `Consent::VERSION` went from 1 to 2 the
 * morning this file was written, and an older version is deliberately read as
 * no choice at all, so a hard-coded one dismisses nothing: the gate then audits
 * a shop wearing the banner it believed it had put away, and every number moves
 * without a single assertion changing. Measured here first: the first run of
 * this file reported 67 obscured tab stops for a « visitor who has decided ».
 * scripts/site-shots.mjs still hard-codes v1 and has the same hole.
 *
 * So the refusal is performed once, by clicking the real button, and the cookie
 * that comes out of it is reused. Every decided pass then asserts that the strip
 * really is gone, which is what makes a future format change fail loudly.
 */
let refusCookie = null

const enregistreRefus = async (browser) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'fr-FR' })
  const page = await context.newPage()
  await load(page, BASE + '/')
  await page.click('#ts-consent button[name="rien"]')
  await page.waitForLoadState('load')
  const c = (await context.cookies()).find((x) => x.name === 'teeshoop_choix')
  refusCookie = c ? c.value : null
  await context.close()
  return refusCookie
}

const decided = (context) => context.addCookies([{ name: 'teeshoop_choix', value: refusCookie, url: BASE }])

const MAX_STOPS = 400

/* ------------------------------------------------------- the rules, in the page */

/**
 * Everything that has to read computed style, geometry or the hit-test stack
 * lives here, installed before any page script by `addInitScript`. Playwright
 * serialises this function, so it closes over nothing: what it needs, it is
 * given.
 */
const HELPERS = () => {
  const A = {}
  window.__a11y = A

  /* ----------------------------------------------------------------- colour */

  /*
   * Chromium answers `rgb(r, g, b)`, `rgba(r, g, b, a)`, and `color(srgb r g b
   * / a)` with the channels in 0..1 whenever the declaration went through
   * `color-mix()`, which is how the footer paints its separator. The third form
   * was found by this gate reporting one « non mesurable » on every page.
   * Anything else parses to null and is counted as non mesurable, never passed.
   */
  const parse = (v) => {
    const s = String(v).trim()
    const srgb = s.match(/^color\(srgb ([^)]+)\)$/)
    if (srgb) {
      const p = srgb[1].split(/[\s/]+/).filter(Boolean).map(Number)
      if (p.length < 3 || p.some((n) => Number.isNaN(n))) return null
      return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1]
    }
    const m = s.match(/^rgba?\(([^)]+)\)$/)
    if (!m) return null
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number)
    if (p.length < 3 || p.some((n) => Number.isNaN(n))) return null
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]
  }

  const rgbStr = (c) => `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`

  const over = (top, bottom) => {
    const a = top[3]
    if (a >= 1) return [top[0], top[1], top[2], 1]
    return [
      top[0] * a + bottom[0] * (1 - a),
      top[1] * a + bottom[1] * (1 - a),
      top[2] * a + bottom[2] * (1 - a),
      1,
    ]
  }

  /*
   * sRGB relative luminance. The 0.04045 knee is the one in the sRGB spec and in
   * scripts/site-shots.mjs; WCAG 2.0's text says 0.03928 and the two differ by
   * less than 0.0001 in the resulting ratio, which is below the two decimals
   * anything here is compared at.
   */
  const lum = (c) => {
    const f = (v) => {
      const x = v / 255
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
  }

  const round2 = (n) => Math.round(n * 100) / 100
  const ratio = (a, b) => {
    const la = lum(a)
    const lb = lum(b)
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
  }

  /* Exposed so the harness can check the scale itself against published pairs. */
  A.ratio = (a, b) => {
    const x = parse(a)
    const y = parse(b)
    return x && y ? round2(ratio(x, y)) : null
  }

  /* ------------------------------------------------------------- identity */

  const path = (el) => {
    if (!el || el.nodeType !== 1) return '(aucun)'
    const bits = []
    let n = el
    while (n && n.nodeType === 1 && bits.length < 5) {
      let b = n.tagName.toLowerCase()
      if (n.id) {
        bits.unshift(b + '#' + n.id)
        break
      }
      const cls = (n.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
      if (cls.length) b += '.' + cls.join('.')
      const sibs = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : []
      if (sibs.length > 1) b += `:n${sibs.indexOf(n) + 1}`
      bits.unshift(b)
      n = n.parentElement
    }
    return bits.join('>')
  }

  /* ---------------------------------------------------------- what is painted */

  /*
   * Off the page rather than below the fold. getBoundingClientRect is relative
   * to the viewport, so the scroll offset has to be added back or everything
   * above the fold looks hidden as soon as the tab walk has scrolled: that is
   * the difference between « parked at left:-9999px », which the skip link is
   * until it takes focus, and « further down the page », which most of a shop
   * is.
   */
  const offPage = (r) => r.right + window.scrollX <= 0 || r.bottom + window.scrollY <= 0

  /*
   * A 1 by 1 box is the `.screen-reader-text` pattern (WordPress clips it with
   * `clip-path: inset(50%)`), so it paints no pixel a sighted person can read
   * and has no contrast and no target size to check. It still carries an
   * accessible name, which is why the name rules use a different filter.
   */
  const painted = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility !== 'visible' || Number(cs.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    if (r.width <= 1 || r.height <= 1) return false
    if (offPage(r)) return false
    return true
  }

  /*
   * The effective background under an element.
   *
   * Walks ancestors until something opaque, compositing every translucent layer
   * it passes on the way. Two things make it refuse rather than guess: a
   * background-image (we cannot know which pixel the text sits on) and an
   * opacity below 1 anywhere up the chain (the painted colour is then a blend
   * with whatever is behind, which the DOM does not tell us). Refusals are
   * counted and printed; they are never counted as a pass.
   *
   * The DOM chain is not the paint order: an absolutely positioned element over
   * a different-coloured panel resolves to its ancestor's background, not to the
   * pixel underneath. That is the same approximation every contrast tool makes.
   */
  const effBg = (el) => {
    const layers = []
    let n = el
    while (n && n.nodeType === 1) {
      const cs = getComputedStyle(n)
      if (cs.backgroundImage && cs.backgroundImage !== 'none') {
        return { unresolved: `image de fond sur ${path(n)}` }
      }
      const o = Number(cs.opacity)
      if (!Number.isNaN(o) && o < 1) return { unresolved: `opacité ${o} sur ${path(n)}` }
      const c = parse(cs.backgroundColor)
      if (!c) return { unresolved: `couleur illisible « ${cs.backgroundColor} » sur ${path(n)}` }
      if (c[3] > 0) {
        layers.push(c)
        if (c[3] >= 1) break
      }
      n = n.parentElement
    }
    /* Nothing opaque up to the root: the canvas is white in a browser with no
     * page background, which is what this shop serves. */
    let acc = [255, 255, 255, 1]
    for (let i = layers.length - 1; i >= 0; i--) acc = over(layers[i], acc)
    return { color: acc }
  }

  /* -------------------------------------------------------------- the names */

  /*
   * Text as a person reads it: hidden subtrees dropped, the sr-only ones too,
   * and a space inserted at every block boundary because two blocks that touch
   * in the markup are two lines on screen. Without that space the related
   * product tile read « Sans photoT-shirt personnalisable » and rule (e)
   * reported a mismatch that was the harness's own concatenation.
   *
   * `aria-hidden="true"` is dropped as well. An author who takes a fragment out
   * of the accessibility tree has said it is not part of the label, which is
   * the correct thing to do for the « Sans photo » stand-in that sits inside a
   * `role="img"` carrying its own aria-label. The cost of that decision, stated
   * so nobody has to rediscover it: a REAL label wrongly marked aria-hidden is
   * invisible to this rule.
   */
  const blockish = (n) => !getComputedStyle(n).display.startsWith('inline')

  const visibleText = (el) => {
    let out = ''
    const walk = (n) => {
      if (n.nodeType === 3) {
        out += n.textContent
        return
      }
      if (n.nodeType !== 1) return
      if (n.getAttribute('aria-hidden') === 'true') return
      const cs = getComputedStyle(n)
      if (cs.display === 'none' || cs.visibility === 'hidden') return
      const r = n.getBoundingClientRect()
      if (r.width <= 1 && r.height <= 1) return
      const gap = blockish(n)
      if (gap) out += ' '
      for (const c of n.childNodes) walk(c)
      if (gap) out += ' '
    }
    for (const c of el.childNodes) walk(c)
    return out.replace(/\s+/g, ' ').trim()
  }

  /* Text as the accessibility tree reads it: clipped text counts, aria-hidden
   * and display:none do not, and an image contributes its alt. */
  const nameText = (el) => {
    let out = ''
    const walk = (n) => {
      if (n.nodeType === 3) {
        out += n.textContent
        return
      }
      if (n.nodeType !== 1) return
      if (n.getAttribute('aria-hidden') === 'true') return
      if (getComputedStyle(n).display === 'none') return
      /* The name computation recurses, so a descendant that carries its own
       * aria-label contributes that and stops: this is what turns the picture
       * placeholder into « Aucune photo pour cet article » instead of nothing. */
      const own = n.getAttribute('aria-label')
      if (own && own.trim()) {
        out += ' ' + own.trim() + ' '
        return
      }
      if (n.tagName === 'IMG') out += ' ' + (n.getAttribute('alt') || '') + ' '
      if (n.tagName.toLowerCase() === 'svg') {
        const t = n.querySelector('title')
        if (t) out += ' ' + t.textContent + ' '
      }
      const gap = blockish(n)
      if (gap) out += ' '
      for (const c of n.childNodes) walk(c)
      if (gap) out += ' '
    }
    for (const c of el.childNodes) walk(c)
    return out.replace(/\s+/g, ' ').trim()
  }

  /*
   * Enough of the accessible name computation for a shop: the order of the
   * spec's first steps, stopping where the remaining steps stop mattering for
   * links, buttons and form fields.
   */
  const accName = (el) => {
    const ids = el.getAttribute('aria-labelledby')
    if (ids) {
      const t = ids
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((n) => nameText(n) || n.getAttribute('aria-label') || '')
        .join(' ')
        .trim()
      if (t) return t
    }
    const lab = el.getAttribute('aria-label')
    if (lab && lab.trim()) return lab.trim()
    if (el.labels && el.labels.length) {
      const t = [...el.labels].map(nameText).join(' ').trim()
      if (t) return t
    }
    const tag = el.tagName
    if (tag === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase()
      if (['submit', 'button', 'reset'].includes(type) && el.value) return el.value.trim()
      if (type === 'image' && el.getAttribute('alt')) return el.getAttribute('alt').trim()
    }
    if (['BUTTON', 'A', 'SUMMARY', 'LEGEND', 'LABEL', 'TD', 'TH'].includes(tag) || el.getAttribute('role')) {
      const t = nameText(el)
      if (t) return t
    }
    const title = el.getAttribute('title')
    if (title && title.trim()) return title.trim()
    const ph = el.getAttribute('placeholder')
    if (ph && ph.trim()) return ph.trim()
    if (tag === 'A' || tag === 'BUTTON') {
      const t = nameText(el)
      if (t) return t
    }
    return ''
  }

  /* --------------------------------------------------------------- targets */

  const TARGET_SEL =
    'a[href], button, input:not([type=hidden]), select, textarea, summary,' +
    ' [role=button], [role=link], [role=checkbox], [role=radio], [role=switch], [role=tab], [role=menuitem]'

  const unionRect = (a, b) => ({
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
    width: Math.max(a.right, b.right) - Math.min(a.left, b.left),
    height: Math.max(a.bottom, b.bottom) - Math.min(a.top, b.top),
  })

  /*
   * The box a pointer actually has to hit.
   *
   * A chip or a consent line hides its checkbox visually and drives it through a
   * `<label>`; the checkbox's own box is then 1 by 1 or zero, and measuring that
   * would report a defect where the real target is the label, or hide one where
   * the label is small too. The union is what a click can land on.
   */
  const targetRect = (el) => {
    const own = el.getBoundingClientRect()
    if (own.width > 2 && own.height > 2) return { rect: own, byLabel: false, hit: el }
    const lab = (el.labels && el.labels[0]) || (el.closest('label') !== el ? el.closest('label') : null)
    if (lab) {
      const lr = lab.getBoundingClientRect()
      /* `hit` is the label, not the control. Hit-testing a 1 by 1 clipped
       * checkbox reports it as covered by its own label, which is not an
       * obscured control, it is how the control is drawn. That false positive
       * showed up on the consent list and on the size selector. */
      if (lr.width > 2 && lr.height > 2) return { rect: unionRect(own, lr), byLabel: true, hit: lab }
    }
    return { rect: own, byLabel: false, hit: el }
  }

  const targets = () =>
    [...document.querySelectorAll(TARGET_SEL)]
      .map((el) => ({ el, ...targetRect(el) }))
      .filter(({ el, rect }) => {
        const cs = getComputedStyle(el)
        if (cs.display === 'none' || cs.visibility !== 'visible') return false
        if (rect.width <= 2 || rect.height <= 2) return false
        /* A control parked off the page cannot be pointed at, and the one that
         * does this here (the skip link) is a different size once it takes
         * focus. Measuring it where it hides would report a target nobody can
         * miss and hide the one they can. */
        if (offPage(rect)) return false
        return true
      })

  /* ---------------------------------------------------- (a) 1.4.3 text contrast */

  const NO_TEXT = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TITLE', 'OPTION', 'OPTGROUP', 'TEMPLATE', 'IFRAME'])

  A.regleTexte = () => {
    const fails = []
    const unknown = []
    let checked = 0
    for (const el of [document.body, ...document.querySelectorAll('body *')]) {
      if (NO_TEXT.has(el.tagName)) continue
      /* `<option>` is painted by the platform's popup, not by the page: its
       * computed colour is not the pixel anyone sees, so it is left alone. */
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === 3 && n.textContent.trim())
        .map((n) => n.textContent.trim())
        .join(' ')
      if (!own) continue
      if (!painted(el)) continue
      const cs = getComputedStyle(el)
      const fg0 = parse(cs.color)
      if (!fg0) {
        unknown.push({ path: path(el), why: `couleur de texte « ${cs.color} »`, text: own.slice(0, 40) })
        continue
      }
      const bg = effBg(el)
      if (bg.unresolved) {
        unknown.push({ path: path(el), why: bg.unresolved, text: own.slice(0, 40) })
        continue
      }
      checked++
      const fg = over(fg0, bg.color)
      const r = round2(ratio(fg, bg.color))
      const size = parseFloat(cs.fontSize)
      const weight = Number(cs.fontWeight) || 400
      /* WCAG's « large text » is 18 pt, or 14 pt bold, in CSS px at the default
       * 96 dpi: 24 px, or 18,66 px at 700. */
      const large = size >= 24 || (size >= 18.66 && weight >= 700)
      const need = large ? 3 : 4.5
      if (r < need) {
        fails.push({
          path: path(el),
          text: own.slice(0, 40),
          fg: cs.color,
          bg: rgbStr(bg.color),
          size,
          weight,
          ratio: r,
          need,
        })
      }
    }
    return { fails, unknown, checked }
  }

  /* ------------------------------------------------------ (d) 2.5.8 target size */

  /*
   * 24 by 24 CSS px, with two of the criterion's exceptions implemented and
   * three not.
   *
   * IMPLEMENTED. The SPACING exception, as written: a 24 px circle centred on
   * each undersized target must not intersect another target's box, nor another
   * undersized target's circle. The INLINE exception, narrowly: the target's
   * display is inline and its containing block holds text that is not the
   * target, which is what « in a sentence » means. A link alone in a list item
   * is not in a sentence and is not excused.
   *
   * NOT IMPLEMENTED, so this rule is stricter than the criterion for them:
   * « user agent control » (an unstyled checkbox), « essential » and
   * « equivalent » (the same action reachable from a big enough control
   * elsewhere on the page). Each needs a judgement no script can make. Anything
   * this rule reports under one of those headings is a finding to argue with,
   * not a bug to fix blindly.
   */
  A.regleCibles = () => {
    const all = targets()
    const boxes = all.map((t) => t.rect)
    const centre = (r) => [r.left + r.width / 2, r.top + r.height / 2]
    const distToRect = (p, r) => {
      const dx = Math.max(r.left - p[0], 0, p[0] - r.right)
      const dy = Math.max(r.top - p[1], 0, p[1] - r.bottom)
      return Math.hypot(dx, dy)
    }
    const inline = (el) => {
      const d = getComputedStyle(el).display
      if (!d.startsWith('inline')) return false
      const parent = el.parentElement
      if (!parent) return false
      let other = ''
      for (const n of parent.childNodes) {
        if (n === el) continue
        if (n.nodeType === 3) other += n.textContent
        else if (n.nodeType === 1 && !n.matches(TARGET_SEL)) other += n.textContent
      }
      return other.trim().length > 0
    }

    const fails = []
    const espacees = []
    const enLigne = []
    for (let i = 0; i < all.length; i++) {
      const { el, rect, byLabel } = all[i]
      if (rect.width >= 24 && rect.height >= 24) continue
      if (inline(el)) {
        enLigne.push(path(el))
        continue
      }
      const c = centre(rect)
      let blocker = null
      for (let j = 0; j < all.length && !blocker; j++) {
        if (j === i) continue
        if (distToRect(c, boxes[j]) < 12) blocker = all[j]
        else if (boxes[j].width < 24 || boxes[j].height < 24) {
          const c2 = centre(boxes[j])
          if (Math.hypot(c[0] - c2[0], c[1] - c2[1]) < 24) blocker = all[j]
        }
      }
      if (!blocker) {
        /*
         * Undersized and excused by the spacing rule, which is a pass under
         * 2.5.8 and still a thumb-sized problem on a phone. Counted and named
         * rather than dropped: the burger and the second hero link land here,
         * and a report that does not mention them reads as « the shop has three
         * small targets » when it has seven.
         */
        espacees.push({ path: path(el), w: Math.round(rect.width * 10) / 10, h: Math.round(rect.height * 10) / 10 })
        continue
      }
      fails.push({
        path: path(el),
        text: (visibleText(el) || accName(el)).slice(0, 30),
        w: Math.round(rect.width * 10) / 10,
        h: Math.round(rect.height * 10) / 10,
        byLabel,
        gene: path(blocker.el),
      })
    }
    return { fails, espacees, enLigne, checked: all.length }
  }

  /* --------------------------------------------------- (e) 2.5.3 label in name */

  /*
   * Compared after a normalisation that lowercases, straightens the typographic
   * quotes WordPress inserts, and drops the surrounding punctuation. Nothing
   * else: stripping accents or words would turn « contains » into « resembles »,
   * and this criterion is about a person saying out loud what they can see.
   */
  const norm = (s) =>
    s
      .toLowerCase()
      .replace(/[‘’ʼ]/g, "'")
      .replace(/[“”«»]/g, '"')
      .replace(/\s+/g, ' ')
      .replace(/^[\s"'.,:;!?()[\]-]+|[\s"'.,:;!?()[\]-]+$/g, '')
      .trim()

  A.regleNomVisible = () => {
    const fails = []
    let checked = 0
    for (const { el } of targets()) {
      const vis = visibleText(el)
      if (!vis) continue
      const name = accName(el)
      if (!name) continue
      checked++
      if (!norm(name).includes(norm(vis))) {
        fails.push({ path: path(el), vu: vis.slice(0, 40), nom: name.slice(0, 60) })
      }
    }
    return { fails, checked }
  }

  /* ------------------------------------------- (f) 3.1.1 and 3.1.2, language */

  A.regleLangue = (mots) => {
    const declared = (el) => {
      let n = el
      while (n && n.nodeType === 1) {
        const l = n.getAttribute('lang')
        if (l) return l
        n = n.parentElement
      }
      return null
    }
    const hits = []
    const seen = new Set()
    const consider = (el, value, source) => {
      if (!el || !value) return
      const t = String(value).replace(/\s+/g, ' ').trim()
      if (!t) return
      for (const m of mots) {
        if (!t.includes(m)) continue
        const key = path(el) + '|' + m + '|' + source
        if (seen.has(key)) return
        seen.add(key)
        hits.push({ path: path(el), source, mot: m, lang: declared(el), texte: t.slice(0, 60) })
        return
      }
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement
      if (!el || NO_TEXT.has(el.tagName)) continue
      /* Only what is rendered: a hidden block or a template is a translation gap
       * nobody meets, and flagging it would bury the two strings a buyer reads. */
      if (getComputedStyle(el).display === 'none') continue
      consider(el, n.textContent, 'texte')
    }
    for (const el of document.querySelectorAll('[aria-label], [title], [placeholder], [alt]')) {
      for (const a of ['aria-label', 'title', 'placeholder', 'alt']) {
        if (el.hasAttribute(a)) consider(el, el.getAttribute(a), a)
      }
    }
    return {
      html: document.documentElement.getAttribute('lang') || '',
      hits,
      declares: [...document.querySelectorAll('[lang]')].map((e) => path(e) + '=' + e.getAttribute('lang')),
    }
  }

  /* ------------------------------------------------------- (g) the structure */

  const LANDMARK_ROLES = ['banner', 'main', 'navigation', 'contentinfo', 'complementary', 'region', 'search', 'form']

  const landmarkRole = (el) => {
    const explicit = (el.getAttribute('role') || '').trim().toLowerCase()
    if (explicit) return LANDMARK_ROLES.includes(explicit) ? explicit : null
    const nested = el.parentElement && el.parentElement.closest('article, aside, main, nav, section')
    switch (el.tagName) {
      case 'HEADER':
        return nested ? null : 'banner'
      case 'FOOTER':
        return nested ? null : 'contentinfo'
      case 'NAV':
        return 'navigation'
      case 'MAIN':
        return 'main'
      case 'ASIDE':
        return 'complementary'
      case 'FORM':
        return accName(el) ? 'form' : null
      case 'SECTION':
        return accName(el) ? 'region' : null
      default:
        return null
    }
  }

  A.regleStructure = () => {
    const scope = document.querySelector('main') || document.body

    const headings = [...scope.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter(painted)
    const h1 = headings.filter((h) => h.tagName === 'H1')
    const sauts = []
    let last = 0
    for (const h of headings) {
      const lvl = Number(h.tagName[1])
      if (last && lvl > last + 1) sauts.push({ de: last, a: lvl, texte: visibleText(h).slice(0, 40), path: path(h) })
      last = lvl
    }

    const imgs = [...document.images]
    const sansAlt = imgs
      .filter(
        (i) =>
          !i.hasAttribute('alt') &&
          i.getAttribute('aria-hidden') !== 'true' &&
          !['presentation', 'none'].includes((i.getAttribute('role') || '').toLowerCase()),
      )
      .map((i) => path(i) + ' ' + (i.currentSrc || i.src || '').slice(-40))

    const byId = new Map()
    for (const el of document.querySelectorAll('[id]')) {
      const id = el.getAttribute('id')
      if (!id) continue
      byId.set(id, (byId.get(id) || 0) + 1)
    }
    const idsDoubles = [...byId.entries()].filter(([, n]) => n > 1).map(([id, n]) => ({ id, n }))

    const IDREF = ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-details', 'aria-errormessage', 'aria-flowto']
    const idrefsMorts = []
    for (const el of document.querySelectorAll('*')) {
      for (const a of IDREF) {
        const v = el.getAttribute(a)
        if (!v) continue
        for (const id of v.split(/\s+/).filter(Boolean)) {
          if (!document.getElementById(id)) idrefsMorts.push({ path: path(el), attr: a, id })
        }
      }
      if (el.tagName === 'LABEL') {
        const f = el.getAttribute('for')
        if (f && !document.getElementById(f)) idrefsMorts.push({ path: path(el), attr: 'for', id: f })
      }
    }

    const tabindexPositif = [...document.querySelectorAll('[tabindex]')]
      .filter((el) => Number(el.getAttribute('tabindex')) > 0)
      .map((el) => ({ path: path(el), v: el.getAttribute('tabindex') }))

    const sansNom = []
    for (const el of document.querySelectorAll(TARGET_SEL + ', textarea')) {
      const cs = getComputedStyle(el)
      if (cs.display === 'none') continue
      /* A control hidden only to the eye is still announced, so it is checked;
       * one removed from the tree entirely is not a control any more. */
      if (el.closest('[aria-hidden="true"]')) continue
      if (!accName(el)) sansNom.push({ path: path(el), tag: el.tagName.toLowerCase() })
    }

    const skip = document.querySelector('.ts-skip, a[href^="#"]:first-of-type')
    let evitement = null
    if (skip && skip.tagName === 'A') {
      const href = skip.getAttribute('href') || ''
      const id = href.startsWith('#') ? href.slice(1) : ''
      evitement = { href, cible: !!(id && document.getElementById(id)) }
    }

    const marks = []
    for (const el of document.querySelectorAll('header, footer, nav, main, aside, form, section, [role]')) {
      const role = landmarkRole(el)
      if (!role) continue
      if (getComputedStyle(el).display === 'none') continue
      marks.push({ role, nom: accName(el), path: path(el) })
    }
    const reperes = []
    for (const role of new Set(marks.map((m) => m.role))) {
      const same = marks.filter((m) => m.role === role)
      if (same.length < 2) continue
      const names = same.map((m) => m.nom)
      if (names.some((n) => !n)) reperes.push({ role, why: 'plusieurs sans nom', n: same.length })
      else if (new Set(names).size !== names.length) reperes.push({ role, why: 'noms identiques', n: same.length })
    }

    return {
      h1: h1.length,
      headings: headings.length,
      sauts,
      imgs: imgs.length,
      sansAlt,
      ids: byId.size,
      idsDoubles,
      idrefsMorts,
      tabindexPositif,
      controls: document.querySelectorAll(TARGET_SEL).length,
      sansNom,
      evitement,
      marks: marks.length,
      reperes,
    }
  }

  /* --------------------------------------- (b) and (c), measured at a tab stop */

  const SNAP = ['outlineColor', 'outlineStyle', 'outlineWidth', 'outlineOffset', 'boxShadow', 'borderColor', 'borderWidth', 'backgroundColor', 'color', 'textDecorationLine']
  const snap = (el) => {
    const cs = getComputedStyle(el)
    const o = {}
    for (const k of SNAP) o[k] = cs[k]
    return o
  }

  A.resetWalk = () => {
    A.seen = new Set()
    A.repos = new Map()
    /* The unfocused look of everything that can take focus, so a stop can be
     * compared with itself. Without this, « has a focus indicator » can only see
     * an outline, and an author who styles focus with a box-shadow would be
     * reported as having none. */
    for (const el of document.querySelectorAll(TARGET_SEL + ', textarea, [tabindex]')) {
      try {
        A.repos.set(el, snap(el))
      } catch {
        /* an element removed between the query and the read is not a stop */
      }
    }
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur()
    window.scrollTo(0, 0)
    return A.repos.size
  }

  /*
   * Is anything painting over this stop?
   *
   * Nine points across the visible part of the box. A point is « clear » when
   * the focused element is the top of the hit-test stack there, or when the only
   * things above it are its own descendants. The criterion is « entirely
   * hidden », so one clear point is enough to pass.
   */
  /*
   * What is hiding it, when something is.
   *
   * « Covered » and « clipped » are two different defects with two different
   * fixes, and this shop has both: a consent strip painted over the page, and
   * facet chips scrolled out of a `ul.ts-facet__list` whose scroll container
   * never scrolls them back in. Reporting the second as « covered by the form
   * around it » would send whoever fixes it looking for a z-index.
   */
  const clipper = (el, rect) => {
    let n = el.parentElement
    while (n && n.nodeType === 1) {
      const cs = getComputedStyle(n)
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const r = n.getBoundingClientRect()
        const inside =
          rect.left >= r.left - 0.5 &&
          rect.right <= r.right + 0.5 &&
          rect.top >= r.top - 0.5 &&
          rect.bottom <= r.bottom + 0.5
        if (!inside) {
          return {
            path: path(n),
            defile: n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1,
            scrollTop: Math.round(n.scrollTop),
          }
        }
      }
      n = n.parentElement
    }
    return null
  }

  const coverage = (el, rect) => {
    const vw = document.documentElement.clientWidth
    const vh = document.documentElement.clientHeight
    const x0 = Math.max(rect.left, 0)
    const x1 = Math.min(rect.right, vw)
    const y0 = Math.max(rect.top, 0)
    const y1 = Math.min(rect.bottom, vh)
    if (!(x1 - x0 > 0.5 && y1 - y0 > 0.5)) return { measurable: false, why: 'hors de la fenêtre' }
    const xs = [x0 + 0.5, (x0 + x1) / 2, x1 - 0.5]
    const ys = [y0 + 0.5, (y0 + y1) / 2, y1 - 0.5]
    let clear = 0
    let blocker = null
    let n = 0
    for (const x of xs) {
      for (const y of ys) {
        n++
        const stack = document.elementsFromPoint(x, y)
        const i = stack.indexOf(el)
        if (i < 0) {
          if (!blocker && stack[0] && !el.contains(stack[0])) blocker = stack[0]
          continue
        }
        const above = stack.slice(0, i).filter((e) => !el.contains(e))
        if (above.length === 0) clear++
        else if (!blocker) blocker = above[above.length - 1]
      }
    }
    const clip = clear === 0 ? clipper(el, rect) : null
    return {
      measurable: true,
      clear,
      sampled: n,
      blocker: blocker ? path(blocker) : null,
      clip,
    }
  }

  /**
   * The outermost solid ring a `box-shadow` draws, or null.
   *
   * `0 0 0 <spread> <colour>` is a ring. Anything with a blur radius or an
   * offset is a shadow, and a shadow is not an indicator: it has no edge to
   * measure a contrast against.
   */
  const ringHalo = (shadow) => {
    if (!shadow || shadow === 'none') return null
    let best = null
    for (const part of shadow.split(/,(?![^(]*\))/)) {
      const m = /(rgba?\([^)]*\)|#[0-9a-f]{3,8})\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px/i.exec(part.trim())
      if (!m) continue
      const [, colour, x, y, blur, spread] = m
      if (parseFloat(x) !== 0 || parseFloat(y) !== 0 || parseFloat(blur) !== 0) continue
      if (parseFloat(spread) <= 0) continue
      if (!best || parseFloat(spread) > best.spread) best = { colour, spread: parseFloat(spread) }
    }
    return best ? best.colour : null
  }

  A.arret = () => {
    const el = document.activeElement
    if (!el || el === document.body || el === document.documentElement) return { fin: 'hors document' }
    if (A.seen.has(el)) return { fin: 'boucle' }
    A.seen.add(el)

    const { rect, byLabel, hit } = targetRect(el)
    const cs = getComputedStyle(el)
    const ow = parseFloat(cs.outlineWidth) || 0
    const ring = cs.outlineStyle !== 'none' && ow > 0
    const before = A.repos.get(el)
    const changed = before ? SNAP.some((k) => before[k] !== cs[k]) : null

    const bg = effBg(el)
    let r = null
    let ringColor = null
    if (ring) {
      ringColor = cs.outlineColor
      const oc = parse(cs.outlineColor)
      if (oc && !bg.unresolved) r = round2(ratio(over(oc, bg.color), bg.color))

      /*
       * A RING MAY HAVE TWO TONES, AND THEN THE BETTER ONE IS THE INDICATOR.
       *
       * 1.4.11 asks the focus indicator to reach 3:1 against what is adjacent to
       * it. A single colour cannot do that on a shop whose grounds run from
       * white to #14171a, and the technique WCAG's own understanding document
       * gives for it is two contrasting tones: an outline plus a halo, one of
       * which is always the visible one. Measuring only `outline-color` would
       * report the invisible half and call a correct indicator a failure.
       *
       * So the halo counts too, and the rule takes whichever tone stands out.
       * It is NOT a relaxation: each tone is still measured against the real
       * background at 3:1, and an element with one tone is judged exactly as
       * before. The halo is read out of `box-shadow` rather than assumed: only a
       * shadow with a spread and no blur is a ring, a blurred one is a shadow.
       */
      const halo = ringHalo(cs.boxShadow)
      if (halo && !bg.unresolved) {
        const hc = parse(halo)
        if (hc) {
          const hr = round2(ratio(over(hc, bg.color), bg.color))
          if (r === null || hr > r) {
            r = hr
            ringColor = halo
          }
        }
      }
    }

    return {
      path: path(el),
      tag: el.tagName.toLowerCase(),
      nom: (accName(el) || visibleText(el) || '').slice(0, 40),
      ring,
      ringColor,
      ringWidth: ow,
      indicator: ring || changed === true,
      indicatorUnknown: before === undefined,
      bg: bg.unresolved ? null : rgbStr(bg.color),
      bgWhy: bg.unresolved || null,
      ratio: r,
      w: Math.round(rect.width * 10) / 10,
      h: Math.round(rect.height * 10) / 10,
      byLabel,
      cover: coverage(hit, rect),
    }
  }

  /* ------------------------------------------------------ (h) 3.2.2 on input */

  /*
   * Every context change a change event causes is recorded and then stopped, so
   * the probe can ask the next control on the same page. WooCommerce's ordering
   * select goes through jQuery's `.trigger('submit')`, which ends in the native
   * `form.submit()`, and that fires no submit event at all: catching only the
   * event would have found nothing and called the page clean.
   */
  A.navs = []
  try {
    /* Not chained to the real submit: a probe that let the navigation happen
     * could ask exactly one control per page load. */
    HTMLFormElement.prototype.submit = function () {
      A.navs.push('form.submit()')
    }
  } catch {
    /* a browser that refuses the patch is reported by the self-test, not here */
  }
  document.addEventListener(
    'submit',
    (e) => {
      A.navs.push('événement submit')
      e.preventDefault()
    },
    true,
  )
  for (const m of ['assign', 'replace']) {
    try {
      Object.defineProperty(window.location, m, {
        configurable: true,
        value: () => {
          A.navs.push('location.' + m)
        },
      })
    } catch {
      /* Location is unforgeable in some engines; a real navigation is then seen
       * by the harness, which watches framenavigated. */
    }
  }

  A.listeSaisie = () => {
    A.saisie = [...document.querySelectorAll('select, input[type=checkbox], input[type=radio]')].filter((el) => {
      const cs = getComputedStyle(el)
      if (cs.display === 'none') return false
      const { rect } = targetRect(el)
      return rect.width > 2 && rect.height > 2
    })
    return A.saisie.map((el, i) => {
      const form = el.form
      const submits = form
        ? form.querySelectorAll('button[type=submit], input[type=submit], input[type=image], button:not([type])').length
        : 0
      return { i, path: path(el), nom: accName(el), tag: el.tagName.toLowerCase(), form: !!form, submits }
    })
  }

  A.declenche = (i) => {
    A.navs = []
    const el = A.saisie[i]
    if (!el) return false
    if (el.tagName === 'SELECT') {
      const opts = [...el.options]
      const other = opts.find((o) => !o.selected)
      if (!other) return false
      el.value = other.value
    } else {
      el.checked = !el.checked
    }
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }

  A.vus = () => A.navs.slice()

  /*
   * Repaint every focus ring to the black or the white that its own background
   * contrasts with best, which is never below 4,58:1. Used by the self-test that
   * asks rule (b) to go QUIET: a rule that reports a failure on every element of
   * every page is as useless as one that never reports anything, and this shop
   * fails 1.4.11 everywhere, so « it fired » proves nothing on its own.
   */
  A.corrigeAnneaux = () => {
    let n = 0
    for (const el of document.querySelectorAll(TARGET_SEL + ', textarea, [tabindex]')) {
      const bg = effBg(el)
      if (bg.unresolved) continue
      const noir = lum(bg.color) + 0.05 > Math.sqrt(1.05 * 0.05)
      el.style.setProperty('outline-color', noir ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)', 'important')
      el.style.setProperty('box-shadow', 'none', 'important')
      n++
    }
    return n
  }

  /**
   * The other direction: paint every ring the colour of what is behind it.
   *
   * THE SELF-TEST USED TO GO THE OTHER WAY ROUND AND IT STOPPED WORKING THE DAY
   * THE SHOP WAS FIXED. It repaired the rings and required the rule to go quiet,
   * which only means something while some ring is already failing: session 12
   * gave the shop a two-tone ring that passes everywhere, the "before" count
   * became zero, and the check reported itself silent. Correctly, and that is
   * why the gate exits 2 rather than passing.
   *
   * A self-test may not depend on the thing under test being broken. This one
   * breaks it, on the real page, and requires the rule to say so; the repair
   * half still runs afterwards, so both directions are proven in one pass.
   *
   * The halo goes too, or the two-tone ring would keep passing on its other
   * tone, which is exactly what it is for.
   */
  A.casseAnneaux = () => {
    let n = 0
    for (const el of document.querySelectorAll(TARGET_SEL + ', textarea, [tabindex]')) {
      const bg = effBg(el)
      if (bg.unresolved) continue
      el.style.setProperty('outline-color', rgbStr(bg.color), 'important')
      el.style.setProperty('box-shadow', 'none', 'important')
      n++
    }
    return n
  }
}

/* ------------------------------------------------------------- the harness side */

const fr = (n) => String(n).replace('.', ',')

const ctxFor = async (browser, width, { consent }) => {
  const context = await browser.newContext({
    viewport: { width, height: width < 500 ? 812 : 1000 },
    locale: 'fr-FR',
  })
  await context.addInitScript(HELPERS)
  if (consent) await decided(context)
  return context
}

/**
 * One tab stop after another, with the keyboard, never `el.focus()`.
 *
 * `:focus-visible` does not match a programmatic focus, so a ring measured after
 * `el.focus()` can be a ring no keyboard user ever sees, and its absence can be
 * an absence no keyboard user ever meets. The walk stops when focus leaves the
 * document or returns to an element already visited, which is also what breaks a
 * focus trap instead of hanging on it.
 */
const marche = async (page) => {
  const armed = await page.evaluate(() => window.__a11y.resetWalk())
  const stops = []
  let capped = false
  for (let i = 0; i < MAX_STOPS; i++) {
    await page.keyboard.press('Tab')
    let s
    try {
      s = await page.evaluate(() => window.__a11y.arret())
    } catch {
      break
    }
    if (s.fin) break
    stops.push(s)
    if (i === MAX_STOPS - 1) capped = true
  }
  return { stops, capped, armed }
}

const pire = (list, key) => list.slice().sort((a, b) => a[key] - b[key])[0]

/* Rules (a), (d), (e), (f) and (g), all read off one settled DOM. */
const statique = async (page, tag) => {
  const a = await page.evaluate(() => window.__a11y.regleTexte())
  const w = pire(a.fails, 'ratio')
  ok(
    `${tag}: contraste du texte (1.4.3)`,
    a.checked > 0 && a.fails.length === 0,
    `${a.checked} textes mesurés, ${a.fails.length} sous le seuil` +
      (w ? `, pire ${fr(w.ratio)}:1 pour ${fr(w.need)}:1 sur ${w.path} « ${w.text} » ${w.fg} sur ${w.bg} ${fr(w.size)} px ${w.weight}` : '') +
      (a.unknown.length ? `, ${a.unknown.length} non mesurables (${a.unknown[0].why})` : ''),
  )

  const d = await page.evaluate(() => window.__a11y.regleCibles())
  ok(
    `${tag}: taille des cibles (2.5.8)`,
    d.checked > 0 && d.fails.length === 0,
    `${d.checked} cibles, ${d.fails.length} trop petites` +
      (d.fails.length
        ? `: ` +
          d.fails
            .slice(0, 3)
            .map((f) => `${f.path} ${fr(f.w)}x${fr(f.h)}${f.byLabel ? ' (via son label)' : ''} « ${f.text} »`)
            .join(' ; ')
        : '') +
      ` | ${d.espacees.length} sous 24 px mais espacées, donc tolérées par le critère` +
      (d.espacees.length ? ` (${d.espacees.slice(0, 3).map((x) => `${x.path} ${fr(x.w)}x${fr(x.h)}`).join(' ; ')})` : '') +
      (d.enLigne.length ? ` | ${d.enLigne.length} dans une phrase` : ''),
  )

  const e = await page.evaluate(() => window.__a11y.regleNomVisible())
  ok(
    `${tag}: le nom contient le texte visible (2.5.3)`,
    e.checked > 0 && e.fails.length === 0,
    `${e.checked} contrôles nommés, ${e.fails.length} en désaccord` +
      (e.fails.length ? `: « ${e.fails[0].vu} » nommé « ${e.fails[0].nom} » (${e.fails[0].path})` : ''),
  )

  const f = await page.evaluate((mots) => window.__a11y.regleLangue(mots), ANGLAIS)
  ok(`${tag}: la page déclare sa langue (3.1.1)`, /^fr/i.test(f.html), f.html || '(aucun lang)')
  const nus = f.hits.filter((h) => !h.lang || /^fr/i.test(h.lang))
  ok(
    `${tag}: pas d'anglais non déclaré (3.1.2)`,
    /* An empty list of strings would make this rule pass on any page, so the
     * count of what was looked for is part of the assertion, not of the note. */
    ANGLAIS.length > 0 && nus.length === 0,
    nus.length
      ? `${nus.length} : ` + nus.slice(0, 3).map((h) => `« ${h.mot} » (${h.source}, ${h.path})`).join(' ; ')
      : `${ANGLAIS.length} chaînes cherchées, ${f.hits.length} trouvée(s), ${f.declares.length} élément(s) avec lang`,
  )

  const g = await page.evaluate(() => window.__a11y.regleStructure())
  ok(`${tag}: un seul h1`, g.h1 === 1, `${g.h1} h1 pour ${g.headings} titres`)
  ok(
    `${tag}: aucun saut de niveau de titre`,
    g.sauts.length === 0,
    g.sauts.length ? g.sauts.map((s) => `h${s.de} puis h${s.a} « ${s.texte} »`).join(' ; ') : `${g.headings} titres`,
  )
  if (g.imgs === 0) {
    notChecked(`${tag}: un alt sur chaque image`, 'aucun élément img sur cette page, les visuels y sont peints en CSS')
  } else {
    ok(
      `${tag}: un alt sur chaque image`,
      g.sansAlt.length === 0,
      `${g.imgs} images, ${g.sansAlt.length} sans alt${g.sansAlt.length ? ': ' + g.sansAlt.slice(0, 2).join(' ; ') : ''}`,
    )
  }
  ok(
    `${tag}: aucun id en double`,
    g.ids > 0 && g.idsDoubles.length === 0,
    `${g.ids} id, ${g.idsDoubles.length} en double${g.idsDoubles.length ? ': ' + g.idsDoubles.slice(0, 3).map((x) => `${x.id} x${x.n}`).join(' ; ') : ''}`,
  )
  ok(
    `${tag}: aucun aria-* ne pointe dans le vide`,
    g.idrefsMorts.length === 0,
    g.idrefsMorts.length ? g.idrefsMorts.slice(0, 3).map((x) => `${x.attr}="${x.id}" sur ${x.path}`).join(' ; ') : 'aucun',
  )
  ok(
    `${tag}: aucun tabindex positif`,
    g.tabindexPositif.length === 0,
    g.tabindexPositif.length ? g.tabindexPositif.map((x) => `${x.path}=${x.v}`).join(' ; ') : 'aucun',
  )
  ok(
    `${tag}: chaque contrôle a un nom`,
    g.controls > 0 && g.sansNom.length === 0,
    `${g.controls} contrôles, ${g.sansNom.length} sans nom${g.sansNom.length ? ': ' + g.sansNom.slice(0, 3).map((x) => x.path).join(' ; ') : ''}`,
  )
  if (g.evitement) {
    ok(
      `${tag}: la cible du lien d'évitement existe`,
      g.evitement.cible,
      `${g.evitement.href}${g.evitement.cible ? '' : ' ne désigne aucun élément'}`,
    )
  } else {
    notChecked(`${tag}: la cible du lien d'évitement existe`, 'aucun lien d\'évitement sur cette page')
  }
  ok(
    `${tag}: les repères sont uniques ou nommés`,
    g.marks > 0 && g.reperes.length === 0,
    `${g.marks} repères${g.reperes.length ? ': ' + g.reperes.map((r) => `${r.n} ${r.role}, ${r.why}`).join(' ; ') : ''}`,
  )
}

/* Rules (b), (c) and the 2.4.7 floor, all read at real tab stops. */
const clavier = async (page, tag, { covert }) => {
  const { stops, capped, armed } = await marche(page)
  /*
   * FIVE IS A FLOOR, NOT A TARGET. Every page of this shop starts with the skip
   * link and four masthead controls, so a walk that ends earlier has broken
   * (focus trapped, a cycle detected too early, keyboard events not reaching the
   * page) and the two rules below would then be measuring almost nothing while
   * reporting a pass. The thinnest page here reaches eleven.
   */
  const suffixe = covert ? ' [première visite]' : ''
  if (stops.length < 5) {
    ok(
      `${tag}: la tabulation parcourt la page${suffixe}`,
      false,
      `${stops.length} arrêt(s) pour ${armed} éléments focalisables, moins que le minimum de 5`,
    )
    return { stops }
  }
  if (!covert) {
    ok(`${tag}: la tabulation parcourt la page`, true, `${stops.length} arrêts${capped ? ` (plafond ${MAX_STOPS} atteint)` : ''}`)
    if (capped) notChecked(`${tag}: les arrêts au-delà de ${MAX_STOPS}`, 'plafond du parcours atteint')
  }

  /*
   * The first-visit pass exists for one rule only. Repeating the ring contrast
   * and the 2.4.7 floor there would double every line of the report for a
   * measurement the consent cookie cannot change.
   */
  if (!covert) {
    const mesurables = stops.filter((s) => s.ratio !== null)
    const sousSeuil = mesurables.filter((s) => s.ratio < 3)
    const w = pire(sousSeuil, 'ratio')
    ok(
      `${tag}: contraste de l'indicateur de focus (1.4.11)`,
      mesurables.length > 0 && sousSeuil.length === 0,
      `${mesurables.length} anneaux mesurés, ${sousSeuil.length} sous 3:1` +
        (w ? `, pire ${fr(w.ratio)}:1 (${w.ringColor} sur ${w.bg}) sur ${w.path}` : '') +
        (stops.length - mesurables.length ? `, ${stops.length - mesurables.length} non mesurables` : ''),
    )

    const sansIndicateur = stops.filter((s) => !s.indicator && !s.indicatorUnknown)
    ok(
      `${tag}: chaque arrêt montre un indicateur de focus (2.4.7)`,
      sansIndicateur.length === 0,
      sansIndicateur.length
        ? `${sansIndicateur.length} sans rien: ` + sansIndicateur.slice(0, 3).map((s) => s.path).join(' ; ')
        : `${stops.length} arrêts`,
    )
  }

  const vus = stops.filter((s) => s.cover.measurable)
  const masques = vus.filter((s) => s.cover.clear === 0)
  const par = {}
  for (const s of masques) {
    const cause = s.cover.clip
      ? `découpé par ${s.cover.clip.path}${s.cover.clip.defile ? ` (défilable, resté à ${s.cover.clip.scrollTop})` : ''}`
      : `recouvert par ${s.cover.blocker || '(inconnu)'}`
    par[cause] = (par[cause] || 0) + 1
  }
  const parTri = Object.entries(par).sort((a, b) => b[1] - a[1])
  ok(
    `${tag}: focus jamais masqué (2.4.11)${suffixe}`,
    vus.length > 0 && masques.length === 0,
    `${masques.length} arrêts masqués sur ${vus.length} mesurés` +
      (parTri.length ? `, ${parTri.map(([p, n]) => `${n} ${p}`).slice(0, 2).join(' ; ')}` : '') +
      (stops.length - vus.length ? `, ${stops.length - vus.length} hors fenêtre` : ''),
  )
  return { stops }
}

/*
 * Rule (h), 3.2.2. Every rendered select, checkbox and radio gets a real change
 * event, with submission intercepted so the page survives to answer for the next
 * one. A control that submits or navigates while its form offers no submit
 * button changes the context without being asked to.
 */
const saisie = async (page, tag) => {
  let navigated = false
  const onNav = () => {
    navigated = true
  }
  page.on('framenavigated', onNav)
  const list = await page.evaluate(() => window.__a11y.listeSaisie())
  const fails = []
  let probed = 0
  for (const c of list) {
    navigated = false
    const started = await page.evaluate((i) => window.__a11y.declenche(i), c.i)
    if (!started) continue
    probed++
    await page.waitForTimeout(40)
    let navs = []
    try {
      navs = await page.evaluate(() => window.__a11y.vus())
    } catch {
      navs = ['navigation réelle']
    }
    if (navigated) navs.push('navigation réelle')
    if (navs.length && c.submits === 0) {
      fails.push({ ...c, navs: [...new Set(navs)].join(', ') })
    }
    if (navigated) {
      /* The page went somewhere despite the interception: reload and carry on,
       * rather than reporting the rest of the controls as clean. */
      await load(page, page.url())
      await page.evaluate(() => window.__a11y.listeSaisie())
    }
  }
  page.off('framenavigated', onNav)
  /*
   * A page with no select and no checkbox has nothing to probe, and saying so is
   * not the same as passing. It is not a failure either: failing here would make
   * the gate red for a page that simply has no control of this kind.
   */
  if (probed === 0) {
    notChecked(`${tag}: rien ne change de contexte à la saisie (3.2.2)`, 'aucun select ni case à cocher visible sur cette page')
    return
  }
  ok(
    `${tag}: rien ne change de contexte à la saisie (3.2.2)`,
    fails.length === 0,
    `${probed} contrôles sollicités, ${fails.length} changent le contexte` +
      (fails.length
        ? `: ` + fails.slice(0, 3).map((f) => `${f.tag} « ${f.nom} » (${f.path}) ${f.navs}, aucun bouton d'envoi`).join(' ; ')
        : ''),
  )
}

/* ------------------------------------------------------------- the self-tests */

/*
 * Five of them, unconditional, each one breaking the real page in the real
 * browser and requiring the real rule to NAME the element it broke. Naming
 * matters: a self-test that only counts findings passes when the count moves for
 * an unrelated reason.
 *
 * Two of the five run the other way round, and they are the ones that were
 * worth the most here. This shop fails 1.4.11 and 2.4.11 on every page, so
 * « the rule fired » proves nothing about either: what has to be proved is that
 * they can also go quiet. One repaints every focus ring to a colour that cannot
 * fail and requires zero findings; the other checks that the clean 2.4.11 run
 * with a refusal cookie turns red the moment something really does cover the
 * page.
 */
const autotests = async (browser) => {
  /* (a) A repainted text must come back at exactly 2,85:1. */
  {
    const context = await ctxFor(browser, 1440, { consent: true })
    const page = await context.newPage()
    await load(page, BASE + '/produit/teeshoop-demo-tee/')
    const before = await page.evaluate(() => window.__a11y.regleTexte())
    const armed = await page.evaluate(() => {
      const el = [...document.querySelectorAll('main p, main li, main h2, main h1, main span')].find(
        (e) =>
          [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 8) &&
          e.getBoundingClientRect().width > 10,
      )
      if (!el) return false
      el.id = 'ts-autotest-contraste'
      el.style.setProperty('color', 'rgb(153, 153, 153)', 'important')
      el.style.setProperty('background-color', 'rgb(255, 255, 255)', 'important')
      return true
    })
    const after = await page.evaluate(() => window.__a11y.regleTexte())
    const hit = after.fails.find((f) => f.path.includes('ts-autotest-contraste'))
    const clean = !before.fails.some((f) => f.path.includes('ts-autotest-contraste'))
    fired.push([
      '(1.4.3) un texte repeint à 2,85:1 est vu',
      armed && clean && !!hit && hit.ratio === 2.85,
      hit ? `${fr(hit.ratio)}:1` : 'aucune trouvaille',
    ])
    await context.close()
  }

  /* (d) Two real controls, shrunk and parked side by side. */
  {
    const context = await ctxFor(browser, 1440, { consent: true })
    const page = await context.newPage()
    await load(page, BASE + '/')
    const before = await page.evaluate(() => window.__a11y.regleCibles())
    /*
     * Both are moved into one fixed box before being shrunk. A single shrunken
     * control keeps whatever spacing its neighbours happened to have, and 2.5.8
     * excuses an undersized target that nothing else comes within 24 px of, so
     * the self-test would fall silent on a page with airy margins and the gate
     * would exit 2 for no defect at all.
     */
    const armed = await page.evaluate(() => {
      const els = [...document.querySelectorAll('a[href], button')].filter((e) => {
        const r = e.getBoundingClientRect()
        /* On the page, not parked off it: the first candidate used to be the
         * skip link at left:-9999px, which the rule drops before measuring, and
         * the self-test then reported itself silent for no defect. */
        return r.width > 24 && r.height > 24 && r.right > 0 && r.bottom > 0
      })
      if (els.length < 2) return false
      const box = document.createElement('div')
      box.style.cssText = 'position:fixed;left:120px;top:120px;z-index:9999;display:flex;gap:0;'
      document.body.appendChild(box)
      for (const el of [els[0], els[1]]) {
        box.appendChild(el)
        el.style.cssText =
          'position:static;left:auto;top:auto;width:12px;height:12px;min-width:0;min-height:0;padding:0;margin:0;display:block;overflow:hidden;'
      }
      els[0].id = 'ts-autotest-cible'
      return true
    })
    const after = await page.evaluate(() => window.__a11y.regleCibles())
    const hit = after.fails.find((f) => f.path.includes('ts-autotest-cible'))
    const clean = !before.fails.some((f) => f.path.includes('ts-autotest-cible'))
    fired.push([
      '(2.5.8) un contrôle rapetissé à 12x12 est vu',
      armed && clean && !!hit && hit.w === 12 && hit.h === 12,
      hit ? `${fr(hit.w)}x${fr(hit.h)}` : 'aucune trouvaille',
    ])
    await context.close()
  }

  /* (g) A duplicated id, and (e) an accessible name that drops what is on screen. */
  {
    const context = await ctxFor(browser, 1440, { consent: true })
    const page = await context.newPage()
    await load(page, BASE + '/categorie/t-shirts/')
    const before = await page.evaluate(() => ({
      ids: window.__a11y.regleStructure().idsDoubles.length,
      noms: window.__a11y.regleNomVisible().fails.some((f) => f.path.includes('ts-autotest-nom')),
    }))
    const armed = await page.evaluate(() => {
      const withId = document.querySelector('main [id], [id]')
      if (!withId) return null
      const twin = document.createElement('span')
      twin.id = withId.id
      twin.textContent = 'autotest'
      document.body.appendChild(twin)
      const link = [...document.querySelectorAll('a[href]')].find((a) => {
        const r = a.getBoundingClientRect()
        /* On the page: the first match used to be the skip link parked at
         * left:-9999px, which rule (e) does not measure, so the self-test
         * reported itself silent while the rule was working. */
        return !a.getAttribute('aria-label') && a.textContent.trim().length > 3 && r.right > 0 && r.bottom > 0 && r.width > 2
      })
      if (!link) return null
      link.id = 'ts-autotest-nom'
      link.setAttribute('aria-label', 'zzz autotest')
      return withId.id
    })
    const after = await page.evaluate(() => ({
      doubles: window.__a11y.regleStructure().idsDoubles,
      noms: window.__a11y.regleNomVisible().fails.filter((f) => f.path.includes('ts-autotest-nom')),
    }))
    fired.push([
      '(structure) un id en double est vu',
      !!armed && before.ids === 0 && after.doubles.some((d) => d.id === armed),
      armed ? `${armed} x${(after.doubles.find((d) => d.id === armed) || {}).n || 0}` : 'rien à dupliquer',
    ])
    fired.push([
      '(2.5.3) un nom qui perd le texte visible est vu',
      !!armed && !before.noms && after.noms.length === 1,
      after.noms.length ? `« ${after.noms[0].vu} » nommé « ${after.noms[0].nom} »` : 'aucune trouvaille',
    ])
    await context.close()
  }

  /*
   * (c) and (b), the two that must be able to go quiet.
   *
   * Same page, same width, in the order that makes each half meaningful: first
   * the clean 2.4.11 run a refusal cookie produces, then an overlay that really
   * does cover the viewport, then the ring repaint that must silence 1.4.11.
   */
  {
    const context = await ctxFor(browser, 375, { consent: true })
    const page = await context.newPage()
    await load(page, BASE + '/categorie/t-shirts/')
    const un = await marche(page)
    const masquesAvant = un.stops.filter((s) => s.cover.measurable && s.cover.clear === 0).length
    const ringsAvant = un.stops.filter((s) => s.ratio !== null && s.ratio < 3).length

    await page.evaluate(() => {
      const veil = document.createElement('div')
      veil.id = 'ts-autotest-voile'
      veil.style.cssText = 'position:fixed;inset:0;background:rgb(255,255,255);z-index:2147483647;'
      document.body.appendChild(veil)
    })
    const deux = await marche(page)
    const masquesApres = deux.stops.filter((s) => s.cover.measurable && s.cover.clear === 0).length
    const mesures = deux.stops.filter((s) => s.cover.measurable).length
    fired.push([
      '(2.4.11) un voile plein écran masque les arrêts, et se voit',
      mesures > 0 && masquesApres === mesures && masquesApres > masquesAvant,
      `${masquesAvant} masqués avant, ${masquesApres} sur ${mesures} après`,
    ])

    await page.evaluate(() => document.getElementById('ts-autotest-voile').remove())

    /*
     * BOTH DIRECTIONS, IN THIS ORDER. Paint every ring the colour of the thing
     * behind it and the rule must report them; repair them and it must go quiet.
     * The first half is what makes this self-test survive a shop with no failing
     * ring left, which is the state session 12 put it in.
     */
    const casses = await page.evaluate(() => window.__a11y.casseAnneaux())
    const casse = await marche(page)
    const mesuresCasse = casse.stops.filter((s) => s.ratio !== null)
    const ringsCasses = mesuresCasse.filter((s) => s.ratio < 3).length
    fired.push([
      '(1.4.11) un anneau peint sur son propre fond est vu',
      mesuresCasse.length > 0 && ringsCasses === mesuresCasse.length,
      `${ringsCasses} sur ${mesuresCasse.length} mesurés, après ${casses} repeints`,
    ])

    const repeints = await page.evaluate(() => window.__a11y.corrigeAnneaux())
    const trois = await marche(page)
    const mesurables = trois.stops.filter((s) => s.ratio !== null)
    const ringsApres = mesurables.filter((s) => s.ratio < 3).length
    fired.push([
      '(1.4.11) la règle se tait quand les anneaux passent le seuil',
      mesurables.length > 0 && ringsApres === 0,
      `${ringsAvant} anneaux hors seuil sur la page telle qu'elle est, ${ringsCasses} une fois cassés, ${ringsApres} après ${repeints} réparations (${mesurables.length} mesurés)`,
    ])
    await context.close()
  }
}

/* ------------------------------------------------------------------- the run */

const main = async () => {
  const up = await (async () => {
    try {
      const res = await fetch(`${BASE}/wp-json/`, { cache: 'no-store' })
      return res.ok
    } catch {
      return false
    }
  })()
  if (!up) die(`${BASE} ne répond pas, démarrez le miroir avec npm run wp:up`)

  const browser = await chromium.launch()

  const refus = await enregistreRefus(browser)
  if (!refus) {
    await browser.close()
    die('le bouton « Tout refuser » n\'a pas produit de cookie de choix, les passes « visiteur décidé » seraient fausses')
  }
  ok('un refus est enregistré comme le ferait un visiteur', /^v\d+:\d{4}-\d{2}-\d{2}:/.test(decodeURIComponent(refus)), decodeURIComponent(refus))

  /*
   * THE INSTRUMENT, BEFORE THE SHOP. Three pairs whose ratio is published or was
   * measured by hand on this shop. If the scale itself drifts, every number
   * below is decoration.
   */
  {
    const context = await ctxFor(browser, 1440, { consent: true })
    const page = await context.newPage()
    await load(page, BASE + '/')
    const r = (a, b) => page.evaluate(([x, y]) => window.__a11y.ratio(x, y), [a, b])
    const noirBlanc = await r('rgb(0, 0, 0)', 'rgb(255, 255, 255)')
    ok('l\'échelle de contraste rend 21:1 pour du noir sur du blanc', noirBlanc === 21, `${fr(noirBlanc)}:1`)
    const anneau = await r('rgb(31, 79, 216)', 'rgb(20, 23, 26)')
    ok('elle rend 2,71:1 pour l\'anneau de focus sur le pied de page', anneau === 2.71, `${fr(anneau)}:1`)
    const prix = await r('rgb(149, 142, 9)', 'rgb(255, 255, 255)')
    ok('elle rend 3,41:1 pour le prix produit sur du blanc', prix === 3.41, `${fr(prix)}:1`)
    await context.close()
  }

  for (const width of WIDTHS) {
    for (const [name, path] of PAGES) {
      const tag = `[${width}] ${name}`
      const context = await ctxFor(browser, width, { consent: true })
      const page = await context.newPage()
      let res = null
      try {
        res = await load(page, BASE + path)
      } catch {
        res = null
      }
      if (!res) {
        ok(`${tag} répond`, false, `${BASE}${path} injoignable`)
        await context.close()
        continue
      }
      const arrivee = page.url().replace(/\/$/, '')
      if (arrivee !== (BASE + path).replace(/\/$/, '')) {
        /*
         * A page that was not audited says so, once, with where it went. The
         * empty cart sends /checkout/ back to /cart/, and filling it needs the
         * personalised add-to-cart path that npm run verify:wp-e2e owns.
         */
        notChecked(
          `${tag}: toutes les règles de cette page`,
          `${path} redirige vers ${arrivee.slice(BASE.length) || '/'}, page non auditée`,
        )
        await context.close()
        continue
      }
      ok(`${tag} répond 200`, res.status() === 200, String(res.status()))
      /* The precondition of every measurement in this pass: with a recorded
       * refusal there is no strip left to cover anything. */
      const bandeau = await page.evaluate(() => document.querySelectorAll('#ts-consent').length)
      ok(`${tag}: le refus enregistré est honoré`, bandeau === 0, `${bandeau} bandeau(x) encore présent(s)`)
      await statique(page, tag)
      await clavier(page, tag, { covert: false })
      await saisie(page, tag)
      await context.close()

      /*
       * THE SAME PAGE SEEN BY SOMEBODY WHO HAS NEVER BEEN HERE. Rule (c) only:
       * with a recorded refusal the consent strip is gone and 2.4.11 comes back
       * clean, which is the shop nobody arrives on.
       */
      const vierge = await ctxFor(browser, width, { consent: false })
      const p2 = await vierge.newPage()
      try {
        await load(p2, BASE + path)
        await clavier(p2, tag, { covert: true })
      } catch (e) {
        ok(`${tag}: focus jamais masqué (2.4.11) [première visite]`, false, String(e).slice(0, 120))
      }
      await vierge.close()
    }
  }

  await autotests(browser)
  await browser.close()

  /* ------------------------------------------------------------------ verdict */

  const muets = fired.filter(([, f]) => !f)
  if (muets.length > 0) {
    for (const [name, , extra] of muets) process.stdout.write(`  autotest MUET: ${name}  (${extra})\n`)
    die('un autotest n\'a pas tiré, le contrôle ne prouve rien')
  }
  if (results.length === 0) die('rien n\'a été vérifié')

  const failed = results.filter((r) => !r.pass)
  process.stdout.write(
    `\na11y-verify: ${results.length - failed.length}/${results.length} assertions passées ` +
      `(autotests tirés : ${fired.map(([n]) => n).join(' ; ')}).\n`,
  )
  for (const f of failed) process.stdout.write(`  ECHEC ${f.name}${f.extra ? `  (${f.extra})` : ''}\n`)
  for (const n of notLooked) process.stdout.write(`  non vérifié : ${n.name} - ${n.why}\n`)
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((err) => die(`la vérification s'est interrompue : ${err && err.stack ? err.stack : err}`))
