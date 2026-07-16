/**
 * Imperative Konva editor engine. React owns state; the engine renders it,
 * handles pointer interaction (select / drag / transform / zoom / pan /
 * smart-guide snapping) and reports mutations back as inch-space patches.
 *
 * Layer content is drawn through the SAME draw functions used by print
 * export and 3D textures (src/lib/renderDesign.ts), so what you edit is
 * exactly what prints.
 */
import Konva from 'konva'
import type { Design, Layer, RectPx, Side } from '@/lib/types'
import { GARMENTS } from '@/garments'
import {
  drawLayerContent,
  garmentColorHex,
  measureLayer,
  prepareSide,
  sideLayers,
} from '@/lib/renderDesign'
import { ensureRaster, sizeBucket, withSvgSize } from '@/lib/rasterCache'
import { getCustomSideInfo } from '@/lib/custom'
import { computeSnap } from '@/lib/smartGuides'
import { zonesFor } from '@/content/zones'
import { fmtIn } from '@/lib/units'
import { t } from '@/i18n'

export interface SelectionInfo {
  /** Screen-space bounding box of the selected node. */
  rect: { x: number; y: number; w: number; h: number }
  wIn: number
  hIn: number
  rotation: number
  /** True when part of the layer is outside the print area (will be cropped). */
  cropped: boolean
}

export interface EngineCallbacks {
  onSelect(id: string | null): void
  onPatch(id: string, patch: Partial<Layer>, opts: { transient: boolean }): void
  onEditText(id: string): void
  onZoom(pct: number): void
  onSelection(info: SelectionInfo | null): void
  /** A layer drag started / ended (mobile hides the props sheet meanwhile). */
  onDragStart?(): void
  onDragEnd?(): void
}

export interface SyncState {
  design: Design
  side: Side
  selectedId: string | null
  /** Draw print-placement guides (zones + 1-inch grid) + snap to them. */
  showGuides: boolean
}

interface LayoutInfo {
  ppi: number
  area: RectPx
}

const VIEW = 800
const PAD = 46

export class EditorEngine {
  private stage: Konva.Stage
  private world: Konva.Group
  private worldLayer: Konva.Layer
  private uiLayer: Konva.Layer
  private garmentNode: Konva.Image
  private gridGroup: Konva.Group
  private designGroup: Konva.Group
  private areaGroup: Konva.Group
  private zoneGroup: Konva.Group
  private guideGroup: Konva.Group
  private ghost: Konva.Shape
  private transformer: Konva.Transformer
  private nodes = new Map<string, Konva.Shape | Konva.Image>()

  private cb: EngineCallbacks
  private layout: LayoutInfo = { ppi: 25, area: { x: 250, y: 163, w: 300, h: 400 } }
  private state: SyncState | null = null
  private syncSeq = 0
  private fitScale = 1
  private showGuides = false
  private panMode = false
  private panning = false
  private panStart = { x: 0, y: 0, wx: 0, wy: 0 }
  private lastPinch: { dist: number; cx: number; cy: number } | null = null
  private draggingNode: Konva.Shape | null = null
  private lastTransient = 0
  private destroyed = false

  constructor(container: HTMLDivElement, cb: EngineCallbacks) {
    this.cb = cb
    this.stage = new Konva.Stage({
      container,
      width: Math.max(80, container.clientWidth),
      height: Math.max(80, container.clientHeight),
    })
    // Own all touch gestures (pinch-zoom / two-finger pan / layer drag) instead
    // of letting the browser scroll or zoom the page.
    container.style.touchAction = 'none'

    this.worldLayer = new Konva.Layer()
    this.world = new Konva.Group()
    this.worldLayer.add(this.world)

    this.garmentNode = new Konva.Image({
      image: undefined,
      width: VIEW,
      height: VIEW,
      listening: true,
      name: 'garment',
      shadowColor: '#000000',
      shadowBlur: 30,
      shadowOffset: { x: 0, y: 14 },
      shadowOpacity: 0.38,
    })
    this.world.add(this.garmentNode)

    // Placement grid sits BELOW the artwork so the design stays legible.
    this.gridGroup = new Konva.Group({ listening: false })
    this.world.add(this.gridGroup)

    this.designGroup = new Konva.Group()
    this.world.add(this.designGroup)

    this.areaGroup = new Konva.Group({ listening: false })
    this.world.add(this.areaGroup)

    // Zone outlines + labels sit ABOVE the artwork so they stay visible.
    this.zoneGroup = new Konva.Group({ listening: false })
    this.world.add(this.zoneGroup)

    this.guideGroup = new Konva.Group({ listening: false })
    this.world.add(this.guideGroup)

    this.ghost = new Konva.Shape({
      listening: false,
      opacity: 0.3,
      visible: false,
      sceneFunc: (ctx, shape) => {
        const layer = shape.getAttr('layerRef') as Layer | undefined
        if (!layer) return
        const c = (ctx as unknown as { _context: CanvasRenderingContext2D })._context
        c.save()
        c.translate(shape.width() / 2, shape.height() / 2)
        try {
          drawLayerContent(c, layer, this.layout.ppi)
        } finally {
          c.restore()
        }
      },
    })
    this.world.add(this.ghost)

    // Bigger transform handles on touch devices so they're grabbable.
    const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
    this.uiLayer = new Konva.Layer()
    this.transformer = new Konva.Transformer({
      rotateEnabled: true,
      rotationSnaps: [0, 45, 90, 135, 180, 225, 270, 315],
      rotationSnapTolerance: 6,
      anchorStroke: '#35C7FF',
      anchorFill: '#0C0F13',
      anchorCornerRadius: 2,
      anchorSize: coarse ? 16 : 9,
      borderStroke: '#35C7FF',
      rotateAnchorOffset: coarse ? 34 : 28,
      keepRatio: true,
      flipEnabled: false,
      boundBoxFunc: (oldBox, newBox) =>
        Math.abs(newBox.width) < 8 || Math.abs(newBox.height) < 8 ? oldBox : newBox,
    })
    this.uiLayer.add(this.transformer)

    this.stage.add(this.worldLayer)
    this.stage.add(this.uiLayer)

    this.bindStageEvents()
    this.zoomFit()
  }

  // ------------------------------------------------------------------ view

  setViewport(w: number, h: number): void {
    if (this.destroyed || w < 10 || h < 10) return
    const keepFit = Math.abs(this.world.scaleX() - this.fitScale) < 1e-6
    this.stage.size({ width: w, height: h })
    this.computeFit()
    if (keepFit) this.applyZoom(this.fitScale)
    else this.applyZoom(this.world.scaleX())
  }

  private computeFit(): void {
    const w = this.stage.width()
    const h = this.stage.height()
    this.fitScale = Math.min((w - PAD * 2) / VIEW, (h - PAD * 2) / VIEW)
    this.fitScale = Math.max(0.05, this.fitScale)
  }

  private applyZoom(scale: number, focal?: { x: number; y: number }): void {
    const min = this.fitScale * 0.4
    const max = this.fitScale * 9
    const next = Math.min(max, Math.max(min, scale))
    const prev = this.world.scaleX()

    if (focal) {
      const wx = (focal.x - this.world.x()) / prev
      const wy = (focal.y - this.world.y()) / prev
      this.world.scale({ x: next, y: next })
      this.world.position({ x: focal.x - wx * next, y: focal.y - wy * next })
    } else {
      this.world.scale({ x: next, y: next })
      this.world.position({
        x: (this.stage.width() - VIEW * next) / 2,
        y: (this.stage.height() - VIEW * next) / 2,
      })
    }
    this.cb.onZoom(Math.round((next / this.fitScale) * 100))
    this.emitSelection()
  }

  zoomFit(): void {
    this.computeFit()
    this.applyZoom(this.fitScale)
  }

  zoomBy(factor: number): void {
    this.applyZoom(this.world.scaleX() * factor, {
      x: this.stage.width() / 2,
      y: this.stage.height() / 2,
    })
  }

  setPanMode(on: boolean): void {
    this.panMode = on
    // In pan mode the design layers must not swallow pointer events —
    // otherwise dragging over a layer moves the layer instead of the canvas.
    this.designGroup.listening(!on)
    this.stage.container().style.cursor = on ? 'grab' : 'default'
    if (!on) this.panning = false
  }

  // ---------------------------------------------------------------- events

  private bindStageEvents(): void {
    this.stage.on('wheel', (e) => {
      e.evt.preventDefault()
      const pointer = this.stage.getPointerPosition()
      if (!pointer) return
      const factor = Math.pow(1.0016, -e.evt.deltaY)
      this.applyZoom(this.world.scaleX() * factor, pointer)
    })

    this.stage.on('mousedown touchstart', (e) => {
      const evt = e.evt as MouseEvent
      const middle = 'button' in evt && evt.button === 1
      if (this.panMode || middle) {
        evt.preventDefault()
        this.panning = true
        const p = this.stage.getPointerPosition()!
        this.panStart = { x: p.x, y: p.y, wx: this.world.x(), wy: this.world.y() }
        this.stage.container().style.cursor = 'grabbing'
        return
      }
      if (e.target === this.stage || e.target === this.garmentNode) {
        this.cb.onSelect(null)
      }
    })

    this.stage.on('mousemove touchmove', () => {
      if (!this.panning) return
      const p = this.stage.getPointerPosition()
      if (!p) return
      this.world.position({
        x: this.panStart.wx + (p.x - this.panStart.x),
        y: this.panStart.wy + (p.y - this.panStart.y),
      })
      this.emitSelection()
    })

    const endPan = () => {
      if (!this.panning) return
      this.panning = false
      this.stage.container().style.cursor = this.panMode ? 'grab' : 'default'
    }
    this.stage.on('mouseup touchend', endPan)
    this.stage.on('mouseleave', endPan)

    // Two-finger pinch-zoom + pan (mobile). Runs alongside the single-finger
    // handlers above (they no-op unless a pan is active).
    this.stage.on('touchmove', (e) => {
      const te = e.evt as TouchEvent
      if (te.touches.length < 2) return
      te.preventDefault()
      // A second finger cancels any in-flight single-finger layer drag or pan.
      if (this.draggingNode) {
        this.draggingNode.stopDrag()
        this.draggingNode = null
      }
      this.panning = false
      const rect = this.stage.container().getBoundingClientRect()
      const t0 = te.touches[0]
      const t1 = te.touches[1]
      const p0x = t0.clientX - rect.left
      const p0y = t0.clientY - rect.top
      const p1x = t1.clientX - rect.left
      const p1y = t1.clientY - rect.top
      const dist = Math.hypot(p1x - p0x, p1y - p0y)
      const cx = (p0x + p1x) / 2
      const cy = (p0y + p1y) / 2
      if (this.lastPinch && this.lastPinch.dist > 0) {
        this.applyZoom(this.world.scaleX() * (dist / this.lastPinch.dist), { x: cx, y: cy })
        this.world.position({
          x: this.world.x() + (cx - this.lastPinch.cx),
          y: this.world.y() + (cy - this.lastPinch.cy),
        })
        this.emitSelection()
      }
      this.lastPinch = { dist, cx, cy }
    })
    this.stage.on('touchend touchcancel', (e) => {
      if ((e.evt as TouchEvent).touches.length < 2) this.lastPinch = null
    })
  }

  // ---------------------------------------------------------------- layout

  private async computeLayout(design: Design, side: Side): Promise<LayoutInfo> {
    if (design.garmentId !== 'custom') {
      const art = GARMENTS[design.garmentId]
      return { ppi: art.pxPerInch, area: art.sides[side].printAreaPx }
    }
    const setup = side === 'sleeve' ? undefined : design.custom?.[side]
    const widthIn = design.custom?.widthIn ?? 20
    if (!setup) {
      return { ppi: 25, area: { x: 250, y: 200, w: 300, h: 400 } }
    }
    // A missing/corrupt photo must degrade to the default area, not wedge
    // the whole sync.
    const info = await getCustomSideInfo(setup, widthIn).catch(() => null)
    if (!info) return { ppi: 25, area: { x: 250, y: 200, w: 300, h: 400 } }
    const gHIn = info.bbox.h / info.pxPerInch
    const ppi = Math.min((VIEW - 120) / widthIn, (VIEW - 90) / gHIn)
    const a = setup.printArea
    const gx = (VIEW - widthIn * ppi) / 2
    const gy = (VIEW - gHIn * ppi) / 2
    return {
      ppi,
      area: { x: gx + a.xIn * ppi, y: gy + a.yIn * ppi, w: a.wIn * ppi, h: a.hIn * ppi },
    }
  }

  private async updateGarmentVisual(design: Design, side: Side, seq: number): Promise<void> {
    if (design.garmentId !== 'custom') {
      const art = GARMENTS[design.garmentId]
      const hex = garmentColorHex(design)
      const px = sizeBucket(VIEW * 2)
      const img = await ensureRaster(
        `garment:${design.garmentId}:${side}:${hex}:${px}`,
        withSvgSize(art.sides[side].body.replaceAll('__COLOR__', hex), px, px),
      )
      if (seq !== this.syncSeq || this.destroyed) return
      this.garmentNode.setAttrs({
        image: img,
        x: 0,
        y: 0,
        width: VIEW,
        height: VIEW,
        crop: undefined,
        visible: true,
      })
      return
    }
    const setup = side === 'sleeve' ? undefined : design.custom?.[side]
    const widthIn = design.custom?.widthIn ?? 20
    if (!setup) {
      this.garmentNode.visible(false)
      return
    }
    const info = await getCustomSideInfo(setup, widthIn)
    if (seq !== this.syncSeq || this.destroyed) return
    const gHIn = info.bbox.h / info.pxPerInch
    const ppi = this.layout.ppi
    const w = widthIn * ppi
    const h = gHIn * ppi
    this.garmentNode.setAttrs({
      image: info.img,
      crop: { x: info.bbox.x, y: info.bbox.y, width: info.bbox.w, height: info.bbox.h },
      x: (VIEW - w) / 2,
      y: (VIEW - h) / 2,
      width: w,
      height: h,
      visible: true,
    })
  }

  private updateAreaOutline(): void {
    this.areaGroup.destroyChildren()
    const { area, ppi } = this.layout
    this.areaGroup.add(
      new Konva.Rect({
        x: area.x,
        y: area.y,
        width: area.w,
        height: area.h,
        stroke: 'rgba(154,165,180,0.55)',
        dash: [6, 6],
        strokeWidth: 1.2,
        // screen-constant width; dividing by zoom as well would make the
        // boundary sub-pixel when zoomed in
        strokeScaleEnabled: false,
      }),
    )
    // corner registration ticks
    const tick = 10
    for (const [cx, cy, dx, dy] of [
      [area.x, area.y, 1, 1],
      [area.x + area.w, area.y, -1, 1],
      [area.x, area.y + area.h, 1, -1],
      [area.x + area.w, area.y + area.h, -1, -1],
    ] as const) {
      this.areaGroup.add(
        new Konva.Shape({
          sceneFunc: (ctx, shape) => {
            const c = (ctx as unknown as { _context: CanvasRenderingContext2D })._context
            c.save()
            c.strokeStyle = 'rgba(53,199,255,0.9)'
            c.lineWidth = 1.6 / this.world.scaleX()
            c.beginPath()
            c.moveTo(cx + dx * tick, cy)
            c.lineTo(cx, cy)
            c.lineTo(cx, cy + dy * tick)
            c.stroke()
            c.restore()
            shape.getSelfRect()
          },
          getSelfRect: () => ({ x: cx - tick, y: cy - tick, width: tick * 2, height: tick * 2 }),
        }),
      )
    }
    const wIn = area.w / ppi
    const hIn = area.h / ppi
    this.areaGroup.add(
      new Konva.Text({
        x: area.x,
        y: area.y - 20,
        text: t('editor.print_area_label', { w: fmtIn(wIn), h: fmtIn(hIn) }),
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
        letterSpacing: 0.8,
        fill: 'rgba(154,165,180,0.75)',
      }),
    )
    this.designGroup.clipFunc((ctx) => {
      ctx.rect(area.x, area.y, area.w, area.h)
    })
  }

  // ---------------------------------------------------------- placement guides

  /** Zone rectangles (excluding `full`) in world/viewBox px for the active side. */
  private zoneRectsPx(): {
    id: string
    nameKey: string
    standard?: boolean
    x: number
    y: number
    w: number
    h: number
  }[] {
    if (!this.state) return []
    const { ppi, area } = this.layout
    const cx = area.x + area.w / 2
    const cy = area.y + area.h / 2
    return zonesFor(this.state.design, this.state.side)
      .filter((z) => z.id !== 'full')
      .map((z) => ({
        id: z.id,
        nameKey: z.nameKey,
        standard: z.standard,
        w: z.wIn * ppi,
        h: z.hIn * ppi,
        x: cx + z.cxIn * ppi - (z.wIn * ppi) / 2,
        y: cy + z.cyIn * ppi - (z.hIn * ppi) / 2,
      }))
  }

  /** 1-inch grid + named zone overlays (A4 highlighted as the cheap standard). */
  private drawPlacementGuides(): void {
    this.gridGroup.destroyChildren()
    this.zoneGroup.destroyChildren()
    if (!this.showGuides) return
    const { ppi, area } = this.layout

    const grid = 'rgba(154,165,180,0.16)'
    const cols = Math.round(area.w / ppi)
    const rows = Math.round(area.h / ppi)
    for (let i = 0; i <= cols; i++) {
      const x = area.x + i * ppi
      this.gridGroup.add(
        new Konva.Line({ points: [x, area.y, x, area.y + area.h], stroke: grid, strokeWidth: 1, strokeScaleEnabled: false }),
      )
    }
    for (let j = 0; j <= rows; j++) {
      const y = area.y + j * ppi
      this.gridGroup.add(
        new Konva.Line({ points: [area.x, y, area.x + area.w, y], stroke: grid, strokeWidth: 1, strokeScaleEnabled: false }),
      )
    }

    const SHOWN = new Set(['a4', 'chest', 'upper_back', 'left_chest', 'center_back'])
    for (const z of this.zoneRectsPx()) {
      if (!SHOWN.has(z.id)) continue
      const accent = !!z.standard
      const color = accent ? 'rgba(53,199,255,0.95)' : 'rgba(255,61,143,0.72)'
      this.zoneGroup.add(
        new Konva.Rect({
          x: z.x,
          y: z.y,
          width: z.w,
          height: z.h,
          stroke: color,
          strokeWidth: accent ? 1.7 : 1.1,
          dash: accent ? undefined : [5, 4],
          cornerRadius: 3,
          strokeScaleEnabled: false,
          fill: accent ? 'rgba(53,199,255,0.06)' : undefined,
        }),
      )
      this.zoneGroup.add(
        new Konva.Text({
          x: z.x + 4,
          // A4 label sits inside its top edge; the others sit ABOVE their rect
          // so labels don't pile up near the print-area top.
          y: accent ? z.y + 3 : z.y - 13,
          text: accent ? `★ ${t(z.nameKey)}` : t(z.nameKey),
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 10,
          letterSpacing: 0.4,
          fill: color,
        }),
      )
    }
  }

  // ------------------------------------------------------------- reconcile

  async sync(state: SyncState): Promise<void> {
    const seq = ++this.syncSeq
    this.state = state
    this.showGuides = state.showGuides
    const { design, side } = state

    const layout = await this.computeLayout(design, side)
    await prepareSide(design, side, layout.ppi)
    if (seq !== this.syncSeq || this.destroyed) return

    this.layout = layout
    try {
      await this.updateGarmentVisual(design, side, seq)
    } catch {
      // A garment raster that fails to decode must not blank the editor —
      // keep the previous visual and still render layers + outline.
    }
    if (seq !== this.syncSeq || this.destroyed) return
    this.updateAreaOutline()
    this.drawPlacementGuides()

    const layers = sideLayers(design, side)
    const seen = new Set<string>()

    layers.forEach((layer, i) => {
      seen.add(layer.id)
      let node = this.nodes.get(layer.id)
      if (!node) {
        node = this.createNode(layer)
        this.nodes.set(layer.id, node)
        this.designGroup.add(node)
      }
      try {
        this.applyLayerToNode(node, layer)
      } catch {
        // A bad measure on one layer must never take down the whole canvas.
        ;(node as Konva.Shape).setAttrs({ layerRef: layer, width: 10, height: 10 })
      }
      node.zIndex(i)
    })

    for (const [id, node] of this.nodes) {
      if (!seen.has(id)) {
        node.destroy()
        this.nodes.delete(id)
      }
    }

    // selection
    const selNode = state.selectedId ? this.nodes.get(state.selectedId) : undefined
    if (selNode) {
      this.transformer.nodes([selNode])
      this.configureTransformer(selNode.getAttr('layerRef') as Layer)
    } else {
      this.transformer.nodes([])
    }
    this.emitSelection()
  }

  private configureTransformer(layer: Layer): void {
    if (layer.type === 'text') {
      this.transformer.enabledAnchors([
        'top-left',
        'top-right',
        'bottom-left',
        'bottom-right',
      ])
      this.transformer.keepRatio(true)
    } else {
      this.transformer.enabledAnchors([
        'top-left',
        'top-right',
        'bottom-left',
        'bottom-right',
        'middle-left',
        'middle-right',
        'top-center',
        'bottom-center',
      ])
      this.transformer.keepRatio(true)
    }
  }

  private createNode(layer: Layer): Konva.Shape {
    const node = new Konva.Shape({
      draggable: true,
      name: 'design-layer',
      sceneFunc: (ctx, shape) => {
        const l = shape.getAttr('layerRef') as Layer | undefined
        if (!l) return
        const c = (ctx as unknown as { _context: CanvasRenderingContext2D })._context
        c.save()
        c.translate(shape.width() / 2, shape.height() / 2)
        try {
          drawLayerContent(c, l, this.layout.ppi)
        } finally {
          c.restore()
        }
      },
      hitFunc: (ctx, shape) => {
        ctx.beginPath()
        ctx.rect(0, 0, shape.width(), shape.height())
        ctx.closePath()
        ctx.fillStrokeShape(shape)
      },
    })
    node.setAttr('layerId', layer.id)
    this.bindNodeEvents(node)
    return node
  }

  private applyLayerToNode(node: Konva.Shape, layer: Layer): void {
    const { ppi, area } = this.layout
    const { w, h } = measureLayer(layer, ppi)
    node.setAttrs({
      layerRef: layer,
      width: w,
      height: h,
      offsetX: w / 2,
      offsetY: h / 2,
      x: area.x + area.w / 2 + layer.xIn * ppi,
      y: area.y + area.h / 2 + layer.yIn * ppi,
      rotation: layer.rotation,
      opacity: layer.opacity,
      scaleX: 1,
      scaleY: 1,
    })
  }

  private bindNodeEvents(node: Konva.Shape): void {
    const id = () => node.getAttr('layerId') as string

    node.on('mouseenter', () => {
      if (!this.panMode) this.stage.container().style.cursor = 'move'
    })
    node.on('mouseleave', () => {
      if (!this.panMode) this.stage.container().style.cursor = 'default'
    })

    node.on('mousedown touchstart', () => {
      if (this.panMode) return
      if (this.state?.selectedId !== id()) this.cb.onSelect(id())
    })

    node.on('dblclick dbltap', () => {
      const layer = node.getAttr('layerRef') as Layer
      if (layer.type === 'text') this.cb.onEditText(id())
    })

    node.on('dragstart', () => {
      this.draggingNode = node
      this.cb.onDragStart?.()
    })

    node.on('dragmove', () => {
      this.applyDragSnapping(node)
      this.updateGhost(node)
      this.emitSelection()
      const now = performance.now()
      if (now - this.lastTransient > 66) {
        this.lastTransient = now
        this.cb.onPatch(id(), this.positionPatch(node), { transient: true })
      }
    })

    node.on('dragend', () => {
      this.draggingNode = null
      this.clearGuides()
      this.ghost.visible(false)
      this.cb.onPatch(id(), this.positionPatch(node), { transient: false })
      this.cb.onDragEnd?.()
    })

    node.on('transform', () => {
      this.updateGhost(node)
      this.emitSelection()
    })

    node.on('transformend', () => {
      const layer = node.getAttr('layerRef') as Layer
      const { ppi } = this.layout
      const scaleX = Math.abs(node.scaleX())
      const scaleY = Math.abs(node.scaleY())
      const patch: Partial<Layer> = {
        ...this.positionPatch(node),
        rotation: Math.round(node.rotation() * 10) / 10,
      }
      if (layer.type === 'text') {
        const next = Math.max(0.12, layer.fontSizeIn * scaleY)
        const p = patch as Partial<Layer> & { fontSizeIn: number; strokeWidthIn?: number }
        p.fontSizeIn = Math.round(next * 100) / 100
        // outline thickness scales with the glyphs, or the look pops on release
        if (layer.strokeWidthIn > 0)
          p.strokeWidthIn = Math.round(layer.strokeWidthIn * scaleY * 1000) / 1000
      } else {
        const p = patch as Partial<Layer> & { wIn: number; hIn: number }
        p.wIn = Math.max(0.15, ((node.width() * scaleX) / ppi) * 1)
        p.hIn = Math.max(0.15, ((node.height() * scaleY) / ppi) * 1)
      }
      node.scale({ x: 1, y: 1 })
      this.ghost.visible(false)
      this.cb.onPatch(node.getAttr('layerId') as string, patch, { transient: false })
    })
  }

  private positionPatch(node: Konva.Shape): Partial<Layer> {
    const { ppi, area } = this.layout
    return {
      xIn: Math.round(((node.x() - (area.x + area.w / 2)) / ppi) * 100) / 100,
      yIn: Math.round(((node.y() - (area.y + area.h / 2)) / ppi) * 100) / 100,
    }
  }

  // ------------------------------------------------------------- snapping

  private applyDragSnapping(node: Konva.Shape): void {
    const { area } = this.layout
    const rect = node.getClientRect({ relativeTo: this.world as unknown as Konva.Container })
    const xs: number[] = [area.x + area.w / 2, area.x, area.x + area.w, VIEW / 2]
    const ys: number[] = [area.y + area.h / 2, area.y, area.y + area.h]
    // Snap to zone edges + centres when guides are on.
    if (this.showGuides) {
      for (const z of this.zoneRectsPx()) {
        xs.push(z.x, z.x + z.w / 2, z.x + z.w)
        ys.push(z.y, z.y + z.h / 2, z.y + z.h)
      }
    }
    for (const [otherId, other] of this.nodes) {
      if (otherId === node.getAttr('layerId')) continue
      const r = other.getClientRect({ relativeTo: this.world as unknown as Konva.Container })
      xs.push(r.x + r.width / 2)
      ys.push(r.y + r.height / 2)
    }
    const tolerance = 6 / this.world.scaleX()
    const snap = computeSnap(
      { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      { xs, ys },
      tolerance,
    )
    node.position({ x: node.x() + snap.dx, y: node.y() + snap.dy })
    this.drawGuides(snap.vLines, snap.hLines)
  }

  private drawGuides(vLines: number[], hLines: number[]): void {
    this.clearGuides()
    const strokeW = 1
    for (const x of vLines) {
      this.guideGroup.add(
        new Konva.Line({
          points: [x, 40, x, VIEW - 40],
          stroke: '#FF3D8F',
          strokeWidth: strokeW,
          strokeScaleEnabled: false,
          dash: [4, 4],
        }),
      )
    }
    for (const y of hLines) {
      this.guideGroup.add(
        new Konva.Line({
          points: [40, y, VIEW - 40, y],
          stroke: '#FF3D8F',
          strokeWidth: strokeW,
          strokeScaleEnabled: false,
          dash: [4, 4],
        }),
      )
    }
  }

  private clearGuides(): void {
    this.guideGroup.destroyChildren()
  }

  private updateGhost(node: Konva.Shape): void {
    const cropped = this.isCropped(node)
    if (!cropped) {
      this.ghost.visible(false)
      return
    }
    const layer = node.getAttr('layerRef') as Layer
    this.ghost.setAttrs({
      visible: true,
      layerRef: layer,
      width: node.width(),
      height: node.height(),
      offsetX: node.offsetX(),
      offsetY: node.offsetY(),
      x: node.x(),
      y: node.y(),
      rotation: node.rotation(),
      scaleX: node.scaleX(),
      scaleY: node.scaleY(),
    })
  }

  private isCropped(node: Konva.Shape): boolean {
    const { area } = this.layout
    const r = node.getClientRect({ relativeTo: this.world as unknown as Konva.Container })
    return (
      r.x < area.x - 0.5 ||
      r.y < area.y - 0.5 ||
      r.x + r.width > area.x + area.w + 0.5 ||
      r.y + r.height > area.y + area.h + 0.5
    )
  }

  // ------------------------------------------------------------- selection

  private emitSelection(): void {
    const selId = this.state?.selectedId
    const node = selId ? this.nodes.get(selId) : undefined
    if (!node || !this.state) {
      this.cb.onSelection(null)
      return
    }
    const layer = node.getAttr('layerRef') as Layer
    const { ppi } = this.layout
    const screen = node.getClientRect() // stage coords = screen px
    const scaleX = Math.abs(node.scaleX())
    const scaleY = Math.abs(node.scaleY())
    const wIn =
      layer.type === 'text'
        ? (node.width() * scaleX) / ppi
        : (node.width() * scaleX) / ppi
    const hIn = (node.height() * scaleY) / ppi
    this.cb.onSelection({
      rect: { x: screen.x, y: screen.y, w: screen.width, h: screen.height },
      wIn,
      hIn,
      rotation: node.rotation(),
      cropped: this.isCropped(node),
    })
  }

  destroy(): void {
    this.destroyed = true
    this.stage.destroy()
    this.nodes.clear()
  }
}
