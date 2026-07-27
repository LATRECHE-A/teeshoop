/**
 * DTF order export — the WHOLE job as one .zip.
 *
 * WHY ONE ARCHIVE. The old flow fired one `downloadBlob` per sheet, per
 * cutting plan and for the manifest. Browsers throttle, reorder and silently
 * DROP bursts of programmatic downloads, so a 12-sheet order regularly arrived
 * incomplete — and nothing told the operator which planche was missing. One
 * archive is one user gesture, one atomic artefact, and it carries its own
 * name, date and inventory.
 *
 * MEMORY. A 58 × 250 cm sheet at 300 dpi is 202 M px ≈ 800 MB of RGBA backing
 * store. This module therefore renders ONE sheet canvas at a time and releases
 * it (`width = height = 1`) the instant the PNG blob exists; `createZip` only
 * ever holds the resulting Blobs, which the browser is free to keep on disk.
 * The high-resolution piece sources are the caller's concern — they are shared
 * across sheets, so re-rendering them per sheet would trade memory for minutes.
 *
 * DETERMINISM. `date` is a parameter. Every timestamp in the archive — its
 * filename, each member's DOS date, the README, the manifest — comes from that
 * single instant, so re-exporting the same order twice differs only by the
 * clock reading the caller chose to pass.
 */
import { createZip, isoStamp, safeFileName, textEntry, type ZipEntry } from '@/lib/zip'
import {
  buildManifest,
  renderSheet,
  sheetToPngBlob,
  type DtfManifest,
  type ManifestPiece,
} from './sheet'
import type { NestResult } from './nesting'
import { INTERLOCK_MAX_CM } from './trueshape'
import type { RenderedPiece } from './pieces'
import type { PreflightIssue } from './preflight'
import type { CostBreakdown, DtfProcess, SupplierProfile } from './suppliers'

export interface OrderZipInput {
  /** Operator-entered order / basket name. Drives the archive + folder name. */
  orderName: string
  /** THE timestamp of the export. Never read the clock inside this module. */
  date: Date
  lang: 'fr' | 'en'
  appVersion: string
  result: NestResult
  supplier: SupplierProfile
  process: DtfProcess
  cost: CostBreakdown | null
  preflight: PreflightIssue[]
  pieces: ManifestPiece[]
  /** sourceKey → label, used on the cutting plans and in the README. */
  labels: ReadonlyMap<string, string>
  /** High-resolution artwork for the PRINT files. */
  sources: ReadonlyMap<string, RenderedPiece>
  /** Lighter artwork for the cutting plans (they are read, not printed). */
  planSources: ReadonlyMap<string, RenderedPiece>
  /** Per-sheet effective DPI for the print files (see clampSheetDpi). */
  effectiveDpis: number[]
  requestedDpi: number
  cutplanDpi: number
  restarts: number
  /** 180°/270° were allowed — part of what makes the layout reproducible. */
  flip: boolean
}

export interface OrderZipResult {
  blob: Blob
  fileName: string
  manifest: DtfManifest
}

export interface ZipProgress {
  done: number
  total: number
  /** Already-localised label of what is being produced right now. */
  label: string
}

const T = {
  fr: {
    print: 'impression',
    plan: 'decoupe',
    readme: 'LISEZ-MOI.txt',
    manifest: 'manifeste.json',
    sheet: 'planche',
    stepPrint: 'Planche {n}/{t} — fichier d’impression',
    stepPlan: 'Planche {n}/{t} — plan de découpe',
    stepZip: 'Assemblage de l’archive',
    legendShelf: 'Découpe en bandes droites — couper les lignes bleues, puis les verticales',
    legendRows:
      'Rangées droites — aucune pièce n’en chevauche une autre : couper au ras des cadres roses',
    legendInterlock:
      'Imbrication libre (jusqu’à {i} cm) — suivre le contour rose de chaque pièce',
    legendInterlockMax:
      'Imbrication maximale — suivre le contour rose de chaque pièce, pas de bande droite',
    noArt:
      'Visuel manquant pour {n} pièce(s) : {keys}. Archive annulée — un dossier ' +
      'incomplet envoyé au fournisseur imprime des planches trouées.',
  },
  en: {
    print: 'print',
    plan: 'cutting-plan',
    readme: 'READ-ME.txt',
    manifest: 'manifest.json',
    sheet: 'sheet',
    stepPrint: 'Sheet {n}/{t} — print file',
    stepPlan: 'Sheet {n}/{t} — cutting plan',
    stepZip: 'Assembling the archive',
    legendShelf: 'Straight-strip cutting — cut the blue lines, then the verticals',
    legendRows: 'Straight rows — no piece overhangs another: cut along the pink frames',
    legendInterlock: 'Free interlock (up to {i} cm) — follow each piece’s pink outline',
    legendInterlockMax:
      'Maximum interlock — follow each piece’s pink outline, no straight strips',
    noArt:
      'Missing artwork for {n} piece(s): {keys}. Archive aborted — an incomplete ' +
      'package sent to the supplier prints sheets with holes in them.',
  },
} as const

const fmt = (s: string, p: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (m, k: string) => (k in p ? String(p[k]) : m))

const pad2 = (n: number) => String(n).padStart(2, '0')
const n1 = (v: number) => v.toFixed(1).replace('.', ',')
const n2 = (v: number) => v.toFixed(2).replace('.', ',')
const pct = (v: number) => `${Math.round(v * 100)} %`

/**
 * Fill readout. The INK figure leads whenever it was measured: once pieces
 * interlock, their bounding boxes overlap and the box figure legitimately goes
 * past 100 %, which reads as a bug unless it is labelled as boxes.
 */
const fill = (box: number, ink: number | undefined, fr: boolean): string =>
  ink === undefined
    ? (fr ? 'remplissage ' : 'fill ') + pct(box)
    : `${fr ? 'encre ' : 'ink '}${pct(ink)} · ${fr ? 'boîtes ' : 'boxes '}${pct(box)}`

/**
 * The cutting plan's legend — states the mode, because the plans look alike and
 * are cut very differently.
 *
 * The three cases are NOT interchangeable and getting them wrong hands someone
 * lines that do not exist. Only the SHELF packer produces genuine full-width
 * corridors plus vertical trims, and only its plan draws them (`drawGuides`
 * keys off `shelfYsCm`). The true-shape packer at interlock 0 guarantees
 * something weaker but still straight-cuttable — no piece overhangs another in
 * the columns it spans — and its plan draws only the empty bands that really
 * exist, so promising "puis les verticales" there was a lie.
 *
 * `INTERLOCK_MAX_CM` is a sentinel, not a measurement: printing "jusqu'à
 * 1000,0 cm" on a 100 cm sheet would be absurd, so it gets its own wording.
 */
export function planLegend(result: NestResult, lang: 'fr' | 'en'): string {
  const t = T[lang]
  if (result.packer === 'shelf') return t.legendShelf
  if (result.interlockCm <= 0) return t.legendRows
  return result.interlockCm >= INTERLOCK_MAX_CM
    ? t.legendInterlockMax
    : fmt(t.legendInterlock, { i: n1(result.interlockCm) })
}

/**
 * Render every sheet, wrap the lot with the manifest and a human-readable
 * summary, and return ONE archive blob plus the name to save it under.
 */
export async function buildOrderZip(
  input: OrderZipInput,
  onProgress?: (p: ZipProgress) => void,
): Promise<OrderZipResult> {
  const t = T[input.lang]
  const { result, date } = input
  const sheets = result.sheets
  // REFUSE rather than ship a hole. `renderSheet` skips a placement whose
  // sourceKey is absent from the map — which is right for a live preview and
  // catastrophic for an export: the archive still looks complete (right sheet
  // count, right file names, a plausible manifest) while one transfer is
  // simply not on the film, and nobody finds out until the press. A caller's
  // artwork render CAN fail (an evicted asset, a tainted canvas), so this is a
  // reachable path, not a paranoid assertion.
  const missing = [
    ...new Set(
      sheets.flatMap((s) =>
        s.placements
          .filter((p) => !input.sources.has(p.sourceKey) || !input.planSources.has(p.sourceKey))
          .map((p) => input.labels.get(p.sourceKey) ?? p.sourceKey),
      ),
    ),
  ].sort()
  if (missing.length > 0)
    throw new Error(fmt(t.noArt, { n: missing.length, keys: missing.join(', ') }))

  const folder = safeFileName(input.orderName, 'commande-dtf')
  const total = sheets.length * 2 + 1
  let step = 0
  const tick = (label: string) => onProgress?.({ done: ++step, total, label })

  const entries: ZipEntry[] = []
  const legend = planLegend(result, input.lang)

  for (let i = 0; i < sheets.length; i++) {
    const num = pad2(i + 1)
    tick(fmt(t.stepPrint, { n: i + 1, t: sheets.length }))
    const print = renderSheet(sheets[i], result.options, input.sources, {
      dpi: input.effectiveDpis[i] ?? input.requestedDpi,
      guides: false,
      background: null,
    })
    entries.push({
      name: `${folder}/${t.print}/${t.sheet}-${num}.png`,
      blob: await release(print.canvas),
      date,
    })

    tick(fmt(t.stepPlan, { n: i + 1, t: sheets.length }))
    const plan = renderSheet(sheets[i], result.options, input.planSources, {
      dpi: input.cutplanDpi,
      guides: true,
      background: '#F4F6F8',
      labels: input.labels,
      legend: `${legend}  ·  ${t.sheet} ${i + 1}/${sheets.length}`,
    })
    entries.push({
      name: `${folder}/${t.plan}/${t.sheet}-${num}.png`,
      blob: await release(plan.canvas),
      date,
    })
  }

  const manifest = buildManifest({
    result,
    supplier: input.supplier,
    process: input.process,
    cost: input.cost,
    requestedDpi: input.requestedDpi,
    effectiveDpis: input.effectiveDpis,
    pieces: input.pieces,
    preflight: input.preflight,
    orderName: input.orderName,
    appVersion: input.appVersion,
    restarts: input.restarts,
    flip: input.flip,
    generatedAt: date,
  })
  entries.push(
    textEntry(`${folder}/${t.manifest}`, JSON.stringify(manifest, null, 2), date),
    textEntry(`${folder}/${t.readme}`, readmeText(input, manifest), date),
  )

  tick(t.stepZip)
  const blob = await createZip(entries, {
    date,
    comment: `${input.orderName} · ${input.supplier.name} · ${sheets.length} × ${t.sheet}`,
  })
  const fileName =
    `${folder}_${isoStamp(date)}_${input.supplier.id}-${input.process.id}` +
    `_${sheets.length}${input.lang === 'fr' ? 'planches' : 'sheets'}.zip`
  return { blob, fileName, manifest }
}

/**
 * PNG-encode a canvas and immediately drop its backing store. Resizing to 1×1
 * is the only portable way to tell a browser it may free those pixels now
 * rather than whenever the GC next feels like it.
 */
async function release(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await sheetToPngBlob(canvas)
  canvas.width = 1
  canvas.height = 1
  return blob
}

// ---------------------------------------------------------------------------
// LISEZ-MOI
// ---------------------------------------------------------------------------

/**
 * The plain-text order summary. It exists so a human — the operator, or
 * whoever opens the archive in three months — can answer "what is this, what
 * did it cost, what has to be pressed" without a JSON viewer.
 */
function readmeText(i: OrderZipInput, m: DtfManifest): string {
  const fr = i.lang === 'fr'
  const L: string[] = []
  const rule = (s: string) => {
    L.push('', s.toUpperCase(), '-'.repeat(Math.max(8, s.length)))
  }
  const r = i.result
  const proc = i.process
  const vat = i.supplier.vatBasis === 'HT' ? (fr ? 'HT' : 'excl. VAT') : fr ? 'TTC' : 'incl. VAT'

  L.push(
    (fr ? 'DOSSIER D’IMPRESSION DTF — ' : 'DTF PRINT PACKAGE — ') + i.orderName,
    '='.repeat(60),
    (fr ? 'Généré le ' : 'Generated ') +
      i.date.toLocaleString(fr ? 'fr-FR' : 'en-GB') +
      ` · Tshop Studio ${i.appVersion}`,
  )

  rule(fr ? 'Fournisseur' : 'Supplier')
  L.push(
    `  ${i.supplier.name}  ${i.supplier.url}`,
    (fr ? '  Impression depuis : ' : '  Printed from: ') + i.supplier.printsFrom,
    (fr ? '  Délai : ' : '  Lead time: ') + i.supplier.daysToParis,
    (fr ? '  Base des prix : ' : '  Price basis: ') + vat,
  )

  rule(fr ? 'Procédé' : 'Process')
  L.push(
    `  ${proc.label} · ${
      proc.billing === 'roll'
        ? fr
          ? 'facturation au mètre linéaire'
          : 'billed per linear metre'
        : fr
          ? 'facturation à la feuille'
          : 'billed per sheet'
    }`,
    (fr ? '  Laize max : ' : '  Max width: ') +
      `${n1(proc.printableWidthCm)} cm · ` +
      (fr ? 'longueur max ' : 'max length ') +
      `${n1(proc.maxLengthCm)} cm`,
    (fr ? '  DPI minimum : ' : '  Minimum DPI: ') + proc.guidelines.minDpi,
    (fr ? '  Fichiers acceptés : ' : '  Accepted files: ') +
      proc.guidelines.fileFormats.join(', '),
    (fr ? '  Colorimétrie : ' : '  Colour: ') + proc.guidelines.colourMode,
  )

  rule(fr ? 'Géométrie de planche utilisée' : 'Sheet geometry used')
  const o = r.options
  L.push(
    (fr ? '  Laize : ' : '  Width: ') + `${n1(o.printableWidthCm)} cm`,
    (fr ? '  Longueur max / fichier : ' : '  Max length / file: ') + `${n1(o.maxLengthCm)} cm`,
    (fr ? '  Marge bords longs : ' : '  Side margin: ') +
      `${n1(o.edgeMarginSideCm ?? o.edgeMarginCm)} cm · ` +
      (fr ? 'bouts : ' : 'ends: ') +
      `${n1(o.edgeMarginEndCm ?? o.edgeMarginCm)} cm`,
    (fr ? '  Espacement entre visuels : ' : '  Spacing between designs: ') + `${n1(o.gapCm)} cm`,
    (fr ? '  Pas de facturation : ' : '  Billing step: ') + `${n1(o.billingStepCm ?? 10)} cm`,
    (fr ? '  Imbrication : ' : '  Nesting: ') +
      (r.packer === 'shelf'
        ? fr
          ? 'bandes droites (compatible ciseaux)'
          : 'straight strips (scissor friendly)'
        : r.interlockCm >= INTERLOCK_MAX_CM
          ? fr
            ? 'forme réelle, imbrication maximale'
            : 'true shape, maximum interlock'
          : (fr ? 'forme réelle, jeu ' : 'true shape, interlock ') + `${n1(r.interlockCm)} cm`) +
      ` · ${m.nesting.restarts} ` +
      (fr ? 'essais' : 'restarts') +
      (m.nesting.flip
        ? fr
          ? ' · retournement 180°/270° AUTORISÉ'
          : ' · 180°/270° flips ALLOWED'
        : ''),
  )
  if (m.nesting.flip)
    L.push(
      fr
        ? '  ! Des visuels peuvent être imprimés à 180° ou 270°. La flèche du plan de'
        : '  ! Some designs may be printed at 180° or 270°. The arrow on the cutting',
      fr
        ? '    découpe donne le haut de chaque pièce — vérifier avant de presser.'
        : '    plan gives each piece’s up — check it before pressing.',
    )

  rule(fr ? 'Planches' : 'Sheets')
  for (let k = 0; k < r.sheets.length; k++) {
    const s = r.sheets[k]
    L.push(
      `  ${pad2(k + 1)}  ${n1(s.widthCm)} × ${n1(s.lengthCm)} cm` +
        `  ${String(s.placements.length).padStart(3)} ` +
        (fr ? 'pièces' : 'pieces') +
        `  ${fill(s.utilization, s.inkUtilization, fr)}` +
        `  ${i.effectiveDpis[k] ?? i.requestedDpi} DPI`,
    )
  }
  L.push(
    '',
    `  ${fr ? 'TOTAL' : 'TOTAL'} : ${r.sheets.length} ${fr ? 'planche(s)' : 'sheet(s)'} · ` +
      `${n1(r.totalLengthM)} m ${fr ? 'linéaires' : 'linear'} · ` +
      `${r.totalPieces} ${fr ? 'transferts' : 'transfers'} · ` +
      fill(r.totalUtilization, r.totalInkUtilization, fr),
  )

  if (i.cost) {
    rule(fr ? 'Coût estimé' : 'Estimated cost')
    L.push(
      `  ${n2(i.cost.totalEur)} € ${vat}  (${
        fr ? 'impression' : 'print'
      } ${n2(i.cost.printEur)} € + ${fr ? 'port' : 'shipping'} ${n2(i.cost.shippingEur)} €)`,
      `  ${i.cost.tierLabel}`,
    )
    if (i.cost.perPieceEur !== null)
      L.push(`  ${n2(i.cost.perPieceEur)} € / ${fr ? 'pièce' : 'piece'}`)
    for (const w of i.cost.warnings) L.push(`  ! ${w}`)
  }

  rule(fr ? 'Visuels' : 'Artwork')
  for (const p of i.pieces)
    L.push(`  ×${String(p.qty).padEnd(4)} ${n1(p.wCm)} × ${n1(p.hCm)} cm   ${p.label}`)
  if (r.unplaceable.length)
    L.push(
      '',
      (fr ? '  ! NON PLACÉS (trop grands) : ' : '  ! UNPLACEABLE (too large): ') +
        r.unplaceable.map((k) => i.labels.get(k) ?? k).join(', '),
    )

  rule(fr ? 'Contrôle prépresse' : 'Prepress check')
  if (i.preflight.length === 0)
    L.push(
      fr
        ? '  Rien de détectable. Le contrôle ne voit que ce qui est mesurable —'
        : '  Nothing detectable. The check only sees what is measurable —',
      fr ? '  ce n’est pas une garantie de qualité.' : '  it is not a quality guarantee.',
    )
  else
    for (const p of i.preflight)
      L.push(
        `  ${p.level === 'error' ? '[ERREUR]' : '[avert.]'} ${
          i.labels.get(p.pieceKey) ?? p.pieceKey
        } — ${p.message}`,
      )

  rule(fr ? 'Contenu de l’archive' : 'Archive contents')
  const t = T[i.lang]
  L.push(
    `  ${t.print}/ …png   ` +
      (fr
        ? '← LES FICHIERS À ENVOYER AU FOURNISSEUR (fond transparent)'
        : '← THE FILES TO SEND THE SUPPLIER (transparent background)'),
    `  ${t.plan}/ …png   ` +
      (fr
        ? '← plan de découpe, pour l’atelier. NE PAS envoyer au fournisseur.'
        : '← cutting plan, for the workshop. Do NOT send it to the supplier.'),
    `  ${t.manifest}          ` +
      (fr ? '← toutes les positions, pour la traçabilité' : '← every placement, for tracing'),
    `  ${t.readme}         ` + (fr ? '← ce fichier' : '← this file'),
  )
  L.push('')
  return L.join('\n')
}
