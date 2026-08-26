#!/usr/bin/env node
/**
 * SEO GATE: what a crawler is actually served, asserted page type by page type.
 *
 *   node scripts/seo-verify.mjs [base]
 *   node scripts/seo-verify.mjs --self-test
 *
 * WHY THIS FETCHES RATHER THAN DRIVING A BROWSER, which is the opposite of what
 * `site-shots.mjs` does two files over. A crawler is an HTTP client. It reads
 * the bytes the server sent, before any script has run, and every claim this
 * session makes is about those bytes: a canonical, a robots directive, a JSON-LD
 * node, a sitemap entry, a `Set-Cookie` header that must not be there yet.
 * Driving Chromium would assert what a BROWSER ends up with, which is a
 * different document and a weaker claim. `site-shots.mjs` still owns everything
 * about how the page looks and behaves.
 *
 * WHAT IT REFUSES TO LET PASS, in order of how expensive the mistake is:
 *
 *   A NOINDEX PAGE WITH A CANONICAL POINTING SOMEWHERE ELSE. Contradictory
 *   instructions, and the noindex can travel along the canonical. On this shop
 *   every filtered listing is noindex and would point at its category, so the
 *   filters could deindex the pages they lead to.
 *
 *   AN AGGREGATERATING OR A REVIEW, ANYWHERE. We have no reviews. In France a
 *   fabricated review is a misleading commercial practice with criminal
 *   exposure, and both audited competitors ship one, which is how it happens:
 *   somebody copies a snippet. This check scans every page type for the strings
 *   themselves, not only the parsed nodes, so an unparseable block cannot hide
 *   one.
 *
 *   A PRICE IN THE MARKUP THAT IS NOT A PRICE ON THE PAGE. Publishing a figure
 *   nobody can pay is a complaint in France, where an announced price is an
 *   offer. Mistertee publishes 8,08 EUR to Google while its own table says
 *   18,05 EUR.
 *
 *   A TRACKER BEFORE A CHOICE. One cookie-less request, and the response may set
 *   nothing at all.
 *
 *   A SLOT THAT DID NOT RESOLVE. `{DELAI_STANDARD}` rendered to a customer is
 *   the failure mode `Content` exists to prevent, so it is checked in the
 *   rendered HTML rather than trusted.
 *
 * Exit: 0 all assertions passed - 1 an assertion failed - 2 nothing was asserted
 *       (the shop was unreachable, or the self-test did not fire).
 */

const BASE = (process.argv.find((a) => a.startsWith('http')) || 'http://localhost:8080').replace(/\/$/, '')
const SELF_TEST = process.argv.includes('--self-test')

/* ---------------------------------------------------------------- harness */

const results = []
const ok = (name, pass, extra = '') => {
  results.push({ name, pass, extra })
  process.stdout.write(`${pass ? '✓' : '✗'} ${name}${extra ? `  (${extra})` : ''}\n`)
  return pass
}

const get = async (path, headers = {}) => {
  const res = await fetch(BASE + path, { redirect: 'manual', headers })
  const body = res.status >= 300 && res.status < 400 ? '' : await res.text()
  return { status: res.status, headers: res.headers, body, location: res.headers.get('location') || '' }
}

/* ------------------------------------------------------------- extraction */

const head = (html) => {
  const cut = html.indexOf('</head>')
  return cut === -1 ? html : html.slice(0, cut)
}
const one = (html, re) => {
  const m = html.match(re)
  return m ? m[1] : null
}
const all = (html, re) => [...html.matchAll(re)].map((m) => m[1])

const title = (html) => one(head(html), /<title>([\s\S]*?)<\/title>/)
const canonical = (html) => one(head(html), /<link rel="canonical" href="([^"]*)"/)
const description = (html) => one(head(html), /<meta name="description" content="([^"]*)"/)
const robots = (html) => one(head(html), /<meta name=['"]robots['"] content=['"]([^'"]*)['"]/)
const rel = (html, which) => one(head(html), new RegExp(`<link rel="${which}" href="([^"]*)"`))
const h1s = (html) => all(html, /<h1[^>]*>([\s\S]*?)<\/h1>/g).map((t) => t.replace(/<[^>]+>/g, '').trim())
const isNoindex = (html) => /noindex/.test(robots(html) || '')

const jsonLd = (html) => {
  const blocks = all(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)
  const nodes = []
  const broken = []
  for (const raw of blocks) {
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (e) {
      broken.push(String(e.message).slice(0, 80))
      continue
    }
    const push = (n) => {
      if (!n || typeof n !== 'object') return
      if (Array.isArray(n)) return n.forEach(push)
      if (n['@graph']) return n['@graph'].forEach(push)
      nodes.push(n)
    }
    push(parsed)
  }
  return { nodes, broken, count: blocks.length }
}

const wordsAfter = (html, marker) => {
  const at = html.indexOf(marker)
  if (at === -1) return 0
  const tail = html
    .slice(at)
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
  return tail.split(/\s+/).filter((w) => /[a-zA-ZÀ-ÿ]/.test(w)).length
}

/* --------------------------------------------------- what we expect to emit */

/*
 * THE PROPERTY LISTS ARE A WHITELIST, NOT A MINIMUM.
 *
 * Checking only that the required fields are present is the check every SEO
 * plugin ships and it catches nothing: the failure on this project would be
 * somebody ADDING a property, an `aggregateRating` copied from a snippet or an
 * `offers` on a reference that has no price. So the set is exact in both
 * directions, and adding a property means changing this file, deliberately, in
 * the same commit.
 */
const SCHEMA = {
  Organization: {
    required: ['@type', '@id', 'name', 'url'],
    allowed: ['logo', 'address', 'vatID', 'taxID'],
  },
  LocalBusiness: {
    required: ['@type', '@id', 'name', 'url', 'address'],
    allowed: ['logo', 'vatID', 'taxID'],
  },
  WebSite: {
    required: ['@type', '@id', 'url', 'name', 'inLanguage', 'publisher'],
    allowed: [],
  },
  BreadcrumbList: {
    required: ['@type', 'itemListElement'],
    allowed: ['@id'],
  },
  Product: {
    required: ['@type', '@id', 'name', 'url', 'description'],
    allowed: ['image', 'sku', 'brand', 'offers', 'gtin', 'inProductGroupWithID'],
  },
}

/* A page type, its URL, and what the policy says about it. */
const PAGES = [
  { name: 'accueil', path: '/', index: true, ld: ['Organization', 'WebSite'] },
  { name: 'boutique', path: '/shop/', index: true, ld: ['BreadcrumbList', 'Organization'] },
  { name: 'categorie', path: '/categorie/t-shirts/', index: true, ld: ['BreadcrumbList', 'Organization'] },
  { name: 'categorie polos', path: '/categorie/polos/', index: true, ld: ['BreadcrumbList', 'Organization'] },
  { name: 'categorie sweats', path: '/categorie/sweats/', index: true, ld: ['BreadcrumbList', 'Organization'] },
  { name: 'sous-categorie', path: '/categorie/t-shirts/manches-courtes/', index: false },
  { name: 'categorie page 2', path: '/categorie/t-shirts/page/2/', index: true },
  { name: 'categorie filtree', path: '/categorie/t-shirts/?f_couleur%5B%5D=blanc', index: false },
  { name: 'categorie triee', path: '/categorie/t-shirts/?orderby=price', index: false },
  { name: 'recherche', path: '/?s=polo', index: false },
  { name: 'devis', path: '/devis/', index: true, ld: ['BreadcrumbList', 'Organization'] },
  { name: 'entreprises', path: '/entreprises/', index: true, ld: ['BreadcrumbList', 'Organization'] },
  { name: 'panier', path: '/cart/', index: false },
  /*
   * THE SIX SECTOR PAGES AND THE GUIDE, which carry most of the words this
   * session wrote and which the first version of this file never fetched: a
   * gate that checks the plumbing and skips the pages is a gate that reports
   * green over five thousand unchecked words.
   */
  { name: 'associations', path: '/associations/', index: true, ld: ['BreadcrumbList', 'Organization'], copy: true },
  { name: 'clubs sportifs', path: '/clubs-sportifs/', index: true, ld: ['BreadcrumbList', 'Organization'], copy: true },
  { name: 'evenementiel', path: '/evenementiel/', index: true, ld: ['BreadcrumbList', 'Organization'], copy: true },
  { name: 'restauration', path: '/restauration/', index: true, ld: ['BreadcrumbList', 'Organization'], copy: true },
  { name: 'petites series', path: '/petites-series/', index: true, ld: ['BreadcrumbList', 'Organization'], copy: true },
  { name: 'guide fichiers', path: '/fichiers-impression/', index: true, ld: ['BreadcrumbList', 'Organization'], copy: true },
  { name: 'panneau de consentement', path: '/?cookies=1', index: false },
]

/* ------------------------------------------------------------------- run */

const isUp = await fetch(BASE + '/', { redirect: 'manual' })
  .then((r) => r.status < 500)
  .catch(() => false)

if (!isUp) {
  process.stdout.write(`la boutique ne répond pas sur ${BASE}. npm run wp:up\n`)
  process.exit(2)
}

/* A product that is a real imported reference, and one that carries a price. */
const productPaths = await (async () => {
  const xml = await get('/wp-sitemap-posts-product-1.xml')
  const locs = all(xml.body, /<loc>([^<]+)<\/loc>/g).map((u) => u.replace(BASE, ''))
  return locs
})()

const pageList = [...PAGES]
if (productPaths.length > 0) {
  pageList.push({ name: 'fiche produit', path: productPaths[0], index: true, ld: ['BreadcrumbList', 'Organization'] })
  pageList.push({ name: 'fiche produit, studio ouvert', path: `${productPaths[0]}?personnaliser=1`, index: false })
  /*
   * A VARIATION URL, which the session brief names as the single most common way
   * a WooCommerce shop tanks its own SEO. 463 references times their colours and
   * sizes is 26 392 combinations, and every one of them is addressable as
   * `?attribute_pa_couleur=…`. The policy is: indexable, and canonical to the
   * CLEAN product URL, which is what `index: true` asserts here since the check
   * compares against the path with its query string removed. NOT noindex: that
   * would contradict the canonical, which is the mistake this whole file exists
   * to catch.
   */
  pageList.push({
    name: 'fiche produit, une déclinaison',
    path: `${productPaths[0]}?attribute_pa_couleur=black&attribute_pa_taille=m`,
    index: true,
  })
}

const fetched = new Map()

for (const page of pageList) {
  const res = await get(page.path)
  fetched.set(page.name, res)

  if (!ok(`${page.name} répond 200`, res.status === 200, String(res.status))) continue

  const html = res.body
  const noindex = isNoindex(html)

  ok(`${page.name} : indexable ou non, comme la politique le dit`, noindex === !page.index, robots(html) || '(aucune)')

  ok(`${page.name} porte exactement un h1`, h1s(html).length === 1, String(h1s(html).length))

  /*
   * THE RULE THIS FILE EXISTS FOR. On an indexable page the canonical must be
   * present and must be the page itself; on a noindex page there must be none
   * at all, because "index that one instead" and "index nothing here" are
   * contradictory and the noindex is the one that travels.
   */
  const link = canonical(html)
  if (page.index) {
    const want = BASE + page.path.split('?')[0]
    ok(`${page.name} se canonicalise sur elle-même`, link === want, `${link} vs ${want}`)
  } else {
    ok(`${page.name}, en noindex, ne publie aucun canonical`, link === null, link || '(aucun)')
  }

  if (page.index) {
    const desc = description(html)
    ok(`${page.name} porte une meta description`, typeof desc === 'string' && desc.length > 30, desc ? `${desc.length} car.` : '(aucune)')
    ok(`${page.name} : la description tient dans ce qu'un résultat affiche`, !desc || desc.length <= 200, desc ? `${desc.length} car.` : '')
  }

  /*
   * NO SLOT SURVIVES INTO A PAGE. `Content::fill()` drops a sentence whose
   * figure it cannot resolve, so `{DELAI_STANDARD}` reaching a customer means
   * the mechanism itself failed.
   */
  const leaked = html.match(/\{[A-Z][A-Z0-9_]{3,}\}/g)
  ok(`${page.name} ne laisse passer aucun emplacement non résolu`, leaked === null, (leaked || []).slice(0, 3).join(' '))

  /* Structured data. */
  const { nodes, broken, count } = jsonLd(html)
  ok(`${page.name} : tous les blocs de données structurées se lisent`, broken.length === 0, broken.join(' | '))

  ok(
    `${page.name} ne publie ni avis ni note`,
    !/aggregateRating|"@type"\s*:\s*"Review"|ratingValue/i.test(html),
    ''
  )

  for (const node of nodes) {
    const type = Array.isArray(node['@type']) ? node['@type'][0] : node['@type']
    const spec = SCHEMA[type]
    if (!ok(`${page.name} : le type ${type || '(sans type)'} est un type que nous émettons`, Boolean(spec), String(type))) continue

    const keys = Object.keys(node).filter((k) => k !== '@context')
    const missing = spec.required.filter((k) => !(k in node))
    const extra = keys.filter((k) => !spec.required.includes(k) && !spec.allowed.includes(k))
    ok(`${page.name} : ${type} porte tout ce que Google demande`, missing.length === 0, missing.join(' '))
    ok(`${page.name} : ${type} ne porte rien que nous n'ayons décidé d'émettre`, extra.length === 0, extra.join(' '))
  }

  if (page.ld) {
    const types = nodes.map((n) => (Array.isArray(n['@type']) ? n['@type'][0] : n['@type']))
    const missing = page.ld.filter((t) => !types.includes(t))
    ok(`${page.name} porte ${page.ld.join(' + ')}`, missing.length === 0, `manque ${missing.join(' ')}`)
  }

  const crumbs = nodes.find((n) => n['@type'] === 'BreadcrumbList')
  if (crumbs) {
    const positions = (crumbs.itemListElement || []).map((i) => i.position)
    const contiguous = positions.every((p, i) => p === i + 1)
    ok(`${page.name} : le fil d'Ariane est numéroté 1..n`, contiguous && positions.length > 1, positions.join(','))
  }

  if (page.copy) {
    const words = wordsAfter(html, 'ts-edito')
    ok(`${page.name} porte une vraie page et pas un gabarit vide`, words >= 500, `${words} mots`)
    /*
     * THE CLAIMS WE MAY NOT MAKE, checked on the page rather than trusted to the
     * writing. Every one of these is a sentence somebody would reasonably want
     * to write and that this shop cannot back today: a delivery we do not hold,
     * a minimum we do not honour, a garment we do not sell, an address we have
     * not been given.
     */
    const banned = [
      /\bà l['\u2019]unité\b/i,
      /\bdès 1 pièce\b/i,
      /\bsans minimum\b/i,
      /\blivraison (express|rapide)\b/i,
      /\bsous 24\s*h\b/i,
      /\bBobigny\b/,
    ]
    /*
     * A GARMENT WE DO NOT SELL IS NOT ON THIS LIST, and that is the lesson from
     * the first run: it flagged « veste de cuisine » on the restauration page,
     * where the sentence is « Pas au catalogue : veste de cuisine, tablier,
     * toque ». Naming what we do not make is exactly what those pages are
     * supposed to do, and a check that forbids the word forbids the honesty. A
     * regular expression cannot tell a claim from its denial, so this list holds
     * only phrases that are a promise in any sentence they appear in.
     */
    const said = banned.filter((re) => re.test(html)).map((re) => String(re))
    ok(`${page.name} ne promet rien que la boutique ne tienne`, said.length === 0, said.join(' '))
  }

  ok(`${page.name} n'a rien à dire à un crawler sur une autre langue`, !/hreflang/.test(html), '')
  ok(`${page.name} n'a pas de blocs de données structurées en double`, count <= 2, `${count} bloc(s)`)
}

/* --------------------------------------------------------- the price rule */

{
  /*
   * A PRICE PUBLISHED TO A MACHINE MUST BE A PRICE ON THE PAGE.
   *
   * Not a schema rule, a money rule, and the one this project has already
   * broken once: `Pricing::quote()` was right while the cart used the old unit
   * price. Here the two numbers come from two different code paths, the
   * `AggregateOffer` from `ProductPage::structured_data()` and the visible one
   * from `Pricing::headline()`, so an equality between them is worth asserting.
   */
  const priced = []
  for (const path of productPaths.slice(0, 40)) {
    const res = await get(path)
    const { nodes } = jsonLd(res.body)
    const product = nodes.find((n) => n['@type'] === 'Product')
    if (product && product.offers) priced.push({ path, product, html: res.body })
    if (priced.length >= 2) break
  }

  if (priced.length === 0) {
    /*
     * NOTHING FOUND IS A RESULT, NOT A PASS. 456 of 458 references carry no
     * published price today (questions 41 and 42) and that is the shipped
     * state, so an empty search here is expected. It is still asserted, because
     * "no product had an offer" and "we did not look at any product" are
     * different, and only one of them means this check ran.
     */
    ok('aucune fiche ne publie de prix, et c\'est l\'état livré', productPaths.length > 0, `${productPaths.length} fiche(s) examinée(s)`)
  }

  for (const { path, product, html } of priced) {
    const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers
    const low = String(
      offer.lowPrice ?? offer.price ?? offer.priceSpecification?.[0]?.price ?? offer.priceSpecification?.price ?? ''
    )
    /*
     * NORMALISE THE SPACES BEFORE COMPARING, and this cost a false failure.
     * `Money::format()` writes a NARROW NO-BREAK SPACE (U+202F) before the euro
     * sign, French typography writes U+00A0 elsewhere, and WordPress emits
     * `&nbsp;` in a third place. A check that only knew about the ASCII space
     * reported the shop publishing a price that it did print.
     */
    const flat = html
      .replace(/<[^>]+>/g, '')
      .replace(/&euro;|&#8364;/g, '€')
      .replace(/&nbsp;|&#160;|&#8239;/g, ' ')
      .replace(/[   ]/g, ' ')
    const shown = [...flat.matchAll(/(\d+[,.]\d{2})\s*\u20AC/g)].map((m) => m[1].replace('.', ','))
    const asFr = low.replace('.', ',')
    const padded = /,\d$/.test(asFr) ? `${asFr}0` : asFr
    ok(
      `le prix publié à Google est un prix imprimé sur la fiche (${path})`,
      shown.includes(padded),
      `${padded} vs ${[...new Set(shown)].slice(0, 6).join(' ')}`
    )
  }
}

/* ------------------------------------------------------------- pagination */

{
  const first = await get('/categorie/t-shirts/page/1/')
  ok('/page/1/ redirige vers la catégorie', first.status === 301, `${first.status} -> ${first.location}`)

  const two = fetched.get('categorie page 2')
  if (two) {
    ok('la page 2 annonce sa précédente', rel(two.body, 'prev') === `${BASE}/categorie/t-shirts/`, rel(two.body, 'prev') || '(aucune)')
    ok('la page 2 annonce sa suivante', (rel(two.body, 'next') || '').includes('/page/3/'), rel(two.body, 'next') || '(aucune)')
    ok('le titre de la page 2 la distingue de la première', /page 2/i.test(title(two.body) || ''), title(two.body) || '')
  }
}

/* ---------------------------------------------------------------- sitemap */

{
  const index = await get('/wp-sitemap.xml')
  const children = all(index.body, /<loc>([^<]+)<\/loc>/g)
  ok('le plan de site répond', index.status === 200 && children.length > 0, `${children.length} fichier(s)`)

  ok('le plan de site ne publie aucun compte utilisateur', !children.some((u) => /users/.test(u)), children.filter((u) => /users/.test(u)).join(' '))

  const usersDirect = await get('/wp-sitemap-users-1.xml')
  ok('et l\'adresse du plan des utilisateurs a disparu, elle ne renvoie pas la boutique', usersDirect.status === 404, String(usersDirect.status))

  const cats = await get('/wp-sitemap-taxonomies-product_cat-1.xml')
  const catUrls = all(cats.body, /<loc>([^<]+)<\/loc>/g)
  for (const slug of ['t-shirts', 'polos', 'sweats']) {
    ok(`la catégorie ${slug} est au plan de site`, catUrls.some((u) => u.endsWith(`/${slug}/`)), '')
  }
  ok('les sous-catégories quasi identiques à leur parent n\'y sont pas', !catUrls.some((u) => /manches-courtes/.test(u)), catUrls.filter((u) => /manches-courtes/.test(u)).join(' '))
  ok('la catégorie par défaut de WordPress n\'y est pas', !catUrls.some((u) => /uncategorized/.test(u)), '')

  const pages = await get('/wp-sitemap-posts-page-1.xml')
  const pageUrls = all(pages.body, /<loc>([^<]+)<\/loc>/g)
  const functional = pageUrls.filter((u) => /\/(cart|checkout|my-account|panier|commander|mon-compte)\//.test(u))
  ok('le plan de site ne propose pas des pages qui se déclarent noindex', functional.length === 0, functional.join(' '))

  /*
   * NAMED FOR WHAT IT ACTUALLY LOOKS AT. It used to be called "no test fixture
   * in the sitemap" while reading one two lines above: `t-shirt-personnalisable`
   * and `teeshoop-demo-tee` ARE in there and are meant to be, because they carry
   * no `exclude-from-catalog` term and are the only purchasable products on the
   * mirror. What this checks is the five that were deliberately hidden from the
   * catalogue and were being handed to Google anyway.
   */
  ok('aucun produit masqué du catalogue au plan de site', !productPaths.some((p) => /e2e|repro-tee|marge-demo|achat-demo|bat-tee/.test(p)), productPaths.filter((p) => /e2e|repro/.test(p)).join(' '))

  /*
   * A URL WE INVITE GOOGLE TO CRAWL MUST NOT THEN REFUSE TO BE INDEXED.
   * Sampled rather than exhaustive: 458 requests against a shared host is a
   * load test, not a check. The sample is deterministic so a failure is
   * reproducible.
   */
  const sample = productPaths.filter((_, i) => i % Math.ceil(productPaths.length / 8) === 0).slice(0, 8)
  let contradictory = 0
  for (const path of sample) {
    const res = await get(path)
    if (res.status !== 200 || isNoindex(res.body)) contradictory += 1
  }
  ok('chaque fiche échantillonnée au plan de site est bien indexable', contradictory === 0, `${contradictory}/${sample.length}`)
}

/* ----------------------------------------------------------------- robots */

{
  const txt = await get('/robots.txt')
  ok('robots.txt répond', txt.status === 200, String(txt.status))
  ok('robots.txt nomme le plan de site', /Sitemap:\s*\S+wp-sitemap\.xml/.test(txt.body), '')

  /*
   * A URL QUI PORTE UN NOINDEX DOIT RESTER EXPLORABLE, sinon la consigne n'est
   * jamais lue. C'est la moitié du sujet que les guides de navigation à
   * facettes se trompent le plus souvent.
   */
  const blocksNoindexable = /Disallow:\s*\/\*\?(orderby|f_|paged|s=)/.test(txt.body)
  ok('robots.txt ne bloque pas ce qui porte déjà une consigne dans la page', !blocksNoindexable, '')
}

/* ---------------------------------------------------------------- consent */

{
  const bare = await get('/')
  const setCookie = [...bare.headers.entries()].filter(([k]) => k.toLowerCase() === 'set-cookie').map(([, v]) => v)
  ok('une première visite ne dépose aucun traceur', setCookie.length === 0, setCookie.join(' | '))

  ok('le bandeau propose refuser et accepter au même niveau', /Tout refuser/.test(bare.body) && /Tout accepter/.test(bare.body), '')

  const nonce = one(bare.body, /name="_wpnonce" value="([^"]*)"/)
  ok('le formulaire de choix porte un jeton', Boolean(nonce), '')

  if (nonce) {
    /*
     * THE ORIGIN HEADER IS SENT, because a browser sends it and the shop now
     * requires it. `fetch` in Node does not add one, so a check written without
     * it would be testing the refusal path and reporting it as the happy one.
     */
    const post = async (field, origin = BASE) => {
      const body = new URLSearchParams({ action: 'teeshoop_consentement', _wpnonce: nonce, retour: `${BASE}/`, [field]: '1' })
      const headers = origin ? { origin } : {}
      const res = await fetch(`${BASE}/wp-admin/admin-post.php`, { method: 'POST', body, headers, redirect: 'manual' })
      return { status: res.status, cookies: res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || ''] }
    }

    /*
     * A CONSENT A THIRD PARTY CAN CAUSE IS NOT A CONSENT, and this is the check
     * for it. WordPress computes one nonce for ALL logged-out visitors and
     * prints it in every public page, so the nonce alone lets any site
     * auto-submit a form that makes our visitor "accept everything". The origin
     * is what refuses it, and a missing origin is refused too: "we could not
     * tell" is not "it is us".
     */
    const forged = await post('tout', 'https://evil.tld')
    ok('un site tiers ne peut pas accepter à la place du visiteur', !forged.cookies.some((c) => c.startsWith('teeshoop_choix=')), forged.cookies.join(' ').slice(0, 80))
    const headless = await post('tout', '')
    ok('une requête sans origine est refusée plutôt que crue', !headless.cookies.some((c) => c.startsWith('teeshoop_choix=')), headless.cookies.join(' ').slice(0, 80))

    const refused = await post('rien')
    ok('refuser enregistre le refus', refused.status === 303 && refused.cookies.some((c) => /teeshoop_choix=v1[^;]*%3A(;|$)/.test(c)), refused.cookies.join(' | ').slice(0, 120))
    ok('refuser ne dépose aucun traceur', !refused.cookies.some((c) => /^teeshoop_src=[^;]+;/.test(c) && !/^teeshoop_src=deleted/.test(c)), '')

    const accepted = await post('tout')
    const choice = accepted.cookies.find((c) => c.startsWith('teeshoop_choix='))
    ok('accepter enregistre le choix', accepted.status === 303 && Boolean(choice), String(accepted.status))

    if (choice) {
      const jar = choice.split(';')[0]
      const after = await fetch(`${BASE}/categorie/t-shirts/`, { headers: { cookie: jar }, redirect: 'manual' })
      const written = (after.headers.getSetCookie ? after.headers.getSetCookie() : [after.headers.get('set-cookie') || '']).join(' ')
      ok('et c\'est seulement après cela que le traceur est écrit', /teeshoop_src=/.test(written), written.slice(0, 100))
    }
  }
}

/* ------------------------------------------------------------------- copy */

{
  /*
   * THE COPY IS UNDER THE GRID, and that is measured rather than asserted from
   * the template: five French competitors out of five put between 0 and 145
   * words above the product grid and between 809 and 3 239 below it.
   */
  const cat = fetched.get('categorie')
  if (cat && cat.status === 200) {
    const below = wordsAfter(cat.body, 'ts-edito')
    ok('la catégorie porte une vraie copie sous la grille', below >= 400, `${below} mots`)
  }
}

/* ------------------------------------------------------------------- self */

if (SELF_TEST) {
  /*
   * PROVE THE GATE FIRES. Two assertions that must fail, checked as failures.
   * A harness on this project once printed nine green ticks under "0 passed".
   */
  const before = results.length
  ok('AUTOTEST: une assertion fausse doit échouer', false, 'attendu')
  ok('AUTOTEST: une assertion vraie doit passer', true, '')
  const fired = results.slice(before)
  const good = fired[0].pass === false && fired[1].pass === true
  process.stdout.write(good ? '\nself-test: le contrôle tire.\n' : '\nself-test: LE CONTRÔLE NE TIRE PAS.\n')
  process.exit(good ? 0 : 2)
}

const failed = results.filter((r) => !r.pass)

if (results.length === 0) {
  process.stdout.write('\nseo-verify: rien n\'a été vérifié.\n')
  process.exit(2)
}

process.stdout.write(`\nseo-verify: ${results.length - failed.length}/${results.length} assertions passées.\n`)
if (failed.length > 0) {
  for (const f of failed) process.stdout.write(`  ${f.name}${f.extra ? `  (${f.extra})` : ''}\n`)
}
process.exit(failed.length > 0 ? 1 : 0)
