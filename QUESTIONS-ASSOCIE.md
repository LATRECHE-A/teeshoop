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

## Avant tout : 6 constats sur l'existant

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
   ont donc été encaissées sans ligne de TVA. Deux cas possibles, et la réponse n'est
   pas la même :
   - la société est en franchise en base de TVA, et il manque alors la mention légale
     obligatoire « TVA non applicable, article 293 B du CGI » sur les factures ;
   - la société est assujettie, et il y a une régularisation à faire avec votre
     comptable sur ces 15 commandes.

   Dans les deux cas il faut le régler **avant** la prochaine vente, pas après. C'est
   l'objet de la question 17.

---

## Modèle commercial

### 1. Acceptez-vous les commandes de particuliers, ou le site est-il réservé aux professionnels ? Et le minimum de 5 pièces / 50 EUR s'applique-t-il vraiment à tout (toutes techniques, tous produits), ou avez-vous des exceptions ?

🔴 **Bloquant**

*Pourquoi on a besoin de la réponse :* Cela décide si on bloque le panier sous le minimum, si on demande le SIRET à l'inscription, si les prix s'affichent hors taxes ou toutes taxes comprises par défaut, et s'il faut construire un parcours d'achat grand public. Ces choix touchent le panier, la fiche produit et le moteur de prix : les changer après coup coûte plusieurs jours.

*Si vous ne répondez pas, on partira sur :* Site réservé aux professionnels, SIRET demandé mais non bloquant, minimum 5 pièces et 50 EUR hors taxes bloquant à la validation du panier, prix affichés hors taxes avec le montant toutes taxes comprises en second.

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

**Votre réponse :**

> 

### 4. Quels sont vos tarifs DTF réellement négociés en France et en Espagne : prix au mètre linéaire, largeur exacte du rouleau, commande minimum, frais de livraison et délai réellement tenu ? Les 17 EUR et 9 EUR sont-ils confirmés par un fournisseur nommé ?

🔴 **Bloquant**

*Pourquoi on a besoin de la réponse :* Le coût du marquage et le choix automatique entre la France (urgence) et l'Espagne (standard) reposent entièrement sur ces chiffres. C'est aussi ce qui permet de mesurer l'économie réelle de notre optimisation de placement des visuels sur le film.

*Si vous ne répondez pas, on partira sur :* 17 EUR hors taxes le mètre linéaire en 56 cm en France (48 h), 9 EUR hors taxes en Espagne (5 jours), 15 EUR de livraison par commande, 1 mètre minimum, 5 % de perte prévue.

**Votre réponse :**

> 

### 5. Quel taux horaire interne devons-nous compter pour la main-d'œuvre, même quand c'est vous ou vos frères qui produisez ? Et pouvez-vous chronométrer une vraie série (préparation, pressage, pelage, seconde presse, contrôle, pliage, emballage) ?

🔴 **Bloquant**

*Pourquoi on a besoin de la réponse :* Sans coût horaire, le prix plancher est faux et toutes les petites commandes paraissent rentables alors qu'elles ne le sont pas. Ce chiffre décide aussi si l'atelier a intérêt à poser deux transferts séparés pour économiser du film, ou un seul.

*Si vous ne répondez pas, on partira sur :* 20 EUR de l'heure chargé, 45 secondes par pose de transfert, 60 secondes de préparation par commande.

**Votre réponse :**

> 

### 6. Quel taux de marge visez-vous par famille de produits (t-shirt, polo, sweat, vêtement de travail), et quelle marge minimum acceptez-vous en dessous de laquelle une vente doit être refusée, même par un commercial ?

🔴 **Bloquant**

*Pourquoi on a besoin de la réponse :* Le moteur calcule le prix conseillé à partir du coût et du taux de marge, puis un prix plancher que le système refusera de franchir. Sans ces deux nombres, aucun prix ne peut être affiché ni aucune remise autorisée.

*Si vous ne répondez pas, on partira sur :* Marge cible 55 % sur textile et marquage, contribution minimale 25 % du prix hors taxes, remise maximale de 15 % sans validation de votre part.

**Votre réponse :**

> 

### 7. Combien coûte réellement un emballage (sachet, carton, étiquette) par commande, et quels tarifs transporteurs avez-vous négociés par tranche de poids et destination ? Offrez-vous la livraison au-dessus d'un certain montant ?

🟠 **Important**

*Pourquoi on a besoin de la réponse :* La livraison et l'emballage sont des coûts directs qui entrent dans le prix plancher, et le panier doit afficher un vrai prix d'expédition au client. Sans grille, on affiche un montant inventé qui sera soit dissuasif, soit à perte.

*Si vous ne répondez pas, on partira sur :* 0,60 EUR d'emballage par pièce plus 1,50 EUR de carton, grille publique Colissimo, livraison offerte au-dessus de 300 EUR hors taxes.

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

**Votre réponse :**

> 


## Paiements

### 15. Confirmez-vous Revolut Pay, ou préférez-vous Stripe ? Avez-vous déjà un compte marchand ouvert quelque part ? Acceptez-vous aussi le virement, le mandat administratif (mairies, écoles, hôpitaux) et le paiement en plusieurs fois ?

🔴 **Bloquant**

*Pourquoi on a besoin de la réponse :* C'est une intégration complète à développer et à tester : on ne peut pas en faire deux. Le mandat administratif, en particulier, ouvre la clientèle publique que vos concurrents traitent déjà et demande un traitement séparé (bon de commande, facturation dématérialisée).

*Si vous ne répondez pas, on partira sur :* Stripe pour la carte et le paiement mobile, virement accepté sur devis, mandat administratif traité hors ligne au lancement ; Revolut Pay ajouté plus tard si vous le souhaitez.

**Votre réponse :**

> 

### 16. À partir de quel montant acceptez-vous un acompte plutôt qu'un paiement à 100 % avant production ? Et accordez-vous un paiement à 30 jours à certains clients (grands comptes, collectivités) ?

🟠 **Important**

*Pourquoi on a besoin de la réponse :* Cela décide des règles de déblocage de la production : une commande payée à 50 % peut-elle partir en fabrication ? Sans règle, le système bloquera toute commande non payée intégralement, ce qui peut faire perdre des gros dossiers.

*Si vous ne répondez pas, on partira sur :* 100 % avant production ; acompte de 50 % possible au-dessus de 3 000 EUR hors taxes après votre validation ; aucun paiement à échéance au lancement.

**Votre réponse :**

> 


## Juridique et facturation

### 17. Pouvez-vous nous donner les informations légales exactes à faire figurer sur le site et les factures (raison sociale, forme juridique, adresse, SIRET, numéro de TVA intracommunautaire, capital) ? Tout est-il bien soumis à la TVA à 20 % ?

🔴 **Bloquant**

*Pourquoi on a besoin de la réponse :* Les mentions légales et les factures ne peuvent pas être publiées sans ces informations, et elles sont obligatoires. La TVA conditionne aussi tout l'affichage des prix et les objectifs de chiffre d'affaires (vos objectifs sont exprimés toutes taxes comprises, vos coûts hors taxes).

*Si vous ne répondez pas, on partira sur :* TVA à 20 % sur tout, mentions légales reprises des documents officiels de la société ; le site n'est pas mis en ligne tant que la page mentions légales est incomplète.

**Votre réponse :**

> 


## Juridique

### 18. Qui rédige et valide vos conditions générales de vente (professionnels et particuliers), vos mentions légales et votre politique de confidentialité ? Avez-vous un avocat ? Confirmez-vous que l'on inscrive la perte du droit de rétractation pour les articles personnalisés ?

🔴 **Bloquant**

*Pourquoi on a besoin de la réponse :* La loi française exclut le droit de rétractation pour les biens personnalisés, mais seulement si c'est correctement écrit et si le client le reconnaît explicitement. Nous devons enregistrer cette reconnaissance au moment de la validation du bon à tirer : il nous faut le texte exact validé par un juriste.

*Si vous ne répondez pas, on partira sur :* Nous préparons des textes de base à faire relire par un avocat, et une case à cocher de renonciation à la rétractation, horodatée et enregistrée à la validation du bon à tirer.

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

**Votre réponse :**

> 


## Juridique et SAV

### 27. Quelle est votre politique en cas de problème sur du personnalisé : remplacement, remboursement, ou geste commercial ? À partir de quel pourcentage de pièces non conformes ? Et acceptez-vous d'inscrire des tolérances écrites (écart de position de quelques millimètres, différence de couleur entre l'écran et le tissu, écart de quantité) ?

🟠 **Important**

*Pourquoi on a besoin de la réponse :* Ces tolérances doivent figurer dans les conditions générales et dans le texte affiché au moment où le client valide son bon à tirer. Sans elles, chaque écart normal de production devient un litige que vous perdez.

*Si vous ne répondez pas, on partira sur :* Remplacement si l'erreur vient de Teeshoop ; tolérance de position de plus ou moins 1 cm et écart de couleur d'écran accepté ; aucune reprise si le client s'est trompé de taille.

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
