---
title: "4. Catalogue et fiches produits"
subtitle: "Grand catalogue, taxonomie, variantes, filtres, données fournisseurs, SEO et expérience d'achat"
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

# 4. Catalogue et fiches produits

**Grand catalogue, taxonomie, variantes, filtres, données fournisseurs, SEO et expérience d'achat**

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

Teeshoop veut afficher une offre large pour donner une impression réelle de choix et permettre aux professionnels de comparer grammages, matières, coupes, tailles, couleurs et techniques. Cette décision est cohérente, à condition que l'architecture du catalogue soit pensée comme un moteur de recherche spécialisé et non comme une succession de centaines de pages difficiles à parcourir.

Le catalogue fourni compte 196 pages et couvre de nombreuses familles. Avec plusieurs produits par page, le site peut rapidement atteindre plusieurs centaines de produits et des milliers de variantes. La difficulté principale n'est pas l'import ; c'est la qualité des données, la performance, la lisibilité et la maintenance.

## Périmètre du catalogue

Familles visibles dans le catalogue :

- t-shirt essentiel ;
- t-shirt ;
- polo ;
- sweat-shirt ;
- polaire ;
- softshell ;
- bodywarmer et blouson ;
- chemise et pull ;
- costume et pantalon ;
- tenue professionnelle ;
- vêtement de travail ;
- visibilité augmentée ;
- sportswear ;
- éponge et linge de maison ;
- casquette, bonnet et accessoires hiver ;
- sac shopping et pochette ;
- bagagerie ;
- enfant.

Le catalogue présente aussi les techniques de broderie, sérigraphie, DTG, transfert, flocage et DTF, ainsi que des prix indicatifs, références, couleurs, tailles, grammages et compatibilités de marquage.

## Principe de présentation

Teeshoop ne doit pas cacher la majorité des produits derrière « sur demande ». Le site peut montrer le catalogue complet tout en offrant trois modes d'exploration :

1. navigation par famille ;
2. recherche et filtres ;
3. conseil guidé selon l'usage.

Un client expert peut filtrer précisément. Un client novice peut répondre à quelques questions : secteur, usage, quantité, budget, saison, niveau de qualité et délai.

## Taxonomie

### Catégories

Les catégories décrivent le type de produit. Elles doivent être stables et limitées en profondeur. Exemple : Vêtements > T-shirts > manches courtes.

### Collections d'usage

- restauration ;
- BTP ;
- sécurité ;
- événement ;
- sport ;
- école ;
- association ;
- commerce ;
- haute visibilité ;
- écoresponsable.

Une même référence peut apparaître dans plusieurs collections sans être dupliquée.

### Marques

Chaque marque a une page, mais les filtres doivent éviter que la marque domine l'usage si le client ne la connaît pas.

### Attributs

- genre ou coupe ;
- âge ;
- manches ;
- col ;
- grammage ;
- matière ;
- pourcentage de coton ou polyester ;
- certification ;
- coupe ;
- tailles ;
- couleurs ;
- résistance ;
- saison ;
- stock ;
- délai ;
- techniques compatibles ;
- zone de marquage ;
- prix du support ;
- prix personnalisé à partir de.

## Variantes

Une référence produit possède plusieurs variantes de couleur et taille. Il faut éviter de créer une fiche séparée pour chaque taille. Le modèle doit distinguer :

- produit parent ;
- couleur ;
- taille ;
- SKU fournisseur ;
- stock ;
- prix d'achat ;
- supplément ;
- image ;
- date de mise à jour.

Les couleurs doivent avoir un identifiant fournisseur, un nom normalisé et une valeur d'affichage. « Navy », « French Navy » et « Deep Navy » ne doivent pas être fusionnés sans règle.

## Données fournisseurs

### Sources

- API ;
- CSV ou Excel ;
- flux ;
- catalogue PDF ;
- saisie manuelle de secours.

### Source de vérité

Chaque champ doit connaître sa source. Exemple : stock fournisseur, description Teeshoop, image fournisseur, prix calculé Teeshoop. Une synchronisation ne doit pas écraser un contenu marketing enrichi par Teeshoop.

### Mapping

Les fournisseurs utilisent des catégories, tailles et couleurs différentes. Un dictionnaire de mapping est nécessaire. Les valeurs inconnues entrent dans une file de validation.

### Fréquence

- stock : plusieurs fois par jour si l'API le permet ;
- prix d'achat : quotidien ou selon changement ;
- description et images : hebdomadaire ;
- suppression : jamais immédiate sans vérification.

## Fiche produit idéale

### Partie visible immédiatement

- nom clair ;
- marque et référence ;
- photo ;
- prix du support ou prix personnalisé indicatif ;
- délai ;
- couleurs ;
- tailles ;
- quantité ;
- bouton personnaliser ;
- bouton être conseillé.

### Informations détaillées

- grammage ;
- matière ;
- coupe ;
- entretien ;
- certifications ;
- compatibilité DTF, broderie, sérigraphie, transfert ;
- guide de tailles ;
- stock par variante ;
- description orientée usage ;
- produits similaires ;
- accessoires ou compléments.

### Comparateur

Le client peut comparer trois ou quatre produits : prix, grammage, matière, tailles, couleurs, certifications, délai et marquage.

### Personnalisation

Le produit doit passer au configurateur avec la variante choisie. Le prix se met à jour selon quantité, emplacements, dimensions, technique et délai.

## Prix affiché

Plusieurs méthodes :

- prix du textile seul ;
- prix personnalisé « à partir de » ;
- estimation instantanée ;
- devis pour configuration complexe.

Pour éviter la confusion, la fiche doit préciser ce qui est inclus. Le prix final doit être disponible dès que les informations nécessaires sont connues.

## Recherche et filtres

### Recherche

Doit comprendre références, noms, synonymes, marques, usages et couleurs. Une recherche « polo chantier » doit remonter des polos adaptés au travail, pas seulement les mots exacts.

### Filtres prioritaires

- catégorie ;
- prix ;
- grammage ;
- matière ;
- marque ;
- taille ;
- couleur ;
- genre ;
- certification ;
- délai ;
- disponibilité ;
- technique ;
- secteur.

### Performance

Les filtres ne doivent pas exécuter des requêtes lourdes sur les métadonnées WordPress à chaque clic. Pour plusieurs centaines ou milliers de produits, prévoir indexation, cache et éventuellement un moteur de recherche dédié.

## SEO

### Architecture

- URL courte ;
- catégorie indexable ;
- filtres non indexables par défaut ;
- pages éditoriales sectorielles ;
- contenu unique ;
- données structurées produit ;
- canonical ;
- gestion des produits indisponibles ;
- maillage interne.

### Risque de duplication

Les descriptions fournisseurs identiques à des centaines de revendeurs sont faibles en différenciation. Teeshoop doit enrichir les fiches : usage, conseil, tailles, marquage, comparaison, délai et questions fréquentes.

### Pages sectorielles

Une page « vêtements personnalisés pour restaurant » peut agréger t-shirts, polos, tabliers et casquettes. Elle n'est pas une copie de catégorie ; elle répond à un besoin.

## Catalogue et conseil humain

Chaque fiche et catégorie doit proposer :

- chat ou demande de conseil ;
- appel ;
- partage du panier avec un commercial ;
- demande d'échantillon ou de validation ;
- sauvegarde du projet.

Le conseiller voit le parcours et les produits consultés avec l'accord et les règles appropriées.

## Packs

Les packs sont des configurations commerciales dynamiques, pas des produits figés. Exemple restaurant : deux t-shirts par salarié, casquette, tablier, marquage cœur et dos. Le client modifie l'effectif et les options.

## Modèle de données

### products

id, supplier, supplier_ref, brand, title, slug, category, description, status, lead_time, technique_rules.

### variants

product_id, color_id, size_id, sku, cost, stock, image, barcode, updated_at.

### attributes

name, normalized_value, supplier_value, unit, display_order.

### supplier_sync

source, run_id, started_at, completed_at, counts, errors, rollback_reference.

### content_overrides

field, value, author, reason, locked, last_reviewed.

## Administration

- file de produits à valider ;
- erreurs de mapping ;
- changements de prix ;
- ruptures ;
- produits sans image ;
- produits sans taille ;
- doublons ;
- compatibilité de technique à confirmer ;
- aperçu avant publication ;
- rollback d'import.

## KPI

- produits publiés ;
- variantes actives ;
- taux de données complètes ;
- recherche sans résultat ;
- utilisation des filtres ;
- conversion par catégorie ;
- abandon sur fiche ;
- produits consultés avant achat ;
- délai de synchronisation ;
- erreurs de stock ;
- marge par référence ;
- taux de retour ou SAV par produit.

## Critères d'acceptation

- import de plusieurs centaines de produits sans blocage ;
- filtres en moins d'une seconde sur les pages courantes ;
- stock et prix datés ;
- aucune modification fournisseur n'écrase un contenu Teeshoop verrouillé ;
- chaque variante a un SKU unique ;
- le client comprend le prix et la personnalisation ;
- le catalogue reste utilisable sur mobile ;
- les produits indisponibles ont une alternative ;
- l'administration peut annuler une synchronisation problématique.

## Déploiement

### Phase 1

Importer le catalogue principal, normaliser catégories, tailles, couleurs et prix, publier plusieurs centaines de références avec filtres essentiels.

### Phase 2

Connecter les API Imbretex et Falk & Ross, automatiser le stock, enrichir les fiches, ajouter le comparateur et les pages sectorielles.

### Phase 3

Mid Ocean, objets publicitaires, recommandation intelligente, recherche avancée, personnalisation et données de performance.

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
