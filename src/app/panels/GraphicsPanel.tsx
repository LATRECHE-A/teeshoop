import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { Search } from 'lucide-react'
import { GRAPHIC_CATEGORIES, GRAPHICS } from '@/content/graphics'
import { useStore } from '@/state/store'
import { useT } from '@/i18n'

export default function GraphicsPanel() {
  const t = useT()
  const [cat, setCat] = useState<string>(GRAPHIC_CATEGORIES[0]?.id ?? 'badges')
  const [q, setQ] = useState('')
  const addGraphicLayer = useStore((s) => s.addGraphicLayer)

  const items = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (query)
      return GRAPHICS.filter((g) => g.name.toLowerCase().includes(query))
    return GRAPHICS.filter((g) => g.category === cat)
  }, [cat, q])

  return (
    <div className="flex flex-col gap-3 p-3.5">
      <label className="relative block">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-tx3" />
        <input
          className="input pl-8"
          placeholder={t('graphics.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>

      {!q && (
        <div className="flex flex-wrap gap-1">
          {GRAPHIC_CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCat(c.id)}
              className={clsx('chip transition-colors', cat === c.id && 'border-cy/50 bg-cy/10 text-cy')}
            >
              {t('graphics.cat_' + c.id)}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-4 gap-1.5">
        {items.map((g) => (
          <button
            key={g.id}
            title={g.name}
            onClick={() => addGraphicLayer(g.id)}
            className="flex aspect-square items-center justify-center rounded-lg border border-line bg-bg1 p-2 text-tx2 transition-colors hover:border-cy/60 hover:bg-bg3 [&_svg]:h-full [&_svg]:w-full"
            dangerouslySetInnerHTML={{ __html: g.svg('currentColor') }}
          />
        ))}
        {items.length === 0 && (
          <div className="col-span-4 rounded-lg border border-line bg-bg1 p-3 text-center text-[12px] text-tx3">
            {t('graphics.empty', { q })}
          </div>
        )}
      </div>
    </div>
  )
}
