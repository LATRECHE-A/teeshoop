import clsx from 'clsx'
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

      {/* Side switch: bottom-left on phones (2D only — the 3D view buttons
          already cover front/back), bottom-centre on desktop. */}
      <div
        className={clsx(
          'pointer-events-none absolute bottom-[calc(var(--tsh-nav)+var(--tsh-selbar)+0.75rem)] left-3 z-10 md:bottom-4 md:left-1/2 md:-translate-x-1/2',
          mode === '3d' && 'hidden md:block',
        )}
      >
        <SideSwitcher />
      </div>
    </div>
  )
}
