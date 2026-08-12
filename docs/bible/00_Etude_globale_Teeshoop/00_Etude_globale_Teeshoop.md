---
title: "La Bible de Teeshoop - Étude globale"
subtitle: "Vision, modèle économique, organisation, technologie et trajectoire de croissance"
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

# La Bible de Teeshoop - Étude globale

**Vision, modèle économique, organisation, technologie et trajectoire de croissance**

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

Teeshoop ne doit pas être construit comme un simple atelier de marquage ni comme un catalogue e-commerce sans accompagnement. Le modèle le plus cohérent est celui d'une **plateforme B2B de personnalisation textile à forte assistance humaine**, soutenue par une organisation commerciale locale et par un système numérique national.

Le cœur de la proposition de valeur est la réduction de la complexité. Le client peut arriver avec un besoin précis, un logo imparfait, une idée vague ou une contrainte urgente. Teeshoop doit prendre en charge la sélection du produit, la préparation du fichier, le devis, le paiement, le BAT, l'approvisionnement, la production, le contrôle, la livraison et le réassort. Le site doit permettre l'autonomie, mais ne doit jamais enfermer le client dans un parcours incompréhensible.

Le modèle économique possède plusieurs avantages : absence de loyer significatif au lancement, absence de stock textile important, capacité de commander les supports après paiement, production DTF rapide, équipe extensible et compétences internes en développement, marketing et IA. Ces avantages sont puissants, mais ils peuvent être détruits par une tarification improvisée, des commissions trop élevées, un service graphique illimité ou un site surdimensionné avant les ventes.

La priorité des six premiers mois est donc de créer un système commercial reproductible : grand catalogue structuré, moteur de prix, devis et paiement rapides, BAT traçable, CRM, relances, production organisée et mesure quotidienne des marges. La croissance doit être financée par les commandes plutôt que par un stock ou une masse salariale lourde.

## Thèse stratégique

### Ce que Teeshoop vend réellement

Le produit visible est le textile personnalisé. La valeur perçue est plus large :

- tranquillité pour le dirigeant client ;
- gain de temps ;
- cohérence de l'image de l'entreprise ;
- accès à un interlocuteur humain ;
- possibilité de commander de petites ou grandes quantités ;
- réassort simplifié ;
- capacité à traiter une urgence ;
- accompagnement du fichier jusqu'au produit fini.

La promesse centrale peut être formulée ainsi :

> Vous vous occupez de votre entreprise. Teeshoop s'occupe de votre image textile, de la création à la livraison.

### Porte d'entrée commerciale

Même si le dirigeant possède des compétences en sites web, réseaux sociaux, identité visuelle et conseil, Teeshoop doit conserver une porte d'entrée claire : **le textile et les objets personnalisés pour professionnels**. Les autres services peuvent être recommandés lorsqu'ils répondent à un besoin, mais ils ne doivent pas brouiller le message principal du site ni des prospecteurs.

### Modèle à deux moteurs

1. **Moteur local et humain** : téléprospection, commerciaux indépendants, rendez-vous en Île-de-France, collecte des besoins, suivi des grands comptes.
2. **Moteur numérique national** : grand catalogue, devis et paiement en ligne, personnalisation, conseil à distance, SEO, contenu, e-mail et réassort.

Ces deux moteurs doivent partager la même base de données. Un client acquis au téléphone doit pouvoir commander sur le site sans être recréé. Une commande web importante doit pouvoir être attribuée à un commercial. Le CRM doit être le point de convergence.

## Analyse du modèle économique

### Revenus possibles

- vente de textiles personnalisés ;
- vente d'objets publicitaires ;
- frais ou suppléments express ;
- travaux graphiques complexes ;
- vectorisation ou création humaine au-delà du forfait inclus ;
- livraison ;
- réassorts récurrents ;
- packs sectoriels ;
- contrats annuels ou commandes programmées pour entreprises multi-sites.

### Structure des coûts

- achat du textile ;
- marquage DTF, broderie, flocage ou sous-traitance ;
- transport fournisseur ;
- temps de préparation et de production ;
- consommables et emballage ;
- transport client ;
- frais de paiement ;
- commissions commerciales ;
- provision d'erreur et de SAV ;
- logiciels, téléphonie, e-mail et hébergement ;
- impôts et charges de structure.

### Avantage du modèle sans stock

Le modèle à la demande réduit l'immobilisation financière. Il exige toutefois :

- une visibilité fiable sur le stock fournisseur ;
- des règles de substitution en cas de rupture ;
- une validation rapide du BAT ;
- une séparation stricte entre date souhaitée et date garantie ;
- une gestion des commandes fournisseurs tracée.

### Objectifs chiffrés

À 50 000 EUR TTC mensuels, le chiffre d'affaires HT est proche de 41 667 EUR avec une TVA de 20 %. Avec un panier moyen de 750 EUR TTC, environ 67 commandes par mois sont nécessaires, soit trois à quatre commandes par jour ouvré. Le modèle doit donc être capable de traiter plusieurs dizaines de dossiers simultanément sans dépendre de la mémoire du dirigeant.

L'objectif de 15 000 à 20 000 EUR nets après impôt sur les sociétés est un scénario très performant. Il nécessite une discipline forte sur les achats, les remises, les commissions et le temps consacré à chaque dossier. La phase de lancement doit suivre trois scénarios : prudent, central et très performant.

## Segments commerciaux

Teeshoop peut accepter tous les secteurs, mais ne doit pas employer le même argumentaire pour tous. Les premières familles de campagnes peuvent être :

### Restauration et commerces

Besoins : t-shirts, polos, tabliers, casquettes, vêtements d'équipe, réassorts, événements, ouverture de point de vente.

Arguments : rapidité, cohérence des tenues, petites quantités, renouvellement simple, accompagnement du logo.

### BTP, sécurité, nettoyage et services techniques

Besoins : vêtements de travail, haute visibilité, softshells, parkas, polos, marquage cœur et dos, noms individuels.

Arguments : catalogue large, tailles, résistance, visibilité, réassort des nouveaux salariés, suivi par entreprise.

### Associations, sport, écoles et événements

Besoins : t-shirts, sweats, polos, casquettes, sacs, tenues d'équipe, séries limitées, tailles multiples.

Arguments : accompagnement, gestion des tailles, BAT, délais, packs, possibilité de réassort.

## Architecture de l'offre

### Catalogue large

Le catalogue doit présenter réellement le choix disponible. Le *Catalogue Teeshoop 2026 Officiel* couvre notamment : t-shirts essentiels, t-shirts, polos, sweats, polaires, softshells, bodywarmers et blousons, chemises, pulls, costumes, pantalons, tenues professionnelles, vêtements de travail, haute visibilité, sportswear, linge, casquettes, bonnets, sacs, bagagerie et enfant.

La largeur du catalogue ne doit pas se transformer en confusion. La solution n'est pas de cacher la majorité des produits, mais d'offrir :

- une taxonomie cohérente ;
- des filtres rapides ;
- des comparateurs ;
- des badges explicatifs ;
- des recommandations selon le besoin ;
- un bouton « être conseillé » toujours visible.

### Packs

Les packs ne remplacent pas le catalogue. Ils servent d'accélérateurs de décision. Exemples :

- pack ouverture restaurant ;
- pack équipe chantier ;
- pack association ;
- pack événement ;
- pack nouvelle recrue ;
- pack réassort trimestriel.

Chaque pack doit rester configurable : quantités, tailles, produits, emplacements et technique.

## Organisation humaine

### Direction

Le dirigeant doit conserver les fonctions de stratégie, marketing, amélioration continue, validation des exceptions et gestion des grands comptes. Il ne doit pas rester durablement le seul à passer les commandes fournisseurs, traiter les problèmes et valider les marges.

### Téléprospection Madagascar

Mission initiale : appeler, qualifier, identifier un besoin, obtenir un accord pour une proposition ou un rendez-vous, renseigner le CRM et planifier la prochaine action. La productivité doit être mesurée par les conversations utiles et les opportunités créées, pas uniquement par le nombre d'appels.

### Commerciaux indépendants France

Mission : qualification avancée, découverte, proposition, devis, BAT, suivi et participation ponctuelle aux opérations. Leur commission doit être calculée sur la marge contributive encaissée. Les réassorts simples doivent être moins commissionnés que l'acquisition initiale.

### Production

Au lancement, le dirigeant, ses frères, les commerciaux et les développeurs peuvent aider. Ce fonctionnement doit être temporaire. Dès que le volume augmente, il faut séparer la vente, la préparation des fichiers, la production, le contrôle et l'emballage.

## Architecture numérique cible

### Principes

- WordPress et WooCommerce comme socle e-commerce ;
- développements sur mesure pour les règles spécifiques ;
- base de données commerciale unifiée ;
- événements et webhooks plutôt que copier-coller ;
- traçabilité de chaque changement ;
- rôles et permissions ;
- automatisation des tâches répétitives ;
- possibilité de remplacer un fournisseur ou un service sans refaire tout le système.

### Modules principaux

1. catalogue et synchronisation fournisseurs ;
2. configurateur et fichiers graphiques ;
3. moteur de prix ;
4. devis, paiement et BAT ;
5. CRM et prospection ;
6. commandes fournisseurs ;
7. production et contrôle ;
8. livraison et SAV ;
9. commissions ;
10. tableaux de bord ;
11. automatisations Brevo, Ringover, Qonto et paiements.

## Risques majeurs et protections

| Risque | Conséquence | Protection prioritaire |
|---|---|---|
| Prix fixés à l'intuition | commandes non rentables | moteur de prix et prix plancher |
| 40 % de commission mal définis | marge détruite | commission sur marge encaissée |
| Trop de création gratuite | temps non facturé | limites et éligibilité |
| Site trop complexe avant les ventes | retard du lancement | MVP opérationnel en un mois |
| Catalogue massif mal structuré | abandon client | filtres, comparateur, conseil |
| Dépendance à un fournisseur DTF | retard | fournisseur France + Espagne + secours |
| Erreurs de tailles ou visuels | SAV coûteux | BAT, contrôle et validation |
| Base de prospection mal gouvernée | risque RGPD et mauvaise réputation | information, opposition, liste repoussoir |
| Équipe polyvalente sans responsabilité | dossiers oubliés | propriétaires, tâches et SLA |

## Feuille de route

### Jours 1 à 30 - lancement contrôlé

- formaliser les coûts et la tarification ;
- créer les premiers produits et variantes ;
- construire le CRM minimal ;
- intégrer les statuts devis, paiement et BAT ;
- former les prospectrices ;
- démarrer les appels tests ;
- publier les premières pages sectorielles ;
- traiter les premières commandes avec contrôle manuel renforcé.

### Mois 2 à 3 - stabilisation

- mesurer les marges réelles ;
- corriger les prix ;
- automatiser les relances ;
- étendre le catalogue ;
- connecter Ringover et Brevo ;
- structurer le SAV ;
- séparer les rôles de production ;
- développer les premiers packs.

### Mois 4 à 6 - accélération vers 50 000 EUR TTC

- augmenter le nombre d'opportunités qualifiées ;
- renforcer les réassorts ;
- lancer le SEO et les campagnes payantes validées ;
- intégrer les API fournisseurs prioritaires ;
- piloter le taux de marge et la commission ;
- recruter la première ressource opérationnelle dédiée si le volume le justifie.

### Mois 7 à 12 - objectif 80 000 EUR TTC

- industrialiser la production ;
- contractualiser les grands comptes ;
- créer des campagnes sectorielles ;
- améliorer la personnalisation en ligne ;
- automatiser les achats et la facturation ;
- renforcer la fiabilité, la sécurité et le reporting.

### Années 2 à 3 - objectif 250 000 EUR TTC mensuels

- organisation multi-équipe ;
- capacité de production ou réseau de sous-traitants qualifiés ;
- commercial national ;
- comptes clés ;
- infrastructure scalable ;
- gestion fine des engagements de service ;
- direction moins dépendante des opérations quotidiennes.

## Arbre de KPI

### Acquisition

- tentatives d'appel ;
- conversations ;
- prospects qualifiés ;
- rendez-vous ;
- demandes de devis ;
- coût par opportunité.

### Vente

- taux de conversion ;
- panier moyen ;
- délai devis-paiement ;
- taux de remise ;
- marge contributive ;
- commission moyenne.

### Opérations

- délai paiement-BAT ;
- délai BAT-production ;
- taux de conformité au premier passage ;
- pièces produites par heure ;
- commandes livrées à l'heure ;
- coût SAV.

### Fidélisation

- taux de réassort ;
- fréquence de commande ;
- valeur annuelle par client ;
- taux de recommandation ;
- taux de perte client.

## Décisions de gouvernance recommandées

- Toute vente doit avoir un coût complet calculé.
- Toute remise doit être visible et tracée.
- Toute production doit être précédée d'un BAT accepté, sauf cas express documenté.
- Toute commission doit être liée à un encaissement.
- Toute commande doit avoir un propriétaire opérationnel.
- Toute réclamation doit être enregistrée avec une cause et un coût.
- Toute automatisation doit avoir un mécanisme de reprise manuelle.
- Toute fonctionnalité doit répondre à un problème métier mesurable.

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
