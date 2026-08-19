/**
 * The paperwork of a print run: who is on this film, where each transfer goes,
 * and what to pull off a shelf before pressing it.
 *
 * WHY IT IS NOT A SECOND ARCHIVE. `zipExport.ts` already builds the print
 * files, the cutting plans, a README and a manifest, and it already refuses to
 * ship an archive with a missing source. A run needs those exact things plus
 * three documents, so this module produces the three and hands them to
 * `buildOrderZip` as extra members. Two archive builders would drift, and the
 * one that drifted would be the one the workshop opened.
 *
 * WHAT A RUN ARCHIVE HAS TO ANSWER, and the Bible's chapter 5 asks for every one
 * of them by name in its « fiche de fabrication »: commande, client, BAT,
 * référence, quantités, emplacement, dimensions, pression, température, durée,
 * pelage, seconde presse, opérateur, contrôles.
 *
 *   WHOSE IS THIS TRANSFER. A pooled sheet carries several customers' artwork.
 *   Every piece on it is keyed by its order, so the cutting plan's own labels
 *   already say, and the press sheet says it again the other way round: here is
 *   the order, here is every transfer of it, here is where each one goes.
 *
 *   WHICH PROOF DID THEY APPROVE. A dispute is « this is not what I approved »,
 *   and the answer is an order number, a proof VERSION and a design id. All
 *   three are on the press sheet and in the manifest, and the version is the one
 *   that was current when the lot was built, never « the latest ».
 *
 *   WHAT DO I FETCH FROM THE SHELF. One picking list for the whole run, because
 *   that is how a shelf is walked.
 *
 * THE PRESSING PARAMETERS ARE NOT INVENTED. Temperature, time and pressure
 * belong to the film supplier and this shop has not chosen one; the sheet says
 * so and leaves the line for the operator rather than printing a plausible
 * 160 °C that somebody would follow.
 */
import { safeFileName, textEntry, type ZipEntry } from '@/lib/zip'
import type { ManifestPiece } from './sheet'
import type { NestResult } from './nesting'
import type { PickRow } from './fromR2'

/** One order's place in a run, as the SHOP computed it. Never recomputed here. */
export interface RunArchiveOrder {
  id: string
  ref: string
  customer: string
  urgency: string
  /** The date the workshop is planning against. Not a promise; see Production.php. */
  targetOn: string
  batVersion: number
  /** `client` when the customer approved it, `atelier` when the shop waived it. */
  batBy: string
  designIds: string[]
  /** Transfer keys on the sheets that belong to this order. */
  keys: string[]
  soloM: number
  soloCents: number
  shareCents: number
  savedCents: number
  areaShareCents: number
  garments: number
}

/** A whole run, as the shop recorded it. */
export interface RunArchive {
  lotId: number
  origin: 'fr' | 'es'
  state: string
  createdOn: string
  /** Latest day the film may be ordered without missing somebody's date. */
  orderByOn: string
  pooledM: number
  totalCents: number
  soloTotalCents: number
  savedCents: number
  /** True when the run costs MORE than the same orders bought apart. */
  worse: boolean
  orders: RunArchiveOrder[]
  picking: PickRow[]
  warnings: string[]
}

const eur = (cents: number): string =>
  `${(cents / 100).toFixed(2).replace('.', ',')} EUR HT`
const n1 = (v: number): string => v.toFixed(1).replace('.', ',')
const frDate = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}
const pad = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length))
const padStart = (s: string, n: number): string =>
  s.length >= n ? s : ' '.repeat(n - s.length) + s
const rule = (title: string): string[] => ['', title.toUpperCase(), '-'.repeat(Math.max(8, title.length))]

/**
 * Where each of an order's transfers sits on which sheet.
 *
 * A pooled film is cut once and sorted into as many piles as there are orders,
 * so « planche 2 » is the first thing an operator needs and the last thing the
 * per-order view would otherwise carry.
 */
function sheetsOf(result: NestResult, key: string): number[] {
  const out: number[] = []
  for (const sheet of result.sheets)
    if (sheet.placements.some((p) => p.sourceKey === key)) out.push(sheet.index)
  return out
}

/**
 * The press sheet for one order: every transfer, its size, where it goes, and
 * which sheet of the run it was cut from.
 *
 * The placement is the two numbers a press table gives you for free, and they
 * are the same two `zipExport.ts` prints for a single order: the drop from the
 * top of the print area and the offset from the centre line. A split side hands
 * the press several transfers that used to be one file, and without these there
 * is nothing in the archive saying which goes where.
 */
export function pressSheet(
  run: RunArchive,
  order: RunArchiveOrder,
  pieces: readonly ManifestPiece[],
  result: NestResult,
  labels: ReadonlyMap<string, string>,
): string {
  const mine = pieces.filter((p) => order.keys.includes(p.sourceKey))
  const L: string[] = []

  L.push(
    `FICHE DE POSE, COMMANDE ${order.ref}`,
    '='.repeat(60),
    `Lot n° ${run.lotId}, film ${run.origin === 'es' ? 'Espagne' : 'France'}, constitué le ${frDate(run.createdOn)}`,
  )

  L.push(...rule('Commande'))
  L.push(
    `  Client        ${order.customer || 'non renseigné'}`,
    `  Urgence       ${order.urgency}`,
    `  Date cible    ${frDate(order.targetOn)}   (objectif d’atelier, aucun délai n’est annoncé au client)`,
    `  Vêtements     ${order.garments}`,
  )

  L.push(...rule('Bon à tirer'))
  /*
   * THE VERSION, AND WHO CLEARED IT. This is the chain a dispute runs on. A
   * waiver authorises production exactly as an approval does, and it means
   * something entirely different: nobody approved anything, the workshop decided
   * to go ahead. Printing both as « validé » would make the record useless on
   * the one day it is read.
   */
  L.push(
    `  Version       ${order.batVersion}`,
    order.batBy === 'client'
      ? '  Validé par    le client'
      : '  Validé par    l’atelier, par renonciation. Aucune validation client sur cette version.',
    `  Création(s)   ${order.designIds.join(', ') || 'aucune'}`,
  )

  L.push(...rule('Transferts à poser'))
  if (mine.length === 0) {
    L.push('  Aucun transfert de cette commande sur ce film.')
  } else {
    L.push(
      '  ' +
        pad('Transfert', 40) +
        pad('Qté', 6) +
        pad('Taille cm', 16) +
        pad('Planche', 10) +
        'Pose',
    )
    for (const p of mine) {
      const on = sheetsOf(result, p.sourceKey)
      const pl = p.placement
      const pose = pl
        ? `${n1(pl.topCm)} cm sous le haut de zone, ` +
          (Math.abs(pl.centerDxCm) < 0.05
            ? 'centré'
            : `${n1(Math.abs(pl.centerDxCm))} cm ${pl.centerDxCm > 0 ? 'à droite' : 'à gauche'} de l’axe`)
        : 'position non mesurée'
      L.push(
        '  ' +
          pad((labels.get(p.sourceKey) ?? p.sourceKey).slice(0, 39), 40) +
          pad(String(p.qty), 6) +
          pad(`${n1(p.wCm)} x ${n1(p.hCm)}`, 16) +
          pad(on.length ? on.join(', ') : 'absente', 10) +
          pose,
      )
    }
  }

  L.push(...rule('Presse'))
  /*
   * LEFT BLANK ON PURPOSE. The film supplier publishes the temperature, the
   * time, the pressure and whether the liner peels hot or cold, and they differ
   * between suppliers by 20 °C and by the direction of the peel. This shop has
   * not settled on one, so the sheet asks for the numbers rather than printing
   * ones nobody measured onto the document an operator follows.
   */
  L.push(
    '  Température   ............  °C     (fiche du fournisseur de film)',
    '  Durée         ............  s',
    '  Pression      ............',
    '  Pelage        à chaud / à froid',
    '  Seconde presse  oui / non',
  )

  L.push(...rule('Contrôles'))
  L.push(
    '  Première pièce contrôlée contre le BAT      opérateur ............  heure ........',
    '  Position et dimensions vérifiées            oui / non',
    '  Quantité et tailles vérifiées               oui / non',
    '  Contrôle final                              opérateur ............  heure ........',
  )

  return L.join('\n') + '\n'
}

/** The blanks the whole run needs, one row per SKU, colour and size. */
export function pickingSheet(run: RunArchive): string {
  const L: string[] = [
    `LISTE DE PRÉLÈVEMENT, LOT N° ${run.lotId}`,
    '='.repeat(60),
    `${run.orders.length} commande(s), ${run.orders.reduce((a, o) => a + o.garments, 0)} vêtements`,
    '',
  ]
  if (run.picking.length === 0) {
    L.push('Aucun vêtement à prélever : ce lot ne porte que des supports fournis par le client.')
    return L.join('\n') + '\n'
  }
  L.push(
    pad('Réf. fournisseur', 22) +
      pad('Article', 30) +
      pad('Coloris', 16) +
      pad('Taille', 10) +
      padStart('Qté', 5) +
      '   Commandes',
    '-'.repeat(110),
  )
  for (const row of run.picking)
    L.push(
      pad(row.sku || 'sans référence', 22) +
        pad(row.label.slice(0, 29), 30) +
        pad(row.colour || 'non précisé', 16) +
        pad(row.size, 10) +
        padStart(String(row.qty), 5) +
        '   ' +
        row.orders.join(', '),
    )
  L.push(
    '',
    `TOTAL  ${run.picking.reduce((a, r) => a + r.qty, 0)} vêtements`,
    '',
    'Compter à la réception et rapprocher de cette liste avant de lancer la presse.',
    'Un écart bloque la commande concernée et elle seule : les autres du lot peuvent partir.',
  )
  return L.join('\n') + '\n'
}

/**
 * What the run cost and how it was split, in the archive rather than only on a
 * screen.
 *
 * It is here because the archive is what survives. A margin report lives in
 * WooCommerce and is recomputed; this file is the copy that was true on the day
 * the film was bought, and it is the one to read when somebody asks in March why
 * an order from August cost what it did.
 */
export function costSheet(run: RunArchive): string {
  const L: string[] = [
    `RÉPARTITION DU FILM, LOT N° ${run.lotId}`,
    '='.repeat(60),
    `Film ${run.origin === 'es' ? 'Espagne' : 'France'}, ${n1(run.pooledM)} m imbriqués, à commander avant le ${frDate(run.orderByOn)}`,
    '',
    'La règle : chaque commande paie la même fraction de la facture du lot que ce',
    'qu’elle aurait pesé si chacune avait été achetée séparément. La colonne',
    '« part surface » montre ce qu’aurait donné la règle proportionnelle à la',
    'surface d’encre ; elle est publiée et n’est pas facturée.',
    '',
    pad('Commande', 14) +
      padStart('Seule (m)', 11) +
      padStart('Seule', 13) +
      padStart('Part', 13) +
      padStart('Économie', 13) +
      padStart('Part surface', 15),
    '-'.repeat(80),
  ]
  for (const o of run.orders)
    L.push(
      pad(o.ref, 14) +
        padStart(n1(o.soloM), 11) +
        padStart(eur(o.soloCents), 13) +
        padStart(eur(o.shareCents), 13) +
        padStart(eur(o.savedCents), 13) +
        padStart(eur(o.areaShareCents), 15),
    )
  L.push(
    '-'.repeat(80),
    pad('TOTAL', 14) +
      padStart('', 11) +
      padStart(eur(run.soloTotalCents), 13) +
      padStart(eur(run.totalCents), 13) +
      padStart(eur(run.savedCents), 13),
  )
  if (run.worse)
    L.push(
      '',
      'CE LOT COÛTE PLUS CHER que les mêmes commandes achetées séparément. Les',
      'transferts ne s’imbriquent pas mieux ensemble que chacun de son côté, et le',
      'lot paie une bande perdue que personne ne paie seul.',
    )
  for (const w of run.warnings) L.push('', `! ${w}`)
  return L.join('\n') + '\n'
}

/**
 * The three run documents as archive members.
 *
 * Handed to `buildOrderZip` rather than zipped here, so the run archive is the
 * SAME archive the workshop already knows: one folder, one README, one manifest,
 * the print files and the cutting plans, plus these.
 */
export function runEntries(
  run: RunArchive,
  folder: string,
  pieces: readonly ManifestPiece[],
  result: NestResult,
  labels: ReadonlyMap<string, string>,
  date: Date,
): ZipEntry[] {
  const entries: ZipEntry[] = [
    textEntry(`${folder}/liste-de-prelevement.txt`, pickingSheet(run), date),
    textEntry(`${folder}/repartition-du-film.txt`, costSheet(run), date),
  ]
  for (const order of run.orders)
    entries.push(
      textEntry(
        `${folder}/commandes/${safeFileName(order.ref, 'commande')}/fiche-de-pose.txt`,
        pressSheet(run, order, pieces, result, labels),
        date,
      ),
    )
  return entries
}
