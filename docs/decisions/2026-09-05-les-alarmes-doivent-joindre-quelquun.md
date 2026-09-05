# 5 septembre 2026 : une alarme qui ne joint personne est un journal

Le 28 août 2026, la sauvegarde nocturne de la boutique s'est arrêtée. La veille l'a
détectée correctement, à chacun de ses 719 passages, pendant cinq nuits. Personne n'a
été prévenu.

La cause immédiate a été réparée le 2 septembre (sous `cron`, `PATH=/usr/bin:/bin`, où
`/usr/bin/php` est `php-cgi`, qui refuse l'option `-r`). La cause de fond ne l'était pas :

- **un seul canal**, et il partageait toutes ses pièces avec le reste du système ;
- **une destination que personne n'avait vérifiée**, sur un quatrième domaine, alors que
  les trois boîtes nommées par les réponses aux questions 56 et 61 (`legales@`, `ticket@`,
  `dev@`) n'existent pas sur le compte ;
- **aucun moyen de savoir que la veille elle-même s'était tue.** Tout ce qui part d'une
  machine ne peut annoncer que ce que cette machine a vu. Sa propre mort, jamais.

Ce document dit ce qui a été décidé, ce qui a été mesuré, et ce qui reste à faire par un
humain. Les mesures ont été prises le 5 septembre 2026, en local : le port 22 d'o2switch
est filtré depuis cette machine (l'adresse publique a changé), donc rien n'a pu être
exécuté sur le serveur cette nuit.

---

## 1. La destination se prouve avant qu'on lui écrive

`scripts/destinataire.sh` pose la question au compte cPanel lui-même, avec
`uapi --output=json Email list_pops`. C'est le compte qui répond : une boîte listée
existe, ce n'est pas une présomption.

**Quatre verdicts, et deux ne sont pas des succès.** La règle « distinguer non de je n'ai
pas pu regarder » du brief s'applique ici mot pour mot, parce que c'est exactement la
confusion qui a coûté cinq nuits.

| Sortie | Ce que ça veut dire | Ce que la veille en fait |
|---:|---|---|
| 0 | la boîte est là | le courrier part, et son succès compte |
| 1 | le compte héberge ce domaine, la boîte n'y est pas | **aucun courrier n'est envoyé**, et l'absence devient elle-même un problème dans la liste |
| 2 | je n'ai pas pu regarder (uapi absent, illisible, en échec, plusieurs destinataires) | le courrier part quand même, son succès compte, mais rien n'est prouvé |
| 3 | hors compte : ce domaine n'est pas hébergé ici | idem, et c'est le cas de la ligne de cron actuelle |

**Pourquoi ne pas refuser aussi le verdict 3.** La ligne de cron en production vise
`vibecoding@worklance.fr`, un domaine que ce compte n'héberge pas ; `list_pops` ne peut
rien en dire, ni oui ni non. Refuser d'alerter dans ce cas laisserait la boutique sans
aucune alarme, ce qui est strictement pire que l'incertitude. Le verdict est donc affiché
à chaque passage, écrit dans `ACCES-REQUIS.md` comme une action humaine, et c'est le
battement de coeur qui apporte la preuve de bout en bout que `list_pops` ne peut pas
donner.

**Pourquoi un domaine « hébergé » se déduit des boîtes listées.** Il aurait fallu un
second appel (`Email list_mail_domains`) pour connaître les domaines du compte. On se
contente de ceux qui apparaissent dans les adresses rendues : c'est suffisant (si une
boîte existe sur ce domaine, nous l'hébergeons) et cela se trompe dans le bon sens (un
domaine hébergé sans aucune boîte est classé « hors compte », donc « non prouvé », jamais
« prouvé »).

**Pourquoi perl et pas php pour lire la réponse.** Le canal historique est tombé parce que
`php` n'était pas le php qu'on croyait. Un contrôle qui dépendrait du même binaire
tomberait le même jour. `uapi` est écrit en perl, donc perl est présent partout où `uapi`
l'est, et `JSON::PP` est dans le coeur de perl depuis la version 5.14. Un seul lecteur, et
il ne regarde que `result.data` : une adresse citée dans un message d'erreur ne doit pas
pouvoir se faire passer pour une boîte existante (le cas est dans le harnais).

**Le format de `list_pops` n'est pas figé** d'une version de cPanel à l'autre : la liste
contient soit des chaînes, soit des objets `{email, login}`. Le lecteur accepte les deux.
L'entrée du compte principal, dont le champ `email` vaut le domaine sans arobase, est
ignorée sans faire tomber la lecture.

**Le contrôle ne peut pas s'exécuter ici** (`uapi` n'existe que sur le compte cPanel).
`scripts/destinataire-essai.sh` pose donc un faux `uapi` en tête du `PATH`, qui rend
l'enveloppe JSON réelle, et vérifie treize cas. Il a été cassé exprès et il est devenu
rouge ; un cas retiré du fichier le fait sortir en 2, parce qu'un harnais qui teste moins
que prévu n'est pas vert.

---

## 2. Un second canal, en HTTP, qui ne partage aucune pièce avec le premier

`scripts/battement.sh` possède le canal HTTP, à un seul endroit. Le courrier reste :
on n'a rien enlevé, on a ajouté.

Ce que « ne partage aucune pièce » veut dire concrètement : pas de php, pas de MTA local,
pas de DNS de messagerie, pas de file d'attente exim. Une requête `curl` sortante, et un
tiers qui accuse réception. Le 28 août, la seule pièce qui manquait suffisait à tout taire.

**L'URL est une capacité.** Qui la détient peut écrire dans le canal d'alerte de la
boutique. Elle vit donc hors du dépôt, dans `~/.config/teeshoop/alerte-webhook`, en 600,
et le code :

- refuse si le fichier est absent, si les droits ne sont pas 600 (400 est accepté parce
  qu'il est strictement plus fermé ; 640 est refusé, parce que sur du mutualisé cela
  signifie « lisible par le groupe du serveur web »), ou s'il n'appartient pas à
  l'utilisateur ;
- refuse une URL qui n'est pas en `https`, sauf la boucle locale, qui sert au harnais et
  qui est annoncée comme n'étant pas un second canal (elle meurt avec la machine qu'elle
  devrait dénoncer) ;
- refuse une URL contenant un espace, un guillemet ou un antislash, parce que ces trois
  caractères sortiraient de la valeur dans le fichier de configuration de curl, et qu'une
  valeur qui sort de sa valeur est une option injectée ;
- **ne passe pas l'URL en ligne de commande.** Sur un mutualisé la table des processus
  n'est pas privée : elle passe par la configuration de curl, sur son entrée standard ;
- **ne l'écrit dans aucun journal, aucune sortie, aucun message d'erreur.** `curl` tourne
  en `-s` sans `-S` précisément parce que ses messages citent l'hôte ; c'est le code de
  sortie numérique qui est rapporté, et il ne fuit rien.

**Le corps porte `text` et `content`, la même phrase.** `text` est ce que lisent Slack,
Google Chat et la plupart des collecteurs ; `content` est ce que lit Discord. Un seul corps
part chez l'un ou chez l'autre sans que le script ait à savoir lequel a été choisi. Le JSON
est construit sans php, pour la raison ci-dessus.

**Aucune donnée personnelle dans ce corps.** Il sort du compte. La passe adversariale a
trouvé que la ligne « la boîte X n'existe pas » y faisait passer une adresse électronique,
ce que le skill `observability` interdit dans un journal ; le texte a été réécrit sans
l'adresse, et le journal local, lui, la nomme en clair, parce qu'il ne quitte pas la
machine.

---

## 3. Le battement de coeur : le silence devient l'alarme

C'est le coeur de l'item, et c'est la seule réponse au cas où plus personne ne peut crier :
machine éteinte, cron désarmé, compte suspendu, disque plein au point que rien ne démarre.

**Ce qui part d'ici.** À chaque passage, en panne comme en bonne santé, la veille envoie un
battement portant l'horodatage, le nom de la machine, le verdict, et surtout le fait que
l'alerte n'ait pas pu partir quand c'est le cas. C'est la seule chose qu'un tiers puisse
voir quand les deux canaux se taisent.

**Ce qui doit être ailleurs, et pourquoi ce n'est pas ici.** Ce qui surveille l'ABSENCE de
battement ne peut pas vivre sur la machine qui bat. `battement.sh --verifier` lit un
fichier posé sur la machine émettrice : il répond juste tant que la machine répond, donc
dans le seul cas qui n'intéresse personne. Cette limite est écrite dans l'en-tête du script
plutôt que contournée.

**Deux issues, et la seconde est moins chère.**

1. Un interrupteur d'homme mort chez un tiers (`healthchecks.io` et équivalents ont une
   offre gratuite qui suffit à un battement toutes les dix minutes). Cela demande un
   compte, donc une action humaine, écrite dans `ACCES-REQUIS.md`.
2. **Notre propre Worker Cloudflare**, qui n'est pas sur le même serveur, ne coûte aucun
   compte de plus, et sait déjà stocker (R2, KV). Un `POST /api/battement` qui note la
   date, et un déclencheur programmé qui alerte au-delà du délai. Ce n'est pas construit
   cette nuit : `worker/` n'est pas dans le périmètre de ce poste, et le faire à moitié
   aurait laissé deux implémentations d'une même règle.

En attendant l'un ou l'autre, ce qui est construit est **l'émetteur, prouvé de bout en
bout** contre un vrai serveur HTTP local, et un `--verifier` honnête sur ce qu'il ne
prouve pas.

---

## 4. L'âge du dernier import de catalogue, à 48 heures

`Importer.php` écrit sa course dans l'option `teeshoop_catalogue_run` : `started` à
l'ouverture, `finished` quand la dernière référence est passée, tous deux en `gmdate("c")`.
La veille lit cette option et alarme au-delà de 48 heures.

**Un import terminé se date sur `finished`.** Simple, et c'est le cas courant.

**Un import EN COURS se juge sur son avancement, pas sur sa date de départ.** La ligne de
cron que documente `Cli.php` porte `--duree=1800` : l'import est reprenable et s'arrête au
bout d'une demi-heure. Une passe complète, mesurée à 2 h 31 min pour 2 302 références,
s'étale donc sur environ six nuits, pendant lesquelles `started` a plusieurs jours et
`finished` est vide. Dater sur `started` ferait sonner l'alarme cinq nuits sur six, et une
alarme à laquelle personne ne croit est pire que pas d'alarme.

La veille suit donc le point d'avancement (`at`, que l'option porte déjà) dans son propre
répertoire d'état, et n'alarme que s'il **cesse de bouger** au-delà du seuil. Le repère est
amorcé sur le début de la course, jamais sur l'instant présent : sinon un import arrêté
depuis une semaine repartirait muet pendant un cycle entier au premier passage de la
veille. Le repère est effacé quand la course se termine.

Une option WordPress ne porte aucune date de dernière écriture : c'est pour cela que ce
repère existe côté veille plutôt que d'être lu dans la base.

**Si l'âge ne peut pas être lu, c'est une alarme.** Option absente, illisible, ou date
impossible à interpréter : la boutique vend alors un catalogue dont personne ne sait l'âge.
Le PHP rend `-1` pour dire « je n'ai pas pu regarder », que le shell distingue de « frais ».

**Pourquoi 48 heures.** L'import complet du catalogue mesuré sur le miroir dure 2 h 31 min
(2 302 références, du 4 septembre 10 h 30 à 13 h 01) ; un rythme quotidien laisse donc une
marge d'un cycle entier avant que l'alarme ne sonne, ce qui évite de réveiller quelqu'un
pour un import décalé de quelques heures. Un catalogue de deux jours, en revanche, met en
vente des références retirées au prix d'avant. Le seuil est réglable
(`--import-max-h=`) parce que la cadence d'import est une décision d'exploitation, pas une
constante physique.

**À noter : aucune ligne de cron d'import n'est installée en production.** La crontab du
compte porte la sauvegarde et la veille, rien d'autre. L'alarme dira donc la vérité dès le
premier jour : le catalogue n'est rafraîchi que quand quelqu'un lance la commande.

---

## 5. Ce que vaut un succès d'envoi, et ce qu'il ne vaut pas

L'état « déjà signalé » n'est écrit que si **au moins un canal a abouti**. Les deux
n'apportent pas la même preuve, et le code ne fait pas semblant du contraire :

- le canal HTTP rend 2xx : **le tiers a accusé réception**, c'est de bout en bout ;
- `mail()` rend `true` : **le serveur local a pris le message**. Ce n'est pas « arrivé ».
  C'est en revanche la différence entre « on a essayé » et « on n'a même pas pu essayer »,
  qui est celle qui manquait le 28 août.

C'est pour cela que la destination est prouvée avant, et que le battement existe : ni l'un
ni l'autre ne se contente de cette promesse. Et **aucun courrier ne part vers une boîte
prouvée absente** : le remettre au MTA rendrait `true`, écrirait l'état, et le problème
serait classé annoncé sans que personne ne l'ait lu.

---

## 6. Trois défauts trouvés en chemin, et corrigés

**Le signal « je n'ai pas pu regarder » ne pouvait pas être lu.** Le lecteur de nombres de
`veille.sh` était `sed -n "s/.*\"$1\":\([0-9]*\).*/\1/p"`, et `[0-9]*` accepte zéro
chiffre : sur `"bat_failed":-1`, il capturait la chaîne vide, le test `[ -n "$B" ]` était
faux, et la branche « le journal des envois n'a pas pu être interrogé » n'a jamais pu
s'exécuter depuis qu'elle a été écrite, le 2 septembre. Mesuré le 5 septembre en rendant la
table des envois introuvable : l'ancien code reste muet, le nouveau annonce. La correction
demande un signe optionnel et **au moins un chiffre**.

**L'adresse de destination sortait du compte.** Voir la section 2.

**Deux sondes n'avaient aucune borne de temps.** `uapi` et `wp eval` pouvaient rester
accrochés. Une veille lancée toutes les dix minutes qui ne rend pas la main épuise le quota
de processus d'un compte mutualisé : la surveillance aurait causé l'incident qu'elle devait
annoncer. Les deux sont bornées (20 s et 60 s), avec repli sur l'appel sans borne si
`timeout` manquait, parce qu'une sonde sans borne vaut mieux que pas de sonde. Mesuré : une
sonde qui dort 120 s rend la main en 20 s, et le verdict devient « je n'ai pas pu
regarder », jamais « tout va bien ».

**Une quatrième chose a été laissée telle quelle** : `wp-cli` introuvable alors que
`wp-config.php` est là ne faisait que sauter quatre contrôles, sans rien dire. C'est
littéralement la cause du 28 août (sous cron, `wp` n'est pas dans le `PATH`). C'est
maintenant une alarme.

---

## 7. Ce qui n'est pas fait cette nuit, nommément

- **Rien n'a été exécuté sur le serveur.** Le port 22 d'o2switch est filtré depuis cette
  machine. Le contrôle de destination a tourné contre un faux `uapi` rendant l'enveloppe
  réelle ; le vrai passage se fera avec le SSH sous les yeux.
- **Le surveillant du silence n'existe pas encore.** Émetteur prouvé, récepteur à choisir
  entre un tiers et notre Worker. C'est une action humaine (`ACCES-REQUIS.md`).
- **Les deux fichiers d'URL n'ont pas été créés.** On n'invente pas une URL de webhook, et
  aucune ne doit apparaître dans le dépôt. Les commandes exactes sont dans
  `ACCES-REQUIS.md`.
- **Les trois nouveaux scripts ne sont pas dans la liste de déploiement.**
  `scripts/deploiement.sh` est tenu par un autre poste cette nuit ; `veille.sh` et
  `sauvegarde.sh` sont copiés dans `~` par `scp`, et `battement.sh` et `destinataire.sh`
  doivent l'être aussi, sans quoi la veille perdra son second canal en silence (elle le
  dit sur sa sortie d'erreur, mais elle continue de tourner).
