import { Moon, Sun } from 'lucide-react'
import { useStore } from '@/state/store'
import { useT } from '@/i18n/useT'

/** Light ↔ dark theme toggle. Shows the icon of the theme you'll switch TO. */
export default function ThemeToggle() {
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const t = useT()
  const label = t(theme === 'dark' ? 'theme.to_light' : 'theme.to_dark')

  return (
    <button
      type="button"
      className="iconbtn h-8 w-8 border border-line bg-bg2"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      aria-label={label}
      title={label}
    >
      {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  )
}
