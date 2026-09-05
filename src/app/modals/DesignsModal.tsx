import { useState } from 'react'
import { FilePlus2, FolderDown, Trash2 } from 'lucide-react'
import Modal from './Modal'
import { useStore } from '@/state/store'
import { renderAndSave } from '@/state/persist'
import { deleteSavedDesign, loadSavedDesign } from '@/state/savedDesigns'
import { type TParams } from '@/i18n'
import { useT } from '@/i18n/useT'

function timeAgo(ts: number, t: (key: string, params?: TParams) => string): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return t('designs.time_just_now')
  const m = Math.round(s / 60)
  if (m < 60) return t('designs.time_min_ago', { m })
  const h = Math.round(m / 60)
  if (h < 24) return t('designs.time_hours_ago', { h })
  return new Date(ts).toLocaleDateString()
}

export default function DesignsModal() {
  const design = useStore((s) => s.design)
  const saved = useStore((s) => s.savedDesigns)
  const closeModal = useStore((s) => s.closeModal)
  const loadDesign = useStore((s) => s.loadDesign)
  const newDesign = useStore((s) => s.newDesign)
  const toast = useStore((s) => s.toast)
  const t = useT()
  const [busy, setBusy] = useState(false)

  const saveCurrent = async () => {
    setBusy(true)
    try {
      useStore.getState().setSavedDesigns(await renderAndSave(design))
      toast('ok', t('toast.saved_name', { name: design.name }))
    } catch {
      toast('error', t('toast.save_failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('designs.title')}
      subtitle={t('designs.subtitle')}
      onClose={() => closeModal('designs')}
      size="lg"
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button className="btn" disabled={busy} onClick={() => void saveCurrent()}>
          <FolderDown size={14} />
          {t('designs.save_current')}
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => {
            newDesign()
            closeModal('designs')
            toast('info', t('toast.fresh_canvas'))
          }}
        >
          <FilePlus2 size={14} />
          {t('designs.start_blank')}
        </button>
      </div>

      {saved.length === 0 ? (
        <div className="rounded-xl border border-line bg-bg1 p-6 text-center text-[13px] text-tx2">
          {t('designs.empty')}
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
                    toast('error', t('toast.load_failed'))
                    return
                  }
                  loadDesign(d)
                  closeModal('designs')
                  toast('ok', t('toast.loaded_name', { name: m.name }))
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
                  <div className="text-[10.5px] text-tx3">{timeAgo(m.updatedAt, t)}</div>
                </div>
                <button
                  className="iconbtn h-7 w-7 text-dg opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label={t('designs.delete_name', { name: m.name })}
                  onClick={async () => {
                    useStore.getState().setSavedDesigns(await deleteSavedDesign(m.id))
                    toast('info', t('toast.deleted_name', { name: m.name }))
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
