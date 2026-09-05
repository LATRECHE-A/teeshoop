/**
 * The CUSTOMER modal set.
 *
 * Admin tooling (supplier catalogue, DTF gang sheets, product ingest) is NOT
 * listed here and is not importable from this file: it is rendered through
 * `useAdminSlots().modals`, which only the admin entry fills. See
 * src/app/adminSlots.tsx for why that is a build-time seam rather than a role
 * check.
 */
import { lazy } from 'react'
import { useStore } from '@/state/store'
import { useAdminSlots } from '@/app/adminSlots'
import { LazyModal } from './lazyModal'
import DesignsModal from './DesignsModal'
import ShareModal from './ShareModal'
import ShortcutsModal from './ShortcutsModal'
import ArModal from './ArModal'

// CustomSetupModal reaches three.js through @/lib/silhouette, so importing it
// eagerly put 1.1 MB of WebGL on every visitor's first paint for a feature most
// never open. Lazy here is purely about load time: the module is customer code.
const CustomSetupModal = lazy(() => import('./CustomSetupModal'))
const BasketModal = lazy(() => import('./BasketModal'))
// The shop basket. Lazy for the same reason as the two above and no other: it
// is customer code, and most visits are to the standalone studio where the
// bridge never connects and this never opens.

export default function Modals() {
  const modals = useStore((s) => s.modals)
  const admin = useAdminSlots()

  return (
    <>
      {modals.customSetup && (
        <LazyModal modal="customSetup">
          <CustomSetupModal />
        </LazyModal>
      )}
      {modals.share && <ShareModal />}
      {modals.designs && <DesignsModal />}
      {modals.shortcuts && <ShortcutsModal />}
      {modals.ar && <ArModal />}
      {modals.basket && (
        <LazyModal modal="basket">
          <BasketModal />
        </LazyModal>
      )}
      {admin.modals}
    </>
  )
}
