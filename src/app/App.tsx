import { useEffect } from 'react'
import { useStore } from '@/state/store'
import { hydrateStore, startAutosave, startBoardAutosave } from '@/state/persist'
import TopBar from './TopBar'
import LeftRail from './LeftRail'
import BottomNav from './BottomNav'
import PanelHost from './panels/PanelHost'
import CenterStage from './CenterStage'
import PropertiesPanel from './PropertiesPanel'
import Toasts from './Toasts'
import Modals from './modals/Modals'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'

export default function App() {
  const hydrated = useStore((s) => s.hydrated)
  useKeyboardShortcuts()

  useEffect(() => {
    void hydrateStore()
    const stopAutosave = startAutosave()
    const stopBoardAutosave = startBoardAutosave()
    return () => {
      stopAutosave()
      stopBoardAutosave()
    }
  }, [])

  return (
    <div className="flex h-full flex-col bg-bg1">
      <TopBar />
      <div className="relative flex min-h-0 flex-1">
        <LeftRail />
        <PanelHost />
        <main className="relative min-w-0 flex-1">
          {hydrated && <CenterStage />}
          <PropertiesPanel />
        </main>
      </div>
      <BottomNav />
      <Toasts />
      <Modals />
    </div>
  )
}
