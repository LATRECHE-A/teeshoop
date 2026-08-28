/**
 * The two strings the CUSTOMER side switcher needs to say a back image was
 * reconstructed rather than photographed.
 *
 * They used to live in src/app/modals/catalogI18n.ts, which is admin-only: that
 * file also carries `catalog.fr.cost` ("Prix d'achat"), the note explaining the
 * price is negotiated on our Falk&Ross account, and our secret NAMES. Because
 * SideSwitcher and ProductPanel imported it STATICALLY, all of that landed in
 * the customer's first-paint chunk. Splitting the two keys out is what cuts
 * that edge.
 *
 * The keys keep their `catalog.*` names and their exact wording: catalogI18n
 * spreads them back in, so the admin catalogue still shows the identical text.
 * One wording for one concept.
 */
import { useStore } from '@/state/store'
import { resolve, type TParams } from '@/i18n'

export const I18N: Record<'fr' | 'en', Record<string, string>> = {
  fr: {
    'catalog.card.back_generated': 'Dos reconstitué',
    'catalog.back_preview_tip':
      'Dos reconstitué à partir de la face. C’est un aperçu, pas une photo du produit.',
  },
  en: {
    'catalog.card.back_generated': 'Reconstructed back',
    'catalog.back_preview_tip':
      'Back reconstructed from the front. A preview, not a photo of the product.',
  },
}

function format(str: string, params?: TParams): string {
  if (!params) return str
  return str.replace(/\{(\w+)\}/g, (m, k: string) =>
    Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m,
  )
}

/** Resolves the two keys above locally; anything else falls through to i18n. */
export function useBackOriginT(): (key: string, params?: TParams) => string {
  const lang = useStore((s) => s.lang)
  return (key, params) => {
    const local = I18N[lang]?.[key] ?? I18N.fr[key]
    return local !== undefined ? format(local, params) : resolve(lang, key, params)
  }
}
