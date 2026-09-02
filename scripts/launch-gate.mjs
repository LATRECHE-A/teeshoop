#!/usr/bin/env node
/**
 * LAUNCH GATE: may this shop be put in front of a customer, yes or no.
 *
 * WHY IT EXISTS. On 18 August 2026 the decision was taken to build sessions 04
 * to 13 on the WRITTEN DEFAULT hypotheses of `QUESTIONS-ASSOCIE.md` rather than
 * stop, and three rules were written to keep that decision reversible. Two were
 * built: one value, one home (`docs/hypotheses.json`, `hypotheses-guard.mjs`),
 * and an assumed figure is labelled where a customer meets it. The third was
 * not:
 *
 *   « La mise en ligne est bloquée automatiquement tant qu'une réponse bloquante
 *     manque sur un nombre qu'un client, un fournisseur ou une imprimante finit
 *     par voir. Ce n'est pas une note dans un document, c'est un contrôle qui
 *     refuse de laisser passer. »
 *
 * This is it. Sessions 14 and 15 read it before they deploy and before they take
 * money, and it is in their checklists rather than only in CI.
 *
 * ── THE FIVE CONDITIONS ──────────────────────────────────────────────────────
 *
 *   1. REGISTER.  No row of `docs/hypotheses.json` may be `bloquant`, still an
 *                 assumption nobody has answered, and reach a customer, a
 *                 supplier or a printer. Checked here, because WordPress cannot
 *                 read `docs/`.
 *   2. IDENTITY.  Raison sociale, forme juridique, adresse, SIRET, TVA
 *                 intracommunautaire and capital, plus the site's own publisher
 *                 under article 6 III of the LCEN. Asked of the shop.
 *   3. VAT.       The regime is confirmed IN EITHER DIRECTION. Two facts: the
 *                 timeline the shop applies has to be usable (asked of the
 *                 shop), and a human has to have confirmed the regime itself
 *                 (the register's `answered` date on H-Q17-TVA, checked here).
 *                 The answer of 1 September 2026 is « conserver l'hypothèse de
 *                 TVA à 20 % ... sous réserve de validation comptable », which
 *                 is a maintained assumption and not a confirmation.
 *   4. TERMS.     The conditions of sale in force are `valide` and name the
 *                 person who read them and the day they did. Asked of the shop.
 *   6. MEDIATION. Not a row but a PAIR. No consumer mediator is designated AND
 *                 nothing refuses a consumer. Each refusal is honest alone; the
 *                 two together are an offence against article L612-1, because the
 *                 exemption his answer to question 57 claims only holds if the
 *                 consumer path is actually closed. Checked here.
 *   5. BLANKS.    No personalisable product is on sale declaring no textile nu.
 *                 A shop that sells a garment it can never buy blanks for takes
 *                 an order it cannot fill, after the customer has paid. Asked of
 *                 the shop.
 *
 * ── IT FAILS CLOSED, AND THAT IS THE WHOLE POINT ─────────────────────────────
 *
 * An unreadable register is a REFUSAL. An unreachable shop is a REFUSAL. A
 * condition that could not be evaluated is a REFUSAL with that as its reason.
 * There is no path through this script that authorises a launch on a check that
 * did not run, because a gate that passes when it cannot look is worse than no
 * gate: it is a gate somebody trusts.
 *
 * ── WHICH SHOP IT ASKS ───────────────────────────────────────────────────────
 *
 * Until 02/09/2026 the answer was « the local docker mirror », hard-coded, with
 * no flag and no environment variable. Three tracked documents told session 14
 * to replay this gate against the REAL shop before deploying, and the code had
 * no mechanism to do it: `docs/MISE-EN-LIGNE.md` even says « rejouer le portail
 * contre la production est une étape de la séance 14, pas une formalité ».
 *
 *   --boutique=miroir                the local mirror through docker (default)
 *   --boutique=ssh:<hôte>:<chemin>   a real WordPress over SSH, with a key that
 *                                    can run wp-cli, e.g. ssh:teeshoop:public_html
 *   --boutique=deploy:<hôte>:<env>   the same shop through deploiement.sh's
 *                                    `verdict` verb, which is what the RESTRICTED
 *                                    deploy key can actually run. This is the form
 *                                    the pipeline uses.
 *
 * Both ends run the same thing: `wp teeshoop lancement --porcelaine`, which is a
 * WP-CLI subcommand rather than the inline `wp eval` string this used to send.
 * That is not tidying. Shipping a PHP program through ssh and a shell means two
 * layers of quoting around a payload containing single quotes, backslashes and
 * accented French, and the failure mode of getting it wrong is a parse error
 * that reads exactly like an unreachable shop.
 *
 * A plugin too old to have that subcommand makes wp-cli exit non-zero, which is
 * « we could not look », which refuses. Fail closed, as everywhere else here.
 *
 * Usage:
 *   node scripts/launch-gate.mjs              # the real thing; needs the shop
 *   node scripts/launch-gate.mjs --depot      # the register half only
 *   node scripts/launch-gate.mjs --ci         # run it, print the verdict, and
 *                                             # fail only if the GATE is broken
 *   node scripts/launch-gate.mjs --self-test  # prove each condition can refuse
 *   node scripts/launch-gate.mjs --json       # the verdict as JSON, for a deploy
 *
 * Exit: 0 go-live authorised (or, under --ci, the gate itself is trustworthy)
 *       1 refused, with reasons
 *       2 the gate could not be trusted: the register is unreadable, the shop
 *         could not be REACHED, or the self-test did not fire
 *
 * THE DIFFERENCE BETWEEN 1 AND 2 IS NEW AND IT IS THE ONE A PIPELINE NEEDS. Both
 * refuse a launch, so `docs/MISE-EN-LIGNE.md` is still right that there are two
 * answers to « peut-on lancer » and no third. But a deploy that stops has to be
 * able to tell its operator « the shop said no » from « nothing asked the shop »,
 * and until now both exited 1 while the docblock above claimed otherwise: an
 * unreachable shop became an ordinary blocker. Deliberately not asking (--depot)
 * is still 1, because that is a choice and not a failure.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const LEDGER = join(ROOT, 'docs/hypotheses.json')
const COMPOSE = join(ROOT, 'wp-local/docker-compose.yml')

const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const OFF = '\x1b[0m'

/*
 * STRICT ARGUMENT PARSING, and this is a fail-closed change rather than
 * housekeeping. Every flag used to be read with `process.argv.includes(...)`, so
 * an unknown one was silently ignored: `--boutque=ssh:teeshoop:public_html`, one
 * letter out, would have run this gate against the LOCAL MIRROR and printed a
 * verdict about the wrong shop, in the one place whose entire job is to be
 * believed. Anything unrecognised now exits 2.
 */
const ARGS = process.argv.slice(2)
const KNOWN = new Set(['--depot', '--ci', '--self-test', '--json'])
const DEPOT_ONLY = ARGS.includes('--depot')
const CI = ARGS.includes('--ci')
const SELF_TEST = ARGS.includes('--self-test')
const JSON_OUT = ARGS.includes('--json')

let TARGET_RAW = 'miroir'
const badArgs = []
for (const a of ARGS) {
  if (KNOWN.has(a)) continue
  if (a.startsWith('--boutique=')) {
    TARGET_RAW = a.slice('--boutique='.length)
    continue
  }
  badArgs.push(a)
}
if (badArgs.length > 0) {
  console.error(
    `${RED}launch-gate: argument inconnu : ${badArgs.join(', ')}. ` +
      `Attendus : --depot, --ci, --self-test, --json, --boutique=miroir|ssh:<hôte>:<chemin>.${OFF}`,
  )
  process.exit(2)
}

/**
 * Where the shop is, parsed and VALIDATED.
 *
 * The host and the path are pasted into an ssh command line, so they are checked
 * against a deliberately narrow character set rather than quoted. Quoting the
 * path would also defeat the `~` a home-relative WordPress root needs, and a
 * gate that has to choose between shell-safe and correct should refuse instead.
 */
function parseTarget(raw) {
  if (raw === 'miroir') return { kind: 'miroir', label: 'le miroir local (docker)' }

  /*
   * `deploy:` EXISTE PARCE QUE LA CLÉ DE DÉPLOIEMENT NE PEUT PAS LANCER wp-cli.
   *
   * Elle est posée avec `command="…/deploiement.sh"`, donc elle n'exécute que les
   * verbes de ce script. Le travail de production appelait ce portail avec
   * `ssh:teeshoop:~/public_html`, qui envoie `cd … && wp teeshoop lancement` :
   * l'aiguilleur répond « verbe inconnu », le portail lit « boutique
   * injoignable » et sort 2. Toujours 2, quel que soit l'état réel de la
   * boutique. Il bloquait donc bien, mais pour la mauvaise raison, et il aurait
   * continué à bloquer le jour où la vraie réponse aurait été « on peut ».
   * Trouvé par une relecture adverse avant le premier déploiement.
   */
  const d = /^deploy:([^:]+):([a-z]+)$/.exec(raw)
  if (d) {
    const [, host, env] = d
    if (!/^[A-Za-z0-9._@-]+$/.test(host)) {
      return { kind: 'invalide', why: `l'hôte « ${host} » contient un caractère que ce contrôle refuse de passer à un shell.` }
    }
    if (!['preprod', 'prod'].includes(env)) {
      return { kind: 'invalide', why: `environnement « ${env} » inconnu (preprod, prod).` }
    }
    return { kind: 'deploy', host, env, label: `${host} (clé de déploiement, ${env})` }
  }

  const m = /^ssh:([^:]+):(.+)$/.exec(raw)
  if (!m) {
    return { kind: 'invalide', why: `« ${raw} » n'est ni « miroir », ni « ssh:<hôte>:<chemin> », ni « deploy:<hôte>:<env> ».` }
  }
  const [, host, path] = m
  if (!/^[A-Za-z0-9._@-]+$/.test(host)) {
    return { kind: 'invalide', why: `l'hôte « ${host} » contient un caractère que ce contrôle refuse de passer à un shell.` }
  }
  if (!/^[A-Za-z0-9._~/-]+$/.test(path)) {
    return { kind: 'invalide', why: `le chemin « ${path} » contient un caractère que ce contrôle refuse de passer à un shell.` }
  }
  return { kind: 'ssh', host, path, label: `${host}:${path} (ssh)` }
}

const TARGET = parseTarget(TARGET_RAW)
if (TARGET.kind === 'invalide') {
  console.error(`${RED}launch-gate: --boutique invalide : ${TARGET.why}${OFF}`)
  process.exit(2)
}

/**
 * Who a value has to reach for a missing answer to block a launch.
 *
 * `operator` and `internal` are NOT here, and the omission is the rule. An
 * assumed figure an operator reads on an admin screen is a figure the person who
 * can correct it is looking at; an assumed figure a customer pays, a supplier is
 * ordered against or a printer prints from is one nobody outside can question.
 * That distinction is question 17's own written default, quoted above.
 */
const OUTWARD = new Set(['customer', 'supplier', 'printer'])

// ─────────────────────────────────────────────────────────────────────────────
// 1. The register.

function registerBlockers(ledger) {
  const out = []
  for (const entry of ledger.entries) {
    /*
     * `refused` is not an unanswered assumption. It is a deliberate decision to
     * build nothing, which cannot mislead anybody because there is nothing to
     * meet: `H-Q42-MARGE-TEXTILE-NU` writes no selling price on 26 392 articles,
     * so the catalogue is consultable and not orderable. A refusal ships an
     * absence, and an absence is honest.
     */
    if (entry.status !== 'assumption') continue
    if (entry.level !== 'bloquant') continue
    if (entry.answered) continue
    const reaches = (entry.reaches ?? []).filter((r) => OUTWARD.has(r))
    if (reaches.length === 0) continue
    out.push({
      cle: 'registre',
      pourquoi: `${entry.id} (question ${entry.question.slice(1)}) est une hypothèse bloquante que personne n'a confirmée, et elle atteint : ${reaches.join(', ')}. ${entry.statement_fr}`,
    })
  }
  return out
}

/**
 * Condition 3, the half that lives in the register: has anybody CONFIRMED the
 * VAT regime, in either direction.
 */
function vatConfirmationBlockers(ledger) {
  const row = ledger.entries.find((e) => e.id === 'H-Q17-TVA')
  if (!row) {
    return [
      {
        cle: 'tva',
        pourquoi:
          "Le registre ne porte plus de ligne H-Q17-TVA. Le régime de TVA n'a donc aucune trace de confirmation, et ce contrôle refuse plutôt que de supposer qu'elle existe ailleurs.",
      },
    ]
  }
  if (!row.answered) {
    return [
      {
        cle: 'tva',
        pourquoi:
          "Le régime de TVA n'est confirmé dans aucun sens : H-Q17-TVA ne porte pas de date de réponse. La boutique a encaissé quinze commandes avec le calcul des taxes désactivé, et la réponse du 1er septembre 2026 dit « conserver l'hypothèse ... sous réserve de validation comptable », qui est le mot à mot d'une hypothèse maintenue.",
      },
    ]
  }
  return []
}

/**
 * Condition 6, and it is the one neither row can see on its own.
 *
 * `H-Q57-MEDIATEUR` is a refusal: no consumer mediator is designated, and the
 * conditions of sale say in as many words that the obligation is not satisfied.
 * `H-Q62-REFUS-PARTICULIER` is a refusal too: nothing refuses a consumer, the
 * SIRET is asked and not required, and the contract in force applies to a
 * consumer as much as to a professional.
 *
 * SEPARATELY, EACH IS HONEST. A refusal ships an absence and an absence can be
 * read. TOGETHER THEY ARE ILLEGAL: article L612-1 of the code de la consommation
 * obliges any professional who contracts with consumers to belong to a mediation
 * scheme and to publish its details. His answer to question 57 removes that
 * obligation « pour le parcours B2B », and the exemption is only true if the
 * second row stops being a refusal.
 *
 * So the pair is checked and not the rows. Answering either one clears it:
 * designate a mediator, or close the consumer path. This is the condition that a
 * per-row rule cannot express, and it is exactly the sort of thing that goes live
 * because two documents each looked fine.
 */
function mediationBlockers(ledger) {
  const byId = new Map(ledger.entries.map((e) => [e.id, e]))
  const mediator = byId.get('H-Q57-MEDIATEUR')
  const refusal = byId.get('H-Q62-REFUS-PARTICULIER')
  if (!mediator || !refusal) {
    return [
      {
        cle: 'mediation',
        pourquoi:
          "Le registre ne porte plus les deux lignes qui décident de la médiation de la consommation (H-Q57-MEDIATEUR et H-Q62-REFUS-PARTICULIER). Ce contrôle refuse plutôt que de supposer que l'obligation est levée.",
      },
    ]
  }
  const noMediator = mediator.status === 'refused'
  const sellsToConsumers = refusal.status === 'refused'
  if (noMediator && sellsToConsumers) {
    return [
      {
        cle: 'mediation',
        pourquoi:
          "Aucun médiateur de la consommation n'est désigné ET rien ne refuse un particulier. Prises une par une les deux lignes sont des refus assumés ; ensemble elles sont une infraction à l'article L612-1 du code de la consommation, parce que l'exemption annoncée en réponse à la question 57 suppose un parcours qui refuse effectivement un consommateur. Répondre à l'une des deux suffit : désigner un médiateur, ou fermer le parcours grand public (question 62).",
      },
    ]
  }
  return []
}

// ─────────────────────────────────────────────────────────────────────────────
// 2 to 5. The shop.

/**
 * Ask the running shop, through WP-CLI in the local mirror.
 *
 * The answer comes back as JSON on one line between two markers, because WP-CLI
 * prints notices, deprecations and docker's own noise on the same stream and a
 * parser that took the whole output would fail on a warning and read as an
 * unreachable shop.
 */
/**
 * The command that asks one shop, whichever shop it is.
 *
 * Both ends run `wp teeshoop lancement --porcelaine`. The subcommand exists so
 * that this does not have to ship a PHP program through ssh and a shell: the
 * payload it replaced contained single quotes, backslashes and accented French,
 * and a quoting mistake produces a parse error that reads exactly like an
 * unreachable shop, which is the one thing this gate must never confuse.
 */
function shopCommand(target) {
  if (target.kind === 'miroir') {
    return {
      cmd: 'docker',
      args: ['compose', '-f', COMPOSE, 'run', '--rm', '-T', 'wpcli', 'teeshoop', 'lancement', '--porcelaine'],
    }
  }
  /*
   * BatchMode: an ssh that stops to ask for a passphrase would hang a deploy for
   * ever with no output. Refusing immediately is the answer, and the refusal is
   * « we could not look », which blocks.
   */
  const commun = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20']
  if (target.kind === 'deploy') {
    /*
     * `./deploiement.sh verdict <env>` ET NON `verdict <env>`, POUR QUE LA MÊME
     * LIGNE MARCHE AVEC LES DEUX CLÉS.
     *
     * Avec la clé de déploiement, `command=` remplace la commande demandée et le
     * script retire lui-même ce préfixe : les deux formes arrivent au même verbe.
     * Avec la clé ordinaire d'un développeur il n'y a pas de commande forcée, et
     * `verdict preprod` est alors une commande shell qui n'existe pas : le
     * portail lisait « boutique injoignable » et sortait 2 sur une boutique
     * parfaitement joignable. Mesuré le 02/09/2026, en croyant à une régression
     * de la préproduction.
     *
     * Le même alias d'hôte ne porte donc pas la même clé selon la machine, et
     * c'est exactement le genre de différence qu'une procédure ne doit pas avoir
     * à connaître.
     */
    return { cmd: 'ssh', args: [...commun, target.host, `./deploiement.sh verdict ${target.env}`] }
  }
  return {
    cmd: 'ssh',
    args: [...commun, target.host, `cd ${target.path} && wp teeshoop lancement --porcelaine`],
  }
}

/**
 * Ask the shop.
 *
 * Every failure path returns `ok: false` with a reason, and the caller turns
 * that into a refusal AND into exit 2. There is no path here that returns an
 * empty blocker list because something went wrong.
 */
function shopBlockers(target) {
  if (target.kind === 'miroir' && !existsSync(COMPOSE)) {
    return { ok: false, why: `${COMPOSE} n'existe pas : la boutique ne peut pas être interrogée.` }
  }
  /*
   * A SHOP WITHOUT THE PLUGIN IS A SHOP THAT WAS NOT ASKED, not a shop with one
   * complaint. The first version of this returned a single blocker saying the
   * extension was inactive, and the summary then listed identity, VAT, terms and
   * blanks as VERIFIED, which is the exact confusion between « nothing found »
   * and « nothing looked » this whole gate exists to refuse. It answers `ok:
   * false` now and the four conditions are counted as unlooked.
   *
   * On a shop where the plugin is absent or too old, wp-cli exits non-zero on
   * the unknown command and that lands in the catch below, with the same effect.
   */
  const { cmd, args } = shopCommand(target)
  let stdout
  try {
    stdout = execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    /*
     * wp-cli writes its errors to stderr and exits non-zero, and that text is
     * the only useful thing here: « Error: 'teeshoop' is not a registered
     * command » and « Error: This does not seem to be a WordPress installation »
     * are different problems with different fixes, and `e.message` alone says
     * neither.
     */
    const stderr = String(e.stderr ?? '')
      .trim()
      .split('\n')
      /*
       * OpenSSH prints a three-line post-quantum advisory to stderr on every
       * connection to o2switch's older sshd. It is not the problem and it
       * crowded out the line that was: « Error: 'teeshoop' is not a registered
       * wp command », which is the sentence that tells an operator the plugin is
       * not deployed yet.
       */
      .filter((l) => l.trim() !== '' && !l.startsWith('**'))
      .slice(-2)
      .join(' · ')
    const first = String(e.message).split('\n')[0]
    return { ok: false, why: `la boutique n'a pas répondu : ${first}${stderr ? ` (${stderr})` : ''}` }
  }
  const m = /<<<TEESHOOP-LAUNCH>>>(.*)<<<END>>>/s.exec(stdout)
  if (!m) {
    return { ok: false, why: "la boutique a répondu quelque chose que ce contrôle ne sait pas lire." }
  }
  try {
    const parsed = JSON.parse(m[1])
    if (parsed === null || typeof parsed !== 'object') throw new Error('not an object')
    if (parsed.ok !== true) {
      return { ok: false, why: String(parsed.why ?? 'la boutique a refusé de répondre sans dire pourquoi.') }
    }
    if (!Array.isArray(parsed.blockers)) throw new Error('blockers is not a list')
    return { ok: true, blockers: parsed.blockers }
  } catch (e) {
    return { ok: false, why: `la réponse de la boutique n'est pas du JSON exploitable : ${e.message}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The run.

function loadLedger() {
  if (!existsSync(LEDGER)) return { ok: false, why: `${LEDGER} n'existe pas.` }
  let data
  try {
    data = JSON.parse(readFileSync(LEDGER, 'utf8'))
  } catch (e) {
    return { ok: false, why: `${LEDGER} n'est pas du JSON valide : ${e.message}` }
  }
  if (!Array.isArray(data.entries) || data.entries.length === 0) {
    return { ok: false, why: `${LEDGER} ne contient aucune ligne ; un registre vide ne prouve rien.` }
  }
  return { ok: true, data }
}

/** @returns {{trusted:boolean, why?:string, blockers:Array, looked:string[], unlooked:string[]}} */
function gate({ ledger, shop }) {
  const looked = []
  const unlooked = []
  const blockers = []

  blockers.push(...registerBlockers(ledger))
  looked.push('registre')
  blockers.push(...vatConfirmationBlockers(ledger))
  looked.push('tva (confirmation)')
  blockers.push(...mediationBlockers(ledger))
  looked.push('médiation')

  /*
   * THE SHOP'S FIVE, AND `éditeur` WAS MISSING FROM THIS LIST.
   *
   * Launch.php emits it from Host::missing() for the site's own publisher under
   * article 6 III of the LCEN, and it is four of the twenty-seven refusals the
   * mirror prints today. It appeared in no label and in no self-test case, so
   * the summary line under a refusal listed seven conditions while eight were
   * being evaluated, and the count in the sentence below said « four of five »
   * when four of the shop's own conditions were being skipped out of five.
   * Counting wrong in the line that says what was NOT checked is the specific
   * mistake this gate exists to make impossible.
   */
  const SHOP_CONDITIONS = ['identité', 'éditeur', 'tva (barème)', 'cgv', 'textile nu']
  if (shop.ok) {
    blockers.push(...shop.blockers)
    looked.push(...SHOP_CONDITIONS)
  } else {
    /*
     * NOT A PASS. Five of the eight conditions are the shop's, so a shop that
     * could not be asked is five conditions nobody looked at, and this script
     * says so as a refusal rather than counting them absent.
     */
    unlooked.push(...SHOP_CONDITIONS)
    blockers.push({
      cle: 'boutique',
      pourquoi: `${SHOP_CONDITIONS.length} conditions sur ${looked.length + SHOP_CONDITIONS.length} n'ont pas pu être vérifiées : ${shop.why} « On n'a pas pu regarder » n'est pas « il n'y a rien ».`,
    })
  }

  /*
   * `reached` is the field that makes exit 2 possible, and it distinguishes two
   * things the old code did not: a shop that answered « no » from a shop nobody
   * managed to ask. `--depot` is a third state and it is NOT untrusted: not
   * asking on purpose is a choice, so it refuses with exit 1 like any other
   * refusal. The old `trusted` field was set here and read nowhere, which is why
   * this one is asserted by the self-test.
   */
  return { reached: shop.ok === true || shop.deliberate === true, blockers, looked, unlooked }
}

/**
 * The one number a pipeline reads.
 *
 *   0  nothing refuses
 *   1  something refuses, and we did manage to ask
 *   2  we could not ask, so the answer is unknown and therefore no
 *
 * 2 is not « worse than 1 ». Both block. They differ in what the operator must
 * do next, and telling them apart is the whole reason this exists: « the shop
 * said no » is fixed by fixing the shop, « nothing asked the shop » is fixed by
 * fixing the connection, and a deploy log that says only « refused » sends
 * somebody looking in the wrong place at seven on a Friday evening.
 */
function exitCode(result) {
  if (!result.reached) return 2
  return result.blockers.length === 0 ? 0 : 1
}

function report(result) {
  const n = result.blockers.length
  if (n === 0) {
    console.log(
      `${GREEN}launch-gate: mise en ligne AUTORISÉE.${OFF} ${result.looked.length} condition(s) vérifiée(s) : ${result.looked.join(', ')}.`,
    )
    return
  }
  console.log(`${RED}${BOLD}launch-gate: mise en ligne REFUSÉE, ${n} raison(s).${OFF}\n`)
  const byKey = new Map()
  for (const b of result.blockers) byKey.set(b.cle, [...(byKey.get(b.cle) ?? []), b.pourquoi])
  for (const [key, why] of byKey) {
    console.log(`  ${BOLD}[${key}]${OFF} ${why.length}`)
    for (const w of why) console.log(`    ${w}`)
    console.log('')
  }
  console.log(
    `${DIM}vérifié : ${result.looked.join(', ') || 'rien'}` +
      (result.unlooked.length > 0 ? ` · NON vérifié : ${result.unlooked.join(', ')}` : '') +
      `${OFF}`,
  )
}

const loaded = loadLedger()
if (!loaded.ok) {
  console.error(`${RED}launch-gate: registre illisible, donc REFUS et non silence : ${loaded.why}${OFF}`)
  process.exit(2)
}

// ─────────────────────────────────────────────────────────────────────────────
// SELF-TEST: prove each condition can refuse.
//
// Against a mutated COPY of the register and a synthetic shop answer, never the
// files on disk. A gate nobody can see fail is a gate nobody should believe, and
// this repository has already shipped a harness that printed nine green ticks
// under "0 passed".
if (SELF_TEST) {
  const clone = () => JSON.parse(JSON.stringify(loaded.data))
  const cases = [
    {
      name: 'registre',
      why: 'une hypothèse bloquante non répondue qui atteint un client',
      ledger: () => {
        const d = clone()
        const e = d.entries.find((x) => x.level === 'bloquant' && x.reaches.includes('customer'))
        e.status = 'assumption'
        delete e.answered
        return d
      },
      shop: () => ({ ok: true, blockers: [] }),
    },
    {
      name: 'tva',
      why: 'un régime de TVA que personne n’a confirmé',
      ledger: () => {
        const d = clone()
        delete d.entries.find((x) => x.id === 'H-Q17-TVA').answered
        return d
      },
      shop: () => ({ ok: true, blockers: [] }),
    },
    {
      name: 'mediation',
      why: 'aucun médiateur ET rien qui refuse un particulier',
      ledger: () => {
        const d = clone()
        d.entries.find((x) => x.id === 'H-Q57-MEDIATEUR').status = 'refused'
        d.entries.find((x) => x.id === 'H-Q62-REFUS-PARTICULIER').status = 'refused'
        return d
      },
      shop: () => ({ ok: true, blockers: [] }),
    },
    {
      name: 'identite',
      why: 'une mention légale obligatoire absente',
      ledger: () => clone(),
      shop: () => ({ ok: true, blockers: [{ cle: 'identite', pourquoi: 'SIRET absent' }] }),
    },
    {
      name: 'cgv',
      why: 'des conditions de vente que personne n’a relues',
      ledger: () => clone(),
      shop: () => ({ ok: true, blockers: [{ cle: 'cgv', pourquoi: 'version en projet' }] }),
    },
    {
      name: 'textile-nu',
      why: 'un produit personnalisable en vente sans textile nu déclaré',
      ledger: () => clone(),
      shop: () => ({ ok: true, blockers: [{ cle: 'textile-nu', pourquoi: 'aucune référence' }] }),
    },
    {
      /*
       * THE EIGHTH KEY, AND IT HAD NO CASE HERE UNTIL 02/09/2026. `Launch.php`
       * emits `editeur` from `Host::missing()` for the site's own publisher
       * identity under article 6 III of the LCEN, and it is four of the
       * twenty-seven refusals the gate prints today. It was in no self-test case
       * and in no `looked` label, so the one condition currently doing the most
       * refusing was the one nobody had proved could refuse.
       */
      name: 'editeur',
      why: 'un hébergeur que les mentions légales ne nomment pas',
      ledger: () => clone(),
      shop: () => ({ ok: true, blockers: [{ cle: 'editeur', pourquoi: 'raison sociale de l’hébergeur absente' }] }),
    },
    {
      name: 'boutique',
      why: 'une boutique qu’on n’a pas pu interroger du tout',
      ledger: () => clone(),
      shop: () => ({ ok: false, why: 'docker est absent' }),
    },
  ]

  let allFired = true
  for (const c of cases) {
    const r = gate({ ledger: c.ledger(), shop: c.shop() })
    const fired = r.blockers.some((b) => b.cle === c.name)
    console.log(`  ${fired ? 'REFUSE ' : 'LAISSE PASSER'}  [${c.name}] ${c.why}`)
    if (!fired) allFired = false
  }

  /*
   * AND THE OTHER DIRECTION, which is the one a gate gets wrong: it has to be
   * able to say YES. A gate that refuses whatever it is given is not a gate, it
   * is a wall, and nobody would ever notice it had stopped checking.
   */
  const clean = clone()
  for (const e of clean.entries) {
    if (e.level === 'bloquant' && e.status === 'assumption' && !e.answered) {
      e.answered = '2026-01-01'
      e.answer_fr = 'auto-test'
    }
  }
  // A mediator designated is one of the two ways out of condition 6.
  clean.entries.find((x) => x.id === 'H-Q57-MEDIATEUR').status = 'answered'
  const yes = gate({ ledger: clean, shop: { ok: true, blockers: [] } })
  const canPass = yes.blockers.length === 0
  console.log(`  ${canPass ? 'AUTORISE' : 'REFUSE  '}  [aucune] un dépôt et une boutique sans reproche`)
  if (!canPass) {
    console.log(`    ${yes.blockers.map((b) => b.cle).join(', ')}`)
    allFired = false
  }

  /*
   * AND THE EXIT CODE ITSELF, because a deploy reads that and not this text.
   * Three shop answers, three verdicts: reached and clean, reached and refusing,
   * and never reached. The third is the one that has to come out as 2, and the
   * second must NOT, or a pipeline would report « we could not look » every time
   * the shop simply said no.
   */
  const exitCases = [
    { label: 'boutique jointe, rien à redire', shop: { ok: true, blockers: [] }, reached: true, refuses: false },
    { label: 'boutique jointe, elle refuse', shop: { ok: true, blockers: [{ cle: 'identite', pourquoi: 'SIRET absent' }] }, reached: true, refuses: true },
    { label: 'boutique injoignable', shop: { ok: false, why: 'ssh a expiré' }, reached: false, refuses: true },
    { label: '--depot, pas interrogée volontairement', shop: { ok: false, deliberate: true, why: '--depot' }, reached: true, refuses: true },
  ]
  for (const c of exitCases) {
    const r = gate({ ledger: clean, shop: c.shop })
    const code = exitCode(r)
    const want = !c.refuses ? 0 : c.reached ? 1 : 2
    const good = code === want
    console.log(`  ${good ? 'CODE OK ' : 'CODE FAUX'}  [sortie ${code}, attendu ${want}] ${c.label}`)
    if (!good) allFired = false
  }

  if (!allFired) {
    console.error(`\n${RED}launch-gate --self-test: au moins un contrôle ne se déclenche pas. Il ne prouve rien.${OFF}`)
    process.exit(2)
  }
  console.log(`\nlaunch-gate --self-test: les ${cases.length} conditions refusent, les ${exitCases.length} codes de sortie sont les bons, et un dépôt propre passe.`)
  process.exit(0)
}

const shop = DEPOT_ONLY
  ? { ok: false, deliberate: true, why: '--depot : la boutique n’a délibérément pas été interrogée.' }
  : shopBlockers(TARGET)

const result = gate({ ledger: loaded.data, shop })
const code = exitCode(result)

/*
 * MACHINE-READABLE FIRST, and nothing else on stdout when it is asked for. The
 * deploy attaches this to its run so that « what was refusing on the day we
 * shipped » is answerable six months later without rerunning anything.
 */
if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        verdict: code === 0 ? 'autorisee' : 'refusee',
        code,
        reached: result.reached,
        boutique: TARGET.label,
        blockers: result.blockers,
        looked: result.looked,
        unlooked: result.unlooked,
      },
      null,
      2,
    ),
  )
  process.exit(code)
}

if (!DEPOT_ONLY) {
  console.log(`${DIM}boutique interrogée : ${TARGET.label}${OFF}`)
}
report(result)

/*
 * UNDER --ci, THE QUESTION IS DIFFERENT. CI cannot ask « may we launch », because
 * the answer is no and will stay no for weeks, and a permanently red CI is a CI
 * nobody reads. What CI asks is « does this gate still work »: the register
 * parses, the conditions evaluate, and the verdict is printed in the log where
 * anybody can read what is still blocking. It fails only when the gate itself
 * has stopped being trustworthy.
 */
if (CI) {
  console.log(
    `${DIM}--ci : la question posée ici est « ce portail fonctionne-t-il », pas « peut-on lancer ». ` +
      `Le verdict ci-dessus est l'état réel et il est imprimé pour être lu.${OFF}`,
  )
  process.exit(0)
}

if (2 === code) {
  console.error(
    `\n${RED}launch-gate: la boutique n'a pas pu être interrogée, donc ${result.unlooked.length} conditions ` +
      `sur ${result.looked.length + result.unlooked.length} n'ont pas été regardées. Sortie 2 et non 1 : ` +
      `« on n'a pas pu regarder » n'est pas « la boutique a dit non ».${OFF}`,
  )
}
process.exit(code)
