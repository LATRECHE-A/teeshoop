<?php
/**
 * Le jeu d'essai de purge-demo.sh, pour le miroir local UNIQUEMENT.
 *
 * POURQUOI IL EXISTE. Le contrôle « cette image sert-elle ailleurs » de
 * purge-demo.sh a été écrit quatre fois et s'est trompé trois fois, toujours
 * dans la direction qui efface des fichiers. Aucun de ces défauts n'était
 * visible en relisant le code : les trois ont été trouvés en faisant tourner le
 * script contre un vrai WooCommerce sur un cas construit exprès.
 *
 * Ce fichier est ce cas. Il pose quatre images et quatre façons de s'en servir,
 * une par source que le contrôle doit lire :
 *
 *   image 1  vignette d'un produit condamné ET d'une page conservée   -> GARDER
 *   image 2  vignette d'un produit condamné, rien d'autre             -> supprimer
 *   image 3  vignette d'une VARIATION condamnée, rien d'autre         -> supprimer
 *   image 4  galerie d'un produit condamné ET vignette d'une CATÉGORIE -> GARDER
 *
 * L'image 3 est celle qui a démasqué le bogue des variations : elle n'était même
 * pas ramassée comme candidate. L'image 4 est celle des catégories, que les
 * quatre premières sources ne regardaient pas du tout parce qu'une vignette de
 * catégorie vit dans `termmeta` et non dans `postmeta`.
 *
 * COMMENT S'EN SERVIR :
 *
 *   npm run wp:up
 *   docker compose -f wp-local/docker-compose.yml run --rm -T wpcli \
 *     eval-file - < scripts/purge-demo-fixture.php
 *   docker compose -f wp-local/docker-compose.yml run --rm -T \
 *     --entrypoint bash -e HOME=/tmp -v "$PWD/scripts":/scripts:ro \
 *     wpcli /scripts/purge-demo.sh /var/www/html
 *
 * Attendu : « MÉDIAS : 2 à supprimer, 2 gardés ». Toute autre réponse est un
 * défaut, et la direction dangereuse est « 4 à supprimer, 0 gardés ».
 *
 * Puis on remet le miroir en état :
 *
 *   docker compose -f wp-local/docker-compose.yml run --rm -T wpcli eval \
 *     'foreach ( get_posts( array( "post_type" => "any", "s" => "TS-FIXTURE", "numberposts" => -1 ) ) as $p ) { wp_delete_post( $p->ID, true ); }'
 *
 * JAMAIS SUR UNE VRAIE INSTALLATION. Il écrit des produits et une catégorie.
 *
 * @package Teeshoop\Core
 */

$att = array();
for ($i = 1; $i <= 4; $i++) {
    $att[$i] = wp_insert_post(array('post_type'=>'attachment','post_title'=>"TS-FIXTURE-media-$i",
        'post_status'=>'inherit','post_mime_type'=>'image/png','guid'=>"http://x/ts-fixture-$i.png"));
}
$ids = array(); $sku = array(1=>'CH-T01', 2=>'TB-T02');
for ($i = 1; $i <= 2; $i++) {
    $ids[$i] = wp_insert_post(array('post_type'=>'product','post_title'=>"TS-FIXTURE produit $i",
        'post_status'=>'publish','post_date'=>'2023-05-01 10:00:00','post_date_gmt'=>'2023-05-01 10:00:00'));
    update_post_meta($ids[$i], '_sku', $sku[$i]);
    update_post_meta($ids[$i], '_thumbnail_id', $att[$i]);
}
// L'image 4 est en GALERIE d'un produit condamné : candidate.
update_post_meta($ids[1], '_product_image_gallery', (string) $att[4]);
// Une variation condamnée porte l'image 3 : candidate, et à supprimer.
$var = wp_insert_post(array('post_type'=>'product_variation','post_title'=>'TS-FIXTURE variation',
    'post_status'=>'publish','post_parent'=>$ids[1]));
update_post_meta($var, '_thumbnail_id', $att[3]);
// Une page CONSERVÉE utilise l'image 1 : à garder.
$page = wp_insert_post(array('post_type'=>'page','post_title'=>'TS-FIXTURE temoin','post_status'=>'publish'));
update_post_meta($page, '_thumbnail_id', $att[1]);
// UNE CATÉGORIE DE PRODUITS dont la vignette est l'image 4 : à garder, et c'est
// la source que les quatre requêtes précédentes ne regardaient pas.
$t = wp_insert_term('TS-FIXTURE categorie', 'product_cat');
if (!is_wp_error($t)) { update_term_meta($t['term_id'], 'thumbnail_id', $att[4]); }
echo "produits {$ids[1]},{$ids[2]}  variation $var  page $page  categorie ", (is_wp_error($t)?'ERR':$t['term_id']), "\n";
echo "medias 1={$att[1]} 2={$att[2]} 3={$att[3]} 4={$att[4]}\n";
echo "ATTENDU : 4 candidats, 2 gardes (1 page, 4 categorie), 2 a supprimer (2 produit, 3 variation)\n";
