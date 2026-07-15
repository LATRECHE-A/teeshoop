import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import clsx from 'clsx'
import { useT } from '@/i18n'

export default function Modal({
  title,
  subtitle,
  onClose,
  children,
  size = 'md',
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
  size?: 'md' | 'lg'
}) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(
      'input, textarea, button:not([data-close])',
    )
    el?.focus({ preventScroll: true })
  }, [])

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={ref}
        className={clsx(
          'flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-bg2 shadow-2xl sm:rounded-2xl',
          size === 'md' ? 'sm:max-w-[560px]' : 'sm:max-w-[760px]',
        )}
        style={{ animation: 'toast-in .18s ease both' }}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display text-[16px] font-bold text-tx">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[12.5px] text-tx2">{subtitle}</p>}
          </div>
          <button data-close className="iconbtn -mr-1" onClick={onClose} aria-label={t('common.close')}>
            <X size={17} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}
