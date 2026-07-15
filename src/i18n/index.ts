/**
 * Tiny i18n runtime. French is the source-of-truth default; English is the
 * alternate. Keys are namespaced by area (e.g. `topbar.save`, `common.cancel`).
 *
 * Two entry points:
 *  - `t(key, params?)` — reads the current language from the decoupled
 *    `lang` module, so it works everywhere (store actions, toasts, offscreen
 *    renderers), not only inside React.
 *  - `useT()` — a hook that subscribes to the store's `lang` so components
 *    re-render when the language switches.
 *
 * Interpolation: `"{n} calques"` with `t(key, { n: 3 })`.
 */
import { useStore } from '@/state/store'
import { getLang, type Lang } from './lang'
import { messages } from './messages'

export type TParams = Record<string, string | number>

function format(str: string, params?: TParams): string {
  if (!params) return str
  return str.replace(/\{(\w+)\}/g, (m, k: string) =>
    Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m,
  )
}

/** Resolve a key in an explicit language, falling back fr → en → key. */
export function resolve(lang: Lang, key: string, params?: TParams): string {
  const str =
    messages[lang]?.[key] ?? messages.fr[key] ?? messages.en[key] ?? key
  return format(str, params)
}

/** Language-agnostic translate; reads the current global language. */
export function t(key: string, params?: TParams): string {
  return resolve(getLang(), key, params)
}

/** Reactive translate bound to the store's current language. */
export function useT(): (key: string, params?: TParams) => string {
  const lang = useStore((s) => s.lang)
  return (key: string, params?: TParams) => resolve(lang, key, params)
}
