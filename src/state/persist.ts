/**
 * Persistence: autosave to IndexedDB, saved-designs library, design-file
 * export/import (with embedded images), and share links for image-free
 * designs (compressed into the URL hash).
 */
import { get, set, del } from 'idb-keyval'
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import type { AssetMeta, Design, SavedDesignMeta } from '@/lib/types'
import { useStore } from './store'
import { assetToDataUrl, importAsset, listAssets } from './assets'
import { listSavedMetas, renderAndSave } from './savedDesigns'
import { makeSampleDesign } from '@/content/sampleDesign'

const CURRENT_KEY = 'tshop:current'
const SEEN_KEY = 'tshop:seen'

// --- share links ---------------------------------------------------------

export function canShareAsLink(design: Design): boolean {
  return (
    design.garmentId !== 'custom' &&
    design.layers.every((l) => l.type !== 'image')
  )
}

export function designToShareHash(design: Design): string {
  const payload = { v: 1, design: { ...design, custom: null } }
  return `#d=${compressToEncodedURIComponent(JSON.stringify(payload))}`
}

export function parseShareHash(hash: string): Design | null {
  const m = /^#d=(.+)$/.exec(hash)
  if (!m) return null
  try {
    const json = decompressFromEncodedURIComponent(m[1])
    if (!json) return null
    const payload = JSON.parse(json)
    if (payload?.v !== 1 || !payload.design?.layers) return null
    return payload.design as Design
  } catch {
    return null
  }
}

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
  for (const l of design.layers) if (l.type === 'image') ids.add(l.assetId)
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
  return file.design
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
    s.toast('warn', 'Local storage is unavailable — designs will not persist')
  }

  // shared design in the URL wins
  const shared = parseShareHash(location.hash)
  if (shared) {
    s.loadDesign({ ...shared, id: shared.id || 'shared', updatedAt: Date.now() })
    history.replaceState(null, '', location.pathname + location.search)
    s.toast('ok', 'Shared design loaded — it is yours to edit now')
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
    s.toast('info', 'We started you off with a sample — make it yours')
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
