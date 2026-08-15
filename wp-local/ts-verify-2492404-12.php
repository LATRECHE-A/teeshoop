<?php

function ts_product( $ref ) {
  $found = get_posts( array(
    'post_type' => 'product', 'post_status' => 'any', 'numberposts' => 1, 'fields' => 'ids',
    'meta_key' => '_teeshoop_ref', 'meta_value' => $ref, 'no_found_rows' => true,
  ) );
  return empty( $found ) ? 0 : (int) $found[0];
}

$id = ts_product( '01342' );
     $p  = wc_get_product( $id );
     $v  = wc_get_product( (int) $p->get_children()[0] );
     echo wp_json_encode( array(
       'rate'        => Teeshoop\Core\Settings::pricing()['blank_margin_rate'],
       'price'       => (string) $v->get_price(),
       'purchasable' => (bool) $v->is_purchasable(),
     ) );
