#!/usr/bin/env node
/**
 * PIN GUARD: the target is still the version this repository was written against.
 *
 * WHY. `wp-local/docker-compose.yml` records that the mirror once followed the
 * `latest` tag and drifted a whole WordPress version « silently and in a
 * direction nobody chose ». Session 14 found out where the drift comes from, and
 * it is not the mirror:
 *
 *   auto_update_core_major = enabled     on the shop AND on the preproduction
 *
 * Production went from 7.0.4 to 7.1 on 20 August without anybody deciding to,
 * and the preproduction did the same thing DURING this session, at 14 h 38,
 * between two readings taken an hour apart. `wp-includes/version.php` carries
 * the timestamp.
 *
 * That is not an argument for turning auto-updates off: a shop that takes card
 * payments and stops receiving security patches is a worse shop. It is an
 * argument for a deploy that LOOKS, because rehearsing a change on a
 * preproduction running one WordPress and applying it to a shop running another
 * proves nothing, and neither installation tells you it has moved.
 *
 * WHAT IT COMPARES. `docs/versions-cibles.json` against what the target actually
 * answers. WordPress and WooCommerce exactly; PHP on major.minor only, because
 * o2switch moves 8.1.x patches on its own schedule and a patch is not the class
 * of change that breaks a plugin. The 8.1 in that file is what CI runs the whole
 * PHP suite against.
 *
 * Usage:
 *   node scripts/pin-verify.mjs --cible=prod
 *   node scripts/pin-verify.mjs --cible=preprod --hote=teeshoop
 *   node scripts/pin-verify.mjs --cible=miroir
 *   node scripts/pin-verify.mjs --cible=prod --relever   # print, compare nothing
 *   node scripts/pin-verify.mjs --self-test
 *
 * Exit: 0 the target is what the repository expects
 *       1 it has moved, and the message says in which direction
 *       2 the check could not run (unreadable pin, unreachable target), because
 *         « we could not look » is not « nothing has changed »
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PIN = join(ROOT, 'docs/versions-cibles.json')
const COMPOSE = join(ROOT, 'wp-local/docker-compose.yml')

const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const DIM = '\x1b[2m'
const OFF = '\x1b[0m'

const ARGS = process.argv.slice(2)
const SELF_TEST = ARGS.includes('--self-test')
const RELEVER = ARGS.includes('--relever')
const value = (name, fallback) => {
  const hit = ARGS.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const CIBLE = value('cible', '')
const HOTE = value('hote', 'teeshoop')

for (const a of ARGS) {
  if (a === '--self-test' || a === '--relever') continue
  if (/^--(cible|hote)=/.test(a)) continue
  console.error(`${RED}pin-verify: argument inconnu ${a}${OFF}`)
  process.exit(2)
}

function chargerPin() {
  let data
  try {
    data = JSON.parse(readFileSync(PIN, 'utf8'))
  } catch (e) {
    console.error(`${RED}pin-verify: ${PIN} est illisible : ${e.message}${OFF}`)
    process.exit(2)
  }
  if (!data.cibles || Object.keys(data.cibles).length === 0) {
    console.error(`${RED}pin-verify: ${PIN} ne décrit aucune cible. Un fichier vide ne prouve rien.${OFF}`)
    process.exit(2)
  }
  return data
}

/**
 * Read the three versions off a target.
 *
 * `prod` and `preprod` go through the deploy script's own `etat` verb, which is
 * the only thing the deploy key is allowed to run, so this check works with the
 * restricted key and not only with a developer's shell.
 */
function relever(cible) {
  if (cible === 'miroir') {
    /*
     * The mirror's WordPress is the image tag, read from the compose file rather
     * than from a running container: this has to answer even when docker is not
     * up, and the tag is the thing a commit changes.
     */
    let compose
    try {
      compose = readFileSync(COMPOSE, 'utf8')
    } catch (e) {
      return { ok: false, why: `${COMPOSE} est illisible : ${e.message}` }
    }
    const m = /image:\s*teeshoop\/wp-local:([0-9.]+)-php([0-9.]+)/.exec(compose)
    if (!m) return { ok: false, why: "l'étiquette d'image du miroir n'est pas lisible dans le compose." }
    let woo = ''
    try {
      woo = execFileSync(
        'docker',
        ['compose', '-f', COMPOSE, 'run', '--rm', '-T', 'wpcli', 'plugin', 'get', 'woocommerce', '--field=version'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      )
        .trim()
        .split('\n')
        .pop()
        .trim()
    } catch (e) {
      return { ok: false, why: `le miroir ne répond pas : ${String(e.message).split('\n')[0]}` }
    }
    return { ok: true, wordpress: m[1], php: m[2], woocommerce: woo }
  }

  let out
  try {
    out = execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', HOTE, `./deploiement.sh etat ${cible}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    const stderr = String(e.stderr ?? '')
      .split('\n')
      .filter((l) => l.trim() !== '' && !l.startsWith('**'))
      .slice(-2)
      .join(' · ')
    return { ok: false, why: `${cible} n'a pas répondu : ${String(e.message).split('\n')[0]}${stderr ? ` (${stderr})` : ''}` }
  }
  const champ = (nom) => {
    const m = new RegExp(`^${nom}\\s*:\\s*(.+)$`, 'm').exec(out)
    return m ? m[1].trim() : ''
  }
  return { ok: true, wordpress: champ('wordpress'), woocommerce: champ('woocommerce'), php: champ('php') }
}

/**
 * Compare, and say which way it moved.
 *
 * Pure, so the self-test can drive every branch without a server.
 */
export function comparer(attendu, reel) {
  const ecarts = []
  for (const clef of ['wordpress', 'woocommerce', 'php']) {
    const a = String(attendu[clef] ?? '')
    let r = String(reel[clef] ?? '')
    if (a === '') continue
    if (r === '') {
      ecarts.push({ clef, attendu: a, reel: '(illisible)' })
      continue
    }
    /*
     * PHP on major.minor. o2switch moves 8.1.x patches without telling anyone and
     * a patch is not the class of change that breaks an extension; the version is.
     * Being stricter here would make this check cry wolf, and a check that cries
     * wolf gets switched off, which is worse than not having it.
     */
    const aa = clef === 'php' ? a.split('.').slice(0, 2).join('.') : a
    const rr = clef === 'php' ? r.split('.').slice(0, 2).join('.') : r
    if (aa !== rr) ecarts.push({ clef, attendu: aa, reel: rr })
  }
  return ecarts
}

// ─────────────────────────────────────────────────────────────────────────────
// SELF-TEST. Same reason as every other guard here: a check nobody has seen fail
// is a check nobody knows works.
if (SELF_TEST) {
  const cas = [
    { nom: 'identique', a: { wordpress: '7.1', woocommerce: '11.0.1', php: '8.1' }, r: { wordpress: '7.1', woocommerce: '11.0.1', php: '8.1.34' }, ecarts: 0 },
    { nom: 'wordpress a bougé', a: { wordpress: '7.0.4', woocommerce: '11.0.1', php: '8.1' }, r: { wordpress: '7.1', woocommerce: '11.0.1', php: '8.1.34' }, ecarts: 1 },
    { nom: 'woocommerce a bougé', a: { wordpress: '7.1', woocommerce: '10.9.4', php: '8.1' }, r: { wordpress: '7.1', woocommerce: '11.0.1', php: '8.1.34' }, ecarts: 1 },
    { nom: 'php a changé de version', a: { wordpress: '7.1', woocommerce: '11.0.1', php: '8.1' }, r: { wordpress: '7.1', woocommerce: '11.0.1', php: '8.3.2' }, ecarts: 1 },
    { nom: 'php a seulement changé de correctif', a: { wordpress: '7.1', woocommerce: '11.0.1', php: '8.1' }, r: { wordpress: '7.1', woocommerce: '11.0.1', php: '8.1.99' }, ecarts: 0 },
    { nom: 'une version illisible est un écart', a: { wordpress: '7.1', woocommerce: '11.0.1', php: '8.1' }, r: { wordpress: '7.1', woocommerce: '', php: '8.1.34' }, ecarts: 1 },
    { nom: 'les trois ont bougé', a: { wordpress: '7.0.4', woocommerce: '10.9.4', php: '8.0' }, r: { wordpress: '7.1', woocommerce: '11.0.1', php: '8.1.34' }, ecarts: 3 },
  ]
  let bon = true
  for (const c of cas) {
    const n = comparer(c.a, c.r).length
    const ok = n === c.ecarts
    console.log(`  ${ok ? 'OK   ' : 'FAUX '} ${n} écart(s), attendu ${c.ecarts} : ${c.nom}`)
    if (!ok) bon = false
  }
  // Et le fichier livré doit être lisible et décrire des cibles.
  const pin = chargerPin()
  const cibles = Object.keys(pin.cibles)
  console.log(`  OK    ${PIN} décrit ${cibles.length} cible(s) : ${cibles.join(', ')}`)
  if (!bon) {
    console.error(`\n${RED}pin-verify --self-test: la comparaison ne se déclenche pas comme annoncé.${OFF}`)
    process.exit(2)
  }
  console.log(`\npin-verify --self-test: les ${cas.length} cas donnent le bon nombre d'écarts.`)
  process.exit(0)
}

const pin = chargerPin()
if (!CIBLE) {
  console.error(`${RED}pin-verify: --cible= manquant (${Object.keys(pin.cibles).join(', ')}).${OFF}`)
  process.exit(2)
}
const attendu = pin.cibles[CIBLE]
if (!attendu) {
  console.error(`${RED}pin-verify: cible inconnue « ${CIBLE} » (${Object.keys(pin.cibles).join(', ')}).${OFF}`)
  process.exit(2)
}

const reel = relever(CIBLE)
if (!reel.ok) {
  console.error(`${RED}pin-verify: ${reel.why}${OFF}`)
  console.error(`${DIM}« On n'a pas pu regarder » n'est pas « rien n'a bougé ». Sortie 2.${OFF}`)
  process.exit(2)
}

if (RELEVER) {
  console.log(JSON.stringify({ cible: CIBLE, wordpress: reel.wordpress, woocommerce: reel.woocommerce, php: reel.php }, null, 2))
  process.exit(0)
}

const ecarts = comparer(attendu, reel)
if (ecarts.length === 0) {
  console.log(
    `${GREEN}pin-verify: ${CIBLE} est bien en WordPress ${reel.wordpress}, WooCommerce ${reel.woocommerce}, PHP ${reel.php}.${OFF}`,
  )
  process.exit(0)
}

console.error(`${RED}pin-verify: ${CIBLE} n'est plus ce que le dépôt suppose, ${ecarts.length} écart(s).${OFF}\n`)
for (const e of ecarts) {
  console.error(`  ${e.clef} : le dépôt attend ${e.attendu}, ${CIBLE} répond ${e.reel}`)
}
console.error(
  `\n${DIM}Les mises à jour majeures automatiques sont activées sur les deux installations, donc ceci arrive tout seul.\n` +
    `Ce qu'il faut faire : rejouer la vérification sur la préproduction, puis corriger docs/versions-cibles.json et\n` +
    `wp-local/docker-compose.yml dans un commit qui dit pourquoi. Pas contourner ce contrôle.${OFF}`,
)
process.exit(1)
