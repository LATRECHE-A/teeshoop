/**
 * A3 dev harness — exercises Garment3D with a generated, dimensionally
 * labeled grid decal (1-inch cells) plus a fake custom-garment card.
 *
 * URL params (for scripted screenshots):
 *   ?g=tee|hoodie|custom  &c=FFFFFF  &v=front|back|threequarter
 *   &rot=0|1  &fd=0|1  &bd=0|1  &bc=0|1  &sd=0|1  (sd = sleeve decal)
 *   &cp=<supplier id>  &cw=<garment width, in>  &cpk=0|1   (see below)
 *
 * `cp` swaps the fake blob card for a REAL supplier photo, cut out with the
 * app's own u2netp pipeline and composited with a print exactly as
 * renderDesign.renderMockup does. This is the only place a real garment can be
 * seen under the REAL stage — /dev/inflate.html lights its shells with three
 * bare directional lamps and ACES, so it exaggerates every normal and shows
 * nothing about sheen or the environment bake. Judge shading here, geometry
 * there. `cpk=0` drops the print, which is what isolates "the photo shaded
 * badly" from "the customer's artwork got treated as cloth".
 */
import '@/styles.css'
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Garment3D, { isWebGLAvailable } from '@/three'
import { removeBackground } from '@/lib/bgremove'
import type { CardSource, DecalSource, GarmentId, Side, ViewSnap } from '@/lib/types'

const PPI = 40 // texture pixels per inch

const GARMENT_WIDTH_IN: Record<GarmentId, number> = { tee: 21.5, hoodie: 23, custom: 20 }
const PRINT_SIZES: Record<'tee' | 'hoodie', Record<Side, { wIn: number; hIn: number }>> = {
  tee: { front: { wIn: 12, hIn: 16 }, back: { wIn: 12, hIn: 16 }, sleeve: { wIn: 4, hIn: 4 } },
  hoodie: { front: { wIn: 12, hIn: 12 }, back: { wIn: 12, hIn: 14 }, sleeve: { wIn: 4, hIn: 4 } },
}
const COLORS = ['#FFFFFF', '#191C20', '#C0272D', '#1F2A44']

// ---------------------------------------------------------------------------
// Generated test textures
// ---------------------------------------------------------------------------

function outlinedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  fill = '#FFFFFF',
  stroke = 'rgba(0,0,0,0.85)',
  strokeWidth = 5,
) {
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = strokeWidth
  ctx.strokeStyle = stroke
  ctx.strokeText(text, x, y)
  ctx.fillStyle = fill
  ctx.fillText(text, x, y)
}

/** Labeled calibration grid: 1-inch cells, bold border, TSHOP wordmark. */
function drawGridDecal(canvas: HTMLCanvasElement, wIn: number, hIn: number, accent: string, label: string) {
  canvas.width = wIn * PPI
  canvas.height = hIn * PPI
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)

  // 1-inch grid
  ctx.lineWidth = 2
  ctx.strokeStyle = accent + 'AA'
  for (let i = 0; i <= wIn; i++) {
    ctx.beginPath()
    ctx.moveTo(i * PPI, 0)
    ctx.lineTo(i * PPI, h)
    ctx.stroke()
  }
  for (let j = 0; j <= hIn; j++) {
    ctx.beginPath()
    ctx.moveTo(0, j * PPI)
    ctx.lineTo(w, j * PPI)
    ctx.stroke()
  }
  // heavy border
  ctx.lineWidth = 10
  ctx.strokeStyle = accent
  ctx.strokeRect(5, 5, w - 10, h - 10)

  // column letters / row numbers (every cell)
  for (let i = 0; i < wIn; i++)
    outlinedText(ctx, String.fromCharCode(65 + i), (i + 0.5) * PPI, 0.5 * PPI, '700 18px "Inter"', '#FFFFFF', 'rgba(0,0,0,0.8)', 4)
  for (let j = 1; j < hIn; j++)
    outlinedText(ctx, String(j + 1), 0.5 * PPI, (j + 0.5) * PPI, '700 18px "Inter"', '#FFFFFF', 'rgba(0,0,0,0.8)', 4)

  // top marker (flip check)
  outlinedText(ctx, '▲ TOP', w / 2, 0.55 * PPI, '700 26px "Inter"')

  // 4-inch circle (squareness check), centered, below the wordmark
  ctx.lineWidth = 5
  ctx.strokeStyle = '#FFC940'
  ctx.beginPath()
  ctx.arc(w / 2, h * 0.68, 2 * PPI, 0, Math.PI * 2)
  ctx.stroke()
  outlinedText(ctx, '⌀ 4″', w / 2, h * 0.68, '700 24px "JetBrains Mono"')

  // wordmark + size
  outlinedText(ctx, 'TSHOP', w / 2, h * 0.33, `800 ${1.9 * PPI}px "Space Grotesk"`, '#FFFFFF', 'rgba(0,0,0,0.85)', 8)
  outlinedText(ctx, `${label} ${wIn}″ × ${hIn}″`, w / 2, h * 0.45, '700 30px "JetBrains Mono"', accent, 'rgba(0,0,0,0.85)', 5)
}

/** Random accent splat — proves texture.version updates propagate. */
function splat(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const x = (0.2 + Math.random() * 0.6) * canvas.width
  const y = (0.52 + Math.random() * 0.4) * canvas.height
  ctx.fillStyle = ['#FF3D8F', '#35C7FF', '#FFC940', '#3ADC97'][Math.floor(Math.random() * 4)] ?? '#FF3D8F'
  ctx.beginPath()
  ctx.arc(x, y, 18, 0, Math.PI * 2)
  ctx.fill()
}

/** Fake laid-flat hoodie photo (alpha silhouette) + printed design. */
function drawBlobCard(canvas: HTMLCanvasElement, wIn: number, hIn: number, withDesign: boolean) {
  canvas.width = wIn * PPI
  canvas.height = hIn * PPI
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)

  const grad = ctx.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0, '#79828E')
  grad.addColorStop(1, '#5C646E')
  ctx.fillStyle = grad

  // sleeves (drawn first, slightly darker)
  const sleeve = (sign: 1 | -1) => {
    ctx.save()
    ctx.translate(w / 2 + sign * w * 0.31, h * 0.24)
    ctx.rotate(sign * 0.42)
    ctx.beginPath()
    ctx.roundRect(-w * 0.085, 0, w * 0.17, h * 0.52, 30)
    ctx.fill()
    ctx.restore()
  }
  ctx.fillStyle = '#565E68'
  sleeve(1)
  sleeve(-1)

  // body
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.roundRect(w * 0.2, h * 0.13, w * 0.6, h * 0.75, 36)
  ctx.fill()
  // shoulders
  ctx.beginPath()
  ctx.ellipse(w / 2, h * 0.17, w * 0.3, h * 0.09, 0, 0, Math.PI * 2)
  ctx.fill()
  // hood
  ctx.fillStyle = '#2E343C'
  ctx.beginPath()
  ctx.ellipse(w / 2, h * 0.12, w * 0.17, h * 0.075, 0, 0, Math.PI * 2)
  ctx.fill()
  // kangaroo pocket hint
  ctx.strokeStyle = 'rgba(0,0,0,0.28)'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.roundRect(w * 0.33, h * 0.6, w * 0.34, h * 0.2, 22)
  ctx.stroke()

  if (withDesign) {
    // star badge + wordmark, like a printed design
    ctx.save()
    ctx.translate(w / 2, h * 0.38)
    ctx.fillStyle = '#FFC940'
    ctx.beginPath()
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? w * 0.11 : w * 0.045
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    }
    ctx.closePath()
    ctx.fill()
    ctx.restore()
    outlinedText(ctx, 'CUSTOM', w / 2, h * 0.53, `800 ${1.4 * PPI}px "Space Grotesk"`, '#FFFFFF', 'rgba(0,0,0,0.6)', 6)
    outlinedText(ctx, 'SHIP-IN GARMENT', w / 2, h * 0.585, '700 22px "JetBrains Mono"', '#35C7FF', 'rgba(0,0,0,0.6)', 4)
  } else {
    outlinedText(ctx, 'BACK', w / 2, h * 0.5, `800 ${PPI}px "Space Grotesk"`, 'rgba(255,255,255,0.25)', 'rgba(0,0,0,0.3)', 4)
  }
}

// ---------------------------------------------------------------------------
// Harness app
// ---------------------------------------------------------------------------

const qp = new URLSearchParams(location.search)
const qpGarment = (['tee', 'hoodie', 'custom'] as const).find((g) => g === qp.get('g')) ?? 'tee'
const qpColor = /^[0-9a-fA-F]{6}$/.test(qp.get('c') ?? '') ? `#${qp.get('c')!.toUpperCase()}` : '#FFFFFF'
const qpView = (['front', 'back', 'threequarter'] as const).find((v) => v === qp.get('v')) ?? null
const flag = (k: string, dflt: boolean) => (qp.has(k) ? qp.get(k) === '1' : dflt)
/** Supplier photo id (public/catalog/imbretex/img/<id>-{front,back}.jpg). */
const qpPhoto = /^[0-9]{3,8}$/.test(qp.get('cp') ?? '') ? qp.get('cp')! : null
const qpPhotoWidthIn = Number(qp.get('cw')) > 0 ? Number(qp.get('cw')) : 22

/** Longest edge the app itself keeps for a custom-garment photo. */
const PHOTO_EDGE = 1100

/**
 * A print, drawn where a customer's would land. High contrast on purpose: a
 * pale logo cannot show whether the artwork is leaking into the cloth's own
 * relief, and that leak is exactly what this harness is for.
 */
function drawHarnessPrint(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const cx = w / 2
  const cy = h * 0.4
  const r = w * 0.17
  ctx.save()
  ctx.fillStyle = '#E8C24A'
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rad = i % 2 === 0 ? r : r * 0.42
    ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad)
  }
  ctx.closePath()
  ctx.fill()
  outlinedText(ctx, 'TSHOP', cx, cy + r * 1.35, `700 ${Math.round(w * 0.1)}px system-ui`, '#F4F6F9', 'rgba(0,0,0,0.5)', 4)
  ctx.restore()
}

/**
 * Supplier flat-lay → the canvas `CustomGarment` receives: cut out with the
 * app's own background removal, downscaled to the app's own working edge, and
 * composited with the print. Draws into `into` so the harness's canvas identity
 * (and therefore the shell's memo key) is stable. Returns the aspect ratio.
 */
async function loadSupplierCard(
  into: HTMLCanvasElement,
  bare: HTMLCanvasElement,
  id: string,
  side: 'front' | 'back',
  withPrint: boolean,
): Promise<number> {
  const res = await fetch(`/catalog/imbretex/img/${id}-${side}.jpg`)
  if (!res.ok) throw new Error(`photo ${id}-${side}: HTTP ${res.status}`)
  const bmp = await createImageBitmap(await removeBackground(await res.blob()))
  const scale = Math.min(1, PHOTO_EDGE / Math.max(bmp.width, bmp.height))
  for (const c of [into, bare]) {
    c.width = Math.max(2, Math.round(bmp.width * scale))
    c.height = Math.max(2, Math.round(bmp.height * scale))
    const cx = c.getContext('2d')!
    cx.clearRect(0, 0, c.width, c.height)
    cx.drawImage(bmp, 0, 0, c.width, c.height)
  }
  bmp.close()
  // The print goes on the composite ONLY: `bare` is CardSource.photo, the
  // garment the shell measures its light and folds from. Drawing it into both
  // is exactly the bug this harness is here to catch.
  if (withPrint) drawHarnessPrint(into.getContext('2d')!, into.width, into.height)
  return into.height / into.width
}

function Swatch({ hex, active, onClick }: { hex: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={hex}
      onClick={onClick}
      className="h-8 w-8 rounded-full border transition-transform"
      style={{
        background: hex,
        borderColor: active ? 'var(--color-cy)' : 'var(--color-line2)',
        boxShadow: active ? '0 0 0 2px var(--color-cy)' : 'none',
        transform: active ? 'scale(1.08)' : 'none',
      }}
    />
  )
}

function GroupTitle({ children }: { children: string }) {
  return <div className="panel-title">{children}</div>
}

function Harness() {
  const [garment, setGarment] = useState<GarmentId>(qpGarment)
  const [colorHex, setColorHex] = useState(qpColor)
  const [autoRotate, setAutoRotate] = useState(flag('rot', false))
  const [showFront, setShowFront] = useState(flag('fd', true))
  const [showBack, setShowBack] = useState(flag('bd', true))
  const [withBackCard, setWithBackCard] = useState(flag('bc', true))
  // The sleeve decal was never mountable here, which is why no screenshot ever
  // showed its projector box clipping the print. Default OFF so every existing
  // proof sheet is unchanged.
  const [showSleeve, setShowSleeve] = useState(flag('sd', false))
  const [viewRequest, setViewRequest] = useState<{ view: ViewSnap; nonce: number } | null>(
    qpView ? { view: qpView, nonce: 1 } : null,
  )
  const [ready, setReady] = useState(false)
  const bootedAt = useRef(performance.now())
  const [readyMs, setReadyMs] = useState<number | null>(null)

  // --- generated sources -------------------------------------------------
  const [fontsTick, setFontsTick] = useState(0)
  useEffect(() => {
    let alive = true
    void document.fonts.ready.then(() => {
      if (alive) setFontsTick(1)
    })
    return () => {
      alive = false
    }
  }, [])

  const canvases = useMemo(() => {
    const make = () => document.createElement('canvas')
    return {
      tee: { front: make(), back: make(), sleeve: make() },
      hoodie: { front: make(), back: make(), sleeve: make() },
      card: { front: make(), back: make() },
      // The bare garment behind each card (CardSource.photo). Only a supplier
      // photo fills these; the blob card has no artwork to separate out.
      bare: { front: make(), back: make() },
    }
  }, [])

  const [decalVersion, setDecalVersion] = useState(0)
  // Card geometry: the blob card is a fixed 20×22 in; a supplier photo carries
  // its own aspect, so the height is measured rather than assumed.
  const [card, setCard] = useState({ wIn: GARMENT_WIDTH_IN.custom, hIn: 22, hasBack: true, real: false })
  useEffect(() => {
    for (const g of ['tee', 'hoodie'] as const) {
      drawGridDecal(canvases[g].front, PRINT_SIZES[g].front.wIn, PRINT_SIZES[g].front.hIn, '#FF3D8F', 'FRONT')
      drawGridDecal(canvases[g].back, PRINT_SIZES[g].back.wIn, PRINT_SIZES[g].back.hIn, '#35C7FF', 'BACK')
      drawGridDecal(canvases[g].sleeve, PRINT_SIZES[g].sleeve.wIn, PRINT_SIZES[g].sleeve.hIn, '#3ADC97', 'SLV')
    }
    drawBlobCard(canvases.card.front, GARMENT_WIDTH_IN.custom, 22, true)
    drawBlobCard(canvases.card.back, GARMENT_WIDTH_IN.custom, 22, false)
    setDecalVersion((v) => v + 1)
  }, [canvases, fontsTick])

  // …then, when asked for one, overwrite the card with a real supplier photo.
  // Runs after the synthetic draw above so a fetch failure degrades to the blob
  // card rather than to an empty canvas.
  useEffect(() => {
    if (!qpPhoto) return
    let alive = true
    void (async () => {
      const withPrint = flag('cpk', true)
      const aspect = await loadSupplierCard(canvases.card.front, canvases.bare.front, qpPhoto, 'front', withPrint)
      let hasBack = true
      try {
        await loadSupplierCard(canvases.card.back, canvases.bare.back, qpPhoto, 'back', withPrint)
      } catch {
        hasBack = false // plenty of supplier styles ship a front shot only
      }
      if (!alive) return
      setCard({ wIn: qpPhotoWidthIn, hIn: qpPhotoWidthIn * aspect, hasBack, real: true })
      setDecalVersion((v) => v + 1)
      // The cutout runs u2netp on the CPU: 20-60 s under swiftshader, far past
      // any fixed wait a screenshot script could pick. Signal instead.
      ;(window as unknown as { __cp?: string }).__cp = 'ready'
    })().catch((e) => {
      console.error('[cp]', e)
      ;(window as unknown as { __cp?: string }).__cp = `error: ${String(e)}`
    })
    return () => {
      alive = false
    }
  }, [canvases])

  const catalog = garment === 'custom' ? 'tee' : garment
  const front = useMemo<DecalSource | null>(
    () =>
      showFront
        ? { canvas: canvases[catalog].front, version: decalVersion, ...PRINT_SIZES[catalog].front }
        : null,
    [showFront, canvases, catalog, decalVersion],
  )
  const back = useMemo<DecalSource | null>(
    () =>
      showBack
        ? { canvas: canvases[catalog].back, version: decalVersion, ...PRINT_SIZES[catalog].back }
        : null,
    [showBack, canvases, catalog, decalVersion],
  )
  const sleeve = useMemo<DecalSource | null>(
    () =>
      showSleeve
        ? { canvas: canvases[catalog].sleeve, version: decalVersion, ...PRINT_SIZES[catalog].sleeve }
        : null,
    [showSleeve, canvases, catalog, decalVersion],
  )
  const customFront = useMemo<CardSource>(
    () => ({
      canvas: canvases.card.front,
      photo: card.real ? canvases.bare.front : undefined,
      version: decalVersion,
      wIn: card.wIn,
      hIn: card.hIn,
    }),
    [canvases, decalVersion, card],
  )
  const customBack = useMemo<CardSource | null>(
    () =>
      withBackCard && card.hasBack
        ? {
            canvas: canvases.card.back,
            photo: card.real ? canvases.bare.back : undefined,
            version: decalVersion,
            wIn: card.wIn,
            hIn: card.hIn,
          }
        : null,
    [withBackCard, canvases, decalVersion, card],
  )

  const snap = (view: ViewSnap) => setViewRequest((r) => ({ view, nonce: (r?.nonce ?? 0) + 1 }))
  const onReady = useCallback(() => {
    setReady(true)
    setReadyMs(Math.round(performance.now() - bootedAt.current))
  }, [])

  // RE-ISSUE `?v=`. CameraRig deliberately seeds its "already handled" nonce
  // with whatever it is mounted with, so a stale request cannot snap the camera
  // uninvited when the user re-enters 3D — which also means the request this
  // harness mounts WITH is swallowed, and every scripted screenshot came out at
  // the default camera whatever `?v=` said. Bumping the nonce after mount is
  // what makes the parameter mean anything; re-running once the garment exists
  // (`ready`, and again when a supplier cutout lands) also covers the case where
  // the fit pass re-frames the camera after the snap.
  useEffect(() => {
    if (qpView) setViewRequest((r) => ({ view: qpView, nonce: (r?.nonce ?? 0) + 1 }))
  }, [ready, card])

  return (
    <div className="flex h-full">
      <aside className="flex w-[268px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-line bg-bg1 p-4">
        <div>
          <div className="font-display text-[15px] font-bold tracking-wide">
            A3 · <span className="text-grad-ink">3D PREVIEW</span>
          </div>
          <div className="mono-dim mt-1">harness · webgl {isWebGLAvailable() ? 'ok' : 'MISSING'}</div>
        </div>

        <div className="flex flex-col gap-2">
          <GroupTitle>Garment</GroupTitle>
          <div className="flex gap-1.5">
            {(['tee', 'hoodie', 'custom'] as const).map((g) => (
              <button
                key={g}
                type="button"
                className="btn flex-1"
                style={g === garment ? { borderColor: 'var(--color-cy)', color: 'var(--color-cy)' } : undefined}
                onClick={() => setGarment(g)}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <GroupTitle>Color</GroupTitle>
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <Swatch key={c} hex={c} active={c === colorHex} onClick={() => setColorHex(c)} />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <GroupTitle>View</GroupTitle>
          <div className="flex gap-1.5">
            {(
              [
                ['front', 'Front'],
                ['threequarter', '¾'],
                ['back', 'Back'],
              ] as const
            ).map(([v, label]) => (
              <button key={v} type="button" className="btn flex-1" onClick={() => snap(v)}>
                {label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[13px] text-tx2">
            <input type="checkbox" checked={autoRotate} onChange={(e) => setAutoRotate(e.target.checked)} />
            auto-rotate (turntable)
          </label>
        </div>

        <div className="flex flex-col gap-2">
          <GroupTitle>Decals</GroupTitle>
          <label className="flex items-center gap-2 text-[13px] text-tx2">
            <input type="checkbox" checked={showFront} onChange={(e) => setShowFront(e.target.checked)} />
            front decal
          </label>
          <label className="flex items-center gap-2 text-[13px] text-tx2">
            <input type="checkbox" checked={showBack} onChange={(e) => setShowBack(e.target.checked)} />
            sleeve decal
          </label>
          <label className="flex items-center gap-2 text-[12px]">
            <input type="checkbox" checked={showSleeve} onChange={(e) => setShowSleeve(e.target.checked)} />
            back decal
          </label>
          <label className="flex items-center gap-2 text-[13px] text-tx2">
            <input type="checkbox" checked={withBackCard} onChange={(e) => setWithBackCard(e.target.checked)} />
            custom: back photo
          </label>
          <button
            type="button"
            className="btn"
            onClick={() => {
              splat(canvases[catalog].front)
              splat(canvases.card.front)
              setDecalVersion((v) => v + 1)
            }}
          >
            splat + bump version
          </button>
        </div>

        <div className="mt-auto flex flex-col gap-1.5 border-t border-line pt-3">
          <div className="mono-dim">garment width {GARMENT_WIDTH_IN[garment].toFixed(1)}″</div>
          <div className="mono-dim">
            ready {ready ? `✓ ${readyMs}ms` : '…'} · v{decalVersion}
          </div>
        </div>
      </aside>

      <main className="relative flex-1 canvas-surface">
        <div className="absolute inset-0">
          <Garment3D
            garment={garment}
            colorHex={colorHex}
            front={garment === 'custom' ? null : front}
            back={garment === 'custom' ? null : back}
            sleeve={garment === 'custom' || !showSleeve ? null : sleeve}
            garmentWidthIn={GARMENT_WIDTH_IN[garment]}
            custom={garment === 'custom' ? { front: customFront, back: customBack } : undefined}
            autoRotate={autoRotate}
            viewRequest={viewRequest}
            onReady={onReady}
          />
        </div>
        <div className="pointer-events-none absolute left-3 top-3 flex gap-2">
          <span className="chip">{garment}</span>
          <span className="chip" style={{ color: ready ? 'var(--color-ok)' : undefined }}>
            {ready ? 'ready' : 'loading…'}
          </span>
        </div>
      </main>
    </div>
  )
}

const rootEl = document.getElementById('root')
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  )
}
