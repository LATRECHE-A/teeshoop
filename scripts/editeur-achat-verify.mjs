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
 * la page à la fin de l'achat, une scène WebGL qui continuait de tourner
 * derrière l'aperçu en volume (EDI-03), des boutons détruits sous le focus du
 * clavier (EDI-05), un visuel glissé hors d'atteinte (EDI-13), un panneau fermé
 * qui se rouvrait tout seul (EDI-04). Pour les voir il faut maîtriser QUAND chaque
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
const MODELES = join(ROOT, 'public/models')
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
let lentApercu = 0
let depots = 0
const inconnues = []

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const erreurs = []
/*
 * CHAQUE CONTEXTE WebGL CRÉÉ EST RETENU, pour pouvoir compter ceux qui vivent
 * encore. Une scène arrêtée perd le sien exprès (`glbStage`, `forceContextLoss`) ;
 * une scène oubliée garde le sien et sa boucle de rendu.
 */
await page.addInitScript(() => {
  const avant = HTMLCanvasElement.prototype.getContext
  window.__gl = []
  HTMLCanvasElement.prototype.getContext = function (type, ...reste) {
    const c = avant.call(this, type, ...reste)
    if (c && /webgl/.test(String(type)) && !window.__gl.includes(c)) window.__gl.push(c)
    return c
  }
})
const vivants = () => page.evaluate(() => window.__gl.filter((c) => !c.isContextLost()).length)
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
    if (lentApercu > 0 && nom.startsWith('morceau-apercu3d')) {
      const attente = lentApercu
      lentApercu = 0
      await new Promise((r) => setTimeout(r, attente))
    }
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
  if (url.origin === WORKER && url.pathname.startsWith('/models/')) {
    try {
      const corps = readFileSync(join(MODELES, url.pathname.slice('/models/'.length)))
      return route.fulfill({ status: 200, contentType: 'model/gltf-binary', headers: { 'access-control-allow-origin': '*' }, body: corps })
    } catch {
      inconnues.push(req.url())
      return route.fulfill({ status: 404, body: '' })
    }
  }
  if (url.origin === WORKER && url.pathname === '/api/ar' && req.method() === 'POST') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': ORIGINE },
      body: JSON.stringify({ id: 'arharnais00000001' }),
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
// Ce qui a le focus, nommé comme un lecteur d'écran le nommerait.
const focusSur = () =>
  page.evaluate(() => {
    const a = document.activeElement
    if (!a || a === document.body) return 'BODY'
    const nom = a.getAttribute('aria-label') || (a.textContent ?? '').trim().slice(0, 30)
    return `${a.tagName} ${nom}${a.closest('[data-teeshoop-editeur]') ? '' : ' (hors éditeur)'}`.trim()
  })
// Les commandes sont visées par leur rôle et leur nom, comme un utilisateur.
const pastilleAjout = (nom) => page.locator('.tshop-ed__ajout').getByRole('button', { name: nom, exact: true })
const pastille = (nom) => page.locator('.tshop-ed__couleurs[role="radiogroup"], .tshop-ed__couleurs').first().getByRole('radio', { name: nom, exact: true })
const outil = (nom) => page.locator('.tshop-ed__outils').getByRole('button', { name: nom, exact: true })
async function auClavier(cible) {
  await cible.focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
}

try {
  await page.goto(PAGE)
  await page.locator('[data-teeshoop-editeur][data-teeshoop-editeur-etat="pret"]').waitFor({ timeout: 30000 })
  ok('l’éditeur construit démarre sur la page', true)

  await page.setInputFiles('input.tshop-ed__fichier', { name: 'logo.png', mimeType: 'image/png', buffer: logo })
  // ── EDI-13 : un visuel glissé très loin reste dans la zone ─────────────
  const xIn = () => page.evaluate(() => window.teeshoopEditeur?.creation?.layers?.[0]?.xIn ?? null)
  const toile = page.locator('[data-teeshoop-editeur] canvas').first()
  await toile.waitFor({ timeout: 20000 })
  const boite = await toile.boundingBox()
  let prise = null
  // Trouver un point qui ATTRAPE le calque, sinon le test passerait à vide.
  for (let fy = 0.3; fy <= 0.7 && !prise; fy += 0.1) {
    for (let fx = 0.3; fx <= 0.7 && !prise; fx += 0.1) {
      const x = boite.x + boite.width * fx
      const y = boite.y + boite.height * fy
      const avant = await xIn()
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x + 25, y, { steps: 5 })
      await page.mouse.up()
      await page.waitForTimeout(150)
      if ((await xIn()) !== avant) prise = { x: x + 25, y }
    }
  }
  ok('le harnais attrape le calque sur le canevas', !!prise)
  if (prise) {
    await page.mouse.move(prise.x, prise.y)
    await page.mouse.down()
    await page.mouse.move(prise.x + 3000, prise.y, { steps: 20 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    // La zone du gabarit du t-shirt fait 30,5 cm (12 in) : un centre borné reste
    // à 6 in du milieu au plus, là où 3 000 px de glisser l'emmenaient bien au-delà.
    const x = await xIn()
    ok('un visuel glissé très loin garde son centre dans la zone', x !== null && Math.abs(x) <= 6.01, `xIn = ${x}`)
  }

  const valider = page.locator('[data-teeshoop="valider-creation"]')
  await page.waitForFunction(() => {
    const b = document.querySelector('[data-teeshoop="valider-creation"]')
    return b instanceof HTMLButtonElement && !b.disabled
  }, null, { timeout: 30000 })
  await valider.click()
  await qte.waitFor({ timeout: 20000 })

  // ── EDI-05 : la grille au clavier ──────────────────────────────────────
  await auClavier(pastilleAjout('Blanc'))
  ok('ajouter un coloris au clavier mène à sa première case', /^INPUT .*S.*Blanc/.test(await focusSur()), await focusSur())
  await auClavier(page.getByRole('button', { name: 'Retirer le coloris Blanc', exact: true }))
  ok('le retirer rend le focus au « Retirer » de la ligne voisine', (await focusSur()) === 'BUTTON Retirer le coloris Noir', await focusSur())

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

  // ── EDI-05 : les pastilles et la barre d'outils au clavier ─────────────
  await page.locator('[data-teeshoop="revenir-creation"]').click()
  await auClavier(pastille('Blanc'))
  ok('choisir un coloris au clavier garde le focus sur sa pastille', (await focusSur()) === 'BUTTON Blanc', await focusSur())
  await auClavier(outil('Centrer'))
  ok('« Centrer » au clavier garde le focus sur « Centrer »', (await focusSur()) === 'BUTTON Centrer', await focusSur())

  // ── EDI-03 : l'aperçu en volume, une scène à la fois ────────────────────
  await page.locator('[data-teeshoop="vue-avancee"]').click()
  await page.locator('[data-teeshoop="apercu-volume"]').click()
  await page.locator('[data-teeshoop="essayer-ar"]').waitFor({ timeout: 120000 })
  await page.waitForFunction(() => window.__gl.some((c) => !c.isContextLost()), null, { timeout: 60000 })
  ok('l’aperçu en volume tourne sur une scène', (await vivants()) === 1, `${await vivants()} contexte(s) vivant(s)`)

  await page.locator('[data-teeshoop="essayer-ar"]').click()
  await page.locator('[data-teeshoop="ar-pret"]').waitFor({ timeout: 60000 })
  await page.waitForTimeout(2000)
  ok('« Voir chez vous » n’en monte pas une seconde derrière la première', (await vivants()) === 1, `${await vivants()} contexte(s) vivant(s)`)
  const memeScene = await page.evaluate(() => {
    const c = document.querySelector('[data-teeshoop="apercu-3d"]')
    return !!c && window.__gl.some((g) => g.canvas === c && !g.isContextLost())
  })
  ok('et l’aperçu visible est la scène qui tourne', memeScene)

  // Femme puis Homme pendant la construction : une seule scène au bout.
  const silhouettes = page.locator('.tshop-ed__apercu [role="radio"]')
  await silhouettes.nth(1).click()
  await silhouettes.nth(0).click()
  await page.locator('[data-teeshoop="essayer-ar"]').waitFor({ timeout: 120000 })
  await page.waitForFunction(() => window.__gl.some((c) => !c.isContextLost()), null, { timeout: 60000 })
  await page.waitForTimeout(4000)
  ok('deux changements de silhouette rapides laissent une seule scène', (await vivants()) === 1, `${await vivants()} contexte(s) vivant(s)`)

  // En dernier, parce qu'il retire le visuel : le focus reste dans l'éditeur.
  await auClavier(outil('Retirer'))
  const apresRetrait = await focusSur()
  ok('« Retirer » au clavier laisse le focus dans l’éditeur', apresRetrait !== 'BODY' && !apresRetrait.endsWith('(hors éditeur)'), apresRetrait)

  // ── EDI-04 : fermer pendant le chargement de l'aperçu, c'est fermé ──────
  // Sur une page neuve : le morceau 3D ne doit pas déjà être en mémoire.
  await page.goto(PAGE)
  await page.locator('[data-teeshoop-editeur][data-teeshoop-editeur-etat="pret"]').waitFor({ timeout: 30000 })
  await page.setInputFiles('input.tshop-ed__fichier', { name: 'logo.png', mimeType: 'image/png', buffer: logo })
  await page.waitForFunction(() => window.teeshoopEditeur?.creation?.layers?.length > 0, null, { timeout: 30000 })
  // Le morceau 3D arrive APRÈS la fermeture : c'est la course du défaut.
  lentApercu = 4000
  await page.locator('[data-teeshoop="vue-avancee"]').click()
  await page.locator('[data-teeshoop="apercu-volume"]').click()
  await page.locator('[data-teeshoop="vue-avancee"]').click()
  await page.waitForTimeout(12000)
  const zoneAvancee = await page.evaluate(() => {
    const z = document.querySelector('.tshop-ed__avancee')
    return z ? z.childElementCount : 0
  })
  ok('un panneau fermé pendant un chargement ne se rouvre pas', zoneAvancee === 0, `${zoneAvancee} élément(s)`)
  ok('et ne laisse aucune scène 3D tourner', (await vivants()) === 0, `${await vivants()} contexte(s) vivant(s)`)
} catch (e) {
  ok('le parcours va au bout', false, String(e?.message ?? e).split('\n')[0])
} finally {
  ok('aucune erreur dans la console ni dans la page', erreurs.length === 0, erreurs.slice(0, 3).join(' | '))
  ok('aucune requête que le harnais ne sait pas servir', inconnues.length === 0, inconnues.slice(0, 3).join(' | '))
  await browser.close()
}

process.stdout.write(`\nediteur-achat-verify : ${verifies - echecs}/${verifies} assertions passées.\n`)
process.exit(verifies === 0 ? 2 : echecs > 0 ? 1 : 0)
