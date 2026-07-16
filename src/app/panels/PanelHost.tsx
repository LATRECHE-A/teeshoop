import { X } from 'lucide-react'
import { useStore, type PanelId } from '@/state/store'
import { useT } from '@/i18n'
import ProductPanel from './ProductPanel'
import TextPanel from './TextPanel'
import UploadsPanel from './UploadsPanel'
import GraphicsPanel from './GraphicsPanel'
import LayersPanel from './LayersPanel'

const TITLES: Record<PanelId, string> = {
  product: 'panel.product',
  text: 'panel.text',
  uploads: 'panel.uploads',
  graphics: 'panel.graphics',
  layers: 'panel.layers',
}

export default function PanelHost() {
  const t = useT()
  const panel = useStore((s) => s.activePanel)
  const setPanel = useStore((s) => s.setPanel)
  if (!panel) return null

  return (
    <>
      {/* mobile backdrop (below the sheet + bottom nav, above the canvas) */}
      <div
        className="fixed inset-0 z-30 bg-black/45 md:hidden"
        onClick={() => setPanel(null)}
        aria-hidden
      />
      <aside
        aria-label={t('nav.panel_aria', { title: t(TITLES[panel]) })}
        className="sheet-mobile fixed inset-x-0 bottom-[var(--tsh-nav)] z-40 flex max-h-[62dvh] flex-col rounded-t-2xl border border-line bg-bg2 shadow-2xl md:static md:inset-auto md:bottom-auto md:z-10 md:max-h-none md:h-full md:w-[300px] md:rounded-none md:border-0 md:border-r md:shadow-none"
      >
        {/* grab handle (mobile) */}
        <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line2 md:hidden" aria-hidden />
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3.5">
          <span className="panel-title">{t(TITLES[panel])}</span>
          <button className="iconbtn h-8 w-8 md:hidden" onClick={() => setPanel(null)} aria-label={t('common.close_panel')}>
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {panel === 'product' && <ProductPanel />}
          {panel === 'text' && <TextPanel />}
          {panel === 'uploads' && <UploadsPanel />}
          {panel === 'graphics' && <GraphicsPanel />}
          {panel === 'layers' && <LayersPanel />}
        </div>
      </aside>
    </>
  )
}
