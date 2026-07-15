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
      {/* mobile backdrop */}
      <div
        className="fixed inset-0 z-20 bg-black/45 md:hidden"
        onClick={() => setPanel(null)}
        aria-hidden
      />
      <aside
        aria-label={t('nav.panel_aria', { title: t(TITLES[panel]) })}
        className="absolute left-[60px] top-0 bottom-0 z-30 flex w-[300px] max-w-[calc(100vw-60px)] flex-col border-r border-line bg-bg2 md:static md:z-10"
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3.5">
          <span className="panel-title">{t(TITLES[panel])}</span>
          <button className="iconbtn h-7 w-7 md:hidden" onClick={() => setPanel(null)} aria-label={t('common.close_panel')}>
            <X size={15} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
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
