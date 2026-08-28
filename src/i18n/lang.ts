/**
 * Language state, deliberately decoupled from the zustand store so that
 * `t()` can be called from non-React code (store actions, persistence,
 * offscreen renderers) without importing the store, and so the store can
 * import THIS without a cycle.
 */
export type Lang = 'fr' | 'en'

export const LANGS: Lang[] = ['fr', 'en']
export const DEFAULT_LANG: Lang = 'fr'

export const LANG_LABEL: Record<Lang, string> = {
  fr: 'Français',
  en: 'English',
}

/** Short header-chip label. */
export const LANG_SHORT: Record<Lang, string> = {
  fr: 'FR',
  en: 'EN',
}

let current: Lang = DEFAULT_LANG

export function getLang(): Lang {
  return current
}

export function setCurrentLang(lang: Lang): void {
  current = lang
}

export function isLang(v: unknown): v is Lang {
  return v === 'fr' || v === 'en'
}
