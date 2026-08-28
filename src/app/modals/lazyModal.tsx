/**
 * The wrapper every lazily-loaded modal shares, extracted from Modals.tsx so
 * the admin slot implementation (src/admin/AdminSlots.tsx) can use it without
 * importing Modals.tsx, which would create a cycle: Modals.tsx already depends
 * on the admin slot context, and that edge must stay one-way.
 */
import { Component, Suspense, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { useStore, type ModalState } from '@/state/store'
import { getLang } from '@/i18n/lang'

// The admin i18n side-files ship inside the admin chunks, so the one string
// this file needs lives here rather than dragging them into any bundle.
const CHUNK_FAILED: Record<'fr' | 'en', string> = {
  fr: 'Cet outil n’a pas pu se charger. Rechargez la page, puis réessayez.',
  en: 'That tool could not load. Reload the page and try again.',
}

/**
 * React.lazy caches a failed chunk load forever (same reason Scene3D.tsx has
 * Retry3DBoundary), and Suspense does not catch errors, so without this a
 * stale tab requesting a purged chunk hash would unmount the whole studio,
 * losing the in-memory design. We close the modal instead: everything else
 * survives and a reload fetches the fresh chunk.
 */
class ModalChunkBoundary extends Component<
  { children: ReactNode; onFail: () => void },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onFail()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

/** Backdrop shown while a chunk downloads (matches Modal.tsx's). */
function ChunkSpinner() {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 backdrop-blur-[2px]">
      <RefreshCw size={28} className="animate-spin text-tx3" />
    </div>
  )
}

export function LazyModal({ modal, children }: { modal: keyof ModalState; children: ReactNode }) {
  return (
    <ModalChunkBoundary
      onFail={() => {
        const { closeModal, toast } = useStore.getState()
        closeModal(modal)
        toast('error', CHUNK_FAILED[getLang()])
      }}
    >
      <Suspense fallback={<ChunkSpinner />}>{children}</Suspense>
    </ModalChunkBoundary>
  )
}
