#!/usr/bin/env node
/**
 * L'achat dans l'éditeur, rejoué dans un vrai navigateur, sans boutique ni Worker.
 *   npm run build:editeur      (le paquet versionné, celui que la fiche charge)
 *   npm run verify:editeur-achat
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE HARNAIS EXISTE
 * `scripts/wp-e2e-verify.mjs` et `scripts/editeur-shots.mjs` rejouent l'achat
 * contre le miroir WordPress et un `wrangler dev`, ce qui est la seule façon de
 * prouver la couture, et aussi la raison pour laquelle ils ne tournent que sur
 * un miroir vendable. Les défauts de la passe du 26/09/2026 vivent AVANT la
 * couture, dans l'ordre des clics et des réponses : un second clic sur
 * « Ajouter au panier » qui déposait une seconde ligne (EDI-01), un devis en
 * retard qui écrasait celui de l'écran (EDI-02), un focus qui tombait en haut de
 * la page à la fin de l'achat. Pour les voir il faut maîtriser QUAND chaque
 * réponse arrive, et c'est ce que ce harnais fait : il sert le paquet construit
 * sur une origine inventée et répond lui-même, au fil, à la boutique et au
 * Worker. Le code qui tourne est celui que la fiche produit charge.
 *
 * CE QU'IL NE PROUVE PAS : que la boutique accepte la ligne. C'est le travail
 * de `test:wp` et de `verify:wp-e2e`.
 *
 * La console et les erreurs de page sont écoutées et doivent rester vides : le
 * rendu est côté client, une exception n'y produit aucune erreur HTTP.
 * Sort 1 sur un échec, 2 si rien n'a pu être vérifié.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const ASSETS = join(ROOT, 'wp-plugins/teeshoop-core/assets/editeur')
const ORIGINE = 'http://boutique.test'
const WORKER = 'http://worker.test'
const PAGE = `${ORIGINE}/produit/harnais/`
const CHEMIN_ACTIFS = '/wp-content/plugins/teeshoop-core/assets/editeur/'

let echecs = 0
let verifies = 0
function ok(nom, cond, detail = '') {
  verifies++
  if (!cond) echecs++
  process.stdout.write(`${cond ? 'PASS' : 'FAIL'} ${nom}${detail ? `  (${detail})` : ''}\n`)
  return cond
}
function arret(message) {
  process.stdout.write(`\nediteur-achat-verify : ${message}\n`)
  process.exit(verifies === 0 ? 2 : 1)
}

const fichiers = readdirSync(ASSETS)
const entree = fichiers.find((f) => /^editeur-.*\.js$/.test(f))
const style = fichiers.find((f) => /^editeur-.*\.css$/.test(f))
if (!entree || !style) arret(`aucun paquet dans ${ASSETS} : lancez npm run build:editeur`)

// Un prix par pièce fixe : chaque quantité a un total que nulle autre n'a, donc
// le montant affiché dit de quelle quantité il vient.
const eur = (centimes) => `${(centimes / 100).toFixed(2).replace('.', ',')} €`
function devis(qty) {
  return {
    qty,
    sides: 1,
    unit_ht: 1000,
    total_ht: qty * 1000,
    total_vat: qty * 200,
    total_ttc: qty * 1200,
    discount_rate: 0,
    vat_rate: 0.2,
    display: { unit_ht: eur(1000), total_ht: eur(qty * 1000), total_ttc: eur(qty * 1200) },
  }
}

const tailles = ['S', 'M', 'L', 'XL']
const zone = Object.fromEntries(tailles.map((t) => [t, { wCm: 28, hCm: 35 }]))
const contexte = {
  productId: 4242,
  garment: 'tee',
  title: 'T-shirt du harnais',
  restUrl: `${ORIGINE}/wp-json/teeshoop/v1/`,
  nonce: 'nonce-du-harnais',
  cartUrl: `${ORIGINE}/panier/`,
  workerUrl: WORKER,
  colours: [
    { id: 'noir', name: 'Noir', stops: ['#1c1c1c'] },
    { id: 'blanc', name: 'Blanc', stops: ['#f4f4f2'] },
  ],
  sizes: tailles,
  pricedSize: 'M',
  areas: [{ side: 'front', bySize: zone }],
  sides: ['front'],
  priceBases: { known: true, two: true, lead: 'ht', mention: '' },
  quoteUrl: '#teeshoop-devis',
}

const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Harnais</title>
<link rel="stylesheet" href="${CHEMIN_ACTIFS}${style}"></head>
<body><main style="max-width:1100px;margin:0 auto">
<div data-teeshoop-editeur>L’éditeur n’a pas démarré.</div></main>
<script>window.TEESHOOP_EDITEUR = ${JSON.stringify(contexte)}</script>
<script type="module" src="${CHEMIN_ACTIFS}${entree}"></script>
</body></html>`

const logo = readFileSync(join(ROOT, 'wp-themes/teeshoop/assets/images/logo-teeshoop.png'))

// ── ce que le harnais maîtrise ─────────────────────────────────────────────
const panier = []
const devisDemandes = []
let lentProchainDevis = 0
let lentDepot = 0
let depots = 0
const inconnues = []

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const erreurs = []
page.on('pageerror', (e) => erreurs.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') erreurs.push(`console: ${m.text()}`)
})

await page.route('**/*', async (route) => {
  const req = route.request()
  const url = new URL(req.url())
  if (url.origin === ORIGINE && url.pathname === '/produit/harnais/') {
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
  }
  if (url.origin === ORIGINE && url.pathname.startsWith(CHEMIN_ACTIFS)) {
    const nom = url.pathname.slice(CHEMIN_ACTIFS.length)
    try {
      const corps = readFileSync(join(ASSETS, nom))
      const type = nom.endsWith('.js') ? 'text/javascript' : nom.endsWith('.css') ? 'text/css' : nom.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream'
      return route.fulfill({ status: 200, contentType: type, body: corps })
    } catch {
      inconnues.push(req.url())
      return route.fulfill({ status: 404, body: '' })
    }
  }
  if (url.origin === ORIGINE && url.pathname === '/wp-json/teeshoop/v1/quote') {
    const qty = Number(url.searchParams.get('qty'))
    devisDemandes.push(qty)
    if (lentProchainDevis > 0) {
      const attente = lentProchainDevis
      lentProchainDevis = 0
      await new Promise((r) => setTimeout(r, attente))
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(devis(qty)) })
  }
  if (url.origin === ORIGINE && url.pathname === '/wp-json/teeshoop/v1/cart' && req.method() === 'POST') {
    panier.push(JSON.parse(req.postData() ?? '{}'))
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ cart_count: panier.length, cart_url: `${ORIGINE}/panier/` }),
    })
  }
  if (url.origin === WORKER && url.pathname === '/api/design' && req.method() === 'POST') {
    depots++
    if (lentDepot > 0) await new Promise((r) => setTimeout(r, lentDepot))
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': ORIGINE },
      body: JSON.stringify({ id: `harnaisdesign${String(depots).padStart(7, '0')}`, proof: 'p' }),
    })
  }
  inconnues.push(`${req.method()} ${req.url()}`)
  return route.fulfill({ status: 404, body: '' })
})

const ttc = () => page.locator('[data-teeshoop="total-ttc"]').first().innerText().catch(() => '')
async function attendreTotal(qty, delai = 20000) {
  const voulu = eur(qty * 1200)
  const fin = Date.now() + delai
  while (Date.now() < fin) {
    if ((await ttc()).includes(voulu)) return true
    await page.waitForTimeout(100)
  }
  return false
}
const bouton = page.locator('[data-teeshoop="add-to-cart"]')
const etatBouton = () => bouton.evaluate((b) => ({ disabled: b.disabled, texte: (b.textContent ?? '').trim() }))
const qte = page.locator('input.tshop-ed__qte').first()

try {
  await page.goto(PAGE)
  await page.locator('[data-teeshoop-editeur][data-teeshoop-editeur-etat="pret"]').waitFor({ timeout: 30000 })
  ok('l’éditeur construit démarre sur la page', true)

  await page.setInputFiles('input.tshop-ed__fichier', { name: 'logo.png', mimeType: 'image/png', buffer: logo })
  const valider = page.locator('[data-teeshoop="valider-creation"]')
  await page.waitForFunction(() => {
    const b = document.querySelector('[data-teeshoop="valider-creation"]')
    return b instanceof HTMLButtonElement && !b.disabled
  }, null, { timeout: 30000 })
  await valider.click()
  await qte.waitFor({ timeout: 20000 })

  // ── un premier achat ───────────────────────────────────────────────────
  await qte.fill('40')
  if (!ok('le prix de 40 pièces est affiché', await attendreTotal(40), await ttc())) arret('pas de prix, rien à acheter')
  await bouton.click()
  await page.locator('[data-teeshoop="cart-done"]').waitFor({ timeout: 60000 })
  ok('le premier ajout part au panier, une fois', panier.length === 1 && panier[0].qty === 40, JSON.stringify(panier.map((p) => p.qty)))

  const focus = await page.evaluate(() => {
    const a = document.activeElement
    return { dedans: !!a && a !== document.body && !!a.closest('[data-teeshoop-editeur]'), quoi: a ? `${a.tagName} ${(a.textContent ?? '').trim().slice(0, 30)}` : 'rien' }
  })
  ok('le focus reste dans l’éditeur, sur la suite de l’achat', focus.dedans, focus.quoi)

  // ── EDI-01 : le même achat ne repart pas ────────────────────────────────
  const apres = await etatBouton()
  ok('le bouton dit que c’est fait, et ne se propose plus', apres.disabled && apres.texte === 'Ajouté au panier', JSON.stringify(apres))
  await bouton.evaluate((b) => b.click())
  await page.waitForTimeout(2500)
  ok('un second clic n’ajoute pas une seconde ligne identique', panier.length === 1, `${panier.length} ajout(s)`)

  // Toute modification rouvre l'achat.
  await qte.fill('45')
  await attendreTotal(45)
  const rouvert = await etatBouton()
  ok('une quantité changée rouvre l’achat', !rouvert.disabled && rouvert.texte === 'Ajouter au panier', JSON.stringify(rouvert))
  ok('et retire la confirmation, qui ne décrit plus l’écran', (await page.locator('[data-teeshoop="cart-done"]').count()) === 0)

  // ── EDI-02 : un changement PENDANT l'achat ─────────────────────────────
  lentProchainDevis = 3000 // le devis de CET achat (45) arrive en dernier
  lentDepot = 1500
  await bouton.click()
  await page.waitForTimeout(300)
  await qte.fill('55') // pendant la mesure : l'écran rechiffre 55, vite
  await page.locator('[data-teeshoop="cart-done"]').waitFor({ timeout: 60000 })
  await page.waitForTimeout(800)
  ok('l’achat part avec la grille du clic', panier.length === 2 && panier[1].qty === 45, JSON.stringify(panier.map((p) => p.qty)))
  ok(
    'le prix affiché est celui de la grille à l’écran, pas celui de l’achat en retard',
    (await ttc()).includes(eur(55 * 1200)),
    `${await ttc()} sous une grille à 55`,
  )
  const pendant = await etatBouton()
  ok('et l’écran, qui n’est pas ce qui a été ajouté, reste achetable', !pendant.disabled && pendant.texte === 'Ajouter au panier', JSON.stringify(pendant))
} catch (e) {
  ok('le parcours va au bout', false, String(e?.message ?? e).split('\n')[0])
} finally {
  ok('aucune erreur dans la console ni dans la page', erreurs.length === 0, erreurs.slice(0, 3).join(' | '))
  ok('aucune requête que le harnais ne sait pas servir', inconnues.length === 0, inconnues.slice(0, 3).join(' | '))
  await browser.close()
}

process.stdout.write(`\nediteur-achat-verify : ${verifies - echecs}/${verifies} assertions passées.\n`)
process.exit(verifies === 0 ? 2 : echecs > 0 ? 1 : 0)
