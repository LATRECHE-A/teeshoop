---
title: "5. Production et SAV"
subtitle: "Approvisionnement, ordonnancement, DTF, broderie, contrôle qualité, livraison et réclamations"
author: "Teeshoop - Version consolidée"
date: "24 juillet 2026"
lang: fr-FR
geometry: margin=1.7cm
fontsize: 10pt
toc: true
toc-depth: 3
numbersections: true
colorlinks: true
linkcolor: blue
urlcolor: blue
---

# 5. Production et SAV

**Approvisionnement, ordonnancement, DTF, broderie, contrôle qualité, livraison et réclamations**

**Statut :** document de travail consolidé, destiné à la direction, aux commerciaux, aux opérations et aux développeurs.


## Cadre retenu pour Teeshoop

Cette compilation est construite à partir des informations opérationnelles fournies par le dirigeant et du *Catalogue Teeshoop 2026 Officiel*. Les décisions suivantes servent de base commune aux huit rapports :

- Teeshoop est une activité B2B de personnalisation textile exploitée depuis Bobigny.
- La commande minimale envisagée est de 5 pièces, avec un minimum de commande de 50 EUR.
- Le développement commercial de proximité vise d'abord l'Île-de-France ; le site doit vendre dans toute la France puis dans la francophonie.
- L'offre doit présenter un catalogue large, avec plusieurs centaines de références, de nombreuses couleurs, tailles, grammages et matières. Il n'est pas prévu de réduire le site à une petite sélection.
- La production visée repose majoritairement sur le DTF, complété par le flocage, le vinyle, la sublimation, la broderie et, lorsque nécessaire, la sous-traitance.
- Les textiles sont commandés à la demande. Imbretex peut livrer rapidement ; Falk & Ross et, plus tard, Mid Ocean doivent également être connectés.
- Le DTF peut être commandé en France pour les urgences ou en Espagne pour les délais standards. Les ordres de grandeur communiqués sont 17 EUR HT le mètre linéaire de 56 cm en France et 9 EUR HT en Espagne, avec environ 5 jours de délai pour l'Espagne.
- L'objectif commercial est de 50 000 EUR TTC par mois à 6 mois, 80 000 EUR TTC à 12 mois et 250 000 EUR TTC par mois à 3 ans.
- Le panier moyen recherché se situe entre 500 EUR et 1 000 EUR TTC.
- La trésorerie mobilisable est d'environ 10 000 EUR et le budget mensuel de lancement est d'environ 1 000 EUR, dont 500 EUR pour deux téléprospectrices à Madagascar.
- La base de prospection comprend environ 150 000 entreprises, principalement franciliennes, avec téléphone et e-mail, collectées depuis moins d'un an et annoncées comme nettoyées et dédoublonnées.
- Deux téléprospectrices à Madagascar doivent travailler approximativement de 10 h à 18 h, heure française, avec un objectif proche de 180 tentatives d'appel par personne et par jour.
- Deux à trois commerciaux indépendants en France peuvent prospecter, préparer les devis et les BAT, suivre leurs clients et participer ponctuellement à la production.
- Les premiers commerciaux peuvent recevoir 40 % de la marge contributive sur les premières ventes, sous réserve de règles plus précises pour les réassorts et les commandes récurrentes.
- Le socle retenu est WordPress et WooCommerce, avec des développements sur mesure. Qonto est envisagé pour les devis et factures, Brevo pour l'e-mail, Ringover pour la téléphonie, et Revolut Pay est étudié pour les paiements.
- Teeshoop se positionne comme un partenaire humain et simple : « Vous vous occupez de votre entreprise, Teeshoop s'occupe de votre image. »

Les montants non confirmés par une grille tarifaire ou une API sont présentés comme des paramètres à valider, et non comme des vérités comptables définitives.

## Résumé exécutif

Teeshoop dispose d'une capacité de production potentiellement élevée en DTF, mais la presse n'est qu'une étape. La performance réelle dépend de la réception, du tri, de la préparation, de l'imposition, du contrôle, du pliage et de l'emballage. Le système doit donc piloter une commande de bout en bout, pas seulement compter les secondes de pressage.

La stratégie sans stock est adaptée au lancement. Elle exige un approvisionnement fiable, un choix automatique ou assisté entre DTF France et Espagne, une confirmation de stock avant engagement ferme et un contrôle qualité documenté.

## Flux opérationnel

1. commande payée ;
2. fichiers contrôlés ;
3. BAT validé ;
4. choix fournisseurs ;
5. commandes textile et DTF ;
6. suivi des réceptions ;
7. contrôle entrant ;
8. préparation des lots ;
9. production ;
10. contrôle final ;
11. emballage ;
12. expédition ou remise ;
13. confirmation de livraison ;
14. clôture ou SAV.

Aucune commande ne doit être « en production » si les supports, transferts et instructions ne sont pas disponibles.

## Routage DTF

### Standard

Lorsque le client accepte environ 12 jours, le système peut privilégier l'Espagne si le coût total et la fiabilité sont meilleurs. Il faut tenir compte du délai de validation du BAT, pas seulement du transport.

### Express

Pour 6 à 7 jours, le choix dépend de la date réelle, du stock et des jours ouvrés. Une commande espagnole peut devenir risquée si le BAT tarde.

### Urgence locale

Pour 4 à 5 jours, le DTF français et le retrait local sont privilégiés. Un supplément couvre le coût et la priorité.

### Algorithme de décision

Entrées : date promise, date actuelle, BAT, stock, temps fournisseur, buffer, coût, fiabilité et capacité interne.

Sortie : fournisseur recommandé, date estimée de réception, coût, risque et décision humaine si le niveau de risque est élevé.

## Commande textile

### Réservation et confirmation

Le stock affiché par une API n'est pas une garantie absolue. Le système doit enregistrer la date de consultation, puis confirmer la commande fournisseur. Une rupture déclenche : substitution, changement de couleur, fractionnement ou remboursement partiel après accord client.

### Réception

- comparer bon de livraison et commande ;
- compter ;
- vérifier références, couleurs et tailles ;
- inspecter les défauts visibles ;
- photographier les anomalies ;
- mettre en quarantaine les pièces douteuses ;
- enregistrer les écarts.

## Préparation

Chaque commande est divisée en lots homogènes : produit, couleur, taille, visuel, emplacement et technique. Les transferts sont comptés et rapprochés des quantités, avec une réserve définie.

La fiche de fabrication indique :

- commande ;
- client ;
- BAT ;
- référence ;
- quantités ;
- emplacement ;
- dimensions ;
- pression, température et durée ;
- pelage ;
- seconde presse ;
- opérateur ;
- contrôles.

## Capacité DTF

La cadence annoncée de 30 secondes pour deux t-shirts doit être testée en conditions complètes. La capacité doit être mesurée sur :

- temps de cycle presse ;
- changements de taille ou visuel ;
- préparation ;
- pelage ;
- contrôle ;
- emballage ;
- incidents.

Une capacité prudente est plus utile qu'une capacité théorique. Le système calcule les heures nécessaires et la date de fin selon les ressources disponibles.

## Broderie

La machine 15 aiguilles actuelle est un point de risque. Avant de promettre des volumes, Teeshoop doit :

- mesurer le taux d'arrêt ;
- créer une maintenance ;
- définir les travaux acceptables ;
- avoir un sous-traitant de secours ;
- tester chaque support ;
- facturer la numérisation ou l'intégrer selon le panier.

La broderie suit un flux distinct : fichier numérisé, essai, validation, cerclage, production, coupe des fils et contrôle.

## Ordonnancement

Priorités possibles :

1. urgence confirmée ;
2. date client ;
3. commande complète ;
4. grands comptes ;
5. regroupement technique ;
6. rentabilité et coût de changement.

Le responsable peut modifier l'ordre, mais doit indiquer le motif. Les commandes urgentes ne doivent pas désorganiser les commandes standard sans supplément.

## Contrôle qualité

### Avant production

- support correct ;
- taille et couleur ;
- fichier ;
- dimension ;
- emplacement ;
- paramètres ;
- échantillon ou première pièce.

### Première pièce

La première pièce est contrôlée par rapport au BAT. Pour une grosse série, elle est photographiée et validée en interne avant de continuer.

### Pendant

Contrôle périodique : adhérence, position, défaut, changement de couleur, température et pression.

### Final

- quantité ;
- tailles ;
- marquage ;
- propreté ;
- emballage ;
- étiquette ;
- adresse ;
- documents.

## Traçabilité

Chaque pièce n'a pas forcément besoin d'un numéro unique au lancement, mais chaque lot doit connaître : opérateur, machine, transfert, date, paramètres et contrôle. Cette information permet d'identifier une cause en SAV.

## Emballage et expédition

- pliage standard ;
- sachet selon besoin ;
- regroupement par taille ;
- liste de colisage ;
- étiquette ;
- photo du colis pour commandes sensibles ;
- numéro de suivi ;
- notification client.

Les tarifs transport doivent être récupérés ou paramétrés par poids, dimensions, destination et service. La livraison locale doit inclure le coût du véhicule et du temps.

## SAV

### Principes

- dossier unique ;
- preuve ;
- réponse rapide ;
- distinction entre erreur Teeshoop, défaut fournisseur, transport et erreur client ;
- solution proportionnée ;
- analyse de cause.

### Motifs

- quantité ;
- taille ;
- couleur ;
- produit ;
- défaut textile ;
- défaut marquage ;
- position ;
- fichier ;
- colis ;
- délai ;
- autre.

### Formulaire

Le client indique commande, ligne, quantité concernée, motif, description, photos et solution souhaitée.

### Matrice de décision

| Cause | Solution habituelle |
|---|---|
| erreur Teeshoop | remplacement prioritaire, avoir ou remboursement |
| défaut fournisseur | remplacement et recours fournisseur |
| dommage transport | dossier transport et remplacement selon urgence |
| erreur validée dans le BAT | pas de gratuité automatique ; geste éventuel |
| mauvaise taille commandée | pas de reprise standard sur personnalisé ; solution commerciale possible |
| usure ou entretien inadapté | analyse et conseil |

Le traitement au cas par cas reste possible, mais il doit partir d'une règle afin d'éviter les décisions incohérentes.

## SLA SAV

- accusé de réception immédiat ;
- première réponse humaine sous un jour ouvré ;
- demande de pièces complémentaires ;
- décision simple sous deux jours ;
- délai de remplacement annoncé ;
- escalade direction pour montant ou risque important.

## Coût SAV

Chaque dossier doit calculer : textile, marquage, transport, temps, remboursement, avoir et récupération fournisseur. Ce coût est relié à la commande, au produit, à la technique, au fournisseur et à l'opérateur.

## Automatisations

- création de commandes fournisseurs ;
- suivi de réception ;
- alerte de retard ;
- génération fiche de fabrication ;
- QR code de lot ;
- validation de première pièce ;
- notification expédition ;
- ticket SAV ;
- demande d'avis après clôture ;
- rapport hebdomadaire qualité.

## Rôles

- acheteur ou dirigeant : fournisseurs ;
- préparateur : tri et lots ;
- opérateur : production ;
- contrôleur : première pièce et final ;
- emballeur ;
- commercial : communication client ;
- responsable SAV : décision ;
- direction : exceptions.

Au lancement, une personne peut cumuler plusieurs rôles, mais les actions doivent rester distinctes dans le système.

## KPI

- délai paiement-production ;
- délai BAT-commande fournisseur ;
- réception à l'heure ;
- productivité par technique ;
- taux de première pièce conforme ;
- défauts par 100 pièces ;
- retouches ;
- commandes livrées à l'heure ;
- coût SAV en pourcentage du CA ;
- taux de remplacement ;
- causes par fournisseur ;
- charge de production à 7 et 14 jours.

## Critères d'acceptation

- aucune production sans BAT ;
- chaque commande a une fiche ;
- chaque réception est rapprochée ;
- les écarts bloquent les lignes concernées ;
- la première pièce est validée pour les séries définies ;
- le colis est vérifié avant expédition ;
- tout SAV a une cause, un coût et une solution ;
- la capacité est calculée avec des temps mesurés ;
- le système peut fonctionner avec un fournisseur de secours.

## Déploiement

### Phase 1

Tableau de production, fiches PDF, contrôles, statuts et SAV simple.

### Phase 2

Approvisionnement assisté, codes de lot, capacité, transport et statistiques.

### Phase 3

Ordonnancement avancé, intégration machines ou scanners, multi-ateliers et réseau de sous-traitants.

## Références de travail

- Informations fournies par le dirigeant de Teeshoop au cours du cadrage stratégique.
- *Catalogue Teeshoop 2026 Officiel*, 196 pages, fourni dans la conversation.
- Documentation développeur WooCommerce : REST API, Store API et webhooks.
- Documentation développeur Qonto : devis, factures clients, statuts et webhooks.
- Documentation développeur Brevo : contacts, campagnes, automatisations et webhooks.
- Documentation développeur Ringover : appels, événements et webhooks.
- Documentation développeur Revolut : Merchant API, Revolut Pay et cycle de paiement.
- CNIL : règles de prospection commerciale, information des professionnels et droit d'opposition.
- DGCCRF et ministère de l'Économie : règles du commerce électronique et traitement des produits personnalisés.

> Ce document est un outil stratégique et fonctionnel. Les clauses juridiques, fiscales, sociales et contractuelles doivent être validées par les professionnels compétents avant mise en production.
