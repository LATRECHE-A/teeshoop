/**
 * INGEST: UI strings side-file (module-owned; the integrator merges I18N
 * into src/i18n/messages.ts). French is first-class, English faithful.
 *
 * `useIngestT` resolves `ingest.*` keys from THIS file immediately (so the
 * module works before the merge) and falls back to the global runtime for
 * shared keys (common.*, side.*, custom.*). After the merge both paths
 * yield identical strings.
 */
import { useStore } from '@/state/store'
import { resolve, type TParams } from '@/i18n'

export const I18N: Record<'fr' | 'en', Record<string, string>> = {
  fr: {
    'ingest.title': 'Ingestion produit',
    'ingest.subtitle':
      'Deux photos + un tableau de tailles en cm → un vêtement prêt pour le studio (2D, 3D, AR).',
    'ingest.list.new': 'Nouveau produit',
    'ingest.list.import': 'Importer un fichier',
    'ingest.list.export': 'Exporter',
    'ingest.list.empty': 'Aucun produit pour l’instant',
    'ingest.list.empty_hint':
      'Créez un produit à partir de deux photos, ou importez un fichier .json exporté sur une autre machine.',
    'ingest.list.delete_confirm': 'Confirmer ?',
    'ingest.list.sizes': '{n} tailles',
    'ingest.ed.back': 'Bibliothèque',
    'ingest.ed.name': 'Nom du produit',
    'ingest.ed.name_ph': 'T-shirt bio 180 g',
    'ingest.ed.brand': 'Référence fabricant',
    'ingest.ed.brand_ph': 'Stanley/Stella Creator STTU755',
    'ingest.ed.notes': 'Notes',
    'ingest.ed.notes_ph': 'Grammage, coloris disponibles…',
    'ingest.ed.photos': 'Photos du vêtement',
    'ingest.ph.store': 'Enregistrement…',
    'ingest.ph.cutout': 'Détourage…',
    'ingest.ph.measure': 'Analyse…',
    'ingest.ph.generate': 'Reconstitution du dos…',
    'ingest.back.generate': 'Reconstituer le dos depuis la face',
    'ingest.back.tag': 'Généré',
    'ingest.back.hint':
      'Dos reconstitué à partir de la face : c’est un aperçu, non contractuel. Remplacez-le par une vraie photo dès que vous en avez une.',
    'ingest.back.low_symmetry':
      'Face peu symétrique ({pct} %) : une poche, un empiècement ou tout détail décentré se retrouveront du mauvais côté sur le dos reconstitué. Vérifiez le dos avant d’enregistrer. Un boutonnage ou un zip centré, lui, est effacé automatiquement.',
    'ingest.back.err': 'Reconstitution impossible : la photo de face doit être détourée.',
    'ingest.back.state.generated': 'Dos reconstitué',
    'ingest.back.state.missing': 'Sans dos',
    'ingest.gate.title': 'Ce produit n’a pas de photo dos',
    'ingest.gate.body':
      'Sans dos, l’aperçu 3D affiche une plaque unie, le mannequin AR est nu de dos et le client ne peut rien imprimer au verso. Choisissez :',
    'ingest.gate.upload': 'Téléverser la photo dos',
    'ingest.gate.generate': 'Reconstituer depuis la face',
    'ingest.gate.skip': 'Continuer sans dos',
    'ingest.gate.skip_hint': 'Le produit sera marqué « sans dos » dans la bibliothèque.',
    'ingest.err.decode_failed': 'Photo illisible. Réessayez avec un JPG ou un PNG net.',
    'ingest.err.cutout_failed':
      'Détourage impossible sur cette photo. Reprenez-la sur fond uni, bien éclairé.',
    'ingest.err.low_coverage':
      'Le vêtement est trop petit dans le cadre (moins de 3 % de l’image).',
    'ingest.err.bad_aspect':
      'Les proportions détectées ne ressemblent pas à un vêtement posé à plat.',
    'ingest.area.auto': 'Suggestion auto',
    'ingest.sizes.title': 'Tableau des tailles (cm à plat)',
    'ingest.sizes.size': 'Taille',
    'ingest.sizes.chest': 'Mi-poitrine',
    'ingest.sizes.body': 'Longueur corps',
    'ingest.sizes.sleeve': 'Manche',
    'ingest.sizes.default': 'Taille de référence (photos + zones)',
    'ingest.sizes.paste_hint':
      'Astuce : collez un tableau ici (lignes S→3XL, colonnes mi-poitrine / corps / manche). Les virgules décimales sont acceptées.',
    'ingest.sizes.prefill_tee': 'Copier la charte tee',
    'ingest.sizes.prefill_hoodie': 'Copier la charte hoodie',
    'ingest.sizes.pasted': '{n} tailles lues depuis le presse-papiers',
    'ingest.sizes.paste_empty': 'Aucune ligne de mesures reconnue dans le texte collé',
    'ingest.woo.title': 'WooCommerce',
    'ingest.woo.hint': 'Récupérez les photos produit directement depuis votre boutique.',
    'ingest.woo.url': 'URL de la boutique',
    'ingest.woo.key': 'Consumer key',
    'ingest.woo.secret': 'Consumer secret',
    'ingest.woo.local_notice':
      'Identifiants conservés uniquement sur cet appareil (localStorage). Ils ne sont jamais envoyés ailleurs qu’à votre boutique.',
    'ingest.woo.fetch': 'Charger les produits',
    'ingest.woo.fetching': 'Chargement…',
    'ingest.woo.use': 'Utiliser les photos',
    'ingest.woo.importing': 'Import des photos…',
    'ingest.woo.err_cors':
      'La boutique refuse les requêtes du studio (CORS). Autorisez l’origine du studio côté WordPress (plugin ou en-têtes CORS), ou servez le studio en même origine, en plugin WP.',
    'ingest.woo.err_auth': 'Authentification refusée ({status}). Vérifiez la consumer key et le secret.',
    'ingest.woo.err_http': 'Erreur boutique : HTTP {status}.',
    'ingest.woo.err_parse': 'Réponse inattendue. Est-ce bien une boutique WooCommerce ?',
    'ingest.woo.empty': 'Aucun produit publié trouvé.',
    'ingest.woo.page': 'page {page}',
    'ingest.unnamed': 'Produit sans nom',
    'ingest.save': 'Enregistrer le produit',
    'ingest.use_studio': 'Utiliser dans le studio',
    'ingest.toast.saved': 'Produit « {name} » enregistré',
    'ingest.toast.applied': '« {name} » ({size}) chargé dans le studio',
    'ingest.toast.deleted': 'Produit supprimé',
    'ingest.toast.imported': 'Produit « {name} » importé',
    'ingest.toast.import_failed': 'Fichier produit invalide',
    'ingest.toast.export_failed': 'Export impossible : photos introuvables',
    'ingest.toast.need_front': 'Ajoutez au moins la photo de face',
    'ingest.toast.need_size': 'Renseignez au moins une taille',
    'ingest.toast.back_generated': 'Dos reconstitué. Vérifiez la zone d’impression.',
    'ingest.toast.woo_photos': 'Photos importées. Vérifiez les zones d’impression.',
  },
  en: {
    'ingest.title': 'Product ingest',
    'ingest.subtitle':
      'Two photos + a per-size cm table → a studio-ready garment (2D, 3D, AR).',
    'ingest.list.new': 'New product',
    'ingest.list.import': 'Import a file',
    'ingest.list.export': 'Export',
    'ingest.list.empty': 'No products yet',
    'ingest.list.empty_hint':
      'Create a product from two photos, or import a .json file exported on another machine.',
    'ingest.list.delete_confirm': 'Confirm?',
    'ingest.list.sizes': '{n} sizes',
    'ingest.ed.back': 'Library',
    'ingest.ed.name': 'Product name',
    'ingest.ed.name_ph': 'Organic tee 180 g',
    'ingest.ed.brand': 'Manufacturer reference',
    'ingest.ed.brand_ph': 'Stanley/Stella Creator STTU755',
    'ingest.ed.notes': 'Notes',
    'ingest.ed.notes_ph': 'Fabric weight, available colours…',
    'ingest.ed.photos': 'Garment photos',
    'ingest.ph.store': 'Storing…',
    'ingest.ph.cutout': 'Removing background…',
    'ingest.ph.measure': 'Measuring…',
    'ingest.ph.generate': 'Reconstructing the back…',
    'ingest.back.generate': 'Reconstruct the back from the front',
    'ingest.back.tag': 'Generated',
    'ingest.back.hint':
      'Back reconstructed from the front: a preview, not contractual. Replace it with a real photo as soon as you have one.',
    'ingest.back.low_symmetry':
      'The front is not very symmetric ({pct}%): a pocket, a yoke or any off-centre detail will end up on the wrong side of the reconstructed back. Check it before saving. A centred placket or zip is erased automatically.',
    'ingest.back.err': 'Cannot reconstruct: the front photo must be cut out.',
    'ingest.back.state.generated': 'Reconstructed back',
    'ingest.back.state.missing': 'No back',
    'ingest.gate.title': 'This product has no back photo',
    'ingest.gate.body':
      'Without a back, the 3D preview shows a flat slab, the AR model is bare from behind and the customer cannot print anything on the reverse. Choose:',
    'ingest.gate.upload': 'Upload the back photo',
    'ingest.gate.generate': 'Reconstruct it from the front',
    'ingest.gate.skip': 'Continue without a back',
    'ingest.gate.skip_hint': 'The product will be flagged “no back” in the library.',
    'ingest.err.decode_failed': 'Unreadable photo. Try again with a clean JPG or PNG.',
    'ingest.err.cutout_failed':
      'Could not cut out this photo. Reshoot it on a plain, well-lit background.',
    'ingest.err.low_coverage':
      'The garment is too small in the frame (under 3% of the image).',
    'ingest.err.bad_aspect':
      'The detected proportions do not look like a laid-flat garment.',
    'ingest.area.auto': 'Auto suggest',
    'ingest.sizes.title': 'Size table (flat cm)',
    'ingest.sizes.size': 'Size',
    'ingest.sizes.chest': 'Half chest',
    'ingest.sizes.body': 'Body length',
    'ingest.sizes.sleeve': 'Sleeve',
    'ingest.sizes.default': 'Reference size (photos + areas)',
    'ingest.sizes.paste_hint':
      'Tip: paste a table here (rows S→3XL, columns half chest / body / sleeve). Comma decimals are accepted.',
    'ingest.sizes.prefill_tee': 'Copy tee chart',
    'ingest.sizes.prefill_hoodie': 'Copy hoodie chart',
    'ingest.sizes.pasted': '{n} sizes read from the clipboard',
    'ingest.sizes.paste_empty': 'No measurement rows recognized in the pasted text',
    'ingest.woo.title': 'WooCommerce',
    'ingest.woo.hint': 'Pull product photos straight from your store.',
    'ingest.woo.url': 'Store URL',
    'ingest.woo.key': 'Consumer key',
    'ingest.woo.secret': 'Consumer secret',
    'ingest.woo.local_notice':
      'Credentials are stored locally on this device only (localStorage). They are never sent anywhere but your store.',
    'ingest.woo.fetch': 'Load products',
    'ingest.woo.fetching': 'Loading…',
    'ingest.woo.use': 'Use the photos',
    'ingest.woo.importing': 'Importing photos…',
    'ingest.woo.err_cors':
      'The store rejects requests from the studio (CORS). Allow the studio origin on the WordPress site (CORS plugin or headers), or run the studio same-origin as a WP plugin.',
    'ingest.woo.err_auth': 'Authentication refused ({status}). Check the consumer key and secret.',
    'ingest.woo.err_http': 'Store error: HTTP {status}.',
    'ingest.woo.err_parse': 'Unexpected response. Is this really a WooCommerce store?',
    'ingest.woo.empty': 'No published products found.',
    'ingest.woo.page': 'page {page}',
    'ingest.unnamed': 'Untitled product',
    'ingest.save': 'Save product',
    'ingest.use_studio': 'Use in studio',
    'ingest.toast.saved': 'Product “{name}” saved',
    'ingest.toast.applied': '“{name}” ({size}) loaded in the studio',
    'ingest.toast.deleted': 'Product deleted',
    'ingest.toast.imported': 'Product “{name}” imported',
    'ingest.toast.import_failed': 'Invalid product file',
    'ingest.toast.export_failed': 'Export failed: photos missing',
    'ingest.toast.need_front': 'Add at least the front photo',
    'ingest.toast.need_size': 'Fill in at least one size',
    'ingest.toast.back_generated': 'Back reconstructed. Check the print area.',
    'ingest.toast.woo_photos': 'Photos imported. Review the print areas.',
  },
}

function format(str: string, params?: TParams): string {
  if (!params) return str
  return str.replace(/\{(\w+)\}/g, (m, k: string) =>
    Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m,
  )
}

/**
 * Reactive translate for the ingest UI: `ingest.*` resolves from this
 * side-file; anything else falls through to the global i18n runtime.
 */
export function useIngestT(): (key: string, params?: TParams) => string {
  const lang = useStore((s) => s.lang)
  return (key, params) => {
    const local = I18N[lang]?.[key] ?? I18N.fr[key]
    return local !== undefined ? format(local, params) : resolve(lang, key, params)
  }
}
