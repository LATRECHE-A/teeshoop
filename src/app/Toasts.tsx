import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import { useStore } from '@/state/store'
import { useT } from '@/i18n'
import clsx from 'clsx'

const ICONS = {
  info: Info,
  ok: CircleCheck,
  warn: TriangleAlert,
  error: CircleAlert,
} as const

const COLORS = {
  info: 'text-cy',
  ok: 'text-ok',
  warn: 'text-yl',
  error: 'text-dg',
} as const

export default function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)
  const tr = useT()
  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-[72px] left-1/2 z-[80] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind]
        return (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-line bg-bg2/95 px-3 py-2.5 shadow-xl backdrop-blur"
            style={{ animation: 'toast-in .22s ease both' }}
          >
            <Icon size={16} className={clsx('mt-px shrink-0', COLORS[t.kind])} />
            <div className="flex-1 text-[13px] leading-snug text-tx">{t.msg}</div>
            <button className="iconbtn -mr-1 -mt-1 h-6 w-6" onClick={() => dismiss(t.id)} aria-label={tr('common.dismiss')}>
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
