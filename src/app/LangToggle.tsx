import clsx from 'clsx'
import { useStore } from '@/state/store'
import { LANGS, LANG_LABEL, LANG_SHORT } from '@/i18n/lang'
import { useT } from '@/i18n'

/** FR / EN language selector: a compact segmented pill. */
export default function LangToggle() {
  const lang = useStore((s) => s.lang)
  const setLang = useStore((s) => s.setLang)
  const t = useT()

  return (
    <div
      role="group"
      aria-label={t('lang.select')}
      className="flex h-8 items-center rounded-full border border-line bg-bg2 p-0.5"
    >
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={lang === l}
          title={LANG_LABEL[l]}
          onClick={() => setLang(l)}
          className={clsx(
            'flex h-7 items-center rounded-full px-2.5 text-[11.5px] font-bold tracking-wide transition-colors',
            lang === l ? 'bg-bg3 text-tx' : 'text-tx3 hover:text-tx2',
          )}
        >
          {LANG_SHORT[l]}
        </button>
      ))}
    </div>
  )
}
