---
title: "6. Cahier des charges complet des développeurs"
subtitle: "Architecture, modules, données, API, sécurité, tests, critères d'acceptation et roadmap"
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

# 6. Cahier des charges complet des développeurs

**Architecture, modules, données, API, sécurité, tests, critères d'acceptation et roadmap**

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

## Objet du projet

Construire une plateforme B2B intégrée permettant à Teeshoop de présenter un grand catalogue, personnaliser des produits, calculer les prix, gérer les prospects, devis, paiements, BAT, fournisseurs, production, livraison, commissions et SAV.

Le système doit être exploitable à faible volume dès le premier mois et évoluer vers 50 000 EUR TTC mensuels sans refonte totale.

## Principes d'architecture

- WordPress pour le contenu et l'administration du site ;
- WooCommerce pour les produits, panier, commandes et checkout ;
- plugin Teeshoop sur mesure pour les règles métier ;
- services séparés pour les tâches lourdes, imports, fichiers et automatisations ;
- API internes versionnées ;
- webhooks sécurisés ;
- base de données structurée ;
- cache ;
- journal d'audit ;
- environnement de développement, préproduction et production.

### Choix recommandé au lancement

Un **monolithe modulaire** est préférable à une constellation de microservices. Deux développeurs doivent pouvoir comprendre et déployer l'ensemble. Les limites entre modules sont préparées pour une extraction future, mais la complexité distribuée est évitée.

## Utilisateurs et rôles

- visiteur ;
- client ;
- contact grand compte ;
- prospectrice ;
- commercial ;
- graphiste ou opérateur BAT ;
- acheteur ;
- production ;
- contrôleur qualité ;
- SAV ;
- comptabilité ;
- manager ;
- administrateur ;
- développeur support.

Chaque permission doit être explicite : lecture, création, modification, validation, export et suppression.

## Modules

### 1. Identité et comptes

- inscription B2B ;
- entreprise et contacts ;
- vérification e-mail ;
- rôles multi-utilisateurs ;
- adresses ;
- historique ;
- MFA pour rôles sensibles ;
- gestion des sessions.

### 2. Catalogue

- fournisseurs ;
- produits ;
- variantes ;
- attributs ;
- stock ;
- prix d'achat ;
- compatibilités ;
- synchronisations ;
- filtres ;
- recherche ;
- SEO ;
- comparateur.

### 3. Personnalisation

- import fichier ;
- positionnement ;
- dimensions ;
- emplacements ;
- texte ;
- aperçu 2D ou 3D ;
- règles techniques ;
- sauvegarde projet ;
- export BAT ;
- versionnage.

### 4. Pricing

- composants de coût ;
- règles ;
- volume ;
- urgence ;
- livraison ;
- prix conseillé ;
- plancher ;
- remise ;
- commission ;
- approbation.

### 5. Devis, paiement et BAT

- devis versionné ;
- acceptation ;
- lien paiement ;
- acompte ;
- webhooks ;
- fichiers ;
- BAT ;
- corrections ;
- validation ;
- annulation.

### 6. CRM

- entreprises ;
- contacts ;
- activités ;
- opportunités ;
- tâches ;
- pipeline ;
- Ringover ;
- Brevo ;
- scoring ;
- opposition ;
- reporting.

### 7. Achats

- fournisseurs ;
- choix de source ;
- commande ;
- statut ;
- réception ;
- écart ;
- coût réel ;
- facture fournisseur.

### 8. Production

- ordre de fabrication ;
- lots ;
- paramètres ;
- affectation ;
- capacité ;
- contrôle ;
- incident ;
- emballage.

### 9. Livraison

- options ;
- tarifs ;
- étiquettes ;
- suivi ;
- remise locale ;
- notification ;
- preuve.

### 10. SAV

- ticket ;
- motif ;
- photos ;
- cause ;
- décision ;
- remplacement ;
- remboursement ;
- avoir ;
- coût ;
- clôture.

### 11. Commissions

- règles ;
- calcul ;
- acquisition ;
- validation ;
- reprise ;
- paiement ;
- relevé.

### 12. Reporting

- ventes ;
- marge ;
- acquisition ;
- devis ;
- production ;
- qualité ;
- fournisseurs ;
- commission ;
- trésorerie opérationnelle.

## Modèle de données

Tables ou agrégats principaux :

- users, roles, permissions ;
- organizations, contacts, addresses ;
- suppliers, supplier_products, sync_runs ;
- products, variants, attributes, stock_snapshots ;
- artwork_files, artwork_versions, personalization_projects ;
- pricing_rules, pricing_calculations, approvals ;
- leads, opportunities, activities, tasks, campaigns ;
- quotes, quote_versions, quote_lines ;
- orders, order_lines, payments, refunds ;
- proofs, proof_versions, proof_approvals ;
- purchase_orders, receipts, discrepancies ;
- production_jobs, batches, quality_checks ;
- shipments, tracking_events ;
- support_cases, remedies ;
- commission_rules, commissions, commission_payments ;
- consent_records, suppression_list ;
- audit_logs, integration_events, failed_jobs.

Les tables WordPress/WooCommerce peuvent héberger certaines entités, mais les données transactionnelles complexes ne doivent pas être dispersées dans des champs méta sans index.

## API internes

Préfixe : `/wp-json/teeshoop/v1` ou service dédié `/api/v1`.

### Exemples

- `GET /catalog/products` ;
- `POST /pricing/calculate` ;
- `POST /quotes` ;
- `POST /quotes/{id}/send` ;
- `POST /payments/webhooks/revolut` ;
- `POST /proofs/{id}/approve` ;
- `POST /crm/activities` ;
- `POST /purchase-orders` ;
- `POST /production/jobs/{id}/complete` ;
- `POST /support/cases` ;
- `GET /reports/sales`.

Chaque endpoint doit définir schéma, permissions, erreurs, idempotence, pagination et journalisation.

## Événements métier

- ProductSynced ;
- QuoteSent ;
- QuoteAccepted ;
- PaymentReceived ;
- ArtworkUploaded ;
- ProofApproved ;
- SupplierOrderPlaced ;
- MaterialsReceived ;
- ProductionStarted ;
- QualityPassed ;
- ShipmentCreated ;
- OrderDelivered ;
- SupportCaseOpened ;
- CommissionEarned.

Les intégrations consomment ces événements. Le système garde une boîte d'envoi transactionnelle afin de ne pas perdre un événement si un service externe est indisponible.

## Intégrations

### WooCommerce

Source du panier et de la commande client. Utiliser REST API et webhooks signés. Créer des statuts personnalisés seulement lorsque nécessaire.

### Fournisseurs

Adaptateur par fournisseur. Le domaine métier ne doit pas dépendre des noms de champs Imbretex ou Falk & Ross. Chaque adaptateur convertit les données externes vers le modèle Teeshoop.

### Qonto

Créer et récupérer devis et factures selon les capacités API, conserver les identifiants et écouter les événements. La plateforme doit rester la source des opérations.

### Brevo

Contacts, listes, e-mails transactionnels, campagnes et événements. Synchronisation des oppositions et bounces.

### Ringover

Appels, journaux, disposition et événements. Ne jamais bloquer l'écran du CRM si l'API est indisponible ; stocker et retenter.

### Revolut Pay

Création d'ordre côté serveur, SDK côté client, webhooks pour le cycle de paiement, vérification de signature et idempotence.

### n8n

Utiliser n8n pour orchestrer des processus non critiques ou accélérer le lancement : notifications, exports, rapports et enrichissements. Les règles financières et les états de commande critiques restent dans le code métier.

## Fichiers

- stockage objet privé ;
- URL signées ;
- antivirus ;
- taille maximale ;
- version ;
- empreinte ;
- métadonnées ;
- rétention ;
- sauvegarde ;
- séparation source, aperçu et production.

Les fichiers de production ne doivent pas être exposés publiquement dans la médiathèque WordPress.

## Sécurité

- HTTPS ;
- secrets hors code ;
- moindre privilège ;
- MFA ;
- protection CSRF, XSS et injection ;
- validation serveur ;
- limitation de débit ;
- journal d'audit ;
- rotation des clés ;
- sauvegardes ;
- restauration testée ;
- scan des dépendances ;
- politique de mise à jour WordPress.

## Performance

Objectifs indicatifs :

- page catalogue utile sous 2,5 secondes sur mobile courant ;
- filtres sous 1 seconde après cache ;
- calcul de prix sous 300 ms hors API externe ;
- webhook accusé en moins de 2 secondes puis traité en arrière-plan ;
- import fournisseur par lots ;
- files de tâches ;
- cache objet ;
- CDN pour médias publics ;
- index de base de données.

## Observabilité

- logs structurés ;
- identifiant de corrélation ;
- erreurs ;
- métriques ;
- temps de réponse ;
- file de tâches ;
- alertes ;
- tableau des intégrations ;
- dead-letter queue ;
- rapport de sauvegarde.

## Tests

### Unitaires

Formules de prix, commissions, statuts, permissions, mapping et validations.

### Intégration

WooCommerce, paiement, Qonto, fournisseurs, Brevo, Ringover et fichiers.

### End-to-end

- achat autonome ;
- devis commercial ;
- paiement ;
- BAT ;
- production ;
- expédition ;
- SAV ;
- réassort.

### Charge

Catalogue, recherche, import, webhooks et pics de commandes.

### Sécurité

Rôles, accès horizontal, upload, secrets et endpoints publics.

## Critères d'acceptation transversaux

- aucune commande payée perdue ;
- aucun double traitement de webhook ;
- aucune production sans validation ;
- prix et commission reproductibles par version ;
- historique complet ;
- permissions testées ;
- import réversible ;
- sauvegarde restaurable ;
- erreurs compréhensibles ;
- documentation technique et métier.

## Environnements et livraison

- Git ;
- branches et revue ;
- CI ;
- tests ;
- déploiement automatisé ;
- migrations ;
- données de test anonymisées ;
- préproduction ;
- rollback ;
- release notes.

## Roadmap

### Sprint 0

Architecture, environnements, sécurité, conventions, modèle de données.

### Sprints 1-2

Catalogue, comptes, commandes, pricing minimal.

### Sprints 3-4

Devis, paiement, fichiers, BAT.

### Sprints 5-6

CRM, Ringover, Brevo, commissions.

### Sprints 7-8

Achats, production, qualité, livraison et SAV.

### Sprints 9+

API fournisseurs, personnalisation avancée, recommandation et grands comptes.

## Livrables développeurs

- code source ;
- schémas ;
- documentation API ;
- dictionnaire de données ;
- procédures de déploiement ;
- tests ;
- manuel admin ;
- guide utilisateur ;
- registre des secrets et intégrations ;
- plan de reprise ;
- backlog ;
- liste des limites connues.

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
