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
 * Usage:
 *   node scripts/launch-gate.mjs              # the real thing; needs the shop
 *   node scripts/launch-gate.mjs --depot      # the register half only
 *   node scripts/launch-gate.mjs --ci         # run it, print the verdict, and
 *                                             # fail only if the GATE is broken
 *   node scripts/launch-gate.mjs --self-test  # prove each condition can refuse
 *
 * Exit: 0 go-live authorised (or, under --ci, the gate itself is trustworthy)
 *       1 refused, with reasons
 *       2 the gate could not be trusted (nothing read, shop unreachable when
 *         it was required, self-test did not fire)
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

const DEPOT_ONLY = process.argv.includes('--depot')
const CI = process.argv.includes('--ci')
const SELF_TEST = process.argv.includes('--self-test')

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
function shopBlockers() {
  if (!existsSync(COMPOSE)) {
    return { ok: false, why: `${COMPOSE} n'existe pas : la boutique ne peut pas être interrogée.` }
  }
  /*
   * A SHOP WITHOUT THE PLUGIN IS A SHOP THAT WAS NOT ASKED, not a shop with one
   * complaint. The first version of this returned a single blocker saying the
   * extension was inactive, and the summary then listed identity, VAT, terms and
   * blanks as VERIFIED, which is the exact confusion between « nothing found »
   * and « nothing looked » this whole gate exists to refuse. It answers `ok:
   * false` now and the four conditions are counted as unlooked.
   */
  const php = `
if ( ! class_exists( '\\\\Teeshoop\\\\Core\\\\Launch' ) ) {
    $answer = array( 'ok' => false, 'why' => "l'extension Teeshoop n'est pas active sur cette boutique." );
} else {
    $answer = array( 'ok' => true, 'blockers' => \\Teeshoop\\Core\\Launch::blockers() );
}
echo "\\n<<<TEESHOOP-LAUNCH>>>" . json_encode( $answer, JSON_UNESCAPED_UNICODE ) . "<<<END>>>\\n";
`
  let stdout
  try {
    stdout = execFileSync(
      'docker',
      ['compose', '-f', COMPOSE, 'run', '--rm', '-T', 'wpcli', 'eval', php],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
  } catch (e) {
    return { ok: false, why: `la boutique n'a pas répondu : ${String(e.message).split('\n')[0]}` }
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

  if (shop.ok) {
    blockers.push(...shop.blockers)
    looked.push('identité', 'tva (barème)', 'cgv', 'textile nu')
  } else {
    /*
     * NOT A PASS. Four of the five conditions are the shop's, so a shop that
     * could not be asked is four conditions nobody looked at, and this script
     * says so as a refusal rather than counting them absent.
     */
    unlooked.push('identité', 'tva (barème)', 'cgv', 'textile nu')
    blockers.push({
      cle: 'boutique',
      pourquoi: `Quatre conditions sur cinq n'ont pas pu être vérifiées : ${shop.why} « On n'a pas pu regarder » n'est pas « il n'y a rien ».`,
    })
  }

  return { trusted: true, blockers, looked, unlooked }
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

  if (!allFired) {
    console.error(`\n${RED}launch-gate --self-test: au moins un contrôle ne se déclenche pas. Il ne prouve rien.${OFF}`)
    process.exit(2)
  }
  console.log(`\nlaunch-gate --self-test: les ${cases.length} conditions refusent, et un dépôt propre passe.`)
  process.exit(0)
}

const shop = DEPOT_ONLY
  ? { ok: false, why: '--depot : la boutique n’a délibérément pas été interrogée.' }
  : shopBlockers()

const result = gate({ ledger: loaded.data, shop })
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

process.exit(result.blockers.length === 0 ? 0 : 1)
