#!/bin/bash
#
# Le second canal, éprouvé contre un vrai serveur HTTP.
#
# Il vaut d'être un harnais plutôt qu'une ligne de transcription : c'est le canal
# qui doit encore parler le jour où le premier se tait, donc c'est celui qu'il
# faut pouvoir réessayer après chaque changement. Il vérifie trois familles de
# choses :
#
#   1. LES REFUS. Fichier absent, droits trop ouverts, URL sans https, URL qui
#      contient de quoi injecter une option dans la configuration de curl. Un
#      refus sort en 2, jamais en 0 : « pas armé » n'est pas « envoyé ».
#   2. L'ENVOI. Le corps reçu par le tiers est du JSON, il porte `text` et
#      `content`, et un 500 ou un port fermé sortent en 1.
#   3. QUE L'URL NE FUIT PAS. Elle n'apparaît ni sur la sortie standard, ni sur
#      la sortie d'erreur, d'aucun des cas ci-dessus. C'est une capacité : qui
#      la détient peut écrire dans le canal d'alerte de la boutique.
#
# Le récepteur est un serveur HTTP en node, parce que node est déjà une
# dépendance de ce dépôt. L'URL de bouclage locale est le seul `http://` que le
# code accepte, et il le dit à chaque fois.
#
# Sortie 0 si tous les cas passent, 1 sinon, 2 si le harnais n'a rien pu tester.

set -uo pipefail

ICI="$(cd "$(dirname "$0")" && pwd)"
SOUS_TEST="$ICI/battement.sh"
[ -x "$SOUS_TEST" ] || { echo "essai: $SOUS_TEST est introuvable ou non exécutable." >&2; exit 2; }
command -v node >/dev/null || { echo "essai: node est introuvable, le récepteur ne peut pas démarrer." >&2; exit 2; }

BAC=$(mktemp -d) || { echo "essai: pas de répertoire temporaire." >&2; exit 2; }
PORT=${BATTEMENT_ESSAI_PORT:-8894}
RECU="$BAC/recu.jsonl"
CODE="$BAC/code"
NODE_PID=""
nettoyer() { [ -n "$NODE_PID" ] && kill "$NODE_PID" 2>/dev/null; rm -rf "$BAC"; }
trap nettoyer EXIT

echo 200 > "$CODE"
node -e '
const http = require("http"), fs = require("fs");
const [recu, code, port] = process.argv.slice(1);
http.createServer((req, res) => {
  let corps = "";
  req.on("data", (d) => { corps += d; });
  req.on("end", () => {
    let c = 200;
    try { c = parseInt(fs.readFileSync(code, "utf8").trim(), 10) || 200; } catch {}
    fs.appendFileSync(recu, JSON.stringify({ chemin: req.url, ct: req.headers["content-type"], corps }) + "\n");
    res.writeHead(c, { "Content-Length": 2 });
    res.end("ok");
  });
}).listen(parseInt(port, 10), "127.0.0.1");
' "$RECU" "$CODE" "$PORT" &
NODE_PID=$!

# Attendre que le récepteur écoute, sans dormir un temps deviné.
PRET=0
for _ in $(seq 1 50); do
  if curl -s -o /dev/null -m 1 -X POST -d '{}' "http://127.0.0.1:$PORT/pret" 2>/dev/null; then PRET=1; break; fi
  sleep 0.1
done
[ "$PRET" -eq 1 ] || { echo "essai: le récepteur n'écoute pas sur 127.0.0.1:$PORT." >&2; exit 2; }
: > "$RECU"

CONF="$BAC/conf"; ETAT="$BAC/etat"
mkdir -p "$CONF" "$ETAT"
URL_VRAIE="http://127.0.0.1:$PORT/battement"

PASSES=0; ECHECS=0
FUITES=0

# rm avant écriture : un cas précédent a pu poser le fichier en 400, et un
# fichier en lecture seule ne se réécrit pas.
poser() { rm -f "$CONF/$1"; printf '%s\n' "$2" > "$CONF/$1"; chmod "$3" "$CONF/$1"; }

cas() {
  local titre="$1" attendu="$2"; shift 2
  local sortie code
  # Le corps arrive toujours sur l'entrée standard : sans cela, le cas de
  # l'alerte lirait le terminal et le harnais resterait suspendu.
  sortie=$( printf '%s\n' "corps d essai" | "$SOUS_TEST" --config="$CONF" --etat-dir="$ETAT" "$@" 2>&1 )
  code=$?
  # L'URL NE DOIT JAMAIS APPARAÎTRE. Le chemin la rendrait reconnaissable même
  # tronquée, donc on cherche la partie qui identifie le tiers.
  if printf '%s' "$sortie" | grep -q "127.0.0.1:$PORT"; then
    FUITES=$((FUITES + 1))
    printf '  FUITE %-44s l URL apparaît dans la sortie\n' "$titre"
  fi
  if [ "$code" -eq "$attendu" ]; then
    PASSES=$((PASSES + 1)); printf '  ok    %-44s sortie %d\n' "$titre" "$code"
  else
    ECHECS=$((ECHECS + 1)); printf '  ECHEC %-44s sortie %d, attendu %d : %s\n' "$titre" "$code" "$attendu" "$(printf '%s' "$sortie" | head -1)"
  fi
}

echo "battement-essai : le second canal, cas par cas"

cas "canal non armé"                        2
poser battement-url "$URL_VRAIE" 644
cas "droits 644"                            2
poser battement-url "$URL_VRAIE" 640
cas "droits 640"                            2
poser battement-url "http://exemple.fr/w" 600
cas "http hors boucle locale"               2
poser battement-url 'https://exemple.fr/w" -o /tmp/vole "' 600
cas "injection d une option curl"           2
poser battement-url "" 600
cas "fichier vide"                          2
poser battement-url "$URL_VRAIE" 400
cas "droits 400, strictement plus fermés"   0 --etat=ok
poser battement-url "$URL_VRAIE" 600
cas "droits 600, le battement part"         0 --etat=ok --detail="12 contrôles"
echo 500 > "$CODE"
cas "le tiers répond 500"                   1 --etat=ok
echo 200 > "$CODE"
poser battement-url "http://127.0.0.1:1/mort" 600
cas "le tiers ne répond pas"                1 --etat=ok
poser battement-url "$URL_VRAIE" 600
cas "l alerte non armée"                    2 --canal=alerte --sujet="[Teeshoop] essai"
poser alerte-webhook "http://127.0.0.1:$PORT/alerte" 600
cas "l alerte, corps sur stdin"             0 --canal=alerte --sujet="[Teeshoop] essai"
cas "l âge du dernier battement"            0 --verifier --max-min=30
echo "0" > "$ETAT/battement-dernier"
cas "battement trop vieux"                  1 --verifier --max-min=30
rm -f "$ETAT/battement-dernier"
cas "aucun battement encore accepté"        1 --verifier

# ── ce que le tiers a réellement reçu ───────────────────────────────────────
VERIFS=$(node -e '
const fs = require("fs");
const lignes = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").filter(Boolean);
let ok = 0, ko = [];
if (lignes.length < 4) ko.push("moins de trois requêtes reçues (" + lignes.length + ")");
for (const l of lignes) {
  const r = JSON.parse(l);
  if (r.ct !== "application/json") { ko.push("content-type " + r.ct); continue; }
  let c;
  try { c = JSON.parse(r.corps); } catch (e) { ko.push("corps illisible : " + e.message); continue; }
  for (const k of ["source", "role", "horodatage", "hote", "etat", "sujet", "text", "content"]) {
    if (!(k in c)) { ko.push("clé absente : " + k); }
  }
  if (c.text !== c.content) ko.push("text et content diffèrent");
  ok++;
}
console.log(JSON.stringify({ ok, ko }));
' "$RECU")
echo "  ---"
echo "  corps reçus : $VERIFS"
if printf '%s' "$VERIFS" | grep -q '"ko":\[\]'; then
  PASSES=$((PASSES + 1)); printf '  ok    %-44s\n' "les corps reçus sont du JSON conforme"
else
  ECHECS=$((ECHECS + 1)); printf '  ECHEC %-44s\n' "les corps reçus ne sont pas conformes"
fi

ATTENDUS=16
echo "  $PASSES cas verts, $ECHECS rouges, $FUITES fuites, sur $ATTENDUS attendus"

# UN HARNAIS QUI NE TESTE RIEN NE DOIT PAS ÊTRE VERT.
if [ $((PASSES + ECHECS)) -ne "$ATTENDUS" ]; then
  echo "battement-essai: $((PASSES + ECHECS)) cas exécutés au lieu de $ATTENDUS." >&2
  exit 2
fi
[ "$ECHECS" -eq 0 ] && [ "$FUITES" -eq 0 ] || exit 1
exit 0
