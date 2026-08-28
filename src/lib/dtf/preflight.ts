/**
 * DTF prepress preflight: pure, DOM-free, deterministic.
 *
 * Validates the pieces about to be nested against a PROCESS's structured
 * guidelines. Deliberately conservative: a check only runs when the piece
 * actually carries the metadata it needs (`srcPxW/H`, `hasAlpha`, `minLineMm`,
 * `whiteMinLineMm`, `minTextPt`: all optional on DtfPiece). Nothing is
 * inferred from pixels here; what cannot be measured is not reported, so a
 * clean result means "nothing detectable is wrong", never "the file is good".
 *
 * `error` = the supplier will reject or misprint it. `warn` = it will print
 * but below the recommended quality floor.
 */
import type { DtfPiece } from './nesting'
import type { DtfProcess } from './suppliers'
import { CM_PER_IN } from '@/lib/units'

export interface PreflightIssue {
  level: 'error' | 'warn'
  /** `DtfPiece.id` the issue belongs to. */
  pieceKey: string
  /** Stable machine code, safe to switch on / to map to a fix action. */
  code: string
  message: string
}

/** Warn band above the hard DPI floor (10 % head-room). */
const DPI_WARN_RATIO = 1.1

const fmt1 = (v: number) => (Math.round(v * 10) / 10).toString().replace('.', ',')
/** Optional numeric metadata → 0 when absent/unusable (⇒ check skipped). */
const num = (v: number | undefined): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0

/**
 * Check every piece against `proc`. Order is stable: pieces in input order,
 * checks in declaration order (errors and warnings interleaved per piece).
 */
export function preflight(pieces: DtfPiece[], proc: DtfProcess): PreflightIssue[] {
  const out: PreflightIssue[] = []
  const gl = proc.guidelines
  const add = (level: 'error' | 'warn', pieceKey: string, code: string, message: string) =>
    out.push({ level, pieceKey, code, message })

  // Largest artwork box the process can physically print, margins included.
  // The two margins are different constraints (the side one is the printer's
  // laize limit, the end one a scissor cut), so a supplier quoting a printable
  // width (side margin 0) must not have that 0 applied to the length as well.
  const marginEnd = typeof gl.marginEndCm === 'number' ? gl.marginEndCm : gl.marginCm
  const usableWCm = Math.max(0, proc.printableWidthCm - 2 * gl.marginCm)
  const usableLCm = Math.max(0, proc.maxLengthCm - 2 * marginEnd)
  // On fixed billing each format is its own box; a piece must fit at least one.
  const boxes: { w: number; h: number; label: string }[] =
    proc.billing === 'fixed'
      ? proc.formats.map((f) => ({
          w: Math.max(0, f.wCm - 2 * gl.marginCm),
          h: Math.max(0, f.hCm - 2 * marginEnd),
          label: f.label,
        }))
      : [{ w: usableWCm, h: usableLCm, label: `${fmt1(proc.printableWidthCm)} cm` }]

  for (const p of pieces) {
    const qty = Math.floor(p.qty)
    if (qty <= 0) continue

    if (!Number.isFinite(p.wCm) || !Number.isFinite(p.hCm) || p.wCm <= 0 || p.hCm <= 0) {
      add('error', p.id, 'geometry-invalid', 'Dimensions du visuel invalides (0 ou non finies).')
      continue
    }

    // --- fits the process / a catalogue format ----------------------------
    const fitsBox = (b: { w: number; h: number }) =>
      (p.wCm <= b.w + 1e-6 && p.hCm <= b.h + 1e-6) ||
      (p.allowRotate && p.hCm <= b.w + 1e-6 && p.wCm <= b.h + 1e-6)
    if (!boxes.some(fitsBox)) {
      const size = `${fmt1(p.wCm)} × ${fmt1(p.hCm)} cm`
      if (proc.billing === 'fixed')
        add(
          'error',
          p.id,
          'no-format',
          `${size} n’entre dans aucun format du catalogue (marge ${fmt1(gl.marginCm)} cm incluse).`,
        )
      else if (Math.min(p.wCm, p.allowRotate ? p.hCm : p.wCm) > usableWCm + 1e-6)
        add(
          'error',
          p.id,
          'too-wide',
          `${size} dépasse la laize imprimable (${fmt1(usableWCm)} cm utiles).`,
        )
      else
        add(
          'error',
          p.id,
          'too-long',
          `${size} dépasse la longueur max par fichier (${fmt1(usableLCm)} cm utiles).`,
        )
    }

    // --- supplier cap on a single design ----------------------------------
    if (gl.maxDesignWCm !== null && p.wCm > gl.maxDesignWCm + 1e-6)
      add(
        'error',
        p.id,
        'over-max-w',
        `Largeur ${fmt1(p.wCm)} cm > maximum autorisé ${fmt1(gl.maxDesignWCm)} cm.`,
      )
    if (gl.maxDesignHCm !== null && p.hCm > gl.maxDesignHCm + 1e-6)
      add(
        'error',
        p.id,
        'over-max-h',
        `Hauteur ${fmt1(p.hCm)} cm > maximum autorisé ${fmt1(gl.maxDesignHCm)} cm.`,
      )

    // --- effective resolution at the printed size -------------------------
    if (num(p.srcPxW) > 0 && num(p.srcPxH) > 0) {
      const dpiW = num(p.srcPxW) / (p.wCm / CM_PER_IN)
      const dpiH = num(p.srcPxH) / (p.hCm / CM_PER_IN)
      const dpi = Math.min(dpiW, dpiH)
      if (dpi < gl.minDpi - 0.5)
        add(
          'error',
          p.id,
          'dpi-low',
          `${Math.round(dpi)} DPI à ${fmt1(p.wCm)} × ${fmt1(p.hCm)} cm, minimum ${gl.minDpi} DPI.`,
        )
      else if (dpi < gl.minDpi * DPI_WARN_RATIO)
        add(
          'warn',
          p.id,
          'dpi-marginal',
          `${Math.round(dpi)} DPI, juste au-dessus du minimum ${gl.minDpi} DPI, aucune marge.`,
        )
    }

    // --- transparency -----------------------------------------------------
    if (p.hasAlpha === false)
      add(
        'error',
        p.id,
        'no-transparency',
        `Fond opaque détecté : ${gl.transparency}.`,
      )

    // --- stroke / text floors (only when the caller measured them) --------
    const line = num(p.minLineMm)
    if (line > 0 && line < gl.minLineMmColour - 1e-6)
      add(
        'error',
        p.id,
        'line-thin',
        `Trait ${fmt1(line)} mm < minimum couleur ${fmt1(gl.minLineMmColour)} mm.`,
      )
    const white = num(p.whiteMinLineMm)
    if (white > 0 && white < gl.minLineMmWhite - 1e-6)
      add(
        'error',
        p.id,
        'line-thin-white',
        `Trait blanc ${fmt1(white)} mm < minimum blanc ${fmt1(gl.minLineMmWhite)} mm.`,
      )
    const pt = num(p.minTextPt)
    if (pt > 0 && pt < gl.minTextPt - 1e-6)
      add(
        'warn',
        p.id,
        'text-small',
        `Texte ${fmt1(pt)} pt < taille conseillée ${fmt1(gl.minTextPt)} pt.`,
      )
  }

  return out
}

/** Convenience: does this batch have any blocking issue? */
export const hasErrors = (issues: PreflightIssue[]): boolean =>
  issues.some((i) => i.level === 'error')
