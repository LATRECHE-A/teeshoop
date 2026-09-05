import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

/**
 * L'ÉDITEUR NATIF, construit dans le paquet du greffon et pas dans `dist/`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI UNE SECONDE CONFIGURATION ET PAS UNE QUATRIÈME ENTRÉE
 *
 * `vite.config.ts` construit le studio : React, Tailwind, trois pages HTML, un
 * répertoire d'actifs administrateur que le Worker garde, et 71 Mo de morceaux
 * hachés. L'éditeur natif ne partage aucune de ces cinq choses. Ajouter une
 * quatrième entrée à cette configuration aurait mis les deux sorties dans le
 * même `dist/`, alors que celle-ci doit être SERVIE PAR WORDPRESS, sur l'origine
 * de la boutique, sinon la page ne peut ni tenir le nonce REST ni écrire dans
 * le stockage du client sans qu'un cadre tiers le partitionne.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA SORTIE EST VERSIONNÉE DANS LE DÉPÔT, ET UNE PORTE LE COMPARE
 *
 * `dist/` n'est pas versionné parce que le Worker le construit au déploiement.
 * Un greffon WordPress, lui, est déployé en copiant son répertoire : ce que
 * `wp-plugins/teeshoop-core/assets/editeur/` contient EST ce que la boutique
 * sert. Une sortie non versionnée serait un greffon qui ne marche que sur la
 * machine qui vient de le construire.
 *
 * Le risque de cette forme est qu'elle rouille : quelqu'un modifie
 * `src/native/*` et oublie de reconstruire, et la boutique sert l'ancien
 * paquet sans qu'un test échoue. `scripts/editeur-guard.mjs` reconstruit dans
 * un répertoire temporaire et compare, et il est dans `npm run ci`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MODULES ES, ET C'EST CE QUI PAIE LA VUE AVANCÉE
 *
 * `format: 'es'` parce que `import('./avancee')` doit émettre un morceau à
 * part : c'est toute la différence entre un client qui télécharge le détourage
 * sans l'avoir demandé et un client qui ne le télécharge pas. WordPress charge
 * l'entrée avec `type="module"` (voir `ProductPage::enqueue_editeur`), et les
 * morceaux sont demandés par le navigateur, relativement à l'entrée.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * L'ENTRÉE PORTE SON EMPREINTE, ET IL A FALLU UN BOGUE POUR L'APPRENDRE
 *
 * Elle s'appelait `editeur.js`, nom stable, et WordPress y ajoutait `?ver=0.1.0`
 * comme à tous les actifs d'un greffon. Le morceau paresseux, lui, importe
 * l'entrée par le nom que rollup a écrit, sans requête. Deux URL, donc DEUX
 * MODULES : cliquer « Ouvrir les réglages avancés » réexécutait l'entrée, qui
 * remontait un second éditeur par-dessus le premier, vidait son conteneur, et
 * le panneau n'apparaissait jamais. La console ne disait qu'une chose,
 * « Several Konva instances detected », et c'était la seule trace.
 *
 * L'empreinte dans le nom est la réponse standard pour un module ES : une URL
 * immuable, pas de requête, donc une instance. `ProductPage`/`Editeur` la
 * trouvent en listant ce répertoire, ce qui est moins fragile qu'un manifeste
 * et ne publie aucune carte de l'application.
 */
/**
 * LE BINAIRE WEBASSEMBLY N'ENTRE PAS DANS LE GREFFON, ET IL N'A PAS À Y ENTRER.
 *
 * `onnxruntime-web` référence son `.wasm` par `new URL(…, import.meta.url)`, ce
 * que vite traite comme un actif et copie dans la sortie : 13,5 Mo, deux fois,
 * dans un répertoire qu'on déploie en rsync sur un hébergement mutualisé.
 *
 * Cette copie ne sert jamais. `src/lib/bgremove/engine.ts` écrit
 * `ort.env.wasm.wasmPaths` explicitement avant de créer la session, avec une URL
 * résolue contre la base d'actifs (`src/lib/assetBase.ts`), et cette base est
 * l'origine du Worker, qui sert déjà `/ort/` publiquement et sans identifiants.
 * Le laisser sortir serait donc payer 27 Mo pour un fichier que personne ne lit.
 *
 * `external`, et pas une suppression après coup : un fichier qu'on efface après
 * l'avoir construit est un fichier que le prochain build ramène. Marqué externe,
 * rollup laisse l'URL telle quelle et n'émet rien, et si un jour quelque chose
 * la lisait vraiment, la requête partirait au lieu de disparaître en silence.
 */
function sansBinaireWasm() {
  return {
    name: 'teeshoop-sans-binaire-wasm',
    enforce: 'pre' as const,
    resolveId(source: string) {
      return source.endsWith('.wasm') ? { id: source, external: true as const } : null
    },
  }
}

export default defineConfig({
  /*
   * ─────────────────────────────────────────────────────────────────────────
   * RELATIF, ET CETTE LIGNE MANQUAIT : LES POLICES D'IMPRESSION RENDAIENT 404
   *
   * `base` vaut `/` par défaut. Le greffon, lui, est servi sous
   * `…/wp-content/plugins/teeshoop-core/assets/editeur/`. Sans cette ligne,
   * `vite` écrit `url(/actif-anton-….woff2)` dans la feuille des polices et
   * calcule l'URL de cette feuille elle-même comme racine-absolue : les deux
   * partaient chercher à la racine du site et rendaient 404.
   *
   * Ce n'est pas un défaut d'apparence. `document.fonts.load()` se résout
   * JOYEUSEMENT quand la déclaration existe et que son fichier manque, donc
   * `ensureFont` déclarait la police prête, `measureTextInk` mesurait l'encre de
   * la police de REPLI, et cette boîte-là est celle que `Pricing.php` facture et
   * celle que le paqueteur pose sur la feuille de 33 x 46 cm. Le transfert, lui,
   * est rendu plus tard par le studio, servi depuis la racine du Worker, où
   * Anton se charge. Les deux bouts mesuraient deux polices différentes.
   *
   * Mesuré le 5 septembre 2026 dans un vrai Chromium, sur les octets livrés,
   * servis au vrai chemin WordPress, pour « TEESHOOP » en Anton 64 px :
   *
   *   feuille telle que le paquet la demandait   324,5 x 43,0 px, deux 404
   *   feuille dont les url() résolvent           231,0 x 58,0 px
   *   écart : largeur -28,8 %, hauteur +34,9 %
   *
   * À la taille de texte par défaut de la vue avancée, cela fait une pièce
   * enregistrée et facturée 20,6 x 2,7 cm et imprimée 14,7 x 3,7 cm : 5,9 cm de
   * trop en largeur et 1,0 cm de moins en hauteur sur le film. La surface, elle,
   * ne bougeait que de 4 %, donc le prix restait plausible.
   *
   * `document.fonts.check()` rend TRUE quand aucune déclaration n'existe et
   * FALSE quand elle existe et que son fichier manque : un contrôle écrit
   * là-dessus serait passé.
   */
  base: './',
  plugins: [sansBinaireWasm()],
  /*
   * PAS DE RÉPERTOIRE PUBLIC. C'est la troisième raison de `Shortcode.php`,
   * mesurée : `public/` porte 34 Mo de modèles 3D, 13 Mo de runtime ONNX et
   * 6 Mo de photographies de catalogue, et vite les copie tels quels dans la
   * sortie. L'éditeur natif n'en référence aucun ; ce que la vue avancée ira
   * chercher un jour, elle ira le chercher sur l'origine du Worker, qui les
   * sert déjà.
   */
  publicDir: false,
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      /*
       * LA MÊME REDIRECTION QUE `vite.config.ts`, ET POUR LA MÊME RAISON.
       *
       * Sans elle, rollup prend la variante `jsep` d'onnxruntime, qui est le
       * binaire WebGPU : 26,8 Mo, mesuré, contre 13,5 pour celle qu'on utilise.
       * Le studio l'a apprise parce que Cloudflare refuse un actif de plus de
       * 25 Mio ; un greffon WordPress déployé par rsync ne veut ni l'un ni
       * l'autre, mais la variante doit être la même des deux côtés ou le
       * détourage tournerait sur un runtime différent de celui qui est servi.
       */
      'onnxruntime-web': 'onnxruntime-web/wasm',
    },
  },
  build: {
    target: 'es2022',
    outDir: fileURLToPath(new URL('./wp-plugins/teeshoop-core/assets/editeur', import.meta.url)),
    emptyOutDir: true,
    // Pas de manifeste : rien ne le lit, et `wrangler` a déjà servi une fois
    // `.vite/manifest.json` à qui le demandait, ce qui est la carte de
    // l'application offerte à un inconnu.
    manifest: false,
    /*
     * LA FEUILLE SUIT LE MORCEAU QUI L'AMÈNE.
     *
     * Avec `cssCodeSplit: false` tout le CSS finit dans un seul fichier, y
     * compris les treize déclarations `@font-face` que seule la vue avancée
     * demande : mesuré, la feuille de la première charge tombe de 27,73 ko à
     * 4,42 ko en la découpant, et les 1,5 Mo de fontes cessent d'être
     * référencés par une page qui ne les utilisera jamais.
     */
    cssCodeSplit: true,
    sourcemap: false,
    rollupOptions: {
      input: fileURLToPath(new URL('./src/native/main.ts', import.meta.url)),
      output: {
        format: 'es',
        entryFileNames: 'editeur-[hash].js',
        chunkFileNames: 'morceau-[name]-[hash].js',
        /*
         * La feuille de l'entrée s'appelle `editeur-<empreinte>.css`, comme
         * l'entrée et pour la même raison : le greffon est déployé par copie et
         * un navigateur qui garde une ancienne feuille sous un nom stable est un
         * éditeur à moitié habillé. Les feuilles des morceaux sont amenées par
         * leur morceau et personne ne les nomme.
         */
        assetFileNames: (info) =>
          info.names?.[0] === 'main.css' ? 'editeur-[hash][extname]' : 'actif-[name]-[hash][extname]',
      },
    },
  },
})
