#!/bin/bash
#
# Déployer Teeshoop sur WordPress, depuis une machine autorisée.
#
#   ./scripts/deployer.sh preprod
#   ./scripts/deployer.sh prod
#   ./scripts/deployer.sh --sonde-cle [alias]   quelle clé cet alias présente-t-il
#
# ── POURQUOI CE SCRIPT EXISTE, ALORS QUE LE DÉPLOIEMENT EST DANS GITHUB ─────
#
# `.github/workflows/deploiement.yml` fait exactement la même chose, et il ne
# peut pas la faire. Le premier vrai déclenchement, le 02/09/2026, a passé toutes
# les portes et s'est arrêté net sur :
#
#   pin-verify: preprod n'a pas répondu :
#   ssh: connect to host *** port 22: Connection timed out
#
# **o2switch filtre les connexions SSH par adresse IP** (cinq au maximum par
# compte, voir `ACCES-REQUIS.md` §1 bis). L'adresse du développeur y est ; celle
# d'un exécutant GitHub, non, et elle ne peut pas y être : ces machines sont
# éphémères et tirent leur adresse de plages entières que personne ne peut
# lister. Mesuré le même jour, à la minute près : depuis cette machine le port 22
# répond, depuis l'exécutant GitHub il expire.
#
# Ce n'est donc pas une panne à réparer, c'est une propriété de l'hébergement. Il
# y a trois façons de vivre avec, et la deuxième est celle-ci :
#
#   1. un exécutant AUTO-HÉBERGÉ sur une machine autorisée. C'est la seule qui
#      rende « un push livre la préproduction » littéralement vrai, et c'est ce
#      qui a été fait le 02/09/2026 : le service `teeshoop-runner`, étiqueté
#      `o2switch-autorise`. Il demande une machine allumée ;
#   2. **piloter le déploiement depuis une machine autorisée**, avec ce script.
#      C'est ce que le travail GitHub appelle, pour qu'il n'y ait qu'une seule
#      description de la séquence, et c'est le recours quand la machine est
#      éteinte ;
#   3. ouvrir SSH à des plages entières d'un fournisseur de nuage, ce qui revient
#      à retirer le filtre. Non.
#
# Ce que GitHub garde et qui n'est pas rien : toute la vérification. `ci.yml`
# tourne à chaque poussée, sur deux versions de PHP, et le travail de déploiement
# refuse proprement au lieu de faire semblant.
#
# ── CE QU'IL FAIT, DANS CET ORDRE ───────────────────────────────────────────
#
#   1. la version de node est-elle celle que le dépôt fixe    (refuse sinon)
#   2. le port 22 répond-il depuis cette machine              (refuse sinon)
#   3. l'alias SSH porte-t-il une commande forcée             (refuse la PROD sinon)
#   4. la cible est-elle la version que le dépôt suppose      (refuse sinon)
#   5. pour la PRODUCTION seulement : le portail de mise en ligne (refuse sinon)
#   6. une sauvegarde, avant de toucher quoi que ce soit
#   7. l'extension et le thème, vers un dépôt d'attente
#   8. l'installation : analyse avec le PHP du serveur, échange, activation,
#      migration, sonde, et retour arrière automatique si l'une échoue
#   9. l'état, puis ce que le portail dit de la cible
#
# Les trois premières sont locales ou en lecture seule : rien n'a quitté cette
# machine tant qu'elles n'ont pas toutes rendu vert.
#
# Sortie : 0 déployé · 1 une étape a échoué · 2 refus avant tout envoi.

set -euo pipefail

CIBLE="${1:-}"

# ── QUELLE CLÉ, PAR DÉFAUT, ET POURQUOI CE DÉFAUT A CHANGÉ ──────────────────
#
# C'était « teeshoop », c'est-à-dire, dans le ~/.ssh/config du développeur, la clé
# qui ouvre un SHELL COMPLET sur le compte o2switch. Tout le durcissement de
# `scripts/deploiement.sh` (la commande forcée, l'aiguilleur rsync, les huit
# verbes, les deux répertoires connus) est écrit autour de l'AUTRE clé,
# `teeshoop-deploy`, et ne s'applique tout simplement pas quand c'est la première
# qui est utilisée. L'étape 7 de ce script est un `rsync -az --delete`.
#
# Le chemin sûr doit être celui qu'on obtient sans rien taper, et le chemin
# dangereux celui qu'il faut demander. C'était exactement l'inverse.
#
# Le travail GitHub appelle ce script sans variable d'environnement : changer le
# défaut ici est aussi ce qui corrige ce chemin-là.
HOTE="${TEESHOOP_SSH_HOTE:-teeshoop-deploy}"
RACINE="$(cd "$(dirname "$0")/.." && pwd)"

rouge()  { printf '\033[31m%s\033[0m\n' "$*"; }
orange() { printf '\033[33m%s\033[0m\n' "$*"; }
vert()   { printf '\033[32m%s\033[0m\n' "$*"; }
titre()  { printf '\n\033[1m── %s\033[0m\n' "$*"; }

refus() { rouge "deployer: $*"; exit 2; }
echec() { rouge "deployer: $*"; exit 1; }

# ── L'ALIAS EST UN ARGUMENT DE ssh, DONC IL EST TENU ────────────────────────
#
# `ssh` n'accepte pas `--` pour clore ses options : un alias qui commence par un
# tiret est lu comme une option, et `-F` ou `-o` en font exécuter d'autres choses.
# `launch-gate.mjs` tient déjà son hôte au même alphabet, pour la même raison ; le
# tenir des deux côtés évite qu'une valeur passe ici et se fasse refuser trois
# étapes plus loin. Ce n'est pas une frontière de privilège (qui pose la variable
# peut déjà lancer ce qu'il veut), c'est un refus net plutôt qu'un comportement
# surprenant.
#
# UNE FONCTION ET DEUX APPELS, parce que l'alias entre par deux portes : la
# variable d'environnement, et le second argument du mode diagnostic. Écrit une
# première fois en ligne, ce contrôle ne tenait que la première, et le mode
# diagnostic écrasait ensuite la valeur sans repasser devant.
valider_hote() {
  case "$1" in
    -*) refus "l'alias SSH « $1 » commence par un tiret : ssh le lirait comme une option, pas comme un hôte. Posez un nom d'hôte de ~/.ssh/config." ;;
  esac
  printf '%s' "$1" | grep -qx '[A-Za-z0-9._@-][A-Za-z0-9._@-]*' \
    || refus "l'alias SSH « $1 » contient un caractère que ce script refuse de passer à ssh. Posez un nom d'hôte de ~/.ssh/config."
}
valider_hote "$HOTE"

# ── LA SONDE : L'ALIAS EN FACE PORTE-T-IL UNE COMMANDE FORCÉE ───────────────
#
# COMMENT ELLE REGARDE. Sous `command="/home/dawe4500/deploiement.sh"`, sshd
# IGNORE la commande demandée par le client, la range dans SSH_ORIGINAL_COMMAND et
# lance le script à sa place. Une demande arbitraire ne s'exécute donc pas : elle
# ressort en « verbe inconnu » avec la sortie 2 (`scripts/deploiement.sh`, la
# branche `*)` du point d'entrée, qui appelle `refus()`). Sans commande forcée, la
# même demande s'exécute pour de bon.
#
# POURQUOI `whoami` ET PAS UN VERBE INVENTÉ. Un verbe inventé échoue des deux
# côtés (« verbe inconnu » ici, « command not found » là) et il faudrait déduire la
# différence d'un code de sortie. `whoami` rend le verdict « ouverte » DÉMONTRÉ et
# non déduit : la commande a tourné et a rendu le nom du compte, ce qui est
# exactement la capacité qu'on refuse à la production. Elle ne lit rien, n'écrit
# rien, ne change rien sur le serveur.
#
# LES DEUX CANAUX DOIVENT ÊTRE D'ACCORD pour conclure « restreinte » : le code de
# sortie 2 ET la phrase de refus. Le code seul se produit par accident, la phrase
# seule aussi ; les deux ensemble ne se produisent que si `deploiement.sh` a tourné
# à la place de ce qu'on a demandé.
#
# TROIS VERDICTS, PAS DEUX. « on n'a pas pu regarder » n'est pas « la clé est
# restreinte » (CLAUDE.md §3). La sonde ne rend « ouverte » que sur une
# démonstration et « restreinte » que sur deux signatures concordantes ; tout le
# reste, y compris une panne de réseau ou un refus d'authentification, est
# « inconnue », et « inconnue » refuse la production comme « ouverte ».
#
# LES OPTIONS SSH SONT CELLES DE `pin-verify.mjs`, volontairement : la sonde doit
# mesurer LA MÊME connexion que celle que le déploiement fera ensuite, sinon elle
# peut refuser ce qui marche, ou l'inverse. `timeout` en ceinture parce que
# ConnectTimeout ne couvre que la phase de connexion.
#
# CE QU'ELLE NE PROUVE PAS, ET IL FAUT LE SAVOIR : la présence de `restrict` (pas
# de transfert d'agent, pas de redirection de port, pas de pseudo-terminal). Elle
# prouve `command=`, qui est la moitié qui compte pour un rsync et pour un shell.
#
# ELLE LAISSE UNE TRACE. Côté serveur `refus()` journalise, donc
# `~/teeshoop-deploiements/journal.log` porte une ligne
# « REFUS verbe inconnu « whoami » » avant chaque déploiement. Cette ligne EST la
# sonde, ce n'est pas un incident.
SONDE_VERDICT=""
SONDE_SORTIE=""
SONDE_CODE=""

sonde_cle_restreinte() {
  local hote="$1" sortie code
  code=0
  sortie="$(timeout 30 ssh -n -T -o BatchMode=yes -o ConnectTimeout=20 "$hote" whoami 2>&1)" || code=$?

  SONDE_SORTIE="$sortie"
  SONDE_CODE="$code"

  if [ "$code" -eq 2 ] && printf '%s' "$sortie" | grep -q 'verbe inconnu'; then
    SONDE_VERDICT="restreinte"
    return 0
  fi

  # Un nom de compte POSIX sur une ligne entière, et la sortie 0 : la preuve que
  # la commande demandée a bien tourné.
  if [ "$code" -eq 0 ] && printf '%s' "$sortie" | grep -qx '[a-z_][a-z0-9_.-]*'; then
    SONDE_VERDICT="ouverte"
    return 0
  fi

  SONDE_VERDICT="inconnue"
}

# Ce que l'opérateur doit faire, écrit une fois et rendu aux deux endroits qui en
# ont besoin (le refus de la production, et le mode diagnostic).
consigne_cle() {
  echo "  Ce qu'il faut faire :"
  echo "    TEESHOOP_SSH_HOTE=teeshoop-deploy ./scripts/deployer.sh ${1:-prod}"
  echo "  L'alias posé dans cette variable doit être celui de la CLÉ DE DÉPLOIEMENT,"
  echo "  c'est-à-dire celle qui est inscrite dans le ~/.ssh/authorized_keys du serveur avec"
  echo "    command=\"/home/dawe4500/deploiement.sh\",restrict"
  echo "  et non la clé de développement, qui ouvre un shell complet sur le compte."
  echo "  docs/DEPLOIEMENT.md §4 dit où elle vit et ce qu'elle peut lancer."
}

# ── LE MODE DIAGNOSTIC ──────────────────────────────────────────────────────
#
# Il ne déploie rien et ne peut rien envoyer : il pose la sonde et rend son
# verdict. Il existe pour deux raisons. D'abord parce qu'un opérateur qui reçoit
# le refus ci-dessous doit pouvoir vérifier sa correction sans relancer un
# déploiement. Ensuite parce que `scripts/deployer-sonde-cle-banc.sh` s'en sert
# pour éprouver la sonde avec un faux `ssh` : le banc exerce ainsi le code qui
# part vraiment, et non une copie qui pourrait diverger.
#
# Sortie : 0 restreinte · 2 tout le reste, « ouverte » comme « inconnue ».
if [ "$CIBLE" = "--sonde-cle" ]; then
  HOTE="${2:-$HOTE}"
  valider_hote "$HOTE"
  sonde_cle_restreinte "$HOTE"
  echo "alias   : $HOTE"
  echo "verdict : $SONDE_VERDICT"
  echo "sortie  : $SONDE_CODE"
  printf '%s\n' "$SONDE_SORTIE" | sed 's/^/  | /'
  [ "$SONDE_VERDICT" = "restreinte" ] || exit 2
  exit 0
fi

case "$CIBLE" in
  preprod|prod) ;;
  *) refus "usage : $0 preprod|prod   (ou $0 --sonde-cle [alias])" ;;
esac

command -v rsync   >/dev/null || refus "rsync est introuvable sur cette machine."
command -v node    >/dev/null || refus "node est introuvable sur cette machine."
command -v ssh     >/dev/null || refus "ssh est introuvable sur cette machine."
command -v timeout >/dev/null || refus "timeout est introuvable sur cette machine (coreutils)."

cd "$RACINE"

# ── 1. LA VERSION DE NODE, CONTRE .nvmrc ────────────────────────────────────
#
# POURQUOI ICI, ET PAS SEULEMENT DANS L'INTÉGRATION CONTINUE. Deux des portes qui
# décident si la production reçoit un fichier sont des programmes node :
# `pin-verify.mjs` (la cible a-t-elle bougé) et `launch-gate.mjs` (le portail de
# mise en ligne). Le travail de déploiement tourne sur un exécutant AUTO-HÉBERGÉ
# qui ne pose délibérément pas `setup-node` : « l'exécutant auto-hébergé a le sien,
# et une action qui installerait une autre version changerait celle du
# développeur ». Rien ne fixe donc la version de node dans le chemin qui déploie
# vraiment, et ces deux portes peuvent tourner sur une majeure qui n'est pas celle
# où elles ont été essayées.
#
# .nvmrc ABSENT REFUSE. Un contrôle qui se saute tout seul quand son fichier de
# référence manque ne sert à rien le jour où quelqu'un supprime le fichier :
# « rien regardé » n'est pas « rien trouvé » (CLAUDE.md §5).
#
# LA MAJEURE, ET ELLE SEULE. Même raisonnement que `pin-verify.mjs` tient pour PHP
# (« PHP on major.minor only, because a patch is not the class of change that
# breaks a plugin ») : un correctif de node ne casse pas un programme, une majeure
# le peut, et une règle stricte au correctif serait contournée dès le premier
# `nvm install`.
titre "Version de node"
if [ ! -f .nvmrc ]; then
  rouge "Le dépôt n'a pas de .nvmrc, donc ce contrôle n'a rien à comparer."
  echo  "  node fait tourner les deux portes qui décident si la production reçoit un fichier"
  echo  "  (scripts/pin-verify.mjs et scripts/launch-gate.mjs), et rien d'autre ne fixe sa"
  echo  "  version dans ce chemin : l'exécutant auto-hébergé n'utilise pas setup-node."
  echo  "  « Rien regardé » n'est pas « rien trouvé », donc ce script refuse au lieu de passer."
  echo  "  Ce qu'il faut faire : créer .nvmrc à la racine du dépôt avec la majeure attendue."
  echo  "  Celle de cette machine s'écrit ainsi, si c'est bien celle qu'on veut fixer :"
  echo  "    node --version | sed 's/^v//; s/[.].*//' > .nvmrc"
  echo  "  puis le commiter, pour que l'intégration continue et ce script parlent de la même."
  echo  "  Rien n'a été envoyé."
  exit 2
fi

# La première ligne utile : les commentaires et les espaces sont retirés, parce
# que .nvmrc est un fichier que nvm, fnm et volta lisent chacun à leur façon et
# qu'aucun d'eux n'interdit d'y écrire un commentaire.
NVMRC_BRUT=""
while IFS= read -r ligne || [ -n "$ligne" ]; do
  ligne="${ligne%%#*}"
  ligne="${ligne//[[:space:]]/}"
  if [ -n "$ligne" ]; then NVMRC_BRUT="$ligne"; break; fi
done < .nvmrc

NVMRC_MAJEURE="${NVMRC_BRUT#v}"
NVMRC_MAJEURE="${NVMRC_MAJEURE%%.*}"
if ! printf '%s' "$NVMRC_MAJEURE" | grep -qx '[0-9][0-9]*'; then
  rouge "Le .nvmrc de ce dépôt ne dit pas un numéro de version : « $NVMRC_BRUT »."
  echo  "  Ce contrôle compare des majeures. Un alias mouvant (« lts/iron », « node », « stable »)"
  echo  "  désigne une version différente selon le jour et selon la machine, ce qui est"
  echo  "  exactement ce qu'on cherche à empêcher ici."
  echo  "  Ce qu'il faut faire : écrire la majeure, par exemple « 22 », dans .nvmrc."
  echo  "  Rien n'a été envoyé."
  exit 2
fi

NODE_BRUT="$(node --version)"
NODE_MAJEURE="${NODE_BRUT#v}"
NODE_MAJEURE="${NODE_MAJEURE%%.*}"
if ! printf '%s' "$NODE_MAJEURE" | grep -qx '[0-9][0-9]*'; then
  refus "« node --version » a répondu « $NODE_BRUT », d'où aucune majeure ne se lit. Rien n'a été envoyé."
fi

if [ "$((10#$NVMRC_MAJEURE))" -ne "$((10#$NODE_MAJEURE))" ]; then
  rouge "La version de node de cette machine n'est pas celle que le dépôt fixe."
  echo  "  .nvmrc demande  : $NVMRC_BRUT   (majeure $NVMRC_MAJEURE)"
  echo  "  node répond     : $NODE_BRUT   (majeure $NODE_MAJEURE)"
  echo  "  Les deux portes qui décident si la production reçoit un fichier sont des programmes"
  echo  "  node, et elles n'ont pas été éprouvées sur cette majeure-là."
  echo  "  Ce qu'il faut faire : « nvm use » (ou « fnm use ») à la racine du dépôt, ce qui lit"
  echo  "  ce même .nvmrc. Si c'est le dépôt qui a du retard, changez .nvmrc dans un commit qui"
  echo  "  dit pourquoi, et faites tourner l'intégration continue dessus. Ne contournez pas."
  echo  "  Rien n'a été envoyé."
  exit 2
fi
vert "  node $NODE_BRUT, .nvmrc demande $NVMRC_BRUT : même majeure ($NODE_MAJEURE)"

# ── 2. L'ADRESSE DE CETTE MACHINE EST-ELLE AUTORISÉE ────────────────────────
#
# Posé avant tout ce qui parle au serveur, parce que c'est l'échec le plus
# probable et le plus déroutant : un délai dépassé sur le port 22 alors que le
# site répond en HTTPS ne ressemble pas à un problème d'autorisation.
#
# L'HÔTE ET LE PORT SONT DES COUTURES D'ESSAI, et le port en est une depuis le
# 05/09/2026 : sans lui, `scripts/deployer-sonde-cle-banc.sh` ne pouvait franchir ce
# bloc qu'en s'appuyant sur un sshd local écoutant sur 22, c'est-à-dire en ne
# passant que sur la machine du développeur. Un banc qui ne tourne qu'à un endroit
# n'est pas un banc.
titre "Accès au serveur"
SERVEUR_TCP="${TEESHOOP_SSH_HOST_TCP:-ascaphus.o2switch.net}"
port22() { timeout 15 bash -c "cat < /dev/null > /dev/tcp/${SERVEUR_TCP}/${TEESHOOP_SSH_PORT_TCP:-22}" 2>/dev/null; }

# L'ADRESSE S'AUTORISE ELLE-MÊME QUAND UN JETON cPanel EST FOURNI. Celle de
# l'exécutant est dynamique (176.191.78.140 le 05/09, 176.140.196.202 le 25/09),
# et chaque changement fermait le déploiement jusqu'à un passage dans cPanel.
# o2switch expose la même liste blanche en API, avec un jeton d'API cPanel :
# https://faq.o2switch.fr/cpanel/outils/exception-parefeu/ . Sans jeton, rien ne
# change et le test ci-dessous refuse comme avant. L'ajout prend une vingtaine de
# secondes à atteindre le pare-feu, d'où les nouvelles tentatives.
if [ -n "${O2SWITCH_CPANEL_TOKEN:-}" ] && [ -n "${O2SWITCH_USER:-}" ] && ! port22; then
  IP_ICI="$(curl -s -m 10 https://api.ipify.org || true)"
  if printf '%s' "$IP_ICI" | grep -Eqx '([0-9]{1,3}\.){3}[0-9]{1,3}'; then
    REPONSE="$(curl -s -m 45 -H "Authorization: cpanel ${O2SWITCH_USER}:${O2SWITCH_CPANEL_TOKEN}" \
      "https://${SERVEUR_TCP}:2083/execute/SshWhitelist/add?address=${IP_ICI}&port=22" || true)"
    if printf '%s' "$REPONSE" | grep -q '"status":1'; then
      vert "  $IP_ICI ajoutée à la liste blanche SSH d'o2switch"
      for _ in 1 2 3 4; do port22 && break; sleep 10; done
    else
      orange "  la liste blanche a refusé $IP_ICI : ${REPONSE:-aucune réponse} (cinq adresses au plus par compte)"
    fi
  else
    orange "  adresse publique de cette machine illisible, la liste blanche n'a pas été touchée"
  fi
fi

if ! port22; then
  rouge "Le port 22 de l'hébergeur ne répond pas depuis cette machine."
  echo   "  Le site, lui, répond en HTTPS : ce n'est donc pas l'hébergeur qui est en panne."
  echo   "  o2switch filtre SSH par adresse IP. Deux causes possibles :"
  echo   "    - cette adresse n'est pas autorisée : cPanel > Accès SSH > autoriser"
  echo   "      $(curl -s -m 10 https://api.ipify.org 2>/dev/null || echo '(adresse non déterminée)')"
  echo   "    - ou elle vient d'être bloquée après trop de connexions : attendre une heure."
  echo   "  Pour ne plus y revenir : un jeton d'API cPanel dans O2SWITCH_CPANEL_TOKEN (et le"
  echo   "  compte dans O2SWITCH_USER), et ce script autorise lui-même son adresse du moment."
  exit 2
fi
vert "  port 22 joignable"

# ── 3. LA CLÉ QUE CET ALIAS PRÉSENTE ────────────────────────────────────────
#
# Posé avant `pin-verify`, avant le portail et surtout avant le `rsync --delete` de
# l'étape 7 : c'est la question « qui suis-je pour ce serveur », et elle passe avant
# toutes les questions sur l'état du serveur.
#
# LA PRODUCTION REFUSE, LA PRÉPRODUCTION AVERTIT, et ce n'est pas de la mollesse.
# Ce que ce garde-fou protège est le compte qui porte 15 commandes réelles et
# 2 866 fichiers déposés par des clients ; la préproduction n'a ni les unes ni les
# autres (données anonymisées, voir docs/DEPLOIEMENT.md §5), et un refus dur sur
# l'environnement de répétition pousserait à poser TEESHOOP_SSH_HOTE au hasard pour
# pouvoir travailler. Un garde-fou qu'on contourne pour travailler finit par être
# retiré : c'est le raisonnement déjà écrit dans `scripts/deploiement.sh` à propos
# de `--stats`, et il vaut ici.
titre "Clé SSH utilisée"
sonde_cle_restreinte "$HOTE"
case "$SONDE_VERDICT" in
  restreinte)
    vert "  « $HOTE » porte une commande forcée : elle ne peut lancer que deploiement.sh"
    ;;

  ouverte)
    rouge "« $HOTE » ouvre un shell complet sur le compte : ce n'est pas la clé de déploiement."
    echo  "  Mesuré à l'instant : « ssh $HOTE whoami » est sorti $SONDE_CODE en disant :"
    # EN BLOC ET NON DANS LA PHRASE : le serveur préfixe la réponse d'une bannière
    # (au 05/09/2026, l'avertissement post-quantique d'OpenSSH), et une sortie de
    # plusieurs lignes glissée dans une phrase rend le message illisible.
    printf '%s\n' "$SONDE_SORTIE" | sed 's/^/    /'
    echo  "  La commande demandée a donc tourné pour de bon, et elle a rendu le nom du compte."
    echo  "  Sous la clé de déploiement, elle ne tourne pas : la commande forcée répond"
    echo  "  « verbe inconnu » et sort 2."
    echo  "  Avec cette clé-là, rien de ce qui protège le compte ne s'applique : ni la liste des"
    echo  "  huit verbes, ni l'aiguilleur rsync, ni les deux répertoires de dépôt. L'étape 7 est"
    echo  "  un « rsync -az --delete »."
    if [ "$CIBLE" = "prod" ]; then
      consigne_cle prod
      echo "  Rien n'a été envoyé."
      exit 2
    fi
    orange "  La préproduction continue quand même, et c'est délibéré : elle ne porte ni commande"
    orange "  réelle ni fichier de client. Corrigez-le tout de même, sinon la répétition n'exerce"
    orange "  pas le chemin que la production empruntera."
    consigne_cle preprod
    ;;

  inconnue)
    rouge "Impossible de savoir quelle clé « $HOTE » présente : la sonde n'a pas pu conclure."
    echo  "  « ssh $HOTE whoami » est sorti $SONDE_CODE en disant :"
    printf '%s\n' "$SONDE_SORTIE" | sed 's/^/    /'
    echo  "  « On n'a pas pu regarder » n'est pas « la clé est restreinte », donc ce verdict"
    echo  "  compte comme un refus et non comme un laissez-passer."
    echo  "  Causes habituelles : alias absent du ~/.ssh/config, fichier de clé introuvable ou"
    echo  "  mal protégé, clé d'hôte inconnue, ou authentification refusée par le serveur."
    if [ "$CIBLE" = "prod" ]; then
      consigne_cle prod
      echo "  Rien n'a été envoyé."
      exit 2
    fi
    orange "  La préproduction continue quand même : les étapes suivantes parlent au serveur avec"
    orange "  ce même alias et diront, elles, ce qui ne va pas."
    ;;
esac

# ── 4. LA CIBLE EST-ELLE CELLE QUE LE DÉPÔT SUPPOSE ─────────────────────────
titre "Version de la cible"
node scripts/pin-verify.mjs --cible="$CIBLE" --hote="$HOTE" || refus "la cible a bougé. Corrigez docs/versions-cibles.json dans un commit qui dit pourquoi, ne contournez pas."

# ── 5. LE PORTAIL, ET C'EST LA PORTE DE PUBLICATION QUI GARDE L'ENVOI ───────
#
# CE QUI A CHANGÉ LE 5 SEPTEMBRE 2026, ET POURQUOI. Le portail unique refusait la
# production sur vingt-sept motifs, dont treize lignes de registre que seul
# l'associé peut trancher. Un portail qu'on ne peut pas satisfaire n'est pas
# obéi, il est contourné, et un garde-fou contourné finit par être retiré.
#
# Il est donc devenu deux portes, et l'envoi de fichiers passe par celle qui
# correspond à ce qu'un envoi de fichiers met en jeu :
#
#   - `--porte=publication` garde CET envoi. Elle sort 0 et écrit la dette dans
#     docs/DETTE-LANCEMENT.md, datée, avec un propriétaire par ligne. Copier une
#     extension et un thème ne fait pas payer un client.
#   - `--porte=argent` garde L'ARGENT, et elle n'a pas de dérogation. Elle n'est
#     pas ici parce que ce n'est pas ici que l'argent passe : elle est appliquée
#     DANS WordPress, sur `woocommerce_available_payment_gateways` et à
#     l'enregistrement des réglages de passerelle, donc aucun moyen de paiement
#     ne peut être actif pendant qu'elle refuse, déployé ou pas.
#
# La décision, sa date et son auteur sont dans docs/decisions/.
if [ "$CIBLE" = "prod" ]; then
  titre "Portail de mise en ligne"
  if ! node scripts/launch-gate.mjs --porte=publication --boutique="deploy:$HOTE:prod"; then
    rouge "La porte de publication refuse. Rien n'a été envoyé."
    echo  "  Elle ne refuse que si elle n'a pas pu REGARDER : une boutique injoignable,"
    echo  "  un registre illisible. Ce n'est pas une condition de contenu, c'est une panne."
    exit 2
  fi
fi

# ── 6. LE POINT DE RETOUR ───────────────────────────────────────────────────
titre "Sauvegarde"
ssh "$HOTE" "./deploiement.sh sauvegarder $CIBLE" || echec "la sauvegarde a échoué, rien ne sera envoyé."

# ── 7. L'ENVOI ──────────────────────────────────────────────────────────────
#
# Les tests et le README ne partent pas : rien à l'exécution ne les lit, et
# wp-content/plugins est servi par URL.
#
# `--exclude` N'ARRIVE PAS SUR LA LIGNE DE COMMANDE DU SERVEUR, et c'est ce qui
# rend cet envoi compatible avec l'aiguilleur de `deploiement.sh`, dont la liste
# blanche refuse toute option longue qu'il ne nomme pas. Mesuré le 05/09/2026 avec
# un faux `-e`, sur cette invocation exacte, le serveur reçoit :
#   rsync --server -logDtprze.iLsfxCIvu --delete . teeshoop-deploiements/<env>/entrant/<composant>/
# les exclusions étant appliquées par l'émetteur et transmises comme règles de
# filtre dans le flux, jamais comme des arguments.
titre "Envoi"
rsync -az --delete --exclude '/tests/' --exclude '/README.md' \
  wp-plugins/teeshoop-core/ "$HOTE:teeshoop-deploiements/$CIBLE/entrant/teeshoop-core/"
rsync -az --delete \
  wp-themes/teeshoop/ "$HOTE:teeshoop-deploiements/$CIBLE/entrant/teeshoop/"
vert "  extension et thème déposés"

# ── 8. L'INSTALLATION ───────────────────────────────────────────────────────
titre "Installation"
ssh "$HOTE" "./deploiement.sh installer $CIBLE" || echec "l'installation a échoué. Le serveur a remis la livraison précédente ; vérifiez avec « ssh $HOTE './deploiement.sh etat $CIBLE' »."

# ── 9. CE QU'ON A OBTENU ────────────────────────────────────────────────────
titre "État"
ssh "$HOTE" "./deploiement.sh etat $CIBLE"

titre "Ce que le portail dit de $CIBLE"
# Informatif ici : pour la production il a déjà été posé en garde, plus haut.
node scripts/launch-gate.mjs --boutique="deploy:$HOTE:$CIBLE" || true

echo
vert "deployer: $CIBLE est à jour."
