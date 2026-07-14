import { useState } from 'react'
import { Box, PencilRuler } from 'lucide-react'
import { useStore } from '@/state/store'
import clsx from 'clsx'

const SEEN_3D = 'tshop:3d-tried'

/**
 * The 2D ↔ 3D switch — deliberately the loudest control on the page.
 * 2D is the default (light on the GPU); the 3D side glows to invite a try.
 */
export default function ModeToggle() {
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)
  const [tried, setTried] = useState(() => {
    try {
      return !!localStorage.getItem(SEEN_3D)
    } catch {
      return true
    }
  })

  const try3d = () => {
    setMode('3d')
    if (!tried) {
      setTried(true)
      try {
        localStorage.setItem(SEEN_3D, '1')
      } catch {
        /* ignore */
      }
    }
  }

  return (
    <div
      role="group"
      aria-label="Preview mode"
      className={clsx(
        'relative flex h-9 items-center rounded-full border border-line bg-bg2 p-1',
        !tried && mode === '2d' && 'pulse-ring',
      )}
    >
      <button
        type="button"
        aria-pressed={mode === '2d'}
        onClick={() => setMode('2d')}
        className={clsx(
          'flex h-7 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold transition-colors',
          mode === '2d' ? 'bg-bg3 text-tx' : 'text-tx3 hover:text-tx2',
        )}
      >
        <PencilRuler size={14} />
        2D
      </button>
      <button
        type="button"
        aria-pressed={mode === '3d'}
        onClick={try3d}
        className={clsx(
          'flex h-7 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-bold transition-all',
          mode === '3d'
            ? 'grad-ink text-white shadow-[0_2px_16px_rgba(123,108,255,0.45)]'
            : 'text-grad-ink hover:brightness-125',
        )}
      >
        <Box size={14} className={mode === '3d' ? '' : 'text-vi'} />
        3D
        {!tried && (
          <span className="ml-0.5 rounded-full bg-mg/20 px-1.5 py-px text-[9px] font-bold tracking-wider text-mg">
            TRY
          </span>
        )}
      </button>
    </div>
  )
}
