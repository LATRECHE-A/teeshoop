import clsx from 'clsx'
import { useStore } from '@/state/store'
import EditorCanvas from './EditorCanvas'
import Scene3D from './Scene3D'
import Board3DStage from './Board3DStage'
import BoardStage2D from './board/BoardStage2D'
import BoardBar from './board/BoardBar'
import SideSwitcher from './SideSwitcher'
import ScenePicker from './ScenePicker'

/**
 * The stage routes on two axes: 2D/3D, and board/single. A focused board line
 * IS the live design, so the focused case falls straight through to the normal
 * editor and the normal 3D preview. That is the whole reason board mode needs
 * no second editor.
 */
export default function CenterStage() {
  const mode = useStore((s) => s.mode)
  const boardOn = useStore((s) => s.board.on)
  const focusedId = useStore((s) => s.board.focusedId)
  const showingBoard = boardOn && !focusedId

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      {/* A real flow element, not an overlay: the board's chrome must never sit
          on top of the stage controls it shares an edge with. */}
      {boardOn && <BoardBar />}

      <div className="relative min-h-0 flex-1">
        {showingBoard ? (
          mode === '2d' ? (
            <BoardStage2D />
          ) : (
            <Board3DStage />
          )
        ) : mode === '2d' ? (
          <EditorCanvas />
        ) : (
          <Scene3D />
        )}

        {/* Scene / environment picker, available in every preview mode. */}
        <div className="absolute left-3 top-3 z-10">
          <ScenePicker />
        </div>

        {/* Side switch: bottom-left on phones (2D only: the 3D view buttons
            already cover front/back), bottom-centre on desktop. Meaningless on
            the board, where every product shows its own printed side. */}
        {!showingBoard && (
          <div
            className={clsx(
              'pointer-events-none absolute bottom-[calc(var(--tsh-nav)+var(--tsh-selbar)+0.75rem)] left-3 z-10 md:bottom-4 md:left-1/2 md:-translate-x-1/2',
              mode === '3d' && 'hidden md:block',
            )}
          >
            <SideSwitcher />
          </div>
        )}
      </div>
    </div>
  )
}
