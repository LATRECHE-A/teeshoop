---
title: "3. CRM et espace commercial"
subtitle: "Gestion des 150 000 entreprises, pipeline, activités, permissions, intégrations et pilotage"
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

# 3. CRM et espace commercial

**Gestion des 150 000 entreprises, pipeline, activités, permissions, intégrations et pilotage**

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

Le CRM doit être conçu comme le système de travail quotidien des prospectrices, commerciaux et responsables. Il ne doit pas être une liste de contacts ajoutée à WordPress. Il doit relier entreprise, contacts, appels, opportunités, devis, paiements, BAT, commandes, réassorts, commissions et SAV.

La base de 150 000 entreprises représente un potentiel important mais aussi un risque de désordre. Sans attribution, dédoublonnage, liste d'opposition, statut de contact et prochaine action, elle produira des appels répétés, des prospects irrités et des données inutilisables.

## Objets principaux

### Entreprise

- raison sociale ;
- nom commercial ;
- SIREN ou SIRET si disponible ;
- secteur ;
- taille estimée ;
- adresse ;
- zone ;
- site ;
- téléphone principal ;
- e-mail générique ;
- source ;
- propriétaire ;
- score ;
- statut de prospection ;
- droit d'opposition ;
- date de dernier contact.

### Contact

- prénom, nom ;
- fonction ;
- téléphone ;
- e-mail ;
- préférence de canal ;
- décisionnaire ou prescripteur ;
- consentement ou opposition ;
- historique.

La base actuelle ne contenant pas toujours le nom du dirigeant ou l'adresse, l'enrichissement doit être progressif et tracé.

### Opportunité

- besoin ;
- catégorie ;
- quantité estimée ;
- valeur ;
- échéance ;
- probabilité ;
- concurrent ;
- commercial ;
- prochaine action ;
- motif de perte.

### Activité

- appel ;
- e-mail ;
- rendez-vous ;
- note ;
- tâche ;
- message ;
- devis ;
- BAT ;
- réclamation.

## Pipeline recommandé

1. à contacter ;
2. tentative sans réponse ;
3. conversation obtenue ;
4. qualifié sans projet immédiat ;
5. besoin identifié ;
6. rendez-vous ou informations attendues ;
7. devis en préparation ;
8. devis envoyé ;
9. négociation ;
10. paiement attendu ;
11. gagné ;
12. perdu ;
13. à réactiver ;
14. opposition ou ne pas contacter.

Les statuts doivent avoir des critères. « Intéressé » n'est pas un statut suffisant si aucune prochaine action n'est planifiée.

## Rôles

### Prospectrice Madagascar

- accès aux entreprises qui lui sont attribuées ;
- click-to-call ;
- script ;
- dispositions d'appel ;
- création d'opportunité ;
- rendez-vous ;
- notes ;
- pas d'accès aux coûts, marges, fournisseurs ou paiements sensibles.

### Commercial France

- opportunités attribuées ;
- devis ;
- prix conseillé et plancher ;
- commission ;
- BAT ;
- suivi client ;
- SAV de son portefeuille ;
- accès limité aux données nécessaires.

### Direction

- tous les dossiers ;
- règles de marge ;
- autorisations ;
- attribution ;
- tableaux de bord ;
- export ;
- audit.

### Production

- commandes payées et BAT validés ;
- fiche de fabrication ;
- contrôles ;
- pas d'accès aux notes commerciales inutiles.

### Développeur et support

Accès technique séparé, journalisé et limité aux environnements nécessaires.

## Import de la base

### Préparation

- normaliser les téléphones ;
- valider les domaines e-mail ;
- créer une clé de dédoublonnage ;
- identifier la source ;
- horodater l'import ;
- marquer les données manquantes ;
- séparer e-mails personnels et génériques ;
- appliquer une liste repoussoir.

### Dédoublonnage

Priorité : SIREN/SIRET, domaine, téléphone, raison sociale normalisée et adresse. Les doublons probables doivent être fusionnés avec conservation de l'historique.

### Attribution

L'attribution peut se faire par secteur, zone, lot de données ou campagne. Une entreprise ne doit pas être appelée simultanément par plusieurs personnes.

## Téléphonie Ringover

Fonctions attendues :

- click-to-call ;
- remontée de fiche ;
- journal automatique ;
- durée ;
- résultat ;
- enregistrement selon politique et information ;
- création de tâche ;
- statistiques par agent ;
- webhook de fin d'appel.

Les appels ne doivent pas être évalués uniquement sur la durée. Les dispositions obligatoires peuvent être : non attribué, absent, barrage, mauvais numéro, rappel, pas de besoin, devis demandé, rendez-vous, opposition.

## E-mail et Brevo

Le CRM doit synchroniser :

- contacts et listes ;
- segments ;
- désinscriptions ;
- bounces ;
- campagnes ;
- événements transactionnels ;
- ouvertures et clics comme signaux, pas comme certitudes.

Une opposition reçue par n'importe quel canal doit alimenter la liste repoussoir centrale.

## Gestion des tâches

Chaque opportunité ouverte doit avoir :

- un propriétaire ;
- une prochaine action ;
- une date ;
- une priorité ;
- un résultat attendu.

Le tableau quotidien affiche les rappels, devis à relancer, BAT en attente, paiements échoués et clients à réactiver.

## Espace commercial

### Accueil

- objectifs ;
- commission prévisionnelle ;
- activités du jour ;
- opportunités chaudes ;
- devis en attente ;
- alertes ;
- commandes du portefeuille.

### Fiche entreprise

- résumé ;
- contacts ;
- historique ;
- besoins ;
- opportunités ;
- devis ;
- commandes ;
- BAT ;
- SAV ;
- fichiers ;
- consentements et oppositions.

### Devis

- recherche produit ;
- variantes ;
- marquages ;
- prix ;
- marge ;
- commission ;
- remise ;
- validation ;
- envoi et suivi.

### Commission

- en attente ;
- acquise ;
- payée ;
- reprise ;
- détail par commande ;
- explication du calcul.

## Scoring

Le score doit prioriser, non décider seul. Variables possibles :

- secteur ;
- taille ;
- présence d'équipe ;
- événement ;
- date de renouvellement ;
- engagement e-mail ;
- historique ;
- panier potentiel ;
- proximité ;
- récurrence.

Le score doit être compréhensible et modifiable. Éviter un modèle IA opaque au lancement.

## Automatisations

- création d'une tâche après appel ;
- affectation d'un rendez-vous ;
- relance devis ;
- alerte d'opportunité sans action ;
- rappel de réassort ;
- synchronisation des paiements ;
- notification de BAT ;
- création d'une commission ;
- mise à jour des segments ;
- suppression ou opposition ;
- rapports quotidiens.

## Gouvernance RGPD et prospection

La prospection auprès de professionnels doit rester pertinente par rapport à leur activité et permettre une opposition simple. Le CRM doit conserver la preuve de l'information, l'origine de la donnée, la date, la finalité et la demande d'opposition. La liste repoussoir ne doit pas être supprimée lors d'un nettoyage, sinon l'entreprise risque de recontacter une personne opposée.

Les règles de prospection téléphonique évoluant, la conformité doit faire l'objet d'une revue juridique avant le lancement et à chaque changement réglementaire.

## Architecture des données

Entités : users, organizations, contacts, leads, opportunities, activities, tasks, quotes, quote_versions, orders, artworks, proofs, payments, commissions, support_cases, consent_records, suppression_list, campaigns et audit_logs.

Les liens doivent permettre une vue à 360 degrés sans dupliquer les données de WooCommerce ou Qonto. Le CRM conserve les identifiants externes et la source de vérité de chaque champ.

## KPI

### Prospectrices

- tentatives ;
- décroché ;
- conversations utiles ;
- contacts enrichis ;
- opportunités ;
- rendez-vous ;
- opposition ;
- coût par opportunité.

### Commerciaux

- opportunités traitées ;
- devis ;
- délai de réponse ;
- taux de conversion ;
- CA HT ;
- marge ;
- commission ;
- taux de remise ;
- réassort ;
- motifs de perte.

### Direction

- pipeline pondéré ;
- prévision mensuelle ;
- concentration client ;
- marge par source ;
- acquisition contre réachat ;
- dossiers sans action ;
- qualité de la base.

## Critères d'acceptation

- aucune entreprise ne peut être attribuée en double sans avertissement ;
- chaque appel crée ou complète une activité ;
- chaque opportunité a un propriétaire et une prochaine action ;
- les oppositions sont globales ;
- les commerciaux ne voient pas les coûts sensibles non autorisés ;
- la commission correspond à la formule versionnée ;
- le CRM et WooCommerce partagent les mêmes clients par identifiants ;
- les imports massifs sont réversibles ;
- toutes les modifications sensibles sont auditées.

## Déploiement

### MVP

Import, fiche entreprise, appel, disposition, tâche, opportunité, devis, suivi et tableau de bord simple.

### V2

Ringover, Brevo, Qonto, commissions, BAT, réassort et scoring.

### V3

Prévisions, automatisations avancées, grands comptes, multi-sites et analyse de performance.

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
