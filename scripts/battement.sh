#!/bin/bash
#
# Le battement de coeur, et le second canal.
#
# CE QU'IL RÉPARE. Le 28 août 2026 la sauvegarde nocturne s'est arrêtée, la
# veille l'a détecté à chacun de ses 719 passages, et personne n'a été prévenu :
# le seul canal était `php -r 'mail()'` depuis un mutualisé, et sous cron
# /usr/bin/php est php-cgi, qui refuse -r. Ce qui a manqué n'est pas une
# détection, c'est une notification. Deux réponses, et il faut les deux :
#
#   1. UN SECOND CANAL qui ne partage aucune pièce avec le premier. Celui-ci est
#      du HTTP sortant en curl, sans php, sans MTA local, sans DNS de messagerie.
#      Si l'un des deux tombe, l'autre parle.
#   2. UN BATTEMENT, pour que LE SILENCE SOIT LUI-MÊME L'ALARME. Tout canal qui
#      part d'ici ne peut annoncer que ce qu'il a vu. Une machine éteinte, un
#      cron désarmé, un compte suspendu : il n'y a plus personne pour crier.
#      Alors on crie à intervalle connu, et c'est l'ABSENCE de cri que
#      quelqu'un d'autre surveille.
#
# LA LIMITE, ÉCRITE PLUTÔT QUE CONTOURNÉE. Ce script émet. Il ne surveille pas
# le silence, et il ne peut pas : `--verifier` lit un fichier posé sur la machine
# qui émet, donc il répond juste tant que la machine répond, c'est-à-dire dans
# le seul cas qui n'intéresse personne. Ce qui surveille l'absence doit être
# AILLEURS (un interrupteur d'homme mort chez un tiers, ou notre propre Worker
# Cloudflare, qui n'est pas sur le même serveur). Voir ACCES-REQUIS.md.
#
# L'URL EST UNE CAPACITÉ. Qui la détient peut écrire dans le canal d'alerte de
# la boutique. Elle vit donc hors du dépôt, en 600, et ce script :
#   - refuse si le fichier est absent, s'il n'appartient pas à l'utilisateur, ou
#     si un bit de groupe ou d'autrui est posé ;
#   - ne l'écrit dans aucun journal, aucune sortie, aucun message d'erreur ;
#   - ne la passe pas en ligne de commande à curl, parce que sur un mutualisé la
#     table des processus n'est pas privée : elle passe par la configuration de
#     curl, sur son entrée standard.
#
# USAGES
#   ./battement.sh                                   un battement, état inconnu
#   ./battement.sh --etat=ok --detail="8 contrôles"  un battement qui dit ce qu'il sait
#   ./battement.sh --canal=alerte --sujet="..."      une alerte, corps sur stdin
#   ./battement.sh --etat-canal                      ce qui est armé, sans rien envoyer
#   ./battement.sh --verifier [--max-min=30]         âge du dernier battement réussi ICI
#
# SORTIES
#   0  parti et accepté par le tiers (2xx)
#   1  parti et refusé, ou pas parti (réseau, délai, 4xx, 5xx)
#   2  rien n'a été tenté : canal non armé, configuration refusée, ou contrôle
#      impossible. CE N'EST PAS UN SUCCÈS.

set -uo pipefail

CONFIG_DIR="$HOME/.config/teeshoop"
ETAT_DIR="$HOME/.teeshoop-veille"
CANAL="battement"
ETAT="inconnu"
DETAIL=""
SUJET=""
MODE="envoyer"
MAX_MIN=30
DELAI=15

for a in "$@"; do
  case "$a" in
    --config=*)   CONFIG_DIR="${a#*=}" ;;
    --etat-dir=*) ETAT_DIR="${a#*=}" ;;
    --canal=*)    CANAL="${a#*=}" ;;
    --etat=*)     ETAT="${a#*=}" ;;
    --detail=*)   DETAIL="${a#*=}" ;;
    --sujet=*)    SUJET="${a#*=}" ;;
    --max-min=*)  MAX_MIN="${a#*=}" ;;
    --delai=*)    DELAI="${a#*=}" ;;
    --etat-canal) MODE="etat-canal" ;;
    --verifier)   MODE="verifier" ;;
    *) echo "battement: option inconnue $a" >&2; exit 2 ;;
  esac
done

case "$CANAL" in
  battement) FICHIER_URL="$CONFIG_DIR/battement-url" ;;
  alerte)    FICHIER_URL="$CONFIG_DIR/alerte-webhook" ;;
  *) echo "battement: --canal= vaut battement ou alerte, pas « $CANAL »." >&2; exit 2 ;;
esac

case ":$PATH:" in
  *":/usr/local/bin:"*) ;;
  *) PATH="/usr/local/bin:$PATH" ;;
esac
export PATH

# ── lire l'URL, ou refuser en disant pourquoi ───────────────────────────────
#
# Rend l'URL sur la sortie standard et 0, ou un motif sur la sortie d'erreur et
# 2. LE MOTIF NE CONTIENT JAMAIS L'URL, ni un morceau : un message d'erreur est
# la fuite la plus banale qui soit.
lire_url() {
  local f="$1" nom="${2:-$CANAL}" mode proprio moi url
  if [ ! -e "$f" ]; then
    echo "canal non armé : $f n'existe pas." >&2
    return 2
  fi
  if [ ! -f "$f" ]; then
    echo "refus : $f n'est pas un fichier ordinaire." >&2
    return 2
  fi
  mode=$(stat -Lc '%a' "$f" 2>/dev/null) || { echo "refus : les droits de $f ne se lisent pas." >&2; return 2; }
  # 600 est la consigne. 400 est accepté parce qu'il est strictement plus
  # fermé ; tout le reste est refusé, y compris 640, qui sur un mutualisé
  # signifie « lisible par le groupe du serveur web ».
  case "$mode" in
    600|400) ;;
    *) echo "refus : $f est en $mode, il doit être en 600 (chmod 600 \"$f\")." >&2; return 2 ;;
  esac
  proprio=$(stat -Lc '%U' "$f" 2>/dev/null)
  moi=$(id -un 2>/dev/null)
  if [ -n "$proprio" ] && [ -n "$moi" ] && [ "$proprio" != "$moi" ]; then
    echo "refus : $f appartient à $proprio et non à $moi." >&2
    return 2
  fi
  url=$(head -1 "$f" | tr -d '\r\n')
  if [ -z "$url" ]; then
    echo "refus : $f est vide." >&2
    return 2
  fi
  # Ni espace, ni guillemet, ni antislash : ces trois-là sortiraient de la
  # valeur dans le fichier de configuration de curl, et une valeur qui sort de
  # sa valeur est une option injectée.
  case "$url" in
    *[[:space:]]*|*'"'*|*'\'*) echo "refus : l'URL de $f contient un espace, un guillemet ou un antislash." >&2; return 2 ;;
  esac
  if [ "${#url}" -gt 2000 ]; then
    echo "refus : l'URL de $f dépasse 2000 caractères." >&2
    return 2
  fi
  case "$url" in
    https://*) ;;
    http://127.0.0.1|http://127.0.0.1/*|http://127.0.0.1:*|http://localhost|http://localhost/*|http://localhost:*)
      # Seule exception à https, et elle sert au harnais : la boucle locale ne
      # passe pas sur le réseau. En production ce n'est PAS un second canal,
      # puisqu'elle meurt avec la machine qu'elle devait dénoncer.
      echo "avertissement : le canal $nom vise la boucle locale, ce n'est pas un second canal." >&2 ;;
    *) echo "refus : l'URL de $f n'est pas en https." >&2; return 2 ;;
  esac
  printf '%s' "$url"
  return 0
}

# ── une chaîne JSON, sans php ───────────────────────────────────────────────
#
# Sans php, justement : le canal historique est tombé parce que php n'était pas
# celui qu'on croyait. Un second canal qui rappellerait le premier ne serait pas
# un second canal.
json_chaine() {
  printf '%s' "$1" \
    | tr -d '\000-\010\013\014\016-\037' \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\t/\\t/g' \
    | awk 'BEGIN { ORS = "" } NR > 1 { print "\\n" } { print }'
}

# ── poster ──────────────────────────────────────────────────────────────────
poster() {
  local url="$1" corps="$2" code sortie_curl
  command -v curl >/dev/null 2>&1 || { echo "battement: curl est introuvable." >&2; return 2; }
  # `-K -` : l'URL arrive par l'entrée standard et non par argv. `-s` sans `-S` :
  # les messages d'erreur de curl citent l'hôte, donc on n'en veut aucun ; le
  # code de sortie numérique dit ce qu'il faut savoir et ne fuit rien.
  code=$(printf 'url = "%s"\nheader = "Content-Type: application/json"\nheader = "User-Agent: teeshoop-battement"\ndata-binary = "@%s"\n' "$url" "$corps" \
    | curl -K - -s -o /dev/null --connect-timeout 5 -m "$DELAI" -w '%{http_code}' 2>/dev/null)
  sortie_curl=$?
  if [ "$sortie_curl" -ne 0 ]; then
    echo "battement: le canal $CANAL n'a pas répondu (curl $sortie_curl)." >&2
    return 1
  fi
  case "$code" in
    2*) return 0 ;;
    *)  echo "battement: le canal $CANAL a répondu HTTP $code." >&2; return 1 ;;
  esac
}

# ── ce qui est armé, sans rien envoyer ──────────────────────────────────────
if [ "$MODE" = "etat-canal" ]; then
  RIEN=0
  for c in battement alerte; do
    case "$c" in
      battement) f="$CONFIG_DIR/battement-url" ;;
      alerte)    f="$CONFIG_DIR/alerte-webhook" ;;
    esac
    if motif=$(lire_url "$f" "$c" 2>&1 >/dev/null); then
      echo "  $c : armé${motif:+ ($motif)}"
    else
      echo "  $c : $motif"
      RIEN=$((RIEN + 1))
    fi
  done
  if [ -f "$ETAT_DIR/battement-dernier" ]; then
    d=$(cat "$ETAT_DIR/battement-dernier" 2>/dev/null | tr -dc '0-9')
    if [ -n "$d" ]; then
      echo "  dernier battement accepté il y a $(( ( $(date +%s) - d ) / 60 )) min"
    fi
  else
    echo "  aucun battement n'a encore été accepté depuis cette machine"
  fi
  [ "$RIEN" -eq 2 ] && exit 2
  exit 0
fi

# ── l'âge du dernier battement, lu ici, avec la limite que cela implique ────
if [ "$MODE" = "verifier" ]; then
  echo "battement: ceci se lit sur la machine qui émet. Elle éteinte, personne ne le lit :"
  echo "           c'est un tiers qui doit surveiller le silence (ACCES-REQUIS.md)."
  F="$ETAT_DIR/battement-dernier"
  if [ ! -r "$F" ]; then
    echo "aucun battement accepté depuis cette machine (pas de $F)."
    exit 1
  fi
  D=$(tr -dc '0-9' < "$F")
  if [ -z "$D" ]; then
    echo "l'état du battement est illisible : $F ne contient pas d'horodatage."
    exit 2
  fi
  AGE_MIN=$(( ( $(date +%s) - D ) / 60 ))
  if [ "$AGE_MIN" -gt "$MAX_MIN" ]; then
    echo "dernier battement accepté il y a $AGE_MIN min, au-delà de $MAX_MIN min."
    exit 1
  fi
  echo "dernier battement accepté il y a $AGE_MIN min."
  exit 0
fi

# ── envoyer ─────────────────────────────────────────────────────────────────
URL=$(lire_url "$FICHIER_URL") || exit 2
[ -n "$URL" ] || exit 2

umask 077
CORPS=$(mktemp) || { echo "battement: pas de fichier temporaire." >&2; exit 2; }
trap 'rm -f "$CORPS"' EXIT

HORODATAGE="$(date -u '+%Y-%m-%d %H:%M:%S') UTC"
HOTE="$(hostname 2>/dev/null || echo inconnu)"

if [ "$CANAL" = "alerte" ]; then
  TEXTE=$(cat)
  [ -n "$SUJET" ] || SUJET="[Teeshoop] alerte"
  RESUME="$SUJET"$'\n'"$TEXTE"
else
  [ -n "$SUJET" ] || SUJET="[Teeshoop] battement"
  RESUME="Teeshoop est en vie. $HORODATAGE, $HOTE, état : $ETAT."
  [ -n "$DETAIL" ] && RESUME="$RESUME"$'\n'"$DETAIL"
fi

# `text` ET `content` portent la même phrase : `text` est ce que lisent Slack,
# Google Chat et la plupart des collecteurs, `content` est ce que lit Discord.
# Un seul corps qui va chez l'un ou chez l'autre, sans avoir à savoir lequel a
# été choisi. AUCUNE DONNÉE PERSONNELLE ICI : la veille ne compte que des
# nombres et des noms de fichiers, jamais une adresse ni une commande nommée.
{
  printf '{"source":"teeshoop","role":"%s","horodatage":"%s","hote":"%s","etat":"%s",' \
    "$(json_chaine "$CANAL")" "$(json_chaine "$HORODATAGE")" "$(json_chaine "$HOTE")" "$(json_chaine "$ETAT")"
  printf '"sujet":"%s","text":"%s","content":"%s"}' \
    "$(json_chaine "$SUJET")" "$(json_chaine "$RESUME")" "$(json_chaine "$RESUME")"
} > "$CORPS"

if poster "$URL" "$CORPS"; then
  if [ "$CANAL" = "battement" ]; then
    mkdir -p "$ETAT_DIR" 2>/dev/null
    date +%s > "$ETAT_DIR/battement-dernier" 2>/dev/null || true
  fi
  echo "battement: $CANAL accepté ($HORODATAGE)."
  exit 0
fi
exit 1
