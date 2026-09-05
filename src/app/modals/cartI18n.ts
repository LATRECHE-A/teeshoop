/**
 * Add to basket, UI strings side-file (module-owned; the integrator merges I18N
 * into src/i18n/messages.ts). French is first-class, English faithful.
 *
 * EVERY FAILURE HAS A SENTENCE, and every sentence says what happened, whether
 * money moved, and what to do next. "Rien n'a été ajouté au panier" is on the
 * errors that could plausibly have half-worked, because the first question a
 * buyer asks after a failed purchase is whether they have been charged.
 *
 * No price is written here. Amounts are the strings the server sends
 * (Money::format), already in French, so the studio never formats, rounds or
 * divides a price of its own.
 */
import { useStore } from '@/state/store'
import { resolve, type TParams } from '@/i18n'

export const I18N: Record<'fr' | 'en', Record<string, string>> = {
  fr: {
    // The top bar OPENS this panel, it does not add anything, so it says so.
    'cart.open': 'Commander',
    'cart.title': 'Ajouter au panier',
    'cart.subtitle': 'Choisissez les tailles, puis ajoutez la création à votre panier.',
    'cart.sizes': 'Tailles et quantités',
    'cart.qty_for': 'Quantité en {size}',
    'cart.fewer': 'Retirer une pièce en {size}',
    'cart.more': 'Ajouter une pièce en {size}',
    'cart.printed_sides': 'Faces imprimées',
    'cart.side.front': 'Devant',
    'cart.side.back': 'Dos',
    'cart.side.sleeve': 'Manche',
    'cart.side_area': '{side} : {sqcm} cm²',
    'cart.measuring': 'Mesure de la surface imprimée',
    'cart.pricing': 'Calcul du prix par la boutique',
    'cart.uploading': 'Envoi de votre création',
    'cart.adding': 'Ajout au panier',
    'cart.unit_line': '{n} × {unit} HT la pièce',
    'cart.total_ttc': 'Total TTC',
    'cart.total_ht': '{amount} HT',
    'cart.vat_note': 'TVA {pct} % incluse',
    'cart.discount': 'Remise quantité {pct} %',
    'cart.price_from_shop': 'Prix calculé par la boutique.',
    'cart.add': 'Ajouter au panier',
    'cart.added': 'Ajouté au panier',
    'cart.added_detail': 'Votre panier contient {n} article(s).',
    'cart.go_to_cart': 'Voir le panier',
    'cart.keep_designing': 'Continuer la création',
    'cart.no_qty': 'Indiquez au moins une taille pour continuer.',
    'cart.mismatch':
      'Cette page vend un article « {product} » et votre création est sur un « {design} ». Ouvrez la fiche du bon produit pour commander celui-ci.',
    'cart.colour_gone':
      'Ce vêtement n’existe pas dans la couleur de votre création. Choisissez une des couleurs proposées sur cette page, puis réessayez.',
    'cart.chart_gone':
      'Cette création a été calée sur les mesures d’un autre article. Le marquage ne grandirait pas comme il faut d’une taille à l’autre. Rouvrez la page de l’article d’origine, ou repartez d’une nouvelle création sur celui-ci.',

    'cart.err.no_printable_side':
      'Il n’y a rien à imprimer. Ajoutez un visuel ou du texte sur une face, puis réessayez.',
    'cart.err.unmeasurable':
      'La surface imprimée de « {detail} » n’a pas pu être mesurée, donc le prix serait faux. Rechargez la page, ou remplacez ce visuel.',
    'cart.err.missing_artwork':
      'L’image « {detail} » n’est plus enregistrée dans ce navigateur. Réimportez-la avant de commander, sinon l’atelier n’aurait rien à imprimer.',
    'cart.err.preview_failed':
      'L’aperçu de votre création n’a pas pu être généré. Rechargez la page, puis réessayez.',
    'cart.err.too_large':
      'Votre création dépasse la taille acceptée. Réexportez vos images en PNG ou en JPEG, plus petites, puis réessayez.',
    'cart.err.rejected':
      'Le serveur a refusé cette création. Rien n’a été ajouté au panier. Écrivez-nous si cela se reproduit.',
    'cart.err.server':
      'Votre création n’a pas pu être enregistrée. Rien n’a été ajouté au panier ; réessayez dans un instant.',
    'cart.err.network':
      'La connexion a été perdue pendant l’envoi. Rien n’a été ajouté au panier ; réessayez.',
    'cart.err.expired': 'Votre session a expiré. Rechargez la page, puis réessayez.',
    'cart.err.design_not_found':
      'La boutique n’a pas retrouvé votre création sur le serveur. Rien n’a été ajouté au panier ; réessayez.',
    'cart.err.timeout':
      'La boutique n’a pas répondu. Rien n’a été ajouté au panier ; vérifiez votre panier avant de réessayer.',
    'cart.err.cart':
      'La boutique n’a pas ajouté l’article. Rien n’a été ajouté au panier et rien n’a été facturé.',
    'cart.err.in_flight':
      'Un ajout est déjà en cours. Ne recommencez pas : vérifiez votre panier dans un instant.',
    'cart.err.quote':
      'Le prix n’a pas pu être obtenu auprès de la boutique. Rechargez la page ; sans prix, rien ne peut être ajouté au panier.',
    'cart.needs_quote':
      'À cette quantité, nous chiffrons la commande à la main : le tissu, la production et le transport ne se calculent plus seuls. Revenez sur la fiche produit et demandez un devis, votre création est conservée.',
    'cart.err.needs_quote':
      'À cette quantité, la commande se chiffre à la main. Rien n’a été ajouté au panier. Demandez un devis depuis la fiche produit.',
  },
  en: {
    'cart.open': 'Order',
    'cart.title': 'Add to basket',
    'cart.subtitle': 'Choose the sizes, then add this design to your basket.',
    'cart.sizes': 'Sizes and quantities',
    'cart.qty_for': 'Quantity in {size}',
    'cart.fewer': 'One fewer in {size}',
    'cart.more': 'One more in {size}',
    'cart.printed_sides': 'Printed sides',
    'cart.side.front': 'Front',
    'cart.side.back': 'Back',
    'cart.side.sleeve': 'Sleeve',
    'cart.side_area': '{side}: {sqcm} cm²',
    'cart.measuring': 'Measuring the printed area',
    'cart.pricing': 'The shop is pricing this',
    'cart.uploading': 'Sending your design',
    'cart.adding': 'Adding to the basket',
    'cart.unit_line': '{n} × {unit} excl. VAT each',
    'cart.total_ttc': 'Total incl. VAT',
    'cart.total_ht': '{amount} excl. VAT',
    'cart.vat_note': 'Includes {pct} % VAT',
    'cart.discount': 'Quantity discount {pct} %',
    'cart.price_from_shop': 'Priced by the shop.',
    'cart.add': 'Add to basket',
    'cart.added': 'Added to the basket',
    'cart.added_detail': 'Your basket now holds {n} item(s).',
    'cart.go_to_cart': 'View the basket',
    'cart.keep_designing': 'Keep designing',
    'cart.no_qty': 'Pick at least one size to continue.',
    'cart.mismatch':
      'This page sells a “{product}” and your design is on a “{design}”. Open the right product page to order this one.',
    'cart.colour_gone':
      'This garment does not come in your design’s colour. Pick one of the colours offered on this page, then try again.',
    'cart.chart_gone':
      'This design was fitted to another item’s measurements, so the print would not grow correctly from one size to the next. Reopen that item’s page, or start a new design on this one.',

    'cart.err.no_printable_side':
      'There is nothing to print. Add artwork or text to a side, then try again.',
    'cart.err.unmeasurable':
      'The printed area of “{detail}” could not be measured, so the price would be wrong. Reload the page, or replace that artwork.',
    'cart.err.missing_artwork':
      'The image “{detail}” is no longer stored in this browser. Import it again before ordering, or the workshop would have nothing to print.',
    'cart.err.preview_failed':
      'The preview of your design could not be generated. Reload the page, then try again.',
    'cart.err.too_large':
      'Your design is larger than we accept. Re-export your images as PNG or JPEG, smaller, then try again.',
    'cart.err.rejected':
      'The server refused this design. Nothing was added to the basket. Write to us if it happens again.',
    'cart.err.server':
      'Your design could not be stored. Nothing was added to the basket; try again in a moment.',
    'cart.err.network':
      'The connection dropped while sending. Nothing was added to the basket; try again.',
    'cart.err.expired': 'Your session expired. Reload the page, then try again.',
    'cart.err.design_not_found':
      'The shop could not find your design on the server. Nothing was added to the basket; try again.',
    'cart.err.timeout':
      'The shop did not answer. Nothing was added to the basket; check your basket before trying again.',
    'cart.err.cart':
      'The shop did not add the item. Nothing was added to the basket and nothing was charged.',
    'cart.err.in_flight':
      'An add is already running. Do not start another one; check your basket in a moment.',
    'cart.err.quote':
      'The price could not be obtained from the shop. Reload the page; without a price nothing can be added to the basket.',
    'cart.needs_quote':
      'At this quantity we price the order by hand: the fabric, the production and the carriage no longer work themselves out. Go back to the product page and ask for a quote; your design is kept.',
    'cart.err.needs_quote':
      'At this quantity the order is priced by hand. Nothing was added to the basket. Ask for a quote from the product page.',
  },
}

function format(str: string, params?: TParams): string {
  if (!params) return str
  return str.replace(/\{(\w+)\}/g, (m, k: string) =>
    Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m,
  )
}

/**
 * Reactive translate for the basket flow: `cart.*` resolves from this side-file;
 * anything else falls through to the global i18n runtime.
 */
export function useCartT(): (key: string, params?: TParams) => string {
  const lang = useStore((s) => s.lang)
  return (key, params) => {
    const local = I18N[lang]?.[key] ?? I18N.fr[key]
    return local !== undefined ? format(local, params) : resolve(lang, key, params)
  }
}
