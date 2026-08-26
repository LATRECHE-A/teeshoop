# Séance 12, ce qui reste à reprendre

> Écrit à la fermeture de la séance 12 (juridique, RGPD, accessibilité), le
> 26 août 2026. Tout ce qui suit est vérifié à cette date : les affirmations
> chiffrées ont été mesurées, et ce qui ne l'a pas été le dit.
>
> Rien ici n'est un travail à moitié fait qu'on aurait caché. Ce sont des choix
> assumés, des dépendances à une réponse humaine, et trois défauts trouvés dans
> le code de quelqu'un d'autre que cette séance n'était pas là pour corriger.

---

## 1. L'état, en une page

Quatorze commits sur `r0-securite-et-socle`, poussés, CI verte. Rien n'est en
attente dans l'arbre de travail.

**Les contrôles, et ce qu'ils disaient à la fermeture.** Les cinq derniers ont
besoin du miroir (`npm run wp:up`) et ne tournent PAS sur GitHub :

| Commande | Résultat |
|---|---|
| `npm run ci` | verte : 519 assertions pures, 199 vitest, php-guard, palette, hypothèses, couleurs |
| `npm run test:wp` | 207 assertions contre un vrai WooCommerce |
| `npm run verify:seo` | 459/459 |
| `npm run verify:consent` | 16/16, deux autotests tirés |
| `npm run verify:a11y` | 416/416, sept autotests tirés |
| `npm run verify:site` | 257/257, 39 captures |
| `npm run verify:wp-e2e` | 96 assertions |

**Le registre.** 103 lignes, 21 questions bloquantes toutes couvertes, sept
autotests du garde qui tirent.

---

## 2. Ce qui bloque la vente, et qui seul peut le débloquer

Aucun de ces sept points n'est du code. La liste complète, avec le détail, est
dans `docs/RGPD.md` §4 ; les questions sont dans `QUESTIONS-ASSOCIE.md`.

1. **L'identité légale du vendeur** (Q17). Tant qu'elle manque, la page des
   mentions légales publie la liste de ce qui manque, la facture est refusée en
   production et la validation d'une commande l'est aussi. C'est le premier
   verrou et il ne se contourne pas.
2. **Le responsable de traitement**, nommément (Q19).
3. **Le directeur de la publication et les coordonnées publiques** (Q56, écrite
   par cette séance).
4. **Le médiateur de la consommation** (Q57, écrite par cette séance). Article
   L612-1 : obligatoire dès qu'on vend à des consommateurs. L'article 18 des CGV
   dit en toutes lettres que l'obligation n'est pas satisfaite.
5. **La relecture des quatre textes par un avocat** (Q58, écrite par cette
   séance). Priorité aux articles 10, 11 et 16.
6. **Six avenants de traitement** (Q59, écrite par cette séance) : Stripe, Brevo,
   Cloudflare, o2switch, le cabinet comptable, le transporteur. Aucun n'est
   signé. Trois se règlent en cochant une case ; le compte Brevo n'existe pas.
7. **La durée de conservation des créations** (Q33).

Trois faits ne sont pas des décisions mais des lectures, et sont dans
`ACCES-REQUIS.md` §6 quater : l'identité légale d'o2switch (dans le contrat
d'hébergement), et les avenants Cloudflare, Stripe et o2switch.

---

## 3. Ce que la séance n'a délibérément pas construit

### 3.1 Aucune suppression côté Brevo, et il ne faut pas laisser croire le contraire

Le code n'appelle que `POST https://api.brevo.com/v3/smtp/email`. Aucun contact
n'est créé par nous. Ce que Brevo conserve de ses propres journaux d'envoi relève
de l'avenant de traitement, **pas d'un appel que ce dépôt pourrait faire** : il
n'y a pas de route de suppression Brevo dans ce code et il n'y en a pas eu.

Ce qui EST fait de notre côté : `Privacy::forget_recipient()` anonymise l'adresse
dans le journal d'envoi local (`wp_teeshoop_mail`) en gardant la ligne, parce que
la ligne est ce qui signale un message jamais parti.

Ce qu'il faudrait pour aller plus loin : le compte Brevo (qui n'existe pas), son
avenant, et une décision sur ce qu'on lui demande. La séance 12 a préféré écrire
qu'elle ne le fait pas plutôt que d'écrire une route non exercée.

### 3.2 Le balayage des créations orphelines existe et rien ne l'appelle

`POST /api/design/reap` est construit, testé sous miniflare, borné à 500
créations par appel, et refuse une liste `keep` absente. **Aucune tâche ne
l'appelle** : pas de cron, pas de sous-commande WP-CLI, pas de règle de cycle de
vie R2 sur le préfixe `design/`.

C'est délibéré : la durée est la question 33 et personne n'y a répondu. La page
`/confidentialite/` dit désormais exactement cela plutôt que de prétendre qu'un
balayage tourne. `H-Q33-CONSERVATION-CREATIONS` l'enregistre comme un REFUS.

Ce qu'il faut pour le brancher : la réponse à Q33 (trois durées possibles, deux
formes de clés), puis un `wp_schedule_event` qui appelle la route avec la liste
des identifiants encore détenus contre une commande ou un devis.

### 3.3 Aucune purge à dix ans des factures

La conservation est écrite et annoncée à la personne concernée ; le balayage qui
la termine ne l'est pas. Il n'existe aucune commande de dix ans sur laquelle
l'éprouver, et une tâche automatique que rien ne peut tester est plus dangereuse
qu'une ligne dans un document. Question 60.

### 3.4 Aucun accès Madagascar

Rien n'est construit : pas de compte, pas de rôle, pas de journal de
consultation. `H-Q28-MADAGASCAR` l'enregistre comme un refus assumé, et il le
reste tant que le contrat de sous-traitance n'existe pas (Q28).

### 3.5 Aucun registre de preuve du consentement côté serveur

`Consent` écrit la décision dans un cookie sur la machine du visiteur et nulle
part ailleurs. L'article 7.1 du RGPD demande de pouvoir DÉMONTRER le
consentement, et un cookie que la personne peut effacer n'est pas cela.

Ce n'est pas construit, et c'est un vrai manque plutôt qu'un choix : la séance a
préféré traiter d'abord ce qui écrivait sur la machine des gens sans leur
demander. Un registre minimal serait une ligne par décision (un identifiant
pseudonyme tiré au sort et écrit dans le cookie, la version, les catégories, la
date), conservée treize mois comme le cookie lui-même.

---

## 4. Trois défauts trouvés qui n'appartiennent pas à cette séance

### 4.1 La suite d'intégration ne nettoie pas derrière elle

`npm run test:wp` crée des commandes et des lots d'impression et n'en supprime
aucun. Au bout d'une quinzaine d'exécutions, `Production::queue()` renvoie
davantage que ce que l'assertion « lets a draft be undone » attend, et **trois
assertions de la suite production deviennent rouges pour une raison qui n'est pas
du code**.

Mesuré : après une journée de séance, 179 commandes et 269 lots de résidu ; une
fois retirés, la suite repasse à 207 vertes. Le nettoyage utilisé :

```
npm run wp:cli -- eval '
global $wpdb;
$ids = $wpdb->get_col("SELECT id FROM {$wpdb->prefix}wc_orders WHERE date_created_gmt >= \"AAAA-MM-JJ 00:00:00\"");
foreach ($ids as $id) { $o = wc_get_order((int)$id); if ($o) $o->delete(true); }
$lots = $wpdb->get_col("SELECT ID FROM {$wpdb->prefix}posts WHERE post_type=\"ts_lot\" AND post_date_gmt >= \"AAAA-MM-JJ 00:00:00\"");
foreach ($lots as $id) { wp_delete_post((int)$id, true); }'
```

`docker compose -f wp-local/docker-compose.yml down -v` puis
`wp teeshoop provisionner` fait la même chose plus brutalement.

**La vraie correction appartient à la suite** : chaque sous-suite devrait
supprimer ce qu'elle crée, comme `integration.php` le fait déjà pour ses trois
produits. Ce n'était pas le sujet de la séance 12 et le faire aurait mélangé deux
changements dans un diff déjà large.

### 4.2 `wp-plugins/teeshoop-core/README.md` est servi publiquement

Mesuré : `GET /wp-content/plugins/teeshoop-core/README.md` renvoie 200 et
63 093 octets de documentation d'extension à qui la demande. `scripts/php-guard.mjs`
ne scanne pas le `.md`, donc rien ne regarde ce qui s'y trouve.

Ce n'est pas une fuite connue aujourd'hui, c'est un trou dans la frontière que
php-guard existe pour défendre. Correction : ajouter `.md` à `SCAN_EXT`, avec une
entrée `ALLOWED` et une raison pour ce qui est légitimement public.

### 4.3 Aucun fichier de test du Worker n'est typé

`worker/tsconfig.json` n'inclut que `index`, `falkross`, `xml` et `auth` ;
`design.ts` n'entre que transitivement et `worker/*.test.ts` n'entre pas du tout.
Vitest transpile sans vérifier, donc les 60 cas de `design.test.ts` ne sont
typés par rien.

---

## 5. Ce qu'il faut savoir avant de toucher à ce que la séance a construit

1. **Une version des CGV ne se modifie jamais.** `data/cgv/2026-08-26.php` est le
   texte qu'un client a accepté ; son nom est enregistré sur sa commande. Une
   correction, même d'une virgule, se fait en déposant un fichier daté du jour où
   elle prend effet. `Terms::checked()` refuse la divergence en exigeant
   exactement cela.

2. **Les chiffres des CGV sont gelés, à l'inverse de tout le reste du dépôt.**
   `Content.php` résout chaque figure au rendu ; un contrat ne peut pas.
   `Terms::states()` compare sur une frontière de chiffre et non par sous-chaîne,
   parce que « 0,00 € » est une sous-chaîne de « 300,00 € » et que cette
   confusion a coûté un vrai défaut d'argent.

3. **Les quatre pages sont rendues par l'extension**, pas par le thème, pour
   qu'un changement de thème ne laisse pas une boutique française sans mentions
   légales. Leur création se fait par `wp teeshoop juridique`, qui est sûre en
   production, et non par `wp teeshoop provisionner`, qui réécrit les réglages de
   TVA.

4. **`Consent::VERSION` est à 2.** Toute reprise d'un cookie de choix doit passer
   par le bouton plutôt que par une chaîne écrite à la main : `site-shots.mjs`
   écrivait `v1:` et a photographié pendant un commit un site dont le bandeau
   était resté ouvert, sans que rien devienne rouge.

5. **`npm run ci` verte n'est pas « CI verte »**, et l'inverse non plus. Les cinq
   contrôles qui tiennent tout le travail de conformité ont besoin du miroir et
   ne tournent pas sur push. L'en-tête de `.github/workflows/ci.yml` les nomme.

6. **Ne pas balayer les tirets cadratins en passant.** La séance 12 n'en a ajouté
   aucun (vérifié sur le diff : zéro ligne ajoutée en contient), et le corpus
   existant en compte environ 2 460. Le balayage est l'item 8 de la séance 13 et
   il se fait en une passe délibérée.

---

## 6. Ce que la séance 13 hérite directement

- Les deux items de dette d'accessibilité que la séance 12 n'a pas traités parce
  qu'ils sont dans le studio et non sur le parcours d'achat : le sélecteur de
  scène est un `listbox` en ARIA et pas en comportement (noté dans
  `docs/ROADMAP.md`), et la `Modal` du studio pose `aria-modal="true"` sans piège
  de focus, ce qui est pire que pas d'`aria-modal` du tout.
- Le trou 4.2 ci-dessus est de la sécurité et tombe dans son périmètre.
- `H-Q40-CONSERVATION-DEVIS` est la seule ligne du registre à nommer une séance
  future dans `sessions` ; elle est à relire quand Q40 sera répondue.
