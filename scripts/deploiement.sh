#!/bin/bash
#
# Le côté serveur du déploiement Teeshoop.
#
#   ./deploiement.sh <verbe> <environnement> [arguments]
#
# Il vit sur o2switch, dans ~, à côté de sauvegarde.sh et veille.sh, et il est la
# SEULE chose qu'une clé de déploiement peut lancer. La clé publique du dépôt
# GitHub est posée dans ~/.ssh/authorized_keys avec :
#
#   command="/home/dawe4500/deploiement.sh",restrict ssh-ed25519 AAAA… teeshoop-deploy
#
# `command=` veut dire que la commande demandée par le client est ignorée et que
# celle-ci est lancée à sa place, la demande d'origine étant passée dans
# SSH_ORIGINAL_COMMAND. `restrict` coupe le transfert d'agent, les redirections
# de ports, le pseudo-terminal et le reste. Une clé volée dans les secrets
# GitHub n'ouvre donc pas un shell sur le compte : elle ouvre exactement les
# huit verbes ci-dessous, sur deux répertoires connus.
#
# ── POURQUOI UN AIGUILLEUR ET PAS rrsync ─────────────────────────────────────
#
# `rrsync`, l'enveloppe restreinte livrée avec rsync, est l'outil fait pour ça et
# il N'EST PAS SUR CE SERVEUR : rsync 3.1.3 est installé, `rrsync` n'existe ni
# sur le PATH ni dans les emplacements habituels. Mesuré le 02/09/2026. Cet
# aiguilleur fait donc les deux moitiés du travail : il valide l'invocation
# rsync du client, et il expose les verbes WP-CLI que rrsync ne saurait de toute
# façon pas rendre.
#
# ── CE QU'IL NE FAIT JAMAIS ──────────────────────────────────────────────────
#
#   - il ne touche pas wp-content/uploads : ni copie, ni suppression, jamais ;
#   - il ne synchronise pas une installation WordPress entière, seulement notre
#     extension et notre thème ;
#   - il n'écrit rien hors de deux racines connues, listées dans `racine()` ;
#   - il ne supprime pas un produit, une commande ni un client. La purge de
#     démonstration est un autre script, et elle n'est pas appelable d'ici.
#
# ── LE DÉPLOIEMENT EST UN ÉCHANGE, PAS UNE ÉCRITURE EN PLACE ─────────────────
#
# rsync dépose dans ~/teeshoop-deploiements/<env>/entrant/. `installer` vérifie
# ce dépôt avec le PHP DU SERVEUR, met l'ancien de côté sous un horodatage, et
# renomme le nouveau à sa place. Un `rsync --delete` directement sur le
# répertoire servi laisse, pendant la durée du transfert, une extension dont
# la moitié des fichiers est de la version d'avant et l'autre de celle d'après,
# et un client peut arriver pendant ce temps. Deux `mv` sur le même système de
# fichiers, c'est deux renommages.
#
# `retour` refait l'échange dans l'autre sens et c'est ce qui rend un déploiement
# réversible sans toucher à la base. La procédure complète est docs/DEPLOIEMENT.md.
#
# Sortie : 0 tout va bien, 1 refus ou échec, 2 la demande elle-même est refusée.

set -euo pipefail

# Même piège que sauvegarde.sh et veille.sh : une session ssh non interactive
# n'a pas forcément /usr/local/bin, et wp-cli y vit.
case ":$PATH:" in
  *":/usr/local/bin:"*) ;;
  *) PATH="/usr/local/bin:$PATH" ;;
esac
export PATH

DEPOTS="$HOME/teeshoop-deploiements"
JOURNAL="$DEPOTS/journal.log"

# Les deux seules choses qu'on déploie, et leur destination sous wp-content.
COMPOSANTS="teeshoop-core:plugins/teeshoop-core teeshoop:themes/teeshoop"

journal() {
  mkdir -p "$DEPOTS"
  printf '%s  %s\n' "$(date -u '+%Y-%m-%d %H:%M:%S') UTC" "$*" >> "$JOURNAL"
}

refus() {
  echo "deploiement: $*" >&2
  journal "REFUS  $*"
  exit 2
}

echec() {
  echo "deploiement: $*" >&2
  journal "ECHEC  $*"
  exit 1
}

# ── Les deux environnements, et rien d'autre ────────────────────────────────
#
# En dur, et c'est voulu : un chemin qui arrive par la ligne de commande est un
# chemin qu'un client peut choisir, et cette clé n'a pas à pouvoir écrire où bon
# lui semble sur le compte.
racine() {
  case "$1" in
    preprod) echo "$HOME/myTiger-Preprod/4bde-26076daa9357.wptiger.fr" ;;
    prod)    echo "$HOME/public_html" ;;
    *)       return 1 ;;
  esac
}

verifier_env() {
  local env="$1" racine
  racine="$(racine "$env")" || refus "environnement inconnu « $env » (attendus : preprod, prod)"
  [ -f "$racine/wp-config.php" ] || refus "$racine ne contient pas de wp-config.php"
  echo "$racine"
}

# ── L'aiguilleur rsync ──────────────────────────────────────────────────────
#
# Le client lance :
#   rsync -a --delete --chmod=… src/ hote:teeshoop-deploiements/<env>/entrant/<composant>/
# ce qui arrive ici, dans SSH_ORIGINAL_COMMAND, sous la forme :
#   rsync --server -logDtpre.iLsfxC --delete . <destination>
#
# TOUT EST VÉRIFIÉ, PAS SEULEMENT LA DESTINATION. `--rsync-path` fait exécuter
# une commande arbitraire, `--files-from` lit un fichier arbitraire, `-e` ouvre
# un canal. Aucune de ces options n'a de raison d'apparaître dans une invocation
# serveur légitime, et la liste blanche ci-dessous n'en accepte aucune : ce qui
# n'est pas explicitement permis est refusé, jamais l'inverse.
aiguiller_rsync() {
  local -a mots
  read -r -a mots <<< "$SSH_ORIGINAL_COMMAND"

  [ "${mots[0]}" = "rsync" ] || refus "seul rsync est accepté ici, reçu « ${mots[0]} »"
  [ "${mots[1]}" = "--server" ] || refus "rsync doit être invoqué en mode serveur"

  local dest="${mots[${#mots[@]}-1]}"
  local i
  for (( i = 2; i < ${#mots[@]} - 1; i++ )); do
    case "${mots[$i]}" in
      --delete|--delete-during|--delete-delay|--delete-before|--delete-excluded) ;;
      # `--stats` et `--itemize-changes` ne changent que ce que rsync IMPRIME.
      # Elles sont ici parce qu'un opérateur qui veut savoir ce qui est parti ne
      # doit pas avoir à contourner ce garde-fou pour le savoir, et parce qu'un
      # garde-fou qu'on contourne pour travailler finit par être retiré.
      --stats|--itemize-changes) ;;
      --sender)  refus "cette clé ne sert qu'à recevoir, pas à envoyer" ;;
      .) ;;
      -*)
        case "${mots[$i]}" in
          --*) refus "option rsync refusée : ${mots[$i]}" ;;
        esac
        # ── LE PAQUET D'OPTIONS COURTES SE LIT LETTRE PAR LETTRE ──────────────
        #
        # Il était accepté en bloc dès qu'il ne commençait pas par deux tirets, et
        # une relecture adverse a montré que cela suffit à sortir des deux
        # répertoires entrants, en deux temps et avec la seule clé de déploiement :
        #
        #   1. un `rsync -a` parfaitement légitime dépose un lien symbolique
        #      `x -> ../../../../public_html/wp-content/uploads` (les liens
        #      passent : `-l` est dans `-a`) ;
        #   2. un second envoi vers la MÊME destination autorisée, avec `-K` et
        #      `--delete`, fait traiter ce lien comme un vrai répertoire. Un
        #      `x/` vide efface alors les 2 866 fichiers de wp-content/uploads,
        #      et un `x/` non vide écrit n'importe où sur le compte.
        #
        # C'est exactement ce que `rrsync` désactive (`short_disabled_subdir =
        # 'KLk'`) dès que la clé est confinée à un sous-répertoire, et c'est la
        # raison pour laquelle ce fichier ne pouvait pas se contenter de recopier
        # la moitié « destination » de son travail.
        #
        # `T` est refusé en plus : `-T/chemin` est la forme collée de
        # `--temp-dir`, mesurée acceptée elle aussi, et elle écrit hors de la
        # destination. `s` est le mode « protect-args » côté serveur.
        #
        # TOUT CE QUI SUIT UN `e` EST IGNORÉ : rsync y colle sa chaîne de
        # compatibilité (`e.iLsfxCIvu`), qui n'est pas une liste d'options. La
        # lire comme telle refuserait tous les transferts légitimes, à cause du
        # `L` qu'elle contient presque toujours.
        lettres="${mots[$i]#-}"
        j=0
        while [ "$j" -lt "${#lettres}" ]; do
          c="${lettres:$j:1}"
          [ "$c" = "e" ] && break
          case "$c" in
            K|L|k|T|s) refus "option rsync courte refusée : -$c (dans « ${mots[$i]} »). Elle permet d'écrire hors du répertoire de dépôt." ;;
          esac
          j=$(( j + 1 ))
        done
        ;;
      *) refus "argument rsync inattendu : ${mots[$i]}" ;;
    esac
  done

  # La destination doit être exactement un des dépôts entrants. Pas « commence
  # par » : un préfixe est satisfait par teeshoop-deploiements/preprod/entrant/../../../public_html.
  local ok=0 env composant chemin
  for env in preprod prod; do
    for composant in teeshoop-core teeshoop; do
      chemin="teeshoop-deploiements/$env/entrant/$composant/"
      [ "$dest" = "$chemin" ] && ok=1
    done
  done
  [ "$ok" -eq 1 ] || refus "destination refusée : « $dest »"

  case "$dest" in
    *..*) refus "destination contenant .." ;;
  esac

  mkdir -p "$HOME/$dest"
  # LES OPTIONS SONT JOURNALISÉES, PAS SEULEMENT LA DESTINATION. La ligne ne
  # disait que « RSYNC <destination> », donc une invocation hostile ne laissait
  # aucune trace de ce qu'elle avait demandé.
  journal "RSYNC  $dest  [${mots[*]:1:${#mots[@]}-3}]"
  # `--safe-links` en plus de la liste blanche ci-dessus : le receveur refuse
  # alors tout lien symbolique qui pointe hors de l'arborescence reçue. Notre
  # charge utile (une extension et un thème) n'en contient aucun, donc cela ne
  # coûte rien et cela ferme la première moitié de l'attaque en deux temps.
  exec rsync --safe-links "${mots[@]:1}"
}

# ── LE THÈME ACTIF ──────────────────────────────────────────────────────────
#
# Lu par `wp`, jamais déduit de la présence d'un répertoire : un répertoire de
# thème présent n'est pas un thème actif, et c'est précisément la confusion qui
# rendait `retour` dangereux.
theme_actif() {
  local racine="$1" nom
  nom="$( cd "$racine" && wp theme list --status=active --field=name 2>/dev/null | head -1 )"

  # UN NOM DE THÈME EST UN IDENTIFIANT, PAS UN PARAGRAPHE, ET CETTE LIGNE EST
  # UNE CORRECTION MESURÉE. Quand le thème déployé fatal au CHARGEMENT de
  # WordPress, WP-CLI ne démarre pas et écrit sa trace sur la sortie. Sans ce
  # contrôle, cette trace devenait la valeur de « thème actif » : la comparaison
  # « est-ce que teeshoop est actif » répondait non, la réactivation était
  # sautée, et le retour arrière retirait le répertoire du thème que la base
  # désigne encore. Autrement dit le pire cas, celui pour lequel ce bloc existe,
  # était exactement celui où il ne servait pas.
  #
  # « Je n'ai pas pu lire » rend une chaîne vide et un code non nul, et les
  # appelants ont à traiter ça comme un état à part, pas comme « aucun thème ».
  case "$nom" in
    ''|*[!A-Za-z0-9_.-]*) return 1 ;;
  esac
  printf '%s\n' "$nom"
}

# ── LA SONDE HTTP ───────────────────────────────────────────────────────────
#
# POURQUOI ELLE EXISTE. Le seul contrôle qui suivait un déploiement était un
# `wp eval` qui demandait sa version à l'extension. Il tourne sous le compte,
# avec la gestion d'erreurs de WP-CLI, et ne rend AUCUN thème : il passe pour
# une erreur fatale en façade, un gabarit cassé, une caisse blanche, ou un 500
# que seuls les visiteurs anonymes voient. Autrement dit il prouvait que le PHP
# se charge, pas que la boutique se visite.
#
# CE QU'ELLE FAIT DIFFÉREMMENT. Elle sort par le réseau et revient par le
# serveur web, sans cookie et sans session : c'est la requête d'un client. Les
# cinq URL sont celles sans lesquelles il n'y a pas de commerce : l'accueil,
# l'archive boutique, une fiche produit, le panier et le passage en caisse.
#
# ELLE SUIT LES REDIRECTIONS ET EXIGE 200 AU BOUT. Le brief dit « 200 ou 302 ».
# Une 302 est acceptable parce qu'un client la suit sans la voir ; ce qui n'est
# pas acceptable est une 302 vers une page morte, et s'arrêter au premier code
# ne sait pas faire la différence. Suivre puis exiger 200 accepte la première et
# refuse la seconde. Cinq sauts au maximum, pour qu'une boucle soit un échec et
# pas une attente.
#
# ELLE REGARDE AUSSI LE CORPS, et ce n'est pas de la ceinture et bretelles :
# WordPress rend « Il y a eu une erreur critique sur ce site » avec un code 200
# quand un greffon fatal est intercepté par la protection contre les erreurs
# fatales. Un contrôle qui ne lit que le statut appelle ça un succès.
#
# ELLE SAIT DIRE « JE N'AI PAS PU REGARDER ». Zéro URL construite est un échec,
# pas un succès silencieux : c'est la règle de CLAUDE.md section 5, et ce fichier
# la porte déjà pour `verifier` (« aucun fichier PHP analysé »).
sonde_http() {
  local racine="$1" etiquette="${2:-sonde}"
  local liste corps nom url code taille n=0 rouge=0 produits=-1

  command -v curl >/dev/null || { echo "$etiquette: curl est introuvable, la sonde ne peut pas regarder." >&2; return 1; }

  # LES URL SONT DEMANDÉES À LA BOUTIQUE, PAS ÉCRITES ICI. « /panier/ » et
  # « /passage-en-caisse/ » sont les slugs d'aujourd'hui ; un administrateur qui
  # renomme une page ne doit pas rendre la sonde aveugle en silence, et une
  # sonde qui vérifie une URL que WooCommerce n'utilise plus ne vérifie rien.
  liste="$( cd "$racine" && wp eval '
    $out = array();
    $out["accueil"] = home_url( "/" );
    if ( function_exists( "wc_get_page_permalink" ) ) {
      $out["boutique"] = wc_get_page_permalink( "shop" );
      $out["panier"]   = wc_get_page_permalink( "cart" );
      $out["caisse"]   = wc_get_page_permalink( "checkout" );
    }
    $n = (int) wp_count_posts( "product" )->publish;
    if ( $n > 0 ) {
      $p = get_posts( array( "post_type" => "product", "post_status" => "publish", "numberposts" => 1, "orderby" => "ID", "order" => "ASC" ) );
      if ( $p ) { $out["produit"] = get_permalink( $p[0]->ID ); }
    }
    echo "produits ", $n, PHP_EOL;
    foreach ( $out as $k => $v ) { if ( $v ) { echo $k, " ", $v, PHP_EOL; } }
  ' 2>/dev/null )" || true

  produits="$( printf '%s\n' "$liste" | awk '$1=="produits"{print $2; exit}' )"
  [ -n "$produits" ] || { echo "$etiquette: la boutique n'a pas répondu la liste de ses pages. Rien n'a été sondé." >&2; return 1; }

  # LES QUATRE PAGES SANS LESQUELLES IL N'Y A PAS DE COMMERCE SONT EXIGÉES.
  # Une fiche produit ne l'est QUE s'il existe un produit publié : le premier
  # déploiement précède l'import du catalogue, et exiger une fiche là refuserait
  # une boutique parfaitement saine. Mais dès qu'un produit est publié, son
  # absence de la liste est une panne, pas une boutique vide.
  local attendu=4
  [ "$produits" -gt 0 ] && attendu=5
  n="$( printf '%s\n' "$liste" | grep -cv '^produits ' || true )"
  if [ "$n" -lt "$attendu" ]; then
    echo "$etiquette: $n URL construites, $attendu attendues. Une page WooCommerce n'est pas configurée, ou une fiche produit n'a pas de permalien." >&2
    printf '%s\n' "$liste" >&2
    return 1
  fi

  corps="$(mktemp)"
  while read -r nom url; do
    [ "$nom" = "produits" ] && continue
    [ -n "$url" ] || continue
    code="$( curl -sS -L --max-redirs 5 --max-time 25 -o "$corps" \
      -A 'teeshoop-deploiement (sonde anonyme)' \
      -w '%{http_code}' "$url" 2>/dev/null )" || code="000"
    taille="$( wc -c < "$corps" | tr -d ' ' )"

    if [ "$code" != "200" ]; then
      echo "$etiquette: ROUGE  $nom  $code  $url" >&2
      rouge=$(( rouge + 1 ))
    elif grep -qE 'erreur critique sur ce site|critical error on this website' "$corps"; then
      # 200 AVEC UNE ERREUR FATALE DANS LE CORPS. C'est le cas exact que la
      # sonde `wp eval` ne peut pas voir, parce qu'elle ne rend pas de page.
      echo "$etiquette: ROUGE  $nom  200 mais WordPress affiche une erreur critique  $url" >&2
      rouge=$(( rouge + 1 ))
    elif [ "$taille" -lt 512 ]; then
      # UNE PAGE DE 200 OCTETS N'EST PAS UNE PAGE. Une caisse blanche rend un
      # squelette vide avec un code 200 ; 512 octets est en dessous de tout
      # gabarit WordPress réel et au dessus de toute page vide.
      echo "$etiquette: ROUGE  $nom  200 mais $taille octets seulement  $url" >&2
      rouge=$(( rouge + 1 ))
    else
      echo "$etiquette: vert   $nom  200  $taille o"
    fi
  done <<EOF
$liste
EOF
  rm -f "$corps"

  [ "$rouge" -eq 0 ] || { echo "$etiquette: $rouge page(s) sur $n ne se visitent pas." >&2; return 1; }
  echo "$etiquette: $n pages visitées anonymement, toutes en 200."
}

# ── Les verbes ──────────────────────────────────────────────────────────────

verbe_etat() {
  local env="$1" racine
  racine="$(verifier_env "$env")"
  cd "$racine"
  echo "environnement     : $env"
  echo "racine            : $racine"
  echo "wordpress         : $(wp core version 2>/dev/null || echo '?')"
  echo "woocommerce       : $(wp plugin get woocommerce --field=version 2>/dev/null || echo 'absente')"
  echo "php               : $(php -r 'echo PHP_VERSION;')"
  echo "teeshoop-core     : $(wp plugin get teeshoop-core --field=status 2>/dev/null || echo 'non déployée')"
  echo "version extension : $(wp plugin get teeshoop-core --field=version 2>/dev/null || echo '-')"
  echo "schéma            : $(wp teeshoop migrer --etat --porcelaine 2>/dev/null || echo '-')"
  echo "thème actif       : $(wp theme list --status=active --field=name 2>/dev/null || echo '?')"
  echo "produits publiés  : $(wp post list --post_type=product --post_status=publish --format=count 2>/dev/null || echo '?')"
  echo "commandes         : $(wp db query "SELECT COUNT(*) FROM $(wp db prefix 2>/dev/null | tr -d '\n')wc_orders" --skip-column-names 2>/dev/null || echo '?')"
  echo "livraisons        : $(ls -1 "$DEPOTS/$env/versions" 2>/dev/null | wc -l)"
}

# Le contrôle qui ne peut se faire QUE sur le serveur : le PHP réel.
#
# L'intégration continue lint sur php:8.1-cli et fait tourner la suite dessus,
# ce qui couvre la VERSION. Elle ne couvre pas ce binaire-ci, avec ses extensions
# et son ini. Un fichier qui ne s'analyse pas ici est une page blanche, et il ne
# faut surtout pas l'installer pour s'en apercevoir.
verbe_verifier() {
  local env="$1" composant chemin liste f n=0
  verifier_env "$env" > /dev/null

  # PAS DE SUBSTITUTION DE PROCESSUS ICI. `while … done < <(find …)` a échoué sur
  # ce serveur avec « /dev/fd/62: No such file or directory » : l'environnement de
  # la commande forcée n'a pas /dev/fd, ce qui est courant sous CageFS. Le contrôle
  # a alors refusé en disant « aucun fichier PHP analysé », ce qui est exactement
  # le bon comportement (« rien regardé » n'est pas « rien trouvé ») et n'est pas
  # une raison de le laisser cassé. Un fichier temporaire marche partout, et la
  # boucle reste dans le shell courant, donc le compteur compte vraiment.
  liste="$(mktemp)"
  # shellcheck disable=SC2064
  trap "rm -f '$liste'" RETURN

  for composant in teeshoop-core teeshoop; do
    chemin="$DEPOTS/$env/entrant/$composant"
    [ -d "$chemin" ] || refus "rien n'a été déposé pour $composant"
    find "$chemin" -name '*.php' -print0 > "$liste"
    while IFS= read -r -d '' f; do
      php -l "$f" > /dev/null || echec "$composant : $f ne s'analyse pas avec le PHP du serveur"
      n=$(( n + 1 ))
    done < "$liste"
  done

  [ "$n" -gt 0 ] || refus "aucun fichier PHP analysé : le contrôle n'a rien regardé"
  echo "deploiement: $n fichiers PHP analysés avec $(php -r 'echo PHP_VERSION;'), aucun refus."
}

verbe_installer() {
  local env="$1" racine horodatage composant sous_wp source cible versions theme_avant
  racine="$(verifier_env "$env")"
  horodatage="$(date -u +%Y-%m-%dT%H%M%SZ)"
  versions="$DEPOTS/$env/versions/$horodatage"

  verbe_verifier "$env"

  mkdir -p "$versions"

  # LE THÈME ACTIF EST NOTÉ, ET SON ABSENCE ARRÊTE LE DÉPLOIEMENT.
  #
  # Sans cette ligne, un retour arrière ne sait pas vers quoi revenir, et c'est
  # exactement ce qui manquait : `retour` déplaçait le répertoire du thème sans
  # jamais rendre à WordPress un thème valide. Le déduire après coup est
  # impossible (le répertoire précédent est là, mais rien ne dit qu'il était
  # actif), donc il se note maintenant ou jamais. « Je n'ai pas pu lire » n'est
  # pas « il n'y en a pas » : on refuse plutôt que d'installer une livraison
  # qu'on ne saurait pas annuler.
  theme_avant="$(theme_actif "$racine")"
  [ -n "$theme_avant" ] || echec "impossible de lire le thème actif de $env : une livraison qu'on ne sait pas annuler ne s'installe pas."
  printf '%s\n' "$theme_avant" > "$versions/THEME-PRECEDENT.txt"
  journal "THEME  $env actif avant $horodatage : $theme_avant"
  for entree in $COMPOSANTS; do
    composant="${entree%%:*}"
    sous_wp="${entree#*:}"
    source="$DEPOTS/$env/entrant/$composant"
    cible="$racine/wp-content/$sous_wp"

    [ -d "$source" ] || refus "rien à installer pour $composant"

    # LES DROITS AVANT L'ÉCHANGE, pas après : un rsync qui laisse des fichiers
    # illisibles par le serveur web met le site par terre, et sur cet hébergement
    # le serveur web tourne sous le compte lui-même (lsphp/dawe4500), donc
    # 644/755 est exactement ce qu'il faut et rien de plus.
    find "$source" -type d -exec chmod 755 {} +
    find "$source" -type f -exec chmod 644 {} +

    # CE QUI EXISTAIT AVANT EST NOTÉ, pas déduit de la présence d'un répertoire.
    # Sans cette liste, un retour arrière après un PREMIER déploiement raté ne
    # trouve rien à remettre pour le composant, ne fait rien, et laisse en place
    # exactement l'extension qui vient de refuser de s'activer.
    if [ -d "$cible" ]; then
      mv "$cible" "$versions/$composant"
      echo "$composant" >> "$versions/PRECEDENT.txt"
    fi
    mv "$source" "$cible"
    journal "INSTALL $env $composant -> $cible (ancien dans $versions)"
  done

  cd "$racine"

  # ACTIVER PUIS MIGRER, dans cet ordre : la migration a besoin que l'extension
  # soit chargée. `wp plugin activate` sur une extension déjà active ne fait rien
  # et rend 0, donc c'est idempotent.
  wp plugin activate teeshoop-core || {
    echo "deploiement: l'extension refuse de s'activer, retour arrière." >&2
    verbe_retour "$env" "$horodatage"
    echec "activation refusée"
  }
  wp teeshoop migrer || {
    echo "deploiement: la migration a échoué, retour arrière." >&2
    verbe_retour "$env" "$horodatage"
    echec "migration refusée"
  }

  # LA SONDE. Charger WordPress et demander à l'extension de se nommer prouve
  # qu'elle ne fatal pas, ce qu'aucun lint ne peut dire.
  wp eval 'echo "SONDE ", \Teeshoop\Core\VERSION, " schema=", \Teeshoop\Core\Schema::current(), "/", \Teeshoop\Core\Schema::target(), PHP_EOL;' || {
    echo "deploiement: l'extension ne répond pas une fois chargée, retour arrière." >&2
    verbe_retour "$env" "$horodatage"
    echec "sonde refusée"
  }

  # LE THÈME EST ACTIVÉ À L'ALLER, ET C'EST IDEMPOTENT.
  #
  # `wp theme activate` sur un thème déjà actif ne fait rien et rend 0. Déployer
  # le thème sans jamais l'activer laissait la boutique sous un autre thème avec
  # le nôtre installé à côté, c'est-à-dire un déploiement dont on ne voit pas le
  # résultat. C'est aussi ce qui rendait la moitié « retour » du problème
  # invisible : on ne casse pas ce qu'on n'a jamais allumé.
  if [ -d "$racine/wp-content/themes/teeshoop" ]; then
    wp theme activate teeshoop || {
      echo "deploiement: le thème refuse de s'activer, retour arrière." >&2
      verbe_retour "$env" "$horodatage"
      echec "activation du thème refusée"
    }
  fi

  # LA SONDE HTTP, ET ELLE DÉCLENCHE LE RETOUR ARRIÈRE.
  #
  # Tout ce qui précède tourne sous le compte. C'est la première ligne de ce
  # fichier qui demande à la boutique ce qu'un client verrait.
  if ! sonde_http "$racine" "sonde"; then
    echo "deploiement: la boutique ne se visite pas, retour arrière." >&2
    journal "SONDE  $env $horodatage ROUGE, retour arrière"
    verbe_retour "$env" "$horodatage"
    # ET ON REVÉRIFIE APRÈS LE RETOUR. Un retour arrière qui ne remet pas la
    # boutique debout est une panne différente et plus grave que celle qu'on
    # vient d'annuler : il faut qu'elle soit dite, pas supposée.
    if sonde_http "$racine" "sonde après retour"; then
      echec "la boutique ne se visitait pas ; la livraison précédente est remise et elle, se visite."
    fi
    echec "la boutique ne se visite pas ET LE RETOUR ARRIÈRE NE L'A PAS REMISE DEBOUT. Intervention manuelle nécessaire : « versions $env » liste les livraisons, « retour $env <horodatage> » en remet une."
  fi

  echo "deploiement: $env installé, version $horodatage."
  journal "OK     $env $horodatage"
}

# Remettre la livraison précédente. Sans argument, la plus récente mise de côté.
verbe_retour() {
  local env="$1" horodatage="${2:-}" theme_force="${3:-}"
  local racine versions composant sous_wp cible avait
  local theme_avant theme_maintenant theme_retire theme_vise agi=0
  racine="$(verifier_env "$env")"
  if [ -z "$horodatage" ]; then
    horodatage="$(ls -1 "$DEPOTS/$env/versions" 2>/dev/null | sort | tail -1)"
  fi
  [ -n "$horodatage" ] || echec "aucune livraison précédente à remettre pour $env"

  # L'HORODATAGE ARRIVE PAR LA LIGNE DE COMMANDE ET FINIT DANS UN CHEMIN. Il est
  # donc comparé à sa forme exacte et pas seulement utilisé : « ../../.. » est un
  # horodatage parfaitement acceptable pour `ls`, et ce n'en est pas un.
  [[ "$horodatage" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z$ ]] \
    || refus "horodatage de livraison mal formé : « $horodatage »"

  versions="$DEPOTS/$env/versions/$horodatage"
  [ -d "$versions" ] || echec "la livraison $horodatage n'existe pas"

  # ── LE THÈME EST RENDU À WORDPRESS AVANT QUE QUOI QUE CE SOIT NE BOUGE ─────
  #
  # LE DÉFAUT QUE CE BLOC FERME. `retour` déplaçait le répertoire du thème sans
  # jamais changer le thème actif, et `installer` ne l'activait pas davantage.
  # C'était sans conséquence tant que la production tournait sous un autre
  # thème : on déplaçait un répertoire que personne ne chargeait. À la seconde
  # où la boutique passe sous `teeshoop`, cette commande, celle qu'on tape un
  # vendredi soir quand le site est cassé, devient celle qui retire sous les
  # pieds de WordPress le thème qu'il est en train de charger. La boutique rend
  # alors une page d'erreur de thème absent, et la procédure d'urgence est
  # devenue la panne.
  #
  # L'ORDRE EST LA CORRECTION : activer d'abord, déplacer ensuite. L'inverse
  # laisse une fenêtre, courte mais réelle, où un client arrive sur un thème qui
  # n'est plus là.
  theme_maintenant="$(theme_actif "$racine" || true)"
  theme_avant="$( head -1 "$versions/THEME-PRECEDENT.txt" 2>/dev/null || true )"

  # CE RETOUR VA-T-IL RETIRER LE RÉPERTOIRE DU THÈME, ou le remplacer ? Les deux
  # cas ne demandent pas la même chose. `PRECEDENT.txt` liste les composants qui
  # existaient AVANT la livraison : s'il y nomme le thème, le retour remet
  # l'ancien répertoire à la place du nouveau et il reste un thème valide ; s'il
  # ne le nomme pas, la livraison était un premier déploiement et annuler veut
  # dire retirer.
  theme_retire=0
  grep -qxF "teeshoop" "$versions/PRECEDENT.txt" 2>/dev/null || theme_retire=1

  if [ "$theme_maintenant" = "teeshoop" ] && [ "$theme_retire" -eq 1 ]; then
    theme_vise="$theme_force"
    if [ -z "$theme_vise" ] && [ -n "$theme_avant" ] && [ "$theme_avant" != "teeshoop" ]; then
      theme_vise="$theme_avant"
    fi
    # ON NE DEVINE PAS UN THÈME. Choisir « le premier autre thème installé »
    # remettrait la boutique en ligne sous une apparence que personne n'a
    # choisie, ce qui est une autre façon de casser le site. La livraison note
    # le thème actif depuis aujourd'hui, donc ce refus ne se produit que sur une
    # livraison antérieure à ce fichier, et il dit exactement quoi taper.
    if [ -z "$theme_vise" ]; then
      echo "deploiement: ce retour retirerait le thème « teeshoop », qui est le thème ACTIF, et la livraison $horodatage ne dit pas lequel était actif avant." >&2
      echo "  Rien n'a été touché. Thèmes installés :" >&2
      ( cd "$racine" && wp theme list --field=name 2>/dev/null | sed 's/^/    /' ) >&2 || true
      echec "relancez avec le thème à remettre : « retour $env $horodatage <thème> »"
    fi
    [ -d "$racine/wp-content/themes/$theme_vise" ] \
      || echec "le thème « $theme_vise » n'est pas installé dans $racine/wp-content/themes. Rien n'a été touché."
    ( cd "$racine" && wp theme activate "$theme_vise" ) \
      || echec "« $theme_vise » refuse de s'activer. Rien n'a été touché : déplacer le thème maintenant laisserait la boutique sans thème du tout."
    journal "THEME  $env réactivé $theme_vise avant retour $horodatage"
    theme_maintenant="$(theme_actif "$racine" || true)"
  fi

  # SI ON N'A PAS PU LIRE LE THÈME ACTIF, ON RETIENT VERS QUOI REVENIR QUAND
  # MÊME. Le cas se produit précisément quand le thème livré fatal au chargement
  # de WordPress : WP-CLI ne démarre pas, donc on ne peut ni lire ni activer
  # avant de déplacer. Le déplacement, lui, va guérir le chargement, et la
  # seconde passe plus bas fera l'activation. Ce qu'il ne faut surtout pas
  # faire est de continuer comme si le thème actif n'était pas le nôtre.
  if [ -z "$theme_maintenant" ] && [ -z "${theme_vise:-}" ]; then
    theme_vise="$theme_force"
    [ -n "$theme_vise" ] || theme_vise="$theme_avant"
  fi

  for entree in $COMPOSANTS; do
    composant="${entree%%:*}"
    sous_wp="${entree#*:}"
    cible="$racine/wp-content/$sous_wp"
    avait=0
    grep -qxF "$composant" "$versions/PRECEDENT.txt" 2>/dev/null && avait=1

    # QUATRE CAS, ÉCRITS UN PAR UN, ET LE TROISIÈME EST UN DÉFAUT QUI A ÉTÉ
    # TROUVÉ PAR UNE RELECTURE ADVERSE AVANT D'ÊTRE LIVRÉ.
    #
    # Ce bloc était un `if / elif [ -d "$cible" ]`, et il retirait l'extension dès
    # que la copie de sauvegarde était absente, quelle qu'en soit la raison. Or
    # elle est absente juste après un retour arrière réussi : elle a été remise en
    # place. Donc un SECOND `retour`, sur la même livraison, supprimait
    # l'extension et le thème de la boutique et sortait 0 en annonçant « ramené ».
    # C'est la commande qu'on tape quand on ne sait plus où on en est, un soir de
    # panne, et elle était la plus dangereuse du fichier.
    if [ "$avait" -eq 1 ] && [ -d "$versions/$composant" ]; then
      # 1. Il y avait quelque chose avant, et on l'a encore : on le remet.
      rm -rf "$cible.a-jeter"
      [ -d "$cible" ] && mv "$cible" "$cible.a-jeter"
      mv "$versions/$composant" "$cible"
      rm -rf "$cible.a-jeter"
      agi=$(( agi + 1 ))
      journal "RETOUR $env $composant <- $horodatage"
    elif [ "$avait" -eq 1 ]; then
      # 2. Il y avait quelque chose avant et on ne l'a plus : cette livraison a
      #    DÉJÀ été annulée. Ne rien toucher, et le dire.
      echec "la livraison $horodatage a déjà été annulée pour $composant : la copie de sauvegarde n'est plus là. Rien n'a été touché. Choisissez une autre livraison (« versions $env »)."
    elif [ -d "$cible" ]; then
      # 3. Il n'y avait RIEN avant (premier déploiement) : annuler, c'est retirer.
      #    L'extension se désactive d'abord, sinon WordPress garde son nom dans
      #    `active_plugins` et se plaint à chaque page d'un fichier absent.
      if [ "$composant" = "teeshoop-core" ]; then
        ( cd "$racine" && wp plugin deactivate teeshoop-core 2>/dev/null ) || true
      fi
      # ON NE RETIRE JAMAIS LE RÉPERTOIRE DU THÈME ACTIF. Le bloc du dessus a
      # normalement déjà rendu la main à un autre thème ; ce refus est là pour
      # le cas où il ne l'aurait pas fait, parce que la conséquence est un site
      # sans thème et qu'aucune trace n'en resterait dans le journal.
      if [ "$composant" = "teeshoop" ] && [ "$theme_maintenant" = "teeshoop" ]; then
        echec "refus de retirer wp-content/$sous_wp : « teeshoop » est le thème ACTIF de $env. Activez un autre thème d'abord, ou relancez « retour $env $horodatage <thème> »."
      fi
      rm -rf "$versions/$composant.retire"
      mv "$cible" "$versions/$composant.retire"
      agi=$(( agi + 1 ))
      journal "RETOUR $env $composant retiré (rien à remettre)"
    else
      # 4. Rien avant, rien maintenant : il n'y a rien à faire et ce n'est pas
      #    une erreur.
      echo "deploiement: $composant n'est pas installé, rien à annuler."
    fi
  done
  # ── SECONDE PASSE SUR LE THÈME, UNE FOIS LES RÉPERTOIRES REVENUS ──────────
  #
  # La première passe ne peut rien faire quand WordPress ne se charge pas du
  # tout : c'est le thème cassé lui-même qui empêche `wp` de démarrer. Le
  # déplacement le retire, donc WordPress se charge de nouveau, donc ici on peut
  # enfin poser la question et corriger. On regarde le RÉPERTOIRE et pas
  # seulement le nom : un thème actif dont le répertoire n'existe plus est
  # exactement la panne que tout ce bloc existe pour empêcher.
  theme_maintenant="$(theme_actif "$racine" || true)"
  if [ -z "$theme_maintenant" ] || [ ! -d "$racine/wp-content/themes/$theme_maintenant" ]; then
    theme_vise="${theme_vise:-}"
    [ -n "$theme_vise" ] || theme_vise="$theme_force"
    [ -n "$theme_vise" ] || theme_vise="$theme_avant"
    if [ -n "$theme_vise" ] && [ -d "$racine/wp-content/themes/$theme_vise" ]; then
      ( cd "$racine" && wp theme activate "$theme_vise" ) \
        && journal "THEME  $env réactivé $theme_vise après retour $horodatage" \
        || echo "deploiement: « $theme_vise » n'a pas pu être activé après le retour." >&2
    else
      echo "deploiement: ATTENTION, le thème actif de $env n'a pas de répertoire et aucun thème de repli n'est connu. La boutique ne rendra pas de page." >&2
      journal "ALERTE $env thème actif sans répertoire après retour $horodatage"
    fi
  fi

  # UN RETOUR QUI N'A RIEN FAIT NE DIT PAS « RAMENÉ », ET NE SORT PAS 0.
  #
  # Seconde moitié du défaut du `retour` répété. La première (il SUPPRIMAIT
  # l'extension au second passage) est fermée par les quatre cas ci-dessus. La
  # seconde restait ouverte et se voit sur un premier déploiement annulé : le
  # second `retour` tombe dans le cas 4 pour les deux composants, ne touche
  # rien, imprime « prod ramené à la livraison ... » et sort 0. C'est la
  # commande qu'on tape un soir de panne quand on ne sait plus où on en est, et
  # elle répondait « c'est fait » à quelqu'un pour qui ce n'était pas fait.
  if [ "$agi" -eq 0 ]; then
    echec "la livraison $horodatage a déjà été annulée : aucun composant à remettre ni à retirer. Rien n'a été touché. « versions $env » liste les livraisons disponibles."
  fi

  echo "deploiement: $env ramené à la livraison $horodatage ($agi composant(s))."
  journal "RETOUR $env terminé <- $horodatage (thème actif : $(theme_actif "$racine" || echo '?'))"

  # ET ON REGARDE. Un retour arrière qui rend 0 sans que personne n'ait visité
  # la boutique dit seulement que des répertoires ont bougé. Cette sonde est
  # informative ici, pas bloquante : quand `installer` l'appelle, c'est lui qui
  # décide quoi faire du résultat, et un opérateur qui lance `retour` à la main
  # a besoin de la réponse, pas d'un second échec.
  sonde_http "$racine" "sonde après retour" || true
}

verbe_sauvegarder() {
  local env="$1" racine
  racine="$(verifier_env "$env")"
  "$HOME/sauvegarde.sh" "$racine" "$HOME/sauvegardes-$env" 10
}

verbe_verdict() {
  local env="$1" racine
  racine="$(verifier_env "$env")"
  cd "$racine"
  wp teeshoop lancement --porcelaine
}

verbe_versions() {
  local env="$1"
  verifier_env "$env" > /dev/null
  ls -1 "$DEPOTS/$env/versions" 2>/dev/null | sort || true
}

# ── Point d'entrée ──────────────────────────────────────────────────────────

# Sous `command=`, la demande du client est dans SSH_ORIGINAL_COMMAND et les
# arguments de cette ligne-ci sont vides. En invocation directe (à la main sur le
# serveur), c'est l'inverse.
if [ -n "${SSH_ORIGINAL_COMMAND:-}" ]; then
  case "$SSH_ORIGINAL_COMMAND" in
    rsync\ *) aiguiller_rsync ;;
  esac
  # shellcheck disable=SC2086
  set -- $SSH_ORIGINAL_COMMAND
  # LA MÊME COMMANDE DOIT MARCHER AVEC LES DEUX CLÉS. Avec la clé de déploiement,
  # `ssh teeshoop-deploy 'etat preprod'` arrive tel quel parce que `command=`
  # remplace la commande. Avec la clé du développeur il n'y a pas de `command=`,
  # donc il faut écrire `ssh teeshoop './deploiement.sh etat preprod'`, et ce
  # préfixe se retrouvait alors ici comme un verbe inconnu. Deux invocations
  # différentes selon la clé, c'est une procédure que personne ne retient : le
  # préfixe est retiré et la même ligne marche des deux côtés.
  case "${1:-}" in
    ./deploiement.sh|deploiement.sh|"$HOME/deploiement.sh") shift ;;
  esac
fi

VERBE="${1:-}"
ENV="${2:-}"
shift 2 2>/dev/null || true

case "$VERBE" in
  etat)        verbe_etat "$ENV" ;;
  verifier)    verbe_verifier "$ENV" ;;
  installer)   verbe_installer "$ENV" ;;
  retour)      verbe_retour "$ENV" "${1:-}" "${2:-}" ;;
  sauvegarder) verbe_sauvegarder "$ENV" ;;
  verdict)     verbe_verdict "$ENV" ;;
  versions)    verbe_versions "$ENV" ;;
  *)           refus "verbe inconnu « $VERBE » (attendus : etat, verifier, installer, retour, sauvegarder, verdict, versions)" ;;
esac
