#!/usr/bin/env node
/**
 * Le SAV client, soumis pour de vrai dans un navigateur, sur le miroir.
 *   npm run wp:up
 *   npm run verify:sav
 *
 * POURQUOI CE HARNAIS EXISTE. Le formulaire « Un problème avec cette commande ? »
 * poste sur admin-post.php, que WordPress compte comme une requête
 * d'administration : WooCommerce n'y charge pas `wc_add_notice()`. La suite
 * d'intégration appelle les fonctions depuis WP-CLI, où elle existe, et était
 * verte pendant que CHAQUE envoi réel finissait en erreur fatale (mesuré le
 * 28 septembre 2026). Seule une vraie soumission voit ce contexte.
 *
 * Crée un client et une commande livrée, se connecte, envoie une demande, en
 * renvoie une seconde (refusée par la pause), puis efface tout ce qu'il a créé.
 * Sort 1 sur un échec, 2 si rien n'a pu être vérifié.
 */
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'

const COMPOSE = ['compose', '-f', 'wp-local/docker-compose.yml']
const BASE = process.env.WP_URL ?? 'http://localhost:8080'

let echecs = 0
let verifies = 0
function ok(nom, cond, detail = '') {
  verifies++
  if (!cond) echecs++
  process.stdout.write(`${cond ? 'PASS' : 'FAIL'} ${nom}${detail ? `  (${detail})` : ''}\n`)
  return cond
}

/** `wp eval` dans le conteneur ; rend la dernière ligne JSON imprimée. */
function wp(php) {
  const out = execFileSync('docker', [...COMPOSE, 'run', '--rm', '-T', 'wpcli', 'eval', php], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  for (const ligne of out.trim().split('\n').reverse()) {
    try {
      return JSON.parse(ligne.trim())
    } catch {
      /* compose et wp-cli bavardent */
    }
  }
  throw new Error(`wp eval n'a rien rendu de lisible :\n${out}`)
}

const mdp = `Sav-${Date.now()}-verif`
let donnees = null
try {
  donnees = wp(`
    $cree = 0;
    $p = wc_get_products( array( 'status' => 'publish', 'limit' => 1, 'return' => 'ids' ) );
    if ( empty( $p ) ) {
      $x = new WC_Product_Simple();
      $x->set_name( 'ZZ Vêtement de vérification SAV' );
      $x->set_status( 'publish' );
      $x->set_regular_price( '10.00' );
      $cree = (int) $x->save();
      $p = array( $cree );
    }
    $u = wp_insert_user( array( 'user_login' => 'zzsavverif' . time(), 'user_pass' => '${mdp}', 'user_email' => 'zzsavverif' . time() . '@example.test', 'role' => 'customer' ) );
    $o = wc_create_order();
    $o->add_product( wc_get_product( (int) $p[0] ), 3 );
    $o->set_customer_id( (int) $u );
    $o->set_billing_email( 'zzsavverif@example.test' );
    $o->calculate_totals();
    $o->set_status( 'completed' );
    $o->save();
    echo wp_json_encode( array( 'user' => (int) $u, 'login' => get_userdata( (int) $u )->user_login, 'order' => $o->get_id(), 'produit' => $cree, 'vue' => $o->get_view_order_url(), 'compte' => wc_get_page_permalink( 'myaccount' ) ) );
  `)
} catch (e) {
  process.stdout.write(`sav-verify : le miroir ne répond pas (npm run wp:up ?) : ${String(e.message).split('\n')[0]}\n`)
  process.exit(2)
}
if (donnees.erreur) {
  process.stdout.write(`sav-verify : ${donnees.erreur}\n`)
  process.exit(2)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'fr-FR' })
const erreurs = []
page.on('pageerror', (e) => erreurs.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') erreurs.push(`console: ${m.text()}`)
})
const serveur = []
page.on('response', (r) => {
  if (r.status() >= 500) serveur.push(`${r.status()} ${r.url()}`)
})

const envoyer = async (description) => {
  await page.goto(donnees.vue)
  await page.locator('#ts-sav-motif').selectOption('colis')
  await page.locator('#ts-sav-description').fill(description)
  await Promise.all([page.waitForLoadState('load'), page.getByRole('button', { name: 'Envoyer ma demande' }).click()])
  await page.waitForTimeout(500)
}

try {
  await page.goto(donnees.compte)
  const refus = page.getByRole('button', { name: 'Tout refuser' })
  if (await refus.count()) await refus.first().click()
  await page.locator('#username').fill(donnees.login)
  await page.locator('#password').fill(mdp)
  await Promise.all([page.waitForLoadState('load'), page.locator('button[name="login"]').click()])

  await page.goto(donnees.vue)
  ok('le client voit le bloc SAV sur sa commande', (await page.locator('#teeshoop-sav').count()) === 1)

  await envoyer('Le colis est arrivé ouvert et deux pièces manquent.')
  ok('l’envoi ne finit pas en erreur serveur', serveur.length === 0, serveur.join(' | '))
  const succes = page.locator('.ts-sav__retour--ok')
  ok('le client lit que sa demande est partie', (await succes.count()) === 1 && /envoyée à l’atelier/.test(await succes.innerText()), (await succes.count()) ? await succes.innerText() : await page.title())
  ok('et la voit « En cours » sur sa commande', /En cours/.test(await page.locator('#teeshoop-sav').innerText()))
  ok('le message ne reste pas après un rechargement', (await page.reload(), (await page.locator('.ts-sav__retour').count()) === 0))

  await envoyer('Un second envoi, juste après le premier.')
  const pause = page.locator('.ts-sav__retour--erreur')
  ok('un second envoi immédiat est refusé, avec la raison', serveur.length === 0 && (await pause.count()) === 1 && /vient de partir/.test(await pause.innerText()), (await pause.count()) ? await pause.innerText() : serveur.join(' | '))
  ok('et ce qui a été tapé est gardé', (await page.locator('#ts-sav-description').inputValue()).includes('second envoi'))
} catch (e) {
  ok('le parcours va au bout', false, String(e?.message ?? e).split('\n')[0])
} finally {
  ok('aucune erreur dans la console ni dans la page', erreurs.length === 0, erreurs.slice(0, 3).join(' | '))
  await browser.close()
  try {
    const net = wp(`
      require_once ABSPATH . 'wp-admin/includes/user.php';
      $o = wc_get_order( ${donnees.order} ); if ( $o ) { $o->delete( true ); }
      global $wpdb; $wpdb->query( $wpdb->prepare( 'DELETE FROM ' . \\Teeshoop\\Core\\Mail::table() . ' WHERE order_id = %d', ${donnees.order} ) );
      wp_delete_user( ${donnees.user} );
      if ( ${donnees.produit} > 0 ) { wp_delete_post( ${donnees.produit}, true ); }
      echo wp_json_encode( array( 'ok' => true ) );
    `)
    ok('les données de vérification sont effacées', net.ok === true)
  } catch (e) {
    ok('les données de vérification sont effacées', false, String(e.message).split('\n')[0])
  }
}

process.stdout.write(`\nsav-verify : ${verifies - echecs}/${verifies} assertions passées.\n`)
process.exit(verifies === 0 ? 2 : echecs > 0 ? 1 : 0)
