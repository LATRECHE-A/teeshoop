import { FolderOpen, Redo2, Save, Share2, Undo2 } from 'lucide-react'
import { Brand } from './Brand'
import ModeToggle from './ModeToggle'
import ThemeToggle from './ThemeToggle'
import LangToggle from './LangToggle'
import { redo, undo, useHistoryDepth, useStore } from '@/state/store'
import { renderAndSave } from '@/state/persist'
import { useT } from '@/i18n'

export default function TopBar() {
  const design = useStore((s) => s.design)
  const renameDesign = useStore((s) => s.renameDesign)
  const openModal = useStore((s) => s.openModal)
  const toast = useStore((s) => s.toast)
  const { canUndo, canRedo } = useHistoryDepth()
  const t = useT()

  const saveNow = async () => {
    try {
      useStore.getState().setSavedDesigns(await renderAndSave(design))
      toast('ok', t('toast.saved', { name: design.name }))
    } catch {
      toast('error', t('toast.save_failed'))
    }
  }

  return (
    <header className="z-30 flex h-14 shrink-0 items-center gap-1.5 border-b border-line bg-bg1 px-3 sm:gap-3 sm:px-4">
      <Brand />

      <div className="mx-1 hidden h-6 w-px bg-line md:block" />

      <input
        aria-label={t('topbar.design_name')}
        className="hidden h-8 w-44 rounded-md border border-transparent bg-transparent px-2 text-[13px] font-medium text-tx2 transition-colors placeholder:text-tx3 hover:border-line focus:border-line focus:text-tx md:block"
        value={design.name}
        onChange={(e) => renameDesign(e.target.value)}
        onBlur={(e) => !e.target.value.trim() && renameDesign(t('topbar.untitled'))}
      />

      <div className="flex items-center gap-0.5 sm:ml-1">
        <button className="iconbtn" aria-label={t('topbar.undo')} title={t('topbar.undo_hint')} disabled={!canUndo} onClick={() => undo()}>
          <Undo2 size={16} className={canUndo ? '' : 'opacity-35'} />
        </button>
        <button className="iconbtn hidden sm:inline-flex" aria-label={t('topbar.redo')} title={t('topbar.redo_hint')} disabled={!canRedo} onClick={() => redo()}>
          <Redo2 size={16} className={canRedo ? '' : 'opacity-35'} />
        </button>
      </div>

      {/* Center cluster: 2D/3D toggle, plus theme + language (desktop). */}
      <div className="flex flex-1 items-center justify-center gap-2.5">
        <ModeToggle />
        <div className="hidden items-center gap-1.5 sm:flex">
          <ThemeToggle />
          <LangToggle />
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <button className="btn btn-ghost hidden sm:inline-flex" onClick={() => openModal('designs')}>
          <FolderOpen size={15} />
          <span className="hidden lg:inline">{t('topbar.my_designs')}</span>
        </button>
        <button className="btn btn-ghost hidden sm:inline-flex" onClick={saveNow} aria-label={t('topbar.save_design')}>
          <Save size={15} />
          <span className="hidden lg:inline">{t('common.save')}</span>
        </button>
        <button className="btn" onClick={() => openModal('share')}>
          <Share2 size={15} />
          <span className="hidden sm:inline">{t('topbar.share_export')}</span>
        </button>
        <button className="btn btn-primary" onClick={() => openModal('order')}>
          {t('topbar.continue')}
          <span aria-hidden>→</span>
        </button>
      </div>
    </header>
  )
}
