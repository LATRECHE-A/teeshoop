---
title: "1. Moteur de prix et commissions"
subtitle: "Méthode de calcul, garde-fous de marge, remises et rémunération commerciale"
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

# 1. Moteur de prix et commissions

**Méthode de calcul, garde-fous de marge, remises et rémunération commerciale**

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

Le moteur de prix est le cœur économique de Teeshoop. Il doit calculer le coût réel d'une commande, proposer un prix de vente, afficher une zone de négociation et empêcher toute vente non rentable. Il doit également calculer la commission du commercial sur la marge contributive réellement encaissée.

Le commercial ne doit pas inventer un prix à partir d'un simple multiplicateur. Il doit voir quatre informations : prix conseillé, remise disponible, prix plancher et commission en temps réel. Plus il réduit le prix, plus sa commission baisse. Cette mécanique aligne son intérêt avec celui de l'entreprise.

## Définitions financières

### Chiffre d'affaires

- **TTC** : montant payé par le client.
- **HT** : base économique utilisée pour la marge et la commission.
- **TVA** : dette fiscale ; elle n'est ni une marge ni un revenu disponible.

### Coût direct

Le coût direct comprend tout ce qui disparaît si la commande n'existe pas : textile, marquage, transport fournisseur, emballage, livraison offerte, frais de paiement, consommables, sous-traitance, main-d'oeuvre variable et provision de défaut.

### Marge contributive

```text
Marge contributive = Prix de vente HT encaissé - coûts directs réels
```

Cette marge finance : commission, frais fixes, erreurs non prévues, développement, marketing, impôt et bénéfice.

### Résultat Teeshoop avant frais fixes

```text
Résultat Teeshoop = Marge contributive - commission commerciale
```

## Modèle de coût détaillé

### Textile

Pour chaque variante, stocker :

- fournisseur ;
- référence fournisseur ;
- prix d'achat HT ;
- éventuel supplément de taille ;
- conditionnement ;
- devise ;
- date de validité ;
- frais de port ou seuil de franco ;
- coefficient de risque en cas de prix estimé.

Lorsque le seul prix disponible est un prix catalogue à diviser par 2 à 2,5, le système doit marquer le coût comme **estimé** et utiliser le scénario prudent jusqu'à réception du tarif réel.

### DTF

Le coût ne doit pas être saisi « par logo » sans calcul. Il dépend de la surface occupée sur une laize de 56 cm, de l'imbrication, des marges techniques, des pertes et du fournisseur.

```text
Coût DTF commande = mètres linéaires nécessaires x tarif au mètre
                   + livraison DTF
                   + provision de perte
```

Paramètres de lancement :

- France : environ 17 EUR HT par mètre linéaire de 56 cm ;
- Espagne : environ 9 EUR HT par mètre linéaire de 56 cm ;
- France privilégiée pour l'urgence ;
- Espagne privilégiée pour le standard lorsque le délai le permet.

Le logiciel doit proposer un outil d'imposition : largeur et hauteur de chaque visuel, quantité, rotation autorisée, espace entre motifs, longueur totale et coût par pièce.

### Broderie

Le coût dépend :

- du nombre de points ;
- du temps machine ;
- du cerclage ;
- des changements de fil ;
- de la numérisation ;
- de la complexité du support ;
- du taux d'incident de la machine.

Le prix doit pouvoir être calculé par tranche de points et complété par un forfait de mise en route. La machine 15 aiguilles actuelle étant annoncée comme peu fiable, le moteur doit intégrer un mode « sous-traitance » et une provision de risque supérieure.

### Flocage, vinyle et sublimation

Chaque technique doit avoir : coût matière, temps de découpe ou impression, échenillage, temps de presse, perte, préparation et minimum de facturation.

### Main-d'oeuvre

La main-d'oeuvre ne doit pas être considérée comme gratuite parce que le dirigeant ou les proches produisent. Une valeur interne doit être imputée pour comparer les commandes et préparer la croissance.

```text
Coût main-d'oeuvre = temps standard x taux horaire chargé interne
```

Les temps standards sont à mesurer sur des séries réelles : réception, tri, préparation, pressage, pelage, second pressage, contrôle, pliage et emballage.

### Logistique et frais annexes

- frais fournisseur textile ;
- frais fournisseur DTF ;
- déplacement local ;
- emballage ;
- livraison client ;
- frais de paiement ;
- provision SAV ;
- coût de traitement d'une petite commande ;
- supplément express.

## Formules recommandées

### Coût total

```text
C_total = somme des coûts variables par ligne
        + coûts fixes de la commande
        + provision de risque
```

### Prix conseillé

Deux approches doivent coexister :

1. **marge cible** :

```text
Prix conseillé HT = C_total / (1 - taux de marge cible)
```

2. **prix de marché** : prix comparable observé ou choisi par la direction.

Le prix final conseillé doit être le maximum entre le prix économique nécessaire et la stratégie commerciale retenue, sous réserve de cohérence avec le marché.

### Prix plancher

Le prix plancher ne doit jamais être égal au coût brut. Il doit conserver une contribution minimale après commission.

```text
Prix plancher HT = (C_total + contribution minimale Teeshoop) / (1 - taux commission)
```

Le système doit pouvoir définir un plancher :

- par catégorie ;
- par technique ;
- par commercial ;
- par taille de commande ;
- par type de client ;
- par niveau d'urgence.

### Prix négociable

La zone de négociation se situe entre le prix conseillé et le prix plancher. Une vente sous le plancher nécessite une demande d'exception avec motif, validation, durée de validité et impact affiché.

## Commission commerciale

### Base

La commission est calculée sur la marge contributive encaissée, jamais sur le TTC et idéalement jamais sur le seul chiffre d'affaires.

### Taux de lancement

- première commande apportée et suivie par un commercial historique : 40 % de la marge contributive ;
- nouvelle commande nécessitant une vraie action de vente : 20 à 30 % ;
- réassort simple : 10 à 15 % ;
- commande autonome du site : 0 % sauf règle d'attribution temporaire ;
- participation uniquement à la production : rémunération séparée selon un barème de production.

### Date d'acquisition de la commission

La commission devient provisoire à l'encaissement, puis définitive lorsque :

- le délai de contestation interne est passé ;
- aucun remboursement significatif n'est en cours ;
- les coûts réels ont été renseignés ;
- la commande a été livrée ou clôturée.

### Règles de reprise

Une commission peut être réduite si :

- le client est remboursé ;
- le commercial a promis une prestation non chiffrée ;
- une remise non autorisée a été appliquée ;
- une erreur de saisie lui est imputable ;
- la marge réelle est inférieure à la marge estimée.

Les règles doivent être écrites dans le contrat et appliquées de façon transparente.

## Exemple de calcul

Commande de 30 t-shirts :

- textile : 3,00 EUR HT x 30 = 90 EUR ;
- DTF et livraison : 65 EUR ;
- main-d'oeuvre valorisée : 45 EUR ;
- emballage : 9 EUR ;
- transport fournisseur : 10 EUR ;
- livraison client : 15 EUR ;
- paiement et provision SAV : 16 EUR ;
- coût total : 250 EUR HT.

Prix de vente : 625 EUR HT, soit 750 EUR TTC.

```text
Marge contributive = 625 - 250 = 375 EUR
Commission 40 % = 150 EUR
Contribution Teeshoop = 225 EUR
```

Si le commercial accorde une remise de 75 EUR HT :

```text
Nouveau prix = 550 EUR HT
Nouvelle marge = 300 EUR
Commission = 120 EUR
Contribution Teeshoop = 180 EUR
```

La remise coûte donc 30 EUR au commercial et 45 EUR à Teeshoop.

## Remises par volume

Les remises ne doivent pas suivre des paliers arbitraires identiques pour tous les produits. Le système doit calculer les économies réelles : amortissement du transport, optimisation DTF, réduction du temps par pièce et conditions fournisseur.

Exemple de paliers configurables : 5-9, 10-24, 25-49, 50-99, 100-249, 250+. Le prix peut baisser lorsque le coût unitaire baisse, sans jamais franchir le plancher.

## Petites commandes

Le minimum de 50 EUR et 5 pièces doit être contrôlé. Pour éviter les frais cachés, le système peut intégrer le coût de préparation directement dans le prix unitaire. Le client voit un prix final clair ; il n'est pas surpris par une ligne artificielle ajoutée au dernier moment.

## Express et urgence

Le supplément doit couvrir :

- DTF plus cher en France ;
- priorité de production ;
- éventuel déplacement ;
- risque accru ;
- temps de coordination.

Le supplément peut être calculé en pourcentage ou par coût réel plus marge. L'urgence doit être acceptée uniquement si le stock, le BAT et la capacité sont confirmés.

## Interface commerciale

L'écran doit afficher :

- coût estimé et niveau de confiance ;
- prix conseillé HT et TTC ;
- prix plancher ;
- remise en EUR et en pourcentage ;
- marge avant commission ;
- commission du commercial ;
- marge Teeshoop ;
- alertes ;
- historique des modifications.

Le coût d'achat et la marge détaillée peuvent être masqués selon le rôle. Le commercial voit suffisamment d'informations pour négocier, sans accéder aux paramètres sensibles de tous les fournisseurs.

## Modèle de données minimal

### price_rule

- id ;
- scope ;
- product_id ou category_id ;
- technique ;
- quantity_min et max ;
- target_margin ;
- minimum_contribution ;
- valid_from et valid_to ;
- priority ;
- active.

### cost_component

- type ;
- source ;
- amount ;
- unit ;
- confidence ;
- effective_date ;
- evidence ;
- order_line_id.

### commission_rule

- role ;
- sale_type ;
- margin_rate ;
- conditions ;
- clawback_rule ;
- effective_date.

### price_calculation

- inputs ;
- formula_version ;
- suggested_price ;
- floor_price ;
- final_price ;
- margin ;
- commission ;
- approver ;
- timestamp.

## API fonctionnelle

### Calcul

`POST /pricing/quotes/calculate`

Entrées : lignes produits, quantités, variantes, techniques, dimensions, délai, livraison, client, commercial et type de vente.

Sorties : coût détaillé, prix conseillé, plancher, fourchette de remise, commission, contribution Teeshoop, avertissements et version de formule.

### Validation d'exception

`POST /pricing/quotes/{id}/approval-request`

Contenu : prix demandé, justification, concurrent, importance du client, date limite et pièces jointes.

### Historique

Toute modification de prix doit créer une nouvelle version ; un devis envoyé ne doit jamais être modifié silencieusement.

## KPI

- marge contributive moyenne ;
- marge Teeshoop après commission ;
- taux de remise ;
- taux de devis sous plancher ;
- coût estimé contre coût réel ;
- commission en pourcentage du CA HT ;
- rentabilité par produit, technique, commercial et client ;
- fréquence des exceptions ;
- part des commandes express ;
- coût SAV par commande.

## Plan d'implémentation

### Semaine 1

- définir les composants de coût ;
- saisir 20 commandes historiques ou simulées ;
- mesurer les temps ;
- fixer les premiers taux de marge.

### Semaine 2

- développer le calcul interne ;
- créer le prix conseillé et le plancher ;
- tester les commissions ;
- valider les cas limites.

### Semaine 3

- intégrer au devis ;
- afficher la commission en direct ;
- ajouter les validations de remise ;
- historiser les versions.

### Semaine 4

- piloter les premiers devis ;
- comparer estimations et coûts réels ;
- corriger les paramètres ;
- verrouiller les règles contractuelles.

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
