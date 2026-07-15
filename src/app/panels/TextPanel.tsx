import { useState } from 'react'
import clsx from 'clsx'
import { Plus } from 'lucide-react'
import { FONTS } from '@/lib/fonts'
import { useStore } from '@/state/store'
import { useT } from '@/i18n'
import type { TextLayer } from '@/lib/types'

const CATEGORIES = ['all', 'block', 'display', 'script', 'retro'] as const

export default function TextPanel() {
  const t = useT()
  const [cat, setCat] = useState<string>('all')
  const addTextLayer = useStore((s) => s.addTextLayer)
  const patchLayer = useStore((s) => s.patchLayer)
  const design = useStore((s) => s.design)
  const selectedId = useStore((s) => s.selectedId)
  const selected = design.layers.find(
    (l): l is TextLayer => l.id === selectedId && l.type === 'text',
  )

  const fonts = FONTS.filter((f) => cat === 'all' || f.category === cat)

  const pickFont = (family: string) => {
    if (selected) {
      patchLayer(selected.id, { fontFamily: family })
      return
    }
    // No text selected: create one *in the clicked font*.
    addTextLayer()
    const newId = useStore.getState().selectedId
    if (newId) patchLayer(newId, { fontFamily: family })
  }

  return (
    <div className="flex flex-col gap-4 p-3.5">
      <button className="btn w-full justify-center border-cy/40 bg-cy/10 text-cy hover:bg-cy/15" onClick={() => addTextLayer()}>
        <Plus size={15} />
        {t('text.add_text')}
      </button>

      {selected && (
        <div className="rounded-md border border-line bg-bg1 px-2.5 py-2 text-[11.5px] text-tx2">
          {t('text.restyle_pre')}{' '}
          <span className="font-semibold text-tx">{t('text.restyle_name', { name: selected.name })}</span>
          {t('text.restyle_post')}
        </div>
      )}

      <section>
        <div className="mb-2 flex flex-wrap gap-1">
          {CATEGORIES.map((id) => (
            <button
              key={id}
              onClick={() => setCat(id)}
              className={clsx(
                'chip transition-colors',
                cat === id && 'border-cy/50 bg-cy/10 text-cy',
              )}
            >
              {t(`text.cat_${id}`)}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          {fonts.map((f) => (
            <button
              key={f.family}
              onClick={() => pickFont(f.family)}
              className={clsx(
                'group flex h-12 items-center justify-between rounded-lg border border-line bg-bg1 px-3 transition-colors hover:border-line2 hover:bg-bg3',
                selected?.fontFamily === f.family && 'border-cy',
              )}
            >
              <span
                className="text-[19px] leading-none text-tx"
                style={{ fontFamily: `"${f.family}"` }}
              >
                {f.label}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-tx3">
                {t(`text.tag_${f.category}`)}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
