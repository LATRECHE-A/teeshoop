<?php
/**
 * The design hand-off.
 *
 * An order line carries an IDENTIFIER. The artwork itself (the customer's
 * upload, the flattened preview, the 300 DPI print file) lives in R2, put there
 * by the studio through the Worker before the add-to-cart call is ever made.
 *
 * Two reasons it is not in the WordPress media library:
 *   · wp-content/uploads is served by URL with no access control, so a customer
 *     logo would be a guessable public file. robots.txt is not a permission.
 *   · the files are large and the shop is on shared hosting.
 *
 * And one reason the id is verified rather than trusted: the id arrives from a
 * browser. An order whose design does not exist is an order the workshop cannot
 * print, discovered after the customer has paid.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

/*
 * THE TEST HATCH REACHES TWO FUNCTIONS AND NO MORE. `normalise_pieces` and
 * `normalise_placement` are pure arithmetic on an untrusted payload and they
 * are the shop's half of a gate whose other half is a TypeScript file; the two
 * have to be proved to agree, and `tests/run.php` is where that is cheap.
 * Everything else here calls WordPress and will fatal without it, which is the
 * correct signal rather than a silent pass.
 */
defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

final class Design {

	/**
	 * Design ids are opaque, URL-safe and bounded.
	 *
	 * Bounded matters: this string ends up in an order-item meta key lookup, in a
	 * URL to the Worker, and on a picking list. 16–64 of [A-Za-z0-9_-] is wide
	 * enough for any id scheme we would pick and narrow enough that nothing needs
	 * escaping downstream.
	 */
	public static function valid_id( string $id ): bool {
		return 1 === preg_match( '/^[A-Za-z0-9_-]{16,64}$/', $id );
	}

	/**
	 * Ask the Worker whether this design actually exists.
	 *
	 * Returns:
	 *   ['ok' => true,  'meta' => array]        the design is there
	 *   ['ok' => false, 'reason' => string]     it is not, or we could not ask
	 *
	 * A network failure is NOT treated as a pass. If the Worker cannot be reached
	 * we do not know whether the files exist, and "we do not know" must not add a
	 * paid line to a cart, unless the shop has explicitly opted out via
	 * Settings::allow_unverified_designs(), which is for local development.
	 */
	public static function verify( string $id ): array {
		if ( ! self::valid_id( $id ) ) {
			return array(
				'ok'     => false,
				'reason' => 'malformed_id',
			);
		}

		$worker = Settings::get( 'worker_url' );
		if ( '' === $worker ) {
			return Settings::allow_unverified_designs()
				? array(
					'ok'   => true,
					'meta' => array( 'verified' => false ),
				)
				: array(
					'ok'     => false,
					'reason' => 'worker_not_configured',
				);
		}

		$url = rtrim( $worker, '/' ) . Settings::get( 'design_verify_path' ) . rawurlencode( $id );

		$response = wp_remote_get(
			$url,
			array(
				'timeout'     => 5,
				'redirection' => 0,
				'headers'     => array( 'accept' => 'application/json' ),
			)
		);

		if ( is_wp_error( $response ) ) {
			return Settings::allow_unverified_designs()
				? array(
					'ok'   => true,
					'meta' => array( 'verified' => false ),
				)
				: array(
					'ok'     => false,
					'reason' => 'worker_unreachable',
				);
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		if ( 200 !== $code ) {
			return array(
				'ok'     => false,
				'reason' => 404 === $code ? 'design_not_found' : 'worker_error_' . $code,
			);
		}

		$body = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		if ( ! is_array( $body ) ) {
			return array(
				'ok'     => false,
				'reason' => 'worker_bad_json',
			);
		}

		return array(
			'ok'   => true,
			'meta' => array(
				'verified'   => true,
				'print_file' => isset( $body['print_file'] ) ? (string) $body['print_file'] : '',
				'preview'    => isset( $body['preview'] ) ? self::normalise_preview( (string) $body['preview'] ) : '',
				/*
				 * ONE PREVIEW PER PRINTED SIDE, by side id. `preview` above is
				 * the cart thumbnail and stays what it was. These exist for the
				 * bon à tirer, which has to show every side the customer is
				 * approving; a proof showing only the front of a garment printed
				 * front and back decides nothing about the back.
				 */
				'previews'   => isset( $body['previews'] ) && is_array( $body['previews'] ) ? self::normalise_previews( $body['previews'] ) : array(),
				'sides'      => isset( $body['sides'] ) && is_array( $body['sides'] ) ? $body['sides'] : array(),
				/*
				 * THE COLOUR, because a bon à tirer has to print it and there is
				 * nowhere else it exists on this side. The manifest has carried
				 * it since the design route was written and this function threw
				 * it away; the alternative was a second `wp_remote_get` to the
				 * same URL from `Bat`, which is two readers of one fact and one
				 * more network call on the path to a customer promise.
				 *
				 * It is frozen onto the order line at add-to-cart, so issuing a
				 * proof reads the order and not the Worker.
				 */
				'garment'    => isset( $body['garment'] ) ? (string) $body['garment'] : '',
				'color'      => isset( $body['color'] ) ? (string) $body['color'] : '',
				/*
				 * WHICH BUILD RENDERED IT. The artwork is re-rendered later by
				 * whatever is deployed then (`worker/design.ts` stamps this for
				 * exactly that reason), so a proof approved under one version and
				 * a transfer pressed under another are not guaranteed to be the
				 * same pixels. This field is the only thing that would ever let
				 * anyone notice.
				 */
				'app_version' => isset( $body['app_version'] ) ? (string) $body['app_version'] : '',
			),
		);
	}

	/**
	 * The single flattened preview path, checked against the one shape the
	 * Worker mints (`worker/design.ts`: `/r2/design/{id}/preview.png`).
	 *
	 * ITS SIBLING BELOW HAS HAD THIS SINCE IT WAS WRITTEN and this one did not,
	 * on the reasoning that `preview` only ever reached the bon à tirer. It now
	 * reaches the cart, the order and the e-mail, so the two paths are the same
	 * kind of string in the same kind of place and there is no argument left for
	 * giving them different margins. That asymmetry, one path guarded and its
	 * sibling not, is a shape that has bitten this project before.
	 *
	 * An unrecognised path becomes '', and `Cart::preview_img` then falls
	 * through to the product image rather than rendering an address somebody
	 * else chose.
	 */
	public static function normalise_preview( string $path ): string {
		return preg_match( '#^/r2/design/[A-Za-z0-9_-]{16,64}/preview\.png$#', $path ) ? $path : '';
	}

	/**
	 * The per-side preview paths, keyed by a side id we recognise.
	 *
	 * Bounded and pattern-checked because these strings end up in an `img src`
	 * on a page a customer opens: the manifest is ours, but the shop treats
	 * everything that arrives over HTTP as a claim. A path that is not one of
	 * the shapes the Worker stores is dropped, and the proof then says the
	 * mockup for that side is unavailable rather than rendering a broken image
	 * or, worse, an address somebody else chose.
	 *
	 * @return array<string,string>
	 */
	public static function normalise_previews( array $raw ): array {
		$out = array();
		foreach ( $raw as $side => $path ) {
			$id = sanitize_key( (string) $side );
			if ( '' === $id || ! is_string( $path ) ) {
				continue;
			}
			if ( ! preg_match( '#^/r2/design/[A-Za-z0-9_-]{16,64}/preview-[a-z_]{1,16}\.png$#', $path ) ) {
				continue;
			}
			$out[ $id ] = $path;
			if ( count( $out ) >= 8 ) {
				break;
			}
		}
		return $out;
	}

	/**
	 * Normalise the per-side payload that arrives with an add-to-cart.
	 *
	 * Only the fields the price depends on survive. Everything else the studio
	 * might send (layer trees, fonts, undo history) is deliberately dropped:
	 * it belongs in the design file, not in a cart session that gets serialised
	 * into the database on every page load.
	 *
	 * At most 8 sides. A garment has four printable faces plus room to grow; a
	 * request with 400 sides is not a t-shirt.
	 *
	 * `pieces` rides along from session 05. The AREA is what the customer pays
	 * for; the RECTANGLES are what the film costs, and the two are different
	 * questions: 400 cm² of ink is one transfer or six, and six of them pack onto
	 * a 56 cm roll very differently from one. They are measured together, once,
	 * in the browser, because an ink extent comes from a decoded image's alpha
	 * and neither this server nor the Worker has a canvas.
	 */
	/**
	 * The sizes at which this design carries a transfer nothing can print.
	 *
	 * ── WHY THE CART ASKS THIS FILE AND NOT THE COST ENGINE ──────────────────
	 *
	 * The answer depends on the film FORMAT, which lives in the cost config
	 * beside the film TARIFF, and `scripts/php-guard.mjs` keeps `Cost::` and
	 * `Costing::` out of `Cart.php` for a good reason: the cart renders to a
	 * customer and film economics must never reach that surface. The first
	 * version of this check called them from the cart directly and the guard
	 * refused it, correctly.
	 *
	 * A format is geometry, not money. So the question lives here, in the file
	 * that already owns what a design prints, and the cart asks it in those
	 * terms. What crosses back is a list of size names.
	 *
	 * ── WHY IT EXISTS AT ALL ─────────────────────────────────────────────────
	 *
	 * Every rectangle on a design is measured at the PRICED size, and the studio
	 * grades a print with the garment: a 3XL chest is 64 cm where an M is 52, so
	 * the same artwork comes out about 23 % larger in each direction. That was a
	 * question about the PRICE (question 37) and no more, while the film was a
	 * 56 cm roll cut at 100 cm and nothing a garment carries came close.
	 *
	 * Question 04's answer of 1 September 2026 put the shop on a 33 x 46 cm A3+
	 * sheet, and it stopped being about the price. Measured against
	 * `data/garments.json` that day: a full front or back print fits at S, M and
	 * L on both garments and fits in NO orientation from XL upward, where the
	 * published zone reaches 37,5 x 50 cm. Half the size range. The cost engine
	 * cannot see it, because it measures the priced size whatever was ordered, so
	 * without this the shop takes the money and the workshop finds out at the
	 * press.
	 *
	 * ── THE GRADING FACTOR IS READ, NEVER REDERIVED ──────────────────────────
	 *
	 * `data/garments.json` is generated from the studio's own definitions and
	 * `npm run verify:garments` fails when they diverge, so the ratio between a
	 * side's published zone at the ordered size and at the priced size IS the
	 * studio's grading factor. Width and height scale separately, because a zone
	 * is not always square: the hoodie front is, the tee front is not.
	 *
	 * ── AND IT FAILS CLOSED ──────────────────────────────────────────────────
	 *
	 * A side whose zone the garment data does not know, or a priced zone of zero,
	 * cannot be scaled, and an unscalable side is refused at that size rather
	 * than waved through. « We could not check » is not « it fits », and the
	 * consequence of confusing the two is a paid order the press cannot make.
	 *
	 * @param array<int,array<string,mixed>> $sides     normalised printed sides.
	 * @param array<string,int>              $size_grid size => count, may be empty.
	 * @return array<int,string> the offending sizes.
	 */
	public static function unprintable_sizes( string $garment, array $sides, array $size_grid, array $chart = array() ): array {
		if ( empty( $sides ) || empty( $size_grid ) ) {
			return array();
		}
		$priced = Garments::priced_size( $garment );
		if ( '' === $priced ) {
			return array();
		}
		$cost = Costing::config();

		/*
		 * UN MARQUAGE UNIQUE POUR TOUTES LES TAILLES NE GRANDIT PAS.
		 *
		 * `printScaleK` rend 1 partout quand le mode est « fixe » : le studio
		 * découpe UN transfert à la taille de base et le presse sur toutes les
		 * tailles. Le drapeau voyage déjà sur chaque face (`normalise_placement`),
		 * et `BatPage` comme `Costing` le lisent. Sans lui, cette fonction gradait
		 * quand même : mesuré le 5 septembre 2026, un carré de 25,0 cm en mode
		 * fixe sur un Gildan était refusé en 3XL avec la phrase « le marquage
		 * grandit avec le vêtement », qui est fausse pour cette création, et la
		 * vente était perdue pour rien.
		 *
		 * Toutes les faces, pas une : une création dont une face grade et pas
		 * l'autre grade, et c'est le sens prudent.
		 */
		$graded = false;
		foreach ( $sides as $side ) {
			if ( ! array_key_exists( 'graded', $side ) || ! empty( $side['graded'] ) ) {
				$graded = true;
				break;
			}
		}
		if ( ! $graded ) {
			return array();
		}

		$known = ProductPage::size_ids( $garment );

		$bad = array();
		foreach ( $size_grid as $size => $count ) {
			if ( (int) $count <= 0 || (string) $size === $priced ) {
				continue;
			}
			/*
			 * UNE TAILLE QUE LE STUDIO NE DESSINE PAS EST REFUSÉE, quelle que soit
			 * la branche.
			 *
			 * `garments.json` s'arrête au 3XL et le refusait déjà par son propre
			 * `empty( $at )`. Les fiches fournisseur, elles, portent du XS au 5XL,
			 * si bien qu'un 4XL passait par la branche « série du fabricant » et
			 * atteignait ensuite `sizeSpecCm('tee','4XL')` côté studio, qui est
			 * indéfini et fait tomber le rendu de TOUTE la fournée, pas seulement
			 * de cette ligne. Trouvé par la passe adversariale du 5 septembre 2026,
			 * et joignable par une requête REST fabriquée : `normalise_size_grid`
			 * accepte n'importe quel jeton de quatre caractères.
			 */
			if ( ! in_array( (string) $size, $known, true ) ) {
				$bad[ (string) $size ] = true;
				continue;
			}
			foreach ( $sides as $side ) {
				$pieces = (array) ( $side['pieces'] ?? array() );
				if ( empty( $pieces ) ) {
					continue;
				}
				/*
				 * LA SÉRIE DU FABRICANT PASSE DEVANT, quand la fiche produit en
				 * porte une.
				 *
				 * Depuis le 5 septembre 2026 le studio grade par la demi-poitrine
				 * du vêtement RÉELLEMENT vendu et non plus par celle du
				 * Stanley/Stella (voir `Design.shopSizeChart` côté studio). Les
				 * deux ne montent pas pareil : mesuré sur le Gildan Heavy Cotton,
				 * le rapport 3XL/M vaut 1,400 pour le fabricant contre 1,231 pour
				 * la charte du studio. Continuer à vérifier le placement avec
				 * `garments.json` reviendrait à mesurer une pièce de film 14 %
				 * plus petite que celle que l'atelier découpera, et à vendre un
				 * 3XL que le nid refusera ensuite comme trop grand pour la
				 * feuille.
				 *
				 * Un seul facteur en largeur et en hauteur, parce que la gradation
				 * du studio est uniforme (`printScaleK`), et deux facteurs ici en
				 * seraient une seconde implémentation.
				 */
				/*
				 * UNE FICHE QUI NE PORTE PAS LA TAILLE REFUSE LA TAILLE.
				 *
				 * Quand le produit déclare une série, elle est la seule source :
				 * mélanger sa taille tarifée avec le 3XL de `garments.json`
				 * fabriquerait un rapport entre DEUX vêtements. Le studio applique
				 * la même règle et rend « non mesurable » (`src/lib/printScale.ts`),
				 * si bien que sans ce refus la boutique vérifierait un marquage
				 * gradé pendant que l'atelier en presserait un qui ne l'est pas.
				 *
				 * Un produit SANS série garde `garments.json` : c'est l'état de
				 * tout le catalogue sauf dix références, et refuser là reviendrait
				 * à fermer la boutique.
				 */
				$k = self::grading_factor( $chart, (string) $size, $priced );
				if ( null === $k && array() !== $chart ) {
					$bad[ (string) $size ] = true;
					continue;
				}
				if ( null !== $k ) {
					$kw = $k;
					$kh = $k;
				} else {
					$by = Garments::area_by_size( $garment, (string) ( $side['id'] ?? '' ) );
					$at = (array) ( $by[ (string) $size ] ?? array() );
					$of = (array) ( $by[ $priced ] ?? array() );
					$pw = (float) ( $of['wCm'] ?? 0 );
					$ph = (float) ( $of['hCm'] ?? 0 );
					if ( $pw <= 0 || $ph <= 0 || empty( $at ) ) {
						$bad[ (string) $size ] = true;
						continue;
					}
					$kw = (float) ( $at['wCm'] ?? 0 ) / $pw;
					$kh = (float) ( $at['hCm'] ?? 0 ) / $ph;
				}
				$scaled = array();
				foreach ( $pieces as $piece ) {
					$scaled[] = array(
						'id'   => (string) ( $piece['id'] ?? '?' ),
						'w_cm' => (float) ( $piece['w_cm'] ?? 0 ) * $kw,
						'h_cm' => (float) ( $piece['h_cm'] ?? 0 ) * $kh,
						'qty'  => 1,
					);
				}
				if ( ! empty( Cost::unplaceable( $scaled, $cost ) ) ) {
					$bad[ (string) $size ] = true;
				}
			}
		}
		return array_keys( $bad );
	}

	/**
	 * Le facteur de gradation d'une série de demi-poitrines, ou null.
	 *
	 * Null veut dire « cette série ne répond pas pour ces deux tailles », pas
	 * « le facteur vaut un » : l'appelant retombe alors sur `garments.json`, et
	 * confondre les deux ferait imprimer un marquage de M sur un 3XL sans que
	 * rien ne le dise. La série arrive de `_teeshoop_demi_poitrine`, déjà bornée
	 * à la lecture par `ProductPage::maker_chart()`.
	 *
	 * @param array<string,float|string> $chart Série demi-poitrine, cm.
	 */
	private static function grading_factor( array $chart, string $size, string $priced ): ?float {
		$at = (float) ( $chart[ $size ] ?? 0 );
		$of = (float) ( $chart[ $priced ] ?? 0 );
		if ( $at <= 0 || $of <= 0 ) {
			return null;
		}
		return $at / $of;
	}

	public static function normalise_sides( mixed $raw ): array {
		if ( ! is_array( $raw ) ) {
			return array();
		}

		$out = array();
		foreach ( $raw as $side ) {
			if ( ! is_array( $side ) ) {
				continue;
			}
			$area = isset( $side['area_sq_cm'] ) ? (float) $side['area_sq_cm'] : 0.0;
			if ( $area <= 0 || ! is_finite( $area ) ) {
				continue;
			}
			$id = isset( $side['id'] ) ? sanitize_key( (string) $side['id'] ) : '';
			if ( '' === $id ) {
				continue;
			}

			$capped = min( $area, 10000.0 );
			$out[]  = array(
				'id'         => $id,
				// Cap at a square metre: past that it is a data error, and it
				// must not be able to drive the price to an absurd number.
				'area_sq_cm' => $capped,
			) + self::normalise_placement( $side, self::normalise_pieces( $side['pieces'] ?? null, $capped ) );

			if ( count( $out ) >= 8 ) {
				break;
			}
		}
		return $out;
	}

	/**
	 * The transfers of one side, bounded, or an empty list.
	 *
	 * ALL OR NOTHING, the same rule as the studio's own gate
	 * (src/lib/teeshoop/designDoc.ts). A partly-read list would cost the film of
	 * the pieces that happened to parse and silently drop the rest: a film cost
	 * that is too low, so a floor price that is too low, so a sale nobody would
	 * have authorised. A side whose pieces cannot all be read has no pieces, and
	 * `Costing` then reports its film as unknown rather than as cheap.
	 *
	 * The bounds match that gate exactly (32 pieces, 200 cm, and the ink area the
	 * rectangles must be able to hold) because the two ends are reading the same
	 * document, and a shop that accepted what the Worker refused would be
	 * costing an order the workshop cannot receive.
	 *
	 * `$area_sq_cm` IS THE POINT OF THIS FUNCTION, not a detail of it. The
	 * design document arrives through an OPEN route, because a customer cannot
	 * authenticate, and these rectangles are what our film cost and therefore
	 * our floor price are computed from. Bounds on their size stop absurd
	 * values; only the comparison with the ink area stops PLAUSIBLE ones. See
	 * the long note in src/lib/teeshoop/designDoc.ts for the derivation and for
	 * the 240,98 EUR it is worth on one order.
	 */
	public static function normalise_pieces( mixed $raw, float $area_sq_cm = 0.0 ): array {
		if ( ! is_array( $raw ) || array() === $raw || count( $raw ) > 32 ) {
			return array();
		}

		$out   = array();
		$boxed = 0.0;
		foreach ( $raw as $piece ) {
			if ( ! is_array( $piece ) ) {
				return array();
			}
			$w = isset( $piece['w_cm'] ) && is_numeric( $piece['w_cm'] ) ? (float) $piece['w_cm'] : -1.0;
			$h = isset( $piece['h_cm'] ) && is_numeric( $piece['h_cm'] ) ? (float) $piece['h_cm'] : -1.0;
			if ( ! is_finite( $w ) || ! is_finite( $h ) || $w <= 0 || $h <= 0 || $w > 200 || $h > 200 ) {
				return array();
			}
			$boxed += $w * $h;
			$piece_out = array(
				'w_cm' => $w,
				'h_cm' => $h,
			);
			// Carried through unvalidated; `normalise_placement` is what decides
			// whether they are kept, because the check is per SIDE and this loop
			// only sees one rectangle at a time.
			foreach ( array( 'top_cm', 'center_dx_cm' ) as $key ) {
				if ( isset( $piece[ $key ] ) && is_numeric( $piece[ $key ] ) ) {
					$piece_out[ $key ] = (float) $piece[ $key ];
				}
			}
			$out[] = $piece_out;
		}

		// 1 % of slack for the 0,01 cm rounding both numbers carry, and nothing
		// else. Failing it drops the geometry, never the order.
		if ( $boxed < $area_sq_cm * 0.99 ) {
			return array();
		}

		return $out;
	}

	/**
	 * How far a placement may sit outside the print area it declares, cm.
	 *
	 * The producer clamps every transfer to the area exactly, so the true answer
	 * is zero and what is left is rounding: six numbers each rounded to 0,01 cm
	 * before they are written. Identical to PLACEMENT_SLACK_CM in
	 * src/lib/teeshoop/designDoc.ts, because the two ends read one document.
	 */
	private const PLACEMENT_SLACK_CM = 0.05;

	/**
	 * The side's placement: the print area, the drop below the collar, and each
	 * transfer's position inside that area.
	 *
	 * ALL OR NOTHING PER SIDE, and separate from the film geometry, which is why
	 * it is its own function on both ends. These numbers are what the bon a
	 * tirer states and what a press is set up from; they are not a price input
	 * and not a film input. A placement that cannot be read therefore drops the
	 * PLACEMENT and keeps the rectangles: the order costs what it costs, and the
	 * proof says the position was not measured instead of printing one nobody
	 * took.
	 *
	 * The fit check is what an OPEN route needs. Unlike the area and the
	 * rectangles, nothing downstream would ever notice these being wrong: a
	 * document claiming a 30 cm drop inside a 40 cm area is a print half off the
	 * shoulder, and the first thing that would catch it today is a customer
	 * opening a parcel. The bounds mirror src/lib/teeshoop/designDoc.ts exactly.
	 *
	 * @param array $side   the raw side payload.
	 * @param array $pieces what `normalise_pieces` kept, possibly empty.
	 *
	 * @return array{pieces:array,area_w_cm?:float,area_h_cm?:float,drop_cm?:float}
	 */
	public static function normalise_placement( array $side, array $pieces ): array {
		/*
		 * REFUSING A PLACEMENT MEANS NOT STORING IT. `normalise_pieces` carries
		 * the two raw numbers through so this function can see them; every path
		 * that declines them has to strip them again, or the order keeps the
		 * very numbers the fit check just rejected and the bon a tirer prints
		 * them as measured.
		 */
		$bare = array( 'pieces' => array() );
		foreach ( $pieces as $piece ) {
			$bare['pieces'][] = array(
				'w_cm' => (float) $piece['w_cm'],
				'h_cm' => (float) $piece['h_cm'],
			);
		}

		$aw = isset( $side['area_w_cm'] ) && is_numeric( $side['area_w_cm'] ) ? (float) $side['area_w_cm'] : -1.0;
		$ah = isset( $side['area_h_cm'] ) && is_numeric( $side['area_h_cm'] ) ? (float) $side['area_h_cm'] : -1.0;
		if ( ! is_finite( $aw ) || ! is_finite( $ah ) || $aw <= 0 || $ah <= 0 || $aw > 200 || $ah > 200 ) {
			return $bare;
		}
		if ( array() === $pieces ) {
			return $bare;
		}

		$placed = array();
		foreach ( $pieces as $piece ) {
			if ( ! isset( $piece['top_cm'], $piece['center_dx_cm'] ) ) {
				return $bare;
			}
			$top = (float) $piece['top_cm'];
			$dx  = (float) $piece['center_dx_cm'];
			if ( ! is_finite( $top ) || ! is_finite( $dx ) ) {
				return $bare;
			}
			if ( $top < -self::PLACEMENT_SLACK_CM || $top + (float) $piece['h_cm'] > $ah + self::PLACEMENT_SLACK_CM ) {
				return $bare;
			}
			if ( abs( $dx ) + (float) $piece['w_cm'] / 2 > $aw / 2 + self::PLACEMENT_SLACK_CM ) {
				return $bare;
			}
			$placed[] = array(
				'w_cm'         => (float) $piece['w_cm'],
				'h_cm'         => (float) $piece['h_cm'],
				'top_cm'       => $top,
				'center_dx_cm' => $dx,
			);
		}

		$out  = array(
			'pieces'    => $placed,
			'area_w_cm' => $aw,
			'area_h_cm' => $ah,
		);
		$drop = isset( $side['drop_cm'] ) && is_numeric( $side['drop_cm'] ) ? (float) $side['drop_cm'] : -1.0;
		if ( is_finite( $drop ) && $drop > 0 && $drop <= 100 ) {
			$out['drop_cm'] = $drop;
		}
		// A tri-state, deliberately: true, false, and "the document predates the
		// field". The proof says nothing about grading in the third case rather
		// than picking whichever answer is commoner.
		if ( isset( $side['graded'] ) && is_bool( $side['graded'] ) ) {
			$out['graded'] = $side['graded'];
		}
		return $out;
	}
}
