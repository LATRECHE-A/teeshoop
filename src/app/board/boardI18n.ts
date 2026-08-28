/**
 * Board mode: UI strings side-file (module-owned; the integrator merges I18N
 * into src/i18n/messages.ts). French is first-class, English faithful.
 *
 * `useBoardT` resolves `board.*` keys from THIS file immediately (so the module
 * works before the merge) and falls back to the global runtime for shared keys
 * (common.*, garment.*). After the merge both paths yield identical strings.
 * Same pattern as src/app/modals/basketI18n.ts.
 */
import { useStore } from '@/state/store'
import { resolve, type TParams } from '@/i18n'

export const I18N: Record<'fr' | 'en', Record<string, string>> = {
  fr: {
    'board.open': 'Voir le tableau',
    'board.open_hint':
      'Affiche tous les produits du panier côte à côte, en 2D puis en 3D. Cliquez un produit pour le modifier.',
    'board.title': 'Tableau',
    'board.exit': 'Quitter le tableau',
    'board.empty': 'Aucun produit sélectionné. Cochez au moins une ligne du panier.',
    'board.count': '{n} sur {total} produits affichés',
    'board.select_all': 'Tout sélectionner',
    'board.select_none': 'Tout désélectionner',
    'board.tile': '{name}, {garment}, taille {size}, ×{qty}',
    'board.tile_hint': 'Cliquez pour modifier ce produit',
    'board.tile_select': 'Afficher {name} sur le tableau',
    'board.missing_asset': 'Image manquante',
    'board.missing_asset_hint':
      'Un visuel de cette ligne a été supprimé de la bibliothèque : il ne peut plus être imprimé.',
    'board.focus': 'Modifier',
    'board.focused': 'Produit ciblé',
    'board.unfocus': 'Retour au tableau',
    'board.unfocus_hint': 'Enregistre les modifications dans la ligne du panier',
    'board.tools_locked': 'Sélectionnez un produit pour l’éditer',
    'board.products': 'Produits du tableau',
    'board.zoom_in': 'Zoom avant',
    'board.zoom_out': 'Zoom arrière',
    'board.fit': 'Tout afficher',
    'board.cap_2d': '{shown} produits affichés sur {total} (limite du tableau).',
    'board.cap_3d': '{solid} en 3D · {flat} en aperçu plat (limite mémoire).',
    'board.no_ar':
      'La réalité augmentée affiche un seul vêtement : ciblez un produit pour l’essayer.',
    'board.a11y.entered': 'Tableau ouvert, {n} produits.',
    'board.a11y.focused': 'Produit ciblé : {name}, taille {size}. Outils d’édition actifs.',
    'board.a11y.unfocused': 'Retour au tableau, {n} produits.',
    'board.a11y.exited': 'Tableau fermé.',
  },
  en: {
    'board.open': 'Open the board',
    'board.open_hint':
      'Shows every basket product side by side, in 2D then in 3D. Click a product to edit it.',
    'board.title': 'Board',
    'board.exit': 'Leave the board',
    'board.empty': 'No product selected. Tick at least one basket line.',
    'board.count': '{n} of {total} products shown',
    'board.select_all': 'Select all',
    'board.select_none': 'Select none',
    'board.tile': '{name}, {garment}, size {size}, ×{qty}',
    'board.tile_hint': 'Click to edit this product',
    'board.tile_select': 'Show {name} on the board',
    'board.missing_asset': 'Missing image',
    'board.missing_asset_hint':
      'An upload used by this line was deleted from the library: it can no longer be printed.',
    'board.focus': 'Edit',
    'board.focused': 'Focused product',
    'board.unfocus': 'Back to the board',
    'board.unfocus_hint': 'Saves the changes into the basket line',
    'board.tools_locked': 'Pick a product to edit it',
    'board.products': 'Board products',
    'board.zoom_in': 'Zoom in',
    'board.zoom_out': 'Zoom out',
    'board.fit': 'Fit everything',
    'board.cap_2d': '{shown} of {total} products shown (board limit).',
    'board.cap_3d': '{solid} in 3D · {flat} as flat previews (memory limit).',
    'board.no_ar': 'AR shows a single garment: focus a product to try it on.',
    'board.a11y.entered': 'Board open, {n} products.',
    'board.a11y.focused': 'Focused product: {name}, size {size}. Editing tools active.',
    'board.a11y.unfocused': 'Back to the board, {n} products.',
    'board.a11y.exited': 'Board closed.',
  },
}

function format(str: string, params?: TParams): string {
  if (!params) return str
  return str.replace(/\{(\w+)\}/g, (m, k: string) =>
    Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m,
  )
}

export type BoardT = (key: string, params?: TParams) => string

/**
 * Reactive translate for the board UI: `board.*` resolves from this side-file;
 * anything else falls through to the global i18n runtime.
 */
export function useBoardT(): BoardT {
  const lang = useStore((s) => s.lang)
  return (key, params) => {
    const local = I18N[lang]?.[key] ?? I18N.fr[key]
    return local !== undefined ? format(local, params) : resolve(lang, key, params)
  }
}
