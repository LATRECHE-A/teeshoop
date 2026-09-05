/**
 * Tiny i18n runtime. French is the source-of-truth default; English is the
 * alternate. Keys are namespaced by area (e.g. `topbar.save`, `common.cancel`).
 *
 * Two entry points, IN TWO FILES, and the split is load-bearing:
 *  - `t(key, params?)` is here. It reads the current language from the
 *    decoupled `lang` module, so it works everywhere (store actions, toasts,
 *    offscreen renderers), not only inside React, and this file imports
 *    nothing but `./lang` and `./messages`.
 *  - `useT()` lives in `./useT`, because it subscribes through `useStore` and
 *    that import used to drag the whole application store into everything that
 *    merely wanted a string. See the header of that file for what it cost.
 *
 * Interpolation: `"{n} calques"` with `t(key, { n: 3 })`.
 */
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

