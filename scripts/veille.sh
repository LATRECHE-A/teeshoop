#!/bin/bash
#
# La veille : ce pour quoi il vaut la peine d'être réveillé, et rien d'autre.
#
#   ./veille.sh --dest=quelquun@exemple.fr [--racine=~/public_html] [--boutique=https://…]
#   ./veille.sh --dest=… --etat                 n'alerte pas, affiche l'état
#
# DEUX CANAUX, ET UN BATTEMENT. Le 28 août 2026 il n'y en avait qu'un, et il
# était muet. Depuis :
#
#   - la destination est PROUVÉE avant qu'on lui écrive (scripts/destinataire.sh
#     interroge le compte lui-même). Écrire à une boîte qui n'existe pas est
#     exactement ce qui s'est passé, et cela ressemble à un succès ;
#   - une alerte part par DEUX chemins qui ne partagent aucune pièce : le
#     courrier local, et du HTTP sortant (scripts/battement.sh). L'état
#     « déjà signalé » n'est écrit que si au moins l'un des deux a abouti ;
#   - à chaque passage un BATTEMENT part vers un tiers, pour que le silence de
#     cette machine soit lui-même l'alarme. Rien de ce qui part d'ici ne peut
#     annoncer que cette machine est morte.
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
#                            un achat fournisseur resté en « envoi incertain »,
#                            et l'âge du dernier import de catalogue.
#                            Ces quatre-là ne se voient nulle part ailleurs.
#
# L'ÂGE DU DERNIER IMPORT à 48 heures : le catalogue du fournisseur bouge, ses
# prix d'achat et ses ruptures aussi. Un import arrêté laisse la boutique vendre
# des références retirées au prix d'avant, et rien ne le montre à l'écran. Un
# import commencé et jamais terminé compte comme un import qui n'a pas eu lieu.
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
IMPORT_MAX_H=48
CONFIG_DIR="$HOME/.config/teeshoop"

# Les deux compagnons de ce script vivent à côté de lui, dans ~ sur le serveur
# comme dans scripts/ ici. Résolu par $0 et non par $PWD : cron ne se place nulle
# part avant de lancer, et le PWD d'un cron est $HOME par hasard, pas par contrat.
ICI="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"

for a in "$@"; do
  case "$a" in
    --dest=*) DEST="${a#*=}" ;;
    --racine=*) RACINE="${a#*=}" ;;
    --boutique=*) BOUTIQUE="${a#*=}" ;;
    --studio=*) STUDIO="${a#*=}" ;;
    --sauvegardes=*) SAUVEGARDES="${a#*=}" ;;
    --sauvegarde-max-h=*) SAUVEGARDE_MAX_H="${a#*=}" ;;
    --import-max-h=*) IMPORT_MAX_H="${a#*=}" ;;
    --config=*) CONFIG_DIR="${a#*=}" ;;
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

# UNE SONDE QUI NE REND PAS LA MAIN EST UNE PANNE QU'ELLE A CRÉÉE. Sur du
# mutualisé, une veille lancée toutes les dix minutes qui reste accrochée
# épuise le quota de processus du compte, et c'est la boutique qui tombe : la
# surveillance aurait causé l'incident qu'elle devait annoncer. `timeout` est
# dans coreutils et se trouve partout ; s'il manquait, une sonde sans borne
# vaut encore mieux que pas de sonde.
avec_delai() {
  local s="$1"; shift
  if command -v timeout >/dev/null 2>&1; then timeout "$s" "$@"; else "$@"; fi
}

# ── à qui on écrit, et est-ce que cette boîte existe ────────────────────────
#
# CE CONTRÔLE PASSE AVANT D'ARMER QUOI QUE CE SOIT. Le 28 août, le canal visait
# une adresse que personne n'avait vérifiée ; une adresse syntaxiquement valable
# qui ne mène nulle part se comporte exactement comme une bonne adresse, jusqu'au
# jour où on compte dessus. `destinataire.sh` pose la question au compte cPanel
# lui-même, et distingue quatre réponses, dont deux ne sont pas des succès.
DEST_VERDICT="non-verifie"
DEST_MOT=""
if [ -n "$DEST" ]; then
  if [ -n "$ICI" ] && [ -x "$ICI/destinataire.sh" ]; then
    DEST_MOT=$(avec_delai 20 "$ICI/destinataire.sh" --dest="$DEST" 2>&1)
    case "$?" in
      0) DEST_VERDICT="presente";   verifie ;;
      1) DEST_VERDICT="absente";    verifie ;;
      3) DEST_VERDICT="hors-compte"; verifie ;;
      *) DEST_VERDICT="illisible" ;;
    esac
  else
    DEST_MOT="destinataire.sh est absent d'à côté de la veille, la destination n'est pas vérifiée."
  fi
  # Une boîte PROUVÉE absente est un problème en soi, au même titre qu'un disque
  # plein : elle rend muette la moitié du dispositif. Elle part donc dans la
  # liste, ce qui la fait porter par le canal HTTP, qui lui fonctionne encore.
  if [ "$DEST_VERDICT" = "absente" ]; then
    # SANS L'ADRESSE. Ce texte part chez un tiers par le canal HTTP et dans le
    # corps du battement ; le skill observability interdit une adresse
    # électronique dans un journal, et celui-ci sort du compte. La ligne sur la
    # sortie d'erreur, quelques lignes plus bas, la nomme en clair : elle, elle
    # ne quitte pas la machine.
    note "la boîte de destination des alertes n'existe pas sur le compte : aucune alerte par courrier ne peut arriver (l'adresse est dans la ligne de cron)"
  fi
  if [ "$ETAT_SEUL" -eq 1 ]; then
    echo "destinataire : $DEST_VERDICT"
    [ -n "$DEST_MOT" ] && echo "  $DEST_MOT"
  elif [ "$DEST_VERDICT" != "presente" ]; then
    echo "veille: destination $DEST_VERDICT : $(printf '%s' "$DEST_MOT" | head -1)" >&2
  fi
fi

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
#
# WP-CLI ABSENT SUR UNE MACHINE QUI PORTE WORDPRESS EST UNE ALARME. C'est
# littéralement la cause du 28 août : sous cron, PATH=/usr/bin:/bin et `wp` n'y
# est pas. Le bloc ci-dessous se contentait de ne pas s'exécuter, donc quatre
# contrôles disparaissaient sans que rien ne le dise.
if [ -f "$RACINE/wp-config.php" ] && ! command -v wp >/dev/null; then
  verifie
  note "wp-cli est introuvable alors que $RACINE/wp-config.php existe : les contrôles WordPress sont aveugles (PATH=$PATH)"
fi

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

// L'age du dernier import de catalogue. Importer.php ecrit sa course dans
// l'option `teeshoop_catalogue_run` : `started` a l'ouverture, `finished` quand
// la derniere reference est passee, tous deux en gmdate("c").
//
// UN IMPORT COMMENCE ET JAMAIS TERMINE N'EST PAS UN IMPORT. On date donc sur
// `finished` quand il existe, et sur `started` sinon : une course interrompue
// vieillit, au lieu de se faire passer pour fraiche parce qu'elle a commence.
// -1 signale « je n'ai pas pu regarder », que le shell distingue de « frais ».
$out["import_age_min"]  = -1;
$out["import_en_cours"] = 0;
$out["import_at"]       = -1;
$run = get_option( "teeshoop_catalogue_run", array() );
if ( is_array( $run ) ) {
  $fini  = (string) ( $run["finished"] ?? "" );
  $debut = (string) ( $run["started"] ?? "" );
  if ( "" === $fini && "" !== $debut ) { $out["import_en_cours"] = 1; }
  $repere = ( "" !== $fini ) ? $fini : $debut;
  $ts     = ( "" !== $repere ) ? strtotime( $repere ) : false;
  if ( false !== $ts ) { $out["import_age_min"] = (int) floor( ( time() - $ts ) / 60 ); }
  // Le point d'avancement, pour que le shell sache distinguer un import qui
  // AVANCE d'un import qui a commence puis s'est tu. Une option WordPress ne
  // porte aucune date de derniere ecriture.
  if ( isset( $run["at"] ) ) { $out["import_at"] = (int) $run["at"]; }
}
echo json_encode( $out );
PHPEOF
)
  WP_JSON=$(cd "$RACINE" && avec_delai 60 wp eval "$VEILLE_PHP" 2>/dev/null | tail -1)

  if [ -z "$WP_JSON" ]; then
    note "WordPress n'a pas pu être interrogé : la moitié de la veille est aveugle"
  else
    # LE MOINS UN N'ETAIT PAS LISIBLE, DONC L'ALARME NE POUVAIT PAS SONNER.
    # `[0-9]*` accepte zero chiffre : sur `"bat_failed":-1`, sed capturait la
    # chaine vide, `[ -n "$B" ]` etait faux, et la branche « on n'a pas pu
    # regarder » du bon a tirer n'a jamais pu s'executer depuis qu'elle existe.
    # Mesure le 05/09/2026. Il faut donc un signe optionnel ET au moins un
    # chiffre.
    lire() { echo "$WP_JSON" | sed -n "s/.*\"$1\":\(-\{0,1\}[0-9][0-9]*\).*/\1/p"; }
    [ "$(echo "$WP_JSON" | grep -c '"plugin":false')" -gt 0 ] && \
      echo "veille: l'extension Teeshoop n'est pas active ici, les trois contrôles boutique sont ignorés." >&2
    P=$(lire paid_without_invoice); B=$(lire bat_failed); A=$(lire achats_incertains)
    [ -n "${P:-}" ] && [ "$P" -gt 0 ] && note "$P commande(s) payée(s) depuis plus d'une heure sans facture"
    [ -n "${B:-}" ] && [ "$B" -gt 0 ] && note "$B message(s) en échec d'envoi sur les 24 dernières heures"
    [ -n "${B:-}" ] && [ "$B" -lt 0 ] && note "le journal des envois n'a pas pu être interrogé : « on n'a pas pu regarder » n'est pas « rien à signaler »"
    [ -n "${A:-}" ] && [ "$A" -gt 0 ] && note "$A achat(s) fournisseur bloqué(s) en « envoi incertain » depuis plus d'une heure"

    I=$(lire import_age_min); C=$(lire import_en_cours); AT=$(lire import_at)
    REPERE_IMPORT="$ETAT_DIR/import-avancement"
    if [ -z "${I:-}" ]; then
      note "l'âge du dernier import de catalogue n'a pas été rendu par WordPress : « on n'a pas pu regarder » n'est pas « il est frais »"
    elif [ "$I" -lt 0 ]; then
      note "aucune date d'import de catalogue lisible : la boutique vend un catalogue dont personne ne sait l'âge"
    elif [ "${C:-0}" = "1" ]; then
      # UN IMPORT QUI AVANCE N'EST PAS UN IMPORT ARRÊTÉ, et dater sur `started`
      # ferait sonner l'alarme presque toutes les nuits. La ligne de cron que
      # documente Cli.php porte `--duree=1800` : l'import est reprenable et
      # s'arrête au bout d'une demi-heure. Une passe complète mesurée à 2 h 31
      # pour 2 302 références s'étale donc sur six nuits, pendant lesquelles
      # `started` a six jours et `finished` est vide. On suit l'AVANCEMENT.
      #
      # Le repère est amorcé sur le DÉBUT de la course, jamais sur maintenant :
      # sinon un import arrêté depuis une semaine repartirait muet pour un
      # cycle entier au premier passage de la veille.
      MAINTENANT=$(date +%s)
      PREC_AT=""; PREC_T=""
      [ -r "$REPERE_IMPORT" ] && read -r PREC_AT PREC_T < "$REPERE_IMPORT"
      if [ -z "$PREC_T" ]; then
        echo "$AT $((MAINTENANT - I * 60))" > "$REPERE_IMPORT"
      elif [ "$PREC_AT" != "$AT" ]; then
        echo "$AT $MAINTENANT" > "$REPERE_IMPORT"
      fi
      REPERE_T=""
      read -r _ REPERE_T < "$REPERE_IMPORT"
      IMMOBILE=$(( (MAINTENANT - ${REPERE_T:-$MAINTENANT}) / 60 ))
      if [ "$IMMOBILE" -gt $((IMPORT_MAX_H * 60)) ]; then
        note "l'import de catalogue n'avance plus depuis $((IMMOBILE / 60)) h (arrêté à la référence $AT, seuil $IMPORT_MAX_H h) : le catalogue est à moitié à jour"
      fi
    else
      rm -f "$REPERE_IMPORT"
      if [ "$I" -gt $((IMPORT_MAX_H * 60)) ]; then
        note "le dernier import de catalogue date de $((I / 60)) h (seuil $IMPORT_MAX_H h) : références retirées et prix d'achat périmés restent en vente"
      fi
    fi
  fi
fi

# ── envoyer par les deux canaux, et SAVOIR lequel est parti ─────────────────
#
# Lit le corps sur son entrée standard. Sort 0 si AU MOINS UN canal a abouti,
# ce dont dépend l'écriture de l'état « déjà signalé ».
#
# Deux canaux, et le mot important est « deux » : ils ne partagent aucune pièce.
# Le HTTP n'a besoin ni de php, ni du MTA local, ni du DNS de messagerie ; le
# courrier n'a besoin ni de curl, ni de la joignabilité du tiers. Le 28 août il
# n'y en avait qu'un, et la seule pièce qui manquait (php sous cron était
# php-cgi) suffisait à rendre la panne indicible.
#
# CE QUE VAUT CHAQUE SUCCÈS, et ils ne valent pas la même chose :
#   - le HTTP rend 2xx : le tiers a accusé réception. C'est de bout en bout.
#   - `mail()` rend true : le serveur LOCAL a pris le message. Ce n'est pas
#     « arrivé », c'est « on a pu essayer », et c'est déjà la distinction qui
#     manquait. C'est pour cela que la destination est vérifiée avant, et que le
#     battement existe : ni l'un ni l'autre ne se contente de cette promesse.
CANAUX=""
envoyer() {
  local sujet="$1" corps sortie parti=0
  corps=$(cat)
  CANAUX=""

  if [ -n "$ICI" ] && [ -x "$ICI/battement.sh" ]; then
    if printf '%s\n' "$corps" | "$ICI/battement.sh" --canal=alerte --sujet="$sujet" \
         --config="$CONFIG_DIR" --etat-dir="$ETAT_DIR" >/dev/null; then
      parti=1
      CANAUX="$CANAUX http"
    fi
  else
    echo "veille: battement.sh n'est pas à côté de la veille, il n'y a pas de second canal." >&2
  fi

  # PAS DE COURRIER VERS UNE BOÎTE PROUVÉE ABSENTE. Le remettre au MTA rendrait
  # « true », écrirait l'état, et le problème serait classé annoncé sans que
  # personne ne l'ait lu : le 28 août, mot pour mot.
  if [ "$DEST_VERDICT" = "absente" ]; then
    echo "veille: pas de courrier vers $DEST, le compte a répondu que cette boîte n'existe pas." >&2
  elif ! command -v php >/dev/null; then
    echo "veille: php est introuvable, le courrier ne peut pas partir. PATH=$PATH" >&2
  else
    sortie=$(printf '%s\n' "$corps" | V_DEST="$DEST" V_SUJET="$sujet" php -r \
      '$m=stream_get_contents(STDIN); echo mail(getenv("V_DEST"), getenv("V_SUJET"), $m, "Content-Type: text/plain; charset=utf-8") ? "ENVOYE" : "REFUSE";' 2>&1) || true
    case "$sortie" in
      *ENVOYE*) parti=1; CANAUX="$CANAUX courrier" ;;
      *) echo "veille: le courrier n'est pas parti : $(printf '%s' "$sortie" | head -2 | tr '\n' ' ')" >&2 ;;
    esac
  fi

  CANAUX="${CANAUX# }"
  # C'est LA FONCTION qui le dit, pas l'appelant : le dernier maillon d'un
  # pipeline s'exécute dans un sous-shell, donc aucune variable posée ici ne
  # remonte. Mesuré, et c'est la raison de cette ligne à cet endroit.
  [ "$parti" -eq 1 ] && echo "  (message parti par : $CANAUX)"
  [ "$parti" -eq 1 ]
}

# ── le battement : dire « je suis vivante » à intervalle connu ──────────────
#
# Il part à CHAQUE passage, en panne comme en bonne santé, parce que ce qu'il
# prouve n'est pas la santé de la boutique mais l'existence de la veille. Ce que
# personne d'ici ne peut annoncer, c'est sa propre mort : machine éteinte, cron
# désarmé, compte suspendu. Alors c'est l'ABSENCE de battement, vue d'ailleurs,
# qui devient l'alarme.
battre() {
  local etat="$1" detail="$2" msg rc
  [ -n "$ICI" ] && [ -x "$ICI/battement.sh" ] || return 0
  msg=$("$ICI/battement.sh" --etat="$etat" --detail="$detail" \
        --config="$CONFIG_DIR" --etat-dir="$ETAT_DIR" 2>&1 >/dev/null)
  rc=$?
  # rc valant 2, le canal n'est pas armé : le répéter toutes les dix minutes
  # ferait 144 lignes par jour dans le journal pour une chose qui se règle une
  # fois. `--etat` le dit, et docs/EXPLOITATION.md aussi. rc valant 1, le
  # battement a été refusé ou n'est pas arrivé, et cela se dit.
  [ "$rc" -eq 1 ] && echo "veille: le battement n'est pas parti : $(printf '%s' "$msg" | head -1)" >&2
  return 0
}

# ── rien vérifié n'est pas un succès ────────────────────────────────────────
if [ "$VERIFIES" -eq 0 ]; then
  echo "veille: aucun contrôle n'a pu s'exécuter." >&2
  [ "$ETAT_SEUL" -eq 0 ] && battre "probleme" "aucun contrôle n'a pu s'exécuter"
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
  if [ "$ETAT_SEUL" -eq 1 ]; then
    [ -n "$ICI" ] && [ -x "$ICI/battement.sh" ] && \
      "$ICI/battement.sh" --etat-canal --config="$CONFIG_DIR" --etat-dir="$ETAT_DIR"
  else
    battre "ok" "$VERIFIES contrôles, aucun problème"
  fi
  exit 0
fi

echo "$HORODATAGE  PROBLEME  ($VERIFIES contrôles)"
for p in "${PROBLEMES[@]}"; do echo "  - $p"; done

if [ "$ETAT_SEUL" -eq 1 ]; then
  [ -n "$ICI" ] && [ -x "$ICI/battement.sh" ] && \
    "$ICI/battement.sh" --etat-canal --config="$CONFIG_DIR" --etat-dir="$ETAT_DIR"
  exit 1
fi

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
    echo "  (enregistré : ce problème ne sera pas répété tant qu'il ne change pas)"
  else
    echo "  (AUCUN CANAL N'A ABOUTI : le problème sera réannoncé au prochain passage)" >&2
  fi
else
  echo "  (déjà signalé, pas de second message)"
  ENVOYE=1
fi

# LE BATTEMENT PORTE LE VERDICT, ET SURTOUT L'ÉCHEC DU CANAL D'ALERTE. C'est la
# seule chose qu'un tiers puisse voir quand les deux canaux se taisent : un
# battement qui arrive en disant « je n'ai pas pu prévenir » vaut mieux qu'un
# silence de plus.
DETAIL="$VERIFIES contrôles, ${#PROBLEMES[@]} problème(s) : ${PROBLEMES[0]:0:120}"
[ "${ENVOYE:-0}" -eq 0 ] && DETAIL="$DETAIL | ALERTE NON DÉLIVRÉE"
battre "probleme" "$DETAIL"

exit 1
