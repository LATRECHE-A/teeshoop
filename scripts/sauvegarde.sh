#!/bin/bash
#
# Une sauvegarde de la boutique, sur o2switch, qui se restaure.
#
#   ./sauvegarde.sh [racine_wordpress] [destination] [nb_a_garder]
#   ./sauvegarde.sh ~/public_html ~/sauvegardes 7
#
# POURQUOI CE FICHIER EXISTE. Le compte o2switch n'a AUCUNE sauvegarde en
# libre-service : `uapi Backup list_backups` répond « Vous ne disposez pas de la
# fonctionnalité backup », il n'y a pas de client JetBackup côté utilisateur, et
# `~/backups` n'existe pas. Mesuré le 27/08/2026. o2switch prend ses propres
# sauvegardes serveur et son support peut restaurer, mais nous ne pouvons ni les
# déclencher, ni les vérifier, ni savoir ce qu'elles contiennent. Une sauvegarde
# qu'on ne peut pas ouvrir n'est pas une sauvegarde, c'est une espérance.
#
# CE QU'ELLE CONTIENT, et pourquoi chaque morceau :
#
#   base.sql.gz    la base. Les commandes, les clients, les factures et le
#                  compteur de numérotation. C'est le seul morceau irremplaçable.
#   uploads.tar.gz les fichiers téléversés. Reconstituables en théorie, pas en
#                  pratique : personne ne garde les originaux.
#   wp-config.php  les identifiants de base et les sels. Sans lui une restauration
#                  démarre mais déconnecte tout le monde.
#   MANIFESTE.txt  ce qu'il y avait dedans au moment où on l'a prise, et
#                  notamment LE NOMBRE DE COMMANDES, qui est ce qu'une
#                  restauration doit retrouver pour être crue.
#
# CE QU'ELLE NE CONTIENT PAS, dit ici plutôt que découvert un mauvais jour :
#
#   LE CODE. L'extension et le thème sont dans git, qui est une meilleure
#   sauvegarde que celle-ci. Les extensions tierces se réinstallent.
#   R2. Les créations des clients vivent chez Cloudflare et R2 n'a pas
#   d'instantané. Une commande dont l'artwork a disparu est une commande que
#   l'atelier ne peut pas imprimer, et rien ici ne la protège. Voir
#   docs/EXPLOITATION.md.
#   L'HORS-SITE. Ceci écrit sur le même disque que le site. Cela protège d'une
#   bêtise humaine et d'une mise à jour ratée, pas d'une perte du disque.
#
# Sortie : 0 sauvegarde complète et vérifiée, 1 sinon. Rien n'est jamais laissé
# à moitié écrit sous un nom définitif : le répertoire est monté sous un nom
# temporaire et renommé à la toute fin.

set -euo pipefail

WP_ROOT="${1:-$HOME/public_html}"
DEST="${2:-$HOME/sauvegardes}"
KEEP="${3:-7}"

# LE CHEMIN DE CRON N'EST PAS LE CHEMIN D'UN SHELL DE CONNEXION, et ce script a
# échoué cinq nuits de suite pour cette seule raison. Constaté le 02/09/2026 :
# ~/sauvegardes ne contenait qu'une sauvegarde du 28 août, prise à la main, et
# journal.log contenait cinq fois « sauvegarde: wp-cli est introuvable ».
#
# Mesuré sur le serveur :
#   env -i /bin/bash -c 'echo $PATH'                 -> /usr/local/bin:/usr/bin
#   env -i PATH=/usr/bin:/bin /bin/bash -c 'echo …'  -> /usr/bin:/bin
#
# cron impose son propre PATH avant d'appeler le shell, et bash ne le remplace
# pas par son défaut quand il est déjà défini. `wp` est dans /usr/local/bin, donc
# introuvable. Le `SHELL="/bin/bash"` du crontab ne change rien à cela.
#
# La ligne de cron porte maintenant un PATH explicite, ET ce script le complète,
# parce qu'une sauvegarde ne doit pas dépendre d'une ligne de crontab que
# personne ne relit. Le second est le durable : il voyage avec le fichier.
#
# `php` a exactement le même problème et il est plus vicieux : sous le PATH de
# cron, /usr/bin/php est le binaire **php-cgi**, qui refuse `-r` et imprime son
# mode d'emploi. Voir veille.sh, qui envoyait ses alertes par là.
case ":$PATH:" in
  *":/usr/local/bin:"*) ;;
  *) PATH="/usr/local/bin:$PATH" ;;
esac
export PATH

command -v wp >/dev/null || {
  echo "sauvegarde: wp-cli est introuvable. PATH=$PATH" >&2
  exit 1
}
[ -f "$WP_ROOT/wp-config.php" ] || { echo "sauvegarde: pas de wp-config.php sous $WP_ROOT" >&2; exit 1; }

STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
WORK="$DEST/.en-cours-$STAMP"
FINAL="$DEST/$STAMP"

mkdir -p "$DEST"
chmod 700 "$DEST"
mkdir -p "$WORK"

cleanup() {
  # Un échec ne laisse pas un répertoire à demi rempli portant un nom qui
  # ressemble à une sauvegarde valide.
  [ -d "$WORK" ] && rm -rf "$WORK"
}
trap cleanup EXIT

cd "$WP_ROOT"

echo "sauvegarde: base de données ..."
t0=$(date +%s)
# --single-transaction : pas de verrou sur InnoDB, donc la boutique continue de
# vendre pendant la copie. Sans lui, une sauvegarde de nuit bloque le paiement de
# quelqu'un.
wp db export - --single-transaction --quick --default-character-set=utf8mb4 \
  --skip-plugins --skip-themes 2>/dev/null | gzip -6 > "$WORK/base.sql.gz"
t1=$(date +%s)

# UNE SAUVEGARDE QUI NE SE TERMINE PAS N'EST PAS UNE SAUVEGARDE. mysqldump écrit
# une ligne finale et une copie interrompue ne l'a pas. C'est le seul contrôle qui
# distingue un fichier tronqué d'un fichier complet, et il coûte une décompression.
if ! gzip -dc "$WORK/base.sql.gz" | tail -5 | grep -q "Dump completed"; then
  echo "sauvegarde: le dump ne se termine pas par le marqueur de mysqldump, il est incomplet." >&2
  exit 1
fi
SQL_BYTES=$(gzip -dc "$WORK/base.sql.gz" | wc -c)
if [ "$SQL_BYTES" -lt 1000000 ]; then
  echo "sauvegarde: le dump ne fait que $SQL_BYTES octets, ce n'est pas cette base." >&2
  exit 1
fi

echo "sauvegarde: fichiers téléversés ..."
t2=$(date +%s)
# TAR SORT 1 QUAND UN FICHIER BOUGE PENDANT LA LECTURE, ce qui est la normale
# sur une boutique vivante et n'est pas une panne. Sous `set -e`, cette sortie 1
# arrêtait le script, et le `trap cleanup EXIT` effaçait alors le dump de base
# DÉJÀ VÉRIFIÉ trois lignes plus haut : une sauvegarde perdue pour un fichier de
# cache réécrit. 2 et au-delà sont de vraies erreurs et restent fatales.
tar --warning=no-file-changed \
    -C "$WP_ROOT/wp-content" -czf "$WORK/uploads.tar.gz" uploads || {
  rc=$?
  [ "$rc" -eq 1 ] || { echo "sauvegarde: tar a échoué (code $rc)." >&2; exit "$rc"; }
  echo "sauvegarde: des fichiers ont changé pendant la copie, l'archive reste exploitable."
}

# ET ELLE S'OUVRE. Accepter la sortie 1 de tar sans relire l'archive reviendrait
# à accepter une archive tronquée, ce qui est précisément le contrôle que le dump
# de base a et que celui-ci n'avait pas.
gzip -t "$WORK/uploads.tar.gz" || { echo "sauvegarde: l'archive des téléversements ne se décompresse pas." >&2; exit 1; }
t3=$(date +%s)

cp -p "$WP_ROOT/wp-config.php" "$WORK/wp-config.php"

echo "sauvegarde: manifeste ..."
PREFIX="$(wp db prefix --skip-plugins --skip-themes 2>/dev/null | tr -d '\n')"
ORDERS="$(wp db query "SELECT COUNT(*) FROM ${PREFIX}wc_orders" --skip-column-names --skip-plugins --skip-themes 2>/dev/null | tr -d '[:space:]' || echo 'n/a')"
{
  echo "Sauvegarde Teeshoop"
  echo "prise le          : $(date -u +'%Y-%m-%d %H:%M:%S') UTC"
  echo "hôte              : $(hostname)"
  echo "racine            : $WP_ROOT"
  echo "wordpress         : $(wp core version --skip-plugins --skip-themes 2>/dev/null)"
  echo "préfixe de tables : $PREFIX"
  echo "php               : $(php -r 'echo PHP_VERSION;' 2>/dev/null)"
  echo ""
  echo "CE QU'UNE RESTAURATION DOIT RETROUVER"
  echo "commandes         : $ORDERS"
  echo "sql décompressé   : $SQL_BYTES octets"
  echo ""
  echo "DURÉES"
  echo "base              : $((t1 - t0)) s"
  echo "uploads           : $((t3 - t2)) s"
  echo ""
  echo "EXTENSIONS ACTIVES"
  wp plugin list --status=active --field=name --skip-plugins --skip-themes 2>/dev/null | sed 's/^/  /'
  echo "THÈME"
  wp theme list --status=active --field=name --skip-plugins --skip-themes 2>/dev/null | sed 's/^/  /'
  echo ""
  echo "EMPREINTES (sha256)"
  ( cd "$WORK" && sha256sum base.sql.gz uploads.tar.gz wp-config.php )
} > "$WORK/MANIFESTE.txt"

chmod 600 "$WORK"/*
# Le répertoire aussi, pas seulement les fichiers : wp-config.php est dedans et
# ceci est un hébergement mutualisé.
chmod 700 "$WORK"
mv "$WORK" "$FINAL"
trap - EXIT

echo "sauvegarde: $FINAL"
du -sh "$FINAL" | sed 's/^/  /'

# ROTATION. Une sauvegarde qui remplit le disque met le site hors ligne, ce qui
# est une panne que la sauvegarde était censée éviter.
COUNT=$(find "$DEST" -maxdepth 1 -mindepth 1 -type d -name '20*' | wc -l)
if [ "$COUNT" -gt "$KEEP" ]; then
  find "$DEST" -maxdepth 1 -mindepth 1 -type d -name '20*' | sort | head -n "$((COUNT - KEEP))" | while read -r old; do
    echo "  rotation: suppression de $(basename "$old")"
    rm -rf "$old"
  done
fi

df -h "$DEST" | tail -1 | sed 's/^/  disque: /'
