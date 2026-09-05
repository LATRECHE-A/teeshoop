#!/usr/bin/env node
/**
 * Ce que la VUE SIMPLE a le droit de faire descendre chez un client, et ce que
 * sa feuille de style a le droit de toucher.
 *
 *   npm run verify:editeur
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI UNE GARDE SUR LE GRAPHE, ET PAS UNE LISTE DE FICHIERS
 *
 * On répétait depuis des mois que le code « client » et le code « avancé »
 * étaient séparés. Ce n'était pas vrai, et deux mesures le montrent :
 *
 *   `src/app/panels/UploadsPanel.tsx:14` importait `removeBackground` depuis
 *   `@/lib/bgremove`, qui tire 13,5 Mo de WebAssembly et 4,5 Mo de modèle ONNX ;
 *
 *   `src/app/EditorCanvas.tsx:10` importait EN VALEUR `stageBackground` depuis
 *   `@/scenes`, le module des décors 3D.
 *
 * Les deux fichiers étaient sur toutes les listes « à garder pour le client » et
 * leurs cibles sur toutes les listes « à bannir ». Une liste de fichiers ne peut
 * pas dire ça ; seul un parcours du graphe le peut, parce que ce qui compte est
 * l'ATTEIGNABILITÉ et pas le nom. `src/app/adminBoundary.test.ts` fait déjà ce
 * travail pour la frontière administrateur, et ce fichier réutilise le même
 * marcheur (`scripts/admin-boundary.mjs`) plutôt que d'en écrire un second.
 *
 * UNE DIFFÉRENCE, ET ELLE EST NOMMÉE. Là-bas un `import()` compte comme une
 * arête, parce qu'un morceau paresseux se télécharge quand même et qu'un
 * `GET /assets/<hash>.js` le rend à qui le demande. Ici la question est
 * l'inverse : ce qu'un client télécharge AVANT d'avoir cliqué quoi que ce soit.
 * Le parcours est donc statique, et le paquet construit est mesuré à part.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QU'IL VÉRIFIE
 *
 *   1. le graphe statique depuis `src/native/main.ts` n'atteint aucun module
 *      banni, et il atteint bien ceux qui doivent y être (sinon « corriger »
 *      une violation en supprimant la fonctionnalité passerait) ;
 *   2. le paquet construit ne porte aucun marqueur de ces modules ;
 *   3. la feuille de style ne vise que `.tshop-ed`, jamais `body`, `html`,
 *      `:root` ni `*`, et ne pose aucune fenêtre `position: fixed` ;
 *   4. aucun écouteur clavier global ;
 *   5. aucun chemin d'actif absolu (`/models/`, `/ort/`, `/catalog/`) ;
 *   6. le paquet versionné est bien celui que la source produit AUJOURD'HUI ;
 *   7. et il imprime le poids compressé de la première charge.
 *
 * Un contrôle qui n'a rien parcouru sort en 2 : « rien trouvé » et « rien
 * regardé » ne sont pas le même résultat.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { closureFrom } from './admin-boundary.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const ENTREE = join(ROOT, 'src', 'native', 'main.ts')
const SORTIE = join(ROOT, 'wp-plugins', 'teeshoop-core', 'assets', 'editeur')
/**
 * L'entrée et sa feuille, trouvées par leur empreinte comme `Editeur::fichier()`
 * les trouve, et il doit y en avoir EXACTEMENT UNE de chaque.
 *
 * Deux `editeur-*.js` dans ce répertoire veulent dire qu'un build a écrit
 * par-dessus l'ancien sans le vider, et PHP refuserait alors de servir quoi que
 * ce soit plutôt que de deviner. Ce contrôle-là attrape la même chose avant le
 * déploiement.
 */
function entree(ext) {
  const noms = readdirSync(SORTIE).filter((f) => f.startsWith('editeur-') && f.endsWith('.' + ext))
  if (noms.length !== 1) {
    console.error(
      `\nFATAL  ${noms.length} fichier(s) editeur-*.${ext} dans ${relative(ROOT, SORTIE)}, il en faut exactement un.` +
        '\n       Videz le répertoire, puis : npm run build:editeur',
    )
    process.exit(2)
  }
  return join(SORTIE, noms[0])
}

const PAQUET = entree('js')
const FEUILLE = entree('css')

/**
 * Ce que la première charge du studio pesait, compressé, mesuré le 5 septembre
 * 2026 sur `dist/` : `index.html` plus les modules qu'il précharge. C'est le
 * chiffre auquel la vue simple se compare, et il est écrit ici pour que la
 * comparaison survive à la disparition du studio.
 */
const STUDIO_OCTETS_GZ = 246473

/**
 * Modules interdits au graphe STATIQUE de la vue simple.
 *
 * Chacun avec la raison, parce qu'un jour quelqu'un voudra en retirer un et
 * doit pouvoir lire pourquoi il est là plutôt que deviner.
 */
const BANNIS = [
  ['src/lib/bgremove/', '13,5 Mo de WebAssembly et 4,6 Mo de modèle ONNX'],
  ['src/scenes/', 'les décors 3D, dont la vue simple n’a aucun usage'],
  ['src/lib/arExport.ts', 'la réalité augmentée, qui tire three.js et l’export GLB/USDZ'],
  ['src/lib/dtf/', 'l’économie du film, qui est de l’atelier et pas du client'],
  ['src/three/', 'three.js'],
  ['src/app/', 'le studio React, qui est justement ce que cette nuit remplace'],
  ['src/admin/', 'les outils d’atelier'],
]

/** Paquets tiers interdits, cherchés dans les spécificateurs nus du graphe. */
const PAQUETS_BANNIS = ['three', '@react-three', 'react', 'react-dom', 'onnxruntime-web']

/**
 * Modules qui DOIVENT rester atteignables.
 *
 * Sans eux, une « correction » enthousiaste d'une violation pourrait supprimer
 * la mesure d'encre ou le dépôt de la création, et la garde resterait verte sur
 * un éditeur qui ne sait plus vendre.
 */
const OBLIGATOIRES = [
  'src/lib/ink.ts', // la seule mesure d'encre, celle que lit aussi le coût du film
  'src/lib/teeshoop/upload.ts', // le dépôt de la création sur R2
  'src/lib/teeshoop/designDoc.ts', // le contrat des deux bouts
  'src/editor/EditorEngine.ts', // le tracé, le même que celui de l'export
  'src/native/atelier.ts', // le devis et le panier
]

/** Marqueurs qui ne doivent apparaître dans AUCUN octet de la première charge. */
const MARQUEURS = [
  ['onnxruntime', 'le runtime ONNX'],
  ['u2netp', 'le modèle de détourage'],
  ['THREE.', 'three.js'],
  ['react-dom', 'React'],
  ['/models/', 'un chemin d’actif absolu'],
  ['/ort/', 'un chemin d’actif absolu'],
  ['/catalog/', 'un chemin d’actif absolu'],
  ['baseUsd', 'le second moteur de prix, en dollars'],
]

const resultats = []
const ok = (nom, passe, extra = '') => {
  resultats.push({ nom, passe, extra })
  console.log(`${passe ? 'PASS' : 'FAIL'} ${nom}${extra ? '  ' + extra : ''}`)
  return passe
}

const lire = (p) => readFileSync(p, 'utf8')

// ---------------------------------------------------------------------------
// 1. le graphe statique
// ---------------------------------------------------------------------------

const graphe = closureFrom(ENTREE, ROOT, { dynamic: false })
if (!ok('le graphe a été parcouru', graphe.size > 15, `${graphe.size} modules atteints`)) {
  console.error('\nFATAL  le parcours n’a rien trouvé, donc rien n’est prouvé.')
  process.exit(2)
}

for (const [prefixe, pourquoi] of BANNIS) {
  const fuites = [...graphe.entries()]
    .filter(([f]) => (prefixe.endsWith('/') ? f.startsWith(prefixe) : f === prefixe))
    .map(([f, par]) => `${f} <- ${par}`)
  ok(`la vue simple n’atteint pas ${prefixe}`, fuites.length === 0, fuites.length ? fuites.join(' | ') : pourquoi)
}

/*
 * LES PAQUETS TIERS, cherchés dans le TEXTE des modules atteints.
 *
 * `closureFrom` ne résout pas les spécificateurs nus (c'est ce qui lui permet de
 * s'arrêter aux frontières de node_modules), donc un `import Konva from 'konva'`
 * n'apparaît pas dans le graphe. Ils sont donc cherchés à la source, dans les
 * fichiers que le graphe a bien atteints, ce qui est la même question posée
 * autrement.
 */
const paquetsVus = new Map()
for (const rel of graphe.keys()) {
  const src = lire(join(ROOT, rel))
  for (const m of src.matchAll(/(?:^\s*(?:import|export)[\s\S]*?from|^\s*import)\s*['"]([^'".@/][^'"]*|@[^'"/]+\/[^'"]+)['"]/gm)) {
    const nom = m[1].split('/')[0].startsWith('@') ? m[1].split('/').slice(0, 2).join('/') : m[1].split('/')[0]
    if (!paquetsVus.has(nom)) paquetsVus.set(nom, rel)
  }
}
const paquetsInterdits = PAQUETS_BANNIS.filter((n) => paquetsVus.has(n)).map((n) => `${n} <- ${paquetsVus.get(n)}`)
ok(
  'la vue simple n’importe aucun paquet interdit',
  paquetsInterdits.length === 0,
  paquetsInterdits.length ? paquetsInterdits.join(' | ') : [...paquetsVus.keys()].sort().join(', '),
)

const manquants = OBLIGATOIRES.filter((f) => !graphe.has(f))
ok(
  'et elle atteint toujours tout ce qui la fait vendre',
  manquants.length === 0,
  manquants.length ? `absents : ${manquants.join(', ')}` : `${OBLIGATOIRES.length} modules obligatoires`,
)

// ---------------------------------------------------------------------------
// 1 bis. l'état est dans l'instance, pas dans le module
// ---------------------------------------------------------------------------

/*
 * SIXIÈME RAISON DE `Shortcode.php` : « les singletons de niveau module qui
 * n'autorisent qu'une instance par document ».
 *
 * La réponse est que tout l'état d'un éditeur vit dans son instance, et la
 * preuve est qu'AUCUN fichier de `src/native/` ne déclare de variable mutable au
 * niveau du module. Un `let` là-haut est un état partagé par toutes les
 * instances, quel que soit le soin mis ailleurs, et c'est exactement la forme
 * que prend ce défaut : personne n'écrit « singleton », quelqu'un écrit `let
 * courant = null` et le second éditeur écrase le premier.
 *
 * `const` est permis parce qu'un objet constant peut quand même être muté ; ce
 * que cette garde attrape est la déclaration, pas toute mutation possible, et
 * elle le dit plutôt que de prétendre à une preuve qu'un scanner de texte ne
 * peut pas donner. Ce qui la complète est ailleurs : `main.ts` marque le second
 * conteneur d'une page au lieu de le monter, et `scripts/wp-e2e-verify.mjs`
 * vérifie qu'une fiche produit n'en porte qu'un.
 */
const fichiersNatifs = readdirSync(join(ROOT, 'src', 'native')).filter((f) => f.endsWith('.ts'))
ok('les fichiers de src/native sont lus', fichiersNatifs.length >= 5, `${fichiersNatifs.length} fichiers`)
const etatsModule = []
for (const f of fichiersNatifs) {
  const src = lire(join(ROOT, 'src', 'native', f))
  for (const m of src.matchAll(/^(let|var)\s+([A-Za-z_$][\w$]*)/gm)) {
    etatsModule.push(`src/native/${f}: ${m[1]} ${m[2]}`)
  }
}
ok(
  'aucun état mutable au niveau du module dans src/native',
  etatsModule.length === 0,
  etatsModule.length ? etatsModule.join(' | ') : 'deux éditeurs peuvent coexister',
)

// ---------------------------------------------------------------------------
// 2. le paquet construit
// ---------------------------------------------------------------------------

let paquet = ''
try {
  paquet = lire(PAQUET)
} catch {
  console.error(`\nFATAL  ${relative(ROOT, PAQUET)} est absent. Lancez : npm run build:editeur`)
  process.exit(2)
}
ok('le paquet construit est là et n’est pas vide', paquet.length > 1000, `${paquet.length} octets`)

for (const [marqueur, quoi] of MARQUEURS) {
  ok(`la première charge ne porte pas « ${marqueur} »`, !paquet.includes(marqueur), quoi)
}

/*
 * LES ÉCOUTEURS CLAVIER GLOBAUX, cinquième raison de garder le cadre.
 *
 * Cherchés dans la SORTIE et pas dans la source : la minification renomme les
 * symboles mais pas les chaînes, et `addEventListener("keydown")` sur `window`
 * ou `document` reste littéralement lisible. C'est la même raison pour laquelle
 * `scripts/bundle-guard.mjs` lit la sortie plutôt que les fichiers.
 */
const clavierGlobal = [...paquet.matchAll(/(window|document)\.addEventListener\(\s*["'](key[a-z]*)["']/g)].map(
  (m) => `${m[1]}.addEventListener("${m[2]}")`,
)
ok(
  'aucun écouteur clavier posé sur window ou document',
  clavierGlobal.length === 0,
  clavierGlobal.length ? clavierGlobal.join(', ') : 'les frappes restent au thème',
)

// ---------------------------------------------------------------------------
// 3. la feuille de style
// ---------------------------------------------------------------------------

let feuille = ''
try {
  feuille = lire(FEUILLE)
} catch {
  console.error(`\nFATAL  ${relative(ROOT, FEUILLE)} est absente.`)
  process.exit(2)
}

/**
 * Les sélecteurs de la feuille, sans les blocs `@media` ni les commentaires.
 *
 * Un analyseur CSS complet serait une dépendance de plus pour répondre à une
 * question de forme ; ce découpage suffit parce que la feuille est la nôtre et
 * que la garde échoue du côté prudent : tout ce qu'elle ne sait pas lire, elle
 * le signale.
 */
function selecteurs(css) {
  const sansCommentaires = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out = []
  for (const m of sansCommentaires.matchAll(/(^|[}{;])\s*([^{}@]+?)\s*\{/g)) {
    const brut = m[2].trim()
    if (brut === '' || brut.startsWith('@') || brut.includes(':')) {
      // Une déclaration de propriétés personnalisées, pas un sélecteur.
      if (!/[.#\[a-zA-Z]/.test(brut)) continue
    }
    for (const un of brut.split(',')) {
      const s = un.trim()
      if (s !== '') out.push(s)
    }
  }
  return out
}

const sels = selecteurs(feuille)
ok('la feuille a des sélecteurs à contrôler', sels.length > 10, `${sels.length} sélecteurs`)

const horsScope = sels.filter((s) => !s.startsWith('.tshop-ed'))
ok(
  'chaque sélecteur commence par .tshop-ed',
  horsScope.length === 0,
  horsScope.length ? horsScope.slice(0, 6).join(' | ') : 'rien du thème n’est atteignable',
)

/*
 * LE JOKER SOUS `.tshop-ed` N'EST PAS UN JOKER GLOBAL.
 *
 * La première version de ce contrôle cherchait `*` n'importe où et refusait
 * `.tshop-ed *`, qui est la règle de `box-sizing` de l'éditeur et ne peut
 * atteindre que ses propres descendants. Ce qu'il faut refuser, c'est un
 * sélecteur qui SORT de la portée, donc on retire d'abord le jeton de portée et
 * on lit ce qui reste. Un `*` dans le reste est borné par construction ;
 * `body`, `html` et `:root` ne le sont jamais.
 */
const globaux = sels
  .map((s) => ({ sel: s, reste: s.replace(/^\.tshop-ed[\w-]*/, '') }))
  .filter(({ reste }) => /(^|[\s>+~(,])(body|html|:root)([\s>+~),]|$)/.test(reste))
  .map(({ sel }) => sel)
ok(
  'aucune règle ne sort de sa portée vers body, html ou :root',
  globaux.length === 0,
  globaux.length ? globaux.join(' | ') : 'le défilement du site est intact',
)

ok(
  'aucune fenêtre en position: fixed',
  !/position\s*:\s*fixed/i.test(feuille),
  'les fenêtres du studio entraient en collision avec Elementor',
)

ok(
  'un anneau de focus est déclaré',
  /focus-visible/.test(feuille) && /outline\s*:/.test(feuille),
  'le clavier depuis le début, pas rétrofité',
)

// ---------------------------------------------------------------------------
// 4. le paquet versionné est-il celui que la source produit
// ---------------------------------------------------------------------------

/*
 * `dist/` n'est pas versionné parce que le Worker le construit au déploiement.
 * Un greffon WordPress est déployé en copiant son répertoire : ce que
 * `assets/editeur/` contient EST ce que la boutique sert. Le risque de cette
 * forme est qu'elle rouille en silence, et c'est ce que cette section attrape.
 */
const temp = mkdtempSync(join(tmpdir(), 'teeshoop-editeur-'))
let compare = { egaux: true, details: '' }
try {
  execFileSync('npx', ['vite', 'build', '--config', 'vite.editeur.config.ts', '--outDir', temp, '--emptyOutDir'], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  const liste = (d) => readdirSync(d).filter((f) => statSync(join(d, f)).isFile()).sort()
  const a = liste(SORTIE)
  const b = liste(temp)
  const seulementVersionne = a.filter((f) => !b.includes(f))
  const seulementConstruit = b.filter((f) => !a.includes(f))
  const differents = a.filter((f) => b.includes(f) && !readFileSync(join(SORTIE, f)).equals(readFileSync(join(temp, f))))
  compare.egaux = seulementVersionne.length + seulementConstruit.length + differents.length === 0
  compare.details = compare.egaux
    ? `${a.length} fichiers identiques`
    : [
        seulementVersionne.length ? `versionnés en trop : ${seulementVersionne.slice(0, 4).join(', ')}` : '',
        seulementConstruit.length ? `manquants : ${seulementConstruit.slice(0, 4).join(', ')}` : '',
        differents.length ? `différents : ${differents.slice(0, 4).join(', ')}` : '',
      ]
        .filter(Boolean)
        .join(' ; ')
} catch (e) {
  compare = { egaux: false, details: `la reconstruction a échoué : ${String(e.message).slice(0, 160)}` }
} finally {
  rmSync(temp, { recursive: true, force: true })
}
ok(
  'le paquet versionné est celui que la source produit aujourd’hui',
  compare.egaux,
  compare.egaux ? compare.details : `${compare.details}. Lancez : npm run build:editeur`,
)

// ---------------------------------------------------------------------------
// 5. le poids, mesuré
// ---------------------------------------------------------------------------

const gz = (p) => gzipSync(readFileSync(p), { level: 9 }).length
const poids = gz(PAQUET) + gz(FEUILLE)
const part = Math.round((poids / STUDIO_OCTETS_GZ) * 1000) / 10
console.log('')
console.log(
  `première charge : ${poids} octets compressés (${gz(PAQUET)} de script, ${gz(FEUILLE)} de style), ` +
    `contre ${STUDIO_OCTETS_GZ} pour le studio encadré, soit ${part} %.`,
)
const paresseux = readdirSync(SORTIE)
  .filter((f) => f.startsWith('morceau-') || f.startsWith('actif-'))
  .reduce((s, f) => s + statSync(join(SORTIE, f)).size, 0)
console.log(`à la demande, jamais avant un clic : ${paresseux} octets sur disque.`)

// ---------------------------------------------------------------------------

console.log('')
if (resultats.length === 0) {
  console.error('editeur-guard : AUCUNE ASSERTION N’A TOURNÉ. Un vert ici ne voudrait rien dire.')
  process.exit(2)
}
const rates = resultats.filter((r) => !r.passe)
if (rates.length > 0) {
  console.error(`editeur-guard ÉCHEC : ${rates.length} assertions sur ${resultats.length}`)
  for (const r of rates) console.error(`  - ${r.nom}${r.extra ? '  ' + r.extra : ''}`)
  process.exit(1)
}
console.log(`editeur-guard OK : ${resultats.length} assertions`)
