import { FolderOpen, Redo2, Save, Share2, Undo2 } from 'lucide-react'
import { Brand } from './Brand'
import ModeToggle from './ModeToggle'
import { redo, undo, useHistoryDepth, useStore } from '@/state/store'
import { renderAndSave } from '@/state/persist'

export default function TopBar() {
  const design = useStore((s) => s.design)
  const renameDesign = useStore((s) => s.renameDesign)
  const openModal = useStore((s) => s.openModal)
  const toast = useStore((s) => s.toast)
  const { canUndo, canRedo } = useHistoryDepth()

  const saveNow = async () => {
    try {
      useStore.getState().setSavedDesigns(await renderAndSave(design))
      toast('ok', `Saved “${design.name}” to your designs`)
    } catch {
      toast('error', 'Could not save — local storage may be full')
    }
  }

  return (
    <header className="z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-bg1 px-3 sm:px-4">
      <Brand />

      <div className="mx-1 hidden h-6 w-px bg-line md:block" />

      <input
        aria-label="Design name"
        className="hidden h-8 w-44 rounded-md border border-transparent bg-transparent px-2 text-[13px] font-medium text-tx2 transition-colors placeholder:text-tx3 hover:border-line focus:border-line focus:text-tx md:block"
        value={design.name}
        onChange={(e) => renameDesign(e.target.value)}
        onBlur={(e) => !e.target.value.trim() && renameDesign('Untitled design')}
      />

      <div className="ml-1 hidden items-center gap-0.5 sm:flex">
        <button className="iconbtn" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => undo()}>
          <Undo2 size={16} className={canUndo ? '' : 'opacity-35'} />
        </button>
        <button className="iconbtn" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => redo()}>
          <Redo2 size={16} className={canRedo ? '' : 'opacity-35'} />
        </button>
      </div>

      <div className="flex flex-1 justify-center">
        <ModeToggle />
      </div>

      <div className="flex items-center gap-1.5">
        <button className="btn btn-ghost hidden sm:inline-flex" onClick={() => openModal('designs')}>
          <FolderOpen size={15} />
          <span className="hidden lg:inline">My designs</span>
        </button>
        <button className="btn btn-ghost" onClick={saveNow} aria-label="Save design">
          <Save size={15} />
          <span className="hidden lg:inline">Save</span>
        </button>
        <button className="btn" onClick={() => openModal('share')}>
          <Share2 size={15} />
          <span className="hidden sm:inline">Share & export</span>
        </button>
        <button className="btn btn-primary" onClick={() => openModal('order')}>
          Continue
          <span aria-hidden>→</span>
        </button>
      </div>
    </header>
  )
}
