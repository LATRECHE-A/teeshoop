import { useEffect } from 'react'
import { useStore } from '@/state/store'
import { hydrateStore, startAutosave } from '@/state/persist'
import TopBar from './TopBar'
import LeftRail from './LeftRail'
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
    const stop = startAutosave()
    return stop
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
      <Toasts />
      <Modals />
    </div>
  )
}
