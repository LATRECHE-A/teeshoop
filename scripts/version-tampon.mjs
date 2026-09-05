#!/usr/bin/env node
/**
 * TAMPONNER LE COMMIT DANS L'EN-TÊTE DE L'EXTENSION.
 *
 *   node scripts/version-tampon.mjs              tamponne
 *   node scripts/version-tampon.mjs --verifier   dit ce qui est tamponné, sort 1 si rien
 *   node scripts/version-tampon.mjs --retirer    remet la ligne nue
 *   node scripts/version-tampon.mjs --self-test  prouve que les refus tombent encore
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI
 *
 * L'écran des extensions de WordPress annonce « Teeshoop Core 0.1.0 » depuis six
 * mois. Ce nombre n'a jamais bougé et ne dit donc rien : devant une boutique qui
 * se comporte mal, personne ne peut répondre à « quel code tourne là ». La
 * préproduction et la production reçoivent le même envoi à des moments
 * différents, et la seule chose qui les distingue est le commit.
 *
 * Ce fichier écrit ce commit dans la ligne que WordPress affiche déjà, donc sans
 * une ligne de PHP en plus et sans un écran d'administration à ouvrir :
 *
 *   Version:           0.1.0            (dans le dépôt, jamais tamponnée)
 *   Version:           0.1.0+g1a2b3c4   (ce qui part sur le serveur)
 *
 * `+` et non `-` : en versionnage sémantique, ce qui suit un `+` est une
 * métadonnée de construction et ne change pas l'ordre des versions, là où ce qui
 * suit un `-` désigne une pré-version et rendrait 0.1.0+g1a2b3c4 INFÉRIEUR à
 * 0.1.0. Une extension qui rajeunit à chaque déploiement est le genre de détail
 * qui se paie une fois, très tard.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LE NUMÉRO N'EST PAS INVENTÉ, ET LE COMMIT NON PLUS
 *
 * `0.1.0` est laissé tel quel : décider que la boutique est en 1.0 est une
 * décision de produit, pas une décision de script. Ce qui est ajouté est mesuré,
 * jamais construit : `git rev-parse`. Sans git, sans dépôt, ou sur un en-tête
 * dont la ligne a changé de forme, ce fichier REFUSE et sort 2. Un tampon faux
 * est pire qu'un tampon absent, parce qu'il envoie chercher un commit qui
 * n'explique pas le comportement observé.
 *
 * `.sale` QUAND L'ARBRE EST MODIFIÉ. Un déploiement lancé depuis une copie de
 * travail qui n'est pas celle du commit produit un serveur que le commit ne
 * décrit pas. Le suffixe le dit à l'écran plutôt que de le taire.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const FICHIER = join(ROOT, 'wp-plugins', 'teeshoop-core', 'teeshoop-core.php')

/*
 * La ligne d'en-tête, ancrée sur le début de ligne et sur le préfixe de bloc de
 * commentaire. Sans les deux, la première occurrence de « Version: » dans les
 * quatre-vingts lignes de prose qui suivent serait réécrite à la place.
 */
const LIGNE = /^([ \t]*\*[ \t]*Version:[ \t]*)(\d+\.\d+\.\d+)(\+g[0-9a-f]{7,}(?:\.sale)?)?[ \t]*$/m

/** Le commit, mesuré. Rend null si git ne peut pas répondre. */
export function commit(racine) {
  const git = (...args) => execFileSync('git', args, { cwd: racine, encoding: 'utf8' }).trim()
  try {
    const sha = git('rev-parse', '--short=7', 'HEAD')
    if (!/^[0-9a-f]{7,}$/.test(sha)) return null
    const sale = git('status', '--porcelain') !== ''
    return { sha, sale }
  } catch {
    return null
  }
}

/**
 * Rend le contenu tamponné, ou une raison. Pur, pour que `--self-test` exerce le
 * vrai chemin de décision.
 */
export function tamponner(contenu, sha, sale) {
  const m = LIGNE.exec(contenu)
  if (m === null) {
    return { ok: false, dit: 'la ligne « * Version: x.y.z » de l’en-tête est introuvable, donc rien n’a été tamponné.' }
  }
  const base = m[2]
  const marque = `+g${sha}${sale ? '.sale' : ''}`
  return {
    ok: true,
    base,
    marque,
    contenu: contenu.replace(LIGNE, `$1${base}${marque}`),
  }
}

/** Ce que porte l'en-tête aujourd'hui. */
export function lire(contenu) {
  const m = LIGNE.exec(contenu)
  if (m === null) return { ok: false }
  return { ok: true, base: m[2], marque: m[3] ?? '' }
}

// ---------------------------------------------------------------------------

if (process.argv.includes('--self-test')) {
  const entete = ['<?php', '/**', ' * Plugin Name:       Teeshoop Core', ' * Version:           0.1.0', ' */'].join('\n')
  const cas = [
    ['une ligne nue est tamponnée', () => tamponner(entete, '1a2b3c4', false).contenu.includes('0.1.0+g1a2b3c4')],
    ['un arbre modifié est marqué', () => tamponner(entete, '1a2b3c4', true).contenu.includes('0.1.0+g1a2b3c4.sale')],
    [
      'tamponner deux fois ne cumule pas les tampons',
      () => {
        const une = tamponner(entete, '1a2b3c4', false).contenu
        const deux = tamponner(une, '9f9f9f9', false).contenu
        return deux.includes('0.1.0+g9f9f9f9') && !deux.includes('1a2b3c4')
      },
    ],
    [
      'un en-tête sans ligne Version refuse',
      () => tamponner('<?php\n/**\n * Plugin Name: X\n */', '1a2b3c4', false).ok === false,
    ],
    [
      'le mot Version dans la prose n’est pas pris pour l’en-tête',
      () => {
        // La ligne de prose n'est pas ancrée sur « * Version: <semver> » seul.
        const avec = entete.replace(' */', ' * Cette Version: 9.9.9 est un exemple\n */')
        const out = tamponner(avec, '1a2b3c4', false)
        return out.ok === true && out.contenu.includes('Cette Version: 9.9.9') && out.contenu.includes('0.1.0+g1a2b3c4')
      },
    ],
    ['lire rend le tampon posé', () => lire(tamponner(entete, '1a2b3c4', false).contenu).marque === '+g1a2b3c4'],
    ['lire rend une marque vide sur une ligne nue', () => lire(entete).marque === ''],
  ]
  let rouges = 0
  for (const [nom, f] of cas) {
    let ok = false
    try {
      ok = f() === true
    } catch {
      ok = false
    }
    if (ok) console.log(`  tenu    ${nom}`)
    else {
      rouges += 1
      console.error(`  MANQUE  ${nom}`)
    }
  }
  console.log('')
  if (cas.length === 0) {
    console.error('version-tampon --self-test : aucun cas. Un vert ici ne voudrait rien dire.')
    process.exit(2)
  }
  if (rouges > 0) {
    console.error(`version-tampon --self-test ÉCHEC : ${rouges} sur ${cas.length}`)
    process.exit(1)
  }
  console.log(`version-tampon --self-test OK : ${cas.length} cas.`)
  process.exit(0)
}

let source
try {
  source = readFileSync(FICHIER, 'utf8')
} catch (e) {
  console.error(`version-tampon ÉCHEC : ${FICHIER} est illisible (${e.message}).`)
  process.exit(2)
}

if (process.argv.includes('--verifier')) {
  const etat = lire(source)
  if (!etat.ok) {
    console.error('version-tampon ÉCHEC : la ligne « * Version: » de l’en-tête est introuvable.')
    process.exit(2)
  }
  if (etat.marque === '') {
    console.error(`version-tampon : l’en-tête annonce ${etat.base} et aucun commit. Ce qui partirait n’est identifiable par rien.`)
    process.exit(1)
  }
  console.log(`version-tampon : l’en-tête annonce ${etat.base}${etat.marque}.`)
  process.exit(0)
}

if (process.argv.includes('--retirer')) {
  const etat = lire(source)
  if (!etat.ok) {
    console.error('version-tampon ÉCHEC : la ligne « * Version: » de l’en-tête est introuvable.')
    process.exit(2)
  }
  writeFileSync(FICHIER, source.replace(LIGNE, `$1${etat.base}`))
  console.log(`version-tampon : tampon retiré, l’en-tête annonce ${etat.base}.`)
  process.exit(0)
}

const c = commit(ROOT)
if (c === null) {
  console.error('version-tampon ÉCHEC : git n’a pas pu donner le commit courant, donc il n’y a rien de vrai à tamponner.')
  console.error('  Rien n’a été écrit. Un numéro inventé enverrait chercher un commit qui n’explique rien.')
  process.exit(2)
}

const out = tamponner(source, c.sha, c.sale)
if (!out.ok) {
  console.error(`version-tampon ÉCHEC : ${out.dit}`)
  process.exit(2)
}
writeFileSync(FICHIER, out.contenu)
console.log(`version-tampon OK : l’en-tête annonce ${out.base}${out.marque}.`)
if (c.sale) {
  console.log('  L’arbre de travail porte des modifications non validées : le suffixe « .sale » le dit sur l’écran des extensions.')
}
