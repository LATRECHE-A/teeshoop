/**
 * Strings for the workshop tools menu. They lived in src/i18n/messages.ts,
 * which every build loads; here they load only with admin.html.
 *
 * The catalogue entry card reads its own labels from catalogI18n, which the
 * admin build already pulls in with CatalogModal — no need to duplicate them.
 */
import { useStore } from '@/state/store'
import { resolve, type TParams } from '@/i18n'

export const I18N: Record<'fr' | 'en', Record<string, string>> = {
  fr: {
    'admin.menu': 'Outils admin',
    'admin.dtf': 'Planches DTF (impression)',
    'admin.products': 'Ingestion produit',
  },
  en: {
    'admin.menu': 'Admin tools',
    'admin.dtf': 'DTF gang sheets (print)',
    'admin.products': 'Product ingest',
  },
}

function format(str: string, params?: TParams): string {
  if (!params) return str
  return str.replace(/\{(\w+)\}/g, (m, k: string) =>
    Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m,
  )
}

export function useAdminT(): (key: string, params?: TParams) => string {
  const lang = useStore((s) => s.lang)
  return (key, params) => {
    const local = I18N[lang]?.[key] ?? I18N.fr[key]
    return local !== undefined ? format(local, params) : resolve(lang, key, params)
  }
}
