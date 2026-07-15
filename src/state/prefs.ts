/**
 * UI preferences (theme, language, scene) — persisted separately from the
 * design document. These are NOT part of the undoable `design` and never enter
 * the history; they live in localStorage under a single key and are applied
 * synchronously at boot (matched by an inline script in index.html) so there
 * is no flash of the wrong theme/language.
 */
import { DEFAULT_LANG, isLang, type Lang } from '@/i18n/lang'
import { isSceneId, type SceneId } from '@/scenes'

export type Theme = 'dark' | 'light'

export interface Prefs {
  theme: Theme
  lang: Lang
  scene: SceneId
}

export const PREFS_KEY = 'tshop:prefs'

export const DEFAULT_PREFS: Prefs = {
  theme: 'dark',
  lang: DEFAULT_LANG,
  scene: 'studio',
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return { ...DEFAULT_PREFS }
    const p = JSON.parse(raw) as Partial<Prefs>
    return {
      theme: p.theme === 'light' ? 'light' : 'dark',
      lang: isLang(p.lang) ? p.lang : DEFAULT_PREFS.lang,
      scene: isSceneId(p.scene) ? p.scene : DEFAULT_PREFS.scene,
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    /* private mode / storage full — prefs simply won't persist */
  }
}

const THEME_META_COLOR: Record<Theme, string> = {
  dark: '#0c0f13',
  light: '#eceae3',
}

/** Reflect the theme onto <html> so the CSS token overrides + form controls
 * pick it up. Safe to call before React mounts. */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.theme = theme
  root.style.colorScheme = theme
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEME_META_COLOR[theme])
}

/** Reflect the language onto <html lang> for a11y / hyphenation. */
export function applyLang(lang: Lang): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = lang
}
