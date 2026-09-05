#!/usr/bin/env node
/**
 * HYPOTHESES GUARD: the register of assumed values, and the code, must agree.
 *
 * WHY. The associate has not answered `QUESTIONS-ASSOCIE.md`, and on 18/08/2026
 * we decided to build the remaining sessions on the written default hypotheses
 * rather than stop. That decision is only recoverable under one condition: an
 * assumed value must have exactly ONE place in the code, so that a late answer
 * is a setting to change and not three months of archaeology. `docs/hypotheses.json`
 * is that register. Nothing enforced it, and a register nobody enforces is
 * documentation, which drifts.
 *
 * WHAT IT CHECKS, six things:
 *
 *   1. RESOLVES.   Every `home` and every `mirror` still points at something
 *                  that exists. A value whose home was renamed has no home.
 *   2. AGREES.     Home and mirrors hold the same value. Not by comparing
 *                  strings: by RUNNING both implementations. The PHP config is
 *                  obtained by calling `Pricing::default_config()` in php, the
 *                  studio's table by bundling the module with esbuild and
 *                  importing it. A test that re-implements what it checks
 *                  proves only that it agrees with itself.
 *   3. NO SECOND COPY.  The value does not appear as a bare literal anywhere
 *                  outside its home, its mirrors and its declared allow-list.
 *                  Each declared literal must also be FOUND at least once in
 *                  those files, so a mistyped literal fails instead of passing
 *                  silently: "nothing found" and "nothing looked" are different
 *                  results.
 *   4. NOTHING FORGOTTEN.  Every question marked Bloquant in
 *                  `QUESTIONS-ASSOCIE.md` has a row, or an explicit
 *                  `not_applicable` entry with a reason. This is the one that
 *                  makes forgetting impossible, and it is the most valuable of
 *                  the five: the other four protect values we remembered.
 *  4b. THE SENTENCE AGREES TOO. The French statement a row displays states the
 *                  value it describes, derived from the value rather than typed
 *                  beside it. It is the only thing the shop's admin screen
 *                  renders, so a register that drifts from the code lies to the
 *                  one person who could correct it.
 *   5. SAID OUT LOUD.  Every `assumption` that reaches a customer carries the
 *                  French label it is displayed with, and that label is really
 *                  present in a shipped string table. A number a customer reads
 *                  with no French wording around it is a number nobody can
 *                  question.
 *
 * AND ONE PROJECTION. WordPress cannot read `docs/`, so the shop carries a
 * filtered copy at `wp-plugins/teeshoop-core/data/hypotheses.php`, written by
 * `--write` and checked on every run (same pattern as `gen-garment-data.mjs`).
 * FILTERED IS THE POINT, not the plumbing: only rows whose home is inside the
 * plugin cross over, so film economics and purchase-cost vocabulary never enter
 * a directory `scripts/php-guard.mjs` scans. It is PHP rather than JSON because
 * that directory answers HTTP; see the note above `SHOP_COPY`.
 *
 * IT NEVER PRINTS THE VALUE IT PROTECTS when a comparison fails, for the reason
 * `php-guard.mjs` gives: CI logs can be public, and a guard that fails by
 * echoing the number has published it. Ids, paths and the name of the check are
 * enough to find it.
 *
 * Usage:
 *   node scripts/hypotheses-guard.mjs             # check
 *   node scripts/hypotheses-guard.mjs --write     # rewrite the shop's copy
 *   node scripts/hypotheses-guard.mjs --self-test # prove each check can fail
 *
 * Exit: 0 clean · 1 the register and the code disagree · 2 the scan is not
 *       trustworthy (nothing read, no question parsed, no string table found,
 *       php or esbuild unavailable, or the self-test did not fire).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const LEDGER = join(ROOT, 'docs/hypotheses.json')
const QUESTIONS = join(ROOT, 'QUESTIONS-ASSOCIE.md')
/*
 * The shop's copy is PHP, not JSON, and that is a security decision.
 *
 * `wp-content/plugins/` is served by URL. A JSON file here would answer 200 to
 * anyone who asked for it and would tell them that the shop enforces no order
 * minimum, that no margin rate is set, that we buy without a negotiated
 * discount and that the published prices are demonstration figures. None of
 * that is for the public, and an unguessable path is not an access control:
 * this project already learned it when `tests/run.php` answered 200 with the
 * floor-price rules in it. A PHP file guarded on ABSPATH renders nothing when
 * fetched directly, on any server, with no .htaccess to get wrong.
 */
const SHOP_COPY = join(ROOT, 'wp-plugins/teeshoop-core/data/hypotheses.php')
const PLUGIN_INCLUDES = join(ROOT, 'wp-plugins/teeshoop-core/includes')

const WRITE = process.argv.includes('--write')
const SELF_TEST = process.argv.includes('--self-test')

/*
 * Where a second copy of a value would hide. `docs/` is excluded because the
 * register itself lives there and quotes every literal it protects; the shop's
 * projection is excluded for the same reason plus one more: French prose writes
 * a thousand as "1 250", and a scan for 250 would find the space.
 *
 * Excluding a generated file is safe in a way excluding a hand-written one
 * would not be: the projection is rewritten from the register and compared byte
 * for byte on every run, so it cannot hold a value the register does not.
 */
const SCAN_DIRS = ['src', 'worker', 'wp-plugins', 'wp-themes', 'scripts']
const SCAN_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.php', '.json'])
/*
 * `editeur` REJOINT `dist` ET `node_modules`, ET POUR LA MÊME RAISON.
 *
 * `wp-plugins/teeshoop-core/assets/editeur/` est la SORTIE DE CONSTRUCTION de
 * l'éditeur natif, versionnée parce qu'un greffon WordPress se déploie en
 * copiant son répertoire. Ce n'est pas un endroit où une valeur habite : c'est
 * la même valeur, minifiée, déjà comptée dans `src/native/`. La laisser dans le
 * parcours transformait chaque littéral de la source en trois violations dans
 * le paquet, et la trace pointait sur `editeur.js:306`, une colonne que
 * personne ne peut corriger.
 */
const SCAN_SKIP = new Set(['node_modules', 'dist', '.git'])
/**
 * Les répertoires de SORTIE DE CONSTRUCTION, par leur chemin complet.
 *
 * `wp-plugins/teeshoop-core/assets/editeur/` est le paquet construit de
 * l'éditeur natif, versionné parce qu'un greffon WordPress se déploie en copiant
 * son répertoire. Ce n'est pas un endroit où une valeur habite : c'est la même
 * valeur, minifiée, déjà comptée dans `src/native/`. Le laisser dans le parcours
 * transformait chaque littéral de la source en trois violations dans le paquet,
 * et la trace pointait sur une colonne que personne ne peut corriger.
 *
 * PAR LE CHEMIN ET PAS PAR LE NOM. La première version ajoutait `'editeur'` à
 * `SCAN_SKIP`, qui compare `entry.name` : n'importe quel futur répertoire
 * `src/editeur/` ou `includes/editeur/` aurait cessé d'être contrôlé en
 * silence. Trouvé par la passe adversariale du 5 septembre 2026.
 */
const SCAN_SKIP_PATHS = new Set(['wp-plugins/teeshoop-core/assets/editeur'])
const SCAN_EXCLUDE_FILES = new Set(['wp-plugins/teeshoop-core/data/hypotheses.php'])

/**
 * The string tables a customer's French actually comes from.
 *
 * Listed as roots rather than files so a new modal's table is covered the day
 * it is added; a label that lives nowhere is the failure this check exists for,
 * and an incomplete list would fail it for the wrong reason.
 */
const STRING_TABLE_ROOTS = [
  'src/i18n',
  'src/app/modals',
  'wp-plugins/teeshoop-core/templates',
  'wp-plugins/teeshoop-core/includes',
  // Added in session 09. The theme is where most of what a customer READS now
  // lives, so a `label_fr` that only exists there has to count as said out loud.
  'wp-themes/teeshoop',
  // Added in session 12. `data/copy.php` is the editorial copy of thirteen pages
  // and `data/cgv/*.php` are the dated conditions of sale: both are shipped
  // French a customer reads, and a clause of a contract is about as said out
  // loud as a sentence gets. The directory was outside this list only because
  // nothing had needed it yet.
  'wp-plugins/teeshoop-core/data',
]
const STRING_TABLE_EXT = new Set(['.ts', '.tsx', '.php'])

const STATUSES = new Set(['assumption', 'answered', 'refused'])
const LEVELS = new Set(['bloquant', 'important', 'utile', 'secondaire'])
const REACHES = new Set(['customer', 'supplier', 'printer', 'operator', 'internal'])
const COSTS = new Set(['reglage', 'reglage et remesure', 'on refait'])
/*
 * WHO DECIDED, when the associate could not be asked.
 *
 * A CLOSED SET, and « associe » is deliberately not in it. The whole value of
 * `decided_by` is that it cannot be mistaken for `answered`; a row reading
 * `decided_by: "l'associé"` would be the same falsification by another route,
 * with the added insult of looking like a citation.
 */
const DECIDERS = new Set(['equipe'])

// ─────────────────────────────────────────────────────────────────────────────
// Reading the tree

function walk(dir, out = [], exts = SCAN_EXT) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (SCAN_SKIP.has(entry.name)) continue
    const p = join(dir, entry.name)
    if (entry.isDirectory() && SCAN_SKIP_PATHS.has(rel(p))) continue
    if (entry.isDirectory()) walk(p, out, exts)
    else if (exts.has(p.slice(p.lastIndexOf('.')))) out.push(p)
  }
  return out
}

const rel = (abs) => relative(ROOT, abs).split('\\').join('/')

/**
 * readFileSync and indexOf, never grep: a file with a NUL byte makes GNU grep
 * suppress its output entirely, which reads as a pass. Measured in
 * scripts/bundle-guard.mjs.
 */
const textOf = (abs) => readFileSync(abs, 'utf8')

// ─────────────────────────────────────────────────────────────────────────────
// References
//
// A reference names ONE place a value lives, in a form that greps:
//
//   php:Teeshoop\Core\Pricing::default_config()#garments.tee.base_ht
//   phpconst:Teeshoop\Core\Quote::KEEP_DAYS
//   ts:src/lib/some/module.ts#EXPORTED.path.to.value
//   json:wp-plugins/teeshoop-core/data/garments.json#garments.tee.pricedSize
//   anchor:src/lib/ink.ts#sideArtworkSqCm
//   doc:docs/ROADMAP.md#17 € HT/mètre linéaire
//
// The path after # may sum several fields with +, because a value a human
// answers is not always a field: a printed tee costs base + first side, and it
// is that sum the studio mirrors.

function parseRef(ref) {
  const colon = ref.indexOf(':')
  if (colon === -1) return { error: 'no kind prefix' }
  const kind = ref.slice(0, colon)
  const rest = ref.slice(colon + 1)
  const hash = rest.indexOf('#')
  const target = hash === -1 ? rest : rest.slice(0, hash)
  const path = hash === -1 ? '' : rest.slice(hash + 1)
  if (kind === 'php' || kind === 'phpconst') {
    const sep = target.indexOf('::')
    if (sep === -1) return { error: 'expected Class::member' }
    return {
      kind,
      cls: target.slice(0, sep),
      member: target.slice(sep + 2).replace(/\(\)$/, ''),
      path,
      file: null,
    }
  }
  return { kind, file: target, path }
}

/** Walk a dotted path into an already-loaded value. */
function walkPath(root, path) {
  if (path === '') return { ok: true, value: root }
  let cur = root
  for (const seg of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') {
      return { ok: false, why: `path stops before "${seg}"` }
    }
    const key = /^\d+$/.test(seg) ? Number(seg) : seg
    if (!(key in cur)) return { ok: false, why: `no "${seg}"` }
    cur = cur[key]
  }
  return { ok: true, value: cur }
}

function readPath(root, expr) {
  const parts = expr.split('+').map((p) => p.trim())
  if (parts.length === 1) return walkPath(root, parts[0])
  let total = 0
  for (const part of parts) {
    const got = walkPath(root, part)
    if (!got.ok) return got
    if (typeof got.value !== 'number') return { ok: false, why: `"${part}" is not a number to sum` }
    total += got.value
  }
  return { ok: true, value: total }
}

// ─────────────────────────────────────────────────────────────────────────────
// Extractors. Each returns the ROOT value; the path is walked afterwards, in
// one place, so every kind indexes the same way.

/**
 * Every PHP root, in one process.
 *
 * The plugin's classes are required with ABSPATH merely DEFINED: they guard on
 * its existence and none of them calls a WordPress function at load time, which
 * is the same property `tests/run.php` relies on. So the register can read the
 * real config without a database, and CI needs php and nothing else.
 */
function loadPhpRoots(specs) {
  if (specs.length === 0) return { ok: true, roots: {} }
  const dir = mkdtempSync(join(tmpdir(), 'teeshoop-hyp-'))
  const driver = join(dir, 'driver.php')
  const input = join(dir, 'refs.json')
  try {
    writeFileSync(input, JSON.stringify(specs))
    writeFileSync(
      driver,
      `<?php
declare(strict_types=1);
define('ABSPATH', __DIR__ . '/');
define('TEESHOOP_TEST', 1);
foreach (glob($argv[1] . '/*.php') as $f) { require_once $f; }
$out = [];
foreach (json_decode(file_get_contents($argv[2]), true) as $spec) {
    $key = $spec['key'];
    $cls = $spec['cls'];
    if (!class_exists($cls)) { $out[$key] = ['error' => 'no such class']; continue; }
    $r = new ReflectionClass($cls);
    if ($spec['kind'] === 'phpconst') {
        if (!$r->hasConstant($spec['member'])) { $out[$key] = ['error' => 'no such constant']; continue; }
        $out[$key] = ['value' => $r->getConstant($spec['member'])];
        continue;
    }
    if (!$r->hasMethod($spec['member'])) { $out[$key] = ['error' => 'no such method']; continue; }
    $m = $r->getMethod($spec['member']);
    if (!$m->isStatic()) { $out[$key] = ['error' => 'method is not static']; continue; }
    if ($m->getNumberOfRequiredParameters() > 0) { $out[$key] = ['error' => 'method needs arguments']; continue; }
    $m->setAccessible(true);
    $out[$key] = ['value' => $m->invoke(null)];
}
echo json_encode($out, JSON_UNESCAPED_UNICODE);
`,
    )
    const stdout = execFileSync('php', [driver, PLUGIN_INCLUDES, input], { encoding: 'utf8' })
    return { ok: true, roots: JSON.parse(stdout) }
  } catch (e) {
    return { ok: false, why: `php could not read the plugin: ${e.message.split('\n')[0]}` }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Every TypeScript root, bundled and imported.
 *
 * Imported rather than parsed, and imported rather than serialised: the
 * studio's last area tier is `Infinity`, which is a real value in JavaScript
 * and `null` in JSON. A comparison run through JSON would quietly agree with a
 * bounded tier.
 */
async function loadTsRoots(files) {
  if (files.length === 0) return { ok: true, roots: {} }
  let build
  try {
    ;({ build } = await import('esbuild'))
  } catch (e) {
    return { ok: false, why: `esbuild is not available: ${e.message.split('\n')[0]}` }
  }
  const dir = mkdtempSync(join(tmpdir(), 'teeshoop-hyp-ts-'))
  try {
    const roots = {}
    for (const [i, file] of files.entries()) {
      const abs = join(ROOT, file)
      if (!existsSync(abs)) {
        roots[file] = { error: 'no such file' }
        continue
      }
      const out = join(dir, `m${i}.mjs`)
      await build({
        entryPoints: [abs],
        outfile: out,
        bundle: true,
        format: 'esm',
        platform: 'node',
        logLevel: 'silent',
        alias: { '@': join(ROOT, 'src') },
      })
      roots[file] = { value: { ...(await import(pathToFileURL(out).href)) } }
    }
    return { ok: true, roots }
  } catch (e) {
    return { ok: false, why: `a studio module would not bundle: ${e.message.split('\n')[0]}` }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function loadJsonRoots(files) {
  const roots = {}
  for (const file of files) {
    const abs = join(ROOT, file)
    if (!existsSync(abs)) {
      roots[file] = { error: 'no such file' }
      continue
    }
    try {
      roots[file] = { value: JSON.parse(textOf(abs)) }
    } catch (e) {
      roots[file] = { error: `not valid JSON: ${e.message}` }
    }
  }
  return roots
}

// ─────────────────────────────────────────────────────────────────────────────
// Relations. How a mirror is allowed to write the same value differently.
//
// Named and few on purpose. A general expression language here would be a
// second place to hide a divergence; four named shapes are readable in the
// register and each is four lines here.

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const RELATIONS = {
  equal: (home, mirror) => deepEqual(home, mirror),

  /** The shop keeps integer cents; the studio's demo table is written in units. */
  'eur-to-cents': (home, mirror) =>
    typeof mirror === 'number' && typeof home === 'number' && Math.round(mirror * 100) === home,

  /** `[{max_sq_cm, add_ht}]` against `[{maxSqCm, addUsd}]`, unbounded as Infinity. */
  'area-tiers': (home, mirror) => {
    if (!Array.isArray(home) || !Array.isArray(mirror) || home.length !== mirror.length) return false
    return home.every((tier, i) => {
      const bound = tier.max_sq_cm === null ? Infinity : tier.max_sq_cm
      return bound === mirror[i].maxSqCm && Math.round(mirror[i].addUsd * 100) === tier.add_ht
    })
  },

  /** `[{min_qty, rate}]` against `[{minQty, discount}]`. */
  'qty-breaks': (home, mirror) => {
    if (!Array.isArray(home) || !Array.isArray(mirror) || home.length !== mirror.length) return false
    return home.every((b, i) => b.min_qty === mirror[i].minQty && b.rate === mirror[i].discount)
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// The register

function loadLedger() {
  if (!existsSync(LEDGER)) return { ok: false, why: `${rel(LEDGER)} does not exist` }
  let data
  try {
    data = JSON.parse(textOf(LEDGER))
  } catch (e) {
    return { ok: false, why: `${rel(LEDGER)} is not valid JSON: ${e.message}` }
  }
  if (!Array.isArray(data.entries) || data.entries.length === 0) {
    return { ok: false, why: `${rel(LEDGER)} holds no entries; a register that lists nothing proves nothing` }
  }
  return { ok: true, data }
}

/** Shape errors are failures of the register, not of the scan: exit 1. */
function validateShape(data) {
  const bad = []
  const seen = new Set()
  for (const e of data.entries) {
    const id = e.id ?? '(no id)'
    if (!e.id || !/^H-Q\d{2}-[A-Z0-9-]+$/.test(e.id)) bad.push(`${id}: id must look like H-Q04-FR-RATE`)
    if (seen.has(e.id)) bad.push(`${id}: duplicate id`)
    seen.add(e.id)
    if (!/^Q\d{2}$/.test(e.question ?? '')) bad.push(`${id}: question must look like Q04`)
    if (!LEVELS.has(e.level)) bad.push(`${id}: level must be one of ${[...LEVELS].join(', ')}`)
    if (!STATUSES.has(e.status)) bad.push(`${id}: status must be one of ${[...STATUSES].join(', ')}`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.since ?? '')) bad.push(`${id}: since must be YYYY-MM-DD`)
    /*
     * `answered` is about the ASSOCIATE, `status` is about the CODE, and they
     * are not the same axis. A row he settled by asking for nothing to be built
     * stays `refused` and carries a date (H-Q42-MARGE-TEXTILE-NU); a row we
     * assume and he never mentioned carries no date at all. The launch gate
     * reads the date, not the word, because "he answered" is what turns a guess
     * into a fact and `refused` is a shape, not an answer.
     */
    if (e.answered !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.answered)) bad.push(`${id}: answered must be YYYY-MM-DD`)
      if (!e.answer_fr) bad.push(`${id}: answered with no answer_fr saying what he decided`)
    }
    if (e.status === 'answered' && e.answered === undefined) {
      bad.push(`${id}: status answered with no date; a confirmation nobody can point at is a conversation`)
    }

    /*
     * A DECISION TAKEN IN HIS PLACE IS NOT AN ANSWER, and the register has to be
     * able to say so without borrowing his field.
     *
     * The night sessions of September 2026 decide alone, by instruction: nobody
     * is reachable and stopping is not on the table. Those decisions have to be
     * recorded somewhere, and the only date field that existed was `answered`,
     * which `launch-gate.mjs` reads as « he confirmed it ». Writing one there
     * would have turned every decision we took into a decision he took, and
     * unblocked the launch gate on our own say-so: the one thing that separates
     * an unconfirmed figure from a customer.
     *
     * So: three fields of our own, and the two sets are mutually exclusive by
     * this check. A row he has since answered drops `decided_by`, because the
     * answer supersedes the decision and keeping both invites the reader to
     * wonder which one is in force.
     */
    const decided = ['decided_by', 'decided_on', 'decided_why'].filter((k) => e[k] !== undefined)
    if (decided.length > 0 && decided.length < 3) {
      const missing = ['decided_by', 'decided_on', 'decided_why'].filter((k) => e[k] === undefined)
      bad.push(`${id}: carries ${decided.join(', ')} but not ${missing.join(', ')}; a decision with no author, no date or no reason is an edit`)
    }
    if (e.decided_by !== undefined && !DECIDERS.has(e.decided_by)) {
      bad.push(`${id}: decided_by must be one of ${[...DECIDERS].join(', ')}`)
    }
    if (e.decided_on !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(e.decided_on)) {
      bad.push(`${id}: decided_on must be YYYY-MM-DD`)
    }
    if (e.decided_why !== undefined && String(e.decided_why).trim().length < 20) {
      bad.push(`${id}: decided_why must say why, not just that`)
    }
    if (e.answered !== undefined && e.decided_by !== undefined) {
      bad.push(
        `${id}: carries both answered and decided_by. The first is the associate and the second is us; ` +
          'a row that claims both tells the launch gate he confirmed a decision we took.',
      )
    }
    if (!e.statement_fr) bad.push(`${id}: statement_fr is empty`)
    if (!e.home) bad.push(`${id}: no home`)
    if (!Array.isArray(e.mirrors)) bad.push(`${id}: mirrors must be a list`)
    if (!Array.isArray(e.reaches) || e.reaches.length === 0) bad.push(`${id}: reaches is empty`)
    for (const r of e.reaches ?? []) if (!REACHES.has(r)) bad.push(`${id}: unknown reach "${r}"`)
    if (!Array.isArray(e.derives)) bad.push(`${id}: derives must be a list`)
    if (!Array.isArray(e.sessions)) bad.push(`${id}: sessions must be a list`)
    if (!COSTS.has(e.cost_if_late)) bad.push(`${id}: cost_if_late must be one of ${[...COSTS].join(' | ')}`)
    if (!Array.isArray(e.literals)) bad.push(`${id}: literals must be a list (empty needs literals_why)`)
    if (Array.isArray(e.literals) && e.literals.length === 0 && !e.literals_why) {
      bad.push(`${id}: no literals to hunt and no literals_why saying which value is unscannable and why`)
    }
  }
  for (const na of data.not_applicable ?? []) {
    if (!/^Q\d{2}$/.test(na.question ?? '')) bad.push(`not_applicable: question must look like Q05`)
    if (!na.why) bad.push(`not_applicable ${na.question}: no reason`)
  }
  return bad
}

// ─────────────────────────────────────────────────────────────────────────────
// The checks. Each returns a list of failures; an empty list is a pass.

/** 1 + 2: every reference resolves, and home and mirrors hold the same value. */
function checkResolvesAndAgrees(entries, roots, skipped = []) {
  const fails = []
  const resolve = (ref) => {
    const parsed = parseRef(ref)
    if (parsed.error) return { ok: false, why: parsed.error }
    if (parsed.kind === 'anchor' || parsed.kind === 'doc') {
      const abs = join(ROOT, parsed.file)
      if (!existsSync(abs)) return { ok: false, why: 'no such file' }
      const needle = parsed.path
      if (needle === '') return { ok: false, why: 'no anchor to look for' }
      if (!textOf(abs).includes(needle)) return { ok: false, why: 'the anchor is no longer in the file' }
      return { ok: true, value: null, presenceOnly: true }
    }
    const key = parsed.kind === 'php' || parsed.kind === 'phpconst' ? `${parsed.cls}::${parsed.member}` : parsed.file
    const root = roots[key]
    if (!root) return { ok: false, why: 'not loaded' }
    if (root.error) return { ok: false, why: root.error }
    return readPath(root.value, parsed.path)
  }

  for (const entry of entries) {
    const home = resolve(entry.home)
    if (!home.ok) {
      fails.push({ check: 'resolves', id: entry.id, where: entry.home, why: home.why })
      continue
    }
    for (const mirror of entry.mirrors) {
      const got = resolve(mirror.ref)
      if (!got.ok) {
        fails.push({ check: 'resolves', id: entry.id, where: mirror.ref, why: got.why })
        continue
      }
      if (home.presenceOnly || got.presenceOnly) {
        // An anchor has no value to compare, so the declared relation cannot
        // run. Counted and printed rather than passed over: a comparison that
        // silently did not happen reads exactly like one that succeeded.
        skipped.push(`${entry.id} -> ${mirror.ref}`)
        continue
      }
      const relation = mirror.relation ?? 'equal'
      const fn = RELATIONS[relation]
      if (!fn) {
        fails.push({ check: 'agrees', id: entry.id, where: mirror.ref, why: `unknown relation "${relation}"` })
        continue
      }
      if (!fn(home.value, got.value)) {
        // Never the two values: a CI log can be public.
        fails.push({ check: 'agrees', id: entry.id, where: mirror.ref, why: `differs from its home under "${relation}"` })
      }
    }
  }
  return fails
}

/**
 * 2b: the sentence agrees with the value it describes.
 *
 * `statement_fr` is the ONLY thing the shop's admin screen renders, and it
 * carries the money in French prose: "14,50 EUR HT ... 9,50 EUR de textile nu".
 * Nothing compared it with the value, so the register could go on telling an
 * operator a price the shop stopped charging, which is the exact failure the
 * whole session exists to prevent, committed by the record of it.
 *
 * A row declares which fragments of its sentence ARE the value and how they are
 * written; the guard derives each one from the extracted value and requires the
 * derivation to match the fragment AND the fragment to be in the sentence. Rows
 * whose statement carries no amount declare nothing and are counted in the
 * summary, like every other narrowing.
 */
function checkStatement(entries, roots) {
  const fails = []
  for (const entry of entries) {
    for (const amount of entry.statement_amounts ?? []) {
      const parsed = parseRef(entry.home)
      const key =
        parsed.kind === 'php' || parsed.kind === 'phpconst' ? `${parsed.cls}::${parsed.member}` : parsed.file
      const root = roots[key]
      if (!root || root.error) {
        fails.push({ check: 'statement', id: entry.id, where: entry.home, why: 'cannot read the value the sentence claims' })
        continue
      }
      const got = readPath(root.value, amount.from)
      if (!got.ok) {
        fails.push({ check: 'statement', id: entry.id, where: amount.from, why: got.why })
        continue
      }
      const written = frenchAmount(got.value, amount.as)
      if (written === null) {
        fails.push({ check: 'statement', id: entry.id, where: amount.from, why: `cannot write that value as "${amount.as}"` })
        continue
      }
      if (loose(written) !== loose(amount.text)) {
        // The derived form and the declared fragment are both about the same
        // value, so printing neither keeps the rule of never echoing it.
        fails.push({ check: 'statement', id: entry.id, where: amount.from, why: 'the value does not write itself the way the row says it does' })
        continue
      }
      /*
       * `text` is the number alone, because that is what the formatter can
       * produce. `in` is the fragment the sentence must carry around it, which
       * is what stops a two-digit amount from being satisfied by the same two
       * digits sitting inside a larger number elsewhere in the sentence.
       */
      const fragment = amount.in ?? amount.text
      if (!loose(fragment).includes(loose(amount.text))) {
        fails.push({ check: 'statement', id: entry.id, where: amount.from, why: 'the declared fragment does not contain the amount it is supposed to carry' })
        continue
      }
      if (!loose(entry.statement_fr).includes(loose(fragment))) {
        fails.push({ check: 'statement', id: entry.id, where: 'statement_fr', why: 'the sentence no longer contains the amount it is supposed to state' })
      }
    }
  }
  return fails
}

/** Spaces are typographic here and ordinary there; compare on the meaning. */
const loose = (t) => String(t).replace(/[\u00a0\u202f\u2009]/g, ' ').replace(/\s+/g, ' ').trim()

/** French thousands, French decimal comma, and no trailing zeros on a rate. */
function frenchNumber(value, decimals) {
  const fixed = Math.abs(value).toFixed(decimals)
  const [whole, frac] = fixed.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f')
  return (value < 0 ? '-' : '') + (frac ? `${grouped},${frac}` : grouped)
}

function frenchAmount(value, as) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  switch (as) {
    // Integer cents, which is how every payable amount is stored.
    case 'eur':
      return `${frenchNumber(value / 100, 2)} EUR`
    // A rate in [0, 1], written the way a French reader meets it.
    case 'pct':
      return `${frenchNumber(value * 100, 2).replace(/,?0+$/, '')} %`
    case 'int':
      return frenchNumber(value, 0)
    default:
      return null
  }
}

/** 3: no second copy of the value anywhere the guard can see. */
function checkNoSecondCopy(entries, files) {
  const fails = []
  const byPath = new Map(files.map((f) => [rel(f), f]))

  for (const entry of entries) {
    if (entry.literals.length === 0) continue
    const allowed = new Set([
      ...refFiles(entry.home),
      ...entry.mirrors.flatMap((m) => refFiles(m.ref)),
      ...(entry.literal_allow ?? []),
    ])
    /*
     * A scope narrows WHERE a value is hunted, never whether.
     *
     * 600 is a price in cents here and a pixel, a delay and a font size
     * elsewhere; hunting it repository-wide produces seventeen hits, none of
     * them money, and an exemption list longer than the rule. Scoping it to the
     * directories where a second PRICE could plausibly be written keeps the
     * check able to fire on the thing it protects. The scope is printed in the
     * summary, because a check that quietly looks in fewer places reads like a
     * check that found nothing.
     */
    const scope = entry.literal_scope ?? []
    /*
     * "Found at home" counts hits in the HOME and its MIRRORS only, never in the
     * allow-list. Counting the allow-list too meant a mistyped literal could be
     * kept alive by a test fixture that happens to contain the same digits: the
     * check that exists to stop "nothing found" reading as "nothing wrong" would
     * itself have been satisfied by the wrong file.
     */
    const homes = new Set([...refFiles(entry.home), ...entry.mirrors.flatMap((m) => refFiles(m.ref))])
    /*
     * Counted across the row, not per literal.
     *
     * A value can have more than one written form and the home holds only one
     * of them: H-Q17-TVA declares the fraction the price config keeps and the
     * four-decimal percentage WooCommerce keeps, and the second is nowhere near
     * Pricing.php by design. What must be true is that the row describes
     * something real, which is one form found where the row says it lives.
     */
    let foundAtHome = 0
    for (const literal of entry.literals) {
      const re = literalRegex(literal)
      for (const [path, abs] of byPath) {
        if (scope.length > 0 && !scope.some((prefix) => path.startsWith(prefix)) && !allowed.has(path)) continue
        const hits = [...textOf(abs).matchAll(re)]
        if (hits.length === 0) continue
        if (allowed.has(path)) {
          if (homes.has(path)) foundAtHome += hits.length
          continue
        }
        const text = textOf(abs)
        for (const hit of hits) {
          fails.push({
            check: 'second-copy',
            id: entry.id,
            where: `${path}:${text.slice(0, hit.index).split('\n').length}`,
            why: 'the value is written here too, and this is not its home',
          })
        }
      }
    }
    if (foundAtHome === 0) {
      // A literal that matches nothing is indistinguishable from a scanner that
      // read nothing.
      fails.push({
        check: 'second-copy',
        id: entry.id,
        where: [...homes].join(', ') || '(nowhere declared)',
        why: 'no declared literal is written in this row\'s home or mirrors; the register describes something that is not there',
      })
    }
  }
  return fails
}

function refFiles(ref) {
  const parsed = parseRef(ref)
  if (parsed.error) return []
  if (parsed.kind === 'php' || parsed.kind === 'phpconst') {
    // A class maps to its file by name; the plugin has one class per file.
    const short = parsed.cls.slice(parsed.cls.lastIndexOf('\\') + 1)
    return [`wp-plugins/teeshoop-core/includes/${short}.php`]
  }
  return [parsed.file]
}

function literalRegex(literal) {
  const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\w.$])${escaped}(?![\\w.])`, 'g')
}

/** 4: every Bloquant question is accounted for. */
function checkNothingForgotten(entries, data, questionsText) {
  const fails = []
  const { blocking, all, unreadable } = parseBlockingQuestions(questionsText)
  if (blocking.length === 0) {
    return { fails, blocking, untrustworthy: 'no Bloquant question was parsed out of QUESTIONS-ASSOCIE.md' }
  }
  if (unreadable.length > 0) {
    return {
      fails,
      blocking,
      untrustworthy: `${unreadable.join(', ')}: no level this guard can read, so it cannot tell "not blocking" from "not understood"`,
    }
  }

  /*
   * AND THE OTHER DIRECTION, which is the one that has already gone wrong here:
   * a row pointing at a question number that does not exist. The register once
   * carried the wrong question number in five files, and every check in this
   * script would have passed, because they all read the row and none of them
   * read the document back. A dangling question is a row nobody will ever
   * answer.
   */
  const known = new Set(all)
  for (const entry of entries) {
    if (!known.has(entry.question)) {
      fails.push({
        check: 'nothing-forgotten',
        id: entry.id,
        where: 'QUESTIONS-ASSOCIE.md',
        why: `names ${entry.question}, and no such question is in the document`,
      })
    }
  }

  const covered = new Set(entries.map((e) => e.question))
  const excused = new Map((data.not_applicable ?? []).map((na) => [na.question, na.why]))
  for (const q of blocking) {
    if (covered.has(q)) continue
    if (excused.has(q)) continue
    fails.push({
      check: 'nothing-forgotten',
      id: q,
      where: 'QUESTIONS-ASSOCIE.md',
      why: 'marked Bloquant and absent from the register, with no not_applicable reason',
    })
  }
  return { fails, blocking, untrustworthy: false }
}

/**
 * The questions file, read as data.
 *
 * `### 12. …` opens a question and runs until the next `###`; the level is the
 * bolded word inside it. Parsed rather than listed here, because a list here is
 * a copy that would stop agreeing with the document the associate reads.
 */
function parseBlockingQuestions(text) {
  const out = []
  const all = []
  const unreadable = []
  const sections = text.split(/^### /m).slice(1)
  for (const section of sections) {
    const num = section.match(/^(\d+)\./)
    if (!num) continue
    const body = section.split(/^## /m)[0]
    const id = `Q${String(num[1]).padStart(2, '0')}`
    all.push(id)
    const level = body.match(/\*\*(Bloquant|Important|Utile|Secondaire|À confirmer)\*\*/)
    /*
     * A level the parser does not recognise is NOT "not blocking".
     *
     * The document already carries a fifth vocabulary word ("À confirmer") that
     * an earlier version of this parser could not read, and a sixth would be
     * silently treated as harmless: the one check that makes forgetting
     * impossible would forget. So an unknown level makes the scan
     * untrustworthy, and the guard exits 2 rather than passing.
     */
    if (!level) {
      unreadable.push(id)
      continue
    }
    if (level[1] === 'Bloquant') out.push(id)
  }
  return { blocking: out, all, unreadable }
}

/**
 * 5: an assumed value a customer meets is labelled, in French, in a real table.
 *
 * TWO RULES, and the second was added in session 13b when twenty-seven rows
 * flipped to `answered` at once. Requiring the label only of an `assumption`
 * meant a confirmation silently RELEASED the label: the sentence a customer
 * reads the number under stopped being checked the day the number stopped being
 * a guess, and nothing would have noticed it disappearing. So a row that
 * declares a `label_fr` must carry it on a real screen whatever its status. The
 * requirement to HAVE one is still the assumption's alone; the requirement for
 * the one you have to be true is everybody's.
 */
/**
 * How many shipped string tables a `label_fr` may appear in before it stops
 * proving anything. Six is deliberately generous: the widest real label in this
 * register (« Délai à confirmer », which the shelf, the product page, the quote
 * and two e-mails all say) reaches four.
 */
const LABEL_MAX_TABLES = 6

function checkSaidOutLoud(entries, tables) {
  const fails = []
  const texts = tables.map((abs) => textOf(abs))
  for (const entry of entries) {
    const facesCustomer = entry.reaches.includes('customer')
    /*
     * `label_fr_why` IS THE SAME TRADE THIS REGISTER ALREADY MAKES FOR LITERALS.
     *
     * A row can reach a customer through something that is not a shipped string:
     * `H-Q31-PALETTE-ET-TYPE` is the brand mark, and the theme draws it from
     * `get_bloginfo( 'name' )`, a WordPress setting, inside a `ts-wordmark`
     * link. No sentence in any string table can be true of it, so the label it
     * carried was the single word « Teeshoop », which matched 89 tables and
     * could not fail. An escape hatch that must be argued in prose is honest;
     * a label that matches everything is not.
     */
    if (entry.status === 'assumption' && facesCustomer && !entry.label_fr && !entry.label_fr_why) {
      fails.push({
        check: 'said-out-loud',
        id: entry.id,
        where: 'docs/hypotheses.json',
        why: 'reaches a customer as an assumption and carries neither a label_fr nor a label_fr_why saying what it meets instead',
      })
      continue
    }
    if (entry.label_fr && entry.label_fr_why) {
      fails.push({
        check: 'said-out-loud',
        id: entry.id,
        where: 'docs/hypotheses.json',
        why: 'carries both a label_fr and a label_fr_why, so it is not clear which is true',
      })
      continue
    }
    if (!entry.label_fr) continue
    const hits = texts.filter((t) => t.includes(entry.label_fr)).length
    if (hits === 0) {
      fails.push({
        check: 'said-out-loud',
        id: entry.id,
        where: 'string tables',
        why: 'its label_fr is in no shipped string table, so nothing on screen says it',
      })
      continue
    }
    /*
     * AND A LABEL THAT MATCHES EVERYWHERE PROVES NOTHING.
     *
     * This is a substring test over whole files, so a one-word generic label
     * cannot fail it: « Teeshoop » matched 406 places including
     * `@package Teeshoop\Core` doc comments and `use Teeshoop\Core\Cart;`, and
     * « Studio » and « Facture » were no better. Three rows were therefore
     * carrying a check that could not go red, which is the shape CLAUDE.md calls
     * a gate that cannot fail. Found on 2 September by auditing this session
     * against its own brief.
     *
     * A sentence a customer actually reads lives in one string table, sometimes
     * two or three when a page, an e-mail and a template say the same thing.
     * Past that, the label is a word rather than a sentence and the match is a
     * coincidence. The number is the rule, so it is named rather than inlined.
     */
    if (hits > LABEL_MAX_TABLES) {
      fails.push({
        check: 'said-out-loud',
        id: entry.id,
        where: 'string tables',
        why:
          `its label_fr matches ${hits} string tables, so it is a word and not the sentence a ` +
          `customer reads: nothing here could ever fail. Give it the phrase it appears in.`,
      })
    }
  }
  return fails
}

// ─────────────────────────────────────────────────────────────────────────────
// The shop's copy

/**
 * Homes whose rows must not cross into the shop's copy, whatever directory they
 * live in.
 *
 * The filter used to be "inside the plugin", and that was enough while the cost
 * model lived in the studio: film tariffs and purchase prices were homed in
 * `src/` and simply never matched. Session 05 moved the cost engine INTO the
 * plugin, so twenty-two rows about what we pay for film, what an hour of
 * workshop costs and what a salesperson earns became eligible to cross, and
 * `scripts/php-guard.mjs` failed on the generated file with thirty-two hits.
 *
 * That failure was right. `data/` is a rendering directory, the register screen
 * echoes these sentences, and the shop's cost structure does not belong in a
 * projection whose whole purpose is to tell an operator which PRICES are
 * assumed. The rows still exist, they are still checked, and they are shown on
 * the "Coûts et marges" screen, which is the page about them.
 *
 * The count of what was withheld crosses instead, so the register screen can say
 * it is not showing everything. A filter nobody can see is indistinguishable
 * from a register that is short a few rows.
 */
const WITHHELD_FROM_SHOP = [
  'Teeshoop\\Core\\Cost::',
  'Teeshoop\\Core\\Commission::',
  // An `anchor:` home names a file rather than a class, so the class prefixes
  // above do not catch it. The test is the same one: does this row live in the
  // cost engine.
  'includes/Cost.php',
  'includes/Commission.php',
  'includes/Costing.php',
  'includes/CostAdmin.php',
  'includes/PriceRule.php',
]

/**
 * What WordPress is allowed to know.
 *
 * Only rows homed inside the plugin, minus the cost engine (see above), and only
 * the fields an admin screen shows.
 */
function projectForShop(data) {
  const inPlugin = data.entries.filter((e) => refFiles(e.home).some((f) => f.startsWith('wp-plugins/')))
  const crossing = inPlugin.filter((e) => !WITHHELD_FROM_SHOP.some((h) => e.home.includes(h)))
  const withheld = inPlugin.length - crossing.length
  const rows = crossing
    .map((e) => ({
      id: e.id,
      question: e.question,
      level: e.level,
      status: e.status,
      since: e.since,
      /*
       * The answer crosses too, since session 13b. An operator looking at this
       * screen needs to tell "nobody has ever confirmed this" from "he confirmed
       * it on 1 September", and those two rows read identically without a date.
       */
      answered: e.answered ?? null,
      answer_fr: e.answer_fr ?? null,
      /*
       * And so does a decision taken in his place, since 4 September 2026, for
       * the same reason the answer crosses: an operator has to tell « nobody has
       * ever looked at this » from « we chose it on a Thursday night and he has
       * not seen it yet ». They are separate fields on this side too, so no
       * screen can print one under the other's heading.
       */
      decided_by: e.decided_by ?? null,
      decided_on: e.decided_on ?? null,
      decided_why: e.decided_why ?? null,
      statement_fr: e.statement_fr,
      home: e.home,
      reaches: e.reaches,
      cost_if_late: e.cost_if_late,
      sessions: e.sessions,
    }))

  return `<?php
/**
 * GENERATED. Do not edit: run \`node scripts/hypotheses-guard.mjs --write\`.
 *
 * The rows of \`docs/hypotheses.json\` whose home is inside this plugin, minus the
 * cost engine, and only the fields an admin screen shows. Read by
 * includes/Hypotheses.php.
 *
 * \`withheld\` counts the rows deliberately kept out: what we pay for film, for an
 * hour of workshop and to a salesperson. They are on the "Coûts et marges"
 * screen instead. The count crosses so this page can say it is not everything.
 *
 * PHP AND NOT JSON, ON PURPOSE. This directory is served by URL, and these
 * sentences are business-internal: what the shop does not enforce, what nobody
 * has priced yet, and that the published grid is a demonstration. Guarded on
 * ABSPATH, a direct request gets nothing.
 *
 * @package Teeshoop\\Core
 */

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

return ${phpValue({ rows, withheld }, 0)};
`
}

/**
 * A JSON value as readable PHP source.
 *
 * Readable and not encoded, because this file is reviewed: a base64 blob would
 * hide exactly the sentences a reviewer needs to see. Single quotes, so nothing
 * interpolates, and the only two characters that can escape a single-quoted PHP
 * string are escaped.
 */
function phpValue(value, depth) {
  const pad = '\t'.repeat(depth + 1)
  const close = '\t'.repeat(depth)
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (typeof value === 'string') return `'${value.split('\\').join('\\\\').split("'").join("\\'")}'`
  if (Array.isArray(value)) {
    if (value.length === 0) return 'array()'
    return `array(\n${value.map((v) => `${pad}${phpValue(v, depth + 1)},`).join('\n')}\n${close})`
  }
  const keys = Object.keys(value)
  if (keys.length === 0) return 'array()'
  return `array(\n${keys
    .map((k) => `${pad}${phpValue(k, depth + 1)} => ${phpValue(value[k], depth + 1)},`)
    .join('\n')}\n${close})`
}

// ─────────────────────────────────────────────────────────────────────────────
// Run

function die(code, ...lines) {
  for (const line of lines) console.error(line)
  process.exit(code)
}

function report(fails) {
  const byCheck = new Map()
  for (const f of fails) byCheck.set(f.check, [...(byCheck.get(f.check) ?? []), f])
  console.error(`hypotheses-guard: ${fails.length} disagreement(s) between the register and the code.`)
  for (const [check, list] of byCheck) {
    console.error(`\n  [${check}] ${list.length}`)
    for (const f of list) console.error(`    ${f.id}  ${f.where}  ${f.why}`)
  }
}

async function run(ledgerData, { questionsText, files, tables }) {
  const shape = validateShape(ledgerData)
  const entries = ledgerData.entries

  const phpSpecs = []
  const tsFiles = new Set()
  const jsonFiles = new Set()
  for (const ref of entries.flatMap((e) => [e.home, ...e.mirrors.map((m) => m.ref)])) {
    const parsed = parseRef(ref)
    if (parsed.error) continue
    if (parsed.kind === 'php' || parsed.kind === 'phpconst') {
      phpSpecs.push({ key: `${parsed.cls}::${parsed.member}`, kind: parsed.kind, cls: parsed.cls, member: parsed.member })
    } else if (parsed.kind === 'ts') tsFiles.add(parsed.file)
    else if (parsed.kind === 'json') jsonFiles.add(parsed.file)
  }

  const php = loadPhpRoots([...new Map(phpSpecs.map((s) => [s.key, s])).values()])
  if (!php.ok) return { untrustworthy: php.why }
  const ts = await loadTsRoots([...tsFiles])
  if (!ts.ok) return { untrustworthy: ts.why }
  const roots = { ...php.roots, ...ts.roots, ...loadJsonRoots([...jsonFiles]) }

  const skippedComparisons = []
  const forgotten = checkNothingForgotten(entries, ledgerData, questionsText)
  if (forgotten.untrustworthy) {
    return { untrustworthy: forgotten.untrustworthy }
  }

  const fails = [
    ...shape.map((why) => ({ check: 'shape', id: '', where: rel(LEDGER), why })),
    ...checkResolvesAndAgrees(entries, roots, skippedComparisons),
    ...checkStatement(entries, roots),
    ...checkNoSecondCopy(entries, files),
    ...forgotten.fails,
    ...checkSaidOutLoud(entries, tables),
  ]
  return { fails, blocking: forgotten.blocking, skippedComparisons }
}

// ─── the world, read once ────────────────────────────────────────────────────

const ledger = loadLedger()
if (!ledger.ok) die(2, `hypotheses-guard: ${ledger.why}`)

if (!existsSync(QUESTIONS)) die(2, `hypotheses-guard: ${rel(QUESTIONS)} is missing; the register cannot be checked against it.`)
const questionsText = textOf(QUESTIONS)

const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d))).filter((f) => !SCAN_EXCLUDE_FILES.has(rel(f)))
if (files.length === 0) die(2, 'hypotheses-guard: scanned no source files at all. A pass here would mean nothing.')

const tables = STRING_TABLE_ROOTS.flatMap((d) => walk(join(ROOT, d), [], STRING_TABLE_EXT))
if (tables.length === 0) die(2, 'hypotheses-guard: found no string table. A label check against nothing always passes.')

if (WRITE) {
  mkdirSync(dirname(SHOP_COPY), { recursive: true })
  /*
   * Written aside and renamed, because the shop `require`s this file.
   * A half-written JSON file parses as invalid and is caught; a half-written
   * PHP file is a ParseError, which in WordPress is a fatal error on a product
   * page. rename() within one directory is atomic on every filesystem this
   * project runs on.
   */
  const tmp = `${SHOP_COPY}.tmp`
  writeFileSync(tmp, projectForShop(ledger.data))
  renameSync(tmp, SHOP_COPY)
  console.log(`hypotheses-guard: wrote ${rel(SHOP_COPY)}`)
  process.exit(0)
}

/*
 * SELF-TEST: prove each of the five checks can fail.
 *
 * Against a mutated COPY of the register and of the scan inputs, never the
 * files on disk: a gate that has to be broken by hand to be trusted is a gate
 * nobody re-tests. This project has already shipped a harness that printed nine
 * green ticks under "0 passed", with its failure exit unreachable.
 */
if (SELF_TEST) {
  const clone = () => JSON.parse(JSON.stringify(ledger.data))
  const first = (pred, what) => {
    const e = clone().entries.find(pred)
    if (!e) die(2, `hypotheses-guard --self-test: the register has no entry ${what}; this check cannot be proven.`)
    return e.id
  }

  const cases = [
    {
      name: 'resolves',
      why: 'a home that no longer points at anything',
      mutate: (d) => {
        const id = first((e) => parseRef(e.home).kind === 'php', 'homed in the PHP config')
        d.entries.find((e) => e.id === id).home = 'php:Teeshoop\\Core\\Pricing::default_config()#no_such_key'
      },
    },
    {
      name: 'agrees',
      why: 'a mirror that stopped agreeing with its home',
      mutate: (d) => {
        const id = first((e) => e.mirrors.length > 0, 'with a mirror')
        d.entries.find((e) => e.id === id).mirrors[0].relation = 'eur-to-cents'
        // eur-to-cents against a value already in cents cannot hold.
        d.entries.find((e) => e.id === id).home = 'php:Teeshoop\\Core\\Pricing::default_config()#max_qty'
      },
    },
    {
      name: 'second-copy',
      why: 'a value written a second time outside its home',
      mutate: (d) => {
        const id = first((e) => e.literals.length > 0, 'with a literal to hunt')
        const entry = d.entries.find((e) => e.id === id)
        entry.mirrors = []
        entry.literal_allow = []
      },
    },
    {
      name: 'nothing-forgotten',
      why: 'a row naming a question that is not in the document',
      mutate: (d) => {
        d.entries[0].question = 'Q99'
      },
    },
    {
      name: 'nothing-forgotten',
      why: 'a Bloquant question with no row and no reason',
      mutate: (d) => {
        const { blocking } = parseBlockingQuestions(questionsText)
        const victim = blocking.find((q) => d.entries.some((e) => e.question === q)) ?? blocking[0]
        d.entries = d.entries.filter((e) => e.question !== victim)
        d.not_applicable = (d.not_applicable ?? []).filter((na) => na.question !== victim)
      },
    },
    {
      name: 'statement',
      why: 'a sentence that no longer states the value it describes',
      mutate: (d) => {
        const e = d.entries.find((x) => (x.statement_amounts ?? []).length > 0)
        if (!e) die(2, 'hypotheses-guard --self-test: no row states an amount; this check cannot be proven.')
        e.statement_amounts[0].text = '0,01 EUR'
      },
    },
    {
      name: 'said-out-loud',
      why: 'a customer-facing assumption whose label is on no screen',
      mutate: (d) => {
        const id = first(
          (e) => e.status === 'assumption' && e.reaches.includes('customer'),
          'that reaches a customer',
        )
        const e = d.entries.find((x) => x.id === id)
        delete e.label_fr_why
        e.label_fr = 'ceci ne figure dans aucune table de chaînes'
      },
    },
    {
      /*
       * The half added on 2 September 2026. Three rows carried a one-word label
       * (« Teeshoop », « Studio », « Facture ») that a substring test over whole
       * files could never fail: the first matched 89 string tables including
       * `@package` doc comments. A check that cannot go red is not a check, and
       * this is the case that proves this one can.
       */
      name: 'said-out-loud',
      why: 'a label so generic it matches every string table, so nothing could fail',
      mutate: (d) => {
        const id = first(
          (e) => e.status === 'assumption' && e.reaches.includes('customer'),
          'that reaches a customer',
        )
        const e = d.entries.find((x) => x.id === id)
        delete e.label_fr_why
        // A single space is in every shipped string table there is, which is the
        // reductio of the label the register actually carried.
        e.label_fr = ' '
      },
    },
    {
      name: 'said-out-loud',
      why: 'a row claiming both a label and a reason for having none',
      mutate: (d) => {
        const id = first(
          (e) => e.status === 'assumption' && e.reaches.includes('customer') && e.label_fr,
          'that reaches a customer with a label',
        )
        d.entries.find((x) => x.id === id).label_fr_why = 'et pourtant elle en porte une'
      },
    },
    {
      /*
       * The half added in session 13b. Without it, confirming a value released
       * the sentence a customer reads it under, and this case is the only thing
       * that says the release did not happen.
       */
      name: 'said-out-loud',
      why: 'a CONFIRMED row whose label left the screen',
      mutate: (d) => {
        const id = first(
          (e) => e.status !== 'assumption' && e.label_fr,
          'confirmed or refused and carrying a label',
        )
        d.entries.find((e) => e.id === id).label_fr = 'ceci non plus ne figure nulle part'
      },
    },
    {
      name: 'shape',
      why: 'a row marked answered with no date to point at',
      mutate: (d) => {
        const id = first((e) => e.status === 'answered', 'the associate has answered')
        delete d.entries.find((e) => e.id === id).answered
      },
    },
    {
      /*
       * THE CASE THIS PAIR OF FIELDS EXISTS FOR. Without it the exclusion is a
       * paragraph, and a paragraph does not refuse a commit.
       */
      name: 'shape',
      why: 'a row claiming the associate answered AND that we decided',
      mutate: (d) => {
        const id = first((e) => e.status === 'answered', 'the associate has answered')
        const e = d.entries.find((x) => x.id === id)
        e.decided_by = 'equipe'
        e.decided_on = '2026-09-04'
        e.decided_why = 'une décision prise en séance, écrite sur une ligne qu il a déjà tranchée'
      },
    },
    {
      /*
       * IL FAUT RETIRER LA DATE, PAS OMETTRE DE LA POSER.
       *
       * Ce cas écrivait `decided_by` et `decided_why` sur la première ligne
       * encore supposée, en comptant sur l'absence de `decided_on`. Le jour où
       * une VRAIE décision a été inscrite au registre (4 septembre 2026,
       * H-Q06-TARIF-TEE), cette ligne portait déjà les trois champs : la
       * mutation en réécrivait deux, la date restait, la règle était satisfaite
       * et le cas est passé SILENT. La CI l'a vu, pas la machine qui l'a écrit,
       * parce que `npm run ci` lance le contrôle et pas le --self-test.
       *
       * Un cas de self-test qui dépend de l'état du registre ne prouve rien :
       * il faut CONSTRUIRE l'état cassé, quel que soit le point de départ.
       */
      name: 'shape',
      why: 'a decision with an author and no date',
      mutate: (d) => {
        const id = first((e) => e.status === 'assumption', 'still assumed')
        const e = d.entries.find((x) => x.id === id)
        e.decided_by = 'equipe'
        e.decided_why = 'une décision prise en séance, sans la date à laquelle elle a été prise'
        delete e.decided_on
      },
    },
    {
      name: 'shape',
      why: 'a decision signed by the associate himself',
      mutate: (d) => {
        const id = first((e) => e.status === 'assumption', 'still assumed')
        const e = d.entries.find((x) => x.id === id)
        // Les trois champs sont POSÉS, pas complétés : voir le cas au-dessus.
        e.decided_by = 'associe'
        e.decided_on = '2026-09-04'
        e.decided_why = 'sa signature dans le champ qui sert précisément à dire que ce n est pas lui'
      },
    },
  ]

  let allFired = true
  for (const c of cases) {
    const mutated = clone()
    c.mutate(mutated)
    const result = await run(mutated, { questionsText, files, tables })
    const fired = (result.fails ?? []).some((f) => f.check === c.name)
    console.log(`  ${fired ? 'FIRED' : 'SILENT'}  [${c.name}] ${c.why}`)
    if (!fired) allFired = false
  }

  if (!allFired) {
    die(2, '\nhypotheses-guard --self-test: at least one check did not fire when broken. It proves nothing.')
  }
  console.log(`\nhypotheses-guard --self-test: all ${cases.length} checks fail when broken.`)
  process.exit(0)
}

const result = await run(ledger.data, { questionsText, files, tables })
if (result.untrustworthy) {
  die(2, `hypotheses-guard: ${result.untrustworthy}`)
}

// The shop's copy is a projection of the register, so it is stale the same way
// a generated file is stale, and for the same reason: someone changed the truth
// and did not tell the surface that displays it.
const expected = projectForShop(ledger.data)
const actual = existsSync(SHOP_COPY) ? textOf(SHOP_COPY) : ''
if (actual !== expected) {
  result.fails.push({
    check: 'shop-copy',
    id: '',
    where: rel(SHOP_COPY),
    why: 'stale or missing; run: node scripts/hypotheses-guard.mjs --write',
  })
}

if (result.fails.length > 0) {
  report(result.fails)
  console.error('\nOne assumed value, one home, one row. Correct the register or the code, not both.')
  process.exit(1)
}

const entries = ledger.data.entries
const unscanned = entries.filter((e) => e.literals.length === 0)
const scoped = entries.filter((e) => e.literals.length > 0 && (e.literal_scope ?? []).length > 0)
const assumptions = entries.filter((e) => e.status === 'assumption')
console.log(
  `hypotheses-guard: ${entries.length} rows (${assumptions.length} still assumed, ` +
    `${entries.filter((e) => e.status === 'refused').length} refused), ` +
    `${result.blocking.length} Bloquant questions all accounted for, ` +
    `${files.length} files scanned, ${tables.length} string tables. Clean.`,
)
// Not failures, but never silent: a check that looked in fewer places, or did
// not look at all, must not read like a check that found nothing.
if ((result.skippedComparisons ?? []).length > 0) {
  console.log(
    `  ${result.skippedComparisons.length} mirror comparison(s) could not run because one end is an anchor: ` +
      result.skippedComparisons.join(', '),
  )
}
const unstated = entries.filter((e) => (e.statement_amounts ?? []).length === 0)
if (unstated.length > 0) {
  console.log(`  ${unstated.length} row(s) state no amount the sentence check can pin: ${unstated.map((e) => e.id).join(', ')}`)
}
if (scoped.length > 0) {
  console.log(`  ${scoped.length} row(s) hunted in a declared scope only: ${scoped.map((e) => e.id).join(', ')}`)
}
if (unscanned.length > 0) {
  console.log(
    `  ${unscanned.length} row(s) carry no literal the scan can hunt: ${unscanned.map((e) => e.id).join(', ')}`,
  )
}
