/**
 * Persistence: autosave to IndexedDB, saved-designs library, design-file
 * export/import (with embedded images), and share links for image-free
 * designs (compressed into the URL hash).
 */
import { get, set, del } from 'idb-keyval'
import { nanoid } from 'nanoid'
import type { AssetMeta, Design, SavedDesignMeta } from '@/lib/types'
import { useStore } from './store'
import { assetToDataUrl, importAsset, listAssets } from './assets'
import { listSavedMetas, renderAndSave } from './savedDesigns'
import { makeSampleDesign } from '@/content/sampleDesign'
import { migrateDesign } from '@/lib/migrate'
import { canShareAsLink, designToShareHash, parseShareHash } from '@/lib/shareLink'
import { t } from '@/i18n'

const CURRENT_KEY = 'tshop:current'
const SEEN_KEY = 'tshop:seen'

// Share-link codec now lives store-free in src/lib/shareLink.ts (so the AR
// entry can reuse it without the studio bundle); re-export for existing callers.
export { canShareAsLink, designToShareHash, parseShareHash }

// --- design files --------------------------------------------------------

interface DesignFile {
  v: 1
  app: 'tshop'
  design: Design
  assets: Record<
    string,
    { meta: AssetMeta; dataUrl: string; cutoutDataUrl: string | null }
  >
}

export async function exportDesignFile(design: Design): Promise<Blob> {
  const ids = new Set<string>()
  // Embed assets from BOTH design contexts (active + stashed) so a custom
  // garment's images survive a round-trip even when exported from the tee.
  for (const l of [...design.layers, ...design.stashedLayers])
    if (l.type === 'image') ids.add(l.assetId)
  if (design.custom?.front) ids.add(design.custom.front.assetId)
  if (design.custom?.back) ids.add(design.custom.back.assetId)

  const assets: DesignFile['assets'] = {}
  const metas = await listAssets()
  for (const id of ids) {
    const meta = metas.find((a) => a.id === id)
    const dataUrl = await assetToDataUrl(id, 'original')
    if (!meta || !dataUrl) continue
    assets[id] = {
      meta,
      dataUrl,
      cutoutDataUrl: meta.hasCutout ? await assetToDataUrl(id, 'cutout') : null,
    }
  }
  const file: DesignFile = { v: 1, app: 'tshop', design, assets }
  return new Blob([JSON.stringify(file)], { type: 'application/json' })
}

export async function importDesignFile(blob: Blob): Promise<Design> {
  const file = JSON.parse(await blob.text()) as DesignFile
  if (file.app !== 'tshop' || file.v !== 1 || !file.design?.layers)
    throw new Error('Not a Tshop design file')
  for (const [id, a] of Object.entries(file.assets ?? {})) {
    await importAsset({ ...a.meta, id }, a.dataUrl, a.cutoutDataUrl)
  }
  /*
   * A COPY, WITH A FRESH ID, like the share link below (STU-05). « Mes
   * designs » is keyed by design.id, and a file keeps the id it was exported
   * with: reopening last week's export and pressing Enregistrer replaced the
   * library's current version with last week's, silently.
   */
  return migrateDesign({ ...file.design, id: nanoid(10), updatedAt: Date.now() })
}

/**
 * The design « Enregistrer » writes to the library.
 *
 * A basket line opened on the board is a CLONE of the draft and carries the
 * draft's id (STU-05): saving it overwrote the saved design with the line's
 * snapshot. It is saved under the line's own id instead, so the draft's entry
 * is left alone and saving the same line twice updates one entry, not two.
 */
export function designToSave(design: Design, focusedLineId: string | null): Design {
  return focusedLineId ? { ...design, id: focusedLineId } : design
}

// --- boot + autosave -----------------------------------------------------

export function isFirstVisit(): boolean {
  try {
    return !localStorage.getItem(SEEN_KEY)
  } catch {
    return false
  }
}

export function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    /* private mode */
  }
}

let hydrateStarted = false

export async function hydrateStore(): Promise<void> {
  // React StrictMode mounts effects twice in dev: hydrate exactly once.
  if (hydrateStarted) return
  hydrateStarted = true
  const s = useStore.getState()

  // assets + saved designs
  try {
    s.setAssets(await listAssets())
    s.setSavedDesigns(await listSavedMetas())
  } catch {
    s.toast('warn', t('toast.storage_unavailable'))
  }

  // shared design in the URL wins, but never at the cost of the visitor's
  // own autosaved draft, and always as a COPY (fresh id) so saving the
  // shared design can't overwrite a library original with the same id.
  const shared = parseShareHash(location.hash)
  if (shared) {
    try {
      const prev = await get<Design>(CURRENT_KEY)
      if (prev?.layers?.length) {
        s.setSavedDesigns(await renderAndSave(prev))
        s.toast('info', t('toast.draft_saved', { name: prev.name }))
      }
    } catch {
      /* storage unavailable: still load the shared design */
    }
    s.loadDesign({ ...shared, id: nanoid(10), updatedAt: Date.now() })
    /*
     * WRITTEN NOW, NOT ON THE FIRST EDIT (STU-10). The hash is removed just
     * below and autosave only follows a change, so a shared design looked at
     * and not touched was gone on reload, the old draft back in its place,
     * after a toast saying « il est à vous ».
     */
    await set(CURRENT_KEY, useStore.getState().design).catch(() => undefined)
    history.replaceState(null, '', location.pathname + location.search)
    s.toast('ok', t('toast.shared_loaded'))
    s.markHydrated()
    return
  }

  try {
    const saved = await get<Design>(CURRENT_KEY)
    if (saved?.layers) {
      s.loadDesign(saved)
      s.markHydrated()
      return
    }
  } catch {
    /* fall through to sample */
  }

  s.loadDesign(makeSampleDesign())
  if (isFirstVisit()) {
    s.toast('info', t('toast.sample_started'))
    markSeen()
  }
  s.markHydrated()
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null
let boardFlushTimer: ReturnType<typeof setTimeout> | null = null

export function startAutosave(): () => void {
  return useStore.subscribe((state, prev) => {
    if (state.design === prev.design || !state.hydrated) return
    // A FOCUSED basket line is not the user's draft: it round-trips to the
    // basket (startBoardAutosave below), never to tshop:current. Without this
    // guard, opening a board line overwrites their autosaved work and they
    // only find out on the next reload.
    if (state.board.focusedId) {
      // …but the swap may have landed INSIDE the draft's own debounce window,
      // and `prev.design` is then the last thing the user typed. Dropping that
      // pending write silently loses it (a reload while focused would restore a
      // draft up to 700 ms stale), so it is flushed here instead of cancelled.
      if (autosaveTimer && !prev.board.focusedId) {
        clearTimeout(autosaveTimer)
        autosaveTimer = null
        void set(CURRENT_KEY, prev.design).catch(() => undefined)
      }
      return
    }
    if (autosaveTimer) clearTimeout(autosaveTimer)
    autosaveTimer = setTimeout(() => {
      // The focus may have landed INSIDE this debounce window: re-check
      // against live state rather than the state that scheduled the write.
      if (useStore.getState().board.focusedId) return
      set(CURRENT_KEY, useStore.getState().design).catch(() => undefined)
    }, 700)
  })
}

/**
 * The focused basket line's own autosave. `unfocusLine` flushes synchronously
 * and is the authority, but a refresh or a crash mid-focus must not lose the
 * edits either: the app's standing promise is that work is never lost, and
 * this keeps a focused line on the same 700 ms cadence as everything else.
 */
export function startBoardAutosave(): () => void {
  return useStore.subscribe((state, prev) => {
    if (state.design === prev.design || !state.board.focusedId) return
    if (boardFlushTimer) clearTimeout(boardFlushTimer)
    boardFlushTimer = setTimeout(() => useStore.getState().flushFocusedLine(), 700)
  })
}

export async function clearCurrent(): Promise<void> {
  await del(CURRENT_KEY).catch(() => undefined)
}

export { listSavedMetas, renderAndSave }
