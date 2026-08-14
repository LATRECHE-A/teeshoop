<?php
wp_set_current_user( 1 );
       $out = '';
       foreach ( array( '/wc/v3/products', '/wc/v3/products/' . wc_get_product_id_by_sku( '01342' ) . '/variations' ) as $route ) {
         $req = new WP_REST_Request( 'GET', $route );
         $req->set_param( 'per_page', 100 );
         $res = rest_do_request( $req );
         $out .= wp_json_encode( rest_get_server()->response_to_data( $res, false ) );
       }
       /*
        * The CSV exporter is an ADMIN-only include: WooCommerce loads it from
        * admin/class-wc-admin-exporters.php, which never runs under WP-CLI, so
        * constructing it here is a fatal. Loading the three files by hand is
        * what the shop own Export button ends up doing, and it is the surface
        * that actually needs testing: that button is one click away from any
        * shop manager, and its "export custom meta" checkbox is what would put
        * our purchase price in a spreadsheet.
        *
        * NOTE FOR WHOEVER EDITS THIS PHP: it lives in a JavaScript template
        * literal. A backtick or a dollar-brace in here silently becomes
        * JavaScript. One backtick in this very comment cost a run.
        */
       if ( ! class_exists( 'WC_Product_CSV_Exporter' ) ) {
         require_once WC_ABSPATH . 'includes/export/abstract-wc-csv-exporter.php';
         require_once WC_ABSPATH . 'includes/export/abstract-wc-csv-batch-exporter.php';
         require_once WC_ABSPATH . 'includes/export/class-wc-product-csv-exporter.php';
       }
       $exporter = new WC_Product_CSV_Exporter();
       // The method names are WooCommerce 11.0.1's, checked against the class
       // rather than remembered: 'set_product_types' is the name everyone
       // writes and it does not exist, and calling it is a fatal, not a warning.
       $exporter->set_product_types_to_export( array( 'variable', 'variation' ) );
       $exporter->enable_meta_export( true );
       $exporter->set_limit( 1000 );
       $exporter->generate_file();
       $csv = (string) $exporter->get_file();
       if ( strlen( $csv ) < 200 ) { throw new RuntimeException( 'the CSV export produced ' . strlen( $csv ) . ' bytes, so grepping it proves nothing' ); }
       $out .= $csv;
       $p = wc_get_product( wc_get_product_id_by_sku( '01342' ) );
       $out .= wp_json_encode( $p->get_available_variations() );
       echo $out;
