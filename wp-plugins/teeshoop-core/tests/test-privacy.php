<?php
/**
 * The pure half of an erasure: when it stops, and what it takes out of a proof.
 *
 * WHY THESE TWO AND NOT THE REST. `Privacy::erase_order()` needs a real
 * WooCommerce and is covered by `tests/integration-rgpd.php`. What is here is the
 * part that decides when the request ENDS, which cannot be exercised end to end
 * without twenty orders and an unreachable Worker at the same time, and the part
 * that takes a person out of a frozen document, which has to keep the document
 * usable afterwards.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

require_once __DIR__ . '/../includes/Privacy.php';

use Teeshoop\Core\Privacy;

/*
 * The one WordPress function the code under test calls.
 *
 * `Privacy::scrub_*` re-encode what they have emptied, and they use
 * `wp_json_encode` rather than `json_encode` because on the shop that is the
 * function that will not silently truncate on a depth limit. In a bare PHP
 * process it does not exist, so the pure suite provides it, guarded, and the
 * shop's own remains authoritative everywhere else.
 */
if ( ! function_exists( 'wp_json_encode' ) ) {
	function wp_json_encode( $data, $options = 0, $depth = 512 ) {
		return json_encode( $data, (int) $options, (int) $depth );
	}
}

describe(
	'Privacy: when an erasure request stops asking',
	function () {
		it(
			'asks again only when it both erased something and filled a page',
			function () {
				/*
				 * WordPress calls an eraser page after page until `done`, and
				 * ours re-reads page 1 every time, because erasing is what
				 * advances the window: paginating with an offset WHILE deleting
				 * skips every row past the first page, which is the defect
				 * `Quote::erase_personal_data` carried.
				 *
				 * That is only safe while the window shrinks. It does not shrink
				 * when nothing could be erased, which is what an unreachable
				 * Worker produces on every order at once, and the request would
				 * then go round the same twenty for ever.
				 */
				truthy( Privacy::more_to_do( true, 20 ), 'une page pleine entièrement effacée : il peut en rester' );
				truthy( ! Privacy::more_to_do( true, 19 ), 'une page incomplète : il n’en reste pas' );
				truthy( ! Privacy::more_to_do( false, 20 ), 'une page pleine dont rien n’a pu être effacé : boucle infinie' );
				truthy( ! Privacy::more_to_do( false, 0 ), 'rien trouvé, rien effacé' );
			}
		);
	}
);

describe(
	'Privacy: taking a person out of a document without taking it apart',
	function () {
		it(
			'empties every named key, at any depth, and leaves the rest',
			function () {
				$out = Privacy::scrub_deep(
					array(
						'customer' => array(
							'nom'   => 'Camille Roux',
							'email' => 'camille@example.test',
						),
						'lines'    => array(
							array(
								'garment'  => 'tee',
								'quantity' => 6,
								'note'     => 'pour Camille',
							),
						),
						'version'  => 3,
					),
					array( 'nom', 'email', 'note' )
				);
				eq( $out['customer']['nom'], '', 'le nom est resté' );
				eq( $out['customer']['email'], '', 'l’adresse est restée' );
				eq( $out['lines'][0]['note'], '', 'un champ imbriqué dans une liste est resté' );
				eq( $out['lines'][0]['garment'], 'tee', 'le vêtement a été abîmé' );
				eq( $out['lines'][0]['quantity'], 6, 'la quantité a été abîmée' );
				eq( $out['version'], 3, 'la version a été abîmée' );
			}
		);

		it(
			'empties rather than unsets, so a screen that reads the key does not fatal',
			function () {
				$out = Privacy::scrub_deep( array( 'nom' => 'Camille' ), array( 'nom' ) );
				truthy( array_key_exists( 'nom', $out ), 'la clé a disparu au lieu d’être vidée' );
			}
		);

		it(
			'leaves a value alone when it is not a string, because a count is not a name',
			function () {
				$out = Privacy::scrub_deep( array( 'nom' => 12 ), array( 'nom' ) );
				eq( $out['nom'], 12, 'un entier portant un nom de clé sensible a été vidé' );
			}
		);

		it(
			'keeps a waiver provable and drops only the address',
			function () {
				$before = (string) json_encode(
					array(
						'at'   => '2026-08-26T10:00:00+00:00',
						'ip'   => '198.51.100.9',
						'cgv'  => '2026-08-26',
						'text' => 'Je commande des articles personnalisés à ma demande.',
					)
				);
				$after = json_decode( Privacy::scrub_waiver( $before ), true );

				eq( $after['ip'], '', 'l’adresse IP est restée' );
				eq( $after['at'], '2026-08-26T10:00:00+00:00', 'la date de l’acceptation a été perdue' );
				eq( $after['cgv'], '2026-08-26', 'la version acceptée a été perdue' );
				eq(
					$after['text'],
					'Je commande des articles personnalisés à ma demande.',
					'la phrase acceptée a été perdue, donc la renonciation ne prouve plus rien'
				);
			}
		);

		it(
			'passes through what it cannot read, rather than emptying it',
			function () {
				eq( Privacy::scrub_waiver( '' ), '', 'la chaîne vide a été transformée' );
				eq( Privacy::scrub_waiver( 'pas du json' ), 'pas du json', 'un contenu illisible a été écrasé' );
				eq( Privacy::scrub_bat( 'pas du json' ), 'pas du json', 'un bon à tirer illisible a été écrasé' );
				eq( Privacy::scrub_claims( 'pas du json' ), 'pas du json', 'une réclamation illisible a été écrasée' );
			}
		);

		it(
			'keeps a claim countable and drops only the free text',
			function () {
				$before = (string) json_encode(
					array(
						array(
							'motif'       => 'marquage',
							'cause'       => 'teeshoop',
							'quantite'    => 4,
							'description' => 'le logo de Camille est décalé',
						),
					)
				);
				$after = json_decode( Privacy::scrub_claims( $before ), true );
				eq( $after[0]['description'], '', 'le texte libre est resté' );
				eq( $after[0]['motif'], 'marquage', 'le motif a été perdu, donc le dossier n’est plus comptable' );
				eq( $after[0]['quantite'], 4, 'la quantité a été perdue' );
			}
		);
	}
);

describe(
	'Privacy: the register describes itself honestly',
	function () {
		it(
			'names a recipient this shop actually has, for every treatment',
			function () {
				$who = array_keys( Privacy::processors() );
				foreach ( Privacy::register() as $row ) {
					foreach ( (array) $row['destinataires'] as $name ) {
						truthy(
							in_array( $name, $who, true ),
							'traitement « ' . $row['cle'] . ' » : destinataire « ' . $name . ' » absent du registre des sous-traitants'
						);
					}
				}
			}
		);

		it(
			'says for every treatment whether a mechanism applies the retention',
			function () {
				foreach ( Privacy::register() as $row ) {
					foreach ( array( 'cle', 'nom', 'finalite', 'base', 'personnes', 'donnees', 'duree', 'mecanisme' ) as $key ) {
						truthy(
							! empty( $row[ $key ] ),
							'traitement « ' . (string) $row['cle'] . ' » : ' . $key . ' manquant'
						);
					}
				}
			}
		);
	}
);
