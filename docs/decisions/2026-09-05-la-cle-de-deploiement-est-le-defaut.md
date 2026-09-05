# La clé de déploiement devient le défaut, et une sonde l'affirme avant tout envoi

**5 septembre 2026.** Décision prise seul, la nuit, sans possibilité de demander.
Elle touche le chemin qui écrit sur la boutique de production.

---

## Ce qui a été mesuré

`scripts/deployer.sh` prenait `HOTE="${TEESHOOP_SSH_HOTE:-teeshoop}"`. Dans le
`~/.ssh/config` de cette machine il y a deux entrées vers le même compte o2switch :

| Alias | Fichier de clé | Ce qu'elle ouvre |
|---|---|---|
| `teeshoop` | `~/.ssh/teeshoop_o2switch` | un shell complet sur le compte |
| `teeshoop-deploy` | `~/.config/teeshoop/deploy_o2switch` | `~/deploiement.sh`, et rien d'autre |

Le défaut était donc la première. Mesuré ce soir contre le vrai serveur :

```
$ ./scripts/deployer.sh --sonde-cle teeshoop
verdict : ouverte
sortie  : 0
  | dawe4500

$ ./scripts/deployer.sh --sonde-cle teeshoop-deploy
verdict : restreinte
sortie  : 2
  | deploiement: verbe inconnu « whoami » (attendus : etat, verifier, installer, retour, sauvegarder, verdict, versions)
```

Tout le durcissement de `scripts/deploiement.sh` (la commande forcée, l'aiguilleur
rsync, la liste blanche d'options courtes écrite après une relecture adverse, les
huit verbes, les deux répertoires de dépôt) est construit autour de la seconde clé
et ne s'applique pas à la première. Or l'étape d'envoi de `deployer.sh` est un
`rsync -az --delete`, et le compte porte 15 commandes réelles et 2 866 fichiers
déposés par des clients.

La phrase de `docs/DEPLOIEMENT.md` § 2, « ce n'est pas une promesse, c'est une
propriété », était donc vraie du chemin décrit et fausse du chemin qui tournait.

---

## Ce qui a été décidé

**1. Le défaut devient `teeshoop-deploy`.** Le chemin sûr doit être celui qu'on
obtient sans rien taper, et le chemin dangereux celui qu'il faut demander
explicitement. C'était exactement l'inverse. `TEESHOOP_SSH_HOTE` reste la porte de
sortie, pour la machine qui nommerait ses alias autrement.

Ce n'est pas une correction cosmétique : `.github/workflows/deploiement.yml` appelle
`./scripts/deployer.sh` sans variable d'environnement, donc changer le défaut est
aussi ce qui corrige le chemin automatique, sans toucher au fichier de travaux.

**2. Une sonde affirme la propriété au lieu de la supposer.** Un défaut se change
par mégarde, une variable d'environnement se pose de travers, et un `~/.ssh/config`
n'est pas le même sur deux machines. La garantie doit être vérifiée à l'exécution,
là où elle compte, et non déduite d'une ligne de configuration.

Elle demande `whoami` à l'alias employé. Sous `command=`, sshd ignore la commande
du client et lance le script forcé à sa place : la demande ressort en « verbe
inconnu », sortie 2. Sans commande forcée, elle rend le nom du compte, sortie 0.
Deux signatures doivent concorder pour conclure « restreinte » (le code **et** la
phrase), et « ouverte » n'est jamais déduit : il est démontré par une commande
arbitraire qui a réellement tourné.

**Pourquoi `whoami` et pas un verbe inventé.** Un verbe inventé échoue des deux
côtés, « verbe inconnu » ici et « command not found » là, et il faudrait déduire la
différence d'un code de sortie. `whoami` rend les deux cas maximalement distincts,
et il ne lit rien, n'écrit rien, ne change rien sur le serveur.

**3. Trois verdicts et pas deux.** `restreinte`, `ouverte`, `inconnue`. Le troisième
est le cas où la sonde n'a pas pu regarder : réseau, authentification, alias absent.
CLAUDE.md § 3 : « on n'a pas pu regarder » n'est pas « la clé est restreinte ». La
production refuse sur `inconnue` exactement comme sur `ouverte`.

**4. La production refuse, la préproduction avertit.** Ce n'est pas de la mollesse
et c'est le point le plus discutable de cette décision, donc il est écrit ici. Ce
que ce garde-fou protège est le compte qui porte les commandes réelles et les
fichiers des clients ; la préproduction n'a ni les unes ni les autres, ses données
sont anonymisées, et son rôle est d'être cassée. Un refus dur sur l'environnement de
répétition aurait un effet prévisible : poser `TEESHOOP_SSH_HOTE` au hasard pour
pouvoir travailler. Un garde-fou qu'on contourne pour travailler finit par être
retiré, ce qui est déjà le raisonnement écrit dans `scripts/deploiement.sh` à propos
de `--stats`. L'avertissement, lui, dit quoi faire et pourquoi.

**5. La version de node est comparée à `.nvmrc`, et son absence refuse.** Les deux
portes qui décident si la production reçoit un fichier sont des programmes node, et
l'exécutant auto-hébergé ne pose délibérément pas `setup-node` : rien ne fixait leur
version d'exécution. La majeure seule est comparée, par le même raisonnement que
`pin-verify.mjs` tient déjà pour PHP.

---

## Ce qui a été écarté

**Refuser aussi la préproduction.** Voir le point 4. Écarté pour la raison écrite
là, pas par confort.

**Lire `~/.ssh/config` et l'`authorized_keys` du serveur pour conclure.** Deux
implémentations d'une même règle, dont l'une lit un fichier que le serveur pourrait
ne plus honorer. La sonde regarde le comportement, qui est la seule chose qui
compte.

**Vérifier aussi `restrict`** (agent, redirection de port, pseudo-terminal). Il
faudrait tenter d'ouvrir une redirection, ce qui est bruyant et peut se lire comme
une tentative d'abus dans les journaux de l'hébergeur. `command=` est la moitié qui
compte pour un `rsync` et pour un shell, et la limite est écrite dans le code.

**Retirer l'alias `teeshoop` du `~/.ssh/config`.** Il sert au travail à la main
(lire un journal, annuler une livraison, § 7 a et § 8 de `docs/DEPLOIEMENT.md`), et
supprimer un outil légitime pour empêcher un mauvais usage automatique aurait déplacé
le problème sur l'opérateur.

---

## Ce que ça coûte, mesuré

De **616 à 927 ms** par déploiement, trois passages contre le vrai serveur. Une
ligne `REFUS verbe inconnu « whoami »` par déploiement dans
`~/teeshoop-deploiements/journal.log`, ce qui est signalé dans le mode d'emploi de
panne (§ 8) pour que personne ne la lise comme un incident.

---

## Une note d'accès, mesurée le même soir

La séance était partie du constat que le port 22 d'o2switch était filtré depuis
cette machine, l'adresse publique ayant changé pour `176.191.78.140`. **C'est faux
au 05/09/2026 :** le port 22 d'`ascaphus.o2switch.net` répond depuis cette adresse,
et les deux clés ont été essayées contre le vrai serveur. `pin-verify` répond
« prod est bien en WordPress 7.1, WooCommerce 11.0.1, PHP 8.1.34 » avec la clé
restreinte, et le portail de mise en ligne refuse la production avec 16 raisons,
comme il doit.
