#!/bin/bash
#
# La boîte à qui on écrit existe-t-elle ? C'est la question que le 28 août 2026
# n'a pas posée, et c'est pour cela que cinq nuits de sauvegardes absentes ont
# été détectées 719 fois sans que personne ne l'apprenne.
#
#   ./destinataire.sh --dest=quelquun@teeshoop.com
#
# CE QUE ÇA PROUVE, ET CE QUE ÇA NE PROUVE PAS.
#
# `uapi Email list_pops` liste les boîtes réellement créées sur le compte cPanel.
# C'est le compte lui-même qui répond, donc une boîte listée existe : c'est une
# preuve, pas une présomption. En revanche cela ne dit RIEN de trois choses :
#
#   - une adresse sur un domaine que ce compte n'héberge pas (la ligne de cron du
#     28 août pointait vers un quatrième domaine) ;
#   - une boîte qui existe mais que personne ne relève ;
#   - un message accepté par le serveur local puis rejeté plus loin.
#
# Le premier cas a donc son propre verdict (3, « hors compte ») et n'est jamais
# confondu avec un succès. Les deux autres ne se prouvent que de bout en bout,
# c'est le rôle du battement de coeur (scripts/battement.sh).
#
# SORTIES, et elles distinguent « non » de « je n'ai pas pu regarder » :
#
#   0  la boîte est là, le compte l'a dit
#   1  REFUS : le compte héberge ce domaine, et cette boîte n'y est pas
#   2  je n'ai pas pu regarder (uapi absent, perl absent, réponse illisible,
#      uapi en échec, plusieurs destinataires)
#   3  hors compte : ce domaine n'est pas hébergé ici, list_pops ne peut rien
#      en dire, ni oui ni non
#
# UNE SORTIE 2 N'EST PAS UN SUCCÈS. Qui appelle ce script doit traiter 2 et 3
# comme « non prouvé » et ne jamais les lire comme « prouvé ».

set -uo pipefail

DEST=""
BAVARD=1

for a in "$@"; do
  case "$a" in
    --dest=*) DEST="${a#*=}" ;;
    --silencieux) BAVARD=0 ;;
    *) echo "destinataire: option inconnue $a" >&2; exit 2 ;;
  esac
done

dire() { [ "$BAVARD" -eq 1 ] && echo "$1"; return 0; }

if [ -z "$DEST" ]; then
  echo "destinataire: --dest= est obligatoire." >&2
  exit 2
fi

# Le même piège de PATH que dans veille.sh et sauvegarde.sh : cron impose
# PATH=/usr/bin:/bin, où ni uapi ni wp ne se trouvent. Sur cPanel uapi est dans
# /usr/local/cpanel/bin, qui n'est dans le PATH d'aucun cron.
case ":$PATH:" in
  *":/usr/local/bin:"*) ;;
  *) PATH="/usr/local/bin:$PATH" ;;
esac
case ":$PATH:" in
  *":/usr/local/cpanel/bin:"*) ;;
  *) PATH="$PATH:/usr/local/cpanel/bin" ;;
esac
export PATH

case "$DEST" in
  *,*|*\ *)
    # mail() accepte une liste séparée par des virgules ; ce contrôle vérifie
    # UNE adresse. Rendre 2 plutôt que de deviner : « je n'ai pas regardé » est
    # la réponse honnête, et l'appelant ne la lira pas comme un succès.
    dire "destinataire: plusieurs destinataires dans « $DEST », ce contrôle en vérifie un seul."
    exit 2
    ;;
esac

DEST_MIN=$(printf '%s' "$DEST" | tr 'A-Z' 'a-z')
case "$DEST_MIN" in
  *@*.*)
    case "${DEST_MIN%@*}" in *@*) ADRESSE_OK=0 ;; *) ADRESSE_OK=1 ;; esac
    ;;
  *) ADRESSE_OK=0 ;;
esac
if [ "$ADRESSE_OK" -eq 0 ]; then
  # Une adresse malformée ne peut recevoir aucune alerte. C'est un refus, pas
  # une incertitude.
  dire "REFUS : « $DEST » n'est pas une adresse électronique utilisable."
  exit 1
fi
DOMAINE="${DEST_MIN#*@}"

if ! command -v uapi >/dev/null 2>&1; then
  dire "je n'ai pas pu regarder : uapi est introuvable (PATH=$PATH)."
  exit 2
fi
if ! command -v perl >/dev/null 2>&1; then
  dire "je n'ai pas pu regarder : perl est introuvable, la réponse d'uapi ne peut pas être lue."
  exit 2
fi

REPONSE=$(uapi --output=json Email list_pops 2>/dev/null)
UAPI_CODE=$?
if [ "$UAPI_CODE" -ne 0 ] || [ -z "$REPONSE" ]; then
  dire "je n'ai pas pu regarder : uapi a rendu $UAPI_CODE et $(printf '%s' "$REPONSE" | wc -c) octets."
  exit 2
fi

# LE FORMAT DE list_pops N'EST PAS FIGÉ D'UNE VERSION DE cPanel À L'AUTRE : la
# liste `data` contient soit des chaînes, soit des objets {email, login}. Ce
# lecteur accepte les deux et ne regarde QUE `result.data`, jamais `messages`
# ni `errors`, pour qu'une adresse citée dans un message d'erreur ne puisse pas
# se faire passer pour une boîte existante.
#
# perl plutôt que php : le canal d'alerte historique est tombé le 28 août parce
# que /usr/bin/php est php-cgi sous cron. uapi est écrit en perl, donc perl est
# présent partout où uapi l'est, et JSON::PP est dans le coeur de perl depuis
# 5.14. Un lecteur, un seul, et pas celui qui a déjà lâché.
LECTEUR='
use strict; use warnings; use JSON::PP;
my $brut = do { local $/; <STDIN> };
my $d = eval { decode_json($brut) };
if ( ! $d ) { print STDERR "reponse illisible\n"; exit 2 }
my $r = $d->{result};
if ( ref $r ne "HASH" ) { print STDERR "enveloppe inattendue\n"; exit 2 }
if ( ! $r->{status} ) {
  my @m;
  for my $k (qw(errors messages)) {
    my $v = $r->{$k};
    next unless defined $v;
    push @m, ref $v eq "ARRAY" ? grep { defined } @$v : $v;
  }
  print STDERR "uapi a refuse: " . ( join("; ", @m) || "sans message" ) . "\n";
  exit 2;
}
my $data = $r->{data};
if ( ref $data ne "ARRAY" ) { print STDERR "data n est pas une liste\n"; exit 2 }
my %vu;
for my $e (@$data) {
  my @c;
  if    ( ref $e eq "HASH" ) { push @c, grep { defined && ! ref } @{$e}{qw(email login)} }
  elsif ( ! ref $e )         { push @c, $e }
  for my $a (@c) { next unless $a =~ /\@/; $vu{ lc $a } = 1 }
}
print "$_\n" for sort keys %vu;
exit 0;
'

BOITES=$(printf '%s' "$REPONSE" | perl -MJSON::PP -e "$LECTEUR" 2>&1)
LU=$?
if [ "$LU" -ne 0 ]; then
  dire "je n'ai pas pu regarder : $(printf '%s' "$BOITES" | head -1)"
  exit 2
fi
if [ -z "$BOITES" ]; then
  # Zéro boîte sur un compte de messagerie : ce n'est pas « le domaine n'est pas
  # là », c'est une réponse qui ne ressemble pas à une réponse. « Rien trouvé »
  # et « rien regardé » sont deux résultats différents.
  dire "je n'ai pas pu regarder : uapi a répondu sans aucune boîte."
  exit 2
fi

TROUVEE=0
HEBERGE=0
while IFS= read -r b; do
  [ -z "$b" ] && continue
  [ "$b" = "$DEST_MIN" ] && TROUVEE=1
  [ "${b#*@}" = "$DOMAINE" ] && HEBERGE=1
done <<EOF
$BOITES
EOF

NB=$(printf '%s\n' "$BOITES" | grep -c . )
if [ "$NB" -le 1 ]; then COMPTE="$NB boîte listée"; else COMPTE="$NB boîtes listées"; fi

if [ "$TROUVEE" -eq 1 ]; then
  dire "OUI : $DEST existe sur ce compte ($COMPTE)."
  exit 0
fi
if [ "$HEBERGE" -eq 1 ]; then
  dire "REFUS : le compte héberge la messagerie de $DOMAINE et $DEST n'y est pas ($COMPTE)."
  dire "        Créer la boîte (uapi Email add_pop) ou viser une adresse qui existe."
  exit 1
fi
dire "HORS COMPTE : $DOMAINE n'est pas hébergé ici, list_pops ne peut ni confirmer ni infirmer $DEST."
dire "              Seul un aller-retour réel le prouve : voir le battement de coeur."
exit 3
