# RGPD : ce que la boutique fait des données, et ce qui reste à décider

> Ce document décrit l'état réel du code au 26 août 2026. Il n'est pas un avis
> juridique. Les textes publiés sur le site (mentions légales, conditions
> générales, politique de confidentialité, déclaration d'accessibilité) sont des
> **projets rédigés en interne, non relus par un avocat**, et chacun le dit sur
> sa propre page. La question 18 de `QUESTIONS-ASSOCIE.md` demande cette
> relecture.

Le registre lui-même n'est pas ici. Il est dans le code, à
`wp-plugins/teeshoop-core/includes/Privacy.php`, parce que c'est ce que la page
`/confidentialite/` affiche : un registre tenu à côté du code décrit la boutique
de mémoire, et il se met à mentir sans que personne s'en aperçoive. Ce document
dit **les décisions** et **ce qui manque**.

---

## 1. Suivre la donnée : où elle est, et ce qu'un effacement atteint

Un client n'est pas dans un seul endroit. Les quatre suivants sont réels et
mesurés sur le miroir.

| Où | Ce qu'il y a | Ce que fait un effacement |
|---|---|---|
| La commande WooCommerce | nom, société, adresses de facturation et de livraison, courriel, téléphone, SIRET, adresse IP, agent utilisateur | vidée, y compris les clés `_wc_order_attribution_*` que l'éraseur de WooCommerce ne touche pas |
| Le bon à tirer figé (`_teeshoop_bat`) | **une seconde copie** du nom, de la société et du courriel, plus l'IP et le navigateur de la validation, plus les commentaires écrits par le client | les personnes en sortent, la preuve reste : la date, la version approuvée et la phrase acceptée survivent |
| Les créations dans R2 (Cloudflare) | le document de création, les fichiers téléversés par le client, les aperçus rendus | supprimées par `DELETE /api/design/{id}` sur le Worker |
| Le journal d'envoi (`wp_teeshoop_mail`) | l'adresse du destinataire et l'objet du message | l'adresse est effacée, la ligne reste : elle est ce qui signale un message jamais parti |

Et **la facture reste**, avec le nom et l'adresse de l'acheteur, pendant dix ans
(article L123-22 du code de commerce). C'est la seule exception, elle est écrite
dans la réponse faite à la personne, et elle n'est possible que parce que la
séance 04 a **figé** la facture au moment de son émission : la pièce comptable
vit dans un endroit séparé de la copie de travail, donc la copie de travail peut
partir.

### Ce que l'effacement refuse de faire

`Privacy::erase_order()` supprime **les créations en premier**, et si le Worker
ne répond pas il **ne touche à rien d'autre**. Deux raisons, et la seconde est
la moins évidente :

1. « Nous n'avons pas pu demander » n'est pas « c'est supprimé ». Ce dépôt a déjà
   payé cette confusion une fois, en supprimant le calque d'un client à la fois
   du transfert et du prix.
2. **Le méta de la commande EST l'index.** Vider la commande puis découvrir que
   R2 est injoignable laisserait des fichiers que plus personne ne peut
   retrouver.

`tests/integration-rgpd.php` vérifie les deux moitiés contre un vrai WooCommerce,
en répondant au Worker par `pre_http_request`, donc le vrai `wp_remote_request`
construit le vrai `DELETE` et le vrai en-tête `Bearer`.

### Ce qu'un effacement ne peut pas atteindre, dit franchement

- **Les créations orphelines.** Un panier abandonné laisse une création complète
  dans R2, rattachée à personne : l'identifiant n'est écrit nulle part côté
  boutique tant que la ligne n'est pas dans une commande ou un devis. Aucun
  effacement fondé sur une identité ne peut les atteindre. C'est
  `POST /api/design/reap` qui les balaye, à qui la boutique passe la liste des
  identifiants qu'elle détient encore et une date. **Aucune tâche ne l'appelle
  encore** : voir la section 4.
- **Le cache de diffusion.** Un aperçu est servi `public, max-age=31536000,
  immutable` parce qu'un courriel de bon à tirer le recharge. Une copie peut donc
  survivre à l'objet R2 dans le cache de Cloudflare. Non mesuré, faute de
  déploiement.
- **Brevo.** Le code n'appelle que `POST /v3/smtp/email`. Aucun contact n'est
  créé par nous. Ce que Brevo conserve de ses propres journaux d'envoi relève de
  l'avenant de traitement, pas d'un appel que nous pourrions faire : **il n'y a
  pas de route de suppression côté Brevo dans ce code, et il ne faut pas laisser
  croire le contraire.** Le compte n'est d'ailleurs pas encore ouvert.

---

## 2. Les sous-traitants, tirés des appels et non d'une liste de fournisseurs

Le tableau vit dans `Privacy::processors()`. Chaque ligne vient d'un endroit
précis du code, et une ligne est là **en exclusion** :

- **o2switch**, hébergeur du site et de la base : tout sauf les créations.
- **Cloudflare**, le Worker et R2 : les créations, les fichiers du client, les
  aperçus.
- **Stripe**, le paiement : les coordonnées de facturation et la carte. Aucune
  donnée de carte ne passe par nos serveurs.
- **Brevo**, les courriels transactionnels : l'adresse, le nom, l'objet et **le
  corps du message**, ce qui inclut le lien de validation d'un bon à tirer, donc
  une clé vers une page de données personnelles.
- **Colissimo**, le transport : nom, adresse, téléphone du destinataire.
- **Le cabinet comptable** : factures et encaissements. Il n'est pas désigné.
- **Les fournisseurs textiles : rien.** `Supply::place_order()` n'envoie que des
  références d'articles et une clé de commande interne, et le Worker ne remplit
  jamais le champ d'adresse de livraison que l'API accepte. Les colis vont à
  l'atelier. C'est écrit ici parce que « nous avons vérifié et ils ne reçoivent
  rien » et « nous n'y avons pas pensé » ne doivent pas se lire pareil.

**Aucun avenant de traitement n'est signé à ce jour.** C'est le point 3 de la
liste finale.

---

## 3. Ce qui est écrit sur l'appareil d'un visiteur

Article 82 de la loi Informatique et Libertés : il couvre toute écriture ET toute
lecture d'un terminal, cookie ou non. Le détail est dans `Privacy::trackers()` et
la page `/confidentialite/` l'affiche.

Le défaut trouvé et corrigé cette séance mérite d'être écrit ici : **la mesure
d'origine de commande de WooCommerce 11 écrivait sept cookies avant tout choix**,
dont un portant l'agent utilisateur complet, et refuser n'en enlevait aucun. Les
scripts ne sont plus chargés du tout tant que le visiteur n'a pas accepté, et
tout cookie `sbjs_` déjà présent est expiré côté serveur.

Le contrôle est `npm run verify:consent` : il pilote un vrai navigateur, parce
que le contrôle qui existait lisait les en-têtes `Set-Cookie` et ne pouvait pas
voir un cookie écrit en JavaScript.

---

## 4. Ce qui manque, et qui doit le décider

1. **L'identité légale du vendeur** (question 17). Sans elle, la page des
   mentions légales publie la liste de ce qui manque, la facture est refusée en
   production et la validation d'une commande l'est aussi. C'est le premier
   verrou.
2. **Le responsable de traitement**, nommément (question 19). La politique de
   confidentialité ne peut pas le désigner à sa place.
3. **Les avenants de traitement** de Stripe, Brevo, Cloudflare et o2switch, plus
   le contrat du cabinet comptable et celui du transporteur. Aucun n'est signé.
4. **La durée de conservation des créations** (question 33). Le balayage existe
   (`POST /api/design/reap`), aucune tâche ne l'appelle et aucune durée n'est
   fixée. L'hypothèse écrite de la question 33 dit trois ans pour les fichiers de
   production et un an pour les aperçus ; ce sont deux durées, donc deux règles,
   et personne ne les a tranchées.
5. **Le médiateur de la consommation** (article L612-1). Un professionnel qui
   vend à des consommateurs doit en désigner un et publier ses coordonnées. Il
   n'y en a pas. Les conditions générales le disent en toutes lettres plutôt que
   de laisser la ligne vide.
6. **Le contrat de sous-traitance des prospectrices à Madagascar** (question 28).
   Rien n'est construit : aucun accès, aucun compte, aucune donnée. C'est un
   refus assumé et non un oubli, et il le reste tant que le contrat n'existe pas.
7. **La purge à dix ans des factures.** La conservation est écrite, le balayage
   qui la termine ne l'est pas. Il n'y a aucune commande de dix ans sur laquelle
   l'éprouver aujourd'hui, et un cron que rien ne peut tester est pire qu'une
   ligne dans ce document.

---

## 5. Comment une demande se traite, concrètement

WordPress a déjà l'outillage : **Outils > Exporter les données personnelles** et
**Outils > Effacer les données personnelles**. Une demande y est saisie avec
l'adresse du client, la personne reçoit un courriel de confirmation, et la
demande ne s'exécute qu'après. Nos exportateurs et nos éraseurs y sont branchés :

- `teeshoop-commandes` : les commandes, leurs créations, leur renonciation, leurs
  factures.
- `teeshoop-devis` : les demandes de devis et les devis émis.
- `teeshoop-messages` : les traces d'envoi.

Ce que l'écran affichera, et qu'il faut lire plutôt que survoler :

- « éléments conservés » sera **vrai** sur toute commande facturée. C'est la
  facture, et le message le dit.
- Si une création n'a pas pu être supprimée, la demande **n'est pas terminée**
  et le message donne la raison. Il faut la relancer une fois le service joignable.

Le délai légal de réponse est d'un mois.
