#!/usr/bin/env node
/**
 * LA ZONE D'IMPRESSION, MESURÉE SUR LA PHOTOGRAPHIE DU FOURNISSEUR.
 *
 * ── POURQUOI C'EST UNE OPÉRATION DE CATALOGUE ET PAS D'ÉDITEUR ───────────────
 *
 * Le studio ne sait dessiner que deux vêtements : `src/garments/index.ts`
 * déclare `Record<'tee' | 'hoodie', GarmentArt>` et rien d'autre, contre un
 * catalogue de plusieurs centaines de références. Chaque polo, softshell,
 * casquette et tote du magasin est donc soit impersonnalisable, soit refusé au
 * dernier clic.
 *
 * Le chemin qui les ouvre n'est pas de dessiner trois cents vêtements : c'est
 * de MESURER chacun sur la photographie que le fournisseur publie déjà et que
 * `Importer::images()` copie déjà dans la médiathèque. Une référence mesurée
 * porte son propre rectangle imprimable, en centimètres, calé sur son propre
 * vêtement, plus le facteur d'échelle entre les pixels de sa photo et les
 * centimètres réels.
 *
 * ── CE QUI EST RÉUTILISÉ, ET POURQUOI RIEN N'EST RÉÉCRIT ─────────────────────
 *
 * Tout existait, dispersé dans le chemin « le client envoie son propre
 * vêtement » :
 *
 *   `src/lib/ingest/pipeline.ts`   détoure la photo (le fond devient de l'alpha)
 *   `src/lib/custom.ts`            trouve la boîte englobante du vêtement
 *   `src/lib/garmentAnatomy.ts`    trouve l'axe, le col, les épaules, le torse,
 *                                  l'ourlet, sur le MASQUE ALPHA et jamais sur
 *                                  la couleur
 *   `src/app/PrintAreaPlacer.tsx`  `presetsFor()` pose le rectangle « torse
 *                                  moins la couture, du col à l'ourlet »
 *
 * Ce fichier ne recalcule aucune de ces quatre choses : il fait tourner le vrai
 * code du studio dans un vrai navigateur, sur les vraies photos de la boutique.
 * Une deuxième implémentation de « le plus grand marquage raisonnable » serait
 * exactement le défaut que `CLAUDE.md` interdit : le jour où les deux dérivent,
 * la boutique publie un rectangle et l'éditeur en laisse dessiner un autre.
 *
 * ── L'ÉCHELLE VIENT DE LA FICHE DE MESURES, ET ELLE NE DIT QUE ÇA ────────────
 *
 * Le fournisseur publie pour chaque style une fiche de mesures PDF
 * (`sizespec_download_link`, stockée par l'import dans `_teeshoop_sizespec`).
 * On y lit la ligne `A HALF CHEST`, la demi-poitrine à plat, taille par taille.
 * À la taille de tarification, c'est la largeur réelle du vêtement sur la
 * photo : la boîte englobante fait cette largeur-là, donc
 * `pixels par centimètre = largeur de la boîte / demi-poitrine`.
 *
 * LA CHARTE DE TAILLES DONNE LE GRADIENT, ET RIEN D'AUTRE. Le rapport des
 * demi-poitrines entre deux tailles est ce que `src/lib/printScale.ts` appelle
 * `k` : la façon dont le visuel grandit d'une taille à l'autre.
 * **Elle ne dit pas où le rectangle se pose sur un polo.** Cela, seule la photo
 * le dit, et c'est toute la raison d'être de ce fichier. Que personne ne s'y
 * trompe plus tard : une charte de tailles n'a jamais placé un marquage.
 *
 * ── CE QUI REFUSE, REFUSE ────────────────────────────────────────────────────
 *
 * Une référence dont l'anatomie n'est pas trouvée n'obtient PAS une zone
 * approximative. `presetsFor()` sait le dire (`measured: false`) et le placeur
 * s'en sert pour dégrader ses repères, ce qui est juste quand un humain regarde
 * la photo. Ce n'est pas juste quand personne ne regarde : la référence est
 * comptée, nommée dans le rapport, et reste non personnalisable jusqu'à ce
 * qu'un humain la place à la main. `CLAUDE.md` section 3 : un visuel qui ne
 * peut pas être mesuré est refusé, pas posé à sa taille par défaut.
 *
 * Quatre motifs de refus, tous distincts et tous nommés : pas de fiche de
 * mesures, la fiche ne se lit pas, la photo n'a pas de silhouette (le détourage
 * a échoué, `anatomy.opaque`), le col n'est pas trouvé.
 *
 * ── COMMENT IL TOURNE ────────────────────────────────────────────────────────
 *
 *   npm run zones:mesurer              # la gamme de lancement
 *   npm run zones:mesurer -- --tout    # toute référence importée qui a une fiche
 *   npm run zones:mesurer -- --simuler # mesure et n'écrit rien
 *
 * Il lui faut : le miroir docker debout, et le Worker local sur le port 8788
 * pour aller chercher les fiches de mesures (`npx wrangler dev --port 8788`).
 * Une fiche déjà lue est stockée sur le produit et n'est pas redemandée, donc
 * le Worker n'est nécessaire qu'au premier passage sur une référence.
 *
 * Sortie : 0 tout mesuré · 1 au moins un refus · 2 le contrôle n'a rien pu
 * mesurer du tout (aucune référence, pas de navigateur, miroir absent).
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const ROOT = new URL('..', import.meta.url).pathname
const PORT = 5199
const BASE = `http://localhost:${PORT}`
const WORKER = process.env.TEESHOOP_WORKER ?? 'http://127.0.0.1:8788'
const ALL = process.argv.includes('--tout')
/*
 * `--anatomie` prints what the detector actually saw on each photo: the axis
 * and its confidence, the collar line, the shoulders, the hem and the torso
 * edges. A refusal that says only « le col n'a pas été trouvé » cannot be acted
 * on; these numbers say whether the silhouette was found at all and where the
 * detector stopped believing it.
 */
const DEBUG = process.argv.includes('--anatomie')
const DRY = process.argv.includes('--simuler')

const RED = '[31m'
const GREEN = '[32m'
const DIM = '[2m'
const OFF = '[0m'

const die = (code, why) => {
  console.error(`${RED}zones-mesurer: ${why}${OFF}`)
  process.exit(code)
}

// ---------------------------------------------------------------------------
// 1. Ce que la boutique sait déjà
// ---------------------------------------------------------------------------

/** Run a PHP snippet through the mirror's wp-cli and return its stdout. */
function wp(php) {
  const dir = mkdtempSync(join(tmpdir(), 'teeshoop-zones-'))
  const file = join(dir, 'run.php')
  try {
    writeFileSync(file, php)
    return execFileSync(
      'docker',
      ['compose', '-f', 'wp-local/docker-compose.yml', 'run', '--rm', '-T', 'wpcli', 'eval-file', '-'],
      { cwd: ROOT, input: readFileSync(file), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** The references to measure, with everything the measurement needs. */
function readCandidates() {
  const out = wp(`<?php
use Teeshoop\\Core\\Gamme;
use Teeshoop\\Core\\Garments;
use Teeshoop\\Core\\Product;

$rows = array();
${ALL
    ? `$ids = get_posts( array( 'post_type' => 'product', 'post_status' => 'any', 'posts_per_page' => -1, 'fields' => 'ids', 'meta_key' => '_teeshoop_sizespec' ) );`
    : `$ids = array();
foreach ( array_keys( Gamme::RANGE ) as $ref ) {
	$found = get_posts( array( 'post_type' => 'product', 'post_status' => 'any', 'posts_per_page' => 1, 'fields' => 'ids', 'meta_key' => '_teeshoop_ref', 'meta_value' => (string) $ref ) );
	if ( $found ) { $ids[] = (int) $found[0]; }
}`}
foreach ( $ids as $id ) {
	$id = (int) $id;
	$product = wc_get_product( $id );
	if ( ! $product instanceof WC_Product ) { continue; }
	$front = (int) $product->get_image_id();
	$gallery = array_map( 'intval', $product->get_gallery_image_ids() );
	$back = $gallery ? (int) $gallery[0] : 0;
	$rows[] = array(
		'id'      => $id,
		'ref'     => (string) get_post_meta( $id, '_teeshoop_ref', true ),
		'nom'     => $product->get_name(),
		'spec'    => (string) get_post_meta( $id, '_teeshoop_sizespec', true ),
		'chest'   => (string) get_post_meta( $id, '_teeshoop_demi_poitrine', true ),
		'front'   => $front > 0 ? (string) wp_get_attachment_url( $front ) : '',
		'back'    => $back > 0 ? (string) wp_get_attachment_url( $back ) : '',
		'taille'  => Garments::priced_size( 'tee' ),
	);
}
echo "\\n<<<JSON>>>" . wp_json_encode( $rows ) . "<<<FIN>>>\\n";
`)
  const m = /<<<JSON>>>([\s\S]*?)<<<FIN>>>/.exec(out)
  if (!m) die(2, `le miroir n'a pas répondu de liste lisible.\n${out.slice(-800)}`)
  return JSON.parse(m[1])
}

// ---------------------------------------------------------------------------
// 2. La fiche de mesures du fabricant
// ---------------------------------------------------------------------------

/**
 * The maker's own half-chest series, taken out of the size-spec PDF.
 *
 * ── TROIS FABRICANTS, TROIS DOCUMENTS, ET C'EST IRRÉDUCTIBLE ────────────────
 *
 * Relevé le 4 septembre 2026 sur les neuf fiches de la gamme :
 *
 *   B&C     une ligne « A HALF CHEST », des valeurs qui ENJAMBENT deux lignes
 *           quand la mise en page l'exige (le TU 01T porte « 47 50 » puis
 *           « 53 56 59 62 65 70 75 » sur la ligne suivante), et une ligne de
 *           tailles parfois polluée par le texte voisin (« B&C KingLCrew XL »).
 *   Gildan  un bloc « SPECIFICATIONS / Centimeters », une ligne « Chest (A) »,
 *           et DEUX colonnes de tolérance avant les tailles. Le même tableau
 *           existe une deuxième fois en pouces, juste en dessous.
 *   Fruit   un tableau « Sizes | Width | Length », une taille par ligne.
 *   of the
 *   Loom
 *
 * Ce ne sont pas trois implémentations d'une règle, ce sont trois lecteurs de
 * trois documents. Ce qui est commun est extrait : l'assignation d'un nombre à
 * une taille se fait par POSITION DE COLONNE, ce que `pdftotext -layout`
 * conserve, et c'est ce qui survit à l'enjambement de B&C et jette les colonnes
 * de tolérance de Gildan sans avoir à les connaître.
 *
 * ── LE GARDE-FOU D'UNITÉ ────────────────────────────────────────────────────
 *
 * La demi-poitrine à la taille de tarification doit tomber dans une fourchette
 * plausible en centimètres. C'est ce qui empêche de lire le tableau en POUCES
 * que Gildan publie sous le tableau en centimètres : 22 pouces passeraient pour
 * 22 cm, et chaque marquage de ce vêtement serait mis à l'échelle sur une
 * largeur deux fois et demie trop petite. Une fiche hors fourchette est refusée,
 * pas corrigée : on ne devine pas une unité sur un chiffre qui atteint une
 * imprimante.
 */
const CHEST_MIN_CM = 25
const CHEST_MAX_CM = 95
const SIZE_TOKEN = /\b(XXS|XS|S|M|L|XL|XXL|2XL|3XL|4XL|5XL|6XL)\b/g
const canonical = (s) => s.toUpperCase().replace('XXL', '2XL').replace('XXS', 'XXS')

/** Every number on a line, with the character offset of its centre. */
function numbersWithOffset(line) {
  const out = []
  const re = /(?<![\w.,])(\d{1,3}(?:[.,]\d{1,3})?)(?![\w])/g
  let m
  while ((m = re.exec(line)) !== null) {
    out.push({ value: parseFloat(m[1].replace(',', '.')), at: m.index + m[0].length / 2 })
  }
  return out
}

/** Size headings on a line, with the character offset of each. */
function sizesWithOffset(line) {
  const out = []
  SIZE_TOKEN.lastIndex = 0
  let m
  while ((m = SIZE_TOKEN.exec(line)) !== null) {
    out.push({ size: canonical(m[1]), at: m.index + m[0].length / 2 })
  }
  return out
}

/**
 * Columnar layouts (B&C, Gildan): a heading row of sizes, a measurement row
 * whose numbers line up under them, possibly wrapped onto following lines.
 */
function parseColumnar(lines, rowRe) {
  const rowIdx = lines.findIndex((l) => rowRe.test(l))
  if (rowIdx < 0) return null

  // The headings are the nearest line above naming at least three sizes.
  let head = null
  for (let i = rowIdx - 1; i >= 0 && i >= rowIdx - 8; i--) {
    const found = sizesWithOffset(lines[i])
    if (found.length >= 3) {
      head = found
      break
    }
  }
  if (!head) return null

  /*
   * Duplicated headings are dropped, keeping the FIRST. « B&C KingLCrew XL »
   * puts an L inside a neighbouring style name, and a second XL under no
   * column at all; taking the first occurrence of each size keeps the real
   * table's columns and loses the intruder, which then finds no number near it.
   */
  const seen = new Set()
  head = head.filter((h) => (seen.has(h.size) ? false : (seen.add(h.size), true)))

  /*
   * Numbers from the measurement row and the four lines under it. B&C wraps a
   * long row; a line that contributes nothing simply contributes nothing.
   */
  const nums = []
  for (let i = rowIdx; i < Math.min(lines.length, rowIdx + 5); i++) {
    if (i > rowIdx && rowRe.test(lines[i])) break
    nums.push(...numbersWithOffset(lines[i]))
  }

  const map = {}
  const gap = head.length > 1 ? Math.abs(head[1].at - head[0].at) : 6
  for (const h of head) {
    let best = null
    for (const n of nums) {
      const d = Math.abs(n.at - h.at)
      if (d <= gap * 0.75 && (best === null || d < best.d)) best = { d, value: n.value }
    }
    if (best) map[h.size] = best.value
  }
  return Object.keys(map).length >= 3 ? map : null
}

/** Row-wise layouts (Fruit of the Loom): one size per line, width then length. */
function parseRowwise(lines) {
  const headIdx = lines.findIndex((l) => /\bSizes\b/i.test(l) && /\bWidth\b/i.test(l))
  if (headIdx < 0) return null
  const map = {}
  for (let i = headIdx + 1; i < Math.min(lines.length, headIdx + 20); i++) {
    const m = /(?:^|\s)(XXS|XS|S|M|L|XL|XXL|2XL|3XL|4XL|5XL|6XL)\s+(\d{1,3}(?:[.,]\d)?)\s+(\d{1,3}(?:[.,]\d)?)\s*$/.exec(
      lines[i],
    )
    if (m) map[canonical(m[1])] = parseFloat(m[2].replace(',', '.'))
  }
  return Object.keys(map).length >= 3 ? map : null
}

function halfChestFromPdf(bytes) {
  const dir = mkdtempSync(join(tmpdir(), 'teeshoop-spec-'))
  const pdf = join(dir, 'spec.pdf')
  try {
    writeFileSync(pdf, bytes)
    const text = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'latin1' })
    const lines = text.split('\n')

    const tries = [
      ['B&C', () => parseColumnar(lines, /\bHALF\s*CHEST\b/i)],
      ['Gildan', () => parseColumnar(lines, /^\s*Chest\s*\(A\)/i)],
      ['Fruit of the Loom', () => parseRowwise(lines)],
    ]
    for (const [maker, run] of tries) {
      const map = run()
      if (!map) continue
      const values = Object.values(map)
      const min = Math.min(...values)
      const max = Math.max(...values)
      if (min < CHEST_MIN_CM || max > CHEST_MAX_CM) {
        return {
          ok: false,
          why: `le tableau ${maker} donne des demi-poitrines de ${min} à ${max}, hors de toute plage plausible en centimètres : unité douteuse, refusé plutôt que converti`,
        }
      }
      return { ok: true, map, maker }
    }
    return { ok: false, why: 'aucun des trois tableaux connus (B&C, Gildan, Fruit of the Loom) ne se lit dans cette fiche' }
  } catch (e) {
    return { ok: false, why: `pdftotext a refusé la fiche (${String(e).slice(0, 120)})` }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function fetchSpec(path) {
  const url = path.startsWith('http') ? path : WORKER.replace(/\/$/, '') + path
  let res
  try {
    res = await fetch(url, { redirect: 'follow' })
  } catch (e) {
    return { ok: false, why: `le Worker local n'a pas répondu (${WORKER}). Lancez « npx wrangler dev --port 8788 ».` }
  }
  if (!res.ok) return { ok: false, why: `la fiche de mesures répond ${res.status}` }
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.subarray(0, 4).toString('latin1') !== '%PDF') {
    return { ok: false, why: "la fiche de mesures n'est pas un PDF" }
  }
  return halfChestFromPdf(bytes)
}

// ---------------------------------------------------------------------------
// 3. Le navigateur, et le vrai code du studio
// ---------------------------------------------------------------------------

async function boot() {
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('vite n’a pas démarré en 60 s')), 60_000)
    vite.stdout.on('data', (d) => {
      if (String(d).includes('ready in') || String(d).includes(`:${PORT}`)) {
        clearTimeout(timer)
        resolve()
      }
    })
    vite.on('exit', (c) => reject(new Error(`vite s’est arrêté (code ${c})`)))
  })
  await ready
  return vite
}

const candidates = readCandidates()
if (candidates.length === 0) {
  die(2, 'aucune référence à mesurer. « Rien trouvé » et « rien regardé » sont deux résultats différents.')
}
console.log(`${DIM}${candidates.length} référence(s) à mesurer${ALL ? ' (tout le catalogue)' : ' (gamme de lancement)'}${OFF}`)

// The half chest first: without it the pixels have no scale and there is
// nothing to measure. A reference already carrying one is not re-fetched, so
// the Worker is only needed the first time.
for (const c of candidates) {
  if (c.chest) {
    try {
      c.chestMap = JSON.parse(c.chest)
      continue
    } catch {
      /* a stored map that no longer parses is re-read below. */
    }
  }
  if (!c.spec) {
    c.specRefus = 'le fournisseur ne publie aucune fiche de mesures pour cette référence'
    continue
  }
  const got = await fetchSpec(c.spec)
  if (!got.ok) {
    c.specRefus = got.why
    continue
  }
  c.chestMap = got.map
}

const measurable = candidates.filter((c) => c.chestMap && (c.front || c.back))
if (measurable.length === 0) {
  console.log('')
  for (const c of candidates) {
    console.log(`  ${RED}refus${OFF} ${c.ref} ${c.nom.slice(0, 44)} : ${c.specRefus ?? 'aucune photographie'}`)
  }
  die(2, 'aucune référence n’a de fiche de mesures lisible ET une photographie.')
}

const vite = await boot()
const browser = await chromium.launch()
let results = []
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('console', (m) => {
    if (m.type() === 'error') console.error(`${DIM}[page] ${m.text()}${OFF}`)
  })
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })

  for (const c of measurable) {
    const photos = {}
    for (const side of ['front', 'back']) {
      if (!c[side]) continue
      try {
        const res = await fetch(c[side])
        if (!res.ok) continue
        photos[side] = Buffer.from(await res.arrayBuffer()).toString('base64')
      } catch {
        /* an unreachable photo is a refusal below, not a crash here. */
      }
    }

    const out = await page.evaluate(async ({ photos, chestMap, size, debug }) => {
      const pipeline = await import('/src/lib/ingest/pipeline.ts')
      const custom = await import('/src/lib/custom.ts')
      const anatomyMod = await import('/src/lib/garmentAnatomy.ts')
      const placer = await import('/src/app/PrintAreaPlacer.tsx')
      const units = await import('/src/lib/units.ts')

      const halfChestCm = chestMap[size] ?? null
      const res = { sides: {}, halfChestCm }
      if (!halfChestCm) {
        res.fatal = `la fiche de mesures ne donne pas la taille de tarification (${size})`
        return res
      }

      for (const [side, b64] of Object.entries(photos)) {
        try {
          const bin = atob(b64)
          const bytes = new Uint8Array(bin.length)
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
          const photo = await pipeline.normalizeGarmentPhoto(new Blob([bytes], { type: 'image/jpeg' }), {
            name: `zone ${side}`,
          })
          const setup = {
            assetId: photo.assetId,
            useCutout: photo.hasCutout,
            printArea: { xIn: 0, yIn: 0, wIn: 1, hIn: 1 },
          }
          /*
           * L'ÉCHELLE SE PREND SUR LE TORSE, PAS SUR LA BOÎTE ENGLOBANTE.
           *
           * `getCustomSideInfo(setup, widthIn)` pose que la boîte fait
           * `widthIn` de large, ce qui est vrai quand un CLIENT mesure son
           * propre vêtement et photographie ce qu'il a mesuré. Ce n'est pas
           * vrai d'une photo de catalogue : un t-shirt posé à plat manches
           * écartées a une boîte large comme l'envergure des manches, pas comme
           * la poitrine. Mesuré sur le Fruit of the Loom Valueweight, la seule
           * vraie photo à plat de la gamme : torse 28,7 cm pour une boîte de
           * 53,5, soit une échelle fausse de 86 % si on lit la boîte.
           *
           * La demi-poitrine du fabricant est définie comme « la largeur du
           * vêtement à 1 cm sous les emmanchures » (Fruit of the Loom, sur sa
           * propre fiche). C'est le TORSE. Alors on mesure d'abord en espace
           * unitaire, on lit la largeur du torse, et l'échelle réelle en découle.
           */
          const unit = await anatomyMod.getGarmentAnatomy(setup, 1)
          const torsoUnit = unit.torsoRightXIn - unit.torsoLeftXIn
          if (!(torsoUnit > 0)) {
            res.sides[side] = { ok: false, why: 'le torse ne se mesure pas sur cette silhouette : aucune échelle n’en découle' }
            continue
          }
          const widthIn = units.cmToIn(halfChestCm) / torsoUnit
          const info = await custom.getCustomSideInfo(setup, widthIn)
          const anatomy = await anatomyMod.getGarmentAnatomy(setup, widthIn)
          const heightIn = info.bbox.h / info.pxPerInch

          if (debug) {
            res.debug = res.debug ?? {}
            res.debug[side] = {
              aspect: Math.round((info.bbox.w / info.bbox.h) * 100) / 100,
              cutout: photo.hasCutout,
              opaque: anatomy.opaque,
              collar: anatomy.collarYIn === null ? null : Math.round(units.inToCm(anatomy.collarYIn) * 10) / 10,
              collarW: anatomy.collarWIn === null ? null : Math.round(units.inToCm(anatomy.collarWIn) * 10) / 10,
              axis: Math.round(units.inToCm(anatomy.axisXIn) * 10) / 10,
              axisConf: Math.round(anatomy.axisConfidence * 100) / 100,
              shoulder: Math.round(units.inToCm(anatomy.shoulderYIn) * 10) / 10,
              hem: Math.round(units.inToCm(anatomy.hemYIn) * 10) / 10,
              torso: [Math.round(units.inToCm(anatomy.torsoLeftXIn) * 10) / 10, Math.round(units.inToCm(anatomy.torsoRightXIn) * 10) / 10],
              heightCm: Math.round(units.inToCm(heightIn) * 10) / 10,
            }
          }
          if (anatomy.opaque) {
            res.sides[side] = { ok: false, why: 'la photographie n’a pas de silhouette : le détourage n’a rien trouvé' }
            continue
          }

          /*
           * EST-CE UN VÊTEMENT À PLAT, OU QUELQU'UN QUI LE PORTE ?
           *
           * Le fournisseur publie les deux, et `garmentAnatomy` est écrit pour
           * le premier : « tout ce qu'on possède est une photo à plat plus un
           * seul nombre réel, la largeur à plat ». Sur un mannequin vivant, le
           * masque alpha est une PERSONNE (tête, bras, jambes, pantalon), et
           * les repères qu'on en tire ne sont les repères de rien.
           *
           * Ce n'est pas théorique : le B&C ID.333 est photographié à DEUX
           * mannequins, le détecteur y a trouvé une encolure entre les deux
           * personnes, et sans ce contrôle un rectangle de 47,5 x 48,6 cm
           * serait parti sur la fiche produit. Un chiffre fabriqué qui atteint
           * une imprimante.
           *
           * CE QUI EST MESURÉ, ET RIEN DE PLUS : la part de la silhouette
           * qu'occupe le torse. Un vêtement à manches ÉCARTÉES la met vers la
           * moitié, parce que les manches élargissent la boîte sans élargir le
           * torse ; c'est le seul cas où la demi-poitrine du fabricant se
           * raccroche à ce qu'on voit. Relevé le 4 septembre 2026 sur les
           * dix-huit photographies de la gamme : 0,54 sur la seule vraie photo à
           * plat manches écartées, et 0,85 à 0,99 sur toutes les autres, qu'il
           * s'agisse d'un mannequin vivant ou d'un sweat à plat manches
           * rabattues le long du corps. Le contrôle ne prétend pas distinguer
           * ces deux-là : il dit que l'échelle ne se raccroche pas, ce qui est
           * vrai dans les deux cas.
           *
           * LA PORTE NE VAUT QUE POUR UN VÊTEMENT À MANCHES. Un tote bag ou un
           * débardeur posé à plat a légitimement un torse aussi large que sa
           * boîte. La gamme de lancement n'est que des t-shirts et des sweats ;
           * le jour où elle s'ouvre, la porte doit s'ouvrir avec elle.
           */
          const torsoFrac = torsoUnit
          if (torsoFrac > 0.75) {
            res.sides[side] = {
              ok: false,
              why:
                `le torse occupe ${Math.round(torsoFrac * 100)} % de la silhouette : la boîte englobante n'est pas celle ` +
                `d'un vêtement à manches écartées, donc la demi-poitrine ne s'y raccroche pas (mannequin porté, ou manches rabattues le long du corps)`,
              torsoFrac: Math.round(torsoFrac * 100) / 100,
            }
            continue
          }
          const presets = placer.presetsFor(side, anatomy, widthIn, heightIn, units.cmToIn(3))
          const full = presets.find((p) => p.id === 'full')
          if (!full) {
            res.sides[side] = { ok: false, why: 'aucun rectangle plein n’a été proposé pour cette face' }
            continue
          }
          if (!full.measured) {
            res.sides[side] = { ok: false, why: 'la ligne de col n’a pas été trouvée : le rectangle serait une proportion, pas une mesure' }
            continue
          }
          res.sides[side] = {
            ok: true,
            x_cm: Math.round(units.inToCm(full.rect.xIn) * 10) / 10,
            y_cm: Math.round(units.inToCm(full.rect.yIn) * 10) / 10,
            w_cm: Math.round(units.inToCm(full.rect.wIn) * 10) / 10,
            h_cm: Math.round(units.inToCm(full.rect.hIn) * 10) / 10,
            photo_w: info.bbox.w,
            photo_h: info.bbox.h,
            photo_x: info.bbox.x,
            photo_y: info.bbox.y,
            px_par_cm: Math.round((info.pxPerInch / 2.54) * 1000) / 1000,
            col_cm: anatomy.collarYIn === null ? null : Math.round(units.inToCm(anatomy.collarYIn) * 10) / 10,
            axe_cm: Math.round(units.inToCm(anatomy.axisXIn) * 10) / 10,
            axe_confiance: Math.round(anatomy.axisConfidence * 100) / 100,
            ourlet_cm: Math.round(units.inToCm(anatomy.hemYIn) * 10) / 10,
            torsoFrac: Math.round(torsoFrac * 100) / 100,
          }
        } catch (e) {
          res.sides[side] = { ok: false, why: `la mesure a échoué : ${String(e).slice(0, 140)}` }
        }
      }
      return res
    }, { photos, chestMap: c.chestMap, size: c.taille, debug: DEBUG })

    results.push({ ...c, ...out })
    const f = out.sides?.front
    const b = out.sides?.back
    const mark = (s) => (s?.ok ? `${s.w_cm} x ${s.h_cm} cm` : `${RED}refus${OFF}`)
    console.log(
      `  ${c.ref.padEnd(6)} ${String(c.nom).slice(0, 40).padEnd(40)} ` +
        `demi-poitrine ${out.halfChestCm ?? '?'} cm   face ${mark(f).padEnd(24)} dos ${mark(b)}`,
    )
    if (DEBUG && out.debug) {
      for (const [side, d] of Object.entries(out.debug)) {
        console.log(`         ${DIM}${side.padEnd(5)} ${JSON.stringify(d)}${OFF}`)
      }
    }
  }
} finally {
  await browser.close()
  vite.kill('SIGTERM')
}

// ---------------------------------------------------------------------------
// 4. Écrire, et dire ce qui a refusé
// ---------------------------------------------------------------------------

const refusals = []
for (const c of candidates) {
  if (c.specRefus) {
    refusals.push({ ref: c.ref, nom: c.nom, why: c.specRefus })
    continue
  }
  const r = results.find((x) => x.id === c.id)
  if (!r) {
    refusals.push({ ref: c.ref, nom: c.nom, why: 'ni photographie de face ni photographie de dos' })
    continue
  }
  if (r.fatal) {
    refusals.push({ ref: c.ref, nom: c.nom, why: r.fatal })
    continue
  }
  for (const side of ['front', 'back']) {
    const s = r.sides?.[side]
    if (!s) {
      refusals.push({ ref: c.ref, nom: c.nom, why: `aucune photographie de ${side === 'front' ? 'face' : 'dos'}` })
    } else if (!s.ok) {
      refusals.push({ ref: c.ref, nom: c.nom, why: `${side === 'front' ? 'face' : 'dos'} : ${s.why}` })
    }
  }
}

/*
 * CE QUI EST ÉCRIT, ET CE QUI NE L'EST PAS.
 *
 * La fiche de mesures est écrite dès qu'elle a été LUE, même quand aucune face
 * ne se mesure : c'est une donnée du fabricant, elle porte le gradient de
 * `printScale`, et la relire coûte un appel au Worker à chaque exécution.
 *
 * La zone d'impression n'est écrite que pour les faces MESURÉES. Une référence
 * dont tout a refusé repart avec sa demi-poitrine, ses refus nommés sur le
 * produit, et aucune zone : c'est exactement l'état voulu, et c'est ce qui la
 * garde non personnalisable.
 */
const writable = results.filter((r) => r.chestMap)

if (!DRY && writable.length > 0) {
  const payload = writable.map((r) => ({
    id: r.id,
    chest: r.chestMap,
    zones: Object.fromEntries(
      Object.entries(r.sides)
        .filter(([, s]) => s.ok)
        .map(([side, s]) => [side, s]),
    ),
    refus: Object.fromEntries(
      Object.entries(r.sides)
        .filter(([, s]) => !s.ok)
        .map(([side, s]) => [side, s.why]),
    ),
  }))
  const out = wp(`<?php
$rows = json_decode( <<<'JSON'
${JSON.stringify(payload)}
JSON
, true );
$n = 0;
foreach ( $rows as $row ) {
	$id = (int) $row['id'];
	update_post_meta( $id, '_teeshoop_demi_poitrine', wp_json_encode( $row['chest'] ) );
	update_post_meta( $id, '_teeshoop_zone_impression', wp_json_encode( $row['zones'] ) );
	if ( array() === $row['refus'] || empty( $row['refus'] ) ) {
		delete_post_meta( $id, '_teeshoop_zone_refus' );
	} else {
		update_post_meta( $id, '_teeshoop_zone_refus', wp_json_encode( $row['refus'] ) );
	}
	++$n;
}
WP_CLI::log( "ECRIT:$n" );
`)
  const m = /ECRIT:(\d+)/.exec(out)
  console.log(`\n${DIM}${m ? m[1] : 0} référence(s) écrite(s) sur le produit.${OFF}`)
} else if (DRY) {
  console.log(`\n${DIM}--simuler : rien n'a été écrit.${OFF}`)
}

console.log('')
if (refusals.length > 0) {
  console.log(`${RED}${refusals.length} refus, nommés :${OFF}`)
  for (const r of refusals) {
    console.log(`  ${r.ref.padEnd(6)} ${String(r.nom).slice(0, 44).padEnd(44)} ${r.why}`)
  }
  console.log('')
  console.log(
    `${DIM}Une référence refusée reste non personnalisable jusqu'à ce qu'un humain la place\n` +
      `dans l'écran d'administration. Une zone approximative serait pire que pas de zone.${OFF}`,
  )
  process.exit(1)
}

console.log(
  `${GREEN}zones-mesurer: ${writable.length} référence(s) mesurée(s) sur leur propre photographie, aucun refus.${OFF}`,
)
