#!/usr/bin/env node
/**
 * VITRINE: la boutique montre-t-elle des vêtements, ou des rectangles gris.
 *
 *   npm run wp:up   puis   npm run verify:vitrine
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE CONTRÔLE EXISTE
 *
 * Le 2 septembre 2026, le développeur a ouvert la préproduction et l'a refusée.
 * Ce n'était pas un désaccord de goût, c'était un comptage :
 *
 *                          production   préproduction
 *   <img> sur l'accueil            51               0
 *   <img> sur la boutique          36               0
 *   tuiles « Sans photo »           0        6, puis 5
 *
 * Aucun test du dépôt ne pouvait voir ça. Les tests PHP passaient, le harnais
 * WooCommerce passait, l'accessibilité passait : une page peut être correcte,
 * accessible, rapide, et ne contenir aucune image. Ce fichier compte les images.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QU'IL AFFIRME
 *
 *   EN SQL, parce qu'une page rend 24 produits sur 500 et qu'un trou se cache
 *   très bien à la page 12 :
 *     - au moins 400 produits publiés ;
 *     - ZÉRO produit du catalogue fournisseur sans photographie. Un produit qui
 *       porte `_teeshoop_ref` vient de chez Falk & Ross, qui livre 39 adresses
 *       de photos par style : s'il n'en a aucune, l'import s'est arrêté au
 *       milieu et personne ne l'a vu.
 *
 *   EN HTML, sur les pages réellement rendues :
 *     - l'accueil contient au moins une image ;
 *     - l'archive en contient PLUS que son nombre de fiches, ce qui est la
 *       façon de dire « chaque fiche a la sienne, et le bandeau a son logo »
 *       sans avoir à les apparier ;
 *     - `ts-nomedia` n'apparaît nulle part ;
 *     - le logo est là ;
 *     - `og:image` est déclarée ET le fichier répond 200. Une carte de partage
 *       qui pointe vers un 404 est pire qu'une absence de carte : les clients
 *       la mettent en cache.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QU'IL NE FAIT PAS
 *
 * Il ne refuse PAS la tuile « Sans photo » elle-même. `placeholder_media()` est
 * juste : un produit ajouté à la main, sans photographie, mérite une tuile
 * honnête plutôt qu'un dessin de montagne. Ce qui est refusé, c'est un produit
 * ISSU DU FOURNISSEUR sans image, qui est une anomalie d'import, et c'est la
 * tuile VISIBLE sur une page, qui veut dire que l'anomalie est arrivée jusqu'au
 * client.
 *
 * UN CONTRÔLE QUI N'A RIEN REGARDÉ SORT EN 2. Une base injoignable, une page qui
 * rend zéro octet, une requête SQL qui ne rend aucune ligne : ce sont des
 * résultats différents de « tout va bien », et le miroir a passé une journée
 * entière à rendre 200 avec zéro octet sans que rien ne le dise.
 *
 * Usage :
 *   node scripts/vitrine-verify.mjs
 *   node scripts/vitrine-verify.mjs --base=http://localhost:8080
 *   node scripts/vitrine-verify.mjs --self-test
 *
 * Sortie : 0 la vitrine tient · 1 elle ne tient pas · 2 le contrôle n'a pas
 *          pu regarder
 */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const COMPOSE = join(ROOT, 'wp-local/docker-compose.yml')

const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const DIM = '\x1b[2m'
const OFF = '\x1b[0m'

const ARGS = process.argv.slice(2)
const arg = (name, fallback) => {
  const hit = ARGS.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const BASE = arg('base', 'http://localhost:8080').replace(/\/$/, '')

/** Au moins ce nombre de produits publiés, sinon le catalogue n'a pas tourné. */
const PRODUITS_MINIMUM = 400

/* ── les mesures ──────────────────────────────────────────────────────────── */

/**
 * Une requête SQL sur le miroir.
 *
 * `mariadb` et non `mysql` : MariaDB 11 a renommé ses clients et l'ancien nom
 * n'est plus dans l'image.
 */
function sql(query) {
  const out = execFileSync(
    'docker',
    ['compose', '-f', COMPOSE, 'exec', '-T', 'db', 'mariadb', '-uroot', '-proot', 'teeshoop', '-N', '-e', query],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 },
  )
  return out
    .split('\n')
    .filter((l) => l.trim() !== '' && !/warning/i.test(l))
    .map((l) => l.split('\t'))
}

const nombre = (query) => {
  const rows = sql(query)
  if (rows.length === 0) throw new Error(`la requête n’a rendu aucune ligne : ${query.slice(0, 60)}…`)
  return Number(rows[0][rows[0].length - 1])
}

/** Une page, avec son code et ses octets, sans suivre de redirection. */
async function page(chemin) {
  const url = `${BASE}${chemin}`
  const reponse = await fetch(url, { redirect: 'manual' })
  const corps = await reponse.text()
  return { url, code: reponse.status, corps, octets: Buffer.byteLength(corps) }
}

const compte = (texte, motif) => (texte.match(motif) ?? []).length

/* ── le contrôle ──────────────────────────────────────────────────────────── */

async function run(mesures) {
  const problemes = []
  let regardes = 0
  const dire = []

  const exiger = (ok, quoi, vu) => {
    regardes++
    dire.push({ ok, quoi, vu })
    if (!ok) problemes.push(`${quoi} (vu : ${vu})`)
  }

  /* ---- ce que dit la base ---- */

  const publies = mesures.publies
  exiger(publies >= PRODUITS_MINIMUM, `au moins ${PRODUITS_MINIMUM} produits publiés`, `${publies}`)

  const orphelins = mesures.orphelins
  exiger(
    orphelins.length === 0,
    'aucun produit du catalogue fournisseur sans photographie',
    orphelins.length === 0 ? '0' : `${orphelins.length} : ${orphelins.slice(0, 5).join(', ')}${orphelins.length > 5 ? '…' : ''}`,
  )

  /* ---- ce que rendent les pages ---- */

  for (const [nom, p] of Object.entries(mesures.pages)) {
    // Une page qui rend 200 avec zéro octet est le défaut qui a coûté une
    // journée : le thème fatalise en silence et Apache journalise un succès.
    if (p.code !== 200 || p.octets < 1000) {
      return {
        code: 2,
        problemes: [`${nom} (${p.url}) a répondu ${p.code} avec ${p.octets} octet(s) : le contrôle n’a pas de page à lire`],
        regardes,
        dire,
      }
    }
  }

  const accueil = mesures.pages.accueil
  const archive = mesures.pages.archive

  exiger(compte(accueil.corps, /<img\b/g) > 0, 'l’accueil contient au moins une image', `${compte(accueil.corps, /<img\b/g)}`)

  const fiches = compte(archive.corps, /<li class="product\b/g)
  const images = compte(archive.corps, /<img\b/g)
  exiger(fiches > 0, 'l’archive contient au moins une fiche', `${fiches}`)
  exiger(images > fiches, 'l’archive contient plus d’images que de fiches', `${images} images pour ${fiches} fiches`)

  for (const [nom, p] of Object.entries(mesures.pages)) {
    const n = compte(p.corps, /ts-nomedia/g)
    exiger(n === 0, `aucune tuile « Sans photo » sur ${nom}`, `${n}`)
  }

  const logo = /custom-logo|class="ts-logo"/.test(accueil.corps)
  exiger(logo, 'le logo est dans le bandeau', logo ? 'présent' : 'absent, le mot-écrit sert de repli')

  /* ---- la carte de partage ---- */

  const og = accueil.corps.match(/property="og:image" content="([^"]+)"/)
  exiger(!!og, 'l’accueil déclare une og:image', og ? og[1].replace(BASE, '') : 'aucune')
  if (og) {
    exiger(mesures.ogCode === 200, 'le fichier de l’og:image répond 200', `HTTP ${mesures.ogCode}`)
  }

  if (regardes === 0) {
    return { code: 2, problemes: ['aucune vérification n’a été faite, ce qui ne prouve rien'], regardes, dire }
  }
  return { code: problemes.length ? 1 : 0, problemes, regardes, dire }
}

/* ── les vraies mesures ───────────────────────────────────────────────────── */

async function mesurer() {
  const publies = nombre(
    "SELECT COUNT(*) FROM wp_posts WHERE post_type='product' AND post_status='publish'",
  )

  /*
   * `_teeshoop_ref` est ce que l'importateur pose sur une fiche venue du
   * fournisseur, et rien d'autre n'en porte : les neuf produits d'essai du
   * dépôt portent `_teeshoop_garment`. C'est ce méta qui sépare « ajouté à la
   * main, une tuile honnête suffit » de « importé, une photo est due ».
   */
  const orphelins = sql(`
    SELECT p.ID, p.post_title FROM wp_posts p
    WHERE p.post_type='product' AND p.post_status='publish'
      AND EXISTS (SELECT 1 FROM wp_postmeta r WHERE r.post_id=p.ID AND r.meta_key='_teeshoop_ref' AND r.meta_value<>'')
      AND NOT EXISTS (SELECT 1 FROM wp_postmeta m WHERE m.post_id=p.ID AND m.meta_key='_thumbnail_id' AND m.meta_value NOT IN ('','0'))
    LIMIT 50`).map((r) => `${r[0]} ${r[1] ?? ''}`.trim())

  const pages = {
    accueil: await page('/'),
    archive: await page('/?post_type=product'),
  }

  let ogCode = 0
  const og = pages.accueil.corps.match(/property="og:image" content="([^"]+)"/)
  if (og) {
    try {
      ogCode = (await fetch(og[1], { method: 'GET', redirect: 'manual' })).status
    } catch {
      ogCode = 0
    }
  }

  return { publies, orphelins, pages, ogCode }
}

/* ── auto-test ────────────────────────────────────────────────────────────── */

async function selfTest(base) {
  let bad = 0
  const attendre = async (nom, mesures, voulu) => {
    const r = await run(mesures)
    const ok = r.code === voulu
    console.log(`  ${ok ? GREEN + '✓' : RED + '✗'}${OFF} ${nom} ${DIM}(sortie ${r.code}, attendu ${voulu})${OFF}`)
    if (!ok) { bad++; r.problemes.forEach((x) => console.log(`      ${DIM}${x}${OFF}`)) }
  }
  const copie = (patch) => ({ ...base, ...patch })
  const pageAvec = (nom, remplacer) => ({
    ...base.pages,
    [nom]: { ...base.pages[nom], corps: remplacer(base.pages[nom].corps) },
  })

  console.log('Auto-test de la vitrine :')
  await attendre('tel quel, la boutique passe', base, 0)
  await attendre('trop peu de produits est refusé', copie({ publies: 12 }), 1)
  await attendre('un produit fournisseur sans photo est refusé', copie({ orphelins: ['4242 Un tee sans photo'] }), 1)
  await attendre(
    'un accueil sans aucune image est refusé',
    copie({ pages: pageAvec('accueil', (c) => c.replace(/<img\b/g, '<span data-was-img')) }),
    1,
  )
  await attendre(
    'une tuile « Sans photo » rendue est refusée',
    copie({ pages: pageAvec('archive', (c) => c.replace('</body>', '<span class="ts-nomedia">Sans photo</span></body>')) }),
    1,
  )
  await attendre(
    'une archive avec moins d’images que de fiches est refusée',
    copie({ pages: pageAvec('archive', (c) => c.replace(/<img\b/g, '<span data-was-img')) }),
    1,
  )
  await attendre('une og:image qui répond 404 est refusée', copie({ ogCode: 404 }), 1)
  await attendre(
    'une page qui rend 200 avec zéro octet rend 2, pas 1',
    copie({ pages: { ...base.pages, accueil: { ...base.pages.accueil, corps: '', octets: 0 } } }),
    2,
  )
  await attendre(
    'une page qui répond 500 rend 2',
    copie({ pages: { ...base.pages, archive: { ...base.pages.archive, code: 500 } } }),
    2,
  )

  console.log(bad === 0 ? `${GREEN}Auto-test : les neuf refus savent se déclencher.${OFF}` : `${RED}Auto-test : ${bad} échec(s).${OFF}`)
  return bad === 0 ? 0 : 1
}

/* ── main ─────────────────────────────────────────────────────────────────── */

let mesures
try {
  mesures = await mesurer()
} catch (e) {
  console.error(`${RED}vitrine-verify : le contrôle n’a pas pu regarder : ${e.message}${OFF}`)
  console.error(`${DIM}Le miroir tourne-t-il ? npm run wp:up${OFF}`)
  process.exit(2)
}

if (ARGS.includes('--self-test')) {
  process.exit(await selfTest(mesures))
}

const r = await run(mesures)
for (const d of r.dire) {
  console.log(`  ${d.ok ? GREEN + '✓' : RED + '✗'}${OFF} ${d.quoi} ${DIM}(${d.vu})${OFF}`)
}
console.log('')

if (r.code === 2) {
  console.error(`${RED}vitrine-verify : le contrôle n’a pas pu regarder.${OFF}\n`)
  for (const x of r.problemes) console.error('  ' + x)
  process.exit(2)
}
if (r.code === 1) {
  console.error(`${RED}vitrine-verify : la vitrine ne tient pas.${OFF}\n`)
  for (const x of r.problemes) console.error('  ' + x)
  process.exit(1)
}
console.log(`vitrine-verify : ${r.regardes} affirmations sur ${BASE}. Clean.`)
