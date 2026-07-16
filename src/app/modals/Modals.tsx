import { useStore } from '@/state/store'
import CustomSetupModal from './CustomSetupModal'
import DesignsModal from './DesignsModal'
import OrderModal from './OrderModal'
import ShareModal from './ShareModal'
import ShortcutsModal from './ShortcutsModal'
import ArModal from './ArModal'

export default function Modals() {
  const modals = useStore((s) => s.modals)
  return (
    <>
      {modals.customSetup && <CustomSetupModal />}
      {modals.order && <OrderModal />}
      {modals.share && <ShareModal />}
      {modals.designs && <DesignsModal />}
      {modals.shortcuts && <ShortcutsModal />}
      {modals.ar && <ArModal />}
    </>
  )
}
