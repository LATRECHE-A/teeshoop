/**
 * Basket: UI strings side-file (module-owned; the integrator merges I18N into
 * src/i18n/messages.ts). French is first-class, English faithful.
 *
 * `useBasketT` resolves `basket.*` keys from THIS file immediately (so the
 * module works before the merge) and falls back to the global runtime for
 * shared keys (common.*, garment.*). After the merge both paths yield
 * identical strings.
 */
import { useStore } from '@/state/store'
import { resolve, type TParams } from '@/i18n'

export const I18N: Record<'fr' | 'en', Record<string, string>> = {
  fr: {
    'basket.title': 'Panier',
    'basket.subtitle':
      'Une commande = plusieurs produits, tailles et quantités.',
    'basket.open': 'Ouvrir le panier',
    'basket.count': '{n} article(s) au panier',
    'basket.empty':
      'Panier vide. Ajoutez le design en cours, puis changez de produit, de couleur ou de taille et ajoutez-le à nouveau.',
    'basket.add_current': 'Ajouter le design en cours',
    'basket.added': '« {name} » ajouté au panier ({size})',
    'basket.line_size': 'Taille {size}',
    'basket.line_sides': 'Impression : {sides}',
    'basket.line_no_print': 'Aucun côté imprimé',
    'basket.qty': 'Quantité pour {name}',
    'basket.fewer': 'Moins de {name}',
    'basket.more': 'Plus de {name}',
    'basket.remove': 'Retirer {name}',
    'basket.removed': '« {name} » retiré du panier',
    'basket.clear': 'Vider le panier',
    'basket.cleared': 'Panier vidé',
    'basket.totals.title': 'Total commande',
    'basket.totals.garments': 'Vêtements',
    'basket.totals.lines': 'Lignes',
    'basket.totals.prints': 'Transferts',
    'basket.totals.by_side': '{front} devant · {back} dos · {sleeve} manche',
  },
  en: {
    'basket.title': 'Basket',
    'basket.subtitle':
      'One order = several products, sizes and quantities.',
    'basket.open': 'Open the basket',
    'basket.count': '{n} item(s) in the basket',
    'basket.empty':
      'The basket is empty. Add the current design, then switch product, colour or size and add it again.',
    'basket.add_current': 'Add the current design',
    'basket.added': '“{name}” added to the basket ({size})',
    'basket.line_size': 'Size {size}',
    'basket.line_sides': 'Printed: {sides}',
    'basket.line_no_print': 'No printed side',
    'basket.qty': 'Quantity for {name}',
    'basket.fewer': 'Fewer {name}',
    'basket.more': 'More {name}',
    'basket.remove': 'Remove {name}',
    'basket.removed': '“{name}” removed from the basket',
    'basket.clear': 'Empty the basket',
    'basket.cleared': 'Basket emptied',
    'basket.totals.title': 'Order total',
    'basket.totals.garments': 'Garments',
    'basket.totals.lines': 'Lines',
    'basket.totals.prints': 'Transfers',
    'basket.totals.by_side': '{front} front · {back} back · {sleeve} sleeve',
  },
}

function format(str: string, params?: TParams): string {
  if (!params) return str
  return str.replace(/\{(\w+)\}/g, (m, k: string) =>
    Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m,
  )
}

/**
 * Reactive translate for the basket UI: `basket.*` resolves from this
 * side-file; anything else falls through to the global i18n runtime.
 */
export function useBasketT(): (key: string, params?: TParams) => string {
  const lang = useStore((s) => s.lang)
  return (key, params) => {
    const local = I18N[lang]?.[key] ?? I18N.fr[key]
    return local !== undefined ? format(local, params) : resolve(lang, key, params)
  }
}
