/**
 * React shell for the 3D board: WebGL probe, lazy chunk with a retry boundary,
 * the texture budget, and the accessible product list.
 *
 * A `<canvas>` is opaque to assistive technology, so the same products are also
 * rendered as a visually-hidden list of real buttons driving the same
 * `focusLine`. That is not a consolation prize — it is the only way the 3D board
 * is operable at all without a pointer, and it costs a dozen DOM nodes.
 *
 * There is deliberately no "view in AR" here: AR shows one garment on one body,
 * which is meaningless for a board. The button is hidden rather than disabled
 * for the same reason it exists elsewhere — it would be an offer we cannot keep.
 */
import { Component, lazy, Suspense, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { useStore } from '@/state/store'
import { BOARD_MAX_2D, boardCap3D, boardTextureTargetPx } from '@/state/board'
import { stageBackground } from '@/scenes'
import type { Board3DProps } from '@/three/Board3D'
import { RegMark } from './Brand'
import { useIsMobile } from './hooks/useIsMobile'
import { useBoardT } from './board/boardI18n'
import {
  keepBoardTextures,
  scheduleClearBoardTextures,
  useBoardProducts,
} from './board/useBoardTextures'

const loadBoard3D = () => lazy(() => import('@/three/Board3D'))

/** React.lazy caches a failed chunk load forever — one flaky request would
 *  otherwise blank the board until a full reload. */
class RetryBoundary extends Component<
  { children: ReactNode; onRetry: () => void; label: string },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="flex h-full items-center justify-center">
        <button
          className="btn"
          onClick={() => {
            this.setState({ failed: false })
            this.props.onRetry()
          }}
        >
          {this.props.label}
        </button>
      </div>
    )
  }
}

function webglOk(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

export default function Board3DStage() {
  const t = useBoardT()
  const basket = useStore((s) => s.basket)
  const selectedIds = useStore((s) => s.board.selectedIds)
  const scene = useStore((s) => s.scene)
  const theme = useStore((s) => s.theme)
  const focusLine = useStore((s) => s.focusLine)
  const isMobile = useIsMobile()
  const [Board3D, setBoard3D] = useState<ComponentType<Board3DProps>>(loadBoard3D)
  // Mirrored onto the DOM as `data-board3d-ready` so scripts/board-verify.mjs
  // can time the real first frame instead of guessing with a sleep.
  const [ready, setReady] = useState(false)
  const gl = useMemo(webglOk, [])

  const lines = useMemo(
    () => basket.filter((l) => selectedIds.includes(l.id)).slice(0, BOARD_MAX_2D),
    [basket, selectedIds],
  )
  const cap = boardCap3D(isMobile)
  const solid = Math.min(cap, lines.length)
  const targetPx = boardTextureTargetPx(solid, isMobile)
  const products = useBoardProducts(lines, cap, targetPx)

  // Paired keep/clear: see useBoardTextures — StrictMode's cleanup must not
  // zero a canvas the re-mounted textures still reference.
  useEffect(() => {
    keepBoardTextures()
    return () => scheduleClearBoardTextures()
  }, [])

  const bg = stageBackground(scene, theme)

  if (lines.length === 0 || !gl)
    return (
      <div className="absolute inset-0 flex items-center justify-center px-8 text-center">
        <p className="max-w-sm text-[13px] leading-relaxed text-tx2">
          {lines.length === 0 ? t('board.empty') : t('three.unavailable_body')}
        </p>
      </div>
    )

  return (
    <div
      className={`absolute inset-0 ${bg.className}`}
      style={bg.style}
      data-board3d-ready={ready ? '' : undefined}
    >
      <RetryBoundary label={t('three.try_again')} onRetry={() => setBoard3D(loadBoard3D)}>
        <Suspense
          fallback={
            <div className="flex h-full flex-col items-center justify-center gap-4">
              <RegMark size={44} className="spin-slow" />
            </div>
          }
        >
          <Board3D
            products={products}
            scene={scene}
            onFocus={focusLine}
            onReady={() => setReady(true)}
          />
        </Suspense>
      </RetryBoundary>

      {/* Screen-reader equivalent of the canvas: the same products, the same
          action, in the same order. */}
      <ul className="sr-only" aria-label={t('board.products')}>
        {lines.map((line) => (
          <li key={line.id}>
            <button type="button" onClick={() => focusLine(line.id)}>
              {t('board.tile', {
                name: line.label,
                garment: line.garmentLabel,
                size: line.size,
                qty: line.qty,
              })}
            </button>
          </li>
        ))}
      </ul>

      {lines.length > solid && (
        <p className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full border border-yl/30 bg-yl/10 px-3 py-1 text-[11.5px] text-yl">
          {t('board.cap_3d', { solid, flat: lines.length - solid })}
        </p>
      )}
    </div>
  )
}
