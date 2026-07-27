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
  Pencil,
  Scissors,
  Trash2,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import { useStore } from '@/state/store'
import { FONTS, ensureFont } from '@/lib/fonts'
import { INK_COLORS } from '@/content/palettes'
import { zonesFor } from '@/content/zones'
import type { GraphicLayer, ImageLayer, Layer, TextLayer } from '@/lib/types'
import { fmtCm, fmtIn, inToCm } from '@/lib/units'
import { measureLayer } from '@/lib/renderDesign'
import { printScaleK, scaleLayer } from '@/lib/printScale'
import { useIsMobile } from './hooks/useIsMobile'
import { useT } from '@/i18n'

/**
 * "on size X" suffix for the physical-size readout. `messages.ts` is owned by
 * the i18n integrator, so this literal lives here — French first, English
 * fallback. See the report for the key to merge.
 */
const ON_SIZE = { fr: 'sur la taille', en: 'on size' } as const

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
  const t = useT()
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {INK_COLORS.map((hex) => (
        <button
          key={hex}
          aria-label={t('props.ink_swatch', { hex })}
          onClick={() => onPick(hex)}
          className={clsx(
            'h-[22px] w-[22px] rounded-full border transition-transform hover:scale-110',
            value.toLowerCase() === hex.toLowerCase()
              ? 'border-cy ring-2 ring-cy/40'
              : 'border-black/40',
          )}
          style={{ backgroundColor: hex }}
        />
      ))}
      <label
        className="relative h-[22px] w-[22px] cursor-pointer overflow-hidden rounded-full border border-line"
        title={t('props.custom_color')}
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
  const t = useT()
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
                <span className="text-[9.5px] uppercase tracking-wider text-tx3">{t('props.font_cat_' + f.category)}</span>
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
  const activePanel = useStore((s) => s.activePanel)
  const propsExpanded = useStore((s) => s.propsExpanded)
  const setPropsExpanded = useStore((s) => s.setPropsExpanded)
  const dragging = useStore((s) => s.dragging)
  const assets = useStore((s) => s.assets)
  // Browsing the board: nothing is selected and nothing may be, so the
  // selection UI (and its reserved mobile strip) must stay out of the way.
  const boardBrowsing = useStore((s) => s.board.on && !s.board.focusedId)
  const isMobile = useIsMobile()
  const t = useT()

  const layer = design.layers.find((l) => l.id === selectedId)

  // The compact mobile bar reserves --tsh-selbar so floating HUDs lift above it.
  const barVisible =
    isMobile && !!layer && mode === '2d' && !activePanel && !dragging && !propsExpanded && !boardBrowsing
  useEffect(() => {
    document.documentElement.classList.toggle('has-selbar', barVisible)
    return () => document.documentElement.classList.remove('has-selbar')
  }, [barVisible])

  if (!layer || mode !== '2d' || boardBrowsing) return null
  // On mobile only one bottom sheet at a time: a tool panel takes precedence.
  if (isMobile && activePanel) return null
  // While a layer is being dragged on mobile, hide the sheet entirely so the
  // object stays visible and movable — the fix for "the panel blocks the move".
  if (isMobile && dragging) return null

  const patch = (p: Partial<Layer>, commit = true) =>
    patchLayer(layer.id, p, { transient: !commit })

  const typeLabel =
    layer.type === 'text' ? t('props.type_text') : layer.type === 'image' ? t('props.type_image') : t('props.type_graphic')

  // COLLAPSED: a slim selection action bar (Canva-style) that never covers the
  // object. Drag on the canvas to move it; tap "Edit" to open the full sheet.
  if (isMobile && !propsExpanded) {
    return (
      <aside
        aria-label={t('props.layer_props')}
        className="sheet-mobile fixed inset-x-0 bottom-[var(--tsh-nav)] z-40 flex h-[3.25rem] items-center gap-1 border-t border-line bg-bg2/95 px-2 shadow-2xl backdrop-blur"
      >
        <span className="panel-title min-w-0 flex-1 truncate pl-1">{typeLabel}</span>
        <button className="btn btn-primary h-8 px-3 text-[12px]" onClick={() => setPropsExpanded(true)}>
          <Pencil size={13} /> {t('props.edit')}
        </button>
        <button className="iconbtn h-8 w-8" title={t('props.duplicate_hint')} onClick={() => duplicateLayer(layer.id)}>
          <Copy size={14} />
        </button>
        <button className="iconbtn h-8 w-8 text-dg" title={t('props.delete_hint')} onClick={() => removeLayer(layer.id)}>
          <Trash2 size={14} />
        </button>
        <button className="iconbtn h-8 w-8" aria-label={t('common.close')} onClick={() => select(null)}>
          <X size={15} />
        </button>
      </aside>
    )
  }

  // EXPANDED mobile sheet, or the desktop docked panel (md: styles).
  return (
    <aside
      aria-label={t('props.layer_props')}
      className="sheet-mobile fixed inset-x-0 bottom-[var(--tsh-nav)] z-40 flex max-h-[64dvh] flex-col overflow-hidden rounded-t-2xl border border-line bg-bg2/95 shadow-2xl backdrop-blur md:absolute md:inset-x-auto md:bottom-3 md:right-3 md:top-3 md:z-20 md:max-h-none md:w-[264px] md:rounded-xl"
    >
      <button
        type="button"
        className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line2 md:hidden"
        aria-label={t('props.done')}
        onClick={() => setPropsExpanded(false)}
      />
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line pl-3.5 pr-2">
        <span className="panel-title">{typeLabel}</span>
        <div className="flex items-center">
          <button
            className="iconbtn h-7 w-7 md:hidden"
            aria-label={t('props.done')}
            title={t('props.done')}
            onClick={() => setPropsExpanded(false)}
          >
            <ChevronDown size={16} />
          </button>
          <button className="iconbtn h-7 w-7" title={t('props.duplicate_hint')} onClick={() => duplicateLayer(layer.id)}>
            <Copy size={13} />
          </button>
          <button className="iconbtn h-7 w-7 text-dg" title={t('props.delete_hint')} onClick={() => removeLayer(layer.id)}>
            <Trash2 size={13} />
          </button>
          <button className="iconbtn h-7 w-7" aria-label={t('common.close')} onClick={() => select(null)}>
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
  const t = useT()
  const curved = Math.abs(layer.curve) >= 2
  return (
    <>
      <Row label={t('props.content')}>
        <textarea
          className="input h-16 resize-none py-1.5 leading-snug"
          value={layer.text}
          data-autofocus
          onChange={(e) =>
            patch({ text: curved ? e.target.value.replace(/\n/g, ' ') : e.target.value })
          }
        />
      </Row>
      <Row label={t('props.font')}>
        <FontSelect value={layer.fontFamily} onPick={(fontFamily) => patch({ fontFamily })} />
      </Row>
      <Row label={t('props.size')}>
        <Slider
          value={layer.fontSizeIn}
          min={0.25}
          max={5}
          step={0.05}
          format={fmtIn}
          onChange={(v, commit) => patch({ fontSizeIn: v }, commit)}
        />
      </Row>
      <Row label={t('props.curve')}>
        <Slider
          value={layer.curve}
          min={-100}
          max={100}
          step={1}
          format={(v) => (Math.abs(v) < 2 ? t('props.straight') : `${v}`)}
          onChange={(v, commit) => patch({ curve: Math.abs(v) < 4 ? 0 : v }, commit)}
        />
      </Row>
      <Row label={t('props.ink')}>
        <ColorSwatches value={layer.fill} onPick={(fill) => patch({ fill })} />
      </Row>
      <Row label={t('props.outline')}>
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
      <Row label={t('props.letter_spacing')}>
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
        <Row label={t('props.alignment')}>
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
                aria-label={t('props.align_' + al)}
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
  const t = useT()
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        onClick={onClear}
        aria-label={t('props.no_outline')}
        title={t('props.no_outline')}
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
          aria-label={t('props.outline_swatch', { hex })}
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
  const t = useT()
  return (
    <>
      {hasCutout ? (
        <Row label={t('props.background')}>
          <div className="flex gap-1">
            <button
              className={clsx('btn h-8 flex-1 text-[12px]', layer.useCutout && 'border-cy text-cy')}
              onClick={() => patch({ useCutout: true })}
            >
              <Scissors size={13} /> {t('props.bg_removed')}
            </button>
            <button
              className={clsx('btn h-8 flex-1 text-[12px]', !layer.useCutout && 'border-cy text-cy')}
              onClick={() => patch({ useCutout: false })}
            >
              {t('props.bg_original')}
            </button>
          </div>
        </Row>
      ) : (
        <div className="rounded-lg border border-line bg-bg1 p-2.5 text-[11.5px] leading-snug text-tx2">
          {t('props.cutout_hint_pre')}{' '}
          <button className="font-semibold text-cy underline-offset-2 hover:underline" onClick={openUploads}>
            {t('props.cutout_hint_link')}
          </button>{' '}
          {t('props.cutout_hint_post')}
        </div>
      )}
      <Row label={t('props.flip')}>
        <button
          className={clsx('btn h-8 w-full text-[12px]', layer.flipX && 'border-cy text-cy')}
          onClick={() => patch({ flipX: !layer.flipX })}
        >
          <FlipHorizontal2 size={13} /> {t('props.mirror_h')}
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
  const t = useT()
  return (
    <>
      <Row label={t('props.ink')}>
        <ColorSwatches value={layer.fill} onPick={(fill) => patch({ fill })} />
      </Row>
      <Row label={t('props.flip')}>
        <button
          className={clsx('btn h-8 w-full text-[12px]', layer.flipX && 'border-cy text-cy')}
          onClick={() => patch({ flipX: !layer.flipX })}
        >
          <FlipHorizontal2 size={13} /> {t('props.mirror_h')}
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
  const t = useT()
  const design = useStore((s) => s.design)
  const placeInZone = useStore((s) => s.placeInZone)
  const showGuides = useStore((s) => s.showGuides)
  const toggleGuides = useStore((s) => s.toggleGuides)
  const previewSize = useStore((s) => s.previewSize)
  const lang = useStore((s) => s.lang)
  const zones = zonesFor(design, layer.side)
  // The stored geometry is base-space; what the customer receives is that
  // geometry graded to the previewed size. Show the PHYSICAL result — the whole
  // point of grading is invisible if this readout stays at the base value.
  // (Read-only: nothing here writes back, so base space is untouched.)
  const size = measureLayer(scaleLayer(layer, printScaleK(design, previewSize)), 100)
  return (
    <>
      <Row label={t('props.opacity')}>
        <Slider
          value={layer.opacity}
          min={0.05}
          max={1}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v, commit) => patch({ opacity: v }, commit)}
        />
      </Row>
      <Row label={t('props.rotation')}>
        <Slider
          value={layer.rotation}
          min={-180}
          max={180}
          step={1}
          format={(v) => `${Math.round(v)}°`}
          onChange={(v, commit) => patch({ rotation: v }, commit)}
        />
      </Row>
      <Row label={t('props.position')}>
        <div className="flex gap-1">
          <button className="btn h-8 flex-1 text-[12px]" onClick={() => patch({ xIn: 0 })}>
            <AlignCenterHorizontal size={13} /> {t('props.center')}
          </button>
          <button className="btn h-8 flex-1 text-[12px]" onClick={() => patch({ yIn: 0 })}>
            <AlignCenterVertical size={13} /> {t('props.middle')}
          </button>
        </div>
      </Row>
      <Row label={t('props.place_zone')}>
        <div className="flex flex-wrap gap-1.5">
          {zones.map((z) => (
            <button
              key={z.id}
              className={clsx(
                'chip px-2.5 transition-colors hover:border-cy hover:text-cy',
                z.standard && 'border-cy/50 text-cy',
              )}
              title={t('props.place_zone_hint')}
              onClick={() => placeInZone(z.id)}
            >
              {z.standard ? `★ ${t(z.nameKey)}` : t(z.nameKey)}
            </button>
          ))}
        </div>
        <button
          className="mt-0.5 self-start text-[10.5px] text-tx3 underline-offset-2 hover:text-cy hover:underline"
          onClick={toggleGuides}
        >
          {showGuides ? t('props.hide_guides') : t('props.show_guides')}
        </button>
      </Row>
      <div className="mt-1 rounded-md border border-line bg-bg1 px-2.5 py-2">
        <span className="mono-dim">
          {t('props.prints_at', {
            w: `${fmtCm(inToCm(size.w / 100))} (${fmtIn(size.w / 100)})`,
            h: `${fmtCm(inToCm(size.h / 100))} (${fmtIn(size.h / 100)})`,
          })}{' '}
          <span className="text-cy">
            {(ON_SIZE[lang] ?? ON_SIZE.fr)} {previewSize}
          </span>
        </span>
      </div>
    </>
  )
}
