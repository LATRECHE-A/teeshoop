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
import { getAreaSizeIn } from '@/lib/renderDesign'
import { clamp } from '@/lib/units'

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

  // --- ui actions
  setMode(mode: Mode): void
  setSide(side: Side): void
  select(id: string | null): void
  setPanel(p: PanelId | null): void
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

let layerCounter = 1

export const useStore = create<StoreState>()(
  temporal(
    (set, get) => ({
      design: makeSampleDesign(),
      activeSide: 'front',
      mode: '2d',
      selectedId: null,
      activePanel: 'product',
      modals: { customSetup: false, order: false, designs: false, share: false, shortcuts: false },
      toasts: [],
      assets: [],
      savedDesigns: [],
      hydrated: false,
      viewRequest: null,
      autoRotate: false,

      setMode: (mode) => {
        set({ mode })
        if (mode === '3d') set({ selectedId: null })
      },
      setSide: (side) => {
        set({ activeSide: side, selectedId: null })
        if (get().mode === '3d') get().requestView(side)
      },
      select: (selectedId) => set({ selectedId }),
      setPanel: (activePanel) => set({ activePanel }),
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
        set({
          design: touch(clampLayersToArea({ ...s.design, garmentId: id })),
        })
      },
      setColor: (colorId) =>
        set((s) => ({ design: touch({ ...s.design, colorId }) })),
      setCustom: (custom) =>
        set((s) => ({
          design: touch(
            clampLayersToArea({
              ...s.design,
              custom,
              garmentId: custom ? 'custom' : s.design.garmentId === 'custom' ? 'tee' : s.design.garmentId,
            }),
          ),
        })),

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
        if (opts?.transient) {
          const t = useStore.temporal.getState()
          t.pause()
          apply()
          t.resume()
        } else {
          apply()
        }
      },

      removeLayer: (id) =>
        set((s) => ({
          design: touch({
            ...s.design,
            layers: s.design.layers.filter((l) => l.id !== id),
          }),
          selectedId: s.selectedId === id ? null : s.selectedId,
        })),

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
        set({ design, selectedId: null, activeSide: 'front' })
        useStore.temporal.getState().clear()
      },

      newDesign: () => {
        const fresh: Design = {
          id: nanoid(10),
          name: 'Untitled design',
          garmentId: 'tee',
          colorId: 'white',
          custom: null,
          layers: [],
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
