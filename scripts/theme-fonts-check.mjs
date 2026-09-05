#!/usr/bin/env node
/**
 * THEME FONTS CHECK: the type the shop asks for is the type the shop ships.
 *
 * WHY THIS FILE EXISTS AT ALL. `wp-themes/teeshoop/assets/fonts.css` has named
 * this script as its guard since the day it was written, in prose, at the
 * bottom of its own header: « scripts/theme-fonts-check.mjs fails when the
 * copies and the package have drifted apart ». The script did not exist. A
 * comment that promises a check nobody wrote is worse than no comment: it is
 * the reason the next person does not write one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FAILURE IT IS REALLY LOOKING FOR
 *
 * A browser asked for a weight the page does not ship does not fall back to the
 * nearest real one. It SYNTHESISES: it smears or slants the outline it has and
 * draws a counterfeit. Nothing errors, nothing logs, and the difference on a
 * product title is visible to anyone who has seen the real face.
 *
 * Measured in this repository on 03/09/2026, the day the associate's type was
 * put in: forty rules asked for weight 600 and one asked for 500, against a
 * body face (Lato) that ships 400 and 700 and has no 600 at all upstream. Every
 * one of those forty was a heading, a label, a control or a navigation item,
 * which is Urbanist's job and not Lato's, and none of them said so.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CONVENTION IT ENFORCES, and why the check is sound rather than hopeful
 *
 * Resolving which family a rule ends up in needs the whole cascade, which no
 * static reader has. So the rule is turned around:
 *
 *   A BLOCK THAT ASKS FOR ANY WEIGHT OTHER THAN THE BODY WEIGHT MUST NAME ITS
 *   FAMILY IN THE SAME BLOCK.
 *
 * With that, the family of every weighted rule is decidable by reading one
 * block, and this script decides it. A block that names no family is the body
 * face, which is what `body { font-family: var(--ts-font) }` sets.
 *
 * THE FAMILIES ARE READ OUT OF tokens.css, not written here: `--ts-font` and
 * `--ts-font-display`. Changing the type in the one home is then enough, and
 * this script follows rather than having to be edited in the same commit.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT ELSE IT REFUSES
 *
 *   - a woff2 named in fonts.css that is not on disk;
 *   - a woff2 on disk that differs by one byte from the @fontsource package it
 *     was copied from, which is the drift the old comment promised to catch;
 *   - a shipped face no rule ever asks for, because that is bytes on every page
 *     of a shop on shared hosting for nothing;
 *   - any address at fonts.googleapis.com or fonts.gstatic.com anywhere in the
 *     theme or the plugin. teeshoop.com does this today on every page and it
 *     sends each visitor's IP to a third country; the CNIL has already fined a
 *     French site for it. Self-hosting is not a preference here, it is the
 *     reason the files are in the repository;
 *   - a licence missing beside the fonts. Redistributing a face without its OFL
 *     notice is a contrefaçon, and these files are served to every visitor.
 *
 * A CHECK THAT SCANNED NOTHING EXITS 2. « Nothing found » and « nothing looked »
 * are different results, and node_modules absent is the second one.
 *
 * Usage:
 *   node scripts/theme-fonts-check.mjs
 *   node scripts/theme-fonts-check.mjs --self-test
 *
 * Sortie : 0 rien à redire
 *          1 une divergence, et le message dit laquelle
 *          2 le contrôle n'a pas pu regarder (paquet absent, fichier illisible)
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const p = (...bits) => join(ROOT, ...bits)
const read = (rel) => readFileSync(p(rel), 'utf8')

const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const DIM = '\x1b[2m'
const OFF = '\x1b[0m'

const THEME = 'wp-themes/teeshoop'
const FONTS_CSS = `${THEME}/assets/fonts.css`
const FONTS_DIR = `${THEME}/assets/fonts`
const TOKENS = 'wp-plugins/teeshoop-core/assets/tokens.css'

/**
 * The stylesheets that are actually served to a shopper.
 *
 * A GLOB, NOT A FIXED PATH, for the editor's sheet: it carries a content hash
 * (`editeur-<hash>.css`), and a literal name here would simply stop existing on
 * the next build. The list was filtered by `existsSync` below, so a name that
 * stopped resolving dropped out in SILENCE, which is "nothing looked" reading
 * as "nothing found". It now refuses instead.
 */
const EDITEUR_DIR = 'wp-plugins/teeshoop-core/assets/editeur'
function stylesheets() {
  const editeur = existsSync(p(EDITEUR_DIR))
    ? readdirSync(p(EDITEUR_DIR))
        .filter((f) => f.startsWith('editeur-') && f.endsWith('.css'))
        .map((f) => `${EDITEUR_DIR}/${f}`)
    : []
  return [
    `${THEME}/style.css`,
    'wp-plugins/teeshoop-core/assets/components.css',
    'wp-plugins/teeshoop-core/assets/product.css',
    ...editeur,
  ]
}

/** Anything under these two roots is ours and may not reach Google. */
const NO_GOOGLE = [THEME, 'wp-plugins/teeshoop-core']

const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/*
 * COMMENTS OUT BEFORE LOOKING FOR GOOGLE, and this is not a convenience.
 *
 * The first version of this scan matched the raw text and refused two files:
 * `fonts.css` and `tokens.css`, both of which name fonts.googleapis.com in
 * PROSE, to explain why the fonts are self-hosted. A guard that fails on its own
 * documentation teaches whoever hits it to delete the documentation.
 *
 * What is dangerous is a REQUEST, and a request lives in code. Block comments go
 * first; then a line whose first non-blank character is a comment marker; then a
 * trailing `//` comment, with the `:` guard so that `https://…` inside real code
 * is not cut in half. `#` is only stripped at the start of a line, because in
 * PHP and CSS it is far more often a colour than a comment.
 */
const uncomment = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => (/^\s*(\/\/|#|\*)/.test(l) ? '' : l.replace(/(?<!:)\/\/.*$/, '')))
    .join('\n')

/* ── what tokens.css says the two families are ─────────────────────────── */

/**
 * The first quoted family name in a token's value.
 *
 * `--ts-font-display: 'Urbanist', var(--ts-font);` resolves to Urbanist: the
 * rest of the value is the fallback chain and is not a face we ship.
 */
function familyOf(tokensCss, token) {
  const m = tokensCss.match(new RegExp(`${token}:\\s*'([^']+)'`))
  return m ? m[1] : null
}

/* ── the faces fonts.css declares ──────────────────────────────────────── */

/**
 * Every @font-face in fonts.css, as {family, weight, file}.
 *
 * Parsed from the stripped text so a face named in a comment (this file's
 * header names several) is never mistaken for a declaration.
 */
function declaredFaces(css) {
  const faces = []
  for (const block of strip(css).split('@font-face')) {
    const family = block.match(/font-family:\s*'([^']+)'/)
    const weight = block.match(/font-weight:\s*(\d{3})/)
    const src = block.match(/url\('([^']+)'\)/)
    if (family && weight && src) {
      faces.push({ family: family[1], weight: Number(weight[1]), file: src[1] })
    }
  }
  return faces
}

/* ── the (family, weight) pairs the stylesheets ask for ────────────────── */

/**
 * Walk CSS blocks tracking depth outside comments, and resolve each block's
 * family from the block itself.
 *
 * `font-family: inherit` is skipped rather than guessed: it means « whatever my
 * parent already resolved to », which by definition is a face something else in
 * this scan already declared.
 */
function askedFor(css, file, families, bodyWeight) {
  const asks = []
  let depth = 0
  let inComment = false
  let block = []
  let startLine = 1
  let line = 1

  const flush = () => {
    const text = strip(block.join(''))
    const fw = text.match(/font-weight:\s*([a-z0-9-]+)/)
    if (!fw) return
    let weight = fw[1]
    if (weight === 'bold') weight = '700'
    if (weight === 'normal') weight = '400'
    // `font-weight: var(--ts-weight-display)` and friends: resolve through the
    // token, because the whole point of the token is that the value has one home.
    const viaToken = text.match(/font-weight:\s*var\(\s*(--ts-weight-[a-z]+)\s*\)/)
    if (viaToken) weight = String(families.weights[viaToken[1]] ?? '')
    if (!/^\d{3}$/.test(weight)) return

    const ff = text.match(/font-family:\s*([^;]+);/)
    let family = families.body
    if (ff) {
      const v = ff[1].trim()
      if (v === 'inherit') return
      if (v.includes('--ts-font-display')) family = families.display
      else if (v.includes('--ts-font-mono')) return // system stack, we ship nothing
      else if (v.includes('--ts-font')) family = families.body
      else return // a literal stack of system faces: nothing of ours to ship
    }
    asks.push({ family, weight: Number(weight), file, line: startLine })
  }

  for (const raw of css.split(/(?<=\n)/)) {
    if (block.length === 0) startLine = line
    block.push(raw)
    let j = 0
    while (j < raw.length) {
      if (inComment) {
        if (raw.startsWith('*/', j)) { inComment = false; j += 2; continue }
        j++; continue
      }
      if (raw.startsWith('/*', j)) { inComment = true; j += 2; continue }
      if (raw[j] === '{') depth++
      else if (raw[j] === '}') {
        depth--
        if (depth === 0) { flush(); block = []; startLine = line + 1 }
      }
      j++
    }
    line++
  }
  return asks
}

/* ── the run ───────────────────────────────────────────────────────────── */

function run({ fontsCss, tokensCss, sheets, fileBytes, packageBytes, googleText, licences, preloads }) {
  const problems = []
  let looked = 0

  const body = familyOf(tokensCss, '--ts-font')
  const display = familyOf(tokensCss, '--ts-font-display')
  if (!body || !display) {
    return { code: 2, problems: ['tokens.css ne déclare plus --ts-font et --ts-font-display de façon lisible'], looked }
  }
  const weights = {}
  for (const m of tokensCss.matchAll(/(--ts-weight-[a-z]+):\s*(\d{3})/g)) weights[m[1]] = Number(m[2])
  const families = { body, display, weights }

  const faces = declaredFaces(fontsCss)
  if (faces.length === 0) {
    return { code: 2, problems: ['aucun @font-face lu dans fonts.css : le contrôle n’a rien regardé'], looked }
  }
  looked += faces.length

  const shipped = new Set(faces.map((f) => `${f.family}/${f.weight}`))

  // 1. every declared file is on disk and identical to the package it came from
  for (const face of faces) {
    const rel = `${THEME}/assets/${face.file}`
    const mine = fileBytes(rel)
    if (mine === null) {
      problems.push(`${face.family} ${face.weight} : fonts.css nomme ${face.file}, qui n’est pas sur le disque`)
      continue
    }
    const theirs = packageBytes(face)
    if (theirs === 'absent') {
      return {
        code: 2,
        problems: [`@fontsource/${face.family.toLowerCase()} n’est pas installé : le contrôle ne peut pas comparer, et « pas pu regarder » n’est pas « pas de dérive » (npm ci)`],
        looked,
      }
    }
    looked++
    if (theirs === null || !mine.equals(theirs)) {
      problems.push(`${face.file} diffère du paquet @fontsource/${face.family.toLowerCase()} : la copie du thème a dérivé`)
    }
  }

  // 2. every weight a rule asks for is a weight we ship
  const asks = []
  for (const [file, css] of sheets) asks.push(...askedFor(css, file, families, 400))
  if (asks.length === 0) {
    return { code: 2, problems: ['aucune règle avec un font-weight lue : le contrôle n’a rien regardé'], looked }
  }
  looked += asks.length

  const missing = new Map()
  for (const a of asks) {
    const key = `${a.family}/${a.weight}`
    if (!shipped.has(key)) {
      if (!missing.has(key)) missing.set(key, [])
      missing.get(key).push(`${a.file}:${a.line}`)
    }
  }
  for (const [key, where] of missing) {
    const [fam, w] = key.split('/')
    problems.push(
      `${fam} ${w} : ${where.length} règle(s) le demandent et aucun @font-face ne le livre, ` +
        `donc le navigateur en fabrique un faux. Vu à ${where.slice(0, 4).join(', ')}${where.length > 4 ? ', …' : ''}`,
    )
  }

  // 3. every shipped face is asked for by something
  const used = new Set(asks.map((a) => `${a.family}/${a.weight}`))
  for (const key of shipped) {
    if (!used.has(key)) {
      const [fam, w] = key.split('/')
      problems.push(`${fam} ${w} est livré et aucune règle ne le demande : des octets sur chaque page pour rien`)
    }
  }

  // 4. nothing reaches Google
  if (googleText.length === 0) {
    return { code: 2, problems: ['le parcours des fichiers du thème n’a rien ouvert : la recherche d’adresses Google n’a rien regardé'], looked }
  }
  for (const [file, text] of googleText) {
    looked++
    const hit = uncomment(text).match(/fonts\.(googleapis|gstatic)\.com/)
    if (hit) problems.push(`${file} contient une adresse ${hit[0]} : chaque visiteur enverrait son IP à un tiers`)
  }

  // 5. every preloaded name is a file we actually ship
  if (preloads === null) {
    return { code: 2, problems: ['la liste PRELOAD n’a pas pu être lue dans functions.php : le contrôle ne sait pas ce qui est préchargé'], looked }
  }
  if (preloads.length === 0) {
    problems.push('functions.php ne précharge aucune police : la première peinture attendra la feuille de style')
  }
  for (const name of preloads) {
    looked++
    if (!faces.some((f) => f.file.split('/').pop() === name)) {
      problems.push(`functions.php précharge ${name}, qui n’est déclaré par aucun @font-face : une requête prioritaire vers un 404 sur chaque page`)
    }
  }

  // 6. the licences travel with the files
  for (const [name, size] of licences) {
    looked++
    if (size === null) problems.push(`la licence ${name} est absente à côté des polices qu’elle couvre`)
    else if (size < 500) problems.push(`la licence ${name} fait ${size} octets, ce qui n’est pas un texte d’OFL`)
  }

  return { code: problems.length ? 1 : 0, problems, looked, faces, asks: asks.length }
}

/* ── the real inputs ───────────────────────────────────────────────────── */

const readBytesOrNull = (rel) => {
  try { return readFileSync(p(rel)) } catch { return null }
}

const realInputs = () => ({
  fontsCss: read(FONTS_CSS),
  tokensCss: read(TOKENS),
  /*
   * PLUS DE `filter(existsSync)`. Une feuille listée et absente est une panne,
   * pas une ligne à sauter : `read()` lève, et c'est ce qu'on veut.
   */
  sheets: stylesheets().map((f) => [f, read(f)]),
  fileBytes: readBytesOrNull,
  packageBytes: (face) => {
    const pkg = `node_modules/@fontsource/${face.family.toLowerCase()}`
    if (!existsSync(p(pkg))) return 'absent'
    // urbanist-latin-700.woff2 in the theme is urbanist-latin-700-normal.woff2 upstream.
    const base = face.file.split('/').pop().replace(/\.woff2$/, '-normal.woff2')
    return readBytesOrNull(`${pkg}/files/${base}`)
  },
  googleText: NO_GOOGLE.flatMap((rootRel) => {
    const out = []
    const walk = (rel) => {
      for (const e of readdirSafe(p(rel))) {
        const child = `${rel}/${e.name}`
        if (e.isDirectory()) { if (e.name !== 'node_modules') walk(child) }
        else if (/\.(css|php|js|html)$/.test(e.name)) out.push([child, read(child)])
      }
    }
    walk(rootRel)
    return out
  }),
  licences: [
    ['LICENCE-Urbanist.txt', sizeOrNull(`${FONTS_DIR}/LICENCE-Urbanist.txt`)],
    ['LICENCE-Lato.txt', sizeOrNull(`${FONTS_DIR}/LICENCE-Lato.txt`)],
  ],
  preloads: preloadedNames(read(`${THEME}/functions.php`)),
})

/**
 * The woff2 names in functions.php's `PRELOAD` constant.
 *
 * `null` and not `[]` when the constant cannot be found, because a rename there
 * must stop this check rather than quietly turn it into « nothing preloaded ».
 */
function preloadedNames(php) {
  const m = php.match(/const PRELOAD\s*=\s*array\(([^)]*)\)/)
  if (!m) return null
  return [...m[1].matchAll(/'([^']+\.woff2)'/g)].map((x) => x[1])
}

/*
 * NOT `require('node:fs')`. This module is ESM and `require` is not defined in
 * it, so that call threw on every directory, the `catch` swallowed it, and the
 * Google-Fonts scan walked ZERO files while printing a green tick. It was found
 * by counting: the summary said 54 checks, and 4 faces + 4 comparisons + 44
 * rules + 2 licences is 54 with nothing left over for the file walk.
 *
 * That is the exact shape CLAUDE.md forbids, in the script whose whole job is
 * to refuse it. The empty-scan guard below is the second half of the fix: a
 * walk that finds no file is now an exit 2, so the same mistake cannot be
 * silent twice.
 */
function readdirSafe(abs) {
  try { return readdirSync(abs, { withFileTypes: true }) } catch { return [] }
}
function sizeOrNull(rel) {
  try { return statSync(p(rel)).size } catch { return null }
}

/* ── self-test: prove each refusal can fire ────────────────────────────── */

function selfTest() {
  const base = realInputs()
  let bad = 0
  const expect = (name, inputs, wanted) => {
    const r = run(inputs)
    const ok = r.code === wanted
    console.log(`  ${ok ? GREEN + '✓' : RED + '✗'}${OFF} ${name} ${DIM}(sortie ${r.code}, attendu ${wanted})${OFF}`)
    if (!ok) { bad++; r.problems.forEach((x) => console.log(`      ${DIM}${x}${OFF}`)) }
  }

  expect('tel quel, le dépôt passe', base, 0)

  expect(
    'une règle qui demande un poids non livré est refusée',
    { ...base, sheets: [...base.sheets, ['(essai)', '.x {\n font-family: var(--ts-font);\n font-weight: 900;\n}\n']] },
    1,
  )
  expect(
    'un woff2 absent du disque est refusé',
    { ...base, fileBytes: (rel) => (rel.includes('urbanist-latin-700') ? null : base.fileBytes(rel)) },
    1,
  )
  expect(
    'un woff2 qui a dérivé du paquet est refusé',
    { ...base, packageBytes: (f) => (f.weight === 400 ? Buffer.from('pas la meme police') : base.packageBytes(f)) },
    1,
  )
  expect(
    'une adresse Google Fonts est refusée',
    { ...base, googleText: [...base.googleText, ['(essai)', '<link href="https://fonts.googleapis.com/css?family=Lato">']] },
    1,
  )
  expect('une licence absente est refusée', { ...base, licences: [['LICENCE-Urbanist.txt', null]] }, 1)
  expect(
    'un préchargement vers un fichier qui n’existe plus est refusé',
    { ...base, preloads: ['inter-latin-400.woff2'] },
    1,
  )
  expect('une liste PRELOAD illisible rend 2', { ...base, preloads: null }, 2)
  expect(
    'un paquet @fontsource absent rend 2, pas 1',
    { ...base, packageBytes: () => 'absent' },
    2,
  )
  expect('aucun @font-face lu rend 2', { ...base, fontsCss: '/* rien */' }, 2)
  expect('aucune règle lue rend 2', { ...base, sheets: [['(vide)', 'body{color:red}']] }, 2)

  console.log(bad === 0 ? `${GREEN}Auto-test : les onze refus savent se déclencher.${OFF}` : `${RED}Auto-test : ${bad} échec(s).${OFF}`)
  return bad === 0 ? 0 : 1
}

/* ── main ──────────────────────────────────────────────────────────────── */

if (process.argv.includes('--self-test')) {
  process.exit(selfTest())
}

let result
try {
  result = run(realInputs())
} catch (e) {
  console.error(`${RED}theme-fonts-check : le contrôle n’a pas pu tourner : ${e.message}${OFF}`)
  process.exit(2)
}

if (result.code === 2) {
  console.error(`${RED}theme-fonts-check : le contrôle n’a pas pu regarder.${OFF}\n`)
  for (const x of result.problems) console.error('  ' + x)
  process.exit(2)
}
if (result.code === 1) {
  console.error(`${RED}theme-fonts-check : la typographie du thème ne tient pas.${OFF}\n`)
  for (const x of result.problems) console.error('  ' + x)
  process.exit(1)
}

const bytes = result.faces.reduce((n, f) => n + (statSync(p(`${THEME}/assets/${f.file}`)).size || 0), 0)
console.log(
  `theme-fonts-check : ${result.faces.length} fontes (${result.faces.map((f) => `${f.family} ${f.weight}`).join(', ')}), ` +
    `${bytes.toLocaleString('fr-FR')} octets, ${result.asks} règles pesées, ${result.looked} contrôles. Clean.`,
)
