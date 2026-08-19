# Questions à valider — Teeshoop

**Pour :** le dirigeant de Teeshoop
**De :** l'équipe de développement
**Date :** 12 août 2026

---

## Comment utiliser ce document

On a lu **toute** « La Bible de Teeshoop » (les 8 documents), on a analysé le site
teeshoop.com tel qu'il est en ligne aujourd'hui, et on a analysé le code de l'outil de
personnalisation déjà développé. Ce document ne contient **que** les questions
auxquelles vous êtes le seul à pouvoir répondre : des décisions commerciales,
financières, juridiques ou d'atelier. Tout ce qui est purement technique, on le tranche
nous-mêmes (liste à la fin).

**Vous n'avez pas besoin de tout répondre d'un coup.** Chaque question porte un niveau :

| Niveau | Sens |
|---|---|
| 🔴 **Bloquant** | On ne peut pas avancer sur ce sujet tant qu'on n'a pas la réponse |
| 🟠 **Important** | On peut commencer, mais on devra refaire une partie si la réponse change |
| 🟡 **Utile** | Ça affine le résultat |
| ⚪ **Secondaire** | À voir plus tard |

Chaque question indique aussi **l'hypothèse par défaut** : ce qu'on fera si vous ne
répondez pas. Si l'hypothèse vous convient, vous pouvez simplement écrire « OK ».

Répondez directement sous chaque question, dans le bloc « Votre réponse ».

---

## Ce que nous faisons en attendant vos réponses

**Décision du 18 août 2026.** Vous n'avez pas eu le temps de répondre, et arrêter le
développement coûterait plus cher que d'avancer. Nous construisons donc la suite du site
**sur les hypothèses par défaut écrites dans ce document**, celles qui figurent sous
« Si vous ne répondez pas, on partira sur ». Rien n'est mis en ligne, rien n'est vendu, et
aucun client ne voit quoi que ce soit avant que nous ayons repris vos réponses une par une.

Trois règles encadrent cette décision, pour qu'elle reste réversible :

1. **Chaque valeur supposée est inscrite dans un registre**, avec un seul endroit dans le
   code où elle existe. Corriger une réponse tardive revient alors à changer un réglage, et
   non à fouiller trois mois de développement pour retrouver où le chiffre a été recopié.
2. **Un montant supposé est signalé comme tel** à l'écran, pour vous et pour l'atelier. Un
   nombre inventé qui ressemble à un nombre validé est le pire des deux mondes.
3. **La mise en ligne est bloquée automatiquement** tant qu'une réponse bloquante manque
   sur un nombre qu'un client, un fournisseur ou une imprimante finit par voir. Ce n'est pas
   une note dans un document, c'est un contrôle qui refuse de laisser passer.

Une séance de travail entière est réservée à vos réponses, juste avant la mise en ligne.

### Là où ce que nous avons construit n'est pas l'hypothèse par défaut

Le 18 août, en inscrivant une par une les valeurs supposées dans un registre
(`docs/hypotheses.json`, 41 lignes, avec un contrôle automatique derrière), nous avons
relu ce que les séances 01 à 04 avaient réellement livré. Six points ne suivaient pas
l'hypothèse par défaut écrite plus bas dans ce document. Une hypothèse par défaut que
personne n'a suivie est pire que pas d'hypothèse du tout, donc les voici, **dont deux
que la séance 04 a refermés le jour même**.

| Question | Ce que ce document annonce | Ce qui est réellement construit |
|---|---|---|
| **01** | minimum 5 pièces et 50 EUR HT, bloquant à la validation du panier | **construit le 18/08**. Le panier refuse en dessous, et la grille publique commence désormais à 5 pièces et non à 1. Réserve : au tarif livré, 5 t-shirts font 72,50 EUR HT, donc le minimum de 50 EUR ne mord jamais |
| **17** | la TVA construite comme une période datée, avec un mode franchise | **construit le 18/08**. Périodes datées, mode franchise, mention « TVA non applicable, article 293 B du CGI », aucun seuil dans le code. Ce qui reste supposé, c'est le régime lui-même : nous partons sur assujettie, la boutique est réglée en franchise de fait |
| **09** | 300 références (t-shirts, polos, sweats, softshells, haute visibilité) | **459 références**, sans plafond, et **trois familles**. Le softshell est activement écarté, la haute visibilité n'existe pas |
| **08** | une grille publique sur 6 paliers de quantité | **5 colonnes**, déduites des 3 paliers de remise enregistrés. Et la remise atteint 35 % en autonomie, là où la question 06 annonce un plafond de 15 % |
| **32** | découpe automatique quand elle économise plus d'environ 100 cm² par vêtement | une découpe **géométrique** : deux encres séparées de plus de 5 mm deviennent deux transferts, même si l'économie est nulle |
| **04** | 17 EUR HT le mètre linéaire en France | ce tarif n'est écrit dans **aucun code**. Le calcul de coût film utilise des tarifs publics relevés en juillet 2026, nettement inférieurs, et aucun fournisseur espagnol n'existe |

Aucun de ces écarts n'est en ligne et aucun client n'en voit la conséquence aujourd'hui.
Chacun est une ligne du registre, avec son unique emplacement dans le code et ce que
coûterait de le changer. Votre réponse reste ce qui tranche.

### Les quatre questions qui tiennent en un message

Si vous ne devez répondre qu'à quatre choses cette semaine, ce sont celles-là : ce sont des
oui ou non, et ce sont les seules où une mauvaise hypothèse nous oblige à refaire plutôt
qu'à régler.

- **Question 2** : un client peut-il payer seul en ligne, ou tout doit-il passer par un
  devis que vous validez ?
- **Question 1** : acceptez-vous les particuliers, ou professionnels uniquement ?
- **Question 17, la moitié seulement** : la société facture-t-elle la TVA, oui ou non ? Le
  détail des mentions légales peut attendre. Le régime, non : la boutique a déjà encaissé
  15 commandes avec le calcul des taxes désactivé (constat 6).
- **Question 20** : pouvons-nous supprimer les 47 produits de démonstration du site en
  ligne, et désactiver Fancy Product Designer ?

Quatre autres demandent d'aller chercher un document, donc autant les lancer maintenant même
si la réponse met deux semaines : **3** (vos grilles d'achat réelles), **4** (vos tarifs DTF
négociés), **17** (l'identité légale complète) et **31** (le logo en fichier vectoriel, vos
couleurs, vos polices).

### Ce que coûte une réponse tardive

Pour vous aider à choisir par quoi commencer. Le coût est celui du moment où la réponse
arrive juste avant la mise en ligne plutôt que maintenant.

| Coût | Questions | Ce qu'il faut refaire |
|---|---|---|
| **On refait une partie** | 1, 2, 8, 12, 17, 20, 31, 35, 41 | Ces réponses ne changent pas un nombre, elles changent la forme de ce qui est construit : qui peut acheter, comment le prix est calculé, quelles techniques existent en ligne, à quoi ressemble la marque, dans quels pays on livre |
| **Un réglage et une remesure** | 3, 4, 5, 6, 9, 14, 15, 22, 29, 32, 37 | Le réglage est immédiat, mais tous les montants que nous aurons annoncés en euros en découlent (coût de revient, prix plancher, économie de film, panier d'achat fournisseur). Il faut les remesurer, pas les recalculer de tête |
| **Un réglage** | 7, 10, 11, 13, 16, 23, 24, 25, 26, 27, 30, 33, 34, 36, 38, 39, 40, 42, 43, 44 | Une valeur change dans l'administration, et c'est tout. La question 42 en est l'exemple : un seul taux, et les 26 392 articles du catalogue deviennent commandables |
| **Nous ne construisons rien avant** | 18, 19, 28 | Ce sont des questions juridiques. Nous préparons le mécanisme et laissons le fait vide. En particulier, **le fichier de 150 000 entreprises ne sera ni importé ni utilisé** tant que son origine n'est pas documentée (question 19) |

La question **21** (accès et propriété) est réglée depuis le 14 août : tous les accès
techniques sont en place et ont été essayés un par un.

---

## Avant tout : 7 constats sur l'existant

Ce ne sont pas des reproches, ce sont des faits vérifiés qui changent le plan :

1. **Le site en ligne vend aujourd'hui des meubles.** Sur les 47 produits présents,
   44 sont des articles de démonstration du thème acheté (chaises Eames, lampes,
   tables — jusqu'à 3 620 €) plus 2 tapis d'acupression. Seuls **3** sont du textile.
   Il n'y a qu'une seule catégorie, appelée « Tout ». La page d'accueil est encore la
   page de démonstration « home-furniture2 ». Et **Google indexe tout ça en ce moment**.

2. **Le tarif DTF de la Bible semble faux, et dans le mauvais sens.** La Bible retient
   17 € HT le mètre linéaire en France. Les tarifs réellement relevés auprès de
   fournisseurs français lors de nos recherches sont plutôt de **5,45 € à 9,90 € HT le
   mètre linéaire**. Le « 17 € » correspond en réalité au prix TTC d'une **feuille**
   55 × 100 cm chez un fournisseur, pas à un mètre linéaire HT. Conséquence : si on
   applique la Bible telle quelle, on facture le marquage environ **3 fois trop cher**
   et on se met hors marché. Il nous faut vos **vraies factures**.

3. **La formule du prix plancher de la Bible est mathématiquement fausse.** La Bible
   écrit `Prix plancher = (Coût + contribution minimale) / (1 − taux de commission)`.
   Comme la commission se calcule sur la marge (et non sur le prix), la bonne formule
   est `Prix plancher = Coût + contribution minimale / (1 − taux de commission)`.
   Avec un coût de 250 €, une contribution minimale de 50 € et 40 % de commission :
   la Bible donne **500 €**, le calcul correct donne **333 €**. Telle quelle, la règle
   bloquerait vos commerciaux sur des affaires parfaitement rentables.

4. **La Bible décrit deux entreprises différentes en même temps** : d'un côté un modèle
   B2B sur devis (minimum 5 pièces, panier 500–1 000 €, commerciaux à 40 %), de l'autre
   un parcours d'achat en autonomie type grand public — qui est aussi ce que font les
   deux concurrents cités en exemple (mistertee.fr, tostadora.fr). Ce sont deux sites,
   deux tunnels et deux organisations. **Il faut choisir lequel est prioritaire** (voir
   les deux premières questions).

5. **La Bible ne mentionne nulle part l'outil déjà construit.** L'éditeur de
   personnalisation (2D, 3D, réalité augmentée, fichiers d'impression 300 DPI,
   optimisation du film DTF, connexion Falk & Ross) représente ~49 000 lignes de code
   déjà écrites. C'est l'actif le plus avancé du projet et il n'apparaît dans aucun des
   8 documents.

6. **La TVA n'est pas activée sur la boutique, et 15 commandes sont déjà passées.**
   Constaté le 14 août 2026 en accédant au serveur : WooCommerce est réglé en euros,
   pays France, avec le calcul des taxes **désactivé**. Les 15 commandes existantes
   ont donc été encaissées sans ligne de TVA.

   Le détail, pour que la question soit facile à trancher : les 15 commandes sont
   toutes au statut « terminé », étalées du **21 novembre 2024 au 18 avril 2025**,
   pour un total de **465,79 EUR**. Elles ont été payées par carte (12), Apple Pay (2)
   et Google Pay (1), donc via Stripe. Aucune commande depuis avril 2025, et
   **aucun moyen de paiement n'est activé aujourd'hui** : les réglages Stripe ne
   contiennent plus aucune clé. En l'état, la boutique ne peut donc rien encaisser.

   Deux cas possibles, et la réponse n'est pas la même :
   - la société est en franchise en base de TVA, et il manque alors la mention légale
     obligatoire « TVA non applicable, article 293 B du CGI » sur les factures ;
   - la société est assujettie, et il y a une régularisation à faire avec votre
     comptable sur ces 15 commandes.

   Dans les deux cas il faut le régler **avant** la prochaine vente, pas après. C'est
   l'objet de la question 17. Vu les montants (465,79 EUR sur cinq mois), le régime de
   franchise en base est plausible, mais c'est à votre comptable de le dire, pas à nous.

7. **La facturation électronique arrive, et la première échéance est passée de peu.**
   Constaté le 18 août 2026 en relisant les textes pour construire les factures. La
   réforme n'a pas été repoussée : **au 1er septembre 2026, toute entreprise, quelle que
   soit sa taille, doit être capable de RECEVOIR une facture électronique** par une
   plateforme agréée. L'obligation d'en ÉMETTRE ne s'applique aux TPE et PME qu'au
   **1er septembre 2027**. Concrètement, dans deux semaines :

   - il faut avoir **choisi une plateforme agréée** et s'y être raccordé, ne serait-ce que
     pour recevoir les factures de vos fournisseurs. L'administration écrit noir sur blanc
     que l'entreprise qui n'en a pas désigné doit engager la démarche « sans attendre » ;
   - le PDF que le site enverra à vos clients reste **valable** : les factures à des
     particuliers sont hors du champ, et pour les professionnels l'obligation d'émettre
     ne vous concerne qu'en septembre 2027. Nous avons donc du temps sur ce point-là, et
     aucun sur la réception ;
   - un PDF ordinaire ne suffira pas en 2027. Le format cible s'appelle Factur-X et c'est
     un PDF qui embarque un fichier structuré. Nous le construirons quand la plateforme
     sera choisie, parce que le format dépend d'elle.

   **Ce n'est pas une question de développement, c'est une démarche à faire chez votre
   comptable ou votre banque.** Nous l'écrivons ici parce que personne d'autre ne vous le
   dira à temps.

---

## Modèle commercial

### 1. Acceptez-vous les commandes de particuliers, ou le site est-il réservé aux professionnels ? Et le minimum de 5 pièces / 50 EUR s'applique-t-il vraiment à tout (toutes techniques, tous produits), ou avez-vous des exceptions ?

🔴 **Bloquant**

*Pourquoi on a besoin de la réponse :* Cela décide si on bloque le panier sous le minimum, si on demande le SIRET à l'inscription, si les prix s'affichent hors taxes ou toutes taxes comprises par défaut, et s'il faut construire un parcours d'achat grand public. Ces choix touchent le panier, la fiche produit et le moteur de prix : les changer après coup coûte plusieurs jours.

*Si vous ne répondez pas, on partira sur :* Site réservé aux professionnels, SIRET demandé mais non bloquant, minimum 5 pièces et 50 EUR hors taxes bloquant à la validation du panier, prix affichés hors taxes avec le montant toutes taxes comprises en second.

*Ce que la séance 04 a trouvé, le 18 août :* le minimum est construit et il bloque bien à
la validation du panier, sur les deux parcours (l'ancien et le nouveau tunnel WooCommerce).
Mais **la moitié « 50 EUR » ne sert à rien au tarif actuel** : cinq t-shirts imprimés font
72,50 EUR hors taxes, et il faudrait descendre sous 10,00 EUR la pièce pour que le montant
refuse quoi que ce soit. La Bible écrit « 50 EUR » trois fois sans jamais préciser hors
taxes ou toutes taxes comprises, ni par ligne ou par panier. Confirmez-vous les deux
chiffres, ou le minimum est-il en réalité **uniquement** un nombre de pièces ?

*Ce que la séance 05 a ajouté, le 18 août :* nous avons besoin de savoir **comment vous
classez vos clients**, parce que le prix plancher peut désormais dépendre du type de
client (le chapitre 1 le demande explicitement).

Faute de liste dans vos documents, nous en avons composé une à partir de ce que vos
propres questions nomment déjà : **particulier** et **professionnel** (cette question-ci),
**collectivité** (le « mandat administratif : mairies, écoles, hôpitaux » de la question
15) et **grand compte** (la question 16). Ce ne sont pas des inventions, mais ce ne sont
pas non plus vos mots. Confirmez la liste ou remplacez-la.

Rien n'est faussé en attendant : aucune commande ne porte de type de client tant qu'un
opérateur ne l'a pas choisi, et une règle qui sélectionne sur un type ne s'applique donc
à aucune commande.

**Votre réponse :**

> 

### 2. Voulez-vous qu'un client puisse voir un prix complet et payer seul en ligne dès le lancement, ou bien toute commande doit-elle passer par un devis que vous validez ?

🔴 **Bloquant**

*Pourquoi on a besoin de la réponse :* Ce sont deux chantiers différents et on ne peut pas livrer les deux en même temps : soit on développe d'abord le prix public et le paiement en autonomie, soit on développe d'abord l'outil de devis interne pour vos commerciaux. Tout le calendrier de développement dépend de cette réponse.

*Si vous ne répondez pas, on partira sur :* Prix public et paiement en autonomie jusqu'à 250 pièces ou 2 000 EUR hors taxes ; au-delà, passage obligatoire par un devis.

**Votre réponse :**

> 


## Prix et coûts

### 3. Pouvez-vous nous transmettre vos grilles d'achat textiles réelles (Falk & Ross, Imbretex), avec vos remises négociées, les frais de port fournisseur et le montant à partir duquel le port est offert ?

🔴 **Bloquant**

*Pourquoi on a besoin de la réponse :* Le calcul du prix de vente, de la marge et du prix plancher part du prix d'achat réel. Aujourd'hui le logiciel contient des prix de démonstration en dollars, sans aucun lien avec vos achats : aucun prix affiché ne peut être considéré comme fiable tant que ces grilles ne sont pas connues.

*Si vous ne répondez pas, on partira sur :* On utilise le prix d'achat renvoyé par l'interface Falk & Ross, sans remise, plus 8 EUR hors taxes de port en dessous de 200 EUR de commande, et le coût est signalé comme « estimé » à l'écran.

*Ce que la séance 05 a trouvé, le 18 août :* le catalogue vous sauve à moitié.

Les **459 références importées portent leur prix d'achat réel**, article par article, et le
moteur de coût s'en sert directement. En revanche, les trois vêtements de démonstration du
studio (t-shirt, sweat, vêtement fourni par le client) ne sont rattachés à aucune référence
fournisseur : leur coût textile est **inconnu**, et une commande qui en contient n'a donc pas
de prix plancher chiffrable. L'écran « Coûts et marges » vous permet de saisir un prix
d'achat par vêtement, avec sa source et sa date, mais c'est un pansement : la vraie réponse
est de rattacher chaque produit personnalisable à sa référence fournisseur, ce qui suppose
votre grille.

**Votre réponse :**

> 

### 4. Quels sont vos tarifs DTF réellement négociés en France et en Espagne : prix au mètre linéaire, largeur exacte du rouleau, commande minimum, frais de livraison et délai réellement tenu ? Les 17 EUR et 9 EUR sont-ils confirmés par un fournisseur nommé ?

🔴 **Bloquant**

*Pourquoi on a besoin de la réponse :* Le coût du marquage et le choix automatique entre la France (urgence) et l'Espagne (standard) reposent entièrement sur ces chiffres. C'est aussi ce qui permet de mesurer l'économie réelle de notre optimisation de placement des visuels sur le film.

*Si vous ne répondez pas, on partira sur :* 17 EUR hors taxes le mètre linéaire en 56 cm en France (48 h), 9 EUR hors taxes en Espagne (5 jours), 15 EUR de livraison par commande, 1 mètre minimum, 5 % de perte prévue.

*Ce que la séance 05 a trouvé, le 18 août :* vos deux tarifs sont maintenant dans le code et
pilotent le coût de marquage de chaque commande. Il manque encore deux précisions.

1. **La longueur maximale d'un fichier d'impression** chez votre fournisseur. Nous
   travaillons sur 30 mètres. Ce nombre décide du nombre de feuilles facturées sur une
   grosse commande, donc du nombre d'arrondis à la tranche de facturation.
2. **Le tarif rapporté à la laize.** « 17 EUR le mètre linéaire de 56 cm » est un seul
   tarif : si votre fournisseur livre en 58 ou en 60 cm, le prix au mètre n'est pas
   comparable, et notre imbrication calcule sur la mauvaise largeur.

Pour information : les tarifs **publics** relevés chez cinq imprimeurs français en juillet
2026 vont de 5,45 à 15,99 EUR le mètre linéaire à l'unité. Si vos 17 EUR sont un tarif
négocié, il est plus cher que les prix affichés ailleurs, et cela vaut la peine d'être
vérifié avant que nous ne chiffrions six mois de commandes dessus.

**Votre réponse :**

> 

### 5. Quel taux horaire interne devons-nous compter pour la main-d'œuvre, même quand c'est vous ou vos frères qui produisez ? Et pouvez-vous chronométrer une vraie série (préparation, pressage, pelage, seconde presse, contrôle, pliage, emballage) ?

🔴 **Bloquant**

*Pourquoi on a besoin de la réponse :* Sans coût horaire, le prix plancher est faux et toutes les petites commandes paraissent rentables alors qu'elles ne le sont pas. Ce chiffre décide aussi si l'atelier a intérêt à poser deux transferts séparés pour économiser du film, ou un seul.

*Si vous ne répondez pas, on partira sur :* 20 EUR de l'heure chargé, 45 secondes par pose de transfert, 60 secondes de préparation par commande.

*Ce que la séance 05 a trouvé, le 18 août :* vos deux temps couvrent moins d'un sixième de
ce que votre propre document facture.

Avec 20,00 EUR de l'heure, 60 secondes de préparation par commande et 45 secondes par pose
de transfert, la commande de 30 t-shirts de votre chapitre 1 coûte **7,83 EUR de
main-d'œuvre**. Ce même chapitre y inscrit **45,00 EUR**. L'écart, **37,17 EUR**, correspond
exactement aux cinq opérations que votre document énumère et que personne n'a jamais
chronométrées : réception et tri, pelage, second pressage, contrôle, pliage et emballage.
Soit environ 223 secondes par vêtement.

Ce n'est pas un détail comptable : sur cette commande, ces 37,17 EUR déplacent le **prix
plancher de 63,72 EUR**. Nous comptons donc ces cinq opérations à zéro, et le rapport de
chaque commande affiche « jamais chronométrée » en face de chacune plutôt que de faire
comme si elles étaient gratuites.

**Une seule série chronométrée, montre en main, referme le trou.** Profitez-en pour nous
donner aussi le **coût des consommables par vêtement** (feuille de transfert, adhésif,
nettoyage de la presse) : le chapitre 1 les range dans les coûts directs et ne les chiffre
nulle part, donc ils valent zéro eux aussi.

**Votre réponse :**

> 

### 6. Quel taux de marge visez-vous par famille de produits (t-shirt, polo, sweat, vêtement de travail), et quelle marge minimum acceptez-vous en dessous de laquelle une vente doit être refusée, même par un commercial ?

🔴 **Bloquant**

*Pourquoi on a besoin de la réponse :* Le moteur calcule le prix conseillé à partir du coût et du taux de marge, puis un prix plancher que le système refusera de franchir. Sans ces deux nombres, aucun prix ne peut être affiché ni aucune remise autorisée.

*Si vous ne répondez pas, on partira sur :* Marge cible 55 % sur textile et marquage, contribution minimale 25 % du prix hors taxes, remise maximale de 15 % sans validation de votre part.

*Ce que la séance 05 a trouvé, le 18 août :* trois choses, et la première change le prix de
tout ce que vous vendez.

**1. « Taux de marge » ne désigne pas le calcul que votre document applique.** En commerce
français, le *taux de marge* est la marge rapportée au prix d'achat, et le *taux de marque*
la marge rapportée au prix de vente. La formule du chapitre 1, « prix conseillé =
coût / (1 − taux) », est celle du taux de **marque**, et son propre exemple chiffré le
confirme (625 = 250 / 0,40). Le mot et le calcul ne disent donc pas la même chose. Sur un
coût de 250,00 EUR, votre « 55 % » vaut **555,56 EUR** lu comme la formule et
**387,50 EUR** lu comme les mots : **168,06 EUR d'écart sur une seule commande**, soit 43 %
du plus petit des deux. Nous appliquons la formule, l'écran d'administration affiche les
deux prix côte à côte, et nous avons besoin de savoir lequel vous aviez en tête.

**2. La contribution minimale n'est pas du même type dans votre document et dans votre
hypothèse par défaut.** Le chapitre 1 la prend en euros ; l'hypothèse la donne en pourcentage
du prix (« 25 % du prix hors taxes »). Ce n'est pas la même formule, et la version en
pourcentage a un cas **sans aucune solution** : garder 25 % du prix alors qu'on verse 80 %
de la marge en commission est impossible quel que soit le prix. Les deux sont codées, la
version en pourcentage est celle qui tourne, et le cas impossible est refusé au lieu de
produire un prix plancher négatif.

**3. Aux réglages actuels, aucune colonne de votre grille publique n'est vendable sans
validation.** Mesuré en faisant tourner le moteur, sur un t-shirt acheté 3,37 EUR, imprimé
d'un visuel en deux morceaux, avec le film réellement imbriqué :

| Quantité | Prix public HT | Coût direct | Prix plancher | Prix conseillé | Verdict |
|---|---|---|---|---|---|
| 5 | 72,50 EUR | 65,03 EUR | 86,71 EUR | 144,51 EUR | **sous le plancher de 14,21 EUR** |
| 10 | 123,20 EUR | 87,38 EUR | 116,51 EUR | 194,18 EUR | à valider |
| 25 | 271,75 EUR | 163,36 EUR | 217,81 EUR | 363,02 EUR | à valider |
| 50 | 471,00 EUR | 301,88 EUR | 402,51 EUR | 670,84 EUR | à valider |
| 100 | 942,00 EUR | 569,15 EUR | 758,87 EUR | 1 264,78 EUR | à valider |

Le coût de cette table est encore **incomplet** : il ne compte ni provision de défaut, ni
consommables, ni cinq des sept opérations d'atelier, donc le vrai plancher est plus haut que
la colonne qui l'affiche. Trois nombres peuvent expliquer l'écart et un seul est de notre
fait : le tarif public affiché (une valeur de démonstration, jamais validée par vous), le
prix d'achat, ou vos taux. Dites-nous lequel doit bouger.

*Ce que la séance 05 a livré, le 18 août :* **le plancher peut maintenant être différent
selon le périmètre**, comme votre chapitre 1 le demande (par famille de produits, par
technique, par commercial, par taille de commande, par type de client, par niveau
d'urgence). L'écran « Coûts et marges » permet d'écrire ces règles.

**La table est livrée VIDE, et c'est délibéré.** Votre question demande un taux de marge
*par famille de produits* et n'a pas de réponse ; écrire une règle à votre place
reviendrait à décider votre politique de prix. Une règle est par ailleurs la seule chose
de ce moteur qui puisse **abaisser** un plancher, donc elle attend une décision et non une
valeur par défaut.

Quand vous nous donnerez vos taux par famille, chaque règle se saisit en une ligne, et
l'écran affiche sous chacune **le plancher qu'elle produit** sur l'exemple chiffré de
votre chapitre 1. C'est là que se voit une erreur de saisie : « 0,25 » au lieu de « 25 »
se relit « 0,25 » et fait tomber le plancher de 428,57 EUR à 251,05 EUR sans que rien
d'autre ne bouge à l'écran.

**Votre réponse :**

> 

### 7. Combien coûte réellement un emballage (sachet, carton, étiquette) par commande, et quels tarifs transporteurs avez-vous négociés par tranche de poids et destination ? Offrez-vous la livraison au-dessus d'un certain montant ?

🟠 **Important**

*Pourquoi on a besoin de la réponse :* La livraison et l'emballage sont des coûts directs qui entrent dans le prix plancher, et le panier doit afficher un vrai prix d'expédition au client. Sans grille, on affiche un montant inventé qui sera soit dissuasif, soit à perte.

*Si vous ne répondez pas, on partira sur :* 0,60 EUR d'emballage par pièce plus 1,50 EUR de carton, grille publique Colissimo, livraison offerte au-dessus de 300 EUR hors taxes.

*Ce que la séance 04 a trouvé, le 18 août :* trois choses.

1. **Nos 0,60 EUR par pièce contredisent votre propre Bible**, qui donne la seule mesure
   existante : « emballage : 9 EUR » sur une commande de trente pièces, soit **0,30 EUR la
   pièce**, matière seule et sans carton. Nous avons pris le double, et le carton de
   1,50 EUR n'est mentionné nulle part. Sur une série de cinquante, cela fait
   **31,50 EUR d'emballage facturés contre 15,00 EUR** au tarif de votre Bible : un écart
   de 16,50 EUR, plus du double, à l'intérieur d'une ligne de livraison que le client voit.
   (La première version de ce paragraphe annonçait 1,50 EUR d'écart. C'était faux d'un
   facteur onze : nous avions mélangé notre carton et le tarif de la Bible dans le même
   calcul. Le chiffre ci-dessus a été mesuré en faisant tourner le code.)
2. **Il nous manque un poids, pas seulement un coût.** La Poste facture à la tranche de
   poids, emballage compris. Nous comptons le carton pour **0 gramme** faute de l'avoir
   pesé, donc nous sous-estimons la tranche et nous payons l'écart : le client n'est jamais
   surfacturé, c'est nous qui absorbons. **Pesez un carton vide et un sachet**, cela prend
   une minute et cela vaut plusieurs euros par commande.
3. **La Bible se contredit sur qui paie le transport.** Le chapitre 0 range « livraison »
   dans les *revenus possibles* ; le chapitre 1 range « livraison offerte » dans les *coûts
   directs*, et son exemple chiffré ne facture aucun port au client. Nous avons construit
   la première version, celle où le client voit une ligne de livraison, avec un franco à
   300 EUR hors taxes. Dites-nous si c'est bien ce que vous voulez.

Nous utilisons pour l'instant la **grille publique Colissimo au 1er janvier 2026**, relevée
sur l'affiche tarifaire de La Poste. Elle est vérifiable et ne porte pas de TVA. Si vous
avez un contrat Colissimo Entreprise, ses tarifs négociés remplacent la grille publique en
un réglage : envoyez-nous la grille.

**Votre réponse :**

> 

### 8. Acceptez-vous que la grille de prix par quantité soit visible publiquement sur chaque fiche produit, comme le fait votre principal concurrent ? Et voulez-vous facturer le marquage à la surface réellement imprimée plutôt qu'un forfait par face ?

🟠 **Important**

*Pourquoi on a besoin de la réponse :* Votre concurrent facture le même prix pour un petit logo de 8 cm et pour un visuel A3, ce qui rend les petits logos d'entreprise très chers chez lui. Facturer à la surface est votre principal avantage, mais cela change la formule de prix, l'affichage de la fiche produit et le discours commercial : il faut trancher avant de coder.

*Si vous ne répondez pas, on partira sur :* Grille publique hors taxes sur 6 paliers de quantité, marquage facturé à la surface imprimée avec un minimum de facturation par emplacement.

**Votre réponse :**

> 


## Catalogue

### 9. Combien de références voulez-vous réellement publier au lancement : 200, 500, 2 000 ? Et quel fournisseur est prioritaire, Falk & Ross ou Imbretex ? Pouvez-vous nous donner la liste des familles et des marques à mettre en ligne en premier ?

🔴 **Bloquant**

*Pourquoi on a besoin de la réponse :* Importer tout le catalogue Falk & Ross représenterait environ 2 350 produits et 240 000 variantes : votre hébergement ne le supporterait pas et le site deviendrait très lent. Il faut donc une sélection choisie par vous, sinon nous la choisissons à votre place.

*Si vous ne répondez pas, on partira sur :* 300 références Falk & Ross (t-shirts, polos, sweats, softshells, haute visibilité) publiées, le reste du catalogue accessible uniquement sur devis.

**Votre réponse :**

> 

### 10. Devez-vous vendre dès le lancement, avec personnalisation en ligne, les tailles XS, 4XL et 5XL, les produits enfant et les articles sans taille (casquettes, sacs, tabliers, bonnets) ?

🟠 **Important**

*Pourquoi on a besoin de la réponse :* L'outil de personnalisation ne gère aujourd'hui que les tailles S à 3XL sur des vêtements de type haut du corps. Chaque famille supplémentaire (casquette, sac, enfant) demande de nouveaux gabarits, de nouvelles zones d'impression et de nouveaux essais : c'est du travail à chiffrer séparément.

*Si vous ne répondez pas, on partira sur :* Personnalisation en ligne pour les tailles S à 3XL sur les vêtements du haut du corps ; toutes les autres familles restent visibles mais uniquement sur devis, sans aperçu.

**Votre réponse :**

> 

### 11. Voulez-vous afficher au client le stock fournisseur en temps réel, ou seulement une mention « disponible / sur commande » ? Et que fait-on si une taille manque au moment de commander : remplacement par une couleur proche, attente, ou remboursement partiel ?

🟡 **Utile**

*Pourquoi on a besoin de la réponse :* Afficher un stock chiffré engage votre promesse et impose une synchronisation fréquente. La règle de rupture décide aussi de ce que le site fait automatiquement quand une commande déjà payée ne peut plus être servie.

*Si vous ne répondez pas, on partira sur :* Mention « disponible » ou « délai allongé » sans chiffre ; en cas de rupture, appel du client sous 24 h avec proposition d'une couleur ou d'une référence équivalente.

**Votre réponse :**

> 


## Techniques

### 12. Quelles techniques ouvrez-vous au lancement (DTF, flocage, vinyle, sublimation, broderie) ? Pour chacune : quantité minimum, taille maximale de marquage, emplacements possibles (cœur, dos, manche, capuche, étiquette de col) et supplément éventuel.

🔴 **Bloquant**

*Pourquoi on a besoin de la réponse :* Chaque technique et chaque emplacement doit être décrit dans l'outil de personnalisation (zone, taille maximale, contrôles de fichier) et dans le prix. Tant que la liste n'est pas fermée, on ne peut pas finaliser les fiches produits ni les contrôles automatiques de fichiers.

*Si vous ne répondez pas, on partira sur :* DTF seul en personnalisation en ligne (cœur, dos, manches, 30 x 40 cm maximum) ; broderie, flocage et sublimation présentés mais traités sur devis.

*Ce que la séance 05 n'a pas pu construire, le 19 août :* **le coût des autres techniques.**
Le moteur de coût chiffre une commande DTF de bout en bout, du film imbriqué à la
main-d'œuvre, et il ne sait chiffrer aucune des quatre autres. Le chapitre 1 de votre Bible
demande, pour la broderie, un prix par tranche de points, un forfait de mise en route, le
temps machine, le cerclage, les changements de fil, la numérisation et un taux d'incident
machine ; pour le flocage, le vinyle et la sublimation, la matière, le temps de découpe ou
d'impression, l'échenillage, le temps de presse, la perte, la préparation et un minimum de
facturation. Nous n'avons aucun de ces chiffres et nous n'en avons inventé aucun : un
chiffre plausible ici fabriquerait un prix plancher, une marge et une commission qui ont
l'air calculés.

Ce que cela change au quotidien : une commande de broderie se chiffre à la main, et le
système ne dit pas si elle est vendable. Si vous ouvrez une deuxième technique, dites-le
avec ses chiffres, et sachez que c'est du développement et non un réglage : la question 13
en décide déjà la moitié, puisqu'une broderie sous-traitée et une broderie faite chez vous
n'ont pas le même modèle de coût.


**Votre réponse :**

> 

### 13. La broderie est-elle produite en interne sur votre machine 15 aiguilles ou sous-traitée ? Quel est le prix de la numérisation d'un logo, et le facturez-vous au client, une seule fois ou à chaque commande ?

🟠 **Important**

*Pourquoi on a besoin de la réponse :* La numérisation est une ligne de facture à part et un délai supplémentaire. Selon interne ou sous-traitance, le délai promis et le coût changent, et le site doit ou non proposer la broderie en autonomie.

*Si vous ne répondez pas, on partira sur :* Broderie sous-traitée, délai plus 5 jours ouvrés, numérisation 35 EUR hors taxes facturée une seule fois par logo puis mémorisée pour les réassorts.

**Votre réponse :**

> 


## Livraison

### 14. Quel délai vous engagez-vous à tenir à partir de la validation du bon à tirer, pour le standard, l'express et l'urgence ? Avec quels transporteurs avez-vous un compte ouvert, et proposez-vous le retrait à Bobigny ou la livraison en main propre en Île-de-France ?

🔴 **Bloquant**

*Pourquoi on a besoin de la réponse :* Le site doit afficher une date de livraison, pas un vague délai : c'est ce qui fait la différence face aux concurrents. Cette date est calculée à partir de vos délais réels, du choix du fournisseur DTF et du transporteur. Sans engagement de votre part, on ne peut afficher aucune date.

*Si vous ne répondez pas, on partira sur :* Standard 12 jours ouvrés, express 7 jours, urgence 4 jours (France uniquement), Colissimo comme transporteur, retrait sur rendez-vous à Bobigny, pas de livraison en main propre annoncée sur le site.

*Ce que la séance 05 a laissé ouvert, le 19 août :* **combien facturez-vous l'express et
l'urgence ?** Cette question ne demandait que des délais ; elle demande maintenant aussi un
prix, parce que le chapitre 1 veut un supplément qui couvre le film plus cher en France, la
priorité de production, un éventuel déplacement, le risque accru et le temps de
coordination, calculé en pourcentage ou au coût réel majoré. Aucun de ces deux montants
n'existe, donc **aucun supplément n'est chiffré ni facturé aujourd'hui.**

L'urgence d'une commande sert à une seule chose dans le moteur : elle peut faire jouer un
plancher différent, si vous en écrivez un dans l'écran « Coûts et marges ». Elle ne change
pas le coût. En particulier, toute commande est chiffrée au tarif film **français**, le plus
cher des deux, quelle que soit son urgence : nous ne laissons pas une case cochée décider
sur quel rouleau la commande a été imprimée, parce qu'une case n'est pas une preuve d'achat.

À noter : tant que les délais ci-dessus ne sont pas confirmés, l'express n'est pas vendable
du tout, puisque le site n'annonce aucune date de livraison. Le supplément et le délai se
répondent, et c'est la même réponse qui débloque les deux.


**Votre réponse :**

> 


## Paiements

### 15. Confirmez-vous Revolut Pay, ou préférez-vous Stripe ? Avez-vous déjà un compte marchand ouvert quelque part ? Acceptez-vous aussi le virement, le mandat administratif (mairies, écoles, hôpitaux) et le paiement en plusieurs fois ?

🔴 **Bloquant**

*Pourquoi on a besoin de la réponse :* C'est une intégration complète à développer et à tester : on ne peut pas en faire deux. Le mandat administratif, en particulier, ouvre la clientèle publique que vos concurrents traitent déjà et demande un traitement séparé (bon de commande, facturation dématérialisée).

*Si vous ne répondez pas, on partira sur :* Stripe pour la carte et le paiement mobile, virement accepté sur devis, mandat administratif traité hors ligne au lancement ; Revolut Pay ajouté plus tard si vous le souhaitez.

*Ce que la séance 04 a trouvé, le 18 août :* Stripe est branché via l'extension officielle
maintenue par Stripe, gratuite. Trois points qui demandent votre avis :

1. **Les Cartes Bancaires (CB) s'activent chez Stripe, pas dans WordPress.** La plupart des
   cartes françaises sont co-badgées CB/Visa ou CB/Mastercard, et le routage CB coûte
   nettement moins cher. Rien dans le site ne vous dira si c'est activé : c'est une case
   dans votre tableau de bord Stripe. À vérifier avant la mise en ligne.
2. **Le virement n'est pas ouvert au paiement en ligne**, conformément à votre « accepté
   sur devis ». Le jour où on l'ouvre, il nous faut l'IBAN, le BIC et le nom exact du
   titulaire, et la commande reste « en attente » jusqu'à réception des fonds : le délai de
   livraison ne peut pas partir de la commande.
3. **Le prélèvement SEPA est possible et change la promesse de délai** : un paiement SEPA
   met plusieurs jours à se confirmer et peut échouer après la commande. Le voulez-vous ?

*Ce que nous comptons en attendant, depuis la séance 05 :* **1,5 % + 0,25 EUR par
encaissement par carte**, le tarif public de Stripe pour les cartes européennes, appliqué au
montant **TTC**, parce que la plateforme facture sur ce qu'elle encaisse et ne sait pas
quelle part est votre TVA. Le virement et le chèque ne coûtent rien et sont comptés à zéro.
Si vous avez négocié un autre tarif, c'est un réglage sur l'écran « Coûts et marges ».

**Votre réponse :**

> 

### 16. À partir de quel montant acceptez-vous un acompte plutôt qu'un paiement à 100 % avant production ? Et accordez-vous un paiement à 30 jours à certains clients (grands comptes, collectivités) ?

🟠 **Important**

*Pourquoi on a besoin de la réponse :* Cela décide des règles de déblocage de la production : une commande payée à 50 % peut-elle partir en fabrication ? Sans règle, le système bloquera toute commande non payée intégralement, ce qui peut faire perdre des gros dossiers.

*Si vous ne répondez pas, on partira sur :* 100 % avant production ; acompte de 50 % possible au-dessus de 3 000 EUR hors taxes après votre validation ; aucun paiement à échéance au lancement.

*Ce que la séance 04 a construit, le 18 août :* **l'acompte existe**, sur vos deux chiffres
par défaut, et il n'est jamais automatique. Quatre choses à savoir.

1. **Votre Bible se contredit, et il a fallu trancher.** Sa règle de paiement dit « commande
   importante : acompte possible, solde avant expédition ou avant production selon le
   risque » ; son critère d'acceptation dit « une commande non payée ne peut pas passer en
   production ». Une commande payée à 50 % n'est pas payée : la première phrase autorise ce
   que la seconde interdit. Nous avons retenu la lecture qui rend les deux vraies en même
   temps : **une commande sur laquelle personne n'a autorisé d'acompte doit être payée
   intégralement avant production** (votre critère), et **une commande sur laquelle vous
   l'avez autorisé peut démarrer sur l'acompte** (votre règle), **sans jamais partir avant
   le solde**. Les deux lectures sont dans les tests, côte à côte. Si nous nous sommes
   trompés, dites-le et c'est une ligne à changer.
2. **Un acompte se décide commande par commande.** Il n'y a pas de règle qui l'accorde toute
   seule : un bouton sur la fiche de la commande, qui n'apparaît qu'au-dessus du seuil.
   C'est ce que dit votre hypothèse par défaut, « après votre validation ».
3. **Vos deux seuils ne se rencontrent jamais.** La question 02 arrête le paiement en
   autonomie à 2 000 EUR hors taxes et celle-ci ouvre l'acompte à 3 000 : **aucun panier
   rempli par un client ne peut y arriver**. Un acompte n'est donc possible que sur une
   commande que vous préparez, ce qui est cohérent (les acomptes sont faits pour les gros
   dossiers), mais autant que vous le sachiez avant de confirmer les deux chiffres.
4. **Chaque acompte encaissé émet une facture d'acompte, et c'est obligatoire.** Nous
   avions d'abord écrit ici le contraire, en croyant qu'une vente de marchandises n'oblige
   à rien tant que le bien n'est pas livré. **C'était faux**, sur deux points, et nous ne
   l'avons su qu'en allant lire les textes :
   - l'article 289, I-1-c du code général des impôts impose une facture « pour les acomptes
     qui lui sont versés avant que l'une des opérations visées aux a et b ne soit
     effectuée », et le a) vise « les livraisons de biens **ou** les prestations de
     services ». Les seules exceptions sont les livraisons intracommunautaires exonérées et
     les moyens de transport neufs ;
   - le BOFiP le dit sans détour : « une facture doit donc être délivrée pour **tous** les
     versements d'acomptes [...] et non pas pour les seules opérations pour lesquelles ces
     versements entraînent l'exigibilité de la TVA » ;
   - et depuis le 1er janvier 2023 la TVA est de toute façon exigible dès l'encaissement de
     l'acompte, même sur une vente de marchandises (article 269, 2-a).

   Le client reçoit donc **une facture d'acompte à chaque versement**, numérotée dans la
   même série continue que les factures, puis **la facture définitive** qui reprend
   l'opération entière et déduit chaque acompte par son numéro et sa date, comme le BOFiP
   l'exige. **Une chose à faire confirmer par votre comptable :** aucun texte ne prescrit la
   présentation. Nous avons retenu la plus courante (tout le montant, puis la déduction des
   acomptes, puis un « net à payer »), déduite de la mécanique de TVA et non copiée d'une
   source officielle.

5. **Que se passe-t-il si le solde n'arrive jamais ?** Votre Bible n'a ni le mot, ni la
   procédure : « impayé », « relance de paiement », « délai de paiement » et « pénalité »
   n'apparaissent nulle part dans les huit chapitres. Une commande produite sur acompte dont
   le solde ne vient pas reste donc indéfiniment dans l'atelier, personnalisée et
   invendable. Aujourd'hui le site la laisse à l'état « acompte reçu » et n'expédie pas ;
   il ne relance pas, ne facture aucune pénalité et ne clôt rien. Au bout de combien de
   temps, et pour faire quoi ?

6. **Que rembourse-t-on si une commande avec acompte est annulée ?** Votre Bible dit
   « après commande fournisseur ou préparation spécifique : remboursement du solde non
   engagé ». Autoriser un acompte crée donc une obligation que le site **ne sait pas
   honorer** : il n'émet aucun avoir et ne fait aucun remboursement. C'est le service
   après-vente de la séance 06, et d'ici là un remboursement se fait à la main.

**Votre réponse :**

> 


## Juridique et facturation

### 17. Pouvez-vous nous donner les informations légales exactes à faire figurer sur le site et les factures (raison sociale, forme juridique, adresse, SIRET, numéro de TVA intracommunautaire, capital) ? Tout est-il bien soumis à la TVA à 20 % ?

🔴 **Bloquant**

*Pourquoi on a besoin de la réponse :* Les mentions légales et les factures ne peuvent pas être publiées sans ces informations, et elles sont obligatoires. La TVA conditionne aussi tout l'affichage des prix et les objectifs de chiffre d'affaires (vos objectifs sont exprimés toutes taxes comprises, vos coûts hors taxes).

*Si vous ne répondez pas, on partira sur :* le régime de TVA est construit comme une **période datée** et non comme une constante, parce qu'une entreprise en franchise qui dépasse le seuil bascule à une date, et que les factures d'avant et d'après ne sont pas les mêmes documents. Le régime en vigueur par défaut est la TVA à 20 %, affiché comme une hypothèse à côté du fait que la boutique en ligne est aujourd'hui configurée taxes désactivées (constat 6). En franchise : aucune ligne de TVA, TTC égal HT, et la mention « TVA non applicable, article 293 B du CGI » sur chaque devis et chaque facture. Aucun seuil n'est écrit dans le code, les périodes et leurs dates viennent de vous et de votre comptable. Les mentions légales restent **vides** plutôt que remplies d'exemples crédibles, et la mise en ligne est refusée tant qu'elles le sont.

*Ce que la séance 04 a construit, le 18 août :* la mécanique complète, et rien du contenu.

- Le régime est une **suite de périodes datées**, avec un mode franchise qui supprime toute
  ligne de TVA et fait apparaître « TVA non applicable, article 293 B du CGI ». **Aucun
  seuil n'est écrit dans le code** : les seuils et les dates viennent de votre comptable.
- Les mentions légales sont **vides** et le resteront. Une facture à laquelle il manque une
  de ces informations est **refusée** en production et sort marquée « document non
  conforme » en préproduction. Vous pouvez le voir : WooCommerce, puis Facturation.
- La période livrée s'ouvre au **18 août 2026** et n'affirme rien avant. Conséquence
  directe : **les 15 commandes du constat 6 ne peuvent pas être facturées par le site**,
  parce que personne ne sait sous quel régime elles ont été prises. C'est le constat, rendu
  visible plutôt que contourné.

Il ne manque donc plus que la réponse : **la société facture-t-elle la TVA, oui ou non, et
depuis quelle date ?** Et les six informations d'identité, qui prennent deux minutes à
recopier depuis un Kbis.

**Votre réponse :**

> 


## Juridique

### 18. Qui rédige et valide vos conditions générales de vente (professionnels et particuliers), vos mentions légales et votre politique de confidentialité ? Avez-vous un avocat ? Confirmez-vous que l'on inscrive la perte du droit de rétractation pour les articles personnalisés ?

🔴 **Bloquant**

*Pourquoi on a besoin de la réponse :* La loi française exclut le droit de rétractation pour les biens personnalisés, mais seulement si c'est correctement écrit et si le client le reconnaît explicitement. Nous devons enregistrer cette reconnaissance au moment de la validation du bon à tirer : il nous faut le texte exact validé par un juriste.

*Si vous ne répondez pas, on partira sur :* Nous préparons des textes de base à faire relire par un avocat, et une case à cocher de renonciation à la rétractation, horodatée et enregistrée à la validation du bon à tirer.

*Ce que la séance 06 a changé à cette hypothèse, le 19 août, et pourquoi :* votre hypothèse
place la renonciation **à la validation du bon à tirer**, qui a lieu après le paiement,
donc après la conclusion du contrat. C'est un accusé de trop tard. Les articles L221-5 et
R221-2 du code de la consommation demandent que le client soit informé **avant** que le
contrat soit conclu que le droit de rétractation ne s'applique pas.

Nous avons donc construit les deux, parce que ce sont deux actes différents :

- **au paiement**, la case sur le droit de rétractation, avec la date, l'heure, l'adresse
  IP, la version des conditions générales en vigueur et **la phrase exacte** qui était à
  l'écran. Elle ne s'affiche que si le panier contient quelque chose de personnalisé : un
  vêtement nu du catalogue garde le droit de rétractation ordinaire, et demander à un
  client de renoncer à un droit qu'il conserve serait une clause abusive.
- **au bon à tirer**, la validation de ce qui va être pressé, avec ses propres tolérances.

La mention figure sur la facture, avec sa date. Et quand une commande personnalisée n'a
**aucune** renonciation enregistrée, la facture le dit au lieu de prétendre le contraire :
c'est une commande sur laquelle nous ne pourrions pas refuser une rétractation.

Il nous manque une chose de votre côté : **la version des conditions générales**. Elle est
vide tant que personne n'a écrit les CGV (séance 12), et nous l'enregistrons vide plutôt
que d'inventer un « v1 » que nous serions incapables de produire le jour où on nous le
demanderait.

**Votre réponse :**

> 


## RGPD et prospection

### 19. D'où vient exactement la base de 150 000 entreprises : achetée à qui, collectée comment, avec quelle preuve ? Acceptez-vous que les e-mails ne partent qu'aux adresses génériques du type contact@ ou info@ ? Et qui est responsable des données personnelles chez Teeshoop ?

🔴 **Bloquant**

*Pourquoi on a besoin de la réponse :* Nous ne pouvons pas importer une base sans connaître son origine : la loi impose d'indiquer la source, la date et de permettre l'opposition. Cela décide aussi de ce que nous enregistrons à l'import et de ce que les prospectrices ont le droit d'envoyer.

*Si vous ne répondez pas, on partira sur :* Import avec source et date obligatoires par contact, envoi d'e-mails limité aux adresses génériques, lien d'opposition dans chaque message, liste d'opposition conservée définitivement et jamais effacée par un nettoyage.

**Votre réponse :**

> 


## Site actuel

### 20. Pouvons-nous supprimer les 47 produits de démonstration présents sur le site (tapis d'acupression, meubles) et refaire entièrement la page d'accueil ? Et voulez-vous garder l'outil de personnalisation déjà acheté (Fancy Product Designer) ou le remplacer par le nôtre ?

🔴 **Bloquant**

*Pourquoi on a besoin de la réponse :* Deux outils de personnalisation installés en même temps se disputent le panier et créent des commandes incohérentes. Par ailleurs, l'outil déjà installé n'est plus développé par son éditeur, exporte en basse qualité sans option payante, et ne sait pas optimiser le film DTF, ce que notre outil fait déjà.

*Si vous ne répondez pas, on partira sur :* Suppression des produits de démonstration, page d'accueil refaite, Fancy Product Designer désactivé après sauvegarde de ses données, licence conservée par sécurité.

**Votre réponse :**

> 


## Accès et propriété

### 21. Qui possède le nom de domaine teeshoop.com, l'hébergement o2switch, le compte administrateur WordPress, les licences achetées (thème Woodmart, Fancy Product Designer), les comptes fournisseurs et le compte Cloudflare ? Pouvez-vous nous fournir les accès, y compris l'accès technique au serveur ?

🔴 **Bloquant**

*Pourquoi on a besoin de la réponse :* Sans accès au serveur, rien ne peut être installé ni mis en ligne : aujourd'hui l'accès par mot de passe applicatif est désactivé sur le site. Il faut aussi vérifier que tous les comptes sont bien au nom de la société, et non d'un prestataire précédent.

*Si vous ne répondez pas, on partira sur :* Nous travaillons sur une copie de préproduction et demandons les accès au fur et à mesure ; nous partons du principe que tous les comptes doivent être remis au nom de Teeshoop avant la mise en ligne.

**Votre réponse :**

> 


## Fournisseurs

### 22. Votre compte Falk & Ross est-il aujourd'hui en mode test ou en mode réel ? Acceptez-vous que le système passe automatiquement les commandes fournisseurs, ou voulez-vous valider chaque commande à la main ? Avez-vous déjà un compte Imbretex et Mid Ocean avec accès aux tarifs ?

🔴 **Bloquant**

*Pourquoi on a besoin de la réponse :* La fonction de commande fournisseur existe déjà dans notre système et n'est protégée par aucun mot de passe : si le compte est en mode réel, une vraie commande pourrait partir par erreur. Nous devons sécuriser cette partie en priorité, et savoir si l'achat est automatique ou validé par vous.

*Si vous ne répondez pas, on partira sur :* Commande fournisseur préparée automatiquement mais toujours validée manuellement par vous, et accès à cette fonction protégé par mot de passe.

**Votre réponse :**

> 


## Production

### 23. Combien de pièces pouvez-vous réellement produire par jour aujourd'hui, et avec combien de personnes ? Au-delà de quelle quantité une commande doit-elle être refusée, étalée ou sous-traitée ?

🟠 **Important**

*Pourquoi on a besoin de la réponse :* Le site calcule une date de livraison en fonction de la charge de l'atelier. Sans capacité réelle, il promettra des dates intenables sur les grosses commandes, ce qui provoque des litiges et des remboursements.

*Si vous ne répondez pas, on partira sur :* 300 pièces par jour avec une personne, alerte automatique et validation manuelle au-delà de 500 pièces sur une même commande.

**Votre réponse :**

> 


## Devis et facturation

### 24. Les devis et factures officiels sont-ils émis depuis Qonto, ou voulez-vous qu'ils soient générés par le site avec votre propre numérotation ? Qui est votre comptable et a-t-il des exigences particulières (numérotation, mentions, format d'export) ?

🟠 **Important**

*Pourquoi on a besoin de la réponse :* C'est soit une intégration avec Qonto, soit la création complète d'un générateur de documents : deux chantiers très différents. Il faut aussi savoir qui détient la numérotation légale des factures pour éviter les doublons entre deux systèmes.

*Si vous ne répondez pas, on partira sur :* Le site génère devis et factures avec une numérotation continue et un export comptable mensuel ; connexion à Qonto envisagée dans un second temps.

**Votre réponse :**

> 


## Graphisme

### 25. Que comprend exactement l'aide graphique gratuite (nettoyage du fichier, détourage, mise en place du logo) et à partir de quel moment facturez-vous ? Quel prix pour une vectorisation, une retouche, une création de logo ?

🟠 **Important**

*Pourquoi on a besoin de la réponse :* L'outil de personnalisation doit dire clairement au client ce qui est inclus, et ajouter automatiquement une ligne payante au-delà. Sans règle, votre temps graphique est offert sans limite : c'est le risque que votre propre document identifie comme destructeur de marge.

*Si vous ne répondez pas, on partira sur :* Nettoyage automatique et placement inclus ; vectorisation manuelle 39 EUR hors taxes ; création de logo 250 EUR hors taxes sur devis ; deux allers-retours inclus.

**Votre réponse :**

> 


## Bon à tirer (BAT)

### 26. Combien d'allers-retours de bon à tirer sont inclus avant que vous ne facturiez un supplément, et à quel prix ? Une production peut-elle démarrer sans bon à tirer signé en cas d'urgence, et sous quelle forme d'accord du client ?

🟠 **Important**

*Pourquoi on a besoin de la réponse :* Le système compte les cycles de correction et bloque la production tant que le bon à tirer n'est pas validé. Il faut la règle chiffrée et, pour l'urgence, le texte exact d'accord que le client signera, sinon le blocage sera soit trop rigide, soit inexistant.

*Si vous ne répondez pas, on partira sur :* Deux corrections incluses puis 15 EUR hors taxes par correction ; aucune production sans bon à tirer validé, sauf accord écrit du client indiquant qu'il renonce au bon à tirer et en assume le risque.

*Ce que la séance 06 a construit, le 19 août, et les trois points qu'elle vous rend :*

Le bon à tirer existe. Il est engendré depuis la création du client (vêtement, coloris,
tailles, visuel à sa vraie place, dimensions en centimètres, position sous l'encolure), il
est **gelé à l'envoi**, et le client le valide depuis un lien qui ne demande aucun compte.
La validation enregistre la date, l'heure, l'adresse IP, **la version exacte** et le texte
qui était à l'écran. Aucune commande ne peut passer en production sans cela.

1. **Les deux corrections sont comptées, le supplément n'est pas facturé.** L'écran de
   commande affiche « n corrections demandées sur 2 incluses » et, au-delà, rappelle les
   15 EUR hors taxes à facturer **à la main**. Nous ne l'ajoutons pas tout seuls : ajouter
   une ligne à une commande déjà payée suppose un second encaissement et une facture
   rectificative, et surtout le chiffre est une décision commerciale que vous n'avez pas
   encore prise. Confirmez-vous 2 et 15 EUR ?

2. **Un aller-retour est compté quand le CLIENT demande une modification**, jamais quand
   nous lui renvoyons le même BAT parce que le premier courriel n'est pas parti. Cela nous
   paraît évident ; dites-nous si vous comptez autrement.

3. **Le lien de validation expire au bout de 30 jours** et la date est annoncée dans le
   courriel. Ce n'est pas une durée commerciale (celle du devis est la question 38, et
   elle n'est affichée nulle part) : c'est qu'un lien qui n'expire jamais se transfère,
   reste dans une boîte aux lettres et se clique un an plus tard par quelqu'un qui a quitté
   l'entreprise. Un opérateur en renvoie un en un clic. 30 jours vous va ?

La renonciation d'urgence est construite telle que vous l'avez écrite : elle demande de
**recopier les mots du client** et d'où ils viennent, pas de cocher une case. Une case
enregistre qu'un opérateur a cliqué ; une phrase recopiée enregistre ce que le client a
dit, et c'est la différence entre une preuve et une habitude.

**Votre réponse :**

> 


## Juridique et SAV

### 27. Quelle est votre politique en cas de problème sur du personnalisé : remplacement, remboursement, ou geste commercial ? À partir de quel pourcentage de pièces non conformes ? Et acceptez-vous d'inscrire des tolérances écrites (écart de position de quelques millimètres, différence de couleur entre l'écran et le tissu, écart de quantité) ?

🟠 **Important**

*Pourquoi on a besoin de la réponse :* Ces tolérances doivent figurer dans les conditions générales et dans le texte affiché au moment où le client valide son bon à tirer. Sans elles, chaque écart normal de production devient un litige que vous perdez.

*Si vous ne répondez pas, on partira sur :* Remplacement si l'erreur vient de Teeshoop ; tolérance de position de plus ou moins 1 cm et écart de couleur d'écran accepté ; aucune reprise si le client s'est trompé de taille.

*Ce qu'il nous manque pour chiffrer, depuis la séance 05 :* un **taux de non-conformité**.

Le chapitre 1 range la « provision de défaut » parmi les coûts directs et ne donne aucun
chiffre ; son exemple chiffré la fond dans une seule ligne « paiement et provision SAV :
16 EUR », dont elle ne se déduit pas. Nous la comptons donc à zéro, et c'est le sens
**dangereux** : un zéro ici **abaisse** le prix plancher, donc autorise des ventes qu'il
faudrait refuser. Le rapport de chaque commande signale la ligne comme non renseignée, et
refuse de déclarer le coût complet tant qu'elle l'est.

Un pourcentage de pièces à refaire, même approximatif, suffit.

*Ce que la séance 06 a construit, le 19 août :* vos tolérances sont **affichées au client
au moment exact où cette question demande qu'elles le soient**, c'est-à-dire sur le bon à
tirer, au-dessus du bouton de validation : position à 1 cm près, écart de teinte entre un
écran et un textile accepté, dimensions données pour une taille de référence et mises à
l'échelle avec le vêtement, aucune reprise sur une erreur de taille du client. Elles sont
gelées avec la version : un BAT validé en mars se défend un an plus tard avec le texte qui
était à l'écran en mars.

La matrice de décision du chapitre 5 est aussi devenue du code, sur l'écran de la commande.
Deux de ses lignes ne décident rien et c'est voulu : « erreur validée dans le BAT » et
« mauvaise taille commandée » renvoient « geste éventuel » et « solution commerciale
possible », que le chapitre laisse à un humain. Nous ne les avons tranchées ni dans un
sens ni dans l'autre.

**Votre réponse :**

> 


## RGPD et organisation

### 28. Les deux prospectrices à Madagascar sont-elles salariées, indépendantes, ou passent-elles par une agence ? Existe-t-il un contrat encadrant leur accès aux données de vos clients depuis l'extérieur de l'Union européenne ?

🟠 **Important**

*Pourquoi on a besoin de la réponse :* Un accès à des données personnelles depuis hors Union européenne exige un contrat écrit et des droits limités dans l'outil. Cela décide de ce que nous leur donnons à voir : entreprises attribuées seulement, sans coordonnées bancaires ni marges.

*Si vous ne répondez pas, on partira sur :* Accès limité aux entreprises qui leur sont attribuées, sans coûts, marges ni données de paiement, avec journal des consultations ; contrat de sous-traitance à fournir avant la mise en ligne.

**Votre réponse :**

> 


## Commissions

### 29. Confirmez-vous 40 % de la marge sur la première commande, puis 20 à 30 % sur une nouvelle commande et 10 à 15 % sur un réassort ? Pendant combien de temps un commercial reste-t-il propriétaire de son client, et que se passe-t-il si ce client commande ensuite tout seul sur le site ?

🟠 **Important**

*Pourquoi on a besoin de la réponse :* Le calcul de commission est automatique et s'affiche en direct au commercial pendant qu'il négocie. Il faut les taux exacts, la durée d'attribution d'un client et les cas de reprise, sinon les commissions seront contestées dès les premières ventes.

*Si vous ne répondez pas, on partira sur :* 40 % sur la première commande, 25 % sur une nouvelle commande, 12 % sur un réassort, 0 % sur une commande passée seule sur le site ; attribution du client pendant 12 mois ; commission définitive 30 jours après livraison sans litige.

*Une question que votre document ne tranche pas, trouvée en séance 05 :* **qu'acquiert un
commercial sur un acompte ?**

Le chapitre 1 dit que la commission porte sur « la marge contributive encaissée » et qu'elle
devient provisoire « à l'encaissement ». Il ne dit pas ce que rapporte un paiement partiel.
Deux lectures possibles : rien jusqu'au dernier centime, ou la part proportionnelle à ce qui
est arrivé. Nous avons pris la seconde, parce que la première fait de la commission une
marche d'escalier qui paie 0 EUR sur un acompte de 3 000 EUR puis tout d'un coup. Confirmez,
parce que cela figurera dans leur contrat.

Pour mémoire, sur l'exemple chiffré de votre chapitre 1 : la commission vaut 150,00 EUR sur
la marge contributive, 250,00 EUR si on la calculait sur le chiffre d'affaires et
300,00 EUR sur le TTC, alors que la commande ne laisse que 225,00 EUR avant frais fixes.
Deux de ces trois lectures paient plus que ce que la commande rapporte. C'est bien la
première qui est codée.

**Votre réponse :**

> 

### 30. Les commerciaux indépendants ont-ils un contrat signé mentionnant le mode de calcul de la commission, les cas de reprise et l'interdiction de descendre sous le prix plancher ? Qui valide une demande de prix exceptionnel : vous seul ?

🟡 **Utile**

*Pourquoi on a besoin de la réponse :* Le système bloquera automatiquement toute vente sous le prix plancher et enverra une demande de dérogation. Il faut savoir à qui elle part et qui a le droit de dire oui, sinon les demandes resteront sans réponse et les devis seront bloqués.

*Si vous ne répondez pas, on partira sur :* Blocage automatique sous le plancher, demande de dérogation envoyée au dirigeant uniquement, avec motif obligatoire et durée de validité de 7 jours.

**Votre réponse :**

> 


## Identité de marque

### 31. Pouvez-vous nous fournir votre logo en fichier vectoriel, vos couleurs, vos polices de caractères, et nous dire le ton souhaité (vouvoiement, style sérieux ou proche) ? Gardez-vous la phrase « Vous vous occupez de votre entreprise, Teeshoop s'occupe de votre image » comme accroche principale ?

🟠 **Important**

*Pourquoi on a besoin de la réponse :* Tout doit être habillé à votre marque : le site, l'outil de personnalisation, mais aussi les devis, les factures, les bons à tirer et les fiches d'atelier. Le site actuel utilise encore l'habillage de démonstration du thème acheté.

*Si vous ne répondez pas, on partira sur :* Logo actuellement présent sur le site, teintes bleu et noir, police Inter, vouvoiement, accroche conservée telle quelle.

**Votre réponse :**

> 


## Production DTF

### 32. Acceptez-vous que l'atelier pose deux ou trois transferts séparés sur un même vêtement (par exemple un logo au cœur et un texte en bas de dos) pour économiser du film, ou préférez-vous une seule pose même si elle coûte plus cher en film ?

🟠 **Important**

*Pourquoi on a besoin de la réponse :* C'est exactement le défaut connu de notre outil : aujourd'hui un visuel client est acheté comme un seul bloc, avec tout le vide autour. Sur un panier réaliste, découper les éléments fait passer la facture de film de 280 EUR à 126 EUR, mais ajoute des poses en atelier. Le réglage par défaut dépend de ce que votre atelier accepte de faire.

*Si vous ne répondez pas, on partira sur :* Découpe automatique activée lorsqu'elle économise plus d'environ 100 cm² de film par vêtement, avec la possibilité de forcer une pose unique commande par commande.

**Votre réponse :**

> 


## Données client

### 33. Combien de temps conservez-vous les fichiers et les bons à tirer des clients pour permettre un réassort à l'identique ? Et le client doit-il obligatoirement créer un compte pour retrouver ses créations ?

🟠 **Important**

*Pourquoi on a besoin de la réponse :* Aujourd'hui tout est enregistré dans le navigateur du visiteur uniquement : s'il change d'ordinateur, tout est perdu, et vous ne voyez rien de votre côté. Conserver les créations sur le serveur est un chantier à part entière, à planifier tôt car le réassort est un de vos leviers de marge.

*Si vous ne répondez pas, on partira sur :* Compte client obligatoire pour commander, fichiers de production conservés 3 ans, aperçus conservés 1 an, réassort possible en un clic depuis l'historique.

**Votre réponse :**

> 


## Pilotage

### 34. Dans quel ordre voulez-vous que nous livrions : (1) catalogue, prix et paiement en autonomie, (2) devis et bon à tirer, (3) production et service après-vente, (4) CRM et prospection ? Quelle date de mise en ligne visez-vous, et quel budget mensuel est disponible pour les outils (hébergement, moteur de recherche, e-mail, téléphonie) ?

🟠 **Important**

*Pourquoi on a besoin de la réponse :* La Bible décrit douze modules ; ils ne peuvent pas être livrés en même temps. Sans ordre de priorité venant de vous, nous choisissons le nôtre, et vous risquez de ne pas avoir en premier ce dont votre équipe commerciale a besoin. Certains outils (recherche rapide sur un gros catalogue, envoi d'e-mails) sont payants tous les mois.

*Si vous ne répondez pas, on partira sur :* Ordre 1, 2, 3 puis 4 ; première mise en ligne visée à 8 semaines ; budget outils estimé à 150 EUR par mois hors téléphonie.

**Votre réponse :**

> 


## Périmètre

### 35. Le site doit-il être uniquement en français et livrer uniquement en France métropolitaine au lancement, ou faut-il prévoir dès maintenant la Belgique, la Suisse, le Luxembourg et une version anglaise ?

🟡 **Utile**

*Pourquoi on a besoin de la réponse :* Vendre hors de France change la TVA, les frais de port, les mentions légales et double le travail de traduction. Le prévoir dès le départ coûte du temps ; le rajouter après coûte davantage : il faut décider maintenant.

*Si vous ne répondez pas, on partira sur :* Français uniquement, livraison en France métropolitaine, autres pays traités sur devis manuel.

**Votre réponse :**

> 


## Juridique et marketing

### 36. Pouvez-vous publier les réalisations de vos clients (photos des vêtements, logos) sur le site et les réseaux sociaux ? Faut-il prévoir une autorisation à cocher dans le devis ?

⚪ **Secondaire**

*Pourquoi on a besoin de la réponse :* Une page « réalisations » est prévue et c'est un argument de vente fort, mais publier le logo d'un client sans accord écrit est un risque. Cela ajoute une case dans le devis et une clause dans les conditions générales.

*Si vous ne répondez pas, on partira sur :* Clause d'autorisation intégrée aux conditions générales, avec possibilité de refus par simple demande écrite du client.

**Votre réponse :**

> 


## Impression et tailles

### 37. Un même visuel imprimé sur un S et sur un 3XL n'a pas la même surface. Facturez-vous les deux au même prix, ou la plus grande taille coûte-t-elle plus cher en marquage ?

🟠 **Important**

*Pourquoi on a besoin de la réponse :* Le studio agrandit le visuel avec le vêtement, pour qu'un 3XL ne porte pas un logo qui paraît minuscule. Cela consomme réellement plus de film : sur une commande de six tailles, c'est six transferts différents au lieu d'un seul. Aujourd'hui le prix est calculé sur la surface mesurée à la taille M, la même pour toutes les tailles de la ligne.

**Ce n'est pas un arrondi, c'est un palier.** Le supplément de surface est de 0,00 EUR jusqu'à 625 cm², 4,00 EUR HT jusqu'à 1250 cm², puis 9,00 EUR HT, par face et par vêtement. Un visuel qui mesure 500 cm² en M en fait 757 en 3XL (le tour de poitrine passe de 52 à 64 cm, donc la surface est multipliée par 1,51) : facturé au palier standard, imprimé au palier supérieur. Sur 30 pièces en 3XL, cela fait **120,00 EUR HT** non facturés, sur environ 50 % de film en plus. Dans l'autre sens, un S est facturé un peu trop cher.

*Si vous ne répondez pas, on partira sur :* Un seul prix de marquage par ligne, calculé sur la surface à la taille M, quelles que soient les tailles commandées.

*Ce que la séance 05 a ajouté, le 18 août :* ce n'est plus seulement une question de
prix, c'est une question de **coût**.

Le moteur de coût mesure maintenant le film réellement occupé par une commande en
imbriquant ses visuels sur la laize de 56 cm. Il les mesure à la taille de tarification,
c'est-à-dire en M, pour toutes les tailles de la ligne. Mesuré sur la commande de
démonstration (trente t-shirts, un visuel en deux morceaux) : **1,80 mètre de rouleau en
M contre 2,70 mètres en 3XL**, soit **50 % de film en plus** pour exactement le même
dessin. Nous chiffrons le premier.

Donc, aux réglages actuels, une commande en grandes tailles est facturée au palier de la
taille M **et chiffrée au coût de la taille M** : l'erreur va deux fois dans le même sens,
et elle est en notre défaveur. Le rapport de marge le signale sur chaque commande
concernée. Le corriger demande d'imbriquer une pièce par taille, ce qui est le travail de
la séance 07.

**Votre réponse :**

> 


---

## Devis

### 38. Combien de temps un devis Teeshoop reste-t-il valable, et que se passe-t-il quand ce délai est dépassé ?

🟠 **Important**

*Pourquoi on a besoin de la réponse :* En France, un devis est une offre ferme pendant toute la durée qu'il annonce : si le prix du textile monte entre-temps, c'est vous qui absorbez la différence. Le chapitre 2 de la Bible impose la « validité » parmi les mentions obligatoires du devis, mais ne donne aucune durée, et aucun des huit documents n'en donne une. Nous ne pouvons pas l'inventer : c'est un engagement commercial, pas un réglage technique.

Le sujet est réel : vos prix d'achat textile bougent, et le tarif DTF que nous finissons par retenir (question 04) bougera aussi. Un devis de 45 jours sur une commande de 300 pièces, c'est un risque que vous portez seul.

*Si vous ne répondez pas, on partira sur :* Devis valable 30 jours à compter de son envoi, puis recalcul automatique aux conditions du jour. Aucune durée n'est affichée nulle part tant que vous n'avez pas tranché.

**Votre réponse :**

> 


### 39. Le devis envoyé au client doit-il mentionner le commercial qui l'a préparé, et sa commission ?

🔴 **Bloquant**

*Pourquoi on a besoin de la réponse :* Le chapitre 2 de la Bible liste « commercial et commission estimée » parmi les informations **obligatoires** du devis. Pris au pied de la lettre, cela imprime votre marge sur un document que le client reçoit : il lit ce que vous gagnez, et il négocie à partir de là. Nous supposons qu'il s'agit d'une information interne, affichée à vous et au commercial, jamais au client, et le code est écrit ainsi (un garde-fou automatique empêche qu'un prix d'achat ou un taux de commission puisse atteindre une page client).

Le nom du commercial, en revanche, a du sens sur le document : le client sait à qui s'adresser.

*Si vous ne répondez pas, on partira sur :* Le nom et les coordonnées du commercial figurent sur le devis. La commission n'y figure pas et n'est visible que dans l'administration.

**Votre réponse :**

> 


### 40. Combien de temps conservons-nous une demande de devis qui n'aboutit à aucune commande ?

🟡 **À confirmer**

*Pourquoi on a besoin de la réponse :* Le formulaire de demande de devis recueille un nom, une société, un e-mail et un téléphone. Ce sont des données personnelles, et le RGPD impose d'annoncer une durée de conservation au moment où on les collecte. La recommandation de la CNIL pour des données de prospection est de trois ans après le dernier contact, c'est ce qui est écrit aujourd'hui sous le formulaire.

Ce n'est pas la même question que la 33, qui porte sur les fichiers de production d'une commande réelle.

*Si vous ne répondez pas, on partira sur :* Trois ans après le dernier échange, puis suppression automatique.

**Votre réponse :**

> 


---

## Catalogue

### 41. Vendons-nous des textiles nus, sans marquage, ou le catalogue n'existe-t-il que pour choisir le vêtement à personnaliser ?

🟠 **Important**

*Pourquoi on a besoin de la réponse :* Le catalogue fournisseur est maintenant dans la boutique : 463 références, 26 399 articles avec leurs coloris, leurs tailles, leur grammage, leur composition et leur stock. La question est de savoir ce qu'un visiteur peut en faire. Deux réponses possibles, et elles ne demandent pas le même travail.

Si nous vendons des textiles nus, chaque article a besoin d'un prix de vente, donc de la question 42, et le catalogue devient une boutique à part entière avec ses expéditions et ses retours.

Si le catalogue ne sert qu'à choisir le vêtement à personnaliser, alors le bouton d'une fiche n'est pas « Ajouter au panier » mais « Personnaliser », et le prix affiché est celui du vêtement imprimé, pas celui du textile.

*Si vous ne répondez pas, on partira sur :* le catalogue est consultable, chaque référence affiche ses coloris, ses tailles et ses caractéristiques réelles, et rien n'est commandable tant que la question 42 n'a pas de réponse.

**Votre réponse :**

> 


### 42. Quel taux de marge appliquons-nous à un textile nu revendu ?

🔴 **Bloquant** (si la réponse à la 41 est « oui, on vend des textiles nus »)

*Pourquoi on a besoin de la réponse :* Le chapitre 1 de la Bible donne la formule (prix conseillé HT = coût / (1 − taux de marge cible)) et range « fixer les premiers taux de marge » parmi les choses qui restent à décider. Nous avons le coût réel de chaque article, fourni par le fournisseur et rafraîchi toutes les nuits. Il ne manque que le taux.

Ce n'est pas un détail d'arrondi. Sur un t-shirt acheté 3,37 EUR HT (Gildan Heavy Cotton, la référence la plus fournie du catalogue avec 366 articles) :

| Taux de marge | Prix de vente HT | Prix TTC | Ce qu'il nous reste |
|---|---|---|---|
| 40 % | 5,62 EUR | 6,74 EUR | 2,25 EUR |
| 50 % | 6,74 EUR | 8,09 EUR | 3,37 EUR |
| 60 % | 8,43 EUR | 10,12 EUR | 5,06 EUR |

Un seul taux pour tout le catalogue, ou un taux par famille (t-shirts, polos, sweats), ou un taux qui baisse quand le prix d'achat monte : dites-nous lequel, nous le réglons une fois et les 26 399 articles sont valorisés à la passe suivante.

*Si vous ne répondez pas, on partira sur :* rien. Aucun prix n'est écrit, le catalogue reste consultable et non commandable. Inventer un taux reviendrait à mettre en vente 26 399 vêtements à un prix que personne n'a validé.

**Votre réponse :**

> 


### 43. Le fournisseur donne trois nombres de stock par article et n'en nomme aucun. Savez-vous ce qu'ils sont ?

🟡 **À confirmer**

*Pourquoi on a besoin de la réponse :* Chaque article revient avec trois quantités. Mesuré sur les 26 300 lignes du catalogue : la première totalise 4,7 millions de pièces, la deuxième 7 935, la troisième 32,4 millions. Un stock trente fois supérieur à la disponibilité annoncée ressemble à un réapprovisionnement prévu, pas à une étagère.

Nous ne traitons donc que **la première** comme du stock vendable. Si c'est le mauvais choix, nous refusons aujourd'hui des commandes que le fournisseur pourrait honorer ; si nous nous étions trompés dans l'autre sens, nous encaisserions des commandes impossibles à livrer. Un mot à votre contact chez le fournisseur suffirait à trancher.

*Si vous ne répondez pas, on partira sur :* seul le premier nombre est du stock. C'est le sens prudent.

**Votre réponse :**

> 


### 44. Faut-il traduire les noms de coloris en français ?

🟡 **À confirmer**

*Pourquoi on a besoin de la réponse :* Le catalogue compte 442 noms de coloris distincts, et ce sont les noms du fabricant : « Heather Grey », « Bottle Green », « Fan Deep Royal ». Ce sont aussi ceux qui figurent sur l'étiquette du vêtement et dans les catalogues papier que vos clients professionnels connaissent, donc les traduire n'est pas gratuit : un acheteur qui cherche « Sport Grey » ne trouverait plus rien.

Traduire les vingt les plus courants (Black, White, Navy, Red, Royal…) couvrirait la majorité des références sans casser les autres, mais c'est un travail de rédaction, pas de code, et il faut que quelqu'un valide chaque terme.

*Si vous ne répondez pas, on partira sur :* les noms du fabricant, tels quels.

**Votre réponse :**

> 


## Facturation

### 45. Quel taux de pénalité de retard voulez-vous faire figurer sur vos factures, et quel est votre numéro RCS avec la ville du greffe ?

🟠 **Important**

*Pourquoi on a besoin de la réponse :* ce sont des mentions obligatoires sur une facture
entre professionnels (articles L. 441-9 et R. 123-237 du code de commerce), et deux d'entre
elles manquaient à la question 17, qui ne demandait ni le RCS ni les pénalités. C'est notre
oubli, pas le vôtre. Sans le RCS, aucune facture n'est conforme ; sans taux de pénalité,
c'est le taux légal qui s'applique, ce qui est correct mais peut-être pas ce que vous
voulez.

*Si vous ne répondez pas, on partira sur :* aucun taux fixé, donc la facture cite le taux
légal, celui de la Banque centrale européenne majoré de 10 points, qui est exactement ce
qui s'applique quand les conditions de vente n'en prévoient pas. L'indemnité forfaitaire de
recouvrement de 40 EUR est fixée par décret et figure de toute façon. Aucun escompte pour
paiement anticipé. Le RCS, lui, ne peut pas avoir de valeur par défaut : la facture est
refusée tant qu'il manque, comme les autres mentions de la question 17.

*Deux précisions utiles :* un taux contractuel ne peut pas descendre sous **trois fois le
taux d'intérêt légal**, soit 8,25 % l'an au second semestre 2026. Et si la société est une
entreprise individuelle et non une société commerciale, elle n'a **ni capital social ni
RCS** : dites-le nous, la liste des mentions obligatoires n'est pas la même.

**Votre réponse :**

> 


---

## Ce que vous n'avez PAS à décider

Pour vous éviter de perdre du temps : les points suivants sont tranchés par l'équipe de
développement, et on vous informera simplement du résultat.

1. La façon dont l'outil de personnalisation est intégré dans WordPress.
2. Le choix des bibliothèques, du langage et de l'organisation du code.
3. L'endroit où sont stockés les fichiers lourds et la sécurisation des liens.
4. La méthode de synchronisation du catalogue fournisseur (fréquence, cache, tâches planifiées).
5. Les réglages internes du rendu 3D (éclairage, matière du tissu, qualité d'affichage).
6. L'algorithme de placement des visuels sur le film DTF et ses garde-fous techniques.
7. La structure de la base de données, les index et les migrations.
8. Les outils de test, d'intégration continue et de mise en ligne.
9. La gestion des versions, des sauvegardes et des retours en arrière.
10. Les mesures de sécurité techniques (accès, limitation des appels, journalisation).
11. L'optimisation des performances (cache, compression, images).
12. Le maintien ou non du moteur Cloudflare existant pour parler aux fournisseurs.

---

## Point à régler entre associés

*(Cette section ne concerne pas le site. Elle est ici parce qu'elle conditionne la
suite du projet autant que le reste.)*

Les 8 documents de la Bible chiffrent précisément la rémunération de chaque
intervenant : 500 € par mois pour les deux téléprospectrices, 40 % de la marge pour les
commerciaux, les tarifs fournisseurs, les abonnements logiciels. La contribution du
développeur — à ce jour environ 49 000 lignes de code, soit la partie la plus avancée du
projet — n'est chiffrée nulle part, et le code se trouve aujourd'hui dans un dépôt
personnel.

Il serait sain de mettre par écrit, sur une page, avant d'aller plus loin :

- la forme juridique de la société et la répartition du capital ;
- le statut du développeur (associé, prestataire, salarié) et sa rémunération ;
- la cession ou la licence du code existant à la société, et ce qu'il advient de ce code
  si l'association s'arrête ;
- qui détient le domaine, l'hébergement, les licences et les comptes fournisseurs.

Ce n'est pas une question de méfiance : c'est ce qui évite qu'un désaccord dans six mois
ne coûte le projet entier.

---

*Document généré à partir de l'analyse de « La Bible de Teeshoop », du site
teeshoop.com en production et du code de l'outil de personnalisation.*
