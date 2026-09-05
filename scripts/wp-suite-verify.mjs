#!/usr/bin/env node
/**
 * LA SUITE D'INTÉGRATION WOOCOMMERCE, LANCÉE, ET SON PLANCHER.
 *
 *   node scripts/wp-suite-verify.mjs                 le miroir doit tourner
 *   node scripts/wp-suite-verify.mjs --self-test     prouve que le verdict refuse
 *   node scripts/wp-suite-verify.mjs --plancher=N    pour casser la porte exprès
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER EXISTE
 *
 * `CLAUDE.md` section 2 dit que tout ce qui touche au panier ou à la commande
 * passe par un test contre un vrai WooCommerce, et pas seulement par un test
 * pur. Le 5 septembre 2026, cette suite (douze fichiers, 8 360 lignes, 241 cas)
 * ne tournait dans AUCUN travail automatique, alors que trois nuits venaient de
 * toucher le panier. `npm run test:wp` existait, personne ne le lançait.
 *
 * Le brancher ne suffit pas, parce que la suite peut MAIGRIR sans rien casser.
 * `tests/integration.php` est le point d'entrée unique et il `require_once` onze
 * autres fichiers. Retirez une de ces onze lignes : la suite se charge, tourne,
 * imprime « 180 passed » et sort 0. Vert. C'est exactement la forme du défaut
 * que ce dépôt a déjà connue (« neuf coches vertes sous 0 passed »), et le
 * comptage est la seule chose qui la voit.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUE LE VERDICT REFUSE, ET POURQUOI DANS CET ORDRE
 *
 *   1. UN CODE DE SORTIE NON NUL. La suite sort 1 sur un cas rouge et 2 quand
 *      elle n'a rien lancé du tout. Les deux sont des refus, et un troisième
 *      code (139, 255) est un plantage, donc un refus aussi.
 *
 *   2. UNE SORTIE SANS TOTAL. C'est le point le plus important du fichier. Une
 *      suite qui fatale au milieu peut très bien sortir 0 (php sort 0 sur un
 *      `exit` implicite après un `WP_CLI::log`, et un tuyau coupé aussi). Si on
 *      lisait « pas de total » comme « zéro cas », zéro comparé à un plancher
 *      donnerait un refus par accident aujourd'hui et un faux vert le jour où
 *      quelqu'un abaisserait le plancher. « On n'a pas pu regarder » n'est pas
 *      « tout va bien » : le total absent est son propre refus, nommé.
 *
 *   3. UN TOTAL SOUS LE PLANCHER. Le plancher n'est pas une marge de confort :
 *      il vaut exactement le nombre mesuré, parce que ce nombre ne descend que
 *      de deux façons, une suite qui a cessé de se charger ou une suppression
 *      volontaire. La seconde mérite d'être écrite dans un commit, ce qui est
 *      précisément ce que ce refus force.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LE NOMBRE, MESURÉ ET NON SUPPOSÉ
 *
 * `npm run test:wp` le 5 septembre 2026 à 08:06, sur le miroir de développement :
 * « 241 passed », exit 0, 3 min 15 s. Le même soir, sur un miroir NEUF monté par
 * la séquence de `.github/workflows/ci.yml` : « 253 passed », exit 0, 3 min 36 s.
 * Les douze cas d'écart sont ceux qu'une autre séance a ajoutés à
 * `integration-lancement.php` entre les deux mesures.
 *
 * LE PLANCHER VAUT 241 ET NON 253, ce qui est un choix et pas un oubli : 241 est
 * le total que les deux arbres dépassent, donc le seul qui ne puisse pas rendre
 * ce travail rouge pour une raison qui n'est pas un défaut. Le prix de ce choix
 * est douze cas d'angle mort, et c'est exactement ce que `SUITES_MINIMUM`
 * ci-dessous ferme. Quand l'arbre cesse de bouger, remonter ce nombre au total
 * vert imprimé par la CI est une modification d'une ligne, et elle est
 * souhaitable.
 *
 * 241 est un nombre de CAS (`ts_it`), pas d'assertions : c'est le seul nombre
 * que la suite imprime, donc le seul qui vienne d'avoir fait tourner la chose
 * réelle. Pour mémoire, les douze fichiers contenaient ce soir-là 903 appels
 * d'assertion (`ts_assert`, `ts_eq`, `ts_eq_cents`) répartis dans 244 `ts_it`,
 * dont trois sont définis à l'intérieur d'un cas parent et ne comptent pas
 * séparément. Compter les assertions demanderait un second compteur à côté de
 * celui qui existe, et deux écritures d'une même règle finissent par diverger.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const ENTREE = join(ROOT, 'wp-plugins', 'teeshoop-core', 'tests', 'integration.php')

/*
 * Le plancher vit ICI et pas dans le fichier de travail de la CI, pour la même
 * raison que `ci.yml` appelle `ci.yml` depuis le déploiement : deux copies d'une
 * même règle divergent, et celle-ci a déjà divergé quatre fois dans ce dépôt.
 * `--plancher=` n'existe que pour casser la porte exprès et la voir rougir.
 */
const PLANCHER = 241

/**
 * Combien de fichiers `tests/integration.php` doit charger, au minimum.
 *
 * ── POURQUOI CE SECOND NOMBRE EXISTE, ET POURQUOI IL EST LE PLUS PRÉCIS ──────
 *
 * Le plancher ci-dessus est un filet à grosses mailles. Il ne peut pas être
 * réglé au nombre du jour sans devenir faux la semaine où quelqu'un ajoute ou
 * retire un cas : 241 est le dernier total vert mesuré sur les deux arbres de la
 * nuit du 5 septembre 2026, et le total réel de cette nuit-là est 253. Entre les
 * deux il reste douze cas d'angle mort, c'est-à-dire assez pour qu'une petite
 * suite (`concurrency.php` en a quatre, `integration-listing.php` huit) disparaisse
 * sans que le total descende sous le plancher.
 *
 * Ce compte-ci ferme exactement ce trou, et il le ferme À LA SOURCE plutôt que
 * par un proxy : le défaut qu'on redoute est qu'une des lignes
 * `require_once __DIR__ . '/integration-….php'` disparaisse, et c'est cette ligne
 * que l'on compte. Onze le 5 septembre 2026 (checkout, margin, lifecycle,
 * production, purchase, rgpd, listing, lancement, schema, gradient, concurrency).
 * Il ne bouge pas quand on écrit des cas, seulement quand on ajoute ou retire une
 * moitié de suite, ce qui est précisément l'événement qui mérite un commit.
 *
 * Chaque fichier nommé est aussi cherché sur le disque : un `require_once` qui
 * pointe sur un fichier absent est une erreur fatale à l'exécution, donc un
 * comptage qui ne regarderait que le texte du fichier d'entrée dirait « onze »
 * sur une suite qui ne démarre pas.
 */
const SUITES_MINIMUM = 11

const arg = (nom, defaut) => {
  const trouve = process.argv.find((a) => a.startsWith(`--${nom}=`))
  return trouve === undefined ? defaut : trouve.slice(nom.length + 3)
}
const plancher = Number(arg('plancher', PLANCHER))
if (!Number.isInteger(plancher) || plancher < 1) {
  console.error(`wp-suite ÉCHEC : --plancher=${arg('plancher', '')} n’est pas un entier positif.`)
  process.exit(2)
}

const SANS_ANSI = /\[[0-9;]*m/g

/**
 * Le verdict, PUR, pour que `--self-test` exerce le vrai chemin de décision et
 * non une copie. Rend { ok, code, dit, total }. `total` est `null` quand aucun
 * total n'a été imprimé, et ce `null` ne devient jamais un zéro.
 */
export function verdict(codeSortie, sortie, plancherAttendu) {
  const lignes = String(sortie).replace(SANS_ANSI, '').split('\n')
  const totaux = []
  for (const ligne of lignes) {
    // « 241 passed » et rien d'autre. La ligne d'échec, « 3 failed, 238 passed »,
    // ne correspond pas, et c'est voulu : un total ne se lit pas sur un run rouge.
    const m = /^(\d+) passed$/.exec(ligne.trim())
    if (m !== null) totaux.push(Number(m[1]))
  }
  const total = totaux.length === 0 ? null : totaux[totaux.length - 1]

  if (codeSortie !== 0) {
    const raison =
      codeSortie === 1
        ? 'au moins un cas est rouge'
        : codeSortie === 2
          ? 'la suite n’a lancé aucun cas'
          : 'la suite s’est arrêtée anormalement'
    return { ok: false, code: 1, total, dit: `la suite est sortie ${codeSortie} : ${raison}.` }
  }

  if (total === null) {
    return {
      ok: false,
      code: 1,
      total: null,
      dit:
        'la suite est sortie 0 sans imprimer de total. Une sortie tronquée n’est pas un ' +
        'comptage à zéro : on ne sait pas ce qui a tourné, donc rien ne passe.',
    }
  }

  if (total < plancherAttendu) {
    return {
      ok: false,
      code: 1,
      total,
      dit:
        `${total} cas au lieu de ${plancherAttendu} au minimum. La suite a maigri : soit un des ` +
        'onze require_once de tests/integration.php ne se charge plus, soit des cas ont été ' +
        'retirés. Si c’est voulu, baissez PLANCHER dans ce fichier et dites pourquoi dans le commit.',
    }
  }

  return { ok: true, code: 0, total, dit: `${total} cas, plancher ${plancherAttendu}.` }
}

/**
 * Les fichiers que le point d'entrée charge vraiment, et qui existent vraiment.
 *
 * Rend { trouves, manquants } ; `manquants` nomme un `require_once` qui pointe
 * sur un fichier absent, ce qui est une erreur fatale à l'exécution et non un
 * fichier en moins.
 */
export function suitesChargees(source, existe) {
  const trouves = []
  const manquants = []
  for (const m of String(source).matchAll(/require_once\s+__DIR__\s*\.\s*'\/([\w.-]+\.php)'/g)) {
    trouves.push(m[1])
    if (!existe(m[1])) manquants.push(m[1])
  }
  return { trouves, manquants }
}

// ---------------------------------------------------------------------------
// --self-test : la porte peut-elle encore refuser
// ---------------------------------------------------------------------------

if (process.argv.includes('--self-test')) {
  const vert = '  241 passed'
  const cas = [
    ['une suite saine passe', () => verdict(0, `${vert}\n`, 241).ok === true],
    ['un cas rouge refuse', () => verdict(1, '  3 failed, 238 passed\n', 241).ok === false],
    ['« aucun cas lancé » (sortie 2) refuse', () => verdict(2, '  no tests ran\n', 241).ok === false],
    ['un plantage (sortie 255) refuse', () => verdict(255, '', 241).ok === false],
    [
      'une sortie tronquée sortie 0 refuse, et ne se lit pas comme zéro cas',
      () => {
        const v = verdict(0, 'PHP Fatal error: Allowed memory size exhausted\n', 241)
        return v.ok === false && v.total === null
      },
    ],
    ['un total sous le plancher refuse', () => verdict(0, '  240 passed\n', 241).ok === false],
    ['un total au plancher passe', () => verdict(0, '  241 passed\n', 241).ok === true],
    ['un total au-dessus du plancher passe', () => verdict(0, '  312 passed\n', 241).ok === true],
    [
      'la ligne d’échec ne fournit jamais le total',
      () => verdict(0, '  3 failed, 238 passed\n', 100).total === null,
    ],
    [
      'les couleurs du terminal ne cachent pas le total',
      () => verdict(0, '[32m  241 passed[0m\n', 241).total === 241,
    ],
    [
      'les require_once du point d’entrée sont comptés',
      () => {
        const src = [
          "require_once __DIR__ . '/integration-checkout.php';",
          "require_once __DIR__ . '/concurrency.php';",
        ].join('\n')
        return suitesChargees(src, () => true).trouves.length === 2
      },
    ],
    [
      'un require_once retiré fait baisser le compte',
      () => suitesChargees("require_once __DIR__ . '/integration-checkout.php';", () => true).trouves.length === 1,
    ],
    [
      'un require_once vers un fichier absent est nommé, pas ignoré',
      () => {
        const r = suitesChargees("require_once __DIR__ . '/integration-parti.php';", () => false)
        return r.trouves.length === 1 && r.manquants[0] === 'integration-parti.php'
      },
    ],
  ]
  let rouges = 0
  for (const [nom, f] of cas) {
    let ok = false
    try {
      ok = f() === true
    } catch (e) {
      ok = false
      nom.length // garde la variable utilisée si le lint le demande
    }
    if (!ok) {
      rouges += 1
      console.error(`  MANQUE  ${nom}`)
    } else {
      console.log(`  tenu    ${nom}`)
    }
  }
  console.log('')
  if (cas.length === 0) {
    console.error('wp-suite --self-test : aucun cas. Un vert ici ne voudrait rien dire.')
    process.exit(2)
  }
  if (rouges > 0) {
    console.error(`wp-suite --self-test ÉCHEC : ${rouges} sur ${cas.length}`)
    process.exit(1)
  }
  console.log(`wp-suite --self-test OK : ${cas.length} cas, le verdict refuse encore.`)
  process.exit(0)
}

// ---------------------------------------------------------------------------
// la vraie exécution
// ---------------------------------------------------------------------------

/*
 * La MÊME commande que `npm run test:wp`. Elle est écrite ici plutôt qu'appelée
 * par `npm run` pour une raison mesurable : npm remplace le code de sortie de
 * l'enfant par le sien dans certains cas d'erreur, et ce fichier a besoin du
 * code exact (1 rouge, 2 rien lancé) pour dire lequel des trois refus s'applique.
 */
/*
 * LE POINT D'ENTRÉE CHARGE-T-IL ENCORE SES ONZE MOITIÉS. Contrôlé AVANT de
 * lancer docker, parce que c'est instantané et parce qu'une suite amputée n'a
 * pas besoin de trois minutes pour être refusée.
 */
let entree
try {
  entree = readFileSync(ENTREE, 'utf8')
} catch (e) {
  console.error(`wp-suite ÉCHEC : ${ENTREE} est illisible (${e.message}).`)
  process.exit(2)
}
const suites = suitesChargees(entree, (nom) => existsSync(join(dirname(ENTREE), nom)))
if (suites.manquants.length > 0) {
  console.error(
    `wp-suite ÉCHEC : integration.php charge ${suites.manquants.join(', ')}, qui n’existe pas. ` +
      'La suite fatalerait au chargement.',
  )
  process.exit(1)
}
if (suites.trouves.length < SUITES_MINIMUM) {
  console.error(
    `wp-suite ÉCHEC : integration.php ne charge plus que ${suites.trouves.length} moitié(s) de suite ` +
      `au lieu de ${SUITES_MINIMUM} (${suites.trouves.join(', ') || 'aucune'}). ` +
      'Un require_once retiré laisse la suite verte et muette sur ce qu’elle ne teste plus. ' +
      'Si c’est voulu, baissez SUITES_MINIMUM dans ce fichier et dites pourquoi dans le commit.',
  )
  process.exit(1)
}
console.log(`wp-suite : ${suites.trouves.length} moitié(s) de suite chargées par integration.php.`)

const COMMANDE = [
  'compose',
  '-f',
  'wp-local/docker-compose.yml',
  'run',
  '--rm',
  '-T',
  'wpcli',
  'eval-file',
  'wp-content/plugins/teeshoop-core/tests/integration.php',
]

const enfant = spawn('docker', COMMANDE, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
let sortie = ''
enfant.stdout.on('data', (d) => {
  sortie += d
  process.stdout.write(d)
})
enfant.stderr.on('data', (d) => {
  // Le stderr de docker compose (« Container … Running ») n'entre pas dans le
  // comptage, mais il doit rester lisible quand le travail échoue.
  process.stderr.write(d)
})
enfant.on('error', (e) => {
  console.error(`wp-suite ÉCHEC : docker n’a pas pu être lancé (${e.message}).`)
  console.error('  Le miroir se monte avec « npm run wp:up ».')
  process.exit(2)
})
enfant.on('close', (code) => {
  const v = verdict(code === null ? 255 : code, sortie, plancher)
  console.log('')
  if (!v.ok) {
    console.error(`wp-suite ÉCHEC : ${v.dit}`)
    process.exit(v.code)
  }
  console.log(`wp-suite OK : ${v.dit}`)
})
