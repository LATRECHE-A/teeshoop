/**
 * INGEST — admin modal: turn two garment photos + a per-size cm table into a
 * studio-ready product (ProductDef), manage the product library, optionally
 * pull photos from a WooCommerce store, and apply a product to the studio
 * through the existing custom-garment pipeline.
 *
 * UI idioms follow CustomSetupModal (photo tile + auto bg-removal + print-
 * area placer); measurements are cm-first in mono type.
 *
 * BACK PHOTO: this is the seam where a back-less product would otherwise enter
 * the catalogue unnoticed, so it is where the decision is forced — upload,
 * reconstruct from the front, or say out loud that there is no back. A
 * reconstructed back is badged here and stays badged everywhere downstream
 * (ProductSideDef.origin → CustomSideSetup.origin).
 */
import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Camera,
  Crosshair,
  Download,
  Package,
  Plus,
  RefreshCw,
  Sparkles,
  Store,
  Trash2,
  TriangleAlert,
  Upload,
  Wand2,
} from 'lucide-react'
import clsx from 'clsx'
import { nanoid } from 'nanoid'
import Modal from './Modal'
import PrintAreaPlacer from '@/app/PrintAreaPlacer'
import { useStore } from '@/state/store'
import { ensureAssetImage, listAssets } from '@/state/assets'
import { getCustomSideInfo } from '@/lib/custom'
import type { RectIn } from '@/lib/types'
import { cmToIn } from '@/lib/units'
import { downloadBlob, slugify } from '@/lib/download'
import {
  DEFAULT_SIZE,
  SIZE_CHARTS,
  SIZE_IDS,
  type SizeId,
  type SizeSpecCm,
} from '@/content/sizeChart'
import {
  autoPrintArea,
  generateBackSide,
  IngestPhotoError,
  normalizeGarmentPhoto,
  parseSizeTable,
} from '@/lib/ingest/pipeline'
import {
  deleteProduct,
  exportProductFile,
  getProduct,
  importProductFile,
  listProducts,
  saveProduct,
} from '@/lib/ingest/store'
import { productToCustomGarment } from '@/lib/ingest/apply'
import {
  backSourceOf,
  type BackSource,
  type ProductDef,
  type ProductMeta,
  type ProductSideDef,
} from '@/lib/ingest/types'
import {
  fetchWooImage,
  fetchWooProducts,
  loadWooCredentials,
  saveWooCredentials,
  type WooCredentials,
  type WooError,
  type WooFetchResult,
  type WooProductCandidate,
} from '@/lib/ingest/woo'
import { useIngestT } from './ingestI18n'

type TFn = ReturnType<typeof useIngestT>
type PhotoStage = 'store' | 'cutout' | 'measure' | 'generate'
type PhotoSide = 'front' | 'back'

/**
 * Saving a back-less product is a DECISION, not an oversight — so it costs an
 * explicit click instead of happening by default. The gate is not a hard block:
 * ship-your-own uploads legitimately have one photo, and a real product with no
 * back is a real thing. It just can no longer slip through silently.
 */
const REQUIRE_BACK_PHOTO = true
/** Below this mirror-symmetry IoU a generated back needs a human look. */
const LOW_SYMMETRY = 0.93

/** Editor working copy of a ProductDef (front may still be missing). */
interface Draft {
  id: string
  name: string
  brandRef: string
  notes: string
  createdAt: number
  sizes: Partial<Record<SizeId, SizeSpecCm>>
  defaultSize: SizeId
  front: ProductSideDef | null
  back: ProductSideDef | null
}

const copySizes = (
  sizes: Partial<Record<SizeId, SizeSpecCm>>,
): Partial<Record<SizeId, SizeSpecCm>> => {
  const out: Partial<Record<SizeId, SizeSpecCm>> = {}
  for (const id of SIZE_IDS) if (sizes[id]) out[id] = { ...sizes[id]! }
  return out
}

function newDraft(): Draft {
  // Prefilled with the tee chart so the placer has real dimensions from the
  // first second — admins overwrite the numbers (or paste their own table).
  return {
    id: nanoid(10),
    name: '',
    brandRef: '',
    notes: '',
    createdAt: Date.now(),
    sizes: copySizes(SIZE_CHARTS.tee.sizes),
    defaultSize: DEFAULT_SIZE,
    front: null,
    back: null,
  }
}

const coveredSizes = (d: Pick<Draft, 'sizes'>): SizeId[] =>
  SIZE_IDS.filter((s) => d.sizes[s] !== undefined)

/** halfChestCm of the reference size (fallback: first covered, then tee M). */
function draftHalfChestCm(d: Draft): number {
  const spec = d.sizes[d.defaultSize] ?? d.sizes[coveredSizes(d)[0]]
  return spec?.halfChestCm ?? SIZE_CHARTS.tee.sizes.M.halfChestCm
}

// ---------------------------------------------------------------------------
// Photo tile (upload + pipeline progress)
// ---------------------------------------------------------------------------

function PhotoTile({
  side,
  def,
  stage,
  onUpload,
  onGenerate,
  fileRef,
  t,
}: {
  side: PhotoSide
  def: ProductSideDef | null
  stage: PhotoStage | null
  onUpload: (file: File) => void
  /** Offered only where a reconstruction is possible and defensible. */
  onGenerate?: () => void
  /** Lets the save gate open this tile's picker without leaving the panel. */
  fileRef?: React.RefObject<HTMLInputElement | null>
  t: TFn
}) {
  const localRef = useRef<HTMLInputElement>(null)
  const inputRef = fileRef ?? localRef
  const [thumb, setThumb] = useState<string | null>(null)
  const generated = def?.origin === 'generated'

  useEffect(() => {
    let on = true
    if (!def) {
      setThumb(null)
      return
    }
    void (async () => {
      try {
        const img = await ensureAssetImage(def.assetId, def.useCutout ? 'cutout' : 'original')
        if (on) setThumb(img.src)
      } catch {
        if (on) setThumb(null)
      }
    })()
    return () => {
      on = false
    }
  }, [def])

  return (
    <div className="flex flex-1 flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) onUpload(f)
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={!!stage}
        className={clsx(
          'relative flex h-40 flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed transition-colors',
          def ? 'border-line bg-bg0' : 'border-line2 bg-bg1 hover:border-cy/60',
        )}
      >
        {thumb ? (
          <img
            src={thumb}
            alt={t('custom.photo_alt', { side: t('side.' + side) })}
            className="h-full w-full object-contain p-1"
          />
        ) : (
          <>
            <Camera size={20} className="text-cy" />
            <span className="text-[12px] font-medium capitalize text-tx">
              {t('side.' + side)} {t('custom.photo_word')}
              {side === 'back' && ' ' + t('custom.optional')}
            </span>
            <span className="px-4 text-center text-[10.5px] leading-snug text-tx3">
              {t('custom.photo_tip')}
            </span>
          </>
        )}
        {generated && !stage && (
          <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full border border-yl/40 bg-yl/15 px-1.5 py-px text-[9.5px] font-medium text-yl">
            <Sparkles size={9} /> {t('ingest.back.tag')}
          </span>
        )}
        {stage && (
          <span className="absolute inset-0 flex items-center justify-center gap-2 bg-bg0/80 text-[12px] text-cy backdrop-blur-[2px]">
            <Wand2 size={14} className="animate-pulse" /> {t(`ingest.ph.${stage}`)}
          </span>
        )}
      </button>
      {!stage && (
        <div className="flex flex-wrap gap-1.5">
          {def && (
            <button
              className="chip hover:border-cy/50 hover:text-cy"
              onClick={() => inputRef.current?.click()}
            >
              <RefreshCw size={10} /> {t('common.replace')}
            </button>
          )}
          {onGenerate && (
            <button className="chip hover:border-yl/50 hover:text-yl" onClick={onGenerate}>
              <Sparkles size={10} /> {t('ingest.back.generate')}
            </button>
          )}
        </div>
      )}
      {generated && !stage && (
        <p className="text-[10.5px] leading-snug text-tx3">{t('ingest.back.hint')}</p>
      )}
    </div>
  )
}

/**
 * Back-coverage chip for a library row. `real` gets NO chip on purpose — it is
 * the norm, and badging it would turn the two states that need attention into
 * noise. Absent (a row written before the index carried the field) reads as
 * real too, which is what it was.
 */
function BackChip({ source, t }: { source: BackSource | undefined; t: TFn }) {
  if (source !== 'generated' && source !== 'missing') return null
  return (
    <span
      className={clsx(
        'rounded-full border px-1.5 py-px font-sans text-[9.5px] font-medium',
        source === 'generated'
          ? 'border-yl/40 bg-yl/10 text-yl'
          : 'border-dg/40 bg-dg/10 text-dg',
      )}
    >
      {t(`ingest.back.state.${source}`)}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Per-size cm table editor (paste-a-table + chart prefills)
// ---------------------------------------------------------------------------

function SizeTable({
  sizes,
  defaultSize,
  onSizes,
  onDefault,
  onPrefill,
  notify,
  t,
}: {
  sizes: Partial<Record<SizeId, SizeSpecCm>>
  defaultSize: SizeId
  onSizes: (next: Partial<Record<SizeId, SizeSpecCm>>) => void
  onDefault: (size: SizeId) => void
  onPrefill: (chart: 'tee' | 'hoodie') => void
  notify: (kind: 'ok' | 'warn', msg: string) => void
  t: TFn
}) {
  const toggle = (size: SizeId) => {
    const next = copySizes(sizes)
    if (next[size]) delete next[size]
    else next[size] = { ...SIZE_CHARTS.tee.sizes[size] }
    onSizes(next)
  }

  const patch = (size: SizeId, field: keyof SizeSpecCm, v: number) => {
    const spec = sizes[size]
    if (!spec) return
    onSizes({ ...copySizes(sizes), [size]: { ...spec, [field]: v } })
  }

  const covered = SIZE_IDS.filter((s) => sizes[s])

  const cell = (size: SizeId, field: keyof SizeSpecCm) => {
    const spec = sizes[size]
    return (
      <input
        key={field}
        type="number"
        step={0.5}
        min={0}
        disabled={!spec}
        value={spec ? spec[field] : ''}
        onChange={(e) =>
          patch(size, field, parseFloat(e.target.value.replace(',', '.')) || 0)
        }
        className="input h-7 px-1.5 text-right font-mono text-[12px] disabled:opacity-35"
      />
    )
  }

  return (
    <section
      tabIndex={0}
      onPaste={(e) => {
        const text = e.clipboardData.getData('text')
        if (!text) return
        e.preventDefault()
        const parsed = parseSizeTable(text)
        const n = Object.keys(parsed).length
        if (n === 0) {
          notify('warn', t('ingest.sizes.paste_empty'))
          return
        }
        onSizes({ ...copySizes(sizes), ...parsed })
        notify('ok', t('ingest.sizes.pasted', { n }))
      }}
      className="rounded-xl outline-none focus-visible:outline-2 focus-visible:outline-cy/40"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="panel-title">{t('ingest.sizes.title')}</div>
        <div className="flex gap-1.5">
          <button className="chip hover:border-cy/50 hover:text-cy" onClick={() => onPrefill('tee')}>
            {t('ingest.sizes.prefill_tee')}
          </button>
          <button className="chip hover:border-cy/50 hover:text-cy" onClick={() => onPrefill('hoodie')}>
            {t('ingest.sizes.prefill_hoodie')}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-[auto_1fr_1fr_1fr] items-center gap-x-2 gap-y-1.5">
        <span className="text-[10.5px] uppercase tracking-wider text-tx3">
          {t('ingest.sizes.size')}
        </span>
        {(['chest', 'body', 'sleeve'] as const).map((k) => (
          <span key={k} className="text-right text-[10.5px] uppercase tracking-wider text-tx3">
            {t(`ingest.sizes.${k}`)} <span className="font-mono lowercase">cm</span>
          </span>
        ))}
        {SIZE_IDS.map((size) => (
          <FragmentRow
            key={size}
            size={size}
            included={!!sizes[size]}
            onToggle={() => toggle(size)}
            cells={[cell(size, 'halfChestCm'), cell(size, 'bodyLengthCm'), cell(size, 'sleeveLengthCm')]}
          />
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-[380px] text-[10.5px] leading-snug text-tx3">
          {t('ingest.sizes.paste_hint')}
        </p>
        <label className="flex items-center gap-2 text-[11px] text-tx2">
          {t('ingest.sizes.default')}
          <select
            className="input h-7 w-auto font-mono text-[12px]"
            value={defaultSize}
            onChange={(e) => onDefault(e.target.value as SizeId)}
          >
            {covered.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  )
}

/** One size row: include-checkbox + label + the three cm inputs. */
function FragmentRow({
  size,
  included,
  onToggle,
  cells,
}: {
  size: SizeId
  included: boolean
  onToggle: () => void
  cells: React.ReactNode[]
}) {
  return (
    <>
      <label className="flex cursor-pointer items-center gap-1.5 pr-1">
        <input type="checkbox" className="accent-cy" checked={included} onChange={onToggle} />
        <span className={clsx('w-8 font-mono text-[12px]', included ? 'text-tx' : 'text-tx3')}>
          {size}
        </span>
      </label>
      {cells}
    </>
  )
}

// ---------------------------------------------------------------------------
// WooCommerce section
// ---------------------------------------------------------------------------

function wooErrMsg(t: TFn, err: WooError): string {
  switch (err.kind) {
    case 'cors':
      return t('ingest.woo.err_cors')
    case 'auth':
      return t('ingest.woo.err_auth', { status: err.status ?? 401 })
    case 'http':
      return t('ingest.woo.err_http', { status: err.status ?? 0 })
    case 'parse':
      return t('ingest.woo.err_parse')
  }
}

function WooSection({
  busyId,
  onPick,
  t,
}: {
  busyId: number | null
  onPick: (candidate: WooProductCandidate) => void
  t: TFn
}) {
  const [cred, setCred] = useState<WooCredentials>(
    () => loadWooCredentials() ?? { baseUrl: '', consumerKey: '', consumerSecret: '' },
  )
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<WooFetchResult | null>(null)

  const canFetch =
    cred.baseUrl.trim() !== '' &&
    cred.consumerKey.trim() !== '' &&
    cred.consumerSecret.trim() !== ''

  const doFetch = async (p: number) => {
    setLoading(true)
    setPage(p)
    saveWooCredentials(cred)
    setResult(await fetchWooProducts({ ...cred, page: p }))
    setLoading(false)
  }

  const field = (key: keyof WooCredentials, label: string, type = 'text') => (
    <label className="flex flex-1 basis-40 flex-col gap-1 text-[11px] text-tx2">
      {label}
      <input
        type={type}
        className="input font-mono text-[12px]"
        value={cred[key]}
        autoComplete="off"
        onChange={(e) => setCred({ ...cred, [key]: e.target.value })}
      />
    </label>
  )

  return (
    <details className="rounded-xl border border-line bg-bg1/60 p-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[12.5px] font-medium text-tx">
        <Store size={14} className="text-cy" /> {t('ingest.woo.title')}
        <span className="text-[10.5px] font-normal text-tx3">{t('ingest.woo.hint')}</span>
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {field('baseUrl', t('ingest.woo.url'))}
          {field('consumerKey', t('ingest.woo.key'), 'password')}
          {field('consumerSecret', t('ingest.woo.secret'), 'password')}
        </div>
        <p className="text-[10.5px] leading-snug text-tx3">{t('ingest.woo.local_notice')}</p>
        <div className="flex items-center gap-2">
          <button className="btn" disabled={!canFetch || loading} onClick={() => void doFetch(1)}>
            {loading ? t('ingest.woo.fetching') : t('ingest.woo.fetch')}
          </button>
          {result?.ok && result.totalPages !== null && result.totalPages > 1 && (
            <span className="flex items-center gap-1.5">
              <button
                className="chip"
                disabled={loading || page <= 1}
                onClick={() => void doFetch(page - 1)}
              >
                ←
              </button>
              <span className="mono-dim">{t('ingest.woo.page', { page })}</span>
              <button
                className="chip"
                disabled={loading || page >= (result.totalPages ?? 1)}
                onClick={() => void doFetch(page + 1)}
              >
                →
              </button>
            </span>
          )}
        </div>
        {result && !result.ok && (
          <p className="rounded-lg border border-dg/40 bg-dg/10 p-2.5 text-[11.5px] leading-snug text-dg">
            {wooErrMsg(t, result.error)}
          </p>
        )}
        {result?.ok && result.products.length === 0 && (
          <p className="text-[11.5px] text-tx3">{t('ingest.woo.empty')}</p>
        )}
        {result?.ok && result.products.length > 0 && (
          <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-1">
            {result.products.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-2.5 rounded-lg border border-line bg-bg2 p-2"
              >
                {p.images[0] ? (
                  <img
                    src={p.images[0]}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-md bg-bg0 object-contain"
                  />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-bg0 text-tx3">
                    <Package size={16} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium text-tx">{p.name}</div>
                  <div className="truncate font-mono text-[10px] text-tx3">
                    {p.sku || `#${p.id}`}
                    {p.attributes.length > 0 &&
                      ` · ${p.attributes[0].name}: ${p.attributes[0].options.join('/')}`}
                  </div>
                </div>
                <button
                  className="chip shrink-0 hover:border-cy/50 hover:text-cy"
                  disabled={busyId !== null || p.images.length === 0}
                  onClick={() => onPick(p)}
                >
                  {busyId === p.id ? t('ingest.woo.importing') : t('ingest.woo.use')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  )
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

export default function AdminIngestModal({
  initialProductId,
}: {
  /** Open straight into the editor for this product (dev harness deep-link). */
  initialProductId?: string
}) {
  const t = useIngestT()
  const closeModal = useStore((s) => s.closeModal)
  const setCustom = useStore((s) => s.setCustom)
  const setAssets = useStore((s) => s.setAssets)
  const toast = useStore((s) => s.toast)

  const [metas, setMetas] = useState<ProductMeta[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [proc, setProc] = useState<Record<PhotoSide, PhotoStage | null>>({
    front: null,
    back: null,
  })
  const [armedDelete, setArmedDelete] = useState<string | null>(null)
  const [wooBusy, setWooBusy] = useState<number | null>(null)
  /** Pending save/apply intent, parked while the missing-back gate is shown. */
  const [gate, setGate] = useState<'save' | 'studio' | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const backFileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void (async () => {
      setMetas(await listProducts())
      if (initialProductId) {
        const p = await getProduct(initialProductId)
        if (p) openEdit(p)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The gate is an answer to "you just asked to save THIS product"; it must not
  // outlive the draft that raised it. Left standing it re-appears unprompted on
  // the next back-less product opened — and "continue without a back" would
  // then commit an intent the admin expressed about a different garment.
  useEffect(() => setGate(null), [draft?.id])

  const openEdit = (p: ProductDef) => {
    setDraft({
      id: p.id,
      name: p.name,
      brandRef: p.brandRef,
      notes: p.notes ?? '',
      createdAt: p.createdAt,
      sizes: copySizes(p.sizes),
      defaultSize: p.defaultSize,
      front: p.front,
      back: p.back,
    })
  }

  // --- photo pipeline ------------------------------------------------------

  const computeArea = async (
    side: { assetId: string; useCutout: boolean },
    photoSide: PhotoSide,
    halfChestCm: number,
  ): Promise<RectIn> => {
    const widthIn = cmToIn(halfChestCm)
    const info = await getCustomSideInfo(
      { ...side, printArea: { xIn: 0, yIn: 0, wIn: 1, hIn: 1 } },
      widthIn,
    )
    return autoPrintArea(info.img, info.bbox, halfChestCm, photoSide)
  }

  const ingestBlob = async (side: PhotoSide, blob: Blob, name: string) => {
    if (!draft) return
    const draftId = draft.id
    const halfChestCm = draftHalfChestCm(draft)
    setProc((p) => ({ ...p, [side]: 'store' }))
    try {
      const res = await normalizeGarmentPhoto(blob, {
        name,
        onProgress: (stage) => setProc((p) => ({ ...p, [side]: stage })),
      })
      setAssets(await listAssets())
      const printArea = await computeArea(
        { assetId: res.assetId, useCutout: res.hasCutout },
        side,
        halfChestCm,
      )
      setDraft((prev) =>
        prev && prev.id === draftId
          ? {
              ...prev,
              [side]: { assetId: res.assetId, useCutout: res.hasCutout, printArea },
            }
          : prev,
      )
    } catch (err) {
      const code = err instanceof IngestPhotoError ? err.code : 'decode_failed'
      toast('error', t(`ingest.err.${code}`))
    } finally {
      setProc((p) => ({ ...p, [side]: null }))
    }
  }

  const upload = (side: PhotoSide) => (file: File) =>
    void ingestBlob(side, file, `${t('side.' + side)} — ${file.name}`)

  /**
   * Reconstruct the back from the front. Explicit, never automatic here: an
   * admin uploading their own photos may well have a real back coming, and a
   * generated one would then have to be undone.
   */
  const generateBack = async () => {
    if (!draft?.front) return
    const draftId = draft.id
    const halfChestCm = draftHalfChestCm(draft)
    const front = draft.front
    const label = draft.name.trim() || t('ingest.unnamed')
    setProc((p) => ({ ...p, back: 'generate' }))
    try {
      const back = await generateBackSide(front, halfChestCm, {
        name: `${label} — ${t('side.back')}`,
        at: Date.now(),
      })
      setAssets(await listAssets())
      setDraft((prev) => (prev && prev.id === draftId ? { ...prev, back } : prev))
      toast('ok', t('ingest.toast.back_generated'))
    } catch (err) {
      toast(
        'error',
        err instanceof IngestPhotoError && err.code !== 'cutout_failed'
          ? t(`ingest.err.${err.code}`)
          : t('ingest.back.err'),
      )
    } finally {
      setProc((p) => ({ ...p, back: null }))
    }
  }

  const suggestArea = async (side: PhotoSide) => {
    if (!draft) return
    const def = draft[side]
    if (!def) return
    const draftId = draft.id
    const printArea = await computeArea(def, side, draftHalfChestCm(draft))
    setDraft((prev) =>
      prev && prev.id === draftId && prev[side]
        ? { ...prev, [side]: { ...prev[side]!, printArea } }
        : prev,
    )
  }

  const wooPick = async (cand: WooProductCandidate) => {
    if (!draft) return
    const draftId = draft.id
    setWooBusy(cand.id)
    try {
      const sides: PhotoSide[] = ['front', 'back']
      for (let i = 0; i < Math.min(2, cand.images.length); i++) {
        const blob = await fetchWooImage(cand.images[i])
        await ingestBlob(sides[i], blob, `${cand.name} — ${t('side.' + sides[i])}`)
      }
      setDraft((prev) =>
        prev && prev.id === draftId && !prev.name.trim()
          ? { ...prev, name: cand.name }
          : prev,
      )
      toast('ok', t('ingest.toast.woo_photos'))
    } catch (err) {
      const e = err as Partial<WooError>
      toast(
        'error',
        wooErrMsg(t, {
          kind: e.kind === 'http' || e.kind === 'cors' ? e.kind : 'cors',
          status: e.status,
        }),
      )
    } finally {
      setWooBusy(null)
    }
  }

  // --- save / apply / library ---------------------------------------------

  const buildProduct = (): ProductDef | null => {
    if (!draft) return null
    if (!draft.front) {
      toast('warn', t('ingest.toast.need_front'))
      return null
    }
    const covered = coveredSizes(draft)
    if (covered.length === 0) {
      toast('warn', t('ingest.toast.need_size'))
      return null
    }
    return {
      id: draft.id,
      name: draft.name.trim() || t('ingest.unnamed'),
      brandRef: draft.brandRef.trim(),
      createdAt: draft.createdAt,
      sizes: copySizes(draft.sizes),
      defaultSize: draft.sizes[draft.defaultSize] ? draft.defaultSize : covered[0],
      front: draft.front,
      back: draft.back,
      backSource: backSourceOf(draft),
      ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
    }
  }

  const commit = async (intent: 'save' | 'studio', p: ProductDef) => {
    setMetas(await saveProduct(p))
    if (intent === 'save') {
      toast('ok', t('ingest.toast.saved', { name: p.name }))
      setDraft(null)
      return
    }
    setCustom(productToCustomGarment(p, p.defaultSize))
    closeModal('adminIngest')
    toast('ok', t('ingest.toast.applied', { name: p.name, size: p.defaultSize }))
  }

  /** Save / apply, through the missing-back gate (see REQUIRE_BACK_PHOTO). */
  const submit = async (intent: 'save' | 'studio') => {
    const p = buildProduct()
    if (!p) return
    if (!p.back && REQUIRE_BACK_PHOTO) {
      setGate(intent)
      return
    }
    await commit(intent, p)
  }

  const exportOne = async (meta: ProductMeta) => {
    const p = await getProduct(meta.id)
    if (!p) {
      toast('error', t('ingest.toast.export_failed'))
      return
    }
    downloadBlob(await exportProductFile(p), `${slugify(p.name)}.tshop-product.json`)
  }

  const importFile = async (file: File) => {
    try {
      const p = await importProductFile(file)
      setMetas(await listProducts())
      setAssets(await listAssets())
      toast('ok', t('ingest.toast.imported', { name: p.name }))
    } catch {
      toast('error', t('ingest.toast.import_failed'))
    }
  }

  const del = async (id: string) => {
    if (armedDelete !== id) {
      setArmedDelete(id)
      return
    }
    setMetas(await deleteProduct(id))
    setArmedDelete(null)
    toast('ok', t('ingest.toast.deleted'))
  }

  const openEditById = async (id: string) => {
    const p = await getProduct(id)
    if (p) openEdit(p)
  }

  // --- render --------------------------------------------------------------

  const halfChestCm = draft ? draftHalfChestCm(draft) : 0
  const placerWidthIn = cmToIn(halfChestCm || SIZE_CHARTS.tee.sizes.M.halfChestCm)

  return (
    <Modal
      title={t('ingest.title')}
      subtitle={t('ingest.subtitle')}
      onClose={() => closeModal('adminIngest')}
      size="lg"
    >
      {!draft ? (
        // ------------------------------------------------ product library
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <button className="btn btn-primary" onClick={() => setDraft(newDraft())}>
              <Plus size={14} /> {t('ingest.list.new')}
            </button>
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void importFile(f)
              }}
            />
            <button className="btn" onClick={() => importRef.current?.click()}>
              <Upload size={13} /> {t('ingest.list.import')}
            </button>
          </div>
          {metas.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line py-10 text-center">
              <Crosshair size={22} className="text-tx3" />
              <div className="text-[13px] font-medium text-tx">{t('ingest.list.empty')}</div>
              <p className="max-w-[340px] text-[11.5px] leading-snug text-tx3">
                {t('ingest.list.empty_hint')}
              </p>
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {metas.map((m) => (
                <li
                  key={m.id}
                  className="group flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-bg1 p-2.5 transition-colors hover:border-cy/50"
                  onClick={() => void openEditById(m.id)}
                >
                  {m.thumb ? (
                    <img
                      src={m.thumb}
                      alt=""
                      className="checkerboard h-14 w-14 shrink-0 rounded-lg object-contain"
                    />
                  ) : (
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-bg0 text-tx3">
                      <Package size={18} />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium text-tx">{m.name}</div>
                    {m.brandRef && (
                      <div className="truncate text-[10.5px] text-tx3">{m.brandRef}</div>
                    )}
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-tx2">
                      {m.sizeIds.join(' · ') || t('ingest.list.sizes', { n: 0 })}
                      <BackChip source={m.backSource} t={t} />
                    </div>
                  </div>
                  <div className="touch-reveal flex shrink-0 flex-col gap-1">
                    <button
                      className="iconbtn h-7 w-7"
                      title={t('ingest.list.export')}
                      onClick={(e) => {
                        e.stopPropagation()
                        void exportOne(m)
                      }}
                    >
                      <Download size={13} />
                    </button>
                    <button
                      className={clsx(
                        'iconbtn h-7 w-7',
                        // `dg` is the theme's danger token (src/styles.css); the
                        // `danger` name emits no utility at all, which left the
                        // armed state visually identical to the unarmed one.
                        armedDelete === m.id && 'bg-dg/20 text-dg',
                      )}
                      title={armedDelete === m.id ? t('ingest.list.delete_confirm') : t('common.delete')}
                      onClick={(e) => {
                        e.stopPropagation()
                        void del(m.id)
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        // ------------------------------------------------ product editor
        <div className="flex flex-col gap-5">
          <button
            className="chip self-start hover:border-cy/50 hover:text-cy"
            onClick={() => setDraft(null)}
          >
            <ArrowLeft size={11} /> {t('ingest.ed.back')}
          </button>

          <div className="flex flex-col gap-2.5 sm:flex-row">
            <label className="flex flex-1 flex-col gap-1 text-[11px] text-tx2">
              {t('ingest.ed.name')}
              <input
                className="input"
                value={draft.name}
                placeholder={t('ingest.ed.name_ph')}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-[11px] text-tx2">
              {t('ingest.ed.brand')}
              <input
                className="input"
                value={draft.brandRef}
                placeholder={t('ingest.ed.brand_ph')}
                onChange={(e) => setDraft({ ...draft, brandRef: e.target.value })}
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-[11px] text-tx2">
              {t('ingest.ed.notes')}
              <input
                className="input"
                value={draft.notes}
                placeholder={t('ingest.ed.notes_ph')}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </label>
          </div>

          <section>
            <div className="panel-title mb-2">{t('ingest.ed.photos')}</div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <PhotoTile side="front" def={draft.front} stage={proc.front} onUpload={upload('front')} t={t} />
              <PhotoTile
                side="back"
                def={draft.back}
                stage={proc.back}
                onUpload={upload('back')}
                fileRef={backFileRef}
                // Only from a cut-out front: without a silhouette there is
                // nothing to mirror, and a real back must never be replaced.
                onGenerate={
                  draft.front?.useCutout &&
                  !proc.front &&
                  (!draft.back || draft.back.origin === 'generated')
                    ? () => void generateBack()
                    : undefined
                }
                t={t}
              />
            </div>
            {draft.back?.generatedFrom &&
              draft.back.generatedFrom.symmetry < LOW_SYMMETRY && (
                <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-yl/40 bg-yl/10 p-2 text-[10.5px] leading-snug text-yl">
                  <TriangleAlert size={12} className="mt-px shrink-0" />
                  {t('ingest.back.low_symmetry', {
                    pct: Math.round(draft.back.generatedFrom.symmetry * 100),
                  })}
                </p>
              )}
          </section>

          {draft.front && !proc.front && (
            <section>
              <div className="panel-title mb-2">
                {t('custom.print_area_side', { side: t('side.front') })}
              </div>
              <PrintAreaPlacer
                setup={draft.front}
                widthIn={placerWidthIn}
                side="front"
                minIn={2}
                onChange={(printArea) =>
                  setDraft((prev) =>
                    prev?.front ? { ...prev, front: { ...prev.front, printArea } } : prev,
                  )
                }
                onAuto={() => void suggestArea('front')}
                autoLabel={t('ingest.area.auto')}
              />
            </section>
          )}
          {draft.back && !proc.back && (
            <section>
              <div className="panel-title mb-2">
                {t('custom.print_area_side', { side: t('side.back') })}
              </div>
              <PrintAreaPlacer
                setup={draft.back}
                widthIn={placerWidthIn}
                side="back"
                minIn={2}
                onChange={(printArea) =>
                  setDraft((prev) =>
                    prev?.back ? { ...prev, back: { ...prev.back, printArea } } : prev,
                  )
                }
                onAuto={() => void suggestArea('back')}
                autoLabel={t('ingest.area.auto')}
              />
            </section>
          )}

          <SizeTable
            sizes={draft.sizes}
            defaultSize={draft.defaultSize}
            onSizes={(sizes) =>
              setDraft((prev) => {
                if (!prev) return prev
                const covered = coveredSizes({ sizes })
                const defaultSize = sizes[prev.defaultSize]
                  ? prev.defaultSize
                  : (covered[0] ?? prev.defaultSize)
                return { ...prev, sizes, defaultSize }
              })
            }
            onDefault={(defaultSize) => setDraft({ ...draft, defaultSize })}
            onPrefill={(chart) =>
              setDraft((prev) =>
                prev
                  ? {
                      ...prev,
                      sizes: copySizes(SIZE_CHARTS[chart].sizes),
                      brandRef: prev.brandRef.trim() || SIZE_CHARTS[chart].brandRef,
                    }
                  : prev,
              )
            }
            notify={(kind, msg) => toast(kind, msg)}
            t={t}
          />

          <WooSection busyId={wooBusy} onPick={(c) => void wooPick(c)} t={t} />

          {gate && !draft.back && (
            <div className="flex flex-col gap-2 rounded-xl border border-yl/40 bg-yl/10 p-3">
              <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-yl">
                <TriangleAlert size={14} /> {t('ingest.gate.title')}
              </div>
              <p className="text-[11px] leading-snug text-tx2">{t('ingest.gate.body')}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  className="btn"
                  onClick={() => {
                    setGate(null)
                    backFileRef.current?.click()
                  }}
                >
                  <Upload size={13} /> {t('ingest.gate.upload')}
                </button>
                <button
                  className="btn btn-primary"
                  disabled={!draft.front?.useCutout}
                  onClick={() => {
                    setGate(null)
                    void generateBack()
                  }}
                >
                  <Sparkles size={13} /> {t('ingest.gate.generate')}
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    const p = buildProduct()
                    setGate(null)
                    if (p) void commit(gate, p)
                  }}
                >
                  {t('ingest.gate.skip')}
                </button>
              </div>
              <p className="text-[10.5px] leading-snug text-tx3">{t('ingest.gate.skip_hint')}</p>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <button className="btn btn-ghost" onClick={() => setDraft(null)}>
              {t('common.cancel')}
            </button>
            <button
              className="btn"
              onClick={() => void submit('save')}
              disabled={!draft.front || !!proc.front || !!proc.back}
            >
              {t('ingest.save')}
            </button>
            <button
              className="btn btn-primary"
              onClick={() => void submit('studio')}
              disabled={!draft.front || !!proc.front || !!proc.back}
            >
              {t('ingest.use_studio')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
