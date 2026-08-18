/**
 * DTF supplier profiles + cost estimation.
 *
 * A supplier is a set of PROCESSES (`dtf`, `uvdtf`); each process carries its
 * own geometry, its own billing model and its own STRUCTURED guidelines (the
 * numbers preflight.ts validates against — no free text in the checked path).
 *
 * Two billing models:
 *  - `roll`   — billed per linear metre off a roll (price tiers).
 *  - `fixed`  — billed per printed sheet of a catalogue format (OhMyDTF).
 *
 * Encodes the researched public specs/pricing as DATA (July 2026 — prices
 * move, hence the runtime-editable profiles persisted in localStorage under
 * `tshop:dtf:suppliers`). Sources + every uncertain number: docs/credits/DTF.md.
 */
import type { DtfSheet } from './nesting'
import type {
  BillingModel,
  DtfGuidelines,
  DtfProcess,
  PriceTier,
  ProcessId,
  SheetFormat,
  SupplierProfile,
} from './supplierTypes'

export type {
  BillingModel,
  DtfGuidelines,
  DtfProcess,
  PriceTier,
  ProcessId,
  SheetFormat,
  SpacingSource,
  SupplierProfile,
} from './supplierTypes'

// ---------------------------------------------------------------------------
// Defaults (researched — see docs/credits/DTF.md for sources + uncertainties)
// ---------------------------------------------------------------------------

/**
 * House floors used wherever a supplier publishes no figure of its own.
 *
 * SPACING (relevé 2026-07, sources dans docs/credits/DTF.md)
 * ---------------------------------------------------------
 * Four EU printers publish a spacing rule and NOBODY publishes more than one:
 * DTF-Blitz « Mindestens 5 mm Abstand zwischen den Motiven » (+ « Ein
 * zusätzlicher Beschnitt muss nicht berücksichtigt werden » ⇒ zero bleed),
 * DTF-Profis « Mindestens 4 mm » (5–10 mm pour la découpe manuelle),
 * ZebraTransfers « 1 à 2 cm », Tissus Print « 5 mm minimum de marge
 * intérieure ». 5 mm is therefore the strictest PUBLISHED minimum and 4 mm the
 * absolute floor — never go below it.
 *
 * The 3 mm side margin here is a house floor for suppliers that publish
 * neither a margin nor a printable width. Where a supplier DOES quote a
 * printable width (DTF+ 58 cm, dtfaprofesionales 55 cm…), that width already
 * IS the safe area and the margin belongs at 0 — see `marginSource`. The
 * previous 1,0 cm / 0,8 cm defaults were house inventions with no supplier
 * backing and cost ≈ 4 % of every roll on their own.
 */
const BASE_GUIDELINES: DtfGuidelines = {
  minDpi: 300,
  minLineMmColour: 1.0,
  minLineMmWhite: 0.5,
  minTextPt: 8,
  marginCm: 0.3,
  marginEndCm: 0,
  marginSource: 'house',
  gapCm: 0.5,
  gapSource: 'published',
  maxDesignWCm: null,
  maxDesignHCm: null,
  fileFormats: ['png'],
  colourMode: 'RVB ou CMJN',
  transparency: 'Fond transparent obligatoire',
  whiteUnderbase: 'Blanc automatique généré par le RIP',
  cutting: 'Découpe manuelle aux ciseaux',
}

const g = (o: Partial<DtfGuidelines>): DtfGuidelines => ({ ...BASE_GUIDELINES, ...o })

export const DEFAULT_SUPPLIERS: SupplierProfile[] = [
  {
    id: 'dtfplus',
    name: 'DTF Plus',
    url: 'https://dtfplus.eu',
    printsFrom: 'Rzeszów, Pologne (UPS)',
    vatBasis: 'HT',
    // Relevé 2026-07 : la grille du site indique 9 € standard / 12 € express
    // vers la France (l'ancien 8 € n'existe plus).
    shippingEur: 9,
    freeShipAtEur: null,
    freeShipAtLm: 20,
    minOrderLm: 1,
    minOrderEur: 0,
    daysToParis: '2–4 j (UPS Standard) · 1–2 j (Express 12 €)',
    notes:
      '⚠ RÉSERVÉ AUX PROS : un numéro de TVA intracommunautaire valide est OBLIGATOIRE ' +
      'pour commander. Facturé 0 % (autoliquidation) — sans TVA intracom, ce fournisseur ' +
      'est inaccessible. ' +
      'Port offert à partir de 20 lm (seuil en MÈTRES, pas en euros) — et 20 lm est aussi ' +
      'le palier 6 €/lm, donc 20,0 lm coûte MOINS CHER en euros que 19,9 lm (120 € contre ' +
      '147,30 €). Ne jamais commander entre 15 et 19,9 lm. ' +
      'Coupure 10 h CET pour une expédition le jour même · presse 130 °C / 6–8 s / pression ' +
      'forte · UV-DTF : minimum 0,5 lm, séchage 24–48 h avant pose (tarifs UV-DTF à confirmer). ' +
      '⚠ MARGE BORD 0 DÉDUITE, NON PUBLIÉE : leurs spécifications ne mentionnent ni marge, ' +
      'ni fond perdu, ni zone de sécurité — on en déduit que les 58 cm annoncés SONT la laize ' +
      'imprimable. Commander une planche test de 1 lm avec une grille au bord avant de basculer ' +
      'la production dessus. L’espacement 5 mm est emprunté à DTF-Blitz (DTF+ n’en publie aucun). ' +
      '⚠ Les CGV excluent la variation colorimétrique des motifs de réclamation : le contrôle ' +
      'couleur est à notre charge.',
    processes: [
      {
        id: 'dtf',
        label: 'DTF textile',
        billing: 'roll',
        printableWidthCm: 58,
        rollWidthCm: 58,
        maxLengthCm: 250,
        formats: [],
        priceTiers: [
          { minLm: 1, eurPerLm: 8.0 },
          { minLm: 5, eurPerLm: 7.0 },
          { minLm: 20, eurPerLm: 6.0 },
          { minLm: 50, eurPerLm: 5.5 },
        ],
        minOrderLm: 1,
        billingStepCm: 10,
        guidelines: g({
          minDpi: 200,
          minLineMmColour: 1.0,
          minLineMmWhite: 0.5,
          minTextPt: 8,
          // 58 cm est la « project width » annoncée : c'est déjà la zone sûre.
          marginCm: 0,
          marginEndCm: 0,
          marginSource: 'printable-width',
          gapCm: 0.5,
          gapSource: 'house',
          fileFormats: ['pdf', 'png'],
          colourMode: 'CMJN ou RVB',
          transparency: 'PNG à fond transparent ou PDF avec transparence',
          whiteUnderbase: 'Blanc automatique, choke 0,15 mm · polices vectorisées',
          cutting: 'Découpe manuelle · presse 130 °C / 6–8 s / pression forte',
        }),
      },
      {
        id: 'uvdtf',
        label: 'UV-DTF (supports rigides)',
        billing: 'roll',
        printableWidthCm: 28,
        rollWidthCm: 30,
        maxLengthCm: 100,
        formats: [],
        // Relevé 2026-07 sur dtfplus.eu. Le port offert reste au seuil de 20 lm
        // même si les paliers UV s'arrêtent à 10 lm.
        priceTiers: [
          { minLm: 0.5, eurPerLm: 9.0 },
          { minLm: 3, eurPerLm: 8.0 },
          { minLm: 5, eurPerLm: 7.5 },
          { minLm: 10, eurPerLm: 7.0 },
        ],
        minOrderLm: 0.5,
        billingStepCm: 10,
        guidelines: g({
          minDpi: 250,
          marginCm: 0,
          marginEndCm: 0,
          marginSource: 'printable-width',
          // Le minimum de 0,5 mm en blanc est celui du DTF STANDARD ; en UV-DTF
          // le blanc monte à 0,8 mm (couleur 1,0 mm dans les deux procédés).
          minLineMmColour: 1.0,
          minLineMmWhite: 0.8,
          minTextPt: 10,
          maxDesignWCm: 28,
          maxDesignHCm: 100,
          fileFormats: ['pdf', 'png'],
          colourMode: 'CMJN ou RVB',
          transparency: 'Fond transparent obligatoire',
          whiteUnderbase: 'Couche blanche réduite de 0,15 mm par rapport à la couleur',
          cutting: 'Prédécoupe · séchage 24–48 h avant application',
        }),
      },
    ],
  },
  {
    id: 'impressiondtf',
    name: 'Impression-DTF (France)',
    url: 'https://impression-dtf.com',
    printsFrom: 'France (atelier français, encres OEKO-TEX)',
    vatBasis: 'HT',
    // Port non publié sous le franco : 0 = inconnu, à confirmer avant devis.
    shippingEur: 0,
    freeShipAtEur: 100,
    freeShipAtLm: null,
    minOrderLm: 0,
    minOrderEur: 0,
    daysToParis: '72–96 h (éco) · 48 h (standard) · 24 h (express)',
    notes:
      'MEILLEUR €/m² VÉRIFIÉ (9,73 € HT/m² en éco) et, contrairement à DTF+, AUCUN numéro de ' +
      'TVA intracommunautaire exigé — c’est ce qui en fait le choix par défaut. Production ' +
      'française, encres OEKO-TEX, aucun minimum de commande, port offert dès 100 € HT. ' +
      '⚠ LE TARIF DÉPEND DU DÉLAI, pas de la quantité : 5,45 € HT/ml en économique 72–96 h ' +
      '(encodé ici), 6,54 € HT/ml en standard 48 h, 8,72 € HT/ml en express 24 h — changez le ' +
      'palier ci-dessous si vous commandez en urgence. ' +
      '⚠ À CONFIRMER auprès du fournisseur : la longueur maximale par fichier (non publiée — ' +
      '100 cm prudent ici), le coût du port sous 100 € HT, et la quantité derrière chaque ' +
      '« à partir de ». 300 DPI minimum exigés.',
    processes: [
      {
        id: 'dtf',
        label: 'DTF textile',
        billing: 'roll',
        printableWidthCm: 56,
        rollWidthCm: 60,
        maxLengthCm: 100,
        formats: [],
        priceTiers: [{ minLm: 1, eurPerLm: 5.45 }],
        minOrderLm: 0,
        billingStepCm: 10,
        guidelines: g({
          minDpi: 300,
          marginCm: 0.3,
          marginEndCm: 0,
          marginSource: 'house',
          gapCm: 0.5,
          gapSource: 'house',
          fileFormats: ['png', 'pdf', 'ai', 'psd'],
          colourMode: 'Non précisé — fournir en RVB ou CMJN',
          transparency: 'PNG à fond transparent recommandé',
          whiteUnderbase: 'Blanc automatique généré par le RIP',
          cutting: 'Découpe manuelle aux ciseaux',
        }),
      },
    ],
  },
  {
    id: 'ohmydtf',
    name: 'OhMyDTF (formats fixes)',
    url: 'https://ohmydtf.com',
    printsFrom: 'Ennery (95), Île-de-France',
    vatBasis: 'TTC',
    shippingEur: 4.9,
    freeShipAtEur: 50,
    freeShipAtLm: null,
    minOrderLm: 0,
    minOrderEur: 0,
    daysToParis: 'J+1 impression · Chronopost 24 h',
    notes:
      'FORMATS FIXES (pas de rouleau) : on paie la feuille entière, pas le métré. ' +
      'Imprimé à 35 km de Paris · 60+ lavages à 40 °C · détail jusqu’à 0,6 mm (1,75 pt). ' +
      '⚠ BASE TVA À CONFIRMER : les fiches produit affichent « H.T. » mais les CGV annoncent ' +
      'des prix TTC — un écart de 17 % qui change le classement fournisseurs. Demander une ' +
      'facture type avant de s’engager. ' +
      '⚠ Les remises peuvent exiger le MÊME fichier répété : 5 planches différentes risquent ' +
      'de rester au tarif 1–4.',
    processes: [
      {
        id: 'dtf',
        label: 'DTF textile',
        billing: 'fixed',
        printableWidthCm: 55,
        rollWidthCm: 55,
        maxLengthCm: 200,
        priceTiers: [],
        // Relevé 2026-07 sur ohmydtf.com/collections/all. ATTENTION : leurs
        // « A4/A3/A2 » ne sont PAS les formats ISO (A4 = 21 × 28 et non
        // 21 × 29,7). Toujours gabarier sur les cm du fournisseur, jamais sur
        // l’ISO, sinon le visuel déborde. Les grands formats font 55 cm de
        // large (et non 56) et l'A2 fait 40 × 57 — un fichier de 56 cm posé
        // sur une feuille de 55 était rogné en silence.
        formats: [
          { id: 'coeur', label: 'Cœur 10 × 10 cm', wCm: 10, hCm: 10, priceEur: 2.5 },
          { id: 'a4', label: 'A4 21 × 28 cm', wCm: 21, hCm: 28, priceEur: 4.9 },
          { id: 'a3', label: 'A3 28 × 42 cm', wCm: 28, hCm: 42, priceEur: 7.2 },
          { id: 'a2', label: 'A2 40 × 57 cm', wCm: 40, hCm: 57, priceEur: 13.3 },
          { id: 'm1', label: '1 m (55 × 100 cm)', wCm: 55, hCm: 100, priceEur: 17.0 },
          { id: 'm2', label: '2 m (55 × 200 cm)', wCm: 55, hCm: 200, priceEur: 32.0 },
        ],
        guidelines: g({
          minDpi: 300,
          minLineMmColour: 0.6,
          minLineMmWhite: 0.6,
          minTextPt: 8,
          // Formats fixes : la feuille livrée est coupée au format, donc on
          // garde 3 mm de sécurité sur les quatre bords (rien n'est publié).
          marginCm: 0.3,
          marginEndCm: 0.3,
          marginSource: 'house',
          gapCm: 0.5,
          gapSource: 'house',
          maxDesignWCm: 55,
          maxDesignHCm: 200,
          fileFormats: ['ai', 'psd', 'pdf', 'tiff'],
          colourMode: 'CMJN',
          transparency: 'Fond transparent obligatoire',
          whiteUnderbase: 'Blanc automatique généré par le RIP',
          cutting: 'Feuille livrée au format · découpe manuelle',
        }),
      },
      {
        id: 'uvdtf',
        label: 'UV-DTF (supports rigides)',
        billing: 'fixed',
        printableWidthCm: 50,
        rollWidthCm: 50,
        maxLengthCm: 100,
        priceTiers: [],
        // Formats confirmés (A5/A4/A3/50 × 100) ; PRIX NON PUBLIÉS → estimations,
        // à confirmer avant de chiffrer un client. Dimensions alignées sur les
        // formats textile du même fournisseur (non ISO).
        formats: [
          { id: 'a5', label: 'A5 14,8 × 21 cm', wCm: 14.8, hCm: 21, priceEur: 6.5 },
          { id: 'a4', label: 'A4 21 × 28 cm', wCm: 21, hCm: 28, priceEur: 11.0 },
          { id: 'a3', label: 'A3 28 × 42 cm', wCm: 28, hCm: 42, priceEur: 18.0 },
          { id: 'm1', label: '50 × 100 cm', wCm: 50, hCm: 100, priceEur: 45.0 },
        ],
        guidelines: g({
          minDpi: 300,
          minLineMmColour: 0.6,
          minLineMmWhite: 0.6,
          minTextPt: 8,
          maxDesignWCm: 50,
          maxDesignHCm: 100,
          fileFormats: ['png'],
          colourMode: 'RVB',
          transparency: 'PNG à fond transparent uniquement',
          whiteUnderbase: 'Blanc automatique généré par le RIP',
          cutting: 'Prédécoupe · application sur support rigide',
        }),
      },
    ],
  },
  {
    id: 'royaldtf',
    name: 'Royal DTF (express)',
    url: 'https://fr.royaldtf.com',
    printsFrom: 'Union européenne (expédition DHL Express)',
    vatBasis: 'HT',
    shippingEur: 0,
    freeShipAtEur: null,
    freeShipAtLm: null,
    minOrderLm: 1,
    minOrderEur: 49,
    daysToParis: '1–2 j (DHL Express)',
    notes:
      'Feuilles 56 × 100 cm facturées au métré · commande minimum 49 €. ' +
      '⚠ TARIFS NON REVÉRIFIÉS (relevé 2026-07 : la page tarifaire renvoie une 404) — ' +
      'demander une grille à jour avant tout devis client.',
    processes: [
      {
        id: 'dtf',
        label: 'DTF textile',
        billing: 'roll',
        printableWidthCm: 56,
        rollWidthCm: 56,
        maxLengthCm: 100,
        formats: [],
        priceTiers: [
          { minLm: 1, eurPerLm: 9.9 },
          { minLm: 11, eurPerLm: 8.9 },
          { minLm: 21, eurPerLm: 7.9 },
          { minLm: 51, eurPerLm: 6.9 },
          { minLm: 101, eurPerLm: 6.2 },
          { minLm: 200, eurPerLm: 6.0 },
        ],
        guidelines: g({
          minDpi: 300,
          fileFormats: ['png', 'ai', 'psd', 'pdf', 'tiff', 'eps'],
          colourMode: 'CMJN ou RVB',
          transparency: 'Fond transparent obligatoire',
          whiteUnderbase: 'Blanc automatique généré par le RIP',
          cutting: 'Découpe manuelle aux ciseaux',
        }),
      },
    ],
  },
  {
    id: 'pressink',
    name: 'Pressink (France)',
    url: 'https://pressink.fr',
    printsFrom: 'France',
    vatBasis: 'TTC',
    shippingEur: 5.9,
    freeShipAtEur: 50,
    freeShipAtLm: null,
    minOrderLm: 1,
    minOrderEur: 0,
    daysToParis: '2–3 j',
    notes:
      'Production française · longueur max par fichier non documentée (250 cm prudent). ' +
      '⚠ TARIFS NON REVÉRIFIÉS (relevé 2026-07 : le site ne publie plus de grille) — ' +
      'confirmer avant de chiffrer.',
    processes: [
      {
        id: 'dtf',
        label: 'DTF textile',
        billing: 'roll',
        printableWidthCm: 56,
        rollWidthCm: 56,
        maxLengthCm: 250,
        formats: [],
        priceTiers: [
          { minLm: 1, eurPerLm: 15.99 },
          { minLm: 5, eurPerLm: 14.0 },
          { minLm: 10, eurPerLm: 12.9 },
          { minLm: 20, eurPerLm: 11.1 },
          { minLm: 50, eurPerLm: 8.9 },
          { minLm: 100, eurPerLm: 7.2 },
        ],
        guidelines: g({
          minDpi: 300,
          fileFormats: ['png'],
          colourMode: 'RVB',
          transparency: 'PNG à fond transparent uniquement',
          whiteUnderbase: 'Blanc automatique généré par le RIP',
          cutting: 'Découpe manuelle aux ciseaux',
        }),
      },
    ],
  },
]

/** First process with this id, or null. */
export function processOf(p: SupplierProfile, id: ProcessId): DtfProcess | null {
  return p.processes.find((x) => x.id === id) ?? null
}

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

export interface FormatLine {
  formatId: string
  label: string
  count: number
  unitEur: number
  totalEur: number
}

export interface CostBreakdown {
  billing: BillingModel
  vatBasis: 'HT' | 'TTC'
  /** Roll: €/lm of the applied tier. Fixed: 0. */
  ratePerLm: number
  /** Applied tier (roll) or format mix summary (fixed). */
  tierLabel: string
  /** Roll: linear metres billed (≥ min order). Fixed: Σ feuilles ÷ 100 (indicatif). */
  billedLm: number
  /** Fixed billing only — one line per format used. */
  formatLines: FormatLine[]
  printEur: number
  shippingEur: number
  totalEur: number
  /** (print + port) ÷ pièces placées; null quand rien n'est placé. */
  perPieceEur: number | null
  /** Caveats: minimum de commande appliqué, tarifs non confirmés… */
  warnings: string[]
}

/** @deprecated legacy alias — use CostBreakdown. */
export type CostEstimate = CostBreakdown

const r2 = (v: number) => Math.round(v * 100) / 100

const emptyCost = (p: SupplierProfile, proc: DtfProcess): CostBreakdown => ({
  billing: proc.billing,
  vatBasis: p.vatBasis,
  ratePerLm: 0,
  tierLabel: '—',
  billedLm: 0,
  formatLines: [],
  printEur: 0,
  shippingEur: 0,
  totalEur: 0,
  perPieceEur: null,
  warnings: [],
})

function rollCost(
  p: SupplierProfile,
  proc: DtfProcess,
  lengthM: number,
  pieces: number,
): CostBreakdown {
  const out = emptyCost(p, proc)
  const minLm = proc.minOrderLm ?? p.minOrderLm
  const billedLm = r2(Math.max(lengthM, minLm))
  const tiers = [...proc.priceTiers].sort((a, b) => a.minLm - b.minLm)
  let tier = tiers[0] ?? { minLm: 0, eurPerLm: 0 }
  let next: PriceTier | null = null
  for (let i = 0; i < tiers.length; i++) {
    if (billedLm >= tiers[i].minLm) {
      tier = tiers[i]
      next = tiers[i + 1] ?? null
    }
  }
  const rawPrint = tier.eurPerLm * billedLm
  const printEur = r2(Math.max(rawPrint, p.minOrderEur))
  if (billedLm > lengthM + 1e-9)
    out.warnings.push(`Minimum ${minLm} lm appliqué (métré réel ${r2(lengthM)} lm).`)
  if (printEur > r2(rawPrint)) out.warnings.push(`Commande minimum ${p.minOrderEur} € appliquée.`)
  out.ratePerLm = tier.eurPerLm
  out.billedLm = billedLm
  out.tierLabel = next
    ? `${tier.minLm}–${r2(next.minLm - 0.1)} lm · ${tier.eurPerLm.toFixed(2)} €/lm`
    : `≥ ${tier.minLm} lm · ${tier.eurPerLm.toFixed(2)} €/lm`
  out.printEur = printEur
  finish(p, out, pieces)
  const tip = thresholdTip(p, proc, billedLm)
  if (tip)
    out.warnings.push(
      `Astuce : commander ${r2(tip.lm)} lm coûte ${tip.totalEur.toFixed(2)} € — ` +
        `soit ${tip.savesEur.toFixed(2)} € DE MOINS que ${billedLm} lm, pour plus de film.`,
    )
  return out
}

function fixedCost(
  p: SupplierProfile,
  proc: DtfProcess,
  sheets: DtfSheet[],
  pieces: number,
): CostBreakdown {
  const out = emptyCost(p, proc)
  const byId = new Map<string, FormatLine>()
  let lengthCm = 0
  let unknown = 0
  for (const s of sheets) {
    lengthCm += s.lengthCm
    const f = proc.formats.find((x) => x.id === s.formatId)
    if (!f) {
      unknown++
      continue
    }
    const line = byId.get(f.id) ?? {
      formatId: f.id,
      label: f.label,
      count: 0,
      unitEur: f.priceEur,
      totalEur: 0,
    }
    line.count++
    line.totalEur = r2(line.count * f.priceEur)
    byId.set(f.id, line)
  }
  // Catalogue order keeps the breakdown stable across renders.
  const lines = proc.formats
    .map((f) => byId.get(f.id))
    .filter((l): l is FormatLine => !!l)
  const rawPrint = lines.reduce((a, l) => a + l.totalEur, 0)
  const printEur = r2(Math.max(rawPrint, p.minOrderEur))
  if (printEur > r2(rawPrint)) out.warnings.push(`Commande minimum ${p.minOrderEur} € appliquée.`)
  if (unknown > 0) out.warnings.push(`${unknown} feuille(s) sans format catalogue — non chiffrée(s).`)
  out.formatLines = lines
  out.billedLm = r2(lengthCm / 100)
  out.tierLabel = lines.length
    ? lines.map((l) => `${l.count} × ${l.label}`).join(' · ')
    : '—'
  out.printEur = printEur
  return finish(p, out, pieces)
}

function finish(p: SupplierProfile, out: CostBreakdown, pieces: number): CostBreakdown {
  const freeShip =
    (p.freeShipAtLm !== null && out.billedLm >= p.freeShipAtLm) ||
    (p.freeShipAtEur !== null && out.printEur >= p.freeShipAtEur)
  out.shippingEur = freeShip ? 0 : r2(p.shippingEur)
  out.totalEur = r2(out.printEur + out.shippingEur)
  out.perPieceEur = pieces > 0 ? r2(out.totalEur / pieces) : null
  return out
}

/**
 * Total for a hypothetical roll order of `lm` linear metres — tier + minimums +
 * shipping — without the warnings/labels. Used by the threshold advisor.
 */
function rollTotalAt(p: SupplierProfile, proc: DtfProcess, lm: number): number {
  const billed = r2(Math.max(lm, proc.minOrderLm ?? p.minOrderLm))
  const tiers = [...proc.priceTiers].sort((a, b) => a.minLm - b.minLm)
  // Take the CHEAPEST applicable rate, never merely the last matching row: some
  // suppliers mix prepaid packages into the same ladder, making it non-monotonic
  // (a higher minLm can carry a HIGHER €/lm), and "last match wins" overcharges.
  let rate = tiers[0]?.eurPerLm ?? 0
  for (const t of tiers) if (billed >= t.minLm) rate = Math.min(rate, t.eurPerLm)
  const print = Math.max(rate * billed, p.minOrderEur)
  const free =
    (p.freeShipAtLm !== null && billed >= p.freeShipAtLm) ||
    (p.freeShipAtEur !== null && print >= p.freeShipAtEur)
  return r2(print + (free ? 0 : p.shippingEur))
}

export interface ThresholdTip {
  /** Order this many linear metres instead. */
  lm: number
  /** Total at that quantity (EUR, same VAT basis as the profile). */
  totalEur: number
  /** How much LESS than the current quantity costs. */
  savesEur: number
}

/**
 * Find a LARGER roll order that costs STRICTLY LESS in absolute euros.
 *
 * Not a curiosity: at DTF+ the 6 €/lm tier break and the free-shipping threshold
 * both land at 20 lm, so 19,9 lm costs 147,30 € while 20,0 lm costs 120,00 €.
 * Any tier break or free-shipping threshold can create one of these cliffs, so
 * we test the thresholds themselves rather than hard-coding the supplier.
 */
export function thresholdTip(
  p: SupplierProfile,
  proc: DtfProcess,
  billedLm: number,
): ThresholdTip | null {
  if (proc.billing !== 'roll' || billedLm <= 0) return null
  const current = rollTotalAt(p, proc, billedLm)
  const candidates = [...proc.priceTiers.map((t) => t.minLm), p.freeShipAtLm ?? 0]
    .filter((lm) => lm > billedLm)
    .sort((a, b) => a - b)
  let best: ThresholdTip | null = null
  for (const lm of candidates) {
    const total = rollTotalAt(p, proc, lm)
    if (total < current - 0.01 && (!best || total < best.totalEur))
      best = { lm, totalEur: total, savesEur: r2(current - total) }
  }
  return best
}

/**
 * Price a nesting result. Dispatches on `proc.billing`:
 *  - roll  → Σ billed sheet lengths against the process price tiers;
 *  - fixed → one catalogue price per produced sheet (`sheet.formatId`).
 *
 * Legacy 2-arg form `estimateCost(profile, totalLengthM)` still prices the
 * supplier's first process (kept so older callers/harnesses keep compiling).
 */
export function estimateCost(
  p: SupplierProfile,
  proc: DtfProcess,
  sheets: DtfSheet[],
): CostBreakdown
export function estimateCost(p: SupplierProfile, totalLengthM: number): CostBreakdown
export function estimateCost(
  p: SupplierProfile,
  a: DtfProcess | number,
  sheets?: DtfSheet[],
): CostBreakdown {
  if (typeof a === 'number') {
    const proc = p.processes[0]
    if (!proc) return emptyCost(p, { billing: 'roll' } as DtfProcess)
    return rollCost(p, proc, a, 0)
  }
  const list = sheets ?? []
  const pieces = list.reduce((n, s) => n + s.placements.length, 0)
  if (a.billing === 'fixed') return fixedCost(p, a, list, pieces)
  const lengthM = list.reduce((n, s) => n + s.lengthCm, 0) / 100
  return rollCost(p, a, lengthM, pieces)
}

// ---------------------------------------------------------------------------
// Runtime-editable profiles (localStorage)
// ---------------------------------------------------------------------------

export const SUPPLIERS_LS_KEY = 'tshop:dtf:suppliers'

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === 'string'

function validGuidelines(v: unknown): v is DtfGuidelines {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  for (const k of ['minDpi', 'minLineMmColour', 'minLineMmWhite', 'minTextPt'] as const)
    if (!isNum(o[k]) || (o[k] as number) <= 0) return false
  for (const k of ['marginCm', 'gapCm'] as const)
    if (!isNum(o[k]) || (o[k] as number) < 0) return false
  // Optional split margin: absent is fine (falls back to marginCm), present
  // must still be a usable number rather than a typo that silently reads as 0.
  if (o.marginEndCm !== undefined && (!isNum(o.marginEndCm) || (o.marginEndCm as number) < 0))
    return false
  for (const k of ['marginSource', 'gapSource'] as const)
    if (o[k] !== undefined && !isStr(o[k])) return false
  for (const k of ['maxDesignWCm', 'maxDesignHCm'] as const)
    if (o[k] !== null && (!isNum(o[k]) || (o[k] as number) <= 0)) return false
  if (!Array.isArray(o.fileFormats) || !o.fileFormats.every(isStr)) return false
  for (const k of ['colourMode', 'transparency', 'whiteUnderbase', 'cutting'] as const)
    if (!isStr(o[k])) return false
  return true
}

function validProcess(v: unknown): v is DtfProcess {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (o.id !== 'dtf' && o.id !== 'uvdtf') return false
  if (!isStr(o.label)) return false
  if (o.billing !== 'roll' && o.billing !== 'fixed') return false
  for (const k of ['printableWidthCm', 'rollWidthCm', 'maxLengthCm'] as const)
    if (!isNum(o[k]) || (o[k] as number) <= 0) return false
  if (o.minOrderLm !== undefined && (!isNum(o.minOrderLm) || (o.minOrderLm as number) < 0))
    return false
  if (
    o.billingStepCm !== undefined &&
    (!isNum(o.billingStepCm) || (o.billingStepCm as number) <= 0)
  )
    return false
  if (!Array.isArray(o.priceTiers) || !Array.isArray(o.formats)) return false
  for (const t of o.priceTiers as unknown[]) {
    if (typeof t !== 'object' || t === null) return false
    const tt = t as Record<string, unknown>
    if (!isNum(tt.minLm) || (tt.minLm as number) < 0) return false
    if (!isNum(tt.eurPerLm) || (tt.eurPerLm as number) <= 0) return false
  }
  for (const f of o.formats as unknown[]) {
    if (typeof f !== 'object' || f === null) return false
    const ff = f as Record<string, unknown>
    if (!isStr(ff.id) || ff.id.length === 0 || !isStr(ff.label)) return false
    for (const k of ['wCm', 'hCm', 'priceEur'] as const)
      if (!isNum(ff[k]) || (ff[k] as number) <= 0) return false
  }
  // A process must be able to quote: tiers for roll, formats for fixed.
  if (o.billing === 'roll' && (o.priceTiers as unknown[]).length === 0) return false
  if (o.billing === 'fixed' && (o.formats as unknown[]).length === 0) return false
  return validGuidelines(o.guidelines)
}

/** True when a profile is complete and persistable. */
export function validProfile(p: unknown): p is SupplierProfile {
  if (typeof p !== 'object' || p === null) return false
  const o = p as Record<string, unknown>
  if (!isStr(o.id) || o.id.length === 0) return false
  for (const k of ['name', 'url', 'printsFrom', 'daysToParis', 'notes'] as const)
    if (!isStr(o[k])) return false
  if (o.vatBasis !== 'HT' && o.vatBasis !== 'TTC') return false
  for (const k of ['shippingEur', 'minOrderLm', 'minOrderEur'] as const)
    if (!isNum(o[k]) || (o[k] as number) < 0) return false
  for (const k of ['freeShipAtLm', 'freeShipAtEur'] as const)
    if (o[k] !== null && (!isNum(o[k]) || (o[k] as number) < 0)) return false
  if (!Array.isArray(o.processes) || o.processes.length === 0) return false
  return (o.processes as unknown[]).every(validProcess)
}

const cloneDefaults = (): SupplierProfile[] =>
  JSON.parse(JSON.stringify(DEFAULT_SUPPLIERS)) as SupplierProfile[]

// --- v1 → v2 migration -----------------------------------------------------

/** Shape of the pre-process profiles that may still sit in localStorage. */
interface LegacyProfile {
  id: string
  name: string
  url: string
  printableWidthCm: number
  rollWidthCm: number
  maxLengthCm: number
  minDpi: number
  fileFormat: string
  gapDefaultCm: number
  marginDefaultCm: number
  priceTiers: PriceTier[]
  shippingEur: number
  freeShipAtLm: number | null
  freeShipAtEur: number | null
  minOrderLm: number
  minOrderEur: number
  notes: string
}

const isLegacy = (v: unknown): v is LegacyProfile =>
  typeof v === 'object' &&
  v !== null &&
  !('processes' in (v as object)) &&
  isNum((v as Record<string, unknown>).printableWidthCm) &&
  Array.isArray((v as Record<string, unknown>).priceTiers)

/**
 * Rebuild a v1 profile as a single-process roll supplier, keeping the admin's
 * edited numbers. Suppliers we have since restructured as FIXED format cannot
 * be mapped (roll tiers ≠ per-sheet prices) — those fall back to the shipped
 * default so the admin gets a correct catalogue instead of a wrong roll.
 */
function migrateLegacy(l: LegacyProfile): SupplierProfile | null {
  const def = DEFAULT_SUPPLIERS.find((d) => d.id === l.id)
  if (def && def.processes.some((p) => p.billing === 'fixed'))
    return JSON.parse(JSON.stringify(def)) as SupplierProfile
  const base = def?.processes.find((p) => p.billing === 'roll')
  const guidelines = g({
    ...(base?.guidelines ?? {}),
    minDpi: isNum(l.minDpi) && l.minDpi > 0 ? l.minDpi : BASE_GUIDELINES.minDpi,
    marginCm: isNum(l.marginDefaultCm) ? l.marginDefaultCm : BASE_GUIDELINES.marginCm,
    gapCm: isNum(l.gapDefaultCm) ? l.gapDefaultCm : BASE_GUIDELINES.gapCm,
  })
  const profile: SupplierProfile = {
    id: l.id,
    name: l.name,
    url: l.url,
    printsFrom: def?.printsFrom ?? '—',
    vatBasis: def?.vatBasis ?? 'TTC',
    shippingEur: l.shippingEur,
    freeShipAtEur: l.freeShipAtEur ?? null,
    freeShipAtLm: l.freeShipAtLm ?? null,
    minOrderLm: l.minOrderLm,
    minOrderEur: l.minOrderEur,
    daysToParis: def?.daysToParis ?? '—',
    notes: [l.notes, isStr(l.fileFormat) ? `Fichiers : ${l.fileFormat}` : '']
      .filter(Boolean)
      .join(' · '),
    processes: [
      {
        id: 'dtf',
        label: base?.label ?? 'DTF textile',
        billing: 'roll',
        printableWidthCm: l.printableWidthCm,
        rollWidthCm: l.rollWidthCm,
        maxLengthCm: l.maxLengthCm,
        priceTiers: l.priceTiers.map((t) => ({ ...t })),
        formats: [],
        guidelines,
      },
    ],
  }
  return validProfile(profile) ? profile : null
}

/**
 * Load profiles from localStorage. Falls back to the defaults whenever the
 * stored payload is missing/unusable (also in non-DOM contexts); v1 payloads
 * are migrated in place rather than dropped.
 */
export function loadSuppliers(): SupplierProfile[] {
  try {
    if (typeof localStorage === 'undefined') return cloneDefaults()
    const raw = localStorage.getItem(SUPPLIERS_LS_KEY)
    if (!raw) return cloneDefaults()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) return cloneDefaults()
    const out: SupplierProfile[] = []
    for (const entry of parsed) {
      if (validProfile(entry)) out.push(entry)
      else if (isLegacy(entry)) {
        const m = migrateLegacy(entry)
        if (m) out.push(m)
      }
    }
    return out.length ? out : cloneDefaults()
  } catch {
    return cloneDefaults()
  }
}

/**
 * Persist edited profiles VERBATIM and return them.
 * Nothing is filtered here — validate with `validProfile` before calling and
 * refuse in the UI (silently dropping a half-edited profile was a real bug).
 * An empty array clears the key, so the next load returns the defaults.
 */
export function saveSuppliers(profiles: SupplierProfile[]): SupplierProfile[] {
  try {
    if (typeof localStorage !== 'undefined') {
      if (profiles.length === 0) localStorage.removeItem(SUPPLIERS_LS_KEY)
      else localStorage.setItem(SUPPLIERS_LS_KEY, JSON.stringify(profiles))
    }
  } catch {
    /* storage full/blocked — keep the in-memory copy */
  }
  return profiles
}

/** Drop stored edits and return pristine defaults. */
export function resetSuppliers(): SupplierProfile[] {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(SUPPLIERS_LS_KEY)
  } catch {
    /* ignore */
  }
  return cloneDefaults()
}
