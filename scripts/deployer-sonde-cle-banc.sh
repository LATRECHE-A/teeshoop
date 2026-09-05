#!/bin/bash
#
# Banc d'essai de deux gardes de `scripts/deployer.sh` :
#
#   - la sonde qui affirme que l'alias SSH utilisé porte une commande forcée ;
#   - le contrôle de la version de node contre `.nvmrc`.
#
#   ./scripts/deployer-sonde-cle-banc.sh
#
# ── POURQUOI UN BANC, ET PAS UN ESSAI CONTRE LE VRAI SERVEUR ────────────────
#
# Les trois verdicts de la sonde demandent trois serveurs différents : un qui
# porte la commande forcée, un qui ouvre un shell, et un qui ne répond pas. On
# n'en a qu'un, et deux de ces trois états ne doivent jamais exister en vrai. Un
# faux `ssh` posé devant sur le PATH les rend tous les trois, à la demande.
#
# ── CE QUI EST EXERCÉ EST LE CODE QUI PART ──────────────────────────────────
#
# Le banc n'a pas de copie de la sonde. Il fabrique un bac à sable dont
# `scripts/deployer.sh` est un LIEN vers le vrai fichier : `$0` pointe donc dans
# le bac à sable, `RACINE` s'y résout, et c'est bien le fichier livré qui tourne.
# Vérifier un écrivain avec son propre lecteur ne prouve que sa cohérence avec
# lui-même (CLAUDE.md §5), et une copie de la sonde dans ce fichier aurait fini
# par diverger de l'originale sans que rien ne l'annonce.
#
# ── CE QUI EST MESURÉ, ET NON SUPPOSÉ ───────────────────────────────────────
#
#   - `rsync` est remplacé, dans le bac à sable, par un programme qui hurle et
#     sort 99. « Rien n'a été envoyé » devient donc une mesure et non une phrase :
#     si un jour un chemin atteignait l'étape 7, ce banc virerait au rouge ;
#   - la phrase de refus attendue du serveur est comparée à celle qui est
#     réellement écrite dans `scripts/deploiement.sh`. Si le serveur change son
#     texte, le faux `ssh` devient un mensonge, et ce banc le dit.
#
# Sortie : 0 tout est vert · 1 au moins un cas est faux · 2 le banc n'a rien exercé.

set -uo pipefail

RACINE="$(cd "$(dirname "$0")/.." && pwd)"
BANC="$(mktemp -d)"
trap 'rm -rf "$BANC"' EXIT

rouge() { printf '\033[31m%s\033[0m\n' "$*"; }
vert()  { printf '\033[32m%s\033[0m\n' "$*"; }
titre() { printf '\n\033[1m── %s\033[0m\n' "$*"; }

CAS=0
ECHECS=0

verifier() {
  local libelle="$1" attendu="$2" obtenu="$3"
  CAS=$(( CAS + 1 ))
  if [ "$attendu" = "$obtenu" ]; then
    vert "  ok     $libelle"
  else
    rouge "  ECHEC  $libelle"
    printf '    attendu : %s\n' "$attendu"
    printf '    obtenu  : %s\n' "$obtenu"
    ECHECS=$(( ECHECS + 1 ))
  fi
}

contient() {
  local libelle="$1" aiguille="$2" botte="$3"
  CAS=$(( CAS + 1 ))
  if printf '%s' "$botte" | grep -qF "$aiguille"; then
    vert "  ok     $libelle"
  else
    rouge "  ECHEC  $libelle"
    printf '    introuvable : %s\n' "$aiguille"
    printf '    dans :\n%s\n' "$botte" | sed 's/^/      /'
    ECHECS=$(( ECHECS + 1 ))
  fi
}

absent_de() {
  local libelle="$1" aiguille="$2" botte="$3"
  CAS=$(( CAS + 1 ))
  if printf '%s' "$botte" | grep -qF "$aiguille"; then
    rouge "  ECHEC  $libelle"
    printf '    présent alors qu%s ne devrait pas : %s\n' "'il" "$aiguille"
    ECHECS=$(( ECHECS + 1 ))
  else
    vert "  ok     $libelle"
  fi
}

# ── La phrase que le serveur rend vraiment ──────────────────────────────────
#
# Le faux `ssh` doit rendre CE texte-là et pas un texte plausible, sinon le banc
# éprouve une signature que la sonde ne rencontrera jamais.
REFUS_SERVEUR='verbe inconnu'
titre "Le faux ssh dit-il ce que le vrai serveur dit"
contient "scripts/deploiement.sh refuse bien par « $REFUS_SERVEUR »" \
  "refus \"$REFUS_SERVEUR" "$(cat "$RACINE/scripts/deploiement.sh")"

# ── Le bac à sable ──────────────────────────────────────────────────────────
mkdir -p "$BANC/scripts" "$BANC/bin"
ln -s "$RACINE/scripts/deployer.sh" "$BANC/scripts/deployer.sh"

# Un faux pin-verify : il refuse, ce qui arrête la séquence juste APRÈS le bloc
# de la clé. Atteindre ce message prouve que le bloc de la clé a laissé passer.
cat > "$BANC/scripts/pin-verify.mjs" <<'EOF'
console.error('pin-verify (bouchon du banc) : on ne parle pas au vrai serveur ici.')
process.exit(1)
EOF

cat > "$BANC/bin/rsync" <<'EOF'
#!/bin/bash
echo "BANC: rsync A ETE APPELE, ce qui veut dire que quelque chose est parti." >&2
printf '  argv: %s\n' "$*" >&2
exit 99
EOF
chmod +x "$BANC/bin/rsync"

cat > "$BANC/bin/ssh" <<EOF
#!/bin/bash
# Faux ssh du banc. FAUX_SSH_MODE choisit lequel des trois serveurs il imite.
case "\${FAUX_SSH_MODE:-}" in
  restreinte)
    # Ce que rend « ssh teeshoop-deploy whoami » quand la clé porte
    # command="/home/dawe4500/deploiement.sh" : whoami ne tourne pas, le script
    # forcé tourne à sa place, ne connaît pas ce verbe, et sort 2.
    echo "deploiement: $REFUS_SERVEUR « whoami » (attendus : etat, verifier, installer, retour, sauvegarder, verdict, versions)" >&2
    exit 2
    ;;
  ouverte)
    # Ce que rend la clé de développement : la commande demandée s'exécute.
    echo "dawe4500"
    exit 0
    ;;
  reseau)
    echo "ssh: connect to host ascaphus.o2switch.net port 22: Connection timed out" >&2
    exit 255
    ;;
  *)
    echo "banc: FAUX_SSH_MODE non posé" >&2
    exit 250
    ;;
esac
EOF
chmod +x "$BANC/bin/ssh"

# ── FRANCHIR LE BLOC « ACCÈS AU SERVEUR » SANS DÉPENDRE DE LA MACHINE ───────
#
# Ce banc n'éprouve pas ce bloc-là, il a seulement besoin de le traverser. Il
# écoutait d'abord sur le sshd local du port 22, ce qui le rendait vert sur la
# machine du développeur et rouge partout ailleurs. Il ouvre maintenant son propre
# écouteur sur un port libre, et le dit au script par la couture prévue pour ça.
# Le tuyau nommé sert de rendez-vous : `read` attend que node ait vraiment ouvert
# le port, donc il n'y a rien à temporiser.
FIFO="$BANC/port.fifo"
mkfifo "$FIFO"
node -e '
  const net = require("net"), fs = require("fs")
  const s = net.createServer((c) => c.destroy())
  s.listen(0, "127.0.0.1", () => fs.writeFileSync(process.argv[1], s.address().port + "\n"))
' "$FIFO" &
ECOUTEUR=$!
trap 'kill "$ECOUTEUR" 2>/dev/null; rm -rf "$BANC"' EXIT
read -r PORT_ECOUTE < "$FIFO"

export TEESHOOP_SSH_HOST_TCP=127.0.0.1
export TEESHOOP_SSH_PORT_TCP="$PORT_ECOUTE"
export PATH="$BANC/bin:$PATH"

NODE_MAJEURE="$(node --version | sed 's/^v//; s/[.].*//')"
printf '%s\n' "$NODE_MAJEURE" > "$BANC/.nvmrc"

lancer() { # mode, arguments…
  local mode="$1"; shift
  FAUX_SSH_MODE="$mode" "$BANC/scripts/deployer.sh" "$@" 2>&1
}
code_de() { # mode, arguments…
  local mode="$1"; shift
  FAUX_SSH_MODE="$mode" "$BANC/scripts/deployer.sh" "$@" > /dev/null 2>&1
  echo $?
}

# ── 1. LA SONDE, ISOLÉE ─────────────────────────────────────────────────────
titre "1. La sonde seule, contre les trois serveurs"

S="$(lancer restreinte --sonde-cle teeshoop-deploy)"
contient "clé restreinte : verdict « restreinte »" "verdict : restreinte" "$S"
verifier "clé restreinte : sortie 0"  "0" "$(code_de restreinte --sonde-cle teeshoop-deploy)"

S="$(lancer ouverte --sonde-cle teeshoop)"
contient "clé non restreinte : verdict « ouverte »" "verdict : ouverte" "$S"
contient "clé non restreinte : le nom du compte est rendu" "dawe4500" "$S"
verifier "clé non restreinte : sortie 2" "2" "$(code_de ouverte --sonde-cle teeshoop)"

S="$(lancer reseau --sonde-cle teeshoop-deploy)"
contient "panne réseau : verdict « inconnue »" "verdict : inconnue" "$S"
contient "panne réseau : la raison est rendue telle quelle" "Connection timed out" "$S"
verifier "panne réseau : sortie 2" "2" "$(code_de reseau --sonde-cle teeshoop-deploy)"

# ── 2. CE QUE LA PRODUCTION EN FAIT ─────────────────────────────────────────
titre "2. La production refuse tout ce qui n'est pas « restreinte »"

S="$(lancer ouverte prod)"
contient "prod + clé non restreinte : refus nommé" "ouvre un shell complet sur le compte" "$S"
contient "prod + clé non restreinte : la consigne nomme la variable" "TEESHOOP_SSH_HOTE=teeshoop-deploy" "$S"
contient "prod + clé non restreinte : la consigne nomme la commande forcée" 'command="/home/dawe4500/deploiement.sh",restrict' "$S"
contient "prod + clé non restreinte : rien n'a été envoyé" "Rien n'a été envoyé" "$S"
absent_de "prod + clé non restreinte : la séquence n'atteint pas la cible" "Version de la cible" "$S"
absent_de "prod + clé non restreinte : rsync n'a pas été appelé" "rsync A ETE APPELE" "$S"
verifier "prod + clé non restreinte : sortie 2" "2" "$(code_de ouverte prod)"

S="$(lancer reseau prod)"
contient "prod + sonde muette : refus nommé" "n'a pas pu conclure" "$S"
contient "prod + sonde muette : « on n'a pas pu regarder » est dit" "n'est pas « la clé est restreinte »" "$S"
absent_de "prod + sonde muette : rsync n'a pas été appelé" "rsync A ETE APPELE" "$S"
verifier "prod + sonde muette : sortie 2" "2" "$(code_de reseau prod)"

# UNE PORTE QUI REFUSE TOUJOURS N'EST PAS UNE PORTE : la bonne clé doit passer.
S="$(lancer restreinte prod)"
contient "prod + clé restreinte : la sonde conclut" "porte une commande forcée" "$S"
contient "prod + clé restreinte : la séquence continue jusqu'à la cible" "bouchon du banc" "$S"

# ── 3. CE QUE LA PRÉPRODUCTION EN FAIT ──────────────────────────────────────
titre "3. La préproduction avertit et continue"

S="$(lancer ouverte preprod)"
contient "preprod + clé non restreinte : l'avertissement est là" "ouvre un shell complet sur le compte" "$S"
contient "preprod + clé non restreinte : et il dit pourquoi on continue" "continue quand même" "$S"
contient "preprod + clé non restreinte : la séquence continue jusqu'à la cible" "bouchon du banc" "$S"

S="$(lancer reseau preprod)"
contient "preprod + sonde muette : la séquence continue aussi" "bouchon du banc" "$S"

# ── 4. LA VERSION DE NODE CONTRE .nvmrc ─────────────────────────────────────
titre "4. node contre .nvmrc"

S="$(lancer restreinte prod)"
contient ".nvmrc d'accord : la majeure est nommée" "même majeure ($NODE_MAJEURE)" "$S"

mv "$BANC/.nvmrc" "$BANC/.nvmrc.range"
S="$(lancer restreinte prod)"
contient ".nvmrc absent : refus" "n'a pas de .nvmrc" "$S"
contient ".nvmrc absent : « rien regardé » est dit" "Rien regardé" "$S"
absent_de ".nvmrc absent : rsync n'a pas été appelé" "rsync A ETE APPELE" "$S"
verifier ".nvmrc absent : sortie 2" "2" "$(code_de restreinte prod)"
mv "$BANC/.nvmrc.range" "$BANC/.nvmrc"

printf '%s\n' "$(( NODE_MAJEURE + 1 ))" > "$BANC/.nvmrc"
S="$(lancer restreinte prod)"
contient "majeure différente : refus" "n'est pas celle que le dépôt fixe" "$S"
contient "majeure différente : les deux versions sont rendues" "majeure $(( NODE_MAJEURE + 1 ))" "$S"
absent_de "majeure différente : rsync n'a pas été appelé" "rsync A ETE APPELE" "$S"
verifier "majeure différente : sortie 2" "2" "$(code_de restreinte prod)"

printf 'lts/iron\n' > "$BANC/.nvmrc"
S="$(lancer restreinte prod)"
contient "alias mouvant : refus" "ne dit pas un numéro de version" "$S"
verifier "alias mouvant : sortie 2" "2" "$(code_de restreinte prod)"

# Un fichier vide, et un fichier qui n'a qu'un commentaire : « rien lu » doit
# refuser comme « rien trouvé », pas passer parce que la boucle n'a rien vu.
: > "$BANC/.nvmrc"
S="$(lancer restreinte prod)"
contient ".nvmrc vide : refus" "ne dit pas un numéro de version" "$S"
verifier ".nvmrc vide : sortie 2" "2" "$(code_de restreinte prod)"

printf '# rien que ce commentaire\n' > "$BANC/.nvmrc"
S="$(lancer restreinte prod)"
contient ".nvmrc sans autre chose qu'un commentaire : refus" "ne dit pas un numéro de version" "$S"
verifier ".nvmrc sans autre chose qu'un commentaire : sortie 2" "2" "$(code_de restreinte prod)"

# Une forme complète et un commentaire : acceptés, comparés sur la majeure.
printf '# posé par la séance 15\nv%s.1.0\n' "$NODE_MAJEURE" > "$BANC/.nvmrc"
S="$(lancer restreinte prod)"
contient "forme « v$NODE_MAJEURE.1.0 » et commentaire : acceptés" "même majeure ($NODE_MAJEURE)" "$S"

printf '%s\n' "$NODE_MAJEURE" > "$BANC/.nvmrc"

# ── 5. L'ALIAS EST TENU AVANT D'ATTEINDRE ssh ───────────────────────────────
#
# `ssh` n'a pas de `--` : un alias qui commence par un tiret devient une option.
titre "5. L'alias passé à ssh"

S="$(FAUX_SSH_MODE=ouverte TEESHOOP_SSH_HOTE='-oProxyCommand=id' "$BANC/scripts/deployer.sh" prod 2>&1)"
contient "alias commençant par un tiret : refusé" "commence par un tiret" "$S"
absent_de "alias commençant par un tiret : ssh n'a jamais été appelé" "dawe4500" "$S"

S="$(FAUX_SSH_MODE=ouverte TEESHOOP_SSH_HOTE='hote;id' "$BANC/scripts/deployer.sh" prod 2>&1)"
contient "alias avec un caractère refusé : refusé" "refuse de passer à ssh" "$S"

# LA MÊME PORTE, PAR L'AUTRE ENTRÉE. L'alias arrive aussi par le second argument du
# mode diagnostic, qui écrasait la valeur déjà contrôlée.
S="$(FAUX_SSH_MODE=ouverte "$BANC/scripts/deployer.sh" --sonde-cle '-oProxyCommand=id' 2>&1)"
contient "diagnostic : l'alias en argument est tenu aussi" "commence par un tiret" "$S"
absent_de "diagnostic : ssh n'a jamais été appelé" "dawe4500" "$S"
verifier "diagnostic : sortie 2" "2" "$(FAUX_SSH_MODE=ouverte "$BANC/scripts/deployer.sh" --sonde-cle '-oProxyCommand=id' >/dev/null 2>&1; echo $?)"

# ── Le verdict ──────────────────────────────────────────────────────────────
titre "Verdict"
if [ "$CAS" -eq 0 ]; then
  rouge "banc: aucun cas n'a été exercé. « Rien trouvé » n'est pas « rien regardé »."
  exit 2
fi
if [ "$ECHECS" -gt 0 ]; then
  rouge "banc: $ECHECS cas faux sur $CAS."
  exit 1
fi
vert "banc: $CAS cas, tous justes."
