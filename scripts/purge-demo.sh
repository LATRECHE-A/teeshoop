#!/bin/bash
#
# Retirer les produits de démonstration du thème, avec de quoi revenir en arrière.
#
#   ./purge-demo.sh [racine_wordpress] [--faire]
#
# Sans `--faire` il ne supprime RIEN : il compte, il liste, et il dit ce qu'il
# ferait. C'est le mode par défaut parce que la première question à poser d'une
# suppression est « quoi, exactement », et qu'une réponse à cette question doit
# pouvoir être lue avant que quoi que ce soit ne disparaisse.
#
# ── CE QUI EST SUPPRIMÉ, ET COMMENT LA LISTE EST OBTENUE ────────────────────
#
# Pas « les produits de meubles », qui n'est pas une propriété que la base
# connaît. Deux conditions indépendantes, mesurées sur la production le
# 02/09/2026 :
#
#   1. la référence commence par CH-, TB-, SO-, AR- ou GC-
#   2. le produit a été créé avant 2024
#
# Ce qui donne exactement 42 produits : 10 CH (chaises), 10 TB (tables), 10 SO
# (canapés), 10 AR (fauteuils) et 2 GC (cartes cadeaux). Les cinq autres n'ont
# AUCUNE référence et sont de vrais produits : deux tapis d'acupression vendus
# en 2024, deux vêtements de mai 2025 et le t-shirt SOL'S d'août 2025.
#
# Le brief de la séance annonçait « 44 des 47 produits ». Le compte réel est 42,
# et les deux cartes cadeaux ne sont pas des meubles : c'est écrit ici parce
# qu'une purge se fait sur ce que la base contient et pas sur ce qu'un document
# se rappelle.
#
# ── CE QUI N'EST PAS SUPPRIMÉ, ET POURQUOI ──────────────────────────────────
#
# Le thème a aussi déposé 13 modèles Elementor, 5 blocs de contenu, 5
# dispositions Woodmart, 3 diapositives et un guide des tailles. Ils ne sont pas
# touchés, et ce n'est pas un oubli : LA PAGE D'ACCUEIL DE LA BOUTIQUE EST
# ELLE-MÊME UNE PAGE DE DÉMONSTRATION DE MEUBLES (`home-furniture2`, ID 3346), et
# supprimer un modèle qu'elle utilise casserait le site sans que ce script sache
# lequel. Ils sont listés pour qu'un humain décide, ce qui est la seule façon
# honnête de traiter un contenu dont on ne sait pas s'il est utilisé.
#
# ── COMMENT ON REVIENT EN ARRIÈRE ───────────────────────────────────────────
#
# Deux chemins, et le second existe parce que le premier est brutal :
#
#   1. la sauvegarde complète prise juste avant (restaurée en 18 s en
#      préproduction le 02/09/2026, voir docs/DEPLOIEMENT.md) ;
#   2. un export WXR des seuls produits supprimés, écrit avant la suppression,
#      qui se réimporte sans toucher au reste de la boutique.
#
# Et un journal qui nomme chaque identifiant retiré, parce qu'un compte « 42
# supprimés » ne permet à personne de vérifier que c'étaient les bons.
#
# ── LA PRODUCTION DEMANDE UNE AUTORISATION ÉCRITE, ET C'EST UN FICHIER ──────
#
# La question 20 est à l'associé et la réponse par défaut est « on peut ». Un
# défaut n'est pas un feu vert pour une action irréversible sur l'entreprise de
# quelqu'un d'autre. Ce script refuse donc la production tant que
# ~/teeshoop-autorisation-purge.txt n'existe pas et ne contient pas ses mots.
# Une option de ligne de commande se tape sans y penser ; un fichier qu'il faut
# créer et remplir avec la phrase de quelqu'un, non.
#
# Sortie : 0 fait (ou simulé) · 1 quelque chose a échoué · 2 refus de tourner ici.

set -euo pipefail

case ":$PATH:" in
  *":/usr/local/bin:"*) ;;
  *) PATH="/usr/local/bin:$PATH" ;;
esac
export PATH

RACINE="${1:-$HOME/myTiger-Preprod/4bde-26076daa9357.wptiger.fr}"
FAIRE=0
for a in "$@"; do [ "$a" = "--faire" ] && FAIRE=1; done

AUTORISATION="$HOME/teeshoop-autorisation-purge.txt"
JOURNAL="$HOME/teeshoop-purges"

refus() { echo "purge-demo: $*" >&2; exit 2; }
echec() { echo "purge-demo: $*" >&2; exit 1; }

command -v wp >/dev/null || refus "wp-cli est introuvable. PATH=$PATH"
[ -f "$RACINE/wp-config.php" ] || refus "$RACINE ne contient pas de wp-config.php"
cd "$RACINE"

EST_PROD=0
case "$(pwd -P)" in
  "$(cd "$HOME" && pwd -P)/public_html"*) EST_PROD=1 ;;
esac

if [ "$EST_PROD" -eq 1 ]; then
  echo "purge-demo: cible = LA BOUTIQUE DE PRODUCTION."
  [ -s "$AUTORISATION" ] || refus "REFUS : $AUTORISATION n'existe pas ou est vide.
  La suppression des produits de la boutique est la question 20 et elle appartient à l'associé.
  Pour l'autoriser, créez ce fichier et écrivez-y sa réponse, avec la date et le nom de qui l'a reçue."
  echo "purge-demo: autorisation lue dans $AUTORISATION :"
  sed 's/^/    /' "$AUTORISATION"
fi

# UNE SAUVEGARDE AVANT TOUTE SUPPRESSION, ET SUR LES DEUX ENVIRONNEMENTS.
#
# Elle était réservée à la production, ce qui supposait qu'une préproduction est
# jetable. Elle ne l'est pas : `wp post delete --force` sur une pièce jointe
# EFFACE LE FICHIER du disque, donc cette purge touche `wp-content/uploads`, que
# le déploiement ne touche jamais. Sans sauvegarde, remonter 42 produits et leurs
# images demanderait de resynchroniser depuis la production, ce qui réimporterait
# les données personnelles qu'on vient d'en retirer.
if [ "$FAIRE" -eq 1 ]; then
  echo "purge-demo: sauvegarde préalable ..."
  DEST_SAUV="$HOME/sauvegardes"
  [ "$EST_PROD" -eq 1 ] || DEST_SAUV="$HOME/sauvegardes-preprod"
  "$HOME/sauvegarde.sh" "$RACINE" "$DEST_SAUV" 10 || echec "la sauvegarde préalable a échoué, rien ne sera supprimé"
fi

mkdir -p "$JOURNAL"
STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
LOG="$JOURNAL/$STAMP.log"

dire() { echo "$*" | tee -a "$LOG"; }

# `wp db query` écrit parfois sa propre ligne de succès sur la sortie standard,
# et une affectation qui la prend pour une valeur donne « [: Success: Query
# succeeded...: integer expression expected ». Elle est retirée ici, une fois,
# plutôt qu'à chaque appel.
q() { wp db query "$1" --skip-column-names 2>/dev/null | grep -v '^Success:' || true; }


# LE PRÉFIXE DES TABLES SE DEMANDE, IL NE S'ÉCRIT PAS EN DUR.
#
# Il était écrit `wp68_` en dur partout, ce qui est juste sur les deux
# installations o2switch et faux ailleurs : le miroir local est en `wp_`. Un
# script qui ne peut pas tourner sur le miroir est un script qu'on ne peut pas
# éprouver avant de le lancer sur des données réelles, ce qu'on s'interdit ici.
# `wp db prefix` répond, ou on refuse : deviner un préfixe de tables sur une base
# qu'on va modifier n'est pas une option.
P="$(wp db prefix 2>/dev/null | tr -d '[:space:]')"
[ -n "$P" ] || refus "impossible de lire le préfixe des tables (wp db prefix). Rien ne sera fait."

dire "purge-demo $STAMP"
dire "racine     : $(pwd -P)"
dire "mode       : $([ "$FAIRE" -eq 1 ] && echo 'SUPPRESSION' || echo 'simulation (ajoutez --faire)')"
dire ""

# ── LE COMPTE AVANT ─────────────────────────────────────────────────────────
AV_PRODUITS=$(wp post list --post_type=product --post_status=any --format=count)
AV_VARIATIONS=$(wp post list --post_type=product_variation --post_status=any --format=count)
AV_MEDIAS=$(wp post list --post_type=attachment --post_status=any --format=count)
AV_TERMES=$(q "SELECT COUNT(*) FROM ${P}term_taxonomy WHERE taxonomy IN ('product_cat','product_tag','product_brand')")
AV_COMMANDES=$(q "SELECT COUNT(*) FROM ${P}wc_orders")
dire "AVANT   produits=$AV_PRODUITS variations=$AV_VARIATIONS medias=$AV_MEDIAS termes=$AV_TERMES commandes=$AV_COMMANDES"
dire ""

# ── LA SÉLECTION ────────────────────────────────────────────────────────────
CIBLES=$(q "SELECT p.ID FROM ${P}posts p
   JOIN ${P}postmeta sku ON sku.post_id = p.ID AND sku.meta_key = '_sku'
   WHERE p.post_type = 'product'
     AND sku.meta_value REGEXP '^(CH|TB|SO|AR|GC)-'
     AND p.post_date < '2024-01-01'
   ORDER BY p.ID" | tr '\n' ' ')
NB=$(echo "$CIBLES" | wc -w)
dire "SÉLECTION : $NB produit(s) dont la référence commence par CH-, TB-, SO-, AR- ou GC- et créés avant 2024."
[ "$NB" -gt 0 ] || refus "la sélection est vide : soit la purge est déjà faite, soit la règle ne décrit plus cette boutique. Rien n'est supprimé sur un doute."

# ── LE GARDE-FOU QUI COMPTE ─────────────────────────────────────────────────
#
# Un produit qui figure dans une commande ne se supprime pas, même s'il coche la
# règle. WooCommerce fige le nom et le prix sur la ligne de commande, donc
# l'historique resterait lisible ; mais « resterait lisible » n'est pas une
# raison de le faire, et cette boutique a quinze commandes qu'on ne peut pas
# refaire. Mesuré le 02/09/2026 : les six produits réellement vendus ont DÉJÀ été
# supprimés par quelqu'un avant nous, et leurs quinze commandes se lisent encore.
# Le garde-fou n'a donc rien à protéger aujourd'hui, et c'est exactement pour
# demain qu'il est là.
VENDUS=$(q "SELECT DISTINCT meta_value FROM ${P}woocommerce_order_itemmeta WHERE meta_key='_product_id' AND meta_value <> '0'" | tr '\n' ' ')
GARDES=""
RESTE=""
for id in $CIBLES; do
  garde=0
  for v in $VENDUS; do [ "$id" = "$v" ] && garde=1; done
  if [ "$garde" -eq 1 ]; then GARDES="$GARDES $id"; else RESTE="$RESTE $id"; fi
done
if [ -n "$GARDES" ]; then
  dire "PROTÉGÉS : $(echo "$GARDES" | wc -w) produit(s) figurent dans une commande et ne seront pas supprimés :$GARDES"
fi
CIBLES="$RESTE"
NB=$(echo "$CIBLES" | wc -w)
dire ""
dire "À SUPPRIMER : $NB produit(s)"
# UNE REQUÊTE, PAS DEUX APPELS PAR PRODUIT. C'était `wp post get` + `wp post meta
# get` pour chacun des 42, soit 84 démarrages complets de WordPress à environ une
# seconde et demie pièce sur cet hébergement mutualisé. La simulation prenait six
# minutes et une exécution s'est fait couper par une coupure ssh au milieu.
q "SELECT CONCAT('  ', p.ID, '  ', LEFT(p.post_title, 46), '  [', COALESCE(sku.meta_value,'-'), ']')
   FROM ${P}posts p LEFT JOIN ${P}postmeta sku ON sku.post_id = p.ID AND sku.meta_key = '_sku'
   WHERE p.ID IN ($(echo "$CIBLES" | tr -s ' ' ',' | sed 's/^,//;s/,$//')) ORDER BY p.ID" | tee -a "$LOG"
dire ""

# Les variations sont les enfants des produits variables. Elles n'existent pas
# sans leur parent et WordPress ne les emporte pas toujours.
VARIATIONS=$(q "SELECT ID FROM ${P}posts WHERE post_type = 'product_variation'
   AND post_parent IN ($(echo "$CIBLES" | tr -s ' ' ',' | sed 's/^,//;s/,$//'))" | tr '\n' ' ')
NBV=$(echo "$VARIATIONS" | wc -w)
dire "VARIATIONS liées : $NBV"

# Les médias : vignette et galerie de chaque produit visé, MOINS tout média
# qu'un autre contenu utilise encore. Un média partagé avec une page vivante ne
# se supprime pas parce qu'un produit disparaît.
# Idem : une requête pour les vignettes et les galeries des 42 produits, au lieu
# de 84 appels wp-cli.
# LES IMAGES DES VARIATIONS COMPTENT AUSSI. Une variation porte sa propre
# `_thumbnail_id`, et elle est supprimée dans la même passe que son parent. En ne
# ramassant que les images des PRODUITS, ce script laissait derrière lui l'image
# d'une variation condamnée : plus personne ne l'utilisait et personne ne la
# retirait. Mesuré sur le miroir avec une variation fabriquée pour le cas :
# 2 candidats trouvés au lieu de 3, et le troisième devenait orphelin.
MEDIAS=$(q "SELECT meta_value FROM ${P}postmeta
   WHERE meta_key IN ('_thumbnail_id','_product_image_gallery') AND meta_value <> ''
     AND post_id IN ($(echo "$CIBLES $VARIATIONS" | tr -s ' ' ',' | sed 's/^,//;s/,$//'))" \
  | tr ',' '\n' | tr -d ' ' | grep -E '^[0-9]+$' | sort -u | tr '\n' ' ' || true)
# LA LISTE POUR SQL, CONSTRUITE UNE FOIS ET VÉRIFIÉE NON VIDE. Interpolée vide,
# `NOT IN ()` est une erreur de syntaxe MySQL : la requête ne rend rien, `ailleurs`
# vaut 0, et TOUS les médias sont classés « à supprimer ». Le garde-fou se
# transformait en son contraire exactement quand il n'y avait rien à purger.
CIBLES_SQL=$(echo "$CIBLES" | tr -s ' ' ',' | sed 's/^,//;s/,$//')
[ -n "$CIBLES_SQL" ] || refus "la liste des produits visés est vide au moment de bâtir la requête : rien ne sera supprimé."

# ── CE QUI DISPARAÎT N'EST PAS « AILLEURS » ─────────────────────────────────
#
# Les quatre requêtes ci-dessous demandent « cette image sert-elle à un contenu
# qu'on GARDE ». Elles excluaient les 42 produits et pas leurs variations, qui
# sont pourtant supprimées dans la même passe. Une variation porte sa propre
# `_thumbnail_id` : une image qui ne sert qu'à une variation condamnée était donc
# comptée comme « utilisée ailleurs » et gardée pour toujours, orpheline.
#
# Trouvé en recalculant la même chose par l'API REST, en HTTPS, pendant que le SSH
# était fermé : le SQL comptait 9 images partagées, le REST 0. Les deux avaient
# raison à leur question ; ce sont les questions qui différaient.
SUPPRIMES_SQL=$(echo "$CIBLES $VARIATIONS" | tr -s ' ' ',' | sed 's/^,//;s/,$//')

GARDES_MEDIA=""
SUPPR_MEDIA=""

# ── QUELLES IMAGES SERVENT AILLEURS : QUATRE REQUÊTES D'ENSEMBLE ────────────
#
# Ce contrôle a été écrit trois fois et les deux premières étaient fausses, dans
# la même direction, qui est la mauvaise.
#
#   1. La version d'origine ne regardait que `_thumbnail_id`. Une image encore en
#      galerie d'un produit conservé, ou citée dans une page vivante, était donc
#      effacée du disque avec son fichier.
#   2. La deuxième posait UNE requête avec une liste `UNION ALL` et quatre
#      `EXISTS`. `wp db query` ne rend AUCUN résultat pour cette forme, sans rien
#      signaler. `$UTILISES` était vide, donc « aucune image n'est partagée »,
#      donc les 69 étaient toutes classées à supprimer. Un contrôle témoin
#      « SELECT 1 » ne l'a pas vu : il prouvait que la base répond, pas que MA
#      requête répond. Une vérification indépendante a compté 9 images partagées.
#
# D'où cette forme-ci : quatre requêtes qui rendent chacune un ENSEMBLE, sur des
# formes dont on a mesuré qu'elles rendent bien leurs lignes, et l'extraction des
# identifiants faite ici plutôt qu'en SQL. Et un canari, plus bas, parce qu'un
# contrôle dont l'échec ressemble à un succès doit porter sa propre preuve.
if [ -n "$(echo "$MEDIAS" | tr -d ' ')" ]; then

  # 1. Vignettes des contenus conservés.
  U1=$(q "SELECT DISTINCT pm.meta_value FROM ${P}postmeta pm JOIN ${P}posts p ON p.ID = pm.post_id
          WHERE pm.meta_key = '_thumbnail_id' AND p.ID NOT IN ($SUPPRIMES_SQL)")

  # 2. Galeries des produits conservés : des listes séparées par des virgules.
  U2=$(q "SELECT pm.meta_value FROM ${P}postmeta pm JOIN ${P}posts p ON p.ID = pm.post_id
          WHERE pm.meta_key = '_product_image_gallery' AND pm.meta_value <> '' AND p.ID NOT IN ($SUPPRIMES_SQL)" \
       | tr ',' '\n')

  # 3. Le corps des contenus conservés : WordPress y écrit `wp-image-<id>`.
  # `|| true` PARCE QU'UN grep QUI NE TROUVE RIEN REND 1. Sous
  # `set -euo pipefail`, ce 1 remonte la chaîne et tue le script, donc l'absence
  # de contenu citant une image, qui est le cas NORMAL, arrêtait la purge net.
  # Mesuré sur le miroir : U3 vide, sortie 1, plus rien après « VARIATIONS liées ».
  # C'est la deuxième fois de la séance que cette forme casse un script au moment
  # exact où tout va bien ; la première était dans l'anonymiseur.
  U3=$(q "SELECT post_content FROM ${P}posts WHERE ID NOT IN ($SUPPRIMES_SQL)
          AND post_status NOT IN ('trash','auto-draft') AND post_content LIKE '%wp-image-%'" \
       | grep -oE 'wp-image-[0-9]+' | cut -d- -f3 || true)

  # 4. Elementor, qui ne met rien dans post_content et tout dans une meta. La
  #    page d'accueil de cette boutique est une page Elementor de démonstration
  #    de meubles : c'est le contenu le plus susceptible de partager une image
  #    avec un produit purgé.
  U4=$(q "SELECT pm.meta_value FROM ${P}postmeta pm JOIN ${P}posts p ON p.ID = pm.post_id
          WHERE pm.meta_key = '_elementor_data' AND p.ID NOT IN ($SUPPRIMES_SQL)" \
       | grep -oE '\"id\":[0-9]+' | cut -d: -f2 || true)

  UTILISES=$(printf '%s\n%s\n%s\n%s\n' "$U1" "$U2" "$U3" "$U4" | tr -d ' ' | grep -E '^[0-9]+$' | sort -u | tr '\n' ' ' || true)

  # ── LE CANARI ───────────────────────────────────────────────────────────────
  #
  # Une vignette d'un contenu CONSERVÉ, choisie dans la base. Elle doit
  # obligatoirement ressortir de la requête 1. Si elle n'y est pas, c'est que
  # cette lecture ne rend pas ce qu'elle devrait, et « aucune image partagée »
  # serait alors une lecture ratée et non un résultat. On refuse.
  CANARI=$(q "SELECT pm.meta_value FROM ${P}postmeta pm JOIN ${P}posts p ON p.ID = pm.post_id
              WHERE pm.meta_key = '_thumbnail_id' AND p.ID NOT IN ($SUPPRIMES_SQL) AND pm.meta_value <> '' LIMIT 1" | tr -d ' ')
  if [ -n "$CANARI" ]; then
    trouve=0
    for u in $UTILISES; do [ "$u" = "$CANARI" ] && trouve=1; done
    [ "$trouve" -eq 1 ] || refus "le contrôle des médias partagés ne retrouve pas son propre témoin ($CANARI) : la lecture est fausse, aucun média ne sera supprimé."
  fi

  for m in $MEDIAS; do
    garde=0
    for u in $UTILISES; do [ "$m" = "$u" ] && garde=1; done
    if [ "$garde" -eq 1 ]; then GARDES_MEDIA="$GARDES_MEDIA $m"; else SUPPR_MEDIA="$SUPPR_MEDIA $m"; fi
  done
fi
dire "MÉDIAS   : $(echo "$SUPPR_MEDIA" | wc -w) à supprimer, $(echo "$GARDES_MEDIA" | wc -w) gardés parce qu'un autre contenu les utilise."
dire ""

dire "NON TOUCHÉ, et à décider par un humain :"
q "SELECT post_type, COUNT(*) FROM ${P}posts
   WHERE post_type IN ('woodmart_slider','woodmart_slide','woodmart_layout','cms_block','elementor_library','template','woodmart_size_guide')
   GROUP BY post_type" | sed 's/^/  /' | tee -a "$LOG"
dire "  La page d'accueil est '$(wp option get page_on_front 2>/dev/null || echo '?')' et son slug est '$(wp post get "$(wp option get page_on_front 2>/dev/null || echo 0)" --field=post_name 2>/dev/null || echo '?')'."
dire ""

if [ "$FAIRE" -eq 0 ]; then
  dire "SIMULATION : rien n'a été supprimé. Relancez avec --faire."
  echo "purge-demo: journal dans $LOG"
  exit 0
fi

# ── L'EXPORT DE SECOURS, AVANT LA PREMIÈRE SUPPRESSION ──────────────────────
# Les termes attachés aux produits visés, relevés AVANT la suppression : après,
# la relation n'existe plus et on ne saurait plus lesquels cette purge a vidés.
TERMES_AVANT=""
for tax in product_cat product_tag product_brand; do
  for t in $(q "SELECT DISTINCT tt.term_id FROM ${P}term_relationships tr
                JOIN ${P}term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
                WHERE tt.taxonomy = '$tax' AND tr.object_id IN ($CIBLES_SQL)"); do
    TERMES_AVANT="$TERMES_AVANT $tax:$t"
  done
done
dire "TERMES candidats (attachés aux produits visés) : $(echo "$TERMES_AVANT" | wc -w)"

WXR="$JOURNAL/$STAMP-produits.xml"
# LES VARIATIONS ET LES MÉDIAS SONT DANS L'EXPORT, EUX AUSSI. Il ne portait que
# les produits, donc réimporter ce fichier aurait rendu 42 produits sans leurs
# 57 variations ni leurs images : un filet qui ne rattrape que la moitié de ce
# qu'il laisse tomber.
TOUT_SQL=$(echo "$CIBLES $VARIATIONS $SUPPR_MEDIA" | tr -s ' ' ',' | sed 's/^,//;s/,$//')
if wp export --dir="$JOURNAL" --filename_format="$STAMP-produits.xml" --post__in="$TOUT_SQL" >/dev/null 2>&1; then
  dire "EXPORT   : $WXR ($(du -h "$WXR" 2>/dev/null | cut -f1))"
else
  echec "l'export de secours a échoué : rien ne sera supprimé sans lui"
fi

# ── SUPPRIMER ───────────────────────────────────────────────────────────────
dire ""
dire "SUPPRESSION ..."
N=0
for id in $VARIATIONS; do wp post delete "$id" --force >/dev/null 2>&1 && N=$((N+1)); done
dire "  $N variation(s)"
N=0
for id in $CIBLES; do wp post delete "$id" --force >/dev/null 2>&1 && N=$((N+1)); done
dire "  $N produit(s)"
N=0
for id in $SUPPR_MEDIA; do wp post delete "$id" --force >/dev/null 2>&1 && N=$((N+1)); done
dire "  $N média(s)"

# LES TERMES QUE CETTE PURGE A VIDÉS, ET PAS TOUS LES TERMES VIDES.
#
# La boucle parcourait toutes les taxonomies et supprimait chaque terme à zéro
# produit. Une catégorie créée d'avance pour un futur produit, vide parce qu'elle
# est neuve et pas parce qu'on vient de la vider, disparaissait avec le reste.
# `$TERMES_AVANT` est relevé PLUS HAUT, avant la suppression : seuls ces termes-là
# sont candidats.
for tax in product_cat product_tag product_brand; do
  wp term recount "$tax" >/dev/null 2>&1 || true
done
N=0
for paire in $TERMES_AVANT; do
  tax="${paire%%:*}"
  t="${paire#*:}"
  c=$(wp term get "$tax" "$t" --field=count 2>/dev/null || echo 1)
  slug=$(wp term get "$tax" "$t" --field=slug 2>/dev/null || echo '')
  # « non classé » et « tout » restent : WooCommerce s'en sert par défaut.
  case "$slug" in uncategorized|non-classe|tout) continue ;; esac
  if [ "${c:-1}" -eq 0 ]; then wp term delete "$tax" "$t" >/dev/null 2>&1 && N=$((N+1)); fi
done
dire "  $N terme(s) que cette purge a vidé(s)"

wp cache flush >/dev/null 2>&1 || true

# ── LE COMPTE APRÈS ─────────────────────────────────────────────────────────
AP_PRODUITS=$(wp post list --post_type=product --post_status=any --format=count)
AP_VARIATIONS=$(wp post list --post_type=product_variation --post_status=any --format=count)
AP_MEDIAS=$(wp post list --post_type=attachment --post_status=any --format=count)
AP_TERMES=$(q "SELECT COUNT(*) FROM ${P}term_taxonomy WHERE taxonomy IN ('product_cat','product_tag','product_brand')")
AP_COMMANDES=$(q "SELECT COUNT(*) FROM ${P}wc_orders")
dire ""
dire "APRÈS   produits=$AP_PRODUITS variations=$AP_VARIATIONS medias=$AP_MEDIAS termes=$AP_TERMES commandes=$AP_COMMANDES"
dire "ÉCART   produits=-$((AV_PRODUITS-AP_PRODUITS)) variations=-$((AV_VARIATIONS-AP_VARIATIONS)) medias=-$((AV_MEDIAS-AP_MEDIAS)) termes=-$((AV_TERMES-AP_TERMES))"

# LE SEUL COMPTE QUI N'A PAS LE DROIT DE BOUGER.
if [ "$AV_COMMANDES" != "$AP_COMMANDES" ]; then
  dire "ALERTE : le nombre de commandes est passé de $AV_COMMANDES à $AP_COMMANDES. Restaurez la sauvegarde."
  echec "une purge de produits a touché des commandes"
fi
dire "commandes : $AP_COMMANDES, inchangé."
echo "purge-demo: journal dans $LOG"
