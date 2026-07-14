/**
 * A1 dev harness — proof sheet for the garment art.
 *
 * Grid: tee + hoodie × front/back × 4 body colors on bg0, print-area outlines
 * toggled on, plus a row overlaying body+shade (multiply) to prove alignment.
 *
 * Single-cell zoom: /dev/garments.html?only=hoodie-front&color=%23C0272D&size=760&shade=1
 */
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles.css'
import { GARMENTS } from '@/garments'
import type { CatalogGarmentId, Side } from '@/lib/types'

const COLORS = ['#FFFFFF', '#191C20', '#C0272D', '#1F2A44'] as const
const VIEWS: { g: CatalogGarmentId; s: Side }[] = [
  { g: 'tee', s: 'front' },
  { g: 'tee', s: 'back' },
  { g: 'hoodie', s: 'front' },
  { g: 'hoodie', s: 'back' },
]

function Cell(props: {
  g: CatalogGarmentId
  s: Side
  color: string
  size: number
  area: boolean
  shade: boolean
  label?: string
}) {
  const { g, s, color, size, area, shade, label } = props
  const art = GARMENTS[g].sides[s]
  const r = art.printAreaPx
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className="relative rounded-lg border border-line/60"
        style={{ width: size, height: size }}
      >
        <div
          className="absolute inset-0 [&>svg]:h-full [&>svg]:w-full"
          dangerouslySetInnerHTML={{
            __html: art.body.replaceAll('__COLOR__', color),
          }}
        />
        {shade && (
          <div
            className="absolute inset-0 [&>svg]:h-full [&>svg]:w-full"
            style={{ mixBlendMode: 'multiply' }}
            dangerouslySetInnerHTML={{ __html: art.shade }}
          />
        )}
        {area && (
          <svg
            viewBox="0 0 800 800"
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            <rect
              x={r.x}
              y={r.y}
              width={r.w}
              height={r.h}
              fill="none"
              stroke="#35C7FF"
              strokeWidth="2.5"
              strokeDasharray="10 7"
              opacity="0.9"
            />
            <path
              d={`M${r.x + r.w / 2 - 14} ${r.y + r.h / 2}h28M${r.x + r.w / 2} ${r.y + r.h / 2 - 14}v28`}
              stroke="#35C7FF"
              strokeWidth="2"
              opacity="0.7"
            />
          </svg>
        )}
      </div>
      <div className="mono-dim">
        {label ?? `${g} · ${s} · ${color}`}
      </div>
    </div>
  )
}

function App() {
  const q = new URLSearchParams(location.search)
  const only = q.get('only')
  const cell = Number(q.get('cell') ?? 300)
  const [areas, setAreas] = useState(q.get('areas') !== '0')
  const [shadeAll, setShadeAll] = useState(q.get('shade') === '1')

  if (only) {
    const [g, s] = only.split('-') as [CatalogGarmentId, Side]
    const size = Number(q.get('size') ?? 760)
    return (
      <main className="min-h-screen overflow-auto bg-bg0 p-6">
        <Cell
          g={g}
          s={s}
          color={q.get('color') ?? '#FFFFFF'}
          size={size}
          area={areas}
          shade={shadeAll}
        />
      </main>
    )
  }

  return (
    <main className="min-h-screen overflow-auto bg-bg0 px-8 py-6">
      <header className="mb-5 flex items-center gap-6">
        <h1 className="font-display text-[15px] font-bold tracking-[0.18em] text-tx2">
          A1 · GARMENT ART — PROOF SHEET
        </h1>
        <label className="mono-dim flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={areas}
            onChange={(e) => setAreas(e.target.checked)}
          />
          print areas
        </label>
        <label className="mono-dim flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={shadeAll}
            onChange={(e) => setShadeAll(e.target.checked)}
          />
          shade × all cells
        </label>
      </header>

      <div className="flex flex-col gap-5">
        {VIEWS.map(({ g, s }) => (
          <div key={`${g}-${s}`} className="flex gap-5">
            {COLORS.map((c) => (
              <Cell
                key={c}
                g={g}
                s={s}
                color={c}
                size={cell}
                area={areas}
                shade={shadeAll}
              />
            ))}
          </div>
        ))}
        <div className="flex gap-5">
          {VIEWS.map(({ g, s }) => (
            <Cell
              key={`sh-${g}-${s}`}
              g={g}
              s={s}
              color="#FFFFFF"
              size={cell}
              area={areas}
              shade
              label={`${g} · ${s} · body+shade (multiply)`}
            />
          ))}
        </div>
      </div>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
