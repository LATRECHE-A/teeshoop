/**
 * DTF dev harness — mounts the admin DtfModal against the real store (the
 * sample design provides printed sides) and exposes the pure nesting engine
 * on window.__dtf for scripts/dtf-verify.mjs, which runs its geometry
 * assertions in-page and screenshots the modal.
 */
import ReactDOM from 'react-dom/client'
import '@/styles.css'
import DtfModal from '@/app/modals/DtfModal'
import { nest, type DtfPiece, type NestOptions, type NestResult } from '@/lib/dtf/nesting'
import { estimateCost, loadSuppliers, type CostEstimate } from '@/lib/dtf/suppliers'
import { useStore } from '@/state/store'

declare global {
  interface Window {
    __dtf: {
      nest: (pieces: DtfPiece[], options: NestOptions) => NestResult
      estimate: (supplierId: string, lm: number) => CostEstimate | null
      /** True once the modal preview has at least one sheet canvas drawn. */
      previewReady: () => boolean
    }
  }
}

window.__dtf = {
  nest,
  estimate: (supplierId, lm) => {
    const p = loadSuppliers().find((s) => s.id === supplierId)
    return p ? estimateCost(p, lm) : null
  },
  previewReady: () => {
    const els = document.querySelectorAll<HTMLCanvasElement>('canvas[data-dtf="sheet-canvas"]')
    if (els.length === 0) return false
    for (const el of els) if (el.width < 4 || el.height < 4) return false
    return true
  },
}

// The modal closes via the store; keep it force-open for the harness.
useStore.setState((s) => ({ modals: { ...s.modals, dtf: true } }))

function Harness() {
  const open = useStore((s) => s.modals.dtf)
  return (
    <div className="min-h-screen bg-bg0">
      {open ? (
        <DtfModal />
      ) : (
        <button
          className="btn m-6"
          onClick={() =>
            useStore.setState((s) => ({ modals: { ...s.modals, dtf: true } }))
          }
        >
          Reopen DTF modal
        </button>
      )}
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Harness />)
