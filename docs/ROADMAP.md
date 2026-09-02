# Feuille de route de teeshoop.com

État au 19 août 2026. Ce document dit **où en est le projet** et **ce qu'il reste à
faire**, dans l'ordre. Il est volontairement court : le détail vit dans le code et dans les
messages de commit.

---

## Ce qui est fait

**Le socle et la sécurité (R0).** Le Worker Cloudflare est fermé par défaut : sans le
secret `ADMIN_TOKEN`, tout `/api/fr/*` et la page `/admin` sont refusés. Le bundle client
a été séparé du bundle admin : nos prix d'achat, notre modèle de coût film et le
formulaire d'identifiants WooCommerce ne partent plus dans le JavaScript d'un visiteur, et
deux garde-fous automatiques empêchent la régression. Une faille de cache qui exposait nos
prix d'achat par une simple requête a été fermée. Le premier affichage du studio a été
réduit de 58 % (React voyageait à l'intérieur du morceau three.js).

**L'autorité de prix (plugin `teeshoop-core`).** Le prix payable est calculé en PHP, sur le
serveur. Il n'y a **aucun champ prix** dans la requête d'ajout au panier : le panier
enregistre les choix du client et recalcule le prix à chaque passage. Tout est en centimes
entiers ; « 14,50 » saisi à la française est lu correctement. Le chapitre 1 de la Bible est
encodé, **avec une formule corrigée** : le prix plancher publié majore le *coût* du taux de
commission alors que la commission porte sur la *marge*. À 250 € de coût, 100 € de marge
cible et 40 % de commission, le vrai plancher est **416,67 €** et non 583,33 €. Le test
garde les deux versions côte à côte.

**Le DTF : chaque visuel est mesuré par son encre.** Un visuel était mesuré par le rectangle
dans lequel il avait été déposé, si bien que les marges transparentes d'un logo client étaient
achetées en film et facturées au client. Mesuré sur une commande de 20 vêtements avec des
fichiers clients réalistes : **220 cm de rouleau ramenés à 60 cm**, 1,28 m² de film ramenés
à 0,35 m². C'est exactement ce que demande le chapitre 1 : « largeur et hauteur de chaque
**visuel** ».

*Cette mesure portait une conversion en euros, « 37,40 € ramenés à 10,20 € », faite au tarif
de la Bible (17 € HT le mètre linéaire). La réponse à la question 04 du 1er septembre 2026 a
remplacé ce tarif par une feuille A3+ à 3,00 EUR, et la conversion n'a pas été refaite : le
métrage ci-dessus reste mesuré, les deux montants ont été retirés plutôt que mis à l'échelle
de tête.*

La même mesure fixe désormais le prix client, en cm², ce qui corrige trois surfacturations :
les marges transparentes, l'espace vide entre deux visuels d'une même face (59 % de la
facture sur le design d'exemple), et un visuel débordant de la zone d'impression qui était
facturé en entier.

**La remise du design.** Le fichier d'un client n'existait que dans son propre navigateur.
Il est maintenant déposé sur R2 via le Worker, et WordPress vérifie son existence avant
d'accepter la ligne de panier : une commande impossible à imprimer est refusée avant le
paiement, pas découverte après. Vérifié de bout en bout : identifiant réel → panier à
271,75 € calculé par le serveur ; identifiant inventé → refusé.

**La boucle est fermée : du studio au panier.** Un visiteur ouvre le studio sur une fiche
produit, dessine, clique « Ajouter au panier », et une ligne WooCommerce apparaît avec un
identifiant de création vérifié et un prix que WordPress a calculé lui-même. Vérifié de bout
en bout par `npm run verify:wp-e2e` : 29 assertions, contre un vrai navigateur, un vrai
Worker et un vrai panier. Le prix affiché dans le studio, celui enregistré sur la ligne et
le sous-total du panier sont le même nombre, et c'est celui de `Pricing::quote()`.

Deux entrées de prix ont cessé d'arriver du navigateur au passage. **Le vêtement** est
désormais déclaré sur la fiche produit : il décide du prix du textile nu, et une requête
pouvait auparavant annoncer « custom » (textile à 0 EUR, le client fournit le sien) sur un
sweat et emporter 27 EUR de textile pour rien. **Les surfaces imprimées** viennent du
fichier de création que le Worker a confirmé, donc la facture et le film mesurent la même
chose. Trois autres défauts ont été trouvés en regardant la vraie page : les devis
échouaient silencieusement sur une boutique aux permaliens simples, le panier annonçait une
remise de 2 115,50 EUR qui n'a jamais existé (prix de référence fictif, interdit en France),
et une boutique réglée en dollars affichait des euros avec un dollar devant.

**La fiche produit répond avant l'éditeur.** Un acheteur qui arrive sur une fiche sait
maintenant, sans ouvrir le studio : ce qu'est le vêtement, ce qu'il paie **à sa quantité**,
**jusqu'où il peut imprimer en centimètres**, et comment obtenir un prix pour deux cents
pièces. La grille prix par quantité est celle de `Pricing::grid()`, donc celle du panier,
et ses colonnes sont **déduites des paliers de remise** au lieu d'être choisies : une
colonne ne peut pas laisser croire à un palier qui n'existe pas. Le « à partir de » est lu
dans la grille imprimée juste en dessous, avec la quantité qui l'atteint : chez notre
principal concurrent, ce chiffre est le prix à 500 pièces, si bien qu'un acheteur de vingt
découvre 36 % d'écart en descendant la page.

Les zones d'impression sont publiées en centimètres. **Ni mistertee.fr ni tostadora.fr ne
publient une seule dimension d'impression sur une fiche produit** (vérifié le 14 août
2026) : c'est notre différence, parce que nous facturons l'encre et pas le fichier. Les
chiffres viennent des définitions du studio, pas d'une saisie : un générateur les extrait
et un test échoue si les deux divergent.

**Le devis est un dossier avec un état**, pas un e-mail. Cinq états, pas les vingt-cinq de
la Bible, dont au moins six sont des tâches et non des états de commande (le document le
dit lui-même trois lignes plus loin). Le formulaire est ouvert, parce qu'un prospect ne
peut pas s'authentifier, et il est tenu par un jeton signé à durée limitée, un piège à
robots, une durée minimale de remplissage et une limite par adresse : l'adresse elle-même
n'est jamais enregistrée.

**Un vrai bug de production trouvé en rendant le miroir conforme.** WooCommerce ne construit
un panier que pour ce qu'il considère comme une requête de site, et il le décide en
cherchant le préfixe REST dans l'adresse. Avec les permaliens simples d'une installation
neuve, notre route d'ajout au panier ne contient pas « wp-json » : WooCommerce chargeait un
panier et tout fonctionnait. Avec les permaliens propres, ceux d'o2switch, **chaque ajout au
panier répondait 503**. Toute la séance 01 avait été vérifiée verte sur la seule
configuration où le défaut est invisible.

**Le catalogue fournisseur est dans la boutique.** 459 références et 26 392 articles publiés
sur les 463 et 26 399 que le fournisseur liste comme imprimables, avec
leurs coloris, leurs tailles, leur grammage, leur composition, leur stock et notre prix
d'achat. Une référence est **un produit variable**, un article vendu par le fournisseur est
**une variation** : construites depuis la liste d'articles et jamais depuis le produit
cartésien coloris × taille, parce que 3 481 de ces combinaisons (11,6 %) n'existent pas et
seraient autant de commandes impossibles à honorer.

L'import est **idempotent par comparaison, pas par empreinte** : chaque champ est relu et
comparé, et rien n'est écrit tant que rien n'a bougé. Cette exigence a trouvé deux défauts
qu'une empreinte aurait cachés pour toujours : `_global_unique_id` est devenu une meta
interne de WooCommerce 9.2, donc sa relecture rendait toujours une chaîne vide ; et les
options d'un attribut de taxonomie reviennent triées par nom de terme et non dans l'ordre
où elles ont été écrites, si bien qu'une comparaison de séquences trouvait une différence
toutes les nuits et réécrivait le résumé d'attributs des 366 variations d'un produit.

Il est **reprenable** : `--duree=1800` fait une demi-heure de travail et s'arrête
proprement, et le curseur est écrit dans la même transaction que la référence, donc un
processus tué rejoue la référence entière au lieu d'en laisser une moitié. Mesuré :
0,24 s par article à la création (style 01542, 299 articles, une transaction) contre
0,38 s sans transaction (style 18009, 366 articles), et 5 ms pour revérifier un article
inchangé. Deux styles différents, donc un ordre de grandeur et non un A/B contrôlé.

**Notre prix d'achat ne sort par aucune porte** : ni l'API REST authentifiée (produits et
variations), ni l'API Store publique, ni l'export CSV avec les meta personnalisées, ni le
JSON des variations envoyé au navigateur. `npm run verify:wp-catalogue` le prouve en
retirant le verrou et en exigeant que le même contrôle trouve la fuite.

**Le prix de vente, lui, n'est pas inventé.** La Bible donne la formule et laisse le taux
de marge à décider : tant que personne ne l'a fixé (question 42), aucun prix n'est écrit et
le catalogue est consultable sans être commandable.

**L'outillage.** Un miroir local de la production (WordPress 7.0.4 + WooCommerce 11.0.1 en
docker, **versions épinglées** sur celles réellement mesurées sur le serveur) que l'on peut désormais **reconstruire depuis le dépôt** (`wp teeshoop
provisionner`), 147 tests JavaScript, 177 tests PHP purs, 45 tests d'intégration WooCommerce,
une vérification de bout en bout du parcours d'achat à 66 assertions qui va désormais
jusqu'à la facture, un garde-fou qui interdit à un prix d'achat, un nom de fournisseur ou
un tarif film d'atteindre un gabarit PHP, et des scripts de vérification qui font tourner
le vrai code dans un vrai navigateur.

**Encaisser (séance 04).** Le régime de TVA n'est pas une constante : c'est une suite de
**périodes datées**, avec un mode franchise qui supprime toute ligne de taxe et fait
apparaître « TVA non applicable, article 293 B du CGI ». Aucun seuil n'est écrit dans le
code, parce que les seuils sont la réponse du comptable. La livraison est facturée à la
grille publique Colissimo au poids, l'emballage compris, avec un franco, et le coût d'une
livraison offerte reste enregistré sur la commande : « offerte » est une remise, pas un
coût nul. La facture porte un numéro continu attribué en une seule instruction SQL
(six processus concurrents, 150 numéros, aucun doublon et aucun trou ; la même fonction
écrite en lire-puis-écrire en perd 48), elle est **gelée à l'émission** parce que
`calculate_taxes()` de WooCommerce reprend une commande déjà passée au taux du jour, et
elle est relue par poppler, qui ne partage pas une ligne avec le code qui l'écrit.
L'identité légale du vendeur est **vide** et le restera : en production une facture
incomplète est refusée, ailleurs elle sort marquée « document non conforme ».

**L'acompte** est un état et non une case : chaque encaissement est une ligne sur la
commande, avec sa date, son moyen et sa référence, et ce que l'atelier a le droit de faire
se déduit de la somme, jamais du statut affiché. La Bible se contredit sur ce point (elle
autorise « acompte possible, solde avant expédition » et exige « une commande non payée ne
peut pas passer en production »), et les deux lectures sont tenues côte à côte dans les
tests : sans autorisation il faut tout payer avant production, avec autorisation l'acompte
suffit à produire et jamais à expédier. Chaque acompte encaissé émet **une facture
d'acompte** numérotée dans la même série continue, ce que l'article 289, I-1-c du CGI rend
obligatoire, et la facture définitive reprend l'opération entière et les déduit.

**Ce qu'une commande coûte, et le plancher (séance 05).** Le chapitre 1 est désormais
exécutable de bout en bout : dix postes de coût direct, chacun avec son montant, sa source,
sa date et sa **fiabilité**, et une fiabilité à quatre valeurs et non deux, parce que
« zéro » et « nous n'avons pas pu mesurer » s'additionnent pareil et ne veulent pas dire la
même chose. Le rapport refuse de se déclarer complet tant qu'un poste est inconnu, et le
plancher qu'il affiche est alors un plancher **minimum**.

Le **coût du film n'est pas saisi, il est mesuré** : la commande est imbriquée sur la
géométrie que la boutique achète réellement (depuis le 01/09/2026 une feuille A3+ de
33 x 46 cm, avant cela un rouleau de 56 cm) par `src/lib/dtf/nesting.ts`, le même moteur qui produit les planches de l'atelier,
appelé par le plugin sur une route d'administration du Worker. Il n'y a donc pas deux
imbricateurs. Quand la route n'est pas joignable, le coût retombe sur une **borne haute
démontrée** (une bande par transfert), jamais sur une estimation : `scripts/nest-verify.mjs`
refait la démonstration à chaque exécution, dans les deux langages, contre le vrai
imbricateur. Elle a trouvé un défaut à sa première exécution, une borne qui passait
**sous** l'imbrication réelle sur une commande d'une pièce.

**Trois corrections de la Bible plutôt qu'une.** Au plancher déjà corrigé s'ajoutent :
« taux de marge » désigne en français la marge sur le *coût* alors que la formule publiée
est celle de la marge sur le *prix de vente*, ce qui vaut **125,00 EUR d'écart** sur une
commande de 250 EUR de coût (au taux de 50 % donné le 1er septembre 2026 ; c'était
168,06 EUR à 55 %, le taux supposé avant sa réponse) ; et la contribution minimale, absolue dans la Bible et
exprimée en pourcentage dans l'hypothèse par défaut, donne une formule différente qui
**n'a aucune solution** dans un cas que le code refuse au lieu de renvoyer un plancher
négatif.

**Le plancher n'est pas le même partout.** Le chapitre 1 demande de pouvoir le définir
par famille de produits, par technique, par commercial, par taille de commande, par type
de client et par niveau d'urgence : les six existent, se règlent depuis l'écran, et la
règle qui s'applique à une commande est gelée dans son rapport et nommée sur son écran.
**La table est livrée vide** parce qu'une règle est la seule chose de ce moteur qui puisse
ABAISSER un plancher, et que les taux par famille sont la question 06.

**Et une mesure qui appelle une décision.** Aux réglages actuels, **aucune colonne de la
grille publique n'est vendable sans validation**. Remesuré le 2 septembre 2026 après les
réponses, par `tests/demo-grille.php` : cinq pièces passent **3,69 EUR** sous leur plancher
(c'était 14,21 EUR sous le rouleau et 55 % de marge cible), **cinquante pièces sont passées
sous le leur de 1,81 EUR alors qu'elles étaient à valider**, et les trois autres colonnes
dépassent les 15 % de remise qu'un commercial peut accorder seul.

Les cinquante pièces sont la ligne que la page d'accueil met en avant, donc c'est la vente la
plus probable de la boutique qui est sous son plancher. Et le coût monte de **16 %** à cent
pièces alors que la question 05 a divisé le temps de pose par trois : la feuille A3+ coûte
plus cher que le rouleau pour ce visuel, 61 feuilles à 3,00 EUR contre les mêmes mètres au
mètre linéaire. Les deux tableaux sont côte à côte dans la question 06.

**Et sur une vraie commande, pas sur une grille.** L'item 3 de la séance demande le prix
plancher, le prix conseillé et la commission redérivés sur une commande réellement passée.
`tests/demo-order.php` en pose une (trente t-shirts, visuel en deux morceaux, cliente à
Paris), elle est payée, facturée et chiffrée, et `wp teeshoop marge` l'imprime. Mesuré le
2 septembre 2026 :

| | |
|---|---|
| Vendue HT | 326,10 EUR |
| Coût direct connu | 240,19 EUR, **incomplet** |
| Prix plancher | 411,75 EUR, et c'est un plancher MINIMUM |
| Prix conseillé | 480,38 EUR |
| Commission | 34,36 EUR, provisoire |
| Verdict | **sous le plancher, sans dérogation** |

**Le marquage de cette commande est une borne haute et le rapport le dit** : le service
d'imbrication n'a pas répondu depuis le conteneur, donc 19 feuilles ont été comptées à raison
d'une bande par transfert, sans imbrication. Le coût réel est plus bas et le plancher aussi.
C'est le comportement voulu (une mesure impossible majore le coût au lieu de l'ignorer) et
c'est aussi la raison pour laquelle ce chiffre n'est pas comparable ligne à ligne avec la
grille ci-dessus, qui a tourné avec le Worker joignable.

Deux lignes du coût valent toujours **inconnu** et non zéro : les consommables et la
provision de défaut. Une troisième est minorée et le dit : la main-d'œuvre, 5,33 EUR, avec
cinq opérations d'atelier jamais chronométrées.

**Et ce que la séance n'a pas construit, écrit avant de fermer.** Le chapitre 1 est plus
large que ce que la séance demandait, et quatre morceaux restent dehors, délibérément. Deux
attendent un chiffre de l'associé et sont donc dans le registre, avec un contrôle qui les
tient : **aucune technique autre que le DTF n'a de modèle de coût** (broderie, flocage,
vinyle, sublimation, `H-Q12-COUT-PAR-TECHNIQUE`, questions 12 et 13) et **aucun supplément
d'express ou d'urgence n'est chiffré** (`H-Q14-AUCUN-SUPPLEMENT-URGENCE`, question 14).
Les deux autres n'attendent la réponse de personne et sont dans le tableau des exceptions
plus bas : **l'API de prix** du chapitre et **les dix indicateurs**. Aucun des quatre
n'était dans le périmètre de la séance ; ils sont écrits ici pour que la séance qui les
prendra les trouve, et non pour qu'on les redécouvre.

**Le bon à tirer, le cycle de vie et les envois (séance 06).** Une commande payée ne part
plus en production sur la foi d'un statut. Le client reçoit un **bon à tirer** engendré
depuis sa création (le vêtement, le coloris, les tailles, le visuel à sa vraie place, les
dimensions en centimètres et la descente sous l'encolure, qui est le chiffre auquel une
presse est réglée), il l'ouvre depuis un lien qui ne demande aucun compte, et il valide ou
demande des modifications. La validation enregistre la date, l'heure, l'adresse IP, **la
version exacte** et le texte qui était à l'écran ; une version 4 n'hérite jamais de la
validation de la version 3.

Ces trois numéros, le placement du marquage, sont **mesurés dans le navigateur** et voyagent
dans le fichier de création, parce que l'encre d'un visuel se lit dans le canal alpha d'une
image décodée et que ni le Worker ni PHP n'ont de canvas. Ils forment un bloc séparé des
rectangles de film : un placement refusé est abandonné et les rectangles restent, de sorte
qu'un défaut d'affichage ne peut pas faire baisser un prix plancher. Le studio envoie
désormais **une maquette par face imprimée** : un BAT qui ne montre que le devant d'un
vêtement imprimé devant et dos ne décide rien du dos, et ce document décide qui paie une
reprise.

**Le statut est une étiquette, le dossier est l'autorité.** C'est la règle que `Ledger`
tenait déjà pour l'argent. `Lifecycle::blockers()` demande au registre des encaissements
combien d'argent est réellement rentré et au bon à tirer si la version **courante** est
validée. Sept statuts sont ajoutés, chacun parce que WooCommerce n'a pas le mot ; les
siens gardent leur sens. Un changement de statut illégal est refusé et remis en place, et
les deux moitiés du garde-fou ont été cassées exprès pour prouver qu'elles portent quelque
chose : sans l'une, un clic sur « Marquer terminée » suffisait à déclarer livrée une
commande jamais imprimée.

**Un envoi qui n'arrive pas est visible.** L'échec classique de WordPress est un `wp_mail()`
dont personne ne lit le retour ; un BAT perdu, c'est une commande qui s'arrête pour toujours
sans que personne le sache. Chaque message est une ligne avant d'être une requête, les
échecs remontent sur tous les écrans d'administration, et un renvoi **recompose** le message
depuis la commande au lieu de rejouer une copie stockée, ce qui est aussi une propriété de
sécurité : une table de corps de messages serait une table de liens d'approbation vivants.

**Et la renonciation au droit de rétractation est prise avant la commande.** L'hypothèse
écrite de la question 18 la plaçait à la validation du BAT, c'est-à-dire après le paiement,
donc après la conclusion du contrat. Les deux existent désormais, parce que ce sont deux
actes différents.

**Le film est acheté une fois pour plusieurs commandes (séance 07).** L'unité qui achète
du film n'est plus la commande, c'est le **lot** : tout ce qui est payé et dont le bon à
tirer est validé, imbriqué sur les mêmes planches, une commande fournisseur, une livraison,
et la facture répartie entre les commandes pour que chaque rapport de marge dise ce que la
sienne a réellement coûté.

Remesuré le 1er septembre 2026 sur le tarif à la feuille, sur la même semaine de six
commandes réalistes (`scripts/dtf-bench.mjs`) : **134,10 EUR de film achetés commande par
commande deviennent 59,10 EUR achetés en une fois**, soit **75,00 EUR**. La décomposition
compte plus que le total, et elle est imprimée par le banc : **les 75,00 EUR sont
exactement les cinq livraisons évitées**, **0,00 EUR de minimum fournisseur** et
**0,00 EUR d'imbrication**.

**Tout l'intérêt du groupage tient désormais à un seul chiffre, et c'est une hypothèse.**
Sous le rouleau à 17,00 EUR le mètre, le banc donnait 121,41 EUR, dont 42,84 EUR de
minimums d'un mètre non gaspillés et 3,57 EUR d'imbrication. Les deux postes ont disparu :
sur une feuille de 33 x 46 cm chacune des six commandes occupe déjà plus d'une feuille, donc
aucune ne paie de minimum, et il ne reste pas assez de largeur pour qu'une commande partage
une feuille avec une autre (644 cm imbriqués ensemble contre 644 cm imbriqués séparément,
14 planches dans les deux cas). Ce qui reste est la livraison de 15,00 EUR par commande, que
l'associé classe lui-même en « à confirmer sur la facture fournisseur » : si elle est
offerte, le groupage ne rapporte plus rien du tout.

**Ce que ça coûte en manutention, mesuré aussi.** Sur la même semaine : **20 piles de tri
au lieu de 7**. Une planche mutualisée mêle les visuels de plusieurs clients, donc chaque
pièce découpée doit être triée au lieu d'aller sur l'unique pile de sa commande, et le
nombre de piles qu'un opérateur tient ouvertes est le nombre de couples (commande,
planche). C'est pourquoi chaque pièce porte son numéro de commande sur le plan de découpe
et pourquoi le dossier contient une fiche de pose par commande. S'y ajoutent une
imbrication de plus que de commandes (chacune est aussi imbriquée seule, sinon l'économie
n'est pas mesurée mais affirmée) et le fait qu'un lot dont le film est commandé ne peut
plus être défait.

**Et le groupage ne fait pas toujours gagner du film.** Deux transferts de 30 × 20 cm ne
tiennent pas côte à côte sur une laize de 58 cm : ensemble ils coûtent 50 cm de rouleau,
séparément 20 + 20. Le cas est tenu par un test des deux côtés, et c'est pourquoi la
comparaison se fait en euros et pas en centimètres, et pourquoi un lot qui vaut moins que
ses parties revient marqué comme tel au lieu de porter une économie que personne n'a faite.

**La répartition a une règle, et ce n'est pas la plus évidente.** Chaque commande paie la
part de la facture que représente le film qu'elle exige. La règle proportionnelle au coût
que chacune aurait payé seule est celle des manuels et elle s'effondre ici : cinq des six
commandes de la semaine tenaient sous le minimum d'un mètre, donc cinq factures
individuelles identiques, donc une commande de 80 poses facturée comme une de 16. La règle
proportionnelle à la surface d'encre est calculée et **publiée** à côté, jamais facturée :
elle facture l'encre portée et non le film exigé, et un dos de 55 cm laisse sur le rouleau
une bande que personne d'autre ne peut utiliser.

**La planche est mesurée dans le navigateur, et la boutique la borne.** L'étendue d'un
transfert est son encre, l'encre vit dans un canal alpha, et ni PHP ni le Worker n'ont de
canvas : c'est déjà pourquoi `POST /api/nest` n'imbrique que des rectangles. La boutique ne
fait donc pas confiance à la planche, elle l'encadre : les **poses** doivent correspondre
exactement (c'est le seul nombre qui ne bouge ni avec la gradation ni avec la découpe, que
la question 32 laisse à l'atelier), la longueur doit valoir au moins la surface divisée par
la laize et au plus ce que l'imbricateur en bandes droites en fait, et les transferts
doivent être assez grands pour porter l'encre facturée. Un imbricateur injoignable refuse
le lot : « on n'a pas pu demander » n'est pas « c'est bon ».

**Un lot expédié est la preuve qui manquait.** Jusqu'ici toute commande était chiffrée au
tarif français quelle que soit son urgence, parce qu'une case cochée n'est pas une preuve
d'achat. Un lot dont le film a été commandé en est une : il enregistre l'origine, à une
date, par quelqu'un, et il est gelé ensuite. Un lot en **brouillon** ne change aucun coût.

**Et l'atelier a un calendrier, qui a trouvé une promesse intenable.** Jours ouvrés, onze
jours fériés dont quatre suivent Pâques, une date cible par commande à partir de la
validation du bon à tirer, et la date limite à laquelle son film doit être commandé selon
l'origine. Mesuré : entre un BAT validé et un colis il y a 6 jours ouvrés de travail
incompressible, dans une promesse d'urgence de 4. **Toute commande urgente est en retard de
deux jours au moment où le client valide son bon à tirer**, l'express tient à un jour près,
et seul le standard laisse la place d'acheter le film en Espagne. Rien n'a été ajusté pour
que ça passe : les trois chiffres sont ceux de la question 14 et le calcul est un test.

**Acheter les textiles, et savoir ce qu'on a (séance 08).** L'unité qui achète du film est
le lot depuis la séance 07 ; l'unité qui achète les **vêtements** est la même. Le panier
d'achat est déduit des commandes et de leurs grilles de tailles, jamais saisi, et chaque
quantité est traçable jusqu'à une ligne de commande : le code le prouve, ligne par ligne,
au lieu de le supposer. Une ligne dont l'article ne peut pas être identifié est refusée par
son nom et bloque l'achat, parce que se tromper de taille est la faute la plus chère de tout
le système, le film étant déjà imprimé quand les cartons arrivent.

**La décision qui ouvre la séance est écrite dans `docs/ACHATS.md`** : la commande est
préparée automatiquement et transmise seulement après une confirmation humaine, ce qui est
l'hypothèse par défaut de la question 22. Les deux autres options ont été comparées, pas
écartées : ne rien automatiser fait ressaisir quarante lignes à la main, ce qui est
exactement l'endroit où l'on se trompe de taille ; automatiser au-dessus d'un seuil de
confiance suppose une confiance qui n'existe pas, la question 43 étant encore une
supposition sur le modèle de données de quelqu'un d'autre. La préparation et l'envoi sont
**deux actes sur deux écrans**, et la confirmation est **tapée** : l'opérateur recopie le
mode du compte fournisseur, ce mot voyage avec la commande, et le Worker refuse si le mode a
changé entre l'écran et le clic.

**Le lien qui manquait est sur la fiche produit.** Aucune commande de cette boutique ne
pouvait nommer un article fournisseur : les 26 399 articles du catalogue n'ont pas de prix
de vente, et le t-shirt, le sweat et le vêtement client du studio n'étaient rattachés à
aucune référence. Une fiche produit déclare désormais la référence du catalogue sur laquelle
elle est imprimée et la correspondance de ses coloris, au même endroit et pour les mêmes
raisons que le vêtement du studio qu'elle déclarait déjà. La taille correspond par son nom
exact, et rien n'est déduit de la numérotation du fournisseur, qui est référence + coloris +
un chiffre avec la même table des tailles dans tous les coloris. **Cela referme un trou du
moteur de coût** : le coût textile d'une commande du studio était inconnu, donc son plancher
n'était qu'un minimum ; il vient maintenant de l'article réel, taille par taille, parce
qu'un 2XL ne coûte pas le prix d'un M.

**Mesuré sur la même semaine de six commandes que la séance 07**, tarifs relevés en direct
le 19 août : 67 pièces à 278,05 EUR de textile, et **48,00 EUR de port économisés**, qui
sont l'intégralité du gain. Le textile coûte le même prix des deux côtés, un article se
vendant à l'unité ; ce sont six ports de 8,00 EUR qui deviennent zéro parce que le panier
groupé passe le franco de 200,00 EUR qu'aucune commande seule n'atteint. Même leçon que la
séance 07 sur le film : ce que le groupage fait gagner, ce sont des frais fixes.

**Envoyer est un acte unique et n'est jamais rejoué.** L'interface du fournisseur ne permet
pas de relire une commande (vérifié : la route de commande interrogée en lecture répond
`<response>0</response>` et il n'y a pas d'action `get_orders`), donc l'état « envoi en
cours » est écrit et enregistré **avant** l'appel : un processus qui meurt en tenant la
requête laisse un dossier qui dit « envoi incertain » et refuse de repartir. Trois issues et
non deux, parce que « la réponse s'est perdue » n'est ni un échec à rejouer ni un succès à
attendre. **Le dernier verrou est vide** : `FR_CUSTOMER_NR` n'est configuré nulle part, donc
rien ne peut partir. Le code **devinait** ce numéro à partir du login et le signalait ; le
repli est supprimé, et une sonde en mode test a essayé de confirmer la devinette auprès du
fournisseur. **Non concluant, et le script le dit** : la passerelle répond exactement la
même chose à un numéro de client délibérément faux qu'au nôtre.

**Le stock est une observation datée.** Le relevé complet du catalogue tient en **un seul
appel** au fournisseur, ce que personne n'avait essayé : le joker de troncature accepte un
souligné à toutes les positions. Mesuré, 46 592 lignes en 674 ms et 908 ko, contre 460
invocations pour la forme qui semblait naturelle. C'est ce qui rend tenable le « plusieurs
fois par jour » du chapitre 4 : le balayage tourne six fois par jour et écrit l'horodatage
du fournisseur à côté de chaque quantité. Un article que le relevé n'a pas mentionné garde
sa date et vieillit tout seul, sinon un article retiré du catalogue deviendrait un article
que la boutique annonce disponible. Le client lit **« Disponible », « Délai allongé » ou
« Délai à confirmer »**, jamais un chiffre, et la troisième mention est celle que personne
ne pense à construire.

**Et l'horodatage du fournisseur n'est pas en UTC.** Mesuré : une même réponse portait
14:49:09 en UTC, écrit par nous, à côté de 16:49:10 écrit par lui pour le même instant. Il
écrit son heure murale. WordPress met le fuseau par défaut de PHP à UTC, donc chaque relevé
aurait paru deux heures plus vieux qu'il n'est en été. Sous une fenêtre de 24 heures cela ne
casse jamais tout à fait, ce qui est exactement pourquoi cela serait resté.

**Ce que l'écran des achats montre en plus**, par commande : ce que les textiles coûtent au
moment de l'achat contre ce que le rapport de marge gelé avait supposé. Ce qui n'y est pas
et ne peut pas y être, c'est ce que le fournisseur a réellement **facturé** : son interface
ne publie aucune facture, et l'écran le dit plutôt que de laisser croire que le
rapprochement est complet.

**Et ce que la passe adverse a trouvé sur un changement pourtant vert.** Six angles,
quarante et un agents, chaque trouvaille réfutée avant d'être crue : 28 ont survécu, et les
quatre qui comptent sont exactement celles que la séance existait pour empêcher.

La plus chère : **le textile nu était résolu en direct et non gelé à la vente**. Le panier
lisait la référence sur la fiche produit au moment où quelqu'un appuyait sur « Préparer »,
des jours après la vente et souvent après l'impression du film. Reproduit sur le miroir
avec de vraies données de catalogue : un gestionnaire remplace une référence en fin de vie,
la 00142 devient la 00517, le nom de coloris « Navy » existe sur les deux parce que
`pa_couleur` est un seul attribut partagé par tous les styles importés, rien ne refuse
nulle part, et vingt polos sont achetés pour une série dont le film est imprimé pour des
t-shirts. La collision est le cas ordinaire : dans le miroir, « Navy » est porté par 4
styles et « White » par 5. La référence et le coloris fournisseur sont désormais gelés sur
la ligne au moment de la vente.

Trois autres du même genre : la résolution d'un article prenait **le premier** que
WooCommerce rendait quand un coloris et une taille en désignaient deux, ce qui achetait à
pile ou face ; une commande **acceptée avec des lignes refusées** s'affichait comme
entièrement « Commandée », les refus étant enregistrés puis masqués par l'écran, de sorte
que la pénurie se découvrait à l'ouverture des cartons ; et l'importateur **datait des
articles que le relevé de stock n'avait jamais mentionnés**, dont la quantité est
volontairement gelée, si bien que ce chiffre ne pouvait plus jamais vieillir.

Côté argent : **`send()` ne prenait aucun verrou** là où `prepare()`, qui ne dépense rien,
en prend un depuis le premier jour, donc un double clic pouvait envoyer deux documents sous
la même clé ; une réponse nommant un numéro de commande **et** une erreur était classée
« refusée », ce qui libère les commandes et les fait racheter ; et un refus du Worker
survenu **avant** l'envoi arrivait sous la forme d'un 502, donc de l'état terminal « envoi
incertain ».

Et une de sécurité : **un seul secret dépensait de l'argent.** `ADMIN_TOKEN` ouvre toutes
les routes, et l'un de ses porteurs est la tâche de nuit qui importe le catalogue depuis un
WordPress mutualisé. La route d'envoi demande désormais un second jeton, sur un en-tête à
elle, et n'accepte que la forme `Bearer`, parce que la forme `Basic` existe pour qu'un
navigateur ouvre `/admin.html` et qu'un navigateur la rejoue.

**Deux questions nouvelles, toutes deux trouvées en construisant.** La **46**, bloquante :
combien de temps s'écoule entre un bon de commande textile et la réception ? Personne ne
l'avait jamais mesuré, la Bible ne le donne dans aucun de ses huit chapitres, et l'atelier ne
planifiait donc que le film.

*Répondu le 1er septembre 2026 : environ 24 heures réelles, 2 jours ouvrés retenus pour
planifier. Remesuré plutôt qu'additionné, et le résultat est que **rien ne bouge** : les
6 jours ouvrés incompressibles restent 6. Le film et les blancs sont commandés le même jour
et voyagent en même temps, donc l'atelier attend le plus tardif des deux une fois, et deux
jours de blancs contre deux jours de film français font deux. Additionner de tête aurait
donné 8 et fait paraître chaque promesse deux jours pire qu'elle n'est. L'écran des achats
porte désormais une date limite de commande des blancs par commande.* La **47** : que fait-on quand le prix
d'achat augmente entre le devis et l'achat ? Mises bout à bout, les règles de la Bible font
que Teeshoop absorbe la hausse et reprend une part de commission au commercial pour une
hausse qu'il n'a pas causée.

**Le site autour de la machinerie (séance 09).** Il y a maintenant un thème, et c'est le
nôtre. Trois stratégies ont été comparées avant d'écrire une ligne, et la raison de garder
le nôtre n'est pas la vitesse : un thème de blocs met la structure des pages **dans la base
de données**, où le dépôt ne peut plus la contrôler, alors que toute la discipline de ce
projet est qu'une règle a un foyer et qu'un contrôle échoue quand deux copies divergent. Il
coûte aussi le studio, parce que le gabarit produit en blocs passe la description dans
`wp_kses_post`, où `iframe` n'est pas autorisé. Un thème enfant de Woodmart, lui, met une
licence que nous ne contrôlons pas sur le chemin critique, et hérite de la guerre de
priorités que `Compat.php` existe déjà pour éviter.

La vitesse a quand même été mesurée, parce qu'elle était affirmée : sur la même page
boutique, `npm run bench:theme` relève **224 ms de rendu serveur contre 493 ms** pour Twenty
Twenty-Five, **73 ko de HTML contre 221**, **15 feuilles de style contre 39** et un premier
affichage à **672 ms contre 864**.

**La palette a quitté la fiche produit.** Les neuf couleurs étaient déclarées sur quatre
sélecteurs de `assets/product.css`, chargées uniquement sur une fiche produit : un accueil,
une catégorie ou un panier n'en avait aucune. Elles vivent désormais dans
`assets/tokens.css`, sur `:root`, avec **le rapport de contraste mesuré à côté de chaque
paire**. Une valeur a changé au passage : le bord des champs de saisie était dessiné à
1,33:1 sur blanc, là où la règle 1.4.11 en demande 3. `--ts-line-strong` est le même bleu
gris (213°, saturation 0,148) assombri jusqu'à passer 3,26:1 sur le papier et 3,04:1 sur le
fond gris, sur les deux surfaces où il est dessiné.

Et les trois copies imposées de cette palette sont désormais tenues ensemble : les e-mails
l'écrivent en hexadécimal parce qu'aucun client de messagerie ne résout une propriété
personnalisée, le bon à tirer l'inline parce qu'il est servi sans thème et **sous d'autres
noms** (`--accent` et non `--ts-accent`), ce qui est exactement la façon dont une divergence
se cache. `npm run verify:palette` les compare rôle par rôle et a été cassé exprès pour
prouver qu'il tire.

**Le catalogue se comporte comme un moteur de recherche, ce que le chapitre 4 pose comme
condition.** Il écrit, mot pour mot : « à condition que l'architecture du catalogue soit
pensée comme un moteur de recherche spécialisé et non comme une succession de centaines de
pages difficiles à parcourir ». Dix facettes, contre cinq chez mistertee.fr, dont la
couleur ne rend aucune option, et zéro chez tostadora.fr. Le **grammage** en fait partie,
et c'est le premier critère que le chapitre nomme quand il dit ce qu'un professionnel
compare : « comparer grammages, matières, coupes, tailles, couleurs et techniques ».

*Corrigé le 26 août 2026.* Ce paragraphe citait entre guillemets une phrase qui n'est
écrite nulle part dans la Bible (« le client type est un professionnel qui compare des
grammages, pas un particulier qui achète un motif ») et annonçait la première comme la
première phrase du chapitre, alors qu'elle en est le neuvième paragraphe. Le raisonnement
tenait ; la citation, non. Une paraphrase entre guillemets est une citation fausse.

Les facettes sont **un formulaire GET**, pas la navigation à facettes de WooCommerce, et
c'est une contrainte et non un goût : `WC_Query::get_layered_nav_chosen_attributes()` lit
`filter_couleur` comme une chaîne séparée par des virgules et ignore la valeur quand ce
n'est pas une chaîne, alors qu'un groupe de cases à cocher en HTML envoie soit un tableau,
soit deux fois le même nom scalaire dont PHP ne garde que le dernier. Le format natif exige
donc un script, et un catalogue dont les filtres exigent un script est un catalogue qui ne
marche pas sur une mauvaise connexion. Les clauses passent quand même par les coutures
documentées de WooCommerce (`woocommerce_product_query_tax_query`), donc rien n'est
réimplémenté.

**Les nombres à côté des cases ne mentent pas.** Chacun annonce « voilà ce qu'il reste si
vous me cochez », et il est calculé en ignorant la sélection de sa propre facette : compté
autrement, cocher « Blanc » afficherait « Blanc (37) » et tous les autres coloris à zéro, et
personne ne pourrait ajouter une seconde couleur. `npm run verify:site` coche la première
case et compte ce qui revient ; le contrôle a été cassé exprès (« annoncé 6, obtenu 5 »).

**Et le budget du chapitre 4 est mesuré, pas espéré.** Il demande moins d'une seconde.
`npm run bench:shop` relevait **176 à 211 ms** pour la page entière et **22,6 ms** pour
l'arithmétique des facettes seule, sur un miroir qui ne portait qu'un import partiel ; refaite
à l'échelle de la production avec 462 références synthétiques, l'arithmétique des facettes
tenait en **114,6 ms** pour 349 valeurs.

**Remesuré le 22 août 2026 sur le catalogue complet, ce n'est plus vrai, et il faut l'écrire.**
Le miroir porte maintenant les 459 références et leurs 26 359 déclinaisons. Sur
`/product-category/t-shirts/`, médiane de quinze requêtes à chaud, machine au repos : **2 431 ms
sans filtre**, 1 978 ms avec deux facettes, 154 ms avec trois facettes et un grammage.
L'arithmétique des facettes, elle, tient toujours : **101,7 ms**, 27 requêtes SQL, 591 valeurs
rendues, soit 4 % de la page.

**Ce n'est donc pas le panneau de filtres, et c'est mesuré aussi.** `npm run bench:theme` sur
`/shop/` donne 3 090 ms à notre thème et **2 479 ms à twentytwentyfive**, qui n'a ni facette ni
pastille : la page coûte déjà cela sans rien de ce que cette séance a construit. La catégorie
« T-shirts » ne contient d'ailleurs que douze références, donc ce n'est pas non plus la
longueur de la liste. Le coût est ailleurs, dans ce que WooCommerce fait d'un catalogue de
26 359 déclinaisons, et **nous ne l'avons pas isolé**. C'est l'entrée numéro un de la séance 13,
avec le chiffre du jour pour repère.

> **Isolé et corrigé par la séance 13**, et ce n'était pas la longueur de la liste : c'était
> `is_on_sale()`, auquel WooCommerce répond en construisant les 159 déclinaisons de chaque
> référence, avec un cache qui ne peut structurellement pas se déclencher sur un catalogue sans
> prix de vente. 807 ms par fiche, à chaque requête. Voir `docs/PERFORMANCE.md`.

**Les 442 coloris ont une couleur, et elle est mesurée.** C'était la seule chose du site que
la séance ne défendait pas : quatre cent quarante-deux noms de fabricant dans une boîte qui
défile, avec une recherche texte, alors que la couleur est le premier critère sur lequel un
acheteur professionnel resserre. On ne peut pas les fusionner (« Navy », « French Navy »,
« Deep Navy » et « Midnight » sont quatre articles) et le fournisseur n'envoie aucun code
hexadécimal. Il envoie en revanche, pour chaque coloris, un **nuancier** : un aplat de la
teinture, `sku_color_swatch_url`. Mesuré sur onze d'entre eux : de 99,2 % à 100 % du cadre
est une seule couleur, l'écart au 90e centile valant 0,0. C'est donc la couleur **déclarée**,
livrée en image plutôt qu'en texte, et c'est elle qui est publiée. La photo du vêtement est
mesurée à côté, comme contrôle indépendant et comme repli : les deux tombent à 0,012 à 0,026
l'une de l'autre en OKLab, chacune validant l'autre.

Les onze familles qui regroupent ces noms sont déduites de la couleur mesurée, **jamais du
mot**, et c'est la leçon du concurrent : chez mistertee.fr le regroupement est saisi à la
main, si bien que « Chocolat » est dans les noirs, « Émeraude » dans les bleus et « Écru »
dans aucun groupe, donc introuvable. La structure du classement est publiée (Wang, Luo et al.,
CGIV 2006, ajustée sur 2 916 nominations par dix observateurs) et ses bornes ne survivent pas
telles quelles à un vêtement : leur seuil achromatique est une chromaticité absolue, et aucune
valeur absolue ne sépare un marine mesuré à C=0,028 d'un blanc cassé mesuré à C=0,020, parce
que leurs clartés diffèrent d'un facteur trois. C'est la **saturation** qui les sépare, 0,109
contre 0,022.

**Les bornes de teinte sont ajustées sur les étiquettes du fabricant, et cela change 33
coloris.** La conversion depuis CIELAB les posait près des milieux entre les références sRGB,
et un milieu entre deux primaires n'est pas là où un nom change : l'œil appelle rgb(255,88,0)
un orange alors que sa teinte est plus proche de celle du rouge. La borne rouge/orange à 40,0
publiait donc « Orange », « T. Orange » et « Sunset Orange » comme des **rouges**, et la borne
bleu/violet à 285,0 publiait « Purple », « Violet », « Dark Purple » et « Urban Purple » comme
des **bleus**. Chaque borne est reposée sur les 300 coloris dont le nom porte un mot de
couleur sans ambiguïté : les rouges montent à 29,16 et les oranges commencent à 31,53, les
bleus montent à 276,2 et les violets commencent à 278,7, et ainsi de suite, si bien que chaque
borne tombe dans un trou entre deux populations étiquetées et que **rien** n'est mal rangé.
Une seule borne n'a pas de trou, jaune/vert, parce que la teinture fluo jaune-vert est vendue
sous les deux mots ; le jaune pur de sRGB y sert de point fixe et deux coloris restent
refusés. Le réglage a fait passer les désaccords entre le nom et la mesure de **28 à 8** sur
440 coloris, sans en casser un seul dans l'autre sens.

**Rien n'est inventé, et c'est le contrôle qui le dit.** Une couleur dont la mesure ne
converge pas n'a **pas** de pastille : elle reste dans le filtre, sous « Non mesurés », avec
son nom et ses références, parce qu'un coloris absent du filtre est une référence
inatteignable. Un dernier verrou lit le nom du fournisseur comme signal indépendant : quand
la photo dit « vert » et que l'étiquette dit « French Navy », l'un des deux est faux et on ne
sait pas lequel, donc on ne publie ni l'un ni l'autre. `docs/couleurs.json` est le relevé
commité, `npm run verify:couleurs` re-décide chaque ligne **en faisant tourner le vrai PHP**
plutôt qu'en comparant du texte, refuse toute référence fournisseur dans le fichier, et se
casse lui-même **deux fois** à chaque exécution pour prouver qu'il tire. Il lit le triplet
OKLab exact et non l'arrondi affiché : lire l'arrondi le faisait crier au loup sur « Lime » et
« Acid Lime », qui mesurent 114,972 et 114,989 et s'écrivent tous deux 115,0, de l'autre côté
d'une borne.

**Une panne réseau n'efface plus rien.** Une image qu'on n'a pas pu récupérer n'est pas une
couleur qu'on refuse, et les deux arrivaient dans la même forme : `mesurer --recommencer`
lancé pendant une coupure écrivait « photo non récupérée » sur les 442 coloris, supprimait
toutes les pastilles au passage, et la passe suivante les sautait tous pour cause de « déjà
répondu ». Le code porte désormais la différence, laisse le terme intact et compte le coloris
comme injoignable. Dans le même esprit, `couleurs reclasser` reprend la décision de famille
depuis les mesures déjà posées, en une seconde au lieu de dix-sept minutes de
retéléchargement : une borne coûteuse à appliquer est une borne qu'on n'applique pas. La méthode complète est dans
`docs/COULEURS.md` ; la question 49 demande à l'associé s'il a un nuancier officiel, qui
remplacerait la mesure sans rien changer d'autre.

**Ce que ni l'un ni l'autre concurrent ne publie, nous le dessinons.** Vérifié le 19 août
2026 : mistertee.fr détient ses zones d'impression en millimètres dans une charge utile JSON
et les chaînes « mm » et « × » apparaissent **zéro fois** dans le HTML qu'un client lit ;
tostadora.fr n'en publie aucune. L'accueil dessine la zone imprimable **à l'échelle**, à
côté d'une feuille A4, parce que « 30,5 cm » ne dit rien et « plus large qu'une feuille » dit
tout. Les rectangles viennent de `Garments::areas()`, généré depuis le studio, donc ils ne
peuvent pas diverger de ce à quoi la presse est réglée. La comparaison complète avec les deux
sites est dans `docs/CONCURRENTS.md`.

**Le devis a sa page, et un refus y revient.** Le formulaire n'est pas recopié : c'est le
gabarit du greffon, `teeshoop/product-quote.php`, rendu avec `product_id` à 0. Il y a donc
un seul jeu de champs, un seul jeton HMAC, un seul piège à robots, une seule limite par
adresse et un seul texte de confidentialité. Ce que la séance a dû ajouter, c'est le retour :
`get_permalink( 0 )` est faux, donc un prospect qui tapait mal son adresse était renvoyé à
l'accueil, sur une page qui ne porte pas le formulaire. Le champ de retour est **posté**,
donc non fiable, donc passé par `wp_validate_redirect` : une adresse étrangère au site est
refusée et le repli reprend la main (vérifié avec `retour=https://evil.example/phish`).

**Un délai est publié, et un seul.** Le délai standard apparaît sur l'accueil, dans le
pied de page, sur la page devis et sur la page entreprises, cadré « à partir de la
validation du bon à tirer » et jamais « livré le ». L'express et l'urgence restent internes,
parce que la séance 07 a mesuré 6 jours ouvrés de travail incompressible entre un bon à
tirer validé et un colis : publier une promesse qu'on a soi-même mesurée comme intenable est
une pratique commerciale trompeuse.

*Les trois chiffres étaient 12, 7 et 4 quand ce paragraphe a été écrit. La réponse à la
question 14 du 1er septembre 2026 les met à **7, 4 et 3**, et la phrase ci-dessus vaut
davantage qu'avant : l'express manque désormais de deux jours ouvrés et l'urgence de trois,
et le standard lui-même n'en garde qu'un. Les nombres ne sont plus écrits ici parce qu'ils
sont des emplacements dans la copie et une ligne du registre ; les recopier a déjà fait
mentir ce paragraphe une fois.*

**Et deux garde-fous étaient rouges depuis quatre séances.** Trouvés en les
faisant tourner, pas en lisant du code. **Trois fichiers de test de l'extension
répondaient 200 sur une URL publique** : `run.php` et `integration.php` portent
un verrou depuis la séance 04, les trois fichiers d'intégration ajoutés ensuite
ne l'ont jamais eu, parce qu'ils sont `require`és par le premier et que cela
semblait suffire. Ce n'est pas le cas : leur chemin est aussi devinable et PHP
exécute ce qu'on lui demande. Ils ne rendaient rien aujourd'hui par chance, pas
par construction.

Et surtout, **la vérification de bout en bout s'arrêtait à la caisse**. La séance
06 a ajouté la renonciation au droit de rétractation, une case obligatoire sur
les deux tunnels ; le harnais cochait `#terms` et jamais celle-là, donc le tunnel
en blocs refusait de valider, le disait en français en rouge sur la page, et
**tout ce qui suit est dans un `if ( orderId > 0 )`** : le statut de la commande,
la création qui survit à la caisse, la ligne de livraison, l'addition des totaux,
le régime de TVA gelé et toute la moitié facture étaient sautés depuis quatre
séances. La feuille de route affirmait pendant ce temps que ce chemin était
vérifié jusqu'à la facture. La cocher fait passer le harnais de 70 assertions
dont 4 en échec à **84 dont aucune**.

**Et ce que la passe adverse a trouvé sur un changement pourtant vert.** Cinq
angles, cinquante agents, chaque trouvaille réfutée avant d'être crue : 32 ont
survécu sur 45.

La plus chère est un prix. `Pricing::headline()` chiffre chaque face au **palier
de surface le moins cher**, et le même bloc de faits imprimait ce prix avec
« impression comprise » à trois tuiles de « Zone d'impression 30,5 × 40,6 cm », à
côté d'un dessin à l'échelle de cette zone entière. Cette zone est dans le palier
suivant : mesuré sur le miroir, la série de 50 pièces annoncée coûte **27,6 % de
plus** que le chiffre affiché à côté. La fiche produit a toujours imprimé la
borne au pied de sa grille ; l'accueil et la page entreprises imprimaient le prix
sans elle. `Settings::area_note()` est désormais l'unique foyer de cette phrase et
les trois pages l'appellent.

La deuxième aurait coûté une réimpression : **le dessin de la zone était figé sur
le t-shirt** pendant que le prix, le nom et le bouton suivaient le premier produit
venu. Sur une boutique dont le premier vêtement personnalisable est un sweat, la
page proposait un sweat, au prix d'un sweat, à côté des 30,5 × 40,6 cm d'un
t-shirt.

Et **une seule requête GET non authentifiée mettait tout le site en 500** :
`?f_couleur[][]=x` met un tableau dans le tableau, `sanitize_title()` est fatale
sur un tableau en PHP 8, et `applied_filters()` est aussi atteinte depuis
`wp_robots` et `body_class`. L'accueil, la page devis, une fiche produit et la
boutique répondaient toutes 500.

Deux des garde-fous étaient eux-mêmes faibles : `palette-guard` laissait tomber
en silence tout rôle dont l'expression régulière ne trouvait rien, donc renommer
`--accent` sur le bon à tirer l'aurait sorti de la comparaison ; et le
« rien n'a été mesuré » de `shop-bench` testait la longueur d'un littéral de trois
entrées, donc il était injoignable. Les deux ont été cassés exprès pour prouver
qu'ils tirent.

**Et la marque est un jeu de jetons, pas un dessin.** La question 31 n'a pas de réponse et
un logo ne se défaut pas : le thème déclare le support `custom-logo` de WordPress et, tant
qu'aucun fichier n'y est déposé, rend le **nom** du site en toutes lettres. La couleur et la
typographie sont extraites de ce que le site utilise déjà. Déposer les vrais éléments en
séance 13b sera un envoi dans le personnalisateur et un fichier de jetons, pas une refonte.

**L'aperçu 3D est devenu une photo de vêtement.** Le brief disait « c'est laid et
irréaliste », ce qui n'est pas actionnable. Huit lectures indépendantes du code et une série
de rendus aux cadrages que le client voit vraiment ont donné une liste de défauts chiffrés,
et un nouveau contrôle, `scripts/render-verify.mjs`, mesure chacun d'eux sur le vrai paquet
dans un vrai navigateur : cadrage, centrage, présence d'une ombre au sol, lisibilité du
contour, tenue des ombres portées, fidélité du blanc, et reproductibilité. Il échouait
**25 fois** sur l'arbre livré. C'est le premier contrôle du dépôt qui regarde une image :
tous les autres mesurent de la géométrie, et c'est précisément là que ces défauts vivaient.

**Le premier défaut n'était pas l'éclairage, c'était un cadrage qui ne regardait pas le
vêtement.** La caméra encadrait le gabarit `{28 po, 24 po}` posé au démarrage, jamais la
mesure du maillage : le sweat était vu de 67,9 po quand sa propre mesure en demande 123,0,
et sa silhouette remplissait le volet 832×900 en touchant les quatre bords. La mesure
partait du vêtement (qui vit dans la racine React de react-three-fiber) vers un état React
de la racine DOM et revenait ; ce trajet perdait, et pas de façon reproductible : la même
sonde sur le même arbre a rendu le gabarit une fois et la mesure la fois suivante, selon la
charge de la machine. Elle vit maintenant dans une boîte relue à chaque image, sans
ordonnanceur entre celui qui écrit et ceux qui lisent. Mesuré : t-shirt 77,03 po, sweat
123,03 po, demandé = appliqué dans les deux cas.

**Le vêtement ne posait sur rien, et pourtant le porte-ombre était là depuis le début.**
Aucun rendu du dépôt ne contenait un seul pixel d'ombre. Le rig était monté et dans le
cadre : il assombrit ce qui est dessous, et dessous il y avait un canevas transparent sur
une page #0c0f13. Du noir sur du noir ne fait rien. Il y a maintenant un vrai sol par scène,
éclairé par le même rig, dont le bord est un dégradé d'alpha et non une géométrie (un disque
qui s'arrête dans le cadre trace un horizon en travers de la taille du vêtement). Mesuré sur
le t-shirt noir : **9 676 pixels d'ombre, 24,6 niveaux de profondeur**, contre 0 avant. (Ce
paragraphe a d'abord porté 10 034 et 23, mesurés à mi-parcours et jamais repris après le
commit qui a changé l'éclairage. Les chiffres ci-dessus sont ceux du dernier balayage.)

**Un t-shirt noir était plus sombre que la page derrière lui.** Le pas de luminance à travers
la silhouette valait **0,2 niveau sur 255** au cinquième centile des rangées : la moitié du
contour n'existait pas. Un t-shirt blanc sur la plage mesurait 0,0, et un rouge dans le studio
6,6.

*Deux précautions sur ces chiffres-là, parce qu'ils portent le titre du paragraphe.* La
première : le contrôle mesure aujourd'hui la MÉDIANE des rangées et l'avant ne la contient pas
du tout, parce que l'instrument ne la calculait pas encore (le fichier
`.qa/render-before/render-verify.json` n'a pas de champ `edgeP50`). « 0,2 avant, au moins 12
de médiane après » compare donc deux statistiques différentes ; sur la même, le cinquième
centile du t-shirt noir passe de 0,21 à 2,23. La seconde : l'instrument lui-même a été corrigé
quatre fois APRÈS ce relevé (attente sur le compteur d'images au lieu d'un sommeil de 350 ms,
prédicat d'immobilité qui était vrai avant d'être posé, `some` au lieu de `every` sur le garde
d'étiquetage, écart à la page en valeur absolue au lieu de signé), et l'un de ces défauts
faisait mesurer le SOL à la place du vêtement. Les relevés d'avant sont donc indicatifs et pas
comparables au chiffre près. Ce qui reste solide, parce qu'aucun de ces défauts ne peut le
produire : zéro pixel d'ombre (le défaut d'instrument aurait gonflé ce compte, pas mis à zéro),
le blanc à (205,198,192), et la distance de caméra lue dans la sonde de pose et non dans des
pixels. Refaire l'avant avec l'instrument d'aujourd'hui est impossible sans lui porter le
correctif : il a besoin de sondes (`__stage.show`, le compteur d'images) que l'arbre d'avant
n'a pas. Trois choses le corrigent, et
deux relèvent de la photographie plutôt que du code : une lumière de séparation derrière le
vêtement dans chacune des six scènes, un remplissage hémisphérique dans les deux scènes qui
n'en avaient pas (`studio` et `city`, alors que le champ existait et que son commentaire dit
exactement à quoi il sert), et un lobe de duvet assez large pour exister. C'est le duvet qui
fait le travail sur un vêtement foncé : un terme spéculaire ne dépend pas de la teinture,
donc il est aussi clair sur un noir que sur un blanc.

**Le blanc était un gris chaud à 58 %.** Mesuré (205,198,192) là où le client avait choisi
#FFFFFF : la grande boîte à lumière du studio était crème (#fff6ec) et rien ne la compensait.
Elle est neutre. Mesuré après : **(215,216,219)**, quatre niveaux d'écart entre les canaux,
pour une limite de douze. (Là encore, la première rédaction citait (209,208,208), pris avant
la fin du réglage.)

**L'encre est posée DANS le tissu, plus dessus.** Trois défauts mesurés. Chaque bord de
visuel portait un liseré plus sombre que l'encre ET que le textile (5 787 pixels jusqu'à
162 niveaux sous leurs voisins), parce que le filtrage d'une texture à alpha droit interpole
la couleur vers le noir ; la texture est maintenant prémultipliée et le nuanceur défait la
prémultiplication, ce qui est la seule combinaison correcte des deux côtés. L'encre ne
suivait pas l'exposition de la scène, donc elle brillait la nuit. Et un transfert n'avait
aucune épaisseur, alors qu'un film DTF fait 0,1 à 0,2 mm et que c'est ce filet de lumière sur
la tranche qui dit « imprimé ». La manche et le décalque de repli, qui n'avaient reçu ni
ombre ni relief ni occlusion depuis que le panneau avant en avait, passent par le même
traitement.

**Le vêtement ne flotte plus.** Il pendait dans un `<Float>` dont la phase était tirée au
hasard à chaque montage : aucune comparaison avant/après du dépôt n'a donc jamais comparé
deux images comparables, et aucun mockup ne pouvait être produit deux fois. Retiré.
`scripts/mockup-shots.mjs` rend les images qu'une fiche produit, un bon à tirer et un e-mail
demandent (avant, trois-quarts, dos, à 1 200 × 1 500), puis rend la première une seconde fois
et compare les octets.

**Deux assertions restent rouges, et c'est la même mesure.** `npm run verify:render`
passe 53 de ses 55 contrôles. Les deux qui échouent disent la même chose : une image prise
TARD dans un balayage rend environ 2 % plus sombre que le même cas rendu seul. Le t-shirt
noir en scène `night` mesure 27 de luminance médiane quand son cas tourne seul et 24 dans le
balayage, ce qui le fait passer sous les 8 niveaux d'écart exigés avec la page ; et le
t-shirt blanc, capturé une seconde fois à la fin du balayage, rend 212 contre 216 la
première fois, cadrage identique au pixel près. Ce n'est ni la cuisson de la carte d'environnement (le
contrôle attend maintenant huit images dessinées), ni la pose (les deux boîtes englobantes
sont identiques).

**RÉSOLU À MOITIÉ, ET L'AUTRE MOITIÉ N'ÉTAIT PAS UNE DÉRIVE.** Balayage complet du
26/08/2026 (`.qa/render-s2`, 15 prises, 2 h 20) : **73 contrôles verts, 1 rouge**.

Le contrôle de déterminisme lit maintenant **216,07 contre 216,07, écart 0,00**, là où il
lisait 216 puis 212. C'était la fuite du sélecteur de scènes (voir plus bas) : elle est
fermée, et cette moitié-là est réglée.

L'autre moitié n'a jamais été une dérive. Comparé au balayage de la séance précédente,
**chaque cas rend le même chiffre à la décimale près**, y compris `tee-black-night` (23,68 de
médiane, 23 821 pixels d'ombre, 22,4 de marche de contour, identique des deux côtés). Le seul
cas qui a bougé est `hoodie-black-34`, et il a bougé exactement de ce que la séance lui a
fait : le duvet ramené de 0,7 / 0,84 à 0,45 / 0,95, médiane 46,9 -> 37,9 et contour
36,4 -> 22,3 niveaux, toujours au-dessus des 12 exigés.

Donc `tee-black-night` ne dérive pas : il rend **23,68 dans un balayage et 26,82 seul**, de
façon stable et reproductible, à travers deux séances et un changement de code. Ce n'est pas
de l'état qui s'accumule au hasard, c'est une dépendance déterministe à ce qui a tourné
avant. Et l'appeler « 2 % » était faux : 23,68 contre 26,82 fait 12 %. Les 2 %, c'étaient les
216 contre 212, et ceux-là sont réglés.

Ce qui reste rouge se lit aussi comme une observation produit, pas seulement de harnais : un
t-shirt noir dans la scène `night` se détache de son fond de **7,7 niveaux** (23,68 contre
16,02) là où le contrôle en demande 8. Seul, il en fait 10,8. Dans les deux cas c'est peu :
un vêtement sombre sur un fond sombre est difficile à voir, et la réponse est peut-être
d'éclairer la scène ou de poser un contre-jour, pas de bouger le seuil.

**Et le 25/08/2026 on a d'abord éliminé la relecture du tampon de dessin.**
`RENDER_DOUBLE=1` a enfin tourné, sur `tee-white-34` et `tee-black-night`. Trois relectures
de trois images que personne n'avait touchées entre les deux sont revenues **identiques**.
Sur ce balayage court le contrôle de déterminisme mesure un écart de **0,00**, là où le
balayage complet lit 216 puis 212 ; et `tee-black-night` y lit **27**, sa valeur « seul »,
pas le 24 qu'il lit en cinquième position du balayage complet.

Le défaut est donc de l'état qui survit d'un cas au suivant. **La sonde a été écrite et
elle a démenti l'hypothèse qu'elle devait tester.** L'idée était que le coupable était le
changement de vêtement (`hoodie-black-34` est juste avant `tee-black-night`, et les trois
prises du balayage court montaient le MÊME vêtement). Mesuré : un changement de vêtement
rend au contraire chaque compteur exactement à sa valeur de départ. Ce qui fuyait était le
changement de SCÈNE, décrit dans la section suivante ; le corriger a réglé la moitié
« déterminisme » et n'a pas bougé `tee-black-night` d'une décimale. Il reste donc une
dépendance à l'ordre du balayage sur ce seul cas, et sa cause n'est pas identifiée.

Le seuil n'a pas été baissé pour faire verdir : un contrôle vert auquel on ne croit pas vaut
moins qu'un rouge qu'on sait expliquer.

Ce que le contrôle affirme, et qui passe : aucun vêtement n'est coupé ni collé à un bord,
tous sont centrés à 0,1 % près, chacun pose une ombre sur quelque chose (9 400 à 38 500
pixels selon la scène), le contour se lit partout à au moins 12 niveaux de médiane, la maille
garde ses nuances (59 niveaux du 5e au 99e centile sur un noir, 88 sur un blanc), un blanc
lit blanc et neutre, et une teinte neutre reste neutre.

### Le sélecteur de scènes fuyait de la mémoire graphique à chaque clic

Trouvé en cherchant autre chose : la sonde écrite pour savoir quel état survivait d'un cas de
`render-verify` au suivant a démenti l'hypothèse qu'elle devait tester (changer de vêtement
ne laisse rien derrière, les compteurs reviennent au chiffre près) et en a trouvé une autre.

**Mesuré sur 18 changements de scène, avant correction** : le graphe de scène ATTEIGNABLE ne
bouge jamais (5 géométries, 5 matériaux, 6 textures) pendant que l'allocation du moteur de
rendu monte de **13 à 67 textures, exactement +3 par changement, sans plafond**. Un client
qui parcourt le sélecteur paie cela à chaque clic, sur son téléphone, et aucune capture d'une
image isolée ne peut le voir.

Deux causes, toutes deux fermées.

1. `<SceneEnvironment key={scene}>` remontait le `<Environment>` de drei. three r185 n'attache
   son écouteur `onPMREMDispose` que sur l'une des deux branches de `WebGLCubeUVMaps`, et un
   environnement `frames={1}` a déjà rendu dans sa cible cube à ce moment-là : il prend
   l'autre branche, aucun écouteur n'est posé, drei appelle `fbo.dispose()` correctement et
   personne n'écoute. La clé est retirée et les softbox sont mémoïsées sur `config`, qui est
   la constante `SCENES[id].three` : drei recuit dans la MÊME cible et three régénère le PMREM
   sur place, ce pour quoi ce chemin existe.
2. `<ContactShadows>` de drei mémoïse deux cibles de rendu, une géométrie et trois matériaux
   sur `[resolution, width, height, scale, color]` et n'en libère aucun. Notre teinte d'ombre
   par scène était dans cette liste. C'était le dernier terme variable, et la note laissée par
   la séance précédente nommait déjà le remède : sortir `color` de la liste et teinter après
   le montage. C'est exactement équivalent et pas approximativement : drei écrit
   `ucolor * z * 2` dans la cible, le maillage visible est un `meshBasicMaterial` dont le rgb
   vaut `map.rgb * color`, donc épingler `ucolor` en blanc et poser la teinte sur le matériau
   donne le même pixel, pour une allocation au lieu d'une par clic.

**Après** : 13 textures, plates sur 18 changements, et l'identifiant de la texture
d'environnement ne bouge plus.

Le nouveau contrôle `npm run verify:leak` garde les deux, **et il garde aussi le contraire**.
Une correction qui aurait arrêté la croissance en gelant l'environnement serait pire que la
fuite : chaque scène rendrait avec la lumière de la première et tous les autres contrôles
passeraient quand même. Il exige donc que les six scènes éclairent différemment et que
chacune revienne à la même image à chaque visite. Mesuré : nuit 35,4/46,6/78,4 ·
studio 50,3/53,8/61,3 · coucher 97,1/42,4/35,3 · plage 147,6/136,1/110,5 ·
forêt 39,9/52,5/28,2 · ville 68,1/75,6/86,0, identiques aux trois passages.

Sa sortie d'échec a été prouvée atteignable : arbre cassé exprès (les deux causes remises),
`rc=3` et le message reproduit la mesure d'origine (16 -> 67, +3,0 par changement) ; arbre
corrigé, `rc=0`.

**Ce que coûte une image, mesuré.** `scripts/frame-bench.mjs` ne prétend pas mesurer un
téléphone et le dit dans son propre en-tête : il n'y a pas de carte graphique de téléphone
sur cette machine, chromium passe par un rastériseur logiciel, et une milliseconde mesurée
là ne dit rien d'un Mali ni d'un Adreno. Ce qui voyage, ce sont **21 appels de dessin et
234 594 triangles** pour un t-shirt, **811 698** pour un sweat, et 11 programmes. Sur ce
rastériseur, le profil téléphone (bridage processeur ×4, 2,75× de pixels physiques, carte
d'ombre 1024 au lieu de 2048, pas de MSAA) coûte 2,4× et 2,0× le profil bureau, ce qui veut
dire que les coupes portent à peu près la moitié de ce que le bridage ajoute. Le volet
principal n'avait aucun profil mobile, alors que la vue panier en avait un depuis toujours.

**Et la création du client apparaît enfin là où il la cherche.** L'aperçu aplati était
déposé sur R2 et gelé sur la ligne de commande depuis la séance 01, et **rien ne le relisait
sauf le bon à tirer** : dans le panier, au paiement, sur la page de confirmation, dans
l'e-mail et dans l'historique du compte, l'acheteur voyait la photo fournisseur d'un vêtement
vierge. Deux filtres WooCommerce, aucun prix, aucune donnée de production. Le bon à tirer,
lui, montrait un vêtement en taille L pendant que chaque cote imprimée à côté était donnée
pour du M ; il est rendu à la taille dont il parle.

**Le réglage qui a sauvé le t-shirt avait abîmé le sweat.** Le duvet du t-shirt est passé de
0,32 à 0,62 avec un lobe resserré (rugosité 0,93 à 0,82) parce que son contour mesurait 0,2
niveau sur 255 : il n'existait pas, et un terme spéculaire est le seul qui ne dépend pas de
la teinture. Le même réglage a été appliqué au sweat, qui n'avait pas ce problème : dans le
même balayage son contour mesure 36,4 niveaux, le meilleur de toute la série, parce que ses
plis sont de la vraie géométrie et que les deux lumières de séparation les accrochent. Ce
qu'on a acheté avec ce duvet-là, on l'avait déjà ; ce qu'on a payé, c'est l'image : sur un
sweat noir le lobe devenait un large reflet dur le long de chaque manche et en travers de la
capuche, qui lit comme du vinyle enduit et pas comme du molleton gratté. Le molleton est le
tissu le plus rugueux du catalogue et son lobe doit être le plus large, pas le plus serré.
Retour à 0,45 / 0,95, avec le contour re-mesuré et non supposé.

Aucun contrôle ne l'avait vu, et c'est instructif : le contrôle qui parle de la matière
demande que la maille garde des nuances (99e centile moins 5e centile au-dessus de 30
niveaux), or un vêtement brillant en a PLUS qu'un vêtement mat, pas moins. Une mesure de
« la lumière varie-t-elle sur ce tissu » ne sait pas dire « elle varie comme du plastique ».
La seule chose qui l'a attrapé, c'est d'avoir regardé l'image.

**Le panier en 3D avait le même défaut que l'aperçu, et il l'a gardé un jour de plus.** Le
plateau (`src/three/Board3D.tsx`), c'est-à-dire le panier vu comme une grille de vêtements,
lit la même configuration de scène que l'aperçu : il a donc hérité de la nuit remontée et des
remplissages hémisphériques, sans les deux lumières de séparation ni le sol contre lesquels
cette remontée avait été calibrée. Il avait aussi, depuis toujours, un porte-ombre monté sur
un canevas transparent, c'est-à-dire du noir sur du noir, exactement le défaut nommé plus
haut. La mission parlait de trois endroits où l'aperçu est regardé et le panier en est un.
Il a maintenant les mêmes lumières et le même sol, et son encre reçoit le même relief de
tissu que l'aperçu, ce que le message de commit affirmait déjà et que le code ne faisait pas.

**L'état d'avancement des mesures vit dans `docs/seance-10-a-reprendre.md`** : ce qui est
vert, ce qui n'a pas été lancé, pourquoi, et la commande exacte pour finir. La machine a
été arrêtée en cours de balayage le 25/08 (la rastérisation logicielle avait poussé le
swap à 1,6 Gio sur 2,0 et faisait tomber les autres sessions en SIGSEGV).

**À quelle distance de la photo, et ce que coûte le reste : `docs/realisme-3d-etat.md`.**
Le brief demandait cette réponse en toutes lettres et elle a sa propre page plutôt qu'un
paragraphe ici, parce qu'elle est la seule chose de cette séance qui sert à décider quelque
chose : elle chiffre ce que contient le « retarget de maillage sur patron déplié », et elle
tranche la question que le brief posait, à savoir si c'est la seule vraie correction (non
pour vendre, oui pour la photo).

**Ce que la séance 10 n'a pas fait, et qui reste ouvert.** La ligne du tableau plus bas ne
dit plus « faite » : ce qui est fait, mesuré et gardé, c'est l'aperçu 3D d'un vêtement du
catalogue. Le reste de la liste du brief est ouvert et vaut la peine d'être écrit plutôt que
classé.

- **La vue « détail » existe maintenant, la vue « porté » non, et c'est un refus motivé.**
  Le brief demandait quatre images par vêtement : avant, dos, détail, et porté « si nous
  avons un avatar assez bon ». L'avatar existe et il n'est pas assez bon : il ne se décline
  pas en tailles, parce que le corps et le vêtement sont un seul maillage cuit
  (`src/lib/arExport.ts`, LIMITE CONNUE). Une photo portée montrerait donc un visuel dont
  la taille par rapport au vêtement est fausse, sur une boutique où la taille d'impression
  est un engagement facturé et imprimé. Une image qui ment sur le produit vaut moins que pas
  d'image. La question produit (mannequin photographié, ou avatar décliné par taille) est la
  Q52.
- **Les mockups ne sont encore relus par personne.** `scripts/mockup-shots.mjs` produit un
  jeu déterministe, en imprimé et en vierge ; ce que le panier, le bon à tirer et les e-mails
  affichent reste l'aperçu plat de `renderMockup`, déposé sur R2 à la commande. Brancher le
  rendu 3D dessus n'est pas un raccord : une image de fiche produit est par vêtement et peut
  être rendue d'avance, une image de BAT est par création et ne peut être rendue que dans le
  navigateur du client, au moment de la commande, où three.js est un morceau paresseux de
  1,1 Mo que le brief interdit de rendre gourmand. Et un BAT n'a peut-être pas à être un
  rendu 3D du tout : c'est un bon à tirer, il doit montrer des cotes, pas une ambiance.
- **`src/app/ScenePicker.tsx` n'a pas été ouvert.** Les six scènes ont été refaites, le
  sélecteur qui permet d'en changer date d'avant. Aucun « préréglage » nouveau n'a été
  ajouté : l'item 4 a été lu comme « améliorer les six scènes existantes ». Si un préréglage
  au sens propre est voulu (une scène plus un cadrage, enregistrés ensemble), c'est du
  produit et cela se décide.
- **Une assertion de `render-verify` reste rouge, et ce n'est pas la dérive.** Le balayage
  complet du 26/08/2026 donne 73 verts et 1 rouge. Le rouge est `tee-black-night` : le
  t-shirt lit 23,68 de médiane contre 16,02 pour la page, soit 7,66 niveaux d'écart là où le
  contrôle en demande 8. Il est stable à la décimale à travers deux séances et un changement
  de code, donc reproductible et non dérivant. Les deux rouges d'avant étaient celui-là plus
  le déterminisme (216 puis 212), et le déterminisme est réglé : c'était la fuite du
  sélecteur de scènes, il lit maintenant 0,00. Ce qui reste à décider est un arbitrage
  produit et il est posé à l'associé (Q53).
- **Le liseré d'encre n'est toujours pas sous contrôle chiffré.** La correction
  (prémultiplication, division, décodage) est de l'arithmétique démontrable, mais la mire de
  calibrage cerne ses propres lettres d'un trait noir, donc le compteur de liseré compte ce
  trait autant que le défaut. Il est imprimé et pas gardé, ce qui est honnête et insuffisant :
  ce qu'il faut est une mire à bords francs sans noir à elle.
- **Sur un vêtement envoyé par le client, l'encre ne peut PAS avoir de tranche de film**, et
  c'est inhérent : son visuel est composé en 2D dans la photo du vêtement avant d'arriver en
  3D (`renderMockup`), donc il n'existe pas comme couche séparée à éclairer. Pour la même
  raison le liseré d'alpha droit ne l'atteint pas non plus : à l'intérieur du vêtement la
  photo est opaque. Ce n'est pas un drapeau oublié, c'est la conséquence du chemin, et cela
  vaut d'être écrit avant que quelqu'un « corrige » les quatre appels concernés.
- **Le sélecteur de scène est un `listbox` en ARIA et pas en comportement** : pas de flèches,
  pas de `tabindex` glissant, le focus n'entre pas dans la liste et ne revient pas au bouton.
  C'est de la dette d'avant la séance et elle appartient à la séance 12 (accessibilité).
  **La séance 12 ne l'a pas prise** : elle a traité le parcours d'achat, où l'argent
  change de main, et le sélecteur de scène est dans le studio. **La séance 13 les a
  prises toutes les deux**, lui et la `Modal` du studio qui posait `aria-modal="true"`
  sans piège de focus. Les deux sont mesurées au clavier dans un vrai navigateur par
  `npm run verify:focus`, 15 assertions, cassées exprès une fois pour prouver qu'elles
  peuvent échouer.
- **Le balayage `render-verify` reste lent et hors CI** (quelques minutes par cas sous
  rendu logiciel), donc il ne protège rien automatiquement : il faut le lancer.
- **Un bouton de vue sur trois ne faisait rien, et personne ne l'avait vu.** Mesuré avec la
  sonde de pose : en chargeant `/dev/three.html?g=tee&v=front` et en attendant que le
  cadrage soit posé, la caméra restait à l'azimut -0,638, c'est-à-dire au trois-quarts de
  départ, le vêtement mesuré et l'ajustement appliqué ; un premier appel scripté à
  `setView('front')` la mettait bien à 0 ; et le SUIVANT, trois secondes plus tard, ne la
  bougeait plus du tout. Une demande sur trois arrivait. C'est la même couture que le défaut
  de cadrage corrigé plus haut, dans l'autre sens : la demande est un état de la racine React
  du DOM et le rig vit dans celle de react-three-fiber, et une mise à jour qui traverse
  dépend de deux ordonnanceurs. Même réparation : une boîte écrite au rendu, relue à chaque
  image. Mesuré après : `?v=front` donne 0, et `setView('back')` donne -3,142. Cela touchait
  le client directement, les trois boutons de vue du studio passent par là.
- **Les planches de contrôle légendaient des images prises en cours de mouvement.**
  `scripts/3d-shots.mjs` attendait 2 500 ms après « ready » puis capturait ; sous rendu
  logiciel l'amortissement du pivot n'est pas arrivé dans ce délai. Mesuré :
  `tee-white-front.png` était un trois-quarts à demi tourné, et pour le sweat comme pour le
  vêtement envoyé la vue « avant » et la vue « trois-quarts » sortaient **identiques à
  l'octet près**. Le script demande maintenant au rig s'il est arrivé au lieu de regarder
  l'horloge. C'est le même défaut que les quatre corrigés dans le contrôle de rendu : attendre
  une durée au lieu d'attendre un signal.

**Se faire trouver (séance 11).** Le site existait et ne disait rien à un moteur de
recherche. Quatre défauts ont été trouvés en interrogeant le miroir plutôt qu'en relisant le
code, et deux sont graves.

**Le plan de site omettait T-shirts**, c'est-à-dire la plus grosse catégorie de la boutique,
184 références, et la page que toute la séance existe pour classer. Le fournisseur de plan de
site de WordPress filtre sur `hide_empty`, donc sur la colonne brute `wp_term_taxonomy.count`,
et WooCommerce y compte les produits rattachés **directement** au terme. Notre import rattache
presque tout à la feuille : `t-shirts` porte 0 en brut contre 139 chez son enfant. Le plan de
site publiait en revanche `uncategorized` et trois enfants quasi identiques à leur parent.
`inc/filters.php` documentait déjà cette colonne comme non fiable et la contournait pour les
facettes ; le plan de site, lui, lui faisait confiance.

*Corrigé le 26 août, après la passe adverse :* le premier message de commit et le premier
commentaire disaient « T-shirts **et Polos** ». C'est faux, `polos` porte 2 en brut et 2 est
au-dessus de zéro, donc il était au plan de site. Le défaut et sa gravité ne changent pas ;
la phrase, si.

**460 des 463 fiches produit n'émettaient aucune donnée structurée.**
`WC_Structured_Data::generate_product_data()` se termine par
`if ( empty( aggregateRating ) && empty( offers ) && empty( review ) ) return;`. Une référence
importée n'a ni prix publié (questions 41 et 42), ni note, ni avis : WooCommerce sortait avant
d'émettre quoi que ce soit, et avant d'appliquer le filtre que `ProductPage` enregistre
justement pour que le prix lu par une machine soit le prix lu par un humain. Nous émettons
désormais le nœud `Product` nous-mêmes, **sans clé `offers`**, parce qu'il n'y a pas de prix à
annoncer et qu'un prix annoncé est une offre de vente en France.

**Aucune archive ne portait de canonical.** `rel_canonical()` de WordPress ne se déclenche que
sur `is_singular()`, donc `?orderby=price`, `?paged=2`, `?utm_source=x` et `/page/1/` étaient
quatre copies indexables de chaque liste. `/page/1/` servait les mêmes 28 produits que la
racine de la catégorie, à l'octet près, et la flèche « précédent » de la page 2 pointait
dessus.

**Et la règle qu'il est facile de prendre à l'envers : une page en `noindex` n'imprime aucun
canonical.** Les deux consignes se contredisent et le `noindex` peut voyager le long du
canonical. Chaque liste filtrée est en `noindex` et aurait pointé vers sa catégorie, donc les
filtres auraient pu désindexer les pages qu'ils desservent. Ce n'est pas théorique :
mistertee.fr sert aujourd'hui les deux consignes ensemble sur ses URL de facette. `Seo` ne
décide pas qui est en `noindex`, il **observe** le tableau `wp_robots` final à `PHP_INT_MAX`.

**Les pages qui se classent ne sont presque jamais des pages catégorie**, et c'est mesuré :
sur douze requêtes relevées, la page d'atterrissage construite pour l'intention en gagne sept,
la catégorie trois, l'éditorial deux. Six pages de secteur et un guide ont donc été écrits,
avec la copie de catégorie, **sous** la grille produits parce que cinq concurrents sur cinq y
mettent la leur (0 à 145 mots au-dessus, 809 à 3 239 en dessous).

**Aucun chiffre de cette copie n'est écrit dans la copie.** Chaque montant, chaque délai et
chaque dimension est un emplacement que `Content::fill()` résout depuis l'autorité de prix, le
calendrier de l'atelier et la géométrie du studio, et **une phrase dont l'emplacement ne se
résout pas est supprimée** plutôt que rendue à zéro.

**Et l'écriture de cette copie a trouvé une erreur dans notre propre documentation.** Un
brouillon affirmait que la remise par quantité porte sur le panier entier, en reprenant
`docs/CONCURRENTS.md`, qui écrivait « c'est aussi ce que fait `Pricing` ». C'est faux :
`Cart::recalculate()` demande un prix référence par référence, avec la quantité de cette
ligne. Vingt t-shirts et dix polos n'atteignent pas le palier de trente. Le minimum, lui,
porte bien sur le panier entier. Le document est corrigé, la copie dit ce que le code fait, et
c'est la **question 54**.

**Le consentement est un formulaire, sans une ligne de JavaScript.** Mesuré au bocal à
cookies : une première visite ne dépose rien, « Tout refuser » enregistre le refus et supprime
le traceur dans la même réponse, et le traceur n'est écrit qu'à la requête suivant une
acceptation. Les deux boutons sont une seule règle CSS employée deux fois, donc ils ne peuvent
pas diverger, et « refuser » est écrit en premier.

**Et la passe adverse a trouvé dix-neuf choses sur cette séance, dont six qui comptent.** Le
formulaire de consentement acceptait au nom de n'importe quel visiteur : le jeton WordPress
est le même pour tous les anonymes et il est imprimé dans le pied de chaque page, donc un
formulaire auto-soumis depuis n'importe quel domaine suffisait. C'est l'origine qui refuse
désormais, comparée entière, et une requête sans origine est refusée aussi. **238 des 456
références publiaient une composition amputée d'une fibre** (« 50% polyester, 25% coton, 25%
viscose » devenait « 50% polyester ») parce que la coupe se faisait à la première virgule.
L'écran Tunnel comptait le total brut d'une commande remboursée et comptait comme commandes
les brouillons que le tunnel de paiement crée quand un visiteur touche le formulaire.
`/page/1/` pouvait se rediriger vers lui-même à l'infini. Le nombre de références publié
additionnait « Uncategorized » et se contredisait dans la phrase qui le détaillait. Et
**l'attribution ne fonctionnait pas** : elle était lue à la requête suivant le consentement,
quand le référent est déjà le nôtre.

**Les adresses sont passées en français, et c'était maintenant ou jamais.** WooCommerce
servait `/product-category/t-shirts/` et `/product/{slug}/` sur une boutique qui ne vend
qu'en France ; ce sont désormais `/categorie/` et `/produit/`, posées par
`wp teeshoop provisionner`. Ces adresses ne désignent aujourd'hui que les 44 produits de
démonstration que la question 20 demande de supprimer, aucune URL du vrai catalogue n'existe
en production, et après la mise en ligne le même changement coûterait 463 redirections. Les
anciennes bases répondent 301, chaîne de requête comprise, et seulement sur une 404 :
WordPress redirige la base produit tout seul, il ne redirige pas la base catégorie, et
`/product-category/tout/` est justement la seule catégorie que le site en ligne sert.

Le **slug de la page boutique** ne bouge toujours pas, et c'est la même règle lue à l'envers :
`wp_old_slug_redirect()` ne redirige jamais une PAGE renommée, elle 404.

**Et les 26 392 déclinaisons, qui sont le vrai piège d'un WooCommerce.** Chaque référence
s'adresse aussi par ses attributs. La politique est : indexable, et canonique vers l'URL
propre du produit, jamais `noindex`, qui contredirait le canonical. Le noyau le fait déjà ;
c'est désormais asserté sur une vraie déclinaison plutôt que supposé.

**Deux lectures d'un même délai, et c'est à l'associé de trancher.** Le site publie 12 jours
ouvrés jusqu'à l'expédition, plus 2 jours d'acheminement, soit 14 annoncés. Le calendrier de
l'atelier (`Production::feasibility()`) retire les 2 jours des 12 et planifie pour que le
colis soit remis au douzième jour. Les deux vont dans le sens prudent, ce ne sont pas la même
promesse, et c'est la question 14.

**Le tunnel se compte sur des enregistrements et non sur un traceur** : une demande de devis
est un article avec un statut, une commande est une commande avec un total. Aucune permission
n'est nécessaire pour les compter, et cela coûte une requête par rapport plutôt qu'une
écriture par page vue.

---

## Séance 13 : performance, sécurité, supervision

Le détail vit dans quatre documents : `docs/PERFORMANCE.md` (les mesures), `docs/SECURITE.md`
(la passe adverse, y compris ce qui a tenu), `docs/EXPLOITATION.md` (sauvegardes et veille) et
`docs/seance-13-a-reprendre.md` (ce qui reste ouvert, et pourquoi).

**Elle a commencé par mesurer, et le premier chiffre était une panne.** Six types de page à
375 px, en 4G lente (1,6 Mbit/s, 150 ms de latence), processeur au quart, cache froid, cinq
chargements et la médiane. La page catégorie répondait en **15 896 ms**. L'instrument est
enregistré dans les deux relevés (`docs/perf/cwv-avant.json` et `cwv-apres.json`) pour que deux
lectures restent comparables ; c'est la règle que ce projet s'est déjà donnée après avoir
publié une accélération qui était un changement d'instrument.

| Page | LCP avant | LCP après | |
|---|---:|---:|---|
| Catégorie (139 références) | 15 896 ms | **1 620 ms** | -90 % |
| Catégorie, deux facettes | 14 376 ms | 1 212 ms | -92 % |
| Fiche produit | 4 280 ms | 1 036 ms | -76 % |
| Accueil | 1 936 ms | 744 ms | -62 % |
| Panier | 4 468 ms | 3 308 ms | -26 % |
| Commander | 6 900 ms | 3 720 ms | -46 % |

**Deux causes portaient presque tout, et les deux étaient invisibles depuis le code.** La
boucle produits demandait à chaque référence variable si elle était en promotion, ce à quoi
WooCommerce répond en construisant ses 159 déclinaisons, et son propre cache **ne peut
structurellement pas** se déclencher sur un catalogue sans prix de vente : 807 ms par fiche, à
chaque requête, pour toujours. `Listing.php` répond désormais par une seule requête SQL, sur un
**sur-ensemble** des déclinaisons visibles, parce que la seule direction fausse serait d'oublier
un prix. Et il n'y avait aucun cache objet : **5 698 transients** étaient lus dans `wp_options` à
chaque requête. Les comptes de requêtes SQL, déterministes là où le TTFB d'un docker ne l'est
pas, passent de 69 à 10 sur l'accueil, de 130 à 19 sur la catégorie et de 99 à 14 sur la fiche.

**Le studio ne coûte pas ce que le document parent déclare**, et c'est une propriété des
iframes plutôt qu'un défaut : un document ne voit pas les requêtes d'une iframe d'une autre
origine. Compté au niveau du navigateur, l'ouverture du personnalisateur coûte 45 requêtes et
653 ko, dont 405 dans l'iframe, là où le parent n'en rapportait que 247. Au passage, l'iframe
n'est pas différée malgré son `loading="lazy"`.

**La passe adverse publie ce qui a tenu autant que ce qui n'a pas tenu.** Six surfaces, 75
attaques repoussées, 5 trouvailles confirmées, chacune rejouée à la main contre un vrai Worker
avant d'être crue. Les deux qui comptent : **la surface d'encre facturée était déclarée par
l'acheteur** (un seul nombre changé dans la requête, jusqu'à 9,00 EUR HT par face et par
vêtement), et **les deux routes ouvertes étaient de l'hébergement de fichiers** public,
permanent et immuable, sur l'origine qui sert aussi la boutique. Deux autres tenaient à la même
racine : fermer la page d'administration ne fermait que la page, son JavaScript répondait 200 à
qui le demandait, et le manifeste de build publiait la liste des morceaux.

**Une sauvegarde a été prise, puis restaurée**, ce qui n'est pas la même phrase. Le compte
o2switch n'a **aucune sauvegarde en libre-service** (mesuré : `uapi Backup list_backups` répond
que la fonctionnalité n'est pas disponible). La sauvegarde nocturne coûte 42 s pour 293 Mo ; la
restauration dans une base d'essai a pris 7 s et a rendu **15 commandes, exactement ce que le
manifeste annonçait**. La veille tourne toutes les dix minutes, n'alerte que sur un changement
d'état, envoie aussi le retour à la normale, et a été éprouvée sur un vrai problème.

**Et deux dettes d'accessibilité héritées de la séance 12 sont fermées** : le sélecteur de
scène est un `listbox` en comportement et plus seulement en ARIA, et la `Modal` du studio tient
la promesse de son `aria-modal`. `npm run verify:focus` les tape au clavier dans un vrai
navigateur.

**Ce que la séance n'a pas pu clore, et ce n'est pas un oubli** : le cache de page (le miroir
est sous Apache, o2switch sous LiteSpeed), l'application de la politique de sécurité du contenu
(sans compte Stripe, le parcours de paiement n'a jamais été exercé sous elle, donc elle est
envoyée en Report-Only côté boutique), et la limitation de débit (déclarée, mais sa liaison
n'existe pas sous `wrangler dev`). Les trois attendent la séance 14, et R2 n'a toujours aucune
copie des créations des clients, ce qui est le trou le plus sérieux qui reste.

---

## Ce qu'il reste : quinze séances

Le détail exécutable de chacune vit dans `prompts/` (non versionné : ce sont des
instructions de travail, elles changent plus vite que le code).

| # | Séance | Bloquée par |
|---|---|---|
| ~~01~~ | ~~Boucler la boucle : du studio au panier WooCommerce~~ **faite** | - |
| ~~02~~ | ~~Fiche produit, grille de prix, demande de devis~~ **faite** | - |
| ~~03~~ | ~~Catalogue : Falk&Ross vers WooCommerce, à l'échelle~~ **faite** | - |
| ~~03b~~ | ~~Le registre des hypothèses~~ **faite** | - |
| ~~04~~ | ~~Paiement : Stripe, TVA, livraison, facture~~ **faite** | - |
| ~~05~~ | ~~Moteur de coût, prix plancher, commissions~~ **faite** | - |
| ~~06~~ | ~~BAT, cycle de vie de la commande, e-mails~~ **faite** | - |
| ~~07~~ | ~~Production : imbrication du film entre commandes~~ **faite** | - |
| ~~08~~ | ~~Commande fournisseur et stock~~ **faite** | - |
| ~~09~~ | ~~Le site : accueil, navigation, système de design~~ **faite** | - |
| 10 | Le studio en vitrine : 3D et mockups. **L'aperçu 3D d'un vêtement du catalogue est fait, mesuré et gardé** ; la vue portée est refusée par écrit, et les mockups ne sont relus par personne (voir « Ce que la séance 10 n'a pas fait » ci-dessus) | 09 |
| ~~11~~ | ~~Référencement, contenu, données structurées~~ **faite**. Une page manque et le refus est écrit : la page Île-de-France, qui a besoin d'une adresse (questions 17 et 55) | - |
| ~~12~~ | ~~Juridique, RGPD, accessibilité~~ **faite**. Les quatre pages existent et se déclarent comme des projets non relus par un avocat, les CGV sont des versions datées dont les chiffres sont contrôlés contre le code, l'effacement suit la donnée jusqu'à R2 et refuse plutôt que de finir à moitié, et le parcours d'achat passe WCAG 2.2 AA. Sept points bloquent encore la vente et aucun n'est du code : voir `docs/seance-12-a-reprendre.md` §2 |
| ~~13~~ | ~~Performance, sécurité, supervision~~ **faite**. Les six types de page sont mesurés avant et après sur le même instrument, la passe adverse a publié ses 75 attaques repoussées autant que ses 5 trouvailles, la sauvegarde a été **restaurée** et pas seulement prise, et une alerte a été déclenchée pour de vrai. Trois choses ne peuvent pas être closes ici et sont nommées : le cache de page (il faut LiteSpeed), l'application de la politique de sécurité du contenu (il faut un paiement réel) et la limitation de débit (il faut un déploiement). Voir `docs/seance-13-a-reprendre.md` |
| 13b | Les réponses de l'associé, et redire la vérité. **Faite**, en deux jours : les 61 réponses dépensées le 1er septembre, puis la séance auditée contre son propre brief le 2, ce qui a trouvé sept manques dont trois qu'un client aurait vus. Ce qui reste est dans `docs/seance-13b-a-reprendre.md`, et rien n'y est du code | 13 |
| 14 | Déploiement : préproduction, pipeline, purge de la démo. **Commence et finit par `npm run verify:lancement`, rejoué contre la vraie boutique et non contre le miroir** : la liste de contrôle est `docs/MISE-EN-LIGNE.md` | 13b |
| 15 | Répétition générale et mise en ligne. **La mise en ligne ne se fait pas sur un refus du portail**, et il n'existe pas de dérogation : `docs/MISE-EN-LIGNE.md` | 14 |

**Seules les séances 14 et 15 touchent au serveur o2switch, et leurs accès sont
désormais en place.** Tout le reste se construit et se vérifie sur le miroir local.

---

## Ce qui bloque, et qui peut le débloquer

**Les accès ne bloquent plus rien depuis le 14/08/2026.** SSH, clés WooCommerce,
compte administrateur et préproduction sont en place et ont été essayés un par un
(détail et méthode dans `ACCES-REQUIS.md`). La demande d'accès à cPanel a été
**retirée** plutôt qu'accordée : les quatre opérations qui la motivaient passent toutes
par SSH. Ce qui reste bloque pour une autre raison, et personne d'autre que l'associé
ne peut le lever.

| Blocage | Qui | Détail |
|---|---|---|
| **Le régime de TVA** | associé | Question 17 et constat 6. **Répondu le 01/09/2026 et toujours bloquant**, dans ses propres mots : « conserver l'hypothèse de TVA à 20 % ... sous réserve de validation comptable » est une hypothèse maintenue et non une confirmation. `npm run verify:lancement` la refuse nommément, comme les douze autres lignes bloquantes encore supposées, et il porte en plus une condition qui ne parle que d'elle : le régime n'est confirmé dans **aucun** sens. La boutique a encaissé 15 commandes (465,79 EUR, nov. 2024 à avr. 2025) **taxes désactivées** ; elles ne sont facturables sous aucun régime, faute de période qui couvre leur date. Les deux régimes sont construits : ce qui manque est une phrase du comptable, dans un sens ou dans l'autre |
| La vraie grille tarifaire | associé | Questions **06** (taux de marge) et **03** (grilles d'achat réelles), sa forme publique étant la **08**. Les prix actuels sont des **valeurs de démonstration**, enregistrées une par une dans `docs/hypotheses.json`. Ce tableau renvoyait à la question 04, qui porte sur les tarifs DTF fournisseur et ne tranche aucun prix de vente. **Depuis la séance 05 ce n'est plus seulement une imprécision** : mesuré, le tarif affiché passe sous son propre prix plancher à 5 pièces et n'est vendable sans validation à aucune quantité |
| **Le sens de « taux de marge »** | associé | Question 06. Le mot et la formule de la Bible désignent deux ratios différents, et l'écart est de 125,00 EUR sur une commande de 250 EUR de coût, au taux de 50 % qu'il a donné le 01/09/2026. Sa propre formulation, « marge brute après coûts directs », est la lecture de la formule, et c'est celle qui tourne. Les deux restent affichées côte à côte sur l'écran « Coûts et marges » |
| **Les délais, qui ont raccourci** | associé | Question 14. **Répondu le 01/09/2026 : 7 / 4 / 2 à 3 jours**, contre 12 / 7 / 4 supposés, et remesuré aussitôt. Le travail incompressible reste **6 jours ouvrés** (transport 2, pressage 1, battement 1, approvisionnement 2, le film et les blancs voyageant en parallèle). Le standard garde donc **un** jour ouvré de marge là où il en avait six, et ce jour EST le battement : un transporteur en retard le consomme. L'express manque de 2 jours, l'urgence de 3 ; ni l'un ni l'autre n'est publié. Restent deux inconnues dans sa phrase : ouvrés ou calendaires, et jusqu'à l'expédition ou jusqu'à la livraison |
| **Les cinq temps d'atelier jamais chronométrés** | associé | Question 05. Ses deux temps chiffrent la main-d'œuvre de sa propre commande d'exemple à 2,83 EUR là où elle en inscrit 45,00 : **42,17 EUR de trou, et 72,29 EUR de prix plancher**. Le trou a GRANDI avec sa réponse du 01/09/2026, qui pose la pose à 15 s au lieu de 45. Il demande lui-même le chronométrage du cycle complet |
| ~~Le taux de marge sur un textile nu~~ | **tranché** | Question 42, répondue le 01/09/2026 : « non applicable au moteur e-commerce principal pour le lancement ». Ce n'est plus une attente, c'est un périmètre volontairement non ouvert. Les 26 399 articles restent consultables et non commandables, et c'est désormais le parcours voulu (question 41) et non un effet de bord |
| Clés Stripe **réelles** | associé | Séance 04. Les clés de **test** sont arrivées le 01/09/2026 et fonctionnent : un PaymentIntent de 14,50 EUR revient `succeeded`. Ce qui manque est le mode réel, mesuré fermé (`charges_enabled` et `payouts_enabled` tous deux faux), le secret de signature des webhooks, et trois réglages qui coûtent de l'argent ou des ventes : **Cartes Bancaires inactif** (le routage CB est nettement moins cher sur les cartes françaises co-badgées), **Google Pay et le virement SEPA absents** de la configuration alors que la question 15 les demande. La politique de sécurité du contenu reste en Report-Only tant qu'un paiement n'a pas été exercé de bout en bout sous elle |
| ~~L'identité légale complète et le RCS~~ | **fournie** | Questions 17 et **45**, répondues le 01/09/2026 : PHARAON, SAS, SIREN 930 592 985, SIRET 930 592 985 00012, FR45930592985, 100 EUR de capital, RCS Bobigny, pénalités au taux BCE + 10 points et indemnité de 40 EUR. Posée sur le miroir, ce qui a fait passer cette condition du portail de neuf refus à zéro. La production est la séance 14. **Reste l'adresse** : le siège est à Drancy et la fiche Google demandée à Bobigny, et les mentions légales n'en publient qu'une |
| Une plateforme de facturation électronique | associé | Constat 7. Obligatoire **en réception au 1er septembre 2026**, quelle que soit la taille de l'entreprise. Ce n'est pas du développement, c'est une démarche |
| Compte Brevo | associé | Séance 06 |
| `FR_CUSTOMER_NR` | associé | Séance 08. Absent des secrets, donc aucune commande fournisseur ne peut partir, même confirmée : le Worker répond 503 et ne construit aucun document. Le repli qui devinait ce numéro à partir du login a été supprimé, et une sonde en mode test n'a **pas** pu le confirmer auprès du fournisseur. `wrangler secret put FR_CUSTOMER_NR` |
| ~~Où sonne l'alerte, et qui la lit~~ | **répondu** | Question **61**, répondue le 01/09/2026 : `ticket@teeshoop.com` et `dev@teeshoop.com`, avec une classification jour / nuit qui dit quoi réveiller, ce qui est mieux qu'une adresse. Le document les écrivait en `teeshoop.fr`, domaine qui n'existe pas (NXDOMAIN sur A, MX et NS, inconnu de l'AFNIC) : coquille corrigée et confirmée. Il reste à vérifier que les deux boîtes existent et sont relevées, ce qui se lit en SSH et appartient à la séance 14 |
| ~~Le délai de livraison du fournisseur textile~~ | **répondu** | Question **46**, répondue le 01/09/2026 : environ 24 heures réelles, **2 jours ouvrés** retenus pour planifier. L'écran des achats porte désormais une date limite de commande des blancs par commande. Remesuré plutôt qu'additionné : les 6 jours ouvrés incompressibles **restent 6**, parce que le film et les blancs partent le même jour et voyagent en même temps. Additionner de tête aurait donné 8. Réserve : le délai est donné pour Imbretex et le chemin d'achat parle à l'autre fournisseur |
| **Un accès Imbretex** | associé | Questions 3, 9, 43 et 46, toutes répondues le 01/09/2026 et toutes le nommant comme fournisseur prioritaire. Il n'existe ni compte, ni identifiants, ni grille. Le catalogue, le relevé de stock et le panier d'achat parlent au fournisseur branché. Conséquence : le délai textile de 24 h et la règle des trois valeurs de stock sont énoncés pour Imbretex et appliqués sur les chiffres de l'autre |
| **La grille Mondial Relay** | associé | Question 07. Il le nomme transporteur principal et classe la grille dans « éléments restant à récupérer ». La boutique chiffre donc toujours sur la grille publique de La Poste et la copie dit Colissimo : nommer l'un en facturant l'autre serait la fausse promesse. Le jour où la grille arrive, un point relais n'est pas une adresse, donc c'est un mode d'expédition à construire et une vingtaine de phrases à réécrire. La **remise en main propre** en Île-de-France au-dessus de 250 EUR HT est un troisième mode et n'existe pas non plus |
| **Ce qui refuse un particulier** | associé | Question **62**, ajoutée par la séance 13b. La réponse à la question 57 lève l'obligation de médiation de la consommation « pour le parcours B2B », et cette exemption ne tient que si la boutique refuse effectivement un consommateur. Or la question 01 dit « SIRET demandé sans nécessairement bloquer l'inscription », ce qui ne refuse personne. Prises séparément les deux lignes du registre sont des refus assumés ; ensemble elles sont une infraction à l'article L612-1, et `verify:lancement` refuse sur la PAIRE |
| **Le juriste qui relit les quatre textes** | associé | Question **58**, répondue le 01/09/2026 par « avocat ou cabinet juridique à désigner avant le lancement officiel », ce qui est une intention. `verify:lancement` refuse maintenant une version des conditions générales qui n'enregistre ni le nom du relecteur ni la date : sa propre phrase, rendue exécutable |
| **La facture sur la feuille A3+** | associé | Question 04. Il donne 3,00 EUR la feuille de 33 x 46 cm et laisse quatre points « à confirmer sur la facture » : HT ou TTC (un cinquième de tout le coût de marquage), les frais de livraison, le minimum et le délai. Les frais de livraison décident maintenant de **la totalité** de ce que le groupage fait gagner, remesuré à 75,00 EUR sur une semaine de six commandes : s'ils sont offerts, grouper ne rapporte plus rien |

### Ce qui a été décidé le 18/08/2026 : avancer quand même

L'associé n'est pas disponible pour répondre, et attendre coûte plus cher que corriger.
Les séances 04 à 13 sont donc construites **sur les hypothèses par défaut** écrites dans
`QUESTIONS-ASSOCIE.md`, sous une condition en deux séances nouvelles.

**03b a installé la condition.** Le registre est `docs/hypotheses.json` : **28 lignes**, une
par valeur supposée, avec son **unique** emplacement dans le code, ce qu'elle atteint (un
client, un fournisseur, une presse) et les mesures qui deviendraient fausses si elle
bougeait. `scripts/hypotheses-guard.mjs` est dans `npm run ci` et échoue quand le registre
et le code divergent, quand une valeur acquiert une seconde copie, quand une question
marquée bloquante n'a aucune ligne, quand la phrase française d'une ligne ne dit plus le
nombre que le code applique, et quand une hypothèse qu'un client rencontre n'a aucune
formulation française à l'écran. Les six contrôles ont été cassés un par un, sur les vrais
fichiers, pour vérifier qu'ils échouent, et `--self-test` les recasse à chaque exécution de
la chaîne. Un exemple mesuré : passer le t-shirt nu de 9,50 à 9,90 EUR fait échouer trois
contrôles à la fois. **Les 18 questions bloquantes sont toutes traitées** : onze par une
ligne, sept par un motif écrit de non-applicabilité.

Il ne compare pas des fichiers texte : il **fait tourner les deux implémentations**. La
configuration de prix est obtenue en appelant `Pricing::default_config()` en php, la table
du studio en la compilant avec esbuild et en l'important. C'est ce qui permet de tenir la
seule vraie duplication du prix, `src/content/pricing.ts`, qui répétait cinq nombres sans
que rien ne les compare.

Trois copies réelles ont été supprimées au passage : le taux de TVA et le prix du t-shirt
de démonstration étaient réécrits à la main dans la commande de provisionnement
(`Cli.php`), qui les lit désormais depuis l'autorité, et deux notes d'administration
renvoyaient l'associé à la mauvaise question. Deux valeurs ont reçu un nom pour pouvoir
être désignées : `Catalogue::PRINTABLE_FAMILIES` et `Catalogue::STOCK_INDEX`.

**Ce qui a été livré n'est pas toujours l'hypothèse par défaut écrite**, et le registre le
dit ligne par ligne. Les écarts qui coûtent le plus cher à refermer, dans l'ordre : aucun
**minimum de commande** n'est appliqué alors que la question 01 en annonce un « bloquant à
la validation du panier » ; la **TVA** est une constante alors que la question 17 exige
expressément une période datée avec un mode franchise ; le catalogue publie **459
références et trois familles** au lieu des 300 et cinq familles annoncées ; la **grille
publique** a cinq colonnes au lieu de six et accorde 35 % de remise en autonomie là où la
question 06 en plafonne la remise à 15 % ; la **découpe en visuels** se déclenche sur une
géométrie et non sur le seuil de 100 cm² d'économie annoncé ; et les **17 EUR le mètre
linéaire** n'étaient écrits dans aucun code exécutable. Ce dernier point a été refermé par la
séance 05, puis **rendu caduc par la réponse elle-même** : le 1er septembre 2026 l'associé
donne une feuille A3+ à 3,00 EUR et non un mètre de rouleau, et les 17 EUR ne sont plus le
tarif de personne. Le module DTF du studio garde ses tarifs publics relevés pour ce qu'ils
sont, une comparaison de marché.

**13b l'a soldée le 1er septembre 2026**, entre la 13 et la 14, ce qui est la bonne
couture : tout ce qui précède est local et réversible, la 14 touche le vrai domaine et la 15
encaisse de l'argent réel.

**Et la passe adverse a trouvé vingt-sept choses sur une séance pourtant verte,
dont deux qui auraient gâché une planche.** Quarante-deux angles, trente-sept
trouvailles, vingt-sept qui ont survécu à leur propre vérification. Ce qu'elles
ont en commun est exactement ce que le carnet de la compétence dit de chercher :
aucune n'est une erreur de logique dans le code neuf. Chacune est une hypothèse
qui tenait sous le rouleau et qui a cessé de tenir quand le film est devenu une
feuille, sans que rien ne soit ajouté au moment où le sens a changé.

Les deux qui gâchent une planche :

- **Un brouillon de lot survit au changement de laize.** `create_lot` vérifie la
  laize le jour où la planche est imbriquée ; `send_lot` re-tarife délibérément
  le jour où l'argent part, parce qu'une semaine peut passer, et ne revérifiait
  aucune géométrie. Mesuré sur le moteur livré : la même planche de 2,40 m
  facture 57,84 EUR en rouleau et 33,90 EUR en six feuilles, silencieusement, et
  l'opérateur commande six feuilles de 33 cm pour une planche de 56. Une
  modification à l'écran des coûts suffit, sans aucun déploiement. La comparaison
  est désormais une seule fonction posée aux deux moments.
- **Une planche plus longue qu'une feuille.** Le champ de longueur du studio est
  modifiable exprès et se borne au profil du fournisseur, pas au film que la
  boutique achète. Sous le rouleau c'était une coupe plus longue, sans
  conséquence. Depuis le 1er septembre chaque 46 cm est un bord réel : une
  planche continue, c'est six feuilles et cinq coupes dans le dessin.

Les autres, par famille : l'écran des coûts ne savait pas éditer la feuille (une
configuration enregistrée avant la séance re-imposait 68 % de sous-coût), le
portail lisait 200 produits sur 462 et concluait « rien trouvé », le registre
surveillait deux champs morts, la provenance disait des mètres pour une facture
qui compte des feuilles, l'atelier proposait encore un fournisseur espagnol que
le tarif refuse, `Quote::expired()` n'avait aucun appelant alors que les CGV
publient quinze jours, une version future des CGV aurait libéré la version en
vigueur de toute comparaison, et quatre commentaires décrivaient une géométrie
que le code refuse. Chaque correctif porte son test, et chaque test a été passé
une fois sur un garde-fou volontairement cassé.

**Le portail de mise en ligne existe : `npm run verify:lancement`.** C'est la troisième des
trois règles du 18 août, la seule qui n'avait jamais été construite, et elle est écrite en
toutes lettres dans `QUESTIONS-ASSOCIE.md` : « la mise en ligne est bloquée automatiquement
tant qu'une réponse bloquante manque sur un nombre qu'un client, un fournisseur ou une
imprimante finit par voir ». Cinq conditions, et il **refuse** tant que l'une tient :

1. une ligne du registre `bloquant`, encore supposée, que personne n'a datée, et qui atteint
   un client, un fournisseur ou une presse ;
2. l'identité légale incomplète, celle de la facture (question 17) **et** celle du site au
   sens de l'article 6 III de la LCEN (question 56) ;
3. le régime de TVA non confirmé, **dans un sens ou dans l'autre** : il faut à la fois un
   barème utilisable dans la boutique et une date de réponse sur `H-Q17-TVA`, et la réponse
   du 1er septembre (« conserver l'hypothèse ... sous réserve de validation comptable ») n'en
   est pas une ;
4. des conditions générales en vigueur que personne n'a enregistrées comme relues, avec le
   nom du relecteur et la date ;
5. un produit personnalisable en vente qui ne déclare aucun textile nu, donc une commande
   que l'atelier ne pourra jamais approvisionner.

Il **échoue fermé** : un registre illisible refuse, une boutique injoignable refuse, et une
condition qu'il n'a pas pu évaluer est comptée comme non vérifiée et non comme satisfaite.
`--self-test` casse les **sept** conditions une par une et vérifie aussi qu'un dépôt sans
reproche passe, parce qu'un portail qui refuse tout n'est pas un portail. Les cinq du brief
plus deux que la construction a rendues nécessaires : la médiation, qui n'est une infraction
que couplée à l'absence de refus d'un particulier, et la boutique injoignable, parce que
« on n'a pas pu regarder » n'est pas « il n'y a rien ». Depuis le 2 septembre il tourne dans
l'intégration continue, sous son propre nom d'étape, à côté de `--depot --ci`. La chaîne
d'intégration l'exécute en `--depot --ci`, qui pose une autre question : « ce portail
fonctionne-t-il », et non « peut-on lancer », dont la réponse est non pour des semaines.

**Les séances 14 et 15 le lisent avant de déployer et avant d'encaisser**, et depuis le
2 septembre 2026 cette consigne est dans un fichier suivi par git plutôt que dans une phrase :
`docs/MISE-EN-LIGNE.md`, que les deux lignes de la feuille de route ci-dessus nomment. Elle
ne vivait jusque-là que dans `prompts/`, qui est ignoré par git, et le portail lui-même
n'était dans **aucun** travail d'intégration continue : il était entré dans l'alias
`npm run ci` et s'était arrêté là, ce qui est exactement la dérive que la séance 12 disait
corriger « plutôt que d'en ajouter une troisième ». C'était la quatrième.

Mesuré le 2 septembre 2026 sur le miroir : **refusé, 27 raisons** (13 registre, 6 textile nu,
4 éditeur, 2 CGV, 1 TVA, 1 médiation). C'était quatorze la veille : six produits sans textile
nu au lieu de trois après la lecture du catalogue entier, et la ligne neuve
`H-Q63-FACTURE-EXTERNE`.

Le compte a fait un détour par 40 avant de se poser, et le détour valait la mesure : la suite
d'intégration publiait trois produits personnalisables à chaque exécution sans jamais les
effacer, donc le portail comptait les résidus de la journée comme des produits en vente. Le
balayage les retire maintenant, et le vérifie sur les trois identifiants qu'il vient de créer
plutôt que sur un « rien trouvé ».

Elle a par ailleurs confronté chaque réponse au registre, appliqué les changements par ordre
de portée, **remesuré** ce qui dépendait d'une valeur modifiée au lieu de le réaffirmer, et
réaccordé ce que le site promet en public avec ce que l'atelier peut tenir.

`QUESTIONS-ASSOCIE.md` contient **61 questions** auxquelles seul l'associé peut répondre, dont
**23 marquées bloquantes** (recomptées le 02/09/2026, et le registre des hypothèses vérifie à
chaque exécution de la chaîne que les 23 bloquantes ont toutes une ligne ou un motif écrit de
non-applicabilité ; le chiffre est imprimé par le contrôle et non recopié ici). Le chiffre inscrit ici disait encore 44 sur 18, ce qui datait de la séance
05 : c'est corrigé, et il vaut mieux le compter que le recopier. Q06 (les taux de marge) et
Q03 (les grilles d'achat réelles) conditionnent une grande partie de la séance 05. La dernière
en date est la **61**, ajoutée par la séance 13 : la boutique se surveille désormais toute
seule et n'a personne à prévenir.

---

## Étiqueter, ou ne pas livrer : ce que devient chaque hypothèse restante

*Décidé le 1er septembre 2026, séance 13b, item 6. Il n'y a que deux réponses
honnêtes à « nous n'avons pas la réponse » : **étiqueter**, pour que l'opérateur
et le cas échéant le client voient que le nombre est provisoire, ou **ne pas
livrer**, comme le catalogue est consultable et non commandable faute de taux de
marge. Il n'existe pas de troisième option où un nombre inventé part en ligne
sans rien dire.*

**Et la décision n'est pas une liste, c'est une règle qui tourne.** Une liste
dans un document se périme au premier commit ; deux contrôles automatiques
prennent la décision ligne par ligne, à chaque exécution de la chaîne :

- `scripts/hypotheses-guard.mjs`, contrôle « said-out-loud » : **toute hypothèse
  qui atteint un client doit porter un `label_fr`**, et cette phrase française
  doit exister dans une vraie table de chaînes livrée. Une hypothèse qu'un client
  rencontre sans phrase autour fait échouer la chaîne. Depuis cette séance, la
  règle vaut aussi dans l'autre sens : une ligne **confirmée** qui garde une
  étiquette doit toujours l'avoir à l'écran, parce que confirmer 41 lignes d'un
  coup relâchait sinon 15 phrases que plus rien ne surveillait.
- `scripts/launch-gate.mjs` : **une hypothèse bloquante que personne n'a datée et
  qui atteint un client, un fournisseur ou une presse refuse la mise en ligne.**
  Étiquetée ou non.

Les deux ensemble disent : une hypothèse qui atteint un client est étiquetée
tant qu'elle vit, et si elle est bloquante elle ne va pas en ligne du tout.

### Ce que cela donne aujourd'hui, en trois piles

**Étiquetées et livrées** (46 lignes encore supposées, dont 26 atteignent un
client, recomptées le 2 septembre 2026 ; 22 était le compte de la projection filtrée que lit
la boutique, qui est un autre ensemble et n'aurait jamais dû figurer ici). Chacune porte la phrase sous laquelle le client la rencontre : « Prix à
la pièce, impression comprise », « Rupture, nous consulter », « Délai à
confirmer », « Les coloris portent le nom du fabricant », « imprimé en France »,
« Projet, non validé par un juriste ». Le reste n'atteint qu'un opérateur, et
l'écran des hypothèses ou celui des coûts et marges les montre avec leur
question, leur date et, depuis cette séance, la réponse de l'associé quand il y
en a une.

**Livrées comme un refus explicite** (15 lignes, chiffre imprimé par le contrôle et non
recopié ici). Rien n'est construit et le
produit le dit : aucun taux de marge sur le textile nu, donc le catalogue est
consultable et non commandable ; aucun modèle de coût pour la broderie, le
flocage, le vinyle et la sublimation, donc une commande qui en contiendrait n'a
pas de plancher et le rapport le signale ; aucun supplément d'urgence ; aucun
échéancier ; aucune provision de défaut, et le coût se déclare **incomplet**
plutôt que d'être présenté comme total. Un refus livre une absence, et une
absence est honnête.

**Bloquées à la mise en ligne** (13 lignes, listées par `npm run
verify:lancement`). Ce sont celles qui sont à la fois bloquantes, encore
supposées, et tournées vers l'extérieur : les quatre tarifs de démonstration du
studio, la TVA et sa période, le seuil de devis en pièces, les zones
d'impression, « imprimé en France », « pour les professionnels », les deux
lignes des textes juridiques, et depuis le 2 septembre `H-Q63-FACTURE-EXTERNE`,
née de l'application de la question 24. Elles vivent, elles sont étiquetées, et
le portail refuse le déploiement tant qu'elles sont là.

### Les quatre choses que cette séance a délibérément NE PAS construites

Elles ont une réponse de l'associé et elles ne sont pas livrées. Chacune est ici
avec ce qui manque pour la construire, parce qu'une décision de ne pas faire qui
n'est écrite nulle part est un oubli.

| Réponse | Ce qu'elle demande | Pourquoi rien n'est livré |
|---|---|---|
| **Q37** | « ne jamais utiliser uniquement la surface du M pour calculer le coût réel » | Le prix client est confirmé et ne bouge pas. Le **coût** doit suivre la taille commandée, ce qui veut dire imbriquer une pièce par taille dans le chemin de coût et non plus une seule à la taille de tarification. Mesuré en séance 05 : trente pièces prennent 1,80 m en M et 2,70 m en 3XL. C'est le moteur de coût, pas un réglage, et la remesure qui suit touche tous les planchers |
| **Q44** | le nom français suivi du nom fabricant, 442 coloris | 437 traductions à écrire et à faire valider par quelqu'un qui connaît le catalogue papier. Ce n'est pas du code, et la réponse à la question 44 autorise elle-même de ne traduire que les plus vendus |
| **Q50** | la zone imprimable s'arrête 2 cm au-dessus de la couture de poche | Il faut d'abord savoir **où est la couture** sur le maillage du sweat, et `scripts/fabric-verify.mjs` déclare précisément ces rangées « indécidables » : deux épaisseurs de tissu, jusqu'à 14 mm de désaccord entre les deux mesures indépendantes qu'il sait construire. Poser 2 cm au-dessus d'une couture mesurée à 14 mm près, c'est publier une dimension imprimable fausse, et une dimension imprimable est un engagement |
| **Q54** | la remise sur un lot de production compatible | Trois des quatre critères sont des jugements (« emplacements similaires », « même campagne ») et le prix est calculé par le serveur pendant que le client remplit son panier, et un serveur ne sait pas juger « similaire » |

**Q09** (Imbretex prioritaire) n'attend pas un choix mais un accès : ni compte,
ni identifiants, ni grille.

**Q24 n'est plus dans cette liste : elle est construite**, le 2 septembre 2026.
La séance du 1er avait écrit la correction retenue et ne l'avait pas faite, ce
qui est pire qu'une question ouverte parce que la séance suivante y croit. Le
site n'émet plus de facture : le document reste, il s'appelle « récapitulatif de
commande », sa référence commence par deux lettres qui ne sont pas celles d'une
facture, et la première ligne de son bloc de mentions dit où la facture est
établie. Ce que cela coûte est enregistré comme une ligne bloquante,
`H-Q63-FACTURE-EXTERNE` : l'article 289 du code général des impôts impose une
facture à chaque acompte encaissé, plus rien ici n'en produit, et le système qui
doit le faire n'est pas nommé. Le portail refuse la mise en ligne dessus.

---

## Les exceptions assumées

Ce qui précède attend une réponse de l'associé. Ce qui suit n'attend personne : ce sont des
écarts **décidés**, avec leur raison, ce qui les referme et la séance qui devrait s'en
occuper. Ils sont ici parce qu'un écart non écrit devient au choix un bug que l'on
redécouvre, ou une habitude que l'on croit voulue.

La règle pour la séance qui les traite : **ne pas refermer un de ces écarts sans relire la
raison**. Plusieurs sont des refus délibérés, pas des oublis.

**Ce tableau ne contient plus ce que le registre tient.** Tout écart qui remonte à une
question de `QUESTIONS-ASSOCIE.md` est désormais une ligne de `docs/hypotheses.json`, avec
un contrôle derrière : le catalogue consultable et non commandable est `H-Q41-CATALOGUE-CONSULTABLE`
et `H-Q42-MARGE-TEXTILE-NU`, les trois familles publiées sont `H-Q09-FAMILLES`. Le recopier
ici en ferait deux vérités qui divergeraient. Ce qui reste ci-dessous est ce que le registre
ne peut pas porter : des arbitrages d'ingénierie qui n'attendent la réponse de personne.

| Écart | Pourquoi il a été choisi | Ce qui le referme | Séance |
|---|---|---|---|
| **Les photos par coloris publient le nom de fichier du fournisseur** (`/media/blank/picture/001_42_000_f-2020_01.jpg`, soit le style et le coloris) | Les copier coûte 267 Mo, ~650 Mo après vignettes, et 1 h 30 d'import. Les trois options sont chiffrées dans `docs/CATALOGUE.md` et le choix a un prix, donc il appartient à l'associé | Une des trois options. En attendant, le contrôle **épingle la porte à la largeur exacte** de cette URL : ce motif ailleurs sur une surface client fait échouer la vérification | 09 ou perf |
| **378 ms par page de liste pour n'afficher aucun prix.** `get_price_html()` parcourt les articles de chaque produit variable, 23,6 ms par produit, seize par page | Tant qu'aucun prix n'est écrit, ce calcul produit une chaîne vide. Le corriger avant de connaître le prix de vente, c'est optimiser une forme qui va changer | Soit ne pas afficher de prix en liste tant qu'il n'y en a pas, soit stocker la fourchette sur le produit parent à l'import. À décider **avec** le prix de vente, pas avant | 05 puis perf |
| **Six articles sont en ligne sans code-barres** | 4 codes-barres sur les 21 479 du catalogue sont réutilisés par le fournisseur sur plusieurs articles, dont un `4053840000000` manifestement bouche-trou. WooCommerce refuse le doublon, et l'import préfère publier l'article sans code-barres plutôt que de perdre la référence entière | Rien de notre côté : c'est une donnée fournisseur. À savoir le jour où un flux marchand (Google Shopping) exigera un GTIN par article | 10 |
| **`POST /pricing/quotes/{id}/approval-request` n'existe pas**, et c'est le seul reste de l'écart « API de prix » | Les deux autres tiers sont refermés par la séance 06 : le devis est devenu un document avec des lignes, un numéro et une version gelée à chaque envoi, et son chiffrage appelle `Costing::compute()` en lui passant une commande construite en mémoire, jamais enregistrée. Celui-ci suppose **deux rôles**, un commercial qui demande et quelqu'un qui approuve ; la boutique n'en a qu'un, et une demande sans second rôle produirait une approbation qui n'approuve rien, indiscernable à l'écran d'une vraie. L'exception elle-même est construite : motif, approbateur, validité, manque à gagner, et elle cesse de couvrir la commande si le plancher bouge | Le second rôle, le jour où il y a des commerciaux, ce que la feuille de route ne programme pas (c'est le chapitre 3) | aucune |
| **Le chiffrage d'un devis n'est pas une route publique**, alors que le chapitre 1 le dessine à côté des points d'entrée client | Ce qu'il renvoie est notre coût d'achat, notre économie du film, notre prix plancher et notre commission. L'exposer mettrait la boutique du mauvais côté de la frontière que `scripts/php-guard.mjs` et `scripts/bundle-guard.mjs` existent pour tenir. Il est joignable depuis l'écran du devis, avec `manage_woocommerce`, et de nulle part ailleurs | Rien : c'est un refus, pas un oubli. À relire si un espace commercial arrive (chapitre 3) | aucune |
| **Le supplément de correction n'est pas facturé automatiquement** (question 26 : deux corrections incluses, puis 15 EUR HT) | Les cycles sont comptés et le montant est affiché à l'opérateur, qui facture à la main. L'ajouter tout seul suppose un second encaissement et une facture rectificative, que la séance 04 n'a pas construits, et le chiffre lui-même est une décision commerciale que personne n'a prise | La réponse à la question 26, puis un avoir et une facture complémentaire | 13b |
| **Les dix indicateurs du chapitre 1 ne sont calculés nulle part** (marge contributive moyenne, taux de remise, part des commandes express, coût SAV par commande, etc.) | Neuf des dix sont des ratios sur une population de commandes, et la population est les quinze vraies commandes d'août sur un catalogue où aucun prix de vente n'est écrit : une moyenne là-dessus aurait l'apparence d'une information de gestion sans en être une. Le dixième, coût estimé contre coût réel, suppose que le coût réel revienne après la production. **La séance 07 en rend un morceau** : le film d'une commande dans un lot expédié n'est plus une estimation, c'est sa part d'un achat réel. Le textile et le temps ne reviennent toujours pas | Le retour du coût réel du textile et du temps (séance 08), puis un écran qui les affiche. Les données brutes sont là : chaque commande garde son rapport gelé, et celles qui sont passées par un lot gardent en plus le métrage acheté et leur part | 13 |

| **La clé WooCommerce de l'atelier est une clé d'administration en clair dans le navigateur** | L'outil d'atelier lit la file de production et enregistre les lots par l'API REST, sur des routes réservées à `manage_woocommerce` : la clé doit donc appartenir à un compte qui gère toute la boutique, là où l'importateur de catalogue ne demandait que la lecture des produits. Elle est stockée en clair dans le `localStorage` du poste de l'atelier (`src/lib/ingest/woo.ts`), et tout ce qui peut exécuter du script sur cette origine peut la lire, puis lire toutes les commandes et tous les clients. Le studio a déjà refusé ce schéma pour son propre jeton (`src/lib/admin/token.ts`), qui n'est gardé que pour la session | Une clé restreinte que l'extension émet et peut révoquer, avec les seules capacités de l'atelier. C'est un travail à part entière, pas une ligne | 13 |

| **`partial_shipment` est envoyé à `false` et personne ne sait ce que le fournisseur en fait** | Son interface l'exige (elle refuse un document qui ne le porte pas, vérifié) et ne le documente nulle part. Les deux lectures possibles n'ont pas les mêmes conséquences : soit il expédie ce qu'il a et met le reste en reliquat, soit il attend d'avoir tout. `false` est la lecture conservatrice, « n'expédiez pas partiellement sans nous le dire », et c'est la valeur envoyée. Un réglage à l'écran serait pire : un contrôle dont personne ne connaît l'effet | Un message à son interlocuteur commercial, comme pour la question 43. Ce n'est pas une décision de l'associé, c'est une information à obtenir | 13b |
| **Une commande fournisseur servie à moitié ne peut pas être complétée depuis la boutique** | La séance 08 a construit l'état « commandée en partie » et affiche les articles refusés, parce que la découverte se faisait sinon à l'ouverture des cartons. Ce qui n'existe pas, c'est le chemin de retour : les commandes clients restent rattachées à cet achat, donc les tailles manquantes ne peuvent pas être remises dans un second panier, et l'atelier les commande à la main ou par l'export CSV. Le construire suppose de décider ce qu'est une commande fournisseur complémentaire (une clé d'idempotence de plus, un rattachement partiel, une réception en deux fois) et cette séance n'avait pas de quoi trancher | Un achat complémentaire rattaché au premier, ou la décision explicite que l'atelier complète à la main | 13 |
| **La facture du fournisseur n'est lue nulle part**, donc le rapprochement des coûts s'arrête au deuxième nombre sur trois | L'écran des achats compare ce que les textiles coûtent au moment de l'achat à ce que le rapport de marge avait supposé, ce qui attrape une hausse de tarif que personne ne remarquerait. Le troisième nombre, ce qu'il a réellement facturé, n'existe pas : son interface ne publie aucune facture, et l'inventer serait exactement ce que le chapitre 6 appelle « coût réel » sans en être un. L'écran le dit plutôt que de laisser croire que le rapprochement est complet | Son document, saisi ou récupéré à la réception. C'est aussi ce qui refermerait le dixième indicateur du chapitre 1, juste au-dessus | 13 |
| **La couture pour un second fournisseur est argumentée, pas démontrée** | Chaque article importé porte le code de l'adaptateur qui l'a écrit, le panier groupe par ce code et refuse d'en mélanger deux, et seul un adaptateur ayant une voie de transmission peut être envoyé ; les autres s'exportent. C'est ce que le chapitre 6 demande et rien de plus. Mais **rien n'a jamais traversé cette couture deux fois** : il n'existe qu'un adaptateur, donc le refus de mélange n'a jamais rien refusé en production, et un test le prouve sur des données fabriquées | Un second adaptateur, ce que la feuille de route ne programme pas (c'est la phase 3 du chapitre 4) | aucune |
| **Le rafraîchissement de stock n'est installé nulle part** | `wp teeshoop stock rafraichir` existe, tourne, et la ligne de cron est écrite dans son aide. La poser est un acte de déploiement, sur un serveur auquel seules les séances 14 et 15 touchent. En attendant, un relevé vieillit et la boutique dit « Délai à confirmer », ce qui est le bon comportement et non une panne | La ligne de cron sur o2switch | 14 |

| **`scripts/render-verify.mjs` ne va plus au bout sur cette machine** | Découvert le 01/09/2026 en voulant remesurer les scènes après le retrait de la scène nuit (question 53). Deux choses, et une seule est réparée. **Réparée :** le canevas rend « à la demande » et `window.__stage.show()` changeait la visibilité d'un objet sans demander de trame, donc le compteur `__frames` que la sonde attend n'avançait jamais ; mesuré en page headless, il reste à 1 et cinq appels à `__stage.draw()` le portent à 3. `draw()` existe maintenant et la sonde le demande. **Pas réparée :** le balayage cale quand même, plus tôt, sur un vêtement que la page annonce « loading… » indéfiniment. Ce n'est pas diagnostiqué. **Conséquence à connaître : le seul contrôle du dépôt qui REGARDE une image est aveugle**, et il l'était déjà avant cette séance (sa dernière sortie datée est du 26/08/2026). Le retrait de la scène nuit est donc vérifié par le code, par la ligne « 1 cas retiré » que la sonde imprime et par une sonde directe qui montre cinq scènes dans le sélecteur, **et pas** par un balayage de contraste remesuré | Diagnostiquer le chargement du vêtement dans la page `dev/three.html`. Tant que ce n'est pas fait, aucune affirmation sur le rendu ne doit s'appuyer sur ce harnais | 14 |

La rotation éventuelle de `ADMIN_TOKEN` est dans `ACCES-REQUIS.md` et n'est pas un écart :
c'est une action à faire.

---

## Quatre choses à savoir avant de toucher au code

1. **Le serveur calcule le prix.** Le studio affiche ce qu'on lui dit. Deux implémentations
   des mêmes règles finissent toujours par diverger, et le jour où elles divergent le client
   voit un chiffre et la facture en dit un autre.

2. **Fermé par défaut.** Un secret absent refuse tout. Un design non vérifiable refuse la
   ligne de panier. Une panne réseau n'est pas un feu vert.

3. **La couture entre du code correct et WooCommerce est là où l'argent se perd.** Le
   calcul de prix était juste ; un garde-fou recopié de tous les tutoriels sautait tous les
   recalculs sauf le premier, et un client qui passait de 9 à 50 pièces gardait l'ancien
   tarif. C'est pour cela qu'il existe une suite de tests contre un vrai panier WooCommerce
   en plus des tests purs.

4. **Une entrée de prix ne vient jamais du navigateur.** Pas seulement le prix : le
   vêtement vient de la fiche produit, les surfaces imprimées viennent du fichier de
   création déposé sur le serveur. Tout ce qu'une requête d'ajout au panier peut encore
   décider, c'est la quantité, que le client contrôle de toute façon depuis le panier.
