#!/bin/bash
#
# La porte qui prouve la porte.
#
# `destinataire.sh` ne peut s'exécuter pour de vrai que sur le compte cPanel :
# `uapi` n'existe nulle part ailleurs. Ce harnais pose un faux `uapi` en tête du
# PATH, qui rend l'enveloppe JSON que cPanel rend réellement, et vérifie que le
# contrôle dit OUI, REFUS, HORS COMPTE et « je n'ai pas pu regarder » aux bons
# moments. C'est le seul moyen de savoir qu'une porte peut échouer sans attendre
# le jour où elle aurait dû.
#
# Les trois boîtes de la liste sont celles qui ont été mesurées le 02/09/2026
# sur le vrai compte (`ssh teeshoop 'uapi Email list_pops'`), avec en quatrième
# l'entrée du compte principal, dont le champ `email` vaut le domaine sans
# arobase : elle doit être ignorée sans faire tomber le lecteur.
#
# Sortie 0 si les huit cas passent, 1 sinon, 2 si le harnais n'a rien pu tester.

set -uo pipefail

ICI="$(cd "$(dirname "$0")" && pwd)"
CONTROLE="$ICI/destinataire.sh"
[ -x "$CONTROLE" ] || { echo "essai: $CONTROLE est introuvable ou non exécutable." >&2; exit 2; }

BAC=$(mktemp -d) || { echo "essai: pas de répertoire temporaire." >&2; exit 2; }
trap 'rm -rf "$BAC"' EXIT
mkdir -p "$BAC/bin"

cat > "$BAC/bin/uapi" <<'FAUXUAPI'
#!/bin/bash
# Faux uapi. Rend l'enveloppe que cPanel rend, et sait échouer sur commande.
case "${FAUX_UAPI_MODE:-normal}" in
  echec)
    echo '{"apiversion":3,"module":"Email","func":"list_pops","result":{"errors":["You do not have access to this feature."],"messages":null,"metadata":{},"status":0,"warnings":null,"data":null}}'
    exit 0 ;;
  charabia)
    echo 'Vous ne disposez pas de la fonctionnalite'
    exit 0 ;;
  vide)
    echo '{"apiversion":3,"module":"Email","func":"list_pops","result":{"errors":null,"messages":null,"metadata":{},"status":1,"warnings":null,"data":[]}}'
    exit 0 ;;
  chaines)
    echo '{"apiversion":3,"module":"Email","func":"list_pops","result":{"errors":null,"messages":null,"metadata":{},"status":1,"warnings":null,"data":["contact@teeshoop.com","s.singh@teeshoop.com","support@teeshoop.com"]}}'
    exit 0 ;;
  piege)
    # Une adresse absente citée dans un message d'erreur ne doit JAMAIS se faire
    # passer pour une boîte existante.
    echo '{"apiversion":3,"module":"Email","func":"list_pops","result":{"errors":null,"messages":["dev@teeshoop.com a ete supprimee"],"metadata":{},"status":1,"warnings":null,"data":[{"login":"contact@teeshoop.com","email":"contact@teeshoop.com"}]}}'
    exit 0 ;;
  plante)
    exit 1 ;;
  *)
    echo '{"apiversion":3,"module":"Email","func":"list_pops","result":{"errors":null,"messages":null,"metadata":{},"status":1,"warnings":null,"data":[{"login":"contact@teeshoop.com","email":"contact@teeshoop.com"},{"login":"s.singh@teeshoop.com","email":"s.singh@teeshoop.com"},{"login":"support@teeshoop.com","email":"support@teeshoop.com"},{"login":"dawe4500","email":"teeshoop.com"}]}}'
    exit 0 ;;
esac
FAUXUAPI
chmod +x "$BAC/bin/uapi"

PASSES=0
ECHECS=0

cas() {
  local titre="$1" mode="$2" dest="$3" attendu="$4" sortie code
  sortie=$( PATH="$BAC/bin:$PATH" FAUX_UAPI_MODE="$mode" "$CONTROLE" --dest="$dest" 2>&1 )
  code=$?
  if [ "$code" -eq "$attendu" ]; then
    PASSES=$((PASSES + 1))
    printf '  ok    %-46s sortie %d  %s\n' "$titre" "$code" "$sortie"
  else
    ECHECS=$((ECHECS + 1))
    printf '  ECHEC %-46s sortie %d, attendu %d  %s\n' "$titre" "$code" "$attendu" "$sortie"
  fi
}

echo "destinataire-essai : le contrôle de destination, cas par cas"
cas "boîte présente (objets)"              normal   "contact@teeshoop.com"  0
cas "boîte présente, casse différente"     normal   "Contact@Teeshoop.com"  0
cas "boîte présente (liste de chaînes)"    chaines  "support@teeshoop.com"  0
cas "boîte ABSENTE sur un domaine hébergé" normal   "dev@teeshoop.com"      1
cas "adresse citée dans un message"        piege    "dev@teeshoop.com"      1
cas "domaine hors du compte"               normal   "alerte@worklance.fr"   3
cas "uapi répond en échec"                 echec    "contact@teeshoop.com"  2
cas "uapi répond du charabia"              charabia "contact@teeshoop.com"  2
cas "uapi ne rend aucune boîte"            vide     "contact@teeshoop.com"  2
cas "uapi plante"                          plante   "contact@teeshoop.com"  2
cas "adresse malformée"                    normal   "pas-une-adresse"       1
cas "plusieurs destinataires"              normal   "a@teeshoop.com,b@teeshoop.com" 2

# uapi absent : le PATH ne contient pas le faux binaire.
sortie=$( PATH="/usr/bin:/bin" "$CONTROLE" --dest="contact@teeshoop.com" 2>&1 ); code=$?
if [ "$code" -eq 2 ]; then
  PASSES=$((PASSES + 1)); printf '  ok    %-46s sortie %d  %s\n' "uapi introuvable" "$code" "$sortie"
else
  ECHECS=$((ECHECS + 1)); printf '  ECHEC %-46s sortie %d, attendu 2\n' "uapi introuvable" "$code"
fi

ATTENDUS=13
echo "  ---"
echo "  $PASSES cas verts, $ECHECS rouges, sur $ATTENDUS attendus"

# UN HARNAIS QUI NE TESTE RIEN NE DOIT PAS ÊTRE VERT. Le compte est comparé à
# une constante : si un cas disparaît du fichier, la porte tombe.
if [ $((PASSES + ECHECS)) -ne "$ATTENDUS" ]; then
  echo "destinataire-essai: $((PASSES + ECHECS)) cas exécutés au lieu de $ATTENDUS." >&2
  exit 2
fi
[ "$ECHECS" -eq 0 ] || exit 1
exit 0
