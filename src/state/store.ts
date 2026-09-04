import { create, useStore as useVanillaStore } from 'zustand'
import { temporal } from 'zundo'
import { nanoid } from 'nanoid'
import type {
  AssetMeta,
  CustomGarment,
  Design,
  GarmentId,
  Gender,
  GraphicLayer,
  ImageLayer,
  Layer,
  SavedDesignMeta,
  PrintScaleMode,
  Side,
  TextLayer,
} from '@/lib/types'
import { GARMENTS } from '@/garments'
import { garmentHexOf } from '@/content/garmentPalette'
import { GRAPHICS } from '@/content/graphics'
import { makeSampleDesign } from '@/content/sampleDesign'
import { getAreaSizeIn, measureLayer } from '@/lib/renderDesign'
import { migrateDesign } from '@/lib/migrate'
import { zonesFor } from '@/content/zones'
import { clamp } from '@/lib/units'
import { setCurrentLang, type Lang } from '@/i18n/lang'
import { DEFAULT_PRINT_SCALE_MODE, printScaleOf } from '@/lib/printScale'
import type { SceneId } from '@/scenes'
import { DEFAULT_SIZE, type SizeId } from '@/content/sizeChart'
import {
  applyLang,
  applyTheme,
  loadPrefs,
  savePrefs,
  type Prefs,
  type Theme,
} from './prefs'
import {
  clampQty,
  lineFieldsFor,
  loadBasket,
  makeBasketLine,
  mutateBasket,
  updateLine,
  type BasketLine,
} from './basket'
import { BOARD_OFF, type BoardStash, type BoardState } from './board'
import { createHistoryRegistry, type HistoryStacks } from './history'

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
  /** Order basket (several products / sizes / quantities). */
  basket: boolean
  /** Add to the SHOP's basket. Only reachable when the studio is framed by it. */
  cart: boolean
  /** Supplier product catalog picker. */
  catalog: boolean
  /** Admin: DTF gang-sheet builder. */
  dtf: boolean
  /** Admin: product ingest (two photos + cm chart → studio garment). */
  adminIngest: boolean
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
  /** Order lines: snapshots, NOT part of the undoable design. */
  basket: BasketLine[]
  /**
   * Board mode (several basket products at once). Presentation state: never
   * persisted, never undoable. See src/state/board.ts.
   */
  board: BoardState
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
  /** Display-mannequin silhouette for the 3D worn preview + AR try-on. */
  figureGender: Gender
  /** Garment size the 2D/3D/AR previews render at (real cm dimensions). */
  previewSize: SizeId
  /** Mobile: is the selection sheet expanded (vs the compact action bar)? */
  propsExpanded: boolean
  /** A canvas layer is being dragged: mobile hides the props sheet meanwhile. */
  dragging: boolean

  // --- ui actions
  setTheme(theme: Theme): void
  setLang(lang: Lang): void
  setScene(scene: SceneId): void
  setFigureGender(g: Gender): void
  setPreviewSize(size: SizeId): void
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

  // --- basket actions (persisted, never undoable)
  /** Snapshot the CURRENT design + previewSize as a new order line. */
  addToBasket(): void
  setBasketQty(id: string, qty: number): void
  removeBasketLine(id: string): void
  clearBasket(): void

  // --- board actions (presentation; never persisted, never undoable)
  /** Open the board on the WHOLE basket (the requested default). */
  enterBoard(): void
  exitBoard(): void
  toggleBoardLine(id: string): void
  setBoardSelection(ids: string[]): void
  /** Swap a basket line into the live document so every editing tool works. */
  focusLine(id: string): void
  /** Write the focused line back and restore the user's own document. */
  unfocusLine(): void
  /** Mirror the focused line's live edits into the basket (crash safety). */
  flushFocusedLine(): void

  // --- design actions (undoable)
  setGarment(id: GarmentId): void
  setColor(colorId: string): void
  /** Grade artwork with the garment size, or keep one print for every size. */
  setPrintScaleMode(mode: PrintScaleMode): void
  /** The size the design's stored inch geometry is authored at. */
  setPrintBaseSize(size: SizeId): void
  setCustom(custom: CustomGarment | null): void
  /** `maxWidthIn` shrinks the font so the text fits that width (zone drops). */
  addTextLayer(text?: string, overrides?: Partial<TextLayer>, maxWidthIn?: number): void
  addImageLayer(asset: AssetMeta, overrides?: Partial<ImageLayer>): void
  /** Add an image sized+centred into a named print zone (click/drop target). */
  addImageLayerInZone(asset: AssetMeta, zoneId: string): void
  /** Add an image at a specific spot (free drop), default sizing. */
  addImageLayerAt(asset: AssetMeta, xIn: number, yIn: number): void
  /** Add a text layer sized+centred into a named print zone. */
  addTextLayerInZone(zoneId: string, text?: string): void
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

/**
 * Keep layer centers inside the print area when the area changes.
 *
 * Deliberately calls getAreaSizeIn WITHOUT a size: stored geometry is
 * base-space inches, so every WRITE clamps against the UNGRADED area. Passing
 * previewSize here would let a 3XL preview push coordinates outside the base
 * area (and shrink them back on an S). See src/lib/printScale.ts.
 */
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
 * one design; custom keeps its own, so editing the default tee never mutates
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

/**
 * Does this design's garment actually HAVE that side? Catalog garments have all
 * three; a custom (ship-your-own) garment has no sleeve, and has a back only
 * when the customer supplied a back photo, or the supplier ingest
 * reconstructed one (CustomSideSetup.origin === 'generated').
 *
 * Every garment switch must re-check the active side against this: a side that
 * does not exist cannot be drawn or edited, and leaving `activeSide` on one
 * strands the user on a locked side with a disabled way back.
 */
function hasSide(design: Design, side: Side): boolean {
  if (design.garmentId !== 'custom') return true
  if (side === 'sleeve') return false
  return side === 'front' || !!design.custom?.back
}

let layerCounter = 1

/** Pre-gesture design snapshot (drag / slider scrub); see patchLayer. */
let gestureStart: Design | null = null

/**
 * The user's own document, parked while a basket line is focused on the board.
 * Module-level and non-reactive on purpose, exactly like `gestureStart` above:
 * it must never re-render anything and must never enter the undo history.
 */
let boardStash: BoardStash | null = null

/**
 * Undo stacks of basket lines focused earlier in this board session. Module-level
 * and non-reactive like `boardStash` above, and, like `board` itself, forgotten
 * when the board closes. The user's OWN draft is NOT in here: its stacks ride in
 * boardStash, where nothing can evict them.
 */
const parkedHistory = createHistoryRegistry()

/**
 * Move the live undo history aside and put `next` in its place, returning what
 * was there. ONE temporal setState, because useHistoryDepth subscribes to that
 * store: clearing and then installing would blink the toolbar's undo/redo
 * buttons through a disabled frame.
 *
 * Copies, because zundo's undo()/redo() `splice` pastStates IN PLACE (measured:
 * an aliased array lost an entry under a foreign undo). Parking by reference
 * would let one document's undo rewrite another's parked stack.
 *
 * setState is the supported way in: zundo 2.3.0 builds `store.temporal` with a
 * plain `createStore`, so it is an ordinary zustand store and `isTracking`,
 * `_onSave` and `_handleSet` are left untouched.
 */
function swapHistory(next: HistoryStacks | null): HistoryStacks {
  const t = useStore.temporal
  const live = t.getState()
  const parked: HistoryStacks = {
    past: live.pastStates.slice(),
    future: live.futureStates.slice(),
  }
  t.setState({ pastStates: next?.past ?? [], futureStates: next?.future ?? [] })
  return parked
}

/**
 * Apply ONE transformation to both the in-memory basket and its persisted
 * copy, same idiom as prefsFromState (mutate state, then persist), except
 * the idb side goes through mutateBasket so the stored array is
 * read-modify-written in a single transaction instead of being overwritten.
 * `fn` runs twice (memory + storage), so it must be pure.
 */
function applyBasket(fn: (lines: BasketLine[]) => BasketLine[]): void {
  useStore.setState((s) => ({ basket: fn(s.basket) }))
  void mutateBasket(fn)
}

/** The persisted-prefs slice of the store: call AFTER set() so it reads the
 * fresh values; keeps every pref setter in sync automatically. */
function prefsFromState(s: {
  theme: Theme
  lang: Lang
  scene: SceneId
  showGuides: boolean
  figureGender: Gender
  previewSize: SizeId
}): Prefs {
  return {
    theme: s.theme,
    lang: s.lang,
    scene: s.scene,
    showGuides: s.showGuides,
    figureGender: s.figureGender,
    previewSize: s.previewSize,
  }
}

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
      modals: { customSetup: false, order: false, designs: false, share: false, shortcuts: false, ar: false, basket: false, cart: false, catalog: false, dtf: false, adminIngest: false },
      toasts: [],
      assets: [],
      savedDesigns: [],
      basket: [],
      board: BOARD_OFF,
      hydrated: false,
      viewRequest: null,
      autoRotate: false,
      theme: initialPrefs.theme,
      lang: initialPrefs.lang,
      scene: initialPrefs.scene,
      showGuides: initialPrefs.showGuides,
      figureGender: initialPrefs.figureGender,
      previewSize: initialPrefs.previewSize,
      propsExpanded: false,
      dragging: false,

      setTheme: (theme) => {
        applyTheme(theme)
        set({ theme })
        savePrefs(prefsFromState(get()))
      },
      setLang: (lang) => {
        setCurrentLang(lang)
        applyLang(lang)
        set({ lang })
        savePrefs(prefsFromState(get()))
      },
      setScene: (scene) => {
        set({ scene })
        savePrefs(prefsFromState(get()))
      },
      setFigureGender: (figureGender) => {
        set({ figureGender })
        savePrefs(prefsFromState(get()))
      },
      setPreviewSize: (previewSize) => {
        set({ previewSize })
        // While a basket line is focused the size belongs to the LINE, not to
        // the user's prefs. It is written back by flushFocusedLine, and
        // persisting it here would silently re-size their own draft too.
        if (get().board.focusedId) return
        savePrefs(prefsFromState(get()))
      },
      toggleGuides: () => {
        set({ showGuides: !get().showGuides })
        savePrefs(prefsFromState(get()))
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

      addToBasket: () => {
        const s = get()
        // Built ONCE (it has a fresh id + timestamp): applyBasket replays the
        // transformation against storage, so it must not mint a second line.
        const line = makeBasketLine(s.design, s.previewSize)
        applyBasket((lines) => [...lines, line])
      },
      setBasketQty: (id, qty) =>
        applyBasket((lines) =>
          lines.map((l) => (l.id === id ? { ...l, qty: clampQty(qty) } : l)),
        ),
      removeBasketLine: (id) => {
        // Deleting the line under the user's feet: give the focused document
        // back first, so the write-back has somewhere to land and the board
        // never points at a line that no longer exists.
        if (get().board.focusedId === id) get().unfocusLine()
        // …which just parked that line's undo stack. The document is gone, so its
        // history goes with it, AFTER the unfocus, or the parking puts it back.
        parkedHistory.drop(id)
        applyBasket((lines) => lines.filter((l) => l.id !== id))
        set((s) => ({
          board: { ...s.board, selectedIds: s.board.selectedIds.filter((x) => x !== id) },
        }))
      },
      clearBasket: () => {
        if (get().board.on) get().exitBoard()
        applyBasket(() => [])
      },

      enterBoard: () => {
        // Re-entering from the basket while a product is focused (the basket is
        // still reachable from the top bar): give the document back FIRST.
        // Otherwise focusedId is cleared while the line's design is still live,
        // and the next autosave writes it over the user's own draft.
        if (get().board.focusedId) get().unfocusLine()
        const s = get()
        set({
          board: { on: true, selectedIds: s.basket.map((l) => l.id), focusedId: null },
          // MUST close in the same set(): the basket modal renders a fixed
          // scrim and useKeyboardShortcuts blocks every key while any modal
          // flag is true. Forgetting this leaves the board unreachable.
          modals: { ...s.modals, basket: false },
          activePanel: null,
          selectedId: null,
          propsExpanded: false,
        })
      },

      exitBoard: () => {
        get().unfocusLine()
        boardStash = null
        // The board session is over, so are its parked line histories. Keeping
        // them would let a stack outlive the document it describes: the line can
        // be edited from the basket, or deleted, before the board is re-entered.
        parkedHistory.reset()
        set({ board: BOARD_OFF })
      },

      toggleBoardLine: (id) => {
        if (get().board.focusedId === id) get().unfocusLine()
        set((s) => ({
          board: {
            ...s.board,
            selectedIds: s.board.selectedIds.includes(id)
              ? s.board.selectedIds.filter((x) => x !== id)
              : [...s.board.selectedIds, id],
          },
        }))
      },

      setBoardSelection: (ids) => set((s) => ({ board: { ...s.board, selectedIds: ids } })),

      focusLine: (id) => {
        const s = get()
        if (!s.board.on || s.board.focusedId === id) return
        if (s.board.focusedId) get().flushFocusedLine()
        const line = get().basket.find((l) => l.id === id)
        if (!line) return
        // Histories move first, then the documents. The OUTGOING document's
        // stacks are parked under its own key, the LINE id, never design.id:
        // two lines cloned from one design share design.id AND every layer id
        // (board-verify C2), and the incoming line gets back whatever it left
        // parked in this board session. Swapped WHOLE, so no snapshot of one
        // document can ever be reachable while another one is live.
        const parked = swapHistory(parkedHistory.take(id))
        if (s.board.focusedId) {
          parkedHistory.save(s.board.focusedId, parked)
        } else {
          // Only the FIRST focus parks the user's own document: focusing straight
          // from one line to another must not park the OUTGOING LINE as if it
          // were theirs. unfocusLine drops the stash once it has been restored.
          boardStash = {
            design: s.design,
            previewSize: s.previewSize,
            activeSide: s.activeSide,
            selectedId: s.selectedId,
            history: parked,
          }
        }
        // A pending gesture belongs to the OUTGOING document. Two lines cloned
        // from the same original share a design id, so patchLayer's rewind
        // guard cannot tell them apart. Leaving this set is a real corruption
        // path, not a tidiness issue.
        gestureStart = null
        const t = useStore.temporal.getState()
        t.pause()
        set({
          design: migrateDesign(structuredClone(line.design)),
          // Written directly, NOT through setPreviewSize: this size is the
          // line's, and savePrefs must not learn about it.
          previewSize: line.size,
          activeSide: 'front',
          selectedId: null,
          propsExpanded: false,
          board: { ...get().board, focusedId: id },
        })
        t.resume()
      },

      unfocusLine: () => {
        const s = get()
        if (!s.board.focusedId) return
        get().flushFocusedLine()
        const stash = boardStash
        // Dropped as it is handed back: the stash is the parked document, and a
        // kept one goes stale the moment the restored draft is edited: the next
        // focus would then park (and later restore) a superseded snapshot.
        boardStash = null
        gestureStart = null
        // The other direction, same single swap: the line's stacks go back to
        // the registry (re-focusing it in this board session restores them) and
        // the draft gets its own back, which is what makes Ctrl+Z after the
        // board walk the user's own edits again. `save` drops the entry itself
        // when the line was focused without ever being edited.
        parkedHistory.save(s.board.focusedId, swapHistory(stash?.history ?? null))
        const t = useStore.temporal.getState()
        t.pause()
        set({
          design: stash?.design ?? s.design,
          previewSize: stash?.previewSize ?? s.previewSize,
          activeSide: stash?.activeSide ?? 'front',
          selectedId: null,
          propsExpanded: false,
          activePanel: null,
          board: { ...get().board, focusedId: null },
        })
        t.resume()
      },

      flushFocusedLine: () => {
        const s = get()
        const id = s.board.focusedId
        if (!id) return
        // Built ONCE, outside applyBasket: the transformation is replayed
        // against storage, and structuredClone inside it would hand memory and
        // idb two different objects.
        const fields = lineFieldsFor(structuredClone(s.design), s.previewSize)
        applyBasket((lines) => updateLine(lines, id, fields))
      },

      setGarment: (id) => {
        const s = get()
        if (id === 'custom' && !s.design.custom?.front) {
          set((st) => ({ modals: { ...st.modals, customSetup: true } }))
          return
        }
        const crossing = crossesCustomBoundary(s.design.garmentId, id)
        const design = touch(clampLayersToArea(switchGarment(s.design, id)))
        set({
          design,
          // Crossing to/from custom swaps to the other layer bucket: the
          // current selection lives in the now-stashed one, so clear it.
          ...(crossing ? { selectedId: null, propsExpanded: false } : {}),
          // The new garment may not have the side we were on (custom has no
          // sleeve, and no back unless a back image exists), snap to front
          // rather than leave the editor pointing at a side that isn't there.
          ...(hasSide(design, s.activeSide)
            ? {}
            : { activeSide: 'front' as Side, selectedId: null, propsExpanded: false }),
        })
      },
      setColor: (colorId) =>
        set((s) => ({ design: touch({ ...s.design, colorId }) })),
      // Grading policy lives ON the design, so both setters are undoable: one
      // set() per gesture is one zundo entry. Neither touches layer geometry:
      // the stored inches ARE the base-size truth. Changing the base size
      // therefore re-interprets what those numbers mean (the same 4″ logo now
      // means "4″ on an XL"), which is the documented, intended behaviour.
      // Rewriting geometry here would instead make the design drift every time
      // the user flipped the control.
      setPrintScaleMode: (mode) =>
        set((s) => ({
          design: touch({ ...s.design, printScale: { ...printScaleOf(s.design), mode } }),
        })),
      setPrintBaseSize: (baseSize) =>
        set((s) => ({
          design: touch({ ...s.design, printScale: { ...printScaleOf(s.design), baseSize } }),
        })),
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
        const design = touch(clampLayersToArea({ ...base, custom }))
        set({
          design,
          ...(crossing ? { selectedId: null } : {}),
          // Custom garments have no sleeve side, and a side without an image is
          // locked. Either way, snap back to front rather than strand the user.
          ...(hasSide(design, s.activeSide) ? {} : { activeSide: 'front' as Side }),
        })
      },

      addTextLayer: (text = 'YOUR TEXT', overrides, maxWidthIn) => {
        const s = get()
        const dark = s.design.garmentId === 'custom' ? true : isDark(
          garmentHexOf(s.design.colorId),
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
          ...overrides,
        }
        // Fit the width too when asked (zones are often much wider than tall,
        // and a height-derived size can spill outside the print area).
        if (maxWidthIn && maxWidthIn > 0) {
          const wIn = measureLayer(layer, 100).w / 100
          const scale = wIn > 0 ? Math.min(1, maxWidthIn / wIn) : 1
          if (scale < 1)
            layer.fontSizeIn = Math.max(
              0.12,
              Math.round(layer.fontSizeIn * scale * 100) / 100,
            )
        }
        set({
          design: touch({ ...s.design, layers: [...s.design.layers, layer] }),
          selectedId: layer.id,
        })
      },

      addImageLayer: (asset, overrides) => {
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
          ...overrides,
        }
        set({
          design: touch({ ...s.design, layers: [...s.design.layers, layer] }),
          selectedId: layer.id,
        })
      },

      addImageLayerInZone: (asset, zoneId) => {
        const s = get()
        const zone = zonesFor(s.design, s.activeSide).find((z) => z.id === zoneId)
        if (!zone) {
          get().addImageLayer(asset)
          return
        }
        // Fit into the zone (92% margin), keeping the image's aspect: the
        // "drop it on the heart and it just fits" behaviour.
        const scale = Math.min(
          (zone.wIn * 0.92) / asset.width,
          (zone.hIn * 0.92) / asset.height,
        )
        const layer: ImageLayer = {
          id: nanoid(8),
          type: 'image',
          side: s.activeSide,
          name: asset.name,
          assetId: asset.id,
          xIn: zone.cxIn,
          yIn: zone.cyIn,
          rotation: 0,
          opacity: 1,
          wIn: Math.max(0.15, asset.width * scale),
          hIn: Math.max(0.15, asset.height * scale),
          flipX: false,
          useCutout: asset.hasCutout,
        }
        set({
          design: touch({ ...s.design, layers: [...s.design.layers, layer] }),
          selectedId: layer.id,
        })
      },

      addImageLayerAt: (asset, xIn, yIn) => {
        const s = get()
        const area = getAreaSizeIn(s.design, s.activeSide)
        // Placed in the SAME set() as the add: one drop is one undo step.
        get().addImageLayer(asset, {
          xIn: clamp(xIn, -area.wIn / 2, area.wIn / 2),
          yIn: clamp(yIn, -area.hIn / 2, area.hIn / 2),
        })
      },

      addTextLayerInZone: (zoneId, text = 'YOUR TEXT') => {
        const s = get()
        const zone = zonesFor(s.design, s.activeSide).find((z) => z.id === zoneId)
        if (!zone) {
          get().addTextLayer(text)
          return
        }
        get().addTextLayer(
          text,
          {
            xIn: zone.cxIn,
            yIn: zone.cyIn,
            fontSizeIn: Math.min(2.2, Math.max(0.4, Math.round(zone.hIn * 0.35 * 100) / 100)),
          },
          zone.wIn * 0.92,
        )
      },

      addGraphicLayer: (graphicId) => {
        const s = get()
        const def = GRAPHICS.find((g) => g.id === graphicId)
        if (!def) return
        const dark = s.design.garmentId === 'custom' ? true : isDark(
          garmentHexOf(s.design.colorId),
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
          // state, then apply the final patch as ONE recorded step, so undo
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
        // Dropping the custom garment reverts to the tee: cross the boundary.
        const nextGarment: GarmentId =
          s.design.garmentId === 'custom' && !custom ? 'tee' : s.design.garmentId
        const next = switchGarment(
          { ...s.design, layers, stashedLayers, custom },
          nextGarment,
        )
        set({
          design: touch(clampLayersToArea(next)),
          selectedId: null,
          // Deleting the back photo locks that side. Don't leave the user on it.
          ...(nextGarment === 'custom' && s.activeSide === 'back' && !custom?.back
            ? { activeSide: 'front' as Side }
            : {}),
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
        // Loading an unrelated document while a basket line is focused would
        // let the line silently absorb it on the next write-back.
        if (get().board.on) get().exitBoard()
        gestureStart = null
        set({ design: migrateDesign(design), selectedId: null, activeSide: 'front' })
        useStore.temporal.getState().clear()
      },

      newDesign: () => {
        if (get().board.on) get().exitBoard()
        gestureStart = null
        const fresh: Design = {
          id: nanoid(10),
          name: 'Untitled design',
          garmentId: 'tee',
          colorId: 'white',
          custom: null,
          layers: [],
          stashedLayers: [],
          printScale: { mode: DEFAULT_PRINT_SCALE_MODE, baseSize: DEFAULT_SIZE },
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

// The basket lives outside the design document (and outside its history), so
// it hydrates itself here rather than in hydrateStore (once, at import), which
// also keeps StrictMode's double effect out of the picture.
void loadBasket().then((stored) => {
  if (stored.length === 0) return
  useStore.setState((s) => ({
    // A line added before this resolved already reached idb: keep it, last.
    basket: [...stored.filter((l) => !s.basket.some((x) => x.id === l.id)), ...s.basket],
  }))
})

/**
 * Browsing the board, `design` is the user's OWN draft while the screen shows
 * somebody else's products, so there is no document undo could act on that the
 * user can see. useKeyboardShortcuts already refuses every design-mutating
 * shortcut in that state; this is the same rule for the pointer, and it has to
 * live here because the TopBar button is a second door to the same action.
 *
 * Without it the restored draft stacks light the toolbar back up the moment a
 * line is un-focused (measured: draft with two text layers, one click on the
 * board, one layer gone and nothing on screen to show it), the button
 * promising an undo that Ctrl+Z at the same instant refuses.
 *
 * FOCUSED is not browsing: that document IS on screen, and its own stack is
 * live (src/state/history.ts).
 */
function browsingBoard(s: StoreState): boolean {
  return s.board.on && !s.board.focusedId
}

export const undo = () => {
  if (browsingBoard(useStore.getState())) return
  useStore.temporal.getState().undo()
}
export const redo = () => {
  if (browsingBoard(useStore.getState())) return
  useStore.temporal.getState().redo()
}

/**
 * Basket lines whose undo history is parked. Diagnostics for
 * scripts/board-verify.mjs, which asserts this is 0 whenever the board is off:
 * that is what keeps the registry session-scoped (src/state/history.ts).
 */
export function parkedHistorySlots(): number {
  return parkedHistory.size
}

/**
 * Reactive undo/redo availability: what the toolbar buttons show.
 *
 * Gated on browsingBoard for the same reason undo()/redo() are: a lit-but-dead
 * button is worse than a grey one, and the rail beside it is already disabled
 * while browsing (scripts/board-verify.mjs section O).
 */
export function useHistoryDepth() {
  const past = useVanillaStore(useStore.temporal, (s) => s.pastStates.length)
  const future = useVanillaStore(useStore.temporal, (s) => s.futureStates.length)
  const browsing = useStore(browsingBoard)
  return { canUndo: !browsing && past > 0, canRedo: !browsing && future > 0 }
}
