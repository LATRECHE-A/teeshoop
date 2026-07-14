/** Saved-designs library (IndexedDB). */
import { get, set, del } from 'idb-keyval'
import type { Design, SavedDesignMeta } from '@/lib/types'
import { renderThumbnail } from '@/lib/renderDesign'

const INDEX_KEY = 'tshop:designs:index'
const designKey = (id: string) => `tshop:design:${id}`

export async function listSavedMetas(): Promise<SavedDesignMeta[]> {
  return (await get<SavedDesignMeta[]>(INDEX_KEY)) ?? []
}

async function writeIndex(index: SavedDesignMeta[]): Promise<SavedDesignMeta[]> {
  await set(INDEX_KEY, index)
  return index
}

/** Save (or overwrite by id) with a fresh thumbnail. */
export async function renderAndSave(design: Design): Promise<SavedDesignMeta[]> {
  const thumb = await renderThumbnail(design).catch(() => '')
  const meta: SavedDesignMeta = {
    id: design.id,
    name: design.name,
    garmentId: design.garmentId,
    updatedAt: Date.now(),
    thumb,
  }
  await set(designKey(design.id), design)
  const index = await listSavedMetas()
  const next = [meta, ...index.filter((m) => m.id !== design.id)]
  return writeIndex(next)
}

export async function loadSavedDesign(id: string): Promise<Design | undefined> {
  return get<Design>(designKey(id))
}

export async function deleteSavedDesign(id: string): Promise<SavedDesignMeta[]> {
  await del(designKey(id))
  const index = await listSavedMetas()
  return writeIndex(index.filter((m) => m.id !== id))
}
