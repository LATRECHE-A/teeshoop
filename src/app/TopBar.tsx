import { useState } from 'react'
import { FolderOpen, Layers, LayoutGrid, PackagePlus, Redo2, Save, Share2, ShoppingBag, Undo2, Wrench, X } from 'lucide-react'
import { Brand } from './Brand'
import ModeToggle from './ModeToggle'
import ThemeToggle from './ThemeToggle'
import LangToggle from './LangToggle'
import { redo, undo, useHistoryDepth, useStore } from '@/state/store'
import { renderAndSave } from '@/state/persist'
import { useT } from '@/i18n'
import { useBasketT } from './modals/basketI18n'
import { useBoardT } from './board/boardI18n'

export default function TopBar() {
  const design = useStore((s) => s.design)
  const renameDesign = useStore((s) => s.renameDesign)
  const openModal = useStore((s) => s.openModal)
  const toast = useStore((s) => s.toast)
  // Garments in the basket (quantity-weighted) — the badge count.
  const basketCount = useStore((s) => s.basket.reduce((n, l) => n + l.qty, 0))
  const { canUndo, canRedo } = useHistoryDepth()
  const boardOn = useStore((s) => s.board.on)
  const exitBoard = useStore((s) => s.exitBoard)
  const [adminOpen, setAdminOpen] = useState(false)
  const t = useT()
  const bt = useBasketT()
  const bdt = useBoardT()

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

      {/* Board indicator. The board owns its own toolbar, so this stays a chip:
          it exists so the app chrome never lies about which document the tools
          apply to, not as a second exit. Icon-only below 2xl: this bar already
          wraps "Partager & exporter" at 1440 with nothing added to it. */}
      {boardOn && (
        <button
          className="hidden items-center gap-1.5 rounded-full border border-cy/40 bg-cy/10 px-2 py-1 text-[11.5px] font-medium text-cy transition-colors hover:bg-cy/20 sm:flex"
          onClick={exitBoard}
          aria-label={bdt('board.exit')}
          title={bdt('board.exit')}
        >
          <LayoutGrid size={13} />
          <span className="hidden 2xl:inline">{bdt('board.title')}</span>
          <X size={12} className="opacity-70" />
        </button>
      )}

      {/* Center cluster: 2D/3D toggle, plus theme + language (desktop). */}
      <div className="flex flex-1 items-center justify-center gap-2.5">
        <ModeToggle />
        <div className="hidden items-center gap-1.5 sm:flex">
          <ThemeToggle />
          <LangToggle />
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        {/* Admin tools: DTF gang sheets + product ingest (desktop only) */}
        <div className="relative hidden sm:block">
          <button
            className="iconbtn"
            aria-label={t('admin.menu')}
            aria-expanded={adminOpen}
            title={t('admin.menu')}
            onClick={() => setAdminOpen((v) => !v)}
          >
            <Wrench size={15} />
          </button>
          {adminOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setAdminOpen(false)} />
              <div className="absolute right-0 top-10 z-40 w-56 rounded-lg border border-line bg-bg1 p-1 shadow-xl">
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] text-tx transition-colors hover:bg-bg3"
                  onClick={() => {
                    setAdminOpen(false)
                    openModal('dtf')
                  }}
                >
                  <Layers size={14} className="text-cy" />
                  {t('admin.dtf')}
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] text-tx transition-colors hover:bg-bg3"
                  onClick={() => {
                    setAdminOpen(false)
                    openModal('adminIngest')
                  }}
                >
                  <PackagePlus size={14} className="text-cy" />
                  {t('admin.products')}
                </button>
              </div>
            </>
          )}
        </div>
        <button className="btn btn-ghost hidden sm:inline-flex" onClick={() => openModal('designs')}>
          <FolderOpen size={15} />
          <span className="hidden lg:inline">{t('topbar.my_designs')}</span>
        </button>
        <button className="btn btn-ghost hidden sm:inline-flex" onClick={saveNow} aria-label={t('topbar.save_design')}>
          <Save size={15} />
          <span className="hidden lg:inline">{t('common.save')}</span>
        </button>
        <button
          className="btn btn-ghost relative"
          onClick={() => openModal('basket')}
          aria-label={bt('basket.open')}
          title={basketCount > 0 ? bt('basket.count', { n: basketCount }) : bt('basket.open')}
        >
          <ShoppingBag size={15} />
          <span className="hidden lg:inline">{bt('basket.title')}</span>
          {basketCount > 0 && (
            <span className="absolute -right-1 -top-1 min-w-[16px] rounded-full bg-cy px-1 text-center text-[10px] font-bold leading-4 text-bg0">
              {basketCount > 99 ? '99+' : basketCount}
            </span>
          )}
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
