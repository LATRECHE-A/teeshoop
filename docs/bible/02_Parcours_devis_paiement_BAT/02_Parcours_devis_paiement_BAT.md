---
title: "2. Parcours devis, paiement et BAT"
subtitle: "Processus client et interne, statuts, validations, automatisations et cas d'exception"
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

# 2. Parcours devis, paiement et BAT

**Processus client et interne, statuts, validations, automatisations et cas d'exception**

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

Le parcours doit permettre d'encaisser rapidement tout en protégeant Teeshoop contre les erreurs et les demandes infinies. Le principe retenu est : le client choisit ou accepte un devis, paie, transmet ses fichiers, valide le BAT, puis la production démarre. Pour les commandes complexes ou importantes, un acompte peut être utilisé, mais le paiement intégral reste la règle des commandes simples.

Le BAT est le verrou opérationnel. Il doit prouver ce qui a été validé : produit, couleur, tailles, quantité, technique, emplacement, dimensions, visuel, texte, délai et adresse. Un simple « c'est bon » dans un message non rattaché au dossier n'est pas suffisant.

## Types de parcours

### Achat autonome

Le client configure un produit, choisit les variantes, importe son visuel, obtient un prix et paie. La commande entre dans le statut « fichiers à contrôler ». Un opérateur vérifie la faisabilité, crée ou confirme le BAT et sollicite la validation.

### Devis commercial

Le commercial recueille le besoin, construit le devis dans son espace, applique éventuellement une remise autorisée, envoie le lien de paiement et suit le dossier. Le client peut payer en ligne sans intervention administrative.

### Grand compte

Le dossier peut inclure un rendez-vous, plusieurs produits, plusieurs sites, un acompte, un échéancier, des adresses multiples et un BAT par ligne. Il nécessite une validation direction et un chef de projet désigné.

### Réassort

Le client reprend une commande validée, modifie les tailles et quantités et paie. Si le produit, le visuel, la technique et les dimensions ne changent pas, un BAT simplifié ou une confirmation de réassort suffit.

## Cycle de statuts recommandé

1. brouillon ;
2. devis en préparation ;
3. devis envoyé ;
4. devis consulté ;
5. relance planifiée ;
6. accepté - paiement attendu ;
7. paiement partiel ;
8. payé ;
9. fichiers attendus ;
10. fichiers à contrôler ;
11. correction graphique ;
12. BAT en préparation ;
13. BAT envoyé ;
14. modifications demandées ;
15. BAT validé ;
16. approvisionnement ;
17. prêt pour production ;
18. en production ;
19. contrôle qualité ;
20. prêt à expédier ;
21. expédié ou remis ;
22. livré ;
23. clôturé ;
24. réclamation ;
25. annulé ou remboursé.

Les statuts doivent être séparés des tâches. Une commande « BAT envoyé » peut avoir une tâche « relancer demain à 10 h ».

## Devis

### Informations obligatoires

- entreprise et contact ;
- adresse de facturation ;
- produits, références, couleurs et tailles ;
- quantités ;
- techniques et emplacements ;
- prix HT, TVA et TTC ;
- livraison ;
- délai indicatif ;
- validité ;
- conditions de paiement ;
- nombre de corrections incluses ;
- réserve liée au stock fournisseur ;
- lien de paiement ;
- commercial et commission estimée.

### Versionnage

Chaque envoi crée une version. Une nouvelle quantité, une modification de textile ou une remise ne doit pas écraser l'ancienne version. Le client doit accepter la version exacte qu'il paie.

### Relances

- J+1 après consultation sans action ;
- J+3 si devis non consulté ;
- J+5 avec proposition d'aide ;
- J+10 clôture douce ou nouvelle date ;
- relance manuelle prioritaire pour gros panier.

La cadence doit pouvoir être interrompue lorsque le prospect s'oppose, refuse ou demande une date précise.

## Paiement

### Règles

- commande simple : 100 % avant production ;
- commande importante : acompte possible, solde avant expédition ou avant production selon le risque ;
- client récurrent fiable : conditions dérogatoires validées ;
- paiement par carte, Apple Pay, Google Pay ou Revolut Pay selon l'intégration ;
- virement accepté pour les devis, avec rapprochement ;
- commission commerciale calculée uniquement sur l'encaissement réel.

### Paiement avant BAT

Le paiement avant BAT est possible parce que le client achète une prestation personnalisée dont les détails sont finalisés ensuite. Le parcours doit toutefois préciser :

- ce qui est inclus ;
- les limites de modification ;
- le sort des frais déjà engagés ;
- le moment où la production devient irréversible ;
- les conditions d'annulation.

### Annulation

Politique recommandée :

- avant achat spécifique et avant travail graphique significatif : remboursement possible, diminué des frais irréversibles clairement annoncés ;
- après commande fournisseur ou préparation spécifique : remboursement du solde non engagé ;
- après validation du BAT et lancement : pas d'annulation automatique ; traitement au cas par cas ;
- erreur de Teeshoop : remplacement, avoir ou remboursement selon le dossier.

## Collecte des fichiers

### Formats acceptés

- vectoriels : PDF, SVG, AI, EPS selon le moteur ;
- images : PNG transparent ou image haute résolution ;
- documents : PDF de référence ;
- liens : uniquement comme complément, jamais comme fichier de production sans copie interne.

### Contrôles automatiques

- résolution ;
- transparence ;
- dimensions ;
- profil colorimétrique ;
- présence de polices ;
- nombre de couleurs pour certaines techniques ;
- fond indésirable ;
- lisibilité des petits textes ;
- cohérence avec le produit.

### Assistance gratuite et payante

- import et placement du logo : inclus ;
- contrôle technique : inclus ;
- nettoyage automatique et vectorisation par l'outil : inclus en autonomie ;
- première maquette et deux séries de corrections : incluses ;
- création humaine complexe, multiples pistes ou identité complète : prestation complémentaire ou offre éligible.

## BAT

### Contenu obligatoire

- numéro de commande ;
- version et date ;
- produit et référence ;
- couleur ;
- tailles et quantités ;
- vue avant, dos et autres emplacements ;
- dimension du marquage ;
- technique ;
- fichier source ou empreinte du fichier ;
- remarques ;
- avertissement sur les différences d'écran ;
- bouton approuver ou demander des modifications.

### Validation

L'acceptation doit enregistrer : utilisateur, date, heure, adresse IP, version du BAT, texte d'acceptation et moyen de validation. Une copie PDF doit être archivée.

### Corrections

Chaque demande doit être structurée par emplacement et commentaire. Le système compte les cycles. Au-delà du nombre inclus, une validation de supplément peut être proposée avant de poursuivre.

### Réassort

Le BAT source est conservé. Le client choisit « reprendre à l'identique » et confirme les nouvelles tailles. Toute modification de couleur, dimensions, textile ou visuel crée une nouvelle version.

## Automatisations

### Événements

- devis envoyé ;
- devis consulté ;
- paiement réussi ou échoué ;
- fichier déposé ;
- BAT envoyé ;
- modification demandée ;
- BAT validé ;
- délai dépassé ;
- commande expédiée ;
- réclamation ouverte.

### Actions

- e-mail transactionnel ;
- tâche CRM ;
- notification au commercial ;
- création d'un dossier de fichiers ;
- mise à jour Qonto ;
- blocage ou libération de la production ;
- calcul de commission ;
- alerte de retard.

Les webhooks doivent être idempotents : un même événement reçu deux fois ne doit pas doubler une facture, une commande ou une commission.

## Écrans

### Client

- résumé du devis ;
- paiement ;
- dépôt de fichiers ;
- messagerie liée au dossier ;
- BAT avec zoom ;
- validation ;
- suivi ;
- réassort ;
- SAV.

### Commercial

- constructeur de devis ;
- marge et commission ;
- statut du paiement ;
- fichiers ;
- BAT ;
- prochaine action ;
- historique ;
- alerte de blocage.

### Production

- uniquement les commandes payées et validées ;
- fiche de fabrication ;
- fichiers verrouillés ;
- quantités ;
- contrôles ;
- signalement d'anomalie.

## Données et intégrations

### WooCommerce

WooCommerce peut porter le panier, la commande, le paiement, les lignes produit et certains statuts. Les statuts métiers Teeshoop doivent être gérés par un module dédié afin de ne pas forcer toute la logique dans les statuts standards.

### Qonto

L'intégration doit créer ou synchroniser le client, le devis et la facture, puis récupérer le statut pertinent. Qonto ne doit pas devenir la source unique de la commande : Teeshoop conserve le dossier opérationnel.

### Paiement

Le backend crée l'ordre de paiement, reçoit les webhooks, vérifie le montant, la devise et l'identifiant de commande, puis confirme l'encaissement. Le retour navigateur du client ne suffit pas à prouver le paiement.

## Cas d'exception

- paiement reçu mais rupture produit ;
- BAT impossible techniquement ;
- client silencieux après paiement ;
- changement de quantité après paiement ;
- plusieurs BAT dans une commande ;
- commande urgente sans fichier exploitable ;
- différence de couleur fournisseur ;
- acompte supérieur ou inférieur ;
- paiement en double ;
- remboursement partiel ;
- commande multi-adresses.

Chaque cas doit avoir une procédure, un responsable et un statut, pas un simple échange WhatsApp.

## KPI

- délai moyen devis-envoi ;
- délai devis-paiement ;
- taux de paiement ;
- taux de devis abandonnés ;
- délai paiement-fichier ;
- délai fichier-BAT ;
- nombre moyen de corrections ;
- taux de BAT validés au premier envoi ;
- commandes bloquées par le client ;
- remboursements avant production ;
- erreurs malgré BAT validé.

## Critères d'acceptation du module

- une commande non payée ne peut pas passer en production ;
- un BAT non validé bloque la fabrication ;
- chaque version est archivée ;
- le client peut payer en moins de trois étapes ;
- le commercial voit le statut en temps réel ;
- chaque événement important crée une trace ;
- les doublons de webhooks ne créent pas de doublons métiers ;
- un réassort identique peut être réalisé sans recréer le dossier graphique.

## Plan de déploiement

### Phase 1

Devis PDF, lien de paiement, dépôt de fichiers, BAT PDF, validation et statuts manuels assistés.

### Phase 2

Automatisation des relances, synchronisation Qonto, suivi client et réassort.

### Phase 3

Prévisualisation avancée, contrôles automatiques des fichiers, multi-BAT, grands comptes et signatures renforcées.

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
