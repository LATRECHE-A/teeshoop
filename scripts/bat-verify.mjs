#!/usr/bin/env node
/**
 * ONE ORDER, FROM THE MONEY LANDING TO THE PARCEL LEAVING, through a real
 * browser and a real WooCommerce.
 *
 *   npm run wp:up
 *   npm run verify:bat
 *
 * WHY A BROWSER AND NOT ANOTHER PHP SUITE. `tests/integration-lifecycle.php`
 * already drives the rules against a real cart and a real order table, and it
 * is the right place for them. What it cannot touch is the thing the customer
 * actually meets: a page served from `admin-post.php`, with no theme, no
 * script, two forms and a token in the URL. Whether that page renders, whether
 * its buttons post where they say they do, whether the approval a browser sends
 * is the one the database records, and whether the whole thing is usable at
 * 375 px are four questions only a browser answers. `verify:product` exists in
 * this repository for exactly that argument, after a defect no PHP test could
 * ever have seen.
 *
 * WHAT IT DOES NOT COVER, said out loud: Brevo. This container has no API key,
 * so every message goes to `wp_mail`, and it has no MTA either, so `wp_mail`
 * fails. The Brevo request itself, its header, its body and its refusals are
 * asserted in `tests/integration-lifecycle.php` against the real
 * `wp_remote_post`, with only the wire replaced.
 *
 * WHICH MAKES THE MAIL ASSERTIONS HERE BETTER, NOT WORSE. What this run proves
 * is that a message which does NOT reach the customer is visible: the right row
 * exists for the right event, it was attempted rather than left queued, and the
 * failure carries a reason an operator can act on. A silently dropped proof is
 * an order that stalls for ever with nobody knowing, and that is the failure
 * this outbox exists to make impossible. A green "sent" would have proved less.
 *
 * Exit: 0 clean, 1 an assertion failed, 2 the run proved nothing (nothing was
 * asserted, or the mirror is not up).
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SHOTS = join(ROOT, 'docs/screens/bat')
const SUPPORT = 'wp-content/plugins/teeshoop-core/tests/bat-support.php'
const SITE = 'http://localhost:8080'

let checks = 0
let failed = 0

function ok(name, pass, extra = '') {
  checks += 1
  if (!pass) failed += 1
  console.log(`  ${pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}${extra ? `  ${extra}` : ''}`)
  return pass
}

/**
 * The outbox row for one event: it exists, it was attempted, and a failure says
 * why. See the header for why "attempted" and not "sent".
 */
function mailWent(state, kind, label) {
  const row = state.mail.find((m) => m.kind === kind)
  if (!ok(label, !!row, row ? `${row.status}` : 'aucune ligne')) return
  ok(`${label}, et le sort du message est enregistré`, row.status !== 'queued', row.status)
  if (row.status === 'failed') {
    ok(`${label}, et l’échec est lisible plutôt que silencieux`, row.error.length > 10, row.error)
  }
}

function bail(why) {
  console.error(`\nbat-verify: ${why}`)
  process.exit(2)
}

/**
 * Ask WordPress something, and read the LAST line that parses as JSON.
 *
 * The last line and not the first: `wp_mail` falls back to sendmail in this
 * container and prints "can't connect to remote host" on stdout before our own
 * output. That noise is not a failure, it is the development transport being
 * honest about having no MTA, and the outbox records it.
 */
function support(...args) {
  let out
  try {
    out = execFileSync(
      'docker',
      ['compose', '-f', join(ROOT, 'wp-local/docker-compose.yml'), 'run', '--rm', '-T', 'wpcli', 'eval-file', SUPPORT, ...args],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
  } catch (e) {
    bail(`wp-cli failed on "${args.join(' ')}":\n${e.stdout ?? ''}${e.stderr ?? ''}`)
  }
  for (const line of out.trim().split('\n').reverse()) {
    try {
      return JSON.parse(line)
    } catch {
      /* keep looking backwards */
    }
  }
  bail(`no JSON from "${args.join(' ')}":\n${out}`)
}

const { chromium } = await import('playwright').catch(() => bail('playwright is not installed'))

mkdirSync(SHOTS, { recursive: true })
console.log('\nUne commande, du paiement à la livraison\n')

// ── the order ──────────────────────────────────────────────────────────────

const order = support('commande')
if (!ok('une commande payée, avec une ligne personnalisée', order.ok === true, order.error ?? '')) {
  bail('nothing below this can be tested')
}
ok('elle porte la renonciation au droit de rétractation', !!order.renonciation?.at, order.renonciation?.ip ?? '')
ok('la facture porte la mention et sa date', /L221-28/.test(order.facture ?? ''))

const before = support('etat', String(order.order_id))
ok('rien ne peut partir en production sans BAT', before.bloquants.production.length > 0, before.bloquants.production[0] ?? '')

// ── the proof ──────────────────────────────────────────────────────────────

const issued = support('bat', String(order.order_id), 'Le logo est recadré au plus près de l’encre.')
if (!ok('le BAT est établi et envoyé', issued.ok === true, issued.error ?? '')) bail('no proof to open')
ok('la commande passe à « BAT envoyé »', issued.status === 'ts-bat', issued.status)
ok('sans clé Brevo, le transport est wp_mail et le dit', issued.transport === 'wp_mail', issued.transport)
ok(
  'un envoi qui échoue est rendu à son appelant, jamais avalé',
  issued.sent === true || issued.why.length > 10,
  issued.why || 'parti',
)

// ── the page the customer opens ────────────────────────────────────────────

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 375, height: 900 } })

const response = await page.goto(issued.url, { waitUntil: 'domcontentloaded' })
ok('le lien répond 200', response?.status() === 200, String(response?.status()))
ok('la page interdit l’indexation', (response?.headers()['x-robots-tag'] ?? '').includes('noindex'))

const body = await page.textContent('body')
ok('le numéro de commande est dessus', body.includes(order.number))
ok('la couleur du vêtement est dessus', body.includes('Marine'), 'navy')
ok('les tailles commandées sont dessus', body.includes('M') && body.includes('L'))
ok('la surface imprimée est dessus', body.includes('288'))
ok('la zone d’impression est dessus', body.includes('30,5') && body.includes('40,6'))
ok('la descente sous l’encolure est dessus', body.includes('22,4'))
ok('le décalage à l’axe est dit dans un sens', body.includes('vers la gauche'), '-1,5 cm')
ok('la taille de mesure est dite', body.includes('Dimensions données pour la taille'))
ok('la tolérance de position est dessus', body.includes('la position du marquage peut varier'))
ok(
  'et elle dit à quelle taille elle s’applique',
  body.includes('Sur la taille indiquée'),
  'sans ces mots, la tolérance est une promesse absolue que le gradage ne tient sur aucune taille sauf une',
)
ok('la remarque de l’atelier est dessus', body.includes('recadré au plus près'))
ok('rien n’est imprimé avant validation, et c’est écrit', body.includes('Rien n’est imprimé'))

/*
 * NO HORIZONTAL SCROLL AT 375 px. The bar this project sets is mobile first,
 * checked at 375 px before anything else, and a proof a customer has to pan
 * sideways to read is a proof they approve without reading.
 */
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
ok('rien ne déborde à 375 px', overflow <= 0, `${overflow} px`)

const focusable = await page.evaluate(() => {
  const el = document.querySelector('button.primary')
  if (!el) return false
  el.focus()
  return document.activeElement === el
})
ok('le bouton de validation prend le focus au clavier', focusable)

await page.screenshot({ path: join(SHOTS, 'bat-375.png'), fullPage: true })

await page.setViewportSize({ width: 1200, height: 900 })
await page.screenshot({ path: join(SHOTS, 'bat-1200.png'), fullPage: true })

// ── asking for changes, then approving ─────────────────────────────────────

await page.setViewportSize({ width: 375, height: 900 })
await page.fill('#ts-bat-comment', 'Le logo est trop bas de 3 cm sur le devant.')
await Promise.all([page.waitForLoadState('load'), page.click('button.secondary')])

const asked = support('etat', String(order.order_id))
ok('la demande de modification est enregistrée', asked.status === 'ts-bat-mod', asked.status)
ok('les mots du client ne sont pas perdus', (asked.modifs[0]?.comment ?? '').includes('trop bas de 3 cm'))
ok('le cycle de correction est compté', asked.corrections.used === 1, `${asked.corrections.used}/${asked.corrections.included}`)
ok('la production reste fermée', asked.bloquants.production.length > 0)
mailWent(asked, 'bat-modifs', 'le client reçoit un accusé de sa demande')
mailWent(asked, 'atelier', 'l’atelier est prévenu')

const second = support('bat', String(order.order_id), 'Visuel remonté de 3 cm.')
ok('une deuxième version est établie', second.version === 2, String(second.version))

await page.goto(second.url, { waitUntil: 'domcontentloaded' })
await Promise.all([page.waitForLoadState('load'), page.click('button.primary')])

const approved = support('etat', String(order.order_id))
ok('la validation est enregistrée contre la bonne version', approved.version === 2 && !!approved.validation, String(approved.version))
ok('elle porte une date et une adresse', !!approved.validation?.at && !!approved.validation?.ip, approved.validation?.ip ?? '')
ok('elle porte le texte qui était à l’écran', (approved.validation?.text ?? '').includes('la production démarre immédiatement'))
ok('la commande passe à « BAT validé »', approved.status === 'ts-bat-ok', approved.status)
ok('la production est ouverte', approved.bloquants.production.length === 0, approved.bloquants.production[0] ?? '')
mailWent(approved, 'bat-recu', 'le client reçoit son accusé de validation')

const done = await page.textContent('body')
ok('la page dit que c’est fait, pas « succès »', done.includes('Bon à tirer validé') && done.includes('Nous lançons la production'))
await page.screenshot({ path: join(SHOTS, 'bat-valide-375.png'), fullPage: true })

// The old link is dead the moment a newer version exists.
await page.goto(issued.url, { waitUntil: 'domcontentloaded' })
const superseded = await page.textContent('body')
ok('l’ancien lien ne valide plus rien', !superseded.includes('Valider le bon à tirer'))

// ── the workshop, and the parcel ───────────────────────────────────────────

const production = support('avancer', String(order.order_id), 'ts-prod')
ok('la commande entre en production', production.ok === true, production.reason)

const shipTooEarly = support('avancer', String(order.order_id), 'ts-expedie')
ok('elle ne saute pas l’impression', shipTooEarly.ok === false, shipTooEarly.reason)

support('avancer', String(order.order_id), 'ts-imprime')
support('suivi', String(order.order_id), '6A12345678901')
const shipped = support('avancer', String(order.order_id), 'ts-expedie')
ok('elle part', shipped.ok === true, shipped.reason)

const after = support('etat', String(order.order_id))
mailWent(after, 'expedition', 'le client reçoit l’avis d’expédition')
ok('chaque passage est journalisé', after.journal.length >= 6, `${after.journal.length} passages`)

const delivered = support('avancer', String(order.order_id), 'completed')
ok('elle est livrée', delivered.ok === true && delivered.status === 'completed', delivered.reason)

// ── the messages, in something that renders HTML ───────────────────────────

for (const kind of ['bat', 'bat-recu', 'expedition']) {
  const message = support('message', String(order.order_id), kind)
  if (!ok(`le message « ${kind} » se rend`, message.ok === true, message.error)) continue
  ok(`« ${kind} » a une partie texte`, (message.text ?? '').length > 60)
  await renderMail(page, kind, message)
}

/*
 * AND RENDERING ONE CHANGED NOTHING. `Notify::render` touches no order and
 * mints no token; `Notify::rebuild` does both, because a retry needs a live
 * link. The first version of this harness called the second by mistake and
 * killed the link it was about to click, which is why the two exist.
 */
const untouched = support('etat', String(order.order_id))
ok('lire un message ne réécrit rien', untouched.version === approved.version && untouched.status === 'completed', untouched.status)

/** Put one message in a browser, check it fits a phone, and photograph it. */
async function renderMail(page, kind, message) {
  await page.setContent(message.html, { waitUntil: 'load' })
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  ok(`« ${kind} » tient dans 375 px`, wide <= 0, `${wide} px`)
  await page.screenshot({ path: join(SHOTS, `mail-${kind}-375.png`), fullPage: true })
  writeFileSync(join(SHOTS, `mail-${kind}.html`), message.html)
}

await browser.close()
support('menage')

// ── the verdict ────────────────────────────────────────────────────────────

if (checks === 0) {
  // "Nothing found" and "nothing looked" are different results.
  console.error('\nbat-verify: asserted nothing at all. The run proves nothing.')
  process.exit(2)
}
if (failed > 0) {
  console.error(`\nbat-verify: ${failed} of ${checks} checks failed.`)
  process.exit(1)
}
console.log(`\nbat-verify: ${checks} checks, one order from payment to delivery. Clean.`)
console.log(`  screenshots in ${dirname(join(SHOTS, 'x'))}`)
