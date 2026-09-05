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
 * ── DEPUIS LE 5 SEPTEMBRE 2026, CE PORTAIL EST DEUX PORTES ───────────────────
 *
 * Décision du développeur, transcrite telle quelle dans
 * `docs/decisions/2026-09-05-les-deux-portes.md` : les huit conditions ne pèsent
 * pas le même poids, et un portail unique qui refuse une mise en ligne sur une
 * relecture d'avocat manquante n'est pas obéi, il est contourné. Une porte qu'on
 * enjambe ne garde rien.
 *
 * Alors le portail garde ce qu'il gardait, et il le répartit :
 *
 *   --porte=argent       TROIS conditions DURES, sans dérogation, parce que
 *                        chacune coûte de l'argent ou trompe un acheteur sur un
 *                        montant : un prix sous son plancher, un textile nu non
 *                        déclaré sur un produit personnalisable en vente, une
 *                        passerelle de paiement mal configurée. Elle sort
 *                        non-zéro si l'une casse, et rien ne la neutralise :
 *                        ni --ci, ni --depot, ni une option à écrire un jour.
 *
 *   --porte=publication  Sort 0, et ÉCRIT `docs/DETTE-LANCEMENT.md` : chaque
 *                        condition non tenue, datée, avec le nom de qui peut la
 *                        lever et le geste précis qui la lève. Publier n'est
 *                        plus bloqué par une dette juridique ; la dette est
 *                        écrite, nominative, et imprimée par l'intégration
 *                        continue au lieu d'être un refus que personne ne lit.
 *
 * CE N'EST PAS UNE DÉROGATION ET IL N'Y EN A PAS. La porte de l'argent peut
 * toujours refuser, et c'est le seul endroit où le mot « toujours » est employé
 * ici. Ce qui change est le RÔLE de ce fichier : il cessait un déploiement,
 * il tient maintenant une comptabilité de ce qui manque et il n'arrête plus que
 * l'argent.
 *
 * SANS --porte, RIEN NE CHANGE. `scripts/deployer.sh` et
 * `.github/workflows/ci.yml` appellent ce script sans porte et lisent le même
 * verdict, les mêmes codes de sortie et le même JSON qu'avant.
 *
 * ── CE QUE LA PORTE DE L'ARGENT EXIGE DE LA BOUTIQUE ─────────────────────────
 *
 * Qu'elle DISE ce qu'elle a regardé. La réponse porcelaine
 * (`wp teeshoop lancement --porcelaine`) porte `blockers`, et une liste vide y
 * veut dire deux choses opposées : « j'ai regardé, rien à signaler » et « cette
 * version de l'extension ne sait pas regarder ça ». Confondre les deux est
 * exactement la faute que tout ce fichier existe pour refuser, et elle serait
 * ici pire qu'ailleurs : elle autoriserait à encaisser.
 *
 * La boutique ajoute donc à sa réponse un champ `regarde` (ou `looked`), la
 * liste des clés de condition qu'elle a réellement évaluées. La porte de
 * l'argent exige d'y trouver ses trois conditions ; ce qu'elle n'y trouve pas
 * est « on n'a pas pu regarder », donc sortie 2, donc refus.
 *
 * Usage:
 *   node scripts/launch-gate.mjs              # the real thing; needs the shop
 *   node scripts/launch-gate.mjs --depot      # the register half only
 *   node scripts/launch-gate.mjs --ci         # run it, print the verdict, and
 *                                             # fail only if the GATE is broken
 *   node scripts/launch-gate.mjs --self-test  # prove each condition can refuse
 *   node scripts/launch-gate.mjs --json       # the verdict as JSON, for a deploy
 *   node scripts/launch-gate.mjs --porte=argent       # les trois conditions dures
 *   node scripts/launch-gate.mjs --porte=publication  # écrit la dette, sort 0
 *
 * TEESHOOP_DETTE : où `--porte=publication` écrit. Par défaut
 * `docs/DETTE-LANCEMENT.md`. Une intégration continue qui n'a pas de boutique à
 * interroger écrit ailleurs, pour ne pas remplacer un relevé informé par un
 * relevé aveugle.
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
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
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
let PORTE = ''
const badArgs = []
for (const a of ARGS) {
  if (KNOWN.has(a)) continue
  if (a.startsWith('--boutique=')) {
    TARGET_RAW = a.slice('--boutique='.length)
    continue
  }
  if (a.startsWith('--porte=')) {
    PORTE = a.slice('--porte='.length)
    continue
  }
  badArgs.push(a)
}
if (badArgs.length > 0) {
  console.error(
    `${RED}launch-gate: argument inconnu : ${badArgs.join(', ')}. ` +
      `Attendus : --depot, --ci, --self-test, --json, --boutique=miroir|ssh:<hôte>:<chemin>, --porte=argent|publication.${OFF}`,
  )
  process.exit(2)
}
if (PORTE !== '' && !['argent', 'publication'].includes(PORTE)) {
  console.error(`${RED}launch-gate: --porte inconnue : « ${PORTE} ». Attendues : argent, publication.${OFF}`)
  process.exit(2)
}

/*
 * LES COMBINAISONS QUI NEUTRALISERAIENT UNE PORTE SONT REFUSÉES, ET C'EST LA
 * PARTIE DE CE FICHIER À NE PAS ASSOUPLIR.
 *
 * `--ci` sort 0 quoi qu'il arrive, par construction : la question qu'il pose est
 * « ce portail fonctionne-t-il », pas « peut-on lancer ». Combiné à
 * `--porte=argent`, il produirait une porte de l'argent qui ne peut plus refuser,
 * c'est-à-dire une décoration. `--depot` n'interroge délibérément pas la
 * boutique, or les trois conditions de l'argent sont toutes chez elle : une
 * porte de l'argent sans boutique n'aurait rien regardé du tout. Et
 * `--self-test` prouve les portes lui-même, sur des réponses synthétiques : le
 * mélanger à une porte réelle donnerait deux verdicts sur un seul code de
 * sortie.
 */
if (PORTE !== '' && SELF_TEST) {
  console.error(`${RED}launch-gate: --porte et --self-test ne se combinent pas. L'auto-test prouve les deux portes lui-même.${OFF}`)
  process.exit(2)
}
if (PORTE === 'argent' && (CI || DEPOT_ONLY)) {
  console.error(
    `${RED}launch-gate: --porte=argent ne se combine ni avec --ci ni avec --depot. ` +
      `L'un sort 0 quoi qu'il arrive, l'autre n'interroge pas la boutique, et les trois conditions de l'argent sont chez elle.${OFF}`,
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

/**
 * LES TROIS CONDITIONS DE LA PORTE DE L'ARGENT, ET RIEN D'AUTRE.
 *
 * Le critère d'entrée dans cette liste est étroit et il est écrit pour pouvoir
 * être opposé à une demande d'y ajouter une quatrième ligne : une condition y
 * figure si, cassée, elle fait perdre de l'argent à l'entreprise ou trompe un
 * acheteur sur un montant. Pas si elle expose juridiquement, pas si elle est
 * embarrassante, pas si elle est urgente.
 *
 *   - un prix sous son plancher : la vente se fait à perte, et personne ne le
 *     voit avant la clôture comptable ;
 *   - un textile nu non déclaré sur un produit personnalisable EN VENTE : la
 *     boutique encaisse une commande qu'elle ne peut pas acheter, après paiement ;
 *   - une passerelle de paiement mal configurée : l'argent n'arrive pas, ou
 *     arrive sur le mauvais compte, ou dans la mauvaise devise.
 *
 * Les huit conditions du portail complet ne disparaissent pas : celles qui ne
 * sont pas ici partent dans `docs/DETTE-LANCEMENT.md`, datées et nominatives.
 *
 * `alias` existe parce que les deux moitiés du portail sont écrites dans deux
 * langages et que la clé de refus vient de la boutique. Reconnaître un nom de
 * plus n'élargit JAMAIS un passage : une clé non reconnue est une condition non
 * regardée, donc un refus. Elle évite seulement qu'un refus réel soit lu comme
 * un silence.
 */
const ARGENT = [
  {
    id: 'prix-plancher',
    label: 'un prix sous son plancher',
    alias: ['prix-plancher', 'plancher', 'prix'],
  },
  {
    id: 'textile-nu',
    label: 'un textile nu non déclaré sur un produit personnalisable en vente',
    alias: ['textile-nu', 'textile_nu', 'textilenu'],
  },
  {
    id: 'paiement',
    label: 'une passerelle de paiement mal configurée',
    alias: ['paiement', 'passerelle', 'paiement-passerelle'],
  },
]

/**
 * Un refus relève-t-il de l'argent.
 *
 * UNION ET NON REMPLACEMENT, et c'est le sens de la lecture qui compte. Depuis
 * le 5 septembre 2026 la boutique étiquette elle-même chaque refus avec sa porte
 * (`Launch::PORTE_ARGENT`), ce qui est plus juste que de deviner d'après la clé :
 * c'est le code qui produit le refus qui sait ce qu'il coûte. Mais faire
 * CONFIANCE à cette étiquette pour RÉTRÉCIR la porte laisserait une erreur
 * d'étiquetage faire passer de l'argent. Les deux lectures sont donc réunies :
 * une clé connue OU une étiquette « argent » suffit. Une union ne peut
 * qu'élargir un refus.
 */
function argentCondition(b) {
  const cle = String(b?.cle ?? b ?? '')
  const parCle = ARGENT.find((c) => c.alias.includes(cle)) ?? null
  if (parCle !== null) return parCle
  if (typeof b === 'object' && b !== null && String(b.porte ?? '') === 'argent') {
    return { id: cle, label: cle, alias: [cle] }
  }
  return null
}

/**
 * La boutique a-t-elle regardé les trois conditions de l'argent, et comment on
 * le sait.
 *
 * DEUX SIGNAUX, DU PLUS FORT AU PLUS FAIBLE, et aucun n'est « la liste de refus
 * est vide ».
 *
 *   1. `regarde` (ou `looked`) : la boutique énumère les conditions qu'elle a
 *      évaluées. C'est le seul signal qui répond vraiment à la question, et le
 *      seul qui permette à cette porte de dire OUI sur une boutique sans
 *      reproche. Il tient en une ligne dans `Cli::launch()`.
 *
 *   2. À défaut, l'ÉTIQUETTE DE PORTE portée par les refus. Une extension
 *      antérieure au 5 septembre 2026 ne connaît ni le plancher publié ni la
 *      passerelle et n'étiquette rien ; si tous les refus reçus portent leur
 *      porte, c'est cette version-ci qui répond, et elle évalue les trois. Ce
 *      signal a un trou assumé : zéro refus n'apprend rien, donc une boutique
 *      irréprochable sort quand même 2 tant que le signal 1 n'existe pas. Un
 *      refus sur une boutique propre est gênant ; l'inverse serait d'autoriser
 *      un encaissement sur une version qui n'a rien regardé.
 *
 * @returns {{regarde:boolean, comment:string}}
 */
function argentRegarde(shop) {
  if (shop.regarde !== null) {
    const manquantes = ARGENT.filter((c) => !c.alias.some((a) => shop.regarde.includes(a)))
    return manquantes.length === 0
      ? { regarde: true, comment: 'la boutique énumère ce qu’elle a regardé' }
      : { regarde: false, comment: `la boutique déclare n'avoir pas regardé : ${manquantes.map((c) => c.id).join(', ')}` }
  }
  const etiquettes = shop.blockers.filter((b) => String(b?.porte ?? '') !== '')
  if (shop.blockers.length > 0 && etiquettes.length === shop.blockers.length) {
    return { regarde: true, comment: 'tous les refus reçus portent leur porte, donc l’extension est celle qui évalue les trois' }
  }
  return { regarde: false, comment: 'rien dans la réponse de la boutique ne dit ce qui a été regardé' }
}

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
      /*
       * PORTÉ POUR LA DETTE, ET AJOUTÉ PLUTÔT QUE RECALCULÉ AILLEURS.
       * `docs/DETTE-LANCEMENT.md` date chaque ligne et nomme la question à
       * laquelle répondre ; les relire dans le registre une seconde fois serait
       * deux lectures d'une même règle, et le jour où elles divergent le relevé
       * de dette daterait une ligne que le portail ne refuse plus.
       */
      registre: { id: entry.id, question: entry.question, depuis: entry.since ?? '' },
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
    /*
     * CE QUE LA BOUTIQUE DIT AVOIR REGARDÉ, et `null` quand elle ne le dit pas.
     * `null` n'est pas une liste vide : une liste vide serait « j'ai regardé,
     * rien », `null` est « cette version de l'extension ne répond pas à la
     * question ». Seule la porte de l'argent s'en sert, et elle refuse sur
     * `null`. Le verdict complet, lui, ne change pas de comportement.
     */
    const declared = Array.isArray(parsed.regarde)
      ? parsed.regarde
      : Array.isArray(parsed.looked)
        ? parsed.looked
        : null
    return { ok: true, blockers: parsed.blockers, regarde: declared === null ? null : declared.map(String) }
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
   * THE SHOP'S SEVEN, AND THIS LIST HAS BEEN WRONG TWICE.
   *
   * First `éditeur` was missing: Launch.php emits it from Host::missing() for
   * the site's own publisher under article 6 III of the LCEN, and it was four of
   * the twenty-seven refusals the mirror printed on 02/09/2026. It appeared in
   * no label and in no self-test case, so the summary line under a refusal
   * listed seven conditions while eight were being evaluated.
   *
   * Then `prix plancher` and `passerelle de paiement`: the shop's money door,
   * added on 05/09/2026, evaluates them, and this list still said five. A shop
   * that could not be asked was reported as five conditions unlooked when seven
   * were. Counting wrong in the line that says what was NOT checked is the
   * specific mistake this gate exists to make impossible, and it has now been
   * made twice by the same list. Anything added to `Launch::blockers()` belongs
   * here, on the same commit.
   */
  const SHOP_CONDITIONS = [
    'identité',
    'éditeur',
    'tva (barème)',
    'cgv',
    'textile nu',
    'prix plancher',
    'passerelle de paiement',
  ]
  if (shop.ok) {
    blockers.push(...shop.blockers)
    looked.push(...SHOP_CONDITIONS)
  } else {
    /*
     * NOT A PASS. Seven of the ten conditions are the shop's, so a shop that
     * could not be asked is seven conditions nobody looked at, and this script
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

// ─────────────────────────────────────────────────────────────────────────────
// LA PORTE DE L'ARGENT.

/**
 * Les trois conditions dures, et rien d'autre.
 *
 * Elle ne lit pas le registre : aucune de ses trois conditions n'y est. Une
 * hypothèse de tarif que personne n'a confirmée est une DETTE, pas une vente à
 * perte ; c'est le relevé de dette qui la porte, avec le nom de qui doit
 * répondre. Confondre les deux est ce qui a rendu le portail unique
 * inapplicable : il refusait la mise en ligne sur des lignes que seul l'associé
 * pouvait trancher, et personne ne pouvait donc jamais le satisfaire.
 *
 * @returns {{code:number, blockers:Array, nonRegarde:string[], why?:string}}
 */
function porteArgent(shop) {
  if (!shop.ok) {
    return {
      code: 2,
      blockers: [],
      nonRegarde: ARGENT.map((c) => c.id),
      why: `${shop.why} Les trois conditions de l'argent sont chez elle, donc aucune n'a été regardée.`,
    }
  }
  /*
   * LES REFUS REÇUS SONT IMPRIMÉS MÊME QUAND LE COMPTE N'EST PAS BON.
   *
   * Une boutique qui n'a regardé qu'une des trois conditions sort quand même 2,
   * parce que deux n'ont pas été regardées. Mais taire la refusée serait perdre
   * la seule information qu'on ait : l'opérateur a deux choses à faire, pas une,
   * et un portail qui n'en montre qu'une lui fait croire qu'il a fini.
   */
  const recus = shop.blockers.filter((b) => argentCondition(b) !== null)

  /*
   * LA CLÉ « porte » EST LA BOUTIQUE QUI DIT ELLE-MÊME QU'ELLE N'A PAS PU
   * REGARDER. `Launch::money_hold()` l'émet quand une condition d'argent lève
   * une exception, ou quand la porte est réinterrogée pendant son propre calcul.
   * La compter comme un refus ordinaire sortirait 1, « la boutique a dit non »,
   * alors que la vérité est « la boutique n'a pas pu répondre » : deux pannes
   * différentes, deux endroits où chercher, et c'est la distinction pour
   * laquelle la sortie 2 existe.
   */
  // Sur TOUS les refus et non sur ceux déjà reconnus : si une version future
  // étiquetait cette panne « publication », la classer par étiquette la ferait
  // disparaître, et une porte qui n'a pas pu s'évaluer serait lue comme muette.
  const panne = shop.blockers.filter((b) => String(b?.cle ?? '') === 'porte')
  if (panne.length > 0) {
    return {
      code: 2,
      blockers: recus,
      nonRegarde: ARGENT.map((c) => c.id),
      why: `la boutique dit ne pas avoir pu évaluer sa porte de l'argent : ${panne.map((b) => b.pourquoi).join(' ')}`,
    }
  }

  const vu = argentRegarde(shop)
  if (!vu.regarde) {
    return {
      code: 2,
      blockers: recus,
      nonRegarde: ARGENT.map((c) => c.id),
      why:
        `${vu.comment}. Une liste de refus vide veut aussi bien dire « rien à signaler » que « cette version de l'extension ne sait regarder ni le plancher publié ni la passerelle de paiement », et cette porte refuse plutôt que de choisir la lecture qui autorise à encaisser. ` +
        "Pour la rendre répondable : que « wp teeshoop lancement --porcelaine » ajoute, à côté de « blockers », un champ « regarde » listant les conditions réellement évaluées, dont prix-plancher, textile-nu et paiement.",
    }
  }
  return { code: recus.length === 0 ? 0 : 1, blockers: recus, nonRegarde: [] }
}

function reportArgent(v) {
  if (v.code === 0) {
    console.log(
      `${GREEN}porte de l'argent : RIEN NE REFUSE.${OFF} Les 3 conditions ont été regardées : ${ARGENT.map((c) => c.label).join(' ; ')}.`,
    )
    return
  }
  if (v.code === 2) {
    console.error(
      `${RED}${BOLD}porte de l'argent : REFUS. ${v.nonRegarde.length} des 3 conditions n'ont pas été regardées : ${v.nonRegarde.join(', ')}.${OFF}\n  ${v.why}`,
    )
    if (v.blockers.length > 0) {
      const n = v.blockers.length
      console.error(`\n  ${BOLD}Et ${n} refus d'argent ${n > 1 ? 'sont' : 'est'} déjà ${n > 1 ? 'arrivés' : 'arrivé'} de la boutique :${OFF}`)
      for (const b of v.blockers) console.error(`    ${BOLD}[${b.cle}]${OFF} ${b.pourquoi}`)
      console.error(
        `\n  ${DIM}Deux choses à faire, donc, et non une : lever ${n > 1 ? 'ces refus' : 'ce refus'}, et rendre regardable${v.nonRegarde.length > 1 ? 's' : ''} ${v.nonRegarde.length > 1 ? `les ${v.nonRegarde.length} conditions` : 'la condition'} que la boutique n'a pas regardée${v.nonRegarde.length > 1 ? 's' : ''}.${OFF}`,
      )
    }
    return
  }
  console.log(`${RED}${BOLD}porte de l'argent : REFUS, ${v.blockers.length} raison(s).${OFF}\n`)
  for (const b of v.blockers) {
    console.log(`  ${BOLD}[${b.cle}]${OFF} ${b.pourquoi}`)
  }
  console.log(
    `\n${DIM}Aucune dérogation n'existe pour ces trois conditions et il ne faut pas en écrire une : chacune, cassée, coûte de l'argent réel.${OFF}`,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// LA PORTE DE PUBLICATION, et le relevé de dette qu'elle écrit.

const DETTE = join(ROOT, 'docs/DETTE-LANCEMENT.md')
const MOIS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
]

/** Un début de phrase, coupé sur un mot, pour un index qui doit tenir sur une ligne. */
function abrege(texte, max) {
  const t = String(texte ?? '').trim()
  if (t.length <= max) return t
  const coupe = t.slice(0, max)
  const espace = coupe.lastIndexOf(' ')
  return `${espace > 0 ? coupe.slice(0, espace) : coupe}…`
}

/** Une date ISO en français, ou la date brute si elle n'a pas la forme attendue. */
function enFrancais(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''))
  if (!m) return String(iso ?? '')
  return `${Number(m[3])} ${MOIS[Number(m[2]) - 1]} ${m[1]}`
}

/**
 * QUI PEUT LEVER QUOI, ET COMMENT.
 *
 * Un relevé de dette sans propriétaire nommé est une liste de regrets. Les trois
 * noms possibles sont ceux des trois personnes qui peuvent agir : l'associé (une
 * décision commerciale, un contrat, une adhésion, une identité d'entreprise), le
 * développeur (un réglage, un champ, un accès), ou les deux quand la décision
 * appartient à l'un et le geste à l'autre.
 *
 * LE RÉGIME DE TVA EST « LES DEUX », DÉLIBÉRÉMENT. Il ne se décide pas dans ce
 * dépôt et il ne se coche pas dans le registre : la réponse du 1er septembre
 * 2026 est « conserver l'hypothèse de TVA à 20 % ... sous réserve de validation
 * comptable », qui est le mot à mot d'une hypothèse maintenue. L'associé fait
 * trancher son comptable, le développeur écrit la période datée dans la
 * boutique. Aucun des deux ne peut finir seul.
 */
const METIER = {
  registre: {
    condition: 'Registre des hypothèses',
    proprietaire: 'associé',
    lever: (b) =>
      `Répondre à la question ${String(b.registre?.question ?? '').replace(/^Q/, '')} dans QUESTIONS-ASSOCIE.md, puis porter la date de la réponse sur la ligne ${b.registre?.id ?? '?'} de docs/hypotheses.json (champ « answered »). Tant qu'elle n'y est pas, ce chiffre part en ligne sous le nom d'un prix sans que personne l'ait confirmé.`,
  },
  tva: {
    condition: 'Régime et barème de TVA',
    proprietaire: 'les deux',
    lever: () =>
      "L'associé fait confirmer le régime par son comptable, dans un sens ou dans l'autre, et la réponse est datée sur H-Q17-TVA. Le développeur écrit ensuite la période datée dans le barème de la boutique. La boutique a déjà encaissé quinze commandes avec le calcul des taxes désactivé.",
  },
  mediation: {
    condition: 'Médiation de la consommation',
    proprietaire: 'les deux',
    lever: () =>
      "Adhérer à un médiateur de la consommation et publier ses coordonnées, OU fermer réellement le parcours grand public (question 62). L'une des deux suffit ; c'est l'associé qui choisit et le développeur qui applique. Article L612-1 du code de la consommation.",
  },
  identite: {
    condition: 'Identité légale du vendeur',
    proprietaire: 'associé',
    lever: () =>
      'Fournir la mention manquante (raison sociale, forme juridique, adresse, SIRET, TVA intracommunautaire, capital) et la saisir dans les réglages Teeshoop. Sans elle aucune facture conforme ne peut être émise : article 242 nonies A de l’annexe II au code général des impôts.',
  },
  editeur: {
    condition: 'Identité du site (article 6 III de la LCEN)',
    proprietaire: 'développeur',
    lever: () =>
      "Renseigner la mention manquante du site : directeur de la publication, adresse de contact, et raison sociale, adresse et téléphone de l'hébergeur. La source pour o2switch est sa page contractuelle, désignée par ACCES-REQUIS.md.",
  },
  cgv: {
    condition: 'Conditions générales de vente',
    proprietaire: 'associé',
    lever: () =>
      "Désigner l'avocat ou le cabinet annoncé en réponse à la question 58, lui faire relire la version en vigueur, puis enregistrer sur cette version le nom du relecteur et la date de sa relecture. Un état « validé » que personne ne signe ne vaut pas mieux qu'un projet.",
  },
  'textile-nu': {
    condition: 'Textile nu déclaré',
    proprietaire: 'développeur',
    lever: () =>
      "Poser la référence de textile nu et sa carte de coloris sur la fiche produit, ou retirer le produit de la vente. Sans elle l'atelier ne sait pas quoi acheter et le panier d'achat refuse la ligne par son nom, après que le client a payé.",
  },
  'prix-plancher': {
    condition: 'Prix au-dessus de son plancher',
    proprietaire: 'développeur',
    lever: () =>
      'Mesurer la grille publiée contre son plancher de coût (« npm run verify:grille »), puis, si une colonne vend sous le sien, remonter son prix ou corriger le coût qui fait monter ce plancher. Une vente sous le plancher se fait à perte et rien ne le montre avant la clôture comptable.',
  },
  paiement: {
    condition: 'Passerelle de paiement',
    proprietaire: 'développeur',
    lever: () =>
      "Configurer la passerelle avant d'encaisser : clés en mode réel, devise, et point de rappel (webhook) joignable. Une passerelle mal configurée encaisse ailleurs, ou n'encaisse pas.",
  },
  porte: {
    condition: 'Porte de l’argent évaluable dans la boutique',
    proprietaire: 'développeur',
    lever: () =>
      "La boutique n'a pas pu évaluer sa propre porte de l'argent : une condition a levé une exception, ou la porte s'est réinterrogée pendant son calcul. Corriger la panne dans wp-plugins/teeshoop-core/includes/Launch.php, puis redemander. Tant qu'elle dure, le plancher, le textile nu et la passerelle ne sont ni tenus ni non tenus : personne ne les a lus.",
  },
  boutique: {
    condition: 'Boutique interrogeable',
    proprietaire: 'développeur',
    lever: () =>
      'Rétablir l’accès à la boutique (extension déployée, wp-cli exécutable, clé SSH acceptée), puis régénérer ce relevé. Les conditions listées comme non regardées ne sont ni tenues ni non tenues : personne ne les a lues.',
  },
}

/** Le poste de dette d'un refus, quelle que soit la moitié du portail qui l'a produit. */
function ligneDeDette(b) {
  const fiche = METIER[b.cle] ?? {
    condition: `Condition « ${b.cle} », inconnue de ce relevé`,
    proprietaire: 'développeur',
    lever: () =>
      "Cette condition est neuve et la table des propriétaires de scripts/launch-gate.mjs ne la connaît pas encore. La router vers son propriétaire réel, et compléter la table plutôt que de laisser une dette sans nom.",
  }
  /*
   * LA TVA EST LA SEULE LIGNE DE REGISTRE QUI CHANGE DE PROPRIÉTAIRE. Elle n'est
   * pas une décision commerciale de l'associé seul : le régime se fait trancher
   * par un comptable et s'écrit ensuite dans la boutique. La ranger avec les
   * tarifs enverrait le développeur attendre une réponse dont une moitié est la
   * sienne.
   */
  const idRegistre = String(b.registre?.id ?? '')
  const proprietaire = idRegistre.startsWith('H-Q17-TVA') || idRegistre === 'H-Q17-REGIME-DEPUIS' ? 'les deux' : fiche.proprietaire
  return {
    cle: String(b.cle ?? ''),
    condition: fiche.condition,
    proprietaire,
    titre: idRegistre === '' ? fiche.condition : `${fiche.condition} · ${idRegistre}`,
    depuis: b.registre?.depuis ?? '',
    /*
     * COERCÉ, parce que ce texte vient de PHP à travers un tuyau. Un refus sans
     * raison écrirait « undefined » dans un document que l'associé va lire, et
     * « undefined » est le mot qui fait douter de tout le reste de la page.
     */
    constat: String(b.pourquoi ?? '').trim() === '' ? 'La boutique refuse sans dire pourquoi.' : String(b.pourquoi),
    lever: fiche.lever(b),
    argent: argentCondition(b) !== null,
  }
}

/**
 * Le relevé, en Markdown simple parce qu'il est destiné à deux lecteurs qui ne
 * savent pas lire la même chose : le journal d'intégration continue, qui
 * l'imprime tel quel, et l'administration WordPress, qui le rend.
 *
 * L'ORDRE EST DÉTERMINISTE ET C'EST UNE PROPRIÉTÉ, PAS UN DÉTAIL. Ce fichier est
 * suivi par git et régénéré ; un ordre qui bouge à chaque exécution rendrait
 * illisible le seul diff qui compte, celui qui dit ce qui a été levé depuis la
 * dernière fois.
 */
function reledette({ rows, target, reached, deliberate, looked, unlooked, aujourdhui }) {
  const par = (nom) => rows.filter((r) => r.proprietaire === nom)
  const bloc = (r) =>
    [
      `- **${r.titre}**${r.depuis ? ` (hypothèse tenue depuis le ${enFrancais(r.depuis)})` : ''}${r.argent ? ' · **refusée par la porte de l’argent**' : ''}`,
      `  - Constat : ${r.constat}`,
      `  - Pour lever : ${r.lever}`,
    ].join('\n')

  const argent = rows.filter((r) => r.argent)
  const out = []
  out.push('# Dette de lancement')
  out.push('')
  /*
   * LA COMMANDE RÉELLE, ET NON UNE COMMANDE RECONSTITUÉE. La première version
   * écrivait toujours « --boutique=miroir » dans l'entête, y compris sous
   * `--depot`, qui n'interroge aucune boutique : le relevé annonçait donc une
   * mesure qu'il n'avait pas faite, dans sa toute première ligne.
   */
  out.push(`Relevé le ${enFrancais(aujourdhui)} par \`node scripts/launch-gate.mjs ${ARGS.join(' ')}\`.`)
  out.push('')
  out.push(`- **${rows.length} ligne(s) de dette.**`)
  out.push(
    deliberate
      ? '- Boutique **délibérément pas interrogée** (`--depot`) : seul le registre a été lu.'
      : `- Boutique interrogée : ${target}, ${reached ? 'jointe' : '**non jointe**'}.`,
  )
  out.push(`- Conditions regardées : ${looked.join(', ') || 'aucune'}.`)
  out.push(`- Conditions NON regardées : ${unlooked.join(', ') || 'aucune'}.`)
  /*
   * ZÉRO REFUS D'ARGENT SUR UNE BOUTIQUE QUI N'A PAS RÉPONDU NE VEUT RIEN DIRE,
   * et l'écrire comme un compte le ferait lire comme « rien à signaler ». Les
   * trois conditions de l'argent sont toutes dans la boutique.
   */
  out.push(
    !reached
      ? deliberate
        ? "- La porte de l'argent n'a rien regardé : ses trois conditions sont dans la boutique, et `--depot` ne l'interroge pas."
        : "- La porte de l'argent n'a RIEN pu regarder : ses trois conditions sont dans la boutique, et la boutique n'a pas répondu."
      : argent.length === 1
        ? "- Dont 1 que la porte de l'argent refuse, et qui bloque donc encore la mise en vente."
        : argent.length === 0
          ? "- Aucune de ces lignes n'est de la compétence de la porte de l'argent. Son verdict se demande à part, elle est la seule à le rendre : `node scripts/launch-gate.mjs --porte=argent`."
          : `- Dont ${argent.length} que la porte de l'argent refuse, et qui bloquent donc encore la mise en vente.`,
  )
  out.push('')
  /*
   * Un relevé est une photographie, et une photographie du miroir prise pendant
   * `npm run test:wp` contient les montages de la suite : mesuré cette nuit, le
   * compte est monté de 19 à 29 puis redescendu à 19 en huit minutes. Le dire
   * ici évite qu'un lecteur conclue à une régression sur un produit qui
   * n'existait que le temps d'une suite d'intégration.
   */
  out.push(
    "Ce relevé est une photographie de la boutique nommée ci-dessus, à la date ci-dessus. Il se",
  )
  out.push('régénère, et il faut le régénérer avant de conclure quoi que ce soit de son compte.')
  out.push('')
  out.push(
    "Ce fichier n'est pas une dérogation et il n'en accorde aucune. Il existe parce qu'un portail",
  )
  out.push(
    "unique, qui refusait la mise en ligne tant qu'un avocat n'avait pas relu les conditions",
  )
  out.push(
    "générales, n'était pas obéi : il était contourné. La publication n'est plus bloquée par une",
  )
  out.push(
    "dette juridique ou documentaire. Elle est écrite ici, datée, avec le nom de qui peut la lever",
  )
  out.push('et le geste exact qui la lève.')
  out.push('')
  out.push(
    "Ce qui coûte de l'argent, lui, refuse toujours : `node scripts/launch-gate.mjs --porte=argent`",
  )
  out.push(
    "sort non-zéro sur un prix sous son plancher, un textile nu non déclaré sur un produit en vente,",
  )
  out.push("ou une passerelle de paiement mal configurée. Il n'y a pas de dérogation pour ces trois-là.")
  out.push('')
  out.push('---')
  out.push('')

  if (rows.length === 0) {
    out.push('## Rien')
    out.push('')
    out.push(
      "Aucune condition du portail ne refuse aujourd'hui sur la boutique interrogée ci-dessus. Ce n'est",
    )
    out.push(
      "pas une autorisation générale : les conditions non regardées listées en tête, s'il y en a, ne sont",
    )
    out.push('ni tenues ni non tenues.')
    out.push('')
    return out.join('\n')
  }

  if (argent.length > 0) {
    out.push(`## Ce que la porte de l'argent refuse encore (${argent.length})`)
    out.push('')
    out.push(
      "Ces lignes ne sont pas de la dette : ce sont des refus. Tant qu'elles sont là, la boutique ne doit",
    )
    out.push(
      'pas vendre, quoi que dise le reste de ce fichier. Chacune est détaillée plus bas, sous son',
    )
    out.push('propriétaire ; cet index existe pour être lu en premier.')
    out.push('')
    /*
     * L'INDEX PORTE DE QUOI DISTINGUER DEUX LIGNES DE MÊME CONDITION. Trois
     * produits sans textile nu donnaient trois puces identiques, et une liste
     * de refus où l'on ne peut pas dire lequel a été levé ne se relit pas.
     */
    for (const r of argent) out.push(`- ${r.titre} (${r.proprietaire}) : ${abrege(r.constat, 90)}`)
    out.push('')
  }

  /*
   * TROIS SECTIONS, PUIS UNE QUATRIÈME QUI RAMASSE LE RESTE.
   *
   * Sans elle, un poste dont le propriétaire ne serait aucun des trois noms
   * serait compté dans l'entête et absent du corps : une entête qui annonce un
   * compte que le corps ne porte pas est exactement le genre de document auquel
   * ce dépôt a déjà cru. Elle ne devrait jamais rien contenir, et c'est
   * précisément pour cela qu'elle existe.
   */
  const CONNUS = ['associé', 'les deux', 'développeur']
  for (const nom of CONNUS) {
    const lot = par(nom)
    if (lot.length === 0) continue
    out.push(`## ${nom} (${lot.length})`)
    out.push('')
    for (const r of lot) out.push(bloc(r))
    out.push('')
  }
  const orphelins = rows.filter((r) => !CONNUS.includes(r.proprietaire))
  if (orphelins.length > 0) {
    out.push(`## Sans propriétaire nommé (${orphelins.length})`)
    out.push('')
    out.push(
      "Ces lignes sont un défaut de ce relevé, pas de la boutique : leur propriétaire n'est aucun des",
    )
    out.push('trois noms prévus. Les router, et corriger la table de scripts/launch-gate.mjs.')
    out.push('')
    for (const r of orphelins) out.push(bloc(r))
    out.push('')
  }

  out.push('---')
  out.push('')
  out.push(
    'Régénéré par la porte de publication. Le diff de ce fichier est la seule preuve qu’une ligne a été levée.',
  )
  out.push('')
  return out.join('\n')
}

/*
 * LA PORTE DE L'ARGENT PART AVANT LE REGISTRE, ET C'EST VOULU.
 *
 * Aucune de ses trois conditions ne vit dans `docs/hypotheses.json`. Un registre
 * illisible est un refus du portail complet, ce qu'il reste ci-dessous ; il
 * n'apprend rien sur un prix sous son plancher. Une porte qui refuse pour une
 * raison qui n'est pas la sienne apprend à son opérateur à ne pas la lire.
 */
if (PORTE === 'argent') {
  const shopArgent = shopBlockers(TARGET)
  const verdict = porteArgent(shopArgent)
  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          porte: 'argent',
          verdict: verdict.code === 0 ? 'autorisee' : 'refusee',
          code: verdict.code,
          boutique: TARGET.label,
          conditions: ARGENT.map((c) => c.id),
          non_regarde: verdict.nonRegarde,
          blockers: verdict.blockers,
          why: verdict.why ?? null,
        },
        null,
        2,
      ),
    )
    process.exit(verdict.code)
  }
  console.log(`${DIM}boutique interrogée : ${TARGET.label}${OFF}`)
  reportArgent(verdict)
  process.exit(verdict.code)
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
      // Les deux conditions que la boutique évalue depuis le 05/09/2026. Elles
      // sont tranchées en détail plus bas par la porte de l'argent ; elles sont
      // ici parce que le portail COMPLET doit refuser dessus lui aussi.
      name: 'prix-plancher',
      why: 'une colonne publiée qui vend sous son plancher de coût',
      ledger: () => clone(),
      shop: () => ({ ok: true, blockers: [{ cle: 'prix-plancher', pourquoi: 'colonne sous son plancher', porte: 'argent' }] }),
    },
    {
      name: 'paiement',
      why: 'une passerelle de paiement qui n’est pas ce qu’elle annonce',
      ledger: () => clone(),
      shop: () => ({ ok: true, blockers: [{ cle: 'paiement', pourquoi: 'clés en mode test', porte: 'argent' }] }),
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

  /*
   * LA PORTE DE L'ARGENT, DANS LES DEUX SENS ET SUR LES TROIS CODES.
   *
   * Elle doit refuser sur chacune de ses trois conditions, refuser quand elle
   * n'a pas pu les regarder, ET LAISSER PASSER une boutique qui n'a que de la
   * dette juridique. Ce dernier cas est le plus important des six : c'est la
   * différence entre une porte et un mur, et c'est la décision du 5 septembre
   * 2026 qui la rend vraie. Sans lui, rien ne prouverait que le portail a
   * vraiment été coupé en deux.
   */
  const DECLARE = ['prix-plancher', 'textile-nu', 'paiement']
  const argentCases = [
    {
      label: 'un prix sous son plancher',
      shop: { ok: true, regarde: DECLARE, blockers: [{ cle: 'prix-plancher', pourquoi: 'colonne M à 21,90 EUR pour un plancher à 23,80 EUR' }] },
      want: 1,
    },
    {
      label: 'un textile nu non déclaré sur un produit en vente',
      shop: { ok: true, regarde: DECLARE, blockers: [{ cle: 'textile-nu', pourquoi: 'aucune référence' }] },
      want: 1,
    },
    {
      label: 'une passerelle de paiement mal configurée',
      shop: { ok: true, regarde: DECLARE, blockers: [{ cle: 'paiement', pourquoi: 'clés en mode test' }] },
      want: 1,
    },
    {
      label: 'la boutique ne dit rien et ne refuse rien : on ne sait pas si elle a regardé',
      shop: { ok: true, regarde: null, blockers: [] },
      want: 2,
    },
    {
      label: 'la boutique n’a regardé que deux des trois',
      shop: { ok: true, regarde: ['prix-plancher', 'textile-nu'], blockers: [] },
      want: 2,
    },
    {
      label: 'une extension d’avant le 5 septembre : des refus sans étiquette de porte',
      shop: { ok: true, regarde: null, blockers: [{ cle: 'cgv', pourquoi: 'version en projet' }] },
      want: 2,
    },
    {
      label: 'des refus tous étiquetés, dont un d’argent : elle a regardé, et elle refuse',
      shop: {
        ok: true,
        regarde: null,
        blockers: [
          { cle: 'cgv', pourquoi: 'version en projet', porte: 'publication' },
          { cle: 'prix-plancher', pourquoi: 'colonne sous son plancher', porte: 'argent' },
        ],
      },
      want: 1,
    },
    {
      label: 'des refus tous étiquetés, aucun d’argent : elle a regardé, et elle laisse passer',
      shop: {
        ok: true,
        regarde: null,
        blockers: [{ cle: 'cgv', pourquoi: 'version en projet', porte: 'publication' }],
      },
      want: 0,
    },
    {
      label: 'une clé neuve que ce script ne connaît pas, étiquetée argent par la boutique',
      shop: {
        ok: true,
        regarde: DECLARE,
        blockers: [{ cle: 'commission-negative', pourquoi: 'la remise dépasse la marge', porte: 'argent' }],
      },
      want: 1,
    },
    {
      label: 'une clé d’argent que la boutique étiquette « publication » : l’union refuse quand même',
      shop: {
        ok: true,
        regarde: DECLARE,
        blockers: [{ cle: 'textile-nu', pourquoi: 'aucune référence', porte: 'publication' }],
      },
      want: 1,
    },
    {
      label: 'la boutique n’a pas répondu du tout',
      shop: { ok: false, why: 'ssh a expiré' },
      want: 2,
    },
    {
      label: 'la boutique dit qu’elle n’a pas pu évaluer sa porte de l’argent',
      shop: {
        ok: true,
        regarde: DECLARE,
        blockers: [{ cle: 'porte', pourquoi: 'la porte argent a levé une exception', porte: 'argent' }],
      },
      want: 2,
    },
    {
      label: 'de la dette juridique seule : cgv, médiation, identité',
      shop: {
        ok: true,
        regarde: DECLARE,
        blockers: [
          { cle: 'cgv', pourquoi: 'version en projet' },
          { cle: 'identite', pourquoi: 'SIRET absent' },
          { cle: 'editeur', pourquoi: 'hébergeur absent' },
        ],
      },
      want: 0,
    },
    {
      label: 'rien du tout',
      shop: { ok: true, regarde: DECLARE, blockers: [] },
      want: 0,
    },
  ]
  for (const c of argentCases) {
    const got = porteArgent(c.shop).code
    const good = got === c.want
    console.log(`  ${good ? 'ARGENT OK ' : 'ARGENT FAUX'}  [sortie ${got}, attendu ${c.want}] ${c.label}`)
    if (!good) allFired = false
  }

  /*
   * LE RELEVÉ DE DETTE : chaque refus doit ressortir avec un propriétaire NOMMÉ
   * et un geste. Une dette sans nom est une liste de regrets, et c'est
   * précisément ce que ce fichier remplace. Le cas de la clé inconnue est là
   * parce que la moitié PHP du portail peut en émettre une neuve : elle doit
   * atterrir chez quelqu'un, pas dans le silence.
   */
  const NOMS = new Set(['associé', 'développeur', 'les deux'])
  const detteCases = [
    { b: { cle: 'registre', pourquoi: 'x', registre: { id: 'H-Q06-TARIF-TEE', question: 'Q06', depuis: '2026-08-12' } }, proprietaire: 'associé', argent: false },
    { b: { cle: 'registre', pourquoi: 'x', registre: { id: 'H-Q17-TVA', question: 'Q17', depuis: '2026-08-12' } }, proprietaire: 'les deux', argent: false },
    { b: { cle: 'cgv', pourquoi: 'x' }, proprietaire: 'associé', argent: false },
    { b: { cle: 'editeur', pourquoi: 'x' }, proprietaire: 'développeur', argent: false },
    { b: { cle: 'mediation', pourquoi: 'x' }, proprietaire: 'les deux', argent: false },
    { b: { cle: 'textile-nu', pourquoi: 'x' }, proprietaire: 'développeur', argent: true },
    { b: { cle: 'prix-plancher', pourquoi: 'x' }, proprietaire: 'développeur', argent: true },
    { b: { cle: 'paiement', pourquoi: 'x' }, proprietaire: 'développeur', argent: true },
    { b: { cle: 'condition-de-demain', pourquoi: 'x' }, proprietaire: 'développeur', argent: false },
    { b: { cle: 'porte', pourquoi: 'x', porte: 'argent' }, proprietaire: 'développeur', argent: true },
    // Un refus qui arrive sans raison : le relevé doit écrire une phrase, pas
    // « undefined », dans un document que l'associé va lire.
    { b: { cle: 'cgv' }, proprietaire: 'associé', argent: false },
  ]
  for (const c of detteCases) {
    const r = ligneDeDette(c.b)
    const good =
      r.proprietaire === c.proprietaire &&
      NOMS.has(r.proprietaire) &&
      r.argent === c.argent &&
      typeof r.lever === 'string' &&
      r.lever.length > 40
    console.log(`  ${good ? 'DETTE OK  ' : 'DETTE FAUX'}  [${c.b.cle} -> ${r.proprietaire}${r.argent ? ', argent' : ''}] geste de ${r.lever.length} caractère(s)`)
    if (!good) allFired = false
  }

  /*
   * ET LE RELEVÉ LUI-MÊME COMPTE JUSTE. Le nombre de lignes est la première
   * chose qu'un lecteur croit, et une entête qui annonce un compte que le corps
   * ne porte pas est exactement le genre de portail auquel ce dépôt a déjà cru.
   */
  const echantillon = detteCases.map((c) => ligneDeDette(c.b))
  const rendu = reledette({
    rows: echantillon,
    target: 'auto-test',
    reached: true,
    looked: ['registre'],
    unlooked: [],
    aujourdhui: '2026-09-05',
  })
  const comptes = rendu.includes(`**${echantillon.length} ligne(s) de dette.**`)
  const blocs = (rendu.match(/^ {2}- Pour lever :/gm) ?? []).length
  const attendus = echantillon.length
  const renduOk = comptes && blocs === attendus
  console.log(
    `  ${renduOk ? 'RELEVÉ OK ' : 'RELEVÉ FAUX'}  [${echantillon.length} ligne(s) annoncée(s), ${blocs} bloc(s) rendus pour ${attendus} attendus]`,
  )
  if (!renduOk) allFired = false

  if (!allFired) {
    console.error(`\n${RED}launch-gate --self-test: au moins un contrôle ne se déclenche pas. Il ne prouve rien.${OFF}`)
    process.exit(2)
  }
  console.log(
    `\nlaunch-gate --self-test: les ${cases.length} conditions refusent, les ${exitCases.length} codes de sortie sont les bons, ` +
      `un dépôt propre passe, la porte de l'argent tranche les ${argentCases.length} cas, et les ${detteCases.length} postes de dette ont un propriétaire nommé.`,
  )
  process.exit(0)
}

const shop = DEPOT_ONLY
  ? { ok: false, deliberate: true, why: '--depot : la boutique n’a délibérément pas été interrogée.' }
  : shopBlockers(TARGET)

const result = gate({ ledger: loaded.data, shop })
const code = exitCode(result)

/*
 * LA PORTE DE PUBLICATION : le même relevé, écrit au lieu d'être opposé.
 *
 * Elle lit `result` et ne recalcule rien : les mêmes huit conditions, la même
 * liste de refus, le même ordre. Deux lectures divergeraient, et le jour où
 * elles divergeraient le relevé de dette dirait « levé » sur une ligne que le
 * portail refuse encore.
 *
 * ELLE SORT 0 SUR UNE DETTE, ET NON SUR UN ÉCHEC D'ÉCRITURE. Un relevé qu'on n'a
 * pas pu écrire est un relevé que personne ne lira : la publication continue,
 * la dette disparaît, et c'est exactement la situation que ce fichier remplace.
 */
if (PORTE === 'publication') {
  const rows = result.blockers.map(ligneDeDette)
  const aujourdhui = new Date().toISOString().slice(0, 10)
  const texte = reledette({
    rows,
    target: TARGET.label,
    reached: shop.ok === true,
    deliberate: shop.deliberate === true,
    looked: result.looked,
    unlooked: result.unlooked,
    aujourdhui,
  })
  /*
   * TEESHOOP_DETTE existe pour une raison précise : une intégration continue qui
   * tourne sans boutique produit un relevé où cinq conditions sur huit sont
   * « non regardées ». L'écrire par-dessus un relevé informé remplacerait une
   * mesure par une absence de mesure, dans un fichier suivi par git.
   */
  const dest = (process.env.TEESHOOP_DETTE ?? '').trim() !== '' ? process.env.TEESHOOP_DETTE.trim() : DETTE
  try {
    writeFileSync(dest, texte)
  } catch (e) {
    console.error(
      `${RED}launch-gate --porte=publication : le relevé de dette n'a pas pu être écrit dans ${dest} : ${e.message}. ` +
        `Sortie 2 : publier en perdant la liste de ce qui manque, c'est la situation que ce relevé remplace.${OFF}`,
    )
    process.exit(2)
  }
  const argent = rows.filter((r) => r.argent).length
  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          porte: 'publication',
          verdict: 'publication autorisee',
          code: 0,
          fichier: dest,
          releve_le: aujourdhui,
          lignes: rows.length,
          dont_argent: argent,
          boutique: TARGET.label,
          jointe: shop.ok === true,
          looked: result.looked,
          unlooked: result.unlooked,
          dette: rows.map((r) => ({ cle: r.cle, titre: r.titre, proprietaire: r.proprietaire, depuis: r.depuis, argent: r.argent })),
        },
        null,
        2,
      ),
    )
    process.exit(0)
  }
  console.log(`${DIM}boutique interrogée : ${TARGET.label}${OFF}`)
  console.log(
    `${GREEN}porte de publication : PUBLICATION AUTORISÉE.${OFF} ${rows.length} ligne(s) de dette écrite(s) dans ${dest}.`,
  )
  const parProprio = new Map()
  for (const r of rows) parProprio.set(r.proprietaire, (parProprio.get(r.proprietaire) ?? 0) + 1)
  for (const [nom, n] of parProprio) console.log(`  ${nom} : ${n}`)
  if (argent > 0) {
    console.log(
      `\n${RED}${BOLD}${argent === 1 ? "1 de ces lignes est refusée" : `${argent} de ces lignes sont refusées`} par la porte de l'argent : la boutique ne doit pas vendre.${OFF}`,
    )
    console.log(`${DIM}node scripts/launch-gate.mjs --porte=argent --boutique=${TARGET_RAW}${OFF}`)
  }
  if (!shop.ok) {
    console.log(
      `\n${DIM}La boutique n'a pas répondu : ${result.unlooked.length} condition(s) sont écrites comme NON regardées. Ce relevé est moins informé qu'un relevé pris contre une boutique qui répond.${OFF}`,
    )
  }
  process.exit(0)
}

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
