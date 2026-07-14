import { useEffect, useRef, useState } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignCenterHorizontal,
  AlignCenterVertical,
  ChevronDown,
  Copy,
  FlipHorizontal2,
  Scissors,
  Trash2,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import { useStore } from '@/state/store'
import { FONTS, ensureFont } from '@/lib/fonts'
import { INK_COLORS } from '@/content/palettes'
import type { GraphicLayer, ImageLayer, Layer, TextLayer } from '@/lib/types'
import { fmtIn } from '@/lib/units'
import { measureLayer } from '@/lib/renderDesign'

// ---------------------------------------------------------------- controls

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-tx3">{label}</span>
      {children}
    </div>
  )
}

function Slider({
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number, commit: boolean) => void
  format?: (v: number) => string
}) {
  return (
    <div className="flex items-center gap-2.5">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value), false)}
        onPointerUp={(e) => onChange(Number((e.target as HTMLInputElement).value), true)}
        onKeyUp={(e) => onChange(Number((e.target as HTMLInputElement).value), true)}
      />
      <span className="mono-dim w-14 shrink-0 text-right">
        {format ? format(value) : value}
      </span>
    </div>
  )
}

function ColorSwatches({
  value,
  onPick,
}: {
  value: string
  onPick: (hex: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {INK_COLORS.map((hex) => (
        <button
          key={hex}
          aria-label={`Ink ${hex}`}
          onClick={() => onPick(hex)}
          className={clsx(
            'h-5.5 w-5.5 h-[22px] w-[22px] rounded-full border transition-transform hover:scale-110',
            value.toLowerCase() === hex.toLowerCase()
              ? 'border-cy ring-2 ring-cy/40'
              : 'border-black/40',
          )}
          style={{ backgroundColor: hex }}
        />
      ))}
      <label
        className="relative h-[22px] w-[22px] cursor-pointer overflow-hidden rounded-full border border-line"
        title="Custom color"
        style={{
          background:
            'conic-gradient(#FF3D8F,#FFC940,#3ADC97,#35C7FF,#7B6CFF,#FF3D8F)',
        }}
      >
        <input
          type="color"
          value={value}
          className="absolute inset-0 cursor-pointer opacity-0"
          onChange={(e) => onPick(e.target.value)}
        />
      </label>
    </div>
  )
}

function FontSelect({ value, onPick }: { value: string; onPick: (f: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const current = FONTS.find((f) => f.family === value)

  return (
    <div ref={ref} className="relative">
      <button className="input flex items-center justify-between" onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open}>
        <span style={{ fontFamily: `"${value}"` }} className="text-[15px]">
          {current?.label ?? value}
        </span>
        <ChevronDown size={14} className="text-tx3" />
      </button>
      {open && (
        <ul role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-line bg-bg1 p-1 shadow-xl">
          {FONTS.map((f) => (
            <li key={f.family}>
              <button
                role="option"
                aria-selected={f.family === value}
                className={clsx(
                  'flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left hover:bg-bg3',
                  f.family === value && 'bg-bg3',
                )}
                onClick={() => {
                  void ensureFont(f.family)
                  onPick(f.family)
                  setOpen(false)
                }}
              >
                <span style={{ fontFamily: `"${f.family}"` }} className="text-[16px] text-tx">
                  {f.label}
                </span>
                <span className="text-[9.5px] uppercase tracking-wider text-tx3">{f.category}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ------------------------------------------------------------------- panel

export default function PropertiesPanel() {
  const design = useStore((s) => s.design)
  const selectedId = useStore((s) => s.selectedId)
  const mode = useStore((s) => s.mode)
  const select = useStore((s) => s.select)
  const patchLayer = useStore((s) => s.patchLayer)
  const removeLayer = useStore((s) => s.removeLayer)
  const duplicateLayer = useStore((s) => s.duplicateLayer)
  const setPanel = useStore((s) => s.setPanel)
  const assets = useStore((s) => s.assets)

  const layer = design.layers.find((l) => l.id === selectedId)
  if (!layer || mode !== '2d') return null

  const patch = (p: Partial<Layer>, commit = true) =>
    patchLayer(layer.id, p, { transient: !commit })

  return (
    <aside
      aria-label="Layer properties"
      className="absolute right-3 top-3 bottom-3 z-20 flex w-[264px] flex-col overflow-hidden rounded-xl border border-line bg-bg2/95 shadow-2xl backdrop-blur"
    >
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line pl-3.5 pr-2">
        <span className="panel-title">
          {layer.type === 'text' ? 'Text' : layer.type === 'image' ? 'Image' : 'Graphic'}
        </span>
        <div className="flex items-center">
          <button className="iconbtn h-7 w-7" title="Duplicate (Ctrl+D)" onClick={() => duplicateLayer(layer.id)}>
            <Copy size={13} />
          </button>
          <button className="iconbtn h-7 w-7 text-dg" title="Delete (Del)" onClick={() => removeLayer(layer.id)}>
            <Trash2 size={13} />
          </button>
          <button className="iconbtn h-7 w-7" aria-label="Close" onClick={() => select(null)}>
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3.5">
        {layer.type === 'text' && <TextProps layer={layer} patch={patch} />}
        {layer.type === 'image' && (
          <ImageProps
            layer={layer}
            patch={patch}
            hasCutout={assets.find((a) => a.id === layer.assetId)?.hasCutout ?? false}
            openUploads={() => setPanel('uploads')}
          />
        )}
        {layer.type === 'graphic' && <GraphicProps layer={layer} patch={patch} />}

        <CommonProps layer={layer} patch={patch} />
      </div>
    </aside>
  )
}

function TextProps({
  layer,
  patch,
}: {
  layer: TextLayer
  patch: (p: Partial<TextLayer>, commit?: boolean) => void
}) {
  const curved = Math.abs(layer.curve) >= 2
  return (
    <>
      <Row label="Content">
        <textarea
          className="input h-16 resize-none py-1.5 leading-snug"
          value={layer.text}
          data-autofocus
          onChange={(e) =>
            patch({ text: curved ? e.target.value.replace(/\n/g, ' ') : e.target.value })
          }
        />
      </Row>
      <Row label="Font">
        <FontSelect value={layer.fontFamily} onPick={(fontFamily) => patch({ fontFamily })} />
      </Row>
      <Row label="Size">
        <Slider
          value={layer.fontSizeIn}
          min={0.25}
          max={5}
          step={0.05}
          format={fmtIn}
          onChange={(v, commit) => patch({ fontSizeIn: v }, commit)}
        />
      </Row>
      <Row label="Curve">
        <Slider
          value={layer.curve}
          min={-100}
          max={100}
          step={1}
          format={(v) => (Math.abs(v) < 2 ? 'straight' : `${v}`)}
          onChange={(v, commit) => patch({ curve: Math.abs(v) < 4 ? 0 : v }, commit)}
        />
      </Row>
      <Row label="Ink">
        <ColorSwatches value={layer.fill} onPick={(fill) => patch({ fill })} />
      </Row>
      <Row label="Outline">
        <div className="flex items-center gap-2">
          <ColorSwatchesMini
            value={layer.stroke}
            onPick={(stroke) => patch({ stroke, strokeWidthIn: layer.strokeWidthIn || 0.03 })}
            onClear={() => patch({ stroke: null, strokeWidthIn: 0 })}
          />
        </div>
        {layer.stroke && (
          <Slider
            value={layer.strokeWidthIn}
            min={0.01}
            max={0.12}
            step={0.005}
            format={fmtIn}
            onChange={(v, commit) => patch({ strokeWidthIn: v }, commit)}
          />
        )}
      </Row>
      <Row label="Letter spacing">
        <Slider
          value={layer.letterSpacingEm}
          min={-0.05}
          max={0.6}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v, commit) => patch({ letterSpacingEm: v }, commit)}
        />
      </Row>
      {!curved && layer.text.includes('\n') && (
        <Row label="Alignment">
          <div className="flex gap-1">
            {(
              [
                ['left', AlignLeft],
                ['center', AlignCenter],
                ['right', AlignRight],
              ] as const
            ).map(([al, Icon]) => (
              <button
                key={al}
                className={clsx('iconbtn', layer.align === al && 'bg-bg3 text-cy')}
                aria-label={`Align ${al}`}
                onClick={() => patch({ align: al })}
              >
                <Icon size={15} />
              </button>
            ))}
          </div>
        </Row>
      )}
    </>
  )
}

function ColorSwatchesMini({
  value,
  onPick,
  onClear,
}: {
  value: string | null
  onPick: (hex: string) => void
  onClear: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        onClick={onClear}
        aria-label="No outline"
        title="No outline"
        className={clsx(
          'relative h-[22px] w-[22px] overflow-hidden rounded-full border',
          value === null ? 'border-cy ring-2 ring-cy/40' : 'border-line2',
        )}
      >
        <span className="absolute left-1/2 top-1/2 h-[26px] w-px -translate-x-1/2 -translate-y-1/2 rotate-45 bg-dg" />
      </button>
      {['#111111', '#FFFFFF', '#F2B32C', '#E03A3E', '#2454B5', '#FF3D8F'].map((hex) => (
        <button
          key={hex}
          aria-label={`Outline ${hex}`}
          onClick={() => onPick(hex)}
          className={clsx(
            'h-[22px] w-[22px] rounded-full border transition-transform hover:scale-110',
            value?.toLowerCase() === hex.toLowerCase() ? 'border-cy ring-2 ring-cy/40' : 'border-black/40',
          )}
          style={{ backgroundColor: hex }}
        />
      ))}
    </div>
  )
}

function ImageProps({
  layer,
  patch,
  hasCutout,
  openUploads,
}: {
  layer: ImageLayer
  patch: (p: Partial<ImageLayer>, commit?: boolean) => void
  hasCutout: boolean
  openUploads: () => void
}) {
  return (
    <>
      {hasCutout ? (
        <Row label="Background">
          <div className="flex gap-1">
            <button
              className={clsx('btn h-8 flex-1 text-[12px]', layer.useCutout && 'border-cy text-cy')}
              onClick={() => patch({ useCutout: true })}
            >
              <Scissors size={13} /> Removed
            </button>
            <button
              className={clsx('btn h-8 flex-1 text-[12px]', !layer.useCutout && 'border-cy text-cy')}
              onClick={() => patch({ useCutout: false })}
            >
              Original
            </button>
          </div>
        </Row>
      ) : (
        <div className="rounded-lg border border-line bg-bg1 p-2.5 text-[11.5px] leading-snug text-tx2">
          Want just the subject without its background? Use the{' '}
          <button className="font-semibold text-cy underline-offset-2 hover:underline" onClick={openUploads}>
            scissors button
          </button>{' '}
          on this image in Uploads.
        </div>
      )}
      <Row label="Flip">
        <button
          className={clsx('btn h-8 w-full text-[12px]', layer.flipX && 'border-cy text-cy')}
          onClick={() => patch({ flipX: !layer.flipX })}
        >
          <FlipHorizontal2 size={13} /> Mirror horizontally
        </button>
      </Row>
    </>
  )
}

function GraphicProps({
  layer,
  patch,
}: {
  layer: GraphicLayer
  patch: (p: Partial<GraphicLayer>, commit?: boolean) => void
}) {
  return (
    <>
      <Row label="Ink">
        <ColorSwatches value={layer.fill} onPick={(fill) => patch({ fill })} />
      </Row>
      <Row label="Flip">
        <button
          className={clsx('btn h-8 w-full text-[12px]', layer.flipX && 'border-cy text-cy')}
          onClick={() => patch({ flipX: !layer.flipX })}
        >
          <FlipHorizontal2 size={13} /> Mirror horizontally
        </button>
      </Row>
    </>
  )
}

function CommonProps({
  layer,
  patch,
}: {
  layer: Layer
  patch: (p: Partial<Layer>, commit?: boolean) => void
}) {
  const size = measureLayer(layer, 100)
  return (
    <>
      <Row label="Opacity">
        <Slider
          value={layer.opacity}
          min={0.05}
          max={1}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v, commit) => patch({ opacity: v }, commit)}
        />
      </Row>
      <Row label="Rotation">
        <Slider
          value={layer.rotation}
          min={-180}
          max={180}
          step={1}
          format={(v) => `${Math.round(v)}°`}
          onChange={(v, commit) => patch({ rotation: v }, commit)}
        />
      </Row>
      <Row label="Position">
        <div className="flex gap-1">
          <button className="btn h-8 flex-1 text-[12px]" onClick={() => patch({ xIn: 0 })}>
            <AlignCenterHorizontal size={13} /> Center
          </button>
          <button className="btn h-8 flex-1 text-[12px]" onClick={() => patch({ yIn: 0 })}>
            <AlignCenterVertical size={13} /> Middle
          </button>
        </div>
      </Row>
      <div className="mt-1 rounded-md border border-line bg-bg1 px-2.5 py-2">
        <span className="mono-dim">
          prints at {fmtIn(size.w / 100)} × {fmtIn(size.h / 100)}
        </span>
      </div>
    </>
  )
}
