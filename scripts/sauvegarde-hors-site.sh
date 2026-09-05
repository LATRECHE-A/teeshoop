#!/bin/bash
#
# La copie hors du disque de la boutique. Chiffrée avant de partir, découpée,
# poussée dans R2, puis RELUE pour vérifier qu'elle y est vraiment.
#
#   ./sauvegarde-hors-site.sh <repertoire_de_sauvegarde> [nb_a_garder]
#   ./sauvegarde-hors-site.sh --restaurer <horodatage> <repertoire_destination>
#   ./sauvegarde-hors-site.sh --lister
#
# POURQUOI CE FICHIER EXISTE. `sauvegarde.sh` écrit dans `~/sauvegardes`, sur le
# MÊME DISQUE que la boutique. Cela protège d'une bêtise humaine et d'une mise à
# jour ratée ; cela ne protège de rien du tout le jour où le disque part, et ce
# jour-là on perd la boutique ET sa seule copie. o2switch ne donne à ce compte
# aucune sauvegarde en libre-service (mesuré le 27/08/2026), donc il n'y a pas
# de filet en dessous.
#
# POURQUOI R2 ET PAS UN AUTRE SERVEUR. Cloudflare est déjà notre fournisseur,
# donc pas de contrat de plus, pas de machine de plus à maintenir en vie, et
# surtout un domaine de panne qui n'est pas celui d'o2switch. Le transport est
# l'API REST de Cloudflare, pas l'API S3 : elle prend un jeton en en-tête
# `Authorization`, donc `curl` suffit et il n'y a pas de signature SigV4 à
# écrire à la main. C'est décisif ici : IL N'Y A NI node NI npm SUR LE SERVEUR
# (mesuré le 14/08/2026), et le php du PATH de cron est php-cgi.
#
# POURQUOI C'EST CHIFFRÉ. `base.sql.gz` contient les commandes, les noms, les
# adresses et les courriels de tous les clients. Une erreur de configuration sur
# un seau, ou un jeton qui fuit, ne doit pas valoir la base clients. Le chiffre
# est fait ICI, avant le départ, avec une phrase de passe qui ne quitte jamais
# la machine. Ce qu'il protège : la copie au repos chez Cloudflare. Ce qu'il ne
# protège pas : une compromission de ce serveur-ci, où la clé se trouve aussi.
#
# PERDRE LA PHRASE DE PASSE, C'EST PERDRE LA SAUVEGARDE. Elle est dans
# ~/.config/teeshoop/sauvegarde.cle et sa copie va dans le gestionnaire de mots
# de passe, pas ailleurs.
#
# POURQUOI DÉCOUPÉ. Un envoi en une seule requête a un plafond que nous ne
# maîtrisons pas et que l'API ne documente pas ; `uploads.tar.gz` pèse 287 Mo.
# 64 Mio par objet, mesuré comme passant, retire l'inconnue et rend chaque
# morceau vérifiable séparément.
#
# CE QU'IL ÉCRIT DANS LE SEAU :
#   boutique/<horodatage>/<fichier>.chiffre.aa , .ab , …   les morceaux
#   boutique/<horodatage>/INVENTAIRE.json                  ce qu'il y a, en clair
#
# L'inventaire est au format `teeshoop-inventaire-1`, le même que celui du
# coffre des créations, pour qu'un SEUL vérificateur les relise tous les deux :
#   node scripts/sauvegarde-r2.mjs comparer <repertoire> teeshoop-sauvegardes
# Le vérificateur ne partage pas une ligne de code avec ce script. Relire un
# écrivain avec son propre lecteur ne prouve que sa cohérence avec lui-même.
#
# Sorties : 0 la copie est en place et relue, 1 elle ne l'est pas.

set -euo pipefail

# LE PATH DE CRON N'EST PAS CELUI D'UN SHELL DE CONNEXION, et sauvegarde.sh a
# échoué cinq nuits de suite pour cette seule raison. Même précaution ici.
case ":$PATH:" in
  *":/usr/local/bin:"*) ;;
  *) PATH="/usr/local/bin:$PATH" ;;
esac
export PATH

CONF="${TEESHOOP_CONF:-$HOME/.config/teeshoop}"
CLE_FICHIER="${TEESHOOP_CLE:-$CONF/sauvegarde.cle}"
ENV_FICHIER="${TEESHOOP_R2_ENV:-$CONF/r2.env}"
SEAU="${TEESHOOP_SEAU_SAUVEGARDE:-teeshoop-sauvegardes}"
PREFIXE="${TEESHOOP_PREFIXE_SAUVEGARDE:-boutique}"
TAILLE_MORCEAU="${TEESHOOP_TAILLE_MORCEAU:-64m}"
API="https://api.cloudflare.com/client/v4"

# GLOBAL ET NON `local`, ET CE N'EST PAS UN DÉTAIL. Le piège a été mesuré le
# 05/09/2026 : déclaré `local` dans la fonction d'envoi, il sortait de portée
# avant que le `trap ... EXIT` ne s'exécute, `set -u` faisait « unbound
# variable », et le script rendait 1 APRÈS avoir posé ses six objets et les
# avoir relus. Une copie hors site réussie annoncée en échec, c'est la sonnerie
# qu'on finit par couper.
TRAVAIL=""

erreur() { echo "hors-site: $*" >&2; exit 1; }
nettoyer() { [ -n "${TRAVAIL:-}" ] && [ -d "$TRAVAIL" ] && rm -rf "$TRAVAIL"; return 0; }

# ── les identifiants ────────────────────────────────────────────────────────
#
# AUCUN JETON REFUSE TOUT. Un script de sauvegarde qui, faute d'identifiant,
# décide qu'il n'y a rien à envoyer est exactement la panne silencieuse contre
# laquelle il a été écrit.
charger_identifiants() {
  if [ -r "$ENV_FICHIER" ]; then
    # CE FICHIER EST EXÉCUTÉ, PAS LU. `.` en fait du code, donc quiconque peut
    # l'écrire peut exécuter ce que lui veut sous notre compte, sur un
    # hébergement mutualisé. Un mode plus ouvert que 600 est un refus, pas un
    # avertissement.
    local mode
    mode=$(stat -c '%a' "$ENV_FICHIER" 2>/dev/null || echo '600')
    case "$mode" in
      600|400) ;;
      *) erreur "$ENV_FICHIER est en $mode et il est exécuté par ce script. chmod 600 \"$ENV_FICHIER\"" ;;
    esac
    # shellcheck disable=SC1090
    . "$ENV_FICHIER"
  fi
  CF_ACCOUNT_ID="${CF_ACCOUNT_ID:-}"
  CF_R2_TOKEN="${CF_R2_TOKEN:-${CF_API_TOKEN:-}}"
  [ -n "$CF_ACCOUNT_ID" ] || erreur "CF_ACCOUNT_ID absent. Attendu dans $ENV_FICHIER (voir ACCES-REQUIS.md)."
  [ -n "$CF_R2_TOKEN" ] || erreur "CF_R2_TOKEN absent. Attendu dans $ENV_FICHIER (voir ACCES-REQUIS.md)."
  BASE="$API/accounts/$CF_ACCOUNT_ID/r2/buckets/$SEAU"
}

# ── les outils, vérifiés avant de commencer ─────────────────────────────────
verifier_outils() {
  for o in curl openssl split sha256sum sort; do
    command -v "$o" >/dev/null || erreur "$o est introuvable. PATH=$PATH"
  done
  # -pbkdf2 est arrivé avec OpenSSL 1.1.1. Sans lui, `openssl enc` dérive la clé
  # avec un MD5 à une itération, ce qui n'est pas un chiffrement de sauvegarde.
  # Refuser vaut mieux que chiffrer faiblement en silence.
  echo x | openssl enc -aes-256-cbc -pbkdf2 -iter 10 -pass pass:x >/dev/null 2>&1 \
    || erreur "cet openssl ne connaît pas -pbkdf2 ($(openssl version)). Refus de chiffrer faiblement."
}

verifier_cle() {
  [ -r "$CLE_FICHIER" ] || erreur "pas de phrase de passe lisible dans $CLE_FICHIER (voir ACCES-REQUIS.md)."
  [ -s "$CLE_FICHIER" ] || erreur "$CLE_FICHIER est vide."
  local octets
  octets=$(wc -c < "$CLE_FICHIER")
  [ "$octets" -ge 32 ] || erreur "la phrase de passe ne fait que $octets octets. Au moins 32, tirés au sort."
  local mode
  mode=$(stat -c '%a' "$CLE_FICHIER" 2>/dev/null || echo '600')
  case "$mode" in
    600|400) ;;
    *) erreur "$CLE_FICHIER est en $mode, il doit être en 600. chmod 600 \"$CLE_FICHIER\"" ;;
  esac
}

# ── les appels R2 ───────────────────────────────────────────────────────────

# curl rend 0 sur un 4xx : c'est le piège qui fait dire « envoyé » à un refus.
# --fail-with-body rend non zéro ET garde le corps, donc l'erreur est lisible.
r2_put() { # <cle> <fichier>
  curl -sS --fail-with-body --retry 3 --retry-delay 2 --max-time 900 \
    -X PUT "$BASE/objects/$(cle_url "$1")" \
    -H "Authorization: Bearer $CF_R2_TOKEN" \
    -H "Content-Type: application/octet-stream" \
    --data-binary "@$2"
}

r2_get() { # <cle> <fichier_destination>
  curl -sS --fail --retry 3 --retry-delay 2 --max-time 900 \
    "$BASE/objects/$(cle_url "$1")" \
    -H "Authorization: Bearer $CF_R2_TOKEN" \
    -o "$2"
}

r2_supprimer() { # <cle>
  curl -sS --fail-with-body --max-time 120 \
    -X DELETE "$BASE/objects/$(cle_url "$1")" \
    -H "Authorization: Bearer $CF_R2_TOKEN" >/dev/null
}

# La liste d'un préfixe, une ligne « cle<TAB>octets<TAB>etag » par objet.
# La pagination est suivie : `is_truncated` sans curseur est une anomalie, pas
# une fin, et la confondre avec une fin ferait dire « tout est là » à la moitié.
r2_lister() { # <prefixe>
  local curseur='' page=0 corps
  while :; do
    local url="$BASE/objects?per_page=1000&prefix=$(cle_url "$1")"
    [ -n "$curseur" ] && url="$url&cursor=$curseur"
    corps=$(curl -sS --fail --retry 3 --retry-delay 2 --max-time 300 "$url" \
      -H "Authorization: Bearer $CF_R2_TOKEN") || erreur "la liste de $1 a échoué"
    case "$corps" in
      *'"success":true'*) ;;
      *) erreur "la liste de $1 a été refusée : $(printf '%s' "$corps" | head -c 200)" ;;
    esac
    # `printf '%s\n'` ET PAS `printf '%s'`, ET CE N'EST PAS DE LA COQUETTERIE.
    # Mesuré le 05/09/2026 : GNU sed ne termine PAS sa dernière ligne quand son
    # entrée ne l'était pas, et `while read` abandonne une ligne non terminée.
    # Le symptôme observé : `--lister` annonçait « 2 objets, 1 432 octets » sur
    # un préfixe qui en portait trois, le troisième pesant 3 Mo. `cut` et `awk`
    # ajoutent le saut de ligne, ce qui rendait le défaut invisible partout où
    # l'un des deux se trouvait au milieu du tuyau. Un compte faux dans un outil
    # de sauvegarde est pire qu'une erreur : c'est une erreur rassurante.
    printf '%s\n' "$corps" \
      | sed 's/},{/}\n{/g' \
      | sed -n 's/.*"key":"\([^"]*\)".*"etag":"\([^"]*\)".*"size":\([0-9]*\).*/\1\t\3\t\2/p'
    page=$((page + 1))
    case "$corps" in
      *'"is_truncated":true'*)
        curseur=$(printf '%s\n' "$corps" | sed -n 's/.*"cursor":"\([^"]*\)".*/\1/p' | tail -1)
        [ -n "$curseur" ] || erreur "page tronquée sans curseur : la marche ne peut pas finir"
        ;;
      *) break ;;
    esac
    [ "$page" -lt 1000 ] || erreur "plus de 1000 pages, la marche est arrêtée sans être complète"
  done
}

# Une clé R2 dans une URL. Les barres sont encodées, comme le fait wrangler.
cle_url() {
  printf '%s' "$1" | sed -e 's|%|%25|g' -e 's|/|%2F|g' -e 's| |%20|g' -e 's|+|%2B|g' -e 's|#|%23|g' -e 's|?|%3F|g'
}

# ── l'envoi ─────────────────────────────────────────────────────────────────

envoyer() {
  local SRC="$1" KEEP="${2:-7}"
  [ -d "$SRC" ] || erreur "$SRC n'est pas un répertoire."
  charger_identifiants
  verifier_outils
  verifier_cle

  local STAMP
  STAMP="$(basename "$SRC")"
  case "$STAMP" in
    20*) ;;
    *) STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)" ;;
  esac
  local RACINE="$PREFIXE/$STAMP"

  TRAVAIL="$(mktemp -d "${TMPDIR:-/tmp}/hors-site.XXXXXX")"
  # La sortie emporte le répertoire de travail : les morceaux CHIFFRÉS y sont,
  # mais aussi la trace de ce qui a été lu, et ce n'est pas fait pour rester.
  trap nettoyer EXIT

  local objets_json='' fichiers_json='' total=0 nb_objets=0
  local t0 t1
  t0=$(date +%s)

  local f
  for f in "$SRC"/*; do
    [ -f "$f" ] || continue
    local nom
    nom="$(basename "$f")"
    case "$nom" in
      INVENTAIRE-HORS-SITE.json|RECU-HORS-SITE.txt) continue ;;
    esac

    local clair_sha clair_octets
    clair_sha="$(sha256sum "$f" | cut -d' ' -f1)"
    clair_octets="$(wc -c < "$f")"

    echo "hors-site: $nom ($clair_octets octets) chiffrement ..."
    openssl enc -aes-256-cbc -md sha512 -pbkdf2 -iter 200000 -salt \
      -pass "file:$CLE_FICHIER" -in "$f" -out "$TRAVAIL/$nom.chiffre"

    # Le chiffre se relit-il ? Le seul contrôle qui distingue une archive
    # chiffrée d'un tas d'octets, et il coûte une passe de déchiffrement.
    openssl enc -d -aes-256-cbc -md sha512 -pbkdf2 -iter 200000 \
      -pass "file:$CLE_FICHIER" -in "$TRAVAIL/$nom.chiffre" \
      | sha256sum | cut -d' ' -f1 > "$TRAVAIL/relu.sha"
    [ "$(cat "$TRAVAIL/relu.sha")" = "$clair_sha" ] \
      || erreur "$nom : le déchiffrement ne rend pas les octets d'origine. Rien n'est envoyé."

    split -b "$TAILLE_MORCEAU" "$TRAVAIL/$nom.chiffre" "$TRAVAIL/$nom.chiffre."
    rm -f "$TRAVAIL/$nom.chiffre"

    local morceaux='' m
    for m in "$TRAVAIL/$nom.chiffre."*; do
      local mnom cle mo msha metag
      mnom="$(basename "$m")"
      cle="$RACINE/$mnom"
      mo="$(wc -c < "$m")"
      msha="$(sha256sum "$m" | cut -d' ' -f1)"

      echo "hors-site:   $mnom ($mo octets) envoi ..."
      r2_put "$cle" "$m" >/dev/null

      # RELU DEPUIS R2, pas supposé. L'etag d'un objet envoyé en une fois EST
      # son md5 : le comparer prouve que Cloudflare détient bien ces octets-là,
      # avec une empreinte qui ne vient pas de nous.
      local ligne rmo retag
      ligne="$(r2_lister "$cle" | head -1)"
      [ -n "$ligne" ] || erreur "$cle : envoyé puis introuvable dans le seau."
      rmo="$(printf '%s' "$ligne" | cut -f2)"
      retag="$(printf '%s' "$ligne" | cut -f3)"
      [ "$rmo" = "$mo" ] || erreur "$cle : $rmo octets dans le seau contre $mo envoyés."
      metag="$(openssl md5 -r < "$m" | cut -d' ' -f1)"
      [ "$retag" = "$metag" ] || erreur "$cle : l'etag du seau ($retag) ne vaut pas le md5 envoyé ($metag)."

      objets_json="$objets_json    {\"cle\":\"$cle\",\"octets\":$mo,\"sha256\":\"$msha\",\"etag\":\"$retag\"},
"
      morceaux="$morceaux\"$cle\","
      total=$((total + mo))
      nb_objets=$((nb_objets + 1))
      rm -f "$m"
    done

    fichiers_json="$fichiers_json    {\"nom\":\"$nom\",\"octets\":$clair_octets,\"sha256\":\"$clair_sha\",\"morceaux\":[${morceaux%,}]},
"
  done

  [ "$nb_objets" -gt 0 ] || erreur "$SRC ne contient aucun fichier. Rien n'a été envoyé, et ce n'est pas une réussite."

  # L'empreinte de l'inventaire entier : « sha256␣␣cle » par objet, trié, hashé.
  # Une seule valeur qui change si le moindre octet ou la moindre clé change.
  local liste_sha
  liste_sha="$(printf '%s' "$objets_json" \
    | sed -n 's/.*"cle":"\([^"]*\)".*"sha256":"\([^"]*\)".*/\2  \1/p' \
    | LC_ALL=C sort | sha256sum | cut -d' ' -f1)"

  t1=$(date +%s)
  local INV="$TRAVAIL/INVENTAIRE.json"
  cat > "$INV" <<JSON
{
  "format": "teeshoop-inventaire-1",
  "genre": "sauvegarde-boutique",
  "seau": "$SEAU",
  "prefixe": "$RACINE/",
  "source": "$SRC",
  "hote": "$(hostname)",
  "pris_le": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "chiffrement": "aes-256-cbc, pbkdf2 sha512, 200000 iterations, sel aleatoire",
  "compte": $nb_objets,
  "octets": $total,
  "secondes": $((t1 - t0)),
  "sha256_liste": "$liste_sha",
  "objets": [
${objets_json%,
}
  ],
  "fichiers": [
${fichiers_json%,
}
  ]
}
JSON

  r2_put "$RACINE/INVENTAIRE.json" "$INV" >/dev/null
  cp "$INV" "$SRC/INVENTAIRE-HORS-SITE.json"
  chmod 600 "$SRC/INVENTAIRE-HORS-SITE.json"

  {
    echo "Copie hors site Teeshoop"
    echo "seau       : $SEAU"
    echo "préfixe    : $RACINE/"
    echo "objets     : $nb_objets"
    echo "octets     : $total"
    echo "durée      : $((t1 - t0)) s"
    echo "empreinte  : $liste_sha"
    echo "relire     : node scripts/sauvegarde-r2.mjs comparer <ce répertoire> $SEAU --prefixe=$RACINE/"
    echo "restaurer  : ./sauvegarde-hors-site.sh --restaurer $STAMP <destination>"
  } > "$SRC/RECU-HORS-SITE.txt"
  chmod 600 "$SRC/RECU-HORS-SITE.txt"

  echo "hors-site: $nb_objets objets, $total octets, $((t1 - t0)) s, empreinte $liste_sha"

  rotation "$KEEP"
}

# ── la rotation ─────────────────────────────────────────────────────────────
#
# Une suppression dans un script de sauvegarde mérite deux garde-fous : elle ne
# touche que des clés sous `$PREFIXE/`, et elle ne descend jamais sous le nombre
# demandé. Un compte qui rendrait zéro (jeton refusé, liste vide) ne supprime
# donc rien du tout.
rotation() {
  local KEEP="$1"
  [ "$KEEP" -ge 1 ] || erreur "garder moins d'une copie n'est pas une rétention."
  local horodatages n
  horodatages="$(r2_lister "$PREFIXE/" | cut -f1 | sed -n "s|^$PREFIXE/\([^/]*\)/.*|\1|p" | LC_ALL=C sort -u)"
  n="$(printf '%s\n' "$horodatages" | grep -c . || true)"
  [ "$n" -gt "$KEEP" ] || { echo "hors-site: $n copie(s) hors site, rétention $KEEP, rien à retirer."; return 0; }
  local vieux
  vieux="$(printf '%s\n' "$horodatages" | head -n "$((n - KEEP))")"
  local h cle
  for h in $vieux; do
    [ -n "$h" ] || continue
    echo "hors-site: rotation, suppression de $PREFIXE/$h/"
    r2_lister "$PREFIXE/$h/" | cut -f1 | while read -r cle; do
      case "$cle" in
        "$PREFIXE/$h/"*) r2_supprimer "$cle" ;;
        *) erreur "la rotation a vu une clé hors de $PREFIXE/$h/ : $cle. Rien de plus n'est supprimé." ;;
      esac
    done
  done
}

# ── la restauration ─────────────────────────────────────────────────────────
#
# Elle relit l'inventaire depuis le seau, rapatrie chaque morceau, recolle,
# déchiffre, et COMPARE le sha256 au clair d'origine. Une restauration qui ne
# compare pas n'est pas une restauration, c'est une copie.
restaurer() {
  local STAMP="$1" DEST="$2"
  [ -n "$STAMP" ] && [ -n "$DEST" ] || erreur "--restaurer attend <horodatage> <destination>"
  charger_identifiants
  verifier_outils
  verifier_cle
  mkdir -p "$DEST"
  local RACINE="$PREFIXE/$STAMP"
  local INV="$DEST/INVENTAIRE.json"

  r2_get "$RACINE/INVENTAIRE.json" "$INV" || erreur "pas d'inventaire sous $RACINE/ dans $SEAU."
  grep -q '"format": "teeshoop-inventaire-1"' "$INV" || erreur "inventaire de format inconnu."

  local nb=0
  local t0 t1
  t0=$(date +%s)
  # Une ligne par fichier d'origine, avec ses morceaux dans l'ordre du fichier.
  sed -n 's/.*"nom":"\([^"]*\)","octets":\([0-9]*\),"sha256":"\([^"]*\)","morceaux":\[\(.*\)\]}.*/\1\t\2\t\3\t\4/p' "$INV" \
  | while IFS=$'\t' read -r nom octets sha morceaux; do
      echo "hors-site: $nom ..."
      local tmp="$DEST/.$nom.chiffre"
      : > "$tmp"
      local cle
      for cle in $(printf '%s' "$morceaux" | tr ',' '\n' | tr -d '"'); do
        [ -n "$cle" ] || continue
        r2_get "$cle" "$DEST/.morceau" || erreur "$cle : lecture impossible."
        cat "$DEST/.morceau" >> "$tmp"
        rm -f "$DEST/.morceau"
      done
      openssl enc -d -aes-256-cbc -md sha512 -pbkdf2 -iter 200000 \
        -pass "file:$CLE_FICHIER" -in "$tmp" -out "$DEST/$nom" \
        || erreur "$nom : déchiffrement impossible. Phrase de passe ou morceau manquant."
      rm -f "$tmp"
      local relu ro
      relu="$(sha256sum "$DEST/$nom" | cut -d' ' -f1)"
      ro="$(wc -c < "$DEST/$nom")"
      [ "$ro" = "$octets" ] || erreur "$nom : $ro octets restaurés contre $octets à l'inventaire."
      [ "$relu" = "$sha" ] || erreur "$nom : sha256 $relu contre $sha à l'inventaire."
      echo "hors-site:   $nom rendu identique ($ro octets, sha256 $relu)"
      nb=$((nb + 1))
    done
  t1=$(date +%s)

  # `while` tourne dans un sous-shell, donc son compte ne remonte pas : on
  # recompte ici plutôt que d'annoncer un chiffre faux.
  local rendus
  rendus="$(grep -c '"nom":' "$INV" || true)"
  local presents
  presents="$(ls -1 "$DEST" | grep -cv '^INVENTAIRE.json$' || true)"
  [ "$presents" = "$rendus" ] || erreur "$presents fichiers rendus contre $rendus à l'inventaire."
  echo "hors-site: $rendus fichiers restaurés et comparés, $((t1 - t0)) s, dans $DEST"
}

lister() {
  charger_identifiants
  verifier_outils
  local h n o
  r2_lister "$PREFIXE/" | while IFS=$'\t' read -r cle octets _; do
    printf '%s\t%s\n' "$(printf '%s' "$cle" | sed -n "s|^$PREFIXE/\([^/]*\)/.*|\1|p")" "$octets"
  done | awk -F'\t' '{n[$1]++; o[$1]+=$2} END {for (k in n) printf "%s\t%d objets\t%d octets\n", k, n[k], o[k]}' | LC_ALL=C sort
}

case "${1:-}" in
  --restaurer) restaurer "${2:-}" "${3:-}" ;;
  --lister) lister ;;
  ''|-h|--help)
    sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
  *) envoyer "$1" "${2:-7}" ;;
esac
