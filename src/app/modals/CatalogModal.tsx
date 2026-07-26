/**
 * CATALOGUE FOURNISSEUR — browse the Imbretex blanks and load one into the
 * editor with its real cm measurements.
 *
 * Nothing is duplicated here: the adapter (src/lib/ingest/imbretex.ts) maps the
 * supplier snapshot onto ProductDef and runs the photos through the SAME ingest
 * pipeline as an admin upload, then the product rides the existing custom-
 * garment path (productToCustomGarment → setCustom) so 2D, volumetric 3D and
 * AR all work with no renderer changes.
 */
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ExternalLink, Package, RefreshCw, Search } from 'lucide-react'
import clsx from 'clsx'
import Modal from './Modal'
import { useStore } from '@/state/store'
import { listAssets } from '@/state/assets'
import { fmtCm } from '@/lib/units'
import { SIZE_IDS, type SizeId, type SizeSpecCm } from '@/content/sizeChart'
import { IngestPhotoError } from '@/lib/ingest/pipeline'
import { saveProduct } from '@/lib/ingest/store'
import { productToCustomGarment } from '@/lib/ingest/apply'
import {
  fetchImbretexCatalog,
  imbretexDroppedSizes,
  imbretexPhotoUrl,
  imbretexSizes,
  imbretexSnapshotMeta,
  imbretexSupportsDtf,
  ingestImbretexProduct,
  ImbretexError,
  type ImbretexErrorCode,
  type ImbretexProduct,
} from '@/lib/ingest/imbretex'
import { useCatalogT } from './catalogI18n'

type TFn = ReturnType<typeof useCatalogT>
type Busy = 'front' | 'back'

/** A catalogue entry whose size run overlaps the studio's S–3XL union. */
interface Entry {
  p: ImbretexProduct
  sizes: Partial<Record<SizeId, SizeSpecCm>>
  sizeIds: SizeId[]
  /** Lowercased name + brand + ref, for the search box. */
  haystack: string
}

const swatch = (rgb: [number, number, number]) => `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`

// ---------------------------------------------------------------------------
// Grid card
// ---------------------------------------------------------------------------

function Card({ entry, onPick, t }: { entry: Entry; onPick: () => void; t: TFn }) {
  const { p } = entry
  const photo = imbretexPhotoUrl(p, 'front')
  return (
    <li>
      <button
        onClick={onPick}
        className="flex h-full w-full flex-col gap-1.5 rounded-xl border border-line bg-bg1 p-2 text-left transition-colors hover:border-cy/50"
      >
        {photo ? (
          <img
            src={photo}
            alt={p.name}
            loading="lazy"
            draggable={false}
            className="h-28 w-full rounded-lg bg-bg0 object-contain"
          />
        ) : (
          <span className="flex h-28 w-full items-center justify-center rounded-lg bg-bg0 text-tx3">
            <Package size={18} />
          </span>
        )}
        <span className="truncate text-[10.5px] uppercase tracking-wider text-tx3">
          {p.brand}
        </span>
        <span className="line-clamp-2 text-[12.5px] font-medium leading-snug text-tx">
          {p.name}
        </span>
        <span className="mono-dim text-[10px]">
          {p.supplierRef}
          {p.weightGsm ? ` · ${t('catalog.card.gsm', { g: p.weightGsm })}` : ''}
        </span>
        <span className="mt-auto flex items-center gap-1.5 pt-1">
          {p.colours.slice(0, 6).map((c) => (
            <span
              key={c.id}
              className="h-3 w-3 rounded-full border border-black/30"
              style={{ backgroundColor: swatch(c.rgb) }}
            />
          ))}
          <span className="text-[10px] text-tx3">
            {t('catalog.card.colours', { n: p.colours.length })}
          </span>
        </span>
        <span className="flex items-center justify-between gap-2 text-[10px] text-tx3">
          <span className="font-mono">{entry.sizeIds.join(' · ')}</span>
          {p.rrpEur ? (
            <span className="text-cy">
              {t('catalog.card.rrp', { price: p.rrpEur.toFixed(2) })}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  )
}

// ---------------------------------------------------------------------------
// Detail view (colour + reference size → editor)
// ---------------------------------------------------------------------------

function Detail({
  entry,
  busy,
  onBack,
  onUse,
  t,
}: {
  entry: Entry
  busy: Busy | null
  onBack: () => void
  onUse: (colourId: string, size: SizeId) => void
  t: TFn
}) {
  const { p, sizes, sizeIds } = entry
  // Default to the colourway the photos were shot in — that is what the user
  // actually sees in the preview.
  const [colourId, setColourId] = useState(
    () =>
      p.colours.find((c) => c.id === p.photoColour?.id)?.id ?? p.colours[0]?.id ?? '',
  )
  const [size, setSize] = useState<SizeId>(
    () => sizeIds.find((s) => s === 'M') ?? sizeIds[0],
  )
  const spec = sizes[size]
  const colour = p.colours.find((c) => c.id === colourId) ?? null
  const dropped = imbretexDroppedSizes(p)

  const specRow = (label: string, value: string | null | undefined) =>
    value ? (
      <div className="flex justify-between gap-3 py-0.5">
        <span className="text-tx3">{label}</span>
        <span className="text-right text-tx2">{value}</span>
      </div>
    ) : null

  return (
    <div className="flex flex-col gap-4">
      <button
        className="chip self-start hover:border-cy/50 hover:text-cy"
        disabled={!!busy}
        onClick={onBack}
      >
        <ArrowLeft size={11} /> {t('catalog.back')}
      </button>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex shrink-0 gap-2 sm:w-[240px] sm:flex-col">
          {(['front', 'back'] as const).map((side) => {
            const url = imbretexPhotoUrl(p, side)
            return url ? (
              <img
                key={side}
                src={url}
                alt={`${p.name} — ${side}`}
                draggable={false}
                className={clsx(
                  'w-full rounded-lg bg-bg0 object-contain',
                  side === 'front' ? 'h-44' : 'h-24',
                )}
              />
            ) : null
          })}
          {!p.views?.back?.file && (
            <p className="text-[10.5px] leading-snug text-tx3">{t('catalog.detail.no_back')}</p>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3.5">
          <div>
            <div className="text-[10.5px] uppercase tracking-wider text-tx3">{p.brand}</div>
            <h3 className="font-display text-[15px] font-bold text-tx">{p.name}</h3>
            <div className="mono-dim">{p.supplierRef}</div>
          </div>

          <section>
            <div className="panel-title mb-1.5">
              {t('catalog.detail.colour')}
              {colour && (
                <span className="ml-1.5 normal-case tracking-normal text-tx2">
                  {colour.name}
                  {colour.pantone ? ` · ${colour.pantone}` : ''}
                </span>
              )}
            </div>
            <div className="grid grid-cols-9 gap-1.5">
              {p.colours.map((c) => (
                <button
                  key={c.id}
                  title={c.name}
                  aria-label={c.name}
                  aria-pressed={c.id === colourId}
                  onClick={() => setColourId(c.id)}
                  style={{ backgroundColor: swatch(c.rgb) }}
                  className={clsx(
                    'h-6 w-6 rounded-full border transition-transform hover:scale-110',
                    c.id === colourId ? 'border-cy ring-2 ring-cy/40' : 'border-black/30',
                  )}
                />
              ))}
            </div>
            {p.photoColour && (
              <p className="mt-1.5 text-[10.5px] leading-snug text-tx3">
                {t('catalog.detail.colour_note', { colour: p.photoColour.name })}
              </p>
            )}
          </section>

          <section>
            <div className="panel-title mb-1.5">{t('catalog.detail.size')}</div>
            <div className="flex gap-1">
              {sizeIds.map((s) => (
                <button
                  key={s}
                  onClick={() => setSize(s)}
                  aria-pressed={s === size}
                  className={clsx('btn h-8 flex-1 px-0 text-[11px]', s === size && 'btn-primary')}
                >
                  {s}
                </button>
              ))}
            </div>
            {spec && (
              <div className="mono-dim mt-1.5 text-[10.5px] leading-relaxed text-cy">
                {t('catalog.detail.size_note', {
                  chest: fmtCm(spec.halfChestCm),
                  length: fmtCm(spec.bodyLengthCm),
                })}
                {spec.sleeveLengthCm > 0 && (
                  <>
                    <br />
                    <span className="text-tx3">
                      {t('catalog.detail.sleeve_note', {
                        sleeve: fmtCm(spec.sleeveLengthCm),
                      })}
                    </span>
                  </>
                )}
              </div>
            )}
            {dropped.length > 0 && (
              <p className="mt-1 text-[10.5px] leading-snug text-tx3">
                {t('catalog.detail.sizes_dropped', { list: dropped.join(', ') })}
              </p>
            )}
          </section>

          <section className="rounded-lg border border-line bg-bg1 p-2.5 text-[11px]">
            <div className="panel-title mb-1">{t('catalog.detail.spec')}</div>
            {specRow(t('catalog.detail.weight'), p.weightGsm ? `${p.weightGsm} g/m²` : null)}
            {specRow(t('catalog.detail.material'), p.material)}
            {specRow(t('catalog.detail.gender'), p.gender)}
            {specRow(t('catalog.detail.origin'), p.origin)}
            {specRow(
              t('catalog.detail.marking'),
              p.markingTypes.length > 0 ? p.markingTypes.join(' · ') : null,
            )}
            {specRow(t('catalog.detail.rrp'), p.rrpEur ? `${p.rrpEur.toFixed(2)} €` : null)}
            <p className="mt-1.5 text-[10px] leading-snug text-tx3">
              {t('catalog.detail.rrp_note')}
            </p>
            {p.url && (
              <a
                href={p.url}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-1.5 inline-flex items-center gap-1 text-[10.5px] text-cy hover:underline"
              >
                <ExternalLink size={11} /> {t('catalog.detail.source')}
              </a>
            )}
          </section>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-line pt-4">
        {busy && (
          <span className="flex items-center gap-1.5 text-[11.5px] text-tx2">
            <RefreshCw size={13} className="animate-spin text-cy" /> {t(`catalog.busy.${busy}`)}
          </span>
        )}
        <button
          className="btn btn-primary"
          disabled={!!busy || !spec}
          onClick={() => onUse(colourId, size)}
        >
          {t('catalog.use')}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export default function CatalogModal() {
  const t = useCatalogT()
  const closeModal = useStore((s) => s.closeModal)
  const setCustom = useStore((s) => s.setCustom)
  const setAssets = useStore((s) => s.setAssets)
  const toast = useStore((s) => s.toast)

  const [products, setProducts] = useState<ImbretexProduct[] | null>(null)
  const [loadErr, setLoadErr] = useState<ImbretexErrorCode | null>(null)
  const [q, setQ] = useState('')
  const [dtfOnly, setDtfOnly] = useState(true)
  const [selId, setSelId] = useState<string | null>(null)
  const [busy, setBusy] = useState<Busy | null>(null)

  // The catalogue is cached in-module, so a StrictMode double-mount costs one
  // fetch and both passes settle — no cleanup flag stranding the work.
  useEffect(() => {
    void fetchImbretexCatalog().then(setProducts, (err: unknown) =>
      setLoadErr(err instanceof ImbretexError ? err.code : 'unavailable'),
    )
  }, [])

  /** Only entries with at least one studio-covered size are usable. */
  const entries = useMemo<Entry[]>(() => {
    if (!products) return []
    const out: Entry[] = []
    for (const p of products) {
      const sizes = imbretexSizes(p)
      const sizeIds = SIZE_IDS.filter((id) => sizes[id])
      if (sizeIds.length === 0) continue
      out.push({
        p,
        sizes,
        sizeIds,
        haystack: `${p.name} ${p.brand} ${p.supplierRef}`.toLowerCase(),
      })
    }
    return out
  }, [products])

  const hidden = (products?.length ?? 0) - entries.length

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return entries.filter(
      (e) =>
        (!dtfOnly || imbretexSupportsDtf(e.p)) &&
        (needle === '' || e.haystack.includes(needle)),
    )
  }, [entries, q, dtfOnly])

  const selected = entries.find((e) => e.p.id === selId) ?? null

  const use = async (entry: Entry, colourId: string, size: SizeId) => {
    setBusy('front')
    try {
      const product = await ingestImbretexProduct(entry.p, {
        colourId,
        defaultSize: size,
        onProgress: setBusy,
      })
      await saveProduct(product)
      setAssets(await listAssets())
      setCustom(productToCustomGarment(product, product.defaultSize))
      closeModal('catalog')
      toast(
        'ok',
        t('catalog.toast.applied', { name: product.name, size: product.defaultSize }),
      )
    } catch (err) {
      if (err instanceof ImbretexError) toast('error', t(`catalog.err.${err.code}`))
      else if (err instanceof IngestPhotoError) toast('error', t('catalog.err.photo_rejected'))
      else toast('error', t('catalog.err.generic'))
    } finally {
      setBusy(null)
    }
  }

  const snapshot = imbretexSnapshotMeta()
  const date = snapshot?.scrapedAt ? snapshot.scrapedAt.slice(0, 10) : ''

  return (
    <Modal
      title={t('catalog.title')}
      subtitle={t('catalog.subtitle')}
      onClose={() => closeModal('catalog')}
      size="lg"
    >
      <div className="flex flex-col gap-4">
        <p className="rounded-lg border border-line bg-bg1 p-2.5 text-[11px] leading-snug text-tx3">
          {date ? t('catalog.provenance', { date }) : t('catalog.provenance_nodate')}
        </p>

        {loadErr && (
          <p className="rounded-lg border border-danger/40 bg-danger/10 p-2.5 text-[11.5px] leading-snug text-danger">
            {t(`catalog.err.${loadErr}`)}
          </p>
        )}

        {!products && !loadErr && (
          <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-tx3">
            <RefreshCw size={15} className="animate-spin" /> {t('catalog.loading')}
          </div>
        )}

        {selected ? (
          <Detail
            key={selected.p.id}
            entry={selected}
            busy={busy}
            onBack={() => setSelId(null)}
            onUse={(colourId, size) => void use(selected, colourId, size)}
            t={t}
          />
        ) : (
          products && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <label className="relative flex min-w-[180px] flex-1 items-center">
                  <Search size={13} className="pointer-events-none absolute left-2.5 text-tx3" />
                  <input
                    className="input pl-7"
                    value={q}
                    placeholder={t('catalog.search')}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </label>
                <button
                  className={clsx('chip', dtfOnly ? 'border-cy/60 text-cy' : 'hover:border-line2')}
                  aria-pressed={dtfOnly}
                  onClick={() => setDtfOnly((v) => !v)}
                >
                  {t('catalog.filter_dtf')}
                </button>
                <span className="mono-dim">{t('catalog.count', { n: shown.length })}</span>
              </div>

              {shown.length === 0 ? (
                <p className="py-8 text-center text-[12px] text-tx3">{t('catalog.empty')}</p>
              ) : (
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {shown.map((e) => (
                    <Card key={e.p.id} entry={e} onPick={() => setSelId(e.p.id)} t={t} />
                  ))}
                </ul>
              )}

              {hidden > 0 && (
                <p className="text-[10.5px] leading-snug text-tx3">
                  {t('catalog.hidden_sizes', { n: hidden })}
                </p>
              )}
            </>
          )
        )}
      </div>
    </Modal>
  )
}
