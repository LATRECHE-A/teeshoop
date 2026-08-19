<?php
echo "hide_out_of_stock=", var_export( get_option('woocommerce_hide_out_of_stock_items'), true ), "\n";
$vis = wc_get_product_visibility_term_ids();
echo "visibility terms: "; print_r( $vis );
$ids = get_posts( array('post_type'=>'product','post_status'=>'any','numberposts'=>-1,'fields'=>'ids') );
echo "products (any status): ", count($ids), "\n";
foreach ( $ids as $id ) {
  $p = wc_get_product( $id );
  $terms = wp_get_object_terms( $id, 'product_visibility', array('fields'=>'names') );
  printf( "#%d  %-10s  vis=%-12s stock=%-12s type=%-10s terms=[%s]  %s\n",
     $id, get_post_status($id), $p ? $p->get_catalog_visibility() : '?', $p ? $p->get_stock_status() : '?',
     $p ? $p->get_type() : '?', implode(',', (array)$terms), get_the_title($id) );
}
