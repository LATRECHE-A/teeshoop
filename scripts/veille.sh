#!/bin/bash
#
# La veille : ce pour quoi il vaut la peine d'être réveillé, et rien d'autre.
#
#   ./veille.sh --dest=quelquun@exemple.fr [--racine=~/public_html] [--boutique=https://…]
#   ./veille.sh --dest=… --etat                 n'alerte pas, affiche l'état
#
# ─────────────────────────────────────────────────────────────────────────────
# LA RÈGLE QUI DÉCIDE DE TOUT LE RESTE : UNE ALERTE À LAQUELLE PERSONNE NE CROIT
# EST PIRE QUE PAS D'ALERTE.
#
# Deux conséquences, et elles sont dans le code :
#
#   ON N'ALERTE QUE SUR UN CHANGEMENT D'ÉTAT. Un problème qui dure envoie UN
#   message, pas un toutes les dix minutes. Et le retour à la normale en envoie
#   un aussi, parce qu'une alerte sans fin de crise oblige à aller vérifier à la
#   main, ce qui est exactement le travail qu'elle devait éviter.
#
#   ON N'ALERTE QUE SUR CE QUI COÛTE. Une page lente ne réveille personne. Une
#   boutique qui ne répond pas, un paiement encaissé sans facture, un bon à tirer
#   qui n'est jamais parti, un achat fournisseur bloqué et un disque plein, oui :
#   chacun de ces cinq laisse une commande en plan ou de l'argent dans le vide.
#
# ─────────────────────────────────────────────────────────────────────────────
# CE QUI EST SURVEILLÉ, ET POURQUOI CHACUN
#
#   la boutique répond       une boutique hors ligne ne vend pas. Deux échecs de
#                            suite avant d'alerter : un timeout isolé sur du
#                            mutualisé n'est pas une panne.
#   le studio répond         sans lui la personnalisation est morte et la fiche
#                            produit montre un cadre vide.
#   le disque                un disque plein met le site hors ligne ET empêche la
#                            sauvegarde, donc la panne et son filet tombent
#                            ensemble.
#   la sauvegarde est        une sauvegarde qui a cessé de tourner ne se remarque
#   fraîche                  que le jour où on en a besoin.
#   les 5xx                  une erreur serveur qui se répète est une commande
#                            qu'un client n'a pas pu passer.
#   côté WordPress           un paiement sans facture, un bon à tirer en échec,
#                            un achat fournisseur resté en « envoi incertain ».
#                            Ces trois-là ne se voient nulle part ailleurs.
#
# L'ACHAT EN « ENVOI INCERTAIN » vient de la séance 08 et rien ne l'avait jamais
# surveillé : l'état se résout tout seul depuis « envoi en cours » au bout de
# cinq minutes, mais à partir de là il attend qu'un humain demande au fournisseur
# lequel des deux cas s'est produit. Un achat qui y reste est une série qui ne
# part pas, et personne ne le sait.
#
# Sortie : 0 tout va bien, 1 au moins un problème, 2 la veille elle-même n'a pas
# pu fonctionner (ce qui est un problème, pas un succès).

set -uo pipefail

DEST=""
RACINE="$HOME/public_html"
BOUTIQUE=""
STUDIO=""
ETAT_SEUL=0
ETAT_DIR="$HOME/.teeshoop-veille"
SAUVEGARDES="$HOME/sauvegardes"
# LE MÊME PIÈGE QUE DANS sauvegarde.sh, ET IL A COÛTÉ PLUS CHER ICI.
#
# cron impose PATH=/usr/bin:/bin. Sous ce chemin, /usr/bin/php est le binaire
# **php-cgi**, qui refuse l'option `-r` et imprime son mode d'emploi au lieu
# d'envoyer quoi que ce soit. Les deux envois d'alerte de ce script passent par
# `php -r '... mail(...)'`, donc depuis le 28 août 2026 :
#
#   1. la sauvegarde nocturne échouait (wp introuvable, même cause) ;
#   2. ce script le détectait correctement, à chaque passage ;
#   3. il « envoyait » l'alerte à php-cgi, qui imprimait son mode d'emploi ;
#   4. il écrivait quand même `en-alerte` et journalisait « message envoyé » ;
#   5. les 719 passages suivants disaient « déjà signalé, pas de second message ».
#
# Cinq jours de sauvegardes absentes, détectées, et jamais annoncées à personne.
# La correction est en deux endroits : le PATH ci-dessous, et le fait que l'état
# `en-alerte` n'est plus écrit quand l'envoi échoue.
case ":$PATH:" in
  *":/usr/local/bin:"*) ;;
  *) PATH="/usr/local/bin:$PATH" ;;
esac
export PATH

SEUIL_DISQUE=90
SAUVEGARDE_MAX_H=36
SEUIL_5XX=10

for a in "$@"; do
  case "$a" in
    --dest=*) DEST="${a#*=}" ;;
    --racine=*) RACINE="${a#*=}" ;;
    --boutique=*) BOUTIQUE="${a#*=}" ;;
    --studio=*) STUDIO="${a#*=}" ;;
    --sauvegardes=*) SAUVEGARDES="${a#*=}" ;;
    --sauvegarde-max-h=*) SAUVEGARDE_MAX_H="${a#*=}" ;;
    --etat) ETAT_SEUL=1 ;;
    *) echo "veille: option inconnue $a" >&2; exit 2 ;;
  esac
done

if [ -z "$DEST" ] && [ "$ETAT_SEUL" -eq 0 ]; then
  # PAS DE DESTINATAIRE PAR DÉFAUT. Une veille qui croit alerter et n'alerte pas
  # est le pire des trois états possibles.
  echo "veille: --dest= est obligatoire, sinon rien ne serait envoyé à personne." >&2
  exit 2
fi

mkdir -p "$ETAT_DIR"
PROBLEMES=()
VERIFIES=0

note() { PROBLEMES+=("$1"); }
verifie() { VERIFIES=$((VERIFIES + 1)); }

# ── la boutique et le studio ────────────────────────────────────────────────
verifie_url() {
  local nom="$1" url="$2"
  [ -z "$url" ] && return 0
  verifie
  local code
  code=$(curl -s -o /dev/null -m 20 -w '%{http_code}' "$url" 2>/dev/null || echo 000)
  if [ "$code" = "200" ] || [ "$code" = "301" ] || [ "$code" = "302" ]; then
    rm -f "$ETAT_DIR/echec-$nom"
    return 0
  fi
  # DEUX ÉCHECS DE SUITE. Sur du mutualisé un timeout isolé arrive, et une
  # alerte par timeout isolé est une alerte que l'on apprend à ignorer.
  local n=1
  [ -f "$ETAT_DIR/echec-$nom" ] && n=$(( $(cat "$ETAT_DIR/echec-$nom") + 1 ))
  echo "$n" > "$ETAT_DIR/echec-$nom"
  [ "$n" -ge 2 ] && note "$nom ne répond pas : HTTP $code sur $url ($n fois de suite)"
  return 0
}

verifie_url "boutique" "$BOUTIQUE"
verifie_url "studio" "$STUDIO"

# ── le disque ───────────────────────────────────────────────────────────────
verifie
USAGE=$(df --output=pcent "$HOME" 2>/dev/null | tail -1 | tr -dc '0-9')
if [ -n "$USAGE" ] && [ "$USAGE" -ge "$SEUIL_DISQUE" ]; then
  note "le disque est à ${USAGE}% : la boutique et la sauvegarde tombent ensemble quand il est plein"
fi

# ── la sauvegarde est-elle fraîche ──────────────────────────────────────────
verifie
DERNIERE=$(find "$SAUVEGARDES" -maxdepth 1 -mindepth 1 -type d -name '20*' 2>/dev/null | sort | tail -1)
if [ -z "$DERNIERE" ]; then
  note "aucune sauvegarde sous $SAUVEGARDES"
else
  AGE_S=$(( $(date +%s) - $(stat -c %Y "$DERNIERE") ))
  if [ "$AGE_S" -gt $((SAUVEGARDE_MAX_H * 3600)) ]; then
    note "la dernière sauvegarde date de $((AGE_S / 3600)) h ($(basename "$DERNIERE")), le cron ne tourne plus"
  fi
fi

# ── les erreurs serveur ─────────────────────────────────────────────────────
LOG=$(ls -t "$HOME"/access-logs/* 2>/dev/null | head -1)
if [ -n "$LOG" ] && [ -r "$LOG" ]; then
  verifie
  # La dernière heure, par le horodatage du journal plutôt que par tail -n :
  # un tail fixe rate une rafale sur un site chargé et invente une panne sur un
  # site calme.
  DEPUIS=$(date -d '1 hour ago' '+%d/%b/%Y:%H' 2>/dev/null || echo '')
  CINQ=0
  if [ -n "$DEPUIS" ]; then
    # `grep -c` PRINTS 0 AND EXITS 1 quand il ne trouve rien, donc un `|| echo 0`
    # écrit « 0 » deux fois et la comparaison suivante refuse « 0\n0 ». Mesuré.
    CINQ=$(tail -20000 "$LOG" 2>/dev/null | awk -v d="$DEPUIS" '$0 >= d' | grep -cE '" 5[0-9][0-9] ' || true)
    CINQ=${CINQ:-0}
  fi
  [ "$CINQ" -ge "$SEUIL_5XX" ] && note "$CINQ erreurs 5xx dans la dernière heure ($(basename "$LOG"))"
fi

# ── ce que seul WordPress sait ──────────────────────────────────────────────
if command -v wp >/dev/null && [ -f "$RACINE/wp-config.php" ]; then
  verifie
  # LE PHP PASSE PAR UN HEREDOC ET NON PAR DES APOSTROPHES. La version
  # précédente écrivait `LIKE '$t'` à l'intérieur d'une chaîne déjà entre
  # apostrophes : le shell fermait la sienne au premier `'`, développait `$t`
  # (introuvable, donc `unbound variable` sous `set -u`) et WordPress n'était
  # jamais interrogé. Le symptôme était « la moitié de la veille est aveugle »,
  # ce qui est au moins honnête, mais la cause était ici.
  VEILLE_PHP=$(cat <<'PHPEOF'
if ( ! class_exists( "Teeshoop\Core\Pricing" ) ) { echo json_encode( array( "plugin" => false ) ); return; }
global $wpdb;
$out = array( "plugin" => true );

// Encaissé et pas facturé. Une facture manquante est une obligation légale non
// tenue, pas un détail de gestion.
$paid = 0;
foreach ( wc_get_orders( array( "limit" => 50, "status" => array( "processing", "completed" ) ) ) as $o ) {
  $d = $o->get_date_paid();
  if ( $d && $d->getTimestamp() < time() - 3600 && "" === (string) $o->get_meta( "_teeshoop_invoice_number" ) ) { $paid++; }
}
$out["paid_without_invoice"] = $paid;

// Un bon a tirer qui n'est jamais parti : le client attend une preuve qu'il ne
// recevra pas, et la commande ne bouge plus.
$t = $wpdb->prefix . "teeshoop_mail";
// LES NOMS DE COLONNES ETAIENT FAUX ET CETTE ALARME NE POUVAIT PAS SONNER.
// Elle interrogeait `statut` et `envoye_le`; la table porte `status` et
// `created_at` (voir Schema::step_mail_table). MySQL rejetait la requete,
// get_var rendait NULL, (int) NULL vaut 0, et la veille annoncait donc
// « aucun bon a tirer en echec » a chaque passage depuis qu'elle existe.
// Trouve le 02/09/2026 par une relecture adverse, pas par une alerte.
// -1 signale « je n'ai pas pu regarder », que le shell distingue de 0.
$out["bat_failed"] = -1;
if ( $wpdb->get_var( $wpdb->prepare( "SHOW TABLES LIKE %s", $t ) ) ) {
  $n = $wpdb->get_var( "SELECT COUNT(*) FROM {$t} WHERE status IN ('failed','abandoned') AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)" );
  $out["bat_failed"] = ( null === $n ) ? -1 : (int) $n;
}

// Un achat fournisseur bloqué en « envoi incertain ». Séance 08 : il se résout
// seul depuis « envoi en cours » en cinq minutes, après quoi il attend un
// humain. Une heure est donc très large.
$out["achats_incertains"] = (int) $wpdb->get_var(
  "SELECT COUNT(*) FROM {$wpdb->posts} p INNER JOIN {$wpdb->postmeta} m ON m.post_id = p.ID
   WHERE p.post_type = 'ts_achat' AND m.meta_key = '_teeshoop_purchase_state'
     AND m.meta_value = 'envoi_incertain' AND p.post_modified_gmt < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR)"
);
echo json_encode( $out );
PHPEOF
)
  WP_JSON=$(cd "$RACINE" && wp eval "$VEILLE_PHP" 2>/dev/null | tail -1)

  if [ -z "$WP_JSON" ]; then
    note "WordPress n'a pas pu être interrogé : la moitié de la veille est aveugle"
  else
    lire() { echo "$WP_JSON" | sed -n "s/.*\"$1\":\([0-9]*\).*/\1/p"; }
    [ "$(echo "$WP_JSON" | grep -c '"plugin":false')" -gt 0 ] && \
      echo "veille: l'extension Teeshoop n'est pas active ici, les trois contrôles boutique sont ignorés." >&2
    P=$(lire paid_without_invoice); B=$(lire bat_failed); A=$(lire achats_incertains)
    [ -n "${P:-}" ] && [ "$P" -gt 0 ] && note "$P commande(s) payée(s) depuis plus d'une heure sans facture"
    [ -n "${B:-}" ] && [ "$B" -gt 0 ] && note "$B message(s) en échec d'envoi sur les 24 dernières heures"
    [ -n "${B:-}" ] && [ "$B" -lt 0 ] && note "le journal des envois n'a pas pu être interrogé : « on n'a pas pu regarder » n'est pas « rien à signaler »"
    [ -n "${A:-}" ] && [ "$A" -gt 0 ] && note "$A achat(s) fournisseur bloqué(s) en « envoi incertain » depuis plus d'une heure"
  fi
fi

# ── envoyer, et SAVOIR si c'est parti ───────────────────────────────────────
#
# Lit le corps sur son entrée standard. Sort 0 seulement si PHP a rendu `true`,
# ce que les deux appels précédents ne regardaient pas : ils écrasaient la sortie
# de php avec 2>/dev/null et concluaient au succès dans tous les cas, y compris
# quand le binaire appelé était php-cgi et n'avait rien envoyé du tout.
#
# `mail()` qui rend true veut dire « remis au serveur local », pas « arrivé ». Ce
# n'est pas la même garantie et il ne faut pas la lire pour plus qu'elle n'est ;
# c'est en revanche exactement la différence entre « on a essayé » et « on n'a
# même pas pu essayer », qui est celle qui manquait.
envoyer() {
  local sujet="$1" sortie
  command -v php >/dev/null || { echo "veille: php est introuvable, aucune alerte ne peut partir. PATH=$PATH" >&2; return 1; }
  sortie=$(V_DEST="$DEST" V_SUJET="$sujet" php -r \
    '$m=stream_get_contents(STDIN); echo mail(getenv("V_DEST"), getenv("V_SUJET"), $m, "Content-Type: text/plain; charset=utf-8") ? "ENVOYE" : "REFUSE";' 2>&1) || true
  case "$sortie" in
    *ENVOYE*) return 0 ;;
    *) echo "veille: l'envoi a échoué : $(printf '%s' "$sortie" | head -2 | tr '\n' ' ')" >&2; return 1 ;;
  esac
}

# ── rien vérifié n'est pas un succès ────────────────────────────────────────
if [ "$VERIFIES" -eq 0 ]; then
  echo "veille: aucun contrôle n'a pu s'exécuter." >&2
  exit 2
fi

HORODATAGE="$(date -u '+%Y-%m-%d %H:%M:%S') UTC"
if [ "${#PROBLEMES[@]}" -eq 0 ]; then
  echo "$HORODATAGE  ok  ($VERIFIES contrôles)"
  if [ "$ETAT_SEUL" -eq 0 ] && [ -f "$ETAT_DIR/en-alerte" ]; then
    # LE RETOUR À LA NORMALE EST UNE ALERTE AUSSI.
    if printf 'Tout est revenu à la normale.\n\n%s\n%s contrôles, aucun problème.\n' "$HORODATAGE" "$VERIFIES" \
         | envoyer "[Teeshoop] retour à la normale"; then
      rm -f "$ETAT_DIR/en-alerte"
    else
      # L'état reste : tant que personne n'a pu être prévenu du retour à la
      # normale, l'alerte n'est pas close.
      echo "  (le message de retour à la normale n'est pas parti, l'état d'alerte est conservé)" >&2
    fi
  fi
  exit 0
fi

echo "$HORODATAGE  PROBLEME  ($VERIFIES contrôles)"
for p in "${PROBLEMES[@]}"; do echo "  - $p"; done

if [ "$ETAT_SEUL" -eq 1 ]; then exit 1; fi

# UN SEUL MESSAGE PAR PROBLÈME, pas un par passage. La signature est la liste
# elle-même : si elle change, c'est un nouveau problème et il mérite un message.
SIGNATURE=$(printf '%s\n' "${PROBLEMES[@]}" | sort | md5sum | cut -d' ' -f1)
PRECEDENTE=""
[ -f "$ETAT_DIR/en-alerte" ] && PRECEDENTE=$(cat "$ETAT_DIR/en-alerte")

if [ "$SIGNATURE" != "$PRECEDENTE" ]; then
  {
    echo "Teeshoop, $HORODATAGE"
    echo ""
    for p in "${PROBLEMES[@]}"; do echo "  - $p"; done
    echo ""
    echo "Quoi faire : docs/EXPLOITATION.md"
    echo "Ce message n'est envoyé qu'une fois par problème. Un autre suivra quand ce sera revenu à la normale."
  } | envoyer "[Teeshoop] ${PROBLEMES[0]:0:90}" && ENVOYE=1 || ENVOYE=0

  if [ "$ENVOYE" -eq 1 ]; then
    # L'ÉTAT N'EST ÉCRIT QUE SI LE MESSAGE EST PARTI. Il l'était inconditionnellement,
    # et c'est ce qui a rendu la panne du 28 août silencieuse : le premier envoi
    # échouait, la signature était enregistrée quand même, et tous les passages
    # suivants concluaient « déjà signalé ». Un problème qu'on n'a pas su annoncer
    # n'est pas un problème annoncé.
    echo "$SIGNATURE" > "$ETAT_DIR/en-alerte"
    echo "  (message envoyé à $DEST)"
  else
    echo "  (ENVOI IMPOSSIBLE vers $DEST : le problème sera réannoncé au prochain passage)" >&2
  fi
else
  echo "  (déjà signalé, pas de second message)"
fi

exit 1
