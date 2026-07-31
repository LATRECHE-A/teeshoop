/**
 * CATALOGUE FOURNISSEUR — browse supplier blanks and load one into the editor
 * with a per-size cm table.
 *
 * TWO SOURCES, ONE PIPELINE:
 *  - FALK&ROSS (default) — the live webservice, read through our Worker
 *    (/api/fr/*, see worker/falkross.ts). Real prices, real stock, ~2350
 *    styles, and NO published measurements, so its size tables are reference-
 *    chart ESTIMATES that this UI is required to show and let you override
 *    before importing. See src/lib/ingest/falkross.ts.
 *  - IMBRETEX (secondary, offline) — the committed snapshot of their public
 *    catalogue. Real published measurements, no live prices or stock. Kept
 *    reachable and clearly labelled: it is the fallback when the API is down,
 *    and the only source with supplier-measured tables.
 *
 * Nothing is duplicated below the adapters: both map onto ProductDef and run
 * the photos through the SAME ingest pipeline as an admin upload, then the
 * product rides the existing custom-garment path (productToCustomGarment →
 * setCustom) so 2D, volumetric 3D and AR all work with no renderer changes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ExternalLink,
  FileText,
  FlaskConical,
  Package,
  Pencil,
  RefreshCw,
  Ruler,
  Search,
  Sparkles,
} from 'lucide-react'
import clsx from 'clsx'
import Modal from './Modal'
import { useStore } from '@/state/store'
import { listAssets } from '@/state/assets'
import { fmtCm } from '@/lib/units'
import { SIZE_IDS, type SizeId, type SizeSpecCm } from '@/content/sizeChart'
import { IngestPhotoError, parseSizeTable } from '@/lib/ingest/pipeline'
import { saveProduct } from '@/lib/ingest/store'
import { productToCustomGarment } from '@/lib/ingest/apply'
import {
  fetchImbretexCatalog,
  imbretexBackSource,
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
import {
  falkrossBackSource,
  falkrossFrontUrl,
  falkrossSizes,
  fetchFalkRossPrices,
  fetchFalkRossState,
  fetchFalkRossStock,
  fetchFalkRossStyle,
  fetchFalkRossStyles,
  ingestFalkRossProduct,
  FalkRossError,
  type FalkRossCard,
  type FalkRossErrorCode,
  type FalkRossPage,
  type FalkRossPrices,
  type FalkRossStock,
  type FalkRossStyle,
  type FalkRossWsState,
} from '@/lib/ingest/falkross'
import { useCatalogT } from './catalogI18n'

type TFn = ReturnType<typeof useCatalogT>
type Busy = 'front' | 'back' | 'generate'
type Source = 'falkross' | 'imbretex'

const swatch = (rgb: [number, number, number]) => `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`

// ===========================================================================
// FALK&ROSS
// ===========================================================================

/**
 * Compact per-size cm editor. Shown only when the admin asks to correct an
 * estimate, and every edit re-stamps the table `'manual'` — an estimate the
 * user has taken responsibility for is no longer an estimate.
 */
function SizeOverride({
  sizes,
  onChange,
  onReset,
  notify,
  t,
}: {
  sizes: Partial<Record<SizeId, SizeSpecCm>>
  onChange: (next: Partial<Record<SizeId, SizeSpecCm>>) => void
  onReset: () => void
  notify: (kind: 'ok' | 'warn', msg: string) => void
  t: TFn
}) {
  const covered = SIZE_IDS.filter((s) => sizes[s])
  const patch = (size: SizeId, field: keyof SizeSpecCm, v: number) => {
    const spec = sizes[size]
    if (!spec) return
    onChange({ ...sizes, [size]: { ...spec, [field]: v } })
  }
  return (
    <div
      tabIndex={0}
      onPaste={(e) => {
        const text = e.clipboardData.getData('text')
        if (!text) return
        e.preventDefault()
        const parsed = parseSizeTable(text)
        const n = Object.keys(parsed).length
        if (n === 0) {
          notify('warn', t('catalog.fr.sizes.paste_empty'))
          return
        }
        // Only rows for sizes this style actually sells — pasting a full chart
        // must not invent a size the supplier does not stock.
        const next = { ...sizes }
        for (const [k, spec] of Object.entries(parsed)) {
          if (next[k as SizeId]) next[k as SizeId] = spec
        }
        onChange(next)
        notify('ok', t('catalog.fr.sizes.pasted', { n }))
      }}
      className="mt-2 rounded-lg border border-line bg-bg0 p-2 outline-none focus-visible:outline-2 focus-visible:outline-cy/40"
    >
      <div className="grid grid-cols-[auto_1fr_1fr_1fr] items-center gap-x-2 gap-y-1">
        <span className="text-[10px] uppercase tracking-wider text-tx3">
          {t('catalog.fr.sizes.size')}
        </span>
        {(['chest', 'body', 'sleeve'] as const).map((k) => (
          <span key={k} className="text-right text-[10px] uppercase tracking-wider text-tx3">
            {t(`catalog.fr.sizes.${k}`)}
          </span>
        ))}
        {covered.map((size) => (
          <FragmentSizeRow
            key={size}
            size={size}
            spec={sizes[size]!}
            onPatch={(field, v) => patch(size, field, v)}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-[10px] leading-snug text-tx3">{t('catalog.fr.sizes.paste_hint')}</p>
        <button className="chip shrink-0 hover:border-cy/50 hover:text-cy" onClick={onReset}>
          {t('catalog.fr.sizes.reset')}
        </button>
      </div>
    </div>
  )
}

function FragmentSizeRow({
  size,
  spec,
  onPatch,
}: {
  size: SizeId
  spec: SizeSpecCm
  onPatch: (field: keyof SizeSpecCm, v: number) => void
}) {
  const cell = (field: keyof SizeSpecCm) => (
    <input
      key={field}
      type="number"
      step={0.5}
      min={0}
      value={spec[field]}
      onChange={(e) => onPatch(field, parseFloat(e.target.value.replace(',', '.')) || 0)}
      className="input h-7 px-1.5 text-right font-mono text-[11.5px]"
    />
  )
  return (
    <>
      <span className="font-mono text-[11px] text-tx2">{size}</span>
      {cell('halfChestCm')}
      {cell('bodyLengthCm')}
      {cell('sleeveLengthCm')}
    </>
  )
}

function FrCard({
  card,
  sizeIds,
  onPick,
  t,
}: {
  card: FalkRossCard
  sizeIds: SizeId[]
  onPick: () => void
  t: TFn
}) {
  return (
    <li>
      <button
        onClick={onPick}
        className="flex h-full w-full flex-col gap-1.5 rounded-xl border border-line bg-bg1 p-2 text-left transition-colors hover:border-cy/50"
      >
        {card.thumb ? (
          <img
            src={card.thumb}
            alt={card.name}
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
          {card.brand}
        </span>
        <span className="line-clamp-2 text-[12.5px] font-medium leading-snug text-tx">
          {card.name}
        </span>
        <span className="mono-dim text-[10px]">{card.supplierRef || card.styleNr}</span>
        {/* Every F&R table is an estimate, so the badge belongs in the GRID —
            not three clicks in, after someone has already chosen. */}
        <span className="w-fit rounded-full border border-yl/40 bg-yl/10 px-1.5 py-px text-[9.5px] font-medium text-yl">
          {t('catalog.fr.badge.estimated')}
        </span>
        <span className="mt-auto flex items-center justify-between gap-2 pt-1 text-[10px] text-tx3">
          <span className="font-mono">{sizeIds.join(' · ')}</span>
          <span>{t('catalog.card.colours', { n: card.colourCount })}</span>
        </span>
      </button>
    </li>
  )
}

function FrDetail({
  style,
  prices,
  stock,
  busy,
  onBack,
  onUse,
  notify,
  t,
}: {
  style: FalkRossStyle | null
  prices: FalkRossPrices | null
  stock: FalkRossStock | null
  busy: Busy | null
  onBack: () => void
  onUse: (colourCode: string, size: SizeId, sizes?: Partial<Record<SizeId, SizeSpecCm>>) => void
  notify: (kind: 'ok' | 'warn', msg: string) => void
  t: TFn
}) {
  const derived = useMemo(() => (style ? falkrossSizes(style) : null), [style])
  const [override, setOverride] = useState<Partial<Record<SizeId, SizeSpecCm>> | null>(null)
  const [editing, setEditing] = useState(false)
  const [colourCode, setColourCode] = useState('')
  const [size, setSize] = useState<SizeId | null>(null)

  // The style arrives after the card, so the colour/size defaults settle once
  // it lands rather than being guessed from the grid row.
  useEffect(() => {
    if (!style) return
    setColourCode(
      (style.backColour && style.colourways.find((c) => c.code === style.backColour)?.code) ??
        style.colourways[0]?.code ??
        '',
    )
    setOverride(null)
    setEditing(false)
  }, [style])

  const sizes = override ?? derived?.sizes ?? {}
  const sizeIds = SIZE_IDS.filter((s) => sizes[s])
  const effSize = size && sizes[size] ? size : (sizeIds.find((s) => s === 'M') ?? sizeIds[0] ?? null)
  const spec = effSize ? sizes[effSize] : undefined
  const colour = style?.colourways.find((c) => c.code === colourCode) ?? null
  const backSource = style ? falkrossBackSource(style, colourCode) : 'generated'
  const sku = colour && effSize ? findSku(colour.skus, effSize) : null
  const price = sku ? prices?.prices[sku] : undefined
  const qty = sku ? stock?.stock[sku] : undefined

  if (!style || !derived) {
    return (
      <div className="flex flex-col gap-4">
        <button className="chip self-start" onClick={onBack}>
          <ArrowLeft size={11} /> {t('catalog.back')}
        </button>
        <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-tx3">
          <RefreshCw size={15} className="animate-spin" /> {t('catalog.loading')}
        </div>
      </div>
    )
  }

  const frontUrl = falkrossFrontUrl(style, colourCode)
  const specRow = (label: string, value: string | null | undefined) =>
    value ? (
      <div className="flex justify-between gap-3 py-0.5">
        <span className="text-tx3">{label}</span>
        <span className="text-right text-tx2">{value}</span>
      </div>
    ) : null

  return (
    <div className="flex flex-col gap-4">
      <button className="chip self-start hover:border-cy/50 hover:text-cy" disabled={!!busy} onClick={onBack}>
        <ArrowLeft size={11} /> {t('catalog.back')}
      </button>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex shrink-0 gap-2 sm:w-[240px] sm:flex-col">
          {frontUrl && (
            <span className="block w-full self-start sm:self-auto">
              <img
                src={frontUrl}
                alt={`${style.name} — face`}
                draggable={false}
                className="h-44 w-full rounded-lg bg-bg0 object-contain"
              />
            </span>
          )}
          {backSource === 'real' && style.back ? (
            <span className="block w-full self-start sm:self-auto">
              <img
                src={style.back}
                alt={`${style.name} — dos`}
                draggable={false}
                className="h-24 w-full rounded-lg bg-bg0 object-contain"
              />
            </span>
          ) : (
            <div className="rounded-lg border border-yl/40 bg-yl/10 p-2 text-[10.5px] leading-snug text-tx2">
              <span className="flex items-center gap-1 font-medium text-yl">
                <Sparkles size={11} /> {t('catalog.card.back_generated')}
              </span>
              <p className="mt-1">
                {t(
                  style.hasBack
                    ? 'catalog.fr.back.wrong_colour'
                    : 'catalog.fr.back.none',
                )}
              </p>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3.5">
          <div>
            <div className="text-[10.5px] uppercase tracking-wider text-tx3">{style.brand}</div>
            <h3 className="font-display text-[15px] font-bold text-tx">{style.name}</h3>
            <div className="mono-dim">
              {style.supplierRef} · {style.styleNr}
            </div>
          </div>

          <section>
            <div className="panel-title mb-1.5">
              {t('catalog.detail.colour')}
              {colour && (
                <span className="ml-1.5 normal-case tracking-normal text-tx2">{colour.name}</span>
              )}
            </div>
            <div className="grid grid-cols-9 gap-1.5">
              {style.colourways.map((c) => (
                <button
                  key={c.code}
                  title={c.name}
                  aria-label={c.name}
                  aria-pressed={c.code === colourCode}
                  onClick={() => setColourCode(c.code)}
                  className={clsx(
                    'h-6 w-6 overflow-hidden rounded-full border transition-transform hover:scale-110',
                    c.code === colourCode ? 'border-cy ring-2 ring-cy/40' : 'border-black/30',
                  )}
                >
                  {/* This feed publishes no hex — the swatch IS an image. */}
                  {c.swatch ? (
                    <img src={c.swatch} alt="" draggable={false} className="h-full w-full object-cover" />
                  ) : null}
                </button>
              ))}
            </div>
          </section>

          {/* ---- the estimate, stated before anyone can import it ---- */}
          <section className="rounded-lg border border-yl/40 bg-yl/10 p-2.5">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-yl">
              <Ruler size={12} />
              {t('catalog.fr.sizes.title', {
                profile: t(`catalog.fr.profile.${derived.profile}`),
              })}
            </div>
            <p className="mt-1 text-[10.5px] leading-snug text-tx2">
              {t(override ? 'catalog.fr.sizes.manual_note' : 'catalog.fr.sizes.estimate_note')}
            </p>

            <div className="mt-2 flex gap-1">
              {sizeIds.map((s) => (
                <button
                  key={s}
                  onClick={() => setSize(s)}
                  aria-pressed={s === effSize}
                  className={clsx('btn h-8 flex-1 px-0 text-[11px]', s === effSize && 'btn-primary')}
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
                      {t('catalog.detail.sleeve_note_generic', {
                        sleeve: fmtCm(spec.sleeveLengthCm),
                      })}
                    </span>
                  </>
                )}
              </div>
            )}
            {derived.dropped.length > 0 && (
              <p className="mt-1 text-[10.5px] leading-snug text-tx3">
                {t('catalog.detail.sizes_dropped', { list: derived.dropped.join(', ') })}
              </p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button
                className="chip hover:border-cy/50 hover:text-cy"
                onClick={() => {
                  setEditing((v) => !v)
                  if (!override) setOverride({ ...derived.sizes })
                }}
              >
                <Pencil size={10} /> {t('catalog.fr.sizes.edit')}
              </button>
              {style.sizespecPdf && (
                <a
                  href={style.sizespecPdf}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="chip hover:border-cy/50 hover:text-cy"
                >
                  <FileText size={10} /> {t('catalog.fr.sizes.pdf')}
                </a>
              )}
            </div>
            {editing && override && (
              <SizeOverride
                sizes={override}
                onChange={setOverride}
                onReset={() => {
                  setOverride({ ...derived.sizes })
                  notify('ok', t('catalog.fr.sizes.reset_done'))
                }}
                notify={notify}
                t={t}
              />
            )}
          </section>

          <section className="rounded-lg border border-line bg-bg1 p-2.5 text-[11px]">
            <div className="panel-title mb-1">{t('catalog.detail.spec')}</div>
            {specRow(t('catalog.detail.material'), style.fabric.join(', ') || null)}
            {specRow(t('catalog.detail.gender'), style.gender || null)}
            {specRow(t('catalog.fr.neckline'), style.neckline || null)}
            {specRow(t('catalog.fr.certificates'), style.certificates.join(' · ') || null)}
            {specRow(t('catalog.fr.sku'), sku)}
            {specRow(
              t('catalog.fr.cost'),
              price ? t('catalog.fr.cost_value', { price: price.cost.toFixed(2) }) : null,
            )}
            {specRow(
              t('catalog.fr.stock'),
              qty ? t('catalog.fr.stock_value', { n: qty[0] }) : null,
            )}
            <p className="mt-1.5 text-[10px] leading-snug text-tx3">{t('catalog.fr.cost_note')}</p>
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
          disabled={!!busy || !spec || !effSize}
          onClick={() => effSize && onUse(colourCode, effSize, override ?? undefined)}
        >
          {t('catalog.use')}
        </button>
      </div>
    </div>
  )
}

/** Size label → SKU, tolerating the supplier's XXL/2XL spelling difference. */
function findSku(skus: Record<string, string>, size: SizeId): string | null {
  const alts = size === '2XL' ? ['2XL', 'XXL'] : size === '3XL' ? ['3XL', 'XXXL'] : [size]
  for (const a of alts) if (skus[a]) return skus[a]
  return null
}

/** How many "keep scanning" rounds a single search may trigger on its own. */
const AUTO_ROUNDS = 4

function FalkRossBrowser({
  t,
  onApplied,
}: {
  t: TFn
  onApplied: (product: Awaited<ReturnType<typeof ingestFalkRossProduct>>) => void
}) {
  const toast = useStore((s) => s.toast)
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'printable' | 'all'>('printable')
  const [items, setItems] = useState<FalkRossCard[]>([])
  const [page, setPage] = useState<FalkRossPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<FalkRossErrorCode | null>(null)
  const [state, setState] = useState<FalkRossWsState | null>(null)

  const [sel, setSel] = useState<FalkRossCard | null>(null)
  const [style, setStyle] = useState<FalkRossStyle | null>(null)
  const [prices, setPrices] = useState<FalkRossPrices | null>(null)
  const [stock, setStock] = useState<FalkRossStock | null>(null)
  const [busy, setBusy] = useState<Busy | null>(null)

  // Guards against a stale response overwriting a newer search's results.
  const runId = useRef(0)

  useEffect(() => {
    const id = setTimeout(() => setQuery(q.trim()), 300)
    return () => clearTimeout(id)
  }, [q])

  useEffect(() => {
    void fetchFalkRossState().then(setState, () => undefined)
  }, [])

  const load = useCallback(
    async (offset: number, append: boolean, rounds: number) => {
      const id = ++runId.current
      setLoading(true)
      try {
        let cur = offset
        let found = 0
        // A page can come back short simply because the scan budget ran out
        // before it found 24 matches — "0 results so far" is not "no results",
        // so keep walking a little before showing the user an empty grid.
        //
        // Each round commits its own results rather than the loop committing
        // once at the end: a cold catalogue takes seconds per round, and cards
        // that appear as they are found read as progress, where a spinner that
        // sits still for four rounds reads as a hang.
        for (let round = 0; round < rounds; round++) {
          const res = await fetchFalkRossStyles({ q: query, kind, offset: cur, limit: 24 })
          if (runId.current !== id) return
          const first = round === 0
          setItems((prev) => (append || !first ? [...prev, ...res.items] : res.items))
          setPage(res)
          setErr(null)
          found += res.items.length
          if (res.nextOffset === null || found >= 24) break
          cur = res.nextOffset
        }
      } catch (e) {
        if (runId.current !== id) return
        setErr(e instanceof FalkRossError ? e.code : 'unavailable')
      } finally {
        if (runId.current === id) setLoading(false)
      }
    },
    [query, kind],
  )

  useEffect(() => {
    setItems([])
    setPage(null)
    void load(0, false, AUTO_ROUNDS)
  }, [load])

  // Detail: style + price + stock. Price/stock are best-effort — a catalogue
  // that still browses without them beats one that fails whole.
  useEffect(() => {
    if (!sel) return
    setStyle(null)
    setPrices(null)
    setStock(null)
    let live = true
    void fetchFalkRossStyle(sel.styleNr).then(
      (s) => live && setStyle(s),
      () => live && toast('error', t('catalog.fr.err.style')),
    )
    void fetchFalkRossPrices(sel.styleNr).then(
      (p) => live && setPrices(p),
      () => undefined,
    )
    void fetchFalkRossStock(sel.styleNr).then(
      (s) => live && setStock(s),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [sel, t, toast])

  const use = async (
    colourCode: string,
    size: SizeId,
    override?: Partial<Record<SizeId, SizeSpecCm>>,
  ) => {
    if (!style) return
    setBusy('front')
    try {
      const sku = style.colourways.find((c) => c.code === colourCode)?.skus[size]
      const product = await ingestFalkRossProduct(style, {
        colourCode,
        defaultSize: size,
        sizes: override,
        costEur: sku ? (prices?.prices[sku]?.cost ?? null) : null,
        onProgress: setBusy,
        now: Date.now(),
      })
      onApplied(product)
    } catch (e) {
      if (e instanceof FalkRossError) toast('error', t(`catalog.fr.err.${e.code}`))
      else if (e instanceof IngestPhotoError) toast('error', t('catalog.err.photo_rejected'))
      else toast('error', t('catalog.err.generic'))
    } finally {
      setBusy(null)
    }
  }

  /**
   * Styles whose size run overlaps the studio's S–3XL union. Kids' and
   * one-size references map to nothing and cannot be imported at all, so they
   * do not get a grid slot — the same rule the Imbretex browser applies, and
   * applied here with the client's own size chart as the authority.
   */
  const usable = useMemo(
    () =>
      items
        .map((card) => ({ card, sizeIds: SIZE_IDS.filter((id) => falkrossSizes(card).sizes[id]) }))
        .filter((e) => e.sizeIds.length > 0),
    [items],
  )

  if (sel) {
    return (
      <FrDetail
        key={sel.styleNr}
        style={style}
        prices={prices}
        stock={stock}
        busy={busy}
        onBack={() => setSel(null)}
        onUse={(c, s, o) => void use(c, s, o)}
        notify={toast}
        t={t}
      />
    )
  }

  return (
    <>
      <p className="rounded-lg border border-line bg-bg1 p-2.5 text-[11px] leading-snug text-tx3">
        {t('catalog.fr.provenance')}
        {state && (
          <span
            className={clsx(
              'ml-1.5 inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[9.5px] font-medium',
              state.mode === 'live'
                ? 'border-dg/40 bg-dg/10 text-dg'
                : 'border-cy/40 bg-cy/10 text-cy',
            )}
          >
            <FlaskConical size={9} /> {t(`catalog.fr.mode.${state.mode}`)}
          </span>
        )}
      </p>

      {err && (
        <p className="rounded-lg border border-dg/40 bg-dg/10 p-2.5 text-[11.5px] leading-snug text-dg">
          {t(`catalog.fr.err.${err}`)}
        </p>
      )}

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
          className={clsx('chip', kind === 'printable' ? 'border-cy/60 text-cy' : 'hover:border-line2')}
          aria-pressed={kind === 'printable'}
          onClick={() => setKind((v) => (v === 'printable' ? 'all' : 'printable'))}
        >
          {t('catalog.fr.filter_printable')}
        </button>
        <span className="mono-dim">{t('catalog.count', { n: usable.length })}</span>
      </div>

      {loading && usable.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-tx3">
          <RefreshCw size={15} className="animate-spin" /> {t('catalog.loading')}
        </div>
      ) : usable.length === 0 && !err ? (
        <p className="py-8 text-center text-[12px] text-tx3">{t('catalog.empty')}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {usable.map(({ card, sizeIds }) => (
            <FrCard key={card.styleNr} card={card} sizeIds={sizeIds} onPick={() => setSel(card)} t={t} />
          ))}
        </ul>
      )}

      {/* The catalogue is scanned lazily, so "how much have we actually
          looked at?" is a real question the user is entitled to an answer to. */}
      {page && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10.5px] leading-snug text-tx3">
            {page.nextOffset === null
              ? t('catalog.fr.scan_done', { total: page.total })
              : t('catalog.fr.scan_partial', {
                  seen: page.nextOffset,
                  total: page.total,
                })}
          </span>
          {page.nextOffset !== null && (
            <button
              className="chip hover:border-cy/50 hover:text-cy"
              disabled={loading}
              onClick={() => void load(page.nextOffset!, true, AUTO_ROUNDS)}
            >
              {loading ? (
                <RefreshCw size={10} className="animate-spin" />
              ) : (
                <Search size={10} />
              )}{' '}
              {t('catalog.fr.scan_more')}
            </button>
          )}
        </div>
      )}
    </>
  )
}

// ===========================================================================
// IMBRETEX (snapshot — unchanged behaviour, now one source among two)
// ===========================================================================

/** A catalogue entry whose size run overlaps the studio's S–3XL union. */
interface Entry {
  p: ImbretexProduct
  sizes: Partial<Record<SizeId, SizeSpecCm>>
  sizeIds: SizeId[]
  /** Lowercased name + brand + ref, for the search box. */
  haystack: string
}

function Card({ entry, onPick, t }: { entry: Entry; onPick: () => void; t: TFn }) {
  const { p } = entry
  const photo = imbretexPhotoUrl(p, 'front')
  const backSource = imbretexBackSource(p)
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
        {/* Whoever picks a reference to sell has to see, in the grid, that its
            back is a reconstruction — not discover it three clicks in. */}
        {backSource !== 'real' && (
          <span className="w-fit rounded-full border border-yl/40 bg-yl/10 px-1.5 py-px text-[9.5px] font-medium text-yl">
            {t(backSource === 'generated' ? 'catalog.card.back_generated' : 'catalog.card.back_missing')}
          </span>
        )}
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
  const backSource = imbretexBackSource(p)
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
            if (!url) return null
            const img = (
              <img
                src={url}
                alt={`${p.name} — ${side}`}
                draggable={false}
                className={clsx(
                  'w-full rounded-lg bg-bg0 object-contain',
                  side === 'front' ? 'h-44' : 'h-24',
                )}
              />
            )
            // The reconstruction is shown, so it is labelled ON the image: the
            // paragraph below can be scrolled past, the picture cannot.
            return side === 'back' && backSource === 'generated' ? (
              // w-full so the two views still share the flex ROW this column
              // becomes below the sm breakpoint, and self-start so the wrapper
              // hugs the image there instead of stretching to the taller front
              // and dropping the badge into the gap underneath it.
              <span key={side} className="relative block w-full self-start sm:self-auto">
                {img}
                {/* Clamped + truncating: below the sm breakpoint this thumbnail
                    is barely wider than the label, and a wrapping chip spilled
                    out of the image. The full sentence sits right beside it. */}
                <span className="absolute bottom-1 left-1 flex max-w-[calc(100%-0.5rem)] items-center gap-1 overflow-hidden whitespace-nowrap rounded-full border border-yl/40 bg-bg0/85 px-1.5 py-px text-[9.5px] font-medium text-yl">
                  <Sparkles size={9} className="shrink-0" />
                  <span className="truncate">{t('catalog.card.back_generated')}</span>
                </span>
              </span>
            ) : (
              <span key={side} className="block w-full self-start sm:self-auto">
                {img}
              </span>
            )
          })}
          {backSource !== 'real' && (
            <div className="rounded-lg border border-yl/40 bg-yl/10 p-2 text-[10.5px] leading-snug text-tx2">
              <span className="flex items-center gap-1 font-medium text-yl">
                <Sparkles size={11} />{' '}
                {t(
                  backSource === 'generated'
                    ? 'catalog.card.back_generated'
                    : 'catalog.card.back_missing',
                )}
              </span>
              <p className="mt-1">{t('catalog.detail.no_back')}</p>
              <p className="mt-1">
                {t(
                  backSource === 'generated'
                    ? 'catalog.detail.back_reconstructed'
                    : 'catalog.detail.back_generated',
                )}
              </p>
            </div>
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

function ImbretexBrowser({
  t,
  onApplied,
}: {
  t: TFn
  onApplied: (product: Awaited<ReturnType<typeof ingestImbretexProduct>>) => void
}) {
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
        now: Date.now(),
      })
      onApplied(product)
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
  // Counted over every pickable entry, NOT over `shown`: this states a fact
  // about the supplier's catalogue, so it must not shrink to zero the moment a
  // filter or a search term happens to hide the gaps. (References the studio
  // cannot carry at all — kids' size runs — are already out of `entries`, so a
  // warning about something nobody can pick is still impossible.)
  const backGap = entries.filter((e) => imbretexBackSource(e.p) !== 'real').length

  return (
    <>
      <p className="rounded-lg border border-line bg-bg1 p-2.5 text-[11px] leading-snug text-tx3">
        {date ? t('catalog.provenance', { date }) : t('catalog.provenance_nodate')}
      </p>

      {loadErr && (
        <p className="rounded-lg border border-dg/40 bg-dg/10 p-2.5 text-[11.5px] leading-snug text-dg">
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
            {backGap > 0 && (
              <p className="text-[10.5px] leading-snug text-tx3">
                {t('catalog.back_gap', { n: backGap })}
              </p>
            )}
          </>
        )
      )}
    </>
  )
}

// ===========================================================================
// Modal shell
// ===========================================================================

export default function CatalogModal() {
  const t = useCatalogT()
  const closeModal = useStore((s) => s.closeModal)
  const setCustom = useStore((s) => s.setCustom)
  const setAssets = useStore((s) => s.setAssets)
  const toast = useStore((s) => s.toast)
  const [source, setSource] = useState<Source>('falkross')

  /** Shared tail of both import paths: save, apply, close, and say what landed. */
  const applied = useCallback(
    async (product: Parameters<typeof productToCustomGarment>[0]) => {
      await saveProduct(product)
      setAssets(await listAssets())
      setCustom(productToCustomGarment(product, product.defaultSize))
      closeModal('catalog')
      // The toast is the last moment before the customer starts designing on
      // that back — say which of the three it is rather than a bare "loaded".
      const key =
        product.backSource === 'generated'
          ? 'catalog.toast.applied_generated'
          : product.backSource === 'missing'
            ? 'catalog.toast.no_back'
            : 'catalog.toast.applied'
      toast(
        product.backSource === 'missing' ? 'warn' : 'ok',
        t(key, { name: product.name, size: product.defaultSize }),
      )
    },
    [closeModal, setAssets, setCustom, t, toast],
  )

  const tab = (id: Source, label: string, hint: string) => (
    <button
      key={id}
      onClick={() => setSource(id)}
      aria-pressed={source === id}
      title={hint}
      className={clsx(
        'flex-1 rounded-lg border px-2.5 py-1.5 text-left transition-colors',
        source === id
          ? 'border-cy/60 bg-cy/10 text-cy'
          : 'border-line bg-bg1 text-tx3 hover:border-line2',
      )}
    >
      <span className="block text-[12px] font-medium">{label}</span>
      <span className="block text-[10px] leading-snug opacity-80">{hint}</span>
    </button>
  )

  return (
    <Modal
      title={t('catalog.title')}
      subtitle={t('catalog.subtitle')}
      onClose={() => closeModal('catalog')}
      size="lg"
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          {tab('falkross', t('catalog.source.falkross'), t('catalog.source.falkross_hint'))}
          {tab('imbretex', t('catalog.source.imbretex'), t('catalog.source.imbretex_hint'))}
        </div>

        {source === 'falkross' ? (
          <FalkRossBrowser t={t} onApplied={(p) => void applied(p)} />
        ) : (
          <ImbretexBrowser t={t} onApplied={(p) => void applied(p)} />
        )}
      </div>
    </Modal>
  )
}
