#!/bin/bash
#
# Poser sur le miroir local WordPress tout ce qu'un `docker compose down -v`
# emporte : les trois constantes de wp-config.php et les clés Stripe de test.
#
#   ./scripts/wp-secrets.sh              pose ce qui manque, ne touche pas au reste
#   ./scripts/wp-secrets.sh --etat       n'écrit rien, dit ce qui est posé
#
# POURQUOI CE FICHIER EXISTE. ACCES-REQUIS.md documentait déjà les trois
# `wp config set` à refaire après une reconstruction du miroir, et personne
# n'avait écrit la quatrième chose : les clés Stripe, qui ne sont pas une
# constante mais une entrée du tableau d'options `woocommerce_stripe_settings`.
# Une procédure qu'on retape de mémoire est une procédure qu'on retape mal, et
# le 14 août une valeur réaffichée par `wp config set` sans `--quiet` a coûté
# une rotation de jeton.
#
# LES VALEURS NE SONT PAS ICI. Elles sont lues dans ~/.config/teeshoop/, hors
# du dépôt, et ce script refuse de deviner : un fichier absent est un refus
# explicite, pas un défaut silencieux.
#
#   ~/.config/teeshoop/stripe.env    STRIPE_TEST_PUBLISHABLE_KEY, STRIPE_TEST_SECRET_KEY
#                                    et, quand il existera, STRIPE_TEST_WEBHOOK_SECRET
#   ~/.config/teeshoop/worker.env    FR_ORDER_TOKEN
#   .dev.vars                        ADMIN_TOKEN (le miroir parle au Worker local)
#
# CE QU'IL NE FAIT PAS. Il ne touche jamais la production, ni le Worker
# Cloudflare. `wrangler secret put` reste une commande à taper à la main, avec
# la valeur sur l'entrée standard, parce qu'un secret de production posé par un
# script est un secret que personne n'a regardé partir.

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONF="${HOME}/.config/teeshoop"
ETAT=0
[ "${1:-}" = "--etat" ] && ETAT=1

wpcli() {
  docker compose -f "${ROOT}/wp-local/docker-compose.yml" run --rm -T wpcli "$@"
}

ok=0
manquant=0

dire_ok()      { printf '  ok      %s\n' "$1"; ok=$((ok + 1)); }
dire_manque()  { printf '  MANQUE  %s\n' "$1"; manquant=$((manquant + 1)); }
dire_pose()    { printf '  posé    %s\n' "$1"; ok=$((ok + 1)); }

# ── Les valeurs, lues hors du dépôt ─────────────────────────────────────────

lire() {
  # lire FICHIER CLE : imprime la valeur, rien si absente. Pas de `source`,
  # parce qu'un fichier de secrets n'est pas un script à exécuter.
  [ -f "$1" ] || return 0
  sed -n "s/^$2=//p" "$1" | head -1
}

ADMIN_TOKEN="$(lire "${ROOT}/.dev.vars" ADMIN_TOKEN)"
FR_ORDER_TOKEN="$(lire "${CONF}/worker.env" FR_ORDER_TOKEN)"
STRIPE_PK="$(lire "${CONF}/stripe.env" STRIPE_TEST_PUBLISHABLE_KEY)"
STRIPE_SK="$(lire "${CONF}/stripe.env" STRIPE_TEST_SECRET_KEY)"
STRIPE_WH="$(lire "${CONF}/stripe.env" STRIPE_TEST_WEBHOOK_SECRET)"

echo "Miroir local : les secrets"
echo

# ── Le conteneur répond-il ? ────────────────────────────────────────────────

if ! wpcli option get siteurl >/dev/null 2>&1; then
  echo "  REFUS   le miroir ne répond pas. \`npm run wp:up\` d'abord."
  echo
  echo "  Si docker échoue sur « failed to create endpoint », vérifiez que le"
  echo "  noyau qui tourne a encore ses modules :"
  echo "    uname -r ; ls /lib/modules/"
  echo "  Un noyau mis à jour sans redémarrage n'a plus de veth, donc plus de"
  echo "  réseau conteneur. Redémarrer suffit."
  exit 2
fi

# ── Les trois constantes de wp-config.php ───────────────────────────────────

poser_constante() {
  local nom="$1" valeur="$2"
  if [ -z "$valeur" ]; then
    dire_manque "$nom : aucune valeur trouvée hors du dépôt"
    return
  fi
  if wpcli config has "$nom" --type=constant >/dev/null 2>&1; then
    dire_ok "$nom"
    return
  fi
  if [ "$ETAT" = 1 ]; then
    dire_manque "$nom (--etat, rien n'a été écrit)"
    return
  fi
  # --quiet n'est pas décoratif : sans lui `wp config set` réaffiche la valeur.
  if wpcli config set "$nom" "$valeur" --type=constant --quiet >/dev/null 2>&1; then
    dire_pose "$nom"
  else
    dire_manque "$nom : wp config set a échoué"
  fi
}

# CATALOGUE et WORKER portent la même valeur qu'ADMIN_TOKEN : ce sont les deux
# façons dont la boutique s'authentifie auprès du Worker, sur ses routes
# d'administration. ORDER est délibérément un autre secret (voir l'en-tête).
poser_constante TEESHOOP_CATALOGUE_TOKEN "$ADMIN_TOKEN"
poser_constante TEESHOOP_WORKER_TOKEN    "$ADMIN_TOKEN"
poser_constante TEESHOOP_ORDER_TOKEN     "$FR_ORDER_TOKEN"

# ── Stripe, qui est une option et non une constante ─────────────────────────

if [ -z "$STRIPE_PK" ] || [ -z "$STRIPE_SK" ]; then
  dire_manque "clés Stripe de test : ${CONF}/stripe.env est absent ou incomplet"
else
  # Le préfixe est la seule lecture qui ne peut pas se contredire elle-même.
  # Payment.php lit la clé et non la case « testmode », pour la raison mesurée
  # le 18/08/2026 : les deux réglages se contredisaient.
  case "$STRIPE_SK" in
    sk_test_*) : ;;
    *) echo "  REFUS   STRIPE_TEST_SECRET_KEY ne commence pas par sk_test_. Refus d'écrire."; exit 1 ;;
  esac

  actuelle="$(wpcli option pluck woocommerce_stripe_settings test_secret_key 2>/dev/null | tr -d '\r')"
  if [ "$actuelle" = "$STRIPE_SK" ]; then
    dire_ok "woocommerce_stripe_settings (clés de test)"
  elif [ "$ETAT" = 1 ]; then
    dire_manque "woocommerce_stripe_settings (--etat, rien n'a été écrit)"
  else
    for couple in "testmode:yes" "test_publishable_key:$STRIPE_PK" "test_secret_key:$STRIPE_SK"; do
      cle="${couple%%:*}"
      val="${couple#*:}"
      wpcli option patch update woocommerce_stripe_settings "$cle" "$val" >/dev/null 2>&1 \
        || wpcli option patch insert woocommerce_stripe_settings "$cle" "$val" >/dev/null 2>&1
    done
    if [ -n "$STRIPE_WH" ]; then
      wpcli option patch update woocommerce_stripe_settings test_webhook_secret "$STRIPE_WH" >/dev/null 2>&1 \
        || wpcli option patch insert woocommerce_stripe_settings test_webhook_secret "$STRIPE_WH" >/dev/null 2>&1
    fi
    verif="$(wpcli option pluck woocommerce_stripe_settings test_secret_key 2>/dev/null | tr -d '\r')"
    if [ "$verif" = "$STRIPE_SK" ]; then
      dire_pose "woocommerce_stripe_settings (clés de test)"
    else
      dire_manque "woocommerce_stripe_settings : écrit puis relu différent, l'extension Stripe est-elle installée ?"
    fi
  fi
fi

if [ -z "$STRIPE_WH" ]; then
  dire_manque "STRIPE_TEST_WEBHOOK_SECRET : à récupérer chez Stripe, Développeurs puis Webhooks"
fi

# ── Ce que le plugin en dit lui-même ────────────────────────────────────────

echo
echo "Ce que la boutique répond, à elle seule :"
wpcli eval 'foreach ( \Teeshoop\Payment::problems() as $p ) { echo "  ", $p, "\n"; } if ( ! \Teeshoop\Payment::problems() ) { echo "  aucun problème de paiement signalé\n"; }' 2>/dev/null \
  || echo "  (Payment::problems() injoignable, l'extension teeshoop-core est-elle active ?)"

echo
printf '%d posé(s) ou déjà en place, %d manquant(s).\n' "$ok" "$manquant"

# Un manquant n'est pas une panne du script : c'est un état à afficher. Mais il
# ne doit pas passer pour un succès dans une chaîne de commandes.
[ "$manquant" -eq 0 ]
