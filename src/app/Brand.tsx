import { BUSINESS } from '@/config'

/** Print registration-mark brand icon. */
export function RegMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 54 54" width={size} height={size} fill="none" className={className} aria-hidden>
      <circle cx="27" cy="27" r="16" stroke="#35C7FF" strokeWidth="3" />
      <path
        d="M27 2v12M27 40v12M2 27h12M40 27h12"
        stroke="#FF3D8F"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="27" cy="27" r="3.2" fill="#EEF1F5" />
    </svg>
  )
}

export function Brand() {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <RegMark />
      <div className="leading-none">
        <div className="font-display text-[15px] font-bold tracking-[0.24em] text-tx">
          TSHOP
        </div>
        <div className="mt-0.5 hidden text-[10px] tracking-[0.08em] text-tx3 sm:block">
          {BUSINESS.tagline.toUpperCase()}
        </div>
      </div>
    </div>
  )
}
