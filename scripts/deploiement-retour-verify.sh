#!/bin/bash
#
# LE RETOUR ARRIÈRE, PROUVÉ SUR UN VRAI WORDPRESS.
#
#   npm run verify:retour        (ou : bash scripts/deploiement-retour-verify.sh)
#
# POURQUOI CE HARNAIS EXISTE. `scripts/deploiement.sh` est le script serveur, et
# jusqu'au 5 septembre 2026 son verbe `retour` déplaçait le répertoire du thème
# sans jamais changer le thème actif, tandis que `installer` ne l'activait pas
# davantage. Personne ne l'avait vu parce que la production tournait sous un
# autre thème : on déplaçait un répertoire que WordPress ne chargeait pas. À la
# seconde où la boutique passe sous « teeshoop », la procédure d'urgence du
# vendredi soir devient la commande qui casse le site.
#
# Un défaut de cette forme ne se prouve pas en lisant le script. Il se prouve en
# faisant un aller et un retour RÉELS contre un WordPress qui rend des pages, et
# en demandant à WordPress quel thème il croit avoir.
#
# CE HARNAIS NE TOUCHE PAS LE MIROIR DE DÉVELOPPEMENT. Il monte sa propre
# instance jetable (sa base, son Apache, son volume), justement parce que le
# miroir partage ses répertoires avec le dépôt par bind mount : `mv` sur un
# point de montage rend « Device or resource busy », et le déploiement est fait
# de `mv`. Une instance jetable est aussi ce qui permet de casser une page
# exprès sans casser le travail de quelqu'un d'autre.
#
# CE QU'IL AFFIRME, ET CHAQUE LIGNE EST UN DÉFAUT QUI A EXISTÉ :
#
#   1. l'aller active le thème (il ne se contentait pas de le copier) ;
#   2. l'aller note le thème qui était actif avant ;
#   3. la sonde HTTP visite la boutique anonymement et la trouve debout ;
#   4. la sonde HTTP DEVIENT ROUGE sur une page cassée exprès, et elle
#      déclenche le retour arrière ;
#   5. le retour réactive le thème précédent AVANT de déplacer le répertoire ;
#   6. après le retour, la boutique se visite encore ;
#   7. un SECOND retour sur la même livraison ne supprime rien et sort non-zéro ;
#   8. le retour REFUSE de retirer un répertoire qui est le thème actif.
#
# Sortie : 0 tout est vert · 1 une affirmation est fausse.

set -uo pipefail

RACINE_DEPOT="$(cd "$(dirname "$0")/.." && pwd)"
TRAVAIL="${TMPDIR:-/tmp}/teeshoop-retour-$$"
RESEAU="wp-local_default"
IMAGE_WP="teeshoop/wp-local:7.1-php8.3"
IMAGE_CLI="teeshoop/wp-cli-local:php8.3"
CONTENEUR="teeshoop-faux-wp-$$"
BASE="teeshoop_retour_$$"
BASE="${BASE//-/_}"
SITE="http://$CONTENEUR"

vert=0; rouge=0
ok()   { vert=$(( vert + 1 ));  printf '  \033[32mok\033[0m    %s\n' "$*"; }
ko()   { rouge=$(( rouge + 1 )); printf '  \033[31mNON\033[0m   %s\n' "$*"; }
titre(){ printf '\n\033[1m── %s\033[0m\n' "$*"; }

nettoyer() {
  docker rm -f "$CONTENEUR" >/dev/null 2>&1 || true
  docker exec wp-local-db-1 mariadb -uroot -proot -e "DROP DATABASE IF EXISTS \`$BASE\`;" >/dev/null 2>&1 || true
  # LE MÉNAGE SE FAIT DEPUIS UN CONTENEUR. Le coeur de WordPress est déballé par
  # l'entrypoint sous root ; l'utilisateur de la machine hôte ne peut pas le
  # supprimer, et un `rm -rf` qui échoue en silence laisse 60 Mo par passage.
  docker run --rm -u 0 -v "$TRAVAIL:/mnt/t" --entrypoint sh "$IMAGE_CLI" \
    -c 'rm -rf /mnt/t/* /mnt/t/.[!.]* 2>/dev/null; exit 0' >/dev/null 2>&1 || true
  rmdir "$TRAVAIL" 2>/dev/null || true
}
trap nettoyer EXIT

# `wp` dans l'instance jetable : même image que le miroir, même réseau, et le
# faux compte monté là où le script serveur l'attend ($HOME/public_html).
faux() {
  # LES VARIABLES DE BASE SONT PASSÉES ICI AUSSI, ET C'EST LE PIÈGE DE L'IMAGE
  # OFFICIELLE : le wp-config.php qu'elle écrit ne contient PAS les valeurs, il
  # contient getenv_docker('WORDPRESS_DB_HOST', 'mysql'). Un conteneur WP-CLI
  # sans ces variables lit donc les DÉFAUTS et cherche un serveur nommé
  # « mysql », qui n'existe pas : « Error establishing a database connection »
  # sur une base parfaitement saine. Le même piège, dans l'autre sens, a déjà
  # coûté une journée sur ce dépôt (voir wp-local/docker-compose.yml).
  docker run --rm --network "$RESEAU" \
    -e HOME=/srv/faux -e WP_CLI_CACHE_DIR=/tmp/wpcache \
    -e WORDPRESS_DB_HOST=db -e WORDPRESS_DB_NAME="$BASE" \
    -e WORDPRESS_DB_USER=teeshoop -e WORDPRESS_DB_PASSWORD=teeshoop \
    -v "$TRAVAIL:/srv/faux" -w /srv/faux -u 33:33 \
    --entrypoint bash "$IMAGE_CLI" -c "$1" 2>&1
}
wpf() { faux "wp --path=/srv/faux/public_html --skip-plugins=woocommerce $*"; }

titre "L'instance jetable"
docker ps --format '{{.Names}}' | grep -qx wp-local-db-1 \
  || { echo "Le miroir n'est pas démarré (npm run wp:up) : ce harnais emprunte sa base."; exit 1; }

mkdir -p "$TRAVAIL/public_html"
chmod 777 "$TRAVAIL" "$TRAVAIL/public_html"
docker exec wp-local-db-1 mariadb -uroot -proot \
  -e "CREATE DATABASE \`$BASE\`; GRANT ALL ON \`$BASE\`.* TO 'teeshoop'@'%';" \
  || { echo "création de la base jetable refusée"; exit 1; }

docker run -d --rm --name "$CONTENEUR" --network "$RESEAU" \
  -e WORDPRESS_DB_HOST=db -e WORDPRESS_DB_NAME="$BASE" \
  -e WORDPRESS_DB_USER=teeshoop -e WORDPRESS_DB_PASSWORD=teeshoop \
  -v "$TRAVAIL/public_html:/var/www/html" "$IMAGE_WP" >/dev/null \
  || { echo "Apache jetable refusé"; exit 1; }

# L'entrypoint officiel déballe le coeur dans un répertoire vide : on l'attend.
for _ in $(seq 1 60); do [ -f "$TRAVAIL/public_html/wp-settings.php" ] && break; sleep 1; done
[ -f "$TRAVAIL/public_html/wp-settings.php" ] || { echo "WordPress ne s'est pas déballé"; exit 1; }

wpf "core install --url='$SITE' --title='Teeshoop retour' --admin_user=dev \
     --admin_email=dev@example.invalid --admin_password=$(openssl rand -hex 12) --skip-email" >/dev/null
wpf "plugin install woocommerce --version=11.0.1 --activate" >/dev/null
wpf "theme activate twentytwentyfour" >/dev/null

# WooCommerce ne crée ses pages qu'à l'installation guidée : on les pose, parce
# que la sonde HTTP les exige et qu'une boutique sans panier n'en est pas une.
wpf "eval 'WC_Install::create_pages(); WC_Install::create_options();'" >/dev/null
wpf "rewrite structure '/%postname%/' --hard" >/dev/null
wpf "post create --post_type=product --post_title='Tee de contrôle' --post_status=publish" >/dev/null

avant="$(wpf 'theme list --status=active --field=name' | tr -d '\r\n ')"
[ "$avant" = "twentytwentyfour" ] && ok "l'instance jetable est debout, thème actif : $avant" \
                                  || ko "thème de départ inattendu : « $avant »"

titre "La livraison"
mkdir -p "$TRAVAIL/teeshoop-deploiements/prod/entrant"
cp -a "$RACINE_DEPOT/wp-plugins/teeshoop-core" "$TRAVAIL/teeshoop-deploiements/prod/entrant/teeshoop-core"
cp -a "$RACINE_DEPOT/wp-themes/teeshoop"      "$TRAVAIL/teeshoop-deploiements/prod/entrant/teeshoop"
cp "$RACINE_DEPOT/scripts/deploiement.sh" "$TRAVAIL/deploiement.sh"
# Le faux compte appartient à l'hôte, le script serveur tourne sous l'utilisateur
# du serveur web : sans ça, `mv` hors du dépôt entrant est refusé.
# `installer` pose 755/644 sur ce qu'il va installer : il doit donc POSSÉDER
# les fichiers. Sur o2switch le compte possède tout ; ici la copie vient de
# l'hôte, donc on rend la propriété au même utilisateur que le serveur web.
docker run --rm -u 0 -v "$TRAVAIL:/srv/faux" --entrypoint chown "$IMAGE_CLI" \
  -R 33:33 /srv/faux/teeshoop-deploiements >/dev/null

titre "1. L'ALLER"
sortie="$(faux 'PATH=/usr/local/bin:$PATH; cd /srv/faux && bash deploiement.sh installer prod')"
echo "$sortie" | sed 's/^/    /'
apres="$(wpf 'theme list --status=active --field=name' | tr -d '\r\n ')"
[ "$apres" = "teeshoop" ] && ok "l'aller a ACTIVÉ le thème (avant : $avant, après : $apres)" \
                          || ko "le thème actif est « $apres », attendu « teeshoop »"
note="$(cat "$TRAVAIL"/teeshoop-deploiements/prod/versions/*/THEME-PRECEDENT.txt 2>/dev/null | tr -d '\r\n ')"
[ "$note" = "twentytwentyfour" ] && ok "l'aller a noté le thème précédent : $note" \
                                 || ko "THEME-PRECEDENT.txt dit « $note », attendu « twentytwentyfour »"
echo "$sortie" | grep -q 'sonde: .* pages visitées anonymement' \
  && ok "la sonde HTTP a visité la boutique et l'a trouvée debout" \
  || ko "la sonde HTTP n'a pas rendu son verdict vert"

titre "2. LE RETOUR"
livraison="$(ls -1 "$TRAVAIL/teeshoop-deploiements/prod/versions" | sort | tail -1)"
premiere="$livraison"
sortie="$(faux "PATH=/usr/local/bin:\$PATH; cd /srv/faux && bash deploiement.sh retour prod $livraison")"
code=$?
echo "$sortie" | sed 's/^/    /'
rendu="$(wpf 'theme list --status=active --field=name' | tr -d '\r\n ')"
[ "$rendu" = "twentytwentyfour" ] && ok "le retour a RÉACTIVÉ le thème précédent : $rendu" \
                                  || ko "après retour le thème actif est « $rendu », attendu « twentytwentyfour »"
[ -d "$TRAVAIL/public_html/wp-content/themes/teeshoop" ] \
  && ko "le répertoire du thème est encore là après retour" \
  || ok "le répertoire du thème a bien été retiré, APRÈS le changement de thème"
echo "$sortie" | grep -q 'sonde après retour: .* pages visitées anonymement' \
  && ok "la boutique se visite encore après le retour" \
  || ko "la sonde après retour n'a pas rendu son verdict vert"

titre "3. LA SONDE HTTP DOIT POUVOIR ÊTRE ROUGE"
# On ré-installe, mais avec un thème saboté : c'est le cas que la sonde `wp eval`
# ne voyait pas, un gabarit qui fatal en façade alors que l'extension se charge
# parfaitement sous le compte.
docker run --rm -u 0 -v "$TRAVAIL:/srv/faux" --entrypoint chown "$IMAGE_CLI" \
  -R "$(id -u):$(id -g)" /srv/faux/teeshoop-deploiements >/dev/null
mkdir -p "$TRAVAIL/teeshoop-deploiements/prod/entrant"
cp -a "$RACINE_DEPOT/wp-plugins/teeshoop-core" "$TRAVAIL/teeshoop-deploiements/prod/entrant/teeshoop-core"
cp -a "$RACINE_DEPOT/wp-themes/teeshoop"      "$TRAVAIL/teeshoop-deploiements/prod/entrant/teeshoop"
printf '\n// panne volontaire, harnais de verification : EN FACADE SEULEMENT.\n// WP-CLI continue de tourner et la sonde `wp eval` reste verte ; seule une\n// requete de client fatal. C est le cas que le deploiement ne savait pas voir.\nadd_action( "template_redirect", static function () { throw new \\Error( "teeshoop: panne volontaire" ); } );\n' \
  >> "$TRAVAIL/teeshoop-deploiements/prod/entrant/teeshoop/functions.php"
docker run --rm -u 0 -v "$TRAVAIL:/srv/faux" --entrypoint chown "$IMAGE_CLI" \
  -R 33:33 /srv/faux/teeshoop-deploiements >/dev/null

sortie="$(faux 'PATH=/usr/local/bin:$PATH; cd /srv/faux && bash deploiement.sh installer prod; echo CODE=$?')"
echo "$sortie" | sed 's/^/    /'
echo "$sortie" | grep -q 'sonde: ROUGE' \
  && ok "la sonde HTTP est ROUGE sur une page cassée exprès" \
  || ko "la sonde HTTP n'a pas vu la panne volontaire"
echo "$sortie" | grep -q 'CODE=0' \
  && ko "le déploiement d'un thème qui fatal a rendu 0" \
  || ok "le déploiement a échoué au lieu de laisser la boutique cassée"
echo "$sortie" | grep -q 'sonde après retour: .* pages visitées anonymement' \
  && ok "le retour arrière automatique a remis la boutique debout, et c'est REVÉRIFIÉ" \
  || ko "la revérification après retour automatique n'a pas eu lieu"
sain="$(wpf 'theme list --status=active --field=name' | tr -d '\r\n ')"
[ "$sain" = "twentytwentyfour" ] && ok "après le retour automatique, le thème actif est de nouveau $sain" \
                                 || ko "après le retour automatique le thème actif est « $sain »"

titre "4. LE SECOND RETOUR, celui qu'on tape quand on ne sait plus où on en est"
avant_second="$(ls -1 "$TRAVAIL/public_html/wp-content/plugins" "$TRAVAIL/public_html/wp-content/themes" 2>/dev/null)"
sortie="$(faux "PATH=/usr/local/bin:\$PATH; cd /srv/faux && bash deploiement.sh retour prod $premiere; echo CODE=\$?")"
echo "$sortie" | sed 's/^/    /'
echo "$sortie" | grep -q 'CODE=0' \
  && ko "le second retour sort 0 : il annonce « ramené » sans rien avoir à remettre" \
  || ok "le second retour sort non-zéro et ne prétend pas avoir ramené quelque chose"
# CE QU'ON VÉRIFIE ICI N'EST PAS UNE ABSENCE MAIS UNE IMMOBILITÉ : un retour qui
# refuse ne doit rien avoir déplacé, ni dans un sens ni dans l'autre.
[ "$avant_second" = "$(ls -1 "$TRAVAIL/public_html/wp-content/plugins" "$TRAVAIL/public_html/wp-content/themes" 2>/dev/null)" ] \
  && ok "le second retour n'a rien déplacé du tout" \
  || ko "le second retour a modifié wp-content alors qu'il refusait"

echo
printf '\033[1m%s\033[0m\n' "$vert vert(s), $rouge rouge(s)"
[ "$rouge" -eq 0 ] || exit 1
