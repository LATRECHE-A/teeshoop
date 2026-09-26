# Dette de lancement

Relevé le 26 septembre 2026 par `node scripts/launch-gate.mjs --porte=publication --boutique=deploy:teeshoop-deploy:prod`.

- **21 ligne(s) de dette.**
- Boutique interrogée : teeshoop-deploy (clé de déploiement, prod), jointe.
- Conditions regardées : registre, tva (confirmation), médiation, identité, éditeur, tva (barème), cgv, textile nu, prix plancher, passerelle de paiement.
- Conditions NON regardées : aucune.
- Dont 4 que la porte de l'argent refuse, et qui bloquent donc encore la mise en vente.

Ce relevé est une photographie de la boutique nommée ci-dessus, à la date ci-dessus. Il se
régénère, et il faut le régénérer avant de conclure quoi que ce soit de son compte.

Ce fichier n'est pas une dérogation et il n'en accorde aucune. Il existe parce qu'un portail
unique, qui refusait la mise en ligne tant qu'un avocat n'avait pas relu les conditions
générales, n'était pas obéi : il était contourné. La publication n'est plus bloquée par une
dette juridique ou documentaire. Elle est écrite ici, datée, avec le nom de qui peut la lever
et le geste exact qui la lève.

Ce qui coûte de l'argent, lui, refuse toujours : `node scripts/launch-gate.mjs --porte=argent`
sort non-zéro sur un prix sous son plancher, un textile nu non déclaré sur un produit en vente,
ou une passerelle de paiement mal configurée. Il n'y a pas de dérogation pour ces trois-là.

---

## Ce que la porte de l'argent refuse encore (4)

Ces lignes ne sont pas de la dette : ce sont des refus. Tant qu'elles sont là, la boutique ne doit
pas vendre, quoi que dise le reste de ce fichier. Chacune est détaillée plus bas, sous son
propriétaire ; cet index existe pour être lu en premier.

- Condition « textile-nu-fournisseur », inconnue de ce relevé (développeur) : Le dépôt du catalogue fournisseur est vide. Lancez « wp teeshoop catalogue synchroniser »…
- Prix au-dessus de son plancher (développeur) : Le tarif publié, les coûts, les règles de marge, la commission ou le port ont changé…
- Prix au-dessus de son plancher (développeur) : 3 colonne(s) publiée(s) sur 102 se vendent sous leur plancher : la boutique perd de…
- Passerelle de paiement (développeur) : Aucun moyen de paiement n’est actif : la boutique ne peut rien encaisser. Activez une…

## associé (13)

- **Registre des hypothèses · H-Q06-TARIF-TEE** (hypothèse tenue depuis le 12 août 2026)
  - Constat : H-Q06-TARIF-TEE (question 06) est une hypothèse bloquante que personne n'a confirmée, et elle atteint : customer. Un t-shirt imprimé sur une face vaut 34,00 EUR HT à l'unité : 24,00 EUR de textile nu et de frais de commande, et 10,00 EUR de marquage.
  - Pour lever : Répondre à la question 06 dans QUESTIONS-ASSOCIE.md, puis porter la date de la réponse sur la ligne H-Q06-TARIF-TEE de docs/hypotheses.json (champ « answered »). Tant qu'elle n'y est pas, ce chiffre part en ligne sous le nom d'un prix sans que personne l'ait confirmé.
- **Registre des hypothèses · H-Q06-TARIF-SWEAT** (hypothèse tenue depuis le 12 août 2026)
  - Constat : H-Q06-TARIF-SWEAT (question 06) est une hypothèse bloquante que personne n'a confirmée, et elle atteint : customer. Un sweat imprimé sur une face vaut 73,00 EUR HT à l'unité : 63,00 EUR de textile nu et de frais de commande, et 10,00 EUR de marquage.
  - Pour lever : Répondre à la question 06 dans QUESTIONS-ASSOCIE.md, puis porter la date de la réponse sur la ligne H-Q06-TARIF-SWEAT de docs/hypotheses.json (champ « answered »). Tant qu'elle n'y est pas, ce chiffre part en ligne sous le nom d'un prix sans que personne l'ait confirmé.
- **Registre des hypothèses · H-Q06-TARIF-VETEMENT-CLIENT** (hypothèse tenue depuis le 12 août 2026)
  - Constat : H-Q06-TARIF-VETEMENT-CLIENT (question 06) est une hypothèse bloquante que personne n'a confirmée, et elle atteint : customer. Quand le client fournit son propre vêtement, la décoration d'une face vaut 12,00 EUR HT et le textile ne nous coûte rien.
  - Pour lever : Répondre à la question 06 dans QUESTIONS-ASSOCIE.md, puis porter la date de la réponse sur la ligne H-Q06-TARIF-VETEMENT-CLIENT de docs/hypotheses.json (champ « answered »). Tant qu'elle n'y est pas, ce chiffre part en ligne sous le nom d'un prix sans que personne l'ait confirmé.
- **Registre des hypothèses · H-Q06-MARQUAGE-FACE-SUP** (hypothèse tenue depuis le 12 août 2026)
  - Constat : H-Q06-MARQUAGE-FACE-SUP (question 06) est une hypothèse bloquante que personne n'a confirmée, et elle atteint : customer. Chaque face imprimée après la première coûte 10,00 EUR HT, quel que soit le vêtement.
  - Pour lever : Répondre à la question 06 dans QUESTIONS-ASSOCIE.md, puis porter la date de la réponse sur la ligne H-Q06-MARQUAGE-FACE-SUP de docs/hypotheses.json (champ « answered »). Tant qu'elle n'y est pas, ce chiffre part en ligne sous le nom d'un prix sans que personne l'ait confirmé.
- **Registre des hypothèses · H-Q02-SEUIL-DEVIS-QTE** (hypothèse tenue depuis le 14 août 2026)
  - Constat : H-Q02-SEUIL-DEVIS-QTE (question 02) est une hypothèse bloquante que personne n'a confirmée, et elle atteint : customer. Au-delà de 250 pièces sur une ligne, la commande passe obligatoirement par un devis au lieu d'être payée en autonomie.
  - Pour lever : Répondre à la question 02 dans QUESTIONS-ASSOCIE.md, puis porter la date de la réponse sur la ligne H-Q02-SEUIL-DEVIS-QTE de docs/hypotheses.json (champ « answered »). Tant qu'elle n'y est pas, ce chiffre part en ligne sous le nom d'un prix sans que personne l'ait confirmé.
- **Registre des hypothèses · H-Q12-TECHNIQUE-ET-ZONES** (hypothèse tenue depuis le 14 août 2026)
  - Constat : H-Q12-TECHNIQUE-ET-ZONES (question 12) est une hypothèse bloquante que personne n'a confirmée, et elle atteint : customer, printer. Le DTF est la seule technique personnalisable en ligne, et les zones publiées sont celles du studio, en centimètres, mesurées à la taille de tarification.
  - Pour lever : Répondre à la question 12 dans QUESTIONS-ASSOCIE.md, puis porter la date de la réponse sur la ligne H-Q12-TECHNIQUE-ET-ZONES de docs/hypotheses.json (champ « answered »). Tant qu'elle n'y est pas, ce chiffre part en ligne sous le nom d'un prix sans que personne l'ait confirmé.
- **Registre des hypothèses · H-Q63-FACTURE-EXTERNE** (hypothèse tenue depuis le 2 septembre 2026)
  - Constat : H-Q63-FACTURE-EXTERNE (question 63) est une hypothèse bloquante que personne n'a confirmée, et elle atteint : customer. Un système comptable externe, que personne n'a nommé, émet la facture légale de chaque commande et la facture de chaque acompte encaissé ; la boutique n'en produit plus aucune et ne peut pas vérifier qu'elles l'ont été.
  - Pour lever : Répondre à la question 63 dans QUESTIONS-ASSOCIE.md, puis porter la date de la réponse sur la ligne H-Q63-FACTURE-EXTERNE de docs/hypotheses.json (champ « answered »). Tant qu'elle n'y est pas, ce chiffre part en ligne sous le nom d'un prix sans que personne l'ait confirmé.
- **Registre des hypothèses · H-Q17-FABRICATION-FRANCE** (hypothèse tenue depuis le 19 août 2026)
  - Constat : H-Q17-FABRICATION-FRANCE (question 17) est une hypothèse bloquante que personne n'a confirmée, et elle atteint : customer. Le marquage est réalisé en France, dans l'atelier de l'entreprise, et le site le dit à ses visiteurs.
  - Pour lever : Répondre à la question 17 dans QUESTIONS-ASSOCIE.md, puis porter la date de la réponse sur la ligne H-Q17-FABRICATION-FRANCE de docs/hypotheses.json (champ « answered »). Tant qu'elle n'y est pas, ce chiffre part en ligne sous le nom d'un prix sans que personne l'ait confirmé.
- **Registre des hypothèses · H-Q01-SITE-PROFESSIONNEL** (hypothèse tenue depuis le 19 août 2026)
  - Constat : H-Q01-SITE-PROFESSIONNEL (question 01) est une hypothèse bloquante que personne n'a confirmée, et elle atteint : customer. Le site s'adresse d'abord aux professionnels, sans refuser un particulier nulle part.
  - Pour lever : Répondre à la question 01 dans QUESTIONS-ASSOCIE.md, puis porter la date de la réponse sur la ligne H-Q01-SITE-PROFESSIONNEL de docs/hypotheses.json (champ « answered »). Tant qu'elle n'y est pas, ce chiffre part en ligne sous le nom d'un prix sans que personne l'ait confirmé.
- **Registre des hypothèses · H-Q18-TEXTES-PROJET** (hypothèse tenue depuis le 26 août 2026)
  - Constat : H-Q18-TEXTES-PROJET (question 18) est une hypothèse bloquante que personne n'a confirmée, et elle atteint : customer. Les mentions légales, les conditions générales de vente, la politique de confidentialité et la déclaration d'accessibilité sont des projets rédigés en interne à partir du fonctionnement réel de la boutique, publiés en portant l'état « projet » et un avertissement de relecture, et aucun avocat ne les a lus.
  - Pour lever : Répondre à la question 18 dans QUESTIONS-ASSOCIE.md, puis porter la date de la réponse sur la ligne H-Q18-TEXTES-PROJET de docs/hypotheses.json (champ « answered »). Tant qu'elle n'y est pas, ce chiffre part en ligne sous le nom d'un prix sans que personne l'ait confirmé.
- **Registre des hypothèses · H-Q18-RENONCIATION-TEXTE** (hypothèse tenue depuis le 19 août 2026)
  - Constat : H-Q18-RENONCIATION-TEXTE (question 18) est une hypothèse bloquante que personne n'a confirmée, et elle atteint : customer. La phrase par laquelle un client renonce au droit de rétractation sur les articles personnalisés est rédigée par nous, affichée avant le paiement et non à la validation du bon à tirer, et figée sur la commande avec la version des conditions générales en vigueur.
  - Pour lever : Répondre à la question 18 dans QUESTIONS-ASSOCIE.md, puis porter la date de la réponse sur la ligne H-Q18-RENONCIATION-TEXTE de docs/hypotheses.json (champ « answered »). Tant qu'elle n'y est pas, ce chiffre part en ligne sous le nom d'un prix sans que personne l'ait confirmé.
- **Conditions générales de vente**
  - Constat : Les conditions générales en vigueur (version 2026-09-26) sont un projet rédigé en interne que personne dont c’est le métier n’a relu. Question 58.
  - Pour lever : Désigner l'avocat ou le cabinet annoncé en réponse à la question 58, lui faire relire la version en vigueur, puis enregistrer sur cette version le nom du relecteur et la date de sa relecture. Un état « validé » que personne ne signe ne vaut pas mieux qu'un projet.
- **Conditions générales de vente**
  - Constat : La version 2026-09-26 des conditions générales n’enregistre ni le nom du juriste qui l’a relue ni la date de sa relecture. Un état « validé » que personne ne signe ne vaut pas mieux qu’un projet.
  - Pour lever : Désigner l'avocat ou le cabinet annoncé en réponse à la question 58, lui faire relire la version en vigueur, puis enregistrer sur cette version le nom du relecteur et la date de sa relecture. Un état « validé » que personne ne signe ne vaut pas mieux qu'un projet.

## les deux (4)

- **Registre des hypothèses · H-Q17-TVA** (hypothèse tenue depuis le 12 août 2026)
  - Constat : H-Q17-TVA (question 17) est une hypothèse bloquante que personne n'a confirmée, et elle atteint : customer. La TVA est de 20 % sur tout ce que le site chiffre, sous la forme d'une constante unique et non d'une période datée.
  - Pour lever : Répondre à la question 17 dans QUESTIONS-ASSOCIE.md, puis porter la date de la réponse sur la ligne H-Q17-TVA de docs/hypotheses.json (champ « answered »). Tant qu'elle n'y est pas, ce chiffre part en ligne sous le nom d'un prix sans que personne l'ait confirmé.
- **Registre des hypothèses · H-Q17-REGIME-DEPUIS** (hypothèse tenue depuis le 18 août 2026)
  - Constat : H-Q17-REGIME-DEPUIS (question 17) est une hypothèse bloquante que personne n'a confirmée, et elle atteint : customer. Le régime de TVA en vigueur est celui d'une entreprise assujettie, et la période ouverte pour l'affirmer commence le 18 août 2026 : rien n'est affirmé avant cette date.
  - Pour lever : Répondre à la question 17 dans QUESTIONS-ASSOCIE.md, puis porter la date de la réponse sur la ligne H-Q17-REGIME-DEPUIS de docs/hypotheses.json (champ « answered »). Tant qu'elle n'y est pas, ce chiffre part en ligne sous le nom d'un prix sans que personne l'ait confirmé.
- **Régime et barème de TVA**
  - Constat : Le régime de TVA n'est confirmé dans aucun sens : H-Q17-TVA ne porte pas de date de réponse. La boutique a encaissé quinze commandes avec le calcul des taxes désactivé, et la réponse du 1er septembre 2026 dit « conserver l'hypothèse ... sous réserve de validation comptable », qui est le mot à mot d'une hypothèse maintenue.
  - Pour lever : L'associé fait confirmer le régime par son comptable, dans un sens ou dans l'autre, et la réponse est datée sur H-Q17-TVA. Le développeur écrit ensuite la période datée dans le barème de la boutique. La boutique a déjà encaissé quinze commandes avec le calcul des taxes désactivé.
- **Médiation de la consommation**
  - Constat : Aucun médiateur de la consommation n'est désigné ET rien ne refuse un particulier. Prises une par une les deux lignes sont des refus assumés ; ensemble elles sont une infraction à l'article L612-1 du code de la consommation, parce que l'exemption annoncée en réponse à la question 57 suppose un parcours qui refuse effectivement un consommateur. Répondre à l'une des deux suffit : désigner un médiateur, ou fermer le parcours grand public (question 62).
  - Pour lever : Adhérer à un médiateur de la consommation et publier ses coordonnées, OU fermer réellement le parcours grand public (question 62). L'une des deux suffit ; c'est l'associé qui choisit et le développeur qui applique. Article L612-1 du code de la consommation.

## développeur (4)

- **Condition « textile-nu-fournisseur », inconnue de ce relevé** · **refusée par la porte de l’argent**
  - Constat : Le dépôt du catalogue fournisseur est vide. Lancez « wp teeshoop catalogue synchroniser » : sans lui, on ne peut pas dire si les textiles nus vendus existent encore.
  - Pour lever : Cette condition est neuve et la table des propriétaires de scripts/launch-gate.mjs ne la connaît pas encore. La router vers son propriétaire réel, et compléter la table plutôt que de laisser une dette sans nom.
- **Prix au-dessus de son plancher** · **refusée par la porte de l’argent**
  - Constat : Le tarif publié, les coûts, les règles de marge, la commission ou le port ont changé depuis la dernière mesure du plancher, donc cette mesure ne décrit plus la boutique. Relancez « npm run verify:grille ».
  - Pour lever : Mesurer la grille publiée contre son plancher de coût (« npm run verify:grille »), puis, si une colonne vend sous le sien, remonter son prix ou corriger le coût qui fait monter ce plancher. Une vente sous le plancher se fait à perte et rien ne le montre avant la clôture comptable.
- **Prix au-dessus de son plancher** · **refusée par la porte de l’argent**
  - Constat : 3 colonne(s) publiée(s) sur 102 se vendent sous leur plancher : la boutique perd de l’argent à chaque vente de ces lignes.
  - Pour lever : Mesurer la grille publiée contre son plancher de coût (« npm run verify:grille »), puis, si une colonne vend sous le sien, remonter son prix ou corriger le coût qui fait monter ce plancher. Une vente sous le plancher se fait à perte et rien ne le montre avant la clôture comptable.
- **Passerelle de paiement** · **refusée par la porte de l’argent**
  - Constat : Aucun moyen de paiement n’est actif : la boutique ne peut rien encaisser. Activez une passerelle dans WooCommerce, Réglages, Paiements.
  - Pour lever : Configurer la passerelle avant d'encaisser : clés en mode réel, devise, et point de rappel (webhook) joignable. Une passerelle mal configurée encaisse ailleurs, ou n'encaisse pas.

---

Régénéré par la porte de publication. Le diff de ce fichier est la seule preuve qu’une ligne a été levée.
