/**
 * Store-free i18n for the AR entry. The studio's `@/i18n` hook imports the
 * Zustand store; the AR bundle must not, so it resolves against the shared
 * message dictionary directly, reading the persisted language the same way the
 * index.html no-FOUC script does.
 */
import { messages } from '@/i18n/messages'
import { isLang, type Lang } from '@/i18n/lang'

function readLang(): Lang {
  try {
    const p = JSON.parse(localStorage.getItem('tshop:prefs') || '{}')
    if (isLang(p.lang)) return p.lang
  } catch {
    /* ignore */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'fr'
  return nav.startsWith('en') ? 'en' : 'fr'
}

const LANG = readLang()

export function art(key: string, params?: Record<string, string | number>): string {
  const str = messages[LANG]?.[key] ?? messages.fr[key] ?? messages.en[key] ?? key
  if (!params) return str
  return str.replace(/\{(\w+)\}/g, (m, k: string) =>
    Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m,
  )
}

export { LANG }
