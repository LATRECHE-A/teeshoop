#!/usr/bin/env node
/**
 * LE CHEMIN D'ACHAT, PHOTOGRAPHIÉ AUX DEUX LARGEURS QUI COMPTENT.
 *
 * Panier, caisse, commande reçue, mon compte, et un message transactionnel, à
 * 375 px puis à 1 440 px, sur le miroir docker.
 *
 * ── CE N'EST PAS UN HARNAIS DE CAPTURE, C'EST UN ACHAT ──────────────────────
 *
 * Il ne pose pas un panier factice : il fait le parcours. Il ouvre une fiche de
 * la gamme, lit le jeton REST que la page publie pour sa propre passerelle,
 * POSTe une ligne dans `/teeshoop/v1/cart` exactement comme le fait
 * `assets/bridge.js`, puis remplit la caisse et valide la commande. Ce qui est
 * photographié est donc ce qu'un client voit, y compris les lignes de
 * personnalisation, les totaux calculés par `Pricing::quote()` et la vraie page
 * de commande reçue.
 *
 * Le corollaire est qu'il ÉCHOUE quand le parcours échoue, ce qui est le
 * comportement voulu : une capture d'un panier vide serait une preuve que rien
 * ne marche, présentée comme une preuve que tout marche.
 *
 * ── CE QU'IL N'A PAS LE DROIT DE FAIRE ──────────────────────────────────────
 *
 * Toucher à une commande déjà passée. Il en CRÉE une, la photographie, et la
 * laisse : `calculate_taxes()` de WooCommerce reprend une commande au taux du
 * jour, et c'est précisément pourquoi la facture est gelée à l'émission.
 *
 * ── ASSERTIONS, PAS SEULEMENT DES IMAGES ────────────────────────────────────
 *
 * Une capture qu'aucune assertion n'accompagne ne prouve rien : personne ne
 * regarde 10 fichiers PNG. Chaque page vérifie qu'elle contient ce qu'elle doit
 * contenir et qu'elle ne déborde pas latéralement à 375 px, largeur à laquelle
 * un tableau de panier à cinq colonnes déborde par défaut.
 *
 *   npm run verify:achat
 *
 * Sortie : 0 tout passe · 1 une assertion a échoué · 2 rien n'a été asserté.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const ROOT = new URL('..', import.meta.url).pathname
const BASE = process.env.TEESHOOP_SHOP ?? 'http://localhost:8080'
const OUT = process.env.ACHAT_OUT ?? 'docs/screens/nuit-2'
const WIDTHS = [375, 1440]
const WORKER = process.env.TEESHOOP_WORKER ?? 'http://127.0.0.1:8788'

const RED = '[31m'
const GREEN = '[32m'
const DIM = '[2m'
const OFF = '[0m'

const results = []
const ok = (name, pass, extra = '') => {
  results.push({ name, pass })
  console.log(`${pass ? GREEN + 'PASS' : RED + 'FAIL'}${OFF} ${name}${extra ? `: ${extra}` : ''}`)
}

function wp(php) {
  const dir = mkdtempSync(join(tmpdir(), 'teeshoop-achat-'))
  const file = join(dir, 'run.php')
  try {
    writeFileSync(file, php)
    return execFileSync(
      'docker',
      ['compose', '-f', 'wp-local/docker-compose.yml', 'run', '--rm', '-T', 'wpcli', 'eval-file', '-'],
      { cwd: ROOT, input: readFileSync(file), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function json(out, what) {
  const m = /<<<JSON>>>([\s\S]*?)<<<FIN>>>/.exec(out)
  if (!m) {
    console.error(`${RED}achat-shots: ${what} n'a rien rendu de lisible.${OFF}\n${out.slice(-1200)}`)
    process.exit(2)
  }
  return JSON.parse(m[1])
}

mkdirSync(OUT, { recursive: true })

/*
 * LA FICHE À OUVRIR EST CHOISIE PAR LA BOUTIQUE, pas écrite ici. Un slug en dur
 * dans un harnais est un slug qui pourrit le jour où une référence change de
 * nom, et le harnais échoue alors pour une raison qui n'a rien à voir avec ce
 * qu'il vérifie.
 */
const shop = json(
  wp(`<?php
$ids = get_posts( array( 'post_type' => 'product', 'post_status' => 'publish', 'posts_per_page' => 1, 'orderby' => 'ID', 'order' => 'ASC', 'meta_key' => '_teeshoop_gamme' ) );
$out = array( 'found' => false );
if ( $ids ) {
	$p = wc_get_product( (int) $ids[0]->ID ?? 0 );
	$p = $p ?: wc_get_product( (int) $ids[0] );
	if ( $p ) {
		$out = array(
			'found'   => true,
			'id'      => (int) $p->get_id(),
			'nom'     => $p->get_name(),
			'url'     => (string) get_permalink( $p->get_id() ),
			'panier'  => (string) wc_get_cart_url(),
			'caisse'  => (string) wc_get_checkout_url(),
			'compte'  => (string) wc_get_page_permalink( 'myaccount' ),
			'unverified' => (bool) \\Teeshoop\\Core\\Settings::allow_unverified_designs(),
		);
	}
}
echo "\\n<<<JSON>>>" . wp_json_encode( $out ) . "<<<FIN>>>\\n";
`),
  'la boutique',
)

if (!shop.found) {
  console.error(`${RED}achat-shots: aucune offre de la gamme n'est publiée. Lancez « teeshoop gamme appliquer ».${OFF}`)
  process.exit(2)
}
/*
 * ── LA CRÉATION EST VRAIE, ET C'EST POUR ÇA QUE LE WORKER TOURNE ────────────
 *
 * Le miroir n'a pas `TEESHOOP_ALLOW_UNVERIFIED_DESIGNS`, et c'est voulu :
 * `scripts/wp-e2e-verify.mjs` refuse de tourner si la constante est définie,
 * parce qu'une boutique qui accepte une création que personne n'a confirmée
 * accepte une commande qu'on ne peut pas imprimer. Ce harnais ne contourne donc
 * rien : il POSTe une vraie création sur la vraie route ouverte du Worker
 * (`POST /api/design`), et le panier la vérifie comme il vérifie celle d'un
 * client. Un document sans image est un document valide (un marquage en texte
 * seul), ce qui évite d'inventer une œuvre pour une capture d'écran.
 */
async function createDesign() {
  // Un PNG 1x1 transparent : l'aperçu est obligatoire, sa taille ne l'est pas.
  const pngBytes = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
    (c) => c.charCodeAt(0),
  )
  const doc = {
    garmentId: 'tee',
    colorId: 'navy',
    layers: [{ type: 'text', side: 'front', text: 'ATELIER DURAND' }],
    sides: [
      { id: 'front', area_sq_cm: 288, pieces: [{ w_cm: 18, h_cm: 14.5 }] },
      { id: 'back', area_sq_cm: 210, pieces: [{ w_cm: 15, h_cm: 14 }] },
    ],
  }
  const form = new FormData()
  form.set('design', new Blob([JSON.stringify(doc)], { type: 'application/json' }), 'design.json')
  form.set('preview', new Blob([pngBytes], { type: 'image/png' }), 'preview.png')
  const res = await fetch(`${WORKER}/api/design`, { method: 'POST', body: form })
  const body = await res.text()
  if (!res.ok) return { ok: false, why: `le Worker refuse la création (${res.status}) : ${body.slice(0, 200)}` }
  try {
    const id = JSON.parse(body).id
    return id ? { ok: true, id } : { ok: false, why: `le Worker n'a pas rendu d'identifiant : ${body.slice(0, 200)}` }
  } catch {
    return { ok: false, why: `réponse illisible du Worker : ${body.slice(0, 200)}` }
  }
}

const design = await createDesign()
if (!design.ok) {
  console.error(`${RED}achat-shots: ${design.why}${OFF}`)
  console.error(`${DIM}Le Worker local doit tourner : npx wrangler dev --port 8788${OFF}`)
  process.exit(2)
}
console.log(`${DIM}création enregistrée par le Worker : ${design.id}${OFF}`)

console.log(`${DIM}fiche ouverte : ${shop.nom} (#${shop.id})${OFF}`)

const browser = await chromium.launch()
let orderNumber = ''

for (const width of WIDTHS) {
  const context = await browser.newContext({
    viewport: { width, height: width === 375 ? 780 : 1000 },
    locale: 'fr-FR',
  })
  const page = await context.newPage()

  const shot = async (name) => {
    await page.waitForTimeout(250)
    await page.screenshot({ path: `${OUT}/${name}-${width}.png`, fullPage: true })
  }
  /** No page of a shop may scroll sideways, and 375 px is where it happens. */
  const noSideScroll = async (name) => {
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    ok(`${name} ne déborde pas latéralement (${width} px)`, over <= 1, `${over} px de trop`)
  }

  // -- la fiche produit, avec les dimensions d'impression -------------------
  await page.goto(shop.url, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => undefined)
  const grid = await page.locator('.ts-table--pricing, .ts-table').first().count()
  ok(`fiche produit : la grille de prix est rendue (${width} px)`, grid > 0)
  const areas = await page.locator('.ts-table--areas').first().count()
  ok(`fiche produit : les dimensions d'impression sont publiées (${width} px)`, areas > 0)
  await shot('fiche-produit')
  await noSideScroll('fiche produit')

  // -- le panier, construit comme la passerelle le fait ---------------------
  /*
   * LE JETON EST SUR LA PAGE QUI OUVRE LE STUDIO, pas sur la fiche.
   *
   * `Shortcode::enqueue()` ne publie `TEESHOOP_BRIDGE` que là où l'éditeur est
   * réellement encadré, ce qui est la bonne portée : un jeton REST posé sur
   * chaque fiche du catalogue serait un jeton de plus dans la nature pour rien.
   * Le harnais va donc le chercher là où un client le rencontre, en ouvrant la
   * fiche avec `?personnaliser=1`.
   */
  await page.goto(`${shop.url}${shop.url.includes('?') ? '&' : '?'}personnaliser=1`, {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForFunction(() => Boolean(window.TEESHOOP_BRIDGE?.nonce), null, { timeout: 15000 }).catch(
    () => undefined,
  )

  const added = await page.evaluate(async ({ productId, designId }) => {
    const cfg = window.TEESHOOP_BRIDGE
    if (!cfg || !cfg.restUrl || !cfg.nonce) return { ok: false, why: 'la page ne publie pas de jeton REST' }
    const res = await fetch(cfg.restUrl + 'cart', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-wp-nonce': cfg.nonce },
      body: JSON.stringify({
        product_id: productId,
        qty: 12,
        size_grid: { M: 7, L: 5 },
        design_id: designId,
        sides: [
          { id: 'front', area_sq_cm: 288, pieces: [{ w_cm: 18, h_cm: 14.5 }] },
          { id: 'back', area_sq_cm: 210, pieces: [{ w_cm: 15, h_cm: 14 }] },
        ],
      }),
    })
    return { ok: res.ok, status: res.status, body: (await res.text()).slice(0, 300) }
  }, { productId: shop.id, designId: design.id })
  ok(`la ligne entre au panier (${width} px)`, added.ok === true, added.why ?? added.body ?? '')
  if (!added.ok) break

  /*
   * LES DEUX CAISSES, ET LE HARNAIS NE CHOISIT PAS.
   *
   * Les pages `cart` et `checkout` du miroir portent les BLOCS de WooCommerce,
   * pas les raccourcis classiques ; « Mon compte » porte le raccourci. Les deux
   * balisages sont donc acceptés, et l'assertion porte sur le FAIT (une ligne
   * est là, un total est affiché) plutôt que sur le nom de classe qui le porte.
   * Un harnais qui n'accepterait qu'un des deux échouerait le jour où la
   * boutique bascule, pour une raison qui n'a rien à voir avec ce qu'il vérifie.
   */
  await page.goto(shop.panier, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => undefined)
  /*
   * ATTENDRE UN MONTANT, PAS UNE LIGNE.
   *
   * Le panier en blocs rend d'abord un SQUELETTE : les mêmes lignes, les mêmes
   * classes, et des barres grises à la place des prix. `networkidle` est déjà
   * atteint à ce moment-là, et attendre `.wc-block-cart-items__row` était donc
   * satisfait par le squelette. La première capture prise ainsi montrait un
   * panier entièrement gris, ce qui aurait été livré comme la preuve que le
   * panier est habillé.
   *
   * Ce qui est attendu est donc une SOMME EN EUROS dans le bloc, c'est-à-dire
   * la chose que le squelette n'a pas.
   */
  await page
    .locator('.wp-block-woocommerce-cart, .woocommerce-cart-form')
    .first()
    .waitFor({ timeout: 20000 })
    .catch(() => undefined)
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector('.wp-block-woocommerce-cart, .woocommerce-cart-form')
        return Boolean(el && /\d[\d\s\u202f\u00a0]*,\d\d\s*(€|EUR)/.test(el.textContent ?? ''))
      },
      null,
      { timeout: 30000 },
    )
    .catch(() => undefined)
  const cartLines = await page.locator('.woocommerce-cart-form__cart-item, .wc-block-cart-items__row').count()
  ok(`panier : une ligne au moins (${width} px)`, cartLines > 0, `${cartLines} ligne(s)`)
  /*
   * LE MONTANT, PAS L'INTITULÉ. `.wc-block-components-totals-footer-item` porte
   * « Total estimé » et met la somme dans un enfant, donc lire cet élément seul
   * rendait un libellé sans chiffre et l'assertion échouait sur un panier qui
   * allait très bien. C'est le conteneur des totaux qui est lu.
   */
  /*
   * LE TOTAL, PAS LA PREMIÈRE SOMME DU BLOC.
   *
   * Lire le conteneur entier et prendre le premier montant donnait le
   * sous-total à 375 px et autre chose à 1 440 px, parce que le bloc réordonne
   * ses lignes : 61,20 EUR d'un côté, 367,20 de l'autre, pour un même panier.
   * Une assertion qui compare deux nombres doit d'abord savoir lesquels.
   */
  const cartTotal = await page
    .locator(
      '.wc-block-components-totals-footer-item .wc-block-components-totals-item__value, .cart_totals .order-total .woocommerce-Price-amount',
    )
    .first()
    .innerText()
    .catch(() => '')
  /*
   * UN MONTANT, pas seulement un chiffre : « Colissimo, livraison offerte » et
   * « Total estimé » contiennent l'un un mot et l'autre rien, et la première
   * version de cette assertion attrapait la ligne de port. Ce qui est cherché
   * est une somme en euros, ce qui est ce que le client vient lire.
   */
  const totalShown = /\d[\d\s\u202f]*,\d\d\s*(€|EUR)/.test((cartTotal ?? '').replace(/\u00a0/g, ' '))
  ok(
    `panier : un total en euros est affiché (${width} px)`,
    totalShown,
    (cartTotal ?? '').replace(/\s+/g, ' ').trim().slice(0, 90),
  )
  await shot('panier')
  await noSideScroll('panier')

  // -- la caisse ------------------------------------------------------------
  await page.goto(shop.caisse, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await page
    .locator('.woocommerce-checkout-review-order-table, .wc-block-components-order-summary, .wc-block-checkout')
    .first()
    .waitFor({ timeout: 20000 })
    .catch(() => undefined)
  // Même squelette, même attente : la caisse en blocs hydrate après networkidle.
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector('.wp-block-woocommerce-checkout, form.checkout')
        return Boolean(el && /\d[\d\s\u202f\u00a0]*,\d\d\s*(€|EUR)/.test(el.textContent ?? ''))
      },
      null,
      { timeout: 30000 },
    )
    .catch(() => undefined)
  const review = await page
    .locator('.woocommerce-checkout-review-order-table, .wc-block-components-order-summary')
    .count()
  ok(`caisse : le récapitulatif est rendu (${width} px)`, review > 0)

  /*
   * ── LE MONTANT, PAS « UN » MONTANT ────────────────────────────────────────
   *
   * Les assertions d'argent de ce harnais vérifiaient qu'UNE somme en euros est
   * affichée, jamais LAQUELLE. Le seul contrôle qui promène un client de la
   * fiche à la commande, au tarif re-dérivé, ne pouvait donc pas échouer sur un
   * écart entre ce qui est annoncé et ce qui est facturé, qui est précisément
   * ce que ce projet redoute le plus.
   *
   * La caisse doit porter le même total TTC que le panier a annoncé, au centime.
   */
  const checkoutTotal = await page
    .locator(
      '.wc-block-components-totals-footer-item .wc-block-components-totals-item__value, .order-total .woocommerce-Price-amount',
    )
    .first()
    .innerText()
    .catch(() => '')
  const cents = (text) => {
    const m = /(\d[\d\s\u202f\u00a0]*),(\d\d)\s*(?:€|EUR)/.exec((text ?? '').replace(/\u00a0/g, ' '))
    return m ? Number(m[1].replace(/[\s\u202f]/g, '')) * 100 + Number(m[2]) : null
  }
  ok(
    `caisse : le total est celui du panier, au centime (${width} px)`,
    cents(checkoutTotal) !== null && cents(checkoutTotal) === cents(cartTotal),
    `panier ${cents(cartTotal)} c, caisse ${cents(checkoutTotal)} c`,
  )

  await shot('caisse')
  await noSideScroll('caisse')

  /*
   * La commande n'est passée qu'UNE FOIS, à la première largeur : deux
   * commandes pour deux captures salissent la boutique et la deuxième
   * n'apprend rien. La seconde largeur rouvre la même.
   */
  if (!orderNumber) {
    const fill = async (sel, value) => {
      const el = page.locator(sel)
      if ((await el.count()) > 0) await el.first().fill(value)
    }
    /*
     * LE BANDEAU DE CONSENTEMENT D'ABORD, parce qu'il est collant et qu'il
     * couvre le formulaire. Un client fait exactement ça : il répond avant de
     * remplir. « Tout refuser » plutôt que « Tout accepter », parce que c'est
     * l'état par défaut du parcours et donc celui qu'il faut savoir traverser.
     */
    const refuse = page.locator('.ts-consent__btn, .ts-consent button').filter({ hasText: /refuser/i })
    if ((await refuse.count()) > 0) {
      await refuse.first().click().catch(() => undefined)
      await page.waitForTimeout(600)
    }

    /*
     * LA CAISSE EN BLOCS DEMANDE UNE ADRESSE DE LIVRAISON, pas de facturation :
     * pour un invité elle nomme ses champs `shipping-*` et ne montre les
     * `billing-*` que si le client dit que l'adresse de facturation diffère.
     * Les deux jeux sont remplis ; celui qui n'existe pas est simplement ignoré.
     */
    await fill('#shipping-first_name', 'Camille')
    await fill('#shipping-last_name', 'Durand')
    await fill('#shipping-company', 'Atelier Durand')
    await fill('#shipping-address_1', '12 rue de la Fabrique')
    await fill('#shipping-postcode', '75011')
    await fill('#shipping-city', 'Paris')
    await fill('#shipping-phone', '0100000000')
    await fill('#billing-first_name', 'Camille')
    await fill('#billing-last_name', 'Durand')
    await fill('#billing-address_1', '12 rue de la Fabrique')
    await fill('#billing-postcode', '75011')
    await fill('#billing-city', 'Paris')
    await fill('#email', 'camille.durand@example.test')
    await fill('#billing-phone', '0100000000')
    await fill('#billing_first_name', 'Camille')
    await fill('#billing_last_name', 'Durand')
    await fill('#billing_company', 'Atelier Durand')
    await fill('#billing_address_1', '12 rue de la Fabrique')
    await fill('#billing_postcode', '75011')
    await fill('#billing_city', 'Paris')
    await fill('#billing_phone', '0100000000')
    await fill('#billing_email', 'camille.durand@example.test')
    const terms = page.locator('#terms')
    if ((await terms.count()) > 0) await terms.first().check().catch(() => undefined)
    /*
     * LA RENONCIATION AU DROIT DE RÉTRACTATION. Elle est obligatoire sur un
     * article personnalisé et la caisse refuse sans elle, ce qui est le
     * comportement voulu : ce harnais la coche comme un client la coche, il ne
     * la contourne pas.
     */
    for (const sel of [
      'input[name="teeshoop_renonciation"]',
      'input[name="teeshoop-core/renonciation"]',
      '#teeshoop-core-renonciation',
    ]) {
      const box = page.locator(sel)
      if ((await box.count()) > 0) {
        await box.first().check().catch(() => undefined)
        break
      }
    }
    const anyWaiver = page.locator('.wc-block-checkout__additional-fields input[type="checkbox"], .wc-block-components-checkbox__input')
    const n = await anyWaiver.count()
    for (let i = 0; i < n; i++) {
      await anyWaiver.nth(i).check().catch(() => undefined)
    }

    /*
     * LE BOUTON DE LA CAISSE EN BLOCS N'EST PAS `#place_order`, et un harnais
     * qui l'attendrait tomberait en panne de délai sans rien dire d'utile.
     * Les deux sont acceptés ; si aucun n'est là, l'échec le dit.
     */
    const placeClassic = page.locator('#place_order')
    const placeBlock = page.locator('.wc-block-components-checkout-place-order-button')
    if ((await placeClassic.count()) > 0) {
      await placeClassic.click()
    } else if ((await placeBlock.count()) > 0) {
      await placeBlock.click()
    } else {
      ok(`caisse : un bouton de validation existe (${width} px)`, false, 'ni #place_order ni le bouton du bloc')
    }
    await page.waitForLoadState('networkidle').catch(() => undefined)
    await page.waitForTimeout(3000)
  }

  const received = await page
    .locator('.woocommerce-order, .wp-block-woocommerce-order-confirmation-summary, .woocommerce-order-overview')
    .count()
  if (received > 0) {
    const num = await page
      .locator('.woocommerce-order-overview__order strong, .wc-block-order-confirmation-summary-list-item__value')
      .first()
      .textContent()
      .catch(() => '')
    if (num) orderNumber = num.trim()
    ok(`commande reçue : la page est rendue (${width} px)`, true, orderNumber)
    await shot('commande-recue')
    await noSideScroll('commande reçue')
  } else if (orderNumber) {
    // Second width: reopen the order that the first width placed.
    const view = json(
      wp(`<?php
$orders = wc_get_orders( array( 'limit' => 1, 'orderby' => 'date', 'order' => 'DESC', 'return' => 'objects' ) );
$out = array( 'url' => '' );
if ( $orders ) { $o = $orders[0]; $out['url'] = (string) $o->get_checkout_order_received_url(); }
echo "\\n<<<JSON>>>" . wp_json_encode( $out ) . "<<<FIN>>>\\n";
`),
      'la commande',
    )
    /*
     * `if (view.url)` SANS `else` N'ENREGISTRAIT AUCUNE ASSERTION quand la
     * recherche ne rendait pas d'adresse, et le harnais restait vert en ayant
     * sauté la page de commande reçue à cette largeur. Une branche muette dans
     * un contrôle est un contrôle qui ne peut pas échouer.
     */
    ok(`commande reçue : la commande de la première largeur est retrouvable (${width} px)`, Boolean(view.url), view.url ?? '')
    if (view.url) {
      await page.goto(view.url, { waitUntil: 'domcontentloaded' })
      ok(
        `commande reçue : la page est rendue (${width} px)`,
        (await page
          .locator('.woocommerce-order, .wp-block-woocommerce-order-confirmation-summary, .woocommerce-order-overview')
          .count()) > 0,
      )
      await shot('commande-recue')
      await noSideScroll('commande reçue')
    }
  } else {
    const why = await page.locator('.woocommerce-error').first().textContent().catch(() => '')
    ok(`commande reçue : la page est rendue (${width} px)`, false, (why ?? '').trim().slice(0, 220))
    await shot('caisse-refusee')
  }

  // -- mon compte -----------------------------------------------------------
  await page.goto(shop.compte, { waitUntil: 'domcontentloaded' })
  const account = await page.locator('.woocommerce-MyAccount-navigation, .woocommerce-form-login').count()
  ok(`mon compte : la page est rendue (${width} px)`, account > 0)
  await shot('mon-compte')
  await noSideScroll('mon compte')

  await context.close()
}

// -- un message transactionnel, rendu ---------------------------------------

const mail = json(
  wp(`<?php
use Teeshoop\\Core\\Notify;
$orders = wc_get_orders( array( 'limit' => 1, 'orderby' => 'date', 'order' => 'DESC', 'return' => 'objects' ) );
$out = array( 'html' => '' );
if ( $orders ) {
	$rendered = Notify::render( 'confirmation', (int) $orders[0]->get_id() );
	/*
	 * render() rend { ok, message } et c'est le message qui porte le HTML. Lire
	 * la clé html au premier niveau rendait une chaîne vide, et le harnais
	 * aurait photographié une page blanche en annonçant un courriel.
	 *
	 * (Pas d'accent grave dans ce commentaire : il vit dans un littéral de
	 * gabarit JavaScript, où un accent grave termine la chaîne.)
	 */
	$message = is_array( $rendered['message'] ?? null ) ? $rendered['message'] : array();
	$out['html'] = (string) ( $message['html'] ?? '' );
	$out['sujet'] = (string) ( $message['subject'] ?? '' );
	$out['refus'] = (string) ( $rendered['reason'] ?? '' );
}
echo "\\n<<<JSON>>>" . wp_json_encode( $out ) . "<<<FIN>>>\\n";
`),
  'le message transactionnel',
)

ok('un message transactionnel est rendu', (mail.html ?? '').length > 400, mail.sujet || mail.refus || '')
if (mail.html) {
  for (const width of WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'fr-FR' })
    const page = await context.newPage()
    await page.setContent(mail.html, { waitUntil: 'domcontentloaded' })
    await page.screenshot({ path: `${OUT}/message-confirmation-${width}.png`, fullPage: true })
    await context.close()
  }
  /*
   * LES HEXADÉCIMAUX SONT LITTÉRAUX, et c'est vérifié plutôt que promis : aucun
   * client de messagerie ne résout une propriété personnalisée, donc un
   * `var(--ts-accent)` qui se glisserait dans ce gabarit rendrait un courriel
   * sans marque et sans bouton, chez tout le monde, sans erreur nulle part.
   */
  ok('le courriel ne contient aucune propriété personnalisée CSS', !/var\(--/.test(mail.html))
  ok('le courriel porte le navy de la marque', mail.html.includes('#010050'))
}

await browser.close()

const failed = results.filter((r) => !r.pass)
console.log('')
if (results.length === 0) {
  console.error(`${RED}achat-shots: aucune assertion n'a été faite.${OFF}`)
  process.exit(2)
}
if (failed.length > 0) {
  console.error(`${RED}achat-shots: ${failed.length} assertion(s) sur ${results.length} ont échoué.${OFF}`)
  process.exit(1)
}
console.log(`${GREEN}achat-shots: ${results.length} assertions, captures dans ${OUT}/${OFF}`)
