<?php
/**
 * How many linear metres of film an order needs, asked of the packer.
 *
 * The Bible wants the marking cost derived from "la surface occupée sur une
 * laize de 56 cm, de l'imbrication, des marges techniques" and not typed in per
 * logo. That is a two-dimensional packing, this repository already contains one,
 * and it is written in TypeScript: `src/lib/dtf/nesting.ts`, the same packer the
 * workshop's gang sheets and cutting plans come out of.
 *
 * So this file does not pack anything. It asks. `POST /api/nest` on the Worker
 * (worker/nest.ts) runs that packer and answers with the billed length. There is
 * one packer, and the number on a margin report is the number the film order
 * will be placed on.
 *
 * ── FAIL CLOSED, AND WHAT THAT MEANS HERE ────────────────────────────────────
 *
 * "We could not ask" is not "there is no film". Every failure path returns
 * `ok => false` with a reason, and `Costing` turns that into a component marked
 * UNKNOWN, which makes the whole cost incomplete, which withholds the floor
 * price. A margin report that quietly costed the film at zero because a token
 * was unset would authorise every sale on earth.
 *
 * ── THE TOKEN IS A CONSTANT, NOT AN OPTION ───────────────────────────────────
 *
 * `TEESHOOP_WORKER_TOKEN` in wp-config.php. Not in the database: options are in
 * every backup, in every export, and readable by every other plugin on the site,
 * and this one grants access to the shop's supplier catalogue and purchase
 * prices as well (it is the Worker's single ADMIN_TOKEN). Unset means every
 * request is refused before it is sent, which is the same posture the Worker
 * takes at the other end.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Nest {

	/**
	 * Seconds to wait for a packing.
	 *
	 * Ten and not the usual five: a three-hundred-garment order is several
	 * thousand transfer instances and the packer is doing real work. Nothing on a
	 * customer path waits for this. The report is computed when an operator asks
	 * and then stored on the order, so the cost of the wait is paid once.
	 */
	private const TIMEOUT = 10;

	/** Refuse to send a body larger than the Worker will read. */
	private const MAX_PIECES = 512;

	public static function token(): string {
		return defined( 'TEESHOOP_WORKER_TOKEN' ) ? (string) TEESHOOP_WORKER_TOKEN : '';
	}

	/** Whether the shop is able to ask at all. Used by the admin screen. */
	public static function configured(): bool {
		return '' !== Settings::get( 'worker_url' ) && '' !== self::token();
	}

	/**
	 * Pack a set of transfers onto the roll and report the billed length.
	 *
	 * $pieces: one entry per DISTINCT transfer, `['id'=>string, 'w_cm'=>float,
	 * 'h_cm'=>float, 'qty'=>int]`. Distinct is the point: thirty identical shirts
	 * are one piece with a quantity of thirty, and the packer expands it. Sending
	 * thirty copies would be the same answer and thirty times the body.
	 *
	 * @return array{ok:bool,reason:string,billed_m:float,sheets:int,unplaceable:array,utilization:float}
	 */
	public static function billed_metres( array $pieces, array $config ): array {
		$fail = static function ( string $reason ): array {
			return array(
				'ok'          => false,
				'reason'      => $reason,
				'billed_m'    => 0.0,
				'sheets'      => 0,
				'unplaceable' => array(),
				'utilization' => 0.0,
			);
		};

		if ( array() === $pieces ) {
			return $fail( 'aucune_geometrie' );
		}
		if ( count( $pieces ) > self::MAX_PIECES ) {
			return $fail( 'trop_de_pieces' );
		}

		$worker = Settings::get( 'worker_url' );
		if ( '' === $worker ) {
			return $fail( 'worker_non_configure' );
		}
		$token = self::token();
		if ( '' === $token ) {
			return $fail( 'jeton_absent' );
		}

		$film = (array) ( $config['film'] ?? array() );

		$response = wp_remote_post(
			rtrim( $worker, '/' ) . '/api/nest',
			array(
				'timeout'     => self::TIMEOUT,
				'redirection' => 0,
				'headers'     => array(
					'content-type'  => 'application/json',
					'accept'        => 'application/json',
					'authorization' => 'Bearer ' . $token,
				),
				'body'        => (string) wp_json_encode(
					array(
						'pieces'          => array_values( $pieces ),
						/*
						 * The geometry travels WITH the request, from the same
						 * config the tariff comes from. The rate and the width are
						 * one tariff (17,00 EUR the linear metre OF 56 cm), so a
						 * Worker default that happened to differ would price this
						 * shop's film on somebody else's roll.
						 */
						'width_cm'        => (float) ( $film['width_cm'] ?? 0 ),
						'gap_cm'          => (float) ( $film['gap_cm'] ?? 0 ),
						'max_length_cm'   => (float) ( $film['max_length_cm'] ?? 0 ),
						'billing_step_cm' => 10.0,
					)
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			return $fail( 'worker_injoignable' );
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		if ( 401 === $code ) {
			return $fail( 'jeton_refuse' );
		}
		if ( 200 !== $code ) {
			return $fail( 'worker_erreur_' . $code );
		}

		$body = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		if ( ! is_array( $body ) || ! isset( $body['billed_m'] ) || ! is_numeric( $body['billed_m'] ) ) {
			return $fail( 'reponse_illisible' );
		}

		$metres = (float) $body['billed_m'];
		if ( ! is_finite( $metres ) || $metres < 0 ) {
			return $fail( 'longueur_absurde' );
		}

		$unplaceable = isset( $body['unplaceable'] ) && is_array( $body['unplaceable'] ) ? $body['unplaceable'] : array();

		/*
		 * A TRANSFER THAT CANNOT BE PLACED MAKES THE WHOLE ANSWER UNUSABLE.
		 *
		 * The packer reports a piece that fits on no roll in either orientation
		 * rather than silently dropping it, and the length it returns is the
		 * length of everything else. Costing an order on that length would leave
		 * out its largest transfer, which is exactly the piece that costs the
		 * most film. It is also an order the workshop cannot print, so the honest
		 * answer is that we do not know what it costs.
		 */
		if ( array() !== $unplaceable ) {
			$out               = $fail( 'piece_impossible' );
			$out['unplaceable'] = array_map( 'strval', $unplaceable );
			return $out;
		}

		return array(
			'ok'          => true,
			'reason'      => '',
			'billed_m'    => $metres,
			'sheets'      => (int) ( $body['sheets'] ?? 0 ),
			'unplaceable' => array(),
			'utilization' => isset( $body['utilization'] ) ? (float) $body['utilization'] : 0.0,
		);
	}

	/** What went wrong, in a sentence an operator can act on. */
	public static function reason_fr( string $reason ): string {
		$known = array(
			'aucune_geometrie'     => 'La commande ne porte aucune géométrie de transfert : elle a été créée avant que le studio ne les enregistre, ou le fichier de création ne les contient pas.',
			'trop_de_pieces'       => 'La commande contient trop de transferts distincts pour être imbriquée en une fois.',
			'worker_non_configure' => 'L’adresse du service d’imbrication n’est pas renseignée dans les réglages.',
			'jeton_absent'         => 'Le jeton du service d’imbrication n’est pas défini. Ajoutez TEESHOOP_WORKER_TOKEN dans wp-config.php.',
			'jeton_refuse'         => 'Le service d’imbrication a refusé le jeton. Vérifiez TEESHOOP_WORKER_TOKEN.',
			'worker_injoignable'   => 'Le service d’imbrication n’a pas répondu.',
			'reponse_illisible'    => 'Le service d’imbrication a répondu quelque chose d’inattendu.',
			'longueur_absurde'     => 'Le service d’imbrication a renvoyé une longueur impossible.',
			'piece_impossible'     => 'Un transfert de cette commande ne tient sur aucun rouleau : il faut le redécouper avant de pouvoir la chiffrer.',
		);
		if ( isset( $known[ $reason ] ) ) {
			return $known[ $reason ];
		}
		if ( str_starts_with( $reason, 'worker_erreur_' ) ) {
			return sprintf(
				/* translators: %s: HTTP status code returned by the nesting service. */
				__( 'Le service d’imbrication a répondu %s.', 'teeshoop' ),
				substr( $reason, strlen( 'worker_erreur_' ) )
			);
		}
		return __( 'Le métrage de film n’a pas pu être obtenu.', 'teeshoop' );
	}
}
