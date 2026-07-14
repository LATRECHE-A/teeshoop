import { useState } from 'react'
import { FilePlus2, FolderDown, Trash2 } from 'lucide-react'
import Modal from './Modal'
import { useStore } from '@/state/store'
import { renderAndSave } from '@/state/persist'
import { deleteSavedDesign, loadSavedDesign } from '@/state/savedDesigns'

function timeAgo(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return new Date(ts).toLocaleDateString()
}

export default function DesignsModal() {
  const design = useStore((s) => s.design)
  const saved = useStore((s) => s.savedDesigns)
  const closeModal = useStore((s) => s.closeModal)
  const loadDesign = useStore((s) => s.loadDesign)
  const newDesign = useStore((s) => s.newDesign)
  const toast = useStore((s) => s.toast)
  const [busy, setBusy] = useState(false)

  const saveCurrent = async () => {
    setBusy(true)
    try {
      useStore.getState().setSavedDesigns(await renderAndSave(design))
      toast('ok', `Saved “${design.name}”`)
    } catch {
      toast('error', 'Could not save — local storage may be full')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="My designs"
      subtitle="Saved on this device — export a design file to move one between devices."
      onClose={() => closeModal('designs')}
      size="lg"
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button className="btn" disabled={busy} onClick={() => void saveCurrent()}>
          <FolderDown size={14} />
          Save current design
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => {
            newDesign()
            closeModal('designs')
            toast('info', 'Fresh canvas — pick a garment and go')
          }}
        >
          <FilePlus2 size={14} />
          Start blank
        </button>
      </div>

      {saved.length === 0 ? (
        <div className="rounded-xl border border-line bg-bg1 p-6 text-center text-[13px] text-tx2">
          Nothing saved yet. “Save current design” keeps a snapshot you can come
          back to any time.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {saved.map((m) => (
            <div key={m.id} className="group overflow-hidden rounded-xl border border-line bg-bg1">
              <button
                className="block w-full"
                onClick={async () => {
                  const d = await loadSavedDesign(m.id)
                  if (!d) {
                    toast('error', 'That design could not be loaded')
                    return
                  }
                  loadDesign(d)
                  closeModal('designs')
                  toast('ok', `Loaded “${m.name}”`)
                }}
              >
                {m.thumb ? (
                  <img src={m.thumb} alt={m.name} className="aspect-square w-full object-contain p-2" />
                ) : (
                  <div className="aspect-square w-full" />
                )}
              </button>
              <div className="flex items-center justify-between gap-1 border-t border-line px-2.5 py-2">
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-medium text-tx">{m.name}</div>
                  <div className="text-[10.5px] text-tx3">{timeAgo(m.updatedAt)}</div>
                </div>
                <button
                  className="iconbtn h-7 w-7 text-dg opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label={`Delete ${m.name}`}
                  onClick={async () => {
                    useStore.getState().setSavedDesigns(await deleteSavedDesign(m.id))
                    toast('info', `Deleted “${m.name}”`)
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
