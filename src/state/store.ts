import { create, useStore as useVanillaStore } from 'zustand'
import { temporal } from 'zundo'
import { nanoid } from 'nanoid'
import type {
  AssetMeta,
  CustomGarment,
  Design,
  GarmentId,
  GraphicLayer,
  ImageLayer,
  Layer,
  SavedDesignMeta,
  Side,
  TextLayer,
} from '@/lib/types'
import { GARMENTS } from '@/garments'
import { GARMENT_COLORS } from '@/content/palettes'
import { GRAPHICS } from '@/content/graphics'
import { makeSampleDesign } from '@/content/sampleDesign'
import { getAreaSizeIn, measureLayer } from '@/lib/renderDesign'
import { migrateDesign } from '@/lib/migrate'
import { zonesFor } from '@/content/zones'
import { clamp } from '@/lib/units'
import { setCurrentLang, type Lang } from '@/i18n/lang'
import type { SceneId } from '@/scenes'
import {
  applyLang,
  applyTheme,
  loadPrefs,
  savePrefs,
  type Theme,
} from './prefs'

export type PanelId = 'product' | 'text' | 'uploads' | 'graphics' | 'layers'
export type Mode = '2d' | '3d'

export interface ToastItem {
  id: string
  kind: 'info' | 'ok' | 'warn' | 'error'
  msg: string
}

export interface ModalState {
  customSetup: boolean
  order: boolean
  designs: boolean
  share: boolean
  shortcuts: boolean
  ar: boolean
}

interface StoreState {
  design: Design
  activeSide: Side
  mode: Mode
  selectedId: string | null
  activePanel: PanelId | null
  modals: ModalState
  toasts: ToastItem[]
  assets: AssetMeta[]
  savedDesigns: SavedDesignMeta[]
  hydrated: boolean
  /** 3D camera snap request, consumed by the 3D stage. */
  viewRequest: { view: 'front' | 'back' | 'threequarter'; nonce: number } | null
  autoRotate: boolean

  // --- ui preferences (persisted separately from the design; not undoable)
  theme: Theme
  lang: Lang
  scene: SceneId
  /** Print-placement guides (zones + grid) in the 2D editor. */
  showGuides: boolean
  /** Mobile: is the selection sheet expanded (vs the compact action bar)? */
  propsExpanded: boolean
  /** A canvas layer is being dragged — mobile hides the props sheet meanwhile. */
  dragging: boolean

  // --- ui actions
  setTheme(theme: Theme): void
  setLang(lang: Lang): void
  setScene(scene: SceneId): void
  toggleGuides(): void
  /** Move (and fit) the selected layer into a named print zone. */
  placeInZone(zoneId: string): void
  setMode(mode: Mode): void
  setSide(side: Side): void
  select(id: string | null): void
  setPanel(p: PanelId | null): void
  setPropsExpanded(v: boolean): void
  setDragging(v: boolean): void
  openModal(m: keyof ModalState): void
  closeModal(m: keyof ModalState): void
  toast(kind: ToastItem['kind'], msg: string): void
  dismissToast(id: string): void
  requestView(view: 'front' | 'back' | 'threequarter'): void
  setAutoRotate(v: boolean): void
  setAssets(a: AssetMeta[]): void
  setSavedDesigns(d: SavedDesignMeta[]): void
  markHydrated(): void

  // --- design actions (undoable)
  setGarment(id: GarmentId): void
  setColor(colorId: string): void
  setCustom(custom: CustomGarment | null): void
  addTextLayer(text?: string): void
  addImageLayer(asset: AssetMeta): void
  addGraphicLayer(graphicId: string): void
  patchLayer(id: string, patch: Partial<Layer>, opts?: { transient?: boolean }): void
  removeLayer(id: string): void
  purgeAsset(assetId: string): void
  duplicateLayer(id: string): void
  moveLayer(id: string, dir: 'up' | 'down'): void
  renameDesign(name: string): void
  loadDesign(design: Design): void
  newDesign(): void
}

function touch(design: Design): Design {
  return { ...design, updatedAt: Date.now() }
}

function isDark(hex: string): boolean {
  const n = hex.replace('#', '')
  const r = parseInt(n.slice(0, 2), 16)
  const g = parseInt(n.slice(2, 4), 16)
  const b = parseInt(n.slice(4, 6), 16)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 140
}

/** Keep layer centers inside the print area when the area changes. */
function clampLayersToArea(design: Design): Design {
  const layers = design.layers.map((l) => {
    const area = getAreaSizeIn(design, l.side)
    return {
      ...l,
      xIn: clamp(l.xIn, -area.wIn / 2, area.wIn / 2),
      yIn: clamp(l.yIn, -area.hIn / 2, area.hIn / 2),
    }
  })
  return { ...design, layers }
}

/**
 * Set the active garment, swapping the active/stashed layer buckets when
 * crossing the catalog↔custom boundary. Tee↔hoodie (both catalog) keep sharing
 * one design; custom keeps its own — so editing the default tee never mutates
 * the uploaded custom garment. Callers re-clamp the newly-active layers.
 */
function switchGarment(design: Design, garmentId: GarmentId): Design {
  const wasCustom = design.garmentId === 'custom'
  const willCustom = garmentId === 'custom'
  if (wasCustom === willCustom) return { ...design, garmentId }
  return {
    ...design,
    garmentId,
    layers: design.stashedLayers,
    stashedLayers: design.layers,
  }
}

/** True when moving between the catalog (tee/hoodie) and custom contexts. */
function crossesCustomBoundary(from: GarmentId, to: GarmentId): boolean {
  return (from === 'custom') !== (to === 'custom')
}

let layerCounter = 1

/** Pre-gesture design snapshot (drag / slider scrub); see patchLayer. */
let gestureStart: Design | null = null

// Load persisted UI prefs once and reflect them onto <html> + the i18n runtime
// before the first render (the inline script in index.html already set the
// theme/lang attributes to avoid a flash; this keeps them authoritative).
const initialPrefs = loadPrefs()
setCurrentLang(initialPrefs.lang)
applyTheme(initialPrefs.theme)
applyLang(initialPrefs.lang)

// On phones, start with the full canvas (no panel sheet covering it); on
// desktop keep the Product panel open in the persistent left column.
const bootMobile =
  typeof matchMedia !== 'undefined' && matchMedia('(max-width: 767.98px)').matches

export const useStore = create<StoreState>()(
  temporal(
    (set, get) => ({
      design: makeSampleDesign(),
      activeSide: 'front',
      mode: '2d',
      selectedId: null,
      activePanel: bootMobile ? null : 'product',
      modals: { customSetup: false, order: false, designs: false, share: false, shortcuts: false, ar: false },
      toasts: [],
      assets: [],
      savedDesigns: [],
      hydrated: false,
      viewRequest: null,
      autoRotate: false,
      theme: initialPrefs.theme,
      lang: initialPrefs.lang,
      scene: initialPrefs.scene,
      showGuides: initialPrefs.showGuides,
      propsExpanded: false,
      dragging: false,

      setTheme: (theme) => {
        applyTheme(theme)
        set({ theme })
        savePrefs({ theme, lang: get().lang, scene: get().scene, showGuides: get().showGuides })
      },
      setLang: (lang) => {
        setCurrentLang(lang)
        applyLang(lang)
        set({ lang })
        savePrefs({ theme: get().theme, lang, scene: get().scene, showGuides: get().showGuides })
      },
      setScene: (scene) => {
        set({ scene })
        savePrefs({ theme: get().theme, lang: get().lang, scene, showGuides: get().showGuides })
      },
      toggleGuides: () => {
        const showGuides = !get().showGuides
        set({ showGuides })
        savePrefs({ theme: get().theme, lang: get().lang, scene: get().scene, showGuides })
      },
      placeInZone: (zoneId) => {
        const s = get()
        const layer = s.design.layers.find((l) => l.id === s.selectedId)
        if (!layer) return
        const zone = zonesFor(s.design, layer.side).find((z) => z.id === zoneId)
        if (!zone) return
        // Fit the layer inside the zone (92% margin), keeping aspect.
        const cur = measureLayer(layer, 100)
        const cwIn = cur.w / 100
        const chIn = cur.h / 100
        const scale =
          cwIn > 0 && chIn > 0
            ? Math.min((zone.wIn * 0.92) / cwIn, (zone.hIn * 0.92) / chIn)
            : 1
        const patch: Partial<Layer> = { xIn: zone.cxIn, yIn: zone.cyIn }
        if (layer.type === 'text') {
          const p = patch as Partial<TextLayer>
          p.fontSizeIn = Math.max(0.12, Math.round(layer.fontSizeIn * scale * 100) / 100)
          if (layer.strokeWidthIn > 0)
            p.strokeWidthIn = Math.round(layer.strokeWidthIn * scale * 1000) / 1000
        } else {
          const p = patch as Partial<ImageLayer>
          p.wIn = Math.max(0.15, Math.round(layer.wIn * scale * 100) / 100)
          p.hIn = Math.max(0.15, Math.round(layer.hIn * scale * 100) / 100)
        }
        get().patchLayer(layer.id, patch)
      },
      setMode: (mode) => {
        set({ mode })
        if (mode === '3d') set({ selectedId: null, propsExpanded: false })
      },
      setSide: (side) => {
        set({ activeSide: side, selectedId: null, propsExpanded: false })
        if (get().mode === '3d' && side !== 'sleeve') get().requestView(side)
      },
      select: (selectedId) => set({ selectedId, propsExpanded: false }),
      setPanel: (activePanel) => set({ activePanel }),
      setPropsExpanded: (propsExpanded) => set({ propsExpanded }),
      setDragging: (dragging) => set({ dragging }),
      openModal: (m) => set((s) => ({ modals: { ...s.modals, [m]: true } })),
      closeModal: (m) => set((s) => ({ modals: { ...s.modals, [m]: false } })),
      toast: (kind, msg) => {
        const id = nanoid(6)
        set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, msg }] }))
        setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 4200)
      },
      dismissToast: (id) =>
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      requestView: (view) =>
        set((s) => ({
          viewRequest: { view, nonce: (s.viewRequest?.nonce ?? 0) + 1 },
        })),
      setAutoRotate: (autoRotate) => set({ autoRotate }),
      setAssets: (assets) => set({ assets }),
      setSavedDesigns: (savedDesigns) => set({ savedDesigns }),
      markHydrated: () => set({ hydrated: true }),

      setGarment: (id) => {
        const s = get()
        if (id === 'custom' && !s.design.custom?.front) {
          set((st) => ({ modals: { ...st.modals, customSetup: true } }))
          return
        }
        const crossing = crossesCustomBoundary(s.design.garmentId, id)
        set({
          design: touch(clampLayersToArea(switchGarment(s.design, id))),
          // Crossing to/from custom swaps to the other layer bucket — the
          // current selection lives in the now-stashed one, so clear it.
          ...(crossing ? { selectedId: null, propsExpanded: false } : {}),
          // Custom garments have no sleeve side — snap back to front.
          ...(id === 'custom' && s.activeSide === 'sleeve' ? { activeSide: 'front' as Side } : {}),
        })
      },
      setColor: (colorId) =>
        set((s) => ({ design: touch({ ...s.design, colorId }) })),
      setCustom: (custom) => {
        const s = get()
        const nextGarment: GarmentId = custom
          ? 'custom'
          : s.design.garmentId === 'custom'
            ? 'tee'
            : s.design.garmentId
        const crossing = crossesCustomBoundary(s.design.garmentId, nextGarment)
        // Swap buckets first (if crossing), then attach the custom garment.
        const base = switchGarment(s.design, nextGarment)
        set({
          design: touch(clampLayersToArea({ ...base, custom })),
          ...(crossing ? { selectedId: null } : {}),
          ...(custom && s.activeSide === 'sleeve' ? { activeSide: 'front' as Side } : {}),
        })
      },

      addTextLayer: (text = 'YOUR TEXT') => {
        const s = get()
        const dark = s.design.garmentId === 'custom' ? true : isDark(
          GARMENT_COLORS.find((c) => c.id === s.design.colorId)?.hex ?? '#fff',
        )
        const layer: TextLayer = {
          id: nanoid(8),
          type: 'text',
          side: s.activeSide,
          name: `Text ${layerCounter++}`,
          text,
          xIn: 0,
          yIn: 0,
          rotation: 0,
          opacity: 1,
          fontFamily: 'Anton',
          fontSizeIn: 1.1,
          fill: dark ? '#FFFFFF' : '#111111',
          stroke: null,
          strokeWidthIn: 0,
          letterSpacingEm: 0.02,
          curve: 0,
          align: 'center',
        }
        set({
          design: touch({ ...s.design, layers: [...s.design.layers, layer] }),
          selectedId: layer.id,
        })
      },

      addImageLayer: (asset) => {
        const s = get()
        const area = getAreaSizeIn(s.design, s.activeSide)
        const maxW = area.wIn * 0.72
        const maxH = area.hIn * 0.6
        const scale = Math.min(maxW / asset.width, maxH / asset.height)
        const layer: ImageLayer = {
          id: nanoid(8),
          type: 'image',
          side: s.activeSide,
          name: asset.name,
          assetId: asset.id,
          xIn: 0,
          yIn: 0,
          rotation: 0,
          opacity: 1,
          wIn: asset.width * scale,
          hIn: asset.height * scale,
          flipX: false,
          useCutout: asset.hasCutout,
        }
        set({
          design: touch({ ...s.design, layers: [...s.design.layers, layer] }),
          selectedId: layer.id,
        })
      },

      addGraphicLayer: (graphicId) => {
        const s = get()
        const def = GRAPHICS.find((g) => g.id === graphicId)
        if (!def) return
        const dark = s.design.garmentId === 'custom' ? true : isDark(
          GARMENT_COLORS.find((c) => c.id === s.design.colorId)?.hex ?? '#fff',
        )
        const wIn = 3.4
        const layer: GraphicLayer = {
          id: nanoid(8),
          type: 'graphic',
          side: s.activeSide,
          name: def.name,
          graphicId,
          xIn: 0,
          yIn: 0,
          rotation: 0,
          opacity: 1,
          wIn,
          hIn: wIn / def.aspect,
          fill: dark ? '#FFFFFF' : '#111111',
          flipX: false,
        }
        set({
          design: touch({ ...s.design, layers: [...s.design.layers, layer] }),
          selectedId: layer.id,
        })
      },

      patchLayer: (id, patch, opts) => {
        const apply = () =>
          set((s) => ({
            design: touch({
              ...s.design,
              layers: s.design.layers.map((l) =>
                l.id === id ? ({ ...l, ...patch } as Layer) : l,
              ),
            }),
          }))
        const t = useStore.temporal.getState()
        if (opts?.transient) {
          // Gesture in progress (drag / slider scrub): remember the state the
          // gesture STARTED from, and keep the intermediate frames out of
          // history.
          gestureStart ??= get().design
          t.pause()
          apply()
          t.resume()
        } else if (
          gestureStart &&
          gestureStart.id === get().design.id &&
          gestureStart.layers.some((l) => l.id === id)
        ) {
          // Commit of a gesture: rewind (unrecorded) to the pre-gesture
          // state, then apply the final patch as ONE recorded step — so undo
          // returns exactly to where the drag began.
          t.pause()
          set({ design: gestureStart })
          t.resume()
          gestureStart = null
          apply()
        } else {
          gestureStart = null
          apply()
        }
      },

      removeLayer: (id) => {
        // No-op removals (stale selection after undo) must not pollute the
        // history and wipe the redo stack.
        if (!get().design.layers.some((l) => l.id === id)) {
          set({ selectedId: null })
          return
        }
        set((s) => ({
          design: touch({
            ...s.design,
            layers: s.design.layers.filter((l) => l.id !== id),
          }),
          selectedId: s.selectedId === id ? null : s.selectedId,
        }))
      },

      /** Remove every layer (and custom-garment reference) using an asset. */
      purgeAsset: (assetId: string) => {
        const s = get()
        // Purge the asset from BOTH design contexts (it's a global deletion).
        const keep = (l: Layer) => l.type !== 'image' || l.assetId !== assetId
        const layers = s.design.layers.filter(keep)
        const stashedLayers = s.design.stashedLayers.filter(keep)
        let custom = s.design.custom
        if (custom?.front?.assetId === assetId || custom?.back?.assetId === assetId) {
          custom = {
            ...custom,
            front: custom.front?.assetId === assetId ? null : custom.front,
            back: custom.back?.assetId === assetId ? null : custom.back,
          }
          if (!custom.front) custom = null
        }
        if (
          layers.length === s.design.layers.length &&
          stashedLayers.length === s.design.stashedLayers.length &&
          custom === s.design.custom
        )
          return
        // Dropping the custom garment reverts to the tee — cross the boundary.
        const nextGarment: GarmentId =
          s.design.garmentId === 'custom' && !custom ? 'tee' : s.design.garmentId
        const next = switchGarment(
          { ...s.design, layers, stashedLayers, custom },
          nextGarment,
        )
        set({
          design: touch(clampLayersToArea(next)),
          selectedId: null,
        })
      },

      duplicateLayer: (id) => {
        const s = get()
        const src = s.design.layers.find((l) => l.id === id)
        if (!src) return
        const copy: Layer = {
          ...src,
          id: nanoid(8),
          name: `${src.name} copy`,
          xIn: src.xIn + 0.4,
          yIn: src.yIn + 0.4,
        }
        set({
          design: touch({ ...s.design, layers: [...s.design.layers, copy] }),
          selectedId: copy.id,
        })
      },

      moveLayer: (id, dir) => {
        const s = get()
        const all = [...s.design.layers]
        const i = all.findIndex((l) => l.id === id)
        if (i < 0) return
        // find neighbor on the SAME side (visual stacking is per side)
        let j = i + (dir === 'up' ? 1 : -1)
        while (j >= 0 && j < all.length && all[j].side !== all[i].side)
          j += dir === 'up' ? 1 : -1
        if (j < 0 || j >= all.length) return
        const [item] = all.splice(i, 1)
        all.splice(j, 0, item)
        set({ design: touch({ ...s.design, layers: all }) })
      },

      renameDesign: (name) =>
        set((s) => ({ design: touch({ ...s.design, name: name || 'Untitled' }) })),

      loadDesign: (design) => {
        gestureStart = null
        set({ design: migrateDesign(design), selectedId: null, activeSide: 'front' })
        useStore.temporal.getState().clear()
      },

      newDesign: () => {
        gestureStart = null
        const fresh: Design = {
          id: nanoid(10),
          name: 'Untitled design',
          garmentId: 'tee',
          colorId: 'white',
          custom: null,
          layers: [],
          stashedLayers: [],
          updatedAt: Date.now(),
        }
        set({ design: fresh, selectedId: null, activeSide: 'front' })
        useStore.temporal.getState().clear()
      },
    }),
    {
      partialize: (s) => ({ design: s.design }),
      limit: 100,
      equality: (past, current) => past.design === current.design,
    },
  ),
)

export const undo = () => useStore.temporal.getState().undo()
export const redo = () => useStore.temporal.getState().redo()

/** Reactive undo/redo availability. */
export function useHistoryDepth() {
  const past = useVanillaStore(useStore.temporal, (s) => s.pastStates.length)
  const future = useVanillaStore(useStore.temporal, (s) => s.futureStates.length)
  return { canUndo: past > 0, canRedo: future > 0 }
}
