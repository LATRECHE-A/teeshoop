import { useStore } from '@/state/store'
import EditorCanvas from './EditorCanvas'
import Scene3D from './Scene3D'
import SideSwitcher from './SideSwitcher'
import ScenePicker from './ScenePicker'

export default function CenterStage() {
  const mode = useStore((s) => s.mode)

  return (
    <div className="absolute inset-0 overflow-hidden">
      {mode === '2d' ? <EditorCanvas /> : <Scene3D />}

      {/* Scene / environment picker — available in both preview modes. */}
      <div className="absolute left-3 top-3 z-10">
        <ScenePicker />
      </div>

      <div className="pointer-events-none absolute bottom-16 left-1/2 z-10 -translate-x-1/2 sm:bottom-4">
        <SideSwitcher />
      </div>
    </div>
  )
}
