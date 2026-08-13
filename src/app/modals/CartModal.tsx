/**
 * The buy flow: from a design in this tab to a line in a WooCommerce basket.
 *
 * THE PRICE ON THIS SCREEN IS THE SHOP'S. Every amount comes from
 * `Rest::quote()`, already formatted in French by `Money::format`, and the
 * studio's own src/content/pricing.ts is not consulted once. Two engines
 * pricing the same shirt always diverge in the end (a tier boundary, a rounding
 * mode, a VAT basis) and the day they do the customer reads one number and the
 * invoice says another. So there is one, and it is not here.
 *
 * THE ORDER OF OPERATIONS IS NOT NEGOTIABLE:
 *
 *   1. measure   `ensureInkProbes` must settle before any area is read. A layer
 *                that has not decoded measures as its full declared box, which
 *                is the padded rectangle a logo was exported in. Quoting from
 *                that overcharges, and doing it in a modal that then corrects
 *                itself changes the price in front of the buyer.
 *   2. quote     the shop prices the measured sides. Displayed, never computed.
 *   3. upload    the design reaches R2 and gets an id. Until this succeeds
 *                there is nothing for WordPress to verify, and `Design::verify`
 *                would refuse the line, correctly.
 *   4. add       the parent page holds the nonce and makes the REST call.
 *
 * Step 3 before step 4, always. The reverse would put a paid line in a basket
 * for artwork that exists in one browser.
 */
import { useEffect, useRef, useState } from 'react'
import { Check, Minus, Plus, RefreshCw, ShoppingBag, TriangleAlert } from 'lucide-react'
import Modal from './Modal'
import { useStore } from '@/state/store'
import { useMockupUrl } from '../hooks/useMockup'
import { useShopBridge } from '../hooks/useShopBridge'
import { useCartT } from './cartI18n'
import { useT } from '@/i18n'
import { SIZE_IDS, type SizeId } from '@/content/sizeChart'
import { sideLayers } from '@/lib/renderDesign'
import {
  addToShopCart,
  requestShopQuote,
  requestFrameHeight,
  type BridgeSide,
  type CartOutcome,
  type ShopQuote,
} from '@/lib/teeshoop/bridge'
import { DesignUploadError, measureOrder, uploadDesign } from '@/lib/teeshoop/upload'

type Phase = 'measuring' | 'ready' | 'uploading' | 'adding' | 'done' | 'failed'

/** The shop's own error codes, mapped to the sentence that explains them. */
function cartErrorKey(reason: string): string {
  if (reason === 'teeshoop_bad_nonce') return 'cart.err.expired'
  if (reason === 'timeout' || reason === 'network') return 'cart.err.timeout'
  if (reason.startsWith('teeshoop_design_')) return 'cart.err.design_not_found'
  return 'cart.err.cart'
}

export default function CartModal() {
  const t = useT()
  const ct = useCartT()
  const design = useStore((s) => s.design)
  const previewSize = useStore((s) => s.previewSize)
  const closeModal = useStore((s) => s.closeModal)
  const { context } = useShopBridge()

  const [phase, setPhase] = useState<Phase>('measuring')
  const [sides, setSides] = useState<BridgeSide[] | null>(null)
  const [quote, setQuote] = useState<ShopQuote | null>(null)
  const [outcome, setOutcome] = useState<CartOutcome | null>(null)
  const [errorKey, setErrorKey] = useState<string>('')
  const [errorDetail, setErrorDetail] = useState<string>('')
  // One garment in the size on screen. Not a made-up basket: the customer says
  // what they want, and a shop that guesses "5 M and 5 L" is inventing an order.
  const [grid, setGrid] = useState<Partial<Record<SizeId, number>>>({ [previewSize]: 1 })

  const front = useMockupUrl(design, 'front', 300)
  const back = useMockupUrl(design, 'back', 300)
  const hasBack = sideLayers(design, 'back').length > 0

  const qty = SIZE_IDS.reduce((n, s) => n + (grid[s] ?? 0), 0)
  const productGarment = context?.garment ?? ''
  const mismatch = productGarment !== '' && productGarment !== design.garmentId

  const fail = (key: string, detail = ''): void => {
    setErrorKey(key)
    setErrorDetail(detail)
    setPhase('failed')
  }

  // 1. Measure. Nothing downstream may read an area before this resolves.
  useEffect(() => {
    let alive = true
    setPhase('measuring')
    setSides(null)
    setQuote(null)
    measureOrder(design)
      .then((m) => {
        if (!alive) return
        setSides(m.sides)
        setPhase('ready')
      })
      .catch((e: unknown) => {
        if (!alive) return
        const code = e instanceof DesignUploadError ? e.code : 'server'
        fail(`cart.err.${code}`, e instanceof DesignUploadError ? e.detail : '')
      })
    return () => {
      alive = false
    }
  }, [design])

  // 2. Quote, whenever the measured sides or the quantity change.
  //
  // The bridge gives every request its own id so two answers cannot swap, and
  // this counter is the same rule one layer up: a slow reply must not overwrite
  // a fresher one in the component's state either.
  const quoteSeq = useRef(0)
  useEffect(() => {
    if (!sides || qty < 1 || mismatch) return
    const mine = ++quoteSeq.current
    requestShopQuote({ garment: design.garmentId, qty, sides })
      .then((q) => {
        if (mine === quoteSeq.current) setQuote(q)
      })
      .catch(() => {
        if (mine === quoteSeq.current) setQuote(null)
      })
  }, [sides, qty, mismatch, design.garmentId])

  /*
   * Ask the page for a taller frame if this modal does not fit in it.
   *
   * Measured from the real card, once, and only ever upward. The card is capped
   * at 92vh of the FRAME and the backdrop adds 1.5rem top and bottom
   * (Modal.tsx), so a frame of `content / 0.92 + 48` is the smallest one that
   * shows the whole thing without an inner scrollbar. Asking once is what stops
   * a taller frame from producing a taller measurement and chasing itself.
   */
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const body = bodyRef.current?.parentElement
    const card = body?.parentElement
    if (!body || !card) return
    const chrome = card.clientHeight - body.clientHeight
    requestFrameHeight(Math.ceil((chrome + body.scrollHeight) / 0.92) + 48)
  }, [])

  const setSize = (size: SizeId, n: number): void =>
    setGrid((g) => ({ ...g, [size]: Math.max(0, Math.min(9999, n)) }))

  /*
   * A ref, not the rendered phase.
   *
   * `setPhase` is asynchronous, so two clicks landing in the same tick both
   * read the stale phase and both start. The upload itself is idempotent, but
   * the second add-to-cart would then be refused as already-in-flight and
   * overwrite a success with an error message. The guard has to be synchronous.
   */
  const inFlight = useRef(false)

  async function addToCart(): Promise<void> {
    if (inFlight.current) return
    inFlight.current = true
    try {
      await runAddToCart()
    } finally {
      inFlight.current = false
    }
  }

  async function runAddToCart(): Promise<void> {
    setPhase('uploading')
    let designId: string
    let uploadedSides: BridgeSide[]
    try {
      const uploaded = await uploadDesign(design)
      designId = uploaded.id
      uploadedSides = uploaded.sides
    } catch (e: unknown) {
      const code = e instanceof DesignUploadError ? e.code : 'server'
      fail(`cart.err.${code}`, e instanceof DesignUploadError ? e.detail : '')
      return
    }

    setPhase('adding')
    try {
      // The sides that were STORED with the design, not the ones on screen:
      // the cart line and the manifest the workshop prints from must be priced
      // off the same numbers, or the invoice and the film disagree.
      const result = await addToShopCart({
        garment: design.garmentId,
        qty,
        sides: uploadedSides,
        designId,
        sizeGrid: grid as Record<string, number>,
      })
      setOutcome(result)
      setPhase('done')
    } catch (e: unknown) {
      fail(cartErrorKey(e instanceof Error ? e.message : 'cart_failed'))
    }
  }

  const sideLabel = (id: string): string => ct(`cart.side.${id}`)
  const busy = phase === 'measuring' || phase === 'uploading' || phase === 'adding'
  const busyLabel =
    phase === 'measuring' ? ct('cart.measuring') : phase === 'uploading' ? ct('cart.uploading') : ct('cart.adding')

  const areaLines = (sides ?? []).map((s) =>
    ct('cart.side_area', { side: sideLabel(s.id), sqcm: Math.round(s.area_sq_cm) }),
  )

  return (
    <Modal title={ct('cart.title')} subtitle={ct('cart.subtitle')} onClose={() => closeModal('cart')} size="lg">
      <div ref={bodyRef} className="grid gap-5 sm:grid-cols-[200px_1fr]">
        <div className="flex flex-col gap-3">
          {front && (
            <img src={front} alt={t('order.front_mockup_alt')} className="rounded-xl border border-line bg-bg1 p-2" />
          )}
          {hasBack && back && (
            <img src={back} alt={t('order.back_mockup_alt')} className="rounded-xl border border-line bg-bg1 p-2" />
          )}
          {areaLines.length > 0 && (
            <div className="rounded-lg border border-line bg-bg1 p-3 text-[11.5px] leading-relaxed text-tx2">
              <div className="panel-title mb-1">{ct('cart.printed_sides')}</div>
              {areaLines.map((line) => (
                <div key={line} className="mono-dim">
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {mismatch && (
            <p className="flex gap-2 rounded-lg border border-yl/40 bg-yl/10 p-3 text-[12.5px] leading-relaxed text-tx">
              <TriangleAlert size={15} className="mt-0.5 shrink-0 text-yl" />
              {ct('cart.mismatch', {
                product: t('garment.' + productGarment),
                design: t('garment.' + design.garmentId),
              })}
            </p>
          )}

          <section>
            <div className="panel-title mb-2">{ct('cart.sizes')}</div>
            <div className="grid grid-cols-3 gap-2">
              {SIZE_IDS.map((size) => (
                <div
                  key={size}
                  className="flex items-center justify-between rounded-lg border border-line bg-bg1 px-2 py-1.5"
                >
                  <span className="text-[12px] font-semibold text-tx2">{size}</span>
                  <span className="flex items-center gap-1">
                    <button
                      className="iconbtn h-6 w-6"
                      aria-label={ct('cart.fewer', { size })}
                      onClick={() => setSize(size, (grid[size] ?? 0) - 1)}
                    >
                      <Minus size={12} />
                    </button>
                    <input
                      aria-label={ct('cart.qty_for', { size })}
                      inputMode="numeric"
                      className="w-9 bg-transparent text-center font-mono text-[12.5px] tabular-nums text-tx"
                      value={grid[size] ?? 0}
                      onChange={(e) => setSize(size, Number(e.target.value.replace(/\D/g, '')) || 0)}
                    />
                    <button
                      className="iconbtn h-6 w-6"
                      aria-label={ct('cart.more', { size })}
                      onClick={() => setSize(size, (grid[size] ?? 0) + 1)}
                    >
                      <Plus size={12} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-line bg-bg1 p-4" data-teeshoop="price">
            {quote && qty > 0 ? (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[12.5px] text-tx2">
                    {ct('cart.unit_line', { n: qty, unit: quote.display.unit_ht })}
                  </span>
                  <span
                    className="font-display text-[22px] font-bold tabular-nums text-tx"
                    data-teeshoop="total-ttc"
                  >
                    {quote.display.total_ttc}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 text-[11.5px] text-tx3">
                  <span className="tabular-nums" data-teeshoop="total-ht">
                    {ct('cart.total_ht', { amount: quote.display.total_ht })}
                  </span>
                  <span className="tabular-nums">
                    {ct('cart.vat_note', { pct: Math.round(quote.vat_rate * 100) })}
                  </span>
                </div>
                {quote.discount_rate > 0 && (
                  <div className="mt-2 border-t border-line pt-2 text-[11.5px] font-semibold text-ok">
                    {ct('cart.discount', { pct: Math.round(quote.discount_rate * 100) })}
                  </div>
                )}
                <div className="mt-2 text-[11px] text-tx3">{ct('cart.price_from_shop')}</div>
              </>
            ) : (
              <div className="flex items-center gap-2 text-[12.5px] text-tx2">
                {qty < 1 ? (
                  ct('cart.no_qty')
                ) : (
                  <>
                    <RefreshCw size={14} className="animate-spin text-tx3" />
                    {phase === 'measuring' ? ct('cart.measuring') : ct('cart.pricing')}
                  </>
                )}
              </div>
            )}
          </section>

          {phase === 'failed' && (
            <p
              className="flex gap-2 rounded-lg border border-dg/40 bg-dg/10 p-3 text-[12.5px] leading-relaxed text-tx"
              role="alert"
              data-teeshoop="cart-error"
            >
              <TriangleAlert size={15} className="mt-0.5 shrink-0 text-dg" />
              {ct(errorKey, { detail: errorDetail })}
            </p>
          )}

          {phase === 'done' && outcome ? (
            <div className="flex flex-col gap-2" data-teeshoop="cart-done">
              <p className="flex items-center gap-2 rounded-lg border border-ok/40 bg-ok/10 p-3 text-[13px] font-semibold text-tx">
                <Check size={16} className="shrink-0 text-ok" />
                {ct('cart.added')}
              </p>
              <p className="text-[12px] text-tx2">
                {ct('cart.added_detail', { n: outcome.cartCount })}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <a
                  className="btn btn-primary h-10 flex-1 justify-center"
                  href={outcome.cartUrl}
                  target="_top"
                  rel="noreferrer"
                >
                  {ct('cart.go_to_cart')}
                </a>
                <button className="btn h-10 flex-1 justify-center" onClick={() => closeModal('cart')}>
                  {ct('cart.keep_designing')}
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn btn-primary h-11 w-full justify-center"
              data-teeshoop="add-to-cart"
              disabled={busy || qty < 1 || mismatch || !sides}
              onClick={addToCart}
            >
              {busy ? (
                <>
                  <RefreshCw size={15} className="animate-spin" />
                  {busyLabel}
                </>
              ) : (
                <>
                  <ShoppingBag size={15} />
                  {ct('cart.add')}
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
