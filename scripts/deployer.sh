#!/bin/bash
#
# Déployer Teeshoop sur WordPress, depuis une machine autorisée.
#
#   ./scripts/deployer.sh preprod
#   ./scripts/deployer.sh prod
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
#      rende « un push livre la préproduction » littéralement vrai. Elle demande
#      qu'une machine reste allumée et enregistrée auprès de GitHub ;
#   2. **piloter le déploiement depuis une machine autorisée**, avec ce script,
#      qui exécute la même séquence dans le même ordre et avec les mêmes portes ;
#   3. ouvrir SSH à des plages entières d'un fournisseur de nuage, ce qui revient
#      à retirer le filtre. Non.
#
# Ce que GitHub garde et qui n'est pas rien : toute la vérification. `ci.yml`
# tourne à chaque poussée, sur deux versions de PHP, et le travail de déploiement
# refuse proprement au lieu de faire semblant.
#
# ── CE QU'IL FAIT, DANS CET ORDRE ───────────────────────────────────────────
#
#   1. la cible est-elle la version que le dépôt suppose      (refuse sinon)
#   2. pour la PRODUCTION seulement : le portail de mise en ligne (refuse sinon)
#   3. une sauvegarde, avant de toucher quoi que ce soit
#   4. l'extension et le thème, vers un dépôt d'attente
#   5. l'installation : analyse avec le PHP du serveur, échange, activation,
#      migration, sonde, et retour arrière automatique si l'une échoue
#   6. l'état, puis ce que le portail dit de la cible
#
# Sortie : 0 déployé · 1 une étape a échoué · 2 refus avant tout envoi.

set -euo pipefail

CIBLE="${1:-}"
HOTE="${TEESHOOP_SSH_HOTE:-teeshoop}"
RACINE="$(cd "$(dirname "$0")/.." && pwd)"

rouge() { printf '\033[31m%s\033[0m\n' "$*"; }
vert()  { printf '\033[32m%s\033[0m\n' "$*"; }
titre() { printf '\n\033[1m── %s\033[0m\n' "$*"; }

refus() { rouge "deployer: $*"; exit 2; }
echec() { rouge "deployer: $*"; exit 1; }

case "$CIBLE" in
  preprod|prod) ;;
  *) refus "usage : $0 preprod|prod" ;;
esac

command -v rsync >/dev/null || refus "rsync est introuvable sur cette machine."
command -v node  >/dev/null || refus "node est introuvable sur cette machine."

cd "$RACINE"

# ── 0. L'ADRESSE DE CETTE MACHINE EST-ELLE AUTORISÉE ────────────────────────
#
# Posé en premier et séparément du reste, parce que c'est l'échec le plus
# probable et le plus déroutant : un délai dépassé sur le port 22 alors que le
# site répond en HTTPS ne ressemble pas à un problème d'autorisation.
titre "Accès au serveur"
if ! timeout 15 bash -c "cat < /dev/null > /dev/tcp/${TEESHOOP_SSH_HOST_TCP:-ascaphus.o2switch.net}/22" 2>/dev/null; then
  rouge "Le port 22 de l'hébergeur ne répond pas depuis cette machine."
  echo   "  Le site, lui, répond en HTTPS : ce n'est donc pas l'hébergeur qui est en panne."
  echo   "  o2switch filtre SSH par adresse IP. Deux causes possibles :"
  echo   "    - cette adresse n'est pas autorisée : cPanel > Accès SSH > autoriser"
  echo   "      $(curl -s -m 10 https://api.ipify.org 2>/dev/null || echo '(adresse non déterminée)')"
  echo   "    - ou elle vient d'être bloquée après trop de connexions : attendre une heure."
  exit 2
fi
vert "  port 22 joignable"

# ── 1. LA CIBLE EST-ELLE CELLE QUE LE DÉPÔT SUPPOSE ─────────────────────────
titre "Version de la cible"
node scripts/pin-verify.mjs --cible="$CIBLE" --hote="$HOTE" || refus "la cible a bougé. Corrigez docs/versions-cibles.json dans un commit qui dit pourquoi, ne contournez pas."

# ── 2. LE PORTAIL, ET IL N'A PAS DE DÉROGATION ──────────────────────────────
if [ "$CIBLE" = "prod" ]; then
  titre "Portail de mise en ligne"
  if ! node scripts/launch-gate.mjs --boutique="deploy:$HOTE:prod"; then
    rouge "Le portail refuse. Rien n'a été envoyé."
    echo  "  Ce n'est pas une panne : c'est la règle du 18 août 2026, et elle n'a pas d'exception."
    echo  "  Ce qu'il faut faire est écrit dans docs/MISE-EN-LIGNE.md, condition par condition."
    exit 2
  fi
fi

# ── 3. LE POINT DE RETOUR ───────────────────────────────────────────────────
titre "Sauvegarde"
ssh "$HOTE" "./deploiement.sh sauvegarder $CIBLE" || echec "la sauvegarde a échoué, rien ne sera envoyé."

# ── 4. L'ENVOI ──────────────────────────────────────────────────────────────
#
# Les tests et le README ne partent pas : rien à l'exécution ne les lit, et
# wp-content/plugins est servi par URL.
titre "Envoi"
rsync -az --delete --exclude '/tests/' --exclude '/README.md' \
  wp-plugins/teeshoop-core/ "$HOTE:teeshoop-deploiements/$CIBLE/entrant/teeshoop-core/"
rsync -az --delete \
  wp-themes/teeshoop/ "$HOTE:teeshoop-deploiements/$CIBLE/entrant/teeshoop/"
vert "  extension et thème déposés"

# ── 5. L'INSTALLATION ───────────────────────────────────────────────────────
titre "Installation"
ssh "$HOTE" "./deploiement.sh installer $CIBLE" || echec "l'installation a échoué. Le serveur a remis la livraison précédente ; vérifiez avec « ssh $HOTE './deploiement.sh etat $CIBLE' »."

# ── 6. CE QU'ON A OBTENU ────────────────────────────────────────────────────
titre "État"
ssh "$HOTE" "./deploiement.sh etat $CIBLE"

titre "Ce que le portail dit de $CIBLE"
# Informatif ici : pour la production il a déjà été posé en garde, plus haut.
node scripts/launch-gate.mjs --boutique="deploy:$HOTE:$CIBLE" || true

vert "\ndeployer: $CIBLE est à jour."
