import { Component, lazy, Suspense, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { useStore } from '@/state/store'
import { getLang } from '@/i18n/lang'
import CustomSetupModal from './CustomSetupModal'
import DesignsModal from './DesignsModal'
import OrderModal from './OrderModal'
import ShareModal from './ShareModal'
import ShortcutsModal from './ShortcutsModal'
import ArModal from './ArModal'

// Admin tooling — and the order/catalogue tools, which drag in the basket and
// supplier-catalogue code paths — stay out of the first paint until opened.
const BasketModal = lazy(() => import('./BasketModal'))
const CatalogModal = lazy(() => import('./CatalogModal'))
const DtfModal = lazy(() => import('./DtfModal'))
const AdminIngestModal = lazy(() => import('./AdminIngestModal'))

// The admin i18n side-files ship inside those chunks, so the one string this
// file needs lives here rather than dragging them into the customer bundle.
const CHUNK_FAILED: Record<'fr' | 'en', string> = {
  fr: 'Cet outil n’a pas pu se charger — rechargez la page puis réessayez',
  en: 'That tool could not load — reload the page and try again',
}

/**
 * React.lazy caches a failed chunk load forever (same reason Scene3D.tsx has
 * Retry3DBoundary) — and Suspense does not catch errors, so without this a
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

/** Backdrop shown while an admin chunk downloads (matches Modal.tsx's). */
function ChunkSpinner() {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 backdrop-blur-[2px]">
      <RefreshCw size={28} className="animate-spin text-tx3" />
    </div>
  )
}

export default function Modals() {
  const modals = useStore((s) => s.modals)
  const closeModal = useStore((s) => s.closeModal)
  const toast = useStore((s) => s.toast)

  const lazyModal = (
    key: 'basket' | 'catalog' | 'dtf' | 'adminIngest',
    node: ReactNode,
  ) => (
    <ModalChunkBoundary
      onFail={() => {
        closeModal(key)
        toast('error', CHUNK_FAILED[getLang()])
      }}
    >
      <Suspense fallback={<ChunkSpinner />}>{node}</Suspense>
    </ModalChunkBoundary>
  )

  return (
    <>
      {modals.customSetup && <CustomSetupModal />}
      {modals.order && <OrderModal />}
      {modals.share && <ShareModal />}
      {modals.designs && <DesignsModal />}
      {modals.shortcuts && <ShortcutsModal />}
      {modals.ar && <ArModal />}
      {modals.basket && lazyModal('basket', <BasketModal />)}
      {modals.catalog && lazyModal('catalog', <CatalogModal />)}
      {modals.dtf && lazyModal('dtf', <DtfModal />)}
      {modals.adminIngest && lazyModal('adminIngest', <AdminIngestModal />)}
    </>
  )
}
