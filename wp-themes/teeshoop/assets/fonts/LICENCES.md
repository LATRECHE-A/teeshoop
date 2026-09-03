# Les polices de la boutique, et le droit de les servir

Les quatre fichiers `.woff2` de ce répertoire sont servis depuis nos serveurs à
chaque visiteur. Ce fichier dit d'où ils viennent et sous quelle licence, parce
qu'une police redistribuée sans sa licence est une contrefaçon, et parce que la
question « a-t-on le droit » se pose le jour où personne ne se souvient de la
réponse.

| Fichier | Famille | Graisse | Octets | Paquet d'origine |
|---|---|---|---|---|
| `urbanist-latin-600.woff2` | Urbanist | 600 | 12 032 | `@fontsource/urbanist` 5.3.0 |
| `urbanist-latin-700.woff2` | Urbanist | 700 | 12 112 | `@fontsource/urbanist` 5.3.0 |
| `lato-latin-400.woff2` | Lato | 400 | 23 580 | `@fontsource/lato` 5.3.0 |
| `lato-latin-700.woff2` | Lato | 700 | 23 040 | `@fontsource/lato` 5.3.0 |

Total : 70 764 octets, sous-ensemble latin uniquement.

## La licence

Les deux familles sont sous **SIL Open Font License 1.1**, dont le texte intégral
est à côté : `LICENCE-Urbanist.txt` et `LICENCE-Lato.txt`.

L'OFL autorise explicitement l'usage, l'étude, la modification et la
redistribution, y compris commerciale, y compris intégrée à un site. Elle pose
trois conditions, et les trois sont tenues ici :

1. **La notice de copyright et la licence voyagent avec les fichiers.** C'est ce
   répertoire.
2. **Une version modifiée ne porte pas le « Reserved Font Name ».** Nous ne
   modifions rien : les `.woff2` sont copiés octet pour octet depuis les paquets
   npm, et `scripts/theme-fonts-check.mjs` échoue si un octet diffère.
3. **La police n'est pas vendue seule.** Elle est servie avec la boutique.

## Pourquoi elles sont ici et pas chez Google

`teeshoop.com` charge aujourd'hui Work Sans, Urbanist et Lato depuis
`fonts.googleapis.com`, ce qui envoie l'adresse IP de chaque visiteur à un
tiers hors Union européenne à chaque page. La CNIL a déjà sanctionné un site
français pour exactement cela. Auto-hébergées, les polices ne sortent pas de nos
serveurs, et la page part plus vite : une connexion de moins à ouvrir avant le
premier rendu.

## Les remplacer

Elles viennent de `node_modules`, jamais d'un téléchargement à la main :

```
cp node_modules/@fontsource/urbanist/files/urbanist-latin-700-normal.woff2 \
   wp-themes/teeshoop/assets/fonts/urbanist-latin-700.woff2
```

Puis `node scripts/theme-fonts-check.mjs`, qui compare les copies aux paquets,
vérifie que chaque graisse demandée par une feuille de style est bien déclarée
dans `assets/fonts.css`, et refuse toute adresse Google dans le thème.
