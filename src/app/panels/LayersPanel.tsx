import { ChevronDown, ChevronUp, Copy, Image, Shapes, Trash2, Type } from 'lucide-react'
import clsx from 'clsx'
import { useStore } from '@/state/store'
import type { Layer } from '@/lib/types'

const ICONS = { text: Type, image: Image, graphic: Shapes } as const

function label(layer: Layer): string {
  if (layer.type === 'text') {
    const flat = layer.text.replace(/\n/g, ' ').trim()
    return flat.length > 22 ? `${flat.slice(0, 22)}…` : flat || layer.name
  }
  return layer.name
}

export default function LayersPanel() {
  const design = useStore((s) => s.design)
  const side = useStore((s) => s.activeSide)
  const selectedId = useStore((s) => s.selectedId)
  const select = useStore((s) => s.select)
  const removeLayer = useStore((s) => s.removeLayer)
  const duplicateLayer = useStore((s) => s.duplicateLayer)
  const moveLayer = useStore((s) => s.moveLayer)

  // top of the list = front-most print element
  const layers = design.layers.filter((l) => l.side === side).reverse()
  const other = design.layers.filter((l) => l.side !== side).length

  return (
    <div className="flex flex-col gap-2 p-3.5">
      <div className="panel-title">
        {side} · {layers.length} layer{layers.length === 1 ? '' : 's'}
      </div>

      {layers.length === 0 && (
        <div className="rounded-lg border border-line bg-bg1 p-3 text-[12px] leading-relaxed text-tx2">
          This side is blank. Add text, upload an image, or drop in a graphic —
          then stack and reorder everything here.
        </div>
      )}

      <ul className="flex flex-col gap-1">
        {layers.map((layer, i) => {
          const Icon = ICONS[layer.type]
          const active = layer.id === selectedId
          return (
            <li key={layer.id}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => select(layer.id)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && select(layer.id)}
                className={clsx(
                  'group flex h-10 cursor-pointer items-center gap-2 rounded-lg border px-2 transition-colors',
                  active ? 'border-cy bg-bg3' : 'border-line bg-bg1 hover:border-line2',
                )}
              >
                <Icon size={14} className={active ? 'text-cy' : 'text-tx3'} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-tx">{label(layer)}</span>
                <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    className="iconbtn h-6 w-6"
                    title="Bring forward"
                    aria-label="Bring forward"
                    disabled={i === 0}
                    onClick={(e) => {
                      e.stopPropagation()
                      moveLayer(layer.id, 'up')
                    }}
                  >
                    <ChevronUp size={13} className={i === 0 ? 'opacity-30' : ''} />
                  </button>
                  <button
                    className="iconbtn h-6 w-6"
                    title="Send backward"
                    aria-label="Send backward"
                    disabled={i === layers.length - 1}
                    onClick={(e) => {
                      e.stopPropagation()
                      moveLayer(layer.id, 'down')
                    }}
                  >
                    <ChevronDown size={13} className={i === layers.length - 1 ? 'opacity-30' : ''} />
                  </button>
                  <button
                    className="iconbtn h-6 w-6"
                    title="Duplicate"
                    aria-label="Duplicate layer"
                    onClick={(e) => {
                      e.stopPropagation()
                      duplicateLayer(layer.id)
                    }}
                  >
                    <Copy size={12} />
                  </button>
                  <button
                    className="iconbtn h-6 w-6 text-dg"
                    title="Delete"
                    aria-label="Delete layer"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeLayer(layer.id)
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </span>
              </div>
            </li>
          )
        })}
      </ul>

      {other > 0 && (
        <div className="mt-1 text-[11px] text-tx3">
          {other} layer{other === 1 ? '' : 's'} on the other side — switch sides
          below the canvas to edit.
        </div>
      )}
    </div>
  )
}
