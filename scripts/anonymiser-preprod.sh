#!/bin/bash
#
# Retirer les données personnelles de la préproduction.
#
#   ./anonymiser-preprod.sh [racine_wordpress]
#
# ── POURQUOI ─────────────────────────────────────────────────────────────────
#
# La préproduction est une copie intégrale de la boutique, donc les noms, les
# adresses postales, les téléphones et les adresses e-mail de quinze vraies
# personnes vivent dans un second endroit, derrière un simple mot de passe HTTP.
# Au sens du RGPD c'est un traitement de plus, et le principe de minimisation de
# l'article 5.1.c s'y applique comme ailleurs. `ACCES-REQUIS.md` le signale
# depuis le 14/08/2026 comme « à faire » ; ceci le fait.
#
# À REPASSER APRÈS CHAQUE RESYNCHRONISATION, parce que réimporter la base de la
# production réimporte les personnes avec.
#
# ── CE QUE CE SCRIPT NE FAIT PAS ─────────────────────────────────────────────
#
# Il ne rend pas la copie anonyme au sens où la CNIL emploie le mot : les
# commandes, leurs montants et leurs dates restent, et quinze commandes datées
# restent quinze commandes datées. Il retire les identifiants directs, ce qui est
# ce qu'on peut faire sans détruire ce à quoi la préproduction sert. La copie
# reste donc à traiter avec précaution, et le mot de passe HTTP reste nécessaire.
#
# ── LA VÉRIFICATION EST LA MOITIÉ IMPORTANTE ─────────────────────────────────
#
# Le recensement du 02/09/2026 a trouvé des données personnelles dans quatorze
# endroits, dont plusieurs qu'une liste écrite à la main n'aurait pas eus : 89
# notes de commande dans `wp68_comments`, 245 lignes `_billing_*` restées dans
# `wp68_postmeta` malgré HPOS, les index d'adresse de `wp68_wc_orders_meta` qui
# contiennent l'adresse complète en clair, l'IP et le navigateur de chaque
# commande, et quatre tables d'extensions marketing (`bwf_contact`,
# `bwf_optin_entries`, `bwfan_abandonedcarts`, `woodmart_unsubscribed_emails`).
#
# ET LA PREMIÈRE VERSION DE CE SCRIPT, QUI COUVRAIT TOUT CELA, A ÉCHOUÉ : 47 des
# 48 identifiants relevés étaient encore là. La relecture les a trouvés dans deux
# familles que personne n'avait inventoriées et qui ne parlent même pas des
# quinze clients :
#
#   wp68_wflogins            108 lignes. Wordfence journalise chaque tentative de
#                            connexion avec son identifiant et son IP.
#   wp68_e_submissions*       27 lignes. Elementor conserve les formulaires que
#                            des visiteurs ont remplis, avec ce qu'ils y ont mis.
#
# Il y a 72 adresses e-mail distinctes dans cette base, pas 15. Les deux tables
# existent aussi EN PRODUCTION, où personne ne leur a fixé de durée de
# conservation : c'est noté dans docs/RGPD.md et dans QUESTIONS-ASSOCIE.md.
#
# Donc ce script ne se croit pas sur parole. Il RELÈVE les identifiants réels
# avant de commencer, il nettoie, puis il exporte la base entière et cherche
# chacun d'eux dedans. Zéro trouvé, ou il refuse. Un vidage complet relu par un
# grep ne partage aucun code avec les requêtes de nettoyage, donc il ne peut pas
# partager leur angle mort, et c'est exactement pour cela qu'il est fait comme ça.
#
# Les identifiants relevés ne sont jamais affichés, ni écrits ailleurs que dans un
# fichier temporaire en 600 supprimé à la sortie.
#
# Sortie : 0 il ne reste rien · 1 il reste quelque chose · 2 refus de tourner ici.

set -euo pipefail

case ":$PATH:" in
  *":/usr/local/bin:"*) ;;
  *) PATH="/usr/local/bin:$PATH" ;;
esac
export PATH

RACINE="${1:-$HOME/myTiger-Preprod/4bde-26076daa9357.wptiger.fr}"

refus() { echo "anonymiser: $*" >&2; exit 2; }

command -v wp >/dev/null || refus "wp-cli est introuvable. PATH=$PATH"
[ -f "$RACINE/wp-config.php" ] || refus "$RACINE ne contient pas de wp-config.php"

cd "$RACINE"

# ── QUATRE VERROUS INDÉPENDANTS, ET IL EN FAUT QUATRE ───────────────────────
#
# Ce script écrase des noms et des adresses. Lancé sur la boutique il détruirait
# quinze commandes réelles de façon irréversible, et c'est le seul script du
# dépôt dont c'est vrai. Un seul contrôle qui se trompe suffirait, donc il y en a
# quatre, et ils ne se déduisent pas les uns des autres : deux viennent de la
# configuration, un du chemin, un de la base elle-même.

# 1. Le chemin ne doit pas être celui de la production.
case "$(cd "$RACINE" && pwd -P)" in
  "$(cd "$HOME" && pwd -P)/public_html"*) refus "REFUS : $RACINE est la boutique de production." ;;
esac

# 2. WordPress doit se déclarer en préproduction.
ENVTYPE="$(wp eval 'echo wp_get_environment_type();' 2>/dev/null || echo '?')"
[ "$ENVTYPE" = "staging" ] || refus "REFUS : wp_get_environment_type() répond « $ENVTYPE » et non « staging »."

# 3. Le site ne doit pas se déclarer indexable. Une préproduction l'est à 0.
PUBLIC="$(wp option get blog_public 2>/dev/null || echo '?')"
[ "$PUBLIC" = "0" ] || refus "REFUS : blog_public vaut « $PUBLIC ». Une préproduction est à 0."

# 4. La base ne doit pas être celle de la production. C'est le contrôle qui a été
#    fait à la main le 14/08 en écrivant une option d'un côté et en la cherchant
#    de l'autre ; ici il suffit de comparer les deux DB_NAME, parce que les deux
#    installations sont sur le même compte et lisibles.
ICI="$(wp eval 'echo DB_NAME;' 2>/dev/null)"
if [ -f "$HOME/public_html/wp-config.php" ]; then
  LA="$(cd "$HOME/public_html" && wp eval 'echo DB_NAME;' 2>/dev/null || echo '')"
  [ -n "$LA" ] && [ "$ICI" = "$LA" ] && refus "REFUS : cette installation partage la base de la production ($ICI)."
fi

echo "anonymiser: cible $RACINE, base $ICI, environnement $ENVTYPE."

TMP="$(mktemp -d)"
chmod 700 "$TMP"
trap 'rm -rf "$TMP"' EXIT

q() { wp db query "$1" --skip-column-names 2>/dev/null; }


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

# ── 1. RELEVER LES IDENTIFIANTS RÉELS, POUR POUVOIR LES CHERCHER APRÈS ──────
#
# Jamais affichés. C'est la liste contre laquelle le vidage final sera relu.
{
  q "SELECT DISTINCT email FROM ${P}wc_order_addresses WHERE email <> ''"
  q "SELECT DISTINCT billing_email FROM ${P}wc_orders WHERE billing_email <> ''"
  q "SELECT DISTINCT user_email FROM ${P}users WHERE user_email <> ''"
  q "SELECT DISTINCT phone FROM ${P}wc_order_addresses WHERE phone <> '' AND LENGTH(phone) >= 8"
  q "SELECT DISTINCT last_name FROM ${P}wc_order_addresses WHERE LENGTH(last_name) >= 5"
  q "SELECT DISTINCT email FROM ${P}bwf_contact WHERE email <> ''"
} 2>/dev/null \
  | sed '/^$/d' \
  `# CE SCRIPT REPASSE APRÈS CHAQUE RESYNCHRONISATION, donc il rencontre ses` \
  `# propres remplacements. Sans ce filtre, la deuxième exécution relèverait` \
  `# « client12@example.invalid » comme un identifiant à faire disparaître, le` \
  `# trouverait évidemment dans le vidage, et déclarerait un échec sur une base` \
  `# parfaitement propre.` \
  | grep -viE '@example\.invalid|^Nom[0-9]+$|^Prenom[0-9]+$|^Societe[0-9]+$|^0100000000$' \
  | sort -u > "$TMP/identifiants.txt" || true
chmod 600 "$TMP/identifiants.txt"
AVANT=$(wc -l < "$TMP/identifiants.txt")
echo "anonymiser: $AVANT identifiant(s) direct(s) relevé(s) avant nettoyage."

if [ "$AVANT" -eq 0 ]; then
  # Rien à relever : soit c'est déjà fait, soit les requêtes ci-dessus ne lisent
  # plus rien, et ces deux résultats ne se ressemblent que de loin. Le marqueur
  # tranche, et son absence est un refus.
  DEJA="$(wp option get teeshoop_anonymisee 2>/dev/null || echo '')"
  [ -n "$DEJA" ] || refus "aucun identifiant relevé ET aucun marqueur : ce nettoyage ne prouverait rien. Les requêtes de relevé ne lisent probablement plus la bonne chose."
  echo "anonymiser: rien à faire, déjà anonymisée le $DEJA."
  exit 0
fi

# ── 2. NETTOYER ─────────────────────────────────────────────────────────────
#
# `.invalid` est réservé par la RFC 2606 et ne peut PAS exister : même si le
# coupe-circuit e-mail du mu-plugin sautait un jour, aucun de ces messages ne
# pourrait atteindre qui que ce soit. `example.com`, lui, existe.
echo "anonymiser: nettoyage ..."

wp db query "UPDATE ${P}wc_order_addresses SET
    first_name = CONCAT('Prenom', order_id),
    last_name  = CONCAT('Nom', order_id),
    company    = IF(company IS NULL OR company = '', company, CONCAT('Societe', order_id)),
    address_1  = CONCAT(order_id, ' rue de la Preproduction'),
    address_2  = '',
    city       = 'Paris',
    state      = '',
    postcode   = '75001',
    email      = CONCAT('client', order_id, '@example.invalid'),
    phone      = '0100000000'"

wp db query "UPDATE ${P}wc_orders SET
    billing_email = CONCAT('client', id, '@example.invalid'),
    ip_address    = '0.0.0.0',
    user_agent    = 'preproduction',
    customer_note = IF(customer_note IS NULL OR customer_note = '', customer_note, 'note retiree en preproduction'),
    transaction_id = IF(transaction_id IS NULL OR transaction_id = '', transaction_id, CONCAT('tx_preprod_', id))"

# Les index d'adresse portent l'adresse complète en clair, dans une chaîne que
# WooCommerce reconstruit à la demande. Les vider est sans conséquence : ils
# servent la recherche dans l'administration.
wp db query "UPDATE ${P}wc_orders_meta SET meta_value = ''
   WHERE meta_key IN ('_billing_address_index','_shipping_address_index')"

# Les identifiants Stripe désignent des personnes chez Stripe. Ils n'ont aucun
# sens hors de la production et ils ne doivent pas voyager.
wp db query "DELETE FROM ${P}wc_orders_meta WHERE meta_key LIKE '_stripe%'"

# HPOS n'a pas retiré les anciennes lignes de postmeta des commandes.
wp db query "UPDATE ${P}postmeta SET meta_value = CASE
      WHEN meta_key LIKE '%_email'      THEN CONCAT('client', post_id, '@example.invalid')
      WHEN meta_key LIKE '%_phone'      THEN '0100000000'
      WHEN meta_key LIKE '%_first_name' THEN CONCAT('Prenom', post_id)
      WHEN meta_key LIKE '%_last_name'  THEN CONCAT('Nom', post_id)
      WHEN meta_key LIKE '%_company'    THEN ''
      WHEN meta_key LIKE '%_address_1'  THEN CONCAT(post_id, ' rue de la Preproduction')
      WHEN meta_key LIKE '%_address_2'  THEN ''
      WHEN meta_key LIKE '%_city'       THEN 'Paris'
      WHEN meta_key LIKE '%_state'      THEN ''
      WHEN meta_key LIKE '%_postcode'   THEN '75001'
      -- _billing_address_index PORTE L'ADRESSE COMPLETE EN CLAIR et la clause
      -- WHERE ci-dessous l'attrape deja, mais aucune branche ne la nommait :
      -- elle tombait dans le ELSE et repartait inchangee. Trouve le 02/09/2026
      -- par la relecture, pas par la lecture du code. Pas de guillemet oblique
      -- dans cette chaine : bash y ferait une substitution de commande.
      WHEN meta_key LIKE '%_address_index' THEN ''
      ELSE meta_value END
   WHERE meta_key REGEXP '^_(billing|shipping)_'"

wp db query "UPDATE ${P}users SET
    user_email = CONCAT('utilisateur', ID, '@example.invalid'),
    user_url   = '',
    display_name = CONCAT('Utilisateur ', ID)
   WHERE user_login NOT IN ('LTHAbdou')"

wp db query "UPDATE ${P}usermeta SET meta_value = CASE
      WHEN meta_key LIKE '%_email'      THEN CONCAT('utilisateur', user_id, '@example.invalid')
      WHEN meta_key LIKE '%_phone'      THEN '0100000000'
      WHEN meta_key IN ('first_name')   THEN CONCAT('Prenom', user_id)
      WHEN meta_key IN ('last_name','nickname') THEN CONCAT('Nom', user_id)
      WHEN meta_key LIKE '%_first_name' THEN CONCAT('Prenom', user_id)
      WHEN meta_key LIKE '%_last_name'  THEN CONCAT('Nom', user_id)
      WHEN meta_key LIKE '%_address_1'  THEN CONCAT(user_id, ' rue de la Preproduction')
      WHEN meta_key LIKE '%_address_2'  THEN ''
      WHEN meta_key LIKE '%_city'       THEN 'Paris'
      WHEN meta_key LIKE '%_postcode'   THEN '75001'
      WHEN meta_key LIKE '%_company'    THEN ''
      WHEN meta_key LIKE '%_state'      THEN ''
      ELSE meta_value END
   WHERE meta_key REGEXP '^(first_name|last_name|nickname|billing_|shipping_)'"

wp db query "UPDATE ${P}wc_customer_lookup SET
    first_name = CONCAT('Prenom', customer_id),
    last_name  = CONCAT('Nom', customer_id),
    email      = CONCAT('client', customer_id, '@example.invalid'),
    username   = CONCAT('client', customer_id),
    city       = 'Paris', state = '', postcode = '75001'"

# Les notes de commande. Une note d'atelier cite couramment le client par son
# nom, et 89 d'entre elles portent une adresse e-mail d'auteur.
wp db query "UPDATE ${P}comments SET
    comment_author       = 'Preproduction',
    comment_author_email = CONCAT('note', comment_ID, '@example.invalid'),
    comment_author_url   = '',
    comment_author_IP    = '0.0.0.0'
   WHERE comment_type = 'order_note' OR comment_author_email <> ''"

wp db query "TRUNCATE TABLE ${P}woocommerce_sessions"
wp db query "DELETE FROM ${P}wc_download_log"

# Les tables qui ne contiennent QUE des personnes se vident plutôt qu'elles ne
# se remplacent : marketing, journaux de connexion Wordfence, soumissions de
# formulaires Elementor. Une préproduction n'a besoin d'aucune des trois, et
# remplacer ligne à ligne ce qui n'a aucune raison d'exister est du travail pour
# rien. Une extension peut avoir été retirée, d'où le `|| true`.
for t in ${P}bwf_contact ${P}bwf_optin_entries ${P}bwfan_abandonedcarts \
         ${P}woodmart_unsubscribed_emails ${P}wc_email_unsubscribes \
         ${P}wflogins ${P}wfhits ${P}wflivetraffichuman ${P}wfnotifications \
         ${P}wfblockediplog ${P}wfblocks7 ${P}wfcrawlers \
         ${P}wffilemods ${P}wfknownfilelist \
         ${P}e_submissions_values ${P}e_submissions_actions_log ${P}e_submissions; do
  wp db query "DELETE FROM $t" >/dev/null 2>&1 || echo "  ($t absente, rien à vider)"
done

# WORDFENCE GARDE SA CONFIGURATION DANS UN longblob, ET C'EST LA SEULE LIGNE QUE
# LE BALAYAGE NE PEUT PAS ATTEINDRE. `wp search-replace` ne traite que les
# colonnes de type texte : mesuré le 02/09/2026, il balaye bien `wp68_wfconfig`
# mais seulement sa colonne `name`, jamais `val`. Or `alertEmails` est dans `val`,
# et c'est l'adresse d'une vraie personne, celle qui reçoit les alertes du
# pare-feu. Aucune quantité de balayage générique ne l'aurait trouvée.
wp db query "UPDATE ${P}wfconfig SET val = 'preproduction@example.invalid'
   WHERE name IN ('alertEmails','apiKey','email_summary_email_addresses')" >/dev/null 2>&1 || true

# ── UN COMPTE CONNECTÉ NE SE NETTOIE PAS, IL SE DÉBRANCHE ───────────────────
#
# `rank_math_connect_data` porte le nom et l'adresse du compte qui a relié le site
# au service Rank Math. C'est l'adresse d'un opérateur et pas d'un client, et
# c'est une donnée personnelle quand même. Elle a été le dernier survivant de la
# relecture du 02/09/2026, et elle a résisté à tout ce qu'on lui a fait :
#
#   wp option delete             -> la ligne revient à la lecture suivante
#   DELETE en SQL direct         -> compte 0, puis 1 au chargement suivant
#   update_option                -> la valeur écrite est réécrite par-dessus
#   UPDATE en SQL direct         -> la ligne brute redevient l'originale
#
# Mesuré, et voici la preuve qui tranche : une écriture avec `--skip-plugins`
# TIENT (la ligne brute devient la nôtre et se relit telle quelle), et le premier
# chargement de WordPress avec les extensions la remet. Il n'y a pas de cache
# objet sur cette installation (`object-cache.php` est absent), donc ce n'est pas
# une lecture périmée : c'est Rank Math qui réécrit l'option à chaque démarrage,
# depuis un état à lui.
#
# Aucun nettoyage de données ne peut gagner contre ça. On débranche donc la cause.
# Sur une copie en `noindex` derrière un mot de passe HTTP, une extension de
# référencement ne sert rien, et une copie de test reliée au compte réel d'un
# service extérieur est en soi ce qu'on ne veut pas.
#
# CE QUE ÇA COÛTE, et il faut le savoir : la préproduction n'est plus tout à fait
# la boutique. Pour éprouver ce qu'un moteur voit (`npm run verify:seo`), il faut
# les réactiver le temps de l'essai :
#   wp plugin activate seo-by-rank-math seo-by-rank-math-pro
# L'ORDRE COMPTE ET IL A MIS LA PRÉPRODUCTION PAR TERRE UNE FOIS. Éteindre
# `seo-by-rank-math` en laissant `seo-by-rank-math-pro` allumé donne un site qui
# rend 500 et un wp-cli qui refuse de démarrer : au chargement suivant, Pro
# constate que la version gratuite est éteinte, la RÉACTIVE lui-même
# (`RankMathPro->activate_free_version()`), et l'installeur de la version gratuite
# appelle `wp_rand()` avant que `pluggable.php` soit chargé. Erreur fatale, à
# chaque requête et à chaque commande.
#
#   Fatal error: Call to undefined function RankMath\wp_rand()
#   .../seo-by-rank-math/includes/class-installer.php:649
#
# Les deux s'éteignent donc dans UNE seule commande, Pro en premier, pour qu'aucun
# démarrage n'ait lieu entre les deux.
wp plugin deactivate seo-by-rank-math-pro seo-by-rank-math >/dev/null 2>&1 || true

# ET ON VÉRIFIE QUE WORDPRESS DÉMARRE ENCORE, tout de suite, parce que la panne
# ci-dessus ne se voit qu'au démarrage SUIVANT. Si wp-cli ne répond plus, on
# rallume et on refuse : une anonymisation qui laisse une préproduction morte n'a
# rien anonymisé du tout, elle a juste cassé l'endroit où l'on teste.
if ! wp option get blog_public >/dev/null 2>&1; then
  wp plugin activate seo-by-rank-math seo-by-rank-math-pro --skip-plugins --skip-themes >/dev/null 2>&1 || true
  refus "WordPress ne démarre plus après l'extinction de Rank Math. Les extensions ont été rallumées."
fi

for o in rank_math_connect_data rank_math_connect_status; do
  wp option delete "$o" >/dev/null 2>&1 || true
done

# Les adresses de service, qui sont des personnes réelles quand elles sont
# nominatives et qui, sur une préproduction, ne doivent surtout pas recevoir.
for o in admin_email new_admin_email woocommerce_email_from_address \
         woocommerce_stock_email_recipient woocommerce_pos_store_email; do
  wp option update "$o" 'preproduction@example.invalid' >/dev/null 2>&1 || true
done

# ── LE BALAYAGE FINAL, ET IL SE FAIT AVEC wp search-replace ─────────────────
#
# Ce qui reste vit dans du contenu libre : le corps d'une page, une valeur
# d'option, une donnée Elementor. On ne le réécrit PAS avec un UPDATE : la
# moitié de ces valeurs sont sérialisées par PHP, où une chaîne est précédée de
# sa longueur (`s:24:"…"`), et changer le texte sans changer le nombre casse la
# désérialisation. C'est exactement l'accident que `ACCES-REQUIS.md` raconte déjà
# à propos des sept liens que `search-replace` avait refusé de réécrire.
#
# `wp search-replace --precise` désérialise, remplace, et re-sérialise. Il est
# lent et c'est le prix à payer pour ne pas abîmer une option en la nettoyant.
echo "anonymiser: balayage du contenu libre ..."
wp db export "$TMP/balayage.sql" --skip-plugins --skip-themes >/dev/null 2>&1
chmod 600 "$TMP/balayage.sql"

# LA CASSE EST CONSERVÉE, et c'est le bogue que la relecture a attrapé. La
# première version passait les adresses trouvées par `tr 'A-Z' 'a-z'` avant de
# les donner à `wp search-replace`, qui est sensible à la casse : une adresse
# écrite « Jean.Dupont@Gmail.com » était cherchée en minuscules et jamais
# trouvée. Cinq adresses sur soixante-dix survivaient, et le script disait avoir
# fait le travail. `sort -u` sans pliage garde chaque forme telle qu'elle est
# écrite dans la base, ce qui est la seule qui sera trouvée.
{
  grep -oE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' "$TMP/balayage.sql" || true
  # ET LES TÉLÉPHONES. Ils vivent aussi dans du contenu libre (un formulaire
  # Elementor, une note), et la première version ne balayait que les adresses :
  # quatorze numéros à dix chiffres restaient. Ceux-ci viennent du relevé
  # initial, donc ce sont de vrais numéros de clients et pas n'importe quelle
  # suite de dix chiffres, ce qui évite de réécrire une référence produit.
  grep -E '^[0-9+][0-9 .+()-]{7,}$' "$TMP/identifiants.txt" || true
  # Et les noms de famille, au-delà de cinq lettres. Un nom peut être un mot
  # courant, donc le remplacer partout abîme un peu le contenu de démonstration ;
  # sur une copie de test c'est le bon côté à choisir.
  grep -E '^[A-Za-zÀ-ÿ-]{5,}$' "$TMP/identifiants.txt" || true
} | sort -u \
  | grep -vE 'example\.invalid|@teeshoop\.com|\.(png|jpg|gif|css|js)$|@wordpress\.org|@woocommerce\.com|@automattic\.com|@sentry|@example\.com' \
  > "$TMP/restantes.txt" || true

N=0
RATES=0
while IFS= read -r valeur; do
  [ -n "$valeur" ] || continue
  N=$(( N + 1 ))
  case "$valeur" in
    *@*) remplacement="anonyme$N@example.invalid" ;;
    [0-9+]*) remplacement="0100000000" ;;
    *) remplacement="Nom$N" ;;
  esac
  # `--precise` désérialise et re-sérialise, donc la longueur `s:NN:` reste juste.
  # `--skip-columns=guid` parce qu'un guid WordPress ne se réécrit jamais.
  if ! wp search-replace "$valeur" "$remplacement" \
        --all-tables-with-prefix --precise --quiet --skip-columns=guid >/dev/null 2>&1; then
    RATES=$(( RATES + 1 ))
  fi
done < "$TMP/restantes.txt"
echo "anonymiser: $N valeur(s) passée(s) au balayage, $RATES échec(s) de remplacement."
[ "$RATES" -eq 0 ] || echo "anonymiser: certains remplacements ont échoué ; la relecture ci-dessous dira ce qui reste." >&2
rm -f "$TMP/balayage.sql"

# ── 3. RELIRE LA BASE ENTIÈRE, AVEC UN LECTEUR QUI NE PARTAGE RIEN ──────────
echo "anonymiser: relecture du vidage complet ..."
wp db export "$TMP/verif.sql" --skip-plugins --skip-themes > /dev/null 2>&1
chmod 600 "$TMP/verif.sql"
[ -s "$TMP/verif.sql" ] || refus "le vidage de contrôle est vide : la vérification ne prouverait rien."

RESTE=0
while IFS= read -r ident; do
  [ -n "$ident" ] || continue
  # LES NOMS SE CHERCHENT AU MOT ENTIER, LE RESTE EN SOUS-CHAÎNE. Un nom de
  # famille de cinq lettres est un morceau de mot courant, et le chercher en
  # sous-chaîne rend des correspondances qui ne sont pas des personnes ; ce
  # contrôle deviendrait alors impossible à passer et donc inutile. Une adresse
  # e-mail et un numéro de téléphone, eux, n'apparaissent pas par hasard.
  case "$ident" in
    *@*|[0-9+]*) n=$(grep -c -F -- "$ident" "$TMP/verif.sql" || true) ;;
    *)           n=$(grep -c -w -F -- "$ident" "$TMP/verif.sql" || true) ;;
  esac
  if [ "$n" -gt 0 ]; then
    RESTE=$(( RESTE + 1 ))
    # L'identifiant lui-même n'est PAS imprimé : c'est une donnée personnelle, et
    # un journal de console en est une copie de plus. Sa longueur et son nombre
    # d'occurrences suffisent pour aller le chercher.
    echo "  IL RESTE un identifiant de ${#ident} caractères, $n fois dans le vidage." >&2
  fi
done < "$TMP/identifiants.txt"

echo "anonymiser: $AVANT identifiant(s) cherché(s), $RESTE encore présent(s)."

# ── LA SECONDE RELECTURE, ET C'EST ELLE QUI A TROUVÉ CE QUE LA PREMIÈRE RATAIT ──
#
# Chercher les identifiants RELEVÉS ne trouve que ce qu'on savait déjà chercher.
# Le 02/09/2026, cette liste disait « 2 restants » pendant qu'une extraction
# indépendante en trouvait quatre : l'adresse d'alerte de Wordfence et une entrée
# Rank Math ne venaient d'aucune des tables interrogées au début, donc elles
# n'étaient dans aucune liste. Celle-ci ne cherche rien de connu : elle relit le
# vidage et exige qu'il ne reste AUCUNE adresse qui ne soit pas une des nôtres.
#
# La liste d'exclusions est courte et nommée. Tout ce qui n'y est pas est un
# refus, ce qui est le sens dans lequel un contrôle doit se tromper.
#
# `|| true` N'EST PAS DE LA PRUDENCE DÉCORATIVE ICI, c'est la correction d'un
# défaut qui rendait ce script incapable de réussir. Sous `set -euo pipefail`, un
# `grep` qui ne trouve RIEN rend 1, `pipefail` propage ce 1 à toute la chaîne, et
# `set -e` tue le script sur l'affectation. Donc le jour où le nettoyage marchait
# parfaitement, la ligne suivante ne s'exécutait jamais, le marqueur n'était pas
# écrit et le script sortait 1 en annonçant un échec. Mesuré : 70 adresses
# ramenées à 0, et sortie 1 quand même.
INCONNUES=$(grep -oE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' "$TMP/verif.sql" \
  | sort -u \
  | grep -vE 'example\.invalid|@teeshoop\.com|@wordpress\.org|@woocommerce\.com|@automattic\.com|@example\.com|@sentry|\.(png|jpg|gif|css|js)$' \
  | wc -l || true)
INCONNUES=${INCONNUES:-0}
# LE COMPTE DE TÉLÉPHONES EST INFORMATIF, ET PAS UN REFUS, POUR UNE RAISON DE
# DROIT. L'article 6 III de la LCEN OBLIGE le site à publier son propre numéro et
# celui de son hébergeur, et ils sont dans les mentions légales et la politique de
# confidentialité. Un numéro français dans une page publiée n'est donc pas une
# fuite, c'est une obligation. Le contrôle strict sur les téléphones existe déjà
# et il est au-dessus : chaque numéro relevé dans `wc_order_addresses`, c'est-à-dire
# chaque numéro de CLIENT, doit avoir disparu, et c'est celui-là qui refuse.
TELS=$(grep -oE '\b0[1-9][0-9]{8}\b' "$TMP/verif.sql" | grep -v '^0100000000$' | sort -u | wc -l || true)
TELS=${TELS:-0}
CLIENTS_RESTANTS=$(wp db query "SELECT COUNT(*) FROM ${P}wc_order_addresses WHERE phone <> '0100000000' AND phone <> ''" --skip-column-names 2>/dev/null || echo '?')
echo "anonymiser: relecture indépendante : $INCONNUES adresse(s) inconnue(s)."
echo "anonymiser: $TELS numéro(s) français encore dans la base (le site DOIT publier le sien et celui de son hébergeur), dont $CLIENTS_RESTANTS de client."

if [ "$INCONNUES" -gt 0 ]; then
  echo "  les domaines concernés, sans la partie locale :" >&2
  grep -oE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' "$TMP/verif.sql" \
    | sort -u \
    | grep -vE 'example\.invalid|@teeshoop\.com|@wordpress\.org|@woocommerce\.com|@automattic\.com|@example\.com|@sentry|\.(png|jpg|gif|css|js)$' \
    | sed 's/^[^@]*@/    (local)@/' | sort | uniq -c | head -10 >&2 || true
fi

if [ "$RESTE" -gt 0 ] || [ "$INCONNUES" -gt 0 ] || [ "${CLIENTS_RESTANTS:-1}" != "0" ]; then
  echo "anonymiser: la préproduction porte encore des données personnelles." >&2
  exit 1
fi

wp option update teeshoop_anonymisee "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > /dev/null
echo "anonymiser: aucune trace des $AVANT identifiants relevés, et aucune adresse ni téléphone inconnu dans toute la base. Marqué dans l'option teeshoop_anonymisee."
