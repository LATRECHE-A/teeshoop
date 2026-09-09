/**
 * Ce que la fiche produit remet à l'éditeur, relu.
 *
 * `src/native/contexte.ts` est le seul lecteur de `window.TEESHOOP_EDITEUR`, et
 * il est la frontière : tout ce qui le traverse vient de la base de données de
 * la boutique, à travers `wp_localize_script`, qui convertit tout en chaînes.
 * Deux classes de défaut vivent ici, et les deux ont été trouvées en une nuit :
 *
 *   une comparaison numérique faite sur deux chaînes (« 9 » y est plus grand
 *   que le plafond de la boutique) ;
 *
 *   deux états là où il en faut trois, ce que la passe adversariale du
 *   5 septembre 2026 a nommé sur la TVA : « le taux est zéro » et « nous ne
 *   savons pas quel est le régime » s'écrivaient de la même façon, et la
 *   première phrase est une déclaration fiscale faite à un client.
 */
import { describe, expect, it } from 'vitest'
import { MAX_COULEURS_DEFAUT, facesPermises, lireContexte } from './contexte'

/** Le minimum sans lequel `lireContexte` refuse tout. */
const BASE = { productId: '169880', garment: 'tee', restUrl: 'http://x/wp-json/teeshoop/v1/' }

describe('lireContexte : ce qui est refusé en bloc', () => {
  it('refuse ce qui n’est pas un objet', () => {
    for (const v of [null, undefined, 'x', 42, []]) expect(lireContexte(v)).toBeNull()
  })

  it('refuse sans identifiant de produit, sans vêtement ou sans route REST', () => {
    expect(lireContexte({ ...BASE, productId: '0' })).toBeNull()
    expect(lireContexte({ ...BASE, garment: '' })).toBeNull()
    expect(lireContexte({ ...BASE, garment: 'Tee Shirt' })).toBeNull()
    expect(lireContexte({ ...BASE, restUrl: '' })).toBeNull()
  })
})

describe('lireContexte : tout arrive en chaîne de caractères', () => {
  /*
   * DES NOMBRES QUI NE SONT LE SEUIL DE PERSONNE.
   *
   * Écrire ici le vrai plafond de la boutique ferait de ce fichier une seconde
   * maison pour une valeur qui n'en a qu'une, et `scripts/hypotheses-guard.mjs`
   * le refuse, à raison : ce test vérifie qu'une chaîne devient un nombre, pas
   * quel est ce nombre.
   */
  it('rend des nombres, pas des chaînes', () => {
    const c = lireContexte({ ...BASE, maxQty: '7777', quoteFromQty: '33', quoteFromHt: '4242' })
    expect(c?.productId).toBe(169880)
    expect(c?.maxQty).toBe(7777)
    expect(c?.devisDesQte).toBe(33)
    expect(c?.devisDesHt).toBe(4242)
  })

  /*
   * ZÉRO VEUT DIRE « LA PAGE NE L'A PAS DIT », ET PAS « ZÉRO PIÈCE ». Un défaut
   * chiffré ici serait une seconde copie du plafond, dans un fichier incapable
   * de savoir s'il est encore juste.
   */
  it('rend zéro pour un seuil que la page n’a pas publié', () => {
    const c = lireContexte(BASE)
    expect(c?.maxQty).toBe(0)
    expect(c?.devisDesQte).toBe(0)
    expect(c?.devisDesHt).toBe(0)
  })

  it('borne une valeur absurde au lieu de la croire', () => {
    expect(lireContexte({ ...BASE, maxQty: '-5' })?.maxQty).toBe(0)
    expect(lireContexte({ ...BASE, maxQty: 'beaucoup' })?.maxQty).toBe(0)
  })
})

describe('la base fiscale : trois états, pas deux', () => {
  it('régime standard : deux montants', () => {
    const c = lireContexte({ ...BASE, priceBases: { known: true, two: true, lead: 'ht', mention: '' } })
    expect(c?.bases).toEqual({ connue: true, deux: true, principal: 'ht', mention: '' })
  })

  it('franchise en base : un seul montant, et la mention que la loi impose', () => {
    const c = lireContexte({
      ...BASE,
      priceBases: { known: true, two: false, lead: 'ht', mention: 'TVA non applicable, article 293 B du CGI' },
    })
    expect(c?.bases.deux).toBe(false)
    expect(c?.bases.mention).toBe('TVA non applicable, article 293 B du CGI')
  })

  /*
   * LE CAS QUI A COÛTÉ LA TROUVAILLE. Sans base publiée, l'écran ne doit rien
   * affirmer : ni « TVA 20 % incluse » sur une boutique qui n'a pas dit son
   * régime, ni « TVA 0 % » qui est la mention de quelqu'un d'autre.
   */
  it('rien de publié : la page se tait sur la taxe', () => {
    const c = lireContexte(BASE)
    expect(c?.bases).toEqual({ connue: false, deux: false, principal: 'ht', mention: '' })
  })

  it('lit aussi les booléens sérialisés en « 1 » par wp_localize_script', () => {
    const c = lireContexte({ ...BASE, priceBases: { known: '1', two: '1', lead: 'ttc', mention: '' } })
    expect(c?.bases.connue).toBe(true)
    expect(c?.bases.deux).toBe(true)
    expect(c?.bases.principal).toBe('ttc')
  })
})

describe('les coloris', () => {
  it('garde le nom du fabricant et la pastille mesurée', () => {
    const c = lireContexte({
      ...BASE,
      colours: [{ id: 'navy', name: 'Midnight', stops: ['#0a1b3d'], photo: '/wp-content/x.jpg' }],
    })
    expect(c?.couleurs).toEqual([
      { id: 'navy', nom: 'Midnight', teintes: ['#0a1b3d'], photo: '/wp-content/x.jpg' },
    ])
  })

  /*
   * UNE PASTILLE SANS COULEUR MESURÉE EST ÉCARTÉE, pas peinte en gris : la
   * pastille EST la mesure, et un carré neutre sous un vrai nom de coloris est
   * exactement le défaut que `Product::blank_palette_of` refuse déjà.
   */
  it('écarte un coloris sans mesure, et un identifiant qui n’en est pas un', () => {
    const c = lireContexte({
      ...BASE,
      colours: [
        { id: 'navy', name: 'Midnight', stops: [] },
        { id: '"><script>', name: 'x', stops: ['#000000'] },
        { id: 'red', name: '', stops: ['#ff0000'] },
      ],
    })
    expect(c?.couleurs).toEqual([])
  })

  it('refuse un hexadécimal qui n’en est pas un, et garde les autres', () => {
    const c = lireContexte({
      ...BASE,
      colours: [{ id: 'navy', name: 'Midnight', stops: ['red', '#0a1b3d', '#ffffff', '#111111'] }],
    })
    // Deux au plus : une seule teinte, ou deux pour un chiné.
    expect(c?.couleurs[0].teintes).toEqual(['#0a1b3d', '#ffffff'])
  })
})

describe('la photographie', () => {
  it('accepte http, https et un chemin de la boutique', () => {
    const url = (photo: unknown) =>
      lireContexte({ ...BASE, colours: [{ id: 'w', name: 'W', stops: ['#ffffff'], photo }] })?.couleurs[0]
        .photo
    expect(url('https://boutique.test/x.jpg')).toBe('https://boutique.test/x.jpg')
    expect(url('/wp-content/uploads/x.jpg')).toBe('/wp-content/uploads/x.jpg')
  })

  /*
   * `//` ET `/\` SONT LA MÊME CHOSE POUR UN NAVIGATEUR : il normalise la barre
   * inverse, donc les deux repartent sur une autre origine. Le second passait un
   * contrôle qui ne regardait que le premier.
   */
  it('refuse tout ce qui repart sur une autre origine, et tout ce qui n’est pas http', () => {
    const url = (photo: unknown) =>
      lireContexte({ ...BASE, colours: [{ id: 'w', name: 'W', stops: ['#ffffff'], photo }] })?.couleurs[0]
        .photo
    expect(url('//evil.tld/x.png')).toBe('')
    expect(url('/\\evil.tld/x.png')).toBe('')
    expect(url('javascript:alert(1)')).toBe('')
    expect(url('data:image/svg+xml,<svg onload=alert(1)>')).toBe('')
  })
})

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * LES FACES : LA SEULE PORTE, DONC UNE PORTE TESTÉE
 *
 * Rien côté serveur ne revérifie qu'une face décorée était permise
 * (`Design::unprintable_sizes` contrôle les tailles, pas les faces), donc cette
 * liste décide seule sur quoi un client peut poser un visuel. Elle est lue par
 * le sélecteur de face de la vue simple ET par la face de départ de l'éditeur,
 * et les deux passent par cette fonction : une seule implémentation de « quelles
 * faces ce produit accepte ».
 */
describe('les faces imprimables, qui décident où un calque peut aller', () => {
  it('rend les trois du dessin quand la page n’a rien publié', () => {
    expect(facesPermises({ faces: [] })).toEqual(['front', 'back', 'sleeve'])
  })

  it('rend exactement celles que le produit déclare, dans l’ordre du dessin', () => {
    expect(facesPermises({ faces: ['sleeve', 'front'] })).toEqual(['front', 'sleeve'])
    expect(facesPermises({ faces: ['back'] })).toEqual(['back'])
  })

  /*
   * UNE FACE QUE LE DESSIN NE SAIT PAS TRACER N'EST PAS UNE FACE. Il y a un
   * gabarit par face dans `src/garments/*.ts` ; une quatrième publiée par la
   * boutique n'aurait ni zone d'impression ni image, et la proposer serait
   * proposer un achat que l'atelier ne peut pas produire.
   */
  it('écarte ce qui n’est pas une face que le dessin connaît', () => {
    expect(facesPermises({ faces: ['front', 'capuche', 'poche'] })).toEqual(['front'])
    expect(facesPermises({ faces: ['capuche'] })).toEqual([])
  })
})

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * LA PAGE DÉDIÉE : UN BOOLÉEN ET DEUX URL, DONT UNE DEVIENT UN `href`
 *
 * `productUrl` est posée sur un lien que le client clique. C'est le seul champ
 * de ce contrat qui devienne une destination, et c'est exactement la mise en
 * garde écrite au-dessus de `devisUrl` : le jour où quelqu'un rend une adresse
 * administrable, il faut la filtrer comme la photographie l'est, ou une adresse
 * `javascript:` devient un lien cliquable sur une page de la boutique.
 */
describe('la page dédiée, et ses deux adresses', () => {
  it('n’est pas une page dédiée tant que la page ne l’a pas dit', () => {
    const c = lireContexte(BASE)
    expect(c?.atelier).toBe(false)
    expect(c?.productUrl).toBe('')
    expect(c?.productImage).toBe('')
  })

  it('lit le booléen sous les trois formes que wp_localize_script produit', () => {
    expect(lireContexte({ ...BASE, atelier: true })?.atelier).toBe(true)
    expect(lireContexte({ ...BASE, atelier: '1' })?.atelier).toBe(true)
    expect(lireContexte({ ...BASE, atelier: 1 })?.atelier).toBe(true)
  })

  it('et rien d’autre ne vaut vrai', () => {
    for (const v of ['0', 0, 'oui', 'true', false, null, {}]) {
      expect(lireContexte({ ...BASE, atelier: v })?.atelier).toBe(false)
    }
  })

  it('garde une adresse de la boutique, absolue ou relative', () => {
    const c = lireContexte({
      ...BASE,
      productUrl: 'https://boutique.test/produit/tee-noir/',
      productImage: '/wp-content/uploads/tee.jpg',
    })
    expect(c?.productUrl).toBe('https://boutique.test/produit/tee-noir/')
    expect(c?.productImage).toBe('/wp-content/uploads/tee.jpg')
  })

  it('jette une adresse `javascript:`, et le lien n’existe alors pas', () => {
    const c = lireContexte({
      ...BASE,
      productUrl: 'javascript:alert(1)',
      productImage: 'javascript:alert(1)',
    })
    expect(c?.productUrl).toBe('')
    expect(c?.productImage).toBe('')
  })

  /*
   * LE MÊME FILTRE QUE LA PHOTOGRAPHIE, DONC LES MÊMES REFUS. `//` et `/\` sont
   * la même chose pour un navigateur, qui normalise la barre inverse : les deux
   * repartent sur une autre origine, et le second passait un contrôle qui ne
   * regardait que le premier.
   */
  it('jette tout ce qui repart sur une autre origine, et tout ce qui n’est pas http', () => {
    const url = (v: unknown) => lireContexte({ ...BASE, productUrl: v })?.productUrl
    expect(url('//evil.tld/')).toBe('')
    expect(url('/\\evil.tld/')).toBe('')
    expect(url('data:text/html,<script>alert(1)</script>')).toBe('')
    expect(url('vbscript:msgbox(1)')).toBe('')
    expect(url(42)).toBe('')
  })
})

/*
 * LE PLAFOND DE COLORIS N'A PAS DE « NON PUBLIÉ » UTILISABLE, contrairement à
 * `maxQty` : sans borne, l'écran construirait plus de lignes que la matrice n'en
 * porte et `Cart::normalise_matrix` jetterait les dernières en silence. L'en-tête
 * de la constante écrit la différence entre les deux plafonds.
 */
describe('le plafond de coloris d’une ligne', () => {
  it('vaut le défaut quand la page ne le publie pas', () => {
    expect(lireContexte(BASE)?.maxCouleurs).toBe(MAX_COULEURS_DEFAUT)
  })

  it('et la valeur publiée quand elle l’est', () => {
    expect(lireContexte({ ...BASE, maxColours: '3' })?.maxCouleurs).toBe(3)
  })

  it('borne une valeur absurde plutôt que de la croire', () => {
    expect(lireContexte({ ...BASE, maxColours: '-5' })?.maxCouleurs).toBe(MAX_COULEURS_DEFAUT)
    expect(lireContexte({ ...BASE, maxColours: '9999' })?.maxCouleurs).toBe(64)
    expect(lireContexte({ ...BASE, maxColours: 'beaucoup' })?.maxCouleurs).toBe(MAX_COULEURS_DEFAUT)
  })
})

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * LES TAILLES SONT NORMALISÉES COMME LE PANIER LES NORMALISE
 *
 * `Cart::normalise_size_grid` met en majuscules, retire le non alphanumérique,
 * jette au-delà de quatre caractères et s'arrête à douze entrées. Offrir une
 * taille que le panier réécrit, c'est faire saisir une quantité sous un nom que
 * la commande ne portera pas ; en offrir une treizième, c'est la faire saisir
 * pour rien. Et la clé devient un sélecteur d'attribut à chaque frappe.
 */
describe('les tailles offertes sont celles que le panier acceptera', () => {
  const tailles = (v: unknown) => lireContexte({ ...BASE, sizes: v })?.tailles

  it('met en majuscules et déduplique', () => {
    expect(tailles(['s', 'M', 'm', 'l'])).toEqual(['S', 'M', 'L'])
  })

  it('écarte ce que le panier réécrirait plutôt que de l’offrir sous un autre nom', () => {
    expect(tailles(['M', 'm-1', '3 XL', 'TAILLEUNIQUE', ''])).toEqual(['M', 'M1', '3XL'])
  })

  it('n’offre pas de treizième taille, que le panier jetterait en silence', () => {
    const beaucoup = Array.from({ length: 20 }, (_, i) => `T${i}`)
    expect(tailles(beaucoup)?.length).toBe(12)
  })

  /*
   * LA CLÉ DEVIENT UN SÉLECTEUR. `rendreTotaux` cherche
   * `[data-teeshoop="total-taille-<clé>"]` à chaque caractère tapé : un
   * guillemet dedans faisait lever `querySelector` au milieu de la saisie.
   */
  it('ne laisse passer ni guillemet ni crochet dans une clé', () => {
    expect(tailles(['M"]', "L']"])).toEqual(['M', 'L'])
  })
})

describe('la demi-poitrine et les zones, bornées à la lecture aussi', () => {
  it('écarte une demi-poitrine hors de toute plausibilité', () => {
    const c = lireContexte({ ...BASE, sizeChart: { M: '50.8', XL: '3', '2XL': '400', '3XL': 71.12 } })
    expect(c?.demiPoitrine).toEqual({ M: 50.8, '3XL': 71.12 })
  })

  it('écarte une zone qui n’est pas une zone', () => {
    const c = lireContexte({
      ...BASE,
      areas: [
        { side: 'front', bySize: { M: { wCm: 30.5, hCm: 40.6 }, XL: { wCm: 0, hCm: 10 }, '2XL': { wCm: 500, hCm: 10 } } },
        { side: 'PAS UNE FACE', bySize: { M: { wCm: 10, hCm: 10 } } },
      ],
    })
    expect(c?.zones).toEqual([{ face: 'front', parTaille: { M: { largeurCm: 30.5, hauteurCm: 40.6 } } }])
  })
})
