# Feuille de route de teeshoop.com

État au 13 août 2026. Ce document dit **où en est le projet** et **ce qu'il reste à
faire**, dans l'ordre. Il est volontairement court : le détail vit dans le code et dans les
messages de commit.

---

## Ce qui est fait

**Le socle et la sécurité (R0).** Le Worker Cloudflare est fermé par défaut : sans le
secret `ADMIN_TOKEN`, tout `/api/fr/*` et la page `/admin` sont refusés. Le bundle client
a été séparé du bundle admin : nos prix d'achat, notre modèle de coût film et le
formulaire d'identifiants WooCommerce ne partent plus dans le JavaScript d'un visiteur, et
deux garde-fous automatiques empêchent la régression. Une faille de cache qui exposait nos
prix d'achat par une simple requête a été fermée. Le premier affichage du studio a été
réduit de 58 % (React voyageait à l'intérieur du morceau three.js).

**L'autorité de prix (plugin `teeshoop-core`).** Le prix payable est calculé en PHP, sur le
serveur. Il n'y a **aucun champ prix** dans la requête d'ajout au panier : le panier
enregistre les choix du client et recalcule le prix à chaque passage. Tout est en centimes
entiers ; « 14,50 » saisi à la française est lu correctement. Le chapitre 1 de la Bible est
encodé, **avec une formule corrigée** : le prix plancher publié majore le *coût* du taux de
commission alors que la commission porte sur la *marge*. À 250 € de coût, 100 € de marge
cible et 40 % de commission, le vrai plancher est **416,67 €** et non 583,33 €. Le test
garde les deux versions côte à côte.

**Le DTF : chaque visuel est mesuré par son encre.** Un visuel était mesuré par le rectangle
dans lequel il avait été déposé, si bien que les marges transparentes d'un logo client étaient
achetées en film et facturées au client. Mesuré sur une commande de 20 vêtements avec des
fichiers clients réalistes : **220 cm de rouleau ramenés à 60 cm**, 1,28 m² de film ramenés
à 0,35 m². Au tarif de lancement de la Bible (17 € HT/mètre linéaire en France) : **37,40 €
ramenés à 10,20 €**. C'est exactement ce que demande le chapitre 1 : « largeur et hauteur
de chaque **visuel** ».

La même mesure fixe désormais le prix client, en cm², ce qui corrige trois surfacturations :
les marges transparentes, l'espace vide entre deux visuels d'une même face (59 % de la
facture sur le design d'exemple), et un visuel débordant de la zone d'impression qui était
facturé en entier.

**La remise du design.** Le fichier d'un client n'existait que dans son propre navigateur.
Il est maintenant déposé sur R2 via le Worker, et WordPress vérifie son existence avant
d'accepter la ligne de panier : une commande impossible à imprimer est refusée avant le
paiement, pas découverte après. Vérifié de bout en bout : identifiant réel → panier à
271,75 € calculé par le serveur ; identifiant inventé → refusé.

**La boucle est fermée : du studio au panier.** Un visiteur ouvre le studio sur une fiche
produit, dessine, clique « Ajouter au panier », et une ligne WooCommerce apparaît avec un
identifiant de création vérifié et un prix que WordPress a calculé lui-même. Vérifié de bout
en bout par `npm run verify:wp-e2e` : 29 assertions, contre un vrai navigateur, un vrai
Worker et un vrai panier. Le prix affiché dans le studio, celui enregistré sur la ligne et
le sous-total du panier sont le même nombre, et c'est celui de `Pricing::quote()`.

Deux entrées de prix ont cessé d'arriver du navigateur au passage. **Le vêtement** est
désormais déclaré sur la fiche produit : il décide du prix du textile nu, et une requête
pouvait auparavant annoncer « custom » (textile à 0 EUR, le client fournit le sien) sur un
sweat et emporter 27 EUR de textile pour rien. **Les surfaces imprimées** viennent du
fichier de création que le Worker a confirmé, donc la facture et le film mesurent la même
chose. Trois autres défauts ont été trouvés en regardant la vraie page : les devis
échouaient silencieusement sur une boutique aux permaliens simples, le panier annonçait une
remise de 2 115,50 EUR qui n'a jamais existé (prix de référence fictif, interdit en France),
et une boutique réglée en dollars affichait des euros avec un dollar devant.

**L'outillage.** Un miroir local de la production (WordPress 7.0.3 + WooCommerce 11.0.1 en
docker), 136 tests JavaScript, 46 tests PHP purs, 11 tests d'intégration WooCommerce, une
vérification de bout en bout du parcours d'achat, et des scripts de vérification qui font
tourner le vrai code dans un vrai navigateur.

---

## Ce qu'il reste : quinze séances

Le détail exécutable de chacune vit dans `prompts/` (non versionné : ce sont des
instructions de travail, elles changent plus vite que le code).

| # | Séance | Bloquée par |
|---|---|---|
| ~~01~~ | ~~Boucler la boucle : du studio au panier WooCommerce~~ **faite** | - |
| 02 | Fiche produit, grille de prix, demande de devis | 01 |
| 03 | Catalogue : Falk&Ross vers WooCommerce, à l'échelle | - |
| 04 | Paiement : Stripe, TVA, livraison, facture | 02, 03 |
| 05 | Moteur de coût, prix plancher, commissions | - |
| 06 | BAT, cycle de vie de la commande, e-mails | 04 |
| 07 | Production : imbrication du film entre commandes | 06 |
| 08 | Commande fournisseur et stock | 03, 07 |
| 09 | Le site : accueil, navigation, système de design | 02 |
| 10 | Le studio en vitrine : 3D et mockups | 09 |
| 11 | Référencement, contenu, données structurées | 09 |
| 12 | Juridique, RGPD, accessibilité | 09 |
| 13 | Performance, sécurité, supervision | 09, 10 |
| 14 | Déploiement : préproduction, pipeline, purge de la démo | **SSH + cPanel** |
| 15 | Répétition générale et mise en ligne | 14 |

**Seules les séances 14 et 15 exigent les accès o2switch.** Tout le reste se construit et
se vérifie sur le miroir local.

---

## Ce qui bloque, et qui peut le débloquer

| Blocage | Qui | Détail |
|---|---|---|
| SSH o2switch | associé | Clé publique déjà générée, dans `ACCES-REQUIS.md`, à importer **et autoriser** dans cPanel |
| cPanel | associé | Préproduction, version de PHP, cron réel, Redis |
| Compte admin WordPress nominatif | associé | Pas de compte partagé |
| Clés API WooCommerce | associé | Lecture/écriture |
| La vraie grille tarifaire | associé | Question 04 de `QUESTIONS-ASSOCIE.md` ; les prix actuels sont des **valeurs de démonstration** |
| Clés Stripe (test puis production) | associé | Séance 04 |
| Compte Brevo | associé | Séance 06 |
| `FR_CUSTOMER_NR` | associé | Séance 08. Absent des secrets, donc aucune commande fournisseur n'a jamais pu partir |

`QUESTIONS-ASSOCIE.md` contient 37 questions auxquelles seul l'associé peut répondre. Q04
(la grille tarifaire) conditionne une grande partie de la séance 05. La 37e vient d'être
ajoutée : un même visuel n'a pas la même surface sur un S et sur un 3XL, et il faut savoir
si les deux se facturent au même prix.

---

## Quatre choses à savoir avant de toucher au code

1. **Le serveur calcule le prix.** Le studio affiche ce qu'on lui dit. Deux implémentations
   des mêmes règles finissent toujours par diverger, et le jour où elles divergent le client
   voit un chiffre et la facture en dit un autre.

2. **Fermé par défaut.** Un secret absent refuse tout. Un design non vérifiable refuse la
   ligne de panier. Une panne réseau n'est pas un feu vert.

3. **La couture entre du code correct et WooCommerce est là où l'argent se perd.** Le
   calcul de prix était juste ; un garde-fou recopié de tous les tutoriels sautait tous les
   recalculs sauf le premier, et un client qui passait de 9 à 50 pièces gardait l'ancien
   tarif. C'est pour cela qu'il existe une suite de tests contre un vrai panier WooCommerce
   en plus des tests purs.

4. **Une entrée de prix ne vient jamais du navigateur.** Pas seulement le prix : le
   vêtement vient de la fiche produit, les surfaces imprimées viennent du fichier de
   création déposé sur le serveur. Tout ce qu'une requête d'ajout au panier peut encore
   décider, c'est la quantité, que le client contrôle de toute façon depuis le panier.
