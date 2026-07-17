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
  return migrateDesign(file.design)
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
  // React StrictMode mounts effects twice in dev — hydrate exactly once.
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

  // shared design in the URL wins — but never at the cost of the visitor's
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
      /* storage unavailable — still load the shared design */
    }
    s.loadDesign({ ...shared, id: nanoid(10), updatedAt: Date.now() })
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

export function startAutosave(): () => void {
  return useStore.subscribe((state, prev) => {
    if (state.design === prev.design || !state.hydrated) return
    if (autosaveTimer) clearTimeout(autosaveTimer)
    autosaveTimer = setTimeout(() => {
      set(CURRENT_KEY, useStore.getState().design).catch(() => undefined)
    }, 700)
  })
}

export async function clearCurrent(): Promise<void> {
  await del(CURRENT_KEY).catch(() => undefined)
}

export { listSavedMetas, renderAndSave }
