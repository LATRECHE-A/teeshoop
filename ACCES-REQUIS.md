# Accès et secrets — la liste complète

> Objectif de ce document : que je ne sois **jamais bloqué** faute d'un accès.
> Il est ordonné par ce qui bloque le plus tôt. Chaque ligne dit *pourquoi* l'accès
> est nécessaire — si la raison ne tient pas, l'accès ne doit pas être donné.
>
> Dernière mise à jour : 12 août 2026 · voir aussi [QUESTIONS-ASSOCIE.md](QUESTIONS-ASSOCIE.md)

---

## État actuel

| Accès | État | Ce qu'il débloque |
|---|---|---|
| Dépôt GitHub `LATRECHE-A/teeshoop` | ✅ en place | Le code, la CI |
| Cloudflare (Worker + R2) | ✅ en place | Le studio, le proxy fournisseur |
| Falk & Ross (API web service) | ✅ en place | Catalogue, stock, prix d'achat |
| `ADMIN_TOKEN` sur le Worker | ✅ posé le 12/08 | La console atelier |
| **SSH o2switch** | ❌ **manquant** | **Tout le travail WordPress** |
| **cPanel o2switch** | ❌ **manquant** | La préproduction, le cron, Redis |
| **Compte admin WordPress** | ❌ manquant | Réglages Woo, pages, extensions |
| **Clés API WooCommerce** | ❌ manquant | Produits, commandes par script |

Les quatre lignes rouges bloquent la fin de R0 et **tout** R1. Le reste du plan
avance sans elles ; l'intégration WordPress, non.

---

## 1. SSH o2switch — le plus important, et de loin

C'est la voie d'accès principale. o2switch est de l'hébergement mutualisé cPanel
avec WP-CLI préinstallé : SSH permet d'installer une extension, écrire du PHP,
toucher la base, faire un dump avant chaque opération risquée. L'API REST de
WordPress ne permet aucune de ces quatre choses.

**Ce qu'il me faut :** l'hôte, l'utilisateur cPanel, et le port (22 en général chez
o2switch, parfois autre chose — à lire sur la fiche du compte).

**Aucun mot de passe ne doit circuler.** J'ai généré une paire de clés dédiée à ce
projet. Voici la clé **publique** — elle est faite pour être partagée :

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAID/XXmPOhi3dyb67sK1mUPM7zQZYf0q797WtIsR0x1ZD teeshoop-deploy-20260812
```

Dans cPanel → **Accès SSH** → *Gérer les clés SSH* → **Importer une clé** : coller
la ligne ci-dessus dans « clé publique », laisser « clé privée » vide, puis
**autoriser** la clé une fois importée (l'import seul ne suffit pas, il y a un
bouton « Autoriser » ensuite).

o2switch filtre aussi par IP : cPanel → **Accès SSH** → autoriser l'adresse IP
depuis laquelle je travaille (5 maximum par compte). Si l'IP change souvent, le
**Terminal web** de cPanel contourne la liste blanche et fait aussi l'affaire.

Une clé séparée par destination, volontairement : celle-ci se révoque sans toucher
à la clé GitHub.

---

## 2. cPanel

Quatre choses ne se font que là :

1. **Créer la préproduction** — *WP Tiger → Préproduction*. On ne développe jamais
   sur la boutique en production, surtout une fois qu'elle encaisse.
2. **Figer la version de PHP** — o2switch prévient que la version par défaut peut
   changer d'elle-même. Une mise à jour de PHP non choisie casse WooCommerce un
   matin sans que personne n'ait rien fait.
3. **Vrai cron serveur** à la place de WP-Cron. WP-Cron ne se déclenche que si
   quelqu'un visite le site : sur une boutique calme, les tâches planifiées
   (synchronisation catalogue, relances) ne partent tout simplement pas.
4. **Redis** pour le cache objet.

Un compte cPanel partagé convient ici, ces opérations sont ponctuelles.

---

## 3. Compte administrateur WordPress dédié

À mon nom, pas le compte partagé de l'associé. Deux raisons concrètes : l'historique
des modifications reste lisible (qui a changé quoi), et l'accès se révoque seul le
jour où il n'a plus lieu d'être.

Rôle **Administrateur**. Utilisateurs → Ajouter.

---

## 4. Clés API WooCommerce (lecture/écriture)

WooCommerce → Réglages → Avancé → **API REST** → Créer une clé.
Permissions : *Lecture/écriture*.

Pour créer les 30–50 produits de R1, poser les prix, relire les commandes de test.
Faisable en SSH aussi, mais c'est bien plus lent.

Les clés sont à transmettre par lien autodestructeur (§8), jamais dans une
conversation.

---

## 5. Une information, pas un accès : Falk & Ross

Deux questions, dont la réponse change ce qu'il faut faire ensuite :

- **Le compte est-il en mode test ou en mode live ?**
- **`FR_CUSTOMER_NR` était-il défini sur le Worker en production avant le 12 août ?**

Pourquoi ça compte : jusqu'au 12 août, `POST /api/fr/order` passait une commande
fournisseur **sans aucune authentification**. Si `FR_CUSTOMER_NR` n'était pas
défini, aucune commande n'a pu partir et l'affaire est close. S'il l'était, il faut
relire l'historique des commandes du compte Falk & Ross.

Vérification, 5 secondes :

```bash
npx wrangler secret list
```

S'il n'y a que `ADMIN_TOKEN`, `FR_WS_USER`, `FR_WS_PASS` : rien n'a pu partir.
*(vérifié le 12/08 — c'est bien le cas, il n'y a pas de `FR_CUSTOMER_NR`)*

---

## 6. GitHub

Fait le 12/08 : dépôt renommé `teeshoop`, privé, distant à jour.

Reste à faire quand on montera le déploiement automatique :

- **Ajouter l'associé** en lecture (Settings → Collaborators).
- **Clé de déploiement** pour les GitHub Actions : je générerai une seconde paire
  dédiée, la partie privée ira dans *Settings → Secrets → Actions* (`O2SWITCH_SSH_KEY`),
  la partie publique dans `~/.ssh/authorized_keys` du compte o2switch. Cette clé-là
  ne sert qu'à `rsync` et ne donne pas de shell interactif.

---

## 7. Plus tard — inutile de les créer maintenant

Ces accès ne servent qu'à partir de R1/R2. Les créer trop tôt, c'est multiplier les
identifiants sur une boutique qui ne vend pas encore.

| Service | Quand | Pour quoi |
|---|---|---|
| Stripe (ou Revolut Business) | R1 | Encaisser la première commande |
| Brevo | R4 | E-mails transactionnels puis marketing |
| Qonto | R4 | Rapprochement bancaire |
| Ringover | R4 | Téléphonie liée au CRM |
| Un CRM du marché | R4 | **À acheter, pas à construire** — voir le plan |

---

## 8. Comment transmettre tout ça

**Ne collez jamais un mot de passe ou une clé dans une conversation** — avec moi ou
avec qui que ce soit. Tout ce qui y est écrit est transmis et conservé, et le
supprimer ensuite ne le retire pas des journaux.

Par ordre de préférence :

1. **Rien à transmettre** — c'est le cas de SSH : vous installez ma clé publique,
   aucun secret ne circule dans aucun sens. C'est pour ça que SSH passe en premier.
2. **Lien à usage unique et autodestructeur** pour ce qui ne peut pas éviter d'être
   transmis (clés Woo, mot de passe cPanel). Le lien s'ouvre une fois puis meurt.
3. **`wrangler secret put` en local** pour tout secret Cloudflare : la valeur est
   saisie au clavier, envoyée à Cloudflare, et n'est écrite nulle part sur le disque
   ni dans l'historique du shell.

Et : **faites tourner toute clé qui a déjà été partagée en clair**, quel que soit le
canal. Une clé qui a transité par un message est une clé publique.

---

## 9. Ce qu'il ne faut **pas** activer

- **Les mots de passe d'application WordPress.** Ils sont désactivés aujourd'hui
  (`/wp-json/` renvoie `"authentication": []`) — très probablement par Wordfence.
  Laissez-les désactivés. Ils n'apportent rien que SSH ne fasse déjà, et ils
  ajoutent un identifiant équivalent à un mot de passe sur une boutique qui va
  encaisser des paiements.
- **Le plugin MCP Adapter**, actif en production alors qu'il n'était pas dans la
  liste des extensions attendues. Il expose `wp-json/mcp` et `wp-abilities/v1`.
  À identifier — *qui l'a installé, et pourquoi* — puis très probablement à
  désactiver.
- **Un second compte administrateur partagé.** Un admin nominatif par personne.

---

## 10. Ce que je peux faire sans rien attendre

Pour situer ce qui est réellement bloqué et ce qui ne l'est pas :

| Travail | Bloqué ? |
|---|---|
| Studio (2D, 3D, AR, DTF, panier) | non |
| Worker Cloudflare, R2, proxy fournisseur | non |
| Tests, CI, garde-fous de bundle | non |
| **Plugin `teeshoop-core` en PHP** | non — développé et testé sur WordPress local |
| Moteur de prix PHP + ses tests | non |
| Pont `postMessage` studio ↔ WooCommerce | non |
| Déployer quoi que ce soit sur teeshoop.com | **oui — SSH** |
| Créer la préproduction | **oui — cPanel** |
| Supprimer les 46 produits de démo | **oui — SSH ou admin WP** |
| Créer les produits de R1 | **oui — clés Woo ou SSH** |

Autrement dit : l'absence d'accès repousse la mise en ligne, pas le développement.
Le plugin peut être écrit, testé et prêt à déployer avant que le premier accès
n'arrive — c'est ce qui est en cours.
