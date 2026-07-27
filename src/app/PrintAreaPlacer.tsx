/**
 * PrintAreaPlacer — the ONE surface for placing a print area on a garment
 * photo (customer "ship your own" setup AND admin product ingest).
 *
 * WHY IT LOOKS LIKE THIS
 * ----------------------
 * The old placer was a bare drag box: the customer eyeballed a rectangle over
 * a photo and hoped it was centred. That is exactly the guessing this replaces.
 * Here the photo is first MEASURED (src/lib/garmentAnatomy.ts: mirror axis,
 * collar line, shoulders, torso edges, hem) and every affordance is expressed
 * in those measurements:
 *
 *  - guides draw the landmarks, so "the middle" is a line you can see;
 *  - dragging SNAPS to the professional placements — the very centimetres the
 *    catalog garments use (src/content/zones.ts PLACEMENT_CM), so a customer's
 *    own tee gets the same 7 cm-below-collar chest print a catalog tee does;
 *  - the margins are printed live in cm, with a symmetry badge, so "evenly
 *    spaced" is a number and not a feeling;
 *  - numeric cm entry exists for people who already know their measurement.
 *
 * FALLBACK IS A FIRST-CLASS PATH. Photos without background removal have no
 * silhouette to measure (`anatomy.opaque`), and some necklines simply cannot
 * be found. Then the guides become proportional, presets fall back to the
 * fractions this component always used, and every chip says so through its
 * title — the tool must stay fully usable, just less clever.
 *
 * INVARIANTS
 *  - The persisted shape never changes: `RectIn` in INCHES relative to the
 *    photo's alpha-bbox top-left, bbox width == the garment's laid-flat width.
 *    Anatomy is derived on the fly, never stored.
 *  - Every write goes through `clampArea` (min edge, inside the garment) — the
 *    drag path, the snap path, the keyboard path and the numeric fields.
 *  - Pointer-event based, capture on the grabbed element, `touch-action: none`
 *    on the box: a fast drag that leaves the photo must not drop, and a touch
 *    drag must not scroll the modal underneath.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Grid3x3, Wand2 } from 'lucide-react'
import { useT } from '@/i18n'
import { PAPER_IN, PLACEMENT_CM } from '@/content/zones'
import { getCustomSideInfo } from '@/lib/custom'
import {
  getGarmentAnatomy,
  proportionalAnatomy,
  type GarmentAnatomy,
} from '@/lib/garmentAnatomy'
import type { CustomSideSetup, RectIn, Side } from '@/lib/types'
import { clamp, cmToIn, fmtCm, fmtIn, inToCm } from '@/lib/units'

/** Photo stage budget (CSS px) — shrunk to the container on narrow screens. */
const MAX_STAGE_W = 430
const MAX_STAGE_H = 280
/** Ruler gutter, CSS px. */
const RULER = 15
/** Magnetic tolerance in SCREEN px (converted to inches per zoom level).
 *  Deliberately in screen px and not in cm: it has to stay the same *gesture*
 *  at every zoom (~1.3 cm of garment at the stage sizes this component
 *  actually reaches, which is height-limited far more often than
 *  width-limited). Alt suspends it for a placement that must not be helped. */
const SNAP_PX = 6
/** Keyboard nudge steps. */
const NUDGE_CM = 0.1
const NUDGE_SHIFT_CM = 1
/** Margin below which left/right are "symmetric" (0.2 cm ≈ the print shop's
 *  own tolerance — tighter than any human can lay a garment). */
const SYMMETRY_TOL_CM = 0.2
/** Seam allowance kept clear when fitting a print to the torso. */
const TORSO_INSET_CM = 1.5

type DragKind = 'move' | 'nw' | 'ne' | 'sw' | 'se'
type SnapEdge = 'cx' | 'left' | 'right' | 'top' | 'bottom'

interface SnapTarget {
  id: string
  edge: SnapEdge
  valueIn: number
}

interface Preset {
  id: string
  labelKey: string
  rect: RectIn
  /** true when the placement used the DETECTED collar (real cm maths). */
  measured: boolean
}

// ---------------------------------------------------------------------------
// Geometry helpers (pure — no DOM, no React)
// ---------------------------------------------------------------------------

function edgeValue(a: RectIn, e: SnapEdge): number {
  switch (e) {
    case 'cx':
      return a.xIn + a.wIn / 2
    case 'left':
      return a.xIn
    case 'right':
      return a.xIn + a.wIn
    case 'top':
      return a.yIn
    case 'bottom':
      return a.yIn + a.hIn
  }
}

/**
 * Pull the dragged rect onto the nearest guide, at most one snap per axis.
 * Only the edges the gesture actually moves are candidates — snapping the
 * centre while dragging a corner would fight the user's hand.
 *
 * CENTRING OUTRANKS EDGE ALIGNMENT: when both a centre-line target and a torso
 * edge are in range, the centre wins even if the edge is marginally closer.
 * "Centred and evenly spaced" is the thing the user actually asked for, and an
 * edge snap that silently beats it by 2 mm reads as the tool fighting back.
 */
function snapArea(
  a: RectIn,
  kind: DragKind,
  targets: SnapTarget[],
  tolIn: number,
): { area: RectIn; ids: string[] } {
  const free: SnapEdge[] =
    kind === 'move'
      ? ['cx', 'left', 'right', 'top', 'bottom']
      : [kind.includes('w') ? 'left' : 'right', kind.includes('n') ? 'top' : 'bottom']
  let bx: { id: string; edge: SnapEdge; d: number } | null = null
  let by: { id: string; edge: SnapEdge; d: number } | null = null
  for (const t of targets) {
    if (!free.includes(t.edge)) continue
    const d = t.valueIn - edgeValue(a, t.edge)
    if (Math.abs(d) > tolIn) continue
    const hit = { id: t.id, edge: t.edge, d }
    if (t.edge === 'top' || t.edge === 'bottom') {
      if (!by || Math.abs(d) < Math.abs(by.d)) by = hit
    } else if (
      !bx ||
      (t.edge === 'cx' && bx.edge !== 'cx') ||
      ((t.edge === 'cx') === (bx.edge === 'cx') && Math.abs(d) < Math.abs(bx.d))
    ) {
      bx = hit
    }
  }
  const out = { ...a }
  const ids: string[] = []
  if (bx) {
    ids.push(bx.id)
    if (kind === 'move' || bx.edge === 'cx') out.xIn += bx.d
    else if (bx.edge === 'left') {
      out.xIn += bx.d
      out.wIn -= bx.d
    } else out.wIn += bx.d
  }
  if (by) {
    ids.push(by.id)
    if (kind === 'move') out.yIn += by.d
    else if (by.edge === 'top') {
      out.yIn += by.d
      out.hIn -= by.d
    } else out.hIn += by.d
  }
  return { area: out, ids }
}

/**
 * Preset placements, built from the SAME centimetres the catalog garments use
 * (PLACEMENT_CM / PAPER_IN in src/content/zones.ts) anchored on the detected
 * collar and centre line. `measured: false` means the collar was not found and
 * the rect is the historical proportional guess — surfaced in the chip title
 * so nobody mistakes a guess for a measurement.
 */
function presetsFor(
  side: Side,
  a: GarmentAnatomy,
  widthIn: number,
  heightIn: number,
  minIn: number,
): Preset[] {
  const collar = a.collarYIn
  const axis = a.axisXIn
  const torsoW = Math.max(cmToIn(6), a.torsoRightXIn - a.torsoLeftXIn)
  const hem = a.hemYIn > 0 ? a.hemYIn : heightIn

  /** Fit a zone: never wider than the torso, never running past the hem.
   *  The `minIn` floor is applied HERE, not left to clampArea: clampArea only
   *  knows the rect, so it would widen a too-small box to the right and quietly
   *  push a "centred" preset off the centre line. */
  const box = (wCm: number, hCm: number, cxIn: number, topIn: number): RectIn => {
    const wIn = Math.max(minIn, Math.min(cmToIn(wCm), torsoW, widthIn))
    const hIn = Math.max(minIn, Math.min(cmToIn(hCm), hem - topIn - cmToIn(1), heightIn))
    return { xIn: cxIn - wIn / 2, yIn: topIn, wIn, hIn }
  }
  /** Paper formats scale UNIFORMLY — an A4 with a squashed aspect is not A4,
   *  so the `minIn` floor has to move the SCALE, never one axis on its own
   *  (p.h > p.w, so clearing the floor on the width clears it on the height). */
  const paper = (p: { w: number; h: number }, cxIn: number, topIn: number): RectIn => {
    const k = Math.max(
      Math.min(1, torsoW / p.w, Math.max(0, hem - topIn - cmToIn(1)) / p.h),
      minIn / p.w,
    )
    return { xIn: cxIn - (p.w * k) / 2, yIn: topIn, wIn: p.w * k, hIn: p.h * k }
  }

  const P = PLACEMENT_CM
  const chestTop = collar !== null ? collar + cmToIn(P.leftChest.topBelowCollar) : heightIn * 0.22
  const centreTop =
    collar !== null ? collar + cmToIn(P.centerChest.topBelowCollar) : heightIn * 0.22
  const backTop =
    collar !== null ? collar + cmToIn(P.lockerPatch.topBelowCollar) : heightIn * 0.14
  // `belowLocker` is measured from the TOP of the locker patch, not from its
  // bottom — that is what catalogZones does (its back print area starts at the
  // pro 10 cm below the collar and the centre-back zone sits `belowLocker`
  // under that same line). Adding the patch height here too would drop the
  // 35.6 cm-tall centre back 10 cm lower than the identical catalog placement
  // and squash it against the hem clamp.
  const backCentreTop =
    collar !== null
      ? collar + cmToIn(P.lockerPatch.topBelowCollar + P.centerBack.belowLocker)
      : heightIn * 0.32
  const measured = collar !== null

  /** Largest sane print: torso minus seam allowance, collar to hem. */
  const fullRect = (topIn: number): RectIn => {
    if (!measured) {
      return {
        xIn: widthIn * 0.1,
        yIn: heightIn * 0.12,
        wIn: widthIn * 0.8,
        hIn: heightIn * 0.72,
      }
    }
    const wIn = Math.max(minIn, torsoW - 2 * cmToIn(TORSO_INSET_CM))
    const hIn = Math.max(minIn, hem - cmToIn(P.bottomHem.bottomMargin) - topIn)
    return { xIn: axis - wIn / 2, yIn: topIn, wIn, hIn }
  }

  if (side === 'sleeve') {
    return [
      {
        id: 'sleeve_logo',
        labelKey: 'zone.sleeve_logo',
        rect: box(P.sleeve.w, P.sleeve.h, axis, Math.max(0, heightIn * 0.3)),
        measured: false,
      },
      { id: 'full', labelKey: 'custom.full_side', rect: fullRect(heightIn * 0.12), measured: false },
    ]
  }

  if (side === 'back') {
    return [
      {
        id: 'upper_back',
        labelKey: 'zone.upper_back',
        rect: box(P.lockerPatch.w, P.lockerPatch.h, axis, backTop),
        measured,
      },
      {
        id: 'center_back',
        labelKey: 'zone.center_back',
        rect: box(P.centerBack.w, P.centerBack.h, axis, backCentreTop),
        measured,
      },
      { id: 'a4', labelKey: 'zone.a4', rect: paper(PAPER_IN.a4, axis, backTop), measured },
      { id: 'a3', labelKey: 'zone.a3', rect: paper(PAPER_IN.a3, axis, backTop), measured },
      { id: 'full', labelKey: 'custom.full_side', rect: fullRect(backTop), measured },
    ]
  }

  return [
    // Heart side is +x here. `box`'s cxIn is a photo-space centre with +x to the
    // image's right, and a FRONT view shows the wearer's left on the image's
    // right — the same handedness src/content/zones.ts derives and marks with
    // `bodySideSign`. Sharing PLACEMENT_CM is only worth anything if the sides
    // agree too, so a "left chest" here is the same shoulder as on a catalog tee.
    {
      id: 'left_chest',
      labelKey: 'placer.left_chest',
      rect: box(P.leftChest.w, P.leftChest.h, axis + cmToIn(P.leftChest.offCenter), chestTop),
      measured,
    },
    {
      id: 'right_chest',
      labelKey: 'placer.right_chest',
      rect: box(P.leftChest.w, P.leftChest.h, axis - cmToIn(P.leftChest.offCenter), chestTop),
      measured,
    },
    {
      id: 'center_chest',
      labelKey: 'zone.center_chest',
      rect: box(P.centerChest.w, P.centerChest.h, axis, centreTop),
      measured,
    },
    {
      id: 'bottom_center',
      labelKey: 'zone.bottom_center',
      // Anchored on the hem, which is just the bottom of the alpha content —
      // always known, collar or no collar. Except on an un-cut-out photo,
      // where the "hem" is the bottom of the FRAME and this is a guess like
      // any other.
      rect: box(
        P.bottomHem.w,
        P.bottomHem.h,
        axis,
        Math.max(0, hem - cmToIn(P.bottomHem.bottomMargin + P.bottomHem.h)),
      ),
      measured: !a.opaque,
    },
    { id: 'a4', labelKey: 'zone.a4', rect: paper(PAPER_IN.a4, axis, centreTop), measured },
    { id: 'a3', labelKey: 'zone.a3', rect: paper(PAPER_IN.a3, axis, centreTop), measured },
    { id: 'full', labelKey: 'custom.full_side', rect: fullRect(centreTop), measured },
  ]
}

// ---------------------------------------------------------------------------
// Rulers
// ---------------------------------------------------------------------------

/** cm ruler: a tick every centimetre, a labelled long tick every 5. */
function Ruler({
  lengthIn,
  ppi,
  vertical,
  label,
}: {
  lengthIn: number
  ppi: number
  vertical?: boolean
  label: string
}) {
  const ticks: React.ReactNode[] = []
  const totalCm = Math.floor(inToCm(lengthIn))
  for (let c = 0; c <= totalCm; c++) {
    const pos = cmToIn(c) * ppi
    const major = c % 5 === 0
    ticks.push(
      <span
        key={c}
        className={clsx('absolute bg-tx3', major ? 'opacity-70' : 'opacity-30')}
        style={
          vertical
            ? { top: pos, right: 0, height: 1, width: major ? 7 : 4 }
            : { left: pos, bottom: 0, width: 1, height: major ? 7 : 4 }
        }
      />,
    )
    if (major && c > 0 && c < totalCm - 1) {
      ticks.push(
        <span
          key={`l${c}`}
          className="absolute font-mono text-[7.5px] leading-none text-tx3"
          style={
            vertical
              ? { top: pos + 1, left: 0 }
              : { left: pos + 1.5, top: 0 }
          }
        >
          {c}
        </span>,
      )
    }
  }
  return (
    <div
      role="img"
      aria-label={label}
      className="relative overflow-hidden"
      style={vertical ? { width: RULER, height: lengthIn * ppi } : { height: RULER, width: lengthIn * ppi }}
    >
      {ticks}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Placer
// ---------------------------------------------------------------------------

export interface PrintAreaPlacerProps {
  /** Photo + current area. ProductSideDef is structurally identical on purpose. */
  setup: CustomSideSetup
  /** Garment laid-flat width in inches — the bbox width in real units. */
  widthIn: number
  /** Front and back have different professional placements. */
  side: Side
  onChange: (area: RectIn) => void
  /** Garment height, when the caller knows it before the photo is measured. */
  heightHintIn?: number
  /** Smallest allowed box edge, inches (ingest allows smaller labels). */
  minIn?: number
  /** Optional extra suggestion action (admin ingest's automatic area). */
  onAuto?: () => void
  autoLabel?: string
}

export default function PrintAreaPlacer({
  setup,
  widthIn,
  side,
  onChange,
  heightHintIn,
  minIn = 3,
  onAuto,
  autoLabel,
}: PrintAreaPlacerProps) {
  const t = useT()
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [budgetW, setBudgetW] = useState(MAX_STAGE_W)
  // `hIn` is carried explicitly and NOT recovered as h/ppi: h is rounded to a
  // whole CSS pixel, and at phone zoom that rounding is ~2 mm of garment — a
  // silent error in the one tool whose whole promise is millimetre honesty.
  const [disp, setDisp] = useState<{ w: number; h: number; hIn: number; ppi: number } | null>(null)
  const [measured, setMeasured] = useState<GarmentAnatomy | null>(null)
  const [grid, setGrid] = useState(false)
  const [activeSnaps, setActiveSnaps] = useState<string[]>([])
  const [typing, setTyping] = useState<{ key: keyof RectIn; text: string } | null>(null)

  const area = setup.printArea
  const gHIn = disp ? disp.hIn : (heightHintIn ?? 0)

  // Anatomy is derived; until it arrives (and whenever it is unusable) the
  // proportional stand-in keeps every consumer branch-free.
  const anatomy = useMemo(
    () => measured ?? proportionalAnatomy(widthIn, gHIn || widthIn * 1.35),
    [measured, widthIn, gHIn],
  )
  const hasCollar = anatomy.collarYIn !== null
  const hasAxis = anatomy.axisConfidence >= 0.35

  // --- stage sizing --------------------------------------------------------
  // The photo must shrink on a narrow phone; ResizeObserver keeps ppi honest
  // so every inch↔px conversion below stays exact after a rotation.
  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      setBudgetW(clamp(el.clientWidth - RULER - 2, 140, MAX_STAGE_W))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // --- photo ---------------------------------------------------------------
  // Depends only on WHICH photo is shown (never on printArea, which changes on
  // every drag tick — redrawing the photo per tick would stutter the drag).
  useEffect(() => {
    let on = true
    void (async () => {
      try {
        const info = await getCustomSideInfo(setup, widthIn)
        if (!on || !canvasRef.current) return
        const gIn = info.bbox.h / info.pxPerInch
        const ppi = Math.min(budgetW / widthIn, MAX_STAGE_H / gIn)
        const w = Math.round(widthIn * ppi)
        const h = Math.round(gIn * ppi)
        const canvas = canvasRef.current
        canvas.width = w * 2
        canvas.height = h * 2
        canvas.style.width = `${w}px`
        canvas.style.height = `${h}px`
        const ctx = canvas.getContext('2d')!
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(
          info.img,
          info.bbox.x,
          info.bbox.y,
          info.bbox.w,
          info.bbox.h,
          0,
          0,
          canvas.width,
          canvas.height,
        )
        setDisp({ w, h, hIn: gIn, ppi })
      } catch {
        if (on) setDisp(null)
      }
    })()
    return () => {
      on = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup.assetId, setup.useCutout, widthIn, budgetW])

  // --- anatomy -------------------------------------------------------------
  useEffect(() => {
    let on = true
    void getGarmentAnatomy(setup, widthIn)
      .then((a) => {
        if (on) setMeasured(a)
      })
      .catch(() => {
        if (on) setMeasured(null)
      })
    return () => {
      on = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup.assetId, setup.useCutout, widthIn])

  // --- clamping ------------------------------------------------------------
  // The horizontal half never depends on the photo: the width is a prop. Only
  // the vertical half waits for the measured height — otherwise the cm fields
  // and the preset chips (which render before the canvas resolves) would have
  // a window in which they write a completely unclamped rect straight into the
  // saved design.
  const clampArea = useCallback(
    (a: RectIn): RectIn => {
      const wIn = clamp(a.wIn, Math.min(minIn, widthIn), widthIn)
      const xIn = clamp(a.xIn, 0, Math.max(0, widthIn - wIn))
      if (gHIn <= 0) return { ...a, wIn, xIn }
      const hIn = clamp(a.hIn, Math.min(minIn, gHIn), gHIn)
      return { wIn, hIn, xIn, yIn: clamp(a.yIn, 0, gHIn - hIn) }
    },
    [gHIn, widthIn, minIn],
  )

  // --- snap targets --------------------------------------------------------
  const snapTargets = useMemo<SnapTarget[]>(() => {
    const P = PLACEMENT_CM
    const s: SnapTarget[] = [
      { id: 'axis', edge: 'cx', valueIn: anatomy.axisXIn },
      { id: 'equal', edge: 'cx', valueIn: (anatomy.torsoLeftXIn + anatomy.torsoRightXIn) / 2 },
      { id: 'torsoL', edge: 'left', valueIn: anatomy.torsoLeftXIn },
      { id: 'torsoR', edge: 'right', valueIn: anatomy.torsoRightXIn },
      { id: 'hem', edge: 'bottom', valueIn: anatomy.hemYIn - cmToIn(P.bottomHem.bottomMargin) },
    ]
    if (side !== 'back') {
      s.push(
        // L/R are the WEARER's, so +x (image-right on a front view) is the
        // left/heart side — same convention as the presets above.
        { id: 'chestL', edge: 'cx', valueIn: anatomy.axisXIn + cmToIn(P.leftChest.offCenter) },
        { id: 'chestR', edge: 'cx', valueIn: anatomy.axisXIn - cmToIn(P.leftChest.offCenter) },
      )
    }
    if (anatomy.collarYIn !== null) {
      const c = anatomy.collarYIn
      // Front/sleeve prints are anchored 7 cm (chest logo) or 7.5 cm (centre
      // chest) below the collar; back prints start at 10 cm. Offering the
      // front anchors on a back photo would snap to a placement no print shop
      // uses.
      if (side === 'back') {
        s.push({ id: 'collar10', edge: 'top', valueIn: c + cmToIn(P.lockerPatch.topBelowCollar) })
      } else {
        s.push({ id: 'collar7', edge: 'top', valueIn: c + cmToIn(P.leftChest.topBelowCollar) })
        s.push({ id: 'collar75', edge: 'top', valueIn: c + cmToIn(P.centerChest.topBelowCollar) })
      }
    }
    return s
  }, [anatomy, side])

  // --- drag ----------------------------------------------------------------
  // Everything the window listener needs lives in refs: the listener is
  // registered once, so a captured `onChange`/`area` would go stale after the
  // parent re-renders mid-drag (and would then spread an outdated rect).
  const drag = useRef<{ kind: DragKind; startX: number; startY: number; area: RectIn } | null>(null)
  const live = useRef({ clampArea, onChange, snapTargets, ppi: 0 })
  live.current = { clampArea, onChange, snapTargets, ppi: disp?.ppi ?? 0 }

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current
      const { ppi } = live.current
      if (!d || !ppi) return
      const dxIn = (e.clientX - d.startX) / ppi
      const dyIn = (e.clientY - d.startY) / ppi
      const a = { ...d.area }
      if (d.kind === 'move') {
        a.xIn += dxIn
        a.yIn += dyIn
      } else {
        if (d.kind.includes('w')) {
          a.xIn += dxIn
          a.wIn -= dxIn
        } else {
          a.wIn += dxIn
        }
        if (d.kind.includes('n')) {
          a.yIn += dyIn
          a.hIn -= dyIn
        } else {
          a.hIn += dyIn
        }
      }
      // Alt suspends magnetism — the escape hatch for a deliberately odd
      // placement that happens to pass near a guide.
      const snapped = e.altKey
        ? { area: a, ids: [] as string[] }
        : snapArea(a, d.kind, live.current.snapTargets, SNAP_PX / ppi)
      setActiveSnaps(snapped.ids)
      live.current.onChange(live.current.clampArea(snapped.area))
    }
    const end = () => {
      if (!drag.current) return
      drag.current = null
      setActiveSnaps([])
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [])

  const start = (kind: DragKind) => (e: React.PointerEvent<HTMLElement>) => {
    // preventDefault stops the text-selection / native image drag, but it also
    // cancels the focus the click would have given us. Both consequences have
    // to be undone by hand: without the focus() the arrow-key nudge is only
    // reachable by tabbing (the box LOOKS focusable and silently is not), and
    // without the setTyping a cm field that never blurred keeps showing the
    // half-typed text while the drag rewrites the value under it.
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.focus({ preventScroll: true })
    setTyping(null)
    // Capture so a fast drag that outruns the pointer keeps feeding us moves
    // even once the cursor leaves the photo (events still bubble to window).
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* capture is a nicety; window listeners already cover the common case */
    }
    drag.current = { kind, startX: e.clientX, startY: e.clientY, area }
  }

  // --- keyboard ------------------------------------------------------------
  const nudge = (kind: DragKind) => (e: React.KeyboardEvent) => {
    const step = cmToIn(e.shiftKey ? NUDGE_SHIFT_CM : NUDGE_CM)
    let dx = 0
    let dy = 0
    if (e.key === 'ArrowLeft') dx = -step
    else if (e.key === 'ArrowRight') dx = step
    else if (e.key === 'ArrowUp') dy = -step
    else if (e.key === 'ArrowDown') dy = step
    else return
    e.preventDefault()
    e.stopPropagation()
    const a = { ...area }
    if (kind === 'move') {
      a.xIn += dx
      a.yIn += dy
    } else {
      if (kind.includes('w')) {
        a.xIn += dx
        a.wIn -= dx
      } else a.wIn += dx
      if (kind.includes('n')) {
        a.yIn += dy
        a.hIn -= dy
      } else a.hIn += dy
    }
    onChange(clampArea(a))
  }

  // --- derived measurements ------------------------------------------------
  const marginLeftIn = area.xIn - anatomy.torsoLeftXIn
  const marginRightIn = anatomy.torsoRightXIn - (area.xIn + area.wIn)
  const topIn = hasCollar ? area.yIn - (anatomy.collarYIn ?? 0) : area.yIn
  const bottomIn = anatomy.hemYIn - (area.yIn + area.hIn)
  const symmetric =
    Math.abs(inToCm(marginLeftIn) - inToCm(marginRightIn)) < SYMMETRY_TOL_CM
  const centred = Math.abs(area.xIn + area.wIn / 2 - anatomy.axisXIn) < cmToIn(SYMMETRY_TOL_CM)

  const presets = useMemo(
    () => (gHIn > 0 ? presetsFor(side, anatomy, widthIn, gHIn, minIn) : []),
    [side, anatomy, widthIn, gHIn, minIn],
  )

  // --- actions -------------------------------------------------------------
  const setCx = (cxIn: number) => onChange(clampArea({ ...area, xIn: cxIn - area.wIn / 2 }))
  const fitTorso = () => {
    const wIn = Math.max(minIn, anatomy.torsoRightXIn - anatomy.torsoLeftXIn - 2 * cmToIn(TORSO_INSET_CM))
    onChange(clampArea({ ...area, wIn, xIn: anatomy.axisXIn - wIn / 2 }))
  }

  const setField = (key: keyof RectIn, vIn: number) => {
    const next: RectIn = { ...area }
    next[key] = vIn
    onChange(clampArea(next))
  }

  /**
   * Typed text is kept verbatim while a field has focus. Without it, typing
   * "25" writes 2 cm first, the clamp bounces it to the 3 in minimum, and the
   * field rewrites itself under the caret — the value still ends up clamped,
   * but the user gets to finish the number first.
   */
  const numField = (key: keyof RectIn, labelKey: string, ariaKey: string) => (
    <label className="flex items-center gap-1 text-[10.5px] text-tx3">
      {t(labelKey)}
      <input
        type="number"
        step={0.1}
        min={0}
        aria-label={t(ariaKey)}
        className="input h-7 w-[4.6rem] px-1.5 text-right font-mono text-[11.5px]"
        value={typing?.key === key ? typing.text : Math.round(inToCm(area[key]) * 10) / 10}
        onChange={(e) => {
          const text = e.target.value
          setTyping({ key, text })
          const v = parseFloat(text.replace(',', '.'))
          if (Number.isFinite(v)) setField(key, cmToIn(v))
        }}
        onBlur={() => setTyping(null)}
      />
    </label>
  )

  // --- guides --------------------------------------------------------------
  const ppi = disp?.ppi ?? 0
  const isSnapped = (...ids: string[]) => ids.some((i) => activeSnaps.includes(i))
  const vline = (id: string, xIn: number, cls: string, dash: string, ...hl: string[]) => {
    const lit = isSnapped(id, ...hl)
    return (
      <line
        key={id}
        x1={xIn * ppi}
        y1={0}
        x2={xIn * ppi}
        y2={disp?.h ?? 0}
        stroke="currentColor"
        strokeDasharray={dash}
        className={clsx(lit ? 'text-cy' : cls)}
        strokeWidth={lit ? 1.5 : 1}
      />
    )
  }
  const hline = (id: string, yIn: number, cls: string, dash: string, ...hl: string[]) => {
    const lit = isSnapped(id, ...hl)
    return (
      <line
        key={id}
        x1={0}
        y1={yIn * ppi}
        x2={disp?.w ?? 0}
        y2={yIn * ppi}
        stroke="currentColor"
        strokeDasharray={dash}
        className={clsx(lit ? 'text-cy' : cls)}
        strokeWidth={lit ? 1.5 : 1}
      />
    )
  }
  /** Centre of the two torso edges — the snap target `equal` aims at THIS, not
   *  at the frame centre, so the guide has to be drawn at the same number. */
  const equalXIn = (anatomy.torsoLeftXIn + anatomy.torsoRightXIn) / 2

  /** Detected body outline, mirrored on the axis — shows WHAT was measured. */
  const bodyPath = useMemo(() => {
    const rows = anatomy.rowWidthIn
    if (anatomy.opaque || rows.length < 8 || !disp) return null
    const step = Math.max(1, Math.floor(rows.length / 48))
    const left: string[] = []
    const right: string[] = []
    for (let i = 0; i < rows.length; i += step) {
      if (rows[i] <= 0) continue
      // rowWidthIn spans the whole bbox height, so index → inches uses the
      // displayed garment height (the bbox is tight: hem == bottom edge).
      const y = ((i + 0.5) / rows.length) * gHIn * ppi
      left.push(`${((anatomy.axisXIn - rows[i] / 2) * ppi).toFixed(1)},${y.toFixed(1)}`)
      right.unshift(`${((anatomy.axisXIn + rows[i] / 2) * ppi).toFixed(1)},${y.toFixed(1)}`)
    }
    if (left.length < 4) return null
    return `M${left.join(' L')} L${right.join(' L')} Z`
  }, [anatomy, disp, ppi, gHIn])

  const gridLines = useMemo(() => {
    if (!grid || !disp) return null
    const out: React.ReactNode[] = []
    for (let c = 1; c < inToCm(widthIn); c++) {
      const x = cmToIn(c) * ppi
      out.push(
        <line
          key={`v${c}`}
          x1={x}
          y1={0}
          x2={x}
          y2={disp.h}
          stroke="currentColor"
          className={c % 5 === 0 ? 'text-tx2/35' : 'text-tx2/15'}
          strokeWidth={1}
        />,
      )
    }
    for (let c = 1; c < inToCm(gHIn); c++) {
      const y = cmToIn(c) * ppi
      out.push(
        <line
          key={`h${c}`}
          x1={0}
          y1={y}
          x2={disp.w}
          y2={y}
          stroke="currentColor"
          className={c % 5 === 0 ? 'text-tx2/35' : 'text-tx2/15'}
          strokeWidth={1}
        />,
      )
    }
    return out
  }, [grid, disp, ppi, widthIn, gHIn])

  const stat = (label: string, valueIn: number, ok?: boolean) => (
    <span className="flex items-baseline gap-1">
      <span className="text-[10px] text-tx3">{label}</span>
      <span className={clsx('font-mono text-[11px]', ok ? 'text-ok' : 'text-tx2')}>
        {fmtCm(inToCm(valueIn))}
      </span>
    </span>
  )

  return (
    <div className="flex flex-col gap-2" ref={wrapRef}>
      {/* ---------------------------------------------------------- stage */}
      <div
        className="mx-auto grid select-none"
        style={{ gridTemplateColumns: `${RULER}px auto` }}
      >
        <div />
        {disp ? (
          <Ruler lengthIn={widthIn} ppi={disp.ppi} label={t('placer.ruler_x')} />
        ) : (
          <div style={{ height: RULER }} />
        )}
        {disp ? (
          <Ruler lengthIn={gHIn} ppi={disp.ppi} vertical label={t('placer.ruler_y')} />
        ) : (
          <div style={{ width: RULER }} />
        )}
        <div className="relative">
          <canvas ref={canvasRef} className="rounded-lg bg-bg0" />
          {disp && (
            <svg
              className="pointer-events-none absolute left-0 top-0"
              width={disp.w}
              height={disp.h}
              aria-hidden="true"
            >
              {gridLines}
              {bodyPath && (
                <path d={bodyPath} fill="none" stroke="currentColor" className="text-cy/20" strokeWidth={1} />
              )}
              {vline('torsoL', anatomy.torsoLeftXIn, 'text-tx2/35', '4 4')}
              {vline('torsoR', anatomy.torsoRightXIn, 'text-tx2/35', '4 4')}
              {vline('axis', anatomy.axisXIn, hasAxis ? 'text-cy/45' : 'text-tx2/25', '6 4')}
              {/* Only worth its own line when the garment was laid down crooked
                  enough that "evenly spaced" and "on the mirror axis" disagree. */}
              {Math.abs(equalXIn - anatomy.axisXIn) > cmToIn(0.2) &&
                vline('equal', equalXIn, 'text-tx2/20', '2 5')}
              {/* The ±9.5 cm heart placements. They are snap targets, so they
                  have to be visible: an invisible magnet reads as a glitch. */}
              {side !== 'back' && (
                <>
                  {vline('chestL', anatomy.axisXIn + cmToIn(PLACEMENT_CM.leftChest.offCenter), 'text-mg/20', '2 4')}
                  {vline('chestR', anatomy.axisXIn - cmToIn(PLACEMENT_CM.leftChest.offCenter), 'text-mg/20', '2 4')}
                </>
              )}
              {hline('shoulder', anatomy.shoulderYIn, 'text-tx2/25', '2 5')}
              {anatomy.collarYIn !== null && hline('collar', anatomy.collarYIn, 'text-mg/45', '5 3')}
              {/* The professional drop marker for this side: 7 cm below the
                  collar on the front, 10 cm on the back. Lights up for any of
                  the collar-anchored snaps. */}
              {anatomy.collarYIn !== null &&
                hline(
                  'collarDrop',
                  anatomy.collarYIn +
                    cmToIn(
                      side === 'back'
                        ? PLACEMENT_CM.lockerPatch.topBelowCollar
                        : PLACEMENT_CM.leftChest.topBelowCollar,
                    ),
                  'text-mg/25',
                  '2 4',
                  'collar7',
                  'collar75',
                  'collar10',
                )}
              {hline('hem', anatomy.hemYIn - cmToIn(PLACEMENT_CM.bottomHem.bottomMargin), 'text-tx2/25', '2 4')}
            </svg>
          )}
          {disp && (
            <div
              tabIndex={0}
              role="group"
              aria-label={t('placer.box_aria')}
              onKeyDown={nudge('move')}
              className="absolute cursor-move touch-none border-2 border-cy bg-cy/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cy"
              style={{
                left: area.xIn * disp.ppi,
                top: area.yIn * disp.ppi,
                width: area.wIn * disp.ppi,
                height: area.hIn * disp.ppi,
              }}
              onPointerDown={start('move')}
            >
              <span className="absolute -top-6 left-0 whitespace-nowrap rounded bg-bg1/95 px-1.5 py-0.5 font-mono text-[10px] text-cy">
                {fmtCm(inToCm(area.wIn))} × {fmtCm(inToCm(area.hIn))}
                <span className="text-tx3">
                  {' '}
                  {fmtIn(area.wIn)} × {fmtIn(area.hIn)}
                </span>
              </span>
              {(['nw', 'ne', 'sw', 'se'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-label={t('placer.handle_aria', { corner: t(`placer.corner.${k}`) })}
                  onPointerDown={start(k)}
                  onKeyDown={nudge(k)}
                  className={clsx(
                    'absolute h-3 w-3 touch-none rounded-full border-2 border-bg0 bg-cy',
                    k.includes('n') ? '-top-1.5' : '-bottom-1.5',
                    k.includes('w') ? '-left-1.5' : '-right-1.5',
                    k === 'nw' || k === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize',
                  )}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* --------------------------------------------------- measurements */}
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        {stat(t('placer.m_left'), marginLeftIn, symmetric)}
        {stat(t('placer.m_right'), marginRightIn, symmetric)}
        {stat(hasCollar ? t('placer.m_collar') : t('placer.m_top'), topIn)}
        {stat(t('placer.m_hem'), bottomIn)}
        {(symmetric || centred) && (
          <span className="rounded-full bg-ok/15 px-2 py-0.5 text-[10px] font-medium text-ok">
            {centred ? t('placer.centered') : t('placer.symmetric')}
          </span>
        )}
        {anatomy.opaque && (
          <span className="text-[10px] text-tx3" title={t('placer.no_cutout_tip')}>
            {t('placer.no_cutout')}
          </span>
        )}
      </div>

      {/* -------------------------------------------------- numeric entry */}
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5">
        {numField('wIn', 'placer.f_w', 'placer.f_w_aria')}
        {numField('hIn', 'placer.f_h', 'placer.f_h_aria')}
        {numField('xIn', 'placer.f_x', 'placer.f_x_aria')}
        {numField('yIn', 'placer.f_y', 'placer.f_y_aria')}
        <button
          type="button"
          aria-pressed={grid}
          onClick={() => setGrid((g) => !g)}
          className={clsx('chip hover:border-cy/50 hover:text-cy', grid && 'border-cy/60 text-cy')}
        >
          <Grid3x3 size={10} /> {t('placer.grid')}
        </button>
      </div>

      {/* ------------------------------------------------------- actions */}
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <button className="chip hover:border-cy/50 hover:text-cy" onClick={() => setCx(widthIn / 2)}>
          {t('placer.center_h')}
        </button>
        <button
          className="chip hover:border-cy/50 hover:text-cy"
          title={hasAxis ? t('placer.tip_measured') : t('placer.tip_proportional')}
          onClick={() => setCx(anatomy.axisXIn)}
        >
          {t('placer.center_torso')}
        </button>
        <button
          className="chip hover:border-cy/50 hover:text-cy"
          onClick={() => setCx(equalXIn)}
        >
          {t('placer.equal_margins')}
        </button>
        <button className="chip hover:border-cy/50 hover:text-cy" onClick={fitTorso}>
          {t('placer.fit_torso')}
        </button>
        {onAuto && (
          <button className="chip hover:border-cy/50 hover:text-cy" onClick={onAuto}>
            <Wand2 size={10} /> {autoLabel ?? t('placer.auto')}
          </button>
        )}
      </div>

      {/* ------------------------------------------------------- presets */}
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {presets.map((p) => (
          <button
            key={p.id}
            className="chip hover:border-cy/50 hover:text-cy"
            title={p.measured ? t('placer.tip_measured') : t('placer.tip_proportional')}
            onClick={() => onChange(clampArea(p.rect))}
          >
            {t(p.labelKey)}
            {!p.measured && <span className="text-tx3">~</span>}
          </button>
        ))}
      </div>

      <p className="text-center text-[10.5px] leading-snug text-tx3">
        {t('custom.drag_hint')} · {t('placer.alt_hint')} · {t('placer.keys_hint')}
      </p>
    </div>
  )
}
